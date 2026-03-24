#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import crypto from "node:crypto";
import {
  ensureDir,
  parseFirebaseConfig,
} from "../tools/build-hybrid-bridge.mjs";
import {
  loadEnvFile,
  parseBooleanEnv,
  readState,
  resolveMaybeRelative,
  writeState,
} from "./run-local-sync.mjs";

export { parseFirebaseConfig } from "../tools/build-hybrid-bridge.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYNC_STATE_COLLECTION = "sys_sync_state";
const WRITE_BATCH_LIMIT = 250;
const CHUNK_SIZE_BYTES = 1024 * 1024;
const DEFAULT_TABLES = ["tbl_schedule", "tbl_schedtime", "tbl_closedscheds"];
const FIRESTORE_INT64_MAX = 9223372036854775807;
const FIRESTORE_INT64_MIN = -9223372036854775808;
const DUMP_FILE_PATTERN = /\.sql(?:\.gz)?$/i;
const TABLE_ID_HINTS = {
  tbl_schedule: "id",
  tbl_schedtime: "id",
  tbl_closedscheds: "id",
};

function defaultPaths() {
  return {
    firebaseConfigPath: path.resolve(__dirname, "../shared/js/firebase-config.js"),
    outDir: path.resolve(__dirname, "output"),
    stateFile: path.resolve(__dirname, "state/last-run.json"),
  };
}

function toIsoNow() {
  return new Date().toISOString();
}

function listDumpCandidates(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && DUMP_FILE_PATTERN.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        fullPath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
}

export function resolveLatestDumpPath(inputPath) {
  const candidate = String(inputPath || "").trim();
  if (!candidate) return null;
  if (!fs.existsSync(candidate)) return candidate;

  const stat = fs.statSync(candidate);
  if (stat.isDirectory()) {
    const latest = listDumpCandidates(candidate)[0];
    return latest?.fullPath || null;
  }

  return candidate;
}

export function describeDumpSource(inputPath) {
  const candidate = String(inputPath || "").trim();
  if (!candidate) {
    return {
      configuredPath: "",
      resolvedPath: null,
      mode: "missing",
    };
  }

  const resolvedPath = resolveLatestDumpPath(candidate);
  const exists = Boolean(resolvedPath && fs.existsSync(resolvedPath));
  const mode = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
    ? "latest-in-directory"
    : "direct-file";

  return {
    configuredPath: candidate,
    resolvedPath,
    exists,
    mode,
  };
}

function toFirestoreField(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      if (
        Number.isSafeInteger(value)
        && value >= FIRESTORE_INT64_MIN
        && value <= FIRESTORE_INT64_MAX
      ) {
        return { integerValue: String(value) };
      }
      return { stringValue: String(value) };
    }
    return { doubleValue: value };
  }
  return { stringValue: String(value) };
}

function parseFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) {
    const numericValue = Number(value.integerValue);
    return Number.isSafeInteger(numericValue) ? numericValue : value.integerValue;
  }
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values || []).map((entry) => parseFirestoreValue(entry));
  }
  if (value.mapValue !== undefined) {
    const out = {};
    Object.entries(value.mapValue.fields || {}).forEach(([key, raw]) => {
      out[key] = parseFirestoreValue(raw);
    });
    return out;
  }
  return null;
}

function parseFirestoreDoc(doc) {
  if (!doc?.fields) return null;
  const out = {};
  Object.entries(doc.fields).forEach(([key, raw]) => {
    out[key] = parseFirestoreValue(raw);
  });
  if (doc.name) out._docId = doc.name.split("/").pop();
  return out;
}

function parseProjectAndDb(baseUrl) {
  const match = String(baseUrl || "").match(/projects\/([^/]+)\/databases\/\(([^)]+)\)\/documents/);
  if (!match) throw new Error("Invalid Firestore base URL.");
  return { projectId: match[1], databaseId: match[2] };
}

function withApiKey(url, apiKey) {
  const joiner = String(url).includes("?") ? "&" : "?";
  return `${url}${joiner}key=${encodeURIComponent(apiKey)}`;
}

function sanitizePrivateKey(key) {
  if (!key) return "";
  return String(key).replace(/\\n/g, "\n");
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error_description || `${response.status} ${response.statusText}`);
  }
  return payload;
}

async function getGoogleAccessToken() {
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const privateKey = sanitizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "");
  if (!serviceEmail || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.");
  }

  const nowTs = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: nowTs + 3600,
    iat: nowTs,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const assertion = `${signingInput}.${signature}`;

  const body = new URLSearchParams();
  body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  body.set("assertion", assertion);

  const payload = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return payload.access_token;
}

