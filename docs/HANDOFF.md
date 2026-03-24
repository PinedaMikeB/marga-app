# MARGA Handoff (Single Source of Truth)

Last Updated: 2026-03-18  
Owner: Marga App Team

This file is the canonical session-to-session handoff.
Each thread should update only the relevant module sections plus `Current Focus`, `Next Actions`, and `Session Log`.

## How To Update Per Thread
1. Update `Last Updated`.
2. Add one entry to `Session Log` at the top.
3. Update only affected module blocks.
4. Keep `Current Focus`, `Next Actions`, and `Open Questions` current.
5. Do not rewrite legacy-history sections unless they are wrong.

## Current Focus
- Keep the dual-lane office sync reliable after downtime or network loss.
- Treat live MySQL as the business source of truth for office, finance, customer, machine, and contract records.
- Prepare the next thread to design Collections and Billing against mirrored Firebase data without changing MySQL schema or workflow semantics.

## Next Actions
- Restart the office supervisor so commit `b9246e2` recovery logic is the code actually running on the PC.
- Verify both lanes recover automatically after temporary outage and catch up missed rows.
- Design Collections web flows against the existing SQL-originated collection/payment lifecycle.
- Design Billing web flows against existing invoice/unpaid/DR lifecycle, not against new ad hoc web-only states.
- Onboard Tier 1 billing and collection tables into executable sync manifest after UI/data-flow design is agreed.
- Add clearer office-friendly wording to the sync supervisor UI.

## Open Questions
- For Billing UI, which pages are read-only mirrors first, and which actions are allowed later as controlled writeback?
- For Collections UI, should follow-up entries from web go directly to `tbl_collectionhistory` only, or also stage in Firebase for review?
- Should the sync supervisor auto-run at Windows login only, or do you want a stricter Windows Task Scheduler bootstrap with admin setup?

## Module Status Board
| Module | Status | Current State | Next Step |
| --- | --- | --- | --- |
| Service Dispatch | In Progress | Printed-route behavior now mirrors legacy more closely and field close/time writeback works. | Continue exact legacy parity checks for route status/count summaries. |
| Field App (Tech/Messenger) | In Progress | Time in/out, finish, pending, signer, meter, notes, and safe writeback are live. | Add photo upload and admin queue UX. |
| Billing | Planned | No rebuilt workflow yet; must follow SQL-originated invoice logic. | Design UI against synced billing data and office process rules. |
| Collections | In Progress | Base records exist, but workflow design still needs stricter SQL parity. | Design queue, follow-up, and payment visibility against legacy semantics. |
| Customers | In Progress | Customer/branch master data now included in office sync coverage. | Continue data quality review and inactive-state parity. |
| Machines | In Progress | Machine/model/brand are included in office sync coverage. | Verify delivery/service screens only use synced machine master rows. |
| Contracts | In Progress | Contract tables are included in office sync coverage. | Use synced contract state as prerequisite for billing/service design. |
| Settings/Auth | In Progress | Role-aware login exists. | Add explicit module-access matrix UX. |
| Sync Updater | In Progress | Dual-lane supervisor exists, restart shortcuts exist, and recovery logic is improved. | Validate outage recovery and extend coverage to billing/collections/payments. |

## Session Log (Top First)
### 2026-03-18 - Sync Supervisor Recovery And Billing/Collections Prep
- Added dual-lane local supervisor with desktop launch shortcuts:
  - `Start Marga Sync`
  - `Open Marga Sync Monitor`
- Fixed field close and `tbl_schedtime` writeback so service execution can write back to existing MySQL tables without schema changes.
- Confirmed field close test for Zontar wrote back to SQL (`tbl_schedule` + `tbl_schedtime`).
- Improved outage recovery in commit `b9246e2`:
  - lane 1 now treats `tbl_schedtime` as mutable from MySQL
  - lane 1 gives `tbl_schedule` a periodic full refresh
  - lane 2 now queries Firebase by recovery window based on last successful sync, with overlap
- Confirmed Hener `2026-03-18` counts matched live SQL again after recovery:
  - printed `8`
  - closed `3`
  - pending `5`
  - cancelled `0`
- Current important operational note:
  - code is pushed, but the office supervisor process must be restarted once to load the new recovery logic.

### 2026-03-16 - Sync Direction Rules And Live Coverage
- Added `/docs/MASTER-SYNC-COVERAGE.md` based on the live MySQL schema.
- Fixed live MySQL -> Firebase service route sync to catch updates to existing printed/saved route rows, not only new IDs.
- Confirmed service route close counts now align between MySQL and Firebase after mutable-row refresh.
- Defined business-direction rules below so handoff is clear on what should be `MySQL -> Firebase` versus limited `Firebase -> MySQL`.

### 2026-02-16 - Documentation Standardization
- Established canonical handoff in `/docs/HANDOFF.md`.
- Converted handoff model to module-based updates for thread-specific focus.

