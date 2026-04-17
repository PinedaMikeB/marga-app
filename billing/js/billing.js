const els = {
    endMonthInput: null,
    rowLimitInput: null,
    billingPagesInput: null,
    schedulePagesInput: null,
    apiKeyInput: null,
    refreshCacheInput: null,
    runBtn: null,
    copyCurlBtn: null,
    statusPill: null,
    selectionCard: null,
    selectionCopy: null,
    clearSelectionBtn: null,
    summarySubhead: null,
    sheetMeta: null,
    summaryTableWrap: null,
    matrixTableWrap: null,
    matrixSearchInput: null,
    matrixSortInput: null,
    matrixSearchMeta: null,
    invoiceSearchInput: null,
    invoiceSearchBtn: null,
    invoiceSearchResults: null,
    billingExclusionsRefreshBtn: null,
    billingExclusionsList: null,
    rawJson: null,
    invoiceDetailModal: null,
    invoiceDetailTitle: null,
    invoiceDetailSubtitle: null,
    invoiceDetailContent: null,
    rtpInvoicePrintBtn: null,
    invoiceDetailCloseBtn: null,
    serialDetailModal: null,
    serialDetailTitle: null,
    serialDetailSubtitle: null,
    serialDetailContent: null,
    serialDetailCloseBtn: null,
    billingCalcModal: null,
    billingCalcTitle: null,
    billingCalcSubtitle: null,
    billingCalcContent: null,
    billingCalcPrintBtn: null,
    billingCalcCloseBtn: null
};

let lastPayload = null;
let renderedMatrixRows = [];
let searchReloadTimer = null;
let invoiceDetailRequestToken = 0;
let billingCalcRequestToken = 0;
let invoicePreviewReferenceData = null;
let invoicePreviewReferencePromise = null;
let currentRtpPrintPayload = null;
let invoiceSearchGroupCache = new Map();
const priorMachineReadingCache = new Map();
const priorBillingReadingCache = new Map();
let billingExclusionCache = [];
const MATRIX_SORT_STORAGE_KEY = 'marga_billing_matrix_sort';
const DEFAULT_SPOILAGE_RATE = 0.02;
const BILLING_EXCLUSIONS_COLLECTION = 'tbl_billing_exclusions';
const BILLING_EXCLUSION_REASONS = [
    'No delivery happened',
    'Branch/customer inactive',
    'Machine transferred',
    'Duplicate/wrong contract row',
    'Other'
];
const CONTRACT_CATEGORY_META = {
    1: { code: 'RTP', label: 'Rental Per Page' },
    2: { code: 'RTF', label: 'Rental Fixed Rate' },
    3: { code: 'STP', label: 'Straight Per Page' },
    4: { code: 'MAT', label: 'Materials' },
    5: { code: 'RTC', label: 'Rental Toner Covered' },
    6: { code: 'STC', label: 'Straight Toner Covered' },
    7: { code: 'MAC', label: 'Machine Account' },
    8: { code: 'MAP', label: 'Metered Account Plan' },
    9: { code: 'REF', label: 'Refill' },
    10: { code: 'RD', label: 'Reading Only' }
};

function getMatrixSearchTerm() {
    return String(els.matrixSearchInput?.value || '').trim().toLowerCase();
}

function getMatrixSortValue() {
    return String(els.matrixSortInput?.value || 'rd').trim().toLowerCase();
}

function firstPositiveNumber(...values) {
    for (const value of values) {
        const numeric = Number(value || 0) || 0;
        if (numeric > 0) return numeric;
    }
    return 0;
}

function restoreMatrixSortValue() {
    if (!els.matrixSortInput) return;
    const saved = String(localStorage.getItem(MATRIX_SORT_STORAGE_KEY) || '').trim().toLowerCase();
    if (!saved) return;
    const hasOption = Array.from(els.matrixSortInput.options || []).some((option) => option.value === saved);
    if (hasOption) els.matrixSortInput.value = saved;
}

function cacheElements() {
    Object.keys(els).forEach((key) => {
        els[key] = document.getElementById(key);
    });
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function setElementDisplayValue(element, value) {
    if (!element) return;
    if ('value' in element) {
        element.value = String(value ?? '');
        return;
    }
    element.textContent = String(value ?? '');
}

function formatCount(value) {
    return Number(value || 0).toLocaleString('en-PH');
}

function formatAmount(value) {
    const amount = Number(value || 0);
    const hasCents = Math.abs(amount % 1) > 0.0001;
    return amount.toLocaleString('en-PH', {
        minimumFractionDigits: hasCents ? 2 : 0,
        maximumFractionDigits: 2
    });
}

function formatFixedAmount(value) {
    return Number(value || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatMetricCount(value, singular, plural = `${singular}s`) {
    const count = Number(value || 0);
    return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

function getContractCategoryMeta(categoryId) {
    const normalized = Number(categoryId || 0) || 0;
    return CONTRACT_CATEGORY_META[normalized] || {
        code: normalized ? `CAT ${normalized}` : 'N/A',
        label: normalized ? 'Unclassified Contract' : 'Unclassified Contract'
    };
}

function getRowBillingProfile(row) {
    const profile = row?.billing_profile || null;
    if (profile) {
        const categoryMeta = getContractCategoryMeta(profile.category_id);
        const pageRate = Number(profile.page_rate || 0) || 0;
        const succeedingRate = Number(profile.succeeding_page_rate || profile.page_rate_xtra || profile.page_rate2 || 0) || pageRate;
        return {
            ...profile,
            succeeding_page_rate: succeedingRate,
            category_code: profile.category_code || categoryMeta.code,
            category_label: profile.category_label || categoryMeta.label
        };
    }

    const fallbackGroup = Object.values(row?.months || {})
        .flatMap((cell) => Array.isArray(cell?.reading_groups) ? cell.reading_groups : [])
        .sort((left, right) => String(right.task_date || '').localeCompare(String(left.task_date || '')))[0];
    if (!fallbackGroup) return null;

    const categoryMeta = getContractCategoryMeta(fallbackGroup.category_id);
    return {
        category_id: Number(fallbackGroup.category_id || 0) || 0,
        category_code: categoryMeta.code,
        category_label: categoryMeta.label,
        pricing_mode: Number(fallbackGroup.page_rate || 0) > 0 ? 'reading' : (Number(fallbackGroup.monthly_rate || 0) > 0 ? 'fixed' : 'other'),
        page_rate: Number(fallbackGroup.page_rate || 0) || 0,
        monthly_quota: Number(fallbackGroup.monthly_quota || 0) || 0,
        monthly_rate: Number(fallbackGroup.monthly_rate || 0) || 0,
        succeeding_page_rate: Number(fallbackGroup.succeeding_page_rate || fallbackGroup.page_rate_xtra || fallbackGroup.page_rate2 || fallbackGroup.page_rate || 0) || 0,
        with_vat: Boolean(fallbackGroup.with_vat)
    };
}

function getSucceedingPageRate(profile) {
    const pageRate = Number(profile?.page_rate || 0) || 0;
    return Number(profile?.succeeding_page_rate || profile?.page_rate_xtra || profile?.page_rate2 || 0) || pageRate;
}

function formatRtpRatePlan({ quota = 0, pageRate = 0, succeedingRate = 0 } = {}) {
    const effectiveSucceedingRate = succeedingRate || pageRate;
    if (Number(quota || 0) > 0) {
        return `${formatCount(quota)} quota @ ${formatAmount(pageRate)}; succeeding @ ${formatAmount(effectiveSucceedingRate)}`;
    }
    return `All pages @ ${formatAmount(pageRate)}`;
}

function cleanPrintCustomerName(value) {
    return String(value || '')
        .replace(/\s*[\u2022-]\s*company subtotal\s*$/i, '')
        .replace(/\s+company subtotal\s*$/i, '')
        .trim();
}

function formatAllPagesRate(value) {
    const rate = Number(value || 0) || 0;
    const formattedRate = rate
        ? rate.toFixed(2).replace(/^0(?=\.)/, '').replace(/0+$/, '').replace(/\.$/, '')
        : '0';
    return `All pages @ ${formattedRate}`;
}

function isReadingPricing(profile) {
    return String(profile?.pricing_mode || '').toLowerCase() === 'reading';
}

function formatMonthLabel(monthKey, fallback = '') {
    const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return fallback || String(monthKey || '');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    return date.toLocaleString('en-PH', { month: 'short', year: '2-digit' });
}

function formatMonthLongLabel(monthKey, fallback = '') {
    const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return fallback || String(monthKey || '');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    return date.toLocaleString('en-PH', { month: 'long' });
}

function parseMonthInput(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    return {
        year: Number(match[1]),
        month: Number(match[2])
    };
}

function monthInputValue(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function formatIsoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatUsDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}/${date.getFullYear()}`;
}

function asValidDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clampMonthDay(year, monthIndex, day) {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return Math.max(1, Math.min(lastDay, Number(day || 1) || 1));
}

function buildBillingPeriod(monthKey, readingDay) {
    const parsed = parseMonthInput(monthKey);
    if (!parsed) return { from: '', to: '' };

    const safeReadingDay = Math.max(1, Math.min(31, Number(readingDay || 1) || 1));
    const endMonthIndex = parsed.month - 1;
    const startMonthDate = new Date(parsed.year, endMonthIndex - 1, 1);
    const endDate = new Date(parsed.year, endMonthIndex, clampMonthDay(parsed.year, endMonthIndex, safeReadingDay));
    const startDate = new Date(
        startMonthDate.getFullYear(),
        startMonthDate.getMonth(),
        clampMonthDay(startMonthDate.getFullYear(), startMonthDate.getMonth(), safeReadingDay)
    );
    return {
        from: formatIsoDate(startDate),
        to: formatIsoDate(endDate),
        endDate
    };
}

function buildBranchAddress(branch) {
    const parts = [
        branch?.room,
        branch?.floor,
        branch?.bldg,
        branch?.street,
        branch?.brgy,
        branch?.city
    ].filter(Boolean);
    return parts.join(', ');
}

function getBillInfoAddress(billInfo) {
    return String(billInfo?.payeeadd || billInfo?.enduseradd || '').trim();
}

function getCompanyAddress(company) {
    return String(
        company?.company_address
        || company?.address
        || company?.companyadd
        || company?.company_add
        || ''
    ).trim();
}

function getGroupedBillingAddress(references, groupedRows = [], company = null) {
    const addressCounts = new Map();
    (Array.isArray(groupedRows) ? groupedRows : []).forEach((entry) => {
        const branchId = String(entry?.branch_id || '').trim();
        if (!branchId) return;
        const billInfoRows = references?.billInfoByBranchId?.get(branchId) || [];
        billInfoRows.forEach((billInfo) => {
            const address = getBillInfoAddress(billInfo);
            if (!address) return;
            addressCounts.set(address, (addressCounts.get(address) || 0) + 1);
        });
    });

    const commonAddress = Array.from(addressCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || '';
    return commonAddress || getCompanyAddress(company);
}

function toFirestoreFieldValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (value instanceof Date && !Number.isNaN(value.getTime())) return { timestampValue: value.toISOString() };
    if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => toFirestoreFieldValue(entry)) } };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number.isInteger(value)
            ? { integerValue: String(value) }
            : { doubleValue: value };
    }
    return { stringValue: String(value) };
}

async function runFirestoreQuery(structuredQuery) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json();
    if (!response.ok || payload?.error || payload?.[0]?.error) {
        throw new Error(payload?.error?.message || payload?.[0]?.error?.message || 'Failed to run Firestore query.');
    }
    return Array.isArray(payload)
        ? payload
            .map((row) => row?.document)
            .filter(Boolean)
            .map((doc) => MargaUtils.parseFirestoreDoc(doc))
            .filter(Boolean)
        : [];
}

async function queryFirestoreEquals(collection, fieldPath, value) {
    if (value === null || value === undefined || value === '') return [];
    return runFirestoreQuery({
        from: [{ collectionId: collection }],
        where: {
            fieldFilter: {
                field: { fieldPath },
                op: 'EQUAL',
                value: toFirestoreFieldValue(value)
            }
        }
    });
}

function uniqueNonBlankValues(values = []) {
    const seen = new Set();
    const unique = [];
    values.forEach((value) => {
        const key = String(value ?? '').trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        unique.push(value);
    });
    return unique;
}

function chunkValues(values = [], size = 10) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

async function queryFirestoreIn(collection, fieldPath, values = [], options = {}) {
    const uniqueValues = uniqueNonBlankValues(values);
    if (!uniqueValues.length) return [];

    const byDocId = new Map();
    const chunks = chunkValues(uniqueValues, options.chunkSize || 10);
    const queries = chunks.map((chunk) => {
        const structuredQuery = {
            from: [{ collectionId: collection }],
            where: {
                fieldFilter: {
                    field: { fieldPath },
                    op: 'IN',
                    value: {
                        arrayValue: {
                            values: chunk.map((value) => toFirestoreFieldValue(value))
                        }
                    }
                }
            }
        };
        if (Array.isArray(options.select) && options.select.length) {
            structuredQuery.select = {
                fields: options.select.map((selectedFieldPath) => ({ fieldPath: selectedFieldPath }))
            };
        }
        if (Number(options.limit || 0) > 0) {
            structuredQuery.limit = Number(options.limit || 0);
        }
        return structuredQuery;
    });

    const queryResults = await Promise.all(queries.map((structuredQuery) => runFirestoreQuery(structuredQuery)));
    queryResults.flat().forEach((doc) => {
        const docKey = String(doc?._docId || `${doc?.id || ''}:${doc?.current_contract || ''}:${doc?.machine_id || ''}`).trim();
        if (docKey && !byDocId.has(docKey)) byDocId.set(docKey, doc);
    });

    return Array.from(byDocId.values());
}

async function getFirestoreDocument(collection, docId) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${encodeURIComponent(collection)}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}`);
    if (response.status === 404) return null;
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to load ${collection}/${docId}.`);
    }
    return MargaUtils.parseFirestoreDoc(payload);
}

async function setFirestoreDocument(collection, docId, fields, options = {}) {
    if (window.MargaOfflineSync?.writeFirestoreDoc) {
        return window.MargaOfflineSync.writeFirestoreDoc({
            mode: options.mode || 'set',
            collection,
            docId,
            fields,
            label: options.label || `${collection}/${docId}`,
            dedupeKey: options.dedupeKey || `${collection}:${docId}`
        });
    }

    const body = { fields: {} };
    Object.entries(fields).forEach(([key, value]) => {
        body.fields[key] = toFirestoreFieldValue(value);
    });
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to save ${collection}/${docId}.`);
    }
    return { ok: true, queued: false, payload };
}

