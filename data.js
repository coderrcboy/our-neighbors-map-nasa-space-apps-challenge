// =====================================================================
//  Our Neighbor's Map — data registry
//  Every endpoint below was read from NASA Mars Trek's own layer catalog
//  (trek.nasa.gov/mars/TrekServices) and the WMTS GetCapabilities files.
// =====================================================================
const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/';
const trek = (id, ext) => `${TREK}${id}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
// Caltech Murray Lab CTX + HiRISE global mosaics are served by Esri/USGS ArcGIS (512 px tiles)
const arcgis = (svc) => `https://astro.arcgis.com/arcgis/rest/services/OnMars/${svc}/MapServer/tile/{z}/{y}/{x}`;

const ATTR = {
  trek: '<a href="https://trek.nasa.gov/mars/" target="_blank">NASA Mars Trek</a> (JPL)',
  usgs: '<a href="https://astrogeology.usgs.gov" target="_blank">USGS Astrogeology</a>',
  murray: '<a href="https://murray-lab.caltech.edu/CTX/" target="_blank">Caltech Murray Lab</a> / MSSS',
  hirise: 'NASA/JPL/<a href="https://www.uahirise.org" target="_blank">UArizona HiRISE</a>',
  asu: 'NASA/JPL/<a href="https://themis.asu.edu" target="_blank">ASU THEMIS</a>',
  esa: '<a href="https://www.esa.int/Science_Exploration/Space_Science/Mars_Express" target="_blank">ESA/DLR/FU Berlin HRSC</a>',
};

// ---------- Base maps (one at a time) ----------
const BASEMAPS = [
  { id:'smart', name:'Smart resolution (auto)', desc:'Viking (global) → CTX 5 m/px (zoom 6+) → HiRISE ~25 cm/px where imaged (zoom 12+)', tags:['cal'], smart:true },
  { id:'viking', name:'Viking color mosaic', desc:'232 m/px · global true-color', url:trek('Mars_Viking_MDIM21_ClrMosaic_global_232m','jpg'), maxNative:7, attr:ATTR.trek+', '+ATTR.usgs, tags:['usgs'] },
  { id:'molahrsc', name:'MOLA + HRSC color hillshade', desc:'200 m/px · NASA laser altimeter blended with ESA Mars Express stereo', url:trek('Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw','jpg'), maxNative:8, attr:ATTR.trek+', '+ATTR.esa, tags:['esa'] },
  { id:'mola', name:'MOLA color hillshade', desc:'463 m/px · elevation-coloured relief', url:trek('Mars_MGS_MOLA_ClrShade_merge_global_463m','jpg'), maxNative:7, attr:ATTR.trek, tags:[] },
  { id:'ctx', name:'CTX global mosaic', desc:'5 m/px · 99.5% of the planet (Caltech Murray Lab)', url:arcgis('CTX'), arc:true, maxNative:13, attr:ATTR.murray, tags:['cal'] },
  { id:'moc', name:'MOC atlas mosaic', desc:'Mars Global Surveyor wide-angle (greyscale)', url:trek('msss_atlas_simp_clon','png'), maxNative:6, attr:ATTR.trek, tags:[] },
];

