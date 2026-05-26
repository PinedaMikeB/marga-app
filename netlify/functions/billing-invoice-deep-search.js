const MARGABASE_API_KEY = process.env.MARGABASE_API_KEY || 'margabase-local';
const BASE_URL = process.env.MARGABASE_DOCUMENTS_BASE_URL
    || process.env.MARGABASE_FIRESTORE_BASE_URL
    || 'http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents';

const BILLING_FIELDS = [
    'id', 'invoice_id', 'invoiceid', 'invoiceno', 'invoice_no', 'invoice_num', 'invoice_number',
    'company_name', 'branch_name', 'company_id', 'branch_id', 'contractmain_id', 'machine_id',
    'serial_number', 'machine_label', 'month', 'year', 'amount', 'totalamount', 'amount2',
    'totalamount2', 'dateprinted', 'date_printed', 'invoice_date', 'invdate', 'datex',
    'date_received', 'receivedby', 'isreceived', 'prepared_by', 'saved_by',
    'billing_printed_at', 'billing_printed_by'
];

const SCHEDULE_FIELDS = [
    'id', 'invoice_no', 'invoice_num', 'invoice_id', 'invoiceno', 'invoice_number',
    'customer', 'client', 'branch', 'schedule_date', 'schedule_time', 'date_encoded',
    'date_finished', 'status', 'purpose', 'purpose_id', 'assigned_to', 'assigned',
    'field_billing_received_by', 'field_billing_date', 'field_billing_time',
    'field_billing_assigned_staff_name', 'field_billing_assigned_staff_id', 'remarks'
];

const COLLECTION_HISTORY_FIELDS = [
    'id', 'invoice_num', 'invoice_id', 'invoice_no', 'invoiceno', 'account_ref', 'account_group_ref',
    'date_created', 'call_date', 'followup_date', 'remarks', 'status', 'collection_id',
    'encoded_by', 'created_by'
];

const PAYMENT_FIELDS = [
    'id', 'invoice_num', 'invoice_id', 'invoice_no', 'invoiceno', 'client', 'category',
    'invoice_amt', 'amount', 'or_num', 'or_number', 'date_paid', 'payment_date',
    'payment_status', 'status', 'remarks'
];

const CONTRACT_FIELDS = ['id', 'contract_id', 'machine_id', 'mach_id'];
const CONTRACT_DEP_FIELDS = ['id', 'branch_id', 'departmentname'];
const MACHINE_FIELDS = ['id', 'client_id', 'description', 'serial', 'model_id'];
const BRANCH_FIELDS = ['id', 'company_id', 'branchname', 'branch_address'];
const COMPANY_FIELDS = ['id', 'companyname', 'business_style'];
const lookupCache = new Map();

function toJson(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

function parseDoc(doc) {
    const fields = doc?.fields || {};
    const row = {};
    Object.keys(fields).forEach((key) => {
        row[key] = getValue(fields[key]);
    });
    row._docPath = doc?.name || '';
    row._docId = String(doc?.name || '').split('/').pop() || '';
    return row;
}

function toFirestoreValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === 'boolean') return { booleanValue: value };
    return { stringValue: String(value) };
}

