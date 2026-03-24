#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getReverseBridgeConfig } from "../local-sync/sync-manifest.mjs";

const ZERO_DATETIME = "0000-00-00 00:00:00";
const MAX_MYSQL_INT32 = 2147483647;
const REVERSE_BRIDGE_CONFIG = getReverseBridgeConfig();
export const DEFAULTS = {
  collectionHistoryLimit: 5000,
  scheduleLimit: 3000,
  schedtimePerSchedule: 3,
  recoveryLookbackHours: 72,
  recoveryOverlapMinutes: 10,
  queryPageSize: 500,
};

export const SYNCABLE_SCHEDULE_COLUMNS = REVERSE_BRIDGE_CONFIG.scheduleSafeFields;

const TRACKED_TABLES = new Set(REVERSE_BRIDGE_CONFIG.trackedTables);

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node tools/build-hybrid-bridge.mjs --dump <dump.sql> [--out-dir <dir>]",
      "",
      "Optional flags:",
      "  --collection-history-limit <n>",
      "  --schedule-limit <n>",
      "  --schedtime-per-schedule <n>",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length ? 0 : 1);
  }

  const config = {
    dumpPath: null,
    outDir: path.resolve(process.cwd(), "bridge-output"),
    collectionHistoryLimit: DEFAULTS.collectionHistoryLimit,
    scheduleLimit: DEFAULTS.scheduleLimit,
    schedtimePerSchedule: DEFAULTS.schedtimePerSchedule,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    const next = args[i + 1];

    if (token === "--dump") {
      config.dumpPath = next ? path.resolve(next) : null;
      i += 1;
      continue;
    }
    if (token === "--out-dir") {
      config.outDir = next ? path.resolve(next) : config.outDir;
      i += 1;
      continue;
    }
    if (token === "--collection-history-limit") {
      config.collectionHistoryLimit = Number(next || config.collectionHistoryLimit);
      i += 1;
      continue;
    }
    if (token === "--schedule-limit") {
      config.scheduleLimit = Number(next || config.scheduleLimit);
      i += 1;
      continue;
    }
    if (token === "--schedtime-per-schedule") {
      config.schedtimePerSchedule = Number(next || config.schedtimePerSchedule);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!config.dumpPath) {
    throw new Error("Missing required --dump argument.");
  }

  return config;
}

function normalizeTableName(name) {
  return String(name || "")
    .trim()
    .replace(/[`"']/g, "")
    .toLowerCase();
}

function cleanIdentifier(raw) {
  const cleaned = String(raw || "").trim();
  const parts = cleaned
    .split(".")
    .map((part) => part.replace(/`/g, "").trim())
    .filter(Boolean);
  return normalizeTableName(parts[parts.length - 1] || cleaned);
}

function stripLeadingComments(statement) {
  let sql = String(statement || "").trim();

  while (sql.startsWith("/*") || sql.startsWith("--") || sql.startsWith("#")) {
    if (sql.startsWith("/*")) {
      const closeIdx = sql.indexOf("*/");
      if (closeIdx < 0) return "";
      sql = sql.slice(closeIdx + 2).trimStart();
      continue;
    }

    if (sql.startsWith("--") || sql.startsWith("#")) {
      const newlineIdx = sql.indexOf("\n");
      if (newlineIdx < 0) return "";
      sql = sql.slice(newlineIdx + 1).trimStart();
      continue;
    }
  }

  return sql.trim();
}

