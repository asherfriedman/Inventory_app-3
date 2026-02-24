document.addEventListener("DOMContentLoaded", () => {
  const App = window.InventoryApp;
  const searchInput = App.qs("#goodsSearch");
  const refreshBtn = App.qs("#refreshGoodsBtn");
  const explorerContainer = App.qs("#goodsExplorer");
  const countLabel = App.qs("#goodsCountLabel");

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
    currentGroupId: null
  };

  function goodRowHtml(g) {
    return `
      <div class="list-item clickable" data-id="${Number(g.id)}">
        <div class="row between">
          <div class="list-item-title">${App.escapeHtml(g.name || "")}</div>
          <span class="money">${App.escapeHtml(App.fmtNum(g.quantity || 0))}</span>
        </div>
        <div class="list-item-sub">${App.escapeHtml(g.group_path || "No group")} · q: ${App.escapeHtml(App.fmtNum(g.quantity || 0))}</div>
        <div class="list-item-sub">avg cost: ${App.escapeHtml(App.fmtMoney(g.avg_cost || 0))}</div>
      </div>
    `;
  }

  function render() {
    const query = searchInput.value.trim().toLowerCase();

    if (query) {
      const rows = state.goods.filter((g) => String(g.name || "").toLowerCase().includes(query));
      countLabel.textContent = `${rows.length} item${rows.length === 1 ? "" : "s"}`;
      if (!rows.length) {
        explorerContainer.innerHTML = App.emptyState("No products found.");
        return;
      }
      explorerContainer.innerHTML = '<div class="list">' + rows.map(goodRowHtml).join("") + "</div>";
      return;
    }

    App.renderGroupExplorer(explorerContainer, state.tree, state.goods, state.currentGroupId, state.groupById, goodRowHtml);
    const directGoods = state.goods.filter((g) => {
      const gid = g.group_id ? Number(g.group_id) : null;
      return state.currentGroupId ? gid === state.currentGroupId : !gid;
    });
    countLabel.textContent = `${directGoods.length} item${directGoods.length === 1 ? "" : "s"}`;
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
        return `
          <div class="list-item">
            <div class="row between">
              <div class="list-item-title">${App.escapeHtml(path || g.name)}</div>
              <div class="chip-row">
                <button class="btn tiny" type="button" data-edit-group="${Number(g.id)}">Edit</button>
                <button class="btn btn-danger tiny" type="button" data-delete-group="${Number(g.id)}">Delete</button>
              </div>
            </div>
            <div class="list-item-sub">Buy ${App.escapeHtml(App.fmtMoney(g.price_in || 0))} · Sell ${App.escapeHtml(App.fmtMoney(g.price_out || 0))}</div>
          </div>
        `;
      })
      .join("");
  }

  async function loadGroups() {
    const data = await App.api("/api/goods-groups");
    state.groups = data.groups || [];
    state.tree = data.tree || [];
    state.groupById = App.groupMap(state.groups);
    App.fillGroupSelect(groupFormParent, state.tree, { includeBlank: true, blankLabel: "None (parent)" });
    renderGroupAdmin();
  }

  async function loadGoods() {
    App.setLoading(refreshBtn, true);
    try {
      const data = await App.api("/api/goods?limit=1000");
      state.goods = data.goods || [];
      render();
    } catch (err) {
      explorerContainer.innerHTML = App.emptyState(err.message || "Failed to load goods");
    } finally {
      App.setLoading(refreshBtn, false);
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
      await loadGroups();
      await loadGoods();
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
      await loadGroups();
      await loadGoods();
    } catch (err) {
      App.toast(err.message || "Failed to delete group");
    }
  }

  groupsAdminList?.addEventListener("click", (e) => {
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
      window.location.href = `/good-form.html?id=${encodeURIComponent(row.dataset.id)}`;
    }
  });

  searchInput?.addEventListener("input", App.debounce(render, 220));
  refreshBtn?.addEventListener("click", () => Promise.all([loadGroups(), loadGoods()]));
  groupForm?.addEventListener("submit", saveGroup);
  groupFormResetBtn?.addEventListener("click", resetGroupForm);

  openGroupsBtn?.addEventListener("click", () => groupsModal.classList.add("open"));
  closeGroupsBtn?.addEventListener("click", () => groupsModal.classList.remove("open"));
  groupsModal?.addEventListener("click", (e) => {
    if (e.target === groupsModal) groupsModal.classList.remove("open");
  });

  resetGroupForm();
  Promise.all([loadGroups(), loadGoods()]).catch((err) => App.toast(err.message || "Failed to load page"));
});
