document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const params = App.queryParams();
  const id = Number(params.get("id") || 0) || null;

  const els = {
    title: App.qs("#goodTitle"),
    pathLabel: App.qs("#goodPathLabel"),
    stockCard: App.qs("#stockCard"),
    stockQty: App.qs("#stockQty"),
    stockSub: App.qs("#stockSub"),
    adjustBtn: App.qs("#adjustBtn"),
    sellLink: App.qs("#sellLink"),
    receiveLink: App.qs("#receiveLink"),
    form: App.qs("#goodForm"),
    name: App.qs("#goodName"),
    group: App.qs("#goodGroup"),
    groupPrices: App.qs("#groupPrices"),
    avgCost: App.qs("#goodAvgCost"),
    barcode: App.qs("#goodBarcode"),
    startQtyField: App.qs("#startQtyField"),
    startQty: App.qs("#goodStartQty"),
    saveBtn: App.qs("#goodSaveBtn"),
    historyTitle: App.qs("#historyTitle"),
    historyCard: App.qs("#historyCard"),
    historyCount: App.qs("#goodHistoryCount"),
    historyList: App.qs("#goodHistoryList"),
    deleteBtn: App.qs("#goodDeleteBtn"),
    adjustModal: App.qs("#adjustModal"),
    adjustForm: App.qs("#adjustForm"),
    adjustHint: App.qs("#adjustHint"),
    adjustQty: App.qs("#adjustQty"),
    adjustDiff: App.qs("#adjustDiff")
  };

  const state = { good: null, groups: [], tree: [], groupById: new Map() };

  function parseNum(value) {
    const n = Number(String(value ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }

  function renderGroupPrices() {
    const group = state.groupById.get(Number(els.group.value));
    els.groupPrices.textContent = group
      ? `Group prices: buy ${App.fmtMoney(group.price_in)} · sell ${App.fmtMoney(group.price_out)}`
      : "No group: this product has no default prices.";
  }

  function renderGood() {
    const good = state.good;
    if (!good) return;
    const qty = Number(good.quantity || 0);
    els.title.firstChild.textContent = good.name;
    els.pathLabel.textContent = App.groupPath(good.group_id, state.groupById) || "No group";
    els.stockCard.classList.remove("hidden");
    els.stockQty.textContent = App.fmtNum(qty);
    els.stockSub.textContent = `${App.fmtMoney(good.avg_cost)} each · ${App.fmtMoney(qty * Number(good.avg_cost || 0))} at cost`;
    els.sellLink.href = `document-form.html?type=2&good=${good.id}`;
    els.receiveLink.href = `document-form.html?type=1&good=${good.id}`;
    els.name.value = good.name || "";
    els.group.value = good.group_id ? String(good.group_id) : "";
    els.avgCost.value = String(Number(good.avg_cost || 0));
    els.barcode.value = good.barcode || "";
    els.deleteBtn.classList.remove("hidden");
    renderGroupPrices();
  }

  async function loadGroups() {
    const data = await App.localData("goods-groups");
    state.groups = data.groups || [];
    state.tree = data.tree || [];
    state.groupById = App.groupMap(state.groups);
    App.fillGroupSelect(els.group, state.tree, { includeBlank: true, blankLabel: "No group" });
  }

  async function loadGood() {
    const { good } = await App.localData(`goods?id=${encodeURIComponent(id)}`);
    if (!good) throw new Error("Product not found");
    state.good = good;
    renderGood();
  }

  async function loadHistory() {
    if (!id) return;
    const { documents = [] } = await App.localData(`documents?good_id=${encodeURIComponent(id)}&limit=100`);
    els.historyTitle.classList.remove("hidden");
    els.historyCard.classList.remove("hidden");
    els.historyCount.textContent = documents.length >= 100 ? "last 100" : `${documents.length}`;
    els.historyList.innerHTML = documents.length
      ? documents.map((doc) => App.docCardHtml(doc, { showDate: true })).join("")
      : App.emptyState("No sales or deliveries yet.");
  }

  async function save(e) {
    e.preventDefault();
    const name = els.name.value.trim();
    if (!name) return App.toast("Enter a name");
    const avgCost = parseNum(els.avgCost.value || 0);
    if (!Number.isFinite(avgCost) || avgCost < 0) return App.toast("Avg cost must be a number");
    const payload = {
      name,
      group_id: els.group.value ? Number(els.group.value) : null,
      avg_cost: avgCost,
      barcode: els.barcode.value.trim() || null
    };
    App.setLoading(els.saveBtn, true);
    try {
      if (id) {
        const { good } = await App.localData("goods", { method: "PUT", body: { id, ...payload } });
        state.good = good;
        renderGood();
        App.toast("Saved");
      } else {
        const { good } = await App.localData("goods", { method: "POST", body: { ...payload, quantity: 0 } });
        const start = parseNum(els.startQty.value || 0);
        if (Number.isFinite(start) && start > 0) {
          await App.localData("stock-adjust", { method: "POST", body: { good_id: good.id, counted: start } });
        }
        App.flash(`${good.name} added`);
        window.location.replace(`good-form.html?id=${encodeURIComponent(good.id)}`);
      }
    } catch (err) {
      App.toast(err.message || "Failed to save");
    } finally {
      App.setLoading(els.saveBtn, false);
    }
  }

  function renderAdjustDiff() {
    const current = Number(state.good?.quantity || 0);
    const counted = parseNum(els.adjustQty.value);
    if (els.adjustQty.value.trim() === "" || !Number.isFinite(counted)) {
      els.adjustDiff.textContent = " ";
      els.adjustDiff.className = "hint";
      return;
    }
    const diff = counted - current;
    els.adjustDiff.textContent = diff === 0 ? "Matches the system" : `${App.fmtSigned(diff)} vs system`;
    els.adjustDiff.className = `hint ${diff > 0 ? "success-text" : diff < 0 ? "danger-text" : ""}`;
  }

  function openAdjust() {
    const current = Number(state.good?.quantity || 0);
    els.adjustHint.textContent = `System says ${App.fmtNum(current)}. Enter what you actually have; the difference is saved as today's adjustment.`;
    els.adjustQty.value = String(current);
    renderAdjustDiff();
    App.openModal(els.adjustModal);
    setTimeout(() => {
      els.adjustQty.focus();
      els.adjustQty.select();
    }, 60);
  }

  async function saveAdjust(e) {
    e.preventDefault();
    const counted = parseNum(els.adjustQty.value);
    if (els.adjustQty.value.trim() === "" || !Number.isFinite(counted) || counted < 0) return App.toast("Enter a count of 0 or more");
    try {
      const result = await App.localData("stock-adjust", { method: "POST", body: { good_id: id, counted } });
      App.closeModal(els.adjustModal);
      state.good = result.good;
      renderGood();
      await loadHistory();
      App.toast(result.delta
        ? `Stock set to ${App.fmtNum(counted)} (${App.fmtSigned(result.delta)})${result.document ? ` · ${result.document.doc_num}` : ""}`
        : "Count matches, nothing changed");
    } catch (err) {
      App.toast(err.message || "Failed to adjust");
    }
  }

  async function remove() {
    if (!id || !window.confirm("Delete this product?")) return;
    try {
      await App.localData(`goods?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      App.flash("Product deleted");
      window.location.replace("goods.html");
    } catch (err) {
      App.toast(err.message === "Cannot delete product with document history"
        ? "This product has sales or deliveries, so it can't be deleted. Move it to an inactive group instead."
        : err.message || "Failed to delete");
    }
  }

  els.form.addEventListener("submit", save);
  els.group.addEventListener("change", renderGroupPrices);
  els.adjustBtn.addEventListener("click", openAdjust);
  els.adjustForm.addEventListener("submit", saveAdjust);
  els.adjustQty.addEventListener("input", renderAdjustDiff);
  els.deleteBtn.addEventListener("click", remove);
  els.historyList.addEventListener("click", (e) => {
    const row = e.target.closest("[data-doc-id]");
    if (row) window.location.href = App.docUrl(row.dataset.docId);
  });

  (async () => {
    await loadGroups();
    if (id) {
      await loadGood();
      await loadHistory();
    } else {
      els.startQtyField.classList.remove("hidden");
      const groupParam = params.get("group");
      if (groupParam) els.group.value = groupParam;
      renderGroupPrices();
      els.name.focus();
    }
  })().catch((err) => App.toast(err.message || "Failed to load product"));
});
