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
from pathlib import Path

from openpyxl import load_workbook


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
    "pineda irene": "106",
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


def read_workbook_rows(path):
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
            "payroll_rate_updated_at": updated_at,
            "payroll_rate_updated_by": "codex-local-margabase",
        }
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
