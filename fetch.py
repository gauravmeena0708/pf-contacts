import requests
import json
from bs4 import BeautifulSoup
import time
import re
import urllib.parse

# URL for fetching the initial list of office categories/queries
OFFICE_LIST_URL = "https://www.epfindia.gov.in/site_en/Contact_office_wise.php"
# IDs to use for fetching different categories of offices
OFFICE_CATEGORY_IDS = [
    "HO", "DLUK", "PBHP", "UPBR", "KNGOA", "CNPD", "TNEC", "MHEM",
    "BRJH", "KRLD", "RJ", "HR", "OR", "TL", "AP", "GJ", "MPCG",
    "MBBD", "MBTH", "NER", "WBANDSK", "BG", "VW", "IAW", "NDC", "HH", "GH"
]
SPECIAL_CATEGORY_IDS = ["HH", "GH"] # Categories with direct table listings

# Static queries to append at the end
ADDITIONAL_QUERIES = [
    "q=PDUNASS",
    "q=ZONAL+TRAINING+INSTITUTE,+SOUTH+ZONE",
    "q=ZONAL+TRAINING+INSTITUTE,+NORTH+ZONE",
    "q=ZONAL+TRAINING+INSTITUTE,+EAST+ZONE",
    "q=SUB+ZONAL+TRAINING+INSTITUTE,+EAST+ZONE",
    "q=ZONAL+TRAINING+INSTITUTE,+WEST+ZONE"
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

def extract_holiday_home_or_guest_house_info(html_content, category_id_for_query):
    """
    Parses HTML content for Holiday Homes (HH) or Guest Houses (GH)
    which have a direct table listing in <tbody id="tbl_body">.
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    parsed_items_for_all_results = []
    
    tbl_body = soup.find('tbody', id='tbl_body')
    if not tbl_body:
        print(f"Warning: Could not find 'tbl_body' for category {category_id_for_query}. Skipping direct parse for this ID.")
        return parsed_items_for_all_results
        
    rows = tbl_body.find_all('tr', class_='border_bottom')
    
    for row_index, row in enumerate(rows):
        cols = row.find_all('td')
        if len(cols) < 1: # Need at least one column for name/address
            continue
            
        item_data = {
            "office_name": f"{category_id_for_query} Entry {row_index + 1}", # Default name
            "office_address": "",
            "office_email": None,
            "std_code": None,
            "toll_free_no": None,
            "pro_numbers": [], # For main phone numbers
            "fax_numbers": []  # For fax numbers
        }
        
        # Column 1: Name, Address, Email
        col1_html = cols[0]
        name_tag = col1_html.find('b')
        if name_tag:
            item_data['office_name'] = name_tag.get_text(strip=True)
            name_tag.extract() 

        # Get remaining text, then process lines for address and email
        full_text_col1 = col1_html.get_text(separator='\n', strip=True)
        lines_col1 = [line.strip() for line in full_text_col1.split('\n') if line.strip()]
        
        address_parts = []
        for line in lines_col1:
            if "@" in line or "[at]" in line: # Heuristic for email
                item_data['office_email'] = clean_email(line)
            else:
                address_parts.append(line)
        item_data['office_address'] = "\n".join(address_parts).strip()

        # Column 2: Phone numbers (if exists)
        if len(cols) > 1:
            col2_content = cols[1]
            phone_parts_raw = col2_content.stripped_strings
            phones = []
            for part in phone_parts_raw:
                cleaned_part = part.strip()
                # Regex to match phone numbers, allowing digits, spaces, hyphens, slashes
                if re.fullmatch(r'[\d\s/-]+', cleaned_part) and len(re.sub(r'\D', '', cleaned_part)) >= 5:
                    phones.append(re.sub(r'\s+', '', cleaned_part)) # Remove internal spaces
            item_data['pro_numbers'] = list(set(phones)) # Store as pro_numbers for consistency with JS

        # Column 3: Fax (if exists)
        if len(cols) > 2:
            col3_content = cols[2]
            fax_parts_raw = col3_content.stripped_strings
            faxes = []
            for part in fax_parts_raw:
                cleaned_part = part.strip()
                if re.fullmatch(r'[\d\s/-]+', cleaned_part) and len(re.sub(r'\D', '', cleaned_part)) >= 5:
                    faxes.append(re.sub(r'\s+', '', cleaned_part))
            item_data['fax_numbers'] = list(set(faxes)) # JS might not use this directly, but good to have
            # If your JS needs fax in a specific field, adjust here. For now, pro_numbers gets phones.

        query_name_part = re.sub(r'\W+', '_', item_data['office_name'])
        
        # This structure mimics the one used for other offices for easier integration
        item_package = {
            "query": f"q={category_id_for_query}_{query_name_part[:50]}",
            "office": item_data,
            "officials": [] # No separate officials table for these types
        }
        parsed_items_for_all_results.append(item_package)
        
    return parsed_items_for_all_results

def extract_contact_info(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    office_info = {"pro_numbers": [], "phone_numbers_direct": [], "fax": []} # Ensure keys exist
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
                   ("@" in line and "." in line and "epfindia.gov.in" in line): # More specific email check
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
            office_info['office_address'] = "\n".join(address_lines).strip() # Use \n for JS

            if 'office_email' not in office_info: office_info['office_email'] = None

            p_text_content_for_contacts = p_tag.get_text(separator='\n').strip()
            std_match = re.search(r"STD-Code\s*:\s*(\d+)", p_text_content_for_contacts)
            if std_match: office_info['std_code'] = std_match.group(1)
            
            toll_free_match = re.search(r"Toll Free No\.\s*:\s*(\d[\d\s-]+)", p_text_content_for_contacts) # Allow spaces/hyphens in toll-free
            if toll_free_match: office_info['toll_free_no'] = toll_free_match.group(1).strip()
            
            pro_match = re.search(r"PRO No\.\s*:\s*([\s\S]*?)(?=(?:Ph:|Fax:|$))", p_text_content_for_contacts)
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
                 if row_index == 0 and (row.find('th') or (not row.find_all('td') and len(row.find_all(text=True, recursive=False)) > 1 )) : # Skip if header row
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
                       ("@" in part and "." in part and "epfindia.gov.in" in part):
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
    all_results = []
    queries_for_detailed_fetch = []
    processed_href_for_dynamic_queries = set()

    print("Starting to fetch office categories and initial queries...")
    for category_id in OFFICE_CATEGORY_IDS:
        payload = {'id': category_id}
        print(f"Fetching data for category ID: {category_id}")
        try:
            response = requests.post(OFFICE_LIST_URL, data=payload, headers=HEADERS, timeout=30)
            response.raise_for_status()
            html_content_category_page = response.text

            if category_id in SPECIAL_CATEGORY_IDS:
                print(f"Processing '{category_id}' as a special category with direct listings...")
                special_items = extract_holiday_home_or_guest_house_info(html_content_category_page, category_id)
                if special_items:
                    all_results.extend(special_items)
                    print(f"Added {len(special_items)} items from special category '{category_id}'.")
            else:
                soup_category_page = BeautifulSoup(html_content_category_page, 'html.parser')
                item_list_ul = soup_category_page.find('ul', id='item-list')

                if item_list_ul:
                    links = item_list_ul.find_all('a', href=True)
                    for link in links:
                        href_value = link['href']
                        if href_value.startswith('#'):
                            query_value = href_value[1:] 
                            encoded_query_value = urllib.parse.quote_plus(query_value)
                            formatted_query = f"q={encoded_query_value}"
                            if formatted_query not in processed_href_for_dynamic_queries:
                                queries_for_detailed_fetch.append(formatted_query)
                                processed_href_for_dynamic_queries.add(formatted_query)
                    print(f"Found {len(links)} potential sub-queries for '{category_id}'.")
                else:
                    # Check if this non-special category might also have a tbl_body (fallback)
                    # This is an edge case not explicitly requested but could be a safeguard
                    potential_direct_items = extract_holiday_home_or_guest_house_info(html_content_category_page, category_id + "_direct")
                    if potential_direct_items:
                        print(f"Warning: Category '{category_id}' had no 'item-list' but contained direct items in 'tbl_body'. Adding them.")
                        all_results.extend(potential_direct_items)
                    else:
                        print(f"No 'item-list' or direct 'tbl_body' found for regular category ID: {category_id}. It might be an empty category or a different structure.")


            time.sleep(0.5) 
        except requests.exceptions.RequestException as e:
            print(f"HTTP Request error for category ID {category_id}: {e}")
            all_results.append({"query": f"q={category_id}_ERROR", "office": {}, "officials": [], "error": f"HTTP Error for category {category_id}: {str(e)}"})
        except Exception as e:
            print(f"General error processing category ID {category_id}: {e}")
            all_results.append({"query": f"q={category_id}_ERROR", "office": {}, "officials": [], "error": f"Parsing/General Error for category {category_id}: {str(e)}"})

    # Add predefined additional queries
    queries_for_detailed_fetch.extend(ADDITIONAL_QUERIES)
    # Remove duplicates from the list of queries that need detailed fetching
    final_queries_for_detail_fetch = sorted(list(set(queries_for_detailed_fetch)))
    print(f"\nTotal unique queries for detailed fetching: {len(final_queries_for_detail_fetch)}")

    # Process the queries requiring detailed fetch
    for query_param_str in final_queries_for_detail_fetch:
        print(f"Processing details for: {query_param_str}")
        try:
            response = requests.post(DETAIL_FETCH_URL, data=query_param_str, headers=HEADERS, timeout=30)
            response.raise_for_status()
            
            html_content_detail_page = response.text
            office_details, staff_contacts = extract_contact_info(html_content_detail_page)
            
            all_results.append({
                "query": query_param_str,
                "office": office_details,
                "officials": staff_contacts
            })
            time.sleep(0.5)
        except requests.exceptions.RequestException as e:
            print(f"HTTP Request error processing detail for {query_param_str}: {e}")
            all_results.append({"query": query_param_str, "office": {}, "officials": [], "error": f"HTTP Error on detail fetch: {str(e)}"})
        except Exception as e:
            print(f"General error processing detail for {query_param_str}: {e}")
            all_results.append({"query": query_param_str, "office": {}, "officials": [], "error": f"Parsing/General Error on detail fetch: {str(e)}"})

    output_filename = "contacts-data-master.json"
    with open(output_filename, 'w') as f:
        json.dump(all_results, f, indent=2)

    print(f"\nData fetching complete. All results saved to {output_filename}")
