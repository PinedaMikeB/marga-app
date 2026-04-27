/**
 * MARGA Collections Module - Collection Report
 * - Collection dashboard + report lists in one module
 * - Robust loading with defensive fallbacks
 * - In-page invoice detail modal with follow-up history
 */

const API_KEY = FIREBASE_CONFIG.apiKey;
const BASE_URL = FIREBASE_CONFIG.baseUrl;

// State
let allInvoices = [];
let filteredInvoices = [];
let currentPage = 1;
const pageSize = 50;
let currentPriorityFilter = null;
let quickAgeFilter = 'all';
let dataMode = 'active';
let todayFollowups = [];
let collectionHistory = {};

// Lookup maps
let contractMap = {};
let contractDepMap = {};
let branchMap = {};
let companyMap = {};
let machineMap = {};
let paidInvoiceIds = new Set();
let machToBranchMap = {};
let invoiceIndexMap = new Map();
let lookupsLoaded = false;
let lastLoadSucceeded = false;
let currentDetailInvoice = null;
let isSavingConversation = false;
let paymentEntries = [];
let billingEntriesForDuration = [];
let billingMetaByInvoiceKey = new Map();
let collectorBillingRecords = [];
let collectorCellMap = new Map();
let collectorViewportBound = false;
let analyticsDashboardVisible = false;
let collectorBillingMatrixCache = null;
let collectorBillingMatrixPromise = null;
let collectorDashboardData = null;
let collectorMatrixDragState = null;
let collectorScrollbarDragState = null;
let collectorDashboardRenderSeq = 0;
let collectionWorkspaceLookupsLoaded = false;
let collectionWorkspaceLookupsPromise = null;
let collectionProfileByBranchId = new Map();
let collectionProfileOverrides = new Map();
let collectionStatusOptions = [];
let troubleLookupMap = new Map();
let employeeLookupMap = new Map();
let serviceHistoryCache = new Map();
let currentCollectorWorkspace = null;
let isSavingCollectorFollowup = false;
let isSavingCollectorPayment = false;
let isSavingCollectorProfileOverride = false;
let isSavingCollectorSchedule = false;

const DEFAULT_COLLECTION_STATUSES = [
    { id: 1, label: 'Missing' },
    { id: 2, label: 'Consolidating' },
    { id: 3, label: 'For Approval' },
    { id: 4, label: 'Voucher Preparation' },
    { id: 5, label: 'For Signing' },
    { id: 6, label: 'Check for Pick-up' },
    { id: 7, label: 'On hold' },
    { id: 8, label: 'Others' }
];

const COLLECTION_LOCATION_OPTIONS = [
    { id: 1, key: 'end_user', label: 'End User' },
    { id: 2, key: 'accounting', label: 'Accounting' }
];

const COLLECTION_SCHEDULE_OPTIONS = [
    'Confirmed',
    'Tentative',
    'Return cheque',
    'Acquire 2307',
    'Shutdown Notice',
    'Deposit',
    'Start Up',
    'Refundable Deposit',
    'Pick up RFP'
];

const dailyTips = [
    'Focus on URGENT (91-120 days) first - highest recovery potential.',
    'Best call times: 9-11 AM and 2-4 PM. Avoid lunch hours.',
    'Always log call attempts to track payment patterns.',
    'Work URGENT -> HIGH -> MEDIUM for maximum efficiency.',
    'For 120+ day accounts, escalate for machine pull-out recommendation.'
];

const PROMISE_REMARK_PATTERN = /\b(ok na|for signing|check|pickup|ready|release|promise|ptp|payment|paid)\b/i;
const COLLECTOR_DASHBOARD_START = new Date(2025, 9, 1);
COLLECTOR_DASHBOARD_START.setHours(0, 0, 0, 0);
const MONTHLY_TREND_START = new Date(2025, 10, 1);
MONTHLY_TREND_START.setHours(0, 0, 0, 0);

function buildMonthColumns(startValue, endValue) {
    const monthColumns = [];
    let cursor = startOfMonth(startValue);
    const lastMonth = startOfMonth(endValue);

    while (cursor && lastMonth && cursor <= lastMonth) {
        monthColumns.push({
            key: getMonthKey(cursor),
            label: formatMonthLabelCompact(cursor),
            fullLabel: formatMonthLabel(cursor, true),
            monthStart: new Date(cursor.getTime()),
            isCurrentMonth: false
        });
        cursor = addMonths(cursor, 1);
    }

    return monthColumns;
}

function getValue(field) {
    if (!field || typeof field !== 'object') return null;
    if (field.integerValue !== undefined) return Number(field.integerValue);
    if (field.doubleValue !== undefined) return Number(field.doubleValue);
    if (field.booleanValue !== undefined) return Boolean(field.booleanValue);
    if (field.timestampValue !== undefined) return field.timestampValue;
    if (field.stringValue !== undefined) return field.stringValue;
    return null;
}

