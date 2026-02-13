# Changelog

This file records notable changes by version. Keep entries short and action-focused.

## Versioning
- Use CalVer: `vYYYY.MM.DD` for day-level releases.
- When multiple releases happen in a day, suffix: `vYYYY.MM.DD.1`, `vYYYY.MM.DD.2`, etc.

## Unreleased
### Added
- Field App task modal now has explicit actions:
  - `Mark Finished` (requires 4-digit customer PIN verification)
  - `Mark Pending (Parts Needed)` (writes ongoing/pending flags and queues production request)
- Field App KPI now includes `Ongoing (Parts)` count.
- Field task cards now show a pending-parts note when applicable.
- Field App Update modal now includes:
  - searchable serial lookup from `tbl_machine`
  - missing-serial flow with admin queue (`marga_serial_corrections`)
  - model + brand autofill
  - machine status dropdown from `tbl_mstatus` (with fallback options)
  - parts-needed picker (database-driven catalog + quantity list)
  - meter block (previous/present/total consumed auto-compute)
  - time-in/time-out capture with log write to `tbl_schedtime`
  - customer signer/contact + delivery details + final acknowledgement summary
  - before/after photo capture inputs (metadata saved for now)
- Added `Save Draft` action in Field modal to persist updates without closing task.

### Changed
- Finished action is blocked when branch PIN is not configured (`marga_branch_pins/{branch_id}.pin` or `tbl_branchinfo.service_pin`).
- `Mark Finished` now clears pending flags and stores PIN verification audit fields on `tbl_schedule`.
- Field actions now save richer operational fields on `tbl_schedule` (`field_*` namespace) and keep legacy-compatible fields updated (`meter_reading`, `collocutor`, `phone_number`, `tl_status`, `tl_remarks`).
- Serial correction behavior changed for field users:
  - no free-text overwrite of machine master serial
  - official serial remap updates schedule machine reference
  - missing serial goes to admin-approval queue instead of direct master edit

## v2026.02.10
### Added
- Service Dispatch Board uses date-range Firestore queries (not “scan latest N then filter”).
- Carryover view: shows pending tasks from prior days on selected date.
- Status model: Pending / Carryover / Ongoing (parts) / Closed / Cancelled.
- Batch Carryover action (Admin/Service): move pending schedules to next day.
- Mobile responsive tables: staff/task tables collapse into card layout on small screens.
- CSR “New Service Request” modal:
  - request origin (viber/call/website chat/tech request/other)
  - company/branch search + filter
  - branch selection auto-prefills caller/contact and phone where data exists
- Field App (`field/`): technician/messenger view for “My Schedule” with task update + close task + serial correction.
- Settings module (`settings/`): admin user management (email login, roles, PBKDF2-hashed passwords, admin reset).

### Notes
- `tbl_branchcontact` is not currently synced into Firestore, so phone/contact auto-fill may be limited until that table is included in sync.
