const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M';
const BASE_URL = process.env.FIRESTORE_BASE_URL || 'https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || '';

const CACHE_TTL_MS = Number(process.env.OPENCLAW_CUSTOMERS_CACHE_TTL_MS || 5 * 60 * 1000);
const DEFAULT_PAGE_SIZE = Number(process.env.OPENCLAW_CUSTOMERS_PAGE_SIZE || 300);
const DEFAULT_BILLING_MAX_PAGES = Number(process.env.OPENCLAW_CUSTOMERS_BILLING_MAX_PAGES || 320);

const CONTRACT_STATUS_META = {
    0: { label: 'pending', terminal: false },
    1: { label: 'active', terminal: false },
    2: { label: 'terminated', terminal: true },
    3: { label: 'on_hold', terminal: false },
    4: { label: 'pulled_out', terminal: true },
    7: { label: 'ended', terminal: true },
    8: { label: 'replaced', terminal: false },
    9: { label: 'transferred', terminal: false },
    10: { label: 'for_pullout', terminal: false },
    13: { label: 'cancelled', terminal: true }
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

function formatDateIso(value) {
    const d = normalizeDate(value);
    return d ? d.toISOString() : null;
}

function daysBetweenNow(value) {
    const d = normalizeDate(value);
    if (!d) return null;
    const diffMs = Date.now() - d.getTime();
    return Math.max(0, Math.floor(diffMs / 86400000));
}

function isValidEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function uniqSorted(values) {
    return Array.from(new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b));
}

