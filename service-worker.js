// Bump this version string every time app.js / index.html / styles.css change.
// A returning visitor's browser already has a service worker installed; it only
// re-installs (and re-caches) when this file's BYTES change. If the cache name
// below stays the same across deploys, "install" never re-runs, so the old
// cached app.js/index.html keep being served forever — no matter how many
// times the real files on the server are fixed. That was the bug behind
// "Start meeting" (and any other fix) silently not showing up for a
// returning user: they were stuck on a stale cached snapshot from their
// very first visit.
const CACHE = "smn-static-v3";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./config.js", "./manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first, cache as fallback: every load tries to fetch the current
// file from the server first (so a new deploy is visible on the very next
// reload) and only falls back to the cached copy when the network is
// unavailable, so the app still opens offline.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
