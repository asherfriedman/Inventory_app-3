window.InventoryApp.defineView("count", (ctx) => {
  const App = window.InventoryApp;
  const SESSION_KEY = "inventory_count_session_v1";
  const els = {
    progressText: App.qs("#countProgressText"),
    progressBar: App.qs("#progressBar"),
    search: App.qs("#countSearch"),
    filter: App.qs("#countFilter"),
    chips: App.qs("#countChips"),
    list: App.qs("#countList"),
    finishBtn: App.qs("#finishBtn"),
    finishModal: App.qs("#finishModal"),
    finishSummary: App.qs("#finishSummary"),
    finishConfirm: App.qs("#finishConfirm")
  };

  const state = {
    goods: [],
    goodsById: new Map(),
    groupById: new Map(),
    filter: "all",
    showInactive: false,
    skipZero: false,
    session: loadSession()
  };

  // The count session (what's been counted and what the system said before)
  // lives on the phone so it survives closing the app mid-count.
  function loadSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && s.items) return s;
    } catch {
      // ignore
    }
    return { startedAt: null, items: {} };
  }

  function saveSession() {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
  }

  function parseCount(value) {
    const text = String(value ?? "").replace(/[,\s]/g, "");
    if (text === "") return null;
    const n = Number(text);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  }

  function inScope(good) {
    const group = good.group_id ? state.groupById.get(Number(good.group_id)) : null;
    if (!state.showInactive && group && !isGroupActive(group)) return false;
    if (state.skipZero && Number(good.quantity || 0) <= 0 && !state.session.items[good.id]) return false;
    return true;
  }

  function isGroupActive(group) {
    let cur = group;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      if (cur.is_active === false) return false;
      seen.add(cur.id);
      cur = cur.parent_id ? state.groupById.get(Number(cur.parent_id)) : null;
    }
    return true;
  }

  function statusFor(goodId) {
    const item = state.session.items[goodId];
    if (!item) return { counted: false, diff: 0 };
    return { counted: true, diff: Number(item.qty) - Number(item.was) };
  }

  function rowHtml(good) {
    const item = state.session.items[good.id];
    const { counted, diff } = statusFor(good.id);
    const sub = counted
      ? (diff ? `Was ${App.fmtNum(item.was)} → now ${App.fmtNum(item.qty)}` : `Matches (${App.fmtNum(item.qty)})`)
      : `System ${App.fmtNum(good.quantity)}`;
    const statusText = counted ? (diff ? App.fmtSigned(diff) : "✓") : "";
    const statusClass = counted ? (diff > 0 ? "pos" : diff < 0 ? "neg" : "pos") : "";
    return `
      <div class="row-item count-row${counted ? " counted" : ""}" data-good-id="${Number(good.id)}">
        <div class="row-main">
          <div class="row-title">${App.escapeHtml(good.name)}</div>
          <div class="row-sub" data-sub>${App.escapeHtml(sub)}</div>
        </div>
        <span class="count-status ${statusClass}" data-status>${statusText}</span>
        <button class="match-btn${counted ? " hidden" : ""}" type="button" data-match aria-label="Matches system">${App.icon("check")}</button>
        <input class="input count-input" data-count-input type="text" inputmode="decimal" enterkeyhint="next"
          value="${counted ? App.escapeHtml(String(item.qty)) : ""}" placeholder="–" aria-label="Counted ${App.escapeHtml(good.name)}">
      </div>`;
  }

  function render() {
    const q = els.search.value.trim();
    let goods = q ? App.searchProducts(state.goods, q, 500) : state.goods.slice();
    goods = goods.filter(inScope);
    if (state.filter === "todo") goods = goods.filter((g) => !state.session.items[g.id]);
    if (state.filter === "diff") goods = goods.filter((g) => statusFor(g.id).counted && statusFor(g.id).diff !== 0);

    // Group into sections by product group, in catalog order.
    const sections = new Map();
    for (const good of goods) {
      const path = App.groupPath(good.group_id, state.groupById) || "No group";
      if (!sections.has(path)) sections.set(path, []);
      sections.get(path).push(good);
    }
    const ordered = [...sections.entries()].sort((a, b) => {
      if (a[0] === "No group") return 1;
      if (b[0] === "No group") return -1;
      return a[0].localeCompare(b[0]);
    });

    els.list.innerHTML = ordered.length ? ordered.map(([path, items]) => {
      items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const done = items.filter((g) => state.session.items[g.id]).length;
      return `
        <div>
          <div class="section-title" style="margin-bottom:6px"><span>${App.escapeHtml(path)}</span><span data-section-count>${done}/${items.length}</span></div>
          <section class="card flush"><div class="rows">${items.map(rowHtml).join("")}</div></section>
        </div>`;
    }).join("") : `<div class="card">${App.emptyState(state.filter === "diff" ? "No differences yet." : state.filter === "todo" ? "Everything here is counted." : "No products match.")}</div>`;

    renderChips();
    renderProgress();
  }

  function renderChips() {
    els.chips.innerHTML = [
      `<button class="chip${state.skipZero ? " active" : ""}" type="button" data-chip="zero">Skip 0 in system</button>`,
      `<button class="chip${state.showInactive ? " active" : ""}" type="button" data-chip="inactive">Inactive groups</button>`
    ].join("");
  }

  function renderProgress() {
    const scope = state.goods.filter(inScope);
    const done = scope.filter((g) => state.session.items[g.id]).length;
    const pct = scope.length ? Math.round((done / scope.length) * 100) : 0;
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = `${done} of ${scope.length} counted`;
  }

  function refreshRow(goodId) {
    const row = els.list.querySelector(`[data-good-id="${goodId}"]`);
    const good = state.goodsById.get(Number(goodId));
    if (!row || !good) return;
    const input = row.querySelector("[data-count-input]");
    const holder = document.createElement("div");
    holder.innerHTML = rowHtml(good);
    const fresh = holder.firstElementChild;
    // Swap the text parts only, so focus in the input is never lost.
    row.className = fresh.className;
    row.querySelector("[data-sub]").textContent = fresh.querySelector("[data-sub]").textContent;
    const status = row.querySelector("[data-status]");
    const freshStatus = fresh.querySelector("[data-status]");
    status.className = freshStatus.className;
    status.textContent = freshStatus.textContent;
    row.querySelector("[data-match]").className = fresh.querySelector("[data-match]").className;
    if (document.activeElement !== input) input.value = fresh.querySelector("[data-count-input]").value;
    const section = row.closest(".rows");
    const counter = section?.parentElement?.previousElementSibling?.querySelector("[data-section-count]");
    if (counter) counter.textContent = `${section.querySelectorAll(".count-row.counted").length}/${section.querySelectorAll(".count-row").length}`;
    renderProgress();
  }

  async function saveCount(input) {
    const row = input.closest("[data-good-id]");
    const goodId = Number(row.dataset.goodId);
    const good = state.goodsById.get(goodId);
    if (!good) return;
    const existing = state.session.items[goodId];
    const counted = parseCount(input.value);

    if (counted === null) {
      // Cleared: take back the change this count made.
      if (!existing) return;
      try {
        const target = Math.max(0, Number(good.quantity || 0) - (Number(existing.qty) - Number(existing.was)));
        const result = await App.localData("stock-adjust", { method: "POST", body: { good_id: goodId, counted: target } });
        good.quantity = Number(result.good?.quantity ?? target);
        delete state.session.items[goodId];
        saveSession();
        refreshRow(goodId);
      } catch (err) {
        App.toast(err.message || "Undo failed");
      }
      return;
    }
    if (Number.isNaN(counted)) {
      App.toast("Enter a number (0 or more)");
      input.value = existing ? String(existing.qty) : "";
      return;
    }
    if (existing && Number(existing.qty) === counted) return;

    try {
      const was = existing ? existing.was : Number(good.quantity || 0);
      const result = await App.localData("stock-adjust", { method: "POST", body: { good_id: goodId, counted } });
      good.quantity = Number(result.good?.quantity ?? counted);
      if (!state.session.startedAt) state.session.startedAt = Date.now();
      state.session.items[goodId] = { qty: counted, was };
      saveSession();
      refreshRow(goodId);
    } catch (err) {
      App.toast(err.message || "Failed to save count");
    }
  }

  function focusNext(input) {
    const inputs = App.qsa("[data-count-input]", els.list);
    const next = inputs[inputs.indexOf(input) + 1];
    if (next) {
      next.focus();
      next.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      input.blur();
    }
  }

  function openFinish() {
    const items = Object.entries(state.session.items);
    const diffs = items.filter(([, it]) => Number(it.qty) !== Number(it.was));
    let units = 0;
    let value = 0;
    for (const [goodId, it] of diffs) {
      const d = Number(it.qty) - Number(it.was);
      units += d;
      value += d * Number(state.goodsById.get(Number(goodId))?.avg_cost || 0);
    }
    const scope = state.goods.filter(inScope);
    const rows = [
      ["Counted", `${items.length} of ${scope.length}`],
      ["Items with a difference", String(diffs.length)],
      ["Net units", App.fmtSigned(units)],
      ["Value change (at cost)", App.fmtMoneySigned(value)]
    ];
    els.finishSummary.innerHTML = rows.map(([label, val]) => `
      <div class="row-item"><div class="row-main"><div class="row-title">${App.escapeHtml(label)}</div></div><span class="row-value">${App.escapeHtml(val)}</span></div>`).join("");
    App.openModal(els.finishModal);
  }

  els.list.addEventListener("change", (e) => {
    const input = e.target.closest("[data-count-input]");
    if (input) saveCount(input);
  });
  // One tap: the shelf matches the system quantity.
  els.list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-match]");
    if (!btn) return;
    const row = btn.closest("[data-good-id]");
    const good = state.goodsById.get(Number(row.dataset.goodId));
    const input = row.querySelector("[data-count-input]");
    input.value = String(Number(good?.quantity || 0));
    saveCount(input);
  });
  els.list.addEventListener("keydown", (e) => {
    const input = e.target.closest("[data-count-input]");
    if (!input || e.key !== "Enter") return;
    e.preventDefault();
    focusNext(input);
  });
  els.filter.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    App.qsa("button", els.filter).forEach((b) => b.classList.toggle("active", b === btn));
    render();
  });
  els.chips.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-chip]");
    if (!chip) return;
    if (chip.dataset.chip === "zero") state.skipZero = !state.skipZero;
    if (chip.dataset.chip === "inactive") state.showInactive = !state.showInactive;
    render();
  });
  els.search.addEventListener("input", App.debounce(render, 150));
  els.finishBtn.addEventListener("click", openFinish);
  els.finishConfirm.addEventListener("click", () => {
    const n = Object.keys(state.session.items).length;
    state.session = { startedAt: null, items: {} };
    saveSession();
    App.closeModal(els.finishModal);
    App.flash(n ? `Count finished: ${n} item${n === 1 ? "" : "s"} counted` : "Count cleared");
    // Land on the adjustments list so the result can be reviewed.
    sessionStorage.setItem("inventory_docs_filter_v1", JSON.stringify({ type: "3", search: "" }));
    App.go("documents.html");
  });

  (async () => {
    const [groupsData, goodsData] = await Promise.all([App.localData("goods-groups"), App.localData("goods")]);
    state.groupById = App.groupMap(groupsData.groups || []);
    state.goods = goodsData.goods || [];
    state.goodsById = new Map(state.goods.map((g) => [Number(g.id), g]));
    render();
  })().catch((err) => App.toast(err.message || "Failed to load products"));
});
