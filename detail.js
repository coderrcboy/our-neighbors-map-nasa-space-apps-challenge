// =====================================================================
//  Our Neighbor's Map — real-detail zoom limit
//   1. Uses the sharpest REAL photo for each spot (HiRISE 25 cm where it exists, else CTX 5 m)
//   2. Stops zooming at the sharpest real photo (+1 step) and says why
//   3. On that last step, a light sharpening filter labelled "Enhanced" (sharpens real pixels, invents nothing)
//  Applies to the photo base maps (Smart, CTX). Other base maps behave as before.
// =====================================================================
const Detail = (() => {
  const HIRISE = 'https://astro.arcgis.com/arcgis/rest/services/OnMars/HiRISE/MapServer/tile/';
  const CTX_MAX = 14;          // CTX native = map zoom 13 (5 m/px); allow one enlargement step (2.5 m/px shown)
  const HIRISE_MAX = 19;       // HiRISE native ≈ map zoom 18 (~16 cm/px)
  const cache = new Map();     // HiRISE coverage per level-12 tile (~1.1 km at the equator)
  let limited = false, lastNote = 0, busy = 0, enhanced = false;

  // ---- 3. sharpening filter (real pixels only) ----
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = '<filter id="onmSharpen"><feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="0 -0.5 0 -0.5 3 -0.5 0 -0.5 0"/></filter>';
  document.body.appendChild(svg);
  const css = document.createElement('style');
  css.textContent = `
    .leaflet-pane.enhanced{filter:url(#onmSharpen)}
    .leaflet-pane.mars-tint.enhanced{filter:url(#onmSharpen) sepia(1) saturate(2.3) hue-rotate(-22deg) brightness(.86) contrast(1.08)}
    #detailChip{position:absolute;left:50%;top:62px;transform:translateX(-50%);z-index:940;display:none;padding:5px 12px;border-radius:14px;
      background:rgba(18,22,27,.93);border:1px solid #2a323c;color:#c9d0d6;font-size:12px;white-space:nowrap;pointer-events:none}
    #detailChip b{color:#fff}
    body.ui-simple #detailChip{top:70px}
    @media (max-width:900px){ #detailChip{top:auto;bottom:calc(44vh + 96px)} }`;
  document.head.appendChild(css);
  const chip = document.createElement('div'); chip.id = 'detailChip'; $('#app').appendChild(chip);

  // ---- 1. is there a real HiRISE photo here? ----
  function hiriseHere(lat, lon) {
    const z = 12, span = 0.3515625 / 2 ** z * 512;
    const col = Math.floor((lon + 180) / span), row = Math.floor((90 - lat) / span), key = row + '/' + col;
    if (cache.has(key)) return cache.get(key);
    // load it as an image: no tile = no HiRISE coverage (an image load avoids the red CORS error a fetch() of a missing tile logs)
    const p = new Promise(res => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = `${HIRISE}${z}/${row}/${col}`; });
    cache.set(key, p); p.then(v => cache.set(key, Promise.resolve(v)));
    return p;
  }
  // site close-up mosaics that are switched on and cover the centre
  function siteMax(c) {
    let m = 0;
    for (const o of OVERLAYS) if (o.group === 'Imagery' && o.bounds && o.id !== 'hirise' && map.hasLayer(overlayLayers[o.id]) && L.latLngBounds(o.bounds).contains(c)) m = Math.max(m, (o.maxNative || 0) + 1);
    return m;
  }

  // ---- 2. zoom limit + note ----
  async function update() {
    const id = ++busy;
    if (curBaseId !== 'smart' && curBaseId !== 'ctx') { setLimit(null); return; }
    const c = map.getCenter();
    let max = CTX_MAX, src = 'ctx';
    if (curBaseId === 'smart' && await hiriseHere(c.lat, c.lng)) { max = HIRISE_MAX; src = 'hirise'; }
    const sm = siteMax(c); if (sm > max) { max = sm; src = 'site'; }
    if (id !== busy) return;                       // a newer check started meanwhile
    setLimit(max, src);
  }
  function setLimit(max, src) {
    if (max == null) { limited = false; map.setMaxZoom(19); setEnhanced(false); chip.style.display = 'none'; return; }
    limited = src === 'ctx';
    if (map.getMaxZoom() !== max) map.setMaxZoom(max);
    if (map.getZoom() > max + 0.001) map.setZoom(max, { animate: false });   // past the new limit (e.g. panned away from HiRISE): step back out
    const z = map.getZoom();
    setEnhanced(limited && z > CTX_MAX - 1 + 0.05);
    if (limited && z >= CTX_MAX - 0.01) note();
  }
  function setEnhanced(on) {
    enhanced = on; basePane.classList.toggle('enhanced', on);
    if (on) { chip.innerHTML = '✨ <b>Enhanced</b> · real 5 m/px CTX photo, sharpened · nothing invented'; chip.style.display = 'block'; }
    else chip.style.display = 'none';
  }
  function note() {
    const now = Date.now(); if (now - lastNote < 20000) return; lastNote = now;
    toast('🔍 <b>Sharpest real photo here: CTX, 5 m per pixel.</b> Zoom stops here so the picture stays clear.<br>HiRISE close-ups (25 cm per pixel) exist in strips, e.g. at <b>Jezero</b> and <b>Gale</b>; there you can zoom much further.', 7000);
  }
  // trying to zoom past the limit → explain (wheel, +/- buttons, double-click all end here)
  map.getContainer().addEventListener('wheel', e => { if (limited && e.deltaY < 0 && map.getZoom() >= map.getMaxZoom() - 0.01) note(); }, { passive: true });
  let t = 0; const later = () => { clearTimeout(t); t = setTimeout(update, 200); };
  map.on('moveend zoomend', later);
  map.on('layeradd layerremove', e => { if (e.layer instanceof L.TileLayer || e.layer instanceof L.LayerGroup) later(); });
  window.addEventListener('DOMContentLoaded', () => setTimeout(update, 300));
  return { update, hiriseHere, get enhanced() { return enhanced; }, get limited() { return limited; } };
})();
