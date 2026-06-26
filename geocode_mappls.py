"""
Mappls (MapmyIndia) re-geocoder with verification.

WHY THIS EXISTS
---------------
The original `geocode_data.py` uses Nominatim/OSM with "PIN, India" or
"city, India" queries, which return the *centroid* of a postal zone or city
rather than the office building. Measured result: of ~300 offices, only ~15
were "medium" confidence and the rest were PIN/city centroids.

This script instead:
  1. Geocodes each office's full address with the Mappls Geocoding API, which
     is built on an India-first address directory and returns a `geocodeLevel`
     (poi / houseNumber / street / locality / city / pincode / ...) and a
     `confidenceScore`.
  2. VERIFIES every result against the office's own stated PIN / city / state
     and the India bounding box, then assigns its own confidence label.
  3. Is idempotent and incremental: results are cached with an address hash,
     so re-runs only touch new or low-confidence offices (kind to rate limits).
  4. Never overwrites good data on an API outage (sanity gate + atomic write),
     mirroring the guard we added to fetch.py.

OUTPUTS
  - geocodes.json        (legacy, backward-compatible): { office_name: [lat, lon] }
                         contains only ACCEPTED entries, so the site keeps working.
  - geocodes-meta.json   (new, rich): { office_query: { lat, lon, confidence,
                         score, geocode_level, source, matched, query_used,
                         formatted_address, verified_at } } — for QA and for the
                         UI to flag/hide low-confidence pins.

INPUTS
  - contacts-data.json                 (produced by fetch.py)
  - geocodes-overrides.json (optional): { office_query: [lat, lon] }  — hand-pinned
                         offices (e.g. Head Office, major ROs). These always win.

CREDENTIALS (never commit these)
  export MAPPLS_CLIENT_ID=...
  export MAPPLS_CLIENT_SECRET=...

USAGE
  python geocode_mappls.py                 # incremental, real run
  python geocode_mappls.py --limit 10      # only process 10 offices (testing)
  python geocode_mappls.py --dry-run       # geocode + verify, but write nothing
  python geocode_mappls.py --force         # ignore cache, re-geocode everything

Requires: pip install requests
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

# --------------------------------------------------------------------------
# Endpoints & response field names — VERIFY against your Mappls plan's docs.
# These are kept here so they're trivial to adjust after a first live test.
# --------------------------------------------------------------------------
TOKEN_URL = "https://outpost.mappls.com/api/security/oauth/token"
GEOCODE_URL = "https://atlas.mappls.com/api/places/geocode"   # GET ?address=...
# Response shape (Mappls): {"copResults": {... or [...]}} with fields:
#   latitude, longitude, geocodeLevel, confidenceScore, formattedAddress,
#   pincode, city, state, district, locality, ...
RESULTS_KEY = "copResults"

INPUT_JSON = "contacts-data.json"
LEGACY_OUT = "geocodes.json"
META_OUT = "geocodes-meta.json"
OVERRIDES = "geocodes-overrides.json"

# India bounding box (lat/lon) for a coarse plausibility check.
INDIA_BBOX = (6.0, 37.5, 68.0, 97.5)  # lat_min, lat_max, lon_min, lon_max

# How "precise" each Mappls geocodeLevel is (0..1).
LEVEL_WEIGHT = {
    "housenumber": 1.0, "house_number": 1.0, "poi": 0.95, "street": 0.85,
    "sublocality": 0.8, "sub_locality": 0.8, "locality": 0.7, "village": 0.55,
    "subdistrict": 0.5, "sub_district": 0.5, "city": 0.5, "pincode": 0.4,
    "district": 0.35, "state": 0.15,
}

ACCEPT_SCORE = 0.45     # min verified score to publish into legacy geocodes.json
RATE_LIMIT_SLEEP = 0.6  # seconds between Mappls calls (be polite to the API)


# --------------------------------------------------------------------------
# Mappls client (OAuth client-credentials + geocode)
# --------------------------------------------------------------------------
class Mappls:
    def __init__(self, client_id, client_secret):
        self.client_id = client_id
        self.client_secret = client_secret
        self._token = None
        self._token_type = "Bearer"
        self._expires_at = 0

    def _ensure_token(self):
        if self._token and time.time() < self._expires_at - 30:
            return
        resp = requests.post(TOKEN_URL, data={
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._token_type = data.get("token_type", "Bearer")
        self._expires_at = time.time() + int(data.get("expires_in", 3600))

    def geocode(self, address):
        """Return the raw first result dict, or None. Retries token once on 401."""
        for attempt in (1, 2):
            self._ensure_token()
            headers = {"Authorization": f"{self._token_type} {self._token}"}
            try:
                resp = requests.get(GEOCODE_URL, params={"address": address},
                                    headers=headers, timeout=30)
            except requests.RequestException as e:
                print(f"    network error: {e}")
                return None
            if resp.status_code == 401 and attempt == 1:
                self._token = None  # force refresh and retry once
                continue
            if resp.status_code == 429:
                print("    rate limited (429) — backing off 5s")
                time.sleep(5)
                continue
            if not resp.ok:
                print(f"    HTTP {resp.status_code} for '{address[:60]}'")
                return None
            results = resp.json().get(RESULTS_KEY)
            if isinstance(results, list):
                return results[0] if results else None
            return results or None
        return None


# --------------------------------------------------------------------------
# Address utilities + verification
# --------------------------------------------------------------------------
def clean_address(raw):
    """Collapse the multi-line scraped address into one geocodable string."""
    s = re.sub(r"\s{2,}", " ", str(raw or "").replace("\n", ", ")).strip(" ,")
    return s


def extract_pin(text):
    m = re.search(r"\b(\d{6})\b", str(text or ""))
    return m.group(1) if m else None


def address_hash(addr):
    return hashlib.sha1(clean_address(addr).encode("utf-8")).hexdigest()[:12]


def in_india(lat, lon):
    la0, la1, lo0, lo1 = INDIA_BBOX
    return la0 <= lat <= la1 and lo0 <= lon <= lo1


def verify(result, office_address):
    """
    Score a raw Mappls result against the office's own stated address.
    Returns (lat, lon, score, label, level, matched, formatted) or None if unusable.
    """
    try:
        lat = float(result.get("latitude"))
        lon = float(result.get("longitude"))
    except (TypeError, ValueError):
        return None

    matched = {"postal": False, "city": False, "state": False, "in_india": in_india(lat, lon)}
    if not matched["in_india"]:
        return (lat, lon, 0.0, "rejected", result.get("geocodeLevel"), matched, result.get("formattedAddress"))

    addr_lc = clean_address(office_address).lower()
    our_pin = extract_pin(office_address)
    res_pin = str(result.get("pincode") or "")
    if our_pin and res_pin:
        matched["postal"] = (our_pin == res_pin)
    res_city = str(result.get("city") or "").strip().lower()
    res_state = str(result.get("state") or "").strip().lower()
    if res_city and len(res_city) > 2:
        matched["city"] = res_city in addr_lc
    if res_state and len(res_state) > 2:
        matched["state"] = res_state in addr_lc

    level = str(result.get("geocodeLevel") or "").strip().lower()
    level_w = LEVEL_WEIGHT.get(level, 0.4)
    try:
        provider_conf = float(result.get("confidenceScore"))
    except (TypeError, ValueError):
        provider_conf = 0.5

    # Our verified score: precision of the geocode + provider's own confidence +
    # how well it agrees with the office's stated location.
    agreement = 1.0 if matched["postal"] else (0.6 if matched["city"] else (0.3 if matched["state"] else 0.0))
    score = round(0.5 * level_w + 0.3 * provider_conf + 0.2 * agreement, 3)

    if score >= 0.75 and (matched["postal"] or level in ("poi", "housenumber", "house_number", "street")):
        label = "high"
    elif score >= 0.5:
        label = "medium"
    else:
        label = "low"
    return (lat, lon, score, label, level, matched, result.get("formattedAddress"))


def verification_notes(matched, level, score):
    bits = [f"level={level}", f"score={score}"]
    bits.append("postal_match" if matched["postal"] else "postal_miss")
    if matched["city"]:
        bits.append("city_match")
    if matched["state"]:
        bits.append("state_match")
    if not matched["in_india"]:
        bits.append("OUTSIDE_INDIA")
    return "; ".join(bits)


# --------------------------------------------------------------------------
# IO helpers
# --------------------------------------------------------------------------
def load_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"Warning: could not read {path}: {e}")
        return default


def atomic_write(path, obj, **dump_kwargs):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, **dump_kwargs)
    os.replace(tmp, path)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Mappls re-geocoder with verification")
    ap.add_argument("--limit", type=int, default=0, help="process at most N offices (testing)")
    ap.add_argument("--dry-run", action="store_true", help="geocode + verify but write nothing")
    ap.add_argument("--force", action="store_true", help="ignore cache; re-geocode everything")
    args = ap.parse_args()

    client_id = os.environ.get("MAPPLS_CLIENT_ID")
    client_secret = os.environ.get("MAPPLS_CLIENT_SECRET")
    if not (client_id and client_secret):
        sys.exit("Set MAPPLS_CLIENT_ID and MAPPLS_CLIENT_SECRET environment variables first.")

    contacts = load_json(INPUT_JSON, None)
    if not isinstance(contacts, list):
        sys.exit(f"{INPUT_JSON} missing or not a list — run fetch.py first.")

    meta = load_json(META_OUT, {})            # cache of prior verified results
    overrides = load_json(OVERRIDES, {})       # hand-pinned offices (always win)
    client = Mappls(client_id, client_secret)

    processed = 0
    counts = {"high": 0, "medium": 0, "low": 0, "rejected": 0, "skipped": 0,
              "manual": 0, "cached": 0, "failed": 0}

    for ct in contacts:
        office = ct.get("office") or {}
        name = ct.get("office_name_hierarchical")
        query = ct.get("query")
        addr = office.get("office_address")
        if not (name and query and addr):
            counts["skipped"] += 1
            continue

        # Manual override beats everything.
        if query in overrides:
            lat, lon = overrides[query][:2]
            meta[query] = {"office_name": name, "lat": lat, "lon": lon, "confidence": "high",
                           "score": 1.0, "geocode_level": "manual", "source": "manual",
                           "matched": {"postal": True, "in_india": True},
                           "verified_at": datetime.now(timezone.utc).isoformat()}
            counts["manual"] += 1
            continue

        # Incremental: skip offices already geocoded well from the same address.
        cached = meta.get(query)
        if (not args.force and cached and cached.get("source") != "manual"
                and cached.get("addr_hash") == address_hash(addr)
                and cached.get("confidence") in ("high", "medium")):
            counts["cached"] += 1
            continue

        if args.limit and processed >= args.limit:
            break
        processed += 1

        cleaned = clean_address(addr)
        print(f"[{processed}] {name[:55]}")
        result = client.geocode(f"{cleaned}, India")
        time.sleep(RATE_LIMIT_SLEEP)
        if not result:
            counts["failed"] += 1
            continue

        v = verify(result, addr)
        if not v:
            counts["failed"] += 1
            continue
        lat, lon, score, label, level, matched, formatted = v
        counts[label] = counts.get(label, 0) + 1
        print(f"     -> {label} ({score})  {verification_notes(matched, level, score)}")

        meta[query] = {
            "office_name": name, "lat": lat, "lon": lon,
            "confidence": label, "score": score, "geocode_level": level,
            "source": "mappls", "matched": matched,
            "query_used": cleaned, "formatted_address": formatted,
            "addr_hash": address_hash(addr),
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }

    # --- Build the legacy file from accepted entries only ---
    legacy = {}
    accepted = 0
    for rec in meta.values():
        if rec.get("source") == "manual" or float(rec.get("score", 0)) >= ACCEPT_SCORE:
            if rec.get("confidence") != "rejected":
                legacy[rec["office_name"]] = [rec["lat"], rec["lon"]]
                accepted += 1

    print("\n--- Summary ---")
    for k, v in counts.items():
        if v:
            print(f"  {k}: {v}")
    print(f"  accepted into {LEGACY_OUT}: {accepted}")

    if args.dry_run:
        print("\nDry run — nothing written.")
        return

    # --- Sanity gate: don't wipe good data if an API outage produced almost nothing ---
    prev_legacy = load_json(LEGACY_OUT, {})
    prev_count = len(prev_legacy) if isinstance(prev_legacy, dict) else 0
    if prev_count and accepted < 0.8 * prev_count:
        sys.exit(f"ABORTING WRITE: only {accepted} accepted vs {prev_count} previously "
                 f"(<80%). Existing files left untouched.")

    atomic_write(META_OUT, meta, indent=2, ensure_ascii=False, sort_keys=True)
    atomic_write(LEGACY_OUT, legacy, indent=2, ensure_ascii=False, sort_keys=True)
    print(f"\nWrote {META_OUT} ({len(meta)} records) and {LEGACY_OUT} ({accepted} points).")


if __name__ == "__main__":
    main()
