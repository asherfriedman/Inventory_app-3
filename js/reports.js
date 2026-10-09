window.InventoryApp.defineView("reports", (ctx) => {
  const App = window.InventoryApp;
  const VIEW_KEY = "inventory_reports_view_v1";
  const els = {
    rangeLabel: App.qs("#rangeLabel"),
    rangeChips: App.qs("#rangeChips"),
    customRange: App.qs("#customRange"),
    dateFrom: App.qs("#reportDateFrom"),
    dateTo: App.qs("#reportDateTo"),
    tabs: App.qs("#reportTypeTabs"),
    table: App.qs("#reportTableWrap")
  };
  const sumEls = App.qsa("[data-sum]").reduce((acc, el) => ((acc[el.dataset.sum] = el), acc), {});
  const state = { range: "month", type: "summary" };

  try {
    const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY) || "{}");
    if (saved.range) state.range = saved.range;
    if (saved.type) state.type = saved.type;
    if (saved.from) els.dateFrom.value = saved.from;
    if (saved.to) els.dateTo.value = saved.to;
  } catch {
    // ignore
  }

  function rangeDates(range) {
    const now = new Date();
    const today = App.todayISO();
    if (range === "today") return [today, today];
    if (range === "week") {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
      return [App.toISO(d), today];
    }
    if (range === "last-month") {
      return [App.toISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)), App.toISO(new Date(now.getFullYear(), now.getMonth(), 0))];
    }
    if (range === "year") return [`${now.getFullYear()}-01-01`, today];
    if (range === "custom") return [els.dateFrom.value || App.startOfMonthISO(), els.dateTo.value || today];
    return [App.startOfMonthISO(), today];
  }

  function money(v) {
    return App.escapeHtml(App.fmtMoney(v || 0));
  }

  function table(head, rows, totalRow) {
    return `<table class="table"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}${totalRow || ""}</tbody></table>`;
  }

  function renderTable(data) {
    const rows = data.rows || [];
    if (state.type === "inventory_value") {
      if (!rows.length) return (els.table.innerHTML = App.emptyState("No stock on hand."));
      els.table.innerHTML = table(["Group", "Qty", "Value at cost"],
        rows.map((r) => `<tr><td>${App.escapeHtml(r.group_name)}</td><td class="num">${App.fmtNum(r.total_qty)}</td><td class="num">${money(r.total_value)}</td></tr>`),
        `<tr class="total-row"><td>Total</td><td class="num"></td><td class="num">${money(data.grand_total)}</td></tr>`);
      return;
    }
    if (!rows.length) return (els.table.innerHTML = App.emptyState("No sales in this period."));
    if (state.type === "summary") {
      els.table.innerHTML = table(["Day", "Sales", "Revenue", "Profit"],
        rows.map((r) => `<tr><td>${App.escapeHtml(App.dayLabel(r.date))}</td><td class="num">${r.count_docs}</td><td class="num">${money(r.revenue)}</td><td class="num">${money(r.profit)}</td></tr>`));
      return;
    }
    const label = state.type === "by_customer" ? "contragent_name" : "group_name";
    els.table.innerHTML = table([state.type === "by_customer" ? "Customer" : "Group", "Revenue", "Profit", "Margin"],
      rows.map((r) => `<tr><td>${App.escapeHtml(r[label] || "")}</td><td class="num">${money(r.revenue)}</td><td class="num">${money(r.profit)}</td><td class="num">${Number(r.margin_pct || 0).toFixed(1)}%</td></tr>`));
  }

  async function load() {
    const [from, to] = rangeDates(state.range);
    App.qsa("[data-range]", els.rangeChips).forEach((b) => b.classList.toggle("active", b.dataset.range === state.range));
    const activeChip = els.rangeChips.querySelector(".chip.active");
    if (activeChip) els.rangeChips.scrollLeft = Math.max(0, activeChip.offsetLeft - els.rangeChips.clientWidth / 2 + activeChip.offsetWidth / 2);
    App.qsa("button", els.tabs).forEach((b) => b.classList.toggle("active", b.dataset.type === state.type));
    els.customRange.classList.toggle("hidden", state.range !== "custom");
    if (state.range !== "custom") {
      els.dateFrom.value = from;
      els.dateTo.value = to;
    }
    els.rangeLabel.textContent = from === to ? App.humanDate(from) : `${App.shortDate(from)} – ${App.shortDate(to)}`;
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ range: state.range, type: state.type, from: els.dateFrom.value, to: els.dateTo.value }));

    try {
      const params = new URLSearchParams({ type: "summary", date_from: from, date_to: to });
      const summaryData = await App.localData(`reports?${params}`);
      const s = summaryData.summary || {};
      sumEls.revenue.textContent = App.fmtMoney(s.revenue);
      sumEls.count_docs.textContent = `${summaryData.count_docs || 0} sale${summaryData.count_docs === 1 ? "" : "s"} · cost ${App.fmtMoney(s.cost)}`;
      sumEls.profit.textContent = App.fmtMoney(s.profit);
      sumEls.margin_pct.textContent = `${Number(s.margin_pct || 0).toFixed(1)}% margin`;
      const data = state.type === "summary" ? summaryData : await App.localData(`reports?${new URLSearchParams({ type: state.type, date_from: from, date_to: to })}`);
      renderTable(data);
    } catch (err) {
      els.table.innerHTML = App.emptyState(err.message || "Failed to load report");
    }
  }

  els.rangeChips.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-range]");
    if (!chip) return;
    state.range = chip.dataset.range;
    load();
  });
  els.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn) return;
    state.type = btn.dataset.type;
    load();
  });
  [els.dateFrom, els.dateTo].forEach((el) => el.addEventListener("change", load));

  load();
});