// ---------- Overlays (stackable) ----------
// NASA open-data key for the DONKI space-weather feed.
// The real key is NOT stored in this repo: GitHub Actions (.github/workflows/pages.yml) swaps the placeholder below for the
// repository secret NASA_API_KEY when it publishes the site. Opened locally, the placeholder falls back to DEMO_KEY
// (about 30 requests/hour per network).
const NASA_API_KEY = (k => /^__.*__$/.test(k) ? 'DEMO_KEY' : k)('__NASA_API_KEY__');
const TREK_ARC = 'https://trek.nasa.gov/mars/trekarcgis/rest/services/';
const OVERLAYS = [
  { group:'Water & ice', id:'valleys', name:'Valley networks (Hynek et al. 2010)', desc:'Ancient river valleys mapped from THEMIS + MOLA · NASA Trek', url:TREK_ARC+'Hynek_Valley_Networks/MapServer/WMTS/tile/1.0.0/Hynek_Valley_Networks/default/default028mm/{z}/{y}/{x}.png', maxNative:9, op:.95, attr:ATTR.trek+' · Hynek et al. 2010' },
  { group:'Water & ice', id:'ice', name:'Ice evidence (icy impacts + glacier-like forms)', desc:'Fresh craters that exposed water ice (Dundas et al. 2014) + glacier-like forms (Souness et al. 2012) · live from NASA Trek', computed:'ice', op:1 },
  { group:'Water & ice', id:'ocean', name:'Proposed ancient ocean (Deuteronilus level)', desc:'Northern plains below −3,760 m MOLA (Contact 2, Head et al. 1999) · computed from the DEM', computed:'ocean', op:.8 },
  { group:'Imagery', id:'hirise', name:'HiRISE global', desc:'~25–50 cm/px strips (sparse) · zoom 12+', url:arcgis('HiRISE'), arc:true, maxNative:18, op:1, attr:ATTR.hirise },
  { group:'Imagery', id:'jez_h', name:'Jezero HiRISE 25 cm', desc:'Perseverance site, controlled', url:trek('JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd','png'), maxNative:17, bounds:[[18.3068,77.2229],[18.6693,77.5840]], op:1, attr:ATTR.hirise },
  { group:'Imagery', id:'gale_h', name:'Gale / Curiosity HiRISE', desc:'Mount Sharp traverse area', url:trek('curiosity_hirise_mosaic','png'), maxNative:16, bounds:[[-4.9255,137.1225],[-4.2490,137.7298]], op:1, attr:ATTR.hirise },
  { group:'Imagery', id:'gale_c', name:'Gale crater CTX', desc:'Block-adjusted CTX', url:trek('Gale_CTX_BlockAdj_dd','png'), maxNative:12, bounds:[[-6.5733,135.1843],[-2.8078,139.2413]], op:1, attr:ATTR.trek },
  { group:'Imagery', id:'jez_c', name:'Jezero CTX 6 m', desc:'Controlled orthomosaic', url:trek('JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0','png'), maxNative:13, bounds:[[18.2110,77.1605],[18.7212,77.6992]], op:1, attr:ATTR.trek },
  { group:'Imagery', id:'olym', name:'Olympus Mons CTX', desc:'Summit caldera mosaic', url:trek('olympus_mons.eq','png'), maxNative:13, bounds:[[12,-136],[24,-124]], op:1, attr:ATTR.trek },
  { group:'Imagery', id:'opp', name:'Opportunity HiRISE', desc:'Meridiani Planum', url:trek('HiRISE_Opportunity','png'), maxNative:17, bounds:[[-2.8343,-5.6179],[-1.8895,-4.9306]], op:1, attr:ATTR.hirise },
  { group:'Imagery', id:'spirit', name:'Spirit HiRISE', desc:'Gusev / Columbia Hills', url:trek('spirit_hirise_mosaic','png'), maxNative:17, bounds:[[-14.6925,175.4279],[-14.5358,175.5858]], op:1, attr:ATTR.hirise },

  { group:'Survival', id:'slope', name:'Slope hazard (computed)', desc:'Live from MOLA DEM · green <8° · amber <15° · red >15°', computed:'slope', op:.55 },
  { group:'Survival', id:'themisN', name:'THEMIS night IR', desc:'Bright = high thermal inertia (bedrock), dark = loose dust', url:trek('THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018','png'), maxNative:9, bounds:[[-65,-180],[65,180]], op:.7, attr:ATTR.asu, tags:['usgs'] },
  { group:'Survival', id:'themisD', name:'THEMIS day IR', desc:'100 m/px morphology / temperature', url:trek('THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018','png'), maxNative:9, bounds:[[-65,-180],[65,180]], op:.7, attr:ATTR.asu },
  { group:'Survival', id:'ti', name:'TES thermal inertia', desc:'Global surface firmness', url:trek('TES_Thermal_Inertia','png'), maxNative:1, op:.6, attr:ATTR.trek },
  { group:'Survival', id:'dust', name:'TES dust cover', desc:'Global dust index', url:trek('TES_Dust','png'), maxNative:1, op:.6, attr:ATTR.trek },
  { group:'Survival', id:'rough', name:'MOLA surface roughness', desc:'Kilometre-scale roughness', url:trek('mola_roughness','png'), maxNative:1, op:.6, attr:ATTR.trek },

  { group:'Science', id:'geo', name:'Global geologic map', desc:'USGS SIM 3292 (Tanaka et al. 2014)', url:'https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/WMTS/tile/1.0.0/SIM3292_Global_Geology/default/default028mm/{z}/{y}/{x}.png', maxNative:11, op:.55, attr:ATTR.usgs, tags:['usgs'] },
  { group:'Science', id:'pyx', name:'TES pyroxene abundance', desc:'High-Ca pyroxene', url:trek('TES_Clinopyroxene','png'), maxNative:1, op:.6, attr:ATTR.trek },
  { group:'Science', id:'clay', name:'TES sheet silicates / glass', desc:'Clay & glass signatures', url:trek('TES_Glass_Clay','png'), maxNative:1, op:.6, attr:ATTR.trek },
  { group:'Science', id:'alb', name:'TES albedo', desc:'Surface brightness', url:trek('Mars_MGS_TES_Albedo_mosaic_global_7410m','png'), maxNative:1, op:.6, attr:ATTR.trek },

  { group:'Reference', id:'names', name:'IAU place names', desc:'Gazetteer of Planetary Nomenclature', computed:'names', op:1, on:true },
  { group:'Reference', id:'sites', name:'Landers & rovers', desc:'Every successful NASA surface mission', computed:'sites', op:1, on:true },
  { group:'Reference', id:'grid', name:'Lat / lon grid', desc:'Planetocentric, east-positive', computed:'grid', op:1 },
];

