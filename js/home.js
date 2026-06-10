document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const logoutBtn = App.qs("#logoutBtn");
  const statEls = App.qsa("[data-stat]").reduce((map, el) => {
    map[el.dataset.stat] = el;
    return map;
  }, {});

  logoutBtn?.addEventListener("click", () => App.logout());

  async function load() {
    try {
      const data = await App.localData("dashboard");
      const stats = data.stats || {};
      if (statEls.todays_sales) statEls.todays_sales.textContent = App.fmtMoney(stats.todays_sales || 0);
      if (statEls.inventory_value) statEls.inventory_value.textContent = App.fmtMoney(stats.inventory_value || 0);
      if (statEls.total_products) statEls.total_products.textContent = App.fmtNum(stats.total_products || 0);
    } catch (err) {
      App.toast(err.message || "Failed to load dashboard");
    }
  }

  async function syncGoogleContacts() {
    const GoogleContacts = window.InventoryGoogleContacts;
    if (!GoogleContacts?.autoSyncTagged) return;
    try {
      const result = await GoogleContacts.autoSyncTagged();
      if (!result?.skipped && (Number(result.created || 0) || Number(result.updated || 0))) {
        App.toast(GoogleContacts.formatImportSummary(result), 3200);
      }
    } catch {
      // Auto sync should never block the home screen.
    }
  }

  load();
  syncGoogleContacts();
});