async function runQuery(structuredQuery) {
    const response = await fetch(`${BASE_URL}:runQuery?key=${encodeURIComponent(MARGABASE_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json().catch(() => []);
    if (!response.ok || payload?.error || payload?.[0]?.error) {
        throw new Error(payload?.error?.message || payload?.[0]?.error?.message || `Margabase query failed (${response.status})`);
    }
    return Array.isArray(payload)
        ? payload.map((row) => row.document).filter(Boolean).map(parseDoc)
        : [];
}

async function queryEquals(collectionId, fieldPath, value, fieldMask = []) {
    if (value === null || value === undefined || value === '') return [];
    const structuredQuery = {
        from: [{ collectionId }],
        where: {
            fieldFilter: {
                field: { fieldPath },
                op: 'EQUAL',
                value: toFirestoreValue(value)
            }
        }
    };
    if (fieldMask.length) {
        structuredQuery.select = { fields: fieldMask.map((selectedField) => ({ fieldPath: selectedField })) };
    }
    return runQuery(structuredQuery);
}

async function getById(collectionId, id, fieldMask = []) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;
    const cacheKey = `${collectionId}:${cleanId}:${fieldMask.join('|')}`;
    if (lookupCache.has(cacheKey)) return lookupCache.get(cacheKey);
    const numeric = /^\d+$/.test(cleanId) ? Number(cleanId) : cleanId;
    const rows = await queryEquals(collectionId, 'id', numeric, fieldMask).catch(() => []);
    const row = rows[0] || null;
    lookupCache.set(cacheKey, row);
    return row;
}

function normalizeInvoice(value) {
    return String(value || '').trim();
}

function parseInvoices(raw) {
    return Array.from(new Set(String(raw || '')
        .split(/[^0-9A-Za-z_-]+/g)
        .map(normalizeInvoice)
        .filter(Boolean)));
}

function invoiceValues(invoiceNo) {
    const values = [invoiceNo];
    if (/^\d+$/.test(invoiceNo)) values.push(Number(invoiceNo));
    return values;
}

function uniqueRows(rows = []) {
    const byKey = new Map();
    rows.forEach((row) => {
        const key = row?._docPath || row?._docId || JSON.stringify(row);
        if (key && !byKey.has(key)) byKey.set(key, row);
    });
    return Array.from(byKey.values());
}

async function queryInvoiceAcrossFields(collectionId, fieldPaths, invoiceNo, fieldMask) {
    const results = [];
    for (const fieldPath of fieldPaths) {
        for (const value of invoiceValues(invoiceNo)) {
            const docs = await queryEquals(collectionId, fieldPath, value, fieldMask).catch((error) => {
                console.warn(`Unable to query ${collectionId}.${fieldPath}=${value}:`, error.message);
                return [];
            });
            results.push(...docs);
        }
    }
    return uniqueRows(results);
}

function firstValue(row, keys) {
    for (const key of keys) {
        const value = row?.[key];
        const text = String(value ?? '').trim();
        if (value !== null && value !== undefined && text && !/^undefined(?:\s|$)/i.test(text)) return value;
    }
    return '';
}

function amountOfBilling(row) {
    return Number(row?.totalamount || 0) || Number(row?.amount || 0) || Number(row?.totalamount2 || 0) || Number(row?.amount2 || 0) || 0;
}

function amountOfPayment(row) {
    return Number(row?.invoice_amt || 0) || Number(row?.amount || 0) || 0;
}

function compactSchedule(row) {
    return {
        doc_id: row._docId,
        status: firstValue(row, ['status']),
        purpose: firstValue(row, ['purpose', 'purpose_id']),
        schedule_date: firstValue(row, ['schedule_date']),
        schedule_time: firstValue(row, ['schedule_time']),
        date_finished: firstValue(row, ['date_finished']),
        assigned_to: firstValue(row, ['assigned_to', 'assigned', 'field_billing_assigned_staff_name']),
        field_received_by: firstValue(row, ['field_billing_received_by']),
        field_received_date: firstValue(row, ['field_billing_date']),
        field_received_time: firstValue(row, ['field_billing_time']),
        remarks: firstValue(row, ['remarks'])
    };
}

function compactHistory(row) {
    return {
        doc_id: row._docId,
        date: firstValue(row, ['date_created', 'call_date', 'followup_date']),
        status: firstValue(row, ['status']),
        remarks: firstValue(row, ['remarks']),
        encoded_by: firstValue(row, ['encoded_by', 'created_by']),
        collection_id: firstValue(row, ['collection_id'])
    };
}

async function resolveBillingLabel(billingRows = []) {
    const existingCustomer = firstValue(billingRows.find((row) => firstValue(row, ['company_name'])), ['company_name']);
    const existingBranch = firstValue(billingRows.find((row) => firstValue(row, ['branch_name'])), ['branch_name']);
    if (existingCustomer || existingBranch) {
        return { customer: existingCustomer, branch: existingBranch, serial_number: firstValue(billingRows[0], ['serial_number']) };
    }

    for (const row of billingRows) {
        const contractMainId = firstValue(row, ['contractmain_id']);
        const contractMain = await getById('tbl_contractmain', contractMainId, CONTRACT_FIELDS);
        const contractDep = await getById('tbl_contractdep', firstValue(contractMain, ['contract_id']), CONTRACT_DEP_FIELDS);
        const contractBranch = await getById('tbl_branchinfo', firstValue(contractDep, ['branch_id']) || firstValue(contractMain, ['contract_id']), BRANCH_FIELDS);
        const contractCompany = await getById('tbl_companylist', firstValue(contractBranch, ['company_id']), COMPANY_FIELDS);
        if (contractCompany || contractBranch) {
            const baseBranchName = firstValue(contractBranch, ['branchname']);
            const departmentName = firstValue(contractDep, ['departmentname']);
            const branchName = departmentName && baseBranchName && !baseBranchName.toLowerCase().includes(String(departmentName).toLowerCase())
                ? `${baseBranchName} - ${departmentName}`
                : baseBranchName;
            return {
                customer: firstValue(contractCompany, ['companyname', 'business_style']),
                branch: branchName,
                serial_number: firstValue(row, ['serial_number']),
                machine: firstValue(row, ['machine_label'])
            };
        }

        const machineId = firstValue(row, ['machine_id']) || firstValue(contractMain, ['machine_id', 'mach_id']);
        const machine = await getById('tbl_machine', machineId, MACHINE_FIELDS);
        const branch = await getById('tbl_branchinfo', firstValue(machine, ['client_id']), BRANCH_FIELDS);
        const company = await getById('tbl_companylist', firstValue(branch, ['company_id']), COMPANY_FIELDS);
        const customerName = firstValue(company, ['companyname', 'business_style']);
        const branchName = firstValue(branch, ['branchname']);
        if (customerName || branchName) {
            return {
                customer: customerName,
                branch: branchName,
                serial_number: firstValue(row, ['serial_number']) || firstValue(machine, ['serial']),
                machine: firstValue(row, ['machine_label']) || firstValue(machine, ['description'])
            };
        }
    }
    return { customer: '', branch: '', serial_number: '', machine: '' };
}

async function deepSearchInvoice(invoiceNo) {
    const billingRows = await queryInvoiceAcrossFields(
        'tbl_billing',
        ['invoice_no', 'invoiceno', 'invoice_num', 'invoice_number', 'invoice_id', 'invoiceid'],
        invoiceNo,
        BILLING_FIELDS
    );
    const scheduleRows = await queryInvoiceAcrossFields(
        'tbl_schedule',
        ['invoice_no', 'invoice_num', 'invoice_id', 'invoiceno', 'invoice_number'],
        invoiceNo,
        SCHEDULE_FIELDS
    );
    const collectionRows = await queryInvoiceAcrossFields(
        'tbl_collectionhistory',
        ['invoice_num', 'invoice_id', 'invoice_no', 'invoiceno', 'account_ref', 'account_group_ref'],
        invoiceNo,
        COLLECTION_HISTORY_FIELDS
    );
    const paymentRows = await queryInvoiceAcrossFields(
        'tbl_paymentinfo',
        ['invoice_num', 'invoice_id', 'invoice_no', 'invoiceno'],
        invoiceNo,
        PAYMENT_FIELDS
    );

    const primaryBilling = billingRows
        .slice()
        .sort((left, right) => String(right._docId || '').localeCompare(String(left._docId || '')))[0] || {};
    const legacyReceivedDate = firstValue(primaryBilling, ['date_received']);
    const legacyReceivedBy = firstValue(primaryBilling, ['receivedby']);
    const scheduleReceipt = scheduleRows.find((row) => firstValue(row, ['field_billing_received_by', 'field_billing_date']));
    const labels = await resolveBillingLabel(billingRows);
    const receivedDate = firstValue(scheduleReceipt, ['field_billing_date']) || legacyReceivedDate;
    const receivedBy = firstValue(scheduleReceipt, ['field_billing_received_by']) || legacyReceivedBy;
    const receivedTime = firstValue(scheduleReceipt, ['field_billing_time']);
    const billingAmount = billingRows.reduce((sum, row) => sum + amountOfBilling(row), 0);
    const paymentAmount = paymentRows.reduce((sum, row) => sum + amountOfPayment(row), 0);

    return {
        invoice_no: invoiceNo,
        found: Boolean(billingRows.length || scheduleRows.length || collectionRows.length || paymentRows.length),
        customer: labels.customer || firstValue(scheduleRows[0], ['customer', 'client']),
        branch: labels.branch || firstValue(scheduleRows[0], ['branch']),
        serial_number: labels.serial_number,
        machine: labels.machine,
        billing_month: [firstValue(primaryBilling, ['month']), firstValue(primaryBilling, ['year'])].filter(Boolean).join(' '),
        amount: billingAmount,
        paid_amount: paymentAmount,
        balance_hint: Math.max(0, billingAmount - paymentAmount),
        receipt: {
            date_received: receivedDate,
            received_by: receivedBy,
            received_time: receivedTime,
            legacy_billing_date_received: legacyReceivedDate,
            legacy_billing_receivedby: legacyReceivedBy,
            legacy_isreceived: firstValue(primaryBilling, ['isreceived']),
            source: receivedBy || receivedDate
                ? (scheduleReceipt ? 'tbl_schedule.field_billing_*' : 'tbl_billing.date_received/receivedby')
                : ''
        },
        billing_rows: billingRows.map((row) => ({
            doc_id: row._docId,
            invoice_no: firstValue(row, ['invoice_no', 'invoiceno', 'invoice_num', 'invoice_number', 'invoice_id', 'invoiceid']),
            customer: firstValue(row, ['company_name']) || labels.customer,
            branch: firstValue(row, ['branch_name']) || labels.branch,
            serial_number: firstValue(row, ['serial_number']) || labels.serial_number,
            machine: firstValue(row, ['machine_label']) || labels.machine,
            contractmain_id: firstValue(row, ['contractmain_id']),
            month: firstValue(row, ['month']),
            year: firstValue(row, ['year']),
            amount: amountOfBilling(row),
            date_received: firstValue(row, ['date_received']),
            receivedby: firstValue(row, ['receivedby']),
            isreceived: firstValue(row, ['isreceived'])
        })),
        schedules: scheduleRows.map(compactSchedule),
        collection_history: collectionRows.map(compactHistory),
        payments: paymentRows.map((row) => ({
            doc_id: row._docId,
            date: firstValue(row, ['date_paid', 'payment_date']),
            status: firstValue(row, ['payment_status', 'status']),
            or_no: firstValue(row, ['or_num', 'or_number']),
            amount: amountOfPayment(row),
            remarks: firstValue(row, ['remarks'])
        }))
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return toJson(204, {});
    try {
        const body = event.body ? JSON.parse(event.body) : {};
        const rawInvoices = event.httpMethod === 'POST'
            ? (body.invoices || body.invoice || '')
            : (event.queryStringParameters?.invoices || event.queryStringParameters?.invoice || '');
        const invoices = parseInvoices(Array.isArray(rawInvoices) ? rawInvoices.join(',') : rawInvoices);
        if (!invoices.length) return toJson(400, { ok: false, error: 'Enter at least one invoice number.' });
        if (invoices.length > 80) return toJson(400, { ok: false, error: 'Deep Search is limited to 80 invoice numbers per run.' });

        const results = [];
        for (const invoiceNo of invoices) {
            results.push(await deepSearchInvoice(invoiceNo));
        }
        return toJson(200, {
            ok: true,
            searched_at: new Date().toISOString(),
            source: 'Margabase targeted invoice deep search',
            invoice_count: invoices.length,
            results
        });
    } catch (error) {
        console.error('billing-invoice-deep-search failed:', error);
        return toJson(500, { ok: false, error: error.message || 'Deep invoice search failed.' });
    }
};
