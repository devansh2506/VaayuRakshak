/* One place that gets data. With ?api= it asks the server; without it (or if the server fails for fires) it uses
   the saved sample that ships with the app, so the demo works with no server and no internet except tiles and fonts.
   Screens never care which one they got: they only read PM.api.badge() to say "Live" or "Saved sample". */
(function (PM) {
  "use strict";
  var U = PM.U;
  var SAMPLE = function () { return window.PM_SAMPLE || {}; };
  // src = where each kind of data really came from: {kind: "live" | "sample", at: when the data was made (ms), why: text if it fell back}
  var state = { mode: PM.config.live ? "live" : "sample", fell: null, cache: {}, model: null, updated: null, src: {} };
  function mark(name, kind, doc, why) {
    var at = doc && Date.parse(doc.generated_at);
    state.src[name] = { kind: kind, at: isNaN(at) ? null : at, why: why || "" };
    if (PM.updateBadge) PM.updateBadge();
  }
  /** Ask the server; if it cannot be reached, use the saved sample and remember that, so the badge tells the truth. */
  async function liveOrSample(name, path) {
    var sample = SAMPLE()[name];
    if (state.mode === "live") {
      try { var doc = await request("GET", path); mark(name, "live", doc); return doc; }
      catch (e) {
        if (!sample) throw e;
        mark(name, "sample", sample, e.message);
        return sample;
      }
    }
    if (!sample) throw new Error("No saved sample is available.");
    mark(name, "sample", sample);
    return sample;
  }
  var TTL = { fires: 10 * 60e3, stations: 10 * 60e3, forecast: 30 * 60e3 };

  function authHeaders() {
    var s = PM.store.session();
    return s && s.token ? { Authorization: "Bearer " + s.token } : {};
  }

  async function request(method, path, body) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 45000);
    try {
      var resp = await fetch(PM.config.api + path, {
        method: method, signal: ctrl.signal,
        headers: Object.assign({}, body ? { "Content-Type": "application/json" } : {}, authHeaders()),
        body: body ? JSON.stringify(body) : undefined,
      });
      var doc = null;
      try { doc = await resp.json(); } catch (e) { doc = null; }
      if (!resp.ok) throw new Error((doc && doc.error) || "The server answered " + resp.status + ".");
      return doc;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("The server took too long.");
      if (e instanceof TypeError) throw new Error("Could not reach the server.");
      throw e;
    } finally { clearTimeout(timer); }
  }

  function cached(name, make) {
    var hit = state.cache[name];
    if (hit && Date.now() - hit.at < (TTL[name] || 0)) return Promise.resolve(hit.value);
    return make().then(function (value) { state.cache[name] = { at: Date.now(), value: value }; return value; });
  }

  // ---- what the fire doc becomes: one object per fire, with its path ---------------------------------------
  function buildModel(doc) {
    var fires = [], paths = {}, reached = [];
    (doc.features || []).forEach(function (f) {
      var p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
      if (p.kind === "fire") fires.push({ p: p, lat: c[1], lon: c[0] });
      else if (p.kind === "fire_path") paths[p.fire_id] = { coords: c, times: p.times.map(Date.parse), km: p.km };
      else if (p.kind === "reached") reached.push({ name: p.name, name_local: p.name_local, type: p.place_type, lat: c[1], lon: c[0], near_town: p.near_town, fires: p.fires });
    });
    PM.industryBox = doc.industry_box || null;
    var nowMs = Date.parse(doc.generated_at) || Date.now();
    fires.forEach(function (f) {
      var p = f.p, tox = p.emissions && p.emissions.toxicity;
      f.id = p.id; f.key = p.key || p.id; f.state = p.state || ""; f.near = p.near || "";
      f.path = paths[p.id] || null; f.seenMs = Date.parse(p.seen_at); f.tox = tox || null;
      f.km3 = tox ? tox.km3 : null; f.level = tox ? tox.level : null;
    });
    var byKey = {};
    fires.forEach(function (f) { byKey[f.key] = f; });
    var placeCache = {};
    var model = {
      doc: doc, fires: fires, byKey: byKey, reached: reached, nowMs: nowMs, generated: nowMs,
      /** Places on a fire's smoke path, earliest first: [{name, type, lat, lon, t}] (same rule as the server). */
      placesOn: function (fire) {
        if (!fire.path) return [];
        if (placeCache[fire.key]) return placeCache[fire.key];
        var out = [];
        reached.forEach(function (q) {
          var hit = U.reaches(fire.path, q.lat, q.lon, U.REACH_KM[q.type] || 5);
          if (hit) out.push({ name: q.name, type: q.type, lat: q.lat, lon: q.lon, t: hit.t });
        });
        out.sort(function (a, b) { return a.t - b.t; });
        return (placeCache[fire.key] = out);
      },
      /** Fires whose smoke path will pass within maxKm of a spot: [{fire, t, d}], soonest first. */
      firesReaching: function (lat, lon, maxKm) {
        var out = [];
        fires.forEach(function (f) {
          if (!f.path) return;
          var hit = U.reaches(f.path, lat, lon, maxKm || 5);
          if (hit) out.push({ fire: f, t: hit.t, d: hit.d });
        });
        return out.sort(function (a, b) { return a.t - b.t; });
      },
      firesNear: function (lat, lon, km) {
        return fires.map(function (f) { return { fire: f, d: U.distKm(lat, lon, f.lat, f.lon) }; })
          .filter(function (x) { return x.d <= km; }).sort(function (a, b) { return a.d - b.d; });
      },
    };
    return model;
  }

  // ---- the data screens read --------------------------------------------------------------------------------------
  /** An AI call. Live site only: the demo has no server to ask. */
  function ai(path, body) {
    if (state.mode !== "live") return Promise.reject(new Error("demo"));
    return request("POST", path, body);
  }

  var api = (PM.api = {
    mode: function () { return state.mode; },
    fellBack: function () { return state.fell; },
    /** {kind: 'live'|'sample', text}: what to show in the corner badge. */
    badge: function () {
      var names = Object.keys(state.src), live = names.filter(function (n) { return state.src[n].kind === "live"; });
      var fires = state.src.fires, sample = SAMPLE().fires;
      var at = (fires && fires.at) || (names.map(function (n) { return state.src[n].at; }).filter(Boolean).sort()[0]) || null;
      var lines = names.map(function (n) {
        var x = state.src[n], when = x.at ? U.when(x.at, x.at) : "";
        return PM.t("badge.src_" + n) + ": " + (x.kind === "live" ? PM.t("badge.src_live", { time: when }) : PM.t("badge.src_sample", { time: when })) + (x.why ? " (" + x.why + ")" : "");
      });
      var title = lines.join("\n");
      if (names.length && live.length === names.length) return { kind: "live", title: title, text: PM.t("badge.live", { time: U.halfHour(Date.now()) }) };
      if (live.length) return { kind: "mixed", title: title, text: PM.t("badge.mixed") };
      var gen = at || (sample && Date.parse(sample.generated_at)) || null;
      return { kind: "sample", title: title, text: PM.t("badge.sample", { time: gen ? U.when(gen, gen) : "" }) };
    },

    fires: function () {
      return cached("fires", async function () {
        var doc = null;
        if (state.mode === "live") {
          try { doc = await request("GET", "/fires"); state.updated = Date.now(); }
          catch (e) {
            if (!SAMPLE().fires) throw e;
            state.mode = "sample"; state.fell = e.message;  // the whole app now shows the saved sample, and says so
          }
        }
        if (doc) mark("fires", "live", doc);
        else {
          doc = SAMPLE().fires;
          if (!doc) throw new Error("No saved sample is available.");
          mark("fires", "sample", doc, state.fell);
        }
        state.model = buildModel(doc);
        if (state.mode === "sample") PM.setSampleNow(state.model.nowMs);
        if (PM.updateBadge) PM.updateBadge();
        return state.model;
      });
    },
    stations: function () {
      return cached("stations", function () { return liveOrSample("stations", "/stations"); });
    },
    forecast: function () {
      return cached("forecast", function () { return liveOrSample("forecast", "/forecast"); });
    },
    /** The 48 hour outlook at a spot: [{t (ms), aqi, ...}]. From the server, or read off the saved forecast grid. */
    spot: async function (lat, lon) {
      if (state.mode === "live") {
        try {
          var d = await request("GET", "/air?lat=" + lat.toFixed(4) + "&lon=" + lon.toFixed(4));
          return { outlook: (d.outlook || []).map(function (o) { return Object.assign({}, o, { ms: Date.parse(o.t) }); }), source: d.source, approx: false };
        } catch (e) { /* fall through to the forecast map below, which says whether it is live or saved */ }
      }
      var g = await api.forecast();
      return { outlook: PM.gridOutlook(g, lat, lon), source: g.source, approx: true };
    },

    // ---- alerts and cases ----
    alertsNear: async function (home) {
      if (!home) return [];
      if (state.mode === "live") {
        var d = await request("GET", "/alerts?lat=" + home.lat.toFixed(4) + "&lon=" + home.lon.toFixed(4) + "&radius_km=15");
        return d.alerts || [];
      }
      return PM.local.alertsNear(home.lat, home.lon, 15);
    },
    /** Returns {alert, sent: 'sent' | 'sent_demo'} */
    sendAlert: async function (body) {
      if (state.mode === "live") return { alert: await request("POST", "/alerts", body), sent: "sent" };
      var s = PM.store.session();
      return { alert: PM.local.createAlert(body, s && s.name), sent: "sent_demo" };
    },
    /** Warnings sent to farmers about fires near the farm (no phone numbers or emails in them). */
    farmerWarnings: async function (farm) {
      if (!farm) return [];
      if (state.mode === "live") {
        var d = await request("GET", "/alerts?lat=" + farm.lat.toFixed(4) + "&lon=" + farm.lon.toFixed(4) + "&radius_km=25&kind=farmer_warnings");
        return d.alerts || [];
      }
      return PM.local.warningsNear(farm.lat, farm.lon, 25);
    },
    ackWarning: async function (id, name) {
      if (state.mode === "live") return request("POST", "/alerts/" + encodeURIComponent(id) + "/ack", { name: name });
      return PM.local.ack(id, name);
    },
    /** Gemini looks at a plant photo and the ticked symptoms. Live site only: the demo has no server to ask. */
    farmerChat: function (body) { return ai("/farmer/chat", body); },
    farmerPlan: function (body) { return ai("/farmer/stubble-plan", body); },
    farmerBrief: function (body) { return ai("/farmer/brief", body); },
    farmerDiagnose: function (body) {
      if (state.mode !== "live") return Promise.reject(new Error("demo"));
      return request("POST", "/farmer/diagnose", body);
    },
    farmerAdvice: function (body) {
      if (state.mode !== "live") return Promise.reject(new Error("demo"));
      return request("POST", "/farmer/crop-advice", body);
    },
    cases: async function () {
      if (state.mode === "live") return (await request("GET", "/cases")).cases || [];
      var c = PM.local.cases();
      return Object.keys(c).map(function (k) { return c[k]; }).sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; });
    },
    patchCase: async function (id, body) {
      if (state.mode === "live") return request("PATCH", "/cases/" + encodeURIComponent(id), body);
      var s = PM.store.session();
      return PM.local.updateCase(id, body, s && s.name);
    },
    activity: async function () {
      if (state.mode === "live") return (await request("GET", "/activity")).alerts || [];
      return PM.local.alerts();
    },
    refresh: function () { state.cache = {}; },
  });

  /** AQI at a spot from the saved forecast grid (bilinear), every 3 h: the offline version of GET /air. */
  PM.gridOutlook = function (g, lat, lon) {
    var fr = (lat - g.south) / g.step, fc = (lon - g.west) / g.step;
    fr = Math.max(0, Math.min(g.rows - 1, fr)); fc = Math.max(0, Math.min(g.cols - 1, fc));
    var r0 = Math.floor(fr), c0 = Math.floor(fc), r1 = Math.min(g.rows - 1, r0 + 1), c1 = Math.min(g.cols - 1, c0 + 1), dr = fr - r0, dc = fc - c0;
    return g.times.map(function (t, i) {
      var row = g.aqi[i], at = function (r, c) { return row[r * g.cols + c]; };
      var vals = [[at(r0, c0), (1 - dr) * (1 - dc)], [at(r0, c1), (1 - dr) * dc], [at(r1, c0), dr * (1 - dc)], [at(r1, c1), dr * dc]].filter(function (v) { return v[0] != null; });
      var w = vals.reduce(function (s, v) { return s + v[1]; }, 0);
      if (!vals.length || w <= 0) return null;
      var aqi = Math.round(vals.reduce(function (s, v) { return s + v[0] * v[1]; }, 0) / w);
      return { t: t, ms: Date.parse(t), aqi: aqi, category: U.aqiKey(aqi) };
    }).filter(Boolean);
  };
})((window.PM = window.PM || {}));
