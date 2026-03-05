const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M';
const BASE_URL = process.env.FIRESTORE_BASE_URL || 'https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || '';

const CACHE_TTL_MS = Number(process.env.OPENCLAW_BILLING_CACHE_TTL_MS || 5 * 60 * 1000);
const DEFAULT_PAGE_SIZE = Number(process.env.OPENCLAW_BILLING_PAGE_SIZE || 300);
const DEFAULT_MAX_BILLING_PAGES = Number(process.env.OPENCLAW_BILLING_MAX_PAGES || 260);

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

function boolParam(value, defaultValue = false) {
    if (value === null || value === undefined || value === '') return defaultValue;
    const v = String(value).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

function toDateKey(value) {
    const d = normalizeDate(value);
    if (!d) return null;
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}

function parseDateParam(value) {
    if (!value) return null;
    return normalizeDate(String(value).trim());
}

function inRange(date, fromDate, toDate) {
    if (!date) return false;
    if (fromDate && date < fromDate) return false;
    if (toDate) {
        const inclusiveTo = new Date(toDate.getTime());
        inclusiveTo.setHours(23, 59, 59, 999);
        if (date > inclusiveTo) return false;
    }
    return true;
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
        if (Array.isArray(data.documents) && data.documents.length > 0) {
            docs.push(...data.documents);
        }
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
    }

    return docs;
}

function getCacheState() {
    if (!global.__openclawBillingCache) {
        global.__openclawBillingCache = {
            stamp: 0,
            companyMap: {},
            branchMap: {},
            contractMap: {},
            activeCompanies: new Map(),
            activeContractsCount: 0,
            totalActiveCustomers: 0,
            billing: {}
        };
    }
    return global.__openclawBillingCache;
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
        activeContractsCount,
        totalActiveCustomers: activeCompanies.size
    };
}

