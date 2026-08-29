#!/usr/bin/env python3
"""Build the versioned static API published by GitHub Pages."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote_plus


API_VERSION = "1.0"
SOURCE_URL = "https://www.epfindia.gov.in/site_en/Contact_office_wise.php"

FIELD_CATEGORY_CODES = {
    "AP", "BG", "BRJH", "CNPD", "DLUK", "GJ", "HR", "KNGOA", "KRLD",
    "MBBD", "MBTH", "MHEM", "MPCG", "NER", "OR", "PBHP", "RJ", "TL",
    "TNEC", "UPBR", "WBANDSK",
}

CATEGORY_DEFINITIONS = {
    "head_office": ("Head Office", "ho"),
    "zonal_office": ("Zonal Office", "zo"),
    "regional_office": ("Regional Office", "ro"),
    "district_office": ("District Office", "do"),
    "special_state_office": ("Special State Office", "sso"),
    "vigilance_wing": ("Vigilance Wing", "vigilance"),
    "internal_audit_wing": ("Internal Audit Wing", "internal-audit"),
    "national_data_centre": ("National Data Centre", "ndc"),
    "pdunass_natrss": ("PDUNASS / NATRSS", "pdunass"),
    "zonal_training_institute": ("Zonal Training Institute", "zti"),
    "sub_zonal_training_institute": ("Sub-Zonal Training Institute", "szti"),
    "holiday_home": ("Holiday Home", "holiday-home"),
    "guest_house": ("Guest House", "guest-house"),
}

EMAIL_PATTERN = re.compile(r"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}", re.I)


def read_bytes(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except FileNotFoundError as error:
        raise SystemExit(f"Required source file does not exist: {path}") from error


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def stable_digest(value: str, length: int = 8) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def source_query_value(record: dict[str, Any]) -> str:
    query = str(record.get("query") or "")
    value = query.split("=", 1)[1] if "=" in query else query
    return unquote_plus(value).strip()


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")
    return slug or "unnamed"


def cleaned_identity_name(name: str, category: str) -> str:
    patterns = {
        "district_office": r"^(?:d\.?\s*o\.?|district office)\s*[-:]?\s*",
        "regional_office": r"^(?:r\.?\s*o\.?|regional office)\s*[-:]?\s*",
        "zonal_office": r"^zonal office\s*[-:]?\s*",
        "special_state_office": r"^(?:s\.?\s*s\.?\s*o\.?|special state office)\s*[-:]?\s*",
    }
    pattern = patterns.get(category)
    return re.sub(pattern, "", name, flags=re.I).strip() if pattern else name.strip()


def top_category_code(record: dict[str, Any]) -> str | None:
    breadcrumbs = record.get("hierarchy_breadcrumbs") or []
    if not breadcrumbs:
        return None
    return breadcrumbs[0].get("query_param")


def classify(record: dict[str, Any]) -> str:
    top = top_category_code(record)
    breadcrumbs = record.get("hierarchy_breadcrumbs") or []
    depth = len(breadcrumbs)
    name = str(record.get("office_name_hierarchical") or "").strip()

    if top == "HO":
        return "head_office"
    if top == "VW":
        return "vigilance_wing"
    if top == "IAW":
        return "internal_audit_wing"
    if top == "NDC":
        return "national_data_centre"
    if top == "ApexBodies":
        return "pdunass_natrss"
    if top == "PDUNASS" and name.lower().startswith("sub zonal"):
        return "sub_zonal_training_institute"
    if top == "PDUNASS":
        return "zonal_training_institute"
    if top == "HH":
        return "holiday_home"
    if top == "GH":
        return "guest_house"
    if top in FIELD_CATEGORY_CODES and depth == 1:
        return "zonal_office"
    if top in FIELD_CATEGORY_CODES and depth == 2:
        return "regional_office"
    if name.upper().startswith("SSO"):
        return "special_state_office"
    if top in FIELD_CATEGORY_CODES:
        return "district_office"

    raise ValueError(f"Cannot classify source record {record.get('query')!r} ({name!r})")


def exact_deduplicate(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    seen: set[str] = set()
    canonical: list[dict[str, Any]] = []
    for record in records:
        fingerprint = json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        canonical.append(record)
    return canonical, len(records) - len(canonical)


def unique_strings(*values: Any) -> list[str]:
    result: list[str] = []

    def visit(value: Any) -> None:
        if value is None:
            return
        if isinstance(value, (list, tuple, set)):
            for item in value:
                visit(item)
            return
        text = str(value).strip()
        if text and text.lower() != "null" and text not in result:
            result.append(text)

    for value in values:
        visit(value)
    return result


def extract_emails(*values: Any) -> list[str]:
    emails: list[str] = []
    for value in unique_strings(*values):
        cleaned = value.replace("[at]", "@").replace("[dot]", ".")
        for match in EMAIL_PATTERN.findall(cleaned):
            email = match.lower().strip(".,;:")
            if email not in emails:
                emails.append(email)
    return emails


def contact_payload(office: dict[str, Any]) -> dict[str, Any]:
    return {
        "emails": extract_emails(office.get("office_email")),
        "std_code": str(office.get("std_code") or "").strip() or None,
        "toll_free_number": str(office.get("toll_free_no") or "").strip() or None,
        "phone_numbers": unique_strings(office.get("phone_numbers_direct")),
        "pro_numbers": unique_strings(office.get("pro_numbers")),
        "fax_numbers": unique_strings(office.get("fax"), office.get("fax_numbers")),
    }


def official_payload(office_id: str, official: dict[str, Any], ordinal: int) -> dict[str, Any]:
    name = str(official.get("name") or "").strip() or None
    designation = str(official.get("designation") or "").strip() or None
    identity = "|".join([
        office_id,
        name or "",
        designation or "",
        str(official.get("email") or ""),
        str(ordinal),
    ])
    return {
        "id": f"official-{stable_digest(identity, 12)}",
        "office_id": office_id,
        "name": name,
        "designation": designation,
        "emails": extract_emails(official.get("email")),
        "phone_numbers": unique_strings(official.get("phone_numbers")),
        "fax_numbers": unique_strings(official.get("fax")),
    }


def resolve_parent_source_key(
    record: dict[str, Any],
    category: str,
    identity_map: dict[str, str],
    head_source_key: str,
) -> str | None:
    if category == "head_office":
        return None
    if category in {
        "zonal_office", "vigilance_wing", "internal_audit_wing",
        "national_data_centre", "pdunass_natrss", "holiday_home", "guest_house",
    }:
        return head_source_key
    if category in {"zonal_training_institute", "sub_zonal_training_institute"}:
        return identity_map.get("pdunass")

    breadcrumbs = record.get("hierarchy_breadcrumbs") or []
    parent_identity = str((breadcrumbs[-1] if breadcrumbs else {}).get("query_param") or "")
    return identity_map.get(parent_identity.strip().casefold())


def previous_office_ids(output_dir: Path) -> tuple[dict[str, str], dict[tuple[str, str], str]]:
    collection_path = output_dir / "offices.json"
    if not collection_path.exists():
        return {}, {}
    try:
        previous = json.loads(collection_path.read_text(encoding="utf-8")).get("offices", [])
    except (OSError, json.JSONDecodeError, AttributeError):
        return {}, {}

    source_counts = Counter(str(office.get("source_key") or "") for office in previous)
    by_unique_source = {
        str(office.get("source_key") or ""): str(office.get("id") or "")
        for office in previous
        if source_counts[str(office.get("source_key") or "")] == 1
    }
    by_source_and_address = {
        (
            str(office.get("source_key") or ""),
            str(office.get("address") or "").strip(),
        ): str(office.get("id") or "")
        for office in previous
    }
    return by_unique_source, by_source_and_address


def assign_ids(preliminary: list[dict[str, Any]], output_dir: Path) -> None:
    by_candidate: dict[str, list[dict[str, Any]]] = defaultdict(list)
    current_source_counts = Counter(item["source_key"] for item in preliminary)
    previous_by_source, previous_by_identity = previous_office_ids(output_dir)
    for item in preliminary:
        category = item["category"]
        _, prefix = CATEGORY_DEFINITIONS[category]
        identity_name = cleaned_identity_name(item["name"], category)
        candidate = "head-office" if category == "head_office" else f"{prefix}-{slugify(identity_name)}"
        by_candidate[candidate].append(item)

    used: set[str] = set()
    for candidate, items in by_candidate.items():
        for item in items:
            office = item["_raw"].get("office") or {}
            identity = "|".join([
                item["source_key"],
                item["name"],
                str(office.get("office_address") or ""),
            ])
            source_address_identity = (
                item["source_key"],
                str(office.get("office_address") or "").strip(),
            )
            previous_id = previous_by_identity.get(source_address_identity)
            if previous_id is None and current_source_counts[item["source_key"]] == 1:
                previous_id = previous_by_source.get(item["source_key"])
            identifier = previous_id or (
                candidate if len(items) == 1 else f"{candidate}-{stable_digest(identity)}"
            )
            suffix_length = 8
            while identifier in used:
                suffix_length += 2
                identifier = f"{candidate}-{stable_digest(identity, suffix_length)}"
            item["id"] = identifier
            used.add(identifier)


def compute_ancestors(office_id: str, parent_by_id: dict[str, str | None]) -> list[str]:
    ancestors: list[str] = []
    seen = {office_id}
    parent_id = parent_by_id[office_id]
    while parent_id is not None:
        if parent_id in seen:
            raise ValueError(f"Hierarchy cycle detected at {office_id}")
        if parent_id not in parent_by_id:
            raise ValueError(f"Office {office_id} references missing parent {parent_id}")
        ancestors.insert(0, parent_id)
        seen.add(parent_id)
        parent_id = parent_by_id[parent_id]
    return ancestors


def existing_generated_at(output_dir: Path, source_hash: str, geocode_hash: str) -> str | None:
    manifest_path = output_dir / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if (
        manifest.get("source_sha256") == source_hash
        and manifest.get("geocodes_sha256") == geocode_hash
    ):
        return manifest.get("generated_at")
    return None


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def validate_divisions(divisions: list[dict[str, Any]]) -> None:
    codes = [d.get("code") for d in divisions]
    if len(codes) != len(set(codes)):
        raise ValueError("Division codes are not unique")
    for d in divisions:
        for field in ("code", "name", "short_name", "unit_type", "parent_code", "active"):
            if field not in d:
                raise ValueError(f"Division {d.get('code')} missing required field: {field}")


def validate(offices: list[dict[str, Any]], officials: list[dict[str, Any]]) -> None:
    if len(offices) < 100:
        raise ValueError(f"Refusing to publish only {len(offices)} canonical offices")

    ids = [office["id"] for office in offices]
    if len(ids) != len(set(ids)):
        raise ValueError("Office IDs are not unique")

    id_set = set(ids)
    for office in offices:
        if office["category"] not in CATEGORY_DEFINITIONS:
            raise ValueError(f"Unknown category on {office['id']}")
        if office["parent_id"] is not None and office["parent_id"] not in id_set:
            raise ValueError(f"Missing parent for {office['id']}")
        if "officials" in office:
            raise ValueError("Named officials must not be embedded in offices.json")

    for official in officials:
        if official["office_id"] not in id_set:
            raise ValueError(f"Official {official['id']} references an unknown office")


def item_sort_key(office: dict[str, Any]) -> tuple[str, str]:
    return office["category"], office["name"].casefold()


def build(
    source_path: Path,
    geocodes_path: Path,
    output_dir: Path,
    divisions_path: Path | None = None,
) -> dict[str, Any]:
    source_bytes = read_bytes(source_path)
    geocodes_bytes = read_bytes(geocodes_path)
    raw_records = json.loads(source_bytes.decode("utf-8"))
    geocodes = json.loads(geocodes_bytes.decode("utf-8"))

    if divisions_path is None:
        default_divisions = source_path.parent / "divisions-data.json"
        if default_divisions.exists():
            divisions_path = default_divisions

    divisions: list[dict[str, Any]] = []
    divisions_hash: str | None = None
    if divisions_path and divisions_path.exists():
        divisions_bytes = read_bytes(divisions_path)
        divisions = json.loads(divisions_bytes.decode("utf-8"))
        if not isinstance(divisions, list):
            raise ValueError("divisions-data.json must contain a JSON array")
        validate_divisions(divisions)
        divisions_hash = sha256(divisions_bytes)

    if not isinstance(raw_records, list):
        raise ValueError("contacts-data.json must contain a JSON array")
    if not isinstance(geocodes, dict):
        raise ValueError("geocodes.json must contain a JSON object")

    canonical_records, duplicates_removed = exact_deduplicate(raw_records)
    source_hash = sha256(source_bytes)
    geocode_hash = sha256(geocodes_bytes)

    identity_map: dict[str, str] = {}
    for record in canonical_records:
        source_key = str(record.get("query") or "")
        identity_map.setdefault(source_query_value(record).casefold(), source_key)
        identity_map.setdefault(
            str(record.get("office_name_hierarchical") or "").strip().casefold(),
            source_key,
        )

    head_records = [record for record in canonical_records if classify(record) == "head_office"]
    if len(head_records) != 1:
        raise ValueError(f"Expected one Head Office, found {len(head_records)}")
    head_source_key = str(head_records[0].get("query") or "")

    preliminary: list[dict[str, Any]] = []
    for source_index, record in enumerate(canonical_records):
        name = str(record.get("office_name_hierarchical") or "").strip()
        if not name:
            raise ValueError(f"Source record {source_index} has no hierarchical office name")
        category = classify(record)
        source_key = str(record.get("query") or "")
        parent_source_key = resolve_parent_source_key(
            record, category, identity_map, head_source_key,
        )
        if category != "head_office" and not parent_source_key:
            raise ValueError(f"Unable to resolve parent for {name} ({source_key})")
        preliminary.append({
            "_raw": record,
            "_source_index": source_index,
            "source_key": source_key,
            "parent_source_key": parent_source_key,
            "name": name,
            "category": category,
        })

    assign_ids(preliminary, output_dir)
    source_to_id: dict[str, str] = {}
    for item in preliminary:
        source_to_id.setdefault(item["source_key"], item["id"])

    parent_by_id: dict[str, str | None] = {}
    for item in preliminary:
        parent_source_key = item["parent_source_key"]
        parent_id = source_to_id.get(parent_source_key) if parent_source_key else None
        if parent_source_key and not parent_id:
            raise ValueError(f"Missing source parent {parent_source_key} for {item['id']}")
        item["parent_id"] = parent_id
        parent_by_id[item["id"]] = parent_id

    offices: list[dict[str, Any]] = []
    all_officials: list[dict[str, Any]] = []
    details: dict[str, dict[str, Any]] = {}

    for item in preliminary:
        record = item["_raw"]
        source_office = record.get("office") or {}
        coordinates = geocodes.get(item["name"])
        latitude = coordinates[0] if isinstance(coordinates, list) and len(coordinates) >= 2 else None
        longitude = coordinates[1] if isinstance(coordinates, list) and len(coordinates) >= 2 else None
        normalized_officials = [
            official_payload(item["id"], official, ordinal)
            for ordinal, official in enumerate(record.get("officials") or [])
            if isinstance(official, dict)
        ]
        all_officials.extend(normalized_officials)

        office = {
            "id": item["id"],
            "source_key": item["source_key"],
            "name": item["name"],
            "category": item["category"],
            "parent_id": item["parent_id"],
            "ancestor_ids": compute_ancestors(item["id"], parent_by_id),
            "address": str(source_office.get("office_address") or "").strip() or None,
            "contact": contact_payload(source_office),
            "coordinates": {"latitude": latitude, "longitude": longitude},
            "official_count": len(normalized_officials),
            "source": {
                "category_code": top_category_code(record),
                "url": SOURCE_URL,
            },
        }
        offices.append(office)
        details[item["id"]] = {**office, "officials": normalized_officials}

    offices.sort(key=lambda office: (len(office["ancestor_ids"]), item_sort_key(office)))
    all_officials.sort(key=lambda official: (official["office_id"], official["id"]))
    validate(offices, all_officials)

    children: dict[str, list[str]] = defaultdict(list)
    for office in offices:
        if office["parent_id"]:
            children[office["parent_id"]].append(office["id"])

    category_counts = Counter(office["category"] for office in offices)
    categories = [
        {
            "id": category,
            "name": CATEGORY_DEFINITIONS[category][0],
            "record_count": category_counts.get(category, 0),
        }
        for category in CATEGORY_DEFINITIONS
        if category_counts.get(category, 0)
    ]

    generated_at = existing_generated_at(output_dir, source_hash, geocode_hash)
    generated_at = generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    data_version = f"v1-{source_hash[:12]}-{geocode_hash[:8]}"

    endpoints = {
        "offices": "offices.json",
        "office": "offices/{id}.json",
        "officials": "officials.json",
        "hierarchy": "hierarchy.json",
        "categories": "categories.json",
        "schema": "schema.json",
    }
    if divisions:
        endpoints["divisions"] = "divisions.json"
        endpoints["divisions_schema"] = "divisions-schema.json"

    manifest: dict[str, Any] = {
        "api_version": API_VERSION,
        "data_version": data_version,
        "generated_at": generated_at,
        "source_url": SOURCE_URL,
        "source_sha256": source_hash,
        "geocodes_sha256": geocode_hash,
        "raw_record_count": len(raw_records),
        "record_count": len(offices),
        "duplicate_records_removed": duplicates_removed,
        "official_count": len(all_officials),
        "endpoints": endpoints,
    }
    if divisions_hash is not None:
        manifest["divisions_sha256"] = divisions_hash
        manifest["division_count"] = len(divisions)

    office_dir = output_dir / "offices"
    office_dir.mkdir(parents=True, exist_ok=True)
    expected_detail_files = {f"{office_id}.json" for office_id in details}
    for stale_file in office_dir.glob("*.json"):
        if stale_file.name not in expected_detail_files:
            stale_file.unlink()

    write_json(output_dir / "manifest.json", manifest)
    write_json(output_dir / "offices.json", {
        "api_version": API_VERSION,
        "data_version": data_version,
        "record_count": len(offices),
        "offices": offices,
    })
    write_json(output_dir / "officials.json", {
        "api_version": API_VERSION,
        "data_version": data_version,
        "record_count": len(all_officials),
        "officials": all_officials,
    })
    if divisions:
        write_json(output_dir / "divisions.json", {
            "api_version": API_VERSION,
            "data_version": data_version,
            "record_count": len(divisions),
            "divisions": divisions,
        })
    write_json(output_dir / "hierarchy.json", {
        "api_version": API_VERSION,
        "data_version": data_version,
        "roots": [office["id"] for office in offices if office["parent_id"] is None],
        "nodes": [
            {
                "id": office["id"],
                "name": office["name"],
                "category": office["category"],
                "parent_id": office["parent_id"],
                "children_ids": sorted(children[office["id"]]),
            }
            for office in offices
        ],
    })
    write_json(output_dir / "categories.json", {
        "api_version": API_VERSION,
        "data_version": data_version,
        "record_count": len(categories),
        "categories": categories,
    })
    for office_id, detail in details.items():
        write_json(office_dir / f"{office_id}.json", {
            "api_version": API_VERSION,
            "data_version": data_version,
            "office": detail,
        })

    return manifest


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=project_root / "contacts-data.json")
    parser.add_argument("--geocodes", type=Path, default=project_root / "geocodes.json")
    parser.add_argument("--divisions", type=Path, default=project_root / "divisions-data.json")
    parser.add_argument("--output", type=Path, default=project_root / "api" / "v1")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = build(
        args.source.resolve(),
        args.geocodes.resolve(),
        args.output.resolve(),
        args.divisions.resolve() if args.divisions and args.divisions.exists() else None,
    )
    division_info = f", {manifest.get('division_count', 0)} divisions" if "division_count" in manifest else ""
    print(
        f"Built API {manifest['data_version']}: {manifest['record_count']} offices, "
        f"{manifest['official_count']} officials{division_info}, "
        f"{manifest['duplicate_records_removed']} exact duplicates removed."
    )


if __name__ == "__main__":
    main()
