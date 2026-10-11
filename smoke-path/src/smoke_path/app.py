"""AWS Lambda handler (API Gateway HTTP API, payload v2).

GET /fires?hours=24   Fire watch: every fire NASA saw in India, what was burning, what it gives
                      off and how toxic, its smoke path and the places it reaches.

GET /smoke?lat=30.245&lon=75.844&start=2026-10-10T14:00&hours=24&uncertainty=cone&acres=5
GET /smoke?lat=30.605&lon=74.999&start=2026-10-09T12:37&origin=fire&frp=6.2&fire_type=farm

GET /air?lat=30.9&lon=75.85   48-hour CAMS forecast at one spot, as India's AQI (JSON)
GET /forecast                 CAMS AQI on the region grid every 3 hours (JSON, map layer)
GET /stations                 measured air at monitoring stations (CPCB live feed, JSON)

POST /alerts                  authority: warn a fire's source, or alert the people on its smoke path
GET /alerts?lat&lon&radius_km people: public alerts that affect an area (the citizen inbox)
GET /alerts?...&kind=farmer_warnings  farmers: warnings sent to farmers about fires near a farm
POST /alerts/<id>/ack         farmers: confirm a warning was read (the case becomes acknowledged)
POST /farmer/diagnose         farmers: Gemini looks at a plant photo and the ticked symptoms
POST /farmer/crop-advice      farmers: Gemini care advice for a crop at its stage
POST /farmer/chat             farmers: the crop doctor chat (Gemini, one turn at a time)
POST /farmer/stubble-plan     farmers: a Gemini plan to avoid burning this farm's straw
POST /farmer/brief            farmers: a short Gemini brief for the farm, from facts measured on the page
GET /activity                 authority: every alert sent
GET /cases, PATCH /cases/<id> authority: the case of each fire and its status

Returns a GeoJSON FeatureCollection. 400 for bad input or a start time
outside the forecast, 502 only if the wind forecast itself fails.
"""

import base64
import gzip
import json
import logging
import math
import threading
import time
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

from . import IST, air, alerts, firewatch, gemini, landuse, shared_cache, station_air
from .apis import LiveApi
from .net import ApiError
from .pipeline import SmokeRequest, WindUnavailable, run
from .wind import MAX_FORECAST_DAYS, MAX_PAST_DAYS, OutsideForecast, forecast_days_needed, wind_level

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

CACHE_TTL_S = 30 * 60
GZIP_MIN_BYTES = 50_000  # fire watch replies are often 1-2 MB and shrink about 10x
SAMPLE_PATH = Path(__file__).with_name("sample_response.json")
FIRE_SAMPLE_PATH = Path(__file__).with_name("fire_watch_sample.json")

HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


class BadRequest(ValueError):
    """Invalid query parameters (becomes a 400)."""


# ---- request parsing ---------------------------------------------------------


def _number(params, name, lo, hi):
    raw = params.get(name)
    if raw is None or str(raw).strip() == "":
        raise BadRequest(f"{name} is required (decimal degrees).")
    try:
        value = float(raw)
    except ValueError:
        raise BadRequest(f"{name} must be a number in decimal degrees.") from None
    if not math.isfinite(value) or not lo <= value <= hi:
        raise BadRequest(f"{name} must be between {lo} and {hi}.")
    return value


def parse_start(raw, now):
    """Local India time 'YYYY-MM-DDTHH:MM'. Default: the next full hour, IST."""
    if raw is None or str(raw).strip() == "":
        return now.astimezone(IST).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    text = str(raw).strip()
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=IST)
        except ValueError:
            continue
    raise BadRequest("start must look like 2026-10-10T14:00 (India time).")


def parse_hours(raw):
    if raw is None or str(raw).strip() == "":
        return 24
    try:
        hours = int(str(raw).strip())
    except ValueError:
        raise BadRequest("hours must be a whole number from 1 to 48.") from None
    if not 1 <= hours <= 48:
        raise BadRequest("hours must be a whole number from 1 to 48.")
    return hours


