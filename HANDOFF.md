# MARGA Handoff

Last Updated: 2026-04-22
Canonical Status: Single source of truth for current operational handoff

Start every new Marga-App thread by reading:
1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`

## Current Focus
- Next chat focus: continue the **Customer module** in `customers/`.
- Customer module already exists with `customers/index.html`, `customers/js/customers.js`, `customers/js/customer-form.js`, `customers/css/customers.css`, and `customers/css/customer-form.css`.
- Customer module work must reuse the same Active Contract Customer Graph and serial identity used by Billing/Collections/General Production. Do not invent a separate customer or serial truth.
- General Production is live on Netlify and pushed through commit `e64e5b6`; only remaining General Production work should be targeted verification/tuning, not a rebuild.
- Machine Checker now uses Billing-backed real serials first, then machine master fallback, with custom searchable dropdown and model/status/customer context.
- Protect the working Billing dashboard presentation and save/print workflow before changing shared resolver logic.
- Preserve the accepted Collections month-matrix scroll format; user likes it and may want Billing to adopt it later.
- Collections SN/data display is acceptable in the dashboard as of the latest live check.
- Keep Marga App work inside the `Marga-App` repo/thread. If a chat is in `marga-biz`, stop and redirect before editing app code.

## Current Protected Baselines
- Billing protected baseline: commit `8df832d` `Include multimeter invoice amounts in billing totals`
- Important Billing-support commits still relied on by current behavior:
  - `9d2e0ae` `Normalize billing customer search spacing`
  - `071ecc4` `Stabilize billing customer search refresh`
  - `a277f95` `Prefill color meter prior readings`
  - `936c588` `Use mother company details for grouped prints`
- Current live Collections work already pushed on `main`:
  - `d186537` `Fix collection serials and coverage counts`
  - `ced7667` `Make collections matrix mobile scrollable`
  - `9feab79` `Add collection matrix drag scrollbar`
  - `606509e` `Fix collections month matrix scrolling`
  - `e0d2755` `Harden collections month auto scroll`
  - `dbc320d` `Constrain collections matrix viewport`
- Current live Master Schedule / Field App work already pushed on `main`:
  - `3f3ab9c` `Use route data for master schedule readiness`
  - `caafb64` `Match master schedule print columns to VBNet`
  - `dec0127` `Add carryover tab to field app`
- Current live General Production work already pushed on `main`:
  - `e835737` `Add General Production module`
  - `c96f4de` `Tune General Production legacy counts`
  - `c338d13` `Fix General Production machine checker serials`
  - `e64e5b6` `Use billing serials in machine checker`

## Accepted Collections Matrix Format
Reference the latest accepted live observation:
- Screenshot: `Screenshot 2026-04-21 at 11.56.21 AM.png`

What now works and should be preserved:
- Month matrix moves horizontally with the whole sheet, including RD, SN, customer, branch, months, and Total.
- RD/SN/Customer/Branch are not horizontally sticky in Collections.
- The view auto-anticipates newer/current months, showing windows such as February 2026 through December 2026.
- Left/right arrows and `Latest` controls are visible above the matrix and usable.
- The final right-side column is `Total`, and the user explicitly likes this format.

Future reuse note:
- This Collections matrix format is a candidate for Billing's month-to-month comparison later.
- Do not port it to Billing casually; Billing save/print behavior is protected and must be regression-checked if Billing adopts this layout.

## Non-Negotiable Rules
- Do not break the Billing dashboard presentation while fixing Collections.
- Do not reintroduce old Billing rollback commits blindly.
- Use forward commits on `main`; do not rewrite history for rollback work.
- Do not revert unrelated dirty files in the repo.
- User expects verified Marga App changes to be pushed to `main` so Netlify can deploy automatically.

## Customer Identity And Serial Rule
Canonical customer lookup is the Active Contract Customer Graph:
- `tbl_contractmain` where `status == 1`
- `tbl_contractmain.contract_id` -> `tbl_contractdep.id`
- `tbl_contractdep.branch_id` -> `tbl_branchinfo.id`
- `tbl_branchinfo.company_id` -> `tbl_companylist.id`
- `tbl_contractmain.mach_id` -> `tbl_machine.id`
- serial display from `tbl_contractmain.xserial` first, then `tbl_machine.serial`

Collections and Service must follow this same identity rule whenever possible.
Customers and General Production must follow it too when showing customer, branch, machine, and serial context.

Important Collections SN rule:
- SN must display the actual serial when available.
- `Machine ####` is only a fallback machine label, not an acceptable SN display for normal collection rows.
- If no real serial exists, show a clear missing-serial state such as `No serial on file`, not `Machine ####` inside the SN column.

