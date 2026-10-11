/* What the app remembers: who is signed in, home area, language, theme, read alerts.
   Also the in-browser copy of alerts and cases that powers demo mode when there is no server. */
(function (PM) {
  "use strict";
  var U = PM.U;

  // ---- settings from the address and the config block ----------------------------------------------
  var q = new URLSearchParams(window.location.search);
  // ?reset=1 clears everything this app saved in this browser (login, farm, crops, plan, pledges, alerts), so you see it as a new user.
  if (q.get("reset") === "1") {
    try {
      Object.keys(localStorage).filter(function (k) { return k.indexOf("pm.") === 0; }).forEach(function (k) { localStorage.removeItem(k); });
      sessionStorage.clear();
    } catch (e) { /* storage may be blocked */ }
    q.delete("reset");
    window.history.replaceState(null, "", window.location.pathname + (q.toString() ? "?" + q.toString() : "") + "#/");
  }
  var cfg = window.PM_CONFIG || {};
  // The server address: ?api= wins, then the default in index.html (PM_CONFIG.api), and ?demo=1 forces the saved sample.
  var apiParam = q.get("demo") === "1" ? "" : (q.get("api") !== null ? q.get("api") : (cfg.api || "")).trim();
  PM.config = {
    // ?api=/ (this server) or ?api=https://...: live data. No ?api= means saved sample data (works offline).
    api: apiParam.replace(/\/(smoke|fires|air|stations|forecast|alerts|cases|activity)\/?$/, "").replace(/\/$/, ""),
    live: apiParam !== "",
    // ?auth=cognito turns on Amazon Cognito sign-in (needs the config block in index.html to be filled in).
    auth: q.get("auth") === "cognito" && cfg.cognito && cfg.cognito.domain ? "cognito" : "demo",
    cognito: cfg.cognito || {},
    demoTools: q.get("auth") !== "cognito",
  };

  // ---- the clock: live time, or the moment the saved sample was taken (so "smoke in 4 h" stays true) ----
  var sampleBase = null, loadedAt = Date.now();
  PM.setSampleNow = function (ms) { sampleBase = ms; };
  PM.now = function () { return sampleBase == null ? Date.now() : sampleBase + (Date.now() - loadedAt); };
  PM.nowIso = function () { return U.isoIST(PM.now()); };

  // ---- tiny event bus -------------------------------------------------------------------------------------
  var handlers = {};
  PM.on = function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); return function () { handlers[name] = handlers[name].filter(function (f) { return f !== fn; }); }; };
  PM.emit = function (name, data) { (handlers[name] || []).slice().forEach(function (f) { try { f(data); } catch (e) { console.error(e); } }); };
  window.addEventListener("storage", function (e) {
    if (e.key && e.key.indexOf("pm.") === 0) { PM.emit("alerts"); PM.emit("cases"); }
  });

  // ---- settings -------------------------------------------------------------------------------------------
  PM.store = {
    session: function () { return U.ls.get("pm.session", null); },
    setSession: function (s) { U.ls.set("pm.session", s); PM.emit("session", s); },
    clearSession: function () { U.ls.del("pm.session"); PM.emit("session", null); },
    home: function () { return U.ls.get("pm.home", null); },
    setHome: function (h) { U.ls.set("pm.home", h); PM.emit("home", h); },
    lang: function () { return U.ls.get("pm.lang", "en"); },
    setLang: function (l) { U.ls.set("pm.lang", l); PM.emit("lang", l); },
    theme: function (role) { return U.ls.get("pm.theme." + (role || "citizen"), role === "authority" ? "dark" : "light"); },
    setTheme: function (role, t) { U.ls.set("pm.theme." + (role || "citizen"), t); document.documentElement.setAttribute("data-theme", t); PM.emit("theme", t); },
    read: function () { return U.ls.get("pm.read", []); },
    farm: function () { return U.ls.get("pm.farm", null); },
    setFarm: function (f) { U.ls.set("pm.farm", f); PM.emit("farm", f); },
    crops: function () { return U.ls.get("pm.crops", []); },
    setCrops: function (c) { U.ls.set("pm.crops", c); PM.emit("farm"); },
    pledges: function () { return U.ls.get("pm.pledges", []); },
    addPledge: function (p) { var all = PM.store.pledges(); all.unshift(p); U.ls.set("pm.pledges", all.slice(0, 100)); PM.emit("farm"); },
    markRead: function (ids) { var all = PM.store.read(); ids.forEach(function (i) { if (all.indexOf(i) < 0) all.push(i); }); U.ls.set("pm.read", all.slice(-300)); PM.emit("alerts"); },
  };
  PM.applyTheme = function (role) {
    var t = PM.store.theme(role);
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.setAttribute("lang", PM.store.lang());
    var meta = U.$('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0a110e" : "#f3f7f4");
  };

  // ---- demo mode: alerts and cases kept in this browser ----------------------------------------------------
  // The same rules as the server (src/smoke_path/alerts.py), so the demo behaves like the real thing.
  var NEXT = {
    "new": ["warning_sent", "resolved", "dismissed"], warning_sent: ["acknowledged", "resolved", "dismissed"],
    acknowledged: ["resolved", "dismissed"], resolved: ["new"], dismissed: ["new"],
  };
  PM.STATUSES = ["new", "warning_sent", "acknowledged", "resolved", "dismissed"];
  var Local = (PM.local = {
    alerts: function () { return U.ls.get("pm.local.alerts", []); },
    cases: function () { return U.ls.get("pm.local.cases", {}); },
    createAlert: function (b, who) {
      if (!b.fire_id) throw new Error("fire_id is required.");
      if (!b.message || !String(b.message).trim()) throw new Error("message is required.");
      var now = PM.nowIso();
      var alert = {
        id: Math.random().toString(16).slice(2, 14), fire_id: b.fire_id, kind: b.kind, target: b.target, message: String(b.message).trim(),
        language: b.language || "en", created_at: now, sent_by: who || "demo authority", fire: b.fire || {}, delivery: ["in-app (demo)"],
      };
      var list = Local.alerts(); list.unshift(alert); U.ls.set("pm.local.alerts", list.slice(0, 300));
      var cases = Local.cases(), c = cases[b.fire_id] || { fire_id: b.fire_id, status: "new", created_at: now, updated_at: now, fire: b.fire || {}, timeline: [] };
      if (b.kind === "source_warning") {
        c.timeline.push({ t: now, event: "source_warning", text: "Warning sent to " + b.target.name + " (" + b.target.role + ")", by: alert.sent_by });
        if (c.status === "new") c.status = "warning_sent";
      } else {
        var n = b.target.places.length;
        c.timeline.push({ t: now, event: "public_alert", text: "Alert sent to people in " + n + " place" + (n === 1 ? "" : "s"), by: alert.sent_by });
      }
      c.updated_at = now; cases[b.fire_id] = c; U.ls.set("pm.local.cases", cases);
      PM.emit("alerts"); PM.emit("cases");
      return alert;
    },
    alertsNear: function (lat, lon, radiusKm) {
      return Local.alerts().filter(function (a) { return a.kind === "public_alert"; }).map(function (a) {
        var best = Math.min.apply(null, a.target.places.map(function (p) { return U.distKm(lat, lon, p.lat, p.lon); }));
        return Object.assign({}, a, { distance_km: Math.round(best * 10) / 10 });
      }).filter(function (a) { return a.distance_km <= radiusKm; });
    },
    /** Warnings sent to farmers about a fire within radiusKm of the farm: the same rules as the server's warnings_near. */
    warningsNear: function (lat, lon, radiusKm) {
      var cases = Local.cases();
      return Local.alerts().filter(function (a) {
        return a.kind === "source_warning" && a.target.role === "farmer" && a.fire && a.fire.lat != null && a.fire.lon != null;
      }).map(function (a) {
        var c = cases[a.fire_id];
        return Object.assign({}, a, { target: { name: a.target.name, role: "farmer" }, distance_km: Math.round(U.distKm(lat, lon, a.fire.lat, a.fire.lon) * 10) / 10, case_status: c ? c.status : "warning_sent", sent_by: undefined, delivery: undefined });
      }).filter(function (a) { return a.distance_km <= radiusKm; });
    },
    /** A farmer says they read a warning: the case becomes acknowledged (only from new or warning_sent). */
    ack: function (alertId, name) {
      var a = Local.alerts().filter(function (x) { return x.id === alertId && x.kind === "source_warning"; })[0];
      if (!a) throw new Error("That warning was not found.");
      if (!name || !String(name).trim()) throw new Error("name is required.");
      var cases = Local.cases(), now = PM.nowIso(), c = cases[a.fire_id];
      if (c && (c.status === "new" || c.status === "warning_sent")) {
        c.timeline.push({ t: now, event: "status", text: "Status: " + c.status + " → acknowledged. Read by " + String(name).trim() + " (farmer)", by: String(name).trim() });
        c.status = "acknowledged"; c.updated_at = now; cases[a.fire_id] = c; U.ls.set("pm.local.cases", cases);
        PM.emit("cases"); PM.emit("alerts");
      }
      return c;
    },
    updateCase: function (id, b, who) {
      var cases = Local.cases(), now = PM.nowIso();
      var c = cases[id] || { fire_id: id, status: "new", created_at: now, updated_at: now, fire: b.fire || {}, timeline: [] };
      var note = (b.note || "").trim();
      if (b.status) {
        if (PM.STATUSES.indexOf(b.status) < 0) throw new Error("status must be one of: " + PM.STATUSES.join(", ") + ".");
        if (b.status !== c.status) {
          if (NEXT[c.status].indexOf(b.status) < 0) throw new Error("A case that is " + c.status + " cannot become " + b.status + ".");
          if (b.status === "dismissed" && !note) throw new Error("Say why the fire is dismissed (note).");
          c.timeline.push({ t: now, event: "status", text: "Status: " + c.status + " → " + b.status + (note ? ". " + note : ""), by: who || "demo authority" });
          c.status = b.status;
        }
      } else if (note) {
        c.timeline.push({ t: now, event: "note", text: note, by: who || "demo authority" });
      } else throw new Error("Send a status or a note.");
      if (b.fire && !(c.fire && Object.keys(c.fire).length)) c.fire = b.fire;
      c.updated_at = now; cases[id] = c; U.ls.set("pm.local.cases", cases);
      PM.emit("cases");
      return c;
    },
    reset: function () { U.ls.del("pm.local.alerts"); U.ls.del("pm.local.cases"); U.ls.del("pm.read"); U.ls.del("pm.farm"); U.ls.del("pm.crops"); U.ls.del("pm.pledges"); PM.emit("alerts"); PM.emit("cases"); },
  });
})((window.PM = window.PM || {}));
