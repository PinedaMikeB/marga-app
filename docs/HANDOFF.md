# MARGA Handoff (Single Source of Truth)

Last Updated: 2026-04-15  
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
- Protect the current Billing dashboard print/save baseline before adding any new Billing logic.
- Treat commit `e9338ab` as the protected Billing snapshot for the save-first workflow, invoice lookup, and RTP/RTF print layout.
- Keep Marga App implementation inside the `Marga-App` repo/thread. If a chat is in `marga-biz`, stop and redirect before editing app code.
- Keep the dual-lane office sync reliable after downtime or network loss.
- Treat live MySQL as the business source of truth for office, finance, customer, machine, and contract records.
- Keep APD and Petty Cash aligned on one shared chart-of-accounts source while petty cash stays read-only for account maintenance.

## Next Actions
- Continue Marga-App work in the Marga-App thread, not a `marga-biz` SEO/site thread.
- Confirm Billing behavior at commit `e9338ab` after Netlify finishes deploying.
- For invoice print tuning, adjust through the Billing modal, click `Save Template`, refresh, and verify the template reloads from Firebase.
- If Billing still errors, inspect the live Billing API payload, runtime path, and Firestore data before doing more rollbacks.
- Do not reapply April 7 to April 15 Billing commits blindly.
- Restart the office supervisor so commit `b9246e2` recovery logic is the code actually running on the PC.
- Verify both lanes recover automatically after temporary outage and catch up missed rows.
- Design Collections web flows against the existing SQL-originated collection/payment lifecycle.
- Add clearer office-friendly wording to the sync supervisor UI.
- Define APD chart-of-accounts labels and transaction classes so liabilities, assets, transfers, and expenses are not mixed.
- Keep APD and Petty Cash as separate workflows with different controls, approvals, and reports.
- Identify which legacy SQL tables hold check voucher, check printing, supplier payable, and OR reference history before any finance writeback is proposed.
- Verify petty cash daily report and replenishment printouts with finance users, then map the approved workflow to legacy petty cash tables.

## Open Questions
- For Billing UI, which pages are read-only mirrors first, and which actions are allowed later as controlled writeback?
- For Collections UI, should follow-up entries from web go directly to `tbl_collectionhistory` only, or also stage in Firebase for review?
- Should the sync supervisor auto-run at Windows login only, or do you want a stricter Windows Task Scheduler bootstrap with admin setup?
- For APD, will phase 1 allow check printing only, or should bank-transfer disbursements also exist later under the same control register?
- For savings deposits and owner withdrawals, do you want the system to distinguish company cash transfer versus owner draw explicitly?
- Which legacy SQL tables currently store check-series control, supplier installments, and official receipt references after payment?

## Module Status Board
| Module | Status | Current State | Next Step |
| --- | --- | --- | --- |
| Service Dispatch | In Progress | Printed-route behavior now mirrors legacy more closely and field close/time writeback works. | Continue exact legacy parity checks for route status/count summaries. |
| Field App (Tech/Messenger) | In Progress | Time in/out, finish, pending, signer, meter, notes, and safe writeback are live. | Add photo upload and admin queue UX. |
| Billing | In Progress | Save-first billing modal, invoice lookup/delete controls, and RTP/RTF print preview/layout calibration are live on `main`. | Protect current behavior, keep templates in Firebase, and test one customer/month before broad logic changes. |
| Collections | In Progress | Base records exist, but workflow design still needs stricter SQL parity. | Design queue, follow-up, and payment visibility against legacy semantics. |
| Accounts Payable & Disbursement | In Progress | Working APD prototype page exists with shared account glossary, payable intake, and check register control board. | Connect the APD prototype to real legacy finance tables after SQL mapping review. |
| Petty Cash | In Progress | Working petty cash prototype page now exists with read-only shared chart-of-accounts selection, daily ledger entry, printable day report, and replenishment request drafting. | Validate office wording and map the approved petty cash workflow to legacy SQL tables. |
| Customers | In Progress | Customer/branch master data now included in office sync coverage. | Continue data quality review and inactive-state parity. |
| Machines | In Progress | Machine/model/brand are included in office sync coverage. | Verify delivery/service screens only use synced machine master rows. |
| Contracts | In Progress | Contract tables are included in office sync coverage. | Use synced contract state as prerequisite for billing/service design. |
| Settings/Auth | In Progress | Role-aware login exists. | Add explicit module-access matrix UX. |
| Sync Updater | In Progress | Dual-lane supervisor exists, restart shortcuts exist, and recovery logic is improved. | Validate outage recovery and extend coverage to billing/collections/payments. |

