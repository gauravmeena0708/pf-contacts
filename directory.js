let map = null;
let cluster = null;
let userMarker = null;
let markersByQuery = new Map();
let searchIndex = [];
let suggestionHits = [];
let activeSuggestion = -1;
let activeType = 'ALL';
let currentQuery = null;
let toastTimer = null;

const searchInput = document.getElementById('directorySearch');
const suggestionsEl = document.getElementById('searchSuggestions');
const detailEl = document.getElementById('detail');
const resultSummary = document.getElementById('resultSummary');
const workspace = document.getElementById('workspace');

start();

async function start() {
    try {
        await EPFO.load();
        buildSearchIndex();
        updateStats();
        buildMap();
        wireInteractions();

        const hashQuery = readHash();
        const initial = (hashQuery && EPFO.byQuery(hashQuery)) ||
            EPFO.all().find(contact => EPFO.officeType(contact).code === 'HO') ||
            EPFO.all()[0];
        if (initial) selectOffice(initial.query, { updateHistory: false, announce: false });
        detailEl.setAttribute('aria-busy', 'false');
    } catch (error) {
        detailEl.setAttribute('aria-busy', 'false');
        detailEl.innerHTML = `<div class="notice"><strong>Directory unavailable.</strong><br>${EPFO.escapeHtml(error.message)}. Please refresh and try again.</div>`;
        resultSummary.textContent = 'The directory could not be loaded';
    }
}

function buildSearchIndex() {
    searchIndex = [];
    EPFO.all().forEach(contact => {
        const officeName = EPFO.officeName(contact);
        const type = EPFO.officeType(contact);
        const location = EPFO.breadcrumbs(contact).map(item => item.name).join(' · ');
        searchIndex.push({
            kind: 'office',
            label: officeName,
            sub: location || type.label,
            type: type.code,
            query: contact.query,
            haystack: [officeName, location, type.label, EPFO.pin(contact), ...EPFO.phones(contact)].join(' ').toLowerCase()
        });
        (contact.officials || []).forEach((official, officialIndex) => {
            const details = [official.designation, officeName].filter(Boolean).join(' · ');
            searchIndex.push({
                kind: 'official',
                label: official.name || 'Unnamed official',
                sub: details,
                type: type.code,
                query: contact.query,
                officialIndex,
                haystack: [official.name, official.designation, official.email, ...(official.phone_numbers || []), officeName].filter(Boolean).join(' ').toLowerCase()
            });
        });
    });
}

function updateStats() {
    const contacts = EPFO.all();
    const officialTotal = contacts.reduce((total, contact) => total + (contact.officials || []).length, 0);
    const mappedTotal = contacts.filter(EPFO.hasLatLng).length;
    document.getElementById('officeCount').textContent = contacts.length.toLocaleString('en-IN');
    document.getElementById('officialCount').textContent = officialTotal.toLocaleString('en-IN');
    document.getElementById('mappedCount').textContent = mappedTotal.toLocaleString('en-IN');
    document.getElementById('mapCount').textContent = `${mappedTotal.toLocaleString('en-IN')} mapped`;
    resultSummary.textContent = `${contacts.length.toLocaleString('en-IN')} offices ready to search`;
}

