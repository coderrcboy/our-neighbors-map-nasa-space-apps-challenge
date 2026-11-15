// =====================================================================
//  Our Neighbor's Map — v6 Simple mode
//  A beginner-friendly interface on top of the same map and planner.
//  Technical mode = the full v5 interface (plus the new water & ice layers).
// =====================================================================

const UI = (() => {
  const params = new URLSearchParams(location.search);
  let mode = params.get('ui');
  if (mode !== 'simple' && mode !== 'technical') { try { mode = localStorage.getItem('onm_ui'); } catch (e) {} }
  if (mode !== 'simple' && mode !== 'technical') mode = 'simple';
  document.body.classList.add(mode === 'simple' ? 'ui-simple' : 'ui-technical');
  let curTab = 'plan', welcomeOff = false, demoPending = false;

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (tag, attrs, html) => { const e = document.createElement(tag); Object.assign(e, attrs); if (html != null) e.innerHTML = html; return e; };
  const ICON = {
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
    route: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c3-1 4-5 7-6s5 1 7-3"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="10" r="2"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    ruler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
    cube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  };

  // ---------------- static DOM ----------------
  const app = $('#app');
  // mode switch (both modes)
  const sw = el('div', { id: 'uiMode', className: 'uimode', role: 'group' }, `<button data-ui="simple">Simple</button><button data-ui="technical">Technical</button>`);
  sw.setAttribute('aria-label', 'Interface mode');
  $('#leftPanel .brand').after(sw);
  // step bar
  const stepBar = el('nav', { id: 'stepBar', className: 'float' }, `
    <button data-step="1"><span>1</span>Explore Mars</button>
    <button data-step="2"><span>2</span>Plan a walk or drive</button>
    <button data-step="3"><span>3</span>Is it safe?</button>`);
  stepBar.setAttribute('aria-label', 'Main steps');
  app.appendChild(stepBar);
  // welcome card
  const welcome = el('div', { id: 'welcome' }, `
    <div class="wtop"><div><div class="kick">NEW HERE?</div><div class="wt">What do you want to do?</div></div><button class="x" id="wClose" aria-label="Close">✕</button></div>
    <button class="wopt" data-w="look">${ICON.globe}<span><b>Look around Mars</b><small>Zoom, switch map layers, read about places</small></span></button>
    <button class="wopt" data-w="plan">${ICON.route}<span><b>Plan a walk or rover drive</b><small>Pick a base, add stops, get a safe route</small></span></button>
    <button class="wopt pri" data-w="demo">${ICON.play}<span><b>Watch a demo mission</b><small>A walk in Jezero crater, shown in 3D</small></span></button>
    <div class="wtip">Tip: click anywhere on the map to learn what is there.</div>`);
  $('#qres').after(welcome);
  // simple panes
  $('#p-layers').after(el('div', { className: 'pane', id: 'p-slayers' }));
  $('#p-plan').after(el('div', { className: 'pane', id: 'p-splan' }));
  // labelled tool bar
  const tools = el('div', { id: 'toolsBar', className: 'float', role: 'toolbar' }, `
    <button data-t="measure">${ICON.ruler}<span>Measure</span></button>
    <button data-t="3d">${ICON.cube}<span>3D view</span></button>
    <button data-t="weather">${ICON.sun}<span>Weather</span></button>
    <button data-t="in" aria-label="Zoom in">${ICON.plus}<span>Zoom in</span></button>
    <button data-t="out" aria-label="Zoom out">${ICON.minus}<span>Zoom out</span></button>`);
  tools.setAttribute('aria-label', 'Map tools');
  app.appendChild(tools);
  // plain-words cursor readout
  app.appendChild(el('div', { id: 'plainHud', className: 'float' }, '<span>Move your mouse over Mars to see what is there.</span>'));
  // phone navigation
  const mnav = el('nav', { id: 'mobileNav' }, `
    <button data-m="map">${ICON.map}<span>Map</span></button>
    <button data-m="layers">${ICON.layers}<span>Layers</span></button>
    <button data-m="plan">${ICON.route}<span>Plan</span></button>
    <button data-m="safety">${ICON.shield}<span>Safety</span></button>`);
  mnav.setAttribute('aria-label', 'Sections');
  app.appendChild(mnav);

  // ---------------- mode switching ----------------
  const TAB_SIMPLE = { layers: 'Map layers', plan: 'Plan a trip', cond: 'Weather', explore: 'Places' };
  const tabOrig = {};
  function labelTabs() {
    $$('.tabs button[data-tab]').forEach(b => {
      const id = b.dataset.tab; if (!tabOrig[id]) tabOrig[id] = b.innerHTML;
      b.innerHTML = mode === 'simple' ? tabOrig[id].replace(/<\/i>.*$/, '</i>' + TAB_SIMPLE[id]) : tabOrig[id];
    });
  }
  function set(m) {
    mode = m; try { localStorage.setItem('onm_ui', m); } catch (e) {}
    document.body.classList.toggle('ui-simple', m === 'simple'); document.body.classList.toggle('ui-technical', m === 'technical');
    $$('#uiMode button').forEach(b => { b.classList.toggle('on', b.dataset.ui === m); b.setAttribute('aria-pressed', b.dataset.ui === m); });
    labelTabs();
    if (m === 'simple') { syncLayers(); renderPlan(); }
    switchTab(curTab);
    setTimeout(() => map.invalidateSize(), 50);
  }
  $$('#uiMode button').forEach(b => b.onclick = () => { set(b.dataset.ui); toast(b.dataset.ui === 'simple' ? 'Simple mode: plain words and step-by-step planning.' : 'Technical mode: all layers, numbers and settings.'); });
  document.addEventListener('onm:tab', e => { curTab = e.detail; updateSteps(); if (mode === 'simple' && curTab === 'layers') syncLayers(); });

  // ---------------- step bar ----------------
  function updateSteps() {
    const st = Planner.state, cur = curTab !== 'plan' ? 1 : st.route ? 3 : 2;
    $$('#stepBar button').forEach(b => { const k = +b.dataset.step; b.classList.toggle('on', k === cur); b.classList.toggle('done', k < cur || (k === 2 && !!st.route)); });
  }
  $$('#stepBar button').forEach(b => b.onclick = () => {
    const k = +b.dataset.step;
    if (k === 1) switchTab('layers');
    else if (k === 2) switchTab('plan');
    else { switchTab('plan'); if (!Planner.state.route) toast('Plan a route first: pick a base and add stops, then press <b>Find the safest route</b>.', 5000); else $('#sSafety')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  // ---------------- welcome ----------------
  function hideWelcome() { welcomeOff = true; welcome.style.display = 'none'; }
  $('#wClose').onclick = hideWelcome;
  $$('#welcome [data-w]').forEach(b => b.onclick = () => {
    const w = b.dataset.w; hideWelcome();
    if (w === 'look') { switchTab('layers'); toast('Click anywhere on Mars to learn what is there. Turn on <b>Water &amp; ice</b> layers to see where water was.', 6000); }
    else if (w === 'plan') { switchTab('plan'); toast('Search a place and press <b>Start mission here</b>, or click <b>Place base on map</b>.', 6000); }
    else { demoPending = true; switchTab('plan'); Planner.loadPreset('jezero'); toast('Demo: planning a safe walk in Jezero crater…', 4000); }
  });
  map.on('click', () => { if (!welcomeOff) hideWelcome(); });

  // ---------------- simple layers pane ----------------
  function techFor(id) { return BASEMAPS.find(b => b.id === id) || OVERLAYS.find(o => o.id === id); }
  function renderLayers() {
    const groups = {}; SIMPLE_GROUPS.forEach(g => groups[g] = []);
    for (const [id, [g, n, d]] of Object.entries(SIMPLE_INFO)) groups[g].push({ id, n, d, base: !!BASEMAPS.find(b => b.id === id) });
    let h = `<div class="stitle">Map layers</div><p class="ssub">Pick what you want to see. Tap ⓘ for the science name and where the data comes from.</p>
      <label class="sfind"><span aria-hidden="true">⌕</span><input id="sLayFind" placeholder="Find a layer: ice, dust, rocks…" aria-label="Find a layer"></label>`;
    SIMPLE_GROUPS.forEach((g, gi) => {
      const water = g === 'Water & ice';
      h += `<details class="sgrp${water ? ' water' : ''}" ${gi < 3 ? 'open' : ''}><summary><b>${esc(g)}</b>${water ? '<span class="newtag">NEW · HIGH-VALUE SURVEY SITES</span>' : `<span class="cnt">${groups[g].length} layers</span>`}</summary>`;
      for (const L of groups[g]) {
        const t = techFor(L.id);
        h += `<div class="slyr" data-find="${esc((g + ' ' + L.n + ' ' + L.d + ' ' + t.name).toLowerCase())}">
          <input type="${L.base ? 'radio' : 'checkbox'}" ${L.base ? 'name="sbase"' : ''} id="s_${L.id}" data-sid="${L.id}" data-kind="${L.base ? 'base' : 'ov'}">
          <label for="s_${L.id}"><b>${esc(L.n)}</b><small>${esc(L.d)}</small><em class="sinfo" hidden>Science name: ${esc(t.name)}. ${esc(t.desc || '')}</em></label>
          <button class="ibtn" data-info="${L.id}" aria-label="About ${esc(L.n)}">ⓘ</button></div>`;
      }
      h += `</details>`;
    });
    h += `<p class="note">Want every science detail? Switch to <b>Technical</b> at the top left.</p>`;
    $('#p-slayers').innerHTML = h;
    $$('#p-slayers [data-sid]').forEach(inp => inp.onchange = () => {
      const id = inp.dataset.sid;
      const tech = inp.dataset.kind === 'base' ? $('#b_' + id) : $('#o_' + id);
      if (!tech) return;
      tech.checked = inp.checked; tech.dispatchEvent(new Event('change'));
      if (inp.checked && id === 'ocean') toast('Blue = land below the proposed ancient ocean level (−3,760 m). Zoom out to see the whole northern plains.', 6000);
      if (inp.checked && id === 'ice') toast('🧊 Big blue dots: new craters that dug up ice. Small dots: glaciers hidden under rock. Most are 35–60° north or south.', 6000);
      if (inp.checked && id === 'slope' && map.getZoom() < 2) toast('Zoom in to see steep ground');
    });
    $$('#p-slayers [data-info]').forEach(b => b.onclick = () => { const s = b.parentElement.querySelector('.sinfo'); s.hidden = !s.hidden; });
    $('#sLayFind').oninput = e => {
      const q = e.target.value.trim().toLowerCase();
      $$('#p-slayers .slyr').forEach(r => r.style.display = !q || r.dataset.find.includes(q) ? '' : 'none');
      $$('#p-slayers details').forEach((d, i) => d.open = q ? [...d.querySelectorAll('.slyr')].some(r => r.style.display !== 'none') : i < 3);
    };
  }
  function syncLayers() {
    if (!$('#p-slayers .slyr')) renderLayers();
    $$('#p-slayers [data-sid]').forEach(inp => { const tech = inp.dataset.kind === 'base' ? $('#b_' + inp.dataset.sid) : $('#o_' + inp.dataset.sid); if (tech) inp.checked = tech.checked; });
  }

  // ---------------- simple plan pane ----------------
  function plainReasons(r, P, m) {
    const out = [], add = (ok, t) => out.push({ ok, t });
    if (m === 'eva') {
      const o = r.o2 / P.o2 * 100, b = r.totalS / 3600 / P.battH * 100;
      add(o <= 75, o <= 75 ? `Enough air: uses ${fmt(o)}% of the suit's oxygen` : `Not enough spare air: needs ${fmt(o)}% of the suit's oxygen`);
      add(b <= 75, b <= 75 ? `Suit power is enough: ${fmt(r.totalS / 3600, 1)} h trip, ${P.battH} h battery` : `Suit battery runs low: ${fmt(r.totalS / 3600, 1)} h trip on a ${P.battH} h battery`);
    } else {
      const e = r.kwh / P.battKWh * 100;
      add(e <= 75, e <= 75 ? `Rover battery is enough (${fmt(e)}% used)` : `Rover battery runs low (${fmt(e)}% used)`);
    }
    add(r.far <= P.walkback, r.far <= P.walkback ? `Never more than ${fmt(r.far / 1000, 1)} km from base` : `Goes ${fmt(r.far / 1000, 1)} km from base, past the ${fmt(P.walkback / 1000)} km ${m === 'eva' ? 'walk-home' : 'rescue'} limit`);
    add(r.maxSl <= P.maxSlope, r.maxSl <= P.maxSlope ? `No ground too steep (steepest ${fmt(r.maxSl)}°)` : `Some ground is too steep (${fmt(r.maxSl)}°) — press Reroute`);
    add(r.loose <= 0, r.loose <= 0 ? 'No soft sand on the way' : `Watch out: ${fmt(r.loose / 1000, 1)} km of soft sand`);
    if (r.s0.el < 0) add(false, 'Leaves before sunrise — start later');
    else if (r.minEl < 0) add(false, 'Gets dark before you are back');
    else if (r.minEl < 5) add(false, 'Back only just before dusk');
    else add(true, 'Back before dark');
    const lm = r.radio ? r.radio.longest / 60 : 0;
    add(lm <= 0, lm <= 0 ? 'Radio reaches base the whole way' : `No radio contact with base for about ${fmt(lm)} min`);
    return out.sort((a, b) => a.ok - b.ok);
  }
  function renderPlan() {
    if (mode !== 'simple') return;
    const st = Planner.state, P = PROFILES[st.mode], r = st.route, eva = st.mode === 'eva';
    let h = `<div class="stitle">Plan a ${eva ? 'walk' : 'drive'}</div>
      <div class="smode" role="group" aria-label="How will you travel"><button data-sm="eva" class="${eva ? 'on' : ''}">On foot (spacesuit)</button><button data-sm="rover" class="${eva ? '' : 'on'}">By rover</button></div>`;
    // step 1
    if (st.hab) h += `<div class="sstep done"><span class="num">✓</span><div class="sbody"><b>Step 1 · Your base</b><small>${esc(st.hab.n.replace('Habitat · ', '').replace('Base · ', ''))}</small></div><button class="link" data-a="hab">Change</button></div>`;
    else h += `<div class="sstep cur"><span class="num">1</span><div class="sbody"><b>Step 1 · Choose a base</b><small>Search a place on the left and press <b>Start mission here</b>, or:</small>
        <button class="btn" data-a="hab">⌂ Place base on the map</button>
        <div class="small muted" style="margin-top:8px">…or try a ready-made trip:</div>
        <div class="spresets">${PRESETS.map(p => `<button class="btn sm" data-preset2="${p.id}">${esc(p.name)}</button>`).join('')}</div></div></div>`;
    // step 2
    const cur2 = st.hab && !r;
    h += `<div class="sstep ${!st.hab ? 'off' : r ? 'done' : 'cur'}"><span class="num">${r ? '✓' : '2'}</span><div class="sbody"><b>Step 2 · Where do you want to go?</b>`;
    if (st.hab) {
      h += `<small>${st.click === 'wp' ? '<b class="live">Click the map to add stops</b> (Esc to stop).' : 'Add stops on the map. Drag a pin to move it.'}</small>`;
      h += st.wps.map((w, i) => `<div class="sstop"><span>${i + 1}</span><em>${esc(w.n)} · ${esc(w.task)}</em><small>${w.dwell} min</small><button class="x" data-del2="${i}" aria-label="Remove stop ${i + 1}">✕</button></div>`).join('');
      h += `<button class="btn ${st.click === 'wp' ? 'on' : ''}" data-a="wp">＋ ${st.click === 'wp' ? 'Adding stops… (click to stop)' : 'Add stops on the map'}</button>
        <label class="small sret"><input type="checkbox" id="sRet" ${st.returnHome ? 'checked' : ''}> Come back to base at the end</label>
        <button class="btn pri big" id="sGo" ${st.wps.length ? '' : 'disabled'}>Find the safest route</button>`;
    } else h += `<small>First choose a base.</small>`;
    h += `</div></div>`;
    // step 3
    h += `<div class="sstep ${r ? 'cur' : 'off'}" id="sSafety"><span class="num">3</span><div class="sbody"><b>Step 3 · Is it safe?</b>`;
    if (r && r.surv) {
      const p = r.surv.pct, lvl = p >= 85 ? 'ok' : p >= 60 ? 'warn' : 'bad', word = { ok: 'low risk', warn: 'some risk', bad: 'high risk' }[lvl];
      const reasons = plainReasons(r, P, st.mode).slice(0, 5);
      const hasBad = r.S.some(q => hazard(q, P) === 'bad') || r.relaxed;
      h += `<div class="sscore ${lvl}"><span class="pct">${fmt(p)}%</span><span>safety score<br><b>${word}</b></span></div>
        <div class="sbar"><i class="${lvl}" style="width:${p}%"></i></div>
        <ul class="sreasons">${reasons.map(x => `<li class="${x.ok ? 'ok' : 'warn'}">${x.ok ? '✓' : '⚠'} ${esc(x.t)}</li>`).join('')}</ul>
        <div class="sbtns"><button class="btn" id="sPlay">▶ Play the ${eva ? 'walk' : 'drive'}</button><button class="btn" id="s3d">🧊 See it in 3D</button>${hasBad ? '<button class="btn warnb" id="sRer">↻ Reroute around danger</button>' : ''}</div>
        <div class="small muted">${fmt(r.S[r.S.length - 1].d / 1000, 1)} km · about ${fmt(r.totalS / 3600, 1)} h · the score multiplies air, power, distance, slopes, sand, daylight and radio.</div>
        <button class="link" id="sMore">Show all numbers and the checklist (Technical mode)</button>`;
    } else h += `<small>Your safety score appears here after step 2.</small>`;
    h += `</div></div>`;
    h += `<button class="sexpert" id="sExpert">Suit, air &amp; radio settings (for experts) <span aria-hidden="true">›</span></button>`;
    $('#p-splan').innerHTML = h;
    // wire
    $$('#p-splan [data-sm]').forEach(b => b.onclick = () => Planner.setMode(b.dataset.sm));
    $$('#p-splan [data-a]').forEach(b => b.onclick = () => { const want = b.dataset.a; Planner.setClick(want); if (want === 'hab' && Planner.state.click === 'hab') toast('Click the map where your base should be.'); });
    $$('#p-splan [data-preset2]').forEach(b => b.onclick = () => Planner.loadPreset(b.dataset.preset2));
    $$('#p-splan [data-del2]').forEach(b => b.onclick = () => Planner.removeWp(+b.dataset.del2));
    if ($('#sRet')) $('#sRet').onchange = e => Planner.setReturn(e.target.checked);
    if ($('#sGo')) $('#sGo').onclick = () => { if (Planner.state.click) Planner.setClick(Planner.state.click); Planner.compute(); };
    if ($('#sPlay')) $('#sPlay').onclick = () => Sim.start(st.route, PROFILES[st.mode], st.hab);
    if ($('#s3d')) $('#s3d').onclick = () => View3D.open(st.route, PROFILES[st.mode], st.hab, st.wps);
    if ($('#sRer')) $('#sRer').onclick = () => $('#btnReroute')?.click();
    if ($('#sMore')) $('#sMore').onclick = () => { set('technical'); switchTab('plan'); setTimeout(() => $('#telemetry')?.scrollIntoView({ block: 'start' }), 100); };
    $('#sExpert').onclick = () => { set('technical'); switchTab('plan'); setTimeout(() => $('#suitHead')?.scrollIntoView({ block: 'start' }), 100); };
    if (cur2 && st.wps.length === 0 && st.click !== 'wp') { /* hint shown in text */ }
  }
  let planT = 0;
  document.addEventListener('onm:plan', () => {
    updateSteps();
    if (Planner.state.hab && !welcomeOff) hideWelcome();
    cancelAnimationFrame(planT); planT = requestAnimationFrame(renderPlan);
    if (demoPending && Planner.state.route) { demoPending = false; setTimeout(async () => { const s = Planner.state; await View3D.open(s.route, PROFILES[s.mode], s.hab, s.wps); if (View3D.state === 'open') View3D.play(); }, 600); }
  });

  // ---------------- tools bar ----------------
  $$('#toolsBar [data-t]').forEach(b => b.onclick = () => {
    const t = b.dataset.t, st = Planner.state;
    if (t === 'measure') Measure.active ? Measure.stop() : Measure.start();
    else if (t === '3d') { if (st.route) View3D.open(st.route, PROFILES[st.mode], st.hab, st.wps); else { toast('Plan a route first, then you can walk it in 3D.'); switchTab('plan'); } }
    else if (t === 'weather') switchTab('cond');
    else if (t === 'in') map.zoomIn(); else map.zoomOut();
  });
  setInterval(() => { const b = $('#toolsBar [data-t=measure]'); if (b) b.classList.toggle('on', Measure.active); }, 300);

  // ---------------- plain-words cursor readout ----------------
  let pt = 0;
  map.on('mousemove', e => {
    if (mode !== 'simple') return;
    const now = performance.now(); if (now - pt < 120) return; pt = now;
    const { lat, lng } = e.latlng, h = elev(lat, lng);
    if (isNaN(h)) { dem.ensure(DEM.maxZ, lat - .05, lng - .05, lat + .05, lng + .05).catch(() => {}); }
    const d = 1 / dem.ppd(DEM.maxZ), dx = 2 * d * D2R * R_MARS * Math.max(.05, Math.cos(lat * D2R)), dy = 2 * d * D2R * R_MARS;
    const sl = Math.atan(Math.hypot((elev(lat, lng + d) - elev(lat, lng - d)) / dx, (elev(lat + d, lng) - elev(lat - d, lng)) / dy)) / D2R;
    const steep = isNaN(sl) ? '' : sl < 3 ? `Flat (${fmt(sl)}°)` : sl < 8 ? `Gentle slope (${fmt(sl)}°)` : sl < 15 ? `Steep (${fmt(sl)}°)` : `Very steep (${fmt(sl)}°)`;
    const sun = MarsTime.sun(new Date(), lat, lng), tod = sun.el > 0 ? 'Daytime' : 'Night';
    const hab = Planner.state.hab, far = hab ? hav(hab, { lat, lon: lng }) : null;
    const water = lat > 0 && h < OCEAN_LEVEL ? '<b class="wtr">Below the old ocean level</b>' : '';
    $('#plainHud').innerHTML = `<span>Under your mouse:</span><b>${isNaN(h) ? 'loading…' : 'Height ' + fmt(h) + ' m'}</b>${steep ? `<b>${steep}</b>` : ''}<b>${tod}, ${MarsTime.fmtH(sun.ltst)} Mars time</b>${far != null ? `<b>${far >= 1000 ? fmt(far / 1000, 1) + ' km' : fmt(far) + ' m'} from base</b>` : ''}${water}`;
  });

  // ---------------- phone navigation ----------------
  $$('#mobileNav [data-m]').forEach(b => b.onclick = () => {
    const m = b.dataset.m; $$('#mobileNav button').forEach(x => x.classList.toggle('on', x === b));
    if (m === 'map') $('#rightPanel').classList.add('collapsed');
    else if (m === 'layers') switchTab('layers');
    else { switchTab('plan'); if (m === 'safety') setTimeout(() => $('#sSafety')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }
  });

  // ---------------- boot ----------------
  window.addEventListener('DOMContentLoaded', () => {
    renderLayers(); set(mode);
    if (Planner.state.hab) hideWelcome();
  });
  return { set, get mode() { return mode; }, plainReasons, renderPlan };
})();

// Simple-mode guided tour (Technical mode keeps the detailed tour)
const SIMPLE_TOUR = [
  { sel: null, t: 'Welcome to Our Neighbor\'s Map', b: 'This map helps you explore Mars and plan a safe walk or rover drive for the first astronauts. You are in <b>Simple</b> mode: everything is in plain words.' },
  { sel: '#uiMode', t: 'Simple or Technical', b: 'Switch here at any time. <b>Technical</b> shows every science layer, number and setting.' },
  { sel: '#stepBar', t: 'Three easy steps', b: '<b>1</b> Explore Mars, <b>2</b> plan a walk or drive, <b>3</b> see how safe it is. The bar shows where you are.' },
  { sel: '#rightPanel', t: 'Map layers in plain words', b: 'Turn on layers to colour the map. Start with <b>Water &amp; ice</b>: old rivers, buried ice and an ancient ocean shoreline, the best places to explore.', tab: 'layers' },
  { sel: '#rightPanel', t: 'Plan a trip', b: 'Choose a base, click the map to add stops, then press <b>Find the safest route</b>. In a hurry? Try a ready-made trip.', tab: 'plan' },
  { sel: '#rightPanel', t: 'Your safety score', b: 'After planning you get a <b>safety score</b> with the reasons in plain words, plus buttons to play the walk or see it in <b>3D</b>.', tab: 'plan' },
  { sel: '#toolsBar', t: 'Handy tools', b: '<b>Measure</b> distances, open the <b>3D view</b>, check the <b>Weather</b>, or zoom.' },
  { sel: '#btnTour', t: 'That\'s it!', b: 'Press <b>?</b> any time to see this tour again. Good luck, explorer.' },
];
