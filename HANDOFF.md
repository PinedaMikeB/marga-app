# MARGA App Development Handoff

## 📅 Last Updated: February 12, 2026

## 🎯 Project Overview
Building a modern web-based enterprise management system for **Marga Enterprises** to replace the legacy VB.NET desktop application. The app manages customers, billing, collections, service, and machine contracts for a printer rental business.

---

## Current Focus
- User login + role management (email + password) for office + field use.
- Service Dispatch Board: daily operations view, carryover, monitoring, CSR request entry.
- Sync Updater: keep Firestore updated from MySQL dumps without re-uploading everything.
- Field App execution modal: complete technician/messenger workflow with serial validation, parts, meter, time logs, and customer PIN close.

## Next Actions
- Sync missing support tables needed for CSR/dispatch UX (example: `tbl_branchcontact`, `tbl_inventoryparts`, `tbl_mstatus`).
- Prioritize user login + role management (admin-managed passwords; no self-service changes yet).
- Make schedule creation collision-safe (avoid `max(id)+1` collisions when two CSRs create at the same time).
- Expand “pending monitoring” metrics and drill-down lists (change unit, parts pending, machine delivery, overdue tickets).
- Tighten role-based visibility so non-admins only see their department/module data.
- Add admin/CSR UI to manage branch customer PINs (`marga_branch_pins`) so field staff can complete Finished validation flow.
- Connect production queue (`marga_production_queue`) into a dedicated Production/Purchasing view.
- Add actual photo upload/storage flow (Firebase Storage) for before/after repair evidence; currently only file metadata is saved.
- Build admin approval screen for `marga_serial_corrections` (approve/reject + apply serial mapping).

## Open Questions
- Which legacy tables are the authoritative “daily sheet” source: `tbl_schedule` vs `tbl_savedscheds` vs `tbl_printedscheds`?
- How should “customer PIN close” be stored (new Firestore-only fields vs mapped to an existing legacy column)?
- What is the exact definition of “continuous service / parts pending” in the legacy workflow (which fields/tables represent it)?
- Attendance module requirements (future): time-in/out, selfie photo, and geolocation validation for office vs client site.
- Customer PIN policy: fixed branch-level PIN vs rotating codes per month/per request.

## Latest Session (February 12, 2026)
- Field App modal was expanded for real technician workflow:
  - searchable serial database lookup
  - missing serial checkbox + admin approval queue entry (`marga_serial_corrections`)
  - model/brand auto-pull from selected serial
  - machine status + parts needed list with quantity
  - previous/present meter + auto total consumed
  - time-in/time-out capture and `tbl_schedtime` upsert
  - delivery details, empty pickup details, customer signer/contact, final acknowledgement
  - save draft / pending / finished actions
- `Mark Finished` still enforces branch customer PIN and writes close audit fields.
- `Mark Pending` continues to create production queue entries and now includes richer context.
- Photo fields are available in UI now; saved as metadata in schedule fields (full binary upload is still pending).

---

## 📁 Project Location
```
/Volumes/Wotg Drive Mike/GitHub/Marga-App/
```

