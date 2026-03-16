#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  createSqlStatementParser,
  createWritableFirestoreClient,
  parseCreateTableStatement,
  parseFirebaseConfig,
  parseInsertStatement,
  parseValueTuples,
  rowIdFromRecord,
  toRecord,
} from "./run-dump-to-firebase.mjs";
import { ensureDir } from "../tools/build-hybrid-bridge.mjs";
import { loadDumpSyncConfig } from "./run-dump-to-firebase.mjs";

const CHUNK_SIZE_BYTES = 1024 * 1024;
const WRITE_BATCH_LIMIT = 250;
const ERROR_SAMPLE_LIMIT = 20;

function parseArgs(argv) {
  const args = argv.slice(2);
  const config = {
    dumpPath: null,
    outDir: null,
    progressPath: null,
    reportPath: null,
    shardIndex: 0,
    shardCount: 1,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];
    if (token === "--dump") {
      config.dumpPath = next ? path.resolve(next) : null;
      index += 1;
      continue;
    }
    if (token === "--out-dir") {
      config.outDir = next ? path.resolve(next) : null;
      index += 1;
      continue;
    }
    if (token === "--progress") {
      config.progressPath = next ? path.resolve(next) : null;
      index += 1;
      continue;
    }
    if (token === "--report") {
      config.reportPath = next ? path.resolve(next) : null;
      index += 1;
      continue;
    }
    if (token === "--shard-index") {
      config.shardIndex = next ? Number(next) : 0;
      index += 1;
      continue;
    }
    if (token === "--shard-count") {
      config.shardCount = next ? Number(next) : 1;
      index += 1;
      continue;
    }
  }

  return config;
}

function buildConfig(argv) {
  const cli = parseArgs(argv);
  const base = loadDumpSyncConfig(cli.dumpPath ? { dumpPath: cli.dumpPath, outDir: cli.outDir } : {});
  const outDir = cli.outDir || base.outDir;
  const shardCount = Number.isFinite(cli.shardCount) && cli.shardCount > 0 ? Math.floor(cli.shardCount) : 1;
  const shardIndex = Number.isFinite(cli.shardIndex) && cli.shardIndex >= 0 ? Math.floor(cli.shardIndex) : 0;
  const shardSuffix = shardCount > 1 ? `-shard-${shardIndex + 1}-of-${shardCount}` : "";
  return {
    dumpPath: cli.dumpPath || base.dumpPath,
    firebaseConfigPath: base.firebaseConfigPath,
    serviceAccountEmail: base.serviceAccountEmail,
    serviceAccountPrivateKey: base.serviceAccountPrivateKey,
    outDir,
    progressPath: cli.progressPath || path.join(outDir, `full-mirror-progress${shardSuffix}.json`),
    reportPath: cli.reportPath || path.join(outDir, `full-mirror-report${shardSuffix}.json`),
    checkpointPath: path.join(outDir, `full-mirror-checkpoint${shardSuffix}.json`),
    shardIndex,
    shardCount,
  };
}

function safeWriteJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function createProgressState(config) {
  return {
    pid: process.pid,
    active: true,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: "Preparing full mirror run",
    dumpPath: config.dumpPath,
    reportPath: config.reportPath,
    shard: {
      index: config.shardIndex,
      count: config.shardCount,
      label: `${config.shardIndex + 1}/${config.shardCount}`,
    },
    progress: {
      percent: 0,
      bytesProcessed: 0,
      fileSize: 0,
      currentTable: "",
      rowsQueued: 0,
      rowsCommitted: 0,
      rowsSkippedNoId: 0,
      rowsSkippedResume: 0,
      rowsFailed: 0,
      tablesSeen: 0,
      batchCommits: 0,
    },
    recentTables: [],
    resume: {
      resumed: false,
      checkpointPath: config.checkpointPath,
      restoredAt: null,
    },
    errors: [],
  };
}

function addRecentTable(state, table) {
  if (!table) return;
  if (state.recentTables[0] === table) return;
  state.recentTables.unshift(table);
  state.recentTables = state.recentTables.slice(0, 12);
}

