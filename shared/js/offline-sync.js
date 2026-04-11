(function () {
    const QUEUE_KEY = 'marga_firestore_offline_queue_v1';
    const STATUS_ID = 'margaOfflineStatus';
    const STYLE_ID = 'margaOfflineStatusStyles';

    function uid(prefix = 'offline') {
        if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function normalizeText(value) {
        return String(value || '').trim();
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

    function writeQueue(queue) {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
        updateStatusChip();
    }

    function queueSize() {
        return readQueue().length;
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
        return { stringValue: String(value ?? '') };
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
            text.textContent = 'All queued changes are already synced.';
        }

        countNode.textContent = count > 0 ? `${count} queued` : (online ? 'Up to date' : 'Offline');
    }

    function enqueueWrite(action) {
        const queue = readQueue();
        const dedupeKey = normalizeText(action.dedupeKey);
        const nextItem = {
            id: uid('queue'),
            queuedAt: new Date().toISOString(),
            mode: action.mode === 'patch' ? 'patch' : 'set',
            collection: normalizeText(action.collection),
            docId: normalizeText(action.docId),
            fields: action.fields || {},
            label: normalizeText(action.label),
            dedupeKey
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

    async function executeFirestoreWrite(action) {
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

        const response = await fetch(
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

    async function writeFirestoreDoc({ mode = 'set', collection, docId, fields, label = '', dedupeKey = '' }) {
        const action = {
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
            await executeFirestoreWrite(action);
            updateStatusChip();
            return { ok: true, queued: false };
        } catch (error) {
            if (!isNetworkLikeError(error)) throw error;
            enqueueWrite(action);
            return { ok: true, queued: true };
        }
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

        for (const item of queue) {
            try {
                await executeFirestoreWrite(item);
                processed += 1;
            } catch (error) {
                if (isNetworkLikeError(error)) {
                    remaining.push(item);
                } else {
                    remaining.push({ ...item, lastError: String(error?.message || error || 'Unknown error') });
                }
            }
        }

        writeQueue(remaining);
        if (processed > 0) {
            window.MargaUtils?.showToast(`${processed} queued change(s) synced.`, 'success', 3200);
        }
        return { processed, remaining: remaining.length };
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

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch((error) => {
            console.warn('Service worker registration failed', error);
        });
    }

    function init() {
        registerServiceWorker();
        updateStatusChip();
        window.addEventListener('online', async () => {
            updateStatusChip();
            await flushQueue();
        });
        window.addEventListener('offline', updateStatusChip);
        window.addEventListener('storage', (event) => {
            if (event.key === QUEUE_KEY) updateStatusChip();
        });

        if (navigator.onLine !== false) {
            window.setTimeout(() => {
                flushQueue().catch((error) => console.warn('Offline queue flush failed.', error));
            }, 1200);
        }
    }

    window.MargaOfflineSync = {
        getQueue: readQueue,
        queueSize,
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