// MOLA DEM (8-bit) — readable pixels (CORS *), used for elevation, slope and routing.
// Calibration DN→metres fitted against 9 known landing-site / feature elevations (RMS ≈ 70 m).
const DEM = {
  url: (z,y,x) => `${TREK}mola128_mola64_merge_90Nto90S_SimpleC_clon0/1.0.0/default/default028mm/${z}/${y}/${x}.png`,
  maxZ: 5, a: -7290, b: 58.5, satDN: 255,
};
// THEMIS night IR (8-bit) for relative thermal inertia sampling
const THEMIS_N = { url:(z,y,x)=>`${TREK}THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/${z}/${y}/${x}.png`, maxZ:9 };

// ---------- Landed missions (successful NASA surface missions) ----------
const SITES = [
  { n:'Viking 1', lat:22.27, lon:-47.95, y:1976, d:'First successful Mars lander (Chryse Planitia).' },
  { n:'Viking 2', lat:47.67, lon:134.28, y:1976, d:'Utopia Planitia; saw seasonal water frost.' },
  { n:'Mars Pathfinder / Sojourner', lat:19.13, lon:-33.22, y:1997, d:'First Mars rover, Ares Vallis flood plain.' },
  { n:'Spirit (MER-A)', lat:-14.57, lon:175.47, y:2004, d:'Gusev crater; found silica deposits (hot-spring evidence).' },
  { n:'Opportunity (MER-B)', lat:-1.95, lon:-5.53, y:2004, d:'Meridiani; hematite "blueberries", 45 km driven.' },
  { n:'Phoenix', lat:68.22, lon:-125.75, y:2008, d:'Dug up shallow water ice in the northern plains.' },
  { n:'Curiosity (MSL)', lat:-4.59, lon:137.44, y:2012, d:'Gale crater / Mount Sharp; ancient habitable lake.' },
  { n:'InSight', lat:4.50, lon:135.62, y:2018, d:'Seismometer; detected marsquakes & core size.' },
  { n:'Perseverance (Mars 2020)', lat:18.44, lon:77.45, y:2021, d:'Jezero delta; caching samples for return.' },
];

