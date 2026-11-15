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

## New in version 6
- **Simple / Technical switch** (top left). Simple mode is the new beginner interface; Technical mode is the full version 5 interface. The choice is remembered; `?ui=simple` or `?ui=technical` in the link forces one.
- **Simple mode:**
  - A 3-step bar: Explore Mars → Plan a walk or drive → Is it safe?
  - A "What do you want to do?" welcome card, including a one-click demo mission that plans a Jezero walk and plays it in 3D.
  - Map layers in plain words: every layer has a one-line description, grouped by question, with a search box and an ⓘ that shows the science name and source.
  - Planning as 3 steps, with a safety score and plain-English reasons.
  - Labelled tools: Measure, 3D view, Weather and zoom.
  - A plain-words readout under the mouse.
  - A bottom tab bar on phones.
- **New Water & ice layers** (both modes), high-value survey sites:
  - *Old rivers & water-carved valleys*: Hynek et al. 2010 valley networks, NASA Trek tiles.
  - *Buried ice*: fresh craters that dug up water ice (HiRISE, Dundas et al. 2014) plus 1,309 glacier-like forms (Souness et al. 2012), loaded live from NASA Trek's feature services. If Trek is down, the 22 icy impacts are built in.
  - *Ancient ocean shoreline*: the northern plains below the proposed Deuteronilus ocean level (−3,760 m, Head et al. 1999), computed live from the MOLA elevation tiles.
- Tutorial: Simple mode has its own 8-step tour; the Technical tour adds the mode switch (12 steps). The tour opens on every page load (press Skip to close it).
- **Live-feed notifications:** each live feed (Curiosity weather, NASA space weather, Perseverance photos) gives up after 12 s. A notification then says which feed failed and why (timed out, NASA rate limit, offline), a dot appears on the Weather tab, and each card has a **Try again** button. Saved data is shown where possible.
- **NASA API key:** paste a free key from https://api.nasa.gov into `NASA_API_KEY` in `data.js`. It raises the space-weather limit from about 30 to 1,000 requests an hour.
- River valleys are drawn in water-blue.

## New in version 5
- **🧊 3D traverse view:** after computing a route, press **🧊 3D view** to walk or drive it in 3D. It has **First-person**, **Chase** and **Orbit** cameras, drag to look around, a height-exaggeration control, play/pause/scrub, and a live O₂/battery, slope, sun and radio HUD. Terrain is MOLA elevation draped with the 200 m HRSC/MOLA shaded relief. It uses Three.js from a CDN and needs no account or install.
- **📡 Radio line-of-sight:** every route point is checked for a clear radio path to the habitat mast, over terrain and the curve of Mars. Blackout stretches glow purple on the map and the profile, and add a GO/NO-GO checklist item, a 📡 marker and a simulation alert. **Habitat radio mast height** is editable under ⚙ settings (default 10 m). A blackout longer than 15 min on foot is a NO-GO.
- **📏 Measure tool:** the ruler button on the map (bottom right). Click points to see each leg, the total distance (great-circle) and the elevation at each point. It has Undo, Clear and Done; **Esc** also finishes.
- **Tutorial updated** (11 steps) with radio, 3D view and measuring.
- Fix: the ⚙ settings card now switches to rover fields when a rover preset is loaded.

## New in version 4
- **Google-Maps-style layout:** full-screen map, search panel on the left, modes on the right (collapsible). On phones the modes become a bottom sheet.
- **Search → base card → Start:** search any base, read what it is (elevation, ground, daylight), press **▶ Start mission here**.
- **Hazard-coloured routes:** green = safe, yellow = look out (steep or loose sand), red = danger. Loose sand and danger spots blink; **↻ Reroute around danger** when red appears.
- **▶ Simulate traverse:** watch the astronaut walk the route with live distance, mission clock, O₂/battery, sun angle and blinking hazard alerts.
- **Guided tour** on first visit (press **?** to replay).
- **Crater-aware routing:** besides MOLA elevation (463 m), routes now read the 200 m HRSC/MOLA shaded relief to measure local steepness, so small craters, scarps and canyon walls show yellow/red and the planner walks around them.
- **Smooth continuous zoom** (mouse wheel / trackpad glide like Google Maps) and **Mars stays red at max zoom**: the greyscale CTX/HiRISE images get a natural Mars tint (toggle in Layers).
- `design_sketch.jpg` is the hand-drawn layout these changes came from.

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
- Radio line-of-sight uses the same MOLA tiles. Because they are 8-bit (~58 m height steps), terrain must stand ~35 m above the radio path to count as a blocker, so it catches hills, crater rims and canyon walls, not small mounds. The 3D view uses the same ~460 m terrain; its look is a guide, not a photo.
- The physiology, rover and radiation models are first-order planning aids, not flight-certified.

## Files
`index.html` is the page (loads the Leaflet map library from a CDN, so no `lib` folder is needed) · `app.js` holds the map, planner and UI · `extras.js` holds the 3D view and the measure tool · `simple.js` holds Simple mode · `mars.js` is Mars24 time and sun · `data.js` is the layer registry, presets and gazetteer · `server.py` is an optional local server and live-data proxy
