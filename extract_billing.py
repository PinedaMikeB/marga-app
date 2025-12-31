#!/usr/bin/env python3
"""
Extract tbl_machinereading and tbl_billing from MySQL dump and convert to JSON for Firebase
"""

import re
import json
import os

SQL_FILE = os.path.expanduser("~/Downloads/Dump20251229 (2) (1).sql")
OUTPUT_DIR = "/Volumes/Wotg Drive Mike/GitHub/Marga-App/migrations"

def extract_table_data(sql_file, table_name):
    """Extract INSERT statements for a table and parse them"""
    records = []
    
    with open(sql_file, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    # Find the table structure first
    structure_pattern = rf"CREATE TABLE `{table_name}` \((.*?)\) ENGINE"
    structure_match = re.search(structure_pattern, content, re.DOTALL)
    
    if not structure_match:
        print(f"Could not find structure for {table_name}")
        return [], []
    
    # Extract column names
    structure = structure_match.group(1)
    columns = []
    for line in structure.split('\n'):
        line = line.strip()
        if line.startswith('`'):
            col_name = line.split('`')[1]
            columns.append(col_name)
    
    print(f"Found columns for {table_name}: {columns}")
    
    # Find INSERT statements
    insert_pattern = rf"INSERT INTO `{table_name}` VALUES\s*(.+?);"
    insert_matches = re.findall(insert_pattern, content, re.DOTALL)
    
    for insert_data in insert_matches:
        # Parse the values - this handles multiple rows in one INSERT
        # Values are like (val1,val2,...),(val1,val2,...)
        row_pattern = r'\(([^)]+)\)'
        rows = re.findall(row_pattern, insert_data)
        
        for row in rows:
            # Parse individual values
            values = parse_sql_values(row)
            
            if len(values) == len(columns):
                record = {}
                for i, col in enumerate(columns):
                    val = values[i]
                    # Convert types
                    if val == 'NULL':
                        record[col] = None
                    elif val.isdigit() or (val.startswith('-') and val[1:].isdigit()):
                        record[col] = int(val)
                    elif is_float(val):
                        record[col] = float(val)
                    else:
                        record[col] = val.strip("'")
                records.append(record)
    
    print(f"Extracted {len(records)} records from {table_name}")
    return columns, records

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

def main():
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Extract tbl_machinereading
    print("\n=== Extracting tbl_machinereading ===")
    cols, records = extract_table_data(SQL_FILE, 'tbl_machinereading')
    
    output_file = os.path.join(OUTPUT_DIR, 'tbl_machinereading.json')
    with open(output_file, 'w') as f:
        json.dump(records, f, indent=2, default=str)
    print(f"Saved to {output_file}")
    
    # Show sample
    if records:
        print(f"\nSample record:")
        print(json.dumps(records[0], indent=2))
        print(f"\nTotal records: {len(records)}")
    
    # Extract tbl_billing  
    print("\n=== Extracting tbl_billing ===")
    cols, records = extract_table_data(SQL_FILE, 'tbl_billing')
    
    output_file = os.path.join(OUTPUT_DIR, 'tbl_billing.json')
    with open(output_file, 'w') as f:
        json.dump(records, f, indent=2, default=str)
    print(f"Saved to {output_file}")
    
    if records:
        print(f"\nSample record:")
        print(json.dumps(records[0], indent=2))
        print(f"\nTotal records: {len(records)}")

if __name__ == '__main__':
    main()