function parseCreateTableStatement(statement) {
  const cleanSql = stripLeadingComments(statement);
  const tableMatch = cleanSql.match(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:`[^`]+`\.)?`?[^`\s(]+`?)/i,
  );

  if (!tableMatch) return null;

  const table = cleanIdentifier(tableMatch[1]);
  const firstParen = cleanSql.indexOf("(");
  const lastParen = cleanSql.lastIndexOf(")");

  if (firstParen < 0 || lastParen <= firstParen) {
    return { table, columns: [], autoIncrementColumn: null };
  }

  const definition = cleanSql.slice(firstParen + 1, lastParen);
  const lines = definition.split(/\r?\n/);
  const columns = [];
  let autoIncrementColumn = null;

  lines.forEach((line) => {
    const columnMatch = line.match(/^\s*`([^`]+)`\s+/);
    if (!columnMatch) return;
    const columnName = columnMatch[1];
    columns.push(columnName);
    if (/AUTO_INCREMENT/i.test(line)) autoIncrementColumn = columnName;
  });

  return { table, columns, autoIncrementColumn };
}

function parseColumnList(rawColumns) {
  const extracted = [];
  const regex = /`([^`]+)`/g;
  let match;

  while ((match = regex.exec(rawColumns)) !== null) {
    extracted.push(match[1]);
  }

  if (extracted.length) return extracted;

  return String(rawColumns || "")
    .split(",")
    .map((item) => item.trim().replace(/[`"']/g, ""))
    .filter(Boolean);
}

function parseInsertStatement(statement) {
  const cleanSql = stripLeadingComments(statement);
  const insertMatch = cleanSql.match(
    /^INSERT\s+INTO\s+((?:`[^`]+`\.)?`?[^`\s(]+`?)\s*(\(([\s\S]*?)\))?\s+VALUES\s*/i,
  );

  if (!insertMatch) return null;

  const table = cleanIdentifier(insertMatch[1]);
  const columns = insertMatch[3] ? parseColumnList(insertMatch[3]) : null;
  const valuesPart = cleanSql.slice(insertMatch[0].length).replace(/;\s*$/, "").trim();

  return { table, columns, valuesPart };
}

function decodeQuotedValue(token) {
  const quote = token[0];
  let inner = token.slice(1, -1);

  if (quote === "'") {
    inner = inner.replace(/''/g, "'");
  }

  inner = inner
    .replace(/\\0/g, "\u0000")
    .replace(/\\b/g, "\b")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\Z/g, "\u001a")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");

  return inner;
}

function parseSqlValue(rawToken) {
  const token = String(rawToken || "").trim();

  if (token === "") return "";
  if (/^null$/i.test(token)) return null;
  if (/^true$/i.test(token)) return true;
  if (/^false$/i.test(token)) return false;

  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
    return decodeQuotedValue(token);
  }

  if (/^b'[01]+'$/i.test(token)) {
    return parseInt(token.slice(2, -1), 2);
  }

  if (/^-?\d+$/.test(token)) {
    const asInt = Number(token);
    return Number.isSafeInteger(asInt) ? asInt : token;
  }

  if (/^-?\d+\.\d+$/.test(token)) {
    return Number(token);
  }

  return token;
}

function forEachValueTuple(valuesPart, onTuple) {
  let currentRow = null;
  let currentValue = "";
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let singleEscape = false;
  let doubleEscape = false;

  for (let i = 0; i < valuesPart.length; i += 1) {
    const ch = valuesPart[i];
    const next = i + 1 < valuesPart.length ? valuesPart[i + 1] : "";

    if (!currentRow) {
      if (ch === "(") {
        currentRow = [];
        currentValue = "";
        depth = 1;
      }
      continue;
    }

    if (inSingleQuote) {
      currentValue += ch;
      if (ch === "\\") {
        singleEscape = !singleEscape;
        continue;
      }
      if (ch === "'" && !singleEscape) {
        if (next === "'") {
          currentValue += next;
          i += 1;
        } else {
          inSingleQuote = false;
        }
      }
      if (ch !== "\\") singleEscape = false;
      continue;
    }

    if (inDoubleQuote) {
      currentValue += ch;
      if (ch === "\\") {
        doubleEscape = !doubleEscape;
        continue;
      }
      if (ch === '"' && !doubleEscape) {
        inDoubleQuote = false;
      }
      if (ch !== "\\") doubleEscape = false;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      currentValue += ch;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      currentValue += ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      currentValue += ch;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        currentRow.push(currentValue.trim());
        onTuple(currentRow);
        currentRow = null;
        currentValue = "";
      } else {
        currentValue += ch;
      }
      continue;
    }
    if (ch === "," && depth === 1) {
      currentRow.push(currentValue.trim());
      currentValue = "";
      continue;
    }

    currentValue += ch;
  }
}

function createSqlStatementParser(onStatement) {
  let buffer = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let singleEscape = false;
  let doubleEscape = false;
  let carryChar = "";
  let skipCurrent = false;

  async function consumeChunk(sqlText, { final = false } = {}) {
    const text = `${carryChar}${String(sqlText || "")}`;
    carryChar = "";
    if (!text.length && !final) return;

    for (let i = 0; i < text.length; i += 1) {
      if (skipCurrent) {
        skipCurrent = false;
        continue;
      }

      const isLast = i === text.length - 1;
      if (!final && isLast) {
        carryChar = text[i];
        break;
      }

      const ch = text[i];
      const next = isLast ? "" : text[i + 1];
      buffer += ch;

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          buffer += "/";
          skipCurrent = true;
          inBlockComment = false;
        }
        continue;
      }
      if (inSingleQuote) {
        if (ch === "\\") {
          singleEscape = !singleEscape;
          continue;
        }
        if (ch === "'" && !singleEscape) {
          if (next === "'") {
            buffer += next;
            skipCurrent = true;
            continue;
          }
          inSingleQuote = false;
        } else {
          singleEscape = false;
        }
        continue;
      }
      if (inDoubleQuote) {
        if (ch === "\\") {
          doubleEscape = !doubleEscape;
          continue;
        }
        if (ch === '"' && !doubleEscape) {
          inDoubleQuote = false;
        } else {
          doubleEscape = false;
        }
        continue;
      }
      if (inBacktick) {
        if (ch === "`") inBacktick = false;
        continue;
      }

      if (ch === "-" && next === "-") {
        inLineComment = true;
        continue;
      }
      if (ch === "#") {
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        continue;
      }
      if (ch === "'") {
        inSingleQuote = true;
        continue;
      }
      if (ch === '"') {
        inDoubleQuote = true;
        continue;
      }
      if (ch === "`") {
        inBacktick = true;
        continue;
      }
      if (ch === ";") {
        const statement = buffer.trim();
        buffer = "";
        if (statement) await onStatement(statement);
      }
    }

    if (final) {
      if (carryChar) {
        buffer += carryChar;
        carryChar = "";
      }
      const statement = buffer.trim();
      if (statement) {
        await onStatement(statement);
        buffer = "";
      }
    }
  }

  return { consumeChunk };
}

function toKey(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeForCompare(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

function isLegacyEmptyDateValue(value) {
  const text = normalizeForCompare(value).toLowerCase();
  return !text || text === ZERO_DATETIME || text === "undefined 00:00:00" || text === "null 00:00:00";
}

function normalizeScheduleWriteValue(column, value) {
  if (column === "date_finished" && isLegacyEmptyDateValue(value)) {
    return ZERO_DATETIME;
  }
  return value;
}

function buildSchedtimeFingerprint(row) {
  return [
    Number(row.schedule_id || 0) || 0,
    toKey(row.time_in),
    toKey(row.time_out),
    toKey(row.remarks),
    toKey(row.customer_remarks),
    toKey(row.override_remarks),
    toKey(row.explanation),
    Number(row.ismanual || 0) || 0,
  ].join("|");
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  const text = String(value).replace(/\\/g, "\\\\").replace(/'/g, "''");
  return `'${text}'`;
}

export function parseFirebaseConfig(configPath) {
  const source = fs.readFileSync(configPath, "utf8");
  const apiKey = (source.match(/apiKey:\s*'([^']+)'/) || [])[1];
  const baseUrl = (source.match(/baseUrl:\s*'([^']+)'/) || [])[1];
  if (!apiKey || !baseUrl) {
    throw new Error("Unable to parse Firebase config.");
  }
  return { apiKey, baseUrl };
}

function parseFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values || []).map((entry) => parseFirestoreValue(entry));
  }
  if (value.mapValue !== undefined) {
    const out = {};
    Object.entries(value.mapValue.fields || {}).forEach(([k, v]) => {
      out[k] = parseFirestoreValue(v);
    });
    return out;
  }
  return null;
}

function parseFirestoreDoc(doc) {
  if (!doc?.fields) return null;
  const parsed = {};
  Object.entries(doc.fields).forEach(([key, raw]) => {
    parsed[key] = parseFirestoreValue(raw);
  });
  if (doc.name) parsed._docId = doc.name.split("/").pop();
  return parsed;
}

function normalizePositiveNumber(value, fallback) {
  const numeric = Number(value || 0) || 0;
  return numeric > 0 ? numeric : fallback;
}

function buildRecoverySinceIso(lastSuccessAt, lookbackHours, overlapMinutes) {
  const overlapMs = normalizePositiveNumber(overlapMinutes, DEFAULTS.recoveryOverlapMinutes) * 60 * 1000;
  const lookbackMs = normalizePositiveNumber(lookbackHours, DEFAULTS.recoveryLookbackHours) * 60 * 60 * 1000;
  const lastSuccessMs = Date.parse(String(lastSuccessAt || "").trim());
  const sinceMs = Number.isFinite(lastSuccessMs)
    ? Math.max(0, lastSuccessMs - overlapMs)
    : (Date.now() - lookbackMs);
  return new Date(sinceMs).toISOString();
}

async function runPagedQuery(db, structuredQuery, pageSize, overallLimit) {
  const rows = [];
  const limit = normalizePositiveNumber(overallLimit, pageSize);
  const batchSize = Math.min(normalizePositiveNumber(pageSize, DEFAULTS.queryPageSize), limit);
  let offset = 0;

  while (rows.length < limit) {
    const page = await db.runQuery({
      ...structuredQuery,
      offset,
      limit: Math.min(batchSize, limit - rows.length),
    });
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < batchSize) break;
    offset += page.length;
  }

  return rows;
}

async function queryRecentDocs(db, {
  collectionId,
  orderField,
  sinceIso = "",
  overallLimit = 0,
  pageSize = DEFAULTS.queryPageSize,
}) {
  const normalizedLimit = normalizePositiveNumber(overallLimit, pageSize);
  const normalizedPageSize = Math.min(normalizePositiveNumber(pageSize, DEFAULTS.queryPageSize), normalizedLimit);

  if (!sinceIso) {
    return db.runQuery({
      from: [{ collectionId }],
      orderBy: [{ field: { fieldPath: orderField }, direction: "DESCENDING" }],
      limit: normalizedLimit,
    });
  }

  return runPagedQuery(db, {
    from: [{ collectionId }],
    where: {
      fieldFilter: {
        field: { fieldPath: orderField },
        op: "GREATER_THAN_OR_EQUAL",
        value: { stringValue: sinceIso },
      },
    },
    orderBy: [{ field: { fieldPath: orderField }, direction: "ASCENDING" }],
  }, normalizedPageSize, normalizedLimit);
}

export function createFirestoreClient({ apiKey, baseUrl }) {
  async function runQuery(structuredQuery) {
    const url = `${baseUrl}:runQuery?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (Array.isArray(payload) && payload[0]?.error) || payload?.error) {
      const message = payload?.error?.message || payload?.[0]?.error?.message || `runQuery failed (${response.status})`;
      throw new Error(message);
    }
    if (!Array.isArray(payload)) return [];
    return payload.map((row) => row.document).filter(Boolean).map(parseFirestoreDoc).filter(Boolean);
  }

  return { runQuery };
}

export function createBaselineState() {
  return {
    meta: { analyzedAt: new Date().toISOString() },
    schemas: {},
    collectionhistory: { maxId: 0, fingerprints: new Set() },
    schedule: { maxId: 0, rows: new Map() },
    schedtime: { maxId: 0, rows: new Map() },
    closedscheds: { maxId: 0, scheduleIds: new Set() },
  };
}

export function buildCollectionHistoryFingerprint(row) {
  return [
    toKey(row.invoice_num || row.invoice_id || row.invoice_no || row.invoiceno),
    toKey(row.timestamp),
    toKey(row.followup_datetime || row.followup_date || row.next_followup),
    toKey(row.remarks),
    toKey(row.contact_person),
    toKey(row.contact_number),
  ].join("|");
}

export function pickScheduleSubset(row) {
  const out = {};
  SYNCABLE_SCHEDULE_COLUMNS.forEach((column) => {
    out[column] = row[column] ?? null;
  });
  return out;
}

export async function buildDumpBaseline(dumpPath) {
  const fileStat = fs.statSync(dumpPath);
  const baseline = createBaselineState();
  const parser = createSqlStatementParser(async (statement) => {
    const createInfo = parseCreateTableStatement(statement);
    if (createInfo && TRACKED_TABLES.has(createInfo.table)) {
      baseline.schemas[createInfo.table] = {
        columns: createInfo.columns,
        autoIncrementColumn: createInfo.autoIncrementColumn,
      };
      return;
    }

    const insertInfo = parseInsertStatement(statement);
    if (!insertInfo || !TRACKED_TABLES.has(insertInfo.table)) return;

    const columns = insertInfo.columns && insertInfo.columns.length
      ? insertInfo.columns
      : baseline.schemas[insertInfo.table]?.columns || [];
    if (!columns.length) return;

    forEachValueTuple(insertInfo.valuesPart, (rawValues) => {
      const row = {};
      columns.forEach((column, idx) => {
        row[column] = parseSqlValue(rawValues[idx]);
      });

      if (insertInfo.table === "tbl_collectionhistory") {
        baseline.collectionhistory.maxId = Math.max(baseline.collectionhistory.maxId, Number(row.id || 0) || 0);
        baseline.collectionhistory.fingerprints.add(buildCollectionHistoryFingerprint(row));
      }

      if (insertInfo.table === "tbl_schedule") {
        const id = Number(row.id || 0) || 0;
        if (id > 0) {
          baseline.schedule.maxId = Math.max(baseline.schedule.maxId, id);
          baseline.schedule.rows.set(String(id), pickScheduleSubset(row));
        }
      }

      if (insertInfo.table === "tbl_schedtime") {
        const id = Number(row.id || 0) || 0;
        if (id > 0) {
          baseline.schedtime.maxId = Math.max(baseline.schedtime.maxId, id);
          baseline.schedtime.rows.set(String(id), row);
        }
      }

      if (insertInfo.table === "tbl_closedscheds") {
        const id = Number(row.id || 0) || 0;
        if (id > 0) baseline.closedscheds.maxId = Math.max(baseline.closedscheds.maxId, id);
        const schedId = Number(row.sched_id || 0) || 0;
        if (schedId > 0) baseline.closedscheds.scheduleIds.add(String(schedId));
      }
    });
  });

  const stream = fs.createReadStream(dumpPath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  let bytesRead = 0;
  let lastLog = Date.now();

  for await (const chunk of stream) {
    bytesRead += Buffer.byteLength(chunk, "utf8");
    await parser.consumeChunk(chunk, { final: false });

    const now = Date.now();
    if (now - lastLog >= 5000) {
      const percent = ((bytesRead / fileStat.size) * 100).toFixed(1);
      process.stdout.write(`Baseline parse: ${percent}%\r`);
      lastLog = now;
    }
  }

  await parser.consumeChunk("", { final: true });
  process.stdout.write("\n");
  return baseline;
}

export async function loadFirebaseOperationalState(db, options) {
  const recoverySinceIso = String(
    options.recoverySinceIso
    || buildRecoverySinceIso(options.lastSuccessAt, options.recoveryLookbackHours, options.recoveryOverlapMinutes),
  ).trim();
  const queryPageSize = normalizePositiveNumber(options.queryPageSize, DEFAULTS.queryPageSize);
  const collectionHistoryDocs = await queryRecentDocs(db, {
    collectionId: "tbl_collectionhistory",
    orderField: "timestamp",
    sinceIso: recoverySinceIso,
    overallLimit: normalizePositiveNumber(options.collectionHistoryLimit, DEFAULTS.collectionHistoryLimit),
    pageSize: queryPageSize,
  });

  const bridgeUpdatedScheduleDocs = await queryRecentDocs(db, {
    collectionId: "tbl_schedule",
    orderField: "bridge_updated_at",
    sinceIso: recoverySinceIso,
    overallLimit: normalizePositiveNumber(options.scheduleLimit, DEFAULTS.scheduleLimit),
    pageSize: queryPageSize,
  }).catch(() => []);

  const fieldUpdatedScheduleDocs = await queryRecentDocs(db, {
    collectionId: "tbl_schedule",
    orderField: "field_updated_at",
    sinceIso: recoverySinceIso,
    overallLimit: normalizePositiveNumber(options.scheduleLimit, DEFAULTS.scheduleLimit),
    pageSize: queryPageSize,
  }).catch(() => []);

  const scheduleDocs = new Map();
  [...bridgeUpdatedScheduleDocs, ...fieldUpdatedScheduleDocs].forEach((doc) => {
    const id = Number(doc.id || 0) || 0;
    if (id > 0) scheduleDocs.set(String(id), doc);
  });

  const schedtimeDocs = [];
  for (const scheduleId of scheduleDocs.keys()) {
    const rows = await db.runQuery({
      from: [{ collectionId: "tbl_schedtime" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "schedule_id" },
          op: "EQUAL",
          value: { integerValue: scheduleId },
        },
      },
      // Avoid requiring a composite Firestore index on (schedule_id, id).
      // We fetch the schedule's recent log candidates, then sort client-side.
      limit: Math.max(Number(options.schedtimePerSchedule || 0) * 20, 100),
    });
    rows
      .sort((left, right) => Number(right.id || 0) - Number(left.id || 0))
      .slice(0, options.schedtimePerSchedule)
      .forEach((row) => schedtimeDocs.push(row));
  }

  return { collectionHistoryDocs, scheduleDocs, schedtimeDocs };
}

export function chooseCollectionHistoryRows(firebaseDocs, baseline) {
  const nextRows = [];
  let nextId = baseline.collectionhistory.maxId;
  const seen = new Set(baseline.collectionhistory.fingerprints);

  firebaseDocs.forEach((doc) => {
    const invoiceRef = toKey(doc.invoice_num || doc.invoice_id || doc.invoice_no || doc.invoiceno);
    if (!invoiceRef) return;
    if (Number(doc.id || 0) > 0) return;

    const row = {
      id: ++nextId,
      collection_id: 0,
      invoice_num: invoiceRef,
      timestamp: toKey(doc.timestamp) || nowDbDateTime(),
      followup_datetime: toKey(doc.followup_datetime || doc.followup_date || doc.next_followup) || ZERO_DATETIME,
      contact_person: toKey(doc.contact_person) || "-",
      contact_number: toKey(doc.contact_number),
      status_id: 0,
      location_id: 0,
      ischecksigned: 0,
      check_number: "",
      payment_amount: Number(doc.payment_amount || 0) || 0,
      schedule_status: Number(doc.schedule_status || 0) || 0,
      remarks: toKey(doc.remarks),
      employee_id: Number(doc.employee_id || 0) || 0,
      conversion_type: toKey(doc.conversion_type),
      multipleinvoicecall_id: Number(doc.multipleinvoicecall_id || 0) || 0,
      return_call: Number(doc.return_call || 0) || 0,
      _firebaseDocId: doc._docId || "",
    };

    const fingerprint = buildCollectionHistoryFingerprint(row);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    nextRows.push(row);
  });

  return nextRows;
}

export function buildScheduleUpdateRows(scheduleDocs, baseline) {
  const rows = [];

  scheduleDocs.forEach((doc, scheduleId) => {
    const existing = baseline.schedule.rows.get(scheduleId);
    if (!existing) return;

    const changed = {};
    SYNCABLE_SCHEDULE_COLUMNS.forEach((column) => {
      if (!(column in doc)) return;
      const nextValue = normalizeScheduleWriteValue(column, doc[column]);
      const before = normalizeForCompare(existing[column]);
      const after = normalizeForCompare(nextValue);
      if (before !== after) changed[column] = nextValue;
    });

    if (Object.keys(changed).length) {
      rows.push({ id: Number(scheduleId), changes: changed, firebaseDocId: doc._docId || scheduleId });
    }
  });

  return rows;
}

export function buildSchedtimeRows(schedtimeDocs, baseline) {
  const inserts = [];
  const updates = [];
  const baselineFingerprints = new Set(
    [...baseline.schedtime.rows.values()].map((row) => buildSchedtimeFingerprint(row)),
  );

  schedtimeDocs.forEach((doc) => {
    const id = Number(doc.id || 0) || 0;
    const scheduleId = Number(doc.schedule_id || 0) || 0;
    if (!id || !scheduleId) return;

    const row = {
      id,
      schedule_id: scheduleId,
      tech_id: Number(doc.tech_id || 0) || 0,
      schedule_date: toKey(doc.schedule_date) || nowDbDateTime(),
      branch_id: Number(doc.branch_id || 0) || 0,
      issupplier: Number(doc.issupplier || 0) || 0,
      time_in: toKey(doc.time_in) || ZERO_DATETIME,
      time_out: toKey(doc.time_out) || ZERO_DATETIME,
      remarks: toKey(doc.remarks),
      timestmp: toKey(doc.timestmp) || nowDbDateTime(),
      inserted_by: Number(doc.inserted_by || 0) || 0,
      updated_by: Number(doc.updated_by || 0) || 0,
      customer_remarks: toKey(doc.customer_remarks),
      override_remarks: toKey(doc.override_remarks),
      explanation: toKey(doc.explanation),
      ismanual: Number(doc.ismanual || 0) || 0,
      _firebaseDocId: doc._docId || String(id),
    };

    const existing = baseline.schedtime.rows.get(String(id));
    const fingerprint = buildSchedtimeFingerprint(row);
    if (!existing) {
      if (id > MAX_MYSQL_INT32 && baselineFingerprints.has(fingerprint)) return;
      inserts.push(row);
      return;
    }

    const changes = {};
    Object.keys(row).forEach((column) => {
      if (column.startsWith("_")) return;
      const before = normalizeForCompare(existing[column]);
      const after = normalizeForCompare(row[column]);
      if (before !== after) changes[column] = row[column];
    });

    if (Object.keys(changes).length) {
      updates.push({ id, schedule_id: scheduleId, changes, _firebaseDocId: row._firebaseDocId });
    }
  });

  return { inserts, updates };
}

export function buildClosedScheduleCandidates(scheduleUpdates, scheduleDocs, baseline) {
  const candidates = [];
  let nextId = baseline.closedscheds.maxId;

  scheduleUpdates.forEach((update) => {
    const doc = scheduleDocs.get(String(update.id));
    const finished = toKey(doc?.date_finished);
    if (isLegacyEmptyDateValue(finished)) return;
    if (baseline.closedscheds.scheduleIds.has(String(update.id))) return;
    baseline.closedscheds.scheduleIds.add(String(update.id));
    candidates.push({ id: ++nextId, sched_id: update.id });
  });

  return candidates;
}

export function renderCollectionHistoryInserts(rows) {
  if (!rows.length) return "-- No tbl_collectionhistory inserts required.\n";

  return [
    "-- tbl_collectionhistory inserts",
    ...rows.map((row) => {
      const columns = [
        "id",
        "collection_id",
        "invoice_num",
        "timestamp",
        "followup_datetime",
        "contact_person",
        "contact_number",
        "status_id",
        "location_id",
        "ischecksigned",
        "check_number",
        "payment_amount",
        "schedule_status",
        "remarks",
        "employee_id",
        "conversion_type",
        "multipleinvoicecall_id",
        "return_call",
      ];
      const values = columns.map((column) => sqlValue(row[column]));
      return `INSERT INTO \`tbl_collectionhistory\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES (${values.join(", ")}); -- Firebase ${row._firebaseDocId}`;
    }),
    "",
  ].join("\n");
}

