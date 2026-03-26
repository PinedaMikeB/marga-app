const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M';
const BASE_URL = process.env.FIRESTORE_BASE_URL || 'https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || '';

const CACHE_TTL_MS = Number(process.env.OPENCLAW_BILLING_COMPARE_CACHE_TTL_MS || 5 * 60 * 1000);
const DEFAULT_PAGE_SIZE = Number(process.env.OPENCLAW_BILLING_COMPARE_PAGE_SIZE || 300);
const DEFAULT_MAX_BILLING_PAGES = Number(process.env.OPENCLAW_BILLING_COMPARE_MAX_PAGES || 260);

const monthMap = {
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
    return null;
}

function getField(fields, keys) {
    for (const key of keys) {
        const value = getValue(fields[key]);
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
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
    if (monthMap[raw]) return monthMap[raw];

    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const month = Math.trunc(n);
    if (month < 1 || month > 12) return null;
    return month;
}

function monthName(month) {
    if (!month || month < 1 || month > 12) return null;
    return [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ][month - 1];
}

function monthKeyFromYearMonth(year, month) {
    if (!year || !month) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function parseMonthKey(key) {
    const m = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    return {
        year: Number(m[1]),
        month: Number(m[2])
    };
}

function monthKeyLabel(key) {
    const parsed = parseMonthKey(key);
    if (!parsed) return key;
    return `${monthName(parsed.month)} ${parsed.year}`;
}

function compareMonthKeys(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

function boolParam(value, defaultValue = false) {
    if (value === null || value === undefined || value === '') return defaultValue;
    const v = String(value).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

function prevMonth(year, month) {
    if (month > 1) return { year, month: month - 1 };
    return { year: year - 1, month: 12 };
}

function toIso(value) {
    const d = normalizeDate(value);
    return d ? d.toISOString() : null;
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
    if (!global.__openclawBillingCompareCache) {
        global.__openclawBillingCompareCache = {
            stamp: 0,
            billingPages: 0,
            companyMap: {},
            branchMap: {},
            contractMap: {},
            activeCompanies: new Map(),
            totalActiveCustomers: 0,
            activeContractsCount: 0,
            billingDocs: []
        };
    }
    return global.__openclawBillingCompareCache;
}

function buildActiveCompanyIndex(companyMap, branchMap, contractMap) {
    const activeCompanies = new Map();
    let activeContractsCount = 0;

    Object.values(contractMap).forEach((contract) => {
        if (Number(contract.status) !== 1) return;
        const branchId = String(contract.branchId || '').trim();
        if (!branchId) return;

        const branch = branchMap[branchId];
        if (!branch) return;
        const companyId = String(branch.companyId || '').trim();
        if (!companyId) return;

        let row = activeCompanies.get(companyId);
        if (!row) {
            row = {
                company_id: companyId,
                company_name: companyMap[companyId] || 'Unknown',
                branch_ids: new Set(),
                branch_names: new Set(),
                active_contract_ids: new Set()
            };
            activeCompanies.set(companyId, row);
        }

        row.branch_ids.add(branchId);
        row.branch_names.add(branch.name || 'Main');
        row.active_contract_ids.add(String(contract.id));
        activeContractsCount += 1;
    });

    return {
        activeCompanies,
        totalActiveCustomers: activeCompanies.size,
        activeContractsCount
    };
}

async function loadCache(forceRefresh = false, maxBillingPages = DEFAULT_MAX_BILLING_PAGES) {
    const cache = getCacheState();
    const now = Date.now();
    const pages = Math.max(10, Math.min(560, Number(maxBillingPages)));
    const samePageWindow = Number(cache.billingPages || 0) === pages;

    if (!forceRefresh && samePageWindow && cache.stamp && (now - cache.stamp) < CACHE_TTL_MS) {
        return cache;
    }

    const [companyDocs, branchDocs, contractDocs, billingDocs] = await Promise.all([
        firestoreGetAll('tbl_companylist', { fieldMask: ['id', 'companyname'], maxPages: 30 }),
        firestoreGetAll('tbl_branchinfo', { fieldMask: ['id', 'company_id', 'branchname'], maxPages: 40 }),
        firestoreGetAll('tbl_contractmain', { fieldMask: ['id', 'contract_id', 'status'], maxPages: 70 }),
        firestoreGetAll('tbl_billing', {
            fieldMask: ['id', 'invoice_id', 'invoiceid', 'invoiceno', 'invoice_no', 'contractmain_id', 'month', 'year', 'due_date', 'dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex'],
            maxPages: pages
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
        cache.branchMap[id] = {
            name: String(getField(f, ['branchname']) || 'Main').trim() || 'Main',
            companyId: String(getField(f, ['company_id']) || '').trim()
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

    const activeIndex = buildActiveCompanyIndex(cache.companyMap, cache.branchMap, cache.contractMap);
    cache.activeCompanies = activeIndex.activeCompanies;
    cache.totalActiveCustomers = activeIndex.totalActiveCustomers;
    cache.activeContractsCount = activeIndex.activeContractsCount;
    cache.billingDocs = billingDocs;
    cache.billingPages = pages;
    cache.stamp = now;
    return cache;
}

function extractBillingMonthKey(fields) {
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

function makeMonthAccumulator(key) {
    return {
        key,
        billedCompanyIds: new Set(),
        billedActiveCompanyIds: new Set(),
        billedCustomers: new Map(),
        billedInvoicesTotal: 0,
        billedActiveInvoicesTotal: 0,
        inactiveContractInvoicesTotal: 0,
        skippedActiveCustomers: [],
        latestBillingEntries: []
    };
}

function createCompanyRow(cache, companyId, monthStats, companyMonthSet, companyFirstMonth) {
    const company = cache.activeCompanies.get(companyId) || {
        company_id: companyId,
        company_name: cache.companyMap[companyId] || 'Unknown',
        branch_ids: new Set(),
        branch_names: new Set(),
        active_contract_ids: new Set()
    };

    const billedRow = monthStats.billedCustomers.get(companyId);

    return {
        company_id: company.company_id,
        company_name: company.company_name,
        billed_invoice_count: billedRow ? billedRow.billed_invoice_count : 0,
        active_branch_count: company.branch_ids.size,
        active_contract_count: company.active_contract_ids.size,
        branch_names: Array.from(company.branch_names).sort((a, b) => a.localeCompare(b)),
        first_billed_month: companyFirstMonth.get(companyId) || null,
        months_billed_count: (companyMonthSet.get(companyId) || new Set()).size
    };
}

function summarizeMonth(cache, monthStats) {
    return {
        active_customers_total: cache.totalActiveCustomers,
        active_contracts_total: cache.activeContractsCount,
        billed_customers_total: monthStats.billedCompanyIds.size,
        billed_active_customers_total: monthStats.billedActiveCompanyIds.size,
        skipped_active_customers_total: monthStats.skippedActiveCustomers.length,
        billed_invoices_total: monthStats.billedInvoicesTotal,
        billed_active_invoices_total: monthStats.billedActiveInvoicesTotal,
        inactive_contract_invoices_total: monthStats.inactiveContractInvoicesTotal,
        active_customer_coverage_pct: cache.totalActiveCustomers
            ? Number(((monthStats.billedActiveCompanyIds.size / cache.totalActiveCustomers) * 100).toFixed(2))
            : 0
    };
}

function listDiff(leftSet, rightSet) {
    const result = [];
    leftSet.forEach((value) => {
        if (!rightSet.has(value)) result.push(value);
    });
    return result;
}

function listIntersection(leftSet, rightSet) {
    const result = [];
    leftSet.forEach((value) => {
        if (rightSet.has(value)) result.push(value);
    });
    return result;
}

function compareNumbers(current, compare) {
    return Number((current - compare).toFixed(2));
}

function analyze(cache, currentKey, compareKey) {
    const currentStats = makeMonthAccumulator(currentKey);
    const compareStats = makeMonthAccumulator(compareKey);
    const months = {
        [currentKey]: currentStats,
        [compareKey]: compareStats
    };

    const companyMonthSet = new Map();
    const companyFirstMonth = new Map();

    let unmatchedContractmainInvoicesTotal = 0;

    for (const doc of cache.billingDocs) {
        const f = doc.fields || {};
        const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
        if (!contractmainId) {
            unmatchedContractmainInvoicesTotal += 1;
            continue;
        }

        const contract = cache.contractMap[contractmainId];
        if (!contract) {
            unmatchedContractmainInvoicesTotal += 1;
            continue;
        }

        const branch = cache.branchMap[String(contract.branchId || '').trim()];
        if (!branch) {
            unmatchedContractmainInvoicesTotal += 1;
            continue;
        }

        const companyId = String(branch.companyId || '').trim();
        if (!companyId) {
            unmatchedContractmainInvoicesTotal += 1;
            continue;
        }

        const { monthKey, invoiceDate } = extractBillingMonthKey(f);
        if (monthKey && Number(contract.status) === 1) {
            if (!companyMonthSet.has(companyId)) companyMonthSet.set(companyId, new Set());
            companyMonthSet.get(companyId).add(monthKey);

            const first = companyFirstMonth.get(companyId);
            if (!first || compareMonthKeys(monthKey, first) < 0) {
                companyFirstMonth.set(companyId, monthKey);
            }
        }

        const targetMonth = months[monthKey];
        if (!targetMonth) continue;

        const invoiceId = String(getField(f, ['invoice_id', 'invoiceid', 'invoiceno', 'invoice_no', 'id']) || '').trim();

        targetMonth.billedCompanyIds.add(companyId);
        targetMonth.billedInvoicesTotal += 1;

        if (Number(contract.status) === 1) {
            targetMonth.billedActiveCompanyIds.add(companyId);
            targetMonth.billedActiveInvoicesTotal += 1;

            let customer = targetMonth.billedCustomers.get(companyId);
            if (!customer) {
                customer = {
                    company_id: companyId,
                    company_name: cache.companyMap[companyId] || 'Unknown',
                    billed_invoice_count: 0
                };
                targetMonth.billedCustomers.set(companyId, customer);
            }
            customer.billed_invoice_count += 1;

            targetMonth.latestBillingEntries.push({
                invoice_id: invoiceId || null,
                invoice_date: toIso(invoiceDate),
                company_id: companyId,
                company_name: cache.companyMap[companyId] || 'Unknown',
                branch_name: branch.name || 'Main',
                contractmain_id: contractmainId
            });
        } else {
            targetMonth.inactiveContractInvoicesTotal += 1;
        }
    }

    cache.activeCompanies.forEach((company, companyId) => {
        [currentStats, compareStats].forEach((monthStats) => {
            if (monthStats.billedActiveCompanyIds.has(companyId)) return;
            const seenInAnyMonth = companyMonthSet.has(companyId) && companyMonthSet.get(companyId).size > 0;
            monthStats.skippedActiveCustomers.push({
                company_id: company.company_id,
                company_name: company.company_name,
                active_branch_count: company.branch_ids.size,
                active_contract_count: company.active_contract_ids.size,
                branch_names: Array.from(company.branch_names).sort((a, b) => a.localeCompare(b)),
                reason: seenInAnyMonth ? 'No billing record in selected month' : 'No billing record found'
            });
        });
    });

    currentStats.skippedActiveCustomers.sort((a, b) => a.company_name.localeCompare(b.company_name));
    compareStats.skippedActiveCustomers.sort((a, b) => a.company_name.localeCompare(b.company_name));

    currentStats.latestBillingEntries.sort((a, b) => {
        const at = a.invoice_date ? new Date(a.invoice_date).getTime() : 0;
        const bt = b.invoice_date ? new Date(b.invoice_date).getTime() : 0;
        return bt - at;
    });

    compareStats.latestBillingEntries.sort((a, b) => {
        const at = a.invoice_date ? new Date(a.invoice_date).getTime() : 0;
        const bt = b.invoice_date ? new Date(b.invoice_date).getTime() : 0;
        return bt - at;
    });

    const currentBilled = currentStats.billedActiveCompanyIds;
    const compareBilled = compareStats.billedActiveCompanyIds;

    const newlyBilledIds = listDiff(currentBilled, compareBilled);
    const droppedIds = listDiff(compareBilled, currentBilled);
    const billedBothIds = listIntersection(currentBilled, compareBilled);

    const currentSkipped = new Set(currentStats.skippedActiveCustomers.map((row) => row.company_id));
    const compareSkipped = new Set(compareStats.skippedActiveCustomers.map((row) => row.company_id));
    const newlySkippedIds = listDiff(currentSkipped, compareSkipped);
    const recoveredIds = listDiff(compareSkipped, currentSkipped);

    const firstTimeIds = newlyBilledIds.filter((companyId) => companyFirstMonth.get(companyId) === currentKey);
    const reactivatedIds = newlyBilledIds.filter((companyId) => {
        const first = companyFirstMonth.get(companyId);
        return Boolean(first) && first !== currentKey;
    });

    const currentSummary = summarizeMonth(cache, currentStats);
    const compareSummary = summarizeMonth(cache, compareStats);

    const currentRows = Array.from(currentStats.billedCustomers.values())
        .map((row) => ({
            ...row,
            first_billed_month: companyFirstMonth.get(row.company_id) || null,
            months_billed_count: (companyMonthSet.get(row.company_id) || new Set()).size
        }))
        .sort((a, b) => a.company_name.localeCompare(b.company_name));

    const compareRows = Array.from(compareStats.billedCustomers.values())
        .map((row) => ({
            ...row,
            first_billed_month: companyFirstMonth.get(row.company_id) || null,
            months_billed_count: (companyMonthSet.get(row.company_id) || new Set()).size
        }))
        .sort((a, b) => a.company_name.localeCompare(b.company_name));

    const newlyBilledRows = newlyBilledIds
        .map((companyId) => createCompanyRow(cache, companyId, currentStats, companyMonthSet, companyFirstMonth))
        .sort((a, b) => a.company_name.localeCompare(b.company_name));

    const droppedRows = droppedIds
        .map((companyId) => createCompanyRow(cache, companyId, compareStats, companyMonthSet, companyFirstMonth))
        .sort((a, b) => a.company_name.localeCompare(b.company_name));

    const billedBothRows = billedBothIds
        .map((companyId) => ({
            company_id: companyId,
            company_name: cache.companyMap[companyId] || 'Unknown',
            current_billed_invoice_count: (currentStats.billedCustomers.get(companyId)?.billed_invoice_count || 0),
            compare_billed_invoice_count: (compareStats.billedCustomers.get(companyId)?.billed_invoice_count || 0),
            first_billed_month: companyFirstMonth.get(companyId) || null,
            months_billed_count: (companyMonthSet.get(companyId) || new Set()).size
        }))
        .sort((a, b) => a.company_name.localeCompare(b.company_name));

    const firstTimeRows = firstTimeIds
        .map((companyId) => createCompanyRow(cache, companyId, currentStats, companyMonthSet, companyFirstMonth))
        .sort((a, b) => a.company_name.localeCompare(b.company_name));

    const reactivatedRows = reactivatedIds
        .map((companyId) => createCompanyRow(cache, companyId, currentStats, companyMonthSet, companyFirstMonth))
        .sort((a, b) => a.company_name.localeCompare(b.company_name));

    const newlySkippedRows = newlySkippedIds
        .map((companyId) => {
            const row = currentStats.skippedActiveCustomers.find((item) => item.company_id === companyId);
            return row || createCompanyRow(cache, companyId, currentStats, companyMonthSet, companyFirstMonth);
        })
        .sort((a, b) => a.company_name.localeCompare(b.company_name));

    const recoveredRows = recoveredIds
        .map((companyId) => createCompanyRow(cache, companyId, currentStats, companyMonthSet, companyFirstMonth))
        .sort((a, b) => a.company_name.localeCompare(b.company_name));

    return {
        currentSummary,
        compareSummary,
        unmatchedContractmainInvoicesTotal,
        currentRows,
        compareRows,
        currentSkippedRows: currentStats.skippedActiveCustomers,
        compareSkippedRows: compareStats.skippedActiveCustomers,
        currentLatestEntries: currentStats.latestBillingEntries,
        compareLatestEntries: compareStats.latestBillingEntries,
        comparison: {
            billed_both_rows: billedBothRows,
            newly_billed_rows: newlyBilledRows,
            dropped_rows: droppedRows,
            newly_skipped_rows: newlySkippedRows,
            recovered_rows: recoveredRows
        },
        additions: {
            first_time_rows: firstTimeRows,
            reactivated_rows: reactivatedRows
        }
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
            if (!provided || provided !== OPENCLAW_API_KEY) {
                return toJson(401, { ok: false, error: 'Unauthorized' });
            }
        }

        const searchParams = new URLSearchParams(event.queryStringParameters || {});
        const forceRefresh = boolParam(searchParams.get('refresh_cache'), false);
        const includeLists = boolParam(searchParams.get('include_lists'), true);
        const includeLatestEntries = boolParam(searchParams.get('include_latest_entries'), true);
        const listLimit = Math.max(1, Math.min(5000, Number(searchParams.get('list_limit') || 500)));
        const latestLimit = Math.max(1, Math.min(5000, Number(searchParams.get('latest_limit') || 200)));
        const maxBillingPages = Math.max(10, Math.min(560, Number(searchParams.get('max_billing_pages') || DEFAULT_MAX_BILLING_PAGES)));

        const now = new Date();
        const currentYear = normalizeYear(searchParams.get('year')) || now.getFullYear();
        const currentMonth = normalizeMonth(searchParams.get('month')) || (now.getMonth() + 1);
        const defaultCompare = prevMonth(currentYear, currentMonth);
        const compareYear = normalizeYear(searchParams.get('compare_year')) || defaultCompare.year;
        const compareMonth = normalizeMonth(searchParams.get('compare_month')) || defaultCompare.month;

        const currentKey = monthKeyFromYearMonth(currentYear, currentMonth);
        const compareKey = monthKeyFromYearMonth(compareYear, compareMonth);
        if (!currentKey || !compareKey) {
            return toJson(400, { ok: false, error: 'Invalid month parameters' });
        }

        const cache = await loadCache(forceRefresh, maxBillingPages);
        const result = analyze(cache, currentKey, compareKey);

        return toJson(200, {
            ok: true,
            meta: {
                analyzed_at: new Date().toISOString(),
                cache_ttl_ms: CACHE_TTL_MS,
                lookup_cached_at: cache.stamp ? new Date(cache.stamp).toISOString() : null,
                billing_docs_scanned: cache.billingDocs.length,
                unmatched_contractmain_invoices_total: result.unmatchedContractmainInvoicesTotal
            },
            months: {
                current: {
                    key: currentKey,
                    label: monthKeyLabel(currentKey),
                    year: currentYear,
                    month: currentMonth,
                    month_name: monthName(currentMonth),
                    summary: result.currentSummary,
                    billed_customers: includeLists ? result.currentRows.slice(0, listLimit) : [],
                    skipped_active_customers: includeLists ? result.currentSkippedRows.slice(0, listLimit) : [],
                    latest_billing_entries: includeLatestEntries ? result.currentLatestEntries.slice(0, latestLimit) : []
                },
                compare: {
                    key: compareKey,
                    label: monthKeyLabel(compareKey),
                    year: compareYear,
                    month: compareMonth,
                    month_name: monthName(compareMonth),
                    summary: result.compareSummary,
                    billed_customers: includeLists ? result.compareRows.slice(0, listLimit) : [],
                    skipped_active_customers: includeLists ? result.compareSkippedRows.slice(0, listLimit) : [],
                    latest_billing_entries: includeLatestEntries ? result.compareLatestEntries.slice(0, latestLimit) : []
                }
            },
            comparison: {
                billed_both_total: result.comparison.billed_both_rows.length,
                newly_billed_total: result.comparison.newly_billed_rows.length,
                dropped_total: result.comparison.dropped_rows.length,
                newly_skipped_total: result.comparison.newly_skipped_rows.length,
                recovered_total: result.comparison.recovered_rows.length,
                billed_active_customers_delta: compareNumbers(result.currentSummary.billed_active_customers_total, result.compareSummary.billed_active_customers_total),
                skipped_active_customers_delta: compareNumbers(result.currentSummary.skipped_active_customers_total, result.compareSummary.skipped_active_customers_total),
                active_customer_coverage_pct_delta: compareNumbers(result.currentSummary.active_customer_coverage_pct, result.compareSummary.active_customer_coverage_pct),
                billed_both_customers: includeLists ? result.comparison.billed_both_rows.slice(0, listLimit) : [],
                newly_billed_customers: includeLists ? result.comparison.newly_billed_rows.slice(0, listLimit) : [],
                dropped_customers: includeLists ? result.comparison.dropped_rows.slice(0, listLimit) : [],
                newly_skipped_customers: includeLists ? result.comparison.newly_skipped_rows.slice(0, listLimit) : [],
                recovered_customers: includeLists ? result.comparison.recovered_rows.slice(0, listLimit) : []
            },
            latest_additions: {
                first_time_billed_total: result.additions.first_time_rows.length,
                reactivated_total: result.additions.reactivated_rows.length,
                first_time_billed_customers: includeLists ? result.additions.first_time_rows.slice(0, listLimit) : [],
                reactivated_customers: includeLists ? result.additions.reactivated_rows.slice(0, listLimit) : []
            }
        });
    } catch (error) {
        return toJson(500, {
            ok: false,
            error: error.message || 'Unexpected error'
        });
    }
};
