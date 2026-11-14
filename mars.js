// =====================================================================
//  Mars time & solar geometry — NASA GISS Mars24 algorithm
//  (Allison & McEwen 2000, Planet. Space Sci. 48, 215; Allison 1997)
// =====================================================================
const MarsTime = (() => {
  const D = Math.PI / 180;
  const mod = (a, n) => ((a % n) + n) % n;
  const PBS = [[0.0071,2.2353,49.409],[0.0057,2.7543,168.173],[0.0039,1.1177,191.837],[0.0037,15.7866,21.736],[0.0021,2.1354,15.704],[0.0020,2.4694,95.528],[0.0018,32.8493,49.095]];

  function at(date) {
    const jdUT = 2440587.5 + date.getTime() / 86400000;
    const jdTT = jdUT + 69.184 / 86400;                // TAI-UTC = 37 s, TT-TAI = 32.184 s
    const dt = jdTT - 2451545.0;
    const M = 19.3871 + 0.52402073 * dt;                 // mean anomaly
    const aFMS = 270.3871 + 0.524038496 * dt;            // fictitious mean sun
    let pbs = 0; for (const [A, tau, phi] of PBS) pbs += A * Math.cos(D * (0.985626 * dt / tau + phi));
    const vM = (10.691 + 3.0e-7 * dt) * Math.sin(D*M) + 0.623 * Math.sin(2*D*M) + 0.050 * Math.sin(3*D*M)
             + 0.005 * Math.sin(4*D*M) + 0.0005 * Math.sin(5*D*M) + pbs;
    const Ls = mod(aFMS + vM, 360);
    const EOT = 2.861 * Math.sin(2*D*Ls) - 0.071 * Math.sin(4*D*Ls) + 0.002 * Math.sin(6*D*Ls) - vM; // degrees
    const MSD = (jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
    const MTC = mod(24 * MSD, 24);
    const dec = Math.asin(0.42565 * Math.sin(D*Ls)) / D + 0.25 * Math.sin(D*Ls);
    const r = 1.5236 * (1.00436 - 0.09309*Math.cos(D*M) - 0.004336*Math.cos(2*D*M) - 0.00031*Math.cos(3*D*M) - 0.00003*Math.cos(4*D*M));
    const MY = 1 + Math.floor((jdUT - 2435208.5) / 686.9726);   // Clancy/Piqueux Mars Year (MY1 = 1955-04-11)
    return { Ls, EOT, MSD, MTC, dec, r, MY, flux: 1361 / (r * r) };
  }
  const lmst = (t, lonE) => mod(t.MTC + lonE / 15, 24);
  const ltst = (t, lonE) => mod(lmst(t, lonE) + t.EOT / 15, 24);

  function sun(date, lat, lonE) {
    const t = at(date); const L = ltst(t, lonE);
    const H = (L - 12) * 15 * D, phi = lat * D, d = t.dec * D;
    const sinEl = Math.sin(phi)*Math.sin(d) + Math.cos(phi)*Math.cos(d)*Math.cos(H);
    const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) / D;
    const az = mod(Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(phi) - Math.tan(d)*Math.cos(phi)) / D + 180, 360);
    const cosH0 = (-Math.sin(phi)*Math.sin(d)) / (Math.cos(phi)*Math.cos(d));
    let rise = null, set = null, polar = null;
    if (cosH0 <= -1) polar = 'day'; else if (cosH0 >= 1) polar = 'night';
    else { const H0 = Math.acos(cosH0) / D / 15; rise = 12 - H0; set = 12 + H0; }
    const surfFlux = Math.max(0, sinEl) * t.flux;   // top-of-atmosphere, horizontal surface
    return { t, ltst: L, lmst: lmst(t, lonE), el, az, rise, set, polar, surfFlux };
  }

  // next Earth time (after `from`) when local true solar time at lonE equals `hour`
  function nextLTST(from, lonE, hour) {
    let d = new Date(from.getTime());
    for (let i = 0; i < 4; i++) {
      const L = ltst(at(d), lonE);
      let dh = mod(hour - L, 24); if (i > 0 && dh > 12) dh -= 24;
      d = new Date(d.getTime() + dh * 3600000 * 1.0274912517);
    }
    return d;
  }
  function season(Ls, lat) {
    const n = ['spring','summer','autumn','winter'][Math.floor(Ls / 90)];
    const s = ['autumn','winter','spring','summer'][Math.floor(Ls / 90)];
    return lat >= 0 ? `northern ${n}` : `southern ${s}`;
  }
  const dustSeason = Ls => Ls >= 180 && Ls <= 330;
  const fmtH = h => { if (h == null) return '—'; h = mod(h, 24); const H = Math.floor(h), m = Math.floor((h - H) * 60); return String(H).padStart(2,'0') + ':' + String(m).padStart(2,'0'); };
  return { at, sun, ltst, lmst, nextLTST, season, dustSeason, fmtH };
})();
