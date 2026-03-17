#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULTS,
  SYNCABLE_SCHEDULE_COLUMNS,
  buildClosedScheduleCandidates,
  buildCollectionHistoryFingerprint,
  buildDumpBaseline,
  buildSchedtimeRows,
  buildScheduleUpdateRows,
  chooseCollectionHistoryRows,
  createBaselineState,
  createFirestoreClient,
  ensureDir,
  loadFirebaseOperationalState,
  parseFirebaseConfig,
  pickScheduleSubset,
  renderClosedScheduleCandidates,
  renderCollectionHistoryInserts,
  renderSchedtimeChanges,
  renderScheduleUpdates,
  summarizePlan,
} from "../tools/build-hybrid-bridge.mjs";

export { createFirestoreClient, parseFirebaseConfig } from "../tools/build-hybrid-bridge.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const COLLECTION_HISTORY_COLUMNS = [
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

const SCHEDTIME_COLUMNS = [
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
const MAX_MYSQL_INT32 = 2147483647;

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node run-local-sync.mjs [--baseline auto|dump|live] [--apply] [--loop-seconds <n>]",
      "",
      "Optional flags:",
      "  --dump <dump.sql>",
      "  --firebase-config <path>",
      "  --out-dir <dir>",
      "  --state-file <file>",
      "  --collection-history-limit <n>",
      "  --schedule-limit <n>",
      "  --schedtime-per-schedule <n>",
      "  --apply-closedscheds",
      "  --dry-run",
    ].join("\n"),
  );
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  const config = {
    baseline: "auto",
    apply: false,
    applyClosedscheds: false,
    loopSeconds: 0,
    dumpPath: null,
    firebaseConfigPath: null,
    outDir: null,
    stateFile: null,
    collectionHistoryLimit: null,
    scheduleLimit: null,
    schedtimePerSchedule: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    const next = args[i + 1];

    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    if (token === "--baseline") {
      config.baseline = String(next || "").toLowerCase();
      i += 1;
      continue;
    }
    if (token === "--apply") {
      config.apply = true;
      continue;
    }
    if (token === "--dry-run") {
      config.apply = false;
      continue;
    }
    if (token === "--apply-closedscheds") {
      config.applyClosedscheds = true;
      continue;
    }
    if (token === "--loop-seconds") {
      config.loopSeconds = Number(next || 0) || 0;
      i += 1;
      continue;
    }
    if (token === "--dump") {
      config.dumpPath = next ? path.resolve(next) : null;
      i += 1;
      continue;
    }
    if (token === "--firebase-config") {
      config.firebaseConfigPath = next ? path.resolve(next) : null;
      i += 1;
      continue;
    }
    if (token === "--out-dir") {
      config.outDir = next ? path.resolve(next) : null;
      i += 1;
      continue;
    }
    if (token === "--state-file") {
      config.stateFile = next ? path.resolve(next) : null;
      i += 1;
      continue;
    }
    if (token === "--collection-history-limit") {
      config.collectionHistoryLimit = Number(next || 0) || null;
      i += 1;
      continue;
    }
    if (token === "--schedule-limit") {
      config.scheduleLimit = Number(next || 0) || null;
      i += 1;
      continue;
    }
    if (token === "--schedtime-per-schedule") {
      config.schedtimePerSchedule = Number(next || 0) || null;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!["auto", "dump", "live"].includes(config.baseline)) {
    throw new Error(`Invalid --baseline value: ${config.baseline}`);
  }

  return config;
}

export function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function stripQuotes(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

export function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const out = {};

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const equalsIdx = trimmed.indexOf("=");
    if (equalsIdx < 0) return;
    const key = trimmed.slice(0, equalsIdx).trim();
    const value = stripQuotes(trimmed.slice(equalsIdx + 1));
    out[key] = value;
  });

  return out;
}

export function resolveMaybeRelative(baseDir, targetPath, fallback = null) {
  const value = targetPath || fallback;
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  return path.resolve(baseDir, value);
}

