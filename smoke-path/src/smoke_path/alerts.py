"""Warnings and alerts sent by authorities, and the case of each fire.

Two kinds of message:
  source_warning  to the person behind a fire (farmer, factory or kiln owner, municipal body)
  public_alert    to the people in the places the smoke will reach (shown in the citizen inbox)

Every fire that gets an action becomes a case: new -> warning_sent -> acknowledged -> resolved
(or dismissed, with a reason), with a timeline of what was done.

Where it is saved:
  - on your computer and in tests: in memory (MemoryStore), lost when the server stops;
  - on AWS: one DynamoDB table (DynamoStore), chosen when ALERTS_TABLE is set.

How people are told: the in-app inbox always. An email through Amazon SNS is optional (ALERTS_SNS_TOPIC).
SMS in India needs DLT registration, so it is not used.

Farmers: they read the warnings sent to farmers about fires near their farm and can acknowledge one
(case: warning_sent -> acknowledged).

Who may act: with REQUIRE_AUTHORITY=true the caller must be in the Cognito group "authority"
(API Gateway checks the token, this code checks the group); acknowledging needs "farmer" (or "authority").
Otherwise anyone may (local demo).
"""

import json
import logging
import math
import os
import re
import threading
import uuid
from datetime import datetime

from . import IST
from .trajectory import KM_PER_DEG

log = logging.getLogger(__name__)

KINDS = ("source_warning", "public_alert")
LANGUAGES = ("en", "hi")
STATUSES = ("new", "warning_sent", "acknowledged", "resolved", "dismissed")
NEXT_STATUS = {
    "new": ("warning_sent", "resolved", "dismissed"),
    "warning_sent": ("acknowledged", "resolved", "dismissed"),
    "acknowledged": ("resolved", "dismissed"),
    "resolved": ("new",),  # reopen
    "dismissed": ("new",),
}
SOURCE_ROLES = ("farmer", "owner", "municipal", "other")
ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
MAX_MESSAGE = 1200
MAX_PLACES = 300
MAX_ALERTS_RETURNED = 50
MAX_TIMELINE = 100


class Invalid(ValueError):
    """The request is not valid (becomes a 400)."""


class NotAllowed(Exception):
    """The caller may not do this (becomes a 403)."""


class NotFound(Exception):
    """No such case (becomes a 404)."""


# ---- storage ----------------------------------------------------------------------------------------


class MemoryStore:
    """Alerts and cases in memory. One per process; fine for local runs and tests."""

    def __init__(self):
        self._alerts, self._cases = [], {}
        self._lock = threading.Lock()

    def add_alert(self, alert):
        with self._lock:
            self._alerts.append(alert)

    def list_alerts(self):
        with self._lock:
            return sorted(self._alerts, key=lambda a: a["created_at"], reverse=True)

    def get_case(self, fire_id):
        with self._lock:
            c = self._cases.get(fire_id)
            return json.loads(json.dumps(c)) if c else None

    def put_case(self, case):
        with self._lock:
            self._cases[case["fire_id"]] = json.loads(json.dumps(case))

    def list_cases(self):
        with self._lock:
            return sorted((json.loads(json.dumps(c)) for c in self._cases.values()), key=lambda c: c["updated_at"], reverse=True)


class DynamoStore:
    """The same, in one DynamoDB table with keys pk and sk; the record itself is one JSON text in `data`
    (so there are no number-type surprises). `table` is a boto3 Table (or anything with the same methods)."""

    def __init__(self, table):
        self.table = table

    def add_alert(self, alert):
        self.table.put_item(Item={"pk": "ALERT", "sk": f"{alert['created_at']}#{alert['id']}", "data": json.dumps(alert)})

    def _query(self, pk):
        items, kwargs = [], {"KeyConditionExpression": _key("pk").eq(pk)}
        while True:
            page = self.table.query(**kwargs)
            items.extend(json.loads(i["data"]) for i in page.get("Items", []))
            if not page.get("LastEvaluatedKey"):
                return items
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def list_alerts(self):
        return sorted(self._query("ALERT"), key=lambda a: a["created_at"], reverse=True)

    def get_case(self, fire_id):
        item = self.table.get_item(Key={"pk": "CASE", "sk": fire_id}).get("Item")
        return json.loads(item["data"]) if item else None

    def put_case(self, case):
        self.table.put_item(Item={"pk": "CASE", "sk": case["fire_id"], "data": json.dumps(case)})

    def list_cases(self):
        return sorted(self._query("CASE"), key=lambda c: c["updated_at"], reverse=True)


