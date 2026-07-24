# MARGA Handoff

Last Updated: 2026-07-17 (Dark theme redesign + video intro + fleet health + CRITICAL: black screen bug unresolved)
Canonical Status: Single source of truth for current operational handoff

Start every new Marga-App thread by reading:
1. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md`
2. `/Volumes/Wotg Drive Mike/GitHub/Marga-App/MASTERPLAN.md`
3. `/Volumes/Wotg Drive Mike/GitHub/marga-platform/skills/marga-database-migration/SKILL.md` when the work touches database migration, backend cutover, rescue sync, Margabase compatibility APIs, or production write paths.

## 2026-07-22 — care.marga.biz Cloudflare 502 Prevention

**Incident:** `care.marga.biz` showed Cloudflare 502 Bad Gateway while `app.marga.biz` still loaded.

**Root cause:** Cloudflare Tunnel was running, but the local Marga Care portal origin on `127.0.0.1:9200` was not healthy. The LaunchAgent `com.marga.service-portal` sources `/Users/mike/.marga-launchd/margabase.env`, and that file contained an unquoted display-name email sender value:
`MARGA_BILLING_APPROVAL_EMAIL_FROM=Marga Billing <solutions@marga.biz>`.
The `<...>` portion was treated by shell as redirection, causing `source margabase.env` to fail with `syntax error near unexpected token newline`; the portal never started, so Cloudflare could only return a host/origin 502.

**Fix applied:** Backed up the env file to `/Users/mike/.marga-launchd/margabase.env.backup-before-care-fix-20260722-1518`, changed the sender value to quoted shell syntax, and restarted `com.marga.service-portal`. Public verification returned `HTTP/2 200` for `https://care.marga.biz/`.

**Prevention rule:** Any value in `margabase.env` that contains spaces, `<`, `>`, `&`, `|`, `;`, or parentheses must be quoted. Before restarting launchd services or editing SMTP sender settings, run:
`bash scripts/check-marga-launch-health.sh`

## Current Focus (2026-07-17)

### ⚠️ CRITICAL BUG — Black Screen After Intro (UNRESOLVED)

**Symptom:** After the logo intro video plays (or skips), the page shows black with only the topbar (hamburger + logo + Online). Neither the login form nor the dashboard loads. Happens on desktop Chrome, mobile Chrome, iOS Safari, and incognito.

**Console errors seen:**
- `service-worker.js:54 Failed to execute 'put' on 'Cache': Partial response (status code 206) is unsupported`
- `503 (Offline)` — returned by old cached service worker when offline fallback triggers
- `401 (Unauthorized)` on `/portal-api/me` — session expired but auth view not showing
- `Cannot access 'fleet' before initialization` — was fixed but may still be cached

**Root cause identified:** The old service worker (`CACHE_NAME = 'msp-shell-v12-themed-marga-logo'`) caches `portal-main.js`, `app.css`, and `index.html` WITHOUT version strings. Every browser that visited before gets OLD cached JS/CSS, ignoring all server-side fixes. Even after bumping the cache name to `v20260717-dark-3`, the old SW must finish its lifecycle before the new one activates.

**What was tried:**
1. Bumped service worker cache name 3 times (v12 → v20260717-dark → dark-2 → dark-3)
2. Added query string cache busters to all `<link>` and `<script>` tags
3. Added force-unregister script at top of `<body>` that calls `navigator.serviceWorker.getRegistrations().forEach(r.unregister())`
4. Disabled SW registration in `pwa.js` (commented out)
5. Added `window.__margaIntroDone` global flag to fix race condition between inline intro script and deferred module script
6. Wrapped `renderDashboard` Promise.all in try/catch → shows auth on failure
7. Added `init().catch()` that always shows auth view on any crash

**What still needs to happen:**
- The service worker file itself (`/service-worker.js`) served by Cloudflare tunnel may ALSO be cached at the Cloudflare edge. Even though the file on disk is updated, Cloudflare may serve the old version.
- **Fix approach:** Either rename `service-worker.js` to a different filename (breaks the SW scope), OR add `Cache-Control: no-cache` headers for `.js` files in the portal server, OR purge Cloudflare cache for care.marga.biz.
- The `service-worker.js` at line 54 has a `cache.put()` call that fails on 206 partial responses (video files). This error itself may crash the SW and prevent it from activating the new cache.

**Rollback available:** Git commit `62568e7` — pre-dark-theme, pre-video-intro, everything was working. Run `git checkout 62568e7 -- marga-service-portal/` to restore the old working version if needed.

---

### Dark Theme Redesign — NajmAI-Inspired (COMPLETED 2026-07-16)

**Design system:**
- Pure black `#000` background, dark surfaces `#0a0a0f` to `#252530`
- Accent: `#8b78ff` (indigo-violet)
- Font: DM Sans (Google Fonts)
- Glass morphism cards with `backdrop-filter: blur(20px)`
- Ambient glow background with animated radial gradients
- NajmAI-style staggered reveal-up animations on auth page

**Files changed:**
- `marga-service-portal/public/index.html` — full rewrite: video intro overlay, dark auth page, portal shell
- `marga-service-portal/src/styles/app.css` — full rewrite: dark CSS system (700+ lines)
- `marga-service-portal/src/styles/portal.css` — full rewrite: dark portal components (900+ lines)
- `marga-service-portal/src/portal-main.js` — dashboard redesign, fleet health, back bars, quick request

### Video Intro System (COMPLETED 2026-07-17)

**How it works:**
1. Logo intro video (`marga-intro-v1.mp4`, 683KB, 1:1 square) plays on page load
2. `marga:intro:done` event fires when video ends, skip is tapped, or 7s hard timeout
3. `window.__margaIntroDone = true` flag set for race condition safety
4. `waitForIntro()` in `portal-main.js` resolves on flag or event
5. `init()` proceeds → `restoreSession()` → dashboard or auth

**Video assets:**
- `/public/assets/marga-intro-v1.mp4` — logo reveal video (1:1, 683KB, Kling v1.6 pro)
- `/public/assets/fleet-repair-desktop.mp4` — technician repair cinematic (475KB)
- `/public/assets/fleet-repair-mobile.mp4` — portrait crop (158KB)
- `/public/assets/marga-bg-desktop.mp4` — network animation slowed 2.5x (500KB)
- `/public/assets/marga-bg-mobile.mp4` — portrait crop (151KB)
- `/public/assets/marga-bg-poster.jpg` — static poster fallback (48KB)
- `/public/assets/icons/marga-logo-topbar.png` — Marga logo for nav (684KB)

### Kling AI MCP Integration (COMPLETED 2026-07-15)

**Setup:**
- Custom MCP server at `/Volumes/Wotg Drive Mike/GitHub/kling-mcp-direct/server.mjs`
- Uses Kling API 2.0 with single bearer token (`api-key-kling-xxx` format)
- Supports: `kling_generate_video` (text2video), `kling_generate_video_from_image` (image2video with start+end frames), `kling_check_task`, `kling_account_info`
- Config in `~/Library/Application Support/Claude/claude_desktop_config.json`
- Models available: kling-v1, kling-v1-6, kling-v2-master, kling-v2-5-turbo, kling-v3

**Key learnings:**
- Only kling-v1-6 supports BOTH start AND end frame (`image` + `image_tail` params)
- v2-master rejects `image_tail` with error 1201
- Prompt max length: 2500 characters
- `cfg_scale: 0.9` for maximum fidelity to source images
- Images must be publicly accessible URLs (hosted on care.marga.biz/assets/)
- Videos downloaded to `/Volumes/Wotg Drive Mike/GitHub/kling-mcp-direct/downloads/`
- Compress with ffmpeg: `ffmpeg -i raw.mp4 -vf "scale=1280:720" -c:v libx264 -crf 26 -preset slow -an -movflags +faststart output.mp4`

### Dashboard Improvements (COMPLETED 2026-07-16)

1. **Honest fleet uptime** — `(total - affected) / total * 100` where affected = machines with no serial + branches with open portal tickets
2. **Combined hero + fleet health section** — repair video background, MARGA CARE eyebrow + company name + fleet pills
3. **2 KPI cards** — Open Service Requests + Next Billing (removed Last Service, Last Toner cards)
4. **Scrolling activity ticker** — 90s horizontal scroll, shows completed service/toner events, pauses on hover
5. **Back bar on every submodule** — `← Home` button on Machines, Service Requests, Toner, Billing, History
6. **Customer rating system** — `customer_rating`, `customer_comment`, `rated_at` columns on `portal_service_tickets`
7. **Staff blocking gate** — `marga.staff_schedule_acknowledgements` table, forces field staff to acknowledge unclosed schedules
8. **Data cleanup** — 2,216 migration artifact schedules closed (NULL/year-2000 dates)

### UI/Layout Changes (COMPLETED 2026-07-17)

1. **Sidebar removed from desktop layout** — hamburger-only nav on all screen sizes
2. **Topbar simplified** — hamburger + Marga logo (left) + phone/chat/Online (right), no title text, no user avatar
3. **User profile in sidebar only** — avatar, name, role, logout in slide-out panel
4. **Bottom nav removed** on mobile
5. **Service worker disabled** — was caching stale files causing black screen

---

## Previous Focus (2026-07-14)

### Care Portal Phase 1 "Make It Feel Alive" — COMPLETED

**Goal:** First-time login should feel like the portal already knows them.

**Changes shipped:**

1. **New `listServiceHistory(user)` server function** (`scripts/marga-service-portal-server.mjs`)
   - Queries `tbl_schedule` via `app_meta.firestore_documents` for all completed service, toner/ink, and reading events across all scoped branches.
   - Returns `byBranch` map: per-branch `lastService`, `lastToner`, `lastReading` (date, serial, notes).
   - Returns `recentEvents` array: top-20 cross-branch events for activity feed.
   - Returns `summary.lastService` / `summary.lastToner` for the most recent event across all branches.
   - Purpose ID mapping: 3=Toner/Ink, 4=Cartridge, 5=Service, 8=Reading, 9=Others.

2. **`summary()` enriched** (`scripts/marga-service-portal-server.mjs`)
   - Now calls `listServiceHistory()` in parallel and adds `lastService`, `lastToner`, `nextBillingDue` to the response.
   - `nextBillingDue` = soonest unpaid invoice due date (ISO date string).

3. **New `/portal-api/service-history` endpoint**
   - Returns `{ byBranch, recentEvents, summary }`.
   - Scoped by portal user scope (same `previewScopedUser()` pattern as all other endpoints).

4. **`DataService.getServiceHistory(user)` added** (`marga-service-portal/src/lib/data-service.js`)
   - Calls `/portal-api/service-history`.

5. **Dashboard redesigned** (`marga-service-portal/src/portal-main.js`)
   - KPI strip replaced with smart "alive" cards: Last Service (days ago + branch), Last Toner/Ink, Next Billing Due.
   - Activity feed added: top 5 recent service/toner events from `tbl_schedule` with branch name + relative date.
   - `daysAgo()` helper converts ISO dates to human-readable relative strings.
   - Falls back gracefully if service history is unavailable (no breakage).

6. **Machines list enriched** (`marga-service-portal/src/portal-main.js`)
   - Two new columns: **Last Service** and **Last Toner** — show relative dates (e.g. "3d ago", "2mo ago").
   - Green color when data present; grey "—" when no data on record.
   - Hidden on mobile (≤700px) to preserve table readability.
   - Uses `device.branchLegacyId` to join against `histByBranch` from service history API.

7. **CSS additions** (`marga-service-portal/src/styles/portal.css`)
   - `.kpi-eyebrow`, `.value--text`, `.kpi-card--service/toner/billing` (accent border).
   - `.dashboard-activity-feed` and activity row styles.
   - `.care-device-grid--with-history` 7-column grid.
   - `.device-hist--ok` (green) / `.device-hist--none` (grey).
   - Mobile breakpoint hides history columns at ≤700px.

**Files changed:**
- `scripts/marga-service-portal-server.mjs` — `listServiceHistory()`, `summary()`, new route
- `marga-service-portal/src/lib/data-service.js` — `getServiceHistory()`
- `marga-service-portal/src/portal-main.js` — `renderDashboard()`, `renderDevices()`, `daysAgoShort()`
- `marga-service-portal/src/styles/portal.css` — Week 1 CSS block appended

**Critical bug fix — same session:**

- **Wrong data source diagnosed**: Initial `listServiceHistory()` queried `app_meta.firestore_documents` (raw Firestore JSON mirror) which has dirty data — `task_datetime` values like `"22026-04-29"`, `"2027-01-01"` (fake future dates), and `"undefined 00:00:00"` (literal string). These caused `event_date` to sort incorrectly and the `globalLastService` comparisons to fail, so the dashboard showed "No service on record" even though the activity feed was partially working.
- **Correct source**: `marga.service_schedules` — the relational mirror with typed `date_finished` (timestamptz), `scheduled_date` (date), and `branch_legacy_id` (text). 187,988 completed customer-visible records, latest dated today.
- **Fix**: Rewrote `listServiceHistory()` to use `marga.service_schedules` joined to `api.active_customer_graph` via `branch_legacy_id`. Single CTE query with `DISTINCT ON (branch_legacy_id, event_type)` for efficient per-branch latest-event lookup. Date filter: `date_finished >= now() - interval '3 years'` and `<= now() + interval '1 day'` to exclude bad data.
- **Verified for CBS** (company_id 836): query returns 8 rows covering service + toner across 156 branches, latest Cartridge Delivery at Sta Ana (CBS) today at 04:38 UTC.
- **Rule going forward**: Always use `marga.service_schedules` for schedule history queries, not `app_meta.firestore_documents`. The Firestore JSON mirror has dirty string data; the relational table has clean typed columns.

**Next up (Week 2 — Phase 2):**
- Email confirmation on service/toner request submit (Hostinger SMTP already wired)
- Service team notification email to solutions@marga.biz
- Ticket status feedback from Field App → portal (Pending → Dispatched → Completed)

---

## Previous Focus (2026-07-13)

