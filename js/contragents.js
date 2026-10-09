window.InventoryApp.defineView("contragents", (ctx) => {
  const App = window.InventoryApp;
  const GoogleContacts = window.InventoryGoogleContacts;
  const VIEW_KEY = "inventory_contragents_view_v1";
  const PAGE = 300;

  const els = {
    title: App.qs("#contragentsTitle"),
    count: App.qs("#contragentCountLabel"),
    list: App.qs("#contragentsList"),
    search: App.qs("#contragentSearch"),
    kbdToggle: App.qs("#kbdToggle"),
    typeFilter: App.qs("#contragentTypeFilter"),
    showAllBtn: App.qs("#showAllBtn"),
    fab: App.qs("#addContragentFab"),
    importBtn: App.qs("#importBtn"),
    importModal: App.qs("#importModal"),
    googleSyncBtn: App.qs("#googleSyncBtn"),
    googleSearch: App.qs("#googleContactSearch"),
    googleSearchBtn: App.qs("#googleSearchBtn"),
    googleResults: App.qs("#googleContactResults")
  };

  const state = { type: "1", rows: [], showAll: false, googleResults: [] };
  try {
    const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY) || "{}");
    if (saved.type === "0" || saved.type === "1") state.type = saved.type;
    els.search.value = saved.search || "";
  } catch {
    // ignore
  }

  function saveView() {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ type: state.type, search: els.search.value }));
  }

  // Customers open with the number pad, suppliers with letters.
  function setKeyboard(mode) {
    const numeric = mode !== "text";
    els.search.inputMode = numeric ? "numeric" : "text";
    els.search.placeholder = numeric ? "Search by #" : "Search by name";
    els.kbdToggle.textContent = numeric ? "123" : "ABC";
    els.kbdToggle.classList.toggle("active", numeric);
  }

  function defaultKeyboard() {
    setKeyboard(state.type === "0" ? "text" : "numeric");
  }

  function render() {
    const isCustomers = state.type === "1";
    els.title.firstChild.textContent = isCustomers ? "Customers" : "Suppliers";
    els.fab.lastChild.textContent = isCustomers ? "Customer" : "Supplier";
    els.fab.href = `contragent-form.html?type=${state.type}`;
    App.qsa("button", els.typeFilter).forEach((b) => b.classList.toggle("active", b.dataset.type === state.type));
    const rows = state.showAll ? state.rows : state.rows.slice(0, PAGE);
    els.count.textContent = `${App.fmtNum(state.rows.length)} ${els.search.value.trim() ? "found" : "total"}`;
    els.list.innerHTML = rows.length ? rows.map((c) => `
      <div class="row-item tappable" data-id="${Number(c.id)}">
        <div class="row-main">
          <div class="row-title">${App.escapeHtml(c.name || "")}</div>
          <div class="row-sub">${App.escapeHtml(c.phone || "No phone")}</div>
        </div>
        <span class="chevron">${App.icon("chevron")}</span>
      </div>`).join("") : App.emptyState(els.search.value.trim() ? "No matches." : `No ${isCustomers ? "customers" : "suppliers"} yet.`);
    els.showAllBtn.classList.toggle("hidden", state.showAll || state.rows.length <= PAGE);
    els.showAllBtn.textContent = `Show all ${App.fmtNum(state.rows.length)}`;
  }

  async function load() {
    try {
      const params = new URLSearchParams({ type: state.type });
      const q = els.search.value.trim();
      if (q) params.set("search", q);
      const data = await App.localData(`contragents?${params.toString()}`);
      state.rows = data.contragents || [];
      state.showAll = false;
      render();
      saveView();
    } catch (err) {
      els.list.innerHTML = App.emptyState(err.message || "Failed to load");
    }
  }

  function renderGoogleResults() {
    const items = state.googleResults;
    els.googleResults.innerHTML = items.length ? items.map((contact, index) => `
      <div class="row-item">
        <div class="row-main">
          <div class="row-title">${App.escapeHtml(contact.name || "")}</div>
          <div class="row-sub">${App.escapeHtml(contact.phone || "No phone")}</div>
        </div>
        <button class="add-btn" type="button" data-google-import="${index}">Import</button>
      </div>`).join("") : (els.googleSearch.value.trim() ? App.emptyState("No Google contacts found.") : "");
  }

  async function searchGoogle() {
    const q = els.googleSearch.value.trim();
    if (!q) return;
    App.setLoading(els.googleSearchBtn, true);
    try {
      state.googleResults = await GoogleContacts.searchContacts(q, { interactive: true });
      renderGoogleResults();
    } catch (err) {
      els.googleResults.innerHTML = App.emptyState(err.message || "Google search failed");
    } finally {
      App.setLoading(els.googleSearchBtn, false);
    }
  }

  els.list.addEventListener("click", (e) => {
    const row = e.target.closest("[data-id]");
    if (row) App.go(`contragent-form.html?id=${encodeURIComponent(row.dataset.id)}`);
  });
  els.search.addEventListener("input", App.debounce(load, 180));
  els.kbdToggle.addEventListener("click", () => {
    setKeyboard(els.search.inputMode === "numeric" ? "text" : "numeric");
    els.search.blur();
    els.search.focus();
  });
  els.typeFilter.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn || btn.dataset.type === state.type) return;
    state.type = btn.dataset.type;
    defaultKeyboard();
    load();
  });
  els.showAllBtn.addEventListener("click", () => {
    state.showAll = true;
    render();
  });

  els.importBtn.addEventListener("click", () => App.openModal(els.importModal));
  els.googleSyncBtn.addEventListener("click", async () => {
    if (!GoogleContacts) return App.toast("Google Contacts is not available");
    App.setLoading(els.googleSyncBtn, true);
    try {
      const result = await GoogleContacts.syncTaggedContacts({ interactive: true });
      App.toast(GoogleContacts.formatImportSummary(result), 3200);
      await load();
    } catch (err) {
      App.toast(err.message || "Google sync failed");
    } finally {
      App.setLoading(els.googleSyncBtn, false);
    }
  });
  els.googleSearchBtn.addEventListener("click", searchGoogle);
  els.googleSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchGoogle();
    }
  });
  els.googleResults.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-google-import]");
    if (!btn) return;
    const contact = state.googleResults[Number(btn.dataset.googleImport)];
    if (!contact) return;
    App.setLoading(btn, true);
    try {
      const result = await GoogleContacts.importContacts([contact], { requireTag: false });
      App.toast(GoogleContacts.formatImportSummary(result, 1), 3200);
      btn.textContent = "Done";
      await load();
    } catch (err) {
      App.toast(err.message || "Import failed");
      App.setLoading(btn, false);
    }
  });

  defaultKeyboard();
  App.qs(`[data-clear-for="contragentSearch"]`)?.classList.toggle("hidden", !els.search.value);
  load();
  els.search.focus();
});
