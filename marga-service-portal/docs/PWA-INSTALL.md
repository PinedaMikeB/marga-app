# Marga PWA Install Guide

## Shareable Landing Page

- Customer portal landing page: `/install/?target=portal`
- Tech landing page: `/install/?target=tech`
- Production domain examples:
  - `https://support.marga.biz/install/?target=portal`
  - `https://support.marga.biz/install/?target=tech`

Use the landing page when the link may open inside Messenger, Facebook, Instagram, or another in-app browser. The page attempts a best-effort handoff into Safari on iPhone/iPad or Chrome on Android, then forwards the user into the app with `?install=true`.

The app is configured as a real PWA through:

- root-scope service worker at `/service-worker.js`
- web app manifests for portal and tech
- installable app icons in PNG format
- Apple touch icons and iOS web-app meta tags

## Direct Install URLs

- Customer portal direct URL: `https://support.marga.biz/?install=true`
- Tech direct URL: `https://support.marga.biz/tech/?install=true`

These URLs open the app directly and trigger the in-app install guide overlay. Use them when the user is already in Safari or Chrome.

## User Flow

1. Share `/install/?target=portal` or `/install/?target=tech`.
2. The landing page attempts a browser handoff.
3. If automatic handoff fails, the page shows manual `Open in Safari` or `Open in Chrome` steps and a copy-link fallback.
4. The destination app route opens with `?install=true`.
5. The app shows device-specific install instructions.
6. After installation, the first standalone launch shows a one-time confirmation welcome.

## Browser Notes

- iPhone/iPad: installation must happen in Safari.
- Android: Chrome is the preferred browser for PWA installation.
- No browser can guarantee universal forced handoff from every in-app browser, so the flow uses best-effort deep links plus manual fallback.
