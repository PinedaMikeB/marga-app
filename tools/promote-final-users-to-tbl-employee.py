#!/usr/bin/env python3
"""Promote the final user roster into tbl_employee as the only login source.

This script:
1. Reads the attached final user XLSX.
2. Backs up current tbl_employee and marga_users docs locally.
3. Marks every existing tbl_employee record inactive by default.
4. Updates or creates the Excel-listed users in tbl_employee with Excel names/passwords.
5. Deletes every document in marga_users.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import ssl
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any

INSECURE_TLS = False
XML_NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

BASE_ROLE_DEFAULTS = {
    "admin": ["customers", "billing", "apd", "collections", "service", "inventory", "hr", "reports", "settings", "sync", "field", "purchasing", "pettycash", "sales"],
    "billing": ["customers", "billing", "apd", "pettycash", "reports"],
    "collection": ["customers", "collections", "reports"],
    "service": ["customers", "service", "inventory", "field"],
    "hr": ["hr", "settings"],
    "technician": ["field"],
    "messenger": ["field"],
    "viewer": ["customers", "reports"],
}


def request_json(url: str, method: str = "GET", payload: dict[str, Any] | None = None) -> Any:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    ctx = ssl._create_unverified_context() if INSECURE_TLS else None
    with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def request_empty(url: str, method: str) -> None:
    req = urllib.request.Request(url, method=method)
    ctx = ssl._create_unverified_context() if INSECURE_TLS else None
    with urllib.request.urlopen(req, timeout=60, context=ctx):
        return


def parse_firebase_config(path: str) -> tuple[str, str]:
    text = Path(path).read_text(encoding="utf-8")
    api_key = re.search(r"apiKey:\s*'([^']+)'", text)
    base_url = re.search(r"baseUrl:\s*'([^']+)'", text)
    if not api_key or not base_url:
        raise RuntimeError("Unable to parse shared/js/firebase-config.js")
    return api_key.group(1), base_url.group(1)


def fs_parse_value(value: dict[str, Any]) -> Any:
    if "stringValue" in value:
        return value["stringValue"]
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "timestampValue" in value:
        return value["timestampValue"]
    if "arrayValue" in value:
        return [fs_parse_value(item) for item in value.get("arrayValue", {}).get("values", [])]
    if "mapValue" in value:
        return {key: fs_parse_value(item) for key, item in value.get("mapValue", {}).get("fields", {}).items()}
    return None


def fs_parse_doc(doc: dict[str, Any]) -> dict[str, Any]:
    out = {key: fs_parse_value(value) for key, value in (doc.get("fields") or {}).items()}
    out["_docId"] = doc.get("name", "").split("/")[-1]
    return out


def fs_field(value: Any) -> dict[str, Any]:
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [fs_field(item) for item in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {key: fs_field(item) for key, item in value.items()}}}
    return {"stringValue": str(value)}


def fetch_collection(base_url: str, api_key: str, collection: str, page_size: int = 1000) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    token = ""
    while True:
        query = urllib.parse.urlencode({"pageSize": str(page_size), "key": api_key, **({"pageToken": token} if token else {})})
        payload = request_json(f"{base_url}/{collection}?{query}")
        docs.extend(fs_parse_doc(doc) for doc in payload.get("documents") or [])
        token = payload.get("nextPageToken") or ""
        if not token:
            break
    return docs


def set_document(base_url: str, api_key: str, collection: str, doc_id: str, fields: dict[str, Any]) -> None:
    url = f"{base_url}/{collection}/{urllib.parse.quote(str(doc_id), safe='')}?key={api_key}"
    request_json(url, method="PATCH", payload={"fields": {key: fs_field(value) for key, value in fields.items()}})


def delete_document(base_url: str, api_key: str, collection: str, doc_id: str) -> None:
    url = f"{base_url}/{collection}/{urllib.parse.quote(str(doc_id), safe='')}?key={api_key}"
    request_empty(url, method="DELETE")


def retire_legacy_user(base_url: str, api_key: str, doc_id: str, stamp: str, doc: dict[str, Any]) -> None:
    retained_name = str(doc.get("name") or f"{str(doc.get('firstname') or '').strip()} {str(doc.get('lastname') or '').strip()}").strip()
    set_document(
        base_url,
        api_key,
        "marga_users",
        doc_id,
        {
            **doc,
            "email": "",
            "username": f"retired-{doc_id}",
            "name": retained_name,
            "role": "",
            "roles": [],
            "allowed_modules": [],
            "allowed_modules_configured": False,
            "password": "",
            "password_hash": "",
            "password_salt": "",
            "password_iterations": 0,
            "active": False,
            "marga_active": False,
            "marga_account_active": False,
            "marga_retired": True,
            "marga_retired_at": stamp,
        },
    )


def normalize_key(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(text or "").strip().lower())


def sanitize_username(text: Any) -> str:
    value = re.sub(r"[^a-z0-9._-]+", "", str(text or "").strip().lower())
    return value.strip("._-")[:48]


def build_username_candidates(record: dict[str, Any], emp_id: int) -> list[str]:
    out: list[str] = []
    email = str(record.get("email") or "").strip().lower()
    if email and "@" in email:
        out.append(email.split("@", 1)[0])
    nickname = str(record.get("nickname") or "").strip()
    if nickname:
        out.append(nickname)
    first = str(record.get("firstname") or "").strip()
    last = str(record.get("lastname") or "").strip()
    if first and last:
        out.append(f"{first}.{last}")
    if first:
        out.append(first)
    out.append(f"emp{emp_id}")
    return out


def pick_username(record: dict[str, Any], emp_id: int, used_usernames: set[str], current_username: str = "") -> str:
    current = sanitize_username(current_username)
    if current:
        used_usernames.discard(current)

    for raw in build_username_candidates(record, emp_id):
        base = sanitize_username(raw)
        if not base:
            continue
        candidate = base
        suffix = 2
        while candidate in used_usernames:
            candidate = f"{base}{suffix}"
            suffix += 1
        used_usernames.add(candidate)
        return candidate

    fallback = f"emp{emp_id}"
    used_usernames.add(fallback)
    return fallback


def map_position_to_role(position: str) -> str:
    value = str(position or "").strip().lower()
    if "admin" in value or "manager" in value:
        return "admin"
    if "collect" in value:
        return "collection"
    if any(token in value for token in ("billing", "cashier", "account", "finance", "purchasing")):
        return "billing"
    if "messenger" in value or "driver" in value:
        return "messenger"
    if any(token in value for token in ("tech", "maintenance", "refiller")):
        return "technician"
    if any(token in value for token in ("service", "csr", "sales")):
        return "service"
    if "hr" in value:
        return "hr"
    return "viewer"


def hash_password(password: str) -> dict[str, Any]:
    salt = secrets.token_bytes(16)
    iterations = 120000
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)
    return {
        "password_hash": base64.b64encode(derived).decode("ascii"),
        "password_salt": base64.b64encode(salt).decode("ascii"),
        "password_iterations": iterations,
        "password_algo": "PBKDF2-SHA256",
    }


def parse_xlsx(path: str) -> list[dict[str, Any]]:
    with zipfile.ZipFile(path) as zf:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for node in root.findall("a:si", XML_NS):
                shared_strings.append("".join(text.text or "" for text in node.iterfind(".//a:t", XML_NS)))

        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
        first_sheet = workbook.find("a:sheets", XML_NS)[0]
        target = rel_map[first_sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
        sheet = ET.fromstring(zf.read(f"xl/{target.lstrip('/')}"))
        sheet_rows = sheet.find("a:sheetData", XML_NS)

        def cell_value(cell: ET.Element) -> str:
            value_node = cell.find("a:v", XML_NS)
            cell_type = cell.attrib.get("t")
            if cell_type == "s" and value_node is not None:
                return shared_strings[int(value_node.text)]
            if cell_type == "inlineStr":
                return "".join(node.text or "" for node in cell.iterfind(".//a:t", XML_NS))
            return "" if value_node is None else str(value_node.text or "")

        rows: list[list[str]] = []
        for row in sheet_rows:
            rows.append([cell_value(cell).strip() for cell in row.findall("a:c", XML_NS)])

    header_idx = -1
    for index, row in enumerate(rows):
        normalized = [normalize_key(value) for value in row]
        if "employeeid" in normalized and "firstname" in normalized and "lastname" in normalized:
            header_idx = index
            break
    if header_idx < 0:
        raise RuntimeError("Cannot detect header row in XLSX")

    header = [normalize_key(value) for value in rows[header_idx]]
    indexes = {
        name: header.index(name) if name in header else -1
        for name in ("employeeid", "nickname", "firstname", "lastname", "password", "contactnumber", "position", "email")
    }

    output: list[dict[str, Any]] = []
    for row_number in range(header_idx + 1, len(rows)):
        row = rows[row_number]
        first = str(row[indexes["firstname"]] if indexes["firstname"] >= 0 and indexes["firstname"] < len(row) else "").strip()
        last = str(row[indexes["lastname"]] if indexes["lastname"] >= 0 and indexes["lastname"] < len(row) else "").strip()
        nickname = str(row[indexes["nickname"]] if indexes["nickname"] >= 0 and indexes["nickname"] < len(row) else "").strip()
        email = str(row[indexes["email"]] if indexes["email"] >= 0 and indexes["email"] < len(row) else "").strip().lower()
        if not (first or last or nickname or email):
            continue
        password = str(row[indexes["password"]] if indexes["password"] >= 0 and indexes["password"] < len(row) else "").strip()
        if re.fullmatch(r"-?\d+(\.0+)?", password):
            password = str(int(float(password)))
        employee_id_value = str(row[indexes["employeeid"]] if indexes["employeeid"] >= 0 and indexes["employeeid"] < len(row) else "").strip()
        output.append({
            "row": row_number + 1,
            "employee_id": int(float(employee_id_value)) if employee_id_value else None,
            "nickname": nickname,
            "firstname": first,
            "lastname": last,
            "full_name_key": f"{normalize_key(first)}|{normalize_key(last)}",
            "nick_last_key": f"{normalize_key(nickname)}|{normalize_key(last)}",
            "email": email,
            "password": password,
            "has_password": bool(password),
            "position": str(row[indexes["position"]] if indexes["position"] >= 0 and indexes["position"] < len(row) else "").strip(),
            "contact_number": str(row[indexes["contactnumber"]] if indexes["contactnumber"] >= 0 and indexes["contactnumber"] < len(row) else "").strip(),
        })
    return output


def match_employee_id(record: dict[str, Any], by_email: dict[str, list[int]], matched_ids: set[int]) -> int | None:
    email = str(record.get("email") or "").strip().lower()
    if not email:
        return None
    candidates = by_email.get(email, [])
    for candidate in candidates:
        if candidate not in matched_ids:
            return candidate
    return candidates[0] if candidates else None


def write_backup(backup_dir: Path, stamp: str, tbl_employee: list[dict[str, Any]], marga_users: list[dict[str, Any]]) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"firebase-user-migration-backup-{stamp}.json"
    backup_path.write_text(
        json.dumps(
            {
                "created_at": stamp,
                "tbl_employee": tbl_employee,
                "marga_users": marga_users,
            },
            ensure_ascii=True,
            indent=2,
        ),
        encoding="utf-8",
    )
    return backup_path


def main() -> int:
    global INSECURE_TLS

    parser = argparse.ArgumentParser(description="Promote final users into tbl_employee and delete marga_users")
    parser.add_argument("--xlsx", default="/Users/mike/Downloads/Copy of Final Marga Users.xlsx")
    parser.add_argument("--backup-dir", default="/tmp/marga-firebase-backups")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--insecure", action="store_true")
    args = parser.parse_args()
    INSECURE_TLS = args.insecure

    api_key, base_url = parse_firebase_config("shared/js/firebase-config.js")
    existing_docs = fetch_collection(base_url, api_key, "tbl_employee", 1000)
    legacy_docs = fetch_collection(base_url, api_key, "marga_users", 1000)
    role_modules = BASE_ROLE_DEFAULTS.copy()
    for doc in fetch_collection(base_url, api_key, "marga_role_permissions", 200):
        role = str(doc.get("role") or doc.get("_docId") or "").strip().lower()
        modules = [str(item).strip().lower() for item in (doc.get("allowed_modules") or []) if str(item).strip()]
        if role and modules:
            role_modules[role] = modules

    positions_by_name: dict[str, dict[str, Any]] = {}
    for doc in fetch_collection(base_url, api_key, "tbl_empos", 2000):
        label = str(doc.get("position") or doc.get("name") or "").strip()
        if label:
            positions_by_name[normalize_key(label)] = doc

    final_rows = parse_xlsx(args.xlsx)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = write_backup(Path(args.backup_dir), stamp, existing_docs, legacy_docs)

    docs_by_id: dict[int, dict[str, Any]] = {}
    by_email: dict[str, list[int]] = {}
    used_usernames: set[str] = set()

    def index_doc(doc_id: int, doc: dict[str, Any]) -> None:
        email = str(doc.get("email") or doc.get("marga_login_email") or "").strip().lower()
        if email:
            by_email.setdefault(email, []).append(doc_id)

    for doc in existing_docs:
        raw_id = doc.get("id")
        if not isinstance(raw_id, int):
            continue
        merged = dict(doc)
        merged["id"] = raw_id
        merged["marga_active"] = False
        merged["marga_account_active"] = False
        merged["marga_updated_at"] = stamp
        docs_by_id[raw_id] = merged
        index_doc(raw_id, merged)
        username = sanitize_username(merged.get("username"))
        if username:
            used_usernames.add(username)

    next_id = max(docs_by_id.keys() or [0]) + 1
    matched_ids: set[int] = set()
    created_ids: list[int] = []
    unmatched_rows: list[dict[str, Any]] = []
    activated = 0

    for record in final_rows:
        employee_id = match_employee_id(record, by_email, matched_ids)
        created = False
        if employee_id is None:
            employee_id = next_id
            next_id += 1
            created = True
            docs_by_id[employee_id] = {"id": employee_id}

        employee = dict(docs_by_id[employee_id])
        full_name = f"{record['firstname']} {record['lastname']}".strip()
        role = map_position_to_role(record["position"])
        position_doc = positions_by_name.get(normalize_key(record["position"]))
        employee["id"] = employee_id
        employee["firstname"] = record["firstname"]
        employee["lastname"] = record["lastname"]
        employee["nickname"] = record["nickname"]
        employee["marga_fullname"] = full_name
        employee["name"] = full_name
        employee["contact_number"] = record["contact_number"]
        employee["position_label"] = record["position"]
        employee["position"] = record["position"]
        if position_doc and isinstance(position_doc.get("id"), int):
            employee["position_id"] = position_doc["id"]
        employee["marga_active"] = True
        employee["marga_account_active"] = True
        employee["marga_role"] = role
        employee["marga_roles"] = [role]
        employee["marga_allowed_modules"] = role_modules.get(role, [])
        employee["allowed_modules_configured"] = False
        employee["marga_role_updated_at"] = stamp
        employee["marga_updated_at"] = stamp
        employee["marga_source_file"] = os.path.basename(args.xlsx)
        employee["marga_source_row"] = record["row"]
        employee["marga_source_employee_id"] = record["employee_id"] or 0

        if record["email"]:
            employee["email"] = record["email"]
            employee["marga_login_email"] = record["email"]
        employee["username"] = pick_username(record, employee_id, used_usernames, str(employee.get("username") or ""))

        if record["has_password"]:
            employee["password"] = record["password"]
            employee.update(hash_password(record["password"]))
            employee["marga_password_updated_at"] = stamp
        else:
            unmatched_rows.append({"row": record["row"], "name": full_name, "reason": "missing password in xlsx"})

        docs_by_id[employee_id] = employee
        matched_ids.add(employee_id)
        activated += 1
        if created:
            created_ids.append(employee_id)

    active_count = sum(1 for doc in docs_by_id.values() if doc.get("marga_active") is True)
    inactive_count = len(docs_by_id) - active_count
    print(f"Backup written to: {backup_path}", flush=True)
    print(f"Excel rows processed: {len(final_rows)}", flush=True)
    print(f"tbl_employee docs before: {len(existing_docs)}", flush=True)
    print(f"marga_users docs before: {len(legacy_docs)}", flush=True)
    print(f"Active after migration: {active_count}", flush=True)
    print(f"Inactive after migration: {inactive_count}", flush=True)
    print(f"Created new tbl_employee docs: {len(created_ids)}", flush=True)
    if created_ids:
        print(f"Created IDs: {', '.join(str(doc_id) for doc_id in created_ids)}", flush=True)
    if unmatched_rows:
        for row in unmatched_rows:
            print(f"- row {row['row']}: {row['name']} ({row['reason']})", flush=True)

    if args.dry_run:
        return 0

    for index, employee_id in enumerate(sorted(docs_by_id), start=1):
        set_document(base_url, api_key, "tbl_employee", str(employee_id), docs_by_id[employee_id])
        if index % 25 == 0 or index == len(docs_by_id):
            print(f"Wrote {index}/{len(docs_by_id)} tbl_employee docs...", flush=True)

    retired_count = 0
    for index, doc in enumerate(legacy_docs, start=1):
        doc_id = str(doc.get("_docId") or "")
        try:
            delete_document(base_url, api_key, "marga_users", doc_id)
        except urllib.error.HTTPError as err:
            if err.code != 403:
                raise
            retire_legacy_user(base_url, api_key, doc_id, stamp, doc)
            retired_count += 1
        if index % 10 == 0 or index == len(legacy_docs):
            print(f"Deleted {index}/{len(legacy_docs)} marga_users docs...", flush=True)

    if retired_count:
        print(f"Retired {retired_count} marga_users docs because Firestore DELETE is forbidden.", flush=True)
    print(f"Wrote {len(docs_by_id)} tbl_employee docs and processed {len(legacy_docs)} marga_users docs.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