function getField(fields, candidates) {
    for (const name of candidates) {
        const value = getValue(fields[name]);
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
}

function normalizeDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
        const d = new Date(`${isoMatch[1]}T00:00:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
        const month = String(slashMatch[1]).padStart(2, '0');
        const day = String(slashMatch[2]).padStart(2, '0');
        const d = new Date(`${slashMatch[3]}-${month}-${day}T00:00:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateKey(value) {
    const d = normalizeDate(value);
    if (!d) return null;
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}

function daysBetween(fromDate, toDate) {
    if (!fromDate || !toDate) return null;
    return Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function formatDate(value) {
    const d = normalizeDate(value);
    if (!d) return '-';
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(amount) {
    return '₱' + Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyShort(amount) {
    const value = Number(amount || 0);
    if (value >= 1000000) return '₱' + (value / 1000000).toFixed(2) + 'M';
    if (value >= 1000) return '₱' + (value / 1000).toFixed(0) + 'K';
    return '₱' + value.toFixed(0);
}

function formatPlainNumber(amount) {
    return Number(amount || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

function formatSignedCurrencyShort(amount) {
    const value = Number(amount || 0);
    if (value === 0) return '₱0';
    return `${value > 0 ? '+' : '-'}${formatCurrencyShort(Math.abs(value))}`;
}

function formatPercent(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    return `${Number(value).toFixed(digits)}%`;
}

function getTodayInputValue(offsetDays = 0) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return toDateKey(d) || '';
}

function toTimestampString(date = new Date()) {
    const yyyyMmDd = toDateKey(date) || getTodayInputValue();
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyyMmDd} ${hh}:${mm}:${ss}`;
}

function normalizePhone(value) {
    return String(value || '')
        .replace(/[^\d+]/g, '')
        .trim();
}

function formatRangeLabel(fromDate, toDate) {
    if (fromDate && toDate) return `${formatDate(fromDate)} to ${formatDate(toDate)}`;
    if (fromDate) return `${formatDate(fromDate)} onward`;
    if (toDate) return `Up to ${formatDate(toDate)}`;
    return 'All Dates';
}

function startOfMonth(value) {
    const d = normalizeDate(value);
    if (!d) return null;
    const normalized = new Date(d.getTime());
    normalized.setDate(1);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
}

function addMonths(value, months) {
    const d = startOfMonth(value);
    if (!d) return null;
    d.setMonth(d.getMonth() + months);
    return d;
}

function getMonthKey(value) {
    const d = startOfMonth(value);
    if (!d) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getBillingPeriodMonthKey(monthValue, yearValue, fallbackDate = null) {
    const monthNumber = monthNameToNumber(monthValue) || Number(monthValue || 0);
    const yearNumber = Number(yearValue || 0);
    if (monthNumber >= 1 && monthNumber <= 12 && yearNumber >= 2000) {
        return `${yearNumber}-${String(monthNumber).padStart(2, '0')}`;
    }
    return getMonthKey(fallbackDate);
}

function formatMonthLabel(value, longLabel = false) {
    const d = startOfMonth(value);
    if (!d) return '-';
    return d.toLocaleDateString('en-PH', {
        month: longLabel ? 'long' : 'short',
        year: 'numeric'
    });
}

function formatMonthLabelCompact(value) {
    const d = startOfMonth(value);
    if (!d) return '-';
    return d.toLocaleDateString('en-PH', {
        month: 'short',
        year: '2-digit'
    });
}

function addDays(value, days) {
    const d = normalizeDate(value);
    if (!d) return null;
    const next = new Date(d.getTime());
    next.setDate(next.getDate() + days);
    return next;
}

function isDateWithinRange(date, fromDate, toDate) {
    if (!date) return false;
    if (fromDate && date < fromDate) return false;
    if (toDate) {
        const inclusiveEnd = new Date(toDate.getTime());
        inclusiveEnd.setHours(23, 59, 59, 999);
        if (date > inclusiveEnd) return false;
    }
    return true;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function parseMoneyInput(value) {
    const normalized = String(value || '').replace(/,/g, '').trim();
    if (!normalized) return 0;
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : 0;
}

function formatInputDateTime(value) {
    const dateKey = String(value || '').trim();
    return dateKey ? `${dateKey} 00:00:00` : 'undefined 00:00:00';
}

function createWebDocId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getCollectorSearchTerm() {
    return String(document.getElementById('collectorSearchInput')?.value || '').trim().toLowerCase();
}

function getCollectorSortValue() {
    return String(document.getElementById('collectorSortInput')?.value || 'rd').trim().toLowerCase();
}

function compareCollectorRows(left, right, sortValue) {
    const leftRd = Number(left.rd || 0) || Number.MAX_SAFE_INTEGER;
    const rightRd = Number(right.rd || 0) || Number.MAX_SAFE_INTEGER;
    const leftCustomer = String(left.customer || '').toLowerCase();
    const rightCustomer = String(right.customer || '').toLowerCase();
    const leftBranch = String(left.branchName || left.accountLabel || '').toLowerCase();
    const rightBranch = String(right.branchName || right.accountLabel || '').toLowerCase();
    const leftSerial = String(left.serialNumber || left.machineLabel || '').toLowerCase();
    const rightSerial = String(right.serialNumber || right.machineLabel || '').toLowerCase();

    if (sortValue === 'customer') {
        return leftCustomer.localeCompare(rightCustomer)
            || leftBranch.localeCompare(rightBranch)
            || leftRd - rightRd
            || leftSerial.localeCompare(rightSerial);
    }

    return leftRd - rightRd
        || leftCustomer.localeCompare(rightCustomer)
        || leftBranch.localeCompare(rightBranch)
        || leftSerial.localeCompare(rightSerial);
}

function prepareCollectorRows(rows) {
    const searchTerm = getCollectorSearchTerm();
    const filteredRows = searchTerm
        ? rows.filter((row) => {
            const haystack = [
                row.customer,
                row.branchName,
                row.accountLabel,
                row.serialNumber,
                row.machineLabel,
                row.machineId,
                row.contractmainId,
                row.rd
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(searchTerm);
        })
        : rows;

    return [...filteredRows].sort((left, right) => compareCollectorRows(left, right, getCollectorSortValue()));
}

function ensureCollectorDisplayCell(cellMap, rowMeta, monthMeta) {
    const cellId = `${rowMeta.rowId}__${monthMeta.key}`;
    if (!cellMap.has(cellId)) {
        cellMap.set(cellId, {
            id: cellId,
            rowId: rowMeta.rowId,
            customer: rowMeta.customer,
            branchName: rowMeta.branchName,
            accountLabel: rowMeta.accountLabel,
            companyId: rowMeta.companyId || '',
            branchId: rowMeta.branchId || '',
            machineId: rowMeta.machineId,
            contractmainId: rowMeta.contractmainId,
            serialNumber: rowMeta.serialNumber,
            modelName: rowMeta.modelName || '',
            machineLabel: rowMeta.machineLabel,
            monthKey: monthMeta.key,
            label: monthMeta.fullLabel || monthMeta.label || monthMeta.key,
            rdValues: [],
            billedTotal: 0,
            displayBilledTotal: 0,
            collectedTotal: 0,
            billedBasis: 'none',
            missedReading: false,
            catchUpBilling: false,
            catchUpGapMonths: 0,
            pendingBilling: false,
            readingPagesTotal: 0,
            readingTaskCount: 0,
            records: [],
            recordMap: new Map()
        });
    }
    return cellMap.get(cellId);
}

function upsertCollectorCellRecord(cell, recordKey, payload) {
    const safeKey = String(recordKey || '').trim() || `record-${cell.recordMap.size + 1}`;
    if (!cell.recordMap.has(safeKey)) {
        cell.recordMap.set(safeKey, {
            invoiceId: payload.invoiceId || '',
            invoiceNo: payload.invoiceNo || payload.invoiceId || '',
            invoiceKey: payload.invoiceKey || safeKey,
            amount: Number(payload.amount || 0),
            billedAmount: Number(payload.billedAmount || payload.amount || 0),
            collectedAmount: Number(payload.collectedAmount || 0),
            totalCollectedAmount: Number(payload.totalCollectedAmount || payload.collectedAmount || 0),
            company: payload.company || cell.customer,
            branch: payload.branch || cell.branchName,
            accountLabel: payload.accountLabel || cell.accountLabel,
            companyId: payload.companyId || cell.companyId || '',
            branchId: payload.branchId || cell.branchId || '',
            machineId: payload.machineId || cell.machineId,
            contractmainId: payload.contractmainId || cell.contractmainId,
            serialNumber: payload.serialNumber || cell.serialNumber,
            modelName: payload.modelName || cell.modelName || '',
            machineLabel: payload.machineLabel || cell.machineLabel,
            invoiceDate: payload.invoiceDate || null,
            dueDate: payload.dueDate || null,
            dateReceived: payload.dateReceived || null,
            receivedBy: payload.receivedBy || '',
            billingStatus: payload.billingStatus ?? null,
            billingLocation: payload.billingLocation ?? null,
            billingRemarks: payload.billingRemarks ?? null,
            expectedCollectionDate: payload.expectedCollectionDate || null,
            firstPaymentDate: payload.firstPaymentDate || null,
            lastPaymentDate: payload.lastPaymentDate || null,
            paymentMonthKey: payload.paymentMonthKey || '',
            paymentOrNumbers: new Set(payload.paymentOrNumbers || []),
            rd: payload.rd ?? null
        });
    } else {
        const current = cell.recordMap.get(safeKey);
        current.amount = Number(current.amount || 0) || Number(payload.amount || 0);
        current.billedAmount = Number(current.billedAmount || 0) + Number(payload.billedAmount || 0);
        current.collectedAmount = Number(current.collectedAmount || 0) + Number(payload.collectedAmount || 0);
        current.totalCollectedAmount = Math.max(Number(current.totalCollectedAmount || 0), Number(payload.totalCollectedAmount || 0));
        current.branch = current.branch || payload.branch || cell.branchName;
        current.accountLabel = current.accountLabel || payload.accountLabel || cell.accountLabel;
        current.companyId = current.companyId || payload.companyId || cell.companyId || '';
        current.branchId = current.branchId || payload.branchId || cell.branchId || '';
        current.serialNumber = current.serialNumber || payload.serialNumber || cell.serialNumber;
        current.modelName = current.modelName || payload.modelName || cell.modelName || '';
        current.machineLabel = current.machineLabel || payload.machineLabel || cell.machineLabel;
        current.rd = current.rd ?? payload.rd ?? null;
        if (!current.invoiceDate && payload.invoiceDate) current.invoiceDate = payload.invoiceDate;
        if (!current.dueDate && payload.dueDate) current.dueDate = payload.dueDate;
        if (!current.dateReceived && payload.dateReceived) current.dateReceived = payload.dateReceived;
        if (!current.receivedBy && payload.receivedBy) current.receivedBy = payload.receivedBy;
        if (!current.expectedCollectionDate && payload.expectedCollectionDate) current.expectedCollectionDate = payload.expectedCollectionDate;
        if (!current.firstPaymentDate || (payload.firstPaymentDate && payload.firstPaymentDate < current.firstPaymentDate)) {
            current.firstPaymentDate = payload.firstPaymentDate || current.firstPaymentDate;
        }
        if (!current.lastPaymentDate || (payload.lastPaymentDate && payload.lastPaymentDate > current.lastPaymentDate)) {
            current.lastPaymentDate = payload.lastPaymentDate || current.lastPaymentDate;
        }
        (payload.paymentOrNumbers || []).forEach((orNumber) => {
            if (orNumber) current.paymentOrNumbers.add(orNumber);
        });
    }

    return cell.recordMap.get(safeKey);
}

function finalizeCollectorCellRecords(cellMap) {
    cellMap.forEach((cell) => {
        cell.displayBilledTotal = Number(
            (Number(cell.displayBilledTotal || 0) > 0 ? cell.displayBilledTotal : cell.billedTotal) || 0
        );
        cell.records = Array.from(cell.recordMap.values())
            .map((record) => ({
                ...record,
                paymentOrNumbers: Array.from(record.paymentOrNumbers || []).sort()
            }))
            .sort((left, right) => {
                const leftTime = (left.lastPaymentDate || left.invoiceDate || left.dueDate || new Date(0)).getTime();
                const rightTime = (right.lastPaymentDate || right.invoiceDate || right.dueDate || new Date(0)).getTime();
                return rightTime - leftTime;
            });
        delete cell.recordMap;
    });
}

async function loadCollectorBillingMatrix(windowStart, endMonthDate) {
    const startKey = getMonthKey(windowStart);
    const endKey = getMonthKey(endMonthDate);
    const cacheKey = `${startKey}:${endKey}`;

    if (collectorBillingMatrixCache?.cacheKey === cacheKey) return collectorBillingMatrixCache;
    if (collectorBillingMatrixPromise?.cacheKey === cacheKey) return collectorBillingMatrixPromise.promise;

    const params = new URLSearchParams();
    params.set('start_year', String(windowStart.getFullYear()));
    params.set('start_month', String(windowStart.getMonth() + 1));
    params.set('end_year', String(endMonthDate.getFullYear()));
    params.set('end_month', String(endMonthDate.getMonth() + 1));
    params.set('include_rows', 'true');
    params.set('include_active_rows', 'true');
    params.set('row_limit', '5000');
    params.set('latest_limit', '100');
    params.set('max_billing_pages', '10');
    params.set('max_schedule_pages', '10');
    params.set('cell_detail_scope', 'none');
    params.set('response_mode', 'collection');

    const request = fetch(`/.netlify/functions/openclaw-billing-cohort?${params.toString()}`)
        .then(async (response) => {
            if (!response.ok) throw new Error(`Billing cohort request failed: ${response.status}`);
            const payload = await response.json();
            const rows = Array.isArray(payload?.month_matrix?.rows) ? payload.month_matrix.rows : [];
            const rowMap = new Map();
            rows.forEach((row) => {
                if (!row || row.is_summary_row) return;
                const rowId = String(row.row_id || '').trim();
                if (rowId) rowMap.set(rowId, row);
                const contractId = String(row.contractmain_id || '').trim();
                if (contractId) rowMap.set(`contract:${contractId}`, row);
                const machineId = String(row.machine_id || '').trim();
                if (machineId && !contractId) rowMap.set(`machine:${machineId}`, row);
            });
            const result = { cacheKey, payload, rowMap };
            collectorBillingMatrixCache = result;
            return result;
        })
        .catch((error) => {
            console.warn('Unable to load billing cohort for collections:', error);
            const result = { cacheKey, payload: null, rowMap: new Map() };
            collectorBillingMatrixCache = result;
            return result;
        })
        .finally(() => {
            if (collectorBillingMatrixPromise?.cacheKey === cacheKey) collectorBillingMatrixPromise = null;
        });

    collectorBillingMatrixPromise = { cacheKey, promise: request };
    return request;
}

function updateCollectorViewportRange() {
    const chips = [
        document.getElementById('collector-visible-range'),
        document.getElementById('collector-visible-range-inline')
    ].filter(Boolean);
    const container = document.getElementById('collector-matrix-table');
    if (!chips.length || !container) return;

    const monthHeaders = Array.from(container.querySelectorAll('thead th[data-month-key]'));
    if (!monthHeaders.length) {
        chips.forEach((chip) => { chip.textContent = 'Viewing current months'; });
        return;
    }

    const containerRect = container.getBoundingClientRect();
    const stickyOffset = Array.from(container.querySelectorAll('thead th.sticky-col'))
        .filter((header) => window.getComputedStyle(header).position === 'sticky')
        .reduce((maxOffset, header) => {
            const rect = header.getBoundingClientRect();
            return Math.max(maxOffset, rect.right - containerRect.left);
        }, 0);
    const visibleLeft = containerRect.left + Math.max(0, stickyOffset);
    const visibleRight = containerRect.right;

    const visibleHeaders = monthHeaders.filter((header) => {
        const rect = header.getBoundingClientRect();
        return rect.right > visibleLeft && rect.left < visibleRight;
    });

    const firstVisible = visibleHeaders[0] || monthHeaders[0];
    const lastVisible = visibleHeaders[visibleHeaders.length - 1] || monthHeaders[monthHeaders.length - 1];
    const firstLabel = firstVisible?.dataset.monthFullLabel || firstVisible?.dataset.monthLabel || '';
    const lastLabel = lastVisible?.dataset.monthFullLabel || lastVisible?.dataset.monthLabel || '';
    const text = firstLabel && lastLabel && firstLabel !== lastLabel
        ? `Viewing ${firstLabel} to ${lastLabel}`
        : `Viewing ${firstLabel || lastLabel || 'current month'}`;
    chips.forEach((chip) => { chip.textContent = text; });
}

function getCollectorScrollbarParts() {
    return {
        shell: document.getElementById('collectorHorizontalScrollbar'),
        track: document.getElementById('collectorHorizontalTrack'),
        thumb: document.getElementById('collectorHorizontalThumb')
    };
}

function updateCollectorHorizontalScrollbar() {
    const container = document.getElementById('collector-matrix-table');
    const { shell, track, thumb } = getCollectorScrollbarParts();
    if (!container || !shell || !track || !thumb) return;

    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    if (maxScroll <= 2) {
        shell.classList.add('is-disabled');
        track.setAttribute('aria-valuenow', '0');
        thumb.style.width = '100%';
        thumb.style.transform = 'translateX(0px)';
        return;
    }

    shell.classList.remove('is-disabled');
    const trackWidth = track.clientWidth || 1;
    const thumbWidth = Math.max(44, Math.round(trackWidth * (container.clientWidth / container.scrollWidth)));
    const thumbTravel = Math.max(1, trackWidth - thumbWidth);
    const thumbLeft = Math.round((container.scrollLeft / maxScroll) * thumbTravel);
    const percent = Math.round((container.scrollLeft / maxScroll) * 100);
    thumb.style.width = `${thumbWidth}px`;
    thumb.style.transform = `translateX(${thumbLeft}px)`;
    track.setAttribute('aria-valuenow', String(percent));
}

function fitCollectorMatrixViewport() {
    const container = document.getElementById('collector-matrix-table');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const rightGutter = window.innerWidth <= 900 ? 12 : 28;
    const availableWidth = Math.max(320, Math.floor(window.innerWidth - rect.left - rightGutter));
    container.style.width = `${availableWidth}px`;
    container.style.maxWidth = `${availableWidth}px`;
}

function setCollectorScrollFromTrack(clientX) {
    const container = document.getElementById('collector-matrix-table');
    const { track, thumb } = getCollectorScrollbarParts();
    if (!container || !track || !thumb) return;

    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const rect = track.getBoundingClientRect();
    const thumbWidth = thumb.offsetWidth || 44;
    const thumbTravel = Math.max(1, rect.width - thumbWidth);
    const rawLeft = clientX - rect.left - thumbWidth / 2;
    const clampedLeft = Math.max(0, Math.min(thumbTravel, rawLeft));
    container.scrollLeft = Math.round((clampedLeft / thumbTravel) * maxScroll);
    updateCollectorViewportRange();
    updateCollectorHorizontalScrollbar();
}

function scrollCollectorMatrix(direction) {
    const container = document.getElementById('collector-matrix-table');
    if (!container) return;
    fitCollectorMatrixViewport();
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const delta = Math.max(220, Math.round(container.clientWidth * 0.72)) * direction;
    const nextLeft = Math.max(0, Math.min(maxScroll, container.scrollLeft + delta));
    container.scrollTo({ left: nextLeft, behavior: 'smooth' });
    window.setTimeout(updateCollectorViewportRange, 220);
    window.setTimeout(updateCollectorHorizontalScrollbar, 220);
}

function getCollectorLatestMonthKey(data) {
    const columns = Array.isArray(data?.monthColumns) ? data.monthColumns : [];
    const current = columns.find((column) => column.isCurrentMonth);
    return current?.key || columns[columns.length - 1]?.key || '';
}

function scrollCollectorMatrixToMonth(monthKey, options = {}) {
    const container = document.getElementById('collector-matrix-table');
    if (!container || !monthKey) return;
    fitCollectorMatrixViewport();
    const header = Array.from(container.querySelectorAll('thead th[data-month-key]'))
        .find((node) => node.dataset.monthKey === monthKey);
    if (!header) return;

    const monthWidth = header.offsetWidth || 110;
    const leadInMonths = Number(options.leadInMonths ?? 2);
    const targetLeft = Math.max(0, header.offsetLeft - (monthWidth * leadInMonths));
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const nextLeft = Math.min(targetLeft, maxScroll);

    if (options.behavior === 'auto') {
        container.scrollLeft = nextLeft;
    } else {
        container.scrollTo({
            left: nextLeft,
            behavior: options.behavior || 'smooth'
        });
    }

    window.setTimeout(updateCollectorViewportRange, options.behavior === 'auto' ? 0 : 220);
    window.setTimeout(updateCollectorHorizontalScrollbar, options.behavior === 'auto' ? 0 : 220);
}

function scrollCollectorMatrixToLatest(options = {}) {
    const data = options.data || collectorDashboardData;
    scrollCollectorMatrixToMonth(getCollectorLatestMonthKey(data), options);
}

function scheduleCollectorLatestScroll(data) {
    [0, 80, 220, 500, 900].forEach((delay) => {
        window.setTimeout(() => {
            scrollCollectorMatrixToLatest({ data, behavior: 'auto' });
        }, delay);
    });
}

function bindCollectorMatrixViewport() {
    const container = document.getElementById('collector-matrix-table');
    if (!container) return;

    if (!collectorViewportBound) {
        container.addEventListener('scroll', () => {
            updateCollectorViewportRange();
            updateCollectorHorizontalScrollbar();
        }, { passive: true });
        document.getElementById('collectorScrollLeft')?.addEventListener('click', () => scrollCollectorMatrix(-1));
        document.getElementById('collectorScrollRight')?.addEventListener('click', () => scrollCollectorMatrix(1));
        document.getElementById('collectorScrollLeftInline')?.addEventListener('click', () => scrollCollectorMatrix(-1));
        document.getElementById('collectorScrollRightInline')?.addEventListener('click', () => scrollCollectorMatrix(1));
        document.getElementById('collectorScrollLatest')?.addEventListener('click', () => scrollCollectorMatrixToLatest({ behavior: 'smooth' }));
        document.getElementById('collectorScrollLatestInline')?.addEventListener('click', () => scrollCollectorMatrixToLatest({ behavior: 'smooth' }));
        document.getElementById('collectorScrollbarLeft')?.addEventListener('click', () => scrollCollectorMatrix(-1));
        document.getElementById('collectorScrollbarRight')?.addEventListener('click', () => scrollCollectorMatrix(1));

        container.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            if (event.target.closest('button, a, input, select, textarea')) return;
            collectorMatrixDragState = {
                startX: event.clientX,
                startScrollLeft: container.scrollLeft
            };
            container.classList.add('dragging');
        });

        window.addEventListener('mousemove', (event) => {
            if (!collectorMatrixDragState) return;
            const delta = event.clientX - collectorMatrixDragState.startX;
            container.scrollLeft = collectorMatrixDragState.startScrollLeft - delta;
            updateCollectorHorizontalScrollbar();
        });

        window.addEventListener('mouseup', () => {
            if (!collectorMatrixDragState) return;
            collectorMatrixDragState = null;
            container.classList.remove('dragging');
            updateCollectorViewportRange();
        });

        container.addEventListener('mouseleave', () => {
            if (!collectorMatrixDragState) return;
            collectorMatrixDragState = null;
            container.classList.remove('dragging');
        });

        const { track, thumb } = getCollectorScrollbarParts();
        track?.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            collectorScrollbarDragState = true;
            thumb?.classList.add('dragging');
            track.setPointerCapture?.(event.pointerId);
            setCollectorScrollFromTrack(event.clientX);
        });

        track?.addEventListener('pointermove', (event) => {
            if (!collectorScrollbarDragState) return;
            event.preventDefault();
            setCollectorScrollFromTrack(event.clientX);
        });

        const stopScrollbarDrag = (event) => {
            if (!collectorScrollbarDragState) return;
            collectorScrollbarDragState = null;
            thumb?.classList.remove('dragging');
            if (event?.pointerId !== undefined) track?.releasePointerCapture?.(event.pointerId);
            updateCollectorViewportRange();
            updateCollectorHorizontalScrollbar();
        };

        track?.addEventListener('pointerup', stopScrollbarDrag);
        track?.addEventListener('pointercancel', stopScrollbarDrag);
        track?.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                scrollCollectorMatrix(-1);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                scrollCollectorMatrix(1);
            }
        });

        window.addEventListener('resize', () => {
            fitCollectorMatrixViewport();
            updateCollectorViewportRange();
            updateCollectorHorizontalScrollbar();
        });

        collectorViewportBound = true;
    }

    fitCollectorMatrixViewport();
    updateCollectorViewportRange();
    updateCollectorHorizontalScrollbar();
}

function updateLoadingStatus(message) {
    const container = document.getElementById('table-container');
    if (!container) return;
    container.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div><span>${escapeHtml(message)}</span></div>`;
}

function showLoadError(message) {
    const errorBanner = document.getElementById('errorBanner');
    if (errorBanner) {
        errorBanner.textContent = message;
        errorBanner.classList.remove('hidden');
    }

    const container = document.getElementById('table-container');
    if (container) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Unable to load collection data</h3>
                <p>${escapeHtml(message)}</p>
            </div>
        `;
    }

    const pagination = document.getElementById('pagination');
    if (pagination) pagination.style.display = 'none';
}

function hideLoadError() {
    document.getElementById('errorBanner')?.classList.add('hidden');
}

async function firestoreGet(collection, pageSize = 300, pageToken = null, fieldMask = null) {
    const params = new URLSearchParams();
    params.set('pageSize', String(pageSize));
    params.set('key', API_KEY);
    if (pageToken) params.set('pageToken', pageToken);

    if (Array.isArray(fieldMask)) {
        fieldMask.forEach((path) => {
            if (path) params.append('mask.fieldPaths', path);
        });
    }

    const url = `${BASE_URL}/${collection}?${params.toString()}`;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`Failed to fetch ${collection}: ${response.status}`);
            return await response.json();
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, 400));
        } finally {
            clearTimeout(timeout);
        }
    }
}

async function firestoreGetAll(collection, statusCallback = null, options = {}) {
    const {
        pageSize: requestPageSize = 1000,
        maxPages = 200,
        fieldMask = null
    } = options;

    const allDocs = [];
    let pageToken = null;
    let page = 0;

    while (page < maxPages) {
        page += 1;
        const data = await firestoreGet(collection, requestPageSize, pageToken, fieldMask);
        if (Array.isArray(data.documents) && data.documents.length > 0) {
            allDocs.push(...data.documents);
        }

        if (statusCallback) statusCallback(`Loading ${collection}... ${allDocs.length.toLocaleString()}`);

        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
    }

    if (page >= maxPages && pageToken) {
        console.warn(`Reached max pages while loading ${collection}. Data may be incomplete.`);
    }

    return allDocs;
}

async function firestoreCreate(collection, fields) {
    const url = `${BASE_URL}/${collection}?key=${encodeURIComponent(API_KEY)}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to write ${collection}: ${response.status} ${message.slice(0, 140)}`);
    }

    return response.json();
}

async function firestoreSetDocument(collection, docId, fields) {
    const safeDocId = encodeURIComponent(String(docId || '').trim());
    if (!safeDocId) throw new Error(`Missing document id for ${collection}`);

    const url = `${BASE_URL}/${collection}/${safeDocId}?key=${encodeURIComponent(API_KEY)}`;
    const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to save ${collection}/${docId}: ${response.status} ${message.slice(0, 140)}`);
    }

    return response.json();
}

async function firestoreGetDocument(collection, docId) {
    const safeDocId = encodeURIComponent(String(docId || '').trim());
    if (!safeDocId) return null;

    const response = await fetch(`${BASE_URL}/${collection}/${safeDocId}?key=${encodeURIComponent(API_KEY)}`);
    if (response.status === 404) return null;
    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to load ${collection}/${docId}: ${response.status} ${message.slice(0, 140)}`);
    }

    return response.json();
}

async function firestoreRunQuery(structuredQuery) {
    const url = `${BASE_URL}:runQuery?key=${encodeURIComponent(API_KEY)}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to query Firestore: ${response.status} ${message.slice(0, 140)}`);
    }

    const rows = await response.json();
    return rows
        .map((row) => row.document)
        .filter(Boolean);
}

async function safeFirestoreGetAll(collection, statusCallback = null, options = {}) {
    try {
        return await firestoreGetAll(collection, statusCallback, options);
    } catch (error) {
        console.warn(`Unable to load optional collection ${collection}:`, error);
        return [];
    }
}

function toFirestoreWriteValue(value) {
    if (value === null || value === undefined) return { stringValue: '' };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return { stringValue: '' };
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    return { stringValue: String(value) };
}

function toFirestoreQueryValue(value) {
    const raw = String(value || '').trim();
    if (/^-?\d+$/.test(raw)) return { integerValue: raw };
    return { stringValue: raw };
}

function getFirestoreDocumentId(doc) {
    return String(doc?.name || '').split('/').pop() || '';
}

function monthNameToNumber(monthName) {
    const months = {
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
    return months[String(monthName || '').toLowerCase()] || 0;
}

function calculateAge(dueDate, month, year) {
    const due = normalizeDate(dueDate);
    if (due) return Math.max(0, daysBetween(due, new Date()));

    if (month && year) {
        const monthNum = monthNameToNumber(month);
        if (monthNum) {
            const date = new Date(Number(year), monthNum - 1, 1);
            if (!Number.isNaN(date.getTime())) return Math.max(0, daysBetween(date, new Date()));
        }
    }
    return 0;
}

function getPriority(age) {
    if (age >= 366) return { code: 'baddebt', label: 'Bad Debt', order: 5 };
    if (age >= 181) return { code: 'doubtful', label: 'Doubtful', order: 4 };
    if (age >= 121) return { code: 'review', label: 'For Review', order: 3 };
    if (age >= 91) return { code: 'urgent', label: 'Urgent', order: 0 };
    if (age >= 61) return { code: 'high', label: 'High', order: 1 };
    if (age >= 31) return { code: 'medium', label: 'Medium', order: 2 };
    return { code: 'current', label: 'Current', order: 6 };
}

function getAgeClass(days) {
    if (days >= 366) return 'age-365';
    if (days >= 180) return 'age-180';
    if (days >= 120) return 'age-120';
    if (days >= 90) return 'age-90';
    if (days >= 60) return 'age-60';
    if (days >= 30) return 'age-30';
    return 'age-current';
}

function getCategoryCode(categoryId) {
    const categories = { 1: 'RTP', 2: 'RTF', 3: 'STP', 4: 'MAT', 5: 'RTC', 6: 'STC', 7: 'MAC', 8: 'MAP', 9: 'REF', 10: 'RD' };
    return categories[Number(categoryId)] || '-';
}

function showWelcomeModal() {
    document.getElementById('welcomeModal')?.classList.remove('hidden');
}

function closeWelcomeModal() {
    document.getElementById('welcomeModal')?.classList.add('hidden');
    if (document.getElementById('dontShowAgain')?.checked) {
        localStorage.setItem('collections_hideWelcome', 'true');
    }
}

function checkWelcomeModal() {
    if (!localStorage.getItem('collections_hideWelcome')) showWelcomeModal();
}

function goToPriority(priority) {
    closeWelcomeModal();
    filterByPriority(priority);
}

function showRandomTip() {
    const tip = dailyTips[Math.floor(Math.random() * dailyTips.length)];
    const tipText = document.getElementById('tipText');
    if (tipText) tipText.textContent = tip;
}

function closeTip() {
    const tipBanner = document.getElementById('tipBanner');
    if (tipBanner) tipBanner.style.display = 'none';
}

function closeFollowupModal() {
    document.getElementById('followupModal')?.classList.add('hidden');
}

function closeDetailModal() {
    document.getElementById('detailModal')?.classList.add('hidden');
    currentDetailInvoice = null;
}

function showTodayFollowups() {
    const followupList = document.getElementById('followupList');
    const modal = document.getElementById('followupModal');
    if (!followupList || !modal) return;

    const scheduled = getTodayScheduledInvoices();

    if (scheduled.length === 0) {
        followupList.innerHTML = '<div class="empty-followup">No scheduled collections for today.</div>';
    } else {
        followupList.innerHTML = `
            <div class="followup-list">
                ${scheduled
                    .map(
                        (inv) => `
                    <div class="followup-item" onclick="viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
                        <div class="followup-company">${escapeHtml(inv.company)}</div>
                        <div class="followup-invoice">Invoice #${escapeHtml(inv.invoiceNo)} • ${escapeHtml(formatCurrency(inv.amount))}</div>
                    </div>
                `
                    )
                    .join('')}
            </div>
        `;
    }

    modal.classList.remove('hidden');
}

function getHistoryForInvoice(...keys) {
    const merged = [];
    const seen = new Set();

    keys
        .filter((k) => k !== null && k !== undefined && k !== '')
        .map((k) => String(k).trim())
        .forEach((key) => {
            const entries = collectionHistory[key] || [];
            entries.forEach((entry) => {
                const token = `${entry.docId}|${entry.callDateKey || ''}|${entry.followupDateKey || ''}|${entry.remarks || ''}`;
                if (seen.has(token)) return;
                seen.add(token);
                merged.push(entry);
            });
        });

    merged.sort((a, b) => {
        const aTime = a.callDate ? a.callDate.getTime() : 0;
        const bTime = b.callDate ? b.callDate.getTime() : 0;
        return bTime - aTime;
    });

    return merged;
}

async function loadCollectionHistory() {
    const historyDocs = await firestoreGetAll('tbl_collectionhistory', null, {
        fieldMask: [
            'invoice_num',
            'invoice_id',
            'invoice_no',
            'invoiceno',
            'followup_datetime',
            'followup_date',
            'next_followup',
            'schedule_status',
            'status_id',
            'location_id',
            'location_label',
            'ischecksigned',
            'check_number',
            'payment_amount',
            'collection_id',
            'employee_id',
            'remarks',
            'contact_person',
            'contact_number',
            'timestamp',
            'call_datetime',
            'created_at'
        ],
        maxPages: 60
    });

    collectionHistory = {};
    todayFollowups = [];

    const todayKey = toDateKey(new Date());

    historyDocs.forEach((doc) => {
        const f = doc.fields || {};
        const invoiceRef = getField(f, ['invoice_num', 'invoice_id', 'invoice_no', 'invoiceno']);
        if (!invoiceRef) return;

        const invoiceKey = String(invoiceRef).trim();
        if (!invoiceKey) return;

        const followupDateRaw = getField(f, ['followup_datetime', 'followup_date', 'next_followup']);
        const callDateRaw = getField(f, ['timestamp', 'call_datetime', 'created_at']) || followupDateRaw;

        const followupDate = normalizeDate(followupDateRaw);
        const callDate = normalizeDate(callDateRaw);

        const entry = {
            docId: doc.name || String(Math.random()),
            invoiceKey,
            remarks: getField(f, ['remarks']) || 'No remarks',
            contactPerson: getField(f, ['contact_person']) || '-',
            contactNumber: getField(f, ['contact_number']) || '',
            scheduleStatus: getField(f, ['schedule_status']),
            statusId: getField(f, ['status_id']),
            locationId: getField(f, ['location_id']),
            locationLabel: getField(f, ['location_label']),
            isCheckSigned: Boolean(getField(f, ['ischecksigned'])),
            checkNumber: getField(f, ['check_number']) || '',
            paymentAmount: Number(getField(f, ['payment_amount']) || 0),
            collectionId: getField(f, ['collection_id']),
            employeeId: getField(f, ['employee_id']),
            followupDate,
            followupDateRaw,
            followupDateKey: toDateKey(followupDate),
            callDate,
            callDateRaw,
            callDateKey: toDateKey(callDate)
        };

        if (!collectionHistory[invoiceKey]) collectionHistory[invoiceKey] = [];
        collectionHistory[invoiceKey].push(entry);

        if (entry.followupDateKey && entry.followupDateKey === todayKey) {
            todayFollowups.push({
                invoiceKey,
                followupDate: entry.followupDate,
                remarks: entry.remarks,
                contactPerson: entry.contactPerson,
                scheduleStatus: entry.scheduleStatus
            });
        }
    });

    Object.keys(collectionHistory).forEach((key) => {
        collectionHistory[key].sort((a, b) => {
            const aTime = a.callDate ? a.callDate.getTime() : 0;
            const bTime = b.callDate ? b.callDate.getTime() : 0;
            return bTime - aTime;
        });
    });

    const followupSeen = new Set();
    todayFollowups = todayFollowups.filter((item) => {
        const token = item.invoiceKey;
        if (followupSeen.has(token)) return false;
        followupSeen.add(token);
        return true;
    });
}

function updateFollowupBadge() {
    const badge = document.getElementById('followupBadge');
    if (!badge) return;

    if (todayFollowups.length > 0) {
        badge.textContent = todayFollowups.length.toLocaleString();
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

async function buildMachineToBranchMap() {
    const historyDocs = await firestoreGetAll('tbl_newmachinehistory', null, {
        fieldMask: ['mach_id', 'branch_id', 'status_id', 'datex'],
        maxPages: 120
    });

    const machineDeliveries = {};

    historyDocs.forEach((doc) => {
        const f = doc.fields || {};
        const machId = String(getField(f, ['mach_id']) || '').trim();
        const branchId = getField(f, ['branch_id']);
        const statusId = getField(f, ['status_id']);
        const datex = normalizeDate(getField(f, ['datex']));

        if (!machId || !branchId) return;
        if (Number(statusId) !== 2) return;

        if (!machineDeliveries[machId]) machineDeliveries[machId] = [];
        machineDeliveries[machId].push({
            branchId: String(branchId),
            date: datex
        });
    });

    machToBranchMap = {};

    Object.entries(machineDeliveries).forEach(([machId, deliveries]) => {
        deliveries.sort((a, b) => {
            const aTime = a.date ? a.date.getTime() : 0;
            const bTime = b.date ? b.date.getTime() : 0;
            return bTime - aTime;
        });
        machToBranchMap[machId] = deliveries[0].branchId;
    });
}

async function loadLookups() {
    if (lookupsLoaded) return;

    updateLoadingStatus('Loading company and branch data...');

    const [companyDocs, branchDocs, contractDocs, contractDepDocs, machineDocs] = await Promise.all([
        firestoreGetAll('tbl_companylist', null, {
            fieldMask: ['id', 'companyname'],
            maxPages: 20
        }),
        firestoreGetAll('tbl_branchinfo', null, {
            fieldMask: ['id', 'company_id', 'branchname', 'branch_address', 'bldg', 'floor', 'street', 'brgy', 'city', 'email'],
            maxPages: 30
        }),
        firestoreGetAll('tbl_contractmain', null, {
            fieldMask: ['id', 'contract_id', 'mach_id', 'category_id', 'xserial'],
            maxPages: 40
        }),
        firestoreGetAll('tbl_contractdep', null, {
            fieldMask: ['id', 'branch_id', 'departmentname'],
            maxPages: 40
        }),
        firestoreGetAll('tbl_machine', null, {
            fieldMask: ['id', 'serial', 'model_id', 'description'],
            maxPages: 80
        })
    ]);

    companyMap = {};
    companyDocs.forEach((doc) => {
        const id = String(getField(doc.fields || {}, ['id']) || '').trim();
        if (!id) return;
        companyMap[id] = getField(doc.fields || {}, ['companyname']) || 'Unknown';
    });

    branchMap = {};
    branchDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;

        branchMap[id] = {
            id,
            name: getField(f, ['branchname']) || 'Main',
            companyId: String(getField(f, ['company_id']) || '').trim(),
            address: buildAddressText([
                getField(f, ['branch_address']),
                getField(f, ['bldg']),
                getField(f, ['floor']),
                getField(f, ['street']),
                getField(f, ['brgy']),
                getField(f, ['city'])
            ]),
            email: String(getField(f, ['email']) || '').trim()
        };
    });

    contractDepMap = {};
    contractDepDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;
        contractDepMap[id] = {
            id,
            branchId: String(getField(f, ['branch_id']) || '').trim(),
            departmentName: String(getField(f, ['departmentname']) || '').trim()
        };
    });

    contractMap = {};
    contractDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;

        contractMap[id] = {
            contractId: String(getField(f, ['contract_id']) || '').trim(),
            machId: String(getField(f, ['mach_id']) || '').trim(),
            categoryId: getField(f, ['category_id']),
            xserial: String(getField(f, ['xserial']) || '').trim()
        };
    });

    machineMap = {};
    machineDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;
        machineMap[id] = {
            serial: String(getField(f, ['serial']) || '').trim(),
            modelId: String(getField(f, ['model_id']) || '').trim(),
            description: String(getField(f, ['description']) || '').trim()
        };
    });

    updateLoadingStatus('Loading machine location map...');
    await buildMachineToBranchMap();

    updateLoadingStatus('Loading payment records...');
    const paymentDocs = await firestoreGetAll('tbl_paymentinfo', updateLoadingStatus, {
        fieldMask: ['id', 'invoice_id', 'invoice_num', 'payment_amt', 'balance_amt', 'date_deposit', 'date_paid', 'tax_date_paid', 'ornum', 'or_number', 'payment_type', 'tax_2307', 'tax_status', 'checkpayment_id', 'remarks'],
        maxPages: 260
    });

    paidInvoiceIds = new Set();
    paymentEntries = [];
    paymentDocs.forEach((doc) => {
        const f = doc.fields || {};
        const invoiceId = getField(f, ['invoice_id']);
        if (invoiceId !== null && invoiceId !== undefined && invoiceId !== '') {
            paidInvoiceIds.add(String(invoiceId).trim());
        }

        const amount = Number(getField(f, ['payment_amt']) || 0);
        const tax2307 = Number(getField(f, ['tax_2307']) || 0);
        const balanceAmountRaw = getField(f, ['balance_amt']);
        const balanceAmount = balanceAmountRaw !== null && balanceAmountRaw !== undefined ? Number(balanceAmountRaw) : null;
        const paymentDate = normalizeDate(getField(f, ['date_deposit', 'date_paid', 'tax_date_paid']));
        if ((amount > 0 || tax2307 > 0) && paymentDate) {
            paymentEntries.push({
                docId: getFirestoreDocumentId(doc),
                id: String(getField(f, ['id']) || getFirestoreDocumentId(doc) || '').trim(),
                invoiceId: invoiceId !== null && invoiceId !== undefined ? String(invoiceId).trim() : '',
                invoiceNo: String(getField(f, ['invoice_num']) || '').trim(),
                amount,
                balanceAmount,
                paymentDate,
                datePaid: normalizeDate(getField(f, ['date_paid'])),
                dateDeposit: normalizeDate(getField(f, ['date_deposit'])),
                taxDatePaid: normalizeDate(getField(f, ['tax_date_paid'])),
                orNumber: String(getField(f, ['ornum', 'or_number']) || '').trim(),
                paymentType: String(getField(f, ['payment_type']) || '').trim(),
                tax2307,
                taxStatus: String(getField(f, ['tax_status']) || '').trim(),
                checkpaymentId: String(getField(f, ['checkpayment_id']) || '').trim(),
                remarks: String(getField(f, ['remarks']) || '').trim()
            });
        }
    });

    updateLoadingStatus('Loading collection history...');
    await loadCollectionHistory();

    lookupsLoaded = true;
}

function buildMachineLabel(machineId, contractmainId) {
    const machine = String(machineId || '').trim();
    if (machine) return `Machine ${machine}`;
    return `Contract ${String(contractmainId || '').trim()}`;
}

function isMachineFallbackSerial(value) {
    return /^machine\s+\S+/i.test(String(value || '').trim());
}

function normalizeSerialNumber(value) {
    const serial = String(value || '').trim();
    if (!serial || isMachineFallbackSerial(serial)) return '';
    return serial;
}

function displaySerialNumber(value) {
    return normalizeSerialNumber(value) || 'No serial on file';
}

function buildCollectorRowKey(machineId, contractmainId) {
    const contractId = String(contractmainId || '').trim();
    if (contractId) return `contract:${contractId}`;
    const machine = String(machineId || '').trim();
    if (machine) return `machine:${machine}`;
    return `contract:unknown`;
}

function resolveSerialLabel(contract) {
    const contractSerial = normalizeSerialNumber(contract?.xserial);
    if (contractSerial) return contractSerial;
    const machId = String(contract?.machId || '').trim();
    const machineSerial = normalizeSerialNumber(machineMap[machId]?.serial);
    if (machineSerial) return machineSerial;
    return '';
}

function resolveContractBranch(contract) {
    const contractDepId = String(contract?.contractId || '').trim();
    const contractDep = contractDepMap[contractDepId] || null;
    const directBranchId = String(contractDep?.branchId || contract?.contractId || '').trim();
    const directBranch = branchMap[directBranchId];

    if (directBranch) {
        const departmentName = String(contractDep?.departmentName || '').trim();
        if (!departmentName) return directBranch;

        const baseName = String(directBranch.name || 'Main').trim() || 'Main';
        const normalizedBase = baseName.toLowerCase();
        const normalizedDept = departmentName.toLowerCase();
        return {
            ...directBranch,
            name: normalizedBase.includes(normalizedDept)
                ? baseName
                : `${baseName} - ${departmentName}`
        };
    }

    const machId = String(contract?.machId || '').trim();
    const fallbackBranchId = String(machToBranchMap[machId] || '').trim();
    const fallbackBranch = fallbackBranchId ? branchMap[fallbackBranchId] : null;
    if (fallbackBranch) return fallbackBranch;

    const unresolvedBranchId = directBranchId || fallbackBranchId || contractDepId;
    if (unresolvedBranchId) {
        return {
            id: `unlinked:${unresolvedBranchId}`,
            companyId: `unlinked:${unresolvedBranchId}`,
            name: `Unlinked Branch ${unresolvedBranchId}`,
            companyNameOverride: 'Unlinked in Firebase'
        };
    }

    return null;
}

function getBillingLocation(contractmainId) {
    const contract = contractMap[String(contractmainId || '').trim()] || {};
    const branch = resolveContractBranch(contract);
    const companyName = branch?.companyNameOverride || companyMap[String(branch?.companyId || '').trim()] || 'Unknown';
    const branchName = branch?.name || 'Main';
    const machId = String(contract.machId || '').trim();
    const machine = machineMap[machId] || {};

    return {
        companyName,
        branchName,
        accountLabel: buildAccountLabel(companyName, branchName),
        categoryCode: getCategoryCode(contract.categoryId),
        companyId: String(branch?.companyId || '').trim(),
        branchId: String(branch?.id || '').trim(),
        machineId: machId,
        contractmainId: String(contractmainId || '').trim(),
        serialNumber: resolveSerialLabel({ ...contract, id: contractmainId }),
        modelName: String(machine.description || '').trim(),
        machineLabel: buildMachineLabel(contract.machId, contractmainId)
    };
}

function buildAccountLabel(companyName, branchName) {
    const company = String(companyName || '').trim();
    const branch = String(branchName || '').trim();

    if (!branch || branch.toLowerCase() === 'main') return company || 'Unknown';
    if (!company) return branch;

    const normalize = (value) => String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const companyLower = normalize(company);
    const branchLower = normalize(branch);

    if (branchLower.includes(companyLower) || companyLower.includes(branchLower)) {
        return branch;
    }

    return `${company} - ${branch}`;
}

function processInvoice(doc) {
    const f = doc.fields || {};

    const invoiceId = getField(f, ['invoice_id', 'invoiceid']);
    const invoiceNo = getField(f, ['invoiceno', 'invoice_no', 'invoice_id', 'id']);

    const invoiceIdKey = invoiceId !== null && invoiceId !== undefined ? String(invoiceId).trim() : '';
    const invoiceNoKey = invoiceNo !== null && invoiceNo !== undefined ? String(invoiceNo).trim() : '';

    if (!invoiceIdKey && !invoiceNoKey) return null;
    if (paidInvoiceIds.has(invoiceIdKey) || paidInvoiceIds.has(invoiceNoKey)) return null;

    const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
    const location = getBillingLocation(contractmainId);

    const month = getField(f, ['month']);
    const year = getField(f, ['year']);
    const dueDate = getField(f, ['due_date']);
    const invoiceDateRaw = getField(f, ['dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex']);
    const invoiceDate = normalizeDate(invoiceDateRaw);
    const dateReceived = normalizeDate(getField(f, ['date_received']));
    const receivedBy = String(getField(f, ['receivedby']) || '').trim();
    const billingContactNumber = getField(f, ['contact_number']) || '';

    const age = calculateAge(dueDate, month, year);
    const totalAmount = Number(getField(f, ['totalamount', 'amount']) || 0);
    const vatAmount = Number(getField(f, ['vatamount']) || 0);

    const history = getHistoryForInvoice(invoiceIdKey, invoiceNoKey);
    const lastHistory = history.length > 0 ? history[0] : null;
    const historyContact = history.find((entry) => hasMeaningfulContact(entry.contactNumber))?.contactNumber || '';
    const lastContactDate = lastHistory ? lastHistory.callDate : null;
    const lastContactDays = lastContactDate ? Math.max(0, daysBetween(lastContactDate, new Date())) : null;

    return {
        id: getField(f, ['id']),
        invoiceId: invoiceIdKey || invoiceNoKey,
        invoiceNo: invoiceNoKey || invoiceIdKey,
        invoiceKey: invoiceNoKey || invoiceIdKey,
        amount: totalAmount + vatAmount,
        month,
        year,
        monthYear: month && year ? `${month} ${year}` : '-',
        invoiceDate,
        invoiceDateRaw,
        dueDate,
        dateReceived,
        receivedBy,
        billingStatus: getField(f, ['status']),
        billingLocation: getField(f, ['location']),
        billingRemarks: getField(f, ['remarks']),
        age,
        priority: getPriority(age),
        company: location.companyName,
        branch: location.branchName,
        accountLabel: location.accountLabel,
        companyId: location.companyId,
        branchId: location.branchId,
        machineId: location.machineId,
        contractmainId: location.contractmainId,
        serialNumber: location.serialNumber,
        modelName: location.modelName,
        machineLabel: location.machineLabel,
        contactNumber: billingContactNumber || historyContact || '',
        category: location.categoryCode,
        lastRemarks: lastHistory ? lastHistory.remarks : null,
        lastContactDate,
        lastContactDays,
        nextFollowup: lastHistory ? lastHistory.followupDate : null,
        historyCount: history.length,
        history
    };
}

function rebuildInvoiceIndex() {
    invoiceIndexMap = new Map();
    allInvoices.forEach((invoice) => {
        if (invoice.invoiceNo) invoiceIndexMap.set(String(invoice.invoiceNo), invoice);
        if (invoice.invoiceId) invoiceIndexMap.set(String(invoice.invoiceId), invoice);
        if (invoice.id !== null && invoice.id !== undefined) invoiceIndexMap.set(String(invoice.id), invoice);
    });
}

function findInvoiceByKey(key) {
    if (key === null || key === undefined) return null;
    return invoiceIndexMap.get(String(key).trim()) || null;
}

async function loadInvoices(mode) {
    dataMode = mode;
    const isAllMode = mode === 'all';
    lastLoadSucceeded = false;

    document.getElementById('btnShowBadDebt')?.classList.toggle('active', isAllMode);
    hideLoadError();

    try {
        await loadLookups();

        updateLoadingStatus(isAllMode ? 'Loading all billing records...' : 'Loading active billing records...');
        const billingDocs = await firestoreGetAll('tbl_billing', updateLoadingStatus, {
            fieldMask: [
                'id',
                'invoice_id',
                'invoiceid',
                'invoiceno',
                'invoice_no',
                'contractmain_id',
                'month',
                'year',
                'due_date',
                'totalamount',
                'amount',
                'vatamount',
                'contact_number',
                'date_received',
                'receivedby',
                'isreceived',
                'status',
                'location',
                'remarks',
                'dateprinted',
                'date_printed',
                'invdate',
                'invoice_date',
                'datex'
            ],
            maxPages: 320
        });

        allInvoices = [];
        billingEntriesForDuration = [];
        billingMetaByInvoiceKey = new Map();
        collectorBillingRecords = [];
        const years = new Set();

        billingDocs.forEach((doc) => {
            const f = doc.fields || {};
            const invoiceIdRaw = getField(f, ['invoice_id', 'invoiceid']);
            const invoiceId = invoiceIdRaw !== null && invoiceIdRaw !== undefined ? String(invoiceIdRaw).trim() : '';
            const invoiceNoRaw = getField(f, ['invoiceno', 'invoice_no', 'invoice_id', 'id']);
            const invoiceNo = invoiceNoRaw !== null && invoiceNoRaw !== undefined ? String(invoiceNoRaw).trim() : '';
            const billingMonth = getField(f, ['month']);
            const billingYear = getField(f, ['year']);
            const invoiceDate = normalizeDate(getField(f, ['dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'due_date']));
            const dueDate = normalizeDate(getField(f, ['due_date']));
            const billingPeriodMonthKey = getBillingPeriodMonthKey(billingMonth, billingYear, invoiceDate);
            const dateReceived = normalizeDate(getField(f, ['date_received']));
            const receivedBy = String(getField(f, ['receivedby']) || '').trim();
            const matrixAmount = Number(getField(f, ['totalamount', 'amount']) || 0);
            const amount = matrixAmount + Number(getField(f, ['vatamount']) || 0);
            const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
            const location = getBillingLocation(contractmainId);
            const billingMeta = {
                company: location.companyName,
                branch: location.branchName,
                accountLabel: location.accountLabel,
                invoiceDate,
                dueDate,
                month: billingMonth,
                year: billingYear
            };

            if (invoiceId) billingMetaByInvoiceKey.set(invoiceId, billingMeta);
            if (invoiceNo) billingMetaByInvoiceKey.set(invoiceNo, billingMeta);

            if (invoiceDate && matrixAmount > 0) {
                collectorBillingRecords.push({
                    invoiceId,
                    invoiceNo: invoiceNo || invoiceId,
                    invoiceKey: invoiceNo || invoiceId,
                    company: location.companyName,
                    branch: location.branchName,
                    accountLabel: location.accountLabel,
                    companyId: location.companyId,
                    branchId: location.branchId,
                    machineId: location.machineId,
                    contractmainId: location.contractmainId,
                    serialNumber: location.serialNumber,
                    modelName: location.modelName,
                    machineLabel: location.machineLabel,
                    invoiceDate,
                    dueDate,
                    dateReceived,
                    receivedBy,
                    billingStatus: getField(f, ['status']),
                    billingLocation: getField(f, ['location']),
                    billingRemarks: getField(f, ['remarks']),
                    amount: matrixAmount,
                    rd: invoiceDate.getDate(),
                    monthKey: billingPeriodMonthKey
                });

                billingEntriesForDuration.push({
                    invoiceDate,
                    amount,
                    isPaid: invoiceId ? paidInvoiceIds.has(invoiceId) : false
                });
            }

            const invoice = processInvoice(doc);
            if (!invoice) return;
            if (!isAllMode && invoice.age > 180) return;

            allInvoices.push(invoice);
            if (invoice.year) years.add(String(invoice.year));
        });

        allInvoices.sort((a, b) => {
            if (a.priority.order !== b.priority.order) return a.priority.order - b.priority.order;
            if (b.age !== a.age) return b.age - a.age;
            return b.amount - a.amount;
        });

        rebuildInvoiceIndex();
        populateYearFilter(years);

        collectorDashboardData = null;
        currentPage = 1;
        await recomputeFilteredInvoices();

        const lastUpdated = document.getElementById('last-updated');
        if (lastUpdated) lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
        lastLoadSucceeded = true;
        return true;
    } catch (error) {
        console.error('Collections load failed:', error);
        showLoadError('Collection report loading failed. Please click Refresh and try again.');
        return false;
    }
}

async function loadActiveInvoices() {
    await loadInvoices('active');
}

async function loadAllInvoices() {
    await loadInvoices('all');
}

function toggleBadDebt() {
    if (dataMode === 'active') loadAllInvoices();
    else loadActiveInvoices();
}

async function loadUnpaidInvoices() {
    if (dataMode === 'all') await loadAllInvoices();
    else await loadActiveInvoices();
}

function populateYearFilter(years) {
    const select = document.getElementById('filter-year');
    if (!select) return;

    select.innerHTML = '<option value="">All</option>';
    Array.from(years)
        .sort((a, b) => Number(b) - Number(a))
        .forEach((year) => {
            select.innerHTML += `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`;
        });
}

function setQuickAgeFilter(bucket) {
    quickAgeFilter = bucket;

    document.querySelectorAll('.quick-age-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.bucket === bucket);
    });

    currentPage = 1;
    recomputeFilteredInvoices();
}

function ageMatchesQuickFilter(age) {
    if (quickAgeFilter === 'all') return true;
    if (quickAgeFilter === '30') return age >= 30;
    if (quickAgeFilter === '60') return age >= 60;
    if (quickAgeFilter === '90') return age >= 90;
    if (quickAgeFilter === '120') return age >= 120;
    return true;
}

function ageMatchesRangeFilter(age, filter) {
    if (!filter) return true;
    if (filter === '366+') return age >= 366;

    const [min, max] = filter.split('-').map(Number);
    if (Number.isNaN(min) || Number.isNaN(max)) return true;
    return age >= min && age <= max;
}

function invoiceDateInRange(invoice, fromDate, toDate) {
    if (!fromDate && !toDate) return true;

    const date = invoice.invoiceDate || normalizeDate(invoice.dueDate);
    if (!date) return false;

    if (fromDate && date < fromDate) return false;
    if (toDate) {
        const inclusiveTo = new Date(toDate.getTime());
        inclusiveTo.setHours(23, 59, 59, 999);
        if (date > inclusiveTo) return false;
    }

    return true;
}

function recomputeFilteredInvoices() {
    const yearFilter = document.getElementById('filter-year')?.value || '';
    const monthFilter = document.getElementById('filter-month')?.value || '';
    const ageFilter = document.getElementById('filter-age')?.value || '';
    const categoryFilter = document.getElementById('filter-category')?.value || '';
    const searchTerm = (document.getElementById('search-input')?.value || '').trim().toLowerCase();

    const fromDate = normalizeDate(document.getElementById('filter-from-date')?.value);
    const toDate = normalizeDate(document.getElementById('filter-to-date')?.value);

    filteredInvoices = allInvoices.filter((invoice) => {
        if (currentPriorityFilter) {
            if (currentPriorityFilter === 'review') {
                if (invoice.priority.code !== 'review' && invoice.priority.code !== 'doubtful') return false;
            } else if (invoice.priority.code !== currentPriorityFilter) {
                return false;
            }
        }

        if (!ageMatchesQuickFilter(invoice.age)) return false;
        if (!ageMatchesRangeFilter(invoice.age, ageFilter)) return false;
        if (!invoiceDateInRange(invoice, fromDate, toDate)) return false;

        if (yearFilter && String(invoice.year || '') !== yearFilter) return false;
        if (monthFilter && String(invoice.month || '') !== monthFilter) return false;
        if (categoryFilter && invoice.category !== categoryFilter) return false;

        if (searchTerm) {
            const haystack = `${invoice.invoiceNo} ${invoice.company} ${invoice.branch}`.toLowerCase();
            if (!haystack.includes(searchTerm)) return false;
        }

        return true;
    });

    updateAllStats();
    updateDurationSummary();
    const collectorDashboardPromise = renderCollectorDashboard();
    renderTrendDashboard();
    renderTable();
    showActiveFilters();
    renderTodayScheduleTable();
    renderPromiseDueTable();
    renderUrgentStaleTable();
    renderMissingContactTable();
    updateFollowupBadge();
    updateActionBrief();
    updateQueueContext();
    return collectorDashboardPromise;
}

function applyFilters() {
    currentPage = 1;
    recomputeFilteredInvoices();
}

function clearFilterInputs() {
    const ids = [
        'filter-year',
        'filter-month',
        'filter-age',
        'filter-category',
        'filter-from-date',
        'filter-to-date',
        'search-input'
    ];

    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = '';
    });
}

function clearFilters() {
    clearFilterInputs();
    currentPriorityFilter = null;

    document.querySelectorAll('.priority-card').forEach((card) => card.classList.remove('active'));
    setQuickAgeFilter('all');
    currentPage = 1;
    recomputeFilteredInvoices();
}

function filterByPriority(priority) {
    if (currentPriorityFilter === priority) {
        currentPriorityFilter = null;
    } else {
        currentPriorityFilter = priority;
    }

    document.querySelectorAll('.priority-card').forEach((card) => card.classList.remove('active'));
    if (currentPriorityFilter) {
        document.querySelector(`.priority-card.${currentPriorityFilter}`)?.classList.add('active');
    }

    currentPage = 1;
    recomputeFilteredInvoices();
    scrollToWorkQueue();
}

function removeFilter(fieldId) {
    if (fieldId === 'priority') {
        currentPriorityFilter = null;
        document.querySelectorAll('.priority-card').forEach((card) => card.classList.remove('active'));
        currentPage = 1;
        recomputeFilteredInvoices();
        return;
    }

    if (fieldId === 'quick-age') {
        setQuickAgeFilter('all');
        return;
    }

    const element = document.getElementById(fieldId);
    if (element) {
        element.value = '';
        currentPage = 1;
        recomputeFilteredInvoices();
    }
}

function showActiveFilters() {
    const filters = [];

    if (currentPriorityFilter) {
        filters.push({ label: `Priority: ${currentPriorityFilter.toUpperCase()}`, field: 'priority' });
    }

    if (quickAgeFilter !== 'all') {
        filters.push({ label: `Age Quick: ${quickAgeFilter}+ days`, field: 'quick-age' });
    }

    const filterYear = document.getElementById('filter-year')?.value;
    const filterMonth = document.getElementById('filter-month')?.value;
    const filterAge = document.getElementById('filter-age')?.value;
    const filterCategory = document.getElementById('filter-category')?.value;
    const fromDate = document.getElementById('filter-from-date')?.value;
    const toDate = document.getElementById('filter-to-date')?.value;
    const search = document.getElementById('search-input')?.value?.trim();

    if (filterYear) filters.push({ label: `Year: ${filterYear}`, field: 'filter-year' });
    if (filterMonth) filters.push({ label: `Month: ${filterMonth}`, field: 'filter-month' });
    if (filterAge) filters.push({ label: `Age: ${filterAge}`, field: 'filter-age' });
    if (filterCategory) filters.push({ label: `Category: ${filterCategory}`, field: 'filter-category' });
    if (fromDate) filters.push({ label: `From: ${fromDate}`, field: 'filter-from-date' });
    if (toDate) filters.push({ label: `To: ${toDate}`, field: 'filter-to-date' });
    if (search) filters.push({ label: `Search: "${search}"`, field: 'search-input' });

    const container = document.getElementById('active-filters');
    if (!container) return;

    container.innerHTML =
        filters.length === 0
            ? ''
            : filters
                  .map(
                      (filter) =>
                          `<span class="filter-tag">${escapeHtml(filter.label)} <span class="remove" onclick="removeFilter('${escapeHtml(
                              filter.field
                          )}')">x</span></span>`
                  )
                  .join('');
}

