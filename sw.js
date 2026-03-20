const CACHE = "inventory-app-v3-static-7";
const BUILD_TIME = "2026-03-20 03:35";
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
  "reports.html",
  "settings.html",
  "css/style.css",
  "js/app.js",
  "js/local-db.js",
  "js/home.js",
  "js/login.js",
  "js/goods.js",
  "js/good-form.js",
  "js/documents.js",
  "js/document-form.js",
  "js/contragents.js",
  "js/contragent-form.js",
  "js/reports.js",
  "lib/sql-wasm.js",
  "lib/sql-wasm.wasm",
  "manifest.json"
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => undefined));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(req, clone)).catch(() => undefined);
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
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
