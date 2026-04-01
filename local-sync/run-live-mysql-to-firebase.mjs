#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createMysqlPool,
  hasMysqlConfig,
  loadEnvFile,
  parseBooleanEnv,
  readState,
  resolveMaybeRelative,
  writeState,
} from "./run-local-sync.mjs";
import {
  createWritableFirestoreClient,
  getWatermarkMap,
  parseFirebaseConfig,
} from "./run-dump-to-firebase.mjs";
import { getManifestEntry, getMysqlToFirebaseDefaultConfig } from "./sync-manifest.mjs";
import { ensureDir } from "../tools/build-hybrid-bridge.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MANIFEST_DEFAULTS = getMysqlToFirebaseDefaultConfig();

const SYNC_STATE_COLLECTION = "sys_sync_state";
const DEFAULT_TABLES = MANIFEST_DEFAULTS.tables;
const DEFAULT_BOOTSTRAP_TABLES = MANIFEST_DEFAULTS.bootstrapTables;
const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_BOOTSTRAP_DAYS = 31;
const DEFAULT_MUTABLE_TABLES = MANIFEST_DEFAULTS.mutableTables;
const DEFAULT_MUTABLE_LOOKBACK_HOURS = MANIFEST_DEFAULTS.mutableLookbackHours;
const TABLE_ID_HINTS = {
  tbl_schedule: "id",
  tbl_printedscheds: "id",
  tbl_savedscheds: "id",
  tbl_schedtime: "id",
  tbl_closedscheds: "id",
  tbl_collectionhistory: "id",
  tbl_collectioninfo: "id",
  tbl_collections: "id",
  tbl_billinfo: "id",
  tbl_billout: "id",
  tbl_billoutparticular: "id",
  tbl_billoutparticulars: "id",
  tbl_billing: "id",
  tbl_branchcontact: "id",
  tbl_customerinfo: "id",
  tbl_customertype: "id",
  tbl_machine: "id",
  tbl_machinereading: "id",
  tbl_contractmain: "id",
  tbl_contractdep: "id",
  tbl_contractdetails: "id",
  tbl_contractinfo: "id",
  tbl_contracthistory: "id",
  tbl_newmachinehistory: "id",
  tbl_paymentinfo: "id",
  tbl_payments: "id",
  tbl_paymentcheck: "id",
  tbl_checkpayments: "id",
  tbl_ornumber: "id",
  tbl_deliveryinfo: "id",
  tbl_finaldr: "id",
  tbl_finaldrdetails: "id",
  tbl_inventoryparts: "id",
  tbl_partstype: "id",
};
const DATE_COLUMN_CANDIDATES = ["task_datetime", "schedule_date", "timestmp", "updated_at", "original_sched"];

function toIsoNow() {
  return new Date().toISOString();
}

function defaultPaths() {
  return {
    firebaseConfigPath: path.resolve(__dirname, "../shared/js/firebase-config.js"),
    outDir: path.resolve(__dirname, "output"),
    stateFile: path.resolve(__dirname, "state/last-run.json"),
  };
}

function parseTableList(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean),
  )];
}

function parseListMode(value) {
  return String(value || "").trim().toLowerCase() === "replace" ? "replace" : "merge";
}