function updateQueueContext() {
    const node = document.getElementById('queue-context');
    if (!node) return;

    const priorityText = currentPriorityFilter ? `Priority: ${currentPriorityFilter.toUpperCase()}` : 'All priorities';
    node.textContent = `${priorityText} • ${filteredInvoices.length.toLocaleString()} account(s) in queue`;
}

function scrollToWorkQueue() {
    const node = document.getElementById('collector-work-queue');
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateAllStats() {
    const counts = { current: 0, medium: 0, high: 0, urgent: 0, review: 0, doubtful: 0, baddebt: 0 };
    const amounts = { current: 0, medium: 0, high: 0, urgent: 0, review: 0, doubtful: 0, baddebt: 0 };

    allInvoices.forEach((invoice) => {
        counts[invoice.priority.code] = (counts[invoice.priority.code] || 0) + 1;
        amounts[invoice.priority.code] = (amounts[invoice.priority.code] || 0) + invoice.amount;
    });

    ['current', 'medium', 'high', 'urgent', 'review', 'baddebt'].forEach((key) => {
        const countEl = document.getElementById(`count-${key}`);
        const amountEl = document.getElementById(`amount-${key}`);

        if (countEl) countEl.textContent = Number(counts[key] || 0).toLocaleString();
        if (amountEl) amountEl.textContent = formatCurrencyShort(amounts[key] || 0);
    });

    const reviewCount = (counts.review || 0) + (counts.doubtful || 0);
    const reviewAmount = (amounts.review || 0) + (amounts.doubtful || 0);
    const reviewCountEl = document.getElementById('count-review');
    const reviewAmountEl = document.getElementById('amount-review');
    if (reviewCountEl) reviewCountEl.textContent = reviewCount.toLocaleString();
    if (reviewAmountEl) reviewAmountEl.textContent = formatCurrencyShort(reviewAmount);

    const totalPayables = allInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    const activeAmount = allInvoices.filter((inv) => inv.age <= 120).reduce((sum, inv) => sum + inv.amount, 0);
    const collectibleCount = allInvoices.filter((inv) => inv.age <= 120).length;

    document.getElementById('total-unpaid').textContent = formatCurrency(totalPayables);
    document.getElementById('total-active').textContent = formatCurrencyShort(activeAmount);
    document.getElementById('invoice-count').textContent = filteredInvoices.length.toLocaleString();
    document.getElementById('collectible-count').textContent = collectibleCount.toLocaleString();
    document.getElementById('dataMode').textContent = dataMode === 'all' ? '(All Data)' : '(Active 0-180 days)';

    const scheduledToday = getTodayScheduledInvoices();
    const scheduledTotal = scheduledToday.reduce((sum, inv) => sum + inv.amount, 0);

    document.getElementById('scheduled-count').textContent = scheduledToday.length.toLocaleString();
    document.getElementById('scheduled-amount').textContent = formatCurrencyShort(scheduledTotal);

    const staleUrgent = getUrgentNotCalledInvoices();
    const staleUrgentTotal = staleUrgent.reduce((sum, inv) => sum + inv.amount, 0);

    document.getElementById('stale-urgent-count').textContent = staleUrgent.length.toLocaleString();
    document.getElementById('stale-urgent-amount').textContent = formatCurrencyShort(staleUrgentTotal);
}

function updateDurationSummary() {
    const rangeLabelNode = document.getElementById('duration-range-label');
    const rangeHelpNode = document.getElementById('duration-range-help');
    const totalBillNode = document.getElementById('duration-total-bill');
    const totalBillCountNode = document.getElementById('duration-total-bill-count');
    const totalCollectionsNode = document.getElementById('duration-total-collections');
    const totalCollectionsCountNode = document.getElementById('duration-total-collections-count');
    const needCollectNode = document.getElementById('duration-need-collect');
    const needCollectCountNode = document.getElementById('duration-need-collect-count');

    if (!rangeLabelNode || !rangeHelpNode || !totalBillNode || !totalBillCountNode || !totalCollectionsNode || !totalCollectionsCountNode || !needCollectNode || !needCollectCountNode) {
        return;
    }

    const fromDate = normalizeDate(document.getElementById('filter-from-date')?.value);
    const toDate = normalizeDate(document.getElementById('filter-to-date')?.value);

    let totalBill = 0;
    let totalBillCount = 0;
    let needCollect = 0;
    let needCollectCount = 0;

    billingEntriesForDuration.forEach((entry) => {
        if (!isDateWithinRange(entry.invoiceDate, fromDate, toDate)) return;
        totalBill += entry.amount;
        totalBillCount += 1;
        if (!entry.isPaid) {
            needCollect += entry.amount;
            needCollectCount += 1;
        }
    });

    let totalCollections = 0;
    let totalCollectionsCount = 0;
    paymentEntries.forEach((entry) => {
        if (!isDateWithinRange(entry.paymentDate, fromDate, toDate)) return;
        totalCollections += entry.amount;
        totalCollectionsCount += 1;
    });

    rangeLabelNode.textContent = formatRangeLabel(fromDate, toDate);
    rangeHelpNode.textContent = fromDate || toDate
        ? 'Duration based on date picker. Totals update when you Filter or change dates.'
        : 'Showing all available records. Set from/to date for focused analysis.';

    totalBillNode.textContent = formatCurrency(totalBill);
    totalBillCountNode.textContent = `${totalBillCount.toLocaleString()} invoice(s)`;

    totalCollectionsNode.textContent = formatCurrency(totalCollections);
    totalCollectionsCountNode.textContent = `${totalCollectionsCount.toLocaleString()} payment(s)`;

    needCollectNode.textContent = formatCurrency(needCollect);
    needCollectCountNode.textContent = `${needCollectCount.toLocaleString()} unpaid invoice(s)`;
}

function computeMonthlyTrendData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const windowStart = new Date(MONTHLY_TREND_START.getTime());
    const windowEnd = today < windowStart ? windowStart : today;
    const monthRows = [];

    let cursor = startOfMonth(windowStart);
    const lastMonth = startOfMonth(windowEnd);

    while (cursor && lastMonth && cursor <= lastMonth) {
        monthRows.push({
            key: getMonthKey(cursor),
            monthStart: new Date(cursor.getTime()),
            label: formatMonthLabel(cursor),
            fullLabel: formatMonthLabel(cursor, true),
            billed: 0,
            billedCount: 0,
            collected: 0,
            paymentCount: 0,
            needCollect: 0,
            needCollectCount: 0,
            variance: 0,
            recoveryRate: null,
            momAmount: null,
            momPercent: null,
            isCurrentMonth: false
        });
        cursor = addMonths(cursor, 1);
    }

    const rowMap = new Map(monthRows.map((row) => [row.key, row]));

    billingEntriesForDuration.forEach((entry) => {
        const invoiceDate = normalizeDate(entry.invoiceDate);
        const amount = Number(entry.amount || 0);
        if (!invoiceDate || amount <= 0) return;
        if (invoiceDate < windowStart || invoiceDate > windowEnd) return;

        const row = rowMap.get(getMonthKey(invoiceDate));
        if (!row) return;

        row.billed += amount;
        row.billedCount += 1;

        if (!entry.isPaid) {
            row.needCollect += amount;
            row.needCollectCount += 1;
        }
    });

    paymentEntries.forEach((entry) => {
        const paymentDate = normalizeDate(entry.paymentDate);
        const amount = Number(entry.amount || 0);
        if (!paymentDate || amount <= 0) return;
        if (paymentDate < windowStart || paymentDate > windowEnd) return;

        const row = rowMap.get(getMonthKey(paymentDate));
        if (!row) return;

        row.collected += amount;
        row.paymentCount += 1;
    });

    const currentMonthKey = getMonthKey(today);
    monthRows.forEach((row, index) => {
        row.variance = row.collected - row.billed;
        row.recoveryRate = row.billed > 0 ? (row.collected / row.billed) * 100 : null;
        row.isCurrentMonth = row.key === currentMonthKey;

        if (index === 0) return;

        const prev = monthRows[index - 1];
        row.momAmount = row.collected - prev.collected;
        if (prev.collected > 0) {
            row.momPercent = (row.momAmount / prev.collected) * 100;
        }
    });

    const activeRows = monthRows.filter((row) => row.billed > 0 || row.collected > 0 || row.needCollect > 0);
    const rowsForSummary = activeRows.length ? activeRows : monthRows;
    const maxAmount = Math.max(
        1,
        ...rowsForSummary.flatMap((row) => [row.billed, row.collected, row.needCollect])
    );

    const totals = rowsForSummary.reduce(
        (acc, row) => {
            acc.billed += row.billed;
            acc.billedCount += row.billedCount;
            acc.collected += row.collected;
            acc.paymentCount += row.paymentCount;
            acc.needCollect += row.needCollect;
            acc.needCollectCount += row.needCollectCount;
            return acc;
        },
        {
            billed: 0,
            billedCount: 0,
            collected: 0,
            paymentCount: 0,
            needCollect: 0,
            needCollectCount: 0
        }
    );

    totals.recoveryRate = totals.billed > 0 ? (totals.collected / totals.billed) * 100 : null;

    return {
        monthRows,
        rowsForSummary,
        activeRows,
        totals,
        maxAmount,
        windowStart,
        windowEnd
    };
}

