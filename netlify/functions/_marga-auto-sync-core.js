const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const zlib = require("zlib");

const SYNC_STATE_COLLECTION = "sys_sync_state";
const SYNC_STATE_DOC_ID = "marga_auto_sync";
const SYNC_NOTIFICATION_COLLECTION = "sys_sync_notifications";
const WRITE_BATCH_LIMIT = 300;
const ZERO_DATETIME = "0000-00-00 00:00:00";
const GOOGLE_SCOPE_DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_SCOPE_FIRESTORE = "https://www.googleapis.com/auth/datastore";

const googleTokenCache = new Map();

const DEFAULT_TABLES = [
  "tbl_billinfo",
  "tbl_billout",
  "tbl_billoutparticular",
  "tbl_billoutparticulars",
  "tbl_billing",
  "tbl_collection",
  "tbl_collectiondetails",
  "tbl_paymentinfo",
  "tbl_or",
  "tbl_check",
  "tbl_schedule",
  "tbl_schedtime",
  "tbl_closedscheds",
  "tbl_trouble",
  "tbl_mstatus",
  "tbl_machinerequest",
  "tbl_newmachinerepair",
  "tbl_newmachinehistory",
  "tbl_dispatchment",
  "tbl_delivery",
  "tbl_pullout",
  "tbl_companylist",
  "tbl_branchinfo",
  "tbl_branchcontact",
  "tbl_customerinfo",
  "tbl_customertype",
  "tbl_contractmain",
  "tbl_contractdetails",
  "tbl_contractinfo",
  "tbl_contracthistory",
  "tbl_machine",
];

const TABLE_ID_HINTS = {
  tbl_schedule: "id",
  tbl_schedtime: "id",
  tbl_closedscheds: "id",
  tbl_trouble: "id",
  tbl_machinerequest: "id",
  tbl_newmachinerepair: "id",
  tbl_newmachinehistory: "id",
  tbl_companylist: "id",
  tbl_branchinfo: "id",
  tbl_branchcontact: "id",
  tbl_customerinfo: "id",
  tbl_customertype: "id",
  tbl_machine: "id",
  tbl_contractmain: "id",
  tbl_contractdetails: "id",
  tbl_contractinfo: "id",
  tbl_contracthistory: "id",
  tbl_billinfo: "id",
};

function toIsoNow() {
  return new Date().toISOString();
}

function nowYmdInTimeZone(tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd || "").split("-").map((v) => Number(v));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function extractFirebaseConfig() {
  const apiKey = process.env.FIREBASE_API_KEY || process.env.FIRESTORE_API_KEY;
  const baseUrl = process.env.FIRESTORE_BASE_URL || process.env.FIREBASE_BASE_URL;
  if (apiKey && baseUrl) return { apiKey, baseUrl };

  const cfgPath = path.resolve(__dirname, "../../shared/js/firebase-config.js");
  const source = fs.readFileSync(cfgPath, "utf8");
  const fileApiKey = (source.match(/apiKey:\s*'([^']+)'/) || [])[1];
  const fileBaseUrl = (source.match(/baseUrl:\s*'([^']+)'/) || [])[1];
  if (!fileApiKey || !fileBaseUrl) {
    throw new Error("Unable to load Firebase config.");
  }
  return { apiKey: fileApiKey, baseUrl: fileBaseUrl };
}

function parseProjectAndDb(baseUrl) {
  const match = String(baseUrl || "").match(/projects\/([^/]+)\/databases\/\(([^)]+)\)\/documents/);
  if (!match) throw new Error("Invalid Firestore base URL.");
  return { projectId: match[1], databaseId: match[2] };
}

function toFirestoreField(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  return { stringValue: String(value) };
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
  if (!doc || !doc.fields) return null;
  const out = {};
  Object.entries(doc.fields).forEach(([k, v]) => {
    out[k] = parseFirestoreValue(v);
  });
  if (doc.name) out._docId = doc.name.split("/").pop();
  return out;
}

function parseBool(v, fallback = false) {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function parseIntSafe(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function parseTables() {
  const raw = String(process.env.MARGA_SYNC_TABLES || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!raw.length) return [...DEFAULT_TABLES];
  return [...new Set(raw)];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error_description || `${response.status} ${response.statusText}`);
  }
  return payload;
}

