"""Local server routing, the saved samples, and the web app files. No network, no sockets."""

import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

from helpers import ROOT

sys.path.insert(0, str(ROOT / "scripts"))

import _env  # noqa: E402
import local_server  # noqa: E402
import save_fixtures  # noqa: E402

FRONT = ROOT / "frontend"
INDEX = (FRONT / "index.html").read_text(encoding="utf-8")
FIXTURE_SAMPLE = ROOT / "fixtures" / "sample_response.json"
PACKAGE_SAMPLE = ROOT / "src" / "smoke_path" / "sample_response.json"


class LocalServerTests(unittest.TestCase):
    def test_root_redirects_to_live_app(self):
        status, headers, _ = local_server.route("GET", "/")
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/index.html?api=/")

    def test_app_files_are_served_with_the_right_types(self):
        for path, kind in (("/index.html", "text/html"), ("/css/app.css", "text/css"), ("/js/app.js", "text/javascript"),
                           ("/data/sample-fires.js", "text/javascript")):
            status, headers, body = local_server.route("GET", path + "?api=/")
            self.assertEqual(status, 200, path)
            self.assertIn(kind, headers["Content-Type"])
            self.assertTrue(body)
        self.assertEqual(local_server.route("GET", "/map.html")[0], 200)  # the old address still works (it redirects)

    def test_smoke_goes_through_the_handler(self):
        status, headers, body = local_server.route("GET", "/smoke?lat=abc&lon=75")
        self.assertEqual(status, 400)  # rejected before any network call
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertIn("lat", json.loads(body)["error"])

    def test_alerts_and_cases_are_reachable_with_post_and_patch(self):
        body = json.dumps({"fire_id": "t_1", "kind": "public_alert", "message": "Smoke.", "language": "en",
                           "target": {"places": [{"name": "A", "lat": 30.0, "lon": 75.0}]}}).encode()
        status, _, out = local_server.route("POST", "/alerts", {}, body)
        self.assertEqual(status, 201, out)
        status, _, out = local_server.route("GET", "/alerts?lat=30.0&lon=75.0")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(json.loads(out)["count"], 1)
        status, _, out = local_server.route("PATCH", "/cases/t_1", {}, json.dumps({"note": "checked"}).encode())
        self.assertEqual(status, 200, out)
        self.assertEqual(local_server.route("DELETE", "/alerts")[0], 405)

    def test_pages_are_gzipped_when_asked(self):
        import gzip

        status, headers, body = local_server.route("GET", "/data/sample-fires.js", {"Accept-Encoding": "gzip"})
        self.assertEqual(headers["Content-Encoding"], "gzip")
        self.assertIn(b"PM_SAMPLE", gzip.decompress(body)[:200])
        status, headers, body = local_server.route("GET", "/smoke?sample=true", {"Accept-Encoding": "gzip"})
        self.assertEqual(status, 200)
        data = gzip.decompress(body) if headers.get("Content-Encoding") == "gzip" else body
        self.assertTrue(json.loads(data)["sample"])

    def test_unknown_path_and_no_way_out_of_the_frontend_folder(self):
        self.assertEqual(local_server.route("GET", "/secrets.env")[0], 404)
        for path in ("/../.env", "/..%2f.env", "/js/../../.env", "/../src/smoke_path/app.py"):
            self.assertEqual(local_server.route("GET", path)[0], 404, path)

    def test_event_shape(self):
        ev = local_server.make_event("GET", "/smoke", "lat=30.2&lon=75.8&x=1&x=2")
        self.assertEqual(ev["queryStringParameters"], {"lat": "30.2", "lon": "75.8", "x": "1,2"})
        self.assertEqual(ev["requestContext"]["http"]["method"], "GET")
        post = local_server.make_event("POST", "/alerts", "", None, b'{"a": 1}')
        self.assertEqual(post["body"], '{"a": 1}')


class SampleFileTests(unittest.TestCase):
    def test_saved_burn_sample_matches_in_package(self):
        if not FIXTURE_SAMPLE.exists():
            self.skipTest("no sample yet: run scripts/save_fixtures.py")
        fixture = json.loads(FIXTURE_SAMPLE.read_text(encoding="utf-8"))
        packaged = json.loads(PACKAGE_SAMPLE.read_text(encoding="utf-8"))
        self.assertEqual(fixture, packaged, "src/smoke_path/sample_response.json is out of date")
        kinds = {f["properties"]["kind"] for f in fixture["features"]}
        self.assertTrue({"field", "path", "puff"} <= kinds)
        self.assertEqual(fixture["label"], "Likely smoke direction")