async function deleteFirestoreDocument(collection, docId) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${encodeURIComponent(collection)}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'DELETE'
    });
    if (response.status === 404) return { ok: true, deleted: false };
    const payload = response.status === 200 ? await response.json().catch(() => ({})) : await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to delete ${collection}/${docId}.`);
    }
    return { ok: true, deleted: true };
}

function monthNumberFromValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    const byName = {
        january: 1,
        february: 2,
        march: 3,
        april: 4,
        may: 5,
        june: 6,
        july: 7,
        august: 8,
        september: 9,
        october: 10,
        november: 11,
        december: 12
    };
    if (byName[raw]) return byName[raw];
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    const month = Math.trunc(numeric);
    return month >= 1 && month <= 12 ? month : null;
}

function getBillingDocMonthKey(doc) {
    const year = Number(doc?.year || 0) || 0;
    let month = monthNumberFromValue(doc?.month);
    if ((!year || !month) && doc) {
        const dateRef = asValidDate(doc.dateprinted || doc.date_printed || doc.invdate || doc.invoice_date || doc.datex || doc.due_date);
        if (dateRef) {
            if (!month) month = dateRef.getMonth() + 1;
            if (!year) {
                const derivedYear = dateRef.getFullYear();
                if (derivedYear) {
                    return `${String(derivedYear).padStart(4, '0')}-${String(month || 0).padStart(2, '0')}`;
                }
            }
        }
    }
    if (!year || !month) return '';
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function getBillingDocInvoiceRef(doc) {
    return String(doc?.invoice_no || doc?.invoiceno || doc?.invoice_id || doc?.invoiceid || '').trim();
}

function getBillingDocSortValue(doc) {
    const dateRef = asValidDate(doc?.updated_at || doc?.invoice_date || doc?.dateprinted || doc?.date_printed || doc?.invdate || doc?.datex || doc?.due_date);
    if (dateRef) return dateRef.getTime();
    const docIdValue = Number(String(doc?._docId || '').replace(/\D/g, '')) || 0;
    return Number(doc?.id || 0) || docIdValue;
}

function pickPrimaryBillingDoc(docs) {
    return [...(Array.isArray(docs) ? docs : [])]
        .sort((left, right) => getBillingDocSortValue(right) - getBillingDocSortValue(left))
        [0] || null;
}

function normalizeInvoiceNumber(value) {
    return String(value || '').trim();
}

function billingSnapshotFromValues({
    invoiceNo,
    previousMeter,
    presentMeter,
    spoilagePercent,
    billingMode = 'single_meter_rtp',
    linesSignature = ''
} = {}) {
    return {
        invoiceNo: normalizeInvoiceNumber(invoiceNo),
        previousMeter: Math.max(0, Number(previousMeter || 0) || 0),
        presentMeter: Math.max(0, Number(presentMeter || 0) || 0),
        spoilagePercent: Number((Number(spoilagePercent || 0) || 0).toFixed(2)),
        billingMode: String(billingMode || 'single_meter_rtp').trim() || 'single_meter_rtp',
        linesSignature: String(linesSignature || '').trim()
    };
}

function billingSnapshotFromDoc(doc, fallback = {}) {
    const spoilagePercent = doc?.spoilage_percent !== undefined && doc?.spoilage_percent !== null && doc?.spoilage_percent !== ''
        ? Number(doc.spoilage_percent || 0)
        : Number(doc?.spoilage_rate || 0) * 100;
    return billingSnapshotFromValues({
        invoiceNo: getBillingDocInvoiceRef(doc) || fallback.invoiceNo,
        previousMeter: doc?.field_previous_meter ?? fallback.previousMeter,
        presentMeter: doc?.field_present_meter ?? fallback.presentMeter,
        spoilagePercent: Number.isFinite(spoilagePercent) ? spoilagePercent : fallback.spoilagePercent,
        billingMode: doc?.billing_mode || fallback.billingMode,
        linesSignature: doc?.billing_lines_signature || fallback.linesSignature
    });
}

function billingSnapshotsEqual(left, right) {
    const a = billingSnapshotFromValues(left || {});
    const b = billingSnapshotFromValues(right || {});
    return a.invoiceNo === b.invoiceNo
        && a.previousMeter === b.previousMeter
        && a.presentMeter === b.presentMeter
        && Math.abs(a.spoilagePercent - b.spoilagePercent) < 0.001
        && a.billingMode === b.billingMode
        && a.linesSignature === b.linesSignature;
}

function toSqlDateTime(date = new Date()) {
    const valid = asValidDate(date);
    if (!valid) return '';
    const year = valid.getFullYear();
    const month = String(valid.getMonth() + 1).padStart(2, '0');
    const day = String(valid.getDate()).padStart(2, '0');
    const hours = String(valid.getHours()).padStart(2, '0');
    const minutes = String(valid.getMinutes()).padStart(2, '0');
    const seconds = String(valid.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function queryBillingDocsByContractMonth(contractmainId, monthKey) {
    const rawId = String(contractmainId || '').trim();
    if (!rawId) return [];

    const candidateValues = [];
    const numeric = Number(rawId);
    if (Number.isFinite(numeric)) candidateValues.push(Math.trunc(numeric));
    candidateValues.push(rawId);

    const byDocId = new Map();
    for (const value of candidateValues) {
        const docs = await queryFirestoreEquals('tbl_billing', 'contractmain_id', value);
        docs.forEach((doc) => {
            if (getBillingDocMonthKey(doc) !== monthKey) return;
            if (doc?._docId) byDocId.set(doc._docId, doc);
        });
    }
    return Array.from(byDocId.values());
}

async function queryBillingDocsByInvoice(invoiceNo) {
    const normalizedInvoice = normalizeInvoiceNumber(invoiceNo);
    if (!normalizedInvoice) return [];

    const queryPairs = [
        ['invoice_no', normalizedInvoice],
        ['invoiceno', normalizedInvoice],
        ['invoice_id', normalizedInvoice],
        ['invoiceid', normalizedInvoice]
    ];
    if (/^\d+$/.test(normalizedInvoice)) {
        const numericInvoice = Number(normalizedInvoice);
        queryPairs.push(['invoice_id', numericInvoice], ['invoiceid', numericInvoice]);
    }

    const byDocId = new Map();
    for (const [fieldPath, value] of queryPairs) {
        const docs = await queryFirestoreEquals('tbl_billing', fieldPath, value);
        docs.forEach((doc) => {
            if (doc?._docId) byDocId.set(doc._docId, doc);
        });
    }
    return Array.from(byDocId.values());
}

function slugFirestoreId(value) {
    return String(value || 'row')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 140) || 'row';
}

function getBillingRowExclusionKeys(row) {
    const keys = [];
    const contractId = String(row?.contractmain_id || '').trim();
    const companyId = String(row?.company_id || '').trim();
    const branchId = String(row?.branch_id || '').trim();
    const machineId = String(row?.machine_id || '').trim();
    const rowId = String(row?.row_id || '').trim();
    if (contractId) keys.push(`contract:${contractId}`);
    if (companyId && branchId && machineId) keys.push(`company_branch_machine:${companyId}:${branchId}:${machineId}`);
    if (companyId && branchId && contractId) keys.push(`company_branch_contract:${companyId}:${branchId}:${contractId}`);
    if (rowId) keys.push(`row:${rowId}`);
    return uniqueNonBlankValues(keys);
}

function getPrimaryBillingExclusionKey(row) {
    return getBillingRowExclusionKeys(row)[0] || `row:${String(row?.row_id || row?.company_id || Date.now()).trim()}`;
}

function getBillingExclusionDocId(row) {
    return `billing_exclusion_${slugFirestoreId(getPrimaryBillingExclusionKey(row))}`;
}

function isActiveBillingExclusion(exclusion) {
    return exclusion && exclusion.active !== false && exclusion.hide_from_billing_list !== false;
}

function isRowBillingExcluded(row, exclusions = billingExclusionCache) {
    const keys = new Set(getBillingRowExclusionKeys(row));
    if (!keys.size) return false;
    return (Array.isArray(exclusions) ? exclusions : []).some((exclusion) => (
        isActiveBillingExclusion(exclusion)
        && keys.has(String(exclusion.exclusion_key || '').trim())
    ));
}

function applyBillingExclusionsToPayload(payload, exclusions = billingExclusionCache) {
    const rows = payload?.month_matrix?.rows;
    if (!Array.isArray(rows) || !rows.length) return payload;
    const visibleRows = rows.filter((row) => !isRowBillingExcluded(row, exclusions));
    if (visibleRows.length === rows.length) return payload;
    const months = Array.isArray(payload.month_matrix.months) ? payload.month_matrix.months : [];
    const totals = Array.isArray(payload.month_matrix.totals) ? payload.month_matrix.totals : [];
    const visibleTotals = totals.map((total) => {
        const monthKey = total.month_key;
        if (!months.includes(monthKey)) return total;
        return {
            ...total,
            amount_total: Number(visibleRows.reduce((sum, row) => sum + Number(row.months?.[monthKey]?.amount_total || 0), 0).toFixed(2)),
            display_amount_total: Number(visibleRows.reduce((sum, row) => sum + Number(row.months?.[monthKey]?.display_amount_total || 0), 0).toFixed(2))
        };
    });
    return {
        ...payload,
        billing_exclusions: {
            active_count: (Array.isArray(exclusions) ? exclusions : []).filter(isActiveBillingExclusion).length,
            hidden_loaded_rows: rows.length - visibleRows.length
        },
        month_matrix: {
            ...payload.month_matrix,
            rows: visibleRows,
            totals: visibleTotals
        }
    };
}

async function loadBillingExclusions() {
    const docs = await queryFirestoreEquals(BILLING_EXCLUSIONS_COLLECTION, 'active', true).catch((error) => {
        console.warn('Unable to load billing exclusions.', error);
        return [];
    });
    return docs.filter((doc) => doc && doc.hide_from_billing_list !== false);
}

function mergeBillingExclusionCache(doc) {
    if (!doc?._docId) return;
    billingExclusionCache = [
        doc,
        ...billingExclusionCache.filter((entry) => entry?._docId !== doc._docId)
    ];
}

function removeBillingExclusionFromCache(docId) {
    billingExclusionCache = billingExclusionCache.filter((entry) => entry?._docId !== docId);
}

function buildBillingExclusionFields(row, form = {}) {
    const now = new Date();
    const reason = BILLING_EXCLUSION_REASONS.includes(form.reason) ? form.reason : 'Other';
    const docId = getBillingExclusionDocId(row);
    const exclusionKey = getPrimaryBillingExclusionKey(row);
    return {
        id: docId,
        exclusion_key: exclusionKey,
        active: true,
        hide_from_billing_list: form.hideFromFuture !== false,
        reason,
        effective_date: form.effectiveDate || formatIsoDate(now),
        staff_note: String(form.staffNote || '').trim(),
        row_id: String(row?.row_id || '').trim(),
        company_id: String(row?.company_id || '').trim(),
        company_name: String(row?.company_name || row?.account_name || '').trim(),
        branch_id: String(row?.branch_id || '').trim(),
        branch_name: String(row?.branch_name || '').trim(),
        account_name: String(row?.account_name || '').trim(),
        machine_id: String(row?.machine_id || '').trim(),
        machine_label: String(row?.machine_label || '').trim(),
        serial_number: String(row?.serial_number || '').trim(),
        contractmain_id: String(row?.contractmain_id || '').trim(),
        category_code: String(getRowBillingProfile(row)?.category_code || '').trim(),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        source_module: 'billing_dashboard'
    };
}

async function saveBillingExclusion(row, form = {}) {
    const docId = getBillingExclusionDocId(row);
    const fields = buildBillingExclusionFields(row, form);
    const result = await setFirestoreDocument(BILLING_EXCLUSIONS_COLLECTION, docId, fields, {
        mode: 'set',
        label: `Billing exclusion ${fields.branch_name || fields.contractmain_id || docId}`,
        dedupeKey: `${BILLING_EXCLUSIONS_COLLECTION}:${docId}`
    });
    mergeBillingExclusionCache({ _docId: docId, ...fields });
    return { ...result, docId, fields };
}

async function restoreBillingExclusion(docId) {
    const now = new Date();
    const existing = billingExclusionCache.find((entry) => entry?._docId === docId) || {};
    const fields = {
        ...Object.fromEntries(Object.entries(existing).filter(([key]) => key !== '_docId')),
        active: false,
        hide_from_billing_list: false,
        restored_at: now.toISOString(),
        updated_at: now.toISOString()
    };
    const result = await setFirestoreDocument(BILLING_EXCLUSIONS_COLLECTION, docId, fields, {
        mode: 'set',
        label: `Restore billing exclusion ${docId}`,
        dedupeKey: `${BILLING_EXCLUSIONS_COLLECTION}:${docId}:restore`
    });
    removeBillingExclusionFromCache(docId);
    return { ...result, docId, fields };
}

function buildBillingRecordFields({ row, context, estimate, snapshot, docId }) {
    const period = buildBillingPeriod(context?.monthKey, row?.reading_day);
    const parsedMonth = parseMonthInput(context?.monthKey);
    const now = new Date();
    const sqlNow = toSqlDateTime(now);
    const dueDate = period.to ? `${period.to} 00:00:00` : sqlNow;
    const numericInvoice = /^\d+$/.test(snapshot.invoiceNo) ? Number(snapshot.invoiceNo) : null;
    const numericContractId = Number(row?.contractmain_id || 0);
    const numericDocId = Number(docId);
    const lineItems = Array.isArray(estimate?.lineItems) ? estimate.lineItems : [];
    const primaryLine = lineItems[0] || estimate || {};
    const secondaryLine = lineItems.find((line) => String(line?.label || '').toLowerCase().includes('color'))
        || (String(snapshot?.billingMode || '').trim() === 'multi_meter_rtp' ? lineItems[1] : null)
        || {};
    const linesSignature = buildBillingLinesSignature(lineItems);

    return {
        id: Number.isFinite(numericDocId) ? numericDocId : Date.now(),
        invoice_id: numericInvoice ?? snapshot.invoiceNo,
        invoiceid: numericInvoice ?? snapshot.invoiceNo,
        invoice_no: snapshot.invoiceNo,
        invoiceno: snapshot.invoiceNo,
        contractmain_id: Number.isFinite(numericContractId) && numericContractId > 0 ? numericContractId : String(row?.contractmain_id || ''),
        month: formatMonthLongLabel(context?.monthKey, context?.monthKey || ''),
        year: String(parsedMonth?.year || now.getFullYear()),
        due_date: dueDate,
        dateprinted: sqlNow,
        date_printed: sqlNow,
        invoice_date: sqlNow,
        invdate: sqlNow,
        datex: sqlNow,
        amount: Number(estimate?.amountDue || 0) || 0,
        totalamount: Number(estimate?.amountDue || 0) || 0,
        vatamount: Number(estimate?.vatAmount || 0) || 0,
        netamount: Number(estimate?.netAmount || 0) || 0,
        field_previous_meter: Number(primaryLine.previousMeter ?? snapshot.previousMeter ?? 0) || 0,
        field_present_meter: Number(primaryLine.presentMeter ?? snapshot.presentMeter ?? 0) || 0,
        field_previous_meter2: Number(secondaryLine.previousMeter || 0) || 0,
        field_present_meter2: Number(secondaryLine.presentMeter || 0) || 0,
        present_meter2: Number(secondaryLine.presentMeter || 0) || 0,
        field_total_consumed: Number(estimate?.rawPages || 0) || 0,
        total_pages: Number(estimate?.netPages || 0) || 0,
        spoilage_pages: Number(estimate?.spoilagePages || 0) || 0,
        spoilage_percent: Number(snapshot.spoilagePercent || 0) || 0,
        spoilage_rate: Number((Number(snapshot.spoilagePercent || 0) / 100).toFixed(4)),
        billed_pages: Number(estimate?.billedPages || 0) || 0,
        quota_variance: Number(estimate?.quotaVariance || 0) || 0,
        page_rate: Number(context?.profile?.page_rate || 0) || 0,
        succeeding_page_rate: Number(estimate?.succeedingRate || getSucceedingPageRate(context?.profile) || 0) || 0,
        monthly_quota: Number(context?.profile?.monthly_quota || 0) || 0,
        monthly_rate: Number(context?.profile?.monthly_rate || 0) || 0,
        quota_pages: Number(estimate?.quotaPages || 0) || 0,
        succeeding_pages: Number(estimate?.succeedingPages || 0) || 0,
        quota_amount: Number(estimate?.quotaAmount || 0) || 0,
        succeeding_amount: Number(estimate?.succeedingAmount || 0) || 0,
        billing_formula: String(estimate?.formula || '').trim(),
        withvat: context?.profile?.with_vat ? 1 : 0,
        category_id: Number(context?.profile?.category_id || 0) || 0,
        category_code: String(context?.profile?.category_code || '').trim(),
        branch_id: String(row?.branch_id || '').trim(),
        branch_name: String(row?.branch_name || '').trim(),
        company_id: String(row?.company_id || '').trim(),
        company_name: String(row?.company_name || row?.account_name || '').trim(),
        account_name: String(row?.account_name || row?.display_name || row?.company_name || '').trim(),
        display_name: String(row?.display_name || row?.account_name || row?.company_name || '').trim(),
        machine_id: String(row?.machine_id || '').trim(),
        machine_label: String(row?.machine_label || '').trim(),
        machine_model: String(row?.machine_label || '').trim(),
        printer_model: String(row?.machine_label || '').trim(),
        serial_number: String(row?.serial_number || '').trim(),
        billing_mode: String(snapshot.billingMode || 'single_meter_rtp').trim() || 'single_meter_rtp',
        billing_lines_json: JSON.stringify(lineItems),
        billing_lines_count: lineItems.length,
        billing_lines_signature: linesSignature,
        billing_total_pages: Number(estimate?.billedPages || estimate?.pages || 0) || 0,
        updated_at: now.toISOString(),
        source_module: 'billing_dashboard',
        status: 0,
        isreceived: 0,
        location: 1
    };
}

function isMultiMachineBilling(snapshot, estimate) {
    return String(snapshot?.billingMode || '').trim() === 'multi_machine_rtp'
        && Array.isArray(estimate?.lineItems)
        && estimate.lineItems.length > 1;
}

function getLineRowForBilling(line, fallbackRow) {
    const lineRowId = String(line?.rowId || '').trim();
    if (lineRowId && lastPayload?.month_matrix?.rows) {
        const found = lastPayload.month_matrix.rows.find((entry) => String(entry.row_id || entry.company_id || '').trim() === lineRowId);
        if (found) return found;
    }
    return fallbackRow;
}

async function saveMultiMachineBillingRecords({ row, context, estimate, snapshot }) {
    const invoiceNo = normalizeInvoiceNumber(snapshot?.invoiceNo);
    if (!invoiceNo) throw new Error('Enter an invoice number before saving.');

    const lines = (Array.isArray(estimate?.lineItems) ? estimate.lineItems : [])
        .map((line) => ({
            ...line,
            row: getLineRowForBilling(line, row)
        }))
        .filter((line) => line?.row?.contractmain_id && !line.missingMeterSource && !isNonBillableMeterFormula(line.formula));
    if (!lines.length) throw new Error('No machine contract lines are available to save for this grouped invoice.');

    const targetDocsByContract = new Map();
    for (const line of lines) {
        const docs = await queryBillingDocsByContractMonth(line.row.contractmain_id, context.monthKey);
        const targetDoc = pickPrimaryBillingDoc(docs);
        targetDocsByContract.set(String(line.row.contractmain_id), targetDoc || null);
    }

    const duplicateDocs = await queryBillingDocsByInvoice(invoiceNo);
    const allowedContractIds = new Set(lines.map((line) => String(line.row.contractmain_id)));
    const allowedDocIds = new Set(Array.from(targetDocsByContract.values()).map((doc) => doc?._docId).filter(Boolean));
    const conflictingDoc = duplicateDocs.find((doc) => {
        const docContractId = String(doc?.contractmain_id || '').trim();
        if (doc?._docId && allowedDocIds.has(doc._docId)) return false;
        return !allowedContractIds.has(docContractId);
    });
    if (conflictingDoc) {
        const duplicateMonth = getBillingDocMonthKey(conflictingDoc);
        throw new Error(`Invoice ${invoiceNo} is already used${duplicateMonth ? ` for ${formatMonthLabel(duplicateMonth, duplicateMonth)}` : ''}.`);
    }

    const savedDocs = [];
    for (const [index, line] of lines.entries()) {
        const targetDoc = targetDocsByContract.get(String(line.row.contractmain_id));
        const docId = String(targetDoc?._docId || `${Date.now()}-${index}`);
        const { row: lineRow, ...lineFields } = line;
        const lineEstimate = {
            ...lineFields,
            lineItems: [lineFields],
            amountDue: Number(lineFields.amountDue || 0) || 0,
            netAmount: Number(lineFields.netAmount || 0) || 0,
            vatAmount: Number(lineFields.vatAmount || 0) || 0
        };
        const fields = buildBillingRecordFields({
            row: lineRow,
            context: {
                ...context,
                profile: getRowBillingProfile(lineRow) || context.profile
            },
            estimate: lineEstimate,
            snapshot,
            docId
        });
        fields.billing_group_invoice_total = Number(estimate.amountDue || 0) || 0;
        fields.billing_group_line_index = index + 1;
        fields.billing_group_line_count = lines.length;
        const result = await setFirestoreDocument('tbl_billing', docId, fields, {
            mode: 'set',
            label: `Billing ${invoiceNo} line ${index + 1}`,
            dedupeKey: `tbl_billing:${docId}`
        });
        savedDocs.push({
            ...result,
            docId,
            invoiceNo,
            fields
        });
    }

    return {
        ok: savedDocs.every((entry) => entry.ok !== false),
        queued: savedDocs.some((entry) => entry.queued),
        docId: savedDocs[0]?.docId || '',
        invoiceNo,
        fields: savedDocs[0]?.fields || {},
        savedCount: savedDocs.length,
        docs: savedDocs
    };
}

async function saveBillingRecord({ row, context, estimate, snapshot, existingDocs = [] }) {
    const invoiceNo = normalizeInvoiceNumber(snapshot?.invoiceNo);
    if (!invoiceNo) throw new Error('Enter an invoice number before saving.');
    if (isMultiMachineBilling(snapshot, estimate)) {
        return saveMultiMachineBillingRecords({ row, context, estimate, snapshot });
    }
    if (!row?.contractmain_id) throw new Error('This row has no contract ID, so billing cannot be saved yet.');

    const rowDocs = existingDocs.length ? existingDocs : await queryBillingDocsByContractMonth(row.contractmain_id, context.monthKey);
    const targetDoc = pickPrimaryBillingDoc(rowDocs);
    const duplicateDocs = await queryBillingDocsByInvoice(invoiceNo);
    const conflictingDoc = duplicateDocs.find((doc) => doc?._docId && doc._docId !== targetDoc?._docId);
    if (conflictingDoc) {
        const duplicateMonth = getBillingDocMonthKey(conflictingDoc);
        throw new Error(`Invoice ${invoiceNo} is already used${duplicateMonth ? ` for ${formatMonthLabel(duplicateMonth, duplicateMonth)}` : ''}.`);
    }

    const docId = String(targetDoc?._docId || Date.now());
    const fields = buildBillingRecordFields({ row, context, estimate, snapshot, docId });
    const result = await setFirestoreDocument('tbl_billing', docId, fields, {
        mode: 'set',
        label: `Billing ${invoiceNo}`,
        dedupeKey: `tbl_billing:${docId}`
    });
    return {
        ...result,
        docId,
        invoiceNo,
        fields
    };
}

async function deleteBillingRecord({ row, monthKey, invoiceNo = '' }) {
    const normalizedInvoice = normalizeInvoiceNumber(invoiceNo);
    if (normalizedInvoice) {
        return deleteBillingDocsForReplacement({ invoiceNo: normalizedInvoice, monthKey });
    }
    if (!row?.contractmain_id) throw new Error('This row has no contract ID to delete.');
    const matchingDocs = await queryBillingDocsByContractMonth(row.contractmain_id, monthKey);
    if (!matchingDocs.length) return { deletedCount: 0 };

    for (const doc of matchingDocs) {
        if (!doc?._docId) continue;
        await deleteFirestoreDocument('tbl_billing', doc._docId);
    }

    return { deletedCount: matchingDocs.length };
}

async function deleteBillingDocsForReplacement({ invoiceNo = '', docId = '', monthKey = '' } = {}) {
    const normalizedInvoice = normalizeInvoiceNumber(invoiceNo);
    let matchingDocs = [];
    if (normalizedInvoice) {
        const docs = await queryBillingDocsByInvoice(normalizedInvoice);
        const monthDocs = monthKey
            ? docs.filter((doc) => getBillingDocMonthKey(doc) === monthKey)
            : docs;
        matchingDocs = monthDocs.length ? monthDocs : docs;
    }
    if (!matchingDocs.length && docId) {
        matchingDocs = [{ _docId: docId }];
    }
    if (!matchingDocs.length) return { deletedCount: 0 };

    const uniqueDocIds = Array.from(new Set(matchingDocs.map((doc) => doc?._docId).filter(Boolean)));
    for (const id of uniqueDocIds) {
        await deleteFirestoreDocument('tbl_billing', id);
    }

    return { deletedCount: uniqueDocIds.length };
}

function getInvoiceSearchRows() {
    const rows = [
        ...(Array.isArray(renderedMatrixRows) ? renderedMatrixRows : []),
        ...(Array.isArray(lastPayload?.month_matrix?.rows) ? lastPayload.month_matrix.rows : [])
    ];
    const byKey = new Map();
    rows.forEach((row) => {
        if (!row || row.is_summary_row) return;
        const key = String(row.row_id || row.contractmain_id || row.machine_id || row.company_id || '').trim();
        if (!key || byKey.has(key)) return;
        byKey.set(key, row);
    });
    return Array.from(byKey.values());
}

function findInvoiceSearchRow(doc) {
    const rows = getInvoiceSearchRows();
    const contractId = String(doc?.contractmain_id || '').trim();
    const machineId = String(doc?.machine_id || '').trim();
    const companyId = String(doc?.company_id || '').trim();
    const branchId = String(doc?.branch_id || '').trim();

    return rows.find((row) => contractId && String(row.contractmain_id || '').trim() === contractId)
        || rows.find((row) => (
            companyId
            && branchId
            && machineId
            && String(row.company_id || '').trim() === companyId
            && String(row.branch_id || '').trim() === branchId
            && String(row.machine_id || '').trim() === machineId
        ))
        || rows.find((row) => (
            companyId
            && branchId
            && String(row.company_id || '').trim() === companyId
            && String(row.branch_id || '').trim() === branchId
        ))
        || null;
}

function getBillingDocCategoryCode(doc) {
    const rawCode = String(doc?.category_code || '').trim().toUpperCase();
    if (rawCode) return rawCode;
    return CONTRACT_CATEGORY_META[Number(doc?.category_id || 0)]?.code || '';
}

function getBillingDocAmount(doc) {
    return Number(doc?.totalamount ?? doc?.amount ?? 0) || 0;
}

function parseBillingDocLineItems(doc) {
    const raw = doc?.billing_lines_json;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
        const parsed = JSON.parse(String(raw));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function getBillingDocMeterMovement(doc) {
    const previous = Number(doc?.field_previous_meter || 0) || 0;
    const present = Number(doc?.field_present_meter || 0) || 0;
    const previous2 = Number(doc?.field_previous_meter2 || 0) || 0;
    const present2 = Number(doc?.field_present_meter2 || 0) || 0;
    let rawPages = Math.max(
        0,
        Number(doc?.field_total_consumed || 0) || 0,
        Number(doc?.total_pages || 0) || 0,
        Number(doc?.billing_total_pages || 0) || 0
    );
    let delta = Math.max(0, present - previous, present2 - previous2);
    parseBillingDocLineItems(doc).forEach((line) => {
        const linePrevious = Number(line?.previousMeter || 0) || 0;
        const linePresent = Number(line?.presentMeter || 0) || 0;
        rawPages = Math.max(rawPages, Number(line?.rawPages || line?.netPages || 0) || 0);
        delta = Math.max(delta, linePresent - linePrevious);
    });
    return { delta: Math.max(0, delta), rawPages: Math.max(0, rawPages) };
}

function shouldCountInvoiceSearchDoc(doc, groupDocs = []) {
    const mode = String(doc?.billing_mode || '').trim();
    const groupNeedsMeterFilter = groupDocs.length > 1 || mode === 'multi_machine_rtp';
    if (!groupNeedsMeterFilter) return true;

    const formula = String(doc?.billing_formula || '').trim();
    if (isNonBillableMeterFormula(formula)) return false;

    const categoryCode = getBillingDocCategoryCode(doc);
    if (categoryCode === 'RTF') return true;

    const movement = getBillingDocMeterMovement(doc);
    return movement.delta > 0;
}

function uniqueBillingValues(values = []) {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function buildInvoiceSearchGroups(docs = [], invoiceNo = '') {
    const groupsByKey = new Map();
    docs.forEach((doc) => {
        const invoiceRef = getBillingDocInvoiceRef(doc) || invoiceNo || 'Invoice';
        const monthKey = getBillingDocMonthKey(doc) || 'unknown';
        const key = `${invoiceRef}::${monthKey}`;
        if (!groupsByKey.has(key)) {
            groupsByKey.set(key, {
                key,
                invoiceRef,
                monthKey,
                docs: []
            });
        }
        groupsByKey.get(key).docs.push(doc);
    });

    return Array.from(groupsByKey.values()).map((group) => {
        const docsWithRows = group.docs.map((doc) => ({
            doc,
            row: findInvoiceSearchRow(doc)
        }));
        const billableDocs = docsWithRows.filter(({ doc }) => shouldCountInvoiceSearchDoc(doc, group.docs));
        const suppressedDocs = docsWithRows.filter(({ doc }) => !shouldCountInvoiceSearchDoc(doc, group.docs));
        const displayDocs = billableDocs.length ? billableDocs : [];
        const companyLabels = uniqueBillingValues(docsWithRows.map(({ row, doc }) => (
            row?.company_name
            || row?.account_name
            || row?.display_name
            || doc?.company_name
            || (doc?.company_id ? `Company ${doc.company_id}` : '')
        )));
        const branchLabels = uniqueBillingValues(displayDocs.map(({ row, doc }) => (
            row?.branch_name
            || doc?.branch_name
            || ''
        )));
        const categoryCodes = uniqueBillingValues(docsWithRows.map(({ doc }) => getBillingDocCategoryCode(doc) || doc?.category_id || 'N/A'));
        const contractIds = uniqueBillingValues(displayDocs.map(({ doc }) => doc?.contractmain_id));
        const machineIds = uniqueBillingValues(displayDocs.map(({ doc }) => doc?.machine_id));
        const amountTotal = displayDocs.reduce((sum, { doc }) => sum + getBillingDocAmount(doc), 0);
        const savedAmountTotal = docsWithRows.reduce((sum, { doc }) => sum + getBillingDocAmount(doc), 0);
        const rawPages = displayDocs.reduce((sum, { doc }) => sum + getBillingDocMeterMovement(doc).rawPages, 0);
        const primaryRow = displayDocs[0]?.row || docsWithRows[0]?.row || null;
        return {
            ...group,
            docsWithRows,
            billableDocs,
            suppressedDocs,
            displayDocs,
            companyLabels,
            branchLabels,
            categoryCodes,
            contractIds,
            machineIds,
            amountTotal,
            savedAmountTotal,
            rawPages,
            primaryRow
        };
    }).sort((left, right) => String(right.monthKey || '').localeCompare(String(left.monthKey || '')));
}

function renderInvoiceSearchResults(docs = [], invoiceNo = '') {
    if (!els.invoiceSearchResults) return;
    if (!invoiceNo) {
        els.invoiceSearchResults.innerHTML = 'Search an invoice number to trace or delete a billing transaction.';
        invoiceSearchGroupCache = new Map();
        return;
    }
    if (!docs.length) {
        els.invoiceSearchResults.innerHTML = `<div class="invoice-search-empty">No Firebase billing transaction found for invoice ${escapeHtml(invoiceNo)}.</div>`;
        invoiceSearchGroupCache = new Map();
        return;
    }

    const groups = buildInvoiceSearchGroups(docs, invoiceNo);
    invoiceSearchGroupCache = new Map(groups.map((group) => [group.key, group]));
    const rawRecordText = groups.length === docs.length
        ? `${formatCount(docs.length)} saved record${docs.length === 1 ? '' : 's'}`
        : `${formatCount(groups.length)} invoice group${groups.length === 1 ? '' : 's'} from ${formatCount(docs.length)} saved branch record${docs.length === 1 ? '' : 's'}`;
    els.invoiceSearchResults.innerHTML = `
        <div class="invoice-search-count">${escapeHtml(rawRecordText)} found for invoice ${escapeHtml(invoiceNo)}.</div>
        <div class="invoice-search-list">
            ${groups.map((group) => {
                const customerLabel = group.companyLabels[0] || 'Unknown customer';
                const branchLabel = group.branchLabels.length === 1
                    ? group.branchLabels[0]
                    : `${formatCount(group.displayDocs.length)} computed branch line${group.displayDocs.length === 1 ? '' : 's'}`;
                const ignoredText = group.suppressedDocs.length
                    ? `<div class="invoice-search-warning">${escapeHtml(formatCount(group.suppressedDocs.length))} saved zero-meter/pending branch row${group.suppressedDocs.length === 1 ? '' : 's'} ignored from this invoice total.</div>`
                    : '';
                return `
                    <article class="invoice-search-card">
                        <div class="invoice-search-main">
                            <div class="invoice-search-ref">Invoice ${escapeHtml(group.invoiceRef || invoiceNo)}</div>
                            <div class="invoice-search-customer">${escapeHtml(customerLabel)}${branchLabel ? ` • ${escapeHtml(branchLabel)}` : ''}</div>
                            <div class="invoice-search-meta">
                                <span>${escapeHtml(formatMonthLabel(group.monthKey, group.monthKey || 'No month'))}</span>
                                <span>${escapeHtml(group.categoryCodes.join(' / ') || 'N/A')}</span>
                                <span>${escapeHtml(formatCount(group.displayDocs.length))} computed line${group.displayDocs.length === 1 ? '' : 's'}</span>
                                <span>${escapeHtml(formatCount(group.docs.length))} saved row${group.docs.length === 1 ? '' : 's'}</span>
                                <span>${escapeHtml(formatCount(group.machineIds.length))} machine${group.machineIds.length === 1 ? '' : 's'}</span>
                            </div>
                            ${ignoredText}
                        </div>
                        <div class="invoice-search-amount">
                            <div>${escapeHtml(formatAmount(group.amountTotal || 0))}</div>
                            ${group.suppressedDocs.length ? `<span>Saved rows total ${escapeHtml(formatAmount(group.savedAmountTotal || 0))}</span>` : ''}
                        </div>
                        <div class="invoice-search-actions">
                            <button class="btn btn-secondary" type="button" data-invoice-search-action="open" data-group-key="${escapeHtml(group.key)}">Open / Reprint</button>
                            <button class="btn btn-danger" type="button" data-invoice-search-action="delete" data-invoice-no="${escapeHtml(group.invoiceRef || invoiceNo)}" data-month-key="${escapeHtml(group.monthKey)}">Cancel / Replace</button>
                        </div>
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

async function searchInvoiceNumber() {
    const invoiceNo = normalizeInvoiceNumber(els.invoiceSearchInput?.value || '');
    if (!invoiceNo) {
        renderInvoiceSearchResults([], '');
        MargaUtils.showToast('Enter an invoice number to search.', 'error');
        return;
    }
    if (els.invoiceSearchBtn) els.invoiceSearchBtn.disabled = true;
    if (els.invoiceSearchResults) {
        els.invoiceSearchResults.innerHTML = `<div class="invoice-search-empty">Searching Firebase for invoice ${escapeHtml(invoiceNo)}...</div>`;
    }
    try {
        const docs = await queryBillingDocsByInvoice(invoiceNo);
        renderInvoiceSearchResults(docs, invoiceNo);
    } catch (error) {
        console.error('Unable to search invoice number.', error);
        if (els.invoiceSearchResults) {
            els.invoiceSearchResults.innerHTML = `<div class="invoice-search-empty error">Unable to search invoice ${escapeHtml(invoiceNo)}. ${escapeHtml(error.message || '')}</div>`;
        }
    } finally {
        if (els.invoiceSearchBtn) els.invoiceSearchBtn.disabled = false;
    }
}

function getInvoiceSearchEntryLabel(entry) {
    const row = entry?.row || {};
    const doc = entry?.doc || {};
    return row.branch_name
        || row.display_name
        || row.account_name
        || row.company_name
        || doc.branch_name
        || doc.serial_number
        || doc.machine_id
        || doc.contractmain_id
        || 'Billing line';
}

function cleanMachineIdentityValue(value, options = {}) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (options.skipNoMachine && /^no machine$/i.test(raw)) return '';
    if (options.skipNA && (/^n\/?a(?:\b|$)/i.test(raw) || /^not available$/i.test(raw))) return '';
    return raw;
}

function resolveBillingMachineIdentity({ row = {}, doc = {}, machine = null, model = null } = {}) {
    const modelName = [
        row.machine_label,
        doc.machine_label,
        doc.machine_model,
        doc.model_name,
        doc.model,
        doc.printer_model,
        machine?.description,
        model?.modelname,
        model?.description
    ].map((value) => cleanMachineIdentityValue(value, { skipNoMachine: true }))
        .find(Boolean) || '';

    const serialNumber = [
        row.serial_number,
        doc.serial_number,
        machine?.serial
    ].map((value) => cleanMachineIdentityValue(value, { skipNA: true }))
        .find(Boolean) || '';

    return {
        modelName,
        serialNumber
    };
}

function getInvoiceSearchEntryModel(entry, references = null) {
    const row = entry?.row || {};
    const doc = entry?.doc || {};
    const machineId = String(doc.machine_id || row.machine_id || '').trim();
    const hasTrustedIdentity = Boolean(entry?.row)
        || Boolean(doc.machine_label || doc.machine_model || doc.model_name || doc.model || doc.printer_model || doc.serial_number);
    const machine = hasTrustedIdentity && machineId && references?.machines ? references.machines.get(machineId) : null;
    const model = machine?.model_id && references?.models ? references.models.get(String(machine.model_id).trim()) : null;
    return resolveBillingMachineIdentity({ row, doc, machine, model }).modelName || 'N/A';
}

function getInvoiceSearchCustomerLabel(group) {
    const label = group?.companyLabels?.[0]
        || group?.displayDocs?.[0]?.row?.company_name
        || group?.displayDocs?.[0]?.row?.account_name
        || group?.displayDocs?.[0]?.doc?.company_name
        || 'Customer';
    return String(label || 'Customer').split(' / ')[0].trim() || 'Customer';
}

function buildInvoiceSearchGroupBreakdownPrintDocument(group, references = null) {
    const lines = group?.displayDocs || [];
    const rows = lines.map((entry) => {
        const doc = entry.doc || {};
        const previous = Number(doc.field_previous_meter || 0) || 0;
        const present = Number(doc.field_present_meter || 0) || 0;
        const difference = Math.max(0, present - previous);
        const savedSpoilage = Number(doc.spoilage_pages || 0) || 0;
        const spoilageRate = Number(doc.spoilage_rate || 0) || (Number(doc.spoilage_percent || 0) || 0) / 100;
        const spoilage = savedSpoilage || (spoilageRate > 0 ? Math.round(difference * spoilageRate) : 0);
        const netPages = Number(doc.total_pages || 0) || Math.max(0, difference - spoilage);
        return `
            <tr>
                <td>${escapeHtml(getInvoiceSearchEntryLabel(entry))}</td>
                <td>${escapeHtml(getInvoiceSearchEntryModel(entry, references))}</td>
                <td class="num">${escapeHtml(formatCount(present))}</td>
                <td class="num">${escapeHtml(formatCount(previous))}</td>
                <td class="num">${escapeHtml(formatCount(difference))}</td>
                <td class="num">${escapeHtml(formatCount(spoilage))}</td>
                <td class="num">${escapeHtml(formatCount(netPages))}</td>
                <td class="num">${escapeHtml(formatAmount(doc.page_rate || 0))}</td>
                <td class="num">${escapeHtml(formatFixedAmount(getBillingDocAmount(doc)))}</td>
            </tr>
        `;
    }).join('');
    const customerLabel = getInvoiceSearchCustomerLabel(group);

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Invoice ${escapeHtml(group?.invoiceRef || '')} Breakdown</title>
    <style>
        @page { size: A4 portrait; margin: 10mm; }
        body { font-family: Arial, sans-serif; color: #111827; font-size: 11px; }
        h1 { margin: 0 0 4px; font-size: 18px; }
        .head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111827; padding-bottom: 8px; margin-bottom: 10px; }
        .muted { color: #4b5563; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #9ca3af; padding: 4px 5px; vertical-align: top; }
        th { background: #eef2f7; text-align: left; font-size: 10px; text-transform: uppercase; }
        .num { text-align: right; white-space: nowrap; }
        .total { margin-left: auto; margin-top: 10px; width: 260px; }
        .note { margin-top: 10px; color: #4b5563; font-size: 10px; }
    </style>
</head>
<body>
    <div class="head">
        <div>
            <h1>Billing Breakdown Attachment</h1>
            <div class="muted">Invoice ${escapeHtml(group?.invoiceRef || '')}</div>
            <div>${escapeHtml(customerLabel)}</div>
        </div>
        <div>
            <div><strong>Month:</strong> ${escapeHtml(formatMonthLabel(group?.monthKey, group?.monthKey || ''))}</div>
            <div><strong>Computed Lines:</strong> ${escapeHtml(formatCount(lines.length))}</div>
        </div>
    </div>
    <table>
        <thead>
            <tr>
                <th>Branch</th>
                <th>Model</th>
                <th class="num">Present</th>
                <th class="num">Previous</th>
                <th class="num">Difference</th>
                <th class="num">Spoilage</th>
                <th class="num">Net Page Consumed</th>
                <th class="num">Rate</th>
                <th class="num">Amount</th>
            </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="9">No computed branch lines available.</td></tr>'}</tbody>
    </table>
    <table class="total">
        <tr><td><strong>Invoice Total</strong></td><td class="num">${escapeHtml(formatFixedAmount(group?.amountTotal || 0))}</td></tr>
    </table>
</body>
</html>`;
}

async function printInvoiceSearchGroupBreakdown(groupKey) {
    const group = invoiceSearchGroupCache.get(groupKey);
    if (!group) {
        MargaUtils.showToast('Invoice group is no longer loaded. Search the invoice again.', 'error');
        return;
    }
    const references = await loadInvoicePreviewReferenceData().catch((error) => {
        console.warn('Unable to load model references for billing breakdown print.', error);
        return null;
    });
    printHtmlDocument(buildInvoiceSearchGroupBreakdownPrintDocument(group, references), 'marga_invoice_group_breakdown_print');
}

function openInvoiceSearchGroupDetail(groupKey) {
    const group = invoiceSearchGroupCache.get(groupKey);
    if (!group || !els.invoiceDetailModal) return;

    const lines = group.displayDocs || [];
    const ignored = group.suppressedDocs || [];
    els.invoiceDetailTitle.textContent = `Invoice ${group.invoiceRef || ''}`;
    els.invoiceDetailSubtitle.textContent = `${formatMonthLabel(group.monthKey, group.monthKey || 'No month')} • ${formatCount(lines.length)} computed branch line${lines.length === 1 ? '' : 's'} • ${formatAmount(group.amountTotal || 0)}`;
    setRtpPrintPayload(null);
    els.invoiceDetailContent.innerHTML = `
        <div class="detail-action-row">
            <button class="btn btn-secondary" type="button" id="invoiceSearchPrintBreakdownBtn">Print Breakdown</button>
            <button class="btn btn-danger" type="button" id="invoiceSearchCancelGroupBtn">Cancel / Replace Invoice</button>
        </div>
        <div class="detail-summary-grid">
            <article class="detail-summary-card">
                <span class="label">Invoice Total</span>
                <span class="value">${escapeHtml(formatAmount(group.amountTotal || 0))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Computed Branch Lines</span>
                <span class="value">${escapeHtml(formatCount(lines.length))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Saved Branch Records</span>
                <span class="value">${escapeHtml(formatCount(group.docs.length))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Ignored Zero-Meter Rows</span>
                <span class="value">${escapeHtml(formatCount(ignored.length))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Saved Rows Total</span>
                <span class="value">${escapeHtml(formatAmount(group.savedAmountTotal || 0))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Meter Pages</span>
                <span class="value">${escapeHtml(formatCount(group.rawPages || 0))}</span>
            </article>
        </div>
        ${ignored.length ? `<div class="detail-empty warning">This invoice number has ${escapeHtml(formatCount(ignored.length))} saved branch row${ignored.length === 1 ? '' : 's'} with no meter movement. They look like older auto-billed pending rows, so the invoice total above ignores them.</div>` : ''}
        <div class="detail-section-title">Computed Branch Lines</div>
        ${
            lines.length
                ? `
                    <div class="invoice-detail-list">
                        ${lines.map((entry) => {
                            const doc = entry.doc || {};
                            const movement = getBillingDocMeterMovement(doc);
                            return `
                                <article class="invoice-detail-card">
                                    <div class="invoice-detail-head">
                                        <div class="invoice-detail-ref">${escapeHtml(getInvoiceSearchEntryLabel(entry))}</div>
                                        <div class="invoice-detail-amount">${escapeHtml(formatAmount(getBillingDocAmount(doc)))}</div>
                                    </div>
                                    <div class="invoice-detail-meta">
                                        <span class="invoice-detail-chip">${escapeHtml(getBillingDocCategoryCode(doc) || 'N/A')}</span>
                                        <span class="invoice-detail-chip">Contract ${escapeHtml(doc.contractmain_id || 'N/A')}</span>
                                        <span class="invoice-detail-chip">Machine ${escapeHtml(doc.machine_id || doc.serial_number || 'N/A')}</span>
                                        <span class="invoice-detail-chip">${escapeHtml(formatCount(movement.rawPages || movement.delta || 0))} pg</span>
                                        <span class="invoice-detail-chip">Doc ${escapeHtml(doc._docId || 'N/A')}</span>
                                    </div>
                                    <div class="detail-list-block">
                                        <span class="detail-list-label">Meter</span>
                                        <div class="detail-list-value">${escapeHtml(`${formatCount(doc.field_previous_meter || 0)} previous -> ${formatCount(doc.field_present_meter || 0)} present`)}</div>
                                    </div>
                                </article>
                            `;
                        }).join('')}
                    </div>
                `
                : '<div class="detail-empty">No computed branch lines were found for this invoice. Cancel/replace this invoice and save the correct present readings again.</div>'
        }
        ${
            ignored.length
                ? `
                    <div class="detail-section-title">Ignored Saved Rows</div>
                    <div class="invoice-detail-list">
                        ${ignored.slice(0, 12).map((entry) => `
                            <article class="invoice-detail-card">
                                <div class="invoice-detail-head">
                                    <div class="invoice-detail-ref">${escapeHtml(getInvoiceSearchEntryLabel(entry))}</div>
                                    <div class="invoice-detail-amount">${escapeHtml(formatAmount(getBillingDocAmount(entry.doc)))}</div>
                                </div>
                                <div class="invoice-detail-meta">
                                    <span class="invoice-detail-chip">Contract ${escapeHtml(entry.doc?.contractmain_id || 'N/A')}</span>
                                    <span class="invoice-detail-chip">Doc ${escapeHtml(entry.doc?._docId || 'N/A')}</span>
                                </div>
                            </article>
                        `).join('')}
                    </div>
                `
                : ''
        }
    `;

    els.invoiceDetailModal.classList.remove('hidden');
    document.getElementById('invoiceSearchPrintBreakdownBtn')?.addEventListener('click', () => printInvoiceSearchGroupBreakdown(group.key));
    document.getElementById('invoiceSearchCancelGroupBtn')?.addEventListener('click', async () => {
        const confirmed = window.confirm(`Cancel invoice ${group.invoiceRef || 'for this billing month'} for replacement? This removes all saved branch rows for this invoice/month.`);
        if (!confirmed) return;
        const button = document.getElementById('invoiceSearchCancelGroupBtn');
        if (button) button.disabled = true;
        try {
            const result = await deleteBillingDocsForReplacement({
                invoiceNo: group.invoiceRef,
                monthKey: group.monthKey
            });
            showBillingSaveResult({
                type: 'success',
                title: 'Invoice Cancelled',
                message: `Invoice ${group.invoiceRef} removed ${formatCount(result.deletedCount || 0)} saved branch record${result.deletedCount === 1 ? '' : 's'} and can be replaced.`
            });
            closeInvoiceDetailModal();
            await searchInvoiceNumber();
            if (lastPayload) await loadDashboard({ forceRefresh: true });
        } catch (error) {
            if (button) button.disabled = false;
            MargaUtils.showToast(String(error?.message || 'Unable to cancel invoice.'), 'error');
        }
    });
}

function showBillingSaveResult({ type = 'info', title = '', message = '' } = {}) {
    document.getElementById('billingSaveResultOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'billingSaveResultOverlay';
    overlay.className = `billing-save-result-overlay ${type}`;
    overlay.innerHTML = `
        <section class="billing-save-result-card" role="dialog" aria-modal="true" aria-live="assertive" aria-label="${escapeHtml(title || 'Billing save result')}">
            <button class="billing-save-result-close" type="button" aria-label="Close save message">x</button>
            <div class="billing-save-result-kicker">${escapeHtml(type === 'success' ? 'Saved' : (type === 'error' ? 'Error' : 'Billing'))}</div>
            <div class="billing-save-result-title">${escapeHtml(title || 'Billing Update')}</div>
            <div class="billing-save-result-message">${escapeHtml(message || '')}</div>
        </section>
    `;

    const close = () => overlay.remove();
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    overlay.querySelector('.billing-save-result-close')?.addEventListener('click', close);
    document.body.appendChild(overlay);
}

function setRtpPrintPayload(payload) {
    currentRtpPrintPayload = payload || null;
    const printCode = String(payload?.contractCode || 'Invoice').trim().toUpperCase() || 'Invoice';
    els.rtpInvoicePrintBtn?.classList.toggle('hidden', !payload);
    els.billingCalcPrintBtn?.classList.toggle('hidden', !payload);
    if (els.rtpInvoicePrintBtn) els.rtpInvoicePrintBtn.textContent = `Print ${printCode}`;
    if (els.billingCalcPrintBtn) els.billingCalcPrintBtn.textContent = `Print ${printCode}`;
}

function isPrintableContractCode(code) {
    return ['RTP', 'RTF'].includes(String(code || '').trim().toUpperCase());
}

function getPrintableContractCode(row, cell) {
    const profileCode = String(getRowBillingProfile(row)?.category_code || '').trim().toUpperCase();
    if (isPrintableContractCode(profileCode)) return profileCode;
    const readingGroup = (Array.isArray(cell?.reading_groups) ? cell.reading_groups : []).find((group) => {
        return isPrintableContractCode(getContractCategoryMeta(group?.category_id)?.code);
    });
    return String(getContractCategoryMeta(readingGroup?.category_id)?.code || '').trim().toUpperCase();
}

function isPrintableBillingCell(row, cell) {
    return isPrintableContractCode(getPrintableContractCode(row, cell));
}

function isRtpBillingCell(row, cell) {
    return getPrintableContractCode(row, cell) === 'RTP';
}

function isNonBillableMeterFormula(formula) {
    return ['pending_present_meter', 'missing_prior_meter', 'present_lower_than_previous']
        .includes(String(formula || '').trim());
}

function getPrimaryRtpReadingGroup(row, cell) {
    const readingGroups = Array.isArray(cell?.reading_groups) ? cell.reading_groups : [];
    return readingGroups.find((group) => String(getContractCategoryMeta(group?.category_id)?.code || '').trim().toUpperCase() === 'RTP')
        || readingGroups[0]
        || null;
}

function mapRowsById(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const key = String(row?.id || row?._docId || '').trim();
        if (key) map.set(key, row);
    });
    return map;
}

async function loadInvoicePreviewReferenceData() {
    if (invoicePreviewReferenceData) return invoicePreviewReferenceData;
    if (invoicePreviewReferencePromise) return invoicePreviewReferencePromise;

    invoicePreviewReferencePromise = Promise.all([
        MargaUtils.fetchCollection('tbl_companylist'),
        MargaUtils.fetchCollection('tbl_branchinfo'),
        MargaUtils.fetchCollection('tbl_billinfo'),
        MargaUtils.fetchCollection('tbl_machine'),
        MargaUtils.fetchCollection('tbl_model')
    ]).then(([companies, branches, billInfoRows, machines, models]) => {
        invoicePreviewReferenceData = {
            companies: mapRowsById(companies),
            branches: mapRowsById(branches),
            billInfoByBranchId: (Array.isArray(billInfoRows) ? billInfoRows : []).reduce((map, row) => {
                const key = String(row?.branch_id || '').trim();
                if (!key) return map;
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(row);
                return map;
            }, new Map()),
            machines: mapRowsById(machines),
            models: mapRowsById(models)
        };
        return invoicePreviewReferenceData;
    }).finally(() => {
        invoicePreviewReferencePromise = null;
    });

    return invoicePreviewReferencePromise;
}

function computePreviewAmounts(totalAmount, source = {}) {
    const total = Number(totalAmount || 0) || 0;
    const vatAmount = Number(source?.vat_amount || 0) || 0;
    const withVat = Boolean(source?.with_vat);
    let vatableSales = total;
    let computedVat = 0;

    if (vatAmount > 0 && total >= vatAmount) {
        computedVat = vatAmount;
        vatableSales = Math.max(0, total - vatAmount);
    } else if (withVat && total > 0) {
        vatableSales = total / 1.12;
        computedVat = total - vatableSales;
    }

    return {
        total,
        vatableSales,
        vatAmount: computedVat,
        vatExempt: 0,
        zeroRated: 0,
        lessVat: 0,
        amountDue: total
    };
}

function computePreviewAmountsFromEstimate(estimate) {
    return {
        total: Number(estimate?.amountDue || 0) || 0,
        vatableSales: Number(estimate?.netAmount || 0) || 0,
        vatAmount: Number(estimate?.vatAmount || 0) || 0,
        vatExempt: 0,
        zeroRated: 0,
        lessVat: 0,
        amountDue: Number(estimate?.amountDue || 0) || 0
    };
}

function setCalcInlinePrintState(state = {}) {
    const button = document.getElementById('calcInlinePrintBtn');
    const hint = document.getElementById('calcInlinePrintHint');
    if (!button && !hint) return;

    const visible = state.visible !== false;
    if (button) {
        button.classList.toggle('hidden', !visible);
        button.disabled = Boolean(state.disabled);
    }
    if (hint) {
        hint.textContent = state.hint || '';
    }
}

async function buildRtpPreviewPayload(row, cell, monthKey) {
    const contractCode = getPrintableContractCode(row, cell);
    if (!isPrintableContractCode(contractCode)) return null;

    const references = await loadInvoicePreviewReferenceData();
    const company = references.companies.get(String(row?.company_id || '').trim()) || null;
    const branch = references.branches.get(String(row?.branch_id || '').trim()) || null;
    const billInfoRows = references.billInfoByBranchId.get(String(row?.branch_id || '').trim()) || [];
    const billInfo = billInfoRows[0] || null;
    const machine = references.machines.get(String(row?.machine_id || '').trim()) || null;
    const model = references.models.get(String(machine?.model_id || '').trim()) || null;
    const readingGroup = getPrimaryRtpReadingGroup(row, cell);
    const profile = getRowBillingProfile(row);
    const period = buildBillingPeriod(monthKey, row?.reading_day);
    const invoiceDate = asValidDate(cell?.latest_invoice_date) || period.endDate || new Date();
    const totals = computePreviewAmounts(
        cell?.display_amount_total || cell?.amount_total || cell?.reading_amount_total || 0,
        readingGroup || { with_vat: profile?.with_vat }
    );
    const { modelName, serialNumber } = resolveBillingMachineIdentity({ row, machine, model });
    const accountName = cleanPrintCustomerName(
        row?.display_name
        || row?.account_name
        || billInfo?.payeename
        || billInfo?.endusername
        || company?.companyname
        || row?.company_name
        || ''
    );
    const isGroupedPrint = Boolean(row?.is_summary_billing_row || row?.is_summary_row);
    const address = isGroupedPrint
        ? (getCompanyAddress(company) || 'N/A')
        : (getBillInfoAddress(billInfo) || buildBranchAddress(branch) || 'N/A');

    return {
        customerName: accountName || 'Unknown Customer',
        tin: String(company?.company_tin || '').trim() || 'N/A',
        address,
        invoiceDate: formatUsDate(invoiceDate),
        readingCode: row?.reading_day ? `RDG${row.reading_day}` : 'RDG',
        monthLabel: formatMonthLongLabel(monthKey, monthKey),
        contractCode,
        businessStyle: String(company?.business_style || '').trim() || 'N/A',
        printerModel: isGroupedPrint ? 'Multiple Machine' : (modelName ? `${modelName}${serialNumber ? ` --- ${serialNumber}` : ''}` : (serialNumber || 'N/A')),
        billingFrom: period.from || 'N/A',
        billingTo: period.to || 'N/A',
        totalPages: Number(readingGroup?.pages || cell?.reading_pages_total || 0) || 0,
        rate: contractCode === 'RTF'
            ? Number(profile?.monthly_rate || 0) || 0
            : Number(readingGroup?.page_rate || profile?.page_rate || 0) || 0,
        monthlyRate: Number(profile?.monthly_rate || 0) || 0,
        quota: Number(readingGroup?.monthly_quota || profile?.monthly_quota || 0) || 0,
        quotaPages: Number(readingGroup?.quota_pages || 0) || 0,
        succeedingPages: Number(readingGroup?.succeeding_pages || 0) || 0,
        succeedingRate: Number(readingGroup?.succeeding_page_rate || readingGroup?.page_rate_xtra || readingGroup?.page_rate2 || getSucceedingPageRate(profile) || 0) || 0,
        totals
    };
}

async function buildRtpPreviewPayloadFromCalculation(row, context, estimate) {
    const contractCode = String(context?.profile?.category_code || '').trim().toUpperCase();
    if (!isPrintableContractCode(contractCode)) return null;

    const references = await loadInvoicePreviewReferenceData();
    const company = references.companies.get(String(row?.company_id || '').trim()) || null;
    const branch = references.branches.get(String(row?.branch_id || '').trim()) || null;
    const billInfoRows = references.billInfoByBranchId.get(String(row?.branch_id || '').trim()) || [];
    const billInfo = billInfoRows[0] || null;
    const machine = references.machines.get(String(row?.machine_id || '').trim()) || null;
    const model = references.models.get(String(machine?.model_id || '').trim()) || null;
    const period = buildBillingPeriod(context?.monthKey, row?.reading_day);
    const invoiceDate = period.endDate || new Date();
    const { modelName, serialNumber } = resolveBillingMachineIdentity({ row, machine, model });
    const accountName = cleanPrintCustomerName(
        row?.display_name
        || row?.account_name
        || billInfo?.payeename
        || billInfo?.endusername
        || company?.companyname
        || row?.company_name
        || ''
    );
    const groupedRows = Array.isArray(context?.groupedMachineRows) ? context.groupedMachineRows : [];
    const isGroupedPrint = Boolean(row?.is_summary_billing_row || row?.is_summary_row || groupedRows.length > 1);
    const address = isGroupedPrint
        ? (getGroupedBillingAddress(references, groupedRows, company) || 'N/A')
        : (getBillInfoAddress(billInfo) || buildBranchAddress(branch) || 'N/A');

    return {
        customerName: accountName || 'Unknown Customer',
        tin: String(company?.company_tin || '').trim() || 'N/A',
        address,
        invoiceDate: formatUsDate(invoiceDate),
        readingCode: row?.reading_day ? `RDG${row.reading_day}` : 'RDG',
        monthLabel: formatMonthLongLabel(context?.monthKey, context?.monthLabel || ''),
        contractCode,
        businessStyle: String(company?.business_style || '').trim() || 'N/A',
        printerModel: isGroupedPrint ? 'Multiple Machine' : (modelName ? `${modelName}${serialNumber ? ` --- ${serialNumber}` : ''}` : (serialNumber || 'N/A')),
        billingFrom: period.from || 'N/A',
        billingTo: period.to || 'N/A',
        totalPages: contractCode === 'RTF' ? 0 : (Number(estimate?.netPages || 0) || 0),
        rate: contractCode === 'RTF'
            ? Number(context?.profile?.monthly_rate || 0) || 0
            : Number(context?.profile?.page_rate || 0) || 0,
        monthlyRate: Number(context?.profile?.monthly_rate || 0) || 0,
        quota: Number(context?.profile?.monthly_quota || 0) || 0,
        quotaPages: Number(estimate?.quotaPages || 0) || 0,
        succeedingPages: Number(estimate?.succeedingPages || 0) || 0,
        succeedingRate: Number(estimate?.succeedingRate || getSucceedingPageRate(context?.profile) || 0) || 0,
        totals: computePreviewAmountsFromEstimate(estimate)
    };
}

function buildRtpPreviewHtml(preview) {
    const contractCode = String(preview?.contractCode || 'RTP').trim().toUpperCase() || 'RTP';
    return `
        <section class="rtp-preview-shell" aria-label="${escapeHtml(contractCode)} print preview">
            <div class="rtp-preview-note">${escapeHtml(contractCode)}</div>
            <div class="rtp-preview-paper">
                <div class="rtp-print-sheet">
                    ${buildRtpSheetFieldsHtml(preview)}
                </div>
            </div>
        </section>
    `;
}

function buildRtpSheetFieldsHtml(preview) {
    const totals = preview?.totals || {};
    const contractCode = String(preview?.contractCode || 'RTP').trim().toUpperCase() || 'RTP';
    return `
        <div class="rtp-field rtp-customer-name">${escapeHtml(preview?.customerName || 'Unknown Customer')}</div>
        <div class="rtp-field rtp-customer-tin">${escapeHtml(preview?.tin || 'N/A')}</div>
        <div class="rtp-field rtp-customer-address">${escapeHtml(preview?.address || 'N/A')}</div>

        <div class="rtp-field rtp-meta-date">${escapeHtml(preview?.invoiceDate || '')}</div>
        <div class="rtp-field rtp-meta-code">${escapeHtml(preview?.readingCode || '')}</div>
        <div class="rtp-field rtp-meta-month">${escapeHtml(preview?.monthLabel || '')}</div>
        <div class="rtp-field rtp-meta-type">${escapeHtml(contractCode)}</div>

        <div class="rtp-field rtp-business-style">${escapeHtml(preview?.businessStyle || 'N/A')}</div>
        <div class="rtp-field rtp-printer-model">${escapeHtml(preview?.printerModel || 'N/A')}</div>
        <div class="rtp-field rtp-billing-from">${escapeHtml(preview?.billingFrom || 'N/A')}</div>
        <div class="rtp-field rtp-billing-to">${escapeHtml(preview?.billingTo || 'N/A')}</div>
        <div class="rtp-field rtp-total-pages">${contractCode === 'RTF' ? '' : escapeHtml(formatCount(preview?.totalPages || 0))}</div>
        <div class="rtp-field rtp-rate">${escapeHtml(formatFixedAmount(contractCode === 'RTF' ? (preview?.monthlyRate || preview?.rate || 0) : (preview?.rate || 0)))}</div>

        <div class="rtp-field rtp-amount rtp-amount-total">${escapeHtml(formatFixedAmount(totals.total || 0))}</div>
        <div class="rtp-field rtp-amount rtp-amount-vat">${escapeHtml(formatFixedAmount(totals.vatAmount || 0))}</div>
        <div class="rtp-field rtp-amount rtp-amount-vatable">${escapeHtml(formatFixedAmount(totals.vatableSales || 0))}</div>
        <div class="rtp-field rtp-amount rtp-amount-exempt">${escapeHtml(formatFixedAmount(totals.vatExempt || 0))}</div>
        <div class="rtp-field rtp-amount rtp-amount-zero">${escapeHtml(formatFixedAmount(totals.zeroRated || 0))}</div>
        <div class="rtp-field rtp-amount rtp-amount-less-vat">${escapeHtml(formatFixedAmount(totals.lessVat || 0))}</div>
        <div class="rtp-field rtp-amount rtp-amount-due">${escapeHtml(formatFixedAmount(totals.amountDue || 0))}</div>
    `;
}

const RTP_PREVIEW_MM_PX = 1.8;
const RTP_PRINT_SECTION_LAYOUT = {
    header: { label: 'Header', subtitle: 'Registered name, TIN, address', xMm: 18, yMm: 11 },
    description: { label: 'Service Block', subtitle: 'Item description and service details', xMm: 18, yMm: 42 },
    meta: { label: 'Date / Terms', subtitle: 'Date, code, month, contract tag', xMm: 204, yMm: 11 },
    totals: { label: 'Totals', subtitle: 'Total sales, VAT, net, due', xMm: 212, yMm: 112 }
};

const RTP_PRINT_CALIBRATION = {
    paperWidthCm: 20,
    paperHeightCm: 18,
    orientation: 'portrait',
    scale: 0.54,
    offsetXmm: 1.5,
    offsetYmm: 18,
    rightMarginMm: 0,
    sections: {
        header: { xMm: 0, yMm: 0, fontScale: 1 },
        description: { xMm: 0, yMm: 0, fontScale: 1 },
        meta: { xMm: 0, yMm: 0, fontScale: 1 },
        totals: { xMm: 0, yMm: 0, fontScale: 1, amountWidthMm: 34, amountScaleX: 0.92, amountRightPadMm: 2, amountDueFontScale: 1.2 }
    }
};

const RTP_PRINT_CALIBRATION_STORAGE_KEY = 'marga_rtp_print_calibration_v1';
const RTP_PRINT_TEMPLATE_LIBRARY_STORAGE_KEY = 'marga_rtp_print_templates_v1';
const RTP_PRINT_ACTIVE_TEMPLATE_STORAGE_KEY = 'marga_rtp_print_active_template_v1';
const RTP_PRINT_RECOVERED_TEMPLATE_NAME = 'Saved Invoice Layout';
const RTP_PRINT_TEMPLATE_FIRESTORE_COLLECTION = 'tbl_app_settings';
const RTP_PRINT_TEMPLATE_FIRESTORE_DOC_ID = 'billing_invoice_print_templates_v1';
const RTP_PRINT_TEMPLATE_SETTING_KEY = 'billing_invoice_print_templates';
let currentRtpPrintCalibration = normalizeRtpPrintCalibration(RTP_PRINT_CALIBRATION);
let currentRtpPrintTemplates = {};
let currentRtpPrintTemplateName = 'Default';
let rtpPrintTemplatesFirebasePromise = null;
let rtpPrintTemplatesLoadedFromFirebase = false;

function normalizeRtpPrintCalibration(value = {}) {
    const paperWidthCm = Number(value?.paperWidthCm ?? RTP_PRINT_CALIBRATION.paperWidthCm);
    const paperHeightCm = Number(value?.paperHeightCm ?? RTP_PRINT_CALIBRATION.paperHeightCm);
    const orientation = String(value?.orientation || RTP_PRINT_CALIBRATION.orientation).trim().toLowerCase();
    const scale = Number(value?.scale ?? RTP_PRINT_CALIBRATION.scale);
    const offsetXmm = Number(value?.offsetXmm ?? RTP_PRINT_CALIBRATION.offsetXmm);
    const offsetYmm = Number(value?.offsetYmm ?? RTP_PRINT_CALIBRATION.offsetYmm);
    const rightMarginMm = Number(value?.rightMarginMm ?? RTP_PRINT_CALIBRATION.rightMarginMm);
    const rawSections = value?.sections || {};
    return {
        paperWidthCm: Number.isFinite(paperWidthCm) ? Math.max(10, Math.min(40, paperWidthCm)) : RTP_PRINT_CALIBRATION.paperWidthCm,
        paperHeightCm: Number.isFinite(paperHeightCm) ? Math.max(10, Math.min(40, paperHeightCm)) : RTP_PRINT_CALIBRATION.paperHeightCm,
        orientation: orientation === 'landscape' ? 'landscape' : 'portrait',
        scale: Number.isFinite(scale) ? Math.max(0.35, Math.min(0.9, scale)) : RTP_PRINT_CALIBRATION.scale,
        offsetXmm: Number.isFinite(offsetXmm) ? Math.max(-40, Math.min(40, offsetXmm)) : RTP_PRINT_CALIBRATION.offsetXmm,
        offsetYmm: Number.isFinite(offsetYmm) ? Math.max(-40, Math.min(80, offsetYmm)) : RTP_PRINT_CALIBRATION.offsetYmm,
        rightMarginMm: Number.isFinite(rightMarginMm) ? Math.max(0, Math.min(40, rightMarginMm)) : RTP_PRINT_CALIBRATION.rightMarginMm,
        sections: Object.fromEntries(Object.keys(RTP_PRINT_SECTION_LAYOUT).map((sectionKey) => {
            const defaults = RTP_PRINT_CALIBRATION.sections[sectionKey];
            const current = rawSections?.[sectionKey] || {};
            const sectionX = Number(current?.xMm ?? defaults.xMm);
            const sectionY = Number(current?.yMm ?? defaults.yMm);
            const fontScale = Number(current?.fontScale ?? defaults.fontScale);
            const normalizedSection = {
                xMm: Number.isFinite(sectionX) ? Math.max(-40, Math.min(40, sectionX)) : defaults.xMm,
                yMm: Number.isFinite(sectionY) ? Math.max(-40, Math.min(80, sectionY)) : defaults.yMm,
                fontScale: Number.isFinite(fontScale) ? Math.max(0.6, Math.min(1.8, fontScale)) : defaults.fontScale
            };
            if (sectionKey === 'totals') {
                const amountWidthMm = Number(current?.amountWidthMm ?? defaults.amountWidthMm ?? 34);
                const amountScaleX = Number(current?.amountScaleX ?? defaults.amountScaleX ?? 0.92);
                const amountRightPadMm = Number(current?.amountRightPadMm ?? defaults.amountRightPadMm ?? 2);
                const amountDueFontScale = Number(current?.amountDueFontScale ?? defaults.amountDueFontScale ?? 1.2);
                normalizedSection.amountWidthMm = Number.isFinite(amountWidthMm) ? Math.max(20, Math.min(60, amountWidthMm)) : (defaults.amountWidthMm || 34);
                normalizedSection.amountScaleX = Number.isFinite(amountScaleX) ? Math.max(0.75, Math.min(1.15, amountScaleX)) : (defaults.amountScaleX || 0.92);
                normalizedSection.amountRightPadMm = Number.isFinite(amountRightPadMm) ? Math.max(0, Math.min(12, amountRightPadMm)) : (defaults.amountRightPadMm || 2);
                normalizedSection.amountDueFontScale = Number.isFinite(amountDueFontScale) ? Math.max(0.8, Math.min(2.2, amountDueFontScale)) : (defaults.amountDueFontScale || 1.2);
            }
            return [sectionKey, normalizedSection];
        }))
    };
}

function readRtpPrintCalibration() {
    try {
        const raw = localStorage.getItem(RTP_PRINT_CALIBRATION_STORAGE_KEY);
        if (!raw) return null;
        return normalizeRtpPrintCalibration(JSON.parse(raw));
    } catch (error) {
        return null;
    }
}

function loadRtpPrintCalibration() {
    return readRtpPrintCalibration() || normalizeRtpPrintCalibration();
}

function normalizeRtpPrintTemplateName(value = '') {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    return normalized.slice(0, 48) || 'Default';
}

function rtpPrintCalibrationsEqual(left, right) {
    return JSON.stringify(normalizeRtpPrintCalibration(left)) === JSON.stringify(normalizeRtpPrintCalibration(right));
}

function isDefaultRtpPrintCalibration(calibration) {
    return rtpPrintCalibrationsEqual(calibration, RTP_PRINT_CALIBRATION);
}

function getUniqueRtpPrintTemplateName(baseName, templates = {}) {
    const normalizedBase = normalizeRtpPrintTemplateName(baseName);
    if (!templates[normalizedBase]) return normalizedBase;
    for (let index = 2; index < 100; index += 1) {
        const candidate = normalizeRtpPrintTemplateName(`${normalizedBase} ${index}`);
        if (!templates[candidate]) return candidate;
    }
    return normalizeRtpPrintTemplateName(`${normalizedBase} ${Date.now()}`);
}

function extractRtpPrintTemplateEntries(parsed) {
    if (Array.isArray(parsed)) {
        return parsed.map((entry, index) => [
            normalizeRtpPrintTemplateName(entry?.name || entry?.templateName || `Template ${index + 1}`),
            normalizeRtpPrintCalibration(entry?.calibration || entry?.settings || entry)
        ]);
    }

    const source = parsed?.templates && typeof parsed.templates === 'object'
        ? parsed.templates
        : parsed;
    if (!source || typeof source !== 'object') return [];

    return Object.entries(source).map(([templateName, calibration]) => [
        normalizeRtpPrintTemplateName(templateName),
        normalizeRtpPrintCalibration(calibration?.calibration || calibration)
    ]);
}

function loadRtpPrintTemplates() {
    const templates = {
        Default: normalizeRtpPrintCalibration(RTP_PRINT_CALIBRATION)
    };
    try {
        const raw = localStorage.getItem(RTP_PRINT_TEMPLATE_LIBRARY_STORAGE_KEY);
        if (!raw) return templates;
        const parsed = JSON.parse(raw);
        extractRtpPrintTemplateEntries(parsed).forEach(([templateName, calibration]) => {
            templates[templateName] = calibration;
        });
        return templates;
    } catch (error) {
        return templates;
    }
}

function saveRtpPrintTemplates(nextTemplates) {
    currentRtpPrintTemplates = Object.fromEntries(Object.entries(nextTemplates || {}).map(([templateName, calibration]) => [
        normalizeRtpPrintTemplateName(templateName),
        normalizeRtpPrintCalibration(calibration)
    ]));
    if (!Object.keys(currentRtpPrintTemplates).length) {
        currentRtpPrintTemplates.Default = normalizeRtpPrintCalibration(RTP_PRINT_CALIBRATION);
    }
    try {
        localStorage.setItem(RTP_PRINT_TEMPLATE_LIBRARY_STORAGE_KEY, JSON.stringify(currentRtpPrintTemplates));
    } catch (error) {
        console.warn('Unable to save RTP print templates.', error);
    }
    return currentRtpPrintTemplates;
}

function mergeRtpPrintTemplateLibraries(primaryTemplates = {}, secondaryTemplates = {}) {
    const merged = saveRtpPrintTemplates(primaryTemplates);
    Object.entries(secondaryTemplates || {}).forEach(([templateName, calibration]) => {
        const normalizedCalibration = normalizeRtpPrintCalibration(calibration);
        if (templateName === 'Default' && isDefaultRtpPrintCalibration(normalizedCalibration)) return;
        const alreadyExists = Object.values(merged).some((existingCalibration) => (
            rtpPrintCalibrationsEqual(existingCalibration, normalizedCalibration)
        ));
        if (alreadyExists) return;

        const preferredName = templateName === 'Default' ? RTP_PRINT_RECOVERED_TEMPLATE_NAME : templateName;
        const uniqueName = getUniqueRtpPrintTemplateName(preferredName, merged);
        merged[uniqueName] = normalizedCalibration;
    });
    return saveRtpPrintTemplates(merged);
}

function loadRtpPrintActiveTemplateName() {
    try {
        return normalizeRtpPrintTemplateName(localStorage.getItem(RTP_PRINT_ACTIVE_TEMPLATE_STORAGE_KEY) || 'Default');
    } catch (error) {
        return 'Default';
    }
}

function saveRtpPrintActiveTemplateName(templateName) {
    currentRtpPrintTemplateName = normalizeRtpPrintTemplateName(templateName);
    try {
        localStorage.setItem(RTP_PRINT_ACTIVE_TEMPLATE_STORAGE_KEY, currentRtpPrintTemplateName);
    } catch (error) {
        console.warn('Unable to save active RTP template name.', error);
    }
    return currentRtpPrintTemplateName;
}

function getRtpPrintPaperDimensions(calibration = currentRtpPrintCalibration) {
    const rawWidthCm = Number(calibration?.paperWidthCm ?? RTP_PRINT_CALIBRATION.paperWidthCm);
    const rawHeightCm = Number(calibration?.paperHeightCm ?? RTP_PRINT_CALIBRATION.paperHeightCm);
    let widthCm = Number.isFinite(rawWidthCm) ? rawWidthCm : RTP_PRINT_CALIBRATION.paperWidthCm;
    let heightCm = Number.isFinite(rawHeightCm) ? rawHeightCm : RTP_PRINT_CALIBRATION.paperHeightCm;
    const orientation = calibration?.orientation === 'landscape' ? 'landscape' : 'portrait';
    if (orientation === 'portrait' && widthCm > heightCm) {
        [widthCm, heightCm] = [heightCm, widthCm];
    }
    if (orientation === 'landscape' && widthCm < heightCm) {
        [widthCm, heightCm] = [heightCm, widthCm];
    }
    const rawRightMarginMm = Number(calibration?.rightMarginMm ?? RTP_PRINT_CALIBRATION.rightMarginMm);
    const requestedRightMarginMm = Number.isFinite(rawRightMarginMm) ? Math.max(0, Math.min(40, rawRightMarginMm)) : 0;
    const baseWidthMm = widthCm * 10;
    const heightMm = heightCm * 10;
    const maxPortraitRightMarginMm = Math.max(0, heightMm - baseWidthMm - 1);
    const effectiveRightMarginMm = orientation === 'portrait'
        ? Math.min(requestedRightMarginMm, maxPortraitRightMarginMm)
        : requestedRightMarginMm;
    const widthMm = baseWidthMm + effectiveRightMarginMm;
    return {
        widthCm: widthMm / 10,
        heightCm,
        widthMm,
        heightMm
    };
}

function saveRtpPrintCalibration(nextValue, options = {}) {
    const { persistTemplate = true } = options;
    currentRtpPrintCalibration = normalizeRtpPrintCalibration(nextValue);
    try {
        localStorage.setItem(RTP_PRINT_CALIBRATION_STORAGE_KEY, JSON.stringify(currentRtpPrintCalibration));
    } catch (error) {
        console.warn('Unable to save RTP print calibration.', error);
    }
    if (persistTemplate) {
        saveRtpPrintTemplates({
            ...currentRtpPrintTemplates,
            [currentRtpPrintTemplateName]: currentRtpPrintCalibration
        });
    }
    return currentRtpPrintCalibration;
}

function resetRtpPrintCalibration() {
    return saveRtpPrintCalibration(RTP_PRINT_CALIBRATION);
}

function saveCurrentRtpPrintTemplate(templateName) {
    const normalizedName = normalizeRtpPrintTemplateName(templateName || currentRtpPrintTemplateName);
    saveRtpPrintActiveTemplateName(normalizedName);
    saveRtpPrintTemplates({
        ...currentRtpPrintTemplates,
        [normalizedName]: currentRtpPrintCalibration
    });
    return saveRtpPrintCalibration(currentRtpPrintCalibration, { persistTemplate: false });
}

function applyRtpPrintTemplate(templateName) {
    const normalizedName = normalizeRtpPrintTemplateName(templateName);
    const nextCalibration = currentRtpPrintTemplates[normalizedName];
    if (!nextCalibration) return currentRtpPrintCalibration;
    saveRtpPrintActiveTemplateName(normalizedName);
    return saveRtpPrintCalibration(nextCalibration, { persistTemplate: false });
}

function deleteRtpPrintTemplate(templateName) {
    const normalizedName = normalizeRtpPrintTemplateName(templateName);
    const nextTemplates = { ...currentRtpPrintTemplates };
    delete nextTemplates[normalizedName];
    const savedTemplates = saveRtpPrintTemplates(nextTemplates);
    const nextActiveTemplate = savedTemplates[normalizedName]
        ? normalizedName
        : (savedTemplates.Default ? 'Default' : Object.keys(savedTemplates)[0]);
    saveRtpPrintActiveTemplateName(nextActiveTemplate);
    return saveRtpPrintCalibration(savedTemplates[nextActiveTemplate], { persistTemplate: false });
}

function recoverStoredRtpPrintTemplate(templates, storedCalibration, storedActiveTemplate) {
    if (!storedCalibration) {
        return { templates, recoveredTemplateName: null };
    }

    const normalizedStoredCalibration = normalizeRtpPrintCalibration(storedCalibration);
    if (storedActiveTemplate && storedActiveTemplate !== 'Default' && templates[storedActiveTemplate]) {
        return {
            templates: {
                ...templates,
                [storedActiveTemplate]: normalizedStoredCalibration
            },
            recoveredTemplateName: storedActiveTemplate
        };
    }

    const matchingTemplateName = Object.entries(templates).find(([, calibration]) => (
        rtpPrintCalibrationsEqual(calibration, normalizedStoredCalibration)
    ))?.[0];
    if (matchingTemplateName) {
        if (matchingTemplateName !== 'Default' || isDefaultRtpPrintCalibration(normalizedStoredCalibration)) {
            return { templates, recoveredTemplateName: matchingTemplateName === 'Default' ? null : matchingTemplateName };
        }
    }

    const preferredName = storedActiveTemplate && storedActiveTemplate !== 'Default'
        ? storedActiveTemplate
        : RTP_PRINT_RECOVERED_TEMPLATE_NAME;
    const recoveredTemplateName = getUniqueRtpPrintTemplateName(preferredName, templates);
    return {
        templates: {
            ...templates,
            [recoveredTemplateName]: normalizedStoredCalibration
        },
        recoveredTemplateName
    };
}

function initializeRtpPrintCalibrationState() {
    const loadedTemplates = loadRtpPrintTemplates();
    const storedCalibration = readRtpPrintCalibration();
    const storedActiveTemplate = loadRtpPrintActiveTemplateName();
    const recoveredState = recoverStoredRtpPrintTemplate(loadedTemplates, storedCalibration, storedActiveTemplate);
    currentRtpPrintTemplates = saveRtpPrintTemplates(recoveredState.templates);
    const activeTemplateName = recoveredState.recoveredTemplateName || (currentRtpPrintTemplates[storedActiveTemplate]
        ? storedActiveTemplate
        : (currentRtpPrintTemplates.Default ? 'Default' : Object.keys(currentRtpPrintTemplates)[0]));
    saveRtpPrintActiveTemplateName(activeTemplateName);
    currentRtpPrintCalibration = currentRtpPrintTemplates[activeTemplateName] || storedCalibration || normalizeRtpPrintCalibration(RTP_PRINT_CALIBRATION);
    saveRtpPrintTemplates({
        ...currentRtpPrintTemplates,
        [activeTemplateName]: currentRtpPrintCalibration
    });
    saveRtpPrintCalibration(currentRtpPrintCalibration, { persistTemplate: false });
}

initializeRtpPrintCalibrationState();

function buildRtpPrintLocalTemplateState() {
    const loadedTemplates = loadRtpPrintTemplates();
    const storedCalibration = readRtpPrintCalibration();
    const storedActiveTemplate = loadRtpPrintActiveTemplateName();
    const recoveredState = recoverStoredRtpPrintTemplate(loadedTemplates, storedCalibration, storedActiveTemplate);
    const templates = saveRtpPrintTemplates(recoveredState.templates);
    const activeTemplateName = recoveredState.recoveredTemplateName || (templates[storedActiveTemplate]
        ? storedActiveTemplate
        : (templates[currentRtpPrintTemplateName] ? currentRtpPrintTemplateName : 'Default'));
    return {
        templates,
        activeTemplateName: normalizeRtpPrintTemplateName(activeTemplateName)
    };
}

function parseRtpPrintTemplateJson(value) {
    if (!value) return {};
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Object.fromEntries(extractRtpPrintTemplateEntries(parsed));
    } catch (error) {
        console.warn('Unable to parse Firebase invoice print templates.', error);
        return {};
    }
}

