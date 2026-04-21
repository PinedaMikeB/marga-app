# MARGA Masterplan

Last Updated: 2026-04-21
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

Billing protection rule:
- Do not break the live Billing dashboard presentation while fixing other modules.

## Collections Rules
- Collections should be built from the Billing customer set plus all unpaid invoices still requiring follow-up.
- It is acceptable for the web app to contain more rows than the SQL screenshots.
- It is not acceptable for real SQL/Billing customers or unpaid accounts to be missing.
- The SN column must display the actual serial whenever available through contract/machine resolution.
- `Machine ####` is a machine label fallback, not a valid steady-state SN display.
- If the true serial is missing, use an explicit missing-serial label such as `No serial on file`.

Collections matrix usability rule:
- The month matrix must be horizontally reachable on live desktop and mobile.
- Native scrollbar, custom drag bar, arrow buttons, mouse drag, trackpad movement, or touch swipe are all acceptable only if they work clearly on the live page.
- A local mock is not enough; verify against the deployed page behavior.

## Service Rules
- Service should use the same Active Contract Customer Graph for customer, branch, machine, and serial identity.
- Service must not use raw `tbl_machine.client_id` as the customer source of truth.
- Model display should prefer the corrected contract/machine resolver and avoid old mismatched helper paths.

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
From the latest Collections screenshot on 2026-04-21 11:56 AM:
- Collections month-to-month matrix scroll format is accepted by the user.
- User likes it more than Billing's current month-to-month format.
- Preserve this format for Collections and consider it for a future Billing matrix update.

Collections still needs ongoing parity work, but the matrix navigation format itself is no longer the blocker.

## Safe Next Work Sequence
1. Preserve the accepted Collections month-matrix format.
2. If Billing matrix UX is changed later, port the Collections format carefully and keep Billing save/print behavior protected.
3. Re-verify Billing presentation after any Billing matrix changes.

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
