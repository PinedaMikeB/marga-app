-- ============================================
-- MARGA Daily Sync - SQL Export Queries
-- ============================================
-- Run these queries in phpMyAdmin to export updated records
-- Replace '2025-01-05 00:00:00' with your last sync date
-- Export results as JSON
-- ============================================

-- Set your last sync date here:
SET @last_sync = '2025-01-05 00:00:00';

-- ============================================
-- PRIORITY 1: Billing & Collections (Run Daily)
-- ============================================

-- Billing records (invoices)
SELECT * FROM tbl_billing 
WHERE tmestamp >= @last_sync;

-- Machine readings (meter readings)
SELECT * FROM tbl_machinereading 
WHERE timestmp >= @last_sync;

-- Collections (payments received)
SELECT * FROM tbl_collections 
WHERE tmestamp >= @last_sync;

-- Payment info
SELECT * FROM tbl_paymentinfo 
WHERE tmestamp >= @last_sync;


-- ============================================
-- PRIORITY 2: Customer & Contract Changes
-- ============================================

-- Company updates
SELECT * FROM tbl_companylist 
WHERE timestamp >= @last_sync;

-- Branch updates
SELECT * FROM tbl_branchinfo 
WHERE timestamp >= @last_sync;

-- Contract updates
SELECT * FROM tbl_contractmain 
WHERE update_date >= @last_sync;

-- Machine updates
SELECT * FROM tbl_machine 
WHERE tmestamp >= @last_sync;


-- ============================================
-- PRIORITY 3: Service & Operations
-- ============================================

-- Service schedules
SELECT * FROM tbl_schedule 
WHERE tmestamp >= @last_sync;

-- Delivery receipts
SELECT * FROM tbl_newdr 
WHERE tmestamp >= @last_sync;

-- Machine history
SELECT * FROM tbl_newmachinehistory 
WHERE timestamp >= @last_sync;


-- ============================================
-- HOW TO USE IN PHPMYADMIN:
-- ============================================
-- 1. Go to phpMyAdmin
-- 2. Select your database
-- 3. Click "SQL" tab
-- 4. Paste ONE query at a time
-- 5. Change @last_sync date to your last sync date
-- 6. Click "Go"
-- 7. Click "Export" at bottom of results
-- 8. Choose Format: JSON
-- 9. Click "Go" to download
-- 10. Save as: tbl_tablename_YYYYMMDD.json
-- 11. Upload to Sync Dashboard
-- ============================================
