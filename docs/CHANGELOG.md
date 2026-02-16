# MARGA Changelog

All notable changes to this project are documented in this file.  
This is the canonical release/change log for all modules.

## Format Rules
- Versioning: CalVer (`vYYYY.MM.DD` and optional `.1`, `.2` for multiple same-day releases).
- Group entries by module for quick thread-level updates.
- Keep entries short and implementation-specific.

## Unreleased

### Field App
#### Added
- Expanded technician update modal with:
  - searchable serial selection from machine database
  - missing serial request flow (admin approval queue)
  - model/brand and machine status capture
  - parts needed list with quantity
  - meter and time capture
  - delivery + empty pickup + customer acknowledgement fields
  - save draft, pending, and finished actions

#### Changed
- Pending and finish actions now persist richer operational data on schedule records.
- Finish flow remains PIN-gated and logs close audit metadata.

### Documentation
#### Added
- New canonical handoff at `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/HANDOFF.md`.

#### Changed
- Root `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md` is now a redirect pointer to avoid duplicate truth.
- Changelog format standardized for module-focused thread updates.

## v2026.02.10

### Service Dispatch
#### Added
- Date-range Firestore query loading for selected day operations.
- Carryover support for pending tasks from previous days.
- Task status model: Pending, Carryover, Ongoing (Parts), Closed, Cancelled.
- Batch carryover action for admin/service roles.

### UX
#### Added
- Mobile-responsive adaptations for operations tables and task views.

### Field App
#### Added
- Initial “My Schedule” field module for technician/messenger task handling.

### Settings/Auth
#### Added
- Admin user management with role-based access and password handling.

