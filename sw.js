const CACHE_NAME = 'noteworthy-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './style-analog.css',
  './style-brutalist.css',
  './style-glass.css',
  './style-neon.css',
  './app.js',
  './api.js',
  './firebase.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install Event: cache static shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: clean up old caches
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
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Stale-While-Revalidate for local assets
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  
  const url = new URL(e.request.url);
  const isLocal = url.origin === self.location.origin;
  
  // Do not intercept external requests (like Firestore or Gemini calls)
  if (!isLocal) return;

  e.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(e.request).then(cachedResponse => {
        const fetchPromise = fetch(e.request).then(networkResponse => {
          if (networkResponse.status === 200) {
            cache.put(e.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // Ignore network errors when offline
        });
        return cachedResponse || fetchPromise;
      });
    })
  );
});