async function loadRtpPrintTemplatesFromFirestore() {
    const doc = await getFirestoreDocument(RTP_PRINT_TEMPLATE_FIRESTORE_COLLECTION, RTP_PRINT_TEMPLATE_FIRESTORE_DOC_ID);
    if (!doc) {
        return {
            found: false,
            templates: {
                Default: normalizeRtpPrintCalibration(RTP_PRINT_CALIBRATION)
            },
            activeTemplateName: 'Default'
        };
    }

    return {
        found: true,
        templates: {
            Default: normalizeRtpPrintCalibration(RTP_PRINT_CALIBRATION),
            ...parseRtpPrintTemplateJson(doc.templates_json)
        },
        activeTemplateName: normalizeRtpPrintTemplateName(doc.active_template_name || 'Default')
    };
}

async function saveRtpPrintTemplatesToFirestore() {
    const templatesJson = JSON.stringify(currentRtpPrintTemplates);
    return setFirestoreDocument(RTP_PRINT_TEMPLATE_FIRESTORE_COLLECTION, RTP_PRINT_TEMPLATE_FIRESTORE_DOC_ID, {
        setting_key: RTP_PRINT_TEMPLATE_SETTING_KEY,
        active_template_name: currentRtpPrintTemplateName,
        templates_json: templatesJson,
        updated_at: new Date().toISOString(),
        source_module: 'billing_dashboard'
    }, {
        mode: 'set',
        label: 'Invoice print templates',
        dedupeKey: `${RTP_PRINT_TEMPLATE_FIRESTORE_COLLECTION}:${RTP_PRINT_TEMPLATE_FIRESTORE_DOC_ID}`
    });
}

