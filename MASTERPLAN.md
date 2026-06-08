# MARGA Masterplan

Last Updated: 2026-06-01
Canonical Status: Single source of truth for product strategy, guardrails, and migration rules

Read first in every new Marga-App thread:
1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`
3. For database migration/backend cutover work, `/Volumes/Wotg Drive Mike/GitHub/marga-platform/skills/marga-database-migration/SKILL.md`

## Purpose
MARGA is the web-based operating system that is replacing the legacy VB.NET desktop workflow used for copier/printer rental operations.

This file exists to protect the project across new chats by recording:
- what the system is trying to become
- what must not be broken
- which data rules are canonical
- which sequence of work is safe right now

## Why We Are Building This
- The legacy VB.NET app can no longer be extended safely.
- Operations need to work on phone, tablet, and web, not just one office PC.
- We need one system covering customers, contracts, billing, collections, service dispatch, deliveries, reporting, APD, and petty cash.
- During migration, the web app must mirror the business truth from the legacy system closely enough that the office can stop depending on the old app.

## North Star
1. Daily operations are visible and actionable.
2. Billing, Collections, and Service match legacy business behavior closely enough for office use.
3. Customer, branch, machine, contract, and serial identity stay consistent across modules.
4. The app is usable on mobile without hidden actions or impossible horizontal interaction.
5. Each module can evolve without breaking the others.

## Non-Negotiable Constraints
- Keep Marga App implementation in the `Marga-App` repo/thread. If the active thread or cwd is `marga-biz`, stop and redirect before editing app code.
- User expects verified Marga App changes to be pushed to `main` so Netlify can deploy automatically.
- Default release behavior for new Codex threads: after making and verifying Marga-App code changes, commit them and push to `main` unless the user explicitly says not to push.
- Cost-protection purpose: Codex must protect the owner from unnecessary spending. Before any task, choose the cheapest safe path that preserves operational truth, avoids recurring SaaS/API/database charges, avoids broad paid reads/writes, and prevents repeated manual work. If a proven fix, query, report, UI pattern, or workflow will likely be reused, save it in `MASTERPLAN.md`, `HANDOFF.md`, `AGENTS.md`, a script, or a skill so it is not rediscovered and reprompted later.
- Waste-prevention design rule: when building any module, anticipate where staff will make mistakes or ask again. Prefer searchable dropdowns over free text for real records, tables/grids for line-item entry, explicit audit reports for financial changes, reusable helper functions over copy-paste logic, and database-side validation where it prevents bad or duplicate operational records.
- Build-once rule: if a task solved a real business problem before, check the handoff/masterplan/scripts before reimplementing. Promote repeated procedures into scripts, docs, automation, or skills when they save future time or cost.
- Skill reuse rule: repeated migration, design, cost-protection, and continuous-improvement lessons should become reusable skills under `/Volumes/Wotg Drive Mike/GitHub/marga-platform/skills` and, when broadly useful, be linked into `/Users/mike/.codex/skills`.
- Continuous improvement rule: every resolved production error should be converted into reusable protection when it has future value. Codex must actively ask whether the fix belongs in a skill, script, checklist, validation, searchable UI, database rule, or handoff note so the app and the working process improve every day.
- Production backend protection: `app.marga.biz` is the production app path and must use Margabase/Postgres. Do not allow production staff to write new operational records to Firebase.
- Production cost/latency direction after the 2026-06-01 DigitalOcean incident:
  - Do not treat managed Postgres upsizing as the default answer for MARGA.
  - The long-term target is owner-controlled production Postgres/Margabase on a dedicated local server, with Cloudflare/DigitalOcean used only where they add routing, monitoring, backup, or failover value without recreating per-connection/per-upgrade pressure.
  - The MARGA staff app, future `care.marga.biz` customer portal, and `aistaff` voice sales assistants must be planned as one infrastructure load. Voice sales assistant traffic is especially latency-sensitive; if 20+ AI Staff clients are talking while staff modules query the database, Droplet-to-managed-Postgres network hops and managed connection limits become a recurring cost and reliability risk.
  - Before adding recurring cloud spend, first eliminate broad browser scans, move large calculations to background summaries/materialized tables, add database indexes, and keep the app/API/database physically close.
  - Before moving production away from DigitalOcean managed Postgres, force old app shells to forget the DO path: bump service worker and critical JS versions, override/clear stale browser backend preferences and offline queues, and restrict the retired DO API/database route after local read/write proof. The earlier Firebase incident proved that old cached browsers can keep using the wrong backend after a migration.
  - Migration is not successful if it saves Firebase cost but replaces it with forced managed-database upgrades.
- Firebase cost/data protection: after the 2026-05-18 rescue, do not restart live Firebase sync, admin catch-up, or broad Firebase parity readers unless the user explicitly approves a targeted rescue/check. Prefer local backups, saved rescue reports, and Margabase tables first.
- Migration completion rule for MARGA and future webapps: migration is not complete when data is copied. Migration is complete only when old backend secrets/config are removed, old domains are blocked, service worker cache is reset, all write paths are proven against the new database through the same production URL staff use, and stale writes from the old database are reconciled with an auditable report.
- Write-path proof rule: each migrated module must prove create/update/delete behavior against Margabase, not only load data. ID allocators that depend on `orderBy id DESC limit 1`, invoice/OR/DR uniqueness, schedule creation, release item creation, payment posting, petty cash voucher lines, and audit rows must be smoke-tested through `app.marga.biz` before users rely on the module.
- Do not rewrite history on `main` for rollback work. Use forward commits.
- Do not revert unrelated dirty files in the repo.
- Treat Billing, Collections, Service, Customers, APD, Petty Cash, and Sync as separate risk zones.
- The legacy database remains the business source of truth during migration.

## Phased Migration Strategy
### Phase 1: Mirror + Verify
- Keep the legacy SQL/VB.NET workflow running.
- Mirror data into Firebase/web.
- Verify module-by-module parity against real office usage and screenshots.

### Phase 2: Web Becomes Operational Primary
- Billing, Collections, Service, and office workflows run primarily from the web app.
- SQL syncing becomes a migration bridge, then can be reduced once the new office setup and final process are stable.

### Phase 3: MargaBase Self-Hosted Backend
- Dedicated platform repo/path: `/Volumes/Wotg Drive Mike/GitHub/marga-platform`.
- First app stack path: `/Volumes/Wotg Drive Mike/GitHub/marga-platform/apps/margabase`.
- Target: Mac mini-hosted backend that provides Firebase-like realtime updates without Firestore per-document read/write billing.
- 2026-06-01 infrastructure correction:
  - DigitalOcean managed Postgres exposed the wrong cost and latency shape for production: low Droplet CPU/RAM did not prevent module failures because the bottleneck was managed DB connection/query limits and network/database wait time.
  - Owner-controlled local production Postgres is now the preferred primary architecture for MARGA, including the staff app, customer portal, and AI Staff voice assistants.
  - The local production server must be treated as real production infrastructure, not a casual development machine: dedicated hardware, wired network, UPS/solar support, automated backups, offsite copy, restore drills, monitoring, and a documented cutover/rollback path.
  - DigitalOcean can still serve as a public edge host, VPN endpoint, standby replica, or offsite backup target, but the database should not depend on a small managed plan that forces upgrades as usage grows.
  - Cutover from DO back to local must include a cache purge and backend-path lock: old service workers, localStorage, IndexedDB queues, cached API responses, and stale module JS must not be able to continue reading or writing DO Postgres after the local server becomes production.
- Candidate stack:
  - Supabase/Postgres-style self-hosted platform for PostgreSQL, auth, REST, realtime, and future storage.
  - Docker-based deployment on the Mac mini.
  - Local media storage for images/videos with automated backup.
  - Platform design must support multiple future app/SaaS stacks as siblings of `apps/margabase`, each with separate database/config/backup paths.
- Network model:
  - Mac mini runs on solar/UPS-backed power and wired LAN.
  - Dual internet providers should terminate at a dual-WAN router for failover.
  - Customer portal public hostname `care.marga.biz` should use Cloudflare Tunnel to reach the local Mac mini service.
  - Customers must not need Tailscale/VPN or any special app; they should just open the browser and log in.
  - Tailscale is acceptable for internal/admin/private access only.
- Cost model:
  - Cloudflare Tunnel/DNS on the free plan is expected to avoid Firebase-style per-read/write database charges.
  - Cloudflare does not become the database; it only routes web/API traffic to the Mac mini.
  - Real constraints become Mac mini uptime, CPU/RAM, local storage, upload bandwidth, backups, and security.
  - For `aistaff` voice sales assistant, keep speech/agent services close to the database/cache wherever possible. 20+ talking clients can create many short, latency-sensitive reads/writes; do not put every turn through a slow Droplet-to-managed-Postgres path unless the cost and latency have been load-tested.
- Cutover rule:
  - Do not cut production Field App/customer workflows to MargaBase until backups, auth isolation, realtime behavior, and offline/failover behavior are verified.
  - Keep Firebase available as a fallback/mirror during transition until the self-hosted backend is proven stable.
- Production protection rule after May 18 rescue:
  - Current `app.marga.biz` production behavior is locked to Margabase/Postgres by commit `ac93600` `Lock production backend to Margabase`.
  - `app.marga.biz`, `127.0.0.1`, and `localhost` must ignore old Firebase browser preferences and backend query strings.
  - Settings must not offer Firebase as a selectable production backend.
  - Do not run continuous Firebase readers/writers in the background once catch-up is complete. A one-time catch-up is allowed only for a named rescue window or named missing record, and should be stopped immediately after verification.
  - Old deployed app paths that still point to Firebase must be blocked or forced to Margabase before staff can use them.
  - Emergency rescue order: when staff need current-day operations, sync and verify today first across all transaction collections, then work backward one day at a time. For the 2026-05-21 incident, the order is May 21, then May 20, then May 19. Do not start older-day reconciliation until the current-day report is complete enough for Field, Service, Billing, Collections, and Petty Cash to operate.
- Database efficiency rule:
  - Margabase must not simply recreate Firestore's document-by-document loading pattern.
  - Preserve raw Firebase documents in an import/mirror layer, then derive normalized relational tables and app-facing views.
  - Use Postgres indexes, joins, constraints, triggers, scheduled jobs, and materialized summaries to centralize business logic and reduce browser work.
  - Collections is a priority proof point: the current Firebase/browser flow can take around 7 minutes to read and calculate everything. In Postgres, invoice balances, payment-date totals, unpaid receivables, pending billing projections, grouped-customer parent rows, and 2307 follow-up states should be precomputed or queryable through indexed views/API endpoints so the UI requests only the selected month/window/customer set.
  - Collections billing source rule for Supabase/Margabase: do not depend on a capped `load all billing` scan. Query billing by the dashboard's active year/month window, merge targeted results with any compatibility scan, and dedupe by billing document/invoice identity before calculating the matrix, search results, and totals. This prevents invoices that exist in Billing, such as invoice `130652`, from being missing in Collections.
  - Operational counts/reporting rule: every dashboard count must name its source table, date/window fields, identity key for dedupe, and amount/status fields before implementation. Verify counts through the same path staff use, `app.marga.biz` -> Cloudflare -> local Margabase proxy -> local Margabase API, not only through `margaapp.netlify.app`. Netlify can have fresh code while the local proxy still has an old required function module in memory; if the custom domain returns stale count fields, restart `scripts/local-margabase-proxy.mjs` and recheck the API payload.
  - Margabase catch-up rule for counts: when a module count depends on recent operational activity, the Firebase-to-Margabase watcher must poll the real activity fields, not just generic `updated_at` fields. For Billing printed-invoice productivity, the successful pattern was to query `tbl_billing` by `dateprinted`, `date_printed`, `invoice_date`, `invdate`, `datex`, `tmestamp`, and `updated_at`, dedupe by billing document/invoice identity, and calculate both invoice count and amount by staff and billing month. Collections and other modules should reuse this method for payments, ORs, invoice months, 2307 tracking, grouped parents, service close dates, printed routes, and production status movements.
  - Database-side automation should handle core invariants where possible, such as payment rows updating invoice balance, DR finalization marking released items, schedule closure creating audit/event rows, machine pullout setting pending-return state, and nightly jobs refreshing billing/collections summaries.
- Complete backup-first rule:
  - Before the final migration build-out, capture the whole Firebase estate locally: Google-managed Firestore export plus Firebase Storage bucket download.
  - Do not rely on repeated SDK collection walking as the canonical full-copy method; it is too read-expensive, too slow, and can leave confidence gaps.
  - Use the local backup files as the source for Postgres raw import, relational derivation, API compatibility work, and dashboard/parity checks so engineering does not repeatedly reread Firebase.
  - The 2026-05-15 baseline export is `gs://marga-firestore-export-us-450636566224/firestore-managed-exports/2026-05-15T16-40-43+0800`, snapshot `2026-05-15T08:41:00Z` / `2026-05-15 4:41 PM` Manila, with `5,689,231` Firestore documents and about `3.2 GB` exported.
  - Firebase Storage/media must be downloaded from the original bucket `sah-spiritual-journal.firebasestorage.app`; the US bucket is only a temporary Firestore export landing zone.
  - After the baseline, run only an overlapped timestamp catch-up from `2026-05-15 4:00 PM` Manila onward, then compare local results against Firebase on demand.
