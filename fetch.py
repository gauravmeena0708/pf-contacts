import requests
import json
from bs4 import BeautifulSoup
import time
import re

# Queries can be loaded from a file or defined here
queries = [
      "q=DELHI+[NORTH]",
      "q=DELHI+[SOUTH]",
      "q=LAXMI+NAGAR",
      "q=DEHRADUN",
      "q=HALDWANI",
      "q=ANDHRA+PRADESH,+TELANGANA+&+ORISSA",
      "q=GUNTUR",
      "q=CUDAPA",
      "q=RAJAHMUNDRY",
      "q=VISAKHAPATNAM",
      "q=D.O+-+GUNTUR+DISTRICT",
      "q=D.O+-+PRAKASAM+DISTRICT",
      "q=D.O+-+KRISHNA+DISTRICT",
      "q=D.O+-+ANANTAPUR",
      "q=D.O+-+KADAPA",
      "q=D.O+-+KURNOOL",
      "q=D.O+-+NELLORE",
      "q=D.O+-+TIRUPATI",
      "q=D.O+-+BHIMAVARAM",
      "q=D.O+-+ELURU",
      "q=D.O+-+KAKINADA",
      "q=D.O+-+SRIKAKULAM",
      "q=HYDERABAD",
      "q=KUKATPALLI",
      "q=PATANCHERU",
      "q=SIDDIPET",
      "q=NIZAMABAD",
      "q=KARIMNAGAR",
      "q=WARANGAL",
      "q=D.O+-+ADILABAD",
      "q=D.O+-+KHAMMAM",
      "q=BHUBANESHWAR",
      "q=BRAHMAPUR",
      "q=ROURKELA",
      "q=KEONJHAR",
      "q=KARNATAKA+&+GOA",
      "q=BANGALORE",
      "q=RAJARAJESHWARI+NAGAR",
      "q=YELAHANKA",
      "q=GULBARGA",
      "q=BELLARY",
      "q=HUBLI",
      "q=RAICHUR",
      "q=D.O+-+BIDAR",
      "q=D.O+-+BIJAPUR",
      "q=D.O+-+KARAWAR",
      "q=D.O+-+BELAGAVI",
      "q=MANGALORE",
      "q=CHIKAMAGALUR",
      "q=MYSORE",
      "q=SHIMOGA",
      "q=UDUPI",
      "q=D.O+-+HASSAN",
      "q=D.O+-+MANDYA",
      "q=D.O+-+DAVANGERE",
      "q=D.O+-+MADIKERI",
      "q=PEENYA",
      "q=BOMMASANDRA",
      "q=K+R+PURAM+(WHITEFIELD)",
      "q=TUMKUR",
      "q=GOA",
      "q=HARYANA+&+RAJASTHAN",
      "q=FARIDABAD",
      "q=KARNAL",
      "q=D.O+-+AMBALA",
      "q=D.O+-+PANIPAT",
      "q=D.O+-+SONIPAT",
      "q=D.O+-+YAMUNANAGAR",
      "q=GURGAON",
      "q=ROHTAK",
      "q=D.O+-+HISAR",
      "q=JAIPUR",
      "q=JODHPUR",
      "q=KOTA",
      "q=UDAIPUR",
      "q=D.O+-+AJMER",
      "q=D.O+-+ALWAR",
      "q=D.O+-+BHARATPUR",
      "q=D.O+-+JHUNJHUNUN",
      "q=D.O+-+BHILWARA",
      "q=PUNJAB+&+HIMACHAL+PRADESH",
      "q=CHANDIGARH",
      "q=BHATINDA",
      "q=D.O+-+MOGA",
      "q=D.O+-+SANGRUR",
      "q=D.O+-+MANDI+GOVINDAGARH",
      "q=D.O+-+PATIALA",
      "q=LUDHIANA",
      "q=AMRITSAR",
      "q=JALANDHAR",
      "q=D.O+-+HOSHIARPUR",
      "q=D.O+-+PHAGWARA",
      "q=SHIMLA",
      "q=GUJRAT+&+MADHYA+PRADESH",
      "q=AHMEDABAD",
      "q=NARODA",
      "q=RAJKOT",
      "q=VATWA",
      "q=D.O+-+HIMMATNAGAR",
      "q=D.O+-+GANDHIDHAM",
      "q=D.O+-+JAMNAGAR",
      "q=D.O+-+JUNAGADH",
      "q=D.O+-+SURENDRANAGAR",
      "q=VADODARA",
      "q=SURAT",
      "q=VAPI",
      "q=BHARUCH",
      "q=INDORE",
      "q=BHOPAL",
      "q=GWALIOR",
      "q=JABALPUR",
      "q=UJJAIN",
      "q=SAGAR",
      "q=D.O+-+ITARASI",
      "q=D.O+-+CHHINDWARA",
      "q=D.O+-+SATNA",
      "q=D.O+-+RATLAM",
      "q=MAHARASHTRA+&+CHATTISGARH",
      "q=BANDRA+(MUMBAI-I)",
      "q=KANDIVALI",
      "q=NASIK",
      "q=D.O+-+AHMADNAGAR",
      "q=D.O+-+JALGAON",
      "q=NAGPUR",
      "q=NAGPUR+(ANNEX+BLDG)",
      "q=AKOLA",
      "q=AURANGABAD",
      "q=D.O+-+AMRAVATI",
      "q=D.O+-+CHANDRAPUR",
      "q=PUNE",
      "q=PUNE[ANNEX+BLDG(S.A.O)]",
      "q=KOLHAPUR",
      "q=SOLAPUR",
      "q=THANE+(MUMBAI-II)",
      "q=VASHI",
      "q=RAIPUR+(CHATTISGARH)",
      "q=D.O+-+BILASPUR",
      "q=VIGILANCE+WING",
      "q=ZONAL+DIRECTORATES,+WEST+ZONE",
      "q=ZONAL+DIRECTORATES,+SOUTH+ZONE",
      "q=ZONAL+DIRECTORATES,+NORTH+ZONE",
      "q=ZONAL+DIRECTORATES,+EAST+ZONE",
      "q=PERMANENT+INQUIRY+OFFICER,+WEST+ZONE",
      "q=PERMANENT+INQUIRY+OFFICER,+SOUTH+ZONE",
      "q=PERMANENT+INQUIRY+OFFICER,+NORTH+ZONE",
      "q=UTTAR+PRADESH+&+BIHAR",
      "q=KANPUR",
      "q=BAREILLY",
      "q=GORAKHPUR",
      "q=LUCKNOW",
      "q=VARANASI",
      "q=ALLAHABAD",
      "q=D.O+-+MORADABAD",
      "q=MEERUT",
      "q=NOIDA",
      "q=AGRA",
      "q=D.O+-+ALIGARH",
      "q=PATNA",
      "q=BHAGALPUR",
      "q=MUZAFFARPUR",
      "q=D.O+-+KATIHAR",
      "q=D.O+-+MUNGER",
      "q=D.O+-+DARBHANGA",
      "q=HEAD+OFFICE",
      "q=NATIONAL+DATA+CENTRE",
      "q=TAMILNADU+&+KERALA",
      "q=COIMBATORE",
      "q=SALEM",
      "q=TRICHY",
      "q=D.O+-+COONOOR",
      "q=D.O+-+OOTY",
      "q=D.O+-+POLLACHI",
      "q=D.O+-+TIRUPPUR",
      "q=CHENNAI",
      "q=AMBATTUR",
      "q=MADURAI",
      "q=TIRUNELVELI",
      "q=NAGERCOIL",
      "q=D.O+-+SIVAKASI",
      "q=D.O+-+DINDIGUL",
      "q=D.O+-+TIRUNELVELI",
      "q=D.O+-+TUTICORIN",
      "q=TAMBARAM",
      "q=VELLORE",
      "q=PUDUCHERRY",
      "q=THIRUVANANTHAPURAM",
      "q=KANNUR",
      "q=KOCHI",
      "q=KOTTAYAM",
      "q=KOZHIKODE+(CALICUT)",
      "q=KOLLAM",
      "q=D.O+-+ALLEYPPEY",
      "q=D.O+-+THRISSUR",
      "q=D.O+-+MUNNAR",
      "q=WEST+BENGAL,+NER+&+JHARKHAND",
      "q=KOLKATA",
      "q=BARRACKPORE",
      "q=DURGAPUR",
      "q=HOWRAH",
      "q=PARK+STREET",
      "q=PORT+BLAIR",
      "q=HOWRAH+(ANNEX+BLDG)",
      "q=D.O+-+SRIRAMPORE",
      "q=D.O+-+MEDINIPUR",
      "q=JALPAIGURI",
      "q=DARJEELING",
      "q=JANGIPUR",
      "q=SILIGURI",
      "q=D.O+-+ALIPURDUAR",
      "q=D.O+-+MALBAZAR",
      "q=D.O+-+GANGTOK",
      "q=GUWAHATI",
      "q=AGARTALA",
      "q=SHILLONG",
      "q=TINSUKIA",
      "q=RANCHI",
      "q=JAMSHEDPUR",
      "q=INTERNAL+AUDIT+WING",
      "q=ZONAL+AUDIT+PARTIES,+EAST+ZONE",
      "q=ZONAL+AUDIT+PARTIES,+NORTH+ZONE",
      "q=ZONAL+AUDIT+PARTIES,+SOUTH+ZONE",
      "q=ZONAL+AUDIT+PARTIES,+WEST+ZONE"
    ]