export function createWritableFirestoreClient({ apiKey, baseUrl, serviceAccountEmail = "", serviceAccountPrivateKey = "" }) {
  const { projectId, databaseId } = parseProjectAndDb(baseUrl);
  const dbSegment = `(${databaseId})`;
  const docRoot = `projects/${projectId}/databases/${dbSegment}/documents`;
  const useServiceAccount = Boolean(
    serviceAccountEmail
    && serviceAccountPrivateKey,
  );

  async function firestoreFetch(url, options = {}) {
    if (useServiceAccount) {
      const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = serviceAccountEmail;
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = serviceAccountPrivateKey;
      const token = await getGoogleAccessToken();
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
      return fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      });
    }
    return fetch(withApiKey(url, apiKey), options);
  }

  async function getDoc(collection, docId) {
    const url = `${baseUrl}/${encodeURIComponent(collection)}/${encodeURIComponent(String(docId))}`;
    const response = await firestoreFetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) return null;
    return parseFirestoreDoc(payload);
  }

  async function listDocuments(collection, pageSize = 1000, pageToken = "") {
    const params = new URLSearchParams();
    params.set("pageSize", String(pageSize));
    if (pageToken) params.set("pageToken", pageToken);
    const url = `${baseUrl}/${encodeURIComponent(collection)}${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await firestoreFetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      if (response.status === 404) {
        return { documents: [], nextPageToken: "" };
      }
      throw new Error(payload?.error?.message || `Firestore list failed (${response.status})`);
    }
    return {
      documents: Array.isArray(payload.documents) ? payload.documents.map(parseFirestoreDoc).filter(Boolean) : [],
      nextPageToken: payload.nextPageToken || "",
    };
  }

  async function patchDoc(collection, docId, fields) {
    const keys = Object.keys(fields);
    const params = keys.map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join("&");
    const body = { fields: {} };
    keys.forEach((key) => {
      body.fields[key] = toFirestoreField(fields[key]);
    });
    const url = `${baseUrl}/${encodeURIComponent(collection)}/${encodeURIComponent(String(docId))}${params ? `?${params}` : ""}`;
    const response = await firestoreFetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error?.message || `Firestore patch failed (${response.status})`);
    }
    return payload;
  }

  async function commitWrites(writes) {
    if (!Array.isArray(writes) || !writes.length) return;
    const url = useServiceAccount
      ? `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbSegment}/documents:commit`
      : `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbSegment}/documents:commit?key=${encodeURIComponent(apiKey)}`;
    const response = await firestoreFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writes }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error?.message || `Firestore commit failed (${response.status})`);
    }
    return payload;
  }

  function makeUpsertWrite(collection, docId, fields) {
    const keys = Object.keys(fields);
    const firestoreFields = {};
    keys.forEach((key) => {
      firestoreFields[key] = toFirestoreField(fields[key]);
    });

    return {
      update: {
        name: `${docRoot}/${collection}/${encodeURIComponent(String(docId))}`,
        fields: firestoreFields,
      },
      updateMask: {
        fieldPaths: keys,
      },
    };
  }

  function makeDeleteWrite(collection, docId) {
    return {
      delete: `${docRoot}/${collection}/${encodeURIComponent(String(docId))}`,
    };
  }

  return {
    getDoc,
    listDocuments,
    patchDoc,
    commitWrites,
    makeUpsertWrite,
    makeDeleteWrite,
  };
}

function cleanLeadingComments(statement) {
  let sql = String(statement || "").trim();
  while (sql.startsWith("/*") || sql.startsWith("--") || sql.startsWith("#")) {
    if (sql.startsWith("/*")) {
      const closeIdx = sql.indexOf("*/");
      if (closeIdx === -1) return "";
      sql = sql.slice(closeIdx + 2).trimStart();
      continue;
    }
    const newlineIdx = sql.indexOf("\n");
    if (newlineIdx === -1) return "";
    sql = sql.slice(newlineIdx + 1).trimStart();
  }
  return sql.trim();
}

export { cleanLeadingComments };

function parseColumnList(rawColumns) {
  return String(rawColumns || "")
    .split(",")
    .map((col) => col.replace(/`/g, "").trim())
    .filter(Boolean);
}

export { parseColumnList };

function parseCreateTableStatement(statement) {
  const cleaned = cleanLeadingComments(statement);
  const match = cleaned.match(/^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([A-Za-z0-9_]+)`?\s*\(([\s\S]+)\)\s*(ENGINE|DEFAULT|;)/i);
  if (!match) return null;
  const table = String(match[1] || "").toLowerCase();
  const body = String(match[2] || "");
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const columns = [];
  lines.forEach((line) => {
    const colMatch = line.match(/^`([^`]+)`/);
    if (colMatch) columns.push(colMatch[1]);
  });
  return { table, columns };
}