### Care Portal + Billing Grid Completeness — COMPLETED YESTERDAY
- **Needs Attention count** brought from 7 → 0 for CBS (China Bank Savings).
- **4 phantom contracts deactivated** (status → 7): ~xxAraneta (46), ~xxMckinley Hill (90), San Fernando scan/cat4 (3569), San Pablo scan/cat4 (3849).
- **3 legacy CBS contracts deactivated**: ~xx Koronadal (3519), ~xxCebu Lahug #1 (623), ~xxCebu Lahug #2 (624).
- **Portal generator fixed**: `loadBillingCompanies()` changed from `JOIN billing_companies` (requires invoices) to `LEFT JOIN` so companies with active contracts but no invoice history still get portal accounts.
- **983 → 1,249 branch portal accounts** created. Total portal accounts: 1,283 → 2,319.
- **Nightly LaunchAgent installed**: `com.marga.care-portal-sync` runs at 3:15 AM daily to keep portal accounts in sync with active contracts.
- **Bucket C companies** (service calls but zero billing): 13 branches across 11 companies identified. Root cause — `location` field NULL in `tbl_contractmain` Firestore so billing cohort couldn't link them to a branch. **19 contracts patched** via `scripts/patch-bucket-c-contract-locations.mjs`.
- **Machine history fixes**: 3K & Percz (machine 2692, branch 1598) and ASYM (machine 2776, branch 983) had stale pull-out entries as latest `tbl_newmachinehistory` rows. New status=2 entries added (doc IDs 27120, 27121) dated 2026-07-13.
- **ASYM / Uplift Cares / N/A**: REF/MAT category contracts (9, 4, 12) — correctly excluded from `FOR_READING_CATEGORY_IDS` billing grid. These are refill/materials accounts billed per delivery, not monthly meter rental.
- **Salvador Llanillo**: machines pulled out Aug/Sep 2024, single service call dated 2028 (data entry error). Genuinely inactive — no fix needed.
- **Bucket A data bug**: earlier audit falsely showed 47 branches with ₱373K billing because Firestore `tbl_billing.branch_id` is legacy_id, not relational id. Joins must use `marga.branches.legacy_id`, not `marga.branches.id`. All corrected.
- **Portal server group filter bug fixed**: `const user` → `let user` in `marga-service-portal-server.mjs`. Was causing `Assignment to constant variable` 500 error on every group switcher change. Server restarted (PID 37661).
- **Billing apply-quota per-line checkbox**: added per-meter line "Apply Quota" checkbox in `billing/js/billing.js` (`renderMeterLineCard`, `readLineApplyQuota`, `estimateLineFromSeed`). Default checked; when unchecked, charges actual consumption only.

### Remaining / Deferred
- **Koronadal and Cebu Lahug CBS** (contracts 3519, 623, 624): deactivated today. Reactivate if client returns.
- **Bucket C revenue follow-up**: Attila Inc (~₱41,600), Storeminder (~₱44,400), Uplift Cares, Metropolis Construction, etc. Billing team advised. Serial data and addresses documented in this session.
- **Unknown "N/A" customer** (branch legacy 1137, 49 service calls in 2026): REF/MAT contracts, not in billing grid by design. Operations team must identify who this customer is.
- **Bucket E (260 branches, 189 companies)**: no billing, no 2026 service. Operations triage needed — dormant, lost contact, or data artifact.


- **2026-06-19 Master Schedule / Field App unification plan (canonical next step):**
  - `tbl_schedule` is the only operational source of truth for route/workload rows.
  - `app_meta.master_schedule_snapshot` is read-only cache / read model only. It must never become a second source of truth.
  - Master Schedule and Field App must read the **same snapshot payload**, built from the **same canonical query/bucket logic**, so counts and visible rows are identical for the same staff/date.
  - Neither UI should keep separate browser-side workload counting logic once Phase 1 is complete.
  - Snapshot rebuilds should happen in the backend after `tbl_schedule` writes, not because a browser changed date or ran a heavy page scan.
- **2026-06-19 schedule incident lesson (do not repeat):**
  - Billing had been writing a planner/support row first and the real `tbl_schedule` row second. That split write path allowed staff to appear assigned while `new today` was missing in Field App/Master Schedule when the second write drifted or failed.
  - Canonical rule now: **Billing, Collections, Service, and Purchasing must write schedule rows directly to `tbl_schedule`**. Do not put `tbl_schedule_planner` back into the operational write path for staff schedule creation, reassignment, close request, or route visibility.
  - `tbl_schedule_planner` may exist only as legacy/reference data while old rows are still present. It is not a source of truth for live route counts, live assignment, or snapshot generation.
  - Real incident fixed on Friday, June 19, 2026: `18` billing rows were found with `original_sched='2026-06-19'` but `task_datetime='2026-06-20'` (`15` for Armond A. Rubiz, `3` for Carlos Edaño). Those rows were repaired back onto the correct June 19 date from `tbl_schedule`, then the backend snapshot queue was rebuilt.
  - Reusable repair script for this exact class of issue: `/Volumes/Wotg Drive Mike/GitHub/marga-platform/scripts/repair-shifted-billing-schedule-dates.mjs --date=YYYY-MM-DD [--apply]`
- **2026-06-19 Master Schedule snapshot queue (already implemented):** backend writes now enqueue affected rebuild dates into Postgres table `app_meta.master_schedule_snapshot_rebuild_queue` through a trigger on `app_meta.firestore_documents`, and the Margabase API can process the queue through `GET/POST /admin/master-schedule-snapshot/queue` or script `scripts/process-master-schedule-snapshot-queue.mjs`. Hot rebuild dates currently include the changed schedule date, its next-day carryover date, plus Manila `today` and `tomorrow` so Master Schedule can stay warm without a browser-triggered rescan.
- **2026-06-24 snapshot freshness lesson (new canonical guardrail):**
  - Enqueuing snapshot rebuild dates is not enough. The backend must also run an always-on queue worker so pending `tbl_schedule` writes are rebuilt even when no later browser action wakes the processor.
  - Canonical behavior now: keep the write-triggered debounce for fast local rebuilds, but also keep a background queue drain on the Margabase API process so future-dated Billing/Collections/Service/Purchasing schedules still appear in Field App the next day without needing a manual Refresh/Rescan/Rebuild click.
  - If staff say "the schedule saved yesterday but is missing today," check `app_meta.master_schedule_snapshot_rebuild_queue` first before blaming the browser UI.
- **2026-06-25 Billing/Collections missing route lesson (new canonical guardrail):**
  - The repeating miss was not only snapshot freshness. Some Billing schedule writes were saving the visible assignee name and the numeric `tech_id` for different people.
  - Field App and Master Schedule route ownership follow `tbl_schedule.tech_id`, not the displayed assignee name. If those drift apart, office modules can look correct while the intended field staff sees no route.
  - Canonical protection now: Billing and Collections schedule pickers must allow only real field-capable staff roles (`messenger`, `driver`, `technician`, `production`), and Billing must resolve the live dropdown selection into one canonical `{staffId, staffName}` pair immediately before every `tbl_schedule` write. Never trust stale modal state for assignment.
  - Reusable live check: compare `tbl_schedule.tech_id` against the visible assigned name for recent Billing/Collections rows before blaming snapshot rebuilds.
- **2026-06-25 same-location combine ownership rule (new canonical guardrail):**
  - Do not silently force Billing/Collections/Service schedules onto the existing same-location owner.
  - When a customer/location already has another same-day schedule, the scheduler must get an explicit choice: combine under the suggested owner, keep the newly selected assignee as a separate visit, or cancel and change staff.
  - The combined-visit metadata (`combined_visit_*`) is still useful for route grouping, but ownership transfer must be an intentional office decision, not an automatic reassignment hidden behind Save Schedule.
- **2026-07-07 closed-schedule reappearance lesson (new canonical guardrail):**
  - Shared snapshot payloads can be briefly stale or can still include rows that belong in the Closed bucket.
  - Field App and Master Schedule must never rebuild `today` / `past pending` workload buckets directly from snapshot IDs without rechecking the canonical `tbl_schedule` close state first.
  - Canonical protection now: active workload buckets must exclude rows already marked closed/cancelled in `tbl_schedule` (`date_finished`, `closedby`, route close markers), while the Closed tab/bucket can still display them separately for the selected date.
- **2026-07-08 attendance adjustment UI rule (new canonical guardrail):**
  - The shared Time Record adjustment workflow is used by Field App, Dashboard, HR, and the approval page. Do not fork one page's behavior away from the others.
  - The staff-facing button should be `Fix Time`, not `Fix Time In`, and the same shared request form must support adjusting `time in`, `time out`, or both while preserving the HR approval flow.
  - Keep the existing attendance-adjustment request family backward compatible when widening the UI, because HR/payroll approval may still rely on the same request collection and approval endpoint.
- **2026-06-19 planned implementation phases for schedule parity:**
  - **Phase 1:** both UIs write directly to `tbl_schedule`; backend snapshot rebuild picks up the change; both UIs read the same snapshot; add only light/quiet partial refresh behavior; do not auto-refresh whole page; never wipe fields while staff are encoding.
  - Current update model as of June 19, 2026: yes, **light polling**. The browser should poll quietly for snapshot freshness / partial row refresh after writes, while the backend queue performs the actual snapshot rebuild. The browser must not rebuild the whole schedule from broad scans and must not reload the page automatically during active work.
  - **Phase 2 (next thread / target Saturday 2026-06-20):** replace or reduce light polling with websocket/push-style updates so the browser receives `snapshot updated` events and patches only the affected row/staff/date widgets.
- **2026-06-16 shipped (verified on `app.marga.biz`):** **Purchasing** module at `/purchasing/` — Money Request item fields + Set Schedule for field staff (`purpose_id: 7`). Dashboard sidebar: **Purchasing** (after Receiving).
- **2026-06-22 owner testing workflow (canonical):**
  - Update local `Marga-App` code in `/Volumes/Wotg Drive Mike/GitHub/Marga-App`.
  - Deploy that local code to the live app served at `app.marga.biz` through the current Cloudflare-backed production path so the owner can test the real live behavior before any GitHub push.
  - Wait for the owner's live test result.
  - If the owner says the live test worked, sync the same verified change to staging (`Marga-App-staging` / `codex/staging`).
  - After staging sync is complete, commit and push the verified change to GitHub `main`.
  - Do not push to GitHub `main` before the owner confirms the live `app.marga.biz` test passed, unless the owner explicitly asks for an immediate push.
  - Always distinguish clearly between: local code change, live deployment to `app.marga.biz`, staging sync, and GitHub `main` push.
  - Hard refresh after deploy for service worker cache. Staging is not the first acceptance gate for normal UI/module work.
- Standing Codex purpose from the owner:
  - Protect the owner from unnecessary cost. Before acting, prefer the cheapest safe path that keeps business data accurate and avoids repeated paid reads/writes, recurring services, wasteful scans, duplicate manual work, and repeated prompts for problems already solved.
  - If a workflow, report, query, UI pattern, rescue command, or business rule will likely be reused, preserve it in `MASTERPLAN.md`, `HANDOFF.md`, `AGENTS.md`, a script, an automation, or a skill so future work starts from the proven method instead of rediscovering it.
  - Error-resolution learning rule: every real bug, migration miss, costly mistake, repeated prompt, or staff data-entry failure must be treated as a reusable lesson. After resolving it, Codex should actively decide whether to create or update a skill under `/Volumes/Wotg Drive Mike/GitHub/marga-platform/skills`, link it into `/Users/mike/.codex/skills` when broadly useful, and reference it here/masterplan/agents so the same mistake is prevented next time.
  - When building modules, anticipate preventable mistakes: use searchable dropdowns for real records, line-item tables/grids for financial details, explicit validation and audit reports for money/status changes, and reusable shared helpers where repeated logic would drift.
  - UI copy should stay minimalist by default. If a control already has a clear label like `Customer` or `Branch / Department`, do not add extra helper text that merely restates the label. Prefer plain white controls and low-noise layouts unless the extra instruction prevents a real user mistake.
  - Mobile-first module rule: every module must adapt cleanly to phone and tablet screens. Tables must remain horizontally swipeable left/right instead of crushing columns, search boxes must resize and stay usable on narrow widths, and controls should remain responsive/adaptive without hiding critical actions.
  - Always ask: what can go wrong, what can create cost, what can create duplicate work, and what can be prevented now without overbuilding?