function buildMap() {
    if (!window.L) {
        document.getElementById('mapFallback').hidden = false;
        document.getElementById('mapStatus').textContent = 'Map unavailable; directory is ready';
        return;
    }
    map = L.map('map', { scrollWheelZoom: false, zoomControl: false }).setView([22.8, 79.4], 5);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(map);
    cluster = typeof L.markerClusterGroup === 'function'
        ? L.markerClusterGroup({ maxClusterRadius: 42, showCoverageOnHover: false })
        : L.layerGroup();
    EPFO.all().forEach(contact => {
        if (!EPFO.hasLatLng(contact)) return;
        const lat = Number(contact.office.latitude);
        const lon = Number(contact.office.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const marker = L.marker([lat, lon], { title: EPFO.officeName(contact) })
            .bindPopup(`<strong>${EPFO.escapeHtml(EPFO.officeName(contact))}</strong><br><span class="map-popup-action">Open directory record</span>`);
        marker.on('click', () => {
            selectOffice(contact.query);
            setMobileView('directory');
        });
        markersByQuery.set(contact.query, marker);
        cluster.addLayer(marker);
    });
    map.addLayer(cluster);
}

function wireInteractions() {
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('keydown', handleSearchKeys);
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length >= 2) renderSuggestions(searchDirectory(searchInput.value));
    });
    document.addEventListener('click', event => {
        if (!suggestionsEl.contains(event.target) && event.target !== searchInput) closeSuggestions();
    });
    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
    });
    document.getElementById('nearBtn').addEventListener('click', findNearby);
    document.getElementById('typeFilters').addEventListener('click', event => {
        const button = event.target.closest('[data-type]');
        if (!button) return;
        activeType = button.dataset.type;
        document.querySelectorAll('[data-type]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        closeSuggestions();
        renderBrowse(searchInput.value.trim());
    });
    document.getElementById('directoryTab').addEventListener('click', () => setMobileView('directory'));
    document.getElementById('mapTab').addEventListener('click', () => setMobileView('map'));
    window.addEventListener('popstate', () => {
        const query = readHash();
        if (query && query !== currentQuery && EPFO.byQuery(query)) selectOffice(query, { updateHistory: false });
    });
}

function typeMatches(type) {
    if (activeType === 'ALL') return true;
    if (activeType === 'SPECIAL') return ['AP', 'HH', 'GH'].includes(type);
    return type === activeType;
}

function searchDirectory(rawTerm) {
    const term = rawTerm.trim().toLowerCase();
    if (term.length < 2) return [];
    const tokens = term.split(/\s+/).filter(Boolean);
    return searchIndex
        .filter(item => typeMatches(item.type) && tokens.every(token => item.haystack.includes(token)))
        .map(item => {
            let score = item.kind === 'office' ? 2 : 0;
            if (item.label.toLowerCase() === term) score += 10;
            else if (item.label.toLowerCase().startsWith(term)) score += 6;
            else if (item.haystack.startsWith(term)) score += 3;
            return { ...item, score };
        })
        .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function handleSearchInput() {
    const term = searchInput.value.trim();
    activeSuggestion = -1;
    if (term.length < 2) {
        closeSuggestions();
        resultSummary.textContent = term ? 'Type at least 2 characters' : `${EPFO.all().length} offices ready to search`;
        return;
    }
    const hits = searchDirectory(term);
    resultSummary.textContent = hits.length ? `${hits.length.toLocaleString('en-IN')} matching records` : 'No matching offices or officials';
    renderSuggestions(hits);
}

function renderSuggestions(hits) {
    suggestionHits = hits.slice(0, 12);
    activeSuggestion = -1;
    searchInput.removeAttribute('aria-activedescendant');
    if (!suggestionHits.length) {
        suggestionsEl.innerHTML = '<div class="empty" role="status">No results. Try a city, designation or phone number.</div>';
        openSuggestions();
        return;
    }
    suggestionsEl.innerHTML = suggestionHits.map((item, index) => {
        const leading = item.kind === 'office'
            ? `<span class="tag tag-${item.type}" aria-label="${EPFO.escapeHtml(item.type)} office">${item.type}</span>`
            : '<span class="person-mark" aria-hidden="true">OFF</span>';
        return `<button type="button" role="option" id="suggestion-${index}" aria-selected="false" data-index="${index}">
            ${leading}
            <span class="autocomplete-copy">
                <span class="autocomplete-name">${EPFO.escapeHtml(item.label)}</span>
                <span class="autocomplete-sub">${EPFO.escapeHtml(item.sub)}</span>
            </span>
        </button>`;
    }).join('');
    suggestionsEl.querySelectorAll('[role="option"]').forEach(button => {
        button.addEventListener('click', () => chooseSuggestion(suggestionHits[Number(button.dataset.index)]));
    });
    openSuggestions();
}

function openSuggestions() {
    suggestionsEl.classList.add('open');
    searchInput.setAttribute('aria-expanded', 'true');
}

function closeSuggestions() {
    suggestionsEl.classList.remove('open');
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeSuggestion = -1;
}

function handleSearchKeys(event) {
    const options = suggestionsEl.querySelectorAll('[role="option"]');
    if (event.key === 'Escape') {
        closeSuggestions();
        return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!options.length) return;
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        activeSuggestion = (activeSuggestion + direction + options.length) % options.length;
        options.forEach((option, index) => {
            const active = index === activeSuggestion;
            option.classList.toggle('active', active);
            option.setAttribute('aria-selected', String(active));
        });
        const activeOption = options[activeSuggestion];
        searchInput.setAttribute('aria-activedescendant', activeOption.id);
        activeOption.scrollIntoView({ block: 'nearest' });
        return;
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        if (suggestionHits.length) chooseSuggestion(suggestionHits[Math.max(activeSuggestion, 0)]);
        else renderBrowse(searchInput.value.trim());
    }
}