function mergeTableLists(defaults, envEntries, mode) {
  const normalizedDefaults = [...new Set((defaults || []).map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean))];
  const normalizedEnvEntries = [...new Set((envEntries || []).map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean))];
  if (mode === "replace" && normalizedEnvEntries.length) return normalizedEnvEntries;
  return [...new Set([...normalizedDefaults, ...normalizedEnvEntries])];
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const config = {
    firebaseConfigPath: null,
    outDir: null,
    stateFile: null,
    tables: null,
    bootstrapTables: null,
    mutableTables: null,
    bootstrapDays: null,
    mutableLookbackHours: null,
    batchSize: null,
    dryRun: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];

    if (token === "--firebase-config") {
      config.firebaseConfigPath = next ? path.resolve(next) : null;
      index += 1;
      continue;
    }
    if (token === "--out-dir") {
      config.outDir = next ? path.resolve(next) : null;
      index += 1;
      continue;
    }
    if (token === "--state-file") {
      config.stateFile = next ? path.resolve(next) : null;
      index += 1;
      continue;
    }
    if (token === "--tables") {
      config.tables = parseTableList(next);
      index += 1;
      continue;
    }
    if (token === "--batch-size") {
      config.batchSize = Number(next || 0) || null;
      index += 1;
      continue;
    }
    if (token === "--bootstrap-tables") {
      config.bootstrapTables = parseTableList(next);
      index += 1;
      continue;
    }
    if (token === "--bootstrap-days") {
      config.bootstrapDays = Number(next || 0) || null;
      index += 1;
      continue;
    }
    if (token === "--mutable-tables") {
      config.mutableTables = parseTableList(next);
      index += 1;
      continue;
    }
    if (token === "--mutable-lookback-hours") {
      config.mutableLookbackHours = Number(next || 0) || null;
      index += 1;
      continue;
    }
    if (token === "--dry-run") {
      config.dryRun = true;
      continue;
    }
    if (token === "--write") {
      config.dryRun = false;
      continue;
    }
  }

  return config;
}

export function loadLiveMysqlSyncConfig(overrides = {}) {
  const env = loadEnvFile(path.join(__dirname, ".env"));
  const paths = defaultPaths();
  const tableListMode = parseListMode(overrides.tablesMode || env.MYSQL_TO_FIREBASE_TABLES_MODE);
  const bootstrapListMode = parseListMode(overrides.bootstrapTablesMode || env.MYSQL_TO_FIREBASE_BOOTSTRAP_TABLES_MODE);
  const mutableListMode = parseListMode(overrides.mutableTablesMode || env.MYSQL_TO_FIREBASE_MUTABLE_TABLES_MODE);
  const tables = overrides.tables?.length
    ? overrides.tables
    : mergeTableLists(DEFAULT_TABLES, parseTableList(env.MYSQL_TO_FIREBASE_TABLES), tableListMode);
  const bootstrapTables = overrides.bootstrapTables?.length
    ? overrides.bootstrapTables
    : mergeTableLists(DEFAULT_BOOTSTRAP_TABLES, parseTableList(env.MYSQL_TO_FIREBASE_BOOTSTRAP_TABLES), bootstrapListMode);
  const mutableTables = overrides.mutableTables?.length
    ? overrides.mutableTables
    : mergeTableLists(DEFAULT_MUTABLE_TABLES, parseTableList(env.MYSQL_TO_FIREBASE_MUTABLE_TABLES), mutableListMode);

  return {
    firebaseConfigPath: resolveMaybeRelative(__dirname, overrides.firebaseConfigPath, env.FIREBASE_CONFIG_PATH || paths.firebaseConfigPath),
    outDir: resolveMaybeRelative(__dirname, overrides.outDir, env.OUT_DIR || paths.outDir),
    stateFile: resolveMaybeRelative(__dirname, overrides.stateFile, env.STATE_FILE || paths.stateFile),
    serviceAccountEmail: overrides.serviceAccountEmail || env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    serviceAccountPrivateKey: overrides.serviceAccountPrivateKey || env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "",
    tables: tables.length ? tables : DEFAULT_TABLES,
    bootstrapTables: bootstrapTables.length ? bootstrapTables : DEFAULT_BOOTSTRAP_TABLES,
    bootstrapDays: Number(overrides.bootstrapDays || env.MYSQL_TO_FIREBASE_BOOTSTRAP_DAYS || DEFAULT_BOOTSTRAP_DAYS) || DEFAULT_BOOTSTRAP_DAYS,
    mutableTables: mutableTables.length ? mutableTables : DEFAULT_MUTABLE_TABLES,
    mutableLookbackHours: Number(overrides.mutableLookbackHours || env.MYSQL_TO_FIREBASE_MUTABLE_LOOKBACK_HOURS || DEFAULT_MUTABLE_LOOKBACK_HOURS) || DEFAULT_MUTABLE_LOOKBACK_HOURS,
    batchSize: Number(overrides.batchSize || env.MYSQL_TO_FIREBASE_BATCH_SIZE || DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE,
    dryRun: overrides.dryRun !== undefined
      ? Boolean(overrides.dryRun)
      : !parseBooleanEnv(env.MYSQL_TO_FIREBASE_WRITE_ENABLED, true),
    mysql: {
      host: overrides.mysql?.host || env.MYSQL_HOST || process.env.MYSQL_HOST || "",
      port: Number(overrides.mysql?.port || env.MYSQL_PORT || process.env.MYSQL_PORT || 3306),
      user: overrides.mysql?.user || env.MYSQL_USER || process.env.MYSQL_USER || "",
      password: overrides.mysql?.password || env.MYSQL_PASSWORD || process.env.MYSQL_PASSWORD || "",
      database: overrides.mysql?.database || env.MYSQL_DATABASE || process.env.MYSQL_DATABASE || "",
    },
  };
}

function sanitizeMysqlRecord(table, row) {
  const out = { ...row };
  if (table === "tbl_schedule" || table === "tbl_printedscheds" || table === "tbl_savedscheds" || table === "tbl_schedtime" || table === "tbl_closedscheds") {
    out.bridge_source = "live_mysql";
    out.bridge_pushed_at = toIsoNow();
  }
  return out;
}

function formatDbDateTime(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function resolveBootstrapDateColumn(columns) {
  return DATE_COLUMN_CANDIDATES.find((columnName) => columns.some((column) => column.name === columnName)) || "";
}

function buildBootstrapStartDateTime(days) {
  const lookbackDays = Math.max(1, Math.trunc(days || DEFAULT_BOOTSTRAP_DAYS));
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - lookbackDays);
  return formatDbDateTime(date);
}

function buildMutableLookbackDateTime(hours) {
  const lookbackHours = Math.max(1, Math.trunc(hours || DEFAULT_MUTABLE_LOOKBACK_HOURS));
  const date = new Date(Date.now() - (lookbackHours * 60 * 60 * 1000));
  return formatDbDateTime(date);
}

async function describeTable(pool, table) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
  return rows.map((row) => ({
    name: String(row.Field || ""),
    key: String(row.Key || ""),
    extra: String(row.Extra || ""),
    type: String(row.Type || "").toLowerCase(),
  }));
}