function buildTrendInsights(rows) {
    if (!rows.length || rows.every((row) => row.billed === 0 && row.collected === 0 && row.needCollect === 0)) {
        return [
            {
                label: 'Trend Insight',
                text: 'No billing or collection activity is available yet for the selected trend window.'
            }
        ];
    }

    const comparisons = rows.filter((row) => row.momAmount !== null);
    const bestMonth = rows.reduce((best, row) => (row.collected > best.collected ? row : best), rows[0]);
    const largestShortfall = rows.reduce((worst, row) => (row.variance < worst.variance ? row : worst), rows[0]);
    const largestSurplus = rows.reduce((best, row) => (row.variance > best.variance ? row : best), rows[0]);
    const strongestLift = comparisons.length
        ? comparisons.reduce((best, row) => (row.momAmount > best.momAmount ? row : best), comparisons[0])
        : null;

    const improvedCount = comparisons.filter((row) => row.momAmount > 0).length;
    const outperformedBillingCount = rows.filter((row) => row.variance >= 0).length;

    return [
        {
            label: 'Best Collection Month',
            text: `${bestMonth.fullLabel} led the window with ${formatCurrency(bestMonth.collected)} collected across ${bestMonth.paymentCount.toLocaleString()} payment(s).`
        },
        {
            label: 'Momentum',
            text: comparisons.length
                ? `${improvedCount} of ${comparisons.length} month-to-month comparisons improved. Sharpest lift was ${strongestLift.fullLabel} at ${formatSignedCurrencyShort(
                      strongestLift.momAmount
                  )} versus the previous month.`
                : 'Only one month is currently in the trend window, so month-over-month momentum starts after the next month closes.'
        },
        {
            label: 'Billing vs Collections',
            text:
                largestShortfall.variance === 0 && largestSurplus.variance === 0
                    ? 'Billing and collections are currently balanced month by month in this window.'
                    : `Collections matched or beat new billing in ${outperformedBillingCount} of ${rows.length} month(s). Largest shortfall was ${largestShortfall.fullLabel} at ${formatSignedCurrencyShort(
                          largestShortfall.variance
                      )}, while the strongest catch-up month was ${largestSurplus.fullLabel} at ${formatSignedCurrencyShort(largestSurplus.variance)}.`
        }
    ];
}

function renderTrendSummaryCards(trendData) {
    const { rowsForSummary, totals, windowStart, windowEnd } = trendData;
    const grid = document.getElementById('trend-summary-grid');
    const subtitle = document.getElementById('trend-window-subtitle');
    if (!grid || !subtitle) return;

    subtitle.textContent = `Month-by-month comparison from ${formatMonthLabel(windowStart, true)} to ${formatMonthLabel(
        windowEnd,
        true
    )}. Uses invoice posting month for billing and payment posting month for collections. This dashboard stays portfolio-wide even when work queue filters change.`;

    grid.innerHTML = `
        <article class="trend-card primary">
            <span class="eyebrow">Trend Window</span>
            <div class="value">${rowsForSummary.length.toLocaleString()}</div>
            <div class="meta">${formatMonthLabel(windowStart, true)} to ${formatMonthLabel(windowEnd, true)}${getMonthKey(windowEnd) === getMonthKey(new Date()) ? ' • current month is partial' : ''}</div>
        </article>
        <article class="trend-card">
            <span class="eyebrow">Total Billed</span>
            <div class="value">${formatCurrencyShort(totals.billed)}</div>
            <div class="meta">${formatCurrency(totals.billed)} across ${totals.billedCount.toLocaleString()} invoice(s).</div>
        </article>
        <article class="trend-card">
            <span class="eyebrow">Total Collected</span>
            <div class="value">${formatCurrencyShort(totals.collected)}</div>
            <div class="meta">${formatCurrency(totals.collected)} across ${totals.paymentCount.toLocaleString()} payment(s).</div>
        </article>
        <article class="trend-card">
            <span class="eyebrow">Recovery Rate</span>
            <div class="value">${formatPercent(totals.recoveryRate)}</div>
            <div class="meta">${formatCurrency(totals.needCollect)} from this billing window still appears unpaid (${totals.needCollectCount.toLocaleString()} invoice(s)).</div>
        </article>
    `;
}

function renderTrendInsights(trendData) {
    const container = document.getElementById('trend-insights');
    if (!container) return;

    const insights = buildTrendInsights(trendData.rowsForSummary);
    container.innerHTML = insights
        .map(
            (item) => `
                <article class="trend-insight">
                    <span class="label">${escapeHtml(item.label)}</span>
                    <div class="text">${escapeHtml(item.text)}</div>
                </article>
            `
        )
        .join('');
}

function renderTrendStrip(trendData) {
    const container = document.getElementById('trend-strip');
    if (!container) return;

    if (!trendData.rowsForSummary.length) {
        container.innerHTML = '<div class="empty-followup">No month-by-month activity found yet for this trend window.</div>';
        return;
    }

    container.innerHTML = trendData.rowsForSummary
        .map((row, index) => {
            const billedWidth = row.billed > 0 ? `${Math.max(4, (row.billed / trendData.maxAmount) * 100)}%` : '0%';
            const collectedWidth = row.collected > 0 ? `${Math.max(4, (row.collected / trendData.maxAmount) * 100)}%` : '0%';
            const varianceClass = row.variance > 0 ? 'positive' : row.variance < 0 ? 'negative' : 'neutral';
            let momHtml = '<span class="neutral">Baseline month</span>';

            if (index > 0) {
                if (row.momPercent === null && row.momAmount > 0) {
                    momHtml = `<span class="positive">New inflow ${formatSignedCurrencyShort(row.momAmount)}</span>`;
                } else if (row.momPercent === null && row.momAmount < 0) {
                    momHtml = `<span class="negative">${formatSignedCurrencyShort(row.momAmount)}</span>`;
                } else if (row.momAmount > 0) {
                    momHtml = `<span class="positive">${formatPercent(row.momPercent)} MoM</span>`;
                } else if (row.momAmount < 0) {
                    momHtml = `<span class="negative">${formatPercent(row.momPercent)} MoM</span>`;
                } else {
                    momHtml = '<span class="neutral">Flat vs prior month</span>';
                }
            }

            return `
                <article class="trend-month-card${row.isCurrentMonth ? ' current' : ''}">
                    <div class="trend-month-head">
                        <div class="trend-month">${escapeHtml(row.label)}</div>
                        ${row.isCurrentMonth ? '<div class="trend-month-tag">MTD</div>' : ''}
                    </div>
                    <div class="trend-metric-row">
                        <span class="name">Billed</span>
                        <span class="amount">${escapeHtml(formatCurrencyShort(row.billed))}</span>
                    </div>
                    <div class="trend-metric-row">
                        <span class="name">Collected</span>
                        <span class="amount">${escapeHtml(formatCurrencyShort(row.collected))}</span>
                    </div>
                    <div class="trend-bar-stack">
                        <div class="trend-bar-line">
                            <span class="bar-label">Bill</span>
                            <div class="trend-bar-track"><div class="trend-bar-fill billed" style="--bar-width:${billedWidth}"></div></div>
                        </div>
                        <div class="trend-bar-line">
                            <span class="bar-label">Collect</span>
                            <div class="trend-bar-track"><div class="trend-bar-fill collected" style="--bar-width:${collectedWidth}"></div></div>
                        </div>
                    </div>
                    <div class="trend-foot">
                        <span class="${varianceClass}">${escapeHtml(formatSignedCurrencyShort(row.variance))}</span>
                        <span class="neutral">${escapeHtml(formatPercent(row.recoveryRate))} recovery</span>
                    </div>
                    <div class="trend-foot">
                        ${momHtml}
                        <span class="neutral">${row.paymentCount.toLocaleString()} pay</span>
                    </div>
                </article>
            `;
        })
        .join('');
}

function buildCustomerCollectionComparison(trendData) {
    const monthColumns = trendData.monthRows.map((row) => ({
        key: row.key,
        label: row.label,
        isCurrentMonth: row.isCurrentMonth
    }));

    const customerMap = new Map();
    const monthTotals = {};
    monthColumns.forEach((column) => {
        monthTotals[column.key] = 0;
    });

    paymentEntries.forEach((entry) => {
        const paymentMonthKey = getMonthKey(entry.paymentDate);
        if (!paymentMonthKey || !monthTotals.hasOwnProperty(paymentMonthKey)) return;

        const billingMeta = billingMetaByInvoiceKey.get(String(entry.invoiceId || '').trim()) || {};
        const customer = String(billingMeta.company || 'Unknown').trim() || 'Unknown';

        if (!customerMap.has(customer)) {
            customerMap.set(customer, {
                customer,
                total: 0,
                months: {}
            });
        }

        const row = customerMap.get(customer);
        row.months[paymentMonthKey] = (row.months[paymentMonthKey] || 0) + Number(entry.amount || 0);
        row.total += Number(entry.amount || 0);
        monthTotals[paymentMonthKey] += Number(entry.amount || 0);
    });

    const customerRows = Array.from(customerMap.values()).sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return a.customer.localeCompare(b.customer);
    });

    const unpaidMap = new Map();
    allInvoices.forEach((invoice) => {
        const customer = String(invoice.company || 'Unknown').trim() || 'Unknown';
        if (!unpaidMap.has(customer)) {
            unpaidMap.set(customer, {
                customer,
                count: 0,
                oldestDate: null
            });
        }

        const row = unpaidMap.get(customer);
        row.count += 1;

        const invoiceDate = invoice.invoiceDate || normalizeDate(invoice.dueDate);
        if (invoiceDate && (!row.oldestDate || invoiceDate < row.oldestDate)) {
            row.oldestDate = invoiceDate;
        }
    });

    const unpaidRows = Array.from(unpaidMap.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const aTime = a.oldestDate ? a.oldestDate.getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.oldestDate ? b.oldestDate.getTime() : Number.MAX_SAFE_INTEGER;
        if (aTime !== bTime) return aTime - bTime;
        return a.customer.localeCompare(b.customer);
    });

    return {
        monthColumns,
        customerRows,
        monthTotals,
        grandTotal: customerRows.reduce((sum, row) => sum + row.total, 0),
        unpaidRows
    };
}

function renderTrendComparisonTable(trendData) {
    const container = document.getElementById('trend-comparison-table');
    if (!container) return;

    const comparison = buildCustomerCollectionComparison(trendData);
    if (!comparison.customerRows.length && !comparison.unpaidRows.length) {
        container.innerHTML = '<div class="empty-followup">No month-by-month comparison is available yet.</div>';
        return;
    }

    container.innerHTML = `
        <div class="comparison-layout">
            <section class="comparison-panel">
                <div class="comparison-panel-head">
                    <div>
                        <div class="comparison-title">Collection Comparison</div>
                        <div class="comparison-subtitle">Customer by month, matching the spreadsheet-style view.</div>
                    </div>
                    <div class="comparison-total-chip">${escapeHtml(formatCurrency(comparison.grandTotal))}</div>
                </div>
                <div class="comparison-sheet-scroll">
                    <table class="comparison-sheet">
                        <thead>
                            <tr>
                                <th>Customer</th>
                                ${comparison.monthColumns
                                    .map(
                                        (column) => `<th>${escapeHtml(column.label)}${column.isCurrentMonth ? ' <span class="trend-recovery-chip">MTD</span>' : ''}</th>`
                                    )
                                    .join('')}
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${comparison.customerRows
                                .map(
                                    (row) => `
                                        <tr>
                                            <td class="customer-cell">${escapeHtml(row.customer)}</td>
                                            ${comparison.monthColumns
                                                .map((column) => {
                                                    const value = Number(row.months[column.key] || 0);
                                                    return `<td class="amount-cell${value ? '' : ' empty'}">${value ? escapeHtml(formatCurrencyShort(value)) : ''}</td>`;
                                                })
                                                .join('')}
                                            <td class="amount-cell total">${escapeHtml(formatCurrencyShort(row.total))}</td>
                                        </tr>
                                    `
                                )
                                .join('')}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td class="customer-cell total-label">Total</td>
                                ${comparison.monthColumns
                                    .map((column) => `<td class="amount-cell total">${escapeHtml(formatCurrencyShort(comparison.monthTotals[column.key] || 0))}</td>`)
                                    .join('')}
                                <td class="amount-cell total">${escapeHtml(formatCurrencyShort(comparison.grandTotal))}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>
            <section class="comparison-panel unpaid">
                <div class="comparison-panel-head">
                    <div>
                        <div class="comparison-title">Unpaid</div>
                        <div class="comparison-subtitle">Customer, open invoice count, and oldest unpaid month.</div>
                    </div>
                </div>
                <div class="comparison-sheet-scroll compact">
                    <table class="comparison-sheet unpaid-sheet">
                        <thead>
                            <tr>
                                <th>Customer</th>
                                <th>No</th>
                                <th>Month</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${
                                comparison.unpaidRows.length
                                    ? comparison.unpaidRows
                                          .map(
                                              (row) => `
                                                <tr>
                                                    <td class="customer-cell">${escapeHtml(row.customer)}</td>
                                                    <td class="amount-cell">${row.count.toLocaleString()}</td>
                                                    <td>${row.oldestDate ? escapeHtml(formatMonthLabel(row.oldestDate)) : '-'}</td>
                                                </tr>
                                            `
                                          )
                                          .join('')
                                    : '<tr><td colspan="3" class="empty-followup">No unpaid invoices in the current queue.</td></tr>'
                            }
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    `;
}

async function computeCollectorDashboardData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const windowStart = new Date(COLLECTOR_DASHBOARD_START.getTime());
    const summaryEnd = startOfMonth(today);
    const matrixEnd = startOfMonth(new Date(today.getFullYear(), 11, 1));
    const summaryMonthColumns = buildMonthColumns(windowStart, summaryEnd);
    const monthColumns = buildMonthColumns(windowStart, matrixEnd);
    const currentMonthKey = getMonthKey(today);
    monthColumns.forEach((column) => {
        column.isCurrentMonth = column.key === currentMonthKey;
    });

    const previousMonthStart = addMonths(windowStart, -1);
    const monthColumnKeys = new Set(monthColumns.map((column) => column.key));
    const billingMatrix = await loadCollectorBillingMatrix(windowStart, summaryEnd);

    const monthMetaMap = new Map(monthColumns.map((column) => [column.key, column]));
    const paymentMap = new Map();
    paymentEntries.forEach((entry) => {
        const invoiceKey = String(entry.invoiceId || '').trim();
        if (!invoiceKey) return;

        if (!paymentMap.has(invoiceKey)) {
            paymentMap.set(invoiceKey, {
                amount: 0,
                isSettled: false,
                latestBalanceAmount: null,
                firstPaymentDate: null,
                lastPaymentDate: null,
                months: new Map()
            });
        }

        const summary = paymentMap.get(invoiceKey);
        const paymentDate = normalizeDate(entry.paymentDate);
        summary.amount += Number(entry.amount || 0);
        if (entry.balanceAmount !== null && entry.balanceAmount !== undefined && Number.isFinite(Number(entry.balanceAmount))) {
            summary.latestBalanceAmount = Number(entry.balanceAmount);
            if (Number(entry.balanceAmount) <= 0.01) summary.isSettled = true;
        }

        if (paymentDate && (!summary.firstPaymentDate || paymentDate < summary.firstPaymentDate)) {
            summary.firstPaymentDate = paymentDate;
        }

        if (paymentDate && (!summary.lastPaymentDate || paymentDate > summary.lastPaymentDate)) {
            summary.lastPaymentDate = paymentDate;
        }

        const paymentMonthKey = getMonthKey(paymentDate);
        if (!paymentMonthKey) return;

        if (!summary.months.has(paymentMonthKey)) {
            summary.months.set(paymentMonthKey, {
                amount: 0,
                firstPaymentDate: null,
                lastPaymentDate: null,
                orNumbers: new Set()
            });
        }

        const monthSummary = summary.months.get(paymentMonthKey);
        monthSummary.amount += Number(entry.amount || 0);
        if (paymentDate && (!monthSummary.firstPaymentDate || paymentDate < monthSummary.firstPaymentDate)) {
            monthSummary.firstPaymentDate = paymentDate;
        }
        if (paymentDate && (!monthSummary.lastPaymentDate || paymentDate > monthSummary.lastPaymentDate)) {
            monthSummary.lastPaymentDate = paymentDate;
        }
        if (entry.orNumber) {
            monthSummary.orNumbers.add(String(entry.orNumber).trim());
        }
    });

    const accountSetByMonth = new Map();
    const accountRowsMap = new Map();
    const monthTotals = {};
    const paymentMonthTotals = {};
    const pendingCountsByMonth = {};
    collectorCellMap = new Map();

    monthColumns.forEach((column) => {
        monthTotals[column.key] = 0;
        paymentMonthTotals[column.key] = 0;
        pendingCountsByMonth[column.key] = 0;
    });

    paymentEntries.forEach((entry) => {
        const paymentMonthKey = getMonthKey(entry.paymentDate);
        if (!paymentMonthKey || !Object.prototype.hasOwnProperty.call(paymentMonthTotals, paymentMonthKey)) return;
        paymentMonthTotals[paymentMonthKey] += Number(entry.amount || 0);
    });

    collectorBillingRecords.forEach((record) => {
        const rowId = buildCollectorRowKey(record.machineId, record.contractmainId);
        if (!rowId) return;

        const paymentSummary =
            paymentMap.get(String(record.invoiceId || '').trim()) ||
            paymentMap.get(String(record.invoiceNo || '').trim()) || {
                amount: 0,
                isSettled: false,
                latestBalanceAmount: null,
                firstPaymentDate: null,
                lastPaymentDate: null,
                months: new Map()
            };

        const invoiceDateInBalanceWindow = record.invoiceDate && record.invoiceDate >= previousMonthStart && record.invoiceDate <= today;
        const paymentMonthsInWindow = Array.from(paymentSummary.months.keys()).filter((key) => monthColumnKeys.has(key));
        const invoiceMonthVisible = monthColumnKeys.has(record.monthKey);
        const unpaidBalance = Math.max(0, Number(record.amount || 0) - Number(paymentSummary.amount || 0));
        const hasUnpaidBalance = unpaidBalance > 0.01;
        const carryoverMonthKey = hasUnpaidBalance && !invoiceMonthVisible ? monthColumns[0]?.key : null;

        if (!invoiceDateInBalanceWindow && !paymentMonthsInWindow.length && !hasUnpaidBalance) return;

        if (!accountRowsMap.has(rowId)) {
            accountRowsMap.set(rowId, {
                rowId,
                customer: record.company || 'Unknown',
                branchName: record.branch || 'Main',
                accountLabel: record.accountLabel || record.company || 'Unknown',
                companyId: record.companyId || '',
                branchId: record.branchId || '',
                serialNumber: normalizeSerialNumber(record.serialNumber),
                modelName: record.modelName || '',
                machineLabel: record.machineLabel || buildMachineLabel(record.machineId, record.contractmainId),
                machineId: record.machineId || '',
                contractmainId: record.contractmainId || '',
                rdCounts: new Map(),
                months: {},
                totalCollected: 0
            });
        }

        const accountRow = accountRowsMap.get(rowId);
        if (!accountRow.serialNumber) accountRow.serialNumber = normalizeSerialNumber(record.serialNumber);
        if (!accountRow.companyId) accountRow.companyId = record.companyId || '';
        if (!accountRow.branchId) accountRow.branchId = record.branchId || '';
        if (!accountRow.modelName) accountRow.modelName = record.modelName || '';
        accountRow.rdCounts.set(record.rd, (accountRow.rdCounts.get(record.rd) || 0) + 1);

        if (invoiceDateInBalanceWindow) {
            if (!accountSetByMonth.has(record.monthKey)) {
                accountSetByMonth.set(record.monthKey, new Set());
            }
            accountSetByMonth.get(record.monthKey).add(rowId);
        }

        if (invoiceMonthVisible) {
            const invoiceCell = ensureCollectorDisplayCell(collectorCellMap, accountRow, monthMetaMap.get(record.monthKey));
            const paidAgainstInvoice = paymentSummary.isSettled
                ? Number(record.amount || 0)
                : Math.min(Number(paymentSummary.amount || 0), Number(record.amount || 0));
            invoiceCell.rdValues.push(record.rd);
            invoiceCell.billedTotal += Number(record.amount || 0);
            invoiceCell.collectedTotal += paidAgainstInvoice;
            invoiceCell.displayBilledTotal = Math.max(Number(invoiceCell.displayBilledTotal || 0), Number(invoiceCell.billedTotal || 0));
            upsertCollectorCellRecord(invoiceCell, record.invoiceKey, {
                ...record,
                amount: Number(record.amount || 0),
                billedAmount: Number(record.amount || 0),
                collectedAmount: paidAgainstInvoice,
                totalCollectedAmount: Number(paymentSummary.amount || 0),
                expectedCollectionDate: addDays(record.invoiceDate, 30),
                firstPaymentDate: paymentSummary.firstPaymentDate,
                lastPaymentDate: paymentSummary.lastPaymentDate,
                rd: record.rd
            });
            accountRow.months[record.monthKey] = invoiceCell.id;
        } else if (carryoverMonthKey && monthMetaMap.has(carryoverMonthKey)) {
            const carryoverCell = ensureCollectorDisplayCell(collectorCellMap, accountRow, monthMetaMap.get(carryoverMonthKey));
            carryoverCell.rdValues.push(record.rd);
            carryoverCell.billedTotal += unpaidBalance;
            carryoverCell.displayBilledTotal = Math.max(Number(carryoverCell.displayBilledTotal || 0), Number(carryoverCell.billedTotal || 0));
            carryoverCell.billedBasis = carryoverCell.billedBasis || 'unpaid_carryover';
            upsertCollectorCellRecord(carryoverCell, record.invoiceKey, {
                ...record,
                amount: Number(record.amount || 0),
                billedAmount: unpaidBalance,
                collectedAmount: 0,
                totalCollectedAmount: Number(paymentSummary.amount || 0),
                expectedCollectionDate: addDays(record.invoiceDate, 30),
                firstPaymentDate: paymentSummary.firstPaymentDate,
                lastPaymentDate: paymentSummary.lastPaymentDate,
                rd: record.rd,
                carriedForward: true
            });
            accountRow.months[carryoverMonthKey] = carryoverCell.id;
        }

        paymentMonthsInWindow
            .filter(() => !invoiceMonthVisible)
            .forEach((monthKey) => {
                const monthSummary = paymentSummary.months.get(monthKey);
                const paymentCell = ensureCollectorDisplayCell(collectorCellMap, accountRow, monthMetaMap.get(monthKey));
                paymentCell.rdValues.push(record.rd);
                paymentCell.collectedTotal += Number(monthSummary?.amount || 0);
                upsertCollectorCellRecord(paymentCell, record.invoiceKey, {
                    ...record,
                    amount: Number(record.amount || 0),
                    billedAmount: 0,
                    collectedAmount: Number(monthSummary?.amount || 0),
                    totalCollectedAmount: Number(paymentSummary.amount || 0),
                    expectedCollectionDate: addDays(record.invoiceDate, 30),
                    firstPaymentDate: monthSummary?.firstPaymentDate || paymentSummary.firstPaymentDate,
                    lastPaymentDate: monthSummary?.lastPaymentDate || paymentSummary.lastPaymentDate,
                    paymentMonthKey: monthKey,
                    paymentOrNumbers: Array.from(monthSummary?.orNumbers || []),
                    rd: record.rd
                });
                accountRow.months[monthKey] = paymentCell.id;
            });
    });

    billingMatrix.rowMap.forEach((billingRow) => {
        const rowId = String(billingRow?.row_id || '').trim();
        if (!rowId) return;

        if (!accountRowsMap.has(rowId)) {
            accountRowsMap.set(rowId, {
                rowId,
                customer: billingRow.company_name || billingRow.account_name || 'Unknown',
                branchName: billingRow.branch_name || 'Main',
                accountLabel: billingRow.account_name || billingRow.company_name || 'Unknown',
                companyId: String(billingRow.company_id || '').trim(),
                branchId: String(billingRow.branch_id || '').trim(),
                serialNumber: normalizeSerialNumber(billingRow.serial_number),
                modelName: String(billingRow.billing_profile?.model_name || billingRow.billing_profile?.model || '').trim(),
                machineLabel: billingRow.machine_label || buildMachineLabel(billingRow.machine_id, billingRow.contractmain_id),
                machineId: String(billingRow.machine_id || '').trim(),
                contractmainId: String(billingRow.contractmain_id || '').trim(),
                rdCounts: new Map(),
                months: {},
                totalCollected: 0
            });
        }

        const accountRow = accountRowsMap.get(rowId);
        if (!accountRow.serialNumber) accountRow.serialNumber = normalizeSerialNumber(billingRow.serial_number);
        if (!accountRow.companyId) accountRow.companyId = String(billingRow.company_id || '').trim();
        if (!accountRow.branchId) accountRow.branchId = String(billingRow.branch_id || '').trim();
        if (!accountRow.modelName) accountRow.modelName = String(billingRow.billing_profile?.model_name || billingRow.billing_profile?.model || '').trim();
        const readingDay = Number(billingRow.reading_day || 0) || null;
        if (readingDay) accountRow.rdCounts.set(readingDay, (accountRow.rdCounts.get(readingDay) || 0) + 1);

        monthColumns.forEach((column) => {
            const billingCell = billingRow.months?.[column.key];
            if (!billingCell) return;
            const displayBilledTotal = Number(billingCell.display_amount_total || billingCell.amount_total || 0);
            const hasBillingState = displayBilledTotal > 0 || billingCell.pending || billingCell.missed_reading || billingCell.catch_up_billing;
            if (!hasBillingState) return;

            const collectorCell = ensureCollectorDisplayCell(collectorCellMap, accountRow, monthMetaMap.get(column.key));
            collectorCell.rdValues.push(readingDay);
            collectorCell.displayBilledTotal = Math.max(Number(collectorCell.displayBilledTotal || 0), displayBilledTotal);
            collectorCell.billedTotal = Math.max(Number(collectorCell.billedTotal || 0), displayBilledTotal);
            collectorCell.billedBasis = billingCell.billed_basis || collectorCell.billedBasis || 'none';
            collectorCell.missedReading = Boolean(collectorCell.missedReading || billingCell.missed_reading);
            collectorCell.catchUpBilling = Boolean(collectorCell.catchUpBilling || billingCell.catch_up_billing);
            collectorCell.catchUpGapMonths = Math.max(Number(collectorCell.catchUpGapMonths || 0), Number(billingCell.catch_up_gap_months || 0));
            collectorCell.pendingBilling = Boolean(collectorCell.pendingBilling || billingCell.pending);
            collectorCell.readingPagesTotal = Math.max(Number(collectorCell.readingPagesTotal || 0), Number(billingCell.reading_pages_total || 0));
            collectorCell.readingTaskCount = Math.max(Number(collectorCell.readingTaskCount || 0), Number(billingCell.reading_task_count || 0));
            accountRow.months[column.key] = collectorCell.id;
        });
    });

    finalizeCollectorCellRecords(collectorCellMap);

    const customerRows = Array.from(accountRowsMap.values())
        .map((row) => {
            let rd = null;
            Array.from(row.rdCounts.entries())
                .sort((a, b) => {
                    if (b[1] !== a[1]) return b[1] - a[1];
                    return a[0] - b[0];
                })
                .slice(0, 1)
                .forEach(([rdValue]) => {
                    rd = rdValue;
                });

            monthColumns.forEach((column) => {
                const cell = collectorCellMap.get(row.months[column.key] || '');
                if (cell) {
                    row.totalCollected += cell.collectedTotal;
                    monthTotals[column.key] += cell.collectedTotal;
                    const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
                    if ((billedTarget > 0 || cell.missedReading || cell.pendingBilling) && cell.collectedTotal <= 0) {
                        pendingCountsByMonth[column.key] += 1;
                    }
                }
            });

            return {
            rowId: row.rowId,
            customer: row.customer,
            branchName: row.branchName,
            accountLabel: row.accountLabel,
            companyId: row.companyId,
            branchId: row.branchId,
            serialNumber: normalizeSerialNumber(row.serialNumber),
            modelName: row.modelName,
            machineLabel: row.machineLabel,
                machineId: row.machineId,
                contractmainId: row.contractmainId,
                rd,
                months: row.months,
                totalCollected: row.totalCollected
            };
        })
        .sort((a, b) => {
            const rdA = a.rd === null || a.rd === undefined ? Number.MAX_SAFE_INTEGER : a.rd;
            const rdB = b.rd === null || b.rd === undefined ? Number.MAX_SAFE_INTEGER : b.rd;
            if (rdA !== rdB) return rdA - rdB;
            return a.customer.localeCompare(b.customer);
        });

    const monthlySummaryRows = summaryMonthColumns
        .map((column) => {
            const previousCustomers = accountSetByMonth.get(getMonthKey(addMonths(column.monthStart, -1))) || new Set();
            const currentCustomers = accountSetByMonth.get(column.key) || new Set();

            const additional = Array.from(currentCustomers).filter((customer) => !previousCustomers.has(customer)).length;
            const inactive = Array.from(previousCustomers).filter((customer) => !currentCustomers.has(customer)).length;
            const toCollect = currentCustomers.size;
            const collected = customerRows.filter((row) => {
                const cell = collectorCellMap.get(row.months[column.key] || '');
                return cell && cell.collectedTotal > 0;
            }).length;

            return {
                monthKey: column.key,
                monthLabel: column.label,
                balance: previousCustomers.size,
                additional,
                inactive,
                toCollect,
                collected,
                pending: Math.max(0, toCollect - collected)
            };
        })
        .reverse();

    const pendingCellCount = Array.from(collectorCellMap.values()).filter((cell) => {
        const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
        return (billedTarget > 0 || cell.missedReading || cell.pendingBilling) && cell.collectedTotal <= 0;
    }).length;

    return {
        monthColumns,
        summaryMonthColumns,
        customerRows,
        monthlySummaryRows,
        monthTotals,
        paymentMonthTotals,
        pendingCountsByMonth,
        pendingCellCount,
        windowStart,
        windowEnd: today,
        matrixEnd
    };
}

