/* The app: landing, login, the shell (top bar, sidebar, phone tab bar), the hash router and the role menu. */
(function (PM) {
  "use strict";
  var U = PM.U, esc = U.esc;
  var t = function (k, v) { return PM.t(k, v); };
  var appEl, current = null, shellRole = null, unread = 0;

  // ---- navigation items per role ----------------------------------------------------------------------------------
  var NAV = {
    citizen: [
      { id: "home", href: "#/citizen/home", icon: "home", key: "nav.home" },
      { id: "map", href: "#/citizen/map", icon: "map", key: "nav.map" },
      { id: "alerts", href: "#/citizen/alerts", icon: "bell", key: "nav.alerts", count: true },
      { id: "forecast", href: "#/citizen/forecast", icon: "wind", key: "nav.forecast" },
      { id: "tips", href: "#/citizen/tips", icon: "heart", key: "nav.tips" },
    ],
    farmer: [
      { id: "home", href: "#/farmer/home", icon: "leaf", key: "nav.farm" },
      { id: "crops", href: "#/farmer/crops", icon: "wheat", key: "nav.crops" },
      { id: "doctor", href: "#/farmer/doctor", icon: "camera", key: "nav.doctor" },
      { id: "stubble", href: "#/farmer/stubble", icon: "flame", key: "nav.stubble" },
      { id: "pledge", href: "#/farmer/pledge", icon: "award", key: "nav.pledge" },
      { id: "alerts", href: "#/farmer/alerts", icon: "bell", key: "nav.warnings", count: true },
    ],
    authority: [
      { id: "dashboard", href: "#/authority/dashboard", icon: "grid", key: "nav.dashboard" },
      { id: "fires", href: "#/authority/fires", icon: "list", key: "nav.fires" },
      { id: "cases", href: "#/authority/cases", icon: "folder", key: "nav.cases" },
      { id: "alerts_sent", href: "#/authority/alerts", icon: "send", key: "nav.alerts_sent" },
      { id: "air", href: "#/authority/air", icon: "wind", key: "nav.air" },
    ],
  };
  // route table: [path pattern, role, screen id (for the active link), builder]
  var ROUTES = [
    ["citizen/setup", "citizen", "setup", function (el) { return PM.citizen.setup(el); }],
    ["citizen/home", "citizen", "home", function (el) { return PM.citizen.home(el); }],
    ["citizen/map", "citizen", "map", function (el) { return PM.citizen.map(el); }],
    ["citizen/alerts", "citizen", "alerts", function (el) { return PM.citizen.alerts(el); }],
    ["citizen/forecast", "citizen", "forecast", function (el) { return PM.citizen.forecast(el); }],
    ["citizen/tips", "citizen", "tips", function (el) { return PM.citizen.tips(el); }],
    ["farmer/setup", "farmer", "home", function (el) { return PM.farmer.setup(el); }],
    ["farmer/home", "farmer", "home", function (el) { return PM.farmer.home(el); }],
    ["farmer/crops", "farmer", "crops", function (el) { return PM.farmer.crops(el); }],
    ["farmer/doctor", "farmer", "doctor", function (el) { return PM.farmer.doctor(el); }],
    ["farmer/stubble", "farmer", "stubble", function (el) { return PM.farmer.stubble(el); }],
    ["farmer/pledge", "farmer", "pledge", function (el) { return PM.farmer.pledge(el); }],
    ["farmer/alerts", "farmer", "alerts", function (el) { return PM.farmer.alerts(el); }],
    ["authority/dashboard", "authority", "dashboard", function (el) { return PM.authority.dashboard(el, {}); }],
    ["authority/fire/:key", "authority", "dashboard", function (el, a) { return PM.authority.dashboard(el, a); }],
    ["authority/fires", "authority", "fires", function (el) { return PM.authority.fires(el); }],
    ["authority/cases", "authority", "cases", function (el) { return PM.authority.cases(el); }],
    ["authority/alerts", "authority", "alerts_sent", function (el) { return PM.authority.activity(el); }],
    ["authority/air", "authority", "air", function (el) { return PM.air.page(el, { role: "authority", initial: "now" }); }],
  ];

  var ROLES = ["citizen", "farmer", "authority"];
  function roleHome(role) { return role === "authority" ? "#/authority/dashboard" : role === "farmer" ? (PM.store.farm() ? "#/farmer/home" : "#/farmer/setup") : PM.store.home() ? "#/citizen/home" : "#/citizen/setup"; }
  function roleName(role) { return role === "authority" ? "Demo Authority" : role === "farmer" ? "Demo Farmer" : "Demo Citizen"; }
  PM.go = function (hash) { if (window.location.hash === hash) route(); else window.location.hash = hash; };

  function match(path) {
    var parts = path.split("/").filter(Boolean);
    for (var i = 0; i < ROUTES.length; i++) {
      var pat = ROUTES[i][0].split("/");
      if (pat.length !== parts.length) continue;
      var args = {}, ok = true;
      for (var j = 0; j < pat.length; j++) {
        if (pat[j][0] === ":") args[pat[j].slice(1)] = decodeURIComponent(parts[j]);
        else if (pat[j] !== parts[j]) { ok = false; break; }
      }
      if (ok) return { r: ROUTES[i], args: args };
    }
    return null;
  }

  // ---- routing ----------------------------------------------------------------------------------------------------------
  function route() {
    var hash = window.location.hash || "#/";
    if (handleCognitoReturn(hash)) return;
    var path = hash.replace(/^#\/?/, "").split("?")[0];
    var session = PM.store.session();
    if (path === "" || path === "landing") return landing(session);
    if (path.indexOf("login/") === 0) return login(path.split("/")[1]);
    var m = match(path);
    if (!m) { PM.go("#/"); return; }
    var role = m.r[1];
    if (!session) { PM.go("#/login/" + role); return; }
    if (session.role !== role) { PM.go(roleHome(session.role)); return; }
    PM._lang = role === "authority" ? "en" : PM.store.lang();
    if (shellRole !== role || !document.getElementById("main")) { teardown(); buildShell(role, session); }
    PM.applyTheme(role);
    markNav(m.r[2]);
    var main = document.getElementById("main");
    // same screen with new arguments (for example another fire on the dashboard): update, do not rebuild
    if (current && current.id === m.r[2] && current.ctl && current.ctl.update) { current.ctl.update(m.args); return; }
    teardown();
    main.innerHTML = "";
    var holder = document.createElement("div");
    holder.className = "fade-in";
    holder.style.cssText = "min-height:100%";
    main.appendChild(holder);
    try { current = { id: m.r[2], ctl: m.r[3](holder, m.args) }; }
    catch (e) { console.error(e); holder.innerHTML = PM.authority.errorBox(String(e.message || e), function () { route(); }); current = null; }
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    document.title = t("app.name") + " · " + t(((NAV[role].filter(function (n) { return n.id === m.r[2]; })[0]) || {}).key || "app.name");
    updateBadge();
  }
  function teardown() {
    if (current && current.ctl && current.ctl.destroy) { try { current.ctl.destroy(); } catch (e) { console.error(e); } }
    current = null;
  }
  function markNav(id) {
    U.$$("[data-nav]").forEach(function (a) { if (a.getAttribute("data-nav") === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }

  // ---- shell ------------------------------------------------------------------------------------------------------------------
  function navLinks(role, cls) {
    return NAV[role].map(function (n) {
      return '<a class="' + cls + '" href="' + n.href + '" data-nav="' + n.id + '">' + U.icon(n.icon) + "<span>" + esc(t(n.key)) + "</span>" +
        (n.count ? '<span class="nav-count" data-unread hidden></span>' : "") + "</a>";
    }).join("");
  }
  function buildShell(role, session) {
    shellRole = role;
    var home = PM.store.home();
    var initials = (session.name || "?").replace(/^Demo\s+/i, "").slice(0, 1).toUpperCase();
    appEl.innerHTML = '<div class="shell"><header class="topbar"><a class="brand" href="' + roleHome(role) + '"><span class="mark">' + U.icon("flame") + "</span><span>" + esc(t("app.name")) + "</span></a>" +
      (role === "citizen" ? '<a class="chip place-chip hide-sm" href="#/citizen/setup" aria-label="' + esc(t("cz.change_area")) + '">' + U.icon("pin", "sm") + '<span class="truncate">' + esc(home ? home.name : t("cz.pick_area")) + "</span></a>"
        : role === "farmer" ? '<a class="chip place-chip hide-sm" href="#/farmer/setup" aria-label="' + esc(t("fm.edit")) + '">' + U.icon("leaf", "sm") + '<span class="truncate">' + esc(PM.store.farm() ? PM.store.farm().name : t("fm.setup_title")) + "</span></a>"
        : '<span class="pill hide-sm">' + U.icon("shield", "sm") + esc(t("role.authority_label")) + "</span>") +
      '<span class="grow"></span><span class="now-clock hide-sm" data-clock title="' + esc(t("badge.now_title")) + '"></span><span class="badge-live" data-badge></span>' +
      (role !== "authority" ? '<div class="seg" role="group" aria-label="Language"><button data-lang="en" aria-pressed="' + (PM.store.lang() === "en") + '">EN</button><button data-lang="hi" aria-pressed="' + (PM.store.lang() === "hi") + '">हि</button></div>' : "") +
      '<button class="btn ghost icon-only" data-theme aria-label="' + esc(t("btn.theme")) + '">' + U.icon(PM.store.theme(role) === "dark" ? "sun" : "moon") + "</button>" +
      (role !== "authority" ? '<a class="btn ghost icon-only bell" href="#/' + role + '/alerts" aria-label=""' + esc(t("nav.alerts")) + '">' + U.icon("bell") + '<span class="nav-count" data-unread hidden></span></a>' : "") +
      '<div class="menu"><button class="btn ghost icon-only" data-menu aria-haspopup="true" aria-expanded="false" aria-label="' + esc(t("btn.account")) + '"><span class="avatar">' + esc(initials) + "</span></button></div></header>" +
      '<nav class="sidebar" aria-label="Main">' + navLinks(role, "nav-link") + '<div class="side-foot">' + esc(t("app.aws")) + '</div></nav><main class="main" id="main" tabindex="-1"></main><nav class="tabbar" aria-label="Main">' + navLinks(role, "") + "</nav></div>";
    refreshBell();
  }
  function menuHtml(session) {
    var others = ROLES.filter(function (r) { return r !== session.role; });
    return '<div class="menu-panel" role="menu"><div class="who"><b>' + esc(session.name) + '</b><div class="small muted">' + esc(t("role." + session.role + "_label")) + (session.demo ? " · " + esc(t("login.demo_tag")) : "") + "</div></div>" +
      (PM.config.demoTools && session.demo ? others.map(function (other) {
        return '<button class="item" role="menuitem" data-switch="' + other + '">' + U.icon("users") + esc(t("menu.switch", { role: t("role." + other + "_label") })) + "</button>";
      }).join("") : "") +
      '<button class="item" role="menuitem" data-theme>' + U.icon(PM.store.theme(session.role) === "dark" ? "sun" : "moon") + esc(t("btn.theme")) + "</button>" +
      (PM.config.demoTools ? '<button class="item" role="menuitem" data-reset>' + U.icon("refresh") + esc(t("menu.reset")) + "</button>" : "") +
      '<button class="item" role="menuitem" data-logout>' + U.icon("logout") + esc(t("menu.logout")) + "</button></div>";
  }
  function closeMenu() { var p = U.$(".menu-panel"); if (p) p.remove(); var b = U.$("[data-menu]"); if (b) b.setAttribute("aria-expanded", "false"); }

  document.addEventListener("click", function (e) {
    var session = PM.store.session();
    var menuBtn = e.target.closest("[data-menu]");
    if (menuBtn) {
      if (U.$(".menu-panel")) { closeMenu(); return; }
      menuBtn.parentElement.insertAdjacentHTML("beforeend", menuHtml(session));
      menuBtn.setAttribute("aria-expanded", "true");
      var first = U.$(".menu-panel .item"); if (first) first.focus();
      return;
    }
    if (!e.target.closest(".menu-panel")) closeMenu();
    var lang = e.target.closest(".topbar [data-lang], .top-controls [data-lang]");
    if (lang) { PM.store.setLang(lang.getAttribute("data-lang")); rerender(); return; }
    if (e.target.closest(".topbar [data-theme], .top-controls [data-theme]")) {
      var role = session ? session.role : "citizen";
      PM.store.setTheme(role, PM.store.theme(role) === "dark" ? "light" : "dark");
      PM.applyTheme(role);
      U.$$(".topbar > [data-theme], .top-controls [data-theme]").forEach(function (tb) { tb.innerHTML = U.icon(PM.store.theme(role) === "dark" ? "sun" : "moon"); }); closeMenu();
      return;
    }
    var sw = e.target.closest("[data-switch]");
    if (sw) { closeMenu(); setSession(sw.getAttribute("data-switch"), true); return; }
    if (e.target.closest("[data-reset]")) { closeMenu(); PM.local.reset(); U.toast(t("menu.reset_done")); if (session && session.role === "farmer") PM.go("#/farmer/setup"); else route(); return; }
    if (e.target.closest("[data-logout]")) { closeMenu(); PM.store.clearSession(); shellRole = null; teardown(); PM.go("#/"); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });

  function rerender() { shellRole = null; teardown(); route(); }
  PM.on("lang", function () { PM.applyTheme(shellRole || "citizen"); });
  PM.on("home", function () { shellRole = null; });  // the chip in the top bar shows the area
  PM.on("alerts", function () { refreshBell(); });

  function updateClock() {
    var c = U.$("[data-clock]");
    if (c) c.textContent = U.dayText(Date.now()) + ", " + U.halfHour(Date.now()) + " IST";  // the real time, whatever data is shown
  }
  function updateBadge() {
    updateClock();
    var b = U.$("[data-badge]");
    if (!b) return;
    var s = PM.api.badge();
    b.className = "badge-live " + s.kind;
    b.textContent = s.text;
    b.title = (PM.api.fellBack() ? t("badge.fell", { why: PM.api.fellBack() }) + "\n" : "") + (s.title || "");
  }
  setInterval(updateBadge, 15000);
  PM.updateBadge = updateBadge;

  /** Number of alerts the citizen has not opened; for a farmer, also the warnings not yet confirmed as read. */
  function refreshBell() {
    var session = PM.store.session(), home = PM.store.home(), farm = PM.store.farm();
    if (!session || (session.role !== "citizen" && session.role !== "farmer")) return;
    if (!home && !(session.role === "farmer" && farm)) return;
    var spot = session.role === "farmer" && farm ? farm : home;
    Promise.all([
      PM.api.alertsNear(spot).catch(function () { return []; }),
      session.role === "farmer" ? PM.api.farmerWarnings(farm).catch(function () { return []; }) : Promise.resolve([]),
    ]).then(function (r) {
      var read = PM.store.read();
      unread = r[0].filter(function (a) { return read.indexOf(a.id) < 0; }).length + r[1].filter(function (w) { return w.case_status === "warning_sent" || w.case_status === "new"; }).length;
      U.$$("[data-unread]").forEach(function (el) { el.textContent = unread > 9 ? "9+" : String(unread); el.hidden = !unread; });
    });
  }
  setInterval(refreshBell, 20000);

  // ---- sessions ---------------------------------------------------------------------------------------------------------------
  function setSession(role, stay) {
    PM.store.setSession({ role: role, name: roleName(role), email: role + "@demo.invalid", demo: true });
    shellRole = null;
    PM.go(roleHome(role));
  }

  // ---- Amazon Cognito (prepared; used only with ?auth=cognito and a filled-in config block) ------------------------------------------
  function cognitoUrl(role) {
    var c = PM.config.cognito, redirect = window.location.origin + window.location.pathname;
    return "https://" + c.domain + "/login?client_id=" + encodeURIComponent(c.clientId) + "&response_type=token&scope=openid+email&redirect_uri=" + encodeURIComponent(redirect) + "&state=" + role;
  }
  function handleCognitoReturn(hash) {
    if (hash.indexOf("#id_token=") !== 0) return false;
    var p = new URLSearchParams(hash.slice(1)), token = p.get("id_token"), role = ROLES.indexOf(p.get("state")) >= 0 ? p.get("state") : "citizen";
    try {
      var claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      var groups = [].concat(claims["cognito:groups"] || []);
      var real = groups.indexOf("authority") >= 0 ? "authority" : groups.indexOf("farmer") >= 0 ? "farmer" : "citizen";
      if (role === "authority" && real !== "authority") { U.toast(t("login.not_authority"), "err"); role = real; }
      else if (role === "farmer" && real === "citizen") { U.toast(t("login.not_farmer"), "err"); role = real; }
      else role = real;
      PM.store.setSession({ role: role, name: claims.email || claims["cognito:username"] || "user", email: claims.email || "", token: token, exp: claims.exp * 1000, demo: false });
    } catch (e) { U.toast(t("login.failed"), "err"); }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    PM.go(roleHome(role));
    return true;
  }

  // ---- landing and login --------------------------------------------------------------------------------------------------------
  function topLinks() {
    return '<div class="row top-controls"><div class="seg" role="group" aria-label="Language"><button data-lang="en" aria-pressed="' + (PM.store.lang() === "en") + '">EN</button><button data-lang="hi" aria-pressed="' + (PM.store.lang() === "hi") + '">हि</button></div>' +
      '<button class="btn ghost icon-only" data-theme aria-label="' + esc(t("btn.theme")) + '">' + U.icon(PM.store.theme("citizen") === "dark" ? "sun" : "moon") + "</button></div>";
  }
  function landing(session) {
    teardown(); shellRole = null;
    PM._lang = PM.store.lang(); PM.applyTheme("citizen");
    document.title = t("app.name");
    appEl.innerHTML = '<div class="landing"><header><a class="brand" href="#/"><span class="mark">' + U.icon("flame") + "</span><span>" + esc(t("app.name")) + "</span></a>" + topLinks() + "</header>" +
      '<main><div class="hero fade-in"><span class="pill">' + U.icon("wind", "sm") + esc(t("land.tag")) + "</span><h1>" + t("land.title") + '</h1><p class="lead">' + esc(t("land.lead")) + "</p>" +
      '<div class="roles"><a class="role-card farmer" href="#/login/farmer"><span class="badge">' + U.icon("leaf", "lg") + "</span><h2>" + esc(t("land.farmer")) + "</h2><p class=\"muted\">" + esc(t("land.farmer_sub")) + '</p><span class="btn lg farmer-btn">' + esc(t("land.farmer_btn")) + U.icon("right") + "</span></a>" +
      '<a class="role-card" href="#/login/citizen"><span class="badge">' + U.icon("user", "lg") + "</span><h2>" + esc(t("land.citizen")) + "</h2><p class=\"muted\">" + esc(t("land.citizen_sub")) + '</p><span class="btn primary lg">' + esc(t("land.citizen_btn")) + U.icon("right") + "</span></a>" +
      '<a class="role-card authority" href="#/login/authority"><span class="badge">' + U.icon("shield", "lg") + "</span><h2>" + esc(t("land.authority")) + "</h2><p class=\"muted\">" + esc(t("land.authority_sub")) + '</p><span class="btn fire lg">' + esc(t("land.authority_btn")) + U.icon("right") + "</span></a></div>" +
      (session ? '<p style="margin-top:18px"><a class="btn" href="' + roleHome(session.role) + '">' + esc(t("land.continue", { name: session.name })) + "</a></p>" : "") +
      '<div class="facts"><div><b>3</b>' + esc(t("land.f1")) + "</div><div><b>24 h</b>" + esc(t("land.f2")) + "</div><div><b>48 h</b>" + esc(t("land.f3")) + "</div><div><b>OpenAQ</b>" + esc(t("land.f4")) + "</div></div></div></main>" +
      "<footer>" + esc(t("app.aws")) + "</footer></div>";
  }
  function login(role) {
    teardown(); shellRole = null;
    if (ROLES.indexOf(role) < 0) { PM.go("#/"); return; }
    PM._lang = PM.store.lang(); PM.applyTheme("citizen");
    var cog = PM.config.auth === "cognito";
    appEl.innerHTML = '<div class="landing"><header><a class="brand" href="#/"><span class="mark">' + U.icon("flame") + "</span><span>" + esc(t("app.name")) + "</span></a>" + topLinks() + "</header>" +
      '<main><div class="login card stack fade-in" style="padding:28px"><div class="row" style="gap:14px"><span class="role-card ' + role + '" style="padding:0;border:0;box-shadow:none;background:none"><span class="badge">' + U.icon(role === "authority" ? "shield" : role === "farmer" ? "leaf" : "user", "lg") + '</span></span><div><h2>' + esc(t("login.title_" + role)) + "</h2>" + (cog ? "" : '<span class="demo-tag">' + esc(t("login.demo_tag")) + "</span>") + "</div></div>" +
      (cog ? '<p class="muted">' + esc(t("login.cognito_text")) + '</p><a class="btn primary lg" href="' + esc(cognitoUrl(role)) + '">' + esc(t("login.cognito_btn")) + "</a>"
        : '<p class="muted">' + esc(t("login.demo_text_" + role)) + '</p><div class="card" style="background:var(--raised)"><div class="row"><span class="avatar">' + roleName(role).slice(5, 6) + '</span><div><b>' + roleName(role) + '</b><div class="small muted">' + esc(t("role." + role + "_label")) + '</div></div></div></div><button class="btn ' + (role === "authority" ? "fire" : role === "farmer" ? "farmer-btn" : "primary") + ' lg" data-continue>' + esc(t("login.continue_" + role)) + "</button>" +
        '<p class="small muted">' + esc(t("login.not_secure")) + "</p>") +
      '<div class="stack" style="gap:4px">' + ROLES.filter(function (r) { return r !== role; }).map(function (r) { return '<a class="small" href="#/login/' + r + '">' + esc(t("login.as", { role: t("role." + r + "_label") })) + "</a>"; }).join("") + "</div></div></main><footer>" + esc(t("app.aws")) + "</footer></div>";
    var b = U.$("[data-continue]");
    if (b) { b.addEventListener("click", function () { setSession(role); }); b.focus(); }
  }

  // ---- start --------------------------------------------------------------------------------------------------------------------
  function start() {
    appEl = document.getElementById("app");
    PM._lang = PM.store.lang();
    var s = PM.store.session();
    PM.applyTheme(s ? s.role : "citizen");
    if (s && s.token && s.exp && s.exp < Date.now()) PM.store.clearSession();
    window.addEventListener("hashchange", route);
    PM.on("theme", function () { /* the map listens for this too */ });
    route();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})((window.PM = window.PM || {}));
