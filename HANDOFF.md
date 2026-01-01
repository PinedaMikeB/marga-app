# MARGA App - Handoff Document
**Date:** January 1, 2026  
**Project:** Marga Enterprises - Printer Rental Management System  
**Repository:** /Volumes/Wotg Drive Mike/GitHub/Marga-App  
**Live URL:** https://margaapp.netlify.app

---

## 🎯 Project Overview

Modernizing Marga Enterprises' legacy VB.NET/MySQL system to a web-based Firebase application. The system manages printer rentals, billing, collections, and service for customers across the Philippines.

---

## ✅ What Has Been Accomplished

### 1. Complete MySQL to Firebase Migration (2.5 Million Records)

| Batch | Records | Status |
|-------|---------|--------|
| Original | ~16,000 | ✅ Done |
| Batch 1 (billing, readings) | ~195,000 | ✅ Done |
| Batch 2 (32 tables) | ~614,000 | ✅ Done |
| Batch 3 (66 tables) | ~1,711,000 | ✅ Done |
| **TOTAL** | **~2,536,000** | ✅ Complete |

**Key Tables Migrated:**
- `tbl_contractmain` - Contracts
- `tbl_companylist` - Companies
- `tbl_branchinfo` - Branches
- `tbl_machine` - Machines
- `tbl_machinereading` - Historical meter readings (120k+)
- `tbl_billing` - Billing records (74k+)
- `tbl_collections` - Collections
- `tbl_invoicenum` - Invoices
- `tbl_schedule` - Service schedules
- Plus 80+ more tables

### 2. Daily Sync System Created

For syncing ongoing data from VB.NET (MySQL) to Firebase until full transition.

**Files:**
- `/sync/daily-export.sql` - SQL queries for MySQL Workbench
- `/sync/daily-export.ps1` - PowerShell automation
- `/synclatest.html` - Upload JSON files to sync

**Workflow:**
1. AnyDesk into office PC
2. Run SQL in MySQL Workbench
3. Export to Google Drive
4. Upload via synclatest.html

### 3. Authentication System

**Files:**
- `/shared/js/auth.js` - Authentication module
- `/login.html` - Login page
- `/setup-admin.html` - Initial admin setup

**Roles:** Admin, Manager, Billing Staff, Collection Staff, Service Tech, Viewer

### 4. Customer Management Module

**Files:**
- `/customers.html` - Customer list with search/filter
- `/customer-detail.html` - Customer details with contracts

**Features:**
- View all companies/branches
- View contracts per customer
- Machine details
- Contract status

### 5. Billing Module (Partial)

**Current Files:**
- `/billing.html` - Original billing interface (working but basic)
- `/billing-v2.html` - New 3-panel layout (IN PROGRESS)

**Working Features:**
- R.DAY extraction from `reading_date` field
- Previous meter reading from `tbl_machinereading`
- Basic meter reading entry
- Filter by Today/All/Unbilled

---

## 🚧 What Needs To Be Done

### IMMEDIATE: Complete Billing Dashboard v2

The new billing dashboard (`billing-v2.html`) was started but needs completion. Currently showing old billing.html instead.

**Required 3-Panel Layout:**

```
┌─────────────────┬─────────────────┬──────────────────┐
│  📖 FOR READING │  📄 FOR INVOICE │ 📬 PENDING       │
│                 │                 │    DELIVERY      │
│  - Today filter │  - Readings     │                  │
│  - Overdue      │    without      │  - Generated     │
│  - All          │    invoice yet  │    invoices      │
│  - Search       │                 │    waiting for   │
│                 │  [Generate]     │    messenger     │
│  [Enter Reading]│  [Generate All] │                  │
│                 │                 │  [Assign         │
│  Per-Page: meter│                 │   Messenger]     │
│  Fixed: no meter│                 │                  │
└─────────────────┴─────────────────┴──────────────────┘
```

**Contract Types:**
- **RTP** (Rental Type Per-page) - Needs meter reading
- **RTF** (Rental Type Fixed) - Fixed monthly rate, no reading
- **REF** (Refurbished/Refill?) - Fixed rate, no reading

**Key Logic:**
- R.DAY = Day extracted from `reading_date` field (NOT from `rd` which is Refundable Deposit)
- Previous reading comes from `tbl_machinereading` (migrated MySQL data)
- New readings go to `tbl_readings` (our new collection)
- Invoices go to `tbl_invoices` (our new collection)

