        // ---------- THEME ----------
        const htmlEl = document.documentElement;
        const themeToggle = document.getElementById('themeToggle');
        const iconSun = document.getElementById('iconSun');
        const iconMoon = document.getElementById('iconMoon');
        const updateThemeControl = (isDark) => {
            iconSun.classList.toggle('hidden', !isDark);
            iconMoon.classList.toggle('hidden', isDark);
            themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        };
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            htmlEl.classList.add('dark');
        }
        updateThemeControl(htmlEl.classList.contains('dark'));
        themeToggle.addEventListener('click', () => {
            const isDark = htmlEl.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            updateThemeControl(isDark);
        });

        // ---------- CONSTANTS & STATE ----------
        const CSV_PATH = 'https://gauravmeena0708.github.io/pf-contacts/contacts-data-field-offices.csv';
        const BOUNDARY_PATH = 'data/india-mainland.geojson';
        const MIN_BOUNDARY_CLEARANCE_KM = 50;
        const CONSOLIDATION_RADIUS_KM = 50;
        const RADIUS_UPDATE_DELAY_MS = 250;
        const VISUALIZATION_BATCH_SIZE = 300;

        const statusText = document.getElementById('statusText');
        const totalOfficesEl = document.getElementById('totalOffices');
        const largestGapEl = document.getElementById('largestGap');
        const avgCoverageEl = document.getElementById('avgCoverage');
        const mainlandOfficesCountEl = document.getElementById('mainlandOfficesCount');
        const gapList = document.getElementById('gapList');
        const toggleVoronoiBtn = document.getElementById('toggleVoronoi');
        const toggleCoverageBtn = document.getElementById('toggleCoverage');
        const findGapBtn = document.getElementById('findGapBtn');
        const visualizeGapsBtn = document.getElementById('visualizeGapsBtn');
        const radiusSlider = document.getElementById('radiusSlider');
        const radiusValue = document.getElementById('radiusValue');
        const voronoiToggleLabel = document.getElementById('voronoiToggleLabel');
        const coverageToggleLabel = document.getElementById('coverageToggleLabel');

        let map, voronoiLayer, coverageLayer, gapMarkersLayer, hullLayer, gapVisualizationLayer;
        let allOffices = [];
        let mainlandOffices = [];
        let analysisHull = null;
        let analysisInterior = null;
        let analysisHullOutline = null;
        let voronoiData = null;
        let allGapCandidates = [];
        let coverageGaps = [];
        let currentSelectedGap = null;
        let showVoronoi = true;
        let showCoverage = false;
        let coverageRadius = 75;
        let averageOfficeSpacing = null;
        let hasAnalyzedGaps = false;
        let hasVisualizedGaps = false;
        let radiusUpdateTimer = null;
        let visualizationRunId = 0;
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // ---------- UTILS ----------
        const haversine = (lat1, lon1, lat2, lon2) => {
            const R = 6371; // km
            const dLat = (lat2-lat1) * Math.PI/180, dLon = (lon2-lon1) * Math.PI/180;
            const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
            return 2*R*Math.asin(Math.sqrt(a));
        };

        const formatDistance = (km) => {
            if (!isFinite(km)) return '—';
            if (km >= 100) return `${km.toFixed(0)} km`;
            if (km >= 10) return `${km.toFixed(1)} km`;
            return `${km.toFixed(2)} km`;
        };

        const isWithinAnalysisArea = (lat, lon) => {
            if (!analysisHull) return false;
            const point = turf.point([lon, lat]);
            return turf.booleanPointInPolygon(point, analysisHull);
        };

        const isWithinAnalysisInterior = (lat, lon) => {
            if (!analysisInterior) return false;
            const point = turf.point([lon, lat]);
            return turf.booleanPointInPolygon(point, analysisInterior);
        };

        // ---------- VORONOI & GAP COMPUTATION ----------
        const computeVoronoi = (offices) => {
            if (offices.length < 3 || !analysisHull) return null;
            const points = offices.map(o => [o.longitude, o.latitude]);
            const delaunay = d3.Delaunay.from(points);
            const bbox = turf.bbox(analysisHull); 
            const voronoi = delaunay.voronoi(bbox);
            return { delaunay, voronoi, points };
        };

        const calculateAllGaps = (offices) => {
            if (offices.length < 3 || !voronoiData || !analysisHullOutline) return [];

            statusText.textContent = 'Building mainland gap candidates...';
            const { voronoi } = voronoiData;
            const candidates = [];
            const seenCandidates = new Set();
            const addCandidate = (lon, lat) => {
                if (!Number.isFinite(lon) || !Number.isFinite(lat) || !isWithinAnalysisInterior(lat, lon)) return;
                const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
                if (seenCandidates.has(key)) return;
                seenCandidates.add(key);
                candidates.push([lon, lat]);
            };

            for (let i = 0; i < voronoi.circumcenters.length; i += 2) {
                addCandidate(voronoi.circumcenters[i], voronoi.circumcenters[i + 1]);
            }

            statusText.textContent = `Measuring ${candidates.length} candidates at least ${MIN_BOUNDARY_CLEARANCE_KM} km inside the mainland boundary...`;

            const gaps = candidates.map(([lon, lat]) => {
                let minDist = Infinity;
                offices.forEach((office) => {
                    const d = haversine(lat, lon, office.latitude, office.longitude);
                    if (d < minDist) minDist = d;
                });
                return { lat, lon, distance: minDist };
            });

            gaps.sort((a, b) => b.distance - a.distance);
            return gaps;
        };

        const consolidateGaps = (gaps, radiusInKm) => {
            const consolidated = [];
            let remainingGaps = [...gaps]; 

            while (remainingGaps.length > 0) {
                const currentGap = remainingGaps.shift(); 
                consolidated.push(currentGap);

                remainingGaps = remainingGaps.filter(gap => {
                    const d = haversine(currentGap.lat, currentGap.lon, gap.lat, gap.lon);
                    return d > radiusInKm; 
                });
            }
            return consolidated;
        };


        // ---------- MAP RENDERING ----------
        const initMap = () => {
            map = L.map('map').setView([20.5937, 78.9629], 5);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            hullLayer = L.layerGroup().addTo(map);
            voronoiLayer = L.layerGroup().addTo(map);
            coverageLayer = L.layerGroup().addTo(map);
            gapMarkersLayer = L.layerGroup().addTo(map); 
            gapVisualizationLayer = L.layerGroup().addTo(map);
        };

        const renderVoronoiCells = () => {
            voronoiLayer.clearLayers();
            if (!showVoronoi || !voronoiData || !analysisHull) return;

            const { voronoi } = voronoiData;

            mainlandOffices.forEach((office, i) => {
                const cellPoints = voronoi.cellPolygon(i);
                if (!cellPoints) return;

                if (cellPoints[0][0] !== cellPoints[cellPoints.length - 1][0] || cellPoints[0][1] !== cellPoints[cellPoints.length - 1][1]) {
                    cellPoints.push(cellPoints[0]);
                }

                const cellTurfPolygon = turf.polygon([cellPoints]);

                let clippedCell = null;
                try {
                    clippedCell = turf.intersect(cellTurfPolygon, analysisHull);
                } catch (e) {
                    console.error("Turf intersect error:", e, cellTurfPolygon, analysisHull);
                    return; 
                }

                if (!clippedCell) return; 

                const style = {
                    color: '#3b82f6', weight: 1, opacity: 0.5,
                    fillColor: '#3b82f6', fillOpacity: 0.1
                };

                if (clippedCell.geometry.type === 'Polygon') {
                    const latLngs = clippedCell.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
                    const polygon = L.polygon(latLngs, style);
                    polygon.bindPopup(`<div class="text-sm"><b>${office.name}</b><br><span class="text-gray-500">Voronoi Cell</span></div>`);
                    voronoiLayer.addLayer(polygon);
                } else if (clippedCell.geometry.type === 'MultiPolygon') {
                    clippedCell.geometry.coordinates.forEach(polyCoords => {
                        const latLngs = polyCoords[0].map(([lon, lat]) => [lat, lon]);
                        const polygon = L.polygon(latLngs, style);
                        polygon.bindPopup(`<div class="text-sm"><b>${office.name}</b><br><span class="text-gray-500">Voronoi Cell</span></div>`);
                        voronoiLayer.addLayer(polygon);
                    });
                }
            });
        };

        const renderCoverageCircles = () => {
            coverageLayer.clearLayers();
            if (!showCoverage) return;

            mainlandOffices.forEach(office => {
                const circle = L.circle([office.latitude, office.longitude], {
                    radius: coverageRadius * 1000,
                    color: '#22c55e', weight: 2, opacity: 0.6,
                    fillColor: '#22c55e', fillOpacity: 0.1
                });
                circle.bindPopup(`<div class="text-sm"><b>${office.name}</b><br><span class="text-gray-500">Coverage: ${coverageRadius} km</span></div>`);
                coverageLayer.addLayer(circle);
            });
        };

        const renderOfficeMarkers = () => {
            allOffices.forEach(office => {
                const isMainland = mainlandOffices.some(o => o.id === office.id);
                const marker = L.marker([office.latitude, office.longitude], {
                    icon: L.divIcon({
                        className: '',
                        html: `<div class="office-marker ${isMainland ? 'office-marker--mainland' : 'office-marker--island'}"></div>`,
                        iconSize: [12, 12], iconAnchor: [6, 6]
                    })
                });

                marker.bindPopup(`<div class="text-sm"><b>${office.name}</b><br><span class="text-gray-500">${office.category}</span><br><span class="text-xs text-gray-400">${office.city}, ${office.state}</span></div>`);
                marker.addTo(map);
            });
        };

		const showGapOnMap = (gap, { moveMap = true } = {}) => {
            if (!gap) return;
            
            currentSelectedGap = gap; 
            gapMarkersLayer.clearLayers(); 

            // --- LOGIC MOVED UP ---
            // Calculate the "remaining" gap radius
            const actualGapRadiusKm = gap.distance;
            const plannedCoverageKm = coverageRadius;
            let remainingGapRadiusKm = actualGapRadiusKm - plannedCoverageKm;
            
            if (remainingGapRadiusKm < 0) {
                remainingGapRadiusKm = 0;
            }
            const remainingGapRadiusMeters = remainingGapRadiusKm * 1000;

            // Generate the new text block for the main popup
            let remainingGapText = '';
            if (remainingGapRadiusKm <= 0) {
                remainingGapText = `<div class="text-sm mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                        <b class="text-green-600 dark:text-green-400">Gap Covered!</b><br>
                                        <span class="text-xs text-gray-500 dark:text-gray-400">(${plannedCoverageKm} km service radius ≥ ${formatDistance(actualGapRadiusKm)} nearest-office distance)</span>
                                    </div>`;
            } else {
                remainingGapText = `<div class="text-sm mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                        <b>Remaining Gap (Dotted Line):</b><br>
                                        <b class="text-blue-600 dark:text-blue-400 text-base">${formatDistance(remainingGapRadiusKm)}</b><br>
                                        <span class="text-xs text-gray-500 dark:text-gray-400">(${formatDistance(actualGapRadiusKm)} nearest-office distance − ${plannedCoverageKm} km service radius)</span>
                                    </div>`;
            }
            // --- END MOVED LOGIC ---

            const gapMarker = L.marker([gap.lat, gap.lon], {
                icon: L.divIcon({
                    className: '',
                    html: '<div class="gap-marker" aria-hidden="true">⚠</div>',
                    iconSize: [32, 32], iconAnchor: [16, 16]
                })
            });

            // --- MODIFIED POPUP ---
            gapMarker.bindPopup(`
                <div class="text-center p-2 dark:bg-gray-800 dark:text-gray-100">
                    <div class="text-lg font-bold text-red-600 dark:text-red-400 mb-2">⚠ COVERAGE GAP</div>
                    <div class="text-sm mb-2">Actual distance to nearest office:<br><b class="text-red-600 dark:text-red-400 text-base">${formatDistance(gap.distance)}</b></div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 mb-3">Coordinates: ${gap.lat.toFixed(4)}, ${gap.lon.toFixed(4)}</div>
                    
                    ${remainingGapText} 
                    
                    <a href="https://maps.google.com/maps?q=${gap.lat},${gap.lon}" target="_blank" rel="noopener noreferrer" class="inline-block mt-3 px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">View on Google Maps</a>
                </div>
            `).openPopup();
            gapMarkersLayer.addLayer(gapMarker);
            // --- END MODIFIED POPUP ---

            // "Actual" gap circle (solid red)
            const gapCircle = L.circle([gap.lat, gap.lon], {
                radius: gap.distance * 1000, 
                color: '#dc2626', 
                weight: 3, 
                opacity: 0.6,
                fillColor: '#dc2626', 
                fillOpacity: 0.1
            });
            gapMarkersLayer.addLayer(gapCircle);

            // "Remaining" gap (dashed blue)
            const plannedCoverageCircle = L.circle([gap.lat, gap.lon], {
                radius: remainingGapRadiusMeters, 
                color: '#3b82f6', 
                weight: 2,
                opacity: 0.7,
                fill: false,
                dashArray: '5, 5' 
            });

            // --- MODIFIED: Give the dotted line a simpler popup ---
            let dottedPopupText = `<b>Dotted Line Radius:</b> ${formatDistance(remainingGapRadiusKm)}`;
            if (remainingGapRadiusKm <= 0) {
                 dottedPopupText = 'The selected service radius covers this point.';
            }
            plannedCoverageCircle.bindPopup(`<div class="text-sm p-1 dark:bg-gray-800 dark:text-gray-100">${dottedPopupText}</div>`);
            // --- END MODIFIED ---
            gapMarkersLayer.addLayer(plannedCoverageCircle);

            if (moveMap) {
                if (prefersReducedMotion) {
                    map.setView([gap.lat, gap.lon], 8);
                } else {
                    map.flyTo([gap.lat, gap.lon], 8, { duration: 1.5 });
                }
            }
        };
        const renderLargestGap = () => {
            const largestGapPoint = coverageGaps[0]; 
            if (!largestGapPoint) return;
            showGapOnMap(largestGapPoint); 
        };

        const renderGapList = (gaps) => {
            gapList.innerHTML = '';
            if (!gaps || gaps.length === 0) {
                gapList.innerHTML = `
                    <div class="min-h-48 grid place-items-center rounded-xl border border-dashed border-green-300 dark:border-green-900 bg-green-50/70 dark:bg-green-950/20 p-6 text-center">
                        <div>
                            <div aria-hidden="true" class="mx-auto grid h-9 w-9 place-items-center rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">✓</div>
                            <p class="mt-3 text-sm font-semibold">No gaps beyond ${coverageRadius} km</p>
                            <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">Reduce the service radius to inspect smaller geographic gaps.</p>
                        </div>
                    </div>
                `;
                return;
            }

            gaps.slice(0, 20).forEach((gap, index) => {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'block w-full rounded-lg border border-gray-200 dark:border-gray-800 p-3 text-left hover:border-red-500 dark:hover:border-red-500 transition';
                card.setAttribute('aria-label', `View gap ${index + 1}, ${formatDistance(gap.distance)} from the nearest office`);
                card.innerHTML = `
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex-1">
                            <div class="flex items-center gap-2">
                                <span class="flex items-center justify-center w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold">${index + 1}</span>
                                <span class="text-sm font-semibold text-red-600 dark:text-red-400">${formatDistance(gap.distance)}</span>
                            </div>
                            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">${gap.lat.toFixed(3)}, ${gap.lon.toFixed(3)}</div>
                        </div>
                        <span class="text-xs text-blue-600 dark:text-blue-400">View</span>
                    </div>
                `;
                card.addEventListener('click', () => {
                    showGapOnMap(gap);
                });

                gapList.appendChild(card);
            });
        };

        const applyCoverageRadiusToResults = ({ focusLargest = false } = {}) => {
            if (!hasAnalyzedGaps) return;

            const uncoveredCandidates = allGapCandidates.filter((gap) => gap.distance > coverageRadius);
            coverageGaps = consolidateGaps(uncoveredCandidates, CONSOLIDATION_RADIUS_KM);

            if (currentSelectedGap && currentSelectedGap.distance <= coverageRadius) {
                currentSelectedGap = null;
                gapMarkersLayer.clearLayers();
            }

            renderGapList(coverageGaps);
            updateStats();

            if (coverageGaps.length > 0) {
                const gapLabel = coverageGaps.length === 1 ? 'gap' : 'gaps';
                statusText.textContent = `Found ${coverageGaps.length} distinct ${gapLabel} beyond the ${coverageRadius} km service radius.`;
                if (focusLargest) renderLargestGap();
            } else {
                statusText.textContent = `No mainland gaps exceed the ${coverageRadius} km service radius.`;
            }
        };

        const updateStats = () => {
            totalOfficesEl.textContent = allOffices.length;
            mainlandOfficesCountEl.textContent = mainlandOffices.length;

            const largestGapPoint = coverageGaps[0];
            largestGapEl.textContent = largestGapPoint ? formatDistance(largestGapPoint.distance) : '—';

            if (averageOfficeSpacing === null) {
                let totalDist = 0;
                mainlandOffices.forEach((office) => {
                    let minDist = Infinity;
                    mainlandOffices.forEach((other) => {
                        if (office.id === other.id) return;
                        const d = haversine(office.latitude, office.longitude, other.latitude, other.longitude);
                        if (d < minDist) minDist = d;
                    });
                    totalDist += minDist;
                });
                averageOfficeSpacing = totalDist / (mainlandOffices.length || 1);
                avgCoverageEl.textContent = formatDistance(averageOfficeSpacing);
            } else {
                avgCoverageEl.textContent = formatDistance(averageOfficeSpacing);
            }
        };

        const setVisualizeButtonIdle = () => {
            visualizeGapsBtn.disabled = false;
            visualizeGapsBtn.innerHTML = `<svg aria-hidden="true" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m11-1" /></svg> Visualize All Gaps`;
        };

        const setFindButtonIdle = () => {
            findGapBtn.disabled = false;
            findGapBtn.innerHTML = `<svg aria-hidden="true" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg> Find Coverage Gaps`;
        };

        const visualizeGaps = async () => {
            if (mainlandOffices.length < 3 || !analysisHull) {
                statusText.textContent = 'The office data and mainland boundary must finish loading first.';
                return;
            }

            const runId = ++visualizationRunId;
            hasVisualizedGaps = true;
            visualizeGapsBtn.disabled = true;
            visualizeGapsBtn.innerHTML = '<span aria-hidden="true" class="animate-spin">⏳</span> Visualizing...';
            statusText.textContent = `Visualizing interior areas beyond ${coverageRadius} km from an office...`;
            gapVisualizationLayer.clearLayers();

            try {
                const bbox = turf.bbox(analysisHull);
                const cellSide = turf.distance(turf.point([bbox[0], bbox[1]]), turf.point([bbox[2], bbox[1]])) / 150;
                const grid = turf.pointGrid(bbox, cellSide, { units: 'kilometers' });
                const gapsFound = [];

                for (let start = 0; start < grid.features.length; start += VISUALIZATION_BATCH_SIZE) {
                    if (runId !== visualizationRunId) return;
                    const batch = grid.features.slice(start, start + VISUALIZATION_BATCH_SIZE);

                    batch.forEach((point) => {
                        const [lon, lat] = point.geometry.coordinates;
                        if (!isWithinAnalysisInterior(lat, lon)) return;

                        let minDist = Infinity;
                        for (const office of mainlandOffices) {
                            const distance = haversine(lat, lon, office.latitude, office.longitude);
                            if (distance < minDist) minDist = distance;
                        }
                        if (minDist > coverageRadius) {
                            gapsFound.push(point);
                        }
                    });

                    await new Promise((resolve) => requestAnimationFrame(resolve));
                }

                if (runId !== visualizationRunId) return;

                if (gapsFound.length > 0) {
                    const gapCollection = turf.featureCollection(gapsFound);
                    const heatmapLayer = L.geoJSON(gapCollection, {
                        pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
                            radius: 2,
                            fillColor: "#ef4444",
                            color: "#ef4444",
                            weight: 1,
                            opacity: 0.5,
                            fillOpacity: 0.3
                        })
                    });
                    gapVisualizationLayer.addLayer(heatmapLayer);
                }

                const pointLabel = gapsFound.length === 1 ? 'point' : 'points';
                statusText.textContent = `Found ${gapsFound.length} interior underserved sample ${pointLabel} beyond ${coverageRadius} km.`;
            } catch (error) {
                console.error('Gap visualization failed:', error);
                if (runId === visualizationRunId) {
                    statusText.textContent = 'Could not visualize the coverage gaps. See the console for details.';
                }
            } finally {
                if (runId === visualizationRunId) setVisualizeButtonIdle();
            }
        };

        // ---------- DATA LOADING ----------
        const parseCsv = (text) => {
            const rows = [];
            let row = [];
            let field = '';
            let inQuotes = false;

            for (let i = 0; i < text.length; i++) {
                const char = text[i];

                if (char === '"') {
                    if (inQuotes && text[i + 1] === '"') {
                        field += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (char === ',' && !inQuotes) {
                    row.push(field);
                    field = '';
                } else if ((char === '\n' || char === '\r') && !inQuotes) {
                    if (char === '\r' && text[i + 1] === '\n') i++;
                    row.push(field);
                    if (row.some(value => value.trim() !== '')) rows.push(row);
                    row = [];
                    field = '';
                } else {
                    field += char;
                }
            }

            row.push(field);
            if (row.some(value => value.trim() !== '')) rows.push(row);
            return rows;
        };

        const loadData = async () => {
            try {
                const [officeResponse, boundaryResponse] = await Promise.all([
                    fetch(CSV_PATH),
                    fetch(BOUNDARY_PATH)
                ]);
                if (!officeResponse.ok) throw new Error(`Office data fetch failed: ${officeResponse.status}`);
                if (!boundaryResponse.ok) throw new Error(`Boundary fetch failed: ${boundaryResponse.status}`);

                const [text, boundary] = await Promise.all([
                    officeResponse.text(),
                    boundaryResponse.json()
                ]);
                if (boundary.type !== 'Feature' || !['Polygon', 'MultiPolygon'].includes(boundary.geometry?.type)) {
                    throw new Error('The mainland boundary is not a valid polygon feature.');
                }
                analysisHull = boundary;
                analysisHullOutline = turf.polygonToLine(analysisHull);
                analysisInterior = turf.buffer(analysisHull, -MIN_BOUNDARY_CLEARANCE_KM, {
                    units: 'kilometers'
                });
                if (!analysisInterior) {
                    throw new Error('Could not create the mainland interior analysis area.');
                }

                const rows = parseCsv(text).slice(1);

                allOffices = rows.map((cols, idx) => {
                    if (cols.length < 9) return null;
                    const lat = parseFloat(cols[7]), lon = parseFloat(cols[8]);
                    const inIndia = lat >= 6 && lat <= 37.5 && lon >= 68 && lon <= 97.5;
                    if (!isFinite(lat) || !isFinite(lon) || !inIndia) return null;
                    const clean = (s) => (s || '').trim();
                    return {
                        id: idx, name: clean(cols[0]) || 'N/A', category: clean(cols[1]) || 'N/A',
                        zone: clean(cols[2]) || 'Other', address: clean(cols[3]) || 'N/A',
                        city: clean(cols[4]) || '', state: clean(cols[5]) || '',
                        postalCode: clean(cols[6]) || '', latitude: lat, longitude: lon
                    };
                }).filter(Boolean);

                statusText.textContent = `Loaded ${allOffices.length} offices. Filtering for mainland...`;

                const islandStates = ["ANDAMAN AND NICOBAR ISLANDS", "LAKSHADWEEP"];
                const excludedNames = ["Regional Office, PORT BLAIR"]; 
                mainlandOffices = allOffices.filter(o => 
                    !islandStates.includes(o.state.toUpperCase()) &&
                    !excludedNames.includes(o.name)
                );

                const hullPolygon = L.geoJSON(analysisHull, {
                    style: { color: "#4f46e5", weight: 2, opacity: 0.75, fill: false, dashArray: '5, 5' }
                });
                hullLayer.addLayer(hullPolygon);
                map.fitBounds(hullPolygon.getBounds(), { padding: [20, 20] });

                voronoiData = computeVoronoi(mainlandOffices);

                renderOfficeMarkers(); 
                renderVoronoiCells();
                renderCoverageCircles();
                updateStats(); 

                statusText.textContent = 'Ready. Choose a service radius and analyze mainland coverage gaps.';
                setFindButtonIdle();
                setVisualizeButtonIdle();
            } catch (e) {
                console.error(e);
                statusText.textContent = `Failed to load the planner: ${e.message}`;
            }
        }; 

        // ---------- EVENT HANDLERS ----------
        toggleVoronoiBtn.addEventListener('click', () => {
            showVoronoi = !showVoronoi;
            toggleVoronoiBtn.classList.toggle('active', showVoronoi);
            toggleVoronoiBtn.setAttribute('aria-pressed', String(showVoronoi));
            voronoiToggleLabel.textContent = showVoronoi ? 'Hide Voronoi Cells' : 'Show Voronoi Cells';
            renderVoronoiCells();
        });

        toggleCoverageBtn.addEventListener('click', () => {
            showCoverage = !showCoverage;
            toggleCoverageBtn.classList.toggle('active', showCoverage);
            toggleCoverageBtn.setAttribute('aria-pressed', String(showCoverage));
            coverageToggleLabel.textContent = showCoverage ? 'Hide Coverage Circles' : 'Show Coverage Circles';
            renderCoverageCircles();
        });

        findGapBtn.addEventListener('click', async () => {
            if (mainlandOffices.length < 3) {
                statusText.textContent = 'Need at least 3 mainland offices to analyze.';
                return;
            }
            if (!analysisHullOutline) {
                statusText.textContent = 'Analysis hull outline is not ready. Please wait or reload.';
                return;
            }
            findGapBtn.disabled = true;
            findGapBtn.innerHTML = '<span aria-hidden="true" class="animate-spin">⏳</span> Analyzing...';
            gapList.innerHTML = '<div class="skeleton h-16"></div><div class="skeleton h-16"></div><div class="skeleton h-16"></div>';

            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            try {
                if (!hasAnalyzedGaps) {
                    allGapCandidates = calculateAllGaps(mainlandOffices);
                    hasAnalyzedGaps = true;
                }
                applyCoverageRadiusToResults({ focusLargest: true });
            } catch (error) {
                console.error('Gap analysis failed:', error);
                statusText.textContent = 'Could not calculate coverage gaps. See the console for details.';
            } finally {
                setFindButtonIdle();
            }
        });

        visualizeGapsBtn.addEventListener('click', () => visualizeGaps());

        radiusSlider.addEventListener('input', (e) => {
            coverageRadius = Number.parseInt(e.target.value, 10);
            radiusValue.textContent = `${coverageRadius} km`;
            radiusSlider.setAttribute('aria-valuetext', `${coverageRadius} kilometres`);

            clearTimeout(radiusUpdateTimer);
            if (hasVisualizedGaps) visualizationRunId += 1;

            radiusUpdateTimer = setTimeout(() => {
                renderCoverageCircles();
                applyCoverageRadiusToResults();
                if (currentSelectedGap) showGapOnMap(currentSelectedGap, { moveMap: false });
                if (hasVisualizedGaps) visualizeGaps();
            }, RADIUS_UPDATE_DELAY_MS);
        });

        // ---------- INIT ----------
        window.addEventListener('DOMContentLoaded', () => {
            initMap();
            loadData();
        });

