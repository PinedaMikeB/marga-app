const CACHE_NAME = 'marga-app-shell-v158-master-snapshot-1';
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
    '/billing/css/billing.css?v=20260529-envelope-landscape-1',
    '/billing/js/billing.js?v=20260529-envelope-landscape-1',
    '/customers/',
    '/customers/index.html',
    '/customers.html',
    '/customers/js/customer-form.js',
    '/customers/js/customers.js?v=20260617-customer-toolbar-1',
    '/collections.html',
    '/collections/js/collections.js?v=20260601-summary-autoupdate-1',
    '/master-schedule.html',
    '/master-schedule/js/master-schedule.js?v=20260618-master-snapshot-1',
    '/field/',
    '/field/index.html',
    '/field/css/field.css?v=20260604-field-tin-7',
    '/field/js/field.js?v=20260618-workload-cutoff-1',
    '/purchasing/',
    '/purchasing/index.html',
    '/purchasing/css/purchasing.css?v=20260616-purchasing-4',
    '/purchasing/js/purchasing.js?v=20260616-purchasing-5',
    '/hr/',
    '/hr/index.html',
    '/hr/css/hr.css?v=20260604-payroll-deductions-summary-2',
    '/hr/js/hr.js?v=20260604-payroll-deductions-summary-2',
    '/pettycash/',
    '/pettycash/index.html',
    '/pettycash/css/pettycash.css',
    '/pettycash/js/pettycash.js?v=20260617-pettycash-field-sync-guard-1',
    '/accounting/',
    '/accounting/index.html',
    '/accounting/css/accounting.css',
    '/accounting/js/accounting.js',
    '/inventory/',
    '/inventory/index.html',
    '/inventory/css/inventory.css',
    '/inventory/js/inventory.js',
    '/apd/',
    '/apd/index.html',
    '/apd/css/apd.css',
    '/apd/js/apd.js?v=20260527-storage-safe-1',
    '/service/',
    '/service/index.html',
    '/service/css/service.css?v=20260505-delivery-history-status-1',
    '/service/js/dispatch-board.js?v=20260521-margabase-refresh-1',
    '/service/js/service.js',
    '/settings/',
    '/settings/index.html',
    '/settings/css/settings.css',
    '/settings/js/settings.js?v=20260512-firebase-only-1',
    '/sync/',
    '/sync/index.html',
    '/sync/css/sync.css',
    '/sync/js/sync.js',
    '/shared/css/styles.css',
    '/shared/css/dashboard.css',
    '/shared/css/attendance-time-records.css?v=20260616-time-records-ot-form-5',
    '/shared/js/payroll-cutoff.js?v=20260615-time-records-5',
    '/shared/js/attendance-time-records.js?v=20260616-time-records-ot-remove-6',
    '/shared/js/firebase-config.js?v=20260601-local-postgres-live-1',
    '/shared/js/auth.js?v=20260616-purchasing-staff-1',
    '/shared/js/utils.js?v=20260516-field-permissions-3',
    '/shared/js/finance-accounts.js',
    '/shared/js/expense-request-catalog.js?v=20260609-item-group-catalog-1',
    '/shared/js/expense-line-item-ui.js?v=20260609-item-group-catalog-1',
    '/shared/js/expense-supplier-options.js?v=20260609-supplier-datalist-1',
    '/shared/js/offline-sync.js?v=20260601-local-postgres-live-1',
    '/shared/js/pwa-install.js?v=20260520-update-waits-1'
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
    const isFunctionRequest = isSameOrigin && requestUrl.pathname.startsWith('/.netlify/functions/');
    const isMargabaseRequest = isSameOrigin && requestUrl.pathname.startsWith('/margabase-api/');
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

            if (isFunctionRequest || isMargabaseRequest) {
                try {
                    return await fetch(event.request, { cache: 'no-store' });
                } catch (error) {
                    return new Response('Offline', { status: 503, statusText: 'Offline' });
                }
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
