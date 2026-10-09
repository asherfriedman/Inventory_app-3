document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const els = {
    summary: App.qs("#goodsSummary"),
    search: App.qs("#goodsSearch"),
    chips: App.qs("#goodsChips"),
    explorer: App.qs("#goodsExplorer"),
    groupsModal: App.qs("#groupsModal"),
    openGroupsBtn: App.qs("#openGroupsBtn"),
    groupsListView: App.qs("#groupsListView"),
    groupsAdminList: App.qs("#groupsAdminList"),
    newGroupBtn: App.qs("#newGroupBtn"),
    groupForm: App.qs("#groupForm"),
    groupFormBack: App.qs("#groupFormBack"),
    groupFormTitle: App.qs("#groupFormTitle"),
    groupFormId: App.qs("#groupFormId"),
    groupFormName: App.qs("#groupFormName"),
    groupFormParent: App.qs("#groupFormParent"),
    groupFormPriceIn: App.qs("#groupFormPriceIn"),
    groupFormPriceOut: App.qs("#groupFormPriceOut"),
    groupFormActive: App.qs("#groupFormActive"),
    groupDeleteBtn: App.qs("#groupDeleteBtn")
  };
  const VIEW_KEY = "inventory_goods_view_v1";

  const state = {
    groups: [],
    tree: [],
    groupById: new Map(),
    goods: [],
    groupId: null,
    showZero: false,
    showInactive: false
  };

  try {
    const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY) || "{}");
    state.groupId = saved.groupId || null;
    state.showZero = Boolean(saved.showZero);
    state.showInactive = Boolean(saved.showInactive);
    els.search.value = saved.search || "";
  } catch {
    // ignore
  }

  function saveView() {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({
      groupId: state.groupId,
      showZero: state.showZero,
      showInactive: state.showInactive,
      search: els.search.value
    }));
  }

  function parseNum(value) {
    const n = Number(String(value ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function goodRowHtml(good, showPath) {
    const qty = Number(good.quantity || 0);
    const sell = App.sellPrice(good, state.groupById);
    const sub = [];
    if (showPath) sub.push(App.groupPath(good.group_id, state.groupById) || "No group");
    sub.push(sell ? `sells ${App.fmtMoney(sell)}` : "no sell price");
    sub.push(`cost ${App.fmtMoney(good.avg_cost)}`);
    return `
      <div class="row-item tappable" data-good-id="${Number(good.id)}">
        <div class="row-main">
          <div class="row-title">${App.escapeHtml(good.name)}</div>
          <div class="row-sub clip">${App.escapeHtml(sub.join(" · "))}</div>
        </div>
        <span class="qty-pill${qty <= 0 ? " zero" : ""}">${App.escapeHtml(App.fmtNum(qty))}</span>
        <span class="chevron">${App.icon("chevron")}</span>
      </div>`;
  }

  function visibleState() {
    const tree = state.showInactive ? state.tree : App.filterTree(state.tree, (n) => n.is_active !== false);
    const ids = App.collectTreeIds(tree);
    const goods = state.goods.filter((g) => {
      if (g.group_id && !ids.has(Number(g.group_id))) return false;
      return state.showZero || Number(g.quantity || 0) > 0;
    });
    return { tree, ids, goods };
  }

  function leafGoods(visible) {
    const node = state.groupId ? App.findNodeInTree(visible.tree, state.groupId) : null;
    if (!node || node.children?.length) return [];
    return visible.goods.filter((g) => Number(g.group_id) === Number(state.groupId));
  }

  function renderChips(visible) {
    const searching = Boolean(els.search.value.trim());
    const chips = [
      `<button class="chip${state.showZero ? " active" : ""}" type="button" data-chip="zero">Out of stock</button>`,
      `<button class="chip${state.showInactive ? " active" : ""}" type="button" data-chip="inactive">Inactive groups</button>`
    ];
    if (!searching && leafGoods(visible).length) {
      chips.push(`<button class="chip" type="button" data-chip="copy">Copy names</button>`);
    }
    els.chips.innerHTML = chips.join("");
  }

  function render() {
    const visible = visibleState();
    if (state.groupId && !visible.ids.has(Number(state.groupId))) state.groupId = null;
    renderChips(visible);
    const q = els.search.value.trim();
    if (q) {
      const results = App.searchProducts(state.goods, q, 200);
      els.explorer.innerHTML = results.length
        ? `<div class="card flush"><div class="rows">${results.map((g) => goodRowHtml(g, true)).join("")}</div></div>`
        : `<div class="card">${App.emptyState("No products match.")}</div>`;
    } else {
      App.renderGroupExplorer(els.explorer, {
        tree: visible.tree,
        goods: visible.goods,
        groupId: state.groupId,
        groupsById: state.groupById,
        goodRowHtml: (g) => goodRowHtml(g, false),
        totalsGoods: state.goods,
        emptyText: state.showZero ? "No products here." : "Nothing in stock here. Tap “Out of stock” to see everything."
      });
    }
    const inStock = state.goods.filter((g) => Number(g.quantity || 0) > 0).length;
    els.summary.textContent = `${inStock} of ${state.goods.length} in stock`;
    saveView();
  }

  // ── groups admin ─────────────────────────────────────────────────────
  function renderGroupAdmin() {
    const rows = state.groups
      .map((g) => ({ g, path: App.groupPath(g.id, state.groupById) }))
      .sort((a, b) => a.path.localeCompare(b.path));
    els.groupsAdminList.innerHTML = rows.length ? rows.map(({ g, path }) => `
      <div class="row-item tappable" data-edit-group="${Number(g.id)}">
        <div class="row-main">
          <div class="row-title">${App.escapeHtml(path)}${g.is_active === false ? ' <span class="badge badge-off">Inactive</span>' : ""}</div>
          <div class="row-sub">Buy ${App.escapeHtml(App.fmtMoney(g.price_in))} · Sell ${App.escapeHtml(App.fmtMoney(g.price_out))}</div>
        </div>
        <span class="chevron">${App.icon("chevron")}</span>
      </div>`).join("") : App.emptyState("No groups yet.");
  }

  function showGroupList() {
    els.groupForm.classList.add("hidden");
    els.groupsListView.classList.remove("hidden");
  }

  function openGroupForm(groupId, parentId = null) {
    const group = groupId ? state.groups.find((g) => Number(g.id) === Number(groupId)) : null;
    els.groupFormTitle.textContent = group ? "Edit group" : "New group";
    els.groupFormId.value = group ? String(group.id) : "";
    els.groupFormName.value = group?.name || "";
    App.fillGroupSelect(els.groupFormParent, state.tree, {
      includeBlank: true,
      blankLabel: "None (top level)",
      value: group ? (group.parent_id || "") : (parentId || ""),
      excludeId: group?.id
    });
    els.groupFormPriceIn.value = group ? String(Number(group.price_in || 0)) : "";
    els.groupFormPriceOut.value = group ? String(Number(group.price_out || 0)) : "";
    els.groupFormActive.checked = group ? group.is_active !== false : true;
    els.groupDeleteBtn.classList.toggle("hidden", !group);
    els.groupsListView.classList.add("hidden");
    els.groupForm.classList.remove("hidden");
    App.openModal(els.groupsModal);
  }

  async function saveGroup(e) {
    e.preventDefault();
    const payload = {
      name: els.groupFormName.value.trim(),
      parent_id: els.groupFormParent.value || null,
      price_in: parseNum(els.groupFormPriceIn.value),
      price_out: parseNum(els.groupFormPriceOut.value),
      is_active: els.groupFormActive.checked
    };
    if (!payload.name) return App.toast("Enter a group name");
    try {
      if (els.groupFormId.value) {
        await App.localData("goods-groups", { method: "PUT", body: { id: Number(els.groupFormId.value), ...payload } });
        App.toast("Group saved");
      } else {
        await App.localData("goods-groups", { method: "POST", body: payload });
        App.toast("Group added");
      }
      await loadAll();
      showGroupList();
    } catch (err) {
      App.toast(err.message || "Failed to save group");
    }
  }

  async function deleteGroup() {
    const id = els.groupFormId.value;
    if (!id || !window.confirm("Delete this group?")) return;
    try {
      await App.localData(`goods-groups?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      App.toast("Group deleted");
      if (Number(state.groupId) === Number(id)) state.groupId = null;
      await loadAll();
      showGroupList();
    } catch (err) {
      App.toast(err.message || "Failed to delete group");
    }
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Copy failed");
  }

  async function copyNames() {
    const goods = leafGoods(visibleState()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const text = goods.map((g) => String(g.name || "").trim()).filter(Boolean).join("\n");
    if (!text) return App.toast("No names to copy");
    try {
      await copyText(text);
      App.toast(`Copied ${goods.length} name${goods.length === 1 ? "" : "s"}`);
    } catch (err) {
      App.toast(err.message || "Copy failed");
    }
  }

  async function loadAll() {
    const [groupsData, goodsData] = await Promise.all([App.localData("goods-groups"), App.localData("goods")]);
    state.groups = groupsData.groups || [];
    state.tree = App.normalizeGroupTree(groupsData.tree || []);
    state.groupById = App.groupMap(state.groups);
    state.goods = goodsData.goods || [];
    renderGroupAdmin();
    render();
  }

  // ── events ───────────────────────────────────────────────────────────
  els.explorer.addEventListener("click", (e) => {
    const folder = e.target.closest("[data-drill-group]");
    if (folder) {
      state.groupId = Number(folder.dataset.drillGroup);
      render();
      window.scrollTo({ top: 0 });
      return;
    }
    const crumb = e.target.closest("[data-crumb-id]");
    if (crumb) {
      state.groupId = crumb.dataset.crumbId ? Number(crumb.dataset.crumbId) : null;
      render();
      return;
    }
    const row = e.target.closest("[data-good-id]");
    if (row) window.location.href = `good-form.html?id=${encodeURIComponent(row.dataset.goodId)}`;
  });

  els.chips.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-chip]");
    if (!chip) return;
    if (chip.dataset.chip === "zero") state.showZero = !state.showZero;
    else if (chip.dataset.chip === "inactive") state.showInactive = !state.showInactive;
    else if (chip.dataset.chip === "copy") return copyNames();
    render();
  });

  els.search.addEventListener("input", App.debounce(render, 120));
  els.openGroupsBtn.addEventListener("click", () => {
    showGroupList();
    App.openModal(els.groupsModal);
  });
  els.newGroupBtn.addEventListener("click", () => openGroupForm(null, state.groupId));
  els.groupFormBack.addEventListener("click", showGroupList);
  els.groupsAdminList.addEventListener("click", (e) => {
    const row = e.target.closest("[data-edit-group]");
    if (row) openGroupForm(row.dataset.editGroup);
  });
  els.groupForm.addEventListener("submit", saveGroup);
  els.groupDeleteBtn.addEventListener("click", deleteGroup);

  // A new product starts in the group being viewed.
  const fab = App.qs(".fab");
  fab?.addEventListener("click", (e) => {
    if (!state.groupId) return;
    e.preventDefault();
    window.location.href = `good-form.html?group=${encodeURIComponent(state.groupId)}`;
  });

  loadAll().catch((err) => App.toast(err.message || "Failed to load products"));
});