export function buildRuntimeConfig(argv) {
  const cli = parseArgs(argv);
  const envPath = path.join(__dirname, ".env");
  const envFile = loadEnvFile(envPath);

  const config = {
    baseline: cli.baseline,
    apply: cli.apply,
    applyClosedscheds: cli.applyClosedscheds || parseBooleanEnv(envFile.ENABLE_CLOSEDSCHEDS, false),
    loopSeconds: cli.loopSeconds,
    firebaseConfigPath: resolveMaybeRelative(__dirname, cli.firebaseConfigPath, envFile.FIREBASE_CONFIG_PATH || "../shared/js/firebase-config.js"),
    dumpPath: resolveMaybeRelative(__dirname, cli.dumpPath, envFile.DUMP_PATH),
    outDir: resolveMaybeRelative(__dirname, cli.outDir, envFile.OUT_DIR || "./output"),
    stateFile: resolveMaybeRelative(__dirname, cli.stateFile, envFile.STATE_FILE || "./state/last-run.json"),
    collectionHistoryLimit: cli.collectionHistoryLimit || Number(envFile.COLLECTION_HISTORY_LIMIT || DEFAULTS.collectionHistoryLimit),
    scheduleLimit: cli.scheduleLimit || Number(envFile.SCHEDULE_LIMIT || DEFAULTS.scheduleLimit),
    schedtimePerSchedule: cli.schedtimePerSchedule || Number(envFile.SCHEDTIME_PER_SCHEDULE || DEFAULTS.schedtimePerSchedule),
    mysql: {
      host: envFile.MYSQL_HOST || process.env.MYSQL_HOST || "",
      port: Number(envFile.MYSQL_PORT || process.env.MYSQL_PORT || 3306),
      user: envFile.MYSQL_USER || process.env.MYSQL_USER || "",
      password: envFile.MYSQL_PASSWORD || process.env.MYSQL_PASSWORD || "",
      database: envFile.MYSQL_DATABASE || process.env.MYSQL_DATABASE || "",
    },
  };

  if (config.baseline === "dump" && !config.dumpPath) {
    throw new Error("Dump baseline selected but no DUMP_PATH or --dump was provided.");
  }

  if (config.baseline === "live" && !hasMysqlConfig(config.mysql)) {
    throw new Error("Live baseline selected but MySQL connection details are missing in local-sync/.env.");
  }

  if (config.baseline === "auto" && !hasMysqlConfig(config.mysql) && !config.dumpPath) {
    throw new Error("Auto baseline needs either working MySQL settings or a dump path in local-sync/.env.");
  }

  if (config.apply && !hasMysqlConfig(config.mysql)) {
    throw new Error("MySQL apply mode needs MYSQL_HOST, MYSQL_PORT, MYSQL_USER, and MYSQL_DATABASE in local-sync/.env.");
  }

  return config;
}

export function hasMysqlConfig(mysqlConfig) {
  return Boolean(
    mysqlConfig.host
    && mysqlConfig.port
    && mysqlConfig.user
    && mysqlConfig.database,
  );
}

export function uniqueNumeric(values) {
  return [...new Set(values.map((value) => Number(value || 0) || 0).filter((value) => value > 0))];
}

export function toInvoiceRef(doc) {
  return String(doc?.invoice_num || doc?.invoice_id || doc?.invoice_no || doc?.invoiceno || "").trim();
}

export function readState(statePath) {
  if (!fs.existsSync(statePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

export function writeState(statePath, nextState) {
  ensureDir(path.dirname(statePath));
  fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2));
}

export async function importMysql() {
  try {
    return await import("mysql2/promise");
  } catch (error) {
    throw new Error(
      "mysql2 is not installed. Run `npm install` inside D:\\Codex\\Github\\marga-app\\local-sync first.",
      { cause: error },
    );
  }
}

export async function createMysqlPool(mysqlConfig) {
  const mysql = await importMysql();
  return mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
    waitForConnections: true,
    connectionLimit: 4,
    namedPlaceholders: false,
    decimalNumbers: true,
    dateStrings: true,
  });
}

