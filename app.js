// =====================================================================
//  Our Neighbor's Map — Interplanetary Survival Guide (NASA Space Apps 2026)
// =====================================================================
'use strict';
const R_MARS = 3389500;           // mean radius (m)
const G_MARS = 3.721, G_EARTH = 9.807;
const D2R = Math.PI / 180;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (v, d = 0) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
// escape text before putting it into HTML (names can come from shared plan links)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtLL = (lat, lon) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
function hav(a, b) {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dp = p2 - p1, dl = (b.lon - a.lon) * D2R;
  const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_MARS * Math.asin(Math.min(1, Math.sqrt(s)));
}
function toast(msg, ms = 3500) { const t = $('#toast'); t.innerHTML = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = 'none', ms); }

// ---------------------------------------------------------------------
//  Raster sampler: reads real pixel values from NASA Trek tiles (CORS *)
// ---------------------------------------------------------------------
class Raster {
  // opts.edgeDeg: ignore this many degrees of bad pixels at the east (+180°) edge of the source tiles (copy the last good column)
  // opts.lat: the source only covers ±lat (THEMIS: ±65°), so nothing is requested beyond it
  constructor(urlFn, maxZ, minV = 0, opts = {}) { this.urlFn = urlFn; this.maxZ = maxZ; this.minV = minV; this.cache = new Map(); this.edgeDeg = opts.edgeDeg || 0; this.latLim = opts.lat || 90; }
  _load(z, y, x) {
    const k = `${z}/${y}/${x}`;
    if (this.cache.has(k)) return this.cache.get(k);
    const p = (async () => {
      try {
        // give up after 10 s so one stalled download can't freeze route planning; the failed tile is dropped from the cache and retried next time
        const ac = new AbortController(), to = setTimeout(() => ac.abort(), 10000);
        let r; try { r = await fetch(this.urlFn(z, y, x), { mode: 'cors', signal: ac.signal }); } finally { clearTimeout(to); }
        if (!r.ok) return null;
        const bmp = await createImageBitmap(await r.blob());
        const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, 256, 256);
        const d = g.getImageData(0, 0, 256, 256).data, out = new Uint8Array(65536);
        for (let i = 0; i < 65536; i++) out[i] = d[i * 4 + 3] < 10 ? 0 : Math.max(this.minV, d[i * 4]);   // transparent = no data
        return out;
      } catch (e) { return null; }
    })();
    p.then(v => { if (v) this.cache.set(k, v); else this.cache.delete(k); });
    this.cache.set(k, p);
    return p;
  }
  ppd(z) { return 256 * 2 ** z / 180; }
  tilesFor(z, s, w, n, e) {
    const ppd = this.ppd(z), cols = 2 ** (z + 1), rows = 2 ** z, out = [];
    const x0 = Math.floor((w + 180) * ppd / 256) - 1, x1 = Math.floor((e + 180) * ppd / 256) + 1;
    const y0 = Math.max(0, Math.floor((90 - n) * ppd / 256) - 1), y1 = Math.min(rows - 1, Math.floor((90 - s) * ppd / 256) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([z, y, ((x % cols) + cols) % cols]);
    return out;
  }
  async ensure(z, s, w, n, e) { s = Math.max(s, -this.latLim); n = Math.min(n, this.latLim); if (s > n) return; await Promise.all(this.tilesFor(z, s, w, n, e).map(t => this._load(...t))); }
  _px(z, gx, gy) {
    const cols = 2 ** (z + 1) * 256, rows = 2 ** z * 256;
    gx = ((Math.round(gx) % cols) + cols) % cols; gy = clamp(Math.round(gy), 0, rows - 1);
    if (this.edgeDeg) { const last = cols - 1 - Math.ceil(this.edgeDeg * this.ppd(z)); if (gx > last) gx = last; }   // bad strip at +180°
    const t = this.cache.get(`${z}/${gy >> 8}/${gx >> 8}`);
    if (!t || t instanceof Promise) return NaN;
    const v = t[(gy & 255) * 256 + (gx & 255)];
    return v === 0 ? NaN : v;
  }
  val(z, lat, lon) {          // bilinear, synchronous on cached tiles; NaN when not loaded / no data
    const ppd = this.ppd(z), X = (lon + 180) * ppd - 0.5, Y = (90 - lat) * ppd - 0.5;
    const x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0;
    const a = this._px(z, x0, y0), b = this._px(z, x0 + 1, y0), c = this._px(z, x0, y0 + 1), d = this._px(z, x0 + 1, y0 + 1);
    if ([a, b, c, d].some(isNaN)) { const n = this._px(z, X + .5, Y + .5); return n; }
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  }
}
const dem = new Raster(DEM.url, DEM.maxZ, 0, { edgeDeg: 0.045 });          // last 2 columns at +180° are wrong (fake 300–600 m trench)
const themis = new Raster(THEMIS_N.url, THEMIS_N.maxZ, 0, { lat: 65 });     // THEMIS mosaic covers ±65° only
const shade = new Raster(SHADE.url, SHADE.maxZ, 1, { edgeDeg: 0.08 });     // ~20 no-data columns at +180° (fake 26° slope)
// steepness of one 200 m pixel from shaded-relief brightness (the minimum slope consistent with that shading)
function shadeSlope(lat, lon, z = SHADE.maxZ) {
  const v = shade.val(z, lat, lon); if (isNaN(v)) return 0;
  const tilt = Math.abs(Math.acos(clamp(v / 255, 0, 1)) / D2R - (90 - SHADE.alt));
  return Math.atan(Math.tan(tilt * D2R) / SHADE.zf) / D2R;
}
const shadeLevel = metres => clamp(Math.round(Math.log2(demPxM(0) / Math.max(metres, 1))), 0, SHADE.maxZ);
const elev = (lat, lon, z = DEM.maxZ) => { const v = dem.val(z, lat, lon); return isNaN(v) ? NaN : DEM.a + DEM.b * v; };
const demSat = (lat, lon) => dem.val(DEM.maxZ, lat, lon) >= DEM.satDN - 0.5;
// elevation as text; the 8-bit MOLA tiles top out at about +7.6 km, so higher ground is shown as a lower bound
const elevText = (lat, lon, h = elev(lat, lon)) => isNaN(h) ? null : demSat(lat, lon) ? '> 7.6 km (data limit)' : fmt(h) + ' m';
const demPxM = z => (180 / (256 * 2 ** z)) * D2R * R_MARS;   // ~1.3 km at z5
const pressure = h => 610 * Math.exp(-h / 11100);              // Pa, simple isothermal model

// ---------------------------------------------------------------------
//  Map
// ---------------------------------------------------------------------
const WORLD = L.latLngBounds([[-90, -180], [90, 180]]);
const map = L.map('map', { crs: L.CRS.EPSG4326, center: [10, 30], zoom: 2, minZoom: 1, maxZoom: 19, maxBounds: [[-100, -200], [100, 200]], zoomControl: false, worldCopyJump: false, preferCanvas: true,
  // smooth zooming: fractional zoom steps, gentler mouse-wheel, quick debounce
  zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 110, wheelDebounceTime: 25, inertiaDeceleration: 2600, easeLinearity: 0.3 });
