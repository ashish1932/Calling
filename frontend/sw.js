const CACHE_NAME = 'counselflow-cache-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/data.js',
  '/js/i18n.js',
  '/js/app.js',
  '/js/ai.js',
  '/js/calling.js',
  '/js/charts.js',
  '/js/profiles.js',
  '/js/opd-app.js',
  '/assets/logo.png',
  '/assets/punjab-logo.svg',
  '/assets/punjab_cm.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching App Shell');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[SW] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: Network first, fallback to cached response (if GET)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (event.request.method === 'GET' && response.status === 200) {
            const clone = response.clone();
            caches.open('counselflow-api-cache').then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.method === 'GET') {
            return caches.match(event.request);
          }
          return new Response(JSON.stringify({ error: 'Network offline. Request queued.', offline: true }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
  } else {
    // Static assets: Cache first, fallback to network
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).then(fetchRes => {
          return caches.open(CACHE_NAME).then(cache => {
            if(event.request.method === 'GET') {
               cache.put(event.request, fetchRes.clone());
            }
            return fetchRes;
          });
        });
      })
    );
  }
});
