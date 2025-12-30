# MARGA App Development Handoff

## 📅 Date: December 30, 2025

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

### 1. Firebase Migration
- **Source:** MySQL dump from VB.NET app (`Dump20251229 (2).sql`)
- **Destination:** Firebase Firestore (`sah-spiritual-journal` project)
- **Migration Script:** `/Users/mike/Downloads/marga_migrate_FIXED.py`

### Migrated Collections:
| Collection | Records |
|------------|---------|
| tbl_companylist | 1,143 |
| tbl_branchinfo | 3,336 |
| tbl_billinfo | 3,555 |
| tbl_contractmain | 4,600 |
| tbl_machine | 3,602 |
| tbl_model | 126 |
| tbl_brand | 153 |
| tbl_area | 28 |
| tbl_city | 173 |
| **TOTAL** | **16,716** |

### 2. App Structure Built
```
/Marga-App/
├── index.html              ← Login page (entry point)
├── dashboard.html          ← Main dashboard with sidebar navigation
├── README.md               ← Project documentation
├── HANDOFF.md              ← This file
│
├── shared/                 ← Shared resources across all modules
│   ├── css/
│   │   ├── styles.css      ← Global styles (CSS variables, buttons, forms)
│   │   └── dashboard.css   ← Dashboard & sidebar layout
│   └── js/
│       ├── firebase-config.js  ← Firebase connection (sah-spiritual-journal)
│       ├── auth.js             ← Authentication & role-based access control
│       └── utils.js            ← Utility functions (formatCurrency, fetchCollection, etc.)
│
├── customers/              ← ✅ COMPLETE - Customer Management Module
│   ├── index.html          ← Customer listing page
│   ├── css/customers.css   ← Module-specific styles
│   └── js/customers.js     ← Customer logic (search, pagination, detail panel)
│
├── billing/                ← 🔲 PLACEHOLDER - Ready for development
│   └── js/
│
├── collections/            ← 🔲 PLACEHOLDER - Ready for development  
│   └── js/
│
└── assets/                 ← For images, icons (currently empty)
```

### 3. Features Implemented
- ✅ Modern login page with authentication
- ✅ Role-based access control (Admin, Billing, Collection, Service, Viewer)
- ✅ Dashboard with sidebar navigation
- ✅ Customer module with:
  - Company listing with pagination (25 per page)
  - Search functionality (with Active/Inactive filter)
  - Slide-in detail panel with 3 tabs:
    - Information (company details, branches)
    - Billing (payee info, end user)
    - Machines (contracts, rates, quotas)
  - Export to CSV
  - Edit Customer form with:
    - Multi-branch tabs (add/remove branches)
    - Company Information section
    - Branch / Department section
    - **Machine & Contract section** (shows linked machines, serial numbers, contract rates)
    - Delivery Information section
    - Service Information section
    - Billing Information section
    - Collection Information section

---

## 🔐 Login Credentials
| Username | Password | Notes |
|----------|----------|-------|
| admin | marga2025 | Default admin - CHANGE IN PRODUCTION |

User accounts can be added to Firebase collection `marga_users` with fields:
- username, password, name, role, email, active

---

