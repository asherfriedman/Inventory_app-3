document.addEventListener("DOMContentLoaded", () => {
  const App = window.InventoryApp;
  const list = App.qs("#documentsList");
  const countLabel = App.qs("#documentsCountLabel");
  const typeFilter = App.qs("#docTypeFilter");
  const dateFrom = App.qs("#docDateFrom");
  const dateTo = App.qs("#docDateTo");
  const refreshBtn = App.qs("#docRefreshBtn");

  if (dateFrom && !dateFrom.value) dateFrom.value = App.startOfMonthISO();
  if (dateTo && !dateTo.value) dateTo.value = App.todayISO();

  async function loadDocs() {
    App.setLoading(refreshBtn, true);
    try {
      const params = new URLSearchParams();
      if (typeFilter.value) params.set("type", typeFilter.value);
      if (dateFrom.value) params.set("date_from", dateFrom.value);
      if (dateTo.value) params.set("date_to", dateTo.value);
      params.set("limit", "400");
      const data = await App.api(`/api/documents?${params.toString()}`);
      const docs = data.documents || [];
      countLabel.textContent = `${docs.length} doc${docs.length === 1 ? "" : "s"}`;
      if (!docs.length) {
        list.innerHTML = App.emptyState("No documents match these filters.");
        return;
      }
      list.innerHTML = docs.map(App.docCardHtml).join("");
    } catch (err) {
      list.innerHTML = App.emptyState(err.message || "Failed to load documents");
    } finally {
      App.setLoading(refreshBtn, false);
    }
  }

  list?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-doc-id]");
    if (!item) return;
    const id = item.dataset.docId;
    window.location.href = `/document-form.html?id=${encodeURIComponent(id)}`;
  });

  const debouncedLoad = App.debounce(loadDocs, 120);
  [typeFilter, dateFrom, dateTo].forEach((el) => el?.addEventListener("change", debouncedLoad));
  refreshBtn?.addEventListener("click", loadDocs);

  loadDocs();
});
