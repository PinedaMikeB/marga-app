# MARGA Handoff (Single Source of Truth)

Last Updated: 2026-02-16  
Owner: Marga App Team

This file is the canonical session-to-session handoff.
Each thread should only update the relevant module section plus `Current Focus`, `Next Actions`, and `Open Questions`.

## How To Update Per Thread
1. Update `Last Updated`.
2. Add one entry to `Session Log` (top-first).
3. Update only affected module block(s).
4. Add follow-ups to `Next Actions`.
5. If release-level change happened, update `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/CHANGELOG.md`.

## Current Focus
- Stabilize field execution flow (tech/messenger) with complete update modal and PIN-based close.
- Keep sync updater reliable for incremental imports from latest SQL dump.
- Continue role/module access hardening before broader staff rollout.

## Next Actions
- Add Firebase Storage upload flow for before/after repair photos (currently metadata only).
- Build admin queue UI for serial correction approvals (`marga_serial_corrections`).
- Add module-level access toggles in Settings UI and enforce via auth + page guards.
- Extend sync presets to include required support tables (`tbl_branchcontact`, `tbl_inventoryparts`, `tbl_mstatus`).
- Add production/purchasing dashboard for parts-needed queue (`marga_production_queue`).

## Open Questions
- Should customer PIN be fixed per branch or rotating per period/request?
- Which table is the final source of service completion truth in hybrid phase: `tbl_schedule` only, or with `tbl_schedtime`?
- For “pending/continuous service”, what SLA buckets should be shown on admin dashboard?

## Module Status Board
| Module | Status | Current State | Next Step |
|---|---|---|---|
| Service Dispatch | In Progress | Daily ops + carryover + filters + assignment monitoring are live. | Add deeper pending analytics and SLA drilldowns. |
| Field App (Tech/Messenger) | In Progress | Update modal expanded with serial, parts, meter, time, delivery, signer, PIN close. | Add photo upload + serial approval UI handoff path. |
| Billing | Planned | Basic module shell exists. | Rebuild billing run workflow from legacy logic. |
| Collections | In Progress | Module and data views exist. | Tighten daily queue + follow-up outcomes. |
| Customers | In Progress | Core listing and profiles available. | Continue data quality and branch/contact enrichment. |
| Inventory/Purchasing | Planned | Menu/module placeholders available. | Connect parts queue + stock movement actions. |
| Settings/Auth | In Progress | Role-based login + account management are live. | Add explicit module access matrix UI per user. |
| Sync Updater | In Progress | Incremental SQL-to-Firestore sync works. | Add safer operator workflow and expanded table coverage. |

## Session Log (Top First)
### 2026-02-16 - Documentation Standardization
- Established canonical handoff in `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/HANDOFF.md`.
- Converted handoff model to module-based updates for thread-specific focus.
- Root `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md` now points to this canonical file.

### 2026-02-12 - Field Modal Expansion
- Field update modal expanded for technician workflow:
  - searchable serial selection + missing serial flow
  - model/brand, machine status, parts list + qty
  - meter and time capture, delivery and acknowledgement sections
  - save draft, pending, and finished actions with PIN close
- Added queue writes for pending parts and serial correction requests.

## Module Notes

### Service Dispatch
Done:
- Date-driven daily operations board with carryover support.
- Status model for pending/carryover/ongoing/closed/cancelled.

In Progress:
- Better monitoring cards for pending reasons (parts, change unit, delivery delays).

Risks:
- Legacy status mappings still require validation against old VB.NET behavior.

### Field App (Tech/Messenger)
Done:
- Task list by assignee.
- Modal update flow with notes, serial handling, parts, meter, time, signer, PIN verification.
- Pending writes to `marga_production_queue`.

In Progress:
- Before/after photo file metadata is saved, but no binary upload yet.

Risks:
- Without Storage upload, photo evidence is not centralized.

### Billing
Done:
- Baseline module scaffolding.

In Progress:
- None.

Risks:
- Rebuilt billing logic must exactly match legacy computation and VAT behavior.

### Collections
Done:
- Baseline module screens and records access.

In Progress:
- Follow-up and settlement workflow alignment.

Risks:
- Pending collection statuses need consistent definitions.

### Customers
Done:
- Customer and branch data browsing.

In Progress:
- Contact enrichment and quality cleanup.

Risks:
- Missing support tables in sync affect branch contact completeness.

### Settings/Auth
Done:
- Email/password login with role-aware page access.
- Admin user management foundation.

In Progress:
- Per-module access checkbox management UX.

Risks:
- Temporary fallback credentials should be disabled for production hardening.

### Sync Updater
Done:
- Incremental watermark-based syncing from SQL dump.

In Progress:
- Broader preset coverage and safer operator controls.

Risks:
- Missing table sync leads to incomplete operational context in modules.

