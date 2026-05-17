const CACHE = "inventory-app-v3-local-static-13";
const BUILD_TIME = "2026-05-17 00:19 EDT";
const STATIC_ASSETS = [
  "./",
  "login.html",
  "index.html",
  "goods.html",
  "good-form.html",
  "documents.html",
  "document-form.html",
  "contragents.html",
  "contragent-form.html",
  "shortcut-contact.html",
  "reports.html",
  "settings.html",
  "css/style.css",
  "js/app.js",
  "js/local-db.js",
  "js/contact-utils.js",
  "js/google-contacts.js",
  "js/google-drive-backup.js",
  "js/home.js",
  "js/login.js",
  "js/goods.js",
  "js/good-form.js",
  "js/documents.js",
  "js/document-form.js",
  "js/contragents.js",
  "js/contragent-form.js",
  "js/shortcut-contact.js",
  "js/reports.js",
  "lib/sql-wasm.js",
  "lib/sql-wasm.wasm",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true })
      .then((cached) => cached || fetch(req, { cache: "no-cache" }).then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(req, clone)).catch(() => undefined);
        }
        return resp;
      }))
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "GET_VERSION") {
    event.ports[0].postMessage({ cache: CACHE, buildTime: BUILD_TIME });
  }
});
