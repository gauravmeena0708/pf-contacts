// DOM Elements
const officeSearchInput = document.getElementById('officeSearchInput');
const officeAutocompleteSuggestions = document.getElementById('officeAutocompleteSuggestions');
const searchOfficeBtn = document.getElementById('searchOfficeBtn');

const officeDetailsContainer = document.getElementById('officeDetailsContainer');
const officialsListContainer = document.getElementById('officialsListContainer');

const officialNameInput = document.getElementById('officialNameInput');
const searchOfficialBtn = document.getElementById('searchOfficialBtn');
const officialSearchResultsContainer = document.getElementById('officialSearchResultsContainer');

const loadingIndicator = document.getElementById('loadingIndicator');
const errorMessage = document.getElementById('errorMessage');

const officeHierarchySidebar = document.getElementById('officeHierarchySidebar');
const hierarchyDisplay = document.getElementById('hierarchyDisplay');
const officeMapContainer = document.getElementById('officeMapContainer');
const mapPlaceholderMsg = document.getElementById('mapPlaceholderMsg');


let epfoContactsData = [];
let searchableOffices = [];
let officeMap = null;
let mapMarkersGroup = null;

// --- Utility Functions ---
function formatPhoneNumber(stdCode, number) {
    if (!number || String(number).trim() === '') return 'N/A';
    number = String(number).trim();
    return stdCode ? `(${String(stdCode).trim()}) ${number}` : number;
}

function createPhoneLink(stdCode, number) {
    if (!number || String(number).trim() === '') return 'N/A';
    number = String(number).trim();
    const fullNumber = stdCode ? `${String(stdCode).trim()}${number}` : number;
    // Simple regex to check if it looks like a phone number
    if (!/^\d[\d\s-]*$/.test(fullNumber.replace(/\+/g, ''))) return formatPhoneNumber(stdCode, number);
    return `<a href="tel:${fullNumber.replace(/\s|-/g, '')}" class="phone-link">${formatPhoneNumber(stdCode, number)}</a>`;
}

function createEmailLink(email) {
    if (!email || email.trim() === '' || email.toLowerCase() === 'null') return 'N/A';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return email.trim();
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
        searchOfficeBtn.disabled = true;
    }
}

function showError(message = "Error loading data.") {
    showLoading(false);
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    officeSearchInput.disabled = true;
    officialNameInput.disabled = true;
    searchOfficialBtn.disabled = true;
    searchOfficeBtn.disabled = true;
}

// --- Data Loading and Initialization ---
async function loadContactData() {
    showLoading(true);
    try {
        const [contactsResponse, geocodesResponse] = await Promise.all([
            fetch('contacts-data.json'),
            fetch('geocodes.json')
        ]);

        if (!contactsResponse.ok) throw new Error(`HTTP error! Status: ${contactsResponse.status} - Could not fetch contacts-data.json.`);
        if (!geocodesResponse.ok) throw new Error(`HTTP error! Status: ${geocodesResponse.status} - Could not fetch geocodes.json.`);

        const contacts = await contactsResponse.json();
        const geocodes = await geocodesResponse.json();

        if (!Array.isArray(contacts)) throw new Error("Contacts data is not a valid array.");
        if (typeof geocodes !== 'object' || geocodes === null) throw new Error("Geocodes data is not a valid object.");

        // Integrate geocodes into the main data structure
        epfoContactsData = contacts.map(contact => {
            if (contact.office_name_hierarchical && geocodes[contact.office_name_hierarchical]) {
                const [lat, lon] = geocodes[contact.office_name_hierarchical];
                if (!contact.office) contact.office = {}; // Ensure office object exists
                contact.office.latitude = lat;
                contact.office.longitude = lon;
            }
            return contact;
        });

        initializeUI();
        initializeOfficeMap();
        
        // Handle deep links or show default view
        if (!handleUrlParameters()) {
             // Show Head Office by default if no parameters are in the URL
            const headOffice = epfoContactsData.find(c => c.query === 'q=HEAD+OFFICE');
            if (headOffice) {
                showOfficeByQuery('q=HEAD+OFFICE');
            }
        }


        showLoading(false);
    } catch (error) {
        console.error('Error loading or processing data:', error);
        showError(`Failed to load data: ${error.message}`);
    }
}


