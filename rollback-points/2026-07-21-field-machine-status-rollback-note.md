# Rollback Note: Field Machine Status

Created: 2026-07-21

Scope:
- `service/index.html`
- `service/js/dispatch-board.js`
- `service-worker.js`
- `marga-service-portal/public/index.html`
- `marga-service-portal/public/service-worker.js`
- `marga-service-portal/service-worker.js`
- `marga-service-portal/src/portal-main.js`
- `scripts/marga-service-portal-server.mjs`

Purpose:
- Rename CSR workflow label from `Status` to `Ticket Status`.
- Add required `Field Machine Status` to the CSR New Service Request form.
- Add required `Field Machine Status` to the customer portal quick request and Create Ticket forms.
- Save `field_work_machine_status_id` and `field_work_machine_status` on service schedules and portal tickets.
- Make fleet uptime depend only on explicit non-OK Field Machine Status values `2`, `3`, or `4`.

Rollback guidance:
- Because this worktree already had unrelated pending edits in several portal files, do not run a broad file checkout.
- To roll back only this change, reverse the items above manually:
  - Remove `newReqFieldMachineStatus` from the CSR modal and save payload.
  - Change the CSR label `Ticket Status` back to `Status`.
  - Remove customer portal `fieldWorkMachineStatusId` form fields and payload fields.
  - Restore portal uptime checks to the previous open-service logic if the owner requests it.
  - Revert script/service-worker version strings to the previous deployed values.

Database:
- Columns already existed before this final check:
  - `marga.portal_service_tickets.field_work_machine_status_id`
  - `marga.portal_service_tickets.field_work_machine_status`
- No existing data was deleted.
