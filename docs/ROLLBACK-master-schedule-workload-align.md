# Rollback: Master Schedule / Field Workload Alignment (2026-06-08)

## Rollback tag (before this change)

```
rollback/pre-master-schedule-workload-align-2026-06-08
```

## Files touched by the alignment fix

- `shared/js/schedule-workload.js` (new)
- `master-schedule/js/master-schedule.js`
- `master-schedule.html`
- `field/js/field.js`
- `field/index.html`

## Quick rollback (restore pre-fix versions of only these files)

```bash
cd "/Volumes/Wotg Drive Mike/GitHub/Marga-App-staging"
git checkout rollback/pre-master-schedule-workload-align-2026-06-08 -- \
  master-schedule/js/master-schedule.js \
  master-schedule.html \
  field/js/field.js \
  field/index.html
rm -f shared/js/schedule-workload.js
```

Or revert the fix commit:

```bash
git revert <commit-sha-of-workload-align-fix>
```

## What the fix does

1. Fixes Master Schedule carryover loader (`Set.size` bug + Field-aligned 45-day carryover).
2. Stops merging rows in Master Schedule display (`combineMasterRows` removed from render).
3. Adds shared `MargaScheduleWorkload` used by Master Schedule and Field App for past-pending rules.

## Verify after deploy

- Jonathan De Guzman on 6/8/26 and 6/9/26: Master Schedule staff header metrics should match Field App (New Today + Past Pending = Today's Workload).
- Hard refresh Master Schedule (`?v=20260608-workload-align-2`) and Field App (`?v=20260608-field-carryover-restore-1`).
- Field App carryover path was restored to the pre-shared inline loader to avoid any load regression.

## Follow-up commit

- `20260608-workload-align-2`: restore Field inline carryover, raise Master carryover query limit to 5000, add staff workload cards + export beside staff name.
