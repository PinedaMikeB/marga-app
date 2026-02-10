# Changelog

This file records notable changes by version. Keep entries short and action-focused.

## Versioning
- Use CalVer: `vYYYY.MM.DD` for day-level releases.
- When multiple releases happen in a day, suffix: `vYYYY.MM.DD.1`, `vYYYY.MM.DD.2`, etc.

## Unreleased
- (Add items here while working; move to the next version on release.)

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