export { parseCreateTableStatement };

function parseInsertStatement(statement) {
  const cleaned = cleanLeadingComments(statement);
  const match = cleaned.match(/^INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?\s*(\(([\s\S]*?)\))?\s*VALUES\s*([\s\S]+)$/i);
  if (!match) return null;
  return {
    table: String(match[1] || "").toLowerCase(),
    columns: match[3] ? parseColumnList(match[3]) : null,
    valuesPart: String(match[4] || "").trim().replace(/;$/, ""),
  };
}

export { parseInsertStatement };

function parseSqlValue(rawToken) {
  const token = String(rawToken || "").trim();
  if (token === "") return null;
  if (/^NULL$/i.test(token)) return null;
  if (/^true$/i.test(token)) return true;
  if (/^false$/i.test(token)) return false;
  if (/^-?\d+$/.test(token)) return Number(token);
  if (/^-?\d+\.\d+$/.test(token)) return Number(token);
  return token;
}

export { parseSqlValue };

function parseValueTuples(valuesPart) {
  const tuples = [];
  let currentTuple = [];
  let currentToken = "";
  let inSingle = false;
  let escape = false;
  let depth = 0;

  const pushToken = () => {
    currentTuple.push(parseSqlValue(currentToken));
    currentToken = "";
  };

  for (let i = 0; i < valuesPart.length; i += 1) {
    const ch = valuesPart[i];
    const next = valuesPart[i + 1];

    if (inSingle) {
      if (escape) {
        currentToken += ch;
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "'") {
        if (next === "'") {
          currentToken += "'";
          i += 1;
          continue;
        }
        inSingle = false;
        continue;
      }
      currentToken += ch;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }

    if (ch === "(") {
      if (depth === 0) {
        currentTuple = [];
        currentToken = "";
      } else {
        currentToken += ch;
      }
      depth += 1;
      continue;
    }

    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        pushToken();
        tuples.push(currentTuple);
        currentTuple = [];
      } else {
        currentToken += ch;
      }
      continue;
    }

    if (ch === "," && depth === 1) {
      pushToken();
      continue;
    }

    if (depth > 0) {
      currentToken += ch;
    }
  }

  return tuples;
}

export { parseValueTuples };

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
      }
    }
  }

  return { consumeChunk };
}

export { createSqlStatementParser };

function toRecord(columns, tuple) {
  const record = {};
  columns.forEach((column, idx) => {
    record[column] = tuple[idx];
  });
  return record;
}

export { toRecord };

function rowIdFromRecord(table, record, columns) {
  const hint = TABLE_ID_HINTS[table];
  if (hint && Number.isFinite(Number(record?.[hint]))) return Math.trunc(Number(record[hint]));
  if (Number.isFinite(Number(record?.id))) return Math.trunc(Number(record.id));
  const first = columns?.[0];
  if (first && Number.isFinite(Number(record?.[first]))) return Math.trunc(Number(record[first]));
  return null;
}

export { rowIdFromRecord };

function sanitizeDumpRecord(table, record) {
  const out = { ...record };
  if (table === "tbl_schedule") {
    out.bridge_source = "local_dump";
    out.bridge_pushed_at = toIsoNow();
  }
  if (table === "tbl_schedtime") {
    out.bridge_source = "local_dump";
    out.bridge_pushed_at = toIsoNow();
  }
  return out;
}

function recordFingerprint(table, id, record) {
  return createHash("sha1")
    .update(`${table}|${id}|${JSON.stringify(record)}`)
    .digest("hex");
}

export async function getWatermarkMap(db, tables) {
  const out = new Map();
  for (const table of tables) {
    const state = await db.getDoc(SYNC_STATE_COLLECTION, table);
    const lastId = Number(state?.last_id || 0);
    out.set(table, {
      exists: Boolean(state),
      lastId: Number.isFinite(lastId) ? Math.trunc(lastId) : 0,
    });
  }
  return out;
}