- 2026-06-01 DigitalOcean managed Postgres incident and infrastructure direction:
  - 2026-06-01 10:37 PM Manila Collections summary checkpoint:
    - After the DO-to-local raw-document backfill for May 30 and June 1, the accepted browser calculation was run once from the Collections **Load Data** button and saved to local Postgres permanent summary table `app_meta.collections_matrix_snapshot`.
    - Current saved row `id='current'`: `built_at=2026-06-01T22:37:31.464137+08:00`, `built_by=michael.marga@gmail.com`, `build_source=manual-full-scan`, `row_count=1926`, `pending_cell_count=5350`, `window_start=2025-09-30`, `window_end=2026-11-30`, payload about `43,405,996` bytes.
    - The new visible dashboard activity increased from the earlier pre-backfill screenshot (`Confirmed Collections 2`, `Total Calls 5`) to the rebuilt current scan (`Confirmed Collections 15`, `Total Calls 17`), which matches the expectation that June 1 operational records were copied back from DigitalOcean.
    - After saving this checkpoint, the Collections full-scan button was closed again in the app code so normal staff loading reads the permanent Postgres summary rather than rerunning a heavy browser scan.
  - 2026-06-01 11 PM Manila backup/restore proof:
    - Latest manual backup folder in Google Drive Desktop is `BU060126-MargaDB-20260601-225952`; the older `BU060126-MargaDB` is the scheduled 2:45 PM backup from the same day.
    - Restored the latest Google Drive dump into the separate test database `margabase_restore_test` without touching production `margabase`.
    - Test restore verification: `firestore_documents=5,700,085`, `raw_collections=290`, `billing_invoices=78,625`, `payments=117,903`, `service_schedules=323,394`.
    - Permanent Collections summary is included in the backup because it lives in Postgres table `app_meta.collections_matrix_snapshot`; restored row showed `row_count=1926`, `pending_cell_count=5350`, payload about `43,405,686` bytes.
    - Settings → Database now has Backup & Restore Test controls for Local Mac / Google Drive backup selection and a guarded restore test into `margabase_restore_test`; production restore remains intentionally unavailable from the browser.
  - 2026-06-01 8:45 PM Manila live-test rollback completed:
    - `app.marga.biz` DNS was moved from the DigitalOcean/Caddy path back to Cloudflare Tunnel `marga-api`.
    - Local tunnel ingress now routes `app.marga.biz` to `http://127.0.0.1:9100`; `api.marga.biz` still routes to `http://127.0.0.1:8787`.
    - Local Margabase API env now points to local Postgres (`POSTGRES_HOST=127.0.0.1`, `POSTGRES_PORT=5432`, `POSTGRES_USER=margabase_admin`, `POSTGRES_DB=margabase`, SSL disabled).
    - Verified `https://app.marga.biz/margabase-api/health`, live GET through `app.marga.biz`, API socket to `127.0.0.1:5432`, and create/read/local-row/delete smoke test using collection `codex_cutover_smoke`.
    - App cache guard was bumped to service worker cache `marga-app-shell-v105-local-postgres-live-test`; critical `firebase-config.js` and `offline-sync.js` script versions were bumped to `20260601-local-postgres-live-1`.
    - `offline-sync.js` now blocks queued raw writes whose saved URL no longer matches the current Margabase base URL, preventing old queued writes from replaying to a retired backend.
    - Local database is behind DigitalOcean for records created after the Saturday DO move and today, especially Petty Cash/current-day operational records. Do not run broad Firebase/DO imports. Reconcile only named collections/windows with an auditable report after live route stability is confirmed.
    - Rollback-to-DO path if local live test fails: restore `/Users/mike/.cloudflared/config.yml.backup-before-app-local-20260601-204015` or remove `app.marga.biz` from tunnel ingress, restore `/Volumes/Wotg Drive Mike/GitHub/marga-platform/apps/margabase/.env.backup-before-local-postgres-20260601-203716`, restart `com.marga.margabase-firestore-api`, `com.marga.app-proxy`, and `com.marga.cloudflare-tunnel`, then use `cloudflared tunnel route dns --overwrite-dns` or Cloudflare DNS to point `app.marga.biz` back to the DO origin.
  - Production app traffic had been moved to DigitalOcean (`app.marga.biz` -> Droplet/Caddy -> Margabase API -> DigitalOcean managed Postgres).
  - Even with low Droplet CPU/RAM, Billing, Field App, and Collections became stuck because the managed Postgres plan had limited connection slots and the Firestore-compatible API was still serving broad JSON-document queries. The visible failure was waiting/timeout, not raw Droplet compute exhaustion.
  - Emergency fixes applied:
    - stopped stray local/legacy Margabase proxy/API processes that were still consuming database slots
    - reduced Margabase API Postgres pool pressure and added connection/query/statement timeouts
    - added production indexes for hot raw-document fields used by Billing, Field App, Collections payments, and Collections history
    - restored Collections customer detail workspace by loading only the clicked cell's invoice/payment/history data instead of requiring a full browser matrix rebuild
  - Pushed Marga-App fix: `0c210eb` `Restore Collections detail workspace loading`.
  - Pushed marga-platform fix: `422c7c4` `Harden Margabase API pool for production`.
  - Reusable production index script added in `marga-platform`: `scripts/apply-margabase-production-indexes.mjs`.
  - Operational lesson: DigitalOcean managed Postgres is not the desired long-term economic model for MARGA. If 32 staff and a few heavy app tabs can hit managed connection/query limits, then future `care.marga.biz` customer usage and `aistaff` voice sales assistants with 20+ clients would create larger recurring cost, latency, and upgrade pressure.
  - New direction to plan: move production back to owner-controlled local Postgres/Margabase on a dedicated server with enough RAM/SSD/UPS/network, because local app + local Postgres removes the Droplet-to-managed-DB latency hop and avoids per-plan connection economics. DigitalOcean/Cloudflare can remain routing, backup, or failover tools, but business truth should live on owner-controlled infrastructure unless a managed service is deliberately justified.
  - Cache/cutover lesson from the earlier Firebase incident: production can keep using a retired backend if old browsers, service workers, localStorage, IndexedDB offline queues, or stale backend preferences survive the cutover. Apply the same protection when moving away from DigitalOcean managed Postgres: bump service worker/app asset versions, force backend config to the new local Margabase route, clear/override `marga_data_backend`, `marga_api_base_url`, response-cache keys, and pending offline writes, then block/rotate/restrict the retired DO API path so stale tabs cannot keep reading or writing DO Postgres.
  - A rollback from DO to local Postgres is not complete while any existing staff browser can silently read/write the DO database. Verify both a fresh incognito browser and an existing staff browser session through `app.marga.biz`, then prove read/write/readback on Field App, Billing, Collections, Petty Cash, and the future `care.marga.biz`/`aistaff` routes before shutting the incident.
  - Guardrail: do not respond to this class of incident by simply upsizing managed services. First reduce browser/API broad scans, add indexes/materialized summaries, and prefer a local production database/server design with tested backups and restore drills.
- 2026-05-21 Firebase/Margabase reconciliation incident:
  - User-approved emergency order is: rescue all May 21 transactions from Firebase into Margabase first, verify the report, then rescue May 20, then May 19.
  - Use `/Volumes/Wotg Drive Mike/GitHub/marga-platform/scripts/rescue-firebase-day-to-margabase.mjs --app=margabase --day=YYYY-MM-DD` for day-specific rescue. It scans operational Firebase collections and upserts any document whose Firebase update time or business date fields match the target day. It writes JSON reports under `/Volumes/Wotg Drive Mike/GitHub/marga-platform/reports/`.
  - This is an explicit, temporary rescue/check approved by the user because technicians need the current schedules and transactions. Do not leave continuous Firebase sync running afterward.
  - Migration lesson for MARGA and future webapps: migration is not complete when data is copied. Migration is complete only when old backend secrets/config are removed, old domains are blocked, service worker cache is reset, all write paths are proven against the new database through the production URL, and stale writes from the old database are reconciled with an auditable report.
- 2026-05-21 Margabase compatibility API write-path incident:
  - Service request encoding appeared to save but delivery/toner requests such as Complete Solution and Brenton were missing from the schedule because the Margabase Firestore-compatible `:runQuery` endpoint applied `limit 1` before honoring `orderBy id DESC`.
  - Browser modules that allocated IDs with `orderBy id DESC limit 1` saw the first low document instead of the real latest row, then reused IDs such as `tbl_schedule/2` and `tbl_newfordr/2`. Later writes overwrote earlier requests at the same document ID.
  - Fix applied in `/Volumes/Wotg Drive Mike/GitHub/marga-platform/scripts/margabase-firestore-api.mjs`: simple `orderBy` fields are pushed into SQL before `limit`, then rows are sorted again for compatibility. Verified after restart that `tbl_schedule orderBy id DESC limit 1` returns `999202606093` and `tbl_newfordr orderBy id DESC limit 1` returns `223838`.
  - Scan note: Service and Collections use this ID-allocation pattern for `tbl_schedule`; the API fix protects those paths. Petty Cash entry vouchers use their own PCV IDs and Hener's May 21 entries were present in Margabase, but supplier creation should still fetch the current highest supplier ID instead of trusting a capped browser list.
  - Future rule: every migrated write path must have an allocator smoke test through `app.marga.biz`/Margabase that creates or simulates the next ID against the real highest row. Never declare a module migrated because reads look correct; prove writes, IDs, updates, deletes, and audit/report rows.
  - This lesson is now preserved as a reusable global skill: `/Users/mike/.codex/skills/marga-database-migration` symlinks to `/Volumes/Wotg Drive Mike/GitHub/marga-platform/skills/marga-database-migration`.
- 2026-05-18 Production backend protection checkpoint:
  - Current production app domain is `app.marga.biz`; it must use Margabase/Postgres, not Firebase.
  - Latest pushed protection commit: `ac93600` `Lock production backend to Margabase`.
  - Do not restart Firebase live sync, admin catch-up, or parity readers unless the user explicitly asks for a verified rescue/check. Firebase reads/writes cost money and can create conflicting production records.
  - `app.marga.biz`, `127.0.0.1`, and `localhost` now force Margabase in `shared/js/firebase-config.js`, ignore old Firebase localStorage/cookie/query preferences, and remove the Firebase choice from Settings.
  - After the May 18 rescue, no Firebase live-sync/admin-catchup process was running; leave it off if the catch-up is complete.
  - Margabase local API/proxy on `127.0.0.1:8787` may remain running because it serves the Postgres/Margabase compatibility API, not Firebase.
  - If records appear missing, first check Margabase tables and the saved rescue reports before reading Firebase again. Prefer local backups/export data over live Firebase reads.
  - Old/retired app paths must not be allowed to add records to Firebase. If a legacy domain/build is reachable, block access or force it to `app.marga.biz`/Margabase before staff use.
- 2026-05-18 Field App / communications checkpoint:
  - Latest pushed `main` commit after this work: `2ba8831` `Add explicit repin photo button`.
  - User expects verified Marga-App code changes to be committed and pushed to `main` automatically unless explicitly told not to push.
  - 2026-06-03 user-approved Field App close workflow change:
    - Billing Submission now auto-fills billing date/time when the schedule is opened; staff only need to enter the receiver name.
    - Mark Finished and customer check-in/check-out no longer require the technician to be within `200m` of the customer pin. Field staff may complete the encoding from the office or another location as long as the required close details are complete.
    - Keep the rest of the close validation strict, especially billing/collection/service data completeness, so accounts cannot be closed with missing operational details.
  - Field App is currently production-sensitive; do not revert or weaken the GPS proof rules without explicit user approval.
  - 2026-06-09 field attendance rule adjustment: official field `Time In` may match either a pinned open/pending scheduled customer or an approved HR work-location pin of type `Office` or `Production` within `200m`. This was added so field staff can time in at Havila Office / Cabrera Production without being blocked by missing customer pins. Keep customer proof intact; this is an approved additional attendance target, not a removal of GPS proof.
- New infrastructure direction: build the reusable self-hosted Marga platform in `/Volumes/Wotg Drive Mike/GitHub/marga-platform`, with the first app stack under `apps/margabase`.
- Goal: replace Firebase-style per-read/write billing pressure with a Mac mini local server stack for database/API/realtime workflows.
- Planned public access model:
  - Customer portal stays normal browser access at `care.marga.biz`.
  - Use Cloudflare Tunnel to route `care.marga.biz` to the Mac mini server without customers installing Tailscale/VPN.
  - Tailscale may be used only for internal/admin/private access, not for customer portal users.
- 2026-06-29 Marga Care credential generation checkpoint:
  - Active portal accounts are now generated from the **Billing-backed customer universe**, not from a hardcoded care list.
  - Reusable script: `/Volumes/Wotg Drive Mike/GitHub/Marga-App/scripts/generate-care-portal-accounts.mjs`
  - Source rule for that script:
    - Start from `marga.billing_invoices` company groupings already used for billing/collections customer scope.
    - Compute outstanding balances using the same rule accepted in Billing statements: prefer the latest recorded `balance_amount` from `marga.payments`; fall back to `invoice total - paid total` only when no explicit balance is recorded.
    - Keep only non-inactive companies that are still operationally relevant (`outstanding > 0` or active branches/machines).
  - Current first live run on June 29, 2026 created:
    - `299` company admin accounts
    - `769` branch / department accounts
    - `1068` total `marga.portal_accounts`
  - Credential export is intentionally written **outside the repo** so plaintext temporary passwords are not committed. Default output path is a timestamped folder on `/Users/mike/Desktop/`.
  - Default branch/department login style in the generated sheet is company-code / branch-code based (for uniqueness and because many records do not have safe branch email data). Company admins use email when a unique customer email exists; otherwise they also fall back to a generated company-code login.
- 2026-06-30 Marga Care operational scope rule:
  - Customer-facing machine counts in `care.marga.biz` must use the **Active Contract Customer Graph** (`api.active_customer_graph`), not `marga.machines.current_company_id` alone.
  - Real incident: China Bank `Branches` showed the correct outstanding balance but `0` machines because the billing company grouping existed while the sparse machine ownership table did not fully mirror that grouping.
  - Safe rule now:
    - `Machines in Care` and branch device counts come from active-contract machine scope.
    - customer isolation for service/toner operational reads should be scoped by the branch ids in that same active-contract graph.
    - do not trust raw `tbl_machine.client_id` or bare `marga.machines.current_company_id` as the sole care-portal customer ownership key.
- Planned stack direction:
  - Mac mini on solar/UPS with dual internet provider failover through the router.
  - Self-hosted Supabase/Postgres-style backend, with local media/file storage.
  - Platform must support multiple future app/SaaS stacks, not only MARGA; `margabase` is the first stack, not the whole platform.
  - Automated local and offsite backups are mandatory before production cutover.