def _key(name):
    from boto3.dynamodb.conditions import Key  # only on AWS (boto3 comes with the Lambda runtime)

    return Key(name)


_default = {}


def get_store():
    """The store for this process: DynamoDB when ALERTS_TABLE is set, else memory."""
    if "store" not in _default:
        table_name = os.environ.get("ALERTS_TABLE", "").strip()
        if table_name:
            import boto3  # noqa: PLC0415 - only on AWS

            _default["store"] = DynamoStore(boto3.resource("dynamodb").Table(table_name))
        else:
            _default["store"] = MemoryStore()
    return _default["store"]


# ---- who is calling ---------------------------------------------------------------------------------


def _groups(claims):
    raw = (claims or {}).get("cognito:groups", "")
    if isinstance(raw, list):
        return [str(g) for g in raw]
    return [g for g in re.split(r"[\s,\[\]]+", str(raw)) if g]


def caller(event):
    """{'email', 'groups'} from the token claims API Gateway verified (empty when there are none)."""
    claims = (((event.get("requestContext") or {}).get("authorizer") or {}).get("jwt") or {}).get("claims") or {}
    return {"email": str(claims.get("email") or claims.get("username") or ""), "groups": _groups(claims), "signed_in": bool(claims)}


def require_authority(event, env=None):
    """Raises NotAllowed unless the caller is an authority (only checked when REQUIRE_AUTHORITY is on)."""
    env = os.environ if env is None else env
    who = caller(event)
    if str(env.get("REQUIRE_AUTHORITY", "")).strip().lower() in ("1", "true", "yes"):
        if not who["signed_in"]:
            raise NotAllowed("Sign in as an authority to do this.")
        if "authority" not in who["groups"]:
            raise NotAllowed("Only authorities can do this.")
    return who


def require_group(event, group, env=None):
    """Raises NotAllowed unless the caller is in `group` or is an authority (only checked when REQUIRE_AUTHORITY is on)."""
    env = os.environ if env is None else env
    who = caller(event)
    if str(env.get("REQUIRE_AUTHORITY", "")).strip().lower() in ("1", "true", "yes"):
        if not who["signed_in"]:
            raise NotAllowed(f"Sign in as a {group} to do this.")
        if group not in who["groups"] and "authority" not in who["groups"]:
            raise NotAllowed(f"Only a {group} can do this.")
    return who


# ---- checks -----------------------------------------------------------------------------------------


def _text(body, name, max_len, required=True):
    value = body.get(name)
    if value is None or str(value).strip() == "":
        if required:
            raise Invalid(f"{name} is required.")
        return ""
    value = str(value).strip()
    if len(value) > max_len:
        raise Invalid(f"{name} is too long (at most {max_len} characters).")
    return value


def _number(x, name, lo, hi):
    try:
        v = float(x)
    except (TypeError, ValueError):
        raise Invalid(f"{name} must be a number.") from None
    if not math.isfinite(v) or not lo <= v <= hi:
        raise Invalid(f"{name} must be between {lo:g} and {hi:g}.")
    return v


def _fire_id(body):
    fid = _text(body, "fire_id", 80)
    if not ID_RE.match(fid):
        raise Invalid("fire_id may only hold letters, digits and . _ : -")
    return fid


def _context(body):
    """What the page knows about the fire (shown in the case list). Only a few short, known fields."""
    ctx = body.get("fire") or {}
    if not isinstance(ctx, dict):
        raise Invalid("fire must be an object.")
    out = {}
    for k in ("near", "state", "type", "type_label", "level"):
        if ctx.get(k) is not None:
            out[k] = str(ctx[k])[:80]
    for k, lo, hi in (("lat", -90, 90), ("lon", -180, 180), ("km3", 0, 1e6)):
        if ctx.get(k) is not None:
            out[k] = _number(ctx[k], k, lo, hi)
    return out


