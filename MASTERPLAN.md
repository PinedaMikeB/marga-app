# MARGA Masterplan

## Purpose
This file protects the project across new chats. It should record the stable baseline, dangerous rollback points, and the next safe steps before any session starts editing code.

## Read First In Every New Chat
1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`
3. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/HANDOFF.md`

## Current Protected State
- Billing dashboard protected baseline: commit `e9338ab`
- Meaning of protected baseline:
  - dashboard loads with the current save-first Billing calculation workflow
  - invoice lookup/delete controls are available for tracing billing records
  - RTP and RTF print previews can print onto preprinted invoice paper
  - Firebase-stored invoice print templates load from the Billing modal dropdown
  - if the UI breaks, check function/runtime payloads and Firestore documents before changing history again

## Project Rules
- Do not rewrite history on `main` for rollback work. Use forward commits.
- Do not revert unrelated dirty files in the repo.
- Treat Billing, Collections, Customers, Service, APD, and Petty Cash as separate modules with separate risk.
- Preserve working modules when rolling back one module.
- Keep Marga App work in the `Marga-App` repo/thread. If the chat is in `marga-biz`, stop and redirect before editing Marga App code.
- Keep `marga-biz` SEO/site work separate from `Marga-App` operational app changes.
- User expects Marga App changes to be pushed to `main` automatically after verification so Netlify can deploy.

## Billing Rules
- Billing is highly fragile right now.
- Use the protected baseline first, then layer small fixes one at a time.
- Never combine these in one patch unless fully verified:
  - timeout fixes
  - row window / sorting changes
  - future invoice hiding
  - missed reading / catch-up states
  - machine-reading fallback logic
- Billing meter source rule:
  - grouped RTP computation must show all loaded machine/customer rows first; do not hide rows only because a meter lookup is missing.
  - previous meter should be the latest valid meter for the machine serial before the billing month, even if the last reading/bill was months ago or in a previous year.
  - the serial/machine id is the billing anchor because machines transfer between customers; use the last meter only when the serial has not been delivered/transferred to another customer after that reading.
  - for a new delivery/customer, the beginning meter from delivery/contract setup may be the previous meter for the first bill.
  - if no prior meter, delivery beginning meter, or saved billing meter is available, keep the row visible with a clear note such as "No available previous meter reading"; do not silently bill the quota minimum from `0 / 0`.
  - if a prior meter exists but no present reading has been entered for the billing month, treat the row as pending present reading; keep it visible, show a note, and do not charge the quota floor until staff enters the present meter or an actual current reading exists.
  - grouped RTP saves must exclude missing-meter and pending-present rows from `tbl_billing`; only computed machine lines belong in the saved invoice group.
  - if no delivery happened, office staff should mark the customer/machine inactive so it moves to inactive review instead of being billed.
- Billing visibility rule:
  - user-facing hide/unhide is handled by reversible `tbl_billing_exclusions` records.
  - hiding an account removes it from active Billing lists without deleting or editing the customer, contract, branch, or machine master.
  - restore must be available from a saved exclusions list even when the account is hidden from the active grid.

## Customer Identity Rule
- Canonical customer lookup is the **Active Contract Customer Graph**.
- Use this graph whenever the app needs the real customer universe for Billing, Service, Collections, Customer Portal, machine usage, or customer-facing history.
- Do not treat raw `tbl_companylist` as the customer list. It is only the company master.
- Do not treat raw `tbl_machine.client_id` as the customer locator. Most active contract machines do not have a reliable machine-side client tag.
- The graph is:
  - `tbl_contractmain` where `status == 1` as the active customer/machine basis
  - `tbl_contractmain.contract_id` -> `tbl_contractdep.id`
  - `tbl_contractdep.branch_id` -> `tbl_branchinfo.id`
  - `tbl_branchinfo.company_id` -> `tbl_companylist.id`
  - `tbl_contractmain.mach_id` -> `tbl_machine.id`
  - serial display from `tbl_contractmain.xserial` first, then `tbl_machine.serial`