- Margabase performance principle:
  - Keep a raw Firebase mirror for audit/fallback, then derive relational Postgres tables/views for fast reads.
  - Use Postgres joins, indexes, constraints, triggers, and scheduled jobs so business rules are enforced centrally instead of depending on every browser click.
  - Collections is the clearest optimization target: current Firebase/browser loading can take around 7 minutes because it reads broad collections and computes in JavaScript. Margabase should replace that with indexed invoice-month/payment-date tables, precomputed balances, collection status views/materialized summaries, and API filters so the matrix loads from ready-to-query data.
  - Collections billing source rule for Supabase/Margabase: never rely on a capped `load all billing` scan as the source for Collections. Query billing by the dashboard's active year/month window, merge those targeted results with any compatibility scan, and dedupe by billing document/invoice identity before computing the matrix, invoice search, unpaid receivables, and scorecard totals. This rule was added after Firebase invoice `130652` appeared in Billing but was absent from Collections because the Collections loader only had the capped scan.
  - Operational count/report rule from the 2026-05-19 Billing printed-invoice fix: production `app.marga.biz` is served through Cloudflare to the local Margabase proxy (`scripts/local-margabase-proxy.mjs`) and the local Margabase API (`127.0.0.1:8787`). Counts shown in Billing, Collections, General Production, and other modules must be verified against this Margabase path, not only `margaapp.netlify.app`. If Netlify shows correct counts but `app.marga.biz` does not, restart the local proxy so Node reloads changed Netlify function modules, then run a narrow Margabase catch-up for the affected hot collection.
  - For any module count or productivity report, identify the exact business date fields that drive the number and include them in both the query and the Margabase live/catch-up watcher. Example: Billing printed-today counts must query `tbl_billing` by print/save date fields such as `dateprinted`, `date_printed`, `invoice_date`, `invdate`, `datex`, `tmestamp`, and `updated_at`, then dedupe by billing document/invoice identity before totaling amount and staff performance. Collections should apply the same pattern for invoice month, payment date, OR date, 2307/follow-up dates, and grouped parent invoice rows.
  - Example database-side automation targets: payment save updates invoice balance, schedule close writes audit/event rows, DR finalization marks released rows, machine pullout sets pending-return state, nightly jobs refresh billing/collections summaries and flag overdue accounts.
- Margabase offline-first rule:
  - Temporary offline operation should be supported on desktop and mobile through browser cache + IndexedDB pending-write queue.
  - Because MARGA invoice numbers, OR numbers, and DR numbers are manually entered from physical booklets, the app may allow offline finalization/draft saves for invoices, OR/payment records, and delivery receipts.
  - Offline saves must carry unique local operation IDs and sync status; when internet returns, Margabase validates uniqueness, required fields, and conflicts before accepting them as server truth.
  - Conflicts such as duplicate invoice/OR/DR numbers or stale invoice balances should go into a clear `Needs Review` queue instead of silently overwriting data.
- Form persistence rule:
  - New sections/forms must preserve in-progress work locally while the user is typing, especially on mobile Field App workflows. Refreshes, app restarts, accidental navigation, or sudden connection loss must not reset filled fields to zero.
  - Persist safe text/select/number/date values, added line rows, selected staff/status filters, and local draft IDs. File inputs cannot be silently restored by browsers after restart; store the filename/status and make the UI ask the user to reselect the image before final submit.
  - Clear the local in-progress draft only after a successful save/submit or an explicit clear/cancel action.
- Important billing lesson from 2026-05-11:
  - Google Cloud/Firebase billing showed the large charge under `App Engine`, but the operational failure was Firestore returning `429 Quota exceeded`.
  - Treat this as Firestore/Datastore read-write/query billing pressure, even when Google Billing labels the service as App Engine.
  - Cloudflare Tunnel should not charge per database document read/write; the app's database workload would be handled by the Mac mini.
- Next chat focus: continue **Billing** work.
- Protect the working Billing dashboard presentation and save/print workflow before changing shared resolver logic.
- Billing print/productivity rule from 2026-05-25: `Saved Invoice To Print` opens the actual billing calculation by row/month, while printed-today/month reports count only explicit `billing_printed_at` audit events from the print buttons. Do not fall back to old save/date fields as "printed" because that recreated false counts.
- 2026-05-28 saved-to-print queue rule: count only invoice-numbered, positive-amount saved billing rows with no explicit `billing_printed_at`/print audit from the print-queue tracking window onward. Current queue window starts `2026-05-25` (`OPENCLAW_BILLING_SAVED_QUEUE_START_YMD`) because older saved rows do not have reliable print-audit status. Do not count all current-month no-audit rows because that creates false backlogs such as 777; do not limit to only today because that hides real unprinted prepared invoices from Monday/yesterday. Keep older pre-audit no-print rows out of the live queue unless they are reviewed in a separate reconciliation report. Dedupe grouped/multi-branch invoices by invoice number + billing month.
- 2026-06-17 prepared-invoice reconciliation incident:
  - Live queue at `app.marga.biz/billing/` showed `144` grouped invoices / `PHP 802,213.37` still waiting, backed by `315` raw `tbl_billing` rows with no `billing_printed_at`.
  - Local API/process logs did not contain request-level print-audit PATCH traces, so we could not prove which of those invoices were physically printed from logs alone.
  - Reusable local report/backfill tool added: `node scripts/reconcile-prepared-billing-queue.mjs --out=reports/prepared-billing-queue.json` for read-only inspection, and `--apply --targets=INV[:YYYY-MM] --printed-by="NAME"` only after business confirmation that the listed invoice groups were really printed and need manual `billing_printed_at` recovery.
  - Current biggest waiting invoice group in the queue was `131216` (`May 2026`, China Bank Savings branches) at `PHP 419,492.64` across `169` raw billing rows saved on `2026-06-16`, all still missing print audit.
- 2026-05-26 Billing printed-count correction:
  - The print-audit timestamp is stored as UTC ISO (`billing_printed_at`), so report parsing must respect timezone-aware `Z`/offset strings before applying Manila-local parsing. Treating ISO strings as local Manila time shifted early-day print events back to the prior day and undercounted `Total Printed Invoice Today`.
  - `Total Printed Invoice This Month` is a calendar print-date running total from May 1 through today, not the May billing-month cell count. Count explicit print-audit rows when present; for pre-audit historical rows, count saved invoice rows dated before today as operationally printed, but keep unstamped rows saved today in `Saved Invoice To Print` so computed-but-not-yet-printed invoices are not mixed into today's printed total.
- 2026-05-26 Billing statement workflow:
  - Use `Customer Billing Statement` for a whole customer/all-branches unpaid-invoice summary such as Singapore Medical Diagnostics. It belongs above the month matrix after search/grouping, not inside one branch calculation.
  - Use `Branch Billing Statement` from a billed branch/month detail for one branch/department only. The print output lists unpaid saved invoice-number rows only, with branch, machine/serial, billing period, amount, net of VAT, VAT, and totals; it must not create or replace invoices. Rows without invoice numbers are not billed yet and must stay out of the statement.
  - Preserve `balance_amt = 0` from `tbl_paymentinfo` as a real zero balance. Do not convert it to null/false and fall back to `invoice amount - payment amount`, because paid invoices with deductions/2307 can have `payment_amt` lower than the invoice but an explicit zero balance.
  - Reusable skill saved at `/Volumes/Wotg Drive Mike/GitHub/marga-platform/skills/marga-billing-collections` and linked into `/Users/mike/.codex/skills/marga-billing-collections`; use it for future billing/collections statement, payment matching, grouping, quota/RTP, fixed-rate, and receivable-total work.
- Billing grouped-invoice rule from 2026-05-25: do not hardcode one customer correction when a shared-invoice account is wrong. Use authoritative grouping membership (`tbl_groupings` + `tbl_groupsum.contract_main_id`) first. If a grouping has explicit `tbl_groupsum` members, only those contracts share the invoice/quota; other same-company departments stay separate. If a grouping has no membership rows, fall back to the existing company-level group behavior. This protects future customers with the same error without adding one-off patches.
- 2026-06-02 CVM billing rule:
  - `CVM Finance and Credit Corporation` is a one-invoice grouped Billing account, but it is not fixed-rate, print-all-you-can, RTP, or rate-per-page billing.
  - Collapse CVM into one parent invoice row with expandable branch/machine details.
  - Billing calculation uses toner quantity only: default description `Toner Cartridge`, quantity `50`, unit amount `650`, VAT-inclusive total `32,500` with VAT retro-computed from the total.
  - Pending/unbilled projection must count CVM once per month at the toner invoice total, not once per branch/machine row.
- Releasing is now live and materially implemented; only parity/tuning work should remain there, not a rebuild.
- Preserve the accepted Collections month-matrix scroll format; user likes it and may want Billing to adopt it later.
- Collections SN/data display is acceptable in the dashboard as of the latest live check.
- Before implementing grouped/collapsible Collections rows, preserve the current working month-to-month matrix as the rollback baseline.
- New Collections grouping focus: one-invoice / many-branch customers such as `China Bank Savings - Branches` should show one parent invoice row with expandable branch/machine meter-reading detail.
- Keep Marga App work inside the `Marga-App` repo/thread. If a chat is in `marga-biz`, stop and redirect before editing app code.

## Firebase Complete Backup Method - 2026-05-15
- Canonical migration backup method:
  - Do not use repeated collection-walking/import/parity loops as the full-migration baseline; that approach is slow, expensive in Firebase reads, and can still miss rarely used collections.
  - Use Google-managed Firestore export first, then download the export files locally and convert from local files into Postgres/Margabase.
  - Separately download Firebase Storage files/images/assets from the original Firebase Storage bucket.
- Firestore managed export baseline:
  - Project: `sah-spiritual-journal`.
  - Temporary export bucket: `gs://marga-firestore-export-us-450636566224`.
  - Bucket location: `us-central1`.
  - Export prefix: `firestore-managed-exports/2026-05-15T16-40-43+0800`.
  - Export snapshot time: `2026-05-15T08:41:00Z` / `2026-05-15 4:41 PM` Manila time.
  - Export completed successfully with `5,689,231` Firestore documents and `3,197,891,287` bytes across `1,026` export objects.
- Local backup paths:
  - Full backup folder: `/Volumes/Wotg Drive Mike/GitHub/marga-platform/backups/margabase/full-firebase-backups/2026-05-15T16-40-43+0800`.
  - Backup log: `/Volumes/Wotg Drive Mike/GitHub/marga-platform/logs/full-firebase-backup-20260515-164043.log`.
  - Correct Firebase Storage download log: `/Volumes/Wotg Drive Mike/GitHub/marga-platform/logs/firebase-storage-download-20260515-172634.log`.
  - Current pointer files: `/Volumes/Wotg Drive Mike/GitHub/marga-platform/state/current-full-firebase-backup-dir.txt` and `/Volumes/Wotg Drive Mike/GitHub/marga-platform/state/current-full-firebase-backup-log.txt`.
- Storage backup rule:
  - Firestore export bucket is only for Firestore export files.
  - Original Firebase Storage/media bucket must be downloaded separately from `sah-spiritual-journal.firebasestorage.app`.
  - `scripts/full-firebase-backup.mjs` in `/Volumes/Wotg Drive Mike/GitHub/marga-platform` now separates `--firestore-bucket` from `--storage-bucket`; do not point Storage download at the temporary Firestore export bucket.
- Catch-up rule:
  - Use the managed export snapshot as the baseline, then run a small overlap catch-up for documents changed from `2026-05-15 4:00 PM` Manila onward so records created during/after export are not missed.
  - Avoid continuous parity/live-progress reads against Firebase unless the user explicitly asks for a progress or parity check.
- Cutover rule:
  - Firebase remains production until local Firestore export import, Storage download, Postgres derivation, compatibility API, critical-flow smoke tests, and parity checks are complete.
  - MargaBase switching stays admin/browser-local until the app behaves like Firebase for Billing, Collections, Service, Master Schedule, Field App, and Storage-backed image/content flows.

## Firebase Rescue / Margabase Protection - 2026-05-18
- Operational incident:
  - Staff used an old Firebase-backed path during the May 18 operating day, so schedules, field movements, service requests, collections, billing-related updates, payments, and close requests had to be rescued into Margabase.
  - The rescue priority was the May 18 window from early morning through dispatch/evening, especially records created between roughly `6:00 AM` and `3:00 PM` before the app was locked down.
- Rescue verification completed:
  - One-time Firebase-to-Margabase catch-up was run from `/Volumes/Wotg Drive Mike/GitHub/marga-platform` using `node scripts/live-firebase-to-margabase.mjs --app=margabase --once`.
  - The live catch-up log completed around `2026-05-18T12:59:25Z` / `8:59 PM` Manila with zero reported errors for the hot collections.
  - Strict check against `/Volumes/Wotg Drive Mike/GitHub/Marga-App/reports/firebase-new-records-since-8am-2026-05-18T07-22-37-270Z.json` ended with no missing rows after manually upserting the final missing documents.
  - Final checked rescue counts from the report included: `tbl_schedule 341/341`, `tbl_billing 37/37`, `tbl_paymentinfo 15/15`, `tbl_field_visit_events 28/28`, `tbl_finaldr 19/19`, `tbl_collectionhistory 35/35`, `tbl_checkpayments 10/10`, `tbl_schedule_close_requests 8/8`, and `tbl_savedscheds 109/109`.
- Protection rule after rescue:
  - Do not run continuous Firebase sync in the background after rescue completion.
  - Do not run broad Firebase collection scans just to "check again"; use targeted checks only when there is a named missing record or a user-approved rescue.
  - Leave Firebase read/write paths disabled for production staff. Margabase/Postgres is the protected production path.

## Margabase Migration Checkpoint - 2026-05-11 Night
- 2026-05-12 temporary safety update:
  - Commit `c2615ca` `Temporarily lock app to Firebase` was pushed to `main`.
  - `shared/js/firebase-config.js` now keeps the Margabase code path behind `MARGABASE_ENABLED = false`.
  - While this flag is false, the deployed app ignores/clears saved `marga_data_backend=margabase` and `marga_api_base_url` browser preferences, ignores Margabase query-string intent, and forces `window.FIREBASE_CONFIG.baseUrl` to the Firestore REST endpoint.
  - Remote browsers that receive the current JS should silently reconnect to Firebase; if a browser is still on old cached assets and attempts Margabase, use a normal refresh or app Hard Refresh so service worker cache `marga-app-shell-v50` pulls the Firebase-only config.
  - Admin Settings and Collections now describe the lock as temporary. Do not remove the Margabase path; re-enable only after background sync completes and record/parity checks match Firebase.
  - Before re-enabling, verify sync status, compare exact Firebase vs Margabase counts/business outputs, and flip the flag deliberately instead of using ad hoc browser localStorage.
