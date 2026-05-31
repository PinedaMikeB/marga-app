#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents";
const DEFAULT_FIREBASE_API_KEY = "margabase-local";
const LEGACY_FIRESTORE_HOST = "firestore.googleapis.com";
const ZERO_DATETIME = "0000-00-00 00:00:00";
const ROUTE_COLLECTIONS = ["tbl_printedscheds", "tbl_savedscheds"];
const DEFAULT_LOOKBACK_DAYS = 45;

function clean(value) {
  return String(value ?? "").trim();
}

function todayManila() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeLegacyDateTime(value) {
  const text = clean(value);
  if (!text) return "";
  const compact = text.replace(/[T]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (["", ZERO_DATETIME, "undefined", "undefined 00:00:00", "null", "null 00:00:00", "invalid date", "nan"].includes(compact)) return "";
  return text;
}

function parseArgs(argv) {
  const args = {
    date: todayManila(),
    startDate: "",
    apply: false,
    lookbackDays: DEFAULT_LOOKBACK_DAYS,
    rowLimit: 50
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--date" && next) {
      args.date = next;
      index += 1;
    } else if (token === "--start-date" && next) {
      args.startDate = next;
      index += 1;
    } else if (token === "--lookback-days" && next) {
      args.lookbackDays = Math.max(1, Number(next) || DEFAULT_LOOKBACK_DAYS);
      index += 1;
    } else if (token === "--row-limit" && next) {
      args.rowLimit = Math.max(0, Number(next) || 0);
      index += 1;
    } else if (token === "--apply") {
      args.apply = true;
    }
  }
  if (!args.startDate) args.startDate = addDays(args.date, -args.lookbackDays);
  return args;
}

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
      const [key, ...rest] = trimmed.split("=");
      if (!process.env[key]) process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
    });
  } catch {
    // Optional.
  }
}

function parseFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  return null;
}

function parseFirestoreDoc(doc) {
  const parsed = { _docId: String(doc?.name || "").split("/").pop() || "" };
  Object.entries(doc?.fields || {}).forEach(([key, value]) => {
    parsed[key] = parseFirestoreValue(value);
  });
  return parsed;
}

function firestoreValue(value) {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return { integerValue: String(Math.trunc(value)) };
  return { stringValue: String(value ?? "") };
}

class FirestoreClient {
  constructor() {
    this.baseUrl = process.env.FIRESTORE_BASE_URL || DEFAULT_BASE_URL;
    this.apiKey = process.env.FIREBASE_API_KEY || DEFAULT_FIREBASE_API_KEY;
    if (this.baseUrl.includes(LEGACY_FIRESTORE_HOST) && process.env.ALLOW_LEGACY_FIREBASE_WRITES !== "1") {
      throw new Error("Blocked legacy Firebase backend. Set ALLOW_LEGACY_FIREBASE_WRITES=1 only for an explicitly approved rescue.");
    }
  }