export async function queryInChunks(pool, values, makeSql, mapRow, chunkSize = 500) {
  const rows = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    const chunk = values.slice(index, index + chunkSize);
    const sql = makeSql(chunk);
    const [result] = await pool.query(sql, chunk);
    result.forEach((row) => rows.push(mapRow ? mapRow(row) : row));
  }
  return rows;
}

export async function buildLiveBaseline(pool, firebaseState) {
  const baseline = createBaselineState();

  const [collectionMaxRows] = await pool.query("SELECT COALESCE(MAX(`id`), 0) AS maxId FROM `tbl_collectionhistory`");
  baseline.collectionhistory.maxId = Number(collectionMaxRows[0]?.maxId || 0) || 0;

  const invoiceRefs = [...new Set(firebaseState.collectionHistoryDocs.map(toInvoiceRef).filter(Boolean))];
  if (invoiceRefs.length) {
    const existingRows = await queryInChunks(
      pool,
      invoiceRefs,
      (chunk) => [
        "SELECT `invoice_num`, `timestamp`, `followup_datetime`, `remarks`, `contact_person`, `contact_number`",
        "FROM `tbl_collectionhistory`",
        `WHERE \`invoice_num\` IN (${chunk.map(() => "?").join(", ")})`,
      ].join(" "),
      null,
      250,
    );

    existingRows.forEach((row) => {
      baseline.collectionhistory.fingerprints.add(buildCollectionHistoryFingerprint(row));
    });
  }

  const [scheduleMaxRows] = await pool.query("SELECT COALESCE(MAX(`id`), 0) AS maxId FROM `tbl_schedule`");
  baseline.schedule.maxId = Number(scheduleMaxRows[0]?.maxId || 0) || 0;

  const scheduleIds = uniqueNumeric([...firebaseState.scheduleDocs.keys()]);
  if (scheduleIds.length) {
    const scheduleColumnsSql = SYNCABLE_SCHEDULE_COLUMNS.map((column) => `\`${column}\``).join(", ");
    const existingSchedules = await queryInChunks(
      pool,
      scheduleIds,
      (chunk) => [
        `SELECT \`id\`, ${scheduleColumnsSql}`,
        "FROM `tbl_schedule`",
        `WHERE \`id\` IN (${chunk.map(() => "?").join(", ")})`,
      ].join(" "),
      null,
    );

    existingSchedules.forEach((row) => {
      baseline.schedule.rows.set(String(row.id), pickScheduleSubset(row));
    });
  }

  const [schedtimeMaxRows] = await pool.query("SELECT COALESCE(MAX(`id`), 0) AS maxId FROM `tbl_schedtime`");
  baseline.schedtime.maxId = Number(schedtimeMaxRows[0]?.maxId || 0) || 0;

  const schedtimeIds = uniqueNumeric(firebaseState.schedtimeDocs.map((doc) => doc.id));
  const schedtimeScheduleIds = uniqueNumeric(firebaseState.schedtimeDocs.map((doc) => doc.schedule_id));
  if (schedtimeIds.length) {
    const existingSchedtime = await queryInChunks(
      pool,
      schedtimeIds,
      (chunk) => `SELECT * FROM \`tbl_schedtime\` WHERE \`id\` IN (${chunk.map(() => "?").join(", ")})`,
      null,
    );

    existingSchedtime.forEach((row) => {
      baseline.schedtime.rows.set(String(row.id), row);
    });
  }

  if (schedtimeScheduleIds.length) {
    const existingSchedtimeBySchedule = await queryInChunks(
      pool,
      schedtimeScheduleIds,
      (chunk) => `SELECT * FROM \`tbl_schedtime\` WHERE \`schedule_id\` IN (${chunk.map(() => "?").join(", ")})`,
      null,
    );

    existingSchedtimeBySchedule.forEach((row) => {
      baseline.schedtime.rows.set(String(row.id), row);
    });
  }

  const [closedschedMaxRows] = await pool.query("SELECT COALESCE(MAX(`id`), 0) AS maxId FROM `tbl_closedscheds`");
  baseline.closedscheds.maxId = Number(closedschedMaxRows[0]?.maxId || 0) || 0;

  if (scheduleIds.length) {
    const closedRows = await queryInChunks(
      pool,
      scheduleIds,
      (chunk) => `SELECT \`sched_id\` FROM \`tbl_closedscheds\` WHERE \`sched_id\` IN (${chunk.map(() => "?").join(", ")})`,
      null,
    );

    closedRows.forEach((row) => {
      const scheduleId = Number(row.sched_id || 0) || 0;
      if (scheduleId > 0) baseline.closedscheds.scheduleIds.add(String(scheduleId));
    });
  }

  return baseline;
}

