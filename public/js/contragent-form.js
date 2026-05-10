document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const params = App.queryParams();
  const id = Number(params.get("id") || 0) || null;

  const titleEl = App.qs("#contragentFormTitle");
  const form = App.qs("#contragentForm");
  const deleteBtn = App.qs("#contragentDeleteBtn");
  const contactPickBtn = App.qs("#contactPickBtn");
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

  async function importContacts(contacts) {
    if (!contacts.length) {
      App.toast("No contacts found");
      return;
    }
    const result = await App.localData("contragents/import", {
      method: "POST",
      body: { contacts, requireTag: false }
    });
    const imported = result.contacts?.[0];
    const importedCount = result.contacts?.length || 0;
    if (importedCount === 1 && imported?.id) {
      App.toast(imported.action === "created" ? "Customer imported" : "Customer already exists");
      window.location.replace(`contragent-form.html?id=${encodeURIComponent(imported.id)}`);
      return;
    }
    if (importedCount > 1) {
      App.toast(`Contacts imported: ${Number(result.created || 0)} new, ${Number(result.updated || 0)} updated, ${Number(result.skipped || 0)} unchanged`);
      window.location.href = "contragents.html";
      return;
    }
    App.toast("No contacts were imported");
  }

  contactPickBtn?.addEventListener("click", async () => {
    if (!window.InventoryContacts?.isPickerSupported()) {
      App.toast("Contact picker is not available in this iPhone browser");
      return;
    }
    App.setLoading(contactPickBtn, true);
    try {
      const contacts = await window.InventoryContacts.selectContacts({ multiple: true });
      await importContacts(contacts);
    } catch (err) {
      App.toast(err.message || "Could not open contacts");
    } finally {
      App.setLoading(contactPickBtn, false);
    }
  });

  async function loadContragent() {
    if (!id) {
      titleEl.textContent = "New Contragent";
      setValues(null);
      historyList.innerHTML = App.emptyState("Save the contragent to see transaction history.");
      return;
    }
    const data = await App.localData(`contragents?id=${encodeURIComponent(id)}`);
    setValues(data.contragent);
    titleEl.textContent = `Edit Contragent #${id}`;
    deleteBtn.classList.remove("hidden");
  }

  async function loadHistory() {
    if (!id) return;
    const data = await App.localData(`documents?contragent_id=${encodeURIComponent(id)}&limit=200`);
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
        ? await App.localData("contragents", { method: "PUT", body: { id, ...body } })
        : await App.localData("contragents", { method: "POST", body });
      App.toast("Contragent saved");
      const newId = result.contragent?.id || id;
      if (!id && newId) {
        window.location.replace(`contragent-form.html?id=${encodeURIComponent(newId)}`);
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
      await App.localData(`contragents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      App.toast("Contragent deleted");
      window.location.href = "contragents.html";
    } catch (err) {
      App.toast(err.message || "Failed to delete contragent");
    }
  });

  historyList?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-doc-id]");
    if (!row) return;
    window.location.href = `document-form.html?id=${encodeURIComponent(row.dataset.docId)}`;
  });

  loadContragent()
    .then(loadHistory)
    .catch((err) => {
      App.toast(err.message || "Failed to load contragent");
    });
});