### NEXT: Complete Billing-to-Collection Workflow

**Full Workflow:**

```
1. BILLING STAFF - Generate Invoices
   ├── Per-Page: Enter meter reading → Calculate
   └── Fixed Rate: Just generate (no reading)
              ↓
2. BILLING STAFF - Invoices go to "Pending Delivery"
              ↓
3. MESSENGER (Mobile App) - Delivers invoice
   ├── Takes photo of signed invoice
   ├── Records: Received by, Date/Time
   └── Submits via app
              ↓
4. BILLING STAFF - Verifies delivery
   ├── Checks physical invoice matches app
   ├── Confirms with checkbox
   └── Grouped by messenger
              ↓
5. COLLECTION STAFF - Follows up payment
   └── Only sees VERIFIED invoices
```

**Status Flow:**
| Status | Location |
|--------|----------|
| `generated` | Billing Dashboard |
| `for_delivery` | Messenger Queue |
| `delivered_pending` | Verification Queue |
| `verified` | Collection Dashboard |
| `paid` | Archive |

### Interfaces To Build

1. **Billing Dashboard v2** - Complete the 3-panel layout
2. **Verification Dashboard** - Billing staff confirms messenger deliveries
3. **Messenger Mobile App (PWA)** - Photo capture, delivery confirmation
4. **Collection Dashboard** - Track verified invoices, payments

---

## 📁 Key File Locations

```
/Volumes/Wotg Drive Mike/GitHub/Marga-App/
├── billing.html              # Current billing (working)
├── billing-v2.html           # New 3-panel layout (IN PROGRESS)
├── billing/
│   ├── js/billing.js         # Billing logic
│   └── css/billing.css       # Billing styles
├── customers.html            # Customer management
├── customer-detail.html      # Customer details
├── login.html                # Login page
├── shared/
│   ├── js/
│   │   ├── firebase-config.js    # Firebase configuration
│   │   └── auth.js               # Authentication
│   └── css/
│       └── main.css              # Shared styles
├── sync/                     # Daily sync tools
├── migrations/               # JSON migration files
└── various test/check tools
```

---

## 🔧 Technical Details

### Firebase Collections (New System)

| Collection | Purpose |
|------------|---------|
| `tbl_readings` | New meter readings (from our app) |
| `tbl_invoices` | Generated invoices |
| `_sync_meta` | Sync metadata |

### Firebase Collections (Migrated from MySQL)

All original MySQL tables with `tbl_` prefix are now in Firebase.

### Key Fields

**Contract (`tbl_contractmain`):**
- `reading_date` → Extract day for R.DAY
- `monthly_rate` → Fixed monthly amount
- `monthly_quota` → Free pages included
- `page_rate` → Cost per excess page
- `category_id` → Links to category (RTP/RTF/REF)
- `rd` → Refundable Deposit (NOT reading day!)

**Machine Reading (`tbl_machinereading`):**
- `machine_id` → Links to machine
- `current_contract` → Links to contract
- `meter_reading` → The actual meter value
- `date_red` → Date of reading
- `invoice_id` → 0 = no invoice, >0 = has invoice

---

## 🎯 Immediate Next Steps

1. **Fix billing-v2.html** - The 3-panel dashboard is not loading correctly
2. **Complete the reading entry flow** - Both per-page and fixed rate
3. **Add invoice generation** - Create invoices from readings
4. **Build messenger assignment** - Assign invoices to messengers

---

## 🔗 Useful URLs

- **Live App:** https://margaapp.netlify.app
- **Billing (current):** https://margaapp.netlify.app/billing.html
- **Billing v2:** https://margaapp.netlify.app/billing-v2.html
- **Customers:** https://margaapp.netlify.app/customers.html
- **Login:** https://margaapp.netlify.app/login.html
- **Firebase Console:** Check Mike's Firebase account

---

## 📝 Notes for Next Session

1. User is viewing `/billing` not `/billing-v2.html` - need to check routing
2. The billing-v2.html was created but may have issues loading
3. Categories need verification: RTP = per-page, RTF/REF = fixed rate
4. Check https://margaapp.netlify.app/check-categories.html for category data
5. Previous reading logic is working (fetches from `tbl_machinereading`)

---

**To Continue:** Read this file and proceed with completing the Billing Dashboard v2 with the 3-panel workflow layout.
