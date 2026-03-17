#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { exec, execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeConfig,
  createFirestoreClient,
  createMysqlPool,
  hasMysqlConfig,
  loadEnvFile,
  parseBooleanEnv,
  parseFirebaseConfig,
  readState,
  resolveMaybeRelative,
  runOnce,
} from "./run-local-sync.mjs";
import { describeDumpSource, runDumpToFirebase } from "./run-dump-to-firebase.mjs";
import { loadLiveMysqlSyncConfig, runLiveMysqlToFirebase } from "./run-live-mysql-to-firebase.mjs";
import { OFFICE_SYNC_MANIFEST_VERSION, getFirebaseToMysqlEntries, getMysqlToFirebaseEntries } from "./sync-manifest.mjs";

const __filename = fileURLToPath(import.meta.url);
const LOCAL_SYNC_DIR = path.dirname(__filename);
const ENV_PATH = path.join(LOCAL_SYNC_DIR, ".env");
const DASHBOARD_HTML = path.join(LOCAL_SYNC_DIR, "ui", "index.html");
const DASHBOARD_CONFIG_PATH = path.join(LOCAL_SYNC_DIR, "state", "dashboard-config.json");
const DASHBOARD_ACTIVITY_PATH = path.join(LOCAL_SYNC_DIR, "state", "dashboard-activity.json");
const FULL_MIRROR_SHARD_COUNT = 4;

const SYNC_KEYS = {
  mysqlToFirebase: "mysql_to_firebase",
  firebaseToMysql: "firebase_to_mysql",
};

const SYNC_LABELS = {
  [SYNC_KEYS.mysqlToFirebase]: "MySQL -> Firebase",
  [SYNC_KEYS.firebaseToMysql]: "Firebase -> MySQL",
};

function fullMirrorProgressPathForShard(shardIndex, shardCount = FULL_MIRROR_SHARD_COUNT) {
  return path.join(LOCAL_SYNC_DIR, "output", `full-mirror-progress-shard-${shardIndex + 1}-of-${shardCount}.json`);
}