function hasGoogleServiceAccountCredentials() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

function withApiKey(url, apiKey) {
  if (!apiKey) return url;
  const joiner = String(url).includes("?") ? "&" : "?";
  return `${url}${joiner}key=${encodeURIComponent(apiKey)}`;
}

function createFirestoreClient({ apiKey, baseUrl }) {
  const { projectId, databaseId } = parseProjectAndDb(baseUrl);
  const dbSegment = String(databaseId || "").startsWith("(")
    ? String(databaseId)
    : `(${databaseId})`;
  const docRoot = `projects/${projectId}/databases/${dbSegment}/documents`;
  const preferServiceAccount = parseBool(process.env.FIRESTORE_USE_SERVICE_ACCOUNT, true);
  const useServiceAccount = preferServiceAccount && hasGoogleServiceAccountCredentials();

  async function firestoreFetch(url, options = {}) {
    const headers = {
      ...(options.headers || {}),
    };
    let targetUrl = url;

    if (useServiceAccount) {
      const token = await getGoogleAccessToken([GOOGLE_SCOPE_FIRESTORE]);
      headers.Authorization = `Bearer ${token}`;
    } else {
      targetUrl = withApiKey(url, apiKey);
    }

    return fetch(targetUrl, {
      ...options,
      headers,
    });
  }

  async function getDoc(collection, docId) {
    const url = `${baseUrl}/${encodeURIComponent(collection)}/${encodeURIComponent(String(docId))}`;
    const response = await firestoreFetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) return null;
    return parseFirestoreDoc(payload);
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
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbSegment}/documents:commit`;
    const response = await firestoreFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writes }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error?.message || `Firestore commit failed (${response.status})`);
    }
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

  return {
    getDoc,
    patchDoc,
    commitWrites,
    makeUpsertWrite,
  };
}

async function getWatermarkMap(db, tables) {
  const out = new Map();
  for (const table of tables) {
    const state = await db.getDoc(SYNC_STATE_COLLECTION, table);
    const lastId = Number(state?.last_id || 0);
    out.set(table, Number.isFinite(lastId) ? Math.trunc(lastId) : 0);
  }
  return out;
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
    if (sql.startsWith("--") || sql.startsWith("#")) {
      const newlineIdx = sql.indexOf("\n");
      if (newlineIdx === -1) return "";
      sql = sql.slice(newlineIdx + 1).trimStart();
      continue;
    }
  }
  return sql.trim();
}

function parseCreateTableStatement(statement) {
  const cleaned = cleanLeadingComments(statement);
  const match = cleaned.match(/^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([A-Za-z0-9_]+)`?\s*\(([\s\S]+)\)\s*(ENGINE|DEFAULT|;)/i);
  if (!match) return null;
  const table = String(match[1] || "").toLowerCase();
  const body = String(match[2] || "");
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const columns = [];
  let autoIncrementColumn = null;
  lines.forEach((line) => {
    if (!line.startsWith("`")) return;
    const colMatch = line.match(/^`([^`]+)`/);
    if (!colMatch) return;
    const col = colMatch[1];
    columns.push(col);
    if (/AUTO_INCREMENT/i.test(line)) autoIncrementColumn = col;
  });
  return { table, columns, autoIncrementColumn };
}

function parseColumnList(rawColumns) {
  return String(rawColumns || "")
    .split(",")
    .map((col) => col.replace(/`/g, "").trim())
    .filter(Boolean);
}

function parseInsertStatement(statement) {
  const cleaned = cleanLeadingComments(statement);
  const match = cleaned.match(/^INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?\s*(\(([\s\S]*?)\))?\s*VALUES\s*([\s\S]+)$/i);
  if (!match) return null;
  const table = String(match[1] || "").toLowerCase();
  const columns = match[3] ? parseColumnList(match[3]) : null;
  const valuesPart = String(match[4] || "").trim().replace(/;$/, "");
  return { table, columns, valuesPart };
}

function parseSqlValue(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  if (/^NULL$/i.test(token)) return null;
  if (/^true$/i.test(token)) return true;
  if (/^false$/i.test(token)) return false;
  if (/^0b[01]+$/i.test(token)) return parseInt(token.slice(2), 2);
  if (/^-?\d+$/.test(token)) return Number(token);
  if (/^-?\d+\.\d+$/.test(token)) return Number(token);
  return token;
}

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

