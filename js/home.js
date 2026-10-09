window.InventoryApp.defineView("home", (ctx) => {
  const App = window.InventoryApp;
  const statEls = App.qsa("[data-stat]").reduce((map, el) => {
    map[el.dataset.stat] = el;
    return map;
  }, {});

  App.qs("#todayLabel").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  function plural(n, word) {
    return `${App.fmtNum(n)} ${word}${Number(n) === 1 ? "" : "s"}`;
  }

  async function loadStats() {
    try {
      const { stats = {} } = await App.localData("dashboard");
      statEls.todays_sales.textContent = App.fmtMoney(stats.todays_sales);
      statEls.todays_count.textContent = plural(stats.todays_count || 0, "sale");
      statEls.month_sales.textContent = App.fmtMoney(stats.month_sales);
      statEls.month_count.textContent = plural(stats.month_count || 0, "sale");
      statEls.inventory_value.textContent = App.fmtMoney(stats.inventory_value);
      statEls.in_stock_products.textContent = `${plural(stats.in_stock_products || 0, "product")} in stock`;
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

  loadStats();
  syncGoogleContacts();
});
