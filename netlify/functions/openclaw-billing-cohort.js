const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M';
const BASE_URL = process.env.FIRESTORE_BASE_URL || 'https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || '';

const CACHE_TTL_MS = Number(process.env.OPENCLAW_BILLING_COHORT_CACHE_TTL_MS || 5 * 60 * 1000);
const DEFAULT_PAGE_SIZE = Number(process.env.OPENCLAW_BILLING_COHORT_PAGE_SIZE || 300);
const DEFAULT_BILLING_MAX_PAGES = Number(process.env.OPENCLAW_BILLING_COHORT_BILLING_MAX_PAGES || 260);
const DEFAULT_SCHEDULE_MAX_PAGES = Number(process.env.OPENCLAW_BILLING_COHORT_SCHEDULE_MAX_PAGES || 240);
const BILLING_PURPOSE_ID = 1;
const READING_PURPOSE_ID = 8;
const DEFAULT_MONTHS_BACK = 6;

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

function toJson(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key'
        },
        body: JSON.stringify(body)
    };
}

function getValue(field) {
    if (!field || typeof field !== 'object') return null;
    if (field.integerValue !== undefined) return Number(field.integerValue);
    if (field.doubleValue !== undefined) return Number(field.doubleValue);
    if (field.booleanValue !== undefined) return Boolean(field.booleanValue);
    if (field.timestampValue !== undefined) return field.timestampValue;
    if (field.stringValue !== undefined) return field.stringValue;
    if (field.nullValue !== undefined) return null;
    return null;
}

