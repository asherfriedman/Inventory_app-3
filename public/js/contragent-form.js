window.InventoryApp.defineView("contragent-form", (ctx) => {
  const App = window.InventoryApp;
  const params = App.queryParams();
  const id = Number(params.get("id") || 0) || null;

  const els = {
    title: App.qs("#contragentFormTitle"),
    editBtn: App.qs("#editBtn"),
    summary: App.qs("#summaryCard"),
    summaryName: App.qs("#summaryName"),
    summaryPhone: App.qs("#summaryPhone"),
    contactBtns: App.qs("#contactBtns"),
    callLink: App.qs("#callLink"),
    textLink: App.qs("#textLink"),
    waBtn: App.qs("#waBtn"),
    waLabel: App.qs("#waLabel"),
    totalLabel: App.qs("#totalLabel"),
    statTotal: App.qs("#statTotal"),
    statCount: App.qs("#statCount"),
    statLast: App.qs("#statLast"),
    statLastSub: App.qs("#statLastSub"),
    newDocLink: App.qs("#newDocLink"),
    form: App.qs("#contragentForm"),
    name: App.qs("#contragentName"),
    typeSeg: App.qs("#contragentTypeSeg"),
    phone: App.qs("#contragentPhone"),
    address: App.qs("#contragentAddress"),
    notes: App.qs("#contragentNotes"),
    cancelEditBtn: App.qs("#cancelEditBtn"),
    historyTitle: App.qs("#historyTitle"),
    historyCard: App.qs("#historyCard"),
    historyCount: App.qs("#contragentHistoryCount"),
    historyList: App.qs("#contragentHistoryList"),
    deleteBtn: App.qs("#contragentDeleteBtn")
  };

  const state = {
    contragent: null,
    type: params.get("type") === "0" ? 0 : 1
  };

  function kindLabel(type = state.type) {
    return Number(type) === 0 ? "Supplier" : "Customer";
  }

  function setType(type) {
    state.type = Number(type) === 0 ? 0 : 1;
    App.qsa("button", els.typeSeg).forEach((b) => b.classList.toggle("active", Number(b.dataset.type) === state.type));
  }

  function fillForm(c) {
    els.name.value = c?.name || "";
    els.phone.value = c?.phone || "";
    els.address.value = c?.address || "";
    els.notes.value = c?.notes || "";
    setType(c ? c.type : state.type);
  }

  function showEdit(editing) {
    els.form.classList.toggle("hidden", !editing);
    els.summary.classList.toggle("hidden", editing || !id);
    els.editBtn.classList.toggle("hidden", editing || !id);
    els.cancelEditBtn.classList.toggle("hidden", !id);
    if (editing) {
      fillForm(state.contragent);
      if (!id) els.name.focus();
    }
  }

  function daysAgo(iso) {
    const days = Math.round((new Date(`${App.todayISO()}T00:00:00`) - new Date(`${iso}T00:00:00`)) / 86400000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 60) return `${days} days ago`;
    if (days < 730) return `${Math.round(days / 30)} months ago`;
    return `${Math.round(days / 365)} years ago`;
  }

  function renderSummary(c, stats) {
    const isSupplier = Number(c.type) === 0;
    els.title.textContent = kindLabel(c.type);
    els.summaryName.textContent = c.name;
    els.summaryPhone.textContent = c.phone || "No phone";
    const digits = String(c.phone || "").replace(/[^\d+]/g, "");
    els.contactBtns.classList.toggle("hidden", !digits);
    els.callLink.href = `tel:${digits}`;
    els.textLink.href = `sms:${digits}`;
    // "GV" customers are on WhatsApp Business; everyone else regular WhatsApp.
    state.waBusiness = /\bgv\b/i.test(c.name || "");
    els.waLabel.textContent = state.waBusiness ? "WA Business" : "WhatsApp";
    els.totalLabel.textContent = isSupplier ? "Total received" : "Total bought";
    els.statTotal.textContent = App.fmtMoney(stats?.total || 0);
    const n = Number(stats?.doc_count || 0);
    els.statCount.textContent = `${n} ${isSupplier ? "deliver" + (n === 1 ? "y" : "ies") : "order" + (n === 1 ? "" : "s")}`;
    els.statLast.textContent = stats?.last_date ? App.shortDate(stats.last_date) : "–";
    els.statLastSub.textContent = stats?.last_date ? daysAgo(stats.last_date) : " ";
    els.newDocLink.textContent = isSupplier ? "Receive stock" : "New Sale";
    els.newDocLink.href = `document-form.html?type=${isSupplier ? 1 : 2}&contragent=${c.id}`;
  }

  async function load() {
    if (!id) {
      els.title.textContent = `New ${kindLabel()}`;
      fillForm(null);
      showEdit(true);
      return;
    }
    const data = await App.localData(`contragents?id=${encodeURIComponent(id)}`);
    if (!data.contragent) throw new Error("Not found");
    state.contragent = data.contragent;
    setType(data.contragent.type);
    renderSummary(data.contragent, data.stats);
    showEdit(false);
    els.deleteBtn.classList.remove("hidden");
    els.deleteBtn.textContent = `Delete ${kindLabel().toLowerCase()}`;
    await loadHistory();
  }

  async function loadHistory() {
    const { documents = [] } = await App.localData(`documents?contragent_id=${encodeURIComponent(id)}&limit=200`);
    els.historyTitle.classList.remove("hidden");
    els.historyCard.classList.remove("hidden");
    els.historyCount.textContent = documents.length >= 200 ? "last 200" : String(documents.length);
    els.historyList.innerHTML = documents.length
      ? documents.map((doc) => App.docCardHtml(doc, { dateTitle: true })).join("")
      : App.emptyState("No history yet.");
  }

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      name: els.name.value.trim(),
      type: state.type,
      phone: els.phone.value.trim() || null,
      address: els.address.value.trim() || null,
      notes: els.notes.value.trim() || null
    };
    if (!body.name) return App.toast("Enter a name");
    try {
      if (id) {
        await App.localData("contragents", { method: "PUT", body: { id, ...body } });
        App.toast("Saved");
        await load();
      } else {
        const { contragent } = await App.localData("contragents", { method: "POST", body });
        App.flash(`${contragent.name} added`);
        App.go(`contragent-form.html?id=${encodeURIComponent(contragent.id)}`, { replace: true });
      }
    } catch (err) {
      App.toast(err.message || "Failed to save");
    }
  });

  els.typeSeg.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (btn) setType(btn.dataset.type);
  });
  els.waBtn.addEventListener("click", () => {
    let phone = String(state.contragent?.phone || "").replace(/\D/g, "");
    if (phone.length === 10) phone = `1${phone}`;
    if (!phone) return App.toast("No phone number");
    if (!state.waBusiness) {
      window.location.href = `whatsapp://send?phone=${phone}`;
      return;
    }
    // Try the Business app; if it doesn't open, fall back to any WhatsApp.
    window.location.href = `whatsapp-smb://send?phone=${phone}`;
    setTimeout(() => {
      if (!document.hidden) window.location.href = `whatsapp://send?phone=${phone}`;
    }, 1200);
  });
  els.editBtn.addEventListener("click", () => showEdit(true));
  els.cancelEditBtn.addEventListener("click", () => {
    if (id) showEdit(false);
  });
  els.deleteBtn.addEventListener("click", async () => {
    if (!id || !window.confirm(`Delete this ${kindLabel().toLowerCase()}?`)) return;
    try {
      await App.localData(`contragents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      App.flash("Deleted");
      App.go("contragents.html", { replace: true });
    } catch (err) {
      App.toast(err.message === "Cannot delete contragent with document history"
        ? "This one has sales or deliveries, so it can't be deleted."
        : err.message || "Failed to delete");
    }
  });
  els.historyList.addEventListener("click", (e) => {
    const row = e.target.closest("[data-doc-id]");
    if (row) App.go(App.docUrl(row.dataset.docId));
  });

  load().catch((err) => App.toast(err.message || "Failed to load"));
});