target_url = "https://www.epfindia.gov.in/site_en/get_directory.php" 

headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 
    'X-Requested-With': 'XMLHttpRequest', 
    'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:138.0) Gecko/20100101 Firefox/138.0',
    'Referer': 'https://www.epfindia.gov.in/site_en/Contact_us.php' 
}

from bs4 import BeautifulSoup
import re

def clean_email(email_text):
    """Cleans the email text by replacing [at] with @ and [dot] with ."""
    if email_text:
        return email_text.replace("[at]", "@").replace("[dot]", ".")
    return None

def extract_contact_info(html_content):
    """
    Extracts office name, address, general contact, and individual contact details
    from the provided HTML content.
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    
    office_info = {}
    individual_contacts = []

    # --- Extracting from the <p> tag ---
    p_tag = soup.find('p')
    if p_tag:
        # Get all text content, then split by <br/> tags
        # We use .stripped_strings to get text nodes without extra whitespace
        p_lines = list(p_tag.stripped_strings)
        
        if p_lines:
            office_info['office_name'] = p_lines[0]
            
            # Address lines are usually after the name and before the email
            address_lines = []
            email_line_index = -1
            for i, line in enumerate(p_lines):
                if "[at]" in line and "[dot]" in line: # Heuristic for email
                    email_line_index = i
                    break
                if i > 0 : # Skip office name
                    address_lines.append(line)
            
            if email_line_index != -1:
                office_info['office_address'] = " ".join(address_lines[:email_line_index-1]).strip() # Exclude the email line itself
                office_info['office_email'] = clean_email(p_lines[email_line_index])
            else: # If no email found in p_lines, assume all are address lines after name
                 office_info['office_address'] = " ".join(address_lines).strip()
                 office_info['office_email'] = None


            # Extracting STD code, Toll-Free, PRO numbers (more robustly)
            p_text_content = p_tag.get_text(separator='\n').strip()
            
            std_match = re.search(r"STD-Code\s*:\s*(\d+)", p_text_content)
            if std_match:
                office_info['std_code'] = std_match.group(1)

            toll_free_match = re.search(r"Toll Free No\.\s*:\s*(\d+)", p_text_content)
            if toll_free_match:
                office_info['toll_free_no'] = toll_free_match.group(1)
            
            # PRO numbers can be tricky due to formatting, this is an attempt
            pro_match = re.search(r"PRO No\.\s*:\s*([\d\n\s]+)", p_text_content)
            if pro_match:
                pro_numbers_raw = pro_match.group(1).strip()
                office_info['pro_numbers'] = [num.strip() for num in pro_numbers_raw.split('\n') if num.strip().isdigit()]


    # --- Extracting from the <table> ---
    table = soup.find('table')
    if table:
        rows = table.find_all('tr', class_='border_bottom') # Only process data rows
        
        for row in rows:
            cols = row.find_all('td')
            contact_detail = {}
            
            if len(cols) >= 2: # Expecting at least name and phone/email column
                # Column 1: Name and Designation
                name_designation_parts = [text for text in cols[0].stripped_strings]
                if name_designation_parts:
                    contact_detail['name'] = name_designation_parts[0]
                    if len(name_designation_parts) > 1:
                        contact_detail['designation'] = name_designation_parts[1]
                    else:
                        contact_detail['designation'] = None
                else:
                    contact_detail['name'] = None
                    contact_detail['designation'] = None

                # Column 2: Phone numbers and Email
                # This column can have multiple lines for phone numbers and an email
                contact_info_parts = [text.strip() for text in cols[1].stripped_strings if text.strip()]
                
                phone_numbers = []
                email = None
                
                for part in contact_info_parts:
                    if "[at]" in part and "[dot]" in part:
                        email = clean_email(part)
                    elif re.match(r'^[\d\s]+$', part): # Check if it's likely a phone number
                        # Remove any internal spaces from phone numbers if necessary
                        phone_numbers.append(part.replace(" ", "")) 
                
                contact_detail['phone_numbers'] = list(set(phone_numbers)) # Use set to remove duplicates
                contact_detail['email'] = email

                # Column 3: Fax (if present)
                if len(cols) >= 3:
                    fax_parts = [text.strip() for text in cols[2].stripped_strings if text.strip()]
                    if fax_parts:
                         # Check if it's likely a fax number
                        fax_numbers = [part.replace(" ", "") for part in fax_parts if re.match(r'^[\d\s]+$', part)]
                        if fax_numbers:
                             contact_detail['fax'] = list(set(fax_numbers))

                if contact_detail.get('name'): # Only add if a name was found
                    individual_contacts.append(contact_detail)

    return office_info, individual_contacts



all_results = []

for query_param_str in queries:
    print(f"Processing: {query_param_str}")
    try:
        response = requests.post(target_url, data=query_param_str, headers=headers, timeout=30)
        response.raise_for_status()
        
        html_content = response.text
        office_details, staff_contacts = extract_contact_info(html_content)
        
        all_results.append({
            "query": query_param_str,
            "office": office_details,
            "officials": staff_contacts
        })
        
        time.sleep(0.5) # Reduced sleep time, adjust if rate limiting occurs

    except requests.exceptions.RequestException as e:
        print(f"HTTP Request error processing {query_param_str}: {e}")
        all_results.append({"query": query_param_str, "office": "Error fetching", "officials": [], "error": str(e)})
    except Exception as e:
        print(f"General error processing {query_param_str}: {e}")
        all_results.append({"query": query_param_str, "office": "Error parsing", "officials": [], "error": str(e)})

output_filename = "contacts-data.json"
with open(output_filename, 'w') as f:
    json.dump(all_results, f, indent=2)

print(f"Data fetching complete. Saved to {output_filename}")