// ---------- Gazetteer (IAU names, coordinates from Mars Trek nomenclature index) ----------
// [name, type, lat, lon]
const GAZ = [
 ['Olympus Mons','Mons',18.65,-133.80],['Ascraeus Mons','Mons',11.92,-104.08],['Pavonis Mons','Mons',1.48,-112.96],['Arsia Mons','Mons',-8.26,-120.09],
 ['Alba Mons','Mons',41.08,-110.71],['Elysium Mons','Mons',25.02,147.21],['Hecates Tholus','Tholus',32.12,150.24],['Albor Tholus','Tholus',18.87,150.47],
 ['Apollinaris Mons','Mons',-9.17,174.79],['Hadriacus Mons','Mons',-31.29,91.86],['Aeolis Mons (Mount Sharp)','Mons',-5.08,137.85],['Ceraunius Tholus','Tholus',24.00,-97.25],
 ['Valles Marineris','Chasma',-13.9,-59.2],['Coprates Chasma','Chasma',-13.37,-60.74],['Candor Chasma','Chasma',-6.53,-70.78],['Ius Chasma','Chasma',-7.29,-84.39],
 ['Hebes Chasma','Chasma',-1.07,-76.06],['Juventae Chasma','Chasma',-3.37,-61.39],['Ganges Chasma','Chasma',-7.96,-47.89],['Eos Chasma','Chasma',-12.15,-39.17],
 ['Echus Chasma','Chasma',2.47,-79.96],['Capri Chasma','Chasma',-8.27,-42.07],['Chasma Boreale','Chasma',82.54,-47.64],['Chasma Australe','Chasma',-82.35,95.03],
 ['Hellas Planitia','Planitia',-42.43,70.50],['Argyre Planitia','Planitia',-49.84,-43.31],['Isidis Planitia','Planitia',13.94,88.38],['Chryse Planitia','Planitia',28.43,-40.31],
 ['Acidalia Planitia','Planitia',49.76,-20.74],['Amazonis Planitia','Planitia',25.75,-162.91],['Arcadia Planitia','Planitia',47.19,-175.69],['Elysium Planitia','Planitia',2.98,154.74],
 ['Utopia Planitia','Planitia',46.7,117.5],['Eridania Planitia','Planitia',-38.15,122.21],
 ['Hesperia Planum','Planum',-21.42,109.89],['Daedalia Planum','Planum',-18.35,-125.95],['Aurorae Planum','Planum',-10.41,-48.62],['Syrtis Major Planum','Planum',8.4,69.5],
 ['Arabia Terra','Terra',21.25,5.72],['Aonia Terra','Terra',-60.20,-97.05],
 ['Jezero','Crater',18.41,77.69],['Gale','Crater',-5.37,137.81],['Gusev','Crater',-14.53,175.52],['Holden','Crater',-26.04,-34.02],['Eberswalde','Crater',-23.98,-33.30],
 ['Endeavour','Crater',-2.28,-5.20],['Huygens','Crater',-13.88,55.58],['Herschel','Crater',-14.48,129.89],['Korolev (ice-filled)','Crater',72.77,164.58],['Henry','Crater',10.79,23.45],
 ['Cassini','Crater',23.35,32.11],['Antoniadi','Crater',21.38,60.83],['Hale','Crater',-35.69,-36.36],['Copernicus','Crater',-48.84,-168.83],['Kepler','Crater',-46.69,140.98],
 ['Galilaei','Crater',5.72,-26.91],['Da Vinci','Crater',1.47,-39.26],['Dawes','Crater',-9.11,38.06],['Airy-0 (prime meridian)','Crater',-5.07,0.00],
 ['Kasei Valles','Vallis',25.14,-62.88],['Ares Vallis','Vallis',10.29,-25.61],['Athabasca Valles','Vallis',8.54,155.01],['Dao Vallis','Vallis',-37.61,88.89],
 ['Harmakhis Vallis','Vallis',-40.98,90.06],['Hebrus Valles','Vallis',19.88,126.74],['Hypanis Valles','Vallis',9.46,-46.42],['Mawrth Vallis','Vallis',22.6,-16.5],
 ['Aram Chaos','Chaos',2.52,-22.39],['Iani Chaos','Chaos',-2.19,-17.04],['Aurorae Chaos','Chaos',-8.47,-34.81],['Hydraotes Chaos','Chaos',1.12,-35.29],['Eos Chaos','Chaos',-16.82,-46.52],
 ['Cerberus Fossae','Fossa',11.28,166.37],['Claritas Fossae','Fossa',-27.89,-104.24],['Nili Fossae','Fossa',22.6,76.8],['Acheron Fossae','Fossa',38.27,-135.02],
 ['Noctis Labyrinthus','Labyrinthus',-7.0,-102.2],['Cydonia Mensae','Mensa',34.56,-12.33],['Deuteronilus Mensae','Mensa',45.11,23.92],['Aeolis Mensae','Mensa',-3.25,140.63],
 ['Meridiani Planum','Planum',0.2,-3.0],['Aeolis Palus','Palus',-4.47,137.42],['Cerberus Palus','Palus',5.78,148.15],
 ['Planum Boreum (N. polar cap)','Planum',88.0,15.0],['Planum Australe (S. polar cap)','Planum',-83.9,160.0],
 ['Hellespontus Montes','Montes',-44.37,42.76],['Charitum Montes','Montes',-58.10,-40.29],['Erebus Montes','Montes',35.66,-174.98],
 ['Medusae Fossae Formation','Region',-3.0,-160.0],['Tharsis rise','Region',1.0,-110.0],
];