export function buildPatchSql(plan, config) {
  return [
    "-- MARGA Local Sync SQL Patch",
    `-- Generated: ${new Date().toISOString()}`,
    `-- Baseline mode: ${config.baselineMode}`,
    ...(config.dumpPath ? [`-- Dump baseline: ${config.dumpPath}`] : []),
    "START TRANSACTION;",
    "",
    renderCollectionHistoryInserts(plan.collectionHistoryInserts),
    renderScheduleUpdates(plan.scheduleUpdates),
    renderSchedtimeChanges(plan.schedtimeChanges),
    "COMMIT;",
    "",
  ].join("\n");
}

export function writeOutputs(config, plan, report) {
  ensureDir(config.outDir);
  const sqlPath = path.join(config.outDir, "mysql-bridge-patch.sql");
  const optionalSqlPath = path.join(config.outDir, "mysql-bridge-optional-closedscheds.sql");
  const reportPath = path.join(config.outDir, "mysql-bridge-report.json");

  fs.writeFileSync(sqlPath, buildPatchSql(plan, config));
  fs.writeFileSync(optionalSqlPath, renderClosedScheduleCandidates(plan.closedScheduleCandidates));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  return { sqlPath, optionalSqlPath, reportPath };
}

export async function buildPlan(config, pool) {
  const firebase = createFirestoreClient(parseFirebaseConfig(config.firebaseConfigPath));
  const firebaseState = await loadFirebaseOperationalState(firebase, config);

  let baseline;
  let baselineMode = "dump";

  if ((config.baseline === "live" || config.baseline === "auto") && pool) {
    baseline = await buildLiveBaseline(pool, firebaseState);
    baselineMode = "live";
  } else {
    baseline = await buildDumpBaseline(config.dumpPath);
    baselineMode = "dump";
  }

  const collectionHistoryInserts = chooseCollectionHistoryRows(firebaseState.collectionHistoryDocs, baseline);
  const scheduleUpdates = buildScheduleUpdateRows(firebaseState.scheduleDocs, baseline);
  const schedtimeChanges = buildSchedtimeRows(firebaseState.schedtimeDocs, baseline);
  const closedScheduleCandidates = buildClosedScheduleCandidates(scheduleUpdates, firebaseState.scheduleDocs, baseline);

  return {
    baseline,
    baselineMode,
    collectionHistoryInserts,
    scheduleUpdates,
    schedtimeChanges,
    closedScheduleCandidates,
  };
}

export function summarizeRun(plan, config) {
  const base = summarizePlan(plan);
  return {
    ...base,
    mode: config.apply ? "apply" : "dry-run",
    baselineMode: plan.baselineMode,
    outputDir: config.outDir,
  };
}

