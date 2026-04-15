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
const MATRIX_SORT_STORAGE_KEY = 'marga_billing_matrix_sort';
const DEFAULT_SPOILAGE_RATE = 0.02;
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

function billingSnapshotFromValues({ invoiceNo, previousMeter, presentMeter, spoilagePercent }) {
    return {
        invoiceNo: normalizeInvoiceNumber(invoiceNo),
        previousMeter: Math.max(0, Number(previousMeter || 0) || 0),
        presentMeter: Math.max(0, Number(presentMeter || 0) || 0),
        spoilagePercent: Number((Number(spoilagePercent || 0) || 0).toFixed(2))
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
        spoilagePercent: Number.isFinite(spoilagePercent) ? spoilagePercent : fallback.spoilagePercent
    });
}

function billingSnapshotsEqual(left, right) {
    const a = billingSnapshotFromValues(left || {});
    const b = billingSnapshotFromValues(right || {});
    return a.invoiceNo === b.invoiceNo
        && a.previousMeter === b.previousMeter
        && a.presentMeter === b.presentMeter
        && Math.abs(a.spoilagePercent - b.spoilagePercent) < 0.001;
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

function buildBillingRecordFields({ row, context, estimate, snapshot, docId }) {
    const period = buildBillingPeriod(context?.monthKey, row?.reading_day);
    const parsedMonth = parseMonthInput(context?.monthKey);
    const now = new Date();
    const sqlNow = toSqlDateTime(now);
    const dueDate = period.to ? `${period.to} 00:00:00` : sqlNow;
    const numericInvoice = /^\d+$/.test(snapshot.invoiceNo) ? Number(snapshot.invoiceNo) : null;
    const numericContractId = Number(row?.contractmain_id || 0);
    const numericDocId = Number(docId);

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
        field_previous_meter: snapshot.previousMeter,
        field_present_meter: snapshot.presentMeter,
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
        company_id: String(row?.company_id || '').trim(),
        machine_id: String(row?.machine_id || '').trim(),
        serial_number: String(row?.serial_number || '').trim(),
        updated_at: now.toISOString(),
        source_module: 'billing_dashboard',
        status: 0,
        isreceived: 0,
        location: 1
    };
}

