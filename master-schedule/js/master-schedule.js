if (window.MargaAuth && !MargaAuth.requireAccess('master-schedule')) {
    throw new Error('Unauthorized access to master schedule module.');
}

const MASTER_API_KEY = FIREBASE_CONFIG.apiKey;
const MASTER_BASE_URL = FIREBASE_CONFIG.baseUrl;
const MASTER_LIMIT = 1200;
const MASTER_CARRYOVER_CUTOFF_HOUR = 17;
const MASTER_CARRYOVER_CUTOFF_MINUTE = 30;
const ROUTE_COLLECTION_PRIMARY = 'tbl_printedscheds';
const ROUTE_COLLECTION_FALLBACK = 'tbl_savedscheds';
const MASTER_ACTIVITY_COLLECTION = 'marga_master_schedule_activity';
const PENDING_NOT_ROUTED_LOOKBACK_DAYS = 45;
const PENDING_CARRYOVER_START_DATE = '2026-05-04';
const REQUIRED_PRIORITY_COUNT = 5;
const MASTER_OVERRIDE_TTL_MS = 15 * 60 * 1000;
const MASTER_OVERRIDE_APPROVER_KEYWORDS = ['emman', 'john emmanuel', 'olbedo', 'cha', 'analee'];
const MASTER_SNAPSHOT_FETCH_MS = 20000;
const ZERO_DATETIME = '0000-00-00 00:00:00';
const LEGACY_EMPTY_DATETIME_VALUES = new Set([
    '',
    ZERO_DATETIME,
    'undefined',
    'undefined 00:00:00',
    'null',
    'null 00:00:00',
    'invalid date',
    'nan'
]);

const DEFAULT_AREAS = [
    'South 1', 'South 2', 'South 3',
    'Quezon 1', 'Quezon 2', 'Quezon 3',
    'PMS 1', 'PMS 2',
    'Manila 1', 'Manila 2',
    'Makati 1', 'Makati 2', 'Makati 3',
    'Rizal 1', 'Rizal 2',
    'All', 'Others', 'N/A'
];

const DEFAULT_CITIES = [
    'Alabang', 'Alaminos', 'Angeles', 'Angono', 'Antipolo', 'Bacoor', 'Bago', 'Baguio',
    'Bais', 'Balanga', 'Binan', 'Calamba', 'Cavite City', 'Dasmarinas', 'General Trias',
    'Imus', 'Laguna', 'Las Pinas', 'Muntinlupa', 'Tagaytay', 'Trece Martires'
];

const MASTER_PURPOSE_LABELS = {
    1: 'Printed Billing',
    2: 'Confirmed Collection',
    3: 'Deliver Toner',
    4: 'Deliver Ink',
    5: 'Service',
    7: 'Purchasing',
    8: 'Printed Billing',
    9: 'Others'
};

const CLIENT_INFO_TYPES = [
    { key: 'service', label: 'Service Info' },
    { key: 'billing', label: 'Billing Info' },
    { key: 'collection', label: 'Collection Info' },
    { key: 'delivery', label: 'Delivery Info' }
];

const MASTER_STATUS_OPTIONS = [
    { value: 'open', label: 'Open' },
    { value: 'closed_fixed', label: 'Closed (Fixed)' },
    { value: 'closed_under_observation', label: 'Closed (Under Observation)' },
    { value: 'closed_over_the_phone', label: 'Closed (Over The Phone)' },
    { value: 'closed_via_field_app', label: 'Closed (Via Field App)' },
    { value: 'open_with_request', label: 'Open (With Request)' }
];

const masterState = {
    rows: [],
    displayRows: [],
    pendingRows: [],
    exceptionRows: [],
    settingsLoaded: false,
    reassigning: false,
    routeSourceLabel: 'Saved',
    routeCoverage: {
        routed: 0,
        unrouted: 0
    },
    kaizen: {
        visible: false,
        report: null,
        applying: false,
        prioritizing: false
    },
    selectedStatusRowKey: '',
    selectedArea: DEFAULT_AREAS[0],
    selectedTechId: '',
    selectedBranchId: '',
    customAreas: new Set(),
    customCities: new Set(),
    areaCityRows: new Map(),
    techAreaRows: new Map(),
    clientAreaRows: new Map(),
    lookups: {
        branches: new Map(),
        companies: new Map(),
        machines: new Map(),
        contracts: new Map(),
        contractDeps: new Map(),
        employees: new Map(),
        positions: new Map(),
        troubles: new Map(),
        areas: new Map(),
        models: new Map(),
        deliveryInfoByBranch: new Map(),
        serviceRequests: new Map(),
        finalDeliveryReceipts: new Map(),
        closeRequestsBySchedule: new Map()
    },
    closeRequestRows: [],
    activityLogs: new Map(),
    routeForwarding: false,
    activeEmployeeEmails: new Set(),
    inactiveRosterApprovals: new Map(),
    staffBucketFilters: new Map(),
    staffFieldBuckets: new Map(),
    settings: {
        branches: [],
        employees: []
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('masterDateInput');
    const searchInput = document.getElementById('masterSearchInput');
    const staffSearchInput = document.getElementById('masterStaffSearchInput');
    dateInput.value = formatDateYmd(new Date());
    if (searchInput) searchInput.value = '';
    if (staffSearchInput) staffSearchInput.value = '';
    const forwardDateInput = document.getElementById('masterForwardDateInput');
    if (forwardDateInput) forwardDateInput.value = addDays(dateInput.value, 1);
    dateInput.addEventListener('change', () => {
        if (forwardDateInput) forwardDateInput.value = addDays(dateInput.value, 1);
        loadMasterSchedule();
    });

    document.getElementById('masterStatusInput')?.addEventListener('change', renderMasterSchedule);
    searchInput?.addEventListener('input', renderMasterSchedule);
    searchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && searchInput.value) {
            searchInput.value = '';
            renderMasterSchedule();
        }
    });
    document.getElementById('masterSearchClearBtn')?.addEventListener('click', () => {
        if (!searchInput) return;
        searchInput.value = '';
        searchInput.focus();
        renderMasterSchedule();
    });
    document.getElementById('masterRefreshBtn')?.addEventListener('click', loadMasterSchedule);
    document.getElementById('masterRescanBtn')?.addEventListener('click', rescanMasterScheduleSnapshot);
    document.getElementById('masterPrintBtn')?.addEventListener('click', printMasterSchedule);
    document.getElementById('masterForwardOpenBtn')?.addEventListener('click', forwardVisibleOpenSchedules);
    document.getElementById('masterKaizenBtn')?.addEventListener('click', toggleKaizenAdvisor);
    document.getElementById('masterKaizenInlineBtn')?.addEventListener('click', toggleKaizenAdvisor);
    document.getElementById('masterKaizenRefreshBtn')?.addEventListener('click', () => renderKaizenAdvisor(true));
    document.getElementById('masterAutoPriorityBtn')?.addEventListener('click', autoNumberKaizenPriorities);
    document.getElementById('masterKaizenAutoPriorityBtn')?.addEventListener('click', autoNumberKaizenPriorities);
    document.getElementById('masterPrintScopeInput')?.addEventListener('change', updatePrintStaffVisibility);
    document.getElementById('masterPrintStaffInput')?.addEventListener('change', renderMasterSchedule);
    document.getElementById('masterStaffSearchInput')?.addEventListener('input', renderMasterSchedule);
    document.getElementById('masterStatusOverlay')?.addEventListener('click', closeMasterStatusModal);
    document.getElementById('masterStatusCloseBtn')?.addEventListener('click', closeMasterStatusModal);
    document.getElementById('masterStatusCancelBtn')?.addEventListener('click', closeMasterStatusModal);
    document.getElementById('masterStatusSaveBtn')?.addEventListener('click', saveMasterStatusFromModal);
    document.getElementById('masterOverrideCancelBtn')?.addEventListener('click', closeMasterOverrideModal);
    document.addEventListener('click', (event) => {
        const filterButton = event.target.closest('.master-staff-filter[data-staff-key][data-bucket]');
        if (!filterButton) return;
        setStaffBucketFilter(filterButton.dataset.staffKey || '', filterButton.dataset.bucket || 'all');
    });
    applyCloseRequestAccess();
    document.getElementById('masterCloseRequestsSelectAllBtn')?.addEventListener('click', () => setAllCloseRequestChecks(true));
    document.getElementById('masterCloseRequestsClearBtn')?.addEventListener('click', () => setAllCloseRequestChecks(false));
    document.getElementById('masterCloseRequestsApproveSelectedBtn')?.addEventListener('click', approveSelectedCloseRequests);

    document.querySelectorAll('[data-master-view]').forEach((button) => {
        button.addEventListener('click', () => switchMasterView(button.dataset.masterView));
    });
    document.querySelectorAll('[data-settings-tab]').forEach((button) => {
        button.addEventListener('click', () => switchSettingsTab(button.dataset.settingsTab));
    });

    bindSettingsControls();
    loadMasterSchedule();
});

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function canManageCloseRequests() {
    const user = window.MargaAuth?.getUser?.() || {};
    const identity = [
        user.email,
        user.username,
        user.name,
        user.displayName
    ].map((value) => clean(value).toLowerCase()).join(' ');
    return Boolean(
        identity.includes('michael.marga')
        || identity.includes('mike pineda')
    );
}

function applyCloseRequestAccess() {
    const allowed = canManageCloseRequests();
    const tab = document.getElementById('masterCloseRequestsTab');
    if (tab) tab.hidden = !allowed;
    if (!allowed) document.getElementById('masterCloseRequestsView')?.classList.add('hidden');
}

function formatDateYmd(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseFirestoreValue(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.integerValue !== undefined) return Number(value.integerValue);
    if (value.doubleValue !== undefined) return Number(value.doubleValue);
    if (value.booleanValue !== undefined) return value.booleanValue;
    if (value.timestampValue !== undefined) return value.timestampValue;
    if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(parseFirestoreValue);
    if (value.mapValue !== undefined) {
        const parsed = {};
        Object.entries(value.mapValue.fields || {}).forEach(([key, child]) => {
            parsed[key] = parseFirestoreValue(child);
        });
        return parsed;
    }
    return null;
}

function parseFirestoreDoc(doc) {
    const parsed = { _docId: String(doc?.name || '').split('/').pop() || '' };
    Object.entries(doc?.fields || {}).forEach(([key, value]) => {
        parsed[key] = parseFirestoreValue(value);
    });
    return parsed;
}

function firestoreValue(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    return { stringValue: String(value ?? '') };
}

async function runStructuredQuery(structuredQuery) {
    const response = await fetch(`${MASTER_BASE_URL}:runQuery?key=${encodeURIComponent(MASTER_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json();
    if (!response.ok || payload?.error || payload?.[0]?.error) {
        throw new Error(payload?.error?.message || payload?.[0]?.error?.message || 'Firestore query failed.');
    }
    return Array.isArray(payload) ? payload.map((entry) => entry.document).filter(Boolean) : [];
}

async function queryDateRange(collection, fieldPath, start, end) {
    return runStructuredQuery({
        from: [{ collectionId: collection }],
        where: {
            compositeFilter: {
                op: 'AND',
                filters: [
                    { fieldFilter: { field: { fieldPath }, op: 'GREATER_THAN_OR_EQUAL', value: firestoreValue(start) } },
                    { fieldFilter: { field: { fieldPath }, op: 'LESS_THAN_OR_EQUAL', value: firestoreValue(end) } }
                ]
            }
        },
        limit: MASTER_LIMIT
    });
}

async function queryDateRangeLimit(collection, fieldPath, start, end, limit = MASTER_LIMIT) {
    return runStructuredQuery({
        from: [{ collectionId: collection }],
        where: {
            compositeFilter: {
                op: 'AND',
                filters: [
                    { fieldFilter: { field: { fieldPath }, op: 'GREATER_THAN_OR_EQUAL', value: firestoreValue(start) } },
                    { fieldFilter: { field: { fieldPath }, op: 'LESS_THAN_OR_EQUAL', value: firestoreValue(end) } }
                ]
            }
        },
        limit
    });
}

async function queryEquals(collection, fieldPath, value) {
    return runStructuredQuery({
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: firestoreValue(value) } },
        limit: MASTER_LIMIT
    });
}

async function queryEqualsLimit(collection, fieldPath, value, limit = MASTER_LIMIT) {
    return runStructuredQuery({
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: firestoreValue(value) } },
        limit
    });
}

function defaultMargabaseDocumentsBaseUrl() {
    try {
        if (window.location.hostname === 'app.marga.biz' || window.location.origin === 'http://127.0.0.1:9100') {
            return '/margabase-api/v1/projects/sah-spiritual-journal/databases/(default)/documents';
        }
        if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
            return 'http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents';
        }
    } catch (error) {
        // Use the normal configured backend when browser location is unavailable.
    }
    return '';
}

function getMargabaseAdminUrl(path) {
    const baseUrl = String(MASTER_BASE_URL || window.MARGABASE_CONFIG?.baseUrl || '').trim();
    if (baseUrl.startsWith('/margabase-api/')) return `/margabase-api${path}`;
    if (baseUrl.includes('/v1/projects/')) {
        const origin = new URL(baseUrl, window.location.href).origin;
        return `${origin}${path}`;
    }
    return `http://127.0.0.1:8787${path}`;
}

async function fetchCollectionFromBase(collection, options = {}) {
    const {
        pageSize = 1000,
        maxPages = 20,
        fieldMask = null,
        baseUrl = MASTER_BASE_URL,
        apiKey = MASTER_API_KEY
    } = options;
    const rows = [];
    let token = '';

    for (let page = 0; page < maxPages; page += 1) {
        const params = new URLSearchParams({ pageSize: String(pageSize), key: apiKey });
        if (token) params.set('pageToken', token);
        if (Array.isArray(fieldMask)) fieldMask.forEach((path) => params.append('mask.fieldPaths', path));
        const response = await fetch(`${baseUrl}/${collection}?${params.toString()}`);
        if (response.status === 404) return rows;
        const payload = await response.json();
        if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to load ${collection}`);
        rows.push(...(payload.documents || []).map(parseFirestoreDoc));
        if (!payload.nextPageToken) break;
        token = payload.nextPageToken;
    }

    return rows;
}

async function fetchCollection(collection, options = {}) {
    return fetchCollectionFromBase(collection, options);
}

async function fetchConfigCollection(collection, options = {}) {
    let rows = [];
    try {
        rows = await fetchCollection(collection, options);
    } catch (error) {
        console.warn(`Primary ${collection} setup load failed; trying Margabase fallback.`, error);
    }
    if (rows.length) return rows;

    const fallbackBaseUrl = defaultMargabaseDocumentsBaseUrl();
    if (!fallbackBaseUrl || fallbackBaseUrl === MASTER_BASE_URL) return rows;
    try {
        return await fetchCollectionFromBase(collection, {
            ...options,
            baseUrl: fallbackBaseUrl,
            apiKey: 'margabase-local'
        });
    } catch (error) {
        console.warn(`Margabase ${collection} setup fallback failed.`, error);
        return rows;
    }
}

async function fetchDoc(collection, docId) {
    if (!docId && docId !== 0) return null;
    const response = await fetch(`${MASTER_BASE_URL}/${collection}/${encodeURIComponent(String(docId))}?key=${MASTER_API_KEY}`);
    if (response.status === 404) return null;
    const payload = await response.json();
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to load ${collection}/${docId}`);
    return parseFirestoreDoc(payload);
}

async function fetchMany(collection, ids, cache) {
    const unique = Array.from(new Set(
        ids.map((id) => String(id || '').trim()).filter((id) => id && id !== '0' && !cache.has(id))
    ));
    await Promise.all(unique.map(async (id) => {
        const doc = await fetchDoc(collection, id).catch(() => null);
        if (doc) cache.set(id, doc);
    }));
}

async function fetchDocsByIdList(collection, ids) {
    const uniqueIds = Array.from(new Set(
        ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    ));
    if (!uniqueIds.length) return new Map();

    const docs = await Promise.all(uniqueIds.map((id) => fetchDoc(collection, String(id)).catch(() => null)));
    return new Map(
        docs
            .filter(Boolean)
            .map((doc) => [String(doc.id || doc._docId || ''), doc])
            .filter(([key]) => key)
    );
}

async function queryByReferenceIds(collection, ids, cache) {
    const uniqueIds = Array.from(new Set(
        ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    )).filter((id) => !cache.has(String(id)));

    const concurrency = 12;
    for (let index = 0; index < uniqueIds.length; index += concurrency) {
        const slice = uniqueIds.slice(index, index + concurrency);
        const results = await Promise.all(slice.map(async (id) => {
            const docs = await queryEqualsLimit(collection, 'reference_id', id, 25).catch(() => []);
            return [String(id), docs.map(parseFirestoreDoc).filter(Boolean)];
        }));
        results.forEach(([id, rows]) => cache.set(id, rows));
    }
}

async function queryByFieldIds(collection, fieldPath, ids, cache) {
    const uniqueIds = Array.from(new Set(
        ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    )).filter((id) => !cache.has(String(id)));

    const concurrency = 12;
    for (let index = 0; index < uniqueIds.length; index += concurrency) {
        const slice = uniqueIds.slice(index, index + concurrency);
        const results = await Promise.all(slice.map(async (id) => {
            const docs = await queryEqualsLimit(collection, fieldPath, id, 10).catch(() => []);
            return [String(id), docs.map(parseFirestoreDoc).filter(Boolean)];
        }));
        results.forEach(([id, rows]) => cache.set(id, rows));
    }
}

async function setDoc(collection, docId, row) {
    const entries = Object.entries(row).filter(([key]) => !key.startsWith('_') && key !== 'searchText' && key !== 'searchIndex');
    const fields = {};
    entries.forEach(([key, value]) => {
        if (!key.startsWith('_') && key !== 'searchText' && key !== 'searchIndex') fields[key] = firestoreValue(value);
    });
    const response = await fetch(`${MASTER_BASE_URL}/${collection}/${encodeURIComponent(String(docId))}?key=${MASTER_API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        const message = payload?.error?.message || 'Save failed.';
        if (/permission|denied|insufficient/i.test(message)) {
            return updateDocFieldsViaMasterScheduleApi(collection, docId, Object.fromEntries(entries));
        }
        throw new Error(message);
    }
    return payload;
}

async function updateDocFields(collection, docId, row) {
    const safeDocId = encodeURIComponent(String(docId || '').trim());
    const entries = Object.entries(row).filter(([key]) => !key.startsWith('_') && key !== 'searchText' && key !== 'searchIndex');
    if (!safeDocId || !entries.length) return null;

    const params = new URLSearchParams({ key: MASTER_API_KEY });
    entries.forEach(([key]) => params.append('updateMask.fieldPaths', key));

    const fields = {};
    entries.forEach(([key, value]) => {
        fields[key] = firestoreValue(value);
    });

    const response = await fetch(`${MASTER_BASE_URL}/${collection}/${safeDocId}?${params.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        const message = payload?.error?.message || 'Update failed.';
        if (/permission|denied|insufficient/i.test(message)) {
            return updateDocFieldsViaMasterScheduleApi(collection, docId, Object.fromEntries(entries));
        }
        throw new Error(message);
    }
    return payload;
}

async function updateDocFieldsViaMasterScheduleApi(collection, docId, row) {
    const response = await fetch('/api/master-schedule-write', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, docId: String(docId || '').trim(), fields: row })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || 'Master schedule write failed.');
    return payload.doc || payload;
}

