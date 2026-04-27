# MSP - Marga Service Portal Deployment Guide

## 1) Project Structure

- `/public`
  - `/public/index.html` (customer portal shell)
  - `/public/tech/index.html` (tech mobile shell)
  - `/public/config.js` (runtime config + support channels)
  - `/public/manifest.json` and `/public/tech/manifest.json`
  - `/public/service-worker.js` and `/public/offline.html`
- `/src`
  - `/src/portal-main.js` (portal app logic)
  - `/src/tech-main.js` (tech app + offline queue)
  - `/src/lib/*` (data service, session, queue, pin hash, helpers)
  - `/src/styles/*` (shared + portal + tech styles)
- `firebase.json`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`
- `scripts/seed-firestore.mjs`

## 2) Firebase Prerequisites

1. Create Firebase project in [Firebase Console](https://console.firebase.google.com/).
2. Enable Authentication > Sign-in method > Email/Password.
3. Create Firestore database in production mode.
4. Enable Storage.
5. Register Web App and copy config values.

## 3) Configure Runtime

Edit `/public/config.js`:

1. Set `demoMode: false` once Firebase config is provided.
2. Fill in:
   - `firebase.apiKey`
   - `firebase.authDomain`
   - `firebase.projectId`
   - `firebase.storageBucket`
   - `firebase.messagingSenderId`
   - `firebase.appId`
3. Update support channels (`callNumber`, `email`, `whatsappUrl`, `viberUrl`).
4. Update announcements list if needed.

If Firebase config is empty, the app runs in demo mode automatically.

## 4) Deploy to Firebase Hosting

Run from project root:

```bash
cd /Volumes/Wotg\ Drive\ Mike/GitHub/Marga-App/marga-service-portal
npm i -g firebase-tools
firebase login
firebase use <your-project-id>
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
```

## 5) Domain Mapping (`support.marga.biz`)

1. In Firebase Hosting, add custom domain: `support.marga.biz`.
2. Add required DNS records in your DNS provider.
3. Wait for SSL provisioning.
4. Verify:
   - `https://support.marga.biz/` loads customer portal.
   - `https://support.marga.biz/tech/` loads tech app.

## 6) First-Time Admin Setup

### Option A: Seed script (recommended)

1. Create service account key and export credentials:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json
```

2. Install dependency and run seed:

```bash
npm i firebase-admin
node scripts/seed-firestore.mjs
```

3. Seeded logins:
- Corporate admin: `corporate.admin@marga-demo.com`
- Branch manager: `branch.manager@marga-demo.com`
- End user: `end.user@marga-demo.com`
- Tech: `tech.user@marga-demo.com`

### Option B: Manual setup

1. Create the first auth user in Firebase Auth.
2. Create `/users/{uid}` document with role `corporate_admin`, companyId, and profile data.
3. Create `/companies/{companyId}` and `/branches/{branchId}`.
4. Add devices in `/devices` with `companyId` + `branchId`.
5. Add authorized signers in `/authorized_signers` with **hashed** PIN (`sha256("<signerId>:<pin>")`).
6. Create branch manager and end user accounts in Auth + `/users` docs.

## 7) RBAC and Security Behavior

- `corporate_admin`: all branches in own company, invoices, devices, tickets, signers admin.
- `branch_manager`: own branch devices/tickets/toner + branch billing only.
- `end_user`: create and track own tickets, create own toner requests, no billing access.
- `tech`: ticket workflow + onsite completion; PIN must match branch authorized signer.

Security enforcement is in `firestore.rules` and `storage.rules` (not UI-only).

## 8) PWA Validation

1. Open portal and tech routes on mobile Chrome.
2. Confirm install prompt appears (`Install App` button).
3. Go offline after opening once:
   - Portal shell should still load.
   - Tech completion should queue with `Pending Sync` and upload when online.
4. Validate the shareable landing routes:
   - `https://support.marga.biz/install/?target=portal`
   - `https://support.marga.biz/install/?target=tech`
5. From an in-app browser, confirm the landing page attempts handoff to Safari or Chrome and still shows manual fallback instructions plus a copy-link button if handoff is blocked.

## 9) Notes for Production Hardening

- Rotate seeded/default passwords immediately.
- Consider adding Cloud Functions for stricter server-side PIN verification workflow.
- Monitor `authorized_signers/{id}/pin_attempts` for audit and anomaly detection.
