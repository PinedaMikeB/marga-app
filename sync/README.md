# MARGA Daily Sync System

This folder contains tools for keeping Firebase in sync with the MySQL database.

## Strategy

Since you'll continue using the VB.NET app until the new system is stable, we need to:
1. **Export** new/updated records from MySQL daily
2. **Import** those records into Firebase

## Files

| File | Purpose |
|------|---------|
| `export-mysql.php` | PHP script to run on server - exports updated records to JSON |
| `sync-config.json` | Configuration for sync (tables, timestamps, etc.) |
| `sync-dashboard.html` | Web UI to upload exported JSON and sync to Firebase |
| `sync-log.html` | View sync history and status |

## How It Works

### Step 1: Export from MySQL (Daily)
Run the PHP script on your server or via phpMyAdmin:
```
php export-mysql.php
```
This creates JSON files with records updated since last sync.

### Step 2: Upload & Sync to Firebase
Open `sync-dashboard.html` and:
1. Upload the exported JSON files
2. Click "Sync to Firebase"
3. Review the sync log

## Tables Tracked

The sync tracks these important tables:
- tbl_billing (invoices)
- tbl_machinereading (meter readings)
- tbl_collections (payments)
- tbl_contractmain (contracts)
- tbl_companylist (companies)
- tbl_branchinfo (branches)
- tbl_machine (machines)
- tbl_schedule (service schedules)
- And more...

## Sync Fields

Each table uses one of these fields to detect changes:
- `timestamp` / `tmestamp`
- `update_date`
- `date_received`
- `date_red` (reading date)

