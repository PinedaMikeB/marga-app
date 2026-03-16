#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { exec, execFile, spawn } from "node:child_process";
import {
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
import { fileURLToPath } from "node:url";

const LOCAL_SYNC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(LOCAL_SYNC_DIR, ".env");
const DASHBOARD_HTML = path.join(LOCAL_SYNC_DIR, "ui", "index.html");
const DASHBOARD_CONFIG_PATH = path.join(LOCAL_SYNC_DIR, "state", "dashboard-config.json");
const DASHBOARD_ACTIVITY_PATH = path.join(LOCAL_SYNC_DIR, "state", "dashboard-activity.json");
const FULL_MIRROR_SHARD_COUNT = 4;

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
  safeWriteJson(DASHBOARD_ACTIVITY_PATH, entries.slice(-200));
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

function loadDashboardConfig() {
  const env = loadEnvFile(ENV_PATH);
  const overrides = loadDashboardOverrides();
  const host = env.SYNC_UI_HOST || "127.0.0.1";
  const port = Number(env.SYNC_UI_PORT || 4310);
  const loopSeconds = Number(env.SYNC_LOOP_SECONDS || 30) || 30;
  const direction = String(env.SYNC_DIRECTION || "firebase_to_mysql").trim().toLowerCase();
  const baseline = String(overrides.baseline || env.SYNC_BASELINE || "live").toLowerCase();
  const apply = overrides.apply !== undefined
    ? Boolean(overrides.apply)
    : parseBooleanEnv(env.SYNC_APPLY, true);
  const autoOpen = parseBooleanEnv(env.SYNC_AUTO_OPEN, false);
  const configuredDumpPath = resolveMaybeRelative(LOCAL_SYNC_DIR, overrides.dumpPath, env.DUMP_PATH);
  const dumpSource = describeDumpSource(configuredDumpPath);
  const runtimeConfig = {
    direction,
    baseline,
    apply,
    applyClosedscheds: parseBooleanEnv(env.ENABLE_CLOSEDSCHEDS, false),
    loopSeconds,
    firebaseConfigPath: resolveMaybeRelative(LOCAL_SYNC_DIR, null, env.FIREBASE_CONFIG_PATH || "../shared/js/firebase-config.js"),
    dumpPath: dumpSource.resolvedPath,
    configuredDumpPath,
    outDir: resolveMaybeRelative(LOCAL_SYNC_DIR, null, env.OUT_DIR || "./output"),
    stateFile: resolveMaybeRelative(LOCAL_SYNC_DIR, null, env.STATE_FILE || "./state/last-run.json"),
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    serviceAccountPrivateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "",
    collectionHistoryLimit: Number(env.COLLECTION_HISTORY_LIMIT || 5000),
    scheduleLimit: Number(env.SCHEDULE_LIMIT || 3000),
    schedtimePerSchedule: Number(env.SCHEDTIME_PER_SCHEDULE || 3),
    mysql: {
      host: env.MYSQL_HOST || process.env.MYSQL_HOST || "",
      port: Number(env.MYSQL_PORT || process.env.MYSQL_PORT || 3306),
      user: env.MYSQL_USER || process.env.MYSQL_USER || "",
      password: env.MYSQL_PASSWORD || process.env.MYSQL_PASSWORD || "",
      database: env.MYSQL_DATABASE || process.env.MYSQL_DATABASE || "",
    },
  };
  const liveMysqlConfig = loadLiveMysqlSyncConfig();
  runtimeConfig.liveMysqlTables = liveMysqlConfig.tables;
  runtimeConfig.liveMysqlBatchSize = liveMysqlConfig.batchSize;
  runtimeConfig.liveMysqlBootstrapTables = liveMysqlConfig.bootstrapTables;
  runtimeConfig.liveMysqlBootstrapDays = liveMysqlConfig.bootstrapDays;
  runtimeConfig.liveMysqlMutableTables = liveMysqlConfig.mutableTables;
  runtimeConfig.liveMysqlMutableLookbackHours = liveMysqlConfig.mutableLookbackHours;

  if (runtimeConfig.direction === "mysql_to_firebase") {
    runtimeConfig.baseline = "live";
    runtimeConfig.apply = !liveMysqlConfig.dryRun;
    runtimeConfig.firebaseConfigPath = liveMysqlConfig.firebaseConfigPath;
    runtimeConfig.outDir = liveMysqlConfig.outDir;
    runtimeConfig.stateFile = liveMysqlConfig.stateFile;
    runtimeConfig.serviceAccountEmail = liveMysqlConfig.serviceAccountEmail;
    runtimeConfig.serviceAccountPrivateKey = liveMysqlConfig.serviceAccountPrivateKey;
  }

  const configIssues = [];
  const modeNotes = [];

  if (runtimeConfig.direction === "mysql_to_firebase" && !hasMysqlConfig(runtimeConfig.mysql)) {
    configIssues.push("MySQL credentials are incomplete in local-sync/.env for live MySQL to Firebase sync.");
  }
  if (runtimeConfig.direction !== "mysql_to_firebase" && !hasMysqlConfig(runtimeConfig.mysql) && runtimeConfig.dumpPath) {
    runtimeConfig.baseline = "dump";
    runtimeConfig.apply = false;
    modeNotes.push("Live MySQL is not reachable from this PC, so the dashboard is using dump-only mode.");
  }
  if ((runtimeConfig.baseline === "dump" || runtimeConfig.direction === "mysql_to_firebase") && !(runtimeConfig.serviceAccountEmail && runtimeConfig.serviceAccountPrivateKey)) {
    modeNotes.push("Dump-to-Firebase background writes may need Google service account credentials in local-sync/.env.");
  }

  if (!runtimeConfig.firebaseConfigPath || !fs.existsSync(runtimeConfig.firebaseConfigPath)) {
    configIssues.push("Firebase config file is missing.");
  }
  if (runtimeConfig.direction !== "mysql_to_firebase" && configuredDumpPath && !runtimeConfig.dumpPath) {
    configIssues.push("No SQL dump files were found in the configured dump path.");
  } else if (runtimeConfig.direction !== "mysql_to_firebase" && runtimeConfig.dumpPath && !fs.existsSync(runtimeConfig.dumpPath)) {
    configIssues.push("Dump file path does not exist.");
  }
  if (runtimeConfig.direction !== "mysql_to_firebase" && (runtimeConfig.baseline === "live" || runtimeConfig.apply) && !hasMysqlConfig(runtimeConfig.mysql)) {
    configIssues.push("MySQL credentials are incomplete in local-sync/.env, and no dump fallback is active.");
  }
  if (runtimeConfig.direction !== "mysql_to_firebase" && !hasMysqlConfig(runtimeConfig.mysql) && !runtimeConfig.dumpPath) {
    configIssues.push("Select a local SQL dump path so this PC can monitor activity without direct live MySQL access.");
  }

  return {
    env,
    overrides,
    host,
    port,
    loopSeconds,
    apply: runtimeConfig.apply,
    baseline: runtimeConfig.baseline,
    direction: runtimeConfig.direction,
    autoOpen,
    runtimeConfig,
    dumpSource,
    configIssues,
    modeNotes,
  };
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

function safeReadJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
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
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      message: "Live MySQL not configured on this PC",
    };
  }

  let pool = null;
  try {
    pool = await createMysqlPool(runtimeConfig.mysql);
    await pool.query("SELECT 1");
    return { ok: true, checkedAt: new Date().toISOString(), message: "MySQL reachable" };
  } catch (error) {
    return { ok: false, checkedAt: new Date().toISOString(), message: error.message || String(error) };
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

async function refreshConnections(state) {
  state.connections.firebase = await checkFirebase(state.runtimeConfig);
  state.connections.mysql = await checkMysql(state.runtimeConfig);
}

function openBrowser(url) {
  exec(`cmd /c start "" "${url}"`);
}

function createState(runtimeConfig, host, port, loopSeconds, apply, configIssues) {
  return {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    host,
    port,
    loopSeconds,
    apply,
    runtimeConfig,
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
    configIssues,
    modeNotes: [],
    configPath: DASHBOARD_CONFIG_PATH,
    activity: loadActivity(),
    lastKnownState: readState(runtimeConfig.stateFile),
    fullMirror: readFullMirrorState(),
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
  state.activity = state.activity.slice(-200);
  saveActivity(state.activity);
}

function loadCurrentReport(state) {
  const reportPath = state.lastKnownState?.lastOutputs?.reportPath || path.join(LOCAL_SYNC_DIR, "output", "mysql-bridge-report.json");
  return safeReadJson(reportPath);
}

function applyDashboardConfigState(state, configBundle) {
  state.runtimeConfig = configBundle.runtimeConfig;
  state.host = configBundle.host;
  state.port = configBundle.port;
  state.loopSeconds = configBundle.loopSeconds;
  state.apply = configBundle.runtimeConfig.apply;
  state.configIssues = configBundle.configIssues;
  state.modeNotes = configBundle.modeNotes;
}

async function performSync(state, reason = "manual") {
  if (state.currentRun.active) {
    return { ok: false, skipped: true, message: "Sync is already running." };
  }
  state.fullMirror = readFullMirrorState();
  if (state.fullMirror.active) {
    return { ok: false, skipped: true, message: "Full mirror is running. Regular sync is paused until it finishes." };
  }

  state.currentRun = {
    active: true,
    reason,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    message: "Sync in progress",
  };
  appendActivity(state, "info", `Sync started (${reason})`, {
    direction: state.runtimeConfig.direction,
    baseline: state.runtimeConfig.baseline,
    apply: state.runtimeConfig.apply,
    dumpPath: state.runtimeConfig.dumpPath,
    mysqlHost: state.runtimeConfig.mysql?.host || "",
  });

  try {
    await refreshConnections(state);
    if (state.configIssues.length) {
      state.currentRun = {
        active: false,
        reason,
        startedAt: state.currentRun.startedAt,
        finishedAt: new Date().toISOString(),
        status: "error",
        message: state.configIssues.join(" "),
      };
      appendActivity(state, "warn", "Sync skipped because setup needs attention.", {
        issues: state.configIssues,
      });
      return { ok: false, skipped: true, message: state.currentRun.message };
    }
    if (state.runtimeConfig.direction === "mysql_to_firebase") {
      await runLiveMysqlToFirebase(state.runtimeConfig, {
        onActivity(level, message, meta) {
          appendActivity(state, level, message, meta);
        },
      });
    } else if (state.runtimeConfig.baseline === "dump" && !state.runtimeConfig.apply) {
      await runDumpToFirebase(state.runtimeConfig, {
        onActivity(level, message, meta) {
          appendActivity(state, level, message, meta);
        },
      });
    } else {
      await runOnce(state.runtimeConfig);
    }
    state.lastKnownState = readState(state.runtimeConfig.stateFile);
    const report = loadCurrentReport(state);
    state.currentRun = {
      active: false,
      reason,
      startedAt: state.currentRun.startedAt,
      finishedAt: new Date().toISOString(),
      status: "ok",
      message: "Sync completed successfully",
    };
    appendActivity(state, "success", "Sync completed successfully.", {
      summary: report?.summary || null,
      syncMode: state.runtimeConfig.direction === "mysql_to_firebase"
        ? "live-mysql-to-firebase"
        : state.runtimeConfig.baseline,
    });
    return { ok: true };
  } catch (error) {
    state.lastKnownState = readState(state.runtimeConfig.stateFile);
    state.currentRun = {
      active: false,
      reason,
      startedAt: state.currentRun.startedAt,
      finishedAt: new Date().toISOString(),
      status: "error",
      message: error.message || String(error),
    };
    appendActivity(state, "error", "Sync failed.", {
      error: state.currentRun.message,
    });
    return { ok: false, message: state.currentRun.message };
  }
}

function scheduleLoop(state) {
  if (!state.loopSeconds || state.loopSeconds < 1) return;
  setInterval(() => {
    performSync(state, "loop").catch(() => {});
  }, state.loopSeconds * 1000);
}

function buildStatusPayload(state) {
  const report = loadCurrentReport(state);
  state.fullMirror = readFullMirrorState();
  const health = state.currentRun.active
    ? "running"
    : state.configIssues.length || state.currentRun.status === "error"
      ? "error"
      : state.connections.firebase.ok && (state.connections.mysql.ok || !hasMysqlConfig(state.runtimeConfig.mysql))
        ? "ok"
        : "warning";

  return {
    app: {
      name: "Marga Local Sync",
      startedAt: state.startedAt,
      pid: state.pid,
      health,
      url: `http://${state.host}:${state.port}`,
    },
    sync: {
      loopSeconds: state.loopSeconds,
      direction: state.runtimeConfig.direction,
      applyMode: state.runtimeConfig.apply,
      baseline: state.runtimeConfig.baseline,
      active: state.currentRun.active,
      currentRun: state.currentRun,
    },
    source: {
      dumpPath: state.runtimeConfig.dumpPath || "",
      configuredDumpPath: state.runtimeConfig.configuredDumpPath || "",
      dumpMode: state.dumpSource?.mode || "direct-file",
      dumpExists: Boolean(state.runtimeConfig.dumpPath && fs.existsSync(state.runtimeConfig.dumpPath)),
      mysqlHost: state.runtimeConfig.mysql?.host || "",
      mysqlDatabase: state.runtimeConfig.mysql?.database || "",
      configPath: state.configPath,
    },
    configIssues: state.configIssues,
    modeNotes: state.modeNotes,
    connections: state.connections,
    lastKnownState: state.lastKnownState,
    latestReport: report,
    activity: state.activity,
    fullMirror: state.fullMirror,
  };
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

async function startServer() {
  const configBundle = loadDashboardConfig();
  const { host, port, loopSeconds, apply, autoOpen, runtimeConfig, configIssues, modeNotes } = configBundle;
  const state = createState(runtimeConfig, host, port, loopSeconds, apply, configIssues);
  state.modeNotes = modeNotes;
  appendActivity(state, "info", "Dashboard started on this PC only.", {
    url: `http://${host}:${port}`,
  });
  if (runtimeConfig.dumpPath) {
    appendActivity(state, "info", "Current dump path loaded.", {
      dumpPath: runtimeConfig.dumpPath,
      exists: fs.existsSync(runtimeConfig.dumpPath),
    });
  }

  await refreshConnections(state);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

    if (req.method === "GET" && url.pathname === "/api/status") {
      state.lastKnownState = readState(state.runtimeConfig.stateFile);
      await refreshConnections(state);
      return json(res, 200, buildStatusPayload(state));
    }

    if (req.method === "POST" && url.pathname === "/api/full-mirror/start") {
      state.fullMirror = readFullMirrorState();
      if (state.fullMirror.active) {
        return json(res, 409, {
          ok: false,
          message: "Full mirror is already running.",
          status: buildStatusPayload(state),
        });
      }
      if (!state.runtimeConfig.dumpPath || !fs.existsSync(state.runtimeConfig.dumpPath)) {
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
            state.runtimeConfig.dumpPath,
            "--out-dir",
            state.runtimeConfig.outDir,
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
        dumpPath: state.runtimeConfig.dumpPath,
      });
      return json(res, 202, {
        ok: true,
        pids: shardPids,
        status: buildStatusPayload(state),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/config/dump-path") {
      const body = await readRequestBody(req).catch(() => null);
      if (!body || typeof body.dumpPath !== "string") {
        return json(res, 400, { ok: false, message: "dumpPath is required." });
      }

      const selectedPath = String(body.dumpPath || "").trim();
      const overrides = saveDashboardOverrides({ dumpPath: selectedPath });
      applyDashboardConfigState(state, loadDashboardConfig());
      state.currentRun = {
        active: false,
        reason: "config-update",
        startedAt: null,
        finishedAt: new Date().toISOString(),
        status: state.configIssues.length ? "error" : "idle",
        message: state.configIssues.length ? state.configIssues.join(" ") : "Dump path updated. Ready for next sync.",
      };
      appendActivity(state, "info", "Dump path updated from dashboard.", {
        dumpPath: selectedPath,
        exists: Boolean(selectedPath && fs.existsSync(selectedPath)),
      });

      return json(res, 200, {
        ok: true,
        overrides,
        status: buildStatusPayload(state),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/config/select-dump-path") {
      const selectedPath = await selectDumpPathViaDialog().catch(() => "");
      if (!selectedPath) {
        return json(res, 200, {
          ok: false,
          cancelled: true,
          message: "No file selected.",
          status: buildStatusPayload(state),
        });
      }

      const overrides = saveDashboardOverrides({ dumpPath: selectedPath });
      applyDashboardConfigState(state, loadDashboardConfig());
      state.currentRun = {
        active: false,
        reason: "config-update",
        startedAt: null,
        finishedAt: new Date().toISOString(),
        status: state.configIssues.length ? "error" : "idle",
        message: state.configIssues.length ? state.configIssues.join(" ") : "Dump path selected. Ready for next sync.",
      };
      appendActivity(state, "info", "Dump path selected from local file dialog.", {
        dumpPath: selectedPath,
        exists: fs.existsSync(selectedPath),
      });

      return json(res, 200, {
        ok: true,
        overrides,
        status: buildStatusPayload(state),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/run-now") {
      const result = await performSync(state, "manual");
      return json(res, result.ok ? 200 : 409, {
        ok: result.ok,
        skipped: Boolean(result.skipped),
        message: result.message || null,
        status: buildStatusPayload(state),
      });
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

  server.listen(port, host, () => {
    console.log(`Marga Local Sync dashboard listening at http://${host}:${port}`);
    console.log(`- Sync loop: every ${loopSeconds} seconds`);
    console.log(`- Apply mode: ${apply ? "live apply" : "dry-run only"}`);
    if (autoOpen) {
      openBrowser(`http://${host}:${port}`);
    }
    scheduleLoop(state);
    performSync(state, "startup").catch(() => {});
  });
}

startServer().catch((error) => {
  console.error(`Dashboard failed to start: ${error.message || String(error)}`);
  process.exit(1);
});