function initializeUI() {
    // Prepare a list of offices for search and autocomplete
    searchableOffices = epfoContactsData.map((contact, index) => {
        const displayName = contact.office_name_hierarchical || (contact.office ? contact.office.office_name : `Entry ${index + 1}`);
        return {
            name: displayName || "Unnamed Office",
            query: contact.query,
            originalData: contact
        };
    }).filter(office => office.name && office.name.trim() !== '-' && office.name.trim() !== '');

    // Enable UI elements
    officeSearchInput.disabled = false;
    officialNameInput.disabled = false;
    searchOfficialBtn.disabled = false;
    searchOfficeBtn.disabled = false;

    // Attach event listeners
    officeSearchInput.addEventListener('input', handleOfficeSearchInput);
    officeSearchInput.addEventListener('keypress', e => e.key === 'Enter' && searchOfficeByName());
    searchOfficeBtn.addEventListener('click', searchOfficeByName);

    officialNameInput.addEventListener('keypress', e => e.key === 'Enter' && searchOfficialByDetails());
    searchOfficialBtn.addEventListener('click', searchOfficialByDetails);

    // Global click listener to hide autocomplete
    document.addEventListener('click', event => {
        if (officeSearchInput && officeAutocompleteSuggestions) {
            if (!officeSearchInput.contains(event.target) && !officeAutocompleteSuggestions.contains(event.target)) {
                officeAutocompleteSuggestions.innerHTML = '';
                officeAutocompleteSuggestions.style.display = 'none';
            }
        }
    });
    
    // Add event listeners for dynamic links
    officialSearchResultsContainer.addEventListener('click', handleDynamicLinkClick);
    if (hierarchyDisplay) hierarchyDisplay.addEventListener('click', handleDynamicLinkClick);
}

// --- URL Parameter Handling ---
function updateUrl(params) {
    const url = new URL(window.location);
    url.search = new URLSearchParams(params).toString();
    window.history.pushState({
        path: url.href
    }, '', url.href);
}

function handleUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const officerName = urlParams.get('officer');
    const officeName = urlParams.get('office');

    if (officerName) {
        officialNameInput.value = officerName;
        searchOfficialByDetails();
        gtag('event', 'search', { 'search_term': officerName, 'search_type': 'officer_url_param' });
        return true;
    } else if (officeName) {
        officeSearchInput.value = officeName;
        searchOfficeByName();
        gtag('event', 'search', { 'search_term': officeName, 'search_type': 'office_url_param' });
        return true;
    }
    return false;
}


// --- Dynamic Content Functions ---
function handleDynamicLinkClick(event) {
    let target = event.target;
    while (target != null && !target.classList.contains('dynamic-office-link')) {
        if (target === event.currentTarget) {
            target = null;
            break;
        }
        target = target.parentNode;
    }
    if (target && target.classList.contains('dynamic-office-link')) {
        event.preventDefault();
        const officeQuery = target.dataset.officequery;
        if (officeQuery) showOfficeByQuery(officeQuery);
    }
}

// --- Map Initialization and Functions ---
function focusMapOnOffice(office) {
    if (officeMap && office && office.latitude != null && office.longitude != null) {
        const lat = parseFloat(office.latitude);
        const lon = parseFloat(office.longitude);
        if (!isNaN(lat) && !isNaN(lon)) {
            officeMap.setView([lat, lon], 12);
            mapMarkersGroup.eachLayer(function(layer) {
                if (layer.getLatLng().lat === lat && layer.getLatLng().lng === lon) {
                    layer.openPopup();
                }
            });
        }
    }
}

