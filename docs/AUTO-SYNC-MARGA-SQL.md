# Marga Auto SQL Sync (Google Drive -> Firebase)

This setup runs automatic SQL sync to Firestore:

- Primary run: **7:00 PM Asia/Manila**
- Fallback retry: **8:15 AM Asia/Manila (next day)**

Functions added:

- `/.netlify/functions/marga-auto-sync-evening` (scheduled)
- `/.netlify/functions/marga-auto-sync-morning` (scheduled)
- `/.netlify/functions/marga-auto-sync-now` (manual trigger)

Core engine:

- `netlify/functions/_marga-auto-sync-core.js`

## What it does

1. Resolves Google Drive folder path (default `work/marga/marga database`).
2. Picks latest `.sql` or `.sql.gz` dump (or target-date match if available).
3. Parses SQL `CREATE TABLE` + `INSERT INTO`.
4. Applies incremental upserts to Firestore based on `sys_sync_state/<table>.last_id`.
5. Updates sync state and writes notification log to `sys_sync_notifications`.
6. Sends notification via webhook and/or email (if configured).

## Required Netlify Environment Variables

### Google Drive access

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
  - Paste full private key with escaped newlines (`\n`) if needed.
- `GOOGLE_DRIVE_FOLDER_PATH`
  - Example: `work/marga/marga database`
- Optional: `GOOGLE_DRIVE_ROOT_ID`
  - Defaults to `root`

### Firestore

Use either:

- `FIREBASE_API_KEY`
- `FIRESTORE_BASE_URL`

Or let function fallback to `shared/js/firebase-config.js`.

Recommended (to avoid Firestore rules authorization issues on sync-state collections):

- `FIRESTORE_USE_SERVICE_ACCOUNT=true`

When enabled, Firestore calls use OAuth service-account token (scope `datastore`) instead of API key.
Ensure the service account has Firestore write/read IAM permissions for this project.

### Sync behavior

- `MARGA_SYNC_TIMEZONE` (default: `Asia/Manila`)
- `MARGA_SYNC_TABLES` (comma-separated table list; default is module preset list)
- `MARGA_SYNC_WRITE_ENABLED` (`true`/`false`, default `true`)
- `MARGA_SYNC_QUERY_LIMIT` (default `20000`)

### Notifications

Webhook (recommended):

- `MARGA_NOTIFY_WEBHOOK_URL`

Email (optional, via Resend):

- `RESEND_API_KEY`
- `MARGA_NOTIFY_EMAIL_TO`
- `MARGA_NOTIFY_EMAIL_FROM` (optional; default `Marga Sync <noreply@marga.biz>`)

### Manual trigger security

- `MARGA_SYNC_TRIGGER_TOKEN`

If set, manual endpoint requires:

- header: `X-Auto-Sync-Token: <token>` OR
- query: `?token=<token>`

## Manual Run

```bash
curl -H "X-Auto-Sync-Token: YOUR_TOKEN" \
  "https://margaapp.netlify.app/.netlify/functions/marga-auto-sync-now?mode=manual&force=true"
```

Modes:

- `mode=manual` (default)
- `mode=evening`
- `mode=morning`

## Schedule details

Netlify scheduled cron is UTC:

- Evening: `0 11 * * *` -> `7:00 PM Asia/Manila`
- Morning: `15 0 * * *` -> `8:15 AM Asia/Manila`

## Notification + state tracking

- Last run state is written to: `sys_sync_state/marga_auto_sync`
- Per-run log document is written to: `sys_sync_notifications/<auto_id>`

This gives a daily audit trail even if webhook/email fails.
