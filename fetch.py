import requests
import json
from bs4 import BeautifulSoup
import time
import re
import urllib.parse

OFFICE_LIST_URL = "https://www.epfindia.gov.in/site_en/Contact_office_wise.php"
OFFICE_CATEGORY_IDS = [
    "HO", "DLUK", "PBHP", "UPBR", "KNGOA", "CNPD", "TNEC", "MHEM",
    "BRJH", "KRLD", "RJ", "HR", "OR", "TL", "AP", "GJ", "MPCG",
    "MBBD", "MBTH", "NER", "WBANDSK", "BG", "VW", "IAW", "NDC", "HH", "GH"
]
SPECIAL_CATEGORY_IDS = ["HH", "GH"]

# This map should ideally be fetched or completed by inspecting the <option> tags
# on https://www.epfindia.gov.in/site_en/Contact_us.php or Contact_office_wise.php
CATEGORY_ID_TO_NAME_MAP = {
    "HO": "Head Office",
    "DLUK": "Delhi, Uttarakhand, Jammu & Kashmir and Ladakh",
    "PBHP": "Punjab & Himachal Pradesh",
    "UPBR": "Uttar Pradesh & Bihar",
    "KNGOA": "Karnataka & Goa",
    "CNPD": "NCPD (Not specified, using ID)", # Placeholder
    "TNEC": "Tamil Nadu Zonal Office (Chennai) (Not specified, using ID)", # Placeholder
    "MHEM": "Maharashtra & Chhattisgarh (Not specified, using ID)", # Placeholder
    "BRJH": "Bihar & Jharkhand (Not specified, using ID)", # Placeholder
    "KRLD": "Kerala & Lakshadweep (Not specified, using ID)", # Placeholder
    "RJ": "Rajasthan",
    "HR": "Haryana",
    "OR": "Orissa",
    "TL": "Telangana",
    "AP": "Andhra Pradesh",
    "GJ": "Gujarat",
    "MPCG": "Madhya Pradesh & Chhattisgarh",
    "MBBD": "Mumbai - Bandra (Not specified, using ID)", # Placeholder
    "MBTH": "Mumbai - Thane (Not specified, using ID)", # Placeholder
    "NER": "North Eastern Region",
    "WBANDSK":"West Bengal, Andaman & Nicobar and Sikkim",
    "BG": "Bengaluru (Not specified, using ID)", # Placeholder
    "VW": "Vigilance Wing (Not specified, usingID)", # Placeholder
    "IAW": "Internal Audit Wing",
    "NDC": "National Data Centre",
    "HH": "Holiday Homes",
    "GH": "Guest Houses"
    # Add more mappings as identified
}


ADDITIONAL_QUERIES_WITH_HIERARCHY = [
    # If PDUNASS is a parent, its items would be listed under it.
    # This structure assumes PDUNASS is a query that might list these.
    # If PDUNASS is a category ID like DLUK, it should be in OFFICE_CATEGORY_IDS.
    # For now, adding with a placeholder hierarchy or assuming they are top-level.
    {'query_string': 'q=PDUNASS', 'name': 'PDUNASS', 'hierarchy_breadcrumbs': [{'name': 'EPFO Apex Bodies', 'query_param': 'ApexBodies'}]}, # Example parent
    {'query_string': 'q=ZONAL+TRAINING+INSTITUTE,+SOUTH+ZONE', 'name': 'Zonal Training Institute, South Zone', 'hierarchy_breadcrumbs': [{'name': 'PDUNASS', 'query_param': 'PDUNASS'}]},
    {'query_string': 'q=ZONAL+TRAINING+INSTITUTE,+NORTH+ZONE', 'name': 'Zonal Training Institute, North Zone', 'hierarchy_breadcrumbs': [{'name': 'PDUNASS', 'query_param': 'PDUNASS'}]},
    {'query_string': 'q=ZONAL+TRAINING+INSTITUTE,+EAST+ZONE', 'name': 'Zonal Training Institute, East Zone', 'hierarchy_breadcrumbs': [{'name': 'PDUNASS', 'query_param': 'PDUNASS'}]},
    {'query_string': 'q=SUB+ZONAL+TRAINING+INSTITUTE,+EAST+ZONE', 'name': 'Sub Zonal Training Institute, East Zone', 'hierarchy_breadcrumbs': [{'name': 'PDUNASS', 'query_param': 'PDUNASS'}]},
    {'query_string': 'q=ZONAL+TRAINING+INSTITUTE,+WEST+ZONE', 'name': 'Zonal Training Institute, West Zone', 'hierarchy_breadcrumbs': [{'name': 'PDUNASS', 'query_param': 'PDUNASS'}]}
]


HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:138.0) Gecko/20100101 Firefox/138.0',
    'Referer': 'https://www.epfindia.gov.in/site_en/Contact_us.php'
}
DETAIL_FETCH_URL = "https://www.epfindia.gov.in/site_en/get_directory.php"

def clean_email(email_text):
    if email_text:
        return email_text.replace("[at]", "@").replace("[dot]", ".").replace(" ", "")
    return None

def process_hierarchical_list(ul_element, current_hierarchy_breadcrumbs):
    """
    Recursively parses a <ul> element to find <li><a> items and their nested structures.
    Returns a list of items, each with its query_string, name, and full hierarchy_breadcrumbs.
    """
    items_found = []
    if not ul_element:
        return items_found

    for li in ul_element.find_all('li', recursive=False):
        a_tag = li.find('a', href=True, recursive=False)
        if a_tag:
            name = a_tag.get_text(strip=True)
            href_value = a_tag['href']

            if href_value.startswith('#'):
                query_param_value = href_value[1:] # Raw value from href e.g. "DELHI [NORTH]"
                encoded_query_param_for_request = urllib.parse.quote_plus(query_param_value)
                query_string_for_request = f"q={encoded_query_param_for_request}"

                # Current item's breadcrumb (for its children)
                # Storing raw query_param_value for breadcrumb readability
                breadcrumb_for_children = {'name': name, 'query_param': query_param_value}

                item_info = {
                    'query_string': query_string_for_request,
                    'name': name,
                    'hierarchy_breadcrumbs': list(current_hierarchy_breadcrumbs) # Parents of this item
                }
                items_found.append(item_info)

                nested_ul = li.find('ul', recursive=False)
                if nested_ul:
                    # Pass the updated breadcrumbs including the current item
                    items_found.extend(process_hierarchical_list(nested_ul, current_hierarchy_breadcrumbs + [breadcrumb_for_children]))
    return items_found


def extract_holiday_home_or_guest_house_info(html_content, category_id):
    soup = BeautifulSoup(html_content, 'html.parser')
    parsed_items_for_all_results = []
    tbl_body = soup.find('tbody', id='tbl_body')
    if not tbl_body:
        print(f"Warning: Could not find 'tbl_body' for category {category_id}.")
        return parsed_items_for_all_results

    rows = tbl_body.find_all('tr', class_='border_bottom')
    category_display_name = CATEGORY_ID_TO_NAME_MAP.get(category_id, category_id)

    for row_index, row in enumerate(rows):
        cols = row.find_all('td')
        if len(cols) < 1: continue

        item_data = {
            "office_name": f"{category_display_name} Entry {row_index + 1}",
            "office_address": "", "office_email": None, "std_code": None,
            "toll_free_no": None, "pro_numbers": [], "fax_numbers": []
        }

        col1_html = cols[0]
        name_tag = col1_html.find('b')
        if name_tag:
            item_data['office_name'] = name_tag.get_text(strip=True)
            name_tag.extract()

        full_text_col1 = col1_html.get_text(separator='\n', strip=True)
        lines_col1 = [line.strip() for line in full_text_col1.split('\n') if line.strip()]
        address_parts = []
        for line in lines_col1:
            if "@" in line or "[at]" in line: item_data['office_email'] = clean_email(line)
            else: address_parts.append(line)
        item_data['office_address'] = "\n".join(address_parts).strip()

        if len(cols) > 1:
            phone_parts_raw = cols[1].stripped_strings
            phones = [re.sub(r'\s+', '', p.strip()) for p in phone_parts_raw if re.fullmatch(r'[\d\s/-]+', p.strip()) and len(re.sub(r'\D', '', p.strip())) >= 5]
            item_data['pro_numbers'] = list(set(phones))

        if len(cols) > 2:
            fax_parts_raw = cols[2].stripped_strings
            faxes = [re.sub(r'\s+', '', p.strip()) for p in fax_parts_raw if re.fullmatch(r'[\d\s/-]+', p.strip()) and len(re.sub(r'\D', '', p.strip())) >= 5]
            item_data['fax_numbers'] = list(set(faxes))

        query_name_part = re.sub(r'\W+', '_', item_data['office_name'])
        item_package = {
            "query": f"q={category_id}_{query_name_part[:50]}", # Unique query for this direct item
            "office_name_hierarchical": item_data['office_name'],
            "hierarchy_breadcrumbs": [{'name': category_display_name, 'query_param': category_id}],
            "office": item_data,
            "officials": []
        }
        parsed_items_for_all_results.append(item_package)
    return parsed_items_for_all_results

