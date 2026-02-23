document.addEventListener("DOMContentLoaded", () => {
  const App = window.InventoryApp;
  const list = App.qs("#contragentsList");
  const countLabel = App.qs("#contragentCountLabel");
  const searchInput = App.qs("#contragentSearch");
  const typeFilter = App.qs("#contragentTypeFilter");
  const refreshBtn = App.qs("#contragentRefreshBtn");

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
            <div class="list-item-sub">${App.escapeHtml(c.phone || c.email || "No contact info")}</div>
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
      const data = await App.api(`/api/contragents?${params.toString()}`);
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
    window.location.href = `/contragent-form.html?id=${encodeURIComponent(row.dataset.id)}`;
  });

  searchInput?.addEventListener("input", App.debounce(load, 220));
  typeFilter?.addEventListener("change", load);
  refreshBtn?.addEventListener("click", load);
  load();
});