function getCacheState() {
    if (!global.__openclawCustomersCache) {
        global.__openclawCustomersCache = {
            stamp: 0,
            companies: new Map(),
            billingByCompany: new Map()
        };
    }
    return global.__openclawCustomersCache;
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

function classifyRecency(daysSinceLastInvoice) {
    if (daysSinceLastInvoice === null) {
        return {
            recency_bucket: 'never_billed',
            winback_sequence: 'onboarding_reactivation',
            email_priority: 'high'
        };
    }
    if (daysSinceLastInvoice <= 90) {
        return {
            recency_bucket: '0_90_days',
            winback_sequence: 'quick_winback',
            email_priority: 'medium'
        };
    }
    if (daysSinceLastInvoice <= 180) {
        return {
            recency_bucket: '91_180_days',
            winback_sequence: 'quick_winback',
            email_priority: 'medium'
        };
    }
    if (daysSinceLastInvoice <= 365) {
        return {
            recency_bucket: '181_365_days',
            winback_sequence: 'strategic_reactivation',
            email_priority: 'high'
        };
    }
    return {
        recency_bucket: '366_plus_days',
        winback_sequence: 'dormant_revival',
        email_priority: 'high'
    };
}

function resolveContractStatus(statusCode) {
    const code = Number(statusCode || 0);
    return CONTRACT_STATUS_META[code] || { label: 'unknown', terminal: false };
}

async function buildCustomerCache(forceRefresh = false, maxBillingPages = DEFAULT_BILLING_MAX_PAGES) {
    const cache = getCacheState();
    const now = Date.now();

    const currentBillingPages = Number(cache.billingPages || 0);
    const billingWindowChanged = currentBillingPages !== Number(maxBillingPages);

    if (!forceRefresh && !billingWindowChanged && cache.stamp && (now - cache.stamp) < CACHE_TTL_MS) {
        return cache;
    }

    const [companyDocs, branchDocs, contractDocs, billInfoDocs, billingDocs] = await Promise.all([
        firestoreGetAll('tbl_companylist', { fieldMask: ['id', 'companyname'], maxPages: 30 }),
        firestoreGetAll('tbl_branchinfo', {
            fieldMask: ['id', 'company_id', 'branchname', 'email', 'signatory', 'delivery_contact', 'service_contact', 'inactive'],
            maxPages: 50
        }),
        firestoreGetAll('tbl_contractmain', { fieldMask: ['id', 'contract_id', 'mach_id', 'status'], maxPages: 80 }),
        firestoreGetAll('tbl_billinfo', {
            fieldMask: ['id', 'branch_id', 'acct_email', 'acct_contact', 'endusername', 'cashier_contact', 'treasury_contact', 'releasing_contact', 'endusercontactnum', 'acct_num', 'cashier_num', 'treasury_num', 'releasing_num'],
            maxPages: 80
        }),
        firestoreGetAll('tbl_billing', {
            fieldMask: ['id', 'contractmain_id', 'dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'due_date'],
            maxPages: Math.max(10, Math.min(560, Number(maxBillingPages)))
        })
    ]);

    const companies = new Map();
    companyDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;
        companies.set(id, {
            company_id: id,
            company_name: String(getField(f, ['companyname']) || 'Unknown').trim() || 'Unknown',
            branch_ids: new Set(),
            branch_names: new Set(),
            total_contracts: 0,
            active_machine_contracts: 0,
            inactive_machine_contracts: 0,
            terminal_machine_contracts: 0,
            non_terminal_machine_contracts: 0,
            status_breakdown: {},
            machine_ids: new Set(),
            emails: new Set(),
            contact_people: new Set(),
            contact_numbers: new Set(),
            branches_marked_inactive: 0
        });
    });

    const branchMap = new Map();
    branchDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;
        const companyId = String(getField(f, ['company_id']) || '').trim();
        if (!companyId) return;

        branchMap.set(id, {
            id,
            companyId,
            branchName: String(getField(f, ['branchname']) || 'Main').trim() || 'Main',
            email: String(getField(f, ['email']) || '').trim(),
            signatory: String(getField(f, ['signatory']) || '').trim(),
            deliveryContact: String(getField(f, ['delivery_contact']) || '').trim(),
            serviceContact: String(getField(f, ['service_contact']) || '').trim(),
            inactive: Boolean(getField(f, ['inactive']) || false)
        });

        let company = companies.get(companyId);
        if (!company) {
            company = {
                company_id: companyId,
                company_name: 'Unknown',
                branch_ids: new Set(),
                branch_names: new Set(),
                total_contracts: 0,
                active_machine_contracts: 0,
                inactive_machine_contracts: 0,
                terminal_machine_contracts: 0,
                non_terminal_machine_contracts: 0,
                status_breakdown: {},
                machine_ids: new Set(),
                emails: new Set(),
                contact_people: new Set(),
                contact_numbers: new Set(),
                branches_marked_inactive: 0
            };
            companies.set(companyId, company);
        }

        company.branch_ids.add(id);
        company.branch_names.add(String(getField(f, ['branchname']) || 'Main').trim() || 'Main');
        if (isValidEmail(branchMap.get(id).email)) company.emails.add(branchMap.get(id).email.toLowerCase());
        if (branchMap.get(id).signatory) company.contact_people.add(branchMap.get(id).signatory);
        if (branchMap.get(id).deliveryContact) company.contact_people.add(branchMap.get(id).deliveryContact);
        if (branchMap.get(id).serviceContact) company.contact_people.add(branchMap.get(id).serviceContact);
        if (branchMap.get(id).inactive) company.branches_marked_inactive += 1;
    });

    const billInfoByBranch = new Map();
    billInfoDocs.forEach((doc) => {
        const f = doc.fields || {};
        const branchId = String(getField(f, ['branch_id']) || '').trim();
        if (!branchId) return;
        if (!billInfoByBranch.has(branchId)) billInfoByBranch.set(branchId, []);
        billInfoByBranch.get(branchId).push({
            acctEmail: String(getField(f, ['acct_email']) || '').trim(),
            acctContact: String(getField(f, ['acct_contact']) || '').trim(),
            endUserName: String(getField(f, ['endusername']) || '').trim(),
            cashierContact: String(getField(f, ['cashier_contact']) || '').trim(),
            treasuryContact: String(getField(f, ['treasury_contact']) || '').trim(),
            releasingContact: String(getField(f, ['releasing_contact']) || '').trim(),
            endUserContactNum: String(getField(f, ['endusercontactnum']) || '').trim(),
            acctNum: String(getField(f, ['acct_num']) || '').trim(),
            cashierNum: String(getField(f, ['cashier_num']) || '').trim(),
            treasuryNum: String(getField(f, ['treasury_num']) || '').trim(),
            releasingNum: String(getField(f, ['releasing_num']) || '').trim()
        });
    });

    branchMap.forEach((branch) => {
        const company = companies.get(branch.companyId);
        if (!company) return;

        const billInfos = billInfoByBranch.get(branch.id) || [];
        billInfos.forEach((bi) => {
            if (isValidEmail(bi.acctEmail)) company.emails.add(bi.acctEmail.toLowerCase());
            [bi.acctContact, bi.endUserName, bi.cashierContact, bi.treasuryContact, bi.releasingContact]
                .filter(Boolean)
                .forEach((name) => company.contact_people.add(name));
            [bi.endUserContactNum, bi.acctNum, bi.cashierNum, bi.treasuryNum, bi.releasingNum]
                .filter(Boolean)
                .forEach((num) => company.contact_numbers.add(num));
        });
    });

    const contractMap = new Map();
    contractDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        const branchId = String(getField(f, ['contract_id']) || '').trim();
        if (!id || !branchId) return;

        contractMap.set(id, {
            id,
            branchId,
            machineId: String(getField(f, ['mach_id']) || '').trim(),
            status: Number(getField(f, ['status']) || 0)
        });

        const branch = branchMap.get(branchId);
        if (!branch) return;
        const company = companies.get(branch.companyId);
        if (!company) return;

        const statusMeta = resolveContractStatus(getField(f, ['status']));
        const statusCode = Number(getField(f, ['status']) || 0);
        const statusKey = statusMeta.label;

        company.total_contracts += 1;
        if (statusCode === 1) {
            company.active_machine_contracts += 1;
        } else {
            company.inactive_machine_contracts += 1;
        }

        if (statusMeta.terminal) {
            company.terminal_machine_contracts += 1;
        } else {
            company.non_terminal_machine_contracts += 1;
        }

        company.status_breakdown[statusKey] = (company.status_breakdown[statusKey] || 0) + 1;
        if (String(getField(f, ['mach_id']) || '').trim()) {
            company.machine_ids.add(String(getField(f, ['mach_id']) || '').trim());
        }
    });

    const billingByCompany = new Map();
    billingDocs.forEach((doc) => {
        const f = doc.fields || {};
        const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
        if (!contractmainId) return;
        const contract = contractMap.get(contractmainId);
        if (!contract) return;
        const branch = branchMap.get(contract.branchId);
        if (!branch) return;
        const companyId = String(branch.companyId || '').trim();
        if (!companyId) return;

        const invoiceDate = normalizeDate(getField(f, ['dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'due_date']));
        let entry = billingByCompany.get(companyId);
        if (!entry) {
            entry = {
                invoice_count: 0,
                last_invoice_date: null
            };
            billingByCompany.set(companyId, entry);
        }
        entry.invoice_count += 1;
        if (invoiceDate) {
            if (!entry.last_invoice_date || invoiceDate > entry.last_invoice_date) {
                entry.last_invoice_date = invoiceDate;
            }
        }
    });

    cache.companies = companies;
    cache.billingByCompany = billingByCompany;
    cache.stamp = now;
    cache.billingPages = Number(maxBillingPages);
    return cache;
}

function summarizeCustomers(cache) {
    const rows = [];
    const counts = {
        total_customers: 0,
        active_customers: 0,
        inactive_customers: 0,
        customers_with_email: 0,
        customers_without_email: 0,
        total_machine_contracts: 0,
        active_machine_contracts: 0,
        inactive_machine_contracts: 0
    };

    cache.companies.forEach((company) => {
        const billing = cache.billingByCompany.get(company.company_id) || {
            invoice_count: 0,
            last_invoice_date: null
        };

        const isActive = company.active_machine_contracts > 0;
        const hasEmail = company.emails.size > 0;
        const lastInvoiceDate = billing.last_invoice_date;
        const daysSinceLastInvoice = daysBetweenNow(lastInvoiceDate);
        const recencyMeta = classifyRecency(daysSinceLastInvoice);

        const totalBranches = company.branch_ids.size;
        const allBranchesInactive = totalBranches > 0 && company.branches_marked_inactive >= totalBranches;
        const noContracts = company.total_contracts === 0;

        const inactiveReasons = [];
        if (!isActive) {
            if (noContracts) inactiveReasons.push('no_machine_contracts');
            if (!noContracts && company.terminal_machine_contracts >= company.total_contracts) inactiveReasons.push('all_contracts_terminal');
            if (!noContracts && company.terminal_machine_contracts < company.total_contracts) inactiveReasons.push('no_active_machine_contracts');
            if (allBranchesInactive) inactiveReasons.push('all_branches_marked_inactive');
        }
        if (!hasEmail) inactiveReasons.push('missing_email');

        rows.push({
            company_id: company.company_id,
            company_name: company.company_name,
            customer_status: isActive ? 'active' : 'inactive',
            total_branches: totalBranches,
            branch_names: uniqSorted(Array.from(company.branch_names)),
            machine_contracts_total: company.total_contracts,
            machine_contracts_active: company.active_machine_contracts,
            machine_contracts_inactive: company.inactive_machine_contracts,
            machine_contracts_terminal: company.terminal_machine_contracts,
            unique_machine_count: company.machine_ids.size,
            machine_status_breakdown: company.status_breakdown,
            billing_invoice_count: billing.invoice_count,
            last_invoice_date: formatDateIso(lastInvoiceDate),
            days_since_last_invoice: daysSinceLastInvoice,
            recency_bucket: recencyMeta.recency_bucket,
            recommended_winback_sequence: isActive ? null : recencyMeta.winback_sequence,
            email_priority: isActive ? null : recencyMeta.email_priority,
            email_candidates: uniqSorted(Array.from(company.emails)),
            primary_email: uniqSorted(Array.from(company.emails))[0] || null,
            contact_people: uniqSorted(Array.from(company.contact_people)),
            contact_numbers: uniqSorted(Array.from(company.contact_numbers)),
            inactive_reasons: inactiveReasons
        });

        counts.total_customers += 1;
        counts.total_machine_contracts += company.total_contracts;
        counts.active_machine_contracts += company.active_machine_contracts;
        counts.inactive_machine_contracts += company.inactive_machine_contracts;
        if (isActive) counts.active_customers += 1;
        else counts.inactive_customers += 1;
        if (hasEmail) counts.customers_with_email += 1;
        else counts.customers_without_email += 1;
    });

    const coveragePct = counts.total_customers
        ? Number(((counts.active_customers / counts.total_customers) * 100).toFixed(2))
        : 0;

    return {
        rows,
        summary: {
            ...counts,
            active_customer_ratio_pct: coveragePct
        }
    };
}

function aggregateInactive(rows) {
    const recencyBuckets = {};
    const sequenceBuckets = {};
    const missingEmail = {
        count: 0,
        customers: []
    };

    rows.forEach((row) => {
        if (row.customer_status !== 'inactive') return;
        recencyBuckets[row.recency_bucket] = (recencyBuckets[row.recency_bucket] || 0) + 1;
        sequenceBuckets[row.recommended_winback_sequence] = (sequenceBuckets[row.recommended_winback_sequence] || 0) + 1;
        if (!row.primary_email) {
            missingEmail.count += 1;
            missingEmail.customers.push({
                company_id: row.company_id,
                company_name: row.company_name
            });
        }
    });

    return {
        by_recency: recencyBuckets,
        by_sequence: sequenceBuckets,
        missing_email: missingEmail
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
        const includeInactiveCustomers = boolParam(searchParams.get('include_inactive_customers'), true);
        const includeActiveCustomers = boolParam(searchParams.get('include_active_customers'), false);
        const inactiveLimit = Math.max(1, Math.min(5000, Number(searchParams.get('inactive_limit') || 500)));
        const activeLimit = Math.max(1, Math.min(5000, Number(searchParams.get('active_limit') || 200)));
        const maxBillingPages = Math.max(10, Math.min(560, Number(searchParams.get('max_billing_pages') || DEFAULT_BILLING_MAX_PAGES)));
        const includeSequencePlaybook = boolParam(searchParams.get('include_sequence_playbook'), true);

        const cache = await buildCustomerCache(forceRefresh, maxBillingPages);
        const { rows, summary } = summarizeCustomers(cache);

        const inactiveRows = rows.filter((row) => row.customer_status === 'inactive')
            .sort((a, b) => {
                const aDays = a.days_since_last_invoice === null ? Number.MAX_SAFE_INTEGER : a.days_since_last_invoice;
                const bDays = b.days_since_last_invoice === null ? Number.MAX_SAFE_INTEGER : b.days_since_last_invoice;
                return bDays - aDays;
            });

        const activeRows = rows.filter((row) => row.customer_status === 'active')
            .sort((a, b) => b.machine_contracts_active - a.machine_contracts_active);

        const sequencePlaybook = includeSequencePlaybook ? {
            onboarding_reactivation: [
                'Email 1: Welcome back intro + quick account check',
                'Email 2: First-service incentive + easy contact CTA',
                'Email 3: Case study + branch support hotline'
            ],
            quick_winback: [
                'Email 1: Service continuity reminder',
                'Email 2: Volume optimization offer',
                'Email 3: Priority scheduling message'
            ],
            strategic_reactivation: [
                'Email 1: Cost and uptime assessment offer',
                'Email 2: Machine refresh and billing options',
                'Email 3: Escalation to account manager'
            ],
            dormant_revival: [
                'Email 1: Re-introduction with updated offers',
                'Email 2: Dedicated reactivation bundle',
                'Email 3: Final outreach + referral option'
            ]
        } : null;

        return toJson(200, {
            ok: true,
            meta: {
                analyzed_at: new Date().toISOString(),
                cache_ttl_ms: CACHE_TTL_MS,
                lookup_cached_at: cache.stamp ? new Date(cache.stamp).toISOString() : null,
                inactive_returned: includeInactiveCustomers ? Math.min(inactiveRows.length, inactiveLimit) : 0,
                inactive_total: inactiveRows.length,
                active_returned: includeActiveCustomers ? Math.min(activeRows.length, activeLimit) : 0,
                active_total: activeRows.length
            },
            summary,
            inactive_analysis: aggregateInactive(rows),
            email_sequence_playbook: sequencePlaybook,
            inactive_customers: includeInactiveCustomers ? inactiveRows.slice(0, inactiveLimit) : [],
            active_customers: includeActiveCustomers ? activeRows.slice(0, activeLimit) : []
        });
    } catch (error) {
        return toJson(500, {
            ok: false,
            error: error.message || 'Unexpected error'
        });
    }
};
