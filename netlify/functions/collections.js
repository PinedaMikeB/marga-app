const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M';
const BASE_URL = process.env.FIRESTORE_BASE_URL || 'https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || '';

const CACHE_TTL_MS = Number(process.env.COLLECTIONS_API_CACHE_TTL_MS || 5 * 60 * 1000);
const DEFAULT_BILLING_PAGES = Number(process.env.COLLECTIONS_API_DEFAULT_BILLING_PAGES || 160);
const DEFAULT_PAGE_SIZE = Number(process.env.COLLECTIONS_API_DEFAULT_PAGE_SIZE || 200);

const categoryMap = {
    1: 'RTP', 2: 'RTF', 3: 'STP', 4: 'MAT', 5: 'RTC',
    6: 'STC', 7: 'MAC', 8: 'MAP', 9: 'REF', 10: 'RD'
};

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
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

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

function toDateKey(value) {
    const d = normalizeDate(value);
    if (!d) return null;
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}

function formatDate(value) {
    const d = normalizeDate(value);
    if (!d) return null;
    return d.toISOString();
}

function calculateAge(dueDate, month, year) {
    const due = normalizeDate(dueDate);
    if (due) {
        return Math.max(0, Math.floor((Date.now() - due.getTime()) / 86400000));
    }

    const monthNum = monthMap[String(month || '').toLowerCase()] || 0;
    if (monthNum && year) {
        const date = new Date(Number(year), monthNum - 1, 1);
        if (!Number.isNaN(date.getTime())) {
            return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
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

function boolParam(value, defaultValue = false) {
    if (value === null || value === undefined || value === '') return defaultValue;
    const v = String(value).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

function inRange(date, fromDate, toDate) {
    if (!date) return false;
    if (fromDate && date < fromDate) return false;
    if (toDate) {
        const end = new Date(toDate.getTime());
        end.setHours(23, 59, 59, 999);
        if (date > end) return false;
    }
    return true;
}

function parseDateParam(value) {
    if (!value) return null;
    return normalizeDate(String(value).trim());
}

async function firestoreGet(collection, pageSize = 300, pageToken = null, fieldMask = null) {
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
        pageSize = 300,
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

async function firestoreRunQuery(structuredQuery) {
    const response = await fetch(`${BASE_URL}:runQuery?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });

    if (!response.ok) {
        throw new Error(`runQuery failed: ${response.status}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => row.document).filter(Boolean);
}

function getCacheState() {
    if (!global.__collectionsApiCache) {
        global.__collectionsApiCache = {
            stamp: 0,
            companyMap: {},
            branchMap: {},
            contractMap: {},
            machToBranchMap: {},
            paidInvoiceIds: new Set(),
            collectionHistory: {},
            paymentEntries: []
        };
    }
    return global.__collectionsApiCache;
}

async function loadLookupCache(forceRefresh = false) {
    const cache = getCacheState();
    const now = Date.now();

    if (!forceRefresh && cache.stamp && (now - cache.stamp) < CACHE_TTL_MS) {
        return cache;
    }

    const [companyDocs, branchDocs, contractDocs, machineDocs, paymentDocs, historyDocs] = await Promise.all([
        firestoreGetAll('tbl_companylist', { fieldMask: ['id', 'companyname'], maxPages: 30 }),
        firestoreGetAll('tbl_branchinfo', { fieldMask: ['id', 'company_id', 'branchname'], maxPages: 40 }),
        firestoreGetAll('tbl_contractmain', { fieldMask: ['id', 'contract_id', 'mach_id', 'category_id'], maxPages: 50 }),
        firestoreGetAll('tbl_newmachinehistory', { fieldMask: ['mach_id', 'branch_id', 'status_id', 'datex'], maxPages: 140 }),
        firestoreGetAll('tbl_paymentinfo', { fieldMask: ['invoice_id', 'payment_amt', 'date_deposit', 'date_paid', 'tax_date_paid'], maxPages: 340 }),
        firestoreGetAll('tbl_collectionhistory', {
            fieldMask: ['invoice_num', 'invoice_id', 'invoice_no', 'invoiceno', 'followup_datetime', 'followup_date', 'next_followup', 'remarks', 'contact_person', 'contact_number', 'timestamp', 'call_datetime', 'created_at', 'schedule_status'],
            maxPages: 80
        })
    ]);

    cache.companyMap = {};
    companyDocs.forEach((doc) => {
        const id = String(getField(doc.fields || {}, ['id']) || '').trim();
        if (!id) return;
        cache.companyMap[id] = getField(doc.fields || {}, ['companyname']) || 'Unknown';
    });

    cache.branchMap = {};
    branchDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;
        cache.branchMap[id] = {
            name: getField(f, ['branchname']) || 'Main',
            companyId: String(getField(f, ['company_id']) || '').trim()
        };
    });

    cache.contractMap = {};
    contractDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;
        cache.contractMap[id] = {
            contractId: String(getField(f, ['contract_id']) || '').trim(),
            machId: String(getField(f, ['mach_id']) || '').trim(),
            categoryId: getField(f, ['category_id'])
        };
    });

    const byMachine = {};
    machineDocs.forEach((doc) => {
        const f = doc.fields || {};
        const machId = String(getField(f, ['mach_id']) || '').trim();
        const branchId = getField(f, ['branch_id']);
        const statusId = Number(getField(f, ['status_id']) || 0);
        const datex = normalizeDate(getField(f, ['datex']));
        if (!machId || !branchId || statusId !== 2) return;
        if (!byMachine[machId]) byMachine[machId] = [];
        byMachine[machId].push({
            branchId: String(branchId),
            date: datex
        });
    });

    cache.machToBranchMap = {};
    Object.entries(byMachine).forEach(([machId, rows]) => {
        rows.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
        cache.machToBranchMap[machId] = rows[0].branchId;
    });

    cache.paidInvoiceIds = new Set();
    cache.paymentEntries = [];
    paymentDocs.forEach((doc) => {
        const f = doc.fields || {};
        const invoiceId = getField(f, ['invoice_id']);
        if (invoiceId !== null && invoiceId !== undefined && String(invoiceId).trim()) {
            cache.paidInvoiceIds.add(String(invoiceId).trim());
        }

        const paymentAmount = Number(getField(f, ['payment_amt']) || 0);
        const paymentDate = normalizeDate(getField(f, ['date_deposit', 'date_paid', 'tax_date_paid']));
        if (paymentAmount > 0 && paymentDate) {
            cache.paymentEntries.push({
                amount: paymentAmount,
                paymentDate
            });
        }
    });

    cache.collectionHistory = {};
    historyDocs.forEach((doc) => {
        const f = doc.fields || {};
        const invoiceRef = getField(f, ['invoice_num', 'invoice_id', 'invoice_no', 'invoiceno']);
        if (!invoiceRef) return;
        const key = String(invoiceRef).trim();
        if (!key) return;

        const followupDateRaw = getField(f, ['followup_datetime', 'followup_date', 'next_followup']);
        const callDateRaw = getField(f, ['timestamp', 'call_datetime', 'created_at']) || followupDateRaw;

        const row = {
            remarks: getField(f, ['remarks']) || 'No remarks',
            contactPerson: getField(f, ['contact_person']) || '-',
            contactNumber: getField(f, ['contact_number']) || '',
            scheduleStatus: getField(f, ['schedule_status']),
            followupDate: normalizeDate(followupDateRaw),
            callDate: normalizeDate(callDateRaw)
        };

        if (!cache.collectionHistory[key]) cache.collectionHistory[key] = [];
        cache.collectionHistory[key].push(row);
    });

    Object.keys(cache.collectionHistory).forEach((key) => {
        cache.collectionHistory[key].sort((a, b) => (b.callDate ? b.callDate.getTime() : 0) - (a.callDate ? a.callDate.getTime() : 0));
    });

    cache.stamp = now;
    return cache;
}

function getInvoiceHistory(cache, invoiceNo, invoiceId) {
    const rows = [];
    const seen = new Set();

    [invoiceNo, invoiceId]
        .filter((v) => v !== null && v !== undefined && String(v).trim())
        .forEach((key) => {
            (cache.collectionHistory[String(key).trim()] || []).forEach((entry) => {
                const token = `${entry.callDate ? entry.callDate.getTime() : 0}|${entry.remarks}|${entry.contactPerson}`;
                if (seen.has(token)) return;
                seen.add(token);
                rows.push(entry);
            });
        });

    rows.sort((a, b) => (b.callDate ? b.callDate.getTime() : 0) - (a.callDate ? a.callDate.getTime() : 0));
    return rows;
}

function parsePrioritySet(priorityValue) {
    if (!priorityValue) return null;
    const aliases = {
        urgent: 'urgent',
        high: 'high',
        medium: 'medium',
        current: 'current',
        review: 'review',
        forreview: 'review',
        for_review: 'review',
        baddebt: 'baddebt',
        bad_debt: 'baddebt',
        doubtful: 'doubtful'
    };
    const set = new Set();
    String(priorityValue)
        .split(',')
        .map((x) => x.trim().toLowerCase().replace(/\s+/g, ''))
        .filter(Boolean)
        .forEach((token) => {
            const mapped = aliases[token] || token;
            set.add(mapped);
        });
    return set.size ? set : null;
}

function parseYearMonthSearch(searchParams) {
    const year = String(searchParams.get('year') || '').trim();
    const month = String(searchParams.get('month') || '').trim();
    return {
        year,
        month: month ? month.toLowerCase() : ''
    };
}

async function loadBillingDocs(searchParams) {
    const fromDate = parseDateParam(searchParams.get('from'));
    const toDate = parseDateParam(searchParams.get('to'));
    const maxBillingPages = Math.max(10, Math.min(420, Number(searchParams.get('max_billing_pages') || DEFAULT_BILLING_PAGES)));

    const fieldMask = [
        'id', 'invoice_id', 'invoiceid', 'invoiceno', 'invoice_no', 'contractmain_id',
        'month', 'year', 'due_date', 'totalamount', 'amount', 'vatamount',
        'dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'contact_number'
    ];

    if (fromDate || toDate) {
        const filters = [];
        if (fromDate) {
            const from = toDateKey(fromDate);
            if (from) {
                filters.push({
                    fieldFilter: {
                        field: { fieldPath: 'due_date' },
                        op: 'GREATER_THAN_OR_EQUAL',
                        value: { stringValue: `${from} 00:00:00` }
                    }
                });
            }
        }
        if (toDate) {
            const to = toDateKey(toDate);
            if (to) {
                filters.push({
                    fieldFilter: {
                        field: { fieldPath: 'due_date' },
                        op: 'LESS_THAN_OR_EQUAL',
                        value: { stringValue: `${to} 23:59:59` }
                    }
                });
            }
        }

        try {
            const query = {
                from: [{ collectionId: 'tbl_billing' }],
                select: { fields: fieldMask.map((f) => ({ fieldPath: f })) }
            };
            if (filters.length === 1) {
                query.where = filters[0];
            } else if (filters.length > 1) {
                query.where = { compositeFilter: { op: 'AND', filters } };
            }
            return await firestoreRunQuery(query);
        } catch (error) {
            // Fallback to standard paged read if query/index fails.
            return await firestoreGetAll('tbl_billing', { fieldMask, maxPages: maxBillingPages });
        }
    }

    return await firestoreGetAll('tbl_billing', { fieldMask, maxPages: maxBillingPages });
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return toJson(200, { ok: true });
    }

    if (event.httpMethod !== 'GET') {
        return toJson(405, { ok: false, error: 'Method not allowed' });
    }

    try {
        const headers = event.headers || {};
        const queryParams = event.queryStringParameters || {};

        if (OPENCLAW_API_KEY) {
            const headerKey = headers['x-api-key'] || headers['X-API-Key'] || '';
            const authHeader = headers.authorization || headers.Authorization || '';
            const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
            const queryKey = queryParams.api_key ? String(queryParams.api_key).trim() : '';
            const provided = headerKey || bearer || queryKey;
            if (!provided || provided !== OPENCLAW_API_KEY) {
                return toJson(401, { ok: false, error: 'Unauthorized' });
            }
        }

        const searchParams = new URLSearchParams();
        Object.entries(queryParams).forEach(([key, value]) => {
            if (value !== null && value !== undefined) searchParams.set(key, String(value));
        });

        const page = Math.max(1, Number(searchParams.get('page') || 1));
        const pageSize = Math.max(1, Math.min(1000, Number(searchParams.get('page_size') || DEFAULT_PAGE_SIZE)));
        const includeHistory = boolParam(searchParams.get('include_history'), true);
        const includePaid = boolParam(searchParams.get('include_paid'), true);
        const forceRefresh = boolParam(searchParams.get('refresh_cache'), false);

        const fromDate = parseDateParam(searchParams.get('from'));
        const toDate = parseDateParam(searchParams.get('to'));
        const search = String(searchParams.get('search') || '').trim().toLowerCase();
        const prioritySet = parsePrioritySet(searchParams.get('priority'));
        const companyFilter = String(searchParams.get('company') || '').trim().toLowerCase();
        const branchFilter = String(searchParams.get('branch') || '').trim().toLowerCase();
        const invoiceFilter = String(searchParams.get('invoice_id') || '').trim();
        const minAge = searchParams.get('min_age') ? Number(searchParams.get('min_age')) : null;
        const maxAge = searchParams.get('max_age') ? Number(searchParams.get('max_age')) : null;
        const { year, month } = parseYearMonthSearch(searchParams);

        const cache = await loadLookupCache(forceRefresh);
        const billingDocs = await loadBillingDocs(searchParams);

        const rows = [];
        for (const doc of billingDocs) {
            const f = doc.fields || {};
            const invoiceIdValue = getField(f, ['invoice_id', 'invoiceid']);
            const invoiceNoValue = getField(f, ['invoiceno', 'invoice_no', 'invoice_id', 'id']);

            const invoiceId = invoiceIdValue !== null && invoiceIdValue !== undefined ? String(invoiceIdValue).trim() : '';
            const invoiceNo = invoiceNoValue !== null && invoiceNoValue !== undefined ? String(invoiceNoValue).trim() : '';
            const invoiceKey = invoiceNo || invoiceId;

            if (!invoiceKey) continue;

            const isPaid = cache.paidInvoiceIds.has(invoiceId) || cache.paidInvoiceIds.has(invoiceNo);
            if (!includePaid && isPaid) continue;
            if (invoiceFilter && invoiceFilter !== invoiceId && invoiceFilter !== invoiceNo) continue;

            const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
            const contract = cache.contractMap[contractmainId] || {};

            let branchId = cache.machToBranchMap[contract.machId];
            if (!branchId && contract.contractId) branchId = contract.contractId;

            const branch = cache.branchMap[String(branchId || '').trim()];
            const branchName = branch ? branch.name || 'Main' : 'Main';
            const companyName = branch ? (cache.companyMap[branch.companyId] || 'Unknown') : 'Unknown';

            const monthValue = getField(f, ['month']);
            const yearValue = getField(f, ['year']);
            const dueDateRaw = getField(f, ['due_date']);
            const invoiceDateRaw = getField(f, ['dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'due_date']);

            if (year && String(yearValue || '') !== year) continue;
            if (month && String(monthValue || '').toLowerCase() !== month) continue;

            const dueDate = normalizeDate(dueDateRaw);
            const invoiceDate = normalizeDate(invoiceDateRaw);

            if ((fromDate || toDate) && !inRange(invoiceDate || dueDate, fromDate, toDate)) continue;

            const amount = Number(getField(f, ['totalamount', 'amount']) || 0) + Number(getField(f, ['vatamount']) || 0);
            const age = calculateAge(dueDateRaw, monthValue, yearValue);
            const priority = getPriority(age);

            if (prioritySet && !prioritySet.has(priority.code)) continue;
            if (minAge !== null && Number.isFinite(minAge) && age < minAge) continue;
            if (maxAge !== null && Number.isFinite(maxAge) && age > maxAge) continue;

            if (companyFilter && !companyName.toLowerCase().includes(companyFilter)) continue;
            if (branchFilter && !branchName.toLowerCase().includes(branchFilter)) continue;

            const history = getInvoiceHistory(cache, invoiceNo, invoiceId);
            const last = history[0] || null;

            const row = {
                invoice_id: invoiceId || invoiceNo,
                invoice_no: invoiceNo || invoiceId,
                doc_id: getField(f, ['id']),
                company: companyName,
                branch_department: branchName,
                contact_number: getField(f, ['contact_number']) || (last ? last.contactNumber : ''),
                category: categoryMap[Number(contract.categoryId)] || '-',
                amount,
                month: monthValue || null,
                year: yearValue || null,
                due_date: formatDate(dueDate),
                invoice_date: formatDate(invoiceDate),
                age_days: age,
                priority,
                is_paid: isPaid,
                history_count: history.length,
                last_remarks: last ? last.remarks : null,
                last_contact_person: last ? last.contactPerson : null,
                last_contact_number: last ? last.contactNumber : null,
                last_contact_date: last ? formatDate(last.callDate) : null,
                next_followup_date: last ? formatDate(last.followupDate) : null,
                schedule_status: last ? last.scheduleStatus : null
            };

            if (includeHistory) {
                row.history = history.map((entry) => ({
                    remarks: entry.remarks,
                    contact_person: entry.contactPerson,
                    contact_number: entry.contactNumber,
                    call_date: formatDate(entry.callDate),
                    followup_date: formatDate(entry.followupDate),
                    schedule_status: entry.scheduleStatus
                }));
            }

            if (search) {
                const haystack = `${row.invoice_no} ${row.company} ${row.branch_department}`.toLowerCase();
                if (!haystack.includes(search)) continue;
            }

            rows.push(row);
        }

        rows.sort((a, b) => {
            if (a.priority.order !== b.priority.order) return a.priority.order - b.priority.order;
            if (b.age_days !== a.age_days) return b.age_days - a.age_days;
            return b.amount - a.amount;
        });

        const totalCount = rows.length;
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const pageRows = rows.slice(start, end);

        const priorityTotals = {};
        const summary = {
            total_invoices: totalCount,
            total_amount: 0,
            total_unpaid_amount: 0,
            total_paid_amount: 0,
            average_age_days: 0,
            by_priority: priorityTotals,
            duration: {
                from: toDateKey(fromDate),
                to: toDateKey(toDate),
                total_bill: 0,
                total_collections: 0,
                need_to_collect: 0,
                bill_invoice_count: 0,
                payment_count: 0,
                unpaid_invoice_count: 0
            }
        };

        let sumAge = 0;
        rows.forEach((row) => {
            summary.total_amount += row.amount;
            sumAge += row.age_days;
            if (row.is_paid) {
                summary.total_paid_amount += row.amount;
            } else {
                summary.total_unpaid_amount += row.amount;
            }

            const key = row.priority.code;
            if (!priorityTotals[key]) {
                priorityTotals[key] = {
                    label: row.priority.label,
                    count: 0,
                    amount: 0
                };
            }
            priorityTotals[key].count += 1;
            priorityTotals[key].amount += row.amount;

            if (inRange(normalizeDate(row.invoice_date) || normalizeDate(row.due_date), fromDate, toDate)) {
                summary.duration.total_bill += row.amount;
                summary.duration.bill_invoice_count += 1;
                if (!row.is_paid) {
                    summary.duration.need_to_collect += row.amount;
                    summary.duration.unpaid_invoice_count += 1;
                }
            }
        });

        summary.average_age_days = totalCount ? (sumAge / totalCount) : 0;

        cache.paymentEntries.forEach((payment) => {
            if (inRange(payment.paymentDate, fromDate, toDate)) {
                summary.duration.total_collections += payment.amount;
                summary.duration.payment_count += 1;
            }
        });

        return toJson(200, {
            ok: true,
            meta: {
                page,
                page_size: pageSize,
                total_pages: Math.max(1, Math.ceil(totalCount / pageSize)),
                total_records: totalCount,
                cache_ttl_ms: CACHE_TTL_MS,
                cached_at: new Date(cache.stamp).toISOString()
            },
            filters: {
                from: toDateKey(fromDate),
                to: toDateKey(toDate),
                search,
                priority: prioritySet ? Array.from(prioritySet) : null,
                company: companyFilter || null,
                branch: branchFilter || null,
                invoice_id: invoiceFilter || null,
                year: year || null,
                month: month || null,
                min_age: minAge,
                max_age: maxAge,
                include_paid: includePaid,
                include_history: includeHistory
            },
            summary,
            data: pageRows
        });
    } catch (error) {
        return toJson(500, {
            ok: false,
            error: error.message || 'Unexpected error'
        });
    }
};
