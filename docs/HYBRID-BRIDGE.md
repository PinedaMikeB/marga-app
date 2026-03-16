# Hybrid Bridge

`tools/build-hybrid-bridge.mjs` builds a temporary bridge from:

- legacy MySQL dump -> baseline snapshot
- Firebase operational changes -> MySQL SQL patch files

This is meant for the current hybrid phase where:

- legacy VB.NET still writes core records to MySQL
- the web app writes follow-ups and field execution updates to Firebase
- we want SQL patch output now, before wiring live MySQL writes later

## What It Syncs

Current bridge output covers:

- `tbl_collectionhistory`
  - inserts for web-created follow-up rows not already present in the dump baseline
- `tbl_schedule`
  - updates for selected operational columns that exist in legacy MySQL and are also written by the web app
- `tbl_schedtime`
  - inserts/updates for field execution logs
- `tbl_closedscheds`
  - optional candidate inserts in a separate SQL file

## Current Schedule Field Whitelist

The bridge only writes these `tbl_schedule` fields back to MySQL:

- `serial`
- `isongoing`
- `date_finished`
- `closedby`
- `phone_number`
- `meter_reading`
- `tl_status`
- `tl_remarks`
- `customer_request`
- `collocutor`
- `dev_remarks`

Web-only Firebase fields like `field_*`, `pending_parts`, `customer_pin_verified`, and similar custom columns are intentionally ignored because they do not exist in the current dump schema.

For change discovery, the bridge looks at recent schedule docs ordered by:

- `bridge_updated_at`
- fallback: `field_updated_at`

## Run

Example:

```powershell
node tools\build-hybrid-bridge.mjs `
  --dump "C:\Users\pc\Documents\dumps\Dump20260309.sql" `
  --out-dir "D:\Codex\Github\marga-app\bridge-output"
```

Optional tuning:

```powershell
node tools\build-hybrid-bridge.mjs `
  --dump "C:\Users\pc\Documents\dumps\Dump20260309.sql" `
  --out-dir "D:\Codex\Github\marga-app\bridge-output" `
  --collection-history-limit 5000 `
  --schedule-limit 3000 `
  --schedtime-per-schedule 3
```

## Output

The script writes:

- `mysql-bridge-patch.sql`
  - main SQL patch file
- `mysql-bridge-optional-closedscheds.sql`
  - optional closure marker inserts
- `mysql-bridge-report.json`
  - summary and samples
- `mysql-bridge-baseline.json`
  - max-id baseline snapshot from the dump

## Notes

- The script does not write directly to MySQL yet.
- It uses the dump as the legacy baseline for duplicate detection and max IDs.
- It reads Firebase using `shared/js/firebase-config.js`.
- A limited test run already completed successfully in this repo using the March 9, 2026 dump.

## Next Step

When live MySQL access is ready, this same bridge can be extended to:

- execute the generated SQL directly
- or replace dump parsing with live reads for the same baseline tables