- Offline-first rule:
  - Desktop and mobile should tolerate temporary internet loss by caching app assets/data and saving new actions to an IndexedDB pending-write queue.
  - MARGA's final invoice numbers, OR numbers, and DR numbers are manually entered from physical booklets, so offline invoice/payment/DR finalization can be allowed as local pending records.
  - When the device reconnects, Margabase must validate duplicate booklet numbers, stale invoice balances, required fields, and conflicting edits before promoting pending records to server truth.
  - Any conflict must be surfaced in a `Needs Review` workflow for office/admin correction, not silently merged or overwritten.
- Persistent form rule:
  - All new operational sections and mobile forms must autosave in-progress entries locally. A browser refresh, app restart, tab switch, or temporary crash should restore filled fields and added rows instead of starting from zero.
  - This applies especially to Field App technician workflows, Petty Cash vouchers, reimbursement/liquidation requests, collections, billing, and service close forms.
  - Browser security does not allow file inputs to be restored automatically after restart, so forms with photos/receipts must remember the filename/status and clearly require reselecting the image before final submission.

### Phase 3A: Active Margabase Test Checkpoint - 2026-05-11 Night
- Current intent:
  - Keep Firebase as production source of truth.
  - Margabase is temporarily disabled in the deployed app while background sync and parity checks are completed.
  - Do not cut over staff globally until sync completion and module parity are proven.
