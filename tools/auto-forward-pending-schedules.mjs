#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runAutoForwardPendingSchedules, DEFAULT_START_DATE } = require("./auto-forward-pending-schedules-core.cjs");

function parseArgs(argv) {
  const clean = (value) => String(value ?? "").trim();
  const todayManila = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  };
  const addDays = (dateKey, days) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
  };
  const args = {
    date: todayManila(),
    targetDate: "",
    startDate: DEFAULT_START_DATE,
    dryRun: false,
    lookbackDays: 45
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--date" && next) {
      args.date = next;
      index += 1;
    } else if (token === "--target-date" && next) {
      args.targetDate = next;
      index += 1;
    } else if (token === "--lookback-days" && next) {
      args.lookbackDays = Math.max(1, Number(next) || 45);
      index += 1;
    } else if (token === "--start-date" && next) {
      args.startDate = next;
      index += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    }
  }
  if (!args.targetDate) args.targetDate = addDays(args.date, 1);
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await runAutoForwardPendingSchedules({
    ...args,
    envFilePath: "/Users/mike/.codex/env/marga-app.env",
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
