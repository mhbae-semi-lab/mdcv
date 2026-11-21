// MDCV service worker: the app shell works offline. Static files are cache-first; pages are network-first with the
// cached copy as fallback. Mail data never passes through here (it lives in IndexedDB, or behind the self-host API).
const CACHE = "mdcv-v2";
const SCOPE = new URL(self.registration.scope).pathname; // "/" or "/mdcv/" on GitHub Pages
const SHELL = [SCOPE, SCOPE + "manifest.webmanifest", SCOPE + "icon-192.png", SCOPE + "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(SCOPE, copy));
      return res;
    }).catch(() => caches.match(SCOPE)));
    return;
  }
  if (url.pathname.includes("/_next/static/") || /\.(png|ico|svg|css|js|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
});
