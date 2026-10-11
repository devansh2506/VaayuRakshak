/* Farmer screens: register the farm, "My farm" (fires and smoke near it, warnings from authorities, crops),
   crops with a care guide, a crop doctor (symptom guidance), stubble and the no-burn pledge, and the warnings inbox.
   The farm, crops and pledges stay in this browser. Warnings come from the same alerts and cases as the authority screens,
   and "I have read this" updates the fire's case, so the authority sees it. */
(function (PM) {
  "use strict";
  var U = PM.U, esc = U.esc, t = function (k, v) { return PM.t(k, v); };
  var F = (PM.farmer = {});
  var R = window.PM_FARM || {};
  var NEAR_KM = 25;

  /** An {en, hi} item in the language on screen. */
  function tx(o) { return o ? (PM._lang === "hi" && o.hi != null ? o.hi : o.en) : ""; }
  function byId(list, id) { return (list || []).filter(function (x) { return x.id === id; })[0] || null; }
  function loading(h) { return '<div class="card">' + U.skeleton(3, h || 22) + "</div>"; }
  function uid() { return Math.random().toString(16).slice(2, 12); }
  function needFarm() {
    if (PM.store.farm()) return false;
    PM.go("#/farmer/setup");
    return true;
  }
  function options(list, sel) { return list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? " selected" : "") + ">" + esc(tx(x)) + "</option>"; }).join(""); }
  function errorBox(msg, retry) { return PM.authority.errorBox(msg, retry); }
  function aiBadge() { return '<span class="ai-badge">' + U.icon("sparkle") + esc(t("fm.ai_badge")) + "</span>"; }
  function shimmer(n) { return new Array((n || 3) + 1).join('<div class="shimmer"></div>'); }
  function ul(items) { return items && items.length ? '<ul style="margin:0;padding-left:18px">' + items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : ""; }
  function sec(title, html) { return html ? '<section class="block"><h4>' + esc(title) + "</h4>" + html + "</section>" : ""; }
  /** Gemini writes a little markdown (bold, bullets). Escape everything first, then allow only those two. */
  function mdLite(text) {
    var bold = function (x) { return x.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"); }, out = [], list = false;
    String(text).split("\n").forEach(function (raw) {
      var line = esc(raw), m = /^\s*[*-]\s+(.*)$/.exec(line);
      if (m) { if (!list) { out.push("<ul>"); list = true; } out.push("<li>" + bold(m[1]) + "</li>"); return; }
      if (list) { out.push("</ul>"); list = false; }
      if (line.trim()) out.push("<p>" + bold(line) + "</p>");
    });
    if (list) out.push("</ul>");
    return out.join("");
  }
  /** Shrink a photo (longest side 1024 px, JPEG) so it is small to send: {image: base64, mime}. */
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1024 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ image: c.toDataURL("image/jpeg", 0.82).split(",")[1], mime: "image/jpeg", preview: c.toDataURL("image/jpeg", 0.5) });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("photo")); };
      img.src = url;
    });
  }

  // ---- register the farm ------------------------------------------------------------------------------------------------
  F.setup = function (root) {
    var farm = PM.store.farm(), where = farm ? { name: farm.place || farm.village || farm.name, lat: farm.lat, lon: farm.lon } : null;
    var session = PM.store.session() || {};
    root.innerHTML = '<div class="page" style="max-width:820px"><div class="page-head"><div><h1>' + esc(t("fm.setup_title")) + '</h1><p class="muted">' + esc(t("fm.setup_sub")) + "</p></div></div>" +
      '<form class="card stack" data-form novalidate><div class="grid2">' +
      field("fm-name", t("fm.f_name"), '<input id="fm-name" class="input" data-f="name" maxlength="80" autocomplete="off" value="' + esc(farm ? farm.name : "") + '">') +
      field("fm-owner", t("fm.f_owner"), '<input id="fm-owner" class="input" data-f="owner" maxlength="80" autocomplete="name" value="' + esc(farm ? farm.owner : (session.name && !/^Demo /.test(session.name) ? session.name : "")) + '">') +
      field("fm-state", t("fm.f_state"), '<select id="fm-state" class="input" data-f="state"><option value=""></option>' + (R.states || []).map(function (s) { return '<option' + (farm && farm.state === s ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select>") +
      field("fm-district", t("fm.f_district"), '<input id="fm-district" class="input" data-f="district" maxlength="60" value="' + esc(farm ? farm.district : "") + '">') +
      field("fm-village", t("fm.f_village"), '<input id="fm-village" class="input" data-f="village" maxlength="60" value="' + esc(farm ? farm.village : "") + '">') +
      field("fm-acres", t("fm.f_acres"), '<input id="fm-acres" class="input" data-f="acres" type="number" min="0.1" max="10000" step="0.1" inputmode="decimal" value="' + esc(farm ? farm.acres : "") + '">') +
      field("fm-soil", t("fm.f_soil"), '<select id="fm-soil" class="input" data-f="soil">' + options(R.soils || [], farm ? farm.soil : "alluvial") + "</select>") +
      field("fm-irrig", t("fm.f_irrig"), '<select id="fm-irrig" class="input" data-f="irrig">' + options(R.irrigation || [], farm ? farm.irrig : "tubewell") + "</select>") + "</div>" +
      '<div class="field"><label for="fm-q">' + esc(t("fm.f_where")) + '</label><div class="search"><span aria-hidden="true">' + U.icon("search") + '</span><input id="fm-q" class="input" data-q type="search" autocomplete="off" placeholder="' + esc(t("cz.search_ph")) + '"></div><div class="results" data-results hidden></div><p class="small muted" data-hint></p></div>' +
      '<div class="row wrap"><button type="button" class="btn" data-gps>' + U.icon("crosshair") + esc(t("cz.use_gps")) + '</button><button type="button" class="btn" data-pickmap>' + U.icon("pin") + esc(t("cz.pick_map")) + "</button></div>" +
      '<div class="mini-map" data-map hidden></div>' +
      '<div class="quick">' + (window.PM_PLACES || []).map(function (p, i) { return '<button type="button" class="chip" data-quick="' + i + '">' + esc(p.name) + "</button>"; }).join("") + "</div>" +
      '<p class="note" data-where>' + U.icon("pin") + "<span></span></p><p class=\"small\" data-err role=\"alert\" style=\"color:var(--bad)\"></p>" +
      '<div class="row"><button class="btn farmer-btn lg" type="submit">' + esc(t("fm.save")) + "</button>" + (farm ? '<a class="btn lg" href="#/farmer/home">' + esc(t("btn.back")) + "</a>" : "") + "</div></form></div>";
    var $ = function (s) { return root.querySelector(s); }, mapc = null;
    function field(id, label, input) { return '<div class="field"><label for="' + id + '">' + esc(label) + "</label>" + input + "</div>"; }
    function paintWhere() {
      $("[data-where] span").textContent = where ? t("fm.where_set", { name: where.name, lat: U.num(where.lat, 3), lon: U.num(where.lon, 3) }) : t("fm.where_none");
    }
    function pick(p) { where = { name: p.name, lat: Number(p.lat), lon: Number(p.lon) }; if (p.state && !$('[data-f="state"]').value && (R.states || []).indexOf(p.state) >= 0) $('[data-f="state"]').value = p.state; paintWhere(); $("[data-results]").hidden = true; }
    paintWhere();
    root.addEventListener("click", function (e) {
      var q = e.target.closest("[data-quick]");
      if (q) { var p = window.PM_PLACES[Number(q.getAttribute("data-quick"))]; pick(p); }
      var r = e.target.closest("[data-res]");
      if (r) pick(JSON.parse(r.getAttribute("data-res")));
      if (e.target.closest("[data-gps]")) {
        if (!navigator.geolocation) { U.toast(t("cz.no_gps"), "err"); return; }
        navigator.geolocation.getCurrentPosition(function (pos) { pick({ name: t("cz.my_location"), lat: pos.coords.latitude, lon: pos.coords.longitude }); }, function () { U.toast(t("cz.no_gps"), "err"); }, { timeout: 10000 });
      }
      if (e.target.closest("[data-pickmap]")) {
        var box = $("[data-map]"); box.hidden = false;
        if (!PM.maps.available()) { box.innerHTML = PM.maps.noMapHtml(); return; }
        if (!mapc) {
          mapc = PM.maps.create(box, { theme: document.documentElement.getAttribute("data-theme"), center: where ? [where.lat, where.lon] : [29.5, 76], zoom: where ? 11 : 6 });
          var marker = null;
          mapc.map.on("click", function (ev) {
            pick({ name: U.num(ev.latlng.lat, 3) + "°N, " + U.num(ev.latlng.lng, 3) + "°E", lat: ev.latlng.lat, lon: ev.latlng.lng });
            if (marker) marker.remove();
            marker = L.circleMarker(ev.latlng, { radius: 8, color: U.css("--farm"), fillOpacity: 0.8 }).addTo(mapc.map);
          });
        } else mapc.map.invalidateSize();
        $("[data-hint]").textContent = t("cz.tap_map");
      }
    });
    var search = U.debounce(async function (q) {
      var results = $("[data-results]");
      if (q.trim().length < 3) { results.hidden = true; return; }
      var list = (window.PM_PLACES || []).filter(function (p) { return p.name.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0; }).map(function (p) { return { name: p.name, state: p.state, lat: p.lat, lon: p.lon }; });
      try {
        var r = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&q=" + encodeURIComponent(q), { headers: { Accept: "application/json" } });
        (await r.json()).forEach(function (x) {
          var a = x.address || {}, name = x.name || a.village || a.town || a.city || a.hamlet || (x.display_name || "").split(",")[0];
          list.push({ name: name, state: a.state || "", lat: Number(x.lat), lon: Number(x.lon), sub: [a.county || a.state_district, a.state].filter(Boolean).join(", ") });
        });
        $("[data-hint]").textContent = "";
      } catch (err) { $("[data-hint]").textContent = t("cz.search_offline"); }
      results.hidden = !list.length;
      results.innerHTML = list.slice(0, 8).map(function (p) {
        return "<button type=\"button\" data-res='" + esc(JSON.stringify({ name: p.name, state: p.state, lat: p.lat, lon: p.lon })) + "'><b>" + esc(p.name) + '</b> <span class="muted small">' + esc(p.sub || p.state || "") + "</span></button>";
      }).join("");
    }, 450);
    $("[data-q]").addEventListener("input", function (e) { search(e.target.value); });
    $("[data-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = {}; root.querySelectorAll("[data-f]").forEach(function (el) { v[el.getAttribute("data-f")] = el.value.trim(); });
      var acres = Number(v.acres), err = $("[data-err]");
      if (!v.name || !v.owner || !v.state || !(acres > 0 && acres <= 10000)) { err.textContent = t("fm.need_fields"); return; }
      if (!where || !isFinite(where.lat) || !isFinite(where.lon)) { err.textContent = t("fm.need_place"); return; }
      PM.store.setFarm({ name: v.name, owner: v.owner, state: v.state, district: v.district, village: v.village, acres: Math.round(acres * 10) / 10, soil: v.soil, irrig: v.irrig, place: where.name, lat: where.lat, lon: where.lon });
      PM.store.setHome({ name: v.village || v.name, state: v.state, lat: where.lat, lon: where.lon });  // the map and forecast pages read this
      U.toast(t("fm.saved"));
      PM.go("#/farmer/home");
    });
    return { destroy: function () { if (mapc) mapc.destroy(); } };
  };

  // ---- warnings: one card per warning, with the "I have read this" button ----------------------------------------------------
  function warningCard(w) {
    var open = w.case_status === "new" || w.case_status === "warning_sent", closed = w.case_status === "resolved" || w.case_status === "dismissed";
    var place = (w.fire && (w.fire.near || w.fire.state)) || t("cz.unknown_place");
    var created = U.parse(w.created_at) || 0;
    return '<div class="alert-card' + (open ? " unread" : "") + '"><span class="ic">' + U.icon("alert") + '</span><div class="grow" style="min-width:0"><b>' + esc(t("fm.warn_from", { place: place, km: U.num(w.distance_km, 0) })) + '</b>' +
      '<div class="small muted">' + esc(t("fm.warn_sent_by", { when: U.when(created, PM.now()) })) + '</div><p class="body small">' + esc(w.message) + "</p>" +
      (open ? '<button class="btn farmer-btn sm" data-ack="' + esc(w.id) + '">' + U.icon("check", "sm") + esc(t("fm.warn_read")) + "</button>"
        : '<span class="pill">' + U.icon(closed ? "info" : "check", "sm") + esc(closed ? t("fm.warn_closed") : t("fm.warn_done")) + "</span>") + "</div></div>";
  }
  function bindAck(root, reload) {
    root.addEventListener("click", async function (e) {
      var b = e.target.closest("[data-ack]");
      if (!b) return;
      b.disabled = true;
      try {
        await PM.api.ackWarning(b.getAttribute("data-ack"), PM.store.farm().owner);
        U.toast(t("fm.acked"));
        reload();
      } catch (err) { b.disabled = false; U.toast(err.message, "err"); }
    });
  }

  // ---- My farm --------------------------------------------------------------------------------------------------------------------
  F.home = function (root) {
    if (needFarm()) return { destroy: function () {} };
    var farm = PM.store.farm(), ctl = { destroyed: false };
    var soil = tx(byId(R.soils, farm.soil)), irrig = tx(byId(R.irrigation, farm.irrig));
    root.innerHTML = '<div class="page"><div class="page-head"><div><p class="eyebrow">' + esc(t("fm.hello")) + ", " + esc(farm.owner) + "</p><h1>" + esc(farm.name) + '</h1><p class="muted">' + esc(t("fm.acres_line", { acres: farm.acres, soil: soil, irrig: irrig })) + (farm.village || farm.district ? " · " + esc([farm.village, farm.district, farm.state].filter(Boolean).join(", ")) : "") + '</p></div><a class="btn" href="#/farmer/setup">' + U.icon("pin") + esc(t("fm.edit")) + "</a></div>" +
      '<div class="home-grid"><div class="span-12" data-brief hidden></div><div class="span-7" data-warn>' + loading(60) + '</div><div class="span-5" data-adv>' + loading(60) + '</div>' +
      '<div class="span-7" data-fires>' + loading(70) + '</div><div class="span-5" data-crops>' + loading(50) + "</div></div></div>";
    var $ = function (s) { return root.querySelector(s); }, nowMs = function () { return PM.now(); };

    // the no-burn call to action
    $("[data-adv]").innerHTML = '<div class="card fade-in stack"><h3>' + esc(t("fm.noburn_title")) + '</h3><p class="small muted">' + esc(t("fm.noburn_text")) + '</p><div><a class="btn farmer-btn" href="#/farmer/stubble">' + U.icon("award", "sm") + esc(t("fm.noburn_btn")) + "</a></div></div>";

    // warnings from authorities
    function warnings() {
      PM.api.farmerWarnings(farm).then(function (list) {
        if (ctl.destroyed) return;
        list.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
        $("[data-warn]").innerHTML = '<div class="card fade-in stack"><div class="eyebrow">' + esc(t("fm.warn_title")) + "</div>" +
          (list.length ? list.slice(0, 2).map(warningCard).join("") + (list.length > 2 ? '<a href="#/farmer/alerts">' + esc(t("fm.warn_all")) + " (" + list.length + ")</a>" : "") : '<p class="muted">' + esc(t("fm.warn_none")) + "</p>") +
          '<p class="tiny muted">' + esc(t("fm.warn_note")) + "</p></div>";
      }).catch(function (e) { if (!ctl.destroyed) $("[data-warn]").innerHTML = errorBox(e.message, warnings); });
    }
    warnings();
    bindAck(root, function () { warnings(); });
    var off = [PM.on("alerts", warnings), PM.on("cases", warnings)];

    // the AI brief: written by Gemini from facts measured here (fires near, smoke, warnings, crops)
    function brief(facts) {
      if (PM.api.mode() !== "live") return;
      var box = $("[data-brief]"), key = JSON.stringify([facts, PM._lang, new Date().toISOString().slice(0, 13)]), cached = null;
      try { cached = JSON.parse(sessionStorage.getItem("pm.brief") || "null"); } catch (e) { cached = null; }
      var paint = function (b) {
        box.innerHTML = '<div class="ai-card fade-in"><div class="ai-head"><div class="eyebrow">' + esc(t("fm.br_title")) + "</div>" + aiBadge() + "</div>" + (b.headline ? "<h3>" + esc(b.headline) + "</h3>" : "") + ul(b.points) +
          (b.next_action ? '<p style="margin-top:8px"><b>' + esc(t("fm.br_next")) + ":</b> " + esc(b.next_action) + "</p>" : "") + "</div>";
      };
      box.hidden = false;
      if (cached && cached.key === key) { paint(cached.brief); return; }
      box.innerHTML = '<div class="ai-card"><div class="ai-head"><div class="eyebrow">' + esc(t("fm.br_wait")) + "</div>" + aiBadge() + "</div>" + shimmer(3) + "</div>";
      PM.api.farmerBrief(Object.assign({ language: PM._lang }, facts)).then(function (res) {
        if (ctl.destroyed) return;
        try { sessionStorage.setItem("pm.brief", JSON.stringify({ key: key, brief: res.brief })); } catch (e) { /* storage may be blocked */ }
        paint(res.brief);
      }).catch(function () { if (!ctl.destroyed) box.innerHTML = '<div class="ai-card"><div class="ai-head"><span class="small muted">' + esc(t("fm.br_fail")) + "</span>" + aiBadge() + "</div></div>"; });
    }

    // fires and smoke near the farm
    PM.api.fires().then(function (model) {
      if (ctl.destroyed) return;
      var reaching = model.firesReaching(farm.lat, farm.lon, 5), nearby = model.firesNear(farm.lat, farm.lon, NEAR_KM);
      PM.api.farmerWarnings(farm).catch(function () { return []; }).then(function (ws) {
        if (ctl.destroyed) return;
        brief({ acres: farm.acres, state: farm.state, fires_near: nearby.length, nearest_km: nearby.length ? Math.round(nearby[0].d) : null, smoke_reaching: reaching.length > 0,
          warnings_open: ws.filter(function (w) { return w.case_status === "new" || w.case_status === "warning_sent"; }).length,
          crops: PM.store.crops().slice(0, 5).map(function (c) { var r = byId(R.crops, c.crop); return { name: r ? r.en : c.crop, days: Math.round((Date.now() - Date.parse(c.sown + "T00:00:00+05:30")) / DAY) }; }) });
      });
      var upcoming = reaching.filter(function (x) { return x.t > nowMs(); }), already = reaching.filter(function (x) { return x.t <= nowMs(); });
      var firstUp = upcoming[0];
      var headline = firstUp ? t("cz.smoke_some", { n: upcoming.length, rel: U.rel(firstUp.t, nowMs()), when: U.when(firstUp.t, nowMs()) }) : already.length ? t("cz.smoke_here", { n: already.length, when: U.when(already[0].t, nowMs()) }) : "";
      var lines = nearby.slice(0, 4).map(function (x) {
        var hit = x.fire.path ? U.reaches(x.fire.path, farm.lat, farm.lon, 5) : null;
        return '<div class="fire-line">' + U.typeBadge(x.fire.p) + '<div style="min-width:0"><div class="truncate"><b>' + esc(t("cz.fire_line", { type: U.typeName(x.fire.p), near: x.fire.near || t("cz.unknown_place"), km: U.num(x.d, 0) })) + '</b></div><div class="small muted">' + esc(hit ? t(hit.t > nowMs() ? "cz.arrives" : "cz.arrived", { when: U.when(hit.t, nowMs()) }) : t("fm.smoke_not_you")) + "</div></div>" +
          (hit ? '<span class="pill">' + esc(U.rel(hit.t, nowMs())) + "</span>" : "<span></span>") + "</div>";
      }).join("");
      $("[data-fires]").innerHTML = '<div class="card fade-in"><div class="eyebrow">' + esc(t("cz.smoke_title")) + "</div>" +
        (headline ? '<h3 style="margin-bottom:6px">' + esc(headline) + "</h3>" : '<div class="row" style="gap:10px"><span style="color:var(--ok)">' + U.icon("check", "lg") + "</span><h3>" + esc(t("cz.smoke_none")) + "</h3></div>") +
        '<p class="small muted" style="margin:8px 0">' + esc(nearby.length ? t("fm.fires_n", { n: nearby.length, km: NEAR_KM }) : t("fm.fires_none", { km: NEAR_KM })) + "</p>" + lines + "</div>";
    }).catch(function (e) { if (!ctl.destroyed) $("[data-fires]").innerHTML = errorBox(e.message, function () { PM.api.refresh(); F.home(root); }); });

    // crops
    function crops() {
      var list = PM.store.crops();
      $("[data-crops]").innerHTML = '<div class="card fade-in stack"><div class="eyebrow">' + esc(t("fm.crops_title")) + "</div>" +
        (list.length ? list.slice(0, 3).map(function (c) { var s = cropState(c); return '<div class="row" style="justify-content:space-between"><div><b>' + esc(cropName(c)) + '</b><div class="small muted">' + esc(s.line) + '</div></div><span class="pill">' + esc(tx(s.stage)) + "</span></div>"; }).join("")
          : '<p class="muted">' + esc(t("fm.crops_none")) + "</p>") +
        '<a class="btn" href="#/farmer/crops">' + U.icon(list.length ? "wheat" : "plus", "sm") + esc(list.length ? t("fm.see_crops") : t("fm.add_crop")) + "</a></div>";
    }
    crops();
    off.push(PM.on("farm", crops));
    ctl.destroy = function () { ctl.destroyed = true; off.forEach(function (f) { f(); }); };
    return ctl;
  };

  // ---- crops ------------------------------------------------------------------------------------------------------------------------
  function cropName(c) { var r = byId(R.crops, c.crop); return (r ? tx(r) : c.crop) + (c.variety ? " (" + c.variety + ")" : ""); }
  var DAY = 864e5;
  /** Where a crop is in its life, from the sowing date and the usual length of the crop (the middle of its range). */
  function cropState(c) {
    var ref = byId(R.crops, c.crop) || { min: 120, max: 120 }, days = (ref.min + ref.max) / 2;
    var sown = Date.parse(c.sown + "T00:00:00+05:30"), elapsed = (Date.now() - sown) / DAY, frac = Math.max(0, elapsed / days);
    var stage = (R.stages || []).filter(function (s) { return frac <= s.upto; })[0] || R.stages[R.stages.length - 1];
    var harvestMs = sown + days * DAY, left = Math.round(days - elapsed);
    var line = left > 0 ? t("fm.c_days_left", { n: left }) : elapsed - days <= 30 ? t("fm.c_ready") : t("fm.c_past");
    return { stage: stage, frac: Math.min(1, frac), harvestMs: harvestMs, line: line, ready: left <= 0 };
  }
  F.crops = function (root) {
    if (needFarm()) return { destroy: function () {} };
    var farm = PM.store.farm();
    root.innerHTML = '<div class="page" style="max-width:900px"><div class="page-head"><div><h1>' + esc(t("nav.crops")) + '</h1><p class="muted">' + esc(t("fm.crops_sub")) + '</p></div><button class="btn farmer-btn" data-add>' + U.icon("plus") + esc(t("fm.add_crop")) + '</button></div><div class="stack" data-list></div></div>';
    var list = root.querySelector("[data-list]");
    function paint() {
      var crops = PM.store.crops();
      list.innerHTML = crops.length ? crops.map(function (c) {
        var s = cropState(c);
        return '<div class="card stack" data-crop="' + esc(c.id) + '"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h3>' + esc(cropName(c)) + '</h3><div class="small muted">' + esc(t("fm.c_area_line", { area: c.area, date: U.dayText(Date.parse(c.sown + "T00:00:00+05:30")) })) + '</div></div><span class="pill">' + esc(t("fm.c_stage", { stage: tx(s.stage) })) + "</span></div>" +
          '<div class="meter" role="img" aria-label="' + Math.round(s.frac * 100) + '%"><i style="width:' + Math.round(s.frac * 100) + '%;background:var(--farm)"></i></div>' +
          '<div class="row wrap" style="justify-content:space-between"><span class="small">' + U.icon("calendar", "sm") + " " + esc(t("fm.c_harvest", { date: U.dayText(s.harvestMs) })) + " · <b>" + esc(s.line) + '</b></span><span class="row"><button class="btn sm" data-guide="' + esc(c.id) + '">' + U.icon("list", "sm") + esc(t("fm.c_guide")) + '</button><button class="btn ghost sm" data-del="' + esc(c.id) + '">' + U.icon("trash", "sm") + esc(t("fm.c_remove")) + "</button></span></div></div>";
      }).join("") : '<div class="card"><p class="muted">' + esc(t("fm.crops_none")) + "</p></div>";
    }
    paint();
    function guide(c) {
      var s = cropState(c), idx = R.stages.indexOf(s.stage);
      var mod = U.modal({ title: t("fm.c_guide") + ": " + cropName(c), body: '' +
        R.stages.map(function (st, i) { return '<section class="block"><h4>' + (i === idx ? "▶ " : "") + esc(tx(st)) + "</h4><ul style=\"margin:0;padding-left:18px\">" + tx(st.tasks).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></section>"; }).join(""),
        footer: '<button class="btn" data-close>' + esc(t("btn.close")) + "</button>" });
      if (PM.api.mode() !== "live") return;
      var body = mod.el.querySelector(".body"), holder = document.createElement("div");
      holder.innerHTML = '<div class="ai-card"><div class="ai-head"><div class="eyebrow">' + esc(t("fm.c_ai_title")) + "</div>" + aiBadge() + "</div>" + shimmer(4) + "</div>";
      body.insertBefore(holder, body.firstChild);
      var ref = byId(R.crops, c.crop), sownMs = Date.parse(c.sown + "T00:00:00+05:30");
      PM.api.farmerAdvice({ crop: ref ? ref.en : c.crop, sown: c.sown, days_since_sowing: Math.round((Date.now() - sownMs) / DAY), acres: c.area, state: farm.state, soil: (byId(R.soils, farm.soil) || {}).en || "", language: PM._lang }).then(function (res) {
        var r = res.advice;
        holder.innerHTML = '<div class="ai-card fade-in"><div class="ai-head"><div class="eyebrow">' + esc(t("fm.c_ai_title")) + "</div>" + aiBadge() + "</div>" + (r.overview ? "<p>" + esc(r.overview) + "</p>" : "") + (r.stage ? '<p class="small muted">' + esc(r.stage) + "</p>" : "") +
          sec(t("fm.c_ai_tasks"), ul(r.tasks)) + sec(t("fm.c_ai_pests"), r.pests.length ? '<ul style="margin:0;padding-left:18px">' + r.pests.map(function (x) { return "<li><b>" + esc(x.pest) + "</b> (" + esc(t("sev." + x.risk)) + "): " + esc(x.what_to_do) + "</li>"; }).join("") + "</ul>" : "") +
          sec(t("fm.c_ai_weather"), r.weather ? "<p>" + esc(r.weather) + "</p>" : "") + sec(t("fm.c_ai_yield"), r.yield ? "<p>" + esc(r.yield) + "</p>" : "") + "</div>";
      }).catch(function (err) { holder.innerHTML = '<div class="ai-card"><div class="ai-head"><span class="small muted">' + esc(t("fm.d_ai_fail", { why: err.message })) + "</span>" + aiBadge() + "</div></div>"; });
    }
    function addDialog() {
      var today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
      var m = U.modal({ title: t("fm.add_crop"), body: '<div class="field"><label for="c-crop">' + esc(t("fm.c_crop")) + '</label><select id="c-crop" class="input" data-c="crop">' + options(R.crops, "wheat") + "</select></div>" +
        '<div class="field"><label for="c-var">' + esc(t("fm.c_variety")) + '</label><input id="c-var" class="input" data-c="variety" maxlength="60"></div>' +
        '<div class="grid2"><div class="field"><label for="c-area">' + esc(t("fm.c_area")) + '</label><input id="c-area" class="input" data-c="area" type="number" min="0.1" max="10000" step="0.1" inputmode="decimal" value="' + esc(farm.acres) + '"></div>' +
        '<div class="field"><label for="c-sown">' + esc(t("fm.c_sown")) + '</label><input id="c-sown" class="input" data-c="sown" type="date" value="' + today + '"></div></div><p class="small" data-err role="alert" style="color:var(--bad)"></p>',
        footer: '<button class="btn" data-close>' + esc(t("btn.cancel")) + '</button><button class="btn farmer-btn" data-go>' + esc(t("fm.add_crop")) + "</button>" });
      m.el.querySelector("[data-go]").addEventListener("click", function () {
        var v = {}; m.el.querySelectorAll("[data-c]").forEach(function (el) { v[el.getAttribute("data-c")] = el.value.trim(); });
        var area = Number(v.area);
        if (!v.crop || !(area > 0 && area <= 10000) || !/^\d{4}-\d{2}-\d{2}$/.test(v.sown) || isNaN(Date.parse(v.sown))) { m.el.querySelector("[data-err]").textContent = t("fm.c_need"); return; }
        var all = PM.store.crops(); all.unshift({ id: uid(), crop: v.crop, variety: v.variety, area: Math.round(area * 10) / 10, sown: v.sown });
        PM.store.setCrops(all); m.close(); U.toast(t("fm.c_added")); paint();
      });
    }
    root.addEventListener("click", function (e) {
      if (e.target.closest("[data-add]")) { addDialog(); return; }
      var g = e.target.closest("[data-guide]");
      if (g) { guide(byId(PM.store.crops(), g.getAttribute("data-guide"))); return; }
      var d = e.target.closest("[data-del]");
      if (d) {
        var c = byId(PM.store.crops(), d.getAttribute("data-del"));
        var m = U.modal({ title: t("fm.c_remove"), body: "<p>" + esc(t("fm.c_remove_ask", { name: cropName(c) })) + "</p>", footer: '<button class="btn" data-close>' + esc(t("btn.cancel")) + '</button><button class="btn danger" data-go>' + esc(t("fm.c_remove")) + "</button>" });
        m.el.querySelector("[data-go]").addEventListener("click", function () { PM.store.setCrops(PM.store.crops().filter(function (x) { return x.id !== c.id; })); m.close(); U.toast(t("fm.c_removed")); paint(); });
      }
    });
    return { destroy: function () {} };
  };

  // ---- crop doctor: a chat with Gemini, and a standard symptom guide underneath ---------------------------------------------------------
  F.doctor = function (root) {
    var live = PM.api.mode() === "live", history = [], photo = null, busy = false;
    root.innerHTML = '<div class="page" style="max-width:900px"><div class="page-head"><div><h1>' + esc(t("fm.d_title")) + '</h1><p class="muted">' + esc(t("fm.d_sub")) + "</p></div></div>" +
      '<div class="ai-card stack" style="padding:0"><div class="ai-head" style="padding:12px 16px 0"><div class="eyebrow">' + esc(t("fm.ch_title")) + "</div>" + aiBadge() + "</div>" +
      '<div class="chat" style="border:0;height:min(58dvh,520px)"><div class="chat-log" data-log><div class="bubble bot">' + aiBadge() + "<p>" + esc(t("fm.ch_hello")) + "</p></div></div>" +
      '<div class="chat-chips" data-chips>' + ["fm.ch_s1", "fm.ch_s2", "fm.ch_s3"].map(function (k) { return '<button type="button" class="chip" data-sugg="' + k + '">' + esc(t(k)) + "</button>"; }).join("") + "</div>" +
      '<div class="chat-input"><input type="file" accept="image/*" data-photo hidden><button type="button" class="btn icon-only" data-attach aria-label="' + esc(t("fm.ch_attach")) + '" title="' + esc(t("fm.ch_attach")) + '">' + U.icon("camera") + "</button>" +
      '<textarea class="input" data-msg rows="1" maxlength="1000" placeholder="' + esc(t("fm.ch_ph")) + '"' + (live ? "" : " disabled") + '></textarea><button type="button" class="btn farmer-btn" data-send' + (live ? "" : " disabled") + ">" + U.icon("send", "sm") + esc(t("fm.ch_send")) + "</button></div></div>" +
      '<div class="small" data-attached hidden style="padding:0 16px 6px"></div><p class="tiny muted" style="padding:0 16px 12px">' + esc(t("fm.d_photo_note")) + "</p></div>" +
      (live ? "" : '<p class="note warn" style="margin-top:12px">' + U.icon("info") + "<span>" + esc(t("fm.ch_demo")) + "</span></p>") +
      '<details class="card" style="margin-top:16px"><summary style="cursor:pointer;font-weight:600">' + esc(t("fm.ch_guide")) + '</summary><div class="stack" style="margin-top:12px"><fieldset class="stack" style="border:0;padding:0;margin:0;gap:6px"><legend class="label" style="margin-bottom:6px">' + esc(t("fm.d_symptoms")) + "</legend>" +
      (R.symptoms || []).map(function (x) { return '<label class="row check"><input type="checkbox" data-sym="' + esc(x.id) + '"><span>' + esc(tx(x)) + "</span></label>"; }).join("") + '</fieldset><p class="small" data-err role="alert" style="color:var(--bad)"></p><div><button class="btn" data-check>' + esc(t("fm.d_check")) + '</button></div><div class="stack" data-out></div></div></details></div>';
    var $ = function (s) { return root.querySelector(s); }, log = $("[data-log]");
    function bubble(kind, html) {
      var d = document.createElement("div"); d.className = "bubble " + kind; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
    }
    function setPhoto(p) {
      photo = p; var box = $("[data-attached]");
      box.hidden = !p; box.innerHTML = p ? '<img src="' + esc(p.preview) + '" alt="" style="height:44px;border-radius:8px;vertical-align:middle;margin-right:8px">' + esc(t("fm.ch_photo_on")) + ' · <a href="#" data-unphoto>' + esc(t("fm.ch_photo_off")) + "</a>" : "";
    }
    async function send(text) {
      text = (text || "").trim();
      if (!text || busy || !live) return;
      busy = true; $("[data-chips]").hidden = true; $("[data-send]").disabled = true; $("[data-msg]").value = "";
      var sentPhoto = photo; setPhoto(null);
      bubble("user", (sentPhoto ? '<img src="' + esc(sentPhoto.preview) + '" alt="">' : "") + "<p>" + esc(text) + "</p>");
      history.push({ role: "user", text: text });
      var typing = bubble("bot", aiBadge() + '<div class="typing" aria-label="' + esc(t("fm.ch_think")) + '"><i></i><i></i><i></i></div>');
      var turns = history.slice(-10); while (turns.length && turns[0].role !== "user") turns.shift();
      try {
        var res = await PM.api.farmerChat({ messages: turns, image: sentPhoto && sentPhoto.image, mime: sentPhoto && sentPhoto.mime, language: PM._lang });
        history.push({ role: "model", text: res.reply });
        typing.innerHTML = aiBadge() + mdLite(res.reply);
      } catch (err) {
        history.pop();
        typing.className = "bubble bot err"; typing.innerHTML = "<p>" + esc(t("fm.ch_err", { why: err.message })) + "</p>";
      } finally { busy = false; $("[data-send]").disabled = false; log.scrollTop = log.scrollHeight; }
    }
    $("[data-send]").addEventListener("click", function () { send($("[data-msg]").value); });
    $("[data-msg]").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e.target.value); } });
    root.addEventListener("click", function (e) {
      var g = e.target.closest("[data-sugg]");
      if (g) { send(t(g.getAttribute("data-sugg"))); return; }
      if (e.target.closest("[data-attach]")) { $("[data-photo]").click(); return; }
      if (e.target.closest("[data-unphoto]")) { e.preventDefault(); setPhoto(null); }
    });
    $("[data-photo]").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = "";
      if (f && /^image\//.test(f.type)) shrink(f).then(setPhoto).catch(function () { setPhoto(null); });
    });
    // the standard guide (no AI): ticked symptoms matched to common problems
    function diseaseCard(d, top) {
      var chem = d.chemical || [];
      return '<div class="card stack"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="eyebrow">' + esc(top ? t("fm.d_result") : t("fm.d_others")) + "</div><h3>" + esc(tx(d.name)) + '</h3></div><span class="pill">' + esc(t("fm.d_sev", { s: t("sev." + d.severity) })) + "</span></div>" +
        sec(t("fm.d_what"), "<p>" + esc(tx(d.what)) + "</p>") + sec(t("fm.d_organic"), ul(tx(d.organic))) +
        sec(t("fm.d_chemical"), chem.length ? ul(chem.map(function (c) { return t("fm.d_dose", { product: c.product, dose: tx(c.dose), freq: tx(c.freq) }); })) : '<p class="muted">' + esc(t("fm.d_none_chem")) + "</p>") + sec(t("fm.d_cultural"), ul(tx(d.cultural))) + "</div>";
    }
    $("[data-check]").addEventListener("click", function () {
      var ticked = [].slice.call(root.querySelectorAll("[data-sym]:checked")).map(function (el) { return el.getAttribute("data-sym"); });
      if (!ticked.length) { $("[data-err]").textContent = t("fm.d_pick"); $("[data-out]").innerHTML = ""; return; }
      $("[data-err]").textContent = "";
      var sev = { high: 3, medium: 2, low: 1 };
      var hits = (R.diseases || []).map(function (d) { return { d: d, n: d.symptoms.filter(function (x) { return ticked.indexOf(x) >= 0; }).length }; })
        .filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n || sev[b.d.severity] - sev[a.d.severity]; });
      $("[data-out]").innerHTML = hits.map(function (h, i) { return diseaseCard(h.d, i === 0); }).join("") +
        '<div><a class="btn" href="tel:' + esc(R.callCentre) + '">' + U.icon("send", "sm") + esc(t("fm.d_call", { phone: R.callCentre })) + "</a></div>";
    });
    return { destroy: function () {} };
  };

  // ---- stubble and the pledge --------------------------------------------------------------------------------------------------
  var TOX = { low: "low", moderate: "moderate", high: "high", very_high: "very_high" };
  function num(n) { return Number(n).toLocaleString("en-IN", { maximumFractionDigits: n < 10 ? 2 : n < 1000 ? 1 : 0 }); }
  function choiceName(id) { var a = byId(R.alternatives, id); return a ? tx(a) : t("fm.s_other"); }
  function pledgeNumbers(acres) { var e = PM.emissions.fromField(acres); return { pm: e.kg.pm2_5, co2: e.kg.co2 }; }
  function certificate(p) {
    var date = U.dayText(Date.parse(p.ts)) + " " + new Date(Date.parse(p.ts) + 19800000).getUTCFullYear();
    var where = p.where || p.state || "–";
    return '<div class="cert"><div class="cert-mark">' + U.icon("award", "lg") + "</div><h2>" + esc(t("fm.cert_title")) + '</h2><h3 class="muted">' + esc(t("fm.cert_title_hi")) + "</h3>" +
      '<p class="cert-line">' + esc(t("fm.cert_line", { name: p.name, farm: p.farm, where: where, acres: p.acres, choice: choiceName(p.choice) })) + "</p>" +
      '<p class="small">' + esc(t("fm.cert_impact", { pm: num(p.pm), co2: num(p.co2) })) + '</p><div class="row wrap" style="justify-content:space-between"><span class="small">' + esc(t("fm.cert_id", { id: p.id.toUpperCase() })) + '</span><span class="small">' + esc(t("fm.cert_date", { date: date })) + '</span></div><p class="tiny muted">' + esc(t("fm.cert_demo")) + "</p></div>";
  }
  function showCertificate(p) {
    var m = U.modal({ title: t("fm.cert_title"), body: certificate(p), footer: '<button class="btn" data-close>' + esc(t("btn.close")) + '</button><button class="btn farmer-btn" data-print>' + esc(t("fm.cert_print")) + "</button>" });
    m.el.querySelector("[data-print]").addEventListener("click", function () {
      document.body.classList.add("print-cert");
      var done = function () { document.body.classList.remove("print-cert"); window.removeEventListener("afterprint", done); };
      window.addEventListener("afterprint", done);
      window.print();
    });
  }
  var OPT_ICON = { decomposer: "leaf", seeder: "wheat", pellets: "factory", mushroom: "grass", fodder: "tree", other: "sparkle" };
  F.stubble = function (root) {
    var farm = PM.store.farm(), crops = PM.store.crops(), acres = farm ? farm.acres : 5;
    root.innerHTML = '<div class="page st-page"><div class="page-head"><div><h1>' + esc(t("fm.s_title")) + '</h1><p class="muted">' + esc(t("fm.s_sub")) + "</p></div></div>" +
      // 1. the straw and what burning it would do
      '<section class="st-card st-burn"><div class="st-step"><span class="st-num">1</span>' + esc(t("fm.s_hero_title")) + '<span class="src-tag" style="margin-left:auto">' + U.icon("info", "sm") + esc(t("fm.s_calc_tag")) + "</span></div>" +
      '<div class="st-area"><label for="s-area" class="label">' + esc(t("fm.s_area")) + '</label><div class="row"><input id="s-area" class="input st-input" data-area type="number" min="0.1" max="10000" step="0.1" inputmode="decimal" value="' + esc(acres) + '"><span class="muted">' + esc(t("fm.st_acres")) + "</span></div>" +
      (crops.length ? '<div class="quick" style="margin-top:8px">' + crops.map(function (c) { return '<button type="button" class="chip" data-use="' + esc(c.area) + '">' + esc(cropName(c) + " · " + c.area) + "</button>"; }).join("") + "</div>" : "") + "</div>" +
      '<div data-result></div></section>' +
      // 2. what to do instead (AI)
      '<section class="st-card st-plan" data-plan><div class="st-step"><span class="st-num">2</span>' + esc(t("fm.pl_title")) + '<span style="margin-left:auto">' + aiBadge() + '</span></div>' +
      '<div class="row wrap" style="margin-bottom:10px"><label class="st-toggle"><input type="checkbox" data-cattle><span>' + U.icon("tree", "sm") + esc(t("fm.pl_cattle")) + '</span></label><button class="btn farmer-btn" data-makeplan>' + U.icon("sparkle", "sm") + esc(t("fm.pl_make")) + '</button></div><div data-planbody></div></section>' +
      // 3. the pledge
      '<section class="st-card st-go"><div class="st-step"><span class="st-num">3</span>' + esc(t("fm.s_pledge_title")) + '</div><p class="muted" style="margin:0 0 12px">' + esc(t("fm.s_go_pledge")) + '</p><a class="btn farmer-btn lg" href="#/farmer/pledge">' + U.icon("award", "sm") + esc(t("fm.s_pledge_btn")) + "</a></section>" +
      // reference: every option, side by side
      '<details class="st-ref"><summary>' + U.icon("list", "sm") + esc(t("fm.s_ref_title")) + ' <span class="src-tag">' + esc(t("fm.s_ref_tag")) + '</span></summary><div class="opt-grid" data-alts></div></details></div>';
    var $ = function (s) { return root.querySelector(s); };
    var LEVELS = ["low", "moderate", "high", "very_high"];
    function result() {
      var a = Number($("[data-area]").value);
      if (!(a > 0 && a <= 10000)) { $("[data-result]").innerHTML = ""; return; }
      acres = a;
      var e = PM.emissions.fromField(a), tox = e.toxicity, k = e.kg, at = tox ? LEVELS.indexOf(tox.level) : -1;
      var others = [["CO", k.co], ["NO₂", k.no2], ["SO₂", k.so2], [t("fm.s_bc"), k.bc]];
      $("[data-result]").innerHTML = '<div class="fade-in"><p class="st-lead">' + esc(t("fm.s_if_burned", { acres: num(a) })) + '</p><div class="stat-tiles">' +
        '<div class="stat"><b>' + esc(num(e.burned_kg / 1000)) + '</b><span>' + esc(t("fm.st_tonnes")) + '</span></div>' +
        '<div class="stat hot"><b>' + esc(num(k.pm2_5)) + '</b><span>' + esc(t("fm.st_pm")) + '</span></div>' +
        '<div class="stat"><b>' + esc(num(k.co2)) + '</b><span>' + esc(t("fm.st_co2")) + "</span></div></div>" +
        (tox ? '<div class="tox-meter" role="img" aria-label="' + esc(t("tox." + tox.level)) + '">' + LEVELS.map(function (l, i) { return '<i style="background:var(--tox-' + l + ');opacity:' + (i <= at ? 1 : 0.22) + '"></i>'; }).join("") + '</div><p class="small" style="margin-top:6px"><b>' + esc(t("fm.st_tox")) + ": " + esc(t("tox." + tox.level)) + "</b> · " + esc(t("fm.s_toxic", { km3: num(tox.km3), level: t("tox." + tox.level) })) + "</p>" : "") +
        '<p class="small muted">' + others.map(function (o) { return esc(o[0]) + " " + esc(num(o[1])) + " kg"; }).join(" · ") + " · " + esc(t("fm.s_trees", { n: num(Math.round(k.co2 / 22)) })) + "</p></div>";
    }
    result();
    var planning = false, planBox = $("[data-planbody]");
    /** The plan is kept in this browser (one per language) so opening Stubble does not call the AI again. */
    function savedPlan() { var all = U.ls.get("pm.plan", {}) || {}; return all[PM._lang] || null; }
    function savePlan(inp, pl) { var all = U.ls.get("pm.plan", {}) || {}; all[PM._lang] = { inp: inp, plan: pl, at: Date.now() }; U.ls.set("pm.plan", all); }
    function optionCard(o, i) {
      var alt = byId(R.alternatives, o.id), best = i === 0;
      return '<article class="best' + (best ? " top" : "") + '"><div class="best-head"><span class="opt-ico">' + U.icon(OPT_ICON[o.id] || "sparkle", "lg") + '</span><div style="min-width:0">' + (best ? '<span class="best-tag">' + esc(t("fm.pl_best")) + "</span>" : "") + "<h3>" + esc(alt ? tx(alt) : t("fm.s_other")) + "</h3></div></div>" +
        "<p>" + esc(o.why) + "</p>" + ((o.cost || o.gain || alt) ? '<div class="facts-row">' + (o.cost ? '<div><span>' + esc(t("fm.pl_cost")) + "</span><b>" + esc(o.cost) + "</b></div>" : "") + (o.gain ? '<div><span>' + esc(t("fm.pl_gain")) + "</span><b>" + esc(o.gain) + "</b></div>" : "") + (alt ? '<div><span>' + esc(t("fm.s_time")) + "</span><b>" + esc(tx(alt.time)) + "</b></div>" : "") + "</div>" : "") +
        (o.steps.length ? '<ol class="steps">' + o.steps.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>" : "") + "</article>";
    }
    function renderPlan(pl) {
      planBox.innerHTML = '<div class="stack fade-in">' + (pl.summary ? '<p class="st-lead">' + esc(pl.summary) + "</p>" : "") + pl.options.map(optionCard).join("") +
        (pl.timeline.length ? '<div class="tl-h"><h4>' + esc(t("fm.pl_timeline")) + "</h4><ol>" + pl.timeline.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol></div>" : "") +
        (pl.ask_about.length ? '<div class="ask"><h4>' + U.icon("help", "sm") + esc(t("fm.pl_ask")) + "</h4>" + ul(pl.ask_about) + "</div>" : "") + "</div>";
      var top = pl.options[0] && byId(R.alternatives, pl.options[0].id);
      if (top) { try { sessionStorage.setItem("pm.planChoice", top.id); } catch (e) { /* storage may be blocked */ } }
      $("[data-makeplan]").lastChild.textContent = t("fm.pl_again");
    }
    async function makePlan() {
      if (planning) return;
      if (PM.api.mode() !== "live") { planBox.innerHTML = '<p class="note warn">' + U.icon("info") + "<span>" + esc(t("fm.d_ai_demo")) + "</span></p>"; return; }
      var a = Number($("[data-area]").value);
      if (!(a > 0 && a <= 10000)) return;
      planning = true; $("[data-makeplan]").disabled = true; planBox.innerHTML = '<p class="small muted">' + esc(t("fm.pl_wait")) + "</p>" + shimmer(4);
      var first = PM.store.crops()[0], ref = first && byId(R.crops, first.crop);
      var inp = { acres: a, crop: ref ? ref.en : "Rice (paddy)", state: farm && farm.state, soil: farm && (byId(R.soils, farm.soil) || {}).en, cattle: $("[data-cattle]").checked };
      try {
        var res = await PM.api.farmerPlan(Object.assign({ language: PM._lang }, inp));
        savePlan(inp, res.plan);
        renderPlan(res.plan);
      } catch (err) { planBox.innerHTML = '<p class="note warn">' + U.icon("alert") + "<span>" + esc(t("fm.pl_fail", { why: err.message })) + "</span></p>"; }
      finally { planning = false; $("[data-makeplan]").disabled = false; }
    }
    $("[data-makeplan]").addEventListener("click", makePlan);  // "Make it again" is the only way to ask the AI a second time
    var kept = savedPlan();
    if (kept) {
      $("[data-cattle]").checked = !!kept.inp.cattle; $("[data-area]").value = kept.inp.acres; result();
      renderPlan(kept.plan);  // from this browser: no AI call
    } else if (PM.api.mode() === "live") makePlan();  // the first time only
    $("[data-alts]").innerHTML = R.alternatives.map(function (a) {
      return '<article class="opt"><div class="best-head"><span class="opt-ico">' + U.icon(OPT_ICON[a.id] || "sparkle") + "</span><h3>" + esc(tx(a)) + '</h3></div><p class="small">' + esc(tx(a.what)) + '</p><div class="facts-row">' +
        [["fm.s_cost", tx(a.cost)], ["fm.s_gain", tx(a.gain)], ["fm.s_time", tx(a.time)]].map(function (r) { return "<div><span>" + esc(t(r[0])) + "</span><b>" + esc(r[1]) + "</b></div>"; }).join("") + '</div><p class="tiny muted">' + esc(t("fm.s_effort")) + ": " + esc(t("fm.effort_" + a.effort)) + " · " + esc(tx(a.scheme)) + "</p></article>";
    }).join("");
    root.addEventListener("input", function (e) { if (e.target.matches("[data-area]")) result(); });
    root.addEventListener("click", function (e) {
      var u = e.target.closest("[data-use]");
      if (u) { $("[data-area]").value = u.getAttribute("data-use"); result(); }
    });
    return { destroy: function () {} };
  };

  // ---- the no-burn pledge: its own page ---------------------------------------------------------------------------------------------
  F.pledge = function (root) {
    var farm = PM.store.farm(), crops = PM.store.crops(), acres = farm ? farm.acres : 5, choice = "decomposer";
    try { var saved = sessionStorage.getItem("pm.planChoice"); if (saved && byId(R.alternatives, saved)) choice = saved; } catch (e) { /* storage may be blocked */ }
    root.innerHTML = '<div class="page" style="max-width:760px"><div class="page-head"><div><h1>' + esc(t("fm.s_pledge_title")) + '</h1><p class="muted">' + esc(t("fm.s_pledge_text")) + "</p></div></div>" +
      '<div class="card stack"><div class="field"><label for="p-area">' + esc(t("fm.s_area")) + '</label><input id="p-area" class="input" data-area type="number" min="0.1" max="10000" step="0.1" inputmode="decimal" value="' + esc(acres) + '" style="max-width:220px"></div>' +
      (crops.length ? '<div class="quick">' + crops.map(function (c) { return '<button type="button" class="chip" data-use="' + esc(c.area) + '">' + esc(cropName(c) + " · " + c.area) + "</button>"; }).join("") + "</div>" : "") +
      '<div class="field"><label>' + esc(t("fm.s_choice")) + '</label><div class="stack" style="gap:6px" data-choices></div></div>' +
      (farm ? "" : '<p class="note warn">' + U.icon("alert") + "<span>" + esc(t("fm.s_need_farm")) + ' <a href="#/farmer/setup">' + esc(t("fm.setup_title")) + "</a></span></p>") +
      '<p class="small" data-err role="alert" style="color:var(--bad)"></p><div><button class="btn farmer-btn lg" data-take' + (farm ? "" : " disabled") + ">" + U.icon("award", "sm") + esc(t("fm.s_pledge_btn")) + "</button></div></div>" +
      '<div class="card stack" style="margin-top:16px" data-history></div></div>';
    var $ = function (s) { return root.querySelector(s); };
    var all = R.alternatives.map(function (a) { return { id: a.id, label: tx(a) }; }).concat([{ id: "other", label: t("fm.s_other") }]);
    $("[data-choices]").innerHTML = all.map(function (c) { return '<label class="row check"><input type="radio" name="s-choice" value="' + esc(c.id) + '"' + (c.id === choice ? " checked" : "") + "><span>" + esc(c.label) + "</span></label>"; }).join("");
    function history() {
      var list = PM.store.pledges(), tot = list.reduce(function (s, p) { return { a: s.a + p.acres, pm: s.pm + p.pm }; }, { a: 0, pm: 0 });
      $("[data-history]").innerHTML = "<h3>" + esc(t("fm.s_history")) + "</h3>" + (list.length ? '<p class="small muted">' + esc(t("fm.s_total", { n: list.length, acres: num(tot.a), pm: num(tot.pm) })) + "</p>" + list.slice(0, 8).map(function (p) {
        return '<div class="row" style="justify-content:space-between"><span class="small">' + esc(t("fm.s_line", { acres: p.acres, choice: choiceName(p.choice), date: U.dayText(Date.parse(p.ts)) })) + '</span><button class="btn sm" data-cert="' + esc(p.id) + '">' + U.icon("award", "sm") + esc(t("fm.s_view")) + "</button></div>";
      }).join("") : '<p class="muted">' + esc(t("fm.s_hist_none")) + "</p>");
    }
    history();
    var offs = [PM.on("farm", history)];
    root.addEventListener("change", function (e) { if (e.target.matches('[name="s-choice"]')) choice = e.target.value; });
    root.addEventListener("click", function (e) {
      var u = e.target.closest("[data-use]");
      if (u) { $("[data-area]").value = u.getAttribute("data-use"); return; }
      var c = e.target.closest("[data-cert]");
      if (c) { showCertificate(byId(PM.store.pledges(), c.getAttribute("data-cert"))); return; }
      if (e.target.closest("[data-take]") && farm) {
        var a = Number($("[data-area]").value);
        if (!(a > 0 && a <= 10000)) { $("[data-err]").textContent = t("fm.c_need"); return; }
        var n = pledgeNumbers(a);
        var p = { id: uid(), ts: new Date().toISOString(), acres: Math.round(a * 10) / 10, choice: choice, name: farm.owner, farm: farm.name, where: [farm.village, farm.district, farm.state].filter(Boolean).join(", "), pm: n.pm, co2: n.co2 };
        PM.store.addPledge(p); U.toast(t("fm.s_pledged")); showCertificate(p);
      }
    });
    return { destroy: function () { offs.forEach(function (f) { f(); }); } };
  };

  // ---- warnings and alerts inbox ------------------------------------------------------------------------------------------------
  F.alerts = function (root) {
    if (needFarm()) return { destroy: function () {} };
    var farm = PM.store.farm(), ctl = { destroyed: false };
    root.innerHTML = '<div class="page" style="max-width:760px"><div class="page-head"><div><h1>' + esc(t("fm.al_title")) + '</h1><p class="muted">' + esc(t("fm.al_sub")) + '</p></div></div><div class="stack" data-warn>' + loading(60) + '</div><h2 style="margin:22px 0 10px;font-size:20px">' + esc(t("fm.al_smoke")) + '</h2><div class="stack" data-smoke>' + loading(50) + "</div></div>";
    var $ = function (s) { return root.querySelector(s); };
    function warnings() {
      PM.api.farmerWarnings(farm).then(function (list) {
        if (ctl.destroyed) return;
        list.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
        $("[data-warn]").innerHTML = (list.length ? list.map(warningCard).join("") : '<div class="card"><p class="muted">' + esc(t("fm.warn_none")) + "</p></div>") + '<p class="tiny muted">' + esc(t("fm.warn_note")) + "</p>";
      }).catch(function (e) { if (!ctl.destroyed) $("[data-warn]").innerHTML = errorBox(e.message, warnings); });
    }
    function smoke() {
      PM.api.alertsNear(farm).then(function (list) {
        if (ctl.destroyed) return;
        var read = PM.store.read(), fresh = list.map(function (a) { return a.id; }).filter(function (id) { return read.indexOf(id) < 0; });
        if (fresh.length) PM.store.markRead(fresh);  // markRead tells everyone "alerts changed", so only call it when something is new
        $("[data-smoke]").innerHTML = list.length ? list.map(function (a) {
          return '<div class="alert-card"><span class="ic">' + U.icon("bell") + '</span><div><b>' + esc(t("cz.alert_title", { place: (a.fire && (a.fire.near || a.fire.state)) || t("cz.unknown_place") })) + '</b><div class="small muted">' + esc(U.rel(U.parse(a.created_at) || 0, PM.now())) + '</div><p class="body small">' + esc(a.message) + "</p></div></div>";
        }).join("") : '<div class="card"><p class="muted">' + esc(t("cz.no_alerts")) + "</p></div>";
      }).catch(function () { if (!ctl.destroyed) $("[data-smoke]").innerHTML = '<div class="card"><p class="muted">' + esc(t("cz.no_alerts")) + "</p></div>"; });
    }
    warnings(); smoke();
    bindAck(root, warnings);
    var offs = [PM.on("alerts", function () { warnings(); smoke(); }), PM.on("cases", warnings)];
    ctl.destroy = function () { ctl.destroyed = true; offs.forEach(function (f) { f(); }); };
    return ctl;
  };
})((window.PM = window.PM || {}));
