document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const { DOC_IN, DOC_OUT, DOC_ADJ } = App;
  const params = App.queryParams();
  const docId = Number(params.get("id") || 0) || null;
  const KBD_KEY = "inventory_party_keyboard_v1";

  const els = {
    title: App.qs("#docTitle"),
    subtitle: App.qs("#docSubtitle"),
    shareBtn: App.qs("#shareBtn"),
    typeSwitch: App.qs("#typeSwitch"),
    partyCard: App.qs("#partyCard"),
    partyLabel: App.qs("#partyLabel"),
    partySelected: App.qs("#partySelected"),
    partyName: App.qs("#partyName"),
    partySub: App.qs("#partySub"),
    partyClear: App.qs("#partyClear"),
    partySearchWrap: App.qs("#partySearchWrap"),
    partySearch: App.qs("#partySearch"),
    partyDropdown: App.qs("#partyDropdown"),
    kbdToggle: App.qs("#kbdToggle"),
    date: App.qs("#docDate"),
    adjNote: App.qs("#adjNote"),
    linesTitle: App.qs("#linesTitle"),
    lines: App.qs("#documentLines"),
    recentSection: App.qs("#recentSection"),
    recentList: App.qs("#recentList"),
    pickerSection: App.qs("#pickerSection"),
    productSearch: App.qs("#productSearch"),
    pickerChips: App.qs("#pickerChips"),
    picker: App.qs("#productPicker"),
    deleteBtn: App.qs("#deleteBtn"),
    totalLabel: App.qs("#totalLabel"),
    totalValue: App.qs("#totalValue"),
    saveBtn: App.qs("#saveBtn"),
    lineModal: App.qs("#lineModal"),
    lineForm: App.qs("#lineForm"),
    lineModalTitle: App.qs("#lineModalTitle"),
    lineModalSub: App.qs("#lineModalSub"),
    lineModalQty: App.qs("#lineModalQty"),
    lineModalPrice: App.qs("#lineModalPrice"),
    lineModalHint: App.qs("#lineModalHint"),
    lineModalCancel: App.qs("#lineModalCancel")
  };

  const requestedType = Number(params.get("type"));
  const state = {
    docId,
    docNum: null,
    description: null,
    docType: [DOC_IN, DOC_OUT].includes(requestedType) ? requestedType : DOC_OUT,
    party: null,
    groups: [],
    tree: [],
    groupById: new Map(),
    goods: [],
    goodsById: new Map(),
    lines: [],
    originalQty: new Map(),
    pickerGroupId: null,
    showZero: false,
    showInactive: false,
    recent: [],
    recentSeq: 0,
    partySeq: 0,
    uid: 0,
    savedSnapshot: "",
    saving: false
  };

  const isSale = () => state.docType === DOC_OUT;
  const isIn = () => state.docType === DOC_IN;
  const isAdj = () => state.docType === DOC_ADJ;

  // ── helpers ──────────────────────────────────────────────────────────
  function parseNum(value) {
    const n = Number(String(value ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function round(n, digits = 4) {
    const f = 10 ** digits;
    return Math.round(Number(n || 0) * f) / f;
  }

  function goodPath(good) {
    return App.groupPath(good?.group_id, state.groupById) || "No group";
  }

  function defaultPrice(good) {
    if (!good) return 0;
    const group = state.groupById.get(Number(good.group_id));
    if (isIn()) return Number(good.last_in_price || group?.price_in || good.avg_cost || 0);
    if (isAdj()) return Number(good.avg_cost || 0);
    return Number(group?.price_out || 0);
  }

  function qtyInLines(goodId) {
    return state.lines
      .filter((l) => Number(l.good_id) === Number(goodId))
      .reduce((s, l) => s + Number(l.quantity || 0), 0);
  }

  // Stock a sale can use: what's on hand plus what this saved doc already took.
  function availableFor(goodId) {
    const good = state.goodsById.get(Number(goodId));
    return Number(good?.quantity || 0) + Number(state.originalQty.get(Number(goodId)) || 0);
  }

  function lineTotal(line) {
    return Number(line.quantity || 0) * Number(line.price || 0);
  }

  function docTotal() {
    return state.lines.reduce((s, l) => s + lineTotal(l), 0);
  }

  function snapshot() {
    return JSON.stringify({
      type: state.docType,
      party: state.party?.id || null,
      date: els.date.value,
      lines: state.lines.map((l) => [l.good_id, round(l.quantity), round(l.price)])
    });
  }

  function isDirty() {
    if (state.saving) return false;
    if (!state.docId) return state.lines.length > 0;
    return snapshot() !== state.savedSnapshot;
  }

  App.setLeaveGuard(() => !isDirty() || window.confirm("Discard your changes?"));

  // ── header / party ───────────────────────────────────────────────────
  function renderHeader() {
    const existing = Boolean(state.docId);
    if (existing) {
      els.title.firstChild.textContent = `${App.docTypeLabel(state.docType)} ${state.docNum || ""}`.trim();
    } else {
      els.title.firstChild.textContent = isIn() ? "Receive Stock" : "New Sale";
    }
    els.subtitle.textContent = existing && state.docType !== DOC_ADJ && state.party ? state.party.name : "";
    els.typeSwitch.classList.toggle("hidden", existing);
    App.qsa("button", els.typeSwitch).forEach((b) => b.classList.toggle("active", Number(b.dataset.type) === state.docType));
    els.partyCard.classList.toggle("hidden", isAdj());
    els.adjNote.classList.toggle("hidden", !isAdj());
    els.pickerSection.classList.toggle("hidden", isAdj());
    els.partyLabel.textContent = isIn() ? "Supplier" : "Customer (optional)";
    els.partySearch.placeholder = isIn() ? "Supplier name" : "Customer # or name";
    els.linesTitle.textContent = isAdj() ? "Changes" : isIn() ? "Received items" : "Items";
    els.shareBtn.classList.toggle("hidden", !existing || isAdj());
    els.deleteBtn.classList.toggle("hidden", !existing);
    els.deleteBtn.textContent = `Delete ${App.docTypeLabel(state.docType).toLowerCase()}`;
    els.saveBtn.textContent = existing ? "Save" : isIn() ? "Save Receiving" : "Save Sale";
  }

  function renderParty() {
    const p = state.party;
    els.partySelected.classList.toggle("hidden", !p);
    els.partySearchWrap.classList.toggle("hidden", Boolean(p));
    if (p) {
      els.partyName.textContent = p.name;
      els.partySub.textContent = p.phone || (isIn() ? "Supplier" : "Customer");
    }
  }

  // Customers are usually looked up by # number, suppliers by name.
  function setKeyboard(mode, remember = true) {
    const numeric = mode !== "text";
    els.partySearch.inputMode = numeric ? "numeric" : "text";
    els.kbdToggle.textContent = numeric ? "123" : "ABC";
    els.kbdToggle.classList.toggle("active", numeric);
    if (remember) localStorage.setItem(KBD_KEY, numeric ? "numeric" : "text");
  }

  function defaultKeyboard() {
    setKeyboard(isIn() ? "text" : localStorage.getItem(KBD_KEY) || "numeric", false);
  }

  function hideDropdown() {
    els.partyDropdown.classList.add("hidden");
  }

  async function searchParty() {
    const q = els.partySearch.value.trim();
    const seq = ++state.partySeq;
    if (!q) {
      hideDropdown();
      return;
    }
    const type = isIn() ? 0 : 1;
    let rows = [];
    try {
      const data = await App.localData(`contragents?type=${type}&search=${encodeURIComponent(q)}`);
      rows = (data.contragents || []).slice(0, 40);
    } catch (err) {
      App.toast(err.message || "Search failed");
    }
    if (seq !== state.partySeq) return;
    const addLabel = `Add “${q}” as new ${isIn() ? "supplier" : "customer"}`;
    els.partyDropdown.innerHTML = rows.map((c) => `
        <div class="row-item tappable" data-party-id="${Number(c.id)}">
          <div class="row-main"><div class="row-title">${App.escapeHtml(c.name)}</div>${c.phone ? `<div class="row-sub">${App.escapeHtml(c.phone)}</div>` : ""}</div>
        </div>`).join("")
      + `<div class="row-item tappable" data-party-new><span class="success-text">${App.icon("plus")}</span><div class="row-main"><div class="row-title success-text">${App.escapeHtml(addLabel)}</div></div></div>`;
    els.partyDropdown._rows = rows;
    els.partyDropdown.classList.remove("hidden");
  }

  function selectParty(c) {
    state.party = c ? { id: Number(c.id), name: c.name, phone: c.phone || "" } : null;
    els.partySearch.value = "";
    hideDropdown();
    renderParty();
    renderHeader();
    loadRecent();
  }

  async function createParty(name) {
    try {
      const { contragent } = await App.localData("contragents", {
        method: "POST",
        body: { name, type: isIn() ? 0 : 1 }
      });
      selectParty(contragent);
      App.toast(`Added ${contragent.name}`);
    } catch (err) {
      App.toast(err.message || "Could not add");
    }
  }

  // ── lines ────────────────────────────────────────────────────────────
  function lineWarning(line) {
    if (isSale()) {
      const avail = availableFor(line.good_id);
      if (qtyInLines(line.good_id) > avail + 1e-9) return `Only ${App.fmtNum(avail)} in stock`;
    }
    if (!isAdj() && Number(line.price || 0) <= 0) return "No price";
    return "";
  }

  function lineSub(line, good) {
    const parts = [goodPath(good)];
    if (isSale()) parts.push(`${App.fmtNum(availableFor(line.good_id))} in stock`);
    if (isAdj()) parts.push(`cost ${App.fmtMoney(line.price)} each`);
    return parts.join(" · ");
  }

  function lineCardHtml(line) {
    const good = state.goodsById.get(Number(line.good_id)) || line.good;
    const uid = App.escapeHtml(line.uid);
    const warn = lineWarning(line);
    // Adjustments can be negative; the decimal keypad has no minus key.
    const qtyAttrs = isAdj() ? 'type="number" step="any"' : 'type="text" inputmode="decimal"';
    const totalText = isAdj() ? App.fmtMoneySigned(lineTotal(line)) : App.fmtMoney(lineTotal(line));
    return `
      <div class="line-card" data-line-uid="${uid}">
        <div class="line-head">
          <div class="row-main">
            <div class="row-title wrap">${App.escapeHtml(good?.name || `#${line.good_id}`)}</div>
            <div class="row-sub" data-line-sub>${App.escapeHtml(lineSub(line, good))}</div>
          </div>
          <button class="icon-btn line-remove" type="button" data-remove-line="${uid}" aria-label="Remove">${App.icon("x")}</button>
        </div>
        <div class="line-controls">
          <div class="stepper">
            <button type="button" data-step="-1" aria-label="Less">−</button>
            <input data-line-field="quantity" ${qtyAttrs} value="${round(line.quantity)}" aria-label="Quantity">
            <button type="button" data-step="1" aria-label="More">+</button>
          </div>
          ${isAdj() ? "" : `
          <span class="muted">×</span>
          <span class="money-input price-input"><span class="money-prefix">$</span><input class="input" data-line-field="price" type="text" inputmode="decimal" value="${round(line.price, 2)}" aria-label="Price"></span>`}
          <span class="line-total" data-line-total>${App.escapeHtml(totalText)}</span>
        </div>
        <div class="line-warn${warn ? "" : " hidden"}" data-line-warn>${App.escapeHtml(warn)}</div>
      </div>`;
  }

  function renderLines() {
    els.lines.innerHTML = state.lines.length
      ? state.lines.map(lineCardHtml).join("")
      : App.emptyState(isIn() ? "Nothing received yet. Add products below." : "No items yet. Add products below.");
    renderTotals();
  }

  // Refresh one card's numbers in place so the field being typed in keeps focus.
  function refreshLineCard(line) {
    const card = els.lines.querySelector(`[data-line-uid="${CSS.escape(line.uid)}"]`);
    if (!card) return;
    card.querySelector("[data-line-total]").textContent = isAdj() ? App.fmtMoneySigned(lineTotal(line)) : App.fmtMoney(lineTotal(line));
    const good = state.goodsById.get(Number(line.good_id));
    card.querySelector("[data-line-sub]").textContent = lineSub(line, good);
    // Stock warnings depend on every line for the same product.
    for (const other of state.lines.filter((l) => Number(l.good_id) === Number(line.good_id))) {
      const otherCard = els.lines.querySelector(`[data-line-uid="${CSS.escape(other.uid)}"]`);
      const warnEl = otherCard?.querySelector("[data-line-warn]");
      if (!warnEl) continue;
      const warn = lineWarning(other);
      warnEl.textContent = warn;
      warnEl.classList.toggle("hidden", !warn);
    }
    renderTotals();
  }

  function renderTotals() {
    const total = docTotal();
    const n = state.lines.length;
    const pcs = state.lines.reduce((s, l) => s + Math.abs(Number(l.quantity || 0)), 0);
    els.totalLabel.textContent = n
      ? `${n} item${n === 1 ? "" : "s"}${pcs !== n ? ` · ${App.fmtNum(pcs)} pcs` : ""}`
      : "No items";
    els.totalValue.textContent = isAdj() ? App.fmtMoneySigned(total) : App.fmtMoney(total);
  }

  // Keep the product list from jumping when a line is added above it.
  function withStableScroll(fn) {
    const before = els.lines.offsetHeight;
    fn();
    const delta = els.lines.offsetHeight - before;
    if (delta && els.lines.getBoundingClientRect().bottom < window.innerHeight) {
      window.scrollBy(0, delta);
    }
  }

  function addLine(good, { quantity = 1, price, manualPrice = false } = {}) {
    const linePrice = price ?? defaultPrice(good);
    // Sales bump the existing line (keeping its price); deliveries at a
    // different cost stay as separate lines.
    const existing = state.lines.find((l) => Number(l.good_id) === Number(good.id)
      && (!isIn() || Math.abs(Number(l.price) - linePrice) < 1e-9));
    if (existing) {
      existing.quantity = round(Number(existing.quantity || 0) + quantity);
      refreshLineCard(existing);
      const input = els.lines.querySelector(`[data-line-uid="${CSS.escape(existing.uid)}"] [data-line-field="quantity"]`);
      if (input) input.value = round(existing.quantity);
    } else {
      state.uid += 1;
      state.lines.push({ uid: `l${state.uid}`, good_id: Number(good.id), quantity, price: linePrice, manualPrice });
      withStableScroll(renderLines);
    }
    markAddButtons(good.id);
  }

  function markAddButtons(goodId) {
    if (isIn()) return;
    const inLines = qtyInLines(goodId);
    App.qsa(`[data-add-good="${Number(goodId)}"], [data-recent-add="${Number(goodId)}"]`).forEach((btn) => {
      btn.textContent = inLines ? `+1` : "Add";
    });
  }

  // ── receiving: ask quantity + cost ───────────────────────────────────
  function askReceiveLine(good) {
    return new Promise((resolve) => {
      const price = defaultPrice(good);
      els.lineModalTitle.textContent = good.name;
      els.lineModalSub.textContent = `${goodPath(good)} · ${App.fmtNum(good.quantity)} in stock`;
      els.lineModalQty.value = "1";
      els.lineModalPrice.value = price ? String(round(price, 2)) : "";
      const hints = [];
      if (good.last_in_price) hints.push(`Last paid ${App.fmtMoney(good.last_in_price)}`);
      if (good.avg_cost) hints.push(`avg cost ${App.fmtMoney(good.avg_cost)}`);
      els.lineModalHint.textContent = hints.join(" · ");
      App.openModal(els.lineModal);
      setTimeout(() => {
        els.lineModalQty.focus();
        els.lineModalQty.select();
      }, 60);

      const cleanup = (value) => {
        els.lineForm.removeEventListener("submit", onSubmit);
        els.lineModalCancel.removeEventListener("click", onCancel);
        els.lineModal.removeEventListener("click", onBackdrop);
        els.lineModalQty.removeEventListener("keydown", onQtyKey);
        App.closeModal(els.lineModal);
        resolve(value);
      };
      const onCancel = () => cleanup(null);
      const onBackdrop = (e) => { if (e.target === els.lineModal) cleanup(null); };
      const onQtyKey = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        els.lineModalPrice.focus();
      };
      const onSubmit = (e) => {
        e.preventDefault();
        const quantity = parseNum(els.lineModalQty.value);
        const cost = parseNum(els.lineModalPrice.value);
        if (quantity <= 0) {
          App.toast("Enter a quantity");
          els.lineModalQty.focus();
          return;
        }
        if (cost <= 0) {
          App.toast("Enter the cost");
          els.lineModalPrice.focus();
          return;
        }
        cleanup({ quantity, price: cost });
      };
      els.lineForm.addEventListener("submit", onSubmit);
      els.lineModalCancel.addEventListener("click", onCancel);
      els.lineModal.addEventListener("click", onBackdrop);
      els.lineModalQty.addEventListener("keydown", onQtyKey);
    });
  }

  async function addGood(good, options = {}) {
    if (!good) return;
    if (isIn()) {
      const details = await askReceiveLine(good);
      if (!details) return;
      addLine(good, { ...details, manualPrice: true });
      return;
    }
    addLine(good, options);
  }

  // ── product picker ───────────────────────────────────────────────────
  function pickerRowHtml(good, showPath) {
    const qty = Number(good.quantity || 0);
    const price = defaultPrice(good);
    const sub = [];
    if (showPath) sub.push(goodPath(good));
    sub.push(price ? App.fmtMoney(price) : "no price");
    const inLines = !isIn() && qtyInLines(good.id) > 0;
    return `
      <div class="row-item">
        <div class="row-main">
          <div class="row-title">${App.escapeHtml(good.name)}</div>
          <div class="row-sub clip">${App.escapeHtml(sub.join(" · "))}</div>
        </div>
        <span class="qty-pill${qty <= 0 ? " zero" : ""}">${App.escapeHtml(App.fmtNum(qty))}</span>
        <button class="add-btn" type="button" data-add-good="${Number(good.id)}">${inLines ? "+1" : "Add"}</button>
      </div>`;
  }

  function renderChips() {
    if (els.productSearch.value.trim()) {
      els.pickerChips.innerHTML = "";
      return;
    }
    const chips = [];
    if (isSale()) chips.push(`<button class="chip${state.showZero ? " active" : ""}" type="button" data-chip="zero">Out of stock</button>`);
    chips.push(`<button class="chip${state.showInactive ? " active" : ""}" type="button" data-chip="inactive">Inactive groups</button>`);
    els.pickerChips.innerHTML = chips.join("");
  }

  function renderPicker() {
    renderChips();
    const q = els.productSearch.value.trim();
    if (q) {
      const results = App.searchProducts(state.goods, q, 50);
      els.picker.innerHTML = results.length
        ? `<div class="card flush"><div class="rows">${results.map((g) => pickerRowHtml(g, true)).join("")}</div></div>`
        : `<div class="card">${App.emptyState("No products match.")}</div>`;
      return;
    }
    const tree = state.showInactive ? state.tree : App.filterTree(state.tree, (n) => n.is_active !== false);
    const visibleIds = App.collectTreeIds(tree);
    if (state.pickerGroupId && !visibleIds.has(Number(state.pickerGroupId))) state.pickerGroupId = null;
    const goods = state.goods.filter((g) => {
      if (g.group_id && !visibleIds.has(Number(g.group_id))) return false;
      return !isSale() || state.showZero || Number(g.quantity || 0) > 0;
    });
    App.renderGroupExplorer(els.picker, {
      tree,
      goods,
      groupId: state.pickerGroupId,
      groupsById: state.groupById,
      goodRowHtml: (g) => pickerRowHtml(g, false),
      totalsGoods: state.goods,
      emptyText: isSale() ? "Nothing in stock here." : "No products here."
    });
  }

  // ── recent items for the customer ────────────────────────────────────
  async function loadRecent() {
    const show = isSale() && state.party;
    if (!show) {
      state.recent = [];
      els.recentSection.classList.add("hidden");
      return;
    }
    const seq = ++state.recentSeq;
    try {
      const data = await App.localData(`customer-recent-goods?contragent_id=${state.party.id}&limit=12`);
      if (seq !== state.recentSeq) return;
      state.recent = data.items || [];
    } catch {
      state.recent = [];
    }
    renderRecent();
  }

  function renderRecent() {
    const items = state.recent || [];
    els.recentSection.classList.toggle("hidden", !items.length || !isSale());
    els.recentList.innerHTML = items.map((item) => {
      const good = state.goodsById.get(Number(item.good_id));
      const qty = Number(good?.quantity || 0);
      const sub = [item.group_name, App.fmtMoney(item.last_price), App.shortDate(item.last_date)].filter(Boolean).join(" · ");
      const inLines = qtyInLines(item.good_id) > 0;
      return `
        <div class="row-item">
          <div class="row-main">
            <div class="row-title">${App.escapeHtml(item.good_name)}</div>
            <div class="row-sub clip">${App.escapeHtml(sub)}</div>
          </div>
          <span class="qty-pill${qty <= 0 ? " zero" : ""}">${App.escapeHtml(App.fmtNum(qty))}</span>
          <button class="add-btn" type="button" data-recent-add="${Number(item.good_id)}" data-price="${Number(item.last_price || 0)}">${inLines ? "+1" : "Add"}</button>
        </div>`;
    }).join("");
  }

  // ── load ─────────────────────────────────────────────────────────────
  async function loadCatalog() {
    const [groupsData, goodsData] = await Promise.all([
      App.localData("goods-groups"),
      App.localData("goods")
    ]);
    state.groups = groupsData.groups || [];
    state.tree = App.normalizeGroupTree(groupsData.tree || []);
    state.groupById = App.groupMap(state.groups);
    state.goods = goodsData.goods || [];
    state.goodsById = new Map(state.goods.map((g) => [Number(g.id), g]));
  }

  async function loadDocument() {
    const { document: doc } = await App.localData(`documents?id=${encodeURIComponent(state.docId)}`);
    if (!doc) throw new Error("Document not found");
    state.docType = Number(doc.doc_type || DOC_OUT);
    state.docNum = doc.doc_num;
    state.description = doc.description || null;
    els.date.value = doc.doc_date || App.todayISO();
    state.party = doc.contragent ? { id: Number(doc.contragent.id), name: doc.contragent.name, phone: doc.contragent.phone || "" } : null;
    state.lines = (doc.lines || []).map((line) => {
      state.uid += 1;
      return { uid: `l${state.uid}`, good_id: Number(line.good_id), quantity: Number(line.quantity), price: Number(line.price), manualPrice: true, good: line.good };
    });
    if (state.docType === DOC_OUT) {
      for (const line of state.lines) {
        state.originalQty.set(line.good_id, (state.originalQty.get(line.good_id) || 0) + Number(line.quantity));
      }
    }
  }

  async function preselectFromParams() {
    const contragentId = Number(params.get("contragent") || 0);
    if (contragentId) {
      try {
        const { contragent } = await App.localData(`contragents?id=${contragentId}`);
        if (contragent) {
          state.docType = Number(contragent.type) === 0 ? DOC_IN : state.docType;
          state.party = { id: Number(contragent.id), name: contragent.name, phone: contragent.phone || "" };
        }
      } catch {
        // ignore a bad link
      }
    }
  }

  // ── save / delete / share ────────────────────────────────────────────
  async function save() {
    if (state.saving) return;
    if (!els.date.value) return App.toast("Pick a date");
    if (isIn() && !state.party) {
      els.partySearch.focus();
      return App.toast("Choose the supplier");
    }
    const lines = state.lines
      .map((l) => ({ good_id: Number(l.good_id), quantity: round(l.quantity), price: round(l.price, 4) }))
      .filter((l) => l.good_id && (isAdj() ? l.quantity !== 0 : l.quantity > 0));
    if (!lines.length) return App.toast("Add at least one item");

    if (isSale()) {
      const over = state.lines.find((l) => qtyInLines(l.good_id) > availableFor(l.good_id) + 1e-9);
      if (over) {
        const good = state.goodsById.get(Number(over.good_id));
        return App.toast(`Not enough ${good?.name || "stock"}: only ${App.fmtNum(availableFor(over.good_id))} in stock`);
      }
    }
    if (!isAdj()) {
      const unpriced = lines.filter((l) => l.price <= 0).length;
      if (unpriced && !window.confirm(`${unpriced} item${unpriced === 1 ? " has" : "s have"} no price. Save anyway?`)) return;
    }

    const payload = {
      doc_type: state.docType,
      doc_date: els.date.value,
      contragent_id: isAdj() ? null : state.party?.id || null,
      description: state.description,
      lines
    };
    state.saving = true;
    App.setLoading(els.saveBtn, true);
    try {
      const result = state.docId
        ? await App.localData("documents", { method: "PUT", body: { doc_id: state.docId, ...payload } })
        : await App.localData("documents", { method: "POST", body: payload });
      const num = result.document?.doc_num || state.docNum || "";
      App.flash(state.docId ? `${App.docTypeLabel(state.docType)} ${num} updated` : `${App.docTypeLabel(state.docType)} ${num} saved · ${App.fmtMoney(docTotal())}`);
      App.setLeaveGuard(null);
      App.goBack("index.html");
    } catch (err) {
      state.saving = false;
      App.toast(err.message || "Failed to save");
      App.setLoading(els.saveBtn, false);
    }
  }

  async function remove() {
    if (!state.docId) return;
    const what = App.docTypeLabel(state.docType).toLowerCase();
    if (!window.confirm(`Delete this ${what}? Stock will be put back the way it was.`)) return;
    try {
      await App.localData(`documents?id=${encodeURIComponent(state.docId)}`, { method: "DELETE" });
      App.flash(`${App.docTypeLabel(state.docType)} ${state.docNum || ""} deleted`);
      state.saving = true;
      App.setLeaveGuard(null);
      App.goBack("documents.html");
    } catch (err) {
      App.toast(err.message || "Failed to delete");
    }
  }

  async function share() {
    const lines = state.lines.map((l) => {
      const good = state.goodsById.get(Number(l.good_id));
      return `${App.fmtNum(l.quantity)} × ${good?.name || "#" + l.good_id} (${App.leafGroupName(goodPath(good))}) @ ${App.fmtMoney(l.price)} = ${App.fmtMoney(lineTotal(l))}`;
    });
    const text = [
      `${App.docTypeLabel(state.docType)} ${state.docNum || ""} · ${App.humanDate(els.date.value)}`,
      state.party ? state.party.name : "",
      "",
      ...lines,
      "",
      `Total: ${App.fmtMoney(docTotal())}`
    ].filter((s, i, arr) => s !== "" || arr[i - 1] !== "").join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        App.toast("Copied to clipboard");
      }
    } catch {
      // share sheet dismissed
    }
  }

  // ── events ───────────────────────────────────────────────────────────
  els.typeSwitch.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn || state.docId) return;
    const type = Number(btn.dataset.type);
    if (type === state.docType) return;
    state.docType = type;
    state.party = null;
    state.lines.forEach((l) => {
      l.price = defaultPrice(state.goodsById.get(Number(l.good_id)));
    });
    defaultKeyboard();
    renderHeader();
    renderParty();
    renderLines();
    renderPicker();
    loadRecent();
  });

  els.partySearch.addEventListener("input", App.debounce(searchParty, 120));
  els.partySearch.addEventListener("focus", () => {
    if (els.partySearch.value.trim()) searchParty();
  });
  els.partyDropdown.addEventListener("click", (e) => {
    if (e.target.closest("[data-party-new]")) {
      createParty(els.partySearch.value.trim());
      return;
    }
    const row = e.target.closest("[data-party-id]");
    if (!row) return;
    const c = (els.partyDropdown._rows || []).find((x) => Number(x.id) === Number(row.dataset.partyId));
    if (c) selectParty(c);
  });
  els.partyClear.addEventListener("click", () => {
    selectParty(null);
    requestAnimationFrame(() => els.partySearch.focus());
  });
  els.kbdToggle.addEventListener("click", () => {
    setKeyboard(els.partySearch.inputMode === "numeric" ? "text" : "numeric", !isIn());
    els.partySearch.blur();
    requestAnimationFrame(() => els.partySearch.focus());
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#partySearchWrap")) hideDropdown();
  });

  els.lines.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove-line]");
    if (removeBtn) {
      const uid = removeBtn.dataset.removeLine;
      const line = state.lines.find((l) => l.uid === uid);
      state.lines = state.lines.filter((l) => l.uid !== uid);
      renderLines();
      if (line) {
        markAddButtons(line.good_id);
        state.lines.filter((l) => l.good_id === line.good_id).forEach(refreshLineCard);
      }
      return;
    }
    const stepBtn = e.target.closest("[data-step]");
    if (stepBtn) {
      const card = stepBtn.closest("[data-line-uid]");
      const line = state.lines.find((l) => l.uid === card.dataset.lineUid);
      if (!line) return;
      let next = round(Number(line.quantity || 0) + Number(stepBtn.dataset.step));
      if (!isAdj() && next < 1) next = 1;
      line.quantity = next;
      card.querySelector('[data-line-field="quantity"]').value = next;
      refreshLineCard(line);
    }
  });

  els.lines.addEventListener("input", (e) => {
    const input = e.target.closest("[data-line-field]");
    if (!input) return;
    const card = input.closest("[data-line-uid]");
    const line = state.lines.find((l) => l.uid === card.dataset.lineUid);
    if (!line) return;
    line[input.dataset.lineField] = parseNum(input.value);
    if (input.dataset.lineField === "price") line.manualPrice = true;
    refreshLineCard(line);
  });

  els.recentList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-recent-add]");
    if (!btn) return;
    const good = state.goodsById.get(Number(btn.dataset.recentAdd));
    if (good) addGood(good, { price: Number(btn.dataset.price || 0), manualPrice: true });
  });

  els.picker.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add-good]");
    if (addBtn) {
      addGood(state.goodsById.get(Number(addBtn.dataset.addGood)));
      return;
    }
    const folder = e.target.closest("[data-drill-group]");
    if (folder) {
      state.pickerGroupId = Number(folder.dataset.drillGroup);
      renderPicker();
      els.pickerSection.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    const crumb = e.target.closest("[data-crumb-id]");
    if (crumb) {
      state.pickerGroupId = crumb.dataset.crumbId ? Number(crumb.dataset.crumbId) : null;
      renderPicker();
    }
  });

  els.pickerChips.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-chip]");
    if (!chip) return;
    if (chip.dataset.chip === "zero") state.showZero = !state.showZero;
    if (chip.dataset.chip === "inactive") state.showInactive = !state.showInactive;
    renderPicker();
  });

  els.productSearch.addEventListener("input", App.debounce(renderPicker, 120));
  els.saveBtn.addEventListener("click", save);
  els.deleteBtn.addEventListener("click", remove);
  els.shareBtn.addEventListener("click", share);

  // ── init ─────────────────────────────────────────────────────────────
  async function init() {
    els.date.value = App.todayISO();
    await loadCatalog();
    if (state.docId) await loadDocument();
    else await preselectFromParams();
    defaultKeyboard();
    renderHeader();
    renderParty();
    renderLines();
    renderPicker();
    await loadRecent();
    state.savedSnapshot = snapshot();

    const goodParam = Number(params.get("good") || 0);
    if (!state.docId && goodParam && state.goodsById.has(goodParam)) {
      addGood(state.goodsById.get(goodParam));
    }
  }

  init().catch((err) => {
    App.toast(err.message || "Failed to load");
    renderLines();
  });
});
