document.addEventListener("DOMContentLoaded", () => {
  const App = window.InventoryApp;
  const logoutBtn = App.qs("#logoutBtn");
  const statEls = App.qsa("[data-stat]").reduce((map, el) => {
    map[el.dataset.stat] = el;
    return map;
  }, {});

  logoutBtn?.addEventListener("click", () => App.logout());

  async function load() {
    try {
      const data = await App.api("/api/dashboard");
      const stats = data.stats || {};
      if (statEls.todays_sales) statEls.todays_sales.textContent = App.fmtMoney(stats.todays_sales || 0);
      if (statEls.inventory_value) statEls.inventory_value.textContent = App.fmtMoney(stats.inventory_value || 0);
      if (statEls.total_products) statEls.total_products.textContent = App.fmtNum(stats.total_products || 0);
    } catch (err) {
      App.toast(err.message || "Failed to load dashboard");
    }
  }

  load();
});
