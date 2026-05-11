document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const list = App.qs("#contragentsList");
  const countLabel = App.qs("#contragentCountLabel");
  const searchInput = App.qs("#contragentSearch");
  const typeFilter = App.qs("#contragentTypeFilter");
  const GoogleContacts = window.InventoryGoogleContacts;
  const googleSyncBtn = App.qs("#googleSyncBtn");
  const googlePanelBtn = App.qs("#googlePanelBtn");
  const googlePanel = App.qs("#googleContactPanel");
  const googlePanelCloseBtn = App.qs("#googlePanelCloseBtn");
  const googleContactSearch = App.qs("#googleContactSearch");
  const googleSearchBtn = App.qs("#googleSearchBtn");
  const googleContactResults = App.qs("#googleContactResults");
  let googleResults = [];

  function render(items) {
    countLabel.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
    if (!items.length) {
      list.innerHTML = App.emptyState("No customers found.");
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
    try {
      const params = new URLSearchParams();
      if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
      if (typeFilter.value !== "") params.set("type", typeFilter.value);
      const data = await App.localData(`contragents?${params.toString()}`);
      render(data.contragents || []);
    } catch (err) {
      list.innerHTML = App.emptyState(err.message || "Failed to load customers");
    }
  }

  list?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    window.location.href = `contragent-form.html?id=${encodeURIComponent(row.dataset.id)}`;
  });

  searchInput?.addEventListener("input", App.debounce(load, 220));
  typeFilter?.addEventListener("change", load);

  googlePanelBtn?.addEventListener("click", () => {
    googlePanel?.classList.toggle("hidden");
    if (!googlePanel?.classList.contains("hidden")) {
      requestAnimationFrame(() => googleContactSearch?.focus());
    }
  });

  googlePanelCloseBtn?.addEventListener("click", () => {
    googlePanel?.classList.add("hidden");
  });

  function renderGoogleResults(items) {
    googleResults = items || [];
    if (!googleResults.length) {
      googleContactResults.innerHTML = googleContactSearch.value.trim()
        ? App.emptyState("No Google contacts found.")
        : "";
      return;
    }
    googleContactResults.innerHTML = googleResults.map((contact, index) => `
      <div class="list-item">
        <div class="row between">
          <div>
            <div class="list-item-title">${App.escapeHtml(contact.name || "")}</div>
            <div class="list-item-sub">${App.escapeHtml(contact.phone || "No phone")}</div>
          </div>
          <button class="btn btn-soft" type="button" data-google-import="${index}">Import</button>
        </div>
      </div>
    `).join("");
  }

  googleSyncBtn?.addEventListener("click", async () => {
    App.setLoading(googleSyncBtn, true);
    try {
      const result = await GoogleContacts.syncTaggedContacts({ interactive: true });
      App.toast(GoogleContacts.formatImportSummary(result), 3200);
      await load();
    } catch (err) {
      App.toast(err.message || "Google sync failed");
    } finally {
      App.setLoading(googleSyncBtn, false);
    }
  });

  async function searchGoogleContacts() {
    const query = googleContactSearch.value.trim();
    if (!query) {
      renderGoogleResults([]);
      return;
    }
    App.setLoading(googleSearchBtn, true);
    try {
      const results = await GoogleContacts.searchContacts(query, { interactive: true });
      renderGoogleResults(results);
    } catch (err) {
      googleContactResults.innerHTML = App.emptyState(err.message || "Google search failed");
    } finally {
      App.setLoading(googleSearchBtn, false);
    }
  }

  googleSearchBtn?.addEventListener("click", searchGoogleContacts);
  googleContactSearch?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchGoogleContacts();
  });
  googleContactResults?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-google-import]");
    if (!button) return;
    const contact = googleResults[Number(button.dataset.googleImport)];
    if (!contact) return;
    App.setLoading(button, true);
    try {
      const result = await GoogleContacts.importContacts([contact], { requireTag: false });
      App.toast(GoogleContacts.formatImportSummary(result, 1), 3200);
      await load();
    } catch (err) {
      App.toast(err.message || "Import failed");
    } finally {
      App.setLoading(button, false);
    }
  });

  const kbdToggle = App.qs("#kbdToggle");
  kbdToggle?.addEventListener("click", () => {
    const isNumeric = searchInput.inputMode === "numeric";
    searchInput.inputMode = isNumeric ? "text" : "numeric";
    kbdToggle.textContent = isNumeric ? "ABC" : "123";
    kbdToggle.classList.toggle("active", !isNumeric);
    searchInput.placeholder = isNumeric ? "Search by name..." : "Search by #...";
    searchInput.blur();
    requestAnimationFrame(() => searchInput.focus());
  });

  load();
});
