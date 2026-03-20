document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const params = App.queryParams();
  const id = Number(params.get("id") || 0) || null;

  const titleEl = App.qs("#contragentFormTitle");
  const form = App.qs("#contragentForm");
  const deleteBtn = App.qs("#contragentDeleteBtn");
  const historyList = App.qs("#contragentHistoryList");
  const historyCount = App.qs("#contragentHistoryCount");

  const fields = {
    id: App.qs("#contragentId"),
    name: App.qs("#contragentName"),
    type: App.qs("#contragentType"),
    phone: App.qs("#contragentPhone"),
    address: App.qs("#contragentAddress")
  };

  function setValues(c) {
    fields.id.value = c?.id || "";
    fields.name.value = c?.name || "";
    fields.type.value = String(c?.type ?? 1);
    fields.phone.value = c?.phone || "";
    fields.address.value = c?.address || "";
  }

  function payload() {
    return {
      name: fields.name.value.trim(),
      type: Number(fields.type.value || 1),
      phone: fields.phone.value.trim() || null,
      address: fields.address.value.trim() || null
    };
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
      await loadHistory();
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

  historyList?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-doc-id]");
    if (!row) return;
    window.location.href = `/document-form.html?id=${encodeURIComponent(row.dataset.docId)}`;
  });

  loadContragent()
    .then(loadHistory)
    .catch((err) => {
      App.toast(err.message || "Failed to load contragent");
    });
});
