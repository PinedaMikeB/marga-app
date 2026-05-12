#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_BASE_URL = "https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents";
const DEFAULT_FIREBASE_API_KEY = "AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M";
const ZERO_DATETIME = "0000-00-00 00:00:00";
const SERVICE_PURPOSE_IDS = new Set([5]);
const MESSENGER_PURPOSE_IDS = new Set([1, 2, 3, 4, 8]);
const FIELD_EXPENSE_GROUPS = new Set([
  "gasoline",
  "diesel",
  "commute_fare",
  "parking",
  "meal_allowance",
  "field_parts",
  "toner",
  "ink"
]);

function clean(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return `PHP ${number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function pct(value) {
  return `${Math.round(number(value) * 100)}%`;
}

function dateOnly(value) {
  return clean(value).slice(0, 10);
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

function parseArgs(argv) {
  const args = {
    mode: "owner",
    date: todayManila(),
    weekly: false,
    email: false,
    ai: false,
    outDir: "reports/operations-kaizen"
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--date" && next) {
      args.date = next;
      index += 1;
    } else if (token === "--mode" && next) {
      args.mode = next;
      index += 1;
    } else if (token === "--weekly") {
      args.weekly = true;
    } else if (token === "--email") {
      args.email = true;
    } else if (token === "--ai") {
      args.ai = true;
    } else if (token === "--out-dir" && next) {
      args.outDir = next;
      index += 1;
    }
  }
  return args;
}

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
      const [key, ...rest] = trimmed.split("=");
      if (!process.env[key]) {
        process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
      }
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
  if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(parseFirestoreValue);
  return null;
}

function parseFirestoreDoc(doc) {
  if (!doc?.fields) return null;
  const parsed = {};
  Object.entries(doc.fields).forEach(([key, value]) => {
    parsed[key] = parseFirestoreValue(value);
  });
  if (doc.name) parsed._docId = doc.name.split("/").pop();
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
  }

  async list(collection, { fieldMask = null, pageSize = 300, maxPages = 80 } = {}) {
    let pageToken = "";
    const rows = [];
    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({ pageSize: String(pageSize), key: this.apiKey });
      if (pageToken) params.set("pageToken", pageToken);
      if (Array.isArray(fieldMask)) fieldMask.forEach((field) => params.append("mask.fieldPaths", field));
      const response = await fetch(`${this.baseUrl}/${collection}?${params.toString()}`);
      if (!response.ok) throw new Error(`Failed to list ${collection}: ${response.status}`);
      const payload = await response.json();
      rows.push(...(payload.documents || []).map(parseFirestoreDoc).filter(Boolean));
      if (!payload.nextPageToken) break;
      pageToken = payload.nextPageToken;
    }
    return rows;
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
    return Array.isArray(payload) ? payload.map((row) => row.document).filter(Boolean).map(parseFirestoreDoc).filter(Boolean) : [];
  }

  async queryDateRange(collectionId, fieldPath, start, end, limit = 2000) {
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

  async queryEquals(collectionId, fieldPath, value, limit = 1000) {
    return this.query({
      from: [{ collectionId }],
      where: { fieldFilter: { field: { fieldPath }, op: "EQUAL", value: firestoreValue(value) } },
      limit
    });
  }
}

function purposeLabel(row) {
  const id = number(row.purpose_id);
  if (id === 1) return "Billing";
  if (id === 2) return "Collection";
  if (id === 3) return "Deliver Ink / Toner";
  if (id === 4) return "Deliver Cartridge";
  if (id === 5) return "Service";
  if (id === 8) return "Reading";
  return clean(row.purpose || row.schedule_purpose || row.trouble || `Purpose ${id || "-"}`);
}

function purposeGroup(row) {
  const id = number(row.purpose_id);
  if (SERVICE_PURPOSE_IDS.has(id)) return "service";
  if (id === 1 || id === 8) return "billing";
  if (id === 2) return "collection";
  if (id === 3 || id === 4) return "delivery";
  return "other";
}

function isMessengerType(row) {
  return MESSENGER_PURPOSE_IDS.has(number(row.purpose_id));
}

function isCancelled(row) {
  const status = clean(row.status || row.master_schedule_status || row.collection_schedule_status).toLowerCase();
  const finished = clean(row.date_finished);
  return number(row.iscancel || row.iscancelled) === 1
    || status === "cancelled"
    || Boolean(row.cancelled_at)
    || (finished && finished !== ZERO_DATETIME && status === "0");
}

function isClosed(row) {
  const finished = clean(row.date_finished);
  const status = clean(row.master_schedule_status || row.status).toLowerCase();
  return finished && finished !== ZERO_DATETIME || status.includes("closed") || status === "0";
}

function employeeName(employee, fallback = "") {
  if (!employee) return fallback ? `Staff #${fallback}` : "Unassigned";
  return clean(employee.name)
    || clean(`${employee.firstname || ""} ${employee.lastname || ""}`)
    || clean(employee.nickname)
    || (fallback ? `Staff #${fallback}` : "Unassigned");
}