function updateProgressFile(config, state) {
  safeWriteJson(config.progressPath, state);
}

function safeReadJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function mapToObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function objectToMap(value) {
  return new Map(Object.entries(value || {}).map(([key, raw]) => [key, Number(raw || 0)]));
}

function appendError(state, context) {
  state.errors.unshift({
    at: new Date().toISOString(),
    ...context,
  });
  state.errors = state.errors.slice(0, ERROR_SAMPLE_LIMIT);
}

function buildCheckpoint(config, state, rowOrdinals) {
  return {
    savedAt: new Date().toISOString(),
    dumpPath: config.dumpPath,
    progressPath: config.progressPath,
    reportPath: config.reportPath,
    checkpointPath: config.checkpointPath,
    shard: {
      index: config.shardIndex,
      count: config.shardCount,
    },
    rowOrdinals: mapToObject(rowOrdinals),
    progress: {
      bytesProcessed: state.progress.bytesProcessed,
      fileSize: state.progress.fileSize,
      percent: state.progress.percent,
      currentTable: state.progress.currentTable,
      rowsQueued: state.progress.rowsQueued,
      rowsCommitted: state.progress.rowsCommitted,
      rowsSkippedNoId: state.progress.rowsSkippedNoId,
      rowsSkippedResume: state.progress.rowsSkippedResume,
      rowsFailed: state.progress.rowsFailed,
      tablesSeen: state.progress.tablesSeen,
      batchCommits: state.progress.batchCommits,
    },
    recentTables: [...state.recentTables],
    errors: [...state.errors],
  };
}

function loadCheckpoint(config) {
  const checkpoint = safeReadJson(config.checkpointPath);
  if (!checkpoint) return null;
  if (path.resolve(checkpoint.dumpPath || "") !== path.resolve(config.dumpPath || "")) {
    return null;
  }
  if (
    Number(checkpoint?.shard?.index ?? 0) !== config.shardIndex
    || Number(checkpoint?.shard?.count ?? 1) !== config.shardCount
  ) {
    return null;
  }
  return checkpoint;
}

function saveCheckpoint(config, state, rowOrdinals) {
  safeWriteJson(config.checkpointPath, buildCheckpoint(config, state, rowOrdinals));
}

function removeCheckpoint(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  fs.unlinkSync(filePath);
}

function normalizeFirestoreValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function hashTableName(table) {
  return [...String(table || "")].reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 7);
}

function tableBelongsToShard(table, shardIndex, shardCount) {
  if (shardCount <= 1) return true;
  return (hashTableName(table) % shardCount) === shardIndex;
}

function buildDocId(table, record, columns, rowOrdinal) {
  const numericId = rowIdFromRecord(table, record, columns);
  if (Number.isFinite(numericId) && numericId > 0) {
    return { docId: String(numericId), keyType: "numeric" };
  }

  return {
    docId: `row_${String(rowOrdinal).padStart(10, "0")}`,
    keyType: "ordinal",
  };
}

function buildPayload(record, rowOrdinal, keyType) {
  return {
    ...record,
    _mirror_row_ordinal: rowOrdinal,
    _mirror_key_type: keyType,
    _mirrored_at: new Date().toISOString(),
  };
}