- 2026-05-12 app safety lock:
  - Commit `c2615ca` `Temporarily lock app to Firebase` was pushed to `main`.
  - `shared/js/firebase-config.js` preserves the Margabase path behind `MARGABASE_ENABLED = false` so it can be re-enabled later.
  - While disabled, old browser preferences and query-string backend overrides are cleared/ignored and the app forces the Firebase Firestore REST endpoint.
  - Browsers with stale cached JS may need refresh/Hard Refresh once; current deployed assets use service worker cache `marga-app-shell-v50`.
  - Re-enable Margabase only after sync status, record counts, Collections business outputs, and module parity match Firebase closely enough for a deliberate cutover test.
- App-side test controls completed and pushed:
  - Admin Settings includes a `Database` tab for browser-local Firebase/Margabase switching.
  - Collections includes a `Database Compare Snapshot` scorecard.
  - Browser storage fallback is implemented so backend preference and snapshots do not fail when localStorage is full or blocked.
  - Local route compatibility was fixed with `billing.html` redirect and sidebar Billing link correction.
  - Public testing support was added through `scripts/local-margabase-proxy.mjs`, which serves Marga-App and proxies `/margabase-api/*` to the local Margabase API.
- Current public test route:
  - Temporary tunnel: `https://interference-climbing-vitamins-acting.trycloudflare.com`
  - Margabase Collections test URL: `https://interference-climbing-vitamins-acting.trycloudflare.com/collections.html?marga_backend=margabase&marga_api_base_url=/margabase-api/v1/projects/sah-spiritual-journal/databases/(default)/documents`
  - This is temporary, not the final production URL.
- Current local service map:
  - `127.0.0.1:9100`: Marga-App local static/proxy service.
  - `127.0.0.1:8787`: Margabase Firestore-compatible API.
  - `127.0.0.1:4321`: Margabase import progress dashboard.
  - Cloudflare quick tunnel forwards public test traffic to the local proxy.
- Current database/sync status:
  - Firebase-to-Margabase sync run `#4` was still running at the checkpoint.
  - Do not mark migration as complete until this run finishes and the relational derivation has been refreshed.
  - Important post-migration data is being pulled in, including payments, billing, collection history, field visits, service schedule, and delivery receipts.
  - Observed refreshed counts while run `#4` was active:
    - Raw `tbl_billing`: `77,878`
    - Raw `tbl_checkpayments`: `86,744`
    - Raw `tbl_collectionhistory`: `269,743`
    - Raw `tbl_field_visit_events`: `231`
    - Raw `tbl_paymentinfo`: `117,480`
    - Raw `tbl_schedule`: `321,739`
    - Relational `marga.billing_invoices`: `77,878`
    - Relational `marga.payments`: `117,480`
    - Relational `marga.service_schedules`: `321,704`
    - Relational `marga.field_visit_events`: `231`
    - Relational `marga.delivery_receipts`: `88,811`
