const CACHE_NAME = 'noteworthy-exp-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './api.js',
  './firebase.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install Event: cache static shell
self.addEventListener('install', e => {
  self.skipWaiting(); // Force the waiting service worker to become the active service worker.
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url =>
        cache.add(url).catch(err => console.warn('SW: skipped', url, err.message))
      ))
    ).catch(err => console.error("SW Install Error", err))
  );
});

// Activate Event: clean up old caches immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // Immediately take control of all clients
  );
});

// Fetch Event: Stale-While-Revalidate for local assets
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  
  const url = new URL(e.request.url);
  const isLocal = url.origin === self.location.origin;
  
  // Do not intercept external requests (like Firestore or Gemini calls)
  if (!isLocal) return;

  // Do not cache or intercept client-side sync code to avoid caching/stale scripts
  if (url.pathname.includes('sync-client.js')) return;

  // Fix GitHub pages subdirectory redirect bug:
  // If the browser requests the subdirectory without a trailing slash, the SW fetch
  // would resolve it but keep the address bar without the slash, causing relative assets
  // to resolve to the root domain (e.g. prineethr.com/style.css). We force a redirect.
  if (url.pathname === '/noteworthy/exp') {
    e.respondWith(Response.redirect(url.origin + '/noteworthy/exp/', 301));
    return;
  }
  if (url.pathname === '/noteworthy') {
    e.respondWith(Response.redirect(url.origin + '/noteworthy/', 301));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        }
        return networkResponse;
      })
      .catch(async () => {
        const hit = await caches.match(e.request);
        if (hit) return hit;
        // A cold open with no signal should still land on the app shell.
        if (e.request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
