#!/usr/bin/env python3
"""
Extract missing branches (ID > 3812) from MySQL dump and prepare for Firebase import
"""

import re
import json
import os

# Configuration
SQL_FILE = "/Users/mike/Downloads/Dump20251229 (2) (1).sql"
OUTPUT_FILE = "/Volumes/Wotg Drive Mike/GitHub/Marga-App/missing_branches.json"
MIN_BRANCH_ID = 3812  # Branches above this ID are missing from Firebase

def extract_branchinfo_from_sql(sql_file):
    """Extract tbl_branchinfo INSERT statements from SQL dump"""
    
    print(f"Reading SQL file: {sql_file}")
    
    with open(sql_file, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    # Find the INSERT INTO tbl_branchinfo statement
    pattern = r"INSERT INTO `tbl_branchinfo` VALUES (.+?);"
    matches = re.findall(pattern, content, re.DOTALL)
    
    if not matches:
        print("No INSERT INTO tbl_branchinfo found!")
        return []
    
    print(f"Found {len(matches)} INSERT statement(s)")
    
    all_branches = []
    
    for match in matches:
        # Parse the VALUES - each record is in parentheses
        # Values format: (id,company_id,'branchname','street','bldg','floor','landmark','room','city',area_id,'email',...)
        
        # Split by "),(" but be careful with strings containing these characters
        records_str = match
        
        # Use regex to find each record
        record_pattern = r'\((\d+),(\d+),([^)]+)\)'
        
        # Actually, let's parse more carefully
        # The values are comma-separated, but strings can contain commas
        # Let's extract each tuple
        
        current_pos = 0
        while current_pos < len(records_str):
            # Find the start of a record
            if records_str[current_pos] == '(':
                # Find matching closing parenthesis
                depth = 1
                start = current_pos + 1
                pos = start
                in_string = False
                escape_next = False
                
                while pos < len(records_str) and depth > 0:
                    char = records_str[pos]
                    
                    if escape_next:
                        escape_next = False
                    elif char == '\\':
                        escape_next = True
                    elif char == "'" and not escape_next:
                        in_string = not in_string
                    elif not in_string:
                        if char == '(':
                            depth += 1
                        elif char == ')':
                            depth -= 1
                    
                    pos += 1
                
                record_str = records_str[start:pos-1]
                
                # Parse this record
                branch = parse_branch_record(record_str)
                if branch and branch.get('id', 0) > MIN_BRANCH_ID:
                    all_branches.append(branch)
                
                current_pos = pos
            else:
                current_pos += 1
    
    return all_branches

def parse_branch_record(record_str):
    """Parse a single branch record string into a dictionary"""
    
    # Fields based on typical tbl_branchinfo structure:
    # id, company_id, branchname, street, bldg, floor, landmark, room, brgy, city, area_id, 
    # email, latitude, longitude, intrvl, no_netcon_spoilage, inactive, earliest, 
    # address_type, code, isurgent, signatory, designation, branch_address, city_id
    
    values = []
    current_value = ''
    in_string = False
    escape_next = False
    
    for char in record_str:
        if escape_next:
            current_value += char
            escape_next = False
        elif char == '\\':
            escape_next = True
            current_value += char
        elif char == "'" :
            if in_string:
                in_string = False
            else:
                in_string = True
        elif char == ',' and not in_string:
            values.append(current_value.strip())
            current_value = ''
        else:
            current_value += char
    
    # Don't forget the last value
    values.append(current_value.strip())
    
    # Clean up values
    cleaned = []
    for v in values:
        v = v.strip()
        if v == 'NULL':
            cleaned.append(None)
        elif v.startswith("'") and v.endswith("'"):
            cleaned.append(v[1:-1].replace("\\'", "'").replace("\\\\", "\\"))
        else:
            try:
                if '.' in v:
                    cleaned.append(float(v))
                else:
                    cleaned.append(int(v))
            except:
                cleaned.append(v)
    
    # Map to field names (adjust based on actual table structure)
    field_names = [
        'id', 'company_id', 'branchname', 'street', 'bldg', 'floor', 'landmark', 
        'room', 'brgy', 'city', 'area_id', 'email', 'latitude', 'longitude', 
        'intrvl', 'no_netcon_spoilage', 'inactive', 'earliest', 'address_type',
        'code', 'isurgent', 'signatory', 'designation', 'branch_address', 'city_id'
    ]
    
    branch = {}
    for i, name in enumerate(field_names):
        if i < len(cleaned):
            branch[name] = cleaned[i]
    
    return branch

def main():
    print("=" * 60)
    print("Extracting Missing Branches from MySQL Dump")
    print("=" * 60)
    
    branches = extract_branchinfo_from_sql(SQL_FILE)
    
    print(f"\nFound {len(branches)} branches with ID > {MIN_BRANCH_ID}")
    
    if branches:
        # Sort by ID
        branches.sort(key=lambda x: x.get('id', 0))
        
        # Show first few
        print("\nFirst 5 missing branches:")
        for b in branches[:5]:
            print(f"  ID {b.get('id')}: {b.get('branchname')} (Company: {b.get('company_id')})")
        
        # Show last few
        print("\nLast 5 missing branches:")
        for b in branches[-5:]:
            print(f"  ID {b.get('id')}: {b.get('branchname')} (Company: {b.get('company_id')})")
        
        # Save to JSON
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(branches, f, indent=2, ensure_ascii=False)
        
        print(f"\nSaved to: {OUTPUT_FILE}")
        print(f"Total branches to import: {len(branches)}")
    else:
        print("No missing branches found!")

if __name__ == "__main__":
    main()