async function ensureRtpPrintTemplatesReady(options = {}) {
    const { force = false } = options;
    if (rtpPrintTemplatesLoadedFromFirebase && !force) return currentRtpPrintTemplates;
    if (rtpPrintTemplatesFirebasePromise && !force) return rtpPrintTemplatesFirebasePromise;

    rtpPrintTemplatesFirebasePromise = (async () => {
        const localState = buildRtpPrintLocalTemplateState();
        let firebaseState = null;
        try {
            firebaseState = await loadRtpPrintTemplatesFromFirestore();
        } catch (error) {
            console.warn('Unable to load invoice print templates from Firebase. Using local fallback.', error);
            firebaseState = null;
        }

        if (firebaseState?.found) {
            const mergedTemplates = mergeRtpPrintTemplateLibraries(firebaseState.templates, localState.templates);
            const activeTemplateName = mergedTemplates[firebaseState.activeTemplateName]
                ? firebaseState.activeTemplateName
                : (mergedTemplates[localState.activeTemplateName] ? localState.activeTemplateName : 'Default');
            saveRtpPrintActiveTemplateName(activeTemplateName);
            currentRtpPrintCalibration = mergedTemplates[activeTemplateName] || normalizeRtpPrintCalibration(RTP_PRINT_CALIBRATION);
            saveRtpPrintCalibration(currentRtpPrintCalibration, { persistTemplate: false });

            if (JSON.stringify(mergedTemplates) !== JSON.stringify(firebaseState.templates)) {
                await saveRtpPrintTemplatesToFirestore();
            }
        } else {
            currentRtpPrintTemplates = saveRtpPrintTemplates(localState.templates);
            const activeTemplateName = currentRtpPrintTemplates[localState.activeTemplateName]
                ? localState.activeTemplateName
                : 'Default';
            saveRtpPrintActiveTemplateName(activeTemplateName);
            currentRtpPrintCalibration = currentRtpPrintTemplates[activeTemplateName] || normalizeRtpPrintCalibration(RTP_PRINT_CALIBRATION);
            saveRtpPrintCalibration(currentRtpPrintCalibration, { persistTemplate: false });
            await saveRtpPrintTemplatesToFirestore();
        }

        rtpPrintTemplatesLoadedFromFirebase = true;
        return currentRtpPrintTemplates;
    })().finally(() => {
        rtpPrintTemplatesFirebasePromise = null;
    });

    return rtpPrintTemplatesFirebasePromise;
}

function getRtpPrintSectionCalibration(sectionKey) {
    return currentRtpPrintCalibration.sections?.[sectionKey] || RTP_PRINT_CALIBRATION.sections[sectionKey];
}

function rtpSizeUnit(valueMm, mode = 'print') {
    return mode === 'screen'
        ? `${Number(valueMm || 0) * RTP_PREVIEW_MM_PX}px`
        : `${valueMm}mm`;
}

function buildRtpPositionStyle(config = {}, mode = 'print') {
    const parts = ['position:absolute'];
    if (config.xMm !== undefined) parts.push(`left:${rtpSizeUnit(config.xMm, mode)}`);
    if (config.yMm !== undefined) parts.push(`top:${rtpSizeUnit(config.yMm, mode)}`);
    if (config.widthMm !== undefined) parts.push(`width:${rtpSizeUnit(config.widthMm, mode)}`);
    if (config.heightMm !== undefined) parts.push(`height:${rtpSizeUnit(config.heightMm, mode)}`);
    if (config.textAlign) parts.push(`text-align:${config.textAlign}`);
    return parts.join(';');
}

function buildRtpSectionStyle(sectionKey, mode = 'print') {
    const layout = RTP_PRINT_SECTION_LAYOUT[sectionKey];
    const calibration = getRtpPrintSectionCalibration(sectionKey);
    return [
        'position:absolute',
        `left:${rtpSizeUnit((layout?.xMm || 0) + (calibration?.xMm || 0), mode)}`,
        `top:${rtpSizeUnit((layout?.yMm || 0) + (calibration?.yMm || 0), mode)}`,
        'transform-origin:top left',
        `transform:scale(${calibration?.fontScale || 1})`
    ].join(';');
}

function buildRtpTotalsAmountStyle(yMm, mode = 'print', options = {}) {
    const totalsCalibration = getRtpPrintSectionCalibration('totals');
    const baseWidthMm = 27;
    const amountWidthMm = Number(totalsCalibration?.amountWidthMm || 34) || 34;
    const amountScaleX = Number(totalsCalibration?.amountScaleX || 1) || 1;
    const amountRightPadMm = Number(totalsCalibration?.amountRightPadMm || 0) || 0;
    const xMm = baseWidthMm - amountRightPadMm - amountWidthMm;
    const parts = [
        buildRtpPositionStyle({ xMm, yMm, widthMm: amountWidthMm, textAlign: 'right' }, mode),
        'transform-origin:right center',
        `transform:scaleX(${amountScaleX})`
    ];
    if (options.due) {
        const amountDueFontScale = Number(totalsCalibration?.amountDueFontScale || 1.2) || 1.2;
        parts.push(`font-size:${amountDueFontScale}em`);
        parts.push('font-weight:800');
    }
    return parts.join(';');
}

function buildRtpSectionedLayoutHtml(preview, mode = 'print') {
    const totals = preview?.totals || {};
    const contractCode = String(preview?.contractCode || 'RTP').trim().toUpperCase() || 'RTP';
    const isFixedRate = contractCode === 'RTF';
    return `
        <div class="rtp-section-block" style="${buildRtpSectionStyle('header', mode)}">
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 0, widthMm: 150 }, mode)}"><strong>${escapeHtml(preview?.customerName || 'Unknown Customer')}</strong></div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 9, widthMm: 90 }, mode)}">${escapeHtml(preview?.tin || 'N/A')}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 17, widthMm: 150 }, mode)}">${escapeHtml(preview?.address || 'N/A')}</div>
        </div>
        <div class="rtp-section-block" style="${buildRtpSectionStyle('description', mode)}">
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 0, widthMm: 58 }, mode)}"><strong>Business Style :</strong></div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 60, yMm: 0, widthMm: 118 }, mode)}">${escapeHtml(preview?.businessStyle || 'N/A')}</div>

            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 10, widthMm: 58 }, mode)}"><strong>Printer Model</strong></div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 60, yMm: 10, widthMm: 118 }, mode)}">${escapeHtml(preview?.printerModel || 'N/A')}</div>

            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 21, widthMm: 88 }, mode)}"><strong>Printer Rental Billing for :</strong></div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 90, yMm: 21, widthMm: 34, textAlign: 'center' }, mode)}">${escapeHtml(preview?.billingFrom || 'N/A')}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 128, yMm: 21, widthMm: 10, textAlign: 'center' }, mode)}"><strong>to</strong></div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 142, yMm: 21, widthMm: 34, textAlign: 'center' }, mode)}">${escapeHtml(preview?.billingTo || 'N/A')}</div>

            ${
                isFixedRate
                    ? `
                        <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 32, widthMm: 60 }, mode)}"><strong>Monthly Rate:</strong></div>
                        <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 92, yMm: 32, widthMm: 24 }, mode)}">${escapeHtml(formatFixedAmount(preview?.monthlyRate || preview?.rate || 0))}</div>
                    `
                    : `
                        <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 32, widthMm: 60 }, mode)}"><strong>Total Pages consumed :</strong></div>
                        <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 92, yMm: 32, widthMm: 24 }, mode)}">${escapeHtml(formatCount(preview?.totalPages || 0))}</div>

                        <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 42, widthMm: 60 }, mode)}"><strong>Rate per Page:</strong></div>
                        <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 92, yMm: 42, widthMm: 24 }, mode)}">${escapeHtml(formatFixedAmount(preview?.rate || 0))}</div>
                    `
            }
        </div>
        <div class="rtp-section-block" style="${buildRtpSectionStyle('meta', mode)}">
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 0, widthMm: 32 }, mode)}">${escapeHtml(preview?.invoiceDate || '')}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 9, widthMm: 32 }, mode)}">${escapeHtml(preview?.readingCode || '')}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 17, widthMm: 32 }, mode)}">${escapeHtml(preview?.monthLabel || '')}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 27, widthMm: 32 }, mode)}">${escapeHtml(contractCode)}</div>
        </div>
        <div class="rtp-section-block" style="${buildRtpSectionStyle('totals', mode)}">
            <div class="rtp-block-field" style="${buildRtpTotalsAmountStyle(0, mode)}">${escapeHtml(formatFixedAmount(totals.total || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpTotalsAmountStyle(9, mode)}">${escapeHtml(formatFixedAmount(totals.vatAmount || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpTotalsAmountStyle(17, mode)}">${escapeHtml(formatFixedAmount(totals.vatableSales || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpTotalsAmountStyle(26, mode)}">${escapeHtml(formatFixedAmount(totals.vatExempt || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpTotalsAmountStyle(35, mode)}">${escapeHtml(formatFixedAmount(totals.zeroRated || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpTotalsAmountStyle(44, mode)}">${escapeHtml(formatFixedAmount(totals.lessVat || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpTotalsAmountStyle(53, mode, { due: true })}">${escapeHtml(formatFixedAmount(totals.amountDue || 0))}</div>
        </div>
    `;
}

