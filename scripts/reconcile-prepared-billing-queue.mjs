#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
const DEFAULT_PSQL_BIN = process.env.PSQL_BIN || '/opt/homebrew/opt/postgresql@16/bin/psql';
const DEFAULT_DB_HOST = process.env.PGHOST || '127.0.0.1';
const DEFAULT_DB_PORT = process.env.PGPORT || '5432';
const DEFAULT_DB_NAME = process.env.PGDATABASE || 'margabase';
const DEFAULT_DB_USER = process.env.PGUSER || 'margabase_admin';
const DEFAULT_QUEUE_START_YMD = process.env.OPENCLAW_BILLING_SAVED_QUEUE_START_YMD || '2026-05-25';

const args = process.argv.slice(2);

function argValue(name, fallback = '') {
    const direct = args.find((arg) => arg === `--${name}`);
    if (direct) return '1';
    const withEquals = args.find((arg) => arg.startsWith(`--${name}=`));
    return withEquals ? withEquals.slice(name.length + 3) : fallback;
}

function hasFlag(name) {
    return args.includes(`--${name}`);
}

function printHelp() {
    console.log(`Usage:
  node scripts/reconcile-prepared-billing-queue.mjs
  node scripts/reconcile-prepared-billing-queue.mjs --out=reports/prepared-billing-queue.json
  node scripts/reconcile-prepared-billing-queue.mjs --targets=131216:2026-05,131505:2026-06 --printed-by="Mike" --apply

Options:
  --queue-start=YYYY-MM-DD   Queue window start. Default: ${DEFAULT_QUEUE_START_YMD}
  --as-of=YYYY-MM-DD         Inclusive Manila date for queue analysis. Default: today
  --out=FILE                 Optional JSON report output path
  --targets=INV[:YYYY-MM]    Comma-separated manual backfill targets
  --printed-at=ISO           Printed timestamp to backfill. Default: now
  --printed-by=NAME          Required with --apply
  --printed-by-id=ID         Optional staff ID for backfill
  --channel=VALUE            Print channel label. Default: manual_reconcile
  --note=TEXT                Optional note saved on the billing rows
  --apply                    Actually patch matching tbl_billing rows

The report is read-only by default. Use --apply only after verifying the target
invoice groups really were printed and need a manual print-audit backfill.`);
}

function formatManilaDate(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(date);
}

function sqlQuote(value) {
    return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function parseTargets(raw) {
    return String(raw || '')
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => {
            const [invoiceNoRaw, monthKeyRaw = ''] = token.split(':');
            const invoiceNo = String(invoiceNoRaw || '').trim();
            const monthKey = String(monthKeyRaw || '').trim();
            if (!invoiceNo) return null;
            if (monthKey && !/^\d{4}-\d{2}$/.test(monthKey)) {
                throw new Error(`Invalid month key for target "${token}". Use INV:YYYY-MM.`);
            }
            return { invoice_no: invoiceNo, month_key: monthKey };
        })
        .filter(Boolean);
}

