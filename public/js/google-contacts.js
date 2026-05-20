(function () {
  "use strict";

  const CLIENT_ID = "218954399891-rv3c37f6ksinp60spaqgan4isjag1os8.apps.googleusercontent.com";
  const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
  const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const SCOPE = CONTACTS_SCOPE;
  const GIS_SRC = "https://accounts.google.com/gsi/client";
  const PEOPLE_BASE = "https://people.googleapis.com/v1/";
  const TOKEN_KEY = "inventory_google_contacts_token_v1";
  const TOKEN_EXPIRES_KEY = "inventory_google_contacts_token_expires_v1";
  const TOKEN_SCOPE_KEY = "inventory_google_contacts_token_scope_v1";
  const SYNC_TOKEN_KEY = "inventory_google_contacts_sync_token_v1";
  const AUTO_SYNC_KEY = "inventory_google_contacts_auto_sync_v1";
  const LAST_SYNC_KEY = "inventory_google_contacts_last_sync_v1";
  const SEARCH_WARMED_KEY = "inventory_google_contacts_search_warmed_v1";
  const IMPORT_NOTE = "Imported from Google Contacts";

  let gisPromise = null;

  function text(value) {
    return String(value ?? "").trim();
  }

  function readNumber(key) {
    const value = Number(localStorage.getItem(key) || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function hasRequiredScope(scope) {
    const required = String(scope || CONTACTS_SCOPE).split(/\s+/).filter(Boolean);
    const granted = new Set(String(localStorage.getItem(TOKEN_SCOPE_KEY) || "").split(/\s+/).filter(Boolean));
    return required.every((item) => granted.has(item));
  }

  function isTokenValid(scope = CONTACTS_SCOPE) {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiresAt = readNumber(TOKEN_EXPIRES_KEY);
    return Boolean(token && expiresAt > Date.now() + 60000 && hasRequiredScope(scope));
  }

  function getState() {
    return {
      connected: isTokenValid(CONTACTS_SCOPE),
      autoSync: isAutoSyncEnabled(),
      tokenExpiresAt: readNumber(TOKEN_EXPIRES_KEY),
      lastSyncAt: readNumber(LAST_SYNC_KEY),
      hasSyncToken: Boolean(localStorage.getItem(SYNC_TOKEN_KEY))
    };
  }

  function setStoredToken(response) {
    const token = response && response.access_token;
    if (!token) return;
    const expiresIn = Number(response.expires_in || 3600);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRES_KEY, String(Date.now() + expiresIn * 1000));
    if (response.scope) {
      localStorage.setItem(TOKEN_SCOPE_KEY, response.scope);
    }
  }

  function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRES_KEY);
    localStorage.removeItem(TOKEN_SCOPE_KEY);
    sessionStorage.removeItem(SEARCH_WARMED_KEY);
  }

  function clearSyncCursor() {
    localStorage.removeItem(SYNC_TOKEN_KEY);
  }

  function isAutoSyncEnabled() {
    return localStorage.getItem(AUTO_SYNC_KEY) === "1";
  }

  function setAutoSyncEnabled(enabled) {
    localStorage.setItem(AUTO_SYNC_KEY, enabled ? "1" : "0");
  }

  function loadGIS() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (gisPromise) return gisPromise;

    gisPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("Could not load Google sign-in")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Google sign-in"));
      document.head.appendChild(script);
    });

    return gisPromise;
  }

  async function requestAccessToken(options = {}) {
    await loadGIS();
    const prompt = options.prompt ?? (localStorage.getItem(TOKEN_KEY) ? "" : "consent");
    const scope = options.scope || CONTACTS_SCOPE;

    return new Promise((resolve, reject) => {
      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope,
          callback: (response) => {
            if (!response || response.error) {
              reject(new Error(response?.error_description || response?.error || "Google authorization failed"));
              return;
            }
            if (!response.scope) response.scope = scope;
            setStoredToken(response);
            resolve(response.access_token);
          }
        });
        tokenClient.requestAccessToken({ prompt });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function ensureToken(options = {}) {
    const force = Boolean(options.force);
    const interactive = Boolean(options.interactive);
    const scope = options.scope || CONTACTS_SCOPE;
    if (!force && isTokenValid(scope)) return localStorage.getItem(TOKEN_KEY);
    if (!interactive && localStorage.getItem(TOKEN_KEY)) {
      try {
        return await requestAccessToken({ ...options, prompt: "" });
      } catch (_err) {
        clearAuth();
        throw new Error("Google sign-in is needed");
      }
    }
    if (!interactive) throw new Error("Connect Google Contacts first");
    return requestAccessToken(options);
  }

  async function peopleFetch(path, token) {
    const response = await fetch(PEOPLE_BASE + path, {
      headers: { Authorization: `Bearer ${token}` }
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message = data?.error?.message || `Google Contacts request failed (${response.status})`;
      if (response.status === 401 || response.status === 403) clearAuth();
      const err = new Error(message);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data || {};
  }

  function urlPath(path, params) {
    const qs = new URLSearchParams(params);
    return `${path}?${qs.toString()}`;
  }

  function bestName(person) {
    const names = Array.isArray(person?.names) ? person.names : [];
    const first = names.find((name) => text(name.displayName || name.unstructuredName || name.givenName || name.familyName));
    if (!first) return "";
    return text(first.displayName) ||
      [first.givenName, first.familyName].map(text).filter(Boolean).join(" ") ||
      text(first.unstructuredName);
  }

  function bestPhone(person) {
    const phones = Array.isArray(person?.phoneNumbers) ? person.phoneNumbers : [];
    const first = phones.find((phone) => text(phone.canonicalForm || phone.value));
    return first ? text(first.canonicalForm || first.value) : "";
  }

  function personToContact(person) {
    const sourceName = bestName(person);
    const phone = bestPhone(person);
    if (!sourceName || !phone) return null;
    return {
      sourceName,
      name: sourceName,
      phone,
      type: 1,
      notes: IMPORT_NOTE,
      googleResourceName: person.resourceName || null
    };
  }

  function formatImportSummary(result, fallbackFound = 0) {
    const found = Number(result.found ?? fallbackFound);
    const created = Number(result.created || 0);
    const updated = Number(result.updated || 0);
    const skipped = Number(result.skipped || 0);
    const ignored = Number(result.ignored || 0);
    if (!found && !created && !updated && !skipped) return "No matching Google contacts found";
    return `Contacts: ${created} new, ${updated} updated, ${skipped} unchanged${ignored ? `, ${ignored} ignored` : ""}`;
  }

  async function importContacts(contacts, options = {}) {
    const items = (contacts || []).filter(Boolean);
    if (!items.length) {
      return { created: 0, updated: 0, skipped: 0, ignored: 0, imported: 0, contacts: [] };
    }
    const App = window.InventoryApp;
    if (!App?.localData) throw new Error("Inventory app is not ready");
    return App.localData("contragents/import", {
      method: "POST",
      body: {
        contacts: items,
        requireTag: options.requireTag !== false
      }
    });
  }

  async function listConnections(options = {}) {
    const token = await ensureToken({ interactive: Boolean(options.interactive) });
    const forceFull = Boolean(options.forceFull);
    const syncToken = forceFull ? "" : localStorage.getItem(SYNC_TOKEN_KEY);
    const people = [];
    let nextSyncToken = "";
    let pageToken = "";

    try {
      for (let page = 0; page < 100; page += 1) {
        const params = {
          pageSize: "1000",
          personFields: "names,phoneNumbers"
        };
        if (pageToken) params.pageToken = pageToken;
        if (syncToken) {
          params.syncToken = syncToken;
        } else {
          params.requestSyncToken = "true";
        }

        const data = await peopleFetch(urlPath("people/me/connections", params), token);
        people.push(...(Array.isArray(data.connections) ? data.connections : []));
        pageToken = data.nextPageToken || "";
        nextSyncToken = data.nextSyncToken || nextSyncToken;
        if (!pageToken) break;
      }
    } catch (err) {
      if ((err.status === 410 || err.data?.error?.status === "EXPIRED_SYNC_TOKEN") && syncToken) {
        clearSyncCursor();
        return listConnections({ ...options, forceFull: true });
      }
      throw err;
    }

    if (nextSyncToken) localStorage.setItem(SYNC_TOKEN_KEY, nextSyncToken);
    return people;
  }

  async function syncTaggedContacts(options = {}) {
    const people = await listConnections(options);
    const contacts = people
      .map(personToContact)
      .filter((contact) => contact && contact.sourceName.startsWith("#"));

    let result;
    if (contacts.length) {
      result = await importContacts(contacts, { requireTag: true });
    } else {
      result = { created: 0, updated: 0, skipped: 0, ignored: 0, imported: 0, contacts: [] };
    }

    const completedAt = Date.now();
    localStorage.setItem(LAST_SYNC_KEY, String(completedAt));
    return { ...result, found: contacts.length, syncedAt: completedAt };
  }

  async function autoSyncTagged() {
    if (!isAutoSyncEnabled()) return { skipped: true, reason: "disabled" };
    if (!isTokenValid()) return { skipped: true, reason: "not_connected" };
    return syncTaggedContacts({ interactive: false });
  }

  async function warmSearchCache(token) {
    if (sessionStorage.getItem(SEARCH_WARMED_KEY) === "1") return;
    try {
      await peopleFetch(urlPath("people:searchContacts", {
        query: "",
        readMask: "names,phoneNumbers",
        pageSize: "1"
      }), token);
    } catch {
      // Google recommends warming the contact search cache, but search can still run if this fails.
    }
    sessionStorage.setItem(SEARCH_WARMED_KEY, "1");
  }

  async function searchContacts(query, options = {}) {
    const q = text(query);
    if (!q) return [];
    const token = await ensureToken({ interactive: options.interactive !== false });
    await warmSearchCache(token);

    const data = await peopleFetch(urlPath("people:searchContacts", {
      query: q,
      readMask: "names,phoneNumbers",
      pageSize: String(Math.min(Math.max(Number(options.pageSize || 20), 1), 30))
    }), token);

    return (Array.isArray(data.results) ? data.results : [])
      .map((row) => personToContact(row.person))
      .filter(Boolean);
  }

  function disconnect() {
    const token = localStorage.getItem(TOKEN_KEY);
    clearAuth();
    clearSyncCursor();
    if (token && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(token, () => undefined);
    }
  }

  window.InventoryGoogleContacts = {
    CLIENT_ID,
    SCOPE,
    CONTACTS_SCOPE,
    DRIVE_FILE_SCOPE,
    getState,
    isAutoSyncEnabled,
    setAutoSyncEnabled,
    ensureToken,
    connect: () => ensureToken({ interactive: true, force: true, prompt: "consent" }),
    disconnect,
    syncTaggedContacts,
    autoSyncTagged,
    searchContacts,
    importContacts,
    personToContact,
    formatImportSummary
  };
})();
