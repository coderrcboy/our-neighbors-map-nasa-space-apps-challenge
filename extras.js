// =====================================================================
//  Our Neighbor's Map — v5 extras
//   · Measure tool (ruler): click points, leg + total distance, elevation
//   · 3D traverse view: first-person / chase / orbit over MOLA terrain (Three.js, no account needed)
// =====================================================================

// ---------------------------------------------------------------------
//  Measure tool
// ---------------------------------------------------------------------
const Measure = (() => {
  let active = false, pts = [], lay = null, rubber = null, box = null;
  const Ctl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const d = L.DomUtil.create('div', 'leaflet-bar measure-ctl');
      d.innerHTML = '<a href="#" id="btnMeasure" title="Measure distance (click points on the map)" role="button" aria-label="Measure distance">📏</a>';
      L.DomEvent.disableClickPropagation(d);
      d.firstChild.onclick = e => { e.preventDefault(); active ? stop() : start(); };
      return d;
    },
  });
  new Ctl().addTo(map);

  function start() {
    if (active) return;
    active = true; pts = [];
    lay = L.layerGroup().addTo(map);
    $('#btnMeasure').classList.add('on');
    map.getContainer().style.cursor = 'crosshair';
    box = document.createElement('div'); box.id = 'measureBox'; box.className = 'float';
    document.body.appendChild(box); L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
    map.on('click', onClick); map.on('mousemove', onMove);
    render();
  }
  function stop() {
    if (!active) return;
    active = false;
    map.off('click', onClick); map.off('mousemove', onMove);
    lay && map.removeLayer(lay); lay = null; rubber = null; pts = [];
    box && box.remove(); box = null;
    $('#btnMeasure').classList.remove('on');
    map.getContainer().style.cursor = '';
  }
  async function onClick(e) {
    const p = { lat: e.latlng.lat, lon: e.latlng.lng, h: NaN };
    pts.push(p); draw(); render();
    const r = 0.05; await dem.ensure(DEM.maxZ, p.lat - r, p.lon - r, p.lat + r, p.lon + r).catch(() => {});
    p.h = elev(p.lat, p.lon); render(); draw();
  }
  function onMove(e) {
    if (!pts.length || !lay) return;
    const a = pts[pts.length - 1], ll = [[a.lat, a.lon], [e.latlng.lat, e.latlng.lng]];
    if (!rubber) rubber = L.polyline(ll, { color: '#fff', weight: 2, dashArray: '4 6', opacity: .8, interactive: false }).addTo(lay); else rubber.setLatLngs(ll);
    const d = hav(a, { lat: e.latlng.lat, lon: e.latlng.lng });
    rubber.bindTooltip(`+${fmtKm(d)} → ${fmtKm(total() + d)}`, { sticky: true, className: 'mtip' }).openTooltip(e.latlng);
  }
  const total = () => pts.reduce((s, p, i) => i ? s + hav(pts[i - 1], p) : 0, 0);
  const fmtKm = m => m < 1000 ? fmt(m) + ' m' : fmt(m / 1000, m < 10000 ? 2 : 1) + ' km';
  function draw() {
    if (!lay) return;
    lay.clearLayers(); rubber = null;
    if (pts.length > 1) {
      lay.addLayer(L.polyline(pts.map(p => [p.lat, p.lon]), { color: '#000', weight: 6, opacity: .4, interactive: false }));
      lay.addLayer(L.polyline(pts.map(p => [p.lat, p.lon]), { color: '#5bd1ff', weight: 3, interactive: false }));
    }
    let d = 0;
    pts.forEach((p, i) => {
      if (i) d += hav(pts[i - 1], p);
      const m = L.circleMarker([p.lat, p.lon], { radius: 5, color: '#fff', weight: 2, fillColor: '#5bd1ff', fillOpacity: 1, interactive: false });
      if (i === pts.length - 1 && i) m.bindTooltip(fmtKm(d), { permanent: true, direction: 'right', className: 'mtip' });
      lay.addLayer(m);
    });
  }
  function render() {
    if (!box) return;
    let h = '<div class="row"><b>📏 Measure</b><span class="sp"></span><button class="btn sm" id="mUndo">Undo</button><button class="btn sm" id="mClear">Clear</button><button class="btn sm pri" id="mDone">Done</button></div>';
    if (!pts.length) h += '<div class="small muted" style="margin-top:6px">Click the map to drop points. Distances follow the curve of Mars. Esc to finish.</div>';
    else {
      h += '<table class="mtab"><tr><th>#</th><th>Leg</th><th>Elev.</th><th>Δh</th></tr>';
      pts.forEach((p, i) => {
        const leg = i ? hav(pts[i - 1], p) : 0, dh = i && !isNaN(p.h) && !isNaN(pts[i - 1].h) ? p.h - pts[i - 1].h : NaN;
        h += `<tr><td>${i + 1}</td><td>${i ? fmtKm(leg) : '—'}</td><td>${isNaN(p.h) ? '…' : elevText(p.lat, p.lon, p.h)}</td><td>${isNaN(dh) ? '' : (dh >= 0 ? '+' : '') + fmt(dh) + ' m'}</td></tr>`;
      });
      h += `</table><div class="mtot">Total <b id="mTotal">${fmtKm(total())}</b>${pts.length > 1 ? ` · straight line ${fmtKm(hav(pts[0], pts[pts.length - 1]))}` : ''}</div>`;
    }
    box.innerHTML = h;
    $('#mUndo').onclick = () => { pts.pop(); draw(); render(); };
    $('#mClear').onclick = () => { pts = []; draw(); render(); };
    $('#mDone').onclick = stop;
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && active) stop(); });
  return { start, stop, get active() { return active; }, get total() { return total(); }, get points() { return pts.map(p => ({ ...p })); } };
})();