def _target_source(raw):
    if not isinstance(raw, dict):
        raise Invalid("target must describe who is warned: name, contact and role.")
    role = str(raw.get("role") or "other").lower()
    if role not in SOURCE_ROLES:
        raise Invalid("role must be one of: " + ", ".join(SOURCE_ROLES) + ".")
    return {"name": _text(raw, "name", 100), "contact": _text(raw, "contact", 120), "role": role, "demo": bool(raw.get("demo"))}


def _target_public(raw):
    places = raw.get("places") if isinstance(raw, dict) else None
    if not isinstance(places, list) or not places:
        raise Invalid("target.places must list at least one place.")
    if len(places) > MAX_PLACES:
        raise Invalid(f"target.places may hold at most {MAX_PLACES} places.")
    out = []
    for p in places:
        if not isinstance(p, dict):
            raise Invalid("each place must be an object with name, lat and lon.")
        out.append({"name": _text(p, "name", 100), "lat": round(_number(p.get("lat"), "lat", -90, 90), 5),
                    "lon": round(_number(p.get("lon"), "lon", -180, 180), 5), "place_type": str(p.get("place_type") or "")[:20],
                    **({"arrival": str(p["arrival"])[:40]} if p.get("arrival") else {})})
    return {"places": out}


def _now(now):
    return (now or datetime.now(IST)).astimezone(IST)


def _event(now, kind, text, by):
    return {"t": _now(now).isoformat(timespec="seconds"), "event": kind, "text": text[:300], "by": by}


def _new_case(fire_id, ctx, now):
    t = _now(now).isoformat(timespec="seconds")
    return {"fire_id": fire_id, "status": "new", "created_at": t, "updated_at": t, "fire": ctx, "timeline": []}


def _push(case, ev):
    case["timeline"] = (case["timeline"] + [ev])[-MAX_TIMELINE:]
    case["updated_at"] = ev["t"]


# ---- the actions ------------------------------------------------------------------------------------


def create_alert(store, body, who, now=None, notify=None):
    """Save an alert and update the fire's case. Returns the alert."""
    if not isinstance(body, dict):
        raise Invalid("Send a JSON object.")
    fire_id = _fire_id(body)
    kind = str(body.get("kind") or "")
    if kind not in KINDS:
        raise Invalid("kind must be source_warning or public_alert.")
    language = str(body.get("language") or "en").lower()
    if language not in LANGUAGES:
        raise Invalid("language must be one of: " + ", ".join(LANGUAGES) + ".")
    message = _text(body, "message", MAX_MESSAGE)
    target = _target_source(body.get("target")) if kind == "source_warning" else _target_public(body.get("target"))
    ctx = _context(body)
    now = _now(now)
    by = who.get("email") or "authority (no sign-in)"
    alert = {"id": uuid.uuid4().hex[:12], "fire_id": fire_id, "kind": kind, "target": target, "message": message,
             "language": language, "created_at": now.isoformat(timespec="seconds"), "sent_by": by, "fire": ctx,
             "delivery": ["in-app"]}
    if notify:
        try:
            if notify(alert):
                alert["delivery"].append("email")
        except Exception as err:  # noqa: BLE001 - the inbox copy is what matters; never fail the request on email
            log.warning("email delivery failed: %s", err)
    store.add_alert(alert)

    case = store.get_case(fire_id) or _new_case(fire_id, ctx, now)
    if ctx and not case.get("fire"):
        case["fire"] = ctx
    if kind == "source_warning":
        who_text = f"{target['name']} ({target['role']})"
        _push(case, _event(now, "source_warning", f"Warning sent to {who_text}", by))
        if case["status"] == "new":
            case["status"] = "warning_sent"
    else:
        n = len(target["places"])
        _push(case, _event(now, "public_alert", f"Alert sent to people in {n} place{'s' if n != 1 else ''}", by))
    store.put_case(case)
    return alert


def alerts_near(store, lat, lon, radius_km):
    """Public alerts with a place within radius_km of (lat, lon), newest first, with the nearest distance."""
    out = []
    coslat = math.cos(math.radians(lat))
    for a in store.list_alerts():
        if a["kind"] != "public_alert":
            continue
        best = min(math.hypot((p["lat"] - lat) * KM_PER_DEG, (p["lon"] - lon) * KM_PER_DEG * coslat) for p in a["target"]["places"])
        if best <= radius_km:
            out.append({**{k: v for k, v in a.items() if k not in ("sent_by", "delivery")}, "distance_km": round(best, 1)})
        if len(out) >= MAX_ALERTS_RETURNED:
            break
    return out