export function renderScheduleUpdates(rows) {
  if (!rows.length) return "-- No tbl_schedule updates required.\n";

  return [
    "-- tbl_schedule updates",
    ...rows.map((row) => {
      const assignments = Object.entries(row.changes).map(([column, value]) => `\`${column}\` = ${sqlValue(value)}`);
      return `UPDATE \`tbl_schedule\` SET ${assignments.join(", ")} WHERE \`id\` = ${row.id}; -- Firebase ${row.firebaseDocId}`;
    }),
    "",
  ].join("\n");
}

export function renderSchedtimeChanges(changes) {
  const lines = [];

  if (changes.inserts.length) {
    lines.push("-- tbl_schedtime inserts");
    changes.inserts.forEach((row) => {
      const columns = [
        "id",
        "schedule_id",
        "tech_id",
        "schedule_date",
        "branch_id",
        "issupplier",
        "time_in",
        "time_out",
        "remarks",
        "timestmp",
        "inserted_by",
        "updated_by",
        "customer_remarks",
        "override_remarks",
        "explanation",
        "ismanual",
      ];
      const values = columns.map((column) => sqlValue(row[column]));
      lines.push(`INSERT INTO \`tbl_schedtime\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES (${values.join(", ")}); -- Firebase ${row._firebaseDocId}`);
    });
    lines.push("");
  }

  if (changes.updates.length) {
    lines.push("-- tbl_schedtime updates");
    changes.updates.forEach((row) => {
      const assignments = Object.entries(row.changes)
        .filter(([column]) => column !== "id")
        .map(([column, value]) => `\`${column}\` = ${sqlValue(value)}`);
      if (!assignments.length) return;
      lines.push(`UPDATE \`tbl_schedtime\` SET ${assignments.join(", ")} WHERE \`id\` = ${row.id}; -- Firebase ${row._firebaseDocId}`);
    });
    lines.push("");
  }

  if (!lines.length) return "-- No tbl_schedtime changes required.\n";
  return lines.join("\n");
}