export function loadDumpSyncConfig(overrides = {}) {
  const env = loadEnvFile(path.join(__dirname, ".env"));
  const paths = defaultPaths();
  const configuredDumpPath = resolveMaybeRelative(__dirname, overrides.dumpPath, env.DUMP_PATH);
  return {
    dumpPath: resolveLatestDumpPath(configuredDumpPath),
    configuredDumpPath,
    firebaseConfigPath: resolveMaybeRelative(__dirname, overrides.firebaseConfigPath, env.FIREBASE_CONFIG_PATH || paths.firebaseConfigPath),
    outDir: resolveMaybeRelative(__dirname, overrides.outDir, env.OUT_DIR || paths.outDir),
    stateFile: resolveMaybeRelative(__dirname, overrides.stateFile, env.STATE_FILE || paths.stateFile),
    serviceAccountEmail: overrides.serviceAccountEmail || env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    serviceAccountPrivateKey: overrides.serviceAccountPrivateKey || env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "",
    loopSeconds: Number(overrides.loopSeconds || env.SYNC_LOOP_SECONDS || 300),
    tables: overrides.tables || DEFAULT_TABLES,
    dryRun: overrides.dryRun !== undefined ? Boolean(overrides.dryRun) : parseBooleanEnv(env.SYNC_APPLY, false) === false,
  };
}