def parse_request(params, now=None):
    now = (now or datetime.now(IST)).astimezone(IST)
    lat = _number(params, "lat", -90, 90)
    lon = _number(params, "lon", -180, 180)
    start = parse_start(params.get("start"), now)
    hours = parse_hours(params.get("hours"))
    uncertainty = str(params.get("uncertainty") or "cone").strip().lower()
    if uncertainty not in ("cone", "ensemble"):
        raise BadRequest("uncertainty must be 'cone' or 'ensemble'.")
    origin = str(params.get("origin") or "field").strip().lower()
    if origin not in ("field", "fire"):
        raise BadRequest("origin must be 'field' or 'fire'.")
    today = now.date()
    if origin == "fire":
        # A fire already seen by satellite: start = the time it was seen, up to 3 days back.
        if not str(params.get("start") or "").strip():
            raise BadRequest("start is required for a fire: the time the satellite saw it.")
        if start.date() < today - timedelta(days=MAX_PAST_DAYS):
            raise BadRequest(f"The fire time must be within the last {MAX_PAST_DAYS} days.")
    elif start.date() < today:
        raise BadRequest("The burn time is in the past. The wind forecast starts today (India time).")
    if forecast_days_needed(start + timedelta(hours=hours), today) > MAX_FORECAST_DAYS:
        raise BadRequest(
            f"The burn time plus {hours} hours must fall within the next {MAX_FORECAST_DAYS} days "
            "(the length of the wind forecast)."
        )
    acres = _optional(params, "acres", 0.5, 100, 5.0)
    frp = _optional(params, "frp", 0.01, 5000, None)
    fire_type = str(params.get("fire_type") or "farm").strip().lower()
    if fire_type not in landuse.CATEGORIES:
        raise BadRequest("fire_type must be one of: " + ", ".join(landuse.CATEGORIES) + ".")
    return SmokeRequest(lat=lat, lon=lon, start=start, hours=hours, uncertainty=uncertainty, origin=origin,
                        acres=acres, frp=frp, fire_type=fire_type)


def _optional(params, name, lo, hi, default):
    raw = params.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        raise BadRequest(f"{name} must be a number.") from None
    if not math.isfinite(value) or not lo <= value <= hi:
        raise BadRequest(f"{name} must be between {lo:g} and {hi:g}.")
    return value


def _flag(raw):
    return str(raw or "").strip().lower() in ("1", "true", "yes")


# ---- in-memory cache (warm Lambdas reuse it) -----------------------------------


class ResponseCache:
    def __init__(self, ttl_s=CACHE_TTL_S, max_items=128, clock=time.monotonic):
        self.ttl_s = ttl_s
        self.max_items = max_items
        self._clock = clock
        self._items = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            expires, value = item
            if self._clock() >= expires:
                del self._items[key]
                return None
            return value

    def put(self, key, value):
        with self._lock:
            now = self._clock()
            for k in [k for k, (exp, _) in self._items.items() if exp <= now]:
                del self._items[k]
            while len(self._items) >= self.max_items:
                del self._items[next(iter(self._items))]  # oldest first
            self._items[key] = (now + self.ttl_s, value)


def cache_key(req, level):
    """lat/lon rounded to 0.01 (about 1 km), start time, hours, band type, origin and wind height."""
    return (
        round(req.lat, 2),
        round(req.lon, 2),
        req.start.isoformat(),
        req.hours,
        req.uncertainty,
        req.origin,
        req.acres,
        req.frp,
        req.fire_type,
        level,
    )


SHARED_KINDS = ("fires", "stations", "forecast")  # the slow answers: also kept in S3 for every Lambda copy
SHARED_MAX_AGE_S = 2 * 3600  # an S3 copy this old is still better than making a visitor wait ~25 s