// ---------------------------------------------------------------------
//  3D traverse view
// ---------------------------------------------------------------------
const View3D = (() => {
  const THREE_URLS = ['https://unpkg.com/three@0.160.0/build/three.module.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'];
  let THREE = null, el = null, renderer = null, scene = null, cam = null, raf = 0, ro = null;
  let R = null, P = null, hab = null, geo = null, actor = null, camMode = 'chase', exag = 2;
  let f = 0, playing = false, speed = 1, lastT = 0, yaw = 0, pitch = -0.08, orbit = { th: 0.8, ph: 0.9, r: 1 }, drag = null, blinkers = [];
  let state = 'closed';

  async function loadThree() {
    if (THREE) return THREE;
    let err;
    for (const u of THREE_URLS) { try { THREE = await import(u); return THREE; } catch (e) { err = e; } }
    throw err;
  }

  async function open(route, prof, h, wps) {
    if (!route) return toast('Compute a route first');
    Sim.stop();
    R = route; P = prof; hab = h; f = 0; playing = false; yaw = 0; pitch = -0.08; camMode = 'chase';
    buildShell();
    state = 'loading';
    $('#v3dMsg').textContent = 'Loading 3D engine and MOLA terrain…';
    try { await loadThree(); }
    catch (e) { $('#v3dMsg').innerHTML = '⚠ Could not load the 3D engine (Three.js from unpkg/jsDelivr). Check your connection and try again.'; state = 'error'; return; }
    if (state !== 'loading') return;           // closed while loading
    try { await buildScene(wps || []); }
    catch (e) { console.error(e); $('#v3dMsg').textContent = '⚠ 3D view failed: ' + e.message; state = 'error'; return; }
    $('#v3dMsg').style.display = 'none';
    state = 'open'; lastT = performance.now(); raf = requestAnimationFrame(loop);
  }

  function buildShell() {
    close(true);
    el = document.createElement('div'); el.id = 'v3d';
    el.innerHTML = `
      <canvas id="v3dCanvas"></canvas>
      <div class="v3d-top float">
        <b>🧊 3D traverse</b>
        <div class="seg" id="v3dCams"><button data-cam="fpv">First-person</button><button data-cam="chase" class="on">Chase</button><button data-cam="orbit">Orbit</button></div>
        <label class="small">Height ×<select id="v3dEx"><option>1</option><option selected>2</option><option>3</option><option>5</option></select></label>
        <span class="sp"></span>
        <button class="btn sm" id="v3dClose" title="Close (Esc)">✕ Close</button>
      </div>
      <div id="v3dMsg">Loading…</div>
      <div class="v3d-bot float">
        <div class="row"><button class="btn sm pri" id="v3dPlay">▶ Play</button>
          <input type="range" id="v3dSlider" min="0" max="1000" value="0">
          <select id="v3dSpd" title="Playback speed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></div>
        <div id="v3dHud" class="simrow"></div>
        <div id="v3dAlert"></div>
        <div class="note" style="margin:4px 0 0">Terrain: MOLA elevation (~460 m grid) draped with HRSC/MOLA 200 m shaded relief, Mars-red tint. Heights exaggerated ×<span id="v3dExT">2</span>. Drag to look around · wheel to zoom (orbit).</div>
      </div>`;
    document.body.appendChild(el);
    $('#v3dClose').onclick = () => close();
    $$('#v3dCams button').forEach(b => b.onclick = () => setCam(b.dataset.cam));
    $('#v3dEx').onchange = e => { exag = +e.target.value; $('#v3dExT').textContent = exag; rebuildHeights(); };
    $('#v3dPlay').onclick = () => { playing = !playing; if (playing && f >= 1) f = 0; $('#v3dPlay').textContent = playing ? '❚❚ Pause' : '▶ Play'; };
    $('#v3dSlider').oninput = e => { f = e.target.value / 1000; };
    $('#v3dSpd').onchange = e => { speed = +e.target.value; };
    const cv = $('#v3dCanvas');
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch, th: orbit.th, ph: orbit.ph }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      if (!drag) return; const dx = (e.clientX - drag.x) / cv.clientWidth, dy = (e.clientY - drag.y) / cv.clientHeight;
      if (camMode === 'orbit') { orbit.th = drag.th - dx * 4; orbit.ph = clamp(drag.ph - dy * 3, 0.15, 1.45); }
      else { yaw = drag.yaw - dx * 3.5; pitch = clamp(drag.pitch - dy * 2, -1.2, 0.9); }
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); orbit.r = clamp(orbit.r * Math.exp(e.deltaY * 0.001), 0.08, 3); }, { passive: false });
  }

  function setCam(m) {
    camMode = m; yaw = 0; pitch = m === 'fpv' ? -0.05 : -0.08;
    $$('#v3dCams button').forEach(b => b.classList.toggle('on', b.dataset.cam === m));
    if (actor) actor.visible = m !== 'fpv';
    rebuildHeights();
  }

  // ---- terrain ----
  async function buildScene(wps) {
    const S = R.S;
    let s0 = 90, n0 = -90, w0 = 1e9, e0 = -1e9;
    const lon0 = S[0].lon;
    const ul = lon => lon + 360 * Math.round((lon0 - lon) / 360);     // unwrap around the start
    S.forEach(q => { const lo = ul(q.lon); s0 = Math.min(s0, q.lat); n0 = Math.max(n0, q.lat); w0 = Math.min(w0, lo); e0 = Math.max(e0, lo); });
    const lat0 = (s0 + n0) / 2, cosL = Math.max(0.05, Math.cos(lat0 * D2R)), mPerDeg = D2R * R_MARS;
    // square patch with margin
    let half = Math.max((n0 - s0) * mPerDeg, (e0 - w0) * mPerDeg * cosL) / 2;
    half = Math.max(half * 1.35, 2500);
    const cLon = (w0 + e0) / 2, cLat = lat0;
    const dLat = half / mPerDeg, dLon = half / (mPerDeg * cosL);
    const bb = { s: cLat - dLat, n: cLat + dLat, w: cLon - dLon, e: cLon + dLon };
    const zS = clamp(shadeLevel(half * 2 / 600), 3, SHADE.maxZ);
    await Promise.all([dem.ensure(DEM.maxZ, bb.s, bb.w, bb.n, bb.e).catch(() => {}), shade.ensure(zS, bb.s, bb.w, bb.n, bb.e).catch(() => {})]);
    const N = 180;
    const hs = new Float32Array((N + 1) * (N + 1)); let hmin = Infinity, hmax = -Infinity, sum = 0, cnt = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const v = elev(bb.n - (j / N) * 2 * dLat, bb.w + (i / N) * 2 * dLon); hs[j * (N + 1) + i] = v;
      if (!isNaN(v)) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); sum += v; cnt++; }
    }
    if (cnt < hs.length * 0.5) throw new Error('terrain tiles not available (offline?)');
    const h0 = sum / cnt; for (let k = 0; k < hs.length; k++) if (isNaN(hs[k])) hs[k] = h0;
    const toXZ = (lat, lon) => ({ x: (ul(lon) - cLon) * mPerDeg * cosL, z: -(lat - cLat) * mPerDeg });
    const hAt = (x, z) => {        // bilinear in the grid (metres, un-exaggerated)
      const gi = clamp((x + half) / (2 * half) * N, 0, N - 1e-6);   // columns west→east
      const i0 = Math.floor(gi), fx = gi - i0;
      const jj = clamp((half + z) / (2 * half) * N, 0, N - 1e-6), j0 = Math.floor(jj), fy = jj - j0;
      const H = (a, b) => hs[b * (N + 1) + a];
      return H(i0, j0) * (1 - fx) * (1 - fy) + H(i0 + 1, j0) * fx * (1 - fy) + H(i0, j0 + 1) * (1 - fx) * fy + H(i0 + 1, j0 + 1) * fx * fy;
    };
    geo = { N, half, hs, h0, hmin, hmax, toXZ, hAt, bb, cLat, cLon, zS };

    // ---- renderer / scene ----
    const T = THREE, cv = $('#v3dCanvas');
    renderer = new T.WebGLRenderer({ canvas: cv, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    scene = new T.Scene();
    const sky = new T.Color('#c9a07a'); scene.background = sky; scene.fog = new T.Fog(sky, half * 0.9, half * 4.5);
    cam = new T.PerspectiveCamera(60, 1, 0.5, half * 20);
    scene.add(new T.HemisphereLight('#f3d9bf', '#5a2c1c', 0.75));
    const sun = MarsTime.sun(R.start, hab.lat, hab.lon), el0 = Math.max(12, sun.el) * D2R, az = sun.az * D2R;
    const dl = new T.DirectionalLight('#fff1dd', 1.25);
    dl.position.set(Math.sin(az) * Math.cos(el0), Math.sin(el0), -Math.cos(az) * Math.cos(el0)).multiplyScalar(half * 3); scene.add(dl);

    // terrain mesh
    const g = new T.PlaneGeometry(2 * half, 2 * half, N, N); g.rotateX(-Math.PI / 2);
    // PlaneGeometry after rotateX: vertex k = j*(N+1)+i, x = -half + i*step, z = -half + j*step  (j=0 → north edge, z=-half)
    geo.terrainGeo = g;
    // texture from shaded relief (200 m) tinted Mars red
    const TW = 512, c = document.createElement('canvas'); c.width = c.height = TW;
    const g2 = c.getContext('2d'), img = g2.createImageData(TW, TW);
    for (let y = 0; y < TW; y++) for (let x = 0; x < TW; x++) {
      const lat = bb.n - (y + .5) / TW * 2 * dLat, lon = bb.w + (x + .5) / TW * 2 * dLon;
      let v = shade.val(zS, lat, lon); v = isNaN(v) ? 180 : v;
      const k = 0.45 + 0.75 * v / 255, o = (y * TW + x) * 4;
      img.data[o] = Math.min(255, 196 * k); img.data[o + 1] = Math.min(255, 104 * k); img.data[o + 2] = Math.min(255, 64 * k); img.data[o + 3] = 255;
    }
    g2.putImageData(img, 0, 0);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    const terrain = new T.Mesh(g, new T.MeshLambertMaterial({ map: tex }));
    scene.add(terrain);

    // route ribbon, hazard + radio markers, habitat, waypoints
    geo.route = S.map(q => { const p = toXZ(q.lat, q.lon); return { x: p.x, z: p.z, q }; });
    geo.ribbon = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, transparent: true, opacity: 0.95, depthTest: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    geo.ribbon.renderOrder = 2; scene.add(geo.ribbon);
    geo.markers = new T.Group(); scene.add(geo.markers);
    geo.wps = wps; geo.habXZ = toXZ(hab.lat, hab.lon);
    actor = makeActor(R.mode); scene.add(actor);
    rebuildHeights();
    orbit = { th: 0.8, ph: 0.9, r: 1 };
    ro = new ResizeObserver(resize); ro.observe(el); resize();
  }

  const Y = (x, z) => geo.hAt(x, z) * exag;    // exaggerated scene height relative to datum
  function rebuildHeights() {
    if (!geo || !THREE) return;
    const T = THREE, { N, half, hs, h0 } = geo, pos = geo.terrainGeo.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setY(k, (hs[k] - h0) * exag);
    pos.needsUpdate = true; geo.terrainGeo.computeVertexNormals();
    // make hAt relative to h0 so scene heights are small numbers
    if (!geo._rel) { const raw = geo.hAt; geo.hAt = (x, z) => raw(x, z) - h0; geo._rel = true; }
    // ribbon
    const w = camMode === 'fpv' ? 0.9 : Math.max(2.5, half / 700), lift = 1.2 * exag, pts = geo.route, nP = pts.length; geo.lift = lift;
    const posA = new Float32Array(nP * 2 * 3), colA = new Float32Array(nP * 2 * 3), idx = [];
    const col = new T.Color();
    for (let i = 0; i < nP; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(nP - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const L2 = Math.hypot(dx, dz) || 1; dx /= L2; dz /= L2;
      const p = pts[i], y = Y(p.x, p.z) + lift, nx = -dz * w, nz = dx * w;
      posA.set([p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz], i * 6);
      col.set(p.q.nolos && hazard(p.q, P) === 'ok' ? RADIO_COL : HZ_COL[hazard(p.q, P)]);
      colA.set([col.r, col.g, col.b, col.r, col.g, col.b], i * 6);
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const rg = geo.ribbon.geometry; rg.setAttribute('position', new T.BufferAttribute(posA, 3)); rg.setAttribute('color', new T.BufferAttribute(colA, 3)); rg.setIndex(idx); rg.computeBoundingSphere(); geo.ribbon.material.opacity = camMode === 'fpv' ? 0.6 : 0.95;
    // markers
    geo.markers.clear(); blinkers = [];
    const sc = Math.max(1, half / 1500);
    const pole = (x, z, color, hgt) => { const m = new T.Mesh(new T.CylinderGeometry(0.6 * sc, 0.6 * sc, hgt * sc, 6), new T.MeshLambertMaterial({ color })); m.position.set(x, Y(x, z) + hgt * sc / 2, z); geo.markers.add(m); return m; };
    // habitat: dome + radio mast (real mast height, scaled for visibility)
    const hx = geo.habXZ.x, hz = geo.habXZ.z;
    const dome = new T.Mesh(new T.SphereGeometry(8 * sc, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshLambertMaterial({ color: '#e8e8e8' }));
    dome.position.set(hx, Y(hx, hz), hz); geo.markers.add(dome);
    pole(hx + 9 * sc, hz, '#bbbbbb', Math.max(10, R.mast || 10) * 2);
    geo.markers.add(sprite('⌂ Habitat', '#ffffff', hx, Y(hx, hz) + 30 * sc, hz, sc));
    geo.wps.forEach((wp, i) => { const p = geo.toXZ(wp.lat, wp.lon); pole(p.x, p.z, '#5bb4ff', 24); geo.markers.add(sprite(`◆${i + 1} ${wp.n}`, '#9fd3ff', p.x, Y(p.x, p.z) + 32 * sc, p.z, sc)); });
    const S = R.S, runs = test => { const out = []; let a = -1; for (let i = 1; i <= S.length; i++) { const on = i < S.length && test(S[i]); if (on && a < 0) a = i; if (!on && a >= 0) { out.push([a, i - 1]); a = -1; } } return out; };
    const mk = (test, label, color) => runs(test).forEach(([a, b]) => { const p = geo.route[(a + b) >> 1]; const s = sprite(label, color, p.x, Y(p.x, p.z) + 18 * sc, p.z, sc); geo.markers.add(s); blinkers.push(s); });
    mk(p => p.loose, '⚠ loose sand', '#f2b636'); mk(p => p.slope > P.maxSlope, '⛔ too steep', '#ff4d4d'); mk(p => p.nolos, '📡 no radio', '#c79bff');
  }
  function sprite(text, color, x, y, z, sc) {
    const T = THREE, c = document.createElement('canvas'), g = c.getContext('2d'); c.width = 512; c.height = 96;
    g.font = '600 44px system-ui,Segoe UI,sans-serif'; const w = Math.min(500, g.measureText(text).width + 36);
    g.fillStyle = 'rgba(10,12,16,.78)'; g.beginPath(); g.roundRect ? g.roundRect((512 - w) / 2, 10, w, 76, 18) : g.rect((512 - w) / 2, 10, w, 76); g.fill();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 50);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    const s = new T.Sprite(new T.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
    s.scale.set(0.2, 0.0375, 1); s.position.set(x, y, z); s.renderOrder = 5; return s;
  }
  function makeActor(mode) {
    const T = THREE, grp = new T.Group(), white = new T.MeshLambertMaterial({ color: '#f2f2f2' }), dark = new T.MeshLambertMaterial({ color: '#333' });
    if (mode === 'eva') {
      const body = new T.Mesh(new T.CylinderGeometry(0.32, 0.36, 1.1, 12), white); body.position.y = 0.95; grp.add(body);
      const head = new T.Mesh(new T.SphereGeometry(0.27, 16, 12), white); head.position.y = 1.72; grp.add(head);
      const visor = new T.Mesh(new T.SphereGeometry(0.2, 12, 8, -0.9, 1.8, 1.1, 0.8), new T.MeshLambertMaterial({ color: '#d9a64a' })); visor.position.set(0, 1.72, 0.1); grp.add(visor);
      const pack = new T.Mesh(new T.BoxGeometry(0.5, 0.7, 0.28), white); pack.position.set(0, 1.05, -0.32); grp.add(pack);
      [-0.15, 0.15].forEach(x => { const leg = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 0.45, 8), white); leg.position.set(x, 0.22, 0); grp.add(leg); });
    } else {
      const body = new T.Mesh(new T.BoxGeometry(2.6, 1.6, 4.4), white); body.position.y = 1.4; grp.add(body);
      const win = new T.Mesh(new T.BoxGeometry(2.2, 0.6, 0.1), new T.MeshLambertMaterial({ color: '#223' })); win.position.set(0, 1.75, 2.22); grp.add(win);
      [[-1.4, -1.5], [1.4, -1.5], [-1.4, 0], [1.4, 0], [-1.4, 1.5], [1.4, 1.5]].forEach(([x, z]) => { const w = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 0.4, 14), dark); w.rotation.z = Math.PI / 2; w.position.set(x, 0.55, z); grp.add(w); });
    }
    return grp;
  }

  // ---- animation ----
  function poseAt(fr) {
    const S = R.S, D = S[S.length - 1].d * fr; let i = S.findIndex(p => p.d >= D); if (i < 1) i = i < 0 ? S.length - 1 : 1;
    const a = geo.route[i - 1], b = geo.route[i], u = b.q.d > a.q.d ? clamp((D - a.q.d) / (b.q.d - a.q.d), 0, 1) : 0;
    const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
    // heading: look ~150 m (or 3% of route) ahead for a smooth camera
    const ahead = Math.max(150, S[S.length - 1].d * 0.03); let k = i; while (k < S.length - 1 && S[k].d < D + ahead) k++;
    const c = geo.route[k]; let hd = Math.atan2(c.x - x, c.z - z); if (k === i && i === S.length - 1) hd = Math.atan2(b.x - a.x, b.z - a.z);
    return { x, z, hd, a: a.q, b: b.q, u, i };
  }
  function loop(now) {
    if (state !== 'open') return;
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    const Dkm = R.S[R.S.length - 1].d / 1000, dur = clamp(Dkm * 4, 25, 90);      // real seconds for the whole route at 1×
    if (playing) { f = Math.min(1, f + dt * speed / dur); if (f >= 1) { playing = false; $('#v3dPlay').textContent = '▶ Replay'; } }
    if (document.activeElement !== $('#v3dSlider')) $('#v3dSlider').value = Math.round(f * 1000);
    const p = poseAt(f), sc = Math.max(1, geo.half / 1500), gy = Y(p.x, p.z);
    actor.position.set(p.x, gy, p.z); actor.rotation.y = p.hd; actor.scale.setScalar(camMode === 'orbit' ? Math.max(1, sc * 6) : Math.max(1, sc * 2));
    const T = THREE;
    if (camMode === 'fpv') {
      const eye = (R.mode === 'eva' ? 1.7 : 2.6) * Math.max(1, sc * 0.6);
      cam.position.set(p.x, gy + (geo.lift || 0) + eye, p.z);
      const h = p.hd + yaw; cam.lookAt(p.x + Math.sin(h) * 100, gy + (geo.lift || 0) + eye + Math.tan(pitch) * 100, p.z + Math.cos(h) * 100);
    } else if (camMode === 'chase') {
      const back = 35 * Math.max(1, sc * 1.6), up = 14 * Math.max(1, sc * 1.6), h = p.hd + yaw;
      const cx = p.x - Math.sin(h) * back, cz = p.z - Math.cos(h) * back, cy = Math.max(gy + up, Y(cx, cz) + 4);
      cam.position.set(cx, cy, cz); cam.lookAt(p.x, gy + 2 + Math.tan(pitch + 0.08) * back, p.z);
    } else {
      const r = geo.half * 1.6 * orbit.r;
      cam.position.set(p.x + r * Math.sin(orbit.ph) * Math.sin(orbit.th), gy + r * Math.cos(orbit.ph), p.z + r * Math.sin(orbit.ph) * Math.cos(orbit.th));
      cam.lookAt(p.x, gy, p.z);
    }
    const blink = 0.55 + 0.45 * Math.sin(now / 180); blinkers.forEach(s => { s.material.opacity = blink; });
    renderer.render(scene, cam);
    hud(p);
    raf = requestAnimationFrame(loop);
  }
  let lastHud = '';
  function hud(p) {
    const { a, b, u } = p, S = R.S, D = a.d + (b.d - a.d) * u, tc = (a.tc || 0) + ((b.tc || 0) - (a.tc || 0)) * u;
    const when = new Date(R.start.getTime() + tc * 1000), sun = MarsTime.sun(when, hab.lat, hab.lon);
    let res;
    if (R.mode === 'eva') res = `O₂ <b>${fmt(Math.max(0, 1 - ((a.ec || 0) + ((b.ec || 0) - (a.ec || 0)) * u) / 20100 * 1.429e-3 / P.o2) * 100)}%</b>`;
    else res = `Battery <b>${fmt(Math.max(0, 1 - ((a.kc || 0) + ((b.kc || 0) - (a.kc || 0)) * u) / P.battKWh) * 100)}%</b>`;
    const hz = hazard(b, P);
    const html = `<span><b>${fmt(D / 1000, 2)}</b> / ${fmt(S[S.length - 1].d / 1000, 2)} km</span><span>T+<b>${Math.floor(tc / 3600)}:${String(Math.floor(tc % 3600 / 60)).padStart(2, '0')}</b></span><span>${res}</span><span>⛰ <b>${fmt(b.h)}</b> m</span><span>∠ <b>${fmt(b.slope, 1)}°</b></span><span>☀ <b>${fmt(sun.el, 0)}°</b></span><span>📡 <b style="color:${b.nolos ? RADIO_COL : 'var(--ok)'}">${b.nolos ? 'LOST' : 'OK'}</b></span>`;
    let al;
    if (hz === 'bad') al = `<div class="alert bad">⛔ DANGER — slope ${fmt(b.slope, 1)}° exceeds the ${P.maxSlope}° limit</div>`;
    else if (b.nolos) al = `<div class="alert radio">📡 RADIO BLACKOUT — terrain blocks line-of-sight to the habitat mast</div>`;
    else if (b.loose) al = `<div class="alert warn">⚠ LOOSE SAND — slow down, test footing</div>`;
    else if (hz === 'warn') al = `<div class="alert warn">⚠ LOOK OUT — steep ground (${fmt(b.slope, 1)}°)</div>`;
    else al = `<div class="alert ok">✓ Terrain nominal</div>`;
    const key = html + al; if (key === lastHud) return; lastHud = key;
    $('#v3dHud').innerHTML = html; $('#v3dAlert').innerHTML = al;
  }
  function resize() {
    if (!renderer || !el) return; const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix();
  }
  function close(silent) {
    state = 'closed'; cancelAnimationFrame(raf); raf = 0;
    ro && ro.disconnect(); ro = null;
    if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); renderer = null; }
    scene = null; geo = null; actor = null; blinkers = []; lastHud = '';
    if (el) { el.remove(); el = null; }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && el) close(); });
  return { open, close, setCam, get state() { return state; }, get camMode() { return camMode; }, get frac() { return f; }, seek(v) { f = clamp(v, 0, 1); }, play() { playing = true; } };
})();