// ---------- Preset missions ----------
const PRESETS = [
  { id:'jezero', name:'Jezero delta EVA', mode:'eva', view:[18.465,77.42,13],
    hab:{n:'Habitat · Octavia E. Butler landing', lat:18.4447, lon:77.4508},
    wps:[ {n:'Delta front scarp', lat:18.462, lon:77.415, task:'Sample sedimentary layers', dwell:40},
          {n:'Upper delta channels', lat:18.488, lon:77.405, task:'Imaging & context survey', dwell:30} ] },
  { id:'gale', name:'Mount Sharp foothills EVA', mode:'eva', view:[-4.64,137.41,12],
    hab:{n:'Habitat · Bradbury landing', lat:-4.5895, lon:137.4417},
    wps:[ {n:'Pahrump Hills outcrop', lat:-4.663, lon:137.378, task:'Drill mudstone (lakebed)', dwell:45},
          {n:'Murray formation slope', lat:-4.70, lon:137.395, task:'Sample sulfate-bearing layers', dwell:30} ] },
  { id:'vm', name:'Valles Marineris descent (rover)', mode:'rover', ret:false, view:[-12.7,-60.74,8],
    hab:{n:'Base · Coprates north rim plateau', lat:-12.15, lon:-60.74},
    wps:[ {n:'Coprates Chasma floor', lat:-13.20, lon:-60.74, task:'Layered wall stratigraphy (9 km of exposed crust)', dwell:60} ] },
  { id:'korolev', name:'Korolev ice crater (rover, ISRU)', mode:'rover', view:[72.8,164.6,8],
    hab:{n:'Base · southern rim', lat:72.00, lon:164.58},
    wps:[ {n:'Ice mound edge', lat:72.60, lon:164.58, task:'Water-ice core for ISRU', dwell:90} ] },
];

// ---------- Fallback: latest Curiosity REMS report (CAB/NASA) if live fetch is blocked ----------
const REMS_SNAPSHOT = { sol:'4995', terrestrial_date:'2026-08-25', ls:'341', min_temp:'-71', max_temp:'-5', pressure:'777', atmo_opacity:'Sunny', sunrise:'06:46', sunset:'18:51', local_uv_irradiance_index:'Moderate', min_gts_temp:'-84', max_gts_temp:'4' };

// MOLA + Mars Express HRSC blended shaded relief, 200 m/px (ESA/DLR + NASA). Hillshade: sun at 45° altitude.
// Its brightness tells how steep each 200 m pixel is, ~6x finer than the MOLA elevation grid, so small
// craters, scarps and canyon walls show up. zf = vertical exaggeration used when the shading was made
// (calibrated so flat plains read < 2° and canyon walls ~25-30°).
const SHADE = { url: (z, y, x) => `${TREK}Mars_MOLA_blend200ppx_HRSC_Shade_clon0dd_200mpp_lzw/1.0.0/default/default028mm/${z}/${y}/${x}.jpg`, maxZ: 8, alt: 45, zf: 2 };

// ---------- Fallback for the ice layer if NASA Trek's feature service is unreachable ----------
// Fresh impacts that exposed water ice, imaged by HiRISE (Dundas et al. 2014, JGR), [lat, lon east].
const ICY_IMPACTS = [[46.33,176.9],[43.29,164.22],[55.56,150.61],[45.05,164.71],[46.17,-171.51],[50.65,-81.57],[44.21,164.21],[44.34,152.92],[63.91,44.89],[53.26,46.25],[50.5,-94.81],[64.3,-128.5],[60.98,-121.28],[43.9,-155.7],[50.8,-151.2],[50.4,-140.3],[52.2,-145.2],[39.1,-169.8],[-71.5,-168.5],[-73.7,-109.4],[68.53,-1.47],[52.95,50.86]];
const OCEAN_LEVEL = -3760;   // m, Deuteronilus / Contact 2 mean elevation (Head et al. 1999, Science 286)