async function runFullMirror(config) {
  if (!config.dumpPath || !fs.existsSync(config.dumpPath)) {
    throw new Error("Full mirror needs a valid dump path.");
  }
  if (config.shardIndex >= config.shardCount) {
    throw new Error("Shard index must be less than shard count.");
  }

  const db = createWritableFirestoreClient({
    ...parseFirebaseConfig(config.firebaseConfigPath),
    serviceAccountEmail: config.serviceAccountEmail || "",
    serviceAccountPrivateKey: config.serviceAccountPrivateKey || "",
  });

  const fileSize = fs.statSync(config.dumpPath).size;
  const state = createProgressState(config);
  state.progress.fileSize = fileSize;
  const tableSchemas = new Map();
  const tableStats = new Map();
  const resumeOrdinals = new Map();
  const rowOrdinals = new Map();
  const checkpoint = loadCheckpoint(config);
  if (checkpoint) {
    const restoredOrdinals = objectToMap(checkpoint.rowOrdinals);
    restoredOrdinals.forEach((value, key) => {
      resumeOrdinals.set(key, value);
    });
    state.progress.bytesProcessed = Number(checkpoint.progress?.bytesProcessed || 0);
    state.progress.percent = Number(checkpoint.progress?.percent || 0);
    state.progress.rowsQueued = Number(checkpoint.progress?.rowsQueued || 0);
    state.progress.rowsCommitted = Number(checkpoint.progress?.rowsCommitted || 0);
    state.progress.rowsSkippedNoId = Number(checkpoint.progress?.rowsSkippedNoId || 0);
    state.progress.rowsSkippedResume = Number(checkpoint.progress?.rowsSkippedResume || 0);
    state.progress.rowsFailed = Number(checkpoint.progress?.rowsFailed || 0);
    state.progress.tablesSeen = Number(checkpoint.progress?.tablesSeen || 0);
    state.progress.batchCommits = Number(checkpoint.progress?.batchCommits || 0);
    state.progress.currentTable = String(checkpoint.progress?.currentTable || "");
    state.recentTables = Array.isArray(checkpoint.recentTables) ? checkpoint.recentTables.slice(0, 12) : [];
    state.errors = Array.isArray(checkpoint.errors) ? checkpoint.errors.slice(0, ERROR_SAMPLE_LIMIT) : [];
    state.resume = {
      resumed: true,
      checkpointPath: config.checkpointPath,
      restoredAt: new Date().toISOString(),
    };
    state.message = `Resuming from checkpoint with ${state.progress.rowsCommitted.toLocaleString()} committed rows.`;
  }
  updateProgressFile(config, state);

  let pendingWrites = [];

  function ensureTable(table) {
    if (!tableStats.has(table)) {
      tableStats.set(table, {
        table,
        rowsSeen: 0,
        rowsMirrored: 0,
        rowsSkippedNoId: 0,
        rowsSkippedResume: 0,
        rowsFailed: 0,
        numericIdRows: 0,
        ordinalKeyRows: 0,
        sampleDocIds: [],
      });
      state.progress.tablesSeen = tableStats.size;
    }
    return tableStats.get(table);
  }

  async function flushWrites(forceMessage = "") {
    if (!pendingWrites.length) return;
    const batchEntries = pendingWrites;
    pendingWrites = [];
    const batchSize = batchEntries.length;
    const writes = batchEntries.map((entry) => entry.write);

    try {
      await db.commitWrites(writes);
      state.progress.rowsCommitted += batchSize;
      state.progress.batchCommits += 1;
    } catch (error) {
      appendError(state, {
        scope: "batch",
        table: state.progress.currentTable,
        message: error.message || String(error),
        batchSize,
      });

      for (const entry of batchEntries) {
        try {
          await db.commitWrites([entry.write]);
          state.progress.rowsCommitted += 1;
          state.progress.batchCommits += 1;
        } catch (singleError) {
          state.progress.rowsFailed += 1;
          const stats = ensureTable(entry.table);
          stats.rowsFailed += 1;
          appendError(state, {
            scope: "row",
            table: entry.table,
            docId: entry.docId,
            rowOrdinal: entry.rowOrdinal,
            message: singleError.message || String(singleError),
          });
        }
      }
    }

    saveCheckpoint(config, state, rowOrdinals);
    state.message = forceMessage || `Committed ${state.progress.rowsCommitted.toLocaleString()} rows to Firebase`;
    updateProgressFile(config, state);
  }

  const parser = createSqlStatementParser(async (statement) => {
    const createInfo = parseCreateTableStatement(statement);
    if (createInfo) {
      tableSchemas.set(createInfo.table, createInfo.columns);
      if (tableBelongsToShard(createInfo.table, config.shardIndex, config.shardCount)) {
        ensureTable(createInfo.table);
      }
      return;
    }

    const insertInfo = parseInsertStatement(statement);
    if (!insertInfo) return;

    const columns = insertInfo.columns && insertInfo.columns.length
      ? insertInfo.columns
      : tableSchemas.get(insertInfo.table);
    if (!columns?.length) return;
    if (!tableBelongsToShard(insertInfo.table, config.shardIndex, config.shardCount)) return;

    const tuples = parseValueTuples(insertInfo.valuesPart);
    const stats = ensureTable(insertInfo.table);
    state.progress.currentTable = insertInfo.table;
    addRecentTable(state, insertInfo.table);

    for (const tuple of tuples) {
      const previousOrdinal = rowOrdinals.get(insertInfo.table) || 0;
      const rowOrdinal = previousOrdinal + 1;
      rowOrdinals.set(insertInfo.table, rowOrdinal);

      const record = toRecord(columns, tuple);
      const { docId, keyType } = buildDocId(insertInfo.table, record, columns, rowOrdinal);
      const payload = buildPayload(record, rowOrdinal, keyType);

      stats.rowsSeen += 1;
      const resumeCheckpointOrdinal = resumeOrdinals.get(insertInfo.table) || 0;
      if (rowOrdinal <= resumeCheckpointOrdinal) {
        stats.rowsSkippedResume += 1;
        state.progress.rowsSkippedResume += 1;
        continue;
      }
      if (keyType === "numeric") {
        stats.numericIdRows += 1;
      } else {
        stats.ordinalKeyRows += 1;
      }
      stats.rowsMirrored += 1;
      if (stats.sampleDocIds.length < 5) stats.sampleDocIds.push(docId);

      pendingWrites.push({
        table: insertInfo.table,
        docId,
        rowOrdinal,
        write: db.makeUpsertWrite(insertInfo.table, docId, payload),
      });
      state.progress.rowsQueued += 1;

      if (pendingWrites.length >= WRITE_BATCH_LIMIT) {
        await flushWrites();
      }
    }

    state.message = `Mirroring ${insertInfo.table} (${stats.rowsMirrored.toLocaleString()} rows queued)`;
  });

  const stream = fs.createReadStream(config.dumpPath, { encoding: "utf8", highWaterMark: CHUNK_SIZE_BYTES });
  let bytesProcessed = 0;

  for await (const chunk of stream) {
    bytesProcessed += Buffer.byteLength(chunk, "utf8");
    state.progress.bytesProcessed = bytesProcessed;
    state.progress.percent = Number(((bytesProcessed / fileSize) * 100).toFixed(2));
    updateProgressFile(config, state);
    await parser.consumeChunk(chunk, { final: false });
  }

  await parser.consumeChunk("", { final: true });
  await flushWrites("Finalizing full mirror report");

  const report = {
    generatedAt: new Date().toISOString(),
    dumpPath: config.dumpPath,
    shard: {
      index: config.shardIndex,
      count: config.shardCount,
      label: `${config.shardIndex + 1}/${config.shardCount}`,
    },
    summary: {
      tablesMirrored: tableStats.size,
      rowsQueued: state.progress.rowsQueued,
      rowsCommitted: state.progress.rowsCommitted,
      rowsSkippedNoId: state.progress.rowsSkippedNoId,
      batchCommits: state.progress.batchCommits,
    },
    tables: [...tableStats.values()].sort((a, b) => a.table.localeCompare(b.table)),
  };

  safeWriteJson(config.reportPath, report);
  removeCheckpoint(config.checkpointPath);

  state.active = false;
  state.status = "completed";
  state.finishedAt = new Date().toISOString();
  state.message = `Full mirror completed. ${state.progress.rowsCommitted.toLocaleString()} rows committed.`;
  state.progress.percent = 100;
  updateProgressFile(config, state);

  return report;
}

async function main() {
  const config = buildConfig(process.argv);
  try {
    await runFullMirror(config);
  } catch (error) {
    const fallbackConfig = buildConfig(process.argv);
    const previousState = safeReadJson(fallbackConfig.progressPath);
    const state = previousState || createProgressState(fallbackConfig);
    state.active = false;
    state.status = "error";
    state.finishedAt = new Date().toISOString();
    state.message = error.message || String(error);
    updateProgressFile(fallbackConfig, state);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
