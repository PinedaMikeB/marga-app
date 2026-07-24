#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${MARGA_LAUNCH_ENV_FILE:-/Users/mike/.marga-launchd/margabase.env}"

echo "Checking launch environment syntax..."
bash -n "$ENV_FILE"

echo "Checking for unquoted values that can break shell sourcing..."
awk '
  /^[[:space:]]*($|#)/ { next }
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    key = $0
    sub(/=.*/, "", key)
    value = $0
    sub(/^[^=]*=/, "", value)
    if (value !~ /^"/ && value !~ /^\047/ && value ~ /[ <>;&|()]/) {
      print "Risky unquoted value: " key
      bad = 1
    }
    next
  }
  {
    print "Invalid env syntax at line " NR
    bad = 1
  }
  END { exit bad }
' "$ENV_FILE"

check_url() {
  local label="$1"
  local url="$2"
  if curl -fsS --max-time 8 "$url" >/dev/null; then
    echo "OK: $label"
  else
    echo "FAIL: $label ($url)" >&2
    return 1
  fi
}

if [[ "${1:-}" == "--services" ]]; then
  check_url "Margabase API" "http://127.0.0.1:8787/health"
  check_url "Marga app proxy" "http://127.0.0.1:9100/"
  check_url "Marga Care portal" "http://127.0.0.1:9200/health"
fi