## Collections Rules
- Collections should use the Billing customer set as the base customer universe.
- Collections must also include unpaid invoices that still need follow-up even if the customer is no longer active for new billing.
- It is okay if the web app has more rows than the SQL screenshots.
- It is not okay if a real SQL/Billing customer or unpaid account is missing from the web workflow.
- The month matrix must be usable on desktop and mobile:
  - mouse drag or visible scrollbar should work
  - trackpad horizontal movement should work
  - touch swipe should work on phone
  - later month columns must be reachable without hidden/guesswork interactions

## Customer Module Rules
- Next user-requested work is Customer module continuation.
- Existing module files:
  - `customers/index.html`
  - `customers/js/customers.js`
  - `customers/js/customer-form.js`
  - `customers/css/customers.css`
  - `customers/css/customer-form.css`
- Customer directory should be based on the Active Contract Customer Graph for active customer/machine context.
- Raw `tbl_companylist` can be used for company profile data, but not as the sole active-customer list.
- Serial display must prefer `tbl_contractmain.xserial`, then `tbl_machine.serial`.
- Existing Customers form has branch/company/machine/contract editing code; treat save behavior carefully and do not casually alter running Billing/Collections code while improving Customers.
- Good next starting point: compare Customer module customer/branch/machine rows against Billing matrix rows and the legacy customer expectations, then fix missing/misgrouped customer details.

## Billing Rules That Must Stay Protected
- Billing calculation modal should save the invoice first.
- Print button should stay disabled until the saved billing snapshot matches the current modal values.
- Invoice numbers must stay unique.
- Billing search must stay spacing/punctuation tolerant.
- Dashboard and invoice lookup totals must include second-meter legacy fields when present.
- Do not disturb the current grouped RTP and multimeter behavior while working on Collections.

## Module Status Board
| Module | Status | Current State | Next Safe Step |
| --- | --- | --- | --- |
| Billing | Protected / In Progress | Working save-first workflow, grouped RTP support, multimeter totals, search stability, Firebase print templates. | Consider adopting the accepted Collections matrix format only after separate Billing regression checks. |
| Customers | Next Focus / In Progress | Existing customer directory and edit form module under `customers/`; loads companies, branches, contracts, contract deps, machines, models, brands, areas, cities, bill info, and recent billed contract ids. | Continue here in next chat; align rows/details with the Active Contract Customer Graph and Billing customer truth. |
| Collections | Accepted / In Progress | Uses Billing-based coverage plus unpaid invoices. Matrix scroll format is accepted live: whole-sheet horizontal movement, visible arrows/Latest, Total at far right. | Preserve this format while continuing Collections parity work. |
| Master Schedule | Accepted / In Progress | Uses `tbl_savedscheds`/`tbl_printedscheds` joined to `tbl_schedule`; print layout is grouped by staff and now matches VBNet columns closely. | Keep daily printed route and carry-over logic aligned with Field App. |
| Field App | In Progress | Default `Today` tab shows printed route; `Carry Over` tab shows saved/unprinted and older open assigned jobs for follow-up/planning. | Keep today route fast; optimize carry-over via backend if the 45-day scan becomes slow. |
| Service | In Progress | Must follow the same customer/serial identity rules as Billing. | Reuse Active Contract Customer Graph carefully. |
| General Production | Live / In Progress | Isolated `general-production/` module is deployed. Dashboard counts tuned to VB.NET screenshot targets. Machine Checker uses Billing-backed real serials with searchable dropdown, model/status/customer context, and add-new-machine form. For Overhauling rows can be double-clicked to assign a tech and move to Under Repair; Under Repair rows can be double-clicked to mark Machine Ready. | Add mismatch warning for active billing contract vs machine master status; continue source-table tuning only when user asks. |
| APD | In Progress | Prototype exists. | Keep separate from Billing/Collections risk. |
| Petty Cash | In Progress | Prototype exists. | Keep separate from Billing/Collections risk. |
| Sync Updater | In Progress | Dual-lane supervisor and recovery work already documented historically. | Keep stable; do not mix sync refactors with UI fixes. |

## Next Actions
1. Start next chat on the Customer module under `customers/`.
2. Read `customers/js/customers.js` and `customers/js/customer-form.js` before editing; preserve user/unrelated dirty changes.
3. Compare Customer rows against Billing/Active Contract Customer Graph:
   - active contracts
   - branch/company grouping
   - machine/model/serial display
   - bill info/profile details