function renderCollectorSummaryTable(data) {
    const container = document.getElementById('collector-summary-table');
    if (!container) return;

    container.innerHTML = `
        <table class="collector-sheet">
            <thead>
                <tr>
                    <th class="text-left">Month</th>
                    <th>Balance</th>
                    <th>Additional</th>
                    <th>Inactive</th>
                    <th>To Collect</th>
                    <th>Collected</th>
                    <th>Pending</th>
                </tr>
            </thead>
            <tbody>
                ${data.monthlySummaryRows
                    .map(
                        (row) => `
                            <tr>
                                <td class="text-left">${escapeHtml(row.monthLabel)}</td>
                                <td>${row.balance.toLocaleString()}</td>
                                <td>${row.additional.toLocaleString()}</td>
                                <td>${row.inactive.toLocaleString()}</td>
                                <td>${row.toCollect.toLocaleString()}</td>
                                <td>${row.collected.toLocaleString()}</td>
                                <td>${row.pending.toLocaleString()}</td>
                            </tr>
                        `
                    )
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderCollectorMatrixTable(data, visibleRows) {
    const container = document.getElementById('collector-matrix-table');
    if (!container) return;
    const visibleCount = Array.isArray(visibleRows) ? visibleRows.length : 0;
    const totalCount = Array.isArray(data?.customerRows) ? data.customerRows.length : visibleCount;
    const rdCountLabel = visibleCount === totalCount
        ? `${visibleCount.toLocaleString()}`
        : `${visibleCount.toLocaleString()} / ${totalCount.toLocaleString()}`;

    if (!visibleRows.length) {
        const searchTerm = getCollectorSearchTerm();
        container.innerHTML = searchTerm
            ? `<div class="empty-followup">No collection rows matched "${escapeHtml(searchTerm)}".</div>`
            : '<div class="empty-followup">No collection rows available.</div>';
        return;
    }

    container.innerHTML = `
        <table class="collector-sheet">
            <thead>
                <tr>
                    <th class="sticky-col rd">RD <span class="collector-rd-count">${escapeHtml(rdCountLabel)}</span></th>
                    <th class="sticky-col sn">SN</th>
                    <th class="sticky-col customer text-left">Customer</th>
                    <th class="sticky-col branch text-left">Branch / Dept</th>
                    ${data.monthColumns
                        .map(
                            (column) =>
                                `<th data-month-key="${escapeHtml(column.key)}" data-month-label="${escapeHtml(column.label)}" data-month-full-label="${escapeHtml(column.fullLabel)}">${escapeHtml(column.label)}${column.isCurrentMonth ? ' <span class="trend-recovery-chip">MTD</span>' : ''}</th>`
                        )
                        .join('')}
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>
                ${visibleRows
                    .map((row) => {
                        const cells = data.monthColumns
                            .map((column) => {
                                const cell = collectorCellMap.get(row.months[column.key] || '');
                                if (!cell) {
                                    return '<td class="month-cell no-bill"></td>';
                                }

                                const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
                                const missedReading = Boolean(cell.missedReading);
                                const catchUpBilling = Boolean(cell.catchUpBilling);
                                const showBillingAmount = billedTarget > 0;
                                let cellClass = 'month-cell pending';
                                let cellText = '<span class="collector-empty-dot"></span>';

                                if (cell.collectedTotal > 0 && billedTarget > 0 && cell.collectedTotal < billedTarget) {
                                    cellClass = 'month-cell partial';
                                    cellText = `
                                        <span class="collector-amount">${escapeHtml(formatPlainNumber(cell.collectedTotal))}</span>
                                        <span class="collector-state-label partial">Partial</span>
                                    `;
                                } else if (cell.collectedTotal > 0 && billedTarget > 0 && cell.collectedTotal >= billedTarget) {
                                    cellClass = 'month-cell collected';
                                    cellText = `
                                        <span class="collector-amount">${escapeHtml(formatPlainNumber(cell.collectedTotal))}</span>
                                        <span class="collector-state-label collected">Collected</span>
                                    `;
                                } else if (showBillingAmount) {
                                    cellClass = `month-cell pending${catchUpBilling ? ' catch-up' : ''}`;
                                    cellText = `
                                        <span class="collector-amount">${escapeHtml(formatPlainNumber(billedTarget))}</span>
                                        ${catchUpBilling
                                            ? `<span class="collector-state-label catch-up">Catch-up Billing${cell.catchUpGapMonths > 1 ? ` (${escapeHtml(String(cell.catchUpGapMonths))})` : ''}</span>`
                                            : '<span class="collector-state-label unpaid">No Payment</span>'}
                                    `;
                                } else if (missedReading || cell.pendingBilling) {
                                    cellClass = `month-cell missed-reading${cell.pendingBilling ? ' pending-billing' : ''}`;
                                    cellText = `<span class="collector-state-label missed">${escapeHtml(missedReading ? 'Missed Reading' : 'Pending Billing')}</span>`;
                                }

                                return `<td class="${cellClass}" onclick="openCollectorCellByToken('${encodeURIComponent(cell.id)}')">${cellText}</td>`;
                            })
                            .join('');

                        return `
                            <tr>
                                <td class="sticky-col rd">${row.rd !== null && row.rd !== undefined ? escapeHtml(String(row.rd)) : '-'}</td>
                                <td class="sticky-col sn">
                                    <div class="collector-primary">${escapeHtml(displaySerialNumber(row.serialNumber))}</div>
                                </td>
                                <td class="sticky-col customer text-left">
                                    <div class="collector-primary">${escapeHtml(row.customer)}</div>
                                    <div class="collector-sub">${escapeHtml(row.machineLabel || buildMachineLabel(row.machineId, row.contractmainId))}</div>
                                </td>
                                <td class="sticky-col branch text-left">
                                    <div class="collector-primary">${escapeHtml(row.branchName || 'Main')}</div>
                                    <div class="collector-sub">${escapeHtml(row.accountLabel || row.customer)}</div>
                                </td>
                                ${cells}
                                <td class="total-cell text-right">${escapeHtml(formatPlainNumber(row.totalCollected))}</td>
                            </tr>
                        `;
                    })
                    .join('')}
            </tbody>
            <tfoot>
                <tr>
                    <td class="sticky-col rd total-cell"></td>
                    <td class="sticky-col sn total-cell"></td>
                    <td class="sticky-col customer total-cell text-left">Payment Total</td>
                    <td class="sticky-col branch total-cell"></td>
                    ${data.monthColumns
                        .map((column) => `<td class="total-cell text-right">${escapeHtml(formatPlainNumber(data.paymentMonthTotals?.[column.key] || 0))}</td>`)
                        .join('')}
                    <td class="total-cell text-right">${escapeHtml(formatPlainNumber(Object.values(data.paymentMonthTotals || {}).reduce((sum, value) => sum + Number(value || 0), 0)))}</td>
                </tr>
            </tfoot>
        </table>
    `;

    bindCollectorMatrixViewport();
    scheduleCollectorLatestScroll(data);
}

function renderCollectorDashboardFromData(data) {
    if (!data) return null;

    const visibleRows = prepareCollectorRows(data.customerRows);
    renderCollectorSummaryTable(data);
    renderCollectorMatrixTable(data, visibleRows);

    const noteNode = document.getElementById('collector-dashboard-note');
    if (noteNode) {
        const searchTerm = getCollectorSearchTerm();
        const filterText = searchTerm
            ? `Showing ${visibleRows.length.toLocaleString()} of ${data.customerRows.length.toLocaleString()} account row(s) for "${searchTerm}".`
            : `${data.customerRows.length.toLocaleString()} account row(s) across ${data.monthColumns.length.toLocaleString()} month(s).`;
        noteNode.textContent = `${filterText} Cell colors use Billing invoice month plus Collection payment balance. Footer payment totals use actual payment dates from Collection payment records.`;
    }

    const rangeNode = document.getElementById('collector-dashboard-range');
    if (rangeNode) {
        rangeNode.textContent = `${formatMonthLabel(data.windowStart, true)} to ${formatMonthLabel(data.matrixEnd, true)}`;
    }

    const pendingNode = document.getElementById('collector-dashboard-pending');
    if (pendingNode) {
        pendingNode.textContent = `Pending cells: ${data.pendingCellCount.toLocaleString()}`;
    }

    return data;
}

async function renderCollectorDashboard(options = {}) {
    const renderSeq = ++collectorDashboardRenderSeq;
    const shouldRecompute = Boolean(options.recompute) || !collectorDashboardData;

    if (!shouldRecompute) {
        return renderCollectorDashboardFromData(collectorDashboardData);
    }

    const noteNode = document.getElementById('collector-dashboard-note');
    const matrixNode = document.getElementById('collector-matrix-table');
    if (noteNode) {
        noteNode.textContent = 'Finalizing billing and payment status for the month matrix...';
    }
    if (matrixNode) {
        matrixNode.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div><span>Finalizing payment status...</span></div>';
    }

    try {
        const data = await computeCollectorDashboardData();
        if (renderSeq !== collectorDashboardRenderSeq) return null;

        collectorDashboardData = data;
        return renderCollectorDashboardFromData(data);
    } catch (error) {
        if (renderSeq !== collectorDashboardRenderSeq) return null;
        console.error('Collector dashboard render failed:', error);
        if (noteNode) {
            noteNode.textContent = 'Unable to finalize the collection month matrix. Please refresh and try again.';
        }
        if (matrixNode) {
            matrixNode.innerHTML = '<div class="empty-followup">Unable to finalize payment status. Please refresh Collections.</div>';
        }
        return null;
    }
}

function buildAddressText(parts) {
    const seen = new Set();
    return (parts || [])
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .filter((part) => {
            const key = part.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .join(', ');
}

function documentFieldsToPlain(doc) {
    const plain = {
        _docId: getFirestoreDocumentId(doc),
        _docName: doc?.name || ''
    };

    Object.entries(doc?.fields || {}).forEach(([key, value]) => {
        plain[key] = getValue(value);
    });

    return plain;
}

function normalizeLookupId(value) {
    const raw = String(value || '').trim();
    return raw || '';
}

function collectionProfileOverrideDocId(context) {
    const branchId = normalizeLookupId(context?.branchId);
    if (branchId && !branchId.startsWith('unlinked:')) return `branch_${branchId}`;

    const contractId = normalizeLookupId(context?.contractmainId);
    if (contractId) return `contract_${contractId}`;

    return `account_${String(context?.rowId || context?.accountLabel || context?.customer || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 90) || 'unknown'}`;
}

function scheduleSlug(value, fallback = 'unknown') {
    return String(value || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 90) || fallback;
}

function collectionScheduleDocId(context, selectedInvoice) {
    const invoiceNo = String(selectedInvoice?.invoiceNo || selectedInvoice?.invoiceId || '').trim();
    if (invoiceNo) return `collection_invoice_${scheduleSlug(invoiceNo)}`;

    const branchId = normalizeLookupId(context?.branchId);
    const monthKey = scheduleSlug(context?.monthKey || context?.label || 'month');
    if (branchId && !branchId.startsWith('unlinked:')) return `collection_branch_${scheduleSlug(branchId)}_${monthKey}`;

    const contractId = normalizeLookupId(context?.contractmainId);
    if (contractId) return `collection_contract_${scheduleSlug(contractId)}_${monthKey}`;

    return `collection_account_${scheduleSlug(context?.accountLabel || context?.customer)}_${monthKey}`;
}

async function loadCollectionScheduleForWorkspace(context, selectedInvoice) {
    const docId = collectionScheduleDocId(context, selectedInvoice);
    try {
        const doc = await firestoreGetDocument('marga_master_schedule', docId);
        return doc ? documentFieldsToPlain(doc) : null;
    } catch (error) {
        console.warn('Unable to load collection schedule override:', error);
        return null;
    }
}

function getCurrentCollectorName() {
    return String(
        document.getElementById('current-user')?.textContent
        || localStorage.getItem('marga_current_user')
        || 'Collector'
    ).trim() || 'Collector';
}

function getSchedulePurposeLabel(scheduleStatus) {
    const label = String(scheduleStatus || '').trim();
    if (/confirmed/i.test(label)) return 'Confirmed Collection';
    if (/toner|ink/i.test(label)) return 'Toner / Ink Delivery';
    if (/shutdown|start up/i.test(label)) return 'Service / Preventive Maintenance';
    if (label) return label;
    return 'Collection';
}

function getCollectionOverrideForContext(context) {
    return collectionProfileOverrides.get(collectionProfileOverrideDocId(context)) || null;
}

function upsertCollectionProfileOverride(context, override) {
    const docId = collectionProfileOverrideDocId(context);
    collectionProfileOverrides.set(docId, {
        ...(collectionProfileOverrides.get(docId) || {}),
        ...override,
        _docId: docId
    });
}

function getCollectionProfileForContext(context) {
    const branchId = normalizeLookupId(context?.branchId);
    if (branchId && collectionProfileByBranchId.has(branchId)) return collectionProfileByBranchId.get(branchId);
    return null;
}

function getProfileField(profile, override, overrideField, legacyFields, fallback = '') {
    const overrideValue = override && override[overrideField];
    if (overrideValue !== null && overrideValue !== undefined && String(overrideValue).trim() !== '') {
        return overrideValue;
    }

    for (const field of legacyFields) {
        const value = profile && profile[field];
        if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    }

    return fallback;
}

function getCollectionAddress(context, profile, override) {
    const branch = branchMap[normalizeLookupId(context?.branchId)] || {};
    return getProfileField(profile, override, 'collection_address', ['releaseadd', 'collection_address'], branch.address || '');
}

function getCollectionLocationLabel(locationId, locationLabel = '') {
    const explicit = String(locationLabel || '').trim();
    if (explicit) return explicit;
    const found = COLLECTION_LOCATION_OPTIONS.find((option) => Number(option.id) === Number(locationId));
    return found ? found.label : '-';
}

function getCollectionStatusLabel(statusId) {
    const found = collectionStatusOptions.find((status) => Number(status.id) === Number(statusId));
    return found ? found.label : '-';
}

function getCollectionContactRows(profile, override) {
    const rows = [
        ['ACCOUNTING', 'acctcon', 'acctnum'],
        ['CASHIER', 'cashcon', 'cashnum'],
        ['TREASURY', 'treascon', 'treasnum'],
        ['RELEASING', 'releasecon', 'releasenum']
    ].map(([location, nameField, numberField]) => ({
        location,
        name: String(profile?.[nameField] || '').trim(),
        number: String(profile?.[numberField] || '').trim()
    }));

    const overrideName = String(override?.contact_person || '').trim();
    const overrideNumber = String(override?.contact_number || '').trim();
    if (overrideName || overrideNumber) {
        rows.unshift({
            location: 'WEB OVERRIDE',
            name: overrideName,
            number: overrideNumber
        });
    }

    return rows.filter((row) => row.name || row.number);
}

async function loadCollectionWorkspaceLookups() {
    if (collectionWorkspaceLookupsLoaded) return;
    if (collectionWorkspaceLookupsPromise) return collectionWorkspaceLookupsPromise;

    collectionWorkspaceLookupsPromise = (async () => {
        const [profileDocs, statusDocs, overrideDocs, troubleDocs, employeeDocs] = await Promise.all([
            safeFirestoreGetAll('tbl_collectioninfo', null, {
                fieldMask: [
                    'id',
                    'branch_id',
                    'acctcon',
                    'acctnum',
                    'cashcon',
                    'cashnum',
                    'treascon',
                    'treasnum',
                    'releasecon',
                    'releasenum',
                    'releaseadd',
                    'collection_days',
                    'collection_hours',
                    'followup_days',
                    'followup_time',
                    'time_from',
                    'time_to',
                    'last_contact'
                ],
                maxPages: 80
            }),
            safeFirestoreGetAll('tbl_collectionstatus', null, {
                fieldMask: ['id', 'status', 'statusname', 'description', 'name'],
                maxPages: 10
            }),
            safeFirestoreGetAll('marga_collection_profiles', null, {
                maxPages: 20
            }),
            safeFirestoreGetAll('tbl_trouble', null, {
                fieldMask: ['id', 'trouble', 'description', 'trouble_name', 'name'],
                maxPages: 20
            }),
            safeFirestoreGetAll('tbl_employee', null, {
                fieldMask: ['id', 'firstname', 'lastname', 'nickname', 'name'],
                maxPages: 40
            })
        ]);

        collectionProfileByBranchId = new Map();
        profileDocs.forEach((doc) => {
            const profile = documentFieldsToPlain(doc);
            const branchId = normalizeLookupId(profile.branch_id);
            if (!branchId) return;
            collectionProfileByBranchId.set(branchId, profile);
        });

        collectionStatusOptions = statusDocs
            .map((doc) => {
                const row = documentFieldsToPlain(doc);
                return {
                    id: Number(row.id || 0),
                    label: String(row.status || row.statusname || row.description || row.name || '').trim()
                };
            })
            .filter((row) => row.id && row.label)
            .sort((a, b) => a.id - b.id);
        if (!collectionStatusOptions.length) collectionStatusOptions = [...DEFAULT_COLLECTION_STATUSES];

        collectionProfileOverrides = new Map();
        overrideDocs.forEach((doc) => {
            const override = documentFieldsToPlain(doc);
            const docId = override._docId;
            if (docId) collectionProfileOverrides.set(docId, override);
        });

        troubleLookupMap = new Map();
        troubleDocs.forEach((doc) => {
            const row = documentFieldsToPlain(doc);
            const id = normalizeLookupId(row.id);
            const label = String(row.trouble || row.description || row.trouble_name || row.name || '').trim();
            if (id && label) troubleLookupMap.set(id, label);
        });

        employeeLookupMap = new Map();
        employeeDocs.forEach((doc) => {
            const row = documentFieldsToPlain(doc);
            const id = normalizeLookupId(row.id);
            const name = buildAddressText([row.nickname, `${row.firstname || ''} ${row.lastname || ''}`.trim(), row.name]);
            if (id && name) employeeLookupMap.set(id, name);
        });

        collectionWorkspaceLookupsLoaded = true;
        collectionWorkspaceLookupsPromise = null;
    })();

    return collectionWorkspaceLookupsPromise;
}

function resolveCollectorCellContext(cell) {
    const firstRecord = (cell.records || [])[0] || {};
    return {
        cellId: cell.id,
        rowId: cell.rowId,
        customer: cell.customer || firstRecord.company || 'Unknown',
        branchName: cell.branchName || firstRecord.branch || 'Main',
        accountLabel: cell.accountLabel || firstRecord.accountLabel || cell.customer || 'Unknown',
        companyId: normalizeLookupId(cell.companyId || firstRecord.companyId),
        branchId: normalizeLookupId(cell.branchId || firstRecord.branchId),
        contractmainId: normalizeLookupId(cell.contractmainId || firstRecord.contractmainId),
        machineId: normalizeLookupId(cell.machineId || firstRecord.machineId),
        serialNumber: normalizeSerialNumber(cell.serialNumber || firstRecord.serialNumber),
        modelName: String(cell.modelName || firstRecord.modelName || '').trim(),
        machineLabel: cell.machineLabel || firstRecord.machineLabel || '',
        monthKey: cell.monthKey,
        label: cell.label
    };
}

function sameBranch(invoice, context) {
    if (context.branchId && invoice.branchId && String(invoice.branchId) === String(context.branchId)) return true;
    return normalizeText(invoice.branch) === normalizeText(context.branchName)
        && normalizeText(invoice.company) === normalizeText(context.customer);
}

function sameCompany(invoice, context) {
    if (context.companyId && invoice.companyId && String(invoice.companyId) === String(context.companyId)) return true;
    return normalizeText(invoice.company) === normalizeText(context.customer);
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeTimeInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const amPmMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
    if (amPmMatch) {
        let hour = Number(amPmMatch[1]);
        const minute = amPmMatch[2];
        const period = amPmMatch[3].toUpperCase();
        if (period === 'PM' && hour < 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;
        return `${String(hour).padStart(2, '0')}:${minute}`;
    }

    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';

    const hour = Math.min(23, Math.max(0, Number(match[1])));
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function getRelatedUnpaidInvoices(context, scope) {
    const matcher = scope === 'company' ? sameCompany : sameBranch;
    return allInvoices
        .filter((invoice) => matcher(invoice, context))
        .sort((a, b) => {
            const aTime = (a.invoiceDate || normalizeDate(a.dueDate) || new Date(0)).getTime();
            const bTime = (b.invoiceDate || normalizeDate(b.dueDate) || new Date(0)).getTime();
            return aTime - bTime;
        });
}

function getSelectedInvoiceForCell(cell, context, branchInvoices) {
    const candidateKeys = new Set();
    (cell.records || []).forEach((record) => {
        if (record.invoiceNo) candidateKeys.add(String(record.invoiceNo));
        if (record.invoiceId) candidateKeys.add(String(record.invoiceId));
        if (record.invoiceKey) candidateKeys.add(String(record.invoiceKey));
    });

    const exact = branchInvoices.find((invoice) => (
        candidateKeys.has(String(invoice.invoiceNo))
        || candidateKeys.has(String(invoice.invoiceId))
        || candidateKeys.has(String(invoice.invoiceKey))
    ));
    if (exact) return exact;

    if (cell.records?.length) {
        const record = cell.records[0];
        return {
            ...record,
            amount: Number(record.amount || record.billedAmount || 0),
            company: record.company || context.customer,
            branch: record.branch || context.branchName
        };
    }

    return branchInvoices[0] || null;
}

function mergeInvoiceHistories(invoices, records = []) {
    const keys = [];
    invoices.forEach((invoice) => {
        keys.push(invoice.invoiceNo, invoice.invoiceId, invoice.invoiceKey);
    });
    records.forEach((record) => {
        keys.push(record.invoiceNo, record.invoiceId, record.invoiceKey);
    });
    return getHistoryForInvoice(...keys);
}

function queryScheduleByField(fieldPath, value) {
    if (!value) return Promise.resolve([]);
    return firestoreRunQuery({
        from: [{ collectionId: 'tbl_schedule' }],
        where: {
            fieldFilter: {
                field: { fieldPath },
                op: 'EQUAL',
                value: toFirestoreQueryValue(value)
            }
        },
        limit: 120
    });
}

async function loadServiceDeliveryHistory(context) {
    const cacheKey = `${context.branchId || 'branchless'}:${context.companyId || 'companyless'}`;
    if (serviceHistoryCache.has(cacheKey)) return serviceHistoryCache.get(cacheKey);

    const [branchDocs, companyDocs] = await Promise.all([
        queryScheduleByField('branch_id', context.branchId).catch((error) => {
            console.warn('Branch service history query failed:', error);
            return [];
        }),
        queryScheduleByField('company_id', context.companyId).catch((error) => {
            console.warn('Company service history query failed:', error);
            return [];
        })
    ]);

    const seen = new Set();
    const rows = [...branchDocs, ...companyDocs]
        .filter((doc) => {
            const id = doc.name || '';
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        })
        .map((doc) => {
            const row = documentFieldsToPlain(doc);
            const purposeId = Number(row.purpose_id || 0);
            return {
                scheduleId: row.id || getFirestoreDocumentId(doc),
                purposeId,
                trouble: troubleLookupMap.get(normalizeLookupId(row.trouble_id)) || row.trouble || row.problem || '-',
                tech: employeeLookupMap.get(normalizeLookupId(row.tech_id)) || row.tech || '-',
                taskDate: normalizeDate(row.task_datetime || row.task_date || row.scheduled || row.schedule_date || row.datex),
                dateFinished: normalizeDate(row.date_finished || row.datefinished || row.finished_date),
                remarks: row.remarks || row.action_taken || row.findings || ''
            };
        })
        .filter((row) => row.purposeId !== 1)
        .sort((a, b) => {
            const aTime = (a.dateFinished || a.taskDate || new Date(0)).getTime();
            const bTime = (b.dateFinished || b.taskDate || new Date(0)).getTime();
            return bTime - aTime;
        })
        .slice(0, 20);

    serviceHistoryCache.set(cacheKey, rows);
    return rows;
}

async function buildCollectorFollowupWorkspace(cell) {
    await loadCollectionWorkspaceLookups();

    const context = resolveCollectorCellContext(cell);
    const profile = getCollectionProfileForContext(context);
    const override = getCollectionOverrideForContext(context);
    const branchInvoices = getRelatedUnpaidInvoices(context, 'branch');
    const companyInvoices = getRelatedUnpaidInvoices(context, 'company');
    const selectedInvoice = getSelectedInvoiceForCell(cell, context, branchInvoices);
    const invoiceHistory = mergeInvoiceHistories(
        selectedInvoice ? [selectedInvoice, ...branchInvoices] : branchInvoices,
        cell.records || []
    );
    const lastHistory = invoiceHistory[0] || null;
    const [serviceHistory, activeSchedule] = await Promise.all([
        loadServiceDeliveryHistory(context),
        loadCollectionScheduleForWorkspace(context, selectedInvoice)
    ]);

    const branchBalance = branchInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const companyBalance = companyInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const selectedContact = lastHistory && hasMeaningfulContact(lastHistory.contactPerson)
        ? lastHistory.contactPerson
        : getCollectionContactRows(profile, override)[0]?.name || '';
    const selectedContactNumber = lastHistory?.contactNumber
        || getCollectionContactRows(profile, override)[0]?.number
        || selectedInvoice?.contactNumber
        || '';

    return {
        cell,
        context,
        profile,
        override,
        selectedInvoice,
        branchInvoices,
        companyInvoices,
        invoiceHistory,
        lastHistory,
        serviceHistory,
        activeSchedule,
        branchBalance,
        companyBalance,
        selectedContact,
        selectedContactNumber,
        address: getCollectionAddress(context, profile, override)
    };
}

function renderMiniInvoiceRows(invoices, emptyText) {
    if (!invoices.length) {
        return `<div class="collection-followup-empty">${escapeHtml(emptyText)}</div>`;
    }

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>Invoice #</th>
                        <th>Branch</th>
                        <th>Amount</th>
                        <th>Month / Yr</th>
                        <th>Rcvd By</th>
                        <th>Date Rcvd</th>
                    </tr>
                </thead>
                <tbody>
                    ${invoices.slice(0, 28).map((invoice) => `
                        <tr>
                            <td><input type="checkbox" checked aria-label="Selected invoice ${escapeHtml(invoice.invoiceNo || '')}"></td>
                            <td>${escapeHtml(invoice.invoiceNo || invoice.invoiceId || '-')}</td>
                            <td>${escapeHtml(invoice.branch || '-')}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(invoice.amount || 0))}</td>
                            <td>${escapeHtml(invoice.monthYear || '-')}</td>
                            <td>${escapeHtml(invoice.receivedBy || '-')}</td>
                            <td>${escapeHtml(formatDate(invoice.dateReceived))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderHistoryRows(history) {
    if (!history.length) return '<div class="collection-followup-empty">No invoice follow-up history yet.</div>';

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table">
                <thead>
                    <tr>
                        <th>Invoice No.</th>
                        <th>Date / Time</th>
                        <th>Status</th>
                        <th>Location</th>
                        <th>Remarks</th>
                    </tr>
                </thead>
                <tbody>
                    ${history.slice(0, 30).map((item) => `
                        <tr>
                            <td>${escapeHtml(item.invoiceKey || item.collectionId || '-')}</td>
                            <td>${escapeHtml(formatDate(item.callDate))}</td>
                            <td>${escapeHtml(getCollectionStatusLabel(item.statusId) || item.scheduleStatus || '-')}</td>
                            <td>${escapeHtml(getCollectionLocationLabel(item.locationId, item.locationLabel))}</td>
                            <td>${escapeHtml(item.remarks || '-')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderServiceRows(rows) {
    if (!rows.length) return '<div class="collection-followup-empty">No recent service or delivery history found for this branch/company.</div>';

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table">
                <thead>
                    <tr>
                        <th>Sched ID</th>
                        <th>Trouble</th>
                        <th>Tech</th>
                        <th>Task Date</th>
                        <th>Date Fnshd</th>
                        <th>Remarks</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td>${escapeHtml(row.scheduleId || '-')}</td>
                            <td>${escapeHtml(row.trouble || '-')}</td>
                            <td>${escapeHtml(row.tech || '-')}</td>
                            <td>${escapeHtml(formatDate(row.taskDate))}</td>
                            <td>${escapeHtml(formatDate(row.dateFinished))}</td>
                            <td>${escapeHtml(row.remarks || '-')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function getPaymentsForSelectedInvoice(invoice) {
    if (!invoice) return [];
    const keys = new Set([
        invoice.invoiceId,
        invoice.invoiceNo,
        invoice.invoiceKey,
        invoice.id
    ].map((value) => String(value || '').trim()).filter(Boolean));

    return paymentEntries
        .filter((entry) => keys.has(String(entry.invoiceId || '').trim()) || keys.has(String(entry.invoiceNo || '').trim()))
        .sort((left, right) => {
            const leftTime = (left.paymentDate || new Date(0)).getTime();
            const rightTime = (right.paymentDate || new Date(0)).getTime();
            return rightTime - leftTime;
        });
}

function renderPaymentHistoryRows(payments) {
    if (!payments.length) return '<div class="collection-followup-empty">No saved payment record for this invoice yet.</div>';

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table">
                <thead>
                    <tr>
                        <th>Paid Date</th>
                        <th>OR No.</th>
                        <th>Received</th>
                        <th>2307</th>
                        <th>Balance</th>
                    </tr>
                </thead>
                <tbody>
                    ${payments.slice(0, 12).map((payment) => `
                        <tr>
                            <td>${escapeHtml(formatDate(payment.datePaid || payment.paymentDate))}</td>
                            <td>${escapeHtml(payment.orNumber || '-')}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(payment.amount || 0))}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(payment.tax2307 || 0))}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(payment.balanceAmount || 0))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderCollectorPaymentTab(workspace, paymentRecords, paymentTotal, taxTotal, paymentBalance) {
    const { selectedInvoice, branchBalance, cell } = workspace;
    const invoiceNo = String(selectedInvoice?.invoiceNo || selectedInvoice?.invoiceId || '').trim();
    const invoiceId = String(selectedInvoice?.invoiceId || selectedInvoice?.invoiceNo || '').trim();
    const invoiceAmount = Number(selectedInvoice?.amount || cell?.displayBilledTotal || cell?.billedTotal || branchBalance || 0);

    return `
        <section class="collection-payment-tab-panel" id="collectorPaymentPanel" role="tabpanel" aria-labelledby="collectorPaymentTab" hidden>
            <div class="collection-payment-layout">
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Payment Details</div>
                    <div class="collection-payment-summary" id="collectorPaymentSummary" data-invoice-amount="${escapeHtml(invoiceAmount)}">
                        <div><span>Invoice Amount</span><strong id="collectorPaymentInvoiceAmount">${escapeHtml(formatCurrency(invoiceAmount))}</strong></div>
                        <div><span>Actual Received</span><strong id="collectorPaymentActual">${escapeHtml(formatCurrency(0))}</strong></div>
                        <div><span>2307 Deducted</span><strong id="collectorPaymentTaxDisplay">${escapeHtml(formatCurrency(0))}</strong></div>
                        <div><span>Balance</span><strong id="collectorPaymentBalanceDisplay">${escapeHtml(formatCurrency(invoiceAmount))}</strong></div>
                    </div>
                    <div class="collection-followup-form collection-payment-form">
                        <div>
                            <label>Amount Paid</label>
                            <input id="collectorPaymentPaidAmount" type="number" step="0.01" min="0" value="">
                        </div>
                        <div>
                            <label>Invoice Number</label>
                            <input id="collectorPaymentInvoiceNo" type="text" value="${escapeHtml(invoiceNo)}">
                            <input id="collectorPaymentInvoiceId" type="hidden" value="${escapeHtml(invoiceId)}">
                        </div>
                        <div>
                            <label>OR Number</label>
                            <input id="collectorPaymentOrNumber" type="text" value="">
                        </div>
                        <div>
                            <label>Date of Payment</label>
                            <input id="collectorPaymentDate" type="date" value="${escapeHtml(getTodayInputValue(0))}">
                        </div>
                        <label class="collection-check-row"><input id="collectorPaymentCash" type="checkbox" checked onchange="syncCollectorPaymentMethod('cash')"> Cash</label>
                        <label class="collection-check-row"><input id="collectorPaymentCheck" type="checkbox" onchange="syncCollectorPaymentMethod('check')"> Check</label>
                        <div>
                            <label>Check Number</label>
                            <input id="collectorPaymentCheckNumber" type="text" value="" disabled>
                        </div>
                        <div>
                            <label>Check Bank</label>
                            <input id="collectorPaymentCheckBank" type="text" value="" disabled>
                        </div>
                        <div>
                            <label>Date of Check</label>
                            <input id="collectorPaymentCheckDate" type="date" value="" disabled>
                        </div>
                        <div>
                            <label>2307 Deducted</label>
                            <input id="collectorPaymentTax2307" type="number" step="0.01" min="0" value="">
                        </div>
                        <div>
                            <label>Balance</label>
                            <input id="collectorPaymentBalance" type="number" step="0.01" readonly value="${escapeHtml(invoiceAmount.toFixed(2))}">
                        </div>
                        <div class="full">
                            <label>Remarks</label>
                            <textarea id="collectorPaymentRemarks" placeholder="Optional payment notes."></textarea>
                        </div>
                    </div>
                    <div class="detail-form-actions">
                        <button class="btn btn-primary" onclick="saveCollectorPayment()">Save Payment</button>
                        <span class="detail-save-status" id="collectorPaymentSaveStatus">Ready.</span>
                    </div>
                </div>

                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Saved Payment Records</div>
                    <div class="collection-payment-rollup">
                        <div><span>Collected</span><strong>${escapeHtml(formatCurrency(paymentTotal))}</strong></div>
                        <div><span>2307</span><strong>${escapeHtml(formatCurrency(taxTotal))}</strong></div>
                        <div><span>Remaining</span><strong>${escapeHtml(formatCurrency(paymentBalance))}</strong></div>
                    </div>
                    ${renderPaymentHistoryRows(paymentRecords)}
                </div>
            </div>
        </section>
    `;
}

