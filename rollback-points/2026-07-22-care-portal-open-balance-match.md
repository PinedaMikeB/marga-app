# Rollback Note: Care Portal Open Balance Match

Created: 2026-07-22

Scope:
- `scripts/marga-service-portal-server.mjs`

Purpose:
- Make `/portal-api/invoices` use the same unpaid open-balance calculation as the dashboard summary.
- Return all open-balance invoice rows for the scoped customer/overseer account instead of a capped first 500 invoice rows.
- Return `amount` as unpaid balance, not original invoice total.

Source rule:
- Source table: `marga.billing_invoices`
- Payment/balance table: `marga.payments`
- Scope: portal account company/branch/companyIds scope through `portalScopeWhere`
- Dedupe key: invoice row `id`
- Amount shown: recorded payment balance when present, otherwise invoice total minus payments
- Paid rows: excluded when computed unpaid balance is `<= 0.01`

Rollback guidance:
- Restore the previous `listInvoices(user)` query if the owner requests the old capped invoice list behavior.
- Do not change invoice/payment data for rollback; this change is read-only.
