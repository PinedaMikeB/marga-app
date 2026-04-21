# MARGA Handoff

Last Updated: 2026-04-21
Canonical Status: Single source of truth for current operational handoff

Start every new Marga-App thread by reading:
1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`

## Current Focus
- Protect the working Billing dashboard presentation and save/print workflow before changing shared resolver logic.
- Keep Collections aligned to the Billing customer universe plus unpaid invoices.
- Fix the live Collections matrix so month columns are actually reachable by mouse/trackpad/touch.
- Fix Collections SN so it shows real serials, not fallback labels like `Machine 3616`.
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

## Current Live Issue To Carry Into The Next Thread
Reference the latest live observation:
- Screenshot: `Screenshot 2026-04-20 at 11.10.02 PM.png`

What the user saw on the live Collections page:
- The month-to-month collection matrix is still not practically scrollable.
- User cannot drag left/right in a reliable way and still cannot reach the later month columns comfortably.
- The SN column is still wrong in production. It still shows fallback values like:
  - `Machine 3616`
  - `Machine 3613`
  - `Machine 3319`
  - `Machine 3325`

What this means:
- The deployed Collections page is still not meeting the requirement for horizontal month navigation.
- The deployed SN resolver is still falling back to machine labels instead of showing real serial text.
- Before changing more UI, confirm whether the live page is actually running the newest code and whether the row builder is still overwriting serials with `machineLabel`.

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
| Billing | Protected / In Progress | Working save-first workflow, grouped RTP support, multimeter totals, search stability, Firebase print templates. | Keep protected while Collections resolver/scrolling is fixed. |
| Collections | In Progress | Uses Billing-based coverage plus unpaid invoices, but live SN and horizontal scrolling are still wrong. | Fix live matrix usability and real serial display first. |
| Service | In Progress | Must follow the same customer/serial identity rules as Billing. | Reuse Active Contract Customer Graph carefully. |
| APD | In Progress | Prototype exists. | Keep separate from Billing/Collections risk. |
| Petty Cash | In Progress | Prototype exists. | Keep separate from Billing/Collections risk. |
| Sync Updater | In Progress | Dual-lane supervisor and recovery work already documented historically. | Keep stable; do not mix sync refactors with UI fixes. |

## Next Actions
1. Reproduce the live Collections issue from the latest screenshot before changing more code.
2. Confirm the deployed page is serving commit `9feab79` or later.
3. Audit the Collections row builder so `serialNumber` does not get replaced by `machineLabel`.
4. Make horizontal month navigation obvious and reliable on the live page, not only in local mocks.
5. Verify Billing UI still matches the protected baseline after any shared resolver changes.

## Session Log (Top First)
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