- Known parity gaps before any cutover:
  - Collections high-level invoice/payment counts can match while matrix business logic still differs.
  - Firebase screenshot baseline showed customer rows around `2,496`; Margabase showed around `2,353`.
  - Firebase pending cells around `5,141`; Margabase showed around `2,381`.
  - Margabase `Pending Billing Projection` showed `0 / 0`, which is wrong compared with Firebase's nonzero monthly projections.
  - Some projected billing and unpaid receivable month totals differ from Firebase.
  - Next engineering task is not just importing more rows; it is making the Margabase relational/API calculation reproduce the accepted Collections rules.
- Permanent public access plan:
  - `margaapp.netlify.app` remains usable as the existing Netlify fallback.
  - Future app domain can be `app.marga.biz`.
  - Future backend API domain should be `api.marga.biz`.
  - Hostinger nameservers were changed to Cloudflare nameservers: `hope.ns.cloudflare.com` and `major.ns.cloudflare.com`.
  - Permanent Cloudflare named tunnel setup must wait until Cloudflare recognizes `marga.biz` as active.
  - Quick tunnel is acceptable only for temporary testing; do not depend on it for production.
- Protection requirements:
  - Do not expose a public write-capable Margabase API without authentication, authorization, logging, and rate limiting.
  - Keep Firebase/Margabase switch admin-only and browser-local until final cutover.
  - Keep automated backups, restore tests, and an off-Mac copy plan as blockers for production.
  - Before staff use, compare Collections, Billing, Service, Master Schedule, follow-up remarks, service close, and time-in/out records after the final sync.
  - Preserve the ability to hard switch back to Firebase during the test period.

## Current Protected State
- Billing protected operational baseline: commit `8df832d`
- That protected state means:
  - Billing save-first workflow works
  - invoice lookup/delete tracing is available
  - grouped RTP and multimeter behavior stays intact
  - search remains spacing/punctuation tolerant
  - Firebase print template persistence remains durable

Current Collections target state:
- Use the Billing customer set as the base customer universe.
- Include unpaid invoices/accounts that still need collection follow-up.
- Show real serials in SN.
- Make the month matrix usable on desktop and mobile.
- Preserve the current working month-to-month comparison matrix as the rollback baseline before changing grouped-customer presentation.
- Add collapsible grouped-customer presentation only for verified one-invoice / many-branch accounts such as `China Bank Savings - Branches`.

Current Customers target state:
- Next user-requested focus is continuing the existing Customer module in `customers/`.
- Customers must use the same customer/branch/machine/serial truth as Billing and Collections.
- Do not rebuild Customers from scratch; improve the existing directory, profile panel, branch/machine tabs, and customer form carefully.

Current Releasing target state:
- Releasing is now a live operational module for DR creation and printing.
- Quantity requests must expand into separate unit rows so partial delivery can be handled cleanly.
- Create DR should keep selected rows until the user manually clears them.
- Releasing should write DR state back into Firebase and then reflect only the true remaining quantity after Clear/reload.
- Releasing print adjustment templates should persist both locally and in Firestore app settings.

Current operations scheduling state:
- Master Schedule is now a working planning/print surface for daily routes.
- Field App shows the staff member's current printed route by default and has a Carry Over tab for saved/unprinted or older open assigned jobs.
- These schedule features should stay aligned: printed route is the daily route; carry-over is for follow-up/planning and should not replace today's default view.
- Field App GPS attendance rule:
  - Official daily attendance `Time In` is separate from per-customer check-in/out.
  - Official Time In must be within `200m` of either:
    a pinned open/pending scheduled customer assigned to that staff member, or
    an approved HR work-location pin with type `Office` or `Production`.
  - Homepage/Daily Attendance Location Check may consider both today's route and past pending/carryover workload, plus approved office/production pins; it reports the nearest allowed attendance location overall.
  - 2026-06-03 approved workflow update: per-customer check-in/check-out is still required before Mark Finished, but field staff may record and finish the task from the office or another location. Do not require the schedule close flow to be within `200m` of the customer pin.
  - Official daily attendance Time In remains separate from per-customer check-in/out.
  - Per-customer `field_time_in` must match that specific customer's saved branch pin within `200m` and write location proof.
  - Per-customer check-in/check-out is required before Mark Finished; official daily attendance Time In does not satisfy a customer visit check-in.
  - Do not weaken the 200m proof rule without explicit user approval.
- Field App customer pin/repin rule:
  - New customer pins and repins require a frontage/building photo when the phone/browser supports image capture.
  - Already pinned customers must still allow controlled repin because saved pins can be wrong.
  - Repin must confirm before replacing coordinates, preserve previous coordinates in audit fields, and log a distinct `customer_location_repinned` event.
- Field App billing submission rule:
  - Billing Submission should not ask technicians to type the billing date/time manually.
  - Auto-fill the billing date/time when the schedule is opened and require only the receiver name when billing handoff details are needed.
- MARGA communications state:
  - Use self-hosted Jitsi at `call.wotgonline.com`.
  - Direct/role calls are phone-like and may ring in-app while the app is open.
  - General/company meetings are meeting-like and should show a live banner/launcher, not ring everyone by default.
  - Shared company meeting logic lives in `shared/js/marga-meetings.js`; Field App call logic currently lives in `field/js/field.js`.