function toSqlDateTime(isoValue) {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid printed timestamp: ${isoValue}`);
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function ensureDirFor(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
}

function resolveOutputPath(rawPath, asOfYmd) {
    if (rawPath) return path.resolve(ROOT_DIR, rawPath);
    return path.join(REPORTS_DIR, `prepared-billing-queue-${asOfYmd}.json`);
}

function runPsql(sql) {
    const output = execFileSync(DEFAULT_PSQL_BIN, [
        '-h', DEFAULT_DB_HOST,
        '-p', DEFAULT_DB_PORT,
        '-U', DEFAULT_DB_USER,
        '-d', DEFAULT_DB_NAME,
        '-X',
        '-q',
        '-t',
        '-A',
        '-P', 'pager=off',
        '-c', sql
    ], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        env: process.env
    });
    return String(output || '').trim();
}

function buildQueueCte(queueStartYmd, asOfYmd) {
    return `
with billing as (
    select
        doc_id,
        trim(coalesce(data->>'invoice_no', data->>'invoiceno', data->>'invoice_id', data->>'invoiceid', '')) as invoice_no,
        trim(coalesce(data->>'year', '')) as year_text,
        trim(coalesce(data->>'month', '')) as month_text,
        coalesce(
            nullif(data->>'saved_at', ''),
            nullif(data->>'prepared_at', ''),
            nullif(data->>'dateprinted', ''),
            nullif(data->>'date_printed', ''),
            nullif(data->>'invoice_date', ''),
            nullif(data->>'invdate', ''),
            nullif(data->>'datex', ''),
            nullif(data->>'tmestamp', ''),
            nullif(data->>'updated_at', '')
        ) as saved_raw,
        coalesce(
            nullif(data->>'billing_printed_at', ''),
            nullif(data->>'actual_printed_at', ''),
            nullif(data->>'printed_at', '')
        ) as printed_raw,
        case
            when coalesce((data->>'totalamount')::numeric, 0) > 0 then coalesce((data->>'totalamount')::numeric, 0)
            else coalesce((data->>'amount')::numeric, 0)
        end
        +
        case
            when coalesce((data->>'totalamount2')::numeric, 0) > 0 then coalesce((data->>'totalamount2')::numeric, 0)
            else coalesce((data->>'amount2')::numeric, 0)
        end as amount_total,
        coalesce(data->>'company_name', '') as company_name,
        coalesce(data->>'branch_name', '') as branch_name,
        coalesce(data->>'prepared_by', data->>'saved_by', data->>'printed_by', data->>'updated_by', '') as prepared_by,
        coalesce(data->>'prepared_by_id', data->>'saved_by_id', '') as prepared_by_id,
        coalesce(data->>'schedule_assigned_staff_name', '') as schedule_assigned_staff_name,
        coalesce(data->>'schedule_assigned_staff_id', '') as schedule_assigned_staff_id
    from app_meta.firestore_documents
    where collection = 'tbl_billing'
),
queue as (
    select
        *,
        case
            when year_text ~ '^[0-9]{4}$' and month_text <> ''
                then to_char(to_date(year_text || '-' || month_text || '-01', 'YYYY-Month-DD'), 'YYYY-MM')
            else ''
        end as month_key,
        substring(saved_raw from 1 for 10) as saved_ymd
    from billing
    where invoice_no <> ''
      and printed_raw is null
      and coalesce(amount_total, 0) > 0
      and substring(saved_raw from 1 for 10) >= ${sqlQuote(queueStartYmd)}
      and substring(saved_raw from 1 for 10) <= ${sqlQuote(asOfYmd)}
),
grouped as (
    select
        invoice_no,
        year_text,
        month_text,
        month_key,
        min(saved_raw) as first_saved,
        max(saved_raw) as last_saved,
        round(sum(amount_total)::numeric, 2) as amount_total,
        count(*) as doc_rows,
        max(company_name) as company_name,
        max(prepared_by) as prepared_by,
        max(prepared_by_id) as prepared_by_id,
        max(schedule_assigned_staff_name) as schedule_assigned_staff_name,
        max(schedule_assigned_staff_id) as schedule_assigned_staff_id
    from queue
    group by invoice_no, year_text, month_text, month_key
)`;
}

function buildReportSql(queueStartYmd, asOfYmd) {
    return `
${buildQueueCte(queueStartYmd, asOfYmd)}
select json_build_object(
    'generated_at', now()::text,
    'queue_start_date', ${sqlQuote(queueStartYmd)},
    'as_of_date', ${sqlQuote(asOfYmd)},
    'grouped_count', (select count(*) from grouped),
    'amount_total', coalesce((select round(sum(amount_total)::numeric, 2) from grouped), 0),
    'underlying_doc_rows', (select count(*) from queue),
    'months', coalesce((
        select json_agg(json_build_object(
            'month_key', month_key,
            'month_label', trim(to_char(to_date(month_key || '-01', 'YYYY-MM-DD'), 'Month YYYY')),
            'invoice_count', invoice_count,
            'amount_total', amount_total
        ) order by month_key)
        from (
            select month_key, count(*) as invoice_count, round(sum(amount_total)::numeric, 2) as amount_total
            from grouped
            group by month_key
        ) month_summary
    ), '[]'::json),
    'invoice_groups', coalesce((
        select json_agg(json_build_object(
            'invoice_no', invoice_no,
            'year', year_text,
            'month', month_text,
            'month_key', month_key,
            'first_saved', first_saved,
            'last_saved', last_saved,
            'amount_total', amount_total,
            'doc_rows', doc_rows,
            'company_name', company_name,
            'prepared_by', prepared_by,
            'prepared_by_id', prepared_by_id,
            'schedule_assigned_staff_name', schedule_assigned_staff_name,
            'schedule_assigned_staff_id', schedule_assigned_staff_id
        ) order by amount_total desc, last_saved desc, invoice_no asc)
        from grouped
    ), '[]'::json)
)::text;`;
}

function buildApplySql({ queueStartYmd, asOfYmd, targets, patchJson }) {
    const targetRows = targets.map((target) => `(${sqlQuote(target.invoice_no)}, ${sqlQuote(target.month_key)})`).join(',\n        ');
    return `
with targets(invoice_no, month_key) as (
    values
        ${targetRows}
),
matching as (
    select fd.doc_id
    from app_meta.firestore_documents fd
    join targets t
      on trim(coalesce(fd.data->>'invoice_no', fd.data->>'invoiceno', fd.data->>'invoice_id', fd.data->>'invoiceid', '')) = t.invoice_no
    where fd.collection = 'tbl_billing'
      and coalesce(
            nullif(fd.data->>'billing_printed_at', ''),
            nullif(fd.data->>'actual_printed_at', ''),
            nullif(fd.data->>'printed_at', '')
          ) is null
      and coalesce(
            nullif(fd.data->>'saved_at', ''),
            nullif(fd.data->>'prepared_at', ''),
            nullif(fd.data->>'dateprinted', ''),
            nullif(fd.data->>'date_printed', ''),
            nullif(fd.data->>'invoice_date', ''),
            nullif(fd.data->>'invdate', ''),
            nullif(fd.data->>'datex', ''),
            nullif(fd.data->>'tmestamp', ''),
            nullif(fd.data->>'updated_at', '')
          ) is not null
      and substring(
            coalesce(
                nullif(fd.data->>'saved_at', ''),
                nullif(fd.data->>'prepared_at', ''),
                nullif(fd.data->>'dateprinted', ''),
                nullif(fd.data->>'date_printed', ''),
                nullif(fd.data->>'invoice_date', ''),
                nullif(fd.data->>'invdate', ''),
                nullif(fd.data->>'datex', ''),
                nullif(fd.data->>'tmestamp', ''),
                nullif(fd.data->>'updated_at', '')
            ) from 1 for 10
          ) >= ${sqlQuote(queueStartYmd)}
      and substring(
            coalesce(
                nullif(fd.data->>'saved_at', ''),
                nullif(fd.data->>'prepared_at', ''),
                nullif(fd.data->>'dateprinted', ''),
                nullif(fd.data->>'date_printed', ''),
                nullif(fd.data->>'invoice_date', ''),
                nullif(fd.data->>'invdate', ''),
                nullif(fd.data->>'datex', ''),
                nullif(fd.data->>'tmestamp', ''),
                nullif(fd.data->>'updated_at', '')
            ) from 1 for 10
          ) <= ${sqlQuote(asOfYmd)}
      and (
            t.month_key = ''
            or (
                trim(coalesce(fd.data->>'year', '')) ~ '^[0-9]{4}$'
                and trim(coalesce(fd.data->>'month', '')) <> ''
                and to_char(to_date(trim(coalesce(fd.data->>'year', '')) || '-' || trim(coalesce(fd.data->>'month', '')) || '-01', 'YYYY-Month-DD'), 'YYYY-MM') = t.month_key
            )
          )
),
updated as (
    update app_meta.firestore_documents fd
       set data = fd.data || ${sqlQuote(JSON.stringify(patchJson))}::jsonb
     where fd.collection = 'tbl_billing'
       and fd.doc_id in (select doc_id from matching)
     returning fd.doc_id
)
select json_build_object(
    'matched_rows', (select count(*) from matching),
    'updated_rows', (select count(*) from updated)
)::text;`;
}

function writeReport(filePath, report) {
    ensureDirFor(filePath);
    fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
    if (hasFlag('help') || hasFlag('h')) {
        printHelp();
        process.exit(0);
    }

    const queueStartYmd = argValue('queue-start', DEFAULT_QUEUE_START_YMD);
    const asOfYmd = argValue('as-of', formatManilaDate());
    const outPath = resolveOutputPath(argValue('out', ''), asOfYmd.replace(/-/g, ''));
    const apply = hasFlag('apply');
    const targets = parseTargets(argValue('targets', ''));

    const report = JSON.parse(runPsql(buildReportSql(queueStartYmd, asOfYmd)));
    writeReport(outPath, report);

    console.log(`Prepared billing queue as of ${asOfYmd}`);
    console.log(`Queue start: ${queueStartYmd}`);
    console.log(`Grouped invoices: ${report.grouped_count}`);
    console.log(`Underlying billing rows: ${report.underlying_doc_rows}`);
    console.log(`Amount total: PHP ${Number(report.amount_total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`Report: ${outPath}`);

    if (!apply) return;

    if (!targets.length) {
        throw new Error('No targets supplied. Use --targets=INV[:YYYY-MM],INV2[:YYYY-MM].');
    }

    const printedBy = String(argValue('printed-by', '')).trim();
    if (!printedBy) {
        throw new Error('--printed-by is required with --apply.');
    }

    const printedAt = String(argValue('printed-at', new Date().toISOString())).trim();
    const printedById = String(argValue('printed-by-id', '')).trim();
    const channel = String(argValue('channel', 'manual_reconcile')).trim() || 'manual_reconcile';
    const note = String(argValue('note', 'Manual prepared-invoice queue reconciliation')).trim();
    const patchJson = {
        billing_printed_at: printedAt,
        billing_printed_date: toSqlDateTime(printedAt),
        billing_printed_by: printedBy,
        billing_print_channel: channel,
        billing_print_note: note,
        billing_print_count: 1,
        updated_at: new Date().toISOString()
    };
    if (printedById) patchJson.billing_printed_by_id = printedById;

    const result = JSON.parse(runPsql(buildApplySql({
        queueStartYmd,
        asOfYmd,
        targets,
        patchJson
    })));

    console.log(`Applied manual print audit patch to ${result.updated_rows} billing row(s) across ${targets.length} target(s).`);
    if (!Number(result.updated_rows || 0)) {
        console.log('No rows were updated. Recheck the invoice numbers and month keys in the report.');
    }
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
