#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_CSV = '/Users/mike/Downloads/attachments/cbs-envelope-print.csv';
const SOURCE = 'cbs-envelope-print-csv-20260529';
const REPORT_DIR = path.resolve('reports');
const PSQL = process.env.PSQL_BIN || '/opt/homebrew/opt/postgresql@16/bin/psql';
const DB_ARGS = [
    '-h', process.env.MARGABASE_PGHOST || '127.0.0.1',
    '-p', process.env.MARGABASE_PGPORT || '5432',
    '-U', process.env.MARGABASE_PGUSER || 'margabase_admin',
    '-d', process.env.MARGABASE_PGDATABASE || 'margabase',
    '-P', 'pager=off',
    '-X',
    '-v', 'ON_ERROR_STOP=1'
];

const EXACT_TARGET_RULES = [
    ['china bank savings inc acquired asset', ['acquired asset']],
    ['china bank savings inc auto loans butuan', ['auto loans butuan']],
    ['china bank savings inc auto loans davao business center', ['auto loans davao business center']],
    ['china bank savings inc auto loans gen san branch', ['auto loans gen', 'general santos']],
    ['china bank savings inc auto loans iloilo', ['auto loans iloilo']],
    ['china bank savings inc auto loans san fernando pampanga', ['auto loans san fernando']],
    ['china bank savings inc cbs antipolo branch', ['antipolo branch']],
    ['china bank savings inc cbs bacolod', ['bacolod']],
    ['china bank savings inc cbs pampanga', ['pampanga']],
    ['china bank savings inc cbs pasig branch', ['pasig']],
    ['china bank savings inc cbs subic', ['subic']],
    ['china bank savings inc consumer credit division homeloan', ['consumer credit', 'homeloan']],
    ['china bank savings inc consumer lending group colored printer', ['consumer lending group', 'clg']],
    ['china bank savings inc finance dept', ['finance']],
    ['china bank savings inc fund management dept', ['fund management']],
    ['china bank savings inc housing loan cavite', ['housing loan cavite']],
    ['china bank savings inc housing loan iloilo', ['housing loan iloilo']],
    ['china bank savings inc housing loans bacolod sales office', ['housing loans bacolod']],
    ['china bank savings inc housing loans rbc davao', ['housing loans rbc davao']],
    ['china bank savings inc loan operation division', ['loan operation division']],
    ['china bank savings inc mindanao business center davao', ['mindanao business center davao']],
    ['china bank savings inc personal loans underwriting dept', ['personal loans underwriting']],
    ['china bank savings inc recon accounting', ['recon accounting']],
    ['china bank savings inc slg luzon north lending dept', ['plaridel']],
    ['china bank savings inc slg lld lnld 1 urdaneta', ['urdaneta']],
    ['china bank savings inc sme in house credit verification unit', ['sme in house credit verification']],
    ['china bank savings inc ssd consumer security', ['consumer securities']],
    ['china bank savings inc ssd scu', ['ssd scu']]
];
const EXACT_TARGETS = new Map();
const EXACT_DOC_IDS = new Map();

function parseArgs(argv) {
    return argv.slice(2).reduce((acc, arg) => {
        if (arg === '--apply') acc.apply = true;
        else if (arg === '--dry-run') acc.apply = false;
        else if (arg.startsWith('--csv=')) acc.csv = arg.slice('--csv='.length);
        return acc;
    }, { apply: false, csv: DEFAULT_CSV });
}