## Core Architecture
- Frontend-first web app hosted on Netlify.
- Firebase/Firestore is the operational datastore for the web app.
- Module pages should remain modular instead of becoming one giant shared script.
- Shared utilities belong in `shared/`.
- Module JS should not depend directly on other module JS unless there is a very strong reason.

## Canonical Customer Identity Rule
The canonical customer lookup is the **Active Contract Customer Graph**.

Use this graph whenever the app needs the real customer universe for Billing, Collections, Service, customer portal, usage monitoring, or machine history.

Canonical path:
- `tbl_contractmain` where `status == 1`
- `tbl_contractmain.contract_id` -> `tbl_contractdep.id`
- `tbl_contractdep.branch_id` -> `tbl_branchinfo.id`
- `tbl_branchinfo.company_id` -> `tbl_companylist.id`
- `tbl_contractmain.mach_id` -> `tbl_machine.id`
- serial display from `tbl_contractmain.xserial` first, then `tbl_machine.serial`

Rules:
- Do not treat raw `tbl_companylist` as the active customer list.
- Do not treat raw `tbl_machine.client_id` as the primary customer locator.
- Do not let one module invent a different customer/serial truth from another.
- Customer, Billing, Collections, Service, and General Production must agree on the same serial/customer relationship wherever possible.

## Customer Module Rules
- Existing Customer module files:
  - `customers/index.html`
  - `customers/js/customers.js`
  - `customers/js/customer-form.js`
  - `customers/css/customers.css`
  - `customers/css/customer-form.css`
- The Customer directory should show companies/branches/accounts through active contracts and recent billed coverage, not raw companies alone.
- Customer profile/detail views should make branch, bill info, contract, machine, model, and serial relationships inspectable.
- Serial display must prefer `tbl_contractmain.xserial`, then `tbl_machine.serial`.
- Customer form save behavior touches company, branch, contract, and machine records; changes must be small and verified because these records are shared by Billing, Collections, Service, and General Production.
- Good next work sequence for Customers:
  - inspect current `customers/js/customers.js` grouping
  - compare it to Billing matrix rows and the Active Contract Customer Graph
  - fix visible customer/branch/machine/serial mismatches
  - only then polish layout or forms

## Billing Rules
- Billing is still the most fragile module.
- Keep the protected baseline first, then layer small fixes one at a time.
- Never blindly combine timeout, sorting, future-hide, missed-reading, and meter-source fixes in one patch unless fully verified.

Billing meter rules:
- Grouped RTP computation must show all loaded machine/customer rows first.
- Previous meter should be the latest valid meter for the serial/machine before the billing month, not only the previous calendar month.
- Do not silently bill quota from `0 / 0` when no real prior meter exists.
- If previous exists but present is still missing, keep the row visible as pending-present and do not save it as a billed line.
- Multimeter totals must include both primary and second-meter saved amount fields where applicable.

Billing print rules:
- Firestore is the source of truth for invoice print templates.
- Templates live in `tbl_app_settings/billing_invoice_print_templates_v1`.
- Save the full calibration object, not only partial browser state.
- Keep the portrait-safe right-margin behavior.
- When borrowing ideas from Releasing, preserve Billing's existing save-first and print-enable protections.
- Saved invoices waiting for print must open the real billing calculation by row/month, not only an invoice-number lookup, so staff can print and schedule from the correct context.
- Printed-today/month productivity counts must use explicit print audit fields such as `billing_printed_at` and printer identity; legacy saved/date fields must not be treated as printed because that produces false counts.

Billing grouped-invoice rules:
- Grouped invoice behavior must come from data, not hardcoded customer names. Use `tbl_groupings` for the shared rate/quota and `tbl_groupsum.contract_main_id` for explicit contract membership.
- If a grouping has explicit `tbl_groupsum` members, only those contract-main rows share the invoice/quota; other departments under the same company remain separate.
- If a grouping has no explicit membership rows, preserve the current company-level grouped behavior.
- Shared quota UI must make clear that the quota is for the whole invoice group, not per machine.

Billing protection rule:
- Do not break the live Billing dashboard presentation while fixing other modules.

## Collections Rules
- Collections should be built from the Billing customer set plus all unpaid invoices still requiring follow-up.
- It is acceptable for the web app to contain more rows than the SQL screenshots.
- It is not acceptable for real SQL/Billing customers or unpaid accounts to be missing.
- The SN column must display the actual serial whenever available through contract/machine resolution.
- `Machine ####` is a machine label fallback, not a valid steady-state SN display.
- If the true serial is missing, use an explicit missing-serial label such as `No serial on file`.

Collections grouped-customer rules:
- Some customers are billed with one mother invoice but have many branches/machines that must still be meter-read. These should appear as one clean parent row in the month-to-month matrix, with a `View Branches` expansion for the branch/machine reading breakdown.
- `China Bank Savings - Branches` is the verified example and must be treated separately from similarly named individually billed China Bank Savings customers.
- Verified Firebase identity for the grouped CBS account:
  - `tbl_companylist/72`: `China Bank Savings - Branches`, TIN `000-504-532-000`
  - `tbl_groupings/22`: `CHINABANK`, `company_id = 72`
  - `tbl_branchinfo.company_id = 72`: 224 active branches as of 2026-04-29
- `Metalcast Corporation` is also verified as a one-invoice / multiple-branches grouped Collections account:
  - `tbl_companylist/553`: `Metalcast Corporation`