- Public temporary Margabase test access is working through Cloudflare Quick Tunnel:
  - Tunnel URL: `https://interference-climbing-vitamins-acting.trycloudflare.com`
  - Margabase Collections test URL: `https://interference-climbing-vitamins-acting.trycloudflare.com/collections.html?marga_backend=margabase&marga_api_base_url=/margabase-api/v1/projects/sah-spiritual-journal/databases/(default)/documents`
  - Health check: `https://interference-climbing-vitamins-acting.trycloudflare.com/margabase-api/health`
- Local services known to be running during the checkpoint:
  - Marga-App local proxy: `127.0.0.1:9100`, screen `marga-cloud-test-proxy`
  - Cloudflare quick tunnel: screen `marga-cloudflare-tunnel`
  - Margabase Firestore-compatible API: `127.0.0.1:8787`, screen `margabase-firestore-api`
  - Import dashboard: `127.0.0.1:4321`, screen `margabase-import-dashboard`
- Marga-App changes already pushed to `main` for Margabase testing:
  - `7ca7949` `Add public Margabase test proxy support`
  - `8eb4051` `Fix backend switch storage fallback`
  - `b34b65b` `Add Margabase switching and compare snapshots`
  - `fac1db2` `Fix local billing route`
- Working app-side features:
  - Admin Settings now has a `Database` tab for local browser switching between Firebase and Margabase.
  - The switch is browser-local only; it does not cut over other staff devices.
  - Collections has a `Database Compare Snapshot` scorecard and snapshot save button for Firebase-vs-Margabase comparisons.
  - Public quick-tunnel access can render the app and read Margabase through `/margabase-api`.
- Margabase platform accomplishments in `/Volumes/Wotg Drive Mike/GitHub/marga-platform`:
  - Postgres database is running locally as `margabase`.
  - Raw Firebase document mirror exists in `app_meta.firestore_documents`.
  - Relational tables exist under schema `marga`: `billing_invoices`, `payments`, `service_schedules`, `field_visit_events`, `delivery_receipts`, and related customer/contract/machine tables.
  - Firestore-compatible API script exists and supports document list/get/create/patch/delete plus `:runQuery`.
  - Admin sync endpoints exist: `GET /admin/sync/status` and `POST /admin/sync/start`.
- Current sync state at last checkpoint:
  - Firebase-to-Margabase sync run `#4` was still running.
  - Active PID: `23726`
  - Started: `2026-05-11 9:19 PM` Manila time
  - Log: `/Volumes/Wotg Drive Mike/GitHub/marga-platform/logs/margabase-firebase-sync-2026-05-11T13-19-40-522Z.log`
  - Raw mirrored totals had reached roughly `4,750,073` documents across `135` collections.
  - Important refreshed counts observed:
    - `tbl_billing`: `77,878`
    - `tbl_checkpayments`: `86,744`
    - `tbl_collectionhistory`: `269,743`
    - `tbl_field_visit_events`: `231`
    - `tbl_paymentinfo`: `117,480`
    - `tbl_schedule`: `321,739`
  - Relational counts observed while sync was running:
    - `marga.billing_invoices`: `77,878`
    - `marga.payments`: `117,480`
    - `marga.service_schedules`: `321,704`
    - `marga.field_visit_events`: `231`
    - `marga.delivery_receipts`: `88,811`
- Do not declare migration complete yet.
  - The sync was still running at the checkpoint.
  - Collections Margabase render matched some high-level counts, but not all business logic.
  - Known mismatches against Firebase screenshots:
    - Firebase customer rows around `2,496`; Margabase showed around `2,353`.
    - Firebase pending cells around `5,141`; Margabase showed around `2,381`.
    - `Pending Billing Projection` in Margabase showed `0 / 0` where Firebase had monthly projection values.
    - Some projected billing and unpaid receivable month totals differed.
- Protect before cutover:
  - Firebase remains production source of truth until Margabase sync, derivation, auth, backup, and module parity are verified.
  - Do not switch staff globally yet.
  - Keep the browser-local backend switch so admin can compare Firebase and Margabase without affecting other devices.
  - Keep Firebase fallback available during the whole test window.
  - Do not expose unrestricted write APIs publicly; public tunnel testing must be treated as temporary until auth/rate-limit rules are in place.
- Next thread should start by:
  - Check `curl -s http://127.0.0.1:8787/admin/sync/status`.
  - If run `#4` is still running, wait/check tail of the log.
  - If run `#4` completed, hard refresh the public Margabase Collections URL and save a new snapshot.
  - Compare Firebase and Margabase scorecard numbers exactly.
  - Fix the Margabase derivation/API logic for customer row count, pending cells, pending billing projection, and unpaid receivable month totals.
  - Complete permanent Cloudflare named tunnel only after nameserver propagation is done for `marga.biz`.
- Cloudflare/domain checkpoint:
  - User added `marga.biz` to Cloudflare Free plan.

## Local Scheduled Jobs
- Pending schedule carry-over now runs on the owner-controlled local stack, not Codex or Netlify.
- LaunchAgent: `/Users/mike/Library/LaunchAgents/com.marga.auto-forward-pending-schedules.plist`
- Launcher: `/Users/mike/Library/Application Support/Marga/run-auto-forward-pending-schedules-local.sh`
- Tracked runner source: `/Volumes/Wotg Drive Mike/GitHub/Marga-App/scripts/run-auto-forward-pending-schedules-local.sh`
- Schedule: daily at 18:00 local machine time; the runner skips Sunday using Asia/Manila weekday checks.
- Backend: local Margabase API at `http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents` with `MARGABASE_API_KEY=margabase-local`.
  - Hostinger nameservers were changed to `hope.ns.cloudflare.com` and `major.ns.cloudflare.com`.
  - At the last checkpoint, propagation was not fully complete; Cloudflare Tunnel authorization showed `marga.biz` as invalid nameservers.
  - Temporary quick tunnel works now, but permanent `api.marga.biz` needs named tunnel setup after Cloudflare recognizes the zone.
  - Existing `margaapp.netlify.app` remains usable even after nameserver changes.

## Current Protected Baselines
- Billing protected baseline: commit `8df832d` `Include multimeter invoice amounts in billing totals`
- Important Billing-support commits still relied on by current behavior:
  - `9d2e0ae` `Normalize billing customer search spacing`
  - `071ecc4` `Stabilize billing customer search refresh`
  - `a277f95` `Prefill color meter prior readings`
  - `936c588` `Use mother company details for grouped prints`
- Current live Collections work already pushed on `main`:
  - `1683fc9` `Count closed field schedules in KPIs` is the latest observed `main` commit while the Collections matrix remains working
  - `d8564c3` `Add branch status editor to collections`
  - `a128dda` `Show invoice and OR numbers in collection cells`
  - `3fe81b0` `Avoid legacy payment id collisions`
  - `99348f1` `Refresh collections matrix after payment save`
  - `d186537` `Fix collection serials and coverage counts`
  - `ced7667` `Make collections matrix mobile scrollable`
  - `9feab79` `Add collection matrix drag scrollbar`
  - `606509e` `Fix collections month matrix scrolling`
  - `e0d2755` `Harden collections month auto scroll`
  - `dbc320d` `Constrain collections matrix viewport`
- Current live Master Schedule / Field App work already pushed on `main`:
  - `2ba8831` `Add explicit repin photo button`
  - `96f9e50` `Show photo picker for field repin`
  - `d674579` `Allow field customer location repin`
  - `5283e86` `Add company meeting room`
  - `aa48513` `Add field staff calls`
  - `dfd6c81` `Add field attendance location check`
  - `f356bfa` `Require GPS proof for customer check-in`
  - `3f3ab9c` `Use route data for master schedule readiness`
  - `caafb64` `Match master schedule print columns to VBNet`
  - `dec0127` `Add carryover tab to field app`
  - `4156a67` `Require field customer location pin`
  - `461e7b3` `Require frontage photo for location pins`

## Field App GPS / Attendance / Repin Checkpoint - 2026-05-18
- Business rule clarified by user:
  - Official daily attendance `Time In` is separate from per-customer check-in/out.
  - Staff must official `Time In` only while physically within `200m` of an approved office/production pin or an open/pending scheduled customer location pin.
  - They cannot time in from home or an unrelated place.
  - Time Out may be from a customer or the office.
  - 2026-06-02 clarification: field techs, office staff, drivers, logistics, delivery, and other staff may Time In at MARGA office/production sites such as Havila and Cabrera Road without a customer schedule.
  - 2026-06-02 clarification: if staff are physically at a pinned customer site but no schedule was assigned, Field App may let them add today's schedule for that GPS-matched customer only. They must choose from the fixed service purpose dropdown; no customer search and no invented free-text purpose.
- Official attendance implementation:
  - Field App now has a Daily Attendance `Location Check` panel above official time cards.
  - The panel compares phone GPS against HR work-location pins (`marga_hr_work_locations`) and the staff member's open/pending workload, including current route and carryover/past pending tasks.
  - It shows nearest pinned customer, distance, GPS accuracy, missing-pin count/names, and opens the nearest task or a task needing a pin. If the phone is at a pinned customer with no assigned schedule, it can show Add Schedule with a purpose dropdown.
  - If no office/production pin, scheduled customer pin, or addable pinned customer is within `200m`, official Time In is blocked.
- Per-customer check-in implementation:
  - `tbl_schedule.field_time_in` now requires GPS proof against that task's customer branch pin.
  - The app writes proof fields such as `field_time_in_latitude`, `field_time_in_longitude`, `field_time_in_distance_meters`, and `field_time_in_location_status = matched_customer_pin`.
  - The Field App time-in picker is readonly; staff should use the on-device Check In / Time In action so location proof is captured.
  - Mark Finished now requires both per-customer Check In and Check Out to be recorded first; official daily attendance Time In is only once per day and is not reused as task check-in.
- Local Margabase API guard:
  - In `/Volumes/Wotg Drive Mike/GitHub/marga-platform/scripts/margabase-firestore-api.mjs`, a local guard was added during this work to reject `tbl_schedule.field_time_in` writes without `matched_customer_pin` proof and distance `<=200m`.
  - That platform repo was not committed in this Marga-App commit series; inspect `marga-platform` before assuming that guard is versioned.
- Hener / Denovo diagnostic:
  - Hener Claveria staff id observed as `54`.
  - Denovo May 18 route row exists: `Denovo Express Endeavours Corporation - Denovo Express Endeavours Corporation, HR Department`, branch id `2857`, saved pin `14.5754799, 120.9809277`.
  - Zontar was being shown by the homepage Location Check because it was an older open/past-pending workload item with a saved pin, and the Location Check reports the nearest pinned open/pending customer overall.
  - Denovo-to-Zontar distance is roughly `969m-982m`, so if a staff member is truly at Denovo but the panel shows Zontar around `803m`, suspect bad phone GPS, a wrong Denovo pin, or the staff not standing near Denovo's saved pin.
- Repin behavior:
  - Already-pinned customers now show `Repin Customer Location` instead of blocking pinning.
  - Repin requires a new frontage/building photo, confirms before replacing the saved branch coordinates, stores previous latitude/longitude for audit, writes `customer_location_repinned`, and refreshes the location check after saving.
  - Latest fix added an explicit `Take / Select Photo` button because some Android/WebView screens did not expose the native file input clearly after refresh.
  - Field assets were cache-bumped through `field/index.html` to `field.css?v=20260518-repin-photo-2` and `field.js?v=20260518-repin-photo-2`.

## Field App Calls / Company Meeting Checkpoint - 2026-05-18
- Source reviewed from Go Mission:
  - Existing Jitsi pattern came from `/Volumes/Wotg Drive Mike/GitHub/go-mission/www/modules/groups/group-meeting.js`.
  - Self-hosted Jitsi domain used by MARGA: `call.wotgonline.com`.
- Field Support calls:
  - Field App has a `Field Support` panel with `Voice CSR`, `Video CSR`, `Voice Leader`, `Video Leader`, `Join Field Meeting`, and `Join Company Meeting`.
  - Admin/service/team-leader roles get direct staff call controls by employee/staff ID.
  - Incoming role/direct calls poll `tbl_field_call_requests`, show an in-app ringing overlay, and open an embedded Jitsi modal on accept.
  - Ringing only works while the app/page is open. True background/mobile push notification is not implemented yet.
- Company meeting:
  - Shared script added: `shared/js/marga-meetings.js`.
  - Company meeting state is stored in `tbl_field_call_requests` as `type: meeting`, `audience: all`, `status: active`, with daily room name like `MargaCompanyMeetingYYYYMMDD`.
  - Dashboard shows `Start/Join Company Meeting` in the top bar and Operations Control Center.
  - Desktop modules using shared dashboard shell get a floating `Meeting` launcher.
  - Field App has `Join Company Meeting`.
  - Active meetings show an in-app banner: `Company meeting is live`.
  - Meeting notifications are banner-style, not phone-style ringing, by design. Direct calls ring; meetings notify.
  - 2026-07-14 reliability guardrail: company meeting launch must probe `call.wotgonline.com` before opening Jitsi and may fall back to `meet.jit.si` for the shared room if the self-hosted call server is unreachable, otherwise users only see `Unable to load meeting tools.` and cannot join.
- Current live Service Progress map work already pushed on `main`:
  - `f78805d` `Center service progress map on Antipolo office`
  - `0933866` `Reduce service progress map load`
  - `4417e5d` `Fix service progress map sizing`
  - `90acdfd` `Stabilize service progress map layout`
  - `4d3b361` `Protect service progress map tile layout`
  - `795cd9f` `Mark office on service progress map`
- Current live General Production work already pushed on `main`:
  - `e835737` `Add General Production module`
  - `c96f4de` `Tune General Production legacy counts`
  - `c338d13` `Fix General Production machine checker serials`
  - `e64e5b6` `Use billing serials in machine checker`
- Current live Releasing work already pushed on `main`:
  - `dc2a50b` `Add Releasing delivery receipt module`
  - `555af71` `Use context menu for releasing DR items`
  - `b148610` `Add DR print adjustment controls`
  - `71a2afc` `Add releasing return and DR print templates`
  - `da0bad8` `Keep releasing print footer visible`
  - `f8160ff` `Keep Create DR items after printing`
  - `872700b` `Hide Create DR units from releasing list`