## Session Log (Top First)
### 2026-04-15 - Billing Save And Invoice Print Calibration
- Built and pushed the current Billing save-first workflow and print-layout baseline through commit `e9338ab`.
- Current protected Billing baseline:
  - save billing first before printing
  - print button enables only when modal values match the saved billing snapshot
  - target month cell should show the saved billing after save
  - invoice lookup/search remains available to trace invoice numbers before delete/cancel
  - invoice numbers must stay unique
- Added RTP and RTF invoice print preview/print support for preprinted invoice paper.
- Added calibration controls for:
  - paper side A/B, orientation, scale
  - left margin `offsetXmm`, top margin `offsetYmm`, and right-side printable allowance `rightMarginMm`
  - section x/y/font-size for Header, Service Block, Date/Terms, and Totals
  - totals amount width, horizontal fit, right padding, and final amount size
- Print-template source of truth is Firebase:
  - collection: `tbl_app_settings`
  - document: `billing_invoice_print_templates_v1`
  - field: `templates_json`
  - active template field: `active_template_name`
- `Save Template` must save all layout fields to Firebase, including top margin, left margin, right margin, scale, paper size, orientation, and section settings.
- Chrome/localStorage is only a cache/fallback/migration source and must not be the only durable copy.
- Preserve the portrait-safe right-margin clamp so adding right-side paper space does not make Chrome switch back to landscape.
- Operational reminder:
  - Chrome print preview must have `Headers and footers` turned off
  - keep app `@page` margin at `0`
  - use the Billing modal dropdown to load `Invoice RTP` or `Invoice RTF`; do not recalibrate from scratch if a template exists
- Thread/repo protection:
  - this work belongs in `Marga-App`
  - if the user asks for Marga App work inside a `marga-biz` thread, stop and redirect before editing

### 2026-04-15 - Billing Rollback Protection
- Traced Billing rollback points from chat history and git history instead of doing blind resets.
- Identified that the April 13 rollback target was not the last stable user-confirmed state.
- Restored Billing dashboard files to the April 6-equivalent snapshot and pushed commit `77ff141`.
- Important protection note for next threads:
  - treat `77ff141` as the protected Billing baseline
  - do not casually reapply April 7 to April 15 Billing commits
  - if Billing fails again, inspect live function payload/runtime behavior before changing history
- Verified Petty Cash module files were not removed by the Billing rollback.
- Current Petty Cash caveat:
  - the Billing page sidebar no longer shows the `Petty Cash` nav link because Billing was rolled back to an older shell
  - the Petty Cash module itself still exists

### 2026-04-08 - Petty Cash Prototype Build
- Added a working `/pettycash/` module with:
  - shared chart-of-accounts selection reused from APD
  - no account add/edit/remove controls for petty cash users
  - petty cash entry form with description or remarks field
  - printable daily petty cash report for the selected date
  - replenishment request drafting, request history, and printable replenishment sheet
- Linked Petty Cash into dashboard tiles, finance navigation, and settings module routing.
- Moved shared finance accounts into `/shared/js/finance-accounts.js` so APD and Petty Cash read the same local chart-of-accounts list.

### 2026-03-28 - APD Prototype Build
- Added a working `/apd/` module with:
  - shared chart-of-accounts reference for encoders
  - manual payable intake for invoice and SOA planning
  - check register and disbursement control with skipped or voided reason tracking
- Refined APD layout so instructions and reference stay collapsed by default and the main workspace uses four tabs:
  - Payable Intake
  - Payables Planner
  - Check Register Entry
  - Disbursement Register
- Added dashboard-first APD flow:
  - monthly payables matrix is now the landing view
  - workspace opens from a dedicated button or by clicking a payable amount
  - recurring plans can auto-generate monthly payables for loans, card payments, tuition, and copied utility bills
