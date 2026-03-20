document.addEventListener("app-ready", () => {
  const App = window.InventoryApp;
  const form = App.qs("#loginForm");
  const pinInput = App.qs("#pinInput");
  const setupBtn = App.qs("#setupPinBtn");
  const msg = App.qs("#loginMessage");
  const submitBtn = App.qs("#loginSubmit");
  const next = App.queryParams().get("next") || "index.html";
  let setupRequired = false;

  function setMessage(text, danger = false) {
    msg.textContent = text || "";
    msg.classList.toggle("danger-text", Boolean(danger));
  }

  async function checkStatus() {
    try {
      const data = await App.api("/api/auth");
      setupRequired = !data.configured;
      setupBtn.classList.toggle("hidden", !setupRequired);
      setMessage(setupRequired ? "No PIN configured yet. Enter a PIN and tap Set PIN." : "");
    } catch (err) {
      setMessage(err.message || "Could not check PIN status", true);
    }
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = pinInput.value.trim();
    if (!pin) return;
    App.setLoading(submitBtn, true);
    try {
      const result = await App.api("/api/auth", { method: "POST", body: { pin } });
      if (result.setup_required) {
        setupRequired = true;
        setupBtn.classList.remove("hidden");
        setMessage("No PIN set yet. Tap Set PIN to save this PIN.", false);
        return;
      }
      if (!result.ok) {
        setMessage("Incorrect PIN", true);
        return;
      }
      App.markAuthOk(result.token);
      window.location.replace(next);
    } catch (err) {
      setMessage(err.message || "Login failed", true);
    } finally {
      App.setLoading(submitBtn, false);
    }
  });

  setupBtn?.addEventListener("click", async () => {
    const pin = pinInput.value.trim();
    if (!pin) return App.toast("Enter a PIN first");
    App.setLoading(setupBtn, true);
    try {
      const result = await App.api("/api/auth", { method: "POST", body: { pin, setup: true } });
      if (result.ok) {
        App.markAuthOk(result.token);
        App.toast("PIN saved");
        window.location.replace(next);
      }
    } catch (err) {
      setMessage(err.message || "Could not set PIN", true);
    } finally {
      App.setLoading(setupBtn, false);
    }
  });

  checkStatus();
});