L.control.zoom({ position: 'bottomright' }).addTo(map);
// ---- Smooth (continuous) mouse-wheel / trackpad zoom, Google-Maps style ----
// Leaflet's default wheel zoom jumps in 0.25 s steps; here every frame eases toward the target zoom around the cursor.
(() => {
  map.scrollWheelZoom.disable();
  let target = null, anchor = null, raf = 0;
  const frame = () => {
    const z = map.getZoom(); let nz = z + (target - z) * 0.3;
    if (Math.abs(target - nz) < 0.004) nz = target;
    const scale = map.getZoomScale(nz, z), half = map.getSize().divideBy(2);
    const center = map.containerPointToLatLng(half.add(anchor.subtract(half).multiplyBy(1 - 1 / scale)));
    map._move(center, nz);
    if (nz === target) { target = null; raf = 0; map._moveEnd(true); } else raf = requestAnimationFrame(frame);
  };
  map.getContainer().addEventListener('wheel', e => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (target === null) { map._stop(); target = map.getZoom(); map.fire('movestart').fire('zoomstart'); }
    target = clamp(target - px / (e.ctrlKey ? 120 : 300), map.getMinZoom(), map.getMaxZoom());
    anchor = map.mouseEventToContainerPoint(e);
    if (!raf) raf = requestAnimationFrame(frame);
  }, { passive: false });
})();
// Base imagery lives in its own pane. When the greyscale CTX / HiRISE cameras take over at high zoom,
// a CSS colour filter on that pane keeps Mars red instead of turning grey (toggle in Layers).
const basePane = map.createPane('basePane'); basePane.style.zIndex = 150;
map.attributionControl.setPrefix('<b>Our Neighbor\'s Map</b>');
L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
// Leaflet's scale assumes Earth's radius — patch for Mars
L.Control.Scale.prototype._update = function () {
  const m = this._map, y = m.getSize().y / 2;
  const a = m.containerPointToLatLng([0, y]), b = m.containerPointToLatLng([this.options.maxWidth, y]);
  const maxMeters = hav({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
  this._updateScales(maxMeters);
};
if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(document.getElementById('map'));
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function makeTileLayer(def, extra = {}) {
  const o = { attribution: def.attr || '', noWrap: true, bounds: def.bounds ? L.latLngBounds(def.bounds) : WORLD, maxZoom: 19, errorTileUrl: BLANK, crossOrigin: false, keepBuffer: 4, updateWhenZooming: false, ...extra };
  if (def.arc) Object.assign(o, { tileSize: 512, zoomOffset: -1, minNativeZoom: 1, maxNativeZoom: def.maxNative });
  else Object.assign(o, { tileSize: 256, maxNativeZoom: def.maxNative });
  return L.tileLayer(def.url, o);
}
const baseLayers = {};
for (const b of BASEMAPS) {
  if (b.smart) {
    const vik = BASEMAPS.find(x => x.id === 'viking');
    const ctx = BASEMAPS.find(x => x.id === 'ctx');
    const hr = OVERLAYS.find(x => x.id === 'hirise');
    baseLayers.smart = L.layerGroup([makeTileLayer(vik, { pane: 'basePane', zIndex: 1 }), makeTileLayer(ctx, { minZoom: 6, pane: 'basePane', zIndex: 2 }), makeTileLayer(hr, { minZoom: 14, pane: 'basePane', zIndex: 3 })]);
  } else baseLayers[b.id] = makeTileLayer(b, { pane: 'basePane', zIndex: 1 });
}
let curBase = null, curBaseId = 'smart', tintOn = true;
function updateTint() {     // greyscale cameras show: smart map from zoom 6, CTX base at every zoom
  const grey = curBaseId === 'ctx' || (curBaseId === 'smart' && map.getZoom() >= 5.75);
  basePane.classList.toggle('mars-tint', tintOn && grey);
}
map.on('zoomend', updateTint);
function setBase(id) { if (curBase) map.removeLayer(curBase); curBaseId = id; curBase = baseLayers[id]; curBase.addTo(map); updateTint(); }

// ---- Computed layers -------------------------------------------------
const SlopeLayer = L.GridLayer.extend({
  options: { tileSize: 256, noWrap: true, bounds: WORLD, minZoom: 2, maxZoom: 19, opacity: .55, updateWhenZooming: false, keepBuffer: 3 },
  createTile(c, done) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const z = Math.min(c.z, DEM.maxZ), span = 180 / 2 ** c.z;
    const w = -180 + c.x * span, n = 90 - c.y * span, s = n - span, e = w + span;
    const N = c.z >= 8 ? 32 : 64, cell = span / N;
    const zs = c.z >= 6 ? Math.min(c.z, SHADE.maxZ) : -1;
    Promise.all([dem.ensure(z, s, w, n, e), zs >= 0 ? shade.ensure(zs, s, w, n, e) : null]).then(() => {
      const g = cv.getContext('2d'), img = g.createImageData(N, N), h = Math.max(cell, 1 / dem.ppd(z));
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const lat = n - (j + .5) * cell, lon = w + (i + .5) * cell;
        const dx = 2 * h * D2R * R_MARS * Math.max(.05, Math.cos(lat * D2R)), dy = 2 * h * D2R * R_MARS;
        const gx = (elev(lat, lon + h, z) - elev(lat, lon - h, z)) / dx, gy = (elev(lat + h, lon, z) - elev(lat - h, lon, z)) / dy;
        const sl = Math.max(Math.atan(Math.hypot(gx, gy)) / D2R, zs >= 0 ? shadeSlope(lat, lon, zs) : 0), k = (j * N + i) * 4;
        if (isNaN(sl)) continue;
        const col = sl < 3 ? [40, 170, 110, 70] : sl < 8 ? [60, 207, 142, 150] : sl < 15 ? [242, 182, 54, 200] : sl < 25 ? [255, 77, 77, 220] : [190, 30, 140, 235];
        img.data.set(col, k);
      }
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = N; tmp.getContext('2d').putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true; g.drawImage(tmp, 0, 0, 256, 256);
      done(null, cv);
    });
    return cv;
  }
});
// Proposed ancient ocean: everything in the northern lowlands below the Deuteronilus contact level (Head et al. 1999)
const OceanLayer = L.GridLayer.extend({
  options: { tileSize: 256, noWrap: true, bounds: WORLD, minZoom: 1, maxZoom: 19, opacity: .8, updateWhenZooming: false, keepBuffer: 3 },
  createTile(c, done) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const span = 180 / 2 ** c.z, w = -180 + c.x * span, n = 90 - c.y * span, s = n - span, e = w + span;
    if (s >= 90 || n <= -2) { setTimeout(() => done(null, cv)); return cv; }            // northern lowlands only
    const z = clamp(c.z + 1, 1, DEM.maxZ), N = 64, cell = span / N;
    dem.ensure(z, s, w, n, e).then(() => {
      const below = new Uint8Array((N + 2) * (N + 2));
      for (let j = -1; j <= N; j++) for (let i = -1; i <= N; i++) {
        const lat = n - (j + .5) * cell, lon = w + (i + .5) * cell, h = elev(lat, lon, z);
        below[(j + 1) * (N + 2) + i + 1] = lat > 0 && h < OCEAN_LEVEL ? 1 : 0;
      }
      const g = cv.getContext('2d'), img = g.createImageData(N, N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = (j + 1) * (N + 2) + i + 1; if (!below[k]) continue;
        const edge = !below[k - 1] || !below[k + 1] || !below[k - N - 2] || !below[k + N + 2];
        img.data.set(edge ? [150, 220, 255, 255] : [40, 120, 230, 120], (j * N + i) * 4);
      }
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = N; tmp.getContext('2d').putImageData(img, 0, 0);
      g.imageSmoothingEnabled = c.z > 4; g.drawImage(tmp, 0, 0, 256, 256);
      done(null, cv);
    }).catch(() => done(null, cv));
    return cv;
  }
});
// Ice evidence: live from NASA Trek's feature services, with a built-in fallback list of icy impacts
function iceLayer() {
  const g = L.layerGroup(); let loaded = false;
  const dot = (lat, lon, o, tip) => g.addLayer(L.circleMarker([lat, lon], o).bindTooltip(tip));
  const icy = (pts, live) => pts.forEach(([la, lo]) => dot(la, lo, { radius: 7, color: '#ffffff', weight: 2, fillColor: '#5bd1ff', fillOpacity: 1 }, `🧊 New crater dug up water ice (HiRISE)${live ? '' : ' · built-in list'}<br><small>Dundas et al. 2014 · ${fmtLL(la, lo)}</small>`));
  async function load() {
    if (loaded) return; loaded = true;
    const q = async (svc, id, where) => { const r = await fetch(`${TREK_ARC}${svc}/MapServer/${id}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=true&f=json`); if (!r.ok) throw new Error(r.status); const j = await r.json(); if (j.error) throw new Error(j.error.message); return (j.features || []).filter(f => f.geometry).map(f => [f.geometry.y, f.geometry.x, f.attributes]); };
    try {
      const [ice, glf1, glf2] = await Promise.all([q('RSLs_Gullies_New_IcyCraters_clon0', 0, "Short_Type='icy impact site'"), q('Mars_Fans_Glaciers_Gullies', 1, 'FID<1000'), q('Mars_Fans_Glaciers_Gullies', 1, 'FID>=1000')]);
      [...glf1, ...glf2].forEach(([la, lo]) => dot(la, lo, { radius: 3, color: '#cfefff', weight: 1, fillColor: '#8fd8ff', fillOpacity: .85 }, `Glacier-like form: an ice-rich glacier under rock debris<br><small>Souness et al. 2012 · ${fmtLL(la, lo)}</small>`));
      icy(ice.length ? ice.map(p => [p[0], p[1]]) : ICY_IMPACTS, !!ice.length);
      g.featureCount = ice.length + glf1.length + glf2.length;
    } catch (e) { icy(ICY_IMPACTS, false); g.featureCount = ICY_IMPACTS.length; toast('Ice map: NASA Trek feature service unreachable — showing the built-in list of icy impacts only.', 5000); }
  }
  g.on('add', load);
  return g;
}
function namesLayer() {
  const g = L.layerGroup();
  for (const [n, t, lat, lon] of GAZ) {
    const major = /Mons|Planitia|Chasma|Planum|Terra|Region|Labyrinthus/.test(t) && !/Chasma/.test(t) || /Valles Marineris|Olympus|Hellas/.test(n);
    const m = L.circleMarker([lat, lon], { radius: 2.5, color: '#ffe0cc', weight: 1, fillOpacity: .9, interactive: false });
    m.bindTooltip(n, { permanent: true, direction: 'right', className: 'lbl', offset: [4, 0] });
    m._major = major; g.addLayer(m);
  }
  const upd = () => { const z = map.getZoom(); g.eachLayer(m => { const show = m._major ? z >= 2 && z <= 11 : z >= 4 && z <= 13; const el = m.getTooltip()?.getElement(); if (el) el.style.display = show ? '' : 'none'; m.setStyle({ opacity: show ? 1 : 0, fillOpacity: show ? .9 : 0 }); }); };
  map.on('zoomend', upd); g.on('add', () => setTimeout(upd, 0));
  return g;
}
function sitesLayer() {
  const g = L.layerGroup();
  for (const s of SITES) {
    const m = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="pin site"></div><div class="pinlbl" style="font-weight:500;font-size:10.5px;left:13px;top:-4px">${s.n.split(' (')[0]}</div>`, iconSize: [10, 10], iconAnchor: [5, 5] }) });
    m.on('click', e => { if (typeof Measure !== 'undefined' && Measure.active) return; L.DomEvent.stopPropagation(e); Place.show({ n: s.n, type: `Landing site · ${s.y}`, lat: s.lat, lon: s.lon, desc: s.d }); });
    g.addLayer(m);
  }
  return g;
}
function gridLayer() {
  const g = L.layerGroup(), st = { color: '#ffffff', weight: .6, opacity: .25, interactive: false };
  for (let lat = -60; lat <= 60; lat += 30) g.addLayer(L.polyline([[lat, -180], [lat, 180]], st));
  for (let lon = -180; lon <= 180; lon += 30) g.addLayer(L.polyline([[-90, lon], [90, lon]], st));
  g.addLayer(L.polyline([[0, -180], [0, 180]], { ...st, opacity: .5 }));
  return g;
}
const overlayLayers = {};
for (const o of OVERLAYS) {
  if (o.computed === 'slope') overlayLayers[o.id] = new SlopeLayer({ opacity: o.op });
  else if (o.computed === 'names') overlayLayers[o.id] = namesLayer();
  else if (o.computed === 'sites') overlayLayers[o.id] = sitesLayer();
  else if (o.computed === 'grid') overlayLayers[o.id] = gridLayer();
  else if (o.computed === 'ice') overlayLayers[o.id] = iceLayer();
  else if (o.computed === 'ocean') overlayLayers[o.id] = new OceanLayer({ opacity: o.op });
  else overlayLayers[o.id] = makeTileLayer(o, o.group === 'Imagery' ? { opacity: o.op, pane: 'basePane', zIndex: 10 } : { opacity: o.op, className: o.id === 'valleys' ? 'valley-tint' : '' });
}

// ---------------------------------------------------------------------
//  Sidebar: Layers
// ---------------------------------------------------------------------
function badge(tags = []) { return tags.map(t => `<span class="badge ${t}">${{ esa: 'ESA', usgs: 'USGS', cal: 'Caltech' }[t]}</span>`).join(''); }
function buildLayersPane() {
  let h = `<h3>Base map</h3><div class="card">`;
  for (const b of BASEMAPS) h += `<div class="lyr"><input type="radio" name="base" id="b_${b.id}" value="${b.id}" ${b.id === 'smart' ? 'checked' : ''}><label for="b_${b.id}">${b.name}${badge(b.tags)}<small>${b.desc}</small></label><span></span></div>`;
  h += `<div class="lyr"><input type="checkbox" id="o_tint" checked><label for="o_tint">Keep Mars colours when zoomed in<small>Gives the greyscale CTX / HiRISE camera images a natural Mars colour. Untick to see the raw science greyscale.</small></label><span></span></div></div>`;
  let grp = null;
  for (const o of OVERLAYS) {
    if (o.group !== grp) { if (grp) h += `</div>`; grp = o.group; h += `<h3>${grp} layers${grp === 'Water & ice' ? ' <span class="newtag">NEW</span>' : ''}</h3><div class="card">`; }
    const op = o.computed && o.computed !== 'slope' ? '<span></span>' : `<input type="range" min="0" max="1" step="0.05" value="${o.op}" data-op="${o.id}" title="Opacity">`;
    h += `<div class="lyr"><input type="checkbox" id="o_${o.id}" data-ov="${o.id}" ${o.on ? 'checked' : ''}><label for="o_${o.id}">${o.name}${badge(o.tags)}<small>${o.desc}</small></label>${op}</div>`;
  }
  h += `</div><p class="note">Zoom in anywhere: the Smart base map swaps from global Viking imagery to the 5 m/px CTX mosaic and, wherever HiRISE has imaged, to ~25 cm/px. Site mosaics (Jezero, Gale…) only appear inside their footprint — use <b>Explore → Missions</b> to fly there.</p>`;
  $('#p-layers').innerHTML = h;
  $$('input[name=base]').forEach(r => r.onchange = () => setBase(r.value));
  $('#o_tint').onchange = e => { tintOn = e.target.checked; updateTint(); };
  $$('[data-ov]').forEach(c => { c.onchange = () => toggleOverlay(c.dataset.ov, c.checked); if (c.checked) toggleOverlay(c.dataset.ov, true); });
  $$('[data-op]').forEach(r => r.oninput = () => overlayLayers[r.dataset.op].setOpacity(+r.value));
}
function toggleOverlay(id, on) {
  const l = overlayLayers[id];
  if (on) { l.addTo(map); if (id === 'slope') $('#legend').style.display = 'block'; if (id === 'slope' && map.getZoom() < 2) toast('Zoom in to see slope hazards'); }
  else { map.removeLayer(l); if (id === 'slope') $('#legend').style.display = 'none'; }
}

// ---------------------------------------------------------------------
//  EVA / traverse planner
// ---------------------------------------------------------------------
const PROFILES = {
  eva: { label: 'Suited EVA (on foot)', maxSlope: 15, crew: 75, load: 60, o2: 0.90, battH: 8, walkback: 10000, speedFlat: 3.0, mast: 10, ant: 1.8 },
  rover: { label: 'Pressurized rover', maxSlope: 25, mass: 3000, crr: 0.12, eff: 0.7, battKWh: 70, speed: 10, walkback: 50000, mast: 10, ant: 3 },
};
const PROFILE_DEFAULTS = JSON.parse(JSON.stringify(PROFILES));
const Planner = (() => {
  const st = { mode: 'eva', hab: null, wps: [], click: null, route: null, start: null, returnHome: true };
  const lay = L.layerGroup().addTo(map), routeLay = L.layerGroup().addTo(map);
  let hoverMk = null;

  const icon = (cls, label) => L.divIcon({ className: '', html: `<div class="pin ${cls}"></div><div class="pinlbl">${label}</div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
  function redrawMarkers() {
    lay.clearLayers();
    const pts = [st.hab, ...st.wps].filter(Boolean);
    pts.forEach((p, i) => {
      const isHab = p === st.hab;
      const m = L.marker([p.lat, p.lon], { draggable: true, icon: icon(isHab ? 'hab' : 'sci', isHab ? '⌂ ' + esc(p.n.replace('Habitat · ', '')) : `${i}. ${esc(p.n)}`), zIndexOffset: 1000 });
      m.on('dragend', e => { const ll = e.target.getLatLng(); p.lat = ll.lat; p.lon = ll.lng; clearRoute(); renderList(); redrawMarkers(); });
      lay.addLayer(m);
    });
  }
  function clearRoute() { Sim.stop(); routeLay.clearLayers(); st.route = null; $('#profile').classList.remove('on'); document.body.classList.remove('profile-on'); $('#telemetry').innerHTML = ''; planChanged(); }
  const planChanged = () => document.dispatchEvent(new CustomEvent('onm:plan'));
  function setClick(mode) {
    st.click = st.click === mode ? null : mode;
    $('#btnHab').classList.toggle('on', st.click === 'hab'); $('#btnWp').classList.toggle('on', st.click === 'wp');
    $('#modeHint').style.display = st.click ? 'block' : 'none';
    $('#modeHint').textContent = st.click === 'hab' ? 'Click the map to place the habitat' : st.click === 'wp' ? 'Click the map to add science waypoints (Esc to stop)' : '';
    map.getContainer().style.cursor = st.click ? 'crosshair' : '';
    planChanged();
  }
  map.on('click', e => {
    if (typeof Measure !== 'undefined' && Measure.active) return;
    if (!st.click) { Conditions.setPoint(e.latlng.lat, e.latlng.lng); Place.show({ n: 'Dropped pin', type: 'Selected location', lat: e.latlng.lat, lon: e.latlng.lng }, false); return; }
    const { lat, lng } = e.latlng;
    if (st.click === 'hab') { st.hab = { n: 'Habitat', lat, lon: lng }; setClick(null); }
    else st.wps.push({ n: `Waypoint ${st.wps.length + 1}`, lat, lon: lng, task: 'Sample collection', dwell: 30 });
    clearRoute(); renderList(); redrawMarkers();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setClick(null); });

  function renderList() {
    const P = PROFILES[st.mode];
    let h = '';
    if (st.hab) h += `<div class="wp"><div class="n h">⌂</div><input value="${esc(st.hab.n)}" data-f="hab.n" aria-label="Habitat name"><span class="muted small">${st.hab.lat.toFixed(3)}, ${st.hab.lon.toFixed(3)}</span></div>`;
    st.wps.forEach((w, i) => {
      h += `<div class="wp"><div class="n">${i + 1}</div><div><input value="${esc(w.n)}" data-f="w${i}.n" aria-label="Stop ${i + 1} name"><div class="row" style="margin-top:4px"><input value="${esc(w.task)}" data-f="w${i}.task" title="Science task" aria-label="Stop ${i + 1} science task"><input type="number" style="width:62px" value="${w.dwell}" min="0" max="600" step="5" data-f="w${i}.dwell" title="Dwell (min)" aria-label="Stop ${i + 1} minutes"></div></div><button class="x" data-del="${i}" title="Remove" aria-label="Remove stop ${i + 1}">✕</button></div>`;
    });
    if (!st.hab && !st.wps.length) h = `<p class="muted small">No habitat yet. Place one on the map, click a lander in <b>Explore</b>, or load a preset mission.</p>`;
    $('#wplist').innerHTML = h;
    $$('#wplist input').forEach(inp => inp.onchange = () => {
      const [k, f] = inp.dataset.f.split('.'); const obj = k === 'hab' ? st.hab : st.wps[+k.slice(1)];
      if (f === 'dwell') { const v = clamp(Math.round(+inp.value) || 0, 0, 600); inp.value = v; obj[f] = v; } else obj[f] = inp.value.slice(0, 80);
      redrawMarkers();
    });
    $$('[data-del]').forEach(b => b.onclick = () => { st.wps.splice(+b.dataset.del, 1); clearRoute(); renderList(); redrawMarkers(); });
    $('#maxSlope').textContent = P.maxSlope + '°';
    planChanged();
  }

  // ---- A* over a DEM-derived cost grid ----
  async function planLeg(a, b0, P) {
    // unwrap across the antimeridian so the grid spans the short way round
    const b = { ...b0, lon: b0.lon + 360 * Math.round((a.lon - b0.lon) / 360) };
    const dist = hav(a, b), px = demPxM(DEM.maxZ);
    const pad = Math.max(Math.abs(a.lat - b.lat), Math.abs(a.lon - b.lon)) * 0.35 + 3 / dem.ppd(DEM.maxZ);
    const s = Math.min(a.lat, b.lat) - pad, n = Math.max(a.lat, b.lat) + pad, w = Math.min(a.lon, b.lon) - pad, e = Math.max(a.lon, b.lon) + pad;
    await dem.ensure(DEM.maxZ, s, w, n, e);
    const thZ = 5; await themis.ensure(thZ, s, w, n, e).catch(() => {});
    const fine = demPxM(SHADE.maxZ);                                   // ~165 m
    if (dist < 3 * fine) return { pts: densify([a, b], 40).map(normLon), subgrid: true, relaxed: false };
    const cosL = Math.cos(((a.lat + b.lat) / 2) * D2R);
    const spanM = Math.max((n - s), (e - w) * cosL) * D2R * R_MARS;
    const step = Math.max(fine * 1.1, spanM / 170);                    // metres per cell
    const zS = shadeLevel(step); await shade.ensure(zS, s, w, n, e).catch(() => {});
    const dLat = step / (D2R * R_MARS), dLon = dLat / Math.max(cosL, .05);
    const W = Math.ceil((e - w) / dLon) + 1, H = Math.ceil((n - s) / dLat) + 1;
    const hh = new Float32Array(W * H), dust = new Float32Array(W * H), shs = new Float32Array(W * H);
    const oLat = dLat * .35, oLon = dLon * .35;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const lat = n - j * dLat, lon = w + i * dLon; hh[j * W + i] = elev(lat, lon);
      shs[j * W + i] = Math.max(shadeSlope(lat, lon, zS), shadeSlope(lat + oLat, lon, zS), shadeSlope(lat - oLat, lon, zS), shadeSlope(lat, lon + oLon, zS), shadeSlope(lat, lon - oLon, zS));
      const t = themis.val(thZ, lat, lon); dust[j * W + i] = isNaN(t) ? 0 : clamp((70 - t) / 70, 0, 1);
    }
    const idx = (lat, lon) => clamp(Math.round((n - lat) / dLat), 0, H - 1) * W + clamp(Math.round((lon - w) / dLon), 0, W - 1);
    const S = idx(a.lat, a.lon), T = idx(b.lat, b.lon);
    const run = (limit) => {
      const g = new Float64Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
      const heap = [[0, S]]; g[S] = 0;
      const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
      const tj = Math.floor(T / W), ti = T % W;
      const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [1, 2], [-2, 1], [-1, 2], [2, -1], [1, -2], [-2, -1], [-1, -2]];
      while (heap.length) {
        const [, u] = pop(); if (closed[u]) continue; closed[u] = 1; if (u === T) break;
        const uj = Math.floor(u / W), ui = u % W;
        for (const [di, dj] of NB) {
          const vi = ui + di, vj = uj + dj; if (vi < 0 || vj < 0 || vi >= W || vj >= H) continue;
          const v = vj * W + vi; if (closed[v]) continue;
          const d = step * Math.hypot(di, dj), dh = hh[v] - hh[u];
          if (isNaN(dh)) continue;
          const sl = Math.max(Math.atan(Math.abs(dh) / d) / D2R, shs[v]);   // MOLA slope or 200 m shading, whichever is steeper
          if (sl > limit && v !== T) continue;
          const c = d * (1 + (st.strict ? 10 : 4) * (sl / limit) ** 2 + (dh > 0 ? 2.5 * dh / d : 0) + 0.6 * dust[v]);
          const ng = g[u] + c;
          if (ng < g[v]) { g[v] = ng; from[v] = u; push(ng + step * Math.hypot(vi - ti, vj - tj), v); }
        }
      }
      if (!isFinite(g[T])) return null;
      const path = []; for (let u = T; u !== -1; u = from[u]) path.push(u);
      return path.reverse().map(u => ({ lat: n - Math.floor(u / W) * dLat, lon: w + (u % W) * dLon }));
    };
    let limit = st.strict ? P.maxSlope * 0.7 : P.maxSlope, path = run(limit), relaxed = false;
    while (!path && limit < 45) { limit += 5; relaxed = true; path = run(limit); }
    if (!path) path = [a, b];
    path[0] = { lat: a.lat, lon: a.lon }; path[path.length - 1] = { lat: b.lat, lon: b.lon };
    return { pts: densify(simplify(path), 400).map(normLon), subgrid: false, relaxed, limit };
  }
  const normLon = p => ({ lat: p.lat, lon: ((p.lon + 540) % 360) - 180 });
  function simplify(p) {    // drop colinear grid steps
    if (p.length < 3) return p; const out = [p[0]];
    for (let i = 1; i < p.length - 1; i++) { const a = out[out.length - 1], b = p[i], c = p[i + 1]; const cr = (b.lat - a.lat) * (c.lon - b.lon) - (b.lon - a.lon) * (c.lat - b.lat); if (Math.abs(cr) > 1e-12) out.push(b); }
    out.push(p[p.length - 1]); return out;
  }
  function densify(p, maxStepM) {
    const out = [p[0]];
    for (let i = 1; i < p.length; i++) { const d = hav(p[i - 1], p[i]), k = Math.max(1, Math.ceil(d / maxStepM)); for (let j = 1; j <= k; j++) out.push({ lat: p[i - 1].lat + (p[i].lat - p[i - 1].lat) * j / k, lon: p[i - 1].lon + (p[i].lon - p[i - 1].lon) * j / k }); }
    return out;
  }

  // ---- Physiology & vehicle models ----
  function pandolfMars(v, gradePct, eta, P) {   // Pandolf (1977), weight terms scaled to Mars gravity
    const W = P.crew, Ld = P.load, gf = G_MARS / G_EARTH;
    const Gp = Math.max(0, gradePct);
    let M = 1.5 * W + gf * (2.0 * (W + Ld) * (Ld / W) ** 2 + eta * (W + Ld) * (1.5 * v * v + 0.35 * v * Gp));
    if (gradePct < 0) M *= 1.1;                 // eccentric braking on descents
    return M;                                   // watts
  }
  const toblerMars = gradeFrac => 0.6 * 6 * Math.exp(-3.5 * Math.abs(gradeFrac + 0.05)); // km/h, suited penalty 0.6

  async function compute() {
    if (!st.hab) return toast('Place a habitat first');
    if (!st.wps.length) return toast('Add at least one science waypoint');
    const P = PROFILES[st.mode], token = (st.token = (st.token || 0) + 1);
    $('#btnPlan').disabled = true; $('#btnPlan').textContent = 'Computing route on MOLA terrain…';
    try {
      const stops = [st.hab, ...st.wps, ...(st.returnHome ? [st.hab] : [])];
      const legs = []; let subgrid = false, relaxed = false;
      for (let i = 1; i < stops.length; i++) { const r = await planLeg(stops[i - 1], stops[i], P); legs.push(r); subgrid ||= r.subgrid; relaxed ||= r.relaxed; }
      // sample profile
      const S = []; let D = 0;
      legs.forEach((lg, li) => lg.pts.forEach((p, k) => {
        if (li > 0 && k === 0) return;
        if (S.length) D += hav(S[S.length - 1], p);
        const t = themis.val(5, p.lat, p.lon);
        S.push({ lat: p.lat, lon: p.lon, d: D, h: elev(p.lat, p.lon), leg: li, sat: demSat(p.lat, p.lon), loose: !isNaN(t) && t < 55, noTI: isNaN(t) });
      }));
      if (S.filter(p => isNaN(p.h)).length > S.length * 0.2) { toast('⚠ Terrain data could not be loaded (offline or NASA Trek unreachable). Check your connection and try again.', 6000); return; }
      // along-track slope, smoothed over one DEM pixel
      const win = demPxM(DEM.maxZ);
      for (let i = 0; i < S.length; i++) {
        let j = i; while (j > 0 && S[i].d - S[j].d < win / 2) j--; let k = i; while (k < S.length - 1 && S[k].d - S[i].d < win / 2) k++;
        const dd = S[k].d - S[j].d; S[i].grade = dd > 0 ? (S[k].h - S[j].h) / dd : 0; S[i].slope = Math.atan(Math.abs(S[i].grade)) / D2R;
      }
      { // fine-scale (200 m) steepness from HRSC/MOLA shaded relief: catches small craters and scarps
        let s0 = 90, n0 = -90, w0 = 540, e0 = -540; S.forEach(q => { s0 = Math.min(s0, q.lat); n0 = Math.max(n0, q.lat); w0 = Math.min(w0, q.lon); e0 = Math.max(e0, q.lon); });
        const zR = Math.max(5, SHADE.maxZ - Math.max(0, Math.ceil(Math.log2(Math.max(n0 - s0, (e0 - w0) / 2) / 2))));
        await shade.ensure(zR, s0 - .05, w0 - .05, n0 + .05, e0 + .05).catch(() => {});
        S.forEach(q => { q.fine = shadeSlope(q.lat, q.lon, zR); q.noShade = isNaN(shade.val(zR, q.lat, q.lon)); if (q.fine > q.slope) { q.slope = q.fine; q.steepFine = true; } });
      }
      // time, energy
      const start = st.start || MarsTime.nextLTST(new Date(), st.hab.lon, 9);
      let t = 0, E = 0, kwh = 0, asc = 0, desc = 0, maxSl = 0, loose = 0, dw = 0;
      const arrive = [], workW = 260; S[0].tc = 0; S[0].ec = 0; S[0].kc = 0;
      for (let i = 1; i < S.length; i++) {
        const a = S[i - 1], b = S[i], ds = b.d - a.d; if (ds <= 0) continue;
        const dh = b.h - a.h; if (dh > 0) asc += dh; else desc -= dh;
        maxSl = Math.max(maxSl, b.slope); if (b.loose) loose += ds;
        if (st.mode === 'eva') {
          const v = toblerMars(b.grade) / 3.6, dt = ds / v; t += dt;
          E += pandolfMars(v, b.grade * 100, b.loose ? 1.8 : 1.2, P) * dt;
        } else {
          const v = Math.max(3, P.speed * (1 - 0.5 * b.slope / P.maxSlope)) / 3.6, dt = ds / v; t += dt;
          kwh += (P.mass * G_MARS * P.crr * ds * (b.loose ? 1.5 : 1) + P.mass * G_MARS * Math.max(0, dh)) / P.eff / 3.6e6;
        }
        if (b.leg !== S[i + 1]?.leg) { arrive[b.leg] = t; const w = st.wps[b.leg]; if (w) dw += (w.dwell || 0) * 60; }
        b.tc = t + dw; b.ec = E + workW * dw; b.kc = kwh;      // cumulative, used by the traverse simulation
      }
      for (let i = 1; i < S.length; i++) if (S[i].tc == null) { S[i].tc = S[i - 1].tc; S[i].ec = S[i - 1].ec; S[i].kc = S[i - 1].kc; }
      // radio line-of-sight from the habitat mast to the crew antenna (terrain + Mars curvature)
      const radio = await radioLOS(S, st.hab, P);
      let dwellS = 0; st.wps.forEach(w => { dwellS += (w.dwell || 0) * 60; });
      const evaE = E + workW * dwellS;
      const totalS = t + dwellS;
      const o2 = evaE / 20100 * 1.429e-3;                        // kg O2 (20.1 kJ per litre O2)
      const roverEvaO2 = (workW * dwellS + 1.5 * 75 * dwellS) / 20100 * 1.429e-3;
      // sun & daylight
      const sunAt = sec => MarsTime.sun(new Date(start.getTime() + sec * 1000), st.hab.lat, st.hab.lon);
      let minEl = 90; for (let s2 = 0; s2 <= totalS; s2 += 600) minEl = Math.min(minEl, sunAt(s2).el);
      const s0 = sunAt(0), s1 = sunAt(totalS);
      // radiation (MSL RAD baseline at Gale ≈ 0.64 mSv/day; first-order overhead-atmosphere scaling)
      const hMean = S.reduce((a, b) => a + (isNaN(b.h) ? 0 : b.h), 0) / S.length;
      const radRate = 0.64 / 24 * Math.exp(0.35 * (hMean + 4500) / 11100);
      const dose = radRate * totalS / 3600;
      // farthest point & walk-back
      let far = 0, farIdx = 0; S.forEach((p, i) => { const d = hav(p, st.hab); if (d > far) { far = d; farIdx = i; } });
      const T0 = MarsTime.at(start);
      if (token !== st.token) return;     // a newer plan was started meanwhile
      st.route = { S, legs, t, totalS, dwellS, E: evaE, o2, roverEvaO2, kwh, asc, desc, maxSl, loose, subgrid, relaxed, start, s0, s1, minEl, dose, radRate, far, farIdx, hMean, T0, arrive, mode: st.mode, radio, mast: P.mast };
      drawRoute(); renderTelemetry(); Profile.draw(st.route);
      saveHash(); planChanged();
    } finally { $('#btnPlan').disabled = false; $('#btnPlan').textContent = 'Compute safe route'; }
  }

  async function radioLOS(S, hab, P) {
    let s0 = hab.lat, n0 = hab.lat, w0 = hab.lon, e0 = hab.lon;
    S.forEach(q => { const lo = q.lon + 360 * Math.round((hab.lon - q.lon) / 360); s0 = Math.min(s0, q.lat); n0 = Math.max(n0, q.lat); w0 = Math.min(w0, lo); e0 = Math.max(e0, lo); });
    await dem.ensure(DEM.maxZ, s0 - .02, w0 - .02, n0 + .02, e0 + .02).catch(() => {});
    const hh = elev(hab.lat, hab.lon), ha = (isNaN(hh) ? 0 : hh) + P.mast;
    let lost = 0, longest = 0, runT = 0, cover = 0;
    for (let i = 0; i < S.length; i++) {
      const q = S[i], gq = isNaN(q.h) ? hh : q.h, ok = losClear(hab, ha, q, gq + P.ant, isNaN(hh) ? 0 : hh, gq);
      q.nolos = !ok;
      if (i) { const ds = q.d - S[i - 1].d, dt = (q.tc || 0) - (S[i - 1].tc || 0); if (!ok) { lost += ds; runT += dt; longest = Math.max(longest, runT); } else { runT = 0; cover += ds; } }
    }
    const D = S[S.length - 1].d || 1;
    return { lost, longest, frac: 1 - lost / D, mast: P.mast };
  }

  function drawRoute() {
    routeLay.clearLayers(); const S = st.route.S, P = PROFILES[st.mode];
    // blinking hazard markers at the middle of each loose-sand / danger stretch
    const runs = (test) => { const out = []; let a = -1; for (let i = 1; i <= S.length; i++) { const on = i < S.length && test(S[i]); if (on && a < 0) a = i; if (!on && a >= 0) { out.push([a, i - 1]); a = -1; } } return out; };
    // radio blackout halo (no line-of-sight to the habitat mast)
    { let h = []; const fl = () => { if (h.length > 1) routeLay.addLayer(L.polyline(h, { color: RADIO_COL, weight: 14, opacity: .45, interactive: false })); h = []; };
      for (let i = 1; i < S.length; i++) { if (S[i].nolos && Math.abs(S[i].lon - S[i - 1].lon) <= 180) { if (!h.length) h.push([S[i - 1].lat, S[i - 1].lon]); h.push([S[i].lat, S[i].lon]); } else fl(); } fl(); }
    for (const [a, b] of runs(p => p.nolos)) { const m = S[(a + b) >> 1], km = (S[b].d - S[a - 1].d) / 1000, min = ((S[b].tc || 0) - (S[a - 1].tc || 0)) / 60;
      routeLay.addLayer(L.marker([m.lat, m.lon], { icon: L.divIcon({ className: '', html: '<div class="hz radio">📡</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 450 }).bindTooltip(`📡 Radio blackout · ${fmt(km, 2)} km · ~${fmt(min)} min without line-of-sight to the habitat mast`)); }
    for (const [a, b] of runs(p => p.loose)) { const m = S[(a + b) >> 1], km = (S[b].d - S[a - 1].d) / 1000;
      routeLay.addLayer(L.marker([m.lat, m.lon], { icon: L.divIcon({ className: '', html: '<div class="hz sand">!</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 500 }).bindTooltip(`⚠ Loose sand · ${fmt(km, 2)} km — slow down, test footing`)); }
    for (const [a, b] of runs(p => p.slope > P.maxSlope)) { const m = S[(a + b) >> 1];
      routeLay.addLayer(L.marker([m.lat, m.lon], { icon: L.divIcon({ className: '', html: '<div class="hz danger">⛔</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 600 }).bindTooltip(`⛔ Danger · slope ${fmt(Math.max(...S.slice(a, b + 1).map(p => p.slope)), 1)}° — use Reroute`)); }
    // one line per run of the same colour (not one per segment): long routes stay fast to draw and pan
    let under = [], run = null;
    const flush = () => { if (run && run.pts.length > 1) routeLay.addLayer(L.polyline(run.pts, { color: run.c, weight: 4, opacity: .95, interactive: false, dashArray: run.dash ? '6 5' : null })); run = null; };
    for (let i = 1; i < S.length; i++) {
      const a = [S[i - 1].lat, S[i - 1].lon], b = [S[i].lat, S[i].lon];
      if (Math.abs(S[i].lon - S[i - 1].lon) > 180) { flush(); if (under.length > 1) routeLay.addLayer(L.polyline(under, { color: '#000', weight: 7, opacity: .45, interactive: false })); under = []; continue; }   // antimeridian seam
      if (!under.length) under.push(a); under.push(b);
      const c = HZ_COL[hazard(S[i], P)], dash = !!S[i].loose;
      if (!run || run.c !== c || run.dash !== dash) { flush(); run = { c, dash, pts: [a] }; }
      run.pts.push(b);
    }
    flush(); if (under.length > 1) routeLay.addLayer(L.polyline(under, { color: '#000', weight: 7, opacity: .45, interactive: false }));
    routeLay.eachLayer(l => { if (l instanceof L.Polyline && l.options.color === '#000') l.bringToBack(); });
    const f = S[st.route.farIdx];
    routeLay.addLayer(L.circleMarker([f.lat, f.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#5bb4ff', fillOpacity: 1 }).bindTooltip(`Farthest point · ${fmt(st.route.far / 1000, 2)} km from habitat`));
    const fit = () => { map.invalidateSize({ pan: false }); map.fitBounds(L.latLngBounds(S.map(p => [p.lat, p.lon])).pad(0.1), mapPadding()); };
    fit(); setTimeout(fit, 320);            // again once the profile panel has finished sliding open
  }

  function renderTelemetry() {
    const r = st.route, P = PROFILES[st.mode], checks = [];
    const add = (lvl, msg) => checks.push([lvl, msg]);
    // terrain
    if (r.maxSl <= P.maxSlope) add('ok', `Max route slope ${fmt(r.maxSl, 1)}° within ${P.maxSlope}° ${st.mode === 'eva' ? 'suited-walking' : 'rover'} limit`);
    else if (r.maxSl <= P.maxSlope * 1.25) add('warn', `Route reaches ${fmt(r.maxSl, 1)}° — above ${P.maxSlope}° limit on short sections`);
    else add('bad', `Route reaches ${fmt(r.maxSl, 1)}° slopes — unsafe, move waypoints`);
    if (r.relaxed) add('warn', `No path existed under ${P.maxSlope}°; limit was relaxed to find one`);
    if (r.subgrid) add('warn', `Some legs are shorter than the 200 m terrain grid — inspect HiRISE/CTX imagery for boulders`);
    if (r.S.some(p => p.sat)) add('warn', `Terrain above +7.6 km: DEM saturates, slopes there are under-estimated`);
    if (r.loose > 0) add('warn', `${fmt(r.loose / 1000, 2)} km over low thermal-inertia ground (likely loose dust/sand — dashed)`);
    else if (r.S.filter(p => p.noTI).length > r.S.length / 2) add('warn', r.S.some(p => p.noTI && Math.abs(p.lat) <= 65) ? 'Ground-firmness (thermal) data did not load for most of the route: soft sand cannot be ruled out. Check your connection and recompute' : 'No ground-firmness data for most of the route (THEMIS covers ±65° only): soft sand cannot be ruled out');
    if (r.S.filter(p => p.noShade).length > r.S.length / 2) add('warn', 'Detailed terrain shading (200 m) did not load for most of the route: small craters and scarps may be missed. Check your connection and recompute');
    else add('ok', 'No loose-dust signature on route (THEMIS night IR)');
    // consumables
    if (st.mode === 'eva') {
      const o2p = r.o2 / P.o2, bp = r.totalS / 3600 / P.battH;
      add(o2p <= .75 ? 'ok' : o2p <= .9 ? 'warn' : 'bad', `O₂ use ${fmt(r.o2, 2)} kg = ${fmt(o2p * 100)}% of ${P.o2} kg usable (25% reserve rule)`);
      add(bp <= .75 ? 'ok' : bp <= .9 ? 'warn' : 'bad', `EVA duration ${fmt(r.totalS / 3600, 1)} h = ${fmt(bp * 100)}% of ${P.battH} h suit battery`);
      add(r.far <= P.walkback ? 'ok' : 'bad', `Farthest point ${fmt(r.far / 1000, 2)} km from habitat (walk-back limit ${P.walkback / 1000} km)`);
    } else {
      const bp = r.kwh / P.battKWh;
      add(bp <= .75 ? 'ok' : bp <= .9 ? 'warn' : 'bad', `Drive energy ${fmt(r.kwh, 1)} kWh = ${fmt(bp * 100)}% of ${P.battKWh} kWh battery`);
      add(r.far <= P.walkback ? 'ok' : 'warn', `Farthest point ${fmt(r.far / 1000, 1)} km from base (rescue-rover range ${P.walkback / 1000} km)`);
    }
    // environment
    if (r.s0.el < 0) add('bad', `Departure is before sunrise (sun ${fmt(r.s0.el, 0)}°) — change start time`);
    else if (r.minEl < 5) add('warn', `Sun drops to ${fmt(r.minEl, 0)}° during the traverse — return before dusk`);
    else add('ok', `Daylight throughout (sun ≥ ${fmt(r.minEl, 0)}° elevation)`);
    if (MarsTime.dustSeason(r.T0.Ls)) add('warn', `Dust-storm season (Ls ${fmt(r.T0.Ls, 0)}°) — monitor opacity before departure`);
    else add('ok', `Outside main dust-storm season (Ls ${fmt(r.T0.Ls, 0)}°)`);
    { const rd = r.radio, mins = rd.longest / 60;
      if (rd.lost <= 0) add('ok', `Radio line-of-sight to the habitat along the whole route (${r.mast} m mast)`);
      else if (st.mode === 'eva') add(mins > 15 ? 'bad' : 'warn', `Radio blackout on ${fmt(rd.lost / 1000, 2)} km (longest ~${fmt(mins)} min) — terrain blocks the ${r.mast} m habitat mast; raise the mast, add a relay or use orbiter relay`);
      else add('warn', `Radio blackout on ${fmt(rd.lost / 1000, 1)} km (longest ~${fmt(mins)} min) — rely on orbiter relay or a deployable repeater`); }
    add(r.dose < 0.5 ? 'ok' : 'warn', `Radiation ≈ ${fmt(r.dose, 3)} mSv for this sortie (no solar particle event)`);
    const SV = survivability(r, P, st.mode); r.surv = SV;
    const worst = SV.pct >= 85 ? 'go' : SV.pct >= 60 ? 'caution' : 'nogo';
    const label = `Survivability ${fmt(SV.pct)}%<span class="svtag">${{ go: 'low risk', caution: 'elevated risk', nogo: 'high risk' }[worst]}</span>`;
    const endT = new Date(r.start.getTime() + r.totalS * 1000);
    const nBad = r.S.filter(p => hazard(p, P) === 'bad').length, nWarn = r.S.filter(p => hazard(p, P) === 'warn').length;
    let h = `<div class="status ${worst}">● ${label}</div>
    <div class="route-legend"><span><i style="background:${HZ_COL.ok}"></i>safe</span><span><i style="background:${HZ_COL.warn}"></i>look out (${nWarn})</span><span><i style="background:${HZ_COL.bad}"></i>danger (${nBad})</span><span>⚠ blinking = loose sand</span><span><i style="background:${RADIO_COL}"></i>no radio</span></div>
    <div class="route-actions"><button class="btn pri sm" id="btnSim">▶ Simulate traverse</button><button class="btn sm" id="btn3D" title="Fly the route in 3D: first-person, chase or orbit camera">🧊 3D view</button>${nBad || r.relaxed ? '<button class="btn sm" id="btnReroute" style="border-color:var(--bad);color:#ff8080">↻ Reroute around danger</button>' : ''}</div>
    <div class="card" style="margin-top:8px"><div class="kv">
      <span>Route length</span><span>${fmt(r.S[r.S.length - 1].d / 1000, 2)} km</span>
      <span>Ascent / descent</span><span>+${fmt(r.asc)} / −${fmt(r.desc)} m</span>
      <span>Max / mean slope</span><span>${fmt(r.maxSl, 1)}° / ${fmt(r.S.reduce((a, b) => a + b.slope, 0) / r.S.length, 1)}°</span>
      <span>Elevation range</span><span>${fmt(Math.min(...r.S.map(p => p.h)))} … ${fmt(Math.max(...r.S.map(p => p.h)))} m</span>
      <span>${st.mode === 'eva' ? 'Walking' : 'Driving'} time</span><span>${fmt(r.t / 3600, 2)} h</span>
      <span>Science dwell</span><span>${fmt(r.dwellS / 60)} min</span>
      <span>Total sortie</span><span>${fmt(r.totalS / 3600, 2)} h</span>`;
    if (st.mode === 'eva') h += `<span>Metabolic energy</span><span>${fmt(r.E / 1e6, 2)} MJ</span><span>Avg metabolic rate</span><span>${fmt(r.E / r.totalS)} W</span><span>Oxygen consumed</span><span>${fmt(r.o2, 3)} kg</span>`;
    else h += `<span>Drive energy</span><span>${fmt(r.kwh, 1)} kWh</span><span>Suit O₂ at stops</span><span>${fmt(r.roverEvaO2, 3)} kg/crew</span>`;
    h += `<span>Radio coverage</span><span>${fmt(r.radio.frac * 100)}% of route</span>
      <span>Radiation dose</span><span>${fmt(r.dose, 3)} mSv</span>
      <span>Pressure (mean alt.)</span><span>${fmt(pressure(r.hMean))} Pa</span>
    </div></div>`;
    if (st.mode === 'eva') {
      const o2p = Math.min(1, r.o2 / P.o2), bp = Math.min(1, r.totalS / 3600 / P.battH);
      h += `<div class="card"><div class="small">O₂ budget</div><div class="bar"><i style="width:${o2p * 100}%;background:${o2p > .9 ? 'var(--bad)' : o2p > .75 ? 'var(--warn)' : 'var(--ok)'}"></i></div>
        <div class="small" style="margin-top:6px">Suit battery</div><div class="bar"><i style="width:${bp * 100}%;background:${bp > .9 ? 'var(--bad)' : bp > .75 ? 'var(--warn)' : 'var(--ok)'}"></i></div></div>`;
    }
    h += `<div class="card"><div class="kv">
      <span>Depart (UTC)</span><span>${r.start.toISOString().slice(0, 16).replace('T', ' ')}</span>
      <span>Depart (local solar)</span><span>${MarsTime.fmtH(r.s0.ltst)} LTST</span>
      <span>Return (local solar)</span><span>${MarsTime.fmtH(r.s1.ltst)} LTST</span>
      <span>Sun at depart / return</span><span>${fmt(r.s0.el, 0)}° / ${fmt(r.s1.el, 0)}°</span>
      <span>Season</span><span>MY${r.T0.MY} · Ls ${fmt(r.T0.Ls, 1)}°</span>
    </div><div class="note">${MarsTime.season(r.T0.Ls, st.hab.lat)}</div></div>
    <h3>What the ${fmt(SV.pct)}% is based on</h3>
    <div class="card sv"><table class="svtab">${SV.factors.map(f => `<tr class="${f.p >= .97 ? 'ok' : f.p >= .8 ? 'warn' : 'bad'}"><td><b>${f.name}</b><div class="muted small">${f.why}</div></td><td class="svp">${fmt(f.p * 100)}%</td></tr>`).join('')}</table>
      <div class="note" style="margin:6px 0 0">Each factor is a survival chance worked out from how close the plan comes to a safety limit; the overall score multiplies them. It is a planning index from first-order models, not a measured probability.</div></div>
    <h3>Safety checklist</h3><ul class="checks">${checks.map(([l, m]) => `<li class="${l}">${m}</li>`).join('')}</ul>
    <h3>Science objectives</h3><ul class="checks">${st.wps.map((w, i) => `<li class="ok"><b>${i + 1}. ${esc(w.n)}</b> — ${esc(w.task)} (${w.dwell} min)${sciNote(w)}</li>`).join('')}</ul>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="btnGeo">Download GeoJSON</button><button class="btn sm" id="btnBrief">Mission brief</button><button class="btn sm" id="btnLink">Copy link</button></div>
    <p class="note">Models: walking speed — Tobler hiking function ×0.6 suited penalty; metabolic cost — Pandolf (1977) load-carriage equation with weight terms scaled to 0.38 g; O₂ — 20.1 kJ per litre; radio — line-of-sight from habitat mast to crew antenna over MOLA terrain with Mars curvature; terrain — MOLA elevation tiles (~1.3 km per pixel as served) for elevation + HRSC/MOLA 200 m shaded relief for local steepness (craters, scarps) + THEMIS night-IR thermal inertia; sun — Mars24 (Allison &amp; McEwen 2000); radiation — MSL/RAD surface baseline (Hassler et al. 2014). Planning aid, not flight-certified.</p>`;
    $('#telemetry').innerHTML = h;
    $('#btnSim').onclick = () => Sim.start(st.route, PROFILES[st.mode], st.hab);
    $('#btn3D').onclick = () => View3D.open(st.route, PROFILES[st.mode], st.hab, st.wps);
    if ($('#btnReroute')) $('#btnReroute').onclick = async () => { st.strict = true; await compute(); st.strict = false; const P2 = PROFILES[st.mode]; toast(st.route && st.route.S.some(p => hazard(p, P2) === 'bad') ? '⚠ No fully safe path exists at this resolution — red sections remain; consider moving the waypoint.' : '✓ Rerouted: route now avoids danger zones.', 5000); };
    $('#btnGeo').onclick = exportGeo; $('#btnBrief').onclick = brief; $('#btnLink').onclick = () => { saveHash(); navigator.clipboard?.writeText(location.href); toast('Link to this plan copied'); };
  }
  function sciNote(w) {
    const h = elev(w.lat, w.lon), t = themis.val(5, w.lat, w.lon);
    const near = nearestName(w.lat, w.lon);
    let s = ` · elev ${fmt(h)} m`;
    if (!isNaN(t)) s += t > 140 ? ' · high thermal inertia → exposed bedrock, good for intact samples' : t < 55 ? ' · low thermal inertia → fine dust cover, expect soft footing' : ' · moderate thermal inertia (mixed rock / regolith)';
    if (near) s += ` · near ${near.n} (${fmt(near.d / 1000, 0)} km)`;
    return `<span class="muted">${s}</span>`;
  }
  function exportGeo() {
    const r = st.route; const fc = { type: 'FeatureCollection', name: "Our Neighbor's Map EVA plan", crs: { type: 'name', properties: { name: 'IAU_2015:49900 (Mars 2000 sphere, east-positive)' } }, features: [
      { type: 'Feature', properties: { kind: 'route', mode: st.mode, length_m: Math.round(r.S[r.S.length - 1].d), duration_h: +(r.totalS / 3600).toFixed(2) }, geometry: { type: 'LineString', coordinates: r.S.map(p => [+p.lon.toFixed(6), +p.lat.toFixed(6), Math.round(p.h)]) } },
      { type: 'Feature', properties: { kind: 'habitat', name: st.hab.n }, geometry: { type: 'Point', coordinates: [st.hab.lon, st.hab.lat] } },
      ...st.wps.map((w, i) => ({ type: 'Feature', properties: { kind: 'waypoint', order: i + 1, name: w.n, task: w.task, dwell_min: w.dwell }, geometry: { type: 'Point', coordinates: [w.lon, w.lat] } }))] };
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(fc, null, 1)], { type: 'application/geo+json' })), download: 'marswalk_plan.geojson' }); a.click();
  }
  function brief() {
    const w = window.open('', '_blank'); const tel = $('#telemetry').innerHTML; const prof = $('#profile canvas').toDataURL();
    w.document.write(`<html><head><title>Marswalk mission brief</title><style>:root{--ok:#1aa36a;--warn:#e0a800;--bad:#d33}body{font:13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#111;padding:24px;max-width:780px;margin:auto}h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:16px 0 6px}.card{background:#f6f6f6;border:1px solid #ddd;border-radius:8px;padding:10px;margin:8px 0}.kv{display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}.kv span:nth-child(odd){color:#555;font-family:inherit}.status{padding:8px 10px;border-radius:8px;font-weight:700;margin-top:10px}.status.go{background:#e5f7ee;color:#0b7a46}.status.caution{background:#fff4d6;color:#8a6200}.status.nogo{background:#fde3e3;color:#b00000}.checks{list-style:none;padding:0}.checks li{padding:3px 0 3px 16px;position:relative}.checks li:before{content:'';position:absolute;left:2px;top:8px;width:8px;height:8px;border-radius:50%}.checks li.ok:before{background:#1aa36a}.checks li.warn:before{background:#e0a800}.checks li.bad:before{background:#d33}.bar{height:6px;background:#ddd;border-radius:3px;overflow:hidden}.bar i{display:block;height:100%}.note,.muted{color:#555;font-size:11px}.small{font-size:11px}button{display:none}</style></head><body><h1 style="margin:0">Marswalk mission brief</h1><p>${esc(st.hab.n)} · ${fmtLL(st.hab.lat, st.hab.lon)} · ${PROFILES[st.mode].label}</p><img src="${prof}" style="width:100%;border:1px solid #ddd;border-radius:8px;background:#111">${tel}<p class="note">Generated by Our Neighbor's Map · NASA Space Apps Challenge 2026</p><script>setTimeout(()=>print(),400)<\/script></body></html>`);
    w.document.close();
  }
  function saveHash() {
    const o = { m: st.mode, h: st.hab && [st.hab.n, +st.hab.lat.toFixed(5), +st.hab.lon.toFixed(5)], w: st.wps.map(w => [w.n, +w.lat.toFixed(5), +w.lon.toFixed(5), w.task, w.dwell]), r: st.returnHome ? 1 : 0 };
    history.replaceState(null, '', '#plan=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o))))));
  }
  function loadHash() {
    const m = location.hash.match(/plan=([^&]+)/); if (!m) return false;
    try {
      const o = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
      // check every value before using it: a damaged or hand-made link must not break the planner
      const bad = () => { throw new Error('bad plan link'); };
      const num = (v, lo, hi) => { v = +v; return Number.isFinite(v) && v >= lo && v <= hi ? v : bad(); };
      const txt = (v, d) => (v == null || v === '' ? d : String(v)).slice(0, 80);
      if (!o || !Object.prototype.hasOwnProperty.call(PROFILES, o.m)) bad();
      const hab = o.h ? { n: txt(o.h[0], 'Habitat'), lat: num(o.h[1], -90, 90), lon: num(o.h[2], -180, 180) } : null;
      const wps = (Array.isArray(o.w) ? o.w : []).slice(0, 30).map((a, i) => Array.isArray(a) ? ({ n: txt(a[0], `Waypoint ${i + 1}`), lat: num(a[1], -90, 90), lon: num(a[2], -180, 180), task: txt(a[3], 'Sample collection'), dwell: clamp(Math.round(+a[4]) || 0, 0, 600) }) : bad());
      st.mode = o.m; st.returnHome = !!o.r; st.hab = hab; st.wps = wps;
      syncUI(); renderList(); redrawMarkers();
      if (st.hab) map.setView([st.hab.lat, st.hab.lon], 11);
      if (st.hab && st.wps.length) compute();
      return true;
    } catch (e) { history.replaceState(null, '', location.pathname + location.search); toast('⚠ This plan link is damaged or not from Our Neighbor\'s Map, so it was ignored.', 6000); return false; }
  }
  function syncUI() { $('#mode').value = st.mode; $('#retHome').checked = st.returnHome; renderList(); renderSettings(); }
  function loadPreset(id) {
    const p = PRESETS.find(x => x.id === id); if (!p) return;
    st.mode = p.mode; st.returnHome = p.ret !== false; st.hab = { ...p.hab }; st.wps = p.wps.map(w => ({ ...w })); st.start = null; $('#start').value = '';
    $('#qres').innerHTML = ''; $('#q').value = '';
    if (p.note) toast(p.note, 7000);
    syncUI(); clearRoute(); redrawMarkers(); map.setView([p.view[0], p.view[1]], p.view[2]);
    // switch on the best imagery for that site
    const ov = { jezero: ['jez_h', 'jez_c'], gale: ['gale_h', 'gale_c'] }[id] || [];
    ov.forEach(o => { const c = $('#o_' + o); if (c && !c.checked) { c.checked = true; toggleOverlay(o, true); } });
    Conditions.setPoint(p.hab.lat, p.hab.lon);
    setTimeout(compute, 300);
  }
  function habAt(lat, lon, n) { st.hab = { n: n || 'Habitat', lat, lon }; map.closePopup(); switchTab('plan'); clearRoute(); renderList(); redrawMarkers(); map.setView([lat, lon], Math.max(map.getZoom(), 11)); Conditions.setPoint(lat, lon); }
  function init() {
    $('#p-plan').innerHTML = `
      <h3>Mission profile</h3>
      <div class="card">
        <div class="row"><select id="mode"><option value="eva">${PROFILES.eva.label}</option><option value="rover">${PROFILES.rover.label}</option></select></div>
        <div class="row"><span class="muted small">Slope limit <b id="maxSlope"></b></span><span class="sp"></span><label class="small"><input type="checkbox" id="retHome" checked> Return to habitat</label></div>
        <div class="row"><span class="muted small" style="white-space:nowrap">Depart (UTC)</span><input type="datetime-local" id="start"><button class="btn sm" id="btnMorning" title="Next 09:00 local solar time at the habitat">09:00 LTST</button></div>
      </div>
      <h3 id="suitHead">⚙ Suit, crew &amp; resources</h3>
      <div class="card settings" id="suitFields"></div>
      <h3>Preset missions</h3>
      <div class="grid2">${PRESETS.map(p => `<button class="btn sm" data-preset="${p.id}">${p.name}</button>`).join('')}</div>
      <h3>Habitat & science waypoints</h3>
      <div class="row"><button class="btn" id="btnHab">⌂ Place habitat</button><button class="btn" id="btnWp">＋ Add waypoints</button><span class="sp"></span><button class="btn sm" id="btnClear">Clear</button></div>
      <div id="wplist" style="margin-top:8px"></div>
      <button class="btn pri" id="btnPlan" style="width:100%;margin-top:10px">Compute safe route</button>
      <div id="telemetry" style="margin-top:12px"></div>`;
    $('#mode').onchange = e => { st.mode = e.target.value; clearRoute(); renderList(); renderSettings(); };
    $('#retHome').onchange = e => { st.returnHome = e.target.checked; clearRoute(); };
    $('#start').onchange = e => { st.start = e.target.value ? new Date(e.target.value + 'Z') : null; };
    $('#btnMorning').onclick = () => { if (!st.hab) return toast('Place a habitat first'); st.start = MarsTime.nextLTST(new Date(), st.hab.lon, 9); $('#start').value = st.start.toISOString().slice(0, 16); };
    $('#btnHab').onclick = () => setClick('hab'); $('#btnWp').onclick = () => setClick('wp');
    $('#btnClear').onclick = () => { st.hab = null; st.wps = []; clearRoute(); renderList(); redrawMarkers(); history.replaceState(null, '', location.pathname); };
    $('#btnPlan').onclick = compute;
    $$('[data-preset]').forEach(b => b.onclick = () => loadPreset(b.dataset.preset));
    renderList(); renderSettings();
  }
  // editable consumables & limits (defaults are typical planning values)
  const SETTINGS = {
    eva: [['o2', 'Usable O₂ in suit', 'kg', 0.2, 5, 0.05], ['battH', 'Suit battery life', 'h', 1, 24, 0.5], ['maxSlope', 'Max walkable slope', '°', 5, 35, 1], ['crew', 'Astronaut mass', 'kg', 40, 130, 1], ['load', 'Suit + backpack mass', 'kg', 10, 150, 1], ['walkback', 'Walk-back limit', 'km', 1, 50, 0.5, 1000], ['mast', 'Habitat radio mast height', 'm', 1, 100, 1]],
    rover: [['battKWh', 'Rover battery', 'kWh', 5, 500, 5], ['maxSlope', 'Max drivable slope', '°', 5, 40, 1], ['mass', 'Rover mass', 'kg', 300, 15000, 50], ['speed', 'Cruise speed', 'km/h', 1, 30, 0.5], ['walkback', 'Rescue range', 'km', 5, 300, 5, 1000], ['mast', 'Habitat radio mast height', 'm', 1, 100, 1]],
  };
  function renderSettings() {
    const P = PROFILES[st.mode];
    $('#suitHead').textContent = st.mode === 'eva' ? '⚙ Suit, crew & resources' : '⚙ Rover & resources';
    $('#suitFields').innerHTML = SETTINGS[st.mode].map(([k, lab, u, mn, mx, stp, sc = 1]) => `<label class="setrow"><span>${lab}</span><input type="number" data-set="${k}" min="${mn}" max="${mx}" step="${stp}" value="${+(P[k] / sc).toFixed(3)}"><em>${u}</em></label>`).join('') +
      `<div class="row" style="margin-top:8px"><button class="btn sm" id="setReset">↺ Reset defaults</button><span class="note" style="margin:0">Edits re-run the route automatically.</span></div>`;
    $$('[data-set]').forEach(inp => inp.onchange = () => {
      const def = SETTINGS[st.mode].find(d => d[0] === inp.dataset.set), sc = def[6] || 1;
      const raw = inp.value.trim() === '' ? NaN : +inp.value;
      if (!Number.isFinite(raw)) { inp.value = +(P[def[0]] / sc).toFixed(3); toast('Please type a number — kept the previous value.'); return; }   // blank / junk: keep the old value
      const v = clamp(raw, def[3], def[4]); inp.value = v; P[def[0]] = v * sc;
      renderList(); if (st.route) { toast('Settings changed — recomputing route…'); compute(); }
    });
    $('#setReset').onclick = () => { Object.assign(PROFILES[st.mode], PROFILE_DEFAULTS[st.mode]); renderSettings(); renderList(); if (st.route) compute(); };
  }
  function addWp(lat, lon, n) { st.wps.push({ n: n || `Waypoint ${st.wps.length + 1}`, lat, lon, task: 'Sample collection', dwell: 30 }); switchTab('plan'); clearRoute(); renderList(); redrawMarkers(); if (!st.hab) toast('Waypoint added — now place a habitat'); }
  function startAt(lat, lon, n) { habAt(lat, lon, 'Habitat · ' + n); if (st.click !== 'wp') setClick('wp'); toast('✓ Habitat placed. Now click the map to add science stops, then press <b>Compute safe route</b>.', 6000); }
  function setMode(m) { if (m === st.mode) return; st.mode = m; $('#mode').value = m; clearRoute(); renderList(); renderSettings(); }
  function setReturn(b) { st.returnHome = !!b; $('#retHome').checked = st.returnHome; clearRoute(); }
  function removeWp(i) { st.wps.splice(i, 1); clearRoute(); renderList(); redrawMarkers(); }
  function clearAll() { st.hab = null; st.wps = []; clearRoute(); renderList(); redrawMarkers(); history.replaceState(null, '', location.pathname + location.search); }
  return { init, habAt, addWp, startAt, loadPreset, loadHash, compute, setClick, setMode, setReturn, removeWp, clearAll, get state() { return st; }, setHover(p) { if (!p) { hoverMk && map.removeLayer(hoverMk); hoverMk = null; return; } if (!hoverMk) hoverMk = L.circleMarker([p.lat, p.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#e0603a', fillOpacity: 1 }).addTo(map); else hoverMk.setLatLng([p.lat, p.lon]); } };
})();

// ---------------------------------------------------------------------
//  Survivability index: product of per-hazard survival factors (1 = no added risk)
// ---------------------------------------------------------------------
function consumableF(u) {        // u = fraction of capacity used; 25 % reserve rule
  if (u <= 0.75) return 1;
  if (u <= 0.9) return 1 - (u - 0.75) / 0.15 * 0.15;          // reserve eaten into: 100 → 85 %
  if (u <= 1) return 0.85 - (u - 0.9) / 0.1 * 0.45;            // no reserve left: 85 → 40 %
  return 0.4 * Math.exp(-4 * (u - 1));                         // runs out before return: survival relies on rescue
}
function survivability(r, P, mode) {
  const F = [], add = (name, p, why) => F.push({ name, p: clamp(p, 0.001, 1), why });
  const S = r.S; let badL = 0, steepL = 0;
  for (let i = 1; i < S.length; i++) { const ds = S[i].d - S[i - 1].d, hz = hazard(S[i], P); if (hz === 'bad') badL += ds; else if (S[i].slope > P.maxSlope * 0.5) steepL += ds; }
  if (mode === 'eva') {
    const uo = r.o2 / P.o2, ub = r.totalS / 3600 / P.battH;
    add('Oxygen', consumableF(uo), `${fmt(r.o2, 2)} kg needed of ${P.o2} kg usable (${fmt(uo * 100)}%). Full marks up to 75 % (25 % reserve).`);
    add('Suit battery / life support', consumableF(ub), `${fmt(r.totalS / 3600, 1)} h sortie on a ${P.battH} h battery (${fmt(ub * 100)}%).`);
  } else {
    const ue = r.kwh / P.battKWh;
    add('Rover battery', consumableF(ue), `${fmt(r.kwh, 1)} kWh of ${P.battKWh} kWh (${fmt(ue * 100)}%). Full marks up to 75 %.`);
  }
  const fr = r.far / P.walkback;
  add(mode === 'eva' ? 'Walk-back distance' : 'Rescue range', fr <= 1 ? 1 : 0.9 * Math.exp(-1.5 * (fr - 1)), `Farthest point ${fmt(r.far / 1000, 1)} km from base; limit ${fmt(P.walkback / 1000)} km${mode === 'eva' ? ' (how far a crew can walk home if the suit or rover fails)' : ''}.`);
  add('Slopes over the limit', Math.exp(-badL / 1500), badL > 0 ? `${fmt(badL / 1000, 2)} km steeper than ${P.maxSlope}° (each 1.5 km cuts the chance to about a third). Use Reroute.` : `No section steeper than ${P.maxSlope}°.`);
  add('Steep but allowed ground', Math.exp(-steepL / (mode === 'eva' ? 30000 : 60000)), `${fmt(steepL / 1000, 2)} km between ${fmt(P.maxSlope / 2)}° and ${P.maxSlope}° (fall / tip-over risk).`);
  const noTI = S.filter(p => p.noTI).length / S.length;          // share of the route with no thermal (sand) data
  add('Loose sand / dust', Math.exp(-r.loose / 25000) * (1 - 0.1 * noTI), noTI > 0.05 ? `${fmt(r.loose / 1000, 2)} km of known loose ground; no ground-firmness data for ${fmt(noTI * 100)}% of the route (THEMIS covers ±65° only), so it counts as unknown, not safe.`.replace('(THEMIS covers ±65° only)', S.some(p => p.noTI && Math.abs(p.lat) <= 65) ? '(thermal data did not load or has a gap here)' : '(THEMIS covers ±65° only)') : `${fmt(r.loose / 1000, 2)} km over low thermal-inertia ground (THEMIS night IR).`);
  const dk = mode === 'eva' ? 1 : 0.5;   // a pressurized rover has lights and heating: half the penalty
  add('Daylight', 1 - dk * (r.s0.el < 0 ? 0.3 : r.minEl < 0 ? 0.4 : r.minEl < 5 ? 0.15 : 0), r.s0.el < 0 ? 'Departs before sunrise.' : r.minEl < 0 ? 'Sun sets before the crew is back.' : r.minEl < 5 ? `Sun drops to ${fmt(r.minEl)}° (dusk).` : `Sun stays above ${fmt(r.minEl)}° (Mars24).`);
  const lm = r.radio ? r.radio.longest / 60 : 0;
  add('Radio contact with habitat', Math.exp(-lm / (mode === 'eva' ? 400 : 1200)), lm > 0 ? `Longest blackout about ${fmt(lm)} min (${fmt((1 - r.radio.frac) * 100)}% of the route out of line-of-sight of the ${r.mast} m mast).` : `Line-of-sight to the ${r.mast} m mast the whole way.`);
  add('Dust-storm season', MarsTime.dustSeason(r.T0.Ls) ? 0.97 : 1, `Ls ${fmt(r.T0.Ls)}°${MarsTime.dustSeason(r.T0.Ls) ? ': inside the main storm season' : ': outside the main storm season'}.`);
  add('Radiation', Math.exp(-r.dose / 100), `${fmt(r.dose, 3)} mSv for this sortie (MSL/RAD surface baseline, quiet sun).`);
  const satF = S.filter(p => p.sat).length / S.length;           // share of the route above the elevation-data ceiling (slopes unknown there)
  const shF = S.filter(p => p.noShade).length / S.length;        // share of the route where the 200 m shading did not load
  if (shF > 0.05) add('Detailed terrain data', 1 - 0.3 * shF, `The 200 m terrain shading did not load for ${fmt(shF * 100)}% of the route, so small craters and scarps there may be missed (counted as unknown, not safe).`);
  if (r.relaxed || satF > 0) add('Terrain data confidence', (r.relaxed ? 0.9 : 1) * (1 - 0.3 * satF), [r.relaxed ? 'No path existed under the slope limit, so it was relaxed.' : '', satF > 0 ? `${fmt(satF * 100)}% of the route is above +7.6 km, where the elevation data tops out and slopes can't be measured (counted as unknown, not flat).` : ''].filter(Boolean).join(' '));
  F.sort((a, b) => a.p - b.p);
  return { pct: Math.round(100 * F.reduce((a, f) => a * f.p, 1)), factors: F };
}

// keep fitted content clear of the floating panels
function mapPadding() {
  if (innerWidth <= 900) return { paddingTopLeft: [20, ($('#leftPanel').offsetHeight || 0) + 20], paddingBottomRight: [20, innerHeight * 0.44 + 140] };
  const lp = $('#leftPanel').getBoundingClientRect(), rp = $('#rightPanel'), rw = rp.classList.contains('collapsed') ? 60 : rp.offsetWidth + 24;
  return { paddingTopLeft: [lp.right + 20, 60], paddingBottomRight: [rw + 20, 200] };
}
// route hazard class: green = safe, yellow = look out (steeper than half the limit, or loose sand), red = danger (over the limit)
const HZ_COL = { ok: '#3ccf8e', warn: '#f2b636', bad: '#ff4d4d' };
const RADIO_COL = '#b06cff';
// true when a straight radio path from the habitat antenna (altitude ha, ground ga) to point q (antenna altitude hb, ground gb)
// clears the terrain and the curve of Mars. The MOLA tiles are 8-bit (≈58 m height steps), so terrain must poke above the ray by
// more than ~half a step to count as a blocker; curvature is checked separately against a smooth sphere through the lower ground point.
function losClear(a, ha, q, hb, ga = ha, gb = hb) {
  const b = { lat: q.lat, lon: q.lon + 360 * Math.round((a.lon - q.lon) / 360) };
  const d = hav(a, b); if (d < 60) return true;
  const n = Math.min(200, Math.max(4, Math.ceil(d / 230))), tol = 0.6 * DEM.b, g0 = Math.min(ga, gb);
  for (let k = 1; k < n; k++) {
    const f = k / n, d1 = d * f, bulge = d1 * (d - d1) / (2 * R_MARS), ray = ha + (hb - ha) * f;
    if (g0 + bulge > ray) return false;                                   // smooth-Mars radio horizon
    const h = elev(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f); if (isNaN(h)) continue;
    if (h - tol + bulge > ray) return false;                              // terrain (hill, crater rim, canyon wall)
  }
  return true;
}
function hazard(p, P) { return p.slope > P.maxSlope ? 'bad' : (p.loose || p.slope > P.maxSlope * 0.5) ? 'warn' : 'ok'; }
function nearestName(lat, lon) {
  let best = null; for (const [n, , la, lo] of GAZ) { const d = hav({ lat, lon }, { lat: la, lon: lo }); if (!best || d < best.d) best = { n, d }; }
  return best && best.d < 300000 ? best : null;
}

// ---------------------------------------------------------------------
//  Elevation profile chart
// ---------------------------------------------------------------------
const Profile = (() => {
  const cv = $('#profile canvas'); let R = null, geo = null;
  function draw(r) {
    R = r; $('#profile').classList.add('on'); document.body.classList.add('profile-on');
    requestAnimationFrame(render);
  }
  function render(hx) {
    if (!R) return;
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.fillStyle = '#12161b'; g.fillRect(0, 0, W, H);
    const S = R.S, L0 = 58, R0 = 18, T0 = 18, B0 = 26;
    const hs = S.map(p => p.h).filter(v => !isNaN(v)); let lo = Math.min(...hs), hi = Math.max(...hs); const pad = Math.max(20, (hi - lo) * .15); lo -= pad; hi += pad;
    const D = S[S.length - 1].d || 1, X = d => L0 + (W - L0 - R0) * d / D, Y = h => T0 + (H - T0 - B0) * (1 - (h - lo) / (hi - lo));
    geo = { X, Y, D, L0, R0, W };
    g.strokeStyle = '#252c35'; g.fillStyle = '#8d949d'; g.font = '10.5px ui-monospace,monospace'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const h = lo + (hi - lo) * i / 4, y = Y(h); g.beginPath(); g.moveTo(L0, y); g.lineTo(W - R0, y); g.stroke(); g.fillText(fmt(h) + ' m', 4, y + 3); }
    const step = niceStep(D / 1000 / 8);
    for (let k = 0; k <= D / 1000; k += step) { const x = X(k * 1000); g.fillText(fmt(k, step < 1 ? 1 : 0) + ' km', x - 12, H - 8); }
    // area
    g.beginPath(); g.moveTo(X(0), Y(lo)); S.forEach(p => g.lineTo(X(p.d), Y(isNaN(p.h) ? lo : p.h))); g.lineTo(X(D), Y(lo)); g.closePath();
    const grd = g.createLinearGradient(0, T0, 0, H); grd.addColorStop(0, '#e0603a55'); grd.addColorStop(1, '#e0603a05'); g.fillStyle = grd; g.fill();
    const P = PROFILES[R.mode];
    g.fillStyle = RADIO_COL + '30'; for (let i = 1; i < S.length; i++) if (S[i].nolos) g.fillRect(X(S[i - 1].d), T0, Math.max(1, X(S[i].d) - X(S[i - 1].d)), H - T0 - B0);
    for (let i = 1; i < S.length; i++) { g.strokeStyle = HZ_COL[hazard(S[i], P)]; g.lineWidth = 2.2; g.beginPath(); g.moveTo(X(S[i - 1].d), Y(S[i - 1].h)); g.lineTo(X(S[i].d), Y(S[i].h)); g.stroke(); }
    // waypoint ticks
    let lastLeg = 0; g.fillStyle = '#fff';
    S.forEach((p, i) => { if (i && p.leg !== lastLeg) { const x = X(S[i - 1].d); g.strokeStyle = '#ffffff55'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, T0); g.lineTo(x, H - B0); g.stroke(); g.setLineDash([]); g.fillText(`◆${lastLeg + 1}`, x + 3, T0 + 10); lastLeg = p.leg; } });
    g.fillStyle = '#e7e2db'; g.font = '600 11px system-ui'; g.fillText('Elevation profile (MOLA)  ·  green safe  ·  yellow look out (steep / loose sand)  ·  red danger  ·  purple band = no radio to habitat', L0, 12);
    if (hx != null && typeof hx === 'number') {
      const d = clamp((hx - L0) / (W - L0 - R0), 0, 1) * D; let i = S.findIndex(p => p.d >= d); if (i < 0) i = S.length - 1; const p = S[i];
      g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(X(p.d), T0); g.lineTo(X(p.d), H - B0); g.stroke();
      const txt = `${fmt(p.d / 1000, 2)} km · ${fmt(p.h)} m · ${fmt(p.slope, 1)}°${p.loose ? ' · loose' : ''}${p.nolos ? ' · no radio' : ''}`; g.font = '11px ui-monospace,monospace';
      const tw = g.measureText(txt).width + 12, tx = clamp(X(p.d) + 8, L0, W - tw - 4); g.fillStyle = '#000c'; g.fillRect(tx, T0 + 16, tw, 20); g.fillStyle = '#fff'; g.fillText(txt, tx + 6, T0 + 30);
      Planner.setHover(p);
    }
  }
  const niceStep = v => { const p = 10 ** Math.floor(Math.log10(v || 1)), m = v / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
  cv.addEventListener('mousemove', e => render(e.offsetX));
  cv.addEventListener('mouseleave', () => { render(); Planner.setHover(null); });
  addEventListener('resize', () => R && render());
  return { draw };
})();

// ---------------------------------------------------------------------
//  Conditions: Mars clock, sun at a point, live REMS weather, space weather
// ---------------------------------------------------------------------
const Conditions = (() => {
  let pt = { lat: 18.44, lon: 77.45 }, ptMk = null;
  function setPoint(lat, lon) {
    pt = { lat, lon };
    if (!ptMk) ptMk = L.circleMarker([lat, lon], { radius: 5, color: '#5bb4ff', weight: 2, fillOpacity: 0 }).addTo(map); else ptMk.setLatLng([lat, lon]);
    dem.ensure(DEM.maxZ, lat - .1, lon - .1, lat + .1, lon + .1).then(() => themis.ensure(5, lat - .1, lon - .1, lat + .1, lon + .1)).then(renderPoint);
    renderPoint();
  }
  function renderPoint() {
    const s = MarsTime.sun(new Date(), pt.lat, pt.lon), h = elev(pt.lat, pt.lon), t = themis.val(5, pt.lat, pt.lon), nm = nearestName(pt.lat, pt.lon);
    const sl = slopeAt(pt.lat, pt.lon);
    $('#ptInfo').innerHTML = `<div class="kv">
      <span>Location</span><span>${fmtLL(pt.lat, pt.lon)}</span>
      <span>Nearest named feature</span><span>${nm ? nm.n + ' · ' + fmt(nm.d / 1000) + ' km' : '—'}</span>
      <span>Elevation (MOLA)</span><span>${elevText(pt.lat, pt.lon, h) || '…'}</span>
      <span>Regional slope</span><span>${isNaN(sl) ? '…' : fmt(sl, 1) + '°'}</span>
      <span>Surface pressure (est.)</span><span>${isNaN(h) ? '…' : fmt(pressure(h)) + ' Pa'}</span>
      <span>Ground (THEMIS night IR)</span><span>${isNaN(t) ? 'no data' : t > 140 ? 'rocky / bedrock' : t < 55 ? 'dusty / loose' : 'mixed'}</span>
      <span>Local true solar time</span><span>${MarsTime.fmtH(s.ltst)}</span>
      <span>Sun elevation / azimuth</span><span>${fmt(s.el, 1)}° / ${fmt(s.az, 0)}°</span>
      <span>Sunrise / sunset (LTST)</span><span>${s.polar ? 'polar ' + s.polar : MarsTime.fmtH(s.rise) + ' / ' + MarsTime.fmtH(s.set)}</span>
      <span>Daylight</span><span>${s.polar === 'day' ? '24.6 h' : s.polar === 'night' ? '0 h' : fmt((s.set - s.rise) * 1.0275, 1) + ' h'}</span>
      <span>Solar flux now (TOA)</span><span>${fmt(s.surfFlux)} W/m²</span>
      <span>Season here</span><span>${MarsTime.season(s.t.Ls, pt.lat)}</span></div>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="ptHab">Put habitat here</button><button class="btn sm" id="ptWp">Add as waypoint</button></div>`;
    $('#ptHab').onclick = () => Planner.habAt(pt.lat, pt.lon);
    $('#ptWp').onclick = () => Planner.addWp(pt.lat, pt.lon, nm ? 'Near ' + nm.n : null);
  }
  function slopeAt(lat, lon) { const h = 1 / dem.ppd(DEM.maxZ); const dx = 2 * h * D2R * R_MARS * Math.cos(lat * D2R), dy = 2 * h * D2R * R_MARS; return Math.atan(Math.hypot((elev(lat, lon + h) - elev(lat, lon - h)) / dx, (elev(lat + h, lon) - elev(lat - h, lon)) / dy)) / D2R; }
  function clock() {
    const t = MarsTime.at(new Date());
    $('#clock').innerHTML = `<div class="kv">
      <span>Mars Year / Ls</span><span>MY${t.MY} · ${fmt(t.Ls, 2)}°</span>
      <span>Mars Sol Date</span><span>${fmt(t.MSD, 4)}</span>
      <span>Coordinated Mars Time</span><span>${MarsTime.fmtH(t.MTC)} MTC</span>
      <span>Sun distance</span><span>${fmt(t.r, 4)} AU</span>
      <span>Solar constant at Mars</span><span>${fmt(t.flux)} W/m²</span>
      <span>Northern season</span><span>${MarsTime.season(t.Ls, 1).replace('northern ', '')}</span>
      <span>Dust-storm season</span><span style="color:${MarsTime.dustSeason(t.Ls) ? 'var(--warn)' : 'var(--ok)'}">${MarsTime.dustSeason(t.Ls) ? 'ACTIVE (Ls 180–330)' : 'quiet'}</span></div>`;
    $('#hudLs').textContent = `MY${t.MY} Ls ${t.Ls.toFixed(1)}°`;
    $('#hudMtc').textContent = MarsTime.fmtH(t.MTC) + ' MTC';
  }
  // Fetch helper: direct → local proxy (server.py) → null
  // Each feed gives up after FEED_TIMEOUT ms; the reason is kept so the user can be told what went wrong.
  const FEED_TIMEOUT = 12000, feedErr = {};
  async function fetchT(url, opts = {}) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), FEED_TIMEOUT);
    try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); }
  }
  async function getJSON(direct, proxy, key) {
    let why = 'no response';
    try { const r = await fetchT(direct, { mode: 'cors' }); if (r.ok) { delete feedErr[key]; return await r.json(); } why = r.status === 429 ? 'NASA rate limit reached' : 'server error ' + r.status; }
    catch (e) { why = e.name === 'AbortError' ? 'timed out after ' + FEED_TIMEOUT / 1000 + ' s' : 'network blocked or offline'; }
    if (location.protocol.startsWith('http')) { try { const r = await fetchT(proxy); if (r.ok) { delete feedErr[key]; return await r.json(); } } catch (e) {} }
    feedErr[key] = why; return null;
  }
  const FEED_NAME = { rems: 'Curiosity weather', swx: 'Space weather', raw: 'Perseverance photos' };
  const retryBtn = key => `<button class="btn sm" data-retry="${key}" style="margin-top:6px">↻ Try again</button>`;
  function wireRetry() { $$('[data-retry]').forEach(b => b.onclick = () => { b.disabled = true; b.textContent = 'Retrying…'; ({ rems: weather, swx: spaceWx, raw: rawImages })[b.dataset.retry]().then(notifyFeeds); }); }
  let lastNote = '';
  function notifyFeeds() {      // one notification listing every live feed that failed, plus a dot on the Weather tab
    wireRetry();
    const bad = Object.keys(feedErr);
    const tab = $('.tabs button[data-tab=cond]'); if (tab) tab.classList.toggle('alertdot', bad.length > 0);
    if (!bad.length) { if (lastNote) toast('✓ Live Mars feeds are back.', 3000); lastNote = ''; return; }
    const msg = bad.map(k => `<b>${FEED_NAME[k]}</b>: ${feedErr[k]}`).join('<br>');
    if (msg === lastNote) return; lastNote = msg;
    toast(`⚠ Some live Mars data didn't load:<br>${msg}<br><span class="muted">Showing saved data where possible. Open <b>Weather</b> to try again.</span>`, 9000);
  }
  async function weather() {
    const j = await getJSON('https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json', 'api/rems', 'rems');
    const live = !!(j && j.soles); const w = live ? j.soles.find(s => s.max_temp !== '--') || j.soles[0] : REMS_SNAPSHOT;
    const age = (Date.now() - Date.parse(w.terrestrial_date + 'T12:00:00Z')) / 864e5;   // days since NASA's latest report
    if ($('#remsAge')) $('#remsAge').textContent = `(NASA's latest report: ${w.terrestrial_date}${age > 3 ? ', ' + fmt(age) + ' days ago' : ''})`;
    $('#rems').innerHTML = `<div class="kv">
      <span>Sol / Earth date</span><span>${w.sol} · ${w.terrestrial_date}</span>
      <span>Air temp min / max</span><span>${w.min_temp} / ${w.max_temp} °C</span>
      <span>Ground temp min / max</span><span>${w.min_gts_temp} / ${w.max_gts_temp} °C</span>
      <span>Pressure</span><span>${w.pressure} Pa</span>
      <span>Sky / UV</span><span>${w.atmo_opacity} · UV ${w.local_uv_irradiance_index}</span>
      <span>Sunrise / sunset</span><span>${w.sunrise} / ${w.sunset}</span></div>
      <p class="note">Curiosity REMS (Centro de Astrobiología / NASA-JPL), Gale crater. ${live ? (age > 3 ? `<span style="color:var(--warn)">● live feed, but NASA's latest report is ${fmt(age)} days old (${w.terrestrial_date})</span>` : '<span style="color:var(--ok)">● live</span>') : `<span style="color:var(--warn)">● saved report from ${w.terrestrial_date} — live feed ${feedErr.rems || 'unavailable'}</span><br>${retryBtn('rems')}`}</p>`;
  }
  async function spaceWx() {
    const end = new Date(), st = new Date(end - 7 * 864e5), f = d => d.toISOString().slice(0, 10);
    const j = await getJSON(`https://api.nasa.gov/DONKI/CME?startDate=${f(st)}&endDate=${f(end)}&api_key=${NASA_API_KEY}`, `api/cme?start=${f(st)}&end=${f(end)}`, 'swx');
    if (!Array.isArray(j)) { $('#swx').innerHTML = `<div class="alert warn" style="animation:none">⚠ Space-weather feed: ${feedErr.swx || 'unavailable'}. Solar-storm check skipped: look at <a href="https://kauai.ccmc.gsfc.nasa.gov/DONKI/" target="_blank" rel="noopener">NASA DONKI</a> before a real EVA.</div>${retryBtn('swx')}`; return; }
    let fast = 0; j.forEach(c => (c.cmeAnalyses || []).forEach(a => fast = Math.max(fast, a.speed || 0)));
    const lvl = fast > 1000 ? 'bad' : fast > 600 ? 'warn' : 'ok';
    $('#swx').innerHTML = `<ul class="checks"><li class="${lvl}">${j.length} coronal mass ejections in the last 7 days · fastest ${fmt(fast)} km/s</li><li class="${lvl === 'ok' ? 'ok' : 'warn'}">${lvl === 'ok' ? 'No fast CME — nominal EVA radiation environment' : 'Fast CME observed — check Mars-directed arrival before long EVAs'}</li></ul><p class="note">NASA CCMC DONKI catalogue. Heliospheric events, not all Mars-directed.</p>`;
  }
  async function rawImages() {
    const j = await getJSON('https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=12&order=sol+desc', 'api/raw', 'raw');
    if (!j || !j.images) { $('#raw').innerHTML = `<span class="muted small">Latest Perseverance photos didn't load (${feedErr.raw || 'unavailable'}).</span><br>${retryBtn('raw')}`; return; }
    const imgs = j.images.filter(i => i.image_files?.small).slice(0, 9);
    $('#raw').innerHTML = `<div class="thumbs">${imgs.map(i => `<a href="${i.image_files.large || i.image_files.medium}" target="_blank" title="Sol ${i.sol} · ${i.camera?.instrument || ''}" style="background-image:url('${i.image_files.small}')"></a>`).join('')}</div><p class="note">Perseverance, sol ${imgs[0]?.sol ?? '—'} — Jezero crater. NASA/JPL-Caltech.</p>`;
  }
  function init() {
    $('#p-cond').innerHTML = `<h3>Mars right now</h3><div class="card" id="clock"></div>
      <h3>Selected point <span class="muted" style="text-transform:none;letter-spacing:0">(click the map)</span></h3><div class="card" id="ptInfo"></div>
      <h3>Surface weather · Gale crater <span class="muted" id="remsAge" style="text-transform:none;letter-spacing:0"></span></h3><div class="card" id="rems">Loading…</div>
      <h3>Space weather</h3><div class="card" id="swx">Loading…</div>
      <h3>Latest from the surface</h3><div class="card" id="raw">Loading…</div>`;
    clock(); setInterval(clock, 1000); setInterval(renderPoint, 30000);
    setPoint(pt.lat, pt.lon); Promise.allSettled([weather(), spaceWx(), rawImages()]).then(notifyFeeds);
  }
  return { init, setPoint };
})();

// ---------------------------------------------------------------------
//  Explore: search, missions, data health
// ---------------------------------------------------------------------
function initExplore() {
  $('#p-explore').innerHTML = `<h3>Missions on the surface</h3><div class="card searchres">${SITES.map((s, i) => `<div data-site="${i}"><b>${s.n}</b> <small>${s.y} · ${fmtLL(s.lat, s.lon)}</small></div>`).join('')}</div>
    <h3>Data sources · live status</h3><div class="card" id="health"></div>
    <h3>About</h3><div class="card small" style="line-height:1.5">Our Neighbor's Map fuses orbital data from <b>NASA</b> (MGS MOLA &amp; TES, Odyssey THEMIS, MRO CTX &amp; HiRISE, Viking), <b>ESA</b> (Mars Express HRSC stereo topography), <b>USGS</b> (global geologic map, IAU nomenclature) and <b>Caltech</b> (global CTX mosaic) into one planner for the first human Marswalks.<br><br><span class="muted">Elevation is read live from MOLA DEM tiles (8-bit, calibrated against landing-site elevations). Route slopes are at MOLA resolution (~1.3 km); always confirm boulder-scale hazards in HiRISE imagery.</span></div>`;
  // ---- search for a base (left panel) ----
  const q = $('#q'), res = $('#qres');
  q.oninput = () => {
    const s = q.value.trim(); let out = [];
    let m = s.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?([\s,]*)(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
    if (m && !m[2] && !/\d\s*°?[\s,]+-?\d/.test(s)) m = null;          // "18.4N77.5E" and "10 250" are fine, "1234" is not a coordinate
    if (m) m = [m[0], m[1], m[2], m[4], m[5]];
    let note = '';
    if (m) {
      // a hemisphere letter decides the sign ("-0.5S" and "0.5S" both mean south); without a letter the number's own sign counts
      let la = m[2] ? Math.abs(+m[1]) * (/s/i.test(m[2]) ? -1 : 1) : +m[1], lo = m[4] ? Math.abs(+m[3]) * (/w/i.test(m[4]) ? -1 : 1) : +m[3];
      lo = ((lo + 180) % 360 + 360) % 360 - 180;                    // any longitude → −180…180 (e.g. 200W = 160E)
      if (Math.abs(la) <= 90 && Number.isFinite(lo)) out.push([`Go to ${fmtLL(la, lo)}`, '', la, lo]);
      else note = 'Latitude must be between 90°S and 90°N.';
    }
    if (s.length > 1) {
      const words = s.toLowerCase().split(/\s+/).filter(Boolean);     // every word must match the name or its type ("gale crater")
      const hit = str => words.every(w => str.toLowerCase().includes(w));
      out = out.concat(SITES.filter(x => hit(x.n + ' landing site lander ' + (/Sojourner|Spirit|Opportunity|Curiosity|Perseverance|Zhurong/i.test(x.n) ? 'rover ' : '') + x.d)).map(x => [x.n, 'Landing site', x.lat, x.lon, x.d]));
      out = out.concat(GAZ.filter(g => hit(g[0] + ' ' + g[1])).slice(0, 12));
    }
    if (!note && !out.length && s.length > 1) note = 'No matches. Try a place name (Gale, Olympus Mons) or coordinates like 18.4N 77.5E.';
    res.innerHTML = (note ? `<div class="muted small" style="padding:6px">${note}</div>` : '') + out.map((g, i) => `<div data-i="${i}"><b>${esc(g[0])}</b> <small>${esc(g[1])} ${g[1] ? '·' : ''} ${fmtLL(g[2], g[3])}</small></div>`).join('');
    $$('#qres [data-i]').forEach(d => d.onclick = () => {
      const g = out[+d.dataset.i];
      map.flyTo([g[2], g[3]], g[1] === 'Crater' || g[1] === 'Landing site' ? 10 : 7, { duration: 1.2 });
      Conditions.setPoint(g[2], g[3]);
      Place.show({ n: g[1] ? g[0] : 'Coordinates', type: g[1] || 'Location', lat: g[2], lon: g[3], desc: g[4] });
      res.innerHTML = ''; q.value = g[1] ? g[0] : q.value;
    });
  };
  q.onkeydown = e => { if (e.key === 'Enter') $('#qres [data-i]')?.click(); };
  $$('[data-site]').forEach(d => d.onclick = () => { const s = SITES[+d.dataset.site]; map.flyTo([s.lat, s.lon], 12, { duration: 1.2 }); Conditions.setPoint(s.lat, s.lon); Place.show({ n: s.n, type: `Landing site · ${s.y}`, lat: s.lat, lon: s.lon, desc: s.d }); });
  // probe each tile source
  const probes = [...BASEMAPS.filter(b => b.url), ...OVERLAYS.filter(o => o.url)];
  $('#health').innerHTML = probes.map(p => `<div class="small" style="padding:2px 0"><span class="health wait" id="h_${p.id}"></span>${p.name}</div>`).join('');
  probes.forEach(p => {
    let z = 0, x = 0, y = 0;
    if (p.bounds) { const [[s, w], [n, e]] = p.bounds, la = (s + n) / 2, lo = (w + e) / 2; z = Math.max(0, p.maxNative - 3); const span = 180 / 2 ** z; x = Math.floor((lo + 180) / span); y = Math.floor((90 - la) / span); }
    const url = p.url.replace('{z}', p.arc ? 0 : z).replace('{y}', y).replace('{x}', x);
    const img = new Image(); img.onload = () => $('#h_' + p.id).className = 'health ok'; img.onerror = () => $('#h_' + p.id).className = 'health bad'; img.src = url;
  });
}

// ---------------------------------------------------------------------
//  Place card (left panel): description of a searched base + "Start mission here"
// ---------------------------------------------------------------------
const FEATURE_INFO = {
  Mons: 'A volcano. Flanks are long and gentle, but summit calderas have cliff walls.', Tholus: 'A small domed volcano.', Patera: 'A shallow volcanic crater.',
  Montes: 'A mountain range — steep, rugged ground.', Crater: 'An impact crater. Rims are steep; floors are often flat and sheltered, good for bases.',
  Chasma: 'A deep canyon. Walls can be several kilometres high — dangerous on foot, spectacular rock layers.', Planitia: 'A low, smooth plain — easy walking and safe landings.',
  Planum: 'A high plateau.', Terra: 'Ancient, heavily cratered highlands.', Vallis: 'An ancient river or flood channel carved by water.',
  Chaos: 'Jumbled, collapsed blocks — very rough terrain, probably where groundwater burst out.', Fossa: 'A long trough or fracture in the crust.',
  Labyrinthus: 'A maze of intersecting canyons.', Mensa: 'A flat-topped mesa with steep sides.', Palus: 'A smooth plain.', Region: 'A large geological province.', Labes: 'A landslide deposit.',
};
const NOTABLE = {
  'Jezero': 'An ancient lake with a river delta — Perseverance is collecting rock samples here that may hold signs of past life.',
  'Gale': 'Home of Curiosity. Its central peak, Mount Sharp, preserves billions of years of lake and climate history in layers.',
  'Korolev (ice-filled)': 'An 82 km crater permanently filled with a ~1.8 km thick mound of water ice — a prime water source for future crews.',
  'Olympus Mons': 'The tallest volcano in the solar system, ~22 km high and as wide as France.',
  'Valles Marineris': 'A canyon system 4,000 km long and up to 7 km deep — it would stretch across the USA.',
  'Hellas Planitia': 'The deepest basin on Mars (~7 km below datum): thickest air, so slightly more radiation shielding.',
  'Utopia Planitia': 'A vast northern plain with buried ice; Viking 2 landed here.',
  'Arabia Terra': 'Old highlands with layered rocks and possible ancient super-volcanoes.',
  'Mawrth Vallis': 'An ancient valley rich in clay minerals — evidence of long-lasting water.',
  'Nili Fossae': 'Troughs with clays and carbonates; one of the most mineral-diverse places on Mars.',
};
const Place = (() => {
  let cur = null, pin = null;
  async function show(p, scroll = true) {
    cur = p;
    if (!pin) pin = L.circleMarker([p.lat, p.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#5bb4ff', fillOpacity: 1, interactive: false }).addTo(map); else pin.setLatLng([p.lat, p.lon]);
    render();
    await dem.ensure(DEM.maxZ, p.lat - .1, p.lon - .1, p.lat + .1, p.lon + .1); await themis.ensure(5, p.lat - .1, p.lon - .1, p.lat + .1, p.lon + .1);
    if (cur === p) render();
  }
  function render() {
    const p = cur; if (!p) { $('#placeCard').innerHTML = ''; return; }
    const kind = (p.type || '').split(' ·')[0], h = elev(p.lat, p.lon), t = themis.val(5, p.lat, p.lon), sun = MarsTime.sun(new Date(), p.lat, p.lon), nm = nearestName(p.lat, p.lon);
    const desc = p.desc || NOTABLE[p.n] || FEATURE_INFO[kind] || (nm ? `About ${fmt(nm.d / 1000)} km from ${nm.n}.` : 'A spot on the Martian surface.');
    const ground = isNaN(t) ? 'no thermal data' : t > 140 ? 'rocky / bedrock (firm)' : t < 55 ? 'dusty / loose (soft)' : 'mixed rock & regolith';
    $('#placeCard').innerHTML = `<div class="place"><button class="x" id="placeX" title="Close" aria-label="Close place card">✕</button>
      <div class="type">${esc(p.type || '')}</div><h2>${esc(p.n)}</h2><div class="muted small" style="font-family:var(--mono)">${fmtLL(p.lat, p.lon)}</div>
      <p>${esc(desc)}</p>
      <div class="kv"><span>Elevation</span><span>${elevText(p.lat, p.lon, h) || '…'}</span><span>Ground</span><span>${ground}</span>
        <span>Local solar time</span><span>${MarsTime.fmtH(sun.ltst)}</span><span>Sun now</span><span>${fmt(sun.el, 0)}° ${sun.el > 0 ? '(day)' : '(night)'}</span>
        <span>Daylight</span><span>${sun.polar === 'day' ? '24.6 h' : sun.polar === 'night' ? '0 h (polar night)' : fmt((sun.set - sun.rise) * 1.0275, 1) + ' h'}</span>
        ${nm && nm.n !== p.n ? `<span>Nearest feature</span><span>${esc(nm.n)} · ${fmt(nm.d / 1000)} km</span>` : ''}</div>
      <button class="btn pri start" id="placeStart">▶ Start mission here</button>
      <div class="row" style="margin-top:6px"><button class="btn sm" id="placeWp">＋ Add as science stop</button><button class="btn sm" id="placeCond">☀ Conditions</button></div></div>`;
    $('#placeX').onclick = () => { cur = null; render(); pin && map.removeLayer(pin); pin = null; };
    $('#placeStart').onclick = () => Planner.startAt(p.lat, p.lon, p.n === 'Dropped pin' ? 'Base' : p.n);
    $('#placeWp').onclick = () => Planner.addWp(p.lat, p.lon, p.n === 'Dropped pin' ? null : p.n);
    $('#placeCond').onclick = () => { Conditions.setPoint(p.lat, p.lon); switchTab('cond'); };
  }
  return { show, get current() { return cur; } };
})();

// ---------------------------------------------------------------------
//  Traverse simulation: an astronaut walks the route; hazards blink as they are crossed
// ---------------------------------------------------------------------
const Sim = (() => {
  let raf = 0, mk = null, R = null, P = null, hab = null, t0 = 0, dur = 0, paused = false, pausedAt = 0, lastPan = 0;
  function stop() { cancelAnimationFrame(raf); raf = 0; if (mk) { map.removeLayer(mk); mk = null; } $('#simHud').style.display = 'none'; }
  function start(route, prof, h) {
    stop(); R = route; P = prof; hab = h; paused = false;
    dur = clamp(R.S[R.S.length - 1].d / 1000 * 2.2, 14, 40) * 1000;   // real seconds for the animation
    mk = L.marker([R.S[0].lat, R.S[0].lon], { icon: L.divIcon({ className: '', html: '<div class="astro"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 2000, interactive: false }).addTo(map);
    $('#simHud').style.display = 'block'; t0 = performance.now(); raf = requestAnimationFrame(step);
  }
  function step(now) {
    if (paused) return;
    const f = Math.min(1, (now - t0) / dur), S = R.S, D = S[S.length - 1].d * f;
    let i = S.findIndex(p => p.d >= D); if (i < 1) i = Math.max(1, i < 0 ? S.length - 1 : 1);
    const a = S[i - 1], b = S[i], u = b.d > a.d ? (D - a.d) / (b.d - a.d) : 0;
    const lat = a.lat + (b.lat - a.lat) * u, lon = Math.abs(b.lon - a.lon) > 180 ? b.lon : a.lon + (b.lon - a.lon) * u;
    mk.setLatLng([lat, lon]);
    if (now - lastPan > 600 && !map.getBounds().pad(-0.2).contains([lat, lon])) { map.panTo([lat, lon], { animate: true, duration: 0.5 }); lastPan = now; }
    Planner.setHover({ lat, lon });
    const tc = a.tc + (b.tc - a.tc) * u, hz = hazard(b, P);
    const when = new Date(R.start.getTime() + tc * 1000), sun = MarsTime.sun(when, hab.lat, hab.lon);
    const hh = Math.floor(tc / 3600), mm = Math.floor(tc % 3600 / 60);
    let res;
    if (R.mode === 'eva') { const o2Left = 1 - (a.ec + (b.ec - a.ec) * u) / 20100 * 1.429e-3 / P.o2; res = `O₂ <b>${fmt(Math.max(0, o2Left) * 100)}%</b>`; }
    else { const bat = 1 - (a.kc + (b.kc - a.kc) * u) / P.battKWh; res = `Battery <b>${fmt(Math.max(0, bat) * 100)}%</b>`; }
    let alert;
    if (hz === 'bad') alert = `<div class="alert bad">⛔ DANGER — slope ${fmt(b.slope, 1)}° exceeds the ${P.maxSlope}° limit. Stop and reroute!</div>`;
    else if (b.nolos) alert = `<div class="alert radio">📡 RADIO BLACKOUT — no line-of-sight to the habitat. Follow the timeline, check in when back in view</div>`;
    else if (b.loose) alert = `<div class="alert warn">⚠ LOOSE SAND — reduce speed, test footing, avoid stopping in soft ground</div>`;
    else if (hz === 'warn') alert = `<div class="alert warn">⚠ LOOK OUT — steep ground (${fmt(b.slope, 1)}°), slow down</div>`;
    else if (sun.el < 5) alert = `<div class="alert warn">⚠ LOW SUN (${fmt(sun.el, 0)}°) — head back to the habitat</div>`;
    else alert = `<div class="alert ok">✓ Terrain nominal</div>`;
    if (f >= 1) alert = `<div class="alert ok">✓ Traverse complete — ${R.S[R.S.length - 1].d > 0 && hav(R.S[R.S.length - 1], hab) < 200 ? 'crew back at the habitat' : 'destination reached'}</div>`;
    $('#simHud').innerHTML = `<div class="simrow"><b>▶ Traverse simulation</b><span class="sp"></span><button class="btn sm" id="simPause" aria-label="${paused ? 'Resume' : 'Pause'}">${paused ? '▶' : '❚❚'}</button><button class="btn sm" id="simStop" aria-label="Stop simulation">✕</button></div>
      <div class="simrow" style="margin-top:4px"><span><b>${fmt(D / 1000, 2)}</b> / ${fmt(S[S.length - 1].d / 1000, 2)} km</span><span>T+<b>${hh}:${String(mm).padStart(2, '0')}</b></span><span>${res}</span><span>☀ <b>${fmt(sun.el, 0)}°</b></span><span>⛰ <b>${fmt(b.h)}</b> m</span><span>📡 <b style="color:${b.nolos ? RADIO_COL : 'var(--ok)'}">${b.nolos ? 'LOST' : 'OK'}</b></span></div>
      <div class="bar"><i style="width:${f * 100}%;background:var(--blue)"></i></div>${alert}`;
    $('#simStop').onclick = () => { stop(); Planner.setHover(null); };
    $('#simPause').onclick = e => { const b = e.currentTarget; if (!paused) { paused = true; pausedAt = performance.now(); b.textContent = '▶'; b.setAttribute('aria-label', 'Resume'); } else { paused = false; t0 += performance.now() - pausedAt; b.textContent = '❚❚'; b.setAttribute('aria-label', 'Pause'); raf = requestAnimationFrame(step); } };
    if (f < 1) raf = requestAnimationFrame(step); else { raf = 0; setTimeout(() => Planner.setHover(null), 1500); }
  }
  return { start, stop, get running() { return !!raf; } };
})();

// ---------------------------------------------------------------------
//  Guided tour (first visit, or the ? button)
// ---------------------------------------------------------------------
const Tour = (() => {
  const TECH_STEPS = [
    { sel: null, t: 'Welcome to Our Neighbor\'s Map', b: 'A mission planner for the first astronauts on Mars. It combines NASA, ESA, USGS and Caltech data so you can plan a safe Marswalk anywhere on the planet. This short tour shows you how.' },
    { sel: '#uiMode', t: 'Simple or Technical', b: 'You are in <b>Technical</b> mode: every layer, number and setting. Switch to <b>Simple</b> for plain words and step-by-step planning.' },
    { sel: '.searchbox', t: '1 · Search for a base', b: 'Type a place — try <b>Jezero</b>, <b>Gale</b> or <b>Olympus Mons</b> — or coordinates like <b>18.4N 77.5E</b>. You can also just click anywhere on the map.' },
    { sel: '#leftPanel', t: '2 · Read about it, then press Start', b: 'A card describes the place: what it is, elevation, ground type and daylight. Press <b>▶ Start mission here</b> to put your habitat there.' },
    { sel: '#rightPanel', t: '3 · Add stops & compute', b: 'After Start, click the map to add science stops, then press <b>Compute safe route</b>. In a hurry? Use one of the one-click <b>Preset missions</b>.', tab: 'plan' },
    { sel: '#map', t: '4 · Read the route colours', b: '<span style="color:#3ccf8e">Green</span> = safe · <span style="color:#f2b636">Yellow</span> = look out (steep or loose sand) · <span style="color:#ff4d4d">Red</span> = danger. Blinking ⚠ marks loose sand. If you see red, press <b>↻ Reroute around danger</b>.' },
    { sel: '#rightPanel', t: '5 · GO / NO-GO and simulation', b: 'The panel shows oxygen, battery, daylight, radiation, radio and a <b>GO / NO-GO</b> verdict. Press <b>▶ Simulate traverse</b> to watch the astronaut walk it, with live hazard warnings.', tab: 'plan' },
    { sel: '#rightPanel', t: '6 · Radio coverage', b: 'A <span style="color:#b06cff">purple</span> glow and 📡 markers show where hills or crater walls block radio line-of-sight to the habitat mast. Set the mast height under <b>⚙ Suit, crew &amp; resources</b>; long blackouts make the EVA a NO-GO.', tab: 'plan' },
    { sel: '#rightPanel', t: '7 · Fly it in 3D', b: 'Press <b>🧊 3D view</b> to walk or drive the route in 3D. Switch between <b>First-person</b>, <b>Chase</b> and <b>Orbit</b> cameras, drag to look around, and watch O₂, hazards and radio live.', tab: 'plan' },
    { sel: '#btnMeasure', t: '8 · Measure distances', b: 'Press the <b>📏 ruler</b>, then click points on the map to get each leg, the total distance and the elevation. Press <b>Esc</b> or <b>Done</b> to finish.' },
    { sel: '.tabs', t: '9 · More modes', b: '<b>Layers</b>: switch maps and turn on the slope-hazard layer. <b>Conditions</b>: Mars clock, live weather, solar storms. <b>Explore</b>: every landing site and data-source status.' },
    { sel: '#btnTour', t: 'That\'s it!', b: 'Press <b>?</b> anytime to see this tour again. Good luck, explorer.' },
  ];
  let k = 0, steps = TECH_STEPS;
  function show() {
    const s = steps[k], el = s.sel && $(s.sel), T = $('#tour');
    if (s.tab) switchTab(s.tab);
    T.style.display = 'block';
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2 - 10, width: 0, height: 0, right: innerWidth / 2, bottom: innerHeight / 2 };
    const pad = el ? 6 : 0;
    let tx = r.right + 16, ty = r.top;
    if (tx + 330 > innerWidth) tx = Math.max(12, r.left - 336);
    if (s.sel === '#map' || !el) { tx = innerWidth / 2 - 160; ty = innerHeight / 2 - 90; }
    if (tx < 12) tx = 12; ty = clamp(ty, 12, innerHeight - 230);
    T.innerHTML = `<div class="shade" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + 2 * pad}px;height:${r.height + 2 * pad}px;${el && s.sel !== '#map' ? '' : 'border-color:transparent'}"></div>
      <div class="tip" style="left:${tx}px;top:${ty}px"><div class="step">Step ${k + 1} of ${steps.length}</div><h4>${s.t}</h4><p>${s.b}</p>
      <label class="small tnoauto"><input type="checkbox" id="tOff" ${autoOff() ? 'checked' : ''}> Don't open this tour automatically</label>
      <div class="row"><button class="btn sm" id="tSkip">Skip tour</button><span class="sp"></span>${k ? '<button class="btn sm" id="tBack">Back</button>' : ''}<button class="btn sm pri" id="tNext">${k === steps.length - 1 ? 'Finish' : 'Next'}</button></div></div>`;
    $('#tOff').onchange = e => { try { e.target.checked ? localStorage.setItem('onm_tour_off', '1') : localStorage.removeItem('onm_tour_off'); } catch (x) {} };
    $('#tSkip').onclick = end; $('#tNext').onclick = () => { if (k < steps.length - 1) { k++; show(); } else end(); };
    if ($('#tBack')) $('#tBack').onclick = () => { k--; show(); };
  }
  function end() { $('#tour').style.display = 'none'; switchTab('plan'); if (innerWidth > 900 && matchMedia('(pointer: fine)').matches) $('#q').focus(); }   // no focus on phones (keyboard would pop up)
  const autoOff = () => { try { return localStorage.getItem('onm_tour_off') === '1'; } catch (e) { return false; } };
  function start() { steps = document.body.classList.contains('ui-simple') && typeof SIMPLE_TOUR !== 'undefined' ? SIMPLE_TOUR : TECH_STEPS; k = 0; show(); }
  function maybeAuto() { if (!navigator.webdriver && !autoOff()) setTimeout(start, 900); }   // opens on every page load unless the visitor ticked "Don't open automatically"
  return { start, maybeAuto };
})();

// ---------------------------------------------------------------------
//  HUD (cursor readout) + tabs + boot
// ---------------------------------------------------------------------
function switchTab(id) { $('#rightPanel').classList.remove('collapsed'); $$('.tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === id)); const simple = document.body.classList.contains('ui-simple'), pid = 'p-' + (simple && (id === 'layers' || id === 'plan') ? 's' + id : id); $$('.pane').forEach(p => p.classList.toggle('on', p.id === pid)); document.dispatchEvent(new CustomEvent('onm:tab', { detail: id })); }
let hudT = 0;
let hudPos = null;
function hudUpdate() {
  if (!hudPos) return;
  const { lat, lng } = hudPos, h = elev(lat, lng);
  $('#hudEl').textContent = elevText(lat, lng, h) || 'loading…';
  if (isNaN(h)) {           // elevation tile not loaded yet: fetch it, then refresh the readout
    const at = hudPos; dem.ensure(DEM.maxZ, lat - .05, lng - .05, lat + .05, lng + .05).then(() => { if (hudPos === at) hudUpdate(); });
  }
  const hab = Planner.state.hab;
  if (hab) { const d = hav(hab, { lat, lon: lng }); $('#hudDist').textContent = d >= 1000 ? fmt(d / 1000, d < 10000 ? 2 : 1) + ' km' : fmt(d) + ' m'; $('#hudDistW').style.display = ''; }
  else $('#hudDistW').style.display = 'none';
}
map.on('mousemove', e => {
  const { lat, lng } = e.latlng; $('#hudLL').textContent = fmtLL(lat, lng);
  const now = performance.now(); if (now - hudT < 60) return; hudT = now;
  hudPos = { lat, lng }; hudUpdate();
  $('#hudLt').textContent = MarsTime.fmtH(MarsTime.ltst(MarsTime.at(new Date()), lng)) + ' LTST';
});
map.on('mouseout', () => { hudPos = null; });
map.on('zoomend', () => { const mpp = 180 / (256 * 2 ** map.getZoom()) * D2R * R_MARS; $('#hudRes').textContent = mpp >= 1000 ? fmt(mpp / 1000, 1) + ' km/px' : mpp >= 1 ? fmt(mpp, 1) + ' m/px' : fmt(mpp * 100) + ' cm/px'; });

window.addEventListener('DOMContentLoaded', () => {
  $$('.tabs button[data-tab]').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  $('#btnCollapse').onclick = () => $('#rightPanel').classList.toggle('collapsed');
  $('#btnTour').onclick = () => Tour.start();
  setBase('smart'); buildLayersPane(); Planner.init(); Conditions.init(); initExplore();
  map.fire('zoomend');
  Planner.loadHash(); switchTab('plan'); Tour.maybeAuto();
});