function renderCollectorFollowupWorkspace(workspace) {
    const {
        cell,
        context,
        profile,
        override,
        selectedInvoice,
        branchInvoices,
        companyInvoices,
        invoiceHistory,
        lastHistory,
        serviceHistory,
        activeSchedule,
        branchBalance,
        companyBalance,
        selectedContact,
        selectedContactNumber,
        address
    } = workspace;

    const contacts = getCollectionContactRows(profile, override);
    const defaultFollowup = toDateKey(lastHistory?.followupDate) || getTodayInputValue(1);
    const statusId = Number(lastHistory?.statusId || 1);
    const locationId = Number(lastHistory?.locationId || 1);
    const fromTime = normalizeTimeInput(getProfileField(profile, override, 'collection_time_from', ['time_from'], ''));
    const toTime = normalizeTimeInput(getProfileField(profile, override, 'collection_time_to', ['time_to'], ''));
    const followupTime = normalizeTimeInput(getProfileField(profile, override, 'followup_time', ['followup_time'], ''));
    const contactNo = selectedContactNumber || '';
    const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || selectedInvoice?.amount || 0);
    const pendingAmount = Math.max(0, Number(branchBalance || billedTarget || 0));
    const scheduleStatusValue = String(activeSchedule?.schedule_status || 'Confirmed').trim();
    const scheduleDateValue = toDateKey(activeSchedule?.schedule_date || activeSchedule?.followup_date) || defaultFollowup;
    const scheduleTimeValue = normalizeTimeInput(activeSchedule?.schedule_time || activeSchedule?.collection_time || fromTime || followupTime || '');
    const scheduleIsActive = activeSchedule && String(activeSchedule.status || 'Active').toLowerCase() !== 'cancelled';
    const returnCallValue = activeSchedule?.return_call === true || String(activeSchedule?.return_call || '').toLowerCase() === 'true';
    const paymentRecords = getPaymentsForSelectedInvoice(selectedInvoice);
    const paymentTotal = paymentRecords.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const taxTotal = paymentRecords.reduce((sum, payment) => sum + Number(payment.tax2307 || 0), 0);
    const paymentBalance = Math.max(0, Number(selectedInvoice?.amount || billedTarget || 0) - paymentTotal - taxTotal);

    return `
        <div class="collection-followup-shell">
            <section class="collection-followup-hero">
                <div>
                    <div class="collection-followup-kicker">Invoice No. ${escapeHtml(selectedInvoice?.invoiceNo || selectedInvoice?.invoiceId || 'No invoice linked')}</div>
                    <h3>${escapeHtml(context.customer)}</h3>
                    <p>Status: Active • Model: ${escapeHtml(context.modelName || selectedInvoice?.modelName || '-')} • Serial: ${escapeHtml(displaySerialNumber(context.serialNumber || selectedInvoice?.serialNumber))}</p>
                </div>
                <div class="collection-balance-card">
                    <span>Branch Balance</span>
                    <strong>${escapeHtml(formatCurrency(pendingAmount))}</strong>
                    <em>Company open: ${escapeHtml(formatCurrency(companyBalance))}</em>
                </div>
            </section>

            <div class="collection-workspace-tabs" role="tablist" aria-label="Collection workspace sections">
                <button type="button" class="collection-workspace-tab active" id="collectorFollowupTab" role="tab" aria-selected="true" aria-controls="collectorFollowupPanel" onclick="setCollectorWorkspaceTab('followup')">Follow-up</button>
                <button type="button" class="collection-workspace-tab" id="collectorPaymentTab" role="tab" aria-selected="false" aria-controls="collectorPaymentPanel" onclick="setCollectorWorkspaceTab('payment')">Payment</button>
            </div>

            <section class="collection-followup-tab-panel" id="collectorFollowupPanel" role="tabpanel" aria-labelledby="collectorFollowupTab">
            <section class="collection-followup-grid">
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Contacts</div>
                    ${contacts.length ? `
                        <table class="collection-contact-table">
                            <thead><tr><th>Location</th><th>Contact</th><th>Contact No.</th><th></th></tr></thead>
                            <tbody>
                                ${contacts.map((row) => `
                                    <tr data-contact-person="${escapeHtml(row.name)}" data-contact-number="${escapeHtml(row.number)}">
                                        <td>${escapeHtml(row.location)}</td>
                                        <td>${escapeHtml(row.name || '-')}</td>
                                        <td>${escapeHtml(row.number || '-')}</td>
                                        <td><button class="btn btn-secondary btn-sm" onclick="useCollectorContact(this)">Use</button></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    ` : '<div class="collection-followup-empty">No contact profile found in collection info.</div>'}

                    <div class="collection-followup-mini-form">
                        <label>Collection Add.</label>
                        <textarea id="collectorProfileAddress">${escapeHtml(address || '')}</textarea>
                        <div class="collection-followup-two">
                            <div>
                                <label>Contact</label>
                                <input id="collectorProfileContactPerson" type="text" value="${escapeHtml(selectedContact || '')}">
                            </div>
                            <div>
                                <label>Contact #</label>
                                <input id="collectorProfileContactNumber" type="text" value="${escapeHtml(contactNo)}">
                            </div>
                        </div>
                        <div class="collection-followup-two">
                            <div>
                                <label>F/Up Days</label>
                                <input id="collectorProfileFollowupDays" type="text" value="${escapeHtml(getProfileField(profile, override, 'followup_days', ['followup_days'], ''))}">
                            </div>
                            <div>
                                <label>F/Up Time</label>
                                <input id="collectorProfileFollowupTime" type="time" value="${escapeHtml(followupTime)}">
                            </div>
                        </div>
                        <div class="collection-followup-two">
                            <div>
                                <label>Coll From</label>
                                <input id="collectorProfileTimeFrom" type="time" value="${escapeHtml(fromTime)}">
                            </div>
                            <div>
                                <label>Coll To</label>
                                <input id="collectorProfileTimeTo" type="time" value="${escapeHtml(toTime)}">
                            </div>
                        </div>
                        <label>Last Cntct</label>
                        <input id="collectorProfileLastContact" type="text" value="${escapeHtml(getProfileField(profile, override, 'last_contact', ['last_contact'], lastHistory?.contactPerson || ''))}">
                        <button class="btn btn-secondary btn-sm" onclick="saveCollectorProfileOverride()">Save Address / Policy Override</button>
                        <span class="detail-save-status" id="collectorProfileSaveStatus">${override ? 'Web override active.' : 'Legacy profile loaded.'}</span>
                    </div>
                </div>

                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Invoice State</div>
                    <div class="collection-followup-facts">
                        <div><span>Balance</span><strong>${escapeHtml(formatCurrency(branchBalance || billedTarget))}</strong></div>
                        <div><span>Date Received</span><strong>${escapeHtml(formatDate(selectedInvoice?.dateReceived || selectedInvoice?.invoiceDate))}</strong></div>
                        <div><span>Received By</span><strong>${escapeHtml(selectedInvoice?.receivedBy || '-')}</strong></div>
                        <div><span>Invoice Month</span><strong>${escapeHtml(selectedInvoice?.monthYear || context.label || '-')}</strong></div>
                    </div>
                    <div class="collection-followup-form">
                        <div>
                            <label>Received By</label>
                            <input id="collectorReceivedBy" type="text" value="${escapeHtml(selectedInvoice?.receivedBy || '')}">
                        </div>
                        <div>
                            <label>Contact No.</label>
                            <input id="collectorContactNumber" type="text" value="${escapeHtml(contactNo)}">
                        </div>
                        <div>
                            <label>Status</label>
                            <select id="collectorStatusId">
                                ${collectionStatusOptions.map((status) => `<option value="${escapeHtml(status.id)}"${Number(status.id) === statusId ? ' selected' : ''}>${escapeHtml(status.label)}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label>Inv. Location</label>
                            <select id="collectorLocationId">
                                ${COLLECTION_LOCATION_OPTIONS.map((option) => `<option value="${escapeHtml(option.id)}"${Number(option.id) === locationId ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label>Follow-up Date</label>
                            <input id="collectorFollowupDate" type="date" value="${escapeHtml(defaultFollowup)}">
                        </div>
                        <div>
                            <label>Coll Time</label>
                            <input id="collectorCollectionTime" type="time" value="${escapeHtml(fromTime || followupTime || '')}">
                        </div>
                        <div class="full">
                            <label>Remarks</label>
                            <textarea id="collectorRemarks" placeholder="Write where the invoice is now, who was contacted, and the next action."></textarea>
                        </div>
                        <label class="collection-check-row"><input id="collectorCheckSigned" type="checkbox"${lastHistory?.isCheckSigned ? ' checked' : ''}> Check Signed</label>
                        <div>
                            <label>Check No.</label>
                            <input id="collectorCheckNumber" type="text" value="${escapeHtml(lastHistory?.checkNumber || '')}">
                        </div>
                        <div>
                            <label>Amount</label>
                            <input id="collectorPaymentAmount" type="number" step="0.01" value="${lastHistory?.paymentAmount ? escapeHtml(lastHistory.paymentAmount) : ''}">
                        </div>
                        <div>
                            <label>Last Cntct</label>
                            <input id="collectorLastContact" type="text" value="${escapeHtml(lastHistory?.contactPerson || selectedContact || '')}">
                        </div>
                    </div>
                    <div class="detail-form-actions">
                        <button class="btn btn-primary" onclick="saveCollectorFollowup()">Save Follow-up</button>
                        <span class="detail-save-status" id="collectorFollowupSaveStatus">Ready.</span>
                    </div>
                </div>
            </section>

            <section class="collection-followup-panel collection-followup-schedule-panel">
                <div class="collection-followup-panel-title">Set Schedule</div>
                <div class="collection-schedule-form">
                    <label class="collection-check-row collection-schedule-return">
                        <input id="collectorScheduleReturnCall" type="checkbox"${returnCallValue ? ' checked' : ''}>
                        Return Call
                    </label>
                    <div class="collection-schedule-radio">
                        <label><input type="radio" name="collectorScheduleReturnChoice" value="yes"${returnCallValue ? ' checked' : ''}> Yes</label>
                        <label><input type="radio" name="collectorScheduleReturnChoice" value="no"${returnCallValue ? '' : ' checked'}> No</label>
                    </div>
                    <div>
                        <label>Schedule Date</label>
                        <input id="collectorScheduleDate" type="date" value="${escapeHtml(scheduleDateValue || '')}">
                    </div>
                    <div>
                        <label>Time</label>
                        <input id="collectorScheduleTime" type="time" value="${escapeHtml(scheduleTimeValue || '')}">
                    </div>
                    <div>
                        <label>Schedule Type</label>
                        <select id="collectorScheduleStatus">
                            ${COLLECTION_SCHEDULE_OPTIONS.map((option) => `<option value="${escapeHtml(option)}"${option.toLowerCase() === scheduleStatusValue.toLowerCase() ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="collection-schedule-actions">
                        <button class="btn btn-primary btn-sm" onclick="saveCollectorSchedule()">Save</button>
                        <button class="btn btn-secondary btn-sm" onclick="cancelCollectorSchedule()"${scheduleIsActive ? '' : ' disabled'}>Cancel Trial Schedule</button>
                    </div>
                </div>
                <div class="detail-save-status collection-schedule-status" id="collectorScheduleSaveStatus">
                    ${scheduleIsActive
                        ? `Active schedule: ${escapeHtml(scheduleStatusValue)}${scheduleDateValue ? ` on ${escapeHtml(formatDate(scheduleDateValue))}` : ''}.`
                        : (activeSchedule ? 'Schedule is cancelled.' : 'No active schedule yet.')}
                </div>
            </section>

            <section class="collection-followup-bottom">
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Branch Invoices</div>
                    ${renderMiniInvoiceRows(branchInvoices, 'No unpaid branch invoices found in the current Collections data.')}
                </div>
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Company Invoices</div>
                    ${renderMiniInvoiceRows(companyInvoices, 'No unpaid company invoices found in the current Collections data.')}
                </div>
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Invoice History</div>
                    ${renderHistoryRows(invoiceHistory)}
                </div>
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Service / Delivery History</div>
                    ${renderServiceRows(serviceHistory)}
                </div>
            </section>
            </section>

            ${renderCollectorPaymentTab(workspace, paymentRecords, paymentTotal, taxTotal, paymentBalance)}
        </div>
    `;
}

async function openCollectorCell(cellId) {
    const cell = collectorCellMap.get(String(cellId || '').trim());
    if (!cell) return;

    const modal = document.getElementById('collectorCellModal');
    const title = document.getElementById('collectorCellTitle');
    const subtitle = document.getElementById('collectorCellSubtitle');
    const content = document.getElementById('collectorCellContent');
    if (!modal || !title || !subtitle || !content) return;

    const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
    const pendingAmount = Math.max(0, billedTarget - cell.collectedTotal);
    title.textContent = `${cell.customer} • ${cell.branchName || cell.accountLabel || 'Main'} • ${cell.label}`;
    subtitle.textContent = `Loading collection profile, unpaid invoices, history, and service records for this follow-up.`;
    content.innerHTML = `
        <div class="cell-modal-summary">
            <div class="cell-modal-card">
                <div class="label">RD</div>
                <div class="value">${escapeHtml(String(cell.rdValues.filter(Boolean).sort((a, b) => a - b)[0] || '-'))}</div>
            </div>
            <div class="cell-modal-card">
                <div class="label">Billed</div>
                <div class="value">${escapeHtml(formatCurrency(billedTarget))}</div>
            </div>
            <div class="cell-modal-card">
                <div class="label">Collected</div>
                <div class="value">${escapeHtml(formatCurrency(cell.collectedTotal))}</div>
            </div>
            <div class="cell-modal-card">
                <div class="label">Pending</div>
                <div class="value">${escapeHtml(formatCurrency(pendingAmount))}</div>
            </div>
        </div>
        <div class="collector-cell-status-row">
            ${cell.missedReading ? '<span class="collector-chip pending">Missed Reading</span>' : ''}
            ${cell.catchUpBilling ? `<span class="collector-chip viewport">Catch-up Billing${cell.catchUpGapMonths > 1 ? ` (${escapeHtml(String(cell.catchUpGapMonths))} months)` : ''}</span>` : ''}
            ${cell.pendingBilling && !cell.missedReading ? '<span class="collector-chip pending">Pending Billing</span>' : ''}
            <span class="collector-chip">Preparing follow-up workspace...</span>
        </div>
    `;

    modal.classList.remove('hidden');

    currentCollectorWorkspace = {
        cell,
        context: resolveCollectorCellContext(cell),
        cellId: cell.id
    };

    try {
        const workspace = await buildCollectorFollowupWorkspace(cell);
        if (currentCollectorWorkspace?.cellId !== cell.id) return;
        currentCollectorWorkspace = {
            ...workspace,
            cellId: cell.id
        };

        const selectedInvoice = workspace.selectedInvoice;
        title.textContent = `${workspace.context.customer} • ${workspace.context.branchName || 'Main'} • ${workspace.context.label}`;
        subtitle.textContent = selectedInvoice
            ? `Invoice #${selectedInvoice.invoiceNo || selectedInvoice.invoiceId || '-'} follow-up`
            : `Follow-up workspace`;
        content.innerHTML = renderCollectorFollowupWorkspace(workspace);
        bindCollectorPaymentForm();
    } catch (error) {
        console.error('Failed to open collection follow-up workspace:', error);
        subtitle.textContent = 'Collection follow-up workspace could not load completely.';
        content.innerHTML += `
            <div class="detail-last-remark">
                <h4>Unable to load follow-up workspace</h4>
                <p>Please refresh Collections and try again. No history or profile data was changed.</p>
            </div>
        `;
    }
}

function openCollectorCellByToken(token) {
    void openCollectorCell(decodeURIComponent(String(token || '')));
}

function closeCollectorCellModal() {
    document.getElementById('collectorCellModal')?.classList.add('hidden');
}

function openCollectorInvoiceFromCell(invoiceKey) {
    closeCollectorCellModal();
    viewInvoiceDetail(decodeURIComponent(String(invoiceKey || '')));
}

function setCollectorWorkspaceTab(tabName) {
    const activeTab = tabName === 'payment' ? 'payment' : 'followup';
    const followupPanel = document.getElementById('collectorFollowupPanel');
    const paymentPanel = document.getElementById('collectorPaymentPanel');
    const followupTab = document.getElementById('collectorFollowupTab');
    const paymentTab = document.getElementById('collectorPaymentTab');

    if (followupPanel) followupPanel.hidden = activeTab !== 'followup';
    if (paymentPanel) paymentPanel.hidden = activeTab !== 'payment';

    if (followupTab) {
        followupTab.classList.toggle('active', activeTab === 'followup');
        followupTab.setAttribute('aria-selected', activeTab === 'followup' ? 'true' : 'false');
    }
    if (paymentTab) {
        paymentTab.classList.toggle('active', activeTab === 'payment');
        paymentTab.setAttribute('aria-selected', activeTab === 'payment' ? 'true' : 'false');
    }

    if (activeTab === 'payment') updateCollectorPaymentBalance();
}

function updateCollectorPaymentBalance() {
    const summary = document.getElementById('collectorPaymentSummary');
    if (!summary) return;

    const invoiceAmount = parseMoneyInput(summary.dataset.invoiceAmount || '0');
    const paidAmount = parseMoneyInput(document.getElementById('collectorPaymentPaidAmount')?.value || '0');
    const tax2307 = parseMoneyInput(document.getElementById('collectorPaymentTax2307')?.value || '0');
    const balance = Math.max(0, invoiceAmount - paidAmount - tax2307);
    const balanceInput = document.getElementById('collectorPaymentBalance');
    const actualNode = document.getElementById('collectorPaymentActual');
    const taxNode = document.getElementById('collectorPaymentTaxDisplay');
    const balanceNode = document.getElementById('collectorPaymentBalanceDisplay');

    if (balanceInput) balanceInput.value = balance.toFixed(2);
    if (actualNode) actualNode.textContent = formatCurrency(paidAmount);
    if (taxNode) taxNode.textContent = formatCurrency(tax2307);
    if (balanceNode) balanceNode.textContent = formatCurrency(balance);
}

function bindCollectorPaymentForm() {
    ['collectorPaymentPaidAmount', 'collectorPaymentTax2307'].forEach((id) => {
        const input = document.getElementById(id);
        input?.addEventListener('input', updateCollectorPaymentBalance);
    });
    syncCollectorPaymentMethod(document.getElementById('collectorPaymentCheck')?.checked ? 'check' : 'cash');
    updateCollectorPaymentBalance();
}

function syncCollectorPaymentMethod(method) {
    const isCheck = method === 'check';
    const cashInput = document.getElementById('collectorPaymentCash');
    const checkInput = document.getElementById('collectorPaymentCheck');
    const checkNumber = document.getElementById('collectorPaymentCheckNumber');
    const checkBank = document.getElementById('collectorPaymentCheckBank');
    const checkDate = document.getElementById('collectorPaymentCheckDate');

    if (cashInput) cashInput.checked = !isCheck;
    if (checkInput) checkInput.checked = isCheck;
    [checkNumber, checkBank, checkDate].forEach((input) => {
        if (input) input.disabled = !isCheck;
    });
}

function useCollectorContact(button) {
    const row = button?.closest?.('tr');
    if (!row) return;

    const person = row.dataset.contactPerson || '';
    const number = row.dataset.contactNumber || '';
    const followupContact = document.getElementById('collectorLastContact');
    const profileContact = document.getElementById('collectorProfileContactPerson');
    const profileNumber = document.getElementById('collectorProfileContactNumber');
    const contactNumber = document.getElementById('collectorContactNumber');

    if (followupContact) followupContact.value = person;
    if (profileContact) profileContact.value = person;
    if (profileNumber) profileNumber.value = number;
    if (contactNumber) contactNumber.value = number;
}

async function saveCollectorProfileOverride() {
    if (!currentCollectorWorkspace?.context || isSavingCollectorProfileOverride) return;

    const statusNode = document.getElementById('collectorProfileSaveStatus');
    const context = currentCollectorWorkspace.context;
    const docId = collectionProfileOverrideDocId(context);

    const override = {
        branch_id: context.branchId || '',
        company_id: context.companyId || '',
        contractmain_id: context.contractmainId || '',
        customer: context.customer || '',
        branch: context.branchName || '',
        collection_address: String(document.getElementById('collectorProfileAddress')?.value || '').trim(),
        contact_person: String(document.getElementById('collectorProfileContactPerson')?.value || '').trim(),
        contact_number: String(document.getElementById('collectorProfileContactNumber')?.value || '').trim(),
        followup_days: String(document.getElementById('collectorProfileFollowupDays')?.value || '').trim(),
        followup_time: String(document.getElementById('collectorProfileFollowupTime')?.value || '').trim(),
        collection_time_from: String(document.getElementById('collectorProfileTimeFrom')?.value || '').trim(),
        collection_time_to: String(document.getElementById('collectorProfileTimeTo')?.value || '').trim(),
        last_contact: String(document.getElementById('collectorProfileLastContact')?.value || '').trim(),
        updated_at: toTimestampString(new Date()),
        source: 'collections_web_override'
    };

    isSavingCollectorProfileOverride = true;
    if (statusNode) statusNode.textContent = 'Saving web override...';

    try {
        const fields = {};
        Object.entries(override).forEach(([key, value]) => {
            fields[key] = toFirestoreWriteValue(value);
        });

        await firestoreSetDocument('marga_collection_profiles', docId, fields);
        upsertCollectionProfileOverride(context, override);

        if (statusNode) statusNode.textContent = 'Saved as web override. Legacy collection info was not changed.';
    } catch (error) {
        console.error('Failed to save collection profile override:', error);
        if (statusNode) statusNode.textContent = 'Override save failed. Follow-up history was not affected.';
    } finally {
        isSavingCollectorProfileOverride = false;
    }
}

async function saveCollectorPayment() {
    if (!currentCollectorWorkspace || isSavingCollectorPayment) return;

    const statusNode = document.getElementById('collectorPaymentSaveStatus');
    const selectedInvoice = currentCollectorWorkspace.selectedInvoice;
    const invoiceNo = String(document.getElementById('collectorPaymentInvoiceNo')?.value || selectedInvoice?.invoiceNo || selectedInvoice?.invoiceId || '').trim();
    const invoiceId = String(document.getElementById('collectorPaymentInvoiceId')?.value || selectedInvoice?.invoiceId || selectedInvoice?.invoiceNo || invoiceNo || '').trim();
    const amountPaid = parseMoneyInput(document.getElementById('collectorPaymentPaidAmount')?.value || '0');
    const tax2307 = parseMoneyInput(document.getElementById('collectorPaymentTax2307')?.value || '0');
    const balance = parseMoneyInput(document.getElementById('collectorPaymentBalance')?.value || '0');
    const orNumber = String(document.getElementById('collectorPaymentOrNumber')?.value || '').trim();
    const paymentDate = String(document.getElementById('collectorPaymentDate')?.value || '').trim();
    const isCheck = Boolean(document.getElementById('collectorPaymentCheck')?.checked);
    const checkNumber = String(document.getElementById('collectorPaymentCheckNumber')?.value || '').trim();
    const checkBank = String(document.getElementById('collectorPaymentCheckBank')?.value || '').trim();
    const checkDate = String(document.getElementById('collectorPaymentCheckDate')?.value || '').trim();
    const remarks = String(document.getElementById('collectorPaymentRemarks')?.value || '').trim();
    const now = toTimestampString(new Date());

    if (!invoiceId && !invoiceNo) {
        if (statusNode) statusNode.textContent = 'No invoice is linked to this payment.';
        return;
    }

    if (!(amountPaid > 0) && !(tax2307 > 0)) {
        if (statusNode) statusNode.textContent = 'Enter the actual amount received or 2307 deducted.';
        return;
    }

    if (!paymentDate) {
        if (statusNode) statusNode.textContent = 'Set the date of payment.';
        return;
    }

    if (isCheck && (!checkNumber || !checkBank || !checkDate)) {
        if (statusNode) statusNode.textContent = 'Complete check number, bank, and check date.';
        return;
    }

    isSavingCollectorPayment = true;
    if (statusNode) statusNode.textContent = 'Saving payment record...';

    try {
        const paymentDocId = createWebDocId('web_payment');
        const checkDocId = isCheck ? createWebDocId('web_checkpayment') : '';
        const paymentFields = {
            id: toFirestoreWriteValue(paymentDocId),
            invoice_id: toFirestoreWriteValue(invoiceId || invoiceNo),
            invoice_num: toFirestoreWriteValue(invoiceNo || invoiceId),
            payment_amt: toFirestoreWriteValue(amountPaid),
            balance_amt: toFirestoreWriteValue(balance),
            date_deposit: toFirestoreWriteValue(formatInputDateTime(paymentDate)),
            date_paid: toFirestoreWriteValue(formatInputDateTime(paymentDate)),
            ornum: toFirestoreWriteValue(orNumber),
            payment_type: toFirestoreWriteValue(isCheck ? 1 : 0),
            tax_2307: toFirestoreWriteValue(tax2307),
            tax_date_paid: toFirestoreWriteValue(formatInputDateTime(tax2307 > 0 ? paymentDate : '')),
            tax_status: toFirestoreWriteValue(tax2307 > 0 ? 1 : 0),
            checkpayment_id: toFirestoreWriteValue(checkDocId || 0),
            remarks: toFirestoreWriteValue(remarks),
            timestamp: toFirestoreWriteValue(now),
            source: toFirestoreWriteValue('collections_web_payment')
        };

        await firestoreSetDocument('tbl_paymentinfo', paymentDocId, paymentFields);

        if (isCheck) {
            await firestoreSetDocument('tbl_checkpayments', checkDocId, {
                id: toFirestoreWriteValue(checkDocId),
                payments_id: toFirestoreWriteValue(paymentDocId),
                invoice_id: toFirestoreWriteValue(invoiceId || invoiceNo),
                check_number: toFirestoreWriteValue(checkNumber),
                bank: toFirestoreWriteValue(checkBank),
                account_number: toFirestoreWriteValue(''),
                check_amt: toFirestoreWriteValue(amountPaid),
                check_date: toFirestoreWriteValue(formatInputDateTime(checkDate)),
                remarks: toFirestoreWriteValue(remarks),
                source: toFirestoreWriteValue('collections_web_payment'),
                timestamp: toFirestoreWriteValue(now)
            });
        }

        paymentEntries.push({
            docId: paymentDocId,
            id: paymentDocId,
            invoiceId: invoiceId || invoiceNo,
            invoiceNo: invoiceNo || invoiceId,
            amount: amountPaid,
            balanceAmount: balance,
            paymentDate: normalizeDate(paymentDate),
            datePaid: normalizeDate(paymentDate),
            dateDeposit: normalizeDate(paymentDate),
            taxDatePaid: tax2307 > 0 ? normalizeDate(paymentDate) : null,
            orNumber,
            paymentType: isCheck ? '1' : '0',
            tax2307,
            taxStatus: tax2307 > 0 ? '1' : '0',
            checkpaymentId: checkDocId,
            remarks
        });
        if (balance <= 0.01 && (invoiceId || invoiceNo)) paidInvoiceIds.add(invoiceId || invoiceNo);

        const refreshed = await buildCollectorFollowupWorkspace(currentCollectorWorkspace.cell);
        currentCollectorWorkspace = {
            ...refreshed,
            cellId: refreshed.cell.id
        };

        const content = document.getElementById('collectorCellContent');
        if (content) content.innerHTML = renderCollectorFollowupWorkspace(refreshed);
        bindCollectorPaymentForm();
        setCollectorWorkspaceTab('payment');
        const refreshedStatusNode = document.getElementById('collectorPaymentSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = 'Saved. Payment record updated.';
    } catch (error) {
        console.error('Failed to save collection payment:', error);
        if (statusNode) statusNode.textContent = 'Payment save failed. Please try again.';
    } finally {
        isSavingCollectorPayment = false;
    }
}

async function saveCollectorFollowup() {
    if (!currentCollectorWorkspace || isSavingCollectorFollowup) return;

    const statusNode = document.getElementById('collectorFollowupSaveStatus');
    const selectedInvoice = currentCollectorWorkspace.selectedInvoice;

    if (!selectedInvoice?.invoiceNo && !selectedInvoice?.invoiceId) {
        if (statusNode) statusNode.textContent = 'No invoice number is linked to this cell yet, so history cannot be saved.';
        return;
    }

    const remarks = String(document.getElementById('collectorRemarks')?.value || '').trim();
    const followupDate = String(document.getElementById('collectorFollowupDate')?.value || '').trim();
    const collectionTime = String(document.getElementById('collectorCollectionTime')?.value || '').trim();
    const contactPerson = String(document.getElementById('collectorLastContact')?.value || '').trim();
    const contactNumber = String(document.getElementById('collectorContactNumber')?.value || '').trim();
    const statusId = Number(document.getElementById('collectorStatusId')?.value || 0);
    const locationId = Number(document.getElementById('collectorLocationId')?.value || 0);
    const locationOption = COLLECTION_LOCATION_OPTIONS.find((option) => Number(option.id) === locationId);
    const checkSigned = Boolean(document.getElementById('collectorCheckSigned')?.checked);
    const checkNumber = String(document.getElementById('collectorCheckNumber')?.value || '').trim();
    const paymentAmountRaw = String(document.getElementById('collectorPaymentAmount')?.value || '').trim();
    const paymentAmount = paymentAmountRaw ? Number(paymentAmountRaw) : 0;

    if (!remarks) {
        if (statusNode) statusNode.textContent = 'Please enter remarks before saving.';
        return;
    }

    if (!followupDate) {
        if (statusNode) statusNode.textContent = 'Please set the next follow-up date.';
        return;
    }

    const normalizedTime = collectionTime ? `${collectionTime.length === 5 ? collectionTime : collectionTime.slice(0, 5)}:00` : '00:00:00';

    isSavingCollectorFollowup = true;
    if (statusNode) statusNode.textContent = 'Saving follow-up history...';

    try {
        const invoiceNo = String(selectedInvoice.invoiceNo || selectedInvoice.invoiceId || '').trim();
        const invoiceId = String(selectedInvoice.invoiceId || selectedInvoice.invoiceNo || '').trim();
        await firestoreCreate('tbl_collectionhistory', {
            invoice_num: { stringValue: invoiceNo },
            invoice_id: { stringValue: invoiceId },
            remarks: { stringValue: remarks },
            contact_person: { stringValue: contactPerson || '-' },
            contact_number: { stringValue: contactNumber || '' },
            followup_datetime: { stringValue: `${followupDate} ${normalizedTime}` },
            timestamp: { stringValue: toTimestampString(new Date()) },
            schedule_status: { integerValue: String(statusId || 0) },
            status_id: { integerValue: String(statusId || 0) },
            location_id: { integerValue: String(locationId || 0) },
            location_label: { stringValue: locationOption?.label || '' },
            ischecksigned: { booleanValue: checkSigned },
            check_number: { stringValue: checkNumber },
            payment_amount: { doubleValue: Number.isFinite(paymentAmount) ? paymentAmount : 0 }
        });

        await loadCollectionHistory();

        const refreshed = await buildCollectorFollowupWorkspace(currentCollectorWorkspace.cell);
        currentCollectorWorkspace = {
            ...refreshed,
            cellId: refreshed.cell.id
        };

        const content = document.getElementById('collectorCellContent');
        if (content) content.innerHTML = renderCollectorFollowupWorkspace(refreshed);
        bindCollectorPaymentForm();
        const refreshedStatusNode = document.getElementById('collectorFollowupSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = 'Saved. Follow-up history updated.';
    } catch (error) {
        console.error('Failed to save collection follow-up:', error);
        if (statusNode) statusNode.textContent = 'Save failed. Please try again.';
    } finally {
        isSavingCollectorFollowup = false;
    }
}

function buildCollectorScheduleRecord(workspace, options = {}) {
    const context = workspace.context || {};
    const selectedInvoice = workspace.selectedInvoice || {};
    const scheduleStatus = options.scheduleStatus || String(document.getElementById('collectorScheduleStatus')?.value || 'Confirmed').trim();
    const scheduleDate = options.scheduleDate || String(document.getElementById('collectorScheduleDate')?.value || '').trim();
    const scheduleTime = options.scheduleTime || String(document.getElementById('collectorScheduleTime')?.value || '').trim();
    const returnCallRadio = document.querySelector('input[name="collectorScheduleReturnChoice"]:checked')?.value;
    const returnCall = options.returnCall !== undefined
        ? options.returnCall
        : (returnCallRadio ? returnCallRadio === 'yes' : Boolean(document.getElementById('collectorScheduleReturnCall')?.checked));
    const invoiceNo = String(selectedInvoice.invoiceNo || selectedInvoice.invoiceId || '').trim();
    const now = toTimestampString(new Date());
    const previous = workspace.activeSchedule || {};
    const branch = branchMap[normalizeLookupId(context.branchId)] || {};

    return {
        ...previous,
        source: 'collections_followup',
        purpose: getSchedulePurposeLabel(scheduleStatus),
        schedule_status: scheduleStatus,
        schedule_status_key: scheduleSlug(scheduleStatus),
        status: options.status || 'Active',
        trial_schedule: true,
        return_call: returnCall,
        schedule_date: scheduleDate,
        schedule_time: scheduleTime,
        followup_date: String(document.getElementById('collectorFollowupDate')?.value || scheduleDate || '').trim(),
        collection_time: String(document.getElementById('collectorCollectionTime')?.value || scheduleTime || '').trim(),
        invoice_no: invoiceNo,
        invoice_id: String(selectedInvoice.invoiceId || selectedInvoice.invoiceNo || '').trim(),
        invoice_month: selectedInvoice.monthYear || context.label || '',
        amount: Number(selectedInvoice.amount || selectedInvoice.billedAmount || workspace.branchBalance || 0),
        balance: Number(workspace.branchBalance || selectedInvoice.amount || 0),
        company_id: context.companyId || '',
        branch_id: context.branchId || '',
        contractmain_id: context.contractmainId || '',
        machine_id: context.machineId || '',
        customer: context.customer || selectedInvoice.company || '',
        branch: context.branchName || selectedInvoice.branch || branch.name || '',
        model: context.modelName || selectedInvoice.modelName || '',
        serial: displaySerialNumber(context.serialNumber || selectedInvoice.serialNumber || ''),
        assigned_to: getCurrentCollectorName(),
        collection_address: String(document.getElementById('collectorProfileAddress')?.value || workspace.address || branch.address || '').trim(),
        contact_person: String(document.getElementById('collectorLastContact')?.value || document.getElementById('collectorProfileContactPerson')?.value || '').trim(),
        contact_number: String(document.getElementById('collectorContactNumber')?.value || document.getElementById('collectorProfileContactNumber')?.value || '').trim(),
        remarks: String(document.getElementById('collectorRemarks')?.value || previous.remarks || '').trim(),
        area_group: previous.area_group || 'Area Group 1 (Unassigned)',
        updated_at: now,
        created_at: previous.created_at || now
    };
}

async function saveCollectorSchedule() {
    if (!currentCollectorWorkspace || isSavingCollectorSchedule) return;

    const statusNode = document.getElementById('collectorScheduleSaveStatus');
    const selectedInvoice = currentCollectorWorkspace.selectedInvoice;
    const context = currentCollectorWorkspace.context;
    const scheduleDate = String(document.getElementById('collectorScheduleDate')?.value || '').trim();

    if (!selectedInvoice?.invoiceNo && !selectedInvoice?.invoiceId) {
        if (statusNode) statusNode.textContent = 'No invoice is linked to this cell yet, so a schedule cannot be saved.';
        return;
    }

    if (!scheduleDate) {
        if (statusNode) statusNode.textContent = 'Please choose a schedule date.';
        return;
    }

    const docId = collectionScheduleDocId(context, selectedInvoice);
    const record = buildCollectorScheduleRecord(currentCollectorWorkspace, { scheduleDate, status: 'Active' });
    const fields = {};
    Object.entries(record).forEach(([key, value]) => {
        if (!key.startsWith('_')) fields[key] = toFirestoreWriteValue(value);
    });

    isSavingCollectorSchedule = true;
    if (statusNode) statusNode.textContent = 'Saving schedule...';

    try {
        await firestoreSetDocument('marga_master_schedule', docId, fields);
        currentCollectorWorkspace.activeSchedule = { ...record, _docId: docId };

        const content = document.getElementById('collectorCellContent');
        if (content) content.innerHTML = renderCollectorFollowupWorkspace(currentCollectorWorkspace);
        bindCollectorPaymentForm();

        const refreshedStatusNode = document.getElementById('collectorScheduleSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = 'Saved to Master Schedule.';
    } catch (error) {
        console.error('Failed to save collection schedule:', error);
        if (statusNode) statusNode.textContent = 'Schedule save failed. Follow-up history was not changed.';
    } finally {
        isSavingCollectorSchedule = false;
    }
}

async function cancelCollectorSchedule() {
    if (!currentCollectorWorkspace || isSavingCollectorSchedule) return;

    const statusNode = document.getElementById('collectorScheduleSaveStatus');
    const selectedInvoice = currentCollectorWorkspace.selectedInvoice;
    const context = currentCollectorWorkspace.context;
    const activeSchedule = currentCollectorWorkspace.activeSchedule;

    if (!activeSchedule || String(activeSchedule.status || '').toLowerCase() === 'cancelled') {
        if (statusNode) statusNode.textContent = 'There is no active trial schedule to cancel.';
        return;
    }

    const docId = activeSchedule._docId || collectionScheduleDocId(context, selectedInvoice);
    const cancelled = {
        ...activeSchedule,
        status: 'Cancelled',
        cancelled_at: toTimestampString(new Date()),
        updated_at: toTimestampString(new Date()),
        cancelled_by: getCurrentCollectorName()
    };
    const fields = {};
    Object.entries(cancelled).forEach(([key, value]) => {
        if (!key.startsWith('_')) fields[key] = toFirestoreWriteValue(value);
    });

    isSavingCollectorSchedule = true;
    if (statusNode) statusNode.textContent = 'Cancelling schedule...';

    try {
        await firestoreSetDocument('marga_master_schedule', docId, fields);
        currentCollectorWorkspace.activeSchedule = { ...cancelled, _docId: docId };

        const content = document.getElementById('collectorCellContent');
        if (content) content.innerHTML = renderCollectorFollowupWorkspace(currentCollectorWorkspace);
        bindCollectorPaymentForm();

        const refreshedStatusNode = document.getElementById('collectorScheduleSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = 'Trial schedule cancelled.';
    } catch (error) {
        console.error('Failed to cancel collection schedule:', error);
        if (statusNode) statusNode.textContent = 'Cancel failed. Please try again.';
    } finally {
        isSavingCollectorSchedule = false;
    }
}

function toggleAnalyticsDashboard(forceValue = null) {
    analyticsDashboardVisible = typeof forceValue === 'boolean' ? forceValue : !analyticsDashboardVisible;

    const dashboard = document.getElementById('trend-dashboard');
    const button = document.getElementById('btnToggleAnalytics');

    dashboard?.classList.toggle('dashboard-hidden', !analyticsDashboardVisible);
    if (button) button.textContent = analyticsDashboardVisible ? 'Hide Analytics' : 'Analytics';
}

function renderTrendDashboard() {
    const trendData = computeMonthlyTrendData();
    renderTrendSummaryCards(trendData);
    renderTrendInsights(trendData);
    renderTrendStrip(trendData);
    renderTrendComparisonTable(trendData);
}

function getTodayScheduledInvoices() {
    const seen = new Set();
    const rows = [];

    todayFollowups.forEach((followup) => {
        const invoice = findInvoiceByKey(followup.invoiceKey);
        if (!invoice) return;

        const key = invoice.invoiceKey;
        if (seen.has(key)) return;
        seen.add(key);

        rows.push({
            ...invoice,
            scheduledFollowupDate: followup.followupDate,
            scheduledRemarks: followup.remarks,
            scheduledContactPerson: followup.contactPerson,
            scheduledStatus: followup.scheduleStatus
        });
    });

    rows.sort((a, b) => b.amount - a.amount);
    return rows;
}

function getUrgentNotCalledInvoices() {
    return allInvoices
        .filter((invoice) => {
            if (invoice.priority.code !== 'urgent') return false;
            if (invoice.lastContactDays === null) return true;
            return invoice.lastContactDays >= 20;
        })
        .sort((a, b) => {
            const daysA = a.lastContactDays === null ? 9999 : a.lastContactDays;
            const daysB = b.lastContactDays === null ? 9999 : b.lastContactDays;
            return daysB - daysA;
        });
}

function getPromiseDueTodayInvoices() {
    const rows = getTodayScheduledInvoices().filter((invoice) => {
        const remarks = String(invoice.scheduledRemarks || '');
        const status = Number(invoice.scheduleStatus || invoice.scheduledStatus || 0);
        if (status >= 5) return true;
        return PROMISE_REMARK_PATTERN.test(remarks);
    });

    rows.sort((a, b) => b.amount - a.amount);
    return rows;
}

function getHighValueDueThisWeekInvoices() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const weekEnd = new Date(now.getTime());
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekEnd.setHours(23, 59, 59, 999);

    return allInvoices
        .filter((invoice) => {
            const dueDate = normalizeDate(invoice.dueDate);
            if (!dueDate) return false;
            if (dueDate < now || dueDate > weekEnd) return false;
            return invoice.amount >= 10000;
        })
        .sort((a, b) => b.amount - a.amount);
}

function hasMeaningfulContact(value) {
    const raw = String(value || '')
        .replace(/[^a-zA-Z0-9 ]/g, ' ')
        .trim()
        .toLowerCase();

    if (!raw) return false;
    if (raw === '-' || raw === 'none' || raw === 'n a' || raw === 'na') return false;
    return raw.length >= 2;
}

function getMissingContactInvoices() {
    return allInvoices
        .filter((invoice) => {
            if (invoice.history.length === 0) return true;
            return !invoice.history.some((entry) => hasMeaningfulContact(entry.contactPerson));
        })
        .sort((a, b) => {
            if (b.age !== a.age) return b.age - a.age;
            return b.amount - a.amount;
        });
}

function updateActionBrief() {
    const scheduled = getTodayScheduledInvoices();
    const promises = getPromiseDueTodayInvoices();
    const staleUrgent = getUrgentNotCalledInvoices();
    const highValueDue = getHighValueDueThisWeekInvoices();
    const missingContact = getMissingContactInvoices();

    const setText = (id, value) => {
        const node = document.getElementById(id);
        if (!node) return;
        node.textContent = value;
    };

    setText('brief-scheduled-count', scheduled.length.toLocaleString());
    setText(
        'brief-scheduled-amount',
        `Amount: ${formatCurrencyShort(scheduled.reduce((sum, inv) => sum + inv.amount, 0))}`
    );

    setText('brief-promises-count', promises.length.toLocaleString());
    setText(
        'brief-promises-amount',
        `Amount: ${formatCurrencyShort(promises.reduce((sum, inv) => sum + inv.amount, 0))}`
    );

    setText('brief-urgent-stale-count', staleUrgent.length.toLocaleString());
    setText(
        'brief-urgent-stale-amount',
        `Amount: ${formatCurrencyShort(staleUrgent.reduce((sum, inv) => sum + inv.amount, 0))}`
    );

    setText('brief-high-value-count', highValueDue.length.toLocaleString());
    setText(
        'brief-high-value-amount',
        `Amount: ${formatCurrencyShort(highValueDue.reduce((sum, inv) => sum + inv.amount, 0))}`
    );

    setText('brief-missing-contact-count', missingContact.length.toLocaleString());
}

function renderTodayScheduleTable() {
    const container = document.getElementById('today-schedule-table');
    if (!container) return;

    const rows = getTodayScheduledInvoices();

    if (rows.length === 0) {
        container.innerHTML = '<div class="empty-followup">No scheduled collection pick-up for today.</div>';
        return;
    }

    container.innerHTML = `
        <table class="data-table mini-table">
            <thead>
                <tr>
                    <th>Invoice No</th>
                    <th>Inv Date</th>
                    <th>Company</th>
                    <th>Branch/Department</th>
                    <th>Amount</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .slice(0, 25)
                    .map(
                        (inv) => `
                    <tr class="clickable-row" onclick="viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
                        <td>#${escapeHtml(inv.invoiceNo)}</td>
                        <td>${escapeHtml(formatDate(inv.invoiceDate || inv.dueDate))}</td>
                        <td>${escapeHtml(inv.company)}</td>
                        <td>${escapeHtml(inv.branch)}</td>
                        <td class="amount">${escapeHtml(formatCurrency(inv.amount))}</td>
                        <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
                    </tr>
                `
                    )
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderPromiseDueTable() {
    const container = document.getElementById('promise-due-table');
    if (!container) return;

    const rows = getPromiseDueTodayInvoices();

    if (rows.length === 0) {
        container.innerHTML = '<div class="empty-followup">No promise-due account for today.</div>';
        return;
    }

    container.innerHTML = `
        <table class="data-table mini-table">
            <thead>
                <tr>
                    <th>Invoice No</th>
                    <th>Company</th>
                    <th>Age</th>
                    <th>Amount</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .slice(0, 25)
                    .map(
                        (inv) => `
                    <tr class="clickable-row" onclick="viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
                        <td>#${escapeHtml(inv.invoiceNo)}</td>
                        <td>${escapeHtml(inv.company)}</td>
                        <td><span class="${escapeHtml(getAgeClass(inv.age))}">${escapeHtml(String(inv.age))}d</span></td>
                        <td class="amount">${escapeHtml(formatCurrency(inv.amount))}</td>
                        <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
                    </tr>
                `
                    )
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderUrgentStaleTable() {
    const container = document.getElementById('urgent-stale-table');
    if (!container) return;

    const rows = getUrgentNotCalledInvoices();

    if (rows.length === 0) {
        container.innerHTML = '<div class="empty-followup">No urgent account pending call for 20+ days.</div>';
        return;
    }

    container.innerHTML = `
        <table class="data-table mini-table">
            <thead>
                <tr>
                    <th>Invoice No</th>
                    <th>Company</th>
                    <th>Branch/Department</th>
                    <th>Age</th>
                    <th>Last Call</th>
                    <th>Amount</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .slice(0, 25)
                    .map((inv) => {
                        const lastCall =
                            inv.lastContactDays === null
                                ? 'Never called'
                                : `${inv.lastContactDays}d ago (${formatDate(inv.lastContactDate)})`;

                        return `
                            <tr class="clickable-row" onclick="viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
                                <td>#${escapeHtml(inv.invoiceNo)}</td>
                                <td>${escapeHtml(inv.company)}</td>
                                <td>${escapeHtml(inv.branch)}</td>
                                <td><span class="${escapeHtml(getAgeClass(inv.age))}">${escapeHtml(String(inv.age))}d</span></td>
                                <td>${escapeHtml(lastCall)}</td>
                                <td class="amount">${escapeHtml(formatCurrency(inv.amount))}</td>
                                <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
                            </tr>
                        `;
                    })
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderMissingContactTable() {
    const container = document.getElementById('missing-contact-table');
    if (!container) return;

    const rows = getMissingContactInvoices();

    if (rows.length === 0) {
        container.innerHTML = '<div class="empty-followup">No missing-contact account in current queue.</div>';
        return;
    }

    container.innerHTML = `
        <table class="data-table mini-table">
            <thead>
                <tr>
                    <th>Invoice No</th>
                    <th>Company</th>
                    <th>Age</th>
                    <th>Last Call</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .slice(0, 25)
                    .map((inv) => {
                        const lastCall =
                            inv.lastContactDays === null
                                ? 'No call yet'
                                : `${inv.lastContactDays}d ago (${formatDate(inv.lastContactDate)})`;

                        return `
                            <tr class="clickable-row" onclick="viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
                                <td>#${escapeHtml(inv.invoiceNo)}</td>
                                <td>${escapeHtml(inv.company)}</td>
                                <td><span class="${escapeHtml(getAgeClass(inv.age))}">${escapeHtml(String(inv.age))}d</span></td>
                                <td>${escapeHtml(lastCall)}</td>
                                <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
                            </tr>
                        `;
                    })
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderTable() {
    const container = document.getElementById('table-container');
    if (!container) return;

    if (filteredInvoices.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No invoices found</h3>
                <p>Try changing filters or quick age buttons.</p>
            </div>
        `;

        const pagination = document.getElementById('pagination');
        if (pagination) pagination.style.display = 'none';
        return;
    }

    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredInvoices.length);
    const pageInvoices = filteredInvoices.slice(startIndex, endIndex);

    container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Invoice No</th>
                    <th>Inv Date</th>
                    <th>Company</th>
                    <th>Branch/Department</th>
                    <th>Amount</th>
                    <th>Age</th>
                    <th>Last Call</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody>
                ${pageInvoices
                    .map((invoice) => {
                        const lastCall =
                            invoice.lastContactDays === null
                                ? 'No call yet'
                                : `${invoice.lastContactDays}d ago (${formatDate(invoice.lastContactDate)})`;

                        return `
                            <tr class="${invoice.historyCount > 0 ? 'has-followup' : ''}" onclick="viewInvoiceDetail('${escapeHtml(invoice.invoiceKey)}')">
                                <td><strong>#${escapeHtml(invoice.invoiceNo)}</strong></td>
                                <td>${escapeHtml(formatDate(invoice.invoiceDate || invoice.dueDate))}</td>
                                <td>
                                    <div class="company-name">${escapeHtml(invoice.company)}</div>
                                </td>
                                <td><div class="branch-name">${escapeHtml(invoice.branch)}</div></td>
                                <td class="amount">${escapeHtml(formatCurrency(invoice.amount))}</td>
                                <td><span class="${escapeHtml(getAgeClass(invoice.age))}">${escapeHtml(String(invoice.age))}d</span></td>
                                <td>${escapeHtml(lastCall)}</td>
                                <td>
                                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(
                                        invoice.invoiceKey
                                    )}')">View</button>
                                </td>
                            </tr>
                        `;
                    })
                    .join('')}
            </tbody>
        </table>
    `;

    renderPagination();
}

function renderPagination() {
    const pagination = document.getElementById('pagination');
    if (!pagination) return;

    const totalRecords = filteredInvoices.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

    if (totalRecords <= pageSize) {
        pagination.style.display = 'none';
        return;
    }

    pagination.style.display = 'flex';

    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalRecords);

    document.getElementById('showing-start').textContent = String(start);
    document.getElementById('showing-end').textContent = String(end);
    document.getElementById('total-records').textContent = String(totalRecords);

    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

function prevPage() {
    if (currentPage <= 1) return;
    currentPage -= 1;
    renderTable();
}

function nextPage() {
    const totalPages = Math.ceil(filteredInvoices.length / pageSize);
    if (currentPage >= totalPages) return;
    currentPage += 1;
    renderTable();
}

function viewInvoiceDetail(invoiceKey) {
    const invoice = findInvoiceByKey(invoiceKey);
    if (!invoice) {
        alert('Invoice details not found in current report data.');
        return;
    }

    const detailModal = document.getElementById('detailModal');
    const detailInvoiceNo = document.getElementById('detailInvoiceNo');
    const detailContent = document.getElementById('detailContent');

    if (!detailModal || !detailInvoiceNo || !detailContent) return;

    currentDetailInvoice = invoice;
    detailInvoiceNo.textContent = invoice.invoiceNo;

    const history = getHistoryForInvoice(invoice.invoiceNo, invoice.invoiceId);
    const lastHistory = history.length > 0 ? history[0] : null;

    const lastRemarks = lastHistory ? lastHistory.remarks : 'No conversation logged yet.';
    const lastFollowup = lastHistory && lastHistory.followupDate ? formatDate(lastHistory.followupDate) : '-';
    const contactNumber = invoice.contactNumber || (lastHistory ? lastHistory.contactNumber : '') || '';
    const contactPerson = (lastHistory && hasMeaningfulContact(lastHistory.contactPerson) ? lastHistory.contactPerson : '').trim();
    const callHref = normalizePhone(contactNumber);
    const defaultFollowup = getTodayInputValue(1);

    detailContent.innerHTML = `
        <div class="detail-grid">
            <div class="detail-item"><label>Company</label><span>${escapeHtml(invoice.company)}</span></div>
            <div class="detail-item"><label>Branch/Department</label><span>${escapeHtml(invoice.branch)}</span></div>
            <div class="detail-item"><label>Invoice Date</label><span>${escapeHtml(formatDate(invoice.invoiceDate || invoice.dueDate))}</span></div>
            <div class="detail-item"><label>Due Date</label><span>${escapeHtml(formatDate(invoice.dueDate))}</span></div>
            <div class="detail-item"><label>Amount</label><span>${escapeHtml(formatCurrency(invoice.amount))}</span></div>
            <div class="detail-item"><label>Age</label><span>${escapeHtml(String(invoice.age))} days</span></div>
            <div class="detail-item"><label>Priority</label><span>${escapeHtml(invoice.priority.label)}</span></div>
            <div class="detail-item"><label>Next Follow-up</label><span>${escapeHtml(lastFollowup)}</span></div>
            <div class="detail-item"><label>Contact Number</label><span>${escapeHtml(contactNumber || 'No contact number')}</span></div>
            <div class="detail-item"><label>Quick Call</label><span>${callHref ? `<a href="tel:${escapeHtml(callHref)}">${escapeHtml(callHref)}</a>` : 'No dialable number'}</span></div>
        </div>

        <div class="detail-last-remark">
            <h4>Last Conversation Remark</h4>
            <p>${escapeHtml(lastRemarks)}</p>
        </div>

        <div class="detail-call-log">
            <h4>Call Update and Follow-up</h4>
            <div class="detail-form-grid">
                <div class="detail-form-group">
                    <label>Contact Number</label>
                    <input id="detailContactNumber" type="text" value="${escapeHtml(contactNumber)}" placeholder="09xx / landline">
                </div>
                <div class="detail-form-group">
                    <label>Contact Person</label>
                    <input id="detailContactPerson" type="text" value="${escapeHtml(contactPerson)}" placeholder="Person spoken to">
                </div>
                <div class="detail-form-group full">
                    <label>Conversation Remarks</label>
                    <textarea id="detailRemarksInput" placeholder="Write what happened in the call..."></textarea>
                </div>
                <div class="detail-form-group">
                    <label>Follow-up Date</label>
                    <input id="detailFollowupInput" type="date" value="${escapeHtml(defaultFollowup)}">
                </div>
                <div class="detail-form-group">
                    <label>Schedule Type</label>
                    <select id="detailScheduleType">
                        <option value="0">Regular Follow-up</option>
                        <option value="5">Promise Due</option>
                        <option value="6">For Pickup</option>
                    </select>
                </div>
            </div>
            <div class="detail-form-actions">
                <button class="btn btn-primary" onclick="saveCollectionConversation()">Save Call Log</button>
                <span class="detail-save-status" id="detailSaveStatus">After saving, this history updates immediately.</span>
            </div>
        </div>

        <div class="history-section">
            <h4>Follow-up History</h4>
            <div class="history-list">
                ${
                    history.length === 0
                        ? '<div class="no-history">No collection history found for this invoice.</div>'
                        : history
                              .map(
                                  (item) => `
                                <div class="history-item">
                                    <div class="history-date">Called: ${escapeHtml(formatDate(item.callDate))}</div>
                                    <div class="history-date">Contact: ${escapeHtml(item.contactPerson || '-')}</div>
                                    <div class="history-date">Phone: ${escapeHtml(item.contactNumber || '-')}</div>
                                    <div class="history-remarks">${escapeHtml(item.remarks)}</div>
                                    <div class="history-followup">Next Follow-up: ${escapeHtml(formatDate(item.followupDate))}</div>
                                </div>
                            `
                              )
                              .join('')
                }
            </div>
        </div>
    `;

    detailModal.classList.remove('hidden');
}

async function saveCollectionConversation() {
    if (!currentDetailInvoice) return;
    if (isSavingConversation) return;

    const contactNumberInput = document.getElementById('detailContactNumber');
    const contactPersonInput = document.getElementById('detailContactPerson');
    const remarksInput = document.getElementById('detailRemarksInput');
    const followupInput = document.getElementById('detailFollowupInput');
    const scheduleInput = document.getElementById('detailScheduleType');
    const statusNode = document.getElementById('detailSaveStatus');

    const contactNumber = String(contactNumberInput?.value || '').trim();
    const contactPerson = String(contactPersonInput?.value || '').trim();
    const remarks = String(remarksInput?.value || '').trim();
    const followupDate = String(followupInput?.value || '').trim();
    const scheduleStatus = Number(scheduleInput?.value || 0);

    if (!remarks) {
        if (statusNode) statusNode.textContent = 'Please enter conversation remarks before saving.';
        return;
    }

    if (!followupDate) {
        if (statusNode) statusNode.textContent = 'Please set a follow-up date.';
        return;
    }

    isSavingConversation = true;
    if (statusNode) statusNode.textContent = 'Saving call log...';

    try {
        await firestoreCreate('tbl_collectionhistory', {
            invoice_num: { stringValue: String(currentDetailInvoice.invoiceNo || currentDetailInvoice.invoiceId || '') },
            invoice_id: { stringValue: String(currentDetailInvoice.invoiceId || currentDetailInvoice.invoiceNo || '') },
            remarks: { stringValue: remarks },
            contact_person: { stringValue: contactPerson || '-' },
            contact_number: { stringValue: contactNumber || '' },
            followup_datetime: { stringValue: `${followupDate} 00:00:00` },
            timestamp: { stringValue: toTimestampString(new Date()) },
            schedule_status: { integerValue: String(scheduleStatus) }
        });

        await loadCollectionHistory();

        const refreshedHistory = getHistoryForInvoice(currentDetailInvoice.invoiceNo, currentDetailInvoice.invoiceId);
        const lastHistory = refreshedHistory.length > 0 ? refreshedHistory[0] : null;

        currentDetailInvoice.history = refreshedHistory;
        currentDetailInvoice.historyCount = refreshedHistory.length;
        currentDetailInvoice.lastRemarks = lastHistory ? lastHistory.remarks : null;
        currentDetailInvoice.lastContactDate = lastHistory ? lastHistory.callDate : null;
        currentDetailInvoice.lastContactDays = currentDetailInvoice.lastContactDate
            ? Math.max(0, daysBetween(currentDetailInvoice.lastContactDate, new Date()))
            : null;
        currentDetailInvoice.nextFollowup = lastHistory ? lastHistory.followupDate : null;
        currentDetailInvoice.contactNumber = contactNumber || currentDetailInvoice.contactNumber || '';

        recomputeFilteredInvoices();
        viewInvoiceDetail(currentDetailInvoice.invoiceKey);
        const refreshedStatusNode = document.getElementById('detailSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = 'Saved. Call history updated.';
    } catch (error) {
        console.error('Failed to save collection conversation:', error);
        if (statusNode) statusNode.textContent = 'Save failed. Please try again.';
    } finally {
        isSavingConversation = false;
    }
}

function exportToExcel() {
    if (filteredInvoices.length === 0) {
        alert('No records to export.');
        return;
    }

    const rows = [
        ['Invoice No', 'Invoice Date', 'Company', 'Branch/Department', 'Amount', 'Age (days)', 'Last Call', 'Last Remarks']
    ];

    filteredInvoices.forEach((invoice) => {
        const lastCall = invoice.lastContactDays === null ? 'No call yet' : `${invoice.lastContactDays}d ago`;
        rows.push([
            invoice.invoiceNo,
            formatDate(invoice.invoiceDate || invoice.dueDate),
            invoice.company,
            invoice.branch,
            Number(invoice.amount || 0).toFixed(2),
            String(invoice.age),
            lastCall,
            invoice.lastRemarks || ''
        ]);
    });

    const csv = rows
        .map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `collection-report-${toDateKey(new Date()) || 'export'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function setupModalEvents() {
    const followupModal = document.getElementById('followupModal');
    const detailModal = document.getElementById('detailModal');
    const collectorCellModal = document.getElementById('collectorCellModal');

    followupModal?.addEventListener('click', (event) => {
        if (event.target === followupModal) closeFollowupModal();
    });

    detailModal?.addEventListener('click', (event) => {
        if (event.target === detailModal) closeDetailModal();
    });

    collectorCellModal?.addEventListener('click', (event) => {
        if (event.target === collectorCellModal) closeCollectorCellModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeFollowupModal();
            closeDetailModal();
            closeCollectorCellModal();
            closeWelcomeModal();
        }
    });
}

function initQuickAgeButtons() {
    document.querySelectorAll('.quick-age-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const bucket = btn.dataset.bucket || 'all';
            setQuickAgeFilter(bucket);
        });
    });

    setQuickAgeFilter('all');
}

document.addEventListener('DOMContentLoaded', async () => {
    setupModalEvents();
    showRandomTip();
    initQuickAgeButtons();
    toggleAnalyticsDashboard(false);

    document.getElementById('collectorSearchInput')?.addEventListener('input', () => {
        if (lastLoadSucceeded) void renderCollectorDashboard();
    });
    document.getElementById('collectorSortInput')?.addEventListener('change', () => {
        if (lastLoadSucceeded) void renderCollectorDashboard();
    });

    document.getElementById('search-input')?.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') applyFilters();
    });

    ['filter-from-date', 'filter-to-date'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', () => {
            applyFilters();
        });
    });

    await loadActiveInvoices();
    if (lastLoadSucceeded) checkWelcomeModal();
});
