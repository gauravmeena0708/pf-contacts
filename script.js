// <script>
        // DOM Elements
        const officeSearchInput = document.getElementById('officeSearchInput');
        const officeAutocompleteSuggestions = document.getElementById('officeAutocompleteSuggestions');
        
        const officeDetailsContainer = document.getElementById('officeDetailsContainer');
        const officialsListContainer = document.getElementById('officialsListContainer');
        
        const officialNameInput = document.getElementById('officialNameInput');
        const searchOfficialBtn = document.getElementById('searchOfficialBtn');
        const officialSearchResultsContainer = document.getElementById('officialSearchResultsContainer');
        
        const loadingIndicator = document.getElementById('loadingIndicator');
        const errorMessage = document.getElementById('errorMessage');

        const officeHierarchySidebar = document.getElementById('officeHierarchySidebar');
        const hierarchyDisplay = document.getElementById('hierarchyDisplay');

        let epfoContactsData = []; 
        let searchableOffices = []; 

        // --- Utility Functions ---
        function formatPhoneNumber(stdCode, number) {
            if (!number || String(number).trim() === '') return 'N/A';
            number = String(number).trim();
            return stdCode ? `(${stdCode}) ${number}` : number;
        }

        function createPhoneLink(stdCode, number) {
            if (!number || String(number).trim() === '') return 'N/A';
            number = String(number).trim();
            const fullNumber = stdCode ? `${String(stdCode).trim()}${number}` : number;
            if (!/^\d[\d\s-]*$/.test(fullNumber.replace(/\+/g, ''))) return formatPhoneNumber(stdCode, number);
            return `<a href="tel:${fullNumber.replace(/\s|-/g, '')}" class="phone-link">${formatPhoneNumber(stdCode, number)}</a>`;
        }

        function createEmailLink(email) {
            if (!email || email.trim() === '' || email.toLowerCase() === 'null') return 'N/A';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return email;
            return `<a href="mailto:${email.trim()}" class="email-link">${email.trim()}</a>`;
        }

        // --- Loading and Error States ---
        function showLoading(isLoading) {
            loadingIndicator.style.display = isLoading ? 'block' : 'none';
            errorMessage.style.display = 'none';
            if (isLoading) {
                officeSearchInput.disabled = true;
                officialNameInput.disabled = true;
                searchOfficialBtn.disabled = true;
            }
        }

        function showError(message = "Error loading data. Please ensure 'contacts-data-hierarchical.json' is available.") {
            showLoading(false);
            errorMessage.textContent = message;
            errorMessage.style.display = 'block';
            officeSearchInput.disabled = true;
            officialNameInput.disabled = true;
            searchOfficialBtn.disabled = true;
        }

        // --- Data Loading and Initialization ---
        async function loadContactData() {
            showLoading(true);
            try {
                // USE THE CORRECT FILENAME FOR YOUR HIERARCHICAL JSON
                const response = await fetch('contacts-data-hierarchical.json'); 
                if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
                const data = await response.json();
                if (!Array.isArray(data)) throw new Error("Data is not an array.");
                epfoContactsData = data;
                initializeUI();
                showLoading(false);
            } catch (error) {
                console.error('Error loading contact data:', error);
                showError(`Failed to load contact data: ${error.message}`);
            }
        }

        function initializeUI() {
            searchableOffices = epfoContactsData.map((contact, index) => {
                const displayName = contact.office_name_hierarchical || 
                                    (contact.office ? contact.office.office_name : `Entry ${index + 1}`);
                return {
                    name: displayName || "Unnamed Office",
                    query: contact.query, 
                    originalData: contact 
                };
            }).filter(office => office.name && office.name !== '-');

            officeSearchInput.disabled = false;
            officialNameInput.disabled = false;
            searchOfficialBtn.disabled = false;

            officeSearchInput.addEventListener('input', handleOfficeSearchInput);
            officialNameInput.addEventListener('keypress', e => e.key === 'Enter' && searchOfficialByDetails());
            searchOfficialBtn.addEventListener('click', searchOfficialByDetails);
            
            document.addEventListener('click', event => {
                if (!officeSearchInput.contains(event.target) && !officeAutocompleteSuggestions.contains(event.target)) {
                    officeAutocompleteSuggestions.innerHTML = '';
                    officeAutocompleteSuggestions.style.display = 'none';
                }
            });

            // Event delegation for dynamically created links
            officialSearchResultsContainer.addEventListener('click', handleDynamicLinkClick);
            hierarchyDisplay.addEventListener('click', handleDynamicLinkClick);
        }
        
        function handleDynamicLinkClick(event) {
            let target = event.target;
            // Check if the click is on an anchor or a child of an anchor with the specific class
            while (target != null && !target.classList.contains('dynamic-office-link')) {
                if (target === this) { // 'this' is the container (officialSearchResultsContainer or hierarchyDisplay)
                    target = null; // Click was not on a link or its child inside the container
                    break;
                }
                target = target.parentNode;
            }

            if (target && target.classList.contains('dynamic-office-link')) {
                event.preventDefault();
                const officeQuery = target.dataset.officequery;
                if (officeQuery) {
                    showOfficeByQuery(officeQuery);
                }
            }
        }


        // --- Office Search and Autocomplete ---
        function handleOfficeSearchInput() {
            const searchTerm = officeSearchInput.value.trim().toLowerCase();
            officeAutocompleteSuggestions.innerHTML = '';
            if (searchTerm.length < 2) {
                officeAutocompleteSuggestions.style.display = 'none';
                return;
            }
            const matchedOffices = searchableOffices.filter(office =>
                office.name.toLowerCase().includes(searchTerm)
            );
            if (matchedOffices.length > 0) {
                matchedOffices.slice(0, 10).forEach(office => {
                    const suggestionDiv = document.createElement('div');
                    suggestionDiv.textContent = office.name;
                    suggestionDiv.addEventListener('click', () => {
                        officeSearchInput.value = office.name;
                        officeAutocompleteSuggestions.innerHTML = '';
                        officeAutocompleteSuggestions.style.display = 'none';
                        displayOfficeDetails(office.originalData);
                    });
                    officeAutocompleteSuggestions.appendChild(suggestionDiv);
                });
                officeAutocompleteSuggestions.style.display = 'block';
            } else {
                officeAutocompleteSuggestions.style.display = 'none';
            }
        }
        
        // NEW: Function to display office by its query string
        function showOfficeByQuery(officeQueryString) {
            const officeData = epfoContactsData.find(contact => contact.query === officeQueryString);
            if (officeData) {
                officeSearchInput.value = officeData.office_name_hierarchical || (officeData.office ? officeData.office.office_name : '');
                // Clear autocomplete suggestions if any were open
                officeAutocompleteSuggestions.innerHTML = '';
                officeAutocompleteSuggestions.style.display = 'none';
                displayOfficeDetails(officeData);
            } else {
                console.warn(`Office with query ${officeQueryString} not found.`);
                officeDetailsContainer.innerHTML = `<p class="text-center text-red-500">Could not find details for the selected office link.</p>`;
                officialsListContainer.innerHTML = '';
                hierarchyDisplay.innerHTML = '';
                officeHierarchySidebar.style.display = 'none';
            }
        }

        // --- Display Office Details and Hierarchy ---
        function displayOfficeDetails(contactData) {
            officeDetailsContainer.innerHTML = '';
            officialsListContainer.innerHTML = '';
            hierarchyDisplay.innerHTML = '';
            officeHierarchySidebar.style.display = 'none';

            if (!contactData || !contactData.office) {
                officeDetailsContainer.innerHTML = '<p class="text-center text-red-500">Selected office data is incomplete or missing.</p>';
                return;
            }
            
            const office = contactData.office;
            let officeDisplayName = contactData.office_name_hierarchical || office.office_name;
            if (!officeDisplayName || officeDisplayName === '-') officeDisplayName = 'Office Details';

            let detailsHtml = `<div class="card bg-blue-50">
                                <h3 class="text-xl font-semibold text-blue-700 mb-3">${officeDisplayName}</h3>`;
            if (office.office_address && office.office_address !== 'STD-Code :') {
                 detailsHtml += `<p class="detail-item"><span class="detail-label">Address:</span> <span class="detail-value">${String(office.office_address).replace(/\n/g, '<br>')}</span></p>`;
            }
            if (office.office_email) {
                detailsHtml += `<p class="detail-item"><span class="detail-label">Email:</span> <span class="detail-value">${createEmailLink(office.office_email)}</span></p>`;
            }
            if (office.toll_free_no) {
                detailsHtml += `<p class="detail-item"><span class="detail-label">Toll-Free:</span> <span class="detail-value">${createPhoneLink(null, office.toll_free_no)}</span></p>`;
            }
            if (office.pro_numbers && office.pro_numbers.length > 0) {
                 detailsHtml += `<p class="detail-item"><span class="detail-label">Phone:</span> <span class="detail-value">${office.pro_numbers.map(num => createPhoneLink(office.std_code, num)).join(', ')}</span></p>`;
            }
             if (office.fax_numbers && office.fax_numbers.length > 0) { // For HH/GH
                 detailsHtml += `<p class="detail-item"><span class="detail-label">Fax:</span> <span class="detail-value">${office.fax_numbers.map(num => formatPhoneNumber(office.std_code, num)).join(', ')}</span></p>`;
            }
            detailsHtml += `</div>`;
            officeDetailsContainer.innerHTML = detailsHtml;

            if (contactData.officials && contactData.officials.length > 0) {
                displayOfficials(contactData.officials, office.std_code, officialsListContainer, "Officials at this Office");
            } else {
                officialsListContainer.innerHTML = ''; // Clear if no officials, or add "No officials" message
            }

            if (contactData.hierarchy_breadcrumbs && contactData.hierarchy_breadcrumbs.length > 0) {
                displayEnhancedHierarchy(contactData); // Pass full contactData for context
            }
        }
        
        function displayEnhancedHierarchy(currentContactData) {
            const breadcrumbs = currentContactData.hierarchy_breadcrumbs;
            if (!breadcrumbs || breadcrumbs.length === 0) {
                hierarchyDisplay.innerHTML = '';
                officeHierarchySidebar.style.display = 'none';
                return;
            }

            let hierarchyHtml = '<h3>Office Path</h3><ul>';
            breadcrumbs.forEach((crumb, index) => {
                // query_param from breadcrumb is the raw name. Construct full query for linking.
                const crumbQuery = `q=${encodeURIComponent(crumb.query_param)}`;
                hierarchyHtml += `<li class="parent-office"><a href="#" class="dynamic-office-link" data-officequery="${crumbQuery}">${crumb.name || 'Unnamed Level'}</a></li>`;
            });
            hierarchyHtml += '</ul>';

            // --- Placeholder logic for Children ---
            let childrenHtml = '<h3>Sub-Offices / Units:</h3><ul>';
            let foundChildren = false;
            const currentPathLength = breadcrumbs.length;
            const currentOfficeQueryParam = breadcrumbs[currentPathLength - 1].query_param; // Name of current office in its path

            epfoContactsData.forEach(contact => {
                if (contact.query === currentContactData.query) return; // Skip self

                if (contact.hierarchy_breadcrumbs && contact.hierarchy_breadcrumbs.length === currentPathLength + 1) {
                    let isChild = true;
                    for (let i = 0; i < currentPathLength; i++) {
                        if (contact.hierarchy_breadcrumbs[i].query_param !== breadcrumbs[i].query_param) {
                            isChild = false;
                            break;
                        }
                    }
                    // The immediate parent in child's breadcrumb should match current office's identifier
                    if (isChild && contact.hierarchy_breadcrumbs[currentPathLength-1].query_param === currentOfficeQueryParam) {
                         //This check needs to be more robust. The child's [currentPathLength-1] crumb should be the current office.
                         // The current office is identified by currentContactData.office_name_hierarchical or its query_param.
                         // A child's breadcrumb list will be [..., current_office_crumb, child_crumb]
                        if (contact.hierarchy_breadcrumbs[currentPathLength-1].query_param === currentContactData.office_name_hierarchical || // if query_param is name
                            `q=${encodeURIComponent(contact.hierarchy_breadcrumbs[currentPathLength-1].query_param)}` === currentContactData.query ) { // if query_param is part of query

                            const childName = contact.office_name_hierarchical || contact.office.office_name;
                            childrenHtml += `<li><a href="#" class="dynamic-office-link" data-officequery="${contact.query}">${childName}</a></li>`;
                            foundChildren = true;
                        }
                    }
                }
            });
            childrenHtml += '</ul>';
            if (foundChildren) hierarchyHtml += childrenHtml;

            // --- Placeholder logic for Sister Offices ---
            if (breadcrumbs.length > 1) { // Only if it has a parent
                let sistersHtml = '<h3>Other Offices in this Level:</h3><ul>';
                let foundSisters = false;
                const parentCrumb = breadcrumbs[breadcrumbs.length - 2]; // Immediate parent

                epfoContactsData.forEach(contact => {
                    if (contact.query === currentContactData.query) return; // Skip self
                    if (contact.hierarchy_breadcrumbs && contact.hierarchy_breadcrumbs.length === currentPathLength) {
                        if (contact.hierarchy_breadcrumbs[currentPathLength - 2]?.query_param === parentCrumb.query_param) {
                            const sisterName = contact.office_name_hierarchical || contact.office.office_name;
                            sistersHtml += `<li><a href="#" class="dynamic-office-link" data-officequery="${contact.query}">${sisterName}</a></li>`;
                            foundSisters = true;
                        }
                    }
                });
                sistersHtml += '</ul>';
                if (foundSisters) hierarchyHtml += sistersHtml;
            }

            hierarchyDisplay.innerHTML = hierarchyHtml;
            officeHierarchySidebar.style.display = 'block';
        }


        function displayOfficials(officials, stdCode, container, title) {
            if (!officials || officials.length === 0) {
                 container.innerHTML = ''; // Clear if previously had content
                return;
            }
            let officialsHtml = `<div class="card bg-green-50">
                                    <h4 class="text-lg font-semibold text-green-700 mb-4">${title}</h4>
                                    <ul class="space-y-4 custom-scrollbar max-h-96 overflow-y-auto pr-2">`;
            officials.forEach(official => {
                officialsHtml += `<li class="p-4 border border-gray-200 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow">
                                    <p class="font-semibold text-gray-800">${official.name || 'N/A'}</p>
                                    ${official.designation ? `<p class="text-sm text-gray-600">${official.designation}</p>` : ''}
                                    ${official.phone_numbers && official.phone_numbers.length > 0 ? `<p class="text-sm text-gray-500 mt-1">Phone: ${official.phone_numbers.map(num => createPhoneLink(stdCode, num)).join(', ')}</p>` : ''}
                                    ${official.email ? `<p class="text-sm text-gray-500">Email: ${createEmailLink(official.email)}</p>` : ''}
                                    ${official.fax && official.fax.length > 0 ? `<p class="text-sm text-gray-500">Fax: ${official.fax.map(num => formatPhoneNumber(stdCode, num)).join(', ')}</p>` : ''}
                                </li>`;
            });
            officialsHtml += `</ul></div>`;
            container.innerHTML = officialsHtml;
        }

        // --- Enhanced Official Search ---
        function searchOfficialByDetails() {
            const searchTerm = officialNameInput.value.trim().toLowerCase();
            officialSearchResultsContainer.innerHTML = ''; 
            if (searchTerm === "") {
                officialSearchResultsContainer.innerHTML = '<p class="text-center text-gray-500">Please enter a detail to search.</p>';
                return;
            }
            const results = [];
            epfoContactsData.forEach(contact => {
                if (contact.officials && contact.officials.length > 0) {
                    contact.officials.forEach(official => {
                        let isMatch = false;
                        const officeName = contact.office_name_hierarchical || (contact.office ? contact.office.office_name : 'N/A');
                        const officeStdCode = contact.office ? contact.office.std_code : null;
                        const officeQueryForLink = contact.query; // Get the query for the office

                        if (official.name?.toLowerCase().includes(searchTerm)) isMatch = true;
                        if (!isMatch && official.designation?.toLowerCase().includes(searchTerm)) isMatch = true;
                        if (!isMatch && official.email?.toLowerCase().includes(searchTerm)) isMatch = true;
                        if (!isMatch && official.phone_numbers?.some(phone => String(phone).includes(searchTerm))) isMatch = true;
                        if (!isMatch && official.fax?.some(faxNum => String(faxNum).includes(searchTerm))) isMatch = true;
                        
                        if (isMatch) {
                            results.push({ ...official, officeName, officeStdCode, officeQuery: officeQueryForLink });
                        }
                    });
                }
            });
            if (results.length === 0) {
                officialSearchResultsContainer.innerHTML = `<p class="no-results">No officials found matching "${officialNameInput.value}".</p>`;
            } else {
                 let resultsHtml = `<div class="card bg-yellow-50">
                                   <h3 class="text-xl font-semibold text-yellow-700 mb-3">Search Results (${results.length} found)</h3>
                                   <ul class="space-y-4 custom-scrollbar max-h-96 overflow-y-auto pr-2">`;
                results.forEach(official => {
                    // MODIFIED: Added hyperlink for officeName
                    const officeLink = official.officeQuery ? 
                        `<a href="#" class="dynamic-office-link" data-officequery="${official.officeQuery}">${official.officeName}</a>` : 
                        official.officeName;

                    resultsHtml += `<li class="p-4 border border-gray-200 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow">
                                        <p class="font-semibold text-gray-800">${official.name || 'N/A'}</p>
                                        ${official.designation ? `<p class="text-sm text-gray-600">${official.designation}</p>` : ''}
                                        <p class="text-sm text-gray-500 italic">Office: ${officeLink}</p>
                                        ${official.phone_numbers && official.phone_numbers.length > 0 ? `<p class="text-sm text-gray-500 mt-1">Phone: ${official.phone_numbers.map(num => createPhoneLink(official.officeStdCode, num)).join(', ')}</p>` : ''}
                                        ${official.email ? `<p class="text-sm text-gray-500">Email: ${createEmailLink(official.email)}</p>` : ''}
                                        ${official.fax && official.fax.length > 0 ? `<p class="text-sm text-gray-500">Fax: ${official.fax.map(num => formatPhoneNumber(official.officeStdCode, num)).join(', ')}</p>` : ''}
                                    </li>`;
                });
                resultsHtml += `</ul></div>`;
                officialSearchResultsContainer.innerHTML = resultsHtml;
            }
        }
        document.addEventListener('DOMContentLoaded', loadContactData);
// </script>
