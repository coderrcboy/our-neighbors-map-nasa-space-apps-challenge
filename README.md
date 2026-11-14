# Our Neighbor's Map 🔴
**NASA Space Apps Challenge 2026 · Interplanetary Survival Guide: Martian Map · SRM Aaruush (Chennai)**

A layered, multi-mission map of **all of Mars** plus a safety-first **Marswalk (EVA) planner** for the first human explorers.

## Run it
Option A, which gives you everything including live weather and rover images:
```
python server.py
```
Then open http://localhost:8000. It needs only Python 3, nothing to install.

Option B is quick: double-click `index.html`. Everything works this way too (verified: NASA's servers allow file-page requests). `server.py` is a backup that proxies the live feeds if a browser or network blocks them.

You need an internet connection because the map tiles stream from NASA, USGS and Caltech servers.

## What it does
| | |
|---|---|
| **Whole-planet map, best resolution everywhere** | The Smart base map moves from Viking (232 m/px) to the global CTX mosaic (5 m/px) to HiRISE (~25 cm/px) wherever HiRISE has imaged |
| **20+ data layers** | MOLA, MOLA+HRSC (ESA), THEMIS day/night IR, TES thermal inertia, dust, minerals, USGS global geology, site mosaics (Jezero, Gale, Olympus Mons, Opportunity, Spirit) |
| **Live terrain intelligence** | Reads real MOLA elevation pixels in the browser, which feed the cursor elevation readout, a computed slope-hazard layer and elevation profiles |
| **EVA route planner** | A* pathfinding on a MOLA terrain-cost grid. It avoids slopes above the suit or rover limit and stays off loose dust (THEMIS night IR) |
| **Astronaut telemetry** | Walking time (Tobler, suited), metabolic load (Pandolf scaled to 0.38 g), O₂ budget, suit battery, radiation dose (MSL/RAD baseline) and walk-back limit |
| **Go / No-Go checklist** | Combines terrain, consumables, daylight, dust-storm season and radiation into one mission decision |
| **Mars clock** | NASA GISS Mars24 algorithm, giving local solar time, sun elevation, sunrise and sunset for any spot and the date of the season |
| **Live conditions** | Curiosity REMS weather, NASA DONKI space weather (CMEs) and the latest Perseverance raw images |
| **Export** | Route GeoJSON, a printable mission brief and a shareable plan link |

## Data sources
NASA Mars Trek (JPL) · MGS MOLA & TES · Mars Odyssey THEMIS (ASU) · MRO CTX (Caltech Murray Lab mosaic) & HiRISE (UArizona) · ESA Mars Express HRSC (DLR/FU Berlin) · USGS Astrogeology (SIM 3292 geology, IAU nomenclature) · Curiosity REMS (CAB/NASA) · NASA DONKI.

## Honest limits
- Elevation comes from 8-bit MOLA tiles calibrated against landing-site elevations (RMS ≈ 70 m, saturating above +7.6 km). Route slopes are at MOLA scale (~1.3 km), so boulder-scale hazards still need a look at HiRISE imagery.
- The physiology, rover and radiation models are first-order planning aids, not flight-certified.

## Files
`index.html` is the page (loads the Leaflet map library from a CDN, so no `lib` folder is needed) · `app.js` holds the map, planner and UI · `mars.js` is Mars24 time and sun · `data.js` is the layer registry, presets and gazetteer · `server.py` is an optional local server and live-data proxy