4. Keep Billing, Collections, Master Schedule, Field App, and General Production stable while working on Customers.
5. If revisiting General Production later, add an explicit warning for active billing contract + stale machine-master status, especially cases like `E80726L3H798535`.
6. Continue module work without reverting unrelated dirty files.

## Session Log (Top First)
### 2026-04-23 - General Production Repair Workflow Added
- Added double-click production workflow:
  - Double-click a `For Overhauling` machine row to open an assignment modal.
  - Enter assigned technician name; save patches `tbl_machine.status_id` to `8` and stores `production_assigned_tech` / `assigned_tech_name`.
  - Row moves to `Under Repair` immediately in the dashboard.
  - Double-click an `Under Repair` row to open a ready confirmation modal.
  - Save patches `tbl_machine.status_id` to `1`, clears current assigned tech fields, stores ready audit fields, and moves row to `Machine Ready`.
- Scoped to `general-production/` only.

### 2026-04-22 - General Production Live, Machine Checker Uses Billing Serials
- General Production live URL: `https://margaapp.netlify.app/general-production/`.
- Pushed and deployed:
  - `e835737` `Add General Production module`
  - `c96f4de` `Tune General Production legacy counts`
  - `c338d13` `Fix General Production machine checker serials`
  - `e64e5b6` `Use billing serials in machine checker`
- Correct production site is `https://margaapp.netlify.app` with two `p`s in `margaapp`.
- Dashboard panel counts were tuned to match the VB.NET reference:
  - Machine Requests `99`
  - For Termination / Upgrade `34`
  - Source: To Purchase `3`
  - Source: From Overhauling `2`
  - Machine Ready `27`
  - For Overhauling `432`
  - Under Repair `10`
- Machine Checker now:
  - Uses `openclaw-billing-cohort` / Billing matrix rows first for real serials.
  - Falls back to `tbl_machine` serials for machines not in Billing.
  - Has custom searchable dropdown filtering as the user types.
  - Shows model, status, and customer/branch context.
  - Saves status/model to the exact `tbl_machine` document.
- Verified examples from Billing serial truth:
  - `E80726L3H798535 -> DCP-T720DW -> Five Star Global Logistics Inc.`
  - `E78998E9H371508 -> MFC-J3530DW -> LINFRA CORP.`
- Important data finding:
  - `E80726L3H798535` maps to `tbl_machine/3482`, `status_id: 2`.
  - `tbl_newmachinestatus/2` is `FOR DELIVERY`.
  - It also has active billable contract `tbl_contractmain/5481` for Five Star, branch `3635`.
  - `tbl_newmachinehistory/22004` has `status_id: 2`, remarks `For Delivery`, branch `3635`.
  - Conclusion: app is showing true machine-master status, but data is inconsistent/stale because Billing contract is active while machine master remains `FOR DELIVERY`.
  - Future General Production fix: warn when an active Billing contract exists but machine master status still indicates `FOR DELIVERY`.

### 2026-04-22 - Customer Module Next
- User requested docs update because the next chat will continue the Customer module.
- Existing Customers module should be treated as next focus, not recreated from scratch.
- Important current customer module files:
  - `customers/index.html`
  - `customers/js/customers.js`
  - `customers/js/customer-form.js`
  - `customers/css/customers.css`
  - `customers/css/customer-form.css`
- Next thread should compare Customers rows to Billing/customer graph parity before making UI or save changes.

### 2026-04-22 - General Production First Pass Implemented
- Added isolated `general-production/` module with a dense dashboard inspired by the provided VB.NET screenshots.
- Dashboard panels added:
  - `Machine Requests`
  - `For Termination / Upgrade`
  - `Source: To Purchase`
  - `Source: From Overhauling`
  - `Machine Ready`
  - `For Overhauling`
  - `Under Repair`
- Added top controls: search, All/Laser/Inkjet filter, `Refresh All`, CSV exports, and `Machine Checker`.
- Added Machine Checker modal:
  - Status Changer for existing serial/model/status.
  - Add New Machine form for brand/model/serial/brand-new-or-second-hand/DP date.
- Wired module into Dashboard, Service, Inventory, Settings nav, Settings module registry, and admin/service permissions.
- Status source prefers `tbl_newmachinestatus` and falls back to the confirmed status list from the earlier migration helper.
- Local checks passed:
  - `node --check general-production/js/general-production.js`
  - `node --check shared/js/auth.js`
  - `node --check settings/js/settings.js`
  - `node --check shared/js/utils.js`
  - `git diff --check`