function fullMirrorReportPathForShard(shardIndex, shardCount = FULL_MIRROR_SHARD_COUNT) {
  return path.join(LOCAL_SYNC_DIR, "output", `full-mirror-report-shard-${shardIndex + 1}-of-${shardCount}.json`);
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function safeWriteJson(filePath, payload) {
  ensureParent(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function safeReadJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function loadDashboardOverrides() {
  return safeReadJson(DASHBOARD_CONFIG_PATH) || {};
}

function saveDashboardOverrides(patch) {
  const next = {
    ...loadDashboardOverrides(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  safeWriteJson(DASHBOARD_CONFIG_PATH, next);
  return next;
}

function loadActivity() {
  const entries = safeReadJson(DASHBOARD_ACTIVITY_PATH);
  return Array.isArray(entries) ? entries : [];
}

function saveActivity(entries) {
  safeWriteJson(DASHBOARD_ACTIVITY_PATH, entries.slice(-300));
}

function isPidRunning(pid) {
  const numericPid = Number(pid || 0);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function readFullMirrorState() {
  const shards = [];
  for (let shardIndex = 0; shardIndex < FULL_MIRROR_SHARD_COUNT; shardIndex += 1) {
    const progressPath = fullMirrorProgressPathForShard(shardIndex);
    const reportPath = fullMirrorReportPathForShard(shardIndex);
    const progress = safeReadJson(progressPath) || null;
    const report = safeReadJson(reportPath) || null;
    const active = Boolean(progress?.active && isPidRunning(progress?.pid));
    shards.push({
      shardIndex,
      progressPath,
      reportPath,
      active,
      progress: progress ? { ...progress, active } : null,
      report,
    });
  }

  const active = shards.some((shard) => shard.active);
  const progressShards = shards.filter((shard) => shard.progress);
  const completedShards = shards.filter((shard) => shard.progress?.status === "completed");
  const errorShards = shards.filter((shard) => shard.progress?.status === "error");
  const totalPercent = progressShards.reduce((sum, shard) => sum + Number(shard.progress?.progress?.percent || 0), 0);
  const aggregatePercent = progressShards.length ? Number((totalPercent / FULL_MIRROR_SHARD_COUNT).toFixed(2)) : 0;
  const aggregateProgress = progressShards.length
    ? {
        pid: progressShards.map((shard) => shard.progress?.pid).filter(Boolean),
        active,
        status: active ? "running" : errorShards.length ? "error" : completedShards.length === FULL_MIRROR_SHARD_COUNT ? "completed" : "idle",
        startedAt: progressShards.map((shard) => shard.progress?.startedAt).filter(Boolean).sort()[0] || null,
        finishedAt: active ? null : progressShards.map((shard) => shard.progress?.finishedAt).filter(Boolean).sort().slice(-1)[0] || null,
        message: active
          ? `${progressShards.filter((shard) => shard.active).length}/${FULL_MIRROR_SHARD_COUNT} mirror shards running`
          : errorShards.length
            ? `${errorShards.length} shard(s) need attention`
            : completedShards.length === FULL_MIRROR_SHARD_COUNT
              ? "Full mirror completed"
              : "No full mirror running.",
        progress: {
          percent: aggregatePercent,
          bytesProcessed: progressShards.reduce((sum, shard) => sum + Number(shard.progress?.progress?.bytesProcessed || 0), 0),
          fileSize: progressShards.reduce((sum, shard) => sum + Number(shard.progress?.progress?.fileSize || 0), 0),
          currentTable: progressShards.filter((shard) => shard.active).map((shard) => `S${shard.shardIndex + 1}:${shard.progress?.progress?.currentTable || "-"}`).join(" | "),
          rowsQueued: progressShards.reduce((sum, shard) => sum + Number(shard.progress?.progress?.rowsQueued || 0), 0),
          rowsCommitted: progressShards.reduce((sum, shard) => sum + Number(shard.progress?.progress?.rowsCommitted || 0), 0),
          rowsSkippedNoId: progressShards.reduce((sum, shard) => sum + Number(shard.progress?.progress?.rowsSkippedNoId || 0), 0),
          rowsSkippedResume: progressShards.reduce((sum, shard) => sum + Number(shard.progress?.progress?.rowsSkippedResume || 0), 0),
          rowsFailed: progressShards.reduce((sum, shard) => sum + Number(shard.progress?.progress?.rowsFailed || 0), 0),
          tablesSeen: progressShards.reduce((sum, shard) => sum + Number(shard.progress?.progress?.tablesSeen || 0), 0),
          batchCommits: progressShards.reduce((sum, shard) => sum + Number(shard.progress?.progress?.batchCommits || 0), 0),
        },
        shardCount: FULL_MIRROR_SHARD_COUNT,
        activeShards: progressShards.filter((shard) => shard.active).length,
      }
    : null;

  const reports = shards.filter((shard) => shard.report).map((shard) => shard.report);
  const report = reports.length
    ? {
        generatedAt: reports.map((entry) => entry.generatedAt).filter(Boolean).sort().slice(-1)[0] || null,
        summary: {
          shardsReported: reports.length,
          tablesMirrored: reports.reduce((sum, entry) => sum + Number(entry.summary?.tablesMirrored || 0), 0),
          rowsQueued: reports.reduce((sum, entry) => sum + Number(entry.summary?.rowsQueued || 0), 0),
          rowsCommitted: reports.reduce((sum, entry) => sum + Number(entry.summary?.rowsCommitted || 0), 0),
          rowsSkippedNoId: reports.reduce((sum, entry) => sum + Number(entry.summary?.rowsSkippedNoId || 0), 0),
          batchCommits: reports.reduce((sum, entry) => sum + Number(entry.summary?.batchCommits || 0), 0),
        },
        shards: reports,
      }
    : null;

  return {
    active,
    progress: aggregateProgress,
    report,
    shards,
    shardCount: FULL_MIRROR_SHARD_COUNT,
  };
}

function buildFirebaseToMysqlConfig(env, overrides, dumpSource, defaultLoopSeconds) {
  const apply = parseBooleanEnv(env.FIREBASE_TO_MYSQL_WRITE_ENABLED, true);
  const loopSeconds = Number(env.FIREBASE_TO_MYSQL_LOOP_SECONDS || defaultLoopSeconds || 30) || 30;
  const outDir = path.join(LOCAL_SYNC_DIR, "output", "firebase-to-mysql");
  const stateFile = path.join(LOCAL_SYNC_DIR, "state", "firebase-to-mysql-last-run.json");
  const argv = [
    "node",
    "run-local-sync.mjs",
    "--baseline",
    "live",
    apply ? "--apply" : "--dry-run",
    "--loop-seconds",
    String(loopSeconds),
    "--out-dir",
    outDir,
    "--state-file",
    stateFile,
  ];
  const config = buildRuntimeConfig(argv);
  config.loopSeconds = loopSeconds;
  config.direction = SYNC_KEYS.firebaseToMysql;
  config.outDir = outDir;
  config.stateFile = stateFile;
  config.configuredDumpPath = resolveMaybeRelative(LOCAL_SYNC_DIR, overrides.dumpPath, env.DUMP_PATH);
  config.dumpPath = dumpSource.resolvedPath;
  return config;
}

function buildMysqlToFirebaseConfig(defaultLoopSeconds) {
  const config = loadLiveMysqlSyncConfig();
  config.loopSeconds = Number(loadEnvFile(ENV_PATH).MYSQL_TO_FIREBASE_LOOP_SECONDS || defaultLoopSeconds || 30) || 30;
  config.direction = SYNC_KEYS.mysqlToFirebase;
  config.baseline = "live";
  config.apply = !config.dryRun;
  return config;
}

function buildSyncIssues(syncKey, config, dumpSource) {
  const issues = [];
  const notes = [];

  if (!config.firebaseConfigPath || !fs.existsSync(config.firebaseConfigPath)) {
    issues.push("Firebase config file is missing.");
  }

  if (!hasMysqlConfig(config.mysql)) {
    issues.push("MySQL credentials are incomplete in local-sync/.env.");
  }

  if (syncKey === SYNC_KEYS.firebaseToMysql) {
    if (!dumpSource.resolvedPath && !hasMysqlConfig(config.mysql)) {
      issues.push("No SQL dump fallback is configured.");
    } else if (dumpSource.resolvedPath && !fs.existsSync(dumpSource.resolvedPath)) {
      issues.push("Dump file path does not exist.");
    }
  }

  if (syncKey === SYNC_KEYS.mysqlToFirebase && !(config.serviceAccountEmail && config.serviceAccountPrivateKey)) {
    notes.push("MySQL -> Firebase writes require Google service account credentials.");
  }

  return { issues, notes };
}

function loadSupervisorConfig() {
  const env = loadEnvFile(ENV_PATH);
  const overrides = loadDashboardOverrides();
  const host = env.SYNC_UI_HOST || "127.0.0.1";
  const port = Number(env.SYNC_UI_PORT || 4310) || 4310;
  const defaultLoopSeconds = Number(env.SYNC_LOOP_SECONDS || 30) || 30;
  const autoOpen = parseBooleanEnv(env.SYNC_AUTO_OPEN, false);
  const configuredDumpPath = resolveMaybeRelative(LOCAL_SYNC_DIR, overrides.dumpPath, env.DUMP_PATH);
  const dumpSource = describeDumpSource(configuredDumpPath);

  const mysqlToFirebase = buildMysqlToFirebaseConfig(defaultLoopSeconds);
  const firebaseToMysql = buildFirebaseToMysqlConfig(env, overrides, dumpSource, defaultLoopSeconds);

  const mysqlToFirebaseChecks = buildSyncIssues(SYNC_KEYS.mysqlToFirebase, mysqlToFirebase, dumpSource);
  const firebaseToMysqlChecks = buildSyncIssues(SYNC_KEYS.firebaseToMysql, firebaseToMysql, dumpSource);

  return {
    host,
    port,
    autoOpen,
    dumpSource,
    syncManifestVersion: OFFICE_SYNC_MANIFEST_VERSION,
    syncManifestMysqlToFirebaseEnabled: getMysqlToFirebaseEntries({ enabledOnly: true }).map((entry) => entry.table),
    syncManifestFirebaseToMysqlEnabled: getFirebaseToMysqlEntries({ enabledOnly: true }).map((entry) => entry.table),
    syncs: {
      [SYNC_KEYS.mysqlToFirebase]: {
        key: SYNC_KEYS.mysqlToFirebase,
        label: SYNC_LABELS[SYNC_KEYS.mysqlToFirebase],
        runtimeConfig: mysqlToFirebase,
        loopSeconds: mysqlToFirebase.loopSeconds,
        configIssues: mysqlToFirebaseChecks.issues,
        modeNotes: mysqlToFirebaseChecks.notes,
      },
      [SYNC_KEYS.firebaseToMysql]: {
        key: SYNC_KEYS.firebaseToMysql,
        label: SYNC_LABELS[SYNC_KEYS.firebaseToMysql],
        runtimeConfig: firebaseToMysql,
        loopSeconds: firebaseToMysql.loopSeconds,
        configIssues: firebaseToMysqlChecks.issues,
        modeNotes: firebaseToMysqlChecks.notes,
      },
    },
  };
}

async function checkFirebase(runtimeConfig) {
  try {
    const firestore = createFirestoreClient(parseFirebaseConfig(runtimeConfig.firebaseConfigPath));
    await firestore.runQuery({
      from: [{ collectionId: "tbl_schedule" }],
      limit: 1,
    });
    return { ok: true, checkedAt: new Date().toISOString(), message: "Firebase reachable" };
  } catch (error) {
    return { ok: false, checkedAt: new Date().toISOString(), message: error.message || String(error) };
  }
}

async function checkMysql(runtimeConfig) {
  if (!hasMysqlConfig(runtimeConfig.mysql)) {
    return { ok: false, checkedAt: new Date().toISOString(), message: "Live MySQL not configured on this PC" };
  }

  let pool = null;
  try {
    pool = await createMysqlPool(runtimeConfig.mysql);
    await pool.query("SELECT 1");
    return { ok: true, checkedAt: new Date().toISOString(), message: "MySQL reachable" };
  } catch (error) {
    return { ok: false, checkedAt: new Date().toISOString(), message: error.message || String(error) };
  } finally {
    if (pool) await pool.end();
  }
}

async function refreshSyncConnections(syncState) {
  syncState.connections.firebase = await checkFirebase(syncState.runtimeConfig);
  syncState.connections.mysql = await checkMysql(syncState.runtimeConfig);
}

function openBrowser(url) {
  exec(`cmd /c start "" "${url}"`);
}

function createSyncState(syncConfig, dumpSource) {
  return {
    key: syncConfig.key,
    label: syncConfig.label,
    loopSeconds: syncConfig.loopSeconds,
    runtimeConfig: syncConfig.runtimeConfig,
    currentRun: {
      active: false,
      reason: null,
      startedAt: null,
      finishedAt: null,
      status: "idle",
      message: "",
    },
    connections: {
      firebase: { ok: false, checkedAt: null, message: "Not checked yet" },
      mysql: { ok: false, checkedAt: null, message: "Not checked yet" },
    },
    configIssues: syncConfig.configIssues || [],
    modeNotes: syncConfig.modeNotes || [],
    dumpSource,
    lastKnownState: readState(syncConfig.runtimeConfig.stateFile),
  };
}

function createState(configBundle) {
  return {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    host: configBundle.host,
    port: configBundle.port,
    autoOpen: configBundle.autoOpen,
    configPath: DASHBOARD_CONFIG_PATH,
    dumpSource: configBundle.dumpSource,
    syncManifestVersion: configBundle.syncManifestVersion,
    syncManifestMysqlToFirebaseEnabled: configBundle.syncManifestMysqlToFirebaseEnabled,
    syncManifestFirebaseToMysqlEnabled: configBundle.syncManifestFirebaseToMysqlEnabled,
    activity: loadActivity(),
    fullMirror: readFullMirrorState(),
    syncs: {
      [SYNC_KEYS.mysqlToFirebase]: createSyncState(configBundle.syncs[SYNC_KEYS.mysqlToFirebase], configBundle.dumpSource),
      [SYNC_KEYS.firebaseToMysql]: createSyncState(configBundle.syncs[SYNC_KEYS.firebaseToMysql], configBundle.dumpSource),
    },
  };
}

function appendActivity(state, level, message, meta = null) {
  const entry = {
    at: new Date().toISOString(),
    level,
    message,
    meta,
  };
  state.activity.push(entry);
  state.activity = state.activity.slice(-300);
  saveActivity(state.activity);
}

function loadCurrentReport(syncState) {
  const reportPath = syncState.lastKnownState?.lastOutputs?.reportPath
    || path.join(LOCAL_SYNC_DIR, "output", syncState.key === SYNC_KEYS.firebaseToMysql ? "firebase-to-mysql" : "", syncState.key === SYNC_KEYS.firebaseToMysql ? "mysql-bridge-report.json" : "live-mysql-to-firebase-report.json");
  return safeReadJson(reportPath);
}

function parseTime(value) {
  const millis = Date.parse(value || "");
  return Number.isFinite(millis) ? millis : null;
}

function hasFreshSuccess(syncState) {
  const lastSuccessAt = parseTime(syncState.lastKnownState?.lastSuccessAt);
  if (!lastSuccessAt) return false;
  const minimumThresholdMs = 90 * 1000;
  const loopThresholdMs = Math.max((Number(syncState.loopSeconds || 30) * 3 * 1000), minimumThresholdMs);
  return (Date.now() - lastSuccessAt) <= loopThresholdMs;
}

function hasUnresolvedError(syncState) {
  const lastErrorAt = parseTime(syncState.lastKnownState?.lastErrorAt);
  const lastSuccessAt = parseTime(syncState.lastKnownState?.lastSuccessAt);
  if (!lastErrorAt) return false;
  if (!lastSuccessAt) return true;
  return lastErrorAt >= lastSuccessAt;
}

function resolveSyncHealth(syncState) {
  if (syncState.currentRun.active) return "running";
  if (syncState.configIssues.length || syncState.currentRun.status === "error") return "error";
  if (hasUnresolvedError(syncState)) return "error";
  if (!(syncState.connections.firebase.ok && syncState.connections.mysql.ok)) return "warning";
  return hasFreshSuccess(syncState) ? "ok" : "warning";
}

function buildSyncPayload(syncState) {
  const latestReport = loadCurrentReport(syncState);
  const health = resolveSyncHealth(syncState);

  return {
    key: syncState.key,
    label: syncState.label,
    health,
    loopSeconds: syncState.loopSeconds,
    sync: {
      loopSeconds: syncState.loopSeconds,
      direction: syncState.key,
      applyMode: syncState.runtimeConfig.apply ?? !syncState.runtimeConfig.dryRun,
      baseline: syncState.runtimeConfig.baseline || "live",
      active: syncState.currentRun.active,
      currentRun: syncState.currentRun,
    },
    source: {
      dumpPath: syncState.runtimeConfig.dumpPath || "",
      configuredDumpPath: syncState.runtimeConfig.configuredDumpPath || "",
      dumpMode: syncState.dumpSource?.mode || "direct-file",
      dumpExists: Boolean(syncState.runtimeConfig.dumpPath && fs.existsSync(syncState.runtimeConfig.dumpPath)),
      mysqlHost: syncState.runtimeConfig.mysql?.host || "",
      mysqlDatabase: syncState.runtimeConfig.mysql?.database || "",
    },
    configIssues: syncState.configIssues,
    modeNotes: syncState.modeNotes,
    connections: syncState.connections,
    lastKnownState: syncState.lastKnownState,
    latestReport,
    runtimeConfig: {
      tables: syncState.runtimeConfig.tables || [],
      mutableTables: syncState.runtimeConfig.mutableTables || [],
      bootstrapTables: syncState.runtimeConfig.bootstrapTables || [],
      batchSize: syncState.runtimeConfig.batchSize || null,
      outDir: syncState.runtimeConfig.outDir,
      stateFile: syncState.runtimeConfig.stateFile,
    },
  };
}

function buildStatusPayload(state) {
  state.fullMirror = readFullMirrorState();
  const syncPayloads = {
    [SYNC_KEYS.mysqlToFirebase]: buildSyncPayload(state.syncs[SYNC_KEYS.mysqlToFirebase]),
    [SYNC_KEYS.firebaseToMysql]: buildSyncPayload(state.syncs[SYNC_KEYS.firebaseToMysql]),
  };

  const overallHealth = Object.values(syncPayloads).some((payload) => payload.health === "error")
    ? "error"
    : Object.values(syncPayloads).some((payload) => payload.health === "running")
      ? "running"
      : Object.values(syncPayloads).every((payload) => payload.health === "ok")
        ? "ok"
        : "warning";

  return {
    app: {
      name: "Marga Sync Supervisor",
      startedAt: state.startedAt,
      pid: state.pid,
      health: overallHealth,
      url: `http://${state.host}:${state.port}`,
    },
    syncs: syncPayloads,
    summary: {
      syncManifestVersion: state.syncManifestVersion,
      mysqlToFirebaseEnabledTables: state.syncManifestMysqlToFirebaseEnabled,
      firebaseToMysqlEnabledTables: state.syncManifestFirebaseToMysqlEnabled,
    },
    activity: state.activity,
    fullMirror: state.fullMirror,
    configPath: state.configPath,
  };
}

async function performSync(state, syncKey, reason = "manual") {
  const syncState = state.syncs[syncKey];
  if (!syncState) return { ok: false, skipped: true, message: `Unknown sync key: ${syncKey}` };
  if (syncState.currentRun.active) return { ok: false, skipped: true, message: `${syncState.label} is already running.` };

  if (syncKey === SYNC_KEYS.mysqlToFirebase) {
    state.fullMirror = readFullMirrorState();
    if (state.fullMirror.active) {
      return { ok: false, skipped: true, message: "Full mirror is running. Regular MySQL -> Firebase sync is paused." };
    }
  }

  syncState.currentRun = {
    active: true,
    reason,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    message: "Sync in progress",
  };

  appendActivity(state, "info", `${syncState.label} started (${reason})`, {
    syncKey,
    direction: syncKey,
    baseline: syncState.runtimeConfig.baseline || "live",
    apply: syncState.runtimeConfig.apply ?? !syncState.runtimeConfig.dryRun,
    dumpPath: syncState.runtimeConfig.dumpPath || "",
    mysqlHost: syncState.runtimeConfig.mysql?.host || "",
  });

  try {
    await refreshSyncConnections(syncState);
    if (syncState.configIssues.length) {
      syncState.currentRun = {
        active: false,
        reason,
        startedAt: syncState.currentRun.startedAt,
        finishedAt: new Date().toISOString(),
        status: "error",
        message: syncState.configIssues.join(" "),
      };
      appendActivity(state, "warn", `${syncState.label} skipped because setup needs attention.`, {
        syncKey,
        issues: syncState.configIssues,
      });
      return { ok: false, skipped: true, message: syncState.currentRun.message };
    }

    if (syncKey === SYNC_KEYS.mysqlToFirebase) {
      await runLiveMysqlToFirebase(syncState.runtimeConfig, {
        onActivity(level, message, meta) {
          appendActivity(state, level, message, { ...(meta || {}), syncKey });
        },
      });
    } else if (syncState.runtimeConfig.baseline === "dump" && !syncState.runtimeConfig.apply) {
      await runDumpToFirebase(syncState.runtimeConfig, {
        onActivity(level, message, meta) {
          appendActivity(state, level, message, { ...(meta || {}), syncKey });
        },
      });
    } else {
      await runOnce(syncState.runtimeConfig);
    }

    syncState.lastKnownState = readState(syncState.runtimeConfig.stateFile);
    const report = loadCurrentReport(syncState);
    syncState.currentRun = {
      active: false,
      reason,
      startedAt: syncState.currentRun.startedAt,
      finishedAt: new Date().toISOString(),
      status: "ok",
      message: "Sync completed successfully",
    };
    appendActivity(state, "success", `${syncState.label} completed successfully.`, {
      syncKey,
      summary: report?.summary || null,
    });
    return { ok: true };
  } catch (error) {
    syncState.lastKnownState = readState(syncState.runtimeConfig.stateFile);
    syncState.currentRun = {
      active: false,
      reason,
      startedAt: syncState.currentRun.startedAt,
      finishedAt: new Date().toISOString(),
      status: "error",
      message: error.message || String(error),
    };
    appendActivity(state, "error", `${syncState.label} failed.`, {
      syncKey,
      error: syncState.currentRun.message,
    });
    return { ok: false, message: syncState.currentRun.message };
  }
}

function scheduleLoop(state, syncKey) {
  const syncState = state.syncs[syncKey];
  if (!syncState?.loopSeconds || syncState.loopSeconds < 1) return;
  setInterval(() => {
    performSync(state, syncKey, "loop").catch(() => {});
  }, syncState.loopSeconds * 1000);
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function text(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function selectDumpPathViaDialog() {
  const command = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    "$dialog.Filter = 'SQL dumps (*.sql;*.sql.gz)|*.sql;*.sql.gz|All files (*.*)|*.*'",
    "$dialog.InitialDirectory = [Environment]::GetFolderPath('Documents')",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }",
  ].join("; ");

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", command],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout || "").trim());
      },
    );
  });
}

async function refreshAllConnections(state) {
  await Promise.allSettled(Object.values(state.syncs).map((syncState) => refreshSyncConnections(syncState)));
}

async function startServer() {
  const configBundle = loadSupervisorConfig();
  const state = createState(configBundle);

  appendActivity(state, "info", "Dual sync supervisor started on this PC.", {
    url: `http://${state.host}:${state.port}`,
  });

  await refreshAllConnections(state);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${state.host}:${state.port}`}`);

    if (req.method === "GET" && url.pathname === "/api/status") {
      Object.values(state.syncs).forEach((syncState) => {
        syncState.lastKnownState = readState(syncState.runtimeConfig.stateFile);
      });
      await refreshAllConnections(state);
      return json(res, 200, buildStatusPayload(state));
    }

    if (req.method === "POST" && url.pathname === "/api/run-now") {
      const body = await readRequestBody(req).catch(() => ({}));
      const requestedSync = String(body?.syncKey || "both").trim().toLowerCase();
      if (requestedSync === "both") {
        const results = await Promise.allSettled([
          performSync(state, SYNC_KEYS.mysqlToFirebase, "manual"),
          performSync(state, SYNC_KEYS.firebaseToMysql, "manual"),
        ]);
        return json(res, 200, {
          ok: results.every((item) => item.status === "fulfilled" && item.value.ok),
          results,
          status: buildStatusPayload(state),
        });
      }

      const result = await performSync(state, requestedSync, "manual");
      return json(res, result.ok ? 200 : 409, {
        ok: result.ok,
        skipped: Boolean(result.skipped),
        message: result.message || null,
        status: buildStatusPayload(state),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/full-mirror/start") {
      state.fullMirror = readFullMirrorState();
      const mysqlToFirebase = state.syncs[SYNC_KEYS.mysqlToFirebase];
      if (state.fullMirror.active) {
        return json(res, 409, {
          ok: false,
          message: "Full mirror is already running.",
          status: buildStatusPayload(state),
        });
      }
      if (!mysqlToFirebase.runtimeConfig.dumpPath || !fs.existsSync(mysqlToFirebase.runtimeConfig.dumpPath)) {
        return json(res, 400, {
          ok: false,
          message: "Select a valid dump file before starting full mirror.",
          status: buildStatusPayload(state),
        });
      }

      const shardPids = [];
      for (let shardIndex = 0; shardIndex < FULL_MIRROR_SHARD_COUNT; shardIndex += 1) {
        const child = spawn(
          process.execPath,
          [
            "run-full-mirror-to-firebase.mjs",
            "--dump",
            mysqlToFirebase.runtimeConfig.dumpPath,
            "--out-dir",
            mysqlToFirebase.runtimeConfig.outDir,
            "--shard-index",
            String(shardIndex),
            "--shard-count",
            String(FULL_MIRROR_SHARD_COUNT),
            "--progress",
            fullMirrorProgressPathForShard(shardIndex),
            "--report",
            fullMirrorReportPathForShard(shardIndex),
          ],
          {
            cwd: LOCAL_SYNC_DIR,
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          },
        );
        child.unref();
        shardPids.push(child.pid);
      }
      appendActivity(state, "info", "Full mirror started in 4 background shards.", {
        pids: shardPids,
        dumpPath: mysqlToFirebase.runtimeConfig.dumpPath,
      });
      return json(res, 202, { ok: true, pids: shardPids, status: buildStatusPayload(state) });
    }

    if (req.method === "POST" && url.pathname === "/api/config/dump-path") {
      const body = await readRequestBody(req).catch(() => null);
      if (!body || typeof body.dumpPath !== "string") {
        return json(res, 400, { ok: false, message: "dumpPath is required." });
      }

      saveDashboardOverrides({ dumpPath: String(body.dumpPath || "").trim() });
      return json(res, 200, { ok: true, message: "Dump path saved. Restart the supervisor to reload it." });
    }

    if (req.method === "POST" && url.pathname === "/api/config/select-dump-path") {
      const selectedPath = await selectDumpPathViaDialog().catch(() => "");
      if (!selectedPath) {
        return json(res, 200, { ok: false, cancelled: true, message: "No file selected." });
      }
      saveDashboardOverrides({ dumpPath: selectedPath });
      return json(res, 200, { ok: true, dumpPath: selectedPath, message: "Dump path saved. Restart the supervisor to reload it." });
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        status: buildStatusPayload(state).app.health,
        pid: process.pid,
      });
    }

    if (req.method === "GET" && url.pathname === "/") {
      return text(res, 200, fs.readFileSync(DASHBOARD_HTML, "utf8"), "text/html; charset=utf-8");
    }

    return text(res, 404, "Not found");
  });

  server.listen(state.port, state.host, () => {
    console.log(`Marga Sync Supervisor listening at http://${state.host}:${state.port}`);
    console.log(`- MySQL -> Firebase loop: every ${state.syncs[SYNC_KEYS.mysqlToFirebase].loopSeconds} seconds`);
    console.log(`- Firebase -> MySQL loop: every ${state.syncs[SYNC_KEYS.firebaseToMysql].loopSeconds} seconds`);
    if (state.autoOpen) openBrowser(`http://${state.host}:${state.port}`);
    scheduleLoop(state, SYNC_KEYS.mysqlToFirebase);
    scheduleLoop(state, SYNC_KEYS.firebaseToMysql);
    performSync(state, SYNC_KEYS.mysqlToFirebase, "startup").catch(() => {});
    performSync(state, SYNC_KEYS.firebaseToMysql, "startup").catch(() => {});
  });
}

startServer().catch((error) => {
  console.error(`Supervisor failed to start: ${error.message || String(error)}`);
  process.exit(1);
});
