#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  createSqlStatementParser,
  createWritableFirestoreClient,
  loadDumpSyncConfig,
  parseCreateTableStatement,
  parseFirebaseConfig,
  parseInsertStatement,
  parseValueTuples,
  rowIdFromRecord,
  toRecord,
} from "./run-dump-to-firebase.mjs";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node compare-dump-to-firebase.mjs [--dump <dump.sql>] [--out <report.json>]",
      "",
      "Optional flags:",
      "  --tables <comma,separated,list>",
      "  --sample-size <n>",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const cfg = {
    dumpPath: null,
    outPath: null,
    tables: null,
    sampleSize: 20,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];

    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    if (token === "--dump") {
      cfg.dumpPath = next ? path.resolve(next) : null;
      index += 1;
      continue;
    }
    if (token === "--out") {
      cfg.outPath = next ? path.resolve(next) : null;
      index += 1;
      continue;
    }
    if (token === "--tables") {
      cfg.tables = next
        ? next.split(",").map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : null;
      index += 1;
      continue;
    }
    if (token === "--sample-size") {
      cfg.sampleSize = Number(next || 20) || 20;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return cfg;
}

function buildRuntimeConfig(argv) {
  const cli = parseArgs(argv);
  const base = loadDumpSyncConfig(cli.dumpPath ? { dumpPath: cli.dumpPath } : {});
  return {
    dumpPath: cli.dumpPath || base.dumpPath,
    outPath: cli.outPath || path.join(base.outDir, "dump-vs-firebase-report.json"),
    tables: cli.tables,
    sampleSize: cli.sampleSize,
    firebaseConfigPath: base.firebaseConfigPath,
    serviceAccountEmail: base.serviceAccountEmail,
    serviceAccountPrivateKey: base.serviceAccountPrivateKey,
  };
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function addSample(target, value, sampleSize) {
  if (target.length >= sampleSize) return;
  target.push(value);
}

async function collectDumpIds(config) {
  const schemas = new Map();
  const tables = new Map();
  const requested = config.tables ? new Set(config.tables) : null;
  const stream = fs.createReadStream(config.dumpPath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  const parser = createSqlStatementParser(async (statement) => {
    const createInfo = parseCreateTableStatement(statement);
    if (createInfo) {
      schemas.set(createInfo.table, createInfo.columns);
      return;
    }

    const insertInfo = parseInsertStatement(statement);
    if (!insertInfo) return;
    if (requested && !requested.has(insertInfo.table)) return;

    const columns = insertInfo.columns && insertInfo.columns.length
      ? insertInfo.columns
      : schemas.get(insertInfo.table);
    if (!columns?.length) return;

    const tuples = parseValueTuples(insertInfo.valuesPart);
    for (const tuple of tuples) {
      const record = toRecord(columns, tuple);
      const rowId = rowIdFromRecord(insertInfo.table, record, columns);
      if (!Number.isFinite(rowId) || rowId <= 0) continue;

      if (!tables.has(insertInfo.table)) {
        tables.set(insertInfo.table, {
          dumpIds: new Set(),
          dumpRowCount: 0,
          maxDumpId: 0,
        });
      }

      const entry = tables.get(insertInfo.table);
      entry.dumpIds.add(rowId);
      entry.dumpRowCount += 1;
      entry.maxDumpId = Math.max(entry.maxDumpId, rowId);
    }
  });

  let bytes = 0;
  let lastLog = Date.now();
  const size = fs.statSync(config.dumpPath).size;

  for await (const chunk of stream) {
    bytes += Buffer.byteLength(chunk, "utf8");
    await parser.consumeChunk(chunk, { final: false });
    const now = Date.now();
    if (now - lastLog > 5000) {
      process.stdout.write(`Scanning dump: ${((bytes / size) * 100).toFixed(1)}%\r`);
      lastLog = now;
    }
  }
  await parser.consumeChunk("", { final: true });
  process.stdout.write("\n");

  return tables;
}

async function collectFirebaseIds(db, table) {
  const ids = new Set();
  let pageToken = "";
  let page = 0;

  do {
    page += 1;
    const result = await db.listDocuments(table, 1000, pageToken);
    result.documents.forEach((doc) => {
      const rawId = Number(doc?._docId || 0);
      if (Number.isFinite(rawId) && rawId > 0) {
        ids.add(rawId);
      }
    });
    pageToken = result.nextPageToken || "";
  } while (pageToken);

  return ids;
}

function compareTable(table, dumpEntry, firebaseIds, sampleSize) {
  const missingInFirebaseSamples = [];
  const extraInFirebaseSamples = [];
  let missingInFirebaseCount = 0;
  let extraInFirebaseCount = 0;

  dumpEntry.dumpIds.forEach((id) => {
    if (!firebaseIds.has(id)) {
      missingInFirebaseCount += 1;
      addSample(missingInFirebaseSamples, id, sampleSize);
    }
  });

  firebaseIds.forEach((id) => {
    if (!dumpEntry.dumpIds.has(id)) {
      extraInFirebaseCount += 1;
      addSample(extraInFirebaseSamples, id, sampleSize);
    }
  });

  return {
    table,
    dumpRowCount: dumpEntry.dumpRowCount,
    dumpDistinctIds: dumpEntry.dumpIds.size,
    firebaseDistinctIds: firebaseIds.size,
    maxDumpId: dumpEntry.maxDumpId,
    missingInFirebaseCount,
    missingInFirebaseSamples,
    extraInFirebaseCount,
    extraInFirebaseSamples,
  };
}

async function main() {
  const config = buildRuntimeConfig(process.argv);
  if (!config.dumpPath) {
    throw new Error("No dump path provided.");
  }

  console.log(`Reading dump IDs from ${config.dumpPath}`);
  const dumpTables = await collectDumpIds(config);
  const tableNames = [...dumpTables.keys()].sort();

  console.log(`Collected numeric IDs for ${tableNames.length} table(s).`);
  const db = createWritableFirestoreClient({
    ...parseFirebaseConfig(config.firebaseConfigPath),
    serviceAccountEmail: config.serviceAccountEmail || "",
    serviceAccountPrivateKey: config.serviceAccountPrivateKey || "",
  });

  const tables = [];
  for (let index = 0; index < tableNames.length; index += 1) {
    const table = tableNames[index];
    console.log(`[${index + 1}/${tableNames.length}] Comparing ${table}...`);
    const firebaseIds = await collectFirebaseIds(db, table);
    tables.push(compareTable(table, dumpTables.get(table), firebaseIds, config.sampleSize));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dumpPath: config.dumpPath,
    comparedTables: tables.length,
    summary: {
      tablesWithMissingFirebaseRows: tables.filter((table) => table.missingInFirebaseCount > 0).length,
      tablesWithExtraFirebaseRows: tables.filter((table) => table.extraInFirebaseCount > 0).length,
      totalMissingFirebaseRows: tables.reduce((sum, table) => sum + table.missingInFirebaseCount, 0),
      totalExtraFirebaseRows: tables.reduce((sum, table) => sum + table.extraInFirebaseCount, 0),
    },
    tables,
  };

  ensureParent(config.outPath);
  fs.writeFileSync(config.outPath, JSON.stringify(report, null, 2));

  console.log(`Report written to ${config.outPath}`);
  console.log(`- Tables with missing Firebase rows: ${report.summary.tablesWithMissingFirebaseRows}`);
  console.log(`- Total missing Firebase rows: ${report.summary.totalMissingFirebaseRows}`);
  console.log(`- Tables with extra Firebase rows: ${report.summary.tablesWithExtraFirebaseRows}`);
  console.log(`- Total extra Firebase rows: ${report.summary.totalExtraFirebaseRows}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
