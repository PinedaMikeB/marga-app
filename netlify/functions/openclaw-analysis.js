const fs = require("fs");
const path = require("path");

const ZERO_DATETIME = "0000-00-00 00:00:00";
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_CARRYOVER_DAYS = 14;
const DEFAULT_REPEAT_THRESHOLD = 2;
const DEFAULT_QUERY_LIMIT = 20000;
const MAX_QUERY_LIMIT = 50000;

const PURPOSE_LABELS = {
  1: "Billing",
  2: "Collection",
  3: "Deliver Ink / Toner",
  4: "Deliver Cartridge",
  5: "Service",
  6: "Sales",
  7: "Purchasing",
  8: "Reading",
  9: "Others",
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(payload),
  };
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseIntSafe(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function fmtYmd(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmd(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const [y, m, d] = String(ymd).split("-").map((v) => Number(v));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function addDaysYmd(ymd, days) {
  const dt = parseYmd(ymd);
  if (!dt) return ymd;
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmtYmd(dt);
}

function currentYmdInTimeZone(tz) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date());
  } catch (error) {
    return new Date().toISOString().slice(0, 10);
  }
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
    const values = value.arrayValue.values || [];
    return values.map((entry) => parseFirestoreValue(entry));
  }
  if (value.mapValue !== undefined) {
    const out = {};
    const fields = value.mapValue.fields || {};
    Object.entries(fields).forEach(([k, v]) => {
      out[k] = parseFirestoreValue(v);
    });
    return out;
  }
  return null;
}

function parseFirestoreDoc(doc) {
  if (!doc || !doc.fields) return null;
  const out = {};
  Object.entries(doc.fields).forEach(([k, raw]) => {
    out[k] = parseFirestoreValue(raw);
  });
  if (doc.name) out._docId = doc.name.split("/").pop();
  return out;
}

function toQueryValue(value) {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { integerValue: String(Math.trunc(value)) };
  }
  return { stringValue: String(value ?? "") };
}

