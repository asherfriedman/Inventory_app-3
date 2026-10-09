(function () {
  const AUTH_KEY = "inventory_app_auth_ok_v1";
  const AUTH_AT_KEY = "inventory_app_auth_at_v1";
  const SESSION_TOKEN_KEY = "inventory_app_session_token";
  const DB_IMPORTED_AT_KEY = "inventory_db_imported_at_v1";

  const DOC_IN = 1;
  const DOC_OUT = 2;
  const DOC_ADJ = 3;

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtMoney(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);
  }

  function fmtMoney0(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(n);
  }

  function fmtNum(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(n);
  }

  function fmtSigned(value) {
    const n = Number(value || 0);
    return `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNum(Math.abs(n))}`;
  }

  function fmtMoneySigned(value) {
    const n = Number(value || 0);
    return `${n < 0 ? "−" : n > 0 ? "+" : ""}${fmtMoney(Math.abs(n))}`;
  }

  function humanDate(iso) {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function dayLabel(iso) {
    if (!iso) return "";
    const today = todayISO();
    if (iso === today) return "Today";
    const y = new Date(`${today}T00:00:00`);
    y.setDate(y.getDate() - 1);
    if (iso === toISO(y)) return "Yesterday";
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    const sameYear = iso.slice(0, 4) === today.slice(0, 4);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  }

  function shortDate(iso) {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    const sameYear = iso.slice(0, 4) === todayISO().slice(0, 4);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  }

  function toISO(d) {
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 10);
  }

  function todayISO() {
    return toISO(new Date());
  }

  function startOfMonthISO() {
    const d = new Date();
    return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function endOfMonthISO() {
    const d = new Date();
    return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }

  function isSpa() {
    return document.body?.dataset.app === "spa";
  }

  function queryParams() {
    if (isSpa()) return parseRoute().params;
    return new URLSearchParams(window.location.search);
  }

  function setLoading(el, loading) {
    if (!el) return;
    el.classList.toggle("loading", Boolean(loading));
    if ("disabled" in el) {
      el.disabled = Boolean(loading);
    }
  }

  function toast(message, timeoutMs = 2400) {
    const stack = qs("#toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = String(message || "");
    stack.appendChild(el);
    // Give long messages (stock errors) enough time to be read.
    window.setTimeout(() => {
      el.remove();
    }, Math.max(timeoutMs, 1200 + el.textContent.length * 45));
  }

  // A toast to show on the next page (e.g. "Sale saved" after navigating away).
  // In the single-page app the toast simply outlives the screen change.
  const FLASH_KEY = "inventory_flash_v1";
  function flash(message) {
    if (isSpa()) {
      toast(message);
      return;
    }
    sessionStorage.setItem(FLASH_KEY, String(message || ""));
  }
  function showFlash() {
    const message = sessionStorage.getItem(FLASH_KEY);
    if (!message) return;
    sessionStorage.removeItem(FLASH_KEY);
    toast(message);
  }

  async function localData(path, options = {}) {
    const result = await window.LocalDB.handleRequest(path, options);
    if (result && result.error) {
      throw new Error(result.error);
    }
    return result || {};
  }

  function authOk() {
    return localStorage.getItem(AUTH_KEY) === "1";
  }

  function markAuthOk(token) {
    localStorage.setItem(AUTH_KEY, "1");
    localStorage.setItem(AUTH_AT_KEY, String(Date.now()));
    if (token) {
      localStorage.setItem(SESSION_TOKEN_KEY, token);
    }
  }

  function logout() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_AT_KEY);
    localStorage.removeItem(SESSION_TOKEN_KEY);
    window.location.href = "login.html";
  }

  function requireAuth() {
    const body = document.body;
    if (!body) return true;
    if (body.dataset.public === "true") return true;
    if (!authOk()) {
      const next = `${window.location.pathname}${window.location.search || ""}${window.location.hash || ""}`;
      window.location.href = `login.html?next=${encodeURIComponent(next)}`;
      return false;
    }
    return true;
  }

  function maybeRedirectAuthenticated() {
    if (authOk() && document.body?.dataset.page === "login") {
      const next = queryParams().get("next") || "index.html";
      window.location.replace(next);
    }
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", async () => {
        if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
          navigator.serviceWorker.getRegistrations()
            .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
            .catch(() => undefined);
          return;
        }
        try {
          const existing = await navigator.serviceWorker.getRegistration();
          if (existing) return;
          await navigator.serviceWorker.register("sw.js");
        } catch {
          // The app can still run from the network without a service worker.
        }
      });
    }
  }

  function setupPageResumeRefresh() {
    sessionStorage.setItem(DB_IMPORTED_AT_KEY, localStorage.getItem(DB_IMPORTED_AT_KEY) || "");
    window.addEventListener("pageshow", (event) => {
      const latestImport = localStorage.getItem(DB_IMPORTED_AT_KEY) || "";
      const seenImport = sessionStorage.getItem(DB_IMPORTED_AT_KEY) || "";
      if (!event.persisted && latestImport === seenImport) return;
      sessionStorage.setItem(DB_IMPORTED_AT_KEY, latestImport);
      window.location.reload();
    });
  }

  // ── icons ────────────────────────────────────────────────────────────
  const ICON_PATHS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    docs: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
    box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
    people: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M21 20v-1.5a4 4 0 0 0-3-3.85M15.5 4.1a3.5 3.5 0 0 1 0 6.8"/>',
    chart: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" fill-opacity=".18"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
    sale: '<path d="M6 7h12l-1 13H7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
    receive: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    count: '<path d="M9 4h6v3H9z"/><path d="M15 5h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3"/><path d="M9 14l2 2 4-4"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    phone: '<path d="M5 4h3l2 5-2 1a11 11 0 0 0 6 6l1-2 5 2v3a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    groups: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 13h8"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18z"/>'
  };

  function icon(name, extraClass = "") {
    const paths = ICON_PATHS[name] || "";
    return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  function hydrateIcons(root = document) {
    qsa("[data-icon]", root).forEach((el) => {
      if (el.dataset.iconDone) return;
      el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
      el.dataset.iconDone = "1";
    });
  }

  // ── navigation ───────────────────────────────────────────────────────
  const TABS = [
    { key: "home", href: "index.html", label: "Home", icon: "home" },
    { key: "documents", href: "documents.html", label: "Documents", icon: "docs" },
    { key: "goods", href: "goods.html", label: "Products", icon: "box" },
    { key: "contragents", href: "contragents.html", label: "Customers", icon: "people" },
    { key: "reports", href: "reports.html", label: "Reports", icon: "chart" }
  ];

  let tabBar = null;

  function renderTabBar() {
    tabBar = document.createElement("nav");
    tabBar.className = "tabbar hidden";
    tabBar.innerHTML = `<div class="tabbar-inner">${TABS.map((t) => `
      <a class="tab" data-tab-key="${t.key}" href="${t.href}">${icon(t.icon)}<span>${t.label}</span></a>`).join("")}</div>`;
    document.body.appendChild(tabBar);
    // Go on finger-up so a tab never needs a second tap. Tapping the current
    // tab scrolls back to the top.
    let handledAt = 0;
    const pick = (tab) => {
      if (!tab) return;
      handledAt = Date.now();
      if (tab.classList.contains("active")) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      go(tab.getAttribute("href"));
    };
    tabBar.addEventListener("pointerup", (e) => pick(e.target.closest(".tab")));
    tabBar.addEventListener("click", (e) => {
      const tab = e.target.closest(".tab");
      if (!tab) return;
      e.preventDefault();
      if (Date.now() - handledAt > 500) pick(tab);
    });
  }

  function updateTabBar(activeKey) {
    if (!tabBar) return;
    tabBar.classList.toggle("hidden", !activeKey);
    document.body.classList.toggle("has-tabbar", Boolean(activeKey));
    qsa(".tab", tabBar).forEach((t) => {
      const on = t.dataset.tabKey === activeKey;
      t.classList.toggle("active", on);
      if (on) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
  }

  // ── router ───────────────────────────────────────────────────────────
  // Every screen is a <template id="view-NAME"> plus a mount function from
  // defineView(). Routes look like #/documents?type=2. Old page URLs
  // ("documents.html?type=2") are accepted anywhere a route is.
  const views = new Map();
  let currentAbort = null;
  const scrollMemory = new Map();
  let shownDepth = 0;

  function defineView(name, mount) {
    views.set(name, mount);
  }

  function routeFromTarget(target) {
    const raw = String(target || "");
    const hashAt = raw.indexOf("#/");
    const spec = hashAt >= 0 ? raw.slice(hashAt + 2) : raw.replace(/^\.?\//, "");
    const qAt = spec.indexOf("?");
    let name = (qAt >= 0 ? spec.slice(0, qAt) : spec).replace(/\.html$/, "");
    const query = qAt >= 0 ? spec.slice(qAt + 1) : "";
    if (!name || name === "index") name = "home";
    return { name, query };
  }

  function parseRoute() {
    const { name, query } = routeFromTarget(window.location.hash || "#/home");
    return { name, params: new URLSearchParams(query) };
  }

  function currentDepth() {
    return Number(window.history.state?.depth || 0);
  }

  function go(target, options = {}) {
    const { name, query } = routeFromTarget(target);
    if (isSpa() && !views.has(name) && document.getElementById(`view-${name}`)) {
      repairStaleFiles();
      return;
    }
    if (!isSpa() || !views.has(name)) {
      // Not a screen of this app (login, refresh page ...): real navigation.
      if (options.replace) window.location.replace(target);
      else window.location.href = target;
      return;
    }
    if (!options.force && !canLeave()) return;
    const hash = `#/${name}${query ? `?${query}` : ""}`;
    scrollMemory.set(currentDepth(), window.scrollY);
    if (options.replace) {
      window.history.replaceState({ depth: currentDepth() }, "", hash);
    } else {
      window.history.pushState({ depth: currentDepth() + 1 }, "", hash);
    }
    shownDepth = currentDepth();
    renderRoute();
  }

  function renderRoute(restoreScrollTo = 0) {
    const { name, params } = parseRoute();
    const template = document.getElementById(`view-${name}`);
    const mount = views.get(name);
    if (template && !mount) {
      repairStaleFiles();
      return;
    }
    if (!template) {
      if (name === "home") return;
      window.history.replaceState({ depth: currentDepth() }, "", "#/home");
      renderRoute();
      return;
    }
    currentAbort?.abort();
    currentAbort = new AbortController();
    setLeaveGuard(null);
    document.body.classList.remove("modal-lock");

    const root = document.getElementById("view");
    root.replaceChildren(template.content.cloneNode(true));
    hydrateIcons(root);
    document.title = template.dataset.title || "Inventory";
    document.body.dataset.page = name;
    document.body.classList.toggle("has-bottom-bar", (template.dataset.bodyClass || "").includes("has-bottom-bar"));
    updateTabBar(template.dataset.tab || "");
    window.scrollTo(0, 0);

    try {
      mount({ params, signal: currentAbort.signal });
    } catch (err) {
      console.error(err);
      toast(err.message || "Something went wrong");
    }
    if (restoreScrollTo) restoreScroll(restoreScrollTo);
  }

  // A screen exists but its script didn't load: the phone has a mix of old
  // and new app files. Clear the app cache and reload once.
  async function repairStaleFiles() {
    const KEY = "inventory_repair_reload_v1";
    if (sessionStorage.getItem(KEY)) {
      document.getElementById("view").innerHTML = `<div class="page"><div class="card">${emptyState("Part of the app didn't load. Close the app completely and open it again.")}</div></div>`;
      return;
    }
    sessionStorage.setItem(KEY, "1");
    try {
      if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    } catch {
      // reload anyway
    }
    window.location.reload();
  }

  // Lists fill in a moment after the screen appears; keep trying briefly.
  function restoreScroll(y) {
    let tries = 0;
    const attempt = () => {
      window.scrollTo(0, y);
      if (Math.abs(window.scrollY - y) > 2 && tries++ < 30) setTimeout(attempt, 20);
    };
    setTimeout(attempt, 0);
  }

  function setupRouter() {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    if (!window.history.state) window.history.replaceState({ depth: 0 }, "", window.location.hash || "#/home");
    shownDepth = currentDepth();
    window.addEventListener("popstate", () => {
      const depth = currentDepth();
      if (!canLeave()) {
        // Stay on this screen: undo the history step.
        window.history.go(shownDepth - depth);
        return;
      }
      scrollMemory.set(shownDepth, window.scrollY);
      shownDepth = depth;
      renderRoute(scrollMemory.get(depth) || 0);
    });
    // In-app links (including old "page.html" hrefs) switch screens in place.
    document.addEventListener("click", (event) => {
      const a = event.target.closest("a[href]");
      if (!a || a.target || event.defaultPrevented) return;
      const href = a.getAttribute("href");
      if (/^(https?:|tel:|sms:|mailto:)/i.test(href)) return;
      if (!views.has(routeFromTarget(href).name)) return;
      event.preventDefault();
      go(href);
    });
  }

  // Pages can set a guard (e.g. unsaved sale) that must return true to leave.
  let leaveGuard = null;
  function setLeaveGuard(fn) {
    leaveGuard = typeof fn === "function" ? fn : null;
  }
  function canLeave() {
    return !leaveGuard || leaveGuard();
  }

  function goBack(fallback = "index.html") {
    if (!canLeave()) return;
    if (isSpa()) {
      setLeaveGuard(null);
      if (currentDepth() > 0) window.history.back();
      else go(fallback, { replace: true, force: true });
      return;
    }
    const sameOrigin = document.referrer && new URL(document.referrer).origin === window.location.origin;
    if (sameOrigin && window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = fallback;
    }
  }

  function setupBackButtons() {
    document.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-back]");
      if (!btn) return;
      event.preventDefault();
      goBack(btn.dataset.back || "index.html");
    });
  }

  // ── groups ───────────────────────────────────────────────────────────
  function groupMap(groups) {
    return new Map((groups || []).map((g) => [Number(g.id), g]));
  }

  function groupPath(groupId, groupsById) {
    if (!groupId || !groupsById || !groupsById.has(Number(groupId))) return "";
    const out = [];
    const seen = new Set();
    let current = groupsById.get(Number(groupId));
    while (current && !seen.has(Number(current.id))) {
      seen.add(Number(current.id));
      out.unshift(current.name);
      current = current.parent_id ? groupsById.get(Number(current.parent_id)) : null;
    }
    return out.join(" › ");
  }

  function flattenGroups(tree, depth = 0, out = []) {
    for (const node of tree || []) {
      out.push({ ...node, depth });
      if (node.children?.length) flattenGroups(node.children, depth + 1, out);
    }
    return out;
  }

  function fillGroupSelect(select, tree, options = {}) {
    if (!select) return;
    const flat = flattenGroups(tree || []);
    const includeBlank = options.includeBlank !== false;
    const blankLabel = options.blankLabel || "Select...";
    const value = String(options.value ?? select.value ?? "");
    const excludeId = options.excludeId ? Number(options.excludeId) : null;

    select.innerHTML = includeBlank ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";
    const path = [];
    flat.forEach((g) => {
      path.length = g.depth;
      path.push(g.name);
      if (excludeId && Number(g.id) === excludeId) return;
      const opt = document.createElement("option");
      opt.value = String(g.id);
      opt.textContent = `${path.join(" › ")}${g.is_active === false ? " (inactive)" : ""}`;
      if (String(g.id) === value) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function findNodeInTree(tree, id) {
    for (const node of tree || []) {
      if (Number(node.id) === Number(id)) return node;
      const found = findNodeInTree(node.children, id);
      if (found) return found;
    }
    return null;
  }

  function normalizeGroupTree(nodes) {
    return (nodes || []).map((node) => ({
      ...node,
      is_active: node.is_active !== false,
      children: normalizeGroupTree(node.children || [])
    }));
  }

  function filterTree(nodes, keep) {
    const out = [];
    for (const node of nodes || []) {
      if (!keep(node)) continue;
      out.push({ ...node, children: filterTree(node.children || [], keep) });
    }
    return out;
  }

  function collectTreeIds(nodes, out = new Set()) {
    for (const node of nodes || []) {
      out.add(Number(node.id));
      collectTreeIds(node.children || [], out);
    }
    return out;
  }

  function safeNum(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function sellPrice(good, groupsById) {
    const group = good?.group_id ? groupsById?.get(Number(good.group_id)) : null;
    return safeNum(group?.price_out);
  }

  function computeGroupTotals(goods, groupsById) {
    const totals = new Map();
    for (const good of goods || []) {
      const qty = safeNum(good.quantity);
      const cost = qty * safeNum(good.avg_cost);
      const value = qty * sellPrice(good, groupsById);
      let groupId = good?.group_id ? Number(good.group_id) : null;
      const seen = new Set();
      while (groupId && groupsById.has(groupId) && !seen.has(groupId)) {
        seen.add(groupId);
        const t = totals.get(groupId) || { qty: 0, cost: 0, value: 0, items: 0 };
        t.qty += qty;
        t.cost += cost;
        t.value += value;
        t.items += 1;
        totals.set(groupId, t);
        const parentId = groupsById.get(groupId)?.parent_id;
        groupId = parentId ? Number(parentId) : null;
      }
    }
    return totals;
  }

  // Folder-style browser: breadcrumb, sub-groups, then the goods directly in
  // the current group. `goodRowHtml(good)` renders each product row.
  function renderGroupExplorer(container, opts) {
    if (!container) return;
    const { tree, goods, groupId, groupsById, goodRowHtml, totalsGoods, totalsGroupsById, emptyText } = opts;
    const cid = groupId ? Number(groupId) : null;
    const totals = computeGroupTotals(totalsGoods || goods, totalsGroupsById || groupsById);

    let html = "";
    if (cid) {
      const crumbs = [{ id: "", name: "All" }];
      const chain = [];
      const seen = new Set();
      let cur = groupsById.get(cid);
      while (cur && !seen.has(Number(cur.id))) {
        seen.add(Number(cur.id));
        chain.unshift({ id: Number(cur.id), name: cur.name });
        cur = cur.parent_id ? groupsById.get(Number(cur.parent_id)) : null;
      }
      crumbs.push(...chain);
      html += `<div class="crumbs">${crumbs.map((c, i) => i === crumbs.length - 1
        ? `<span class="crumb-current">${escapeHtml(c.name)}</span>`
        : `<button type="button" data-crumb-id="${c.id}">${escapeHtml(c.name)}</button><span class="crumb-sep">›</span>`).join("")}</div>`;
    }

    const childGroups = cid ? (findNodeInTree(tree, cid)?.children || []) : tree;
    const directGoods = goods.filter((g) => {
      const gid = g.group_id ? Number(g.group_id) : null;
      return cid ? gid === cid : !gid;
    });

    if (!childGroups.length && !directGoods.length) {
      container.innerHTML = html + `<div class="card">${emptyState(emptyText || "Nothing here.")}</div>`;
      return;
    }

    html += '<div class="card flush"><div class="rows">';
    for (const node of childGroups) {
      const t = totals.get(Number(node.id)) || { qty: 0, cost: 0, value: 0 };
      const sub = `${fmtNum(t.qty)} in stock · cost ${fmtMoney0(t.cost)}`;
      html += `
        <div class="row-item tappable" data-drill-group="${Number(node.id)}">
          <span class="folder-icon">${icon("folder")}</span>
          <div class="row-main">
            <div class="row-title">${escapeHtml(node.name)}${node.is_active === false ? ' <span class="badge badge-off">Inactive</span>' : ""}</div>
            <div class="row-sub">${escapeHtml(sub)}</div>
          </div>
          <span class="chevron">${icon("chevron")}</span>
        </div>`;
    }
    for (const g of directGoods) html += goodRowHtml(g);
    html += "</div></div>";
    container.innerHTML = html;
  }

  // ── product search ───────────────────────────────────────────────────
  function searchProducts(goods, queryText, limit = 60) {
    const tokens = String(queryText || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const scored = [];
    for (const good of goods || []) {
      const name = String(good.name || "").toLowerCase();
      const haystack = `${String(good.group_path || "").toLowerCase()} ${name}`;
      if (!tokens.every((t) => haystack.includes(t))) continue;
      const score = name.startsWith(tokens[0]) ? 0 : name.includes(tokens[0]) ? 1 : 2;
      scored.push({ good, score });
    }
    scored.sort((a, b) => a.score - b.score
      || (Number(b.good.quantity > 0) - Number(a.good.quantity > 0))
      || String(a.good.name).localeCompare(String(b.good.name))
      || String(a.good.group_path).localeCompare(String(b.good.group_path)));
    return scored.slice(0, limit).map((s) => s.good);
  }

  function searchBox(id, placeholder, extra = "") {
    return `
      <label class="search">
        ${icon("search")}
        <input class="input" id="${id}" type="search" placeholder="${escapeHtml(placeholder)}" autocomplete="off" ${extra}>
        <button class="search-clear hidden" type="button" data-clear-for="${id}" aria-label="Clear">×</button>
      </label>`;
  }

  function setupSearchClear() {
    document.addEventListener("input", (event) => {
      const input = event.target;
      if (!input.matches?.(".search .input")) return;
      qs(`[data-clear-for="${input.id}"]`)?.classList.toggle("hidden", !input.value);
    });
    document.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-clear-for]");
      if (!btn) return;
      event.preventDefault();
      const input = document.getElementById(btn.dataset.clearFor);
      if (!input) return;
      input.value = "";
      btn.classList.add("hidden");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
  }

  // ── documents ────────────────────────────────────────────────────────
  function docTypeLabel(docType) {
    const t = Number(docType);
    if (t === DOC_IN) return "Receiving";
    if (t === DOC_ADJ) return "Adjustment";
    return "Sale";
  }

  function docBadge(docType) {
    const t = Number(docType);
    if (t === DOC_IN) return '<span class="badge badge-in">In</span>';
    if (t === DOC_ADJ) return '<span class="badge badge-adj">Adj</span>';
    return '<span class="badge badge-sale">Sale</span>';
  }

  function docPartyName(doc) {
    const t = Number(doc.doc_type);
    if (t === DOC_ADJ) return doc.description || "Stock adjustment";
    if (doc.contragent?.name) return doc.contragent.name;
    return t === DOC_IN ? "No supplier" : "Walk-in";
  }

  function leafGroupName(path) {
    const parts = String(path || "").split(/\s*[>›]\s*/).filter(Boolean);
    return parts[parts.length - 1] || "";
  }

  function docCardHtml(doc, options = {}) {
    const t = Number(doc.doc_type);
    const lines = doc.lines_preview || doc.lines || [];
    const shown = lines.slice(0, 3).map((line) => {
      const name = line.good?.name || `#${line.good_id}`;
      const group = leafGroupName(line.group_name || "");
      const qty = t === DOC_ADJ ? fmtSigned(line.quantity) : `${fmtNum(line.quantity)} ×`;
      return `<div>${escapeHtml(qty)} ${escapeHtml(name)}${group ? ` <span class="muted">· ${escapeHtml(group)}</span>` : ""}</div>`;
    });
    if (lines.length > 3) shown.push(`<div>+${lines.length - 3} more</div>`);
    const total = Number(doc.total || 0);
    const totalText = t === DOC_ADJ ? fmtMoneySigned(total) : fmtMoney(total);
    const totalClass = t === DOC_ADJ ? (total < 0 ? " neg" : total > 0 ? " pos" : "") : "";
    // On a customer's own page the name is redundant, so the date leads.
    const title = options.dateTitle ? dayLabel(doc.doc_date) : docPartyName(doc);
    let meta = `${docBadge(t)} ${escapeHtml(doc.doc_num || `#${doc.id}`)}`;
    if (options.showDate && !options.dateTitle) meta += ` · ${escapeHtml(dayLabel(doc.doc_date))}`;
    return `
      <div class="row-item tappable doc-row" data-doc-id="${Number(doc.id)}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(title)}</div>
          <div class="row-sub">${meta}</div>
          ${shown.length ? `<div class="doc-lines">${shown.join("")}</div>` : ""}
        </div>
        <div class="row-end"><span class="row-value${totalClass}">${escapeHtml(totalText)}</span></div>
      </div>`;
  }

  function docUrl(docId) {
    return `document-form.html?id=${encodeURIComponent(docId)}`;
  }

  function emptyState(message) {
    return `<div class="empty">${escapeHtml(message)}</div>`;
  }

  function debounce(fn, wait = 220) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function openModal(modal) {
    modal?.classList.add("open");
    modal?.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-lock");
  }

  function closeModal(modal) {
    modal?.classList.remove("open");
    modal?.setAttribute("aria-hidden", "true");
    if (!qs(".modal.open")) document.body.classList.remove("modal-lock");
  }

  function setupModals() {
    document.addEventListener("click", (event) => {
      const closer = event.target.closest("[data-close-modal]");
      if (closer) {
        closeModal(closer.closest(".modal"));
        return;
      }
      if (event.target.classList?.contains("modal") && event.target.dataset.backdropClose !== "false") {
        closeModal(event.target);
      }
    });
  }

  window.InventoryApp = {
    DOC_IN,
    DOC_OUT,
    DOC_ADJ,
    qs,
    qsa,
    escapeHtml,
    localData,
    queryParams,
    defineView,
    go,
    fmtMoney,
    fmtMoney0,
    fmtNum,
    fmtSigned,
    fmtMoneySigned,
    humanDate,
    shortDate,
    dayLabel,
    todayISO,
    toISO,
    startOfMonthISO,
    endOfMonthISO,
    setLoading,
    toast,
    flash,
    authOk,
    markAuthOk,
    logout,
    requireAuth,
    maybeRedirectAuthenticated,
    registerServiceWorker,
    icon,
    hydrateIcons,
    goBack,
    setLeaveGuard,
    canLeave,
    groupMap,
    groupPath,
    flattenGroups,
    fillGroupSelect,
    findNodeInTree,
    normalizeGroupTree,
    filterTree,
    collectTreeIds,
    sellPrice,
    renderGroupExplorer,
    searchProducts,
    searchBox,
    emptyState,
    docTypeLabel,
    docBadge,
    docPartyName,
    leafGroupName,
    docCardHtml,
    docUrl,
    debounce,
    openModal,
    closeModal
  };

  // Initialize LocalDB, then run normal startup
  async function startup() {
    hydrateIcons();
    if (isSpa()) renderTabBar();
    setupBackButtons();
    setupSearchClear();
    setupModals();
    try {
      await window.LocalDB.init();
    } catch (e) {
      console.error("LocalDB init failed:", e);
    }
    registerServiceWorker();
    maybeRedirectAuthenticated();
    if (!requireAuth()) return;
    setupPageResumeRefresh();

    // Select all text on focus for any input/textarea
    document.addEventListener("focusin", (e) => {
      const el = e.target;
      if ((el.tagName === "INPUT" && el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && el.type !== "date") || el.tagName === "TEXTAREA") {
        requestAnimationFrame(() => el.select());
      }
    });

    if (isSpa()) {
      setupRouter();
      renderRoute();
    } else {
      // Standalone pages (login, contact import) wait for this event.
      document.dispatchEvent(new Event("app-ready"));
      showFlash();
    }
    maybeRunDailyBackup();
  }

  async function maybeRunDailyBackup() {
    const DriveBackup = window.InventoryDriveBackup;
    if (!DriveBackup?.maybeBackupOnOpen) return;
    try {
      const result = await DriveBackup.maybeBackupOnOpen();
      if (!result?.skipped) toast("Daily backup uploaded", 2600);
      if (result?.skipped && result.reason === "needs_interactive_auth") {
        toast("Daily backup needs Google Drive refresh. Use Settings > Back Up Now.", 5200);
      } else if (result?.skipped && result.reason === "backup_failed") {
        toast(`Daily backup failed: ${result.error || "unknown error"}`, 5200);
      }
    } catch {
      // Backup must never block normal app startup.
    }
  }

  document.addEventListener("DOMContentLoaded", startup);
})();