- Do not group by TIN alone. `China Bank Savings Inc.` and other CBS-like company records share the same TIN but are individually billed and must remain separate rows unless explicitly verified as grouped accounts.
- For grouped accounts, the parent month cell should carry the invoice/payment truth: invoice number badge, OR number badge, payment/partial/no-payment color, and follow-up/payment popup details.
- Expanded branch rows should show the branch/machine meter-reading amount and reading status for audit, but they should not imply separate invoices when the billing workflow creates one mother invoice.
- Historical grouped invoices may have been issued using one random/selected branch as the invoice branch or display name because the old workflow needed an address. In Collections, those invoices still belong to the grouped parent row (`China Bank Savings - Branches`) when their contract/branch resolves under the grouped company.
- Do not let a historical invoice branch name split a grouped account into separate invoice rows. Use branch details only for the expandable reading/audit rows.
- If `tbl_billing.groupings_id` is missing or stale for newer bills, resolve the grouped account from the exact grouped `company_id` and its branch contracts. Treat `tbl_groupings` as a helper, not the only source of truth.
- Current rollback anchor for Collections month-to-month matrix before grouped collapsible work: commit `1683fc9` on `main` plus the recent matrix/payment fixes below it (`d8564c3`, `a128dda`, `3fe81b0`, `99348f1`, `19efa43`, `72d2f10`). Roll back with a forward commit, never by rewriting `main`.

Collections scorecard / totals rules:
- Current accepted correction point: commit `b4f093a` (`Correct collection payment month totals`) on `main`.
- Month-to-month scorecard totals must keep invoice-month and payment-date concepts separate:
  - `Projected Monthly Billing`: billed invoice target plus pending billing projection for the billing month.
  - `Invoice/Billed Total`: invoice/printed billing for that billing month.
  - `Collected Against Billed`: payments applied to invoices billed in that billing month.
  - `Unpaid Receivables`: remaining unpaid balance on invoices billed in that billing month.
  - `Pending Billing Projection`: not-yet-billed projection for that billing month.
  - `Payments Dated This Month`: all actual payment amounts whose payment/OR date falls in that month, even if they pay older invoices.
- Pending billing projection amount must come only from a real meter-reading amount or the active contract quota/fixed monthly rate. Do not use a broad historical billed-total fallback because it can overstate projections badly.
- Known correction reference: April 2026 briefly showed an incorrect projected monthly billing of about `₱8.3M`; that was considered wrong because normal monthly billing is closer to the `₱2.5M` range. The fix removed the aggressive historical fallback and added the separate `Payments Dated This Month` row.
- If totals regress, inspect `collections/js/collections.js` `buildCollectorMatrixTotalRows()` and `getCollectorPendingBillingProjection()`, and confirm `netlify/functions/openclaw-billing-cohort.js` collection compact rows still include `billing_profile`.

Collections matrix usability rule:
- The month matrix must be horizontally reachable on live desktop and mobile.
- Native scrollbar, custom drag bar, arrow buttons, mouse drag, trackpad movement, or touch swipe are all acceptable only if they work clearly on the live page.
- A local mock is not enough; verify against the deployed page behavior.

Collections payment and 2307 rules:
- Never infer 2307 from a remaining balance. A balance can be a real payment deficit, so 2307 must come from an explicit deduction type/amount.
- Payment tracking should separate:
  - actual money received
  - deduction type
  - deduction amount
  - 2307 form status
  - computed remaining balance
- For `deduction_type = 2307`, save the deducted amount into `tax_2307` for legacy compatibility and track form status separately.
- 2307 deducted can close the invoice balance even when the form is still pending.
- Pending 2307 form is a document follow-up item, not an unpaid-balance state.
- When the 2307 form is marked submitted, remove it from pending 2307 follow-up lists while keeping the submitted status in payment history.
- Photo attachment for 2307 forms is useful but should be added after status tracking is stable.

## Service Rules
- Service should use the same Active Contract Customer Graph for customer, branch, machine, and serial identity.
- Service must not use raw `tbl_machine.client_id` as the customer source of truth.
- Model display should prefer the corrected contract/machine resolver and avoid old mismatched helper paths.
- Service Dispatch has a `Service Progress` map for field staff visibility.
- Service Progress map rules:
  - center first on MARGA Office near Havila/Mission Hills, Antipolo
  - display the MARGA Office marker and 15-mile service radius
  - keep initial load light; do not render scheduled-client fallback pins as map markers by default
  - use `tbl_field_visit_events` for live staff GPS updates; Service Progress still reads old `marga_field_visit_events` rows as fallback
  - stale/no-update display should remain obvious for dispatchers
- Field customer location pinning must not block ticket closure because of optional helper writes:
  - schedule proof should save first
  - branch coordinate update should be best-effort and mark `pending_admin_sync` when rules reject the branch master write
  - frontage/building photo should fall back to compressed schedule data if the helper photo document write is rejected
  - 2026-05-05 production hotfix is local commit `e6b5c0d`; Netlify live deploy is complete, but GitHub push was blocked by credentials and must be pushed later

## Releasing Rules
- Releasing exists as `releasing/` and is live as of 2026-04-23.
- This module is the delivery receipt workflow for service-driven supply and cartridge releases.
- Keep it as its own module/page; do not fold it into Billing, Collections, or Service patches.
- DR Item List rules:
  - quantity requests should expand into separate unit rows
  - rows already added to Create DR should be hidden from DR Item List
  - if a request qty is 3 and the user adds 1 unit, the other 2 should remain available
- Create DR rules:
  - right-click ready row -> `Add to DR`
  - right-click Create DR row -> `Send back to DR Item List`
  - `Clear` is manual and should be the only action that wipes Create DR
  - after `Print and Save`, rows should stay in Create DR until Clear
- Firebase write path currently expected:
  - `tbl_finaldr` for DR header
  - `tbl_newfordr` for released item rows and source-row updates/splits
  - `tbl_schedule` for `releasing_pending_qty` / `releasing_dr_done` on schedule-only rows
- Releasing print rules:
  - print window should open immediately on click to avoid popup blocking
  - print adjustment templates should persist locally and sync to `tbl_app_settings/releasing_dr_print_templates_v1`
  - if the same payload is printed again, avoid duplicating the save