function rowIdFromRecord(table, record, columns) {
  const hint = TABLE_ID_HINTS[table];
  if (hint && Number.isFinite(Number(record?.[hint]))) return Math.trunc(Number(record[hint]));
  if (Number.isFinite(Number(record?.id))) return Math.trunc(Number(record.id));
  const first = columns?.[0];
  if (first && Number.isFinite(Number(record?.[first]))) return Math.trunc(Number(record[first]));
  return null;
}

function toRecord(columns, tuple) {
  const record = {};
  columns.forEach((col, idx) => {
    record[col] = tuple[idx];
  });
  return record;
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

  return {
    consumeChunk,
  };
}

async function parseSqlStatements(sqlText, onStatement) {
  const parser = createSqlStatementParser(onStatement);
  await parser.consumeChunk(sqlText, { final: true });
}

async function parseSqlStatementsFromStream(sqlStream, onStatement, onChunk) {
  const parser = createSqlStatementParser(onStatement);
  const decoder = new TextDecoder("utf-8");

  for await (const chunk of sqlStream) {
    const asBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (onChunk) await onChunk(asBuffer.length);
    const text = decoder.decode(asBuffer, { stream: true });
    if (text) {
      await parser.consumeChunk(text, { final: false });
    }
  }

  const tail = decoder.decode();
  if (tail) {
    await parser.consumeChunk(tail, { final: false });
  }
  await parser.consumeChunk("", { final: true });
}

function sanitizePrivateKey(key) {
  if (!key) return "";
  return String(key).replace(/\\n/g, "\n");
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken(scopes = [GOOGLE_SCOPE_DRIVE_READONLY]) {
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = sanitizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!serviceEmail || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.");
  }

  const normalizedScopes = [...new Set(scopes.map((s) => String(s || "").trim()).filter(Boolean))];
  const scopeKey = normalizedScopes.join(" ");
  const cached = googleTokenCache.get(scopeKey);
  const nowTs = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > nowTs + 60) {
    return cached.accessToken;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const now = nowTs;
  const claim = {
    iss: serviceEmail,
    scope: scopeKey,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
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
  const accessToken = payload.access_token;
  const expiresIn = Number(payload.expires_in || 3600);
  googleTokenCache.set(scopeKey, {
    accessToken,
    expiresAt: nowTs + Math.max(300, expiresIn - 30),
  });
  return accessToken;
}

async function driveList(token, q, opts = {}) {
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("fields", opts.fields || "files(id,name,mimeType,modifiedTime,size),nextPageToken");
  params.set("pageSize", String(opts.pageSize || 100));
  if (opts.orderBy) params.set("orderBy", opts.orderBy);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Google Drive list failed: ${response.status}`);
  }
  return payload;
}

async function resolveDriveFolderId(token, folderPath) {
  const segments = String(folderPath || "")
    .split("/")
    .map((v) => v.trim())
    .filter(Boolean);
  let parentId = process.env.GOOGLE_DRIVE_ROOT_ID || "root";
  for (const name of segments) {
    const q = `'${parentId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}'`;
    const data = await driveList(token, q, { pageSize: 10 });
    const folder = (data.files || [])[0];
    if (!folder) throw new Error(`Drive folder segment not found: ${name}`);
    parentId = folder.id;
  }
  return parentId;
}

function extractDateFromFilename(name) {
  const s = String(name || "");
  const hyphen = s.match(/(20\d{2})[-_](\d{2})[-_](\d{2})/);
  if (hyphen) return `${hyphen[1]}-${hyphen[2]}-${hyphen[3]}`;
  const compact = s.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return null;
}

function pickDriveFile(files, targetDate, mode) {
  if (!Array.isArray(files) || !files.length) return null;
  const normalized = files
    .filter((f) => String(f.name || "").toLowerCase().includes(".sql"))
    .map((f) => ({ ...f, fileDate: extractDateFromFilename(f.name) }));
  if (!normalized.length) return null;

  if (targetDate) {
    const exact = normalized.find((f) => f.fileDate === targetDate);
    if (exact) return exact;
  }

  if (mode === "morning" && targetDate) {
    const candidates = normalized.filter((f) => (f.fileDate || "") <= targetDate);
    if (candidates.length) return candidates[0];
  }

  return normalized[0];
}

async function downloadDriveFileStream(token, file) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed downloading Drive file ${file.name}: ${response.status} ${text}`);
  }
  if (!response.body) {
    throw new Error(`No response body when downloading Drive file ${file.name}.`);
  }
  const nodeStream = Readable.fromWeb(response.body);
  const lowerName = String(file.name || "").toLowerCase();
  if (lowerName.endsWith(".gz")) {
    return nodeStream.pipe(zlib.createGunzip());
  }
  if (lowerName.endsWith(".zip")) {
    throw new Error("ZIP SQL dumps are not supported yet. Please upload .sql or .sql.gz.");
  }
  return nodeStream;
}

