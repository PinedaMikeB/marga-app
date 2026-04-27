# Marga Service Portal (MSP)

Production-ready web app + tech mobile PWA built with plain HTML/CSS/JS and Firebase.

## Apps

- Customer Portal: `/` (`/public/index.html`)
- Tech Mobile App: `/tech/` (`/public/tech/index.html`)
- Install landing page: `/install/`

## Key Features

- Multi-tenant data model (`companies`, `branches`, `users`, `devices`, `tickets`, `toner_requests`, `invoices`, `payments`, `authorized_signers`)
- RBAC for `corporate_admin`, `branch_manager`, `end_user`, `tech`
- Ticket + toner workflows
- Billing visibility by role
- Tech completion with authorized signer PIN + optional signature/photo
- Offline queue + sync for tech completions
- Installable PWA for portal and tech
- Demo mode when Firebase config is not set

## Core Files

- `/public/*`
- `/src/*`
- `/firestore.rules`
- `/storage.rules`
- `/firebase.json`
- `/firestore.indexes.json`
- `/scripts/seed-firestore.mjs`

## Setup and Deployment

See `/docs/MSP-DEPLOY.md` for full steps.
See `/docs/PWA-INSTALL.md` for the shareable install links and browser-handoff flow.
