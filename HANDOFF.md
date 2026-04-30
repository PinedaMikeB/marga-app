# MARGA Handoff

Last Updated: 2026-04-29
Canonical Status: Single source of truth for current operational handoff

Start every new Marga-App thread by reading:
1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`

## Current Focus
- Next chat focus: continue **Billing** work.
- Protect the working Billing dashboard presentation and save/print workflow before changing shared resolver logic.
- Releasing is now live and materially implemented; only parity/tuning work should remain there, not a rebuild.
- Preserve the accepted Collections month-matrix scroll format; user likes it and may want Billing to adopt it later.
- Collections SN/data display is acceptable in the dashboard as of the latest live check.
- Before implementing grouped/collapsible Collections rows, preserve the current working month-to-month matrix as the rollback baseline.
- New Collections grouping focus: one-invoice / many-branch customers such as `China Bank Savings - Branches` should show one parent invoice row with expandable branch/machine meter-reading detail.
- Keep Marga App work inside the `Marga-App` repo/thread. If a chat is in `marga-biz`, stop and redirect before editing app code.

## Current Protected Baselines
- Billing protected baseline: commit `8df832d` `Include multimeter invoice amounts in billing totals`
- Important Billing-support commits still relied on by current behavior:
  - `9d2e0ae` `Normalize billing customer search spacing`
  - `071ecc4` `Stabilize billing customer search refresh`
  - `a277f95` `Prefill color meter prior readings`
  - `936c588` `Use mother company details for grouped prints`
- Current live Collections work already pushed on `main`:
  - `1683fc9` `Count closed field schedules in KPIs` is the latest observed `main` commit while the Collections matrix remains working
  - `d8564c3` `Add branch status editor to collections`
  - `a128dda` `Show invoice and OR numbers in collection cells`
  - `3fe81b0` `Avoid legacy payment id collisions`
  - `99348f1` `Refresh collections matrix after payment save`
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
  - `4156a67` `Require field customer location pin`
  - `461e7b3` `Require frontage photo for location pins`
- Current live Service Progress map work already pushed on `main`:
  - `f78805d` `Center service progress map on Antipolo office`
  - `0933866` `Reduce service progress map load`
  - `4417e5d` `Fix service progress map sizing`
  - `90acdfd` `Stabilize service progress map layout`
  - `4d3b361` `Protect service progress map tile layout`
  - `795cd9f` `Mark office on service progress map`
- Current live General Production work already pushed on `main`:
  - `e835737` `Add General Production module`
  - `c96f4de` `Tune General Production legacy counts`
  - `c338d13` `Fix General Production machine checker serials`
  - `e64e5b6` `Use billing serials in machine checker`
- Current live Releasing work already pushed on `main`:
  - `dc2a50b` `Add Releasing delivery receipt module`
  - `555af71` `Use context menu for releasing DR items`
  - `b148610` `Add DR print adjustment controls`
  - `71a2afc` `Add releasing return and DR print templates`
  - `da0bad8` `Keep releasing print footer visible`
  - `f8160ff` `Keep Create DR items after printing`
  - `872700b` `Hide Create DR units from releasing list`

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

Rollback point:
- Treat current `main` at commit `1683fc9` as the rollback anchor for the working month-to-month Collections comparison matrix before grouped/collapsible row work.
- If grouped work breaks the matrix, restore behavior with a new forward commit based on this accepted matrix behavior. Do not rewrite `main`.

Grouped-customer matrix representation:
- Some customers have many meter-read branches/machines but only one mother invoice per month.
- These accounts should display as one parent row in the Collections month-to-month matrix, with a `View Branches` control to expand the branch/machine meter-reading breakdown.
- The parent row owns the invoice/payment truth: invoice number badge, OR number badge, collected/partial/no-payment color, follow-up badge, and the follow-up/payment popup details.
- Expanded branch rows are for meter-reading audit only. They may show computed branch amount/status, but must not look like separate invoices when the office bills one mother invoice.
- Legacy/historical CBS invoices may use one selected CBS branch as the invoice branch/name because the office previously chose a branch for billing address purposes. In the Collections matrix, these still need to map back to the grouped parent (`China Bank Savings - Branches`) when the contract/branch belongs under the grouped company.
- Do not split grouped parent rows just because an old invoice header names a specific branch. Keep that branch visible only in the expanded branch/meter-reading detail.
- Verified example:
  - `tbl_companylist/72`: `China Bank Savings - Branches`
  - `tbl_groupings/22`: `CHINABANK`
  - `tbl_branchinfo.company_id = 72`: 224 active branches as of 2026-04-29
- Critical separation rule: do not merge by TIN or broad name match. `China Bank Savings Inc.` (`tbl_companylist/73`) and other CBS-like records share TIN `000-504-532-000` but are individually billed and should remain individual rows unless separately verified as grouped.
- Because newer CBS billing rows do not consistently populate `tbl_billing.groupings_id`, grouped row construction should use exact grouped `company_id` plus branch/contract resolution, with `tbl_groupings` as a helper.

## Non-Negotiable Rules
- Do not break the Billing dashboard presentation while fixing Collections.
- Do not reintroduce old Billing rollback commits blindly.
- Use forward commits on `main`; do not rewrite history for rollback work.
- Do not revert unrelated dirty files in the repo.
- User expects verified Marga App changes to be pushed to `main` so Netlify can deploy automatically.
- Default release behavior for future threads: after making and verifying Marga-App code changes, commit them and push to `main` unless the user explicitly says not to push.

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

## Releasing Rules
- Releasing lives in `releasing/` and is live on Netlify.
- DR Item List should expand quantity requests into separate unit rows.
  - Example: if reference `345898` has `3 pcs TONER / INK`, the list should show 3 separate rows/units.
  - If the user adds 1 row to Create DR, that 1 row should disappear from DR Item List while it is in Create DR.
  - The remaining 2 rows should stay in DR Item List.
- Create DR behavior:
  - Right-click a ready row to `Add to DR`.
  - Right-click a row inside Create DR to `Send back to DR Item List`.
  - `Clear` is manual and should be the only action that empties Create DR.
  - After `Print and Save`, Create DR rows should stay there until the user clicks `Clear`.
- Current Firebase write path in code:
  - `tbl_finaldr`: DR header record
  - `tbl_newfordr`: released item rows and source row updates/splits
  - `tbl_schedule`: `releasing_pending_qty` / `releasing_dr_done` updates for schedule-only source rows
- Current print/template behavior:
  - Print window opens immediately on click to avoid browser popup blocking.
  - DR print adjustment templates persist locally and sync to `tbl_app_settings/releasing_dr_print_templates_v1`.
- Important remaining verification:
  - For printed references like `345898`, confirm after Clear/reload that only the true remaining units come back from Firebase.

## Receiving Rules
- Receiving is the inbound counterpart to Releasing and should be implemented as its own `receiving/` module.
- Receiving is responsible for inbound operational accountability:
  - customer machine pullouts
  - office receipt of returned machines
  - return cartridges
  - purchased machines
  - purchased supplies / materials
  - parts or materials returned by technicians
- Machine pullout flow:
  - when a customer machine is pulled out, create a pending-return record and mark the machine with `return_status = pending_return`
  - store pulled-out-by, pullout date/time, pickup receipt, customer representative, previous branch/customer, and remarks
  - clear the active customer link on the old machine (`client_id`, `branch_id`, `company_id`, `isclient`) so it no longer appears as actively linked to the customer
  - do not move it to `FOR OVERHAULING` yet; it is only pending return while in transit
- Office receive flow:
  - office staff confirms the returned machine serial and receiving details
  - only after office receipt should the old machine move to `status_id = 7` / `FOR OVERHAULING`
  - receiving should create/patch app-side audit fields and a `tbl_newmachinehistory` row where possible
- Releasing / replacement-machine flow:
  - General Production allocation creates the machine item for Releasing
  - Releasing print/save prepares a pending customer-machine link for the replacement machine
  - the replacement machine remains `customer_link_status = pending_delivery` until driver/logistics closure confirms delivery
  - paper DR printed/received is not enough by itself to finalize the machine as actively linked
- Driver/logistics confirmation is the future finalizer:
  - once delivery is closed by logistics/field report, the replacement machine can become the confirmed customer-linked machine
  - this future flow should record receiver/customer representative, date/time, and delivery proof fields

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
| Field App | In Progress | Default `Today` tab shows printed route; `Carry Over` tab shows saved/unprinted and older open assigned jobs. New customer location pins are required before Finish when the branch has no saved coordinates; staff must add a frontage/building photo when pinning. | Keep today route fast; next step is action-based GPS events (`On the Way`, `Arrived`, `Check Out`, `Completed`) and photo upload hardening. |
| Service | In Progress | Must follow the same customer/serial identity rules as Billing. Service Dispatch has a `Service Progress` map centered on MARGA Office in Havila/Antipolo with a 15-mile radius and office marker. | Reuse Active Contract Customer Graph carefully; wire live GPS action events from Field App into the map. |
| General Production | Live / In Progress | Isolated `general-production/` module is deployed. Dashboard counts tuned to VB.NET screenshot targets. Machine Checker uses Billing-backed real serials with searchable dropdown, model/status/customer context, and add-new-machine form. For Overhauling rows can be double-clicked to assign a tech and move to Under Repair; Under Repair rows can be double-clicked to mark Machine Ready. | Add mismatch warning for active billing contract vs machine master status; continue source-table tuning only when user asks. |
| Releasing | Live / In Progress | Isolated `releasing/` module is deployed. DR Item List expands quantity into unit rows, supports right-click add/remove, print adjustment templates, immediate print-window opening, and Create DR stays populated until manual Clear. | Verify Firebase parity for partial-quantity cases like `345898` after Clear/reload; Billing is now the next chat focus. |
| Receiving | Live First Pass / In Progress | New inbound `receiving/` module is approved and first pass is implemented. It handles machine pending-return logging, returned-machine office receipt to For Overhauling, and generic receiving logs for cartridges, purchased machines, supplies/materials, parts, and tech returns. | Verify with real office pullout/receipt examples; later add driver/logistics delivery confirmation finalizer. |
| APD | In Progress | Prototype exists. | Keep separate from Billing/Collections risk. |
| Petty Cash | In Progress | Prototype exists. | Keep separate from Billing/Collections risk. |
| Sync Updater | In Progress | Dual-lane supervisor and recovery work already documented historically. | Keep stable; do not mix sync refactors with UI fixes. |

## Next Actions
1. Start next chat on Billing.
2. Read current Billing print/template workflow before editing; keep the protected Billing save/print behavior intact.
3. Reuse only proven patterns from Releasing where they help Billing:
   - template persistence
   - safe print-window timing
   - explicit partial-unit operational flow concepts
4. If Releasing is revisited later, verify Firebase state for partial references like `345898` after Clear:
   - confirm `tbl_finaldr` row exists
   - confirm source quantity was reduced in `tbl_newfordr` or `tbl_schedule`
   - confirm only remaining units reappear
5. Keep Billing, Collections, Master Schedule, Field App, General Production, and Releasing stable while working on Billing.
6. Continue module work without reverting unrelated dirty files.

## Session Log (Top First)
### 2026-04-30 - Service Progress Map And Field Location Pinning
- Added Service Dispatch `Service Progress` map button/panel.
- Map behavior:
  - uses Leaflet/OpenStreetMap
  - starts centered on MARGA Office near Havila/Mission Hills, Antipolo
  - shows a 15-mile service radius and visible `MARGA Office` marker
  - intentionally keeps initial load light and does not render scheduled-client fallback pins by default
  - live staff GPS pins are expected from `marga_field_visit_events`
  - protected Leaflet tile CSS in `service/css/service.css` after map tiles initially rendered cropped under app styles
- Field App location enforcement:
  - every task modal has `Customer Location Pin`
  - if `tbl_branchinfo.latitude` and `tbl_branchinfo.longitude` already exist, no pin is required
  - if branch coordinates are missing, staff cannot mark the schedule `Finished`
  - staff must tap `Pin Customer Location` while at the client site
  - pinning writes coordinates and audit fields to `tbl_branchinfo`
  - pinning patches summary fields on `tbl_schedule`
  - pinning writes a `marga_field_visit_events` event with action `customer_location_pinned`
  - pinning now requires a frontage/building photo so the office knows what the customer site looks like
- Frontage photo behavior:
  - Field App compresses the selected camera image before saving
  - attempts Firebase Storage upload under `field-location-photos/...`
  - if Storage rules reject upload, falls back to one compressed data-url document in `marga_location_frontage_photos` and stores only the doc id on branch/schedule/event rows
  - branch fields include `location_frontage_photo_url`, `location_frontage_photo_path`, `location_frontage_photo_doc_id`, and storage metadata
- Important next step:
  - implement action-based GPS buttons in Field App: `On the Way`, `Arrived`, `Check Out`, `Completed`
  - first-arrival lateness rule: Metro Manila by 8:00 AM, province by 9:00 AM
  - completion proof photo should upload directly and should not save into the phone gallery when possible

### 2026-04-30 - Receiving Workflow Approved
- User approved a dedicated Receiving module instead of overloading Machine Checker.
- First pass implemented as `receiving/`.
- Final intended flow:
  - General Production allocates replacement machines.
  - Releasing prints/saves DR and prepares a pending customer-machine link.
  - Driver/logistics closure later confirms the replacement machine as actively linked to the customer.
  - Pulled-out old customer machines become `pending_return` with pulled-out-by, date/time, pickup receipt, customer representative, previous customer/branch, and remarks.
  - Office Receiving confirms returned machines and moves them to `FOR OVERHAULING`.
- Important design rule:
  - the old machine must not remain actively linked to the customer after pullout
  - the new machine should not become confirmed active customer machine until delivery confirmation supersedes it

### 2026-04-23 - Releasing Module Live And Iterated
- Added isolated `releasing/` module with DR Item List and Create DR workflow.
- Releasing live URL: `https://margaapp.netlify.app/releasing/`.
- Pushed and deployed:
  - `dc2a50b` `Add Releasing delivery receipt module`
  - `555af71` `Use context menu for releasing DR items`
  - `b148610` `Add DR print adjustment controls`
  - `71a2afc` `Add releasing return and DR print templates`
  - `da0bad8` `Keep releasing print footer visible`
  - `f8160ff` `Keep Create DR items after printing`
  - `872700b` `Hide Create DR units from releasing list`
- Implemented behaviors:
  - quantity requests expand into separate rows/units
  - right-click add to Create DR
  - right-click send back from Create DR
  - print adjustment with template save/load/delete
  - template persistence to `tbl_app_settings/releasing_dr_print_templates_v1`
  - print window opens immediately to reduce popup blocking
  - Create DR stays populated after print until manual Clear
  - rows already added to Create DR are hidden from DR Item List until removed or cleared
- Current verification note:
  - for references like `345898`, the intended rule is partial delivery:
    - if request qty is 3 and user prints 1, then 2 should remain in DR Item List after Clear/reload
  - if more than the true remaining quantity comes back, inspect Firebase rows before changing filters again

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
