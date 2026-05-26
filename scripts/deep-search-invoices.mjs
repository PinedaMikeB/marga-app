#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE_URL = 'http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const BASE_URL = process.env.MARGABASE_DOCUMENTS_BASE_URL || process.env.MARGABASE_FIRESTORE_BASE_URL || DEFAULT_BASE_URL;
const API_KEY = process.env.MARGABASE_API_KEY || 'margabase-local';

const args = process.argv.slice(2);
const argValue = (name) => {
    const direct = args.find((arg) => arg === `--${name}`);
    if (direct) return '1';
    const withEquals = args.find((arg) => arg.startsWith(`--${name}=`));
    return withEquals ? withEquals.slice(name.length + 3) : '';
};

const BILLING_FIELDS = [
    'id', 'invoice_id', 'invoiceid', 'invoiceno', 'invoice_no', 'invoice_num', 'invoice_number',
    'company_name', 'branch_name', 'contractmain_id', 'machine_id', 'serial_number', 'machine_label',
    'month', 'year', 'amount', 'totalamount', 'amount2', 'totalamount2', 'dateprinted',
    'date_printed', 'invoice_date', 'invdate', 'datex', 'date_received', 'receivedby', 'isreceived'
];
const SCHEDULE_FIELDS = [
    'id', 'invoice_no', 'invoice_num', 'invoice_id', 'invoiceno', 'invoice_number', 'customer',
    'client', 'branch', 'schedule_date', 'schedule_time', 'date_finished', 'status', 'purpose',
    'purpose_id', 'assigned_to', 'assigned', 'field_billing_received_by', 'field_billing_date',
    'field_billing_time', 'field_billing_assigned_staff_name', 'remarks'
];
const HISTORY_FIELDS = [
    'id', 'invoice_num', 'invoice_id', 'invoice_no', 'invoiceno', 'account_ref', 'account_group_ref',
    'date_created', 'call_date', 'followup_date', 'remarks', 'status', 'collection_id',
    'encoded_by', 'created_by'
];
const PAYMENT_FIELDS = [
    'id', 'invoice_num', 'invoice_id', 'invoice_no', 'invoiceno', 'client', 'invoice_amt', 'amount',
    'or_num', 'or_number', 'date_paid', 'payment_date', 'payment_status', 'status', 'remarks'
];
const CONTRACT_FIELDS = ['id', 'contract_id', 'machine_id', 'mach_id'];
const MACHINE_FIELDS = ['id', 'client_id', 'description', 'serial', 'model_id'];
const BRANCH_FIELDS = ['id', 'company_id', 'branchname', 'branch_address'];
const COMPANY_FIELDS = ['id', 'companyname', 'business_style'];
const lookupCache = new Map();