## 🌐 Deployment Info
- **GitHub Repo:** https://github.com/PinedaMikeB/marga-app.git
- **Subdomain:** app.marga.biz (created in Hostinger)
- **Main Domain:** marga.biz (WordPress - keep separate, ranks #2 in SERP)

---

## ✅ What's Been Completed

### Session: December 31, 2025 (Afternoon)

#### 1. ✅ Serial Number Validation - IMPLEMENTED
- **Real-time validation** as user types (500ms debounce)
- **Duplicate check** against all machines in database
- **Visual feedback:**
  - ✓ Green border = Valid/Unique serial
  - ✗ Red border = Duplicate detected
  - ⏳ Loading indicator while checking
- **Error message** shows which machine already has the serial
- **Blocks save** if duplicate serial is entered
- **Auto-uppercase** serial numbers on save

#### 2. ✅ Machine Edit Audit Log - IMPLEMENTED
- **New collection:** `tbl_machine_history`
- **Tracks all changes** to machine data:
  - Old values vs New values
  - Changed by (user)
  - Timestamp
- **Only logs actual changes** (skips if no changes made)
- **Structure:**
  ```javascript
  {
    id: 1,
    machine_id: 400,
    changed_by: 'admin',
    changed_at: timestamp,
    changes: {
      serial: { old: 'ABC123', new: 'XYZ789' },
      description: { old: 'DCP-7040', new: 'DCP-7065DN' }
    },
    old_values: { serial: 'ABC123', description: 'DCP-7040' },
    new_values: { serial: 'XYZ789', description: 'DCP-7065DN' }
  }
  ```

#### 3. ✅ Machine Status Codes - IDENTIFIED & MAPPED
- **Source:** `tbl_newmachinestatus` from MySQL dump
- **Status ID meanings:**
  | ID | Status | Description |
  |----|--------|-------------|
  | 0 | Not Set | No status assigned |
  | 1 | On Stock | Available in warehouse |
  | 2 | For Delivery | Scheduled for delivery |
  | 3 | Delivered | Deployed to customer |
  | 4 | Used W/in Company | Internal use |
  | 5 | For Junk | Pending disposal |
  | 6 | Junk | Disposed |
  | 7 | For Overhauling | Needs major repair |
  | 8 | Under Repair | Currently being fixed |
  | 9 | For Parts | Cannibalized for parts |
  | 10 | For Sale | Listed for sale |
  | 11 | Trade In | Traded in |
  | 12 | Outside Repair | External repair |
  | 13 | Missing | Cannot be located |
  | 14 | Old | Legacy/outdated |
  | 15 | Under QC | Quality control check |
  | 16 | Duplicate | Duplicate entry |
  | 17 | N/A | Not applicable |
  | 18 | Delivered (No Contract) | Delivered but no contract yet |

- **Machine status badge** now displayed next to Machine ID in form
- **Migration script created:** `migrate-status.html`

#### 4. ✅ Contract Status Table - IDENTIFIED
- **Source:** `tbl_contractstatus` from MySQL dump
- **Note:** These are different from the contract status already in use

### Session: December 30-31, 2025 (Earlier)

#### 1. Fixed Customer/Contract Statistics
- **Issue:** Dashboard showed 4,594 active machines instead of actual 1,602
- **Cause:** Code was counting `status != 2` as active instead of `status == 1`
- **Fix:** Updated `getMachineCount()` and `updateStats()` in customers.js
- **Result:** Accurate counts now displayed

#### 2. Machine & Contract Section (Edit Customer Form)
- Added expandable Machine & Contract section to branch tabs
- Shows all contracts linked to each branch
- Displays:
  - Machine ID, Brand, Model, Serial Number
  - Contract Category Badge (RTP, RTF, MAP, etc.)
  - Contract Status Badge (Active, Ended, Terminated, etc.)
  - VAT indicator

#### 3. Editable Contract Rates
- Status dropdown (Active, Ended, Terminated, etc.)
- VAT dropdown (Inclusive/Exclusive)
- B&W Rates: Page Rate, Monthly Quota, Monthly Rate
- Color Rates: Page Rate, Monthly Quota, Monthly Rate
- All saved to `tbl_contractmain` on Save

#### 4. Contract Category Codes (tbl_particulars)
- Migrated category table to Firebase
- Categories determine billing method:
  - **RTP** = Rental Per Page (needs meter reading)
  - **RTF** = Fixed Rate (no reading needed)
  - **MAP** = Maintenance Per Page (needs reading)
- Category displayed as read-only (cannot be changed to protect billing logic)

#### 5. Editable Machine Details ✅ COMPLETE (with safeguards)
- Brand, Model, Serial Number now editable
- Yellow highlighted fields indicate editable machine data
- **Serial Validation:** Prevents duplicate serial numbers across machines
- **Audit Logging:** All machine changes logged to `tbl_machine_history`
- **Real-time Feedback:** Shows ✓ or ✗ as user types serial number

#### 6. Machine Status Reference Table (tbl_newmachinestatus)
- Migrated 18 machine statuses to Firebase
- Status codes now verified and documented:
  - 1=On Stock, 2=For Delivery, 3=Delivered, 4=Used W/in Company
  - 5=For Junk, 6=Junk, 7=For Overhauling, 8=Under Repair
  - 9=For Parts, 10=For Sale, 11=Trade In, 12=Outside Repair
  - 13=Missing, 14=Old, 15=Under QC, 16=Duplicate, 17=N/A
  - 18=Delivered (No Contract/To Receive)

---

---

## ✅ RESOLVED: Machine Data Integrity (Previously Critical Risks)

### ✅ Risk 1: Overwriting History - RESOLVED
- **Solution:** `tbl_machine_history` audit log
- All changes are now logged with old/new values and timestamp

### ✅ Risk 2: Duplicate Serial Numbers - RESOLVED  
- **Solution:** Real-time serial validation
- Duplicates are blocked from being saved
- User gets immediate feedback when entering duplicate serial

### ⚠️ Risk 3: Orphan References - PARTIALLY ADDRESSED
- Audit log helps track what changed
- **Future:** Consider locking serial after invoices are generated

### Future Enhancement (TODO)
- **Lock After Deployment:**
  - Once machine has active invoices, serial should be read-only
  - Only admin can unlock for editing
  - Require reason for change

---

## 🔄 Data Flow & Relationships

### Customer → Contract → Machine Flow
```
┌─────────────────┐
│ tbl_companylist │  (Company: "ABC Corp")
│     id = 100    │
└────────┬────────┘
         │ company_id
         ▼
┌─────────────────┐
│ tbl_branchinfo  │  (Branch: "Main Office")
│     id = 200    │
│  company_id=100 │
└────────┬────────┘
         │ branch_id (stored as contract_id in contract)
         ▼
┌─────────────────┐
│tbl_contractmain │  (Contract: rates, status)
│     id = 300    │
│ contract_id=200 │ ← This is the BRANCH id
│   mach_id=400   │
│ category_id=1   │ ← RTP (Rental Per Page)
│    status=1     │ ← Active
│  page_rate=0.5  │
└────────┬────────┘
         │ mach_id
         ▼
┌─────────────────┐
│  tbl_machine    │  (Machine: serial, model)
│     id = 400    │
│  model_id=10    │
│  brand_id=5     │
│  serial=XYZ123  │
│  status_id=3    │ ← Deployed (in warehouse status)
└─────────────────┘
```

### Billing Workflow (RTP - Rental Per Page)
```
1. Get all contracts where category_id = 1 (RTP) AND status = 1 (Active)
2. For each contract:
   - Get previous meter reading
   - Enter present meter reading
   - Calculate: consumption = present - previous
   - If consumption < monthly_quota:
       amount = monthly_quota × page_rate
   - Else:
       amount = consumption × page_rate
   - Add VAT if withvat = 1
3. Generate invoice
```

### Billing Workflow (RTF - Fixed Rate)
```
1. Get all contracts where category_id = 2 (RTF) AND status = 1 (Active)
2. For each contract:
   - amount = monthly_rate (no reading needed)
   - Add VAT if withvat = 1
3. Generate invoice
```

---

## 📊 Database Collections & Key Fields

### tbl_companylist (1,143 records)
| Field | Type | Description |
|-------|------|-------------|
| id | int | Primary key |
| companyname | string | Company name |
| company_tin | string | Tax ID |
| business_style | string | Business style |

### tbl_branchinfo (3,336 records)
| Field | Type | Description |
|-------|------|-------------|
| id | int | Primary key |
| company_id | int | FK to companylist |
| branchname | string | Branch name |
| city | int | FK to tbl_city |
| area_id | int | FK to tbl_area |

### tbl_contractmain (4,600 records)
| Field | Type | Description |
|-------|------|-------------|
| id | int | Primary key |
| contract_id | int | FK to branchinfo (branch_id) |
| mach_id | int | FK to machine |
| category_id | int | FK to tbl_particulars |
| status | int | Contract status (1=Active) |
| page_rate | float | B&W rate per page |
| monthly_quota | int | Minimum pages |
| monthly_rate | float | Fixed monthly fee |

---

## ✅ What's Been Completed (Newer Sessions)

### Session: February 10, 2026

#### 0. User Login + Role Management (Priority)
- Login now uses **email + password** (see `index.html` + `shared/js/auth.js`).
- Added roles: `technician` and `messenger` (redirect to Field App).
- Passwords for `marga_users` are stored as **PBKDF2 hash** (`password_hash`, `password_salt`, `password_iterations`).
- Admin UI:
  - `settings/index.html` provides user CRUD (create/edit/activate/deactivate) and password reset.
  - Users cannot change passwords yet (admin-managed temporary passwords).
- Note: avoid shared passwords if possible; per-user accounts are required for reliable attendance/audit trails later.

#### 1. Service Dispatch Board (Unified Daily Operations)
- Page: `service/index.html`
- Reads unified schedules (service/billing/collection/delivery/reading) from Firestore.
- Uses **date-range Firestore queries** for accurate date switching (instead of scanning latest N and filtering).
- Supports **carryover**: includes pending tasks from prior days into the selected date view.
- Status model:
  - `Closed` when `tbl_schedule.date_finished != "0000-00-00 00:00:00"`
  - `Cancelled` when `tbl_schedule.iscancel == 1`
  - `Ongoing (Parts)` when `tbl_schedule.isongoing == 1`
  - `Carryover` when task date < selected date and not closed/cancelled
  - Otherwise `Pending`
- KPI cards are clickable to filter by status.
- Admin/service action:
  - Batch Carryover moves pending/ongoing schedules to next day.

#### 2. Mobile-Friendly Dispatch Layout
- Staff and Task Queue tables convert to card layout on mobile screens.
- Sticky action columns on mid-sized screens to keep key buttons visible.

#### 3. CSR Manual “New Service Request”
- Modal form in `service/index.html` driven by `service/js/dispatch-board.js`.
- Captures request origin (Viber/Call/Website Chat/Tech Request/etc).
- Company/Branch search inputs filter dropdown options.
- Branch selection attempts to prefill caller/contact + phone:
  - Prefers `tbl_branchcontact` (if synced)
  - Falls back to `tbl_branchinfo.signatory`

#### 4. SQL-to-Firebase Sync Updater (Baseline + Incremental)
- Page: `sync/index.html`
- Goal: load a MySQL dump and add only new records into Firestore.
- Supports initializing watermarks from a baseline dump.

- Modal app: `field/index.html`
- Goal: tech/messenger only sees their own schedule + can close tasks + correct machine serials.
- Access: roles `technician` and `messenger` (requires `marga_users.staff_id` mapping).

---

## 🔧 Next Priorities (Short List)
1. Sync missing supporting tables into Firestore as needed for UX:
   - `tbl_branchcontact` (for caller/phone prefills)
   - confirm `tbl_printedscheds`, `tbl_savedscheds` usage as “daily sheet” sources (if required)
2. Improve “New Service Request” save safety:
   - Replace `max(id)+1` with a collision-safe ID allocation strategy
3. Role-based visibility:
   - department home views (billing/collection/service) with restricted metrics
4. Pending monitoring expansion:
   - change unit / machine delivery / parts pending metrics and drill-down filters
| page_rate2 | float | Color rate per page |
| monthly_quota2 | int | Color minimum |
| monthly_rate2 | float | Color monthly fee |
| withvat | int | 1=VAT inclusive |

### tbl_machine (3,602 records)
| Field | Type | Description |
|-------|------|-------------|
| id | int | Primary key |
| model_id | int | FK to tbl_model |
| brand_id | int | FK to tbl_brand |
| serial | string | Serial number |
| description | string | Model name (fallback) |
| status_id | int | Warehouse status |

### tbl_particulars (17 records) - Contract Categories
| ID | Code | Name | with_reading |
|----|------|------|--------------|
| 1 | **RTP** | Rental (Per Page) | 1 |
| 2 | **RTF** | Fixed Rate | 0 |
| 3 | STP | Short Term | 1 |
| 4 | MAT | Material Purchase | 0 |
| 5 | RTC | Cartridge | 0 |
| 6 | STC | Short Term Cartridge | 0 |
| 7 | MAC | Maintenance Cartridge | 0 |
| 8 | **MAP** | Maintenance Per Page | 1 |
| 9 | REF | Refill Cartridge | 0 |
| 10 | RD | Refundable Deposit | 0 |
| 11 | PI | Production Installation | 0 |
| 12 | OTH | Others | 0 |

### Contract Status Codes
| Status | Meaning | Count |
|--------|---------|-------|
| 0 | Pending | 1 |
| 1 | **Active** | 1,602 |
| 2 | Terminated | 6 |
| 3 | On Hold | 8 |
| 4 | Pulled Out | 23 |
| 7 | **Ended** | 2,905 |
| 8 | Replaced | 2 |
| 9 | Transferred | 10 |
| 10 | For Pullout | 39 |
| 13 | Cancelled | 4 |

### Machine Status (status_id) - ✅ VERIFIED
| Status | Name | Description |
|--------|------|-------------|
| 0 | Not Set | No status assigned |
| 1 | On Stock | Available in warehouse |
| 2 | For Delivery | Scheduled for delivery |
| 3 | Delivered | Deployed to customer |
| 4 | Used W/in Company | Internal use |
| 5 | For Junk | Pending disposal |
| 6 | Junk | Disposed |
| 7 | For Overhauling | Needs major repair |
| 8 | Under Repair | Currently being fixed |
| 9 | For Parts | Cannibalized for parts |
| 10 | For Sale | Listed for sale |
| 11 | Trade In | Traded in |
| 12 | Outside Repair | External repair |
| 13 | Missing | Cannot be located |
| 14 | Old | Legacy/outdated |
| 15 | Under QC | Quality control check |
| 16 | Duplicate | Duplicate entry |
| 17 | N/A | Not applicable |
| 18 | Delivered (No Contract) | Delivered but no contract yet |

**⚠️ TODO:** Verify machine status meanings with Mike

---

## 🔥 Firebase Configuration
**Project:** sah-spiritual-journal

```javascript
const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M',
    projectId: 'sah-spiritual-journal',
    baseUrl: 'https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents'
};
```

---

## 🔐 Login Credentials
| Username | Password | Role |
|----------|----------|------|
| admin | marga2025 | Admin |

---

## 🚧 Pending Tasks

### Immediate Priority
1. ✅ ~~**Machine Serial Validation** - Prevent duplicates~~ DONE
2. ✅ ~~**Machine Edit Audit Log** - Track changes~~ DONE
3. ✅ ~~**Verify Machine Status IDs** - Get meaning from legacy system~~ DONE
4. **Run Status Migration** - Open `migrate-status.html` and click "Run Migration"

### Module Development (Priority Order)
1. **Billing Module** - Invoice generation, meter readings
2. **Collections Module** - Payment tracking
3. **Machine Inventory Module** - Warehouse tracking
4. Service Module
5. Reports Module

### Data Integrity Enhancements
- [x] Serial number uniqueness validation ✅
- [x] Machine edit history/audit log ✅
- [ ] Lock machine fields after deployment
- [ ] Admin override for locked fields

---

## 📞 Quick Commands

### Start Fresh Session
```
Read the HANDOFF.md file at /Volumes/Wotg Drive Mike/GitHub/Marga-App/HANDOFF.md
```

### Push to GitHub
```bash
cd "/Volumes/Wotg Drive Mike/GitHub/Marga-App"
git add .
git commit -m "Your commit message"
git push origin main
```

### Test Firebase
```javascript
fetch('https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents/tbl_companylist?pageSize=1&key=AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M')
.then(r => r.json()).then(console.log)
```

---

## 📁 Project Structure
```
/Marga-App/
├── index.html              ← Login page
├── dashboard.html          ← Main dashboard
├── customers.html          ← Customer listing
├── migrate-status.html     ← Migration tool for status tables (NEW)
├── HANDOFF.md              ← This file
│
├── shared/
│   ├── css/styles.css      ← Global styles
│   ├── css/dashboard.css   ← Layout styles
│   └── js/
│       ├── firebase-config.js
│       ├── auth.js
│       └── utils.js
│
├── customers/
│   ├── css/
│   │   ├── customers.css
│   │   └── customer-form.css  ← Added serial validation styles (UPDATED)
│   └── js/
│       ├── customers.js      ← List, search, pagination
│       └── customer-form.js  ← Edit form + serial validation + audit log (UPDATED)
│
├── billing/                ← 🔲 TODO
├── collections/            ← 🔲 TODO
└── assets/
```

---

## 🗄️ New Firebase Collections

### tbl_machine_history (Audit Log)
| Field | Type | Description |
|-------|------|-------------|
| id | int | Primary key |
| machine_id | int | FK to tbl_machine |
| changed_by | string | Username who made change |
| changed_at | timestamp | When change was made |
| changes | object | Summary of what changed |
| old_values | object | Previous values |
| new_values | object | New values |

### tbl_newmachinestatus (Reference Table - Run migration first!)
| Field | Type | Description |
|-------|------|-------------|
| id | int | Primary key |
| status | string | Status name |

### tbl_contractstatus (Reference Table - Run migration first!)
| Field | Type | Description |
|-------|------|-------------|
| id | int | Primary key |
| con_status | string | Contract status name |

---

## 📎 Related Files Outside Project
- **SQL Dump:** `/Users/mike/Downloads/Dump20251229 (2).sql`
- **Migration Script:** `/Users/mike/Downloads/marga_migrate_FIXED.py`

---

**Last Updated:** December 31, 2025, 12:30 AM
**Author:** Claude (AI Assistant)
