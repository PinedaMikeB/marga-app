-- ============================================
-- MARGA Daily Export Script for MySQL Workbench
-- ============================================
-- 
-- HOW TO USE:
-- 1. Open MySQL Workbench
-- 2. Connect to your database
-- 3. Open this script (File > Open SQL Script)
-- 4. CHANGE THE DATE BELOW to your last sync date
-- 5. Run each query one by one (Ctrl+Shift+Enter)
-- 6. Export each result as JSON (click export icon above results)
-- 7. Save files to Google Drive
-- 8. Download on Mac and upload to synclatest.html
--
-- ============================================

-- ⚠️ CHANGE THIS DATE TO YOUR LAST SYNC DATE!
-- Format: YYYY-MM-DD HH:MM:SS
SET @last_sync = '2025-01-05 00:00:00';

-- ============================================
-- STEP 1: Check how many records to export
-- Run this first to see what needs syncing
-- ============================================

SELECT 
    'SUMMARY' as `---`,
    '' as `Table`,
    '' as `Records to Export`
UNION ALL
SELECT '', 'tbl_billing', (SELECT COUNT(*) FROM tbl_billing WHERE tmestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_machinereading', (SELECT COUNT(*) FROM tbl_machinereading WHERE timestmp >= @last_sync)
UNION ALL
SELECT '', 'tbl_collections', (SELECT COUNT(*) FROM tbl_collections WHERE tmestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_paymentinfo', (SELECT COUNT(*) FROM tbl_paymentinfo WHERE tmestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_invoicenum', (SELECT COUNT(*) FROM tbl_invoicenum WHERE tmestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_contractmain', (SELECT COUNT(*) FROM tbl_contractmain WHERE update_date >= @last_sync)
UNION ALL
SELECT '', 'tbl_companylist', (SELECT COUNT(*) FROM tbl_companylist WHERE timestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_branchinfo', (SELECT COUNT(*) FROM tbl_branchinfo WHERE timestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_machine', (SELECT COUNT(*) FROM tbl_machine WHERE tmestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_schedule', (SELECT COUNT(*) FROM tbl_schedule WHERE tmestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_newdr', (SELECT COUNT(*) FROM tbl_newdr WHERE tmestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_newmachinehistory', (SELECT COUNT(*) FROM tbl_newmachinehistory WHERE timestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_collectionhistory', (SELECT COUNT(*) FROM tbl_collectionhistory WHERE tmestamp >= @last_sync)
UNION ALL
SELECT '', 'tbl_checkpayments', (SELECT COUNT(*) FROM tbl_checkpayments WHERE tmestamp >= @last_sync);


-- ============================================
-- STEP 2: Export each table (run one at a time)
-- After running, click the Export button (disk icon)
-- Save as JSON with the table name
-- ============================================

-- -------- PRIORITY 1: Run these daily --------

-- 2A. Billing (invoices) → Save as: tbl_billing.json
SELECT * FROM tbl_billing WHERE tmestamp >= @last_sync;

-- 2B. Machine Readings (meter readings) → Save as: tbl_machinereading.json
SELECT * FROM tbl_machinereading WHERE timestmp >= @last_sync;

-- 2C. Collections (payments received) → Save as: tbl_collections.json
SELECT * FROM tbl_collections WHERE tmestamp >= @last_sync;

-- 2D. Payment Info → Save as: tbl_paymentinfo.json
SELECT * FROM tbl_paymentinfo WHERE tmestamp >= @last_sync;

-- 2E. Invoice Numbers → Save as: tbl_invoicenum.json
SELECT * FROM tbl_invoicenum WHERE tmestamp >= @last_sync;


-- -------- PRIORITY 2: Run every few days --------

-- 2F. Contracts → Save as: tbl_contractmain.json
SELECT * FROM tbl_contractmain WHERE update_date >= @last_sync;

-- 2G. Companies → Save as: tbl_companylist.json
SELECT * FROM tbl_companylist WHERE timestamp >= @last_sync;

-- 2H. Branches → Save as: tbl_branchinfo.json
SELECT * FROM tbl_branchinfo WHERE timestamp >= @last_sync;

-- 2I. Machines → Save as: tbl_machine.json
SELECT * FROM tbl_machine WHERE tmestamp >= @last_sync;


-- -------- PRIORITY 3: Run weekly --------

-- 2J. Schedules → Save as: tbl_schedule.json
SELECT * FROM tbl_schedule WHERE tmestamp >= @last_sync;

-- 2K. Delivery Receipts → Save as: tbl_newdr.json
SELECT * FROM tbl_newdr WHERE tmestamp >= @last_sync;

-- 2L. Machine History → Save as: tbl_newmachinehistory.json
SELECT * FROM tbl_newmachinehistory WHERE timestamp >= @last_sync;

-- 2M. Collection History → Save as: tbl_collectionhistory.json
SELECT * FROM tbl_collectionhistory WHERE tmestamp >= @last_sync;

-- 2N. Check Payments → Save as: tbl_checkpayments.json
SELECT * FROM tbl_checkpayments WHERE tmestamp >= @last_sync;


-- ============================================
-- DONE! Upload all JSON files to Google Drive
-- Then download on Mac and use synclatest.html
-- ============================================
