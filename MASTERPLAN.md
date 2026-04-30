# MARGA Masterplan

Last Updated: 2026-04-29
Canonical Status: Single source of truth for product strategy, guardrails, and migration rules

Read first in every new Marga-App thread:
1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`

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
- Do not group by TIN alone. `China Bank Savings Inc.` and other CBS-like company records share the same TIN but are individually billed and must remain separate rows unless explicitly verified as grouped accounts.
- For grouped accounts, the parent month cell should carry the invoice/payment truth: invoice number badge, OR number badge, payment/partial/no-payment color, and follow-up/payment popup details.
- Expanded branch rows should show the branch/machine meter-reading amount and reading status for audit, but they should not imply separate invoices when the billing workflow creates one mother invoice.
- Historical grouped invoices may have been issued using one random/selected branch as the invoice branch or display name because the old workflow needed an address. In Collections, those invoices still belong to the grouped parent row (`China Bank Savings - Branches`) when their contract/branch resolves under the grouped company.
- Do not let a historical invoice branch name split a grouped account into separate invoice rows. Use branch details only for the expandable reading/audit rows.
- If `tbl_billing.groupings_id` is missing or stale for newer bills, resolve the grouped account from the exact grouped `company_id` and its branch contracts. Treat `tbl_groupings` as a helper, not the only source of truth.
- Current rollback anchor for Collections month-to-month matrix before grouped collapsible work: commit `1683fc9` on `main` plus the recent matrix/payment fixes below it (`d8564c3`, `a128dda`, `3fe81b0`, `99348f1`, `19efa43`, `72d2f10`). Roll back with a forward commit, never by rewriting `main`.

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
  - use `marga_field_visit_events` for live staff GPS updates
  - stale/no-update display should remain obvious for dispatchers

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
2. Continue the Customer module in `customers/`; do not start from scratch.
3. Verify Customer module grouping against the Active Contract Customer Graph and Billing matrix rows:
   - company/branch grouping
   - active contract membership
   - machine/model/serial display
   - billing information/profile details
4. Preserve Billing, Collections, Master Schedule, Field App, and General Production behavior while changing Customers.
5. If returning to General Production later, add active-contract vs machine-master-status mismatch warnings.
6. Optional General Production tuning remains:
   - Service machine request / change-unit / termination-upgrade signals
   - purchase request data feeding `Source: To Purchase`
   - `tbl_newmachinestatus` and `tbl_machine.status_id`
   - overhauling/repair assignment tables or conventions
7. Keep Today vs Carry Over Field App behavior intact.
8. Preserve the accepted Collections month-matrix format.
9. If Billing matrix UX is changed later, port the Collections format carefully and keep Billing save/print behavior protected.
10. Re-verify Billing presentation after any Billing matrix changes.
11. If continuing field tracking, add the action-based GPS buttons and keep Service Progress map load light.

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