async function sendWebhookNotification(payload) {
  const url = process.env.MARGA_NOTIFY_WEBHOOK_URL;
  if (!url) return { sent: false, reason: "MARGA_NOTIFY_WEBHOOK_URL not configured" };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`Webhook notify failed: ${response.status} ${text}`);
  return { sent: true };
}

async function sendResendEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.MARGA_NOTIFY_EMAIL_TO;
  const from = process.env.MARGA_NOTIFY_EMAIL_FROM || "Marga Sync <noreply@marga.biz>";
  if (!apiKey || !to) return { sent: false, reason: "RESEND_API_KEY or MARGA_NOTIFY_EMAIL_TO not configured" };
  const subject = payload.ok
    ? `Marga Auto Sync Success (${payload.targetDate})`
    : `Marga Auto Sync Failed (${payload.targetDate})`;
  const html = [
    `<p><strong>Status:</strong> ${payload.ok ? "Success" : "Failed"}</p>`,
    `<p><strong>Mode:</strong> ${payload.mode}</p>`,
    `<p><strong>Date:</strong> ${payload.targetDate}</p>`,
    `<p><strong>File:</strong> ${payload.fileName || "-"}</p>`,
    `<p><strong>Inserted:</strong> ${payload.insertedRows || 0}</p>`,
    `<p><strong>Skipped:</strong> ${payload.skippedRows || 0}</p>`,
    payload.error ? `<p><strong>Error:</strong> ${String(payload.error)}</p>` : "",
  ].join("");
  const body = {
    from,
    to: [to],
    subject,
    html,
  };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Resend email failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return { sent: true, id: data?.id || null };
}

async function writeNotificationDoc(db, payload) {
  const id = `marga_auto_sync_${Date.now()}`;
  await db.patchDoc(SYNC_NOTIFICATION_COLLECTION, id, payload);
  return id;
}

function buildSummaryText(payload) {
  if (payload.ok) {
    return `Marga auto-sync completed (${payload.mode}) | file=${payload.fileName || "-"} | inserted=${payload.insertedRows || 0} | skipped=${payload.skippedRows || 0}`;
  }
  return `Marga auto-sync FAILED (${payload.mode}) | ${payload.error || "unknown error"}`;
}

