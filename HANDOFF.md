# MARGA App Development Handoff

## 📅 Last Updated: December 31, 2025, 12:30 AM

## 🎯 Project Overview
Building a modern web-based enterprise management system for **Marga Enterprises** to replace the legacy VB.NET desktop application. The app manages customers, billing, collections, service, and machine contracts for a printer rental business.

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

### Session: December 30-31, 2025

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

#### 5. Editable Machine Details ⚠️ TEMPORARY
- Brand, Model, Serial Number now editable
- Yellow highlighted fields indicate editable machine data
- **Purpose:** Allow technicians to correct serial numbers
- **⚠️ DATA INTEGRITY RISKS - SEE BELOW**

---

## ⚠️ CRITICAL: Machine Data Integrity Risks

### Current Implementation (TEMPORARY)
The machine fields (Brand, Model, Serial) are currently **directly editable** which poses risks:

### Risk 1: Overwriting History
```
OLD: Serial = ABC123 → Changed to → NEW: Serial = XYZ789
```
- The old serial "ABC123" is **permanently overwritten**
- No audit trail of what the serial was before
- Billing history still references this machine ID but serial changed

### Risk 2: Duplicate Serial Numbers
- User could enter a serial that already exists for another machine
- No validation currently prevents duplicate serials
- Could cause confusion: "Which machine with serial XYZ is deployed where?"

### Risk 3: Orphan References
- If machine serial is changed, old invoices/readings still reference the machine
- Reports may show mismatched data

### Recommended Fixes (TODO)
1. **Add Serial Validation:**
   ```javascript
   // Before saving, check if serial already exists
   const existing = await db.collection('tbl_machine')
       .where('serial', '==', newSerial)
       .where('id', '!=', currentMachineId)
       .get();
   if (!existing.empty) {
       alert('This serial already exists!');
       return;
   }
   ```

2. **Add Audit Log:**
   ```javascript
   // Log changes to a history collection
   db.collection('tbl_machine_history').add({
       machine_id: machineId,
       changed_by: currentUser,
       changed_at: timestamp,
       old_values: { serial: 'ABC123', brand: 'Brother' },
       new_values: { serial: 'XYZ789', brand: 'Brother' }
   });
   ```

3. **Lock After Deployment (Future):**
   - Once machine is deployed, serial should be read-only
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

### Machine Status (status_id) - TO BE VERIFIED
| Status | Count | Likely Meaning |
|--------|-------|----------------|
| 0 | 269 | Not Set |
| 2 | 381 | In Warehouse? |
| 3 | 1,730 | Deployed? |
| 7 | 348 | Pulled Out? |
| 18 | 90 | ? |

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
1. **Machine Serial Validation** - Prevent duplicates
2. **Machine Edit Audit Log** - Track changes
3. **Verify Machine Status IDs** - Get meaning from legacy system

### Module Development (Priority Order)
1. **Billing Module** - Invoice generation, meter readings
2. **Collections Module** - Payment tracking
3. **Machine Inventory Module** - Warehouse tracking
4. Service Module
5. Reports Module

### Data Integrity Enhancements
- [ ] Serial number uniqueness validation
- [ ] Machine edit history/audit log
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
│   │   └── customer-form.css
│   └── js/
│       ├── customers.js      ← List, search, pagination
│       └── customer-form.js  ← Edit form, machine/contract editing
│
├── billing/                ← 🔲 TODO
├── collections/            ← 🔲 TODO
└── assets/
```

---

## 📎 Related Files Outside Project
- **SQL Dump:** `/Users/mike/Downloads/Dump20251229 (2).sql`
- **Migration Script:** `/Users/mike/Downloads/marga_migrate_FIXED.py`

---

**Last Updated:** December 31, 2025, 12:30 AM
**Author:** Claude (AI Assistant)
