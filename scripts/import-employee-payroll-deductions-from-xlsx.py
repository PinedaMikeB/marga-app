#!/usr/bin/env python3
"""Import employee payroll deduction plans from PAYROLL DEDUCTIONS.xlsx.

Creates or updates active rows in marga_hr_employee_deductions with:
- loan/advance balance from the workbook
- separate 15th-cutoff and 30th-cutoff deduction amounts

Writes only to the local Margabase Firestore-compatible API.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


DEFAULT_API = "http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents"
DEFAULT_KEY = "margabase-local"
DEFAULT_WORKBOOK = "/Users/mike/Downloads/PAYROLL DEDUCTIONS.xlsx"
DEFAULT_REPORT = "reports/hr-payroll-deduction-import.json"
SOURCE_LABEL = "PAYROLL DEDUCTIONS.xlsx"
COLLECTION = "marga_hr_employee_deductions"

ALIASES = {
    "teodorico ario": ["teodorio ario", "teodoro ario", "ario teodorio"],
    "teodorio ario": ["teodorico ario", "teodoro ario", "ario teodorio"],
    "teodoro ario": ["teodorico ario", "teodorio ario", "ario teodorio"],
    "ruben arnedo jr": ["ruben arnedo"],
    "raffy heriales": ["raffy heriales"],
    "raffy herilares": ["raffy heriales"],
    "john bonifacio iballo": ["rod ryan entereso", "john bonifacio iballo"],
    "mic jagger garcia": ["mic jagger garcia"],
}

PREFERRED_DOC_IDS = {
    "pineda irene": "106",
    "toledo jemuel": "274",
    "arlene agustin": "3",
    "joan ciar": "118",
}

DEDUCTION_GROUPS = (
    ("cash_advance", "Office", 4, 5, 6),
    ("bank_loan", "Bank", 7, 8, 9),
    ("sss_loan", "SSS", 10, 11, 12),
    ("pagibig_loan", "Pag-IBIG", 13, 14, 15),
)


def decode_value(value):
    if not isinstance(value, dict):
        return None
    if "stringValue" in value:
        return value["stringValue"]
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "nullValue" in value:
        return None
    if "arrayValue" in value:
        return [decode_value(item) for item in value.get("arrayValue", {}).get("values", [])]
    if "mapValue" in value:
        return {key: decode_value(item) for key, item in value.get("mapValue", {}).get("fields", {}).items()}
    return value


def encode_value(value):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        if not math.isfinite(value):
            return {"nullValue": None}
        if value.is_integer():
            return {"integerValue": str(int(value))}
        return {"doubleValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [encode_value(item) for item in value]}}
    return {"stringValue": str(value)}


def request_json(url, method="GET", body=None):
    payload = None
    headers = {}
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as response:
        if response.status == 204:
            return {}
        return json.load(response)


def fetch_collection(api_base, key, collection):
    rows = []
    token = ""
    while True:
        params = {"pageSize": "1000", "key": key}
        if token:
            params["pageToken"] = token
        url = f"{api_base.rstrip('/')}/{collection}?{urllib.parse.urlencode(params)}"
        data = request_json(url)
        for document in data.get("documents", []):
            row = {name: decode_value(value) for name, value in document.get("fields", {}).items()}
            row["_docId"] = document["name"].split("/")[-1]
            rows.append(row)
        token = data.get("nextPageToken") or ""
        if not token:
            return rows


def upsert_document(api_base, key, collection, doc_id, fields):
    url = f"{api_base.rstrip('/')}/{collection}/{urllib.parse.quote(str(doc_id), safe='')}?{urllib.parse.urlencode({'key': key})}"
    body = {"fields": {field_name: encode_value(value) for field_name, value in fields.items()}}
    return request_json(url, method="PATCH", body=body)


def employee_name(employee):
    first = str(employee.get("firstname") or employee.get("first_name") or "").strip()
    last = str(employee.get("lastname") or employee.get("last_name") or "").strip()
    full = f"{first} {last}".strip()
    return full or str(employee.get("name") or employee.get("marga_fullname") or employee.get("fullname") or "").strip()


def normalize_name(value):
    raw = str(value or "").strip()
    if "," in raw:
        last, first = [part.strip() for part in raw.split(",", 1)]
        raw = f"{first} {last}".strip()
    raw = unicodedata.normalize("NFD", raw).encode("ascii", "ignore").decode("ascii")
    raw = raw.lower()
    raw = re.sub(r"\bjr\.?\b", "jr", raw)
    raw = re.sub(r"[^a-z0-9]+", " ", raw)
    return raw.strip()


def number(value):
    if value is None or value == "":
        return 0.0
    return float(value)


def round_money(value):
    return round(float(value or 0), 2)


def format_payroll_sheet_name(last_name, first_name):
    last = str(last_name or "").strip().rstrip(",").strip()
    first = str(first_name or "").strip()
    if last and first:
        return f"{last}, {first}"
    return f"{last} {first}".strip()


def column_number(ref):
    letters = "".join(ch for ch in ref if ch.isalpha())
    total = 0
    for ch in letters:
        total = total * 26 + (ord(ch.upper()) - 64)
    return total


def decode_cell(cell, shared_strings, ns):
    cell_type = cell.attrib.get("t")
    value_node = cell.find("a:v", ns)
    if value_node is None or value_node.text is None:
        return None
    raw = value_node.text
    if cell_type == "s":
        return shared_strings[int(raw)]
    try:
        numeric = float(raw)
        return int(numeric) if numeric.is_integer() else numeric
    except ValueError:
        return raw


def read_workbook_rows(path):
    ns = {
        "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    }
    rows = []
    with zipfile.ZipFile(path) as workbook_zip:
        shared_strings = []
        if "xl/sharedStrings.xml" in workbook_zip.namelist():
            root = ET.fromstring(workbook_zip.read("xl/sharedStrings.xml"))
            for item in root.findall("a:si", ns):
                shared_strings.append("".join(node.text or "" for node in item.findall(".//a:t", ns)))

        workbook_xml = ET.fromstring(workbook_zip.read("xl/workbook.xml"))
        rels_xml = ET.fromstring(workbook_zip.read("xl/_rels/workbook.xml.rels"))
        rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels_xml.findall("rel:Relationship", ns)}
        sheet_target = rel_map.get(workbook_xml.find("a:sheets/a:sheet", ns).attrib.get(f"{{{ns['r']}}}id"))
        sheet_xml = ET.fromstring(workbook_zip.read(f"xl/{sheet_target}"))

        for row in sheet_xml.findall(".//a:sheetData/a:row", ns):
            row_number = int(row.attrib.get("r", "0"))
            if row_number < 7:
                continue
            values = {}
            for cell in row.findall("a:c", ns):
                values[column_number(cell.attrib.get("r", ""))] = decode_cell(cell, shared_strings, ns)
            last_name = values.get(1)
            first_name = values.get(2)
            if not last_name and not first_name:
                continue
            employee_label = format_payroll_sheet_name(last_name, first_name)
            deductions = []
            for deduction_type, source, balance_col, cutoff_15_col, cutoff_30_col in DEDUCTION_GROUPS:
                balance = round_money(number(values.get(balance_col)))
                deduction_15 = round_money(number(values.get(cutoff_15_col)))
                deduction_30 = round_money(number(values.get(cutoff_30_col)))
                if balance <= 0 and deduction_15 <= 0 and deduction_30 <= 0:
                    continue
                deductions.append(
                    {
                        "type": deduction_type,
                        "source": source,
                        "balance": balance,
                        "deduction_15": deduction_15,
                        "deduction_30": deduction_30,
                        "deduction_per_payroll": round_money(max(deduction_15, deduction_30)),
                    }
                )
            rows.append(
                {
                    "employee": employee_label,
                    "normalized_name": normalize_name(employee_label),
                    "bank_account_no": str(values.get(3) or "").strip(),
                    "deductions": deductions,
                }
            )
    return rows


def is_active(employee):
    if employee.get("active") is False or employee.get("marga_active") is False or employee.get("marga_account_active") is False:
        return False
    for key in ("estatus", "mstatus"):
        raw = employee.get(key)
        if raw not in (None, ""):
            try:
                if float(raw) <= 0:
                    return False
            except (TypeError, ValueError):
                pass
    return True


def candidate_score(employee):
    active_score = 1 if is_active(employee) else 0
    marga_score = 1 if employee.get("marga_active") is True or employee.get("marga_account_active") is True else 0
    rate_score = 1 if any(employee.get(key) not in (None, "", 0, "0") for key in ("monthly_salary", "monthly_rate", "semi_monthly_rate", "semim_rate", "payroll_sequence")) else 0
    try:
        doc_score = int(employee.get("_docId") or 0)
    except ValueError:
        doc_score = 0
    return active_score, marga_score, rate_score, doc_score


def choose_employee(row, employees_by_name):
    exact_candidates = employees_by_name.get(row["normalized_name"], [])
    if exact_candidates:
        preferred_id = PREFERRED_DOC_IDS.get(row["normalized_name"])
        if preferred_id:
            for candidate in exact_candidates:
                if str(candidate.get("_docId")) == preferred_id:
                    return candidate, exact_candidates
        sorted_exact = sorted(exact_candidates, key=candidate_score, reverse=True)
        return sorted_exact[0], sorted_exact

    keys = ALIASES.get(row["normalized_name"], [])
    candidates = []
    for key in keys:
        candidates.extend(employees_by_name.get(key, []))
    unique = {str(candidate.get("_docId")): candidate for candidate in candidates}.values()
    preferred_id = PREFERRED_DOC_IDS.get(row["normalized_name"])
    if preferred_id:
        for candidate in unique:
            if str(candidate.get("_docId")) == preferred_id:
                return candidate, list(unique)
    sorted_candidates = sorted(unique, key=candidate_score, reverse=True)
    return (sorted_candidates[0] if sorted_candidates else None), sorted_candidates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", default=DEFAULT_WORKBOOK)
    parser.add_argument("--api-base", default=DEFAULT_API)
    parser.add_argument("--api-key", default=DEFAULT_KEY)
    parser.add_argument("--report", default=DEFAULT_REPORT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    workbook_rows = read_workbook_rows(args.workbook)
    employees = fetch_collection(args.api_base, args.api_key, "tbl_employee")
    existing_deductions = {
        (str(item.get("employee_id") or ""), str(item.get("type") or "")): item
        for item in fetch_collection(args.api_base, args.api_key, COLLECTION)
    }
    employees_by_name = {}
    for employee in employees:
        employees_by_name.setdefault(normalize_name(employee_name(employee)), []).append(employee)
        sheet_name = str(employee.get("payroll_sheet_employee_name") or "").strip()
        if sheet_name:
            employees_by_name.setdefault(normalize_name(sheet_name), []).append(employee)

    updated_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    report = {
        "dry_run": args.dry_run,
        "workbook": args.workbook,
        "source_label": SOURCE_LABEL,
        "updated_at": updated_at,
        "rows": [],
        "summary": {
            "workbook_rows": len(workbook_rows),
            "matched_employees": 0,
            "missing_employees": 0,
            "deduction_plans": 0,
            "upserted": 0,
            "skipped_zero": 0,
        },
    }

    for row in workbook_rows:
        employee, candidates = choose_employee(row, employees_by_name)
        entry = {
            "employee": row["employee"],
            "normalized_name": row["normalized_name"],
            "employee_doc_id": str(employee.get("_docId")) if employee else "",
            "employee_record_name": employee_name(employee) if employee else "",
            "candidate_doc_ids": [str(candidate.get("_docId")) for candidate in candidates],
            "deductions": [],
            "status": "missing_employee" if not employee else "matched",
        }
        if not employee:
            report["summary"]["missing_employees"] += 1
            report["rows"].append(entry)
            continue

        report["summary"]["matched_employees"] += 1
        employee_id = str(employee.get("_docId"))
        employee_label = employee_name(employee) or row["employee"]
        for deduction in row["deductions"]:
            report["summary"]["deduction_plans"] += 1
            doc_id = f"ded-{employee_id}-{deduction['type']}"
            existing = existing_deductions.get((employee_id, deduction["type"]), {})
            existing_transactions = existing.get("transactions") if isinstance(existing.get("transactions"), list) else []
            balance = deduction["balance"]
            plan_status = "active" if balance > 0 else "closed"
            fields = {
                "employee_id": employee_id,
                "employee_name": employee_label,
                "type": deduction["type"],
                "source": deduction["source"],
                "total_amount": balance if balance > 0 else deduction["deduction_per_payroll"],
                "balance_amount": balance,
                "deduction_per_payroll": deduction["deduction_per_payroll"],
                "deduction_per_payroll_15th": deduction["deduction_15"],
                "deduction_per_payroll_30th": deduction["deduction_30"],
                "start_date": "",
                "reference": SOURCE_LABEL,
                "status": plan_status,
                "remarks": "Imported from PAYROLL DEDUCTIONS.xlsx. 15th cutoff uses deduction_per_payroll_15th; 30th cutoff uses deduction_per_payroll_30th.",
                "transactions": existing_transactions,
                "updated_at": updated_at,
                "updated_by": "codex-local-margabase",
            }
            if not existing:
                fields["created_at"] = updated_at
                fields["created_by"] = "codex-local-margabase"
            deduction_entry = {"doc_id": doc_id, "fields": fields, "status": "dry_run" if args.dry_run else "upserted"}
            entry["deductions"].append(deduction_entry)
            if not args.dry_run:
                upsert_document(args.api_base, args.api_key, COLLECTION, doc_id, fields)
                report["summary"]["upserted"] += 1
        report["rows"].append(entry)

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
    print(f"report={report_path}")
    if report["summary"]["missing_employees"]:
        print("missing employees:")
        for item in report["rows"]:
            if item["status"] == "missing_employee":
                print(f"- {item['employee']}")


if __name__ == "__main__":
    sys.exit(main())
