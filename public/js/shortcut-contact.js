document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const title = App.qs("#shortcutTitle");
  const status = App.qs("#shortcutStatus");

  function setStatus(message, isError = false) {
    if (status) status.textContent = message;
    status?.classList.toggle("danger-text", Boolean(isError));
  }

  function paramsFromLocation() {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const merged = new URLSearchParams(window.location.search);
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      for (const [key, value] of hashParams.entries()) merged.set(key, value);
    }
    return merged;
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function contactFromParams(params) {
    const first = clean(params.get("first") || params.get("first_name"));
    const last = clean(params.get("last") || params.get("last_name"));
    const company = clean(params.get("company") || params.get("org"));
    const explicitName = clean(params.get("name"));
    const name = explicitName || company || [first, last].filter(Boolean).join(" ").trim();
    const phone = clean(params.get("phone") || params.get("tel") || params.get("number"));
    return {
      sourceName: name,
      name,
      phone: phone || null,
      type: 1,
      notes: "Imported from iPhone Shortcut"
    };
  }

  function isLikelyStandalone() {
    return Boolean(window.navigator.standalone) ||
      window.matchMedia?.("(display-mode: standalone)")?.matches;
  }

  async function run() {
    const params = paramsFromLocation();
    const contact = contactFromParams(params);
    if (!contact.name) {
      title.textContent = "Could not import";
      setStatus("Shortcut did not send a customer name.", true);
      return;
    }

    try {
      const result = await App.localData("contragents/import", {
        method: "POST",
        body: { contacts: [contact], requireTag: false }
      });
      const imported = result.contacts?.[0];
      if (!imported?.id) {
        title.textContent = "Could not import";
        setStatus("No customer was saved.", true);
        return;
      }
      const action = imported.action === "created" ? "saved" : "already exists";
      title.textContent = "Customer imported";
      setStatus(`${imported.name} ${action}.`);

      const destination = `contragent-form.html?id=${encodeURIComponent(imported.id)}`;
      window.setTimeout(() => {
        window.location.replace(destination);
      }, isLikelyStandalone() ? 250 : 1200);
    } catch (err) {
      title.textContent = "Import failed";
      setStatus(err.message || "Could not save customer.", true);
    }
  }

  run();
});