### 2026-02-12 - Field Modal Expansion
- Field update modal expanded for technician workflow:
  - searchable serial selection + missing serial flow
  - model/brand, machine status, parts list + qty
  - meter and time capture, delivery and acknowledgement sections
  - save draft, pending, and finished actions with PIN close
- Added queue writes for pending parts and serial correction requests.

## Sync Status

### Supervisor
- Local URL: `http://127.0.0.1:4310`
- Launcher files:
  - `D:\Codex\Github\marga-app\local-sync\start-dashboard-hidden.vbs`
  - `D:\Codex\Github\marga-app\local-sync\start-dashboard.ps1`
  - `D:\Codex\Github\marga-app\local-sync\start-dashboard.cmd`
  - `D:\Codex\Github\marga-app\local-sync\open-dashboard.cmd`
- Desktop shortcuts:
  - `C:\Users\pc\Desktop\Start Marga Sync.lnk`
  - `C:\Users\pc\Desktop\Open Marga Sync Monitor.lnk`

### Lane 1: MySQL -> Firebase
- Purpose:
  - keep Firebase and web apps current from live SQL
- Main script:
  - `D:\Codex\Github\marga-app\local-sync\run-live-mysql-to-firebase.mjs`
- Current behavior:
  - incremental by watermark for append-style tables
  - mutable rescan for tables with timestamp columns
  - periodic full refresh for selected no-timestamp tables
  - linked `tbl_schedule` refresh when printed/saved route rows change

### Lane 2: Firebase -> MySQL
- Purpose:
  - write approved field/web operational updates back into existing MySQL tables
- Main script:
  - `D:\Codex\Github\marga-app\local-sync\run-local-sync.mjs`
- Current behavior:
  - build a live SQL baseline
  - fetch Firebase operational rows from a recovery window based on last successful sync
  - diff against SQL baseline
  - apply safe updates/inserts only

### Current Safe Reverse Bridge Scope
- `tbl_schedule`
- `tbl_schedtime`
- `tbl_collectionhistory`
- optional `tbl_closedscheds`

### Current Important Constraint
- The sync design is hybrid, not fully free two-way.
- Most office and finance transactions remain `MySQL -> Firebase`.
- Only approved field-operational rows or safe columns may go `Firebase -> MySQL`.

## Guidance For The Next Collections And Billing Thread

### Non-Negotiables
- Do not change MySQL schema.
- Do not rename or drop existing MySQL tables/columns.
- Do not invent new office master-data workflows in Firebase first.
- Treat legacy SQL/VB.NET semantics as authoritative unless explicitly redefined.
- Web should mirror and surface office truth first before adding new writeback actions.

### What The Next Thread Must Assume
- Customers, branches, machines, and contracts are already important upstream dependencies.
- Billing and Collections design must not assume the web app owns invoice, payment, or OR creation.
- Billing staff and collections staff need browser visibility, filtering, and guided workflow, but core finance records still originate in SQL in this phase.
- If a web action is proposed, it must be classified first:
  - SQL-originated mirror only
  - Firebase-first but controlled writeback
  - safe reverse bridge

### Recommended Design Sequence
1. Collections read model
2. Billing read model
3. Collections follow-up workflow
4. Approved payment/follow-up writeback rules
5. Billing operational actions only after exact SQL parity is clear

### Collections Design Guidance
- Source-of-truth tables to design around:
  - `tbl_collectioninfo`
  - `tbl_collections`
  - `tbl_collectionhistory`
  - `tbl_paymentinfo`
  - `tbl_payments`
  - `tbl_paymentcheck`
  - `tbl_depositslip`
  - `tbl_depositsliptransaction`
- Start with:
  - queue visibility
  - aging/follow-up status
  - contact history
  - payment visibility
- Keep writeback limited first to:
  - follow-up history
  - possibly safe status notes
- Do not start by writing principal collection or payment records from web.

### Billing Design Guidance
- Source-of-truth tables to design around:
  - `tbl_billinfo`
  - `tbl_billing`
  - `tbl_invoicenum`
  - `tbl_cancelledinvoices`
  - related DR/final-DR records
- Start with:
  - billing visibility
  - invoice state visibility
  - unpaid monitoring
  - customer/contract/machine linkage
- Do not start by letting the web app create or post invoices directly.
- Billing actions in web should follow exact SQL business rules after the read model is trusted.

### Sync Guidance For That Thread
- Any new table added to sync must be added to `local-sync/sync-manifest.mjs` first.
- Decide per table:
  - `reference_refresh`
  - `append_only`
  - `mutable_with_timestamp`
  - `mutable_no_timestamp`
  - `safe reverse bridge`
- If a table is mutable and has no reliable timestamp, prefer periodic full refresh or domain reconcile.
- If the action is finance-sensitive, default to `MySQL -> Firebase` unless there is a very strong reason otherwise.

## Module Notes