def warnings_near(store, lat, lon, radius_km):
    """Warnings sent to farmers about a fire within radius_km of (lat, lon), newest first.

    The contact (phone or email) is left out: this list is read by farmers, not only by the person warned.
    """
    out = []
    coslat = math.cos(math.radians(lat))
    for a in store.list_alerts():
        fire = a.get("fire") or {}
        if a["kind"] != "source_warning" or a["target"].get("role") != "farmer" or "lat" not in fire or "lon" not in fire:
            continue
        d = math.hypot((fire["lat"] - lat) * KM_PER_DEG, (fire["lon"] - lon) * KM_PER_DEG * coslat)
        if d <= radius_km:
            case = store.get_case(a["fire_id"]) or {}
            out.append({**{k: v for k, v in a.items() if k not in ("sent_by", "delivery", "target")},
                        "target": {"name": a["target"]["name"], "role": "farmer"},
                        "distance_km": round(d, 1), "case_status": case.get("status", "warning_sent")})
        if len(out) >= MAX_ALERTS_RETURNED:
            break
    return out


def acknowledge(store, alert_id, body, who, now=None):
    """A farmer confirms they read a warning: the fire's case becomes 'acknowledged'. Returns the case."""
    if not isinstance(body, dict):
        raise Invalid("Send a JSON object.")
    name = _text(body, "name", 100)
    alert = next((a for a in store.list_alerts() if a["id"] == alert_id and a["kind"] == "source_warning"), None)
    if alert is None:
        raise NotFound("That warning was not found.")
    case = store.get_case(alert["fire_id"]) or _new_case(alert["fire_id"], alert.get("fire") or {}, now)
    if case["status"] in ("new", "warning_sent"):
        who_text = who.get("email") or name
        _push(case, _event(now, "status", f"Status: {case['status']} → acknowledged. Read by {name} (farmer)", who_text))
        case["status"] = "acknowledged"
        store.put_case(case)
    return case


def update_case(store, fire_id, body, who, now=None):
    """Change a case's status (with a note) or add a note. Returns the case."""
    if not ID_RE.match(fire_id or ""):
        raise Invalid("fire_id may only hold letters, digits and . _ : -")
    if not isinstance(body, dict):
        raise Invalid("Send a JSON object.")
    now = _now(now)
    by = who.get("email") or "authority (no sign-in)"
    case = store.get_case(fire_id)
    ctx = _context(body)
    if case is None:
        case = _new_case(fire_id, ctx, now)
    note = _text(body, "note", 300, required=False)
    status = body.get("status")
    if status is not None:
        if status not in STATUSES:
            raise Invalid("status must be one of: " + ", ".join(STATUSES) + ".")
        if status != case["status"]:
            if status not in NEXT_STATUS[case["status"]]:
                raise Invalid(f"A case that is {case['status']} cannot become {status}.")
            if status == "dismissed" and not note:
                raise Invalid("Say why the fire is dismissed (note).")
            _push(case, _event(now, "status", f"Status: {case['status']} → {status}" + (f". {note}" if note else ""), by))
            case["status"] = status
    elif note:
        _push(case, _event(now, "note", note, by))
    else:
        raise Invalid("Send a status or a note.")
    if ctx and not case.get("fire"):
        case["fire"] = ctx
    store.put_case(case)
    return case


def sns_notifier(env=None):
    """A function that emails an alert through Amazon SNS, or None when ALERTS_SNS_TOPIC is not set."""
    env = os.environ if env is None else env
    topic = str(env.get("ALERTS_SNS_TOPIC", "")).strip()
    if not topic:
        return None

    def notify(alert):
        import boto3  # noqa: PLC0415 - only on AWS

        who = alert["target"]["name"] if alert["kind"] == "source_warning" else f"{len(alert['target']['places'])} places"
        boto3.client("sns").publish(TopicArn=topic, Subject=f"VayuRahshak: {alert['kind'].replace('_', ' ')}"[:100],
                                    Message=f"To: {who}\n\n{alert['message']}")
        return True

    return notify