function resolveMutableDateColumn(columns) {
  const preferred = ["timestmp", "updated_at"];
  return preferred.find((columnName) => columns.some((column) => column.name === columnName)) || "";
}

function resolveManifestMutableDateColumn(table, columns) {
  const entry = getManifestEntry(table);
  const configured = String(entry?.mysqlToFirebase?.mutableDateColumn || "").trim();
  if (configured && columns.some((column) => column.name === configured)) return configured;
  return resolveMutableDateColumn(columns);
}

function getManifestFullResyncIntervalMinutes(table) {
  const entry = getManifestEntry(table);
  return Number(entry?.mysqlToFirebase?.fullResyncIntervalMinutes || 0) || 0;
}

function shouldRunFullResyncForTable(table, stateSnapshot) {
  const intervalMinutes = getManifestFullResyncIntervalMinutes(table);
  if (intervalMinutes <= 0) return false;
  const lastRun = String(stateSnapshot?.fullResyncAtByTable?.[table] || "").trim();
  if (!lastRun) return true;
  const lastTs = new Date(lastRun).getTime();
  if (!Number.isFinite(lastTs)) return true;
  return (Date.now() - lastTs) >= (intervalMinutes * 60 * 1000);
}

function guessIdColumn(table, columns) {
  const hint = TABLE_ID_HINTS[table];
  if (hint && columns.some((column) => column.name === hint)) return hint;

  const primary = columns.find((column) => column.key === "PRI" && /(int|bigint|smallint|mediumint|tinyint)/.test(column.type));
  if (primary) return primary.name;

  const namedId = columns.find((column) => column.name === "id");
  if (namedId) return namedId.name;

  const firstNumeric = columns.find((column) => /(int|bigint|smallint|mediumint|tinyint)/.test(column.type));
  return firstNumeric?.name || "";
}