function chooseSuggestion(item) {
    if (!item) return;
    searchInput.value = '';
    closeSuggestions();
    selectOffice(item.query, { officialIndex: item.officialIndex });
}

function renderBrowse(term = '') {
    const normalized = term.trim().toLowerCase();
    const officeItems = searchIndex.filter(item => item.kind === 'office' && typeMatches(item.type) && (!normalized || item.haystack.includes(normalized)));
    const typeLabel = activeType === 'ALL' ? 'All offices' : activeType === 'SPECIAL' ? 'Guest, holiday and training offices' : `${activeType} offices`;
    resultSummary.textContent = `${officeItems.length.toLocaleString('en-IN')} offices in this view`;
    detailEl.className = '';
    detailEl.innerHTML = `
        <div class="browse-head">
            <div><h2>${EPFO.escapeHtml(typeLabel)}</h2><p>${normalized ? `Filtered by “${EPFO.escapeHtml(term)}”` : 'Choose an office to view its contacts'}</p></div>
            <button class="btn btn-quiet" type="button" id="browseReset">Reset</button>
        </div>
        ${officeItems.length ? `<ul class="office-list">${officeItems.slice(0, 100).map(office => `
            <li><button type="button" data-query="${EPFO.escapeHtml(office.query)}">
                <span class="tag tag-${office.type}">${office.type}</span>
                <span class="office-list-copy"><span class="office-list-name">${EPFO.escapeHtml(office.label)}</span><span class="office-list-sub">${EPFO.escapeHtml(office.sub)}</span></span>
                <span class="office-list-arrow" aria-hidden="true">→</span>
            </button></li>`).join('')}</ul>` : '<div class="notice">No offices match this filter. Reset the filters or try another search.</div>'}
    `;
    detailEl.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => selectOffice(button.dataset.query)));
    document.getElementById('browseReset').addEventListener('click', resetDirectory);
    document.getElementById('directoryContent').scrollTop = 0;
}

