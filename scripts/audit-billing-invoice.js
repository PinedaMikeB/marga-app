#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.MARGA_AUDIT_BASE_URL
    || 'https://app.marga.biz/margabase-api/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const DEFAULT_API_KEY = process.env.MARGA_AUDIT_API_KEY || 'margabase-local';

const INVOICE_FIELDS = [
    'invoice_no',
    'invoiceno',
    'invoice_num',
    'invoice_number',
    'invoice_id',
    'invoiceid'
];

function usage() {
    console.log('Usage: node scripts/audit-billing-invoice.js <invoice-no> [--verbose] [--json]');
}

function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function getFieldValue(field) {
    if (!field || typeof field !== 'object') return null;
    if (field.integerValue !== undefined) return Number(field.integerValue);
    if (field.doubleValue !== undefined) return Number(field.doubleValue);
    if (field.booleanValue !== undefined) return Boolean(field.booleanValue);
    if (field.stringValue !== undefined) return field.stringValue;
    if (field.timestampValue !== undefined) return field.timestampValue;
    if (field.nullValue !== undefined) return null;
    return null;
}

function getNumber(fields, key) {
    const value = getFieldValue(fields[key]);
    if (value === null || value === undefined || value === '') return 0;
    return Number(value) || 0;
}

function getString(fields, key) {
    const value = getFieldValue(fields[key]);
    return value === null || value === undefined ? '' : String(value).trim();
}