  async query(structuredQuery) {
    const response = await fetch(`${this.baseUrl}:runQuery?key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json();
    if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) {
      throw new Error(payload?.error?.message || payload?.[0]?.error?.message || "Firestore query failed.");
    }
    return Array.isArray(payload) ? payload.map((row) => row.document).filter(Boolean).map(parseFirestoreDoc) : [];
  }

  async queryDateRange(collectionId, fieldPath, start, end, limit = 5000) {
    return this.query({
      from: [{ collectionId }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            { fieldFilter: { field: { fieldPath }, op: "GREATER_THAN_OR_EQUAL", value: firestoreValue(start) } },
            { fieldFilter: { field: { fieldPath }, op: "LESS_THAN_OR_EQUAL", value: firestoreValue(end) } }
          ]
        }
      },
      limit
    });
  }

  async update(collection, docId, row) {
    const entries = Object.entries(row).filter(([key]) => !key.startsWith("_"));
    const params = new URLSearchParams({ key: this.apiKey });
    entries.forEach(([key]) => params.append("updateMask.fieldPaths", key));
    const fields = {};
    entries.forEach(([key, value]) => {
      fields[key] = firestoreValue(value);
    });
    const response = await fetch(`${this.baseUrl}/${collection}/${encodeURIComponent(String(docId))}?${params}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to update ${collection}/${docId}`);
    return payload;
  }
}

function isOpenRoute(row) {
  if (Number(row.iscancel || row.iscancelled || 0) === 1) return false;
  if (normalizeLegacyDateTime(row.date_finished)) return false;
  const status = row.status === "" || row.status === undefined || row.status === null ? null : Number(row.status);
  return status !== 0;
}

function isClosedSchedule(row) {
  return normalizeLegacyDateTime(row.date_finished) || Number(row.closedby || 0) > 0;
}

function assignmentIssue(row) {
  const staffId = Number(row.tech_id || row.assigned_to_id || row.assigned_staff_id || 0) || 0;
  const staffName = clean(row.assigned_to || row.assigned_staff_name || row.field_billing_assigned_staff_name);
  if (!staffId) return "missing staff id";
  if (/^(unassigned|suggested \/ unassigned|others?)$/i.test(staffName)) return "invalid staff name";
  if (Number(row.purpose_id || 0) === 9) return "purpose is Others";
  return "";
}

async function main() {
  await loadEnvFile("/Users/mike/.codex/env/marga-app.env");
  const args = parseArgs(process.argv);
  const db = new FirestoreClient();
  const start = `${args.startDate} 00:00:00`;
  const end = `${args.date} 23:59:59`;

  const [scheduleRows, ...routeSets] = await Promise.all([
    db.queryDateRange("tbl_schedule", "task_datetime", start, end),
    ...ROUTE_COLLECTIONS.map((collection) => db.queryDateRange(collection, "task_datetime", start, end))
  ]);
  const scheduleById = new Map(scheduleRows.map((row) => [Number(row.id || row._docId || 0), row]).filter(([id]) => id > 0));
  const routeRows = routeSets.flatMap((rows, index) => rows.map((row) => ({ ...row, _collection: ROUTE_COLLECTIONS[index] })));

  const invalidAssignments = scheduleRows
    .map((row) => ({ row, issue: assignmentIssue(row) }))
    .filter((item) => item.issue);

  const staleOpenRoutes = routeRows.filter((route) => {
    if (!isOpenRoute(route)) return false;
    const schedule = scheduleById.get(Number(route.schedule_id || 0));
    return schedule && isClosedSchedule(schedule);
  });

  const nowIso = new Date().toISOString();
  const repaired = [];
  for (const route of staleOpenRoutes) {
    const schedule = scheduleById.get(Number(route.schedule_id || 0));
    const dateFinished = normalizeLegacyDateTime(schedule.date_finished) || nowIso;
    const patch = {
      status: 0,
      date_finished: dateFinished,
      remarks: `${clean(route.remarks || schedule.remarks || schedule.caller || "")} | Closed by master schedule repair`,
      bridge_pushed_at: nowIso
    };
    if (args.apply) await db.update(route._collection, route._docId || route.id, patch);
    repaired.push({
      collection: route._collection,
      routeDocId: route._docId || route.id,
      scheduleId: Number(route.schedule_id || 0),
      dateFinished
    });
  }

  console.log(JSON.stringify({
    date: args.date,
    startDate: args.startDate,
    apply: args.apply,
    scannedSchedules: scheduleRows.length,
    scannedRoutes: routeRows.length,
    invalidAssignments: invalidAssignments.length,
    staleOpenRoutes: staleOpenRoutes.length,
    plannedRouteRepairs: repaired.length,
    appliedRouteRepairs: args.apply ? repaired.length : 0,
    invalidRows: invalidAssignments.slice(0, args.rowLimit).map(({ row, issue }) => ({
      scheduleId: Number(row.id || row._docId || 0),
      taskDate: clean(row.task_datetime).slice(0, 10),
      techId: Number(row.tech_id || 0) || 0,
      purposeId: Number(row.purpose_id || 0) || 0,
      issue
    })),
    repaired: repaired.slice(0, args.rowLimit)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
