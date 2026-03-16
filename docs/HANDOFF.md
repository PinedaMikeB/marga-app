# MARGA Handoff (Single Source of Truth)

Last Updated: 2026-03-16  
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
- Keep sync updater reliable for live MySQL -> Firebase and limited Firebase -> MySQL writeback.
- Continue role/module access hardening before broader staff rollout.

## Next Actions
- Add Firebase Storage upload flow for before/after repair photos (currently metadata only).
- Build admin queue UI for serial correction approvals (`marga_serial_corrections`).
- Add module-level access toggles in Settings UI and enforce via auth + page guards.
- Turn the master sync coverage manifest into an executable office-side sync table manifest.
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
### 2026-03-16 - Sync Direction Rules And Live Coverage
- Added `/docs/MASTER-SYNC-COVERAGE.md` based on the live MySQL schema.
- Fixed live MySQL -> Firebase service route sync to catch updates to existing printed/saved route rows, not only new IDs.
- Confirmed service route close counts now align between MySQL and Firebase after mutable-row refresh.
- Defined business-direction rules below so handoff is clear on what should be `MySQL -> Firebase` versus limited `Firebase -> MySQL`.

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
- Live MySQL -> Firebase sync for service route tables (`tbl_schedule`, `tbl_printedscheds`, `tbl_savedscheds`, `tbl_schedtime`, `tbl_closedscheds`).
- Mutable route refresh now rescans recent `tbl_printedscheds` and `tbl_savedscheds` rows by timestamp and refreshes linked `tbl_schedule` docs.

In Progress:
- Convert the master sync coverage doc into an executable per-table manifest.
- Expand live MySQL -> Firebase coverage to Tier 1 customer, machine, contract, billing, collection, payment, delivery, petty cash, and refill tables.

Risks:
- Missing table sync leads to incomplete operational context in modules.
- A generic `id > last_id` rule is not enough for mutable operational tables.

## Transaction Direction Rules

These are business-flow rules for the hybrid phase. They describe which side should originate the transaction.

### MySQL -> Firebase Only

These should originate in legacy SQL/VB.NET and be mirrored into Firebase/web:

- new customer / company creation
- branch creation
- customer active / inactive tagging
- branch inactive tagging
- new machine creation
- machine master updates
- contract creation
- contract changes / renewal / termination / shutdown
- new invoice creation
- unpaid invoice / aging status
- collection queue creation from office workflows
- payment posting from office/accounting workflows
- OR / check / deposit records
- delivery receipt creation
- final DR processing
- pullout / machine pickup receipt creation
- petty cash transactions
- toner refill production records
- purchasing / receiving / release records

Reason:

- these are core office and finance transactions
- MySQL remains source of truth
- Firebase should receive them as mirrored operational data

### Firebase -> MySQL Only (Safe Reverse Bridge)

These may originate from the web app and write back to existing MySQL columns:

- field staff work notes
- field staff close / pending service status
- field `schedtime` logs
- meter readings captured in field
- customer signer / contact captured during field visit
- approved collection follow-up logs written from web

Reason:

- these are field-side operational updates
- they fit the current safe reverse-bridge model
- they do not require new SQL schema

### Firebase First, Then Controlled Writeback

These may start in Firebase/web, but only with explicit safe mapping and approval:

- serial correction requests
- parts-needed queue writes
- customer contact corrections
- admin-request style workflows

Reason:

- these are operational workflow items or staging records
- they may need review before touching legacy SQL

### Never Treat As Full Two-Way Free Edit

Do not allow unrestricted bidirectional editing for:

- customer master records
- machine master records
- contracts
- invoices
- payments
- collections principal records
- delivery / DR headers
- petty cash

Reason:

- these can create conflicts between VB.NET and web if both sides freely edit the same business object

### Field Staff Input Rules

Allowed from field app:

- close ticket
- mark pending / parts needed
- enter time in / time out
- enter meter reading
- update signer / contact actually met in field
- request serial correction
- add execution notes

Not allowed as direct master overwrite from field app:

- create new customer
- inactivate customer
- add new machine directly into master machine table
- create contract
- create invoice
- post payment
- issue DR / OR
- create petty cash record

Those should remain:

- office-side SQL transactions
- then mirrored to Firebase

