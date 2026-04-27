const CACHE_NAME = 'marga-app-shell-v5';
const UPDATE_MESSAGE = {
    type: 'MARGA_APP_UPDATED',
    cacheName: CACHE_NAME
};
const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/dashboard.html',
    '/manifest.json',
    '/favicon.ico',
    '/install/',
    '/install/index.html',
    '/install/install.css',
    '/install/install.js',
    '/assets/icons/favicon-16.png',
    '/assets/icons/favicon-32.png',
    '/assets/icons/apple-touch-icon.png',
    '/assets/icons/icon-192.png',
    '/assets/icons/icon-384.png',
    '/assets/icons/icon-512.png',
    '/billing/',
    '/billing/index.html',
    '/billing/css/billing.css',
    '/billing/js/billing.js',
    '/customers/',
    '/customers/index.html',
    '/customers.html',
    '/customers/js/customer-form.js',
    '/customers/js/customers.js',
    '/collections.html',
    '/collections/js/collections.js',
    '/field/',
    '/field/index.html',
    '/field/css/field.css',
    '/field/js/field.js?v=20260324-3',
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
    '/service/',
    '/service/index.html',
    '/service/css/service.css',
    '/service/js/dispatch-board.js',
    '/service/js/service.js',
    '/settings/',
    '/settings/index.html',
    '/settings/css/settings.css',
    '/settings/js/settings.js',
    '/sync/',
    '/sync/index.html',
    '/sync/css/sync.css',
    '/sync/js/sync.js',
    '/shared/css/styles.css',
    '/shared/css/dashboard.css',
    '/shared/js/firebase-config.js',
    '/shared/js/auth.js',
    '/shared/js/utils.js',
    '/shared/js/finance-accounts.js',
    '/shared/js/offline-sync.js',
    '/shared/js/pwa-install.js'
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

self.addEventListener('message', (event) => {
    if (event.data?.type === 'MARGA_SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
            await self.clients.claim();
            const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
            clients.forEach((client) => client.postMessage(UPDATE_MESSAGE));
        })()
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const requestUrl = new URL(event.request.url);
    const isSameOrigin = requestUrl.origin === self.location.origin;
    const isNavigate = event.request.mode === 'navigate';
    const isFreshFirstAsset = isSameOrigin && (
        requestUrl.pathname.endsWith('.html')
        || requestUrl.pathname.endsWith('.js')
        || requestUrl.pathname.endsWith('.css')
        || requestUrl.pathname.endsWith('.json')
        || requestUrl.pathname.endsWith('/manifest.json')
        || requestUrl.pathname === '/'
    );

    async function fetchAndCache(request) {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
        }
        return response;
    }

    event.respondWith(
        (async () => {
            if (isNavigate) {
                try {
                    return await fetchAndCache(event.request);
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

            if (isFreshFirstAsset) {
                try {
                    return await fetchAndCache(event.request);
                } catch (error) {
                    return caches.match(event.request)
                        || new Response('Offline', { status: 503, statusText: 'Offline' });
                }
            }

            const cached = await caches.match(event.request);
            const networkPromise = fetch(event.request, { cache: 'no-store' })
                .then(async (response) => {
                    if (response.ok) {
                        const cache = await caches.open(CACHE_NAME);
                        cache.put(event.request, response.clone());
                    }
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
