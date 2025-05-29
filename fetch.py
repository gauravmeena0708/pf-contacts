import requests
import json
from bs4 import BeautifulSoup
import time

# Queries can be loaded from a file or defined here
queries = [
    "q=DELHI+[NORTH]",
    "q=DELHI+[SOUTH]",
    "q=LAXMI+NAGAR",
    # ... (Add all your queries from the HTML file's JavaScript array)
    # Example from your HAR:
    "q=TIRUPPUR" # [cite: 2473]
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
