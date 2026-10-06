document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const list = App.qs("#documentsList");
  const countLabel = App.qs("#documentsCountLabel");
  const typeFilter = App.qs("#docTypeFilter");
  const searchInput = App.qs("#docSearch");
  const loadMore = App.qs("#documentsLoadMore");
  const FILTER_KEY = "inventory_docs_filter_v1";
  const pageSize = 100;
  const state = {
    type: "",
    search: "",
    count: 0,
    loading: false,
    done: false,
    seq: 0,
    lastDay: null,
    lastGroup: null
  };

  try {
    const saved = JSON.parse(sessionStorage.getItem(FILTER_KEY) || "{}");
    state.type = saved.type || "";
    state.search = saved.search || "";
  } catch {
    // ignore
  }
  searchInput.value = state.search;
  App.qs(`[data-clear-for="docSearch"]`)?.classList.toggle("hidden", !state.search);
  App.qsa("button", typeFilter).forEach((b) => b.classList.toggle("active", b.dataset.type === state.type));

  function saveFilter() {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify({ type: state.type, search: state.search }));
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  function dayTotalText(t) {
    if (!t) return "";
    const parts = [];
    if (t.sales) parts.push(`${plural(t.sales, "sale")} · ${App.fmtMoney(t.sales_total)}`);
    if (t.incoming) parts.push(`${t.incoming} in · ${App.fmtMoney(t.incoming_total)}`);
    if (t.adjustments) parts.push(plural(t.adjustments, "adjustment"));
    return parts.join("  •  ");
  }

  function appendDocs(docs, dayTotals) {
    for (const doc of docs) {
      if (doc.doc_date !== state.lastDay) {
        state.lastDay = doc.doc_date;
        list.insertAdjacentHTML("beforeend", `
          <div class="day-header"><span>${App.escapeHtml(App.dayLabel(doc.doc_date))}</span><span class="day-total">${App.escapeHtml(dayTotalText(dayTotals[doc.doc_date]))}</span></div>
          <div class="day-group rows"></div>`);
        state.lastGroup = list.lastElementChild;
      }
      state.lastGroup.insertAdjacentHTML("beforeend", App.docCardHtml(doc));
    }
  }

  async function loadDocs(reset = false) {
    if (reset) {
      state.seq += 1;
      state.count = 0;
      state.done = false;
      state.loading = false;
      state.lastDay = null;
      state.lastGroup = null;
      list.innerHTML = "";
    }
    if (state.loading || state.done) return;
    const seq = state.seq;
    state.loading = true;
    loadMore.classList.remove("hidden");

    try {
      const params = new URLSearchParams();
      if (state.type) params.set("type", state.type);
      if (state.search) params.set("search", state.search);
      params.set("limit", String(pageSize));
      params.set("offset", String(state.count));
      const data = await App.localData(`documents?${params.toString()}`);
      if (seq !== state.seq) return;
      const docs = data.documents || [];
      state.count += docs.length;
      state.done = docs.length < pageSize;
      appendDocs(docs, data.day_totals || {});
      countLabel.textContent = state.count
        ? `${App.fmtNum(state.count)}${state.done ? "" : "+"} ${state.count === 1 ? "document" : "documents"}`
        : " ";
      if (!state.count) {
        list.innerHTML = `<div class="card">${App.emptyState(state.search ? "No documents match your search." : "No documents yet.")}</div>`;
      }
    } catch (err) {
      if (!state.count) list.innerHTML = `<div class="card">${App.emptyState(err.message || "Failed to load documents")}</div>`;
      App.toast(err.message || "Failed to load documents");
    } finally {
      if (seq === state.seq) {
        state.loading = false;
        loadMore.classList.toggle("hidden", state.done);
      }
    }
  }

  list.addEventListener("click", (e) => {
    const item = e.target.closest("[data-doc-id]");
    if (item) window.location.href = App.docUrl(item.dataset.docId);
  });

  typeFilter.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn) return;
    state.type = btn.dataset.type;
    App.qsa("button", typeFilter).forEach((b) => b.classList.toggle("active", b === btn));
    saveFilter();
    loadDocs(true);
  });

  searchInput.addEventListener("input", App.debounce(() => {
    state.search = searchInput.value.trim();
    saveFilter();
    loadDocs(true);
  }, 200));

  window.addEventListener("scroll", () => {
    const nearBottom = window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 600;
    if (nearBottom) loadDocs();
  }, { passive: true });

  loadDocs(true);
});