function printHelp() {
    console.log(`Usage:
  node scripts/deep-search-invoices.mjs --invoices=121495,122509,123219
  node scripts/deep-search-invoices.mjs --file=/path/invoices.txt

Options:
  --out=/path/report.json   Optional JSON output path.
  --csv=/path/report.csv    Optional CSV output path.
  --no-files                Print only, do not create reports.

The script searches Margabase only and targets invoice fields in billing, schedule,
collection history, and payment tables.`);
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

function getInputInvoices() {
    const inline = argValue('invoices') || argValue('invoice');
    const file = argValue('file');
    const raw = [
        inline,
        file ? fs.readFileSync(path.resolve(file), 'utf8') : ''
    ].filter(Boolean).join('\n');
    return parseInvoices(raw);
}

function toFirestoreValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    return { stringValue: String(value) };
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

function parseDoc(doc) {
    const row = {};
    Object.entries(doc?.fields || {}).forEach(([key, field]) => {
        row[key] = getValue(field);
    });
    row._docPath = doc?.name || '';
    row._docId = String(doc?.name || '').split('/').pop() || '';
    return row;
}

async function runQuery(structuredQuery) {
    const response = await fetch(`${BASE_URL}:runQuery?key=${encodeURIComponent(API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json().catch(() => []);
    if (!response.ok || payload?.error || payload?.[0]?.error) {
        throw new Error(payload?.error?.message || payload?.[0]?.error?.message || `Margabase query failed (${response.status})`);
    }
    return Array.isArray(payload) ? payload.map((row) => row.document).filter(Boolean).map(parseDoc) : [];
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
    if (fieldMask.length) structuredQuery.select = { fields: fieldMask.map((fieldPath) => ({ fieldPath })) };
    return runQuery(structuredQuery);
}

async function getById(collectionId, id, fieldMask = []) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;
    const cacheKey = `${collectionId}:${cleanId}:${fieldMask.join('|')}`;
    if (lookupCache.has(cacheKey)) return lookupCache.get(cacheKey);
    const value = /^\d+$/.test(cleanId) ? Number(cleanId) : cleanId;
    const rows = await queryEquals(collectionId, 'id', value, fieldMask).catch(() => []);
    const row = rows[0] || null;
    lookupCache.set(cacheKey, row);
    return row;
}

function invoiceValues(invoiceNo) {
    const values = [invoiceNo];
    if (/^\d+$/.test(invoiceNo)) values.push(Number(invoiceNo));
    return values;
}

function uniqueRows(rows) {
    const byKey = new Map();
    rows.forEach((row) => {
        const key = row._docPath || row._docId || JSON.stringify(row);
        if (key && !byKey.has(key)) byKey.set(key, row);
    });
    return Array.from(byKey.values());
}

async function queryInvoice(collectionId, fields, invoiceNo, fieldMask) {
    const rows = [];
    for (const fieldPath of fields) {
        for (const value of invoiceValues(invoiceNo)) {
            const docs = await queryEquals(collectionId, fieldPath, value, fieldMask).catch((error) => {
                console.warn(`Warning: ${collectionId}.${fieldPath}=${value} failed: ${error.message}`);
                return [];
            });
            rows.push(...docs);
        }
    }
    return uniqueRows(rows);
}

function first(row, keys) {
    for (const key of keys) {
        const value = row?.[key];
        const text = String(value ?? '').trim();
        if (value !== null && value !== undefined && text && !/^undefined(?:\s|$)/i.test(text)) return value;
    }
    return '';
}

function billingAmount(row) {
    return Number(row?.totalamount || 0) || Number(row?.amount || 0) || Number(row?.totalamount2 || 0) || Number(row?.amount2 || 0) || 0;
}

function paymentAmount(row) {
    return Number(row?.invoice_amt || 0) || Number(row?.amount || 0) || 0;
}

async function resolveBillingLabel(billingRows = []) {
    const existingCustomer = first(billingRows.find((row) => first(row, ['company_name'])), ['company_name']);
    const existingBranch = first(billingRows.find((row) => first(row, ['branch_name'])), ['branch_name']);
    if (existingCustomer || existingBranch) {
        return { customer: existingCustomer, branch: existingBranch, serial_number: first(billingRows[0], ['serial_number']), machine: first(billingRows[0], ['machine_label']) };
    }
    for (const row of billingRows) {
        const contractMain = await getById('tbl_contractmain', first(row, ['contractmain_id']), CONTRACT_FIELDS);
        const machine = await getById('tbl_machine', first(row, ['machine_id']) || first(contractMain, ['machine_id', 'mach_id']), MACHINE_FIELDS);
        const branch = await getById('tbl_branchinfo', first(machine, ['client_id']), BRANCH_FIELDS);
        const company = await getById('tbl_companylist', first(branch, ['company_id']), COMPANY_FIELDS);
        const customer = first(company, ['companyname', 'business_style']);
        const branchName = first(branch, ['branchname']);
        if (customer || branchName) {
            return {
                customer,
                branch: branchName,
                serial_number: first(row, ['serial_number']) || first(machine, ['serial']),
                machine: first(row, ['machine_label']) || first(machine, ['description'])
            };
        }
    }
    return { customer: '', branch: '', serial_number: '', machine: '' };
}

async function deepSearch(invoiceNo) {
    const billing = await queryInvoice('tbl_billing', ['invoice_no', 'invoiceno', 'invoice_num', 'invoice_number', 'invoice_id', 'invoiceid'], invoiceNo, BILLING_FIELDS);
    const schedules = await queryInvoice('tbl_schedule', ['invoice_no', 'invoice_num', 'invoice_id', 'invoiceno', 'invoice_number'], invoiceNo, SCHEDULE_FIELDS);
    const history = await queryInvoice('tbl_collectionhistory', ['invoice_num', 'invoice_id', 'invoice_no', 'invoiceno', 'account_ref', 'account_group_ref'], invoiceNo, HISTORY_FIELDS);
    const payments = await queryInvoice('tbl_paymentinfo', ['invoice_num', 'invoice_id', 'invoice_no', 'invoiceno'], invoiceNo, PAYMENT_FIELDS);
    const primary = billing[0] || {};
    const scheduleReceipt = schedules.find((row) => first(row, ['field_billing_received_by', 'field_billing_date']));
    const labels = await resolveBillingLabel(billing);
    const amount = billing.reduce((sum, row) => sum + billingAmount(row), 0);
    const paid = payments.reduce((sum, row) => sum + paymentAmount(row), 0);
    return {
        invoice_no: invoiceNo,
        found: Boolean(billing.length || schedules.length || history.length || payments.length),
        customer: labels.customer || first(primary, ['company_name']) || first(schedules[0], ['customer', 'client']),
        branch: labels.branch || first(primary, ['branch_name']) || first(schedules[0], ['branch']),
        serial_number: labels.serial_number,
        machine: labels.machine,
        billing_month: [first(primary, ['month']), first(primary, ['year'])].filter(Boolean).join(' '),
        amount,
        paid_amount: paid,
        balance_hint: Math.max(0, amount - paid),
        date_received: first(scheduleReceipt, ['field_billing_date']) || first(primary, ['date_received']),
        received_by: first(scheduleReceipt, ['field_billing_received_by']) || first(primary, ['receivedby']),
        receipt_time: first(scheduleReceipt, ['field_billing_time']),
        receipt_source: scheduleReceipt ? 'tbl_schedule.field_billing_*' : (first(primary, ['date_received', 'receivedby']) ? 'tbl_billing.date_received/receivedby' : ''),
        billing_rows: billing,
        schedules,
        collection_history: history,
        payments
    };
}

function csvEscape(value) {
    const text = String(value ?? '');
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(rows, filePath) {
    const header = ['invoice_no', 'found', 'customer', 'branch', 'billing_month', 'amount', 'paid_amount', 'balance_hint', 'date_received', 'received_by', 'receipt_source', 'schedule_count', 'history_count', 'payment_count'];
    const csv = [
        header.join(','),
        ...rows.map((row) => header.map((key) => {
            if (key === 'schedule_count') return row.schedules.length;
            if (key === 'history_count') return row.collection_history.length;
            if (key === 'payment_count') return row.payments.length;
            return csvEscape(row[key]);
        }).join(','))
    ].join('\n');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${csv}\n`);
}

async function main() {
    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        return;
    }
    const invoices = getInputInvoices();
    if (!invoices.length) {
        printHelp();
        process.exitCode = 1;
        return;
    }
    const startedAt = new Date();
    const results = [];
    for (const invoiceNo of invoices) {
        console.error(`Searching invoice ${invoiceNo}...`);
        results.push(await deepSearch(invoiceNo));
    }
    const report = {
        ok: true,
        searched_at: startedAt.toISOString(),
        source: BASE_URL,
        invoice_count: invoices.length,
        results
    };

    console.table(results.map((row) => ({
        invoice: row.invoice_no,
        found: row.found,
        customer: row.customer,
        branch: row.branch,
        amount: row.amount,
        paid: row.paid_amount,
        received_date: row.date_received,
        received_by: row.received_by,
        notes: row.collection_history.length
    })));

    if (!argValue('no-files')) {
        const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
        const outPath = path.resolve(argValue('out') || path.join(ROOT_DIR, 'reports', `deep-invoice-search-${stamp}.json`));
        const csvPath = path.resolve(argValue('csv') || path.join(ROOT_DIR, 'reports', `deep-invoice-search-${stamp}.csv`));
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
        writeCsv(results, csvPath);
        console.error(`JSON report: ${outPath}`);
        console.error(`CSV report: ${csvPath}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