function resetDirectory() {
    activeType = 'ALL';
    searchInput.value = '';
    document.querySelectorAll('[data-type]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.type === 'ALL')));
    const home = EPFO.all().find(contact => EPFO.officeType(contact).code === 'HO') || EPFO.all()[0];
    if (home) selectOffice(home.query);
}

function selectOffice(query, options = {}) {
    const contact = EPFO.byQuery(query);
    if (!contact) return;
    currentQuery = query;
    const updateHistory = options.updateHistory !== false;
    const officeName = EPFO.officeName(contact);
    const type = EPFO.officeType(contact);

    detailEl.className = 'record-card card';
    detailEl.innerHTML = hierarchyHtml(contact) + EPFO.renderDetail(contact) + recordActionsHtml(contact) + `
        <p class="source-note">Community-maintained snapshot of publicly listed EPFO contacts. Confirm time-sensitive details on the <a href="https://www.epfindia.gov.in/" target="_blank" rel="noopener noreferrer">official EPFO website</a>. <a href="./privacy_policy.html">Privacy</a></p>`;
    detailEl.querySelectorAll('[data-query]').forEach(link => link.addEventListener('click', event => {
        event.preventDefault();
        selectOffice(link.dataset.query);
    }));
    document.getElementById('copyLinkBtn').addEventListener('click', copyCurrentLink);

    if (options.officialIndex != null) {
        const official = detailEl.querySelectorAll('.offs li')[options.officialIndex];
        if (official) {
            official.classList.add('highlighted');
            requestAnimationFrame(() => official.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
        }
    } else {
        document.getElementById('directoryContent').scrollTop = 0;
    }

    resultSummary.textContent = `${type.label} selected`;
    document.getElementById('mapOfficeTitle').textContent = officeName;
    if (EPFO.hasLatLng(contact) && map) {
        const lat = Number(contact.office.latitude);
        const lon = Number(contact.office.longitude);
        map.setView([lat, lon], 11);
        const marker = markersByQuery.get(query);
        if (marker && typeof cluster.zoomToShowLayer === 'function') cluster.zoomToShowLayer(marker, () => marker.openPopup());
        else if (marker) marker.openPopup();
        document.getElementById('mapStatus').textContent = 'Map centred on this office';
    } else {
        document.getElementById('mapStatus').textContent = 'No mapped location for this record';
    }
    if (updateHistory) history.pushState({ query }, '', `#${encodeURIComponent(query)}`);
    document.title = `${officeName} — PF Directory`;
    if (options.announce !== false) showToast(`${officeName} selected`);
}

function recordActionsHtml(contact) {
    const mapLink = EPFO.hasLatLng(contact)
        ? `<a class="btn" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(contact.office.latitude)}&mlon=${encodeURIComponent(contact.office.longitude)}#map=16/${encodeURIComponent(contact.office.latitude)}/${encodeURIComponent(contact.office.longitude)}" target="_blank" rel="noopener noreferrer">Open map ↗</a>`
        : '';
    return `<div class="record-actions">
        <button class="btn btn-primary" type="button" id="copyLinkBtn">Copy record link</button>
        ${mapLink}
    </div>`;
}

function hierarchyHtml(contact) {
    const breadcrumbs = EPFO.breadcrumbs(contact);
    const parent = EPFO.parentOf(contact);
    const children = EPFO.childrenOf(contact);
    const siblings = EPFO.siblingsOf(contact);
    if (!breadcrumbs.length && !parent && !children.length && !siblings.length) return '';

    const path = breadcrumbs.map(crumb => {
        const linked = EPFO.contactForHierarchyValue(crumb.query_param);
        return { label: crumb.name, query: linked && linked.query !== contact.query ? linked.query : null };
    });
    if (parent && !path.some(item => item.query === parent.query)) path.unshift({ label: EPFO.officeName(parent), query: parent.query });
    path.push({ label: EPFO.officeName(contact), current: true });

    return `<details class="hierarchy card">
        <summary>
            <span><span class="hier-title">Office hierarchy</span><span class="hier-hint">Explore parent and related offices</span></span>
            <span class="hier-toggle" aria-hidden="true"></span>
        </summary>
        <div class="hier-body">
            <div class="hier-path">${path.map((item, index) => {
                const step = item.query
                    ? `<a href="#${encodeURIComponent(item.query)}" class="hier-step" data-query="${EPFO.escapeHtml(item.query)}">${EPFO.escapeHtml(item.label)}</a>`
                    : `<span class="hier-step${item.current ? ' current' : ''}">${EPFO.escapeHtml(item.label)}</span>`;
                return index ? `<span class="hier-sep">/</span>${step}` : step;
            }).join('')}</div>
            <div class="hier-grid">
                ${parent ? hierarchyBlock('Parent office', [parent]) : ''}
                ${children.length ? hierarchyBlock('Under this office', children) : ''}
                ${siblings.length ? hierarchyBlock(parent ? 'Sister offices' : 'Related offices', siblings) : ''}
            </div>
        </div>
    </details>`;
}

function hierarchyBlock(title, offices) {
    const visible = offices.slice(0, 8);
    const remaining = offices.length - visible.length;
    return `<div class="hier-block"><h4>${title}</h4><ul class="hier-list">
        ${visible.map(contact => {
            const type = EPFO.officeType(contact);
            return `<li><a href="#${encodeURIComponent(contact.query)}" data-query="${EPFO.escapeHtml(contact.query)}"><span class="tag tag-${type.code}">${type.code}</span><span class="office-link-label">${EPFO.escapeHtml(EPFO.officeName(contact))}</span></a></li>`;
        }).join('')}
        </ul>${remaining > 0 ? `<div class="hier-more">+${remaining} more offices</div>` : ''}</div>`;
}

async function copyCurrentLink() {
    const url = window.location.href;
    try {
        await navigator.clipboard.writeText(url);
        showToast('Record link copied');
    } catch (_) {
        const temp = document.createElement('input');
        temp.value = url;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
        showToast('Record link copied');
    }
}

function findNearby() {
    const button = document.getElementById('nearBtn');
    if (!navigator.geolocation) {
        showToast('Location is not supported in this browser');
        return;
    }
    button.disabled = true;
    button.textContent = 'Locating…';
    resultSummary.textContent = 'Requesting your location…';
    navigator.geolocation.getCurrentPosition(
        position => {
            button.disabled = false;
            button.textContent = 'Near me';
            showNearby(position.coords.latitude, position.coords.longitude);
        },
        error => {
            button.disabled = false;
            button.textContent = 'Near me';
            resultSummary.textContent = 'Location unavailable; search is still ready';
            showToast(error.code === 1 ? 'Location permission was not granted' : 'Could not determine your location');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

function showNearby(latitude, longitude) {
    const ranked = EPFO.all()
        .filter(EPFO.hasLatLng)
        .map(contact => ({ contact, distance: distanceKm(latitude, longitude, Number(contact.office.latitude), Number(contact.office.longitude)) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 20);
    resultSummary.textContent = 'Showing the 20 nearest mapped offices';
    detailEl.className = '';
    detailEl.innerHTML = `
        <div class="browse-head"><div><h2>Offices near you</h2><p>Your location was used for this calculation only and was not stored.</p></div><button class="btn btn-quiet" type="button" id="nearBack">Back</button></div>
        <ul class="office-list nearby-list">${ranked.map(({ contact, distance }) => {
            const type = EPFO.officeType(contact);
            return `<li><button type="button" data-query="${EPFO.escapeHtml(contact.query)}">
                <span class="tag tag-${type.code}">${type.code}</span>
                <span class="office-list-copy"><span class="office-list-name">${EPFO.escapeHtml(EPFO.officeName(contact))}</span><span class="office-list-sub">${EPFO.escapeHtml(type.label)}</span></span>
                <span class="distance">${formatDistance(distance)}</span>
            </button></li>`;
        }).join('')}</ul>`;
    detailEl.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => selectOffice(button.dataset.query)));
    document.getElementById('nearBack').addEventListener('click', () => currentQuery ? selectOffice(currentQuery) : resetDirectory());
    document.getElementById('directoryContent').scrollTop = 0;

    if (map) {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker([latitude, longitude], { radius: 8, color: '#843908', fillColor: '#a64b13', fillOpacity: .9, weight: 3 }).bindPopup('Your approximate location').addTo(map);
        const points = ranked.slice(0, 8).map(item => [Number(item.contact.office.latitude), Number(item.contact.office.longitude)]);
        points.push([latitude, longitude]);
        map.fitBounds(points, { padding: [45, 45] });
        document.getElementById('mapOfficeTitle').textContent = 'Offices near you';
        document.getElementById('mapStatus').textContent = 'Map fitted to the nearest results';
    }
}

function distanceKm(lat1, lon1, lat2, lon2) {
    const radius = 6371;
    const radians = degrees => degrees * Math.PI / 180;
    const dLat = radians(lat2 - lat1);
    const dLon = radians(lon2 - lon1);
    const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(value));
}

function formatDistance(distance) {
    return distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(distance < 10 ? 1 : 0)} km`;
}

function setMobileView(view) {
    workspace.dataset.mobileView = view;
    const directorySelected = view === 'directory';
    document.getElementById('directoryTab').setAttribute('aria-pressed', String(directorySelected));
    document.getElementById('mapTab').setAttribute('aria-pressed', String(!directorySelected));
    if (!directorySelected && map) setTimeout(() => map.invalidateSize(), 50);
}

function readHash() {
    if (!window.location.hash) return '';
    try { return decodeURIComponent(window.location.hash.slice(1)); }
    catch (_) { return ''; }
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