function initializeOfficeMap() {
    if (!epfoContactsData || epfoContactsData.length === 0 || !L) {
        if (officeMapContainer) officeMapContainer.innerHTML = '<p class="text-center p-4">Map data unavailable.</p>';
        return;
    }

    if (officeMap) officeMap.remove(); 
    if(mapPlaceholderMsg) mapPlaceholderMsg.style.display = 'none';
    
    officeMap = L.map('officeMapContainer').setView([22, 77], 5); 
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
    }).addTo(officeMap);

    mapMarkersGroup = L.layerGroup().addTo(officeMap);

    const validOfficeLocations = [];

    epfoContactsData.forEach(contact => {
        if (contact.office && contact.office.latitude != null && contact.office.longitude != null) {
            const lat = parseFloat(contact.office.latitude);
            const lon = parseFloat(contact.office.longitude);
            if (!isNaN(lat) && !isNaN(lon)) {
                const officeName = contact.office_name_hierarchical || contact.office.office_name || "EPFO Office";
                const marker = L.marker([lat, lon]);
                marker.bindPopup(`<b>${officeName}</b>`);
                // When marker is clicked, show details and scroll the content view
                marker.on('click', () => {
                    showOfficeByQuery(contact.query);
                    
                });
                mapMarkersGroup.addLayer(marker);
                validOfficeLocations.push([lat, lon]);
            }
        }
    });

    if (validOfficeLocations.length > 0) {
        officeMap.fitBounds(validOfficeLocations, {
            padding: [50, 50]
        });
    }
}


