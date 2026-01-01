# MARGA App - Handoff Document
**Date:** January 1, 2026  
**Last Updated:** January 1, 2026 - 5:20 PM PHT  
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

### 2. Daily Sync System Created

For syncing ongoing data from VB.NET (MySQL) to Firebase until full transition.

**Files:**
- `/sync/daily-export.sql` - SQL queries for MySQL Workbench
- `/sync/daily-export.ps1` - PowerShell automation
- `/synclatest.html` - Upload JSON files to sync

### 3. Authentication System ✅

**Files:** `/shared/js/auth.js`, `/login.html`, `/setup-admin.html`
**Roles:** Admin, Manager, Billing Staff, Collection Staff, Service Tech, Viewer

### 4. Customer Management Module ✅

**Files:** `/customers.html`, `/customer-detail.html`
**Features:** View companies/branches, contracts, machine details, status

### 5. Billing Module - 3-Panel Dashboard ✅ (NEW!)

**File:** `/billing.html` (completely rebuilt)

**NEW 3-Panel Workflow Layout:**
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

**Implemented Features:**
- ✅ Panel 1: For Reading - Filter by Today/Overdue/All, search by client
- ✅ Panel 2: For Invoice - Readings that need invoice generation
- ✅ Panel 3: Pending Delivery - Invoices waiting for messenger assignment
- ✅ Stats bar with quick navigation to each panel
- ✅ Fixed rate contracts (RTF/REF) highlighted with purple border
- ✅ Previous reading fetched from `tbl_machinereading` (migrated MySQL) or `tbl_readings` (new)
- ✅ Invoice modal with contract details, billing calculations
- ✅ Spoilage (2%) calculation, VAT handling
- ✅ Print preview with position adjustment
- ✅ Save readings to `tbl_readings` collection

**Contract Types Handled:**
- **RTP** (Rental Type Per-page) - Needs meter reading
- **RTF** (Rental Type Fixed) - Fixed monthly rate, no reading needed
- **REF** (Refurbished/Refill) - Fixed rate, no reading needed

**Key Logic:**
- R.DAY = Day extracted from `reading_date` field (NOT from `rd` which is Refundable Deposit)
- Previous reading priority: `tbl_readings` → `tbl_machinereading` → `starting_meter`

---

## 🚧 What Still Needs To Be Done

### NEXT: Complete Billing-to-Collection Workflow

**Full Workflow:**

```
1. BILLING STAFF - Generate Invoices ✅ DONE
   ├── Per-Page: Enter meter reading → Calculate
   └── Fixed Rate: Just generate (no reading)
              ↓
2. BILLING STAFF - Invoices go to "Pending Delivery" ✅ DONE
              ↓
3. MESSENGER (Mobile App) - Delivers invoice 🔲 TODO
   ├── Takes photo of signed invoice
   ├── Records: Received by, Date/Time
   └── Submits via app
              ↓
4. BILLING STAFF - Verifies delivery 🔲 TODO
   ├── Checks physical invoice matches app
   ├── Confirms with checkbox
   └── Grouped by messenger
              ↓
5. COLLECTION STAFF - Follows up payment 🔲 TODO
   └── Only sees VERIFIED invoices
```

**Status Flow:**
| Status | Location |
|--------|----------|
| `generated` | Billing Dashboard ✅ |
| `pending_delivery` | Messenger Queue ✅ |
| `delivered_pending` | Verification Queue 🔲 |
| `verified` | Collection Dashboard 🔲 |
| `paid` | Archive 🔲 |

### Interfaces Still To Build

1. ✅ **Billing Dashboard v2** - COMPLETED (3-panel layout)
2. 🔲 **Verification Dashboard** - Billing staff confirms messenger deliveries
3. 🔲 **Messenger Mobile App (PWA)** - Photo capture, delivery confirmation
4. 🔲 **Collection Dashboard** - Track verified invoices, payments

---

## 📁 Key File Locations

```
/Volumes/Wotg Drive Mike/GitHub/Marga-App/
├── billing.html              # NEW 3-panel billing dashboard ✅
├── billing-old-backup.html   # Old table-based billing (backup)
├── billing-v2.html           # Original prototype (can be removed)
├── billing/
│   ├── js/billing.js         # Old billing logic (not used)
│   └── css/billing.css       # Billing styles (still used for modals)
├── customers.html            # Customer management
├── customer-detail.html      # Customer details
├── login.html                # Login page
├── shared/
│   ├── js/
│   │   ├── firebase-config.js    # Firebase configuration
│   │   └── auth.js               # Authentication
│   └── css/
│       └── styles.css            # Shared styles
│       └── dashboard.css         # Dashboard layout styles
├── sync/                     # Daily sync tools
└── migrations/               # JSON migration files
```

---

## 🔧 Technical Details

### Firebase Collections

**New Collections (Our System):**
| Collection | Purpose |
|------------|---------|
| `tbl_readings` | New meter readings & billing records |
| `tbl_invoices` | Generated invoices |
| `_sync_meta` | Sync metadata |

**Migrated Collections (from MySQL):**
| Collection | Purpose |
|------------|---------|
| `tbl_contractmain` | Contracts |
| `tbl_companylist` | Companies |
| `tbl_branchinfo` | Branches |
| `tbl_machine` | Machines |
| `tbl_machinereading` | Historical meter readings (120k+) |
| `tbl_billing` | Old billing records (74k+) |
| `tbl_particulars` | Categories (RTP, RTF, REF, etc.) |
| Plus 80+ more tables |

### Key Fields Reference

**Contract (`tbl_contractmain`):**
- `reading_date` → Extract day for R.DAY
- `monthly_rate` → Fixed monthly amount
- `monthly_quota` → Free pages included
- `page_rate` → Cost per excess page
- `category_id` → Links to category (RTP/RTF/REF)
- `rd` → Refundable Deposit (NOT reading day!)
- `mach_id` → Links to machine
- `contract_id` → Links to branch

**Reading (`tbl_readings`):**
- `contract_id` → Links to contract
- `present_reading` / `previous_reading` → Meter values
- `net_consumption` → Pages printed
- `amount_due` → Total to pay
- `invoice_generated` → false until formal invoice created
- `status` → pending/delivered/verified/paid

---

## 🎯 Immediate Next Steps

1. **Test the new billing dashboard** - Visit https://margaapp.netlify.app/billing
2. **Verify data loads correctly** - Check contracts, readings, invoices
3. **Test the reading entry flow** - Select contract → Enter invoice # → Enter reading → Save
4. **Test invoice generation** - Select reading in Panel 2 → Generate Invoice
5. **Plan Verification Dashboard** - For confirming messenger deliveries

---

## 🔗 Useful URLs

- **Live App:** https://margaapp.netlify.app
- **Billing Dashboard:** https://margaapp.netlify.app/billing.html
- **Customers:** https://margaapp.netlify.app/customers.html
- **Login:** https://margaapp.netlify.app/login.html
- **Check Categories:** https://margaapp.netlify.app/check-categories.html

---

## 📝 Notes

1. Old billing.html backed up to `billing-old-backup.html`
2. billing-v2.html was the prototype - can be deleted once confirmed working
3. The billing.js in `/billing/js/` is no longer used (logic is inline in billing.html)
4. Fixed rate categories: RTF, RTC, MAT, STC, MAC, REF, RD, PI, OTH
5. Per-page category: RTP

---

**Last Commit:** cfdf763 - "Implement 3-panel Billing Dashboard workflow"