def extract_contact_info(html_content):
    # (This function remains largely the same as in your previous version)
    # Ensure it returns office_details dictionary and staff_contacts list
    soup = BeautifulSoup(html_content, 'html.parser')
    office_info = {"pro_numbers": [], "phone_numbers_direct": [], "fax": []}
    individual_contacts = []

    p_tag = soup.find('p')
    if p_tag:
        p_lines = list(p_tag.stripped_strings)
        if p_lines:
            office_info['office_name'] = p_lines[0]
            address_lines = []
            email_line_index = -1
            for i, line in enumerate(p_lines):
                if ("[at]" in line and "[dot]" in line and "@" not in line) or \
                   ("@" in line and "." in line and "epfindia.gov.in" in line):
                    email_line_index = i
                    office_info['office_email'] = clean_email(p_lines[email_line_index])
                    break

            start_address_index = 1
            end_address_index = email_line_index if email_line_index != -1 else len(p_lines)
            for i in range(start_address_index, end_address_index):
                if not (p_lines[i].startswith("STD-Code") or \
                        p_lines[i].startswith("Toll Free No.") or \
                        p_lines[i].startswith("PRO No.")):
                    address_lines.append(p_lines[i])
            office_info['office_address'] = "\n".join(address_lines).strip()

            if 'office_email' not in office_info: office_info['office_email'] = None

            p_text_content_for_contacts = p_tag.get_text(separator='\n').strip()
            std_match = re.search(r"STD-Code\s*:\s*(\d+)", p_text_content_for_contacts)
            if std_match: office_info['std_code'] = std_match.group(1)

            toll_free_match = re.search(r"Toll Free No\.\s*:\s*(\d[\d\s-]+)", p_text_content_for_contacts)
            if toll_free_match: office_info['toll_free_no'] = toll_free_match.group(1).strip()

            # Regex to capture PRO numbers more reliably, stopping before "Ph:", "Fax:", or end of block
            pro_match = re.search(r"PRO No\.\s*:\s*([\s\S]*?)(?=(?:Ph:|Fax:|$|\n\s*\n))", p_text_content_for_contacts)
            if pro_match:
                pro_numbers_raw = pro_match.group(1).strip()
                office_info['pro_numbers'] = [
                    num.strip() for num in re.split(r'[\n,]+', pro_numbers_raw)
                    if num.strip().replace('-', '').isdigit() and len(num.strip()) > 4
                ]

    table = soup.find('table')
    if table:
        rows = table.find_all('tr')
        for row_index, row in enumerate(rows):
            if not row.get('class') or 'border_bottom' not in row.get('class', []):
                 if row_index == 0 and (row.find('th') or (len(row.find_all('td')) < 2 and len(row.find_all(text=True, recursive=False)) > 1 ) ) :
                     continue

            cols = row.find_all('td')
            contact_detail = {"phone_numbers": [], "email": None, "fax": []}
            if len(cols) >= 2:
                name_designation_parts = [text for text in cols[0].stripped_strings]
                if name_designation_parts:
                    contact_detail['name'] = name_designation_parts[0]
                    contact_detail['designation'] = name_designation_parts[1] if len(name_designation_parts) > 1 else None

                contact_info_parts = [text.strip() for text in cols[1].stripped_strings if text.strip()]
                for part in contact_info_parts:
                    if ("[at]" in part and "[dot]" in part and "@" not in part) or \
                       ("@" in part and "." in part and "epfindia.gov.in" in part): # Be more specific for official emails
                        contact_detail['email'] = clean_email(part)
                    elif re.fullmatch(r'[\d\s/-]+', part) and len(re.sub(r'\D', '', part)) >= 5:
                        contact_detail['phone_numbers'].append(part.replace(" ", ""))

                if len(cols) >= 3:
                    fax_parts = [text.strip() for text in cols[2].stripped_strings if text.strip()]
                    for part in fax_parts:
                         if re.fullmatch(r'[\d\s/-]+', part) and len(re.sub(r'\D', '', part)) >= 5:
                            contact_detail['fax'].append(part.replace(" ", ""))

                if contact_detail.get('name'):
                    individual_contacts.append(contact_detail)
    return office_info, individual_contacts


