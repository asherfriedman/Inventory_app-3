(function () {
  const AUTH_KEY = "inventory_app_auth_ok_v1";
  const AUTH_AT_KEY = "inventory_app_auth_at_v1";

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

  function fmtNum(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(n);
  }

  function humanDate(iso) {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function todayISO() {
    const d = new Date();
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 10);
  }

  function startOfMonthISO() {
    const d = new Date();
    const local = new Date(d.getFullYear(), d.getMonth(), 1);
    const offset = local.getTimezoneOffset() * 60000;
    return new Date(local.getTime() - offset).toISOString().slice(0, 10);
  }

  function endOfMonthISO() {
    const d = new Date();
    const local = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const offset = local.getTimezoneOffset() * 60000;
    return new Date(local.getTime() - offset).toISOString().slice(0, 10);
  }

  function queryParams() {
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
    window.setTimeout(() => {
      el.remove();
    }, timeoutMs);
  }

  async function api(path, options = {}) {
    const init = { method: "GET", ...options };
    const headers = new Headers(init.headers || {});
    if (init.body && !(init.body instanceof FormData) && typeof init.body !== "string") {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(init.body);
    }
    init.headers = headers;

    const resp = await fetch(path, init);
    let payload = null;
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await resp.json().catch(() => null);
    } else {
      const text = await resp.text().catch(() => "");
      payload = text ? { text } : null;
    }
    if (!resp.ok) {
      throw new Error(payload?.error || payload?.text || `Request failed (${resp.status})`);
    }
    if (payload && payload.error) {
      throw new Error(payload.error);
    }
    return payload || {};
  }

  function authOk() {
    return localStorage.getItem(AUTH_KEY) === "1";
  }

  function markAuthOk() {
    localStorage.setItem(AUTH_KEY, "1");
    localStorage.setItem(AUTH_AT_KEY, String(Date.now()));
  }

  function logout() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_AT_KEY);
    window.location.href = "/login.html";
  }

  function requireAuth() {
    const body = document.body;
    if (!body) return;
    if (body.dataset.public === "true") return;
    if (!authOk()) {
      const next = `${window.location.pathname}${window.location.search || ""}`;
      window.location.href = `/login.html?next=${encodeURIComponent(next)}`;
    }
  }

  function maybeRedirectAuthenticated() {
    if (authOk() && document.body?.dataset.page === "login") {
      const next = queryParams().get("next") || "/index.html";
      window.location.replace(next);
    }
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      });
    }
  }

  function groupMap(groups) {
    return new Map((groups || []).map((g) => [Number(g.id), g]));
  }

  function groupPath(groupId, groupsById) {
    if (!groupId || !groupsById || !groupsById.has(Number(groupId))) return "";
    const out = [];
    let current = groupsById.get(Number(groupId));
    while (current) {
      out.unshift(current.name);
      current = current.parent_id ? groupsById.get(Number(current.parent_id)) : null;
    }
    return out.join(" > ");
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

    select.innerHTML = includeBlank ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";
    flat.forEach((g) => {
      const indent = "\u00A0".repeat(g.depth * 2);
      const opt = document.createElement("option");
      opt.value = String(g.id);
      opt.textContent = `${indent}${g.depth ? "↳ " : ""}${g.name}`;
      if (String(g.id) === value) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function renderGroupTree(container, tree, handlers = {}, state = {}) {
    if (!container) return;
    const activeId = Number(state.activeId || 0);
    container.innerHTML = "";
    if (!tree?.length) {
      container.innerHTML = `<div class="empty">No groups yet.</div>`;
      return;
    }

    function nodeButton(node, opts = {}) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tree-node-btn";
      if (activeId && activeId === Number(node.id)) btn.classList.add("active");
      btn.textContent = node.name;
      btn.addEventListener("click", () => handlers.onSelect?.(node, opts));
      return btn;
    }

    function renderNode(node) {
      if (!node.children?.length) {
        return nodeButton(node);
      }
      const details = document.createElement("details");
      details.open = Boolean(state.expandAll || activeId === Number(node.id) || node.children.some((c) => Number(c.id) === activeId));
      const summary = document.createElement("summary");
      summary.textContent = node.name;
      details.appendChild(summary);

      const childWrap = document.createElement("div");
      childWrap.className = "tree-children";

      if (handlers.allowParentSelect) {
        const parentBtn = nodeButton(node, { parent: true });
        parentBtn.classList.add("tiny");
        childWrap.appendChild(parentBtn);
      }

      for (const child of node.children) {
        childWrap.appendChild(renderNode(child));
      }
      details.appendChild(childWrap);
      return details;
    }

    tree.forEach((node) => container.appendChild(renderNode(node)));
  }

  function findNodeInTree(tree, id) {
    for (const node of tree || []) {
      if (Number(node.id) === Number(id)) return node;
      const found = findNodeInTree(node.children, id);
      if (found) return found;
    }
    return null;
  }

  function renderGroupExplorer(container, tree, goods, currentGroupId, groupsById, goodRowHtml) {
    if (!container) return;
    const cid = currentGroupId ? Number(currentGroupId) : null;

    // breadcrumb
    const crumbs = [{ id: null, name: "All" }];
    if (cid) {
      const ancestors = [];
      let cur = groupsById.get(cid);
      while (cur) {
        ancestors.unshift({ id: Number(cur.id), name: cur.name });
        cur = cur.parent_id ? groupsById.get(Number(cur.parent_id)) : null;
      }
      crumbs.push(...ancestors);
    }

    let html = '<div class="explorer-breadcrumb">';
    crumbs.forEach((c, i) => {
      if (i === crumbs.length - 1) {
        html += `<span class="crumb-current">${escapeHtml(c.name)}</span>`;
      } else {
        html += `<button type="button" data-crumb-id="${c.id ?? ""}">${escapeHtml(c.name)}</button><span class="crumb-sep">\u203A</span>`;
      }
    });
    html += "</div>";

    // child groups
    let childGroups = cid ? (findNodeInTree(tree, cid)?.children || []) : tree;

    // direct goods
    let directGoods = goods.filter((g) => {
      const gid = g.group_id ? Number(g.group_id) : null;
      return cid ? gid === cid : !gid;
    });

    if (!childGroups.length && !directGoods.length) {
      html += emptyState("This group is empty.");
      container.innerHTML = html;
      return;
    }

    html += '<div class="list">';
    for (const node of childGroups) {
      const itemCount = goods.filter((g) => Number(g.group_id) === Number(node.id)).length;
      const subCount = node.children?.length || 0;
      const sub = [subCount ? `${subCount} sub-group${subCount === 1 ? "" : "s"}` : null, `${itemCount} item${itemCount === 1 ? "" : "s"}`].filter(Boolean).join(" \u00B7 ");
      html += `<div class="list-item explorer-folder" data-drill-group="${Number(node.id)}"><div class="row between"><div><div class="list-item-title">\uD83D\uDCC1 ${escapeHtml(node.name)}</div><div class="list-item-sub">${escapeHtml(sub)}</div></div><span class="folder-chevron">\u203A</span></div></div>`;
    }
    for (const g of directGoods) {
      html += goodRowHtml(g);
    }
    html += "</div>";

    container.innerHTML = html;
  }

  function emptyState(message) {
    return `<div class="empty">${escapeHtml(message)}</div>`;
  }

  function docTypeLabel(docType) {
    return Number(docType) === 1 ? "Incoming" : "Outgoing";
  }

  function docTypeEmoji(docType) {
    return Number(docType) === 1 ? "📥" : "📤";
  }

  function docCardHtml(doc) {
    const type = Number(doc.doc_type);
    const contragentName = doc.contragent?.name || "No contragent";
    const chips = [];
    chips.push(`<span class="chip ${type === 1 ? "incoming" : "outgoing"}">${escapeHtml(docTypeLabel(type))}</span>`);
    if (doc.line_count != null) chips.push(`<span class="chip">${Number(doc.line_count)} line${Number(doc.line_count) === 1 ? "" : "s"}</span>`);
    return `
      <div class="list-item clickable" data-doc-id="${Number(doc.id)}">
        <div class="row between">
          <div class="list-item-title">${escapeHtml(docTypeEmoji(type))} ${escapeHtml(doc.doc_num || "Draft")}</div>
          <div class="money">${escapeHtml(fmtMoney(doc.total || 0))}</div>
        </div>
        <div class="list-item-sub">${escapeHtml(humanDate(doc.doc_date))} · ${escapeHtml(contragentName)}</div>
        <div class="chip-row">${chips.join("")}</div>
      </div>
    `;
  }

  function debounce(fn, wait = 220) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  window.InventoryApp = {
    qs,
    qsa,
    escapeHtml,
    api,
    queryParams,
    fmtMoney,
    fmtNum,
    humanDate,
    todayISO,
    startOfMonthISO,
    endOfMonthISO,
    setLoading,
    toast,
    authOk,
    markAuthOk,
    logout,
    requireAuth,
    maybeRedirectAuthenticated,
    registerServiceWorker,
    groupMap,
    groupPath,
    flattenGroups,
    fillGroupSelect,
    renderGroupTree,
    emptyState,
    renderGroupExplorer,
    docCardHtml,
    debounce
  };

  document.addEventListener("DOMContentLoaded", () => {
    registerServiceWorker();
    maybeRedirectAuthenticated();
    requireAuth();

    // Select all text on focus for any input/textarea
    document.addEventListener("focusin", (e) => {
      const el = e.target;
      if ((el.tagName === "INPUT" && el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio") || el.tagName === "TEXTAREA") {
        requestAnimationFrame(() => el.select());
      }
    });
  });
})();