async function runQuery(baseUrl, apiKey, structuredQuery) {
    const response = await fetch(`${baseUrl}:runQuery?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json().catch(() => []);
    if (!response.ok || payload?.error || payload?.[0]?.error) {
        throw new Error(payload?.error?.message || payload?.[0]?.error?.message || `Query failed (${response.status})`);
    }
    return Array.isArray(payload) ? payload.map((entry) => entry.document).filter(Boolean) : [];
}

async function queryInvoiceRows(baseUrl, apiKey, invoiceNo) {
    const values = /^\d+$/.test(invoiceNo) ? [invoiceNo, Number(invoiceNo)] : [invoiceNo];
    const docsByName = new Map();

    for (const fieldPath of INVOICE_FIELDS) {
        for (const value of values) {
            const valuePayload = typeof value === 'number'
                ? { integerValue: String(value) }
                : { stringValue: String(value) };
            const docs = await runQuery(baseUrl, apiKey, {
                from: [{ collectionId: 'tbl_billing' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath },
                        op: 'EQUAL',
                        value: valuePayload
                    }
                }
            });
            docs.forEach((doc) => {
                const name = String(doc.name || '').trim();
                if (name && !docsByName.has(name)) docsByName.set(name, doc);
            });
        }
    }

    return Array.from(docsByName.values());
}

function auditRows(docs) {
    const rows = docs.map((doc) => {
        const fields = doc.fields || {};
        const amount = roundMoney(getNumber(fields, 'totalamount') || getNumber(fields, 'amount'));
        const quotaAmount = roundMoney(getNumber(fields, 'quota_amount'));
        const succeedingAmount = roundMoney(getNumber(fields, 'succeeding_amount'));
        const quotaPages = getNumber(fields, 'quota_pages');
        const succeedingPages = getNumber(fields, 'succeeding_pages');
        const billedPages = getNumber(fields, 'billed_pages');
        const pageRate = getNumber(fields, 'page_rate');
        const succeedingRate = getNumber(fields, 'succeeding_page_rate') || pageRate;
        const expectedFromAmounts = roundMoney(quotaAmount + succeedingAmount);
        const expectedFromPages = roundMoney((quotaPages * pageRate) + (succeedingPages * succeedingRate));
        const expectedFromBilledPages = roundMoney(billedPages * pageRate);
        return {
            docId: String(doc.name || '').split('/').pop() || '',
            invoiceNo: getString(fields, 'invoice_no') || getString(fields, 'invoiceno') || getString(fields, 'invoiceid'),
            companyName: getString(fields, 'company_name'),
            branchName: getString(fields, 'branch_name'),
            serialNumber: getString(fields, 'serial_number'),
            machineLabel: getString(fields, 'machine_label') || getString(fields, 'machine_model'),
            formula: getString(fields, 'billing_formula'),
            monthlyQuota: getNumber(fields, 'monthly_quota'),
            pageRate,
            succeedingRate,
            totalPages: getNumber(fields, 'total_pages'),
            spoilagePages: getNumber(fields, 'spoilage_pages'),
            billedPages,
            quotaPages,
            succeedingPages,
            quotaAmount,
            succeedingAmount,
            amount,
            expectedFromAmounts,
            expectedFromPages,
            expectedFromBilledPages,
            deltaAmounts: roundMoney(amount - expectedFromAmounts),
            deltaPages: roundMoney(amount - expectedFromPages),
            deltaBilledPages: roundMoney(amount - expectedFromBilledPages)
        };
    });

    const mismatches = rows.filter((row) => (
        Math.abs(row.deltaAmounts) > 0.01
        || Math.abs(row.deltaPages) > 0.01
        || Math.abs(row.deltaBilledPages) > 0.01
    ));

    const totals = rows.reduce((acc, row) => {
        acc.amount = roundMoney(acc.amount + row.amount);
        acc.expectedFromAmounts = roundMoney(acc.expectedFromAmounts + row.expectedFromAmounts);
        acc.quotaAmount = roundMoney(acc.quotaAmount + row.quotaAmount);
        acc.succeedingAmount = roundMoney(acc.succeedingAmount + row.succeedingAmount);
        acc.totalPages += row.totalPages;
        acc.spoilagePages += row.spoilagePages;
        acc.billedPages += row.billedPages;
        acc.quotaPages += row.quotaPages;
        acc.succeedingPages += row.succeedingPages;
        return acc;
    }, {
        amount: 0,
        expectedFromAmounts: 0,
        quotaAmount: 0,
        succeedingAmount: 0,
        totalPages: 0,
        spoilagePages: 0,
        billedPages: 0,
        quotaPages: 0,
        succeedingPages: 0
    });

    const formulas = rows.reduce((acc, row) => {
        const key = row.formula || '(blank)';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    return {
        count: rows.length,
        mismatchCount: mismatches.length,
        totals: {
            ...totals,
            quotaPages: roundMoney(totals.quotaPages),
            succeedingPages: roundMoney(totals.succeedingPages)
        },
        formulas,
        mismatches,
        rows
    };
}

async function main() {
    const args = process.argv.slice(2);
    const invoiceNo = String(args.find((arg) => !arg.startsWith('--')) || '').trim();
    const verbose = args.includes('--verbose');
    const asJson = args.includes('--json');

    if (!invoiceNo) {
        usage();
        process.exitCode = 1;
        return;
    }

    const docs = await queryInvoiceRows(DEFAULT_BASE_URL, DEFAULT_API_KEY, invoiceNo);
    const report = auditRows(docs);

    if (asJson) {
        console.log(JSON.stringify({
            invoiceNo,
            baseUrl: DEFAULT_BASE_URL,
            ...report,
            rows: verbose ? report.rows : undefined
        }, null, 2));
        return;
    }

    console.log(`Invoice ${invoiceNo}`);
    console.log(`Rows: ${report.count}`);
    console.log(`Formula mismatches: ${report.mismatchCount}`);
    console.log(`Saved total: ${report.totals.amount.toFixed(2)}`);
    console.log(`Expected total: ${report.totals.expectedFromAmounts.toFixed(2)}`);
    console.log(`Quota amount total: ${report.totals.quotaAmount.toFixed(2)}`);
    console.log(`Succeeding amount total: ${report.totals.succeedingAmount.toFixed(2)}`);
    console.log(`Quota pages total: ${report.totals.quotaPages.toFixed(2)}`);
    console.log(`Succeeding pages total: ${report.totals.succeedingPages.toFixed(2)}`);
    console.log(`Billed pages total: ${report.totals.billedPages}`);
    console.log(`Spoilage pages total: ${report.totals.spoilagePages}`);
    console.log('Formulas:', JSON.stringify(report.formulas));

    if (report.mismatches.length) {
        console.log('\nMismatches:');
        report.mismatches.forEach((row) => {
            console.log([
                row.branchName || '(no branch)',
                row.machineLabel || '(no model)',
                row.serialNumber || '(no serial)',
                `saved=${row.amount.toFixed(2)}`,
                `expected=${row.expectedFromAmounts.toFixed(2)}`,
                `delta=${row.deltaAmounts.toFixed(2)}`
            ].join(' | '));
        });
    } else if (verbose) {
        console.log('\nRows:');
        report.rows.forEach((row) => {
            console.log([
                row.branchName || '(no branch)',
                row.machineLabel || '(no model)',
                row.serialNumber || '(no serial)',
                row.formula || '(blank)',
                `quota_pages=${row.quotaPages.toFixed(2)}`,
                `succ_pages=${row.succeedingPages.toFixed(2)}`,
                `saved=${row.amount.toFixed(2)}`
            ].join(' | '));
        });
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