function getField(fields, keys) {
    for (const key of keys) {
        const value = getValue(fields[key]);
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
}

function boolParam(value, defaultValue = false) {
    if (value === null || value === undefined || value === '') return defaultValue;
    const v = String(value).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

function intParam(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const whole = Math.trunc(n);
    return Math.max(min, Math.min(max, whole));
}

function normalizeDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

    const raw = String(value).trim();
    if (!raw) return null;

    const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) {
        const d = new Date(`${iso[1]}T00:00:00+08:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slash) {
        const mm = String(slash[1]).padStart(2, '0');
        const dd = String(slash[2]).padStart(2, '0');
        const d = new Date(`${slash[3]}-${mm}-${dd}T00:00:00+08:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeYear(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).trim());
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
}

function normalizeMonth(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;

    const lookup = {
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
    if (lookup[raw]) return lookup[raw];

    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const month = Math.trunc(n);
    if (month < 1 || month > 12) return null;
    return month;
}

function monthKeyFromYearMonth(year, month) {
    if (!year || !month) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function monthLabelFromKey(key) {
    const match = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return String(key || '');
    return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
}

function shortMonthLabelFromKey(key) {
    const match = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return String(key || '');
    return `${MONTH_NAMES[Number(match[2]) - 1].slice(0, 3)} ${match[1].slice(2)}`;
}

function shiftMonthKey(key, offset) {
    const match = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + Number(offset || 0), 1));
    return monthKeyFromYearMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

function buildMonthRange(startKey, endKey) {
    const out = [];
    let current = startKey;
    while (current && current <= endKey) {
        out.push(current);
        if (current === endKey) break;
        current = shiftMonthKey(current, 1);
    }
    return out;
}

function toIso(value) {
    const d = normalizeDate(value);
    return d ? d.toISOString() : null;
}

function parseAmount(value) {
    if (value === null || value === undefined || value === '') return 0;
    const cleaned = String(value).replace(/,/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
}

function extractBillingAmount(fields) {
    const totalAmount = parseAmount(getField(fields, ['totalamount']));
    if (totalAmount > 0) return totalAmount;
    const amount = parseAmount(getField(fields, ['amount']));
    if (amount > 0) return amount;
    return parseAmount(getField(fields, ['vatamount']));
}

async function firestoreGet(collection, pageSize = DEFAULT_PAGE_SIZE, pageToken = null, fieldMask = null) {
    const params = new URLSearchParams();
    params.set('pageSize', String(pageSize));
    params.set('key', FIREBASE_API_KEY);
    if (pageToken) params.set('pageToken', pageToken);

    if (Array.isArray(fieldMask)) {
        fieldMask.forEach((path) => {
            if (path) params.append('mask.fieldPaths', path);
        });
    }

    const response = await fetch(`${BASE_URL}/${collection}?${params.toString()}`);
    if (!response.ok) throw new Error(`Failed to fetch ${collection}: ${response.status}`);
    return response.json();
}

async function firestoreGetAll(collection, options = {}) {
    const {
        fieldMask = null,
        pageSize = DEFAULT_PAGE_SIZE,
        maxPages = 120
    } = options;

    let pageToken = null;
    let page = 0;
    const docs = [];

    while (page < maxPages) {
        page += 1;
        const data = await firestoreGet(collection, pageSize, pageToken, fieldMask);
        if (Array.isArray(data.documents) && data.documents.length > 0) docs.push(...data.documents);
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
    }

    return docs;
}

function getCacheState() {
    if (!global.__openclawBillingCohortCache) {
        global.__openclawBillingCohortCache = {
            stamp: 0,
            billingPages: 0,
            schedulePages: 0,
            companyMap: {},
            branchMap: {},
            contractMap: {},
            billingDocs: [],
            scheduleDocs: []
        };
    }
    return global.__openclawBillingCohortCache;
}

async function loadCache(forceRefresh = false, billingPages = DEFAULT_BILLING_MAX_PAGES, schedulePages = DEFAULT_SCHEDULE_MAX_PAGES) {
    const cache = getCacheState();
    const now = Date.now();
    const nextBillingPages = Math.max(10, Math.min(600, Number(billingPages)));
    const nextSchedulePages = Math.max(10, Math.min(600, Number(schedulePages)));

    const sameWindow = Number(cache.billingPages || 0) === nextBillingPages
        && Number(cache.schedulePages || 0) === nextSchedulePages;

    if (!forceRefresh && sameWindow && cache.stamp && (now - cache.stamp) < CACHE_TTL_MS) {
        return cache;
    }

    const [companyDocs, branchDocs, contractDocs, billingDocs, scheduleDocs] = await Promise.all([
        firestoreGetAll('tbl_companylist', { fieldMask: ['id', 'companyname'], maxPages: 30 }),
        firestoreGetAll('tbl_branchinfo', { fieldMask: ['id', 'company_id', 'branchname', 'earliest', 'intrvl', 'inactive'], maxPages: 50 }),
        firestoreGetAll('tbl_contractmain', { fieldMask: ['id', 'contract_id', 'status'], maxPages: 80 }),
        firestoreGetAll('tbl_billing', {
            fieldMask: ['id', 'invoice_id', 'invoiceid', 'invoiceno', 'invoice_no', 'contractmain_id', 'month', 'year', 'due_date', 'dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'amount', 'totalamount', 'vatamount'],
            maxPages: nextBillingPages
        }),
        firestoreGetAll('tbl_schedule', {
            fieldMask: ['id', 'company_id', 'branch_id', 'purpose_id', 'task_datetime', 'field_billing_received_by', 'field_billing_date', 'field_billing_time'],
            maxPages: nextSchedulePages
        })
    ]);

    cache.companyMap = {};
    companyDocs.forEach((doc) => {
        const id = String(getField(doc.fields || {}, ['id']) || '').trim();
        if (!id) return;
        cache.companyMap[id] = String(getField(doc.fields || {}, ['companyname']) || 'Unknown').trim() || 'Unknown';
    });

    cache.branchMap = {};
    branchDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;
        const earliestRaw = getField(f, ['earliest']);
        const earliest = earliestRaw === null || earliestRaw === undefined || earliestRaw === '' ? null : Number(earliestRaw);
        cache.branchMap[id] = {
            id,
            name: String(getField(f, ['branchname']) || 'Main').trim() || 'Main',
            companyId: String(getField(f, ['company_id']) || '').trim(),
            earliest: Number.isFinite(earliest) ? earliest : null,
            intrvl: Number(getField(f, ['intrvl']) || 0) || 0,
            inactive: Number(getField(f, ['inactive']) || 0) || 0
        };
    });

    cache.contractMap = {};
    contractDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;
        cache.contractMap[id] = {
            id,
            branchId: String(getField(f, ['contract_id']) || '').trim(),
            status: Number(getField(f, ['status']) || 0)
        };
    });

    cache.billingDocs = billingDocs;
    cache.scheduleDocs = scheduleDocs;
    cache.billingPages = nextBillingPages;
    cache.schedulePages = nextSchedulePages;
    cache.stamp = now;
    return cache;
}