export function renderClosedScheduleCandidates(rows) {
  if (!rows.length) return "-- No tbl_closedscheds candidate inserts.\n";

  return [
    "-- Optional tbl_closedscheds inserts",
    "-- Review these before applying. The field app's main truth is tbl_schedule + tbl_schedtime.",
    ...rows.map((row) => `INSERT INTO \`tbl_closedscheds\` (\`id\`, \`sched_id\`) VALUES (${row.id}, ${row.sched_id});`),
    "",
  ].join("\n");
}

export function nowDbDateTime() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export function summarizePlan(plan) {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      collectionhistoryInserts: plan.collectionHistoryInserts.length,
      scheduleUpdates: plan.scheduleUpdates.length,
      schedtimeInserts: plan.schedtimeChanges.inserts.length,
      schedtimeUpdates: plan.schedtimeChanges.updates.length,
      optionalClosedSchedInserts: plan.closedScheduleCandidates.length,
    },
    sampleCollectionhistory: plan.collectionHistoryInserts.slice(0, 5).map((row) => ({
      id: row.id,
      invoice_num: row.invoice_num,
      timestamp: row.timestamp,
      remarks: row.remarks,
    })),
    sampleScheduleUpdates: plan.scheduleUpdates.slice(0, 5),
    sampleSchedtimeInserts: plan.schedtimeChanges.inserts.slice(0, 5).map((row) => ({
      id: row.id,
      schedule_id: row.schedule_id,
      override_remarks: row.override_remarks,
      time_in: row.time_in,
      time_out: row.time_out,
    })),
    sampleSchedtimeUpdates: plan.schedtimeChanges.updates.slice(0, 5),
    sampleClosedScheds: plan.closedScheduleCandidates.slice(0, 5),
  };
}

