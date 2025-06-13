import json
import time
import re
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable

# --- Configuration ---
# The main, non-geocoded data file from fetch.py
INPUT_JSON_FILE = 'contacts-data-hierarchical.json'
# The simple, key-value file for coordinates you suggested
GEOCODES_JSON_FILE = 'geocodes.json'
USER_AGENT_FOR_NOMINATIM = "EPFO_Office_Locator_by_Gaurav"

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

def geocode_address(query, attempt_type):
    """Attempts to geocode a single query string, handling errors."""
    try:
        location = geolocator.geocode(query, timeout=10)
        time.sleep(1.1)  # Respect Nominatim's usage policy
        if location:
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
    
    new_codes_added = 0
    failed_to_geocode = []

    print(f"\nProcessing {len(all_office_data)} office entries...")

    for office_entry in all_office_data:
        if not isinstance(office_entry.get('office'), dict) or not office_entry['office'].get('office_address'):
            continue

        office_name = office_entry.get('office_name_hierarchical')
        if not office_name:
            continue

        # --- The key change: Skip if already geocoded ---
        if office_name in geocodes:
            continue

        print(f"\nNew office found: '{office_name}'. Attempting to geocode.")
        new_codes_added += 1
        
        address_str = str(office_entry['office']['office_address']).strip()
        location = None
        tried_query = ""

        # Stage 1: Attempt using PIN code
        pin_match = re.search(r'\b(\d{6})\b', address_str)
        if pin_match:
            pin_code = pin_match.group(1)
            city_state_from_name = ""
            if "," in office_name:
                parts = office_name.split(',')
                if len(parts) > 1:
                    city_state_from_name = parts[-1].strip()
            
            pin_query = f"{city_state_from_name}, {pin_code}, India" if city_state_from_name else f"{pin_code}, India"
            tried_query = pin_query
            location = geocode_address(pin_query, "PIN")

        # Stage 2: If PIN failed, try full address
        if not location:
            full_address_query = re.sub(r'\s{2,}', ' ', address_str.replace("\n", ", ")).strip(", ")
            if len(full_address_query) > 15: # Check for a reasonably long address
                tried_query = full_address_query
                location = geocode_address(f"{full_address_query}, India", "Full Address")

        if location:
            geocodes[office_name] = location
        else:
            failed_to_geocode.append({'name': office_name, 'tried_query': tried_query})

    # Save the updated geocodes dictionary
    with open(GEOCODES_JSON_FILE, 'w', encoding='utf-8') as f:
        json.dump(geocodes, f, indent=2, sort_keys=True, ensure_ascii=False)

    print(f"\n--- Geocoding Complete ---")
    print(f"Added {new_codes_added} new geocode(s). Total entries in '{GEOCODES_JSON_FILE}': {len(geocodes)}")

    if failed_to_geocode:
        print("\nCould NOT find coordinates for the following new offices:")
        for entry in failed_to_geocode:
            print(f"  - Name: {entry['name']} (Last tried query: '{entry['tried_query']}')")
        print("\nYou can manually add these to geocodes.json and re-run.")
