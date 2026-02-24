document.addEventListener("DOMContentLoaded", () => {
  const App = window.InventoryApp;
  const params = App.queryParams();
  const id = Number(params.get("id") || 0) || null;

  const titleEl = App.qs("#contragentFormTitle");
  const form = App.qs("#contragentForm");
  const deleteBtn = App.qs("#contragentDeleteBtn");
  const typeSelect = App.qs("#contragentType");
  const priceOverridesCard = App.qs("#priceOverridesCard");
  const priceOverrideForm = App.qs("#priceOverrideForm");
  const overrideGroup = App.qs("#overrideGroup");
  const overridePrice = App.qs("#overridePrice");
  const overrideList = App.qs("#overrideList");
  const historyList = App.qs("#contragentHistoryList");
  const historyCount = App.qs("#contragentHistoryCount");

  const fields = {
    id: App.qs("#contragentId"),
    name: App.qs("#contragentName"),
    type: App.qs("#contragentType"),
    phone: App.qs("#contragentPhone"),
    address: App.qs("#contragentAddress")
  };

  const state = {
    groups: [],
    tree: [],
    groupById: new Map(),
    overrides: []
  };

  function toggleOverrideCard() {
    const isCustomer = Number(typeSelect.value) === 1;
    priceOverridesCard.classList.toggle("hidden", !isCustomer);
    if (!id && isCustomer) {
      overrideList.innerHTML = App.emptyState("Save the customer first to manage overrides.");
    }
  }

  function setValues(c) {
    fields.id.value = c?.id || "";
    fields.name.value = c?.name || "";
    fields.type.value = String(c?.type ?? 1);
    fields.phone.value = c?.phone || "";
    fields.address.value = c?.address || "";
    toggleOverrideCard();
  }

  function payload() {
    return {
      name: fields.name.value.trim(),
      type: Number(fields.type.value || 1),
      phone: fields.phone.value.trim() || null,
      address: fields.address.value.trim() || null
    };
  }

  async function loadGroups() {
    const data = await App.api("/api/goods-groups");
    state.groups = data.groups || [];
    state.tree = data.tree || [];
    state.groupById = App.groupMap(state.groups);
    App.fillGroupSelect(overrideGroup, state.tree, { includeBlank: true, blankLabel: "Select group" });
  }

  async function loadContragent() {
    if (!id) {
      titleEl.textContent = "New Contragent";
      setValues(null);
      historyList.innerHTML = App.emptyState("Save the contragent to see transaction history.");
      return;
    }
    const data = await App.api(`/api/contragents?id=${encodeURIComponent(id)}`);
    setValues(data.contragent);
    titleEl.textContent = `Edit Contragent #${id}`;
    deleteBtn.classList.remove("hidden");
  }

  async function loadOverrides() {
    if (!id || Number(typeSelect.value) !== 1) {
      state.overrides = [];
      if (Number(typeSelect.value) === 1) {
        overrideList.innerHTML = App.emptyState("Save the customer first to manage overrides.");
      }
      return;
    }
    const data = await App.api(`/api/customer-prices?contragent_id=${encodeURIComponent(id)}`);
    state.overrides = data.overrides || [];
    if (!state.overrides.length) {
      overrideList.innerHTML = App.emptyState("No custom prices yet.");
      return;
    }
    overrideList.innerHTML = state.overrides
      .map(
        (ov) => `
          <div class="list-item">
            <div class="row between">
              <div>
                <div class="list-item-title">${App.escapeHtml(App.groupPath(ov.group_id, state.groupById) || ov.group?.name || "")}</div>
                <div class="list-item-sub">Sell price override</div>
              </div>
              <div class="row">
                <div class="money">${App.escapeHtml(App.fmtMoney(ov.price_out || 0))}</div>
                <button class="btn btn-danger tiny" type="button" data-del-ov="${Number(ov.id)}">Delete</button>
              </div>
            </div>
          </div>
        `
      )
      .join("");
  }

  async function loadHistory() {
    if (!id) return;
    const data = await App.api(`/api/documents?contragent_id=${encodeURIComponent(id)}&limit=200`);
    const docs = data.documents || [];
    historyCount.textContent = `${docs.length} doc${docs.length === 1 ? "" : "s"}`;
    historyList.innerHTML = docs.length ? docs.map(App.docCardHtml).join("") : App.emptyState("No transactions yet.");
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = payload();
    if (!body.name) return App.toast("Name is required");
    try {
      const result = id
        ? await App.api("/api/contragents", { method: "PUT", body: { id, ...body } })
        : await App.api("/api/contragents", { method: "POST", body });
      App.toast("Contragent saved");
      const newId = result.contragent?.id || id;
      if (!id && newId) {
        window.location.replace(`/contragent-form.html?id=${encodeURIComponent(newId)}`);
        return;
      }
      toggleOverrideCard();
      await Promise.all([loadOverrides(), loadHistory()]);
    } catch (err) {
      App.toast(err.message || "Failed to save contragent");
    }
  });

  deleteBtn?.addEventListener("click", async () => {
    if (!id) return;
    if (!window.confirm("Delete this contragent?")) return;
    try {
      await App.api(`/api/contragents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      App.toast("Contragent deleted");
      window.location.href = "/contragents.html";
    } catch (err) {
      App.toast(err.message || "Failed to delete contragent");
    }
  });

  typeSelect?.addEventListener("change", () => {
    toggleOverrideCard();
    if (Number(typeSelect.value) !== 1) {
      overrideList.innerHTML = App.emptyState("Price overrides apply to customers only.");
    } else {
      loadOverrides().catch((err) => App.toast(err.message || "Failed to load overrides"));
    }
  });

  priceOverrideForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!id) return App.toast("Save the customer first");
    if (Number(typeSelect.value) !== 1) return App.toast("Overrides are for customers only");
    if (!overrideGroup.value) return App.toast("Select a group");
    try {
      await App.api("/api/customer-prices", {
        method: "POST",
        body: {
          contragent_id: id,
          group_id: Number(overrideGroup.value),
          price_out: Number(overridePrice.value || 0)
        }
      });
      App.toast("Override saved");
      overridePrice.value = "";
      await loadOverrides();
    } catch (err) {
      App.toast(err.message || "Failed to save override");
    }
  });

  overrideList?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del-ov]");
    if (!btn) return;
    if (!window.confirm("Delete this price override?")) return;
    try {
      await App.api(`/api/customer-prices?id=${encodeURIComponent(btn.dataset.delOv)}`, { method: "DELETE" });
      App.toast("Override deleted");
      await loadOverrides();
    } catch (err) {
      App.toast(err.message || "Failed to delete override");
    }
  });

  historyList?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-doc-id]");
    if (!row) return;
    window.location.href = `/document-form.html?id=${encodeURIComponent(row.dataset.docId)}`;
  });

  Promise.all([loadGroups(), loadContragent()])
    .then(async () => {
      await Promise.all([loadOverrides(), loadHistory()]);
    })
    .catch((err) => {
      App.toast(err.message || "Failed to load contragent");
    });
});
