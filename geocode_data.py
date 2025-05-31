import json
import time
import re # For PIN code extraction
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable

# --- Configuration ---
input_json_file = 'contacts-data-hierarchical.json' # Your source JSON with addresses
output_json_file = 'contacts-data-geocoded-by-pin.json' # New output file
USER_AGENT_FOR_NOMINATIM = "EPFO OFFICE Locator"

geolocator = Nominatim(user_agent=USER_AGENT_FOR_NOMINATIM)
# --- End Configuration ---

try:
    with open(input_json_file, 'r', encoding='utf-8') as f:
        all_office_data = json.load(f)
except FileNotFoundError:
    print(f"Error: Input file '{input_json_file}' not found.")
    exit()
except json.JSONDecodeError:
    print(f"Error: Could not decode JSON from '{input_json_file}'.")
    exit()

processed_office_data = []
failed_to_geocode_list = [] # Stores entries that failed both PIN and full address attempts

print(f"Starting geocoding process. Will add 1.1 second delay between API calls.\n")

for office_entry in all_office_data:
    # Ensure latitude and longitude keys are initialized in the office sub-dictionary
    if 'office' in office_entry and office_entry['office'] is not None:
        office_entry['office']['latitude'] = None
        office_entry['office']['longitude'] = None
    # If your structure is flatter for some entries (like HH/GH might have been before standardization)
    # elif 'office_address' in office_entry: # Example for a flatter structure
    #     office_entry['latitude'] = None
    #     office_entry['longitude'] = None
    else:
        # If no 'office' object or it's None, just pass the entry through
        processed_office_data.append(office_entry)
        continue

    # Proceed only if we have an office object and an address field
    if not (office_entry.get('office') and office_entry['office'].get('office_address')):
        print(f"Skipping entry due to missing 'office' object or 'office_address': {office_entry.get('query', 'Unknown query')}")
        processed_office_data.append(office_entry)
        continue

    original_address_str = str(office_entry['office']['office_address']).strip()
    office_name_for_context = office_entry.get('office_name_hierarchical',
                                           office_entry['office'].get('office_name', 'Unnamed Office'))

    location_found_for_entry = False
    geocoding_query_used = ""

    # Stage 1: Attempt geocoding using PIN code
    pin_code = None
    if original_address_str:
        pin_match = re.search(r'\b(\d{6})\b', original_address_str)
        if pin_match:
            pin_code = pin_match.group(1)

    if pin_code:
        # Construct a query focusing on the PIN code
        # Option 1: Try to get locality before PIN from address string
        address_before_pin = original_address_str.split(pin_code)[0].strip().rstrip(',').strip()
        locality_from_address = ""
        if address_before_pin:
            parts = [p.strip() for p in address_before_pin.split(',') if p.strip()]
            if parts:
                locality_from_address = parts[-1] # Take the last part as a locality hint

        if locality_from_address and len(locality_from_address) > 3: # If we have a decent locality hint
            pin_focused_query = f"{locality_from_address}, {pin_code}, India"
        else: # Fallback: Use office name context or just PIN
            city_state_from_office_name = ""
            if "," in office_name_for_context: # e.g. "Office Name, City"
                 parts = office_name_for_context.split(',')
                 if len(parts) > 1 :
                    city_state_from_office_name = parts[-1].strip()

            if city_state_from_office_name:
                 pin_focused_query = f"{city_state_from_office_name}, {pin_code}, India"
            else:
                 pin_focused_query = f"{pin_code}, India"

        geocoding_query_used = pin_focused_query
        print(f"Geocoding (PIN attempt): '{office_name_for_context}' | Using: '{pin_focused_query}'")
        try:
            location = geolocator.geocode(pin_focused_query, timeout=10)
            if location:
                office_entry['office']['latitude'] = location.latitude
                office_entry['office']['longitude'] = location.longitude
                print(f"  SUCCESS (PIN): Lat={location.latitude}, Lon={location.longitude}")
                location_found_for_entry = True
            else:
                print(f"  FAILED (PIN): Not found by geocoder.")
        except GeocoderTimedOut:
            print(f"  FAILED (PIN): Geocoder timed out.")
        except GeocoderUnavailable:
            print(f"  FAILED (PIN): Geocoder service unavailable. Consider stopping/waiting.")
        except Exception as e:
            print(f"  FAILED (PIN): Error - {e}")

        time.sleep(1.1) # API delay

    # Stage 2: If not found with PIN, attempt with the fuller constructed address
    if not location_found_for_entry:
        # Construct full address (similar to your original script's logic)
        full_address_query = original_address_str

        # Append city/state from office name if it seems useful and not already present
        if "," in office_name_for_context:
            city_state_from_name = office_name_for_context.split(',')[-1].strip()
            # A simple check to avoid adding "Delhi" if address already ends with "Delhi" or similar
            if not full_address_query.lower().endswith(city_state_from_name.lower()):
                 full_address_query += f", {city_state_from_name}"

        if "india" not in full_address_query.lower():
            full_address_query += ", India"

        # Clean up common junk and ensure it's substantial enough
        full_address_query = full_address_query.replace("STD-Code :", "").replace("\n", ", ").strip(", ")
        full_address_query = re.sub(r'\s{2,}', ' ', full_address_query) # Replace multiple spaces with one

        if not full_address_query or full_address_query.lower() == 'india' or len(full_address_query) < 15: # Stricter length check
            print(f"Skipping full address for '{office_name_for_context}' as it's invalid/too short: '{original_address_str}' -> '{full_address_query}'")
        else:
            geocoding_query_used = full_address_query
            print(f"Geocoding (Full Address attempt): '{office_name_for_context}' | Using: '{full_address_query}'")
            try:
                location = geolocator.geocode(full_address_query, timeout=10)
                if location:
                    office_entry['office']['latitude'] = location.latitude
                    office_entry['office']['longitude'] = location.longitude
                    print(f"  SUCCESS (Full Addr): Lat={location.latitude}, Lon={location.longitude}")
                    location_found_for_entry = True
                else:
                    print(f"  FAILED (Full Addr): Not found by geocoder.")
            except GeocoderTimedOut:
                print(f"  FAILED (Full Addr): Geocoder timed out.")
            except GeocoderUnavailable:
                print(f"  FAILED (Full Addr): Geocoder service unavailable.")
            except Exception as e:
                print(f"  FAILED (Full Addr): Error - {e}")

            time.sleep(1.1) # API delay

    if not location_found_for_entry and (pin_code or (full_address_query and len(full_address_query) >=15) ): # Only add to failed list if an attempt was made
        failed_to_geocode_list.append({
            'name': office_name_for_context,
            'original_address': original_address_str,
            'tried_query': geocoding_query_used # Store the last query tried
        })

    processed_office_data.append(office_entry)

# Save the augmented data
with open(output_json_file, 'w', encoding='utf-8') as f:
    json.dump(processed_office_data, f, indent=2, ensure_ascii=False)

print(f"\nGeocoding processing complete. Output saved to '{output_json_file}'")
if failed_to_geocode_list:
    print("\nOffices that could NOT be geocoded by any method:")
    for entry in failed_to_geocode_list:
        print(f"  Name: {entry['name']}")
        print(f"    Original Address: {entry['original_address']}")
        print(f"    Last Tried Query: {entry['tried_query']}\n")
    print("You may need to manually find coordinates for these or further refine their addresses.")
else:
    print("\nAll valid office entries were processed.")
    print("Check the output file for entries with latitude/longitude values.")
