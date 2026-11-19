// Service worker: makes the app installable and load without a network round trip.
// Pages are network-first (fresh after an update, cached when offline); everything
// else is served from cache and refreshed in the background, so an update reaches a
// phone on its next load. Playing still needs the internet to find the other phones.

const CACHE = 'avalon-v1';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'vendor/peerjs.min.js',
  'vendor/qrcode.mjs',
  'src/rules.js',
  'src/game.js',
  'src/view.js',
  'src/host.js',
  'src/net/local.js',
  'src/net/peer.js',
  'src/ui/app.js',
  'src/ui/render.js',
  'src/ui/text.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('index.html', response.clone());
    return response;
  } catch {
    return (await cache.match('index.html')) ?? Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request, { ignoreSearch: true });
  const fresh = fetch(event.request).then((response) => {
    if (response.ok) cache.put(event.request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(fresh.catch(() => {}));
    return cached;
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Only the app page itself; the dev table and other pages go straight to the network.
    const path = new URL(request.url).pathname;
    if (path.endsWith('/') || path.endsWith('/index.html')) event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(event));
});