### Service Dispatch
Done:
- Printed-route based task loading now mirrors legacy printed schedules.
- MySQL -> Firebase route refresh catches mutable route rows.

In Progress:
- Fine-grained parity checks with VB.NET daily views.

Risks:
- Route-table and master-ticket semantics are not always identical in legacy.

### Field App (Tech/Messenger)
Done:
- Task list by assignee/date.
- Modal update flow with notes, serial handling, parts, meter, time, signer, PIN-aware finish.
- Time in/out and finish now write through Firebase and back to SQL safely.

In Progress:
- Before/after photo metadata exists, binary upload does not.

Risks:
- Any new reverse-write field must stay within approved SQL columns only.

### Billing
Done:
- No production workflow rebuilt yet.

In Progress:
- Planning only.

Risks:
- Web-side invention of invoice states or posting actions will break SQL parity.

### Collections
Done:
- Baseline records and direction rules are documented.

In Progress:
- Workflow design for queue, follow-up, and payment visibility.

Risks:
- Collections and payment lifecycle are sensitive; keep principal money movement SQL-originated.

### Customers
Done:
- `tbl_companylist`
- `tbl_branchinfo`
- `tbl_branchcontact`
- `tbl_customerinfo`
- `tbl_customertype`
  are onboarded into office sync coverage.

In Progress:
- Inactive-state and contact parity checks.

Risks:
- Branch/contact edits without timestamps rely on periodic refresh strategy.

### Machines
Done:
- `tbl_machine`
- `tbl_model`
- `tbl_brand`
  are onboarded into office sync coverage.

In Progress:
- Delivery/service parity checks against machine master data.

Risks:
- Delivery logic must not assume a machine exists in web if SQL master has not synced yet.

### Contracts
Done:
- `tbl_contractmain`
- `tbl_contractdetails`
- `tbl_contractinfo`
- `tbl_contracthistory`
  are onboarded into office sync coverage.

In Progress:
- Billing/service dependency checks against contract state.

Risks:
- Contract status changes affect downstream billing and service entitlement.

### Sync Updater
Done:
- Dual-lane local supervisor exists.
- Desktop shortcuts exist for office use.
- Service route sync supports mutable route refresh.
- Reverse bridge writes safe service updates and `tbl_schedtime` back to MySQL.
- Recovery logic now scans missed windows after downtime instead of trusting only latest bounded docs.

In Progress:
- Validate restart/recovery behavior in live office use.
- Expand Tier 1 sync coverage to billing, collections, payments, delivery, petty cash, and refill production.

Risks:
- If the office PC restarts and the supervisor is not relaunched, both lanes stop.
- Finance tables are not yet fully onboarded, so web visibility there is still incomplete.

## Transaction Direction Rules

### MySQL -> Firebase Only

These should originate in legacy SQL/VB.NET and be mirrored into Firebase/web:

- new customer / company creation
- branch creation
- customer active / inactive tagging
- branch inactive tagging
- new machine creation
- machine master updates
- contract creation
- contract changes / renewal / termination / shutdown
- new invoice creation
- unpaid invoice / aging status
- collection queue creation from office workflows
- payment posting from office/accounting workflows
- OR / check / deposit records
- delivery receipt creation
- final DR processing
- pullout / machine pickup receipt creation
- petty cash transactions
- toner refill production records
- purchasing / receiving / release records

Reason:

- these are core office and finance transactions
- MySQL remains source of truth
- Firebase should receive them as mirrored operational data

### Firebase -> MySQL Only (Safe Reverse Bridge)

These may originate from the web app and write back to existing MySQL columns:

- field staff work notes
- field staff close / pending service status
- field `schedtime` logs
- meter readings captured in field
- customer signer / contact captured during field visit
- approved collection follow-up logs written from web

Reason:

- these are field-side operational updates
- they fit the current safe reverse-bridge model
- they do not require new SQL schema

### Firebase First, Then Controlled Writeback

These may start in Firebase/web, but only with explicit safe mapping and approval:

- serial correction requests
- parts-needed queue writes
- customer contact corrections
- admin-request style workflows

Reason:

- these are operational workflow items or staging records
- they may need review before touching legacy SQL

### Never Treat As Full Two-Way Free Edit

Do not allow unrestricted bidirectional editing for:

- customer master records
- machine master records
- contracts
- invoices
- payments
- collections principal records
- delivery / DR headers
- petty cash

Reason:

- these can create conflicts between VB.NET and web if both sides freely edit the same business object

### Field Staff Input Rules

Allowed from field app:

- close ticket
- mark pending / parts needed
- enter time in / time out
- enter meter reading
- update signer / contact actually met in field
- request serial correction
- add execution notes

Not allowed as direct master overwrite from field app:

- create new customer
- inactivate customer
- add new machine directly into master machine table
- create contract
- create invoice
- post payment
- issue DR / OR
- create petty cash record

Those should remain:

- office-side SQL transactions
- then mirrored to Firebase
