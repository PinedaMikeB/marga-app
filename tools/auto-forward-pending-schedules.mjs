#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents";
const DEFAULT_MARGABASE_API_KEY = "margabase-local";
const LEGACY_FIRESTORE_HOST = "firestore.googleapis.com";
const ZERO_DATETIME = "0000-00-00 00:00:00";
const ROUTE_COLLECTION = "tbl_savedscheds";
const PRINTED_ROUTE_COLLECTION = "tbl_printedscheds";
const CLOSE_REQUEST_COLLECTION = "tbl_schedule_close_requests";
const LOOKBACK_DAYS = 45;
const DEFAULT_START_DATE = "2026-05-04";

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
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function normalizeLegacyDateTime(value) {
  const text = clean(value);
  if (!text) return "";
  const compact = text.replace(/[T]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (["", ZERO_DATETIME, "undefined", "undefined 00:00:00", "null", "null 00:00:00", "invalid date", "nan"].includes(compact)) return "";
  return text;
}

function dateOnly(value) {
  return clean(value).slice(0, 10);
}

function routeTimePart(row) {
  const source = clean(row.task_datetime || row.original_sched);
  const time = source.slice(11, 19);
  if (!/^\d{2}:\d{2}/.test(time)) return "08:00:00";
  return time.length >= 8 ? time.slice(0, 8) : `${time}:00`;
}

function routeDateTimeFor(row, targetDate) {
  return `${targetDate} ${routeTimePart(row)}`;
}

function routeDocIdFor(scheduleId, targetDate) {
  const datePart = String(targetDate || "").replace(/[^0-9]/g, "");
  return `auto_${datePart}_${Number(scheduleId || 0) || 0}`;
}

function parseArgs(argv) {
  const args = {
    date: todayManila(),
    targetDate: "",
    startDate: DEFAULT_START_DATE,
    dryRun: false,
    lookbackDays: LOOKBACK_DAYS
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--date" && next) {
      args.date = next;
      index += 1;
    } else if (token === "--target-date" && next) {
      args.targetDate = next;
      index += 1;
    } else if (token === "--lookback-days" && next) {
      args.lookbackDays = Math.max(1, Number(next) || LOOKBACK_DAYS);
      index += 1;
    } else if (token === "--start-date" && next) {
      args.startDate = next;
      index += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    }
  }
  if (!args.targetDate) args.targetDate = addDays(args.date, 1);
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
    this.baseUrl = process.env.MARGABASE_DOCUMENTS_BASE_URL
      || process.env.MARGABASE_FIRESTORE_BASE_URL
      || process.env.FIRESTORE_BASE_URL
      || DEFAULT_BASE_URL;
    this.apiKey = process.env.MARGABASE_API_KEY || process.env.FIREBASE_API_KEY || DEFAULT_MARGABASE_API_KEY;
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

  async queryCollection(collectionId, limit = 5000) {
    return this.query({
      from: [{ collectionId }],
      limit
    });
  }

  async set(collection, docId, row) {
    const fields = {};
    Object.entries(row).forEach(([key, value]) => {
      if (!key.startsWith("_")) fields[key] = firestoreValue(value);
    });
    const response = await fetch(`${this.baseUrl}/${collection}/${encodeURIComponent(String(docId))}?key=${this.apiKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to save ${collection}/${docId}`);
    return payload;
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

function isOpenSchedule(row, cutoffDate) {
  const scheduleId = Number(row.id || row._docId || 0);
  if (!scheduleId) return false;
  if (Number(row.tech_id || 0) <= 0) return false;
  if (Number(row.iscancel || row.iscancelled || 0) === 1) return false;
  if (normalizeLegacyDateTime(row.date_finished) || Number(row.closedby || 0) > 0) return false;
  const taskDate = dateOnly(row.task_datetime);
  return Boolean(taskDate && taskDate <= cutoffDate);
}

function routeScheduleId(row) {
  return Number(row.schedule_id || row.id || row._docId || 0) || 0;
}

function isClosedOrCancelledRoute(row) {
  if (Number(row.iscancel || row.iscancelled || 0) === 1) return true;
  if (normalizeLegacyDateTime(row.date_finished)) return true;
  const status = row.status === "" || row.status === undefined || row.status === null
    ? null
    : Number(row.status);
  return status === 0;
}

function isApprovedCloseRequest(row) {
  const status = clean(row.status || "").toLowerCase();
  return ["approved", "closed", "completed", "done"].includes(status) || Boolean(normalizeLegacyDateTime(row.closed_schedule_at));
}

function hasValidAssignment(row) {
  const staffId = Number(row.tech_id || row.assigned_to_id || row.assigned_staff_id || 0) || 0;
  const purposeId = Number(row.purpose_id || 0) || 0;
  const name = clean(row.assigned_to || row.assigned_staff_name || row.field_billing_assigned_staff_name);
  if (!staffId) return false;
  if (purposeId === 9) return false;
  if (/^(unassigned|suggested \/ unassigned|others?)$/i.test(name)) return false;
  return true;
}

async function main() {
  await loadEnvFile("/Users/mike/.codex/env/marga-app.env");
  const args = parseArgs(process.argv);
  const db = new FirestoreClient();
  const lookbackDate = addDays(args.date, -args.lookbackDays);
  const startDate = args.startDate && args.startDate > lookbackDate ? args.startDate : lookbackDate;
  const [scheduleRows, savedSourceRoutes, printedSourceRoutes, targetRoutes, closeRequestRows] = await Promise.all([
    db.queryDateRange("tbl_schedule", "task_datetime", `${startDate} 00:00:00`, `${args.date} 23:59:59`),
    db.queryDateRange(ROUTE_COLLECTION, "task_datetime", `${startDate} 00:00:00`, `${args.date} 23:59:59`),
    db.queryDateRange(PRINTED_ROUTE_COLLECTION, "task_datetime", `${startDate} 00:00:00`, `${args.date} 23:59:59`).catch(() => []),
    db.queryDateRange(ROUTE_COLLECTION, "task_datetime", `${args.targetDate} 00:00:00`, `${args.targetDate} 23:59:59`),
    db.queryCollection(CLOSE_REQUEST_COLLECTION).catch(() => [])
  ]);

  const sourceRoutes = [...savedSourceRoutes, ...printedSourceRoutes];
  const alreadyRouted = new Set(targetRoutes.map((row) => Number(row.schedule_id || 0)).filter(Boolean));
  const closedRouteScheduleIds = new Set(sourceRoutes
    .filter(isClosedOrCancelledRoute)
    .map(routeScheduleId)
    .filter(Boolean));
  const approvedCloseRequestScheduleIds = new Set(closeRequestRows
    .filter(isApprovedCloseRequest)
    .map((row) => Number(row.schedule_id || 0))
    .filter(Boolean));
  const blockedClosedScheduleIds = new Set([
    ...closedRouteScheduleIds,
    ...approvedCloseRequestScheduleIds
  ]);
  const sourceRoutesBySchedule = new Map();
  sourceRoutes.forEach((route) => {
    if (Number(route.iscancel || route.iscancelled || 0) === 1) return;
    if (normalizeLegacyDateTime(route.date_finished)) return;
    const scheduleId = Number(route.schedule_id || 0);
    if (!scheduleId) return;
    if (!sourceRoutesBySchedule.has(scheduleId)) sourceRoutesBySchedule.set(scheduleId, []);
    sourceRoutesBySchedule.get(scheduleId).push(route);
  });
  const openRows = scheduleRows.filter((row) => isOpenSchedule(row, args.date));
  const assignmentBlockedRows = openRows.filter((row) => !hasValidAssignment(row));
  const candidates = openRows
    .filter(hasValidAssignment)
    .filter((row) => !blockedClosedScheduleIds.has(Number(row.id || row._docId || 0)))
    .filter((row) => !alreadyRouted.has(Number(row.id || row._docId || 0)));

  const nowIso = new Date().toISOString();
  const forwarded = [];
  let cancelledSourceRoutes = 0;
  for (const row of candidates) {
    const scheduleId = Number(row.id || row._docId || 0);
    const staffId = Number(row.tech_id || 0);
    const routeDocId = routeDocIdFor(scheduleId, args.targetDate);
    const routeNumericId = Number(`${args.targetDate.replace(/[^0-9]/g, "")}${String(forwarded.length + 1).padStart(5, "0")}`);
    const targetDateTime = routeDateTimeFor(row, args.targetDate);
    const routePayload = {
      id: routeNumericId,
      schedule_id: scheduleId,
      tech_id: staffId,
      task_datetime: targetDateTime,
      status: 1,
      iscancelled: 0,
      date_finished: ZERO_DATETIME,
      remarks: clean(row.remarks || row.caller || ""),
      forwarded_from_date: dateOnly(row.task_datetime),
      forwarded_from_schedule_id: scheduleId,
      forwarded_by: "Auto Carryover 6PM",
      forwarded_at: nowIso,
      auto_carryover: 1,
      timestmp: nowIso,
      bridge_pushed_at: nowIso
    };
    const schedulePayload = {
      task_datetime: targetDateTime,
      tech_id: staffId,
      date_finished: ZERO_DATETIME,
      closedby: 0,
      master_schedule_status: "open",
      master_schedule_status_label: "Open",
      master_schedule_status_updated_at: nowIso,
      master_schedule_status_updated_by: "Auto Carryover 6PM",
      auto_carryover_forwarded_at: nowIso,
      auto_carryover_target_date: args.targetDate
    };
    if (!normalizeLegacyDateTime(row.original_sched)) schedulePayload.original_sched = clean(row.task_datetime);
    if (!args.dryRun) {
      await db.set(ROUTE_COLLECTION, routeDocId, routePayload);
      await db.update("tbl_schedule", row._docId || String(scheduleId), schedulePayload);
      const oldRoutes = sourceRoutesBySchedule.get(scheduleId) || [];
      for (const oldRoute of oldRoutes) {
        await db.update(ROUTE_COLLECTION, oldRoute._docId || oldRoute.id, {
          status: 0,
          iscancelled: 1,
          date_finished: nowIso,
          remarks: `${clean(oldRoute.remarks || row.remarks || row.caller || "")} | Auto-carried over to ${args.targetDate}`,
          forwarded_to_date: args.targetDate,
          superseded_by_route_id: routeDocId,
          bridge_pushed_at: nowIso
        });
        cancelledSourceRoutes += 1;
      }
    } else {
      cancelledSourceRoutes += (sourceRoutesBySchedule.get(scheduleId) || []).length;
    }
    forwarded.push({ scheduleId, staffId, from: dateOnly(row.task_datetime), to: args.targetDate, routeDocId });
  }

  console.log(JSON.stringify({
    date: args.date,
    targetDate: args.targetDate,
    dryRun: args.dryRun,
    startDate,
    scanned: scheduleRows.length,
    alreadyRouted: alreadyRouted.size,
    blockedByClosedRouteOrCloseRequest: blockedClosedScheduleIds.size,
    assignmentBlocked: assignmentBlockedRows.length,
    forwarded: forwarded.length,
    cancelledSourceRoutes,
    rows: forwarded
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