// --- Office Search ---
function searchOfficeByName() {
    const searchTerm = officeSearchInput.value.trim();
    if (!searchTerm) {
        officeDetailsContainer.innerHTML = '<p class="no-results">Please enter an office name.</p>';
        officialsListContainer.innerHTML = '';
        officeHierarchySidebar.style.display = 'none';
        return;
    }
    const matchedOffice = searchableOffices.find(o => o.name.toLowerCase() === searchTerm.toLowerCase());

    if (matchedOffice) {
        displayOfficeDetails(matchedOffice.originalData);
        focusMapOnOffice(matchedOffice.originalData.office);
        updateUrl({ office: searchTerm });
        gtag('event', 'search', { 'search_term': searchTerm, 'search_type': 'office_button' });
        document.getElementById('officeDetailsContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        officeDetailsContainer.innerHTML = `<p class="no-results">No office found matching "${searchTerm}".</p>`;
        officialsListContainer.innerHTML = '';
        officeHierarchySidebar.style.display = 'none';
    }
    officeAutocompleteSuggestions.style.display = 'none';
}


function handleOfficeSearchInput() {
    const searchTerm = officeSearchInput.value.trim().toLowerCase();
    officeAutocompleteSuggestions.innerHTML = '';
    if (searchTerm.length < 2) {
        officeAutocompleteSuggestions.style.display = 'none';
        return;
    }
    const matchedOffices = searchableOffices.filter(o => o.name && o.name.toLowerCase().includes(searchTerm));
    if (matchedOffices.length > 0) {
        matchedOffices.slice(0, 10).forEach(office => {
            const suggestionDiv = document.createElement('div');
            suggestionDiv.textContent = office.name;
            suggestionDiv.addEventListener('click', () => {
                officeSearchInput.value = office.name;
                officeAutocompleteSuggestions.style.display = 'none';
                displayOfficeDetails(office.originalData);
                focusMapOnOffice(office.originalData.office);
                updateUrl({ office: office.name });
                gtag('event', 'search', { 'search_term': office.name, 'search_type': 'office_autocomplete' });
                 document.getElementById('officeDetailsContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });

            });
            officeAutocompleteSuggestions.appendChild(suggestionDiv);
        });
        officeAutocompleteSuggestions.style.display = 'block';
    } else {
        officeAutocompleteSuggestions.style.display = 'none';
    }
}

function showOfficeByQuery(officeQueryString) {
    const officeData = epfoContactsData.find(contact => contact.query === officeQueryString);
    document.getElementById('officeDisplaySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (officeData) {
        const officeName = officeData.office_name_hierarchical || (officeData.office ? officeData.office.office_name : '');
        officeSearchInput.value = officeName;
        officeAutocompleteSuggestions.style.display = 'none';
        displayOfficeDetails(officeData);
        focusMapOnOffice(officeData.office);
        updateUrl({ office: officeName });
        document.getElementById('contentColumn')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        officeDetailsContainer.innerHTML = `<p class="text-center text-red-500">Could not find details for the linked office.</p>`;
        officialsListContainer.innerHTML = '';
        hierarchyDisplay.innerHTML = '';
        officeHierarchySidebar.style.display = 'none';
    }
}

// --- Display Functions ---
function displayOfficeDetails(contactData) {
    officeDetailsContainer.innerHTML = '';
    officialsListContainer.innerHTML = '';
    hierarchyDisplay.innerHTML = '';
    officeHierarchySidebar.style.display = 'none';

    if (!contactData || !contactData.office) {
        officeDetailsContainer.innerHTML = '<p class="text-center text-red-500">Selected office data is incomplete.</p>';
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
     if (office.phone_numbers_direct && office.phone_numbers_direct.length > 0) {
        detailsHtml += `<p class="detail-item"><span class="detail-label">Direct:</span> <span class="detail-value">${office.phone_numbers_direct.map(num => createPhoneLink(office.std_code, num)).join(', ')}</span></p>`;
    }
    if (office.fax_numbers && office.fax_numbers.length > 0) {
        detailsHtml += `<p class="detail-item"><span class="detail-label">Fax:</span> <span class="detail-value">${office.fax_numbers.map(num => formatPhoneNumber(office.std_code, num)).join(', ')}</span></p>`;
    }
    detailsHtml += `</div>`;
    officeDetailsContainer.innerHTML = detailsHtml;

    if (contactData.officials && contactData.officials.length > 0) {
        displayOfficials(contactData.officials, office.std_code, officialsListContainer, "Officials at this Office");
    } else {
        officialsListContainer.innerHTML = '<p class="no-results">No officials listed for this office.</p>';
    }

    // Call the new, enhanced hierarchy display function
    displayEnhancedHierarchy(contactData);
}

// ** NEW AND IMPROVED HIERARCHY FUNCTION **
function displayEnhancedHierarchy(currentContactData) {
    const breadcrumbs = currentContactData.hierarchy_breadcrumbs;
    hierarchyDisplay.innerHTML = ''; // Clear previous content

    if (!breadcrumbs || breadcrumbs.length === 0) {
        officeHierarchySidebar.style.display = 'none';
        return;
    }

    const currentLevel = breadcrumbs.length;
    const isHeadOffice = breadcrumbs[0].query_param === 'HO';
    // Note: Top-level categories like "HH" or "GH" might have a length of 1 but aren't ZOs.
    const isZonalOffice = !isHeadOffice && currentLevel === 1 && !["HH", "GH", "ApexBodies"].includes(breadcrumbs[0].query_param) ;
    const isRegionalOffice = !isHeadOffice && currentLevel === 2;
    const isDistrictOffice = !isHeadOffice && currentLevel > 2;

    let hierarchyHtml = '<h3>Office Hierarchy</h3>';
    
    // Find and display parent office link
    if (!isHeadOffice && breadcrumbs.length > 1) {
        const parentBreadcrumb = breadcrumbs[breadcrumbs.length - 2];
        const parentContact = epfoContactsData.find(c => c.query.endsWith(`=${parentBreadcrumb.query_param}`));
        if (parentContact) {
            hierarchyHtml += `
                <h4>Parent Office</h4>
                <ul>
                    <li class="parent-office">
                        <a href="#" class="dynamic-office-link" data-officequery="${parentContact.query}">
                            ${parentContact.office_name_hierarchical}
                        </a>
                    </li>
                </ul>`;
        }
    }

    // Helper to create lists of offices
    function createOfficeListHtml(officeArray, title) {
        if (!officeArray || officeArray.length === 0) return '';
        let listHtml = `<h4>${title}</h4><ul>`;
        officeArray.forEach(office => {
            const officeName = office.office_name_hierarchical || office.office.office_name;
            listHtml += `<li><a href="#" class="dynamic-office-link" data-officequery="${office.query}">${officeName}</a></li>`;
        });
        listHtml += '</ul>';
        return listHtml;
    }

    // Find and display sibling/child offices based on level
    if (isHeadOffice) {
        const zonalOffices = epfoContactsData.filter(c => c.hierarchy_breadcrumbs?.length === 1 && c.query !== currentContactData.query && !["HH", "GH", "ApexBodies"].includes(c.hierarchy_breadcrumbs[0].query_param));
        hierarchyHtml += createOfficeListHtml(zonalOffices, "Zonal Offices");
    } else if (isZonalOffice) {
        const childRos = epfoContactsData.filter(c =>
            c.hierarchy_breadcrumbs?.length === 2 &&
            c.hierarchy_breadcrumbs[0].query_param === currentContactData.hierarchy_breadcrumbs[0].query_param
        );
        hierarchyHtml += createOfficeListHtml(childRos, "Regional Offices");
    } else if (isRegionalOffice) {
        const parentQueryParam = currentContactData.hierarchy_breadcrumbs[0].query_param;
        const currentQueryParam = currentContactData.hierarchy_breadcrumbs[1].query_param;
        // Sister ROs
        const sisterRos = epfoContactsData.filter(c =>
            c.query !== currentContactData.query &&
            c.hierarchy_breadcrumbs?.length === 2 &&
            c.hierarchy_breadcrumbs[0].query_param === parentQueryParam
        );
         if(sisterRos.length > 0) hierarchyHtml += createOfficeListHtml(sisterRos, "Other Regional Offices");

        // Child DOs
        const childDos = epfoContactsData.filter(c =>
            c.hierarchy_breadcrumbs?.length === 3 &&
            c.hierarchy_breadcrumbs[1].query_param === currentQueryParam
        );
         if(childDos.length > 0) hierarchyHtml += createOfficeListHtml(childDos, "District Offices");
         
    } else if (isDistrictOffice) {
         const parentQueryParam = currentContactData.hierarchy_breadcrumbs[currentContactData.hierarchy_breadcrumbs.length - 2].query_param;
        // Sister DOs
        const sisterDos = epfoContactsData.filter(c =>
            c.query !== currentContactData.query &&
            c.hierarchy_breadcrumbs?.length === currentLevel &&
            c.hierarchy_breadcrumbs[currentLevel - 2].query_param === parentQueryParam
        );
        if(sisterDos.length > 0) hierarchyHtml += createOfficeListHtml(sisterDos, "Other District Offices");
    }

    if (hierarchyHtml.includes('<h4>')) {
        hierarchyDisplay.innerHTML = hierarchyHtml;
        officeHierarchySidebar.style.display = 'block';
    } else {
        officeHierarchySidebar.style.display = 'none';
    }
}


function displayOfficials(officials, stdCode, container, title) {
    if (!officials || officials.length === 0) {
        container.innerHTML = '';
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

// --- Official Search ---
function searchOfficialByDetails() {
    const searchTerm = officialNameInput.value.trim();
    officialSearchResultsContainer.innerHTML = '';

    if (searchTerm === "") {
        officialSearchResultsContainer.innerHTML = '<p class="text-center text-gray-500">Please enter a detail to search.</p>';
        return;
    }
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    const results = [];

    epfoContactsData.forEach(contact => {
        if (contact.officials && contact.officials.length > 0) {
            contact.officials.forEach(official => {
                const isMatch = (official.name?.toLowerCase().includes(lowerCaseSearchTerm) ||
                    official.designation?.toLowerCase().includes(lowerCaseSearchTerm) ||
                    official.email?.toLowerCase().includes(lowerCaseSearchTerm) ||
                    official.phone_numbers?.some(p => String(p).includes(searchTerm)) ||
                    official.fax?.some(f => String(f).includes(searchTerm))
                );

                if (isMatch) {
                    results.push({
                        ...official,
                        officeName: contact.office_name_hierarchical || (contact.office ? contact.office.office_name : 'N/A'),
                        officeStdCode: contact.office ? contact.office.std_code : null,
                        officeQuery: contact.query
                    });
                }
            });
        }
    });

    if (results.length === 0) {
        officialSearchResultsContainer.innerHTML = `<p class="no-results">No officials found matching "${searchTerm}".</p>`;
    } else {
        let resultsHtml = `<div class="card bg-yellow-50">
                               <h3 class="text-xl font-semibold text-yellow-700 mb-3">Search Results (${results.length} found)</h3>
                               <ul class="space-y-4 custom-scrollbar max-h-96 overflow-y-auto pr-2">`;
        results.forEach(official => {
            const officeLink = official.officeQuery ? `<a href="#" class="dynamic-office-link" data-officequery="${official.officeQuery}">${official.officeName}</a>` : official.officeName;
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
        updateUrl({ officer: searchTerm }); // Update URL on successful search
        gtag('event', 'search', { 'search_term': searchTerm, 'search_type': 'officer_button' });
    }
}

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', loadContactData);
