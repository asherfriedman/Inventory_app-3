# Inventory App v3

## Target Device
Primary target: iPhone 17 Pro (mobile-first, 430px max-width shell).
All UI decisions should prioritize this device's screen size and touch interactions.

## Runtime Model
This app is a fully local PWA. The deployed site only ships static HTML, CSS, JS,
icons, the manifest, the service worker, and sql.js assets.

- No server API is required.
- No Supabase backend is required.
- All app data lives in the browser using sql.js persisted to OPFS as `inventory.db`.
- Frontend data calls should go through `InventoryApp.localData(...)`, which routes
  to `window.LocalDB.handleRequest(...)` in `public/js/local-db.js`.
- Preserve Settings import/export; that is the data backup and restore path for the phone.
- OPFS requires a secure context for real phone use, so install from the HTTPS deployment,
  not a plain LAN `http://` dev URL.

## Updating the Phone App
The phone should install the HTTPS deployed URL as the PWA. Code updates are static
asset updates. The service worker is network-first, so changed HTML/CSS/JS should be
picked up when the app is opened online; the Settings page also has an update check.

The intended test workflow is:

1. Deploy updated static app files.
2. Open the installed iPhone PWA while online.
3. Use Settings -> Update App to force a service worker check and reload.
4. Import the current `.db` backup from Settings when fresh test data is needed.

When changing the service worker itself, bump `CACHE` and `BUILD_TIME` in
`public/sw.js` so iOS notices the new worker.