export async function runDumpToFirebase(config, hooks = {}) {
  if (!config.dumpPath) throw new Error("Dump path is required for dump-to-Firebase sync.");
  if (!fs.existsSync(config.dumpPath)) throw new Error(`Dump file not found: ${config.dumpPath}`);

  const emit = hooks.onActivity || (() => {});
  const reportPath = path.join(config.outDir, "dump-to-firebase-report.json");
  const db = createWritableFirestoreClient({
    ...parseFirebaseConfig(config.firebaseConfigPath),
    serviceAccountEmail: config.serviceAccountEmail || "",
    serviceAccountPrivateKey: config.serviceAccountPrivateKey || "",
  });
  const tables = [...new Set((config.tables || DEFAULT_TABLES).map((table) => String(table).toLowerCase()))];
  const watermarkMap = await getWatermarkMap(db, tables);
  const tableSchemas = new Map();
  const pendingWrites = [];
  const pendingActivityRows = [];
  const stats = {
    parsedStatements: 0,
    parsedCreate: 0,
    parsedInsert: 0,
    insertedRows: 0,
    skippedRows: 0,
    tables: Object.fromEntries(tables.map((table) => [table, {
      table,
      watermarkBefore: watermarkMap.get(table)?.lastId || 0,
      watermarkAfter: watermarkMap.get(table)?.lastId || 0,
      baselineInitialized: !watermarkMap.get(table)?.exists,
      pushed: 0,
      skipped: 0,
      examples: [],
    }])),
  };

  const stateBefore = readState(config.stateFile);
  const nextState = {
    ...stateBefore,
    lastAttemptAt: toIsoNow(),
    lastDirection: "dump_to_firebase",
  };

  async function flushWrites() {
    if (!pendingWrites.length || config.dryRun) return;
    await db.commitWrites(pendingWrites.splice(0, pendingWrites.length));
    const committedAt = toIsoNow();
    pendingActivityRows.splice(0, pendingActivityRows.length).forEach((entry) => {
      emit("success", `${entry.table} row ${entry.id} pushed to Firebase.`, {
        ...entry.meta,
        pushedAt: committedAt,
      });
    });
  }

  function queueWrite(table, id, record) {
    if (config.dryRun) return;
    pendingWrites.push(db.makeUpsertWrite(table, id, record));
  }

  const parser = createSqlStatementParser(async (statement) => {
    stats.parsedStatements += 1;

    const createInfo = parseCreateTableStatement(statement);
    if (createInfo) {
      stats.parsedCreate += 1;
      if (tables.includes(createInfo.table)) {
        tableSchemas.set(createInfo.table, createInfo.columns);
      }
      return;
    }

    const insertInfo = parseInsertStatement(statement);
    if (!insertInfo) return;
    stats.parsedInsert += 1;
    if (!tables.includes(insertInfo.table)) return;

    const columns = insertInfo.columns && insertInfo.columns.length
      ? insertInfo.columns
      : tableSchemas.get(insertInfo.table);
    if (!columns?.length) return;

    const tuples = parseValueTuples(insertInfo.valuesPart);
    const tableStats = stats.tables[insertInfo.table];

    for (const tuple of tuples) {
      const record = toRecord(columns, tuple);
      const rowId = rowIdFromRecord(insertInfo.table, record, columns);
      if (!Number.isFinite(rowId) || rowId <= 0) continue;

      const watermarkInfo = watermarkMap.get(insertInfo.table) || { exists: false, lastId: 0 };
      const watermark = watermarkInfo.lastId || 0;

      if (!watermarkInfo.exists) {
        tableStats.watermarkAfter = Math.max(tableStats.watermarkAfter, rowId);
        tableStats.skipped += 1;
        stats.skippedRows += 1;
        continue;
      }

      if (rowId <= watermark) {
        stats.skippedRows += 1;
        tableStats.skipped += 1;
        continue;
      }

      const payload = sanitizeDumpRecord(insertInfo.table, record);
      queueWrite(insertInfo.table, rowId, payload);
      tableStats.watermarkAfter = Math.max(tableStats.watermarkAfter, rowId);
      tableStats.pushed += 1;
      stats.insertedRows += 1;

      if (tableStats.examples.length < 5) {
        const example = {
          id: rowId,
          fingerprint: recordFingerprint(insertInfo.table, rowId, payload),
        };
        if (insertInfo.table === "tbl_schedule") {
          example.serial = payload.serial ?? null;
          example.branch_id = payload.branch_id ?? null;
          example.task_datetime = payload.task_datetime ?? null;
        }
        if (insertInfo.table === "tbl_schedtime") {
          example.schedule_id = payload.schedule_id ?? null;
          example.time_in = payload.time_in ?? null;
          example.time_out = payload.time_out ?? null;
        }
        tableStats.examples.push(example);
        emit("info", `${insertInfo.table} row ${rowId} found in local dump.`, example);
        pendingActivityRows.push({
          table: insertInfo.table,
          id: rowId,
          meta: example,
        });
      }

      if (pendingWrites.length >= WRITE_BATCH_LIMIT) {
        await flushWrites();
      }
    }
  });

  const stream = fs.createReadStream(config.dumpPath, { encoding: "utf8", highWaterMark: CHUNK_SIZE_BYTES });
  for await (const chunk of stream) {
    await parser.consumeChunk(chunk, { final: false });
  }
  await parser.consumeChunk("", { final: true });
  await flushWrites();

  if (!config.dryRun) {
    for (const table of tables) {
      const tableStats = stats.tables[table];
      if (tableStats.baselineInitialized) {
        await db.patchDoc(SYNC_STATE_COLLECTION, table, {
          table,
          last_id: tableStats.watermarkAfter,
          updated_at: toIsoNow(),
          source: "local-dump-sync-baseline",
        });
        emit("info", `${table} baseline initialized from local dump.`, {
          lastId: tableStats.watermarkAfter,
        });
        continue;
      }
      if (tableStats.watermarkAfter <= tableStats.watermarkBefore) continue;
      await db.patchDoc(SYNC_STATE_COLLECTION, table, {
        table,
        last_id: tableStats.watermarkAfter,
        updated_at: toIsoNow(),
        source: "local-dump-sync",
      });
      emit("success", `${table} watermark updated.`, {
        before: tableStats.watermarkBefore,
        after: tableStats.watermarkAfter,
      });
    }
  }

  const report = {
    generatedAt: toIsoNow(),
    mode: config.dryRun ? "dry-run" : "write",
    baselineMode: "dump",
    dumpPath: config.dumpPath,
    summary: {
      insertedRows: stats.insertedRows,
      skippedRows: stats.skippedRows,
      baselineInitializedTables: tables.filter((table) => stats.tables[table]?.baselineInitialized),
      schedulePushed: stats.tables.tbl_schedule?.pushed || 0,
      schedtimePushed: stats.tables.tbl_schedtime?.pushed || 0,
      closedschedPushed: stats.tables.tbl_closedscheds?.pushed || 0,
      collectionhistoryInserts: 0,
      scheduleUpdates: stats.tables.tbl_schedule?.pushed || 0,
      schedtimeInserts: stats.tables.tbl_schedtime?.pushed || 0,
      schedtimeUpdates: 0,
      optionalClosedSchedInserts: stats.tables.tbl_closedscheds?.pushed || 0,
    },
    tables: stats.tables,
  };

  ensureDir(config.outDir);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  writeState(config.stateFile, {
    ...nextState,
    lastSuccessAt: toIsoNow(),
    lastErrorAt: null,
    lastErrorMessage: null,
    lastSummary: report.summary,
    lastBaselineMode: "dump",
    lastApplyMode: !config.dryRun,
    lastOutputs: {
      reportPath,
      dumpPath: config.dumpPath,
    },
    lastDumpSyncTables: tables,
  });

  emit("success", "Local dump scan completed.", {
    insertedRows: report.summary.insertedRows,
    skippedRows: report.summary.skippedRows,
  });

  return report;
}

export async function main() {
  const config = loadDumpSyncConfig();
  await runDumpToFirebase(config, {
    onActivity(level, message, meta) {
      console.log(`[${level}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
    },
  });
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}