## 🔥 Firebase Configuration
**Project:** sah-spiritual-journal (Mike's old project with Firestore enabled)

```javascript
// In shared/js/firebase-config.js
const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M',
    projectId: 'sah-spiritual-journal',
    baseUrl: 'https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents'
};
```

**Security Rules (currently open for development):**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
⚠️ **TODO:** Tighten security rules before production!

---

## 🚧 Pending Tasks

### Immediate (Next Session)
1. **Deploy to Hostinger**
   - Push code to GitHub
   - Connect GitHub to Hostinger OR upload via File Manager
   - Hostinger subdomain `app.marga.biz` is created but needs files
   - Note: May need to find/create public_html folder or point domain to repo

2. **Test the app**
   - Login functionality
   - Customer module data loading
   - Navigation between pages

### Module Development (Priority Order)
1. **Billing Module** - Invoice generation, billing schedules
2. **Collections Module** - Payment tracking, messenger assignments
3. Service Module
4. Reports Module
5. User Management (admin panel)

### Enhancements
- [ ] Add/Edit customer functionality
- [ ] Print customer details
- [ ] Advanced search filters
- [ ] Real-time data sync
- [ ] Mobile responsiveness testing

---

## 🎨 Design System

### Colors (Blue Theme)
```css
--primary-900: #0c1929;
--primary-500: #2563eb;
--primary-100: #dbeafe;
--accent: #00d4ff;
--success: #10b981;
--warning: #f59e0b;
--danger: #ef4444;
```

### Fonts
- **Headings:** Space Grotesk
- **Body:** Plus Jakarta Sans

---

## 📊 Database Schema Reference

### Key Tables & Relationships
```
tbl_companylist (Companies)
    └── tbl_branchinfo (Branches) via company_id
        ├── tbl_billinfo (Billing) via branch_id
        └── tbl_contractmain (Contracts) via contract_id
            └── tbl_machine (Machines) via mach_id
                └── tbl_model (Models) via model_id
                    └── tbl_brand (Brands) via brand_id
```

### Important Fields

**tbl_companylist:** id, companyname, company_tin, business_style

**tbl_branchinfo:** id, company_id, branchname, street, bldg, brgy, city, area_id, signatory, designation, email

**tbl_contractmain:** id, contract_id (branch), mach_id, status, page_rate, monthly_quota, monthly_rate, page_rate2, monthly_quota2, monthly_rate2, contract_duration, terms, withvat

**tbl_machine:** id, model_id, serial, brand_id, status_id

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

**Note:** Only `status = 1` (Active) counts as "Active Machines" in the dashboard.

### Contract Category Codes (tbl_particulars)
| ID | Code | Name | Needs Reading |
|----|------|------|---------------|
| 1 | **RTP** | Rental (Per Page) | ✓ Yes |
| 2 | **RTF** | Fixed Rate | No |
| 3 | STP | Short Term | ✓ Yes |
| 4 | MAT | Material Purchase | No |
| 5 | RTC | Cartridge | No |
| 6 | STC | Short Term Cartridge | No |
| 7 | MAC | Maintenance Cartridge | No |
| 8 | **MAP** | Maintenance Per Page | ✓ Yes |
| 9 | REF | Refill Cartridge | No |
| 10 | RD | Refundable Deposit | No |
| 11 | PI | Production Installation | No |
| 12 | OTH | Others | No |

**Billing Logic:**
- **RTP/MAP/STP (with_reading=1):** Bill by meter reading (present - previous) × page_rate
- **RTF (with_reading=0):** Fixed monthly rate, no reading needed

---

## 💡 Tips for Next Session

1. **Context Limit:** Work on ONE module at a time to avoid hitting limits
2. **File Reading:** Start by reading the relevant files before making changes
3. **Testing:** Test locally by opening index.html in browser before deploying
4. **Hostinger:** The subdomain might point to main domain's public_html - may need to create subfolder or use .htaccess

---

## 📞 Quick Commands

### Push to GitHub
```bash
cd "/Volumes/Wotg Drive Mike/GitHub/Marga-App"
git add .
git commit -m "Initial commit - Customer module complete"
git push origin main
```

### Test Firebase Connection
```javascript
// In browser console
fetch('https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents/tbl_companylist?pageSize=1&key=AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M')
.then(r => r.json()).then(console.log)
```

---

## 📎 Related Files Outside Project

- **SQL Dump:** `/Users/mike/Downloads/Dump20251229 (2).sql`
- **Migration Script:** `/Users/mike/Downloads/marga_migrate_FIXED.py`
- **Migration Summary:** `/Users/mike/Downloads/migration_summary.json`

---

**Last Updated:** December 30, 2025, 1:10 AM
**Author:** Claude (AI Assistant)