async function fetchMaxId(pool, table, idColumn) {
  const [rows] = await pool.query(`SELECT COALESCE(MAX(\`${idColumn}\`), 0) AS maxId FROM \`${table}\``);
  return Number(rows[0]?.maxId || 0) || 0;
}

async function fetchRowsAfter(pool, table, idColumn, lastId, batchSize) {
  const sql = [
    `SELECT * FROM \`${table}\``,
    `WHERE \`${idColumn}\` > ?`,
    `ORDER BY \`${idColumn}\` ASC`,
    `LIMIT ${Math.max(1, Math.trunc(batchSize || DEFAULT_BATCH_SIZE))}`,
  ].join(" ");
  const [rows] = await pool.execute(sql, [lastId]);
  return Array.isArray(rows) ? rows : [];
}

async function fetchRowsForBootstrap(pool, table, idColumn, dateColumn, startDateTime, batchSize) {
  const sql = [
    `SELECT * FROM \`${table}\``,
    `WHERE \`${dateColumn}\` >= ?`,
    `ORDER BY \`${idColumn}\` ASC`,
    `LIMIT ${Math.max(1, Math.trunc(batchSize || DEFAULT_BATCH_SIZE) * 20)}`,
  ].join(" ");
  const [rows] = await pool.execute(sql, [startDateTime]);
  return Array.isArray(rows) ? rows : [];
}

async function fetchRowsForMutableScan(pool, table, idColumn, dateColumn, startDateTime, batchSize) {
  const sql = [
    `SELECT * FROM \`${table}\``,
    `WHERE \`${dateColumn}\` >= ?`,
    `ORDER BY \`${dateColumn}\` ASC, \`${idColumn}\` ASC`,
    `LIMIT ${Math.max(1, Math.trunc(batchSize || DEFAULT_BATCH_SIZE) * 20)}`,
  ].join(" ");
  const [rows] = await pool.execute(sql, [startDateTime]);
  return Array.isArray(rows) ? rows : [];
}

async function fetchRowsByIds(pool, table, idColumn, ids) {
  if (!ids.length) return [];
  const sortedIds = [...new Set(ids.map((value) => Number(value || 0)).filter((value) => value > 0))].sort((left, right) => left - right);
  const rows = [];
  const chunkSize = 200;
  for (let index = 0; index < sortedIds.length; index += chunkSize) {
    const chunk = sortedIds.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const [result] = await pool.execute(
      `SELECT * FROM \`${table}\` WHERE \`${idColumn}\` IN (${placeholders}) ORDER BY \`${idColumn}\` ASC`,
      chunk,
    );
    if (Array.isArray(result)) rows.push(...result);
  }
  return rows;
}

async function fetchAllRowsForFullResync(pool, table, idColumn, batchSize) {
  const rows = [];
  let cursor = 0;
  while (true) {
    const batch = await fetchRowsAfter(pool, table, idColumn, cursor, Math.max(1, Math.trunc(batchSize || DEFAULT_BATCH_SIZE) * 4));
    if (!batch.length) break;
    rows.push(...batch);
    cursor = Number(batch[batch.length - 1]?.[idColumn] || cursor) || cursor;
    if (!cursor) break;
  }
  return rows;
}

function summarizeReport(stats, reportPath) {
  const tableStatusCounts = {};
  const warningTables = [];
  const zeroRowTables = [];
  Object.values(stats.tables).forEach((table) => {
    const status = table.status || "pending";
    tableStatusCounts[status] = (tableStatusCounts[status] || 0) + 1;
    if (status.startsWith("skipped")) warningTables.push(table.table);
    if ((table.watermarkAfter || 0) === 0 && (table.pushed || 0) === 0) zeroRowTables.push(table.table);
  });
  return {
    generatedAt: toIsoNow(),
    mode: stats.dryRun ? "dry-run" : "write",
    direction: "live_mysql_to_firebase",
    reportPath,
    summary: {
      insertedRows: stats.insertedRows,
      skippedRows: stats.skippedRows,
      baselineInitializedTables: Object.values(stats.tables).filter((table) => table.baselineInitialized).map((table) => table.table),
      schedulePushed: stats.tables.tbl_schedule?.pushed || 0,
      printedschedPushed: stats.tables.tbl_printedscheds?.pushed || 0,
      savedschedPushed: stats.tables.tbl_savedscheds?.pushed || 0,
      schedtimePushed: stats.tables.tbl_schedtime?.pushed || 0,
      closedschedPushed: stats.tables.tbl_closedscheds?.pushed || 0,
      syncedTableCount: Object.values(stats.tables).filter((table) => (table.pushed || 0) > 0).length,
      tableStatusCounts,
      warningTables,
      zeroRowTables,
    },
    tables: stats.tables,
  };
}