COMPLETE = '{"elements": [{"type": "node", "id": 1, "lat": 30.3, "lon": 75.9, "tags": {"place": "village", "name": "A"}}]}'
CUT_SHORT = '{"elements": [], "remark": "runtime error: Query timed out in \\"query\\" at line 5"}'


def make_capture(folder, overpass, label):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "forecast_field.json").write_text(label)
    (folder / "forecast_multi.json").write_text(label)
    (folder / "overpass.json").write_text(overpass)
    (folder / "firms_VIIRS_SNPP_NRT.csv").write_text("latitude,longitude\n" + label)


class AdoptCaptureTests(unittest.TestCase):
    """A new capture must never make the saved sample worse."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.new, self.fix = root / "_new", root / "fixtures"
        self.meta = {"lat": 30.2, "lon": 75.8, "start": "2026-10-10T14:00+05:30", "hours": 24, "saved_at": "NEW"}
        self.ok_meta = dict(self.meta, places_checked=True)
        self.bad_meta = dict(self.meta, places_checked=False)

    def tearDown(self):
        self.tmp.cleanup()

    def old_capture(self, overpass):
        make_capture(self.fix, overpass, "old")
        (self.fix / "meta.json").write_text(json.dumps(dict(self.meta, saved_at="OLD")))

    def test_complete_new_capture_replaces_everything(self):
        self.old_capture(COMPLETE)
        make_capture(self.new, COMPLETE, "new")
        self.assertEqual(save_fixtures.adopt(self.new, self.fix, self.ok_meta), "all")
        self.assertEqual((self.fix / "forecast_field.json").read_text(), "new")
        self.assertEqual(json.loads((self.fix / "meta.json").read_text())["saved_at"], "NEW")

    def test_busy_osm_keeps_old_path_and_places_but_takes_new_fires(self):
        self.old_capture(COMPLETE)
        make_capture(self.new, CUT_SHORT, "new")
        self.assertEqual(save_fixtures.adopt(self.new, self.fix, self.bad_meta), "fires_only")
        self.assertEqual((self.fix / "forecast_field.json").read_text(), "old")
        self.assertEqual((self.fix / "overpass.json").read_text(), COMPLETE)
        self.assertTrue((self.fix / "firms_VIIRS_SNPP_NRT.csv").read_text().endswith("new"))
        meta = json.loads((self.fix / "meta.json").read_text())
        self.assertEqual((meta["saved_at"], meta["fires_saved_at"]), ("OLD", "NEW"))

    def test_old_meta_without_flag_falls_back_to_overpass_check(self):
        self.old_capture(COMPLETE)  # old meta has no places_checked: overpass.json decides (complete)
        make_capture(self.new, CUT_SHORT, "new")
        self.assertEqual(save_fixtures.adopt(self.new, self.fix, self.bad_meta), "fires_only")

    def test_snapshot_places_count_as_checked_without_overpass_file(self):
        self.old_capture(COMPLETE)
        make_capture(self.new, CUT_SHORT, "new")
        (self.new / "overpass.json").unlink()  # places came from the saved snapshot, no live reply
        self.assertEqual(save_fixtures.adopt(self.new, self.fix, self.ok_meta), "all")

    def test_no_good_old_capture_takes_the_new_one(self):
        make_capture(self.new, CUT_SHORT, "new")
        self.fix.mkdir()
        self.assertEqual(save_fixtures.adopt(self.new, self.fix, self.bad_meta), "all")
        self.assertEqual((self.fix / "forecast_field.json").read_text(), "new")
        self.assertFalse(save_fixtures.places_complete(self.fix))


class EnvFileTests(unittest.TestCase):
    def test_reads_values_and_never_overrides_the_shell(self):
        import os
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            env = Path(tmp) / ".env"
            env.write_text('# comment\nFIRMS_MAP_KEY="abc123"\nexport WIND_LEVEL=80m  # note\nOVERPASS_URL=from-file\nbad line\n')
            with mock.patch.dict(os.environ, {"OVERPASS_URL": "from-shell"}, clear=False):
                os.environ.pop("FIRMS_MAP_KEY", None)
                os.environ.pop("WIND_LEVEL", None)
                loaded = _env.load_env(env)
                self.assertEqual(sorted(loaded), ["FIRMS_MAP_KEY", "WIND_LEVEL"])
                self.assertEqual(os.environ["FIRMS_MAP_KEY"], "abc123")
                self.assertEqual(os.environ["WIND_LEVEL"], "80m")
                self.assertEqual(os.environ["OVERPASS_URL"], "from-shell")
            self.assertEqual(_env.load_env(Path(tmp) / "missing.env"), [])


def js_sample(name, key):
    """The object a sample script assigns to window.PM_SAMPLE.<key>."""
    text = (FRONT / "data" / name).read_text(encoding="utf-8")
    m = re.search(r"window\.PM_SAMPLE\." + key + r" = (.*?);\n", text, re.S)
    return json.loads(m.group(1))


class FireWatchSampleTests(unittest.TestCase):
    def test_fire_watch_sample_matches_everywhere(self):
        fixture_path = ROOT / "fixtures" / "fire_watch_sample.json"
        if not fixture_path.exists():
            self.skipTest("no fire watch sample yet: run scripts/save_fire_watch_sample.py")
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        packaged = json.loads((ROOT / "src" / "smoke_path" / "fire_watch_sample.json").read_text(encoding="utf-8"))
        self.assertEqual(fixture, packaged, "src/smoke_path/fire_watch_sample.json is out of date")
        self.assertEqual(fixture["view"], "fires")
        kinds = {f["properties"]["kind"] for f in fixture["features"]}
        self.assertTrue({"fire", "fire_path"} <= kinds)

    def test_app_sample_has_every_fire_with_key_and_state(self):
        doc = js_sample("sample-fires.js", "fires")
        fires = [f["properties"] for f in doc["features"] if f["properties"]["kind"] == "fire"]
        self.assertTrue(fires)
        self.assertEqual(len({p["key"] for p in fires}), len(fires), "fire keys must be unique")
        self.assertTrue(all(p.get("state") is not None for p in fires))
        fixture = json.loads((ROOT / "fixtures" / "fire_watch_sample.json").read_text(encoding="utf-8"))
        self.assertEqual(len(fires), fixture["stats"]["fires"], "frontend/data/sample-fires.js is out of date: run save_frontend_samples.py --offline")

    def test_app_air_sample_shapes(self):
        stations = js_sample("sample-air.js", "stations")
        self.assertTrue(stations["stations"] and {"id", "name", "lat", "lon", "aqi", "pollutants"} <= set(stations["stations"][0]))
        grid = js_sample("sample-air.js", "forecast")
        self.assertEqual(len(grid["aqi"]), len(grid["times"]))
        self.assertTrue(all(len(row) == grid["rows"] * grid["cols"] for row in grid["aqi"]))


KEY_CALL = re.compile(r"""\bt\(\s*["']([A-Za-z0-9_.]+)["']\s*[,)]""")  # a whole key, not a prefix like t("aqi." + k)


class WebAppFilesTests(unittest.TestCase):
    """The page is plain files: check they hang together, without a browser."""

    def sources(self):
        return {p.name: p.read_text(encoding="utf-8") for p in (FRONT / "js").glob("*.js")}

    def test_index_loads_every_script_in_order_and_each_exists(self):
        scripts = re.findall(r'<script src="([^"]+)"', INDEX)
        local = [s for s in scripts if not s.startswith("http")]
        for s in local:
            self.assertTrue((FRONT / s).exists(), s)
        self.assertEqual(local[0], "js/i18n.js")
        self.assertEqual(local[-1], "js/app.js")  # starts the app last
        self.assertLess(local.index("js/util.js"), local.index("js/store.js"))
        self.assertLess(local.index("js/api.js"), local.index("js/screens-authority.js"))
        self.assertEqual(sorted(p.name for p in (FRONT / "js").glob("*.js")), sorted(s.split("/")[1] for s in local if s.startswith("js/")))

    def test_libraries_come_from_cdnjs_with_exact_versions_and_the_cognito_block_is_empty(self):
        self.assertIn("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js", INDEX)
        self.assertIn("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css", INDEX)
        self.assertRegex(INDEX, r'cognito: \{ domain: "", clientId: ""')  # filled in by the owner, never committed with values

    def test_every_text_key_used_in_the_code_exists(self):
        en = self.i18n()["EN"]
        dynamic = {
            "aqi.": ("good", "satisfactory", "moderate", "poor", "very_poor", "severe"),
            "type.": ("farm", "industrial", "waste", "settlement", "forest", "grassland", "unknown"),
            "tox.": ("low", "moderate", "high", "very_high", "none"),
            "status.": ("new", "warning_sent", "acknowledged", "resolved", "dismissed"),
            "btn.status.": ("new", "warning_sent", "acknowledged", "resolved", "dismissed"),
            "kind.": ("source_warning", "public_alert"), "role.": ("farmer", "owner", "municipal", "other", "citizen_label", "farmer_label", "authority_label"),
            "grp.": ("village", "town", "school", "hospital"), "grp2.": ("children", "elderly", "asthma"),
            "login.title_": ("citizen", "farmer", "authority"), "login.continue_": ("citizen", "farmer", "authority"),
            "login.demo_text_": ("citizen", "farmer", "authority"), "fm.effort_": ("easy", "medium"), "sev.": ("low", "medium", "high"),
            "dir.": ("north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west", ""),
        }
        missing = []
        for name, text in self.sources().items():
            if name == "i18n.js":
                continue  # it defines t(); its own docs mention PM.t("key")
            for key in KEY_CALL.findall(text):
                if key not in en and key not in dynamic:
                    missing.append((name, key))
        for prefix, values in dynamic.items():
            missing += [prefix + v for v in values if prefix + v not in en]
        for k in ("good", "satisfactory", "moderate", "poor", "very_poor", "severe"):
            missing += [x for x in ("cz.say." + k, "tips." + k + ".who", "tips." + k + ".do") if x not in en]
            missing += ["cz.group." + g + "." + b for g in ("children", "elderly", "asthma") for b in ("ok", "care", "stay") if "cz.group." + g + "." + b not in en]
        self.assertEqual(sorted(set(map(str, missing))), [])

    def test_hindi_only_translates_keys_that_exist_and_keeps_placeholders(self):
        texts = self.i18n()
        for key, hi in texts["HI"].items():
            self.assertIn(key, texts["EN"], key)
            self.assertEqual(sorted(re.findall(r"\{(\w+)\}", hi)), sorted(re.findall(r"\{(\w+)\}", texts["EN"][key])), key)
        for key in ("cz.say.good", "cz.say.severe", "cz.smoke_title", "nav.home", "nav.alerts", "tips.severe.do"):
            self.assertIn(key, texts["HI"])  # the citizen home, alerts and tips are translated

    def i18n(self):
        """EN and HI objects, read with Node when it is there (the file is plain JavaScript)."""
        import shutil
        import subprocess

        node = shutil.which("node")
        if not node:
            self.skipTest("Node is not installed")
        code = "global.window={};require(process.argv[1]);process.stdout.write(JSON.stringify(window.PM.i18n))"
        out = subprocess.run([node, "-e", "global.window={};global.PM=window.PM={};" + open(FRONT / "js" / "i18n.js", encoding="utf-8").read() + ";process.stdout.write(JSON.stringify(PM.i18n))"],
                             capture_output=True, text=True, check=True).stdout
        return json.loads(out)

    def node(self, code):
        import shutil
        import subprocess

        node = shutil.which("node")
        if not node:
            self.skipTest("Node is not installed")
        return subprocess.run([node, "-e", "global.window={};global.PM=window.PM={};" + code], capture_output=True, text=True, check=True).stdout

    def test_farmer_calculator_gives_the_same_numbers_as_the_server_model(self):
        from smoke_path import emissions

        out = json.loads(self.node((FRONT / "js" / "emissions.js").read_text(encoding="utf-8") +
                                   ";process.stdout.write(JSON.stringify([2.5, 5, 40].map(a => PM.emissions.fromField(a))))"))
        for acres, js in zip((2.5, 5, 40), out):
            py = emissions.from_field(acres)
            self.assertEqual(js["burned_kg"], py["burned_kg"])
            self.assertEqual(set(js["kg"]), set(py["kg"]))
            for k, v in py["kg"].items():
                self.assertAlmostEqual(js["kg"][k], v, delta=max(0.011, abs(v) * 1e-4), msg=(acres, k))
            self.assertEqual(js["toxicity"]["level"], py["toxicity"]["level"].replace(" ", "_"))
            self.assertAlmostEqual(js["toxicity"]["km3"], py["toxicity"]["km3"], delta=0.002)
            self.assertEqual(js["toxicity"]["worst"], py["toxicity"]["worst"])

    def test_farm_reference_data_is_complete_in_both_languages(self):
        ref = json.loads(self.node((FRONT / "data" / "farm-ref.js").read_text(encoding="utf-8") + ";process.stdout.write(JSON.stringify(window.PM_FARM))"))
        symptoms = {s["id"] for s in ref["symptoms"]}
        for s in ref["symptoms"] + ref["soils"] + ref["irrigation"] + ref["crops"]:
            self.assertTrue(s["en"] and s["hi"], s["id"])
        for c in ref["crops"]:
            self.assertLessEqual(c["min"], c["max"])
            self.assertIn(c["season"], ("rabi", "kharif", "year"))
        self.assertEqual([s["upto"] for s in ref["stages"]], sorted(s["upto"] for s in ref["stages"]))
        self.assertEqual(ref["stages"][-1]["upto"], 1.0)
        for st in ref["stages"]:
            self.assertEqual(len(st["tasks"]["en"]), len(st["tasks"]["hi"]), st["id"])
        covered = set()
        for d in ref["diseases"]:
            self.assertTrue(set(d["symptoms"]) <= symptoms, d["id"])
            covered |= set(d["symptoms"])
            for part in ("name", "what", "organic", "cultural"):
                self.assertTrue(d[part]["en"] and d[part]["hi"], (d["id"], part))
            self.assertEqual(len(d["organic"]["en"]), len(d["organic"]["hi"]), d["id"])
            for c in d["chemical"]:
                self.assertTrue(c["dose"]["hi"] and c["freq"]["hi"], d["id"])
        self.assertEqual(covered, symptoms)  # every symptom a farmer can tick leads somewhere
        for a in ref["alternatives"]:
            for part in ("what", "cost", "gain", "time", "scheme"):
                self.assertTrue(a[part]["en"] and a[part]["hi"], (a["id"], part))
            self.assertIn(a["effort"], ("easy", "medium"))

    def test_the_landing_page_offers_three_logins_and_each_has_routes(self):
        app = (FRONT / "js" / "app.js").read_text(encoding="utf-8")
        for role in ("farmer", "citizen", "authority"):
            self.assertIn('href="#/login/' + role + '"', app)
        for route in ("farmer/setup", "farmer/home", "farmer/crops", "farmer/doctor", "farmer/stubble", "farmer/pledge", "farmer/alerts"):
            self.assertIn('["' + route + '"', app)
        self.assertLess(app.index('href="#/login/farmer"'), app.index('href="#/login/citizen"'))  # farmer first, as asked
        self.assertNotIn("farmer/map", app)  # no map, forecast or air quality for farmers
        self.assertNotIn("farmer/forecast", app)
        farmer = (FRONT / "js" / "screens-farmer.js").read_text(encoding="utf-8")
        for word in ("PM.air", "api.stations", "api.spot", "api.forecast", "maps.create"):
            if word == "maps.create":
                continue  # the farm location picker draws a small map to tap on
            self.assertNotIn(word, farmer, word)

    def test_demo_contacts_are_obviously_fake(self):
        text = (FRONT / "data" / "registry.js").read_text(encoding="utf-8")
        for phone in re.findall(r'contact: "(\+[^"]+)"', text):
            self.assertTrue(phone.startswith("+91-00000-"), phone)
        for email in re.findall(r'contact: "([^"@+]+@[^"]+)"', text):
            self.assertTrue(email.endswith("@example.com"), email)
        self.assertIn("Demo", text)

    def test_user_text_only_reaches_html_through_esc(self):
        for name, text in self.sources().items():
            self.assertNotIn("eval(", text, name)
            self.assertNotIn("document.write", text, name)
        self.assertIn("U.esc = function", (FRONT / "js" / "util.js").read_text(encoding="utf-8"))

    def test_old_map_page_redirects_and_keeps_the_query(self):
        old = (FRONT / "map.html").read_text(encoding="utf-8")
        self.assertIn('window.location.replace("index.html" + window.location.search', old)

    def test_aqi_colours_are_the_official_cpcb_ones(self):
        css = (FRONT / "css" / "app.css").read_text(encoding="utf-8")
        for name, hex_ in (("good", "00b050"), ("satisfactory", "92d050"), ("moderate", "ffff00"), ("poor", "ff9900"), ("very_poor", "ff0000"), ("severe", "c00000")):
            self.assertRegex(css, r"--aqi-" + name + r":\s*#" + hex_)
