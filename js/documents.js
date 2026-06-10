document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const list = App.qs("#documentsList");
  const countLabel = App.qs("#documentsCountLabel");
  const typeFilter = App.qs("#docTypeFilter");
  const loadMore = App.qs("#documentsLoadMore");
  const pageSize = 100;
  const state = {
    docs: [],
    loading: false,
    done: false
  };

  async function loadDocs(reset = false) {
    if (state.loading) return;
    if (!reset && state.done) return;
    state.loading = true;
    loadMore?.classList.remove("hidden");

    try {
      if (reset) {
        state.docs = [];
        state.done = false;
        list.innerHTML = "";
        countLabel.textContent = "0 docs";
      }

      const params = new URLSearchParams();
      if (typeFilter.value) params.set("type", typeFilter.value);
      params.set("limit", String(pageSize));
      params.set("offset", String(state.docs.length));

      const data = await App.localData(`documents?${params.toString()}`);
      const docs = data.documents || [];
      state.docs.push(...docs);
      state.done = docs.length < pageSize;

      countLabel.textContent = state.done
        ? `${state.docs.length} doc${state.docs.length === 1 ? "" : "s"}`
        : `${state.docs.length}+ docs`;

      if (!state.docs.length) {
        list.innerHTML = App.emptyState("No documents found.");
      } else {
        list.innerHTML = state.docs.map(App.docCardHtml).join("");
      }
    } catch (err) {
      if (!state.docs.length) list.innerHTML = App.emptyState(err.message || "Failed to load documents");
      App.toast(err.message || "Failed to load documents");
    } finally {
      state.loading = false;
      loadMore?.classList.toggle("hidden", state.done);
    }
  }

  list?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-doc-id]");
    if (!item) return;
    window.location.href = `document-form.html?id=${encodeURIComponent(item.dataset.docId)}`;
  });

  typeFilter?.addEventListener("change", () => loadDocs(true));

  window.addEventListener("scroll", () => {
    const nearBottom = window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 500;
    if (nearBottom) loadDocs();
  }, { passive: true });

  loadDocs(true);
});
