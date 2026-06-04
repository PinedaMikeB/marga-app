#!/usr/bin/env python3
"""Update tbl_employee payroll master rates from the MARGA payroll workbook.

This script writes only to the local Margabase Firestore-compatible API. It
does not read from or write to Firebase.
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

try:
    from openpyxl import load_workbook
except ModuleNotFoundError:  # pragma: no cover - local fallback path
    load_workbook = None


DEFAULT_API = "http://127.0.0.1:9100/margabase-api/v1/projects/sah-spiritual-journal/databases/(default)/documents"
DEFAULT_KEY = "margabase-local"
DEFAULT_WORKBOOK = "/Users/mike/Downloads/payroll 1st Period of May 2026.xlsx"
DEFAULT_REPORT = "reports/hr-payroll-rate-update-2026-05-28.json"
SOURCE_LABEL = "payroll 1st Period of May 2026.xlsx"
EFFECTIVE_CUTOFF = "2026-04-26_to_2026-05-10"

ALIASES = {
    "teodorio ario": ["teodorico ario", "teodoro ario"],
    "teodoro ario": ["teodorico ario", "teodorio ario"],
    "ruben arnedo jr": ["ruben arnedo"],
    "raffy heriales": ["raffy heriales"],
    "raffy herilares": ["raffy heriales"],
    "john bonifacio iballo": ["rod ryan entereso", "john bonifacio iballo"],
}

PREFERRED_DOC_IDS = {
    "pineda irene": "268",
    "toledo jemuel": "274",
}


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


def optional_number(value):
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return round_money(number(value))


def read_workbook_rows(path):
    if load_workbook is None:
        return read_workbook_rows_from_xlsx_xml(path)
    workbook = load_workbook(path, data_only=True)
    worksheet = workbook["Sheet1"]
    rows = []
    for row_number in range(3, 37):
        payroll_no = worksheet.cell(row_number, 2).value
        name = worksheet.cell(row_number, 3).value
        semi_monthly = worksheet.cell(row_number, 5).value
        if not name or semi_monthly in (None, ""):
            continue
        rows.append(
            {
                "payroll_no": int(payroll_no),
                "employee": str(name).strip(),
                "normalized_name": normalize_name(name),
                "semi_monthly_rate": round_money(number(semi_monthly)),
                "monthly_salary": round_money(number(semi_monthly) * 2),
                "daily_rate": round_money(number(worksheet.cell(row_number, 6).value)),
                "allowance": round_money(number(worksheet.cell(row_number, 11).value)),
                "payroll_sss_amount": optional_number(worksheet.cell(row_number, 18).value),
                "payroll_phic_amount": optional_number(worksheet.cell(row_number, 19).value),
                "payroll_hdmf_amount": optional_number(worksheet.cell(row_number, 20).value),
                "payroll_nontax_allowance": optional_number(worksheet.cell(row_number, 24).value),
                "payroll_withholding_tax": optional_number(worksheet.cell(row_number, 25).value),
                "payroll_tax_refund": optional_number(worksheet.cell(row_number, 26).value),
                "payroll_sss_loan_per_payroll": round_money(number(worksheet.cell(row_number, 27).value)),
                "payroll_coop_loan_per_payroll": round_money(number(worksheet.cell(row_number, 28).value)),
                "payroll_bank_loan_per_payroll": round_money(number(worksheet.cell(row_number, 29).value)),
                "payroll_cash_advance_per_payroll": round_money(number(worksheet.cell(row_number, 30).value)),
                "payroll_pagibig_loan_per_payroll": round_money(number(worksheet.cell(row_number, 31).value)),
                "payroll_tshirt_deduction": optional_number(worksheet.cell(row_number, 32).value),
                "payroll_tax_adjustment": optional_number(worksheet.cell(row_number, 33).value),
                "payroll_deduction_adjustment": optional_number(worksheet.cell(row_number, 34).value),
            }
        )
    return rows


def read_workbook_rows_from_xlsx_xml(path):
    ns = {
        "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    }

    def column_number(ref):
        letters = "".join(ch for ch in ref if ch.isalpha())
        total = 0
        for ch in letters:
            total = total * 26 + (ord(ch.upper()) - 64)
        return total

    def decode_cell(cell, shared_strings):
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
        sheet_target = None
        for sheet in workbook_xml.find("a:sheets", ns):
            if sheet.attrib.get("name") == "Sheet1":
                sheet_target = rel_map.get(sheet.attrib.get(f"{{{ns['r']}}}id"))
                break
        if not sheet_target:
            raise RuntimeError("Sheet1 not found in workbook.")

        sheet_xml = ET.fromstring(workbook_zip.read(f"xl/{sheet_target}"))
        for row in sheet_xml.findall(".//a:sheetData/a:row", ns):
            row_number = int(row.attrib.get("r", "0"))
            if row_number < 3 or row_number > 36:
                continue
            values = {}
            for cell in row.findall("a:c", ns):
                values[column_number(cell.attrib.get("r", ""))] = decode_cell(cell, shared_strings)
            payroll_no = values.get(2)
            name = values.get(3)
            semi_monthly = values.get(5)
            if not name or semi_monthly in (None, ""):
                continue
            rows.append(
                {
                    "payroll_no": int(payroll_no),
                    "employee": str(name).strip(),
                    "normalized_name": normalize_name(name),
                    "semi_monthly_rate": round_money(number(semi_monthly)),
                    "monthly_salary": round_money(number(semi_monthly) * 2),
                    "daily_rate": round_money(number(values.get(6))),
                    "allowance": round_money(number(values.get(11))),
                    "payroll_sss_amount": optional_number(values.get(18)),
                    "payroll_phic_amount": optional_number(values.get(19)),
                    "payroll_hdmf_amount": optional_number(values.get(20)),
                    "payroll_nontax_allowance": optional_number(values.get(24)),
                    "payroll_withholding_tax": optional_number(values.get(25)),
                    "payroll_tax_refund": optional_number(values.get(26)),
                    "payroll_sss_loan_per_payroll": round_money(number(values.get(27))),
                    "payroll_coop_loan_per_payroll": round_money(number(values.get(28))),
                    "payroll_bank_loan_per_payroll": round_money(number(values.get(29))),
                    "payroll_cash_advance_per_payroll": round_money(number(values.get(30))),
                    "payroll_pagibig_loan_per_payroll": round_money(number(values.get(31))),
                    "payroll_tshirt_deduction": optional_number(values.get(32)),
                    "payroll_tax_adjustment": optional_number(values.get(33)),
                    "payroll_deduction_adjustment": optional_number(values.get(34)),
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
    rate_score = 1 if any(employee.get(key) not in (None, "", 0, "0") for key in ("monthly_salary", "monthly_rate", "semi_monthly_rate", "semim_rate")) else 0
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


def patch_employee(api_base, key, doc_id, fields):
    params = [("key", key)]
    for field_name in fields:
        params.append(("updateMask.fieldPaths", field_name))
    url = f"{api_base.rstrip()}/tbl_employee/{urllib.parse.quote(str(doc_id), safe='')}?{urllib.parse.urlencode(params)}"
    body = {"fields": {field_name: encode_value(value) for field_name, value in fields.items()}}
    return request_json(url, method="PATCH", body=body)


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
    employees_by_name = {}
    for employee in employees:
        employees_by_name.setdefault(normalize_name(employee_name(employee)), []).append(employee)

    updated_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    report = {
        "dry_run": args.dry_run,
        "workbook": args.workbook,
        "source_label": SOURCE_LABEL,
        "effective_cutoff": EFFECTIVE_CUTOFF,
        "updated_at": updated_at,
        "rows": [],
        "summary": {"workbook_rows": len(workbook_rows), "matched": 0, "updated": 0, "missing": 0},
    }

    for row in workbook_rows:
        employee, candidates = choose_employee(row, employees_by_name)
        entry = {
            **row,
            "employee_doc_id": str(employee.get("_docId")) if employee else "",
            "employee_record_name": employee_name(employee) if employee else "",
            "candidate_doc_ids": [str(candidate.get("_docId")) for candidate in candidates],
            "status": "missing" if not employee else "matched",
        }
        if not employee:
            report["summary"]["missing"] += 1
            report["rows"].append(entry)
            continue

        report["summary"]["matched"] += 1
        patch_fields = {
            "rate_type": "Monthly",
            "semi_monthly_rate": row["semi_monthly_rate"],
            "semim_rate": row["semi_monthly_rate"],
            "monthly_salary": row["monthly_salary"],
            "monthly_rate": row["monthly_salary"],
            "daily_rate": row["daily_rate"],
            "allowance": row["allowance"],
            "payroll_sequence": row["payroll_no"],
            "payroll_sheet_employee_name": row["employee"],
            "payroll_rate_source": SOURCE_LABEL,
            "payroll_rate_effective_cutoff": EFFECTIVE_CUTOFF,
            "payroll_sss_loan_per_payroll": row["payroll_sss_loan_per_payroll"],
            "payroll_coop_loan_per_payroll": row["payroll_coop_loan_per_payroll"],
            "payroll_bank_loan_per_payroll": row["payroll_bank_loan_per_payroll"],
            "payroll_cash_advance_per_payroll": row["payroll_cash_advance_per_payroll"],
            "payroll_pagibig_loan_per_payroll": row["payroll_pagibig_loan_per_payroll"],
            "payroll_deduction_prefill_source": SOURCE_LABEL,
            "payroll_deduction_prefill_cutoff": EFFECTIVE_CUTOFF,
            "payroll_rate_updated_at": updated_at,
            "payroll_rate_updated_by": "codex-local-margabase",
        }
        for optional_key in (
            "payroll_sss_amount",
            "payroll_phic_amount",
            "payroll_hdmf_amount",
            "payroll_nontax_allowance",
            "payroll_withholding_tax",
            "payroll_tax_refund",
            "payroll_tshirt_deduction",
            "payroll_tax_adjustment",
            "payroll_deduction_adjustment",
        ):
            if row.get(optional_key) is not None:
                patch_fields[optional_key] = row[optional_key]
        entry["patch_fields"] = patch_fields
        if not args.dry_run:
            patch_employee(args.api_base, args.api_key, employee["_docId"], patch_fields)
            report["summary"]["updated"] += 1
            entry["status"] = "updated"
        report["rows"].append(entry)

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
    print(f"report={report_path}")
    if report["summary"]["missing"]:
        print("missing:")
        for row in report["rows"]:
            if row["status"] == "missing":
                print(f"- {row['payroll_no']} {row['employee']}")


if __name__ == "__main__":
    sys.exit(main())