function renderRtpSectionCalibrationControls() {
    return `
        <div class="calc-section-calibration-grid">
            ${Object.entries(RTP_PRINT_SECTION_LAYOUT).map(([sectionKey, layout]) => {
                const calibration = getRtpPrintSectionCalibration(sectionKey);
                return `
                    <div class="calc-section-card">
                        <div class="calc-section-title">${escapeHtml(layout.label)}</div>
                        <div class="calc-section-subtitle">${escapeHtml(layout.subtitle || '')}</div>
                        <div class="calc-print-calibration calc-print-calibration-compact">
                            <div class="calc-field">
                                <label for="rtpSection${sectionKey}X">X (mm)</label>
                                <input type="number" id="rtpSection${sectionKey}X" data-rtp-section-key="${sectionKey}" data-rtp-section-field="xMm" step="0.5" value="${escapeHtml(String(calibration.xMm))}">
                            </div>
                            <div class="calc-field">
                                <label for="rtpSection${sectionKey}Y">Y (mm)</label>
                                <input type="number" id="rtpSection${sectionKey}Y" data-rtp-section-key="${sectionKey}" data-rtp-section-field="yMm" step="0.5" value="${escapeHtml(String(calibration.yMm))}">
                            </div>
                            <div class="calc-field">
                                <label for="rtpSection${sectionKey}Font">Font Size</label>
                                <input type="number" id="rtpSection${sectionKey}Font" data-rtp-section-key="${sectionKey}" data-rtp-section-field="fontScale" step="0.05" min="0.6" max="1.8" value="${escapeHtml(String(calibration.fontScale))}">
                            </div>
                            ${sectionKey === 'totals' ? `
                                <div class="calc-field">
                                    <label for="rtpSection${sectionKey}AmountWidth">Amount Width</label>
                                    <input type="number" id="rtpSection${sectionKey}AmountWidth" data-rtp-section-key="${sectionKey}" data-rtp-section-field="amountWidthMm" step="0.5" min="20" max="60" value="${escapeHtml(String(calibration.amountWidthMm || 34))}">
                                </div>
                                <div class="calc-field">
                                    <label for="rtpSection${sectionKey}AmountFit">Amount Fit</label>
                                    <input type="number" id="rtpSection${sectionKey}AmountFit" data-rtp-section-key="${sectionKey}" data-rtp-section-field="amountScaleX" step="0.01" min="0.75" max="1.15" value="${escapeHtml(String(calibration.amountScaleX || 0.92))}">
                                </div>
                                <div class="calc-field">
                                    <label for="rtpSection${sectionKey}RightPad">Right Padding</label>
                                    <input type="number" id="rtpSection${sectionKey}RightPad" data-rtp-section-key="${sectionKey}" data-rtp-section-field="amountRightPadMm" step="0.5" min="0" max="12" value="${escapeHtml(String(calibration.amountRightPadMm ?? 2))}">
                                </div>
                                <div class="calc-field">
                                    <label for="rtpSection${sectionKey}DueFont">Final Amount Size</label>
                                    <input type="number" id="rtpSection${sectionKey}DueFont" data-rtp-section-key="${sectionKey}" data-rtp-section-field="amountDueFontScale" step="0.05" min="0.8" max="2.2" value="${escapeHtml(String(calibration.amountDueFontScale || 1.2))}">
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderRtpPrintTemplateControls() {
    const templateOptions = Object.keys(currentRtpPrintTemplates)
        .sort((left, right) => left.localeCompare(right))
        .map((templateName) => `<option value="${escapeHtml(templateName)}"${templateName === currentRtpPrintTemplateName ? ' selected' : ''}>${escapeHtml(templateName)}</option>`)
        .join('');
    return `
        <div class="calc-print-calibration calc-print-template-grid">
            <div class="calc-field">
                <label for="calcPrintTemplateSelect">Template</label>
                <select id="calcPrintTemplateSelect">${templateOptions}</select>
            </div>
            <div class="calc-field">
                <label for="calcPrintTemplateNameInput">Template Name</label>
                <input type="text" id="calcPrintTemplateNameInput" value="${escapeHtml(currentRtpPrintTemplateName)}" placeholder="Invoice 1 template">
            </div>
            <div class="calc-print-actions">
                <button class="btn btn-secondary" type="button" id="calcPrintSaveTemplateBtn">Save Template</button>
            </div>
            <div class="calc-print-actions">
                <button class="btn btn-secondary" type="button" id="calcPrintDeleteTemplateBtn"${currentRtpPrintTemplateName === 'Default' ? ' disabled' : ''}>Delete Template</button>
            </div>
        </div>
    `;
}

function buildRtpCalibratedPreviewHtml(preview) {
    const paper = getRtpPrintPaperDimensions(currentRtpPrintCalibration);
    return `
        <section class="rtp-calibration-shell" aria-label="RTP print calibration preview">
            <div
                class="rtp-calibration-paper"
                style="--paper-width-mm:${paper.widthMm}; --paper-height-mm:${paper.heightMm};"
            >
                <div
                    class="rtp-calibration-sheet"
                    style="transform: translate(calc(${currentRtpPrintCalibration.offsetXmm} * var(--rtp-mm-px) * 1px), calc(${currentRtpPrintCalibration.offsetYmm} * var(--rtp-mm-px) * 1px)) scale(${currentRtpPrintCalibration.scale});"
                >
                    ${buildRtpSectionedLayoutHtml(preview, 'screen')}
                </div>
            </div>
        </section>
    `;
}

function buildRtpPrintDocument(preview) {
    const paper = getRtpPrintPaperDimensions(currentRtpPrintCalibration);
    const paperWidth = `${paper.widthCm}cm`;
    const paperHeight = `${paper.heightCm}cm`;
    const contractCode = String(preview?.contractCode || 'RTP').trim().toUpperCase() || 'RTP';
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>${escapeHtml(contractCode)} Print</title>
    <style>
        @page { size: ${paperWidth} ${paperHeight}; margin: 0; }
        * { box-sizing: border-box; }
        html, body {
            margin: 0;
            padding: 0;
            width: ${paperWidth};
            height: ${paperHeight};
            background: #fff;
            overflow: hidden;
        }
        body { font-family: "Arial", "Helvetica Neue", sans-serif; }
        .print-wrap {
            position: relative;
            width: ${paperWidth};
            height: ${paperHeight};
            overflow: hidden;
            page-break-after: avoid;
        }
        .rtp-preview-shell {
            position: relative;
            width: ${paperWidth};
            height: ${paperHeight};
            overflow: hidden;
        }
        .rtp-preview-note {
            display: none;
        }
        .rtp-preview-paper {
            position: relative;
            width: 100%;
            height: 100%;
            padding: 0;
            border: 0;
            background: transparent;
        }
        .rtp-print-sheet {
            position: absolute;
            top: 0;
            left: 0;
            width: 255mm;
            height: 190mm;
            color: #111827;
            font-size: 4.6mm;
            font-weight: 600;
            line-height: 1.18;
            transform-origin: top left;
            transform: translate(${currentRtpPrintCalibration.offsetXmm}mm, ${currentRtpPrintCalibration.offsetYmm}mm) scale(${currentRtpPrintCalibration.scale});
        }
        .rtp-section-block { position: absolute; transform-origin: top left; }
        .rtp-block-field { position: absolute; white-space: pre-wrap; }
    </style>
</head>
<body>
    <div class="print-wrap">
        <section class="rtp-preview-shell" aria-label="${escapeHtml(contractCode)} print preview">
            <div class="rtp-preview-note">${escapeHtml(contractCode)}</div>
            <div class="rtp-preview-paper">
                <div class="rtp-print-sheet">
                    ${buildRtpSectionedLayoutHtml(preview, 'print')}
                </div>
            </div>
        </section>
    </div>
</body>
</html>`;
}

function printCurrentRtpInvoice() {
    if (!currentRtpPrintPayload) {
        MargaUtils.showToast('Open a printable invoice first.', 'error');
        return;
    }

    printHtmlDocument(buildRtpPrintDocument(currentRtpPrintPayload), 'marga_invoice_print');
}

function printHtmlDocument(printMarkup, windowName = 'marga_print') {
    const printWindow = window.open('', windowName, 'width=1180,height=860');
    if (!printWindow) {
        MargaUtils.showToast('The print window was blocked.', 'error');
        return;
    }

    let printTriggered = false;
    const triggerPrint = () => {
        if (printTriggered || printWindow.closed) return;
        printTriggered = true;
        printWindow.focus();
        window.setTimeout(() => {
            printWindow.print();
        }, 150);
    };

    printWindow.document.open('text/html', 'replace');
    printWindow.document.write(printMarkup);
    printWindow.document.close();
    printWindow.addEventListener('load', triggerPrint, { once: true });
    window.setTimeout(triggerPrint, 700);
}

function getPrintableBillingLines(estimate) {
    const lines = Array.isArray(estimate?.lineItems) ? estimate.lineItems : [];
    const available = lines.filter((line) => !line.missingMeterSource && !isNonBillableMeterFormula(line.formula));
    const printable = available.filter((line) => (
        !line.missingMeterSource
        && (Number(line.amountDue || 0) > 0 || Number(line.rawPages || 0) > 0 || Number(line.presentMeter || 0) > Number(line.previousMeter || 0))
    ));
    return printable.length ? printable : available;
}

function buildBillingAttachmentPrintDocument(preview, estimate, type = 'breakdown') {
    const lines = getPrintableBillingLines(estimate);
    const isMeterForm = type === 'meter_form';
    const title = isMeterForm ? 'Meter Reading Form' : 'Billing Breakdown Attachment';
    const period = [preview?.billingFrom, preview?.billingTo].filter(Boolean).join(' to ');
    const totals = preview?.totals || {};
    const invoiceRate = Number(estimate?.pageRate || preview?.rate || 0) || 0;
    const rows = lines.map((line, index) => {
        const difference = Number(line.rawPages || 0) || Math.max(0, Number(line.presentMeter || 0) - Number(line.previousMeter || 0));
        return `
            <tr>
                <td>${escapeHtml(line.label || `Line ${index + 1}`)}</td>
                <td>${escapeHtml(line.machineId || line.serialNumber || '')}</td>
                <td class="num">${escapeHtml(formatCount(line.presentMeter || 0))}</td>
                <td class="num">${escapeHtml(formatCount(line.previousMeter || 0))}</td>
                <td class="num">${escapeHtml(formatCount(difference))}</td>
                <td class="num">${escapeHtml(formatCount(line.spoilagePages || 0))}</td>
                <td class="num">${escapeHtml(formatCount(line.netPages || 0))}</td>
                <td class="num">${escapeHtml(formatFixedAmount(line.pageRate || 0))}</td>
                <td class="num">${escapeHtml(formatFixedAmount(line.amountDue || 0))}</td>
            </tr>
        `;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
        @page { size: A4 portrait; margin: 10mm; }
        body { font-family: Arial, sans-serif; color: #111827; font-size: 11px; }
        .header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111827; padding-bottom: 8px; margin-bottom: 10px; }
        h1 { margin: 0 0 3px; font-size: 18px; }
        .muted { color: #4b5563; font-weight: 700; }
        .info { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #9ca3af; padding: 4px 5px; vertical-align: top; }
        th { background: #eef2f7; text-align: left; font-size: 10px; text-transform: uppercase; }
        .num { text-align: right; white-space: nowrap; }
        .totals { margin-left: auto; margin-top: 10px; width: 280px; }
        .totals td:first-child { font-weight: 700; }
        .note { margin-top: 10px; color: #4b5563; font-size: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>${escapeHtml(title)}</h1>
            <div class="muted">${escapeHtml(cleanPrintCustomerName(preview?.customerName) || 'Unknown Customer')}</div>
            <div>${escapeHtml(preview?.address || '')}</div>
        </div>
        <div>
            <div><strong>Date:</strong> ${escapeHtml(preview?.invoiceDate || '')}</div>
            <div><strong>Month:</strong> ${escapeHtml(preview?.monthLabel || '')}</div>
            <div><strong>Contract:</strong> ${escapeHtml(preview?.contractCode || '')}</div>
        </div>
    </div>
    <div class="info">
        <div><strong>Period:</strong> ${escapeHtml(period || 'N/A')}</div>
        <div><strong>Total Pages:</strong> ${escapeHtml(formatCount(estimate?.netPages || 0))}</div>
        <div><strong>Rate:</strong> ${escapeHtml(formatAllPagesRate(invoiceRate))}</div>
        <div><strong>Invoice Total:</strong> ${escapeHtml(formatFixedAmount(totals.amountDue || estimate?.amountDue || 0))}</div>
    </div>
    <table>
        <thead>
            <tr>
                <th>Branch / Machine</th>
                <th>Serial</th>
                <th class="num">Present</th>
                <th class="num">Previous</th>
                <th class="num">Diff</th>
                <th class="num">Spoilage</th>
                <th class="num">Net</th>
                <th class="num">Rate</th>
                <th class="num">Amount</th>
            </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="9">No computed meter lines available.</td></tr>'}</tbody>
    </table>
    <table class="totals">
        <tr><td>Total</td><td class="num">${escapeHtml(formatFixedAmount(totals.total || estimate?.amountDue || 0))}</td></tr>
        <tr><td>VAT</td><td class="num">${escapeHtml(formatFixedAmount(totals.vatAmount || estimate?.vatAmount || 0))}</td></tr>
        <tr><td>Vatable Sales</td><td class="num">${escapeHtml(formatFixedAmount(totals.vatableSales || estimate?.netAmount || 0))}</td></tr>
        <tr><td>Amount Due</td><td class="num">${escapeHtml(formatFixedAmount(totals.amountDue || estimate?.amountDue || 0))}</td></tr>
    </table>
    <div class="note">${escapeHtml(isMeterForm ? 'Use this as the meter reading attachment for the replacement or corrected invoice.' : 'Attach this breakdown to the invoice for multi-machine grouped billing.')}</div>
</body>
</html>`;
}

function printBillingAttachment(preview, estimate, type = 'breakdown') {
    if (!preview) {
        MargaUtils.showToast('Save or preview the invoice first.', 'error');
        return;
    }
    printHtmlDocument(
        buildBillingAttachmentPrintDocument(preview, estimate, type),
        type === 'meter_form' ? 'marga_meter_form_print' : 'marga_breakdown_print'
    );
}

function setStatus(text, type = 'idle') {
    if (!els.statusPill) return;
    els.statusPill.textContent = text;
    els.statusPill.classList.remove('loading', 'error');
    if (type === 'loading') els.statusPill.classList.add('loading');
    if (type === 'error') els.statusPill.classList.add('error');
}

function initDefaults() {
    els.endMonthInput.value = monthInputValue(new Date());
}

function compareBillingRows(left, right, sortValue) {
    const leftAmountCount = Object.values(left?.months || {}).reduce((sum, cell) => sum + (Number(cell?.display_amount_total || 0) > 0 ? 1 : 0), 0);
    const rightAmountCount = Object.values(right?.months || {}).reduce((sum, cell) => sum + (Number(cell?.display_amount_total || 0) > 0 ? 1 : 0), 0);
    const leftLatestAmount = Object.values(left?.months || {}).reduce((max, cell) => Math.max(max, Number(cell?.display_amount_total || 0)), 0);
    const rightLatestAmount = Object.values(right?.months || {}).reduce((max, cell) => Math.max(max, Number(cell?.display_amount_total || 0)), 0);
    const leftRd = Number(left.reading_day || 0) || Number.MAX_SAFE_INTEGER;
    const rightRd = Number(right.reading_day || 0) || Number.MAX_SAFE_INTEGER;
    const leftCustomer = String(left.company_name || left.account_name || '').toLowerCase();
    const rightCustomer = String(right.company_name || right.account_name || '').toLowerCase();
    const leftBranch = String(left.branch_name || '').toLowerCase();
    const rightBranch = String(right.branch_name || '').toLowerCase();
    const leftSerial = String(left.serial_number || left.machine_label || '').toLowerCase();
    const rightSerial = String(right.serial_number || right.machine_label || '').toLowerCase();

    if (sortValue === 'customer') {
        return leftCustomer.localeCompare(rightCustomer)
            || leftBranch.localeCompare(rightBranch)
            || leftRd - rightRd
            || (rightAmountCount - leftAmountCount)
            || (rightLatestAmount - leftLatestAmount)
            || leftSerial.localeCompare(rightSerial);
    }

    return leftRd - rightRd
        || leftCustomer.localeCompare(rightCustomer)
        || leftBranch.localeCompare(rightBranch)
        || (rightAmountCount - leftAmountCount)
        || (rightLatestAmount - leftLatestAmount)
        || leftSerial.localeCompare(rightSerial);
}

function applyUserContext() {
    if (!MargaAuth.requireAccess('billing')) return false;

    const user = MargaAuth.getUser();
    if (user) {
        const avatar = document.getElementById('userAvatar');
        const userName = document.getElementById('userName');
        const userRole = document.getElementById('userRole');
        if (avatar) avatar.textContent = (user.name || user.username || 'U').charAt(0).toUpperCase();
        if (userName) userName.textContent = user.name || user.username || 'User';
        if (userRole) userRole.textContent = MargaAuth.getDisplayRoles(user);
    }

    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    return true;
}

function buildRequestContext(options = {}) {
    const end = parseMonthInput(els.endMonthInput.value);
    if (!end) throw new Error('Please set the last month.');

    const params = new URLSearchParams();
    params.set('end_year', String(end.year));
    params.set('end_month', String(end.month));
    params.set('months_back', '6');
    params.set('row_limit', String(Math.max(1, Math.min(1000, Number(els.rowLimitInput.value || 1000)))));
    params.set('latest_limit', '100');
    params.set('max_billing_pages', String(Math.max(10, Number(els.billingPagesInput.value || 10))));
    params.set('max_schedule_pages', String(Math.max(10, Number(els.schedulePagesInput.value || 10))));
    params.set('include_rows', 'true');
    params.set('include_active_rows', 'true');
    const forceRefresh = Boolean(options.forceRefresh);
    params.set('refresh_cache', String(forceRefresh || Boolean(els.refreshCacheInput.checked)));
    const search = String(els.matrixSearchInput?.value || '').trim();
    if (search.length >= 2) {
        params.set('search', search);
        params.set('include_machine_history', 'true');
    }

    const apiKey = String(els.apiKeyInput.value || '').trim();
    if (apiKey) localStorage.setItem('openclaw_api_key', apiKey);

    return {
        url: `/.netlify/functions/openclaw-billing-cohort?${params.toString()}`,
        apiKey
    };
}

function receiptLabel(status) {
    if (status === 'received') return 'Received';
    if (status === 'partial') return 'Partial';
    if (status === 'not_confirmed') return 'Not Confirmed';
    return 'Not Billed';
}

function receiptDot(status) {
    const label = receiptLabel(status);
    const className = status === 'received' ? 'received' : status === 'partial' ? 'partial' : 'not-confirmed';
    return `<span class="receipt-dot ${className}" title="${escapeHtml(label)}"></span>`;
}

function pendingHref(companyId, monthKey) {
    const url = new URL(MargaAuth.buildAppUrl('billing/index.html'), window.location.origin);
    url.searchParams.set('row_id', companyId);
    url.searchParams.set('month', monthKey);
    url.searchParams.set('action', 'create');
    return `${url.pathname}${url.search}`;
}

function updatePendingSelection(rowId, monthKey) {
    const url = new URL(window.location.href);
    url.searchParams.set('row_id', String(rowId));
    url.searchParams.set('month', String(monthKey));
    url.searchParams.set('action', 'create');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    if (lastPayload) {
        renderSelectionCard(lastPayload);
        renderMatrixTable(lastPayload);
    }
}

function clearPendingSelection() {
    const url = new URL(window.location.href);
    url.searchParams.delete('row_id');
    url.searchParams.delete('month');
    url.searchParams.delete('action');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    if (lastPayload) {
        renderSelectionCard(lastPayload);
        renderMatrixTable(lastPayload);
    }
}

function customerHref(row) {
    const url = new URL(MargaAuth.buildAppUrl('customers.html'), window.location.origin);
    if (row?.company_id) url.searchParams.set('company_id', String(row.company_id));
    if (row?.branch_id) url.searchParams.set('branch_id', String(row.branch_id));
    if (row?.machine_id) url.searchParams.set('machine_id', String(row.machine_id));
    if (row?.contractmain_id) url.searchParams.set('contractmain_id', String(row.contractmain_id));
    url.searchParams.set('tab', 'machines');
    return `${url.pathname}${url.search}`;
}

function renderSelectionCard(payload) {
    const selectedRowId = MargaUtils.getUrlParam('row_id');
    const selectedMonth = MargaUtils.getUrlParam('month');
    const selectedAction = MargaUtils.getUrlParam('action');

    if (!selectedRowId || !selectedMonth || selectedAction !== 'create') {
        els.selectionCard.classList.add('hidden');
        els.selectionCopy.textContent = 'No cell selected.';
        return;
    }

    const row = (payload?.month_matrix?.rows || []).find((entry) => String(entry.row_id || entry.company_id) === String(selectedRowId));
    const readingDay = row?.reading_day ? `Reading day ${row.reading_day}` : 'Reading day not available';
    const message = row
        ? `${row.display_name || row.account_name || row.company_name} is selected for ${selectedMonth}. ${readingDay}. This came from a pending billing cell.`
        : `Pending billing context selected for account ${selectedRowId} in ${selectedMonth}.`;

    els.selectionCopy.textContent = message;
    els.selectionCard.classList.remove('hidden');
}

function renderSummaryTable(payload) {
    const rows = payload.billing_last_6_months || [];
    const current = rows[rows.length - 1] || null;
    const endLabel = payload.period?.end_month_label || '-';

    els.summarySubhead.textContent = current
        ? `${formatCount(current.to_bill_customers_total)} customers should be billed by ${endLabel}, ${formatCount(current.pending_customers_total)} are still pending.`
        : 'No monthly summary returned.';
    els.sheetMeta.textContent = payload.meta?.reading_day_source || '6-month billing carryover view';

    if (!rows.length) {
        els.summaryTableWrap.innerHTML = '<div class="empty-panel">No monthly summary returned.</div>';
        return;
    }

    const body = rows.slice().reverse().map((row) => `
        <tr>
            <td>${escapeHtml(row.month_label_short)}</td>
            <td>${formatCount(row.additional_customers_total)}</td>
            <td>${formatCount(row.inactive_customers_total)}</td>
            <td>${formatCount(row.balance_customers_total)}</td>
            <td>${formatCount(row.to_bill_customers_total)}</td>
            <td>${formatCount(row.billed_customers_total)}</td>
            <td class="pending-count">${formatCount(row.pending_customers_total)}</td>
        </tr>
    `).join('');

    els.summaryTableWrap.innerHTML = `
        <table class="billing-sheet summary-sheet">
            <thead>
                <tr>
                    <th>Month</th>
                    <th>Additional</th>
                    <th>Inactive</th>
                    <th>Balance</th>
                    <th>To Bill</th>
                    <th>Billed</th>
                    <th>Pending</th>
                </tr>
            </thead>
            <tbody>${body}</tbody>
        </table>
    `;
}

function summarizeReceiptStatus(cells) {
    const billedCells = cells.filter((cell) => cell && cell.billed);
    if (!billedCells.length) return 'not_billed';
    if (billedCells.every((cell) => cell.receipt_status === 'received')) return 'received';
    if (billedCells.some((cell) => cell.receipt_status === 'received' || cell.receipt_status === 'partial')) return 'partial';
    return 'not_confirmed';
}

function mergeInvoiceGroups(groups) {
    const merged = new Map();
    groups.forEach((group) => {
        const key = String(group?.invoice_ref || group?.invoice_no || group?.invoice_id || '').trim();
        if (!key) return;
        if (!merged.has(key)) {
            merged.set(key, {
                invoice_ref: key,
                invoice_no: group.invoice_no || group.invoice_ref || group.invoice_id || key,
                invoice_id: group.invoice_id || group.invoice_no || key,
                amount_total: 0,
                billing_line_count: 0,
                machine_ids: new Set(),
                contractmain_ids: new Set()
            });
        }
        const target = merged.get(key);
        target.amount_total += Number(group.amount_total || 0);
        target.billing_line_count += Number(group.billing_line_count || 0);
        (group.machine_ids || []).forEach((machineId) => {
            if (String(machineId || '').trim()) target.machine_ids.add(String(machineId).trim());
        });
        (group.contractmain_ids || []).forEach((contractId) => {
            if (String(contractId || '').trim()) target.contractmain_ids.add(String(contractId).trim());
        });
    });
    return Array.from(merged.values())
        .map((group) => ({
            invoice_ref: group.invoice_ref,
            invoice_no: group.invoice_no,
            invoice_id: group.invoice_id,
            amount_total: Number(group.amount_total.toFixed(2)),
            billing_line_count: group.billing_line_count,
            machine_count: group.machine_ids.size,
            contract_count: group.contractmain_ids.size,
            machine_ids: Array.from(group.machine_ids).sort((a, b) => a.localeCompare(b)),
            contractmain_ids: Array.from(group.contractmain_ids).sort((a, b) => a.localeCompare(b))
        }))
        .sort((a, b) => {
            if (b.amount_total !== a.amount_total) return b.amount_total - a.amount_total;
            return String(a.invoice_no || a.invoice_ref).localeCompare(String(b.invoice_no || b.invoice_ref));
        });
}

function mergeReadingGroups(groups) {
    return [...groups]
        .map((group) => ({
            schedule_id: group.schedule_id,
            invoice_num: group.invoice_num,
            task_date: group.task_date,
            machine_id: group.machine_id,
            contractmain_id: group.contractmain_id,
            previous_meter: Number(group.previous_meter || 0),
            present_meter: Number(group.present_meter || 0),
            total_consumed: Number(group.total_consumed || 0),
            pages: Number(group.pages || 0),
            page_rate: Number(group.page_rate || 0),
            succeeding_page_rate: Number(group.succeeding_page_rate || group.page_rate2 || group.page_rate || 0),
            quota_pages: Number(group.quota_pages || 0),
            succeeding_pages: Number(group.succeeding_pages || 0),
            monthly_quota: Number(group.monthly_quota || 0),
            monthly_rate: Number(group.monthly_rate || 0),
            amount_total: Number(group.amount_total || 0),
            net_amount: Number(group.net_amount || 0),
            vat_amount: Number(group.vat_amount || 0),
            with_vat: Boolean(group.with_vat),
            category_id: Number(group.category_id || 0),
            formula: group.formula || 'net_pages_times_page_rate'
        }))
        .sort((a, b) => {
            if (b.amount_total !== a.amount_total) return b.amount_total - a.amount_total;
            return String(a.task_date || '').localeCompare(String(b.task_date || ''));
        });
}

function buildCompanySummaryRows(rows, months) {
    const groups = new Map();
    rows.forEach((row) => {
        const key = String(row.company_id || row.company_name || row.account_name || row.row_id || '').trim();
        if (!key) return;
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                company_id: row.company_id || null,
                company_name: row.company_name || row.account_name || 'Unknown',
                rows: []
            });
        }
        groups.get(key).rows.push(row);
    });

    const inserted = new Set();
    const displayRows = [];
    rows.forEach((row) => {
        const key = String(row.company_id || row.company_name || row.account_name || row.row_id || '').trim();
        const group = groups.get(key);
        const qualifies = group && group.rows.length > 1;

        if (qualifies && !inserted.has(key)) {
            inserted.add(key);
            const summaryMonths = {};
            months.forEach((monthKey) => {
                const childCells = group.rows.map((child) => child.months?.[monthKey] || {});
                const billedCells = childCells.filter((cell) => cell.billed);
                const pendingCount = childCells.filter((cell) => cell.pending).length;
                const mergedGroups = mergeInvoiceGroups(
                    childCells.flatMap((cell) => (Array.isArray(cell.invoice_groups) ? cell.invoice_groups : []))
                );
                const mergedReadingGroups = mergeReadingGroups(
                    childCells.flatMap((cell) => (Array.isArray(cell.reading_groups) ? cell.reading_groups : []))
                );
                const amountTotal = billedCells.reduce((sum, cell) => sum + Number(cell.amount_total || 0), 0);
                const readingAmountTotal = childCells.reduce((sum, cell) => sum + Number(cell.reading_amount_total || 0), 0);
                const displayAmountTotal = amountTotal > 0 ? amountTotal : readingAmountTotal;
                const readingPagesTotal = childCells.reduce((sum, cell) => sum + Number(cell.reading_pages_total || 0), 0);
                const readingTaskCount = childCells.reduce((sum, cell) => sum + Number(cell.reading_task_count || 0), 0);
                const billingLineCount = billedCells.reduce((sum, cell) => sum + Number(cell.billing_line_count || 0), 0);
                const invoiceCount = mergedGroups.length;
                const machineIds = new Set();
                mergedGroups.forEach((groupInvoice) => {
                    (groupInvoice.machine_ids || []).forEach((machineId) => machineIds.add(String(machineId)));
                });
                childCells.forEach((cell, index) => {
                    const machineId = String(group.rows[index]?.machine_id || '').trim();
                    if ((cell.billed || Number(cell.display_amount_total || cell.reading_amount_total || 0) > 0) && machineId) {
                        machineIds.add(machineId);
                    }
                });
                summaryMonths[monthKey] = {
                    month_key: monthKey,
                    month_label: childCells[0]?.month_label || monthKey,
                    month_label_short: childCells[0]?.month_label_short || monthKey,
                    billed: billedCells.length > 0,
                    pending: billedCells.length === 0 && pendingCount > 0,
                    skipped: billedCells.length === 0 && pendingCount > 0,
                    invoice_count: invoiceCount,
                    billing_line_count: billingLineCount,
                    machine_count: machineIds.size || billedCells.length,
                    amount_total: Number(amountTotal.toFixed(2)),
                    display_amount_total: Number(displayAmountTotal.toFixed(2)),
                    reading_amount_total: Number(readingAmountTotal.toFixed(2)),
                    reading_pages_total: readingPagesTotal,
                    reading_task_count: readingTaskCount,
                    billing_task_count: childCells.reduce((sum, cell) => sum + Number(cell.billing_task_count || 0), 0),
                    received_task_count: childCells.reduce((sum, cell) => sum + Number(cell.received_task_count || 0), 0),
                    receipt_status: summarizeReceiptStatus(childCells),
                    billed_basis: amountTotal > 0 && readingAmountTotal > 0
                        ? 'invoice_and_meter'
                        : (amountTotal > 0 ? 'invoice' : (readingAmountTotal > 0 ? 'meter_reading' : 'none')),
                    latest_invoice_date: childCells
                        .map((cell) => cell.latest_invoice_date)
                        .filter(Boolean)
                        .sort()
                        .slice(-1)[0] || null,
                    received_by_names: Array.from(new Set(childCells.flatMap((cell) => cell.received_by_names || []))).sort((a, b) => a.localeCompare(b)),
                    invoice_groups: mergedGroups,
                    reading_groups: mergedReadingGroups,
                    pending_count: pendingCount
                };
            });

            displayRows.push({
                row_id: `summary:${key}`,
                is_summary_row: true,
                company_id: group.company_id,
                company_name: group.company_name,
                account_name: group.company_name,
                branch_name: 'All branches / departments',
                serial_number: '',
                machine_id: '',
                contractmain_id: '',
                machine_label: `${formatCount(group.rows.length)} machine row${group.rows.length === 1 ? '' : 's'}`,
                display_name: `${group.company_name} • company subtotal`,
                reading_day: null,
                months: summaryMonths
            });
        }

        if (qualifies) {
            displayRows.push({ ...row, is_detail_row: true });
            return;
        }
        displayRows.push(row);
    });

    return displayRows;
}

function renderBranchMain(row) {
    if (row.is_summary_row) return escapeHtml(row.branch_name || 'Main');
    const profile = getRowBillingProfile(row);
    const badge = profile?.category_code
        ? `<span class="billing-code-badge" title="${escapeHtml(profile.category_label || profile.category_code)}">${escapeHtml(profile.category_code)}</span>`
        : '';
    return `
        <span class="branch-head">
            <span>${escapeHtml(row.branch_name || 'Main')}</span>
            ${badge}
        </span>
    `;
}

function renderBranchSub(row) {
    if (row.is_summary_row) return 'Search subtotal across loaded machine rows';
    const profile = getRowBillingProfile(row);
    if (profile?.category_label) {
        return `${profile.category_label} • ${row.account_name || row.company_name || ''}`;
    }
    return row.account_name || row.company_name || '';
}

function getBillingRowLookupKey(row) {
    return String(row?.row_id || row?.contractmain_id || row?.machine_id || row?.company_id || '').trim();
}

function parseMachineReadingDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const raw = String(value || '').trim();
    if (!raw) return null;

    const sql = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (sql) {
        const parsed = new Date(`${sql[1]}T${sql[2]}+08:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) {
        const parsed = new Date(`${iso[1]}T00:00:00+08:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getMonthStartDate(monthKey) {
    const parsed = parseMonthInput(monthKey);
    if (!parsed) return null;
    return new Date(parsed.year, parsed.month - 1, 1);
}

function monthKeyFromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return monthInputValue(date);
}

function normalizeNumericIds(values = []) {
    return uniqueNonBlankValues(values)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
}

function sortReadingsNewestFirst(readings = []) {
    return [...readings].sort((left, right) => {
        const leftTime = parseMachineReadingDate(left?.timestmp)?.getTime() || 0;
        const rightTime = parseMachineReadingDate(right?.timestmp)?.getTime() || 0;
        return rightTime - leftTime;
    });
}

function pickPriorMachineReading(row, readings = [], monthKey) {
    const machineId = String(row?.machine_id || '').trim();
    const contractId = String(row?.contractmain_id || '').trim();
    if (!machineId && !contractId) return null;

    const companyId = String(row?.company_id || '').trim();
    const branchId = String(row?.branch_id || '').trim();
    const cutoffDate = getMonthStartDate(monthKey);
    const cutoffTime = cutoffDate?.getTime() || Number.POSITIVE_INFINITY;
    const candidates = readings
        .filter((reading) => {
            const readingMachineId = String(reading?.machine_id || '').trim();
            const readingContractId = String(reading?.current_contract || '').trim();
            const matchesMachine = machineId && readingMachineId === machineId;
            const matchesContract = contractId && readingContractId === contractId;
            if (!matchesMachine && !matchesContract) return false;
            const meterReading = Number(reading?.meter_reading || 0) || 0;
            if (meterReading <= 0) return false;
            const readingDate = parseMachineReadingDate(reading?.timestmp);
            if (!readingDate) return false;
            return readingDate.getTime() < cutoffTime;
        });
    if (!candidates.length) return null;

    const newestFor = (items) => sortReadingsNewestFirst(items)[0] || null;
    const sameContract = contractId
        ? candidates.filter((reading) => String(reading?.current_contract || '').trim() === contractId)
        : [];
    if (sameContract.length) return newestFor(sameContract);

    const sameCompany = companyId
        ? candidates.filter((reading) => String(reading?.current_companyid || '').trim() === companyId)
        : [];
    if (sameCompany.length) {
        const sameBranch = branchId
            ? sameCompany.filter((reading) => String(reading?.current_branchid || '').trim() === branchId)
            : [];
        return newestFor(sameBranch.length ? sameBranch : sameCompany);
    }

    return newestFor(candidates);
}

function buildPriorReadingLookup(reading) {
    const readingDate = parseMachineReadingDate(reading?.timestmp);
    const sourceMonthKey = monthKeyFromDate(readingDate);
    const previousMeter = Number(reading?.meter_reading || 0) || 0;
    const previousMeter2 = Number(reading?.meter_reading2 || 0) || 0;
    return {
        previousMeter,
        previousMeter2,
        taskDate: readingDate ? formatIsoDate(readingDate) : String(reading?.timestmp || '').trim(),
        sourceMonthKey,
        sourceMonthLabel: sourceMonthKey ? formatMonthLabel(sourceMonthKey, sourceMonthKey) : 'Previous reading',
        invoiceRef: String(reading?.invoice_id || '').trim(),
        readingId: String(reading?.id || reading?._docId || '').trim()
    };
}

function getPriorLookupSortValue(lookup) {
    const monthKey = String(lookup?.sourceMonthKey || '').trim();
    if (/^\d{4}-\d{2}$/.test(monthKey)) {
        return Number(monthKey.replace('-', '')) * 100000000;
    }
    const dateRef = asValidDate(lookup?.taskDate);
    return dateRef ? dateRef.getTime() : 0;
}

function mergePriorReadingLookups(primaryLookups, fallbackLookups) {
    const merged = new Map(primaryLookups || []);
    (fallbackLookups || new Map()).forEach((lookup, key) => {
        const current = merged.get(key);
        if (!current || getPriorLookupSortValue(lookup) > getPriorLookupSortValue(current)) {
            merged.set(key, lookup);
        }
    });
    return merged;
}

function buildPriorGroupFromLookup(lookup, row) {
    return {
        schedule_id: `machine-reading:${lookup?.readingId || getBillingRowLookupKey(row)}`,
        invoice_num: lookup?.invoiceRef || null,
        task_date: lookup?.taskDate || '',
        machine_id: String(row?.machine_id || '').trim(),
        contractmain_id: String(row?.contractmain_id || '').trim(),
        previous_meter: 0,
        present_meter: Number(lookup?.previousMeter || 0) || 0,
        previous_meter2: 0,
        present_meter2: Number(lookup?.previousMeter2 || 0) || 0,
        meter_reading2: Number(lookup?.previousMeter2 || 0) || 0,
        month_key: lookup?.sourceMonthKey || '',
        month_label: lookup?.sourceMonthLabel || 'Previous reading',
        pages: 0,
        total_consumed: 0
    };
}

async function loadPriorMachineReadingLookups(rows = [], monthKey) {
    const eligibleRows = rows.filter((row) => row?.machine_id || row?.contractmain_id);
    if (!eligibleRows.length) return new Map();

    const cacheKey = JSON.stringify({
        monthKey,
        rows: eligibleRows.map((row) => [
            String(row?.company_id || '').trim(),
            String(row?.branch_id || '').trim(),
            String(row?.machine_id || '').trim(),
            String(row?.contractmain_id || '').trim()
        ])
    });
    if (priorMachineReadingCache.has(cacheKey)) return priorMachineReadingCache.get(cacheKey);

    const fieldMask = [
        'id',
        'current_contract',
        'current_companyid',
        'current_branchid',
        'machine_id',
        'meter_reading',
        'meter_reading2',
        'timestmp',
        'invoice_id'
    ];
    const machineIds = normalizeNumericIds(eligibleRows.map((row) => row.machine_id));
    const contractIds = normalizeNumericIds(eligibleRows.map((row) => row.contractmain_id));
    const [machineDocs, contractDocs] = await Promise.all([
        queryFirestoreIn('tbl_machinereading', 'machine_id', machineIds, { select: fieldMask, limit: 1000 }),
        queryFirestoreIn('tbl_machinereading', 'current_contract', contractIds, { select: fieldMask, limit: 1000 }).catch((error) => {
            console.warn('Unable to load prior readings by contract.', error);
            return [];
        })
    ]);

    const docsByKey = new Map();
    [...machineDocs, ...contractDocs].forEach((doc) => {
        const key = String(doc?._docId || `${doc?.id || ''}:${doc?.machine_id || ''}:${doc?.timestmp || ''}`).trim();
        if (key && !docsByKey.has(key)) docsByKey.set(key, doc);
    });
    const allReadings = Array.from(docsByKey.values());

    const lookups = new Map();
    eligibleRows.forEach((row) => {
        const picked = pickPriorMachineReading(row, allReadings, monthKey);
        if (!picked) return;
        const key = getBillingRowLookupKey(row);
        if (key) lookups.set(key, buildPriorReadingLookup(picked));
    });

    priorMachineReadingCache.set(cacheKey, lookups);
    return lookups;
}

function pickPriorBillingReading(row, docs = [], monthKey) {
    const contractId = String(row?.contractmain_id || '').trim();
    if (!contractId) return null;
    const candidates = docs
        .filter((doc) => {
            if (String(doc?.contractmain_id || '').trim() !== contractId) return false;
            const presentMeter = Number(doc?.field_present_meter ?? doc?.present_meter ?? 0) || 0;
            if (presentMeter <= 0) return false;
            const docMonthKey = getBillingDocMonthKey(doc);
            return docMonthKey && docMonthKey < monthKey;
        })
        .sort((left, right) => {
            const leftMonth = getBillingDocMonthKey(left);
            const rightMonth = getBillingDocMonthKey(right);
            if (leftMonth !== rightMonth) return String(rightMonth).localeCompare(String(leftMonth));
            return getBillingDocSortValue(right) - getBillingDocSortValue(left);
        });
    return candidates[0] || null;
}

function buildPriorBillingLookup(doc) {
    const docMonthKey = getBillingDocMonthKey(doc);
    const dateRef = asValidDate(doc?.dateprinted || doc?.date_printed || doc?.invdate || doc?.invoice_date || doc?.datex || doc?.due_date);
    return {
        previousMeter: Number(doc?.field_present_meter ?? doc?.present_meter ?? 0) || 0,
        previousMeter2: Number(doc?.field_present_meter2 ?? doc?.present_meter2 ?? 0) || 0,
        taskDate: dateRef ? formatIsoDate(dateRef) : '',
        sourceMonthKey: docMonthKey,
        sourceMonthLabel: docMonthKey ? formatMonthLabel(docMonthKey, docMonthKey) : 'Previous billing',
        invoiceRef: getBillingDocInvoiceRef(doc),
        readingId: String(doc?.id || doc?._docId || '').trim()
    };
}

async function loadPriorBillingReadingLookups(rows = [], monthKey) {
    const eligibleRows = rows.filter((row) => row?.contractmain_id);
    if (!eligibleRows.length) return new Map();

    const cacheKey = JSON.stringify({
        monthKey,
        contracts: eligibleRows.map((row) => String(row?.contractmain_id || '').trim())
    });
    if (priorBillingReadingCache.has(cacheKey)) return priorBillingReadingCache.get(cacheKey);

    const fieldMask = [
        'id',
        'invoice_id',
        'invoiceid',
        'invoiceno',
        'invoice_no',
        'contractmain_id',
        'month',
        'year',
        'due_date',
        'dateprinted',
        'date_printed',
        'invdate',
        'invoice_date',
        'datex',
        'field_previous_meter',
        'field_present_meter',
        'field_previous_meter2',
        'field_present_meter2'
    ];
    const contractIds = normalizeNumericIds(eligibleRows.map((row) => row.contractmain_id));
    const docs = await queryFirestoreIn('tbl_billing', 'contractmain_id', contractIds, { select: fieldMask, limit: 1000 }).catch((error) => {
        console.warn('Unable to load prior billing readings by contract.', error);
        return [];
    });

    const lookups = new Map();
    eligibleRows.forEach((row) => {
        const picked = pickPriorBillingReading(row, docs, monthKey);
        if (!picked) return;
        const key = getBillingRowLookupKey(row);
        if (key) lookups.set(key, buildPriorBillingLookup(picked));
    });

    priorBillingReadingCache.set(cacheKey, lookups);
    return lookups;
}

function collectPriorReadingGroups(row, monthKey) {
    return Object.entries(row?.months || {})
        .filter(([key]) => key < monthKey)
        .flatMap(([key, cell]) => (
            Array.isArray(cell?.reading_groups)
                ? cell.reading_groups.map((group) => ({
                    ...group,
                    month_key: key,
                    month_label: cell.month_label_short || formatMonthLabel(key, key)
                }))
                : []
        ))
        .sort((left, right) => {
            const leftDate = String(left.task_date || left.month_key || '');
            const rightDate = String(right.task_date || right.month_key || '');
            return rightDate.localeCompare(leftDate);
        });
}

function getTargetReadingGroups(row, monthKey) {
    const cell = row?.months?.[monthKey] || {};
    return (Array.isArray(cell.reading_groups) ? cell.reading_groups : [])
        .map((group) => ({
            ...group,
            month_key: monthKey,
            month_label: cell.month_label_short || formatMonthLabel(monthKey, monthKey)
        }))
        .sort((left, right) => {
            if (Number(right.amount_total || 0) !== Number(left.amount_total || 0)) {
                return Number(right.amount_total || 0) - Number(left.amount_total || 0);
            }
            return String(right.task_date || '').localeCompare(String(left.task_date || ''));
        });
}

function getPrimaryTargetReadingGroup(row, monthKey) {
    return getTargetReadingGroups(row, monthKey)[0] || null;
}

function collectPriorInvoiceRefs(row, monthKey) {
    return Object.entries(row?.months || {})
        .filter(([key]) => key <= monthKey)
        .flatMap(([key, cell]) => {
            const invoiceRefs = [];
            (Array.isArray(cell?.invoice_groups) ? cell.invoice_groups : []).forEach((group) => {
                const invoiceRef = String(group?.invoice_no || group?.invoice_ref || group?.invoice_id || '').trim();
                if (invoiceRef) {
                    invoiceRefs.push({
                        invoice_ref: invoiceRef,
                        month_key: key,
                        month_label: cell.month_label_short || formatMonthLabel(key, key)
                    });
                }
            });
            (Array.isArray(cell?.reading_groups) ? cell.reading_groups : []).forEach((group) => {
                const invoiceRef = String(group?.invoice_num || '').trim();
                if (invoiceRef) {
                    invoiceRefs.push({
                        invoice_ref: invoiceRef,
                        month_key: key,
                        month_label: cell.month_label_short || formatMonthLabel(key, key)
                    });
                }
            });
            return invoiceRefs;
        })
        .sort((left, right) => String(right.month_key || '').localeCompare(String(left.month_key || '')));
}

function hasSecondaryRtpRate(profile = {}) {
    return Number(profile.page_rate2 || 0) > 0
        || Number(profile.page_rate_xtra2 || 0) > 0
        || Number(profile.monthly_quota2 || 0) > 0
        || Number(profile.monthly_rate2 || 0) > 0;
}

function getRtpSecondaryProfile(profile = {}) {
    const pageRate = Number(profile.page_rate2 || profile.page_rate_xtra2 || 0) || 0;
    return {
        ...profile,
        page_rate: pageRate || Number(profile.page_rate || 0) || 0,
        monthly_quota: Number(profile.monthly_quota2 || 0) || 0,
        monthly_rate: Number(profile.monthly_rate2 || 0) || 0,
        succeeding_page_rate: Number(profile.page_rate_xtra2 || profile.page_rate2 || pageRate || 0) || pageRate || Number(profile.page_rate || 0) || 0
    };
}

function roundBillingAmount(value) {
    return Number((Number(value || 0) || 0).toFixed(2));
}

function calculateMeterLineEstimate({
    label = 'Meter',
    subtitle = '',
    profile = {},
    previousMeter = 0,
    presentMeter = 0,
    spoilagePercent = DEFAULT_SPOILAGE_RATE * 100,
    forceFixed = false,
    row = null,
    missingMeterMessage = '',
    pendingPresentMessage = ''
} = {}) {
    const previous = Math.max(0, Number(previousMeter || 0) || 0);
    const present = Math.max(0, Number(presentMeter || 0) || 0);
    const pageRate = Number(profile.page_rate || 0) || 0;
    const succeedingRate = getSucceedingPageRate(profile);
    const monthlyQuota = Number(profile.monthly_quota || 0) || 0;
    const monthlyRate = Number(profile.monthly_rate || 0) || 0;
    const withVat = Boolean(profile.with_vat);
    const spoilageRate = Math.max(0, Number(spoilagePercent || 0) || 0) / 100;
    const isFixed = forceFixed || (!isReadingPricing(profile) && monthlyRate > 0);
    let rawPages = 0;
    let spoilagePages = 0;
    let netPages = 0;
    let billedPages = 0;
    let quotaPages = 0;
    let succeedingPages = 0;
    let quotaAmount = 0;
    let succeedingAmount = 0;
    let amountDue = 0;
    let formula = 'not_available';
    let warning = '';

    if (!isFixed) {
        if (missingMeterMessage && previous <= 0 && present <= 0) {
            warning = missingMeterMessage;
            formula = 'missing_prior_meter';
        } else if (present <= 0) {
            warning = pendingPresentMessage || `${label}: enter a present meter reading to include this line in the invoice total.`;
            formula = 'pending_present_meter';
        } else if (pendingPresentMessage && present === previous) {
            warning = pendingPresentMessage;
            formula = 'pending_present_meter';
        } else if (present < previous) {
            warning = `${label}: present reading is lower than the previous reading. Please check the present meter before billing this line.`;
            formula = 'present_lower_than_previous';
        } else {
            rawPages = present - previous;
        }

        if (rawPages > 0) {
            spoilagePages = Math.round(rawPages * spoilageRate);
            netPages = Math.max(0, rawPages - spoilagePages);
            billedPages = monthlyQuota > 0 ? Math.max(netPages, monthlyQuota) : netPages;
            if (billedPages > 0 && pageRate > 0) {
                if (monthlyQuota > 0) {
                    quotaPages = Math.min(billedPages, monthlyQuota);
                    succeedingPages = Math.max(0, netPages - monthlyQuota);
                    quotaAmount = quotaPages * pageRate;
                    succeedingAmount = succeedingPages * succeedingRate;
                    amountDue = quotaAmount + succeedingAmount;
                    formula = succeedingPages > 0
                        ? 'quota_pages_plus_succeeding_rate'
                        : 'quota_floor_after_spoilage';
                } else {
                    quotaPages = billedPages;
                    quotaAmount = billedPages * pageRate;
                    amountDue = quotaAmount;
                    formula = 'net_pages_after_spoilage_x_rate';
                }
            } else if (monthlyRate > 0) {
                amountDue = monthlyRate;
                formula = 'monthly_rate_fallback';
            } else {
                formula = 'missing_rate';
            }
        }
    } else {
        amountDue = monthlyRate;
        formula = 'fixed_monthly_rate';
    }

    amountDue = roundBillingAmount(amountDue);
    quotaAmount = roundBillingAmount(quotaAmount);
    succeedingAmount = roundBillingAmount(succeedingAmount);
    const netAmount = withVat ? roundBillingAmount(amountDue / 1.12) : amountDue;
    const vatAmount = withVat ? roundBillingAmount(amountDue - netAmount) : roundBillingAmount(amountDue * 0.12);

    return {
        label,
        subtitle,
        rowId: row ? String(row.row_id || row.company_id || '').trim() : '',
        companyName: row ? String(row.company_name || row.account_name || '').trim() : '',
        branchName: row ? String(row.branch_name || '').trim() : '',
        machineId: row ? String(row.machine_id || '').trim() : '',
        contractmainId: row ? String(row.contractmain_id || '').trim() : '',
        serialNumber: row ? String(row.serial_number || '').trim() : '',
        previousMeter: previous,
        presentMeter: present,
        rawPages,
        spoilagePercent: Number((spoilageRate * 100).toFixed(2)),
        spoilageRate,
        spoilagePages,
        netPages,
        billedPages,
        quotaPages,
        succeedingPages,
        quotaAmount,
        succeedingAmount,
        succeedingRate,
        pageRate,
        monthlyQuota,
        monthlyRate,
        pages: billedPages,
        amountDue,
        netAmount,
        vatAmount,
        quotaVariance: monthlyQuota > 0 ? netPages - monthlyQuota : null,
        formula,
        warning,
        missingMeterMessage,
        pendingPresentMessage,
        missingMeterSource: Boolean(missingMeterMessage && previous <= 0 && present <= 0)
    };
}

function summarizeBillingLines(lineItems = [], fallbackFormula = 'not_available') {
    const lines = Array.isArray(lineItems) ? lineItems : [];
    const amountDue = roundBillingAmount(lines.reduce((sum, line) => sum + Number(line.amountDue || 0), 0));
    const netAmount = roundBillingAmount(lines.reduce((sum, line) => sum + Number(line.netAmount || 0), 0));
    const vatAmount = roundBillingAmount(lines.reduce((sum, line) => sum + Number(line.vatAmount || 0), 0));
    const rawPages = lines.reduce((sum, line) => sum + Number(line.rawPages || 0), 0);
    const spoilagePages = lines.reduce((sum, line) => sum + Number(line.spoilagePages || 0), 0);
    const netPages = lines.reduce((sum, line) => sum + Number(line.netPages || 0), 0);
    const billedPages = lines.reduce((sum, line) => sum + Number(line.billedPages || 0), 0);
    const quotaPages = lines.reduce((sum, line) => sum + Number(line.quotaPages || 0), 0);
    const succeedingPages = lines.reduce((sum, line) => sum + Number(line.succeedingPages || 0), 0);
    const quotaAmount = roundBillingAmount(lines.reduce((sum, line) => sum + Number(line.quotaAmount || 0), 0));
    const succeedingAmount = roundBillingAmount(lines.reduce((sum, line) => sum + Number(line.succeedingAmount || 0), 0));
    const warnings = lines.map((line) => line.warning).filter(Boolean);
    return {
        lineItems: lines,
        rawPages,
        spoilagePages,
        netPages,
        billedPages,
        quotaPages,
        succeedingPages,
        quotaAmount,
        succeedingAmount,
        succeedingRate: Number(lines[0]?.succeedingRate || 0) || 0,
        pages: billedPages,
        amountDue,
        netAmount,
        vatAmount,
        quotaVariance: null,
        formula: lines.length > 1 ? 'sum_of_billing_lines' : (lines[0]?.formula || fallbackFormula),
        warning: warnings.join(' ')
    };
}

function buildBillingLinesSignature(lineItems = []) {
    return JSON.stringify((Array.isArray(lineItems) ? lineItems : []).map((line) => ({
        label: String(line.label || '').trim(),
        rowId: String(line.rowId || '').trim(),
        previousMeter: Number(line.previousMeter || 0) || 0,
        presentMeter: Number(line.presentMeter || 0) || 0,
        spoilagePercent: Number(line.spoilagePercent || 0) || 0,
        pageRate: Number(line.pageRate || 0) || 0,
        succeedingRate: Number(line.succeedingRate || 0) || 0,
        monthlyQuota: Number(line.monthlyQuota || 0) || 0,
        monthlyRate: Number(line.monthlyRate || 0) || 0,
        amountDue: Number(line.amountDue || 0) || 0
    })));
}

function getGroupedMachineRows(row, monthKey) {
    const companyId = String(row?.company_id || '').trim();
    if (!companyId || !lastPayload?.month_matrix?.rows) return [];
    const rows = lastPayload.month_matrix.rows
        .filter((entry) => (
            entry
            && !entry.is_summary_row
            && String(entry.company_id || '').trim() === companyId
            && getRowBillingProfile(entry)
        ))
        .sort((left, right) => {
            const currentId = String(row.row_id || row.company_id || '');
            if (String(left.row_id || left.company_id || '') === currentId) return -1;
            if (String(right.row_id || right.company_id || '') === currentId) return 1;
            return String(left.branch_name || left.display_name || '').localeCompare(String(right.branch_name || right.display_name || ''));
        });
    const byRowId = new Map();
    rows.forEach((entry) => {
        const key = String(entry.row_id || entry.company_id || entry.contractmain_id || entry.machine_id || '').trim();
        if (!key || byRowId.has(key)) return;
        const cell = entry.months?.[monthKey] || {};
        if (!cell.pending && !Number(cell.reading_amount_total || 0) && !Number(cell.display_amount_total || 0)) return;
        byRowId.set(key, entry);
    });
    return Array.from(byRowId.values());
}

function buildSummaryBillingRow(row, groupedMachineRows) {
    const firstRow = groupedMachineRows[0] || {};
    return {
        ...firstRow,
        row_id: row?.row_id || `summary:${row?.company_id || firstRow.company_id || ''}`,
        is_summary_billing_row: true,
        is_summary_row: false,
        company_id: row?.company_id || firstRow.company_id || '',
        company_name: row?.company_name || firstRow.company_name || '',
        account_name: row?.account_name || row?.company_name || firstRow.account_name || firstRow.company_name || '',
        branch_name: row?.branch_name || 'All branches / departments',
        display_name: cleanPrintCustomerName(row?.company_name || row?.account_name || firstRow.company_name || firstRow.account_name || 'Customer'),
        machine_label: row?.machine_label || `${formatCount(groupedMachineRows.length)} machine rows`,
        months: row?.months || firstRow.months || {}
    };
}

function getBillingExclusionsForContext(row, context) {
    const companyId = String(row?.company_id || context?.row?.company_id || '').trim();
    if (!companyId) return billingExclusionCache.filter(isActiveBillingExclusion);
    return billingExclusionCache
        .filter(isActiveBillingExclusion)
        .filter((exclusion) => String(exclusion.company_id || '').trim() === companyId)
        .sort((left, right) => String(left.branch_name || '').localeCompare(String(right.branch_name || '')));
}

function buildBillingCalculationContext(row, monthKey) {
    if (!row) return null;
    const summaryGroupedRows = row.is_summary_row ? getGroupedMachineRows(row, monthKey) : [];
    const workingRow = row.is_summary_row ? buildSummaryBillingRow(row, summaryGroupedRows) : row;
    const profile = getRowBillingProfile(workingRow) || getRowBillingProfile(summaryGroupedRows[0]);
    if (!profile) return null;

    const targetCell = workingRow.months?.[monthKey] || {};
    const targetReadingGroup = getPrimaryTargetReadingGroup(workingRow, monthKey);
    const latestPriorGroup = collectPriorReadingGroups(workingRow, monthKey)[0] || null;
    const latestInvoice = collectPriorInvoiceRefs(workingRow, monthKey)[0] || null;
    const previousMeter = latestPriorGroup
        ? Number(latestPriorGroup.present_meter || latestPriorGroup.previous_meter || 0) || 0
        : 0;
    const targetPreviousMeter = targetReadingGroup
        ? Number(targetReadingGroup.previous_meter || previousMeter || 0) || 0
        : previousMeter;
    const targetPresentMeter = targetReadingGroup
        ? Number(targetReadingGroup.present_meter || targetReadingGroup.meter_reading || targetPreviousMeter || 0) || 0
        : targetPreviousMeter;

    return {
        row: workingRow,
        sourceSummaryRow: row.is_summary_row ? row : null,
        monthKey,
        targetCell,
        targetReadingGroup,
        monthLabel: targetCell.month_label_short || formatMonthLabel(monthKey, monthKey),
        profile,
        latestPriorGroup,
        latestInvoice,
        previousMeter: targetPreviousMeter,
        presentMeter: targetPresentMeter,
        spoilageRate: DEFAULT_SPOILAGE_RATE,
        isReading: isReadingPricing(profile),
        isFixed: !isReadingPricing(profile) && Number(profile.monthly_rate || 0) > 0,
        hasSecondaryRtp: hasSecondaryRtpRate(profile) || Boolean(targetReadingGroup?.present_meter2 || targetReadingGroup?.meter_reading2),
        groupedMachineRows: summaryGroupedRows.length ? summaryGroupedRows : getGroupedMachineRows(workingRow, monthKey),
        forceGroupedMode: Boolean(row.is_summary_row)
    };
}

function calculateBillingEstimate(context, previousMeterValue, presentMeterValue, spoilageRateValue = context?.spoilageRate) {
    return calculateMeterLineEstimate({
        label: context?.isFixed ? 'Fixed Rate' : 'Single Meter',
        profile: context?.profile || {},
        previousMeter: previousMeterValue,
        presentMeter: presentMeterValue,
        spoilagePercent: Math.max(0, Number(spoilageRateValue || 0) || 0) * 100,
        forceFixed: Boolean(context?.isFixed),
        row: context?.row || null
    });
}

function getBillingModeOptions(context) {
    const options = [];
    if (context?.isReading) options.push({ key: 'single_meter_rtp', label: 'Single Meter RTP' });
    if (context?.isReading && context?.hasSecondaryRtp) options.push({ key: 'multi_meter_rtp', label: 'Multiple Meter RTP' });
    if (context?.isFixed) options.push({ key: 'rtf', label: 'RTF Fixed Rate' });
    if (context?.isReading && (context?.groupedMachineRows || []).length > 1) {
        options.push({ key: 'multi_machine_rtp', label: 'One Invoice, Multiple Machines' });
    }
    if (!options.length) options.push({ key: 'single_meter_rtp', label: 'Single Meter RTP' });
    return options;
}

function getDefaultBillingMode(context) {
    const savedMode = String(context?.savedBillingMode || '').trim();
    const options = getBillingModeOptions(context);
    if (savedMode && options.some((option) => option.key === savedMode)) return savedMode;
    if (context?.forceGroupedMode && options.some((option) => option.key === 'multi_machine_rtp')) return 'multi_machine_rtp';
    if (context?.isFixed) return 'rtf';
    if (context?.hasSecondaryRtp) return 'multi_meter_rtp';
    return options[0]?.key || 'single_meter_rtp';
}

function renderBillingModeTabs(options, activeMode) {
    return `
        <div class="calc-mode-tabs" role="tablist" aria-label="Billing calculation type">
            ${options.map((option) => `
                <button
                    class="calc-mode-tab ${option.key === activeMode ? 'active' : ''}"
                    type="button"
                    role="tab"
                    aria-selected="${option.key === activeMode ? 'true' : 'false'}"
                    data-calc-mode-tab="${escapeHtml(option.key)}"
                >${escapeHtml(option.label)}</button>
            `).join('')}
        </div>
    `;
}

function renderBillingModeSummary() {
    return `
        <section class="calc-panel calc-mode-summary">
            <div>
                <div class="calc-panel-title" id="calcModeSummaryTitle">Billing Computation</div>
                <div class="calc-mode-summary-copy" id="calcModeSummaryCopy">Choose a calculation type and confirm the meter lines.</div>
            </div>
            <div class="calc-mode-total">
                <span>Total Amount Due</span>
                <strong id="calcModeTotalAmountValue">0</strong>
            </div>
        </section>
    `;
}

function renderBillingExclusionEditor() {
    return `
        <section class="calc-panel calc-exclusion-editor hidden" id="calcExclusionEditor">
            <div class="calc-panel-title">Hide Billing Account</div>
            <div class="calc-note calc-note-tight">This only hides the row from active Billing. It does not delete the customer, contract, or machine record.</div>
            <div class="calc-panel-grid calc-contract-grid">
                <div class="calc-field calc-field-span-2">
                    <label>Account</label>
                    <input type="text" id="calcExclusionTargetInput" readonly value="">
                </div>
                <div class="calc-field">
                    <label for="calcExclusionReasonInput">Reason</label>
                    <select id="calcExclusionReasonInput">
                        ${BILLING_EXCLUSION_REASONS.map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`).join('')}
                    </select>
                </div>
                <div class="calc-field">
                    <label for="calcExclusionEffectiveDateInput">Effective Date</label>
                    <input type="date" id="calcExclusionEffectiveDateInput" value="${escapeHtml(formatIsoDate(new Date()))}">
                </div>
                <label class="calc-checkbox-line calc-field-span-2">
                    <input type="checkbox" id="calcExclusionHideFutureInput" checked>
                    <span>Hide from future billing lists</span>
                </label>
                <div class="calc-field calc-field-span-2">
                    <label for="calcExclusionNoteInput">Staff Note</label>
                    <textarea id="calcExclusionNoteInput" rows="3" placeholder="Example: No delivery happened, wrong contract row, or machine transferred."></textarea>
                </div>
            </div>
            <div class="calc-exclusion-actions">
                <button class="btn btn-danger" type="button" id="calcExclusionSaveBtn">Save Hidden Account</button>
                <button class="btn btn-secondary" type="button" id="calcExclusionCancelBtn">Cancel</button>
            </div>
        </section>
    `;
}

function renderSavedBillingExclusions(exclusions = []) {
    const activeExclusions = (Array.isArray(exclusions) ? exclusions : []).filter(isActiveBillingExclusion);
    return `
        <section class="calc-panel calc-exclusion-list">
            <div class="calc-panel-title">Saved Billing Exclusions</div>
            <div class="calc-note calc-note-tight">Hidden accounts stay out of active Billing until restored here.</div>
            ${
                activeExclusions.length
                    ? `
                        <div class="calc-exclusion-items">
                            ${activeExclusions.map((exclusion) => `
                                <article class="calc-exclusion-item">
                                    <div>
                                        <div class="calc-exclusion-title">${escapeHtml(exclusion.branch_name || exclusion.account_name || exclusion.company_name || 'Hidden account')}</div>
                                        <div class="calc-exclusion-meta">
                                            ${escapeHtml([
                                                exclusion.reason,
                                                exclusion.effective_date ? `Effective ${exclusion.effective_date}` : '',
                                                exclusion.contractmain_id ? `Contract ${exclusion.contractmain_id}` : '',
                                                exclusion.machine_label || exclusion.machine_id || exclusion.serial_number || ''
                                            ].filter(Boolean).join(' • '))}
                                        </div>
                                        ${exclusion.staff_note ? `<div class="calc-exclusion-note">${escapeHtml(exclusion.staff_note)}</div>` : ''}
                                    </div>
                                    <button class="btn btn-secondary" type="button" data-calc-exclusion-action="restore" data-doc-id="${escapeHtml(exclusion._docId || '')}">Restore</button>
                                </article>
                            `).join('')}
                        </div>
                    `
                    : '<div class="detail-empty">No hidden billing accounts saved for this customer.</div>'
            }
        </section>
    `;
}

function renderDashboardBillingExclusions() {
    if (!els.billingExclusionsList) return;
    const activeExclusions = billingExclusionCache.filter(isActiveBillingExclusion);
    if (!activeExclusions.length) {
        els.billingExclusionsList.innerHTML = '<div class="detail-empty">No hidden billing accounts saved.</div>';
        return;
    }
    els.billingExclusionsList.innerHTML = activeExclusions
        .sort((left, right) => String(left.company_name || '').localeCompare(String(right.company_name || ''))
            || String(left.branch_name || '').localeCompare(String(right.branch_name || '')))
        .map((exclusion) => `
            <article class="calc-exclusion-item">
                <div>
                    <div class="calc-exclusion-title">${escapeHtml(exclusion.company_name || 'Hidden account')} ${exclusion.branch_name ? `- ${escapeHtml(exclusion.branch_name)}` : ''}</div>
                    <div class="calc-exclusion-meta">
                        ${escapeHtml([
                            exclusion.reason,
                            exclusion.effective_date ? `Effective ${exclusion.effective_date}` : '',
                            exclusion.contractmain_id ? `Contract ${exclusion.contractmain_id}` : '',
                            exclusion.machine_label || exclusion.machine_id || exclusion.serial_number || ''
                        ].filter(Boolean).join(' • '))}
                    </div>
                    ${exclusion.staff_note ? `<div class="calc-exclusion-note">${escapeHtml(exclusion.staff_note)}</div>` : ''}
                </div>
                <button class="btn btn-secondary" type="button" data-billing-exclusion-restore="${escapeHtml(exclusion._docId || '')}">Restore</button>
            </article>
        `).join('');
}

function renderMeterLineCard(line, mode, index) {
    const prefix = `${mode}-${index}`;
    const canHideLine = mode === 'multi_machine_rtp';
    return `
        <article class="calc-meter-line" data-calc-line-card="${escapeHtml(mode)}" data-calc-line-index="${escapeHtml(String(index))}">
            <div class="calc-meter-line-head">
                <div>
                    <div class="calc-meter-line-title">${escapeHtml(line.label || `Line ${index + 1}`)}</div>
                    <div class="calc-meter-line-sub">${escapeHtml(line.subtitle || line.serialNumber || '')}</div>
                </div>
                <div class="calc-meter-line-amount" id="${escapeHtml(prefix)}-amount">${escapeHtml(formatAmount(line.amountDue || 0))}</div>
            </div>
            ${canHideLine ? `
                <div class="calc-meter-line-actions">
                    <button class="btn btn-secondary btn-small" type="button" data-calc-exclusion-action="open" data-calc-line-index="${escapeHtml(String(index))}">
                        ${escapeHtml(line.missingMeterSource ? 'Mark inactive / no delivery' : 'Hide account')}
                    </button>
                </div>
            ` : ''}
            <div class="calc-panel-grid calc-meter-line-grid">
                <div class="calc-field">
                    <label>Present Reading</label>
                    <input type="number" min="0" step="1" value="${escapeHtml(String(line.presentMeter || 0))}" data-calc-line-mode="${escapeHtml(mode)}" data-calc-line-index="${escapeHtml(String(index))}" data-calc-line-field="presentMeter">
                </div>
                <div class="calc-field">
                    <label>Previous Reading</label>
                    <input type="number" min="0" step="1" value="${escapeHtml(String(line.previousMeter || 0))}" data-calc-line-mode="${escapeHtml(mode)}" data-calc-line-index="${escapeHtml(String(index))}" data-calc-line-field="previousMeter">
                </div>
                <div class="calc-field">
                    <label>Spoilage %</label>
                    <input type="number" min="0" step="0.01" value="${escapeHtml(String(line.spoilagePercent ?? (DEFAULT_SPOILAGE_RATE * 100)))}" data-calc-line-mode="${escapeHtml(mode)}" data-calc-line-index="${escapeHtml(String(index))}" data-calc-line-field="spoilagePercent">
                </div>
                <div class="calc-field">
                    <label>Quota</label>
                    <input type="number" min="0" step="1" value="${escapeHtml(String(line.monthlyQuota || 0))}" data-calc-line-mode="${escapeHtml(mode)}" data-calc-line-index="${escapeHtml(String(index))}" data-calc-line-field="monthlyQuota">
                </div>
                <div class="calc-field">
                    <label>Page Rate</label>
                    <input type="number" min="0" step="0.01" value="${escapeHtml(String(line.pageRate || 0))}" data-calc-line-mode="${escapeHtml(mode)}" data-calc-line-index="${escapeHtml(String(index))}" data-calc-line-field="pageRate">
                </div>
                <div class="calc-field">
                    <label>Exceed Rate</label>
                    <input type="number" min="0" step="0.01" value="${escapeHtml(String(line.succeedingRate || line.pageRate || 0))}" data-calc-line-mode="${escapeHtml(mode)}" data-calc-line-index="${escapeHtml(String(index))}" data-calc-line-field="succeedingRate">
                </div>
            </div>
            <div class="calc-meter-line-math ${line.warning ? 'error' : ''}" id="${escapeHtml(prefix)}-math">${escapeHtml(formatLineComputation(line))}</div>
        </article>
    `;
}

function renderBillingLinePanel(mode, title, copy, lines) {
    return `
        <section class="calc-panel calc-line-panel hidden" data-calc-mode-panel="${escapeHtml(mode)}">
            <div class="calc-panel-title">${escapeHtml(title)}</div>
            <div class="calc-note calc-note-tight">${escapeHtml(copy)}</div>
            <div class="calc-meter-lines">
                ${lines.map((line, index) => renderMeterLineCard(line, mode, index)).join('')}
            </div>
        </section>
    `;
}

function formatLineComputation(line) {
    if (!line) return '';
    if (line.formula === 'fixed_monthly_rate') {
        return `Fixed monthly rate ${formatAmount(line.monthlyRate || 0)}.`;
    }
    if (line.formula === 'missing_prior_meter') {
        return line.warning || 'No available previous meter reading found yet.';
    }
    if (line.formula === 'pending_present_meter') {
        return line.warning || 'Enter the present reading to include this machine in the invoice total.';
    }
    if (line.formula === 'present_lower_than_previous') {
        return line.warning || 'Present reading is lower than previous reading. Please check the present meter before billing this line.';
    }
    return `${formatCount(line.rawPages || 0)} gross - ${formatCount(line.spoilagePages || 0)} spoilage = ${formatCount(line.netPages || 0)} net. ${formatCount(line.quotaPages || 0)} quota pages x ${formatAmount(line.pageRate || 0)} plus ${formatCount(line.succeedingPages || 0)} succeeding pages x ${formatAmount(line.succeedingRate || 0)} = ${formatAmount(line.amountDue || 0)}.`;
}

function closeBillingCalcModal() {
    billingCalcRequestToken += 1;
    setRtpPrintPayload(null);
    els.billingCalcModal?.classList.add('hidden');
}

async function openBillingCalcModal(rowId, monthKey) {
    const requestedRow = renderedMatrixRows.find((entry) => String(entry.row_id || entry.company_id) === String(rowId))
        || (lastPayload?.month_matrix?.rows || []).find((entry) => String(entry.row_id || entry.company_id) === String(rowId));
    const context = buildBillingCalculationContext(requestedRow, monthKey);
    if (!context) {
        MargaUtils.showToast('No billing profile is available for this row yet.', 'error');
        return;
    }

    const row = context.row;
    const profile = context.profile;
    const latestInvoice = context.latestInvoice;
    const printContractCode = String(profile.category_code || '').trim().toUpperCase();
    const canPrintInvoice = isPrintableContractCode(printContractCode);
    const requestToken = ++billingCalcRequestToken;

    if (canPrintInvoice) {
        try {
            await ensureRtpPrintTemplatesReady();
        } catch (error) {
            console.warn('Unable to prepare Firebase invoice print templates.', error);
        }
        if (requestToken !== billingCalcRequestToken) return;
    }

    let existingBillingDocs = [];
    try {
        existingBillingDocs = await queryBillingDocsByContractMonth(row?.contractmain_id, monthKey);
    } catch (error) {
        console.warn('Unable to load saved billing docs for the calculator modal.', error);
    }
    if (requestToken !== billingCalcRequestToken) return;

    const savedBillingDoc = pickPrimaryBillingDoc(existingBillingDocs);
    let priorMachineReadingByRow = new Map();
    let rowPriorLookup = null;
    if (context.isReading) {
        const prefillRows = (context.groupedMachineRows || []).length ? context.groupedMachineRows : [row];
        try {
            const [machineReadingLookups, billingReadingLookups] = await Promise.all([
                loadPriorMachineReadingLookups(prefillRows, monthKey),
                loadPriorBillingReadingLookups(prefillRows, monthKey)
            ]);
            priorMachineReadingByRow = mergePriorReadingLookups(machineReadingLookups, billingReadingLookups);
        } catch (error) {
            console.warn('Unable to load prior machine readings for the calculator modal.', error);
        }
        if (requestToken !== billingCalcRequestToken) return;

        rowPriorLookup = priorMachineReadingByRow.get(getBillingRowLookupKey(row)) || null;
        if (!savedBillingDoc && rowPriorLookup && !context.targetReadingGroup) {
            context.latestPriorGroup = context.latestPriorGroup || buildPriorGroupFromLookup(rowPriorLookup, row);
        }
        if (!savedBillingDoc && rowPriorLookup && !context.targetReadingGroup && Number(context.previousMeter || 0) <= 0) {
            context.previousMeter = Number(rowPriorLookup.previousMeter || 0) || 0;
            context.presentMeter = context.previousMeter;
            if (Number(rowPriorLookup.previousMeter2 || 0) > 0) {
                context.hasSecondaryRtp = true;
            }
        }
    }
    const latest = context.latestPriorGroup;
    const initialSnapshot = savedBillingDoc
        ? billingSnapshotFromDoc(savedBillingDoc, {
            invoiceNo: '',
            previousMeter: context.previousMeter,
            presentMeter: context.presentMeter,
            spoilagePercent: (context.spoilageRate || 0) * 100
        })
        : billingSnapshotFromValues({
            invoiceNo: '',
            previousMeter: context.previousMeter,
            presentMeter: context.presentMeter,
            spoilagePercent: (context.spoilageRate || 0) * 100
        });
    const estimate = calculateBillingEstimate(
        context,
        initialSnapshot.previousMeter,
        initialSnapshot.presentMeter,
        initialSnapshot.spoilagePercent / 100
    );
    estimate.lineItems = [estimate];

    context.savedBillingMode = savedBillingDoc?.billing_mode || '';
    const billingModeOptions = getBillingModeOptions(context);
    let activeBillingMode = getDefaultBillingMode(context);
    const secondaryProfile = getRtpSecondaryProfile(profile);
    const savedLineItems = savedBillingDoc ? parseBillingDocLineItems(savedBillingDoc) : [];
    const savedSecondaryLine = savedLineItems.find((line) => String(line?.label || '').toLowerCase().includes('color'))
        || (String(savedBillingDoc?.billing_mode || '').trim() === 'multi_meter_rtp' ? savedLineItems[1] : null)
        || null;
    const priorSecondaryGroup = context.latestPriorGroup || (rowPriorLookup ? buildPriorGroupFromLookup(rowPriorLookup, row) : null);
    const secondaryPreviousMeter = firstPositiveNumber(
        savedSecondaryLine?.previousMeter,
        context.targetReadingGroup?.previous_meter2,
        context.targetReadingGroup?.previous_meter_color,
        priorSecondaryGroup?.present_meter2,
        priorSecondaryGroup?.meter_reading2,
        rowPriorLookup?.previousMeter2
    );
    const secondaryPresentMeter = firstPositiveNumber(
        savedSecondaryLine?.presentMeter,
        context.targetReadingGroup?.present_meter2,
        context.targetReadingGroup?.meter_reading2,
        context.targetReadingGroup?.present_meter_color,
        secondaryPreviousMeter
    );
    const multiMeterSeedLines = [
        calculateMeterLineEstimate({
            label: 'Black / White',
            profile,
            previousMeter: initialSnapshot.previousMeter,
            presentMeter: initialSnapshot.presentMeter,
            spoilagePercent: initialSnapshot.spoilagePercent,
            row
        }),
        calculateMeterLineEstimate({
            label: 'Colored',
            profile: secondaryProfile,
            previousMeter: secondaryPreviousMeter,
            presentMeter: secondaryPresentMeter,
            spoilagePercent: initialSnapshot.spoilagePercent,
            row
        })
    ];
    const groupedRowsForBilling = context.groupedMachineRows || [];
    const multiMachineSeedLines = groupedRowsForBilling.map((machineRow) => {
        const machineProfile = getRowBillingProfile(machineRow) || profile;
        const group = getPrimaryTargetReadingGroup(machineRow, monthKey);
        const prior = collectPriorReadingGroups(machineRow, monthKey)[0] || null;
        const lookup = priorMachineReadingByRow.get(getBillingRowLookupKey(machineRow));
        const previousMeter = Number(group?.previous_meter || prior?.present_meter || prior?.previous_meter || lookup?.previousMeter || 0) || 0;
        const presentMeter = Number(group?.present_meter || group?.meter_reading || previousMeter || 0) || 0;
        const meterSourceLabel = lookup?.sourceMonthLabel || prior?.month_label || group?.month_label || '';
        const hasMeterSource = Boolean(group || prior || lookup || previousMeter > 0 || presentMeter > 0);
        const missingMeterMessage = hasMeterSource
            ? ''
            : 'No available previous meter reading found. Check first delivery/beginning meter or mark inactive if no delivery happened.';
        const pendingPresentMessage = hasMeterSource && !group
            ? 'Enter present reading to include this machine in the invoice total.'
            : '';
        return calculateMeterLineEstimate({
            label: machineRow.branch_name || machineRow.serial_number || machineRow.machine_label || 'Machine',
            subtitle: `${machineRow.machine_label || machineRow.serial_number || 'No machine serial'}${meterSourceLabel ? ` • last meter ${meterSourceLabel}` : ''}`,
            profile: machineProfile,
            previousMeter,
            presentMeter,
            spoilagePercent: initialSnapshot.spoilagePercent,
            row: machineRow,
            missingMeterMessage,
            pendingPresentMessage
        });
    });
    const companyName = row.display_name || row.account_name || row.company_name || 'Unknown Customer';
    const branchName = row.branch_name || 'Main';
    const machineModel = row.machine_label || 'N/A';
    const serialNumber = row.serial_number || 'N/A';
    const presentReadingDate = context.targetCell?.task_date
        ? formatUsDate(asValidDate(context.targetCell.task_date))
        : context.monthLabel;
    const previousReadingDate = latest?.task_date
        ? formatUsDate(asValidDate(latest.task_date))
        : 'Not recorded';
    const latestMonthUsed = latest ? (latest.month_label || latest.month_key || 'Previous month') : 'No prior reading';
    const savedMonthLabel = context.targetCell?.month_label_short || context.monthLabel;
    const savedExclusionsForContext = getBillingExclusionsForContext(row, context);

    els.billingCalcTitle.textContent = `${row.display_name || row.account_name || row.company_name || 'Billing Calculation'}`;
    els.billingCalcSubtitle.textContent = `${context.monthLabel} • ${profile.category_code || 'N/A'} • ${profile.category_label || 'Billing profile'}`;
    setRtpPrintPayload(null);
    if (els.billingCalcPrintBtn) {
        els.billingCalcPrintBtn.textContent = `Print ${printContractCode || 'Invoice'}`;
        els.billingCalcPrintBtn.classList.toggle('hidden', !canPrintInvoice);
        els.billingCalcPrintBtn.disabled = true;
    }

    els.billingCalcContent.innerHTML = `
        <div class="calc-layout calc-ledger-layout">
            <div class="calc-flag-row">
                <span class="calc-flag">${escapeHtml(profile.category_code || 'N/A')} • ${escapeHtml(profile.category_label || 'Unclassified Contract')}</span>
                <span class="calc-flag">${escapeHtml(context.isReading ? 'Meter-Based Billing' : (context.isFixed ? 'Fixed Monthly Billing' : 'Reference Only'))}</span>
                <span class="calc-flag">${escapeHtml(profile.with_vat ? 'VAT Inclusive' : 'VAT Exclusive')}</span>
                <span class="calc-flag">Latest meter context: ${escapeHtml(latestMonthUsed)}</span>
            </div>
            ${renderBillingModeTabs(billingModeOptions, activeBillingMode)}
            ${renderBillingModeSummary()}
            <div class="calc-save-row">
                <div class="calc-save-actions">
                    <button class="btn btn-primary" type="button" id="calcSaveBillingBtn">${savedBillingDoc ? 'Update Billing' : 'Save Billing'}</button>
                    ${savedBillingDoc ? '<button class="btn btn-danger" type="button" id="calcDeleteBillingBtn">Cancel / Replace Billing</button>' : ''}
                </div>
                <div class="calc-save-status" id="calcSaveStatus">${savedBillingDoc ? `Saved in ${escapeHtml(savedMonthLabel)}. Printing stays unlocked while the form matches the saved invoice.` : `Save this billing first so it lands in ${escapeHtml(savedMonthLabel)} and unlocks printing.`}</div>
            </div>
            <div class="calc-ledger-grid">
                <section class="calc-panel calc-panel-wide">
                    <div class="calc-panel-title">Contract Info</div>
                    <div class="calc-panel-grid calc-contract-grid">
                        <div class="calc-field calc-field-span-2">
                            <label>Company Name</label>
                            <input type="text" readonly value="${escapeHtml(companyName)}">
                        </div>
                        <div class="calc-field">
                            <label>Branch</label>
                            <input type="text" readonly value="${escapeHtml(branchName)}">
                        </div>
                        <div class="calc-field">
                            <label>Invoice #</label>
                            <input type="text" id="calcInvoiceInput" value="${escapeHtml(initialSnapshot.invoiceNo || '')}" placeholder="Invoice number">
                        </div>
                        <div class="calc-field">
                            <label>Latest Invoice Used</label>
                            <input type="text" readonly value="${escapeHtml(latestInvoice?.invoice_ref || 'No prior invoice')}">
                        </div>
                        <div class="calc-field">
                            <label>Category</label>
                            <input type="text" readonly value="${escapeHtml(profile.category_code || 'N/A')}">
                        </div>
                        <div class="calc-field">
                            <label>Machine Model</label>
                            <input type="text" readonly value="${escapeHtml(machineModel)}">
                        </div>
                        <div class="calc-field">
                            <label>Machine Serial</label>
                            <input type="text" readonly value="${escapeHtml(serialNumber)}">
                        </div>
                        <div class="calc-field">
                            <label>Contract Rate Plan</label>
                            <input type="text" readonly value="${escapeHtml(context.isFixed ? `Monthly fixed rate ${formatAmount(profile.monthly_rate || 0)}` : formatRtpRatePlan({ quota: profile.monthly_quota, pageRate: profile.page_rate, succeedingRate: getSucceedingPageRate(profile) }))}">
                        </div>
                    </div>
                </section>
                <section class="calc-panel">
                    <div class="calc-panel-title">Billing Details</div>
                    <div class="calc-panel-grid calc-cycle-grid">
                        <div class="calc-field">
                            <label>Reading Month</label>
                            <input type="text" id="calcBillingMonthInput" readonly value="${escapeHtml(context.monthLabel)}">
                        </div>
                        <div class="calc-field">
                            <label>Latest Month Used</label>
                            <input type="text" readonly value="${escapeHtml(latestMonthUsed)}">
                        </div>
                        <div class="calc-field">
                            <label>Present Reading Date</label>
                            <input type="text" readonly value="${escapeHtml(presentReadingDate)}">
                        </div>
                        <div class="calc-field">
                            <label>Previous Reading Date</label>
                            <input type="text" readonly value="${escapeHtml(previousReadingDate)}">
                        </div>
                    </div>
                </section>
            </div>
            <div class="calc-ledger-grid calc-ledger-grid-bottom" data-calc-mode-panel="single_meter_rtp rtf">
                <section class="calc-panel calc-panel-wide">
                    <div class="calc-panel-title">Reading Information</div>
                    <div class="calc-reading-grid">
                        <div class="calc-reading-column">
                            <div class="calc-field">
                                <label for="calcPresentMeterInput">Present Reading</label>
                                <input type="number" id="calcPresentMeterInput" min="0" step="1" value="${escapeHtml(String(initialSnapshot.presentMeter || 0))}">
                            </div>
                            <div class="calc-field">
                                <label for="calcPreviousMeterInput">Previous Reading</label>
                                <input type="number" id="calcPreviousMeterInput" min="0" step="1" value="${escapeHtml(String(initialSnapshot.previousMeter || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>Gross Total Cons.</label>
                                <input type="text" id="calcRawPagesValue" readonly value="${escapeHtml(formatCount(estimate.rawPages || 0))}">
                            </div>
                            <div class="calc-field">
                                <label for="calcSpoilageInput">Spoilage %</label>
                                <input type="number" id="calcSpoilageInput" min="0" step="0.01" value="${escapeHtml(String(initialSnapshot.spoilagePercent || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>Spoilage Pages</label>
                                <input type="text" id="calcSpoilagePagesValue" readonly value="${escapeHtml(formatCount(estimate.spoilagePages || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>Net Consumption</label>
                                <input type="text" id="calcNetPagesValue" readonly value="${escapeHtml(formatCount(estimate.netPages || 0))}">
                            </div>
                        </div>
                        <div class="calc-reading-column">
                            <div class="calc-field">
                                <label>Quota</label>
                                <input type="text" readonly value="${escapeHtml(formatCount(profile.monthly_quota || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>Within Quota Rate</label>
                                <input type="text" readonly value="${escapeHtml(formatAmount(profile.page_rate || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>Succeeding Rate</label>
                                <input type="text" readonly value="${escapeHtml(formatAmount(getSucceedingPageRate(profile)))}">
                            </div>
                            <div class="calc-field">
                                <label>Monthly Rate</label>
                                <input type="text" readonly value="${escapeHtml(formatAmount(profile.monthly_rate || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>Succeeding Pages</label>
                                <input type="text" id="calcSucceedingPagesValue" readonly value="${escapeHtml(formatCount(estimate.succeedingPages || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>Billed Pages</label>
                                <input type="text" id="calcBilledPagesValue" readonly value="${escapeHtml(formatCount(estimate.billedPages || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>VAT Amount</label>
                                <input type="text" id="calcVatValue" readonly value="${escapeHtml(formatAmount(estimate.vatAmount || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>Net Amount</label>
                                <input type="text" id="calcNetValue" readonly value="${escapeHtml(formatAmount(estimate.netAmount || 0))}">
                            </div>
                            <div class="calc-field calc-field-strong">
                                <label>Amount Due</label>
                                <input type="text" id="calcAmountValue" readonly value="${escapeHtml(formatAmount(estimate.amountDue || 0))}">
                            </div>
                        </div>
                    </div>
                    <div class="calc-note calc-note-tight">
                        ${
                            context.isReading
                                ? `This estimate applies spoilage first, bills quota pages at the within-quota rate, then bills pages above quota at the succeeding rate. If no succeeding rate is saved, the within-quota rate is used.`
                                : `This contract is currently treated as a fixed monthly bill. The estimate below uses the saved monthly rate for ${escapeHtml(context.monthLabel)}.`
                        }
                    </div>
                    <div class="calc-warning" id="calcWarningValue">${escapeHtml(estimate.warning || '')}</div>
                </section>
                <section class="calc-panel">
                    <div class="calc-panel-title">Computation Detail</div>
                    <div class="detail-list-block calc-detail-block calc-detail-block-first">
                        <span class="detail-list-label">Formula</span>
                        <div class="detail-list-value" id="calcFormulaValue">${escapeHtml(estimate.formula)}</div>
                    </div>
                    <div class="detail-list-block calc-detail-block">
                        <span class="detail-list-label">Previous Meter Context</span>
                        <div class="detail-list-value" id="calcContextValue">
                            ${
                                latest
                                    ? escapeHtml(`Previous ${formatCount(latest.previous_meter || 0)} • Present ${formatCount(latest.present_meter || 0)} • ${formatCount(latest.pages || latest.total_consumed || 0)} pages`)
                                    : 'No previous meter reading was found in the current 6-month window.'
                            }
                        </div>
                    </div>
                    <div class="detail-list-block calc-detail-block">
                        <span class="detail-list-label">Computation Flow</span>
                        <div class="detail-list-value" id="calcFlowValue">${escapeHtml(
                            context.isReading
                                ? `${formatCount(estimate.rawPages || 0)} raw - ${formatCount(estimate.spoilagePages || 0)} spoilage = ${formatCount(estimate.netPages || 0)} net. ${formatCount(estimate.quotaPages || 0)} quota pages x ${formatAmount(profile.page_rate || 0)} plus ${formatCount(estimate.succeedingPages || 0)} succeeding pages x ${formatAmount(estimate.succeedingRate || 0)} = ${formatAmount(estimate.amountDue || 0)}.`
                                : `Fixed monthly bill uses ${formatAmount(profile.monthly_rate || 0)} for ${context.monthLabel}.`
                        )}</div>
                    </div>
                    <div class="detail-list-block calc-detail-block">
                        <span class="detail-list-label">Quota Reference</span>
                        <div class="detail-list-value" id="calcQuotaValue">${escapeHtml(
                            estimate.quotaVariance === null
                                ? 'No quota saved on this contract.'
                                : `${formatCount(profile.monthly_quota || 0)} quota floor • ${estimate.quotaVariance >= 0 ? '+' : ''}${formatCount(estimate.quotaVariance)} vs net pages`
                        )}</div>
                    </div>
                </section>
            </div>
            ${renderBillingLinePanel('multi_meter_rtp', 'Multiple Meter RTP', 'Use this for color copiers with separate black/white and colored readings, quotas, and rates.', multiMeterSeedLines)}
            ${renderBillingLinePanel('multi_machine_rtp', 'One Invoice, Multiple Machines', 'Use one invoice number, compute each machine line, then sum the invoice total.', multiMachineSeedLines)}
            ${renderBillingExclusionEditor()}
            ${renderSavedBillingExclusions(savedExclusionsForContext)}
            ${
                canPrintInvoice
                    ? `
                        <section class="calc-panel">
                            <div class="calc-panel-title">${escapeHtml(printContractCode)} Print</div>
                            <div class="calc-print-row">
                                <div class="calc-print-buttons">
                                    <button class="btn btn-primary" type="button" id="calcInlinePrintBtn" disabled>Print ${escapeHtml(printContractCode)}</button>
                                    <button class="btn btn-secondary" type="button" id="calcPrintBreakdownBtn" disabled>Print Breakdown</button>
                                    <button class="btn btn-secondary" type="button" id="calcPrintMeterFormBtn" disabled>Print Meter Form</button>
                                </div>
                                <span class="calc-print-hint" id="calcInlinePrintHint">Preparing preview...</span>
                            </div>
                            <div class="calc-print-note">
                                Chrome print preview must have <strong>Headers and footers</strong> turned off in <strong>More settings</strong>, or the browser will add its own top margin and push the header down.
                            </div>
                            ${renderRtpPrintTemplateControls()}
                            <div class="calc-print-calibration">
                                <div class="calc-field">
                                    <label for="calcPrintOrientationInput">Orientation</label>
                                    <select id="calcPrintOrientationInput">
                                        <option value="portrait"${currentRtpPrintCalibration.orientation === 'portrait' ? ' selected' : ''}>Portrait</option>
                                        <option value="landscape"${currentRtpPrintCalibration.orientation === 'landscape' ? ' selected' : ''}>Landscape</option>
                                    </select>
                                </div>
                                <div class="calc-field">
                                    <label for="calcPrintPaperWidthInput">Paper Side A (cm)</label>
                                    <input type="number" id="calcPrintPaperWidthInput" step="0.1" min="10" max="40" value="${escapeHtml(String(currentRtpPrintCalibration.paperWidthCm))}">
                                </div>
                                <div class="calc-field">
                                    <label for="calcPrintPaperHeightInput">Paper Side B (cm)</label>
                                    <input type="number" id="calcPrintPaperHeightInput" step="0.1" min="10" max="40" value="${escapeHtml(String(currentRtpPrintCalibration.paperHeightCm))}">
                                </div>
                                <div class="calc-field">
                                    <label for="calcPrintOffsetXInput">Left Margin (mm)</label>
                                    <input type="number" id="calcPrintOffsetXInput" step="0.5" value="${escapeHtml(String(currentRtpPrintCalibration.offsetXmm))}">
                                </div>
                                <div class="calc-field">
                                    <label for="calcPrintRightMarginInput">Right Margin (mm)</label>
                                    <input type="number" id="calcPrintRightMarginInput" step="0.5" min="0" max="40" value="${escapeHtml(String(currentRtpPrintCalibration.rightMarginMm || 0))}">
                                </div>
                                <div class="calc-field">
                                    <label for="calcPrintOffsetYInput">Top Margin (mm)</label>
                                    <input type="number" id="calcPrintOffsetYInput" step="0.5" value="${escapeHtml(String(currentRtpPrintCalibration.offsetYmm))}">
                                </div>
                                <div class="calc-field">
                                    <label for="calcPrintScaleInput">Scale</label>
                                    <input type="number" id="calcPrintScaleInput" step="0.01" min="0.35" max="0.9" value="${escapeHtml(String(currentRtpPrintCalibration.scale))}">
                                </div>
                                <div class="calc-print-actions">
                                    <button class="btn btn-secondary" type="button" id="calcPrintResetBtn">Reset</button>
                                </div>
                            </div>
                            <div class="detail-section-title">Section Adjustments</div>
                            ${renderRtpSectionCalibrationControls()}
                            <div class="detail-section-title">${escapeHtml(printContractCode)} Print Preview</div>
                            <div id="calcRtpPreviewMount">
                                <div class="detail-empty">Loading printable invoice preview...</div>
                            </div>
                        </section>
                    `
                    : ''
            }
        </div>
    `;

    const invoiceInput = document.getElementById('calcInvoiceInput');
    const saveBillingBtn = document.getElementById('calcSaveBillingBtn');
    const deleteBillingBtn = document.getElementById('calcDeleteBillingBtn');
    const saveStatus = document.getElementById('calcSaveStatus');
    const previousInput = document.getElementById('calcPreviousMeterInput');
    const presentInput = document.getElementById('calcPresentMeterInput');
    const spoilageInput = document.getElementById('calcSpoilageInput');
    const amountValue = document.getElementById('calcAmountValue');
    const rawPagesValue = document.getElementById('calcRawPagesValue');
    const spoilagePagesValue = document.getElementById('calcSpoilagePagesValue');
    const netPagesValue = document.getElementById('calcNetPagesValue');
    const billedPagesValue = document.getElementById('calcBilledPagesValue');
    const succeedingPagesValue = document.getElementById('calcSucceedingPagesValue');
    const netValue = document.getElementById('calcNetValue');
    const vatValue = document.getElementById('calcVatValue');
    const formulaValue = document.getElementById('calcFormulaValue');
    const quotaValue = document.getElementById('calcQuotaValue');
    const flowValue = document.getElementById('calcFlowValue');
    const warningValue = document.getElementById('calcWarningValue');
    const previewMount = document.getElementById('calcRtpPreviewMount');
    const inlinePrintBtn = document.getElementById('calcInlinePrintBtn');
    const printBreakdownBtn = document.getElementById('calcPrintBreakdownBtn');
    const printMeterFormBtn = document.getElementById('calcPrintMeterFormBtn');
    const inlinePrintHint = document.getElementById('calcInlinePrintHint');
    const templateSelect = document.getElementById('calcPrintTemplateSelect');
    const templateNameInput = document.getElementById('calcPrintTemplateNameInput');
    const saveTemplateBtn = document.getElementById('calcPrintSaveTemplateBtn');
    const deleteTemplateBtn = document.getElementById('calcPrintDeleteTemplateBtn');
    const orientationInput = document.getElementById('calcPrintOrientationInput');
    const paperWidthInput = document.getElementById('calcPrintPaperWidthInput');
    const paperHeightInput = document.getElementById('calcPrintPaperHeightInput');
    const offsetXInput = document.getElementById('calcPrintOffsetXInput');
    const rightMarginInput = document.getElementById('calcPrintRightMarginInput');
    const offsetYInput = document.getElementById('calcPrintOffsetYInput');
    const scaleInput = document.getElementById('calcPrintScaleInput');
    const resetPrintBtn = document.getElementById('calcPrintResetBtn');
    const sectionInputs = Array.from(document.querySelectorAll('[data-rtp-section-key][data-rtp-section-field]'));
    const modeTabs = Array.from(document.querySelectorAll('[data-calc-mode-tab]'));
    const modePanels = Array.from(document.querySelectorAll('[data-calc-mode-panel]'));
    const modeSummaryTitle = document.getElementById('calcModeSummaryTitle');
    const modeSummaryCopy = document.getElementById('calcModeSummaryCopy');
    const modeTotalAmountValue = document.getElementById('calcModeTotalAmountValue');
    const exclusionEditor = document.getElementById('calcExclusionEditor');
    const exclusionTargetInput = document.getElementById('calcExclusionTargetInput');
    const exclusionReasonInput = document.getElementById('calcExclusionReasonInput');
    const exclusionEffectiveDateInput = document.getElementById('calcExclusionEffectiveDateInput');
    const exclusionHideFutureInput = document.getElementById('calcExclusionHideFutureInput');
    const exclusionNoteInput = document.getElementById('calcExclusionNoteInput');
    const exclusionSaveBtn = document.getElementById('calcExclusionSaveBtn');
    const exclusionCancelBtn = document.getElementById('calcExclusionCancelBtn');
    let activeEstimate = estimate;
    let previewReady = false;
    let savedSnapshot = savedBillingDoc ? billingSnapshotFromDoc(savedBillingDoc, initialSnapshot) : null;
    let savedDocExists = Boolean(savedBillingDoc);
    let workflowError = '';
    let pendingExclusionLineIndex = -1;
    const lineInputValues = new Map();

    inlinePrintBtn?.addEventListener('click', printCurrentRtpInvoice);
    printBreakdownBtn?.addEventListener('click', () => {
        printBillingAttachment(currentRtpPrintPayload, activeEstimate, 'breakdown');
    });
    printMeterFormBtn?.addEventListener('click', () => {
        printBillingAttachment(currentRtpPrintPayload, activeEstimate, 'meter_form');
    });

    const closeExclusionEditor = () => {
        pendingExclusionLineIndex = -1;
        exclusionEditor?.classList.add('hidden');
    };

    const openExclusionEditor = (index) => {
        const line = multiMachineSeedLines[index];
        const lineRow = groupedRowsForBilling[index];
        if (!line || !lineRow) return;
        pendingExclusionLineIndex = index;
        if (exclusionTargetInput) {
            exclusionTargetInput.value = [
                line.label || lineRow.branch_name || 'Billing account',
                lineRow.contractmain_id ? `Contract ${lineRow.contractmain_id}` : '',
                lineRow.machine_label || lineRow.machine_id || lineRow.serial_number || ''
            ].filter(Boolean).join(' • ');
        }
        if (exclusionReasonInput) {
            exclusionReasonInput.value = line.missingMeterSource ? 'No delivery happened' : 'Branch/customer inactive';
        }
        if (exclusionEffectiveDateInput && !exclusionEffectiveDateInput.value) {
            exclusionEffectiveDateInput.value = formatIsoDate(new Date());
        }
        if (exclusionHideFutureInput) exclusionHideFutureInput.checked = true;
        exclusionEditor?.classList.remove('hidden');
        exclusionEditor?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const getLineInputKey = (mode, index, field) => `${mode}:${index}:${field}`;

    const cacheLineInputValue = (input) => {
        const mode = String(input?.dataset?.calcLineMode || '').trim();
        const index = String(input?.dataset?.calcLineIndex || '').trim();
        const field = String(input?.dataset?.calcLineField || '').trim();
        if (!mode || !index || !field) return;
        lineInputValues.set(getLineInputKey(mode, index, field), Number(input.value || 0) || 0);
    };

    const readLineInputValue = (mode, index, field, fallback = 0) => {
        const cacheKey = getLineInputKey(mode, index, field);
        if (lineInputValues.has(cacheKey)) return lineInputValues.get(cacheKey);
        const selector = `[data-calc-line-mode="${mode}"][data-calc-line-index="${index}"][data-calc-line-field="${field}"]`;
        const card = document.querySelector(`[data-calc-line-card="${mode}"][data-calc-line-index="${index}"]`);
        const scopedInput = card?.querySelector(selector);
        const inputs = Array.from(document.querySelectorAll(selector));
        const visibleInput = inputs.find((entry) => entry.offsetParent !== null);
        const input = scopedInput || visibleInput || inputs[inputs.length - 1] || null;
        const value = input ? Number(input.value || 0) || 0 : fallback;
        lineInputValues.set(cacheKey, value);
        return value;
    };

    const estimateLineFromSeed = (seed, mode, index) => {
        const lineProfile = {
            ...(seed.profile || profile),
            page_rate: readLineInputValue(mode, index, 'pageRate', seed.pageRate),
            succeeding_page_rate: readLineInputValue(mode, index, 'succeedingRate', seed.succeedingRate),
            monthly_quota: readLineInputValue(mode, index, 'monthlyQuota', seed.monthlyQuota),
            monthly_rate: Number(seed.monthlyRate || 0) || 0
        };
        return calculateMeterLineEstimate({
            label: seed.label,
            subtitle: seed.subtitle,
            profile: lineProfile,
            previousMeter: readLineInputValue(mode, index, 'previousMeter', seed.previousMeter),
            presentMeter: readLineInputValue(mode, index, 'presentMeter', seed.presentMeter),
            spoilagePercent: readLineInputValue(mode, index, 'spoilagePercent', seed.spoilagePercent),
            row: seed.row || null,
            missingMeterMessage: seed.missingMeterMessage,
            pendingPresentMessage: seed.pendingPresentMessage
        });
    };

    const updateLineCardDisplay = (mode, index, line) => {
        setElementDisplayValue(document.getElementById(`${mode}-${index}-amount`), formatAmount(line.amountDue || 0));
        const math = document.getElementById(`${mode}-${index}-math`);
        if (math) {
            math.textContent = formatLineComputation(line);
            math.classList.toggle('error', Boolean(line.warning));
        }
    };

    const calculateActiveEstimate = () => {
        if (activeBillingMode === 'multi_meter_rtp') {
            const lines = multiMeterSeedLines.map((seed, index) => estimateLineFromSeed({ ...seed, profile: index === 0 ? profile : secondaryProfile, row }, activeBillingMode, index));
            lines.forEach((line, index) => updateLineCardDisplay(activeBillingMode, index, line));
            const summary = summarizeBillingLines(lines);
            summary.billingMode = activeBillingMode;
            return summary;
        }
        if (activeBillingMode === 'multi_machine_rtp') {
            const lines = multiMachineSeedLines.map((seed, index) => estimateLineFromSeed({
                ...seed,
                profile: getRowBillingProfile(groupedRowsForBilling[index]) || profile,
                row: groupedRowsForBilling[index] || row
            }, activeBillingMode, index));
            lines.forEach((line, index) => updateLineCardDisplay(activeBillingMode, index, line));
            const summary = summarizeBillingLines(lines);
            summary.billingMode = activeBillingMode;
            return summary;
        }
        const next = calculateBillingEstimate(
            { ...context, isFixed: activeBillingMode === 'rtf' ? true : context.isFixed },
            previousInput ? previousInput.value : context.previousMeter,
            presentInput ? presentInput.value : context.presentMeter,
            spoilageInput ? Number(spoilageInput.value || 0) / 100 : context.spoilageRate
        );
        next.billingMode = activeBillingMode;
        next.lineItems = [next];
        return next;
    };

    const syncModeUi = () => {
        modeTabs.forEach((tab) => {
            const isActive = tab.dataset.calcModeTab === activeBillingMode;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        modePanels.forEach((panel) => {
            const panelModes = String(panel.dataset.calcModePanel || '').split(/\s+/);
            panel.classList.toggle('hidden', !panelModes.includes(activeBillingMode));
        });
        const activeOption = billingModeOptions.find((option) => option.key === activeBillingMode);
        if (modeSummaryTitle) modeSummaryTitle.textContent = activeOption?.label || 'Billing Computation';
        if (modeSummaryCopy) {
            if (activeBillingMode === 'multi_meter_rtp') {
                modeSummaryCopy.textContent = 'Black/white and colored meters are computed separately, then summed into one invoice.';
            } else if (activeBillingMode === 'multi_machine_rtp') {
                modeSummaryCopy.textContent = 'Each machine line is computed separately under the same invoice number.';
            } else if (activeBillingMode === 'rtf') {
                modeSummaryCopy.textContent = 'This invoice uses the fixed monthly contract rate.';
            } else {
                modeSummaryCopy.textContent = 'This invoice uses one meter reading, one quota, and one rate plan.';
            }
        }
    };

    const buildCurrentSnapshot = () => {
        const primaryLine = Array.isArray(activeEstimate?.lineItems) ? activeEstimate.lineItems[0] : null;
        return billingSnapshotFromValues({
            invoiceNo: invoiceInput?.value || '',
            previousMeter: primaryLine ? primaryLine.previousMeter : (previousInput?.value || 0),
            presentMeter: primaryLine ? primaryLine.presentMeter : (presentInput?.value || 0),
            spoilagePercent: primaryLine ? primaryLine.spoilagePercent : (spoilageInput?.value || 0),
            billingMode: activeBillingMode,
            linesSignature: buildBillingLinesSignature(activeEstimate?.lineItems || [])
        });
    };

    const syncCalcWorkflowState = () => {
        const currentSnapshot = buildCurrentSnapshot();
        const matchesSaved = savedDocExists && savedSnapshot ? billingSnapshotsEqual(savedSnapshot, currentSnapshot) : false;
        const isDirty = savedDocExists && !matchesSaved;

        if (saveBillingBtn) saveBillingBtn.textContent = savedDocExists ? 'Update Billing' : 'Save Billing';
        if (saveStatus) {
            saveStatus.classList.toggle('error', Boolean(workflowError));
            if (workflowError) {
                saveStatus.textContent = workflowError;
            } else if (!savedDocExists) {
                saveStatus.textContent = `Save this billing first so it lands in ${savedMonthLabel} and unlocks printing.`;
            } else if (isDirty) {
                saveStatus.textContent = `You changed the billing values. Save again to update ${savedMonthLabel} and re-enable printing.`;
            } else {
                saveStatus.textContent = `Saved in ${savedMonthLabel}. The month cell now owns invoice ${currentSnapshot.invoiceNo || 'N/A'} and Print ${printContractCode || 'Invoice'} is ready.`;
            }
        }

        if (!canPrintInvoice) return;
        const printEnabled = previewReady && matchesSaved;
        let printHint = 'Preparing preview...';
        if (previewReady) {
            if (workflowError) {
                printHint = workflowError;
            } else if (!savedDocExists) {
                printHint = `Save billing first to enable Print ${printContractCode || 'Invoice'}.`;
            } else if (isDirty) {
                printHint = `Save your changes first so the printed ${printContractCode || 'invoice'} matches the saved invoice.`;
            } else {
                printHint = 'Ready to print. Turn off Headers and footers in More settings if the browser preview adds extra top space.';
            }
        }
        setCalcInlinePrintState({
            visible: true,
            disabled: !printEnabled,
            hint: printHint
        });
        if (els.billingCalcPrintBtn) {
            els.billingCalcPrintBtn.classList.toggle('hidden', !canPrintInvoice);
            els.billingCalcPrintBtn.disabled = !printEnabled;
        }
        if (printBreakdownBtn) printBreakdownBtn.disabled = !printEnabled;
        if (printMeterFormBtn) printMeterFormBtn.disabled = !printEnabled;
    };

    const renderCalcPreview = async (nextEstimate) => {
        if (!canPrintInvoice || !previewMount) return;
        previewReady = false;
        syncCalcWorkflowState();
        try {
            const preview = await buildRtpPreviewPayloadFromCalculation(row, context, nextEstimate);
            if (requestToken !== billingCalcRequestToken) return;
            if (!preview) {
                previewMount.innerHTML = '<div class="detail-empty">This contract does not have a printable invoice preview.</div>';
                setRtpPrintPayload(null);
                previewReady = false;
                if (saveStatus) saveStatus.textContent = 'The print preview is unavailable for this row right now.';
                syncCalcWorkflowState();
                return;
            }
            previewMount.innerHTML = buildRtpCalibratedPreviewHtml(preview);
            setRtpPrintPayload(preview);
            previewReady = true;
            syncCalcWorkflowState();
        } catch (error) {
            console.warn('Unable to build calculator print preview.', error);
            if (requestToken !== billingCalcRequestToken) return;
            previewMount.innerHTML = '<div class="detail-empty">The printable invoice preview could not load the extra customer data right now.</div>';
            setRtpPrintPayload(null);
            previewReady = false;
            if (saveStatus) saveStatus.textContent = 'The print preview failed to load. Save is still available.';
            syncCalcWorkflowState();
        }
    };

    const syncCalibrationInputs = (calibration) => {
        if (templateSelect) {
            templateSelect.innerHTML = Object.keys(currentRtpPrintTemplates)
                .sort((left, right) => left.localeCompare(right))
                .map((templateName) => `<option value="${escapeHtml(templateName)}"${templateName === currentRtpPrintTemplateName ? ' selected' : ''}>${escapeHtml(templateName)}</option>`)
                .join('');
        }
        if (templateNameInput) templateNameInput.value = currentRtpPrintTemplateName;
        if (deleteTemplateBtn) deleteTemplateBtn.disabled = currentRtpPrintTemplateName === 'Default';
        if (orientationInput) orientationInput.value = calibration.orientation || 'portrait';
        if (paperWidthInput) paperWidthInput.value = String(calibration.paperWidthCm);
        if (paperHeightInput) paperHeightInput.value = String(calibration.paperHeightCm);
        if (offsetXInput) offsetXInput.value = String(calibration.offsetXmm);
        if (rightMarginInput) rightMarginInput.value = String(calibration.rightMarginMm || 0);
        if (offsetYInput) offsetYInput.value = String(calibration.offsetYmm);
        if (scaleInput) scaleInput.value = String(calibration.scale);
        sectionInputs.forEach((input) => {
            const sectionKey = input.dataset.rtpSectionKey;
            const field = input.dataset.rtpSectionField;
            if (!sectionKey || !field) return;
            const value = calibration.sections?.[sectionKey]?.[field];
            if (value !== undefined) input.value = String(value);
        });
    };

    const updateCalibration = () => {
        const nextSections = Object.fromEntries(Object.keys(RTP_PRINT_SECTION_LAYOUT).map((sectionKey) => {
            const defaults = currentRtpPrintCalibration.sections?.[sectionKey] || RTP_PRINT_CALIBRATION.sections[sectionKey];
            const sectionValues = { ...defaults };
            sectionInputs
                .filter((input) => input.dataset.rtpSectionKey === sectionKey)
                .forEach((input) => {
                    const field = input.dataset.rtpSectionField;
                    if (!field) return;
                    sectionValues[field] = Number(input.value || 0);
                });
            return [sectionKey, sectionValues];
        }));
        const calibration = saveRtpPrintCalibration({
            orientation: orientationInput ? orientationInput.value : currentRtpPrintCalibration.orientation,
            paperWidthCm: paperWidthInput ? Number(paperWidthInput.value || 0) : currentRtpPrintCalibration.paperWidthCm,
            paperHeightCm: paperHeightInput ? Number(paperHeightInput.value || 0) : currentRtpPrintCalibration.paperHeightCm,
            offsetXmm: offsetXInput ? Number(offsetXInput.value || 0) : currentRtpPrintCalibration.offsetXmm,
            rightMarginMm: rightMarginInput ? Number(rightMarginInput.value || 0) : currentRtpPrintCalibration.rightMarginMm,
            offsetYmm: offsetYInput ? Number(offsetYInput.value || 0) : currentRtpPrintCalibration.offsetYmm,
            scale: scaleInput ? Number(scaleInput.value || 0) : currentRtpPrintCalibration.scale,
            sections: nextSections
        });
        syncCalibrationInputs(calibration);
        renderCalcPreview(activeEstimate);
    };

    const recompute = () => {
        const next = calculateActiveEstimate();
        setElementDisplayValue(amountValue, formatAmount(next.amountDue || 0));
        setElementDisplayValue(rawPagesValue, formatCount(next.rawPages || 0));
        setElementDisplayValue(spoilagePagesValue, formatCount(next.spoilagePages || 0));
        setElementDisplayValue(netPagesValue, formatCount(next.netPages || 0));
        setElementDisplayValue(billedPagesValue, formatCount(next.billedPages || 0));
        setElementDisplayValue(succeedingPagesValue, formatCount(next.succeedingPages || 0));
        setElementDisplayValue(netValue, formatAmount(next.netAmount || 0));
        setElementDisplayValue(vatValue, formatAmount(next.vatAmount || 0));
        setElementDisplayValue(modeTotalAmountValue, formatAmount(next.amountDue || 0));
        if (formulaValue) formulaValue.textContent = next.formula;
        if (quotaValue) {
            quotaValue.textContent = next.quotaVariance === null
                ? (next.lineItems?.length > 1 ? `${formatCount(next.lineItems.length)} billing lines summed.` : 'No quota saved on this contract.')
                : `${formatCount(profile.monthly_quota || 0)} quota floor • ${next.quotaVariance >= 0 ? '+' : ''}${formatCount(next.quotaVariance)} vs net pages`;
        }
        if (flowValue) {
            flowValue.textContent = next.lineItems?.length > 1
                ? next.lineItems.map((line) => `${line.label}: ${formatAmount(line.amountDue || 0)}`).join(' • ')
                : context.isReading
                ? `${formatCount(next.rawPages || 0)} raw - ${formatCount(next.spoilagePages || 0)} spoilage = ${formatCount(next.netPages || 0)} net. ${formatCount(next.quotaPages || 0)} quota pages x ${formatAmount(profile.page_rate || 0)} plus ${formatCount(next.succeedingPages || 0)} succeeding pages x ${formatAmount(next.succeedingRate || 0)} = ${formatAmount(next.amountDue || 0)}.`
                : `Fixed monthly bill uses ${formatAmount(profile.monthly_rate || 0)} for ${context.monthLabel}.`;
        }
        if (warningValue) warningValue.textContent = next.warning || '';
        activeEstimate = next;
        renderCalcPreview(activeEstimate);
        syncCalcWorkflowState();
    };

    syncModeUi();
    recompute();
    if (canPrintInvoice) syncCalcWorkflowState();

    invoiceInput?.addEventListener('input', () => {
        workflowError = '';
        invoiceInput.classList.remove('input-error');
        syncCalcWorkflowState();
    });
    previousInput?.addEventListener('input', recompute);
    presentInput?.addEventListener('input', recompute);
    spoilageInput?.addEventListener('input', recompute);
    modeTabs.forEach((tab) => tab.addEventListener('click', () => {
        activeBillingMode = tab.dataset.calcModeTab || activeBillingMode;
        syncModeUi();
        recompute();
    }));
    document.querySelectorAll('[data-calc-line-mode][data-calc-line-index][data-calc-line-field]').forEach((input) => {
        cacheLineInputValue(input);
        input.addEventListener('input', () => {
            cacheLineInputValue(input);
            recompute();
        });
        input.addEventListener('change', () => {
            cacheLineInputValue(input);
            recompute();
        });
    });
    document.querySelectorAll('[data-calc-exclusion-action="open"]').forEach((button) => {
        button.addEventListener('click', () => {
            openExclusionEditor(Number(button.dataset.calcLineIndex || -1));
        });
    });
    document.querySelectorAll('[data-calc-exclusion-action="restore"]').forEach((button) => {
        button.addEventListener('click', async () => {
            const docId = String(button.dataset.docId || '').trim();
            if (!docId) return;
            const confirmed = window.confirm('Restore this account to active billing lists?');
            if (!confirmed) return;
            button.disabled = true;
            try {
                const result = await restoreBillingExclusion(docId);
                MargaUtils.showToast(
                    result.queued ? 'Billing account restore queued.' : 'Billing account restored.',
                    'success'
                );
                closeBillingCalcModal();
                await loadDashboard({ forceRefresh: true });
            } catch (error) {
                button.disabled = false;
                MargaUtils.showToast(String(error?.message || 'Unable to restore billing account.'), 'error');
            }
        });
    });
    exclusionCancelBtn?.addEventListener('click', closeExclusionEditor);
    exclusionSaveBtn?.addEventListener('click', async () => {
        const lineRow = groupedRowsForBilling[pendingExclusionLineIndex];
        if (!lineRow) {
            MargaUtils.showToast('Choose a billing line to hide first.', 'error');
            return;
        }
        exclusionSaveBtn.disabled = true;
        if (exclusionCancelBtn) exclusionCancelBtn.disabled = true;
        try {
            const result = await saveBillingExclusion(lineRow, {
                reason: exclusionReasonInput?.value || 'Other',
                effectiveDate: exclusionEffectiveDateInput?.value || formatIsoDate(new Date()),
                staffNote: exclusionNoteInput?.value || '',
                hideFromFuture: exclusionHideFutureInput?.checked !== false
            });
            MargaUtils.showToast(
                result.queued ? 'Billing account hide queued.' : 'Billing account hidden from active Billing.',
                'success'
            );
            closeBillingCalcModal();
            await loadDashboard({ forceRefresh: true });
        } catch (error) {
            MargaUtils.showToast(String(error?.message || 'Unable to hide billing account.'), 'error');
            exclusionSaveBtn.disabled = false;
            if (exclusionCancelBtn) exclusionCancelBtn.disabled = false;
        }
    });
    paperWidthInput?.addEventListener('input', updateCalibration);
    paperHeightInput?.addEventListener('input', updateCalibration);
    orientationInput?.addEventListener('change', updateCalibration);
    offsetXInput?.addEventListener('input', updateCalibration);
    rightMarginInput?.addEventListener('input', updateCalibration);
    offsetYInput?.addEventListener('input', updateCalibration);
    scaleInput?.addEventListener('input', updateCalibration);
    sectionInputs.forEach((input) => input.addEventListener('input', updateCalibration));
    templateSelect?.addEventListener('change', () => {
        const calibration = applyRtpPrintTemplate(templateSelect.value);
        syncCalibrationInputs(calibration);
        renderCalcPreview(activeEstimate);
    });
    saveTemplateBtn?.addEventListener('click', async () => {
        const templateName = normalizeRtpPrintTemplateName(templateNameInput?.value || currentRtpPrintTemplateName);
        if (saveTemplateBtn) saveTemplateBtn.disabled = true;
        try {
            saveCurrentRtpPrintTemplate(templateName);
            syncCalibrationInputs(currentRtpPrintCalibration);
            renderCalcPreview(activeEstimate);
            const result = await saveRtpPrintTemplatesToFirestore();
            MargaUtils.showToast(result?.queued
                ? `Queued invoice template for Firebase: ${templateName}`
                : `Saved invoice template to Firebase: ${templateName}`, 'success');
        } catch (error) {
            console.error('Unable to save invoice print template to Firebase.', error);
            MargaUtils.showToast(error.message || 'Unable to save invoice template to Firebase.', 'error');
        } finally {
            if (saveTemplateBtn) saveTemplateBtn.disabled = false;
        }
    });
    deleteTemplateBtn?.addEventListener('click', async () => {
        if (currentRtpPrintTemplateName === 'Default') return;
        const deletedTemplate = currentRtpPrintTemplateName;
        if (deleteTemplateBtn) deleteTemplateBtn.disabled = true;
        try {
            const calibration = deleteRtpPrintTemplate(deletedTemplate);
            syncCalibrationInputs(calibration);
            renderCalcPreview(activeEstimate);
            const result = await saveRtpPrintTemplatesToFirestore();
            MargaUtils.showToast(result?.queued
                ? `Queued invoice template deletion for Firebase: ${deletedTemplate}`
                : `Deleted invoice template from Firebase: ${deletedTemplate}`, 'success');
        } catch (error) {
            console.error('Unable to delete invoice print template from Firebase.', error);
            MargaUtils.showToast(error.message || 'Unable to delete invoice template from Firebase.', 'error');
            syncCalibrationInputs(currentRtpPrintCalibration);
        }
    });
    resetPrintBtn?.addEventListener('click', () => {
        const calibration = resetRtpPrintCalibration();
        syncCalibrationInputs(calibration);
        renderCalcPreview(activeEstimate);
    });
    saveBillingBtn?.addEventListener('click', async () => {
        activeEstimate = calculateActiveEstimate();
        const currentSnapshot = buildCurrentSnapshot();
        workflowError = '';
        invoiceInput?.classList.remove('input-error');
        saveStatus?.classList.remove('error');
        if (inlinePrintHint) inlinePrintHint.classList.remove('error');
        saveBillingBtn.disabled = true;
        if (deleteBillingBtn) deleteBillingBtn.disabled = true;
        try {
            const result = await saveBillingRecord({
                row,
                context,
                estimate: activeEstimate,
                snapshot: currentSnapshot,
                existingDocs: existingBillingDocs
            });
            savedSnapshot = currentSnapshot;
            savedDocExists = true;
            if (!savedBillingDoc) {
                existingBillingDocs = [{
                    _docId: result.docId,
                    ...result.fields
                }];
            } else {
                existingBillingDocs = [{
                    _docId: result.docId,
                    ...result.fields
                }];
            }
            syncCalcWorkflowState();
            MargaUtils.showToast(
                result.queued
                    ? `Billing ${currentSnapshot.invoiceNo} queued and will sync when you are back online.`
                    : `Billing ${currentSnapshot.invoiceNo} saved to ${savedMonthLabel}.`,
                'success'
            );
            showBillingSaveResult({
                type: 'success',
                title: result.queued ? 'Billing Queued' : 'Billing Saved',
                message: result.queued
                    ? `Invoice ${currentSnapshot.invoiceNo} was queued. Print ${printContractCode || 'Invoice'} is unlocked from this saved form while the app syncs.`
                    : `Invoice ${currentSnapshot.invoiceNo} was saved for ${savedMonthLabel}. Print ${printContractCode || 'Invoice'} is ready.`
            });
            if (!result.queued) {
                loadDashboard({ forceRefresh: true }).catch((error) => {
                    console.warn('Unable to refresh billing dashboard after save.', error);
                    showBillingSaveResult({
                        type: 'error',
                        title: 'Saved, Refresh Failed',
                        message: `Invoice ${currentSnapshot.invoiceNo} saved, but the billing grid did not refresh. Reload the dashboard to see the Apr 26 cell.`
                    });
                });
            }
        } catch (error) {
            workflowError = String(error?.message || 'Unable to save billing.');
            invoiceInput?.classList.add('input-error');
            saveStatus?.classList.add('error');
            if (inlinePrintHint) inlinePrintHint.classList.add('error');
            showBillingSaveResult({
                type: 'error',
                title: 'Billing Not Saved',
                message: workflowError
            });
            MargaUtils.showToast(workflowError, 'error');
        } finally {
            saveBillingBtn.disabled = false;
            if (deleteBillingBtn) deleteBillingBtn.disabled = false;
            syncCalcWorkflowState();
        }
    });
    deleteBillingBtn?.addEventListener('click', async () => {
        const invoiceNo = savedSnapshot?.invoiceNo || buildCurrentSnapshot().invoiceNo;
        const confirmed = window.confirm(`Cancel billing ${invoiceNo || 'for this month'} for replacement? This frees the invoice number after the saved billing record is removed.`);
        if (!confirmed) return;
        deleteBillingBtn.disabled = true;
        if (saveBillingBtn) saveBillingBtn.disabled = true;
        try {
            const result = await deleteBillingRecord({
                row,
                monthKey,
                invoiceNo
            });
            savedSnapshot = null;
            savedDocExists = false;
            existingBillingDocs = [];
            MargaUtils.showToast(
                result.deletedCount
                    ? `Deleted ${result.deletedCount} saved billing record${result.deletedCount === 1 ? '' : 's'} from ${savedMonthLabel}.`
                    : 'No saved billing record was found for this month.',
                'success'
            );
            await loadDashboard({ forceRefresh: true });
            closeBillingCalcModal();
        } catch (error) {
            MargaUtils.showToast(String(error?.message || 'Unable to delete billing.'), 'error');
        } finally {
            deleteBillingBtn.disabled = false;
            if (saveBillingBtn) saveBillingBtn.disabled = false;
        }
    });
    els.billingCalcModal.classList.remove('hidden');
    await renderCalcPreview(activeEstimate);
    syncCalcWorkflowState();
}

function renderMatrixTable(payload) {
    const matrix = payload.month_matrix || {};
    const months = matrix.months || [];
    const rows = matrix.rows || [];
    const totals = matrix.totals || [];
    const payloadSearchTerm = String(payload?.filters?.search || '').trim().toLowerCase();
    const selectedRowId = MargaUtils.getUrlParam('row_id');
    const selectedMonth = MargaUtils.getUrlParam('month');
    const searchTerm = getMatrixSearchTerm();
    const payloadMatchesCurrentSearch = payloadSearchTerm === searchTerm;
    const matchedRowCount = payloadMatchesCurrentSearch
        ? Number(payload?.summary?.matrix_customers_total || rows.length)
        : rows.length;
    const isRowWindowed = matchedRowCount > rows.length;
    const filteredRows = searchTerm
        ? rows.filter((row) => {
              const haystack = [
                  row.serial_number,
                  row.account_name,
                  row.company_name,
                  row.branch_name,
                  row.machine_label,
                  row.machine_id,
                  row.reading_day
              ]
                  .filter(Boolean)
                  .join(' ')
                  .toLowerCase();
              return haystack.includes(searchTerm);
          })
        : rows;
    const sortedRows = [...filteredRows].sort((left, right) => compareBillingRows(left, right, getMatrixSortValue()));
    const rowsWithAmounts = filteredRows.filter((row) => (
        Object.values(row?.months || {}).some((cell) => Number(cell?.display_amount_total || 0) > 0)
    )).length;
    const sortValue = getMatrixSortValue();

    const displayRows = searchTerm ? buildCompanySummaryRows(sortedRows, months) : sortedRows;
    renderedMatrixRows = displayRows;

    if (els.matrixSearchMeta) {
        if (!rows.length) {
            els.matrixSearchMeta.textContent = 'No customers loaded yet.';
        } else if (searchTerm && !payloadMatchesCurrentSearch) {
            els.matrixSearchMeta.textContent = `Filtering ${formatCount(filteredRows.length)} loaded machine rows for "${els.matrixSearchInput.value.trim()}". Full search refresh starts at 2 characters.`;
        } else if (searchTerm) {
            const subtotalCount = displayRows.filter((row) => row.is_summary_row).length;
            const windowText = isRowWindowed
                ? ` Showing first ${formatCount(rows.length)} loaded rows out of ${formatCount(matchedRowCount)} matched rows.`
                : ` Showing all ${formatCount(matchedRowCount)} matched rows.`;
            const subtotalText = subtotalCount
                ? ` ${formatCount(subtotalCount)} company subtotal row${subtotalCount === 1 ? '' : 's'} added.`
                : '';
            const sortText = sortValue === 'customer'
                ? ` ${formatCount(rowsWithAmounts)} row${rowsWithAmounts === 1 ? '' : 's'} already have amounts and are shown first within each customer grouping.`
                : ' Rows follow Reading Day order first.';
            els.matrixSearchMeta.textContent = `Showing ${formatCount(filteredRows.length)} machine rows for "${els.matrixSearchInput.value.trim()}".${sortText}${windowText}${subtotalText} Footer totals reflect all matched rows.`;
        } else {
            els.matrixSearchMeta.textContent = isRowWindowed
                ? `Showing first ${formatCount(rows.length)} loaded machine rows out of ${formatCount(matchedRowCount)} matched rows. Footer totals reflect all matched rows.`
                : `Showing all ${formatCount(matchedRowCount)} matched machine rows. Footer totals reflect all matched rows.`;
        }
    }

    if (!months.length || !rows.length) {
        els.matrixTableWrap.innerHTML = '<div class="empty-panel">No month-to-month billing rows returned.</div>';
        return;
    }

    if (searchTerm && !filteredRows.length) {
        els.matrixTableWrap.innerHTML = `<div class="empty-panel">No billing rows matched "${escapeHtml(els.matrixSearchInput.value.trim())}".</div>`;
        return;
    }

    const header = months.map((monthKey) => {
        const total = totals.find((entry) => entry.month_key === monthKey);
        const label = total?.month_label_short || monthKey;
        return `<th>${escapeHtml(label)}</th>`;
    }).join('');

    const body = displayRows.map((row) => {
        const rowId = row.row_id || row.company_id;
        const trClass = [
            String(rowId) === String(selectedRowId) ? 'selected-row' : '',
            row.is_summary_row ? 'summary-row' : '',
            row.is_detail_row ? 'detail-row' : ''
        ].filter(Boolean).join(' ');
        const monthCells = months.map((monthKey) => {
            const cell = row.months?.[monthKey] || {};
            const isSelected = String(rowId) === String(selectedRowId) && monthKey === selectedMonth;
            const shownAmount = Number(cell.display_amount_total || cell.amount_total || 0);
            const hasReadingBreakdown = Number(cell.reading_amount_total || 0) > 0;
            const hasInvoiceAmount = Number(cell.amount_total || 0) > 0;
            const canOpenCalculator = (!row.is_summary_row && Boolean(getRowBillingProfile(row)))
                || (row.is_summary_row && Number(cell.pending_count || 0) > 0);
            if (cell.billed || shownAmount > 0) {
                const invoiceMeta = `${formatCount(cell.invoice_count || 0)} inv`;
                const machineMeta = `${formatCount(cell.machine_count || 0)} mach`;
                const pendingMeta = row.is_summary_row && Number(cell.pending_count || 0) > 0
                    ? ` • ${formatCount(cell.pending_count || 0)} pending`
                    : '';
                const cellMeta = hasInvoiceAmount
                    ? `${invoiceMeta} • ${machineMeta}${pendingMeta}`
                    : `${formatCount(cell.reading_task_count || 0)} meter form • ${formatCount(cell.reading_pages_total || 0)} pg${pendingMeta}`;
                return `
                    <td class="month-cell billed-cell ${!hasInvoiceAmount && hasReadingBreakdown ? 'meter-cell' : ''} ${isSelected ? 'selected-cell' : ''}" title="${escapeHtml(hasInvoiceAmount ? receiptLabel(cell.receipt_status) : 'Meter reading breakdown amount')}">
                        <button
                            class="billed-link ${row.is_summary_row ? 'summary-billed-link' : ''}"
                            type="button"
                            data-row-id="${escapeHtml(String(rowId))}"
                            data-month-key="${escapeHtml(monthKey)}"
                            aria-label="Open invoice detail for ${escapeHtml(row.account_name || row.company_name)} ${escapeHtml(monthKey)}"
                        >
                            <span class="amount-value">${escapeHtml(formatAmount(shownAmount))}</span>
                            <span class="cell-meta">${escapeHtml(cellMeta)}</span>
                        </button>
                        ${hasInvoiceAmount ? receiptDot(cell.receipt_status) : ''}
                    </td>
                `;
            }
            if (cell.pending) {
                if (!canOpenCalculator) {
                    return `<td class="month-cell pending-cell ${isSelected ? 'selected-cell' : ''}"></td>`;
                }
                return `
                    <td class="month-cell pending-cell ${isSelected ? 'selected-cell' : ''}">
                        <button
                            class="pending-link calc-link"
                            type="button"
                            data-row-id="${escapeHtml(String(rowId))}"
                            data-month-key="${escapeHtml(monthKey)}"
                            title="${escapeHtml(row.is_summary_row ? 'Open grouped branch billing.' : 'Pending reading or billing. Open billing calculation.')}"
                            aria-label="Open billing calculation for ${escapeHtml(row.account_name || row.company_name)} ${escapeHtml(monthKey)}"
                        ></button>
                    </td>
                `;
            }
            if (canOpenCalculator) {
                return `
                    <td class="month-cell empty-cell ${isSelected ? 'selected-cell' : ''}">
                        <button
                            class="empty-link calc-link"
                            type="button"
                            data-row-id="${escapeHtml(String(rowId))}"
                            data-month-key="${escapeHtml(monthKey)}"
                            title="Open billing calculation for ${escapeHtml(row.account_name || row.company_name)} ${escapeHtml(monthKey)}"
                            aria-label="Open billing calculation for ${escapeHtml(row.account_name || row.company_name)} ${escapeHtml(monthKey)}"
                        ></button>
                    </td>
                `;
            }
            return `<td class="month-cell empty-cell"></td>`;
        }).join('');

        return `
            <tr class="${trClass}">
                <td class="rd-col">${row.is_summary_row ? '' : (row.reading_day ? escapeHtml(String(row.reading_day)) : '-')}</td>
                <td class="sn-col">
                    ${
                        row.is_summary_row
                            ? '<span class="subtotal-pill">Subtotal</span>'
                            : `
                                <button
                                    class="serial-link"
                                    type="button"
                                    data-row-id="${escapeHtml(String(rowId))}"
                                    aria-label="Open serial detail for ${escapeHtml(row.serial_number || row.machine_label || row.machine_id || 'machine')}"
                                >
                                    ${escapeHtml(row.serial_number || 'N/A')}
                                </button>
                            `
                    }
                </td>
                <td class="customer-col">
                    <div class="customer-main">${escapeHtml(row.company_name || row.account_name)}</div>
                    <div class="customer-sub">${escapeHtml(row.is_summary_row ? (row.machine_label || '') : (row.machine_label || row.machine_id || ''))}</div>
                </td>
                <td class="branch-col">
                    <div class="branch-main">${renderBranchMain(row)}</div>
                    <div class="branch-sub">${escapeHtml(renderBranchSub(row))}</div>
                </td>
                ${monthCells}
            </tr>
        `;
    }).join('');

    const footer = months.map((monthKey) => {
        const authoritativeTotal = payloadMatchesCurrentSearch
            ? totals.find((entry) => entry.month_key === monthKey)
            : null;
        const amount = authoritativeTotal
            ? Number(authoritativeTotal.amount_total || 0)
            : filteredRows.reduce((sum, row) => sum + Number(row.months?.[monthKey]?.amount_total || 0), 0);
        const totalTitle = authoritativeTotal
            ? 'Full matched billing total'
            : 'Loaded row subtotal';
        return `<td class="total-cell" title="${escapeHtml(totalTitle)}">${escapeHtml(formatAmount(amount))}</td>`;
    }).join('');

    els.matrixTableWrap.innerHTML = `
        <table class="billing-sheet matrix-sheet">
            <thead>
                <tr>
                    <th class="rd-col">RD</th>
                    <th class="sn-col">SN</th>
                    <th class="customer-col">Customer</th>
                    <th class="branch-col">Branch / Dept</th>
                    ${header}
                </tr>
            </thead>
            <tbody>${body}</tbody>
            <tfoot>
                <tr>
                    <th class="rd-col"></th>
                    <th class="sn-col"></th>
                    <th class="customer-col"></th>
                    <th class="branch-col"></th>
                    ${footer}
                </tr>
            </tfoot>
        </table>
    `;
}

function closeInvoiceDetailModal() {
    invoiceDetailRequestToken += 1;
    setRtpPrintPayload(null);
    els.invoiceDetailModal?.classList.add('hidden');
}

function closeSerialDetailModal() {
    els.serialDetailModal?.classList.add('hidden');
}

function openSerialDetailModal(rowId) {
    if (!lastPayload) return;

    const row = renderedMatrixRows.find((entry) => String(entry.row_id || entry.company_id) === String(rowId));
    if (!row || row.is_summary_row) return;

    const openCustomersHref = customerHref(row);
    const latestBilledMonth = row.latest_billed_month || 'Not billed in current window';
    const readingDay = row.reading_day ? `RD ${row.reading_day}` : 'RD -';

    els.serialDetailTitle.textContent = row.serial_number || row.machine_label || 'Serial Detail';
    els.serialDetailSubtitle.textContent = `${row.company_name || row.account_name || 'Unknown'} • ${row.branch_name || 'Main'} • ${readingDay}`;

    els.serialDetailContent.innerHTML = `
        <div class="detail-action-row">
            <a class="detail-action-link" href="${escapeHtml(openCustomersHref)}">Open In Customers</a>
        </div>
        <div class="detail-summary-grid">
            <article class="detail-summary-card">
                <span class="label">Serial Number</span>
                <span class="value">${escapeHtml(row.serial_number || 'N/A')}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Contract ID</span>
                <span class="value">${escapeHtml(row.contractmain_id || 'N/A')}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Machine ID</span>
                <span class="value">${escapeHtml(row.machine_id || 'N/A')}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Latest Billed Month</span>
                <span class="value">${escapeHtml(latestBilledMonth)}</span>
            </article>
        </div>
        <div class="detail-section-title">Billing Context</div>
        <div class="invoice-detail-list">
            <article class="invoice-detail-card">
                <div class="detail-list-block">
                    <span class="detail-list-label">Customer</span>
                    <div class="detail-list-value">${escapeHtml(row.company_name || row.account_name || 'Unknown')}</div>
                </div>
                <div class="detail-list-block">
                    <span class="detail-list-label">Branch / Department</span>
                    <div class="detail-list-value">${escapeHtml(row.branch_name || 'Main')}</div>
                </div>
                <div class="detail-list-block">
                    <span class="detail-list-label">Account Label</span>
                    <div class="detail-list-value">${escapeHtml(row.account_name || row.company_name || 'Unknown')}</div>
                </div>
                <div class="detail-list-block">
                    <span class="detail-list-label">Machine Label</span>
                    <div class="detail-list-value">${escapeHtml(row.machine_label || row.machine_id || 'N/A')}</div>
                </div>
            </article>
        </div>
    `;

    els.serialDetailModal.classList.remove('hidden');
}

async function openInvoiceDetailModal(rowId, monthKey) {
    if (!lastPayload) return;

    const row = renderedMatrixRows.find((entry) => String(entry.row_id || entry.company_id) === String(rowId))
        || (lastPayload.month_matrix?.rows || []).find((entry) => String(entry.row_id || entry.company_id) === String(rowId));
    const cell = row?.months?.[monthKey];
    if (!row || !cell || !(cell.billed || Number(cell.display_amount_total || cell.reading_amount_total || 0) > 0)) return;

    const title = row.display_name || row.account_name || row.company_name || 'Billing Detail';
    const readingDay = row.is_summary_row ? 'Company subtotal' : (row.reading_day ? `RD ${row.reading_day}` : 'RD -');
    const invoiceGroups = Array.isArray(cell.invoice_groups) ? cell.invoice_groups : [];
    const readingGroups = Array.isArray(cell.reading_groups) ? cell.reading_groups : [];
    const shownAmount = Number(cell.display_amount_total || cell.amount_total || cell.reading_amount_total || 0);
    const hasInvoiceAmount = Number(cell.amount_total || 0) > 0;
    const primaryInvoice = invoiceGroups[0] || null;
    const primaryInvoiceRef = String(primaryInvoice?.invoice_no || primaryInvoice?.invoice_ref || primaryInvoice?.invoice_id || '').trim();
    const canManageBilling = hasInvoiceAmount && !row.is_summary_row && Boolean(row?.contractmain_id);
    const requestToken = ++invoiceDetailRequestToken;

    els.invoiceDetailTitle.textContent = title;
    els.invoiceDetailSubtitle.textContent = `${monthKey} • ${readingDay} • ${hasInvoiceAmount ? receiptLabel(cell.receipt_status) : 'Meter breakdown amount'}`;
    els.invoiceDetailContent.innerHTML = '<div class="detail-empty">Loading invoice detail...</div>';
    setRtpPrintPayload(null);
    els.invoiceDetailModal.classList.remove('hidden');

    let rtpPreviewBlock = '';
    if (isPrintableBillingCell(row, cell)) {
        try {
            const preview = await buildRtpPreviewPayload(row, cell, monthKey);
            if (requestToken !== invoiceDetailRequestToken) return;
            if (preview) {
                setRtpPrintPayload(preview);
                const previewCode = String(preview.contractCode || 'Invoice').trim().toUpperCase();
                rtpPreviewBlock = `
                    <div class="detail-section-title">${escapeHtml(previewCode)} Print Preview</div>
                    ${buildRtpPreviewHtml(preview)}
                `;
            }
        } catch (error) {
            console.warn('Unable to build invoice print preview.', error);
            if (requestToken !== invoiceDetailRequestToken) return;
            rtpPreviewBlock = `
                <div class="detail-section-title">Invoice Print Preview</div>
                <div class="detail-empty">The printable invoice preview could not load the extra customer data right now.</div>
            `;
        }
    }

    els.invoiceDetailContent.innerHTML = `
        ${rtpPreviewBlock}
        ${
            canManageBilling
                ? `
                    <div class="detail-action-row">
                        <button class="btn btn-primary" type="button" id="invoiceEditBillingBtn">Edit Billing</button>
                        <button class="btn btn-danger" type="button" id="invoiceDeleteBillingBtn">Cancel / Replace Invoice</button>
                    </div>
                `
                : ''
        }
        <div class="detail-summary-grid">
            <article class="detail-summary-card">
                <span class="label">Shown Amount</span>
                <span class="value">${escapeHtml(formatAmount(shownAmount))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Invoices</span>
                <span class="value">${escapeHtml(formatCount(cell.invoice_count || 0))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Machines</span>
                <span class="value">${escapeHtml(formatCount(cell.machine_count || 0))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Billing Lines</span>
                <span class="value">${escapeHtml(formatCount(cell.billing_line_count || 0))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Meter Breakdown</span>
                <span class="value">${escapeHtml(formatAmount(cell.reading_amount_total || 0))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Net Pages</span>
                <span class="value">${escapeHtml(formatCount(cell.reading_pages_total || 0))}</span>
            </article>
            ${
                row.is_summary_row
                    ? `
                        <article class="detail-summary-card">
                            <span class="label">Pending Machine Rows</span>
                            <span class="value">${escapeHtml(formatCount(cell.pending_count || 0))}</span>
                        </article>
                    `
                    : ''
            }
        </div>
        ${
            !hasInvoiceAmount && Number(cell.reading_amount_total || 0) > 0
                ? `<div class="detail-empty">This row is showing the meter-reading amount for the branch or department. The official invoice may be consolidated under the mother account.</div>`
                : ''
        }
        <div class="detail-section-title">Invoice Breakdown</div>
        ${
            invoiceGroups.length
                ? `
                    <div class="invoice-detail-list">
                        ${invoiceGroups
                            .map(
                                (group) => `
                                    <article class="invoice-detail-card">
                                        <div class="invoice-detail-head">
                                            <div class="invoice-detail-ref">${escapeHtml(group.invoice_no || group.invoice_ref || 'Invoice')}</div>
                                            <div class="invoice-detail-amount">${escapeHtml(formatAmount(group.amount_total || 0))}</div>
                                        </div>
                                        <div class="invoice-detail-meta">
                                            <span class="invoice-detail-chip">${escapeHtml(formatMetricCount(group.machine_count || 0, 'machine'))}</span>
                                            <span class="invoice-detail-chip">${escapeHtml(formatMetricCount(group.contract_count || 0, 'contract'))}</span>
                                            <span class="invoice-detail-chip">${escapeHtml(formatMetricCount(group.billing_line_count || 0, 'billing line'))}</span>
                                        </div>
                                        <div class="detail-list-block">
                                            <span class="detail-list-label">Machine IDs</span>
                                            <div class="detail-list-value">${escapeHtml((group.machine_ids || []).join(', ') || 'No machine IDs mapped')}${group.machine_ids_truncated ? ' ...' : ''}</div>
                                        </div>
                                        <div class="detail-list-block">
                                            <span class="detail-list-label">Contractmain IDs</span>
                                            <div class="detail-list-value">${escapeHtml((group.contractmain_ids || []).join(', ') || 'No contract IDs mapped')}${group.contractmain_ids_truncated ? ' ...' : ''}</div>
                                        </div>
                                    </article>
                                `
                            )
                            .join('')}
                    </div>
                `
                : '<div class="detail-empty">No invoice-level detail was returned for this cell.</div>'
        }
        <div class="detail-section-title">Meter Reading Breakdown</div>
        ${
            readingGroups.length
                ? `
                    <div class="invoice-detail-list">
                        ${readingGroups
                            .map(
                                (group) => `
                                    <article class="invoice-detail-card">
                                        <div class="invoice-detail-head">
                                            <div class="invoice-detail-ref">${escapeHtml(group.invoice_num ? `Invoice ${group.invoice_num}` : `Schedule ${group.schedule_id || 'N/A'}`)}</div>
                                            <div class="invoice-detail-amount">${escapeHtml(formatAmount(group.amount_total || 0))}</div>
                                        </div>
                                        <div class="invoice-detail-meta">
                                            <span class="invoice-detail-chip">${escapeHtml(formatMetricCount(group.pages || 0, 'page'))}</span>
                                            <span class="invoice-detail-chip">${escapeHtml(`Rate ${formatAmount(group.page_rate || 0)}`)}</span>
                                            <span class="invoice-detail-chip">${escapeHtml(`Succeeding ${formatAmount(group.succeeding_page_rate || group.page_rate || 0)}`)}</span>
                                            <span class="invoice-detail-chip">${escapeHtml(group.with_vat ? 'VAT Inclusive' : 'VAT Exclusive')}</span>
                                        </div>
                                        <div class="detail-list-block">
                                            <span class="detail-list-label">Contract / Machine</span>
                                            <div class="detail-list-value">${escapeHtml(`Contract ${group.contractmain_id || 'N/A'} • Machine ${group.machine_id || 'N/A'}`)}</div>
                                        </div>
                                        <div class="detail-list-block">
                                            <span class="detail-list-label">Quota / Monthly</span>
                                            <div class="detail-list-value">${escapeHtml(`${formatCount(group.monthly_quota || 0)} quota • ${formatAmount(group.monthly_rate || 0)} monthly`)}</div>
                                        </div>
                                        <div class="detail-list-block">
                                            <span class="detail-list-label">Computation</span>
                                            <div class="detail-list-value">${escapeHtml(`${formatCount(group.quota_pages || group.pages || 0)} quota pages x ${formatAmount(group.page_rate || 0)} + ${formatCount(group.succeeding_pages || 0)} succeeding pages x ${formatAmount(group.succeeding_page_rate || group.page_rate || 0)} = ${formatAmount(group.amount_total || 0)}`)}</div>
                                        </div>
                                    </article>
                                `
                            )
                            .join('')}
                    </div>
                `
                : '<div class="detail-empty">No meter-reading breakdown was returned for this cell.</div>'
        }
    `;

    document.getElementById('invoiceEditBillingBtn')?.addEventListener('click', () => {
        closeInvoiceDetailModal();
        openBillingCalcModal(rowId, monthKey);
    });
    document.getElementById('invoiceDeleteBillingBtn')?.addEventListener('click', async () => {
        const confirmed = window.confirm(`Cancel invoice ${primaryInvoiceRef || 'for this billing month'} for replacement? This makes the invoice number available again after the saved billing record is removed.`);
        if (!confirmed) return;
        const deleteButton = document.getElementById('invoiceDeleteBillingBtn');
        const editButton = document.getElementById('invoiceEditBillingBtn');
        if (deleteButton) deleteButton.disabled = true;
        if (editButton) editButton.disabled = true;
        try {
            const result = await deleteBillingRecord({
                row,
                monthKey,
                invoiceNo: primaryInvoiceRef
            });
            MargaUtils.showToast(
                result.deletedCount
                    ? `Deleted ${result.deletedCount} billing record${result.deletedCount === 1 ? '' : 's'} from ${formatMonthLabel(monthKey, monthKey)}.`
                    : 'No saved billing record was found for this cell.',
                'success'
            );
            closeInvoiceDetailModal();
            await loadDashboard({ forceRefresh: true });
        } catch (error) {
            MargaUtils.showToast(String(error?.message || 'Unable to delete billing.'), 'error');
            if (deleteButton) deleteButton.disabled = false;
            if (editButton) editButton.disabled = false;
        }
    });
}

function renderAll(payload) {
    lastPayload = payload;
    renderSelectionCard(payload);
    renderSummaryTable(payload);
    renderMatrixTable(payload);
    els.rawJson.textContent = JSON.stringify(payload, null, 2);
}

function renderError(message) {
    els.selectionCard.classList.add('hidden');
    els.summaryTableWrap.innerHTML = '<div class="empty-panel">Request failed. Check API payload below.</div>';
    els.matrixTableWrap.innerHTML = '<div class="empty-panel">Request failed. Check API payload below.</div>';
    els.rawJson.textContent = String(message || 'Unknown error');
}

async function loadDashboard(options = {}) {
    try {
        const { url, apiKey } = buildRequestContext(options);
        setStatus('Loading...', 'loading');
        els.runBtn.disabled = true;

        const headers = {};
        if (apiKey) headers['x-api-key'] = apiKey;

        const response = await fetch(url, { headers });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload?.error || `Request failed (${response.status})`);
        }

        billingExclusionCache = await loadBillingExclusions();
        renderDashboardBillingExclusions();
        renderAll(applyBillingExclusionsToPayload(payload, billingExclusionCache));
        setStatus('Loaded');
    } catch (error) {
        renderError(error?.message || error);
        setStatus('Error', 'error');
    } finally {
        els.runBtn.disabled = false;
    }
}

async function copyCurl() {
    try {
        const { url, apiKey } = buildRequestContext();
        const headerPart = apiKey ? ` -H "x-api-key: ${apiKey}"` : '';
        await navigator.clipboard.writeText(`curl -s "${url}"${headerPart}`);
        MargaUtils.showToast('cURL copied to clipboard.', 'success');
    } catch (error) {
        MargaUtils.showToast(String(error?.message || 'Unable to copy cURL.'), 'error');
    }
}

function bindEvents() {
    els.runBtn?.addEventListener('click', loadDashboard);
    els.copyCurlBtn?.addEventListener('click', copyCurl);
    els.matrixSearchInput?.addEventListener('input', () => {
        if (lastPayload) renderMatrixTable(lastPayload);
        window.clearTimeout(searchReloadTimer);
        const search = String(els.matrixSearchInput?.value || '').trim();
        if (!search || search.length >= 2) {
            searchReloadTimer = window.setTimeout(() => {
                loadDashboard();
            }, 350);
        }
    });
    els.matrixSortInput?.addEventListener('change', () => {
        localStorage.setItem(MATRIX_SORT_STORAGE_KEY, getMatrixSortValue());
        if (lastPayload) renderMatrixTable(lastPayload);
    });
    els.invoiceSearchBtn?.addEventListener('click', searchInvoiceNumber);
    els.invoiceSearchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchInvoiceNumber();
        }
    });
    els.billingExclusionsRefreshBtn?.addEventListener('click', async () => {
        els.billingExclusionsRefreshBtn.disabled = true;
        try {
            billingExclusionCache = await loadBillingExclusions();
            renderDashboardBillingExclusions();
            if (lastPayload) renderMatrixTable(applyBillingExclusionsToPayload(lastPayload, billingExclusionCache));
        } catch (error) {
            MargaUtils.showToast(String(error?.message || 'Unable to refresh hidden billing accounts.'), 'error');
        } finally {
            els.billingExclusionsRefreshBtn.disabled = false;
        }
    });
    els.billingExclusionsList?.addEventListener('click', async (event) => {
        const restoreButton = event.target.closest('[data-billing-exclusion-restore]');
        if (!restoreButton) return;
        const docId = String(restoreButton.dataset.billingExclusionRestore || '').trim();
        if (!docId) return;
        const confirmed = window.confirm('Restore this account to active billing lists?');
        if (!confirmed) return;
        restoreButton.disabled = true;
        try {
            const result = await restoreBillingExclusion(docId);
            renderDashboardBillingExclusions();
            MargaUtils.showToast(result.queued ? 'Billing account restore queued.' : 'Billing account restored.', 'success');
            if (lastPayload) await loadDashboard({ forceRefresh: true });
        } catch (error) {
            restoreButton.disabled = false;
            MargaUtils.showToast(String(error?.message || 'Unable to restore billing account.'), 'error');
        }
    });
    els.invoiceSearchResults?.addEventListener('click', async (event) => {
        const actionButton = event.target.closest('[data-invoice-search-action]');
        if (!actionButton) return;
        const action = actionButton.dataset.invoiceSearchAction;
        if (action === 'open') {
            const groupKey = actionButton.dataset.groupKey;
            if (groupKey) {
                openInvoiceSearchGroupDetail(groupKey);
                return;
            }
            const rowId = actionButton.dataset.rowId;
            const monthKey = actionButton.dataset.monthKey;
            if (rowId && monthKey) openBillingCalcModal(rowId, monthKey);
            return;
        }
        if (action !== 'delete') return;

        const docId = String(actionButton.dataset.docId || '').trim();
        const invoiceNo = String(actionButton.dataset.invoiceNo || '').trim();
        const monthKey = String(actionButton.dataset.monthKey || '').trim();
        if (!docId && !invoiceNo) return;
        const confirmed = window.confirm(`Cancel invoice ${invoiceNo || docId} for replacement? This makes the invoice number available again after the saved billing record is removed.`);
        if (!confirmed) return;
        actionButton.disabled = true;
        try {
            const result = await deleteBillingDocsForReplacement({ invoiceNo, docId, monthKey });
            showBillingSaveResult({
                type: 'success',
                title: 'Invoice Cancelled',
                message: `Invoice ${invoiceNo || docId} removed ${formatCount(result.deletedCount || 0)} saved billing record${result.deletedCount === 1 ? '' : 's'} and can be replaced.`
            });
            await searchInvoiceNumber();
            if (lastPayload) await loadDashboard();
        } catch (error) {
            console.error('Unable to delete invoice from lookup.', error);
            showBillingSaveResult({
                type: 'error',
                title: 'Cancel Failed',
                message: error.message || `Invoice ${invoiceNo || docId} could not be deleted.`
            });
            actionButton.disabled = false;
        }
    });
    els.matrixTableWrap?.addEventListener('click', (event) => {
        const calcTrigger = event.target.closest('.calc-link');
        if (calcTrigger) {
            event.preventDefault();
            openBillingCalcModal(calcTrigger.dataset.rowId, calcTrigger.dataset.monthKey);
            return;
        }
        const serialTrigger = event.target.closest('.serial-link');
        if (serialTrigger) {
            openSerialDetailModal(serialTrigger.dataset.rowId);
            return;
        }
        const trigger = event.target.closest('.billed-link');
        if (!trigger) return;
        openInvoiceDetailModal(trigger.dataset.rowId, trigger.dataset.monthKey);
    });
    els.invoiceDetailCloseBtn?.addEventListener('click', closeInvoiceDetailModal);
    els.rtpInvoicePrintBtn?.addEventListener('click', printCurrentRtpInvoice);
    els.invoiceDetailModal?.addEventListener('click', (event) => {
        if (event.target === els.invoiceDetailModal) closeInvoiceDetailModal();
    });
    els.billingCalcCloseBtn?.addEventListener('click', closeBillingCalcModal);
    els.billingCalcPrintBtn?.addEventListener('click', printCurrentRtpInvoice);
    els.billingCalcModal?.addEventListener('click', (event) => {
        if (event.target === els.billingCalcModal) closeBillingCalcModal();
    });
    els.clearSelectionBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        clearPendingSelection();
    });
    els.serialDetailCloseBtn?.addEventListener('click', closeSerialDetailModal);
    els.serialDetailModal?.addEventListener('click', (event) => {
        if (event.target === els.serialDetailModal) closeSerialDetailModal();
    });
    window.addEventListener('popstate', () => {
        if (lastPayload) {
            renderSelectionCard(lastPayload);
            renderMatrixTable(lastPayload);
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeInvoiceDetailModal();
            closeSerialDetailModal();
            closeBillingCalcModal();
        }
    });
}

function toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('show');
}

window.toggleSidebar = toggleSidebar;

document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    if (!applyUserContext()) return;

    const savedKey = String(localStorage.getItem('openclaw_api_key') || '').trim();
    if (savedKey) els.apiKeyInput.value = savedKey;

    restoreMatrixSortValue();
    initDefaults();
    bindEvents();
    loadDashboard();
});