# --- Main script execution ---
if __name__ == "__main__":
    all_items_to_fetch_details_for = []
    all_results = []

    print("Starting to fetch office categories and parse hierarchy...")
    for category_id in OFFICE_CATEGORY_IDS:
        payload = {'id': category_id}
        category_display_name = CATEGORY_ID_TO_NAME_MAP.get(category_id, category_id)
        print(f"Fetching data for category: {category_display_name} (ID: {category_id})")
        try:
            response = requests.post(OFFICE_LIST_URL, data=payload, headers=HEADERS, timeout=30)
            response.raise_for_status()
            html_content_category_page = response.text

            if category_id in SPECIAL_CATEGORY_IDS:
                special_items_data = extract_holiday_home_or_guest_house_info(html_content_category_page, category_id)
                all_results.extend(special_items_data) # Already formatted for all_results
                if special_items_data:
                    print(f"Added {len(special_items_data)} items directly from special category '{category_display_name}'.")
            else:
                soup_category_page = BeautifulSoup(html_content_category_page, 'html.parser')
                item_list_ul = soup_category_page.find('ul', id='item-list')
                if item_list_ul:
                    initial_breadcrumbs = [{'name': category_display_name, 'query_param': category_id}]
                    found_items = process_hierarchical_list(item_list_ul, initial_breadcrumbs)
                    all_items_to_fetch_details_for.extend(found_items)
                    if found_items:
                        print(f"Found {len(found_items)} hierarchical sub-queries/items for '{category_display_name}'.")
                else:
                    print(f"No 'item-list' found for regular category '{category_display_name}'. Checking for direct 'tbl_body' as fallback.")
                    # Fallback for non-special categories that might use tbl_body
                    potential_direct_items = extract_holiday_home_or_guest_house_info(html_content_category_page, category_id)
                    if potential_direct_items:
                        print(f"Warning: Category '{category_display_name}' had no 'item-list' but contained direct items in 'tbl_body'. Adding them.")
                        all_results.extend(potential_direct_items)
            time.sleep(0.5)
        except requests.exceptions.RequestException as e:
            print(f"HTTP Request error for category ID {category_id}: {e}")
        except Exception as e:
            print(f"General error processing category ID {category_id}: {e}")

    # Add ADDITIONAL_QUERIES_WITH_HIERARCHY
    all_items_to_fetch_details_for.extend(ADDITIONAL_QUERIES_WITH_HIERARCHY)

    unique_items_to_fetch = []
    seen_query_strings = set()
    for item in all_items_to_fetch_details_for:
        if item['query_string'] not in seen_query_strings:
            unique_items_to_fetch.append(item)
            seen_query_strings.add(item['query_string'])

    print(f"\nTotal unique items for detailed fetching: {len(unique_items_to_fetch)}")

    for item_to_fetch in unique_items_to_fetch:
        query_param_str = item_to_fetch['query_string']
        item_name_hierarchical = item_to_fetch['name']
        hierarchy_breadcrumbs = item_to_fetch['hierarchy_breadcrumbs']

        print(f"Processing details for: {item_name_hierarchical} ({query_param_str})")
        try:
            response_detail = requests.post(DETAIL_FETCH_URL, data=query_param_str, headers=HEADERS, timeout=30)
            response_detail.raise_for_status()
            html_content_detail_page = response_detail.text
            office_details, staff_contacts = extract_contact_info(html_content_detail_page)

            if not office_details.get('office_name') and item_name_hierarchical: # Use hierarchical name if main parsing failed for name
                office_details['office_name'] = item_name_hierarchical

            all_results.append({
                "query": query_param_str,
                "office_name_hierarchical": item_name_hierarchical,
                "hierarchy_breadcrumbs": hierarchy_breadcrumbs,
                "office": office_details,
                "officials": staff_contacts
            })
            time.sleep(0.5)
        except requests.exceptions.RequestException as e:
            print(f"HTTP Request error for detail of {query_param_str}: {e}")
            all_results.append({"query": query_param_str, "office_name_hierarchical": item_name_hierarchical, "hierarchy_breadcrumbs": hierarchy_breadcrumbs, "office": {}, "officials": [], "error": f"HTTP Error: {str(e)}"})
        except Exception as e:
            print(f"General error for detail of {query_param_str}: {e}")
            all_results.append({"query": query_param_str, "office_name_hierarchical": item_name_hierarchical, "hierarchy_breadcrumbs": hierarchy_breadcrumbs, "office": {}, "officials": [], "error": f"Parsing/General Error: {str(e)}"})

    output_filename = "contacts-data.json"
    with open(output_filename, 'w') as f:
        json.dump(all_results, f, indent=2)

    print(f"\nData fetching complete. All results saved to {output_filename}")
