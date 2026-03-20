document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const explorerContainer = App.qs("#goodsExplorer");

  const groupsModal = App.qs("#groupsModal");
  const openGroupsBtn = App.qs("#openGroupsBtn");
  const closeGroupsBtn = App.qs("#closeGroupsBtn");
  const groupForm = App.qs("#groupForm");
  const groupFormId = App.qs("#groupFormId");
  const groupFormName = App.qs("#groupFormName");
  const groupFormParent = App.qs("#groupFormParent");
  const groupFormPriceIn = App.qs("#groupFormPriceIn");
  const groupFormPriceOut = App.qs("#groupFormPriceOut");
  const groupFormResetBtn = App.qs("#groupFormResetBtn");
  const groupsAdminList = App.qs("#groupsAdminList");

  const state = {
    groups: [],
    tree: [],
    goods: [],
    groupById: new Map(),
    currentGroupId: null,
    showInactiveGroups: false,
    showZeroQty: false
  };

  function isGroupActive(group) {
    return group?.is_active !== false;
  }

  function normalizeGroupTree(nodes) {
    return (nodes || []).map((node) => ({
      ...node,
      is_active: node.is_active !== false,
      children: normalizeGroupTree(node.children || [])
    }));
  }

  function findNodeInTree(nodes, id) {
    for (const node of nodes || []) {
      if (Number(node.id) === Number(id)) return node;
      const found = findNodeInTree(node.children || [], id);
      if (found) return found;
    }
    return null;
  }

  function collectTreeIds(nodes, out = new Set()) {
    for (const node of nodes || []) {
      out.add(Number(node.id));
      collectTreeIds(node.children || [], out);
    }
    return out;
  }

  function buildVisibleTree(nodes) {
    const out = [];
    for (const node of nodes || []) {
      if (!state.showInactiveGroups && !isGroupActive(node)) continue;
      out.push({
        ...node,
        children: buildVisibleTree(node.children || [])
      });
    }
    return out;
  }

  function buildVisibleExplorerState() {
    const visibleTree = buildVisibleTree(state.tree);
    const visibleGroupIds = collectTreeIds(visibleTree);
    const visibleGroups = state.groups.filter((group) => visibleGroupIds.has(Number(group.id)));
    const visibleGroupById = App.groupMap(visibleGroups);
    const visibleGoods = state.goods.filter((good) => {
      const gid = good.group_id ? Number(good.group_id) : null;
      if (gid && !visibleGroupIds.has(gid)) return false;
      if (state.showZeroQty) return true;
      return Number(good.quantity || 0) > 0;
    });
    return {
      tree: visibleTree,
      goods: visibleGoods,
      groupById: visibleGroupById
    };
  }

  function explorerControlsHtml() {
    return [
      `<button class="explorer-filter-btn${state.showInactiveGroups ? " active" : ""}" type="button" data-goods-filter="inactive">Inactive</button>`,
      `<button class="explorer-filter-btn${state.showZeroQty ? " active" : ""}" type="button" data-goods-filter="zero">Zero</button>`
    ].join("");
  }

  function goodRowHtml(g, metrics) {
    const qty = Number(metrics?.qty ?? g.quantity ?? 0);
    const cost = Number(metrics?.cost ?? qty * Number(g.avg_cost || 0));
    const value = Number(metrics?.value ?? 0);
    return `
      <div class="list-item clickable compact-good" data-id="${Number(g.id)}">
        <div class="compact-good-row">
          <div class="compact-good-main">
            <span class="compact-good-name">${App.escapeHtml(g.name || "")}</span>
            <span class="compact-good-pair">${App.escapeHtml(App.fmtMoney0(cost))}/${App.escapeHtml(App.fmtMoney0(value))}</span>
          </div>
          <div class="compact-good-right">
            <span class="compact-good-qty">${App.escapeHtml(App.fmtNum(qty))}</span>
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    const visible = buildVisibleExplorerState();
    if (state.currentGroupId && !findNodeInTree(visible.tree, state.currentGroupId)) {
      state.currentGroupId = null;
    }
    App.renderGroupExplorer(
      explorerContainer,
      visible.tree,
      visible.goods,
      state.currentGroupId,
      visible.groupById,
      goodRowHtml,
      {
        controlsHtml: explorerControlsHtml(),
        metricsGoods: state.goods,
        metricsGroupsById: state.groupById
      }
    );
  }

  function renderGroupAdmin() {
    if (!state.groups.length) {
      groupsAdminList.innerHTML = App.emptyState("No groups yet.");
      return;
    }
    groupsAdminList.innerHTML = state.groups
      .slice()
      .sort((a, b) => (App.groupPath(a.id, state.groupById)).localeCompare(App.groupPath(b.id, state.groupById)))
      .map((g) => {
        const path = App.groupPath(g.id, state.groupById);
        const active = isGroupActive(g);
        return `
          <div class="list-item">
            <div class="row between">
              <div class="list-item-title">${App.escapeHtml(path || g.name)}</div>
              <div class="chip-row">
                <button class="btn tiny ${active ? "btn-soft" : ""}" type="button" data-toggle-group-active="${Number(g.id)}" data-next-active="${active ? "0" : "1"}">${active ? "Active" : "Inactive"}</button>
                <button class="btn tiny" type="button" data-edit-group="${Number(g.id)}">Edit</button>
                <button class="btn btn-danger tiny" type="button" data-delete-group="${Number(g.id)}">Delete</button>
              </div>
            </div>
            <div class="list-item-sub">Buy ${App.escapeHtml(App.fmtMoney(g.price_in || 0))} - Sell ${App.escapeHtml(App.fmtMoney(g.price_out || 0))}</div>
          </div>
        `;
      })
      .join("");
  }

  async function loadGroups() {
    const data = await App.api("/api/goods-groups");
    state.groups = (data.groups || []).map((group) => ({ ...group, is_active: group.is_active !== false }));
    state.tree = normalizeGroupTree(data.tree || []);
    state.groupById = App.groupMap(state.groups);
    App.fillGroupSelect(groupFormParent, state.tree, { includeBlank: true, blankLabel: "None (parent)" });
    renderGroupAdmin();
    render();
  }

  async function loadGoods() {
    try {
      const data = await App.api("/api/goods?limit=1000");
      state.goods = data.goods || [];
      render();
    } catch (err) {
      explorerContainer.innerHTML = App.emptyState(err.message || "Failed to load goods");
    }
  }

  function resetGroupForm() {
    groupForm.reset();
    groupFormId.value = "";
    groupFormParent.value = "";
    groupFormPriceIn.value = "0";
    groupFormPriceOut.value = "0";
  }

  function openGroupEditor(groupId) {
    const group = state.groups.find((g) => Number(g.id) === Number(groupId));
    if (!group) return;
    groupFormId.value = String(group.id);
    groupFormName.value = group.name || "";
    groupFormParent.value = group.parent_id ? String(group.parent_id) : "";
    groupFormPriceIn.value = Number(group.price_in || 0);
    groupFormPriceOut.value = Number(group.price_out || 0);
  }

  async function saveGroup(e) {
    e.preventDefault();
    const payload = {
      name: groupFormName.value.trim(),
      parent_id: groupFormParent.value || null,
      price_in: Number(groupFormPriceIn.value || 0),
      price_out: Number(groupFormPriceOut.value || 0)
    };
    if (!payload.name) return App.toast("Group name is required");
    try {
      if (groupFormId.value) {
        await App.api("/api/goods-groups", { method: "PUT", body: { id: Number(groupFormId.value), ...payload } });
        App.toast("Group updated");
      } else {
        await App.api("/api/goods-groups", { method: "POST", body: payload });
        App.toast("Group created");
      }
      resetGroupForm();
      await Promise.all([loadGroups(), loadGoods()]);
    } catch (err) {
      App.toast(err.message || "Failed to save group");
    }
  }

  async function deleteGroup(id) {
    if (!window.confirm("Delete this group?")) return;
    try {
      await App.api(`/api/goods-groups?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      App.toast("Group deleted");
      state.currentGroupId = null;
      await Promise.all([loadGroups(), loadGoods()]);
    } catch (err) {
      App.toast(err.message || "Failed to delete group");
    }
  }

  async function setGroupActive(id, isActive) {
    try {
      await App.api("/api/goods-groups", {
        method: "PUT",
        body: { id: Number(id), is_active: Boolean(isActive) }
      });
      App.toast(isActive ? "Group activated" : "Group set inactive");
      if (state.currentGroupId && Number(state.currentGroupId) === Number(id) && !isActive) {
        state.currentGroupId = null;
      }
      await loadGroups();
    } catch (err) {
      App.toast(err.message || "Failed to update group status");
    }
  }

  groupsAdminList?.addEventListener("click", (e) => {
    const toggleBtn = e.target.closest("[data-toggle-group-active]");
    if (toggleBtn) {
      setGroupActive(toggleBtn.dataset.toggleGroupActive, toggleBtn.dataset.nextActive === "1");
      return;
    }

    const editBtn = e.target.closest("[data-edit-group]");
    if (editBtn) {
      openGroupEditor(editBtn.dataset.editGroup);
      return;
    }

    const delBtn = e.target.closest("[data-delete-group]");
    if (delBtn) {
      deleteGroup(delBtn.dataset.deleteGroup);
    }
  });

  explorerContainer?.addEventListener("click", (e) => {
    const filterBtn = e.target.closest("[data-goods-filter]");
    if (filterBtn) {
      const key = filterBtn.dataset.goodsFilter;
      if (key === "inactive") {
        state.showInactiveGroups = !state.showInactiveGroups;
      } else if (key === "zero") {
        state.showZeroQty = !state.showZeroQty;
      }
      render();
      return;
    }

    const folder = e.target.closest("[data-drill-group]");
    if (folder) {
      state.currentGroupId = Number(folder.dataset.drillGroup);
      render();
      return;
    }

    const crumb = e.target.closest("[data-crumb-id]");
    if (crumb) {
      const val = crumb.dataset.crumbId;
      state.currentGroupId = val ? Number(val) : null;
      render();
      return;
    }

    const row = e.target.closest("[data-id]");
    if (row) {
      window.location.href = `good-form.html?id=${encodeURIComponent(row.dataset.id)}`;
    }
  });

  groupForm?.addEventListener("submit", saveGroup);
  groupFormResetBtn?.addEventListener("click", resetGroupForm);

  openGroupsBtn?.addEventListener("click", () => groupsModal.classList.add("open"));
  closeGroupsBtn?.addEventListener("click", () => groupsModal.classList.remove("open"));
  groupsModal?.addEventListener("click", (e) => {
    if (e.target === groupsModal) groupsModal.classList.remove("open");
  });

  resetGroupForm();
  render();
  Promise.all([loadGroups(), loadGoods()]).catch((err) => App.toast(err.message || "Failed to load page"));
});
