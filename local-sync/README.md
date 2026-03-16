# Local Sync

This folder is the office-side sync runner and local status dashboard.

- `marga-app` online still runs in the browser and writes to Firebase
- `local-sync` runs on the office PC or office server
- `local-sync` reads Firebase and writes selected changes back to local MySQL
- staff can view the dashboard at `http://127.0.0.1:4310`
- if live MySQL is not reachable from this PC, the dashboard falls back to dump-only monitoring

## What It Does

Current sync scope:

- `tbl_collectionhistory`
  - inserts follow-up rows created in Firebase
- `tbl_schedule`
  - updates a safe whitelist of schedule fields already present in legacy MySQL
- `tbl_printedscheds`
  - printed day-sheet routing rows used by the legacy dispatch board
- `tbl_savedscheds`
  - saved day-sheet routing rows used as fallback when no printed route exists
- `tbl_schedtime`
  - inserts or updates field execution rows
- `tbl_closedscheds`
  - optional closure marker inserts when enabled

## Setup

1. Open a terminal in [local-sync](/D:/Codex/Github/marga-app/local-sync)
2. Install dependencies:

```powershell
npm install
```

3. Copy `.env.example` to `.env`
4. Fill in your local MySQL connection details
5. Set these if you want the dashboard to be live-apply by default:

```env
SYNC_BASELINE=live
SYNC_APPLY=1
SYNC_LOOP_SECONDS=30
```

For local background writes into Firebase from this PC, also add a Google service account:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Without that, the dashboard can still read Firebase, but server-side dump pushes may fail if Firestore rules do not allow unauthenticated writes.

On this office PC, a ready-to-edit [.env](/D:/Codex/Github/marga-app/local-sync/.env) is now in place with safe local defaults:

- `SYNC_BASELINE=dump`
- `SYNC_APPLY=0`
- `SYNC_LOOP_SECONDS=300`

To import the Google service-account JSON into `.env` automatically:

```powershell
powershell -ExecutionPolicy Bypass -File .\import-service-account.ps1 -JsonPath "C:\Path\to\service-account.json"
```

That writes these exact entries into `.env`:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## Run

Dry-run using the dump baseline:

```powershell
node run-local-sync.mjs --baseline dump
```

Apply directly to live MySQL:

```powershell
node run-local-sync.mjs --baseline live --apply
```

Run continuously every 30 seconds:

```powershell
node run-local-sync.mjs --baseline live --apply --loop-seconds 30
```

For the live MySQL to Firebase runner, keep these in `.env` so route rows sync automatically:

```env
MYSQL_TO_FIREBASE_TABLES=tbl_schedule,tbl_printedscheds,tbl_savedscheds,tbl_schedtime,tbl_closedscheds
MYSQL_TO_FIREBASE_BOOTSTRAP_TABLES=tbl_printedscheds,tbl_savedscheds
MYSQL_TO_FIREBASE_BOOTSTRAP_DAYS=31
MYSQL_TO_FIREBASE_WRITE_ENABLED=1
```

Bootstrap behavior:

- if `tbl_printedscheds` or `tbl_savedscheds` has no watermark yet in Firebase, the syncer now imports recent route rows automatically
- after bootstrap, the watermark advances to the live MySQL max id and normal incremental sync continues

Backfill one route day from live MySQL into Firebase:

```powershell
node backfill-route-day-to-firebase.mjs --date 2026-03-16
```

Run the local dashboard:

```powershell
node dashboard-server.mjs
```

Then open:

```text
http://127.0.0.1:4310
```

The dashboard shows:

- whether the sync service is alive
- Firebase connection status
- MySQL connection status
- last successful run
- last error
- latest insert/update counts
- a local dump path selector that is saved on this PC only
- an activity feed for startup, path changes, and sync runs
- if Firebase server writes are blocked, the error will appear in the activity feed and current run message

You can also trigger a manual sync from the page.

## Start On Boot

To install a Windows startup task:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-startup-task.ps1
```

That creates a scheduled task that starts the dashboard and sync loop when the PC boots.

## Notes

- Default mode is safe planning only. It writes SQL/report files and does not change MySQL unless `--apply` is used.
- The script writes local state to `local-sync/state/last-run.json`.
- Output files are written to `local-sync/output/`.
- This code can live in the repo and still run only locally. It does not run on Netlify or in the browser.
- The dashboard is local-only and served from the office machine itself.
