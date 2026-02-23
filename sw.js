const CACHE = "inventory-app-v3-static-1";
const STATIC_ASSETS = [
  "/",
  "/login.html",
  "/index.html",
  "/goods.html",
  "/good-form.html",
  "/documents.html",
  "/document-form.html",
  "/contragents.html",
  "/contragent-form.html",
  "/reports.html",
  "/css/style.css",
  "/js/app.js",
  "/manifest.json"
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
  if (url.pathname.startsWith("/api/")) return;
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
