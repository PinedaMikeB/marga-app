# OpenClaw Analysis API

## Endpoint

`GET /.netlify/functions/openclaw-analysis`

## Purpose

Provides OpenClaw-ready analytics JSON for:

- Active customers with pending needs
- Technician performance and completion rate
- Areas with backjobs / repeated issues
- Clients repeatedly repaired

## Query Parameters

- `date` or `end_date` (`YYYY-MM-DD`): analysis end date (default: today, `Asia/Manila`)
- `start_date` (`YYYY-MM-DD`): optional explicit start date
- `window_days` (int): date span when `start_date` is not provided (default: `30`)
- `carryover_days` (int): include unresolved tasks before start date (default: `14`)
- `include_carryover` (`true|false|1|0`): include carryover logic (default: `true`)
- `repeat_threshold` (int): min repeat count for repeated-repair client list (default: `2`)
- `query_limit` (int): max rows to pull from schedule query (default: `20000`, max: `50000`)
- `timezone` (IANA tz): metadata + default date basis (default: `Asia/Manila`)

## Example

```bash
curl "https://YOUR-SITE.netlify.app/.netlify/functions/openclaw-analysis?end_date=2026-02-18&window_days=45&carryover_days=14&repeat_threshold=2"
```

## Response Shape

Top-level keys:

- `meta`: generation metadata and warnings
- `summary`: overall KPIs
- `insights`: auto-generated high-level insights
- `datasets`:
  - `active_customers_with_pending_needs`
  - `technician_performance`
  - `area_backjobs_and_repeats`
  - `repeatedly_repaired_clients`

## Notes

- Uses Firestore REST and the same schedule status logic used in the service dispatch board.
- If the schedule query hits `query_limit`, a warning is returned in `meta.warnings`.
- Reads Firebase config from environment (`FIREBASE_API_KEY`, `FIREBASE_BASE_URL`) or falls back to `shared/js/firebase-config.js`.