async function deleteDoc(collection, docId) {
    const response = await fetch(`${MASTER_BASE_URL}/${collection}/${encodeURIComponent(String(docId))}?key=${MASTER_API_KEY}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => ({}));
        const message = payload?.error?.message || 'Delete failed.';
        if (/permission|denied|insufficient/i.test(message)) {
            await deleteDocViaMasterScheduleApi(collection, docId);
            return;
        }
        throw new Error(message);
    }
}

async function deleteDocViaMasterScheduleApi(collection, docId) {
    const response = await fetch('/api/master-schedule-write', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, docId: String(docId || '').trim() })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || 'Master schedule delete failed.');
    return payload;
}

async function loadActivityLogEntries(activityKey) {
    if (!activityKey) return [];
    const docs = await queryEqualsLimit(MASTER_ACTIVITY_COLLECTION, 'activity_key', activityKey, 80).catch(() => []);
    const rows = docs.map(parseFirestoreDoc).filter(Boolean).sort((left, right) => {
        const leftAt = clean(left.created_at);
        const rightAt = clean(right.created_at);
        return rightAt.localeCompare(leftAt);
    });
    masterState.activityLogs.set(activityKey, rows);
    return rows;
}

async function appendActivityLog(row, entry) {
    if (!row?.activityKey) return null;
    const createdAt = new Date().toISOString();
    const docId = buildActivityDocId();
    const payload = {
        id: docId,
        activity_key: row.activityKey,
        source: row.source,
        doc_id: row.docId || '',
        schedule_id: Number(row.scheduleId || 0) || 0,
        reference_no: row.referenceNo || '',
        customer: row.customer || '',
        branch: row.branch || '',
        assigned_to: row.assignedTo || '',
        master_status: row.masterStatusValue || '',
        action_type: entry.actionType || '',
        action_label: entry.actionLabel || '',
        detail: entry.detail || '',
        actor: currentActorLabel(),
        created_at: createdAt
    };
    await setDoc(MASTER_ACTIVITY_COLLECTION, docId, payload).catch((error) => {
        console.warn('Master schedule activity log save failed:', error);
    });
    const current = masterState.activityLogs.get(row.activityKey) || [];
    masterState.activityLogs.set(row.activityKey, [{ ...payload, _docId: docId }, ...current]);
    return payload;
}

function slug(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'blank';
}

function clean(value) {
    return String(value || '').trim();
}

function identityTokens(value) {
    return clean(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function normalizeIdentityText(...values) {
    return values.map((value) => clean(value).toLowerCase()).filter(Boolean).join(' ');
}

function matchesApproverKeyword(text, keyword) {
    const normalizedText = clean(text).toLowerCase();
    const normalizedKeyword = clean(keyword).toLowerCase();
    if (!normalizedText || !normalizedKeyword) return false;
    if (normalizedKeyword.length <= 3) return identityTokens(normalizedText).includes(normalizedKeyword);
    return normalizedText.includes(normalizedKeyword);
}

function currentActorLabel() {
    if (window.MargaAuth?.getUser) {
        const user = window.MargaAuth.getUser();
        const name = clean(user?.name || user?.username || user?.email);
        if (name) return name;
    }
    return clean(document.getElementById('userName')?.textContent) || 'Master Schedule';
}

function statusOptionByValue(value) {
    return MASTER_STATUS_OPTIONS.find((option) => option.value === value) || null;
}

function statusLabel(value) {
    return statusOptionByValue(value)?.label || 'Not Set';
}

function statusClassName(value) {
    return String(value || '').replace(/_/g, '-');
}

function isClosedMasterStatus(value) {
    return String(value || '').startsWith('closed_');
}

function normalizeStoredStatusValue(row = {}) {
    const raw = clean(
        row.master_schedule_status
        || row.master_status
        || row.schedule_status_label
        || row.masterScheduleStatus
    ).toLowerCase();
    return MASTER_STATUS_OPTIONS.some((option) => option.value === raw) ? raw : '';
}

function deriveMasterStatusValue(row) {
    const stored = normalizeStoredStatusValue(row);
    if (isClosedMasterStatus(stored)) return stored;
    if (isScheduleClosed(row) || clean(row.status).toLowerCase() === 'closed') return 'closed_fixed';
    if (stored) return stored;
    if (scheduleNeedsDeliveryReceipt(row)) return 'open_with_request';
    return 'open';
}

function buildActivityKey(source, docId, fallbackId = '') {
    return [clean(source) || 'schedule', clean(docId) || clean(fallbackId) || 'unknown'].join(':');
}

function buildActivityDocId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const random = Math.random().toString(36).slice(2, 8);
    return `activity_${stamp}_${random}`;
}

function normalizeSearch(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function flattenSearchValues(values) {
    return values.flatMap((value) => {
        if (Array.isArray(value)) return flattenSearchValues(value);
        if (value === null || value === undefined) return [];
        return [String(value)];
    });
}

function uniqueSearchValues(...values) {
    return Array.from(new Set(
        flattenSearchValues(values)
            .map(clean)
            .filter(Boolean)
    ));
}

function extractReferenceTokens(row = {}) {
    return uniqueSearchValues(
        row.reference_no,
        row.referenceNo,
        row.reference_num,
        row.reference_id,
        row.referenceid,
        row.ref_no,
        row.refno,
        row.ref_number,
        row.invoice_num,
        row.invoice_no,
        row.invoiceno,
        row.invoice_id,
        row.invoiceid,
        row.job_order_no,
        row.joborder_no,
        row.service_call_no,
        row.collection_no,
        row.request_no,
        row.request_id,
        row.id,
        row._docId,
        row.docId,
        row.schedule_id,
        row.scheduleId,
        row.route_id,
        row.routeId,
        row.route_doc_id
    );
}

function pickReferenceNo(row = {}, fallbackId = '') {
    const preferred = uniqueSearchValues(
        row.reference_no,
        row.referenceNo,
        row.reference_num,
        row.ref_no,
        row.refno,
        row.ref_number,
        row.invoice_num,
        row.invoice_no,
        row.invoiceno,
        row.invoice_id,
        row.invoiceid,
        row.job_order_no,
        row.joborder_no,
        row.service_call_no,
        row.collection_no,
        row.request_no
    );
    if (preferred.length) return preferred[0];

    const fallback = clean(fallbackId || row.id || row.schedule_id || '');
    return fallback;
}

function composeSearchText(...values) {
    return uniqueSearchValues(values).join(' ');
}

function buildMasterRowSearchText(row) {
    return composeSearchText(
        extractReferenceTokens(row),
        row.referenceNo,
        scheduleFlags(row).map((flag) => flag.label).join(' '),
        row.purpose,
        row.area,
        row.tin,
        row.customer,
        row.branch,
        row.model,
        row.serial,
        row.city,
        row.address,
        row.assignedTo,
        row.status,
        row.masterStatusLabel,
        row.trouble,
        row.remarks,
        row.readyStatus,
        row.originalDate,
        row.sourceNote
    );
}

function refreshMasterRowSearch(row) {
    row.searchText = buildMasterRowSearchText(row);
    row.searchIndex = normalizeSearch(row.searchText);
    return row;
}

function normalizeLegacyDateTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const compact = text.replace(/[T]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (LEGACY_EMPTY_DATETIME_VALUES.has(compact)) return '';
    if (compact.startsWith('undefined ') || compact.startsWith('null ')) return '';
    return text;
}

function dateOnly(value) {
    return normalizeLegacyDateTime(value).slice(0, 10);
}

function addDays(dateText, days) {
    const parsed = new Date(`${dateText}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    parsed.setDate(parsed.getDate() + days);
    return formatDateYmd(parsed);
}

function routeTimePart(row) {
    const source = clean(getRouteTaskDateTime(row) || row?.originalDate);
    const time = source.slice(11, 19);
    if (!/^\d{2}:\d{2}/.test(time)) return '08:00:00';
    return time.length >= 8 ? time.slice(0, 8) : `${time}:00`;
}

function routeDateTimeFor(row, targetDate) {
    return `${targetDate} ${routeTimePart(row)}`;
}

function routeDocIdFor(scheduleId, targetDate) {
    const datePart = String(targetDate || '').replace(/[^0-9]/g, '');
    const schedulePart = String(Number(scheduleId || 0) || 0).padStart(6, '0').slice(-6);
    return String(Number(`${datePart}${schedulePart}`));
}

function nowDbDateTime() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function isOpenScheduleRow(row) {
    if (!row) return false;
    if (clean(row.status).toLowerCase() === 'cancelled') return false;
    if (clean(row.status).toLowerCase() === 'closed') return false;
    if (isClosedMasterStatus(row.masterStatusValue)) return false;
    return Number(row.scheduleId || 0) > 0 && (row.source === 'legacy-route' || row.source === 'pending');
}

function daysBetween(startDate, endDate) {
    if (!startDate || !endDate) return '';
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
    return Math.max(0, Math.round((end - start) / 86400000));
}

function formatShortDate(dateText) {
    if (!dateText) return '-';
    const parsed = new Date(`${dateText}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return dateText;
    return parsed.toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: '2-digit' });
}

function getRouteTaskDateTime(row) {
    return clean(row?.route_task_datetime) || clean(row?.task_datetime);
}

function getAssignedStaffId(row) {
    return Number(row?.route_tech_id || row?.tech_id || 0) || 0;
}

function parseComparableTime(value) {
    const text = String(value || '').trim();
    if (!text) return NaN;
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    return Date.parse(normalized);
}

function shouldPreferScheduleState(row) {
    const scheduleSignals = [
        row?.field_updated_at,
        row?.bridge_updated_at,
        row?.bridge_pushed_at
    ];
    const routeSignals = [
        row?.route_bridge_pushed_at,
        row?.route_timestmp
    ];

    const scheduleTimes = scheduleSignals.map(parseComparableTime).filter(Number.isFinite);
    const routeTimes = routeSignals.map(parseComparableTime).filter(Number.isFinite);
    const scheduleTime = scheduleTimes.length ? Math.max(...scheduleTimes) : NaN;
    const routeTime = routeTimes.length ? Math.max(...routeTimes) : NaN;

    if (!Number.isFinite(scheduleTime)) return false;
    if (!Number.isFinite(routeTime)) return true;
    return scheduleTime >= routeTime;
}

function isRouteCancelled(row) {
    return Number(row?.route_iscancelled || row?.iscancel || row?.iscancelled || 0) === 1;
}

function isFinishedOrCancelled(row) {
    if (isRouteCancelled(row)) return true;
    if (normalizeLegacyDateTime(row.route_date_finished || row.date_finished)) return true;
    const routeStatus = row.route_status === '' || row.route_status === undefined || row.route_status === null
        ? null
        : Number(row.route_status);
    return routeStatus === 0;
}

function masterOriginalScheduleDateRaw(row) {
    return dateOnly(row?.original_sched)
        || dateOnly(row?.forwarded_from_date)
        || dateOnly(row?.route_forwarded_from_date)
        || dateOnly(row?.task_datetime);
}

function masterRawIsPastPendingByOriginalDate(row) {
    const originalDate = masterOriginalScheduleDateRaw(row);
    const selectedDate = selectedMasterDate();
    return isMasterCarryoverEligibleForSelectedDate(originalDate, selectedDate);
}

function hasReachedMasterCarryoverCutoff(baseDate = formatDateYmd(new Date())) {
    const today = formatDateYmd(new Date());
    if (baseDate < today) return true;
    if (baseDate > today) return false;
    const now = new Date();
    return now.getHours() > MASTER_CARRYOVER_CUTOFF_HOUR
        || (now.getHours() === MASTER_CARRYOVER_CUTOFF_HOUR && now.getMinutes() >= MASTER_CARRYOVER_CUTOFF_MINUTE);
}

function isMasterCarryoverEligibleForSelectedDate(originalDate, selectedDate) {
    if (!originalDate || !selectedDate || originalDate >= selectedDate) return false;
    const today = formatDateYmd(new Date());
    if (selectedDate <= today) return true;
    if (originalDate < today) return true;
    return originalDate === today && hasReachedMasterCarryoverCutoff(today);
}

function masterRawStatusKey(row) {
    if (Number(row.route_iscancelled || 0) === 1) return 'cancelled';
    if (Number(row.iscancel || 0) === 1) return 'cancelled';

    const preferScheduleState = shouldPreferScheduleState(row);
    const finished = normalizeLegacyDateTime(row.date_finished);
    if (finished || Number(row.closedby || 0) > 0) return 'closed';
    if (preferScheduleState) {
        if (Number(row.isongoing || 0) === 1) return 'ongoing';
    }

    const routeFinished = normalizeLegacyDateTime(row.route_date_finished);
    if (routeFinished) return 'closed';
    const routeStatus = row.route_status === '' || row.route_status === undefined || row.route_status === null
        ? null
        : Number(row.route_status);
    if (routeStatus === 0) return 'closed';
    const hasActiveRouteRow = Boolean(getRouteTaskDateTime(row)) && routeStatus !== 0;
    if (hasActiveRouteRow) {
        if (Number(row.isongoing || 0) === 1) return 'ongoing';
        if (masterRawIsPastPendingByOriginalDate(row)) return 'carryover';
        const taskDate = getRouteTaskDateTime(row).slice(0, 10);
        if (taskDate && selectedMasterDate() && taskDate < selectedMasterDate()) return 'carryover';
        return 'pending';
    }
    if (Number(row.isongoing || 0) === 1) return 'ongoing';
    if (masterRawIsPastPendingByOriginalDate(row)) return 'carryover';
    const taskDate = getRouteTaskDateTime(row).slice(0, 10);
    if (taskDate && selectedMasterDate() && taskDate < selectedMasterDate()) return 'carryover';
    return 'pending';
}

function isMasterRawClosedOnSelectedDate(row) {
    if (masterRawStatusKey(row) !== 'closed') return false;
    const selectedDate = selectedMasterDate();
    const finishedDate = dateOnly(normalizeLegacyDateTime(row.date_finished))
        || dateOnly(normalizeLegacyDateTime(row.route_date_finished));
    if (finishedDate) return finishedDate === selectedDate;
    return dateOnly(getRouteTaskDateTime(row)) === selectedDate;
}

function isScheduleClosed(row) {
    if (isRouteCancelled(row)) return false;
    const routeFinished = normalizeLegacyDateTime(row?.route_date_finished);
    if (routeFinished) return true;
    const routeStatus = row?.route_status === '' || row?.route_status === undefined || row?.route_status === null
        ? null
        : Number(row.route_status);
    if (routeStatus === 0) return true;
    return Boolean(normalizeLegacyDateTime(row?.date_finished));
}

function lifecycleStatus(row) {
    if (isRouteCancelled(row)) return 'Cancelled';
    if (isScheduleClosed(row)) return 'Closed';
    if (Number(row?.isongoing || row?.pending_parts || 0) === 1) return 'Ongoing';
    return 'Active';
}

function rowStatusBucket(row) {
    const lifecycle = clean(row.status || lifecycleStatus(row)).toLowerCase();
    if (lifecycle === 'cancelled') return 'cancelled';
    if (lifecycle === 'closed' || isClosedMasterStatus(row.masterStatusValue)) return 'closed';
    if (lifecycle === 'ongoing') return 'ongoing';
    return 'pending';
}

function masterRowTroubleText(row) {
    return clean([
        row?.trouble,
        row?.remarks,
        row?.sourceNote,
        row?.status,
        row?.masterStatusLabel,
        row?.route_remarks,
        row?.caller
    ].filter(Boolean).join(' ')).toLowerCase();
}

function isMasterPartsPendingRow(row) {
    const text = masterRowTroubleText(row);
    return (rowStatusBucket(row) === 'ongoing')
        || Number(row?.pending_parts || 0) === 1
        || /parts needed|request part|replace part|part request|pending parts|waiting for parts|waiting for machine|change unit|scanner assy|fuser assy/.test(text);
}

function selectedMasterDate() {
    return clean(document.getElementById('masterDateInput')?.value || formatDateYmd(new Date()));
}

function masterRowOriginalDate(row) {
    return clean(row?.originalDate || masterOriginalScheduleDateRaw(row));
}

function isPastPendingMasterRow(row) {
    const originalDate = masterRowOriginalDate(row);
    const selectedDate = selectedMasterDate();
    return Boolean(originalDate && selectedDate && originalDate < selectedDate);
}

function rowMatchesStatusFilter(row, statusFilter) {
    const bucket = rowStatusBucket(row);
    if (statusFilter === 'all') return bucket !== 'cancelled';
    if (statusFilter === 'active') return bucket === 'pending' || bucket === 'ongoing';
    if (statusFilter === 'today') return (bucket === 'pending' || bucket === 'ongoing') && !isPastPendingMasterRow(row);
    if (statusFilter === 'past_pending') return isPastPendingMasterRow(row);
    if (statusFilter === 'parts') return bucket !== 'closed' && bucket !== 'cancelled' && isMasterPartsPendingRow(row);
    return bucket === statusFilter;
}

function masterScheduleBucketStoreForStaff(staffKey) {
    const normalized = clean(staffKey) || 'Unassigned';
    if (masterState.staffFieldBuckets.has(normalized)) {
        return masterState.staffFieldBuckets.get(normalized);
    }
    const normalizedSearch = normalized.toLowerCase();
    for (const [key, value] of masterState.staffFieldBuckets.entries()) {
        if (clean(key).toLowerCase() === normalizedSearch) return value;
    }
    return {
        totalRows: [],
        todayRows: [],
        pastPendingRows: [],
        unfinishedRows: [],
        closedRows: [],
        partsRows: []
    };
}

function masterStaffBucketRows(staffKey, bucket = 'total') {
    const stored = masterScheduleBucketStoreForStaff(staffKey);
    if (bucket === 'total' || bucket === 'all') return stored.totalRows;
    if (bucket === 'today') return stored.todayRows;
    if (bucket === 'past_pending') return stored.pastPendingRows;
    if (bucket === 'unfinished') return stored.unfinishedRows;
    if (bucket === 'closed') return stored.closedRows;
    if (bucket === 'parts') return stored.partsRows;
    return stored.totalRows;
}

function masterStaffBucketCounts(staffKey) {
    const stored = masterScheduleBucketStoreForStaff(staffKey);
    return {
        total: stored.totalRows.length,
        today: stored.todayRows.length,
        past_pending: stored.pastPendingRows.length,
        unfinished: stored.unfinishedRows.length,
        closed: stored.closedRows.length,
        parts: stored.partsRows.length
    };
}

function masterFallbackBucketRows(rows = [], bucket = 'total') {
    if (bucket === 'total' || bucket === 'all') return rows.filter((row) => rowStatusBucket(row) !== 'cancelled');
    if (bucket === 'today') {
        return rows.filter((row) => rowStatusBucket(row) !== 'cancelled' && !isPastPendingMasterRow(row));
    }
    if (bucket === 'past_pending') return rows.filter((row) => rowStatusBucket(row) !== 'cancelled' && isPastPendingMasterRow(row));
    if (bucket === 'unfinished') {
        return rows.filter((row) => {
            const status = rowStatusBucket(row);
            return status !== 'closed' && status !== 'cancelled';
        });
    }
    if (bucket === 'closed') return rows.filter((row) => rowStatusBucket(row) === 'closed');
    if (bucket === 'parts') {
        return rows.filter((row) => {
            const status = rowStatusBucket(row);
            return status !== 'closed' && status !== 'cancelled' && isMasterPartsPendingRow(row);
        });
    }
    return rows.filter((row) => rowStatusBucket(row) !== 'cancelled');
}

function getStaffBucketFilter(staffKey) {
    const stored = clean(masterState.staffBucketFilters.get(staffKey) || 'total').toLowerCase() || 'total';
    return stored === 'all' ? 'total' : stored;
}

function setStaffBucketFilter(staffKey, bucket) {
    const normalizedStaff = clean(staffKey) || 'Unassigned';
    const allowed = new Set(['total', 'today', 'past_pending', 'unfinished', 'closed', 'parts']);
    masterState.staffBucketFilters.set(normalizedStaff, allowed.has(bucket) ? bucket : 'total');
    renderMasterSchedule();
}

function renderStaffBucketFilters(staffKey, counts) {
    const activeBucket = getStaffBucketFilter(staffKey);
    const options = [
        { key: 'total', label: 'Total Workload', count: counts.total },
        { key: 'today', label: 'New Today', count: counts.today },
        { key: 'past_pending', label: 'Past Pending', count: counts.past_pending },
        { key: 'unfinished', label: 'Unfinished Schedule', count: counts.unfinished },
        { key: 'parts', label: 'Pending Parts/Machine', count: counts.parts },
        { key: 'closed', label: 'Closed', count: counts.closed }
    ];
    return `
        <div class="master-staff-filters">
            ${options.map((option) => `
                <button
                    type="button"
                    class="master-staff-filter ${activeBucket === option.key ? 'is-active' : ''}"
                    data-staff-key="${escapeHtml(staffKey)}"
                    data-bucket="${option.key}"
                >
                    <span>${escapeHtml(option.label)}</span>
                    <span class="master-staff-filter-count">${option.count}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function employeeName(employee, fallbackId = '') {
    if (window.MargaUtils?.getEmployeeFullName) {
        return MargaUtils.getEmployeeFullName(employee, fallbackId) || (fallbackId ? `ID ${fallbackId}` : 'Unassigned');
    }
    if (!employee) return fallbackId ? `ID ${fallbackId}` : 'Unassigned';
    const nickname = clean(employee.nickname);
    const first = clean(employee.firstname);
    const last = clean(employee.lastname);
    return nickname || `${first} ${last}`.trim() || clean(employee.name) || `ID ${fallbackId}`;
}

function employeeRole(employee) {
    if (window.MargaUtils?.getEmployeeDesignation) {
        return MargaUtils.getEmployeeDesignation(employee, masterState.lookups.positions);
    }
    const position = masterState.lookups.positions.get(String(employee?.position_id || ''));
    const label = [
        position?.position,
        position?.position_name,
        position?.name,
        employee?.position,
        employee?.position_name,
        employee?.position_label,
        employee?.marga_role,
        ...(Array.isArray(employee?.marga_roles) ? employee.marga_roles : [])
    ].map(clean).filter(Boolean).join(' ').toLowerCase();
    const positionId = Number(employee?.position_id || 0);
    if (positionId === 5 || label.includes('technician') || label.includes('tech')) return 'Technician';
    if (positionId === 9 || label.includes('messenger') || label.includes('driver')) return label.includes('driver') ? 'Driver' : 'Messenger';
    if (label.includes('driver')) return 'Driver';
    return label ? clean(position?.position || position?.name || employee?.position) : 'Staff';
}

function isPotentialScheduleStaff(employee) {
    return Boolean(clean(window.MargaUtils?.getEmployeeId ? MargaUtils.getEmployeeId(employee) : (employee?.id || employee?._docId || '')));
}

function isActiveScheduleEmployee(employee) {
    if (window.MargaUtils?.isOfficialActiveEmployee) return MargaUtils.isOfficialActiveEmployee(employee);
    if (!employee) return false;
    if (employee.active === false || employee.marga_active === false || employee.marga_account_active === false) return false;
    const hasActiveFlag = employee.active === true || employee.marga_active === true || employee.marga_account_active === true;
    const email = clean(employee.email || employee.marga_login_email || employee.username).toLowerCase();
    const inRoster = !masterState.activeEmployeeEmails.size || masterState.activeEmployeeEmails.has(email);
    return inRoster && hasActiveFlag && Number(employee.estatus ?? 1) > 0;
}

function isScheduleStaff(employee) {
    return isActiveScheduleEmployee(employee);
}

function scheduleStaffOptions() {
    const employees = masterState.settings.employees;
    return employees.filter(isScheduleStaff);
}

function scheduleInactiveStaffOptions() {
    const activeIds = new Set(scheduleStaffOptions().map((employee) => String(employee.id || '')));
    return masterState.settings.employees
        .filter((employee) => employee?.id)
        .filter((employee) => !activeIds.has(String(employee.id || '')))
        .sort((left, right) => employeeName(left, left.id).localeCompare(employeeName(right, right.id)));
}

function scheduleAssignableStaffOptions() {
    return [...scheduleStaffOptions(), ...scheduleInactiveStaffOptions()];
}

function pruneInactiveRosterApprovals() {
    const now = Date.now();
    masterState.inactiveRosterApprovals.forEach((value, key) => {
        if (!value || Number(value.expiresAt || 0) <= now) masterState.inactiveRosterApprovals.delete(key);
    });
}

function getInactiveRosterApproval(staffId) {
    pruneInactiveRosterApprovals();
    return masterState.inactiveRosterApprovals.get(String(staffId || '')) || null;
}

function hasInactiveRosterApproval(staffId) {
    return Boolean(getInactiveRosterApproval(staffId));
}

function rememberInactiveRosterApproval(staffId, approval = {}) {
    const id = String(staffId || '').trim();
    if (!id) return;
    masterState.inactiveRosterApprovals.set(id, {
        approverLabel: approval.approverLabel || 'Approved override',
        approvedAt: approval.approvedAt || new Date().toISOString(),
        expiresAt: approval.expiresAt || (Date.now() + MASTER_OVERRIDE_TTL_MS)
    });
}

function isOverrideApproverUser(user = {}) {
    const identity = normalizeIdentityText(user.name, user.email, user.username);
    return MASTER_OVERRIDE_APPROVER_KEYWORDS.some((keyword) => matchesApproverKeyword(identity, keyword));
}

async function verifyOverrideCredentials(identifier, password) {
    const ident = clean(identifier);
    const secret = String(password || '');
    if (!ident || !secret) return { success: false, message: 'Approver login and PIN/password are required.' };

    let result = await window.MargaAuth?.loginViaServer?.(ident, secret);
    if (result?.success && result.user) return result;

    if (result?.unavailable === true && window.location.hostname && ['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
        const user = await window.MargaAuth?.findUserByEmailOrUsername?.(ident).catch(() => null);
        if (user && window.MargaAuth?.isEmployeeActive?.(user)) {
            const ok = await window.MargaAuth.verifyPassword(user, secret).catch(() => false);
            if (ok) {
                const roles = window.MargaAuth.normalizeRoles(user.marga_roles || user.roles || user.marga_role || user.role || window.MargaAuth.inferRole(user));
                return {
                    success: true,
                    user: {
                        id: user._docId,
                        username: user.username || ident,
                        name: clean(user.marga_fullname || user.name || `${clean(user.firstname)} ${clean(user.lastname)}` || user.nickname || ident),
                        email: clean(user.email || user.marga_login_email).toLowerCase(),
                        staff_id: user.id || user.staff_id || null,
                        roles
                    }
                };
            }
        }
    }

    return {
        success: false,
        message: result?.message || 'Invalid approver PIN/password.'
    };
}

function openMasterOverrideModal({ title, message, reason, defaultIdentifier = '' } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('masterOverrideModal');
        const overlay = document.getElementById('masterStatusOverlay');
        const form = document.getElementById('masterOverrideForm');
        const identifierInput = document.getElementById('masterOverrideIdentifier');
        const passwordInput = document.getElementById('masterOverridePassword');
        const errorEl = document.getElementById('masterOverrideError');
        const approveBtn = document.getElementById('masterOverrideApproveBtn');
        const cancelBtn = document.getElementById('masterOverrideCancelBtn');
        const titleEl = document.getElementById('masterOverrideTitle');
        const messageEl = document.getElementById('masterOverrideMessage');
        const reasonEl = document.getElementById('masterOverrideReason');
        if (!modal || !overlay || !form || !identifierInput || !passwordInput || !errorEl || !approveBtn || !cancelBtn) {
            resolve(null);
            return;
        }

        titleEl.textContent = title || 'Supervisor Override';
        messageEl.textContent = message || 'Enter an approved supervisor account to continue this scheduling exception.';
        reasonEl.textContent = reason || 'This action needs approval because it overrides the default routing guard.';
        identifierInput.value = defaultIdentifier || '';
        passwordInput.value = '';
        errorEl.textContent = '';
        overlay.classList.add('visible');
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');

        let settled = false;
        const cleanup = (result) => {
            if (settled) return;
            settled = true;
            overlay.classList.remove('visible');
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
            form.removeEventListener('submit', onSubmit);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onCancel);
            resolve(result);
        };

        const onCancel = () => cleanup(null);
        const onSubmit = async (event) => {
            event.preventDefault();
            errorEl.textContent = '';
            approveBtn.disabled = true;
            try {
                const result = await verifyOverrideCredentials(identifierInput.value, passwordInput.value);
                if (!result?.success || !result.user) {
                    errorEl.textContent = result?.message || 'Unable to verify override credentials.';
                    return;
                }
                if (!isOverrideApproverUser(result.user)) {
                    errorEl.textContent = 'This account is not allowed to approve Master Schedule overrides.';
                    return;
                }
                cleanup({
                    approverLabel: clean(result.user.name || result.user.email || result.user.username) || 'Approved override',
                    approverUser: result.user,
                    approvedAt: new Date().toISOString(),
                    expiresAt: Date.now() + MASTER_OVERRIDE_TTL_MS
                });
            } finally {
                approveBtn.disabled = false;
            }
        };

        form.addEventListener('submit', onSubmit);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onCancel);
        window.setTimeout(() => identifierInput.focus(), 0);
    });
}

function closeMasterOverrideModal() {
    document.getElementById('masterOverrideCancelBtn')?.click();
}

async function requestScheduleOverride(options = {}) {
    if (options.existingApproval && Number(options.existingApproval.expiresAt || 0) > Date.now()) return options.existingApproval;
    const currentUser = window.MargaAuth?.getUser?.() || {};
    const defaultIdentifier = clean(currentUser.email || currentUser.username || '');
    const approval = await openMasterOverrideModal({
        title: options.title,
        message: options.message,
        reason: options.reason,
        defaultIdentifier
    });
    if (!approval) throw new Error('Override cancelled.');
    if (options.targetStaffId) rememberInactiveRosterApproval(options.targetStaffId, approval);
    return approval;
}

function activeScheduleStaffIds() {
    return scheduleStaffOptions().map((employee) => String(employee.id || '').trim()).filter(Boolean);
}

function hasManualAssignmentOverride(row) {
    return truthyFlag(
        row?.master_manual_assignment_override,
        row?.manual_assignment_override,
        row?.dispatch_manual_override
    );
}

function validateScheduleAssignment(row, overrides = {}) {
    const staffId = clean(overrides.staffId ?? row?.techId ?? row?.assigned_to_id ?? row?.tech_id);
    const staffName = clean(overrides.staffName ?? row?.assignedTo ?? row?.assigned_to ?? row?.assigned_staff_name);
    const allowInactiveRoster = overrides.allowInactiveRoster === true || hasInactiveRosterApproval(staffId);
    if (window.MargaScheduleConsolidation?.validateRequiredAssignment) {
        const result = MargaScheduleConsolidation.validateRequiredAssignment({
            staffId,
            staffName,
            activeStaffIds: activeScheduleStaffIds()
        });
        if (!result.ok && allowInactiveRoster && getStaffById(staffId) && isPotentialScheduleStaff(getStaffById(staffId))) {
            return { ok: true, staffId, staffName, override: 'inactive_roster' };
        }
        return result;
    }
    if (!Number(staffId || 0)) return { ok: false, reason: 'Choose an active assigned staff member before saving this schedule.' };
    if (!staffName || /^(unassigned|suggested \/ unassigned|others?)$/i.test(staffName)) {
        return { ok: false, reason: 'Assigned staff must have a real active name, not Unassigned or Others.' };
    }
    if (!activeScheduleStaffIds().includes(String(staffId))) {
        const employee = getStaffById(staffId);
        if (allowInactiveRoster && employee && isPotentialScheduleStaff(employee)) {
            return { ok: true, staffId, staffName, override: 'inactive_roster' };
        }
        return { ok: false, reason: `${staffName} is not in the active scheduling roster.` };
    }
    return { ok: true, staffId, staffName };
}

function scheduleExceptionReason(row) {
    const assignment = validateScheduleAssignment(row, { allowInactiveRoster: true });
    if (!assignment.ok) return assignment.reason;
    if (hasManualAssignmentOverride(row)) return '';
    if (/^others?$/i.test(clean(row.area))) return 'Area is Others and needs a real route area before dispatch.';
    if (/^others?$/i.test(clean(row.purpose)) || Number(row.purposeId || 0) === 9) return 'Purpose is Others and needs a real schedule purpose before dispatch.';
    return '';
}

function isScheduleExceptionRow(row) {
    return Boolean(scheduleExceptionReason(row));
}

function purposeFromLegacy(row, trouble) {
    const purposeId = Number(row.purpose_id || 0);
    const explicit = MASTER_PURPOSE_LABELS[purposeId] || '';
    const clue = `${explicit} ${trouble?.trouble || ''} ${row.remarks || ''}`.toLowerCase();
    if (clue.includes('toner')) return 'Deliver Toner';
    if (clue.includes('ink') || clue.includes('cartridge')) return 'Deliver Ink';
    if (clue.includes('collection')) return 'Confirmed Collection';
    if (clue.includes('billing') || clue.includes('invoice')) return 'Printed Billing';
    return explicit || `Purpose ${purposeId || '-'}`;
}

function isDispatchableMasterRow(row) {
    return Number(row?.purpose_id || 0) !== 9;
}

function pickLatestRouteRows(rows, selectedDate) {
    const latestBySchedule = new Map();

    rows.forEach((row) => {
        const scheduleId = Number(row.schedule_id || 0);
        if (scheduleId <= 0) return;
        if (selectedDate && String(row.task_datetime || '').slice(0, 10) !== selectedDate) return;
        if (Number(row.iscancelled || row.iscancel || 0) === 1) return;
        const current = latestBySchedule.get(scheduleId);
        if (!current || Number(row.id || 0) > Number(current.id || 0)) {
            latestBySchedule.set(scheduleId, row);
        }
    });

    return Array.from(latestBySchedule.values());
}

async function buildRouteBoundSchedules(routeRows, routeSourceLabel) {
    const scheduleIds = routeRows.map((row) => Number(row.schedule_id || 0)).filter((id) => id > 0);
    const scheduleMap = await fetchDocsByIdList('tbl_schedule', scheduleIds);

    return routeRows
        .map((routeRow) => {
            const scheduleId = Number(routeRow.schedule_id || 0);
            const schedule = scheduleMap.get(String(scheduleId));
            if (!schedule) return null;
            return {
                ...schedule,
                task_datetime: clean(routeRow.task_datetime || schedule.task_datetime),
                tech_id: Number(routeRow.tech_id || schedule.tech_id || 0) || 0,
                route_id: Number(routeRow.id || 0) || 0,
                route_doc_id: routeRow._docId || String(routeRow.id || ''),
                route_source: routeRow._routeSource || routeSourceLabel,
                route_tech_id: Number(routeRow.tech_id || 0) || 0,
                route_task_datetime: clean(routeRow.task_datetime),
                route_status: routeRow.status ?? '',
                route_iscancelled: Number(routeRow.iscancelled || routeRow.iscancel || 0) || 0,
                route_date_finished: clean(routeRow.date_finished),
                route_remarks: clean(routeRow.remarks),
                route_timestmp: clean(routeRow.timestmp),
                route_bridge_pushed_at: clean(routeRow.bridge_pushed_at)
            };
        })
        .filter(Boolean);
}

function asMasterDirectTodayScheduleRow(row) {
    return {
        ...row,
        route_id: 0,
        route_doc_id: '',
        route_source: 'Schedule',
        route_tech_id: Number(row.tech_id || 0) || 0,
        route_task_datetime: clean(row.task_datetime || ''),
        route_status: '',
        route_iscancelled: Number(row.iscancel || row.iscancelled || 0) || 0,
        route_date_finished: clean(row.date_finished || ''),
        route_remarks: clean(row.remarks || row.caller || '')
    };
}

async function buildMasterStaffFieldBuckets({ scheduleRows, pendingRawRows }) {
    const staffIds = new Set([
        ...scheduleStaffOptions().map((employee) => Number(employee.id || 0)).filter(Boolean),
        ...scheduleRows.map((row) => Number(row.tech_id || 0)).filter(Boolean),
        ...pendingRawRows.map((row) => Number(getAssignedStaffId(row) || row.tech_id || 0)).filter(Boolean)
    ]);

    masterState.staffFieldBuckets = new Map();

    for (const staffId of staffIds) {
        const directTodayRows = scheduleRows
            .filter((row) => Number(row.tech_id || 0) === staffId)
            .filter(isDispatchableMasterRow)
            .map(asMasterDirectTodayScheduleRow);

        const allCurrentRows = [...directTodayRows]
            .sort((a, b) => String(getRouteTaskDateTime(a)).localeCompare(String(getRouteTaskDateTime(b))) || (Number(a.id || 0) - Number(b.id || 0)));
        const currentWorkloadRows = allCurrentRows
            .filter((row) => {
                const status = masterRawStatusKey(row);
                return status !== 'closed' && status !== 'cancelled';
            });
        const forwardedPastPendingRows = currentWorkloadRows
            .filter(masterRawIsPastPendingByOriginalDate)
            .map((row) => ({
                ...row,
                route_source: row.route_source || 'Forwarded Past Pending'
            }));
        const todayRows = currentWorkloadRows
            .filter((row) => !masterRawIsPastPendingByOriginalDate(row));

        const currentScheduleIds = new Set(currentWorkloadRows.map((row) => Number(row.id || 0)).filter((id) => id > 0));
        const olderRows = (await loadMasterOlderCarryoverRows(selectedMasterDate(), currentScheduleIds, staffId))
            .filter(isDispatchableMasterRow);

        const uniqueCarryover = new Map();
        [...forwardedPastPendingRows, ...olderRows].forEach((row) => {
            const scheduleId = Number(row.id || row._docId || 0);
            if (!scheduleId || uniqueCarryover.has(scheduleId)) return;
            uniqueCarryover.set(scheduleId, row);
        });
        const pastPendingRows = Array.from(uniqueCarryover.values())
            .sort((a, b) => String(getRouteTaskDateTime(a)).localeCompare(String(getRouteTaskDateTime(b))) || (Number(a.id || 0) - Number(b.id || 0)));

        const totalRows = [...todayRows, ...pastPendingRows].sort((a, b) => String(getRouteTaskDateTime(a)).localeCompare(String(getRouteTaskDateTime(b))) || (Number(a.id || 0) - Number(b.id || 0)));
        const unfinishedRows = totalRows.filter((row) => {
            const status = masterRawStatusKey(row);
            return ['pending', 'carryover', 'ongoing'].includes(status);
        });
        const closedRows = allCurrentRows
            .filter(isMasterRawClosedOnSelectedDate)
            .sort((a, b) => String(getRouteTaskDateTime(a)).localeCompare(String(getRouteTaskDateTime(b))) || (Number(a.id || 0) - Number(b.id || 0)));
        const partsRows = unfinishedRows.filter((row) => {
            const status = masterRawStatusKey(row);
            return ['pending', 'carryover', 'ongoing'].includes(status) && isMasterPartsPendingRow(row);
        });
        const staffName = employeeName(masterState.lookups.employees.get(String(staffId || '')), staffId) || 'Unassigned';
        const buildRows = (rawRows) => rawRows.map(buildLegacyScheduleRow);

        masterState.staffFieldBuckets.set(staffName, {
            totalRows: buildRows(totalRows),
            todayRows: buildRows(todayRows),
            pastPendingRows: buildRows(pastPendingRows),
            unfinishedRows: buildRows(unfinishedRows),
            closedRows: buildRows(closedRows),
            partsRows: buildRows(partsRows)
        });
    }
}

function buildMasterStaffFieldBucketsFromRows(rows = []) {
    const groups = new Map();
    rows.forEach((row) => {
        const staffName = clean(row.assignedTo) || 'Unassigned';
        if (!groups.has(staffName)) groups.set(staffName, []);
        groups.get(staffName).push(refreshMasterRowSearch({ ...row }));
    });

    masterState.staffFieldBuckets = new Map();
    groups.forEach((staffRows, staffName) => {
        masterState.staffFieldBuckets.set(staffName, {
            totalRows: masterFallbackBucketRows(staffRows, 'total'),
            todayRows: masterFallbackBucketRows(staffRows, 'today'),
            pastPendingRows: masterFallbackBucketRows(staffRows, 'past_pending'),
            unfinishedRows: masterFallbackBucketRows(staffRows, 'unfinished'),
            closedRows: masterFallbackBucketRows(staffRows, 'closed'),
            partsRows: masterFallbackBucketRows(staffRows, 'parts')
        });
    });
}

function applyMasterScheduleSnapshotResponse(serverPayload) {
    if (!serverPayload?.exists || !serverPayload?.payload) return false;
    const payload = serverPayload.payload || {};
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const exceptionRows = Array.isArray(payload.exceptionRows) ? payload.exceptionRows : [];
    const pendingRows = Array.isArray(payload.pendingRows) ? payload.pendingRows : [];
    if (!rows.length && !exceptionRows.length && !pendingRows.length) return false;
    masterState.routeSourceLabel = clean(payload.routeSourceLabel || 'Schedule');
    masterState.routeCoverage = {
        routed: Number(payload.routeCoverage?.routed || 0) || 0,
        unrouted: Number(payload.routeCoverage?.unrouted || 0) || 0
    };
    masterState.rows = rows
        .map((row) => refreshMasterRowSearch({ ...row }))
        .filter((row) => !isScheduleExceptionRow(row));
    masterState.exceptionRows = exceptionRows
        .map((row) => refreshMasterRowSearch({ ...row }));
    masterState.pendingRows = pendingRows
        .map((row) => refreshMasterRowSearch({ ...row }));
    buildMasterStaffFieldBucketsFromRows(masterState.rows);
    return true;
}

async function fetchMasterScheduleSnapshot(date) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), MASTER_SNAPSHOT_FETCH_MS);
    try {
        const response = await fetch(`${getMargabaseAdminUrl('/admin/master-schedule-snapshot')}?date=${encodeURIComponent(date)}`, {
            cache: 'no-store',
            signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) {
            throw new Error(payload?.error?.message || `Master schedule snapshot HTTP ${response.status}`);
        }
        return payload;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('Master schedule snapshot took too long to load.');
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

async function rebuildMasterScheduleSnapshotCache(date) {
    const response = await fetch(getMargabaseAdminUrl('/admin/master-schedule-snapshot'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Master schedule snapshot rebuild HTTP ${response.status}`);
    }
    return payload;
}

function buildMasterScheduleSnapshotPayloadFromState() {
    return {
        routeSourceLabel: clean(masterState.routeSourceLabel || 'Schedule'),
        routeCoverage: {
            routed: Number(masterState.routeCoverage?.routed || 0) || 0,
            unrouted: Number(masterState.routeCoverage?.unrouted || 0) || 0
        },
        rows: (masterState.rows || []).map((row) => ({ ...row })),
        exceptionRows: (masterState.exceptionRows || []).map((row) => ({ ...row })),
        pendingRows: (masterState.pendingRows || []).map((row) => ({ ...row }))
    };
}

async function saveMasterScheduleSnapshotFromState(date, buildSource = 'page-live-query') {
    const response = await fetch(getMargabaseAdminUrl('/admin/master-schedule-snapshot'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            date,
            payload: buildMasterScheduleSnapshotPayloadFromState(),
            meta: {
                builtBy: currentActorLabel(),
                buildSource,
                schemaVersion: 1
            }
        })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Master schedule snapshot save HTTP ${response.status}`);
    }
    return payload;
}

function overlayRouteRowsOnSchedules(scheduleRows, printedRows, savedRows, selectedDate) {
    const routeBySchedule = new Map();

    pickLatestRouteRows(printedRows, selectedDate).forEach((row) => {
        const scheduleId = Number(row.schedule_id || 0);
        if (scheduleId > 0) routeBySchedule.set(scheduleId, { ...row, _routeSource: 'Printed' });
    });

    pickLatestRouteRows(savedRows, selectedDate).forEach((row) => {
        const scheduleId = Number(row.schedule_id || 0);
        if (scheduleId > 0) routeBySchedule.set(scheduleId, { ...row, _routeSource: 'Saved' });
    });

    const mergedRows = scheduleRows.map((schedule) => {
        const scheduleId = Number(schedule.id || schedule._docId || 0);
        const routeRow = routeBySchedule.get(scheduleId);
        if (!routeRow) {
            return {
                ...schedule,
                route_id: 0,
                route_doc_id: '',
                route_source: 'Schedule',
                route_tech_id: 0,
                route_task_datetime: '',
                route_status: '',
                route_iscancelled: 0,
                route_date_finished: '',
                route_remarks: '',
                route_timestmp: '',
                route_bridge_pushed_at: ''
            };
        }

        return {
            ...schedule,
            task_datetime: clean(routeRow.task_datetime || schedule.task_datetime),
            tech_id: Number(routeRow.tech_id || schedule.tech_id || 0) || 0,
            route_id: Number(routeRow.id || 0) || 0,
            route_doc_id: routeRow._docId || String(routeRow.id || ''),
            route_source: routeRow._routeSource || 'Saved',
            route_tech_id: Number(routeRow.tech_id || 0) || 0,
            route_task_datetime: clean(routeRow.task_datetime),
            route_status: routeRow.status ?? '',
            route_iscancelled: Number(routeRow.iscancelled || routeRow.iscancel || 0) || 0,
            route_date_finished: clean(routeRow.date_finished),
            route_remarks: clean(routeRow.remarks),
            route_timestmp: clean(routeRow.timestmp),
            route_bridge_pushed_at: clean(routeRow.bridge_pushed_at)
        };
    });

    return {
        mergedRows,
        routeCoverage: {
            routed: mergedRows.filter((row) => Number(row.route_id || 0) > 0).length,
            unrouted: mergedRows.filter((row) => Number(row.route_id || 0) <= 0).length
        }
    };
}

function mergeRouteRows(savedRows, printedRows, date) {
    const routeBySchedule = new Map();
    pickLatestRouteRows(printedRows, date).forEach((row) => {
        routeBySchedule.set(Number(row.schedule_id || 0), { ...row, _routeSource: 'Printed' });
    });
    pickLatestRouteRows(savedRows, date).forEach((row) => {
        routeBySchedule.set(Number(row.schedule_id || 0), { ...row, _routeSource: 'Saved' });
    });
    return Array.from(routeBySchedule.values());
}

function activeServiceRequests(scheduleId) {
    return (masterState.lookups.serviceRequests.get(String(scheduleId)) || [])
        .filter((row) => Number(row.iscancelled || 0) !== 1)
        .filter((row) => !normalizeLegacyDateTime(row.close_date));
}

function activeFinalReceipts(scheduleId) {
    return (masterState.lookups.finalDeliveryReceipts.get(String(scheduleId)) || [])
        .filter((row) => Number(row.iscancelled || 0) !== 1);
}

function hasExplicitReleaseRequest(row) {
    return Boolean(
        clean(row?.release_request_category)
        || clean(row?.release_request_item_rstd)
        || clean(row?.release_request_summary)
        || clean(row?.release_request_qty)
    );
}

function scheduleNeedsDeliveryReceipt(row) {
    const purposeId = Number(row?.purpose_id || 0);
    const purposeText = purposeFromLegacy(row, masterState.lookups.troubles.get(String(row?.trouble_id || ''))).toLowerCase();
    if (purposeId === 7 || purposeText.includes('purchasing')) return false;
    if (Number(row?.releasing_dr_done || 0) === 1) return false;
    if (normalizeStoredStatusValue(row) === 'open_with_request' || clean(row?.masterStatusValue) === 'open_with_request') return true;
    if (hasExplicitReleaseRequest(row)) return true;
    if (Number(row?.withrequest || 0) === 1) return true;
    if (purposeId === 3 || purposeId === 4) return true;

    const clue = [
        purposeText,
        row?.remarks,
        row?.route_remarks,
        row?.customer_request
    ].join(' ').toLowerCase();

    return /toner|ink|cartridge|drum|fuser|scanner|pcr|blade|change unit|pull out|machine/.test(clue);
}

function truthyFlag(...values) {
    return values.some((value) => {
        if (typeof value === 'boolean') return value;
        const text = clean(value).toLowerCase();
        return text === '1' || text === 'true' || text === 'yes' || text === 'y';
    });
}

function scheduleFlags(row = {}) {
    const flags = [];
    if (truthyFlag(row.superUrgent, row.super_urgent)) {
        flags.push({ key: 'urgent', label: 'Urgent' });
    }
    if (truthyFlag(row.hasComplaint, row.withcomplain, row.with_complain, row.withComplaint, row.withcomplaint)) {
        flags.push({ key: 'complaint', label: 'Complaint' });
    }
    if (
        truthyFlag(row.hasRequest, row.withrequest, row.with_request, row.withRequest)
        || row.masterStatusValue === 'open_with_request'
        || hasExplicitReleaseRequest(row)
    ) {
        flags.push({ key: 'request', label: 'Request' });
    }
    return flags;
}

function renderScheduleFlags(row = {}) {
    const flags = scheduleFlags(row);
    if (!flags.length) return '<span class="schedule-flag empty">None</span>';
    return flags.map((flag) => `<span class="schedule-flag ${escapeHtml(flag.key)}">${escapeHtml(flag.label)}</span>`).join('');
}

function readyStatusForSchedule(row) {
    const purposeId = Number(row?.purpose_id || 0);
    const purposeText = purposeFromLegacy(row, masterState.lookups.troubles.get(String(row?.trouble_id || ''))).toLowerCase();
    if (purposeId === 7 || purposeText.includes('purchasing')) return 'N/A';

    const scheduleId = Number(row.id || row._docId || 0);
    if (activeFinalReceipts(scheduleId).length) return 'YES';
    return scheduleNeedsDeliveryReceipt(row) ? 'NO' : 'YES';
}

function readyLabel(value) {
    if (value === 'YES') return 'Ready YES';
    if (value === 'NO') return 'Ready NO';
    return 'Ready N/A';
}

function readyClassName(value) {
    if (value === 'YES') return 'ready-yes';
    if (value === 'NO') return 'ready-no';
    return 'ready-na';
}

function branchCity(branch) {
    return clean(branch?.city || branch?.address_city || branch?.branch_city || branch?.municipality);
}

function compactAddress(value) {
    return clean(value)
        .replace(/\s*,\s*/g, ', ')
        .replace(/(?:,\s*){2,}/g, ', ')
        .replace(/^,\s*|,\s*$/g, '')
        .replace(/\s+/g, ' ');
}

function cityFromAddress(address) {
    const text = compactAddress(address);
    if (!text) return '';
    const known = [
        'Makati', 'Pasay', 'Manila', 'Quezon City', 'Cubao', 'Mandaluyong', 'Pasig',
        'Taguig', 'Paranaque', 'Parañaque', 'Las Pinas', 'Las Piñas', 'Muntinlupa',
        'Marikina', 'Caloocan', 'Malabon', 'Navotas', 'Valenzuela', 'San Juan',
        'Laguna', 'Binan', 'Biñan', 'Calamba', 'Cavite', 'Imus', 'Bacoor', 'Antipolo',
        'Rizal', 'Bulacan', 'Pampanga'
    ];
    const found = known.find((city) => new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    if (found) return found;
    const parts = text.split(',').map(clean).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}

function deliveryInfoForBranch(branchId) {
    const rows = masterState.lookups.deliveryInfoByBranch.get(String(branchId || '')) || [];
    return rows.find((row) => clean(row.tdelivery_add || row.mdelivery_add || row.tcontact_person || row.mcontact_person)) || null;
}

function scheduleAddress(row, branch, deliveryInfo) {
    return compactAddress(
        deliveryInfo?.tdelivery_add ||
        deliveryInfo?.mdelivery_add ||
        branch?.branch_address ||
        [branch?.room, branch?.floor, branch?.bldg, branch?.street, branch?.brgy, branch?.city].filter(Boolean).join(', ')
    );
}

function scheduleCity(row, branch, deliveryInfo, address) {
    return clean(branchCity(branch) || deliveryInfo?.city || deliveryInfo?.city_name) || cityFromAddress(address);
}

function areaFromCity(city) {
    const row = masterState.areaCityRows.get(slug(city));
    return clean(row?.area);
}

function areaFromBranch(branchId, branch, purpose = 'service') {
    const client = masterState.clientAreaRows.get(String(branchId || ''));
    const clientArea = clean(client?.[`${purpose}_area`] || client?.area);
    if (clientArea) return clientArea;
    return areaFromCity(branchCity(branch)) || clean(branch?.area || branch?.area_name) || 'N/A';
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function modelLabel(model, machine = null, row = {}) {
    return clean(
        model?.modelname ||
        model?.model ||
        model?.model_name ||
        model?.description ||
        machine?.description ||
        machine?.modelname ||
        row.model_name ||
        row.model
    );
}

function machineModel(machine, row = {}) {
    const model = masterState.lookups.models.get(String(machine?.model_id || row.model_id || ''));
    return modelLabel(model, machine, row) || clean(machine?.model_id || row.model || row.model_name);
}

function machineSerial(machine, row = {}) {
    return clean(row.serial_number || row.field_serial_selected || machine?.serial || row.serial);
}

function buildLegacyScheduleRow(row) {
    const branch = masterState.lookups.branches.get(String(row.branch_id || ''));
    const company = masterState.lookups.companies.get(String(branch?.company_id || row.company_id || ''));
    const machine = masterState.lookups.machines.get(String(row.serial || row.mach_id || ''));
    const trouble = masterState.lookups.troubles.get(String(row.trouble_id || ''));
    const employee = masterState.lookups.employees.get(String(row.tech_id || ''));
    const contract = masterState.lookups.contracts.get(String(row.contractmain_id || row.contract_id || ''));
    const contractDep = masterState.lookups.contractDeps.get(String(row.contractdep_id || row.contract_dep_id || ''));
    const purpose = purposeFromLegacy(row, trouble);
    const purposeKey = /billing|invoice/i.test(purpose) ? 'billing'
        : (/collection/i.test(purpose) ? 'collection' : (/toner|ink|deliver/i.test(purpose) ? 'delivery' : 'service'));
    const branchName = clean(contractDep?.departmentname || branch?.branchname || row.branch_name) || 'Main';
    const model = machineModel(machine, row);
    const serial = machineSerial(machine, row);
    const assignedTo = employeeName(employee, row.tech_id);
    const area = areaFromBranch(row.branch_id, branch, purposeKey);
    const customer = clean(company?.companyname || row.company_name || row.client || branch?.companyname) || 'Unknown Customer';
    const deliveryInfo = deliveryInfoForBranch(row.branch_id);
    const address = scheduleAddress(row, branch, deliveryInfo);
    const city = scheduleCity(row, branch, deliveryInfo, address);
    const tin = clean(company?.company_tin || company?.tin || company?.tin_no || company?.tin_number || row.tin);
    const originalDate = dateOnly(row.original_sched) || dateOnly(row.task_datetime);
    const selectedDate = document.getElementById('masterDateInput')?.value || formatDateYmd(new Date());
    const scheduleId = Number(row.id || row._docId || 0);
    const readyStatus = readyStatusForSchedule(row);
    const routeSource = clean(row.route_source || row.sourceBucket || 'Saved');
    const lifecycle = lifecycleStatus(row);
    const masterStatusValue = deriveMasterStatusValue(row);
    const superUrgent = truthyFlag(row.super_urgent);
    const hasComplaint = truthyFlag(row.withcomplain, row.with_complain, row.withcomplaint);
    const hasRequest = truthyFlag(row.withrequest) || scheduleNeedsDeliveryReceipt(row);
    const sourceNote = routeSource === 'pending-not-routed'
        ? 'Pending Not Routed'
        : (routeSource === 'Schedule' ? 'Awaiting Route' : `${routeSource} Route`);
    const data = {
        source: routeSource === 'pending-not-routed' ? 'pending' : 'legacy-route',
        sourceBucket: row.sourceBucket || 'daily-route',
        rowKey: `${row.sourceBucket || 'route'}_${row._docId || row.id || ''}`,
        docId: row._docId || row.id || '',
        techId: String(row.tech_id || ''),
        branchId: String(row.branch_id || ''),
        companyId: String(branch?.company_id || row.company_id || ''),
        purposeId: String(row.purpose_id || ''),
        combinedVisitId: clean(row.combined_visit_id),
        combinedVisitOwnerStaffId: String(row.combined_visit_owner_staff_id || ''),
        combinedVisitPrimaryScheduleId: String(row.combined_visit_primary_schedule_id || ''),
        scheduleId,
        routeId: Number(row.route_id || 0) || 0,
        routeDocId: clean(row.route_doc_id || row.route_id),
        routeSource,
        referenceNo: pickReferenceNo(row, scheduleId),
        activityKey: buildActivityKey('tbl_schedule', row._docId || row.id || scheduleId, scheduleId),
        purpose,
        area,
        tin,
        customer,
        branch: branchName,
        model,
        serial,
        city,
        address,
        assignedTo,
        status: lifecycle,
        masterStatusValue,
        masterStatusLabel: statusLabel(masterStatusValue),
        closeRequestStatus: clean(row.close_request_status),
        closeRequestReason: clean(row.close_request_reason),
        closeRequestRequestedAt: clean(row.close_request_requested_at),
        closeRequestRequesterStaffId: String(row.close_request_requested_by || ''),
        closeRequestRequesterName: clean(row.close_request_requester_name),
        superUrgent,
        hasComplaint,
        hasRequest,
        priorityOrder: Number(row.master_priority_order || row.priority || 0) || 0,
        originalDate,
        routeDate: dateOnly(getRouteTaskDateTime(row)),
        daysPending: originalDate ? daysBetween(originalDate, selectedDate) : '',
        readyStatus,
        readyLabel: readyLabel(readyStatus),
        sourceNote,
        trouble: clean(trouble?.trouble),
        remarks: clean(row.route_remarks || row.remarks || row.caller),
        master_manual_assignment_override: row.master_manual_assignment_override,
        master_manual_assignment_override_at: clean(row.master_manual_assignment_override_at),
        master_manual_assignment_override_by: clean(row.master_manual_assignment_override_by)
    };

    return refreshMasterRowSearch(data);
}

function masterCombinedKey(row) {
    if (row.combinedVisitId) return `combined:${row.combinedVisitId}`;
    return `branch:${row.companyId || '0'}:${row.branchId || '0'}`;
}

function masterPurposePriority(row) {
    const purposeId = Number(row.purposeId || 0);
    if (purposeId === 5) return 1;
    if ([3, 4].includes(purposeId)) return 2;
    if ([1, 8].includes(purposeId)) return 3;
    if (purposeId === 2) return 4;
    return 5;
}

function combineMasterRows(rows = []) {
    const groups = new Map();
    rows.forEach((row) => {
        const key = masterCombinedKey(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });
    return Array.from(groups.values()).map((items) => {
        if (items.length === 1) return items[0];
        const primary = items.slice().sort((a, b) => {
            const ap = masterPurposePriority(a);
            const bp = masterPurposePriority(b);
            if (ap !== bp) return ap - bp;
            return schedulePriorityValue(a) - schedulePriorityValue(b) || Number(a.scheduleId || 0) - Number(b.scheduleId || 0);
        })[0];
        const purposeLabels = Array.from(new Set(items.map((item) => clean(item.purpose)).filter(Boolean)));
        const troubleLabels = Array.from(new Set(items.map((item) => clean(item.trouble || item.remarks)).filter(Boolean))).slice(0, 4);
        return {
            ...primary,
            rowKey: `combined_${primary.combinedVisitId || primary.branchId || primary.rowKey}`,
            combinedRows: items,
            purpose: purposeLabels.join(' + '),
            trouble: troubleLabels.join(' | '),
            remarks: troubleLabels.join(' | '),
            referenceNo: items.map((item) => item.referenceNo).filter(Boolean).slice(0, 4).join(', '),
            readyStatus: items.some((item) => item.readyStatus === 'NO') ? 'NO' : (items.some((item) => item.readyStatus === 'YES') ? 'YES' : primary.readyStatus),
            sourceNote: `Combined visit: ${items.length} schedules`
        };
    });
}

function buildWebScheduleRow(row) {
    const purpose = clean(row.purpose || row.schedule_status || 'Collection');
    const branchId = String(row.branch_id || '');
    const branch = masterState.lookups.branches.get(branchId);
    const purposeKey = /billing/i.test(purpose) ? 'billing'
        : (/collection/i.test(purpose) ? 'collection' : (/toner|ink|deliver/i.test(purpose) ? 'delivery' : 'service'));
    const area = clean(row.area || row.area_group) || areaFromBranch(branchId, branch, purposeKey);
    const assignedTo = clean(row.assigned_to || row.collector) || 'Collector';
    const selectedDate = document.getElementById('masterDateInput')?.value || formatDateYmd(new Date());
    const originalDate = dateOnly(row.original_date || row.schedule_date || row.created_at) || selectedDate;
    const masterStatusValue = deriveMasterStatusValue(row);
    const superUrgent = truthyFlag(row.super_urgent, row.superUrgent);
    const hasComplaint = truthyFlag(row.withcomplain, row.with_complain, row.withComplaint, row.withcomplaint);
    const hasRequest = truthyFlag(row.withrequest, row.with_request, row.withRequest)
        || hasExplicitReleaseRequest(row)
        || masterStatusValue === 'open_with_request';
    const data = {
        source: 'web',
        sourceBucket: 'daily-route',
        rowKey: `web_${row._docId || ''}`,
        docId: row._docId,
        original: row,
        techId: String(row.assigned_to_id || row.tech_id || ''),
        branchId,
        companyId: String(row.company_id || ''),
        purposeId: String(row.purpose_id || ''),
        referenceNo: pickReferenceNo(row),
        activityKey: buildActivityKey('marga_master_schedule', row._docId, row._docId),
        purpose,
        area,
        tin: clean(row.tin || row.company_tin || row.tin_no),
        customer: clean(row.customer || row.company_name) || 'Unknown Customer',
        branch: clean(row.branch || row.branch_name) || 'Main',
        model: clean(row.model || row.model_name),
        serial: clean(row.serial || row.serial_number),
        trouble: clean(row.trouble || row.issue || row.remarks),
        city: clean(row.city),
        address: compactAddress(row.address || row.delivery_address || row.collection_address),
        assignedTo,
        status: clean(row.status || 'Active') || 'Active',
        masterStatusValue,
        masterStatusLabel: statusLabel(masterStatusValue),
        superUrgent,
        hasComplaint,
        hasRequest,
        priorityOrder: Number(row.master_priority_order || row.priority || 0) || 0,
        originalDate,
        routeDate: selectedDate,
        daysPending: daysBetween(originalDate, selectedDate),
        readyStatus: clean(row.ready_status || 'N/A') || 'N/A',
        readyLabel: readyLabel(clean(row.ready_status || 'N/A') || 'N/A'),
        sourceNote: 'Web Schedule'
    };

    return refreshMasterRowSearch(data);
}

async function hydrateLegacyLookups(rows) {
    const branchIds = rows.map((row) => row.branch_id);
    const companyIds = rows.map((row) => row.company_id);
    const machineIds = rows.map((row) => row.serial || row.mach_id);
    const employeeIds = rows.map((row) => row.tech_id);
    const troubleIds = rows.map((row) => row.trouble_id);
    const contractIds = rows.map((row) => row.contractmain_id || row.contract_id);
    const contractDepIds = rows.map((row) => row.contractdep_id || row.contract_dep_id);

    await Promise.all([
        fetchMany('tbl_branchinfo', branchIds, masterState.lookups.branches),
        fetchMany('tbl_companylist', companyIds, masterState.lookups.companies),
        fetchMany('tbl_machine', machineIds, masterState.lookups.machines),
        fetchMany('tbl_employee', employeeIds, masterState.lookups.employees),
        fetchMany('tbl_trouble', troubleIds, masterState.lookups.troubles),
        fetchMany('tbl_contractmain', contractIds, masterState.lookups.contracts),
        fetchMany('tbl_contractdep', contractDepIds, masterState.lookups.contractDeps)
    ]);

    const branchCompanyIds = Array.from(masterState.lookups.branches.values()).map((branch) => branch?.company_id);
    const areaIds = Array.from(masterState.lookups.branches.values()).map((branch) => branch?.area_id);
    const modelIds = Array.from(masterState.lookups.machines.values()).map((machine) => machine?.model_id);
    await Promise.all([
        fetchMany('tbl_companylist', branchCompanyIds, masterState.lookups.companies),
        fetchMany('tbl_area', areaIds, masterState.lookups.areas),
        fetchMany('tbl_model', modelIds, masterState.lookups.models),
        queryByFieldIds('tbl_deliveryinfo', 'branch_id', branchIds, masterState.lookups.deliveryInfoByBranch)
    ]);
}

async function hydrateReadyLookups(rows) {
    const requestCandidates = rows.filter((row) => {
        const purposeId = Number(row.purpose_id || 0);
        const clue = `${row.remarks || ''} ${row.route_remarks || ''}`.toLowerCase();
        return Number(row.withrequest || 0) === 1
            || purposeId === 3
            || purposeId === 4
            || purposeId === 7
            || /toner|ink|cartridge|drum|fuser|scanner|pcr|blade|change unit|pull out|machine/.test(clue);
    });
    const requestIds = requestCandidates.map((row) => row.id || row._docId);
    await queryByReferenceIds('tbl_newfordr', requestIds, masterState.lookups.serviceRequests);

    const finalDrIds = requestIds.filter((id) => activeServiceRequests(id).length);
    await queryByReferenceIds('tbl_finaldr', finalDrIds, masterState.lookups.finalDeliveryReceipts);
}

function normalizeCloseRequestRow(row) {
    if (!row) return null;
    const pendingStatus = clean(row.closeRequestStatus || row.close_request_status || row.status).toLowerCase();
    if (row.schedule_id || row.requester_staff_id) {
        if (pendingStatus !== 'pending') return null;
        return row;
    }
    const scheduleId = Number(row.scheduleId || row.id || 0) || 0;
    if (!scheduleId || clean(row.closeRequestStatus || row.close_request_status).toLowerCase() !== 'pending') return null;
    return {
        schedule_id: scheduleId,
        requester_staff_id: Number(row.closeRequestRequesterStaffId || row.close_request_requested_by || 0) || 0,
        requester_name: clean(row.closeRequestRequesterName || row.close_request_requester_name),
        requested_at: clean(row.closeRequestRequestedAt || row.close_request_requested_at),
        reason: clean(row.closeRequestReason || row.close_request_reason),
        task_datetime: clean(row.taskDatetime || row.routeDate || ''),
        branch_id: Number(row.branchId || row.branch_id || 0) || 0,
        company_id: Number(row.companyId || row.company_id || 0) || 0,
        tech_id: Number(row.techId || row.tech_id || 0) || 0,
        route_doc_id: clean(row.routeDocId || row.route_doc_id),
        route_source: clean(row.routeSource || row.route_source),
        status: 'pending'
    };
}

function loadCloseRequestLookup(rows = []) {
    masterState.lookups.closeRequestsBySchedule = new Map();
    masterState.closeRequestRows = rows
        .map(normalizeCloseRequestRow)
        .filter(Boolean)
        .sort((a, b) => clean(b.requested_at).localeCompare(clean(a.requested_at)));
    masterState.closeRequestRows
        .forEach((row) => {
            const scheduleId = String(row.schedule_id || '');
            if (!scheduleId) return;
            const current = masterState.lookups.closeRequestsBySchedule.get(scheduleId);
            if (!current || clean(row.requested_at).localeCompare(clean(current.requested_at)) > 0) {
                masterState.lookups.closeRequestsBySchedule.set(scheduleId, row);
            }
        });
}

async function loadPendingNotRoutedRows(date, routeRows) {
    const routedIds = new Set(routeRows.map((row) => Number(row.id || row._docId || 0)).filter((id) => id > 0));
    const staffIds = new Set(scheduleStaffOptions().map((employee) => Number(employee.id || 0)).filter(Boolean));
    routeRows.map(getAssignedStaffId).filter(Boolean).forEach((id) => staffIds.add(Number(id)));
    if (!staffIds.length) return [];

    const lookbackDate = addDays(date, -PENDING_NOT_ROUTED_LOOKBACK_DAYS);
    const sinceDate = PENDING_CARRYOVER_START_DATE && PENDING_CARRYOVER_START_DATE > lookbackDate
        ? PENDING_CARRYOVER_START_DATE
        : lookbackDate;
    const pendingRows = [];
    const days = [];
    for (let cursor = sinceDate; cursor && cursor < date; cursor = addDays(cursor, 1)) {
        days.push(cursor);
    }

    const concurrency = 6;
    for (let index = 0; index < days.length; index += concurrency) {
        const slice = days.slice(index, index + concurrency);
        const results = await Promise.all(slice.map((day) => (
            queryDateRange('tbl_schedule', 'task_datetime', `${day} 00:00:00`, `${day} 23:59:59`).catch(() => [])
        )));
        results.flat().map(parseFirestoreDoc).filter(Boolean).forEach((row) => {
            const staffId = Number(row.tech_id || 0) || 0;
            const scheduleId = Number(row.id || row._docId || 0);
            const taskDate = dateOnly(row.task_datetime);
            if (!staffIds.has(staffId)) return;
            if (!scheduleId || routedIds.has(scheduleId)) return;
            if (!taskDate || taskDate >= date || taskDate < sinceDate) return;
            if (Number(row.iscancel || row.iscancelled || 0) === 1) return;
            if (normalizeLegacyDateTime(row.date_finished)) return;
            pendingRows.push({
                ...row,
                sourceBucket: 'pending-not-routed',
                route_source: 'pending-not-routed',
                route_task_datetime: row.task_datetime,
                route_tech_id: row.tech_id,
                route_status: row.status ?? ''
            });
        });
    }

    const unique = new Map();
    pendingRows.forEach((row) => unique.set(Number(row.id || row._docId || 0), row));
    return Array.from(unique.values()).sort((a, b) => {
        const left = dateOnly(a.task_datetime);
        const right = dateOnly(b.task_datetime);
        if (left !== right) return left.localeCompare(right);
        return Number(a.id || 0) - Number(b.id || 0);
    });
}

async function loadMasterOlderCarryoverRows(date, excludedScheduleIds, staffId) {
    const days = [];
    for (let index = 1; index <= PENDING_NOT_ROUTED_LOOKBACK_DAYS; index += 1) {
        days.push(addDays(date, -index));
    }

    const rows = [];
    const concurrency = 6;
    for (let index = 0; index < days.length; index += concurrency) {
        const slice = days.slice(index, index + concurrency);
        const results = await Promise.all(slice.map((day) => (
            queryDateRange('tbl_schedule', 'task_datetime', `${day} 00:00:00`, `${day} 23:59:59`).catch(() => [])
        )));
        results.flat().map(parseFirestoreDoc).filter(Boolean).forEach((row) => {
            const scheduleId = Number(row.id || row._docId || 0);
            if (!scheduleId || excludedScheduleIds.has(scheduleId)) return;
            if (Number(row.tech_id || 0) !== Number(staffId || 0)) return;
            if (isFinishedOrCancelled(row)) return;
            if (!isMasterCarryoverEligibleForSelectedDate(masterOriginalScheduleDateRaw(row), date)) return;
            rows.push({
                ...row,
                sourceBucket: 'pending-not-routed',
                route_source: 'Older Pending',
                route_task_datetime: row.task_datetime,
                route_tech_id: row.tech_id,
                route_status: row.status ?? '',
                route_iscancelled: Number(row.iscancel || row.iscancelled || 0) || 0,
                route_date_finished: clean(row.date_finished || ''),
                route_remarks: clean(row.remarks || row.caller || '')
            });
        });
    }

    const unique = new Map();
    rows.forEach((row) => unique.set(Number(row.id || row._docId || 0), row));
    return Array.from(unique.values()).sort((a, b) => {
        const left = dateOnly(a.task_datetime);
        const right = dateOnly(b.task_datetime);
        if (left !== right) return left.localeCompare(right);
        return Number(a.id || 0) - Number(b.id || 0);
    });
}

async function loadMasterConfigs() {
    const [areaCities, techAreas, clientAreas] = await Promise.all([
        fetchConfigCollection('marga_master_schedule_area_cities', { maxPages: 10 }),
        fetchConfigCollection('marga_master_schedule_tech_areas', { maxPages: 10 }),
        fetchConfigCollection('marga_master_schedule_client_areas', { maxPages: 20 })
    ]);

    masterState.areaCityRows = new Map();
    masterState.techAreaRows = new Map();
    masterState.clientAreaRows = new Map();
    masterState.customAreas = new Set();
    masterState.customCities = new Set();

    areaCities.forEach((row) => {
        const area = clean(row.area);
        const city = clean(row.city);
        if (!area || !city) return;
        masterState.areaCityRows.set(slug(city), row);
        masterState.customAreas.add(area);
        masterState.customCities.add(city);
    });

    techAreas.forEach((row) => {
        const techId = clean(row.tech_id);
        const area = clean(row.area);
        if (!techId || !area) return;
        if (!masterState.techAreaRows.has(techId)) masterState.techAreaRows.set(techId, new Map());
        masterState.techAreaRows.get(techId).set(area, row);
        masterState.customAreas.add(area);
    });

    clientAreas.forEach((row) => {
        const branchId = clean(row.branch_id || row._docId?.replace(/^branch_/, ''));
        if (!branchId) return;
        masterState.clientAreaRows.set(branchId, row);
        CLIENT_INFO_TYPES.forEach((type) => {
            if (row[`${type.key}_area`]) masterState.customAreas.add(row[`${type.key}_area`]);
            if (row[`${type.key}_city`]) masterState.customCities.add(row[`${type.key}_city`]);
        });
    });
}

async function loadMasterScheduleLive(date) {
    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;
    const scheduleDocs = await queryDateRange('tbl_schedule', 'task_datetime', start, end).catch(() => []);

    const scheduleRows = scheduleDocs.map(parseFirestoreDoc).filter(Boolean);
    const sameDayScheduleRows = scheduleRows.map(asMasterDirectTodayScheduleRow);
    const pendingRawRows = await loadPendingNotRoutedRows(date, sameDayScheduleRows);
    const legacyRows = [...sameDayScheduleRows, ...pendingRawRows];
    const lookupRows = legacyRows;
    await hydrateLegacyLookups(lookupRows);
    await hydrateReadyLookups(lookupRows);

    masterState.routeSourceLabel = 'Schedule';
    masterState.routeCoverage = {
        routed: sameDayScheduleRows.length,
        unrouted: 0
    };
    const builtRows = [
        ...legacyRows.map(buildLegacyScheduleRow)
    ].sort((a, b) => {
        if (a.assignedTo !== b.assignedTo) return a.assignedTo.localeCompare(b.assignedTo);
        const ap = schedulePriorityValue(a);
        const bp = schedulePriorityValue(b);
        if (ap && bp && ap !== bp) return ap - bp;
        if (ap && !bp) return -1;
        if (!ap && bp) return 1;
        if (a.readyStatus !== b.readyStatus) return ['YES', 'NO', 'N/A'].indexOf(a.readyStatus) - ['YES', 'NO', 'N/A'].indexOf(b.readyStatus);
        if (a.area !== b.area) return a.area.localeCompare(b.area);
        if (a.purpose !== b.purpose) return a.purpose.localeCompare(b.purpose);
        return a.customer.localeCompare(b.customer);
    });
    masterState.exceptionRows = builtRows.filter(isScheduleExceptionRow);
    masterState.rows = builtRows.filter((row) => !isScheduleExceptionRow(row));
    masterState.pendingRows = [];
    loadCloseRequestLookup(builtRows);
    await buildMasterStaffFieldBuckets({
        scheduleRows,
        pendingRawRows
    });
}

async function loadMasterSchedule() {
    const date = document.getElementById('masterDateInput')?.value || formatDateYmd(new Date());
    const sheet = document.getElementById('masterScheduleSheet');
    const count = document.getElementById('masterCount');
    if (sheet) sheet.innerHTML = '<div class="master-empty">Loading Master Schedule...</div>';
    if (count) count.textContent = 'Loading schedules...';
    loadCloseRequestLookup([]);
    renderCloseRequestsPanel();

    try {
        const snapshotPayload = await fetchMasterScheduleSnapshot(date).catch((error) => {
            console.warn('Master schedule snapshot unavailable, falling back to live scan:', error);
            return null;
        });
        const usedSnapshot = applyMasterScheduleSnapshotResponse(snapshotPayload);
        if (!usedSnapshot) {
            await loadMasterConfigs();
            await ensureSettingsData();
            await loadMasterScheduleLive(date);
            saveMasterScheduleSnapshotFromState(date, 'page-fallback-live-query').catch((error) => {
                console.warn('Master schedule fallback snapshot save failed:', error);
            });
        }
        loadCloseRequestLookup([
            ...(masterState.rows || []),
            ...(masterState.pendingRows || []),
            ...(masterState.exceptionRows || [])
        ]);

        renderMasterSchedule();
        renderSettingsIfVisible();
        if (usedSnapshot) {
            Promise.all([
                loadMasterConfigs().catch((error) => {
                    console.warn('Master config background load failed:', error);
                }),
                ensureSettingsData().catch((error) => {
                    console.warn('Master settings background load failed:', error);
                })
            ]).then(() => {
                renderSettingsIfVisible();
                renderMasterSchedule();
            });
        }
    } catch (error) {
        console.error('Master Schedule load failed:', error);
        if (count) count.textContent = 'Unable to load';
        if (sheet) sheet.innerHTML = `<div class="master-empty">Master Schedule failed to load: ${escapeHtml(error.message || error)}</div>`;
    }
}

async function rescanMasterScheduleSnapshot() {
    const date = document.getElementById('masterDateInput')?.value || formatDateYmd(new Date());
    const button = document.getElementById('masterRescanBtn');
    const originalLabel = button?.textContent || 'Rescan';
    if (button) {
        button.disabled = true;
        button.textContent = 'Rescanning...';
    }
    try {
        const sheet = document.getElementById('masterScheduleSheet');
        const count = document.getElementById('masterCount');
        if (sheet) sheet.innerHTML = '<div class="master-empty">Rebuilding snapshot from exact Master Schedule live query...</div>';
        if (count) count.textContent = 'Running exact live query...';
        await loadMasterConfigs();
        await ensureSettingsData();
        await loadMasterScheduleLive(date);
        renderMasterSchedule();
        renderSettingsIfVisible();
        if (count) count.textContent = 'Saving exact live query to snapshot...';
        await saveMasterScheduleSnapshotFromState(date, 'page-live-query');
        if (count) count.textContent = 'Snapshot updated from exact live query.';
    } catch (error) {
        console.error('Master schedule rescan failed:', error);
        window.alert(`Master schedule rescan failed: ${error.message || error}`);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalLabel;
        }
    }
}

function getVisibleRows() {
    const statusFilter = clean(document.getElementById('masterStatusInput')?.value || 'active').toLowerCase();
    const search = normalizeSearch(document.getElementById('masterSearchInput')?.value || '');
    const staffSearch = normalizeSearch(document.getElementById('masterStaffSearchInput')?.value || '');

    return masterState.rows.filter((row) => {
        if (!rowMatchesStatusFilter(row, statusFilter)) return false;
        if (search && !(row.searchIndex || normalizeSearch(row.searchText)).includes(search)) return false;
        if (staffSearch && !normalizeSearch(row.assignedTo || '').includes(staffSearch)) return false;
        return true;
    });
}

function getVisiblePendingRows() {
    const statusFilter = clean(document.getElementById('masterStatusInput')?.value || 'active').toLowerCase();
    const search = normalizeSearch(document.getElementById('masterSearchInput')?.value || '');
    const staffSearch = normalizeSearch(document.getElementById('masterStaffSearchInput')?.value || '');

    return masterState.pendingRows.filter((row) => {
        if (!rowMatchesStatusFilter(row, statusFilter)) return false;
        if (search && !(row.searchIndex || normalizeSearch(row.searchText)).includes(search)) return false;
        if (staffSearch && !normalizeSearch(row.assignedTo || '').includes(staffSearch)) return false;
        return true;
    });
}

function getVisibleExceptionRows() {
    const search = normalizeSearch(document.getElementById('masterSearchInput')?.value || '');
    const staffSearch = normalizeSearch(document.getElementById('masterStaffSearchInput')?.value || '');
    return masterState.exceptionRows.filter((row) => {
        if (search && !(row.searchIndex || normalizeSearch(row.searchText)).includes(search)) return false;
        if (staffSearch && !normalizeSearch(row.assignedTo || '').includes(staffSearch)) return false;
        return true;
    });
}

function readySortValue(value) {
    if (value === 'YES') return 0;
    if (value === 'NO') return 1;
    return 2;
}

function schedulePriorityValue(row) {
    const value = Number(row?.priorityOrder || row?.master_priority_order || row?.priority || 0);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function scheduleUrgencyScore(row, locationCounts = new Map()) {
    const reasons = [];
    let score = 0;
    const flags = scheduleFlags(row).map((flag) => flag.key);
    if (flags.includes('urgent')) {
        score += 1000;
        reasons.push('super urgent');
    }
    if (flags.includes('complaint')) {
        score += 850;
        reasons.push('complaint');
    }
    if (flags.includes('request')) {
        score += 420;
        reasons.push('with request');
    }

    const purposeGroup = kaizenPurposeGroup(row);
    if (purposeGroup === 'collection') {
        score += 500;
        reasons.push('collection priority');
    } else if (purposeGroup === 'service') {
        score += 360;
        reasons.push('service call');
    } else if (purposeGroup === 'delivery') {
        score += 240;
        reasons.push('delivery');
    } else if (purposeGroup === 'billing') {
        score += 160;
        reasons.push('billing');
    }

    const troubleText = clean(`${row.trouble || ''} ${row.remarks || ''}`).toLowerCase();
    if (/asap|urgent|down|cannot|can't|not print|no print|error|jam|leak|complain|escalat/.test(troubleText)) {
        score += 220;
        reasons.push('trouble wording');
    }

    const daysPending = Number(row.daysPending || 0);
    if (Number.isFinite(daysPending) && daysPending > 0) {
        score += Math.min(420, daysPending * 45);
        reasons.push(`${daysPending} day${daysPending === 1 ? '' : 's'} pending`);
    }

    const locationCount = locationCounts.get(kaizenLocationKey(row)) || 0;
    if (locationCount > 1) {
        score += Math.min(180, (locationCount - 1) * 60);
        reasons.push('same-location cluster');
    }

    if (clean(row.readyStatus).toUpperCase() === 'NO') {
        score -= 70;
        reasons.push('ready NO');
    }

    return { score, reasons };
}

function buildKaizenPriorityPlan(rows = getVisibleRows()) {
    const activeRows = rows.filter(isOpenScheduleRow);
    const locationCounts = activeRows.reduce((map, row) => {
        const key = kaizenLocationKey(row);
        map.set(key, (map.get(key) || 0) + 1);
        return map;
    }, new Map());
    const byStaff = new Map();
    activeRows.forEach((row) => {
        const staffKey = row.assignedTo || 'Unassigned';
        if (!byStaff.has(staffKey)) byStaff.set(staffKey, []);
        byStaff.get(staffKey).push(row);
    });

    const planned = [];
    byStaff.forEach((staffRows, staff) => {
        const ranked = staffRows.map((row) => ({
            row,
            staff,
            ...scheduleUrgencyScore(row, locationCounts)
        })).sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const ap = Number(a.row.daysPending || 0);
            const bp = Number(b.row.daysPending || 0);
            if (bp !== ap) return bp - ap;
            return clean(a.row.customer).localeCompare(clean(b.row.customer));
        });
        ranked.forEach((item, index) => {
            planned.push({ ...item, priority: index + 1 });
        });
    });

    return planned;
}

function staffPrioritySummary(rows = []) {
    const activeRows = rows.filter(isOpenScheduleRow);
    const byStaff = new Map();
    activeRows.forEach((row) => {
        const key = row.assignedTo || 'Unassigned';
        if (!byStaff.has(key)) byStaff.set(key, []);
        byStaff.get(key).push(row);
    });
    return Array.from(byStaff.entries()).map(([staff, staffRows]) => {
        const required = Math.min(REQUIRED_PRIORITY_COUNT, staffRows.length);
        const numbered = staffRows.filter((row) => schedulePriorityValue(row) > 0).length;
        return { staff, total: staffRows.length, required, numbered, remaining: Math.max(0, required - numbered) };
    }).filter((item) => item.required > 0);
}

function renderPriorityGate(rows = []) {
    const summaries = staffPrioritySummary(rows);
    if (!summaries.length) return '';
    const incomplete = summaries.filter((item) => item.remaining > 0);
    const complete = summaries.length - incomplete.length;
    return `
        <section class="master-priority-gate ${incomplete.length ? 'needs-work' : 'ready'}">
            <div>
                <h2>Priority Order Gate</h2>
                <p>${incomplete.length
                    ? `Field App will warn ${incomplete.length} staff member${incomplete.length === 1 ? '' : 's'} until at least the first ${REQUIRED_PRIORITY_COUNT} open schedules are numbered, but their route remains open for review.`
                    : `All staff with open schedules have their first required priorities numbered.`}</p>
            </div>
            <div class="priority-gate-list">
                ${incomplete.slice(0, 8).map((item) => `
                    <span>${escapeHtml(item.staff)}: ${item.numbered}/${item.required}</span>
                `).join('')}
                ${complete ? `<span>${complete} staff ready</span>` : ''}
            </div>
        </section>
    `;
}

function buildVisibleStaffGroups(rows = [], pendingRows = [], exceptionRows = []) {
    const groups = new Map();
    const addRows = (items, sourceKey) => {
        (items || []).forEach((row) => {
            const staffKey = clean(row.assignedTo) || 'Unassigned';
            if (!groups.has(staffKey)) {
                groups.set(staffKey, {
                    staffKey,
                    activeRows: [],
                    pendingRows: [],
                    exceptionRows: []
                });
            }
            const bucket = groups.get(staffKey);
            if (sourceKey === 'pending') bucket.pendingRows.push(row);
            else if (sourceKey === 'exception') bucket.exceptionRows.push(row);
            else bucket.activeRows.push(row);
        });
    };
    addRows(rows, 'active');
    addRows(pendingRows, 'pending');
    addRows(exceptionRows, 'exception');
    return Array.from(groups.values()).sort((left, right) => {
        const leftTotal = left.activeRows.length + left.pendingRows.length + left.exceptionRows.length;
        const rightTotal = right.activeRows.length + right.pendingRows.length + right.exceptionRows.length;
        if (rightTotal !== leftTotal) return rightTotal - leftTotal;
        return left.staffKey.localeCompare(right.staffKey);
    });
}

function renderMasterSchedule() {
    const sourceRows = getVisibleRows();
    const rows = combineMasterRows(sourceRows);
    masterState.displayRows = rows;
    const pendingRows = getVisiblePendingRows();
    const exceptionRows = getVisibleExceptionRows();
    const sheet = document.getElementById('masterScheduleSheet');
    const count = document.getElementById('masterCount');
    const searchQuery = clean(document.getElementById('masterSearchInput')?.value || '');
    const totalMatches = rows.length + pendingRows.length + exceptionRows.length;
    const routedVisible = rows.filter((row) => Number(row.routeId || 0) > 0).length;
    const awaitingRouteVisible = rows.filter((row) => row.source === 'legacy-route' && Number(row.routeId || 0) <= 0).length;
    if (count) {
        const pendingText = pendingRows.length ? ` · ${pendingRows.length.toLocaleString()} pending not routed` : '';
        const exceptionText = exceptionRows.length ? ` · ${exceptionRows.length.toLocaleString()} needs assignment` : '';
        const routeText = awaitingRouteVisible ? ` · ${awaitingRouteVisible.toLocaleString()} awaiting route` : '';
        const linkedText = routedVisible ? ` · ${routedVisible.toLocaleString()} route linked` : '';
        const searchText = searchQuery ? ` · ${totalMatches.toLocaleString()} match${totalMatches === 1 ? '' : 'es'}` : '';
        count.textContent = `${rows.length.toLocaleString()} schedule${rows.length === 1 ? '' : 's'}${linkedText}${routeText}${pendingText}${exceptionText}${searchText}`;
    }
    updateSearchDecorations(searchQuery, totalMatches);
    renderPrintStaffOptions();
    if (!sheet) return;

    if (!rows.length && !pendingRows.length && !exceptionRows.length) {
        sheet.innerHTML = '<div class="master-empty">No schedules found for this date/filter.</div>';
        return;
    }

    const routeSummary = rows.reduce((acc, row) => {
        acc[row.readyStatus || 'N/A'] = (acc[row.readyStatus || 'N/A'] || 0) + 1;
        return acc;
    }, {});
    const staffGroups = buildVisibleStaffGroups(sourceRows, pendingRows, exceptionRows);

    sheet.innerHTML = `
        <section class="master-group master-summary">
            <h1>Master Schedule</h1>
            <div class="master-summary-pills">
                <span>Staff shown: ${staffGroups.length}</span>
                <span>Route source: ${escapeHtml(masterState.routeSourceLabel || 'Saved')}</span>
                <span>Route linked: ${masterState.routeCoverage.routed || 0}</span>
                <span>Awaiting route: ${masterState.routeCoverage.unrouted || 0}</span>
                <span>Ready YES: ${routeSummary.YES || 0}</span>
                <span>Ready NO: ${routeSummary.NO || 0}</span>
                <span>Ready N/A: ${routeSummary['N/A'] || 0}</span>
                ${searchQuery ? `<span>Search: ${escapeHtml(searchQuery)}</span>` : ''}
            </div>
        </section>
        ${renderPriorityGate(rows)}
        ${exceptionRows.length ? renderAssignmentExceptions(exceptionRows) : ''}
        ${staffGroups.map((group) => {
            const counts = masterStaffBucketCounts(group.staffKey);
            const activeBucket = getStaffBucketFilter(group.staffKey);
            const storedBucketRows = masterStaffBucketRows(group.staffKey, activeBucket);
            const fallbackUniverse = [...group.activeRows, ...group.pendingRows];
            const bucketRows = storedBucketRows.length ? storedBucketRows : masterFallbackBucketRows(fallbackUniverse, activeBucket);
            const combinedBucketRows = combineMasterRows(bucketRows);
            const labelMap = {
                total: 'Total Workload',
                today: 'New Today',
                past_pending: 'Past Pending',
                unfinished: 'Unfinished Schedule',
                parts: 'Pending Parts / Machine',
                closed: 'Closed'
            };
            const countMap = storedBucketRows.length ? counts : {
                total: masterFallbackBucketRows(fallbackUniverse, 'total').length,
                today: masterFallbackBucketRows(fallbackUniverse, 'today').length,
                past_pending: masterFallbackBucketRows(fallbackUniverse, 'past_pending').length,
                unfinished: masterFallbackBucketRows(fallbackUniverse, 'unfinished').length,
                parts: masterFallbackBucketRows(fallbackUniverse, 'parts').length,
                closed: masterFallbackBucketRows(fallbackUniverse, 'closed').length
            };
            return `
                <section class="master-group">
                    <div class="master-group-header">
                        <h2>${escapeHtml(group.staffKey)}</h2>
                        ${renderStaffBucketFilters(group.staffKey, countMap)}
                    </div>
                    <p class="master-note">${escapeHtml(labelMap[activeBucket] || 'Total Workload')}: ${combinedBucketRows.length} shown from ${countMap[activeBucket] ?? countMap.total} workload row(s) for this staff, using the same route bucket build as Field App.</p>
                    ${(group.pendingRows.length || group.exceptionRows.length) ? `<div class="master-staff-meta">${group.pendingRows.length ? `${group.pendingRows.length} pending not routed` : ''}${group.pendingRows.length && group.exceptionRows.length ? ' · ' : ''}${group.exceptionRows.length ? `${group.exceptionRows.length} needs assignment` : ''}</div>` : ''}
                    ${combinedBucketRows.length ? renderReadyTables(combinedBucketRows) : '<div class="master-empty">No schedules in this staff bucket.</div>'}
                </section>
            `;
        }).join('')}
        ${pendingRows.length ? renderPendingNotRouted(pendingRows) : ''}
    `;
    if (masterState.kaizen.visible) renderKaizenAdvisor();
    renderCloseRequestsPanel();
}

function closeRequestScheduleRow(request) {
    const scheduleId = Number(request?.schedule_id || 0);
    if (!scheduleId) return null;
    return [...masterState.rows, ...masterState.pendingRows, ...masterState.exceptionRows]
        .find((row) => Number(row.scheduleId || row.id || 0) === scheduleId) || null;
}

function closeRequestDisplayData(request) {
    const row = closeRequestScheduleRow(request);
    const branch = masterState.lookups.branches.get(String(request.branch_id || row?.branchId || ''));
    const company = masterState.lookups.companies.get(String(request.company_id || branch?.company_id || row?.companyId || ''));
    const employee = masterState.lookups.employees.get(String(request.requester_staff_id || request.tech_id || row?.techId || ''));
    return {
        row,
        scheduleId: Number(request.schedule_id || row?.scheduleId || 0) || 0,
        customer: row?.customer || company?.companyname || `Company #${request.company_id || '-'}`,
        branch: row?.branch || branch?.branchname || `Branch #${request.branch_id || '-'}`,
        purpose: row?.purpose || MASTER_PURPOSE_LABELS[Number(row?.purposeId || 0)] || 'Schedule',
        requester: request.requester_name || employeeName(employee, request.requester_staff_id) || `Staff #${request.requester_staff_id || '-'}`,
        taskDate: request.task_datetime || row?.taskDatetime || row?.routeDate || '',
        reason: request.reason || 'No reason supplied.'
    };
}

function renderCloseRequestsPanel() {
    const panel = document.getElementById('masterCloseRequestsContent');
    const count = document.getElementById('masterCloseRequestsCount');
    if (!panel) return;
    const requests = masterState.closeRequestRows || [];
    if (count) count.textContent = `${requests.length} pending`;
    if (!canManageCloseRequests()) {
        panel.innerHTML = '<div class="master-empty">Close requests are only available for the owner/admin login.</div>';
        return;
    }
    if (!requests.length) {
        panel.innerHTML = '<div class="master-empty">No pending close requests.</div>';
        return;
    }
    panel.innerHTML = requests.map((request) => {
        const data = closeRequestDisplayData(request);
        const scheduleId = String(data.scheduleId || request.schedule_id || '');
        return `
            <article class="master-close-request-card">
                <input type="checkbox" class="master-close-request-check" value="${escapeHtml(scheduleId)}" aria-label="Select close request #${escapeHtml(scheduleId)}">
                <div>
                    <h3>#${escapeHtml(data.scheduleId)} ${escapeHtml(data.customer)}</h3>
                    <p>${escapeHtml(data.branch)} · ${escapeHtml(data.purpose)}</p>
                    <p><strong>Requested by:</strong> ${escapeHtml(data.requester)} · ${escapeHtml(formatActivityTimestamp(request.requested_at))}</p>
                    <p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>
                    <p><strong>Task date:</strong> ${escapeHtml(data.taskDate || '-')}</p>
                </div>
                <div class="master-close-request-actions">
                    <button class="btn btn-primary btn-sm" type="button" onclick="approveCloseRequestBySchedule('${escapeHtml(scheduleId)}')">Approve Close</button>
                </div>
            </article>
        `;
    }).join('');
}

function selectedCloseRequestScheduleIds() {
    return [...document.querySelectorAll('.master-close-request-check:checked')]
        .map((input) => clean(input.value))
        .filter(Boolean);
}

function setAllCloseRequestChecks(checked) {
    document.querySelectorAll('.master-close-request-check').forEach((input) => {
        input.checked = Boolean(checked);
    });
}

function renderAssignmentExceptions(rows) {
    return `
        <section class="master-group pending-not-routed">
            <h2>Needs Assignment / Stale Pending</h2>
            <p class="master-note">These rows are quarantined from normal Master Schedule, print, forward, and Field App routes until assigned to an active employee with a real purpose and area.</p>
            ${renderScheduleTable(rows.map((row) => ({
                ...row,
                trouble: `${scheduleExceptionReason(row)}${row.trouble ? ` · ${row.trouble}` : ''}`
            })))}
        </section>
    `;
}

function normalizeKaizenAddress(value) {
    return clean(value)
        .toLowerCase()
        .replace(/\b(unit|room|rm|floor|flr|fl|dept|department|office|suite)\b\.?/g, ' ')
        .replace(/\b\d+(st|nd|rd|th)?\s*(floor|flr|fl|room|rm)\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function kaizenLocationKey(row) {
    const company = clean(row.companyId);
    const address = normalizeKaizenAddress(row.address);
    return `${company || 'company?'}|${address || `branch:${clean(row.branchId) || row.branch || row.customer}`}`;
}

function kaizenPurposeGroup(row) {
    const purpose = clean(row.purpose).toLowerCase();
    const purposeId = Number(row.purposeId || 0) || 0;
    if (purposeId === 5 || purpose.includes('service')) return 'service';
    if (purposeId === 1 || purposeId === 8 || purpose.includes('billing') || purpose.includes('reading')) return 'billing';
    if (purposeId === 2 || purpose.includes('collection')) return 'collection';
    if (purposeId === 3 || purposeId === 4 || purpose.includes('deliver') || purpose.includes('toner') || purpose.includes('ink') || purpose.includes('cartridge')) return 'delivery';
    return 'other';
}

function isKaizenMessengerTask(row) {
    return ['billing', 'collection', 'delivery'].includes(kaizenPurposeGroup(row));
}

function toggleKaizenAdvisor() {
    masterState.kaizen.visible = !masterState.kaizen.visible;
    document.getElementById('masterKaizenPanel')?.classList.toggle('hidden', !masterState.kaizen.visible);
    if (masterState.kaizen.visible) renderKaizenAdvisor(true);
}

function buildKaizenReport() {
    const rows = [...getVisibleRows(), ...getVisiblePendingRows()];
    const activeRows = rows.filter(isOpenScheduleRow);
    const groups = new Map();
    activeRows.forEach((row) => {
        const key = kaizenLocationKey(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });

    const duplicateLocations = Array.from(groups.values()).filter((items) => items.length > 1);
    const multiStaffLocations = duplicateLocations.filter((items) => new Set(items.map((row) => clean(row.techId || row.assignedTo)).filter(Boolean)).size > 1);
    const avoidableTrips = multiStaffLocations.reduce((sum, items) => {
        const staffCount = new Set(items.map((row) => clean(row.techId || row.assignedTo)).filter(Boolean)).size;
        return sum + Math.max(0, staffCount - 1);
    }, 0);
    const purposeCounts = activeRows.reduce((acc, row) => {
        const group = kaizenPurposeGroup(row);
        acc[group] = (acc[group] || 0) + 1;
        return acc;
    }, {});

    const actions = multiStaffLocations.map((items, index) => {
        const owner = items.find((row) => kaizenPurposeGroup(row) === 'service' && clean(row.techId))
            || items.find((row) => clean(row.techId))
            || items[0];
        const transferRows = items.filter((row) => row.rowKey !== owner.rowKey && clean(row.techId) && clean(row.techId) !== clean(owner.techId) && isKaizenMessengerTask(row));
        return {
            id: index,
            priority: transferRows.length ? 'high' : 'medium',
            location: items[0].customer,
            branch: items[0].branch,
            recommendedOwner: owner,
            transferRows,
            rows: items,
            nextStep: transferRows.length
                ? `Transfer ${transferRows.length} messenger-type task${transferRows.length === 1 ? '' : 's'} to ${owner.assignedTo}.`
                : 'Review and keep one visit owner unless separate trip is required.'
        };
    });

    const byStaff = new Map();
    activeRows.forEach((row) => {
        const key = row.assignedTo || 'Unassigned';
        if (!byStaff.has(key)) byStaff.set(key, []);
        byStaff.get(key).push(row);
    });
    const lowDensity = Array.from(byStaff.entries())
        .map(([staff, items]) => ({
            staff,
            schedules: items.length,
            locations: new Set(items.map(kaizenLocationKey)).size
        }))
        .filter((item) => item.schedules <= 3 && item.locations <= 3);

    const fieldAlerts = Array.from(byStaff.entries()).map(([staff, items]) => {
        const pending = items.filter((row) => row.readyStatus !== 'YES' && !/closed/i.test(clean(row.status))).length;
        return pending > 0 ? { staff, pending, schedules: items.length } : null;
    }).filter(Boolean).sort((a, b) => b.pending - a.pending);
    const priorityPlan = buildKaizenPriorityPlan(activeRows);
    const priorityChanges = priorityPlan.filter((item) => schedulePriorityValue(item.row) !== item.priority);

    return {
        rows: activeRows,
        uniqueLocations: groups.size,
        duplicateLocationCount: duplicateLocations.length,
        multiStaffLocationCount: multiStaffLocations.length,
        avoidableTrips,
        estimatedSavings: avoidableTrips * 180,
        purposeCounts,
        actions,
        lowDensity,
        fieldAlerts,
        priorityPlan,
        priorityChanges
    };
}

function renderKaizenAdvisor(force = false) {
    if (!masterState.kaizen.visible && !force) return;
    masterState.kaizen.visible = true;
    const panel = document.getElementById('masterKaizenPanel');
    const content = document.getElementById('masterKaizenContent');
    if (!panel || !content) return;
    panel.classList.remove('hidden');
    const report = buildKaizenReport();
    masterState.kaizen.report = report;
    const ownerActions = [
        report.avoidableTrips > 0
            ? {
                priority: 'high',
                title: 'Approve route consolidation before dispatch.',
                text: `${report.avoidableTrips} avoidable same-location trip${report.avoidableTrips === 1 ? '' : 's'} detected. Estimated savings: PHP ${report.estimatedSavings.toLocaleString()}.`
            }
            : {
                priority: 'low',
                title: 'No duplicate-trip waste detected in visible rows.',
                text: 'Continue checking time logs and petty cash after field work.'
            },
        (report.purposeCounts.billing || 0) >= 5
            ? {
                priority: 'medium',
                title: 'Start email-first billing experiment.',
                text: `${report.purposeCounts.billing || 0} billing/reading task${(report.purposeCounts.billing || 0) === 1 ? '' : 's'} in this schedule. Email billing first when no collection/payment visit is planned.`
            }
            : null,
        report.lowDensity.length
            ? {
                priority: 'medium',
                title: 'Review low-density routes.',
                text: report.lowDensity.slice(0, 4).map((item) => `${item.staff}: ${item.schedules} task(s), ${item.locations} location(s)`).join('; ')
            }
            : null,
        report.priorityChanges.length
            ? {
                priority: 'high',
                title: 'Auto-number priorities before releasing Field App.',
                text: `${report.priorityChanges.length} visible open row${report.priorityChanges.length === 1 ? '' : 's'} can be numbered by urgency, complaint/request flags, collection priority, pending age, and same-location clusters.`
            }
            : {
                priority: 'low',
                title: 'Priority order already matches Kaizen scoring.',
                text: 'Review the top five per staff, then release the field schedule.'
            }
    ].filter(Boolean);

    content.innerHTML = `
        <div class="kaizen-grid">
            <div class="kaizen-metric"><span>Schedules</span><strong>${report.rows.length}</strong></div>
            <div class="kaizen-metric"><span>Unique Locations</span><strong>${report.uniqueLocations}</strong></div>
            <div class="kaizen-metric"><span>Multi-Task Locations</span><strong>${report.duplicateLocationCount}</strong></div>
            <div class="kaizen-metric"><span>Avoidable Trips</span><strong>${report.avoidableTrips}</strong></div>
            <div class="kaizen-metric"><span>Priority Changes</span><strong>${report.priorityChanges.length}</strong></div>
            <div class="kaizen-metric"><span>Est. Savings</span><strong>PHP ${report.estimatedSavings.toLocaleString()}</strong></div>
        </div>
        <div class="kaizen-layout">
            <section class="kaizen-box">
                <h3>Owner / Team Leader Direction</h3>
                <div class="kaizen-list">
                    ${ownerActions.map((item) => `
                        <article class="kaizen-item ${escapeHtml(item.priority)}">
                            <strong>${escapeHtml(item.title)}</strong>
                            <p>${escapeHtml(item.text)}</p>
                        </article>
                    `).join('')}
                    ${report.fieldAlerts.slice(0, 4).map((alert) => `
                        <article class="kaizen-item high">
                            <strong>${escapeHtml(alert.staff)} still has ${alert.pending} pending row${alert.pending === 1 ? '' : 's'}.</strong>
                            <p>Team leader should clear, reassign, or confirm carryover before staff returns to office.</p>
                        </article>
                    `).join('')}
                </div>
            </section>
            <section class="kaizen-box">
                <h3>Recommended Actions Before Finalizing</h3>
                <div class="kaizen-list">
                    ${report.actions.length ? report.actions.slice(0, 12).map(renderKaizenAction).join('') : `
                        <article class="kaizen-item">
                            <strong>No same-location transfer needed.</strong>
                            <p>The visible schedule has no multi-staff same-location conflict under current rules.</p>
                        </article>
                    `}
                </div>
            </section>
        </div>
    `;
}

function renderKaizenAction(action) {
    const transferIds = action.transferRows.map((row) => row.scheduleId || row.referenceNo || row.docId).filter(Boolean);
    return `
        <article class="kaizen-item ${escapeHtml(action.priority)}">
            <strong>${escapeHtml(action.location)}${action.branch ? ` / ${escapeHtml(action.branch)}` : ''}</strong>
            <p>${escapeHtml(action.nextStep)}</p>
            <ul>
                ${action.rows.map((row) => `<li>#${escapeHtml(row.scheduleId || row.referenceNo || row.docId || '-')} ${escapeHtml(row.purpose)} - ${escapeHtml(row.assignedTo)}</li>`).join('')}
            </ul>
            <div class="kaizen-item-actions">
                ${action.transferRows.length ? `<button class="kaizen-apply" type="button" onclick="applyKaizenTransfer(${action.id})">Apply Transfer</button>` : ''}
                <span class="kaizen-note">${transferIds.length ? `Will move: ${escapeHtml(transferIds.join(', '))}` : 'Review manually'}</span>
            </div>
        </article>
    `;
}

async function applyKaizenTransfer(actionId) {
    const report = masterState.kaizen.report || buildKaizenReport();
    const action = report.actions.find((item) => Number(item.id) === Number(actionId));
    if (!action || !action.recommendedOwner || !action.transferRows.length || masterState.kaizen.applying) return;
    const ownerEmployee = getStaffById(action.recommendedOwner.techId);
    if (!ownerEmployee) {
        alert(`Cannot apply transfer. ${action.recommendedOwner.assignedTo} is not loaded as an active staff record.`);
        return;
    }
    const ok = window.confirm(`Transfer ${action.transferRows.length} schedule row(s) at ${action.location} to ${action.recommendedOwner.assignedTo}?`);
    if (!ok) return;

    masterState.kaizen.applying = true;
    const count = document.getElementById('masterCount');
    if (count) count.textContent = 'Applying Kaizen transfer...';
    try {
        for (const row of action.transferRows) {
            const previousOwner = row.assignedTo || 'Unassigned';
            await updateScheduleOwner(row, ownerEmployee);
            await appendActivityLog(row, {
                actionType: 'kaizen_transfer',
                actionLabel: 'Kaizen Transfer',
                detail: `Transferred from ${previousOwner} to ${action.recommendedOwner.assignedTo} to avoid duplicate same-location trip.`
            });
        }
        await loadMasterSchedule();
        masterState.kaizen.visible = true;
        renderKaizenAdvisor(true);
        alert(`Transferred ${action.transferRows.length} row(s) to ${action.recommendedOwner.assignedTo}.`);
    } catch (error) {
        console.error('Kaizen transfer failed:', error);
        alert(`Kaizen transfer failed: ${error.message || error}`);
        renderMasterSchedule();
    } finally {
        masterState.kaizen.applying = false;
    }
}

window.applyKaizenTransfer = applyKaizenTransfer;

async function persistSchedulePriority(row, priority) {
    const nowIso = new Date().toISOString();
    const payload = {
        priority,
        master_priority_order: priority,
        master_priority_updated_at: nowIso,
        master_priority_updated_by: currentActorLabel()
    };

    if (row.source === 'legacy' || row.source === 'legacy-route' || row.source === 'pending') {
        await updateDocFields('tbl_schedule', row.docId, payload);
    } else if (row.source === 'web') {
        await updateDocFields('marga_master_schedule', row.docId, payload);
    } else if (row.source === 'planner') {
        await updateDocFields('tbl_schedule_planner', row.docId, payload);
    }
}

function applyPriorityToLocalRow(row, priority) {
    row.priorityOrder = priority;
    row.priority = priority;
    row.master_priority_order = priority;
    refreshMasterRowSearch(row);
}

async function autoNumberKaizenPriorities() {
    if (masterState.kaizen.prioritizing) return;
    const plan = buildKaizenPriorityPlan([...getVisibleRows(), ...getVisiblePendingRows()]);
    const changes = plan.filter((item) => schedulePriorityValue(item.row) !== item.priority);
    if (!changes.length) {
        window.alert('Kaizen priority numbering is already up to date for the visible open schedules.');
        return;
    }
    const preview = changes.slice(0, 8).map((item) => {
        const why = item.reasons.slice(0, 3).join(', ') || 'route balance';
        return `${item.staff}: #${item.priority} ${item.row.customer} (${why})`;
    }).join('\n');
    const ok = window.confirm(`Auto-number ${changes.length} visible open schedule row(s) by Kaizen scoring?\n\n${preview}${changes.length > 8 ? '\n...' : ''}`);
    if (!ok) return;

    masterState.kaizen.prioritizing = true;
    const count = document.getElementById('masterCount');
    if (count) count.textContent = 'Auto-numbering priorities...';
    try {
        for (const item of changes) {
            await persistSchedulePriority(item.row, item.priority);
            applyPriorityToLocalRow(item.row, item.priority);
            await appendActivityLog(item.row, {
                actionType: 'kaizen_priority',
                actionLabel: 'Kaizen Priority',
                detail: `Auto-numbered priority ${item.priority}. Score ${Math.round(item.score)}: ${item.reasons.join(', ') || 'route balance'}.`
            });
        }
        masterState.kaizen.visible = true;
        renderMasterSchedule();
        renderKaizenAdvisor(true);
        window.alert(`Kaizen auto-numbered ${changes.length} schedule row(s).`);
    } catch (error) {
        console.error('Kaizen priority numbering failed:', error);
        window.alert(`Kaizen priority numbering failed: ${error.message || error}`);
        await loadMasterSchedule();
    } finally {
        masterState.kaizen.prioritizing = false;
    }
}

window.autoNumberKaizenPriorities = autoNumberKaizenPriorities;

function renderReadyTables(rows) {
    const groups = new Map();
    rows
        .slice()
        .sort((a, b) => {
            const ap = schedulePriorityValue(a);
            const bp = schedulePriorityValue(b);
            if (ap && bp && ap !== bp) return ap - bp;
            if (ap && !bp) return -1;
            if (!ap && bp) return 1;
            return readySortValue(a.readyStatus) - readySortValue(b.readyStatus) || Number(b.daysPending || 0) - Number(a.daysPending || 0);
        })
        .forEach((row) => {
            const key = row.readyStatus || 'N/A';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        });

    return Array.from(groups.entries()).map(([ready, readyRows]) => `
        <div class="ready-block ${readyClassName(ready)}">
            <h3>${escapeHtml(readyLabel(ready))}</h3>
            ${renderScheduleTable(readyRows)}
        </div>
    `).join('');
}

function renderScheduleTable(rows) {
    return `
        <div class="master-table-hint">Swipe left or right to view the full schedule table.</div>
        <div class="master-table-shell">
            <table class="master-table">
                <thead>
                    <tr>
                        <th>TIN #</th>
                        <th>Flags</th>
                        <th>Priority</th>
                        <th>Original Date</th>
                        <th>Customer / Branch</th>
                        <th>Purpose</th>
                        <th>Model</th>
                        <th>Trouble</th>
                        <th>City</th>
                        <th>Address</th>
                        <th>Days Pending</th>
                        <th>Ready</th>
                        <th>Assigned To</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(renderMasterScheduleRow).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderPendingNotRouted(rows) {
    const grouped = new Map();
    rows.forEach((row) => {
        const key = row.assignedTo || 'Unassigned';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
    });

    return `
        <section class="master-group pending-not-routed">
            <h2>Pending Not Routed</h2>
            <p class="master-note">Older assigned schedules not included in today route. Team leader should close, cancel, reassign, or route these later.</p>
            ${Array.from(grouped.entries()).map(([staff, staffRows]) => `
                <div class="pending-staff-block">
                    <h3>${escapeHtml(staff)}</h3>
                    ${renderScheduleTable(staffRows)}
                </div>
            `).join('')}
        </section>
    `;
}

function renderMasterScheduleRow(row) {
    const staffOptions = renderStaffSelectOptions(row);
    const readyClass = readyClassName(row.readyStatus);
    const canMove = true;
    const displayStatus = row.masterStatusLabel || 'Not Set';
    const displayStatusClass = row.masterStatusValue ? statusClassName(row.masterStatusValue) : '';
    const assignment = validateScheduleAssignment(row, { allowInactiveRoster: true });
    const exceptionReason = scheduleExceptionReason(row);
    const canForward = isOpenScheduleRow(row) && assignment.ok && !exceptionReason;
    const defaultForwardDate = clean(document.getElementById('masterForwardDateInput')?.value) || addDays(document.getElementById('masterDateInput')?.value || formatDateYmd(new Date()), 1);
    const priorityValue = schedulePriorityValue(row);
    const closeRequest = masterState.lookups.closeRequestsBySchedule.get(String(row.scheduleId || ''));
    return `
        <tr data-row-key="${escapeHtml(row.rowKey)}">
            <td data-label="TIN #">${escapeHtml(row.tin || '-')}</td>
            <td data-label="Flags" class="flags-cell">${renderScheduleFlags(row)}</td>
            <td data-label="Priority" class="priority-cell">
                <input class="schedule-priority-input" type="number" min="1" max="999" inputmode="numeric" value="${priorityValue ? escapeHtml(priorityValue) : ''}" onchange="saveSchedulePriority('${escapeHtml(row.rowKey)}', this.value)" aria-label="Priority order">
            </td>
            <td data-label="Original Date">${escapeHtml(formatShortDate(masterRowOriginalDate(row)))}</td>
            <td data-label="Customer / Branch" class="schedule-account-cell">
                <strong>${escapeHtml(row.customer || '-')}</strong>
                <span>${escapeHtml(row.branch || '-')}</span>
                ${row.referenceNo ? `<span class="schedule-reference">Ref ${escapeHtml(row.referenceNo)}</span>` : ''}
            </td>
            <td data-label="Purpose">${escapeHtml(row.purpose || '-')}</td>
            <td data-label="Model">${escapeHtml(row.model || '-')}</td>
            <td data-label="Trouble">${escapeHtml(row.trouble || row.remarks || '-')}</td>
            <td data-label="City">${escapeHtml(row.city || '-')}</td>
            <td data-label="Address" class="schedule-address-cell">${escapeHtml(row.address || '-')}</td>
            <td data-label="Days Pending" class="numeric">${escapeHtml(row.daysPending === '' ? '-' : row.daysPending)}</td>
            <td data-label="Ready"><span class="ready-pill ${readyClass}">${escapeHtml(row.readyStatus || 'N/A')}</span></td>
            <td data-label="Assigned To" class="assigned-cell">
                <select class="staff-select" ${canMove ? '' : 'disabled'} onchange="reassignScheduleFromSelect('${escapeHtml(row.rowKey)}', this.value)">
                    ${staffOptions}
                </select>
            </td>
            <td data-label="Status" class="status-cell">
                <div class="schedule-status-cell">
                    <span class="schedule-status-label ${escapeHtml(displayStatusClass)}">${escapeHtml(exceptionReason || displayStatus)}</span>
                    ${closeRequest ? `
                        <div class="schedule-close-request">
                            <strong>Close requested</strong>
                            <span>${escapeHtml(closeRequest.requester_name || `Staff #${closeRequest.requester_staff_id || ''}`)}: ${escapeHtml(closeRequest.reason || 'Already done')}</span>
                            <button type="button" onclick="approveCloseRequest('${escapeHtml(row.rowKey)}')">Approve Close</button>
                        </div>
                    ` : ''}
                    <button type="button" class="schedule-status-view" onclick="openMasterStatusModal('${escapeHtml(row.rowKey)}')">View</button>
                    <div class="schedule-forward-tools">
                        <input class="schedule-forward-date" type="date" value="${escapeHtml(defaultForwardDate)}" aria-label="Forward date" ${canForward ? '' : 'disabled'}>
                        <button type="button" class="schedule-forward-btn" onclick="forwardScheduleRow('${escapeHtml(row.rowKey)}', this)" ${canForward ? '' : 'disabled'}>Forward</button>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

function renderStaffSelectOptions(row) {
    const staff = scheduleAssignableStaffOptions();
    const activeIds = new Set(activeScheduleStaffIds());
    const selectedId = clean(row.techId);
    const selectedKnown = selectedId && staff.some((employee) => String(employee.id) === selectedId);
    const options = [];
    if (!selectedKnown && row.assignedTo) {
        options.push('<option value="" selected>Inactive or unmapped - reassign</option>');
    }
    options.push(...staff.map((employee) => {
        const id = String(employee.id);
        const selected = selectedId ? id === selectedId : employeeName(employee, id) === row.assignedTo;
        const inactiveRoster = !activeIds.has(id);
        const label = inactiveRoster
            ? `${employeeName(employee, id)} (inactive roster - override)`
            : employeeName(employee, id);
        return `<option value="${escapeHtml(id)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }));
    return options.join('');
}

function findScheduleRow(rowKey) {
    return (masterState.displayRows || []).find((row) => row.rowKey === rowKey)
        || masterState.rows.find((row) => row.rowKey === rowKey)
        || masterState.pendingRows.find((row) => row.rowKey === rowKey)
        || masterState.exceptionRows.find((row) => row.rowKey === rowKey)
        || null;
}

function getStaffById(staffId) {
    return masterState.lookups.employees.get(String(staffId || '')) || null;
}

async function updateScheduleOwner(row, employee) {
    const staffId = String(employee?.id || '').trim();
    const staffName = employeeName(employee, staffId);
    if (!row || !staffId) return;
    const nowIso = new Date().toISOString();
    const actor = currentActorLabel();
    const assignment = validateScheduleAssignment(row, {
        staffId,
        staffName,
        allowInactiveRoster: true
    });
    if (!assignment.ok) throw new Error(assignment.reason);

    if (row.source === 'legacy' || row.source === 'legacy-route' || row.source === 'pending') {
        await updateDocFields('tbl_schedule', row.docId, {
            tech_id: Number(staffId) || staffId,
            master_manual_assignment_override: 1,
            master_manual_assignment_override_at: nowIso,
            master_manual_assignment_override_by: actor
        });
        if (row.routeDocId && row.routeSource && row.routeSource !== 'Schedule') {
            const routeCollection = String(row.routeSource).toLowerCase().includes('printed') ? ROUTE_COLLECTION_PRIMARY : ROUTE_COLLECTION_FALLBACK;
            await updateDocFields(routeCollection, row.routeDocId, { tech_id: Number(staffId) || staffId });
        }
    } else if (row.source === 'web') {
        await updateDocFields('marga_master_schedule', row.docId, {
            assigned_to_id: staffId,
            assigned_to: staffName,
            updated_at: new Date().toISOString()
        });
    } else if (row.source === 'planner') {
        await updateDocFields('tbl_schedule_planner', row.docId, {
            assigned_staff_id: staffId,
            assigned_staff_name: staffName,
            updated_at: new Date().toISOString()
        });
    }

    row.techId = staffId;
    row.assignedTo = staffName;
    row.master_manual_assignment_override = 1;
    row.master_manual_assignment_override_at = nowIso;
    row.master_manual_assignment_override_by = actor;
    refreshMasterRowSearch(row);
}

async function saveSchedulePriority(rowKey, rawValue) {
    const row = findScheduleRow(rowKey);
    if (!row) return;
    const value = Number(rawValue || 0);
    const priority = Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

    try {
        await persistSchedulePriority(row, priority);
        applyPriorityToLocalRow(row, priority);
        renderMasterSchedule();
    } catch (error) {
        console.error('Priority save failed:', error);
        window.alert(`Unable to save priority: ${error.message || error}`);
        renderMasterSchedule();
    }
}

async function saveScheduleStatus(row, nextStatusValue) {
    const nextStatusLabel = statusLabel(nextStatusValue);
    const updatedAt = new Date().toISOString();
    const payload = {
        master_schedule_status: nextStatusValue,
        master_schedule_status_label: nextStatusLabel,
        master_schedule_status_updated_at: updatedAt,
        master_schedule_status_updated_by: currentActorLabel()
    };

    if (row.source === 'legacy' || row.source === 'legacy-route' || row.source === 'pending') {
        await updateDocFields('tbl_schedule', row.docId, payload);
    } else if (row.source === 'web') {
        await updateDocFields('marga_master_schedule', row.docId, payload);
    } else if (row.source === 'planner') {
        await updateDocFields('tbl_schedule_planner', row.docId, payload);
    }

    row.masterStatusValue = nextStatusValue;
    row.masterStatusLabel = nextStatusLabel;
    row.readyStatus = readyStatusForSchedule(row);
    row.readyLabel = readyLabel(row.readyStatus);
    refreshMasterRowSearch(row);
}

function routeCollectionForSource(routeSource) {
    return clean(routeSource).toLowerCase().includes('printed')
        ? ROUTE_COLLECTION_PRIMARY
        : ROUTE_COLLECTION_FALLBACK;
}

async function applyApprovedCloseRequest(request, row = null, options = {}) {
    const scheduleId = Number(request?.schedule_id || row?.scheduleId || 0) || 0;
    const nowIso = options.nowIso || new Date().toISOString();
    const finishTime = options.finishTime || nowDbDateTime();
    const actor = options.actor || currentActorLabel();
    const scheduleDocId = clean(row?.docId || request?.schedule_doc_id || scheduleId);
    if (!scheduleDocId) throw new Error(`Missing schedule document id for close request #${scheduleId || '-'}`);

    await updateDocFields('tbl_schedule', scheduleDocId, {
        date_finished: finishTime,
        closedby: Number(request?.requester_staff_id || request?.tech_id || row?.techId || 0) || 0,
        master_schedule_status: 'closed_fixed',
        master_schedule_status_label: statusLabel('closed_fixed'),
        master_schedule_status_updated_at: nowIso,
        master_schedule_status_updated_by: actor,
        close_request_status: 'approved',
        close_request_approved_at: nowIso,
        close_request_approved_by: actor
    });

    const routeDocId = clean(row?.routeDocId || request?.route_doc_id);
    const routeSource = clean(row?.routeSource || request?.route_source);
    if (routeDocId && routeSource && routeSource !== 'Schedule') {
        await updateDocFields(routeCollectionForSource(routeSource), routeDocId, {
            status: 0,
            date_finished: finishTime,
            timestmp: nowIso,
            bridge_pushed_at: nowIso
        }).catch((error) => console.warn('Route close update failed; schedule was closed.', error));
    }

    if (row) {
        await appendActivityLog(row, {
            actionType: 'approve_close_request',
            actionLabel: 'Close Request Approved',
            detail: `Approved close request from ${request.requester_name || `staff #${request.requester_staff_id || ''}`}.`
        }).catch((error) => console.warn('Close approval activity log failed:', error));
    }
}

async function approveCloseRequest(rowKey, options = {}) {
    const row = findScheduleRow(rowKey);
    if (!row) return;
    const request = masterState.lookups.closeRequestsBySchedule.get(String(row.scheduleId || ''));
    if (!request) return;
    if (!options.skipConfirm) {
        const ok = window.confirm(`Approve close request for ${row.customer || 'this schedule'}?\n\nThis will mark the schedule closed without requiring the field staff to go back on-site.`);
        if (!ok) return;
    }

    try {
        await applyApprovedCloseRequest(request, row, options);
        if (!options.skipReload) await loadMasterSchedule();
    } catch (error) {
        console.error('Close request approval failed:', error);
        window.alert(`Unable to approve close request: ${error.message || error}`);
    }
}

async function approveCloseRequestBySchedule(scheduleId, options = {}) {
    const request = masterState.lookups.closeRequestsBySchedule.get(String(scheduleId || ''));
    if (!request) return;
    const row = closeRequestScheduleRow(request);
    if (!options.skipConfirm) {
        const data = closeRequestDisplayData(request);
        const ok = window.confirm(`Approve close request for ${data.customer || `schedule #${scheduleId}`}?\n\nReason: ${request.reason || 'No reason supplied.'}`);
        if (!ok) return;
    }
    try {
        await applyApprovedCloseRequest(request, row, options);
        if (!options.skipReload) {
            await loadMasterSchedule();
            switchMasterView('close-requests');
        }
    } catch (error) {
        console.error('Close request approval failed:', error);
        window.alert(`Unable to approve close request: ${error.message || error}`);
    }
}

async function approveSelectedCloseRequests() {
    const scheduleIds = selectedCloseRequestScheduleIds();
    if (!scheduleIds.length) {
        window.alert('Select at least one close request first.');
        return;
    }
    const ok = window.confirm(`Approve ${scheduleIds.length} selected close request${scheduleIds.length === 1 ? '' : 's'}?\n\nApproved schedules will be closed and removed from field pending lists.`);
    if (!ok) return;
    const nowIso = new Date().toISOString();
    const finishTime = nowDbDateTime();
    const actor = currentActorLabel();
    let approvedCount = 0;
    let failedCount = 0;
    for (const scheduleId of scheduleIds) {
        const request = masterState.lookups.closeRequestsBySchedule.get(String(scheduleId || ''));
        if (!request) {
            failedCount += 1;
            continue;
        }
        try {
            await applyApprovedCloseRequest(request, closeRequestScheduleRow(request), {
                nowIso,
                finishTime,
                actor
            });
            approvedCount += 1;
        } catch (error) {
            failedCount += 1;
            console.error(`Close request approval failed for schedule #${scheduleId}:`, error);
        }
    }
    window.alert(`Approved ${approvedCount} close request${approvedCount === 1 ? '' : 's'}.${failedCount ? ` ${failedCount} failed; check console before retrying.` : ''}`);
    await loadMasterSchedule();
    switchMasterView('close-requests');
}

function renderActivityList(entries = []) {
    const container = document.getElementById('masterActivityList');
    if (!container) return;
    if (!entries.length) {
        container.innerHTML = '<div class="master-activity-empty">No recorded activity yet.</div>';
        return;
    }
    container.innerHTML = entries.map((entry) => `
        <article class="master-activity-entry">
            <strong>${escapeHtml(entry.action_label || 'Activity')}</strong>
            <span>${escapeHtml(entry.detail || 'No details provided.')}</span>
            <span>${escapeHtml(entry.actor || 'Master Schedule')} · ${escapeHtml(formatActivityTimestamp(entry.created_at))}</span>
        </article>
    `).join('');
}

function formatActivityTimestamp(value) {
    const text = clean(value);
    if (!text) return 'No timestamp';
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text;
    return parsed.toLocaleString('en-PH', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function openMasterStatusModal(rowKey) {
    const row = findScheduleRow(rowKey);
    if (!row) return;
    masterState.selectedStatusRowKey = rowKey;
    document.getElementById('masterStatusCustomer').textContent = row.customer || '-';
    document.getElementById('masterStatusReference').textContent = row.referenceNo || row.docId || '-';
    document.getElementById('masterStatusAssignedTo').textContent = row.assignedTo || 'Unassigned';
    document.getElementById('masterStatusModalSubtitle').textContent = `${row.branch || 'Main'} · ${row.purpose || 'Schedule'} · ${row.sourceNote || 'Master Schedule'}`;
    document.getElementById('masterStatusValueInput').value = row.masterStatusValue || 'closed_fixed';
    document.getElementById('masterStatusOverlay')?.classList.add('visible');
    document.getElementById('masterStatusModal')?.classList.add('open');
    document.getElementById('masterStatusModal')?.setAttribute('aria-hidden', 'false');
    renderActivityList(masterState.activityLogs.get(row.activityKey) || []);
    const entries = await loadActivityLogEntries(row.activityKey);
    if (masterState.selectedStatusRowKey === rowKey) renderActivityList(entries);
}

function closeMasterStatusModal() {
    masterState.selectedStatusRowKey = '';
    document.getElementById('masterStatusOverlay')?.classList.remove('visible');
    document.getElementById('masterStatusModal')?.classList.remove('open');
    document.getElementById('masterStatusModal')?.setAttribute('aria-hidden', 'true');
}

async function saveMasterStatusFromModal() {
    const row = findScheduleRow(masterState.selectedStatusRowKey);
    if (!row) {
        closeMasterStatusModal();
        return;
    }
    const nextStatusValue = clean(document.getElementById('masterStatusValueInput')?.value || '');
    if (!nextStatusValue) return;
    if (nextStatusValue === clean(row.masterStatusValue)) {
        closeMasterStatusModal();
        return;
    }
    const previousLabel = row.masterStatusLabel || 'Not Set';
    const nextLabel = statusLabel(nextStatusValue);
    const saveBtn = document.getElementById('masterStatusSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    try {
        await saveScheduleStatus(row, nextStatusValue);
        await appendActivityLog(row, {
            actionType: 'status_update',
            actionLabel: 'Status Updated',
            detail: `Changed status from ${previousLabel} to ${nextLabel}.`
        });
        const entries = masterState.activityLogs.get(row.activityKey) || [];
        renderActivityList(entries);
        renderMasterSchedule();
        closeMasterStatusModal();
    } catch (error) {
        console.error('Master status update failed:', error);
        window.alert(`Unable to save status: ${error.message || error}`);
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function updateSearchDecorations(searchQuery = '', matchCount = 0) {
    const clearButton = document.getElementById('masterSearchClearBtn');
    const meta = document.getElementById('masterSearchMeta');
    if (clearButton) clearButton.hidden = !searchQuery;
    if (!meta) return;
    meta.textContent = searchQuery
        ? `${matchCount.toLocaleString()} match${matchCount === 1 ? '' : 'es'} for "${searchQuery}" across serial, reference, customer, and branch.`
        : 'Find by serial, reference no., customer, or branch.';
}

async function reassignScheduleFromSelect(rowKey, staffId) {
    const row = findScheduleRow(rowKey);
    const employee = getStaffById(staffId);
    if (!row || !employee || masterState.reassigning) {
        renderMasterSchedule();
        return;
    }

    const oldStaff = row.assignedTo || 'Unassigned';
    const newStaff = employeeName(employee, staffId);
    if (oldStaff === newStaff) return;

    const scope = clean(document.getElementById('masterMoveScopeInput')?.value || 'row');
    const targets = scope === 'staff'
        ? masterState.rows.filter((item) => item.assignedTo === oldStaff && clean(item.status).toLowerCase() !== 'cancelled')
        : [row];

    if (targets.length > 1) {
        const ok = window.confirm(`Move ${targets.length} schedule row(s) assigned to ${oldStaff} to ${newStaff}?`);
        if (!ok) {
            renderMasterSchedule();
            return;
        }
    }

    masterState.reassigning = true;
    const count = document.getElementById('masterCount');
    if (count) count.textContent = `Moving ${targets.length} schedule row(s)...`;

    try {
        for (const target of targets) {
            const previousOwner = target.assignedTo || 'Unassigned';
            await updateScheduleOwner(target, employee);
            await appendActivityLog(target, {
                actionType: 'reassign',
                actionLabel: 'Assigned Staff Updated',
                detail: `Reassigned from ${previousOwner} to ${newStaff}.`
            });
        }
        const selectedDate = document.getElementById('masterDateInput')?.value || formatDateYmd(new Date());
        if (count) count.textContent = 'Refreshing field schedule snapshot...';
        await rebuildMasterScheduleSnapshotCache(selectedDate);
        masterState.rows.sort((a, b) => {
            if (a.assignedTo !== b.assignedTo) return a.assignedTo.localeCompare(b.assignedTo);
            if (a.area !== b.area) return a.area.localeCompare(b.area);
            return a.customer.localeCompare(b.customer);
        });
        renderMasterSchedule();
        if (count) count.textContent = `Moved ${targets.length} schedule row(s) to ${newStaff}.`;
    } catch (error) {
        console.error('Schedule reassignment failed:', error);
        if (count) count.textContent = `Move failed: ${error.message || error}`;
        renderMasterSchedule();
    } finally {
        masterState.reassigning = false;
    }
}

async function saveForwardedRoute(row, targetDate) {
    const scheduleId = Number(row.scheduleId || 0) || 0;
    if (!scheduleId) throw new Error('This row has no linked schedule ID.');
    let staffId = Number(row.techId || 0) || 0;
    if (!staffId) throw new Error('Assign a technician or messenger before forwarding.');
    const assignment = validateScheduleAssignment(row);
    if (!assignment.ok) throw new Error(assignment.reason);
    const exceptionReason = scheduleExceptionReason(row);
    if (exceptionReason) throw new Error(exceptionReason);
    const scheduleDocId = clean(row.docId || scheduleId);
    if (!scheduleDocId || scheduleDocId === '0') throw new Error(`Schedule ${scheduleId} has no valid Firestore document ID.`);

    const targetDateTime = routeDateTimeFor(row, targetDate);
    if (window.MargaScheduleConsolidation) {
        const consolidation = await MargaScheduleConsolidation.resolveAssignment({
            moduleName: 'master-schedule',
            date: targetDate,
            taskDatetime: targetDateTime,
            companyId: row.companyId,
            branchId: row.branchId,
            staffId,
            staffName: row.assignedTo,
            purposeId: row.purposeId || '',
            scheduleId,
            currentDocId: scheduleDocId,
            customerName: row.customer,
            getStaffName: (id) => employeeName(masterState.lookups.employees.get(String(id)), id)
        });
        if (!consolidation.ok) throw new Error('Forwarding cancelled by consolidation rule.');
        staffId = Number(consolidation.staffId || staffId) || staffId;
    }
    const routeDocId = routeDocIdFor(scheduleId, targetDate);
    const nowIso = new Date().toISOString();
    const actor = currentActorLabel();
    const previousRouteDocId = clean(row.routeDocId || row.routeId);
    const previousRouteSource = clean(row.routeSource);
    const routePayload = {
        id: Number(routeDocId),
        schedule_id: scheduleId,
        tech_id: staffId,
        task_datetime: targetDateTime,
        status: 1,
        iscancelled: 0,
        date_finished: ZERO_DATETIME,
        remarks: clean(row.remarks || row.trouble || ''),
        forwarded_from_date: row.routeDate || row.originalDate || '',
        forwarded_from_schedule_id: scheduleId,
        forwarded_by: actor,
        forwarded_at: nowIso,
        timestmp: nowIso,
        bridge_pushed_at: nowIso
    };
    await setDoc(ROUTE_COLLECTION_FALLBACK, routeDocId, routePayload);

    if (previousRouteDocId && previousRouteSource && previousRouteSource !== 'Schedule' && row.routeDate !== targetDate) {
        const previousRouteCollection = previousRouteSource.toLowerCase().includes('printed')
            ? ROUTE_COLLECTION_PRIMARY
            : ROUTE_COLLECTION_FALLBACK;
        await updateDocFields(previousRouteCollection, previousRouteDocId, {
            status: 0,
            iscancelled: 1,
            date_finished: nowIso,
            remarks: `${clean(row.remarks || row.trouble || '')} | Forwarded to ${targetDate}`,
            bridge_pushed_at: nowIso
        });
    }

    const schedulePayload = {
        task_datetime: targetDateTime,
        tech_id: staffId,
        date_finished: ZERO_DATETIME,
        closedby: 0,
        master_schedule_status: 'open',
        master_schedule_status_label: statusLabel('open'),
        master_schedule_status_updated_at: nowIso,
        master_schedule_status_updated_by: actor
    };
    if (!row.originalDate) schedulePayload.original_sched = clean(getRouteTaskDateTime(row));
    await updateDocFields('tbl_schedule', scheduleDocId, schedulePayload);

    row.routeId = Number(routeDocId);
    row.routeDocId = routeDocId;
    row.routeSource = 'Saved';
    row.routeDate = targetDate;
    row.status = 'Active';
    row.masterStatusValue = 'open';
    row.masterStatusLabel = statusLabel('open');
    refreshMasterRowSearch(row);
}

async function forwardScheduleRows(rows, targetDate, approval = null) {
    const validRows = rows.filter(isOpenScheduleRow);
    if (!validRows.length) {
        window.alert('No open schedule rows are available to forward.');
        return;
    }
    if (!targetDate) {
        window.alert('Choose a target date first.');
        return;
    }

    masterState.routeForwarding = true;
    const count = document.getElementById('masterCount');
    if (count) count.textContent = `Forwarding ${validRows.length} open schedule row(s)...`;
    const failures = [];

    for (const row of validRows) {
        try {
            await saveForwardedRoute(row, targetDate);
            appendActivityLog(row, {
                actionType: 'forward',
                actionLabel: 'Forwarded To Schedule',
                detail: `Forwarded open schedule to ${targetDate}.${approval ? ` Override approved by ${approval.approverLabel}.` : ''}`
            }).catch((error) => {
                console.warn('Forward activity log failed:', error);
            });
        } catch (error) {
            failures.push({ row, error });
        }
    }

    masterState.routeForwarding = false;
    if (failures.length) {
        console.warn('Schedule forward failures:', failures);
        window.alert(`Forwarding completed with ${failures.length} failure(s). Check the console for details.`);
    }
    await loadMasterSchedule();
}

async function forwardScheduleRow(rowKey, button) {
    if (masterState.routeForwarding) return;
    const row = findScheduleRow(rowKey);
    if (!row) return;
    const input = button?.closest('.schedule-forward-tools')?.querySelector('.schedule-forward-date');
    const targetDate = clean(input?.value || document.getElementById('masterForwardDateInput')?.value);
    if (!targetDate) {
        window.alert('Choose a target date first.');
        return;
    }
    const staffName = row.assignedTo || 'this staff';
    const staffRows = [...getVisibleRows(), ...getVisiblePendingRows()]
        .filter(isOpenScheduleRow)
        .filter((item) => item.assignedTo === row.assignedTo);
    const moveAllStaff = staffRows.length > 1
        ? window.confirm(`Move all the schedule of ${staffName} to ${targetDate}?\n\nOK = move all ${staffRows.length} open schedule(s).\nCancel = move only the selected row.`)
        : false;
    const targets = moveAllStaff ? staffRows : (Array.isArray(row.combinedRows) && row.combinedRows.length ? row.combinedRows : [row]);
    let overrideApproval = null;
    const targetStaffId = clean(row.techId);
    if (targetStaffId && !activeScheduleStaffIds().includes(targetStaffId)) {
        overrideApproval = await requestScheduleOverride({
            existingApproval: overrideApproval,
            targetStaffId,
            title: 'Inactive Staff Forward Override',
            message: `${staffName} is not in the active scheduling roster.`,
            reason: 'Forwarding normally stays locked to active employees only. Approve this only when the office intentionally wants this inactive-roster employee to keep the follow-up visit.'
        });
    }
    button.disabled = true;
    try {
        await forwardScheduleRows(targets, targetDate, overrideApproval);
    } finally {
        button.disabled = false;
    }
}

async function forwardVisibleOpenSchedules() {
    if (masterState.routeForwarding) return;
    const selectedDate = document.getElementById('masterDateInput')?.value || formatDateYmd(new Date());
    const targetDate = clean(document.getElementById('masterForwardDateInput')?.value) || addDays(selectedDate, 1);
    const rows = [...getVisibleRows(), ...getVisiblePendingRows()].filter(isOpenScheduleRow);
    if (!rows.length) {
        window.alert('No visible open schedules to forward.');
        return;
    }
    const ok = window.confirm(`Forward ${rows.length} open schedule row(s) to ${targetDate}?`);
    if (!ok) return;
    let overrideApproval = null;
    const inactiveStaffIds = [...new Set(
        rows
            .map((row) => clean(row.techId))
            .filter(Boolean)
            .filter((staffId) => !activeScheduleStaffIds().includes(staffId))
    )];
    if (inactiveStaffIds.length) {
        overrideApproval = await requestScheduleOverride({
            existingApproval: overrideApproval,
            title: 'Inactive Staff Forward Override',
            message: `${inactiveStaffIds.length} inactive-roster assignee${inactiveStaffIds.length === 1 ? '' : 's'} are included in this forward action.`,
            reason: 'Bulk forwarding normally stays limited to active employees. Approve this only when the office intentionally wants these inactive-roster employees to keep the next-day or carry-over route.'
        });
        inactiveStaffIds.forEach((staffId) => rememberInactiveRosterApproval(staffId, overrideApproval));
    }
    await forwardScheduleRows(rows, targetDate, overrideApproval);
}

function activeRows() {
    return masterState.rows
        .filter((row) => clean(row.status).toLowerCase() !== 'cancelled')
        .filter((row) => validateScheduleAssignment(row).ok && !scheduleExceptionReason(row));
}

window.openMasterStatusModal = openMasterStatusModal;
window.forwardScheduleRow = forwardScheduleRow;
window.saveSchedulePriority = saveSchedulePriority;
window.approveCloseRequest = approveCloseRequest;
window.approveCloseRequestBySchedule = approveCloseRequestBySchedule;

function uniqueAssignedStaff(rows = activeRows()) {
    const activeStaffNames = new Set(scheduleStaffOptions().map((employee) => employeeName(employee, employee.id)));
    return Array.from(new Set(rows.map((row) => row.assignedTo || 'Unassigned')))
        .filter((name) => name === 'Unassigned' || activeStaffNames.has(name))
        .sort();
}

function renderPrintStaffOptions() {
    const select = document.getElementById('masterPrintStaffInput');
    if (!select) return;
    const current = select.value;
    const staff = uniqueAssignedStaff();
    select.innerHTML = staff.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    if (staff.includes(current)) select.value = current;
    updatePrintStaffVisibility();
}

function updatePrintStaffVisibility() {
    const scope = clean(document.getElementById('masterPrintScopeInput')?.value || 'all');
    const staffInput = document.getElementById('masterPrintStaffInput');
    if (staffInput) staffInput.disabled = scope !== 'staff';
}

function rowsForPrint() {
    const scope = clean(document.getElementById('masterPrintScopeInput')?.value || 'all');
    if (scope === 'visible') return getVisibleRows().filter((row) => validateScheduleAssignment(row).ok && !scheduleExceptionReason(row));
    if (scope === 'staff') {
        const staff = clean(document.getElementById('masterPrintStaffInput')?.value);
        return activeRows().filter((row) => row.assignedTo === staff);
    }
    return activeRows();
}

function renderScheduleHtml(rows, title = 'Master Schedule') {
    const groups = new Map();
    rows.forEach((row) => {
        const key = row.assignedTo || 'Unassigned';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });

    return `
        ${Array.from(groups.entries()).map(([staff, groupRows]) => `
            <section class="print-staff-page">
                <header class="print-page-header">
                    <div>
                        <h1>${escapeHtml(title)}</h1>
                        <h2>${escapeHtml(staff)}</h2>
                    </div>
                    <p>Open Marga App and login to view this schedule on the device.</p>
                </header>
                <table>
                    <thead>
                        <tr>
                            <th>TIN #</th>
                            <th>Customer / Branch</th>
                            <th>Purpose</th>
                            <th>Model</th>
                            <th>Trouble</th>
                            <th>City</th>
                            <th>Address</th>
                            <th>Days Pending</th>
                            <th>Ready</th>
                            <th>Assigned To</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${groupRows
                            .slice()
                            .sort((a, b) => readySortValue(a.readyStatus) - readySortValue(b.readyStatus) || Number(b.daysPending || 0) - Number(a.daysPending || 0))
                            .map((row) => `
                                <tr>
                                    <td>${escapeHtml(row.tin || '-')}</td>
                                    <td><strong>${escapeHtml(row.customer || '-')}</strong><br>${escapeHtml(row.branch || '-')}</td>
                                    <td>${escapeHtml(row.purpose || '-')}</td>
                                    <td>${escapeHtml(row.model || '-')}</td>
                                    <td>${escapeHtml(row.trouble || row.remarks || '-')}</td>
                                    <td>${escapeHtml(row.city || '-')}</td>
                                    <td>${escapeHtml(row.address || '-')}</td>
                                    <td>${escapeHtml(row.daysPending === '' ? '-' : row.daysPending)}</td>
                                    <td>${escapeHtml(row.readyStatus || 'N/A')}</td>
                                    <td>${escapeHtml(row.assignedTo || '-')}</td>
                                </tr>
                            `).join('')}
                    </tbody>
                </table>
            </section>
        `).join('')}
    `;
}

function printMasterSchedule() {
    const rows = rowsForPrint();
    if (!rows.length) {
        window.alert('No schedule rows to print for the selected option.');
        return;
    }

    const date = document.getElementById('masterDateInput')?.value || formatDateYmd(new Date());
    const scope = clean(document.getElementById('masterPrintScopeInput')?.value || 'all');
    const staff = clean(document.getElementById('masterPrintStaffInput')?.value);
    const suffix = scope === 'staff' && staff ? ` - ${staff}` : '';
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) {
        window.alert('Please allow pop-ups to print the schedule.');
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Master Schedule ${escapeHtml(date)}${escapeHtml(suffix)}</title>
            <style>
                body { font-family: Arial, sans-serif; color: #111827; padding: 8px; }
                h1 { font-size: 16px; margin: 0 0 3px; text-align: center; }
                h2 { font-size: 13px; margin: 0; }
                table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 8.5px; line-height: 1.15; }
                th, td { border: 1px solid #111827; padding: 2px 3px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
                th { font-weight: 800; }
                .print-staff-page { break-after: page; page-break-after: always; min-height: calc(100vh - 36px); }
                .print-staff-page:last-child { break-after: auto; page-break-after: auto; }
                .print-page-header {
                    align-items: flex-start;
                    display: flex;
                    justify-content: space-between;
                    gap: 10px;
                    margin: 0 0 5px;
                }
                .print-page-header p { color: #4b5563; font-size: 8.5px; margin: 2px 0 0; text-align: right; }
                th:nth-child(1), td:nth-child(1) { width: 9%; }
                th:nth-child(2), td:nth-child(2) { width: 18%; }
                th:nth-child(3), td:nth-child(3) { width: 8%; }
                th:nth-child(4), td:nth-child(4) { width: 10%; }
                th:nth-child(5), td:nth-child(5) { width: 11%; }
                th:nth-child(6), td:nth-child(6) { width: 7%; }
                th:nth-child(7), td:nth-child(7) { width: 20%; }
                th:nth-child(8), td:nth-child(8) { width: 5%; text-align: center; }
                th:nth-child(9), td:nth-child(9) { width: 5%; text-align: center; }
                th:nth-child(10), td:nth-child(10) { width: 7%; }
                @page { size: landscape; margin: 7mm; }
            </style>
        </head>
        <body>${renderScheduleHtml(rows, `Master Schedule - ${date}${suffix}`)}</body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
}

function allAreas() {
    return Array.from(new Set([...DEFAULT_AREAS, ...masterState.customAreas])).filter(Boolean).sort((a, b) => {
        const ai = DEFAULT_AREAS.indexOf(a);
        const bi = DEFAULT_AREAS.indexOf(b);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return a.localeCompare(b);
    });
}

function allCities() {
    const branchCities = masterState.settings.branches.map((branch) => branchCity(branch)).filter(Boolean);
    return Array.from(new Set([...DEFAULT_CITIES, ...masterState.customCities, ...branchCities])).filter(Boolean).sort();
}

function renderOptions(select, values, selected = '') {
    if (!select) return;
    select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
}

function bindSettingsControls() {
    document.getElementById('areaList')?.addEventListener('change', (event) => {
        masterState.selectedArea = event.target.value || masterState.selectedArea;
        renderAreaSettings();
    });
    document.getElementById('addAreaBtn')?.addEventListener('click', addArea);
    document.getElementById('addCityBtn')?.addEventListener('click', () => assignCityToArea(clean(document.getElementById('newCityInput')?.value)));
    document.getElementById('assignCityBtn')?.addEventListener('click', () => assignCityToArea(document.getElementById('availableCityList')?.value));
    document.getElementById('unassignCityBtn')?.addEventListener('click', () => unassignCityFromArea(document.getElementById('assignedCityList')?.value));

    document.getElementById('techList')?.addEventListener('change', (event) => {
        masterState.selectedTechId = event.target.value || masterState.selectedTechId;
        renderTechSettings();
    });
    document.getElementById('addTechAreaBtn')?.addEventListener('click', addTechArea);
    document.getElementById('assignTechAreaBtn')?.addEventListener('click', () => assignAreaToTech(document.getElementById('techAvailableAreaList')?.value));
    document.getElementById('unassignTechAreaBtn')?.addEventListener('click', () => unassignAreaFromTech(document.getElementById('techAssignedAreaList')?.value));
    document.getElementById('techAvailableAreaList')?.addEventListener('dblclick', (event) => assignAreaToTech(event.target?.value));
    document.getElementById('techAssignedAreaList')?.addEventListener('dblclick', (event) => unassignAreaFromTech(event.target?.value));

    document.getElementById('clientSearchInput')?.addEventListener('input', renderClientResults);
}

async function ensureSettingsData() {
    if (masterState.settingsLoaded) return;
    setSettingsStatus('Loading setup data...');

    const [employeeRows, branchRows, companyRows, positionRows, rosterDoc] = await Promise.all([
        fetchCollection('tbl_employee', {
            fieldMask: ['id', 'firstname', 'lastname', 'nickname', 'name', 'email', 'marga_login_email', 'username', 'position_id', 'position', 'position_name', 'position_label', 'marga_role', 'marga_roles', 'estatus', 'active', 'marga_active', 'marga_account_active'],
            maxPages: 40
        }).catch(() => []),
        fetchCollection('tbl_branchinfo', {
            fieldMask: ['id', 'company_id', 'branchname', 'branch_address', 'bldg', 'floor', 'street', 'brgy', 'city', 'email'],
            maxPages: 40
        }).catch(() => []),
        fetchCollection('tbl_companylist', {
            fieldMask: ['id', 'companyname', 'company_tin', 'tin', 'tin_no', 'tin_number'],
            maxPages: 30
        }).catch(() => []),
        fetchCollection('tbl_empos', {
            fieldMask: ['id', 'position', 'position_name', 'name'],
            maxPages: 10
        }).catch(() => []),
        fetchDoc('tbl_app_settings', 'active_employee_roster_v1').catch(() => null)
    ]);

    masterState.activeEmployeeEmails = new Set(
        (rosterDoc?.active_emails || []).map((email) => clean(email).toLowerCase()).filter(Boolean)
    );

    employeeRows.forEach((employee) => {
        if (employee.id) masterState.lookups.employees.set(String(employee.id), employee);
    });
    companyRows.forEach((company) => {
        if (company.id) masterState.lookups.companies.set(String(company.id), company);
    });
    branchRows.forEach((branch) => {
        if (branch.id) masterState.lookups.branches.set(String(branch.id), branch);
    });
    positionRows.forEach((position) => {
        if (position.id) masterState.lookups.positions.set(String(position.id), position);
    });

    const activeEmployeeIds = new Set(
        (window.MargaUtils?.getActiveAssignmentEmployees
            ? MargaUtils.getActiveAssignmentEmployees(employeeRows, { positions: masterState.lookups.positions })
            : employeeRows.filter(isActiveScheduleEmployee))
            .map((employee) => String(employee.id || ''))
            .filter(Boolean)
    );
    masterState.settings.employees = employeeRows
        .filter((employee) => employee.id && activeEmployeeIds.has(String(employee.id)))
        .sort((a, b) => employeeName(a, a.id).localeCompare(employeeName(b, b.id)));
    masterState.settings.branches = branchRows
        .filter((branch) => branch.id)
        .sort((a, b) => {
            const ac = clean(masterState.lookups.companies.get(String(a.company_id))?.companyname);
            const bc = clean(masterState.lookups.companies.get(String(b.company_id))?.companyname);
            return `${ac} ${a.branchname || ''}`.localeCompare(`${bc} ${b.branchname || ''}`);
        });

    masterState.settingsLoaded = true;
    setSettingsStatus('Setup data loaded.');
}

async function switchMasterView(view) {
    if (view === 'close-requests' && !canManageCloseRequests()) view = 'schedule';
    document.querySelectorAll('[data-master-view]').forEach((button) => {
        button.classList.toggle('active', button.dataset.masterView === view);
    });
    document.getElementById('masterScheduleView')?.classList.toggle('hidden', view !== 'schedule');
    document.getElementById('masterSettingsView')?.classList.toggle('hidden', view !== 'settings');
    document.getElementById('masterCloseRequestsView')?.classList.toggle('hidden', view !== 'close-requests');
    if (view === 'settings') {
        await ensureSettingsData();
        renderSettings();
    }
    if (view === 'close-requests') renderCloseRequestsPanel();
}

function switchSettingsTab(tab) {
    document.querySelectorAll('[data-settings-tab]').forEach((button) => {
        button.classList.toggle('active', button.dataset.settingsTab === tab);
    });
    document.getElementById('areaSettingsPanel')?.classList.toggle('hidden', tab !== 'area');
    document.getElementById('techSettingsPanel')?.classList.toggle('hidden', tab !== 'tech');
    document.getElementById('clientSettingsPanel')?.classList.toggle('hidden', tab !== 'client');
    renderSettings();
}

function renderSettingsIfVisible() {
    if (!document.getElementById('masterSettingsView')?.classList.contains('hidden')) renderSettings();
}

function renderSettings() {
    const active = document.querySelector('[data-settings-tab].active')?.dataset.settingsTab || 'area';
    if (active === 'area') renderAreaSettings();
    if (active === 'tech') renderTechSettings();
    if (active === 'client') renderClientSettings();
}

function renderAreaSettings() {
    const areas = allAreas();
    if (!areas.includes(masterState.selectedArea)) masterState.selectedArea = areas[0] || '';
    renderOptions(document.getElementById('areaList'), areas, masterState.selectedArea);

    const assigned = Array.from(masterState.areaCityRows.values())
        .filter((row) => clean(row.area) === masterState.selectedArea)
        .map((row) => clean(row.city))
        .filter(Boolean)
        .sort();
    const available = allCities().filter((city) => !assigned.includes(city));
    renderOptions(document.getElementById('assignedCityList'), assigned);
    renderOptions(document.getElementById('availableCityList'), available);
}

function renderTechSettings() {
    const techs = scheduleStaffOptions();
    if (!masterState.selectedTechId && techs[0]) masterState.selectedTechId = String(techs[0].id);
    const list = document.getElementById('techList');
    if (list) {
        list.innerHTML = techs.map((employee) => `
            <option value="${escapeHtml(employee.id)}"${String(employee.id) === masterState.selectedTechId ? ' selected' : ''}>
                ${escapeHtml(employeeName(employee, employee.id))} - ${escapeHtml(employeeRole(employee))}
            </option>
        `).join('');
    }

    const assigned = Array.from(masterState.techAreaRows.get(masterState.selectedTechId)?.keys() || []).sort();
    const available = allAreas().filter((area) => !assigned.includes(area));
    renderOptions(document.getElementById('techAssignedAreaList'), assigned);
    renderOptions(document.getElementById('techAvailableAreaList'), available);
}

function renderClientSettings() {
    renderClientResults();
    renderClientEditor();
}

function renderClientResults() {
    const results = document.getElementById('clientResults');
    if (!results) return;
    const search = normalizeSearch(document.getElementById('clientSearchInput')?.value || '');
    const rows = masterState.settings.branches
        .filter((branch) => {
            const company = masterState.lookups.companies.get(String(branch.company_id));
            const text = normalizeSearch(`${company?.companyname || ''} ${branch.branchname || ''}`);
            return !search || text.includes(search);
        })
        .slice(0, 80);

    results.innerHTML = rows.length ? rows.map((branch) => {
        const company = masterState.lookups.companies.get(String(branch.company_id));
        const selected = String(branch.id) === masterState.selectedBranchId;
        return `
            <button class="client-result${selected ? ' active' : ''}" type="button" onclick="selectClientBranch('${escapeHtml(branch.id)}')">
                <strong>${escapeHtml(company?.companyname || 'Unknown Company')}</strong>
                <span>${escapeHtml(branch.branchname || 'Main')}</span>
            </button>
        `;
    }).join('') : '<div class="master-empty">No branch found.</div>';
}

function renderClientEditor() {
    const editor = document.getElementById('clientAreaEditor');
    if (!editor) return;
    const branch = masterState.lookups.branches.get(String(masterState.selectedBranchId || ''));
    if (!branch) {
        editor.innerHTML = '<div class="master-empty">Select a company or branch to set service, billing, collection, and delivery area.</div>';
        return;
    }
    const company = masterState.lookups.companies.get(String(branch.company_id));
    const row = masterState.clientAreaRows.get(String(branch.id)) || {};
    const areas = allAreas();
    const cities = allCities();

    editor.innerHTML = `
        <div class="settings-row" style="margin:0 0 12px;">
            <input type="text" value="${escapeHtml(company?.companyname || '')}" readonly>
            <input type="text" value="${escapeHtml(branch.branchname || '')}" readonly>
            <button class="btn btn-primary btn-sm" type="button" onclick="saveClientArea()">Save</button>
        </div>
        <div class="client-form-grid">
            ${CLIENT_INFO_TYPES.map((type) => `
                <section class="client-info-card">
                    <h3>${escapeHtml(type.label)}</h3>
                    <div class="settings-field">
                        <label>Address</label>
                        <textarea id="${type.key}AddressInput" rows="3">${escapeHtml(row[`${type.key}_address`] || branch.branch_address || '')}</textarea>
                    </div>
                    <div class="settings-field">
                        <label>Con. Person</label>
                        <input id="${type.key}ContactInput" type="text" value="${escapeHtml(row[`${type.key}_contact_person`] || '')}">
                    </div>
                    <div class="settings-field">
                        <label>Con. Num.</label>
                        <input id="${type.key}NumberInput" type="text" value="${escapeHtml(row[`${type.key}_contact_number`] || '')}">
                    </div>
                    <div class="settings-field">
                        <label>Select Area</label>
                        <select id="${type.key}AreaInput">
                            ${areas.map((area) => `<option value="${escapeHtml(area)}"${area === (row[`${type.key}_area`] || 'South 1') ? ' selected' : ''}>${escapeHtml(area)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="settings-field">
                        <label>City</label>
                        <select id="${type.key}CityInput">
                            ${cities.map((city) => `<option value="${escapeHtml(city)}"${city === (row[`${type.key}_city`] || branchCity(branch) || 'Laguna') ? ' selected' : ''}>${escapeHtml(city)}</option>`).join('')}
                        </select>
                    </div>
                </section>
            `).join('')}
        </div>
    `;
}

function setSettingsStatus(message) {
    const node = document.getElementById('settingsStatus');
    if (node) node.textContent = message;
}

async function addArea() {
    const area = clean(document.getElementById('newAreaInput')?.value);
    if (!area) return;
    masterState.customAreas.add(area);
    masterState.selectedArea = area;
    document.getElementById('newAreaInput').value = '';
    renderAreaSettings();
    renderTechSettings();
    setSettingsStatus(`Added area ${area}. Assign cities or technicians to save mappings.`);
}

async function assignCityToArea(city) {
    city = clean(city);
    if (!city || !masterState.selectedArea) return;
    const row = { area: masterState.selectedArea, city, updated_at: new Date().toISOString() };
    const docId = `${slug(masterState.selectedArea)}_${slug(city)}`;
    await setDoc('marga_master_schedule_area_cities', docId, row);
    masterState.areaCityRows.set(slug(city), { ...row, _docId: docId });
    masterState.customAreas.add(masterState.selectedArea);
    masterState.customCities.add(city);
    document.getElementById('newCityInput').value = '';
    renderAreaSettings();
    setSettingsStatus(`Assigned ${city} to ${masterState.selectedArea}.`);
}

async function unassignCityFromArea(city) {
    city = clean(city);
    const row = masterState.areaCityRows.get(slug(city));
    if (!row) return;
    await deleteDoc('marga_master_schedule_area_cities', row._docId || `${slug(row.area)}_${slug(city)}`);
    masterState.areaCityRows.delete(slug(city));
    renderAreaSettings();
    setSettingsStatus(`Unassigned ${city}.`);
}

async function addTechArea() {
    const area = clean(document.getElementById('newTechAreaInput')?.value);
    if (!area) return;
    masterState.customAreas.add(area);
    document.getElementById('newTechAreaInput').value = '';
    await assignAreaToTech(area);
}

async function assignAreaToTech(area) {
    area = clean(area);
    if (!masterState.selectedTechId) {
        setSettingsStatus('Select a technician or messenger first.');
        return;
    }
    if (!area) {
        setSettingsStatus('Select an available area first, then click Assign.');
        return;
    }
    const employee = masterState.lookups.employees.get(masterState.selectedTechId);
    const row = {
        tech_id: masterState.selectedTechId,
        tech_name: employeeName(employee, masterState.selectedTechId),
        area,
        updated_at: new Date().toISOString()
    };
    const docId = `${slug(masterState.selectedTechId)}_${slug(area)}`;
    await setDoc('marga_master_schedule_tech_areas', docId, row);
    if (!masterState.techAreaRows.has(masterState.selectedTechId)) masterState.techAreaRows.set(masterState.selectedTechId, new Map());
    masterState.techAreaRows.get(masterState.selectedTechId).set(area, { ...row, _docId: docId });
    masterState.customAreas.add(area);
    renderTechSettings();
    setSettingsStatus(`Assigned ${area} to ${row.tech_name}.`);
}

async function unassignAreaFromTech(area) {
    area = clean(area);
    if (!masterState.selectedTechId) {
        setSettingsStatus('Select a technician or messenger first.');
        return;
    }
    if (!area) {
        setSettingsStatus('Select an assigned area first, then click Remove.');
        return;
    }
    const row = masterState.techAreaRows.get(masterState.selectedTechId)?.get(area);
    if (!row) {
        setSettingsStatus(`${area} is not assigned to the selected staff.`);
        return;
    }
    await deleteDoc('marga_master_schedule_tech_areas', row._docId || `${slug(masterState.selectedTechId)}_${slug(area)}`);
    masterState.techAreaRows.get(masterState.selectedTechId).delete(area);
    renderTechSettings();
    setSettingsStatus(`Unassigned ${area}.`);
}

function selectClientBranch(branchId) {
    masterState.selectedBranchId = String(branchId || '');
    renderClientSettings();
}

async function saveClientArea() {
    const branch = masterState.lookups.branches.get(String(masterState.selectedBranchId || ''));
    if (!branch) return;
    const company = masterState.lookups.companies.get(String(branch.company_id));
    const row = {
        branch_id: String(branch.id),
        company_id: String(branch.company_id || ''),
        company_name: clean(company?.companyname),
        branch_name: clean(branch.branchname),
        updated_at: new Date().toISOString()
    };

    CLIENT_INFO_TYPES.forEach((type) => {
        row[`${type.key}_address`] = clean(document.getElementById(`${type.key}AddressInput`)?.value);
        row[`${type.key}_contact_person`] = clean(document.getElementById(`${type.key}ContactInput`)?.value);
        row[`${type.key}_contact_number`] = clean(document.getElementById(`${type.key}NumberInput`)?.value);
        row[`${type.key}_area`] = clean(document.getElementById(`${type.key}AreaInput`)?.value);
        row[`${type.key}_city`] = clean(document.getElementById(`${type.key}CityInput`)?.value);
    });

    const docId = `branch_${branch.id}`;
    await setDoc('marga_master_schedule_client_areas', docId, row);
    masterState.clientAreaRows.set(String(branch.id), { ...row, _docId: docId });
    CLIENT_INFO_TYPES.forEach((type) => {
        if (row[`${type.key}_area`]) masterState.customAreas.add(row[`${type.key}_area`]);
        if (row[`${type.key}_city`]) masterState.customCities.add(row[`${type.key}_city`]);
    });
    renderClientSettings();
    setSettingsStatus(`Saved area setup for ${row.company_name || row.branch_name}.`);
}

window.selectClientBranch = selectClientBranch;
window.saveClientArea = saveClientArea;
window.reassignScheduleFromSelect = reassignScheduleFromSelect;
