# Margabase DigitalOcean Cutover Audit

Last updated: 2026-05-30 (DNS tunnel-off step documented)

## Current Decision

Target production shape:

```text
staff browser -> app.marga.biz -> backend API -> DigitalOcean PostgreSQL
```

The browser must not choose or connect directly to Firebase, Supabase, raw Postgres, or any retired backend. It may keep using the Firestore-compatible URL shape during transition only when that URL is served by the owner-controlled backend API.

## Current Operating Reality

- Petty Cash is the only module currently running against the database as an active workflow.
- Petty Cash can be caught up later from saved local/browser state and/or targeted backend audit.
- Other modules should be considered not production-ready until their backend API coverage and write-path proof are complete.
- Firebase must not be restarted as a live sync source. Any Firebase check must be a named, targeted rescue/audit with a report, then stopped.

## Highest Cost/Data Risks

1. Old cached app shell or unversioned scripts can keep replaying stale browser code.
2. Offline queue can replay writes after cutover if it stores old backend URLs.
3. Dual database sync can create duplicates, overwrite good rows, or hide missing writes.
4. Browser-exposed backend selection can let staff devices drift between backends.
5. Firestore-compatible raw API allows broad document writes unless the backend validates module rules.
6. Raw `app_meta.firestore_documents` and relational `marga.*` tables can drift if triggers/derivation are stale.
7. Numeric allocators using `orderBy id DESC limit 1` can reuse IDs if ordering is wrong or not atomic.

## Already Present Protection

- `shared/js/firebase-config.js` points `FIREBASE_CONFIG` to Margabase, not the old Firebase project.
- `shared/js/firebase-config.js` blocks the retired `.netlify.app` host and directs users to `app.marga.biz`.
- `shared/js/firebase-config.js` clears old `marga_data_backend` and `marga_api_base_url` preferences on the official host.
- `shared/js/offline-sync.js` prunes queued writes containing `firestore.googleapis.com`.
- `service-worker.js` uses fresh-first fetches for HTML/JS/CSS/JSON and bypasses cache for `/margabase-api/*`.
- `scripts/margabase-firestore-api.mjs` disables live Firebase import through `/admin/sync/start` except local derive mode.

## Immediate Lock-Down Before DigitalOcean Cutover

- Version every production module's `offline-sync.js` include with `?v=20260521-margabase-cache-guard-1` or newer. Several active pages still load it unversioned.
- Bump `service-worker.js` `CACHE_NAME` after any backend routing or offline queue change.
- Remove or hide Settings database switching for production staff; browser should not expose backend choice.
- Keep `/margabase-api/*` or future `https://api.marga.biz/*` as the only browser data route.
- Block any queued write whose URL contains:
  - `firestore.googleapis.com`
  - `margaapp.netlify.app`
  - unknown DigitalOcean/Postgres hostnames
  - raw database connection strings
- Make production backend env contain only the DigitalOcean PostgreSQL connection string and Margabase API secret.
- Remove Firebase service account/write credentials from the production app/API runtime.
- Keep Firebase rescue scripts, but require an explicit emergency flag and a named date/window.

## DigitalOcean Requirements

- Managed PostgreSQL cluster with:
  - private connection preferred for app/API runtime
  - public trusted-source access limited to the owner/admin machine when needed
  - automated backups enabled
  - point-in-time restore available if plan supports it
  - enough storage headroom for raw mirror plus relational tables and indexes
- Separate users/roles:
  - migration/admin role
  - API write role
  - read/report role if needed
- A restore test before production use:
  - restore latest backup into a separate database/cluster
  - verify raw doc count, critical table counts, and Petty Cash sample rows
- Connection string stored only in backend/server environment, never browser code.

## Backend API Coverage Required

The transition backend must support the current Firestore-compatible patterns until modules are rewritten:

- `GET /documents/{collection}`
- `GET /documents/{collection}/{docId}`
- `POST /documents/{collection}?documentId=...`
- `PATCH /documents/{collection}/{docId}`
- `DELETE /documents/{collection}/{docId}`
- `POST /documents:runQuery`

It must also validate important write paths by module, not blindly accept every browser patch forever.

## Module Readiness Matrix

