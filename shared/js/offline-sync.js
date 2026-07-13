(function () {
    const QUEUE_KEY = 'marga_firestore_offline_queue_v2';
    const FAILED_QUEUE_KEY = 'marga_firestore_offline_failed_queue_v1';
    const RESPONSE_CACHE_PREFIX = 'marga_firestore_response_cache_v1:';
    const STATUS_ID = 'margaOfflineStatus';
    const STYLE_ID = 'margaOfflineStatusStyles';
    const originalFetch = window.fetch.bind(window);

    function uid(prefix = 'offline') {
        if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function normalizeText(value) {
        return String(value || '').trim();
    }

    function getCurrentFirestoreBaseHref() {
        try {
            return new URL(window.FIREBASE_CONFIG?.baseUrl || '', window.location.origin).href.replace(/\/+$/, '');
        } catch (error) {
            return normalizeText(window.FIREBASE_CONFIG?.baseUrl).replace(/\/+$/, '');
        }
    }

    function isFirestoreUrl(url) {
        try {
            const href = new URL(url || '', window.location.origin).href.replace(/\/+$/, '');
            const baseHref = getCurrentFirestoreBaseHref();
            return Boolean(baseHref) && (href === baseHref || href.startsWith(`${baseHref}/`) || href.startsWith(`${baseHref}:`));
        } catch (error) {
            return normalizeText(url).startsWith(normalizeText(window.FIREBASE_CONFIG?.baseUrl));
        }
    }

    function isRetiredFirestoreWriteUrl(url) {
        const text = normalizeText(url).toLowerCase();
        if (!text) return false;
        if (text.includes('firestore.googleapis.com')) return true;
        return !isFirestoreUrl(url);
    }

    function safeJsonParse(value, fallback = null) {
        try {
            return JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    }

    function readQueue() {
        try {
            const raw = localStorage.getItem(QUEUE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('Unable to read offline write queue.', error);
            return [];
        }
    }

    function readFailedQueue() {
        try {
            const raw = localStorage.getItem(FAILED_QUEUE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('Unable to read failed offline write queue.', error);
            return [];
        }
    }

    function writeQueue(queue) {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
        updateStatusChip();
    }

    function writeFailedQueue(queue) {
        try {
            const safeQueue = Array.isArray(queue) ? queue.slice(-25) : [];
            localStorage.setItem(FAILED_QUEUE_KEY, JSON.stringify(safeQueue));
        } catch (error) {
            console.warn('Unable to write failed offline write queue.', error);
        }
    }

    function queueSize() {
        return readQueue().length;
    }

    function failedQueueSize() {
        return readFailedQueue().length;
    }

    function toFirestoreFieldValue(value) {
        if (value === null) return { nullValue: null };
        if (Array.isArray(value)) {
            return { arrayValue: { values: value.map((entry) => toFirestoreFieldValue(entry)) } };
        }
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number' && Number.isFinite(value)) {
            if (Number.isInteger(value)) return { integerValue: String(value) };
            return { doubleValue: value };
        }
        if (value && typeof value === 'object') {
            const fields = {};
            Object.entries(value).forEach(([key, child]) => {
                if (child === undefined || typeof child === 'function') return;
                fields[key] = toFirestoreFieldValue(child);
            });
            return { mapValue: { fields } };
        }
        return { stringValue: String(value ?? '') };
    }

    function parseFirestoreFieldValue(value) {
        if (!value || typeof value !== 'object') return null;
        if (value.stringValue !== undefined) return value.stringValue;
        if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
        if (value.doubleValue !== undefined) return Number(value.doubleValue);
        if (value.booleanValue !== undefined) return value.booleanValue;
        if (value.nullValue !== undefined) return null;
        if (value.timestampValue !== undefined) return value.timestampValue;
        if (value.arrayValue !== undefined) {
            return (value.arrayValue.values || []).map((entry) => parseFirestoreFieldValue(entry));
        }
        if (value.mapValue !== undefined) {
            const out = {};
            Object.entries(value.mapValue.fields || {}).forEach(([key, child]) => {
                out[key] = parseFirestoreFieldValue(child);
            });
            return out;
        }
        return null;
    }

    function firestoreFieldsToObject(fields) {
        const parsed = {};
        Object.entries(fields || {}).forEach(([key, value]) => {
            parsed[key] = parseFirestoreFieldValue(value);
        });
        return parsed;
    }

    function isNetworkLikeError(error) {
        const message = String(error?.message || error || '').toLowerCase();
        return !message
            || message.includes('failed to fetch')
            || message.includes('networkerror')
            || message.includes('network request failed')
            || message.includes('offline')
            || message.includes('http 503')
            || message.includes('http 502')
            || message.includes('http 504');
    }

    function shouldQueueResponse(response) {
        return !response?.ok && [408, 425, 429, 500, 502, 503, 504].includes(Number(response?.status || 0));
    }

    function buildRequestInfo(input, init = {}) {
        const isRequestObject = typeof Request !== 'undefined' && input instanceof Request;
        const url = isRequestObject ? input.url : String(input || '');
        const method = normalizeText(init.method || (isRequestObject ? input.method : '') || 'GET').toUpperCase();
        const headers = new Headers(init.headers || (isRequestObject ? input.headers : undefined) || {});
        const body = init.body !== undefined ? init.body : null;
        return {
            url,
            method,
            headers,
            body: typeof body === 'string' ? body : null
        };
    }

    function isRunQueryRequest(info) {
        return info.method === 'POST' && info.url.includes(':runQuery');
    }

    function isReadRequest(info) {
        return info.method === 'GET' || isRunQueryRequest(info);
    }

    function shouldBypassFirestoreReadCache(info) {
        const mode = normalizeText(info.headers?.get?.('X-Marga-Offline-Cache') || info.headers?.get?.('x-marga-offline-cache'));
        return mode.toLowerCase() === 'bypass';
    }

    function buildResponseCacheKey(info) {
        const bodyPart = isRunQueryRequest(info) ? `::${info.body || ''}` : '';
        return `${RESPONSE_CACHE_PREFIX}${info.method}::${info.url}${bodyPart}`;
    }

    const BULK_FIRESTORE_COLLECTIONS = new Set([
        'tbl_collectionhistory',
        'tbl_billing',
        'tbl_paymentinfo',
        'tbl_checkpayments',
        'tbl_schedule'
    ]);

    function isCollectionsModulePage() {
        return /\/collections\.html/i.test(String(window.location.pathname || ''));
    }

    function getFirestoreCollectionFromUrl(url) {
        try {
            const pathname = new URL(url, window.location.origin).pathname;
            const marker = '/documents/';
            const index = pathname.indexOf(marker);
            if (index === -1) return '';
            const remainder = pathname.slice(index + marker.length);
            return remainder.split('/').filter(Boolean)[0] || '';
        } catch (error) {
            return '';
        }
    }

    function shouldCacheFirestoreReadResponse(info, payload) {
        if (isCollectionsModulePage()) return false;

        if (!payload || typeof payload !== 'object') return false;

        let serializedLength = 0;
        try {
            serializedLength = JSON.stringify(payload).length;
        } catch (error) {
            return false;
        }

        if (serializedLength > 400000) return false;

        const collection = getFirestoreCollectionFromUrl(info.url);
        if (!BULK_FIRESTORE_COLLECTIONS.has(collection)) return true;

        const docCount = Array.isArray(payload.documents) ? payload.documents.length : 0;
        let pageSize = 0;
        try {
            pageSize = Number(new URL(info.url, window.location.origin).searchParams.get('pageSize') || 0);
        } catch (error) {
            pageSize = 0;
        }

        return docCount < 100 && pageSize < 200;
    }

    function pruneResponseCache() {
        const keys = [];
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key && key.startsWith(RESPONSE_CACHE_PREFIX)) keys.push(key);
        }
        keys.forEach((key) => localStorage.removeItem(key));
    }

    function readCachedResponse(info) {
        if (isCollectionsModulePage()) return null;
        try {
            const raw = localStorage.getItem(buildResponseCacheKey(info));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            return parsed.payload;
        } catch (error) {
            console.warn('Unable to read cached Firestore response.', error);
            return null;
        }
    }

    function writeCachedResponse(info, payload) {
        if (!shouldCacheFirestoreReadResponse(info, payload)) return;
        try {
            localStorage.setItem(buildResponseCacheKey(info), JSON.stringify({
                cachedAt: new Date().toISOString(),
                payload
            }));
        } catch (error) {
            const isQuotaError = error && (error.name === 'QuotaExceededError' || String(error).includes('QuotaExceededError'));
            if (isQuotaError) {
                try {
                    pruneResponseCache();
                } catch (pruneError) {
                    console.warn('Unable to prune Firestore response cache.', pruneError);
                }
            }
            console.warn('Unable to cache Firestore response.', error);
        }
    }

    function buildJsonResponse(payload, status = 200) {
        return new Response(JSON.stringify(payload), {
            status,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    function parseFirestoreWriteInfo(url, bodyText) {
        try {
            const parsedUrl = new URL(url);
            const afterDocuments = parsedUrl.pathname.split('/documents/')[1] || '';
            const pathBits = afterDocuments.split('/').filter(Boolean);
            const collection = pathBits[0] || '';
            const pathDocId = pathBits.length > 1 ? decodeURIComponent(pathBits[1]) : '';
            const docId = normalizeText(parsedUrl.searchParams.get('documentId') || pathDocId);
            const payload = safeJsonParse(bodyText, {});
            const fields = firestoreFieldsToObject(payload?.fields || {});
            if (!collection || !docId) return null;
            return { collection, docId, fields };
        } catch (error) {
            return null;
        }
    }

    function ensureStatusStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${STATUS_ID} {
                position: fixed;
                right: 18px;
                bottom: 18px;
                z-index: 9999;
                display: none;
                align-items: center;
                gap: 10px;
                min-width: min(320px, calc(100vw - 28px));
                max-width: min(420px, calc(100vw - 28px));
                padding: 12px 14px;
                border-radius: 18px;
                border: 1px solid rgba(18, 56, 49, 0.14);
                background: rgba(255, 252, 245, 0.96);
                box-shadow: 0 16px 40px rgba(18, 38, 35, 0.16);
                backdrop-filter: blur(18px);
                color: #1e4038;
                font-family: 'Manrope', system-ui, sans-serif;
            }
            #${STATUS_ID}.visible {
                display: flex;
            }
            #${STATUS_ID}::before {
                content: '';
                width: 12px;
                height: 12px;
                border-radius: 999px;
                flex: 0 0 auto;
                background: #c98b39;
                box-shadow: 0 0 0 4px rgba(201, 139, 57, 0.16);
            }
            #${STATUS_ID}.is-online::before {
                background: #2f865f;
                box-shadow: 0 0 0 4px rgba(47, 134, 95, 0.16);
            }
            #${STATUS_ID}.is-offline::before {
                background: #c98b39;
                box-shadow: 0 0 0 4px rgba(201, 139, 57, 0.16);
            }
            #${STATUS_ID}.has-queue::before {
                background: #3b82f6;
                box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.16);
            }
            .marga-offline-status-copy {
                display: grid;
                gap: 2px;
                min-width: 0;
            }
            .marga-offline-status-title {
                font-size: 0.82rem;
                font-weight: 800;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }
            .marga-offline-status-text {
                font-size: 0.92rem;
                line-height: 1.35;
                color: rgba(30, 64, 56, 0.76);
            }
            .marga-offline-status-count {
                margin-left: auto;
                padding: 6px 10px;
                border-radius: 999px;
                background: rgba(18, 56, 49, 0.08);
                font-size: 0.8rem;
                font-weight: 800;
                white-space: nowrap;
            }
            @media (max-width: 640px) {
                #${STATUS_ID} {
                    left: 14px;
                    right: 14px;
                    bottom: 14px;
                    max-width: none;
                    min-width: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function ensureStatusChip() {
        let node = document.getElementById(STATUS_ID);
        if (node) return node;
        ensureStatusStyles();
        node = document.createElement('div');
        node.id = STATUS_ID;
        node.innerHTML = `
            <div class="marga-offline-status-copy">
                <div class="marga-offline-status-title">Sync Status</div>
                <div class="marga-offline-status-text"></div>
            </div>
            <div class="marga-offline-status-count"></div>
        `;
        document.body.appendChild(node);
        return node;
    }

    function updateStatusChip() {
        if (!document.body) return;
        const node = ensureStatusChip();
        const count = queueSize();
        const failedCount = failedQueueSize();
        const online = navigator.onLine !== false;
        const title = node.querySelector('.marga-offline-status-title');
        const text = node.querySelector('.marga-offline-status-text');
        const countNode = node.querySelector('.marga-offline-status-count');

        node.classList.toggle('visible', !online || count > 0);
        node.classList.toggle('is-online', online && count === 0);
        node.classList.toggle('is-offline', !online);
        node.classList.toggle('has-queue', count > 0);

        if (!online) {
            title.textContent = 'Offline Mode';
            text.textContent = count
                ? 'Saves are being kept in this browser and will sync back automatically when the internet returns.'
                : 'You can keep working. New cloud saves will queue here until the internet returns.';
        } else if (count > 0) {
            title.textContent = 'Sync Pending';
            text.textContent = 'Queued saves are waiting to sync. Keep this tab open or reconnect to finish sending them.';
        } else {
            title.textContent = 'Online';
            text.textContent = failedCount > 0
                ? 'All retryable queued changes are already synced.'
                : 'All queued changes are already synced.';
        }

        countNode.textContent = count > 0 ? `${count} queued` : (online ? 'Up to date' : 'Offline');
    }

    function enqueueWrite(action) {
        const queue = readQueue();
        const dedupeKey = normalizeText(action.dedupeKey);
        const nextItem = {
            id: uid('queue'),
            queuedAt: new Date().toISOString(),
            kind: action.kind || 'structured',
            mode: action.mode === 'patch' ? 'patch' : 'set',
            collection: normalizeText(action.collection),
            docId: normalizeText(action.docId),
            fields: action.fields || {},
            label: normalizeText(action.label),
            dedupeKey,
            url: action.url || '',
            method: normalizeText(action.method || '').toUpperCase(),
            headers: action.headers || {},
            body: action.body || ''
        };

        if (dedupeKey) {
            const index = queue.findIndex((item) => normalizeText(item.dedupeKey) === dedupeKey);
            if (index >= 0) {
                queue[index] = { ...queue[index], ...nextItem, id: queue[index].id };
            } else {
                queue.push(nextItem);
            }
        } else {
            queue.push(nextItem);
        }

        writeQueue(queue);
        return nextItem;
    }

    function archiveFailedWrite(action, reason = '') {
        const failedQueue = readFailedQueue();
        failedQueue.push({
            ...action,
            failedAt: new Date().toISOString(),
            lastError: normalizeText(reason) || normalizeText(action?.lastError) || 'Write could not be synced automatically.'
        });
        writeFailedQueue(failedQueue);
    }

    async function executeStructuredWrite(action) {
        const collection = normalizeText(action.collection);
        const docId = encodeURIComponent(normalizeText(action.docId));
        const mode = action.mode === 'patch' ? 'patch' : 'set';
        const fields = action.fields || {};
        const body = { fields: {} };

        Object.entries(fields).forEach(([key, value]) => {
            body.fields[key] = toFirestoreFieldValue(value);
        });

        const params = mode === 'patch'
            ? `&${Object.keys(fields).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&')}`
            : '';

        const response = await originalFetch(
            `${FIREBASE_CONFIG.baseUrl}/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}${params}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }
        );
        const payload = await response.json();
        if (!response.ok || payload?.error) {
            throw new Error(payload?.error?.message || `Failed to ${mode} ${collection}/${action.docId}`);
        }
        return payload;
    }

    async function executeRawWrite(action) {
        const response = await originalFetch(action.url, {
            method: action.method,
            headers: action.headers || {},
            body: action.body || undefined
        });
        let payload = null;
        try {
            payload = await response.clone().json();
        } catch (error) {
            payload = null;
        }
        if (!response.ok || payload?.error) {
            throw new Error(payload?.error?.message || `Failed to replay ${action.method} ${action.url}`);
        }
        return payload;
    }

    async function writeFirestoreDoc({ mode = 'set', collection, docId, fields, label = '', dedupeKey = '' }) {
        const action = {
            kind: 'structured',
            mode,
            collection,
            docId,
            fields,
            label,
            dedupeKey
        };

        if (navigator.onLine === false) {
            enqueueWrite(action);
            return { ok: true, queued: true };
        }

        try {
            await executeStructuredWrite(action);
            updateStatusChip();
            return { ok: true, queued: false };
        } catch (error) {
            if (!isNetworkLikeError(error)) throw error;
            enqueueWrite(action);
            return { ok: true, queued: true };
        }
    }

    function queueRawFirestoreRequest(info, writeMeta = null) {
        return enqueueWrite({
            kind: 'raw',
            mode: 'set',
            collection: writeMeta?.collection || '',
            docId: writeMeta?.docId || '',
            fields: writeMeta?.fields || {},
            label: writeMeta?.collection || 'Firestore request',
            dedupeKey: writeMeta?.collection && writeMeta?.docId ? `raw:${writeMeta.collection}:${writeMeta.docId}` : `raw:${info.method}:${info.url}`,
            url: info.url,
            method: info.method,
            headers: Object.fromEntries(info.headers.entries()),
            body: info.body || ''
        });
    }

    async function flushQueue() {
        if (navigator.onLine === false) return { processed: 0, remaining: queueSize() };
        const queue = readQueue();
        if (!queue.length) {
            updateStatusChip();
            return { processed: 0, remaining: 0 };
        }

        const remaining = [];
        let processed = 0;
        let failed = 0;

        for (const item of queue) {
            try {
                if (item.kind === 'raw') {
                    if (isRetiredFirestoreWriteUrl(item.url)) {
                        archiveFailedWrite(item, 'Blocked queued write because it targets a retired backend URL.');
                        failed += 1;
                        continue;
                    }
                    await executeRawWrite(item);
                } else {
                    await executeStructuredWrite(item);
                }
                processed += 1;
            } catch (error) {
                if (isNetworkLikeError(error)) {
                    remaining.push(item);
                } else {
                    archiveFailedWrite(item, String(error?.message || error || 'Unknown error'));
                    failed += 1;
                }
            }
        }

        writeQueue(remaining);
        if (processed > 0) {
            window.MargaUtils?.showToast(`${processed} queued change(s) synced.`, 'success', 3200);
        }
        if (failed > 0) {
            window.MargaUtils?.showToast(`${failed} stale queued change(s) need to be re-saved from the app.`, 'warning', 5200);
        }
        return { processed, remaining: remaining.length, failed };
    }

    function mergePendingCollectionRows(collection, rows) {
        const baseRows = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
        const pending = readQueue().filter((item) => normalizeText(item.collection) === normalizeText(collection));
        if (!pending.length) return baseRows;

        const rowMap = new Map();
        baseRows.forEach((row) => {
            const key = normalizeText(row?._docId || row?.id);
            if (key) rowMap.set(key, { ...row });
        });

        pending.forEach((item) => {
            const key = normalizeText(item.docId || item.fields?.id);
            if (!key) return;
            const existing = rowMap.get(key) || {};
            rowMap.set(key, {
                ...existing,
                ...item.fields,
                _docId: key
            });
        });

        return [...rowMap.values()];
    }

    async function handleFirestoreRead(info, input, init) {
        if (shouldBypassFirestoreReadCache(info)) {
            return originalFetch(input, init);
        }
        try {
            const response = await originalFetch(input, init);
            try {
                const payload = await response.clone().json();
                writeCachedResponse(info, payload);
            } catch (error) {
                /* ignore non-json */
            }
            return response;
        } catch (error) {
            const cached = readCachedResponse(info);
            if (cached !== null && cached !== undefined) {
                return buildJsonResponse(cached, 200);
            }
            throw error;
        }
    }

    async function handleFirestoreWrite(info, input, init) {
        const writeMeta = parseFirestoreWriteInfo(info.url, info.body);

        if (navigator.onLine === false) {
            queueRawFirestoreRequest(info, writeMeta);
            return buildJsonResponse({ queuedOffline: true, ok: true }, 200);
        }

        try {
            const response = await originalFetch(input, init);
            if (shouldQueueResponse(response)) {
                queueRawFirestoreRequest(info, writeMeta);
                return buildJsonResponse({ queuedOffline: true, ok: true, retryStatus: response.status }, 200);
            }
            return response;
        } catch (error) {
            if (!isNetworkLikeError(error)) throw error;
            queueRawFirestoreRequest(info, writeMeta);
            return buildJsonResponse({ queuedOffline: true, ok: true }, 200);
        }
    }

    function installFetchInterceptor() {
        if (window.__margaOfflineFetchInstalled) return;
        window.__margaOfflineFetchInstalled = true;

        window.fetch = async function margaOfflineAwareFetch(input, init = {}) {
            const info = buildRequestInfo(input, init);
            if (!isFirestoreUrl(info.url)) {
                return originalFetch(input, init);
            }

            if (isReadRequest(info)) {
                return handleFirestoreRead(info, input, init);
            }

            return handleFirestoreWrite(info, input, init);
        };
    }

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch((error) => {
            console.warn('Service worker registration failed', error);
        });
    }

    function init() {
        installFetchInterceptor();
        registerServiceWorker();
        updateStatusChip();
        window.addEventListener('online', async () => {
            updateStatusChip();
            await flushQueue();
        });
        window.addEventListener('offline', updateStatusChip);
        window.addEventListener('storage', (event) => {
            if (event.key === QUEUE_KEY || event.key === FAILED_QUEUE_KEY) updateStatusChip();
        });

        if (navigator.onLine !== false) {
            window.setTimeout(() => {
                flushQueue().catch((error) => console.warn('Offline queue flush failed.', error));
            }, 1200);
        }
    }

    window.MargaOfflineSync = {
        getQueue: readQueue,
        getFailedQueue: readFailedQueue,
        queueSize,
        failedQueueSize,
        enqueueWrite,
        writeFirestoreDoc,
        flushQueue,
        mergePendingCollectionRows,
        updateStatusChip
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