function extractBillingMonth(fields) {
    const invoiceDate = normalizeDate(getField(fields, ['dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'due_date']));
    let year = normalizeYear(getField(fields, ['year']));
    let month = normalizeMonth(getField(fields, ['month']));

    if ((!year || !month) && invoiceDate) {
        year = invoiceDate.getFullYear();
        month = invoiceDate.getMonth() + 1;
    }

    return {
        monthKey: monthKeyFromYearMonth(year, month),
        invoiceDate
    };
}

function extractScheduleMonthKey(fields) {
    const taskDate = normalizeDate(getField(fields, ['task_datetime']));
    const billingDate = normalizeDate(getField(fields, ['field_billing_date']));
    const dateRef = taskDate || billingDate;
    if (!dateRef) return null;
    return monthKeyFromYearMonth(dateRef.getFullYear(), dateRef.getMonth() + 1);
}

function extractDayOfMonth(value) {
    const date = normalizeDate(value);
    if (!date) return null;
    const day = date.getDate();
    return day >= 1 && day <= 31 ? day : null;
}

function addNestedCount(targetMap, outerKey, innerKey, amount = 1) {
    if (!outerKey || !innerKey) return;
    let inner = targetMap.get(outerKey);
    if (!inner) {
        inner = new Map();
        targetMap.set(outerKey, inner);
    }
    inner.set(innerKey, (inner.get(innerKey) || 0) + amount);
}

function sortedUnique(values) {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function chooseModeDay(dayMap) {
    if (!dayMap || !dayMap.size) return null;
    return Array.from(dayMap.entries())
        .filter(([day]) => Number(day) >= 1 && Number(day) <= 31)
        .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return Number(a[0]) - Number(b[0]);
        })[0]?.[0] || null;
}

function createMonthCell(monthKey) {
    return {
        month_key: monthKey,
        month_label: monthLabelFromKey(monthKey),
        month_label_short: shortMonthLabelFromKey(monthKey),
        billed: false,
        pending: false,
        skipped: false,
        invoice_count: 0,
        amount_total: 0,
        billed_branch_ids: new Set(),
        billing_task_count: 0,
        received_task_count: 0,
        received_branch_ids: new Set(),
        received_by_names: new Set(),
        latest_invoice_date: null,
        receipt_status: 'not_billed'
    };
}

function ensureCompanyRow(companyRows, companyId, companyName, months) {
    let row = companyRows.get(companyId);
    if (!row) {
        const monthMap = {};
        months.forEach((monthKey) => {
            monthMap[monthKey] = createMonthCell(monthKey);
        });
        row = {
            company_id: companyId,
            company_name: companyName || 'Unknown',
            months: monthMap,
            billed_months_count: 0,
            pending_months_count: 0,
            confirmed_received_months_count: 0,
            unconfirmed_billed_months_count: 0,
            latest_billed_month: null,
            reading_day: null,
            reading_day_source: null
        };
        companyRows.set(companyId, row);
    }
    return row;
}

function finalizeReceiptStatus(cell) {
    if (!cell.billed) {
        cell.receipt_status = 'not_billed';
        return;
    }
    if (cell.received_task_count <= 0) {
        cell.receipt_status = 'not_confirmed';
        return;
    }
    if (cell.billed_branch_ids.size > 0 && cell.received_branch_ids.size >= cell.billed_branch_ids.size) {
        cell.receipt_status = 'received';
        return;
    }
    cell.receipt_status = 'partial';
}

function setDiff(left, right) {
    const out = new Set();
    left.forEach((value) => {
        if (!right.has(value)) out.add(value);
    });
    return out;
}

function setIntersect(left, right) {
    const out = new Set();
    left.forEach((value) => {
        if (right.has(value)) out.add(value);
    });
    return out;
}

function setUnion(left, right) {
    return new Set([...left, ...right]);
}

function hasFutureBilling(companyMonthsMap, companyId, monthKey) {
    const months = companyMonthsMap.get(companyId);
    if (!months || !months.size) return false;
    for (const billedMonth of months) {
        if (billedMonth > monthKey) return true;
    }
    return false;
}

function resolveReadingDay(companyId, readingSignals, billingSignals, branchFallbackSignals) {
    const readingDay = chooseModeDay(readingSignals.get(companyId));
    if (readingDay) return { day: Number(readingDay), source: 'reading_schedule' };

    const billingDay = chooseModeDay(billingSignals.get(companyId));
    if (billingDay) return { day: Number(billingDay), source: 'billing_schedule' };

    const branchDay = chooseModeDay(branchFallbackSignals.get(companyId));
    if (branchDay) return { day: Number(branchDay), source: 'branch_earliest' };

    return { day: null, source: null };
}

function analyzeDashboard(cache, startKey, endKey, latestListLimit) {
    const months = buildMonthRange(startKey, endKey);
    const companyRows = new Map();
    const billedByMonth = new Map(months.map((monthKey) => [monthKey, new Set()]));
    const billedMonthsByCompany = new Map();
    const readingSignals = new Map();
    const billingSignals = new Map();
    const branchFallbackSignals = new Map();
    const activeNowSet = new Set();

    Object.values(cache.branchMap).forEach((branch) => {
        const companyId = String(branch.companyId || '').trim();
        if (!companyId) return;
        const earliest = Number(branch.earliest);
        const normalizedDay = Number.isFinite(earliest) ? Math.abs(Math.trunc(earliest)) : 0;
        if (normalizedDay >= 1 && normalizedDay <= 31) addNestedCount(branchFallbackSignals, companyId, normalizedDay, 1);
    });

    Object.values(cache.contractMap).forEach((contract) => {
        if (Number(contract.status || 0) !== 1) return;
        const branch = cache.branchMap[String(contract.branchId || '').trim()];
        if (!branch || Number(branch.inactive || 0) === 1) return;
        const companyId = String(branch.companyId || '').trim();
        if (companyId) activeNowSet.add(companyId);
    });

    cache.billingDocs.forEach((doc) => {
        const f = doc.fields || {};
        const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
        if (!contractmainId) return;
        const contract = cache.contractMap[contractmainId];
        if (!contract) return;
        const branch = cache.branchMap[String(contract.branchId || '').trim()];
        if (!branch) return;
        const companyId = String(branch.companyId || '').trim();
        if (!companyId) return;

        const { monthKey, invoiceDate } = extractBillingMonth(f);
        if (!monthKey || monthKey < startKey || monthKey > endKey) return;

        const row = ensureCompanyRow(companyRows, companyId, cache.companyMap[companyId], months);
        const cell = row.months[monthKey];
        cell.billed = true;
        cell.invoice_count += 1;
        cell.amount_total += extractBillingAmount(f);
        cell.billed_branch_ids.add(branch.id);
        if (!cell.latest_invoice_date || (invoiceDate && invoiceDate > new Date(cell.latest_invoice_date))) {
            cell.latest_invoice_date = toIso(invoiceDate);
        }
        row.latest_billed_month = !row.latest_billed_month || monthKey > row.latest_billed_month ? monthKey : row.latest_billed_month;

        billedByMonth.get(monthKey)?.add(companyId);
        if (!billedMonthsByCompany.has(companyId)) billedMonthsByCompany.set(companyId, new Set());
        billedMonthsByCompany.get(companyId).add(monthKey);
    });

    cache.scheduleDocs.forEach((doc) => {
        const f = doc.fields || {};
        const monthKey = extractScheduleMonthKey(f);
        if (!monthKey || monthKey < startKey || monthKey > endKey) return;

        let companyId = String(getField(f, ['company_id']) || '').trim();
        const branchId = String(getField(f, ['branch_id']) || '').trim();
        if (!companyId && branchId) companyId = String(cache.branchMap[branchId]?.companyId || '').trim();
        if (!companyId) return;

        const purposeId = Number(getField(f, ['purpose_id']) || 0);
        const taskDay = extractDayOfMonth(getField(f, ['task_datetime']));
        if (purposeId === READING_PURPOSE_ID && taskDay) addNestedCount(readingSignals, companyId, taskDay, 1);
        if (purposeId === BILLING_PURPOSE_ID && taskDay) addNestedCount(billingSignals, companyId, taskDay, 1);

        if (purposeId !== BILLING_PURPOSE_ID) return;

        const row = ensureCompanyRow(companyRows, companyId, cache.companyMap[companyId], months);
        const cell = row.months[monthKey];
        cell.billing_task_count += 1;
        const receiver = String(getField(f, ['field_billing_received_by']) || '').trim();
        if (receiver) {
            cell.received_task_count += 1;
            cell.received_by_names.add(receiver);
            if (branchId) cell.received_branch_ids.add(branchId);
        }
    });

    const summaryByMonth = new Map(months.map((monthKey) => [monthKey, {
        month_key: monthKey,
        month_label: monthLabelFromKey(monthKey),
        month_label_short: shortMonthLabelFromKey(monthKey),
        cohort_customers_total: 0,
        billed_customers_total: 0,
        skipped_customers_total: 0,
        received_customers_total: 0,
        partial_received_customers_total: 0,
        not_confirmed_customers_total: 0,
        billed_invoice_count_total: 0,
        billed_amount_total: 0,
        balance_customers_total: 0,
        additional_customers_total: 0,
        inactive_customers_total: 0,
        to_bill_customers_total: 0,
        pending_customers_total: 0,
        skipped_companies: [],
        receipt_gap_companies: []
    }]));

    const matrixCompanyIds = new Set();
    const topSummaryRows = [];
    let currentTargetSet = new Set(billedByMonth.get(months[0]) || []);

    months.forEach((monthKey, index) => {
        const billedSet = new Set(billedByMonth.get(monthKey) || []);
        const additionalSet = index === 0 ? new Set() : setDiff(billedSet, currentTargetSet);
        const inactiveSet = index === 0
            ? new Set()
            : new Set(
                [...currentTargetSet].filter((companyId) => (
                    !billedSet.has(companyId)
                    && !activeNowSet.has(companyId)
                    && !hasFutureBilling(billedMonthsByCompany, companyId, monthKey)
                ))
            );
        const toBillSet = index === 0
            ? new Set(currentTargetSet)
            : setDiff(setUnion(currentTargetSet, additionalSet), inactiveSet);
        const billedTargetSet = setIntersect(toBillSet, billedSet);
        const pendingSet = setDiff(toBillSet, billedSet);

        toBillSet.forEach((companyId) => matrixCompanyIds.add(companyId));
        additionalSet.forEach((companyId) => matrixCompanyIds.add(companyId));

        const summary = summaryByMonth.get(monthKey);
        summary.balance_customers_total = currentTargetSet.size;
        summary.additional_customers_total = additionalSet.size;
        summary.inactive_customers_total = inactiveSet.size;
        summary.to_bill_customers_total = toBillSet.size;
        summary.billed_customers_total = billedTargetSet.size;
        summary.pending_customers_total = pendingSet.size;
        summary.skipped_customers_total = pendingSet.size;
        summary.cohort_customers_total = toBillSet.size;

        topSummaryRows.push({
            month_key: monthKey,
            month_label: monthLabelFromKey(monthKey),
            month_label_short: shortMonthLabelFromKey(monthKey),
            additional_customers_total: additionalSet.size,
            inactive_customers_total: inactiveSet.size,
            balance_customers_total: currentTargetSet.size,
            to_bill_customers_total: toBillSet.size,
            billed_customers_total: billedTargetSet.size,
            pending_customers_total: pendingSet.size
        });

        currentTargetSet = toBillSet;
    });

    const matrixRows = [];
    const skippedRows = [];
    const receiptGapRows = [];

    matrixCompanyIds.forEach((companyId) => {
        const row = ensureCompanyRow(companyRows, companyId, cache.companyMap[companyId], months);
        const rd = resolveReadingDay(companyId, readingSignals, billingSignals, branchFallbackSignals);
        row.reading_day = rd.day;
        row.reading_day_source = rd.source;
        row.billed_months_count = 0;
        row.pending_months_count = 0;
        row.confirmed_received_months_count = 0;
        row.unconfirmed_billed_months_count = 0;

        const pendingLabels = [];
        const receiptStatuses = [];
        const serializedMonths = {};

        months.forEach((monthKey) => {
            const cell = row.months[monthKey];
            const summary = summaryByMonth.get(monthKey);
            const monthHeader = topSummaryRows.find((entry) => entry.month_key === monthKey);
            const isTarget = monthHeader ? (
                (monthHeader.balance_customers_total > 0 || monthHeader.additional_customers_total > 0)
                && (matrixCompanyIds.has(companyId))
                && (cell.billed || row.latest_billed_month >= monthKey || row.billed_months_count > 0)
            ) : false;

            if (!cell.billed) {
                const monthIndex = months.indexOf(monthKey);
                const wasSeenBefore = months.slice(0, monthIndex).some((priorKey) => row.months[priorKey].billed || row.months[priorKey].pending);
                const isPending = wasSeenBefore && (activeNowSet.has(companyId) || hasFutureBilling(billedMonthsByCompany, companyId, monthKey));
                cell.pending = isPending;
                cell.skipped = isPending;
            }

            finalizeReceiptStatus(cell);

            if (cell.billed) row.billed_months_count += 1;
            if (cell.pending) {
                row.pending_months_count += 1;
                pendingLabels.push(monthLabelFromKey(monthKey));
                summary.skipped_companies.push({ company_id: companyId, company_name: row.company_name });
            }
            if (cell.receipt_status === 'received') row.confirmed_received_months_count += 1;
            if (cell.receipt_status === 'partial' || cell.receipt_status === 'not_confirmed') {
                row.unconfirmed_billed_months_count += 1;
                receiptStatuses.push({
                    month_key: monthKey,
                    month_label: monthLabelFromKey(monthKey),
                    receipt_status: cell.receipt_status,
                    invoice_count: cell.invoice_count,
                    amount_total: Number(cell.amount_total.toFixed(2))
                });
                if (cell.billed) summary.receipt_gap_companies.push({ company_id: companyId, company_name: row.company_name, receipt_status: cell.receipt_status });
            }

            if (cell.billed) {
                summary.billed_invoice_count_total += cell.invoice_count;
                summary.billed_amount_total += cell.amount_total;
                if (cell.receipt_status === 'received') summary.received_customers_total += 1;
                if (cell.receipt_status === 'partial') summary.partial_received_customers_total += 1;
                if (cell.receipt_status === 'not_confirmed') summary.not_confirmed_customers_total += 1;
            }

            serializedMonths[monthKey] = {
                month_key: monthKey,
                month_label: cell.month_label,
                month_label_short: cell.month_label_short,
                billed: cell.billed,
                pending: cell.pending,
                skipped: cell.skipped,
                invoice_count: cell.invoice_count,
                amount_total: Number(cell.amount_total.toFixed(2)),
                billing_task_count: cell.billing_task_count,
                received_task_count: cell.received_task_count,
                receipt_status: cell.receipt_status,
                latest_invoice_date: cell.latest_invoice_date,
                received_by_names: sortedUnique(Array.from(cell.received_by_names))
            };
        });

        if (pendingLabels.length) {
            skippedRows.push({
                company_id: companyId,
                company_name: row.company_name,
                skipped_months: pendingLabels
            });
        }

        if (receiptStatuses.length) {
            receiptGapRows.push({
                company_id: companyId,
                company_name: row.company_name,
                month_statuses: receiptStatuses
            });
        }

        matrixRows.push({
            company_id: companyId,
            company_name: row.company_name,
            reading_day: row.reading_day,
            reading_day_source: row.reading_day_source,
            billed_months_count: row.billed_months_count,
            pending_months_count: row.pending_months_count,
            confirmed_received_months_count: row.confirmed_received_months_count,
            unconfirmed_billed_months_count: row.unconfirmed_billed_months_count,
            latest_billed_month: row.latest_billed_month,
            months: serializedMonths
        });
    });

    matrixRows.sort((a, b) => {
        const latestMonth = months[months.length - 1];
        const leftPending = a.months[latestMonth]?.pending ? 1 : 0;
        const rightPending = b.months[latestMonth]?.pending ? 1 : 0;
        if (rightPending !== leftPending) return rightPending - leftPending;
        if (b.pending_months_count !== a.pending_months_count) return b.pending_months_count - a.pending_months_count;
        const leftRd = Number(a.reading_day || 99);
        const rightRd = Number(b.reading_day || 99);
        if (leftRd !== rightRd) return leftRd - rightRd;
        return a.company_name.localeCompare(b.company_name);
    });

    const monthTotals = months.map((monthKey) => ({
        month_key: monthKey,
        month_label: monthLabelFromKey(monthKey),
        month_label_short: shortMonthLabelFromKey(monthKey),
        amount_total: Number(matrixRows.reduce((sum, row) => sum + Number(row.months?.[monthKey]?.amount_total || 0), 0).toFixed(2))
    }));

    const latestBilledRows = matrixRows
        .flatMap((row) => months.map((monthKey) => ({
            company_id: row.company_id,
            company_name: row.company_name,
            month_key: monthKey,
            month_label: monthLabelFromKey(monthKey),
            latest_invoice_date: row.months[monthKey].latest_invoice_date,
            invoice_count: row.months[monthKey].invoice_count,
            amount_total: row.months[monthKey].amount_total,
            receipt_status: row.months[monthKey].receipt_status
        })))
        .filter((row) => row.latest_invoice_date)
        .sort((a, b) => new Date(b.latest_invoice_date).getTime() - new Date(a.latest_invoice_date).getTime())
        .slice(0, latestListLimit)
        .map((row) => ({ ...row, amount_total: Number(Number(row.amount_total || 0).toFixed(2)) }));

    const comparisons = months.slice(1).map((monthKey, index) => {
        const previousKey = months[index];
        const left = summaryByMonth.get(previousKey);
        const right = summaryByMonth.get(monthKey);
        return {
            from_month_key: previousKey,
            from_month_label: monthLabelFromKey(previousKey),
            to_month_key: monthKey,
            to_month_label: monthLabelFromKey(monthKey),
            billed_customers_delta: right.billed_customers_total - left.billed_customers_total,
            skipped_customers_delta: right.skipped_customers_total - left.skipped_customers_total,
            pending_customers_delta: right.pending_customers_total - left.pending_customers_total,
            billed_amount_delta: Number((right.billed_amount_total - left.billed_amount_total).toFixed(2))
        };
    });

    return {
        months,
        topSummaryRows,
        monthSummaries: months.map((monthKey) => {
            const summary = summaryByMonth.get(monthKey);
            return {
                ...summary,
                billed_amount_total: Number(summary.billed_amount_total.toFixed(2))
            };
        }),
        comparisons,
        matrixRows,
        monthTotals,
        skippedRows,
        receiptGapRows,
        latestBilledRows
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return toJson(200, { ok: true });
    if (event.httpMethod !== 'GET') return toJson(405, { ok: false, error: 'Method not allowed' });

    try {
        if (OPENCLAW_API_KEY) {
            const headerKey = event.headers['x-api-key'] || event.headers['X-API-Key'] || '';
            const authHeader = event.headers.authorization || event.headers.Authorization || '';
            const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
            const query = new URLSearchParams(event.queryStringParameters || {});
            const queryKey = query.get('api_key') || '';
            const provided = headerKey || bearer || queryKey;
            if (!provided || provided !== OPENCLAW_API_KEY) return toJson(401, { ok: false, error: 'Unauthorized' });
        }

        const searchParams = new URLSearchParams(event.queryStringParameters || {});
        const now = new Date();
        const endYear = normalizeYear(searchParams.get('end_year')) || now.getFullYear();
        const endMonth = normalizeMonth(searchParams.get('end_month')) || (now.getMonth() + 1);
        const explicitStartYear = normalizeYear(searchParams.get('start_year'));
        const explicitStartMonth = normalizeMonth(searchParams.get('start_month'));
        const monthsBack = intParam(searchParams.get('months_back') || searchParams.get('months') || DEFAULT_MONTHS_BACK, DEFAULT_MONTHS_BACK, 2, 12);
        const endKey = monthKeyFromYearMonth(endYear, endMonth);
        const startKey = explicitStartYear && explicitStartMonth
            ? monthKeyFromYearMonth(explicitStartYear, explicitStartMonth)
            : shiftMonthKey(endKey, -(monthsBack - 1));
        const includeRows = boolParam(searchParams.get('include_rows'), true);
        const rowLimit = intParam(searchParams.get('row_limit') || 1000, 1000, 1, 5000);
        const latestLimit = intParam(searchParams.get('latest_limit') || 200, 200, 1, 5000);
        const forceRefresh = boolParam(searchParams.get('refresh_cache'), false);
        const billingPages = intParam(searchParams.get('max_billing_pages') || DEFAULT_BILLING_MAX_PAGES, DEFAULT_BILLING_MAX_PAGES, 10, 600);
        const schedulePages = intParam(searchParams.get('max_schedule_pages') || DEFAULT_SCHEDULE_MAX_PAGES, DEFAULT_SCHEDULE_MAX_PAGES, 10, 600);

        if (!startKey || !endKey || startKey > endKey) {
            return toJson(400, { ok: false, error: 'Invalid start/end month range' });
        }

        const cache = await loadCache(forceRefresh, billingPages, schedulePages);
        const result = analyzeDashboard(cache, startKey, endKey, latestLimit);

        return toJson(200, {
            ok: true,
            meta: {
                analyzed_at: new Date().toISOString(),
                cache_ttl_ms: CACHE_TTL_MS,
                cached_at: cache.stamp ? new Date(cache.stamp).toISOString() : null,
                receipt_status_source: 'Billing task confirmation from tbl_schedule purpose_id=1 using field_billing_received_by',
                reading_day_source: 'Primary: tbl_schedule purpose_id=8 day-of-month; fallback: billing schedule day; fallback: tbl_branchinfo.earliest',
                billing_docs_scanned: cache.billingDocs.length,
                schedule_docs_scanned: cache.scheduleDocs.length
            },
            period: {
                start_month_key: startKey,
                start_month_label: monthLabelFromKey(startKey),
                end_month_key: endKey,
                end_month_label: monthLabelFromKey(endKey),
                month_keys: result.months,
                month_labels_short: result.months.map(shortMonthLabelFromKey),
                months_back: result.months.length
            },
            summary: {
                active_cohort_customers_total: result.topSummaryRows[0]?.to_bill_customers_total || 0,
                skipped_customers_total: result.skippedRows.length,
                receipt_gap_customers_total: result.receiptGapRows.length,
                matrix_customers_total: result.matrixRows.length,
                current_to_bill_total: result.topSummaryRows[result.topSummaryRows.length - 1]?.to_bill_customers_total || 0,
                current_billed_total: result.topSummaryRows[result.topSummaryRows.length - 1]?.billed_customers_total || 0,
                current_pending_total: result.topSummaryRows[result.topSummaryRows.length - 1]?.pending_customers_total || 0
            },
            billing_last_6_months: result.topSummaryRows,
            month_summaries: result.monthSummaries,
            month_to_month_comparison: result.comparisons,
            month_matrix: {
                months: result.months,
                month_labels_short: result.months.map(shortMonthLabelFromKey),
                totals: result.monthTotals,
                rows: includeRows ? result.matrixRows.slice(0, rowLimit) : []
            },
            skipped_customers: includeRows ? result.skippedRows.slice(0, rowLimit) : [],
            receipt_gap_customers: includeRows ? result.receiptGapRows.slice(0, rowLimit) : [],
            latest_billed_entries: result.latestBilledRows,
            cohort_customers: includeRows ? result.matrixRows.slice(0, rowLimit) : []
        });
    } catch (error) {
        return toJson(500, {
            ok: false,
            error: error.message || 'Unexpected error'
        });
    }
};