class SharedCache(ResponseCache):
    """ResponseCache that also keeps /fires, /stations and /forecast in S3 (when CACHE_BUCKET is set).

    refresh=True ignores what is saved and fetches again (the scheduled warm call), then saves the new copy.
    """

    def __init__(self, *args, refresh=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.refresh = refresh

    @staticmethod
    def _name(key):
        return shared_cache.object_name("resp", *key) if key and key[0] in SHARED_KINDS and shared_cache.enabled() else None

    def get(self, key):
        if self.refresh:
            return None
        value = super().get(key)
        if value is None and self._name(key):
            raw = shared_cache.load(self._name(key), SHARED_MAX_AGE_S)
            if raw is not None:
                value = raw.decode("utf-8")
                super().put(key, value)
        return value

    def put(self, key, value):
        super().put(key, value)
        if self._name(key):
            shared_cache.save(self._name(key), value.encode("utf-8"))


CACHE = SharedCache()


# ---- responses ------------------------------------------------------------------


def _dump(doc):
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"))


def _response(status, body_text, gzip_ok=False):
    """API Gateway reply. Large bodies are gzipped (base64) when the client accepts gzip."""
    body_text = body_text if body_text is not None else ""
    headers = dict(HEADERS)
    if gzip_ok and len(body_text) >= GZIP_MIN_BYTES:
        packed = gzip.compress(body_text.encode("utf-8"), compresslevel=6)
        headers.update({"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
        return {
            "statusCode": status,
            "headers": headers,
            "body": base64.b64encode(packed).decode("ascii"),
            "isBase64Encoded": True,
        }
    return {"statusCode": status, "headers": headers, "body": body_text, "isBase64Encoded": False}


def _accepts_gzip(event):
    headers = event.get("headers") or {}
    value = next((v for k, v in headers.items() if str(k).lower() == "accept-encoding"), "")
    return "gzip" in str(value).lower()


def _error(status, message):
    return _response(status, _dump({"error": message}))


_sample_cache = {}


def load_sample_body(path=SAMPLE_PATH):
    """The saved demo response (built by scripts/save_fixtures.py) with sample=true.

    Raises FileNotFoundError if no sample has been saved yet.
    """
    path = Path(path)
    key = (str(path), path.stat().st_mtime_ns)
    if key not in _sample_cache:
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["sample"] = True
        _sample_cache.clear()
        _sample_cache[key] = _dump(doc)
    return _sample_cache[key]


def _method(event):
    http = (event.get("requestContext") or {}).get("http") or {}
    return (http.get("method") or event.get("httpMethod") or "GET").upper()


def _path(event):
    http = (event.get("requestContext") or {}).get("http") or {}
    return (event.get("rawPath") or http.get("path") or event.get("path") or "/smoke").rstrip("/")


def _body(event, limit=200_000):
    raw = event.get("body")
    if raw is None or str(raw).strip() == "":
        raise alerts.Invalid("Send a JSON body.")
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    if len(raw) > limit:
        raise alerts.Invalid("The request is too big.")
    try:
        return json.loads(raw)
    except ValueError:
        raise alerts.Invalid("The body is not valid JSON.") from None


def handle_alerts(event, method, path, params, store, now, notify):
    """POST /alerts, GET /alerts, GET /activity, GET /cases, PATCH /cases/<id>. None when the path is not one of them."""
    store = store or alerts.get_store()
    try:
        if path.endswith("/alerts") and method == "POST":
            who = alerts.require_authority(event)
            alert = alerts.create_alert(store, _body(event), who, now, notify if notify is not None else alerts.sns_notifier())
            return _response(201, _dump(alert))
        if path.endswith("/ack") and "/alerts/" in path and method == "POST":
            who = alerts.require_group(event, "farmer")
            alert_id = urllib.parse.unquote(path.rsplit("/alerts/", 1)[1].rsplit("/ack", 1)[0])
            return _response(200, _dump(alerts.acknowledge(store, alert_id, _body(event), who, now)))
        if path.endswith("/alerts") and method == "GET":
            lat = _number(params, "lat", -90, 90)
            lon = _number(params, "lon", -180, 180)
            radius = _optional(params, "radius_km", 1, 300, 15.0)
            if params.get("kind") == "farmer_warnings":
                found = alerts.warnings_near(store, lat, lon, radius)
                return _response(200, _dump({"lat": lat, "lon": lon, "radius_km": radius, "count": len(found), "alerts": found}))
            found = alerts.alerts_near(store, lat, lon, radius)
            return _response(200, _dump({"lat": lat, "lon": lon, "radius_km": radius, "count": len(found), "alerts": found}))
        if path.endswith("/activity") and method == "GET":
            alerts.require_authority(event)
            return _response(200, _dump({"alerts": store.list_alerts()}))
        if path.endswith("/cases") and method == "GET":
            alerts.require_authority(event)
            return _response(200, _dump({"cases": store.list_cases()}))
        if "/cases/" in path and method == "PATCH":
            who = alerts.require_authority(event)
            fire_id = urllib.parse.unquote(path.rsplit("/cases/", 1)[1])
            return _response(200, _dump(alerts.update_case(store, fire_id, _body(event), who, now)))
    except (alerts.Invalid, BadRequest) as err:
        return _error(400, str(err))
    except alerts.NotAllowed as err:
        return _error(403, str(err))
    except alerts.NotFound as err:
        return _error(404, str(err))
    except Exception:  # noqa: BLE001 - log it, never leak internals
        log.exception("alerts failed")
        return _error(500, "Something went wrong while saving the alert.")
    return None


def handle_farmer(event, path, now=None, opener=None):
    """POST /farmer/diagnose and POST /farmer/crop-advice: Gemini advice for farmers."""
    try:
        body = _body(event, limit=1_500_000)  # a photo the page has already shrunk
        call = {"/diagnose": gemini.diagnose, "/crop-advice": gemini.crop_advice, "/chat": gemini.chat, "/stubble-plan": gemini.stubble_plan, "/brief": gemini.farm_brief}[
            "/" + path.rsplit("/", 1)[1]]
        return _response(200, _dump(call(body, opener) if opener else call(body)))
    except (gemini.Invalid, alerts.Invalid, BadRequest) as err:
        return _error(400, str(err))
    except gemini.NotConfigured as err:
        return _error(503, str(err))
    except gemini.GeminiError as err:
        return _error(502, str(err))
    except Exception:  # noqa: BLE001 - log it, never leak internals
        log.exception("farmer advice failed")
        return _error(500, "Something went wrong while asking for advice.")


ALERT_PATHS = ("/alerts", "/activity", "/cases")


def handle(event, api=None, cache=None, now=None, sample_path=SAMPLE_PATH, fire_sample_path=FIRE_SAMPLE_PATH,
           store=None, notify=None):
    """The real handler, with hooks for tests (fake API, own cache, fixed clock, own store)."""
    cache = CACHE if cache is None else cache
    method = _method(event)
    if method == "OPTIONS":
        return _response(204, "")
    params = event.get("queryStringParameters") or {}
    path = _path(event)
    if path.endswith(ALERT_PATHS) or "/cases/" in path or ("/alerts/" in path and path.endswith("/ack")):
        reply = handle_alerts(event, method, path, params, store, now, notify)
        return reply if reply is not None else _error(405, "That method is not allowed here.")
    if method == "POST" and path.endswith(("/farmer/diagnose", "/farmer/crop-advice", "/farmer/chat", "/farmer/stubble-plan", "/farmer/brief")):
        return handle_farmer(event, path, now)
    if method != "GET":
        return _error(405, "Use GET.")
    gz = _accepts_gzip(event)
    if _path(event).endswith("/fires"):
        return handle_fires(params, api, cache, now, fire_sample_path, gz)
    if _path(event).endswith("/air"):
        return handle_air(params, api, cache, now, gz)
    if _path(event).endswith("/stations"):
        return handle_stations(cache, now, gz)
    if _path(event).endswith("/forecast"):
        return handle_forecast(api, cache, now, gz)

    if _flag(params.get("sample")):
        try:
            return _response(200, load_sample_body(sample_path), gz)
        except FileNotFoundError:
            return _error(404, "No sample saved yet. Run scripts/save_fixtures.py first.")

    now = (now or datetime.now(IST)).astimezone(IST)
    try:
        req = parse_request(params, now)
    except BadRequest as err:
        return _error(400, str(err))

    level = wind_level()
    key = cache_key(req, level)
    cached = cache.get(key)
    if cached is not None:
        return _response(200, cached, gz)

    try:
        result = run(req, api or LiveApi.from_env(), level=level, now=now)
    except OutsideForecast as err:
        return _error(400, str(err))
    except WindUnavailable as err:
        return _error(502, f"Wind forecast unavailable: {err}")
    except Exception:  # noqa: BLE001 - log it, never leak internals
        log.exception("smoke path failed")
        return _error(500, "Something went wrong while building the smoke path.")

    body = _dump(result.report)
    if result.cacheable:
        cache.put(key, body)
    return _response(200, body, gz)


def handle_fires(params, api, cache, now, sample_path, gz=False):
    """GET /fires: fire watch for the whole region."""
    if _flag(params.get("sample")):
        try:
            return _response(200, load_sample_body(sample_path), gz)
        except FileNotFoundError:
            return _error(404, "No fire watch sample saved yet. Run scripts/save_fire_watch_sample.py first.")
    try:
        req = firewatch.FireWatchRequest(hours=parse_hours(params.get("hours")))
    except BadRequest as err:
        return _error(400, str(err))
    level = wind_level()
    key = ("fires", req.hours, level)
    cached = cache.get(key)
    if cached is not None:
        return _response(200, cached, gz)
    try:
        result = firewatch.run(req, api or LiveApi.from_env(), level=level, now=now)
    except firewatch.NoFiresKey as err:
        return _error(503, str(err))
    except (firewatch.FiresUnavailable, WindUnavailable) as err:
        return _error(502, str(err) if isinstance(err, firewatch.FiresUnavailable) else f"Wind forecast unavailable: {err}")
    except Exception:  # noqa: BLE001 - log it, never leak internals
        log.exception("fire watch failed")
        return _error(500, "Something went wrong while building the fire watch.")
    body = _dump(result.report)
    if result.cacheable:
        cache.put(key, body)
    return _response(200, body, gz)


def handle_stations(cache, now, gz=False, live=None):
    """GET /stations: latest readings and AQI at every monitoring station (CPCB live feed)."""
    key = ("stations",)
    cached = cache.get(key)
    if cached is not None:
        return _response(200, cached, gz)
    try:
        doc, _ = (live or station_air.live)(now)
    except ApiError as err:
        return _error(502, str(err))
    except Exception:  # noqa: BLE001 - log it, never leak internals
        log.exception("stations failed")
        return _error(500, "Something went wrong while reading the monitoring stations.")
    body = _dump(doc)
    cache.put(key, body)  # also the OpenAQ fallback, so OpenAQ's rate limit is never hit
    return _response(200, body, gz)


def handle_air(params, api, cache, now, gz=False):
    """GET /air?lat&lon: the CAMS forecast at one spot, hourly for 48 hours, as India's AQI."""
    try:
        lat = _number(params, "lat", -90, 90)
        lon = _number(params, "lon", -180, 180)
    except BadRequest as err:
        return _error(400, str(err))
    key = ("air", round(lat, 2), round(lon, 2))
    cached = cache.get(key)
    if cached is not None:
        return _response(200, cached, gz)
    now = (now or datetime.now(IST)).astimezone(IST)
    try:
        grid = air.forecast_grid(api or LiveApi.from_env(), now)
    except air.AirUnavailable as err:
        return _error(502, f"Air quality forecast unavailable: {err}")
    outlook = air.outlook(grid, lat, lon, now)
    doc = {"lat": round(lat, 5), "lon": round(lon, 5), "source": "CAMS global forecast (ECMWF), via Open-Meteo",
           "generated_at": now.isoformat(timespec="minutes"), "now": outlook[0] if outlook else None,
           "worst": max(outlook, key=lambda a: a["aqi"]) if outlook else None, "outlook": outlook,
           "inside_region": grid.south <= lat <= grid.south + (grid.rows - 1) * grid.step
           and grid.west <= lon <= grid.west + (grid.cols - 1) * grid.step}
    body = _dump(doc)
    cache.put(key, body)
    return _response(200, body, gz)


def handle_forecast(api, cache, now, gz=False):
    """GET /forecast: CAMS AQI on the region grid, every 3 hours for 48 hours (the map layer)."""
    cached = cache.get(("forecast",))
    if cached is not None:
        return _response(200, cached, gz)
    now = (now or datetime.now(IST)).astimezone(IST)
    try:
        grid = air.forecast_grid(api or LiveApi.from_env(), now)
    except air.AirUnavailable as err:
        return _error(502, f"Air quality forecast unavailable: {err}")
    doc = dict(air.overlay(grid, now), source="CAMS global forecast (ECMWF), via Open-Meteo",
               generated_at=now.isoformat(timespec="minutes"))
    body = _dump(doc)
    cache.put(("forecast",), body)
    return _response(200, body, gz)


def warm(now=None):
    """Fetch /fires, /stations and /forecast again and save them (S3), so visitors get a ready answer.

    Called by the schedule (event {"warm": true}). Returns the status of each, for the logs.
    """
    fresh = SharedCache(refresh=True)
    out = {}
    for path in ("/forecast", "/stations", "/fires"):  # the air forecast first: it is the cheapest, fires the slowest
        ev = {"rawPath": path, "requestContext": {"http": {"method": "GET", "path": path}}, "queryStringParameters": {}}
        try:
            out[path] = handle(ev, cache=fresh, now=now)["statusCode"]
        except Exception:  # noqa: BLE001 - one failing source must not stop the others
            log.exception("warm %s failed", path)
            out[path] = 500
    log.info("warm: %s", out)
    return out


def lambda_handler(event, context=None):
    if isinstance(event, dict) and event.get("warm"):
        return warm()
    return handle(event)
