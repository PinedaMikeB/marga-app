#!/usr/bin/env python3
"""
Extract ALL important tables from MySQL dump for Firebase migration
"""

import re
import json
import os

SQL_FILE = os.path.expanduser("~/Downloads/Dump20251229 (2) (1).sql")
OUTPUT_DIR = "/Volumes/Wotg Drive Mike/GitHub/Marga-App/migrations"

# Tables already in Firebase (from previous migrations)
ALREADY_MIGRATED = [
    'tbl_companylist', 'tbl_branchinfo', 'tbl_contractmain', 'tbl_machine',
    'tbl_model', 'tbl_brand', 'tbl_billinfo', 'tbl_area', 'tbl_city',
    'tbl_particulars', 'tbl_contractstatus', 'tbl_newmachinestatus',
    'tbl_machinereading', 'tbl_billing'  # Just migrated
]

# Important tables to migrate
TABLES_TO_MIGRATE = [
    # Collections & Payments
    'tbl_collections',
    'tbl_collectioninfo',
    'tbl_collectionstatus',
    'tbl_payments',
    'tbl_paymentinfo',
    
    # Invoice related
    'tbl_invoicenum',
    'tbl_invoiceage',
    'tbl_cancelledinvoices',
    
    # Service related
    'tbl_serviceinfo',
    'tbl_schedule',
    'tbl_techarea',
    'tbl_trouble',
    
    # Machine related
    'tbl_newmachinehistory',
    'tbl_machineparts',
    'tbl_condition',
    'tbl_mtype',
    'tbl_storage',
    
    # Parts & Cartridge
    'tbl_parts',
    'tbl_partstype',
    'tbl_cartridge',
    'tbl_tonerink',
    
    # Employees
    'tbl_employee',
    'tbl_empos',
    'tbl_empstatus',
    
    # Contract related
    'tbl_contracthistory',
    'tbl_contractdetails',
    
    # Delivery
    'tbl_dr',
    'tbl_drmain',
    'tbl_deliveryinfo',
    
    # Other important
    'tbl_groupings',
    'tbl_bracket',
    'tbl_nature',
    'tbl_origin',
    'tbl_ownership',
    'tbl_supplier',
    'tbl_customertype',
    'tbl_industry'
]

def parse_sql_values(row):
    """Parse SQL values handling quoted strings with commas"""
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
    """Extract INSERT statements for a table and parse them"""
    records = []
    
    # Find the table structure first
    structure_pattern = rf"CREATE TABLE `{table_name}` \((.*?)\) ENGINE"
    structure_match = re.search(structure_pattern, sql_content, re.DOTALL)
    
    if not structure_match:
        return [], []
    
    # Extract column names
    structure = structure_match.group(1)
    columns = []
    for line in structure.split('\n'):
        line = line.strip()
        if line.startswith('`'):
            col_name = line.split('`')[1]
            columns.append(col_name)
    
    # Find INSERT statements
    insert_pattern = rf"INSERT INTO `{table_name}` VALUES\s*(.+?);"
    insert_matches = re.findall(insert_pattern, sql_content, re.DOTALL)
    
    for insert_data in insert_matches:
        # Parse the values
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
    
    for table in TABLES_TO_MIGRATE:
        print(f"\n=== Extracting {table} ===")
        cols, records = extract_table_data(sql_content, table)
        
        if records:
            output_file = os.path.join(OUTPUT_DIR, f'{table}.json')
            with open(output_file, 'w') as f:
                json.dump(records, f, indent=2, default=str)
            print(f"✅ Saved {len(records):,} records to {table}.json")
            results[table] = len(records)
        else:
            print(f"⚠️ No records found for {table}")
            results[table] = 0
    
    # Summary
    print("\n" + "="*50)
    print("EXTRACTION SUMMARY")
    print("="*50)
    
    total = 0
    for table, count in sorted(results.items(), key=lambda x: -x[1]):
        if count > 0:
            print(f"{table}: {count:,} records")
            total += count
    
    print(f"\nTotal records extracted: {total:,}")
    print(f"Files saved to: {OUTPUT_DIR}")

if __name__ == '__main__':
    main()
