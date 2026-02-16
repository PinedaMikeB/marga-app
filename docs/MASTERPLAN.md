# MARGA App Masterplan

## Purpose
MARGA is a modern web-based enterprise management system intended to replace the legacy VB.NET desktop app used for copier/printer rental operations.

## Why We Are Building This
- The legacy VB.NET app cannot be modified anymore.
- Operations must work on mobile (technicians, messengers, CSR).
- We want a single system that covers: customers, contracts, billing, collections, service dispatch, deliveries, inventory, and reporting.
- We need monitoring to reduce delays (pending parts, change unit requests, overdue tickets, etc.).

## Product Goals (North Star)
1. **Daily operations are visible**: today + carryover tasks, assigned staff, and pending categories.
2. **Fast dispatch**: CSR can create requests quickly; dispatch can assign/transfer; staff can close tasks in the field.
3. **Correct data**: system must match the business truth from the legacy database while we migrate.
4. **Mobile-first**: usable on phones without horizontal scrolling or hidden actions.
5. **Role-based privacy**: staff only sees what they need; admin can see everything.

## Constraints (Non-Negotiables)
- Static site: HTML/JS (Firebase via CDN/REST), no server required.
- Hosted on Netlify, developed locally then pushed to GitHub.
- Firestore is the operational datastore for the web app.
- Legacy database remains the source of truth during Phase 1.

## Phased Migration Strategy
### Phase 1: Mirror + Monitor (Current)
- Keep the legacy MySQL system running.
- Use MySQL dumps to sync new records into Firestore.
- Build web dashboards that read Firestore for monitoring and dispatch.

### Phase 2: Web Becomes Primary
- Rebuild billing/collection/service workflows directly in web app.
- Reduce dependency on dumps; eventually replace legacy workflows.

## Architecture Summary
- Frontend-only app (PWA later).
- Authentication/roles: `shared/js/auth.js` (local auth now; harden later).
- Firestore access via REST (`shared/js/firebase-config.js`).
- Modules as folders/pages:
  - Customers
  - Collections
  - Service Dispatch
  - Sync Updater

## Modular Architecture (How We Avoid Complexity)
Your idea is correct, but the right term is **modular frontend + shared backend**.

What we want:
- Each department/module (Service, Billing, Collections, Inventory, Field App, etc.) is its own page/folder with its own JS.
- Each module only loads the Firestore collections it needs (avoid “load everything everywhere”).
- Modules share data through Firestore. Firestore is effectively your API backend (even without a custom server).

Terminology note:
- When we say “branch” in planning, we mean **module/section** (not customer branch).

How modules “connect” without becoming tangled:
- Treat Firestore collections as **data contracts** between modules.
  - Example: Service creates/updates `tbl_schedule`.
  - Collections reads `tbl_schedule` only if needed for context, but doesn’t depend on Service UI code.
- Keep shared utilities in `shared/` only (auth, firebase config, small helpers).
- Avoid cross-importing module JS from other modules. Instead, duplicate small UI where needed or move it to `shared/components` deliberately.

Notes about “saving tokens / context limit”:
- That problem is mostly about AI assistance and long conversations.
- In the app, the equivalent problems are performance and complexity:
  - too many collections queried on every page
  - too much UI logic mixed together
- Modular pages + per-module data loading solves the app problems and also helps future AI sessions stay focused.

Security reminder:
- “Module separation” is not a security boundary.
- Real access control should be enforced with Firestore Security Rules (later) and careful UI checks (now).

## Data Strategy (Sync / Watermarks)
- Baseline Firestore dataset comes from the baseline dump (e.g. Dec 29, 2025).
- Each new dump is processed and only **new records** are added.
- Each table should track a watermark:
  - preferred: `max(id)` for the table
  - fallback: a stable datetime or composite key if table has no numeric ID

## Key UX Principles
- Default views should be department-scoped (Billing / Collection / Service).
- Admin can switch to unified view and analytics.
- Mobile layout uses cards instead of wide tables.
- Actions must never be hidden on mobile (no off-screen buttons).

## Known Gaps / Risks
- Some legacy tables are not yet synced (example: `tbl_branchcontact` for branch contact numbers).
- Creating new schedule IDs in Firestore using `max(id)+1` can collide if two users create at the same time.
- Firestore REST queries can require composite indexes; when possible prefer:
  - single-field range queries
  - client-side filtering for additional conditions

## References
- Handoff (what changed + what to do next): `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/HANDOFF.md`
- Changelog (versions/releases): `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/CHANGELOG.md`
