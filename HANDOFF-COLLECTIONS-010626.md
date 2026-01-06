# MARGA Collections Module - Handoff Document
## Date: January 6, 2026

---

## ✅ COMPLETED: Unknown Companies Fix

### Problem Solved
- **Issue**: ~45% of invoices showed "Unknown" company name
- **Root Cause**: The `contract_id` field in `tbl_contractmain` does NOT reference `tbl_branchinfo.id`
- **Discovery**: Only 69.7% of `contract_id` values matched actual branch IDs

### Solution Implemented
Found the correct data path through **machine history**:
```
Invoice → Contract (mach_id) → tbl_newmachinehistory → branch_id → tbl_branchinfo → company
```

**Key Code Change** in `/collections/js/collections.js`:
1. Added `buildMachineToBranchMap()` - Loads `tbl_newmachinehistory` and finds latest delivery location for each machine
2. Modified `processInvoice()` - Uses `mach_id` → machine history → branch instead of `contract_id`
3. Fallback: If machine not in history, tries old `contract_id` method

### Results
| Metric | Value |
|--------|-------|
| Total unpaid invoices | 2,576 |
| Unknown with old method | 1,053 (41%) |
| **Fixed by new method** | **1,028** |
| Still unknown | 25 |
| **Fix rate** | **97.6%** |

---

## 🔧 NEXT TASKS (Priority Order)

### 1. Invoice Detail Page Not Working
**File**: `/collections/invoice-detail.html` (may not exist or broken)
**Issue**: Clicking an invoice row navigates to `invoice-detail.html?invoice=XXXXX` but shows nothing
**Fix needed**: 
- Create or fix the invoice detail page
- Should show: Company info, invoice details, collection history, and add follow-up form
- Reference: The current click handler is in `viewInvoiceDetail()` function

### 2. Page Height / Layout Issue
**File**: `/collections.html` and related CSS
**Issue**: Can't see buttons at the bottom of the page
**Fix needed**:
- Adjust container heights
- Ensure proper scrolling
- Make sure action buttons are visible

### 3. State Persistence (Avoid Full Reload)
**Issue**: After viewing invoice detail and returning, page reloads all 30,000+ invoices
**Fix needed**:
- Cache loaded data in localStorage or sessionStorage
- On return from detail page, restore state instead of reloading
- Use URL hash or query params to preserve filter state
- Consider: Store `allInvoices`, `filteredInvoices`, `currentPage`, filters in session

**Suggested approach**:
```javascript
// Before navigating away
sessionStorage.setItem('collections_state', JSON.stringify({
    allInvoices,
    filteredInvoices,
    currentPage,
    currentPriorityFilter,
    dataMode,
    filters: { year, month, age, category, search }
}));

// On page load
const savedState = sessionStorage.getItem('collections_state');
if (savedState) {
    // Restore state instead of loading from Firebase
}
```

---

## 📁 Key Files

### Modified Files
- `/collections/js/collections.js` - Main collections logic (745 lines)
  - Added machine history mapping
  - Fixed company lookup
  
- `/collections.html` - Collections page UI (346 lines)
  - Priority cards, filters, table container
  - Welcome modal with clickable priorities

### Debug Tools Created (can be deleted after testing)
- `/debug-machine-mapping.html` - Tests machine→branch mapping
- `/debug-verify-branch.html` - Verifies branch 2098
- `/debug-compare.html` - Compares Head Office vs Branch invoices
- `/debug-departments.html` - Searches for department tables
- `/debug-chinabank.html` - Traces China Bank invoice
- `/debug-branch-gap.html` - Analyzes branch ID gaps
- `/debug-final.html` - Final analysis tool
- `/debug-recent.html` - Finds recent Unknown invoices
- `/debug-unknown.html` - Traces Unknown invoices
- `/debug-history.html` - Checks collection history
- `/debug-groupings.html` - Checks groupings tables
- `/debug-missing.html` - Finds missing branches
- `/mysql-investigation.html` - MySQL investigation notes
- `/extract_branches.py` - Python script (not needed)

---

## 📊 Data Structure Reference

### Correct Lookup Chain (NEW)
```
tbl_billing.contractmain_id 
    → tbl_contractmain.id (get mach_id)
    → tbl_newmachinehistory.mach_id (status=2, latest date)
    → tbl_newmachinehistory.branch_id
    → tbl_branchinfo.id
    → tbl_branchinfo.company_id
    → tbl_companylist.id
```

### Key Tables
| Table | Records | Purpose |
|-------|---------|---------|
| tbl_billing | 74,576 | Invoice records |
| tbl_contractmain | 4,600 | Machine contracts |
| tbl_newmachinehistory | 26,375 | Machine deployment history |
| tbl_branchinfo | 3,336 | Branch/department info |
| tbl_companylist | 1,143 | Company names |
| tbl_paymentinfo | ~70K | Payment records |
| tbl_collectionhistory | ~2K | Collection follow-up notes |

### Machine History Status Codes
- `status_id = 2` → "For Delivery" (machine deployed to branch)
- `status_id = 7` → "Pull Out" (machine removed)

---

## 🔑 Important Findings

1. **contract_id is NOT branch_id** - It's some other identifier (possibly internal contract number)
2. **Machine history tracks actual location** - Use latest delivery (status=2) to find current branch
3. **Branch names include company prefix** - e.g., "China Bank Savings Inc- CCAD - Consumer Securities"
4. **No separate departments table** - Departments are stored as branches in `tbl_branchinfo`

---

## 💾 Git Status
Latest commit: Should commit current changes with message:
```
"FIXED: Unknown companies - Use machine history for branch lookup (97.6% fix rate)"
```

---

## 🧪 Testing Checklist
- [x] China Bank Savings Inc shows correctly
- [x] Invoice #125538 shows "CCAD - Consumer Securities"
- [x] Invoice #125478 shows "Auto Loan" branch
- [x] 97.6% of previously Unknown invoices now resolved
- [ ] Invoice detail page works
- [ ] Page scrolling/height fixed
- [ ] State persistence on navigation

---

## 📞 Contact Context
- **Business**: Marga Enterprises (printer rental)
- **User**: Mike
- **System**: Firebase backend, HTML/JS frontend
- **Old System**: VB.NET app (reference for data structure)
