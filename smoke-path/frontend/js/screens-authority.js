/* Authority screens: command dashboard (KPIs, map, fire queue, fire detail with actions), fires table,
   cases board and the activity log. Everything an authority does ends in a case with a timeline. */
(function (PM) {
  "use strict";
  var U = PM.U, esc = U.esc, t = function (k, v) { return PM.t(k, v); };
  var A = (PM.authority = {});

  // ---- filters live across screens so the dashboard and the table agree -------------------------------------
  var F = (A.filters = { types: {}, state: "", status: "", q: "", sort: "tox" });
  var TYPE_ORDER = ["farm", "industrial", "waste", "settlement", "forest", "grassland", "unknown"];
  var COVER_COLORS = { cropland: "#eab308", "built-up": "#64748b", trees: "#15803d", shrubs: "#84cc16", grass: "#a3e635", water: "#3b82f6", wetland: "#06b6d4", "bare ground": "#d6b98c", snow: "#e5e7eb", moss: "#99f6e4", mangroves: "#065f46" };
  var RANK = { "very high": 4, high: 3, moderate: 2, low: 1 };

  function casesMap(list) { var m = {}; (list || []).forEach(function (c) { m[c.fire_id] = c; }); return m; }
  function statusOf(f, cm) { return (cm[f.key] && cm[f.key].status) || "new"; }
  function title(f) { return f.near ? t("auth.near", { place: f.near }) : t("auth.fire", { id: f.id }); }
  function where(f) { return [f.near, f.state].filter(Boolean).join(", ") || "Fire " + f.id; }
  function statusChip(s) { return '<span class="status ' + s + '">' + esc(t("status." + s)) + "</span>"; }
  function toxPill(f) {
    return f.tox ? '<span class="tox ' + U.toxKey(f.level) + '">' + esc(U.num(f.km3, 1)) + " km³ · " + esc(t("tox." + U.toxKey(f.level))) + "</span>"
      : '<span class="tox">' + esc(t("auth.not_estimated")) + "</span>";
  }
  function sourceRole(f) { var ty = f.p.fire_type; return ty === "farm" ? "farmer" : ty === "industrial" ? "owner" : ty === "waste" ? "municipal" : "other"; }

  /** Keep the chips on the map in step with the ones in the panel. */
  function syncMapChips() {
    var any = Object.keys(F.types).some(function (k) { return F.types[k]; });
    document.querySelectorAll("[data-ftype]").forEach(function (c) {
      var k = c.getAttribute("data-ftype");
      c.setAttribute("aria-pressed", String(k === "all" ? !any : !!F.types[k]));
    });
  }
  function typeFilterOn() { return Object.keys(F.types).some(function (k) { return F.types[k]; }); }

  function applyFilters(fires, cm) {
    var q = F.q.trim().toLowerCase(), types = Object.keys(F.types).filter(function (k) { return F.types[k]; });
    var out = fires.filter(function (f) {
      if (types.length && types.indexOf(f.p.fire_type || "unknown") < 0) return false;
      if (F.state && f.state !== F.state) return false;
      if (F.status && statusOf(f, cm) !== F.status) return false;
      if (q && (f.near + " " + f.state + " " + f.id + " " + U.typeName(f.p)).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      tox: function (a, b) { return (b.km3 == null ? -1 : b.km3) - (a.km3 == null ? -1 : a.km3); },
      power: function (a, b) { return (b.p.frp_mw || 0) - (a.p.frp_mw || 0); },
      new: function (a, b) { return b.seenMs - a.seenMs; },
      places: function (a, b) { return (b.p.places_reached || 0) - (a.p.places_reached || 0); },
    }[F.sort] || function () { return 0; };
    return out.sort(by);
  }

  function filterControls(model, cm) {
    var counts = {};
    model.fires.forEach(function (f) { var k = f.p.fire_type || "unknown"; counts[k] = (counts[k] || 0) + 1; });
    var states = {};
    model.fires.forEach(function (f) { if (f.state) states[f.state] = (states[f.state] || 0) + 1; });
    var anyOn = TYPE_ORDER.some(function (k) { return F.types[k]; });
    var chips = '<button class="chip" data-type="all" aria-pressed="' + !anyOn + '">' + esc(t("filter.all")) + " " + model.fires.length + "</button>" + TYPE_ORDER.filter(function (k) { return counts[k]; }).map(function (k) {
      return '<button class="chip" data-type="' + k + '" aria-pressed="' + !!F.types[k] + '"><i class="dot" style="background:' + U.FIRE_TYPES[k].color + '"></i>' +
        esc(t("type." + k)) + (k === "industrial" ? "*" : "") + " " + counts[k] + "</button>";
    }).join("") + '<span class="tiny muted typenote">' + esc(t("filter.industry_note")) + "</span>";
    var stateOpts = '<option value="">' + esc(t("auth.all_states")) + "</option>" + Object.keys(states).sort().map(function (s) {
      return '<option value="' + esc(s) + '"' + (F.state === s ? " selected" : "") + ">" + esc(s) + " (" + states[s] + ")</option>";
    }).join("");
    var statusOpts = '<option value="">' + esc(t("auth.all_status")) + "</option>" + PM.STATUSES.map(function (s) {
      return '<option value="' + s + '"' + (F.status === s ? " selected" : "") + ">" + esc(t("status." + s)) + "</option>";
    }).join("");
    var sortOpts = [["tox", "sort.tox"], ["power", "sort.power"], ["new", "sort.new"], ["places", "sort.places"]].map(function (o) {
      return '<option value="' + o[0] + '"' + (F.sort === o[0] ? " selected" : "") + ">" + esc(t(o[1])) + "</option>";
    }).join("");
    return '<div class="search"><span aria-hidden="true">' + U.icon("search") + '</span><input class="input" data-q type="search" placeholder="' + esc(t("auth.search")) + '" aria-label="' + esc(t("auth.search")) + '" value="' + esc(F.q) + '"></div>' +
      '<div class="row wrap" style="gap:6px">' + chips + "</div>" +
      '<div class="row" style="gap:6px"><select class="input" data-state aria-label="State">' + stateOpts + '</select><select class="input" data-status aria-label="Status">' + statusOpts +
      '</select><select class="input" data-sort aria-label="Sort">' + sortOpts + "</select></div>";
  }
  function bindFilters(root, refresh) {
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-type]");
      if (b && root.contains(b)) {
        U.toggleType(F.types, b.getAttribute("data-type")); refresh(true);
        syncMapChips();
      }
    });
    root.addEventListener("input", function (e) { if (e.target.matches("[data-q]")) { F.q = e.target.value; refresh(false); } });
    root.addEventListener("change", function (e) {
      if (e.target.matches("[data-state]")) F.state = e.target.value;
      else if (e.target.matches("[data-status]")) F.status = e.target.value;
      else if (e.target.matches("[data-sort]")) F.sort = e.target.value;
      else return;
      refresh(true);
    });
  }

  // ---- messages: ready-made text by fire type and language, always editable ---------------------------------------
  var TEXT = {
    en: {
      farm: "Satellite data shows a fire in your field near {near} at {time}. Burning crop residue is not allowed and harms the health of people nearby. Please put it out now and do not burn again. A Happy Seeder can sow without burning, or you can sell the straw. For help, contact your district agriculture office.",
      industrial: "Satellite data shows a fire or heat source at your site near {near} at {time}. Burning waste, tyres or fuel in the open pollutes the air and is not allowed. Please check the site now, stop any open burning and reply to this office within 24 hours.",
      waste: "Satellite data shows a fire at the landfill or waste site near {near} at {time}. Open burning of waste harms people living nearby. Please send a team to put it out and report back to this office within 24 hours.",
      other: "Satellite data shows a fire near {near} at {time}. Please check the site, put out any open fire and report back to this office.",
      public: "Smoke alert: a {type} fire {where} is sending smoke towards {places}. {arrive} Keep windows closed, avoid outdoor exercise, keep children and elderly people indoors, and wear an N95 mask if you must go out.",
      future: "It may reach {first} from about {when}.", past: "It has already reached {first} (since about {when}).",
    },
    hi: {
      farm: "सैटेलाइट के अनुसार {time} पर {near} के पास आपके खेत में आग लगी थी। पराली जलाना मना है और इससे आसपास के लोगों की सेहत बिगड़ती है। कृपया आग तुरंत बुझाएँ और दोबारा न जलाएँ। हैप्पी सीडर से बिना जलाए बुवाई हो सकती है, या आप पराली बेच सकते हैं। मदद के लिए अपने ज़िला कृषि कार्यालय से संपर्क करें।",
      industrial: "सैटेलाइट के अनुसार {time} पर {near} के पास आपकी साइट पर आग या गर्मी का स्रोत मिला है। खुले में कचरा, टायर या ईंधन जलाने से हवा खराब होती है और यह मना है। कृपया साइट की तुरंत जाँच करें, खुले में जलाना बंद करें और 24 घंटे के भीतर इस कार्यालय को जवाब दें।",
      waste: "सैटेलाइट के अनुसार {time} पर {near} के पास कूड़ा स्थल (लैंडफिल) में आग लगी है। कचरे को खुले में जलाने से आसपास रहने वालों को नुकसान होता है। कृपया आग बुझाने के लिए टीम भेजें और 24 घंटे के भीतर इस कार्यालय को सूचित करें।",
      other: "सैटेलाइट के अनुसार {time} पर {near} के पास आग लगी है। कृपया जगह की जाँच करें, खुली आग बुझाएँ और इस कार्यालय को सूचित करें।",
      public: "धुएँ की चेतावनी: {where} {type} में आग लगी है और धुआँ {places} की ओर जा रहा है। {arrive} खिड़कियाँ बंद रखें, बाहर कसरत न करें, बच्चों और बुज़ुर्गों को घर के अंदर रखें, और बाहर जाना ज़रूरी हो तो N95 मास्क पहनें।",
      future: "{when} के आसपास यह {first} तक पहुँच सकता है।", past: "यह {first} तक पहुँच चुका है (लगभग {when} से)।",
    },
  };
  function fill(text, vars) { return text.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }); }
  function typeWord(f, lang) {
    var en = { farm: "farm", industrial: "factory or kiln", waste: "landfill", settlement: "town", forest: "forest", grassland: "grass", unknown: "" };
    var hi = { farm: "खेत", industrial: "फ़ैक्टरी या भट्ठे", waste: "कूड़ा स्थल", settlement: "शहरी इलाके", forest: "जंगल", grassland: "घास", unknown: "" };
    return (lang === "hi" ? hi : en)[f.p.fire_type || "unknown"] || (lang === "hi" ? "आग" : "");
  }
  function sourceText(f, lang) {
    var ty = f.p.fire_type, kind = ty === "farm" || ty === "industrial" || ty === "waste" ? ty : "other";
    return fill(TEXT[lang][kind], { near: f.near || (lang === "hi" ? "आपके इलाके" : "your area"), time: U.when(f.seenMs, PM.now()) });
  }
  function whereText(f, lang) {
    var st = f.state ? " (" + f.state + ")" : "";
    if (lang === "hi") return f.near ? f.near + st + " के पास" : f.state ? f.state + " में" : "आपके आसपास";
    return f.near ? "near " + f.near + st : f.state ? "in " + f.state : "nearby";
  }
  function publicText(f, places, lang) {
    var names = places.slice(0, 3).map(function (p) { return p.name; });
    var more = places.length - names.length;
    var list = names.join(", ") + (more > 0 ? (lang === "hi" ? " और " + more + " अन्य जगहें" : " and " + more + " more places") : "");
    var first = places[0], arrive = "";
    if (first) arrive = fill(TEXT[lang][first.t > PM.now() ? "future" : "past"], { first: first.name, when: U.when(first.t, PM.now()) });
    return fill(TEXT[lang].public, {
      type: typeWord(f, lang), where: whereText(f, lang), places: list, arrive: arrive,
    }).replace(/  +/g, " ");
  }
  A.text = { source: sourceText, pub: publicText };

  // ---- the two action dialogs -----------------------------------------------------------------------------------------
  function langSeg(lang) {
    return '<div class="seg" role="group" aria-label="Language"><button type="button" data-lang="en" aria-pressed="' + (lang === "en") + '">English</button>' +
      '<button type="button" data-lang="hi" aria-pressed="' + (lang === "hi") + '">हिन्दी</button></div>';
  }
  function whoNote() { return '<div class="note warn">' + U.icon("info") + "<span>" + esc(t("auth.lookup_note")) + "</span></div>"; }

  function warnDialog(f, done) {
    var role = sourceRole(f), reg = (window.PM_REGISTRY || {})[role] || [], lang = "en", edited = false, mode = reg.length ? "registry" : "typed";
    var m = U.modal({
      title: t("auth.warn_title", { who: t("role." + role) }),
      body:
        '<div class="row spread wrap"><div><div class="label">' + esc(t("auth.fire_label")) + "</div><b>" + esc(where(f)) + '</b> <span class="muted small">· ' + esc(U.typeName(f.p)) + "</span></div>" + langSeg(lang) + "</div>" +
        '<div class="field"><span class="label">' + esc(t("auth.send_to")) + "</span>" +
        '<div class="seg" role="group"><button type="button" data-mode="registry" aria-pressed="' + (mode === "registry") + '">' + esc(t("auth.demo_registry")) + '</button><button type="button" data-mode="typed" aria-pressed="' + (mode === "typed") + '">' + esc(t("auth.type_contact")) + "</button></div></div>" +
        '<div data-pane="registry"' + (mode === "registry" ? "" : " hidden") + ' class="field"><select class="input" data-pick aria-label="' + esc(t("auth.send_to")) + '">' +
        reg.map(function (r, i) { return '<option value="' + i + '">' + esc(r.name + " · " + r.contact + " (demo)") + "</option>"; }).join("") + "</select></div>" +
        '<div data-pane="typed"' + (mode === "typed" ? "" : " hidden") + ' class="row wrap"><div class="field grow"><label for="w-name">' + esc(t("auth.name")) + '</label><input id="w-name" class="input" data-name maxlength="100"></div>' +
        '<div class="field grow"><label for="w-contact">' + esc(t("auth.contact")) + '</label><input id="w-contact" class="input" data-contact maxlength="120" placeholder="+91… or name@example.com"></div></div>' +
        whoNote() +
        '<div class="field"><label for="w-msg">' + esc(t("auth.message")) + '</label><textarea id="w-msg" class="input" data-msg maxlength="1200">' + esc(sourceText(f, lang)) + '</textarea><button type="button" class="btn ghost sm" data-reset-text style="align-self:flex-start">' + esc(t("auth.reset_text")) + "</button></div>" +
        '<p class="small muted" data-err style="color:var(--bad)" role="alert"></p>',
      footer: '<button class="btn" data-close>' + esc(t("btn.cancel")) + '</button><button class="btn fire" data-send>' + U.icon("send") + '<span data-send-label></span></button>',
    });
    var el = m.el, $ = function (s) { return el.querySelector(s); };
    function recipient() {
      if (mode === "registry") { var r = reg[Number($("[data-pick]").value)] || reg[0]; return r ? { name: r.name, contact: r.contact, role: role, demo: true } : null; }
      var name = $("[data-name]").value.trim(), contact = $("[data-contact]").value.trim();
      return name && contact ? { name: name, contact: contact, role: role, demo: false } : null;
    }
    function label() { var r = recipient(); $("[data-send-label]").textContent = r ? t("auth.send_warning_to", { who: r.name }) : t("auth.send_warning"); }
    el.addEventListener("click", function (e) {
      var l = e.target.closest("[data-lang]"), md = e.target.closest("[data-mode]");
      if (l) {
        lang = l.getAttribute("data-lang");
        el.querySelectorAll("[data-lang]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === l)); });
        if (!edited) $("[data-msg]").value = sourceText(f, lang);
        else U.toast(t("auth.kept_edit"));
      }
      if (md) {
        mode = md.getAttribute("data-mode");
        el.querySelectorAll("[data-mode]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === md)); });
        el.querySelectorAll("[data-pane]").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== mode; });
        label();
      }
      if (e.target.closest("[data-reset-text]")) { $("[data-msg]").value = sourceText(f, lang); edited = false; }
      if (e.target.closest("[data-send]")) send();
    });
    el.addEventListener("input", function (e) { if (e.target.matches("[data-msg]")) edited = true; label(); });
    el.addEventListener("change", label);
    label();
    async function send() {
      var r = recipient(), err = $("[data-err]");
      if (!r) { err.textContent = t("auth.need_contact"); return; }
      var btn = $("[data-send]"); btn.disabled = true;
      try {
        var res = await PM.api.sendAlert({ fire_id: f.key, kind: "source_warning", target: r, message: $("[data-msg]").value, language: lang, fire: fireContext(f) });
        m.close();
        U.toast(t(res.sent === "sent" ? "auth.sent_ok" : "auth.sent_demo", { who: r.name }));
        done && done();
      } catch (e2) { err.textContent = e2.message; btn.disabled = false; }
    }
  }

  function fireContext(f) {
    return { near: f.near, state: f.state, type: f.p.fire_type || "unknown", type_label: f.p.fire_type_label || "", level: f.level || "", lat: f.lat, lon: f.lon, km3: f.km3 == null ? undefined : f.km3 };
  }

  function alertDialog(f, model, done) {
    var all = model.placesOn(f), lang = "en", edited = false;
    var GROUPS = [["village", ["village"]], ["town", ["town", "city"]], ["school", ["school", "college"]], ["hospital", ["hospital", "clinic"]]];
    var on = {};
    GROUPS.forEach(function (g) { on[g[0]] = true; });
    function chosen() {
      var types = [];
      GROUPS.forEach(function (g) { if (on[g[0]]) types = types.concat(g[1]); });
      return all.filter(function (p) { return types.indexOf(p.type) >= 0; });
    }
    var counts = {};
    GROUPS.forEach(function (g) { counts[g[0]] = all.filter(function (p) { return g[1].indexOf(p.type) >= 0; }).length; });
    var m = U.modal({
      title: t("auth.alert_title"),
      body:
        '<div class="row spread wrap"><div><div class="label">' + esc(t("auth.fire_label")) + "</div><b>" + esc(where(f)) + '</b> <span class="muted small">· ' + esc(U.typeName(f.p)) + "</span></div>" + langSeg(lang) + "</div>" +
        '<div class="field"><span class="label">' + esc(t("auth.who_gets")) + '</span><div class="row wrap" style="gap:6px">' +
        GROUPS.filter(function (g) { return counts[g[0]]; }).map(function (g) {
          return '<button type="button" class="chip" data-g="' + g[0] + '" aria-pressed="true">' + esc(t("grp." + g[0])) + " " + counts[g[0]] + "</button>";
        }).join("") + "</div></div>" +
        '<div><div class="label" data-count></div><div class="places" data-places style="margin-top:6px"></div></div>' +
        '<div class="field"><label for="a-msg">' + esc(t("auth.message")) + '</label><textarea id="a-msg" class="input" data-msg maxlength="1200"></textarea><button type="button" class="btn ghost sm" data-reset-text style="align-self:flex-start">' + esc(t("auth.reset_text")) + "</button></div>" +
        '<div class="note">' + U.icon("info") + "<span>" + esc(t("auth.alert_note")) + "</span></div>" +
        '<p class="small" data-err style="color:var(--bad)" role="alert"></p>',
      footer: '<button class="btn" data-close>' + esc(t("btn.cancel")) + '</button><button class="btn fire" data-send>' + U.icon("send") + '<span data-send-label></span></button>',
    });
    var el = m.el, $ = function (s) { return el.querySelector(s); };
    function paint() {
      var list = chosen();
      $("[data-count]").textContent = t("auth.places_count", { n: list.length });
      $("[data-places]").innerHTML = list.slice(0, 60).map(function (p) {
        return '<div class="place"><span>' + esc(p.name) + ' <span class="faint small">' + esc(p.type) + '</span></span><span class="t">' + esc(U.when(p.t, PM.now())) + "</span></div>";
      }).join("") + (list.length > 60 ? '<div class="small muted" style="padding:6px 8px">+ ' + (list.length - 60) + " more</div>" : "");
      if (!edited) $("[data-msg]").value = publicText(f, list, lang);
      $("[data-send-label]").textContent = t("auth.send_alert_to", { n: list.length });
      $("[data-send]").disabled = !list.length;
    }
    el.addEventListener("click", function (e) {
      var g = e.target.closest("[data-g]"), l = e.target.closest("[data-lang]");
      if (g) { var k = g.getAttribute("data-g"); on[k] = !on[k]; g.setAttribute("aria-pressed", String(on[k])); paint(); }
      if (l) {
        lang = l.getAttribute("data-lang");
        el.querySelectorAll("[data-lang]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === l)); });
        if (!edited) paint(); else U.toast(t("auth.kept_edit"));
      }
      if (e.target.closest("[data-reset-text]")) { edited = false; paint(); }
      if (e.target.closest("[data-send]")) send();
    });
    el.addEventListener("input", function (e) { if (e.target.matches("[data-msg]")) edited = true; });
    paint();
    async function send() {
      var list = chosen().slice(0, 300), btn = $("[data-send]"), err = $("[data-err]");
      btn.disabled = true;
      try {
        var res = await PM.api.sendAlert({
          fire_id: f.key, kind: "public_alert", message: $("[data-msg]").value, language: lang, fire: fireContext(f),
          target: { places: list.map(function (p) { return { name: p.name, lat: p.lat, lon: p.lon, place_type: p.type, arrival: U.isoIST(p.t) }; }) },
        });
        m.close();
        U.toast(t(res.sent === "sent" ? "auth.alert_ok" : "auth.alert_demo", { n: list.length }));
        done && done();
      } catch (e2) { err.textContent = e2.message; btn.disabled = false; }
    }
  }

  function dismissDialog(apply) {
    var m = U.modal({
      title: t("btn.status.dismissed"),
      body: '<div class="field"><label for="d-why">' + esc(t("auth.dismiss_why")) + '</label><textarea id="d-why" class="input" data-why maxlength="300" style="min-height:90px"></textarea></div><p class="small" data-err style="color:var(--bad)" role="alert"></p>',
      footer: '<button class="btn" data-close>' + esc(t("btn.cancel")) + '</button><button class="btn danger" data-go>' + esc(t("btn.status.dismissed")) + "</button>",
    });
    m.el.querySelector("[data-go]").addEventListener("click", async function () {
      var why = m.el.querySelector("[data-why]").value.trim();
      if (!why) { m.el.querySelector("[data-err]").textContent = t("auth.dismiss_need"); return; }
      if (await apply(why)) m.close();
    });
  }

  // ---- fire detail ----------------------------------------------------------------------------------------------------------
  function coverBar(p) {
    var c = p.land_cover || {}, keys = Object.keys(c);
    if (!keys.length) return "";
    return '<div class="stackbar" role="img" aria-label="Land cover">' + keys.map(function (k) { return '<span style="width:' + c[k] + "%;background:" + (COVER_COLORS[k] || "#999") + '" title="' + esc(k + " " + c[k] + "%") + '"></span>'; }).join("") + "</div>" +
      '<div class="row wrap small muted" style="gap:4px 12px;margin-top:6px">' + keys.map(function (k) { return '<span><i class="dot" style="background:' + (COVER_COLORS[k] || "#999") + '"></i> ' + esc(k) + " " + c[k] + "%</span>"; }).join("") + "</div>";
  }
  /** A fire outside the factory/kiln data area: say that a factory fire there could be labelled as something else. */
  function outsideNote(f) {
    if (f.p.fire_type === "industrial" || U.insideIndustryBox(f.lat, f.lon)) return "";
    return '<div class="note" style="margin-top:10px">' + U.icon("info") + "<span>" + esc(t("auth.outside_note")) + "</span></div>";
  }
  function toxBlock(f, openAll) {
    var e = f.p.emissions;
    if (!e || !e.toxicity) return '<div class="note">' + U.icon("info") + "<span>" + esc(t("auth.tox_none")) + "</span></div>";
    var x = e.toxicity, keys = Object.keys(x.shares);
    var bar = '<div class="stackbar">' + keys.map(function (k) { return '<span style="width:' + x.shares[k] + "%;background:" + (U.TOX_COLORS[k] || "#999") + '"></span>'; }).join("") + "</div>";
    var rows = keys.slice(0, 5).map(function (k) {
      return '<div><div class="row spread small"><span><i class="dot" style="background:' + (U.TOX_COLORS[k] || "#999") + '"></i> ' + esc(U.EM_NAMES[k] || k) + "</span><b>" + x.shares[k] + '%</b></div><div class="meter" style="margin-top:3px"><i style="width:' + x.shares[k] + "%;background:" + (U.TOX_COLORS[k] || "#999") + '"></i></div></div>';
    }).join("");
    var kg = e.kg || {};
    var table = Object.keys(kg).map(function (k) { return "<dt>" + esc(U.EM_NAMES[k] || k) + "</dt><dd>" + (kg[k] >= 1000 ? U.num(kg[k] / 1000, 1) + " t" : U.num(kg[k], kg[k] < 10 ? 2 : 0) + " kg") + "</dd>"; }).join("");
    return '<div class="tox-big"><b>' + U.num(x.km3, 1) + '</b><span class="muted">km³ ' + esc(t("auth.of_air")) + '</span></div><div class="row" style="margin:6px 0 10px"><span class="tox ' + U.toxKey(x.level) + '">' + esc(t("tox." + U.toxKey(x.level))) + "</span>" +
      '<span class="small muted">' + esc(t("auth.burn_rate", { t: U.num(e.burned_kg / 1000, 1) })) + "</span></div>" + bar +
      '<div class="stack" style="gap:8px;margin-top:10px">' + rows + "</div>" +
      '<details' + (openAll ? " open" : "") + ' style="margin-top:10px"><summary class="small muted" style="cursor:pointer">' + esc(t("auth.per_hour")) + '</summary><dl class="kv" style="margin-top:8px">' + table + "</dl></details>";
  }
  function timelineHtml(c) {
    if (!c || !c.timeline || !c.timeline.length) return '<p class="small muted">' + esc(t("auth.no_actions")) + "</p>";
    return '<ul class="tline">' + c.timeline.slice().reverse().map(function (e) {
      return "<li><div>" + esc(e.text) + '</div><div class="tiny muted">' + esc(U.when(U.parse(e.t) || 0, PM.now())) + " · " + esc(e.by || "") + "</div></li>";
    }).join("") + "</ul>";
  }

  function detailHtml(f, model, c, canAlert) {
    var p = f.p, places = model.placesOn(f), km = f.path ? f.path.km[f.path.km.length - 1] : 0;
    var counts = {};
    places.forEach(function (q) { var k = q.type === "city" ? "town" : q.type === "college" ? "school" : q.type === "clinic" ? "hospital" : q.type; counts[k] = (counts[k] || 0) + 1; });
    var countText = ["village", "town", "school", "hospital"].filter(function (k) { return counts[k]; }).map(function (k) { return counts[k] + " " + t("grp." + k).toLowerCase(); }).join(" · ");
    var status = (c && c.status) || "new", next = { "new": ["dismissed", "resolved"], warning_sent: ["acknowledged", "resolved", "dismissed"], acknowledged: ["resolved", "dismissed"], resolved: ["new"], dismissed: ["new"] }[status];
    var conf = { high: 3, medium: 2, low: 1 }[p.fire_type_confidence] || 1;
    var role = sourceRole(f);
    return '<div class="sheet-handle" aria-label="Drag to resize"></div>' +
      '<div class="detail-head"><div class="row" style="align-items:flex-start">' + U.typeBadge(p) +
      '<div class="grow"><div class="eyebrow" style="margin:0">' + esc(U.typeName(p)) + " · " + esc(t("auth.fire_id", { id: f.id })) + "</div><h3>" + esc(where(f)) + "</h3>" +
      '<p class="small muted" style="margin-top:4px">' + esc(t("auth.first_seen", { when: U.when(f.seenMs, PM.now()), rel: U.rel(f.seenMs, PM.now()) })) + " · " + esc((p.satellites || []).join(", ")) + (p.frp_mw ? " · " + U.num(p.frp_mw, 1) + " MW" : "") + "</p></div>" +
      '<button class="btn ghost icon-only sm" data-back aria-label="' + esc(t("btn.close")) + '">' + U.icon("x") + "</button></div>" +
      '<div class="row" style="margin-top:10px;gap:8px" data-statusrow>' + statusChip(status) + toxPill(f) + "</div></div>" +
      '<div class="detail-body">' +
      '<section class="block"><h4>' + esc(t("auth.what_burning")) + '</h4><div class="row" style="margin-bottom:6px"><b>' + esc(p.fire_type_label || U.typeName(p)) + "</b>" +
      '<span class="row" style="gap:3px" title="' + esc(t("auth.confidence")) + ": " + esc(p.fire_type_confidence || "") + '" aria-label="' + esc(t("auth.confidence")) + " " + esc(p.fire_type_confidence || "") + '">' + [1, 2, 3].map(function (i) { return '<i style="width:18px;height:6px;border-radius:3px;background:' + (i <= conf ? "var(--brand)" : "var(--line)") + '"></i>'; }).join("") + '</span><span class="small muted">' + esc(p.fire_type_confidence || "") + "</span></div>" +
      '<p class="small">' + esc(p.fire_type_reason || "") + "</p><div style=\"margin-top:10px\">" + coverBar(p) + "</div>" + outsideNote(f) + "</section>" +
      '<section class="block"><h4>' + esc(t("auth.toxicity")) + "</h4>" + toxBlock(f) + "</section>" +
      '<section class="block"><h4>' + esc(t("auth.smoke_path")) + "</h4>" +
      (f.path ? '<p class="small" style="margin-bottom:8px">' + esc(t("auth.path_text", { dir: t("dir." + U.heading(f.path.coords)), km: U.num(km, 0), n: places.length })) + (countText ? " <span class=\"muted\">(" + esc(countText) + ")</span>" : "") + "</p>" +
        '<div class="timebar"><button class="btn sm icon-only" data-play aria-label="' + esc(t("btn.play")) + '">' + U.icon("play") + '</button><input type="range" min="0" max="1000" value="0" data-scrub aria-label="' + esc(t("auth.scrub")) + '"><span class="small muted num" data-clock style="min-width:78px;text-align:right"></span></div>' +
        '<div class="places" data-places style="margin-top:8px">' + placeRows(places, 12) + "</div>" + (places.length > 12 ? '<button class="btn ghost sm" data-allplaces style="margin-top:4px">' + esc(t("auth.show_all", { n: places.length })) + "</button>" : "")
        : '<div class="note warn">' + U.icon("alert") + "<span>" + esc(t("auth.no_path")) + "</span></div>") + "</section>" +
      '<section class="block"><h4>' + esc(t("auth.actions")) + '</h4><div class="actions">' +
      '<button class="btn fire" data-warn>' + U.icon("send") + esc(t("auth.warn_btn", { who: t("role." + role).toLowerCase() })) + "</button>" +
      '<button class="btn primary" data-alert' + (canAlert ? "" : " disabled") + ">" + U.icon("bell") + esc(t("auth.alert_btn", { n: places.length })) + "</button></div>" +
      '<div class="row wrap" style="margin-top:10px;gap:6px"><span class="small muted">' + esc(t("auth.set_status")) + "</span>" + next.map(function (s) { return '<button class="btn sm" data-status-to="' + s + '">' + esc(t("btn.status." + s)) + "</button>"; }).join("") + "</div></section>" +
      '<section class="block"><h4>' + esc(t("auth.timeline")) + '</h4><div data-timeline>' + timelineHtml(c) + "</div>" +
      '<div class="row" style="margin-top:10px"><input class="input" data-note placeholder="' + esc(t("auth.add_note")) + '" maxlength="300" aria-label="' + esc(t("auth.add_note")) + '"><button class="btn sm" data-addnote>' + esc(t("btn.add")) + "</button></div></section></div>";
  }
  function placeRows(places, n) {
    return places.slice(0, n).map(function (q, i) {
      return '<div class="place" data-t="' + q.t + '"><span>' + esc(q.name) + ' <span class="faint small">' + esc(q.type) + '</span></span><span class="t">' + esc(U.when(q.t, PM.now())) + "</span></div>";
    }).join("");
  }

  /** Wires a detail panel to the map: play/pause, scrubbing, lighting up places as the smoke passes. */
  function wireDetail(box, f, model, smoke, reload, first) {
    var scrub = box.querySelector("[data-scrub]"), clock = box.querySelector("[data-clock]"), play = box.querySelector("[data-play]");
    var allPlaces = model.placesOn(f);
    if (f.path && scrub) {
      smoke.onProgress(function (prog, tm) {
        scrub.value = Math.round(prog * 1000);
        clock.textContent = U.clock(tm, 900000);
        box.querySelectorAll(".place[data-t]").forEach(function (el) { el.classList.toggle("hit", Number(el.getAttribute("data-t")) <= tm); });
      });
      if (first) smoke.setProgress(0);
      else if (smoke.playing()) play.innerHTML = U.icon("pause");
      scrub.addEventListener("input", function () { smoke.pause(); play.innerHTML = U.icon("play"); smoke.setProgress(scrub.value / 1000); });
      play.addEventListener("click", function () {
        if (smoke.playing()) { smoke.pause(); play.innerHTML = U.icon("play"); play.setAttribute("aria-label", t("btn.play")); }
        else { smoke.play(); play.innerHTML = U.icon("pause"); play.setAttribute("aria-label", t("btn.pause")); }
      });
      if (first && !smoke.reducedMotion) { smoke.play(); play.innerHTML = U.icon("pause"); play.setAttribute("aria-label", t("btn.pause")); }
    }
    box.addEventListener("click", async function (e) {
      if (e.target.closest("[data-allplaces]")) {
        box.querySelector("[data-places]").innerHTML = placeRows(allPlaces, allPlaces.length); box.querySelector("[data-places]").style.maxHeight = "320px";
        e.target.closest("[data-allplaces]").remove();
      }
      if (e.target.closest("[data-warn]")) warnDialog(f, reload);
      if (e.target.closest("[data-alert]")) alertDialog(f, model, reload);
      var st = e.target.closest("[data-status-to]");
      if (st) {
        var to = st.getAttribute("data-status-to");
        var apply = async function (note) {
          try { await PM.api.patchCase(f.key, { status: to, note: note, fire: fireContext(f) }); U.toast(t("auth.status_set", { s: t("status." + to) })); reload(); return true; }
          catch (err) { U.toast(err.message, "err"); return false; }
        };
        if (to === "dismissed") dismissDialog(apply); else apply("");
      }
      if (e.target.closest("[data-addnote]")) {
        var inp = box.querySelector("[data-note]");
        if (!inp.value.trim()) return;
        try { await PM.api.patchCase(f.key, { note: inp.value, fire: fireContext(f) }); inp.value = ""; reload(); }
        catch (err2) { U.toast(err2.message, "err"); }
      }
    });
    box.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.matches("[data-note]")) box.querySelector("[data-addnote]").click(); });
  }

  // ---- dashboard -----------------------------------------------------------------------------------------------------------------
  function dashboard(root, args) {
    root.innerHTML = '<div class="dash"><div class="kpis">' + [1, 2, 3, 4, 5].map(function () { return '<div class="kpi"><div class="skel" style="height:34px"></div></div>'; }).join("") +
      '</div><div class="dash-body"><div class="mapwrap"><div class="map" id="map"></div></div><section class="panel"><div class="panel-body" style="padding:16px">' + U.skeleton(6, 30) + "</div></section></div></div>";
    var ctl = { destroyed: false, mapc: null, fireLayer: null, smoke: null, selected: null };
    var model, cm = {}, activity = [], side = root.querySelector(".panel");

    Promise.all([PM.api.fires(), PM.api.cases().catch(function () { return []; }), PM.api.activity().catch(function () { return []; })]).then(function (r) {
      if (ctl.destroyed) return;
      model = r[0]; cm = casesMap(r[1]); activity = r[2];
      build();
    }).catch(function (e) {
      if (ctl.destroyed) return;
      root.innerHTML = errorBox(e.message, function () { PM.api.refresh(); dashboard(root, args); });
    });

    function kpis() {
      var today = U.dayKey(PM.now()), high = model.fires.filter(function (f) { return f.level === "high" || f.level === "very high"; }).length;
      var sentToday = activity.filter(function (a) { return U.dayKey(U.parse(a.created_at) || 0) === today; }).length;
      var open = Object.keys(cm).filter(function (k) { return cm[k].status === "warning_sent" || cm[k].status === "acknowledged"; }).length;
      var items = [
        ["kpi.fires", model.fires.length, ""], ["kpi.high", high, high ? "hot" : ""], ["kpi.places", model.reached.length, ""],
        ["kpi.sent", sentToday, ""], ["kpi.open", open, ""],
      ];
      root.querySelector(".kpis").innerHTML = items.map(function (k) { return '<div class="kpi ' + k[2] + '"><div class="v num" data-v="' + k[1] + '">0</div><div class="l">' + esc(t(k[0])) + "</div></div>"; }).join("");
      root.querySelectorAll(".kpi .v").forEach(function (el) { U.countUp(el, Number(el.getAttribute("data-v"))); });
    }

    function build() {
      kpis();
      var wrap = root.querySelector(".mapwrap");
      if (PM.maps.available()) {
        ctl.mapc = PM.maps.create(root.querySelector("#map"), { theme: document.documentElement.getAttribute("data-theme"), bounds: PM.maps.INDIA });
        ctl.fireLayer = PM.maps.fireLayer(ctl.mapc.map, { onPick: function (f) { PM.go("#/authority/fire/" + encodeURIComponent(f.key)); } });
        ctl.smoke = PM.maps.smokeLayer(ctl.mapc.map);
        wrap.insertAdjacentHTML("beforeend", legend(model));
      } else wrap.innerHTML = PM.maps.noMapHtml();
      var counts = {};
      model.fires.forEach(function (f) { var k = f.p.fire_type || "unknown"; counts[k] = (counts[k] || 0) + 1; });
      wrap.insertAdjacentHTML("beforeend", U.mapBar());
      wrap.querySelector("[data-typechips]").innerHTML = U.typeChips(counts, F.types);
      wrap.addEventListener("click", function (e) {
        var b = e.target.closest("[data-ftype]");
        if (!b) return;
        U.toggleType(F.types, b.getAttribute("data-ftype"));
        syncMapChips();
        refreshDots(true);
        if (!ctl.selected) paintQueue(true);
      });
      var notes = (model.doc.notes || []).filter(function (n) { return /not available|missing/i.test(n); });
      if (notes.length) wrap.insertAdjacentHTML("beforeend", '<div class="float bl glass" style="padding:8px 12px;max-width:min(420px,70%)"><span class="small">' + U.icon("alert", "sm") + " " + esc(notes[0]) + "</span></div>");
      bindFilters(side, function (rerender) { if (rerender) { paintQueue(true); refreshDots(true); } else paintList(); });
      if (ctl.fireLayer) ctl.fireLayer.set(applyFilters(model.fires, cm), typeFilterOn());
      select(args && args.key);
    }

    function legend() {
      return '<div class="float bl glass legend" data-legend><div data-legend-type hidden><div class="eyebrow" style="margin-bottom:4px">' + esc(t("auth.legend_type")) + '</div><div class="small muted legend-note">' + esc(t("auth.legend_type_note")) + '</div></div><div data-legend-tox><div class="eyebrow" style="margin-bottom:4px">' + esc(t("auth.legend")) + '</div><div class="row" style="gap:10px;flex-wrap:wrap">' +
        ["low", "moderate", "high", "very_high"].map(function (k) { return '<span class="row" style="gap:5px"><i class="dot" style="background:var(--tox-' + k + ')"></i>' + esc(t("tox." + k)) + "</span>"; }).join("") + "</div>" +
        '<div class="small muted legend-note" style="margin-top:4px">' + esc(t("auth.legend_note")) + "</div></div></div>";
    }

    /** Redraw the dots for the current filters; with a filter on, zoom the map to them. */
    function refreshDots(fit) {
      if (!ctl.fireLayer) return;
      var list = applyFilters(model.fires, cm);
      ctl.fireLayer.set(list, typeFilterOn());
      var lt = root.querySelector("[data-legend-type]"), lx = root.querySelector("[data-legend-tox]");
      if (lt && lx) { lt.hidden = !typeFilterOn(); lx.hidden = typeFilterOn(); }
      if (fit && !ctl.selected && ctl.mapc) {
        if (typeFilterOn() && list.length) ctl.mapc.map.fitBounds(L.latLngBounds(list.map(function (f) { return [f.lat, f.lon]; })).pad(0.2), { maxZoom: 8, animate: true });
        else if (!typeFilterOn()) ctl.mapc.map.fitBounds(PM.maps.INDIA, { animate: true });
      }
    }
    function paintQueue(full) {
      side.className = "panel";
      side.innerHTML = '<div class="panel-head"><div class="row spread"><h3>' + esc(t("auth.queue")) + ' <span class="muted small" data-count></span></h3></div>' + filterControls(model, cm) + '</div><div class="panel-body" data-list></div>';
      paintList();
    }
    function paintList() {
      var list = applyFilters(model.fires, cm), box = side.querySelector("[data-list]");
      if (!box) return;
      side.querySelector("[data-count]").textContent = list.length + " / " + model.fires.length;
      if (ctl.fireLayer) ctl.fireLayer.set(list, typeFilterOn());
      if (!list.length) { box.innerHTML = '<div class="empty">' + U.icon("check") + "<p>" + esc(t("auth.none_match")) + "</p></div>"; return; }
      box.innerHTML = list.slice(0, 300).map(function (f) {
        return '<button class="queue-item" data-key="' + esc(f.key) + '" aria-current="' + (f.key === ctl.selected) + '">' + U.typeBadge(f.p) +
          '<div style="min-width:0"><div class="truncate"><b>' + esc(where(f)) + '</b></div><div class="small muted truncate">' + esc(U.typeName(f.p)) + " · " + esc(U.rel(f.seenMs, PM.now())) + " · " + esc(t("auth.places_n", { n: f.p.places_reached == null ? "–" : f.p.places_reached })) + "</div></div>" +
          '<div style="text-align:right;display:flex;flex-direction:column;gap:4px;align-items:flex-end">' + toxPill(f) + (statusOf(f, cm) !== "new" ? statusChip(statusOf(f, cm)) : "") + "</div></button>";
      }).join("") + (list.length > 300 ? '<p class="small muted" style="padding:12px">' + esc(t("auth.showing", { n: 300, m: list.length })) + "</p>" : "");
    }
    side.addEventListener("click", function (e) {
      var item = e.target.closest("[data-key]");
      if (item && item.classList.contains("queue-item")) PM.go("#/authority/fire/" + encodeURIComponent(item.getAttribute("data-key")));
      if (e.target.closest("[data-back]")) PM.go("#/authority/dashboard");
    });

    async function select(key) {
      if (ctl.destroyed || !model) return;
      ctl.selected = key || null;
      if (ctl.smoke) ctl.smoke.clear();
      if (ctl.fireLayer) ctl.fireLayer.select(ctl.selected);
      var f = key ? model.byKey[key] : null;
      if (!f) {
        if (key) U.toast(t("auth.gone"), "err");
        paintQueue(); if (ctl.mapc && !key) ctl.mapc.map.fitBounds(PM.maps.INDIA, { animate: true });
        return;
      }
      if (ctl.smoke) ctl.smoke.show(f, { ticks: "hours" });
      if (ctl.mapc && !f.path) ctl.mapc.map.setView([f.lat, f.lon], 9);
      function paintDetail(first) {
        if (first) side.className = "panel sheet slide-in";
        side.innerHTML = '<div class="detail" style="flex:1">' + detailHtml(f, model, cm[f.key], !!f.path && model.placesOn(f).length > 0) + "</div>";
        U.sheetDrag(side);
        wireDetail(side.firstElementChild, f, model, ctl.smoke, reload, first);
      }
      async function reload() {
        try { cm = casesMap(await PM.api.cases()); activity = await PM.api.activity().catch(function () { return activity; }); } catch (e) { U.toast(e.message, "err"); }
        kpis();
        paintDetail(false);
      }
      paintDetail(true);
    }
    function onEsc(e) { if (e.key === "Escape" && ctl.selected && !document.querySelector(".overlay")) PM.go("#/authority/dashboard"); }
    document.addEventListener("keydown", onEsc);
    ctl.update = function (a) { if (model) select(a && a.key); else args = a; };
    ctl.destroy = function () {
      ctl.destroyed = true;
      document.removeEventListener("keydown", onEsc);
      if (ctl.smoke) ctl.smoke.destroy();
      if (ctl.fireLayer) ctl.fireLayer.destroy();
      if (ctl.mapc) ctl.mapc.destroy();
    };
    return ctl;
  }

  function errorBox(msg, retry) {
    var id = "retry" + Math.random().toString(36).slice(2, 7);
    setTimeout(function () { var b = document.getElementById(id); if (b) b.addEventListener("click", retry); }, 0);
    return '<div class="page"><div class="error-box" role="alert"><div><b>' + esc(t("err.title")) + '</b><div class="small">' + esc(msg) + '</div></div><button id="' + id + '" class="btn">' + U.icon("refresh") + esc(t("btn.retry")) + "</button></div></div>";
  }
  A.errorBox = errorBox;

  // ---- fires table ----------------------------------------------------------------------------------------------------------------
  function firesPage(root) {
    root.innerHTML = '<div class="page"><div class="page-head"><div><h1>' + esc(t("nav.fires")) + '</h1><p class="muted">' + esc(t("auth.fires_sub")) + '</p></div><button class="btn" data-csv>' + U.icon("list") + esc(t("auth.csv")) + '</button></div><div class="card flush" data-box>' + '<div style="padding:16px">' + U.skeleton(8, 28) + "</div></div></div>";
    var ctl = { destroyed: false }, model, cm = {};
    Promise.all([PM.api.fires(), PM.api.cases().catch(function () { return []; })]).then(function (r) {
      if (ctl.destroyed) return;
      model = r[0]; cm = casesMap(r[1]); paint();
    }).catch(function (e) { root.innerHTML = errorBox(e.message, function () { PM.api.refresh(); firesPage(root); }); });
    var sortKey = "tox";
    function paint() {
      var box = root.querySelector("[data-box]");
      box.innerHTML = '<div class="panel-head">' + filterControls(model, cm) + '</div><div class="tablewrap" style="border:0;border-radius:0"><table class="t"><thead><tr><th>' + esc(t("auth.col.where")) + "</th><th>" + esc(t("auth.col.type")) + "</th><th>" + esc(t("auth.col.tox")) + "</th><th>" + esc(t("auth.col.seen")) + "</th><th>" + esc(t("auth.col.places")) + "</th><th>" + esc(t("auth.col.status")) + '</th></tr></thead><tbody data-rows></tbody></table></div>';
      rows();
    }
    function rows() {
      var list = applyFilters(model.fires, cm);
      root.querySelector("[data-rows]").innerHTML = list.slice(0, 500).map(function (f) {
        return '<tr class="click" data-key="' + esc(f.key) + '" tabindex="0"><td><b>' + esc(f.near || "Fire " + f.id) + '</b><div class="small muted">' + esc(f.state) + "</div></td><td>" + esc(U.typeName(f.p)) + "</td><td>" + toxPill(f) + "</td><td>" + esc(U.when(f.seenMs, PM.now())) + "</td><td>" + (f.p.places_reached == null ? "–" : f.p.places_reached) + "</td><td>" + statusChip(statusOf(f, cm)) + "</td></tr>";
      }).join("") || '<tr><td colspan="6" class="empty">' + esc(t("auth.none_match")) + "</td></tr>";
    }
    bindFilters(root, function (full) { if (full) { var q = root.querySelector("[data-q]"); var had = document.activeElement === q; paint(); if (had) root.querySelector("[data-q]").focus(); } else rows(); });
    root.addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-key]");
      if (tr) PM.go("#/authority/fire/" + encodeURIComponent(tr.getAttribute("data-key")));
      if (e.target.closest("[data-csv]") && model) csv(applyFilters(model.fires, cm), cm);
    });
    root.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.matches("tr[data-key]")) e.target.click(); });
    return { destroy: function () { ctl.destroyed = true; } };
  }
  function csv(list, cm) {
    var head = ["id", "key", "state", "near", "latitude", "longitude", "type", "confidence", "toxicity_km3", "toxicity_level", "first_seen", "places_reached", "status"];
    var lines = [head.join(",")].concat(list.map(function (f) {
      return [f.id, f.key, f.state, f.near, f.lat.toFixed(4), f.lon.toFixed(4), f.p.fire_type, f.p.fire_type_confidence, f.km3 == null ? "" : f.km3, f.level || "", f.p.seen_at, f.p.places_reached == null ? "" : f.p.places_reached, statusOf(f, cm)]
        .map(function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }).join(",");
    }));
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "vayurahshak-fires.csv"; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- cases board --------------------------------------------------------------------------------------------------------------
  function casesPage(root) {
    root.innerHTML = '<div class="page"><div class="page-head"><div><h1>' + esc(t("nav.cases")) + '</h1><p class="muted">' + esc(t("auth.cases_sub")) + '</p></div></div><div data-box>' + U.skeleton(6, 40) + "</div></div>";
    var ctl = { destroyed: false };
    function load() {
      Promise.all([PM.api.fires(), PM.api.cases()]).then(function (r) {
        if (ctl.destroyed) return;
        paint(r[0], r[1]);
      }).catch(function (e) { root.innerHTML = errorBox(e.message, function () { casesPage(root); }); });
    }
    function card(c, model) {
      var f = model.byKey[c.fire_id], info = c.fire || {}, last = c.timeline && c.timeline.length ? c.timeline[c.timeline.length - 1] : null;
      var name = f ? where(f) : [info.near, info.state].filter(Boolean).join(", ") || c.fire_id;
      return '<button class="case-card" data-key="' + esc(c.fire_id) + '"><b>' + esc(name) + '</b><div class="row wrap" style="gap:6px"><span class="small muted">' + esc(f ? U.typeName(f.p) : info.type_label || info.type || "") + "</span>" + (f ? toxPill(f) : "") + "</div>" +
        (last ? '<div class="small">' + esc(last.text) + '</div><div class="tiny muted">' + esc(U.rel(U.parse(last.t) || 0, PM.now())) + "</div>" : "") + "</button>";
    }
    function paint(model, cases) {
      var cm = casesMap(cases), by = { "new": [], warning_sent: [], acknowledged: [], closed: [] };
      cases.forEach(function (c) { (c.status === "resolved" || c.status === "dismissed" ? by.closed : by[c.status] || by["new"]).push(c); });
      var waiting = model.fires.filter(function (f) { return !cm[f.key]; }).sort(function (a, b) { return (b.km3 || -1) - (a.km3 || -1); });
      var cols = [["new", "status.new"], ["warning_sent", "status.warning_sent"], ["acknowledged", "status.acknowledged"], ["closed", "auth.closed"]];
      root.querySelector("[data-box]").innerHTML = '<div class="board">' + cols.map(function (c) {
        var items = by[c[0]].map(function (x) { return card(x, model); }).join("");
        if (c[0] === "new") items += waiting.slice(0, 8).map(function (f) {
          return card({ fire_id: f.key, status: "new", fire: fireContext(f), timeline: [] }, model);
        }).join("") + (waiting.length > 8 ? '<a class="small" href="#/authority/fires">' + esc(t("auth.more_waiting", { n: waiting.length - 8 })) + "</a>" : "");
        var n = by[c[0]].length + (c[0] === "new" ? waiting.length : 0);
        return '<section class="col" aria-label="' + esc(t(c[1])) + '"><h3>' + esc(t(c[1])) + '<span class="muted">' + n + "</span></h3>" + (items || '<p class="small muted">' + esc(t("auth.empty_col")) + "</p>") + "</section>";
      }).join("") + "</div>";
    }
    root.addEventListener("click", function (e) {
      var c = e.target.closest("[data-key]");
      if (c) PM.go("#/authority/fire/" + encodeURIComponent(c.getAttribute("data-key")));
    });
    var off = PM.on("cases", load);
    load();
    return { destroy: function () { ctl.destroyed = true; off(); } };
  }

  // ---- activity log ------------------------------------------------------------------------------------------------------------
  function activityPage(root) {
    root.innerHTML = '<div class="page"><div class="page-head"><div><h1>' + esc(t("nav.alerts_sent")) + '</h1><p class="muted">' + esc(t("auth.activity_sub")) + '</p></div></div><div class="card flush" data-box><div style="padding:16px">' + U.skeleton(6, 28) + "</div></div></div>";
    var ctl = { destroyed: false };
    function load() {
      PM.api.activity().then(function (list) {
        if (ctl.destroyed) return;
        var box = root.querySelector("[data-box]");
        if (!list.length) { box.innerHTML = '<div class="empty">' + U.icon("send") + "<p>" + esc(t("auth.no_activity")) + "</p></div>"; return; }
        box.innerHTML = '<div class="tablewrap" style="border:0"><table class="t"><thead><tr><th>' + ["col.time", "col.kind", "col.fire", "col.to", "col.how", "col.msg"].map(function (k) { return esc(t(k)); }).join("</th><th>") + "</th></tr></thead><tbody>" +
          list.map(function (a) {
            var to = a.kind === "source_warning" ? esc(a.target.name) + '<div class="small muted">' + esc(a.target.contact) + (a.target.demo ? " (demo)" : "") + "</div>" : esc(t("auth.n_places", { n: a.target.places.length })) + '<div class="small muted">' + esc(a.target.places.slice(0, 3).map(function (p) { return p.name; }).join(", ")) + "</div>";
            var how = (a.delivery || []).map(function (d) { return d.indexOf("demo") >= 0 ? t("auth.sent_demo_short") : d === "email" ? "Email" : t("auth.sent_short"); });
            return "<tr><td>" + esc(U.when(U.parse(a.created_at) || 0, PM.now())) + "</td><td>" + esc(t("kind." + a.kind)) + "</td><td>" + esc([a.fire && a.fire.near, a.fire && a.fire.state].filter(Boolean).join(", ") || a.fire_id) + "</td><td>" + to + "</td><td>" + esc(how.join(" + ")) + '</td><td style="max-width:360px"><div class="truncate" title="' + esc(a.message) + '">' + esc(a.message) + "</div></td></tr>";
          }).join("") + "</tbody></table></div>";
      }).catch(function (e) { root.innerHTML = errorBox(e.message, function () { activityPage(root); }); });
    }
    var off = PM.on("cases", load);
    load();
    return { destroy: function () { ctl.destroyed = true; off(); } };
  }

  A.outsideNote = outsideNote; A.toxBlock = toxBlock; A.coverBar = coverBar; A.where = where; A.toxPill = toxPill;
  A.dashboard = dashboard; A.fires = firesPage; A.cases = casesPage; A.activity = activityPage;
})((window.PM = window.PM || {}));