// ---------- Simple mode: every layer in plain words  [group, plain name, what it shows] ----------
const SIMPLE_GROUPS = ['Water & ice', 'What it looks like', 'Is it safe to walk?', 'Rocks & minerals', 'Dust & temperature', 'Close-ups of landing sites', 'Names, rovers & grid'];
const SIMPLE_INFO = {
  valleys: ['Water & ice', 'Old rivers & water-carved valleys', 'Valleys cut by flowing water billions of years ago. Good places to look for signs of past life.'],
  ice:     ['Water & ice', 'Buried ice', 'Spots where new craters dug up water ice, plus ice-filled glaciers. Astronauts could mine it for drinking water and rocket fuel.'],
  ocean:   ['Water & ice', 'Ancient ocean shoreline', 'Possible ocean that may have filled the low northern plains about 3.5 billion years ago (blue area, edge = old shoreline).'],
  smart:   ['What it looks like', 'Real photos, sharpest available', 'Switches to clearer pictures as you zoom in, down to car-sized detail.'],
  viking:  ['What it looks like', 'Colour photo of the whole planet', 'Mars in natural-looking colour, from the 1970s Viking orbiters.'],
  molahrsc:['What it looks like', 'Height map (detailed)', 'Colours show height: blue = low, red/white = high. Shading shows hills and craters.'],
  mola:    ['What it looks like', 'Height map', 'Colours show height: blue = low, red/white = high.'],
  ctx:     ['What it looks like', 'Black-and-white photos (5 m)', 'Very sharp greyscale photos covering almost all of Mars.'],
  moc:     ['What it looks like', 'Old black-and-white atlas', 'A 1990s whole-planet photo map.'],
  slope:   ['Is it safe to walk?', 'Too steep to walk', 'Green = easy, yellow = careful, red = too steep for a spacesuit, purple = impassable.'],
  themisN: ['Is it safe to walk?', 'Soft sand vs solid rock', 'Night-time heat photo: dark = loose dust you can sink in, bright = firm rock.'],
  rough:   ['Is it safe to walk?', 'Bumpy ground', 'How rough the surface is over a kilometre, which matters for rovers.'],
  ti:      ['Is it safe to walk?', 'Firm or soft ground (whole planet)', 'Bright = rocky and firm, dark = fine dust.'],
  geo:     ['Rocks & minerals', 'Rock types and ages', 'A geology map: each colour is a different kind and age of rock.'],
  pyx:     ['Rocks & minerals', 'Volcanic minerals', 'Where lava-type minerals (pyroxene) are common.'],
  clay:    ['Rocks & minerals', 'Clays and glass', 'Clay forms in water, so these spots hint at a wetter past.'],
  alb:     ['Rocks & minerals', 'Bright vs dark ground', 'How much sunlight the surface reflects.'],
  dust:    ['Dust & temperature', 'Dusty areas', 'Where a layer of fine dust covers the ground.'],
  themisD: ['Dust & temperature', 'Daytime heat photo', 'Infrared photo that shows the shape of the land very clearly.'],
  hirise:  ['Close-ups of landing sites', 'Super-close photos (25 cm)', 'Strips so sharp you can see rocks and rover tracks. Zoom in a lot to see them.'],
  jez_h:   ['Close-ups of landing sites', 'Jezero crater close-up', 'Where the Perseverance rover is exploring an old river delta.'],
  jez_c:   ['Close-ups of landing sites', 'Jezero crater (wide)', 'The whole Jezero crater lake bed.'],
  gale_h:  ['Close-ups of landing sites', 'Gale crater close-up', 'Where the Curiosity rover is climbing Mount Sharp.'],
  gale_c:  ['Close-ups of landing sites', 'Gale crater (wide)', 'The whole Gale crater and Mount Sharp.'],
  olym:    ['Close-ups of landing sites', 'Olympus Mons summit', 'The top of the tallest volcano in the solar system.'],
  opp:     ['Close-ups of landing sites', 'Opportunity rover site', 'Meridiani Planum, where Opportunity drove 45 km.'],
  spirit:  ['Close-ups of landing sites', 'Spirit rover site', 'Gusev crater and the Columbia Hills.'],
  names:   ['Names, rovers & grid', 'Place names', 'Official names of craters, mountains and valleys.'],
  sites:   ['Names, rovers & grid', 'Landers & rovers', 'Every NASA mission that landed safely.'],
  grid:    ['Names, rovers & grid', 'Map grid', 'Latitude and longitude lines.'],
};
