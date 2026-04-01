# Billing / Collections Sync Audit

Audit date: 2026-04-01

## Active Sync Paths

- Office source-of-truth mirror:
  - `local-sync/run-live-mysql-to-firebase.mjs`
  - manifest-driven by `local-sync/sync-manifest.mjs`
- Reverse-safe writeback:
  - `local-sync/run-local-sync.mjs`
- Legacy / background dump-based path:
  - `netlify/functions/_marga-auto-sync-core.js`
  - manual UI at `sync/js/sync.js`

## Root Causes Found

- The live mirror manifest was still missing `tbl_contractdep`.
- `tbl_machinereading` and `tbl_payments` existed in SQL but were disabled in the manifest.
- The legacy dump-based presets still referenced old live-missing table names:
  - `tbl_billout`
  - `tbl_billoutparticular`
  - `tbl_billoutparticulars`
  - `tbl_collection`
  - `tbl_collectiondetails`
  - `tbl_or`
  - `tbl_check`
- `local-sync/.env` style table overrides could silently narrow the live table scope below the manifest, which made the running supervisor depend on local override drift instead of the manifest.

## Live SQL Tables Checked

Present in live SQL and needed for billing / collections read models:

- `tbl_billinfo`
- `tbl_billing`
- `tbl_collectionhistory`
- `tbl_collectioninfo`
- `tbl_collections`
- `tbl_paymentinfo`
- `tbl_payments`
- `tbl_paymentcheck`
- `tbl_checkpayments`
- `tbl_ornumber`
- `tbl_machinereading`
- `tbl_schedule`
- `tbl_contractmain`
- `tbl_contractdep`
- `tbl_branchinfo`
- `tbl_companylist`
- `tbl_machine`
- `tbl_newmachinehistory`

Not present in the current live `margaco_db` instance:

- `tbl_billout`
- `tbl_billoutparticular`
- `tbl_billoutparticulars`
- `tbl_collection`
- `tbl_collectiondetails`
- `tbl_or`
- `tbl_check`

## Coverage Before Fix

Already mirrored in the local manifest:

- `tbl_billinfo`
- `tbl_billing`
- `tbl_collectionhistory`
- `tbl_collectioninfo`
- `tbl_collections`
- `tbl_paymentinfo`
- `tbl_paymentcheck`
- `tbl_checkpayments`
- `tbl_ornumber`
- `tbl_schedule`
- `tbl_contractmain`
- `tbl_branchinfo`
- `tbl_companylist`
- `tbl_machine`
- `tbl_newmachinehistory`

Missing or disabled before fix:

- `tbl_contractdep` was not in the manifest.
- `tbl_machinereading` was in the manifest but disabled.
- `tbl_payments` was in the manifest but disabled.

## Why These Tables Matter

- `tbl_billing` provides the machine/account-level billed rows that the web billing and collections screens total up.
- `tbl_contractmain` links billing rows to machines and contract headers.
- `tbl_contractdep` provides department-level detail that is needed when mother-company billing covers multiple branches or departments under one customer umbrella.
- `tbl_newmachinehistory` resolves the latest delivered branch for a machine.
- `tbl_branchinfo` and `tbl_companylist` turn those links into branch and mother-company names in Firebase.
- `tbl_machinereading` provides the reading trail needed to explain billed usage.
- `tbl_paymentinfo`, `tbl_payments`, `tbl_paymentcheck`, `tbl_checkpayments`, and `tbl_ornumber` provide posted payment, OR, and check coverage by posted month.

## Fixes Applied

- Enabled `tbl_machinereading` for `MySQL -> Firebase`.
- Added `tbl_contractdep` to the manifest for `MySQL -> Firebase`.
- Enabled `tbl_payments` for `MySQL -> Firebase`.
- Changed the live runner env table-list handling so manifest defaults are merged by default instead of being silently narrowed by stale local overrides.
- Updated the legacy Netlify auto-sync defaults and the manual sync UI presets to current live table names.
- Added richer table-level reporting in the live mirror report so each table records whether it synced, had no changes, or was skipped.

## Mother-Company Billing Note

For mother-company cases such as branch rollups under a single invoicing customer:

- the source branch/dept breakdown is not in old `billout` tables on this live server
- the live breakdown path is:
  - `tbl_billing`
  - `tbl_contractmain`
  - `tbl_contractdep`
  - `tbl_newmachinehistory`
  - `tbl_branchinfo`
  - `tbl_companylist`

That means Firebase must mirror all of those tables together for the web app to show correct branch-level billed amounts.