## Accepted Collections Matrix Format
Reference the latest accepted live observation:
- Screenshot: `Screenshot 2026-04-21 at 11.56.21 AM.png`

What now works and should be preserved:
- Month matrix moves horizontally with the whole sheet, including RD, SN, customer, branch, months, and Total.
- RD/SN/Customer/Branch are not horizontally sticky in Collections.
- The view auto-anticipates newer/current months, showing windows such as February 2026 through December 2026.
- Left/right arrows and `Latest` controls are visible above the matrix and usable.
- The final right-side column is `Total`, and the user explicitly likes this format.

Future reuse note:
- This Collections matrix format is a candidate for Billing's month-to-month comparison later.
- Do not port it to Billing casually; Billing save/print behavior is protected and must be regression-checked if Billing adopts this layout.

Rollback point:
- Treat current `main` at commit `1683fc9` as the rollback anchor for the working month-to-month Collections comparison matrix before grouped/collapsible row work.
- If grouped work breaks the matrix, restore behavior with a new forward commit based on this accepted matrix behavior. Do not rewrite `main`.

Grouped-customer matrix representation:
- Some customers have many meter-read branches/machines but only one mother invoice per month.
- These accounts should display as one parent row in the Collections month-to-month matrix, with a `View Branches` control to expand the branch/machine meter-reading breakdown.
- The parent row owns the invoice/payment truth: invoice number badge, OR number badge, collected/partial/no-payment color, follow-up badge, and the follow-up/payment popup details.
- Expanded branch rows are for meter-reading audit only. They may show computed branch amount/status, but must not look like separate invoices when the office bills one mother invoice.
- Legacy/historical CBS invoices may use one selected CBS branch as the invoice branch/name because the office previously chose a branch for billing address purposes. In the Collections matrix, these still need to map back to the grouped parent (`China Bank Savings - Branches`) when the contract/branch belongs under the grouped company.
- Do not split grouped parent rows just because an old invoice header names a specific branch. Keep that branch visible only in the expanded branch/meter-reading detail.
- Verified example:
  - `tbl_companylist/72`: `China Bank Savings - Branches`
  - `tbl_groupings/22`: `CHINABANK`
  - `tbl_branchinfo.company_id = 72`: 224 active branches as of 2026-04-29
- Additional verified grouped account:
  - `tbl_companylist/553`: `Metalcast Corporation`
- Critical separation rule: do not merge by TIN or broad name match. `China Bank Savings Inc.` (`tbl_companylist/73`) and other CBS-like records share TIN `000-504-532-000` but are individually billed and should remain individual rows unless separately verified as grouped.
- Because newer CBS billing rows do not consistently populate `tbl_billing.groupings_id`, grouped row construction should use exact grouped `company_id` plus branch/contract resolution, with `tbl_groupings` as a helper.

Collections matrix scorecard totals:
- Current accepted correction point: commit `b4f093a` (`Correct collection payment month totals`) on `main`.
- The scorecard totals are intentionally separated by meaning:
  - `Projected Monthly Billing`: invoice-month target from actual billed invoices plus pending billing projection with a real contract or meter-reading peso estimate.
  - `Invoice/Billed Total`: invoices actually billed/printed for that billing month.
  - `Collected Against Billed`: payments applied against invoices billed in that invoice month, regardless of payment date.
  - `Unpaid Receivables`: remaining balance on invoices billed in that invoice month.
  - `Pending Billing Projection`: not-yet-billed rows for that billing month; amount must come only from actual meter-reading amount or contract quota/fixed monthly rate.
  - `Payments Dated This Month`: all actual payments with payment/OR date in that month, including payments for older invoices.
- Do not use a broad historical billed-amount fallback for `Pending Billing Projection`; that caused an incorrect multi-million peso spike (example: April 2026 showing about `₱8.3M` instead of the expected roughly `₱2.5M` range).
- Pending billing rows with no contract/reading peso estimate should not inflate the projected peso target.
- If these scorecard totals look wrong again, first check `collections/js/collections.js` around `buildCollectorMatrixTotalRows()` and `getCollectorPendingBillingProjection()`, plus `netlify/functions/openclaw-billing-cohort.js` `compactCollectionMatrixRow()` to ensure `billing_profile` is included in collection response mode.

Collections 2307 / deduction tracking:
- Do not infer 2307 from `balance_amt`. Balance is only the remaining invoice amount after actual payment and explicit deductions.
- Payment form should keep these separate:
  - `payment_amt`: actual money received
  - `deduction_type`: blank / `2307` / `other`
  - `deduction_amount`: amount deducted from the invoice balance
  - `tax_2307`: only populated when `deduction_type = 2307`
  - `balance_amt`: invoice amount minus actual received minus explicit deduction
- If `deduction_type = 2307` and amount is greater than zero, default the 2307 form status to pending so collectors can follow up the certificate later.
- If the customer already gave the form, user can mark the 2307 form as submitted; then it should disappear from the pending 2307 list but remain visible in payment history.
- A normal payment deficit must not create a pending 2307 item.
- Photo attachment for submitted 2307 forms is a future follow-up; first implementation tracks status only.

## Non-Negotiable Rules
- Do not break the Billing dashboard presentation while fixing Collections.
- Do not reintroduce old Billing rollback commits blindly.
- Use forward commits on `main`; do not rewrite history for rollback work.
- Do not revert unrelated dirty files in the repo.
- User expects verified Marga App changes to be pushed to `main` so Netlify can deploy automatically.
- Default release behavior for future threads: update local `Marga-App`, deploy the change live to `app.marga.biz`, wait for the owner's approval on the real live app, then sync staging, then commit and push the verified change to GitHub `main` unless the owner explicitly asks for a different order.

## Customer Identity And Serial Rule
Canonical customer lookup is the Active Contract Customer Graph:
- `tbl_contractmain` where `status == 1`
- `tbl_contractmain.contract_id` -> `tbl_contractdep.id`
- `tbl_contractdep.branch_id` -> `tbl_branchinfo.id`
- `tbl_branchinfo.company_id` -> `tbl_companylist.id`
- `tbl_contractmain.mach_id` -> `tbl_machine.id`
- serial display from `tbl_contractmain.xserial` first, then `tbl_machine.serial`

Collections and Service must follow this same identity rule whenever possible.
Customers and General Production must follow it too when showing customer, branch, machine, and serial context.

Important Collections SN rule:
- SN must display the actual serial when available.
- `Machine ####` is only a fallback machine label, not an acceptable SN display for normal collection rows.
- If no real serial exists, show a clear missing-serial state such as `No serial on file`, not `Machine ####` inside the SN column.

## Collections Rules
- Collections should use the Billing customer set as the base customer universe.
- Collections must also include unpaid invoices that still need follow-up even if the customer is no longer active for new billing.
- It is okay if the web app has more rows than the SQL screenshots.
- It is not okay if a real SQL/Billing customer or unpaid account is missing from the web workflow.
- The month matrix must be usable on desktop and mobile:
  - mouse drag or visible scrollbar should work
  - trackpad horizontal movement should work
  - touch swipe should work on phone
  - later month columns must be reachable without hidden/guesswork interactions

## Customer Module Rules
- Next user-requested work is Customer module continuation.
- Existing module files:
  - `customers/index.html`
  - `customers/js/customers.js`
  - `customers/js/customer-form.js`
  - `customers/css/customers.css`
  - `customers/css/customer-form.css`
- Customer directory should be based on the Active Contract Customer Graph for active customer/machine context.
- Raw `tbl_companylist` can be used for company profile data, but not as the sole active-customer list.
- Serial display must prefer `tbl_contractmain.xserial`, then `tbl_machine.serial`.
- Existing Customers form has branch/company/machine/contract editing code; treat save behavior carefully and do not casually alter running Billing/Collections code while improving Customers.
- Good next starting point: compare Customer module customer/branch/machine rows against Billing matrix rows and the legacy customer expectations, then fix missing/misgrouped customer details.

## Releasing Rules
- Releasing lives in `releasing/` and is live on Netlify.
- Heavy operational modules such as Releasing should show a staged progress bar with elapsed seconds during load so staff can tell whether the page is still working or is stuck on a specific step.
- DR Item List should expand quantity requests into separate unit rows.
  - Example: if reference `345898` has `3 pcs TONER / INK`, the list should show 3 separate rows/units.
  - If the user adds 1 row to Create DR, that 1 row should disappear from DR Item List while it is in Create DR.
  - The remaining 2 rows should stay in DR Item List.
- Create DR behavior:
  - Right-click a ready row to `Add to DR`.
  - Right-click a row inside Create DR to `Send back to DR Item List`.
  - `Clear` is manual and should be the only action that empties Create DR.
  - After `Print and Save`, Create DR rows should stay there until the user clicks `Clear`.
- Current Firebase write path in code:
  - `tbl_finaldr`: DR header record
  - `tbl_newfordr`: released item rows and source row updates/splits
  - `tbl_schedule`: `releasing_pending_qty` / `releasing_dr_done` updates for schedule-only source rows
- Current print/template behavior:
  - Print window opens immediately on click to avoid browser popup blocking.
  - DR print adjustment templates persist locally and sync to `tbl_app_settings/releasing_dr_print_templates_v1`.
- Pull-out form behavior:
  - Releasing has a `Print Pull Out Form` button for machines, cartridges, and parts already staged in Create DR.
  - For machine `Change unit` rows, the Pull Out Form must be printed before the delivery receipt can be previewed/printed.
  - Change-unit Pull Out Form printing records the old customer machine as `return_status = pending_return`, clears its active customer link, and writes a `marga_receiving_records` customer-machine-pullout audit record so Receiving can confirm office return later.
  - The form captures pulled-out-by, customer representative/released-by, pullout date/time, pickup receipt, and remarks.
- Important remaining verification:
  - For printed references like `345898`, confirm after Clear/reload that only the true remaining units come back from Firebase.

## Receiving Rules
- Receiving is the inbound counterpart to Releasing and should be implemented as its own `receiving/` module.
- Receiving is responsible for inbound operational accountability:
  - customer machine pullouts
  - office receipt of returned machines
  - return cartridges
  - purchased machines
  - purchased supplies / materials
  - parts or materials returned by technicians
- Machine pullout flow:
  - when a customer machine is pulled out, create a pending-return record and mark the machine with `return_status = pending_return`
  - store pulled-out-by, pullout date/time, pickup receipt, customer representative, previous branch/customer, and remarks
  - clear the active customer link on the old machine (`client_id`, `branch_id`, `company_id`, `isclient`) so it no longer appears as actively linked to the customer
  - do not move it to `FOR OVERHAULING` yet; it is only pending return while in transit
- Office receive flow:
  - office staff confirms the returned machine serial and receiving details
  - only after office receipt should the old machine move to `status_id = 7` / `FOR OVERHAULING`
  - receiving should create/patch app-side audit fields and a `tbl_newmachinehistory` row where possible
- Releasing / replacement-machine flow:
  - General Production allocation creates the machine item for Releasing
  - Releasing print/save prepares a pending customer-machine link for the replacement machine
  - the replacement machine remains `customer_link_status = pending_delivery` until driver/logistics closure confirms delivery
  - paper DR printed/received is not enough by itself to finalize the machine as actively linked
- Driver/logistics confirmation is the future finalizer:
  - once delivery is closed by logistics/field report, the replacement machine can become the confirmed customer-linked machine
  - this future flow should record receiver/customer representative, date/time, and delivery proof fields

## Billing Rules That Must Stay Protected
- Billing calculation modal should save the invoice first.
- Print button should stay disabled until the saved billing snapshot matches the current modal values.
- Invoice numbers must stay unique.
- Billing search must stay spacing/punctuation tolerant.
- Dashboard and invoice lookup totals must include second-meter legacy fields when present.
- Do not disturb the current grouped RTP and multimeter behavior while working on Collections.

## Module Status Board
| Module | Status | Current State | Next Safe Step |
| --- | --- | --- | --- |
| Billing | Protected / In Progress | Working save-first workflow, grouped RTP support, multimeter totals, search stability, Firebase print templates. | Consider adopting the accepted Collections matrix format only after separate Billing regression checks. |
| Customers | Next Focus / In Progress | Existing customer directory and edit form module under `customers/`; loads companies, branches, contracts, contract deps, machines, models, brands, areas, cities, bill info, and recent billed contract ids. | Continue here in next chat; align rows/details with the Active Contract Customer Graph and Billing customer truth. |
| Collections | Accepted / In Progress | Uses Billing-based coverage plus unpaid invoices. Matrix scroll format is accepted live: whole-sheet horizontal movement, visible arrows/Latest, Total at far right. | Preserve this format while continuing Collections parity work. |
| Master Schedule | Accepted / In Progress | Uses `tbl_savedscheds`/`tbl_printedscheds` joined to `tbl_schedule`; print layout is grouped by staff and now matches VBNet columns closely. | Keep daily printed route and carry-over logic aligned with Field App. |
| Field App | In Progress | Default `Today` tab shows printed route; `Carry Over` tab shows saved/unprinted and older open assigned jobs. New customer location pins are required before Finish when the branch has no saved coordinates; staff must add a frontage/building photo when pinning. | Keep today route fast; next step is action-based GPS events (`On the Way`, `Arrived`, `Check Out`, `Completed`) and photo upload hardening. |
| Service | In Progress | Must follow the same customer/serial identity rules as Billing. Service Dispatch has a `Service Progress` map centered on MARGA Office in Havila/Antipolo with a 15-mile radius and office marker. | Reuse Active Contract Customer Graph carefully; wire live GPS action events from Field App into the map. |
| General Production | Live / In Progress | Isolated `general-production/` module is deployed. Dashboard counts tuned to VB.NET screenshot targets. Machine Checker uses Billing-backed real serials with searchable dropdown, model/status/customer context, and add-new-machine form. For Overhauling rows can be double-clicked to assign a tech and move to Under Repair; Under Repair rows can be double-clicked to mark Machine Ready. | Add mismatch warning for active billing contract vs machine master status; continue source-table tuning only when user asks. |
| Releasing | Live / In Progress | Isolated `releasing/` module is deployed. DR Item List expands quantity into unit rows, supports right-click add/remove, print adjustment templates, immediate print-window opening, and Create DR stays populated until manual Clear. | Verify Firebase parity for partial-quantity cases like `345898` after Clear/reload; Billing is now the next chat focus. |
| Receiving | Live First Pass / In Progress | New inbound `receiving/` module is approved and first pass is implemented. It handles machine pending-return logging, returned-machine office receipt to For Overhauling, and generic receiving logs for cartridges, purchased machines, supplies/materials, parts, and tech returns. | Verify with real office pullout/receipt examples; later add driver/logistics delivery confirmation finalizer. |
| APD | In Progress | Prototype exists. | Keep separate from Billing/Collections risk. |
| Petty Cash | In Progress | Prototype exists. | Keep separate from Billing/Collections risk. |
| Sync Updater | In Progress | Dual-lane supervisor and recovery work already documented historically. | Keep stable; do not mix sync refactors with UI fixes. |

