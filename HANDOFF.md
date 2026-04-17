# MARGA Quick Handoff

Start every new chat by reading:

1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`
3. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/HANDOFF.md`

## Current Stable Billing Baseline
- Billing dashboard is currently live on `main` with the save-first billing workflow and RTP/RTF invoice print preview work.
- Current safe commit on `main`: `e9338ab` `Add invoice right margin control`
- Older rollback reference: `77ff141` `Rollback billing dashboard to April 6 snapshot`
- If Billing breaks again, inspect the live Netlify function payload and Firestore data before doing another rollback.

## Do Not Reintroduce Without Review
- `6ac79f7` `Add missed reading and catch-up billing states`
- `23aa23d` `Fix billing dashboard request timeouts`
- `29d6e65` `Restore billed rows to billing dashboard window`
- `217bdde` `Fix RD billing sort order`
- `f832cdb` `Hide future-dated April billing until invoice date`

These may be useful ideas, but they must not be reapplied blindly. Re-test against the current live API first.

## What The Next Chat Should Protect
- Keep the current Billing dashboard working before adding new states or filters.
- Treat the live Billing UI behavior at commit `e9338ab` as the protected baseline for billing save, invoice lookup, and RTP/RTF printing.
- If the current chat/thread is for `marga-biz`, future Marga App implementation should continue in the Marga-App thread. If a future chat is in the wrong repo/thread, stop and redirect before editing.
- Never mix `marga-biz` SEO/site work with `Marga-App` billing/application changes in the same commit.

## Billing Print Template Protection
- Invoice print templates must be saved in Firebase, not only in Chrome/localStorage.
- Firestore source of truth:
  - collection: `tbl_app_settings`
  - document: `billing_invoice_print_templates_v1`
  - key: `billing_invoice_print_templates`
- Chrome/localStorage is only a cache, fallback, and migration source.
- `Save Template` must persist the full layout object to Firebase, including:
  - `paperWidthCm`, `paperHeightCm`, `orientation`
  - `offsetXmm` left margin, `offsetYmm` top margin, `rightMarginMm` right-side paper allowance
  - `scale`
  - section positions and font sizes for `header`, `description`, `meta`, and `totals`
  - totals controls: `amountWidthMm`, `amountScaleX`, `amountRightPadMm`, `amountDueFontScale`
- Do not remove the portrait-safe right-margin clamp; it prevents Chrome from flipping the preview back to landscape.
- Chrome print preview must have `Headers and footers` turned off and browser margins should stay at none/default zero behavior from the app `@page` rule.

## Billing Workflow Protection
- Billing calculation modal should save the invoice first.
- Print button should stay disabled until the saved billing snapshot matches the current modal values.
- April 26 or the target month cell must show the saved billing after save.
- Invoice numbers must be unique. If a bill is deleted/cancelled, that invoice number should become available again only after the billing record is actually removed or marked cancelled according to the agreed workflow.
- Keep the invoice number search box so an invoice can be traced before deletion.
- Grouped RTP modal must list all loaded machine/customer rows. If no prior meter is found, show the row with a note instead of hiding it.
- Previous meter lookup should follow the serial/machine history, not only the previous calendar month. If April is being billed and the last valid reading was November 2025 or January 2026, use that meter as long as the serial has not been delivered/transferred to another customer after that reading.
- For first delivery/new customer cases, the delivery or contract beginning meter can be the previous meter for the first bill.
- Never auto-bill a quota amount from `0 present / 0 previous` when no meter source exists; show "No available previous meter reading" so staff can enter the beginning meter or mark the row inactive if no delivery happened.
- If a grouped RTP row has a previous meter but no current/present reading yet, keep it visible as pending and do not charge the quota floor until staff enters the present reading or an actual current reading group exists.
- Grouped RTP saves should write only real computed machine lines; missing-meter and pending-present rows stay visible for staff action but should not become zero-amount invoice records.
- Multi-machine invoice print support now includes `Print Breakdown` and `Print Meter Form` from the saved calculation modal, so the breakdown can be attached to the invoice and the meter form can be reprinted during correction/replacement.
- Cancel/replace actions should remove the whole invoice group for that invoice number and billing month before the invoice number is reused.
- Invoice search should display one invoice card per invoice number/month even when `tbl_billing` stores many branch line records. The card total should use computed branch lines only and flag ignored zero-meter/pending saved rows from older buggy saves.
- Billing hide/unhide is a reversible visibility layer saved in `tbl_billing_exclusions`; it hides active Billing rows without deleting customer, contract, branch, or machine master records, and restore must be reachable from the saved exclusions list.

## Petty Cash Status
- Petty Cash module files were not rolled back.
- The standalone module still exists at `/Volumes/Wotg Drive Mike/GitHub/Marga-App/pettycash/`.
- Shared finance account code still exists at `/Volumes/Wotg Drive Mike/GitHub/Marga-App/shared/js/finance-accounts.js`.
- What did change: the Billing page sidebar was rolled back to an older snapshot, so the `Petty Cash` nav link on the Billing page is currently gone.
- APD still contains Petty Cash references and the Petty Cash module itself was not deleted.

## Safe Next Step
- Continue Marga-App work in the Marga-App thread.
- For print-layout tuning, adjust the Firebase `Invoice RTP` or `Invoice RTF` template through the Billing modal, click `Save Template`, then verify it reloads from the dropdown after refresh.
- For any billing-data change, test one customer/month first before broad dashboard changes.