export async function runLiveMysqlToFirebase(config, hooks = {}) {
  if (!hasMysqlConfig(config.mysql)) {
    throw new Error("Live MySQL sync needs MYSQL_HOST, MYSQL_PORT, MYSQL_USER, and MYSQL_DATABASE.");
  }

  const emit = hooks.onActivity || (() => {});
  const reportPath = path.join(config.outDir, "live-mysql-to-firebase-report.json");
  const db = createWritableFirestoreClient({
    ...parseFirebaseConfig(config.firebaseConfigPath),
    serviceAccountEmail: config.serviceAccountEmail || "",
    serviceAccountPrivateKey: config.serviceAccountPrivateKey || "",
  });
  const pool = await createMysqlPool(config.mysql);
  const tables = [...new Set((config.tables || DEFAULT_TABLES).map((table) => String(table).trim().toLowerCase()).filter(Boolean))];
  const bootstrapTables = new Set((config.bootstrapTables || DEFAULT_BOOTSTRAP_TABLES).map((table) => String(table).trim().toLowerCase()).filter(Boolean));
  const mutableTables = new Set((config.mutableTables || DEFAULT_MUTABLE_TABLES).map((table) => String(table).trim().toLowerCase()).filter(Boolean));
  const watermarkMap = await getWatermarkMap(db, tables);
  const pendingWrites = [];
  const pendingActivityRows = [];
  const processedRowIdsByTable = new Map(tables.map((table) => [table, new Set()]));
  const linkedScheduleIdsToRefresh = new Set();
  const stats = {
    dryRun: Boolean(config.dryRun),
    insertedRows: 0,
    skippedRows: 0,
    tables: Object.fromEntries(tables.map((table) => [table, {
      table,
      idColumn: "",
      watermarkBefore: watermarkMap.get(table)?.lastId || 0,
      watermarkAfter: watermarkMap.get(table)?.lastId || 0,
      baselineInitialized: !watermarkMap.get(table)?.exists,
      pushed: 0,
      skipped: 0,
      status: "pending",
      notes: [],
      examples: [],
    }])),
  };

  const stateBefore = readState(config.stateFile);
  const nextState = {
    ...stateBefore,
    lastAttemptAt: toIsoNow(),
    lastDirection: "live_mysql_to_firebase",
    fullResyncAtByTable: {
      ...(stateBefore.fullResyncAtByTable || {}),
    },
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

  try {
    emit("info", "MySQL -> Firebase table scope loaded.", {
      tableCount: tables.length,
      tables,
      bootstrapTables: [...bootstrapTables],
      mutableTables: [...mutableTables],
    });
    for (const table of tables) {
      const tableStats = stats.tables[table];
      const columns = await describeTable(pool, table);
      if (!columns.length) {
        tableStats.status = "skipped_no_columns";
        tableStats.notes.push("no discoverable columns");
        emit("warn", `${table} has no discoverable columns. Table skipped.`);
        continue;
      }

      const idColumn = guessIdColumn(table, columns);
      if (!idColumn) {
        tableStats.status = "skipped_no_numeric_id";
        tableStats.notes.push("no numeric id column");
        emit("warn", `${table} has no numeric ID column. Table skipped.`);
        continue;
      }
      tableStats.idColumn = idColumn;

      const watermarkInfo = watermarkMap.get(table) || { exists: false, lastId: 0 };
      const fullResyncDue = shouldRunFullResyncForTable(table, stateBefore);
      if (!watermarkInfo.exists) {
        const maxId = await fetchMaxId(pool, table, idColumn);
        const bootstrapDateColumn = bootstrapTables.has(table) ? resolveBootstrapDateColumn(columns) : "";
        const bootstrapStartDateTime = bootstrapDateColumn ? buildBootstrapStartDateTime(config.bootstrapDays) : "";
        if (fullResyncDue && maxId > 0) {
          tableStats.status = "baseline_full_refresh";
          const fullRows = await fetchAllRowsForFullResync(pool, table, idColumn, config.batchSize);
          emit("info", `${table} watermark missing. Running manifest full refresh.`, {
            rowsFound: fullRows.length,
            maxId,
          });

          for (const row of fullRows) {
            const rowId = Number(row[idColumn] || 0) || 0;
            if (rowId <= 0) continue;

            const payload = sanitizeMysqlRecord(table, row);
            if (!config.dryRun) {
              pendingWrites.push(db.makeUpsertWrite(table, rowId, payload));
            }
            tableStats.pushed += 1;
            stats.insertedRows += 1;
            tableStats.watermarkAfter = Math.max(tableStats.watermarkAfter, rowId);

            if (tableStats.examples.length < 5) {
              const example = { id: rowId, fullRefresh: true };
              tableStats.examples.push(example);
              pendingActivityRows.push({
                table,
                id: rowId,
                meta: example,
              });
            }

            if (pendingWrites.length >= config.batchSize) {
              await flushWrites();
            }
          }

          await flushWrites();
          tableStats.watermarkAfter = maxId;
          if (!config.dryRun) {
            nextState.fullResyncAtByTable[table] = toIsoNow();
          }
        } else if (bootstrapDateColumn && maxId > 0) {
          tableStats.status = "baseline_bootstrap";
          const bootstrapRows = await fetchRowsForBootstrap(pool, table, idColumn, bootstrapDateColumn, bootstrapStartDateTime, config.batchSize);
          emit("info", `${table} watermark missing. Bootstrapping recent live MySQL rows.`, {
            dateColumn: bootstrapDateColumn,
            startDateTime: bootstrapStartDateTime,
            rowsFound: bootstrapRows.length,
            maxId,
          });

          for (const row of bootstrapRows) {
            const rowId = Number(row[idColumn] || 0) || 0;
            if (rowId <= 0) continue;

            const payload = sanitizeMysqlRecord(table, row);
            if (!config.dryRun) {
              pendingWrites.push(db.makeUpsertWrite(table, rowId, payload));
            }
            tableStats.pushed += 1;
            stats.insertedRows += 1;
            tableStats.watermarkAfter = Math.max(tableStats.watermarkAfter, rowId);

            if (tableStats.examples.length < 5) {
              const example = { id: rowId };
              if (payload.task_datetime !== undefined) example.task_datetime = payload.task_datetime;
              if (payload.schedule_id !== undefined) example.schedule_id = payload.schedule_id;
              tableStats.examples.push(example);
              pendingActivityRows.push({
                table,
                id: rowId,
                meta: example,
              });
            }

            if (pendingWrites.length >= config.batchSize) {
              await flushWrites();
            }
          }

          await flushWrites();
          tableStats.watermarkAfter = maxId;
        } else {
          tableStats.status = "empty_baseline";
          tableStats.watermarkAfter = maxId;
          tableStats.skipped = tableStats.watermarkAfter;
          stats.skippedRows += tableStats.watermarkAfter;
        }

        if (!config.dryRun) {
          await db.patchDoc(SYNC_STATE_COLLECTION, table, {
            table,
            id_column: idColumn,
            last_id: tableStats.watermarkAfter,
            updated_at: toIsoNow(),
            source: bootstrapDateColumn ? "live-mysql-sync-bootstrap" : "live-mysql-sync-baseline",
          });
        }
        emit("info", `${table} watermark initialized from live MySQL.`, {
          lastId: tableStats.watermarkAfter,
          idColumn,
          bootstrapDateColumn: bootstrapDateColumn || null,
        });
        emit("info", `${table} sync pass finished.`, {
          status: tableStats.status,
          pushed: tableStats.pushed,
          skipped: tableStats.skipped,
          watermarkBefore: tableStats.watermarkBefore,
          watermarkAfter: tableStats.watermarkAfter,
        });
        continue;
      }

      let currentWatermark = watermarkInfo.lastId || 0;
      const processedRowIds = processedRowIdsByTable.get(table) || new Set();
      while (true) {
        const rows = await fetchRowsAfter(pool, table, idColumn, currentWatermark, config.batchSize);
        if (!rows.length) break;

        for (const row of rows) {
          const rowId = Number(row[idColumn] || 0) || 0;
          if (rowId <= 0) {
            tableStats.skipped += 1;
            stats.skippedRows += 1;
            continue;
          }
          processedRowIds.add(rowId);

          const payload = sanitizeMysqlRecord(table, row);
          if (!config.dryRun) {
            pendingWrites.push(db.makeUpsertWrite(table, rowId, payload));
          }
          tableStats.watermarkAfter = rowId;
          currentWatermark = rowId;
          tableStats.pushed += 1;
          stats.insertedRows += 1;

          if (tableStats.examples.length < 5) {
            const example = { id: rowId };
            if (payload.task_datetime !== undefined) example.task_datetime = payload.task_datetime;
            if (payload.schedule_id !== undefined) example.schedule_id = payload.schedule_id;
            if (payload.branch_id !== undefined) example.branch_id = payload.branch_id;
            if (payload.serial !== undefined) example.serial = payload.serial;
            if (payload.time_in !== undefined) example.time_in = payload.time_in;
            if (payload.time_out !== undefined) example.time_out = payload.time_out;
            tableStats.examples.push(example);
            emit("info", `${table} row ${rowId} found in live MySQL.`, example);
            pendingActivityRows.push({
              table,
              id: rowId,
              meta: example,
            });
          }

          if ((table === "tbl_printedscheds" || table === "tbl_savedscheds") && Number(payload.schedule_id || 0) > 0) {
            linkedScheduleIdsToRefresh.add(Number(payload.schedule_id || 0));
          }

          if (pendingWrites.length >= config.batchSize) {
            await flushWrites();
          }
        }
      }

      await flushWrites();

      if (fullResyncDue) {
        const fullRows = await fetchAllRowsForFullResync(pool, table, idColumn, config.batchSize);
        let fullRefreshCount = 0;

        for (const row of fullRows) {
          const rowId = Number(row[idColumn] || 0) || 0;
          if (rowId <= 0 || processedRowIds.has(rowId)) continue;

          const payload = sanitizeMysqlRecord(table, row);
          if (!config.dryRun) {
            pendingWrites.push(db.makeUpsertWrite(table, rowId, payload));
          }
          processedRowIds.add(rowId);
          fullRefreshCount += 1;
          tableStats.pushed += 1;
          stats.insertedRows += 1;

          if (tableStats.examples.length < 5) {
            const example = { id: rowId, fullRefresh: true };
            tableStats.examples.push(example);
          }

          if (pendingWrites.length >= config.batchSize) {
            await flushWrites();
          }
        }

        await flushWrites();
        if (!config.dryRun) {
          nextState.fullResyncAtByTable[table] = toIsoNow();
        }

        if (fullRefreshCount > 0) {
          tableStats.status = "synced_full_refresh";
          emit("info", `${table} full refresh applied from manifest.`, {
            refreshedRows: fullRefreshCount,
          });
        }
      }

      const mutableDateColumn = mutableTables.has(table) ? resolveManifestMutableDateColumn(table, columns) : "";
      if (mutableDateColumn) {
        const mutableStartDateTime = buildMutableLookbackDateTime(config.mutableLookbackHours);
        const mutableRows = await fetchRowsForMutableScan(pool, table, idColumn, mutableDateColumn, mutableStartDateTime, config.batchSize);
        let mutableRefreshCount = 0;

        for (const row of mutableRows) {
          const rowId = Number(row[idColumn] || 0) || 0;
          if (rowId <= 0 || processedRowIds.has(rowId)) continue;

          const payload = sanitizeMysqlRecord(table, row);
          if (!config.dryRun) {
            pendingWrites.push(db.makeUpsertWrite(table, rowId, payload));
          }
          processedRowIds.add(rowId);
          mutableRefreshCount += 1;
          tableStats.pushed += 1;
          stats.insertedRows += 1;

          if (tableStats.examples.length < 5) {
            const example = { id: rowId, mutableRefresh: true };
            if (payload.schedule_id !== undefined) example.schedule_id = payload.schedule_id;
            if (payload.task_datetime !== undefined) example.task_datetime = payload.task_datetime;
            tableStats.examples.push(example);
          }

          if ((table === "tbl_printedscheds" || table === "tbl_savedscheds") && Number(payload.schedule_id || 0) > 0) {
            linkedScheduleIdsToRefresh.add(Number(payload.schedule_id || 0));
          }

          if (pendingWrites.length >= config.batchSize) {
            await flushWrites();
          }
        }

        await flushWrites();

        if (mutableRefreshCount > 0) {
          tableStats.status = "synced_mutable_refresh";
          emit("info", `${table} mutable refresh applied.`, {
            dateColumn: mutableDateColumn,
            startDateTime: mutableStartDateTime,
            refreshedRows: mutableRefreshCount,
          });
        }
      }

      if (!tableStats.status || tableStats.status === "pending") {
        tableStats.status = tableStats.pushed > 0 ? "synced_incremental" : "no_changes";
      }

      if (!config.dryRun && tableStats.watermarkAfter > tableStats.watermarkBefore) {
        await db.patchDoc(SYNC_STATE_COLLECTION, table, {
          table,
          id_column: idColumn,
          last_id: tableStats.watermarkAfter,
          updated_at: toIsoNow(),
          source: "live-mysql-sync",
        });
        emit("success", `${table} watermark updated.`, {
          before: tableStats.watermarkBefore,
          after: tableStats.watermarkAfter,
        });
      }

      emit("info", `${table} sync pass finished.`, {
        status: tableStats.status,
        pushed: tableStats.pushed,
        skipped: tableStats.skipped,
        watermarkBefore: tableStats.watermarkBefore,
        watermarkAfter: tableStats.watermarkAfter,
      });
    }

    if (linkedScheduleIdsToRefresh.size && tables.includes("tbl_schedule")) {
      const scheduleStats = stats.tables.tbl_schedule;
      const scheduleColumns = await describeTable(pool, "tbl_schedule");
      const scheduleIdColumn = guessIdColumn("tbl_schedule", scheduleColumns);
      const scheduleRows = await fetchRowsByIds(pool, "tbl_schedule", scheduleIdColumn, [...linkedScheduleIdsToRefresh]);

      for (const row of scheduleRows) {
        const rowId = Number(row[scheduleIdColumn] || 0) || 0;
        if (rowId <= 0) continue;
        const payload = sanitizeMysqlRecord("tbl_schedule", row);
        if (!config.dryRun) {
          pendingWrites.push(db.makeUpsertWrite("tbl_schedule", rowId, payload));
        }
        scheduleStats.pushed += 1;
        stats.insertedRows += 1;
        if (pendingWrites.length >= config.batchSize) {
          await flushWrites();
        }
      }

      await flushWrites();
      emit("info", "Linked tbl_schedule rows refreshed from route updates.", {
        rows: scheduleRows.length,
      });
    }
  } finally {
    await pool.end();
  }

  const report = summarizeReport(stats, reportPath);
  ensureDir(config.outDir);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  writeState(config.stateFile, {
    ...nextState,
    lastSuccessAt: toIsoNow(),
    lastErrorAt: null,
    lastErrorMessage: null,
    lastSummary: report.summary,
    lastBaselineMode: "live",
    lastApplyMode: !config.dryRun,
    lastOutputs: {
      reportPath,
    },
    lastApplied: null,
    lastDumpSyncTables: tables,
  });

  emit("success", "Live MySQL sync completed.", report.summary);
  return report;
}

export async function main() {
  const cli = parseArgs(process.argv);
  const config = loadLiveMysqlSyncConfig(cli);
  const report = await runLiveMysqlToFirebase(config, {
    onActivity(level, message, meta) {
      console.log(`[${level}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
    },
  });
  console.log(JSON.stringify(report.summary, null, 2));
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}
