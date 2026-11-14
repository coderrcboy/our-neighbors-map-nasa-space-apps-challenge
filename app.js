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
  constructor(urlFn, maxZ) { this.urlFn = urlFn; this.maxZ = maxZ; this.cache = new Map(); }
  _load(z, y, x) {
    const k = `${z}/${y}/${x}`;
    if (this.cache.has(k)) return this.cache.get(k);
    const p = (async () => {
      try {
        const r = await fetch(this.urlFn(z, y, x), { mode: 'cors' });
        if (!r.ok) return null;
        const bmp = await createImageBitmap(await r.blob());
        const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, 256, 256);
        const d = g.getImageData(0, 0, 256, 256).data, out = new Uint8Array(65536);
        for (let i = 0; i < 65536; i++) out[i] = d[i * 4 + 3] < 10 ? 0 : d[i * 4];   // transparent = no data
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
  async ensure(z, s, w, n, e) { await Promise.all(this.tilesFor(z, s, w, n, e).map(t => this._load(...t))); }
  _px(z, gx, gy) {
    const cols = 2 ** (z + 1) * 256, rows = 2 ** z * 256;
    gx = ((Math.round(gx) % cols) + cols) % cols; gy = clamp(Math.round(gy), 0, rows - 1);
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
const dem = new Raster(DEM.url, DEM.maxZ);
const themis = new Raster(THEMIS_N.url, THEMIS_N.maxZ);
const elev = (lat, lon, z = DEM.maxZ) => { const v = dem.val(z, lat, lon); return isNaN(v) ? NaN : DEM.a + DEM.b * v; };
const demSat = (lat, lon) => dem.val(DEM.maxZ, lat, lon) >= DEM.satDN - 0.5;
const demPxM = z => (180 / (256 * 2 ** z)) * D2R * R_MARS;   // ~1.3 km at z5
const pressure = h => 610 * Math.exp(-h / 11100);              // Pa, simple isothermal model

// ---------------------------------------------------------------------
//  Map
// ---------------------------------------------------------------------
const WORLD = L.latLngBounds([[-90, -180], [90, 180]]);
const map = L.map('map', { crs: L.CRS.EPSG4326, center: [10, 30], zoom: 2, minZoom: 1, maxZoom: 19, maxBounds: [[-100, -200], [100, 200]], zoomControl: true, worldCopyJump: false, preferCanvas: true });
map.attributionControl.setPrefix('<b>Our Neighbor\'s Map</b>');
L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
// Leaflet's scale assumes Earth's radius — patch for Mars
L.Control.Scale.prototype._update = function () {
  const m = this._map, y = m.getSize().y / 2;
  const a = m.containerPointToLatLng([0, y]), b = m.containerPointToLatLng([this.options.maxWidth, y]);
  const maxMeters = hav({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
  this._updateScales(maxMeters);
};
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function makeTileLayer(def, extra = {}) {
  const o = { attribution: def.attr || '', noWrap: true, bounds: def.bounds ? L.latLngBounds(def.bounds) : WORLD, maxZoom: 19, errorTileUrl: BLANK, crossOrigin: false, ...extra };
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
    baseLayers.smart = L.layerGroup([makeTileLayer(vik), makeTileLayer(ctx, { minZoom: 6 }), makeTileLayer(hr, { minZoom: 12 })]);
  } else baseLayers[b.id] = makeTileLayer(b);
}
let curBase = null;
function setBase(id) { if (curBase) map.removeLayer(curBase); curBase = baseLayers[id]; curBase.addTo(map); curBase.bringToBack?.(); }

// ---- Computed layers -------------------------------------------------
const SlopeLayer = L.GridLayer.extend({
  options: { tileSize: 256, noWrap: true, bounds: WORLD, minZoom: 2, maxZoom: 19, opacity: .55 },
  createTile(c, done) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const z = Math.min(c.z, DEM.maxZ), span = 180 / 2 ** c.z;
    const w = -180 + c.x * span, n = 90 - c.y * span, s = n - span, e = w + span;
    const N = c.z >= 8 ? 32 : 64, cell = span / N;
    dem.ensure(z, s, w, n, e).then(() => {
      const g = cv.getContext('2d'), img = g.createImageData(N, N), h = Math.max(cell, 1 / dem.ppd(z));
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const lat = n - (j + .5) * cell, lon = w + (i + .5) * cell;
        const dx = 2 * h * D2R * R_MARS * Math.max(.05, Math.cos(lat * D2R)), dy = 2 * h * D2R * R_MARS;
        const gx = (elev(lat, lon + h, z) - elev(lat, lon - h, z)) / dx, gy = (elev(lat + h, lon, z) - elev(lat - h, lon, z)) / dy;
        const sl = Math.atan(Math.hypot(gx, gy)) / D2R, k = (j * N + i) * 4;
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
    m.bindPopup(`<b>${s.n}</b> · ${s.y}<br><span class="muted">${s.d}</span><br><span style="font-family:var(--mono);font-size:11px">${fmtLL(s.lat, s.lon)}</span><br><br><button class="btn sm pri" onclick="Planner.habAt(${s.lat},${s.lon},'Habitat · ${s.n.replace(/'/g, '')}')">Put habitat here</button>`);
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
  else overlayLayers[o.id] = makeTileLayer(o, { opacity: o.op });
}

// ---------------------------------------------------------------------
//  Sidebar: Layers
// ---------------------------------------------------------------------
function badge(tags = []) { return tags.map(t => `<span class="badge ${t}">${{ esa: 'ESA', usgs: 'USGS', cal: 'Caltech' }[t]}</span>`).join(''); }
function buildLayersPane() {
  let h = `<h3>Base map</h3><div class="card">`;
  for (const b of BASEMAPS) h += `<div class="lyr"><input type="radio" name="base" id="b_${b.id}" value="${b.id}" ${b.id === 'smart' ? 'checked' : ''}><label for="b_${b.id}">${b.name}${badge(b.tags)}<small>${b.desc}</small></label><span></span></div>`;
  h += `</div>`;
  let grp = null;
  for (const o of OVERLAYS) {
    if (o.group !== grp) { if (grp) h += `</div>`; grp = o.group; h += `<h3>${grp} layers</h3><div class="card">`; }
    const op = o.computed && o.computed !== 'slope' ? '<span></span>' : `<input type="range" min="0" max="1" step="0.05" value="${o.op}" data-op="${o.id}" title="Opacity">`;
    h += `<div class="lyr"><input type="checkbox" id="o_${o.id}" data-ov="${o.id}" ${o.on ? 'checked' : ''}><label for="o_${o.id}">${o.name}${badge(o.tags)}<small>${o.desc}</small></label>${op}</div>`;
  }
  h += `</div><p class="note">Zoom in anywhere: the Smart base map swaps from global Viking imagery to the 5 m/px CTX mosaic and, wherever HiRISE has imaged, to ~25 cm/px. Site mosaics (Jezero, Gale…) only appear inside their footprint — use <b>Explore → Missions</b> to fly there.</p>`;
  $('#p-layers').innerHTML = h;
  $$('input[name=base]').forEach(r => r.onchange = () => setBase(r.value));
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
  eva: { label: 'Suited EVA (on foot)', maxSlope: 15, crew: 75, load: 60, o2: 0.90, battH: 8, walkback: 10000, speedFlat: 3.0 },
  rover: { label: 'Pressurized rover', maxSlope: 25, mass: 3000, crr: 0.12, eff: 0.7, battKWh: 70, speed: 10, walkback: 50000 },
};
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
      const m = L.marker([p.lat, p.lon], { draggable: true, icon: icon(isHab ? 'hab' : 'sci', isHab ? '⌂ ' + p.n.replace('Habitat · ', '') : `${i}. ${p.n}`), zIndexOffset: 1000 });
      m.on('dragend', e => { const ll = e.target.getLatLng(); p.lat = ll.lat; p.lon = ll.lng; clearRoute(); renderList(); redrawMarkers(); });
      lay.addLayer(m);
    });
  }
  function clearRoute() { routeLay.clearLayers(); st.route = null; $('#profile').classList.remove('on'); $('#telemetry').innerHTML = ''; }
  function setClick(mode) {
    st.click = st.click === mode ? null : mode;
    $('#btnHab').classList.toggle('on', st.click === 'hab'); $('#btnWp').classList.toggle('on', st.click === 'wp');
    $('#modeHint').style.display = st.click ? 'block' : 'none';
    $('#modeHint').textContent = st.click === 'hab' ? 'Click the map to place the habitat' : st.click === 'wp' ? 'Click the map to add science waypoints (Esc to stop)' : '';
    map.getContainer().style.cursor = st.click ? 'crosshair' : '';
  }
  map.on('click', e => {
    if (!st.click) { Conditions.setPoint(e.latlng.lat, e.latlng.lng); return; }
    const { lat, lng } = e.latlng;
    if (st.click === 'hab') { st.hab = { n: 'Habitat', lat, lon: lng }; setClick(null); }
    else st.wps.push({ n: `Waypoint ${st.wps.length + 1}`, lat, lon: lng, task: 'Sample collection', dwell: 30 });
    clearRoute(); renderList(); redrawMarkers();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setClick(null); });

  function renderList() {
    const P = PROFILES[st.mode];
    let h = '';
    if (st.hab) h += `<div class="wp"><div class="n h">⌂</div><input value="${st.hab.n}" data-f="hab.n"><span class="muted small">${st.hab.lat.toFixed(3)}, ${st.hab.lon.toFixed(3)}</span></div>`;
    st.wps.forEach((w, i) => {
      h += `<div class="wp"><div class="n">${i + 1}</div><div><input value="${w.n}" data-f="w${i}.n"><div class="row" style="margin-top:4px"><input value="${w.task}" data-f="w${i}.task" title="Science task"><input type="number" style="width:62px" value="${w.dwell}" data-f="w${i}.dwell" title="Dwell (min)"></div></div><button class="x" data-del="${i}" title="Remove">✕</button></div>`;
    });
    if (!st.hab && !st.wps.length) h = `<p class="muted small">No habitat yet. Place one on the map, click a lander in <b>Explore</b>, or load a preset mission.</p>`;
    $('#wplist').innerHTML = h;
    $$('#wplist input').forEach(inp => inp.onchange = () => {
      const [k, f] = inp.dataset.f.split('.'); const obj = k === 'hab' ? st.hab : st.wps[+k.slice(1)];
      obj[f] = f === 'dwell' ? +inp.value : inp.value; redrawMarkers();
    });
    $$('[data-del]').forEach(b => b.onclick = () => { st.wps.splice(+b.dataset.del, 1); clearRoute(); renderList(); redrawMarkers(); });
    $('#maxSlope').textContent = P.maxSlope + '°';
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
    if (dist < 3 * px) return { pts: densify([a, b], 60).map(normLon), subgrid: true, relaxed: false };
    const cosL = Math.cos(((a.lat + b.lat) / 2) * D2R);
    const spanM = Math.max((n - s), (e - w) * cosL) * D2R * R_MARS;
    const step = Math.max(px * 0.75, spanM / 160);                 // metres per cell
    const dLat = step / (D2R * R_MARS), dLon = dLat / Math.max(cosL, .05);
    const W = Math.ceil((e - w) / dLon) + 1, H = Math.ceil((n - s) / dLat) + 1;
    const hh = new Float32Array(W * H), dust = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const lat = n - j * dLat, lon = w + i * dLon; hh[j * W + i] = elev(lat, lon);
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
          const sl = Math.atan(Math.abs(dh) / d) / D2R;
          if (sl > limit && v !== T) continue;
          const c = d * (1 + 4 * (sl / limit) ** 2 + (dh > 0 ? 2.5 * dh / d : 0) + 0.6 * dust[v]);
          const ng = g[u] + c;
          if (ng < g[v]) { g[v] = ng; from[v] = u; push(ng + step * Math.hypot(vi - ti, vj - tj), v); }
        }
      }
      if (!isFinite(g[T])) return null;
      const path = []; for (let u = T; u !== -1; u = from[u]) path.push(u);
      return path.reverse().map(u => ({ lat: n - Math.floor(u / W) * dLat, lon: w + (u % W) * dLon }));
    };
    let limit = P.maxSlope, path = run(limit), relaxed = false;
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
    const P = PROFILES[st.mode];
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
        S.push({ lat: p.lat, lon: p.lon, d: D, h: elev(p.lat, p.lon), leg: li, sat: demSat(p.lat, p.lon), loose: !isNaN(t) && t < 55 });
      }));
      if (S.filter(p => isNaN(p.h)).length > S.length * 0.2) { toast('⚠ Terrain data could not be loaded (offline or NASA Trek unreachable). Check your connection and try again.', 6000); return; }
      // along-track slope, smoothed over one DEM pixel
      const win = demPxM(DEM.maxZ);
      for (let i = 0; i < S.length; i++) {
        let j = i; while (j > 0 && S[i].d - S[j].d < win / 2) j--; let k = i; while (k < S.length - 1 && S[k].d - S[i].d < win / 2) k++;
        const dd = S[k].d - S[j].d; S[i].grade = dd > 0 ? (S[k].h - S[j].h) / dd : 0; S[i].slope = Math.atan(Math.abs(S[i].grade)) / D2R;
      }
      // time, energy
      const start = st.start || MarsTime.nextLTST(new Date(), st.hab.lon, 9);
      let t = 0, E = 0, kwh = 0, asc = 0, desc = 0, maxSl = 0, loose = 0;
      const arrive = [];
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
        if (b.leg !== S[i + 1]?.leg) arrive[b.leg] = t;
      }
      // dwell at waypoints
      const workW = 260; let dwellS = 0;
      st.wps.forEach(w => { dwellS += (w.dwell || 0) * 60; });
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
      st.route = { S, legs, t, totalS, dwellS, E: evaE, o2, roverEvaO2, kwh, asc, desc, maxSl, loose, subgrid, relaxed, start, s0, s1, minEl, dose, radRate, far, farIdx, hMean, T0, arrive, mode: st.mode };
      drawRoute(); renderTelemetry(); Profile.draw(st.route);
      saveHash();
    } finally { $('#btnPlan').disabled = false; $('#btnPlan').textContent = 'Compute safe route'; }
  }

  function drawRoute() {
    routeLay.clearLayers(); const S = st.route.S, P = PROFILES[st.mode];
    for (let i = 1; i < S.length; i++) {
      if (Math.abs(S[i].lon - S[i - 1].lon) > 180) continue;   // antimeridian seam
      const sl = S[i].slope, c = sl < 8 ? '#3ccf8e' : sl < P.maxSlope ? '#f2b636' : '#ff4d4d';
      routeLay.addLayer(L.polyline([[S[i - 1].lat, S[i - 1].lon], [S[i].lat, S[i].lon]], { color: '#000', weight: 7, opacity: .45, interactive: false }));
      routeLay.addLayer(L.polyline([[S[i - 1].lat, S[i - 1].lon], [S[i].lat, S[i].lon]], { color: c, weight: 4, opacity: .95, interactive: false, dashArray: S[i].loose ? '6 5' : null }));
    }
    const f = S[st.route.farIdx];
    routeLay.addLayer(L.circleMarker([f.lat, f.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#5bb4ff', fillOpacity: 1 }).bindTooltip(`Farthest point · ${fmt(st.route.far / 1000, 2)} km from habitat`));
    map.fitBounds(L.latLngBounds(S.map(p => [p.lat, p.lon])).pad(0.25));
  }

  function renderTelemetry() {
    const r = st.route, P = PROFILES[st.mode], checks = [];
    const add = (lvl, msg) => checks.push([lvl, msg]);
    // terrain
    if (r.maxSl <= P.maxSlope) add('ok', `Max route slope ${fmt(r.maxSl, 1)}° within ${P.maxSlope}° ${st.mode === 'eva' ? 'suited-walking' : 'rover'} limit`);
    else if (r.maxSl <= P.maxSlope * 1.25) add('warn', `Route reaches ${fmt(r.maxSl, 1)}° — above ${P.maxSlope}° limit on short sections`);
    else add('bad', `Route reaches ${fmt(r.maxSl, 1)}° slopes — unsafe, move waypoints`);
    if (r.relaxed) add('warn', `No path existed under ${P.maxSlope}°; limit was relaxed to find one`);
    if (r.subgrid) add('warn', `Some legs are shorter than the MOLA grid (~1.3 km) — inspect HiRISE/CTX imagery for boulders and scarps`);
    if (r.S.some(p => p.sat)) add('warn', `Terrain above +7.6 km: DEM saturates, slopes there are under-estimated`);
    if (r.loose > 0) add('warn', `${fmt(r.loose / 1000, 2)} km over low thermal-inertia ground (likely loose dust/sand — dashed)`);
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
    add(r.dose < 0.5 ? 'ok' : 'warn', `Radiation ≈ ${fmt(r.dose, 3)} mSv for this sortie (no solar particle event)`);
    const worst = checks.some(c => c[0] === 'bad') ? 'nogo' : checks.some(c => c[0] === 'warn') ? 'caution' : 'go';
    const label = { go: 'GO', caution: 'GO — WITH CAUTIONS', nogo: 'NO-GO' }[worst];
    const endT = new Date(r.start.getTime() + r.totalS * 1000);
    let h = `<div class="status ${worst}">● ${label}</div>
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
    h += `<span>Radiation dose</span><span>${fmt(r.dose, 3)} mSv</span>
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
    <h3>Go / No-Go checklist</h3><ul class="checks">${checks.map(([l, m]) => `<li class="${l}">${m}</li>`).join('')}</ul>
    <h3>Science objectives</h3><ul class="checks">${st.wps.map((w, i) => `<li class="ok"><b>${i + 1}. ${w.n}</b> — ${w.task} (${w.dwell} min)${sciNote(w)}</li>`).join('')}</ul>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="btnGeo">Download GeoJSON</button><button class="btn sm" id="btnBrief">Mission brief</button><button class="btn sm" id="btnLink">Copy link</button></div>
    <p class="note">Models: walking speed — Tobler hiking function ×0.6 suited penalty; metabolic cost — Pandolf (1977) load-carriage equation with weight terms scaled to 0.38 g; O₂ — 20.1 kJ per litre; terrain — MOLA DEM (463 m) + THEMIS night-IR thermal inertia; sun — Mars24 (Allison &amp; McEwen 2000); radiation — MSL/RAD surface baseline (Hassler et al. 2014). Planning aid, not flight-certified.</p>`;
    $('#telemetry').innerHTML = h;
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
    w.document.write(`<html><head><title>Marswalk mission brief</title><style>:root{--ok:#1aa36a;--warn:#e0a800;--bad:#d33}body{font:13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#111;padding:24px;max-width:780px;margin:auto}h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:16px 0 6px}.card{background:#f6f6f6;border:1px solid #ddd;border-radius:8px;padding:10px;margin:8px 0}.kv{display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}.kv span:nth-child(odd){color:#555;font-family:inherit}.status{padding:8px 10px;border-radius:8px;font-weight:700;margin-top:10px}.status.go{background:#e5f7ee;color:#0b7a46}.status.caution{background:#fff4d6;color:#8a6200}.status.nogo{background:#fde3e3;color:#b00000}.checks{list-style:none;padding:0}.checks li{padding:3px 0 3px 16px;position:relative}.checks li:before{content:'';position:absolute;left:2px;top:8px;width:8px;height:8px;border-radius:50%}.checks li.ok:before{background:#1aa36a}.checks li.warn:before{background:#e0a800}.checks li.bad:before{background:#d33}.bar{height:6px;background:#ddd;border-radius:3px;overflow:hidden}.bar i{display:block;height:100%}.note,.muted{color:#555;font-size:11px}.small{font-size:11px}button{display:none}</style></head><body><h1 style="margin:0">Marswalk mission brief</h1><p>${st.hab.n} · ${fmtLL(st.hab.lat, st.hab.lon)} · ${PROFILES[st.mode].label}</p><img src="${prof}" style="width:100%;border:1px solid #ddd;border-radius:8px;background:#111">${tel}<p class="note">Generated by Our Neighbor's Map · NASA Space Apps Challenge 2026</p><script>setTimeout(()=>print(),400)<\/script></body></html>`);
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
      st.mode = o.m; st.returnHome = !!o.r; st.hab = o.h && { n: o.h[0], lat: o.h[1], lon: o.h[2] };
      st.wps = o.w.map(a => ({ n: a[0], lat: a[1], lon: a[2], task: a[3], dwell: a[4] }));
      syncUI(); renderList(); redrawMarkers();
      if (st.hab) map.setView([st.hab.lat, st.hab.lon], 11);
      if (st.hab && st.wps.length) compute();
      return true;
    } catch (e) { return false; }
  }
  function syncUI() { $('#mode').value = st.mode; $('#retHome').checked = st.returnHome; renderList(); }
  function loadPreset(id) {
    const p = PRESETS.find(x => x.id === id); if (!p) return;
    st.mode = p.mode; st.returnHome = p.ret !== false; st.hab = { ...p.hab }; st.wps = p.wps.map(w => ({ ...w })); st.start = null; $('#start').value = '';
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
      <h3>Preset missions</h3>
      <div class="grid2">${PRESETS.map(p => `<button class="btn sm" data-preset="${p.id}">${p.name}</button>`).join('')}</div>
      <h3>Habitat & science waypoints</h3>
      <div class="row"><button class="btn" id="btnHab">⌂ Place habitat</button><button class="btn" id="btnWp">＋ Add waypoints</button><span class="sp"></span><button class="btn sm" id="btnClear">Clear</button></div>
      <div id="wplist" style="margin-top:8px"></div>
      <button class="btn pri" id="btnPlan" style="width:100%;margin-top:10px">Compute safe route</button>
      <div id="telemetry" style="margin-top:12px"></div>`;
    $('#mode').onchange = e => { st.mode = e.target.value; clearRoute(); renderList(); };
    $('#retHome').onchange = e => { st.returnHome = e.target.checked; clearRoute(); };
    $('#start').onchange = e => { st.start = e.target.value ? new Date(e.target.value + 'Z') : null; };
    $('#btnMorning').onclick = () => { if (!st.hab) return toast('Place a habitat first'); st.start = MarsTime.nextLTST(new Date(), st.hab.lon, 9); $('#start').value = st.start.toISOString().slice(0, 16); };
    $('#btnHab').onclick = () => setClick('hab'); $('#btnWp').onclick = () => setClick('wp');
    $('#btnClear').onclick = () => { st.hab = null; st.wps = []; clearRoute(); renderList(); redrawMarkers(); history.replaceState(null, '', location.pathname); };
    $('#btnPlan').onclick = compute;
    $$('[data-preset]').forEach(b => b.onclick = () => loadPreset(b.dataset.preset));
    renderList();
  }
  function addWp(lat, lon, n) { st.wps.push({ n: n || `Waypoint ${st.wps.length + 1}`, lat, lon, task: 'Sample collection', dwell: 30 }); switchTab('plan'); clearRoute(); renderList(); redrawMarkers(); if (!st.hab) toast('Waypoint added — now place a habitat'); }
  return { init, habAt, addWp, loadPreset, loadHash, get state() { return st; }, setHover(p) { if (!p) { hoverMk && map.removeLayer(hoverMk); hoverMk = null; return; } if (!hoverMk) hoverMk = L.circleMarker([p.lat, p.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#e0603a', fillOpacity: 1 }).addTo(map); else hoverMk.setLatLng([p.lat, p.lon]); } };
})();

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
    R = r; $('#profile').classList.add('on');
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
    for (let i = 1; i < S.length; i++) { const sl = S[i].slope; g.strokeStyle = sl < 8 ? '#3ccf8e' : sl < P.maxSlope ? '#f2b636' : '#ff4d4d'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(X(S[i - 1].d), Y(S[i - 1].h)); g.lineTo(X(S[i].d), Y(S[i].h)); g.stroke(); }
    // waypoint ticks
    let lastLeg = 0; g.fillStyle = '#fff';
    S.forEach((p, i) => { if (i && p.leg !== lastLeg) { const x = X(S[i - 1].d); g.strokeStyle = '#ffffff55'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, T0); g.lineTo(x, H - B0); g.stroke(); g.setLineDash([]); g.fillText(`◆${lastLeg + 1}`, x + 3, T0 + 10); lastLeg = p.leg; } });
    g.fillStyle = '#e7e2db'; g.font = '600 11px system-ui'; g.fillText('Elevation profile (MOLA)  ·  green < 8°  ·  amber < limit  ·  red > limit', L0, 12);
    if (hx != null && typeof hx === 'number') {
      const d = clamp((hx - L0) / (W - L0 - R0), 0, 1) * D; let i = S.findIndex(p => p.d >= d); if (i < 0) i = S.length - 1; const p = S[i];
      g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(X(p.d), T0); g.lineTo(X(p.d), H - B0); g.stroke();
      const txt = `${fmt(p.d / 1000, 2)} km · ${fmt(p.h)} m · ${fmt(p.slope, 1)}°${p.loose ? ' · loose' : ''}`; g.font = '11px ui-monospace,monospace';
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
      <span>Elevation (MOLA)</span><span>${isNaN(h) ? '…' : fmt(h) + ' m' + (demSat(pt.lat, pt.lon) ? ' (≥ sat.)' : '')}</span>
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
  async function getJSON(direct, proxy) {
    try { const r = await fetch(direct, { mode: 'cors' }); if (r.ok) return await r.json(); } catch (e) {}
    if (location.protocol.startsWith('http')) { try { const r = await fetch(proxy); if (r.ok) return await r.json(); } catch (e) {} }
    return null;
  }
  async function weather() {
    const j = await getJSON('https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json', 'api/rems');
    const live = !!(j && j.soles); const w = live ? j.soles.find(s => s.max_temp !== '--') || j.soles[0] : REMS_SNAPSHOT;
    $('#rems').innerHTML = `<div class="kv">
      <span>Sol / Earth date</span><span>${w.sol} · ${w.terrestrial_date}</span>
      <span>Air temp min / max</span><span>${w.min_temp} / ${w.max_temp} °C</span>
      <span>Ground temp min / max</span><span>${w.min_gts_temp} / ${w.max_gts_temp} °C</span>
      <span>Pressure</span><span>${w.pressure} Pa</span>
      <span>Sky / UV</span><span>${w.atmo_opacity} · UV ${w.local_uv_irradiance_index}</span>
      <span>Sunrise / sunset</span><span>${w.sunrise} / ${w.sunset}</span></div>
      <p class="note">Curiosity REMS (Centro de Astrobiología / NASA-JPL), Gale crater. ${live ? '<span style="color:var(--ok)">● live</span>' : '● offline snapshot — run <code>python server.py</code> for live data'}</p>`;
  }
  async function spaceWx() {
    const end = new Date(), st = new Date(end - 7 * 864e5), f = d => d.toISOString().slice(0, 10);
    const j = await getJSON(`https://api.nasa.gov/DONKI/CME?startDate=${f(st)}&endDate=${f(end)}&api_key=DEMO_KEY`, `api/cme?start=${f(st)}&end=${f(end)}`);
    if (!Array.isArray(j)) { $('#swx').innerHTML = '<span class="muted small">Space-weather feed unavailable (rate-limited DEMO_KEY?).</span>'; return; }
    let fast = 0; j.forEach(c => (c.cmeAnalyses || []).forEach(a => fast = Math.max(fast, a.speed || 0)));
    const lvl = fast > 1000 ? 'bad' : fast > 600 ? 'warn' : 'ok';
    $('#swx').innerHTML = `<ul class="checks"><li class="${lvl}">${j.length} coronal mass ejections in the last 7 days · fastest ${fmt(fast)} km/s</li><li class="${lvl === 'ok' ? 'ok' : 'warn'}">${lvl === 'ok' ? 'No fast CME — nominal EVA radiation environment' : 'Fast CME observed — check Mars-directed arrival before long EVAs'}</li></ul><p class="note">NASA CCMC DONKI catalogue. Heliospheric events, not all Mars-directed.</p>`;
  }
  async function rawImages() {
    const j = await getJSON('https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=12&order=sol+desc', 'api/raw');
    if (!j || !j.images) { $('#raw').innerHTML = '<span class="muted small">Run <code>python server.py</code> to stream the latest Perseverance raw images.</span>'; return; }
    const imgs = j.images.filter(i => i.image_files?.small).slice(0, 9);
    $('#raw').innerHTML = `<div class="thumbs">${imgs.map(i => `<a href="${i.image_files.large || i.image_files.medium}" target="_blank" title="Sol ${i.sol} · ${i.camera?.instrument || ''}" style="background-image:url('${i.image_files.small}')"></a>`).join('')}</div><p class="note">Perseverance, sol ${imgs[0]?.sol ?? '—'} — Jezero crater. NASA/JPL-Caltech.</p>`;
  }
  function init() {
    $('#p-cond').innerHTML = `<h3>Mars right now</h3><div class="card" id="clock"></div>
      <h3>Selected point <span class="muted" style="text-transform:none;letter-spacing:0">(click the map)</span></h3><div class="card" id="ptInfo"></div>
      <h3>Surface weather · Gale crater</h3><div class="card" id="rems">Loading…</div>
      <h3>Space weather</h3><div class="card" id="swx">Loading…</div>
      <h3>Latest from the surface</h3><div class="card" id="raw">Loading…</div>`;
    clock(); setInterval(clock, 1000); setInterval(renderPoint, 30000);
    setPoint(pt.lat, pt.lon); weather(); spaceWx(); rawImages();
  }
  return { init, setPoint };
})();

// ---------------------------------------------------------------------
//  Explore: search, missions, data health
// ---------------------------------------------------------------------
function initExplore() {
  $('#p-explore').innerHTML = `<h3>Search Mars</h3>
    <input type="text" id="q" placeholder="Olympus Mons, Jezero, or 18.4N 77.5E…"><div class="searchres" id="qres"></div>
    <h3>Missions on the surface</h3><div class="card searchres">${SITES.map((s, i) => `<div data-site="${i}"><b>${s.n}</b> <small>${s.y} · ${fmtLL(s.lat, s.lon)}</small></div>`).join('')}</div>
    <h3>Data sources · live status</h3><div class="card" id="health"></div>
    <h3>About</h3><div class="card small" style="line-height:1.5">Our Neighbor's Map fuses orbital data from <b>NASA</b> (MGS MOLA &amp; TES, Odyssey THEMIS, MRO CTX &amp; HiRISE, Viking), <b>ESA</b> (Mars Express HRSC stereo topography, OMEGA via CRISM/OMEGA hydrous-mineral survey), <b>USGS</b> (global geologic map, IAU nomenclature) and <b>Caltech</b> (global CTX mosaic) into one planner for the first human Marswalks.<br><br><span class="muted">Elevation is read live from MOLA DEM tiles (8-bit, calibrated to ±70 m RMS against landing-site elevations). Route slopes are at MOLA resolution (~1.3 km); always confirm boulder-scale hazards in HiRISE imagery.</span></div>`;
  const q = $('#q'), res = $('#qres');
  q.oninput = () => {
    const s = q.value.trim(); let out = [];
    const m = s.match(/^(-?[\d.]+)\s*°?\s*([NS])?[\s,]+(-?[\d.]+)\s*°?\s*([EW])?$/i);
    if (m) { let la = +m[1], lo = +m[3]; if (/s/i.test(m[2] || '')) la = -la; if (/w/i.test(m[4] || '')) lo = -lo; if (lo > 180) lo -= 360; out.push([`Go to ${fmtLL(la, lo)}`, '', la, lo]); }
    if (s.length > 1) out = out.concat(GAZ.filter(g => g[0].toLowerCase().includes(s.toLowerCase())).slice(0, 12));
    res.innerHTML = out.map((g, i) => `<div data-i="${i}"><b>${g[0]}</b> <small>${g[1]} ${g[1] ? '·' : ''} ${fmtLL(g[2], g[3])}</small></div>`).join('');
    $$('#qres [data-i]').forEach(d => d.onclick = () => { const g = out[+d.dataset.i]; map.setView([g[2], g[3]], g[1] === 'Crater' ? 9 : 7); Conditions.setPoint(g[2], g[3]); });
  };
  $$('[data-site]').forEach(d => d.onclick = () => { const s = SITES[+d.dataset.site]; map.setView([s.lat, s.lon], 12); Conditions.setPoint(s.lat, s.lon); });
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
//  HUD (cursor readout) + tabs + boot
// ---------------------------------------------------------------------
function switchTab(id) { $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === id)); $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + id)); }
let hudT = 0;
map.on('mousemove', e => {
  const { lat, lng } = e.latlng; $('#hudLL').textContent = fmtLL(lat, lng);
  const now = performance.now(); if (now - hudT < 60) return; hudT = now;
  const h = elev(lat, lng); $('#hudEl').textContent = isNaN(h) ? '…' : fmt(h) + ' m';
  if (isNaN(h)) dem.ensure(DEM.maxZ, lat - .05, lng - .05, lat + .05, lng + .05);
  $('#hudLt').textContent = MarsTime.fmtH(MarsTime.ltst(MarsTime.at(new Date()), lng)) + ' LTST';
});
map.on('zoomend', () => { const mpp = 180 / (256 * 2 ** map.getZoom()) * D2R * R_MARS; $('#hudRes').textContent = mpp >= 1000 ? fmt(mpp / 1000, 1) + ' km/px' : mpp >= 1 ? fmt(mpp, 1) + ' m/px' : fmt(mpp * 100) + ' cm/px'; });

window.addEventListener('DOMContentLoaded', () => {
  $$('.tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  setBase('smart'); buildLayersPane(); Planner.init(); Conditions.init(); initExplore();
  map.fire('zoomend');
  if (!Planner.loadHash()) switchTab('layers');
  else switchTab('plan');
});