function normalizePerson(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeAddress(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\b(unit|room|rm|floor|flr|fl|dept|department|office|suite)\b\.?/g, " ")
    .replace(/\b\d+(st|nd|rd|th)?\s*(floor|flr|fl|room|rm)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function locationKey(row, branchMap) {
  const branch = branchMap.get(String(row.branch_id || ""));
  const companyId = clean(row.company_id || branch?.company_id);
  const address = normalizeAddress([
    branch?.branch_address,
    branch?.bldg,
    branch?.street,
    branch?.brgy,
    branch?.city
  ].filter(Boolean).join(" "));
  const branchFallback = clean(row.branch_id || "");
  return `${companyId || "company?"}|${address || `branch:${branchFallback}`}`;
}

function customerName(row, branchMap, companyMap) {
  const branch = branchMap.get(String(row.branch_id || ""));
  const company = companyMap.get(String(row.company_id || branch?.company_id || ""));
  return clean(row.company_name) || clean(company?.companyname) || clean(row.caller) || "Unknown Customer";
}

function locationLabel(row, branchMap, companyMap) {
  const branch = branchMap.get(String(row.branch_id || ""));
  const name = customerName(row, branchMap, companyMap);
  const branchName = clean(branch?.branchname || row.branch_name);
  const city = clean(branch?.city || row.city);
  return [name, branchName, city].filter(Boolean).join(" / ");
}

function minutesBetween(start, end) {
  const left = Date.parse(clean(start).replace(" ", "T"));
  const right = Date.parse(clean(end).replace(" ", "T"));
  if (!Number.isFinite(left) || !Number.isFinite(right) || right < left) return 0;
  return Math.round((right - left) / 60000);
}

function earliest(values) {
  return values.filter(Boolean).sort()[0] || "";
}

function latest(values) {
  return values.filter(Boolean).sort().at(-1) || "";
}

async function collectData(db, targetDate, weekly = false) {
  const startDate = weekly ? addDays(targetDate, -6) : targetDate;
  const scheduleRows = await db.queryDateRange("tbl_schedule", "task_datetime", `${startDate} 00:00:00`, `${targetDate} 23:59:59`, 5000);
  const dayRows = scheduleRows.filter((row) => dateOnly(row.task_datetime) === targetDate && !isCancelled(row));
  const branchIds = [...new Set(scheduleRows.map((row) => clean(row.branch_id)).filter(Boolean))];
  const companyIds = [...new Set(scheduleRows.map((row) => clean(row.company_id)).filter(Boolean))];
  const staffIds = [...new Set(scheduleRows.map((row) => number(row.tech_id)).filter(Boolean))];

  const [employees, branches, companies, pettyEntries, schedtimeBySchedule] = await Promise.all([
    Promise.all(staffIds.map((id) => db.queryEquals("tbl_employee", "id", id, 1).then((rows) => rows[0]).catch(() => null))),
    Promise.all(branchIds.map((id) => db.queryEquals("tbl_branchinfo", "id", number(id), 1).then((rows) => rows[0]).catch(() => null))),
    Promise.all(companyIds.map((id) => db.queryEquals("tbl_companylist", "id", number(id), 1).then((rows) => rows[0]).catch(() => null))),
    db.queryDateRange("tbl_pettycash_entries", "date", startDate, targetDate, 3000).catch(() => []),
    Promise.all(dayRows.map((row) => db.queryEquals("tbl_schedtime", "schedule_id", number(row.id), 20).then((logs) => [String(row.id), logs]).catch(() => [String(row.id), []])))
  ]);

  const employeeMap = new Map();
  employees.filter(Boolean).forEach((row) => employeeMap.set(String(row.id || row._docId), row));
  const branchMap = new Map();
  branches.filter(Boolean).forEach((row) => branchMap.set(String(row.id || row._docId), row));
  const companyMap = new Map();
  companies.filter(Boolean).forEach((row) => companyMap.set(String(row.id || row._docId), row));
  const schedtimeMap = new Map(schedtimeBySchedule);

  return { targetDate, startDate, scheduleRows, dayRows, employeeMap, branchMap, companyMap, pettyEntries, schedtimeMap };
}

function sameDayTimeValues(values, targetDate) {
  return values
    .map(clean)
    .filter((value) => value && value !== ZERO_DATETIME)
    .filter((value) => dateOnly(value) === targetDate)
    .sort();
}

function enrichSchedule(row, data) {
  const logs = data.schedtimeMap.get(String(row.id)) || [];
  const timeIns = sameDayTimeValues([row.field_time_in, ...logs.map((log) => log.time_in)], data.targetDate);
  const timeOuts = sameDayTimeValues([row.field_time_out, ...logs.map((log) => log.time_out)], data.targetDate);
  const staffId = number(row.tech_id);
  const employee = data.employeeMap.get(String(staffId));
  const firstTimeIn = earliest(timeIns);
  const lastTimeOut = latest(timeOuts);
  const rawDuration = minutesBetween(firstTimeIn, lastTimeOut);
  const durationMinutes = rawDuration > 0 ? Math.min(rawDuration, 480) : 0;
  return {
    ...row,
    _purposeLabel: purposeLabel(row),
    _purposeGroup: purposeGroup(row),
    _staffId: staffId,
    _staffName: employeeName(employee, staffId),
    _locationKey: locationKey(row, data.branchMap),
    _locationLabel: locationLabel(row, data.branchMap, data.companyMap),
    _isClosed: isClosed(row),
    _firstTimeIn: firstTimeIn,
    _lastTimeOut: lastTimeOut,
    _durationMinutes: durationMinutes
  };
}

function groupBy(rows, fn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = fn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function analyze(data) {
  const rows = data.dayRows.map((row) => enrichSchedule(row, data));
  const byLocation = groupBy(rows, (row) => row._locationKey);
  const byStaff = groupBy(rows.filter((row) => row._staffId), (row) => String(row._staffId));
  const uniqueLocations = byLocation.size;
  const duplicateLocations = [...byLocation.values()].filter((items) => items.length > 1);
  const multiStaffLocations = duplicateLocations.filter((items) => new Set(items.map((row) => row._staffId).filter(Boolean)).size > 1);
  const avoidableTrips = multiStaffLocations.reduce((sum, items) => {
    const staffCount = new Set(items.map((row) => row._staffId).filter(Boolean)).size;
    return sum + Math.max(0, staffCount - 1);
  }, 0);

  const purposeCounts = rows.reduce((acc, row) => {
    acc[row._purposeGroup] = (acc[row._purposeGroup] || 0) + 1;
    return acc;
  }, {});

  const staffStats = [...byStaff.entries()].map(([staffId, items]) => {
    const locationCount = new Set(items.map((row) => row._locationKey)).size;
    const completed = items.filter((row) => row._isClosed || row._lastTimeOut).length;
    const totalDuration = items.reduce((sum, row) => sum + number(row._durationMinutes), 0);
    const firstCustomer = earliest(items.map((row) => row._firstTimeIn));
    const lastCustomer = latest(items.map((row) => row._lastTimeOut));
    return {
      staffId,
      staffName: items[0]?._staffName || `Staff #${staffId}`,
      schedules: items.length,
      locations: locationCount,
      completed,
      pending: items.length - completed,
      routeDensity: locationCount ? items.length / locationCount : 0,
      firstCustomer,
      lastCustomer,
      productiveMinutes: totalDuration
    };
  }).sort((a, b) => b.schedules - a.schedules);

  const fieldAlerts = [];
  staffStats.forEach((staff) => {
    if (!staff.firstCustomer) {
      fieldAlerts.push({
        priority: "high",
        type: "no_time_in",
        title: `${staff.staffName} has no customer time-in recorded.`,
        nextStep: "Team leader should ask for location/time-in proof before releasing more assignments."
      });
    } else if (staff.firstCustomer.slice(11, 16) > "09:30") {
      fieldAlerts.push({
        priority: "medium",
        type: "late_first_customer",
        title: `${staff.staffName} first customer time-in is ${staff.firstCustomer.slice(11, 16)}.`,
        nextStep: "Review dispatch start time, travel route, or late departure from office."
      });
    }
    if (staff.lastCustomer && staff.lastCustomer.slice(11, 16) < "16:00" && staff.pending > 0) {
      fieldAlerts.push({
        priority: "high",
        type: "early_stop_with_pending",
        title: `${staff.staffName} has ${staff.pending} pending schedule(s) after last recorded customer time-out ${staff.lastCustomer.slice(11, 16)}.`,
        nextStep: "Do not allow return to office until dispatcher clears pending route or reassigns it."
      });
    }
  });

  const scheduleActions = multiStaffLocations.slice(0, 30).map((items) => {
    const serviceOwner = items.find((row) => SERVICE_PURPOSE_IDS.has(number(row.purpose_id)) && row._staffId);
    const fallbackOwner = items
      .filter((row) => row._staffId)
      .sort((a, b) => (SERVICE_PURPOSE_IDS.has(number(b.purpose_id)) ? 1 : 0) - (SERVICE_PURPOSE_IDS.has(number(a.purpose_id)) ? 1 : 0))[0];
    const owner = serviceOwner || fallbackOwner;
    const transfer = items.filter((row) => row._staffId && owner && row._staffId !== owner._staffId && isMessengerType(row));
    return {
      priority: transfer.length ? "high" : "medium",
      location: items[0]._locationLabel,
      recommendedOwner: owner?._staffName || "one assigned field staff",
      transferScheduleIds: transfer.map((row) => row.id || row._docId),
      evidence: items.map((row) => `#${row.id || row._docId} ${row._purposeLabel} - ${row._staffName}`),
      nextStep: transfer.length
        ? `Transfer ${transfer.length} messenger-type task(s) to ${owner?._staffName || "the service assignee"} before finalizing.`
        : "Review same-location assignments and keep one field owner unless there is a documented reason."
    };
  });

  const petty = analyzePettyCash(data, rows);
  const averageFieldCost = petty.totalFieldCost && uniqueLocations ? petty.totalFieldCost / uniqueLocations : number(process.env.MARGA_KAIZEN_DEFAULT_TRIP_COST || 180);
  const estimatedSavings = avoidableTrips * averageFieldCost;

  const ownerRecommendations = buildOwnerRecommendations({
    rows,
    staffStats,
    fieldAlerts,
    scheduleActions,
    petty,
    avoidableTrips,
    estimatedSavings
  });

  return {
    date: data.targetDate,
    summary: {
      totalSchedules: rows.length,
      uniqueLocations,
      duplicateLocationCount: duplicateLocations.length,
      multiStaffLocationCount: multiStaffLocations.length,
      avoidableTrips,
      estimatedSavings,
      purposeCounts,
      staffCount: byStaff.size
    },
    scheduleActions,
    fieldAlerts,
    staffStats,
    petty,
    ownerRecommendations
  };
}

function analyzePettyCash(data, scheduleRows) {
  const staffNames = new Map();
  data.employeeMap.forEach((employee, id) => staffNames.set(normalizePerson(employeeName(employee, id)), { id, name: employeeName(employee, id) }));

  const scheduledByPerson = new Map();
  scheduleRows.forEach((row) => {
    const key = normalizePerson(row._staffName);
    if (!key) return;
    if (!scheduledByPerson.has(key)) scheduledByPerson.set(key, []);
    scheduledByPerson.get(key).push(row);
  });

  const rows = data.pettyEntries
    .filter((entry) => dateOnly(entry.date || entry.requestDate || entry.reportDate || entry.createdAt) === data.targetDate)
    .map((entry) => {
      const personText = clean(entry.requestedBy || entry.requester || entry.payee || entry.staff_name);
      const personKey = normalizePerson(personText);
      const scheduled = scheduledByPerson.get(personKey) || [];
      const expenseGroup = clean(entry.expenseGroup || entry.expense_group || entry.category || "other");
      return {
        id: entry.id || entry._docId,
        personText,
        personKey,
        amount: number(entry.amount),
        expenseGroup,
        description: clean(entry.description || entry.itemNote || entry.remarks),
        isFieldExpense: FIELD_EXPENSE_GROUPS.has(expenseGroup),
        hasSchedule: scheduled.length > 0,
        scheduleCount: scheduled.length,
        locationCount: new Set(scheduled.map((row) => row._locationKey)).size
      };
    });

  const totalFieldCost = rows.filter((row) => row.isFieldExpense).reduce((sum, row) => sum + row.amount, 0);
  const byPerson = [...groupBy(rows, (row) => row.personKey || "unmatched").entries()].map(([key, items]) => {
    const scheduled = scheduledByPerson.get(key) || [];
    const amount = items.reduce((sum, row) => sum + row.amount, 0);
    const locationCount = new Set(scheduled.map((row) => row._locationKey)).size;
    return {
      personKey: key,
      person: items[0]?.personText || scheduled[0]?._staffName || "Unmatched",
      amount,
      fieldAmount: items.filter((row) => row.isFieldExpense).reduce((sum, row) => sum + row.amount, 0),
      entries: items.length,
      scheduleCount: scheduled.length,
      locationCount,
      costPerLocation: locationCount ? amount / locationCount : amount,
      issue: !scheduled.length && amount > 0 ? "expense_without_field_schedule" : ""
    };
  }).sort((a, b) => b.amount - a.amount);

  const scheduledKeys = new Set([...scheduledByPerson.keys()]);
  const expenseKeys = new Set(rows.map((row) => row.personKey).filter(Boolean));
  const scheduledNoExpense = [...scheduledKeys]
    .filter((key) => !expenseKeys.has(key))
    .map((key) => ({
      person: scheduledByPerson.get(key)[0]._staffName,
      scheduleCount: scheduledByPerson.get(key).length,
      locationCount: new Set(scheduledByPerson.get(key).map((row) => row._locationKey)).size
    }));

  return {
    rows,
    byPerson,
    scheduledNoExpense,
    totalFieldCost,
    unmatchedExpenses: rows.filter((row) => row.amount > 0 && !row.hasSchedule)
  };
}

function buildOwnerRecommendations({ rows, staffStats, fieldAlerts, scheduleActions, petty, avoidableTrips, estimatedSavings }) {
  const recommendations = [];

  if (avoidableTrips > 0) {
    recommendations.push({
      priority: "high",
      title: `Approve schedule consolidation before dispatch.`,
      evidence: `${avoidableTrips} avoidable same-location trip(s), estimated savings ${money(estimatedSavings)} today.`,
      nextStep: "Team leader should apply the transfer recommendations before finalizing tomorrow's Master Schedule."
    });
  }

  const lowDensity = staffStats.filter((staff) => staff.locations > 0 && staff.routeDensity < 1.4 && staff.schedules <= 3);
  if (lowDensity.length) {
    recommendations.push({
      priority: "medium",
      title: "Review low-density field routes.",
      evidence: lowDensity.slice(0, 5).map((staff) => `${staff.staffName}: ${staff.schedules} task(s), ${staff.locations} location(s)`).join("; "),
      nextStep: "Merge these routes into nearby technician/messenger routes or require a dispatch reason."
    });
  }

  const billingDeliveryCount = rows.filter((row) => row._purposeGroup === "billing").length;
  if (billingDeliveryCount >= 5) {
    recommendations.push({
      priority: "medium",
      title: "Start email-first billing experiment.",
      evidence: `${billingDeliveryCount} billing/reading schedule(s) today.`,
      nextStep: "Pick customers with no payment-promise visit and email billing first; deliver original only during collection or upon request."
    });
  }

  const expenseNoRoute = petty.unmatchedExpenses.filter((row) => row.isFieldExpense);
  if (expenseNoRoute.length) {
    recommendations.push({
      priority: "high",
      title: "Audit petty cash with no matching field schedule.",
      evidence: `${expenseNoRoute.length} field expense entr${expenseNoRoute.length === 1 ? "y" : "ies"} without same-day route assignment.`,
      nextStep: "Accounting should confirm requester name and require schedule reference before liquidation."
    });
  }

  const highCost = petty.byPerson.filter((row) => row.locationCount > 0 && row.costPerLocation > 250);
  if (highCost.length) {
    recommendations.push({
      priority: "medium",
      title: "Coach high cost-per-location routes.",
      evidence: highCost.slice(0, 5).map((row) => `${row.person}: ${money(row.costPerLocation)}/location`).join("; "),
      nextStep: "Compare route geography and petty cash category; reduce one-off trips or rebalance area assignments."
    });
  }

  const severeFieldAlerts = fieldAlerts.filter((alert) => alert.priority === "high");
  if (severeFieldAlerts.length) {
    recommendations.push({
      priority: "high",
      title: "Tighten live field control.",
      evidence: severeFieldAlerts.slice(0, 4).map((alert) => alert.title).join("; "),
      nextStep: "Team leader should check time-in/out compliance and prevent early office return with pending customers."
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      priority: "low",
      title: "No major waste pattern found today.",
      evidence: "No duplicate same-location trips or high-risk petty cash mismatch detected by current rules.",
      nextStep: "Continue monitoring and improve data capture for time-in/out and petty cash requester matching."
    });
  }

  return recommendations;
}

function renderMarkdown(report, aiText = "") {
  const lines = [];
  lines.push(`# Operations Kaizen Advisor - ${report.date}`);
  lines.push("");
  lines.push("## Owner Actions");
  report.ownerRecommendations.forEach((item, index) => {
    lines.push(`${index + 1}. **[${item.priority.toUpperCase()}] ${item.title}**`);
    lines.push(`   - Evidence: ${item.evidence}`);
    lines.push(`   - Next step: ${item.nextStep}`);
  });
  lines.push("");
  lines.push("## Scorecard");
  lines.push(`- Total schedules: ${report.summary.totalSchedules}`);
  lines.push(`- Unique customer locations: ${report.summary.uniqueLocations}`);
  lines.push(`- Locations with multiple tasks: ${report.summary.duplicateLocationCount}`);
  lines.push(`- Locations with multiple staff: ${report.summary.multiStaffLocationCount}`);
  lines.push(`- Estimated avoidable trips: ${report.summary.avoidableTrips}`);
  lines.push(`- Estimated savings today: ${money(report.summary.estimatedSavings)}`);
  lines.push(`- Staff assigned: ${report.summary.staffCount}`);
  lines.push(`- Service: ${report.summary.purposeCounts.service || 0}`);
  lines.push(`- Billing/Reading: ${report.summary.purposeCounts.billing || 0}`);
  lines.push(`- Collection: ${report.summary.purposeCounts.collection || 0}`);
  lines.push(`- Delivery: ${report.summary.purposeCounts.delivery || 0}`);
  lines.push("");
  lines.push("## Recommended Actions Before Finalizing");
  if (!report.scheduleActions.length) {
    lines.push("- No same-location multi-staff transfer found.");
  } else {
    report.scheduleActions.slice(0, 12).forEach((action, index) => {
      lines.push(`${index + 1}. **${action.location}**`);
      lines.push(`   - Recommendation: ${action.nextStep}`);
      lines.push(`   - Transfer schedule IDs: ${action.transferScheduleIds.join(", ") || "review manually"}`);
      lines.push(`   - Evidence: ${action.evidence.join("; ")}`);
    });
  }
  lines.push("");
  lines.push("## Team Leader Field Control");
  if (!report.fieldAlerts.length) {
    lines.push("- No field-control alert detected by current rules.");
  } else {
    report.fieldAlerts.slice(0, 15).forEach((alert) => {
      lines.push(`- **[${alert.priority.toUpperCase()}] ${alert.title}** ${alert.nextStep}`);
    });
  }
  lines.push("");
  lines.push("## Staff Efficiency");
  report.staffStats.slice(0, 20).forEach((staff) => {
    lines.push(`- ${staff.staffName}: ${staff.schedules} schedule(s), ${staff.locations} location(s), ${staff.completed} completed/logged, ${staff.pending} pending, density ${staff.routeDensity.toFixed(2)}, productive ${Math.round(staff.productiveMinutes / 60)}h`);
  });
  lines.push("");
  lines.push("## Petty Cash");
  lines.push(`- Field petty cash total: ${money(report.petty.totalFieldCost)}`);
  lines.push(`- Expenses without same-day route: ${report.petty.unmatchedExpenses.length}`);
  report.petty.byPerson.slice(0, 12).forEach((row) => {
    lines.push(`- ${row.person}: ${money(row.amount)}, ${row.scheduleCount} schedule(s), ${row.locationCount} location(s), ${money(row.costPerLocation)}/location${row.issue ? `, issue: ${row.issue}` : ""}`);
  });
  if (report.petty.scheduledNoExpense.length) {
    lines.push("");
    lines.push("### Scheduled Staff With No Petty Cash Entry");
    report.petty.scheduledNoExpense.slice(0, 12).forEach((row) => {
      lines.push(`- ${row.person}: ${row.scheduleCount} schedule(s), ${row.locationCount} location(s)`);
    });
  }
  if (aiText) {
    lines.push("");
    lines.push("## AI Owner Advisor");
    lines.push(aiText);
  }
  lines.push("");
  lines.push("_Generated by tools/operations-kaizen-advisor.mjs_");
  return lines.join("\n");
}

function markdownToHtml(markdown) {
  return markdown
    .split(/\n{2,}/)
    .map((block) => {
      if (block.startsWith("# ")) return `<h1>${escapeHtml(block.slice(2))}</h1>`;
      if (block.startsWith("## ")) return `<h2>${escapeHtml(block.slice(3))}</h2>`;
      if (block.startsWith("### ")) return `<h3>${escapeHtml(block.slice(4))}</h3>`;
      const lines = block.split(/\n/);
      if (lines.every((line) => line.startsWith("- ") || /^\d+\./.test(line) || line.startsWith("   - "))) {
        return `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(block)}</pre>`;
      }
      return `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildAiAdvisor(report) {
  if (!process.env.OPENAI_API_KEY) return "";
  const model = process.env.MARGA_KAIZEN_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const prompt = [
    "You are an operations Kaizen advisor for MARGA, a copier/printer service business in the Philippines.",
    "Use lean management thinking. Give concrete next actions, not generic commentary.",
    "Focus on cost cutting, route consolidation, petty cash control, time discipline, and service quality.",
    "Be direct but fair. Include commendations for team leader/staff when the numbers deserve it.",
    "",
    JSON.stringify({
      date: report.date,
      summary: report.summary,
      ownerRecommendations: report.ownerRecommendations,
      topStaff: report.staffStats.slice(0, 12),
      pettyCash: {
        totalFieldCost: report.petty.totalFieldCost,
        byPerson: report.petty.byPerson.slice(0, 12),
        unmatchedExpenses: report.petty.unmatchedExpenses.slice(0, 10)
      },
      fieldAlerts: report.fieldAlerts.slice(0, 12),
      scheduleActions: report.scheduleActions.slice(0, 10)
    }, null, 2)
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }]
        }
      ],
      text: { format: { type: "text" } }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI advisor failed: ${response.status} ${JSON.stringify(data)}`);
  return clean(data.output_text) || clean(data.output?.flatMap((item) => item.content || []).map((item) => item.text).join("\n"));
}

async function sendEmail({ subject, markdown }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.MARGA_KAIZEN_EMAIL_TO || process.env.MARGA_NOTIFY_EMAIL_TO;
  const from = process.env.MARGA_KAIZEN_EMAIL_FROM || process.env.MARGA_NOTIFY_EMAIL_FROM || "Marga Kaizen <noreply@marga.biz>";
  if (!apiKey || !to) {
    return { sent: false, reason: "RESEND_API_KEY and MARGA_KAIZEN_EMAIL_TO/MARGA_NOTIFY_EMAIL_TO are required." };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: to.split(",").map((item) => item.trim()).filter(Boolean),
      subject,
      html: markdownToHtml(markdown),
      text: markdown
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend email failed: ${response.status} ${JSON.stringify(data)}`);
  return { sent: true, id: data.id || null };
}

async function main() {
  await loadEnvFile(".env");
  await loadEnvFile(".env.local");
  await loadEnvFile(path.join(process.env.HOME || "", ".codex", "env", "marga-app.env"));

  const args = parseArgs(process.argv);
  const db = new FirestoreClient();
  const data = await collectData(db, args.date, args.weekly);
  const report = analyze(data);
  let aiText = "";
  if (args.ai) {
    try {
      aiText = await buildAiAdvisor(report);
    } catch (error) {
      aiText = `AI advisor unavailable: ${error.message || error}`;
    }
  }
  const markdown = renderMarkdown(report, aiText);
  await fs.mkdir(args.outDir, { recursive: true });
  const baseName = `operations-kaizen-${args.date}${args.weekly ? "-weekly" : ""}`;
  const jsonPath = path.join(args.outDir, `${baseName}.json`);
  const mdPath = path.join(args.outDir, `${baseName}.md`);
  await fs.writeFile(jsonPath, JSON.stringify({ ...report, aiAdvisor: aiText }, null, 2));
  await fs.writeFile(mdPath, markdown);

  let emailResult = null;
  if (args.email) {
    emailResult = await sendEmail({
      subject: `MARGA Operations Kaizen Advisor - ${args.date}`,
      markdown
    });
  }

  console.log(markdown);
  console.log("");
  console.log(`Report written: ${mdPath}`);
  console.log(`JSON written: ${jsonPath}`);
  if (emailResult) console.log(`Email: ${JSON.stringify(emailResult)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