- Added `/docs/APD-PC-CHART-OF-ACCOUNTS.md` as a plain-language finance reference for APD and future petty cash users.
- Linked APD into dashboard navigation, settings navigation, and billing navigation.
- Updated module registry defaults so APD now points to a real route.
- Added APD account-list management inside the page so users can view, add, edit, and remove chart-of-accounts entries from one modal, with delete protection for accounts already used by payables.
- Added a simplified loan workflow in APD payable intake:
  - `Simple Loan Mode` keeps one monthly amount when the principal-interest split is still unknown
  - `Breakdown Pending` flags loans that still need lender schedule detail later
  - principal, interest, and penalty entry fields stay hidden unless the user turns off simple mode
- Added an APD status-guide popout so encoders can open the meaning of `Draft`, `For Approval`, `Approved for Payment`, `For Check Printing`, `Printed`, `Released`, `Cleared`, and `Voided` from the payable form and planner.
- Adjusted APD payable save flow so new or edited payables return to the dashboard immediately, shift the dashboard month window to the saved due date, and confirm how many monthly entries were created for recurring plans.
- Corrected APD dashboard summary logic so it now shows `Paid` amounts and computes `Net Payables = Total Payables - Paid`, while the matrix keeps non-voided payables visible and marks fully paid cells differently.
- Tightened APD payment-state rules so only `Cleared` counts as paid/closed in dashboard totals and cell coloring; `Released` and `Printed` remain visible as still-open obligations until the supplier deposits and the check clears.
- Added recurring-series edit control in APD payable intake so when a user opens a saved series item they can choose to apply corrections to `this month only` or `this and future months` in the same series; amount and other shared details now cascade forward when that option is checked.
- Added shared finance account `Loan Amortization - Lending Institution` as an APD liability account for simplified one-check payments to non-bank lenders like Esquire, and updated the generic `Loan Amortization` preset to use it by default.
- Added APD `Bi-Monthly PDC` payment-plan support so loans like Esquire can generate two post-dated-check payables per month using the main due date plus an additional PDC date in the same month.
- Refined APD `Bi-Monthly PDC` input so users can now enter separate first-check and second-check amounts, not just two dates; editing one saved bi-monthly entry now updates both checks for that month and can still cascade forward through the series.

### 2026-03-28 - APD And Petty Cash Planning Thread
- Added initial finance design guidance for separate APD and Petty Cash modules.
- Documented suggested chart-of-accounts labels for fuel, rental supplies, bank loans, supplier installments, payroll, utilities, facility repairs, motorcycle repairs, government contributions, machine purchases, petty cash, and savings transfers.
- Added `apd` to built-in module defaults so permissions can treat APD separately from Billing and Petty Cash.
- Captured key accounting guardrails for the next finance build:
  - loan principal is a liability payment, not an expense
  - machine purchases for rental are fixed assets, not ordinary expense
  - petty cash releases and bank transfers are fund movements until liquidated
  - owner withdrawals must not be posted as company operating expense

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

### Accounts Payable And Disbursement (APD)
Done:
- Initial APD versus Petty Cash split is documented.
- Suggested account labels are captured in `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/APD-PC-MODULE-DESIGN.md`.
- Shared encoder reference is captured in `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/APD-PC-CHART-OF-ACCOUNTS.md`.
- APD prototype page now exists at `/Volumes/Wotg Drive Mike/GitHub/Marga-App/apd/index.html`.

In Progress:
- Planning manual invoice/SOA entry, due-date monitoring, check voucher flow, check printing control, and OR capture against real legacy records.

Risks:
- Principal loan payments, machine purchases, bank transfers, and owner withdrawals must not be posted as ordinary expense lines.
- Finance-sensitive posting should remain `MySQL -> Firebase` first until legacy table mapping is clear.

### Petty Cash
Done:
- Legacy petty cash tables are already identified in sync coverage.
- The workflow is explicitly separated from APD and check issuance.

In Progress:
- Planning petty cash voucher, liquidation, replenishment, and transfer tracking.

Risks:
- Petty cash movements can be misclassified if releases, liquidation lines, and fund transfers are mixed in one transaction type.
- Personal withdrawals must be tracked separately from business expenses.

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
