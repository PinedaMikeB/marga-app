# Rollback Note: Care Portal Service Request Schedule Bridge

Created: 2026-07-22

Scope:
- `scripts/marga-service-portal-server.mjs`

Purpose:
- Customer portal service tickets now create a real `tbl_schedule` document through the local Margabase document API.
- The portal ticket stores `schedule_legacy_id` so the linked schedule can be audited or cleaned up later.
- Customer-created schedules carry:
  - portal ticket id / ticket number
  - company, branch, machine, serial, model
  - purpose/trouble/remarks
  - mandatory Field Machine Status
  - `source_module = customer_portal`
  - `tech_id = 0` until CSR/Master Schedule assigns a technician

Cleanup guidance for test records:
- Use a clear marker in the description, for example:
  `TEST ONLY - CUSTOMER PORTAL SERVICE REQUEST - DELETE AFTER VALIDATION`
- Find linked test rows by:
  - `marga.portal_service_tickets.description ilike '%TEST ONLY - CUSTOMER PORTAL SERVICE REQUEST%'`
  - `app_meta.firestore_documents.collection = 'tbl_schedule'`
  - `data->>'portal_ticket_id'`
  - `data->>'portal_ticket_no'`
- Delete only the exact test portal ticket and exact linked `tbl_schedule` document after validation.

Rollback guidance:
- Remove the call to `createScheduleForPortalTicket()` inside `createTicket()`.
- Stop writing `schedule_legacy_id` / `schedule_created_at` if the owner asks to return to portal-only tickets.
- Do not delete real customer service schedules during rollback.