function runPsql(sql, { json = false } = {}) {
    const args = json
        ? [...DB_ARGS, '-t', '-A', '-c', sql]
        : [...DB_ARGS, '-c', sql];
    const result = spawnSync(PSQL, args, { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`psql failed:\n${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
}

function parseCsvLine(line) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];
        if (char === '"' && quoted && next === '"') {
            current += '"';
            i += 1;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells.map((cell) => cell.trim());
}

function readCsv(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    const headers = parseCsvLine(lines.shift()).map((header) => normalizeHeader(header));
    return lines.map((line, index) => {
        const cells = parseCsvLine(line);
        const row = { rowNumber: index + 2 };
        headers.forEach((header, cellIndex) => {
            row[header] = cells[cellIndex] || '';
        });
        return row;
    });
}

function normalizeHeader(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/\bdepartment\b/g, 'dept')
        .replace(/\bdivision\b/g, 'div')
        .replace(/\bbranch\b/g, 'br')
        .replace(/\bloans\b/g, 'loan')
        .replace(/\bchina\b|\bbank\b|\bsavings\b|\binc\b|\bincorporated\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

for (const [target, requiredPhrases] of EXACT_TARGET_RULES) {
    EXACT_TARGETS.set(normalizeText(target), requiredPhrases);
}

[
    ['china bank savings inc auto loans', ['1963']],
    ['china bank savings inc housing loan', ['194', '2198']],
    ['china bank savings inc personal loan dept', ['3423']],
    ['china bank savings inc personal loans underwriting dept', ['3142']],
    ['china bank savings inc recon accounting', ['192']],
    ['china bank savings bldg slg luzon north lending dept', ['2533']],
    ['china bank savings inc slg lld lnld 1 urdaneta', ['3337']],
    ['china bank savings inc sme in house credit verification unit', ['3246']]
].forEach(([target, docIds]) => {
    EXACT_DOC_IDS.set(normalizeText(target), docIds);
});

function tokens(value) {
    return normalizeText(value).split(' ').filter((token) => token && token.length > 1);
}

function scoreMatch(target, candidate) {
    const targetTokens = tokens(target);
    const candidateText = ` ${normalizeText(candidate)} `;
    if (!targetTokens.length) return 0;
    const hits = targetTokens.filter((token) => candidateText.includes(` ${token} `)).length;
    return hits / targetTokens.length;
}

function escapeSql(value) {
    return String(value ?? '').replace(/'/g, "''");
}

function loadBranchBillinfoRows() {
    const sql = `
select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
from (
    select
        bi.doc_id as billinfo_doc_id,
        bi.data as billinfo,
        br.doc_id as branch_doc_id,
        br.data as branch,
        co.doc_id as company_doc_id,
        co.data as company
    from app_meta.firestore_documents bi
    left join app_meta.firestore_documents br
        on br.collection = 'tbl_branchinfo'
       and br.doc_id = nullif(bi.data->>'branch_id', '')
    left join app_meta.firestore_documents co
        on co.collection = 'tbl_companylist'
       and co.doc_id = nullif(coalesce(bi.data->>'company_id', br.data->>'company_id'), '')
    where bi.collection = 'tbl_billinfo'
      and (
          lower(coalesce(co.data->>'companyname', '')) like '%china bank savings%'
          or lower(coalesce(br.data->>'branchname', '')) like '%china bank savings%'
          or lower(coalesce(bi.data->>'department', '')) like '%china bank savings%'
      )
      and lower(coalesce(br.data->>'branchname', '')) not like '~xx%'
) t;`;
    return JSON.parse(runPsql(sql, { json: true }) || '[]');
}

function branchLabel(row) {
    return [
        row.company?.companyname,
        row.branch?.branchname,
        row.billinfo?.department,
        row.billinfo?.address
    ].filter(Boolean).join(' ');
}

function branchDisplay(row) {
    return [
        row.company?.companyname || 'N/A',
        row.branch?.branchname || row.billinfo?.department || 'N/A'
    ].join(' - ');
}

function chooseMatches(csvRow, candidates) {
    const target = csvRow.to_company_and_department;
    const normalizedTarget = normalizeText(target);
    const exactDocIds = EXACT_DOC_IDS.get(normalizedTarget);
    if (exactDocIds?.length) {
        const exactMatches = candidates
            .filter((candidate) => exactDocIds.includes(String(candidate.billinfo_doc_id)))
            .map((candidate) => ({
                candidate,
                score: 1,
                requiredHit: true,
                label: branchLabel(candidate)
            }));
        return {
            matched: exactMatches,
            candidates: exactMatches.map((item) => ({
                score: 1,
                billinfoDocId: item.candidate.billinfo_doc_id,
                branchDocId: item.candidate.branch_doc_id,
                label: branchDisplay(item.candidate)
            }))
        };
    }
    const requiredPhrases = EXACT_TARGETS.get(normalizedTarget) || [];
    const scored = candidates
        .map((candidate) => {
            const label = branchLabel(candidate);
            const requiredHit = requiredPhrases.length
                ? requiredPhrases.some((phrase) => normalizeText(label).includes(normalizeText(phrase)))
                : false;
            const score = scoreMatch(target, label) + (requiredHit ? 0.45 : 0);
            return { candidate, score, requiredHit, label };
        })
        .sort((a, b) => b.score - a.score);
    const best = scored[0]?.score || 0;
    const matched = scored.filter((item) => {
        if (requiredPhrases.length) return item.requiredHit && item.score >= 0.7;
        return item.score >= 0.92 && item.score >= best - 0.03;
    });
    return {
        matched,
        candidates: scored.slice(0, 6).map((item) => ({
            score: Number(item.score.toFixed(3)),
            billinfoDocId: item.candidate.billinfo_doc_id,
            branchDocId: item.candidate.branch_doc_id,
            label: branchDisplay(item.candidate)
        }))
    };
}

function buildPatch(csvRow, match) {
    return {
        envelope_contact_person: csvRow.contact_person.trim(),
        envelope_marga_bank_name: csvRow.marga_bank_name.trim() || 'China Bank Savings Antipolo Branch',
        envelope_marga_account_name: csvRow.marga_account_name.trim() || 'Marga Enterprises',
        envelope_marga_account_number: csvRow.marga_account_number.trim() || '6173-00-00163-4',
        envelope_from: csvRow.from.trim() || 'Marga Enterprises',
        envelope_contact_source: SOURCE,
        envelope_contact_updated_at: new Date().toISOString(),
        envelope_contact_updated_by: 'CSV import',
        envelope_contact_updated_by_id: 'script',
        envelope_contact_branch_id: String(match.candidate.branch_doc_id || match.candidate.billinfo?.branch_id || '').trim(),
        envelope_contact_company_id: String(match.candidate.company_doc_id || match.candidate.billinfo?.company_id || '').trim()
    };
}

function updateBillinfo(docId, patch) {
    const sql = `
update app_meta.firestore_documents
set data = data || '${escapeSql(JSON.stringify(patch))}'::jsonb,
    updated_at = now()
where collection = 'tbl_billinfo'
  and doc_id = '${escapeSql(docId)}';`;
    runPsql(sql);
}

function main() {
    const args = parseArgs(process.argv);
    const csvRows = readCsv(args.csv);
    const candidates = loadBranchBillinfoRows();
    const report = {
        sourceCsv: args.csv,
        source: SOURCE,
        applied: args.apply,
        generatedAt: new Date().toISOString(),
        csvRows: csvRows.length,
        branchBillinfoCandidates: candidates.length,
        importedRows: [],
        skippedRows: [],
        unmatchedRows: [],
        ambiguousRows: []
    };
    const plannedUpdates = new Map();

    csvRows.forEach((csvRow) => {
        const contactPerson = String(csvRow.contact_person || '').trim();
        if (!contactPerson) {
            report.skippedRows.push({
                rowNumber: csvRow.rowNumber,
                to: csvRow.to_company_and_department,
                reason: 'missing contact person'
            });
            return;
        }
        const result = chooseMatches(csvRow, candidates);
        if (!result.matched.length) {
            report.unmatchedRows.push({
                rowNumber: csvRow.rowNumber,
                to: csvRow.to_company_and_department,
                contactPerson,
                topCandidates: result.candidates
            });
            return;
        }
        if (result.matched.length > 8) {
            report.ambiguousRows.push({
                rowNumber: csvRow.rowNumber,
                to: csvRow.to_company_and_department,
                contactPerson,
                reason: `matched ${result.matched.length} rows; skipped to avoid broad contact overwrite`,
                topCandidates: result.candidates
            });
            return;
        }
        result.matched.forEach((match) => {
            const docId = String(match.candidate.billinfo_doc_id || '').trim();
            if (!docId) return;
            plannedUpdates.set(docId, {
                rowNumber: csvRow.rowNumber,
                to: csvRow.to_company_and_department,
                contactPerson,
                score: Number(match.score.toFixed(3)),
                billinfoDocId: docId,
                branchDocId: match.candidate.branch_doc_id,
                companyDocId: match.candidate.company_doc_id,
                branch: branchDisplay(match.candidate),
                patch: buildPatch(csvRow, match)
            });
        });
    });

    for (const item of plannedUpdates.values()) {
        if (args.apply) updateBillinfo(item.billinfoDocId, item.patch);
        report.importedRows.push({
            rowNumber: item.rowNumber,
            to: item.to,
            contactPerson: item.contactPerson,
            score: item.score,
            billinfoDocId: item.billinfoDocId,
            branchDocId: item.branchDocId,
            companyDocId: item.companyDocId,
            branch: item.branch
        });
    }

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(REPORT_DIR, `cbs-envelope-contact-import-${stamp}${args.apply ? '' : '-dry-run'}.json`);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`${args.apply ? 'Applied' : 'Dry run'} ${report.importedRows.length} tbl_billinfo contact update(s).`);
    console.log(`Skipped: ${report.skippedRows.length}; unmatched: ${report.unmatchedRows.length}; ambiguous: ${report.ambiguousRows.length}`);
    console.log(reportPath);
}

main();