async function runAutoSync(mode = "manual", opts = {}) {
  const timezone = process.env.MARGA_SYNC_TIMEZONE || "Asia/Manila";
  const todayYmd = nowYmdInTimeZone(timezone);
  const targetDate = mode === "morning" ? addDaysYmd(todayYmd, -1) : todayYmd;

  const log = [];
  const tables = parseTables();
  const writeEnabled = parseBool(process.env.MARGA_SYNC_WRITE_ENABLED, true);
  const queryLimit = Math.max(1000, parseIntSafe(process.env.MARGA_SYNC_QUERY_LIMIT, 20000));

  const firebaseCfg = extractFirebaseConfig();
  const db = createFirestoreClient(firebaseCfg);
  const state = (await db.getDoc(SYNC_STATE_COLLECTION, SYNC_STATE_DOC_ID)) || {};

  if (
    mode === "morning" &&
    String(state.last_success_target_date || "") >= String(targetDate || "") &&
    !opts.force
  ) {
    return {
      ok: true,
      skipped: true,
      reason: "Morning retry skipped because target date already synced.",
      mode,
      targetDate,
      log,
    };
  }

  log.push(`Mode=${mode} targetDate=${targetDate}`);

  const drivePath = process.env.GOOGLE_DRIVE_FOLDER_PATH || "work/marga/marga database";
  const token = await getGoogleAccessToken([GOOGLE_SCOPE_DRIVE_READONLY]);
  const folderId = await resolveDriveFolderId(token, drivePath);
  log.push(`Drive folder resolved: ${folderId}`);

  const listData = await driveList(
    token,
    `'${folderId}' in parents and trashed = false`,
    { pageSize: 100, orderBy: "modifiedTime desc" }
  );
  const files = (listData.files || []).filter((f) => /\.sql(\.gz)?$/i.test(String(f.name || "")));
  if (!files.length) {
    throw new Error("No .sql or .sql.gz files found in Drive folder.");
  }

  const selected = pickDriveFile(files, targetDate, mode);
  if (!selected) {
    throw new Error(`No SQL file candidate found for target date ${targetDate}.`);
  }
  log.push(`Selected file: ${selected.name} (${selected.id}) modified=${selected.modifiedTime}`);

  if (!opts.force && String(state.last_success_file_id || "") === String(selected.id || "")) {
    return {
      ok: true,
      skipped: true,
      reason: "Latest SQL file already synced.",
      mode,
      targetDate,
      fileName: selected.name,
      fileId: selected.id,
      log,
    };
  }

  const sqlStream = await downloadDriveFileStream(token, selected);
  let downloadedBytes = 0;

  const tableSchemas = new Map();
  const watermarkMap = await getWatermarkMap(db, tables);
  const stats = {
    parsedStatements: 0,
    parsedCreate: 0,
    parsedInsert: 0,
    insertedRows: 0,
    skippedRows: 0,
    tables: {},
  };

  tables.forEach((table) => {
    stats.tables[table] = {
      table,
      watermarkBefore: watermarkMap.get(table) || 0,
      watermarkAfter: watermarkMap.get(table) || 0,
      inserted: 0,
      skipped: 0,
    };
  });

  const pendingWrites = [];
  async function flushWrites() {
    if (!pendingWrites.length || !writeEnabled) {
      pendingWrites.length = 0;
      return;
    }
    await db.commitWrites(pendingWrites.splice(0, pendingWrites.length));
  }

  function queueWrite(write) {
    if (!writeEnabled) return;
    pendingWrites.push(write);
  }

  await parseSqlStatementsFromStream(sqlStream, async (statement) => {
    stats.parsedStatements += 1;
    const createInfo = parseCreateTableStatement(statement);
    if (createInfo) {
      stats.parsedCreate += 1;
      tableSchemas.set(createInfo.table, createInfo.columns || []);
      return;
    }

    const insertInfo = parseInsertStatement(statement);
    if (!insertInfo) return;
    stats.parsedInsert += 1;

    const table = insertInfo.table;
    if (!watermarkMap.has(table)) return;

    const columns = insertInfo.columns && insertInfo.columns.length
      ? insertInfo.columns
      : tableSchemas.get(table);
    if (!columns || !columns.length) {
      return;
    }

    const tuples = parseValueTuples(insertInfo.valuesPart);
    for (const tuple of tuples) {
      const record = toRecord(columns, tuple);
      const rowId = rowIdFromRecord(table, record, columns);
      if (!Number.isFinite(rowId) || rowId <= 0) {
        stats.skippedRows += 1;
        stats.tables[table].skipped += 1;
        continue;
      }
      const watermark = watermarkMap.get(table) || 0;
      if (rowId <= watermark) {
        stats.skippedRows += 1;
        stats.tables[table].skipped += 1;
        continue;
      }
      if (!record.id) record.id = rowId;
      if (!record.updated_at) record.updated_at = toIsoNow();
      if (record.date_finished === undefined || record.date_finished === null || record.date_finished === "") {
        record.date_finished = record.date_finished ?? ZERO_DATETIME;
      }
      queueWrite(db.makeUpsertWrite(table, rowId, record));
      stats.insertedRows += 1;
      stats.tables[table].inserted += 1;
      stats.tables[table].watermarkAfter = Math.max(stats.tables[table].watermarkAfter, rowId);

      if (pendingWrites.length >= WRITE_BATCH_LIMIT) {
        await flushWrites();
      }
    }
  }, async (chunkBytes) => {
    downloadedBytes += Number(chunkBytes || 0);
  });

  log.push(`Downloaded SQL bytes=${downloadedBytes}`);

  await flushWrites();

  if (writeEnabled) {
    for (const table of tables) {
      const t = stats.tables[table];
      if (!t || !t.inserted) continue;
      await db.patchDoc(SYNC_STATE_COLLECTION, table, {
        table,
        last_id: t.watermarkAfter,
        updated_at: toIsoNow(),
        source: "marga-auto-sync",
      });
    }
  }

  const result = {
    ok: true,
    mode,
    targetDate,
    fileId: selected.id,
    fileName: selected.name,
    fileModifiedTime: selected.modifiedTime,
    writeEnabled,
    queryLimit,
    insertedRows: stats.insertedRows,
    skippedRows: stats.skippedRows,
    parsedStatements: stats.parsedStatements,
    parsedCreate: stats.parsedCreate,
    parsedInsert: stats.parsedInsert,
    tables: stats.tables,
    log,
  };

  if (writeEnabled) {
    const runTs = toIsoNow();
    await db.patchDoc(SYNC_STATE_COLLECTION, SYNC_STATE_DOC_ID, {
      last_run_at: runTs,
      last_success_target_date: targetDate,
      last_success_file_id: selected.id,
      last_success_file_name: selected.name,
      last_success_file_modified_time: selected.modifiedTime,
      last_success_at: runTs,
      last_run_mode: mode,
      last_run_ok: true,
      last_run_error: "",
      last_run_summary: buildSummaryText(result),
      last_inserted_rows: stats.insertedRows,
      last_skipped_rows: stats.skippedRows,
      updated_at: runTs,
    });
  }

  const notifyPayload = {
    ok: true,
    mode,
    targetDate,
    fileName: selected.name,
    fileId: selected.id,
    insertedRows: stats.insertedRows,
    skippedRows: stats.skippedRows,
    generatedAt: toIsoNow(),
    summary: buildSummaryText(result),
  };

  const notifyResult = {
    webhook: null,
    email: null,
    notificationDocId: null,
  };
  try {
    notifyResult.webhook = await sendWebhookNotification(notifyPayload);
  } catch (err) {
    notifyResult.webhook = { sent: false, error: err.message || String(err) };
  }
  try {
    notifyResult.email = await sendResendEmail(notifyPayload);
  } catch (err) {
    notifyResult.email = { sent: false, error: err.message || String(err) };
  }
  try {
    notifyResult.notificationDocId = await writeNotificationDoc(db, {
      ...notifyPayload,
      webhook: notifyResult.webhook,
      email: notifyResult.email,
    });
  } catch (err) {
    notifyResult.notificationDocId = null;
    log.push(`Notification doc write failed: ${err.message || String(err)}`);
  }

  return { ...result, notifications: notifyResult };
}