async function saveBillingRecord({ row, context, estimate, snapshot, existingDocs = [] }) {
    const invoiceNo = normalizeInvoiceNumber(snapshot?.invoiceNo);
    if (!invoiceNo) throw new Error('Enter an invoice number before saving.');
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
    if (!row?.contractmain_id) throw new Error('This row has no contract ID to delete.');
    const docs = await queryBillingDocsByContractMonth(row.contractmain_id, monthKey);
    const normalizedInvoice = normalizeInvoiceNumber(invoiceNo);
    const matchingDocs = normalizedInvoice
        ? docs.filter((doc) => getBillingDocInvoiceRef(doc) === normalizedInvoice)
        : docs;
    if (!matchingDocs.length) return { deletedCount: 0 };

    for (const doc of matchingDocs) {
        if (!doc?._docId) continue;
        await deleteFirestoreDocument('tbl_billing', doc._docId);
    }

    return { deletedCount: matchingDocs.length };
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
    const serialNumber = String(machine?.serial || row?.serial_number || '').trim();
    const modelName = String(model?.modelname || machine?.description || row?.machine_label || '').trim();
    const accountName = String(
        row?.display_name
        || row?.account_name
        || billInfo?.payeename
        || billInfo?.endusername
        || company?.companyname
        || row?.company_name
        || ''
    ).trim();
    const address = String(
        billInfo?.payeeadd
        || billInfo?.enduseradd
        || buildBranchAddress(branch)
        || ''
    ).trim();

    return {
        customerName: accountName || 'Unknown Customer',
        tin: String(company?.company_tin || '').trim() || 'N/A',
        address: address || 'N/A',
        invoiceDate: formatUsDate(invoiceDate),
        readingCode: row?.reading_day ? `RDG${row.reading_day}` : 'RDG',
        monthLabel: formatMonthLongLabel(monthKey, monthKey),
        contractCode,
        businessStyle: String(company?.business_style || '').trim() || 'N/A',
        printerModel: modelName ? `${modelName}${serialNumber ? ` --- ${serialNumber}` : ''}` : (serialNumber || 'N/A'),
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
    const serialNumber = String(machine?.serial || row?.serial_number || '').trim();
    const modelName = String(model?.modelname || machine?.description || row?.machine_label || '').trim();
    const accountName = String(
        row?.display_name
        || row?.account_name
        || billInfo?.payeename
        || billInfo?.endusername
        || company?.companyname
        || row?.company_name
        || ''
    ).trim();
    const address = String(
        billInfo?.payeeadd
        || billInfo?.enduseradd
        || buildBranchAddress(branch)
        || ''
    ).trim();

    return {
        customerName: accountName || 'Unknown Customer',
        tin: String(company?.company_tin || '').trim() || 'N/A',
        address: address || 'N/A',
        invoiceDate: formatUsDate(invoiceDate),
        readingCode: row?.reading_day ? `RDG${row.reading_day}` : 'RDG',
        monthLabel: formatMonthLongLabel(context?.monthKey, context?.monthLabel || ''),
        contractCode,
        businessStyle: String(company?.business_style || '').trim() || 'N/A',
        printerModel: modelName ? `${modelName}${serialNumber ? ` --- ${serialNumber}` : ''}` : (serialNumber || 'N/A'),
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
    sections: {
        header: { xMm: 0, yMm: 0, fontScale: 1 },
        description: { xMm: 0, yMm: 0, fontScale: 1 },
        meta: { xMm: 0, yMm: 0, fontScale: 1 },
        totals: { xMm: 0, yMm: 0, fontScale: 1 }
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
    const rawSections = value?.sections || {};
    return {
        paperWidthCm: Number.isFinite(paperWidthCm) ? Math.max(10, Math.min(40, paperWidthCm)) : RTP_PRINT_CALIBRATION.paperWidthCm,
        paperHeightCm: Number.isFinite(paperHeightCm) ? Math.max(10, Math.min(40, paperHeightCm)) : RTP_PRINT_CALIBRATION.paperHeightCm,
        orientation: orientation === 'landscape' ? 'landscape' : 'portrait',
        scale: Number.isFinite(scale) ? Math.max(0.35, Math.min(0.9, scale)) : RTP_PRINT_CALIBRATION.scale,
        offsetXmm: Number.isFinite(offsetXmm) ? Math.max(-40, Math.min(40, offsetXmm)) : RTP_PRINT_CALIBRATION.offsetXmm,
        offsetYmm: Number.isFinite(offsetYmm) ? Math.max(-40, Math.min(80, offsetYmm)) : RTP_PRINT_CALIBRATION.offsetYmm,
        sections: Object.fromEntries(Object.keys(RTP_PRINT_SECTION_LAYOUT).map((sectionKey) => {
            const defaults = RTP_PRINT_CALIBRATION.sections[sectionKey];
            const current = rawSections?.[sectionKey] || {};
            const sectionX = Number(current?.xMm ?? defaults.xMm);
            const sectionY = Number(current?.yMm ?? defaults.yMm);
            const fontScale = Number(current?.fontScale ?? defaults.fontScale);
            return [sectionKey, {
                xMm: Number.isFinite(sectionX) ? Math.max(-40, Math.min(40, sectionX)) : defaults.xMm,
                yMm: Number.isFinite(sectionY) ? Math.max(-40, Math.min(80, sectionY)) : defaults.yMm,
                fontScale: Number.isFinite(fontScale) ? Math.max(0.6, Math.min(1.8, fontScale)) : defaults.fontScale
            }];
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
    const sideA = Number(calibration?.paperWidthCm ?? RTP_PRINT_CALIBRATION.paperWidthCm);
    const sideB = Number(calibration?.paperHeightCm ?? RTP_PRINT_CALIBRATION.paperHeightCm);
    const shortSideCm = Math.min(sideA, sideB);
    const longSideCm = Math.max(sideA, sideB);
    const orientation = calibration?.orientation === 'landscape' ? 'landscape' : 'portrait';
    const widthCm = orientation === 'portrait' ? shortSideCm : longSideCm;
    const heightCm = orientation === 'portrait' ? longSideCm : shortSideCm;
    return {
        widthCm,
        heightCm,
        widthMm: widthCm * 10,
        heightMm: heightCm * 10
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

function buildRtpSectionedLayoutHtml(preview, mode = 'print') {
    const totals = preview?.totals || {};
    const contractCode = String(preview?.contractCode || 'RTP').trim().toUpperCase() || 'RTP';
    const isFixedRate = contractCode === 'RTF';
    const succeedingRate = Number(preview?.succeedingRate || preview?.rate || 0) || 0;
    const succeedingPages = Number(preview?.succeedingPages || 0) || 0;
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

                        <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 52, widthMm: 76 }, mode)}"><strong>Succeeding Pages / Rate:</strong></div>
                        <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 92, yMm: 52, widthMm: 80 }, mode)}">${escapeHtml(`${formatCount(succeedingPages)} @ ${formatFixedAmount(succeedingRate)}`)}</div>
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
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 0, widthMm: 27, textAlign: 'right' }, mode)}">${escapeHtml(formatFixedAmount(totals.total || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 9, widthMm: 27, textAlign: 'right' }, mode)}">${escapeHtml(formatFixedAmount(totals.vatAmount || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 17, widthMm: 27, textAlign: 'right' }, mode)}">${escapeHtml(formatFixedAmount(totals.vatableSales || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 26, widthMm: 27, textAlign: 'right' }, mode)}">${escapeHtml(formatFixedAmount(totals.vatExempt || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 35, widthMm: 27, textAlign: 'right' }, mode)}">${escapeHtml(formatFixedAmount(totals.zeroRated || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 44, widthMm: 27, textAlign: 'right' }, mode)}">${escapeHtml(formatFixedAmount(totals.lessVat || 0))}</div>
            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 53, widthMm: 27, textAlign: 'right' }, mode)}"><strong>${escapeHtml(formatFixedAmount(totals.amountDue || 0))}</strong></div>
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

    const printWindow = window.open('', 'marga_invoice_print', 'width=1180,height=860');
    if (!printWindow) {
        MargaUtils.showToast('The print window was blocked.', 'error');
        return;
    }

    const printMarkup = buildRtpPrintDocument(currentRtpPrintPayload);
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

