document.addEventListener("DOMContentLoaded", () => {
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
    contragentLabel: App.qs("#contragentLabel"),
    kbdToggle: App.qs("#kbdToggle"),
    linesWrap: App.qs("#documentLines"),
    total: App.qs("#documentTotal"),
    saveBtn: App.qs("#documentSaveBtn"),
    deleteBtn: App.qs("#documentDeleteBtn"),
    metaCard: App.qs("#docMetaCard"),
    docNumberDisplay: App.qs("#docNumberDisplay"),
    linePickerPanel: App.qs("#linePickerPanel"),
    openAddLineBtn: App.qs("#openAddLineBtn"),
    closeAddLineBtn: App.qs("#closeAddLineBtn"),
    linePickerSearch: App.qs("#linePickerSearch"),
    linePickerExplorer: App.qs("#linePickerExplorer")
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
    uidSeed: 1
  };

  if (!els.date.value) els.date.value = App.todayISO();

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
    els.contragentLabel.textContent = isIncoming ? "Supplier" : "Customer";
    els.contragentSearch.placeholder = isIncoming ? "Search suppliers..." : "Search customers...";
    els.type.value = String(type);
    if (state.docNum) {
      els.docNumberDisplay.textContent = `#${state.docNum}`;
    }
  }

  function renderTotal() {
    els.total.textContent = App.fmtMoney(docTotal());
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
        const groupPath = good ? App.groupPath(good.group_id, state.groupById) : "";
        return `
          <div class="line-card" data-line-uid="${App.escapeHtml(line.uid)}">
            <div class="row between">
              <div>
                <div class="list-item-title">${App.escapeHtml(good?.name || `#${line.good_id}`)}</div>
                <div class="list-item-sub">${App.escapeHtml(groupPath || "No group")} ${currentDocType() === 2 ? `· stock ${App.escapeHtml(App.fmtNum(good?.quantity || 0))}` : ""}</div>
              </div>
              <button class="btn btn-danger tiny" type="button" data-remove-line="${App.escapeHtml(line.uid)}">Remove</button>
            </div>
            <div class="line-fields">
              <label class="label">Qty
                <input class="input" data-line-field="quantity" data-line-uid="${App.escapeHtml(line.uid)}" type="number" inputmode="decimal" step="0.01" min="0" value="${Number(line.quantity || 0)}">
              </label>
              <label class="label">Price
                <input class="input" data-line-field="price" data-line-uid="${App.escapeHtml(line.uid)}" type="number" inputmode="decimal" step="0.01" min="0" value="${Number(line.price || 0)}">
              </label>
            </div>
            <div class="sum-row">
              <span class="tiny muted">Line total</span>
              <span class="money">${App.escapeHtml(App.fmtMoney(lineTotal(line)))}</span>
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

  function addGoodToLines(good) {
    const existing = state.lines.find((line) => Number(line.good_id) === Number(good.id));
    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + 1;
      if (!existing.manualPrice) {
        existing.price = getDefaultPriceForGood(good);
      }
      renderLines();
      App.toast("Quantity increased");
      return;
    }
    state.lines.push(buildLine(good));
    renderLines();
  }

  function pickerGoodRowHtml(g) {
    const defaultPrice = getDefaultPriceForGood(g);
    return `
      <div class="list-item">
        <div class="row between">
          <div>
            <div class="list-item-title">${App.escapeHtml(g.name || "")}</div>
            <div class="list-item-sub">${App.escapeHtml(g.group_path || "")}</div>
            <div class="list-item-sub">${currentDocType() === 1 ? "Buy" : "Sell"} default: ${App.escapeHtml(App.fmtMoney(defaultPrice))}${currentDocType() === 2 ? ` · stock ${App.escapeHtml(App.fmtNum(g.quantity || 0))}` : ""}</div>
          </div>
          <button class="btn btn-soft" type="button" data-add-good="${Number(g.id)}">Add</button>
        </div>
      </div>
    `;
  }

  function renderLinePicker() {
    const query = els.linePickerSearch.value.trim();
    App.renderGroupExplorer(els.linePickerExplorer, state.tree, state.goods, state.linePickerGroupId, state.groupById, pickerGoodRowHtml, query);
  }

  async function loadGroupsAndGoods() {
    const [groupsData, goodsData] = await Promise.all([
      App.api("/api/goods-groups"),
      App.api("/api/goods?limit=1000")
    ]);
    state.groups = groupsData.groups || [];
    state.tree = groupsData.tree || [];
    state.groupById = App.groupMap(state.groups);
    state.goods = goodsData.goods || [];
    state.goodsById = new Map(state.goods.map((g) => [Number(g.id), g]));
    renderLinePicker();
  }

  async function loadContragents() {
    const type = currentDocType() === 1 ? 0 : 1;
    const data = await App.api(`/api/contragents?type=${type}`);
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
    const data = await App.api(`/api/documents?id=${encodeURIComponent(state.docId)}`);
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
    if (!payload.contragent_id) return App.toast(currentDocType() === 1 ? "Supplier is required" : "Customer is required");
    if (!payload.lines.length) return App.toast("Add at least one line");

    App.setLoading(els.saveBtn, true);
    try {
      const result = state.docId
        ? await App.api("/api/documents", { method: "PUT", body: { doc_id: state.docId, ...payload } })
        : await App.api("/api/documents", { method: "POST", body: payload });

      const savedDoc = result.document;
      if (savedDoc) {
        state.docId = Number(savedDoc.id);
        state.docNum = savedDoc.doc_num;
        els.docId.value = String(state.docId);
        els.metaCard.classList.remove("hidden");
        els.docNumberDisplay.textContent = state.docNum ? `#${state.docNum}` : "";
      }

      App.toast(wasEdit ? "Document saved" : "Document created");

      if (!params.get("id") && state.docId) {
        window.location.replace(`/document-form.html?id=${encodeURIComponent(state.docId)}`);
        return;
      }

      if (savedDoc?.lines) {
        setLines(
          savedDoc.lines.map((line) => ({
            uid: nextUid(),
            good_id: Number(line.good_id),
            quantity: Number(line.quantity || 0),
            price: Number(line.price || 0),
            manualPrice: true,
            good: line.good || state.goodsById.get(Number(line.good_id))
          }))
        );
      }

      syncHeader();
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
      await App.api(`/api/documents?id=${encodeURIComponent(state.docId)}`, { method: "DELETE" });
      App.toast("Document deleted");
      window.location.href = "/documents.html";
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

  els.openAddLineBtn?.addEventListener("click", () => {
    state.linePickerGroupId = null;
    els.linePickerSearch.value = "";
    els.linePickerPanel.classList.remove("hidden");
    renderLinePicker();
  });
  els.closeAddLineBtn?.addEventListener("click", () => els.linePickerPanel.classList.add("hidden"));
  els.linePickerSearch?.addEventListener("input", App.debounce(renderLinePicker, 160));
  els.linePickerExplorer?.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add-good]");
    if (addBtn) {
      const good = state.goodsById.get(Number(addBtn.dataset.addGood));
      if (good) addGoodToLines(good);
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

  els.type?.addEventListener("change", async () => {
    state.docType = Number(els.type.value || 2);
    syncHeader();
    try {
      await loadContragents();
      maybeRepriceLines({ force: true });
      renderLinePicker();
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
    els.contragentSearch.focus();
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
    await loadGroupsAndGoods();

    if (state.docId) {
      await loadDocumentIfEditing();
    } else {
      await loadContragents();
      syncHeader();
      setLines([]);
    }

    renderLinePicker();
  }

  init().catch((err) => {
    App.toast(err.message || "Failed to load document form");
    setLines([]);
  });
});
