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
const officeMapContainer = document.getElementById('officeMapContainer');


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
    }
}

function showError(message = "Error loading data.") {
    showLoading(false); // Ensure loader is hidden
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
        // Fetch both files concurrently
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

        // Merge geocodes into contacts data
        epfoContactsData = contacts.map(contact => {
            if (contact.office_name_hierarchical && geocodes[contact.office_name_hierarchical]) {
                const [lat, lon] = geocodes[contact.office_name_hierarchical];
                if (!contact.office) {
                    contact.office = {};
                }
                contact.office.latitude = lat;
                contact.office.longitude = lon;
            }
            return contact;
        });
        
        initializeUI();
        initializeOfficeMap();
        handleUrlParameters();

        showLoading(false);
    } catch (error) {
        console.error('Error loading or processing data:', error);
        showError(`Failed to load data: ${error.message}`);
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
    }).filter(office => office.name && office.name.trim() !== '-' && office.name.trim() !== '');

    officeSearchInput.disabled = false;
    officialNameInput.disabled = false;
    searchOfficialBtn.disabled = false;

    officeSearchInput.addEventListener('input', handleOfficeSearchInput);
    officialNameInput.addEventListener('keypress', e => e.key === 'Enter' && searchOfficialByDetails());
    searchOfficialBtn.addEventListener('click', searchOfficialByDetails);

    document.addEventListener('click', event => {
        if (officeSearchInput && officeAutocompleteSuggestions) {
            if (!officeSearchInput.contains(event.target) && !officeAutocompleteSuggestions.contains(event.target)) {
                officeAutocompleteSuggestions.innerHTML = '';
                officeAutocompleteSuggestions.style.display = 'none';
            }
        }
    });

    officialSearchResultsContainer.addEventListener('click', handleDynamicLinkClick);
    if (hierarchyDisplay) hierarchyDisplay.addEventListener('click', handleDynamicLinkClick);
}

// --- Handle URL parameters ---
function handleUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const officerName = urlParams.get('officer');
    const officeName = urlParams.get('office');

    // Prioritize officer search if both parameters are present
    if (officerName) {
        officialNameInput.value = officerName;
        searchOfficialByDetails();
        if (typeof gtag === 'function') {
            gtag('event', 'search', {
                'search_term': officerName,
                'search_type': 'officer_url_param'
            });
        }
    } else if (officeName) {
        officeSearchInput.value = officeName;
        const searchTerm = officeName.trim().toLowerCase();
        const matchedOffice = searchableOffices.find(office => office.name.toLowerCase().includes(searchTerm));
        if (matchedOffice) {
            displayOfficeDetails(matchedOffice.originalData);
        } else {
            officeDetailsContainer.innerHTML = `<p class="no-results">No office found matching "${officeName}".</p>`;
        }
        if (typeof gtag === 'function') {
            gtag('event', 'search', {
                'search_term': officeName,
                'search_type': 'office_url_param'
            });
        }
    }
}