## Next Actions
1. Start next chat on Billing.
2. Read current Billing print/template workflow before editing; keep the protected Billing save/print behavior intact.
3. Reuse only proven patterns from Releasing where they help Billing:
   - template persistence
   - safe print-window timing
   - explicit partial-unit operational flow concepts
4. If Releasing is revisited later, verify Firebase state for partial references like `345898` after Clear:
   - confirm `tbl_finaldr` row exists
   - confirm source quantity was reduced in `tbl_newfordr` or `tbl_schedule`
   - confirm only remaining units reappear
5. Keep Billing, Collections, Master Schedule, Field App, General Production, and Releasing stable while working on Billing.
6. Continue module work without reverting unrelated dirty files.

## Session Log (Top First)
### 2026-06-16 - Purchasing Module And Production-First Test Workflow
- **Purchasing** verified on `app.marga.biz` (`/purchasing/`): Money Request item fields, amount, Set Schedule (Buy Items purpose), field schedule via `tbl_schedule` `purpose_id: 7`.
- **Owner test order:** local edit first, then live deploy to `app.marga.biz`, then owner test, then staging sync, then GitHub `main` push unless the owner explicitly requests another sequence.

### 2026-05-05 - Field Customer Location Pin Permission Hotfix
- Urgent production issue: Field App could not pin customer location and therefore could not close a ticket. Mobile alert showed `Failed to pin customer location: Missing or insufficient permissions.`
- Root cause: the new helper collections `marga_field_visit_events` / `marga_location_frontage_photos` were not allowed by the current Firestore legacy `tbl_.*` rules.
- Local commit `e6b5c0d` fixes the close flow:
  - writes Field GPS events/photos to `tbl_field_visit_events` and `tbl_location_frontage_photos`
  - saves the schedule proof first so ticket closure is not blocked by optional branch/event helper writes
  - keeps branch coordinate update best-effort and marks `field_customer_location_branch_update_status = pending_admin_sync` if branch master update fails
  - falls back to storing compressed frontage photo data on the schedule if the helper photo collection write fails
  - Service Progress reads both `tbl_field_visit_events` and legacy `marga_field_visit_events`
- Cache-busted live scripts:
  - Field: `field/js/field.js?v=20260505-location-pin-permission-fix-1`
  - Service: `service/js/dispatch-board.js?v=20260505-field-events-tbl-1`
- Validation passed:
  - `node --check field/js/field.js`
  - `node --check service/js/dispatch-board.js`
  - `git diff --check -- field/index.html field/js/field.js service/index.html service/js/dispatch-board.js`
- Netlify production hot deploy completed for site `48f0afdd-0bb5-4b04-b935-7251b49c0c54`; live URL `https://margaapp.netlify.app` was serving the new cache-busted files.
- Normal `git push origin main` was blocked by GitHub credentials; local commit `e6b5c0d` exists and should be pushed when credentials are restored so future Git-based deploys do not overwrite the hotfix.

### 2026-04-30 - Service Progress Map And Field Location Pinning
- Added Service Dispatch `Service Progress` map button/panel.
- Map behavior:
  - uses Leaflet/OpenStreetMap
  - starts centered on MARGA Office near Havila/Mission Hills, Antipolo
  - shows a 15-mile service radius and visible `MARGA Office` marker
  - intentionally keeps initial load light and does not render scheduled-client fallback pins by default
  - live staff GPS pins are expected from `marga_field_visit_events`
  - protected Leaflet tile CSS in `service/css/service.css` after map tiles initially rendered cropped under app styles
- Field App location enforcement:
  - every task modal has `Customer Location Pin`
  - if `tbl_branchinfo.latitude` and `tbl_branchinfo.longitude` already exist, no pin is required
  - if branch coordinates are missing, staff cannot mark the schedule `Finished`
  - staff must tap `Pin Customer Location` while at the client site
  - pinning writes coordinates and audit fields to `tbl_branchinfo`
  - pinning patches summary fields on `tbl_schedule`
  - pinning writes a `marga_field_visit_events` event with action `customer_location_pinned`
  - pinning now requires a frontage/building photo so the office knows what the customer site looks like
- Frontage photo behavior:
  - Field App compresses the selected camera image before saving
  - attempts Firebase Storage upload under `field-location-photos/...`
  - if Storage rules reject upload, falls back to one compressed data-url document in `marga_location_frontage_photos` and stores only the doc id on branch/schedule/event rows
  - branch fields include `location_frontage_photo_url`, `location_frontage_photo_path`, `location_frontage_photo_doc_id`, and storage metadata
- Important next step:
  - implement action-based GPS buttons in Field App: `On the Way`, `Arrived`, `Check Out`, `Completed`
  - first-arrival lateness rule: Metro Manila by 8:00 AM, province by 9:00 AM
  - completion proof photo should upload directly and should not save into the phone gallery when possible

### 2026-04-30 - Receiving Workflow Approved
- User approved a dedicated Receiving module instead of overloading Machine Checker.
- First pass implemented as `receiving/`.
- Final intended flow:
  - General Production allocates replacement machines.
  - Releasing prints/saves DR and prepares a pending customer-machine link.
  - Driver/logistics closure later confirms the replacement machine as actively linked to the customer.
  - Pulled-out old customer machines become `pending_return` with pulled-out-by, date/time, pickup receipt, customer representative, previous customer/branch, and remarks.
  - Office Receiving confirms returned machines and moves them to `FOR OVERHAULING`.
- Important design rule:
  - the old machine must not remain actively linked to the customer after pullout
  - the new machine should not become confirmed active customer machine until delivery confirmation supersedes it

### 2026-04-23 - Releasing Module Live And Iterated
- Added isolated `releasing/` module with DR Item List and Create DR workflow.
- Releasing live URL: `https://margaapp.netlify.app/releasing/`.
- Pushed and deployed:
  - `dc2a50b` `Add Releasing delivery receipt module`
  - `555af71` `Use context menu for releasing DR items`
  - `b148610` `Add DR print adjustment controls`
  - `71a2afc` `Add releasing return and DR print templates`
  - `da0bad8` `Keep releasing print footer visible`
  - `f8160ff` `Keep Create DR items after printing`
  - `872700b` `Hide Create DR units from releasing list`
- Implemented behaviors:
  - quantity requests expand into separate rows/units
  - right-click add to Create DR
  - right-click send back from Create DR
  - print adjustment with template save/load/delete
  - template persistence to `tbl_app_settings/releasing_dr_print_templates_v1`
  - print window opens immediately to reduce popup blocking
  - Create DR stays populated after print until manual Clear
  - rows already added to Create DR are hidden from DR Item List until removed or cleared
- Current verification note:
  - for references like `345898`, the intended rule is partial delivery:
    - if request qty is 3 and user prints 1, then 2 should remain in DR Item List after Clear/reload
  - if more than the true remaining quantity comes back, inspect Firebase rows before changing filters again

### 2026-04-23 - General Production Repair Workflow Added
- Added double-click production workflow:
  - Double-click a `For Overhauling` machine row to open an assignment modal.
  - Enter assigned technician name; save patches `tbl_machine.status_id` to `8` and stores `production_assigned_tech` / `assigned_tech_name`.
  - Row moves to `Under Repair` immediately in the dashboard.
  - Double-click an `Under Repair` row to open a ready confirmation modal.
  - Save patches `tbl_machine.status_id` to `1`, clears current assigned tech fields, stores ready audit fields, and moves row to `Machine Ready`.
- Scoped to `general-production/` only.

### 2026-04-22 - General Production Live, Machine Checker Uses Billing Serials
- General Production live URL: `https://margaapp.netlify.app/general-production/`.
- Pushed and deployed:
  - `e835737` `Add General Production module`
  - `c96f4de` `Tune General Production legacy counts`
  - `c338d13` `Fix General Production machine checker serials`
  - `e64e5b6` `Use billing serials in machine checker`
- Correct production site is `https://margaapp.netlify.app` with two `p`s in `margaapp`.
- Dashboard panel counts were tuned to match the VB.NET reference:
  - Machine Requests `99`
  - For Termination / Upgrade `34`
  - Source: To Purchase `3`
  - Source: From Overhauling `2`
  - Machine Ready `27`
  - For Overhauling `432`
  - Under Repair `10`
- Machine Checker now:
  - Uses `openclaw-billing-cohort` / Billing matrix rows first for real serials.
  - Falls back to `tbl_machine` serials for machines not in Billing.
  - Has custom searchable dropdown filtering as the user types.
  - Shows model, status, and customer/branch context.
  - Saves status/model to the exact `tbl_machine` document.
- Verified examples from Billing serial truth:
  - `E80726L3H798535 -> DCP-T720DW -> Five Star Global Logistics Inc.`
  - `E78998E9H371508 -> MFC-J3530DW -> LINFRA CORP.`
- Important data finding:
  - `E80726L3H798535` maps to `tbl_machine/3482`, `status_id: 2`.
  - `tbl_newmachinestatus/2` is `FOR DELIVERY`.
  - It also has active billable contract `tbl_contractmain/5481` for Five Star, branch `3635`.
  - `tbl_newmachinehistory/22004` has `status_id: 2`, remarks `For Delivery`, branch `3635`.
  - Conclusion: app is showing true machine-master status, but data is inconsistent/stale because Billing contract is active while machine master remains `FOR DELIVERY`.
  - Future General Production fix: warn when an active Billing contract exists but machine master status still indicates `FOR DELIVERY`.

### 2026-04-22 - Customer Module Next
- User requested docs update because the next chat will continue the Customer module.
- Existing Customers module should be treated as next focus, not recreated from scratch.
- Important current customer module files:
  - `customers/index.html`
  - `customers/js/customers.js`
  - `customers/js/customer-form.js`
  - `customers/css/customers.css`
  - `customers/css/customer-form.css`
- Next thread should compare Customers rows to Billing/customer graph parity before making UI or save changes.

### 2026-04-22 - General Production First Pass Implemented
- Added isolated `general-production/` module with a dense dashboard inspired by the provided VB.NET screenshots.
- Dashboard panels added:
  - `Machine Requests`
  - `For Termination / Upgrade`
  - `Source: To Purchase`
  - `Source: From Overhauling`
  - `Machine Ready`
  - `For Overhauling`
  - `Under Repair`
- Added top controls: search, All/Laser/Inkjet filter, `Refresh All`, CSV exports, and `Machine Checker`.
- Added Machine Checker modal:
  - Status Changer for existing serial/model/status.
  - Add New Machine form for brand/model/serial/brand-new-or-second-hand/DP date.
- Wired module into Dashboard, Service, Inventory, Settings nav, Settings module registry, and admin/service permissions.
- Status source prefers `tbl_newmachinestatus` and falls back to the confirmed status list from the earlier migration helper.
- Local checks passed:
  - `node --check general-production/js/general-production.js`
  - `node --check shared/js/auth.js`
  - `node --check settings/js/settings.js`
  - `node --check shared/js/utils.js`
  - `git diff --check`

### 2026-04-22 - General Production Planned, Implementation Deferred (Superseded)
- This planning note was superseded later on 2026-04-22 by the live General Production implementation and follow-up commits listed above.
- Next chat should analyze sources before coding:
  - service module records that indicate machine change requests
  - service termination/upgrade signals
  - purchase request sources
  - machine status/status ID tables
  - inventory/returned-machine source for future General Inventory
- Requested Machine Checker behavior:
  - status changer for existing machine serial/model/status
  - add new machine form for brand/model/serial/new-or-second-hand/DP date
  - statuses shown in the screenshot include `IN STOCK`, `FOR DELIVERY`, `DELIVERED`, `USED / IN THE COMPANY`, `JUNK`, `FOR OVERHAULING`, `UNDER REPAIR`, `FOR PARTS`, `FOR SALE`, `TRADE IN`, `OUTSIDE REPAIR`, `MISSING`, `OLD`, `UNDER QC`, `N/A`, and `Delivered (No Contract/To Receive)`.

### 2026-04-22 - Field App Carry Over Tab
- Commit `dec0127` added Field App tabs:
  - `Today` is the default current printed route view.
  - `Carry Over` shows saved/unprinted carry-over work plus older open assigned jobs up to 45 days back.
- For Crispin on 2026-04-22, data check showed 15 Today tasks and 35 Carry Over tasks.
- Today route renders before carry-over scan completes so the field staff default view stays fast.

### 2026-04-22 - Master Schedule And Printed Route Alignment
- Commit `3f3ab9c` made Master Schedule use `tbl_savedscheds` / `tbl_printedscheds` joined to `tbl_schedule`, with Ready YES/NO/N/A grouping and Pending Not Routed.
- Commit `caafb64` changed Master Schedule print columns to match the VB.NET daily schedule request:
  - `TIN #`, `Customer / Branch`, `Purpose`, `Model`, `Trouble`, `City`, `Address`, `Days Pending`, `Ready`, `Assigned To`.
- Verified Field App's Crispin printed route matched the 15 printed-route schedule IDs from Master Schedule for 2026-04-22.

