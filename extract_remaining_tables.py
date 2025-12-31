#!/usr/bin/env python3
"""
Extract remaining 66 important tables from MySQL dump
"""

import re
import json
import os

SQL_FILE = os.path.expanduser("~/Downloads/Dump20251229 (2) (1).sql")
OUTPUT_DIR = "/Volumes/Wotg Drive Mike/GitHub/Marga-App/migrations"

# Remaining tables to migrate
TABLES_TO_MIGRATE = [
    'tbl_adminrequest', 'tbl_adminrequestdetails', 'tbl_adminreqdesc', 'tbl_adminreqtype',
    'tbl_changeunitrequest', 'tbl_checkmachine', 'tbl_checkpayments', 'tbl_checktype',
    'tbl_clientpaymentsummary', 'tbl_closedref', 'tbl_cstatus',
    'tbl_depositslip', 'tbl_depositsliptransaction',
    'tbl_dr', 'tbl_dr_itemtype', 'tbl_drhistory', 'tbl_drmain', 'tbl_drorder', 'tbl_drstatus',
    'tbl_facilitycheck', 'tbl_finaldr', 'tbl_finaldrdetails',
    'tbl_financerequest', 'tbl_financerequestdetails', 'tbl_financereqdesc', 'tbl_financereqtype',
    'tbl_fstatus', 'tbl_invoicerequest', 'tbl_irstatus',
    'tbl_itemrequest', 'tbl_itemrequestdetails', 'tbl_itemcat', 'tbl_itemstat',
    'tbl_machinemonthlystatus', 'tbl_machinepickupreceipt', 'tbl_machinerepair', 'tbl_machinerequest',
    'tbl_maritalstatus', 'tbl_mstatus',
    'tbl_newcartridgerepair', 'tbl_newcartridgestatus', 'tbl_newcartridgehistory',
    'tbl_newchecktype', 'tbl_newcheckvoucher', 'tbl_newcheckvoucherdetails',
    'tbl_newdepositslip', 'tbl_newdepositslipdetails',
    'tbl_newdr', 'tbl_newfordr',
    'tbl_newmachinerepair', 'tbl_newmachinerepairuseditems',
    'tbl_newotherrequest', 'tbl_newothershistory',
    'tbl_newpartsstatus', 'tbl_newpartshistory',
    'tbl_partsstatus', 'tbl_partsused', 'tbl_partstaken',
    'tbl_paymentcheck', 'tbl_paymentrequest', 'tbl_payments', 'tbl_paymenttype',
    'tbl_pird', 'tbl_pirdrequest',
    'tbl_porequest', 'tbl_porequestdetails',
    'tbl_prrequest', 'tbl_prrequestdetails',
    'tbl_pstatus', 'tbl_rdprocessrequest',
    'tbl_repaircartridgecounter', 'tbl_repairedparts', 'tbl_repairhistory',
    'tbl_request', 'tbl_status',
    'tbl_terminatedrecords', 'tbl_terminationrecords',
    'tbl_tistatus',
    # Additional useful tables
    'tbl_collectionhistory', 'tbl_branchcontact', 'tbl_contractinfo',
    'tbl_ornumber', 'tbl_followup', 'tbl_followups',
    'tbl_mapinfo', 'tbl_customerinfo', 'tbl_inquiries'
]

def parse_sql_values(row):
    values = []
    current = ''
    in_quotes = False
    i = 0
    
    while i < len(row):
        char = row[i]
        if char == "'" and (i == 0 or row[i-1] != '\\'):
            in_quotes = not in_quotes
            current += char
        elif char == ',' and not in_quotes:
            values.append(current.strip())
            current = ''
        else:
            current += char
        i += 1
    
    if current:
        values.append(current.strip())
    return values

def is_float(s):
    try:
        float(s)
        return '.' in s
    except:
        return False

def extract_table_data(sql_content, table_name):
    records = []
    
    structure_pattern = rf"CREATE TABLE `{table_name}` \((.*?)\) ENGINE"
    structure_match = re.search(structure_pattern, sql_content, re.DOTALL)
    
    if not structure_match:
        return [], []
    
    structure = structure_match.group(1)
    columns = []
    for line in structure.split('\n'):
        line = line.strip()
        if line.startswith('`'):
            col_name = line.split('`')[1]
            columns.append(col_name)
    
    insert_pattern = rf"INSERT INTO `{table_name}` VALUES\s*(.+?);"
    insert_matches = re.findall(insert_pattern, sql_content, re.DOTALL)
    
    for insert_data in insert_matches:
        row_pattern = r'\(([^)]+)\)'
        rows = re.findall(row_pattern, insert_data)
        
        for row in rows:
            values = parse_sql_values(row)
            if len(values) == len(columns):
                record = {}
                for i, col in enumerate(columns):
                    val = values[i]
                    if val == 'NULL':
                        record[col] = None
                    elif val.isdigit() or (val.startswith('-') and val[1:].isdigit()):
                        record[col] = int(val)
                    elif is_float(val):
                        record[col] = float(val)
                    else:
                        record[col] = val.strip("'")
                records.append(record)
    
    return columns, records

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    print("Loading SQL file...")
    with open(SQL_FILE, 'r', encoding='utf-8', errors='ignore') as f:
        sql_content = f.read()
    print(f"SQL file loaded ({len(sql_content) / 1024 / 1024:.1f} MB)")
    
    results = {}
    large_tables = []
    
    for table in TABLES_TO_MIGRATE:
        print(f"\n=== Extracting {table} ===")
        cols, records = extract_table_data(sql_content, table)
        
        if records:
            # Check if file would be too large (> 30MB ~ 30000 records typically)
            if len(records) > 30000:
                # Split into parts
                chunk_size = 30000
                for i in range(0, len(records), chunk_size):
                    chunk = records[i:i+chunk_size]
                    part_num = i // chunk_size + 1
                    output_file = os.path.join(OUTPUT_DIR, f'{table}_part{part_num}.json')
                    with open(output_file, 'w') as f:
                        json.dump(chunk, f)
                    print(f"✅ Saved {table}_part{part_num}.json ({len(chunk):,} records)")
                large_tables.append(table)
            else:
                output_file = os.path.join(OUTPUT_DIR, f'{table}.json')
                with open(output_file, 'w') as f:
                    json.dump(records, f)
                print(f"✅ Saved {len(records):,} records")
            results[table] = len(records)
        else:
            print(f"⚠️ No records found")
            results[table] = 0
    
    # Summary
    print("\n" + "="*60)
    print("EXTRACTION SUMMARY")
    print("="*60)
    
    total = 0
    for table, count in sorted(results.items(), key=lambda x: -x[1]):
        if count > 0:
            print(f"{table}: {count:,} records")
            total += count
    
    print(f"\nTotal records extracted: {total:,}")
    print(f"Large tables (split): {large_tables}")

if __name__ == '__main__':
    main()
