window.InventoryApp.defineView("settings", (ctx) => {
  const App = window.InventoryApp;
  const DB = window.LocalDB;
  const GoogleContacts = window.InventoryGoogleContacts;
  const DriveBackup = window.InventoryDriveBackup;
  const $ = (id) => document.getElementById(id);

  function setStatus(el, text, tone = "") {
    el.textContent = text;
    el.className = `hint ${tone === "ok" ? "success-text" : tone === "warn" ? "warn-text" : tone === "bad" ? "danger-text" : ""}`;
  }

  function formatNYTime(timestamp) {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  // ── storage / export / import ────────────────────────────────────────
  (async () => {
    const persisted = await DB.checkPersistence();
    setStatus($("storageStatus"), persisted
      ? "Phone storage is protected from being cleared."
      : "Phone storage is not protected. Keep backups.", persisted ? "ok" : "bad");
  })();

  $("exportBtn").addEventListener("click", () => {
    try {
      DB.exportDatabase();
      App.toast("Backup file saved");
    } catch (e) {
      App.toast("Export failed: " + e.message);
    }
  });

  const importFile = $("importFile");
  const importStatus = $("importStatus");
  $("importBtn").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const file = importFile.files[0];
    if (!file) return;
    if (!window.confirm(`Replace everything on this phone with "${file.name}"?`)) {
      importFile.value = "";
      return;
    }
    setStatus(importStatus, "Importing...");
    try {
      const result = await DB.importDatabase(file);
      const s = result.summary || {};
      setStatus(importStatus, `Imported ${s.goods || 0} products, ${s.contragents || 0} customers/suppliers, ${s.documents || 0} documents. Reloading...`, "ok");
      const importedAt = String(Date.now());
      localStorage.setItem("inventory_db_imported_at_v1", importedAt);
      sessionStorage.setItem("inventory_db_imported_at_v1", importedAt);
      setTimeout(() => window.location.replace(`index.html?imported=${importedAt}`), 1000);
    } catch (e) {
      setStatus(importStatus, "Import failed: " + e.message, "bad");
    } finally {
      importFile.value = "";
    }
  });

  // ── Google Contacts ──────────────────────────────────────────────────
  const googleStatus = $("googleContactsStatus");
  const googleConnectBtn = $("googleConnectBtn");
  const googleSyncBtn = $("googleSyncBtn");
  const googleAutoSync = $("googleAutoSync");

  function refreshGoogleStatus(extra = "") {
    if (!GoogleContacts) return setStatus(googleStatus, "Google Contacts is not available", "bad");
    const s = GoogleContacts.getState();
    googleConnectBtn.textContent = s.connected ? "Reconnect" : "Connect";
    googleAutoSync.checked = s.autoSync;
    const lastSync = s.lastSyncAt ? ` Last sync ${formatNYTime(s.lastSyncAt)}.` : "";
    setStatus(googleStatus, extra || (s.connected
      ? `Connected.${lastSync}`
      : (s.hasToken ? `Needs a refresh: tap Reconnect.${lastSync}` : "Not connected")), s.connected ? "ok" : "");
  }

  googleAutoSync.addEventListener("change", () => {
    GoogleContacts.setAutoSyncEnabled(googleAutoSync.checked);
    refreshGoogleStatus(googleAutoSync.checked ? "Auto sync is on." : "Auto sync is off.");
  });
  googleConnectBtn.addEventListener("click", async () => {
    App.setLoading(googleConnectBtn, true);
    try {
      await GoogleContacts.connect();
      GoogleContacts.setAutoSyncEnabled(true);
      refreshGoogleStatus("Connected. Auto sync is on.");
    } catch (err) {
      refreshGoogleStatus(err.message || "Google connection failed");
    } finally {
      App.setLoading(googleConnectBtn, false);
    }
  });
  googleSyncBtn.addEventListener("click", async () => {
    App.setLoading(googleSyncBtn, true);
    try {
      const result = await GoogleContacts.syncTaggedContacts({ interactive: true });
      refreshGoogleStatus();
      App.toast(GoogleContacts.formatImportSummary(result), 3200);
    } catch (err) {
      refreshGoogleStatus(err.message || "Google sync failed");
    } finally {
      App.setLoading(googleSyncBtn, false);
    }
  });
  refreshGoogleStatus();

  // ── Google Drive backup ──────────────────────────────────────────────
  const driveStatus = $("driveBackupStatus");
  const driveAutoBackup = $("driveAutoBackup");
  const driveBackupBtn = $("driveBackupBtn");

  function refreshDriveStatus(extra = "") {
    if (!DriveBackup) return setStatus(driveStatus, "Google Drive backup is not available", "bad");
    const s = DriveBackup.getState();
    const g = GoogleContacts?.getState?.() || {};
    driveAutoBackup.checked = s.autoBackup;
    if (extra) return setStatus(driveStatus, extra, /failed|denied|error/i.test(extra) ? "bad" : "ok");
    if (!g.hasToken) return setStatus(driveStatus, "Not connected yet. Tap Back up now.", "warn");
    if (!g.hasDriveScope) return setStatus(driveStatus, "Needs Drive permission. Tap Back up now.", "warn");
    const last = s.lastBackupAt ? formatNYTime(s.lastBackupAt) : "never";
    setStatus(driveStatus, `Last backup: ${last}${s.due ? " · due" : ""}`, s.due ? "warn" : "ok");
  }

  driveAutoBackup.addEventListener("change", () => {
    DriveBackup.setAutoBackupEnabled(driveAutoBackup.checked);
    refreshDriveStatus(driveAutoBackup.checked ? "Daily backup is on." : "Daily backup is off.");
  });
  driveBackupBtn.addEventListener("click", async () => {
    App.setLoading(driveBackupBtn, true);
    try {
      const result = await DriveBackup.backupNow({ interactive: true });
      refreshDriveStatus(`Backed up: ${result.name}`);
      App.toast("Backed up to Google Drive", 3200);
    } catch (err) {
      refreshDriveStatus(err.message || "Backup failed");
    } finally {
      App.setLoading(driveBackupBtn, false);
    }
  });
  refreshDriveStatus();

  // ── version / update ─────────────────────────────────────────────────
  const versionEl = $("currentVersion");
  (async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg && reg.active) {
        const mc = new MessageChannel();
        mc.port1.onmessage = (e) => {
          versionEl.textContent = `${e.data.cache} (built ${e.data.buildTime})`;
        };
        reg.active.postMessage({ type: "GET_VERSION" }, [mc.port2]);
      } else {
        versionEl.textContent = "No service worker active";
      }
    } catch {
      versionEl.textContent = "Unknown";
    }
  })();

  // Apply the latest deployed app shell. Data stays in the local database.
  const updateStatus = $("updateStatus");
  $("updateBtn").addEventListener("click", async () => {
    setStatus(updateStatus, "Checking for the latest app...");
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.update();
      if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      setStatus(updateStatus, "Reloading with the latest app...");
      window.setTimeout(() => window.location.reload(), 250);
    } catch (e) {
      setStatus(updateStatus, "Update check failed: " + e.message, "bad");
    }
  });
  navigator.serviceWorker?.addEventListener("controllerchange", () => window.location.reload(), { signal: ctx.signal });

  // ── security ─────────────────────────────────────────────────────────
  $("lockBtn").addEventListener("click", () => App.logout());
  $("resetPinBtn").addEventListener("click", async () => {
    if (!window.confirm("Reset your PIN? You will set a new one on next login.")) return;
    try {
      await App.localData("auth", { method: "DELETE" });
      App.logout();
    } catch (e) {
      App.toast("PIN reset failed: " + e.message);
    }
  });
});