function buildBillingCalculationContext(row, monthKey) {
    if (!row || row.is_summary_row) return null;
    const profile = getRowBillingProfile(row);
    if (!profile) return null;

    const targetCell = row.months?.[monthKey] || {};
    const latestPriorGroup = collectPriorReadingGroups(row, monthKey)[0] || null;
    const latestInvoice = collectPriorInvoiceRefs(row, monthKey)[0] || null;
    const previousMeter = latestPriorGroup
        ? Number(latestPriorGroup.present_meter || latestPriorGroup.previous_meter || 0) || 0
        : 0;

    return {
        row,
        monthKey,
        targetCell,
        monthLabel: targetCell.month_label_short || formatMonthLabel(monthKey, monthKey),
        profile,
        latestPriorGroup,
        latestInvoice,
        previousMeter,
        presentMeter: previousMeter,
        spoilageRate: DEFAULT_SPOILAGE_RATE,
        isReading: isReadingPricing(profile),
        isFixed: !isReadingPricing(profile) && Number(profile.monthly_rate || 0) > 0
    };
}

function calculateBillingEstimate(context, previousMeterValue, presentMeterValue, spoilageRateValue = context?.spoilageRate) {
    const profile = context?.profile || {};
    const previousMeter = Math.max(0, Number(previousMeterValue || 0) || 0);
    const presentMeter = Math.max(0, Number(presentMeterValue || 0) || 0);
    const pageRate = Number(profile.page_rate || 0) || 0;
    const succeedingRate = getSucceedingPageRate(profile);
    const monthlyQuota = Number(profile.monthly_quota || 0) || 0;
    const monthlyRate = Number(profile.monthly_rate || 0) || 0;
    const withVat = Boolean(profile.with_vat);
    const spoilageRate = Math.max(0, Number(spoilageRateValue || 0) || 0);
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

    if (context?.isReading) {
        if (presentMeter < previousMeter) {
            warning = 'Present meter cannot be lower than the previous meter.';
        } else {
            rawPages = presentMeter - previousMeter;
            spoilagePages = Math.round(rawPages * spoilageRate);
            netPages = Math.max(0, rawPages - spoilagePages);
            billedPages = monthlyQuota > 0 ? Math.max(netPages, monthlyQuota) : netPages;
            if (billedPages > 0 && pageRate > 0) {
                if (monthlyQuota > 0) {
                    quotaPages = monthlyQuota;
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
    } else if (context?.isFixed) {
        amountDue = monthlyRate;
        formula = 'fixed_monthly_rate';
    }

    amountDue = Number(amountDue.toFixed(2));
    const netAmount = withVat ? Number((amountDue / 1.12).toFixed(2)) : amountDue;
    const vatAmount = withVat ? Number((amountDue - netAmount).toFixed(2)) : Number((amountDue * 0.12).toFixed(2));

    return {
        previousMeter,
        presentMeter,
        rawPages,
        spoilageRate,
        spoilagePages,
        netPages,
        billedPages,
        quotaPages,
        succeedingPages,
        quotaAmount: Number(quotaAmount.toFixed(2)),
        succeedingAmount: Number(succeedingAmount.toFixed(2)),
        succeedingRate,
        pages: billedPages,
        amountDue,
        netAmount,
        vatAmount,
        quotaVariance: monthlyQuota > 0 ? netPages - monthlyQuota : null,
        formula,
        warning
    };
}

function closeBillingCalcModal() {
    billingCalcRequestToken += 1;
    setRtpPrintPayload(null);
    els.billingCalcModal?.classList.add('hidden');
}

async function openBillingCalcModal(rowId, monthKey) {
    const row = renderedMatrixRows.find((entry) => String(entry.row_id || entry.company_id) === String(rowId))
        || (lastPayload?.month_matrix?.rows || []).find((entry) => String(entry.row_id || entry.company_id) === String(rowId));
    const context = buildBillingCalculationContext(row, monthKey);
    if (!context) {
        MargaUtils.showToast('No billing profile is available for this row yet.', 'error');
        return;
    }

    const profile = context.profile;
    const latest = context.latestPriorGroup;
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
            <div class="calc-save-row">
                <div class="calc-save-actions">
                    <button class="btn btn-primary" type="button" id="calcSaveBillingBtn">${savedBillingDoc ? 'Update Billing' : 'Save Billing'}</button>
                    ${savedBillingDoc ? '<button class="btn btn-danger" type="button" id="calcDeleteBillingBtn">Delete Billing</button>' : ''}
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
            <div class="calc-ledger-grid calc-ledger-grid-bottom">
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
            ${
                canPrintInvoice
                    ? `
                        <section class="calc-panel">
                            <div class="calc-panel-title">${escapeHtml(printContractCode)} Print</div>
                            <div class="calc-print-row">
                                <button class="btn btn-primary" type="button" id="calcInlinePrintBtn" disabled>Print ${escapeHtml(printContractCode)}</button>
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
    const inlinePrintHint = document.getElementById('calcInlinePrintHint');
    const templateSelect = document.getElementById('calcPrintTemplateSelect');
    const templateNameInput = document.getElementById('calcPrintTemplateNameInput');
    const saveTemplateBtn = document.getElementById('calcPrintSaveTemplateBtn');
    const deleteTemplateBtn = document.getElementById('calcPrintDeleteTemplateBtn');
    const orientationInput = document.getElementById('calcPrintOrientationInput');
    const paperWidthInput = document.getElementById('calcPrintPaperWidthInput');
    const paperHeightInput = document.getElementById('calcPrintPaperHeightInput');
    const offsetXInput = document.getElementById('calcPrintOffsetXInput');
    const offsetYInput = document.getElementById('calcPrintOffsetYInput');
    const scaleInput = document.getElementById('calcPrintScaleInput');
    const resetPrintBtn = document.getElementById('calcPrintResetBtn');
    const sectionInputs = Array.from(document.querySelectorAll('[data-rtp-section-key][data-rtp-section-field]'));
    let activeEstimate = estimate;
    let previewReady = false;
    let savedSnapshot = savedBillingDoc ? billingSnapshotFromDoc(savedBillingDoc, initialSnapshot) : null;
    let savedDocExists = Boolean(savedBillingDoc);
    let workflowError = '';

    inlinePrintBtn?.addEventListener('click', printCurrentRtpInvoice);

    const buildCurrentSnapshot = () => billingSnapshotFromValues({
        invoiceNo: invoiceInput?.value || '',
        previousMeter: previousInput?.value || 0,
        presentMeter: presentInput?.value || 0,
        spoilagePercent: spoilageInput?.value || 0
    });

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
    };

    if (canPrintInvoice) syncCalcWorkflowState();

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
            offsetYmm: offsetYInput ? Number(offsetYInput.value || 0) : currentRtpPrintCalibration.offsetYmm,
            scale: scaleInput ? Number(scaleInput.value || 0) : currentRtpPrintCalibration.scale,
            sections: nextSections
        });
        syncCalibrationInputs(calibration);
        renderCalcPreview(activeEstimate);
    };

    const recompute = () => {
        const next = calculateBillingEstimate(
            context,
            previousInput ? previousInput.value : context.previousMeter,
            presentInput ? presentInput.value : context.presentMeter,
            spoilageInput ? Number(spoilageInput.value || 0) / 100 : context.spoilageRate
        );
        setElementDisplayValue(amountValue, formatAmount(next.amountDue || 0));
        setElementDisplayValue(rawPagesValue, formatCount(next.rawPages || 0));
        setElementDisplayValue(spoilagePagesValue, formatCount(next.spoilagePages || 0));
        setElementDisplayValue(netPagesValue, formatCount(next.netPages || 0));
        setElementDisplayValue(billedPagesValue, formatCount(next.billedPages || 0));
        setElementDisplayValue(succeedingPagesValue, formatCount(next.succeedingPages || 0));
        setElementDisplayValue(netValue, formatAmount(next.netAmount || 0));
        setElementDisplayValue(vatValue, formatAmount(next.vatAmount || 0));
        if (formulaValue) formulaValue.textContent = next.formula;
        if (quotaValue) {
            quotaValue.textContent = next.quotaVariance === null
                ? 'No quota saved on this contract.'
                : `${formatCount(profile.monthly_quota || 0)} quota floor • ${next.quotaVariance >= 0 ? '+' : ''}${formatCount(next.quotaVariance)} vs net pages`;
        }
        if (flowValue) {
            flowValue.textContent = context.isReading
                ? `${formatCount(next.rawPages || 0)} raw - ${formatCount(next.spoilagePages || 0)} spoilage = ${formatCount(next.netPages || 0)} net. ${formatCount(next.quotaPages || 0)} quota pages x ${formatAmount(profile.page_rate || 0)} plus ${formatCount(next.succeedingPages || 0)} succeeding pages x ${formatAmount(next.succeedingRate || 0)} = ${formatAmount(next.amountDue || 0)}.`
                : `Fixed monthly bill uses ${formatAmount(profile.monthly_rate || 0)} for ${context.monthLabel}.`;
        }
        if (warningValue) warningValue.textContent = next.warning || '';
        activeEstimate = next;
        renderCalcPreview(activeEstimate);
        syncCalcWorkflowState();
    };

    invoiceInput?.addEventListener('input', () => {
        workflowError = '';
        invoiceInput.classList.remove('input-error');
        syncCalcWorkflowState();
    });
    previousInput?.addEventListener('input', recompute);
    presentInput?.addEventListener('input', recompute);
    spoilageInput?.addEventListener('input', recompute);
    paperWidthInput?.addEventListener('input', updateCalibration);
    paperHeightInput?.addEventListener('input', updateCalibration);
    orientationInput?.addEventListener('change', updateCalibration);
    offsetXInput?.addEventListener('input', updateCalibration);
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
        const confirmed = window.confirm(`Delete billing ${invoiceNo || 'for this month'}? This frees the invoice number so it can be reused.`);
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
    await renderCalcPreview(estimate);
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
            const canOpenCalculator = !row.is_summary_row && Boolean(getRowBillingProfile(row));
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
                            title="Pending reading or billing. Open billing calculation."
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
                        <button class="btn btn-danger" type="button" id="invoiceDeleteBillingBtn">Delete Invoice</button>
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
        const confirmed = window.confirm(`Delete invoice ${primaryInvoiceRef || 'for this billing month'}? This makes the invoice number available again.`);
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

        renderAll(payload);
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
