/* Small helpers shared by every screen: text, time (India time), AQI and fire meta, icons, geometry. */
(function (PM) {
  "use strict";
  var U = (PM.U = {});

  // ---- text -------------------------------------------------------------------------------
  U.esc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  U.num = function (v, d) { var n = Number(v); return isFinite(n) ? n.toFixed(d == null ? 0 : d) : "–"; };
  U.pad = function (n) { return (n < 10 ? "0" : "") + n; };
  U.plural = function (n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); };
  U.debounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---- safe storage (private windows can throw) ---------------------------------------------
  U.ls = {
    get: function (k, fallback) { try { var v = window.localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set: function (k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  // ---- time: everything is shown in India time ----------------------------------------------
  var IST_MS = 5.5 * 3600 * 1000;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  U.istParts = function (ms) { var d = new Date(ms + IST_MS); return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
  U.clock = function (ms, step) {
    step = step || 300000;  // round in India time, so 3:00 pm stays 3:00 pm (India is UTC+5:30)
    var p = U.istParts(Math.round((ms + IST_MS) / step) * step - IST_MS);
    return (p.h % 12 || 12) + ":" + U.pad(p.mi) + " " + (p.h < 12 ? "am" : "pm");
  };
  /** The half hour a moment falls in, as text: 3:07 -> 3:00 pm, 3:33 -> 3:30 pm. */
  U.halfHour = function (ms) { return U.clock(ms - 900000, 1800000); };
  U.dayText = function (ms) { var p = U.istParts(ms); return p.d + " " + MONTHS[p.mo]; };
  U.dayKey = function (ms) { var p = U.istParts(ms); return p.y * 10000 + (p.mo + 1) * 100 + p.d; };
  U.when = function (ms, nowMs) { return U.clock(ms) + (U.dayKey(ms) !== U.dayKey(nowMs) ? ", " + U.dayText(ms) : ""); };
  U.hourLabel = function (ms) { var p = U.istParts(ms); return (p.h % 12 || 12) + (p.h < 12 ? "am" : "pm"); };
  U.isoIST = function (ms) {
    var p = U.istParts(ms);
    return p.y + "-" + U.pad(p.mo + 1) + "-" + U.pad(p.d) + "T" + U.pad(p.h) + ":" + U.pad(p.mi) + ":" + U.pad(new Date(ms).getUTCSeconds()) + "+05:30";
  };
  U.parse = function (iso) { var ms = Date.parse(iso); return isFinite(ms) ? ms : null; };
  /** "in 4 h", "25 min ago": a short distance in time. */
  U.rel = function (ms, nowMs) {
    var diff = ms - nowMs, abs = Math.abs(diff), mins = Math.round(abs / 60000);
    var text = mins < 2 ? "now" : mins < 90 ? mins + " min" : abs < 36 * 3600000 ? Math.round(abs / 360000) / 10 + " h" : Math.round(abs / 86400000) + " days";
    text = text.replace(".0 h", " h");
    return mins < 2 ? "now" : diff > 0 ? PM.t("rel.in", { x: text }) : PM.t("rel.ago", { x: text });
  };

  // ---- air quality (CPCB categories and colours) -------------------------------------------
  U.AQI = [
    { key: "good", min: 0, max: 50 }, { key: "satisfactory", min: 51, max: 100 }, { key: "moderate", min: 101, max: 200 },
    { key: "poor", min: 201, max: 300 }, { key: "very_poor", min: 301, max: 400 }, { key: "severe", min: 401, max: 500 },
  ];
  U.aqiKey = function (n) { return n <= 50 ? "good" : n <= 100 ? "satisfactory" : n <= 200 ? "moderate" : n <= 300 ? "poor" : n <= 400 ? "very_poor" : "severe"; };
  U.aqiColor = function (keyOrNum) { var k = typeof keyOrNum === "number" ? U.aqiKey(keyOrNum) : keyOrNum; return css("--aqi-" + k); };
  U.aqiInk = function (keyOrNum) { var k = typeof keyOrNum === "number" ? U.aqiKey(keyOrNum) : keyOrNum; return css("--aqi-" + k + "-ink"); };
  U.aqiBadge = function (n, big) {
    var k = U.aqiKey(n);
    return '<span class="aqi ' + k + (big ? " big" : "") + '" title="' + U.esc(PM.t("aqi." + k)) + '">' + U.esc(Math.round(n)) + "</span>";
  };
  U.aqiLabel = function (n) { return PM.t("aqi." + U.aqiKey(n)); };
  U.POLLUTANTS = { pm2_5: "PM2.5", pm10: "PM10", no2: "NO₂", so2: "SO₂", co: "CO", o3: "Ozone", nh3: "Ammonia", dust: "Dust" };
  U.UNITS = { pm2_5: "µg/m³", pm10: "µg/m³", no2: "µg/m³", so2: "µg/m³", co: "mg/m³", o3: "µg/m³", nh3: "µg/m³" };
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888"; }
  U.css = css;

  // ---- fire toxicity and types ----------------------------------------------------------------
  U.TOX_LEVELS = ["low", "moderate", "high", "very high"];
  U.toxKey = function (level) { return level ? String(level).replace(" ", "_") : "none"; };
  U.toxColor = function (level) { return css("--tox-" + U.toxKey(level)); };
  U.toxRadius = function (level) { return { low: 5, moderate: 7, high: 10, "very high": 13 }[level] || 5; };
  U.TOX_COLORS = { pm2_5: "#c2410c", no2: "#d97706", co: "#64748b", benzene: "#7c3aed", formaldehyde: "#db2777", nh3: "#0e7490", so2: "#ca8a04" };
  U.EM_NAMES = {
    pm2_5: "PM2.5 (fine particles)", tpm: "Total particles", bc: "Black carbon (soot)", oc: "Organic carbon", co: "Carbon monoxide",
    no2: "Nitrogen oxides (as NO₂)", so2: "Sulphur dioxide", nh3: "Ammonia", benzene: "Benzene", toluene: "Toluene",
    formaldehyde: "Formaldehyde", ch4: "Methane", co2: "Carbon dioxide",
  };
  U.FIRE_TYPES = {
    farm: { icon: "wheat", color: "#b45309" }, industrial: { icon: "factory", color: "#6d28d9" }, waste: { icon: "trash", color: "#a16207" },
    settlement: { icon: "building", color: "#475569" }, forest: { icon: "tree", color: "#15803d" }, grassland: { icon: "grass", color: "#4d7c0f" },
    unknown: { icon: "help", color: "#64748b" },
  };
  U.typeOf = function (p) { return U.FIRE_TYPES[(p && p.fire_type) || "unknown"] || U.FIRE_TYPES.unknown; };
  U.typeBadge = function (p) {
    var t = U.typeOf(p);
    return '<span class="type-badge" style="background:' + t.color + '" aria-hidden="true">' + U.icon(t.icon) + "</span>";
  };
  U.typeName = function (p) { return PM.t("type." + ((p && p.fire_type) || "unknown")); };

  /** Filter chips for the map, one per fire type that exists: counts = {type: n}, on = {type: true}. */
  U.typeChips = function (counts, on) {
    var any = Object.keys(on).some(function (k) { return on[k]; }), total = Object.keys(counts).reduce(function (n, k) { return n + counts[k]; }, 0);
    var all = '<button type="button" class="chip" data-ftype="all" aria-pressed="' + !any + '">' + U.esc(PM.t("filter.all")) + " " + total + "</button>";
    return all + ["farm", "industrial", "waste", "settlement", "forest", "grassland", "unknown"].filter(function (k) { return counts[k]; }).map(function (k) {
      return '<button type="button" class="chip" data-ftype="' + k + '" aria-pressed="' + !!on[k] + '"><i class="dot" style="background:' + U.FIRE_TYPES[k].color + '"></i>' +
        U.esc(PM.t("type." + k)) + (k === "industrial" ? "*" : "") + " " + counts[k] + "</button>";
    }).join("");
  };
  /** The toolbar on top of a map: optional layer toggles, the fire-type chips (fill [data-typechips]) and the factory note. */
  U.mapBar = function (opts) {
    var layers = "";
    if (opts && opts.layers) {
      layers = '<div class="mb-group"><span class="mb-label">' + U.esc(PM.t("map.layers")) + '</span><div class="mb-layers">' +
        '<button type="button" class="mb-toggle" data-layer="fires" aria-pressed="true">' + U.icon("flame", "sm") + "<span>" + U.esc(PM.t("cz.layer_fires")) + "</span></button>" +
        '<button type="button" class="mb-toggle" data-layer="air" aria-pressed="false">' + U.icon("wind", "sm") + "<span>" + U.esc(PM.t("cz.layer_air")) + "</span></button></div></div>" +
        '<span class="mb-sep" aria-hidden="true"></span>';
    }
    return '<div class="mapbar glass" role="toolbar" aria-label="' + U.esc(PM.t("auth.filter_types")) + '"><div class="mb-row">' + layers +
      '<div class="mb-group mb-grow"><span class="mb-label">' + U.esc(PM.t("map.fire_type")) + '</span><div class="mb-chips" data-typechips></div></div></div>' +
      '<div class="mb-note" title="' + U.esc(PM.t("filter.industry_note")) + '">' + U.icon("info", "sm") + "<span>" + U.esc(PM.t("filter.industry_note")) + "</span></div></div>";
  };
  /** Turn a chip click into the new choice: {type: true} for that type only, or {} for all. */
  U.toggleType = function (on, key) {
    // One type at a time, so a chip shows only the fires it stands for. Click it again (or "All fires") to go back.
    var wasOn = !!on[key];
    Object.keys(on).forEach(function (k) { on[k] = false; });
    if (key !== "all" && !wasOn) on[key] = true;
  };

  /** Where factory and kiln fires can be recognised (the server says so; this is the same box as a fallback). */
  U.industryBox = function () { return PM.industryBox || [27.6, 73.8, 32.6, 77.6]; };
  U.insideIndustryBox = function (lat, lon) { var b = U.industryBox(); return lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3]; };

  // ---- icons: small inline SVGs (24 px grid, drawn with strokes) -------------------------------------
  var ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    bell: '<path d="M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 004 0"/>',
    flame: '<path d="M12 3c1 4 5 6 5 11a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z"/>',
    wind: '<path d="M3 8h11a3 3 0 10-3-3"/><path d="M3 12h16a3 3 0 11-3 3"/><path d="M3 16h7"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19c3-5 6-8 10-10"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 21l5-3 5 3-1.5-7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    grid: '<rect x="3" y="3" width="7" height="8" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    moon: '<path d="M20 14A8 8 0 019.5 3.5 8 8 0 1020 14z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
    pin: '<path d="M12 21s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    factory: '<path d="M3 21V11l6 4v-4l6 4V5h3v16z"/><path d="M8 18h1M13 18h1"/>',
    wheat: '<path d="M12 22V9"/><path d="M12 9c-3 0-4-2-4-4 3 0 4 2 4 4zM12 9c3 0 4-2 4-4-3 0-4 2-4 4zM12 15c-3 0-4-2-4-4 3 0 4 2 4 4zM12 15c3 0 4-2 4-4-3 0-4 2-4 4z"/>',
    trash: '<path d="M4 7h16M10 7V4h4v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
    building: '<rect x="5" y="3" width="10" height="18" rx="1"/><path d="M15 9h4v12h-4M8 7h4M8 11h4M8 15h4"/>',
    tree: '<path d="M12 22v-6"/><path d="M12 16c-4 0-6-2.5-6-5 0-1.5.8-2.7 2-3.4C8 5 9.8 3 12 3s4 2 4 4.6c1.2.7 2 1.9 2 3.4 0 2.5-2 5-6 5z"/>',
    grass: '<path d="M4 21c0-6 1-10 3-14M10 21c0-8 1-12 2-16M16 21c0-7 0-10-1-13M21 21c-1-5-2-8-4-10"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
    refresh: '<path d="M20 11a8 8 0 00-14.5-4M4 4v4h4M4 13a8 8 0 0014.5 4M20 20v-4h-4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    heart: '<path d="M12 21s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 10c0 6-8 11-8 11z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0114 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14a7 7 0 013 6"/>',
  };
  U.icon = function (name, cls) {
    return '<svg class="icon' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.help) + "</svg>";
  };

  // ---- geometry ---------------------------------------------------------------------------------
  U.KM_PER_DEG = 111.32;
  U.distKm = function (lat1, lon1, lat2, lon2) {
    var c = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    return Math.hypot((lat2 - lat1) * U.KM_PER_DEG, (lon2 - lon1) * U.KM_PER_DEG * c);
  };
  U.REACH_KM = { city: 15, town: 15, village: 5, school: 3, college: 3, hospital: 3, clinic: 3 };
  /**
   * Same rule as the server: the smoke path passes within the place's distance AND the place is inside
   * the band (1 km + 0.25 km per km travelled). Returns {t (ms), d (km)} or false.
   * path = {coords: [[lon, lat], ...], times: [ms, ...], km: [...]}.
   */
  U.reaches = function (path, lat, lon, maxKm) {
    var coslat = Math.cos(lat * Math.PI / 180), best = null, c = path.coords;
    for (var i = 0; i + 1 < c.length; i++) {
      var ax = (c[i][0] - lon) * U.KM_PER_DEG * coslat, ay = (c[i][1] - lat) * U.KM_PER_DEG;
      var bx = (c[i + 1][0] - lon) * U.KM_PER_DEG * coslat, by = (c[i + 1][1] - lat) * U.KM_PER_DEG;
      var dx = bx - ax, dy = by - ay, seg2 = dx * dx + dy * dy;
      var f = seg2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / seg2));
      var d = Math.hypot(ax + f * dx, ay + f * dy);
      if (!best || d < best.d - 1e-9) best = { d: d, i: i, f: f };
    }
    if (!best) return false;
    var kmAt = path.km[best.i] + best.f * (path.km[best.i + 1] - path.km[best.i]);
    if (best.d > maxKm || best.d > 1 + 0.25 * kmAt) return false;
    return { t: path.times[best.i] + best.f * (path.times[best.i + 1] - path.times[best.i]), d: best.d };
  };
  /** Compass word for the way a path heads: "north-east". */
  U.heading = function (coords) {
    if (!coords || coords.length < 2) return "";
    var a = coords[0], b = coords[coords.length - 1];
    var ang = (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI + 360) % 360;
    return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(ang / 45) % 8];
  };

  // ---- small widgets ---------------------------------------------------------------------------------
  /** Count a number up inside an element (skipped when the person prefers reduced motion). */
  U.countUp = function (el, to, ms) {
    var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    to = Number(to) || 0;
    if (still || to < 3) { el.textContent = Math.round(to).toLocaleString("en-IN"); return; }
    var start = performance.now();
    (function step(now) {
      var k = Math.min(1, (now - start) / (ms || 700));
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString("en-IN");
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    })(start);
  };
  U.toast = function (msg, kind) {
    var box = document.getElementById("toasts");
    if (!box) return;
    var t = document.createElement("div");
    t.className = "toast " + (kind || "ok");
    t.setAttribute("role", kind === "err" ? "alert" : "status");
    t.innerHTML = U.icon(kind === "err" ? "alert" : "check") + "<span>" + U.esc(msg) + "</span>";
    box.appendChild(t);
    setTimeout(function () { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(function () { t.remove(); }, 320); }, kind === "err" ? 6000 : 3800);
  };
  U.skeleton = function (lines, h) {
    var out = "";
    for (var i = 0; i < (lines || 3); i++) out += '<div class="skel" style="height:' + (h || 18) + 'px;margin:10px 0;width:' + (100 - ((i * 13) % 35)) + '%"></div>';
    return '<div aria-busy="true" aria-label="Loading">' + out + "</div>";
  };
  /** Open a dialog. content = {title, body (html), footer (html)}; returns {el, close}. Esc and the backdrop close it. */
  U.modal = function (content) {
    var prev = document.activeElement;
    var ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + U.esc(content.title) + '">' +
      '<header><h3>' + U.esc(content.title) + '</h3><button class="btn ghost icon-only sm" data-close aria-label="Close">' + U.icon("x") + "</button></header>" +
      '<div class="body">' + (content.body || "") + "</div>" + (content.footer ? "<footer>" + content.footer + "</footer>" : "") + "</div>";
    document.body.appendChild(ov);
    var api = {
      el: ov,
      close: function () { document.removeEventListener("keydown", onKey, true); ov.remove(); if (prev && prev.focus) prev.focus(); if (content.onClose) content.onClose(); },
    };
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); api.close(); }
      if (e.key === "Tab") {
        var f = U.$$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', ov).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) api.close(); });
    ov.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) api.close(); });
    var first = U.$("textarea, input, select, .btn.primary, .btn", ov.querySelector(".body")) || U.$("[data-close]", ov);
    if (first) first.focus();
    return api;
  };
  /** A drag handle for the phone bottom sheet: drag up or down to change its height. */
  U.sheetDrag = function (sheet) {
    var handle = sheet.querySelector(".sheet-handle");
    if (!handle) return;
    var startY, startH;
    handle.addEventListener("pointerdown", function (e) {
      startY = e.clientY; startH = sheet.getBoundingClientRect().height; handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", function (e) {
      if (startY == null) return;
      var h = Math.max(120, Math.min(window.innerHeight * 0.9, startH + (startY - e.clientY)));
      sheet.style.setProperty("--sheet-h", h + "px");
    });
    handle.addEventListener("pointerup", function () {
      startY = null;
      var h = sheet.getBoundingClientRect().height, vh = window.innerHeight;
      var snap = h < vh * 0.3 ? 150 : h < vh * 0.65 ? vh * 0.5 : vh * 0.88;
      sheet.style.setProperty("--sheet-h", snap + "px");
    });
    handle.addEventListener("dblclick", function () { sheet.style.setProperty("--sheet-h", sheet.getBoundingClientRect().height > window.innerHeight * 0.6 ? "50dvh" : "88dvh"); });
  };
})((window.PM = window.PM || {}));