- Billing calls this through the cohort/customer resolver in `netlify/functions/openclaw-billing-cohort.js`; future modules may call it the **Billing Customer Locator Query** when referring to the Firebase query/result.
- For grouped RTP meter-form computation, actual read lines come from `tbl_machinereading.current_contract` for the billing period and can include historical/transition contract rows even when `tbl_contractmain.status != 1`. The active customer universe is still status `1`, but a real meter reading tied to a contract must not be discarded from the form or invoice breakdown because of status alone.
- Grouped invoice numbers must not be used as the primary branch locator because one invoice can contain many branches. Prefer `tbl_contractmain.contract_id` -> `tbl_contractdep.id` -> `tbl_branchinfo.id`; use invoice/schedule branch matching only as a fallback when the contract graph is unlinked.
- Service request serial lookup must resolve through this graph before falling back to raw machine/client fields.
- Customer Portal must expose only graph-resolved customer/account/machine rows unless an admin explicitly creates a non-contract customer account.

## Billing Print Template Rules
- Firestore is the source of truth for print layout templates.
- Store invoice print templates in `tbl_app_settings/billing_invoice_print_templates_v1`, not only in Chrome/localStorage.
- `Save Template` must persist every layout setting:
  - paper size: `paperWidthCm`, `paperHeightCm`
  - `orientation`
  - margins/placement: `offsetXmm`, `offsetYmm`, `rightMarginMm`
  - `scale`
  - section x/y/font-size settings for `header`, `description`, `meta`, and `totals`
  - totals-specific controls: `amountWidthMm`, `amountScaleX`, `amountRightPadMm`, `amountDueFontScale`
- Local storage is acceptable only as a cache, fallback, and migration source. Do not make it the only durable copy of a layout.
- Preserve the portrait-safe right-margin behavior so widening the printable area does not make Chrome switch to landscape.
- Keep browser print assumptions visible to the user: Chrome print preview must disable `Headers and footers`, and the app should continue using `@page` margin `0`.

## Billing Save And Invoice Number Rules
- A bill should be saved before printing.
- Print buttons should enable only when the modal values match the saved billing snapshot.
- Invoice numbers must remain unique across billing records.
- Invoice search must remain available so a user can locate and delete/cancel a specific invoice number before reusing it.
- Delete/cancel must be deliberate and should release the invoice number only when the billing record is actually cleared according to the agreed workflow.
- For one-invoice/multiple-machine RTP billing, cancel/replace must clear all `tbl_billing` records for that invoice number and billing month, not only one branch line.
- Saved grouped RTP billing should support reprinting the invoice, the meter reading form, and a breakdown attachment for corrected/replacement invoices.
- Invoice lookup should group many saved branch records into one invoice card per invoice number/month. When older buggy saves created zero-meter branch rows under the same invoice, lookup should flag those rows and exclude them from the displayed computed invoice total.

## Rollback Reference
- `e9338ab`: current protected Billing print/save baseline
- `77ff141`: April 6-equivalent Billing rollback snapshot
- `04787a0`: April 7 working-state rollback attempt
- `cf5f234`: April 13-equivalent rollback attempt
- `f832cdb`, `217bdde`, `29d6e65`: April 15 changes that were rolled back

## Petty Cash Rules
- Petty Cash module itself is still present.
- Do not assume Petty Cash broke just because the Billing sidebar lost its nav link.
- If Petty Cash navigation needs restoration in Billing, do it as a UI-only patch separate from Billing data logic.

## Next Safe Work Sequence
1. Continue Marga-App implementation in the Marga-App thread, not a `marga-biz` SEO/site thread.
2. Confirm Billing at `e9338ab` remains the protected baseline before adding more billing states.
3. For print-layout changes, update through the Billing modal and click `Save Template`; verify the template survives refresh and reloads from Firebase.
4. If Billing fails, inspect live API payload, Firestore billing records, and `tbl_app_settings/billing_invoice_print_templates_v1` before more rollbacks.
5. Reintroduce any later Billing improvements one by one, with exact validation after each change.

## Longer Project Context
- Canonical long-form module notes live in `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/HANDOFF.md`
- Older architecture notes live in `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/MASTERPLAN.md`