- Releasing pull-out rules:
  - the Pull Out Form is available for machines, cartridges, and parts staged in Create DR
  - machine `Change unit` delivery receipts must be blocked until the Pull Out Form is printed first
  - printing a Change Unit pull-out records the old customer machine as pending return and preserves pulled-out-by, customer representative/released-by, pickup receipt, event date/time, previous customer/branch, and remarks for Receiving follow-up
- Before declaring Releasing fully stable, verify partial-quantity references like `345898` against Firebase after Clear/reload.

## Master Schedule And Field App Rules
- Master Schedule's actual daily route should use `tbl_savedscheds` / `tbl_printedscheds` joined to `tbl_schedule`, not raw `tbl_schedule` alone.
- Printed route is the operational list that field staff carry for the day.
- Field App must default to the current printed route / Today view.
- Field App Carry Over is a secondary tab for:
  - saved/unprinted route jobs assigned to that staff
  - older open assigned service/delivery jobs that still need follow-up
  - pending parts or machine replacement planning
- Field App customer location rules:
  - if a scheduled branch has saved `tbl_branchinfo.latitude` and `tbl_branchinfo.longitude`, staff do not need to pin it again
  - if coordinates are missing, staff must pin the customer location before the schedule can be marked `Finished`
  - pinning must happen from the customer site using device GPS
  - pinning saves coordinates and audit fields to `tbl_branchinfo`
  - pinning patches summary fields on `tbl_schedule`
  - pinning writes an event to `marga_field_visit_events`
  - pinning must include a frontage/building photo so the office can recognize the customer location
  - frontage photos should be compressed before saving and should not remain in the phone gallery when a direct-camera flow is later added
- Planned Field App action-based tracking:
  - `On the Way` saves staff GPS and time
  - `Arrived` saves GPS/time and should enforce morning arrival proof
  - `Check Out` saves GPS/time when leaving the customer
  - `Completed` saves GPS/time and proof photo
  - first-arrival lateness rule: Metro Manila clients by 8:00 AM, province clients by 9:00 AM
- Keep Today fast. If Carry Over scanning becomes slow, move the historical lookup into a backend endpoint instead of blocking initial render.
- Daily printed schedule format should remain close to VB.NET:
  - grouped/page-broken by staff
  - `TIN #`, `Customer / Branch`, `Purpose`, `Model`, `Trouble`, `City`, `Address`, `Days Pending`, `Ready`, `Assigned To`

## General Production Rules
- General Production exists as `general-production/` and is live as of 2026-04-22.
- This module is the production planning dashboard for machine requests and machine readiness.
- Keep it as its own module/page and navigation entry; do not mix it into Billing, Collections, Service, or Master Schedule patches.
- Keep the UI operational/dense rather than marketing-style.
- Status source should prefer `tbl_newmachinestatus`; fallback status IDs are allowed only as a defensive UI fallback.
- Before office rollout, verify each source-table mapping against live SQL/Firebase rows.
- Current live General Production commits:
  - `e835737` `Add General Production module`
  - `c96f4de` `Tune General Production legacy counts`
  - `c338d13` `Fix General Production machine checker serials`
  - `e64e5b6` `Use billing serials in machine checker`
- Live URL: `https://margaapp.netlify.app/general-production/`

General Production dashboard panels:
- `Machine Requests`: customer machine-change requests coming from Service.
- `For Termination / Upgrade`: service-driven termination/upgrade requests.
- `Source: To Purchase`: machines that must be bought, from purchase request flow.
- `Source: From Overhauling`: machines coming from office/overhauling that can satisfy requests.
- `Machine Ready`: overhauled or brand-new machines ready to deliver.
- `For Overhauling`: returned field machines no longer tied to a customer; future General Inventory should feed this when returned machines are received.
- `Under Repair`: machines assigned to a technician and currently being overhauled.

## Receiving Rules
- Receiving is a standalone inbound module and should not be folded into Machine Checker.
- First pass exists as `receiving/`.
- Receiving is the office control point for:
  - customer machine pullouts
  - returned machine receipt
  - return cartridges
  - purchased machines
  - supplies and materials received
  - parts/materials returned by technicians
- Old customer-machine pullout:
  - mark the old machine as `return_status = pending_return`
  - store pulled-out-by, pullout date/time, pickup receipt, customer representative, previous customer/branch, and remarks
  - clear the active customer link from the machine master so it no longer appears actively assigned to that customer
  - do not set `status_id = 7` yet; it is in transit, not office-received
- Office receipt of returned machine:
  - Receiving confirms serial and receipt details
  - then set `status_id = 7` / `FOR OVERHAULING`
  - write app audit fields and `tbl_newmachinehistory` where possible
- Replacement machine flow:
  - General Production allocation sends the replacement machine to Releasing
  - Releasing print/save prepares pending customer-machine link fields only
  - driver/logistics closure later confirms the replacement machine as the active customer machine
  - paper DR alone must not be treated as final customer-machine confirmation

Machine Checker behavior:
- Button on General Production near refresh controls.
- Status Changer section:
  - custom searchable serial dropdown
  - model display/dropdown
  - status dropdown
  - save changes to the confirmed machine status source
- Add New Machine section:
  - brand
  - model
  - serial
  - brand new / second hand
  - DP/date
  - save as new machine in `tbl_machine` with source fields for General Production review
- Status labels observed in the VB.NET screenshot include:
  - `IN STOCK`
  - `FOR DELIVERY`
  - `DELIVERED`
  - `USED / IN THE COMPANY`
  - `JUNK`
  - `FOR OVERHAULING`
  - `UNDER REPAIR`
  - `FOR PARTS`
  - `FOR SALE`
  - `TRADE IN`
  - `OUTSIDE REPAIR`
  - `MISSING`
  - `OLD`
  - `UNDER QC`
  - `N/A`
  - `Delivered (No Contract/To Receive)`
