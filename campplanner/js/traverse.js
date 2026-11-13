/* Camp Planner — traverse: terrain profile and route card (legs between stops) for a trail */

const Traverse = (() => {
  const GRADES = [
    [5, 'Flat / easy (<5%)', '#b2f2bb'],
    [10, 'Gentle (5–10%)', '#d8f5a2'],
    [20, 'Moderate (10–20%)', '#ffe066'],
    [30, 'Steep (20–30%)', '#ffa94d'],
    [Infinity, 'Very steep (>30%)', '#ff6b6b']
  ];
  const STOP_RADIUS = 150; // landmarks within this distance of the trail become route-card stops
  let selId = null, bound = false;
  const parksCache = new Map();
  const root = () => $('#tab-traverse');
  const trails = () => Store.state.map.features.filter(f => f.type === 'trail');
  const gradeIdx = g => GRADES.findIndex(x => Math.abs(g) < x[0]);
  const km = m => (m / 1000).toFixed(m >= 10000 ? 1 : 2);
  const hasProfile = f => f.elev && f.elev.v === 2 && f.elev.profile.length > 1;

  function select(id) { selId = id; render(); }

  function render() {
    if (!bound) bind();
    const ts = trails();
    if (!ts.length) {
      root().innerHTML = `<div class="card empty"><h2>Traverse</h2>
        <p>No trails yet. On the Map tab, use <b>Route between places</b> to map a trail along the tracks between your campsites, or draw one with the Trail tool.</p>
        <button class="btn primary" data-goto="map">Open the map</button></div>`;
      return;
    }
    if (!ts.some(t => t.id === selId)) selId = ts[0].id;
    const f = ts.find(t => t.id === selId);
    const head = `<div class="page-head"><h2>Traverse — ${esc(f.name)}</h2>
      <div class="btn-row no-print"><select id="trSelect">${ts.map(t => `<option value="${t.id}" ${t.id === f.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <button class="btn" data-goto="map">🗺️ Edit on map</button>
      <button class="btn" id="trPlanDays" title="Split this trail into days — find campsites and water along it">🗓 Plan days</button></div></div>`;
    if (!hasProfile(f)) {
      root().innerHTML = head + '<div class="card"><p>⛰ Calculating the terrain profile…</p></div>';
      MapView.fetchElevation(f, true).then(() => {
        if (App.current !== 'traverse' || selId !== f.id) return;
        if (hasProfile(f)) render();
        else root().querySelector('.card').innerHTML = '<p>Could not get elevation data — are you online? <button class="btn small" id="trRetry">Retry</button></p>';
      });
      return;
    }
    const T = analyse(f);
    root().innerHTML = head + summaryCard(T) + profileCard(T) + breakdownCards(T) + egressCard(T) + Drops.card(T) + routeCard(T) +
      `<p class="muted small">Elevations from a 90 m terrain model, smoothed — small climbs and cliffs won't show. Times: ${Object.values(Routing.CATS).map(c => `${c.label.toLowerCase()} ${c.kmh} km/h`).join(', ')}, plus 1 hour per 600 m of climb; add time for rests, heavy packs and scrambling.
      Bearings are straight-line from stop to stop: use them to check direction of travel, not to follow the track. Magnetic values are estimates — check the GMA on your topographic map.</p>`;
    loadParks(f);
    if (!Egress.fresh(f) && !egressErr.has(f.id)) {
      Egress.run(f).then(() => { if (App.current === 'traverse' && selId === f.id) render(); })
        .catch(e => { egressErr.set(f.id, e.message); if (App.current === 'traverse' && selId === f.id) render(); });
    }
  }

  /* ---------- egress points ---------- */
  const egressErr = new Map();

  function egressCard(T) {
    const f = T.f, E = Egress.fresh(f) ? f.egress : null, L = Egress.LEVELS;
    const head = `<div class="cat-head"><h3>🚙 Egress points &amp; vehicle access</h3>
      <div class="btn-row no-print">${E ? '<button class="btn small" id="egMap">📍 Add to map</button><button class="btn small" id="egCopy">📋 Copy to emergency plan</button>' : ''}
      <button class="btn small" id="egRecheck">↻ Recheck</button></div></div>`;
    if (!E) {
      const err = egressErr.get(f.id);
      return `<div class="card">${head}<p class="${err ? 'warn-text' : 'muted'}">${err ? `Could not check vehicle access: ${esc(err)}` : '🔎 Finding roads and vehicle tracks along the route…'}</p></div>`;
    }
    const legend = Object.entries(L).filter(([k]) => E.entries.some(e => e.level === k))
      .map(([, v]) => `<span><i style="background:${v.color}"></i>${v.icon} ${v.label}</span>`).join('');
    const worstKm = E.worst ? E.worst[1] - E.worst[0] : 0;
    return `<div class="card">${head}
      <div class="big-stats">
        <div><b>${E.entries.length}</b><span>vehicle access points</span></div>
        <div class="${worstKm > 5000 ? 'warn' : ''}"><b>${km(worstKm)} km</b><span>longest stretch with no vehicle access${E.worst ? ` (km ${km(E.worst[0])}–${km(E.worst[1])})` : ''}</span></div>
        <div><b>${km(E.furthest)} km</b><span>furthest walk to a vehicle track</span></div>
      </div>
      ${E.entries.length ? `<div class="table-scroll"><table class="tbl egress">
        <thead><tr><th class="num">km</th><th>Where</th><th>Grid ref</th><th>Vehicle</th><th>Road / track</th></tr></thead>
        <tbody>${E.entries.map(e => `<tr>
          <td class="num">${km(e.d0)}${e.kind === 'follow' ? `–${km(e.d1)}` : ''}</td>
          <td>${esc(e.where)}</td>
          <td><b>${Geo.grText(e.lat, e.lng)}</b><br><small class="muted">${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}</small></td>
          <td><span class="veh" style="background:${L[e.level].color}">${L[e.level].icon} ${L[e.level].label}</span></td>
          <td><b>${esc(e.name)}</b><br><small>${esc(e.desc)}</small></td></tr>`).join('')}</tbody>
      </table></div>` : '<p>No roads or vehicle tracks touch this route — plan for self-rescue and carry a PLB.</p>'}
      <div class="legend">${legend}</div>
      <p class="small muted">Source: ${esc(E.src)}. Vehicle suitability comes from the mapped road class and surface — conditions change after rain and fire, and fire trails are often locked.
        Confirm access with the park office before relying on an egress point; in an emergency call 000 and give the grid reference.</p>
    </div>`;
  }

  function egressInLeg(f, a, b) {
    if (!Egress.fresh(f)) return '';
    const L = Egress.LEVELS;
    return f.egress.entries.filter(e => e.d1 >= a.d && e.d0 < b.d)
      .map(e => `<div class="eg-mini"><span style="color:${L[e.level].color}">${L[e.level].icon}</span> km ${km(Math.max(e.d0, a.d))} ${esc(e.name)} <small class="muted">${L[e.level].label}</small></div>`).join('')
      || '<small class="muted">none</small>';
  }

  /* ---------- analysis ---------- */
  function analyse(f) {
    const P = f.elev.profile;
    const d = P.map(p => p[0]), raw = P.map(p => p[1]);
    const step = d[d.length - 1] / (d.length - 1) || 25;
    const w = Math.max(1, Math.round(50 / step)); // ~100 m smoothing window
    const el = raw.map((_, i) => {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(raw.length - 1, i + w); j++) { s += raw[j]; n++; }
      return s / n;
    });
    const grades = d.slice(1).map((x, i) => (el[i + 1] - el[i]) / Math.max(1, x - d[i]) * 100);
    const runs = Routing.runsByDistance(f);
    const total = Geo.lineLength(f.coords);
    const stops = buildStops(f, total);
    const legs = stops.slice(1).map((b, i) => leg(f, stops[i], b, { d, el, grades, runs }));
    let day = 1;
    legs.forEach((l, i) => {
      l.day = day;
      if ((l.to.kind === 'campsite' || l.to.night) && i < legs.length - 1) day++;
    });
    const hi = raw.indexOf(Math.max(...raw)), lo = raw.indexOf(Math.min(...raw));
    const gradeDist = GRADES.map(() => 0);
    grades.forEach((g, i) => { gradeDist[gradeIdx(g)] += d[i + 1] - d[i]; });
    const byCat = Routing.catDistances(runs);
    const ascent = legs.reduce((s, l) => s + l.ascent, 0), descent = legs.reduce((s, l) => s + l.descent, 0);
    return {
      f, P, d, el, grades, runs, stops, legs, days: day, total, ascent, descent, byCat, gradeDist,
      hours: legs.reduce((s, l) => s + l.hours, 0),
      high: { e: raw[hi], lat: P[hi][2], lng: P[hi][3], d: d[hi] }, low: { e: raw[lo], lat: P[lo][2], lng: P[lo][3], d: d[lo] }
    };
  }

  /* Position of a point along the trail: projected onto the nearest segment. */
  function along(f, cum, lat, lng) {
    const kx = Math.cos(lat * Math.PI / 180) * 111320, ky = 110540;
    let best = { off: Infinity, d: 0 };
    for (let i = 1; i < f.coords.length; i++) {
      const a = f.coords[i - 1], b = f.coords[i];
      const ax = (a[1] - lng) * kx, ay = (a[0] - lat) * ky, dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const off = Math.hypot(ax + t * dx, ay + t * dy);
      if (off < best.off) best = { off, d: cum[i - 1] + t * (cum[i] - cum[i - 1]) };
    }
    return best;
  }

  function buildStops(f, total) {
    const cum = Geo.cumDist(f.coords);
    const t = Store.state.trip;
    const out = [];
    const add = (s, explicit) => {
      const a = along(f, cum, s.lat, s.lng);
      if (!explicit && a.off > STOP_RADIUS) return;
      out.push({ ...s, d: a.d, off: a.off, explicit });
    };
    (f.stops || []).forEach(s => add(s, true));
    const refs = new Set((f.stops || []).map(s => s.ref));
    Store.state.map.features.filter(x => x.type === 'landmark' && !refs.has(x.id))
      .forEach(x => add({ ref: x.id, name: x.name, kind: x.kind, lat: x.lat, lng: x.lng }, false));
    /* the trip's camp pin only becomes a stop if no planned campsite is already there */
    const nearPlanned = (lat, lng) => (f.stops || []).some(st => st.kind === 'campsite' && Geo.hav([st.lat, st.lng], [lat, lng]) < 1000);
    if (t.lat != null && !refs.has('camp') && !nearPlanned(t.lat, t.lon)) add({ ref: 'camp', name: 'Camp' + (t.location ? ` (${t.location})` : ''), kind: 'campsite', lat: t.lat, lng: t.lon }, false);
    out.sort((a, b) => a.d - b.d || b.explicit - a.explicit);
    const stops = [];
    for (const s of out) {
      const prev = stops[stops.length - 1];
      if (prev && s.d - prev.d < 30) { if (s.explicit && !prev.explicit) stops[stops.length - 1] = s; continue; }
      stops.push(s);
    }
    const [a, b] = [f.coords[0], f.coords[f.coords.length - 1]];
    if (!stops.length || stops[0].d > 50) stops.unshift({ name: 'Start', kind: 'waypoint', lat: a[0], lng: a[1], d: 0 });
    if (stops[stops.length - 1].d < total - 50) stops.push({ name: 'Finish', kind: 'waypoint', lat: b[0], lng: b[1], d: total });
    return stops;
  }

  /* A trail split into walking days, the same way as the route card: a new day starts after each
     campsite stop. Works without an elevation profile. -> [{ day, from, to, d0, d1, km, coords }] */
  function daySegments(f) {
    if (!f || f.type !== 'trail' || !f.coords || f.coords.length < 2) return [];
    const total = Geo.lineLength(f.coords);
    const stops = buildStops(f, total);
    const days = [];
    let cur = null;
    for (let i = 1; i < stops.length; i++) {
      if (!cur) { cur = { day: days.length + 1, from: stops[i - 1] }; days.push(cur); }
      cur.to = stops[i];
      if ((stops[i].kind === 'campsite' || stops[i].night) && i < stops.length - 1) cur = null;
    }
    const cum = Geo.cumDist(f.coords);
    days.forEach(D => {
      D.d0 = D.from.d; D.d1 = D.to.d; D.km = (D.d1 - D.d0) / 1000;
      const inside = f.coords.filter((c, i) => cum[i] >= D.d0 - 1 && cum[i] <= D.d1 + 1);
      D.coords = [[D.from.lat, D.from.lng], ...inside, [D.to.lat, D.to.lng]];
    });
    return days;
  }

  function leg(f, a, b, A) {
    const { d, el, grades, runs } = A;
    let ascent = 0, descent = 0, maxUp = 0, maxDown = 0;
    const gradeDist = GRADES.map(() => 0);
    for (let i = 0; i < grades.length; i++) {
      const s0 = Math.max(d[i], a.d), s1 = Math.min(d[i + 1], b.d);
      if (s1 <= s0) continue;
      const g = grades[i], dz = g / 100 * (s1 - s0);
      if (dz > 0) ascent += dz; else descent -= dz;
      maxUp = Math.max(maxUp, g); maxDown = Math.min(maxDown, g);
      gradeDist[gradeIdx(g)] += s1 - s0;
    }
    const idx = d.map((_, i) => i).filter(i => d[i] >= a.d - 1 && d[i] <= b.d + 1);
    const big = swings(idx, el, d).filter(c => Math.abs(c.dz) >= 25 && c.d1 - c.d0 >= 150)
      .map(c => ({ ...c, max: Math.max(...grades.slice(c.i0, c.i1).map(g => g * c.dir)) }))
      .sort((p, q) => Math.abs(q.dz) - Math.abs(p.dz)).slice(0, 4).sort((p, q) => p.d0 - q.d0);
    const byCat = Routing.catDistances(runs, a.d, b.d);
    const names = [...new Set(runs.filter(r => r[1] > a.d && r[0] < b.d).map(r => r[2].split('|')[1]).filter(Boolean))];
    const tb = Geo.bearing([a.lat, a.lng], [b.lat, b.lng]);
    const conv = Geo.convergence(a.lat, a.lng), decl = Geo.declination(a.lat, a.lng);
    const hazards = Store.state.map.features.filter(x => x.type === 'landmark' && ['danger', 'crossing'].includes(x.kind))
      .map(x => ({ x, p: along(f, Geo.cumDist(f.coords), x.lat, x.lng) }))
      .filter(h => h.p.off < STOP_RADIUS && h.p.d > a.d && h.p.d < b.d);
    return {
      from: a, to: b, dist: b.d - a.d, ascent, descent, maxUp, maxDown, gradeDist, byCat, names, big, hazards,
      hours: Routing.hours(byCat, ascent),
      trueB: tb, gridB: tb - conv, magB: tb - decl
    };
  }

  /* Climbs and descents between turning points, ignoring wiggles under 10 m (zigzag). */
  function swings(idx, el, d, th = 10) {
    if (idx.length < 2) return [];
    const out = [];
    let piv = idx[0], ext = idx[0], dir = 0;
    for (const i of idx) {
      if (dir === 0) {
        if (el[i] - el[piv] >= th) dir = 1;
        else if (el[piv] - el[i] >= th) dir = -1;
        else continue;
        ext = i;
      }
      if (dir === 1 ? el[i] >= el[ext] : el[i] <= el[ext]) ext = i;
      else if (Math.abs(el[ext] - el[i]) >= th) { out.push([piv, ext]); piv = ext; ext = i; dir = -dir; }
    }
    if (dir) out.push([piv, ext]);
    return out.map(([p, q]) => ({ i0: p, i1: q, d0: d[p], d1: d[q], dz: el[q] - el[p], dir: el[q] > el[p] ? 1 : -1 }));
  }

  function terrainText(l) {
    const parts = [];
    const cats = Object.entries(l.byCat).sort((x, y) => y[1] - x[1]).filter(([, m]) => m > 20)
      .map(([c, m]) => `${km(m)} km ${(Routing.CATS[c] || Routing.CATS.unknown).label.toLowerCase()}`);
    if (cats.length) parts.push(cats.join(', '));
    if (l.names.length) parts.push('via ' + l.names.slice(0, 3).join(', '));
    l.big.forEach(c => parts.push(`${Math.abs(c.dz / (c.d1 - c.d0)) < 0.03 ? (c.dir > 0 ? '↗ gradual rise' : '↘ gradual fall') : c.dir > 0 ? '▲ climb' : '▼ descend'} ${Math.abs(Math.round(c.dz))} m over ${km(c.d1 - c.d0)} km from km ${km(c.d0)} (avg ${Math.abs(Math.round(c.dz / (c.d1 - c.d0) * 100))}%, max ${Math.round(c.max)}%)`));
    if (!l.big.length) parts.push(l.ascent < 40 && l.descent < 40 ? 'mostly flat' : 'gently undulating, no major climbs');
    l.hazards.forEach(h => parts.push(`⚠ ${h.x.name} at km ${km(h.p.d)}`));
    return parts.join('; ');
  }

  /* ---------- output ---------- */
  function summaryCard(T) {
    const f = T.f;
    return `<div class="card">
      <div class="big-stats">
        <div class="hero"><b>${km(T.total)} km</b><span>distance</span></div>
        <div><b>↑ ${Math.round(T.ascent)} m</b><span>total climb</span></div>
        <div><b>↓ ${Math.round(T.descent)} m</b><span>total descent</span></div>
        <div><b>${MapView.fmtHours(T.hours)}</b><span>est. walking time</span></div>
        <div><b>${Math.round(T.high.e)} m</b><span>high point · ${Geo.grText(T.high.lat, T.high.lng)}</span></div>
        <div><b>${Math.round(T.low.e)} m</b><span>low point · ${Geo.grText(T.low.lat, T.low.lng)}</span></div>
        ${T.days > 1 ? `<div><b>${T.days}</b><span>days (campsite to campsite)</span></div>` : ''}
      </div>
      <p class="small"><b>Start</b> ${esc(T.stops[0].name)} ${Geo.grText(T.stops[0].lat, T.stops[0].lng)} · <b>Finish</b> ${esc(T.stops[T.stops.length - 1].name)} ${Geo.grText(T.stops[T.stops.length - 1].lat, T.stops[T.stops.length - 1].lng)}
        ${f.source ? ` · routed on ${esc(Routing.SOURCES[f.source] || f.source)}` : ''}</p>
      <p class="small" id="trParks">${parksCache.has(f.id) ? parksText(parksCache.get(f.id)) : '<span class="muted">Checking national parks along the route…</span>'}</p>
    </div>`;
  }

  function parksText(list) {
    if (!list) return '<span class="muted">Park lookup unavailable.</span>';
    return list.length ? `🌿 <b>Passes through:</b> ${list.map(p => `${esc(p.NAME)} ${esc(p.TYPE)} (${esc(p.STATE)})`).join(', ')}`
      : '🌿 Not within any gazetted protected area.';
  }

  async function loadParks(f) {
    if (parksCache.has(f.id)) return;
    let list = null;
    try { list = await Parks.parksAlong(f.coords); } catch (e) { /* offline */ }
    parksCache.set(f.id, list);
    const el = $('#tab-traverse #trParks');
    if (el && selId === f.id) el.innerHTML = parksText(list);
  }

  function niceStep(range, target) {
    const raw = range / target, p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map(m => m * p).find(s => s >= raw) || p * 10;
  }

  function profileCard(T) {
    const W = 1000, H = 310, L = 50, R = 16, Tp = 44, B = 56;
    const maxD = T.d[T.d.length - 1] || 1;
    const lo0 = Math.min(...T.el), hi0 = Math.max(...T.el);
    const yStep = niceStep(Math.max(20, hi0 - lo0), 5);
    const lo = Math.floor(lo0 / yStep) * yStep, hi = Math.ceil(hi0 / yStep) * yStep + (hi0 % yStep === 0 ? yStep : 0);
    const x = v => L + v / maxD * (W - L - R), y = v => Tp + (1 - (v - lo) / (hi - lo)) * (H - Tp - B);
    const base = H - B;
    let svg = '';
    for (let v = lo; v <= hi; v += yStep) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="c-grid light"/><text x="${L - 6}" y="${y(v) + 4}" class="c-lbl" text-anchor="end">${v}</text>`;
    const xStep = niceStep(maxD, 10);
    for (let v = 0; v <= maxD + 1; v += xStep) svg += `<line x1="${x(v)}" x2="${x(v)}" y1="${Tp}" y2="${base}" class="c-grid light"/><text x="${x(v)}" y="${base + 42}" class="c-lbl" text-anchor="middle">${+(v / 1000).toFixed(2)} km</text>`;
    /* gradient-coloured terrain */
    for (let i = 0; i < T.grades.length; i++) {
      svg += `<path d="M${x(T.d[i]).toFixed(1)},${base}L${x(T.d[i]).toFixed(1)},${y(T.el[i]).toFixed(1)}L${x(T.d[i + 1]).toFixed(1)},${y(T.el[i + 1]).toFixed(1)}L${x(T.d[i + 1]).toFixed(1)},${base}Z" fill="${GRADES[gradeIdx(T.grades[i])][2]}"/>`;
    }
    svg += `<path d="${T.el.map((v, i) => `${i ? 'L' : 'M'}${x(T.d[i]).toFixed(1)},${y(v).toFixed(1)}`).join('')}" fill="none" stroke="#262661" stroke-width="2"/>`;
    /* vehicle access strip */
    const eg = Egress.fresh(T.f) ? T.f.egress.entries : [];
    eg.forEach(e => {
      const x0 = x(e.d0), follow = e.kind === 'follow';
      svg += `<rect x="${follow ? x0 : x0 - 2}" y="${base + 16}" width="${follow ? Math.max(3, x(e.d1) - x0) : 4}" height="9" fill="${Egress.LEVELS[e.level].color}"><title>${esc(e.where)} — ${Egress.LEVELS[e.level].label}</title></rect>`;
    });
    /* track type strip */
    T.runs.forEach(([a, b, l]) => { svg += `<rect x="${x(a)}" y="${base + 4}" width="${Math.max(0.5, x(b) - x(a))}" height="9" fill="${(Routing.CATS[Routing.catOf(l)] || Routing.CATS.unknown).color}"/>`; });
    /* stops */
    T.stops.forEach((s, i) => {
      const xx = x(s.d), icon = (MapView.KINDS[s.kind] || MapView.KINDS.waypoint).icon;
      /* long routes: numbers only, staggered over three rows, with a key under the chart */
      const many = T.stops.length > 10, ty = many ? 12 + (i % 3) * 11 : i % 2 ? 30 : 14;
      svg += `<line x1="${xx}" x2="${xx}" y1="${ty + 4}" y2="${base}" stroke="#1f2a24" stroke-dasharray="3 3" stroke-width="1"/>
        <text x="${Math.min(W - R - 2, Math.max(L, xx))}" y="${ty}" class="c-stop" text-anchor="${xx < L + 60 ? 'start' : xx > W - 80 ? 'end' : 'middle'}">${many ? i + 1 : `${i + 1} ${icon} ${esc(s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name)}`}</text>`;
    });
    svg += `<text x="12" y="${(Tp + base) / 2}" class="c-lbl" transform="rotate(-90 12 ${(Tp + base) / 2})" text-anchor="middle">elevation (m)</text>`;
    const cats = Object.keys(T.byCat);
    return `<div class="card"><h3>Terrain profile</h3>
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Terrain profile">${svg}</svg>
      ${T.stops.length > 10 ? `<div class="stop-key">${T.stops.map((s, i) => `<span><b>${i + 1}</b> ${(MapView.KINDS[s.kind] || MapView.KINDS.waypoint).icon} ${esc(s.name)} <small class="muted">km ${km(s.d)}</small></span>`).join('')}</div>` : ''}
      <div class="legend">${GRADES.map(g => `<span><i style="background:${g[2]}"></i>${g[1]}</span>`).join('')}</div>
      ${eg.length ? `<div class="legend">Vehicle access (lower strip): ${Object.entries(Egress.LEVELS).filter(([k]) => eg.some(e => e.level === k)).map(([, v]) => `<span><i style="background:${v.color}"></i>${v.label}</span>`).join('')}</div>` : ''}
      <div class="legend">Track (strip under profile): ${cats.map(c => `<span><i style="background:${(Routing.CATS[c] || Routing.CATS.unknown).color}"></i>${(Routing.CATS[c] || Routing.CATS.unknown).label}</span>`).join('')}</div>
    </div>`;
  }

  function breakdownCards(T) {
    const bars = (rows, total) => `<table class="tbl bars">${rows.filter(r => r[1] > 0).map(([label, m, color]) => `<tr><td>${label}</td>
      <td class="bar-cell"><div class="bar" style="width:${m / total * 100}%;background:${color}"></div></td><td class="num">${km(m)} km · ${Math.round(m / total * 100)}%</td></tr>`).join('')}</table>`;
    const tot = T.total || 1;
    return `<div class="grid2">
      <div class="card"><h3>Gradient</h3>${bars(GRADES.map((g, i) => [g[1], T.gradeDist[i], g[2]]), T.d[T.d.length - 1] || 1)}</div>
      <div class="card"><h3>Track type</h3>${bars(Object.entries(T.byCat).sort((a, b) => b[1] - a[1]).map(([c, m]) => [(Routing.CATS[c] || Routing.CATS.unknown).label, m, (Routing.CATS[c] || Routing.CATS.unknown).color]), tot)}
        ${T.byCat.unknown ? '<p class="muted small">“Unclassified” = hand-drawn sections. Draw with “Snap to tracks” on, or map the trail with Route between places, to classify the track.</p>' : ''}</div>
    </div>`;
  }

  /* opt: { from, to } = the legs to show (running totals still count from the start), cont = a continuation page */
  function routeCard(T, opt = {}) {
    const i0 = opt.from || 0, i1 = opt.to == null ? T.legs.length : opt.to;
    let cumD = 0, cumH = 0, lastDay = 0;
    const rows = T.legs.map((l, i) => {
      cumD += l.dist; cumH += l.hours;
      if (i < i0 || i >= i1) { lastDay = l.day; return ''; }
      const dayRow = T.days > 1 && (l.day !== lastDay || i === i0)
        ? `<tr class="day-row"><td colspan="11">Day ${l.day}${l.day === lastDay ? ' (continued)' : ''}</td></tr>` : '';
      lastDay = l.day;
      const gr = s => `${esc(s.name)}<br><small><b>${Geo.grText(s.lat, s.lng)}</b></small>`;
      return `${dayRow}<tr data-day="${l.day}">
        <td class="num">${i + 1}→${i + 2}</td>
        <td>${gr(l.from)}</td><td>${gr(l.to)}</td>
        <td class="num">${km(l.dist)} km<br><small class="muted">Σ ${km(cumD)}</small></td>
        <td class="num">↑${Math.round(l.ascent)}<br>↓${Math.round(l.descent)}</td>
        <td class="num">${Math.round(l.maxUp)}% / ${Math.round(Math.abs(l.maxDown))}%</td>
        <td class="num">${Geo.fmtBearing(l.gridB)}<br><small class="muted">mag ${Geo.fmtBearing(l.magB)}</small></td>
        <td class="num">${MapView.fmtHours(l.hours)}<br><small class="muted">Σ ${MapView.fmtHours(cumH)}</small></td>
        <td class="terrain">${terrainText(l)}</td>
        <td class="eg-cell">${egressInLeg(T.f, l.from, l.to)}</td>
        <td class="gradebar">${l.gradeDist.map((m, k) => m > 0 ? `<i style="width:${m / l.dist * 100}%;background:${GRADES[k][2]}" title="${GRADES[k][1]}: ${km(m)} km"></i>` : '').join('')}</td>
      </tr>`;
    }).join('');
    const a = T.stops[0];
    return `<div class="card"><h3>Route card${opt.cont ? ' (continued)' : ''}${i0 || i1 < T.legs.length ? ` <small class="muted">legs ${i0 + 1}–${i1} of ${T.legs.length}</small>` : ''}</h3>
      ${opt.cont ? '' : `<p class="small muted">Magnetic declination ≈ ${Geo.fmtDecl(Geo.declination(a.lat, a.lng))} · grid magnetic angle ≈ ${Geo.fmtDecl(Geo.declination(a.lat, a.lng) - Geo.convergence(a.lat, a.lng))} · MGA2020 zone ${Geo.zoneOf(a.lng)}</p>`}
      <div class="table-scroll"><table class="tbl route-card">
        <thead><tr><th>Leg</th><th>From</th><th>To</th><th class="num">Distance</th><th class="num">Climb (m)</th><th class="num">Steepest up/down</th><th class="num">Grid bearing</th><th class="num">Time</th><th>Terrain to be covered</th><th>Vehicle egress</th><th>Gradient</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>`;
  }

  function bind() {
    bound = true;
    /* food & water drop edits: re-run the analysis so pack weights update */
    const drops = e => {
      const f = trails().find(t => t.id === selId);
      if (f && hasProfile(f) && Drops.onEvent(e, analyse(f))) { render(); return true; }
      return false;
    };
    root().addEventListener('change', e => {
      if (e.target.id === 'trSelect') select(e.target.value);
      else drops(e);
    });
    root().addEventListener('click', e => {
      if (e.target.closest('.drops-card button') && drops(e)) return;
      const id = e.target.closest('button')?.id;
      const f = trails().find(t => t.id === selId);
      if (id === 'trRetry') render();
      else if (id === 'trPlanDays' && f) DayPlan.open(f.id);
      else if (id === 'egRecheck' && f) { egressErr.delete(f.id); delete f.egress; render(); }
      else if (id === 'egMap' && f) addEgressToMap(f);
      else if (id === 'egCopy' && f) copyEgress(f);
    });
  }

  /* Save egress points as emergency / evacuation landmarks so they print on the map with grid references. */
  function addEgressToMap(f) {
    const L = Egress.LEVELS, fs = Store.state.map.features;
    let n = 0;
    f.egress.entries.filter(e => e.kind !== 'landmark').forEach(e => {
      if (fs.some(x => x.type === 'landmark' && Geo.hav([x.lat, x.lng], [e.lat, e.lng]) < 50)) return;
      fs.push({ id: uid(), type: 'landmark', kind: 'evac', name: `Egress: ${e.name}`, lat: e.lat, lng: e.lng,
        notes: `${L[e.level].label} — ${e.desc}. ${e.where} (km ${km(e.d0)} of ${f.name}).` });
      n++;
    });
    Store.save();
    toast(n ? `Added ${n} egress point(s) to the map as emergency / evacuation landmarks` : 'Egress points are already on the map');
  }

  function copyEgress(f) {
    const L = Egress.LEVELS, E = f.egress;
    const list = E.entries.map(e => `km ${km(e.d0)} ${e.name} (${Geo.grText(e.lat, e.lng)}) — ${L[e.level].label}`).join('; ');
    Store.state.emergency.evac = `${f.name}: ${list || 'no vehicle access on route'}. Longest stretch without vehicle access ${km(E.worst ? E.worst[1] - E.worst[0] : 0)} km.`;
    Store.save();
    toast('Copied to Risks → Emergency information → Evacuation route');
  }

  /* For the trip report: the analysis and the read-only output cards. */
  const parksFor = f => parksCache.get(f.id);
  return { render, select, analyse, daySegments, hasProfile, terrainText, loadParks, parksFor, parksText, GRADES, parts: { summaryCard, profileCard, breakdownCards, egressCard, routeCard } };
})();