export async function buildBridge(config) {
  const baseline = await buildDumpBaseline(config.dumpPath);
  const firebaseConfigPath = config.firebaseConfigPath
    ? path.resolve(config.firebaseConfigPath)
    : path.resolve(process.cwd(), "shared/js/firebase-config.js");
  const db = createFirestoreClient(parseFirebaseConfig(firebaseConfigPath));
  const firebaseState = await loadFirebaseOperationalState(db, config);

  const collectionHistoryInserts = chooseCollectionHistoryRows(firebaseState.collectionHistoryDocs, baseline);
  const scheduleUpdates = buildScheduleUpdateRows(firebaseState.scheduleDocs, baseline);
  const schedtimeChanges = buildSchedtimeRows(firebaseState.schedtimeDocs, baseline);
  const closedScheduleCandidates = buildClosedScheduleCandidates(scheduleUpdates, firebaseState.scheduleDocs, baseline);

  return {
    baseline,
    collectionHistoryInserts,
    scheduleUpdates,
    schedtimeChanges,
    closedScheduleCandidates,
  };
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function main() {
  try {
    const config = parseArgs(process.argv);
    ensureDir(config.outDir);

    console.log("Building dump baseline...");
    const plan = await buildBridge(config);

    const sql = [
      "-- MARGA Hybrid Bridge SQL Patch",
      `-- Generated: ${new Date().toISOString()}`,
      `-- Dump baseline: ${config.dumpPath}`,
      "START TRANSACTION;",
      "",
      renderCollectionHistoryInserts(plan.collectionHistoryInserts),
      renderScheduleUpdates(plan.scheduleUpdates),
      renderSchedtimeChanges(plan.schedtimeChanges),
      "COMMIT;",
      "",
    ].join("\n");

    const optionalSql = renderClosedScheduleCandidates(plan.closedScheduleCandidates);
    const report = summarizePlan(plan);
    const baselineSnapshot = {
      generatedAt: new Date().toISOString(),
      scheduleMaxId: plan.baseline.schedule.maxId,
      schedtimeMaxId: plan.baseline.schedtime.maxId,
      collectionhistoryMaxId: plan.baseline.collectionhistory.maxId,
      closedschedsMaxId: plan.baseline.closedscheds.maxId,
    };

    const sqlPath = path.join(config.outDir, "mysql-bridge-patch.sql");
    const optionalSqlPath = path.join(config.outDir, "mysql-bridge-optional-closedscheds.sql");
    const reportPath = path.join(config.outDir, "mysql-bridge-report.json");
    const baselinePath = path.join(config.outDir, "mysql-bridge-baseline.json");

    fs.writeFileSync(sqlPath, sql);
    fs.writeFileSync(optionalSqlPath, optionalSql);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(baselinePath, JSON.stringify(baselineSnapshot, null, 2));

    console.log("Bridge build complete.");
    console.log(`- Patch SQL: ${sqlPath}`);
    console.log(`- Optional closed-schedule SQL: ${optionalSqlPath}`);
    console.log(`- Report JSON: ${reportPath}`);
    console.log(`- Baseline JSON: ${baselinePath}`);
    console.log("");
    console.log("Summary:");
    console.log(`- tbl_collectionhistory inserts: ${report.summary.collectionhistoryInserts}`);
    console.log(`- tbl_schedule updates: ${report.summary.scheduleUpdates}`);
    console.log(`- tbl_schedtime inserts: ${report.summary.schedtimeInserts}`);
    console.log(`- tbl_schedtime updates: ${report.summary.schedtimeUpdates}`);
    console.log(`- Optional tbl_closedscheds inserts: ${report.summary.optionalClosedSchedInserts}`);
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main();
}
