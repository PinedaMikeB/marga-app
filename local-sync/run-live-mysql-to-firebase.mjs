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
import { ensureDir } from "../tools/build-hybrid-bridge.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYNC_STATE_COLLECTION = "sys_sync_state";
const DEFAULT_TABLES = ["tbl_schedule", "tbl_schedtime", "tbl_closedscheds"];
const DEFAULT_BATCH_SIZE = 250;
const TABLE_ID_HINTS = {
  tbl_schedule: "id",
  tbl_schedtime: "id",
  tbl_closedscheds: "id",
  tbl_billinfo: "id",
  tbl_billout: "id",
  tbl_billoutparticular: "id",
  tbl_billoutparticulars: "id",
  tbl_billing: "id",
  tbl_collection: "id",
  tbl_collectiondetails: "id",
  tbl_paymentinfo: "id",
  tbl_or: "id",
  tbl_check: "id",
};

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

function parseArgs(argv) {
  const args = argv.slice(2);
  const config = {
    firebaseConfigPath: null,
    outDir: null,
    stateFile: null,
    tables: null,
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
  const tables = overrides.tables?.length
    ? overrides.tables
    : parseTableList(env.MYSQL_TO_FIREBASE_TABLES) || DEFAULT_TABLES;

  return {
    firebaseConfigPath: resolveMaybeRelative(__dirname, overrides.firebaseConfigPath, env.FIREBASE_CONFIG_PATH || paths.firebaseConfigPath),
    outDir: resolveMaybeRelative(__dirname, overrides.outDir, env.OUT_DIR || paths.outDir),
    stateFile: resolveMaybeRelative(__dirname, overrides.stateFile, env.STATE_FILE || paths.stateFile),
    serviceAccountEmail: overrides.serviceAccountEmail || env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    serviceAccountPrivateKey: overrides.serviceAccountPrivateKey || env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "",
    tables: tables.length ? tables : DEFAULT_TABLES,
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
  if (table === "tbl_schedule" || table === "tbl_schedtime" || table === "tbl_closedscheds") {
    out.bridge_source = "live_mysql";
    out.bridge_pushed_at = toIsoNow();
  }
  return out;
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

function summarizeReport(stats, reportPath) {
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
      schedtimePushed: stats.tables.tbl_schedtime?.pushed || 0,
      closedschedPushed: stats.tables.tbl_closedscheds?.pushed || 0,
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
  const watermarkMap = await getWatermarkMap(db, tables);
  const pendingWrites = [];
  const pendingActivityRows = [];
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
      examples: [],
    }])),
  };

  const stateBefore = readState(config.stateFile);
  const nextState = {
    ...stateBefore,
    lastAttemptAt: toIsoNow(),
    lastDirection: "live_mysql_to_firebase",
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
    for (const table of tables) {
      const tableStats = stats.tables[table];
      const columns = await describeTable(pool, table);
      if (!columns.length) {
        emit("warn", `${table} has no discoverable columns. Table skipped.`);
        continue;
      }

      const idColumn = guessIdColumn(table, columns);
      if (!idColumn) {
        emit("warn", `${table} has no numeric ID column. Table skipped.`);
        continue;
      }
      tableStats.idColumn = idColumn;

      const watermarkInfo = watermarkMap.get(table) || { exists: false, lastId: 0 };
      if (!watermarkInfo.exists) {
        tableStats.watermarkAfter = await fetchMaxId(pool, table, idColumn);
        tableStats.skipped = tableStats.watermarkAfter;
        stats.skippedRows += tableStats.watermarkAfter;
        if (!config.dryRun) {
          await db.patchDoc(SYNC_STATE_COLLECTION, table, {
            table,
            id_column: idColumn,
            last_id: tableStats.watermarkAfter,
            updated_at: toIsoNow(),
            source: "live-mysql-sync-baseline",
          });
        }
        emit("info", `${table} baseline initialized from live MySQL.`, {
          lastId: tableStats.watermarkAfter,
          idColumn,
        });
        continue;
      }

      let currentWatermark = watermarkInfo.lastId || 0;
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

          if (pendingWrites.length >= config.batchSize) {
            await flushWrites();
          }
        }
      }

      await flushWrites();

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
