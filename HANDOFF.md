# MARGA Quick Handoff

Start every new chat by reading:

1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`
3. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/HANDOFF.md`

## Current Stable Billing Baseline
- Billing dashboard is pinned to the April 6-equivalent snapshot.
- Current safe commit on `main`: `77ff141` `Rollback billing dashboard to April 6 snapshot`
- This was restored because later April 7 to April 15 billing changes caused blank matrices, false billed states, or `502` errors.

## Do Not Reintroduce Without Review
- `6ac79f7` `Add missed reading and catch-up billing states`
- `23aa23d` `Fix billing dashboard request timeouts`
- `29d6e65` `Restore billed rows to billing dashboard window`
- `217bdde` `Fix RD billing sort order`
- `f832cdb` `Hide future-dated April billing until invoice date`

These may be useful ideas, but they must not be reapplied blindly. Re-test against the current live API first.

## What The Next Chat Should Protect
- Keep the current billing dashboard working before adding new states or filters.
- Treat the live Billing UI behavior at commit `77ff141` as the protected baseline.
- If Billing breaks again, inspect the live Netlify function payload before doing another rollback.

## Petty Cash Status
- Petty Cash module files were not rolled back.
- The standalone module still exists at `/Volumes/Wotg Drive Mike/GitHub/Marga-App/pettycash/`.
- Shared finance account code still exists at `/Volumes/Wotg Drive Mike/GitHub/Marga-App/shared/js/finance-accounts.js`.
- What did change: the Billing page sidebar was rolled back to an older snapshot, so the `Petty Cash` nav link on the Billing page is currently gone.
- APD still contains Petty Cash references and the Petty Cash module itself was not deleted.

## Safe Next Step
- Do not change billing logic first.
- If needed, re-add the Billing sidebar `Petty Cash` link as a separate UI-only patch after Billing is confirmed stable.

