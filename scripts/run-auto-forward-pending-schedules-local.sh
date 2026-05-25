#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/Volumes/Wotg Drive Mike/GitHub/Marga-App"
LOG_DIR="$REPO_ROOT/logs"
NODE_BIN="${NODE_BIN:-/opt/homebrew/opt/node/bin/node}"
TODAY_WEEKDAY="$(TZ=Asia/Manila date +%u)"

mkdir -p "$LOG_DIR"

if [[ "$TODAY_WEEKDAY" == "7" ]]; then
  echo "$(TZ=Asia/Manila date '+%Y-%m-%d %H:%M:%S %Z') skipped Sunday auto-forward"
  exit 0
fi

export MARGABASE_DOCUMENTS_BASE_URL="${MARGABASE_DOCUMENTS_BASE_URL:-http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents}"
export MARGABASE_API_KEY="${MARGABASE_API_KEY:-margabase-local}"

cd "$REPO_ROOT"
exec "$NODE_BIN" tools/auto-forward-pending-schedules.mjs