async function runAutoSyncWithFailureHandling(mode, opts = {}) {
  try {
    return await runAutoSync(mode, opts);
  } catch (error) {
    const db = createFirestoreClient(extractFirebaseConfig());
    const payload = {
      ok: false,
      mode,
      targetDate: mode === "morning"
        ? addDaysYmd(nowYmdInTimeZone(process.env.MARGA_SYNC_TIMEZONE || "Asia/Manila"), -1)
        : nowYmdInTimeZone(process.env.MARGA_SYNC_TIMEZONE || "Asia/Manila"),
      error: error?.message || String(error),
      generatedAt: toIsoNow(),
    };
    try {
      await db.patchDoc(SYNC_STATE_COLLECTION, SYNC_STATE_DOC_ID, {
        last_run_at: toIsoNow(),
        last_run_mode: mode,
        last_run_ok: false,
        last_run_error: payload.error,
        updated_at: toIsoNow(),
      });
    } catch (_) {}
    try {
      await sendWebhookNotification({
        ...payload,
        summary: buildSummaryText(payload),
      });
    } catch (_) {}
    try {
      await sendResendEmail({
        ...payload,
        summary: buildSummaryText(payload),
      });
    } catch (_) {}
    try {
      await writeNotificationDoc(db, payload);
    } catch (_) {}
    return payload;
  }
}

module.exports = {
  runAutoSyncWithFailureHandling,
};
