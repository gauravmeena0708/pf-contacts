import requests
import json
from bs4 import BeautifulSoup
import time

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

# Correct target URL from the successful HAR log for get_directory.php
# The successful HAR log shows this request was to get_directory.php [cite: 2462]
target_url = "https://www.epfindia.gov.in/site_en/get_directory.php" 

headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', #
    'X-Requested-With': 'XMLHttpRequest', # [cite: 2462] (Observed in successful AJAX HAR)
    'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:138.0) Gecko/20100101 Firefox/138.0' # [cite: 4]
    # 'Referer': 'https://www.epfindia.gov.in/site_en/Contact_office_wise.php' # Referer from your first HAR [cite: 2088]
}

all_results = []

for query_param_str in queries:
    print(f"Processing: {query_param_str}")
    try:
        # The body should be the query string itself, e.g., "q=TIRUPPUR"
        # The 'data' parameter in requests.post will handle URL encoding if passed a dict,
        # but here we pass the already formatted string.
        response = requests.post(target_url, data=query_param_str, headers=headers, timeout=30)
        response.raise_for_status()  # Raises an exception for 4XX/5XX errors
        
        html_content = response.text
        soup = BeautifulSoup(html_content, 'html.parser')

        office_text = ''
        # Example from har.txt: office name is in <p><b>Office Name</b>...</p> [cite: 2147, 2483]
        office_p_tag = soup.find('p')
        if office_p_tag:
            office_b_tag = office_p_tag.find('b')
            if office_b_tag:
                office_text = office_b_tag.get_text(strip=True)
            else: # Fallback if <b> is not present directly under <p>
                office_text = office_p_tag.get_text(strip=True).splitlines()[0] if office_p_tag.get_text(strip=True) else "Office name not found"
        
        officials_data = []
        # Officials data is in <tbody id="tbl_body"> in <tr><td> elements [cite: 2149, 2486]
        table_body = soup.find('tbody', id='tbl_body')
        if table_body:
            rows = table_body.find_all('tr')
            for row in rows:
                cols = row.find_all('td')
                if len(cols) > 0: # Ensure it's a data row, not a header row
                    official_details = {}
                    for idx, col in enumerate(cols):
                        # Clean up text content, joining lines if <br> was used
                        official_details[str(idx)] = ' '.join(col.get_text(separator=' ', strip=True).split())
                    if any(official_details.values()): # Add only if there's some data
                        officials_data.append(official_details)
        
        all_results.append({
            "query": query_param_str, # Keep track of which query this result is for
            "office": office_text,
            "officials": officials_data
        })
        
        time.sleep(1) # Be respectful to the server, add a small delay

    except requests.exceptions.RequestException as e:
        print(f"Error processing {query_param_str}: {e}")
        all_results.append({"query": query_param_str, "office": "", "officials": [], "error": str(e)})
    except Exception as e:
        print(f"General error processing {query_param_str}: {e}")
        all_results.append({"query": query_param_str, "office": "", "officials": [], "error": str(e)})

# Save results to a JSON file
output_filename = "contacts-data.json" # This file will be committed to the repo
with open(output_filename, 'w') as f:
    json.dump(all_results, f, indent=2)

print(f"Data fetching complete. Saved to {output_filename}")
