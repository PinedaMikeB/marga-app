# MARGA Handoff

Last Updated: 2026-04-21
Canonical Status: Single source of truth for current operational handoff

Start every new Marga-App thread by reading:
1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`

## Current Focus
- Protect the working Billing dashboard presentation and save/print workflow before changing shared resolver logic.
- Keep Collections aligned to the Billing customer universe plus unpaid invoices.
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
| Collections | Accepted / In Progress | Uses Billing-based coverage plus unpaid invoices. Matrix scroll format is accepted live: whole-sheet horizontal movement, visible arrows/Latest, Total at far right. | Preserve this format while continuing Collections parity work. |
| Service | In Progress | Must follow the same customer/serial identity rules as Billing. | Reuse Active Contract Customer Graph carefully. |
| APD | In Progress | Prototype exists. | Keep separate from Billing/Collections risk. |
| Petty Cash | In Progress | Prototype exists. | Keep separate from Billing/Collections risk. |
| Sync Updater | In Progress | Dual-lane supervisor and recovery work already documented historically. | Keep stable; do not mix sync refactors with UI fixes. |

## Next Actions
1. Preserve the accepted Collections matrix format as the reference implementation.
2. If Billing month-to-month comparison is revisited, evaluate porting this exact format: whole-sheet movement, no sticky left columns, visible arrows/Latest, auto-current-month window, Total at far right.
3. Keep Billing protected; any Billing matrix port needs separate live verification for save/print/invoice lookup behavior.
4. Continue module work without reverting unrelated dirty files.

## Session Log (Top First)
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
