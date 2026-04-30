# Marga Managed Care

Customer-facing portal for service requests, billing history, payment records, printer usage, toner/ink monitoring, and support updates.

## Netlify Setup

Create a separate Netlify site connected to this same GitHub repo:

- Branch: `main`
- Base directory: leave blank
- Build command: leave blank
- Publish directory: `marga-managed-care`
- Custom domain: `care.marga.biz`

## Firebase

This app is configured to read from the same Firebase project used by Marga-App. The first live version ships with a demo-safe local mode until customer auth, scoped user profiles, and Firestore rules are finalized.

Relevant runtime file:

- `assets/js/config.js`

## Customer Scope Plan

Production customer access should be enforced by Firebase Authentication and security rules, not only by UI filters.

Expected profile shape:

```js
{
  role: "customer_admin",
  companyId: "72",
  branchIds: ["101", "102"],
  canViewBilling: true,
  canCreateService: true,
  canRequestToner: true
}
```

