import json
import time
import re
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable

# --- Configuration ---
# UPDATED: Reads from the cleaner contacts-data.json
INPUT_JSON_FILE = 'contacts-data.json'
# The simple, key-value file for coordinates
GEOCODES_JSON_FILE = 'geocodes.json'
USER_AGENT_FOR_NOMINATIM = "EPFO_Office_Locator_by_Gaurav"
INDIA_BOUNDS = (6.0, 37.5, 68.0, 97.5)

geolocator = Nominatim(user_agent=USER_AGENT_FOR_NOMINATIM)
# --- End Configuration ---

def load_source_data(filename):
    """Loads the main contacts data file."""
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: Input file '{filename}' not found. Please run fetch.py first.")
        exit()
    except json.JSONDecodeError:
        print(f"Error: Could not decode JSON from '{filename}'.")
        exit()

def load_or_create_geocodes(filename):
    """Loads existing geocodes or returns an empty dictionary if file doesn't exist."""
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            print(f"Loaded existing geocodes from '{filename}'.")
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        print(f"No existing geocode file found or it's invalid. Starting fresh.")
        return {}

def geocode_address(query, attempt_type, expected_pin=None):
    """Attempts to geocode a single query string, handling errors."""
    try:
        location = geolocator.geocode(
            query,
            timeout=10,
            country_codes="in",
            addressdetails=True,
        )
        time.sleep(1.1)  # Respect Nominatim's usage policy
        if location:
            lat_min, lat_max, lon_min, lon_max = INDIA_BOUNDS
            if not (lat_min <= location.latitude <= lat_max and lon_min <= location.longitude <= lon_max):
                print(f"  REJECTED ({attempt_type}): Result is outside India.")
                return None
            if expected_pin:
                address = location.raw.get("address") or {}
                returned_pin = re.sub(r"\D", "", str(address.get("postcode") or ""))
                if returned_pin != expected_pin:
                    shown_pin = returned_pin or "missing"
                    print(
                        f"  REJECTED ({attempt_type}): Expected PIN {expected_pin}, "
                        f"geocoder returned {shown_pin}."
                    )
                    return None
            print(f"  SUCCESS ({attempt_type}): Lat={location.latitude}, Lon={location.longitude}")
            return [location.latitude, location.longitude]
        else:
            print(f"  FAILED ({attempt_type}): Not found for query '{query}'.")
            return None
    except (GeocoderTimedOut, GeocoderUnavailable) as e:
        print(f"  FAILED ({attempt_type}): Geocoder service error - {e}. Waiting before retry or next step.")
        time.sleep(5) # Wait longer if the service is struggling
    except Exception as e:
        print(f"  FAILED ({attempt_type}): An unexpected error occurred - {e}")
    return None


if __name__ == "__main__":
    all_office_data = load_source_data(INPUT_JSON_FILE)
    geocodes = load_or_create_geocodes(GEOCODES_JSON_FILE)
    
    attempted_count = 0
    new_codes_added = 0
    failed_to_geocode = []

    print(f"\nProcessing {len(all_office_data)} office entries...")

    for office_entry in all_office_data:
        if not isinstance(office_entry.get('office'), dict) or not office_entry['office'].get('office_address'):
            continue

        office_name = office_entry.get('office_name_hierarchical')
        if not office_name:
            continue

        # Skip if already geocoded
        if office_name in geocodes:
            continue

        print(f"\nNew office found: '{office_name}'. Attempting to geocode.")
        attempted_count += 1
        
        address_str = str(office_entry['office']['office_address']).strip()
        location = None
        tried_query = ""

        # Stage 1: Attempt using PIN code
        pin_match = re.search(r'\b(\d{3})\s?(\d{3})\b', address_str)
        if pin_match:
            pin_code = "".join(pin_match.groups())
            pin_query = f"{pin_code}, India"
            tried_query = pin_query
            location = geocode_address(pin_query, "PIN", expected_pin=pin_code)

        # Stage 2: If PIN failed, try full address
        if not location:
            full_address_query = re.sub(r'\s{2,}', ' ', address_str.replace("\n", ", ")).strip(", ")
            if len(full_address_query) > 15: # Check for a reasonably long address
                tried_query = full_address_query
                location = geocode_address(f"{full_address_query}, India", "Full Address")

        if location:
            geocodes[office_name] = location
            new_codes_added += 1
        else:
            failed_to_geocode.append({'name': office_name, 'tried_query': tried_query})

    # Save the updated geocodes dictionary
    with open(GEOCODES_JSON_FILE, 'w', encoding='utf-8') as f:
        json.dump(geocodes, f, indent=2, sort_keys=True, ensure_ascii=False)

    print(f"\n--- Geocoding Complete ---")
    print(
        f"Attempted {attempted_count} office(s); added {new_codes_added} new geocode(s). "
        f"Total entries in '{GEOCODES_JSON_FILE}': {len(geocodes)}"
    )

    if failed_to_geocode:
        print("\nCould NOT find coordinates for the following new offices:")
        for entry in failed_to_geocode:
            print(f"  - Name: {entry['name']} (Last tried query: '{entry['tried_query']}')")
        print("\nYou can manually add these to geocodes.json and re-run.")
