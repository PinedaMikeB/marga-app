const CACHE_NAME = 'msp-shell-v3';
const SHELL_ASSETS = [
  '/',
  '/install/',
  '/install/index.html',
  '/install/install.css',
  '/install/install.js',
  '/public/index.html',
  '/public/tech/index.html',
  '/public/offline.html',
  '/src/styles/app.css',
  '/src/styles/portal.css',
  '/src/styles/tech.css',
  '/src/lib/install-guide.js',
  '/src/portal-main.js',
  '/src/tech-main.js',
  '/public/config.js',
  '/public/assets/icons/icon-192.svg',
  '/public/assets/icons/icon-512.svg',
  '/public/assets/icons/icon-192.png',
  '/public/assets/icons/icon-512.png',
  '/public/assets/icons/tech-icon-192.svg',
  '/public/assets/icons/tech-icon-512.svg',
  '/public/assets/icons/tech-icon-192.png',
  '/public/assets/icons/tech-icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/public/offline.html');
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