function handleDynamicLinkClick(event) {
    let target = event.target;
    while (target != null && !target.classList.contains('dynamic-office-link')) {
        if (target === this) {
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
function initializeOfficeMap() {
    if (!epfoContactsData || epfoContactsData.length === 0 || !L) {
        console.warn("Map cannot be initialized: No data or Leaflet library not loaded.");
        if (officeMapContainer) officeMapContainer.innerHTML = '<p class="text-center p-4">Map data unavailable.</p>';
        return;
    }
    if (officeMap) officeMap.remove();

    officeMap = L.map('officeMapContainer').setView([22, 77], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
    }).addTo(officeMap);

    if (mapMarkersGroup) mapMarkersGroup.clearLayers();
    else mapMarkersGroup = L.layerGroup().addTo(officeMap);

    const validOfficeLocations = [];
    epfoContactsData.forEach(contact => {
        if (contact.office && contact.office.latitude != null && contact.office.longitude != null) {
            const lat = parseFloat(contact.office.latitude);
            const lon = parseFloat(contact.office.longitude);
            if (!isNaN(lat) && !isNaN(lon)) {
                const officeName = contact.office_name_hierarchical || contact.office.office_name || "EPFO Office";
                const marker = L.marker([lat, lon]);
                let tooltipContent = `<b>${officeName}</b>`;
                if (contact.office.office_address) {
                    tooltipContent += `<br><small>${String(contact.office.office_address).split('\n')[0]}</small>`;
                }
                tooltipContent += `<br><small><i>Click pin for details</i></small>`;
                marker.bindTooltip(tooltipContent);
                marker.on('click', () => {
                    showOfficeByQuery(contact.query);
                    document.getElementById('officeDetailsContainer')?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                });
                mapMarkersGroup.addLayer(marker);
                validOfficeLocations.push([lat, lon]);
            }
        }
    });
    if (validOfficeLocations.length > 0) officeMap.fitBounds(validOfficeLocations, {
        padding: [50, 50]
    });
    else if (officeMapContainer) officeMapContainer.innerHTML = '<p class="text-center p-4">No office locations with coordinates found.</p>';
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
        office.name && office.name.toLowerCase().includes(searchTerm)
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

function showOfficeByQuery(officeQueryString) {
    const officeData = epfoContactsData.find(contact => contact.query === officeQueryString);
    if (officeData) {
        officeSearchInput.value = officeData.office_name_hierarchical || (officeData.office ? officeData.office.office_name : '');
        officeAutocompleteSuggestions.innerHTML = '';
        officeAutocompleteSuggestions.style.display = 'none';
        displayOfficeDetails(officeData);
        document.getElementById('contentColumn')?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    } else {
        console.warn(`Office with query ${officeQueryString} not found.`);
        officeDetailsContainer.innerHTML = `<p class="text-center text-red-500">Could not find details for the linked office.</p>`;
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

    if (contactData.hierarchy_breadcrumbs && contactData.hierarchy_breadcrumbs.length > 0) {
        displayEnhancedHierarchy(contactData);
    }
}

function displayEnhancedHierarchy(currentContactData) {
    const breadcrumbs = currentContactData.hierarchy_breadcrumbs;
    hierarchyDisplay.innerHTML = ''; // Clear previous
    if (!breadcrumbs || breadcrumbs.length <= 1) {
        officeHierarchySidebar.style.display = 'none';
        return;
    }

    let hierarchyHtml = '<h3>Office Path</h3>';

    let childrenHtml = '';
    const children = epfoContactsData.filter(otherContact => {
        if (!otherContact.hierarchy_breadcrumbs || otherContact.query === currentContactData.query) return false;
        const obc = otherContact.hierarchy_breadcrumbs;
        const cbc = currentContactData.hierarchy_breadcrumbs;
        if (obc.length !== cbc.length + 1) return false;
        for (let i = 0; i < cbc.length; i++) {
            if (obc[i].query_param !== cbc[i].query_param) return false;
        }
        return obc[cbc.length].query_param === currentContactData.office_name_hierarchical;
    });

    if (children.length > 0) {
        childrenHtml = '<h4>Sub-Offices / Units:</h4><ul>';
        children.forEach(child => {
            const childName = child.office_name_hierarchical || child.office.office_name;
            childrenHtml += `<li><a href="#" class="dynamic-office-link" data-officequery="${child.query}">${childName}</a></li>`;
        });
        childrenHtml += '</ul>';
        hierarchyHtml += childrenHtml;
    }

    if (breadcrumbs.length > 1) {
        let sistersHtml = '';
        const parentBreadcrumbPath = breadcrumbs.slice(0, -1);
        const currentOfficeNameInPath = breadcrumbs[breadcrumbs.length - 1].query_param;

        const sisters = epfoContactsData.filter(otherContact => {
            if (!otherContact.hierarchy_breadcrumbs || otherContact.query === currentContactData.query) return false;
            if (otherContact.hierarchy_breadcrumbs.length !== breadcrumbs.length) return false;

            const otherParentPath = otherContact.hierarchy_breadcrumbs.slice(0, -1);
            if (parentBreadcrumbPath.length !== otherParentPath.length) return false;

            let sameParent = true;
            for (let i = 0; i < parentBreadcrumbPath.length; i++) {
                if (parentBreadcrumbPath[i].query_param !== otherParentPath[i].query_param) {
                    sameParent = false;
                    break;
                }
            }
            return sameParent;
        });

        if (sisters.length > 0) {
            sistersHtml = '<h4>Other Offices in this Level:</h4><ul>';
            sisters.forEach(sister => {
                const sisterName = sister.office_name_hierarchical || sister.office.office_name;
                sistersHtml += `<li><a href="#" class="dynamic-office-link" data-officequery="${sister.query}">${sisterName}</a></li>`;
            });
            sistersHtml += '</ul>';
            hierarchyHtml += sistersHtml;
        }
    }
    hierarchyDisplay.innerHTML = hierarchyHtml;
    officeHierarchySidebar.style.display = 'block';
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
                const officeQueryForLink = contact.query;

                if (official.name?.toLowerCase().includes(searchTerm)) isMatch = true;
                if (!isMatch && official.designation?.toLowerCase().includes(searchTerm)) isMatch = true;
                if (!isMatch && official.email?.toLowerCase().includes(searchTerm)) isMatch = true;
                if (!isMatch && official.phone_numbers?.some(phone => String(phone).includes(searchTerm))) isMatch = true;
                if (!isMatch && official.fax?.some(faxNum => String(faxNum).includes(searchTerm))) isMatch = true;

                if (isMatch) results.push({ ...official,
                    officeName,
                    officeStdCode,
                    officeQuery: officeQueryForLink
                });
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