export async function applyCollectionHistory(connection, rows) {
  if (!rows.length) return 0;
  const placeholders = COLLECTION_HISTORY_COLUMNS.map(() => "?").join(", ");
  const sql = `INSERT INTO \`tbl_collectionhistory\` (${COLLECTION_HISTORY_COLUMNS.map((column) => `\`${column}\``).join(", ")}) VALUES (${placeholders})`;

  for (const row of rows) {
    await connection.execute(sql, COLLECTION_HISTORY_COLUMNS.map((column) => row[column] ?? null));
  }

  return rows.length;
}

export async function applyScheduleUpdates(connection, rows) {
  let count = 0;

  for (const row of rows) {
    const entries = Object.entries(row.changes || {});
    if (!entries.length) continue;

    const assignments = entries.map(([column]) => `\`${column}\` = ?`).join(", ");
    const params = [...entries.map(([, value]) => value ?? null), row.id];
    const [result] = await connection.execute(
      `UPDATE \`tbl_schedule\` SET ${assignments} WHERE \`id\` = ?`,
      params,
    );

    count += Number(result.affectedRows || 0) > 0 ? 1 : 0;
  }

  return count;
}

export async function applySchedtime(connection, changes) {
  let insertCount = 0;
  let updateCount = 0;
  const fullInsertSql = `INSERT INTO \`tbl_schedtime\` (${SCHEDTIME_COLUMNS.map((column) => `\`${column}\``).join(", ")}) VALUES (${SCHEDTIME_COLUMNS.map(() => "?").join(", ")})`;
  const autoIdColumns = SCHEDTIME_COLUMNS.filter((column) => column !== "id");
  const autoIdInsertSql = `INSERT INTO \`tbl_schedtime\` (${autoIdColumns.map((column) => `\`${column}\``).join(", ")}) VALUES (${autoIdColumns.map(() => "?").join(", ")})`;
  const allocateGapId = async () => {
    const [rows] = await connection.query(
      [
        "SELECT t1.id - 1 AS availableId",
        "FROM `tbl_schedtime` t1",
        "LEFT JOIN `tbl_schedtime` t2 ON t2.id = t1.id - 1",
        "WHERE t1.id > 1 AND t1.id <= ? AND t2.id IS NULL",
        "ORDER BY t1.id DESC",
        "LIMIT 1",
      ].join(" "),
      [MAX_MYSQL_INT32],
    );
    const availableId = Number(rows[0]?.availableId || 0) || 0;
    if (!availableId) {
      throw new Error("tbl_schedtime has no remaining INT id gap for Firebase writeback.");
    }
    return availableId;
  };

  for (const row of changes.inserts) {
    if ((Number(row.id || 0) || 0) >= MAX_MYSQL_INT32) {
      const fallbackId = await allocateGapId();
      await connection.execute(
        fullInsertSql,
        SCHEDTIME_COLUMNS.map((column) => (column === "id" ? fallbackId : (row[column] ?? null))),
      );
    } else {
      await connection.execute(fullInsertSql, SCHEDTIME_COLUMNS.map((column) => row[column] ?? null));
    }
    insertCount += 1;
  }

  for (const row of changes.updates) {
    const entries = Object.entries(row.changes || {}).filter(([column]) => column !== "id");
    if (!entries.length) continue;

    const assignments = entries.map(([column]) => `\`${column}\` = ?`).join(", ");
    const params = [...entries.map(([, value]) => value ?? null), row.id];
    const [result] = await connection.execute(
      `UPDATE \`tbl_schedtime\` SET ${assignments} WHERE \`id\` = ?`,
      params,
    );

    updateCount += Number(result.affectedRows || 0) > 0 ? 1 : 0;
  }

  return { insertCount, updateCount };
}

export async function applyClosedSchedules(connection, rows) {
  if (!rows.length) return 0;
  let count = 0;

  for (const row of rows) {
    await connection.execute(
      "INSERT INTO `tbl_closedscheds` (`id`, `sched_id`) VALUES (?, ?)",
      [row.id, row.sched_id],
    );
    count += 1;
  }

  return count;
}