function asLabel(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function sanitizeKeyPart(value) {
  return String(value ?? "").trim() || "0";
}

function roleFromPosition(position) {
  const name = String(position?.position || "").toLowerCase();
  if (name.includes("tech")) return "Technician";
  if (name.includes("messenger") || name.includes("driver")) return "Messenger";
  return "Staff";
}

function employeeDisplayName(employee) {
  if (!employee) return "Unassigned";
  const nickname = String(employee.nickname || "").trim();
  const first = String(employee.firstname || "").trim();
  const last = String(employee.lastname || "").trim();
  if (nickname) return nickname;
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return `ID ${employee.id || employee._docId || "?"}`;
}

function taskDate(row) {
  return String(row.task_datetime || "").slice(0, 10);
}

function isClosedByDateFinished(row) {
  const finished = String(row.date_finished || "").trim();
  return Boolean(finished && finished !== ZERO_DATETIME);
}

function statusKey(row, selectedDate, closedSet) {
  const id = Number(row.id || 0);
  if (id > 0 && closedSet.has(id)) return "closed";
  if (Number(row.iscancel || 0) === 1) return "cancelled";
  if (isClosedByDateFinished(row)) return "closed";
  if (Number(row.isongoing || 0) === 1) return "ongoing";
  const date = taskDate(row);
  if (date && selectedDate && date < selectedDate) return "carryover";
  return "pending";
}

function dayDiff(startYmd, endYmd) {
  const s = parseYmd(startYmd);
  const e = parseYmd(endYmd);
  if (!s || !e) return 0;
  return Math.floor((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000));
}

function percentage(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function loadFirebaseConfigFromEnvOrFile() {
  const envApiKey = process.env.FIREBASE_API_KEY;
  const envBaseUrl = process.env.FIREBASE_BASE_URL;
  if (envApiKey && envBaseUrl) {
    return { apiKey: envApiKey, baseUrl: envBaseUrl };
  }

  const configPath = path.resolve(__dirname, "../../shared/js/firebase-config.js");
  const source = fs.readFileSync(configPath, "utf8");
  const apiKey = (source.match(/apiKey:\s*'([^']+)'/) || [])[1];
  const baseUrl = (source.match(/baseUrl:\s*'([^']+)'/) || [])[1];
  if (!apiKey || !baseUrl) {
    throw new Error("Unable to load Firebase config (apiKey/baseUrl).");
  }
  return { apiKey, baseUrl };
}

function createFirestoreClient({ apiKey, baseUrl }) {
  async function runStructuredQuery(structuredQuery) {
    const response = await fetch(`${baseUrl}:runQuery?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery }),
    });
    const payload = await response.json();
    if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) {
      const message =
        payload?.error?.message ||
        payload?.[0]?.error?.message ||
        `Query failed (${response.status})`;
      throw new Error(message);
    }
    if (!Array.isArray(payload)) return [];
    return payload.map((row) => row.document).filter(Boolean).map(parseFirestoreDoc).filter(Boolean);
  }

  async function queryByDateRange(collectionId, fieldPath, { start, end, endOp = "LESS_THAN_OR_EQUAL", limit }) {
    const structuredQuery = {
      from: [{ collectionId }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            {
              fieldFilter: {
                field: { fieldPath },
                op: "GREATER_THAN_OR_EQUAL",
                value: toQueryValue(start),
              },
            },
            {
              fieldFilter: {
                field: { fieldPath },
                op: endOp,
                value: toQueryValue(end),
              },
            },
          ],
        },
      },
      orderBy: [{ field: { fieldPath }, direction: "ASCENDING" }],
      limit,
    };
    return runStructuredQuery(structuredQuery);
  }

  async function queryCollectionByIdDesc(collectionId, limit) {
    const structuredQuery = {
      from: [{ collectionId }],
      orderBy: [{ field: { fieldPath: "id" }, direction: "DESCENDING" }],
      limit,
    };
    return runStructuredQuery(structuredQuery);
  }

  async function fetchDocById(collectionId, id) {
    const response = await fetch(`${baseUrl}/${collectionId}/${encodeURIComponent(String(id))}?key=${apiKey}`);
    const payload = await response.json();
    if (!response.ok || payload?.error) return null;
    return parseFirestoreDoc(payload);
  }

  async function fetchDocsByIds(collectionId, ids, { concurrency = 15 } = {}) {
    const unique = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (!unique.length) return new Map();

    const out = new Map();
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
      while (idx < unique.length) {
        const current = unique[idx++];
        const doc = await fetchDocById(collectionId, current);
        if (doc) out.set(current, doc);
      }
    });
    await Promise.all(workers);
    return out;
  }

  return {
    queryByDateRange,
    queryCollectionByIdDesc,
    fetchDocsByIds,
  };
}

function buildInsights({ pendingCustomers, techPerf, areaBackjobs, repeatedClients }) {
  const insights = [];
  if (pendingCustomers.length) {
    const top = pendingCustomers[0];
    insights.push(
      `Highest pending load: ${top.customer_name} / ${top.branch_name} with ${top.open_task_count} open task(s).`
    );
  }
  const highPerf = techPerf
    .filter((row) => row.assigned_total >= 5)
    .sort((a, b) => b.completion_rate_pct - a.completion_rate_pct)[0];
  if (highPerf) {
    insights.push(
      `Top completion rate (min 5 tasks): ${highPerf.technician_name} at ${highPerf.completion_rate_pct}%.`
    );
  }
  const area = areaBackjobs.find((row) => row.carryover_count > 0) || areaBackjobs[0];
  if (area) {
    insights.push(
      `Area watchlist: ${area.area_name} has ${area.carryover_count} carryover and ${area.repeat_repair_count} repeat repair case(s).`
    );
  }
  if (repeatedClients.length) {
    const client = repeatedClients[0];
    insights.push(
      `Most repeated repair: ${client.customer_name} / ${client.branch_name} with ${client.repair_count} service events in window.`
    );
  }
  return insights;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed. Use GET." });
  }

  try {
    const query = event.queryStringParameters || {};
    const timezone = String(query.timezone || "Asia/Manila");
    const endDate = String(query.end_date || query.date || currentYmdInTimeZone(timezone));
    if (!parseYmd(endDate)) {
      return json(400, { error: "Invalid end_date/date. Expected YYYY-MM-DD." });
    }

    const windowDays = Math.max(1, parseIntSafe(query.window_days, DEFAULT_WINDOW_DAYS));
    const carryoverDays = Math.max(0, parseIntSafe(query.carryover_days, DEFAULT_CARRYOVER_DAYS));
    const repeatThreshold = Math.max(2, parseIntSafe(query.repeat_threshold, DEFAULT_REPEAT_THRESHOLD));
    const includeCarryover = parseBool(query.include_carryover, true);
    const queryLimit = Math.min(
      MAX_QUERY_LIMIT,
      Math.max(100, parseIntSafe(query.query_limit, DEFAULT_QUERY_LIMIT))
    );

    const startDate = String(query.start_date || addDaysYmd(endDate, -(windowDays - 1)));
    if (!parseYmd(startDate)) {
      return json(400, { error: "Invalid start_date. Expected YYYY-MM-DD." });
    }

    const analysisStart = `${startDate} 00:00:00`;
    const analysisEnd = `${endDate} 23:59:59`;
    const carryStartYmd = includeCarryover ? addDaysYmd(startDate, -carryoverDays) : startDate;
    const fetchStart = `${carryStartYmd} 00:00:00`;

    const cfg = loadFirebaseConfigFromEnvOrFile();
    const db = createFirestoreClient(cfg);
    const warnings = [];

    const [scheduleRows, closedRows] = await Promise.all([
      db.queryByDateRange("tbl_schedule", "task_datetime", {
        start: fetchStart,
        end: analysisEnd,
        limit: queryLimit,
      }),
      db.queryCollectionByIdDesc("tbl_closedscheds", 5000).catch(() => []),
    ]);

    if (scheduleRows.length >= queryLimit) {
      warnings.push(
        `Schedule query reached limit (${queryLimit}). Results may be truncated; increase query_limit if needed.`
      );
    }

    const closedSet = new Set(
      closedRows
        .map((row) => Number(row.sched_id || row.schedid || 0))
        .filter((id) => Number.isFinite(id) && id > 0)
    );

    const rowsWithStatus = scheduleRows
      .map((row) => {
        const status = statusKey(row, endDate, closedSet);
        return {
          ...row,
          _status: status,
          _task_date: taskDate(row),
          _purpose_label: PURPOSE_LABELS[Number(row.purpose_id || 0)] || `Purpose ${row.purpose_id || "-"}`,
        };
      })
      .filter((row) => {
        if (!row._task_date) return false;
        if (row._task_date >= startDate && row._task_date <= endDate) return true;
        return includeCarryover && ["pending", "ongoing", "carryover"].includes(row._status);
      });

    const companyIds = new Set();
    const branchIds = new Set();
    const areaIds = new Set();
    const troubleIds = new Set();
    const techIds = new Set();
    const positionIds = new Set();
    const serialIds = new Set();

    rowsWithStatus.forEach((row) => {
      const companyId = Number(row.company_id || 0);
      const branchId = Number(row.branch_id || 0);
      const troubleId = Number(row.trouble_id || 0);
      const techId = Number(row.tech_id || 0);
      const serialId = Number(row.serial || 0);
      if (companyId > 0) companyIds.add(companyId);
      if (branchId > 0) branchIds.add(branchId);
      if (troubleId > 0) troubleIds.add(troubleId);
      if (techId > 0) techIds.add(techId);
      if (serialId > 0) serialIds.add(serialId);
    });

    const [companyMap, branchMap, troubleMap, employeeMap, machineMap] = await Promise.all([
      db.fetchDocsByIds("tbl_companylist", [...companyIds]),
      db.fetchDocsByIds("tbl_branchinfo", [...branchIds]),
      db.fetchDocsByIds("tbl_trouble", [...troubleIds]),
      db.fetchDocsByIds("tbl_employee", [...techIds]),
      db.fetchDocsByIds("tbl_machine", [...serialIds]),
    ]);

    branchMap.forEach((branch) => {
      const areaId = Number(branch?.area_id || 0);
      const branchCompanyId = Number(branch?.company_id || 0);
      if (areaId > 0) areaIds.add(areaId);
      if (branchCompanyId > 0) companyIds.add(branchCompanyId);
    });

    employeeMap.forEach((employee) => {
      const positionId = Number(employee?.position_id || 0);
      if (positionId > 0) positionIds.add(positionId);
    });

    const [areaMap, positionMap] = await Promise.all([
      db.fetchDocsByIds("tbl_area", [...areaIds]),
      db.fetchDocsByIds("tbl_empos", [...positionIds]),
    ]);

    companyIds.forEach((id) => {
      if (!companyMap.has(id)) {
        const branch = [...branchMap.values()].find((b) => Number(b.company_id || 0) === id);
        if (branch) companyMap.set(id, null);
      }
    });

    const openStatuses = new Set(["pending", "ongoing", "carryover"]);

    const pendingMap = new Map();
    rowsWithStatus.forEach((row) => {
      if (!openStatuses.has(row._status)) return;

      const companyId = Number(row.company_id || 0);
      const branchId = Number(row.branch_id || 0);
      const key = `${sanitizeKeyPart(companyId)}|${sanitizeKeyPart(branchId)}`;
      if (!pendingMap.has(key)) {
        pendingMap.set(key, {
          company_id: companyId,
          branch_id: branchId,
          open_task_count: 0,
          pending_count: 0,
          ongoing_count: 0,
          carryover_count: 0,
          oldest_open_task_datetime: null,
          latest_open_task_datetime: null,
          purpose_mix: new Map(),
          trouble_mix: new Map(),
          schedule_ids: [],
        });
      }
      const item = pendingMap.get(key);
      item.open_task_count += 1;
      if (row._status === "pending") item.pending_count += 1;
      if (row._status === "ongoing") item.ongoing_count += 1;
      if (row._status === "carryover") item.carryover_count += 1;
      if (!item.oldest_open_task_datetime || String(row.task_datetime) < item.oldest_open_task_datetime) {
        item.oldest_open_task_datetime = String(row.task_datetime);
      }
      if (!item.latest_open_task_datetime || String(row.task_datetime) > item.latest_open_task_datetime) {
        item.latest_open_task_datetime = String(row.task_datetime);
      }
      item.schedule_ids.push(Number(row.id || 0));

      const purposeLabel = row._purpose_label;
      item.purpose_mix.set(purposeLabel, (item.purpose_mix.get(purposeLabel) || 0) + 1);

      const trouble = troubleMap.get(Number(row.trouble_id || 0));
      const troubleLabel = asLabel(trouble?.trouble, `Trouble ${row.trouble_id || "-"}`);
      item.trouble_mix.set(troubleLabel, (item.trouble_mix.get(troubleLabel) || 0) + 1);
    });

    const pendingCustomers = [...pendingMap.values()]
      .map((item) => {
        const company = companyMap.get(item.company_id) || null;
        const branch = branchMap.get(item.branch_id) || null;
        const area = areaMap.get(Number(branch?.area_id || 0)) || null;
        const topPurposes = [...item.purpose_mix.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([label, count]) => ({ label, count }));
        const topTroubles = [...item.trouble_mix.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([label, count]) => ({ label, count }));
        return {
          customer_id: item.company_id,
          branch_id: item.branch_id,
          customer_name: asLabel(company?.companyname, `Company #${item.company_id || "-"}`),
          branch_name: asLabel(branch?.branchname, `Branch #${item.branch_id || "-"}`),
          area_name: asLabel(area?.area_name || area?.area, "-"),
          open_task_count: item.open_task_count,
          pending_count: item.pending_count,
          ongoing_count: item.ongoing_count,
          carryover_count: item.carryover_count,
          oldest_open_task_datetime: item.oldest_open_task_datetime,
          latest_open_task_datetime: item.latest_open_task_datetime,
          top_purposes: topPurposes,
          top_troubles: topTroubles,
          sample_schedule_ids: item.schedule_ids.slice(0, 10),
        };
      })
      .sort((a, b) => {
        if (b.open_task_count !== a.open_task_count) return b.open_task_count - a.open_task_count;
        return String(a.oldest_open_task_datetime || "").localeCompare(String(b.oldest_open_task_datetime || ""));
      });

    const perTech = new Map();
    rowsWithStatus.forEach((row) => {
      const techId = Number(row.tech_id || 0);
      if (!techId) return;
      if (!perTech.has(techId)) {
        perTech.set(techId, {
          technician_id: techId,
          assigned_total: 0,
          closed_count: 0,
          pending_count: 0,
          ongoing_count: 0,
          carryover_count: 0,
          cancelled_count: 0,
          open_backlog_age_total_days: 0,
          open_backlog_count: 0,
          purpose_mix: new Map(),
        });
      }
      const item = perTech.get(techId);
      item.assigned_total += 1;
      if (row._status === "closed") item.closed_count += 1;
      if (row._status === "pending") item.pending_count += 1;
      if (row._status === "ongoing") item.ongoing_count += 1;
      if (row._status === "carryover") item.carryover_count += 1;
      if (row._status === "cancelled") item.cancelled_count += 1;
      if (openStatuses.has(row._status)) {
        item.open_backlog_count += 1;
        item.open_backlog_age_total_days += Math.max(0, dayDiff(row._task_date, endDate));
      }
      item.purpose_mix.set(row._purpose_label, (item.purpose_mix.get(row._purpose_label) || 0) + 1);
    });

    const techPerformance = [...perTech.values()]
      .map((row) => {
        const employee = employeeMap.get(row.technician_id) || null;
        const position = positionMap.get(Number(employee?.position_id || 0)) || null;
        const denominator = Math.max(0, row.assigned_total - row.cancelled_count);
        const avgOpenAge = row.open_backlog_count
          ? Number((row.open_backlog_age_total_days / row.open_backlog_count).toFixed(2))
          : 0;
        const topPurposes = [...row.purpose_mix.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([label, count]) => ({ label, count }));
        return {
          technician_id: row.technician_id,
          technician_name: employeeDisplayName(employee),
          role: roleFromPosition(position),
          assigned_total: row.assigned_total,
          closed_count: row.closed_count,
          pending_count: row.pending_count,
          ongoing_count: row.ongoing_count,
          carryover_count: row.carryover_count,
          cancelled_count: row.cancelled_count,
          completion_rate_pct: percentage(row.closed_count, denominator),
          avg_open_backlog_age_days: avgOpenAge,
          top_purposes: topPurposes,
        };
      })
      .sort((a, b) => {
        if (b.completion_rate_pct !== a.completion_rate_pct) return b.completion_rate_pct - a.completion_rate_pct;
        return b.assigned_total - a.assigned_total;
      });

    const serviceRows = rowsWithStatus.filter(
      (row) => Number(row.purpose_id || 0) === 5 && row._status !== "cancelled"
    );

    const repeatedByMachine = new Map();
    serviceRows.forEach((row) => {
      const key = `${sanitizeKeyPart(row.company_id)}|${sanitizeKeyPart(row.branch_id)}|${sanitizeKeyPart(row.serial)}`;
      if (!repeatedByMachine.has(key)) {
        repeatedByMachine.set(key, {
          company_id: Number(row.company_id || 0),
          branch_id: Number(row.branch_id || 0),
          serial: Number(row.serial || 0),
          repair_count: 0,
          first_task_datetime: null,
          last_task_datetime: null,
          trouble_set: new Set(),
          tech_set: new Set(),
          schedule_ids: [],
        });
      }
      const item = repeatedByMachine.get(key);
      item.repair_count += 1;
      item.schedule_ids.push(Number(row.id || 0));
      if (!item.first_task_datetime || String(row.task_datetime) < item.first_task_datetime) {
        item.first_task_datetime = String(row.task_datetime);
      }
      if (!item.last_task_datetime || String(row.task_datetime) > item.last_task_datetime) {
        item.last_task_datetime = String(row.task_datetime);
      }
      const trouble = troubleMap.get(Number(row.trouble_id || 0));
      const troubleLabel = asLabel(trouble?.trouble, `Trouble ${row.trouble_id || "-"}`);
      item.trouble_set.add(troubleLabel);
      const techId = Number(row.tech_id || 0);
      if (techId > 0) item.tech_set.add(techId);
    });

    const repeatedClients = [...repeatedByMachine.values()]
      .filter((item) => item.repair_count >= repeatThreshold)
      .map((item) => {
        const company = companyMap.get(item.company_id) || null;
        const branch = branchMap.get(item.branch_id) || null;
        const area = areaMap.get(Number(branch?.area_id || 0)) || null;
        const machine = machineMap.get(Number(item.serial || 0)) || null;
        return {
          customer_id: item.company_id,
          branch_id: item.branch_id,
          customer_name: asLabel(company?.companyname, `Company #${item.company_id || "-"}`),
          branch_name: asLabel(branch?.branchname, `Branch #${item.branch_id || "-"}`),
          area_name: asLabel(area?.area_name || area?.area, "-"),
          serial: item.serial || 0,
          model: asLabel(machine?.description, "-"),
          repair_count: item.repair_count,
          first_task_datetime: item.first_task_datetime,
          last_task_datetime: item.last_task_datetime,
          unique_troubles: [...item.trouble_set].sort(),
          assigned_technician_ids: [...item.tech_set].sort((a, b) => a - b),
          schedule_ids: item.schedule_ids.sort((a, b) => a - b),
        };
      })
      .sort((a, b) => {
        if (b.repair_count !== a.repair_count) return b.repair_count - a.repair_count;
        return String(b.last_task_datetime || "").localeCompare(String(a.last_task_datetime || ""));
      });

    const areaAgg = new Map();
    rowsWithStatus.forEach((row) => {
      const branch = branchMap.get(Number(row.branch_id || 0)) || null;
      const areaId = Number(row.area_id || branch?.area_id || 0);
      const key = sanitizeKeyPart(areaId);
      if (!areaAgg.has(key)) {
        areaAgg.set(key, {
          area_id: areaId,
          total_tasks: 0,
          open_count: 0,
          carryover_count: 0,
          pending_count: 0,
          ongoing_count: 0,
          closed_count: 0,
          cancelled_count: 0,
        });
      }
      const item = areaAgg.get(key);
      item.total_tasks += 1;
      if (openStatuses.has(row._status)) item.open_count += 1;
      if (row._status === "carryover") item.carryover_count += 1;
      if (row._status === "pending") item.pending_count += 1;
      if (row._status === "ongoing") item.ongoing_count += 1;
      if (row._status === "closed") item.closed_count += 1;
      if (row._status === "cancelled") item.cancelled_count += 1;
    });

    const repeatCountByArea = new Map();
    repeatedClients.forEach((item) => {
      const branch = branchMap.get(Number(item.branch_id || 0)) || null;
      const areaId = Number(branch?.area_id || 0);
      if (!areaId) return;
      repeatCountByArea.set(areaId, (repeatCountByArea.get(areaId) || 0) + 1);
    });

    const areaBackjobs = [...areaAgg.values()]
      .map((item) => {
        const area = areaMap.get(item.area_id) || null;
        return {
          area_id: item.area_id,
          area_name: asLabel(area?.area_name || area?.area, item.area_id ? `Area #${item.area_id}` : "Unassigned"),
          total_tasks: item.total_tasks,
          open_count: item.open_count,
          carryover_count: item.carryover_count,
          pending_count: item.pending_count,
          ongoing_count: item.ongoing_count,
          closed_count: item.closed_count,
          cancelled_count: item.cancelled_count,
          completion_rate_pct: percentage(item.closed_count, Math.max(0, item.total_tasks - item.cancelled_count)),
          repeat_repair_count: repeatCountByArea.get(item.area_id) || 0,
        };
      })
      .sort((a, b) => {
        if (b.carryover_count !== a.carryover_count) return b.carryover_count - a.carryover_count;
        if (b.repeat_repair_count !== a.repeat_repair_count) return b.repeat_repair_count - a.repeat_repair_count;
        return b.open_count - a.open_count;
      });

    const nonCancelledRows = rowsWithStatus.filter((row) => row._status !== "cancelled");
    const closedRowsCount = rowsWithStatus.filter((row) => row._status === "closed").length;
    const pendingRowsCount = rowsWithStatus.filter((row) => openStatuses.has(row._status)).length;

    const summary = {
      period_start: startDate,
      period_end: endDate,
      analysis_rows: rowsWithStatus.length,
      active_customers_with_pending_needs: pendingCustomers.length,
      pending_open_tasks: pendingRowsCount,
      closed_tasks: closedRowsCount,
      overall_completion_rate_pct: percentage(closedRowsCount, nonCancelledRows.length),
      areas_with_backjobs: areaBackjobs.filter((row) => row.carryover_count > 0 || row.repeat_repair_count > 0).length,
      repeated_repair_clients: repeatedClients.length,
      technicians_in_scope: techPerformance.length,
    };

    const responsePayload = {
      meta: {
        generated_at: new Date().toISOString(),
        timezone,
        query: {
          start_date: startDate,
          end_date: endDate,
          window_days: windowDays,
          carryover_days: carryoverDays,
          include_carryover: includeCarryover,
          repeat_threshold: repeatThreshold,
          query_limit: queryLimit,
        },
        warnings,
      },
      summary,
      insights: buildInsights({
        pendingCustomers,
        techPerf: techPerformance,
        areaBackjobs,
        repeatedClients,
      }),
      datasets: {
        active_customers_with_pending_needs: pendingCustomers,
        technician_performance: techPerformance,
        area_backjobs_and_repeats: areaBackjobs,
        repeatedly_repaired_clients: repeatedClients,
      },
    };

    return json(200, responsePayload);
  } catch (error) {
    return json(500, {
      error: "Failed to build OpenClaw analysis payload.",
      details: error?.message || String(error),
    });
  }
};
