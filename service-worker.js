const CACHE_NAME = 'marga-app-shell-v2';
const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/dashboard.html',
    '/pettycash/',
    '/pettycash/index.html',
    '/pettycash/css/pettycash.css',
    '/pettycash/js/pettycash.js',
    '/inventory/',
    '/inventory/index.html',
    '/inventory/css/inventory.css',
    '/inventory/js/inventory.js',
    '/apd/',
    '/apd/index.html',
    '/apd/css/apd.css',
    '/apd/js/apd.js',
    '/shared/css/styles.css',
    '/shared/css/dashboard.css',
    '/shared/js/firebase-config.js',
    '/shared/js/auth.js',
    '/shared/js/utils.js',
    '/shared/js/finance-accounts.js',
    '/shared/js/offline-sync.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await Promise.allSettled(
                SHELL_ASSETS.map(async (asset) => {
                    try {
                        await cache.add(asset);
                    } catch (error) {
                        console.warn('Service worker cache skipped asset:', asset, error);
                    }
                })
            );
        })
    );
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

    const requestUrl = new URL(event.request.url);
    const isSameOrigin = requestUrl.origin === self.location.origin;
    const isNavigate = event.request.mode === 'navigate';

    event.respondWith(
        (async () => {
            if (isNavigate) {
                try {
                    const fresh = await fetch(event.request);
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(event.request, fresh.clone());
                    return fresh;
                } catch (error) {
                    return caches.match(event.request)
                        || caches.match('/dashboard.html')
                        || caches.match('/index.html')
                        || new Response('Offline', { status: 503, statusText: 'Offline' });
                }
            }

            if (!isSameOrigin) {
                return fetch(event.request);
            }

            const cached = await caches.match(event.request);
            const networkPromise = fetch(event.request)
                .then(async (response) => {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(event.request, response.clone());
                    return response;
                });

            if (cached) {
                event.waitUntil(networkPromise.catch(() => null));
                return cached;
            }

            try {
                return await networkPromise;
            } catch (error) {
                return new Response('Offline', { status: 503, statusText: 'Offline' });
            }
        })()
    );
});
