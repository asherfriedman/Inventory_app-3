document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const list = App.qs("#contragentsList");
  const countLabel = App.qs("#contragentCountLabel");
  const searchInput = App.qs("#contragentSearch");
  const typeFilter = App.qs("#contragentTypeFilter");
  const refreshBtn = App.qs("#contragentRefreshBtn");
  const importBtn = App.qs("#contactImportBtn");
  const importFile = App.qs("#contactImportFile");

  function render(items) {
    countLabel.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
    if (!items.length) {
      list.innerHTML = App.emptyState("No contragents found.");
      return;
    }
    list.innerHTML = items
      .map((c) => {
        const typeLabel = Number(c.type) === 0 ? "Supplier" : "Customer";
        return `
          <div class="list-item clickable" data-id="${Number(c.id)}">
            <div class="row between">
              <div class="list-item-title">${App.escapeHtml(c.name || "")}</div>
              <span class="chip">${typeLabel}</span>
            </div>
            <div class="list-item-sub">${App.escapeHtml(c.phone || "No phone")}</div>
          </div>
        `;
      })
      .join("");
  }

  async function load() {
    App.setLoading(refreshBtn, true);
    try {
      const params = new URLSearchParams();
      if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
      if (typeFilter.value !== "") params.set("type", typeFilter.value);
      const data = await App.localData(`contragents?${params.toString()}`);
      render(data.contragents || []);
    } catch (err) {
      list.innerHTML = App.emptyState(err.message || "Failed to load contragents");
    } finally {
      App.setLoading(refreshBtn, false);
    }
  }

  list?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    window.location.href = `contragent-form.html?id=${encodeURIComponent(row.dataset.id)}`;
  });

  searchInput?.addEventListener("input", App.debounce(load, 220));
  typeFilter?.addEventListener("change", load);
  refreshBtn?.addEventListener("click", load);

  importBtn?.addEventListener("click", () => {
    importFile?.click();
  });

  importFile?.addEventListener("change", async () => {
    const files = Array.from(importFile.files || []);
    importFile.value = "";
    if (!files.length) return;

    App.setLoading(importBtn, true);
    try {
      const text = (await Promise.all(files.map((file) => file.text()))).join("\n");
      const parsed = window.InventoryContacts.parseVcards(text);
      if (!parsed.contacts.length) {
        App.toast("No # contacts found in that file");
        return;
      }
      const result = await App.localData("contragents/import", {
        method: "POST",
        body: { contacts: parsed.contacts }
      });
      const created = Number(result.created || 0);
      const updated = Number(result.updated || 0);
      const skipped = Number(result.skipped || 0);
      App.toast(`Contacts: ${created} new, ${updated} updated, ${skipped} unchanged`);
      await load();
    } catch (err) {
      App.toast(err.message || "Failed to import contacts");
    } finally {
      App.setLoading(importBtn, false);
    }
  });

  const kbdToggle = App.qs("#kbdToggle");
  kbdToggle?.addEventListener("click", () => {
    const isNumeric = searchInput.inputMode === "numeric";
    searchInput.inputMode = isNumeric ? "text" : "numeric";
    kbdToggle.textContent = isNumeric ? "ABC" : "123";
    kbdToggle.classList.toggle("active", !isNumeric);
    searchInput.placeholder = isNumeric ? "Search by name..." : "Search by #...";
    searchInput.focus();
  });
  load();
});
