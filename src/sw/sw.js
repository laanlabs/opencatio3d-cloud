// OpenCatio3D service worker — the template; `vite build` writes dist/sw.js from it (offlinePlugin in
// vite.config.ts) with this build's file list and version. It keeps the planner, Build mode and the
// games working without a connection once the app has been opened:
// - install: cache every built file, so the whole app is on the device (about 2 MB);
// - pages: network first (a deploy shows up at once), falling back to the cached app offline;
// - /assets/*: from the cache (file names carry content hashes, so they never go stale), else network;
// - other files (icons, manifest): cached copy, refreshed in the background.
// Projects live in IndexedDB, not here. Other origins (analytics) are not touched.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `oc3d-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('oc3d-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function fromNetwork(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // The cached page always matches the cached assets, so it is not overwritten here.
    event.respondWith(fromNetwork(request, 4000).catch(async () => (await caches.match('/', { cacheName: CACHE })) ?? Response.error()));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Every asset of this version is precached; a miss is another version's file, fetched but not kept
    // (keeping it would recreate this cache after a newer worker has cleared it).
    event.respondWith(caches.match(request, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)));
    return;
  }
  event.respondWith((async () => {
    const hit = await caches.match(request, { cacheName: CACHE, ignoreSearch: true });
    const fresh = fetch(request).then((res) => {
      if (res.ok && hit) caches.open(CACHE).then((c) => c.put(request, res.clone()));
      return res;
    });
    if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  })());
});
