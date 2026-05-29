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
    billingScorecardWrap: null,
    matrixTableWrap: null,
    matrixTotalsWrap: null,
    customerStatementBar: null,
    matrixSearchInput: null,
    matrixSortInput: null,
    matrixSearchMeta: null,
    printedTodayCard: null,
    printedTodayCount: null,
    printedTodayAmount: null,
    savedToPrintCard: null,
    savedToPrintCount: null,
    savedToPrintAmount: null,
    printedMonthCard: null,
    printedMonthCount: null,
    printedMonthAmount: null,
    invoiceSearchInput: null,
    invoiceSearchBtn: null,
    invoiceDeepSearchBtn: null,
    invoiceSearchResults: null,
    billingExclusionsToggleBtn: null,
    billingExclusionsRefreshBtn: null,
    billingExclusionsList: null,
    rawJson: null,
    invoiceDetailModal: null,
    invoiceDetailTitle: null,
    invoiceDetailSubtitle: null,
    invoiceDetailContent: null,
    rtpInvoicePrintBtn: null,
    rtpInvoiceDotMatrixBtn: null,
    invoiceDetailCloseBtn: null,
    serialDetailModal: null,
    serialDetailTitle: null,
    serialDetailSubtitle: null,
    serialDetailContent: null,
    serialDetailCloseBtn: null,
    billingScorecardModal: null,
    billingScorecardTitle: null,
    billingScorecardSubtitle: null,
    billingScorecardContent: null,
    billingScorecardCloseBtn: null,
    billingCalcModal: null,
    billingCalcTitle: null,
    billingCalcSubtitle: null,
    billingCalcContent: null,
    billingCalcPrintBtn: null,
    billingCalcDotMatrixBtn: null,
    billingCalcMeterFormBtn: null,
    billingCalcEnvelopeBtn: null,
    billingCalcCloseBtn: null
};

let lastPayload = null;
let renderedMatrixRows = [];
let searchReloadTimer = null;
let billingWorkDistributionState = null;
let invoiceDetailRequestToken = 0;
let billingCalcRequestToken = 0;
let dashboardRequestToken = 0;
let dashboardAbortController = null;
let invoicePreviewReferenceData = null;
let invoicePreviewReferencePromise = null;
let currentRtpPrintPayload = null;
let currentRtpMeterFormEstimate = null;
let invoiceSearchGroupCache = new Map();
const priorMachineReadingCache = new Map();
const priorBillingReadingCache = new Map();
let billingExclusionCache = [];
let billingScorecardData = null;
let billingScorecardDetailMap = new Map();
let unbilledProjectionData = null;
let unbilledProjectionDetailMap = new Map();
let activeUnbilledProjectionMonthKey = '';
let billingScorecardPaymentEntries = [];
let billingScorecardPaymentPromise = null;
const BILLING_COLLECTIONS_SCORECARD_ENABLED = false;
const MATRIX_SORT_STORAGE_KEY = 'marga_billing_matrix_sort';
const RTP_PRINT_NAME_OPTIONS_STORAGE_KEY = 'marga_rtp_print_name_options_v1';
const DEFAULT_SPOILAGE_RATE = 0.02;
const BILLING_EXCLUSIONS_COLLECTION = 'tbl_billing_exclusions';
const BILLING_DRAFTS_COLLECTION = 'tbl_billing_drafts';
const SCHEDULE_PLANNER_COLLECTION = 'tbl_schedule_planner';
const SCHEDULE_AREA_RULES_COLLECTION = 'tbl_schedule_area_rules';
const ENVELOPE_DEFAULTS = {
    bankName: 'China Bank Savings Antipolo Branch',
    accountName: 'Marga Enterprises',
    accountNumber: '6173-00-00163-4',
    from: 'Marga Enterprises'
};
const BILLING_SCHEDULE_PURPOSES = {
    printed_billing: {
        key: 'printed_billing',
        label: 'Printed Billing',
        taskType: 'deliver_invoice',
        taskLabel: 'Deliver Invoice',
        sourceAction: 'invoice_saved',
        requiresBilling: true,
        requiresPrintGate: true,
        notesVerb: 'Deliver saved billing invoice'
    },
    reading: {
        key: 'reading',
        label: 'Reading',
        taskType: 'meter_reading',
        taskLabel: 'Get Meter Reading',
        sourceAction: 'meter_reading_scheduled',
        requiresBilling: false,
        requiresPrintGate: false,
        notesVerb: 'Get present meter reading'
    }
};
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

function getPayloadSearchTerm(payload) {
    return String(payload?.filters?.search || '').trim().toLowerCase();
}

function textMatchesSearch(searchTerm, values = []) {
    const needle = String(searchTerm || '').trim().toLowerCase();
    if (!needle) return true;
    const textValues = values
        .filter(Boolean)
        .map((value) => String(value || '').toLowerCase());
    const haystack = textValues
        .join(' ')
        .toLowerCase();
    const compactNeedle = needle.replace(/[^a-z0-9]/g, '');
    if (!compactNeedle) return false;
    if (compactNeedle.length <= 3) {
        return textValues
            .flatMap((value) => value.split(/[^a-z0-9]+/g))
            .filter(Boolean)
            .some((token) => token.startsWith(compactNeedle));
    }
    if (haystack.includes(needle)) return true;
    return textValues
        .map((value) => value.replace(/[^a-z0-9]/g, ''))
        .some((value) => value.includes(compactNeedle));
}

function isSpecificMachineSearch(searchTerm) {
    const compactNeedle = String(searchTerm || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    return compactNeedle.length >= 4 && /\d/.test(compactNeedle);
}

function rowMatchesMachineIdentitySearch(row, searchTerm) {
    return textMatchesSearch(searchTerm, [
        row?.serial_number,
        row?.machine_label,
        row?.machine_id,
        row?.contractmain_id,
        row?.row_id
    ]);
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

function formatCurrency(value) {
    return `PHP ${formatFixedAmount(value)}`;
}

function formatPlainNumber(value) {
    return Number(value || 0).toLocaleString('en-PH', {
        maximumFractionDigits: 0
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

function getSharedBillingGroupProfile(row, fallbackProfile = {}) {
    const group = row?.billing_group || null;
    if (!group) return fallbackProfile || {};
    const categoryMeta = getContractCategoryMeta(group.category_id || fallbackProfile?.category_id);
    const pageRate = Number(group.page_rate || fallbackProfile?.page_rate || 0) || 0;
    return {
        ...(fallbackProfile || {}),
        category_id: Number(group.category_id || fallbackProfile?.category_id || 0) || 0,
        category_code: fallbackProfile?.category_code || categoryMeta.code,
        category_label: fallbackProfile?.category_label || categoryMeta.label,
        pricing_mode: 'reading',
        monthly_quota: Number(group.monthly_quota || fallbackProfile?.monthly_quota || 0) || 0,
        monthly_rate: Number(group.monthly_rate || fallbackProfile?.monthly_rate || 0) || 0,
        page_rate: pageRate,
        succeeding_page_rate: Number(group.page_rate_xtra || group.succeeding_page_rate || fallbackProfile?.succeeding_page_rate || fallbackProfile?.page_rate_xtra || pageRate || 0) || pageRate,
        page_rate_xtra: Number(group.page_rate_xtra || fallbackProfile?.page_rate_xtra || pageRate || 0) || pageRate,
        with_vat: group.with_vat === undefined ? Boolean(fallbackProfile?.with_vat) : Boolean(group.with_vat)
    };
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
        .replace(/^CHINABANK$/i, 'China Bank Savings Inc. - Branches')
        .replace(/^China\s+Bank\s+Savings?\s*(?:Inc\.?)?\s*-\s*Branches$/i, 'China Bank Savings Inc. - Branches')
        .trim();
}

function cleanInvoiceNameSuffix(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripBaseCustomerNameFromSuffix(suffix, baseName) {
    const cleanSuffix = cleanInvoiceNameSuffix(suffix);
    const cleanBase = cleanInvoiceNameSuffix(baseName);
    if (!cleanSuffix || !cleanBase) return cleanSuffix;
    const suffixKey = cleanSuffix.toLowerCase();
    const baseKey = cleanBase.toLowerCase();
    if (suffixKey === baseKey) return '';
    if (!suffixKey.startsWith(baseKey)) return cleanSuffix;
    return cleanInvoiceNameSuffix(cleanSuffix.slice(cleanBase.length).replace(/^[\s\-–—:•,./]+/, ''));
}

function loadRtpPrintNameOptions() {
    try {
        const parsed = JSON.parse(localStorage.getItem(RTP_PRINT_NAME_OPTIONS_STORAGE_KEY) || '{}');
        return {
            department: Boolean(parsed.department),
            model: Boolean(parsed.model),
            serial: Boolean(parsed.serial)
        };
    } catch (error) {
        return { department: false, model: false, serial: false };
    }
}

function saveRtpPrintNameOptions(options = {}) {
    const safeOptions = {
        department: Boolean(options.department),
        model: Boolean(options.model),
        serial: Boolean(options.serial)
    };
    try {
        localStorage.setItem(RTP_PRINT_NAME_OPTIONS_STORAGE_KEY, JSON.stringify(safeOptions));
    } catch (error) {
        console.warn('Unable to save RTP print name options.', error);
    }
    return safeOptions;
}

function getRtpPrintNameOptionsFromInputs() {
    return {
        department: Boolean(document.getElementById('calcPrintNameDepartmentInput')?.checked),
        model: Boolean(document.getElementById('calcPrintNameModelInput')?.checked),
        serial: Boolean(document.getElementById('calcPrintNameSerialInput')?.checked)
    };
}

function formatRtpInvoiceCustomerName(preview, options = loadRtpPrintNameOptions()) {
    const baseName = cleanPrintCustomerName(preview?.baseCustomerName || preview?.customerName || '') || 'Unknown Customer';
    const suffixes = [];
    if (options.department) {
        const department = stripBaseCustomerNameFromSuffix(preview?.branchName || preview?.departmentName || '', baseName);
        if (department && !/^all branches\s*\/\s*departments$/i.test(department) && department.toLowerCase() !== baseName.toLowerCase()) {
            suffixes.push(department);
        }
    }
    if (options.model) {
        const model = cleanMachineIdentityValue(stripBaseCustomerNameFromSuffix(preview?.machineModel || '', baseName), { skipNoMachine: true, skipNA: true });
        if (model && !/^multiple\s+machines?$/i.test(model)) suffixes.push(model);
    }
    if (options.serial) {
        const serial = cleanMachineIdentityValue(stripBaseCustomerNameFromSuffix(preview?.machineSerial || '', baseName), { skipNA: true });
        if (serial && !/^multiple\s+machines?$/i.test(serial)) suffixes.push(serial);
    }

    const uniqueSuffixes = [];
    const seen = new Set([baseName.toLowerCase()]);
    suffixes.forEach((suffix) => {
        const key = suffix.toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        uniqueSuffixes.push(suffix);
    });
    return uniqueSuffixes.length ? `${baseName} - ${uniqueSuffixes.join(' - ')}` : baseName;
}

function decorateRtpPrintPayload(preview, options = loadRtpPrintNameOptions()) {
    if (!preview) return null;
    return {
        ...preview,
        customerName: formatRtpInvoiceCustomerName(preview, options)
    };
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

function getDateMonthKey(value) {
    const date = asValidDate(value);
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
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

function firstIsoDate(...values) {
    for (const value of values) {
        const date = asValidDate(value);
        const formatted = formatIsoDate(date);
        if (formatted) return formatted;
    }
    return '';
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
    const updateMask = options.mode === 'patch'
        ? `&${Object.keys(fields).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&')}`
        : '';
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}${updateMask}`, {
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

function getCurrentUserAudit() {
    const user = window.MargaAuth?.getUser ? window.MargaAuth.getUser() : null;
    return {
        id: String(user?.id || user?.staff_id || user?.username || '').trim(),
        name: String(user?.name || user?.username || 'Marga user').trim(),
        role: String(user?.role || '').trim()
    };
}

function resizeImageFileToDataUrl(file, { maxSide = 1280, quality = 0.72 } = {}) {
    return new Promise((resolve, reject) => {
        if (!file) {
            resolve({ dataUrl: '', name: '', type: '' });
            return;
        }
        if (!String(file.type || '').startsWith('image/')) {
            reject(new Error('Upload an image file for actual spoilage proof.'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Unable to read the spoilage proof image.'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('Unable to process the spoilage proof image.'));
            image.onload = () => {
                const ratio = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round((image.width || 1) * ratio));
                canvas.height = Math.max(1, Math.round((image.height || 1) * ratio));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                if (dataUrl.length > 850000) {
                    reject(new Error('Spoilage proof image is still too large. Please upload a smaller photo.'));
                    return;
                }
                resolve({
                    dataUrl,
                    name: String(file.name || 'spoilage-proof.jpg').trim(),
                    type: 'image/jpeg'
                });
            };
            image.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
    });
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
    actualSpoilagePages = 0,
    applyQuota = true,
    quotaBypassReason = '',
    billingMode = 'single_meter_rtp',
    linesSignature = ''
} = {}) {
    return {
        invoiceNo: normalizeInvoiceNumber(invoiceNo),
        previousMeter: Math.max(0, Number(previousMeter || 0) || 0),
        presentMeter: Math.max(0, Number(presentMeter || 0) || 0),
        spoilagePercent: Number((Number(spoilagePercent || 0) || 0).toFixed(2)),
        actualSpoilagePages: Math.max(0, Number(actualSpoilagePages || 0) || 0),
        applyQuota: applyQuota !== false,
        quotaBypassReason: String(applyQuota === false && !String(quotaBypassReason || '').trim()
            ? 'Quota unchecked - reason not entered'
            : quotaBypassReason || '').trim(),
        billingMode: String(billingMode || 'single_meter_rtp').trim() || 'single_meter_rtp',
        linesSignature: String(linesSignature || '').trim()
    };
}

function getLegacyBillingConsumption(doc) {
    return Math.max(
        0,
        Number(doc?.field_total_consumed || 0) || 0,
        Number(doc?.consumption || 0) || 0,
        Number(doc?.total_consumption || 0) || 0,
        Number(doc?.billing_total_pages || 0) || 0,
        Number(doc?.total_pages || 0) || 0,
        Number(doc?.billed_pages || 0) || 0
    );
}

function getLegacyBillingPageBreakdown(doc) {
    const rawPages = Math.max(
        0,
        Number(doc?.field_total_consumed || 0) || 0,
        Number(doc?.consumption || 0) || 0,
        Number(doc?.billing_total_pages || 0) || 0,
        Number(doc?.total_pages || 0) || 0
    );
    const spoilagePages = Math.max(
        0,
        Number(doc?.spoilage_pages || 0) || 0,
        Number(doc?.spoilage || 0) || 0
    );
    const netPages = Math.max(
        0,
        Number(doc?.total_consumption || 0) || 0,
        Number(doc?.net_consumption || 0) || 0,
        rawPages - spoilagePages
    );
    return { rawPages, spoilagePages, netPages };
}

function billingSnapshotFromDoc(doc, fallback = {}) {
    const spoilagePercent = doc?.spoilage_percent !== undefined && doc?.spoilage_percent !== null && doc?.spoilage_percent !== ''
        ? Number(doc.spoilage_percent || 0)
        : Number(doc?.spoilage_rate || 0) * 100;
    const fallbackPrevious = Math.max(0, Number(fallback.previousMeter || 0) || 0);
    const savedPrevious = Number(doc?.field_previous_meter ?? doc?.previous_meter ?? 0) || 0;
    const previousMeter = savedPrevious > 0 ? savedPrevious : fallbackPrevious;
    const savedPresent = Number(doc?.field_present_meter ?? doc?.present_meter ?? 0) || 0;
    const presentMeter = savedPresent > 0
        ? savedPresent
        : fallback.presentMeter;
    return billingSnapshotFromValues({
        invoiceNo: getBillingDocInvoiceRef(doc) || fallback.invoiceNo,
        previousMeter,
        presentMeter,
        spoilagePercent: Number.isFinite(spoilagePercent) ? spoilagePercent : fallback.spoilagePercent,
        actualSpoilagePages: Number(doc?.actual_spoilage_pages ?? fallback.actualSpoilagePages ?? 0) || 0,
        applyQuota: doc?.apply_quota === undefined ? (fallback.applyQuota ?? true) : doc.apply_quota !== false,
        quotaBypassReason: doc?.quota_bypass_reason ?? fallback.quotaBypassReason ?? '',
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
        && a.actualSpoilagePages === b.actualSpoilagePages
        && a.applyQuota === b.applyQuota
        && a.quotaBypassReason === b.quotaBypassReason
        && a.billingMode === b.billingMode
        && (!a.linesSignature || !b.linesSignature || a.linesSignature === b.linesSignature);
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

function getBillingDraftGroupId(row, monthKey, billingMode = 'multi_machine_rtp') {
    return slugFirestoreId([
        billingMode,
        monthKey,
        row?.company_id || row?.row_id || row?.company_name || row?.account_name || 'customer'
    ].join('__'));
}

function getBillingDraftLineKey(row) {
    return String(row?.contractmain_id || row?.machine_id || row?.row_id || row?.branch_id || '').trim();
}

function getBillingDraftDocId(draftGroupId, row) {
    return `billing_draft_${slugFirestoreId(`${draftGroupId}__${getBillingDraftLineKey(row) || 'line'}`)}`;
}

async function loadBillingDraftLines(row, monthKey, billingMode = 'multi_machine_rtp') {
    const draftGroupId = getBillingDraftGroupId(row, monthKey, billingMode);
    if (!draftGroupId) return new Map();
    const docs = await queryFirestoreEquals(BILLING_DRAFTS_COLLECTION, 'draft_group_id', draftGroupId).catch((error) => {
        console.warn('Unable to load billing draft lines.', error);
        return [];
    });
    const byLineKey = new Map();
    docs.forEach((doc) => {
        const key = String(doc?.line_key || doc?.contractmain_id || doc?.machine_id || '').trim();
        if (key) byLineKey.set(key, doc);
    });
    return byLineKey;
}

async function saveBillingDraftLine({ rootRow, lineRow, context, mode, index, line, invoiceNo = '' }) {
    if (!rootRow || !lineRow || !context || !line) return null;
    const draftGroupId = getBillingDraftGroupId(rootRow, context.monthKey, mode);
    const lineKey = getBillingDraftLineKey(lineRow);
    if (!draftGroupId || !lineKey) return null;
    const audit = getCurrentUserAudit();
    const nowIso = new Date().toISOString();
    const docId = getBillingDraftDocId(draftGroupId, lineRow);
    const fields = {
        draft_group_id: draftGroupId,
        line_key: lineKey,
        billing_mode: mode,
        month_key: context.monthKey,
        month_label: context.monthLabel,
        invoice_no: normalizeInvoiceNumber(invoiceNo),
        company_id: String(lineRow.company_id || rootRow.company_id || '').trim(),
        company_name: String(lineRow.company_name || rootRow.company_name || rootRow.account_name || '').trim(),
        branch_id: String(lineRow.branch_id || '').trim(),
        branch_name: String(lineRow.branch_name || '').trim(),
        contractmain_id: String(lineRow.contractmain_id || '').trim(),
        machine_id: String(lineRow.machine_id || '').trim(),
        serial_number: String(lineRow.serial_number || '').trim(),
        machine_label: String(lineRow.machine_label || '').trim(),
        line_index: Number(index || 0),
        previous_meter: Number(line.previousMeter || 0) || 0,
        present_meter: Number(line.presentMeter || 0) || 0,
        spoilage_percent: Number(line.spoilagePercent || 0) || 0,
        monthly_quota: Number(line.monthlyQuota || 0) || 0,
        page_rate: Number(line.pageRate || 0) || 0,
        succeeding_rate: Number(line.succeedingRate || line.pageRate || 0) || 0,
        raw_pages: Number(line.rawPages || 0) || 0,
        net_pages: Number(line.netPages || 0) || 0,
        amount_due_preview: Number(line.amountDue || 0) || 0,
        status: 'draft',
        source_module: 'billing_dashboard',
        updated_at: nowIso,
        updated_by: audit.name,
        updated_by_id: audit.id
    };
    return setFirestoreDocument(BILLING_DRAFTS_COLLECTION, docId, fields, {
        mode: 'set',
        label: `Billing draft ${fields.branch_name || lineKey}`,
        dedupeKey: `${BILLING_DRAFTS_COLLECTION}:${docId}:${nowIso}`
    });
}

async function markBillingDraftGroupSaved(row, monthKey, billingMode, invoiceNo) {
    const draftGroupId = getBillingDraftGroupId(row, monthKey, billingMode);
    if (!draftGroupId) return;
    const docs = await queryFirestoreEquals(BILLING_DRAFTS_COLLECTION, 'draft_group_id', draftGroupId).catch(() => []);
    const audit = getCurrentUserAudit();
    const nowIso = new Date().toISOString();
    await Promise.allSettled(docs.map((doc) => {
        if (!doc?._docId) return null;
        return setFirestoreDocument(BILLING_DRAFTS_COLLECTION, doc._docId, {
            status: 'saved_to_billing',
            invoice_no: normalizeInvoiceNumber(invoiceNo),
            saved_at: nowIso,
            saved_by: audit.name,
            updated_at: nowIso,
            updated_by: audit.name
        }, {
            mode: 'patch',
            label: `Close billing draft ${doc._docId}`,
            dedupeKey: `${BILLING_DRAFTS_COLLECTION}:${doc._docId}:saved:${nowIso}`
        });
    }));
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

function uniqueScheduleValues(values = []) {
    return Array.from(new Set(
        values
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
}

function getPlannerField(fields = {}, keys = []) {
    for (const key of keys) {
        const value = fields?.[key];
        if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    }
    return '';
}

function normalizePlannerDate(date = new Date()) {
    return formatIsoDate(date instanceof Date ? date : new Date());
}

function buildBillingPlannerGroups(result, row, context, snapshot, estimate) {
    const docs = Array.isArray(result?.docs) && result.docs.length
        ? result.docs
        : [{
            docId: result?.docId || '',
            invoiceNo: result?.invoiceNo || snapshot?.invoiceNo || '',
            fields: result?.fields || {}
        }];
    const groups = new Map();
    const invoiceNo = normalizeInvoiceNumber(result?.invoiceNo || snapshot?.invoiceNo);
    const monthKey = String(context?.monthKey || '').trim();

    docs.forEach((entry) => {
        const fields = entry?.fields || {};
        const companyId = String(getPlannerField(fields, ['company_id']) || row?.company_id || '').trim();
        const companyName = String(getPlannerField(fields, ['company_name', 'account_name', 'display_name']) || row?.company_name || row?.account_name || '').trim();
        const groupKey = `${invoiceNo || 'invoice'}:${monthKey || 'month'}:${companyId || companyName || entry?.docId || row?.row_id || 'customer'}`;
        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                key: groupKey,
                invoiceNo,
                monthKey,
                companyId,
                companyName,
                accountName: String(getPlannerField(fields, ['account_name', 'display_name']) || row?.account_name || companyName || '').trim(),
                amountDue: 0,
                billingDocIds: [],
                contractIds: [],
                machineIds: [],
                serialNumbers: [],
                branchIds: [],
                branchNames: [],
                lineCount: 0
            });
        }
        const group = groups.get(groupKey);
        const branchId = String(getPlannerField(fields, ['branch_id']) || row?.branch_id || '').trim();
        const branchName = String(getPlannerField(fields, ['branch_name']) || row?.branch_name || '').trim();
        const contractId = String(getPlannerField(fields, ['contractmain_id']) || row?.contractmain_id || '').trim();
        const machineId = String(getPlannerField(fields, ['machine_id']) || row?.machine_id || '').trim();
        const serialNumber = String(getPlannerField(fields, ['serial_number']) || row?.serial_number || '').trim();
        group.billingDocIds.push(String(entry?.docId || '').trim());
        group.contractIds.push(contractId);
        group.machineIds.push(machineId);
        group.serialNumbers.push(serialNumber);
        group.branchIds.push(branchId);
        group.branchNames.push(branchName);
        group.amountDue += Number(fields?.billing_group_invoice_total || fields?.totalamount || fields?.amount || 0) || 0;
        group.lineCount += 1;
    });

    const groupList = Array.from(groups.values());
    return groupList.map((group) => {
        const branchIds = uniqueScheduleValues(group.branchIds);
        const branchNames = uniqueScheduleValues(group.branchNames);
        const totalAmount = groupList.length === 1
            ? (Number(estimate?.amountDue || 0) || group.amountDue)
            : group.amountDue;
        return {
            ...group,
            amountDue: totalAmount,
            billingDocIds: uniqueScheduleValues(group.billingDocIds),
            contractIds: uniqueScheduleValues(group.contractIds),
            machineIds: uniqueScheduleValues(group.machineIds),
            serialNumbers: uniqueScheduleValues(group.serialNumbers),
            branchIds,
            branchNames,
            primaryBranchId: branchIds[0] || '',
            primaryBranchName: branchNames[0] || 'Main'
        };
    });
}

async function resolveBillingPlannerArea(group) {
    const branchId = String(group?.primaryBranchId || '').trim();
    if (!branchId) return { areaId: '', areaName: '', rule: null };

    try {
        const branch = await getFirestoreDocument('tbl_branchinfo', branchId);
        const areaId = String(branch?.area_id || branch?.areaid || '').trim();
        let areaName = '';
        if (areaId) {
            try {
                const area = await getFirestoreDocument('tbl_area', areaId);
                areaName = String(area?.area_name || area?.areaname || area?.name || '').trim();
            } catch (error) {
                console.warn('Schedule planner area name lookup failed.', error);
            }
        }

        let rule = null;
        const ruleIds = uniqueScheduleValues([
            areaId ? `area_${slugFirestoreId(areaId)}` : '',
            areaName ? `area_${slugFirestoreId(areaName)}` : '',
            areaId,
            areaName
        ]);
        for (const ruleId of ruleIds) {
            try {
                rule = await getFirestoreDocument(SCHEDULE_AREA_RULES_COLLECTION, ruleId);
                if (rule) break;
            } catch (error) {
                console.warn('Schedule planner area rule lookup failed.', error);
            }
        }

        return { areaId, areaName, rule };
    } catch (error) {
        console.warn('Schedule planner branch area lookup failed.', error);
        return { areaId: '', areaName: '', rule: null };
    }
}

function getScheduleRuleAssignment(rule) {
    if (!rule) return { staffId: '', staffName: '', basis: 'no_area_rule' };
    const staffId = String(
        rule.default_messenger_id
        || rule.messenger_id
        || rule.default_staff_id
        || rule.staff_id
        || ''
    ).trim();
    const staffName = String(
        rule.default_messenger_name
        || rule.messenger_name
        || rule.default_staff_name
        || rule.staff_name
        || ''
    ).trim();
    return {
        staffId,
        staffName,
        basis: staffId || staffName ? 'area_rule' : 'area_rule_without_staff'
    };
}

function buildSchedulePlannerDocId(group) {
    return `billing_invoice_${slugFirestoreId([
        group?.invoiceNo || 'invoice',
        group?.monthKey || 'month',
        group?.companyId || group?.companyName || 'customer'
    ].join('_'))}`;
}

function buildBillingScheduleTaskDocId(plannerDocId) {
    return `billing_task_${slugFirestoreId(plannerDocId || Date.now())}`;
}

function buildScheduleTaskDateTime(date, time) {
    const safeDate = String(date || '').trim() || formatIsoDate(new Date());
    const safeTime = String(time || '').trim() || '08:00';
    return `${safeDate} ${safeTime.length === 5 ? `${safeTime}:00` : safeTime}`;
}

function firstNumericValue(...values) {
    for (const value of values) {
        const numeric = Number(value || 0);
        if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric);
    }
    return 0;
}

function getBillingSchedulePurpose(keyOrLabel = '') {
    const normalized = String(keyOrLabel || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized === 'reading' || normalized === 'meter_reading') return BILLING_SCHEDULE_PURPOSES.reading;
    return BILLING_SCHEDULE_PURPOSES.printed_billing;
}

function getBillingSchedulePurposeFromEstimate(estimate = {}) {
    return getBillingSchedulePurpose(estimate?.schedulePurposeKey || estimate?.schedulePurpose || estimate?.scheduleType);
}

function buildReadingSchedulePlannerDocId(row, context) {
    return `billing_reading_${slugFirestoreId([
        context?.monthKey || 'month',
        row?.contractmain_id || row?.machine_id || row?.serial_number || 'machine',
        row?.company_id || row?.company_name || 'customer'
    ].join('_'))}`;
}

async function saveReadingToSchedulePlanner({ row, context, estimate }) {
    const purpose = BILLING_SCHEDULE_PURPOSES.reading;
    const now = new Date();
    const { areaId, areaName, rule } = await resolveBillingPlannerArea({
        primaryBranchId: String(row?.branch_id || '').trim(),
        primaryBranchName: String(row?.branch_name || '').trim(),
        branchIds: [String(row?.branch_id || '').trim()].filter(Boolean),
        branchNames: [String(row?.branch_name || '').trim()].filter(Boolean),
        companyName: row?.company_name || row?.account_name || row?.display_name || ''
    });
    const assignment = getScheduleRuleAssignment(rule);
    const docId = buildReadingSchedulePlannerDocId(row, context);
    const fields = {
        id: docId,
        source_module: 'billing',
        source_action: purpose.sourceAction,
        source_collection: '',
        source_doc_ids: [],
        source_doc_ids_json: '[]',
        source_record_key: `${context?.monthKey || ''}:${row?.contractmain_id || row?.machine_id || row?.serial_number || ''}`,
        department: 'billing',
        purpose: purpose.label,
        schedule_purpose: purpose.label,
        task_type: purpose.taskType,
        task_label: purpose.taskLabel,
        required_role: 'messenger',
        planner_status: 'scheduled',
        task_status: 'scheduled',
        route_status: 'scheduled',
        priority: 'normal',
        requested_date: normalizePlannerDate(now),
        preferred_schedule_date: String(estimate?.scheduleDate || '').trim(),
        schedule_date: String(estimate?.scheduleDate || '').trim(),
        schedule_time: String(estimate?.scheduleTime || '').trim(),
        schedule_type: purpose.label,
        billing_month_key: context?.monthKey || '',
        billing_month_label: formatMonthLabel(context?.monthKey, context?.monthKey),
        company_id: String(row?.company_id || '').trim(),
        company_name: String(row?.company_name || row?.account_name || row?.display_name || '').trim(),
        account_name: String(row?.account_name || row?.display_name || row?.company_name || '').trim(),
        primary_branch_id: String(row?.branch_id || '').trim(),
        primary_branch_name: String(row?.branch_name || '').trim(),
        branch_ids: [String(row?.branch_id || '').trim()].filter(Boolean),
        branch_ids_json: JSON.stringify([String(row?.branch_id || '').trim()].filter(Boolean)),
        branch_names_json: JSON.stringify([String(row?.branch_name || '').trim()].filter(Boolean)),
        branch_count: row?.branch_id ? 1 : 0,
        line_count: 1,
        contractmain_ids: [String(row?.contractmain_id || '').trim()].filter(Boolean),
        contractmain_ids_json: JSON.stringify([String(row?.contractmain_id || '').trim()].filter(Boolean)),
        machine_ids: [String(row?.machine_id || '').trim()].filter(Boolean),
        machine_ids_json: JSON.stringify([String(row?.machine_id || '').trim()].filter(Boolean)),
        serial_numbers_json: JSON.stringify([String(row?.serial_number || '').trim()].filter(Boolean)),
        model: String(row?.machine_label || '').trim(),
        serial: String(row?.serial_number || '').trim(),
        area_id: areaId,
        area_name: areaName,
        suggested_staff_id: assignment.staffId,
        suggested_staff_name: assignment.staffName,
        suggested_messenger_id: assignment.staffId,
        suggested_messenger_name: assignment.staffName,
        assignment_basis: assignment.basis,
        assigned_staff_id: String(estimate?.scheduleAssignedStaffId || '').trim(),
        assigned_staff_name: String(estimate?.scheduleAssignedStaffName || '').trim(),
        assigned_to_id: String(estimate?.scheduleAssignedStaffId || '').trim(),
        assigned_to: String(estimate?.scheduleAssignedStaffName || '').trim(),
        assigned_by: '',
        assigned_at: '',
        scheduler_locked: false,
        published: false,
        completed_at: '',
        completion_notes: '',
        notes: `${purpose.notesVerb}${row?.branch_name ? ` at ${row.branch_name}` : ''}${row?.serial_number ? ` (${row.serial_number})` : ''}.`,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
    };
    const saveResult = await setFirestoreDocument(SCHEDULE_PLANNER_COLLECTION, docId, fields, {
        mode: 'set',
        label: `Reading schedule ${row?.serial_number || docId}`,
        dedupeKey: `${SCHEDULE_PLANNER_COLLECTION}:${docId}`
    });
    return { ...saveResult, docId, fields, docs: [{ ...saveResult, docId, fields }], savedCount: 1 };
}

async function saveBillingToSchedulePlanner({ result, row, context, estimate, snapshot }) {
    const purpose = getBillingSchedulePurposeFromEstimate(estimate);
    const groups = buildBillingPlannerGroups(result, row, context, snapshot, estimate);
    if (!groups.length) return { ok: true, queued: false, savedCount: 0, docs: [] };

    const now = new Date();
    const today = normalizePlannerDate(now);
    const savedDocs = [];

    for (const group of groups) {
        const { areaId, areaName, rule } = await resolveBillingPlannerArea(group);
        const assignment = getScheduleRuleAssignment(rule);
        const docId = buildSchedulePlannerDocId(group);
        const fields = {
            id: docId,
            source_module: 'billing',
            source_action: purpose.sourceAction,
            source_collection: 'tbl_billing',
            source_doc_ids: group.billingDocIds,
            source_doc_ids_json: JSON.stringify(group.billingDocIds),
            source_record_key: `${group.invoiceNo || ''}:${group.monthKey || ''}:${group.companyId || group.companyName || ''}`,
            department: 'billing',
            purpose: purpose.label,
            schedule_purpose: purpose.label,
            task_type: purpose.taskType,
            task_label: purpose.taskLabel,
            required_role: 'messenger',
            planner_status: estimate?.scheduleSaved ? 'scheduled' : 'suggested',
            task_status: estimate?.scheduleSaved ? 'scheduled' : 'pending_scheduler',
            route_status: estimate?.scheduleSaved ? 'scheduled' : 'unscheduled',
            priority: 'normal',
            requested_date: today,
            preferred_schedule_date: today,
            schedule_date: String(estimate?.scheduleDate || '').trim(),
            schedule_time: String(estimate?.scheduleTime || '').trim(),
            schedule_type: purpose.label,
            invoice_no: group.invoiceNo,
            billing_month_key: group.monthKey,
            billing_month_label: formatMonthLabel(group.monthKey, group.monthKey),
            amount_due: Number(group.amountDue || 0) || 0,
            company_id: group.companyId,
            company_name: group.companyName,
            account_name: group.accountName || group.companyName,
            primary_branch_id: group.primaryBranchId,
            primary_branch_name: group.primaryBranchName,
            branch_ids: group.branchIds,
            branch_ids_json: JSON.stringify(group.branchIds),
            branch_names_json: JSON.stringify(group.branchNames),
            branch_count: group.branchIds.length,
            line_count: group.lineCount,
            contractmain_ids: group.contractIds,
            contractmain_ids_json: JSON.stringify(group.contractIds),
            machine_ids: group.machineIds,
            machine_ids_json: JSON.stringify(group.machineIds),
            serial_numbers_json: JSON.stringify(group.serialNumbers),
            area_id: areaId,
            area_name: areaName,
            suggested_staff_id: assignment.staffId,
            suggested_staff_name: assignment.staffName,
            suggested_messenger_id: assignment.staffId,
            suggested_messenger_name: assignment.staffName,
            assignment_basis: assignment.basis,
            assigned_staff_id: String(estimate?.scheduleAssignedStaffId || '').trim(),
            assigned_staff_name: String(estimate?.scheduleAssignedStaffName || '').trim(),
            assigned_by: '',
            assigned_at: '',
            transfer_count: 0,
            transfer_reason: '',
            scheduler_locked: false,
            published: false,
            completed_at: '',
            completion_notes: '',
            notes: `${purpose.notesVerb} ${group.invoiceNo || ''}${group.primaryBranchName ? ` to ${group.primaryBranchName}` : ''}.`,
            created_at: now.toISOString(),
            updated_at: now.toISOString()
        };
        const saveResult = await setFirestoreDocument(SCHEDULE_PLANNER_COLLECTION, docId, fields, {
            mode: 'set',
            label: `Schedule planner invoice ${group.invoiceNo || docId}`,
            dedupeKey: `${SCHEDULE_PLANNER_COLLECTION}:${docId}`
        });
        savedDocs.push({ ...saveResult, docId, fields });
    }

    return {
        ok: savedDocs.every((entry) => entry.ok !== false),
        queued: savedDocs.some((entry) => entry.queued),
        savedCount: savedDocs.length,
        docs: savedDocs
    };
}

async function saveBillingScheduleToFieldTask({ plannerDocId, row, context, estimate, purpose, staffId, staffName, auditName = '' }) {
    const taskDocId = buildBillingScheduleTaskDocId(plannerDocId);
    const nowIso = new Date().toISOString();
    const scheduleDate = String(estimate?.scheduleDate || '').trim();
    const scheduleTime = String(estimate?.scheduleTime || '').trim();
    const taskDateTime = buildScheduleTaskDateTime(scheduleDate, scheduleTime);
    const taskId = firstNumericValue(
        estimate?.scheduleTaskId,
        String(taskDocId).replace(/\D/g, '').slice(-12),
        Date.now()
    );
    const branchId = firstNumericValue(row?.branch_id, row?.primaryBranchId);
    const companyId = firstNumericValue(row?.company_id);
    const machineId = firstNumericValue(row?.machine_id);
    const contractId = firstNumericValue(row?.contractmain_id);
    const purposeId = purpose?.key === 'reading' ? 8 : 1;
    const troubleLabel = purpose?.key === 'reading' ? 'Get Meter Reading' : 'Deliver Invoice';
    const fields = {
        id: taskId,
        source_module: 'billing',
        source_planner_doc_id: plannerDocId,
        task_datetime: taskDateTime,
        original_sched: taskDateTime,
        tech_id: Number(staffId || 0) || staffId,
        purpose_id: purposeId,
        purpose: purpose?.label || 'Printed Billing',
        schedule_purpose: purpose?.label || 'Printed Billing',
        trouble: troubleLabel,
        trouble_id: 0,
        caller: `${purpose?.label || 'Printed Billing'} - ${row?.company_name || row?.account_name || row?.display_name || ''}`.trim(),
        remarks: `${troubleLabel}${row?.branch_name ? ` for ${row.branch_name}` : ''}${row?.serial_number ? ` (${row.serial_number})` : ''}.`,
        branch_id: branchId,
        company_id: companyId,
        contractmain_id: contractId,
        serial: machineId,
        mach_id: machineId,
        machine_id: machineId,
        field_serial_selected: String(row?.serial_number || '').trim(),
        machine_model: String(row?.machine_label || '').trim(),
        branch_name: String(row?.branch_name || '').trim(),
        company_name: String(row?.company_name || row?.account_name || row?.display_name || '').trim(),
        area_id: firstNumericValue(row?.area_id),
        date_finished: '0000-00-00 00:00:00',
        iscancel: 0,
        iscancelled: 0,
        isongoing: 0,
        pending_parts: 0,
        master_schedule_status: 'open',
        master_schedule_status_label: 'Open',
        field_billing_schedule_doc_id: plannerDocId,
        field_billing_assigned_staff_id: String(staffId || '').trim(),
        field_billing_assigned_staff_name: String(staffName || '').trim(),
        inserted_by: auditName,
        created_at: nowIso,
        updated_at: nowIso,
        bridge_updated_at: nowIso
    };
    if (estimate?.scheduleConsolidationFields && typeof estimate.scheduleConsolidationFields === 'object') {
        Object.assign(fields, estimate.scheduleConsolidationFields);
    }
    const result = await setFirestoreDocument('tbl_schedule', taskDocId, fields, {
        mode: 'set',
        label: `Field schedule ${purpose?.label || 'Billing'} ${row?.serial_number || taskDocId}`,
        dedupeKey: `tbl_schedule:${taskDocId}`
    });
    return { ...result, docId: taskDocId, taskId, fields };
}

function billingScheduleStaffName(employee) {
    if (window.MargaUtils?.getEmployeeFullName) {
        return MargaUtils.getEmployeeFullName(employee, employee?.id || employee?._docId || '');
    }
    const nickname = String(employee?.nickname || '').trim();
    const first = String(employee?.firstname || '').trim();
    const last = String(employee?.lastname || '').trim();
    return nickname || `${first} ${last}`.trim() || String(employee?.name || employee?.fullname || employee?.username || employee?.id || '').trim();
}

function billingScheduleStaffRole(employee) {
    if (window.MargaUtils?.getEmployeeDesignation) return MargaUtils.getEmployeeDesignation(employee);
    const label = String(employee?.position || employee?.position_name || employee?.position_label || employee?.role || '').toLowerCase();
    const positionId = Number(employee?.position_id || 0);
    if (positionId === 5 || label.includes('technician') || label.includes('tech')) return 'Technician';
    if (positionId === 9 || label.includes('messenger') || label.includes('driver')) return label.includes('driver') ? 'Driver' : 'Messenger';
    if (label.includes('driver')) return 'Driver';
    return label ? label.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Staff';
}

function isActiveBillingScheduleStaff(employee) {
    if (window.MargaUtils?.isOfficialActiveEmployee) return MargaUtils.isOfficialActiveEmployee(employee);
    if (!employee) return false;
    if (employee.active === false || employee.marga_active === false || employee.marga_account_active === false) return false;
    const hasActiveFlag = employee.active === true || employee.marga_active === true || employee.marga_account_active === true;
    return hasActiveFlag && Number(employee.estatus ?? 1) > 0;
}

async function loadBillingScheduleStaffOptions() {
    const employees = await MargaUtils.fetchCollection('tbl_employee').catch((error) => {
        console.warn('Unable to load schedule staff options.', error);
        return [];
    });
    const options = window.MargaUtils?.filterEmployeeAssignmentOptions
        ? MargaUtils.filterEmployeeAssignmentOptions(employees, {
            includeRoleKeys: ['billing', 'collection', 'technician', 'messenger', 'driver']
        }).map((employee) => ({
            id: String(employee.id || '').trim(),
            name: employee.name,
            role: employee.designation || employee.role || 'Staff',
            roleKey: employee.roleKey || ''
        }))
        : employees
            .filter(isActiveBillingScheduleStaff)
            .map((employee) => ({
            id: String(employee.id || employee._docId || '').trim(),
            name: billingScheduleStaffName(employee),
            role: billingScheduleStaffRole(employee),
            roleKey: window.MargaUtils?.getEmployeeRoleKey ? MargaUtils.getEmployeeRoleKey(employee) : ''
            }))
        .filter((employee) => employee.id && employee.name);
    const scheduleOptions = options.filter((employee) => ['billing', 'collection', 'technician', 'messenger', 'driver'].includes(employee.roleKey));
    return (scheduleOptions.length ? scheduleOptions : options)
        .sort((left, right) => `${left.name} ${left.role}`.localeCompare(`${right.name} ${right.role}`));
}

function renderBillingScheduleStaffOptions(options = [], selectedId = '') {
    const selected = String(selectedId || '').trim();
    return [
        '<option value="">Select employee</option>',
        ...options.map((staff) => `<option value="${escapeHtml(staff.id)}"${staff.id === selected ? ' selected' : ''}>${escapeHtml(staff.name)} - ${escapeHtml(staff.role)}</option>`)
    ].join('');
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

function sanitizeBillingLineItem(line = {}) {
    const { lineItems, row, profile, current, previous, ...rest } = line || {};
    return Object.fromEntries(Object.entries(rest).filter(([, value]) => (
        value === null
        || ['string', 'number', 'boolean'].includes(typeof value)
        || Array.isArray(value)
        || (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    )));
}

function buildBillingRecordFields({ row, context, estimate, snapshot, docId }) {
    const period = buildBillingPeriod(context?.monthKey, row?.reading_day);
    const parsedMonth = parseMonthInput(context?.monthKey);
    const now = new Date();
    const sqlNow = toSqlDateTime(now);
    const audit = getCurrentUserAudit();
    const numericAuditId = Number(audit.id);
    const dueDate = period.to ? `${period.to} 00:00:00` : sqlNow;
    const numericInvoice = /^\d+$/.test(snapshot.invoiceNo) ? Number(snapshot.invoiceNo) : null;
    const numericContractId = Number(row?.contractmain_id || 0);
    const numericDocId = Number(docId);
    const lineItems = (Array.isArray(estimate?.lineItems) ? estimate.lineItems : [])
        .map((line) => sanitizeBillingLineItem(line));
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
        tmestamp: sqlNow,
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
        system_spoilage_pages: Number(estimate?.systemSpoilagePages ?? estimate?.spoilagePages ?? 0) || 0,
        actual_spoilage_pages: Number(estimate?.actualSpoilagePages || 0) || 0,
        total_spoilage_pages: Number(estimate?.totalSpoilagePages ?? estimate?.spoilagePages ?? 0) || 0,
        spoilage_pages: Number(estimate?.totalSpoilagePages ?? estimate?.spoilagePages ?? 0) || 0,
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
        schedule_required: true,
        schedule_saved: Boolean(estimate?.scheduleSaved),
        schedule_doc_id: String(estimate?.scheduleDocId || '').trim(),
        schedule_date: String(estimate?.scheduleDate || '').trim(),
        schedule_time: String(estimate?.scheduleTime || '').trim(),
        schedule_type: getBillingSchedulePurposeFromEstimate(estimate).label,
        schedule_purpose: getBillingSchedulePurposeFromEstimate(estimate).label,
        schedule_purpose_key: getBillingSchedulePurposeFromEstimate(estimate).key,
        schedule_assigned_staff_id: String(estimate?.scheduleAssignedStaffId || '').trim(),
        schedule_assigned_staff_name: String(estimate?.scheduleAssignedStaffName || '').trim(),
        emp_id: Number.isFinite(numericAuditId) && numericAuditId > 0 ? numericAuditId : String(audit.id || '').trim(),
        saved_at: now.toISOString(),
        prepared_at: now.toISOString(),
        prepared_by_id: String(audit.id || '').trim(),
        prepared_by: String(audit.name || '').trim(),
        saved_by_id: String(audit.id || '').trim(),
        saved_by: String(audit.name || '').trim(),
        billing_printed_at: '',
        billing_printed_date: '',
        billing_printed_by_id: '',
        billing_printed_by: '',
        billing_print_channel: '',
        billing_print_count: 0,
        printed_by_id: String(audit.id || '').trim(),
        printed_by: String(audit.name || '').trim(),
        updated_by_id: String(audit.id || '').trim(),
        updated_by: String(audit.name || '').trim(),
        actual_spoilage_reason: String(estimate?.actualSpoilageReason || '').trim(),
        actual_spoilage_proof_name: String(estimate?.actualSpoilageProofName || '').trim(),
        actual_spoilage_proof_type: String(estimate?.actualSpoilageProofType || '').trim(),
        actual_spoilage_proof_image: String(estimate?.actualSpoilageProofImage || '').trim(),
        actual_spoilage_requested_by: String(estimate?.actualSpoilageRequestedBy || '').trim(),
        actual_spoilage_requested_at: String(estimate?.actualSpoilageRequestedAt || '').trim(),
        apply_quota: estimate?.applyQuota !== false,
        quota_bypassed: estimate?.quotaBypassed === true,
        quota_bypass_reason: String(estimate?.applyQuota === false && !String(estimate?.quotaBypassReason || '').trim()
            ? 'Quota unchecked - reason not entered'
            : estimate?.quotaBypassReason || '').trim(),
        approval_status: Number(estimate?.actualSpoilagePages || 0) > 0
            ? String(estimate?.approvalStatus || 'pending').trim()
            : 'none',
        approval_note: String(estimate?.approvalNote || '').trim(),
        approved_by: String(estimate?.approvedBy || '').trim(),
        approved_at: String(estimate?.approvedAt || '').trim(),
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

    const requestedLines = Array.isArray(estimate?.lineItems) ? estimate.lineItems : [];
    const lines = requestedLines
        .map((line) => ({
            ...line,
            row: getLineRowForBilling(line, row)
        }))
        .filter((line) => line?.row?.contractmain_id && !line.missingMeterSource && !isNonBillableMeterFormula(line.formula));
    if (!lines.length) {
        const hasContractRows = requestedLines.some((line) => getLineRowForBilling(line, row)?.contractmain_id);
        const hasPendingReadings = requestedLines.some((line) => line?.missingMeterSource || isNonBillableMeterFormula(line?.formula));
        if (hasContractRows && hasPendingReadings) {
            throw new Error('No billable machine lines are ready for this grouped invoice. Enter the present reading for at least one grouped machine line, or use Single Meter RTP for a separate contract invoice.');
        }
        throw new Error('No machine contract lines are available to save for this grouped invoice. Use Single Meter RTP for separate contract billing.');
    }

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
    const primaryAmount = Number(doc?.totalamount || 0) > 0
        ? Number(doc.totalamount || 0)
        : Number(doc?.amount || 0);
    const secondaryAmount = Number(doc?.totalamount2 || 0) > 0
        ? Number(doc.totalamount2 || 0)
        : Number(doc?.amount2 || 0);
    return roundBillingAmount(primaryAmount + secondaryAmount);
}

function getBillingDocNetVat(doc, profile = {}) {
    const amountDue = getBillingDocAmount(doc);
    const savedVat = Number(doc?.vatamount || doc?.vat_amount || 0) || 0;
    const savedNet = Number(doc?.netamount || doc?.net_amount || 0) || 0;
    if (amountDue > 0 && savedVat > 0 && savedNet > 0) {
        return {
            netAmount: roundBillingAmount(savedNet),
            vatAmount: roundBillingAmount(savedVat)
        };
    }
    if (amountDue > 0 && savedVat > 0) {
        return {
            netAmount: roundBillingAmount(amountDue - savedVat),
            vatAmount: roundBillingAmount(savedVat)
        };
    }
    const withVat = Boolean(profile?.with_vat);
    const netAmount = withVat ? roundBillingAmount(amountDue / 1.12) : amountDue;
    const vatAmount = withVat ? roundBillingAmount(amountDue - netAmount) : roundBillingAmount(amountDue * 0.12);
    return { netAmount, vatAmount };
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
        els.invoiceSearchResults.innerHTML = 'Search an invoice number to trace, print, or inspect receipt and collection evidence.';
        invoiceSearchGroupCache = new Map();
        return;
    }
    if (!docs.length) {
        els.invoiceSearchResults.innerHTML = `<div class="invoice-search-empty">No Margabase billing transaction found for invoice ${escapeHtml(invoiceNo)}.</div>`;
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
        els.invoiceSearchResults.innerHTML = `<div class="invoice-search-empty">Searching Margabase for invoice ${escapeHtml(invoiceNo)}...</div>`;
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

function renderInvoiceDeepSearchResults(report, invoiceText = '') {
    if (!els.invoiceSearchResults) return;
    const results = Array.isArray(report?.results) ? report.results : [];
    if (!results.length) {
        els.invoiceSearchResults.innerHTML = `<div class="invoice-search-empty">No deep-search results for ${escapeHtml(invoiceText)}.</div>`;
        return;
    }
    const foundCount = results.filter((row) => row.found).length;
    els.invoiceSearchResults.innerHTML = `
        <div class="invoice-search-count">Deep Search found ${escapeHtml(formatCount(foundCount))} of ${escapeHtml(formatCount(results.length))} invoice number${results.length === 1 ? '' : 's'} in Margabase.</div>
        <div class="invoice-deep-list">
            ${results.map((row) => {
                const receipt = row.receipt || {};
                const receiptLabel = receipt.date_received || receipt.received_by
                    ? `${receipt.date_received || '-'}${receipt.received_time ? ` ${receipt.received_time}` : ''} • ${receipt.received_by || '-'}`
                    : 'No received date/person found';
                const amount = Number(row.amount || 0) || 0;
                const paidAmount = Number(row.paid_amount || 0) || 0;
                const balance = Number(row.balance_hint || 0) || 0;
                const latestHistory = (row.collection_history || []).slice(0, 3);
                return `
                    <article class="invoice-deep-card ${row.found ? '' : 'not-found'}">
                        <div class="invoice-deep-head">
                            <div>
                                <div class="invoice-search-ref">Invoice ${escapeHtml(row.invoice_no || '')}</div>
                                <div class="invoice-search-customer">${escapeHtml(row.customer || 'No customer found')}${row.branch ? ` • ${escapeHtml(row.branch)}` : ''}</div>
                            </div>
                            <div class="invoice-search-amount">
                                <div>${escapeHtml(formatAmount(amount))}</div>
                                <span>${escapeHtml(row.billing_month || 'No billing month')}</span>
                            </div>
                        </div>
                        <div class="invoice-deep-grid">
                            <div><span>Received</span><strong>${escapeHtml(receiptLabel)}</strong></div>
                            <div><span>Receipt source</span><strong>${escapeHtml(receipt.source || '-')}</strong></div>
                            <div><span>Paid</span><strong>${escapeHtml(formatCurrency(paidAmount))}</strong></div>
                            <div><span>Balance hint</span><strong>${escapeHtml(formatCurrency(balance))}</strong></div>
                            <div><span>Billing rows</span><strong>${escapeHtml(formatCount((row.billing_rows || []).length))}</strong></div>
                            <div><span>Schedules</span><strong>${escapeHtml(formatCount((row.schedules || []).length))}</strong></div>
                            <div><span>Collection notes</span><strong>${escapeHtml(formatCount((row.collection_history || []).length))}</strong></div>
                            <div><span>Payments</span><strong>${escapeHtml(formatCount((row.payments || []).length))}</strong></div>
                        </div>
                        ${latestHistory.length ? `
                            <div class="invoice-deep-notes">
                                <div class="detail-section-title">Latest Collection Notes</div>
                                ${latestHistory.map((note) => `
                                    <div class="invoice-deep-note">
                                        <strong>${escapeHtml(note.date || note.status || 'Collection note')}</strong>
                                        <span>${escapeHtml(note.remarks || '-')}</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

async function fetchInvoiceDeepSearch(invoices = []) {
    const cleanInvoices = Array.from(new Set((Array.isArray(invoices) ? invoices : [invoices])
        .map((value) => String(value || '').trim())
        .filter(Boolean)));
    if (!cleanInvoices.length) return null;
    const response = await fetch('/.netlify/functions/billing-invoice-deep-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoices: cleanInvoices })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Deep Search failed (${response.status})`);
    }
    return payload;
}

function renderInvoiceEvidenceDetail(row = {}) {
    const receipt = row.receipt || {};
    const receivedLine = receipt.date_received || receipt.received_by
        ? `${receipt.date_received || '-'}${receipt.received_time ? ` ${receipt.received_time}` : ''} • ${receipt.received_by || '-'}`
        : 'No received date/person found';
    const notes = Array.isArray(row.collection_history) ? row.collection_history : [];
    const schedules = Array.isArray(row.schedules) ? row.schedules : [];
    return `
        <div class="detail-section-title">Receipt And Follow-Up Evidence</div>
        <div class="invoice-deep-grid">
            <div><span>Received</span><strong>${escapeHtml(receivedLine)}</strong></div>
            <div><span>Receipt source</span><strong>${escapeHtml(receipt.source || '-')}</strong></div>
            <div><span>Payments</span><strong>${escapeHtml(formatCount((row.payments || []).length))}</strong></div>
            <div><span>Collection notes</span><strong>${escapeHtml(formatCount(notes.length))}</strong></div>
        </div>
        ${schedules.length ? `
            <div class="detail-section-title">Billing Delivery Schedule</div>
            <div class="invoice-deep-note">
                <strong>${escapeHtml(schedules[0].date_finished || schedules[0].schedule_date || 'Schedule evidence')}</strong>
                <span>${escapeHtml([schedules[0].assigned_to, schedules[0].status, schedules[0].remarks].filter(Boolean).join(' • ') || '-')}</span>
            </div>
        ` : ''}
        <div class="detail-section-title">Collection Follow-Up Remarks</div>
        ${
            notes.length
                ? notes.map((note) => `
                    <div class="invoice-deep-note">
                        <strong>${escapeHtml(note.date || note.status || 'Collection note')}</strong>
                        <span>${escapeHtml(note.remarks || '-')}</span>
                    </div>
                `).join('')
                : '<div class="detail-empty">No collection follow-up remarks found for this invoice.</div>'
        }
    `;
}

async function deepSearchInvoiceNumbers() {
    const invoiceText = String(els.invoiceSearchInput?.value || '').trim();
    const invoices = invoiceText
        .split(/[^0-9A-Za-z_-]+/g)
        .map((value) => value.trim())
        .filter(Boolean);
    if (!invoices.length) {
        MargaUtils.showToast('Enter one or more invoice numbers to deep search.', 'error');
        return;
    }
    if (els.invoiceDeepSearchBtn) els.invoiceDeepSearchBtn.disabled = true;
    if (els.invoiceSearchResults) {
        els.invoiceSearchResults.innerHTML = `<div class="invoice-search-empty">Deep searching ${escapeHtml(formatCount(invoices.length))} invoice number${invoices.length === 1 ? '' : 's'} in Margabase...</div>`;
    }
    try {
        const payload = await fetchInvoiceDeepSearch(invoices);
        renderInvoiceDeepSearchResults(payload, invoiceText);
    } catch (error) {
        console.error('Unable to deep search invoices.', error);
        if (els.invoiceSearchResults) {
            els.invoiceSearchResults.innerHTML = `<div class="invoice-search-empty error">Unable to deep search invoices. ${escapeHtml(error.message || '')}</div>`;
        }
    } finally {
        if (els.invoiceDeepSearchBtn) els.invoiceDeepSearchBtn.disabled = false;
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

function collectInvoiceSerialNumbers(rows = []) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : [])
        .map((row) => cleanMachineIdentityValue(row?.serial_number || row?.xserial || row?.machine_serial || '', { skipNA: true }))
        .filter(Boolean)
        .filter((serial) => {
            const key = serial.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function formatInvoicePrinterModelValue({ modelName = '', serialNumber = '', serialNumbers = [] } = {}) {
    const serial = cleanMachineIdentityValue(serialNumber, { skipNA: true });
    if (serial) return serial;
    const groupedSerial = collectInvoiceSerialNumbers(serialNumbers.map((value) => ({ serial_number: value }))).join(', ');
    if (groupedSerial) return groupedSerial;
    const fallbackModel = cleanMachineIdentityValue(modelName, { skipNoMachine: true, skipNA: true });
    if (/^multiple\s+machine/i.test(fallbackModel)) return 'N/A';
    return fallbackModel || 'N/A';
}

function formatInvoiceMachineSerialValue({ isGroupedPrint = false, modelName = '', serialNumber = '', serialNumbers = [], fallbackSerial = '' } = {}) {
    if (isGroupedPrint) return 'Multiple Machines';
    return cleanMachineIdentityValue(serialNumber, { skipNA: true })
        || collectInvoiceSerialNumbers(serialNumbers.map((value) => ({ serial_number: value }))).join(', ')
        || cleanMachineIdentityValue(fallbackSerial, { skipNA: true })
        || formatInvoicePrinterModelValue({ modelName })
        || 'N/A';
}

function isOneInvoiceMultipleMachinesPrint({ row = null, context = null, estimate = null } = {}) {
    const billingMode = String(estimate?.billingMode || context?.savedBillingMode || '').trim();
    const hasVerifiedGroupPrintContext = Boolean(
        (row?.is_summary_billing_row || row?.is_summary_row || context?.forceGroupedMode)
        && row?.billing_group
    );
    if (!hasVerifiedGroupPrintContext) return false;
    if (billingMode && billingMode !== 'multi_machine_rtp') return false;
    return true;
}

function getInvoiceSearchEntryModel(entry, references = null) {
    const row = entry?.row || {};
    const doc = entry?.doc || {};
    const machineId = String(doc.machine_id || row.machine_id || '').trim();
    const hasTrustedIdentity = Boolean(entry?.row)
        || Boolean(doc.machine_label || doc.machine_model || doc.model_name || doc.model || doc.printer_model || doc.serial_number);
    const machine = hasTrustedIdentity && machineId && references?.machines ? references.machines.get(machineId) : null;
    const model = machine?.model_id && references?.models ? references.models.get(String(machine.model_id).trim()) : null;
    return formatInvoicePrinterModelValue(resolveBillingMachineIdentity({ row, doc, machine, model }));
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
    const printableRowId = String(group.primaryRow?.row_id || group.primaryRow?.company_id || '').trim();
    const canOpenCalculation = Boolean(printableRowId && group.monthKey && group.monthKey !== 'unknown');
    els.invoiceDetailTitle.textContent = `Invoice ${group.invoiceRef || ''}`;
    els.invoiceDetailSubtitle.textContent = `${formatMonthLabel(group.monthKey, group.monthKey || 'No month')} • ${formatCount(lines.length)} computed branch line${lines.length === 1 ? '' : 's'} • ${formatAmount(group.amountTotal || 0)}`;
    setRtpPrintPayload(null);
    els.invoiceDetailContent.innerHTML = `
        <div class="detail-action-row">
            ${canOpenCalculation ? `<button class="btn btn-primary" type="button" id="invoiceSearchOpenCalcBtn">Open Billing Calculation</button>` : ''}
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
        <div class="invoice-search-evidence" id="invoiceSearchEvidencePanel">
            <div class="detail-section-title">Receipt And Follow-Up Evidence</div>
            <div class="detail-empty">Loading receipt, delivery, and collection remarks from Margabase...</div>
        </div>
    `;

    els.invoiceDetailModal.classList.remove('hidden');
    document.getElementById('invoiceSearchOpenCalcBtn')?.addEventListener('click', () => {
        closeInvoiceDetailModal();
        openBillingCalcModalSafely(printableRowId, group.monthKey);
    });
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

    const evidencePanel = document.getElementById('invoiceSearchEvidencePanel');
    fetchInvoiceDeepSearch([group.invoiceRef])
        .then((report) => {
            const match = (report?.results || [])[0] || null;
            if (evidencePanel) {
                evidencePanel.innerHTML = match
                    ? renderInvoiceEvidenceDetail(match)
                    : '<div class="detail-empty">No receipt or collection evidence found for this invoice.</div>';
            }
        })
        .catch((error) => {
            console.warn('Unable to load invoice deep evidence.', error);
            if (evidencePanel) {
                evidencePanel.innerHTML = `<div class="detail-empty error">Unable to load receipt and follow-up evidence. ${escapeHtml(error.message || '')}</div>`;
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
    els.rtpInvoiceDotMatrixBtn?.classList.toggle('hidden', !payload);
    els.billingCalcPrintBtn?.classList.toggle('hidden', !payload);
    els.billingCalcDotMatrixBtn?.classList.toggle('hidden', !payload);
    els.billingCalcMeterFormBtn?.classList.toggle('hidden', !payload);
    els.billingCalcEnvelopeBtn?.classList.toggle('hidden', !payload);
    if (els.rtpInvoicePrintBtn) els.rtpInvoicePrintBtn.textContent = `Print ${printCode}`;
    if (els.rtpInvoiceDotMatrixBtn) els.rtpInvoiceDotMatrixBtn.textContent = `${printCode} Dot Matrix Print`;
    if (els.billingCalcPrintBtn) els.billingCalcPrintBtn.textContent = `Print ${printCode}`;
    if (els.billingCalcDotMatrixBtn) els.billingCalcDotMatrixBtn.textContent = `${printCode} Dot Matrix Print`;
    if (els.billingCalcMeterFormBtn) els.billingCalcMeterFormBtn.textContent = 'Print Meter Reading Form';
    if (els.billingCalcEnvelopeBtn) els.billingCalcEnvelopeBtn.textContent = 'Print Envelope';
}

async function recordBillingPrintEvent(preview, channel = 'browser_print') {
    const invoiceNo = normalizeInvoiceNumber(preview?.invoiceNo || document.getElementById('calcInvoiceInput')?.value || '');
    let docIds = Array.isArray(preview?.billingDocIds)
        ? preview.billingDocIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    if (!docIds.length && invoiceNo) {
        const docs = await queryBillingDocsByInvoice(invoiceNo).catch((error) => {
            console.warn('Unable to find billing docs for print audit.', error);
            return [];
        });
        docIds = docs.map((doc) => String(doc?._docId || '').trim()).filter(Boolean);
    }
    docIds = Array.from(new Set(docIds));
    if (!docIds.length) {
        throw new Error(`No saved billing document found for invoice ${invoiceNo || '(missing invoice number)'}.`);
    }

    const audit = getCurrentUserAudit();
    const now = new Date();
    const nowIso = now.toISOString();
    const nowSql = toSqlDateTime(now);
    const updates = await Promise.allSettled(docIds.map((docId) => setFirestoreDocument('tbl_billing', docId, {
        billing_printed_at: nowIso,
        billing_printed_date: nowSql,
        billing_printed_by_id: String(audit.id || '').trim(),
        billing_printed_by: String(audit.name || '').trim(),
        billing_print_channel: channel,
        billing_print_count: Number(preview?.billingPrintCount || 0) + 1,
        updated_at: nowIso
    }, {
        mode: 'patch',
        label: `Print audit ${invoiceNo || docId}`,
        dedupeKey: `tbl_billing:${docId}:printed:${nowIso}`
    })));
    const updated = updates.filter((entry) => entry.status === 'fulfilled').length;
    if (updated) {
        currentRtpPrintPayload = {
            ...preview,
            billingDocIds: docIds,
            billingPrintedAt: nowIso,
            billingPrintedBy: audit.name,
            billingPrintCount: Number(preview?.billingPrintCount || 0) + 1
        };
    }
    if (updated !== docIds.length) {
        console.warn('Some billing print audit rows were not saved.', updates);
    }
    return { ok: updated === docIds.length, updated };
}

function isPrintableContractCode(code) {
    return ['RTP', 'RTF', 'MAP'].includes(String(code || '').trim().toUpperCase());
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
    const total = roundBillingAmount(estimate?.amountDue || 0);
    const savedNetAmount = roundBillingAmount(estimate?.netAmount || 0);
    const savedVatAmount = roundBillingAmount(estimate?.vatAmount || 0);
    const savedBreakdownMatchesTotal = Math.abs((savedNetAmount + savedVatAmount) - total) <= 0.02;
    const lineItems = Array.isArray(estimate?.lineItems) ? estimate.lineItems : [];
    const hasVatInclusiveLines = lineItems.some((line) => (
        Number(line?.vatAmount || 0) > 0
        || line?.profile?.with_vat
    ));
    const shouldRecomputeInclusiveVat = total > 0 && !savedBreakdownMatchesTotal && (savedVatAmount > 0 || hasVatInclusiveLines);
    const netAmount = shouldRecomputeInclusiveVat
        ? roundBillingAmount(total / 1.12)
        : savedNetAmount;
    const vatAmount = shouldRecomputeInclusiveVat
        ? roundBillingAmount(total - netAmount)
        : savedVatAmount;

    return {
        total,
        vatableSales: netAmount,
        vatAmount,
        vatExempt: 0,
        zeroRated: 0,
        lessVat: 0,
        amountDue: total
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
        company?.companyname
        || row?.company_name
        || billInfo?.payeename
        || billInfo?.endusername
        || row?.account_name
        || ''
    );
    const isGroupedPrint = isOneInvoiceMultipleMachinesPrint({ row });
    const groupedRows = isGroupedPrint ? getGroupedMachineRows(row, monthKey) : [];
    const groupedSerialNumbers = collectInvoiceSerialNumbers(groupedRows);
    const primaryInvoiceGroup = Array.isArray(cell?.invoice_groups) ? cell.invoice_groups[0] : null;
    const invoiceNo = String(primaryInvoiceGroup?.invoice_no || primaryInvoiceGroup?.invoice_ref || '').trim();
    const billingDocIds = Array.isArray(primaryInvoiceGroup?.doc_ids) ? primaryInvoiceGroup.doc_ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
    const address = isGroupedPrint
        ? (getCompanyAddress(company) || 'N/A')
        : (getBillInfoAddress(billInfo) || buildBranchAddress(branch) || 'N/A');

    return {
        invoiceNo,
        billingDocIds,
        branchId: String(row?.branch_id || '').trim(),
        companyId: String(row?.company_id || '').trim(),
        billInfoDocId: String(billInfo?._docId || billInfo?.id || '').trim(),
        customerName: accountName || 'Unknown Customer',
        baseCustomerName: accountName || 'Unknown Customer',
        branchName: String(row?.branch_name || branch?.branchname || branch?.branch_name || '').trim(),
        envelopeContactPerson: String(billInfo?.envelope_contact_person || '').trim(),
        envelopeBankName: String(billInfo?.envelope_marga_bank_name || ENVELOPE_DEFAULTS.bankName).trim(),
        envelopeAccountName: String(billInfo?.envelope_marga_account_name || ENVELOPE_DEFAULTS.accountName).trim(),
        envelopeAccountNumber: String(billInfo?.envelope_marga_account_number || ENVELOPE_DEFAULTS.accountNumber).trim(),
        envelopeFrom: String(billInfo?.envelope_from || ENVELOPE_DEFAULTS.from).trim(),
        tin: String(company?.company_tin || '').trim() || 'N/A',
        address,
        invoiceDate: formatUsDate(invoiceDate),
        readingCode: row?.reading_day ? `RDG${row.reading_day}` : 'RDG',
        monthLabel: formatMonthLongLabel(monthKey, monthKey),
        contractCode,
        businessStyle: String(company?.business_style || '').trim() || 'N/A',
        printerModel: formatInvoiceMachineSerialValue({ isGroupedPrint, modelName, serialNumber, serialNumbers: groupedSerialNumbers, fallbackSerial: row?.serial_number }),
        machineModel: modelName || row?.machine_label || 'N/A',
        machineSerial: formatInvoiceMachineSerialValue({ isGroupedPrint, modelName, serialNumber, serialNumbers: groupedSerialNumbers, fallbackSerial: row?.serial_number }),
        contractId: String(row?.contractmain_id || row?.contract_id || '').trim(),
        presentReadingDate: period.to || firstIsoDate(
            cell?.task_date,
            readingGroup?.task_date,
            readingGroup?.present_reading_date,
            readingGroup?.reading_date,
            period.endDate
        ),
        previousReadingDate: period.from || (readingGroup?.previous_reading_date ? formatIsoDate(asValidDate(readingGroup.previous_reading_date)) : ''),
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
        company?.companyname
        || row?.company_name
        || billInfo?.payeename
        || billInfo?.endusername
        || row?.account_name
        || ''
    );
    const isGroupedPrint = isOneInvoiceMultipleMachinesPrint({ row, context, estimate });
    const groupedRows = isGroupedPrint && Array.isArray(context?.groupedMachineRows) ? context.groupedMachineRows : [];
    const groupedSerialNumbers = collectInvoiceSerialNumbers(groupedRows);
    const snapshotInvoiceNo = normalizeInvoiceNumber(context?.savedSnapshot?.invoiceNo || estimate?.invoiceNo || '');
    const address = isGroupedPrint
        ? (getGroupedBillingAddress(references, groupedRows, company) || 'N/A')
        : (getBillInfoAddress(billInfo) || buildBranchAddress(branch) || 'N/A');

    return {
        invoiceNo: snapshotInvoiceNo,
        billingDocIds: [],
        branchId: String(row?.branch_id || '').trim(),
        companyId: String(row?.company_id || '').trim(),
        billInfoDocId: String(billInfo?._docId || billInfo?.id || '').trim(),
        customerName: accountName || 'Unknown Customer',
        baseCustomerName: accountName || 'Unknown Customer',
        branchName: String(row?.branch_name || branch?.branchname || branch?.branch_name || '').trim(),
        envelopeContactPerson: String(billInfo?.envelope_contact_person || '').trim(),
        envelopeBankName: String(billInfo?.envelope_marga_bank_name || ENVELOPE_DEFAULTS.bankName).trim(),
        envelopeAccountName: String(billInfo?.envelope_marga_account_name || ENVELOPE_DEFAULTS.accountName).trim(),
        envelopeAccountNumber: String(billInfo?.envelope_marga_account_number || ENVELOPE_DEFAULTS.accountNumber).trim(),
        envelopeFrom: String(billInfo?.envelope_from || ENVELOPE_DEFAULTS.from).trim(),
        tin: String(company?.company_tin || '').trim() || 'N/A',
        address,
        invoiceDate: formatUsDate(invoiceDate),
        readingCode: row?.reading_day ? `RDG${row.reading_day}` : 'RDG',
        monthLabel: formatMonthLongLabel(context?.monthKey, context?.monthLabel || ''),
        contractCode,
        businessStyle: String(company?.business_style || '').trim() || 'N/A',
        printerModel: formatInvoiceMachineSerialValue({ isGroupedPrint, modelName, serialNumber, serialNumbers: groupedSerialNumbers, fallbackSerial: row?.serial_number }),
        machineModel: modelName || row?.machine_label || 'N/A',
        machineSerial: formatInvoiceMachineSerialValue({ isGroupedPrint, modelName, serialNumber, serialNumbers: groupedSerialNumbers, fallbackSerial: row?.serial_number }),
        contractId: String(row?.contractmain_id || row?.contract_id || '').trim(),
        presentReadingDate: period.to || firstIsoDate(
            context?.targetCell?.task_date,
            context?.targetReadingGroup?.task_date,
            estimate?.taskDate,
            estimate?.readingDate,
            period.endDate
        ),
        previousReadingDate: period.from || (context?.latestPriorGroup?.task_date ? formatIsoDate(asValidDate(context.latestPriorGroup.task_date)) : ''),
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
const BILLING_PRINT_POLICY_FIRESTORE_DOC_ID = 'billing_printing_policy_v1';
let currentRtpPrintCalibration = normalizeRtpPrintCalibration(RTP_PRINT_CALIBRATION);
let currentRtpPrintTemplates = {};
let currentRtpPrintTemplateName = 'Default';
let rtpPrintTemplatesFirebasePromise = null;
let rtpPrintTemplatesLoadedFromFirebase = false;
let billingPrintPolicyPromise = null;

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

async function loadBillingPrintPolicy() {
    if (billingPrintPolicyPromise) return billingPrintPolicyPromise;
    billingPrintPolicyPromise = getFirestoreDocument('tbl_app_settings', BILLING_PRINT_POLICY_FIRESTORE_DOC_ID)
        .then((doc) => ({
            allowSavedReprints: doc?.allow_saved_billing_reprints !== false
        }))
        .catch((error) => {
            console.warn('Unable to load billing print policy; allowing saved billing reprints by default.', error);
            return { allowSavedReprints: true };
        });
    return billingPrintPolicyPromise;
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

            <div class="rtp-block-field" style="${buildRtpPositionStyle({ xMm: 0, yMm: 10, widthMm: 58 }, mode)}"><strong>Printer Model/Serial</strong></div>
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
        body { font-family: Arial, sans-serif; }
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

async function printCurrentRtpInvoice() {
    if (!currentRtpPrintPayload) {
        MargaUtils.showToast('Open a printable invoice first.', 'error');
        return;
    }

    const preview = decorateRtpPrintPayload(currentRtpPrintPayload);
    try {
        const result = await recordBillingPrintEvent(preview, 'browser_print');
        if (result?.updated) {
            await loadDashboard({ forceRefresh: true }).catch(() => {});
        }
    } catch (error) {
        console.warn('Billing print audit failed.', error);
        MargaUtils.showToast('Print audit was not saved, so the invoice was not opened for print. Refresh the billing and try again.', 'error');
        return;
    }
    printHtmlDocument(buildRtpPrintDocument(preview), 'marga_invoice_print');
}

function sanitizeDotMatrixText(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[^\x20-\x7E\r\n]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function dotMatrixFit(value, width, align = 'left') {
    const text = sanitizeDotMatrixText(value);
    const safeWidth = Math.max(1, Number(width || 0) || 1);
    const clipped = text.length > safeWidth ? text.slice(0, safeWidth) : text;
    if (align === 'right') return clipped.padStart(safeWidth, ' ');
    if (align === 'center') {
        const left = Math.floor((safeWidth - clipped.length) / 2);
        return `${' '.repeat(Math.max(0, left))}${clipped}`.padEnd(safeWidth, ' ');
    }
    return clipped.padEnd(safeWidth, ' ');
}

function buildDotMatrixPair(label, value, labelWidth = 29, valueWidth = 20) {
    return `${dotMatrixFit(label, labelWidth)}${dotMatrixFit(value, valueWidth)}`;
}

function buildDotMatrixInvoiceText(preview) {
    const totals = preview?.totals || {};
    const contractCode = String(preview?.contractCode || 'RTP').trim().toUpperCase() || 'RTP';
    const isFixedRate = contractCode === 'RTF';
    const lines = [];
    lines.push('');
    lines.push(dotMatrixFit(preview?.customerName || 'Unknown Customer', 58) + dotMatrixFit(preview?.invoiceDate || '', 22, 'right'));
    lines.push(dotMatrixFit(preview?.tin || 'N/A', 58) + dotMatrixFit(preview?.readingCode || '', 22, 'right'));
    lines.push(dotMatrixFit(preview?.address || 'N/A', 58) + dotMatrixFit(preview?.monthLabel || '', 22, 'right'));
    lines.push(dotMatrixFit('', 58) + dotMatrixFit(contractCode, 22, 'right'));
    lines.push('');
    lines.push(buildDotMatrixPair('Business Style :', preview?.businessStyle || 'N/A'));
    lines.push(buildDotMatrixPair('Printer Model/Serial', preview?.printerModel || 'N/A'));
    lines.push(`${dotMatrixFit('Printer Rental Billing for :', 29)}${dotMatrixFit(preview?.billingFrom || 'N/A', 15)}${dotMatrixFit('to', 8, 'center')}${dotMatrixFit(preview?.billingTo || 'N/A', 15)}`);
    if (isFixedRate) {
        lines.push(buildDotMatrixPair('Monthly Rate:', formatFixedAmount(preview?.monthlyRate || preview?.rate || 0)));
    } else {
        lines.push(buildDotMatrixPair('Total Pages consumed :', formatCount(preview?.totalPages || 0)));
        lines.push(buildDotMatrixPair('Rate per Page:', formatFixedAmount(preview?.rate || 0)));
    }
    lines.push('');
    lines.push('');
    [
        totals.total,
        totals.vatAmount,
        totals.vatableSales,
        totals.vatExempt,
        totals.zeroRated,
        totals.lessVat,
        totals.amountDue
    ].forEach((amount, index) => {
        const amountText = formatFixedAmount(amount || 0);
        lines.push(`${dotMatrixFit('', 62)}${dotMatrixFit(amountText, 18, 'right')}${index === 6 ? '\f' : ''}`);
    });
    return `${lines.join('\r\n')}\r\n`;
}

function buildDotMatrixInvoiceRawText(preview) {
    return `\x1B@${buildDotMatrixInvoiceText(preview)}`;
}

async function sendDotMatrixInvoiceToLocalBridge(preview) {
    const response = await fetch('http://127.0.0.1:8765/print-invoice', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            jobName: `${String(preview?.contractCode || 'Invoice').trim().toUpperCase() || 'Invoice'} ${preview?.invoiceDate || ''}`.trim(),
            text: buildDotMatrixInvoiceRawText(preview)
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
        throw new Error(result?.error || `Dot matrix bridge returned HTTP ${response.status}.`);
    }
    return result;
}

function buildDotMatrixInvoicePrintDocument(preview) {
    const invoiceText = buildDotMatrixInvoiceText(preview).replace(/\f/g, '');
    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Dot Matrix Invoice Print</title>
    <style>
        @page {
            size: letter portrait;
            margin: 0;
        }
        html,
        body {
            margin: 0;
            padding: 0;
            background: #fff;
        }
        body {
            color: #000;
            font-family: "Courier New", Courier, monospace;
            font-size: 10pt;
            line-height: 1.25;
        }
        .dot-matrix-page {
            box-sizing: border-box;
            width: 8.5in;
            min-height: 11in;
            padding: 1.55in 1.05in 0.8in 1.25in;
            white-space: pre;
        }
        @media print {
            body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            .dot-matrix-page {
                break-after: page;
            }
        }
    </style>
</head>
<body>
<pre class="dot-matrix-page">${escapeHtml(invoiceText)}</pre>
</body>
</html>`;
}

async function printCurrentDotMatrixInvoice() {
    if (!currentRtpPrintPayload) {
        MargaUtils.showToast('Open a printable invoice first.', 'error');
        return;
    }

    const preview = decorateRtpPrintPayload(currentRtpPrintPayload);
    try {
        const result = await sendDotMatrixInvoiceToLocalBridge(preview);
        const printerLabel = result?.printerName ? ` to ${result.printerName}` : '';
        await recordBillingPrintEvent(preview, 'dot_matrix');
        await loadDashboard({ forceRefresh: true }).catch(() => {});
        MargaUtils.showToast(`Dot-matrix invoice sent${printerLabel}.`, 'success');
    } catch (error) {
        console.error('Dot matrix raw print failed:', error);
        MargaUtils.showToast('Dot-matrix print or print audit failed. Check the print bridge, then try again so the billing count stays accurate.', 'error');
    }
}

function printCurrentMeterReadingForm() {
    if (!currentRtpPrintPayload || !currentRtpMeterFormEstimate) {
        MargaUtils.showToast('Open a saved printable billing first.', 'error');
        return;
    }

    printBillingAttachment(currentRtpPrintPayload, currentRtpMeterFormEstimate, 'meter_form');
}

function getEnvelopeRecipientName(payload) {
    return String(payload?.branchName || payload?.customerName || '').trim() || 'Customer';
}

function getEnvelopeBankDetails(payload) {
    return {
        bankName: String(payload?.envelopeBankName || ENVELOPE_DEFAULTS.bankName).trim(),
        accountName: String(payload?.envelopeAccountName || ENVELOPE_DEFAULTS.accountName).trim(),
        accountNumber: String(payload?.envelopeAccountNumber || ENVELOPE_DEFAULTS.accountNumber).trim(),
        from: String(payload?.envelopeFrom || ENVELOPE_DEFAULTS.from).trim()
    };
}

function buildEnvelopePrintDocument(payload) {
    const details = getEnvelopeBankDetails(payload);
    const toName = getEnvelopeRecipientName(payload);
    const contactPerson = String(payload?.envelopeContactPerson || '').trim();
    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Billing Envelope - ${escapeHtml(toName)}</title>
    <style>
        @page { size: 9.5in 4.125in landscape; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #fff; color: #222; font-family: "Times New Roman", Georgia, serif; }
        .envelope-sheet {
            width: 9.5in;
            height: 4.125in;
            padding: 0.45in 0.55in;
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 0.18in;
        }
        .envelope-to {
            font-size: 28pt;
            line-height: 1.15;
            font-weight: 500;
        }
        .envelope-attention {
            font-size: 25pt;
            line-height: 1.12;
        }
        .envelope-bank {
            margin-top: 0.08in;
            font-size: 16pt;
            line-height: 1.18;
        }
        .envelope-from {
            margin-top: 0.12in;
            font-size: 25pt;
            line-height: 1.12;
        }
    </style>
</head>
<body>
    <main class="envelope-sheet">
        <div class="envelope-to">To: ${escapeHtml(toName)}</div>
        ${contactPerson ? `<div class="envelope-attention">Attention to: ${escapeHtml(contactPerson)}</div>` : ''}
        <div class="envelope-bank">
            <div>Bank: ${escapeHtml(details.bankName)}</div>
            <div>Account Name: ${escapeHtml(details.accountName)}</div>
            <div>Account Number: ${escapeHtml(details.accountNumber)}</div>
        </div>
        <div class="envelope-from">From: ${escapeHtml(details.from)}</div>
    </main>
</body>
</html>`;
}

async function saveEnvelopeContactForCurrentBilling(payload, contactPerson) {
    const billInfoDocId = String(payload?.billInfoDocId || '').trim();
    if (!billInfoDocId) {
        throw new Error('This branch does not have a billing-info row to save the envelope contact.');
    }
    const details = getEnvelopeBankDetails(payload);
    const audit = getCurrentUserAudit();
    const patch = {
        envelope_contact_person: String(contactPerson || '').trim(),
        envelope_marga_bank_name: details.bankName,
        envelope_marga_account_name: details.accountName,
        envelope_marga_account_number: details.accountNumber,
        envelope_from: details.from,
        envelope_contact_source: 'billing_envelope_modal',
        envelope_contact_updated_at: new Date().toISOString(),
        envelope_contact_updated_by: audit.name,
        envelope_contact_updated_by_id: audit.id,
        envelope_contact_branch_id: String(payload?.branchId || '').trim(),
        envelope_contact_company_id: String(payload?.companyId || '').trim()
    };
    const result = await setFirestoreDocument('tbl_billinfo', billInfoDocId, patch, {
        mode: 'patch',
        label: `Envelope contact ${getEnvelopeRecipientName(payload)}`,
        dedupeKey: `billing-envelope-contact:${billInfoDocId}`
    });
    payload.envelopeContactPerson = patch.envelope_contact_person;
    Object.assign(payload, {
        envelopeBankName: patch.envelope_marga_bank_name,
        envelopeAccountName: patch.envelope_marga_account_name,
        envelopeAccountNumber: patch.envelope_marga_account_number,
        envelopeFrom: patch.envelope_from
    });
    if (invoicePreviewReferenceData?.billInfoByBranchId && payload.branchId) {
        const rows = invoicePreviewReferenceData.billInfoByBranchId.get(String(payload.branchId)) || [];
        rows.forEach((row) => {
            if (String(row?._docId || row?.id || '') === billInfoDocId) Object.assign(row, patch);
        });
    }
    return result;
}

function requestEnvelopeContact(payload) {
    return new Promise((resolve) => {
        document.getElementById('billingEnvelopeContactOverlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'billingEnvelopeContactOverlay';
        overlay.className = 'billing-save-result-overlay';
        overlay.innerHTML = `
            <section class="billing-save-result-card envelope-contact-card" role="dialog" aria-modal="true" aria-label="Envelope contact">
                <button class="billing-save-result-close" type="button" aria-label="Close">x</button>
                <div class="billing-save-result-kicker">Envelope</div>
                <div class="billing-save-result-title">Add contact person</div>
                <div class="billing-save-result-message">This will be saved to ${escapeHtml(getEnvelopeRecipientName(payload))} for the next billing print.</div>
                <label class="envelope-contact-field">
                    <span>Contact person</span>
                    <input type="text" id="billingEnvelopeContactInput" placeholder="Mr./Ms. Contact Person">
                </label>
                <label class="calc-checkbox-label envelope-save-option">
                    <input type="checkbox" id="billingEnvelopeSaveContactInput" checked>
                    <span>Save this contact for next billing</span>
                </label>
                <div class="envelope-contact-actions">
                    <button class="btn btn-secondary" type="button" data-envelope-print-once>Print once only</button>
                    <button class="btn btn-primary" type="button" data-envelope-save-print>Save and Print</button>
                </div>
            </section>
        `;
        const close = (value = null) => {
            overlay.remove();
            resolve(value);
        };
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close(null);
        });
        overlay.querySelector('.billing-save-result-close')?.addEventListener('click', () => close(null));
        overlay.querySelector('[data-envelope-print-once]')?.addEventListener('click', () => {
            const contact = String(overlay.querySelector('#billingEnvelopeContactInput')?.value || '').trim();
            if (!contact) {
                MargaUtils.showToast('Enter the contact person before printing the envelope.', 'error');
                return;
            }
            close({ contactPerson: contact, save: false });
        });
        overlay.querySelector('[data-envelope-save-print]')?.addEventListener('click', () => {
            const contact = String(overlay.querySelector('#billingEnvelopeContactInput')?.value || '').trim();
            if (!contact) {
                MargaUtils.showToast('Enter the contact person before saving.', 'error');
                return;
            }
            const save = overlay.querySelector('#billingEnvelopeSaveContactInput')?.checked !== false;
            close({ contactPerson: contact, save });
        });
        document.body.appendChild(overlay);
        overlay.querySelector('#billingEnvelopeContactInput')?.focus();
    });
}

async function printCurrentEnvelope() {
    if (!currentRtpPrintPayload) {
        MargaUtils.showToast('Open a saved printable billing first.', 'error');
        return;
    }
    const payload = currentRtpPrintPayload;
    let contactPerson = String(payload.envelopeContactPerson || '').trim();
    if (!contactPerson) {
        const requested = await requestEnvelopeContact(payload);
        if (!requested) return;
        contactPerson = requested.contactPerson;
        payload.envelopeContactPerson = contactPerson;
        if (requested.save) {
            try {
                const result = await saveEnvelopeContactForCurrentBilling(payload, contactPerson);
                MargaUtils.showToast(result?.queued ? 'Envelope contact queued.' : 'Envelope contact saved.', 'success');
            } catch (error) {
                MargaUtils.showToast(String(error?.message || 'Unable to save envelope contact.'), 'error');
                return;
            }
        }
    }
    printHtmlDocument(buildEnvelopePrintDocument(payload), 'marga_envelope_print');
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

function getPrintableBillingLines(estimate, options = {}) {
    const lines = Array.isArray(estimate?.lineItems) ? estimate.lineItems : [];
    if (options.includePending) return lines.length ? lines : [];
    const available = lines.filter((line) => !line.missingMeterSource && !isNonBillableMeterFormula(line.formula));
    const printable = available.filter((line) => (
        !line.missingMeterSource
        && (Number(line.amountDue || 0) > 0 || Number(line.rawPages || 0) > 0 || Number(line.presentMeter || 0) > Number(line.previousMeter || 0))
    ));
    return printable.length ? printable : available;
}

const METER_FORM_COMPANY_BLOCK = [
    'MARGA ENTERPRISES',
    'Blk 30-32 Lot 1 Cabrera Road Cornel Magnolia Street',
    'Glenrose Subdivision Brgy. Dolores Taytay, Rizal',
    '(02)88201750, (02)82908264, (02)82939228,',
    '(02)82939224, (02)82939628, (02)82941638,'
].join('\n');

function buildMeterFormLineRows(estimate) {
    const lines = getPrintableBillingLines(estimate, { includePending: true });
    return lines.length ? lines : [estimate].filter(Boolean);
}

function buildMeterFormPrintDocument(preview, estimate) {
    const lines = buildMeterFormLineRows(estimate);
    const isMultipleMachineForm = String(estimate?.billingMode || '').trim() === 'multi_machine_rtp';
    const useTableForm = lines.length > 1 || isMultipleMachineForm;
    return useTableForm
        ? buildMultipleMachineMeterFormPrintDocument(preview, estimate, lines, { isMultipleMachineForm })
        : buildSingleMachineMeterFormPrintDocument(preview, estimate, lines[0] || estimate || {});
}

function resolveMeterFormPreviousReadingDate(preview, estimate, lines = []) {
    return firstIsoDate(
        preview?.previousReadingDate,
        estimate?.previousReadingDate,
        ...(Array.isArray(lines) ? lines.flatMap((line) => [
            line?.previousReadingDate,
            line?.previous_reading_date,
            line?.priorReadingDate,
            line?.prior_reading_date
        ]) : [])
    );
}

function resolveCustomerMeterFormDates(preview, estimate, lines = []) {
    return {
        presentDate: firstIsoDate(preview?.billingTo, preview?.presentReadingDate, estimate?.presentReadingDate),
        previousDate: firstIsoDate(preview?.billingFrom, resolveMeterFormPreviousReadingDate(preview, estimate, lines))
    };
}

function buildSingleMachineMeterFormPrintDocument(preview, estimate, line = {}) {
    const { presentDate, previousDate } = resolveCustomerMeterFormDates(preview, estimate, [line]);
    const difference = Number(line.rawPages || 0) || Math.max(0, Number(line.presentMeter || 0) - Number(line.previousMeter || 0));
    const spoilage = Number(line.spoilagePages || line.totalSpoilagePages || 0) || 0;
    const otherDiscount = Number(line.actualSpoilagePages || 0) || 0;
    const netPages = Number(line.netPages || 0) || Math.max(0, difference - spoilage);
    const monthlyMinimum = Number(line.monthlyQuota || estimate?.monthlyQuota || preview?.quota || 0) || 0;
    const serial = line.serialNumber || preview?.machineSerial || 'N/A';
    const model = line.machineModel || preview?.machineModel || preview?.printerModel || 'N/A';
    const contractId = line.contractmainId || preview?.contractId || 'N/A';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Meter Reading Form</title>
    <style>
        @page { size: Letter portrait; margin: 10mm 12mm; }
        * { box-sizing: border-box; }
        html, body { width: 100%; min-height: 100%; }
        body { margin: 0; color: #1f2933; font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.18; }
        .page { padding: 5mm 2mm 0; break-after: avoid; page-break-after: avoid; }
        .top { display: grid; grid-template-columns: 1fr 1fr; gap: 18mm; align-items: start; }
        .company { white-space: pre-line; }
        h1 { margin: 0 0 5px; text-align: center; font-size: 16px; }
        .subtitle { text-align: center; font-size: 11px; }
        .section-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; margin-top: 14mm; }
        .label { margin-bottom: 6px; }
        .client-name { margin-bottom: 12px; }
        .address { white-space: pre-line; }
        .info-row { display: grid; grid-template-columns: 34mm 1fr; gap: 8px; margin-bottom: 7px; }
        .calc { margin-top: 13mm; display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; }
        .calc .info-row { grid-template-columns: 40mm 1fr; }
        .value { text-align: left; }
        .signatures { margin-top: 14mm; display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; }
        .sig-row { min-height: 11mm; }
        .sig-row strong { font-weight: 400; }
        .prepared-name, .officer-name { display: block; margin-top: 5px; }
    </style>
</head>
<body>
    <main class="page">
        <section class="top">
            <div class="company">${escapeHtml(METER_FORM_COMPANY_BLOCK)}</div>
            <div>
                <h1>Meter Reading Form</h1>
                <div class="subtitle">( Single Machine )</div>
            </div>
        </section>
        <section class="section-grid">
            <div>
                <div class="label">Client Information :</div>
                <div class="client-name">${escapeHtml(cleanPrintCustomerName(preview?.customerName) || 'Unknown Customer')}</div>
                <div class="address">${escapeHtml(preview?.address || '')}</div>
            </div>
            <div>
                <div class="label">Machine Information :</div>
                <div class="info-row"><span>Serial No. :</span><span>${escapeHtml(serial)}</span></div>
                <div class="info-row"><span>Contract ID :</span><span>${escapeHtml(contractId)}</span></div>
                <div class="info-row"><span>Model :</span><span>${escapeHtml(model)}</span></div>
            </div>
        </section>
        <section class="calc">
            <div>
                <div class="info-row"><span>Present Reading Date :</span><span>${escapeHtml(presentDate)}</span></div>
                <div class="info-row"><span>Previous Reading Date :</span><span>${escapeHtml(previousDate)}</span></div>
                <div class="info-row"><span>Difference :</span><span></span></div>
                <div class="info-row"><span>Spoilage Discount :</span><span></span></div>
                <div class="info-row"><span>Other Discount :</span><span></span></div>
                <div class="info-row"><span>Net Page Consumed :</span><span></span></div>
                <div class="info-row"><span>Monthly Minimum :</span><span></span></div>
            </div>
            <div>
                <div class="info-row"><span>Present Reading :</span><span>${escapeHtml(formatCount(line.presentMeter || 0))}</span></div>
                <div class="info-row"><span>Previous Reading :</span><span>${escapeHtml(formatCount(line.previousMeter || 0))}</span></div>
                <div class="info-row"><span></span><span>${escapeHtml(formatCount(difference))}</span></div>
                <div class="info-row"><span></span><span>${escapeHtml(formatCount(spoilage))}</span></div>
                <div class="info-row"><span></span><span>${otherDiscount ? escapeHtml(formatCount(otherDiscount)) : ''}</span></div>
                <div class="info-row"><span></span><span>${escapeHtml(formatCount(netPages))}</span></div>
                <div class="info-row"><span></span><span>${escapeHtml(formatCount(monthlyMinimum))}</span></div>
            </div>
        </section>
        <section class="signatures">
            <div>
                <div class="sig-row">Prepared by :<span class="prepared-name">Dang Lozano</span></div>
                <div class="sig-row">Billing and Collection :</div>
                <div class="sig-row">Certified Correct :</div>
                <div class="sig-row">Collector Print :</div>
            </div>
            <div>
                <div class="sig-row">Approved by :</div>
                <div class="sig-row">Account Officer :</div>
                <div class="sig-row">Certified Correct :</div>
                <div class="sig-row">Authorized Customer Representative :</div>
            </div>
        </section>
    </main>
</body>
</html>`;
}

function buildMultipleMachineMeterFormPrintDocument(preview, estimate, lines = [], options = {}) {
    const { presentDate, previousDate } = resolveCustomerMeterFormDates(preview, estimate, lines);
    const subtitle = options.isMultipleMachineForm ? '( Multiple Machines )' : '( Single Machine )';
    const totalNet = lines.reduce((sum, line) => sum + Number(line.netPages || 0), 0);
    const representativeRate = Number(lines.find((line) => Number(line.pageRate || 0) > 0)?.pageRate || estimate?.pageRate || preview?.rate || 0) || 0;
    const rows = lines.map((line) => {
        const difference = Number(line.rawPages || 0) || Math.max(0, Number(line.presentMeter || 0) - Number(line.previousMeter || 0));
        return `
            <tr>
                <td>${escapeHtml(line.branchName || line.label || '')}</td>
                <td>${escapeHtml(line.machineModel || line.subtitle || '')}</td>
                <td class="num">${escapeHtml(formatCount(line.presentMeter || 0))}</td>
                <td class="num">${escapeHtml(formatCount(line.previousMeter || 0))}</td>
                <td class="num">${escapeHtml(formatCount(difference))}</td>
                <td class="num">${escapeHtml(formatCount(line.spoilagePages || line.totalSpoilagePages || 0))}</td>
                <td class="num">${escapeHtml(formatCount(line.netPages || 0))}</td>
                <td class="num">${escapeHtml(formatFixedAmount(line.pageRate || representativeRate || 0).replace(/\.00$/, ''))}</td>
                <td class="num">${escapeHtml(formatFixedAmount(line.amountDue || 0))}</td>
            </tr>
        `;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Meter Reading Form</title>
    <style>
        @page { size: A4 portrait; margin: 14mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #1f2933; font-family: Arial, Helvetica, sans-serif; font-size: 9.5px; line-height: 1.14; }
        .page { min-height: 269mm; padding: 3mm; }
        .header-grid { display: grid; grid-template-columns: 46% 54%; border: 1px solid #222; }
        .company { min-height: 24mm; padding: 3.5mm 4mm; border-right: 1px solid #222; white-space: pre-line; }
        .title-box { padding-top: 5mm; text-align: center; }
        h1 { margin: 0 0 3mm; font-size: 14px; }
        .client-grid { display: grid; grid-template-columns: 56% 44%; min-height: 25mm; border-left: 1px solid #222; border-right: 1px solid #222; border-bottom: 1px solid #222; }
        .client { padding: 3mm 4mm; }
        .client-name { margin: 2.5mm 0; font-weight: 700; text-transform: uppercase; }
        .dates { padding: 4mm; }
        .date-row { display: grid; grid-template-columns: 36mm 1fr; gap: 5mm; margin-bottom: 4mm; }
        table { width: 100%; border-collapse: collapse; }
        thead { display: table-header-group; }
        tfoot { display: table-row-group; }
        tr { break-inside: avoid; page-break-inside: avoid; }
        th, td { border: 1px solid #222; padding: 1mm 1.2mm; vertical-align: top; }
        th { font-weight: 400; text-align: left; }
        .num { text-align: right; white-space: nowrap; }
        .summary { width: 75mm; margin: 4mm 0 5mm auto; break-inside: avoid; page-break-inside: avoid; }
        .summary td { height: 8mm; }
        .signatures { margin-top: 4mm; border: 1px solid #222; display: grid; grid-template-columns: 46% 54%; break-inside: avoid; page-break-inside: avoid; }
        .sig-col:first-child { border-right: 1px solid #222; }
        .sig-row { min-height: 14mm; padding: 3mm 4mm; border-bottom: 1px solid #222; }
        .sig-row:last-child { border-bottom: 0; }
        .prepared-name, .officer-name { display: block; margin-top: 3mm; }
    </style>
</head>
<body>
    <main class="page">
        <section class="header-grid">
            <div class="company">${escapeHtml(METER_FORM_COMPANY_BLOCK)}</div>
            <div class="title-box">
                <h1>Meter Reading Form</h1>
                <div>${escapeHtml(subtitle)}</div>
            </div>
        </section>
        <section class="client-grid">
            <div class="client">
                <div>Client Information :</div>
                <div class="client-name">${escapeHtml(cleanPrintCustomerName(preview?.customerName) || 'Unknown Customer')}</div>
                <div>${escapeHtml(preview?.address || '')}</div>
            </div>
            <div class="dates">
                <div class="date-row"><span>Present Reading Date :</span><span>${escapeHtml(presentDate)}</span></div>
                <div class="date-row"><span>Previous Reading Date :</span><span>${escapeHtml(previousDate)}</span></div>
            </div>
        </section>
        <table>
            <thead>
                <tr>
                    <th style="width:26%;">Branch</th>
                    <th style="width:9%;">Model</th>
                    <th>Present<br>Reading</th>
                    <th>Previous<br>Reading</th>
                    <th>Difference</th>
                    <th>Spoilage</th>
                    <th>Net Page<br>Consumed</th>
                    <th>Rate</th>
                    <th>Amount</th>
                </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="9">No meter lines available.</td></tr>'}</tbody>
        </table>
        <table class="summary">
            <tr>
                <td class="num">${escapeHtml(formatCount(totalNet))}</td>
                <td class="num">${escapeHtml(formatFixedAmount(representativeRate).replace(/\.00$/, ''))}</td>
                <td class="num">${escapeHtml(formatFixedAmount(estimate?.amountDue || preview?.totals?.amountDue || 0))}</td>
            </tr>
        </table>
        <section class="signatures">
            <div class="sig-col">
                <div class="sig-row">Prepared by :<span class="prepared-name">Dang Lozano</span></div>
                <div class="sig-row">Billing and Collection :<br>Print Name / Signature / Date</div>
                <div class="sig-row">Certified Correct :</div>
                <div class="sig-row">Collector :<br>Print Name / Signature / Date</div>
            </div>
            <div class="sig-col">
                <div class="sig-row">Approved by :</div>
                <div class="sig-row">Account Officer :<br>Print Name / Signature / Date<br><span class="officer-name">Arlene E. Agustin</span></div>
                <div class="sig-row">Certified Correct :</div>
                <div class="sig-row">Authorized Customer Representative :<br>Print Name / Signature / Date</div>
            </div>
        </section>
    </main>
</body>
</html>`;
}

function buildBillingAttachmentPrintDocument(preview, estimate, type = 'breakdown') {
    if (type === 'meter_form') return buildMeterFormPrintDocument(preview, estimate);

    const isMeterForm = type === 'meter_form';
    const lines = getPrintableBillingLines(estimate, { includePending: isMeterForm });
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
    const now = new Date();
    els.endMonthInput.value = `${now.getFullYear()}-12`;
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

function statementCustomerKey(row) {
    return String(row?.company_id || row?.company_name || row?.account_name || '').trim().toLowerCase();
}

function statementBranchKey(row) {
    return [
        statementCustomerKey(row),
        String(row?.branch_id || row?.branch_name || '').trim().toLowerCase()
    ].join(':');
}

function getStatementSourceRows() {
    return (Array.isArray(lastPayload?.month_matrix?.rows) ? lastPayload.month_matrix.rows : [])
        .filter((row) => row && !row.is_summary_row && !row.isGroupedChild);
}

function getCustomerStatementContext(rows = []) {
    const contexts = getCustomerStatementContexts(rows);
    return contexts.length === 1 ? contexts[0] : null;
}

function getCustomerStatementContexts(rows = []) {
    const sourceRows = rows.filter((row) => row && !row.is_summary_row && !row.isGroupedChild);
    if (!sourceRows.length) return [];
    const groups = new Map();
    sourceRows.forEach((row) => {
        const key = statementCustomerKey(row);
        if (!key) return;
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                companyId: String(row.company_id || '').trim(),
                customer: row.company_name || row.account_name || 'Customer',
                rows: []
            });
        }
        groups.get(key).rows.push(row);
    });
    const months = Array.isArray(lastPayload?.month_matrix?.months) ? lastPayload.month_matrix.months : [];
    return Array.from(groups.values()).map((context) => {
        let billedAmount = 0;
        let billedInvoices = 0;
        const branches = new Set();
        context.rows.forEach((row) => {
            if (row.branch_name) branches.add(row.branch_name);
            months.forEach((monthKey) => {
                const cell = row.months?.[monthKey] || {};
                billedAmount += Number(cell.amount_total || 0);
                billedInvoices += Number(cell.invoice_count || 0);
            });
        });
        return {
            ...context,
            branchCount: branches.size,
            billedAmount,
            billedInvoices
        };
    }).sort((left, right) => (
        right.rows.length - left.rows.length
        || Number(right.billedAmount || 0) - Number(left.billedAmount || 0)
        || String(left.customer || '').localeCompare(String(right.customer || ''))
    ));
}

function renderCustomerStatementBar(filteredRows = []) {
    if (!els.customerStatementBar) return;
    const searchTerm = getMatrixSearchTerm();
    const contexts = searchTerm ? getCustomerStatementContexts(filteredRows).filter((context) => context.rows.length > 1 || Number(context.billedAmount || 0) > 0) : [];
    if (!contexts.length) {
        els.customerStatementBar.classList.add('hidden');
        els.customerStatementBar.innerHTML = '';
        return;
    }
    els.customerStatementBar.classList.remove('hidden');
    els.customerStatementBar.innerHTML = `
        ${contexts.slice(0, 4).map((context) => `
            <div class="customer-statement-group">
                <div class="customer-statement-main">
                    <span class="customer-statement-label">Customer Statement</span>
                    <strong>${escapeHtml(context.customer)}</strong>
                    <small>${escapeHtml(formatMetricCount(context.rows.length, 'machine row'))} / ${escapeHtml(formatMetricCount(context.branchCount, 'branch'))} / ${escapeHtml(formatCurrency(context.billedAmount))} loaded billed total</small>
                </div>
                <div class="customer-statement-actions">
                    <button class="btn btn-primary btn-sm" type="button" data-customer-statement-key="${escapeHtml(context.key)}">Customer Billing Statement</button>
                </div>
            </div>
        `).join('')}
    `;
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
    params.set('months_back', '13');
    params.set('row_limit', String(Math.max(1, Math.min(5000, Number(els.rowLimitInput.value || 5000)))));
    params.set('latest_limit', '100');
    params.set('max_billing_pages', String(Math.max(10, Number(els.billingPagesInput.value || 10))));
    params.set('max_schedule_pages', String(Math.max(10, Number(els.schedulePagesInput.value || 10))));
    params.set('include_rows', 'true');
    params.set('include_active_rows', 'true');
    const forceRefresh = Boolean(options.forceRefresh);
    params.set('refresh_cache', String(forceRefresh || Boolean(els.refreshCacheInput.checked)));
    params.set('_ts', String(Date.now()));
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
    els.sheetMeta.textContent = payload.meta?.reading_day_source || 'Billing carryover view';

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
        const key = getCompanySummaryGroupKey(row);
        if (!key) return;
        if (!groups.has(key)) {
            const billingGroup = row.billing_group || null;
            groups.set(key, {
                key,
                company_id: billingGroup?.company_id || row.company_id || null,
                company_name: billingGroup?.display_name || row.company_name || row.account_name || 'Unknown',
                billing_group: billingGroup,
                rows: []
            });
        }
        if (!groups.get(key).billing_group && row.billing_group) groups.get(key).billing_group = row.billing_group;
        groups.get(key).rows.push(row);
    });

    const inserted = new Set();
    const displayRows = [];
    rows.forEach((row) => {
        const key = getCompanySummaryGroupKey(row);
        const group = groups.get(key);
        const qualifies = group && group.billing_group && group.rows.length > 1;

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
                const displayAmountTotal = amountTotal;
                const readingPagesTotal = childCells.reduce((sum, cell) => sum + Number(cell.reading_pages_total || 0), 0);
                const readingTaskCount = childCells.reduce((sum, cell) => sum + Number(cell.reading_task_count || 0), 0);
                const billingLineCount = billedCells.reduce((sum, cell) => sum + Number(cell.billing_line_count || 0), 0);
                const invoiceCount = mergedGroups.length || childCells.reduce((sum, cell) => sum + Number(cell.invoice_count || 0), 0);
                const machineIds = new Set();
                mergedGroups.forEach((groupInvoice) => {
                    (groupInvoice.machine_ids || []).forEach((machineId) => machineIds.add(String(machineId)));
                });
                childCells.forEach((cell, index) => {
                    const machineId = String(group.rows[index]?.machine_id || '').trim();
                    if ((cell.billed || Number(cell.display_amount_total || 0) > 0) && machineId) {
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
                is_grouped_billing_row: Boolean(group.billing_group),
                billing_group: group.billing_group || null,
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
            displayRows.push({ ...row, is_detail_row: true, grouped_parent_name: group.billing_group?.display_name || group.company_name });
            return;
        }
        displayRows.push(row);
    });

    return displayRows;
}

function getCompanySummaryGroupKey(row) {
    const groupId = String(row?.billing_group?.id || row?.billing_group?.group_id || '').trim();
    if (groupId) return `billing-group:${groupId}`;
    return String(row?.company_id || row?.company_name || row?.account_name || row?.row_id || '').trim();
}

function renderBranchMain(row) {
    if (row.is_summary_row) {
        const groupBadge = row.billing_group
            ? `<span class="grouped-invoice-badge" title="Verified from tbl_groupings">${escapeHtml(row.billing_group.display_name || row.billing_group.group_name || 'Grouped Invoice')}</span>`
            : '';
        return `
            <span class="branch-head">
                <span>${escapeHtml(row.branch_name || 'Main')}</span>
                ${groupBadge}
            </span>
        `;
    }
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
    if (row.is_summary_row) {
        if (row.billing_group) {
            return `${row.billing_group.label || 'One Invoice, Multiple Machines'} • verified billing group`;
        }
        return 'Search subtotal across loaded machine rows';
    }
    if (row.billing_group) {
        return `Part of group: ${row.billing_group.display_name || row.billing_group.group_name || row.company_name || 'Grouped Invoice'}`;
    }
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

function sameMachineReadingRow(row, reading) {
    const machineId = String(row?.machine_id || '').trim();
    const contractId = String(row?.contractmain_id || '').trim();
    const companyId = String(row?.company_id || '').trim();
    const branchId = String(row?.branch_id || '').trim();
    if (machineId && String(reading?.machine_id || '').trim() === machineId) return true;
    if (contractId && String(reading?.current_contract || '').trim() !== contractId) return false;
    if (companyId && String(reading?.current_companyid || '').trim() !== companyId) return false;
    if (branchId && String(reading?.current_branchid || '').trim() !== branchId) return false;
    return Boolean(contractId || companyId || branchId);
}

async function loadInvoiceMachineReadingPair(row, invoiceNo) {
    const normalizedInvoice = normalizeInvoiceNumber(invoiceNo);
    if (!normalizedInvoice) return null;

    const fieldMask = [
        'id',
        'current_contract',
        'current_companyid',
        'current_branchid',
        'machine_id',
        'meter_reading',
        'meter_reading2',
        'timestmp',
        'date_red',
        'invoice_id'
    ];
    const invoiceValues = /^\d+$/.test(normalizedInvoice)
        ? [Number(normalizedInvoice), normalizedInvoice]
        : [normalizedInvoice];
    const currentDocs = await queryFirestoreIn('tbl_machinereading', 'invoice_id', invoiceValues, { select: fieldMask, limit: 200 }).catch((error) => {
        console.warn('Unable to load linked invoice meter reading.', error);
        return [];
    });
    const current = sortReadingsNewestFirst(currentDocs.filter((doc) => sameMachineReadingRow(row, doc)))[0] || null;
    if (!current) return null;

    const machineIds = normalizeNumericIds([row?.machine_id, current.machine_id]);
    const contractIds = normalizeNumericIds([row?.contractmain_id, current.current_contract]);
    const [machineDocs, contractDocs] = await Promise.all([
        queryFirestoreIn('tbl_machinereading', 'machine_id', machineIds, { select: fieldMask, limit: 500 }).catch(() => []),
        queryFirestoreIn('tbl_machinereading', 'current_contract', contractIds, { select: fieldMask, limit: 500 }).catch(() => [])
    ]);
    const currentDate = parseMachineReadingDate(current?.timestmp);
    const currentSort = currentDate ? currentDate.getTime() : Number(current?.id || 0) || 0;
    const byDocId = new Map();
    [...machineDocs, ...contractDocs].forEach((doc) => {
        const key = String(doc?._docId || `${doc?.id || ''}:${doc?.machine_id || ''}:${doc?.timestmp || ''}`).trim();
        if (key && !byDocId.has(key)) byDocId.set(key, doc);
    });
    const previous = sortReadingsNewestFirst(Array.from(byDocId.values()).filter((doc) => {
        if (String(doc?._docId || '') === String(current?._docId || '')) return false;
        if (!sameMachineReadingRow(row, doc)) return false;
        const docDate = parseMachineReadingDate(doc?.timestmp);
        const docSort = docDate ? docDate.getTime() : Number(doc?.id || 0) || 0;
        return docSort < currentSort;
    }))[0] || null;

    const currentMonthKey = monthKeyFromDate(parseMachineReadingDate(current?.timestmp));
    const previousMonthKey = monthKeyFromDate(parseMachineReadingDate(previous?.timestmp));
    return {
        current,
        previous,
        previousMeter: Number(previous?.meter_reading || 0) || 0,
        presentMeter: Number(current?.meter_reading || 0) || 0,
        previousMeter2: Number(previous?.meter_reading2 || 0) || 0,
        presentMeter2: Number(current?.meter_reading2 || 0) || 0,
        taskDate: parseMachineReadingDate(current?.timestmp) ? formatIsoDate(parseMachineReadingDate(current.timestmp)) : String(current?.timestmp || '').trim(),
        sourceMonthKey: currentMonthKey,
        sourceMonthLabel: currentMonthKey ? formatMonthLabel(currentMonthKey, currentMonthKey) : 'Linked invoice reading',
        previousMonthLabel: previousMonthKey ? formatMonthLabel(previousMonthKey, previousMonthKey) : 'Previous reading',
        readingId: String(current?.id || current?._docId || '').trim(),
        invoiceRef: normalizedInvoice
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
            const hasLinePresent = parseBillingDocLineItems(doc).some((line) => Number(line?.presentMeter || 0) > 0);
            if (presentMeter <= 0 && !hasLinePresent && !getBillingDocInvoiceRef(doc)) return false;
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

function buildPriorBillingLookup(doc, linkedReading = null) {
    const docMonthKey = getBillingDocMonthKey(doc);
    const dateRef = asValidDate(doc?.dateprinted || doc?.date_printed || doc?.invdate || doc?.invoice_date || doc?.datex || doc?.due_date);
    const linkedPresentMeter = Number(linkedReading?.presentMeter || 0) || 0;
    const linkedPresentMeter2 = Number(linkedReading?.presentMeter2 || 0) || 0;
    return {
        previousMeter: Number(doc?.field_present_meter ?? doc?.present_meter ?? 0) || linkedPresentMeter || 0,
        previousMeter2: Number(doc?.field_present_meter2 ?? doc?.present_meter2 ?? 0) || linkedPresentMeter2 || 0,
        lineItems: parseBillingDocLineItems(doc),
        taskDate: linkedReading?.taskDate || (dateRef ? formatIsoDate(dateRef) : ''),
        sourceMonthKey: docMonthKey,
        sourceMonthLabel: docMonthKey ? formatMonthLabel(docMonthKey, docMonthKey) : 'Previous billing',
        invoiceRef: getBillingDocInvoiceRef(doc),
        readingId: String(linkedReading?.readingId || doc?.id || doc?._docId || '').trim()
    };
}

function billingLineMatchesRow(line = {}, row = {}) {
    const lineContractId = String(line?.contractmainId || line?.contractmain_id || '').trim();
    const rowContractId = String(row?.contractmain_id || '').trim();
    if (lineContractId && rowContractId && lineContractId === rowContractId) return true;

    const lineMachineId = String(line?.machineId || line?.machine_id || '').trim();
    const rowMachineId = String(row?.machine_id || '').trim();
    if (lineMachineId && rowMachineId && lineMachineId === rowMachineId) return true;

    const lineRowId = String(line?.rowId || line?.row_id || '').trim();
    const rowId = getBillingRowLookupKey(row);
    return Boolean(lineRowId && rowId && lineRowId === rowId);
}

function pickPriorBillingLineReading(row, docs = [], monthKey) {
    const candidates = [];
    docs.forEach((doc) => {
        const docMonthKey = getBillingDocMonthKey(doc);
        if (!docMonthKey || docMonthKey >= monthKey) return;
        parseBillingDocLineItems(doc).forEach((line) => {
            if (!billingLineMatchesRow(line, row)) return;
            const presentMeter = Number(line?.presentMeter || 0) || 0;
            if (presentMeter <= 0) return;
            candidates.push({ doc, line, docMonthKey });
        });
    });
    return candidates
        .sort((left, right) => {
            if (left.docMonthKey !== right.docMonthKey) return String(right.docMonthKey).localeCompare(String(left.docMonthKey));
            return getBillingDocSortValue(right.doc) - getBillingDocSortValue(left.doc);
        })[0] || null;
}

function buildPriorBillingLineLookup(match) {
    const doc = match?.doc || {};
    const line = match?.line || {};
    const docMonthKey = match?.docMonthKey || getBillingDocMonthKey(doc);
    const dateRef = asValidDate(doc?.dateprinted || doc?.date_printed || doc?.invdate || doc?.invoice_date || doc?.datex || doc?.due_date);
    return {
        previousMeter: Number(line?.presentMeter || 0) || Number(line?.previousMeter || 0) || 0,
        previousMeter2: 0,
        lineItems: parseBillingDocLineItems(doc),
        taskDate: dateRef ? formatIsoDate(dateRef) : '',
        sourceMonthKey: docMonthKey,
        sourceMonthLabel: docMonthKey ? formatMonthLabel(docMonthKey, docMonthKey) : 'Previous grouped billing',
        invoiceRef: getBillingDocInvoiceRef(doc),
        readingId: String(doc?.id || doc?._docId || '').trim()
    };
}

async function loadPriorBillingReadingLookups(rows = [], monthKey) {
    const eligibleRows = rows.filter((row) => row?.contractmain_id);
    if (!eligibleRows.length) return new Map();

    const cacheKey = JSON.stringify({
        monthKey,
        contracts: eligibleRows.map((row) => String(row?.contractmain_id || '').trim()),
        companies: eligibleRows.map((row) => String(row?.company_id || '').trim())
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
        'field_present_meter2',
        'company_id',
        'machine_id',
        'billing_mode',
        'billing_lines_json'
    ];
    const contractIds = normalizeNumericIds(eligibleRows.map((row) => row.contractmain_id));
    const companyIds = uniqueNonBlankValues(eligibleRows.flatMap((row) => {
        const raw = String(row?.company_id || '').trim();
        const numeric = Number(raw);
        return Number.isFinite(numeric) && numeric > 0 ? [Math.trunc(numeric), raw] : [raw];
    }));
    const [contractDocs, companyDocs] = await Promise.all([
        queryFirestoreIn('tbl_billing', 'contractmain_id', contractIds, { select: fieldMask, limit: 5000 }).catch((error) => {
            console.warn('Unable to load prior billing readings by contract.', error);
            return [];
        }),
        queryFirestoreIn('tbl_billing', 'company_id', companyIds, { select: fieldMask, limit: 5000 }).catch((error) => {
            console.warn('Unable to load prior grouped billing readings by company.', error);
            return [];
        })
    ]);
    const docsById = new Map();
    [...contractDocs, ...companyDocs].forEach((doc) => {
        const key = String(doc?._docId || `${doc?.id || ''}:${doc?.invoice_id || ''}:${doc?.contractmain_id || ''}`).trim();
        if (key && !docsById.has(key)) docsById.set(key, doc);
    });
    const docs = Array.from(docsById.values());

    const lookups = new Map();
    for (const row of eligibleRows) {
        const pickedLine = pickPriorBillingLineReading(row, docs, monthKey);
        if (pickedLine) {
            const lookup = buildPriorBillingLineLookup(pickedLine);
            const key = getBillingRowLookupKey(row);
            if (key) lookups.set(key, lookup);
            continue;
        }

        const picked = pickPriorBillingReading(row, docs, monthKey);
        if (!picked) continue;
        let linkedReading = null;
        const savedPresentMeter = Number(picked?.field_present_meter ?? picked?.present_meter ?? 0) || 0;
        if (savedPresentMeter <= 0 && getBillingDocInvoiceRef(picked)) {
            linkedReading = await loadInvoiceMachineReadingPair(row, getBillingDocInvoiceRef(picked));
        }
        const lookup = buildPriorBillingLookup(picked, linkedReading);
        if (Number(lookup.previousMeter || 0) <= 0 && !hasSplitMultiMeterLines(lookup.lineItems || [])) continue;
        const key = getBillingRowLookupKey(row);
        if (key) lookups.set(key, lookup);
    }

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

function hasSharedBillingGroupQuota(rows = []) {
    return (Array.isArray(rows) ? rows : []).some((row) => Number(row?.billing_group?.monthly_quota || 0) > 0);
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

function getMeterLineIdentity(line = {}) {
    const label = String(line?.label || '').toLowerCase();
    const section = String(line?.meterSection || line?.section || '').toLowerCase();
    const type = String(line?.meterType || '').toLowerCase();
    return { label, section, type };
}

function findSavedMeterLine(savedLineItems = [], { section = '', type = '', legacyLabel = '', fallbackIndex = -1 } = {}) {
    const normalizedSection = String(section || '').toLowerCase();
    const normalizedType = String(type || '').toLowerCase();
    const normalizedLegacyLabel = String(legacyLabel || '').toLowerCase();
    const exactLine = savedLineItems.find((line) => {
        const identity = getMeterLineIdentity(line);
        return identity.section === normalizedSection && identity.type === normalizedType;
    });
    if (exactLine) return exactLine;

    const labelLine = savedLineItems.find((line) => {
        const identity = getMeterLineIdentity(line);
        return identity.label.includes(normalizedSection) && identity.label.includes(normalizedType);
    });
    if (labelLine) return labelLine;

    if (normalizedLegacyLabel) {
        const legacyLine = savedLineItems.find((line) => getMeterLineIdentity(line).label.includes(normalizedLegacyLabel));
        if (legacyLine) return legacyLine;
    }

    return fallbackIndex >= 0 ? savedLineItems[fallbackIndex] || null : null;
}

function hasSplitMultiMeterLines(savedLineItems = []) {
    const sections = new Set(savedLineItems.map((line) => getMeterLineIdentity(line).section).filter(Boolean));
    return sections.has('print') && sections.has('copy');
}

function useLinePresentAsNextPrevious(line = null) {
    if (!line) return null;
    const previous = Number(line.presentMeter || 0) || Number(line.previousMeter || 0) || 0;
    return {
        ...line,
        previousMeter: previous,
        presentMeter: previous
    };
}

function buildMultiMeterSeedLine({
    label,
    section,
    type,
    profile = {},
    previousMeter = 0,
    presentMeter = 0,
    spoilagePercent = DEFAULT_SPOILAGE_RATE * 100,
    row = null,
    savedLine = null,
    previousMeterReference = ''
} = {}) {
    const mergedProfile = {
        ...profile,
        page_rate: Number(savedLine?.pageRate ?? profile.page_rate ?? 0) || 0,
        succeeding_page_rate: Number(savedLine?.succeedingRate ?? profile.succeeding_page_rate ?? profile.page_rate_xtra ?? profile.page_rate ?? 0) || 0,
        monthly_quota: Number(savedLine?.monthlyQuota ?? profile.monthly_quota ?? 0) || 0,
        monthly_rate: Number(savedLine?.monthlyRate ?? profile.monthly_rate ?? 0) || 0
    };
    const line = calculateMeterLineEstimate({
        label,
        subtitle: String(row?.serial_number || row?.machine_id || '').trim(),
        meterSection: section,
        meterType: type,
        profile: mergedProfile,
        previousMeter: Number(savedLine?.previousMeter ?? previousMeter ?? 0) || 0,
        presentMeter: Number(savedLine?.presentMeter ?? presentMeter ?? 0) || 0,
        spoilagePercent: Number(savedLine?.spoilagePercent ?? spoilagePercent ?? 0) || 0,
        actualSpoilagePages: Number(savedLine?.actualSpoilagePages || 0) || 0,
        actualSpoilageReason: String(savedLine?.actualSpoilageReason || '').trim(),
        actualSpoilageProofImage: String(savedLine?.actualSpoilageProofImage || '').trim(),
        actualSpoilageProofName: String(savedLine?.actualSpoilageProofName || '').trim(),
        actualSpoilageProofType: String(savedLine?.actualSpoilageProofType || '').trim(),
        approvalStatus: String(savedLine?.approvalStatus || '').trim(),
        approvalNote: String(savedLine?.approvalNote || '').trim(),
        approvedBy: String(savedLine?.approvedBy || '').trim(),
        approvedAt: String(savedLine?.approvedAt || '').trim(),
        row
    });
    return { ...line, profile: mergedProfile, previousMeterReference: String(previousMeterReference || '').trim() };
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
    actualSpoilagePages = 0,
    actualSpoilageReason = '',
    actualSpoilageProofImage = '',
    actualSpoilageProofName = '',
    actualSpoilageProofType = '',
    approvalStatus = '',
    approvalNote = '',
    approvedBy = '',
    approvedAt = '',
    actualSpoilageRequestedBy = '',
    actualSpoilageRequestedAt = '',
    applyQuota = true,
    quotaBypassReason = '',
    forceFixed = false,
    row = null,
    missingMeterMessage = '',
    pendingPresentMessage = '',
    meterSection = '',
    meterType = ''
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
    let systemSpoilagePages = 0;
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
    const shouldApplyQuota = applyQuota !== false;
    const quotaBypassed = !shouldApplyQuota && monthlyQuota > 0;

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
            systemSpoilagePages = Math.round(rawPages * spoilageRate);
            spoilagePages = Math.min(rawPages, systemSpoilagePages + Math.max(0, Number(actualSpoilagePages || 0) || 0));
            netPages = Math.max(0, rawPages - spoilagePages);
            const bypassQuotaFloor = quotaBypassed && netPages < monthlyQuota;
            billedPages = monthlyQuota > 0 && !bypassQuotaFloor ? Math.max(netPages, monthlyQuota) : netPages;
            if (billedPages > 0 && pageRate > 0) {
                if (monthlyQuota > 0) {
                    quotaPages = bypassQuotaFloor ? billedPages : Math.min(billedPages, monthlyQuota);
                    succeedingPages = bypassQuotaFloor ? 0 : Math.max(0, netPages - monthlyQuota);
                    quotaAmount = quotaPages * pageRate;
                    succeedingAmount = succeedingPages * succeedingRate;
                    amountDue = quotaAmount + succeedingAmount;
                    formula = bypassQuotaFloor
                        ? 'quota_bypassed_actual_usage'
                        : succeedingPages > 0
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
        meterSection: String(meterSection || '').trim(),
        meterType: String(meterType || '').trim(),
        rowId: row ? String(row.row_id || row.company_id || '').trim() : '',
        companyName: row ? String(row.company_name || row.account_name || '').trim() : '',
        branchName: row ? String(row.branch_name || '').trim() : '',
        machineId: row ? String(row.machine_id || '').trim() : '',
        contractmainId: row ? String(row.contractmain_id || '').trim() : '',
        serialNumber: row ? String(row.serial_number || '').trim() : '',
        machineModel: row ? String(row.machine_label || '').trim() : '',
        previousMeter: previous,
        presentMeter: present,
        rawPages,
        spoilagePercent: Number((spoilageRate * 100).toFixed(2)),
        spoilageRate,
        systemSpoilagePages,
        actualSpoilagePages: Math.max(0, Number(actualSpoilagePages || 0) || 0),
        totalSpoilagePages: spoilagePages,
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
        applyQuota: shouldApplyQuota,
        quotaBypassed: formula === 'quota_bypassed_actual_usage',
        quotaBypassReason: String(!shouldApplyQuota && !String(quotaBypassReason || '').trim()
            ? 'Quota unchecked - reason not entered'
            : quotaBypassReason || '').trim(),
        pages: billedPages,
        amountDue,
        netAmount,
        vatAmount,
        quotaVariance: monthlyQuota > 0 ? netPages - monthlyQuota : null,
        formula,
        warning,
        actualSpoilageReason: String(actualSpoilageReason || '').trim(),
        actualSpoilageProofImage: String(actualSpoilageProofImage || '').trim(),
        actualSpoilageProofName: String(actualSpoilageProofName || '').trim(),
        actualSpoilageProofType: String(actualSpoilageProofType || '').trim(),
        actualSpoilageRequestedBy: String(actualSpoilageRequestedBy || '').trim(),
        actualSpoilageRequestedAt: String(actualSpoilageRequestedAt || '').trim(),
        approvalStatus: Math.max(0, Number(actualSpoilagePages || 0) || 0) > 0
            ? String(approvalStatus || 'pending').trim()
            : 'none',
        approvalNote: String(approvalNote || '').trim(),
        approvedBy: String(approvedBy || '').trim(),
        approvedAt: String(approvedAt || '').trim(),
        missingMeterMessage,
        pendingPresentMessage,
        missingMeterSource: Boolean(missingMeterMessage && previous <= 0 && present <= 0)
    };
}

function buildSavedLegacyBillingEstimate({ doc, context = {}, profile = {}, row = null, seedEstimate = null } = {}) {
    const amountDue = getBillingDocAmount(doc);
    if (!doc || amountDue <= 0) return null;

    const previousMeter = Math.max(0, Number(seedEstimate?.previousMeter || 0) || 0);
    const presentMeter = Math.max(0, Number(seedEstimate?.presentMeter || 0) || 0);
    const meterDelta = Math.max(0, presentMeter - previousMeter);
    const pages = getLegacyBillingPageBreakdown(doc);
    const rawPages = pages.rawPages || meterDelta || Number(seedEstimate?.rawPages || 0) || 0;
    const spoilagePages = pages.spoilagePages || Number(seedEstimate?.spoilagePages || 0) || 0;
    const netPages = pages.netPages || Math.max(0, rawPages - spoilagePages);
    const monthlyQuota = Number(profile.monthly_quota || 0) || 0;
    const pageRate = Number(profile.page_rate || 0) || 0;
    const succeedingRate = getSucceedingPageRate(profile);
    const quotaAmount = monthlyQuota > 0 && pageRate > 0
        ? roundBillingAmount(monthlyQuota * pageRate)
        : 0;
    const matchesQuotaFloor = quotaAmount > 0 && Math.abs(amountDue - quotaAmount) < 0.01;
    const { netAmount, vatAmount } = getBillingDocNetVat(doc, profile);
    const savedInvoiceRef = getBillingDocInvoiceRef(doc);
    const line = {
        ...(seedEstimate || {}),
        label: row?.branch_name || row?.serial_number || 'Saved invoice',
        rowId: row ? String(row.row_id || row.company_id || '').trim() : '',
        companyName: row ? String(row.company_name || row.account_name || '').trim() : '',
        branchName: row ? String(row.branch_name || '').trim() : '',
        machineId: row ? String(row.machine_id || '').trim() : '',
        contractmainId: row ? String(row.contractmain_id || '').trim() : '',
        serialNumber: row ? String(row.serial_number || '').trim() : '',
        machineModel: row ? String(row.machine_label || '').trim() : '',
        previousMeter,
        presentMeter,
        rawPages,
        systemSpoilagePages: Number(doc?.system_spoilage_pages ?? spoilagePages) || 0,
        actualSpoilagePages: Number(doc?.actual_spoilage_pages || 0) || 0,
        totalSpoilagePages: spoilagePages,
        spoilagePages,
        netPages,
        billedPages: matchesQuotaFloor ? monthlyQuota : (Number(seedEstimate?.billedPages || 0) || netPages),
        quotaPages: matchesQuotaFloor ? monthlyQuota : Number(seedEstimate?.quotaPages || 0) || 0,
        succeedingPages: matchesQuotaFloor ? 0 : Number(seedEstimate?.succeedingPages || 0) || 0,
        quotaAmount: matchesQuotaFloor ? quotaAmount : Number(seedEstimate?.quotaAmount || 0) || 0,
        succeedingAmount: matchesQuotaFloor ? 0 : Number(seedEstimate?.succeedingAmount || 0) || 0,
        pageRate,
        succeedingRate,
        monthlyQuota,
        amountDue,
        netAmount,
        vatAmount,
        pages: matchesQuotaFloor ? monthlyQuota : netPages,
        quotaVariance: monthlyQuota > 0 ? netPages - monthlyQuota : null,
        formula: 'saved_legacy_invoice_total',
        actualSpoilageReason: String(doc?.actual_spoilage_reason || '').trim(),
        actualSpoilageProofImage: String(doc?.actual_spoilage_proof_image || '').trim(),
        actualSpoilageProofName: String(doc?.actual_spoilage_proof_name || '').trim(),
        actualSpoilageProofType: String(doc?.actual_spoilage_proof_type || '').trim(),
        approvalStatus: String(doc?.approval_status || (Number(doc?.actual_spoilage_pages || 0) > 0 ? 'pending' : 'none')).trim(),
        approvalNote: String(doc?.approval_note || '').trim(),
        approvedBy: String(doc?.approved_by || '').trim(),
        approvedAt: String(doc?.approved_at || '').trim(),
        savedComputation: `Saved invoice ${savedInvoiceRef || 'record'} total is ${formatAmount(amountDue)}. Stored pages: ${formatCount(rawPages)} gross - ${formatCount(spoilagePages)} spoilage = ${formatCount(netPages)} net. This saved legacy invoice total is authoritative; editing the meter fields will recalculate a replacement amount.`,
        warning: meterDelta > 0 && rawPages > 0 && meterDelta !== rawPages
            ? `Linked meter movement is ${formatCount(meterDelta)} pages, while the saved billing record stores ${formatCount(rawPages)} pages. The saved invoice amount is being preserved for audit.`
            : ''
    };
    const summary = summarizeBillingLines([line], 'saved_legacy_invoice_total');
    return {
        ...summary,
        ...line,
        lineItems: [line],
        billingMode: String(doc?.billing_mode || context?.savedBillingMode || 'single_meter_rtp').trim() || 'single_meter_rtp'
    };
}

function summarizeLineWarnings(lines = []) {
    const warnings = (Array.isArray(lines) ? lines : [])
        .map((line) => String(line?.warning || '').trim())
        .filter(Boolean);
    if (warnings.length <= 1) return warnings[0] || '';

    const counts = new Map();
    warnings.forEach((warning) => counts.set(warning, (counts.get(warning) || 0) + 1));
    return Array.from(counts.entries())
        .map(([warning, count]) => count > 1 ? `${warning} (${formatCount(count)} lines)` : warning)
        .join(' ');
}

function summarizeBillingLines(lineItems = [], fallbackFormula = 'not_available') {
    const lines = Array.isArray(lineItems) ? lineItems : [];
    const amountDue = roundBillingAmount(lines.reduce((sum, line) => sum + Number(line.amountDue || 0), 0));
    const netAmount = roundBillingAmount(lines.reduce((sum, line) => sum + Number(line.netAmount || 0), 0));
    const vatAmount = roundBillingAmount(lines.reduce((sum, line) => sum + Number(line.vatAmount || 0), 0));
    const rawPages = lines.reduce((sum, line) => sum + Number(line.rawPages || 0), 0);
    const spoilagePages = lines.reduce((sum, line) => sum + Number(line.spoilagePages || 0), 0);
    const systemSpoilagePages = lines.reduce((sum, line) => sum + Number(line.systemSpoilagePages ?? line.spoilagePages ?? 0), 0);
    const actualSpoilagePages = lines.reduce((sum, line) => sum + Number(line.actualSpoilagePages || 0), 0);
    const netPages = lines.reduce((sum, line) => sum + Number(line.netPages || 0), 0);
    const billedPages = lines.reduce((sum, line) => sum + Number(line.billedPages || 0), 0);
    const quotaPages = lines.reduce((sum, line) => sum + Number(line.quotaPages || 0), 0);
    const succeedingPages = lines.reduce((sum, line) => sum + Number(line.succeedingPages || 0), 0);
    const quotaAmount = roundBillingAmount(lines.reduce((sum, line) => sum + Number(line.quotaAmount || 0), 0));
    const succeedingAmount = roundBillingAmount(lines.reduce((sum, line) => sum + Number(line.succeedingAmount || 0), 0));
    const quotaBypassed = lines.some((line) => line.quotaBypassed === true);
    const quotaBypassReason = lines.map((line) => String(line.quotaBypassReason || '').trim()).find(Boolean) || '';
    return {
        lineItems: lines,
        rawPages,
        systemSpoilagePages,
        actualSpoilagePages,
        totalSpoilagePages: spoilagePages,
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
        applyQuota: !quotaBypassed,
        quotaBypassed,
        quotaBypassReason,
        approvalStatus: actualSpoilagePages > 0 ? (lines.find((line) => line.approvalStatus)?.approvalStatus || 'pending') : 'none',
        formula: lines.length > 1 ? 'sum_of_billing_lines' : (lines[0]?.formula || fallbackFormula),
        warning: summarizeLineWarnings(lines)
    };
}

function getSharedMeterGroupKey(line = {}) {
    const type = String(line?.meterType || '').toLowerCase();
    const label = String(line?.label || '').toLowerCase();
    if (type.includes('color') || label.includes('colored') || label.includes('color')) return 'color';
    return 'black_white';
}

function getSharedMeterGroupLabel(groupKey) {
    return groupKey === 'color' ? 'Colored' : 'Black / White';
}

function allocateSharedAmount(total, weights = []) {
    const totalAmount = roundBillingAmount(total);
    const totalWeight = weights.reduce((sum, value) => sum + Math.max(0, Number(value || 0) || 0), 0);
    if (totalWeight <= 0 || totalAmount <= 0) return weights.map(() => 0);
    let remaining = totalAmount;
    return weights.map((weight, index) => {
        if (index === weights.length - 1) return roundBillingAmount(remaining);
        const share = roundBillingAmount(totalAmount * (Math.max(0, Number(weight || 0) || 0) / totalWeight));
        remaining = roundBillingAmount(remaining - share);
        return share;
    });
}

function applySharedMultiMeterQuota(lineItems = []) {
    const sourceLines = Array.isArray(lineItems) ? lineItems : [];
    const resultLines = [...sourceLines];
    const groupKeys = ['black_white', 'color'];

    groupKeys.forEach((groupKey) => {
        const indexes = resultLines
            .map((line, index) => ({ line, index }))
            .filter(({ line }) => getSharedMeterGroupKey(line) === groupKey);
        if (!indexes.length) return;

        const usableLines = indexes.filter(({ line }) => !isNonBillableMeterFormula(line?.formula));
        const totalNetPages = usableLines.reduce((sum, { line }) => sum + Number(line.netPages || 0), 0);
        const totalRawPages = usableLines.reduce((sum, { line }) => sum + Number(line.rawPages || 0), 0);
        const totalSpoilagePages = usableLines.reduce((sum, { line }) => sum + Number(line.spoilagePages || 0), 0);
        const totalSystemSpoilagePages = usableLines.reduce((sum, { line }) => sum + Number(line.systemSpoilagePages ?? line.spoilagePages ?? 0), 0);
        const totalActualSpoilagePages = usableLines.reduce((sum, { line }) => sum + Number(line.actualSpoilagePages || 0), 0);
        const rateLine = usableLines.find(({ line }) => Number(line.monthlyQuota || 0) > 0 || Number(line.pageRate || 0) > 0)?.line
            || indexes[0].line;
        const monthlyQuota = Number(rateLine?.monthlyQuota || 0) || 0;
        const pageRate = Number(rateLine?.pageRate || 0) || 0;
        const succeedingRate = Number(rateLine?.succeedingRate || pageRate || 0) || pageRate;
        const withVat = Boolean(rateLine?.profile?.with_vat);
        const applyQuota = usableLines.every(({ line }) => line.applyQuota !== false);
        const quotaBypassed = !applyQuota && monthlyQuota > 0 && totalNetPages < monthlyQuota;
        const billedPages = monthlyQuota > 0 && !quotaBypassed ? Math.max(totalNetPages, monthlyQuota) : totalNetPages;
        const quotaPages = monthlyQuota > 0 && !quotaBypassed ? Math.min(billedPages, monthlyQuota) : billedPages;
        const succeedingPages = quotaBypassed ? 0 : Math.max(0, totalNetPages - monthlyQuota);
        const quotaAmount = roundBillingAmount(quotaPages * pageRate);
        const succeedingAmount = roundBillingAmount(succeedingPages * succeedingRate);
        const amountDue = roundBillingAmount(quotaAmount + succeedingAmount);
        const netAmount = withVat ? roundBillingAmount(amountDue / 1.12) : amountDue;
        const vatAmount = withVat ? roundBillingAmount(amountDue - netAmount) : roundBillingAmount(amountDue * 0.12);
        const weights = usableLines.map(({ line }) => Number(line.netPages || line.rawPages || 0) || 0);
        const amountShares = allocateSharedAmount(amountDue, weights);
        const netShares = allocateSharedAmount(netAmount, weights);
        const vatShares = allocateSharedAmount(vatAmount, weights);
        const quotaPageShares = allocateSharedAmount(quotaPages, weights);
        const succeedingPageShares = allocateSharedAmount(succeedingPages, weights);
        const quotaAmountShares = allocateSharedAmount(quotaAmount, weights);
        const succeedingAmountShares = allocateSharedAmount(succeedingAmount, weights);
        const groupLabel = getSharedMeterGroupLabel(groupKey);
        const groupFormula = quotaBypassed
            ? 'shared_quota_bypassed_actual_usage'
            : succeedingPages > 0
                ? 'shared_quota_pages_plus_succeeding_rate'
                : 'shared_quota_floor_after_spoilage';
        const sharedComputation = `${groupLabel}: ${formatCount(totalRawPages)} raw - ${formatCount(totalSpoilagePages)} spoilage = ${formatCount(totalNetPages)} net. ${formatCount(quotaPages)} shared quota pages x ${formatAmount(pageRate)} plus ${formatCount(succeedingPages)} succeeding pages x ${formatAmount(succeedingRate)} = ${formatAmount(amountDue)}.`;

        usableLines.forEach(({ line, index }, shareIndex) => {
            const lineShareComputation = `${line.label || groupLabel}: ${formatCount(line.netPages || 0)} net pages share of ${formatCount(totalNetPages)} group net pages. Allocated ${formatAmount(amountShares[shareIndex] || 0)} from the shared invoice total using ${formatCount(monthlyQuota || quotaPages)} shared quota pages.`;
            resultLines[index] = {
                ...line,
                amountDue: amountShares[shareIndex] || 0,
                netAmount: netShares[shareIndex] || 0,
                vatAmount: vatShares[shareIndex] || 0,
                billedPages: quotaPageShares[shareIndex] + succeedingPageShares[shareIndex],
                quotaPages: quotaPageShares[shareIndex] || 0,
                succeedingPages: succeedingPageShares[shareIndex] || 0,
                quotaAmount: quotaAmountShares[shareIndex] || 0,
                succeedingAmount: succeedingAmountShares[shareIndex] || 0,
                formula: groupFormula,
                sharedMeterGroup: groupKey,
                sharedMeterGroupLabel: groupLabel,
                sharedGroupRawPages: totalRawPages,
                sharedGroupSystemSpoilagePages: totalSystemSpoilagePages,
                sharedGroupActualSpoilagePages: totalActualSpoilagePages,
                sharedGroupSpoilagePages: totalSpoilagePages,
                sharedGroupNetPages: totalNetPages,
                sharedGroupQuotaPages: quotaPages,
                sharedGroupSucceedingPages: succeedingPages,
                sharedGroupAmountDue: amountDue,
                sharedGroupComputation: sharedComputation,
                sharedLineComputation: lineShareComputation,
                sharedQuotaGroup: true,
                quotaVariance: monthlyQuota > 0 ? totalNetPages - monthlyQuota : null,
                quotaBypassed
            };
        });
    });

    const summary = summarizeBillingLines(resultLines, 'shared_multi_meter_quota');
    summary.formula = 'shared_multi_meter_quota';
    const sharedGroups = new Map();
    resultLines.forEach((line) => {
        const key = String(line.sharedMeterGroup || '').trim();
        if (!key || sharedGroups.has(key)) return;
        sharedGroups.set(key, {
            key,
            label: line.sharedMeterGroupLabel || getSharedMeterGroupLabel(key),
            rawPages: Number(line.sharedGroupRawPages || 0) || 0,
            spoilagePages: Number(line.sharedGroupSpoilagePages || 0) || 0,
            netPages: Number(line.sharedGroupNetPages || 0) || 0,
            quotaPages: Number(line.sharedGroupQuotaPages || 0) || 0,
            succeedingPages: Number(line.sharedGroupSucceedingPages || 0) || 0,
            amountDue: Number(line.sharedGroupAmountDue || 0) || 0,
            computation: line.sharedGroupComputation || ''
        });
    });
    summary.sharedMeterGroups = Array.from(sharedGroups.values());
    return summary;
}

function buildBillingLinesSignature(lineItems = []) {
    return JSON.stringify((Array.isArray(lineItems) ? lineItems : []).map((line) => ({
        label: String(line.label || '').trim(),
        rowId: String(line.rowId || '').trim(),
        previousMeter: Number(line.previousMeter || 0) || 0,
        presentMeter: Number(line.presentMeter || 0) || 0,
        spoilagePercent: Number(line.spoilagePercent || 0) || 0,
        actualSpoilagePages: Number(line.actualSpoilagePages || 0) || 0,
        actualSpoilageReason: String(line.actualSpoilageReason || '').trim(),
        actualSpoilageProofName: String(line.actualSpoilageProofName || '').trim(),
        applyQuota: line.applyQuota !== false,
        quotaBypassReason: String(line.quotaBypassReason || '').trim(),
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
    const groupId = String(row?.billing_group?.id || row?.billing_group?.group_id || '').trim();
    if (!groupId) return [];
    const rows = lastPayload.month_matrix.rows
        .filter((entry) => (
            entry
            && !entry.is_summary_row
            && String(entry?.billing_group?.id || entry?.billing_group?.group_id || '').trim() === groupId
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
        const entryGroupId = String(entry?.billing_group?.id || entry?.billing_group?.group_id || '').trim();
        const isVerifiedGroupMember = groupId && entryGroupId === groupId;
        const contractStatus = Number(entry.contract_status || entry.billing_profile?.contract_status || 0) || 0;
        const isActiveGroupMember = isVerifiedGroupMember && [1, 2, 3, 4, 8, 9, 10, 13].includes(contractStatus);
        if (!isActiveGroupMember && !cell.pending && !Number(cell.reading_amount_total || 0) && !Number(cell.display_amount_total || 0)) return;
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

function formatReportDate(ymd) {
    const match = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return String(ymd || '');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderPrintedTodayCard(payload) {
    const report = payload?.productivity_report || null;
    const count = Number(report?.today?.invoice_count || 0);
    const amount = Number(report?.today?.amount_total || 0);
    const savedCount = Number(report?.saved_to_print?.invoice_count || 0);
    const savedAmount = Number(report?.saved_to_print?.amount_total || 0);
    const monthCount = Number(report?.current_month_printed?.invoice_count || 0);
    const monthAmount = Number(report?.current_month_printed?.amount_total || 0);
    const receivedCount = Number(report?.current_month_printed?.received_count || 0);
    const pendingReceivedCount = Number(report?.current_month_printed?.pending_received_count || 0);
    if (els.printedTodayCount) els.printedTodayCount.textContent = formatCount(count);
    if (els.printedTodayAmount) {
        els.printedTodayAmount.textContent = `${formatCurrency(amount)} printed today`;
    }
    if (els.savedToPrintCount) els.savedToPrintCount.textContent = formatCount(savedCount);
    if (els.savedToPrintAmount) {
        els.savedToPrintAmount.textContent = savedCount
            ? `${formatCurrency(savedAmount)} waiting`
            : 'No saved invoices waiting';
    }
    if (els.printedMonthCount) els.printedMonthCount.textContent = formatCount(monthCount);
    if (els.printedMonthAmount) {
        els.printedMonthAmount.textContent = `${formatCurrency(monthAmount)} • ${formatCount(receivedCount)} received / ${formatCount(pendingReceivedCount)} pending`;
    }
    if (els.printedTodayCard) {
        els.printedTodayCard.disabled = false;
        els.printedTodayCard.title = report
            ? 'Open billing productivity report'
            : 'Load the dashboard to see printed invoice totals';
    }
    if (els.savedToPrintCard) {
        els.savedToPrintCard.disabled = false;
        els.savedToPrintCard.title = report
            ? 'Open saved invoices waiting for print'
            : 'Load the dashboard to see saved invoice queue';
    }
    if (els.printedMonthCard) {
        els.printedMonthCard.disabled = false;
        els.printedMonthCard.title = report
            ? 'Open monthly printed and received status'
            : 'Load the dashboard to see monthly printed invoice totals';
    }
}

function renderProductivityStaffRows(rows = []) {
    if (!rows.length) {
        return '<div class="detail-empty">No printed invoices found for this period.</div>';
    }
    return `
        <div class="billing-scorecard-detail-wrap">
            <table class="billing-scorecard-detail-table productivity-table">
                <thead>
                    <tr>
                        <th>Encoder</th>
                        <th class="text-right">Invoices</th>
                        <th class="text-right">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td>
                                <strong>${escapeHtml(row.staff_name || 'Unknown encoder')}</strong>
                                ${row.staff_role ? `<small>${escapeHtml(row.staff_role)}</small>` : ''}
                            </td>
                            <td class="text-right">${escapeHtml(formatCount(row.invoice_count || 0))}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(row.amount_total || 0))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderProductivityMonthProgress(rows = [], sinceDate = '') {
    const activeRows = rows.filter((row) => (
        Number(row.added_today_total || 0) !== 0
        || Number(row.since_start_total || 0) !== 0
        || Number(row.current_total || 0) !== 0
    ));
    if (!activeRows.length) {
        return '<div class="detail-empty">No billing month progress is available yet.</div>';
    }
    return `
        <div class="billing-scorecard-detail-wrap">
            <table class="billing-scorecard-detail-table productivity-table">
                <thead>
                    <tr>
                        <th>Billing Month</th>
                        <th class="text-right">Before Today</th>
                        <th class="text-right">Added Today</th>
                        <th class="text-right">Current Total</th>
                        <th class="text-right">Since ${escapeHtml(formatReportDate(sinceDate))}</th>
                    </tr>
                </thead>
                <tbody>
                    ${activeRows.map((row) => `
                        <tr>
                            <td><strong>${escapeHtml(row.month_label_short || row.month_label || row.month_key)}</strong></td>
                            <td class="text-right">${escapeHtml(formatCurrency(row.before_today_total || 0))}</td>
                            <td class="text-right">
                                <strong>${escapeHtml(formatCurrency(row.added_today_total || 0))}</strong>
                                <small>${escapeHtml(formatMetricCount(row.added_today_invoice_count || 0, 'invoice'))}</small>
                            </td>
                            <td class="text-right">${escapeHtml(formatCurrency(row.current_total || 0))}</td>
                            <td class="text-right">
                                ${escapeHtml(formatCurrency(row.since_start_total || 0))}
                                <small>${escapeHtml(formatMetricCount(row.since_start_invoice_count || 0, 'invoice'))}</small>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderProductivityInvoiceRows(rows = []) {
    if (!rows.length) {
        return '<div class="detail-empty">No invoice detail rows for today.</div>';
    }
    return `
        <div class="billing-scorecard-detail-wrap">
            <table class="billing-scorecard-detail-table productivity-table">
                <thead>
                    <tr>
                        <th>Invoice</th>
                        <th>Customer</th>
                        <th>Billing Month</th>
                        <th>Encoder</th>
                        <th class="text-right">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td><strong>${escapeHtml(row.invoice_no || row.doc_id || 'Invoice')}</strong></td>
                            <td>
                                <strong>${escapeHtml(row.company_name || 'Unknown')}</strong>
                                <small>${escapeHtml(row.branch_name || 'Main')}</small>
                            </td>
                            <td>${escapeHtml(row.month_label || formatMonthLabel(row.month_key, row.month_key))}</td>
                            <td>${escapeHtml(row.staff_name || 'Unknown encoder')}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(row.amount_total || 0))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function formatReportDateTime(value) {
    const date = asValidDate(value);
    if (!date) return '';
    return date.toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function formatInvoiceAge(value) {
    const date = asValidDate(value);
    if (!date) return '-';
    const hours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 36e5));
    if (hours < 24) return `${formatCount(hours)} hr${hours === 1 ? '' : 's'}`;
    const days = Math.floor(hours / 24);
    return `${formatCount(days)} day${days === 1 ? '' : 's'}`;
}

function renderSavedToPrintRows(rows = []) {
    if (!rows.length) {
        return '<div class="detail-empty">No saved invoices are waiting for print.</div>';
    }
    return `
        <div class="billing-scorecard-detail-wrap">
            <table class="billing-scorecard-detail-table productivity-table">
                <thead>
                    <tr>
                        <th>Company</th>
                        <th>Serial</th>
                        <th>Branch</th>
                        <th>Invoice #</th>
                        <th>Prepared By</th>
                        <th class="text-right">Amount</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td><strong>${escapeHtml(row.company_name || 'Unknown')}</strong></td>
                            <td>${escapeHtml((row.serial_numbers || []).join(', ') || row.machine_label || '-')}</td>
                            <td>${escapeHtml(row.branch_name || 'Main')}</td>
                            <td><strong>${escapeHtml(row.invoice_no || '-')}</strong></td>
                            <td>
                                ${escapeHtml(row.prepared_by || 'Unknown preparer')}
                                ${row.saved_at ? `<small>${escapeHtml(formatReportDateTime(row.saved_at))}</small>` : ''}
                            </td>
                            <td class="text-right">${escapeHtml(formatCurrency(row.amount_total || 0))}</td>
                            <td>
                                <button
                                    class="btn btn-secondary"
                                    type="button"
                                    data-productivity-view-invoice="${escapeHtml(row.invoice_no || '')}"
                                    data-productivity-row-id="${escapeHtml(row.row_id || '')}"
                                    data-productivity-month-key="${escapeHtml(row.month_key || '')}"
                                >View</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function getSavedToPrintDateRange(report = {}) {
    const rows = report?.saved_to_print?.invoices || [];
    const dates = rows
        .map((row) => normalizeWorkDistributionDate(row.saved_at))
        .filter(Boolean)
        .sort();
    const today = formatIsoDate(new Date());
    return {
        from: dates[0] || today,
        to: dates[dates.length - 1] || today
    };
}

function summarizeSavedToPrint(rows = [], from = '', to = '') {
    const filteredRows = rows.filter((row) => isDateInWorkRange(row.saved_at, from, to));
    const byPreparer = new Map();
    filteredRows.forEach((row) => {
        const staffId = String(row.prepared_by_id || row.prepared_by || 'unknown-preparer').trim() || 'unknown-preparer';
        const staffName = String(row.prepared_by || 'Unknown preparer').trim() || 'Unknown preparer';
        if (!byPreparer.has(staffId)) {
            byPreparer.set(staffId, {
                staff_id: staffId,
                staff_name: staffName,
                invoice_count: 0,
                amount_total: 0
            });
        }
        const group = byPreparer.get(staffId);
        group.invoice_count += 1;
        group.amount_total += Number(row.amount_total || 0) || 0;
    });

    return {
        rows: filteredRows,
        byPreparer: Array.from(byPreparer.values())
            .map((row) => ({ ...row, amount_total: roundDisplayAmount(row.amount_total) }))
            .sort((a, b) => b.invoice_count - a.invoice_count || b.amount_total - a.amount_total || a.staff_name.localeCompare(b.staff_name)),
        totals: {
            invoice_count: filteredRows.length,
            amount_total: roundDisplayAmount(filteredRows.reduce((sum, row) => sum + Number(row.amount_total || 0), 0))
        }
    };
}

function renderSavedToPrintDistribution(report, overrideRange = {}) {
    const defaultRange = getSavedToPrintDateRange(report);
    const from = overrideRange.from || billingWorkDistributionState?.from || defaultRange.from;
    const to = overrideRange.to || billingWorkDistributionState?.to || defaultRange.to;
    const sourceRows = report?.saved_to_print?.invoices || [];
    const summary = summarizeSavedToPrint(sourceRows, from, to);
    const queueStartDate = report?.saved_to_print?.queue_start_date || '';
    const queueStartCopy = queueStartDate
        ? ` Queue starts ${escapeHtml(queueStartDate)} because older saved rows do not have reliable print-audit status.`
        : '';
    billingWorkDistributionState = { report, sourceRows, from, to, summary, mode: 'saved_to_print' };

    if (els.billingScorecardTitle) els.billingScorecardTitle.textContent = 'Prepared Invoices';
    if (els.billingScorecardSubtitle) {
        els.billingScorecardSubtitle.textContent = `${formatMetricCount(summary.totals.invoice_count, 'saved invoice')} • ${formatCurrency(summary.totals.amount_total)} waiting`;
    }
    if (!els.billingScorecardContent) return;

    els.billingScorecardContent.innerHTML = `
        <div class="work-distribution-shell">
            <div class="work-distribution-toolbar">
                <div>
                    <div class="detail-section-title">Saved invoices ready to print</div>
                    <p class="sheet-copy">Filter by saved date, then open a preparer to review the exact invoices waiting for print.${queueStartCopy}</p>
                </div>
                <div class="work-distribution-filters">
                    <label>
                        <span>From</span>
                        <input type="date" data-saved-dist-from value="${escapeHtml(from)}">
                    </label>
                    <label>
                        <span>To</span>
                        <input type="date" data-saved-dist-to value="${escapeHtml(to)}">
                    </label>
                    <button class="btn btn-secondary" type="button" data-saved-dist-apply>Apply</button>
                </div>
            </div>
            <div class="work-summary-strip saved-summary-strip">
                <div class="work-metric-card">
                    <span>Total</span>
                    <strong>${escapeHtml(formatCount(summary.totals.invoice_count))}</strong>
                    <small>saved invoices</small>
                </div>
                <div class="work-metric-card">
                    <span>Amount</span>
                    <strong>${escapeHtml(formatCurrency(summary.totals.amount_total))}</strong>
                    <small>ready to print</small>
                </div>
                <div class="work-metric-card">
                    <span>Preparers</span>
                    <strong>${escapeHtml(formatCount(summary.byPreparer.length))}</strong>
                    <small>with waiting invoices</small>
                </div>
            </div>
            <section class="work-distribution-section">
                <div class="work-section-heading">
                    <strong>Prepared By</strong>
                    <span>Filtered saved invoices</span>
                </div>
                <div class="work-table-wrap">
                    <table class="work-distribution-table prepared-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th class="text-right">Total</th>
                                <th class="text-right">Amount</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${summary.byPreparer.length ? summary.byPreparer.map((row) => `
                                <tr>
                                    <td><strong>${escapeHtml(row.staff_name)}</strong></td>
                                    <td class="text-right">${escapeHtml(formatCount(row.invoice_count))}</td>
                                    <td class="text-right">${escapeHtml(formatCurrency(row.amount_total))}</td>
                                    <td>
                                        <button class="btn btn-secondary btn-sm" type="button" data-saved-dist-preparer="${escapeHtml(row.staff_id)}">View</button>
                                    </td>
                                </tr>
                            `).join('') : '<tr><td colspan="4" class="muted-cell">No saved invoices are waiting for print in this date range.</td></tr>'}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td>Total</td>
                                <td class="text-right">${escapeHtml(formatCount(summary.totals.invoice_count))}</td>
                                <td class="text-right">${escapeHtml(formatCurrency(summary.totals.amount_total))}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>
        </div>
    `;
}

function renderSavedToPrintPreparerDetail(staffId) {
    const state = billingWorkDistributionState || {};
    const rows = (state.sourceRows || [])
        .filter((row) => isDateInWorkRange(row.saved_at, state.from, state.to))
        .filter((row) => String(row.prepared_by_id || row.prepared_by || 'unknown-preparer').trim() === String(staffId || '').trim())
        .sort((a, b) => String(b.saved_at || '').localeCompare(String(a.saved_at || '')));
    const preparer = state.summary?.byPreparer?.find((row) => String(row.staff_id) === String(staffId))?.staff_name
        || rows[0]?.prepared_by
        || 'Unknown preparer';
    const total = rows.reduce((sum, row) => sum + Number(row.amount_total || 0), 0);

    if (els.billingScorecardTitle) els.billingScorecardTitle.textContent = 'Prepared Invoices';
    if (els.billingScorecardSubtitle) {
        els.billingScorecardSubtitle.textContent = `Prepared by ${preparer} • ${formatMetricCount(rows.length, 'invoice')} • ${formatCurrency(total)}`;
    }
    if (!els.billingScorecardContent) return;
    els.billingScorecardContent.innerHTML = `
        <div class="work-distribution-shell">
            <div class="work-detail-header">
                <button class="btn btn-secondary" type="button" data-saved-dist-back>Back</button>
                <div>
                    <div class="detail-section-title">Prepared by: ${escapeHtml(preparer)}</div>
                    <p class="sheet-copy">${escapeHtml(state.from || '')} to ${escapeHtml(state.to || '')}</p>
                </div>
            </div>
            <div class="work-table-wrap detail">
                <table class="work-distribution-table detail">
                    <thead>
                        <tr>
                            <th>Customer</th>
                            <th>Branch</th>
                            <th>Serial</th>
                            <th>Invoice No</th>
                            <th class="text-right">Amount</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length ? rows.map((row) => `
                            <tr>
                                <td><strong>${escapeHtml(row.company_name || 'Unknown')}</strong></td>
                                <td>${escapeHtml(row.branch_name || 'Main')}</td>
                                <td>${escapeHtml((row.serial_numbers || []).join(', ') || row.machine_label || '-')}</td>
                                <td><strong>${escapeHtml(row.invoice_no || '-')}</strong></td>
                                <td class="text-right">${escapeHtml(formatCurrency(row.amount_total || 0))}</td>
                                <td>
                                    <button
                                        class="btn btn-primary btn-sm"
                                        type="button"
                                        data-productivity-view-invoice="${escapeHtml(row.invoice_no || '')}"
                                        data-productivity-row-id="${escapeHtml(row.row_id || '')}"
                                        data-productivity-month-key="${escapeHtml(row.month_key || '')}"
                                    >View to Print</button>
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="6" class="muted-cell">No invoices for this preparer in the selected date range.</td></tr>'}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4">Total</td>
                            <td class="text-right">${escapeHtml(formatCurrency(total))}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

function renderMonthlyPrintedRows(rows = []) {
    if (!rows.length) {
        return '<div class="detail-empty">No actual print records found for this billing month yet.</div>';
    }
    return `
        <div class="billing-scorecard-detail-wrap">
            <table class="billing-scorecard-detail-table productivity-table">
                <thead>
                    <tr>
                        <th>Invoice #</th>
                        <th>Customer</th>
                        <th>Branch</th>
                        <th>Printed By</th>
                        <th>Received</th>
                        <th>Assigned / Age</th>
                        <th class="text-right">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => {
                        const received = row.receipt_status === 'received';
                        return `
                            <tr>
                                <td><strong>${escapeHtml(row.invoice_no || '-')}</strong></td>
                                <td><strong>${escapeHtml(row.company_name || 'Unknown')}</strong></td>
                                <td>${escapeHtml(row.branch_name || 'Main')}</td>
                                <td>
                                    ${escapeHtml(row.printed_by || 'Unknown printer')}
                                    ${row.printed_at ? `<small>${escapeHtml(formatReportDateTime(row.printed_at))}</small>` : ''}
                                </td>
                                <td>
                                    <strong>${received ? 'Received' : 'Pending received'}</strong>
                                    ${received ? `<small>${escapeHtml(row.received_by || '-')} ${escapeHtml(row.received_at ? formatReportDateTime(row.received_at) : '')}</small>` : ''}
                                </td>
                                <td>
                                    ${escapeHtml(row.assigned_staff_name || 'Unassigned')}
                                    <small>${escapeHtml(received ? 'Delivered' : `${formatInvoiceAge(row.printed_at)} since print`)}</small>
                                </td>
                                <td class="text-right">${escapeHtml(formatCurrency(row.amount_total || 0))}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function getBillingWorkDateRange(report = {}) {
    const today = formatIsoDate(new Date());
    const monthKey = String(report.current_month_key || getDateMonthKey(new Date()) || '').trim();
    return {
        from: monthKey ? `${monthKey}-01` : today,
        to: today
    };
}

function normalizeWorkDistributionDate(value) {
    return formatIsoDate(asValidDate(value));
}

function isDateInWorkRange(value, from, to) {
    const ymd = normalizeWorkDistributionDate(value);
    if (!ymd) return false;
    return (!from || ymd >= from) && (!to || ymd <= to);
}

function getWorkDistributionStaff(row, mode) {
    if (mode === 'printed') {
        return {
            id: String(row.printed_by_id || row.printed_by || 'unknown-printer').trim() || 'unknown-printer',
            name: String(row.printed_by || 'Unknown printer').trim() || 'Unknown printer'
        };
    }
    return {
        id: String(row.assigned_staff_id || row.assigned_staff_name || 'unassigned').trim() || 'unassigned',
        name: String(row.assigned_staff_name || 'Unassigned').trim() || 'Unassigned'
    };
}

function summarizeWorkDistribution(rows = [], from = '', to = '') {
    const today = formatIsoDate(new Date());
    const filteredRows = rows.filter((row) => isDateInWorkRange(row.printed_at, from, to));
    const printedBy = new Map();
    const assignedTo = new Map();

    rows.forEach((row) => {
        const printedYmd = normalizeWorkDistributionDate(row.printed_at);
        if (printedYmd !== today && !isDateInWorkRange(row.printed_at, from, to)) return;
        const staff = getWorkDistributionStaff(row, 'printed');
        if (!printedBy.has(staff.id)) {
            printedBy.set(staff.id, {
                staff_id: staff.id,
                staff_name: staff.name,
                printed_today: 0,
                printed_range: 0,
                amount_total: 0
            });
        }
        const group = printedBy.get(staff.id);
        if (printedYmd === today) group.printed_today += 1;
        if (isDateInWorkRange(row.printed_at, from, to)) {
            group.printed_range += 1;
            group.amount_total += Number(row.amount_total || 0) || 0;
        }
    });

    filteredRows.forEach((row) => {
        const staff = getWorkDistributionStaff(row, 'assigned');
        if (!assignedTo.has(staff.id)) {
            assignedTo.set(staff.id, {
                staff_id: staff.id,
                staff_name: staff.name,
                assigned_count: 0,
                received_count: 0,
                pending_count: 0,
                amount_total: 0
            });
        }
        const group = assignedTo.get(staff.id);
        group.assigned_count += 1;
        group.amount_total += Number(row.amount_total || 0) || 0;
        if (row.receipt_status === 'received') group.received_count += 1;
        else group.pending_count += 1;
    });

    const sortByWork = (items, countKey) => Array.from(items.values())
        .map((row) => ({ ...row, amount_total: roundDisplayAmount(row.amount_total) }))
        .sort((a, b) => Number(b[countKey] || 0) - Number(a[countKey] || 0) || Number(b.amount_total || 0) - Number(a.amount_total || 0) || a.staff_name.localeCompare(b.staff_name));

    return {
        rows: filteredRows,
        printedBy: sortByWork(printedBy, 'printed_range'),
        assignedTo: sortByWork(assignedTo, 'assigned_count'),
        totals: {
            printed: filteredRows.length,
            received: filteredRows.filter((row) => row.receipt_status === 'received').length,
            pending: filteredRows.filter((row) => row.receipt_status !== 'received').length,
            amount: roundDisplayAmount(filteredRows.reduce((sum, row) => sum + Number(row.amount_total || 0), 0))
        }
    };
}

function roundDisplayAmount(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function renderWorkMetricButton({ label, value, small = '', detail = {} }) {
    const attrs = Object.entries(detail)
        .map(([key, val]) => `data-${key}="${escapeHtml(val)}"`)
        .join(' ');
    return `
        <button class="work-metric-button" type="button" ${attrs}>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            ${small ? `<small>${escapeHtml(small)}</small>` : ''}
        </button>
    `;
}

function renderBillingWorkDistribution(report, overrideRange = {}) {
    const defaultRange = getBillingWorkDateRange(report);
    const from = overrideRange.from || billingWorkDistributionState?.from || defaultRange.from;
    const to = overrideRange.to || billingWorkDistributionState?.to || defaultRange.to;
    const sourceRows = report?.current_month_printed?.invoices || [];
    const summary = summarizeWorkDistribution(sourceRows, from, to);
    billingWorkDistributionState = { report, sourceRows, from, to, summary };

    if (els.billingScorecardTitle) els.billingScorecardTitle.textContent = 'Billing Work Distribution';
    if (els.billingScorecardSubtitle) {
        els.billingScorecardSubtitle.textContent = `${report.current_month_label || formatMonthLabel(report.current_month_key, report.current_month_key || '')} • ${formatMetricCount(summary.totals.printed, 'printed invoice')} • ${formatCurrency(summary.totals.amount)}`;
    }
    if (!els.billingScorecardContent) return;

    els.billingScorecardContent.innerHTML = `
        <div class="work-distribution-shell">
            <div class="work-distribution-toolbar">
                <div>
                    <div class="detail-section-title">Printed and delivery accountability</div>
                    <p class="sheet-copy">Use the date range to inspect who printed, who received, and which assigned billings are still pending.</p>
                </div>
                <div class="work-distribution-filters">
                    <label>
                        <span>From</span>
                        <input type="date" data-work-dist-from value="${escapeHtml(from)}">
                    </label>
                    <label>
                        <span>To</span>
                        <input type="date" data-work-dist-to value="${escapeHtml(to)}">
                    </label>
                    <button class="btn btn-secondary" type="button" data-work-dist-apply>Apply</button>
                </div>
            </div>

            <div class="work-summary-strip">
                ${renderWorkMetricButton({
                    label: 'Total Printed Billing',
                    value: formatCount(summary.totals.printed),
                    small: formatCurrency(summary.totals.amount),
                    detail: { 'work-dist-detail': 'all', 'work-dist-status': 'all' }
                })}
                ${renderWorkMetricButton({
                    label: 'Received',
                    value: formatCount(summary.totals.received),
                    small: 'Customer acknowledged',
                    detail: { 'work-dist-detail': 'assigned', 'work-dist-status': 'received' }
                })}
                ${renderWorkMetricButton({
                    label: 'Pending Received',
                    value: formatCount(summary.totals.pending),
                    small: 'Not yet acknowledged',
                    detail: { 'work-dist-detail': 'assigned', 'work-dist-status': 'pending' }
                })}
                ${renderWorkMetricButton({
                    label: 'Amount',
                    value: formatCurrency(summary.totals.amount),
                    small: 'Range total',
                    detail: { 'work-dist-detail': 'all', 'work-dist-status': 'all' }
                })}
            </div>

            <section class="work-distribution-section">
                <div class="work-section-heading">
                    <strong>Printed By</strong>
                    <span>Today and selected range</span>
                </div>
                <div class="work-table-wrap">
                    <table class="work-distribution-table">
                        <thead>
                            <tr>
                                <th>Staff</th>
                                <th class="text-right">Printed Today</th>
                                <th class="text-right">Printed In Range</th>
                                <th class="text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${summary.printedBy.length ? summary.printedBy.map((row) => `
                                <tr>
                                    <td><strong>${escapeHtml(row.staff_name)}</strong></td>
                                    <td class="text-right">${renderWorkMetricButton({
                                        label: 'Today',
                                        value: formatCount(row.printed_today),
                                        detail: { 'work-dist-detail': 'printed', 'work-dist-staff-id': row.staff_id, 'work-dist-status': 'today' }
                                    })}</td>
                                    <td class="text-right">${renderWorkMetricButton({
                                        label: 'Range',
                                        value: formatCount(row.printed_range),
                                        detail: { 'work-dist-detail': 'printed', 'work-dist-staff-id': row.staff_id, 'work-dist-status': 'range' }
                                    })}</td>
                                    <td class="text-right">${renderWorkMetricButton({
                                        label: 'Amount',
                                        value: formatCurrency(row.amount_total),
                                        detail: { 'work-dist-detail': 'printed', 'work-dist-staff-id': row.staff_id, 'work-dist-status': 'range' }
                                    })}</td>
                                </tr>
                            `).join('') : '<tr><td colspan="4" class="muted-cell">No printed invoice records in this range.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </section>

            <section class="work-distribution-section">
                <div class="work-section-heading">
                    <strong>Assigned To</strong>
                    <span>Field staff delivery status</span>
                </div>
                <div class="work-table-wrap">
                    <table class="work-distribution-table">
                        <thead>
                            <tr>
                                <th>Field Staff</th>
                                <th class="text-right">Assigned</th>
                                <th class="text-right">Received</th>
                                <th class="text-right">Pending</th>
                                <th class="text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${summary.assignedTo.length ? summary.assignedTo.map((row) => `
                                <tr>
                                    <td><strong>${escapeHtml(row.staff_name)}</strong></td>
                                    <td class="text-right">${renderWorkMetricButton({
                                        label: 'Assigned',
                                        value: formatCount(row.assigned_count),
                                        detail: { 'work-dist-detail': 'assigned', 'work-dist-staff-id': row.staff_id, 'work-dist-status': 'all' }
                                    })}</td>
                                    <td class="text-right">${renderWorkMetricButton({
                                        label: 'Received',
                                        value: formatCount(row.received_count),
                                        detail: { 'work-dist-detail': 'assigned', 'work-dist-staff-id': row.staff_id, 'work-dist-status': 'received' }
                                    })}</td>
                                    <td class="text-right">${renderWorkMetricButton({
                                        label: 'Pending',
                                        value: formatCount(row.pending_count),
                                        detail: { 'work-dist-detail': 'assigned', 'work-dist-staff-id': row.staff_id, 'work-dist-status': 'pending' }
                                    })}</td>
                                    <td class="text-right">${renderWorkMetricButton({
                                        label: 'Amount',
                                        value: formatCurrency(row.amount_total),
                                        detail: { 'work-dist-detail': 'assigned', 'work-dist-staff-id': row.staff_id, 'work-dist-status': 'all' }
                                    })}</td>
                                </tr>
                            `).join('') : '<tr><td colspan="5" class="muted-cell">No field staff assignment records in this range.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    `;
}

function filterBillingWorkDetailRows(detailType, staffId, status) {
    const state = billingWorkDistributionState || {};
    const rows = (state.sourceRows || []).filter((row) => isDateInWorkRange(row.printed_at, state.from, state.to));
    const today = formatIsoDate(new Date());
    return rows.filter((row) => {
        if (detailType === 'printed') {
            const staff = getWorkDistributionStaff(row, 'printed');
            if (staffId && staff.id !== staffId) return false;
            if (status === 'today') return normalizeWorkDistributionDate(row.printed_at) === today;
            return true;
        }
        if (detailType === 'assigned') {
            const staff = getWorkDistributionStaff(row, 'assigned');
            if (staffId && staff.id !== staffId) return false;
            if (status === 'received') return row.receipt_status === 'received';
            if (status === 'pending') return row.receipt_status !== 'received';
            return true;
        }
        return true;
    });
}

function renderBillingWorkDetail(detailType, staffId, status) {
    const state = billingWorkDistributionState || {};
    const rows = filterBillingWorkDetailRows(detailType, staffId, status);
    const staffRow = [...(state.summary?.printedBy || []), ...(state.summary?.assignedTo || [])]
        .find((row) => row.staff_id === staffId);
    const label = [
        detailType === 'printed' ? 'Printed invoices' : (detailType === 'assigned' ? 'Assigned billings' : 'Printed billings'),
        staffRow?.staff_name,
        status === 'pending' ? 'Pending received' : (status === 'received' ? 'Received' : (status === 'today' ? 'Today' : ''))
    ].filter(Boolean).join(' • ');
    const total = rows.reduce((sum, row) => sum + Number(row.amount_total || 0), 0);

    if (els.billingScorecardTitle) els.billingScorecardTitle.textContent = 'Billing Work Distribution';
    if (els.billingScorecardSubtitle) {
        els.billingScorecardSubtitle.textContent = `${label || 'Invoice details'} • ${formatMetricCount(rows.length, 'invoice')} • ${formatCurrency(total)}`;
    }
    if (!els.billingScorecardContent) return;
    els.billingScorecardContent.innerHTML = `
        <div class="work-distribution-shell">
            <div class="work-detail-header">
                <button class="btn btn-secondary" type="button" data-work-dist-back>Back</button>
                <div>
                    <div class="detail-section-title">${escapeHtml(label || 'Invoice details')}</div>
                    <p class="sheet-copy">${escapeHtml(state.from || '')} to ${escapeHtml(state.to || '')}</p>
                </div>
            </div>
            <div class="work-table-wrap detail">
                <table class="work-distribution-table detail">
                    <thead>
                        <tr>
                            <th>Customer</th>
                            <th>Branch</th>
                            <th>Invoice No</th>
                            <th>Printed By</th>
                            <th>Assigned To</th>
                            <th>Received</th>
                            <th class="text-right">Age</th>
                            <th class="text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length ? rows.map((row) => {
                            const received = row.receipt_status === 'received';
                            return `
                                <tr>
                                    <td><strong>${escapeHtml(row.company_name || 'Unknown')}</strong></td>
                                    <td>${escapeHtml(row.branch_name || 'Main')}</td>
                                    <td><strong>${escapeHtml(row.invoice_no || '-')}</strong></td>
                                    <td>
                                        ${escapeHtml(row.printed_by || 'Unknown printer')}
                                        ${row.printed_at ? `<small>${escapeHtml(formatReportDateTime(row.printed_at))}</small>` : ''}
                                    </td>
                                    <td>${escapeHtml(row.assigned_staff_name || 'Unassigned')}</td>
                                    <td>
                                        <strong>${received ? 'Received' : 'Pending'}</strong>
                                        ${received ? `<small>${escapeHtml([row.received_by, row.received_at ? formatReportDateTime(row.received_at) : ''].filter(Boolean).join(' • '))}</small>` : ''}
                                    </td>
                                    <td class="text-right">${escapeHtml(received ? 'Closed' : formatInvoiceAge(row.printed_at))}</td>
                                    <td class="text-right">${escapeHtml(formatCurrency(row.amount_total || 0))}</td>
                                </tr>
                            `;
                        }).join('') : '<tr><td colspan="8" class="muted-cell">No matching invoice rows.</td></tr>'}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="7">Total</td>
                            <td class="text-right">${escapeHtml(formatCurrency(total))}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

function openPrintedTodayReport() {
    const report = lastPayload?.productivity_report || null;
    if (!report) {
        MargaUtils.showToast('Load the dashboard first to see printed invoice totals.', 'info');
        return;
    }
    const todayLabel = formatReportDate(report.today_date);
    const sinceLabel = formatReportDate(report.since_date);
    if (els.billingScorecardTitle) els.billingScorecardTitle.textContent = 'Printed Invoice Productivity';
    if (els.billingScorecardSubtitle) {
        els.billingScorecardSubtitle.textContent = `${todayLabel} • ${formatMetricCount(report.today?.invoice_count || 0, 'invoice')} • ${formatCurrency(report.today?.amount_total || 0)}`;
    }
    if (els.billingScorecardContent) {
        els.billingScorecardContent.innerHTML = `
            <div class="productivity-summary-grid">
                <div class="detail-summary-card">
                    <span class="label">Printed Today</span>
                    <span class="value">${escapeHtml(formatCount(report.today?.invoice_count || 0))}</span>
                    <small>${escapeHtml(formatCurrency(report.today?.amount_total || 0))}</small>
                </div>
                <div class="detail-summary-card">
                    <span class="label">Since ${escapeHtml(sinceLabel)}</span>
                    <span class="value">${escapeHtml(formatCount(report.since_start?.invoice_count || 0))}</span>
                    <small>${escapeHtml(formatCurrency(report.since_start?.amount_total || 0))}</small>
                </div>
                <div class="detail-summary-card">
                    <span class="label">Billing Staff Today</span>
                    <span class="value">${escapeHtml(formatCount((report.today?.by_staff || []).length))}</span>
                    <small>Encoders with printed invoices</small>
                </div>
            </div>
            <div class="detail-section-title">Who printed today</div>
            ${renderProductivityStaffRows(report.today?.by_staff || [])}
            <div class="detail-section-title">Billing amount progress by month</div>
            ${renderProductivityMonthProgress(report.month_progress || [], report.since_date)}
            <div class="detail-section-title">Today invoice details</div>
            ${renderProductivityInvoiceRows(report.invoices_today || [])}
        `;
    }
    els.billingScorecardModal?.classList.remove('hidden');
}

function openSavedToPrintReport() {
    const report = lastPayload?.productivity_report || null;
    if (!report) {
        MargaUtils.showToast('Load the dashboard first to see saved invoices waiting for print.', 'info');
        return;
    }
    billingWorkDistributionState = null;
    renderSavedToPrintDistribution(report);
    els.billingScorecardModal?.classList.remove('hidden');
}

function openPrintedMonthReport() {
    const report = lastPayload?.productivity_report || null;
    if (!report) {
        MargaUtils.showToast('Load the dashboard first to see monthly printed invoice totals.', 'info');
        return;
    }
    billingWorkDistributionState = null;
    renderBillingWorkDistribution(report);
    els.billingScorecardModal?.classList.remove('hidden');
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
    const hasVerifiedBillingGroup = Boolean(row.billing_group);
    const isVerifiedSummaryGroup = Boolean(row.is_summary_row && row.billing_group);
    const summaryGroupedRows = hasVerifiedBillingGroup ? getGroupedMachineRows(row, monthKey) : [];
    const workingRow = isVerifiedSummaryGroup ? buildSummaryBillingRow(row, summaryGroupedRows) : row;
    const baseProfile = getRowBillingProfile(workingRow) || getRowBillingProfile(summaryGroupedRows[0]);
    const groupProfile = hasVerifiedBillingGroup ? getSharedBillingGroupProfile(row, baseProfile) : null;
    const profile = isVerifiedSummaryGroup && groupProfile ? groupProfile : baseProfile;
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
    const groupedMachineRows = summaryGroupedRows.length ? summaryGroupedRows : getGroupedMachineRows(workingRow, monthKey);
    const forceGroupedMode = isVerifiedSummaryGroup && groupedMachineRows.length > 1;

    return {
        row: workingRow,
        sourceSummaryRow: isVerifiedSummaryGroup ? row : null,
        monthKey,
        targetCell,
        targetReadingGroup,
        monthLabel: targetCell.month_label_short || formatMonthLabel(monthKey, monthKey),
        profile,
        contractProfile: baseProfile,
        groupProfile,
        latestPriorGroup,
        latestInvoice,
        previousMeter: targetPreviousMeter,
        presentMeter: targetPresentMeter,
        spoilageRate: DEFAULT_SPOILAGE_RATE,
        isReading: isReadingPricing(profile),
        isFixed: !isReadingPricing(profile) && Number(profile.monthly_rate || 0) > 0,
        hasSecondaryRtp: !forceGroupedMode && (hasSecondaryRtpRate(profile) || Boolean(targetReadingGroup?.present_meter2 || targetReadingGroup?.meter_reading2)),
        groupedMachineRows,
        forceGroupedMode
    };
}

function calculateBillingEstimate(context, previousMeterValue, presentMeterValue, spoilageRateValue = context?.spoilageRate, extras = {}) {
    return calculateMeterLineEstimate({
        label: context?.isFixed ? 'Fixed Rate' : 'Single Meter',
        profile: context?.profile || {},
        previousMeter: previousMeterValue,
        presentMeter: presentMeterValue,
        spoilagePercent: Math.max(0, Number(spoilageRateValue || 0) || 0) * 100,
        actualSpoilagePages: extras.actualSpoilagePages ?? context?.actualSpoilagePages ?? 0,
        actualSpoilageReason: extras.actualSpoilageReason ?? context?.actualSpoilageReason ?? '',
        actualSpoilageProofImage: extras.actualSpoilageProofImage ?? context?.actualSpoilageProofImage ?? '',
        actualSpoilageProofName: extras.actualSpoilageProofName ?? context?.actualSpoilageProofName ?? '',
        actualSpoilageProofType: extras.actualSpoilageProofType ?? context?.actualSpoilageProofType ?? '',
        actualSpoilageRequestedBy: extras.actualSpoilageRequestedBy ?? context?.actualSpoilageRequestedBy ?? '',
        actualSpoilageRequestedAt: extras.actualSpoilageRequestedAt ?? context?.actualSpoilageRequestedAt ?? '',
        applyQuota: extras.applyQuota ?? context?.applyQuota ?? true,
        quotaBypassReason: extras.quotaBypassReason ?? context?.quotaBypassReason ?? '',
        approvalStatus: extras.approvalStatus ?? context?.approvalStatus ?? '',
        approvalNote: extras.approvalNote ?? context?.approvalNote ?? '',
        approvedBy: extras.approvedBy ?? context?.approvedBy ?? '',
        approvedAt: extras.approvedAt ?? context?.approvedAt ?? '',
        forceFixed: Boolean(context?.isFixed),
        row: context?.row || null
    });
}

function getBillingModeOptions(context) {
    const options = [];
    const savedMode = String(context?.savedBillingMode || '').trim();
    const groupedRows = context?.groupedMachineRows || [];
    const canUseGroupedInvoiceMode = context?.forceGroupedMode || savedMode === 'multi_machine_rtp' || Boolean(context?.row?.billing_group);
    if (context?.isReading) options.push({ key: 'single_meter_rtp', label: 'Single Meter RTP' });
    if (context?.isReading && context?.hasSecondaryRtp) options.push({ key: 'multi_meter_rtp', label: 'Multiple Meter RTP' });
    if (context?.isFixed) options.push({ key: 'rtf', label: 'RTF Fixed Rate' });
    if (context?.isReading && canUseGroupedInvoiceMode && groupedRows.length > 1) {
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
        <section class="calc-panel calc-mode-summary" id="calcModeSummaryPanel">
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
    if (els.billingExclusionsToggleBtn) {
        els.billingExclusionsToggleBtn.textContent = els.billingExclusionsList.hidden
            ? `View Saved Billing Exclusions (${formatCount(activeExclusions.length)})`
            : 'Hide Saved Billing Exclusions';
    }
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
    const quotaLabel = line.sharedQuotaGroup ? 'Shared Quota' : 'Quota';
    const quotaHelp = line.sharedQuotaGroup
        ? '<small>One quota is shared by all machines in this invoice group.</small>'
        : '';
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
                    ${line.previousMeterReference ? `<small>${escapeHtml(line.previousMeterReference)}</small>` : ''}
                </div>
                <div class="calc-field">
                    <label>Spoilage %</label>
                    <input type="number" min="0" step="0.01" value="${escapeHtml(String(line.spoilagePercent ?? (DEFAULT_SPOILAGE_RATE * 100)))}" data-calc-line-mode="${escapeHtml(mode)}" data-calc-line-index="${escapeHtml(String(index))}" data-calc-line-field="spoilagePercent">
                </div>
                <div class="calc-field">
                    <label>${escapeHtml(quotaLabel)}</label>
                    <input type="number" min="0" step="1" value="${escapeHtml(String(line.monthlyQuota || 0))}" data-calc-line-mode="${escapeHtml(mode)}" data-calc-line-index="${escapeHtml(String(index))}" data-calc-line-field="monthlyQuota">
                    ${quotaHelp}
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

function renderBillingLinePanel(mode, title, copy, lines, warningNote = '') {
    let previousSection = '';
    return `
        <section class="calc-panel calc-line-panel hidden" data-calc-mode-panel="${escapeHtml(mode)}">
            <div class="calc-panel-title">${escapeHtml(title)}</div>
            <div class="calc-note calc-note-tight">${escapeHtml(copy)}</div>
            ${mode === 'multi_meter_rtp' && warningNote ? `<div class="calc-note calc-note-warning">${escapeHtml(warningNote)}</div>` : ''}
            <div class="calc-meter-lines">
                ${lines.map((line, index) => {
                    const section = String(line?.meterSection || '').trim();
                    const sectionHeader = mode === 'multi_meter_rtp' && section && section !== previousSection
                        ? `<div class="calc-meter-section-title">${escapeHtml(section)}</div>`
                        : '';
                    previousSection = section;
                    return `${sectionHeader}${renderMeterLineCard(line, mode, index)}`;
                }).join('')}
            </div>
        </section>
    `;
}

function formatLineComputation(line) {
    if (!line) return '';
    if (line.formula === 'saved_legacy_invoice_total') {
        return line.savedComputation || `Saved invoice total ${formatAmount(line.amountDue || 0)}.`;
    }
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
    if (String(line.formula || '').startsWith('shared_quota_')) {
        return line.sharedLineComputation || line.sharedGroupComputation || formatBillingComputationFlow(line);
    }
    return formatBillingComputationFlow(line);
}

function formatBillingComputationFlow(estimate = {}) {
    const systemSpoilage = Number(estimate.systemSpoilagePages ?? estimate.spoilagePages ?? 0) || 0;
    const actualSpoilage = Number(estimate.actualSpoilagePages || 0) || 0;
    const totalSpoilage = Number(estimate.totalSpoilagePages ?? estimate.spoilagePages ?? 0) || 0;
    const quotaBypassed = estimate.quotaBypassed === true;
    if (actualSpoilage > 0) {
        return [
            `Gross ${formatCount(estimate.rawPages || 0)}`,
            `System spoilage ${formatCount(systemSpoilage)}`,
            `Actual spoilage ${formatCount(actualSpoilage)}`,
            `Net billable ${formatCount(estimate.netPages || 0)}`,
            quotaBypassed ? `Quota bypassed: ${String(estimate.quotaBypassReason || 'reason required').trim()}` : '',
            `${formatCount(estimate.quotaPages || 0)} quota x ${formatAmount(estimate.pageRate || 0)} = ${formatAmount(estimate.quotaAmount || 0)}`,
            `${formatCount(estimate.succeedingPages || 0)} succeeding pages x ${formatAmount(estimate.succeedingRate || 0)} = ${formatAmount(estimate.succeedingAmount || 0)}`,
            `Total = ${formatAmount(estimate.amountDue || 0)}`,
            String(estimate.approvalStatus || '') === 'approved' ? 'Approved for invoice printing.' : 'Pending admin approval.'
        ].filter(Boolean).join('\n');
    }
    if (quotaBypassed) {
        return `${formatCount(estimate.rawPages || 0)} raw - ${formatCount(totalSpoilage)} spoilage = ${formatCount(estimate.netPages || 0)} net. Quota bypassed: ${String(estimate.quotaBypassReason || 'reason required').trim()}. ${formatCount(estimate.quotaPages || 0)} actual pages x ${formatAmount(estimate.pageRate || 0)} = ${formatAmount(estimate.amountDue || 0)}.`;
    }
    return `${formatCount(estimate.rawPages || 0)} raw - ${formatCount(totalSpoilage)} spoilage = ${formatCount(estimate.netPages || 0)} net. ${formatCount(estimate.quotaPages || 0)} quota pages x ${formatAmount(estimate.pageRate || 0)} plus ${formatCount(estimate.succeedingPages || 0)} succeeding pages x ${formatAmount(estimate.succeedingRate || 0)} = ${formatAmount(estimate.amountDue || 0)}.`;
}

function closeBillingCalcModal() {
    billingCalcRequestToken += 1;
    setRtpPrintPayload(null);
    currentRtpMeterFormEstimate = null;
    els.billingCalcModal?.classList.add('hidden');
}

function showBillingCalcOpenError(error) {
    console.error('Unable to open billing calculation modal.', error);
    if (els.billingCalcTitle) els.billingCalcTitle.textContent = 'Billing Calculation';
    if (els.billingCalcSubtitle) els.billingCalcSubtitle.textContent = 'Unable to open billing details';
    if (els.billingCalcContent) {
        els.billingCalcContent.innerHTML = `
            <div class="detail-empty error">
                ${escapeHtml(String(error?.message || error || 'The billing calculation could not be opened.'))}
            </div>
        `;
    }
    els.billingCalcModal?.classList.remove('hidden');
    MargaUtils.showToast(String(error?.message || 'Unable to open billing calculation.'), 'error');
}

function openBillingCalcModalSafely(rowId, monthKey) {
    openBillingCalcModal(rowId, monthKey).catch(showBillingCalcOpenError);
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

    if (els.billingCalcTitle) {
        els.billingCalcTitle.textContent = `${row?.display_name || row?.account_name || row?.company_name || 'Billing Calculation'}`;
    }
    if (els.billingCalcSubtitle) {
        els.billingCalcSubtitle.textContent = `${context.monthLabel} • ${profile.category_code || 'N/A'} • Loading billing details`;
    }
    if (els.billingCalcContent) {
        els.billingCalcContent.innerHTML = '<div class="detail-empty">Loading billing calculation...</div>';
    }
    els.billingCalcModal?.classList.remove('hidden');

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
    let savedBillingDocId = savedBillingDoc?._docId || '';
    context.actualSpoilagePages = Number(savedBillingDoc?.actual_spoilage_pages || 0) || 0;
    context.actualSpoilageReason = String(savedBillingDoc?.actual_spoilage_reason || '').trim();
    context.actualSpoilageProofImage = String(savedBillingDoc?.actual_spoilage_proof_image || '').trim();
    context.actualSpoilageProofName = String(savedBillingDoc?.actual_spoilage_proof_name || '').trim();
    context.actualSpoilageProofType = String(savedBillingDoc?.actual_spoilage_proof_type || '').trim();
    context.actualSpoilageRequestedBy = String(savedBillingDoc?.actual_spoilage_requested_by || '').trim();
    context.actualSpoilageRequestedAt = String(savedBillingDoc?.actual_spoilage_requested_at || '').trim();
    context.applyQuota = savedBillingDoc?.apply_quota === undefined ? true : savedBillingDoc.apply_quota !== false;
    context.quotaBypassReason = String(savedBillingDoc?.quota_bypass_reason || '').trim();
    context.approvalStatus = String(savedBillingDoc?.approval_status || (context.actualSpoilagePages > 0 ? 'pending' : 'none')).trim();
    context.approvalNote = String(savedBillingDoc?.approval_note || '').trim();
    context.approvedBy = String(savedBillingDoc?.approved_by || '').trim();
    context.approvedAt = String(savedBillingDoc?.approved_at || '').trim();
    context.scheduleRequired = savedBillingDoc ? savedBillingDoc.schedule_required === true : false;
    context.scheduleSaved = savedBillingDoc?.schedule_saved === true;
    context.scheduleDocId = String(savedBillingDoc?.schedule_doc_id || '').trim();
    context.scheduleDate = String(savedBillingDoc?.schedule_date || '').trim();
    context.scheduleTime = String(savedBillingDoc?.schedule_time || '').trim();
    context.scheduleType = String(savedBillingDoc?.schedule_type || savedBillingDoc?.schedule_purpose || 'Printed Billing').trim() || 'Printed Billing';
    context.schedulePurpose = String(savedBillingDoc?.schedule_purpose || context.scheduleType || 'Printed Billing').trim() || 'Printed Billing';
    context.schedulePurposeKey = getBillingSchedulePurpose(context.schedulePurpose).key;
    context.scheduleAssignedStaffId = String(savedBillingDoc?.schedule_assigned_staff_id || '').trim();
    context.scheduleAssignedStaffName = String(savedBillingDoc?.schedule_assigned_staff_name || '').trim();
    let priorMachineReadingByRow = new Map();
    let billingDraftsByLine = new Map();
    let rowPriorLookup = null;
    let linkedInvoiceReading = null;
    if (context.isReading) {
        const prefillRows = (context.groupedMachineRows || []).length ? context.groupedMachineRows : [row];
        try {
            const [machineReadingLookups, billingReadingLookups, draftLines] = await Promise.all([
                loadPriorMachineReadingLookups(prefillRows, monthKey),
                loadPriorBillingReadingLookups(prefillRows, monthKey),
                loadBillingDraftLines(row, monthKey, 'multi_machine_rtp')
            ]);
            priorMachineReadingByRow = mergePriorReadingLookups(machineReadingLookups, billingReadingLookups);
            billingDraftsByLine = draftLines;
        } catch (error) {
            console.warn('Unable to load prior machine readings for the calculator modal.', error);
        }
        if (requestToken !== billingCalcRequestToken) return;

        rowPriorLookup = priorMachineReadingByRow.get(getBillingRowLookupKey(row)) || null;
        if (rowPriorLookup && !context.targetReadingGroup) {
            context.latestPriorGroup = context.latestPriorGroup || buildPriorGroupFromLookup(rowPriorLookup, row);
        }
        if (!savedBillingDoc && rowPriorLookup && !context.targetReadingGroup && Number(context.previousMeter || 0) <= 0) {
            context.previousMeter = Number(rowPriorLookup.previousMeter || 0) || 0;
            context.presentMeter = context.previousMeter;
            if (Number(rowPriorLookup.previousMeter2 || 0) > 0) {
                context.hasSecondaryRtp = true;
            }
        }
        if (savedBillingDoc) {
            linkedInvoiceReading = await loadInvoiceMachineReadingPair(row, getBillingDocInvoiceRef(savedBillingDoc));
            if (requestToken !== billingCalcRequestToken) return;
            if (linkedInvoiceReading?.previousMeter > 0 || linkedInvoiceReading?.presentMeter > 0) {
                context.latestPriorGroup = {
                    schedule_id: `machine-reading:${linkedInvoiceReading.readingId || getBillingRowLookupKey(row)}`,
                    invoice_num: linkedInvoiceReading.invoiceRef || null,
                    task_date: linkedInvoiceReading.taskDate || '',
                    machine_id: String(row?.machine_id || '').trim(),
                    contractmain_id: String(row?.contractmain_id || '').trim(),
                    previous_meter: Number(linkedInvoiceReading.previousMeter || 0) || 0,
                    present_meter: Number(linkedInvoiceReading.presentMeter || 0) || 0,
                    previous_meter2: Number(linkedInvoiceReading.previousMeter2 || 0) || 0,
                    present_meter2: Number(linkedInvoiceReading.presentMeter2 || 0) || 0,
                    meter_reading2: Number(linkedInvoiceReading.presentMeter2 || 0) || 0,
                    month_key: linkedInvoiceReading.sourceMonthKey || '',
                    month_label: linkedInvoiceReading.sourceMonthLabel || 'Linked invoice reading',
                    pages: Math.max(0, Number(linkedInvoiceReading.presentMeter || 0) - Number(linkedInvoiceReading.previousMeter || 0)),
                    total_consumed: Math.max(0, Number(linkedInvoiceReading.presentMeter || 0) - Number(linkedInvoiceReading.previousMeter || 0))
                };
                context.previousMeter = Number(linkedInvoiceReading.previousMeter || 0) || context.previousMeter;
                context.presentMeter = Number(linkedInvoiceReading.presentMeter || 0) || context.presentMeter;
            }
        }
    }
    const latest = context.latestPriorGroup;
    const initialSnapshot = savedBillingDoc
        ? billingSnapshotFromDoc(savedBillingDoc, {
            invoiceNo: '',
            previousMeter: context.previousMeter,
            presentMeter: context.presentMeter,
            spoilagePercent: (context.spoilageRate || 0) * 100,
            actualSpoilagePages: context.actualSpoilagePages || 0,
            applyQuota: context.applyQuota,
            quotaBypassReason: context.quotaBypassReason
        })
        : billingSnapshotFromValues({
            invoiceNo: '',
            previousMeter: context.previousMeter,
            presentMeter: context.presentMeter,
            spoilagePercent: (context.spoilageRate || 0) * 100,
            actualSpoilagePages: context.actualSpoilagePages || 0,
            applyQuota: context.applyQuota,
            quotaBypassReason: context.quotaBypassReason
        });
    let estimate = calculateBillingEstimate(
        context,
        initialSnapshot.previousMeter,
        initialSnapshot.presentMeter,
        initialSnapshot.spoilagePercent / 100
    );

    context.savedBillingMode = savedBillingDoc?.billing_mode || '';
    const billingModeOptions = getBillingModeOptions(context);
    let activeBillingMode = getDefaultBillingMode(context);
    const secondaryProfile = getRtpSecondaryProfile(profile);
    const savedLineItems = savedBillingDoc ? parseBillingDocLineItems(savedBillingDoc) : [];
    const hasSavedSplitMultiMeter = hasSplitMultiMeterLines(savedLineItems);
    const priorSplitLineItems = !savedBillingDoc && hasSplitMultiMeterLines(rowPriorLookup?.lineItems || [])
        ? (rowPriorLookup.lineItems || []).map(useLinePresentAsNextPrevious)
        : [];
    const activeMultiMeterLineItems = hasSavedSplitMultiMeter ? savedLineItems : (priorSplitLineItems.length ? priorSplitLineItems : savedLineItems);
    const hasPriorSplitMultiMeter = priorSplitLineItems.length > 0;
    const canUseLegacyMultiMeterSeeds = !hasSavedSplitMultiMeter
        && String(savedBillingDoc?.billing_mode || '').trim() === 'multi_meter_rtp'
        && savedLineItems.length > 0;
    const savedLegacyEstimate = savedBillingDoc && !savedLineItems.length
        ? buildSavedLegacyBillingEstimate({ doc: savedBillingDoc, context, profile, row, seedEstimate: estimate })
        : null;
    if (savedLegacyEstimate) {
        savedLegacyEstimate.billingMode = activeBillingMode;
        estimate = savedLegacyEstimate;
    }
    else estimate.lineItems = [estimate];
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
    const savedPrintBwLine = findSavedMeterLine(activeMultiMeterLineItems, {
        section: 'Print',
        type: 'black_white',
        legacyLabel: 'black',
        fallbackIndex: canUseLegacyMultiMeterSeeds ? 0 : -1
    });
    const savedPrintColorLine = findSavedMeterLine(activeMultiMeterLineItems, {
        section: 'Print',
        type: 'color',
        legacyLabel: 'color',
        fallbackIndex: canUseLegacyMultiMeterSeeds ? 1 : -1
    });
    const savedCopyBwLine = findSavedMeterLine(activeMultiMeterLineItems, {
        section: 'Copy',
        type: 'black_white'
    });
    const savedCopyColorLine = findSavedMeterLine(activeMultiMeterLineItems, {
        section: 'Copy',
        type: 'color'
    });
    const legacyMultiMeterNote = !hasSavedSplitMultiMeter && !hasPriorSplitMultiMeter && (initialSnapshot.previousMeter > 0 || secondaryPreviousMeter > 0)
        ? `Legacy two-meter history is available but not split by Print/Copy: B/W ${formatCount(initialSnapshot.previousMeter || 0)}, Color ${formatCount(secondaryPreviousMeter || 0)}. Enter the actual prior Print and Copy counters from the copier meter report.`
        : '';
    const legacyBwReference = legacyMultiMeterNote && initialSnapshot.previousMeter > 0
        ? `Legacy B/W previous reference: ${formatCount(initialSnapshot.previousMeter)}. Enter the actual split previous counter for this Print/Copy line.`
        : '';
    const legacyColorReference = legacyMultiMeterNote && secondaryPreviousMeter > 0
        ? `Legacy Color previous reference: ${formatCount(secondaryPreviousMeter)}. Enter the actual split previous counter for this Print/Copy line.`
        : '';
    const multiMeterSeedLines = [
        buildMultiMeterSeedLine({
            label: 'Print - Black / White',
            section: 'Print',
            type: 'black_white',
            profile,
            previousMeter: 0,
            presentMeter: 0,
            spoilagePercent: initialSnapshot.spoilagePercent,
            row,
            savedLine: savedPrintBwLine,
            previousMeterReference: savedPrintBwLine ? '' : legacyBwReference
        }),
        buildMultiMeterSeedLine({
            label: 'Print - Colored',
            section: 'Print',
            type: 'color',
            profile: secondaryProfile,
            previousMeter: 0,
            presentMeter: 0,
            spoilagePercent: initialSnapshot.spoilagePercent,
            row,
            savedLine: savedPrintColorLine,
            previousMeterReference: savedPrintColorLine ? '' : legacyColorReference
        }),
        buildMultiMeterSeedLine({
            label: 'Copy - Black / White',
            section: 'Copy',
            type: 'black_white',
            profile,
            previousMeter: 0,
            presentMeter: 0,
            spoilagePercent: initialSnapshot.spoilagePercent,
            row,
            savedLine: savedCopyBwLine,
            previousMeterReference: savedCopyBwLine ? '' : legacyBwReference
        }),
        buildMultiMeterSeedLine({
            label: 'Copy - Colored',
            section: 'Copy',
            type: 'color',
            profile: secondaryProfile,
            previousMeter: 0,
            presentMeter: 0,
            spoilagePercent: initialSnapshot.spoilagePercent,
            row,
            savedLine: savedCopyColorLine,
            previousMeterReference: savedCopyColorLine ? '' : legacyColorReference
        })
    ];
    const groupedRowsForBilling = context.groupedMachineRows || [];
    const multiMachineSeedLines = groupedRowsForBilling.map((machineRow) => {
        const draft = billingDraftsByLine.get(getBillingDraftLineKey(machineRow)) || null;
        const baseProfile = getSharedBillingGroupProfile(machineRow, getRowBillingProfile(machineRow) || profile);
        const hasVerifiedGroupRatePlan = Boolean(machineRow?.billing_group);
        const machineProfile = draft
            ? {
                ...baseProfile,
                monthly_quota: hasVerifiedGroupRatePlan
                    ? Number(baseProfile.monthly_quota || 0) || 0
                    : Number(draft.monthly_quota ?? baseProfile.monthly_quota ?? 0) || 0,
                page_rate: hasVerifiedGroupRatePlan
                    ? Number(baseProfile.page_rate || 0) || 0
                    : Number(draft.page_rate ?? baseProfile.page_rate ?? 0) || 0,
                succeeding_page_rate: hasVerifiedGroupRatePlan
                    ? Number(baseProfile.succeeding_page_rate ?? baseProfile.page_rate_xtra ?? baseProfile.page_rate ?? 0) || 0
                    : Number(draft.succeeding_rate ?? baseProfile.succeeding_page_rate ?? baseProfile.page_rate_xtra ?? baseProfile.page_rate ?? 0) || 0
            }
            : baseProfile;
        const group = getPrimaryTargetReadingGroup(machineRow, monthKey);
        const prior = collectPriorReadingGroups(machineRow, monthKey)[0] || null;
        const lookup = priorMachineReadingByRow.get(getBillingRowLookupKey(machineRow));
        const previousMeter = Number(draft?.previous_meter ?? group?.previous_meter ?? prior?.present_meter ?? prior?.previous_meter ?? lookup?.previousMeter ?? 0) || 0;
        const presentMeter = Number(draft?.present_meter ?? group?.present_meter ?? group?.meter_reading ?? previousMeter ?? 0) || 0;
        const previousReadingDate = firstIsoDate(group?.previous_reading_date, prior?.task_date, lookup?.taskDate);
        const meterSourceLabel = lookup?.sourceMonthLabel || prior?.month_label || group?.month_label || '';
        const hasMeterSource = Boolean(group || prior || lookup || previousMeter > 0 || presentMeter > 0);
        const missingMeterMessage = hasMeterSource
            ? ''
            : 'No available previous meter reading found. Check first delivery/beginning meter or mark inactive if no delivery happened.';
        const pendingPresentMessage = hasMeterSource && !group
            ? 'Enter present reading to include this machine in the invoice total.'
            : '';
        const line = calculateMeterLineEstimate({
            label: machineRow.branch_name || machineRow.serial_number || machineRow.machine_label || 'Machine',
            subtitle: `${machineRow.machine_label || machineRow.serial_number || 'No machine serial'}${meterSourceLabel ? ` • last meter ${meterSourceLabel}` : ''}`,
            profile: machineProfile,
            previousMeter,
            presentMeter,
            spoilagePercent: Number(draft?.spoilage_percent ?? initialSnapshot.spoilagePercent ?? 0) || 0,
            row: machineRow,
            missingMeterMessage,
            pendingPresentMessage
        });
        return {
            ...line,
            sharedQuotaGroup: hasVerifiedGroupRatePlan,
            previousReadingDate
        };
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
    const [scheduleStaffOptions, billingPrintPolicy] = await Promise.all([
        loadBillingScheduleStaffOptions(),
        loadBillingPrintPolicy()
    ]);
    const allowSavedReprints = billingPrintPolicy.allowSavedReprints !== false;
    const printNameOptions = loadRtpPrintNameOptions();

    els.billingCalcTitle.textContent = `${row.display_name || row.account_name || row.company_name || 'Billing Calculation'}`;
    els.billingCalcSubtitle.textContent = `${context.monthLabel} • ${profile.category_code || 'N/A'} • ${profile.category_label || 'Billing profile'}`;
    setRtpPrintPayload(null);
    currentRtpMeterFormEstimate = null;
    if (els.billingCalcPrintBtn) {
        els.billingCalcPrintBtn.textContent = `Print ${printContractCode || 'Invoice'}`;
        els.billingCalcPrintBtn.classList.toggle('hidden', !canPrintInvoice);
        els.billingCalcPrintBtn.disabled = true;
    }
    if (els.billingCalcDotMatrixBtn) {
        els.billingCalcDotMatrixBtn.textContent = `${printContractCode || 'Invoice'} Dot Matrix Print`;
        els.billingCalcDotMatrixBtn.classList.toggle('hidden', !canPrintInvoice);
        els.billingCalcDotMatrixBtn.disabled = true;
    }
    if (els.billingCalcMeterFormBtn) {
        els.billingCalcMeterFormBtn.classList.toggle('hidden', !canPrintInvoice);
        els.billingCalcMeterFormBtn.disabled = true;
    }

    els.billingCalcContent.innerHTML = `
        <div class="calc-layout calc-ledger-layout">
            <div class="calc-flag-row">
                <span class="calc-flag">${escapeHtml(profile.category_code || 'N/A')} • ${escapeHtml(profile.category_label || 'Unclassified Contract')}</span>
                <span class="calc-flag">${escapeHtml(context.isReading ? 'Meter-Based Billing' : (context.isFixed ? 'Fixed Monthly Billing' : 'Reference Only'))}</span>
                <span class="calc-flag">${escapeHtml(profile.with_vat ? 'VAT Inclusive' : 'VAT Exclusive')}</span>
                <span class="calc-flag">Latest meter context: ${escapeHtml(latestMonthUsed)}</span>
            </div>
            <div id="calcBillingModeTabsWrap">
                ${renderBillingModeTabs(billingModeOptions, activeBillingMode)}
            </div>
            ${renderBillingModeSummary()}
            <div class="calc-save-row" id="calcSaveBillingRow">
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
                <section class="calc-panel calc-schedule-panel" id="calcSchedulePanel">
                    <div class="calc-panel-title">Set Schedule</div>
                    <div class="calc-panel-grid calc-cycle-grid">
                        <div class="calc-field">
                            <label for="calcScheduleDateInput">Schedule Date</label>
                            <input type="date" id="calcScheduleDateInput" value="${escapeHtml(context.scheduleDate || formatIsoDate(new Date()))}">
                        </div>
                        <div class="calc-field">
                            <label for="calcScheduleTimeInput">Time</label>
                            <input type="time" id="calcScheduleTimeInput" value="${escapeHtml(context.scheduleTime || '')}">
                        </div>
                        <div class="calc-field">
                            <label for="calcSchedulePurposeInput">Purpose</label>
                            <select id="calcSchedulePurposeInput">
                                ${Object.values(BILLING_SCHEDULE_PURPOSES).map((purpose) => `
                                    <option value="${escapeHtml(purpose.key)}"${purpose.key === context.schedulePurposeKey ? ' selected' : ''}>${escapeHtml(purpose.label)}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="calc-field">
                            <label for="calcScheduleStaffInput">Assigned Messenger / Tech</label>
                            <select id="calcScheduleStaffInput">
                                ${renderBillingScheduleStaffOptions(scheduleStaffOptions, context.scheduleAssignedStaffId)}
                            </select>
                        </div>
                    </div>
                    <div class="calc-schedule-actions">
                        <button class="btn btn-primary" type="button" id="calcSaveScheduleBtn" ${savedBillingDoc ? '' : 'disabled'}>Save Schedule</button>
                        <span class="calc-save-status" id="calcScheduleStatus">${context.scheduleSaved ? `Saved to Master Schedule${context.scheduleDate ? ` for ${escapeHtml(context.scheduleDate)}` : ''}.` : 'Save billing first, then set schedule to unlock printing.'}</span>
                    </div>
                </section>
            </div>
            <div class="calc-ledger-grid calc-ledger-grid-bottom ${['single_meter_rtp', 'rtf'].includes(activeBillingMode) ? '' : 'hidden'}" id="calcCalculationSections" data-calc-mode-panel="single_meter_rtp rtf">
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
                                <input type="text" id="calcSpoilagePagesValue" readonly value="${escapeHtml(formatCount(estimate.systemSpoilagePages ?? estimate.spoilagePages ?? 0))}">
                            </div>
                            <div class="calc-field">
                                <label for="calcActualSpoilageInput">Actual Spoilage</label>
                                <input type="number" id="calcActualSpoilageInput" min="0" step="1" value="${escapeHtml(String(initialSnapshot.actualSpoilagePages || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>Total Spoilage</label>
                                <input type="text" id="calcTotalSpoilageValue" readonly value="${escapeHtml(formatCount(estimate.totalSpoilagePages ?? estimate.spoilagePages ?? 0))}">
                            </div>
                            <div class="calc-field calc-field-span-2">
                                <label class="calc-checkbox-label">
                                    <input type="checkbox" id="calcApplyQuotaInput" ${initialSnapshot.applyQuota === false ? '' : 'checked'}>
                                    <span>Apply Quota</span>
                                </label>
                            </div>
                            <div class="calc-field calc-field-span-2" id="calcQuotaBypassReasonField">
                                <label for="calcQuotaBypassReasonInput">Quota Bypass Reason</label>
                                <textarea id="calcQuotaBypassReasonInput" rows="3" placeholder="Example: Delayed unit replacement; customer requested actual usage billing only">${escapeHtml(context.quotaBypassReason || '')}</textarea>
                            </div>
                            <div class="calc-field calc-field-span-2">
                                <label for="calcActualSpoilageReasonInput">Actual Spoilage Reason</label>
                                <textarea id="calcActualSpoilageReasonInput" rows="3" placeholder="Example: Additional spoilage discount due to frequent breakdown">${escapeHtml(context.actualSpoilageReason || '')}</textarea>
                            </div>
                            <div class="calc-field calc-field-span-2">
                                <label for="calcActualSpoilageProofInput">Spoilage Proof Image</label>
                                <input type="file" id="calcActualSpoilageProofInput" accept="image/*">
                                <div class="calc-proof-preview" id="calcActualSpoilageProofPreview">
                                    ${
                                        context.actualSpoilageProofImage
                                            ? `<img src="${escapeHtml(context.actualSpoilageProofImage)}" alt="Actual spoilage proof"><span>${escapeHtml(context.actualSpoilageProofName || 'Saved proof image')}</span>`
                                            : '<span>No proof image uploaded.</span>'
                                    }
                                </div>
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
                    <div class="calc-approval-panel ${Number(estimate.actualSpoilagePages || 0) > 0 ? '' : 'hidden'}" id="calcApprovalPanel">
                        <div>
                            <strong id="calcApprovalTitle">${escapeHtml(estimate.approvalStatus === 'approved' ? 'Actual spoilage approved' : 'Pending admin approval')}</strong>
                            <span id="calcApprovalCopy">${escapeHtml(estimate.approvalStatus === 'approved' ? `Approved by ${estimate.approvedBy || 'admin'}.` : 'Printing stays locked until an admin approves this actual spoilage discount.')}</span>
                        </div>
                        <div class="calc-approval-actions ${window.MargaAuth?.isAdmin?.() ? '' : 'hidden'}">
                            <button class="btn btn-primary" type="button" id="calcApproveSpoilageBtn">Approve</button>
                            <button class="btn btn-secondary" type="button" id="calcRejectSpoilageBtn">Reject</button>
                        </div>
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
                            estimate.savedComputation
                                ? estimate.savedComputation
                                : context.isReading
                                ? formatBillingComputationFlow(estimate)
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
            ${renderBillingLinePanel('multi_meter_rtp', 'Multiple Meter RTP', 'Use this for color copiers with separate Print and Copy counters for black/white and colored pages.', multiMeterSeedLines, legacyMultiMeterNote)}
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
                                    <button class="btn btn-secondary" type="button" id="calcPrintEnvelopeBtn" disabled>Print Envelope</button>
                                    <div class="calc-print-name-options" aria-label="Invoice company name print options">
                                        <span>Print company name with</span>
                                        <label class="calc-checkbox-label">
                                            <input type="checkbox" id="calcPrintNameDepartmentInput" ${printNameOptions.department ? 'checked' : ''}>
                                            <span>Department</span>
                                        </label>
                                        <label class="calc-checkbox-label">
                                            <input type="checkbox" id="calcPrintNameModelInput" ${printNameOptions.model ? 'checked' : ''}>
                                            <span>Model</span>
                                        </label>
                                        <label class="calc-checkbox-label">
                                            <input type="checkbox" id="calcPrintNameSerialInput" ${printNameOptions.serial ? 'checked' : ''}>
                                            <span>Serial</span>
                                        </label>
                                    </div>
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
    const actualSpoilageInput = document.getElementById('calcActualSpoilageInput');
    const actualSpoilageReasonInput = document.getElementById('calcActualSpoilageReasonInput');
    const actualSpoilageProofInput = document.getElementById('calcActualSpoilageProofInput');
    const actualSpoilageProofPreview = document.getElementById('calcActualSpoilageProofPreview');
    const applyQuotaInput = document.getElementById('calcApplyQuotaInput');
    const quotaBypassReasonInput = document.getElementById('calcQuotaBypassReasonInput');
    const quotaBypassReasonField = document.getElementById('calcQuotaBypassReasonField');
    const amountValue = document.getElementById('calcAmountValue');
    const rawPagesValue = document.getElementById('calcRawPagesValue');
    const spoilagePagesValue = document.getElementById('calcSpoilagePagesValue');
    const totalSpoilageValue = document.getElementById('calcTotalSpoilageValue');
    const netPagesValue = document.getElementById('calcNetPagesValue');
    const billedPagesValue = document.getElementById('calcBilledPagesValue');
    const succeedingPagesValue = document.getElementById('calcSucceedingPagesValue');
    const netValue = document.getElementById('calcNetValue');
    const vatValue = document.getElementById('calcVatValue');
    const formulaValue = document.getElementById('calcFormulaValue');
    const quotaValue = document.getElementById('calcQuotaValue');
    const flowValue = document.getElementById('calcFlowValue');
    const warningValue = document.getElementById('calcWarningValue');
    const approvalPanel = document.getElementById('calcApprovalPanel');
    const approvalTitle = document.getElementById('calcApprovalTitle');
    const approvalCopy = document.getElementById('calcApprovalCopy');
    const approveSpoilageBtn = document.getElementById('calcApproveSpoilageBtn');
    const rejectSpoilageBtn = document.getElementById('calcRejectSpoilageBtn');
    const scheduleDateInput = document.getElementById('calcScheduleDateInput');
    const scheduleTimeInput = document.getElementById('calcScheduleTimeInput');
    const schedulePurposeInput = document.getElementById('calcSchedulePurposeInput');
    const scheduleStaffInput = document.getElementById('calcScheduleStaffInput');
    const saveScheduleBtn = document.getElementById('calcSaveScheduleBtn');
    const scheduleStatus = document.getElementById('calcScheduleStatus');
    const previewMount = document.getElementById('calcRtpPreviewMount');
    const inlinePrintBtn = document.getElementById('calcInlinePrintBtn');
    const printBreakdownBtn = document.getElementById('calcPrintBreakdownBtn');
    const printMeterFormBtn = document.getElementById('calcPrintMeterFormBtn');
    const printEnvelopeBtn = document.getElementById('calcPrintEnvelopeBtn');
    const printNameOptionInputs = Array.from(document.querySelectorAll('#calcPrintNameDepartmentInput, #calcPrintNameModelInput, #calcPrintNameSerialInput'));
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
    const modeTabsWrap = document.getElementById('calcBillingModeTabsWrap');
    const modeSummaryPanel = document.getElementById('calcModeSummaryPanel');
    const saveBillingRow = document.getElementById('calcSaveBillingRow');
    const calculationSections = document.getElementById('calcCalculationSections');
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
    let calculationEdited = false;
    let actualSpoilageProof = {
        dataUrl: context.actualSpoilageProofImage || '',
        name: context.actualSpoilageProofName || '',
        type: context.actualSpoilageProofType || ''
    };
    let approvalStatus = context.approvalStatus || 'none';
    let approvalNote = context.approvalNote || '';
    let approvedBy = context.approvedBy || '';
    let approvedAt = context.approvedAt || '';
    let scheduleRequired = Boolean(context.scheduleRequired);
    let scheduleSaved = Boolean(context.scheduleSaved);
    let scheduleDocId = context.scheduleDocId || '';
    const getSelectedSchedulePurpose = () => getBillingSchedulePurpose(schedulePurposeInput?.value || context.schedulePurposeKey || context.schedulePurpose || 'Printed Billing');
    const lineInputValues = new Map();
    const draftSaveTimers = new Map();

    inlinePrintBtn?.addEventListener('click', printCurrentRtpInvoice);
    printBreakdownBtn?.addEventListener('click', () => {
        printBillingAttachment(currentRtpPrintPayload, activeEstimate, 'breakdown');
    });
    printMeterFormBtn?.addEventListener('click', () => {
        printBillingAttachment(currentRtpPrintPayload, activeEstimate, 'meter_form');
    });
    printEnvelopeBtn?.addEventListener('click', printCurrentEnvelope);
    const refreshRtpInvoiceNamePreview = () => {
        if (!previewMount || !currentRtpPrintPayload) return;
        previewMount.innerHTML = buildRtpCalibratedPreviewHtml(decorateRtpPrintPayload(currentRtpPrintPayload));
    };
    printNameOptionInputs.forEach((input) => {
        input.addEventListener('change', () => {
            saveRtpPrintNameOptions(getRtpPrintNameOptionsFromInputs());
            refreshRtpInvoiceNamePreview();
        });
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
        const line = calculateMeterLineEstimate({
            label: seed.label,
            subtitle: seed.subtitle,
            meterSection: seed.meterSection,
            meterType: seed.meterType,
            profile: lineProfile,
            previousMeter: readLineInputValue(mode, index, 'previousMeter', seed.previousMeter),
            presentMeter: readLineInputValue(mode, index, 'presentMeter', seed.presentMeter),
            spoilagePercent: readLineInputValue(mode, index, 'spoilagePercent', seed.spoilagePercent),
            applyQuota: applyQuotaInput?.checked !== false,
            quotaBypassReason: quotaBypassReasonInput?.value || '',
            row: seed.row || null,
            missingMeterMessage: seed.missingMeterMessage,
            pendingPresentMessage: seed.pendingPresentMessage
        });
        return {
            ...line,
            profile: lineProfile,
            sharedQuotaGroup: Boolean(seed.sharedQuotaGroup),
            previousReadingDate: seed.previousReadingDate || line.previousReadingDate || ''
        };
    };

    const updateLineCardDisplay = (mode, index, line) => {
        setElementDisplayValue(document.getElementById(`${mode}-${index}-amount`), formatAmount(line.amountDue || 0));
        const math = document.getElementById(`${mode}-${index}-math`);
        if (math) {
            math.textContent = formatLineComputation(line);
            math.classList.toggle('error', Boolean(line.warning));
        }
    };

    const saveDraftLineNow = async (index) => {
        if (activeBillingMode !== 'multi_machine_rtp') return;
        const lineRow = groupedRowsForBilling[index];
        const line = activeEstimate?.lineItems?.[index];
        if (!lineRow || !line) return;
        try {
            await saveBillingDraftLine({
                rootRow: row,
                lineRow,
                context,
                mode: activeBillingMode,
                index,
                line,
                invoiceNo: invoiceInput?.value || ''
            });
        } catch (error) {
            console.warn('Unable to autosave billing draft line.', error);
            MargaUtils.showToast('Draft reading did not save yet. Please keep the page open while it retries on the next edit.', 'error');
        }
    };

    const queueDraftLineSave = (index, waitMs = 700) => {
        if (activeBillingMode !== 'multi_machine_rtp') return;
        if (draftSaveTimers.has(index)) clearTimeout(draftSaveTimers.get(index));
        draftSaveTimers.set(index, setTimeout(() => {
            draftSaveTimers.delete(index);
            saveDraftLineNow(index);
        }, waitMs));
    };

    const flushDraftSaves = () => Promise.allSettled(Array.from(draftSaveTimers.keys()).map((index) => {
        clearTimeout(draftSaveTimers.get(index));
        draftSaveTimers.delete(index);
        return saveDraftLineNow(index);
    }));

    const calculateActiveEstimate = () => {
        if (!calculationEdited && savedLegacyEstimate && activeBillingMode === (savedLegacyEstimate.billingMode || activeBillingMode)) {
            return savedLegacyEstimate;
        }
        if (activeBillingMode === 'multi_meter_rtp') {
            const lines = multiMeterSeedLines.map((seed, index) => estimateLineFromSeed({ ...seed, profile: seed.profile || profile, row }, activeBillingMode, index));
            const summary = applySharedMultiMeterQuota(lines);
            summary.lineItems.forEach((line, index) => updateLineCardDisplay(activeBillingMode, index, line));
            summary.billingMode = activeBillingMode;
            return summary;
        }
        if (activeBillingMode === 'multi_machine_rtp') {
            const lines = multiMachineSeedLines.map((seed, index) => estimateLineFromSeed({
                ...seed,
                profile: seed.profile || getSharedBillingGroupProfile(groupedRowsForBilling[index], getRowBillingProfile(groupedRowsForBilling[index]) || profile),
                row: groupedRowsForBilling[index] || row
            }, activeBillingMode, index));
            const summary = hasSharedBillingGroupQuota(groupedRowsForBilling)
                ? applySharedMultiMeterQuota(lines)
                : summarizeBillingLines(lines);
            summary.lineItems.forEach((line, index) => updateLineCardDisplay(activeBillingMode, index, line));
            summary.billingMode = activeBillingMode;
            return summary;
        }
        const next = calculateBillingEstimate(
            { ...context, isFixed: activeBillingMode === 'rtf' ? true : context.isFixed },
            previousInput ? previousInput.value : context.previousMeter,
            presentInput ? presentInput.value : context.presentMeter,
            spoilageInput ? Number(spoilageInput.value || 0) / 100 : context.spoilageRate,
            {
                actualSpoilagePages: actualSpoilageInput ? Number(actualSpoilageInput.value || 0) || 0 : 0,
                actualSpoilageReason: actualSpoilageReasonInput?.value || '',
                actualSpoilageProofImage: actualSpoilageProof.dataUrl || '',
                actualSpoilageProofName: actualSpoilageProof.name || '',
                actualSpoilageProofType: actualSpoilageProof.type || '',
                actualSpoilageRequestedBy: context.actualSpoilageRequestedBy || '',
                actualSpoilageRequestedAt: context.actualSpoilageRequestedAt || '',
                applyQuota: applyQuotaInput?.checked !== false,
                quotaBypassReason: quotaBypassReasonInput?.value || '',
                approvalStatus,
                approvalNote,
                approvedBy,
                approvedAt
            }
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
                modeSummaryCopy.textContent = 'Print and Copy counters are computed separately for black/white and colored pages, then summed into one invoice.';
            } else if (activeBillingMode === 'multi_machine_rtp') {
                modeSummaryCopy.textContent = 'Machine lines share one invoice number, one combined quota, and one rate plan.';
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
            actualSpoilagePages: primaryLine ? primaryLine.actualSpoilagePages : (actualSpoilageInput?.value || 0),
            applyQuota: primaryLine ? primaryLine.applyQuota !== false : applyQuotaInput?.checked !== false,
            quotaBypassReason: primaryLine ? primaryLine.quotaBypassReason : (quotaBypassReasonInput?.value || ''),
            billingMode: activeBillingMode,
            schedulePurposeKey: getSelectedSchedulePurpose().key,
            schedulePurpose: getSelectedSchedulePurpose().label,
            linesSignature: buildBillingLinesSignature(activeEstimate?.lineItems || [])
        });
    };

    const syncCalcWorkflowState = () => {
        const currentSnapshot = buildCurrentSnapshot();
        const matchesSaved = savedDocExists && savedSnapshot ? billingSnapshotsEqual(savedSnapshot, currentSnapshot) : false;
        const isDirty = savedDocExists && !matchesSaved;
        const needsApproval = Number(activeEstimate?.actualSpoilagePages || 0) > 0;
        const approvalReady = !needsApproval || approvalStatus === 'approved';
        const scheduleReady = !scheduleRequired || scheduleSaved;
        const schedulePurpose = getSelectedSchedulePurpose();
        const isReadingSchedule = schedulePurpose.key === 'reading';
        const quotaUnchecked = applyQuotaInput?.checked === false;

        if (saveBillingBtn) saveBillingBtn.textContent = savedDocExists ? 'Update Billing' : 'Save Billing';
        if (saveBillingBtn) saveBillingBtn.disabled = isReadingSchedule;
        if (invoiceInput) invoiceInput.disabled = isReadingSchedule;
        if (saveScheduleBtn) saveScheduleBtn.disabled = schedulePurpose.requiresBilling && !savedDocExists;
        modeTabsWrap?.classList.toggle('hidden', isReadingSchedule);
        modeSummaryPanel?.classList.toggle('hidden', isReadingSchedule);
        saveBillingRow?.classList.toggle('hidden', isReadingSchedule);
        calculationSections?.classList.toggle('hidden', isReadingSchedule || !['single_meter_rtp', 'rtf'].includes(activeBillingMode));
        quotaBypassReasonField?.classList.toggle('hidden', !quotaUnchecked);
        if (saveStatus) {
            saveStatus.classList.toggle('error', Boolean(workflowError));
            if (workflowError) {
                saveStatus.textContent = workflowError;
            } else if (isReadingSchedule) {
                saveStatus.textContent = 'Reading schedule only. Invoice number and billing calculation are not required.';
            } else if (!savedDocExists) {
                saveStatus.textContent = `Save this billing first so it lands in ${savedMonthLabel} and unlocks printing.`;
            } else if (isDirty && allowSavedReprints) {
                saveStatus.textContent = `Saved in ${savedMonthLabel}. Reprint is allowed by global Billing settings; save again only if you want to replace the saved invoice.`;
            } else if (isDirty) {
                saveStatus.textContent = `You changed the billing values. Save again to update ${savedMonthLabel} and re-enable printing.`;
            } else if (needsApproval && !approvalReady) {
                saveStatus.textContent = `Saved in ${savedMonthLabel}. Actual spoilage is ${approvalStatus === 'rejected' ? 'rejected' : 'pending admin approval'}, so printing is locked.`;
            } else if (!scheduleReady) {
                saveStatus.textContent = `Saved in ${savedMonthLabel}. Set the Master Schedule before printing.`;
            } else {
                saveStatus.textContent = `Saved in ${savedMonthLabel}. The month cell now owns invoice ${currentSnapshot.invoiceNo || 'N/A'} and Print ${printContractCode || 'Invoice'} is ready.`;
            }
        }
        if (scheduleStatus) {
            scheduleStatus.classList.toggle('error', scheduleRequired && !scheduleSaved);
            scheduleStatus.textContent = scheduleSaved
                ? `Saved to Master Schedule${scheduleDateInput?.value ? ` for ${scheduleDateInput.value}` : ''}.`
                : isReadingSchedule
                    ? 'Set date and messenger/tech to schedule meter reading.'
                : savedDocExists
                    ? 'Set schedule is mandatory before printing.'
                    : 'Save billing first, then set schedule to unlock printing.';
        }

        if (approvalPanel) {
            approvalPanel.classList.toggle('hidden', !needsApproval);
            approvalPanel.classList.toggle('approved', approvalStatus === 'approved');
            approvalPanel.classList.toggle('rejected', approvalStatus === 'rejected');
        }
        if (approvalTitle) {
            approvalTitle.textContent = approvalStatus === 'approved'
                ? 'Actual spoilage approved'
                : approvalStatus === 'rejected'
                    ? 'Actual spoilage rejected'
                    : 'Pending admin approval';
        }
        if (approvalCopy) {
            approvalCopy.textContent = approvalStatus === 'approved'
                ? `Approved by ${approvedBy || 'admin'}${approvedAt ? ` on ${formatUsDate(asValidDate(approvedAt))}` : ''}. Printing is unlocked.`
                : approvalStatus === 'rejected'
                    ? 'Printing is locked. Update the billing or request approval again.'
                    : 'Printing stays locked until an admin approves this actual spoilage discount.';
        }

        if (!canPrintInvoice) return;
        const reprintAllowed = allowSavedReprints && savedDocExists;
        const printMatchesSaved = matchesSaved || reprintAllowed;
        const printEnabled = !isReadingSchedule && previewReady && printMatchesSaved && approvalReady && scheduleReady;
        const dotMatrixPrintEnabled = !isReadingSchedule && previewReady && printMatchesSaved && approvalReady;
        let printHint = 'Preparing preview...';
        if (previewReady) {
            if (workflowError) {
                printHint = workflowError;
            } else if (!savedDocExists) {
                printHint = `Save billing first to enable Print ${printContractCode || 'Invoice'}.`;
            } else if (isDirty && allowSavedReprints) {
                printHint = 'Reprint is enabled by global Billing settings. Save again only if you need to replace the saved invoice.';
            } else if (isDirty) {
                printHint = `Save your changes first so the printed ${printContractCode || 'invoice'} matches the saved invoice.`;
            } else if (!approvalReady) {
                printHint = approvalStatus === 'rejected'
                    ? 'Actual spoilage was rejected. Printing is locked until the billing is updated and approved.'
                    : 'Actual spoilage is pending admin approval. Printing is locked.';
            } else if (!scheduleReady) {
                printHint = 'Set the Master Schedule before printing this invoice.';
            } else {
                printHint = 'Ready to print. Turn off Headers and footers in More settings if the browser preview adds extra top space.';
            }
        }
        setCalcInlinePrintState({
            visible: !isReadingSchedule,
            disabled: !printEnabled,
            hint: printHint
        });
        if (els.billingCalcPrintBtn) {
            els.billingCalcPrintBtn.classList.toggle('hidden', !canPrintInvoice || isReadingSchedule);
            els.billingCalcPrintBtn.disabled = !printEnabled;
        }
        if (els.billingCalcDotMatrixBtn) {
            els.billingCalcDotMatrixBtn.classList.toggle('hidden', !canPrintInvoice || isReadingSchedule);
            els.billingCalcDotMatrixBtn.disabled = !dotMatrixPrintEnabled;
        }
        if (els.billingCalcMeterFormBtn) {
            els.billingCalcMeterFormBtn.classList.toggle('hidden', !canPrintInvoice || isReadingSchedule);
            els.billingCalcMeterFormBtn.disabled = !printEnabled;
        }
        if (els.billingCalcEnvelopeBtn) {
            els.billingCalcEnvelopeBtn.classList.toggle('hidden', !canPrintInvoice || isReadingSchedule);
            els.billingCalcEnvelopeBtn.disabled = !printEnabled;
        }
        if (printBreakdownBtn) printBreakdownBtn.disabled = !printEnabled;
        if (printMeterFormBtn) printMeterFormBtn.disabled = !printEnabled;
        if (printEnvelopeBtn) printEnvelopeBtn.disabled = !printEnabled;
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
                currentRtpMeterFormEstimate = null;
                previewReady = false;
                if (saveStatus) saveStatus.textContent = 'The print preview is unavailable for this row right now.';
                syncCalcWorkflowState();
                return;
            }
            const savedInvoiceNo = normalizeInvoiceNumber(savedSnapshot?.invoiceNo || invoiceInput?.value || preview.invoiceNo || '');
            const savedDocIds = Array.from(new Set((existingBillingDocs || [])
                .map((doc) => String(doc?._docId || doc?.docId || '').trim())
                .filter(Boolean)));
            const printablePreview = {
                ...preview,
                invoiceNo: savedInvoiceNo || preview.invoiceNo || '',
                billingDocIds: savedDocIds.length ? savedDocIds : (Array.isArray(preview.billingDocIds) ? preview.billingDocIds : [])
            };
            setRtpPrintPayload(printablePreview);
            previewMount.innerHTML = buildRtpCalibratedPreviewHtml(decorateRtpPrintPayload(printablePreview));
            currentRtpMeterFormEstimate = nextEstimate;
            previewReady = true;
            syncCalcWorkflowState();
        } catch (error) {
            console.warn('Unable to build calculator print preview.', error);
            if (requestToken !== billingCalcRequestToken) return;
            previewMount.innerHTML = '<div class="detail-empty">The printable invoice preview could not load the extra customer data right now.</div>';
            setRtpPrintPayload(null);
            currentRtpMeterFormEstimate = null;
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
        setElementDisplayValue(spoilagePagesValue, formatCount(next.systemSpoilagePages ?? next.spoilagePages ?? 0));
        setElementDisplayValue(totalSpoilageValue, formatCount(next.totalSpoilagePages ?? next.spoilagePages ?? 0));
        setElementDisplayValue(netPagesValue, formatCount(next.netPages || 0));
        setElementDisplayValue(billedPagesValue, formatCount(next.billedPages || 0));
        setElementDisplayValue(succeedingPagesValue, formatCount(next.succeedingPages || 0));
        setElementDisplayValue(netValue, formatAmount(next.netAmount || 0));
        setElementDisplayValue(vatValue, formatAmount(next.vatAmount || 0));
        setElementDisplayValue(modeTotalAmountValue, formatAmount(next.amountDue || 0));
        if (formulaValue) formulaValue.textContent = next.formula;
        if (quotaValue) {
            quotaValue.textContent = next.sharedMeterGroups?.length
                ? next.sharedMeterGroups.map((group) => `${group.label}: ${formatCount(group.quotaPages)} shared quota / ${formatCount(group.netPages)} net`).join(' • ')
                : next.quotaVariance === null
                ? (next.lineItems?.length > 1 ? `${formatCount(next.lineItems.length)} billing lines summed.` : 'No quota saved on this contract.')
                : `${formatCount(profile.monthly_quota || 0)} quota floor • ${next.quotaVariance >= 0 ? '+' : ''}${formatCount(next.quotaVariance)} vs net pages`;
        }
        if (flowValue) {
            flowValue.textContent = next.sharedMeterGroups?.length
                ? next.sharedMeterGroups.map((group) => group.computation).filter(Boolean).join('\n')
                : next.lineItems?.length > 1
                ? next.lineItems.map((line) => `${line.label}: ${formatAmount(line.amountDue || 0)}`).join(' • ')
                : next.savedComputation
                ? next.savedComputation
                : context.isReading
                ? formatBillingComputationFlow(next)
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
        if (activeBillingMode === 'multi_machine_rtp') {
            (activeEstimate?.lineItems || []).forEach((_, index) => queueDraftLineSave(index, 1200));
        }
    });
    const markCalculationEditedAndRecompute = () => {
        calculationEdited = true;
        if (Number(actualSpoilageInput?.value || 0) > 0 && approvalStatus === 'approved') {
            approvalStatus = 'pending';
            approvalNote = '';
            approvedBy = '';
            approvedAt = '';
        }
        recompute();
    };
    previousInput?.addEventListener('input', markCalculationEditedAndRecompute);
    presentInput?.addEventListener('input', markCalculationEditedAndRecompute);
    spoilageInput?.addEventListener('input', markCalculationEditedAndRecompute);
    actualSpoilageInput?.addEventListener('input', () => {
        calculationEdited = true;
        approvalStatus = Number(actualSpoilageInput.value || 0) > 0 ? 'pending' : 'none';
        approvalNote = '';
        approvedBy = '';
        approvedAt = '';
        recompute();
    });
    actualSpoilageReasonInput?.addEventListener('input', () => {
        calculationEdited = true;
        if (Number(actualSpoilageInput?.value || 0) > 0 && approvalStatus === 'approved') approvalStatus = 'pending';
        recompute();
    });
    applyQuotaInput?.addEventListener('change', () => {
        calculationEdited = true;
        workflowError = '';
        recompute();
    });
    quotaBypassReasonInput?.addEventListener('input', () => {
        calculationEdited = true;
        workflowError = '';
        recompute();
    });
    actualSpoilageProofInput?.addEventListener('change', async () => {
        const file = actualSpoilageProofInput.files?.[0] || null;
        if (!file) return;
        try {
            actualSpoilageProof = await resizeImageFileToDataUrl(file);
            if (actualSpoilageProofPreview) {
                actualSpoilageProofPreview.innerHTML = `<img src="${escapeHtml(actualSpoilageProof.dataUrl)}" alt="Actual spoilage proof"><span>${escapeHtml(actualSpoilageProof.name)}</span>`;
            }
            calculationEdited = true;
            if (Number(actualSpoilageInput?.value || 0) > 0) approvalStatus = 'pending';
            recompute();
        } catch (error) {
            actualSpoilageProofInput.value = '';
            MargaUtils.showToast(String(error?.message || 'Unable to upload proof image.'), 'error');
        }
    });
    [scheduleDateInput, scheduleTimeInput, schedulePurposeInput, scheduleStaffInput].forEach((input) => {
        input?.addEventListener('input', () => {
            if (scheduleSaved) {
                scheduleSaved = false;
                syncCalcWorkflowState();
            }
        });
        input?.addEventListener('change', () => {
            if (scheduleSaved) {
                scheduleSaved = false;
                syncCalcWorkflowState();
            }
        });
    });
    schedulePurposeInput?.addEventListener('change', () => {
        const purpose = getSelectedSchedulePurpose();
        activeEstimate.schedulePurposeKey = purpose.key;
        activeEstimate.schedulePurpose = purpose.label;
        activeEstimate.scheduleType = purpose.label;
        workflowError = '';
        syncCalcWorkflowState();
    });
    modeTabs.forEach((tab) => tab.addEventListener('click', () => {
        activeBillingMode = tab.dataset.calcModeTab || activeBillingMode;
        calculationEdited = true;
        if (Number(actualSpoilageInput?.value || 0) > 0 && approvalStatus === 'approved') {
            approvalStatus = 'pending';
            approvalNote = '';
            approvedBy = '';
            approvedAt = '';
        }
        syncModeUi();
        recompute();
    }));
    document.querySelectorAll('[data-calc-line-mode][data-calc-line-index][data-calc-line-field]').forEach((input) => {
        cacheLineInputValue(input);
        input.addEventListener('input', () => {
            cacheLineInputValue(input);
            calculationEdited = true;
            recompute();
            if (input.dataset.calcLineMode === 'multi_machine_rtp') {
                queueDraftLineSave(Number(input.dataset.calcLineIndex || 0), 700);
            }
        });
        input.addEventListener('change', () => {
            cacheLineInputValue(input);
            calculationEdited = true;
            recompute();
            if (input.dataset.calcLineMode === 'multi_machine_rtp') {
                queueDraftLineSave(Number(input.dataset.calcLineIndex || 0), 0);
            }
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
    const updateActualSpoilageApproval = async (nextStatus) => {
        if (!savedBillingDocId) {
            MargaUtils.showToast('Save the billing first before approval.', 'error');
            return;
        }
        const audit = getCurrentUserAudit();
        const nowIso = new Date().toISOString();
        approvalStatus = nextStatus;
        approvedBy = nextStatus === 'approved' ? audit.name : '';
        approvedAt = nextStatus === 'approved' ? nowIso : '';
        approvalNote = nextStatus === 'approved' ? 'Approved actual spoilage discount.' : 'Rejected actual spoilage discount.';
        if (approveSpoilageBtn) approveSpoilageBtn.disabled = true;
        if (rejectSpoilageBtn) rejectSpoilageBtn.disabled = true;
        try {
            await setFirestoreDocument('tbl_billing', savedBillingDocId, {
                approval_status: approvalStatus,
                approval_note: approvalNote,
                approved_by: approvedBy,
                approved_at: approvedAt,
                approval_updated_by: audit.name,
                approval_updated_at: nowIso,
                updated_at: nowIso
            }, {
                mode: 'patch',
                label: `Billing actual spoilage ${nextStatus}`,
                dedupeKey: `tbl_billing:${savedBillingDocId}:actual-spoilage-${nextStatus}:${nowIso}`
            });
            activeEstimate = {
                ...activeEstimate,
                approvalStatus,
                approvalNote,
                approvedBy,
                approvedAt
            };
            if (activeEstimate.lineItems?.[0]) {
                activeEstimate.lineItems[0] = {
                    ...activeEstimate.lineItems[0],
                    approvalStatus,
                    approvalNote,
                    approvedBy,
                    approvedAt
                };
            }
            MargaUtils.showToast(
                nextStatus === 'approved' ? 'Actual spoilage approved. Printing is unlocked.' : 'Actual spoilage rejected. Printing stays locked.',
                nextStatus === 'approved' ? 'success' : 'error'
            );
            renderCalcPreview(activeEstimate);
            syncCalcWorkflowState();
        } catch (error) {
            MargaUtils.showToast(String(error?.message || 'Unable to update approval.'), 'error');
        } finally {
            if (approveSpoilageBtn) approveSpoilageBtn.disabled = false;
            if (rejectSpoilageBtn) rejectSpoilageBtn.disabled = false;
        }
    };
    approveSpoilageBtn?.addEventListener('click', () => updateActualSpoilageApproval('approved'));
    rejectSpoilageBtn?.addEventListener('click', () => updateActualSpoilageApproval('rejected'));
    saveScheduleBtn?.addEventListener('click', async () => {
        const schedulePurpose = getSelectedSchedulePurpose();
        if (schedulePurpose.requiresBilling && (!savedDocExists || !savedBillingDocId)) {
            MargaUtils.showToast('Save the billing first before setting schedule.', 'error');
            return;
        }
        const scheduleDate = String(scheduleDateInput?.value || '').trim();
        const scheduleTime = String(scheduleTimeInput?.value || '').trim();
        const scheduleType = schedulePurpose.label;
        let staffId = String(scheduleStaffInput?.value || '').trim();
        let staffOption = scheduleStaffOptions.find((staff) => staff.id === staffId) || null;
        if (!scheduleDate) {
            MargaUtils.showToast('Choose a schedule date before printing.', 'error');
            return;
        }
        if (!staffId) {
            MargaUtils.showToast('Choose an assigned messenger or tech before printing.', 'error');
            return;
        }
        let staffName = staffOption?.name || staffId;
        if (window.MargaScheduleConsolidation?.validateRequiredAssignment) {
            const assignment = MargaScheduleConsolidation.validateRequiredAssignment({
                staffId,
                staffName,
                activeStaffIds: scheduleStaffOptions.map((staff) => String(staff.id || '').trim()).filter(Boolean)
            });
            if (!assignment.ok) {
                MargaUtils.showToast(assignment.reason, 'error');
                return;
            }
        }
        if (window.MargaScheduleConsolidation) {
            const taskDateTime = `${scheduleDate} ${scheduleTime || '08:00'}${scheduleTime && scheduleTime.length === 5 ? ':00' : ''}`;
            const purposeId = schedulePurpose.key === 'reading' ? 8 : 1;
            const consolidation = await MargaScheduleConsolidation.resolveAssignment({
                moduleName: 'billing',
                date: scheduleDate,
                taskDatetime: taskDateTime,
                companyId: row?.company_id,
                branchId: row?.branch_id || row?.primaryBranchId,
                staffId,
                staffName,
                purposeId,
                scheduleId: activeEstimate?.scheduleTaskId || '',
                currentDocId: activeEstimate?.scheduleTaskDocId || '',
                customerName: row?.company_name || row?.account_name || row?.display_name || '',
                getStaffName: (id) => scheduleStaffOptions.find((staff) => String(staff.id) === String(id))?.name || `Staff #${id}`
            });
            if (!consolidation.ok) return;
            staffId = String(consolidation.staffId || staffId);
            activeEstimate.scheduleConsolidationFields = consolidation.scheduleFields || {};
            staffOption = scheduleStaffOptions.find((staff) => staff.id === staffId) || staffOption;
            staffName = staffOption?.name || staffName || staffId;
            if (scheduleStaffInput) scheduleStaffInput.value = staffId;
        }
        saveScheduleBtn.disabled = true;
        try {
            activeEstimate.schedulePurposeKey = schedulePurpose.key;
            activeEstimate.schedulePurpose = schedulePurpose.label;
            activeEstimate.scheduleType = scheduleType;
            activeEstimate.scheduleDate = scheduleDate;
            activeEstimate.scheduleTime = scheduleTime;
            activeEstimate.scheduleAssignedStaffId = staffId;
            activeEstimate.scheduleAssignedStaffName = staffName;
            if (!scheduleDocId) {
                const plannerResult = schedulePurpose.key === 'reading'
                    ? await saveReadingToSchedulePlanner({ row, context, estimate: activeEstimate })
                    : await saveBillingToSchedulePlanner({
                        result: {
                            docId: savedBillingDocId,
                            invoiceNo: buildCurrentSnapshot().invoiceNo,
                            fields: { _docId: savedBillingDocId }
                        },
                        row,
                        context,
                        estimate: activeEstimate,
                        snapshot: buildCurrentSnapshot()
                    });
                scheduleDocId = plannerResult.docs?.[0]?.docId || scheduleDocId;
            }
            if (!scheduleDocId) throw new Error('Unable to create Master Schedule planner row.');
            const audit = getCurrentUserAudit();
            const nowIso = new Date().toISOString();
            const scheduleTask = await saveBillingScheduleToFieldTask({
                plannerDocId: scheduleDocId,
                row,
                context,
                estimate: activeEstimate,
                purpose: schedulePurpose,
                staffId,
                staffName,
                auditName: audit.name
            });
            await setFirestoreDocument(SCHEDULE_PLANNER_COLLECTION, scheduleDocId, {
                planner_status: 'scheduled',
                task_status: 'scheduled',
                route_status: 'scheduled',
                schedule_task_doc_id: scheduleTask.docId,
                schedule_task_id: scheduleTask.taskId,
                purpose: schedulePurpose.label,
                schedule_purpose: schedulePurpose.label,
                schedule_purpose_key: schedulePurpose.key,
                task_type: schedulePurpose.taskType,
                task_label: schedulePurpose.taskLabel,
                schedule_date: scheduleDate,
                schedule_time: scheduleTime,
                schedule_type: scheduleType,
                assigned_staff_id: staffId,
                assigned_staff_name: staffName,
                assigned_to_id: staffId,
                assigned_to: staffName,
                assigned_by: audit.name,
                assigned_at: nowIso,
                updated_at: nowIso
            }, {
                mode: 'patch',
                label: `Billing schedule ${buildCurrentSnapshot().invoiceNo || scheduleDocId}`,
                dedupeKey: `${SCHEDULE_PLANNER_COLLECTION}:${scheduleDocId}:schedule:${scheduleDate}:${staffId}`
            });
            if (savedBillingDocId) {
                await setFirestoreDocument('tbl_billing', savedBillingDocId, {
                    schedule_required: true,
                    schedule_saved: true,
                    schedule_doc_id: scheduleDocId,
                    schedule_date: scheduleDate,
                    schedule_time: scheduleTime,
                    schedule_type: scheduleType,
                    schedule_purpose: schedulePurpose.label,
                    schedule_purpose_key: schedulePurpose.key,
                    schedule_task_doc_id: scheduleTask.docId,
                    schedule_task_id: scheduleTask.taskId,
                    schedule_assigned_staff_id: staffId,
                    schedule_assigned_staff_name: staffName,
                    updated_at: nowIso
                }, {
                    mode: 'patch',
                    label: `Billing schedule gate ${buildCurrentSnapshot().invoiceNo || savedBillingDocId}`,
                    dedupeKey: `tbl_billing:${savedBillingDocId}:schedule:${scheduleDate}:${staffId}`
                });
            }
            scheduleRequired = true;
            scheduleSaved = true;
            activeEstimate.scheduleSaved = true;
            activeEstimate.scheduleDocId = scheduleDocId;
            activeEstimate.scheduleTaskDocId = scheduleTask.docId;
            activeEstimate.scheduleTaskId = scheduleTask.taskId;
            MargaUtils.showToast(`Saved to Master Schedule for ${scheduleDate}.`, 'success');
            syncCalcWorkflowState();
        } catch (error) {
            MargaUtils.showToast(String(error?.message || 'Unable to save schedule.'), 'error');
        } finally {
            saveScheduleBtn.disabled = false;
        }
    });
    saveBillingBtn?.addEventListener('click', async () => {
        const schedulePurpose = getSelectedSchedulePurpose();
        if (!schedulePurpose.requiresBilling) {
            MargaUtils.showToast('Reading schedules do not require invoice number or billing save. Use Save Schedule.', 'error');
            return;
        }
        activeEstimate = calculateActiveEstimate();
        activeEstimate.schedulePurposeKey = schedulePurpose.key;
        activeEstimate.schedulePurpose = schedulePurpose.label;
        activeEstimate.scheduleType = schedulePurpose.label;
        const actualSpoilagePages = Number(activeEstimate?.actualSpoilagePages || 0) || 0;
        if (actualSpoilagePages > 0 && !actualSpoilageProof.dataUrl) {
            workflowError = 'Upload a spoilage proof image before requesting approval.';
            saveStatus?.classList.add('error');
            if (inlinePrintHint) inlinePrintHint.classList.add('error');
            MargaUtils.showToast(workflowError, 'error');
            syncCalcWorkflowState();
            return;
        }
        if (actualSpoilagePages > 0 && !String(activeEstimate.actualSpoilageReason || '').trim()) {
            workflowError = 'Enter the actual spoilage reason before requesting approval.';
            saveStatus?.classList.add('error');
            MargaUtils.showToast(workflowError, 'error');
            syncCalcWorkflowState();
            return;
        }
        if (actualSpoilagePages > 0 && approvalStatus !== 'approved') {
            const audit = getCurrentUserAudit();
            approvalStatus = 'pending';
            context.actualSpoilageRequestedBy = context.actualSpoilageRequestedBy || audit.name;
            context.actualSpoilageRequestedAt = context.actualSpoilageRequestedAt || new Date().toISOString();
            activeEstimate.approvalStatus = approvalStatus;
            activeEstimate.actualSpoilageRequestedBy = context.actualSpoilageRequestedBy;
            activeEstimate.actualSpoilageRequestedAt = context.actualSpoilageRequestedAt;
            if (activeEstimate.lineItems?.[0]) {
                activeEstimate.lineItems[0] = {
                    ...activeEstimate.lineItems[0],
                    approvalStatus,
                    actualSpoilageRequestedBy: context.actualSpoilageRequestedBy,
                    actualSpoilageRequestedAt: context.actualSpoilageRequestedAt
                };
            }
        }
        const currentSnapshot = buildCurrentSnapshot();
        workflowError = '';
        invoiceInput?.classList.remove('input-error');
        saveStatus?.classList.remove('error');
        if (inlinePrintHint) inlinePrintHint.classList.remove('error');
        saveBillingBtn.disabled = true;
        if (deleteBillingBtn) deleteBillingBtn.disabled = true;
        try {
            await flushDraftSaves();
            const result = await saveBillingRecord({
                row,
                context,
                estimate: activeEstimate,
                snapshot: currentSnapshot,
                existingDocs: existingBillingDocs
            });
            savedSnapshot = currentSnapshot;
            savedDocExists = true;
            let plannerResult = null;
            let plannerError = '';
            try {
                plannerResult = await saveBillingToSchedulePlanner({
                    result,
                    row,
                    context,
                    estimate: activeEstimate,
                    snapshot: currentSnapshot
                });
            } catch (error) {
                plannerError = String(error?.message || 'Schedule Planner save failed.');
                console.warn('Invoice saved but Schedule Planner write failed.', error);
            }
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
            savedBillingDocId = result.docId || savedBillingDocId;
            if (currentRtpPrintPayload) {
                const docIds = Array.isArray(result.docs) && result.docs.length
                    ? result.docs.map((entry) => String(entry.docId || '').trim()).filter(Boolean)
                    : [savedBillingDocId].filter(Boolean);
                setRtpPrintPayload({
                    ...currentRtpPrintPayload,
                    invoiceNo: currentSnapshot.invoiceNo,
                    billingDocIds: Array.from(new Set(docIds))
                });
            }
            if (activeBillingMode === 'multi_machine_rtp') {
                markBillingDraftGroupSaved(row, context.monthKey, activeBillingMode, currentSnapshot.invoiceNo).catch((error) => {
                    console.warn('Unable to mark billing draft lines as saved.', error);
                });
            }
            approvalStatus = String(result.fields?.approval_status || approvalStatus || 'none');
            scheduleRequired = true;
            scheduleSaved = false;
            scheduleDocId = plannerResult?.docs?.[0]?.docId || scheduleDocId || '';
            syncCalcWorkflowState();
            const plannerCount = Number(plannerResult?.savedCount || 0) || 0;
            const plannerQueued = Boolean(plannerResult?.queued);
            const plannerMessage = plannerError
                ? `Invoice saved, but Schedule Planner was not updated: ${plannerError}`
                : approvalStatus === 'pending'
                    ? `Saved Invoice ${currentSnapshot.invoiceNo} as pending admin approval for actual spoilage.`
                : plannerQueued
                    ? `Invoice ${currentSnapshot.invoiceNo} was queued and the Schedule Planner request was queued too.`
                    : `Saved Invoice ${currentSnapshot.invoiceNo} and saved ${plannerCount || 1} request${plannerCount === 1 ? '' : 's'} to Schedule Planner.`;
            MargaUtils.showToast(
                plannerError
                    ? `Invoice ${currentSnapshot.invoiceNo} saved. Schedule Planner needs retry.`
                    : approvalStatus === 'pending'
                        ? `Invoice ${currentSnapshot.invoiceNo} saved - pending admin approval.`
                    : result.queued || plannerQueued
                        ? `Invoice ${currentSnapshot.invoiceNo} queued for Billing and Schedule Planner.`
                        : `Saved Invoice ${currentSnapshot.invoiceNo} - saved to Schedule Planner.`,
                plannerError ? 'error' : 'success'
            );
            showBillingSaveResult({
                type: plannerError ? 'error' : 'success',
                title: plannerError ? 'Saved Invoice, Planner Failed' : (approvalStatus === 'pending' ? 'Pending Approval' : (result.queued || plannerQueued ? 'Saved Invoice Queued' : 'Saved Invoice')),
                message: plannerError
                    ? plannerMessage
                    : approvalStatus === 'pending'
                        ? `${plannerMessage} Print ${printContractCode || 'Invoice'} is locked until approval.`
                        : `${plannerMessage} Print ${printContractCode || 'Invoice'} is ready.`
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
    const payloadSearchTerm = getPayloadSearchTerm(payload);
    const selectedRowId = MargaUtils.getUrlParam('row_id');
    const selectedMonth = MargaUtils.getUrlParam('month');
    const searchTerm = getMatrixSearchTerm();
    const payloadMatchesCurrentSearch = payloadSearchTerm === searchTerm;
    const payloadIsStaleSearch = Boolean(payloadSearchTerm && payloadSearchTerm !== searchTerm);

    if (payloadIsStaleSearch) {
        renderedMatrixRows = [];
        renderCustomerStatementBar([]);
        if (els.matrixSearchMeta) {
            els.matrixSearchMeta.textContent = searchTerm
                ? `Loading full search results for "${els.matrixSearchInput.value.trim()}".`
                : 'Reloading all billing rows.';
        }
        if (els.matrixTotalsWrap) els.matrixTotalsWrap.innerHTML = '<div class="empty-panel">Loading billed totals...</div>';
        els.matrixTableWrap.innerHTML = '<div class="empty-panel">Loading current search results...</div>';
        return;
    }

    renderPrintedTodayCard(payload);

    const matchedRowCount = payloadMatchesCurrentSearch
        ? Number(payload?.summary?.matrix_customers_total || rows.length)
        : rows.length;
    const isRowWindowed = matchedRowCount > rows.length;
    const filteredRows = searchTerm
        ? (() => {
            const directMatches = rows.filter((row) => textMatchesSearch(searchTerm, [
                row.serial_number,
                row.account_name,
                row.company_name,
                row.branch_name,
                row.machine_label,
                row.machine_id,
                row.contractmain_id,
                row.reading_day
            ]));
            const identityMatches = directMatches.filter((row) => rowMatchesMachineIdentitySearch(row, searchTerm));
            if (isSpecificMachineSearch(searchTerm) && identityMatches.length) return identityMatches;
            const matchedGroupIds = new Set(directMatches
                .map((row) => String(row?.billing_group?.id || row?.billing_group?.group_id || '').trim())
                .filter(Boolean));
            if (!matchedGroupIds.size) return directMatches;
            const directRowIds = new Set(directMatches.map((row) => String(row.row_id || row.company_id || '').trim()));
            return rows.filter((row) => {
                const rowId = String(row.row_id || row.company_id || '').trim();
                const groupId = String(row?.billing_group?.id || row?.billing_group?.group_id || '').trim();
                return directRowIds.has(rowId) || matchedGroupIds.has(groupId);
            });
        })()
        : rows;
    const sortedRows = [...filteredRows].sort((left, right) => compareBillingRows(left, right, getMatrixSortValue()));
    const rowsWithAmounts = filteredRows.filter((row) => (
        Object.values(row?.months || {}).some((cell) => Number(cell?.display_amount_total || 0) > 0)
    )).length;
    const sortValue = getMatrixSortValue();

    const displayRows = searchTerm ? buildCompanySummaryRows(sortedRows, months) : sortedRows;
    renderedMatrixRows = displayRows;
    renderCustomerStatementBar(filteredRows);

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
        renderCustomerStatementBar([]);
        if (els.matrixTotalsWrap) els.matrixTotalsWrap.innerHTML = '<div class="empty-panel">No billed totals returned.</div>';
        els.matrixTableWrap.innerHTML = '<div class="empty-panel">No month-to-month billing rows returned.</div>';
        return;
    }

    if (searchTerm && !filteredRows.length) {
        if (els.matrixTotalsWrap) els.matrixTotalsWrap.innerHTML = '<div class="empty-panel">No billed totals for this search.</div>';
        els.matrixTableWrap.innerHTML = `<div class="empty-panel">No billing rows matched "${escapeHtml(els.matrixSearchInput.value.trim())}".</div>`;
        return;
    }

    const monthTotals = months.map((monthKey) => {
        const authoritativeTotal = payloadMatchesCurrentSearch
            ? totals.find((entry) => entry.month_key === monthKey)
            : null;
        const amount = authoritativeTotal
            ? Number(authoritativeTotal.amount_total || 0)
            : filteredRows.reduce((sum, row) => sum + Number(row.months?.[monthKey]?.amount_total || 0), 0);
        return {
            monthKey,
            label: authoritativeTotal?.month_label_short || formatMonthLabel(monthKey, monthKey),
            amount,
            title: authoritativeTotal ? 'Full matched billing total' : 'Loaded row subtotal'
        };
    });
    unbilledProjectionData = buildUnbilledProjectionData(payload, filteredRows);
    unbilledProjectionDetailMap = unbilledProjectionData.detailsByMonth;
    const unbilledTotals = unbilledProjectionData.monthTotals;

    if (els.matrixTotalsWrap) {
        els.matrixTotalsWrap.innerHTML = `
            <div class="matrix-total-strip-head">
                <span>Billed Totals</span>
                <small>Actual saved invoice amounts per billing month</small>
            </div>
            <div class="matrix-total-cards">
                ${monthTotals.map((total) => `
                    <article class="matrix-total-card" title="${escapeHtml(total.title)}">
                        <span>${escapeHtml(total.label)}</span>
                        <strong>${escapeHtml(formatAmount(total.amount))}</strong>
                    </article>
                `).join('')}
            </div>
            <div class="matrix-total-strip-head secondary">
                <span>Unbilled Projection</span>
                <small>Projected from pending customers using contract quota or fixed monthly rate</small>
            </div>
            <div class="matrix-total-cards unbilled-total-cards">
                ${unbilledTotals.map((total) => `
                    <button
                        class="matrix-total-card unbilled-total-card"
                        type="button"
                        data-unbilled-month-key="${escapeHtml(total.monthKey)}"
                        title="Open unbilled customers for ${escapeHtml(total.label)}"
                    >
                        <span>${escapeHtml(total.label)}</span>
                        <strong>${escapeHtml(formatAmount(total.amount))}</strong>
                        <small>${escapeHtml(formatMetricCount(total.customerCount, 'customer'))} • ${escapeHtml(formatMetricCount(total.rowCount, 'machine row'))}</small>
                    </button>
                `).join('')}
            </div>
        `;
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
                    : `No invoice yet • ${formatCount(cell.reading_task_count || 0)} meter form • ${formatCount(cell.reading_pages_total || 0)} pg${pendingMeta}`;
                return `
                    <td class="month-cell billed-cell ${!hasInvoiceAmount && hasReadingBreakdown ? 'meter-cell' : ''} ${isSelected ? 'selected-cell' : ''}" title="${escapeHtml(hasInvoiceAmount ? receiptLabel(cell.receipt_status) : 'Meter reading amount - no invoice yet')}">
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
                    ${row.is_summary_row && row.billing_group ? '<div class="customer-badge-line"><span class="grouped-invoice-badge">Grouped Invoice</span></div>' : ''}
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

    const footer = monthTotals.map((total) => `
        <td class="total-cell" title="${escapeHtml(total.title)}">
            <span class="total-cell-label">Billed Total</span>
            <strong>${escapeHtml(formatAmount(total.amount))}</strong>
        </td>
    `).join('');

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
                    <th class="matrix-total-label" colspan="4">Billed Total</th>
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

async function makeSerialBillingAccountInactive(rowId, button = null) {
    const row = renderedMatrixRows.find((entry) => String(entry.row_id || entry.company_id) === String(rowId))
        || (lastPayload?.month_matrix?.rows || []).find((entry) => String(entry.row_id || entry.company_id) === String(rowId));
    if (!row || row.is_summary_row) {
        MargaUtils.showToast('Billing account row is no longer loaded.', 'error');
        return;
    }

    const label = [
        row.serial_number || row.machine_label || row.machine_id,
        row.company_name || row.account_name,
        row.branch_name
    ].filter(Boolean).join(' - ');
    const confirmed = window.confirm(`Make ${label || 'this account'} inactive for Billing? It will be hidden from active Billing lists until restored from Saved Billing Exclusions.`);
    if (!confirmed) return;

    if (button) button.disabled = true;
    try {
        const result = await saveBillingExclusion(row, {
            reason: 'Branch/customer inactive',
            effectiveDate: formatIsoDate(new Date()),
            staffNote: 'Marked inactive from serial detail popup.',
            hideFromFuture: true
        });
        MargaUtils.showToast(
            result.queued ? 'Billing inactive change queued.' : 'Billing account marked inactive.',
            'success'
        );
        closeSerialDetailModal();
        await loadDashboard({ forceRefresh: true });
    } catch (error) {
        if (button) button.disabled = false;
        MargaUtils.showToast(String(error?.message || 'Unable to mark billing account inactive.'), 'error');
    }
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
            <button
                class="btn btn-danger"
                type="button"
                data-serial-inactive-row-id="${escapeHtml(String(rowId))}"
            >Make Inactive For Billing</button>
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

function getRenderedMatrixCell(rowId, monthKey) {
    const row = renderedMatrixRows.find((entry) => String(entry.row_id || entry.company_id) === String(rowId))
        || (lastPayload?.month_matrix?.rows || []).find((entry) => String(entry.row_id || entry.company_id) === String(rowId));
    return {
        row,
        cell: row?.months?.[monthKey] || null
    };
}

async function openInvoiceDetailModal(rowId, monthKey) {
    if (!lastPayload) return;

    const { row, cell } = getRenderedMatrixCell(rowId, monthKey);
    if (!row || !cell || !(cell.billed || Number(cell.display_amount_total || 0) > 0)) return;

    const title = row.display_name || row.account_name || row.company_name || 'Billing Detail';
    const readingDay = row.is_summary_row ? 'Company subtotal' : (row.reading_day ? `RD ${row.reading_day}` : 'RD -');
    const invoiceGroups = Array.isArray(cell.invoice_groups) ? cell.invoice_groups : [];
    const readingGroups = Array.isArray(cell.reading_groups) ? cell.reading_groups : [];
    const shownAmount = Number(cell.display_amount_total || cell.amount_total || 0);
    const hasInvoiceAmount = Number(cell.amount_total || 0) > 0;
    const primaryInvoice = invoiceGroups[0] || null;
    const primaryInvoiceRef = String(primaryInvoice?.invoice_no || primaryInvoice?.invoice_ref || primaryInvoice?.invoice_id || '').trim();
    const canManageBilling = hasInvoiceAmount && !row.is_summary_row && Boolean(row?.contractmain_id);
    const requestToken = ++invoiceDetailRequestToken;

    els.invoiceDetailTitle.textContent = title;
    els.invoiceDetailSubtitle.textContent = `${monthKey} • ${readingDay} • ${hasInvoiceAmount ? receiptLabel(cell.receipt_status) : 'Meter amount - no invoice yet'}`;
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
        <div class="detail-action-row">
            <button class="btn btn-primary" type="button" data-branch-billing-statement-row-id="${escapeHtml(String(rowId))}">Branch Billing Statement</button>
        </div>
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
                ? `<div class="detail-empty">This row has meter-reading data, but no saved invoice amount for this month yet.</div>`
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
        openBillingCalcModalSafely(rowId, monthKey);
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

function getScorecardPaymentValue(payment, keys) {
    for (const key of keys) {
        const value = payment?.[key];
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
}

function getNullableScorecardNumber(payment, keys) {
    const value = getScorecardPaymentValue(payment, keys);
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

async function fetchFirestoreCollectionRows(collection, { pageSize = 1000, maxPages = 260, fieldMask = [] } = {}) {
    const rows = [];
    let pageToken = null;
    let page = 0;
    do {
        const params = new URLSearchParams({
            key: FIREBASE_CONFIG.apiKey,
            pageSize: String(pageSize)
        });
        if (pageToken) params.set('pageToken', pageToken);
        fieldMask.forEach((field) => params.append('mask.fieldPaths', field));
        const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to load ${collection}.`);
        (payload.documents || []).forEach((doc) => {
            const parsed = MargaUtils.parseFirestoreDoc(doc);
            if (parsed) rows.push(parsed);
        });
        pageToken = payload.nextPageToken || null;
        page += 1;
    } while (pageToken && page < maxPages);
    return rows;
}

async function loadBillingScorecardPayments() {
    if (billingScorecardPaymentEntries.length) return billingScorecardPaymentEntries;
    if (billingScorecardPaymentPromise) return billingScorecardPaymentPromise;

    billingScorecardPaymentPromise = fetchFirestoreCollectionRows('tbl_paymentinfo', {
        fieldMask: [
            'id', 'invoice_id', 'invoice_num', 'client', 'category', 'invoice_amt', 'invoice_date',
            'printed_or', 'payment_amt', 'balance_amt', 'date_deposit', 'date_paid', 'tax_date_paid',
            'ornum', 'or_number', 'payment_type', 'payment_status', 'iscancel'
        ],
        maxPages: 260
    }).then((docs) => {
        const seen = new Set();
        billingScorecardPaymentEntries = docs.map((doc) => {
            const amount = Number(getScorecardPaymentValue(doc, ['payment_amt', 'paymentAmount', 'amount']) || 0) || 0;
            const paymentStatus = String(getScorecardPaymentValue(doc, ['payment_status', 'paymentStatus']) || '').trim();
            const isCancelled = Boolean(Number(getScorecardPaymentValue(doc, ['iscancel', 'isCancel']) || 0)) || /^cancel/i.test(paymentStatus);
            const paymentDate = asValidDate(getScorecardPaymentValue(doc, ['date_deposit', 'dateDeposit', 'date_paid', 'datePaid', 'tax_date_paid', 'taxDatePaid']));
            if (isCancelled || amount <= 0 || !paymentDate) return null;
            const invoiceId = String(getScorecardPaymentValue(doc, ['invoice_id', 'invoiceId']) || '').trim();
            const invoiceNo = String(getScorecardPaymentValue(doc, ['invoice_num', 'invoiceNo']) || '').trim();
            const orNumber = String(getScorecardPaymentValue(doc, ['ornum', 'or_number', 'orNumber', 'printed_or', 'printedOr']) || '').trim();
            const token = [invoiceId, invoiceNo, amount.toFixed(2), formatIsoDate(paymentDate), orNumber].join('|');
            if (seen.has(token)) return null;
            seen.add(token);
            return {
                docId: doc._docId || '',
                invoiceId,
                invoiceNo,
                client: String(getScorecardPaymentValue(doc, ['client']) || '').trim(),
                category: String(getScorecardPaymentValue(doc, ['category']) || '').trim(),
                invoiceAmount: Number(getScorecardPaymentValue(doc, ['invoice_amt', 'invoiceAmount']) || 0) || 0,
                invoiceDate: asValidDate(getScorecardPaymentValue(doc, ['invoice_date', 'invoiceDate'])),
                amount,
                balanceAmount: getNullableScorecardNumber(doc, ['balance_amt', 'balanceAmount']),
                paymentDate,
                datePaid: asValidDate(getScorecardPaymentValue(doc, ['date_paid', 'datePaid'])) || paymentDate,
                orNumber,
                printedOr: String(getScorecardPaymentValue(doc, ['printed_or', 'printedOr']) || '').trim(),
                paymentType: String(getScorecardPaymentValue(doc, ['payment_type', 'paymentType']) || '').trim(),
                paymentStatus
            };
        }).filter(Boolean);
        return billingScorecardPaymentEntries;
    }).finally(() => {
        billingScorecardPaymentPromise = null;
    });

    return billingScorecardPaymentPromise;
}

function getBillingScorecardPendingProjection(cell, row) {
    if (!cell || !cell.pending) return 0;
    const readingAmount = Number(cell.reading_amount_total || 0);
    if (readingAmount > 0) return readingAmount;
    const displayAmount = Number(cell.display_amount_total || 0);
    const invoiceAmount = Number(cell.amount_total || 0);
    if (displayAmount > 0 && invoiceAmount <= 0) return displayAmount;

    const profile = row?.billing_profile || {};
    const monthlyRate = Number(profile.monthly_rate || 0) || 0;
    const monthlyRate2 = Number(profile.monthly_rate2 || 0) || 0;
    const monthlyQuota = Number(profile.monthly_quota || 0) || 0;
    const monthlyQuota2 = Number(profile.monthly_quota2 || 0) || 0;
    const pageRate = Number(profile.page_rate || 0) || 0;
    const pageRate2 = Number(profile.page_rate2 || profile.page_rate_xtra || 0) || 0;
    const quotaAmount = monthlyQuota > 0 && pageRate > 0 ? monthlyQuota * pageRate : 0;
    const quotaAmount2 = monthlyQuota2 > 0 && pageRate2 > 0 ? monthlyQuota2 * pageRate2 : 0;
    return Math.max(0, monthlyRate + monthlyRate2, quotaAmount + quotaAmount2);
}

function getBillingScorecardPendingReason(cell, row) {
    if (Number(cell?.reading_amount_total || 0) > 0) return 'Pending billing from actual meter-reading amount';
    if (Number(cell?.display_amount_total || 0) > 0 && Number(cell?.amount_total || 0) <= 0) return 'Pending billing from displayed meter-reading amount';
    const profile = row?.billing_profile || {};
    if (Number(profile.monthly_rate || 0) > 0 || Number(profile.monthly_rate2 || 0) > 0) return 'Pending billing from active fixed monthly rate';
    if ((Number(profile.monthly_quota || 0) > 0 && Number(profile.page_rate || 0) > 0)
        || (Number(profile.monthly_quota2 || 0) > 0 && Number(profile.page_rate2 || profile.page_rate_xtra || 0) > 0)) {
        return 'Pending billing from active contract quota and rate';
    }
    return 'Pending billing without peso estimate';
}

function getUnbilledCustomerKey(row) {
    return String(row?.company_id || row?.account_name || row?.company_name || row?.row_id || '').trim();
}

function makeUnbilledProjectionDetail({ row, cell, monthKey, amount }) {
    const profile = row?.billing_profile || {};
    return {
        rowId: String(row?.row_id || row?.company_id || '').trim(),
        companyId: String(row?.company_id || '').trim(),
        customerKey: getUnbilledCustomerKey(row),
        monthKey,
        monthLabel: cell?.month_label_short || formatMonthLabel(monthKey, monthKey),
        customer: row?.company_name || row?.account_name || row?.display_name || 'Unknown customer',
        branch: row?.branch_name || 'Main',
        serial: row?.serial_number || row?.machine_label || '-',
        contractId: String(row?.contractmain_id || '').trim(),
        machineId: String(row?.machine_id || '').trim(),
        amount: Number(amount || 0),
        reason: getBillingScorecardPendingReason(cell, row),
        monthlyRate: Number(profile.monthly_rate || 0) + Number(profile.monthly_rate2 || 0),
        quotaAmount: (
            (Number(profile.monthly_quota || 0) * Number(profile.page_rate || 0))
            + (Number(profile.monthly_quota2 || 0) * Number(profile.page_rate2 || profile.page_rate_xtra || 0))
        )
    };
}

function buildUnbilledProjectionData(payload, filteredRows = null) {
    const matrix = payload?.month_matrix || {};
    const months = Array.isArray(matrix.months) ? matrix.months : [];
    const sourceRows = Array.isArray(filteredRows)
        ? filteredRows
        : (Array.isArray(matrix.rows) ? matrix.rows : []);
    const rows = sourceRows.filter((row) => row && !row.is_summary_row && !row.isGroupedChild);
    const monthTotals = months.map((monthKey) => ({
        monthKey,
        label: formatMonthLabel(monthKey, monthKey),
        amount: 0,
        customerCount: 0,
        rowCount: 0
    }));
    const detailsByMonth = new Map();
    const detailsByCustomer = new Map();

    months.forEach((monthKey) => {
        detailsByMonth.set(monthKey, []);
    });

    rows.forEach((row) => {
        months.forEach((monthKey) => {
            const cell = row.months?.[monthKey];
            if (!cell?.pending) return;
            const amount = getBillingScorecardPendingProjection(cell, row);
            const detail = makeUnbilledProjectionDetail({ row, cell, monthKey, amount });
            detailsByMonth.get(monthKey)?.push(detail);
            const customerKey = detail.customerKey || detail.rowId;
            if (!detailsByCustomer.has(customerKey)) detailsByCustomer.set(customerKey, []);
            detailsByCustomer.get(customerKey).push(detail);
            const total = monthTotals.find((entry) => entry.monthKey === monthKey);
            if (total) {
                total.amount += amount;
                total.rowCount += 1;
            }
        });
    });

    monthTotals.forEach((total) => {
        const uniqueCustomers = new Set((detailsByMonth.get(total.monthKey) || []).map((detail) => detail.customerKey || detail.rowId));
        total.customerCount = uniqueCustomers.size;
        total.amount = Number(total.amount.toFixed(2));
    });

    return { months, monthTotals, detailsByMonth, detailsByCustomer };
}

function groupUnbilledDetailsByCustomer(details = []) {
    const groups = new Map();
    details.forEach((detail) => {
        const key = detail.customerKey || detail.rowId || `${detail.customer}:${detail.branch}`;
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                customer: detail.customer,
                branchNames: new Set(),
                serials: new Set(),
                amount: 0,
                rowCount: 0,
                months: new Set(),
                details: []
            });
        }
        const group = groups.get(key);
        group.branchNames.add(detail.branch);
        group.serials.add(detail.serial);
        group.months.add(detail.monthKey);
        group.amount += Number(detail.amount || 0);
        group.rowCount += 1;
        group.details.push(detail);
    });
    return Array.from(groups.values())
        .map((group) => ({
            ...group,
            amount: Number(group.amount.toFixed(2)),
            branchNames: Array.from(group.branchNames).filter(Boolean),
            serials: Array.from(group.serials).filter(Boolean),
            months: Array.from(group.months).sort()
        }))
        .sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0) || String(left.customer || '').localeCompare(String(right.customer || '')));
}

function renderUnbilledCustomerRows(groups = []) {
    if (!groups.length) {
        return '<div class="detail-empty">No unbilled customers found for this month.</div>';
    }
    return `
        <div class="unbilled-detail-list">
            ${groups.map((group) => `
                <article
                    class="unbilled-customer-card"
                >
                    <span>
                        <strong>${escapeHtml(group.customer)}</strong>
                        <small>${escapeHtml(group.branchNames.slice(0, 3).join(', ') || 'Branch not mapped')}${group.branchNames.length > 3 ? ` +${formatCount(group.branchNames.length - 3)} more` : ''}</small>
                    </span>
                    <span class="unbilled-card-meta">
                        <strong>${escapeHtml(formatAmount(group.amount))}</strong>
                        <small>${escapeHtml(formatMetricCount(group.months.length, 'month'))} • ${escapeHtml(formatMetricCount(group.rowCount, 'machine row'))}</small>
                        <span class="unbilled-card-actions">
                            <button class="btn btn-secondary btn-sm" type="button" data-unbilled-customer-key="${escapeHtml(group.key)}">Review</button>
                            <button
                                class="btn btn-danger btn-sm"
                                type="button"
                                data-unbilled-inactivate-customer="${escapeHtml(group.key)}"
                                data-unbilled-inactivate-month="${escapeHtml(activeUnbilledProjectionMonthKey || group.months[0] || '')}"
                            >Hide</button>
                        </span>
                    </span>
                </article>
            `).join('')}
        </div>
    `;
}

function findUnbilledActionRow(monthDetails = [], monthKey = '') {
    const companyId = String(monthDetails[0]?.companyId || '').trim();
    if (companyId && Array.isArray(lastPayload?.month_matrix?.rows)) {
        const summaryRow = lastPayload.month_matrix.rows.find((row) => (
            row?.is_summary_row
            && row?.billing_group
            && String(row.company_id || '').trim() === companyId
            && row.months?.[monthKey]?.pending
        ));
        if (summaryRow) {
            return {
                rowId: String(summaryRow.row_id || summaryRow.company_id || '').trim(),
                isSummary: true
            };
        }
    }
    const primary = monthDetails.find((detail) => detail.rowId) || monthDetails[0] || null;
    return {
        rowId: String(primary?.rowId || '').trim(),
        isSummary: false
    };
}

function openUnbilledProjectionMonth(monthKey) {
    activeUnbilledProjectionMonthKey = String(monthKey || '').trim();
    const details = unbilledProjectionDetailMap.get(monthKey) || [];
    const groups = groupUnbilledDetailsByCustomer(details);
    const total = details.reduce((sum, detail) => sum + Number(detail.amount || 0), 0);
    if (els.billingScorecardTitle) els.billingScorecardTitle.textContent = 'Unbilled Customers';
    if (els.billingScorecardSubtitle) {
        els.billingScorecardSubtitle.textContent = `${formatMonthLabel(monthKey, monthKey)} • ${formatCount(groups.length)} customer(s) • projected ${formatCurrency(total)}`;
    }
    if (els.billingScorecardContent) {
        els.billingScorecardContent.innerHTML = `
            <div class="detail-empty">
                Projection uses actual meter-reading amount when present, otherwise the active contract quota or fixed monthly rate.
            </div>
            ${renderUnbilledCustomerRows(groups)}
        `;
    }
    els.billingScorecardModal?.classList.remove('hidden');
}

function renderUnbilledCustomerMonths(customerKey) {
    const details = (unbilledProjectionData?.detailsByCustomer?.get(customerKey) || [])
        .slice()
        .sort((left, right) => String(left.monthKey || '').localeCompare(String(right.monthKey || '')) || String(left.branch || '').localeCompare(String(right.branch || '')));
    if (!details.length) return '<div class="detail-empty">No unbilled months found for this customer.</div>';
    const groupedByMonth = new Map();
    details.forEach((detail) => {
        if (!groupedByMonth.has(detail.monthKey)) groupedByMonth.set(detail.monthKey, []);
        groupedByMonth.get(detail.monthKey).push(detail);
    });
    return `
        <div class="unbilled-month-list">
            ${Array.from(groupedByMonth.entries()).map(([monthKey, monthDetails]) => {
                const amount = monthDetails.reduce((sum, detail) => sum + Number(detail.amount || 0), 0);
                const actionRow = findUnbilledActionRow(monthDetails, monthKey);
                return `
                    <article class="unbilled-month-card">
                        <div>
                            <strong>${escapeHtml(formatMonthLabel(monthKey, monthKey))}</strong>
                            <small>${escapeHtml(formatMetricCount(monthDetails.length, 'machine row'))} • ${escapeHtml(monthDetails[0]?.reason || 'Pending billing')}</small>
                            <small>${escapeHtml(monthDetails.map((detail) => detail.branch).filter(Boolean).slice(0, 4).join(', ') || 'Branch not mapped')}</small>
                        </div>
                        <div class="unbilled-card-meta">
                            <strong>${escapeHtml(formatAmount(amount))}</strong>
                            <button
                                class="btn btn-primary btn-sm"
                                type="button"
                                data-unbilled-bill-now-row-id="${escapeHtml(actionRow.rowId || '')}"
                                data-unbilled-bill-now-month="${escapeHtml(monthKey)}"
                            >Bill Now</button>
                            <button
                                class="btn btn-danger btn-sm"
                                type="button"
                                data-unbilled-inactivate-customer="${escapeHtml(customerKey)}"
                                data-unbilled-inactivate-month="${escapeHtml(monthKey)}"
                            >Hide From Billing</button>
                        </div>
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

function openUnbilledCustomerMonths(customerKey) {
    const details = unbilledProjectionData?.detailsByCustomer?.get(customerKey) || [];
    const customer = details[0]?.customer || 'Unbilled Customer';
    const total = details.reduce((sum, detail) => sum + Number(detail.amount || 0), 0);
    if (els.billingScorecardTitle) els.billingScorecardTitle.textContent = customer;
    if (els.billingScorecardSubtitle) {
        els.billingScorecardSubtitle.textContent = `${formatCount(new Set(details.map((detail) => detail.monthKey)).size)} unbilled month(s) • projected ${formatCurrency(total)}`;
    }
    if (els.billingScorecardContent) {
        els.billingScorecardContent.innerHTML = `
            <div class="detail-action-row">
                <button class="btn btn-secondary" type="button" data-unbilled-back-month="${escapeHtml(activeUnbilledProjectionMonthKey || details[0]?.monthKey || '')}">Back to Month</button>
            </div>
            ${renderUnbilledCustomerMonths(customerKey)}
        `;
    }
}

function openUnbilledBillNow(rowId, monthKey) {
    if (!rowId || !monthKey) {
        MargaUtils.showToast('This unbilled row is missing billing context.', 'error');
        return;
    }
    closeBillingScorecardModal();
    openBillingCalcModalSafely(rowId, monthKey);
}

function findBillingRowByRowId(rowId) {
    const key = String(rowId || '').trim();
    if (!key || !Array.isArray(lastPayload?.month_matrix?.rows)) return null;
    return lastPayload.month_matrix.rows.find((row) => String(row?.row_id || row?.company_id || '').trim() === key) || null;
}

async function hideUnbilledProjectionCustomer(customerKey, monthKey, trigger = null) {
    const safeCustomerKey = String(customerKey || '').trim();
    const safeMonthKey = String(monthKey || activeUnbilledProjectionMonthKey || '').trim();
    const details = (unbilledProjectionData?.detailsByCustomer?.get(safeCustomerKey) || [])
        .filter((detail) => !safeMonthKey || detail.monthKey === safeMonthKey);
    const rows = [];
    const seen = new Set();
    details.forEach((detail) => {
        const row = findBillingRowByRowId(detail.rowId);
        const rowKey = String(row?.row_id || row?.contractmain_id || detail.rowId || '').trim();
        if (!row || !rowKey || seen.has(rowKey)) return;
        seen.add(rowKey);
        rows.push(row);
    });
    if (!rows.length) {
        MargaUtils.showToast('No billing rows were found to hide for this unbilled account.', 'error');
        return;
    }
    const customer = details[0]?.customer || rows[0]?.company_name || rows[0]?.account_name || 'this customer';
    const monthLabel = safeMonthKey ? formatMonthLabel(safeMonthKey, safeMonthKey) : 'the selected month';
    const confirmed = window.confirm(`Hide ${rows.length} unbilled billing row${rows.length === 1 ? '' : 's'} for ${customer} in ${monthLabel}? This removes them from Billing and Unbilled Projection without deleting customer records.`);
    if (!confirmed) return;
    if (trigger) trigger.disabled = true;
    try {
        const results = await Promise.allSettled(rows.map((row) => saveBillingExclusion(row, {
            reason: 'Branch/customer inactive',
            effectiveDate: formatIsoDate(new Date()),
            hideFromFuture: true,
            staffNote: `Hidden from Unbilled Projection for ${monthLabel}.`
        })));
        const savedCount = results.filter((result) => result.status === 'fulfilled').length;
        const failedCount = results.length - savedCount;
        renderDashboardBillingExclusions();
        MargaUtils.showToast(
            failedCount
                ? `Hidden ${formatCount(savedCount)} row(s); ${formatCount(failedCount)} failed.`
                : `Hidden ${formatCount(savedCount)} unbilled row(s) from Billing.`,
            failedCount ? 'warning' : 'success'
        );
        await loadDashboard({ forceRefresh: true });
        if (safeMonthKey) openUnbilledProjectionMonth(safeMonthKey);
    } catch (error) {
        MargaUtils.showToast(String(error?.message || 'Unable to hide unbilled account.'), 'error');
        if (trigger) trigger.disabled = false;
    }
}

function buildBillingScorecardPaymentMap(payments) {
    const map = new Map();
    const put = (key, payment) => {
        const safeKey = String(key || '').trim();
        if (!safeKey) return;
        if (!map.has(safeKey)) {
            map.set(safeKey, { amount: 0, latestBalanceAmount: null, latestBalanceDate: null, firstPaymentDate: null, lastPaymentDate: null, orNumbers: new Set(), payments: [] });
        }
        const summary = map.get(safeKey);
        summary.amount += Number(payment.amount || 0);
        if (payment.balanceAmount !== null && payment.balanceAmount !== undefined && Number.isFinite(Number(payment.balanceAmount))) {
            if (!summary.latestBalanceDate || !payment.paymentDate || payment.paymentDate >= summary.latestBalanceDate) {
                summary.latestBalanceAmount = Number(payment.balanceAmount);
                summary.latestBalanceDate = payment.paymentDate || summary.latestBalanceDate;
            }
        }
        if (!summary.firstPaymentDate || payment.paymentDate < summary.firstPaymentDate) summary.firstPaymentDate = payment.paymentDate;
        if (!summary.lastPaymentDate || payment.paymentDate > summary.lastPaymentDate) summary.lastPaymentDate = payment.paymentDate;
        if (payment.orNumber || payment.printedOr) summary.orNumbers.add(payment.orNumber || payment.printedOr);
        summary.payments.push(payment);
    };
    payments.forEach((payment) => {
        put(payment.invoiceId, payment);
        put(payment.invoiceNo, payment);
    });
    return map;
}

function getBillingScorecardPaymentSummary(paymentMap, ...keys) {
    const summary = keys.map((key) => paymentMap.get(String(key || '').trim())).find(Boolean);
    return summary || { amount: 0, latestBalanceAmount: null, latestBalanceDate: null, firstPaymentDate: null, lastPaymentDate: null, orNumbers: new Set(), payments: [] };
}

function computeVatSplit(amount) {
    const total = Number(amount || 0);
    const net = total / 1.12;
    return {
        net: Number(net.toFixed(2)),
        vat: Number((total - net).toFixed(2))
    };
}

function getBillingStatementRows(sourceRows = [], paymentMap = new Map(), unpaidOnly = false) {
    const months = Array.isArray(lastPayload?.month_matrix?.months) ? lastPayload.month_matrix.months : [];
    const rowsByInvoice = new Map();
    sourceRows.forEach((row) => {
        months.forEach((monthKey) => {
            const cell = row.months?.[monthKey] || {};
            const amountTotal = Number(cell.amount_total || 0);
            if (amountTotal <= 0) return;
            const invoiceGroups = Array.isArray(cell.invoice_groups) && cell.invoice_groups.length
                ? cell.invoice_groups
                : [{ invoice_no: '-', amount_total: amountTotal, machine_count: cell.machine_count || 1 }];
            invoiceGroups.forEach((group, index) => {
                const amount = Number(group.amount_total || amountTotal || 0);
                if (amount <= 0) return;
                const invoiceNo = String(group.invoice_no || group.invoice_ref || group.invoice_id || '').trim();
                const key = [invoiceNo || `${row.row_id}:${index}`, monthKey, group.invoice_id || ''].join('|');
                if (rowsByInvoice.has(key)) return;
                const paymentSummary = getBillingScorecardPaymentSummary(paymentMap, group.invoice_id, group.invoice_no, group.invoice_ref, invoiceNo);
                const latestBalance = paymentSummary.latestBalanceAmount !== null && paymentSummary.latestBalanceAmount !== undefined
                    ? Math.min(Math.max(0, Number(paymentSummary.latestBalanceAmount || 0)), amount)
                    : null;
                const paidFallback = Math.min(Number(paymentSummary.amount || 0), amount);
                const balance = latestBalance !== null ? latestBalance : Math.max(0, amount - paidFallback);
                if (unpaidOnly && balance <= 0.01) return;
                const paid = Math.max(0, amount - balance);
                const vat = computeVatSplit(amount);
                rowsByInvoice.set(key, {
                    monthKey,
                    monthLabel: formatMonthLabel(monthKey, monthKey),
                    customer: row.company_name || row.account_name || 'Customer',
                    branch: row.branch_name || 'Main',
                    machine: row.machine_label || row.serial_number || row.machine_id || '-',
                    serial: row.serial_number || '-',
                    invoiceId: String(group.invoice_id || '').trim(),
                    invoiceNo: invoiceNo || '-',
                    invoiceDate: group.invoice_date || cell.latest_invoice_date || '',
                    amount,
                    net: vat.net,
                    vat: vat.vat,
                    paid,
                    balance,
                    orNumbers: Array.from(paymentSummary.orNumbers || []).filter(Boolean).join(', ')
                });
            });
        });
    });
    return Array.from(rowsByInvoice.values()).sort((left, right) => (
        String(left.branch || '').localeCompare(String(right.branch || ''))
        || String(left.monthKey || '').localeCompare(String(right.monthKey || ''))
        || String(left.invoiceNo || '').localeCompare(String(right.invoiceNo || ''))
    ));
}

async function loadBillingStatementDocsForSourceRows(sourceRows = []) {
    const months = new Set(Array.isArray(lastPayload?.month_matrix?.months) ? lastPayload.month_matrix.months : []);
    const fieldMask = [
        'id', 'invoice_id', 'invoiceid', 'invoiceno', 'invoice_no', 'contractmain_id', 'machine_id', 'mach_id',
        'month', 'year', 'due_date', 'dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex',
        'amount', 'totalamount', 'vatamount', 'amount2', 'totalamount2', 'vatamount2', 'netamount',
        'company_name', 'branch_name', 'serial_number', 'machine_label', 'printer_model'
    ];
    const contractValues = uniqueNonBlankValues(sourceRows.flatMap((row) => {
        const raw = String(row.contractmain_id || '').trim();
        if (!raw) return [];
        const values = [raw];
        if (/^\d+$/.test(raw)) values.push(Number(raw));
        return values;
    }));
    const customerNames = uniqueNonBlankValues(sourceRows.flatMap((row) => [
        row.company_name,
        row.account_name
    ]));
    const [byContract, byCompany] = await Promise.all([
        contractValues.length ? queryFirestoreIn('tbl_billing', 'contractmain_id', contractValues, { select: fieldMask }) : Promise.resolve([]),
        customerNames.length ? queryFirestoreIn('tbl_billing', 'company_name', customerNames, { select: fieldMask }) : Promise.resolve([])
    ]);
    const byDocId = new Map();
    [...byContract, ...byCompany].forEach((doc) => {
        const key = String(doc?._docId || '').trim();
        const invoiceRef = getBillingDocInvoiceRef(doc);
        const monthKey = getBillingDocMonthKey(doc);
        if (!key || !invoiceRef || (months.size && !months.has(monthKey))) return;
        if (!byDocId.has(key)) byDocId.set(key, doc);
    });
    return Array.from(byDocId.values());
}

function findStatementSourceRowForDoc(doc, sourceRows = []) {
    const contractId = String(doc?.contractmain_id || '').trim();
    if (contractId) {
        const contractMatch = sourceRows.find((row) => String(row.contractmain_id || '').trim() === contractId);
        if (contractMatch) return contractMatch;
    }
    const machineId = String(doc?.machine_id || doc?.mach_id || '').trim();
    if (machineId) {
        const machineMatch = sourceRows.find((row) => String(row.machine_id || '').trim() === machineId);
        if (machineMatch) return machineMatch;
    }
    const branchName = String(doc?.branch_name || '').trim().toLowerCase();
    if (branchName) {
        const branchMatch = sourceRows.find((row) => String(row.branch_name || '').trim().toLowerCase() === branchName);
        if (branchMatch) return branchMatch;
    }
    return sourceRows[0] || null;
}

function getBillingStatementRowsFromDocs(docs = [], sourceRows = [], paymentMap = new Map(), unpaidOnly = false) {
    const rowsByInvoice = new Map();
    docs.forEach((doc) => {
        const invoiceNo = getBillingDocInvoiceRef(doc);
        if (!invoiceNo) return;
        const amount = getBillingDocAmount(doc);
        if (amount <= 0) return;
        const monthKey = getBillingDocMonthKey(doc);
        const sourceRow = findStatementSourceRowForDoc(doc, sourceRows) || {};
        const paymentSummary = getBillingScorecardPaymentSummary(paymentMap, doc.invoice_id, doc.invoiceid, invoiceNo);
        const latestBalance = paymentSummary.latestBalanceAmount !== null && paymentSummary.latestBalanceAmount !== undefined
            ? Math.min(Math.max(0, Number(paymentSummary.latestBalanceAmount || 0)), amount)
            : null;
        const paidFallback = Math.min(Number(paymentSummary.amount || 0), amount);
        const balance = latestBalance !== null ? latestBalance : Math.max(0, amount - paidFallback);
        if (unpaidOnly && balance <= 0.01) return;
        const vatSplit = getBillingDocNetVat(doc, sourceRow?.billing_profile || {});
        const key = [invoiceNo, monthKey, doc._docId || ''].join('|');
        if (rowsByInvoice.has(key)) return;
        rowsByInvoice.set(key, {
            monthKey,
            monthLabel: formatMonthLabel(monthKey, monthKey),
            customer: doc.company_name || sourceRow.company_name || sourceRow.account_name || 'Customer',
            branch: doc.branch_name || sourceRow.branch_name || 'Main',
            machine: doc.machine_label || doc.printer_model || sourceRow.machine_label || doc.serial_number || sourceRow.serial_number || doc.machine_id || sourceRow.machine_id || '-',
            serial: doc.serial_number || sourceRow.serial_number || '-',
            invoiceId: String(doc.invoice_id || doc.invoiceid || '').trim(),
            invoiceNo,
            invoiceDate: doc.invoice_date || doc.invdate || doc.dateprinted || doc.date_printed || doc.datex || '',
            amount,
            net: Number(vatSplit.netAmount || 0),
            vat: Number(vatSplit.vatAmount || 0),
            paid: Math.max(0, amount - balance),
            balance,
            orNumbers: Array.from(paymentSummary.orNumbers || []).filter(Boolean).join(', ')
        });
    });
    return Array.from(rowsByInvoice.values()).sort((left, right) => (
        String(left.branch || '').localeCompare(String(right.branch || ''))
        || String(left.monthKey || '').localeCompare(String(right.monthKey || ''))
        || String(left.invoiceNo || '').localeCompare(String(right.invoiceNo || ''))
    ));
}

function summarizeStatementRows(rows = []) {
    return rows.reduce((summary, row) => {
        summary.amount += Number(row.amount || 0);
        summary.net += Number(row.net || 0);
        summary.vat += Number(row.vat || 0);
        return summary;
    }, { amount: 0, net: 0, vat: 0 });
}

function mapStatementPaymentDocs(docs = []) {
    const seen = new Set();
    return docs.map((doc) => {
        const amount = Number(getScorecardPaymentValue(doc, ['payment_amt', 'paymentAmount', 'amount']) || 0) || 0;
        const paymentStatus = String(getScorecardPaymentValue(doc, ['payment_status', 'paymentStatus']) || '').trim();
        const isCancelled = Boolean(Number(getScorecardPaymentValue(doc, ['iscancel', 'isCancel']) || 0)) || /^cancel/i.test(paymentStatus);
        const paymentDate = asValidDate(getScorecardPaymentValue(doc, ['date_deposit', 'dateDeposit', 'date_paid', 'datePaid', 'tax_date_paid', 'taxDatePaid']));
        if (isCancelled || amount <= 0 || !paymentDate) return null;
        const invoiceId = String(getScorecardPaymentValue(doc, ['invoice_id', 'invoiceId']) || '').trim();
        const invoiceNo = String(getScorecardPaymentValue(doc, ['invoice_num', 'invoiceNo']) || '').trim();
        const orNumber = String(getScorecardPaymentValue(doc, ['ornum', 'or_number', 'orNumber', 'printed_or', 'printedOr']) || '').trim();
        const token = [invoiceId, invoiceNo, amount.toFixed(2), formatIsoDate(paymentDate), orNumber].join('|');
        if (seen.has(token)) return null;
        seen.add(token);
        return {
            docId: doc._docId || '',
            invoiceId,
            invoiceNo,
            amount,
            balanceAmount: getNullableScorecardNumber(doc, ['balance_amt', 'balanceAmount']),
            paymentDate,
            orNumber,
            printedOr: String(getScorecardPaymentValue(doc, ['printed_or', 'printedOr']) || '').trim(),
            paymentStatus
        };
    }).filter(Boolean);
}

async function loadBillingStatementPaymentsForRows(statementRows = []) {
    const fieldMask = [
        'id', 'invoice_id', 'invoice_num', 'payment_amt', 'balance_amt', 'date_deposit', 'date_paid',
        'tax_date_paid', 'ornum', 'or_number', 'printed_or', 'payment_status', 'iscancel'
    ];
    const invoiceNos = uniqueNonBlankValues(statementRows.map((row) => row.invoiceNo).filter((value) => value && value !== '-'));
    const invoiceIds = uniqueNonBlankValues(statementRows.flatMap((row) => {
        const raw = String(row.invoiceId || '').trim();
        if (!raw) return [];
        const values = [raw];
        if (/^\d+$/.test(raw)) values.push(Number(raw));
        return values;
    }));
    const [byInvoiceNo, byInvoiceId] = await Promise.all([
        invoiceNos.length ? queryFirestoreIn('tbl_paymentinfo', 'invoice_num', invoiceNos, { select: fieldMask }) : Promise.resolve([]),
        invoiceIds.length ? queryFirestoreIn('tbl_paymentinfo', 'invoice_id', invoiceIds, { select: fieldMask }) : Promise.resolve([])
    ]);
    const byDocId = new Map();
    [...byInvoiceNo, ...byInvoiceId].forEach((doc) => {
        const key = String(doc?._docId || '').trim();
        if (key && !byDocId.has(key)) byDocId.set(key, doc);
    });
    return mapStatementPaymentDocs(Array.from(byDocId.values()));
}

function buildStatementPreviewRows(rows = []) {
    if (!rows.length) return '<div class="detail-empty">No invoice rows found for this statement.</div>';
    return `
        <div class="billing-scorecard-detail-wrap statement-preview-wrap">
            <table class="billing-sheet billing-scorecard-detail-table statement-preview-table">
                <thead>
                    <tr>
                        <th>Branch / Dept</th>
                        <th>Machine / Serial</th>
                        <th>Invoice #</th>
                        <th>Billing Period</th>
                        <th class="text-right">Amount</th>
                        <th class="text-right">Net of VAT</th>
                        <th class="text-right">VAT</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td>${escapeHtml(row.branch || 'Main')}</td>
                            <td>
                                <strong>${escapeHtml(row.machine || '-')}</strong>
                                <small>${escapeHtml(row.serial || '-')}</small>
                            </td>
                            <td><strong>${escapeHtml(row.invoiceNo || '-')}</strong></td>
                            <td>${escapeHtml(row.monthLabel || row.monthKey || '-')}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(row.amount || 0))}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(row.net || 0))}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(row.vat || 0))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function buildBillingStatementPrintDocument(statement) {
    const rows = Array.isArray(statement?.rows) ? statement.rows : [];
    const totals = summarizeStatementRows(rows);
    const title = statement?.title || 'Customer Billing Statement';
    const scopeLabel = statement?.scopeLabel || '';
    const generatedAt = new Date().toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
        @page { size: A4 landscape; margin: 9mm; }
        body { font-family: Arial, sans-serif; color: #111827; font-size: 10px; }
        h1 { margin: 0 0 4px; font-size: 18px; letter-spacing: 0.02em; text-transform: uppercase; }
        .head { display: flex; justify-content: space-between; gap: 18px; border-bottom: 2px solid #111827; padding-bottom: 8px; margin-bottom: 10px; }
        .muted { color: #4b5563; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #9ca3af; padding: 4px 5px; vertical-align: top; }
        th { background: #eef2f7; text-align: left; font-size: 9px; text-transform: uppercase; }
        .num { text-align: right; white-space: nowrap; }
        .totals { margin-left: auto; margin-top: 10px; width: 360px; }
        .totals td { font-weight: 700; }
        .receive { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-top: 18px; font-size: 10px; }
        .line { border-top: 1px solid #111827; padding-top: 4px; text-align: center; min-height: 22px; }
        .small { display: block; color: #4b5563; font-size: 9px; }
    </style>
</head>
<body>
    <div class="head">
        <div>
            <h1>${escapeHtml(title)}</h1>
            <div class="muted">Marga Enterprises</div>
            <div>${escapeHtml(scopeLabel)}</div>
        </div>
        <div>
            <div><strong>Generated:</strong> ${escapeHtml(generatedAt)}</div>
            <div><strong>Rows:</strong> ${escapeHtml(formatCount(rows.length))}</div>
            <div><strong>Mode:</strong> Unpaid invoices</div>
        </div>
    </div>
    <table>
        <thead>
            <tr>
                <th>Branch / Dept</th>
                <th>Machine / Serial</th>
                <th>Invoice #</th>
                <th>Billing Period</th>
                <th class="num">Amount</th>
                <th class="num">Net of VAT</th>
                <th class="num">VAT</th>
            </tr>
        </thead>
        <tbody>
            ${rows.map((row) => `
                <tr>
                    <td>${escapeHtml(row.branch || 'Main')}</td>
                    <td>${escapeHtml(row.machine || '-')}<span class="small">${escapeHtml(row.serial || '-')}</span></td>
                    <td>${escapeHtml(row.invoiceNo || '-')}</td>
                    <td>${escapeHtml(row.monthLabel || row.monthKey || '-')}</td>
                    <td class="num">${escapeHtml(formatFixedAmount(row.amount || 0))}</td>
                    <td class="num">${escapeHtml(formatFixedAmount(row.net || 0))}</td>
                    <td class="num">${escapeHtml(formatFixedAmount(row.vat || 0))}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    <table class="totals">
        <tbody>
            <tr><td>Total Invoice Amount</td><td class="num">${escapeHtml(formatFixedAmount(totals.amount))}</td></tr>
            <tr><td>Total Net of VAT</td><td class="num">${escapeHtml(formatFixedAmount(totals.net))}</td></tr>
            <tr><td>Total VAT</td><td class="num">${escapeHtml(formatFixedAmount(totals.vat))}</td></tr>
        </tbody>
    </table>
    <div class="receive">
        <div class="line">Prepared By</div>
        <div class="line">Checked By</div>
        <div class="line">Received By / Date</div>
    </div>
</body>
</html>`;
}

async function openBillingStatement(options = {}) {
    const scope = String(options.scope || 'customer');
    const unpaidOnly = true;
    let sourceRows = [];
    let title = scope === 'branch' ? 'Branch Billing Statement' : 'Customer Billing Statement';
    let scopeLabel = '';

    if (scope === 'branch') {
        const base = findBillingRowByRowId(options.rowId);
        if (!base) {
            MargaUtils.showToast('Branch statement row is no longer loaded.', 'error');
            return;
        }
        const branchKey = statementBranchKey(base);
        sourceRows = getStatementSourceRows().filter((row) => statementBranchKey(row) === branchKey);
        scopeLabel = `${base.company_name || base.account_name || 'Customer'} - ${base.branch_name || 'Main'}`;
    } else {
        const key = String(options.customerKey || '').trim().toLowerCase();
        sourceRows = getStatementSourceRows().filter((row) => statementCustomerKey(row) === key);
        const context = getCustomerStatementContext(sourceRows);
        scopeLabel = context?.customer || sourceRows[0]?.company_name || sourceRows[0]?.account_name || 'Customer';
    }

    if (!sourceRows.length) {
        MargaUtils.showToast('No billing rows are loaded for this statement.', 'error');
        return;
    }

    if (els.billingScorecardTitle) els.billingScorecardTitle.textContent = title;
    if (els.billingScorecardSubtitle) els.billingScorecardSubtitle.textContent = `${scopeLabel} - loading saved invoice rows...`;
    if (els.billingScorecardContent) els.billingScorecardContent.innerHTML = '<div class="detail-empty">Preparing billing statement...</div>';
    els.billingScorecardModal?.classList.remove('hidden');

    let billingDocs = [];
    try {
        billingDocs = await loadBillingStatementDocsForSourceRows(sourceRows);
    } catch (error) {
        console.warn('Unable to load saved billing docs for statement.', error);
        MargaUtils.showToast('Saved invoice rows could not load completely. Using loaded matrix rows only.', 'warning');
    }
    const preliminaryRows = billingDocs.length
        ? getBillingStatementRowsFromDocs(billingDocs, sourceRows, new Map(), false)
        : getBillingStatementRows(sourceRows, new Map(), false).filter((row) => row.invoiceNo && row.invoiceNo !== '-');
    let payments = [];
    try {
        payments = await loadBillingStatementPaymentsForRows(preliminaryRows);
    } catch (error) {
        console.warn('Unable to load payments for billing statement.', error);
        MargaUtils.showToast('Payment records could not load. Unpaid filtering may be incomplete.', 'warning');
    }
    const paymentMap = buildBillingScorecardPaymentMap(payments);
    const rows = billingDocs.length
        ? getBillingStatementRowsFromDocs(billingDocs, sourceRows, paymentMap, unpaidOnly)
        : getBillingStatementRows(sourceRows, paymentMap, unpaidOnly).filter((row) => row.invoiceNo && row.invoiceNo !== '-');
    const totals = summarizeStatementRows(rows);
    const statement = { title, scopeLabel, unpaidOnly, rows };
    if (els.billingScorecardTitle) els.billingScorecardTitle.textContent = title;
    if (els.billingScorecardSubtitle) {
        els.billingScorecardSubtitle.textContent = `${scopeLabel} - ${formatMetricCount(rows.length, 'invoice')} - ${formatCurrency(totals.amount)}`;
    }
    if (els.billingScorecardContent) {
        els.billingScorecardContent.innerHTML = `
            <div class="statement-toolbar">
                <div>
                    <strong>${escapeHtml(scopeLabel)}</strong>
                    <small>Unpaid invoice balances only</small>
                </div>
                <button class="btn btn-primary" type="button" data-print-billing-statement>Print ${escapeHtml(title)}</button>
            </div>
            <div class="detail-summary-grid">
                <article class="detail-summary-card">
                    <span class="label">Invoice Amount</span>
                    <span class="value">${escapeHtml(formatCurrency(totals.amount))}</span>
                </article>
                <article class="detail-summary-card">
                    <span class="label">Net of VAT</span>
                    <span class="value">${escapeHtml(formatCurrency(totals.net))}</span>
                </article>
                <article class="detail-summary-card">
                    <span class="label">VAT</span>
                    <span class="value">${escapeHtml(formatCurrency(totals.vat))}</span>
                </article>
            </div>
            ${buildStatementPreviewRows(rows)}
        `;
        const printButton = els.billingScorecardContent.querySelector('[data-print-billing-statement]');
        printButton?.addEventListener('click', () => printHtmlDocument(buildBillingStatementPrintDocument(statement), 'marga_billing_statement_print'));
    }
}

function makeBillingScorecardDetail({ metricKey, monthKey, row, cell, amount, status, invoiceGroup = null, payment = null, collectedAmount = 0, remainingBalance = 0 }) {
    return {
        metricKey,
        monthKey,
        company: payment?.client || row?.company_name || row?.account_name || 'Unknown',
        branch: row?.branch_name || payment?.category || '',
        serial: row?.serial_number || '-',
        contractId: row?.contractmain_id || '',
        machineId: row?.machine_id || '',
        invoiceNo: payment?.invoiceNo || invoiceGroup?.invoice_no || invoiceGroup?.invoice_ref || invoiceGroup?.invoice_id || '-',
        orNumber: payment?.orNumber || payment?.printedOr || '',
        invoiceDate: invoiceGroup?.invoice_date || cell?.latest_invoice_date || payment?.invoiceDate || null,
        paymentDate: payment?.paymentDate || null,
        amount: Number(amount || 0),
        invoiceAmount: Number(invoiceGroup?.amount_total || cell?.amount_total || amount || 0),
        collectedAmount: Number(collectedAmount || 0),
        remainingBalance: Number(remainingBalance || 0),
        projectedAmount: Number(amount || 0),
        status,
        cellId: row?.row_id && monthKey ? `${row.row_id}:${monthKey}` : ''
    };
}

function addBillingScorecardTotal(rows, metricKey, monthKey, amount, count = 1, detail = null) {
    const row = rows.find((item) => item.key === metricKey);
    if (!row) return;
    row.totals[monthKey] = Number(row.totals[monthKey] || 0) + Number(amount || 0);
    row.counts[monthKey] = Number(row.counts[monthKey] || 0) + Number(count || 0);
    if (detail) {
        if (!row.details[monthKey]) row.details[monthKey] = [];
        row.details[monthKey].push(detail);
    }
}

function buildBillingScorecardRows(payload) {
    const matrix = payload?.month_matrix || {};
    const months = Array.isArray(matrix.months) ? matrix.months : [];
    const monthColumns = months.map((monthKey) => ({ key: monthKey, label: formatMonthLabel(monthKey, monthKey) }));
    const rows = [
        { key: 'projected', label: 'Projected Monthly Billing', totals: {}, counts: {}, details: {} },
        { key: 'billed', label: 'Invoice/Billed Total', totals: {}, counts: {}, details: {} },
        { key: 'collected', label: 'Collected Against Billed', totals: {}, counts: {}, details: {} },
        { key: 'receivable', label: 'Unpaid Receivables', totals: {}, counts: {}, details: {} },
        { key: 'pending_billing', label: 'Pending Billing Projection', totals: {}, counts: {}, details: {} },
        { key: 'payment_month', label: 'Payments Dated This Month', totals: {}, counts: {}, details: {} }
    ];
    monthColumns.forEach((column) => rows.forEach((row) => {
        row.totals[column.key] = 0;
        row.counts[column.key] = 0;
        row.details[column.key] = [];
    }));

    const paymentMap = buildBillingScorecardPaymentMap(billingScorecardPaymentEntries);
    billingScorecardPaymentEntries.forEach((payment) => {
        const paymentMonthKey = getDateMonthKey(payment.paymentDate);
        if (!months.includes(paymentMonthKey)) return;
        addBillingScorecardTotal(rows, 'payment_month', paymentMonthKey, payment.amount, 1, makeBillingScorecardDetail({
            metricKey: 'payment_month',
            monthKey: paymentMonthKey,
            row: null,
            cell: null,
            amount: payment.amount,
            status: payment.paymentStatus || payment.paymentType || 'Payment dated this month',
            payment
        }));
    });

    (Array.isArray(matrix.rows) ? matrix.rows : [])
        .filter((row) => !row.is_summary_row && !row.isGroupedChild)
        .forEach((row) => {
            months.forEach((monthKey) => {
                const cell = row.months?.[monthKey];
                if (!cell) return;
                const billedTarget = Number(cell.amount_total || cell.display_amount_total || 0) || 0;
                const pendingProjection = getBillingScorecardPendingProjection(cell, row);
                const hasPendingProjection = Boolean(cell.pending && pendingProjection > 0);
                const invoiceGroups = Array.isArray(cell.invoice_groups) ? cell.invoice_groups : [];
                const invoiceDetails = invoiceGroups.length
                    ? invoiceGroups
                    : (billedTarget > 0 ? [{ amount_total: billedTarget, invoice_no: '-', invoice_ref: '', invoice_id: '' }] : []);
                let collectedTotal = 0;
                let remainingTotal = 0;

                invoiceDetails.forEach((group) => {
                    const invoiceAmount = Number(group.amount_total || billedTarget || 0) || 0;
                    if (invoiceAmount <= 0) return;
                    const paymentSummary = getBillingScorecardPaymentSummary(paymentMap, group.invoice_id, group.invoice_no, group.invoice_ref);
                    const paidAgainstInvoice = Math.min(Number(paymentSummary.amount || 0), invoiceAmount);
                    const computedRemaining = Math.max(0, invoiceAmount - paidAgainstInvoice);
                    const remaining = paymentSummary.latestBalanceAmount !== null && paymentSummary.latestBalanceAmount !== undefined
                        ? Math.min(Math.max(0, Number(paymentSummary.latestBalanceAmount || 0)), computedRemaining)
                        : computedRemaining;
                    collectedTotal += paidAgainstInvoice;
                    remainingTotal += remaining;

                    addBillingScorecardTotal(rows, 'billed', monthKey, invoiceAmount, 1, makeBillingScorecardDetail({
                        metricKey: 'billed',
                        monthKey,
                        row,
                        cell,
                        amount: invoiceAmount,
                        status: 'Invoice billed',
                        invoiceGroup: group
                    }));
                    if (paidAgainstInvoice > 0) {
                        const collectedDetail = makeBillingScorecardDetail({
                            metricKey: 'collected',
                            monthKey,
                            row,
                            cell,
                            amount: paidAgainstInvoice,
                            status: 'Collected against billed invoice',
                            invoiceGroup: group,
                            collectedAmount: paidAgainstInvoice,
                            remainingBalance: remaining
                        });
                        collectedDetail.paymentDate = paymentSummary.lastPaymentDate || paymentSummary.firstPaymentDate || null;
                        collectedDetail.orNumber = Array.from(paymentSummary.orNumbers || []).filter(Boolean).join(', ');
                        addBillingScorecardTotal(rows, 'collected', monthKey, paidAgainstInvoice, 1, collectedDetail);
                    }
                    if (remaining > 0.01) {
                        addBillingScorecardTotal(rows, 'receivable', monthKey, remaining, 1, makeBillingScorecardDetail({
                            metricKey: 'receivable',
                            monthKey,
                            row,
                            cell,
                            amount: remaining,
                            status: 'Unpaid balance',
                            invoiceGroup: group,
                            collectedAmount: paidAgainstInvoice,
                            remainingBalance: remaining
                        }));
                    }
                });

                if (billedTarget > 0 || hasPendingProjection) {
                    addBillingScorecardTotal(rows, 'projected', monthKey, billedTarget + pendingProjection, (billedTarget > 0 ? 1 : 0) + (hasPendingProjection ? 1 : 0) || 1, makeBillingScorecardDetail({
                        metricKey: 'projected',
                        monthKey,
                        row,
                        cell,
                        amount: billedTarget + pendingProjection,
                        status: hasPendingProjection ? 'Projected: billed + pending billing' : 'Projected: billed',
                        collectedAmount: collectedTotal,
                        remainingBalance: remainingTotal
                    }));
                }
                if (hasPendingProjection) {
                    addBillingScorecardTotal(rows, 'pending_billing', monthKey, pendingProjection, 1, makeBillingScorecardDetail({
                        metricKey: 'pending_billing',
                        monthKey,
                        row,
                        cell,
                        amount: pendingProjection,
                        status: getBillingScorecardPendingReason(cell, row)
                    }));
                }
            });
        });

    return { monthColumns, rows };
}

function renderBillingScorecard(payload) {
    if (!els.billingScorecardWrap) return;
    const data = buildBillingScorecardRows(payload);
    billingScorecardData = data;
    billingScorecardDetailMap = new Map();
    data.rows.forEach((row) => Object.entries(row.details || {}).forEach(([monthKey, details]) => {
        billingScorecardDetailMap.set(`${row.key}:${monthKey}`, Array.isArray(details) ? details : []);
    }));

    if (!data.monthColumns.length) {
        els.billingScorecardWrap.innerHTML = '<div class="empty-panel">No month columns returned for scorecard.</div>';
        return;
    }
    const header = data.monthColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
    const body = data.rows.map((row) => {
        const monthCells = data.monthColumns.map((column) => {
            const count = Number(row.counts?.[column.key] || 0);
            const amount = Number(row.totals?.[column.key] || 0);
            return `
                <td class="billing-scorecard-cell">
                    <button type="button" class="billing-scorecard-button" data-metric-key="${escapeHtml(row.key)}" data-month-key="${escapeHtml(column.key)}">
                        <span>${escapeHtml(formatPlainNumber(count))}</span>
                        <span class="billing-scorecard-divider">/</span>
                        <strong>${escapeHtml(formatPlainNumber(amount))}</strong>
                    </button>
                </td>
            `;
        }).join('');
        const grandCount = data.monthColumns.reduce((sum, column) => sum + Number(row.counts?.[column.key] || 0), 0);
        const grandAmount = data.monthColumns.reduce((sum, column) => sum + Number(row.totals?.[column.key] || 0), 0);
        return `
            <tr>
                <th class="billing-scorecard-label">${escapeHtml(row.label)}</th>
                ${monthCells}
                <td class="billing-scorecard-grand">${escapeHtml(formatPlainNumber(grandCount))} / <strong>${escapeHtml(formatPlainNumber(grandAmount))}</strong></td>
            </tr>
        `;
    }).join('');
    els.billingScorecardWrap.innerHTML = `
        <table class="billing-sheet billing-scorecard-sheet">
            <thead><tr><th>Metric</th>${header}<th>Total</th></tr></thead>
            <tbody>${body}</tbody>
        </table>
    `;
}

function renderBillingScorecardLoading() {
    if (!els.billingScorecardWrap) return;
    billingScorecardData = null;
    billingScorecardDetailMap = new Map();
    els.billingScorecardWrap.innerHTML = `
        <div class="empty-panel">
            Loading Collections scorecard payments. Billing month-to-month comparison is available below.
        </div>
    `;
}

function renderBillingScorecardError(message) {
    if (!els.billingScorecardWrap) return;
    billingScorecardData = null;
    billingScorecardDetailMap = new Map();
    els.billingScorecardWrap.innerHTML = `
        <div class="empty-panel">
            ${escapeHtml(message || 'Collections scorecard could not load. Billing month-to-month comparison is still available below.')}
        </div>
    `;
}

function renderBillingScorecardDetails(metricKey, details) {
    if (!details.length) return '<div class="detail-empty">No detail rows found for this scorecard cell.</div>';
    const columnsByMetric = {
        pending_billing: ['company', 'branch', 'serial', 'contractMachine', 'projected', 'status', 'open'],
        billed: ['invoice', 'company', 'branch', 'invoiceDate', 'amount', 'open'],
        collected: ['invoice', 'or', 'company', 'branch', 'paid', 'paymentDate', 'open'],
        receivable: ['invoice', 'company', 'branch', 'invoiceAmount', 'collected', 'remaining', 'open'],
        payment_month: ['invoice', 'or', 'company', 'branch', 'paid', 'paymentDate'],
        projected: ['company', 'branch', 'invoice', 'projected', 'status', 'open']
    };
    const labels = {
        company: 'Company', branch: 'Branch / Dept', serial: 'Serial', contractMachine: 'Contract / Machine',
        invoice: 'Invoice #', or: 'OR #', invoiceDate: 'Invoice Date', paymentDate: 'Payment Date',
        amount: 'Billed Amount', paid: 'Paid Amount', invoiceAmount: 'Invoice Amount', collected: 'Collected',
        remaining: 'Remaining Balance', projected: 'Projected Amount', status: 'Why / Status', open: 'Open'
    };
    const moneyColumns = new Set(['amount', 'paid', 'invoiceAmount', 'collected', 'remaining', 'projected']);
    const columns = columnsByMetric[metricKey] || columnsByMetric.projected;
    const value = (detail, column) => {
        if (column === 'company') return escapeHtml(detail.company || '-');
        if (column === 'branch') return escapeHtml(detail.branch || '-');
        if (column === 'serial') return escapeHtml(detail.serial || '-');
        if (column === 'contractMachine') return escapeHtml(`Contract ${detail.contractId || '-'} / Machine ${detail.machineId || '-'}`);
        if (column === 'invoice') return escapeHtml(detail.invoiceNo || '-');
        if (column === 'or') return escapeHtml(detail.orNumber || '-');
        if (column === 'invoiceDate') return escapeHtml(formatUsDate(asValidDate(detail.invoiceDate)) || '-');
        if (column === 'paymentDate') return escapeHtml(formatUsDate(asValidDate(detail.paymentDate)) || '-');
        if (column === 'amount') return escapeHtml(formatCurrency(detail.amount || 0));
        if (column === 'paid') return escapeHtml(formatCurrency(detail.amount || detail.collectedAmount || 0));
        if (column === 'invoiceAmount') return escapeHtml(formatCurrency(detail.invoiceAmount || 0));
        if (column === 'collected') return escapeHtml(formatCurrency(detail.collectedAmount || 0));
        if (column === 'remaining') return escapeHtml(formatCurrency(detail.remainingBalance || detail.amount || 0));
        if (column === 'projected') return escapeHtml(formatCurrency(detail.projectedAmount || detail.amount || 0));
        if (column === 'status') return escapeHtml(detail.status || '-');
        if (column === 'open') {
            return detail.cellId ? `<button type="button" class="btn btn-secondary btn-sm billing-scorecard-open-cell" data-cell-id="${escapeHtml(detail.cellId)}">Open</button>` : '-';
        }
        return '-';
    };
    return `
        <div class="billing-scorecard-detail-wrap">
            <table class="billing-sheet billing-scorecard-detail-table">
                <thead><tr>${columns.map((column) => `<th>${escapeHtml(labels[column] || column)}</th>`).join('')}</tr></thead>
                <tbody>
                    ${details.slice().sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0)).map((detail) => `
                        <tr>${columns.map((column) => `<td class="${moneyColumns.has(column) ? 'text-right' : ''}">${value(detail, column)}</td>`).join('')}</tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function openBillingScorecardTotal(metricKey, monthKey) {
    const details = billingScorecardDetailMap.get(`${metricKey}:${monthKey}`) || [];
    const metricLabel = (billingScorecardData?.rows || []).find((row) => row.key === metricKey)?.label || 'Scorecard Detail';
    const total = details.reduce((sum, detail) => sum + Number(detail.amount || 0), 0);
    if (els.billingScorecardTitle) els.billingScorecardTitle.textContent = metricLabel;
    if (els.billingScorecardSubtitle) els.billingScorecardSubtitle.textContent = `${formatMonthLabel(monthKey, monthKey)} • ${details.length.toLocaleString()} detail row(s) • ${formatCurrency(total)}`;
    if (els.billingScorecardContent) els.billingScorecardContent.innerHTML = renderBillingScorecardDetails(metricKey, details);
    els.billingScorecardModal?.classList.remove('hidden');
}

function closeBillingScorecardModal() {
    els.billingScorecardModal?.classList.add('hidden');
}

function renderAll(payload, options = {}) {
    lastPayload = payload;
    renderSelectionCard(payload);
    renderSummaryTable(payload);
    if (BILLING_COLLECTIONS_SCORECARD_ENABLED) {
        if (options.scorecardLoading) {
            renderBillingScorecardLoading();
        } else {
            renderBillingScorecard(payload);
        }
    }
    renderMatrixTable(payload);
    els.rawJson.textContent = JSON.stringify(payload, null, 2);
}

function renderError(message) {
    els.selectionCard.classList.add('hidden');
    els.summaryTableWrap.innerHTML = '<div class="empty-panel">Request failed. Check API payload below.</div>';
    if (els.billingScorecardWrap) els.billingScorecardWrap.innerHTML = '<div class="empty-panel">Request failed. Check API payload below.</div>';
    if (els.customerStatementBar) {
        els.customerStatementBar.classList.add('hidden');
        els.customerStatementBar.innerHTML = '';
    }
    els.matrixTableWrap.innerHTML = '<div class="empty-panel">Request failed. Check API payload below.</div>';
    els.rawJson.textContent = String(message || 'Unknown error');
}

async function refreshBillingScorecardPayments(payload, requestToken, options = {}) {
    if (!BILLING_COLLECTIONS_SCORECARD_ENABLED) return;
    if (!els.billingScorecardWrap) return;
    if (options.forceRefresh || Boolean(els.refreshCacheInput?.checked)) billingScorecardPaymentEntries = [];
    try {
        await loadBillingScorecardPayments();
        if (requestToken !== dashboardRequestToken) return;
        renderBillingScorecard(payload);
    } catch (error) {
        if (requestToken !== dashboardRequestToken) return;
        console.warn('Unable to load payment records for Billing scorecard.', error);
        billingScorecardPaymentEntries = [];
        renderBillingScorecardError('Collections scorecard payment records could not load. Billing month-to-month comparison is still available below.');
    }
}

async function loadDashboard(options = {}) {
    const requestToken = ++dashboardRequestToken;
    if (dashboardAbortController) dashboardAbortController.abort();
    dashboardAbortController = new AbortController();

    try {
        const { url, apiKey } = buildRequestContext(options);
        setStatus('Loading...', 'loading');
        els.runBtn.disabled = true;

        const headers = {};
        if (apiKey) headers['x-api-key'] = apiKey;

        const response = await fetch(url, { headers, signal: dashboardAbortController.signal, cache: 'no-store' });
        const payload = await response.json();
        if (requestToken !== dashboardRequestToken) return;
        if (!response.ok || !payload.ok) {
            throw new Error(payload?.error || `Request failed (${response.status})`);
        }

        const activeSearchTerm = getMatrixSearchTerm();
        const expectedPayloadSearchTerm = activeSearchTerm.length >= 2 ? activeSearchTerm : '';
        if (getPayloadSearchTerm(payload) !== expectedPayloadSearchTerm) return;

        billingExclusionCache = await loadBillingExclusions();
        if (requestToken !== dashboardRequestToken) return;
        const visiblePayload = applyBillingExclusionsToPayload(payload, billingExclusionCache);
        renderDashboardBillingExclusions();
        renderAll(visiblePayload, { scorecardLoading: BILLING_COLLECTIONS_SCORECARD_ENABLED });
        setStatus('Loaded');
        if (BILLING_COLLECTIONS_SCORECARD_ENABLED) refreshBillingScorecardPayments(visiblePayload, requestToken, options);
    } catch (error) {
        if (error?.name === 'AbortError') return;
        if (requestToken !== dashboardRequestToken) return;
        renderError(error?.message || error);
        setStatus('Error', 'error');
    } finally {
        if (requestToken === dashboardRequestToken) {
            dashboardAbortController = null;
            els.runBtn.disabled = false;
        }
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
    els.printedTodayCard?.addEventListener('click', openPrintedTodayReport);
    els.savedToPrintCard?.addEventListener('click', openSavedToPrintReport);
    els.printedMonthCard?.addEventListener('click', openPrintedMonthReport);
    els.invoiceSearchBtn?.addEventListener('click', searchInvoiceNumber);
    els.invoiceDeepSearchBtn?.addEventListener('click', deepSearchInvoiceNumbers);
    els.invoiceSearchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchInvoiceNumber();
        }
    });
    els.billingExclusionsToggleBtn?.addEventListener('click', () => {
        if (!els.billingExclusionsList) return;
        els.billingExclusionsList.hidden = !els.billingExclusionsList.hidden;
        renderDashboardBillingExclusions();
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
    els.matrixTotalsWrap?.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-unbilled-month-key]');
        if (!trigger) return;
        event.preventDefault();
        openUnbilledProjectionMonth(trigger.dataset.unbilledMonthKey);
    });
    els.customerStatementBar?.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-customer-statement-key]');
        if (!trigger) return;
        event.preventDefault();
        openBillingStatement({
            scope: 'customer',
            customerKey: trigger.dataset.customerStatementKey
        });
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
            if (rowId && monthKey) openBillingCalcModalSafely(rowId, monthKey);
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
            if (lastPayload) await loadDashboard({ forceRefresh: true });
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
            openBillingCalcModalSafely(calcTrigger.dataset.rowId, calcTrigger.dataset.monthKey);
            return;
        }
        const serialTrigger = event.target.closest('.serial-link');
        if (serialTrigger) {
            openSerialDetailModal(serialTrigger.dataset.rowId);
            return;
        }
        const trigger = event.target.closest('.billed-link');
        if (!trigger) return;
        event.preventDefault();
        openBillingCalcModalSafely(trigger.dataset.rowId, trigger.dataset.monthKey);
    });
    els.billingScorecardWrap?.addEventListener('click', (event) => {
        const trigger = event.target.closest('.billing-scorecard-button');
        if (!trigger) return;
        event.preventDefault();
        openBillingScorecardTotal(trigger.dataset.metricKey, trigger.dataset.monthKey);
    });
    els.billingScorecardContent?.addEventListener('click', (event) => {
        const savedBack = event.target.closest('[data-saved-dist-back]');
        if (savedBack) {
            event.preventDefault();
            const report = billingWorkDistributionState?.report || lastPayload?.productivity_report || null;
            if (report) renderSavedToPrintDistribution(report, {
                from: billingWorkDistributionState?.from,
                to: billingWorkDistributionState?.to
            });
            return;
        }
        const savedApply = event.target.closest('[data-saved-dist-apply]');
        if (savedApply) {
            event.preventDefault();
            const report = billingWorkDistributionState?.report || lastPayload?.productivity_report || null;
            if (report) renderSavedToPrintDistribution(report, {
                from: els.billingScorecardContent.querySelector('[data-saved-dist-from]')?.value || '',
                to: els.billingScorecardContent.querySelector('[data-saved-dist-to]')?.value || ''
            });
            return;
        }
        const savedPreparer = event.target.closest('[data-saved-dist-preparer]');
        if (savedPreparer) {
            event.preventDefault();
            renderSavedToPrintPreparerDetail(savedPreparer.dataset.savedDistPreparer || '');
            return;
        }
        const workBack = event.target.closest('[data-work-dist-back]');
        if (workBack) {
            event.preventDefault();
            const report = billingWorkDistributionState?.report || lastPayload?.productivity_report || null;
            if (report) renderBillingWorkDistribution(report, {
                from: billingWorkDistributionState?.from,
                to: billingWorkDistributionState?.to
            });
            return;
        }
        const workApply = event.target.closest('[data-work-dist-apply]');
        if (workApply) {
            event.preventDefault();
            const report = billingWorkDistributionState?.report || lastPayload?.productivity_report || null;
            if (report) renderBillingWorkDistribution(report, {
                from: els.billingScorecardContent.querySelector('[data-work-dist-from]')?.value || '',
                to: els.billingScorecardContent.querySelector('[data-work-dist-to]')?.value || ''
            });
            return;
        }
        const workDetail = event.target.closest('[data-work-dist-detail]');
        if (workDetail) {
            event.preventDefault();
            renderBillingWorkDetail(
                workDetail.dataset.workDistDetail || 'all',
                workDetail.dataset.workDistStaffId || '',
                workDetail.dataset.workDistStatus || 'all'
            );
            return;
        }
        const productivityInvoiceTrigger = event.target.closest('[data-productivity-view-invoice]');
        if (productivityInvoiceTrigger) {
            event.preventDefault();
            const invoiceNo = String(productivityInvoiceTrigger.dataset.productivityViewInvoice || '').trim();
            const rowId = String(productivityInvoiceTrigger.dataset.productivityRowId || '').trim();
            const monthKey = String(productivityInvoiceTrigger.dataset.productivityMonthKey || '').trim();
            closeBillingScorecardModal();
            if (rowId && monthKey) {
                openBillingCalcModalSafely(rowId, monthKey);
                return;
            }
            if (invoiceNo && els.invoiceSearchInput) {
                els.invoiceSearchInput.value = invoiceNo;
                searchInvoiceNumber();
            }
            return;
        }
        const inactivateTrigger = event.target.closest('[data-unbilled-inactivate-customer]');
        if (inactivateTrigger) {
            event.preventDefault();
            event.stopPropagation();
            hideUnbilledProjectionCustomer(
                inactivateTrigger.dataset.unbilledInactivateCustomer,
                inactivateTrigger.dataset.unbilledInactivateMonth,
                inactivateTrigger
            );
            return;
        }
        const customerTrigger = event.target.closest('[data-unbilled-customer-key]');
        if (customerTrigger) {
            event.preventDefault();
            openUnbilledCustomerMonths(customerTrigger.dataset.unbilledCustomerKey);
            return;
        }
        const billNowTrigger = event.target.closest('[data-unbilled-bill-now-row-id]');
        if (billNowTrigger) {
            event.preventDefault();
            openUnbilledBillNow(billNowTrigger.dataset.unbilledBillNowRowId, billNowTrigger.dataset.unbilledBillNowMonth);
            return;
        }
        const backTrigger = event.target.closest('[data-unbilled-back-month]');
        if (backTrigger) {
            event.preventDefault();
            openUnbilledProjectionMonth(backTrigger.dataset.unbilledBackMonth);
            return;
        }
        const trigger = event.target.closest('.billing-scorecard-open-cell');
        if (!trigger) return;
        event.preventDefault();
        const [rowId, monthKey] = String(trigger.dataset.cellId || '').split(':');
        closeBillingScorecardModal();
        if (rowId && monthKey) openBillingCalcModalSafely(rowId, monthKey);
    });
    els.billingScorecardCloseBtn?.addEventListener('click', closeBillingScorecardModal);
    els.billingScorecardModal?.addEventListener('click', (event) => {
        if (event.target === els.billingScorecardModal) closeBillingScorecardModal();
    });
    els.invoiceDetailCloseBtn?.addEventListener('click', closeInvoiceDetailModal);
    els.rtpInvoicePrintBtn?.addEventListener('click', printCurrentRtpInvoice);
    els.rtpInvoiceDotMatrixBtn?.addEventListener('click', printCurrentDotMatrixInvoice);
    els.invoiceDetailModal?.addEventListener('click', (event) => {
        if (event.target === els.invoiceDetailModal) closeInvoiceDetailModal();
    });
    els.invoiceDetailContent?.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-branch-billing-statement-row-id]');
        if (!trigger) return;
        event.preventDefault();
        openBillingStatement({
            scope: 'branch',
            rowId: trigger.dataset.branchBillingStatementRowId
        });
    });
    els.billingCalcCloseBtn?.addEventListener('click', closeBillingCalcModal);
    els.billingCalcPrintBtn?.addEventListener('click', printCurrentRtpInvoice);
    els.billingCalcDotMatrixBtn?.addEventListener('click', printCurrentDotMatrixInvoice);
    els.billingCalcMeterFormBtn?.addEventListener('click', printCurrentMeterReadingForm);
    els.billingCalcEnvelopeBtn?.addEventListener('click', printCurrentEnvelope);
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
    els.serialDetailContent?.addEventListener('click', (event) => {
        const inactiveButton = event.target.closest('[data-serial-inactive-row-id]');
        if (!inactiveButton) return;
        event.preventDefault();
        makeSerialBillingAccountInactive(inactiveButton.dataset.serialInactiveRowId, inactiveButton);
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
            closeBillingScorecardModal();
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
