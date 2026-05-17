(function () {
  "use strict";

  const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
  const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,createdTime";
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const FOLDER_NAME = "Inventory App Backups";
  const FOLDER_ID_KEY = "inventory_drive_backup_folder_id_v1";
  const LAST_BACKUP_KEY = "inventory_drive_backup_last_at_v1";
  const LAST_BACKUP_NAME_KEY = "inventory_drive_backup_last_name_v1";
  const AUTO_BACKUP_KEY = "inventory_drive_backup_auto_v1";
  const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

  function readNumber(key) {
    const value = Number(localStorage.getItem(key) || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function isAutoBackupEnabled() {
    return localStorage.getItem(AUTO_BACKUP_KEY) !== "0";
  }

  function setAutoBackupEnabled(enabled) {
    localStorage.setItem(AUTO_BACKUP_KEY, enabled ? "1" : "0");
  }

  function getState() {
    const lastBackupAt = readNumber(LAST_BACKUP_KEY);
    return {
      autoBackup: isAutoBackupEnabled(),
      lastBackupAt,
      lastBackupName: localStorage.getItem(LAST_BACKUP_NAME_KEY) || "",
      due: !lastBackupAt || Date.now() - lastBackupAt > BACKUP_INTERVAL_MS
    };
  }

  async function driveFetch(path, options = {}) {
    const GoogleContacts = window.InventoryGoogleContacts;
    if (!GoogleContacts?.ensureToken) throw new Error("Google auth is not available");
    const { interactive: interactiveOption, ...fetchOptions } = options;
    const token = await GoogleContacts.ensureToken({
      interactive: interactiveOption !== false,
      scope: `${GoogleContacts.CONTACTS_SCOPE} ${GoogleContacts.DRIVE_FILE_SCOPE}`
    });

    const response = await fetch(path, {
      ...fetchOptions,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(fetchOptions.headers || {})
      }
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(data?.error?.message || `Google Drive request failed (${response.status})`);
    }
    return data || {};
  }

  async function createBackupFolder(interactive) {
    const data = await driveFetch(DRIVE_API + "?fields=id,name", {
      method: "POST",
      interactive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: FOLDER_MIME
      })
    });
    if (!data.id) throw new Error("Google Drive did not return a backup folder id");
    localStorage.setItem(FOLDER_ID_KEY, data.id);
    return data.id;
  }

  async function getFolderId(interactive) {
    return localStorage.getItem(FOLDER_ID_KEY) || createBackupFolder(interactive);
  }

  async function uploadMultipart(folderId, fileName, blob, interactive) {
    const boundary = "inventory-backup-" + Date.now();
    const metadata = {
      name: fileName,
      parents: [folderId]
    };
    const body = new Blob([
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
      "\r\n",
      `--${boundary}\r\n`,
      "Content-Type: application/x-sqlite3\r\n\r\n",
      blob,
      "\r\n",
      `--${boundary}--`
    ], { type: `multipart/related; boundary=${boundary}` });

    return driveFetch(DRIVE_UPLOAD, {
      method: "POST",
      interactive,
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    });
  }

  async function backupNow(options = {}) {
    const interactive = options.interactive !== false;
    const DB = window.LocalDB;
    if (!DB?.createDatabaseBackupBlob) throw new Error("Local database is not ready");

    const folderId = await getFolderId(interactive);
    const blob = DB.createDatabaseBackupBlob();
    const fileName = DB.databaseBackupFileName(new Date());
    const file = await uploadMultipart(folderId, fileName, blob, interactive);
    const now = Date.now();
    localStorage.setItem(LAST_BACKUP_KEY, String(now));
    localStorage.setItem(LAST_BACKUP_NAME_KEY, file.name || fileName);
    return { ...file, backedUpAt: now, name: file.name || fileName };
  }

  async function maybeBackupOnOpen() {
    const state = getState();
    if (!state.autoBackup || !state.due) return { skipped: true, reason: "not_due", state };
    try {
      const result = await backupNow({ interactive: false });
      return { skipped: false, result };
    } catch (err) {
      return { skipped: true, reason: "needs_google", error: err.message, state };
    }
  }

  window.InventoryDriveBackup = {
    getState,
    setAutoBackupEnabled,
    backupNow,
    maybeBackupOnOpen
  };
})();
