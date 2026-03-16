#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMysqlPool,
  loadEnvFile,
  resolveMaybeRelative,
} from "./run-local-sync.mjs";
import {
  createWritableFirestoreClient,
  parseFirebaseConfig,
} from "./run-dump-to-firebase.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROUTE_TABLES = ["tbl_printedscheds", "tbl_savedscheds"];

function toIsoNow() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const config = {
    date: "",
    firebaseConfigPath: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];

    if (token === "--date") {
      config.date = String(next || "").trim();
      index += 1;
      continue;
    }

    if (token === "--firebase-config") {
      config.firebaseConfigPath = next ? path.resolve(next) : null;
      index += 1;
      continue;
    }
  }

  if (!config.date || !/^\d{4}-\d{2}-\d{2}$/.test(config.date)) {
    throw new Error("Provide --date YYYY-MM-DD");
  }

  return config;
}

function createRuntimeConfig(argv) {
  const cli = parseArgs(argv);
  const env = loadEnvFile(path.join(__dirname, ".env"));

  return {
    date: cli.date,
    firebaseConfigPath: resolveMaybeRelative(__dirname, cli.firebaseConfigPath, env.FIREBASE_CONFIG_PATH || "../shared/js/firebase-config.js"),
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    serviceAccountPrivateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "",
    mysql: {
      host: env.MYSQL_HOST || "",
      port: Number(env.MYSQL_PORT || 3306),
      user: env.MYSQL_USER || "",
      password: env.MYSQL_PASSWORD || "",
      database: env.MYSQL_DATABASE || "",
    },
  };
}

function chunk(values, size = 200) {
  const out = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

async function fetchRouteRowsByDate(pool, table, date) {
  const [rows] = await pool.query(
    `SELECT * FROM \`${table}\` WHERE DATE(\`task_datetime\`) = ? ORDER BY \`task_datetime\` ASC, \`id\` ASC`,
    [date],
  );
  return Array.isArray(rows) ? rows : [];
}

async function fetchScheduleRowsByIds(pool, ids) {
  if (!ids.length) return [];
  const results = [];

  for (const batch of chunk(ids, 200)) {
    const placeholders = batch.map(() => "?").join(", ");
    const [rows] = await pool.execute(
      `SELECT * FROM \`tbl_schedule\` WHERE \`id\` IN (${placeholders}) ORDER BY \`id\` ASC`,
      batch,
    );
    results.push(...(Array.isArray(rows) ? rows : []));
  }

  return results;
}

async function main() {
  const config = createRuntimeConfig(process.argv);
  const pool = await createMysqlPool(config.mysql);
  const db = createWritableFirestoreClient({
    ...parseFirebaseConfig(config.firebaseConfigPath),
    serviceAccountEmail: config.serviceAccountEmail,
    serviceAccountPrivateKey: config.serviceAccountPrivateKey,
  });

  try {
    const writes = [];
    const routeRowsByTable = new Map();

    for (const table of ROUTE_TABLES) {
      const rows = await fetchRouteRowsByDate(pool, table, config.date);
      routeRowsByTable.set(table, rows);
      rows.forEach((row) => {
        writes.push(db.makeUpsertWrite(table, row.id, {
          ...row,
          bridge_source: "route-day-backfill",
          bridge_pushed_at: toIsoNow(),
        }));
      });
    }

    const scheduleIds = [...new Set(
      [...routeRowsByTable.values()]
        .flat()
        .map((row) => Number(row.schedule_id || 0))
        .filter((id) => id > 0),
    )];

    const scheduleRows = await fetchScheduleRowsByIds(pool, scheduleIds);
    scheduleRows.forEach((row) => {
      writes.push(db.makeUpsertWrite("tbl_schedule", row.id, {
        ...row,
        bridge_source: "route-day-backfill",
        bridge_pushed_at: toIsoNow(),
      }));
    });

    for (const batch of chunk(writes, 200)) {
      await db.commitWrites(batch);
    }

    console.log(JSON.stringify({
      date: config.date,
      printedRows: routeRowsByTable.get("tbl_printedscheds")?.length || 0,
      savedRows: routeRowsByTable.get("tbl_savedscheds")?.length || 0,
      scheduleRows: scheduleRows.length,
      writes: writes.length,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
