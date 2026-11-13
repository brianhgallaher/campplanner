/* Camp Planner — Australian geodesy: MGA2020 grid references, distances, bearings, magnetic declination.
   MGA2020 is UTM on the GRS80 ellipsoid; WGS84 GPS coordinates differ from GDA2020 by < 2 m, well inside map-reading accuracy. */

const Geo = (() => {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
  const e2 = f * (2 - f), e4 = e2 * e2, e6 = e4 * e2, ep2 = e2 / (1 - e2);
  const D = Math.PI / 180;

  const zoneOf = lon => Math.floor((lon + 180) / 6) + 1;
  const cm = zone => (zone - 1) * 6 - 180 + 3;

  /* Lat/lon → MGA easting/northing (Snyder's transverse Mercator series, sub-metre accuracy). */
  function toMGA(lat, lon, zone = zoneOf(lon)) {
    const phi = lat * D, lam = (lon - cm(zone)) * D;
    const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
    const N = a / Math.sqrt(1 - e2 * sin * sin), T = tan * tan, C = ep2 * cos * cos, A = cos * lam;
    const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
    const E = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
    const Nn = k0 * (M + N * tan * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    return { zone, E, N: Nn + (lat < 0 ? 10000000 : 0) };
  }

  /* MGA easting/northing → [lat, lon] (southern hemisphere). */
  function fromMGA(E, N, zone) {
    const M = (N - 10000000) / k0;
    const mu = M / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const sin = Math.sin(p1), cos = Math.cos(p1), tan = Math.tan(p1);
    const C1 = ep2 * cos * cos, T1 = tan * tan, N1 = a / Math.sqrt(1 - e2 * sin * sin);
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * sin * sin, 1.5), Dd = (E - 500000) / (N1 * k0);
    const lat = p1 - (N1 * tan / R1) * (Dd * Dd / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Dd ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Dd ** 6 / 720);
    const lon = (Dd - (1 + 2 * T1 + C1) * Dd ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Dd ** 5 / 120) / cos;
    return [lat / D, cm(zone) + lon / D];
  }

  const pad3 = n => String(n).padStart(3, '0');
  /* Six-figure grid reference as read off an Australian topo map: 100 m precision. */
  function gr6(lat, lon) {
    const m = toMGA(lat, lon);
    return pad3(Math.floor(m.E / 100) % 1000) + pad3(Math.floor(m.N / 100) % 1000);
  }
  const grText = (lat, lon) => 'GR ' + gr6(lat, lon);
  function mgaText(lat, lon) {
    const m = toMGA(lat, lon);
    return `MGA${m.zone} ${Math.round(m.E)}E ${Math.round(m.N)}N`;
  }

  /* ---------- distances & bearings ---------- */
  function hav(p, q) {
    const R = 6371000, dLat = (q[0] - p[0]) * D, dLon = (q[1] - p[1]) * D;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * D) * Math.cos(q[0] * D) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function cumDist(c) { const out = [0]; for (let i = 1; i < c.length; i++) out.push(out[i - 1] + hav(c[i - 1], c[i])); return out; }
  const lineLength = c => { const d = cumDist(c); return d[d.length - 1] || 0; };

  /* Evenly spaced points along a line. */
  function densify(coords, n) {
    const cum = cumDist(coords), total = cum[cum.length - 1];
    if (!total) return [];
    const out = [];
    let j = 1;
    for (let k = 0; k < n; k++) {
      const d = total * k / (n - 1);
      while (j < coords.length - 1 && cum[j] < d) j++;
      const seg = cum[j] - cum[j - 1];
      const t = seg ? Math.min(1, Math.max(0, (d - cum[j - 1]) / seg)) : 0;
      const p = coords[j - 1], q = coords[j];
      out.push({ lat: p[0] + (q[0] - p[0]) * t, lng: p[1] + (q[1] - p[1]) * t, d });
    }
    return out;
  }

  /* Initial true bearing p → q in degrees. */
  function bearing(p, q) {
    const y = Math.sin((q[1] - p[1]) * D) * Math.cos(q[0] * D);
    const x = Math.cos(p[0] * D) * Math.sin(q[0] * D) - Math.sin(p[0] * D) * Math.cos(q[0] * D) * Math.cos((q[1] - p[1]) * D);
    return (Math.atan2(y, x) / D + 360) % 360;
  }
  /* Grid convergence: angle from true north to grid north (+ = grid north east of true north). */
  function convergence(lat, lon) {
    return Math.atan(Math.tan((lon - cm(zoneOf(lon))) * D) * Math.sin(lat * D)) / D;
  }

  /* Approximate magnetic declination (° east) for Australia, interpolated from 2025 values at reference towns.
     Good to about ±1° — confirm against the GMA printed on your topographic map. */
  const DECL = [
    [-12.46, 130.84, 3.6], [-16.92, 145.77, 7.5], [-19.26, 146.82, 8.0], [-20.73, 139.49, 6.0], [-23.70, 133.88, 5.1],
    [-27.47, 153.03, 11.3], [-29.0, 151.0, 11.3], [-31.95, 115.86, -0.9], [-28.78, 114.61, -1.0], [-17.96, 122.24, 0.8],
    [-30.75, 121.47, 1.3], [-33.86, 121.89, 1.7], [-31.68, 128.88, 4.2], [-34.93, 138.60, 8.1], [-34.72, 135.86, 6.6],
    [-33.87, 151.21, 12.8], [-32.25, 148.60, 11.6], [-35.28, 149.13, 12.4], [-37.81, 144.96, 11.7], [-36.76, 144.28, 11.2],
    [-37.83, 140.78, 9.4], [-42.88, 147.33, 15.0], [-41.44, 147.14, 14.4], [-30.30, 153.11, 12.0], [-36.08, 146.92, 12.3]
  ];
  function declination(lat, lon) {
    let ws = 0, vs = 0;
    for (const [la, lo, v] of DECL) {
      const d = hav([lat, lon], [la, lo]) + 1;
      if (d < 5000) return v;
      const w = 1 / (d * d);
      ws += w; vs += w * v;
    }
    return vs / ws;
  }

  const inAustralia = (lat, lon) => lat < -9 && lat > -44.5 && lon > 112 && lon < 154.5;
  const fmtBearing = deg => String(Math.round((deg % 360 + 360) % 360)).padStart(3, '0') + '°';
  const fmtDecl = d => `${Math.abs(d).toFixed(1)}° ${d >= 0 ? 'E' : 'W'}`;

  return { toMGA, fromMGA, zoneOf, gr6, grText, mgaText, hav, cumDist, lineLength, densify, bearing, convergence, declination, inAustralia, fmtBearing, fmtDecl };
})();