| Module | Status | Required proof before production |
| --- | --- | --- |
| Petty Cash | Preserve and catch up | Save voucher, edit voucher, delete voucher, save request, settings, audit log, supplier create, local/browser state reconciliation |
| Billing | Blocked | Save invoice, delete invoice, print audit, schedule creation, invoice lookup, raw-to-relational trigger, printed-count dashboard |
| Collections | Blocked | Payment post, OR/check rows, balance update, follow-up history, grouped invoices, month matrix totals |
| Service | Blocked | Schedule create/update/delete, time logs, close requests, DR/service item request, branch contact update |
| Field App | Blocked | Attendance, customer time-in/out, close request, photo/pin/repin, serial correction, offline queue replay |
| Master Schedule | Blocked | Planner row create/update/delete, printed/saved routes, close request state, area/tech assignment settings |
| Releasing | Blocked | DR create/finalize, release item state, schedule state, machine update, receiving handoff |
| Receiving | Blocked | Machine status update, machine history, receiving record write |
| Customers | Blocked | Company, branch, billing/contact info, contract dep/main, machine, machine history |
| Inventory | Blocked | Supplier create/update and lookup integrity |
| HR/Settings/Auth | Blocked | Employee update, role permissions, module registry, active roster, login read path |
| Accounting/APD | Partial/local | Decide which local APD keys become backend records; accounting is read-heavy but depends on billing/payment/petty cash truth |

## Petty Cash Catch-Up Plan

Because Petty Cash is the only active live workflow:

1. Preserve current browser local keys:
   - `marga_petty_cash_entries_v1`
   - `marga_petty_cash_requests_v1`
   - `marga_petty_cash_settings_v1`
   - `marga_firestore_offline_queue_v2`
2. Export or inspect those keys from the active staff browser before clearing cache.
3. Query DigitalOcean/Margabase raw docs for:
   - `tbl_pettycash_entries`
   - `tbl_pettycash_requests`
   - `tbl_pettycash_settings`
   - `tbl_pettycash_audit_logs`
4. Compare by voucher/request id and date.
5. Upsert missing Petty Cash rows through the backend API, not direct browser Firebase.
6. Write a JSON/CSV reconciliation report with inserted, skipped, duplicate, and conflict rows.

## Database Integrity Checks

Before production traffic moves to DigitalOcean:

```sql
select collection, count(*)::bigint
from app_meta.firestore_documents
where collection in (
  'tbl_pettycash_entries',
  'tbl_pettycash_requests',
  'tbl_pettycash_settings',
  'tbl_pettycash_audit_logs',
  'tbl_billing',
  'tbl_paymentinfo',
  'tbl_schedule',
  'tbl_finaldr',
  'tbl_newfordr'
)
group by collection
order by collection;
```

```sql
select t.tgname, t.tgenabled
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'app_meta'
  and c.relname = 'firestore_documents';
```

Critical allocator smoke tests:

- `tbl_schedule orderBy id DESC limit 1`
- `tbl_newfordr orderBy id DESC limit 1`
- `tbl_finaldr orderBy id DESC limit 1`
- invoice/OR/DR uniqueness checks
- Petty Cash voucher/request id uniqueness

## Cutover Sequence

0. **Cloudflare DNS for `app.marga.biz` (proven 2026-05-30):** stop `cloudflared`/LaunchAgent on the Mac **before** deleting the tunnel CNAME. Then delete `app` in DNS → Records, add DigitalOcean A/CNAME, confirm the old record does not return. See `HANDOFF.md` and `marga-platform/skills/marga-database-migration/SKILL.md` for CLI commands. Zero Trust Routes for locally managed tunnel `marga-api` are not editable in the dashboard.
1. Snapshot current local Margabase/Postgres.
2. Restore/import into DigitalOcean PostgreSQL.
3. Run migrations, indexes, triggers, and derivation on DigitalOcean.
4. Verify raw counts, trigger health, and Petty Cash sample records.
5. Point backend API to DigitalOcean PostgreSQL.
6. Keep browser data route unchanged where possible: `/margabase-api/*` behind `app.marga.biz`.
7. Bump service worker cache and script query strings.
8. Verify fresh/incognito browser and existing staff browser both resolve only to the backend API.
9. Preserve/export Petty Cash browser state, then clear stale backend preferences and retired offline writes.
10. Run Petty Cash catch-up report.
11. Prove one low-risk Petty Cash write/readback through `app.marga.biz`.
12. Restore other modules one by one only after API/write-path proof.

## Do Not Do

- Do not run continuous Firebase-to-DigitalOcean sync.
- Do not expose DigitalOcean database credentials to browser code.
- Do not reconnect old Netlify production paths as write-capable app paths.
- Do not declare success from row counts alone.
- Do not clear Petty Cash browser/cache state until it is exported or reconciled.
- Do not make Billing/Collections/Service live until their create/update/delete and dashboard side effects are proven.

