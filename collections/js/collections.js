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
            machineId: rowMeta.machineId,
            contractmainId: rowMeta.contractmainId,
            serialNumber: rowMeta.serialNumber,
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
            machineId: payload.machineId || cell.machineId,
            contractmainId: payload.contractmainId || cell.contractmainId,
            serialNumber: payload.serialNumber || cell.serialNumber,
            machineLabel: payload.machineLabel || cell.machineLabel,
            invoiceDate: payload.invoiceDate || null,
            dueDate: payload.dueDate || null,
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
        current.serialNumber = current.serialNumber || payload.serialNumber || cell.serialNumber;
        current.machineLabel = current.machineLabel || payload.machineLabel || cell.machineLabel;
        current.rd = current.rd ?? payload.rd ?? null;
        if (!current.invoiceDate && payload.invoiceDate) current.invoiceDate = payload.invoiceDate;
        if (!current.dueDate && payload.dueDate) current.dueDate = payload.dueDate;
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
            remarks: getField(f, ['remarks']) || 'No remarks',
            contactPerson: getField(f, ['contact_person']) || '-',
            contactNumber: getField(f, ['contact_number']) || '',
            scheduleStatus: getField(f, ['schedule_status']),
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
            fieldMask: ['id', 'company_id', 'branchname'],
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
            name: getField(f, ['branchname']) || 'Main',
            companyId: String(getField(f, ['company_id']) || '').trim()
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
        fieldMask: ['invoice_id', 'payment_amt', 'date_deposit', 'date_paid', 'tax_date_paid', 'ornum', 'or_number'],
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
        const paymentDate = normalizeDate(getField(f, ['date_deposit', 'date_paid', 'tax_date_paid']));
        if (amount > 0 && paymentDate) {
            paymentEntries.push({
                invoiceId: invoiceId !== null && invoiceId !== undefined ? String(invoiceId).trim() : '',
                amount,
                paymentDate,
                orNumber: String(getField(f, ['ornum', 'or_number']) || '').trim()
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

    return {
        companyName,
        branchName,
        accountLabel: buildAccountLabel(companyName, branchName),
        categoryCode: getCategoryCode(contract.categoryId),
        machineId: String(contract.machId || '').trim(),
        contractmainId: String(contractmainId || '').trim(),
        serialNumber: resolveSerialLabel({ ...contract, id: contractmainId }),
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
        age,
        priority: getPriority(age),
        company: location.companyName,
        branch: location.branchName,
        accountLabel: location.accountLabel,
        machineId: location.machineId,
        contractmainId: location.contractmainId,
        serialNumber: location.serialNumber,
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
            const invoiceDate = normalizeDate(getField(f, ['dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'due_date']));
            const dueDate = normalizeDate(getField(f, ['due_date']));
            const amount = Number(getField(f, ['totalamount', 'amount']) || 0) + Number(getField(f, ['vatamount']) || 0);
            const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
            const location = getBillingLocation(contractmainId);
            const billingMeta = {
                company: location.companyName,
                branch: location.branchName,
                accountLabel: location.accountLabel,
                invoiceDate,
                dueDate,
                month: getField(f, ['month']),
                year: getField(f, ['year'])
            };

            if (invoiceId) billingMetaByInvoiceKey.set(invoiceId, billingMeta);
            if (invoiceNo) billingMetaByInvoiceKey.set(invoiceNo, billingMeta);

            if (invoiceDate && amount > 0) {
                collectorBillingRecords.push({
                    invoiceId,
                    invoiceNo: invoiceNo || invoiceId,
                    invoiceKey: invoiceNo || invoiceId,
                    company: location.companyName,
                    branch: location.branchName,
                    accountLabel: location.accountLabel,
                    machineId: location.machineId,
                    contractmainId: location.contractmainId,
                    serialNumber: location.serialNumber,
                    machineLabel: location.machineLabel,
                    invoiceDate,
                    dueDate,
                    amount,
                    rd: invoiceDate.getDate(),
                    monthKey: getMonthKey(invoiceDate)
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

        currentPage = 1;
        recomputeFilteredInvoices();

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
    void renderCollectorDashboard();
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
                firstPaymentDate: null,
                lastPaymentDate: null,
                months: new Map()
            });
        }

        const summary = paymentMap.get(invoiceKey);
        const paymentDate = normalizeDate(entry.paymentDate);
        summary.amount += Number(entry.amount || 0);

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
    const pendingCountsByMonth = {};
    collectorCellMap = new Map();

    monthColumns.forEach((column) => {
        monthTotals[column.key] = 0;
        pendingCountsByMonth[column.key] = 0;
    });

    collectorBillingRecords.forEach((record) => {
        const rowId = buildCollectorRowKey(record.machineId, record.contractmainId);
        if (!rowId) return;

        const paymentSummary =
            paymentMap.get(String(record.invoiceId || '').trim()) ||
            paymentMap.get(String(record.invoiceNo || '').trim()) || {
                amount: 0,
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
                serialNumber: normalizeSerialNumber(record.serialNumber),
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
        accountRow.rdCounts.set(record.rd, (accountRow.rdCounts.get(record.rd) || 0) + 1);

        if (invoiceDateInBalanceWindow) {
            if (!accountSetByMonth.has(record.monthKey)) {
                accountSetByMonth.set(record.monthKey, new Set());
            }
            accountSetByMonth.get(record.monthKey).add(rowId);
        }

        if (invoiceMonthVisible) {
            const invoiceCell = ensureCollectorDisplayCell(collectorCellMap, accountRow, monthMetaMap.get(record.monthKey));
            invoiceCell.rdValues.push(record.rd);
            invoiceCell.billedTotal += Number(record.amount || 0);
            invoiceCell.displayBilledTotal = Math.max(Number(invoiceCell.displayBilledTotal || 0), Number(invoiceCell.billedTotal || 0));
            upsertCollectorCellRecord(invoiceCell, record.invoiceKey, {
                ...record,
                amount: Number(record.amount || 0),
                billedAmount: Number(record.amount || 0),
                collectedAmount: 0,
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

        paymentMonthsInWindow.forEach((monthKey) => {
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
                serialNumber: normalizeSerialNumber(billingRow.serial_number),
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
                serialNumber: normalizeSerialNumber(row.serialNumber),
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
                                    cellText = escapeHtml(formatPlainNumber(cell.collectedTotal));
                                } else if (cell.collectedTotal > 0 && billedTarget > 0 && cell.collectedTotal >= billedTarget) {
                                    cellClass = 'month-cell collected';
                                    cellText = escapeHtml(formatPlainNumber(cell.collectedTotal));
                                } else if (showBillingAmount) {
                                    cellClass = `month-cell pending${catchUpBilling ? ' catch-up' : ''}`;
                                    cellText = `
                                        <span class="collector-amount">${escapeHtml(formatPlainNumber(billedTarget))}</span>
                                        ${catchUpBilling ? `<span class="collector-state-label catch-up">Catch-up Billing${cell.catchUpGapMonths > 1 ? ` (${escapeHtml(String(cell.catchUpGapMonths))})` : ''}</span>` : ''}
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
                    <td class="sticky-col customer total-cell text-left">Total</td>
                    <td class="sticky-col branch total-cell"></td>
                    ${data.monthColumns
                        .map((column) => `<td class="total-cell text-right">${escapeHtml(formatPlainNumber(data.monthTotals[column.key] || 0))}</td>`)
                        .join('')}
                    <td class="total-cell text-right">${escapeHtml(formatPlainNumber(data.customerRows.reduce((sum, row) => sum + row.totalCollected, 0)))}</td>
                </tr>
            </tfoot>
        </table>
    `;

    bindCollectorMatrixViewport();
    scheduleCollectorLatestScroll(data);
}

async function renderCollectorDashboard() {
    const data = await computeCollectorDashboardData();
    collectorDashboardData = data;
    const visibleRows = prepareCollectorRows(data.customerRows);
    renderCollectorSummaryTable(data);
    renderCollectorMatrixTable(data, visibleRows);

    const noteNode = document.getElementById('collector-dashboard-note');
    if (noteNode) {
        const searchTerm = getCollectorSearchTerm();
        const filterText = searchTerm
            ? `Showing ${visibleRows.length.toLocaleString()} of ${data.customerRows.length.toLocaleString()} account row(s) for "${searchTerm}".`
            : `${data.customerRows.length.toLocaleString()} account row(s) across ${data.monthColumns.length.toLocaleString()} month(s).`;
        noteNode.textContent = `${filterText} Cells can show branch billed amounts from Billing even when collection is still zero. Footer totals remain collected totals. Click cells to review unpaid invoices, missed readings, and continue collection remarks.`;
    }

    const rangeNode = document.getElementById('collector-dashboard-range');
    if (rangeNode) {
        rangeNode.textContent = `${formatMonthLabel(data.windowStart, true)} to ${formatMonthLabel(data.matrixEnd, true)}`;
    }

    const pendingNode = document.getElementById('collector-dashboard-pending');
    if (pendingNode) {
        pendingNode.textContent = `Pending cells: ${data.pendingCellCount.toLocaleString()}`;
    }
}

function openCollectorCell(cellId) {
    const cell = collectorCellMap.get(String(cellId || '').trim());
    if (!cell) return;

    const modal = document.getElementById('collectorCellModal');
    const title = document.getElementById('collectorCellTitle');
    const subtitle = document.getElementById('collectorCellSubtitle');
    const content = document.getElementById('collectorCellContent');
    if (!modal || !title || !subtitle || !content) return;

    title.textContent = `${cell.customer} • ${cell.branchName || cell.accountLabel || 'Main'} • ${cell.label}`;
    const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
    const pendingAmount = Math.max(0, billedTarget - cell.collectedTotal);
    if (cell.missedReading) {
        subtitle.textContent = `No billed amount exists yet for ${cell.serialNumber || cell.machineLabel || 'this account'} in this month. This looks like a missed reading or missed billing month, so the collector can follow up with billing staff.`;
    } else if (cell.collectedTotal > 0) {
        subtitle.textContent = `Invoice worklist for ${cell.serialNumber || cell.machineLabel || 'this account'}. Use Open Call Log to continue the collector notes.`;
    } else if (billedTarget > 0) {
        subtitle.textContent = `No payment posted yet for ${cell.serialNumber || cell.machineLabel || 'this account'}. Billed amount follows the billing breakdown for this branch or department.`;
    } else {
        subtitle.textContent = `No payment posted yet for ${cell.serialNumber || cell.machineLabel || 'this account'}. Review invoices and continue the collection follow-up.`;
    }

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
            ${cell.readingPagesTotal > 0 ? `<span class="collector-chip">Reading Pages: ${escapeHtml(formatPlainNumber(cell.readingPagesTotal))}</span>` : ''}
            ${cell.readingTaskCount > 0 ? `<span class="collector-chip">Meter Forms: ${escapeHtml(formatPlainNumber(cell.readingTaskCount))}</span>` : ''}
        </div>
        <div class="cell-invoice-list">
            ${cell.records.length
                ? cell.records
                .sort((a, b) => {
                    const aTime = a.invoiceDate ? a.invoiceDate.getTime() : 0;
                    const bTime = b.invoiceDate ? b.invoiceDate.getTime() : 0;
                    return aTime - bTime;
                })
                .map((record) => {
                    const history = getHistoryForInvoice(record.invoiceNo, record.invoiceId);
                    const lastHistory = history.length ? history[0] : null;
                    const lastRemarks = lastHistory ? lastHistory.remarks : 'No past collection remark yet.';
                    const followup = lastHistory && lastHistory.followupDate ? formatDate(lastHistory.followupDate) : '-';
                    const receiptLabel = record.paymentOrNumbers?.length ? record.paymentOrNumbers.join(', ') : 'None';
                    const paymentPostedLabel = record.lastPaymentDate ? formatDate(record.lastPaymentDate) : 'None';

                    return `
                        <article class="cell-invoice-item">
                            <div class="cell-invoice-head">
                                <div>
                                    <div class="cell-invoice-title">Invoice #${escapeHtml(record.invoiceNo || record.invoiceId || '-')}</div>
                                    <div class="cell-invoice-meta">${escapeHtml(record.branch || 'Main')} • Received/Billed ${escapeHtml(formatDate(record.invoiceDate))}</div>
                                </div>
                                <div class="comparison-total-chip">${escapeHtml(formatCurrency(record.amount))}</div>
                            </div>
                            <div class="cell-invoice-grid">
                                <div class="cell-modal-card">
                                    <div class="label">Expected Collection</div>
                                    <div class="value">${escapeHtml(formatDate(record.expectedCollectionDate || record.dueDate))}</div>
                                </div>
                                <div class="cell-modal-card">
                                    <div class="label">Payment Posted</div>
                                    <div class="value">${record.collectedAmount > 0 ? escapeHtml(formatCurrency(record.collectedAmount)) : 'None'}</div>
                                </div>
                                <div class="cell-modal-card">
                                    <div class="label">Payment Date</div>
                                    <div class="value">${escapeHtml(paymentPostedLabel)}</div>
                                </div>
                                <div class="cell-modal-card">
                                    <div class="label">Official Receipt</div>
                                    <div class="value">${escapeHtml(receiptLabel)}</div>
                                </div>
                                <div class="cell-modal-card">
                                    <div class="label">Last Follow-up</div>
                                    <div class="value">${escapeHtml(followup)}</div>
                                </div>
                            </div>
                            <div class="cell-invoice-note">${escapeHtml(lastRemarks)}</div>
                            <div class="cell-invoice-actions">
                                <button class="btn btn-primary btn-sm" onclick="openCollectorInvoiceFromCell('${encodeURIComponent(record.invoiceKey)}')">Open Call Log</button>
                            </div>
                        </article>
                    `;
                })
                .join('')
                : `<article class="cell-invoice-item">
                        <div class="cell-invoice-head">
                            <div>
                                <div class="cell-invoice-title">${cell.missedReading ? 'No invoice created yet' : 'No invoice record linked yet'}</div>
                                <div class="cell-invoice-meta">${escapeHtml(cell.branchName || cell.accountLabel || 'Main')} • ${escapeHtml(cell.label)}</div>
                            </div>
                            <div class="comparison-total-chip">${escapeHtml(formatCurrency(billedTarget))}</div>
                        </div>
                        <div class="cell-invoice-note">${escapeHtml(
                            cell.missedReading
                                ? 'This month looks missed in billing. The collector can use this as a reminder to ask billing staff to complete the missing reading or billing.'
                                : 'This branch has a billing breakdown amount from the billing dashboard, but no invoice record is linked in Collections yet.'
                        )}</div>
                    </article>`}
        </div>
    `;

    modal.classList.remove('hidden');
}

function openCollectorCellByToken(token) {
    openCollectorCell(decodeURIComponent(String(token || '')));
}

function closeCollectorCellModal() {
    document.getElementById('collectorCellModal')?.classList.add('hidden');
}

function openCollectorInvoiceFromCell(invoiceKey) {
    closeCollectorCellModal();
    viewInvoiceDetail(decodeURIComponent(String(invoiceKey || '')));
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
