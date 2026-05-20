document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const params = App.queryParams();
  const initialType = Number(params.get("type") || 2);
  const docId = Number(params.get("id") || 0) || null;

  const els = {
    docId: App.qs("#documentId"),
    type: App.qs("#documentType"),
    date: App.qs("#documentDate"),
    contragent: App.qs("#documentContragent"),
    contragentSearch: App.qs("#contragentSearch"),
    contragentDropdown: App.qs("#contragentDropdown"),
    kbdToggle: App.qs("#kbdToggle"),
    linesWrap: App.qs("#documentLines"),
    saveBtn: App.qs("#documentSaveBtn"),
    deleteBtn: App.qs("#documentDeleteBtn"),
    recentCustomerCard: App.qs("#recentCustomerCard"),
    recentCustomerList: App.qs("#recentCustomerList"),
    metaCard: App.qs("#docMetaCard"),
    docNumberDisplay: App.qs("#docNumberDisplay"),
    linePickerExplorer: App.qs("#linePickerExplorer"),
    incomingLineModal: App.qs("#incomingLineModal"),
    incomingLineForm: App.qs("#incomingLineForm"),
    incomingLineTitle: App.qs("#incomingLineTitle"),
    incomingLineGroup: App.qs("#incomingLineGroup"),
    incomingLineQty: App.qs("#incomingLineQty"),
    incomingLinePrice: App.qs("#incomingLinePrice"),
    incomingLineCancel: App.qs("#incomingLineCancel")
  };

  const state = {
    docId,
    docNum: null,
    docType: [1, 2].includes(initialType) ? initialType : 2,
    groups: [],
    tree: [],
    groupById: new Map(),
    goods: [],
    goodsById: new Map(),
    contragents: [],
    lines: [],
    linePickerGroupId: null,
    uidSeed: 1,
    showInactiveGroups: false,
    showZeroQtyOnOutgoing: false,
    recentCustomerItems: [],
    recentFetchSeq: 0
  };

  if (!els.date.value) els.date.value = App.todayISO();

  function isGroupActive(group) {
    return group?.is_active !== false;
  }

  function normalizeGroupTree(nodes) {
    return (nodes || []).map((node) => ({
      ...node,
      is_active: node.is_active !== false,
      children: normalizeGroupTree(node.children || [])
    }));
  }

  function collectTreeIds(nodes, out = new Set()) {
    for (const node of nodes || []) {
      out.add(Number(node.id));
      collectTreeIds(node.children || [], out);
    }
    return out;
  }

  function findNodeInTree(nodes, id) {
    for (const node of nodes || []) {
      if (Number(node.id) === Number(id)) return node;
      const found = findNodeInTree(node.children || [], id);
      if (found) return found;
    }
    return null;
  }

  function buildVisiblePickerTree(nodes) {
    const out = [];
    for (const node of nodes || []) {
      if (!state.showInactiveGroups && !isGroupActive(node)) continue;
      out.push({
        ...node,
        children: buildVisiblePickerTree(node.children || [])
      });
    }
    return out;
  }

  function buildVisiblePickerState() {
    const tree = buildVisiblePickerTree(state.tree);
    const groupIds = collectTreeIds(tree);
    const groups = state.groups.filter((group) => groupIds.has(Number(group.id)));
    const groupById = App.groupMap(groups);
    const goods = state.goods.filter((good) => {
      const gid = good.group_id ? Number(good.group_id) : null;
      if (gid && !groupIds.has(gid)) return false;
      if (currentDocType() !== 2) return true;
      if (state.showZeroQtyOnOutgoing) return true;
      return Number(good.quantity || 0) > 0;
    });
    return { tree, goods, groupById };
  }

  function nextUid() {
    state.uidSeed += 1;
    return `l${Date.now()}_${state.uidSeed}`;
  }

  function currentDocType() {
    return Number(els.type.value || state.docType || 2);
  }

  function currentContragentId() {
    return els.contragent.value ? Number(els.contragent.value) : null;
  }

  function lineTotal(line) {
    return Number(line.quantity || 0) * Number(line.price || 0);
  }

  function docTotal() {
    return state.lines.reduce((sum, line) => sum + lineTotal(line), 0);
  }

  function normalizeLine(line) {
    return {
      uid: line.uid || nextUid(),
      good_id: Number(line.good_id),
      quantity: Number(line.quantity || 0),
      price: Number(line.price || 0),
      manualPrice: Boolean(line.manualPrice),
      good: line.good || state.goodsById.get(Number(line.good_id)) || null
    };
  }

  function buildLine(good, options = {}) {
    const basePrice = getDefaultPriceForGood(good);
    return normalizeLine({
      uid: nextUid(),
      good_id: good.id,
      quantity: options.quantity ?? 1,
      price: options.price ?? basePrice,
      manualPrice: options.manualPrice ?? false,
      good
    });
  }

  function getGroupForGood(good) {
    return state.groupById.get(Number(good?.group_id)) || null;
  }

  function getDefaultPriceForGood(good) {
    const group = getGroupForGood(good);
    if (!group) return 0;
    if (currentDocType() === 1) return Number(group.price_in || 0);
    return Number(group.price_out || 0);
  }

  function syncHeader() {
    const type = currentDocType();
    const isIncoming = type === 1;
    els.contragentSearch.placeholder = isIncoming ? "Search suppliers..." : "Search customers...";
    els.type.value = String(type);
    els.docNumberDisplay.textContent = state.docNum ? `#${state.docNum}` : "";
  }

  function pickerControlsHtml() {
    let html = `<button class="explorer-filter-btn${state.showInactiveGroups ? " active" : ""}" type="button" data-picker-filter="inactive">Inactive</button>`;
    if (currentDocType() === 2) {
      html += `<button class="explorer-filter-btn${state.showZeroQtyOnOutgoing ? " active" : ""}" type="button" data-picker-filter="zero-stock">Zero</button>`;
    }
    return html;
  }

  function renderTotal() {
    if (!els.saveBtn) return;
    els.saveBtn.textContent = App.fmtMoney(docTotal());
  }

  function lineParentLabel(good) {
    if (!good?.group_id) return "No group";
    const leaf = state.groupById.get(Number(good.group_id));
    if (!leaf) return "No group";
    const parent = leaf.parent_id ? state.groupById.get(Number(leaf.parent_id)) : null;
    if (!parent) return String(leaf.name || "No group");
    return `${parent.name || ""} > ${leaf.name || ""}`;
  }

  function renderLines() {
    if (!state.lines.length) {
      els.linesWrap.innerHTML = App.emptyState("No lines yet. Add a product.");
      renderTotal();
      return;
    }

    els.linesWrap.innerHTML = state.lines
      .map((line) => {
        const good = line.good || state.goodsById.get(Number(line.good_id));
        const parentLabel = lineParentLabel(good);
        return `
          <div class="line-card" data-line-uid="${App.escapeHtml(line.uid)}">
            <div class="line-top">
              <div class="line-title-wrap">
                <div class="line-title">${App.escapeHtml(good?.name || `#${line.good_id}`)}</div>
                <div class="line-parent">${App.escapeHtml(parentLabel)}</div>
              </div>
              <div class="line-top-right">
                <span class="money line-amount">${App.escapeHtml(App.fmtMoney(lineTotal(line)))}</span>
                <button class="btn btn-danger tiny line-remove-btn" type="button" data-remove-line="${App.escapeHtml(line.uid)}">Remove</button>
              </div>
            </div>
            <div class="line-fields">
              <label class="line-inline-field">
                <span class="line-inline-label">Qty</span>
                <input class="input line-inline-input" data-line-field="quantity" data-line-uid="${App.escapeHtml(line.uid)}" type="number" inputmode="decimal" step="0.01" min="0" value="${Number(line.quantity || 0)}">
              </label>
              <label class="line-inline-field">
                <span class="line-inline-label">Price</span>
                <div class="money-input line-inline-input-wrap">
                  <span class="money-prefix">$</span>
                  <input class="input money-value" data-line-field="price" data-line-uid="${App.escapeHtml(line.uid)}" type="number" inputmode="decimal" step="0.01" min="0" value="${Number(line.price || 0)}">
                </div>
              </label>
            </div>
          </div>
        `;
      })
      .join("");

    renderTotal();
  }

  function setLines(lines) {
    state.lines = (lines || []).map(normalizeLine).filter((l) => l.good_id && l.quantity > 0);
    renderLines();
  }

  function maybeRepriceLines(options = {}) {
    const force = Boolean(options.force);
    state.lines = state.lines.map((line) => {
      const good = line.good || state.goodsById.get(Number(line.good_id));
      if (!good) return line;
      const defaultPrice = getDefaultPriceForGood(good);
      const next = { ...line, good };
      if (force || !line.manualPrice) {
        next.price = defaultPrice;
        next.manualPrice = false;
      }
      return next;
    });
    renderLines();
  }

  function addGoodToLines(good, options = {}) {
    const quantity = Number(options.quantity ?? 1);
    const hasForcedPrice = options.price !== undefined && options.price !== null;
    const forcedPrice = hasForcedPrice ? Number(options.price || 0) : null;
    const alwaysNew = Boolean(options.alwaysNew);
    const existing = state.lines.find((line) => Number(line.good_id) === Number(good.id));
    if (existing && !alwaysNew) {
      existing.quantity = Number(existing.quantity || 0) + quantity;
      if (hasForcedPrice) {
        existing.price = forcedPrice;
        existing.manualPrice = true;
      } else if (!existing.manualPrice) {
        existing.price = getDefaultPriceForGood(good);
      }
      renderLines();
      App.toast("Quantity increased");
      return;
    }
    state.lines.push(
      buildLine(good, {
        quantity,
        ...(hasForcedPrice ? { price: forcedPrice, manualPrice: true } : {})
      })
    );
    renderLines();
  }

  function closeIncomingLineModal() {
    els.incomingLineModal?.classList.remove("open");
    els.incomingLineModal?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-lock");
  }

  function parsePositiveNumber(value) {
    const num = Number(String(value || "").replace(/[$,\s]/g, ""));
    return Number.isFinite(num) && num > 0 ? num : 0;
  }

  function focusAndSelectNumber(input) {
    if (!input) return;
    try {
      input.focus({ preventScroll: true });
    } catch (_err) {
      input.focus();
    }
    try {
      input.setSelectionRange(0, String(input.value || "").length);
    } catch (_err) {
      input.select();
    }
  }

  function requestIncomingLineDetails(good) {
    if (!els.incomingLineModal || !els.incomingLineForm) {
      const qtyText = window.prompt("Qty", "1");
      if (qtyText === null) return Promise.resolve(null);
      const priceText = window.prompt("Price", String(getDefaultPriceForGood(good) || ""));
      if (priceText === null) return Promise.resolve(null);
      return Promise.resolve({
        quantity: Number(qtyText),
        price: Number(priceText),
        manualPrice: true,
        alwaysNew: true
      });
    }

    return new Promise((resolve) => {
      const defaultPrice = getDefaultPriceForGood(good);
      els.incomingLineTitle.textContent = good?.name || "Add Item";
      els.incomingLineGroup.textContent = lineParentLabel(good);
      els.incomingLineQty.value = "1";
      els.incomingLinePrice.value = defaultPrice ? String(defaultPrice) : "";
      els.incomingLineModal.classList.add("open");
      els.incomingLineModal.setAttribute("aria-hidden", "false");
      document.body.classList.add("modal-lock");
      focusAndSelectNumber(els.incomingLineQty);

      const finish = (value) => {
        els.incomingLineForm.removeEventListener("submit", onSubmit);
        els.incomingLineCancel?.removeEventListener("click", onCancel);
        els.incomingLineModal.removeEventListener("click", onBackdrop);
        els.incomingLineQty?.removeEventListener("keydown", onKeyDown);
        els.incomingLinePrice?.removeEventListener("keydown", onKeyDown);
        closeIncomingLineModal();
        resolve(value);
      };
      const onCancel = () => finish(null);
      const onBackdrop = (event) => {
        if (event.target === els.incomingLineModal) finish(null);
      };
      const onSubmit = (event) => {
        event.preventDefault();
        const quantity = parsePositiveNumber(els.incomingLineQty.value);
        const price = parsePositiveNumber(els.incomingLinePrice.value);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          App.toast("Qty is required");
          focusAndSelectNumber(els.incomingLineQty);
          return;
        }
        if (!Number.isFinite(price) || price <= 0) {
          App.toast("Price is required");
          focusAndSelectNumber(els.incomingLinePrice);
          return;
        }
        finish({ quantity, price, manualPrice: true, alwaysNew: true });
      };
      const onKeyDown = (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (els.incomingLineForm.requestSubmit) {
          els.incomingLineForm.requestSubmit();
        } else {
          onSubmit(event);
        }
      };

      els.incomingLineForm.addEventListener("submit", onSubmit);
      els.incomingLineCancel?.addEventListener("click", onCancel);
      els.incomingLineModal.addEventListener("click", onBackdrop);
      els.incomingLineQty?.addEventListener("keydown", onKeyDown);
      els.incomingLinePrice?.addEventListener("keydown", onKeyDown);
      setTimeout(() => focusAndSelectNumber(els.incomingLineQty), 80);
    });
  }

  async function addGoodFromPicker(good, options = {}) {
    if (!good) return;
    if (currentDocType() === 1 && !options.skipIncomingPrompt) {
      const details = await requestIncomingLineDetails(good);
      if (!details) return;
      addGoodToLines(good, details);
      return;
    }
    addGoodToLines(good, options);
  }

  function pickerGoodRowHtml(g, metrics) {
    const qty = Number(metrics?.qty ?? g.quantity ?? 0);
    const cost = Number(metrics?.cost ?? qty * Number(g.avg_cost || 0));
    const value = Number(metrics?.value ?? 0);
    return `
      <div class="list-item compact-good">
        <div class="compact-good-row">
          <div class="compact-good-main">
            <span class="compact-good-name">${App.escapeHtml(g.name || "")}</span>
            <span class="compact-good-pair">${App.escapeHtml(App.fmtMoney0(cost))}/${App.escapeHtml(App.fmtMoney0(value))}</span>
          </div>
          <div class="compact-good-right">
            <span class="compact-good-qty">${App.escapeHtml(App.fmtNum(qty))}</span>
            <button class="btn btn-soft compact-good-add" type="button" data-add-good="${Number(g.id)}">Add</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderLinePicker() {
    const visible = buildVisiblePickerState();
    if (state.linePickerGroupId && !findNodeInTree(visible.tree, state.linePickerGroupId)) {
      state.linePickerGroupId = null;
    }
    App.renderGroupExplorer(
      els.linePickerExplorer,
      visible.tree,
      visible.goods,
      state.linePickerGroupId,
      visible.groupById,
      pickerGoodRowHtml,
      {
        controlsHtml: pickerControlsHtml(),
        metricsGoods: state.goods,
        metricsGroupsById: state.groupById
      }
    );
  }

  function shouldShowRecentCustomerCard() {
    return currentDocType() === 2 && Boolean(currentContragentId());
  }

  function renderRecentCustomerItems() {
    if (!els.recentCustomerCard || !els.recentCustomerList) return;
    const shouldShow = shouldShowRecentCustomerCard();
    els.recentCustomerCard.classList.toggle("hidden", !shouldShow);
    if (!shouldShow) return;

    const items = state.recentCustomerItems || [];
    if (!items.length) {
      els.recentCustomerList.innerHTML = App.emptyState("No recent outgoing items for this customer.");
      return;
    }

    els.recentCustomerList.innerHTML = items
      .map((item) => `
        <div class="list-item compact-good">
          <div class="compact-good-row">
            <div class="compact-good-main">
              <span class="compact-good-name">
                ${App.escapeHtml(item.good_name || `#${item.good_id}`)}
                ${item.group_name ? `<span class="compact-good-group-inline">${App.escapeHtml(item.group_name)}</span>` : ""}
              </span>
              <span class="compact-good-pair">${App.escapeHtml(App.fmtMoney(item.last_price || 0))}</span>
            </div>
            <div class="compact-good-right">
              <button class="btn btn-soft compact-good-add" type="button" data-recent-add-good="${Number(item.good_id)}" data-recent-add-price="${Number(item.last_price || 0)}">Add</button>
            </div>
          </div>
        </div>
      `)
      .join("");
  }

  async function loadRecentCustomerItems() {
    if (!shouldShowRecentCustomerCard()) {
      state.recentCustomerItems = [];
      renderRecentCustomerItems();
      return;
    }

    const contragentId = currentContragentId();
    const fetchSeq = ++state.recentFetchSeq;

    try {
      const data = await App.localData(`customer-recent-goods?contragent_id=${encodeURIComponent(contragentId)}&limit=10`);
      if (fetchSeq !== state.recentFetchSeq) return;
      state.recentCustomerItems = data.items || [];
    } catch (_err) {
      if (fetchSeq !== state.recentFetchSeq) return;
      state.recentCustomerItems = [];
    }

    renderRecentCustomerItems();
  }

  async function loadGroupsAndGoods() {
    const [groupsData, goodsData] = await Promise.all([
      App.localData("goods-groups"),
      App.localData("goods?limit=1000")
    ]);
    state.groups = (groupsData.groups || []).map((group) => ({ ...group, is_active: group.is_active !== false }));
    state.tree = normalizeGroupTree(groupsData.tree || []);
    state.groupById = App.groupMap(state.groups);
    state.goods = goodsData.goods || [];
    state.goodsById = new Map(state.goods.map((g) => [Number(g.id), g]));
    renderLinePicker();
  }

  async function loadContragents() {
    const type = currentDocType() === 1 ? 0 : 1;
    const data = await App.localData(`contragents?type=${type}`);
    state.contragents = data.contragents || [];
    // Keep selected contragent if still valid
    const prevId = els.contragent.value;
    if (prevId && !state.contragents.some((c) => String(c.id) === prevId)) {
      selectContragent(null);
    }
  }

  function selectContragent(c) {
    if (c) {
      els.contragent.value = String(c.id);
      els.contragentSearch.value = c.name;
    } else {
      els.contragent.value = "";
      els.contragentSearch.value = "";
    }
    els.contragentDropdown.classList.add("hidden");
    loadRecentCustomerItems();
  }

  function positionDropdown() {
    const rect = els.contragentSearch.getBoundingClientRect();
    const dd = els.contragentDropdown;
    dd.style.left = rect.left + "px";
    dd.style.width = rect.width + "px";
    dd.style.top = (rect.bottom + 4) + "px";
  }

  function renderContragentDropdown() {
    // Clear hidden id when user types (they haven't picked from list yet)
    els.contragent.value = "";
    const query = els.contragentSearch.value.trim().toLowerCase();
    if (!query) {
      els.contragentDropdown.classList.add("hidden");
      return;
    }
    const matches = state.contragents
      .filter((c) => String(c.name || "").toLowerCase().includes(query))
      .slice(0, 50);
    if (!matches.length) {
      els.contragentDropdown.innerHTML = '<div class="ctr-empty">No matches</div>';
    } else {
      els.contragentDropdown.innerHTML = matches
        .map((c) => `<div class="ctr-option" data-ctr-id="${Number(c.id)}">${App.escapeHtml(c.name)}</div>`)
        .join("");
    }
    positionDropdown();
    els.contragentDropdown.classList.remove("hidden");
  }

  async function loadDocumentIfEditing() {
    if (!state.docId) {
      syncHeader();
      els.metaCard.classList.add("hidden");
      return;
    }
    const data = await App.localData(`documents?id=${encodeURIComponent(state.docId)}`);
    const doc = data.document;
    if (!doc) throw new Error("Document not found");

    state.docType = Number(doc.doc_type || 2);
    els.type.value = String(state.docType);
    syncHeader();

    await loadContragents();
    els.date.value = doc.doc_date || App.todayISO();
    if (doc.contragent_id) {
      const c = state.contragents.find((x) => Number(x.id) === Number(doc.contragent_id));
      selectContragent(c || null);
    }

    state.docNum = doc.doc_num || null;
    els.docNumberDisplay.textContent = state.docNum ? `#${state.docNum}` : "";
    els.metaCard.classList.remove("hidden");

    const lines = (doc.lines || []).map((line) => {
      const good = line.good || state.goodsById.get(Number(line.good_id));
      return {
        uid: nextUid(),
        good_id: Number(line.good_id),
        quantity: Number(line.quantity || 0),
        price: Number(line.price || 0),
        manualPrice: true,
        good
      };
    });
    setLines(lines);
    await loadRecentCustomerItems();
  }

  function collectPayload() {
    const type = currentDocType();
    const contragentId = currentContragentId();
    const lines = state.lines
      .map((line) => ({
        good_id: Number(line.good_id),
        quantity: Number(line.quantity || 0),
        price: Number(line.price || 0)
      }))
      .filter((line) => line.good_id && line.quantity > 0);

    return {
      doc_type: type,
      doc_date: els.date.value,
      contragent_id: contragentId,
      description: null,
      lines
    };
  }

  async function saveDocument() {
    const wasEdit = Boolean(state.docId);
    const payload = collectPayload();
    if (!payload.doc_date) return App.toast("Date is required");
    if (currentDocType() === 1 && !payload.contragent_id) return App.toast("Supplier is required");
    if (!payload.lines.length) return App.toast("Add at least one line");

    App.setLoading(els.saveBtn, true);
    try {
      const result = state.docId
        ? await App.localData("documents", { method: "PUT", body: { doc_id: state.docId, ...payload } })
        : await App.localData("documents", { method: "POST", body: payload });

      const savedDoc = result.document;
      if (savedDoc) {
        state.docId = Number(savedDoc.id);
        state.docNum = savedDoc.doc_num;
        els.docId.value = String(state.docId);
        els.metaCard.classList.remove("hidden");
        els.docNumberDisplay.textContent = state.docNum ? `#${state.docNum}` : "";
      }

      App.toast(wasEdit ? "Document saved" : "Document created");
      window.location.href = new URL("index.html", window.location.href).href;
      return;
    } catch (err) {
      App.toast(err.message || "Failed to save document");
    } finally {
      App.setLoading(els.saveBtn, false);
    }
  }

  async function deleteDocument() {
    if (!state.docId) return;
    if (!window.confirm("Delete this document? Stock and costs will be reversed.")) return;
    try {
      await App.localData(`documents?id=${encodeURIComponent(state.docId)}`, { method: "DELETE" });
      App.toast("Document deleted");
      window.location.href = "documents.html";
    } catch (err) {
      App.toast(err.message || "Failed to delete document");
    }
  }

  els.linesWrap?.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove-line]");
    if (!removeBtn) return;
    const uid = removeBtn.dataset.removeLine;
    state.lines = state.lines.filter((line) => line.uid !== uid);
    renderLines();
  });

  els.linesWrap?.addEventListener("change", (e) => {
    const input = e.target.closest("[data-line-field][data-line-uid]");
    if (!input) return;
    const uid = input.dataset.lineUid;
    const field = input.dataset.lineField;
    const line = state.lines.find((l) => l.uid === uid);
    if (!line) return;
    line[field] = Number(input.value || 0);
    if (field === "price") line.manualPrice = true;
    renderLines();
  });

  els.linePickerExplorer?.addEventListener("click", async (e) => {
    const filterBtn = e.target.closest("[data-picker-filter]");
    if (filterBtn) {
      const key = filterBtn.dataset.pickerFilter;
      if (key === "inactive") {
        state.showInactiveGroups = !state.showInactiveGroups;
      } else if (key === "zero-stock") {
        state.showZeroQtyOnOutgoing = !state.showZeroQtyOnOutgoing;
      }
      renderLinePicker();
      return;
    }

    const addBtn = e.target.closest("[data-add-good]");
    if (addBtn) {
      const good = state.goodsById.get(Number(addBtn.dataset.addGood));
      await addGoodFromPicker(good);
      return;
    }
    const folder = e.target.closest("[data-drill-group]");
    if (folder) {
      state.linePickerGroupId = Number(folder.dataset.drillGroup);
      renderLinePicker();
      return;
    }
    const crumb = e.target.closest("[data-crumb-id]");
    if (crumb) {
      const val = crumb.dataset.crumbId;
      state.linePickerGroupId = val ? Number(val) : null;
      renderLinePicker();
    }
  });

  els.recentCustomerList?.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-recent-add-good]");
    if (!addBtn) return;
    const good = state.goodsById.get(Number(addBtn.dataset.recentAddGood));
    if (!good) return;
    addGoodToLines(good, { price: Number(addBtn.dataset.recentAddPrice || 0) });
  });

  els.type?.addEventListener("change", async () => {
    state.docType = Number(els.type.value || 2);
    syncHeader();
    try {
      await loadContragents();
      maybeRepriceLines({ force: true });
      renderLinePicker();
      await loadRecentCustomerItems();
    } catch (err) {
      App.toast(err.message || "Failed to update type");
    }
  });

  els.contragentSearch?.addEventListener("input", App.debounce(renderContragentDropdown, 120));
  els.contragentSearch?.addEventListener("focus", () => {
    if (els.contragentSearch.value.trim()) renderContragentDropdown();
  });
  els.contragentDropdown?.addEventListener("click", (e) => {
    const opt = e.target.closest("[data-ctr-id]");
    if (!opt) return;
    const c = state.contragents.find((x) => Number(x.id) === Number(opt.dataset.ctrId));
    if (c) selectContragent(c);
  });
  // Clear selection if user empties the search box
  els.contragentSearch?.addEventListener("change", () => {
    if (!els.contragentSearch.value.trim()) selectContragent(null);
  });
  // Toggle numeric ↔ text keyboard
  els.kbdToggle?.addEventListener("click", () => {
    const isNumeric = els.contragentSearch.inputMode === "numeric";
    els.contragentSearch.inputMode = isNumeric ? "text" : "numeric";
    els.kbdToggle.textContent = isNumeric ? "ABC" : "123";
    els.kbdToggle.classList.toggle("active", !isNumeric);
    els.contragentSearch.placeholder = isNumeric ? "Search by name..." : "Search by #...";
    els.contragentSearch.blur();
    requestAnimationFrame(() => els.contragentSearch.focus());
  });
  // Close dropdown on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".contragent-search-wrap") && !e.target.closest(".contragent-dropdown")) {
      els.contragentDropdown?.classList.add("hidden");
    }
  });

  els.saveBtn?.addEventListener("click", saveDocument);
  els.deleteBtn?.addEventListener("click", deleteDocument);

  async function init() {
    els.type.value = String(state.docType);
    syncHeader();

    if (!state.docId) {
      // Show the empty-line state immediately for new documents.
      setLines([]);
      await Promise.all([loadGroupsAndGoods(), loadContragents()]);
      syncHeader();
      renderLinePicker();
      await loadRecentCustomerItems();
      return;
    }

    await loadGroupsAndGoods();
    await loadDocumentIfEditing();
    renderLinePicker();
  }

  init().catch((err) => {
    App.toast(err.message || "Failed to load document form");
    setLines([]);
  });
});