export async function applyPlan(pool, plan, config) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const collectionHistoryApplied = await applyCollectionHistory(connection, plan.collectionHistoryInserts);
    const scheduleApplied = await applyScheduleUpdates(connection, plan.scheduleUpdates);
    const schedtimeApplied = await applySchedtime(connection, plan.schedtimeChanges);
    const closedSchedsApplied = config.applyClosedscheds
      ? await applyClosedSchedules(connection, plan.closedScheduleCandidates)
      : 0;

    await connection.commit();

    return {
      collectionHistoryApplied,
      scheduleApplied,
      schedtimeInsertsApplied: schedtimeApplied.insertCount,
      schedtimeUpdatesApplied: schedtimeApplied.updateCount,
      closedSchedsApplied,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runOnce(config) {
  let pool = null;
  const currentState = readState(config.stateFile);
  const nextState = {
    ...currentState,
    lastAttemptAt: new Date().toISOString(),
  };

  try {
    if ((config.baseline === "live" || config.apply) && hasMysqlConfig(config.mysql)) {
      pool = await createMysqlPool(config.mysql);
    }

    const plan = await buildPlan(config, pool);
    config.baselineMode = plan.baselineMode;
    const report = summarizeRun(plan, config);
    const outputs = writeOutputs(config, plan, report);

    let applied = null;
    if (config.apply) {
      if (!pool) {
        throw new Error("Live apply requested but no MySQL pool is available.");
      }
      applied = await applyPlan(pool, plan, config);
      report.applied = applied;
      fs.writeFileSync(outputs.reportPath, JSON.stringify(report, null, 2));
    }

    writeState(config.stateFile, {
      ...nextState,
      lastSuccessAt: new Date().toISOString(),
      lastErrorAt: null,
      lastErrorMessage: null,
      lastSummary: report.summary,
      lastBaselineMode: plan.baselineMode,
      lastApplyMode: config.apply,
      lastOutputs: outputs,
      lastApplied: applied,
    });

    console.log(`[${new Date().toISOString()}] Sync run complete.`);
    console.log(`- Baseline: ${plan.baselineMode}`);
    console.log(`- Mode: ${config.apply ? "apply" : "dry-run"}`);
    console.log(`- Collection history inserts: ${report.summary.collectionhistoryInserts}`);
    console.log(`- Schedule updates: ${report.summary.scheduleUpdates}`);
    console.log(`- Schedtime inserts: ${report.summary.schedtimeInserts}`);
    console.log(`- Schedtime updates: ${report.summary.schedtimeUpdates}`);
    console.log(`- Optional closedsched candidates: ${report.summary.optionalClosedSchedInserts}`);
    if (config.apply && applied) {
      console.log(`- Applied collection history inserts: ${applied.collectionHistoryApplied}`);
      console.log(`- Applied schedule updates: ${applied.scheduleApplied}`);
      console.log(`- Applied schedtime inserts: ${applied.schedtimeInsertsApplied}`);
      console.log(`- Applied schedtime updates: ${applied.schedtimeUpdatesApplied}`);
      console.log(`- Applied closedsched inserts: ${applied.closedSchedsApplied}`);
    }
    console.log(`- Patch SQL: ${outputs.sqlPath}`);
    console.log(`- Report JSON: ${outputs.reportPath}`);
  } catch (error) {
    writeState(config.stateFile, {
      ...nextState,
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: error.message || String(error),
    });
    throw error;
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

export async function main() {
  const config = buildRuntimeConfig(process.argv);
  ensureDir(config.outDir);
  ensureDir(path.dirname(config.stateFile));

  do {
    try {
      await runOnce(config);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Sync run failed: ${error.message || String(error)}`);
      if (!config.loopSeconds) process.exitCode = 1;
    }

    if (!config.loopSeconds) break;
    await sleep(config.loopSeconds * 1000);
  } while (true);
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main();
}