async function loadLookupCache(forceRefresh = false) {
    const cache = getCacheState();
    const now = Date.now();

    if (!forceRefresh && cache.stamp && (now - cache.stamp) < CACHE_TTL_MS) {
        return cache;
    }

    const [companyDocs, branchDocs, contractDocs] = await Promise.all([
        firestoreGetAll('tbl_companylist', { fieldMask: ['id', 'companyname'], maxPages: 30 }),
        firestoreGetAll('tbl_branchinfo', { fieldMask: ['id', 'company_id', 'branchname'], maxPages: 40 }),
        firestoreGetAll('tbl_contractmain', { fieldMask: ['id', 'contract_id', 'status'], maxPages: 70 })
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
    cache.activeContractsCount = activeIndex.activeContractsCount;
    cache.totalActiveCustomers = activeIndex.totalActiveCustomers;
    cache.billing = {};
    cache.stamp = now;
    return cache;
}

function buildPeriodKey({ year, month, fromDate, toDate, maxPages }) {
    if (fromDate || toDate) {
        return `range:${toDateKey(fromDate) || 'null'}:${toDateKey(toDate) || 'null'}:${maxPages}`;
    }
    return `month:${year}:${month || 'all'}:${maxPages}`;
}

function billingMatchesPeriod(fields, period) {
    const { year, month, fromDate, toDate } = period;
    const invoiceDate = normalizeDate(getField(fields, ['dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'due_date']));
    const dueDate = normalizeDate(getField(fields, ['due_date']));
    const dateRef = invoiceDate || dueDate;

    if (fromDate || toDate) {
        return inRange(dateRef, fromDate, toDate);
    }

    let docYear = normalizeYear(getField(fields, ['year']));
    let docMonth = normalizeMonth(getField(fields, ['month']));

    if ((!docYear || !docMonth) && dateRef) {
        docYear = dateRef.getFullYear();
        docMonth = dateRef.getMonth() + 1;
    }

    if (!docYear) return false;
    if (year && docYear !== year) return false;
    if (month && docMonth !== month) return false;
    return true;
}

async function analyzeBillingPeriod(cache, period, maxBillingPages) {
    const periodKey = buildPeriodKey({
        year: period.year,
        month: period.month,
        fromDate: period.fromDate,
        toDate: period.toDate,
        maxPages: maxBillingPages
    });

    const now = Date.now();
    const cached = cache.billing[periodKey];
    if (cached && (now - cached.stamp) < CACHE_TTL_MS) {
        return cached.result;
    }

    const billingDocs = await firestoreGetAll('tbl_billing', {
        fieldMask: ['id', 'invoice_id', 'invoiceid', 'invoiceno', 'invoice_no', 'contractmain_id', 'month', 'year', 'due_date', 'dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex'],
        maxPages: maxBillingPages
    });

    const billedCompanyIds = new Set();
    const billedActiveCompanyIds = new Set();
    const activeCompaniesWithAnyBilling = new Set();
    const billedCustomers = new Map();

    let billedInvoicesCount = 0;
    let billedActiveInvoicesCount = 0;
    let unmatchedContractmainCount = 0;
    let inactiveContractInvoicesCount = 0;

    for (const doc of billingDocs) {
        const f = doc.fields || {};
        const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
        if (!contractmainId) {
            unmatchedContractmainCount += 1;
            continue;
        }

        const contract = cache.contractMap[contractmainId];
        if (!contract) {
            unmatchedContractmainCount += 1;
            continue;
        }

        const branch = cache.branchMap[String(contract.branchId || '').trim()];
        if (!branch) {
            unmatchedContractmainCount += 1;
            continue;
        }

        const companyId = String(branch.companyId || '').trim();
        if (!companyId) {
            unmatchedContractmainCount += 1;
            continue;
        }

        billedCompanyIds.add(companyId);
        if (Number(contract.status) === 1) {
            activeCompaniesWithAnyBilling.add(companyId);
        }

        if (!billingMatchesPeriod(f, period)) continue;

        billedInvoicesCount += 1;
        if (Number(contract.status) !== 1) {
            inactiveContractInvoicesCount += 1;
            continue;
        }

        billedActiveInvoicesCount += 1;
        billedActiveCompanyIds.add(companyId);

        let customer = billedCustomers.get(companyId);
        if (!customer) {
            customer = {
                company_id: companyId,
                company_name: cache.companyMap[companyId] || 'Unknown',
                billed_invoice_count: 0
            };
            billedCustomers.set(companyId, customer);
        }
        customer.billed_invoice_count += 1;
    }

    const skipped = [];
    cache.activeCompanies.forEach((company, companyId) => {
        if (billedActiveCompanyIds.has(companyId)) return;
        skipped.push({
            company_id: company.company_id,
            company_name: company.company_name,
            active_branch_count: company.branch_ids.size,
            active_contract_count: company.active_contract_ids.size,
            branch_names: Array.from(company.branch_names).sort((a, b) => a.localeCompare(b)),
            reason: activeCompaniesWithAnyBilling.has(companyId)
                ? 'No billing record in selected period'
                : 'No billing record found'
        });
    });

    skipped.sort((a, b) => a.company_name.localeCompare(b.company_name));
    const billedCustomerRows = Array.from(billedCustomers.values()).sort((a, b) => a.company_name.localeCompare(b.company_name));

    const result = {
        analyzed_at: new Date().toISOString(),
        billing_docs_scanned: billingDocs.length,
        summary: {
            active_customers_total: cache.totalActiveCustomers,
            active_contracts_total: cache.activeContractsCount,
            billed_customers_total: billedCompanyIds.size,
            billed_active_customers_total: billedActiveCompanyIds.size,
            skipped_active_customers_total: skipped.length,
            billed_invoices_total: billedInvoicesCount,
            billed_active_invoices_total: billedActiveInvoicesCount,
            inactive_contract_invoices_total: inactiveContractInvoicesCount,
            unmatched_contractmain_invoices_total: unmatchedContractmainCount,
            active_customer_coverage_pct: cache.totalActiveCustomers
                ? Number(((billedActiveCompanyIds.size / cache.totalActiveCustomers) * 100).toFixed(2))
                : 0
        },
        skipped_active_customers: skipped,
        billed_customers: billedCustomerRows
    };

    cache.billing[periodKey] = {
        stamp: now,
        result
    };

    return result;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return toJson(200, { ok: true });
    }

    if (event.httpMethod !== 'GET') {
        return toJson(405, { ok: false, error: 'Method not allowed' });
    }

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
        const includeBilledCustomers = boolParam(searchParams.get('include_billed_customers'), false);
        const skippedLimit = Math.max(1, Math.min(5000, Number(searchParams.get('skipped_limit') || 500)));
        const maxBillingPages = Math.max(10, Math.min(520, Number(searchParams.get('max_billing_pages') || DEFAULT_MAX_BILLING_PAGES)));

        const now = new Date();
        const queryYear = normalizeYear(searchParams.get('year'));
        const queryMonth = normalizeMonth(searchParams.get('month'));
        const fromDate = parseDateParam(searchParams.get('from'));
        const toDate = parseDateParam(searchParams.get('to'));

        const period = (fromDate || toDate)
            ? {
                fromDate,
                toDate,
                year: null,
                month: null
            }
            : {
                fromDate: null,
                toDate: null,
                year: queryYear || now.getFullYear(),
                month: queryMonth || (now.getMonth() + 1)
            };

        const cache = await loadLookupCache(forceRefresh);
        const analysis = await analyzeBillingPeriod(cache, period, maxBillingPages);

        const skippedRows = analysis.skipped_active_customers.slice(0, skippedLimit);

        return toJson(200, {
            ok: true,
            meta: {
                cache_ttl_ms: CACHE_TTL_MS,
                lookup_cached_at: cache.stamp ? new Date(cache.stamp).toISOString() : null,
                skipped_returned: skippedRows.length,
                skipped_total: analysis.skipped_active_customers.length
            },
            period: {
                mode: (period.fromDate || period.toDate) ? 'date_range' : 'month',
                year: period.year || null,
                month: period.month || null,
                month_name: period.month ? monthName(period.month) : null,
                from: toDateKey(period.fromDate),
                to: toDateKey(period.toDate)
            },
            summary: analysis.summary,
            skipped_active_customers: skippedRows,
            billed_customers: includeBilledCustomers ? analysis.billed_customers : []
        });
    } catch (error) {
        return toJson(500, {
            ok: false,
            error: error.message || 'Unexpected error'
        });
    }
};