- Machine Checker identity rule:
  - Load Billing matrix rows from `openclaw-billing-cohort` first, because Billing has the accepted real serial/customer context.
  - Fall back to `tbl_machine` for machines not represented in Billing.
  - Bind the selected serial to the exact `tbl_machine.id` before saving status/model.
- Known Machine Checker data mismatch example:
  - `E80726L3H798535` is `tbl_machine/3482`, `DCP-T720DW`, `status_id: 2`.
  - `tbl_newmachinestatus/2` is `FOR DELIVERY`.
  - Billing has active contract `tbl_contractmain/5481` for Five Star Global Logistics Inc., branch `3635`.
  - Machine history `tbl_newmachinehistory/22004` also says `status_id: 2`, remarks `For Delivery`.
  - Conclusion: status is a real machine-master value, but the data is stale/inconsistent because the active billing contract exists.
  - Future improvement: show a warning when active billing contract exists but machine master status remains `FOR DELIVERY`.

Production board workflow:
- Double-clicking a `For Overhauling` machine row should open an assigned-tech modal, patch `tbl_machine.status_id` to `8`, and display the machine under `Under Repair` with the tech name.
- Double-clicking an `Under Repair` machine row should open a ready confirmation modal, patch `tbl_machine.status_id` to `1`, and display the machine under `Machine Ready`.
- Keep these transitions scoped to `tbl_machine` until a dedicated production job/history table is introduced.

## APD And Petty Cash Rules
- APD and Petty Cash are separate workflows and should not be mixed into Billing/Collections patches.
- Keep finance workflow changes isolated from customer/billing resolver work.
- Shared chart-of-accounts logic may be reused carefully, but data/workflow risk must stay separated.

## Sync Rules
- The old SQL system remains the business source of truth during migration.
- Sync work and operational UI work should not be mixed casually in the same patch.
- Do not change sync direction rules just because a UI page is wrong.

## UX Principles
- Default views should be department-scoped.
- Actions must be obvious on desktop and mobile.
- No critical controls should depend on hidden hover-only or OS-specific scroll behavior.
- If a table is too wide, the app must provide a clear and usable way to reach the off-screen columns.
- Accepted month-matrix pattern from Collections:
  - move the whole sheet horizontally rather than freezing RD/SN/Customer/Branch
  - show visible left/right and `Latest` controls above the matrix
  - auto-position near current/newer months while preserving access to older months
  - keep `Total` as the far-right terminal column

## Current Known Live Status
From the latest confirmed module checks:
- 2026-06-01: DigitalOcean managed Postgres is currently patched with API pool limits and indexes, but the strategic direction is to plan a return to owner-controlled local production Postgres/Margabase before expanding customer portal or AI Staff usage.
- Next user-requested work is the Customer module.
- Collections month-to-month matrix scroll format is accepted by the user.
- User likes it more than Billing's current month-to-month format.
- Preserve this format for Collections and consider it for a future Billing matrix update.
- Master Schedule/Field App daily printed-route alignment was checked for Crispin on 2026-04-22:
  - Field App showed 15 printed tasks.
  - The same 15 schedule IDs existed in Master Schedule printed-route data.
  - Field App also has a secondary Carry Over tab for planning follow-up work.
- Service Progress map is live in Service Dispatch:
  - centered on Havila/Antipolo office
  - 15-mile radius
  - visible `MARGA Office` marker
  - awaits live staff GPS events from Field App action buttons
- Field App now blocks Finish for branches with no saved coordinates until staff pin the customer location and add a frontage/building photo.
- General Production is live and deployed; Machine Checker serial search now uses Billing serial truth first.
- Correct site is `https://margaapp.netlify.app` with two `p`s.

## Safe Next Work Sequence
1. Start next session by reading `HANDOFF.md` and this `MASTERPLAN.md`.
2. Plan the local production Postgres/Margabase return before adding more customer-facing or AI Staff traffic.
3. Keep the DigitalOcean production patch in place only as a stabilizer while the local-server plan is prepared and tested.
4. Continue the Customer module in `customers/`; do not start from scratch.
5. Verify Customer module grouping against the Active Contract Customer Graph and Billing matrix rows:
   - company/branch grouping
   - active contract membership
   - machine/model/serial display
   - billing information/profile details
6. Preserve Billing, Collections, Master Schedule, Field App, and General Production behavior while changing Customers.
7. If returning to General Production later, add active-contract vs machine-master-status mismatch warnings.
8. Optional General Production tuning remains:
   - Service machine request / change-unit / termination-upgrade signals
   - purchase request data feeding `Source: To Purchase`
   - `tbl_newmachinestatus` and `tbl_machine.status_id`
   - overhauling/repair assignment tables or conventions
9. Keep Today vs Carry Over Field App behavior intact.
10. Preserve the accepted Collections month-matrix format.
11. If Billing matrix UX is changed later, port the Collections format carefully and keep Billing save/print behavior protected.
12. Re-verify Billing presentation after any Billing matrix changes.
13. If continuing field tracking, add the action-based GPS buttons and keep Service Progress map load light.

## Rollback Reference
- `8df832d`: current protected Billing baseline
- `9d2e0ae`: Billing search spacing normalization
- `071ecc4`: Billing search refresh stability
- `a277f95`: multimeter color previous-reading prefill
- `936c588`: mother company details for grouped prints
- `77ff141`: older rollback reference only

## Documentation Rule
- Root `HANDOFF.md` and root `MASTERPLAN.md` are now the only canonical planning documents.
- `docs/HANDOFF.md` and `docs/MASTERPLAN.md` have been retired to avoid split truth.
- Historical release notes remain in `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/CHANGELOG.md`.
