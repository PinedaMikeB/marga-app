# MARGA Masterplan

## Purpose
This file protects the project across new chats. It should record the stable baseline, dangerous rollback points, and the next safe steps before any session starts editing code.

## Read First In Every New Chat
1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`
3. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/HANDOFF.md`

## Current Protected State
- Billing dashboard protected baseline: commit `77ff141`
- Meaning of protected baseline:
  - dashboard loads without the later experimental April states
  - no April 7 to April 15 billing-state logic should be reintroduced casually
  - if the UI breaks, check function/runtime payloads before changing history again

## Project Rules
- Do not rewrite history on `main` for rollback work. Use forward commits.
- Do not revert unrelated dirty files in the repo.
- Treat Billing, Collections, Customers, Service, APD, and Petty Cash as separate modules with separate risk.
- Preserve working modules when rolling back one module.

## Billing Rules
- Billing is highly fragile right now.
- Use the protected baseline first, then layer small fixes one at a time.
- Never combine these in one patch unless fully verified:
  - timeout fixes
  - row window / sorting changes
  - future invoice hiding
  - missed reading / catch-up states
  - machine-reading fallback logic

## Rollback Reference
- `77ff141`: April 6-equivalent Billing snapshot, current protected baseline
- `04787a0`: April 7 working-state rollback attempt
- `cf5f234`: April 13-equivalent rollback attempt
- `f832cdb`, `217bdde`, `29d6e65`: April 15 changes that were rolled back

## Petty Cash Rules
- Petty Cash module itself is still present.
- Do not assume Petty Cash broke just because the Billing sidebar lost its nav link.
- If Petty Cash navigation needs restoration in Billing, do it as a UI-only patch separate from Billing data logic.

## Next Safe Work Sequence
1. Confirm Billing at `77ff141` is the protected baseline.
2. If Billing still fails, inspect live API payload or runtime behavior before more rollbacks.
3. Re-add non-risky UI links only after the Billing baseline is confirmed.
4. Reintroduce any later Billing improvements one by one, with exact validation after each change.

## Longer Project Context
- Canonical long-form module notes live in `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/HANDOFF.md`
- Older architecture notes live in `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/MASTERPLAN.md`