### 2026-04-21 - Collections Matrix Format Accepted
- User confirmed the live Collections month-to-month matrix now works and is preferred over Billing's current matrix format.
- Accepted behavior:
  - no horizontally sticky RD/SN/Customer/Branch columns
  - whole table moves horizontally
  - arrows and `Latest` control work
  - auto-scroll anticipates current/newer months
  - far-right column is `Total`
- Preserve this pattern as a candidate for future Billing matrix redesign.

### 2026-04-21 - Single Source Of Truth And Latest Collections Handoff
- Merged the duplicated root/docs handoff and masterplan into one root `HANDOFF.md` and one root `MASTERPLAN.md`.
- Retired the duplicate `docs/HANDOFF.md` and `docs/MASTERPLAN.md` so future threads do not read conflicting instructions.
- Added the newest live Collections concern from `Screenshot 2026-04-20 at 11.10.02 PM.png`:
  - month matrix still not reliably scrollable
  - SN still shows `Machine ####` in production
- Confirmed the current next-thread priority is Collections live parity without breaking Billing presentation.

### 2026-04-20 - Collections Coverage And UI Work
- Collections was moved to use the Billing customer base plus unpaid invoices.
- Added RD visible count in the matrix header.
- Implemented serial/coverage work intended to stop `Machine ####` SN fallbacks, but the live page still shows the issue and needs another pass.
- Added responsive/mobile matrix handling and then a custom drag scrollbar, but the latest live observation says the interaction is still not good enough.

### 2026-04-20 - Billing RD Parity Sweep
- Verified and aligned Billing reading-day parity across RD 1 to RD 31 against user-provided legacy screenshots.
- Billing cohort work now includes status/date protections needed for the SQL to Firebase migration.
- Protected the current Billing dashboard behavior while widening row coverage for real billing parity.

### 2026-04-17 - Billing Protection And Print Rules
- Billing save-first workflow, invoice lookup/delete tracing, and RTP/RTF print calibration were locked in as the protected operational baseline.
- Firebase invoice print templates remain the source of truth through `tbl_app_settings/billing_invoice_print_templates_v1`.

## Historical Notes
- `HANDOFF-COLLECTIONS-010626.md` is a historical module-specific note only.
- Historical changelog remains in `/Volumes/Wotg Drive Mike/GitHub/Marga-App/docs/CHANGELOG.md`.

---

## 2026-07-14 — Marga Care Portal (care.marga.biz) — Full Build Session

### What Was Built This Session

#### Infrastructure
- `marga-service-portal-server.mjs` — full Node.js HTTP server (3,100+ lines) running on port 9200, served via Cloudflare Tunnel to `care.marga.biz`. Permanent LaunchAgent: `com.marga.service-portal` (PID ~749, KeepAlive: true).
- `marga.portal_accounts` — 2,319 accounts generated (1,070 company admins + 1,247 branch users + 2 originally 1,068). Passwords hashed with Argon2id. Zero plaintext stored in DB.
- `marga.care_account_scopes` — scope table linking accounts to companies. Supports multi-company overseers.
- New DB columns added: `contact_email`, `registered_name`, `registered_at` on `portal_accounts`.
- Snapshot queue drain LaunchAgent (`com.marga.snapshot-queue-drain`) — runs every 5 minutes, processes `app_meta.master_schedule_snapshot_rebuild_queue`.

#### Auth System
- Cookie-based session (HttpOnly, Secure, SameSite=Strict). Token = custom HMAC signed JSON.
- Login accepts: email login, company code login (`C00072-B00082`), OR self-registered `contact_email`.
- Multi-company overseer: on login, server fetches all `care_account_scopes` for the account and returns `companyIds: [836, 847]` in session. Group switcher in sidebar when `companyIds.length > 1`.
- `portalScopeWhere()` — scopes all queries to the active company. `activeCompanyId` passed as query param from client.

#### Self-Registration (`/register.html`)
- Public page, no auth required.
- Step 1: Enter company code (e.g. `C00072`) → validated against `marga.companies`.
- Step 2: Select branch from searchable list. Already-registered branches show "Registered" badge and are not selectable.
- Step 3: Enter full name, email, password (min 8 chars, with strength meter). On submit: saves `contact_email`, `registered_name`, hashes password, sets `must_change_password = false`, sets `registered_at`.
- "Register your branch here →" link on login page.
- `/portal-api/register/company?code=` — validates company code.
- `/portal-api/register/branches?companyId=` — returns branch list with `available`/`taken` status.
- `/portal-api/register/claim` — claims a branch account.

#### Admin Credentials & Access Tab
- Two-tab admin home: **Customer Preview** (existing) + **Credentials & Access** (new).
- Live searchable table of all `portal_accounts` — filter by role, status, active/inactive.
- Shows: Name/Login, Company/Role, Contact Email (self-registered), Delivery Email (internal), Status (Registered/Pending/New PIN/Active/Inactive).
- **[Edit]** — inline row: change display name, delivery email, login username.
- **Company Access section** — shows all linked companies as tags. Search + link additional companies. Unlink with ✕ (cannot unlink primary company).
- **[New PIN]** — calls `generate-password` route, shows PIN once in modal with copy button. Never stored.
- **[Deactivate/Activate]** — toggles `portal_accounts.active`.
- Server routes: `GET /portal-api/admin/credentials`, `PATCH /portal-api/admin/credentials/:id`, `POST /portal-api/admin/credentials/:id/toggle-active`, `POST /portal-api/admin/credentials/:id/link-company`, `DELETE /portal-api/admin/credentials/:id/unlink-company/:companyId`.

#### Multi-Company Overseer (Merge Script)
- `scripts/merge-multi-company-accounts.mjs` — finds same-email company_admin accounts across multiple companies, merges secondary company scopes into primary account, deactivates secondary accounts.
- Run: `node scripts/merge-multi-company-accounts.mjs` (dry run), `--apply` to execute.
- 8 merges applied: 7 via email match, 1 manual (CBS Norisa Arias — `naarias.cbs@chinabank.ph` now sees both company_id 836 and 847).
- Account 51 (`dbcuevas.cbs@chinabank.ph`) deactivated, scope 847 added to account 50.

#### Device Status Logic (Customer-Facing)
- `deriveCustomerStatus(serialAvailable, statusId)` — canonical function.
- **Has serial → Active** (regardless of internal status — machine is physically at customer).
- **No serial + NULL status → Needs Attention** (flag for ops, 330 across all companies).
- **No serial + any status → Active** (contract active, machine present, serial missing from records).
- **CHANGE UNIT in `tbl_newmachinehistory` → For Replacement** (overrides Active).
- Removed: Incoming, Under Repair, Pending Setup, Delivered, Unknown from customer view.
- Internal status map (`CUSTOMER_STATUS_LABELS`) kept for admin views only.

#### Device Status Filter Chips
- Filter chips above machine list: All | Active | Needs Attention | For Replacement | Inactive.
- Each chip shows count. Clicking filters instantly. Works alongside search.
- `state.deviceStatusFilter` drives filtering client-side.

#### Branch Name Cleaning
- `cleanBranchName(value)` in `utils.js` — strips `~xx`, `~x`, `~xxx` prefix from all branch names before display.
- Applied: device list, branch dropdowns, admin preview table, invoice breakdown, toner form, service request form.
- Also applied server-side in `listDevices` query via `regexp_replace`.

#### Billing — Grouped Invoice View
- Invoices grouped client-side by `invoice_no`. When one invoice_no spans multiple branches (e.g. CBS 836 — 155 branches under invoice 132231): shows one summary row with total amount + "▼ N branches" expand button.
- `billing_month` NULL fix: derives period from `invoice_date` when `billing_month` is NULL (affects CBS grouped accounts).
- Due date formatted to `Jun 30, 2026` Manila time via `formatDatePH()`.
- Status badge fixed: `'0'` or null → shows "Unpaid" (was rendering `0` badge).
- Payments pane removed from billing page.
- Server `listInvoices` now returns `branchName` for grouped breakdown.

#### Photo Upload (Multipart)
- `readMultipart(req)` — pure Node.js Buffer multipart parser, no external library.
- Both `/portal-api/tickets` and `/portal-api/toner-requests` detect `multipart/form-data` and parse file.
- `saveUploadedFile()` saves to `public/uploads/` with timestamped filename, returns `/uploads/filename` URL.
- `DataService.createTicket` and `createTonerRequest` send `FormData` when photo present.
- Toner form now has "Attach Photo" field.

#### AI Chat (Contact Marga)
- Claude Sonnet 4.6 via Anthropic API. Customer-context system prompt includes company name.
- Responds in English or Taglish. Escalates to `+63-2-8123-4567` / `solutions@marga.biz` when needed.
- Enter key + Send button. Typing indicator. `aiChatState` manages message history.

#### KPI Cards
- Dashboard KPI cards are now clickable — each navigates to the relevant section.
- Open Service Requests → tickets, Pending Toner → toner, Machines In Care → devices, Outstanding Balance → billing.
- `→` arrow with hover animation. Keyboard accessible.
- Removed fake `+1.9% than last update` CSS pseudo-element.

#### Onboarding Email
- Sent via Hostinger SMTP (`accounting@marga.biz`, port 465 TLS). Script: `/tmp/send_welcome_v2.mjs`.
- Test email sent to `michael.marga@gmail.com` as CBS overseer. Content confirmed clean (ASCII only, no Unicode/emoji encoding issues).
- Email contains: portal URL, login credentials, temporary PIN, company access codes (C00072 branches, C00073 departments), registration link for branches, feedback request.

### Canonical Rules — Marga Care Portal

#### Data Rules
- **Active contract graph**: always use `api.active_customer_graph`, never raw `marga.machines.current_company_id`.
- **Branch scope**: all portal API queries scoped server-side via `portalScopeWhere()`. Never trust URL params alone — scope comes from JWT.
- **Branch isolation**: `branch_user` role can only see their own `branch_id`. `company_admin` sees all branches under their linked `company_ids`.
- **Machine status**: use `deriveCustomerStatus(hasSerial, statusId)` always. Never show internal logistics statuses (DELIVERED, FOR DELIVERY, etc.) to customers.
- **Branch names**: always clean with `cleanBranchName()` or `regexp_replace(name, '^~x+\s*', '', 'i')` before display.
- **Billing period**: `billing_month` is NULL for grouped accounts — always derive from `invoice_date` using the CASE expression in `listInvoices`.
- **Payments scope**: use `company_id` scope only (not `branch_id`) for grouped billing accounts (CBS pattern).
- **Change unit detection**: query `tbl_newmachinehistory` where `remarks ILIKE '%CHANGE UNIT%'` and `branch_id = branch_legacy_id::text`.

#### Auth Rules
- `portal_accounts` is completely separate from `tbl_employee` and `app_meta.users`. No shared credentials.
- `contact_email` = customer's self-registered email (login + notifications). Set by customer during registration.
- `credential_delivery_email` = Marga internal delivery address (where Marga sends PINs and notices). Set by Marga admin only.
- Never show plaintext passwords in any UI. Generate PIN once, show in modal, never store.
- The CSV export at `~/Documents/Marga-Exports/` is a one-time delivery record. Delete after all customers have logged in.

#### Server Rules
- All registration routes (`/portal-api/register/*`) are public — no auth required.
- All other `/portal-api/*` routes require valid `msp_session` cookie or `Authorization: Bearer` token.
- Admin routes (`/portal-api/admin/*`) additionally require `role IN (marga_admin, marga_staff)` via `requireInternalUser()`.
- Photo uploads saved to `marga-service-portal/public/uploads/`. Ensure this directory is not committed to git (add to .gitignore).

#### Deployment Rules
- Version string in `public/index.html` `<script src="/src/portal-main.js?v=...">` must be bumped on every deploy so browsers reload JS.
- Server restart: `launchctl stop com.marga.service-portal && sleep 2 && launchctl start com.marga.service-portal`.
- Health check: `curl -s http://127.0.0.1:9200/health` → `{"ok":true,"app":"marga-service-portal"}`.
- Current version deployed: `v=20260710-device-filter-1`.

### Known Issues / Open Items as of 2026-07-14

1. **Real service history not shown** — portal only shows portal-submitted tickets (zero). `tbl_schedule` has 44,000+ CBS service/delivery records completely unused. First-time customers see all zeros and think portal is broken. **CRITICAL — fix first.**
2. **No email confirmation on request submit** — customer submits service/toner request, nothing happens on their end. No email, no notification to service team.
3. **No Field App → portal status feedback** — when a tech is dispatched/completes a job, portal ticket status stays "Pending". There is no webhook or polling connecting Field App close events to portal ticket status.
4. **Mobile experience** — machine list requires horizontal scroll on phone. Service request form has 4 dropdowns. Not urgent enough for 9am "machine is jammed" scenario.
5. **330 "Needs Attention" devices** — machines with no serial and no status across all companies. Admin pending-devices route exists (`/portal-api/admin/pending-devices`) but no UI panel yet. These need ops team investigation.
6. **`active_machine_count` in credential CSV** — still blank for most accounts (export script used wrong source). Portal itself uses `api.active_customer_graph` correctly — CSV field is stale. Do not use CSV for machine counts.
7. **PDF generation** — SOA PDF not built. Billing table shows `-` in PDF column.
8. **Payment proof upload** — not built. Customer cannot upload deposit slip.
9. **PWA push notifications** — not implemented.
10. **Assigned tech card** — tech name/contact not shown on machine detail.
11. **Device history** — `tbl_schedule` history join uses `serial` field but many CBS machines have `machine_legacy_id` mismatch. History modal shows empty for most machines.
12. **Group switcher "All Groups"** — when null (all groups combined), `portalScopeWhere` uses `company_id = any([836,847])`. Verify summary numbers are not double-counted for shared billing.
13. **`~xx` branch names** — cleaned client-side and server-side in most places. Audit `tbl_branchinfo` legacy names — some branches have `~xx` as their entire name (stripped to empty string). These are excluded from the registration branch list via `length > 0` filter.
