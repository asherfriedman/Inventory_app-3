document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const params = App.queryParams();
  const id = Number(params.get("id") || 0) || null;

  const titleEl = App.qs("#goodFormTitle");
  const form = App.qs("#goodForm");
  const deleteBtn = App.qs("#goodDeleteBtn");
  const historyList = App.qs("#goodHistoryList");
  const historyCount = App.qs("#goodHistoryCount");

  const fields = {
    id: App.qs("#goodId"),
    name: App.qs("#goodName"),
    barcode: App.qs("#goodBarcode"),
    group_id: App.qs("#goodGroup"),
    measure: App.qs("#goodMeasure"),
    quantity: App.qs("#goodQty"),
    avg_cost: App.qs("#goodAvgCost")
  };

  let groupsTree = [];

  function setValues(good) {
    fields.id.value = good?.id || "";
    fields.name.value = good?.name || "";
    fields.barcode.value = good?.barcode || "";
    fields.group_id.value = good?.group_id ? String(good.group_id) : "";
    fields.measure.value = good?.measure || "";
    fields.quantity.value = Number(good?.quantity || 0);
    fields.avg_cost.value = Number(good?.avg_cost || 0);
  }

  function collectPayload() {
    return {
      name: fields.name.value.trim(),
      barcode: fields.barcode.value.trim() || null,
      group_id: fields.group_id.value ? Number(fields.group_id.value) : null,
      measure: fields.measure.value.trim() || null,
      quantity: Number(fields.quantity.value || 0),
      avg_cost: Number(fields.avg_cost.value || 0)
    };
  }

  async function loadGroups() {
    const data = await App.api("/api/goods-groups");
    groupsTree = data.tree || [];
    App.fillGroupSelect(fields.group_id, groupsTree, { includeBlank: true, blankLabel: "Select group" });
  }

  async function loadGood() {
    if (!id) {
      setValues(null);
      titleEl.textContent = "New Product";
      historyList.innerHTML = App.emptyState("Save the product to see transaction history.");
      return;
    }
    const data = await App.api(`/api/goods?id=${encodeURIComponent(id)}`);
    setValues(data.good);
    titleEl.textContent = `Edit Product #${id}`;
    deleteBtn.classList.remove("hidden");
  }

  async function loadHistory() {
    if (!id) return;
    try {
      const data = await App.api(`/api/documents?good_id=${encodeURIComponent(id)}&limit=100`);
      const docs = data.documents || [];
      historyCount.textContent = `${docs.length} doc${docs.length === 1 ? "" : "s"}`;
      historyList.innerHTML = docs.length ? docs.map(App.docCardHtml).join("") : App.emptyState("No transactions yet.");
    } catch (err) {
      historyList.innerHTML = App.emptyState(err.message || "Failed to load history");
    }
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = collectPayload();
    if (!payload.name) return App.toast("Name is required");
    try {
      const result = id
        ? await App.api("/api/goods", { method: "PUT", body: { id, ...payload } })
        : await App.api("/api/goods", { method: "POST", body: payload });
      App.toast("Product saved");
      const newId = result.good?.id || id;
      if (!id && newId) {
        window.location.replace(`/good-form.html?id=${encodeURIComponent(newId)}`);
        return;
      }
      await loadHistory();
    } catch (err) {
      App.toast(err.message || "Failed to save product");
    }
  });

  deleteBtn?.addEventListener("click", async () => {
    if (!id) return;
    if (!window.confirm("Delete this product?")) return;
    try {
      await App.api(`/api/goods?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      App.toast("Product deleted");
      window.location.href = "/goods.html";
    } catch (err) {
      App.toast(err.message || "Failed to delete product");
    }
  });

  historyList?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-doc-id]");
    if (!row) return;
    window.location.href = `/document-form.html?id=${encodeURIComponent(row.dataset.docId)}`;
  });

  Promise.all([loadGroups(), loadGood()])
    .then(loadHistory)
    .catch((err) => {
      App.toast(err.message || "Failed to load product");
    });
});