### 2026-04-22 - General Production Planned, Implementation Deferred (Superseded)
- This planning note was superseded later on 2026-04-22 by the live General Production implementation and follow-up commits listed above.
- Next chat should analyze sources before coding:
  - service module records that indicate machine change requests
  - service termination/upgrade signals
  - purchase request sources
  - machine status/status ID tables
  - inventory/returned-machine source for future General Inventory
- Requested Machine Checker behavior:
  - status changer for existing machine serial/model/status
  - add new machine form for brand/model/serial/new-or-second-hand/DP date
  - statuses shown in the screenshot include `IN STOCK`, `FOR DELIVERY`, `DELIVERED`, `USED / IN THE COMPANY`, `JUNK`, `FOR OVERHAULING`, `UNDER REPAIR`, `FOR PARTS`, `FOR SALE`, `TRADE IN`, `OUTSIDE REPAIR`, `MISSING`, `OLD`, `UNDER QC`, `N/A`, and `Delivered (No Contract/To Receive)`.

### 2026-04-22 - Field App Carry Over Tab
- Commit `dec0127` added Field App tabs:
  - `Today` is the default current printed route view.
  - `Carry Over` shows saved/unprinted carry-over work plus older open assigned jobs up to 45 days back.
- For Crispin on 2026-04-22, data check showed 15 Today tasks and 35 Carry Over tasks.
- Today route renders before carry-over scan completes so the field staff default view stays fast.

### 2026-04-22 - Master Schedule And Printed Route Alignment
- Commit `3f3ab9c` made Master Schedule use `tbl_savedscheds` / `tbl_printedscheds` joined to `tbl_schedule`, with Ready YES/NO/N/A grouping and Pending Not Routed.
- Commit `caafb64` changed Master Schedule print columns to match the VB.NET daily schedule request:
  - `TIN #`, `Customer / Branch`, `Purpose`, `Model`, `Trouble`, `City`, `Address`, `Days Pending`, `Ready`, `Assigned To`.
- Verified Field App's Crispin printed route matched the 15 printed-route schedule IDs from Master Schedule for 2026-04-22.

### 2026-04-21 - Collections Matrix Format Accepted
- User confirmed the live Collections month-to-month matrix now works and is preferred over Billing's current matrix format.
- Accepted behavior:
  - no horizontally sticky RD/SN/Customer/Branch columns
  - whole table moves horizontally
  - arrows and `Latest` control work
  - auto-scroll anticipates current/newer months
  - far-right column is `Total`
- Preserve this pattern as a candidate for future Billing matrix redesign.

### 2026-04-21 - Single Source Of Truth And Latest Collections Handoff
- Merged the duplicated root/docs handoff and masterplan into one root `HANDOFF.md` and one root `MASTERPLAN.md`.
- Retired the duplicate `docs/HANDOFF.md` and `docs/MASTERPLAN.md` so future threads do not read conflicting instructions.
- Added the newest live Collections concern from `Screenshot 2026-04-20 at 11.10.02 PM.png`:
  - month matrix still not reliably scrollable
  - SN still shows `Machine ####` in production
- Confirmed the current next-thread priority is Collections live parity without breaking Billing presentation.

### 2026-04-20 - Collections Coverage And UI Work
- Collections was moved to use the Billing customer base plus unpaid invoices.
- Added RD visible count in the matrix header.
- Implemented serial/coverage work intended to stop `Machine ####` SN fallbacks, but the live page still shows the issue and needs another pass.
- Added responsive/mobile matrix handling and then a custom drag scrollbar, but the latest live observation says the interaction is still not good enough.

### 2026-04-20 - Billing RD Parity Sweep
- Verified and aligned Billing reading-day parity across RD 1 to RD 31 against user-provided legacy screenshots.
- Billing cohort work now includes status/date protections needed for the SQL to Firebase migration.
- Protected the current Billing dashboard behavior while widening row coverage for real billing parity.

### 2026-04-17 - Billing Protection And Print Rules
- Billing save-first workflow, invoice lookup/delete tracing, and RTP/RTF print calibration were locked in as the protected operational baseline.
- Firebase invoice print templates remain the source of truth through `tbl_app_settings/billing_invoice_print_templates_v1`.

## Historical Notes
- `HANDOFF-COLLECTIONS-010626.md` is a historical module-specific note only.
- Historical changelog remains in `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/CHANGELOG.md`.
