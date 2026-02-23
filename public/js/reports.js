document.addEventListener("DOMContentLoaded", () => {
  const App = window.InventoryApp;
  const dateFrom = App.qs("#reportDateFrom");
  const dateTo = App.qs("#reportDateTo");
  const tabsWrap = App.qs("#reportTypeTabs");
  const refreshBtn = App.qs("#reportRefreshBtn");
  const tableWrap = App.qs("#reportTableWrap");
  const titleEl = App.qs("#reportTableTitle");
  const summaryEls = App.qsa("[data-sum]").reduce((acc, el) => ((acc[el.dataset.sum] = el), acc), {});
  let activeType = "summary";

  if (!dateFrom.value) dateFrom.value = App.startOfMonthISO();
  if (!dateTo.value) dateTo.value = App.todayISO();

  function setSummary(summary) {
    const s = summary || {};
    if (summaryEls.revenue) summaryEls.revenue.textContent = App.fmtMoney(s.revenue || 0);
    if (summaryEls.cost) summaryEls.cost.textContent = App.fmtMoney(s.cost || 0);
    if (summaryEls.profit) summaryEls.profit.textContent = App.fmtMoney(s.profit || 0);
    if (summaryEls.margin_pct) summaryEls.margin_pct.textContent = `${Number(s.margin_pct || 0).toFixed(1)}%`;
  }

  function renderTable(data) {
    if (activeType === "summary") {
      titleEl.textContent = "Summary";
      tableWrap.innerHTML = `<div class="empty">Summary view uses the cards above.</div>`;
      return;
    }

    if (activeType === "inventory_value") {
      titleEl.textContent = "Inventory Value by Group";
      const rows = data.rows || [];
      if (!rows.length) {
        tableWrap.innerHTML = App.emptyState("No inventory in stock.");
        return;
      }
      tableWrap.innerHTML = `
        <table class="table">
          <thead><tr><th>Group</th><th class="right">Qty</th><th class="right">Value</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `<tr>
                  <td>${App.escapeHtml(r.group_name || "")}</td>
                  <td class="right">${App.escapeHtml(App.fmtNum(r.total_qty || 0))}</td>
                  <td class="right money">${App.escapeHtml(App.fmtMoney(r.total_value || 0))}</td>
                </tr>`
              )
              .join("")}
            <tr>
              <td><strong>Grand Total</strong></td>
              <td></td>
              <td class="right money"><strong>${App.escapeHtml(App.fmtMoney(data.grand_total || 0))}</strong></td>
            </tr>
          </tbody>
        </table>
      `;
      return;
    }

    const rows = data.rows || [];
    titleEl.textContent = activeType === "by_customer" ? "Profit by Customer" : "Profit by Group";
    if (!rows.length) {
      tableWrap.innerHTML = App.emptyState("No outgoing sales in this date range.");
      return;
    }
    const labelKey = activeType === "by_customer" ? "contragent_name" : "group_name";
    tableWrap.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>${activeType === "by_customer" ? "Customer" : "Group"}</th>
            <th class="right">Revenue</th>
            <th class="right">Cost</th>
            <th class="right">Profit</th>
            <th class="right">Margin %</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
                <td>${App.escapeHtml(r[labelKey] || "")}</td>
                <td class="right money">${App.escapeHtml(App.fmtMoney(r.revenue || 0))}</td>
                <td class="right money">${App.escapeHtml(App.fmtMoney(r.cost || 0))}</td>
                <td class="right money">${App.escapeHtml(App.fmtMoney(r.profit || 0))}</td>
                <td class="right">${App.escapeHtml(Number(r.margin_pct || 0).toFixed(1))}%</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  async function load() {
    App.setLoading(refreshBtn, true);
    try {
      const params = new URLSearchParams({ type: activeType });
      if (dateFrom.value) params.set("date_from", dateFrom.value);
      if (dateTo.value) params.set("date_to", dateTo.value);
      const data = await App.api(`/api/reports?${params.toString()}`);
      setSummary(data.summary);
      renderTable(data);
    } catch (err) {
      tableWrap.innerHTML = App.emptyState(err.message || "Failed to load report");
    } finally {
      App.setLoading(refreshBtn, false);
    }
  }

  tabsWrap?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn) return;
    activeType = btn.dataset.type;
    App.qsa("button[data-type]", tabsWrap).forEach((b) => b.classList.toggle("active", b === btn));
    load();
  });

  [dateFrom, dateTo].forEach((el) => el?.addEventListener("change", load));
  refreshBtn?.addEventListener("click", load);

  load();
});
