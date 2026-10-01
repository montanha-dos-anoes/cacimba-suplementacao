const CACHE_PREFIX = "cacimba-suplementacao-";
const CACHE_NAME = `${CACHE_PREFIX}1.19.0`;
const CDN_URLS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js"
];
const APP_SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./assets/css/app.css", "./assets/img/logo.jpg", "./assets/img/login.jpg",
  "./assets/img/icon-192.png", "./assets/img/icon-512.png", "./assets/img/icon-maskable-512.png",
  "./src/config.js", "./src/api.js", "./src/state.js", "./src/farm-time.js", "./src/offline.js", "./src/units.js", "./src/balance-guard.js",
  "./src/ui.js", "./src/outbox.js", "./src/nav.js", "./src/modal.js", "./src/datefield.js", "./src/auth.js", "./src/feeding.js",
  "./src/masters.js", "./src/lots.js", "./src/stock.js", "./src/stock-manage.js", "./src/formulas.js",
  "./src/production.js", "./src/feeding-report.js", "./src/reports.js", "./src/home.js", "./src/bootstrap.js"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await Promise.all(CDN_URLS.map(url => cache.add(url).catch(() => null)));
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function fromNetwork(cache, request, cacheKey) {
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheKey || request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

async function serveShell(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match("./index.html");
  if (cached) return cached;
  return fromNetwork(cache, request, "./index.html");
}

async function serveAsset(request, isLocal) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: isLocal });
  if (cached) return cached;
  return fromNetwork(cache, request);
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const isLocal = url.origin === self.location.origin;
  const isCdnLibrary = CDN_URLS.includes(request.url);
  if (request.method !== "GET" || (!isLocal && !isCdnLibrary)) return;

  if (request.mode === "navigate") {
    event.respondWith(serveShell(request));
    return;
  }
  event.respondWith(serveAsset(request, isLocal));
});
