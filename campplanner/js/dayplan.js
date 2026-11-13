/* Camp Planner — day planner: split a trail into walking days.
   Finds campsites, huts and water along the trail (OpenStreetMap + the trip's own landmarks), works out walking
   time along it (track type + climb, as on the route card), and suggests where to stop each night so the days are
   close to the target length — preferring real campsites with water. Nights can be swapped or pinned; applying
   puts the chosen camps on the map as route stops, which is what splits the route card, day zoom and report. */

const DayPlan = (() => {
  const RADII = [[300, '300 m'], [500, '500 m'], [1000, '1 km'], [2000, '2 km'], [5000, '5 km']];
  const BUSH_STEP = 500;          // m between possible bush-camp spots
  const WATER_AT_CAMP = 300;      // m: water this close to a camp counts as water at camp
  const ACCESS_KMH = 3;           // walking speed to a camp off the trail
  let P = null;                   // current plan: { f, ix, tl, cands, opts, pinned, result, layer, status, busy }

  const feats = () => Store.state.map.features;
  const fmtKm = m => (m / 1000).toFixed(m >= 10000 ? 1 : 2);
  const fmtH = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`; };
  const isNightStop = s => s && (s.kind === 'campsite' || s.night);

  /* ---------- geometry: where along the trail is a point? (grid index of trail segments) ---------- */
  function index(f) {
    const c = f.coords, cum = Geo.cumDist(c);
    const kx = Math.cos(c[0][0] * Math.PI / 180) * 111320, ky = 110540, CELL = 400;
    const grid = new Map();
    for (let i = 1; i < c.length; i++) {
      const xs = [c[i - 1][1] * kx, c[i][1] * kx], ys = [c[i - 1][0] * ky, c[i][0] * ky];
      for (let x = Math.floor(Math.min(...xs) / CELL); x <= Math.floor(Math.max(...xs) / CELL); x++)
        for (let y = Math.floor(Math.min(...ys) / CELL); y <= Math.floor(Math.max(...ys) / CELL); y++) {
          const k = x + ',' + y;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(i);
        }
    }
    function locate(lat, lng, maxOff = 6000) {
      const px = lng * kx, py = lat * ky, r = Math.ceil(maxOff / CELL), cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
      let best = { off: Infinity, d: 0 };
      const seen = new Set();
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
        for (const i of grid.get(x + ',' + y) || []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const ax = c[i - 1][1] * kx - px, ay = c[i - 1][0] * ky - py, dx = (c[i][1] - c[i - 1][1]) * kx, dy = (c[i][0] - c[i - 1][0]) * ky;
          const len2 = dx * dx + dy * dy, t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
          const off = Math.hypot(ax + t * dx, ay + t * dy);
          if (off < best.off) best = { off, d: cum[i - 1] + t * (cum[i] - cum[i - 1]) };
        }
      }
      return best;
    }
    function pointAt(d) {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const t = cum[i] > cum[i - 1] ? Math.max(0, Math.min(1, (d - cum[i - 1]) / (cum[i] - cum[i - 1]))) : 0;
      return [c[i - 1][0] + t * (c[i][0] - c[i - 1][0]), c[i - 1][1] + t * (c[i][1] - c[i - 1][1])];
    }
    return { cum, total: cum[cum.length - 1], locate, pointAt };
  }

  /* ---------- walking time along the trail: track type speed + 1 h per 600 m climb (same rule as the route card) ---------- */
  function timeline(f, total) {
    const runs = Routing.runsByDistance(f);
    const kmhAt = d => {
      let lo = 0, hi = runs.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (runs[m][1] < d) lo = m + 1; else hi = m; }
      const r = runs[lo];
      return r ? (Routing.CATS[Routing.catOf(r[2])] || Routing.CATS.unknown).kmh : Routing.CATS.unknown.kmh;
    };
    let D, E = null;
    if (Traverse.hasProfile(f)) {
      const T = Traverse.analyse(f);
      const k = total / (T.d[T.d.length - 1] || total);       // profile distances → trail distances
      D = T.d.map(x => x * k); E = T.el;
    } else {
      D = [];
      for (let d = 0; d < total; d += 100) D.push(d);
      D.push(total);
    }
    const H = [0], A = [0];
    for (let i = 0; i < D.length - 1; i++) {
      const seg = D[i + 1] - D[i], up = E ? Math.max(0, E[i + 1] - E[i]) : 0;
      H.push(H[i] + seg / 1000 / kmhAt((D[i] + D[i + 1]) / 2) + up / 600);
      A.push(A[i] + up);
    }
    const at = (arr, d) => {
      if (d <= 0) return arr[0];
      if (d >= D[D.length - 1]) return arr[arr.length - 1];
      let lo = 0, hi = D.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (D[m] <= d) lo = m; else hi = m; }
      const t = (d - D[lo]) / ((D[hi] - D[lo]) || 1);
      return arr[lo] + t * (arr[hi] - arr[lo]);
    };
    const elevAt = d => E ? at(E, d) : null;
    return {
      hasElev: !!E, hoursAt: d => at(H, d), ascentAt: d => at(A, d),
      slopeAt: d => E ? Math.abs(elevAt(Math.min(total, d + 100)) - elevAt(Math.max(0, d - 100))) / 2 : 0   // % grade over ±100 m
    };
  }

  /* ---------- candidates: campsites, huts and water near the trail ---------- */
  const WATER_TYPES = {
    tap: { label: 'Tap / water point', rel: 3 },
    tank: { label: 'Water tank — check it has water', rel: 2 },
    spring: { label: 'Spring', rel: 2 },
    river: { label: 'River', rel: 2 },
    creek: { label: 'Creek', rel: 1 },
    seasonal: { label: 'Creek — seasonal, may be dry', rel: 0 },
    landmark: { label: 'Water source (your map)', rel: 2 },
    well: { label: 'Well / bore', rel: 1 }
  };

  async function fetchOsm(f, radius) {
    const step = Math.max(1, Math.ceil(f.coords.length / 500));
    const pts = f.coords.filter((_, i) => i % step === 0 || i === f.coords.length - 1).map(c => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join(',');
    const q = `[out:json][timeout:90];(` +
      `nwr["tourism"~"^(camp_site|wilderness_hut|alpine_hut)$"](around:${radius},${pts});` +
      `nwr["amenity"~"^(shelter|drinking_water|water_point)$"](around:${radius},${pts});` +
      `nwr["man_made"~"^(water_tank|water_well|water_tap)$"](around:${radius},${pts});` +
      `node["natural"="spring"](around:${radius},${pts});` +
      `);out center tags;way["waterway"~"^(river|stream)$"](around:250,${pts});out tags geom;`;
    /* a busy server can answer "OK" with a runtime-error remark and no data: treat that as a failure and try again */
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const j = await Parks.overpass(q, 95000);
        if (j.remark && /error|timed? ?out|memory/i.test(j.remark)) throw new Error('OpenStreetMap was busy');
        return j.elements || [];
      } catch (e) { last = e; }
    }
    throw last;
  }

  function candidates(f, ix, els, radius) {
    const out = [];
    const add = c => {
      const a = ix.locate(c.lat, c.lng, radius + 200);
      if (a.off > radius + 50) return;
      out.push({ ...c, d: a.d, off: a.off });
    };
    /* the trip's own landmarks first (they win over OpenStreetMap duplicates) */
    feats().filter(x => x.type === 'landmark' && ['campsite', 'hut', 'water'].includes(x.kind)).forEach(x => add({
      key: 'lm:' + x.id, lmId: x.id, cls: x.kind === 'water' ? 'water' : 'camp', hut: x.kind === 'hut', wtype: x.kind === 'water' ? 'landmark' : null,
      name: x.name, lat: x.lat, lng: x.lng, src: 'Your map', note: x.notes || ''
    }));
    const t = Store.state.trip;
    if (t.lat != null) add({ key: 'trip-camp', cls: 'camp', pin: true, name: 'Camp' + (t.location ? ` (${t.location})` : ''), lat: t.lat, lng: t.lon, src: 'Trip camp pin', note: '' });
    const dup = (c, cls) => out.some(o => o.cls === cls && Geo.hav([o.lat, o.lng], [c.lat, c.lng]) < 120);
    for (const e of els) {
      const tg = e.tags || {};
      if (e.type === 'way' && tg.waterway) continue;
      const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
      if (lat == null) continue;
      let c = null;
      if (tg.tourism === 'camp_site') c = { cls: 'camp', name: tg.name || 'Campsite', water: tg.drinking_water === 'yes' || tg.water_point === 'yes' };
      else if (tg.tourism === 'wilderness_hut' || tg.tourism === 'alpine_hut') c = { cls: 'camp', hut: true, name: tg.name || 'Hut', water: tg.drinking_water === 'yes' };
      else if (tg.amenity === 'shelter') {
        if (/picnic|public_transport|field_shelter|sun_shelter/.test(tg.shelter_type || '')) continue;
        c = { cls: 'camp', hut: true, name: tg.name || 'Shelter', water: false };
      } else if (tg.amenity === 'drinking_water' || tg.amenity === 'water_point' || tg.man_made === 'water_tap') c = { cls: 'water', wtype: 'tap', name: tg.name || 'Drinking water' };
      else if (tg.man_made === 'water_tank') c = { cls: 'water', wtype: 'tank', name: tg.name || 'Water tank' };
      else if (tg.man_made === 'water_well') c = { cls: 'water', wtype: 'well', name: tg.name || 'Well' };
      else if (tg.natural === 'spring') c = { cls: 'water', wtype: tg.seasonal === 'yes' || tg.intermittent === 'yes' ? 'seasonal' : 'spring', name: tg.name || 'Spring' };
      if (!c) continue;
      c = { ...c, key: `osm:${e.type}/${e.id}`, lat, lng, src: 'OpenStreetMap', note: [tg.fee === 'yes' ? 'fees apply' : '', tg.reservation === 'required' ? 'booking required' : '', tg.toilets === 'yes' ? 'toilets' : ''].filter(Boolean).join(', ') };
      if (!dup(c, c.cls)) add(c);
    }
    /* creek / river crossings: where a waterway comes within 40 m of the trail */
    for (const e of els) {
      const tg = e.tags || {};
      if (e.type !== 'way' || !tg.waterway || !e.geometry) continue;
      const hits = [];
      const g = e.geometry;
      for (let i = 0; i < g.length; i++) {
        const segs = i ? Math.max(1, Math.ceil(Geo.hav([g[i - 1].lat, g[i - 1].lon], [g[i].lat, g[i].lon]) / 20)) : 1;
        for (let s = i ? 1 : 0; s <= (i ? segs : 0); s++) {
          const lat = i ? g[i - 1].lat + (g[i].lat - g[i - 1].lat) * s / segs : g[0].lat, lng = i ? g[i - 1].lon + (g[i].lon - g[i - 1].lon) * s / segs : g[0].lon;
          const a = ix.locate(lat, lng, 300);
          if (a.off < 40) hits.push({ ...a, lat, lng });
        }
      }
      hits.sort((p, q) => p.d - q.d);
      const groups = [];
      hits.forEach(h => { const last = groups[groups.length - 1]; if (last && h.d - last[last.length - 1].d < 300) last.push(h); else groups.push([h]); });
      groups.forEach((grp, k) => {
        const h = grp.reduce((p, q) => (q.off < p.off ? q : p));
        const seasonal = tg.intermittent === 'yes' || tg.seasonal === 'yes';
        const c = { cls: 'water', wtype: seasonal ? 'seasonal' : tg.waterway === 'river' ? 'river' : 'creek', crossing: true,
          key: `osm:way/${e.id}#${k}`, name: tg.name || (tg.waterway === 'river' ? 'River' : 'Creek') + ' crossing', lat: h.lat, lng: h.lng, d: h.d, off: h.off, src: 'OpenStreetMap', note: '' };
        if (!out.some(o => o.cls === 'water' && Math.abs(o.d - c.d) < 150 && o.off < 200)) out.push(c);
      });
    }
    /* water at camp: tagged, or a water source within WATER_AT_CAMP */
    const waters = out.filter(c => c.cls === 'water');
    out.filter(c => c.cls === 'camp').forEach(c => {
      const near = waters.filter(w => Geo.hav([w.lat, w.lng], [c.lat, c.lng]) <= WATER_AT_CAMP).sort((a, b) => WATER_TYPES[b.wtype].rel - WATER_TYPES[a.wtype].rel)[0];
      c.waterNear = near || null;
      c.hasWater = !!c.water || !!near;
    });
    return out.sort((a, b) => a.d - b.d);
  }

  /* ---------- choosing nights: shortest-path over possible stops ---------- */
  function existingNights() {
    /* campsites (and night stops) the route card already splits at */
    return Traverse.daySegments(P.f).slice(0, -1).map(D => D.to).filter(s => s && s.d > 50 && s.d < P.ix.total - 50);
  }

  function nodesFor() {
    const { ix, tl, opts } = P, total = ix.total;
    const fixedKeys = new Set(), extra = [];
    if (opts.keep) existingNights().forEach(s => {
      const key = s.ref === 'camp' ? 'trip-camp' : 'lm:' + s.ref;
      if (P.cands.some(c => c.key === key)) { fixedKeys.add(key); return; }
      /* a route stop without a landmark (e.g. the landmark was deleted): still a night */
      const w = P.cands.find(c => c.cls === 'water' && Geo.hav([c.lat, c.lng], [s.lat, s.lng]) <= WATER_AT_CAMP);
      extra.push({ key: 'stop:' + s.ref, stopRef: s.ref, cls: 'camp', hut: s.kind === 'hut', name: s.name, lat: s.lat, lng: s.lng, d: s.d, off: s.off || 0,
        src: 'Route stop', note: '', hasWater: !!w, waterNear: w || null });
    });
    const camps = [...P.cands.filter(c => c.cls === 'camp'), ...extra].filter(c => c.d > 200 && c.d < total - 200 && !P.excluded.has(c.key));
    const nodes = [{ key: 'start', d: 0, off: 0, start: true }];
    camps.forEach(c => nodes.push({ ...c, fixed: fixedKeys.has(c.key) || !!c.stopRef || (c.pin && opts.keep && c.off <= 150) }));
    if (opts.bush) {
      for (let d = BUSH_STEP; d < total - BUSH_STEP / 2; d += BUSH_STEP) {
        if (camps.some(c => Math.abs(c.d - d) < 400)) continue;
        const [lat, lng] = ix.pointAt(d);
        const w = P.cands.filter(c => c.cls === 'water' && Math.abs(c.d - d) <= WATER_AT_CAMP && c.off <= WATER_AT_CAMP)[0];
        nodes.push({ key: 'bush:' + d, cls: 'camp', bush: true, name: `Bush camp (km ${fmtKm(d)})`, lat, lng, d, off: 0, hasWater: !!w, waterNear: w || null, src: 'Bush camp' });
      }
    }
    nodes.push({ key: 'end', d: total, off: 0, end: true });
    nodes.sort((a, b) => a.d - b.d);
    nodes.forEach(n => {
      n.t = tl.hoursAt(n.d);
      n.acc = (n.off || 0) * 1.3 / 1000 / ACCESS_KMH;      // walk in to an off-trail camp (and out next morning)
      n.must = n.fixed || P.pinned.has(n.key);
      let pen = 0;
      if (n.bush) pen += 4 + tl.slopeAt(n.d) * 0.25;
      if (!n.start && !n.end && opts.water && !n.hasWater) pen += 3;
      if (n.hut) pen -= 0.3;
      n.pen = pen;
    });
    return nodes;
  }

  function solve() {
    const nodes = nodesFor(), n = nodes.length, o = P.opts;
    const target = o.hours, max = o.maxHours;
    const dayH = (i, j) => nodes[j].t - nodes[i].t + nodes[i].acc + nodes[j].acc;
    const nextMust = new Array(n).fill(n - 1);
    for (let i = n - 2; i >= 0; i--) nextMust[i] = nodes[i + 1].must ? i + 1 : nextMust[i + 1];
    const cost = (i, j) => {
      if (j > nextMust[i]) return Infinity;                  // can't walk past a fixed / pinned night
      const h = dayH(i, j);
      if (h > max * 1.75) return Infinity;
      const last = j === n - 1;
      let c = (h - target) ** 2 * (last && h < target ? 0.4 : 1);   // a short last day is fine
      if (h > max) c += 25 * (h - max) ** 2;
      if (h < 1.5 && !last) c += 15 * (1.5 - h);             // no near-empty days between two camps
      return c + (last ? 0 : nodes[j].pen);
    };
    const days = o.days ? +o.days : 0;
    let path = null;
    if (!days) {
      const best = new Array(n).fill(Infinity), prev = new Array(n).fill(-1);
      best[0] = 0;
      for (let j = 1; j < n; j++) for (let i = j - 1; i >= 0; i--) {
        if (best[i] === Infinity) continue;
        if (nodes[j].t - nodes[i].t > max * 1.75) break;
        const c = best[i] + cost(i, j);
        if (c < best[j]) { best[j] = c; prev[j] = i; }
        if (nodes[i].must) break;                           // can't start a day before an earlier fixed night
      }
      if (best[n - 1] < Infinity) { path = []; for (let j = n - 1; j >= 0; j = prev[j]) { path.unshift(j); if (j === 0) break; } }
    } else {
      /* exactly `days` walking days */
      const best = Array.from({ length: days + 1 }, () => new Array(n).fill(Infinity));
      const prev = Array.from({ length: days + 1 }, () => new Array(n).fill(-1));
      best[0][0] = 0;
      for (let k = 1; k <= days; k++) for (let j = 1; j < n; j++) for (let i = j - 1; i >= 0; i--) {
        if (best[k - 1][i] < Infinity) {
          const c = best[k - 1][i] + cost(i, j);
          if (c < best[k][j]) { best[k][j] = c; prev[k][j] = i; }
        }
        if (nodes[i].must) break;
      }
      if (best[days][n - 1] < Infinity) { path = [n - 1]; for (let k = days, j = n - 1; k > 0; k--) { j = prev[k][j]; path.unshift(j); } }
    }
    if (!path) return { nodes, days: [], error: days ? `Can't fit the walk into ${days} days within ${o.maxHours} h a day — try more days or a longer maximum.` : 'No workable split — try a longer maximum day, a wider search or allow bush camps.' };
    const waters = P.cands.filter(c => c.cls === 'water');
    const out = path.slice(1).map((j, k) => {
      const i = path[k], a = nodes[i], b = nodes[j];
      return {
        n: k + 1, from: a, to: b, d0: a.d, d1: b.d, km: (b.d - a.d) / 1000, hours: dayH(i, j),
        ascent: P.tl.ascentAt(b.d) - P.tl.ascentAt(a.d),
        water: waters.filter(w => w.d > a.d + 50 && w.d < b.d - 50 && w.off <= 500)
      };
    });
    /* dry stretches: gaps between water (start/finish count as water) */
    const wd = [0, ...waters.filter(w => w.off <= 500 && WATER_TYPES[w.wtype].rel > 0).map(w => w.d), ...out.slice(0, -1).filter(D => D.to.hasWater).map(D => D.to.d), P.ix.total].sort((x, y) => x - y);
    let dry = { len: 0, d0: 0, d1: 0 };
    for (let i = 1; i < wd.length; i++) if (wd[i] - wd[i - 1] > dry.len) dry = { len: wd[i] - wd[i - 1], d0: wd[i - 1], d1: wd[i] };
    return { nodes, days: out, dry };
  }

  /* other camps within ±2 h walk of a night, to swap to */
  function alternatives(R, D) {
    return R.nodes.filter(x => x.cls === 'camp' && !x.bush && x !== D.to && Math.abs(x.t - D.to.t) <= 2.25)
      .sort((a, b) => a.d - b.d).slice(0, 10);
  }

  /* ---------- UI ---------- */
  function panel() { return $('#dayPlanPanel'); }

  async function open(id) {
    const f = feats().find(x => x.id === id && x.type === 'trail');
    if (!f) return;
    close();
    const saved = f.dayPlan || {};
    P = {
      f, ix: index(f), tl: null, cands: [], pinned: new Set(saved.pinned || []), excluded: new Set(saved.excluded || []), result: null, status: '', busy: true,
      opts: { hours: 6, maxHours: 8, days: '', radius: 1000, water: true, bush: false, keep: true, addWater: true, ...(saved.opts || {}) }
    };
    App.show('map');
    const el = panel();
    el.hidden = false;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    P.layer = L.layerGroup().addTo(MapView.getMap());
    MapView.getMap().fitBounds(L.latLngBounds(f.coords), { padding: [30, 30] });
    P.status = '⛰ Working out walking times…';
    render();
    if (!Traverse.hasProfile(f)) await MapView.fetchElevation(f, true).catch(() => {});
    if (!P || P.f !== f) return;
    P.tl = timeline(f, P.ix.total);
    await search();
  }

  async function search() {
    const f = P.f;
    P.busy = true;
    P.status = `🔎 Looking for campsites, huts and water within ${RADII.find(r => r[0] === +P.opts.radius)?.[1] || P.opts.radius + ' m'} of the trail…`;
    render();
    let els = [];
    try {
      els = await fetchOsm(f, +P.opts.radius);
      P.status = els.length ? '' : 'Nothing found in OpenStreetMap near this trail — the server may have been busy. <button class="btn small" data-dp="retry">Retry</button>';
    }
    catch (e) { P.status = `⚠️ ${e.message} — using only the campsites and water already on your map. <button class="btn small" data-dp="retry">Retry</button>`; }
    if (!P || P.f !== f) return;
    P.cands = candidates(f, P.ix, els, +P.opts.radius);
    P.busy = false;
    plan();
  }

  function plan() {
    P.result = solve();
    P.f.dayPlan = { opts: { ...P.opts }, pinned: [...P.pinned], excluded: [...P.excluded] };
    render();
    draw();
  }

  function render() {
    const el = panel();
    if (!el || !P) return;
    const o = P.opts, R = P.result, f = P.f;
    const nC = P.cands.filter(c => c.cls === 'camp' && !c.hut).length, nH = P.cands.filter(c => c.hut).length, nW = P.cands.filter(c => c.cls === 'water').length;
    const nightCount = R && R.days.length ? R.days.length - 1 : 0;
    const ex = P.tl ? existingNights() : [];
    el.innerHTML = `
      <div class="cat-head"><h3>🗓 Plan days — ${esc(f.name)}</h3><button class="icon-btn" data-dp="close" title="Close the day planner">✕</button></div>
      <p class="small muted">${fmtKm(P.ix.total)} km${P.tl ? ` · about ${fmtH(P.tl.hoursAt(P.ix.total))} walking${P.tl.hasElev ? '' : ' (no terrain data — distance only)'}` : ''}${P.busy ? '' : ` · found ${nC} campsite${nC === 1 ? '' : 's'}, ${nH} hut${nH === 1 ? '' : 's'} / shelter${nH === 1 ? '' : 's'}, ${nW} water source${nW === 1 ? '' : 's'}`}</p>
      ${P.status ? `<p class="small">${P.status}</p>` : ''}
      <div class="dp-opts">
        <label>Walking hours a day <input type="number" min="1" max="14" step="0.5" data-o="hours" value="${o.hours}"></label>
        <label>Longest day <input type="number" min="2" max="16" step="0.5" data-o="maxHours" value="${o.maxHours}"> h</label>
        <label>Days <select data-o="days"><option value="">Best fit</option>${Array.from({ length: 30 }, (_, i) => i + 1).map(d => `<option ${String(d) === String(o.days) ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label>Search within <select data-o="radius">${RADII.map(([v, l]) => `<option value="${v}" ${+o.radius === v ? 'selected' : ''}>${l}</option>`).join('')}</select> of the trail</label>
        <label class="check"><input type="checkbox" data-o="water" ${o.water ? 'checked' : ''}> Prefer camps with water</label>
        <label class="check"><input type="checkbox" data-o="bush" ${o.bush ? 'checked' : ''}> Allow bush camps where there's no campsite</label>
        ${ex.length ? `<label class="check"><input type="checkbox" data-o="keep" ${o.keep ? 'checked' : ''}> Keep the ${ex.length} campsite${ex.length === 1 ? '' : 's'} already on the route</label>` : ''}
      </div>
      ${!R ? '' : R.error ? `<p class="warn-text">${esc(R.error)}</p>${P.pinned.size || P.excluded.size ? '<button class="btn small" data-dp="unpin">Undo swaps and pins</button>' : ''}` : `
        <div class="dp-sum"><b>${R.days.length} day${R.days.length === 1 ? '' : 's'}</b>, ${nightCount} night${nightCount === 1 ? '' : 's'} · ${R.days.map(D => fmtH(D.hours).replace(' h', '')).join(' / ')} h
          ${R.dry && R.dry.len > 8000 ? `<div class="warn-text small">💧 Longest stretch without known water: ${fmtKm(R.dry.len)} km (km ${fmtKm(R.dry.d0)}–${fmtKm(R.dry.d1)}) — plan to carry water${R.dry.len > 15000 ? ' or a water drop' : ''}.</div>` : ''}</div>
        ${R.days.map(D => dayCard(R, D)).join('')}
        <label class="check"><input type="checkbox" data-o="addWater" ${o.addWater ? 'checked' : ''}> Also add the water sources to the map</label>
        ${datesHtml(R.days.length)}
        <div class="btn-row"><button class="btn primary" data-dp="apply">✔ Use this plan</button><button class="btn" data-dp="unpin" ${P.pinned.size || P.excluded.size ? '' : 'disabled'}>Undo swaps and pins</button></div>
        <p class="hint">Campsites and water come from OpenStreetMap and your map — check camping is permitted, bookings and that water is flowing before you go. Times use the route card's walking speeds; add time for rests and heavy packs.</p>`}`;
  }

  /* ---------- trip dates: offer to make the trip's length match the walk ---------- */
  const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function dateFix(n) {
    const t = Store.state.trip, s = parseDate(t.start), e = parseDate(t.end);
    if (!s) return { have: e ? null : 0, n, noStart: true };
    const have = e && e >= s ? Math.round((e - s) / 86400000) + 1 : 1;
    const end = new Date(s); end.setDate(end.getDate() + n - 1);
    return { have, n, end, same: have === n };
  }
  function datesHtml(n) {
    const x = dateFix(n);
    if (x.noStart) return `<p class="small muted">📅 Set the trip's start date on the <a href="#trip" data-goto="trip">Trip</a> tab to have the end date set to match this ${n}-day plan.</p>`;
    if (x.same) return `<p class="small ok">📅 Matches the trip dates (${n} day${n === 1 ? '' : 's'}).</p>`;
    if (!P.datesTouched) P.setDates = n > x.have;             // longer walk: change dates by default; shorter: ask
    return `<label class="check dp-dates"><input type="checkbox" data-dp-dates ${P.setDates ? 'checked' : ''}>
      📅 The trip is set for <b>${x.have} day${x.have === 1 ? '' : 's'}</b>; this plan walks <b>${n}</b>. Change the trip's end date to <b>${fmtDate(x.end)}</b>${n < x.have ? ' (shorter trip — untick if the extra days are travel or rest days)' : ''}</label>`;
  }

  function dayCard(R, D) {
    const last = D.to.end, c = D.to;
    const tag = c.bush ? '🏕️' : c.hut ? '🛖' : '⛺';
    const alts = last ? [] : alternatives(R, D);
    const wl = D.water.slice(0, 6).map(w => `<span title="${esc(WATER_TYPES[w.wtype].label)} · ${esc(w.src)}">${w.wtype === 'seasonal' ? '💧?' : '💧'} km ${fmtKm(w.d)} ${esc(w.name)}</span>`).join(', ');
    return `<div class="dp-day ${D.hours > P.opts.maxHours ? 'long' : ''}" data-day="${D.n}">
      <div class="dp-day-head"><b>Day ${D.n}</b> <span>${D.km.toFixed(1)} km · ${fmtH(D.hours)}${P.tl.hasElev ? ` · ↑${Math.round(D.ascent)} m` : ''}</span>
        <button class="icon-btn" data-dp="zoom" title="Zoom to this day">🔍</button></div>
      ${last ? `<div class="small">→ 🏁 Finish</div>` : `<div class="small">→ ${tag} <b>${esc(c.name)}</b> <span class="muted">km ${fmtKm(c.d)}${c.off > 60 ? `, ${Math.round(c.off / 10) * 10} m off the trail` : ''}</span>
        ${c.hasWater ? `<span class="ok"> 💧 water${c.waterNear && !c.water ? ` (${esc(c.waterNear.name)})` : ''}</span>` : '<span class="warn-text"> no known water — carry it</span>'}
        ${c.fixed ? ' <span class="muted">(already on the route)</span>' : P.pinned.has(c.key) ? ' 📌' : ''}
        ${c.note ? `<span class="muted"> · ${esc(c.note)}</span>` : ''}</div>
        ${alts.length && !c.fixed ? `<select class="dp-alt" data-night="${c.key}" title="Stop somewhere else this night">
          <option value="">Swap this night for…</option>
          ${alts.map(a => `<option value="${esc(a.key)}">${a.hut ? '🛖' : '⛺'} ${esc(a.name)} — km ${fmtKm(a.d)} (${a.t > c.t ? '+' : '−'}${fmtH(Math.abs(a.t - c.t))})${a.hasWater ? ' 💧' : ''}</option>`).join('')}
        </select>` : ''}`}
      <div class="small muted">${wl ? `Water on the way: ${wl}${D.water.length > 6 ? ` +${D.water.length - 6} more` : ''}` : 'No water sources found on the way'}</div>
    </div>`;
  }

  const COLORS = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#c2255c', '#0c8599'];
  function draw() {
    if (!P || !P.layer) return;
    P.layer.clearLayers();
    const R = P.result;
    if (R && R.days.length) R.days.forEach((D, k) => {
      const pts = P.f.coords.filter((c, i) => P.ix.cum[i] >= D.d0 && P.ix.cum[i] <= D.d1);
      L.polyline(pts, { color: COLORS[k % COLORS.length], weight: 7, opacity: 0.55, interactive: false }).addTo(P.layer);
    });
    const chosen = new Set(R && R.days ? R.days.slice(0, -1).map(D => D.to.key) : []);
    const nightOf = new Map(R && R.days ? R.days.slice(0, -1).map(D => [D.to.key, D.n]) : []);
    const show = [...P.cands, ...(R ? R.nodes.filter(n => (n.bush && chosen.has(n.key)) || n.stopRef) : [])];
    show.forEach(c => {
      const on = chosen.has(c.key);
      const icon = c.cls === 'water' ? (c.wtype === 'seasonal' ? '💧' : '💧') : c.bush ? '🏕️' : c.hut ? '🛖' : '⛺';
      const html = `<span class="dp-pin ${c.cls} ${on ? 'on' : ''} ${c.wtype === 'seasonal' ? 'seasonal' : ''}">${icon}${on ? `<b>N${nightOf.get(c.key)}</b>` : ''}</span>`;
      L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'dp-icon', html, iconSize: on ? [44, 24] : [20, 20], iconAnchor: on ? [12, 12] : [10, 10] }), zIndexOffset: on ? 1000 : 0 })
        .bindPopup(() => `<b>${esc(c.name)}</b><br><small>${c.cls === 'water' ? esc(WATER_TYPES[c.wtype].label) : c.bush ? 'Bush camp — check camping is allowed' : c.hut ? 'Hut / shelter' : 'Campsite'} · km ${fmtKm(c.d)}${c.off > 60 ? `, ${Math.round(c.off)} m off the trail` : ''}<br>
          ${Geo.grText(c.lat, c.lng)} · ${esc(c.src)}${c.note ? ' · ' + esc(c.note) : ''}</small>
          ${c.cls === 'camp' && !on && !c.bush ? `<br><button class="btn small primary" data-dp-pin="${esc(c.key)}">📌 Stop here for a night</button>` : ''}
          ${on && P.pinned.has(c.key) ? `<br><button class="btn small" data-dp-unpin="${esc(c.key)}">Unpin</button>` : ''}`)
        .addTo(P.layer);
    });
  }

  function zoomDay(n) {
    const D = P.result.days[n - 1];
    const pts = P.f.coords.filter((c, i) => P.ix.cum[i] >= D.d0 - 1 && P.ix.cum[i] <= D.d1 + 1);
    pts.push([D.to.lat, D.to.lng], [D.from.lat ?? pts[0][0], D.from.lng ?? pts[0][1]]);
    MapView.getMap().fitBounds(L.latLngBounds(pts.filter(p => p[0] != null)), { padding: [40, 40] });
  }

  /* ---------- apply: camps (and water) on the map, as the trail's overnight stops ---------- */
  function apply() {
    const R = P.result, f = P.f;
    if (!R || !R.days.length) return;
    const nights = R.days.slice(0, -1).map(D => D.to);
    const notes = c => [c.src === 'OpenStreetMap' ? 'From OpenStreetMap' : '', c.note, c.bush ? 'Bush camp — check camping is allowed here and choose a flat, safe spot away from water.' : '',
      c.hasWater ? (c.waterNear && !c.water ? `Water: ${c.waterNear.name}` : 'Water at camp') : 'No known water — carry it'].filter(Boolean).join('. ');
    let addedCamps = 0, addedWater = 0, retired = 0;
    const nightStops = nights.map(c => {
      if (c.key === 'trip-camp') return { ref: 'camp', name: c.name, kind: 'campsite', lat: c.lat, lng: c.lng };
      if (c.stopRef) { const s = (f.stops || []).find(x => x.ref === c.stopRef); if (s) return { ...s, night: true }; }
      let lm = c.lmId ? feats().find(x => x.id === c.lmId) : null;
      if (!lm) {
        lm = { id: uid(), type: 'landmark', kind: c.hut ? 'hut' : 'campsite', name: c.name, notes: notes(c), lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) };
        feats().push(lm);
        addedCamps++;
      }
      return { ref: lm.id, name: lm.name, kind: lm.kind, lat: lm.lat, lng: lm.lng, night: true };
    });
    /* campsites on the route that aren't nights any more (only when not keeping them) */
    if (!P.opts.keep) {
      const used = new Set(nightStops.map(s => s.ref));
      existingNights().forEach(s => {
        const lm = feats().find(x => x.id === s.ref);
        if (lm && !used.has(lm.id) && lm.kind === 'campsite') { lm.kind = 'waypoint'; lm.notes = [lm.notes, 'Was a campsite — not used as a night in the day plan.'].filter(Boolean).join(' '); retired++; }
      });
    }
    if (P.opts.addWater) {
      P.cands.filter(c => c.cls === 'water' && !c.lmId && c.off <= 500).forEach(c => {
        if (feats().some(x => x.type === 'landmark' && x.kind === 'water' && Geo.hav([x.lat, x.lng], [c.lat, c.lng]) < 100)) return;
        feats().push({ id: uid(), type: 'landmark', kind: 'water', name: c.name, notes: `${WATER_TYPES[c.wtype].label}. From ${c.src}.`, lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) });
        addedWater++;
      });
    }
    /* the trail's explicit stops: keep non-overnight stops, replace the overnight ones */
    const keep = (f.stops || []).filter(s => !isNightStop(s) || (P.opts.keep && nightStops.some(n => n.ref === s.ref)));
    const merged = [...keep.filter(s => !nightStops.some(n => n.ref === s.ref)), ...nightStops];
    merged.forEach(s => { s._d = P.ix.locate(s.lat, s.lng).d; });
    merged.sort((a, b) => a._d - b._d).forEach(s => delete s._d);
    f.stops = merged;
    /* trip dates */
    const x = dateFix(R.days.length);
    let dated = '';
    if (!x.noStart && !x.same && P.setDates) {
      Store.state.trip.end = isoDate(x.end);
      dated = `; trip now ends ${fmtDate(x.end)} (${R.days.length} days)`;
    }
    Store.save();
    MapView.redraw();
    toast(`Planned ${R.days.length} days: ${nightStops.length} night${nightStops.length === 1 ? '' : 's'}${addedCamps ? `, ${addedCamps} new camp${addedCamps === 1 ? '' : 's'}` : ''}${addedWater ? `, ${addedWater} water source${addedWater === 1 ? '' : 's'}` : ''} added to the map${retired ? `, ${retired} old campsite${retired === 1 ? '' : 's'} changed to waypoints` : ''}${dated}`, 5000);
    close();
  }

  function close() {
    if (P && P.layer) P.layer.remove();
    P = null;
    const el = panel();
    if (el) { el.hidden = true; el.innerHTML = ''; }
  }

  /* ---------- events ---------- */
  function bind() {
    const el = panel();
    el.addEventListener('change', e => {
      if (!P) return;
      const k = e.target.dataset.o;
      if (k) {
        P.opts[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (k === 'hours' || k === 'maxHours') P.opts[k] = Math.max(1, num(e.target.value, 6));
        if (k === 'hours' && P.opts.maxHours < P.opts.hours) P.opts.maxHours = P.opts.hours;
        if (k === 'radius') return search();
        if (k === 'addWater') return;
        if (!P.busy) plan();
        return;
      }
      if (e.target.hasAttribute('data-dp-dates')) { P.setDates = e.target.checked; P.datesTouched = true; return; }
      if (e.target.classList.contains('dp-alt') && e.target.value) {
        /* swap: the old night is left out, the new one pinned */
        P.pinned.delete(e.target.dataset.night);
        P.excluded.add(e.target.dataset.night);
        P.excluded.delete(e.target.value);
        P.pinned.add(e.target.value);
        plan();
      }
    });
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-dp]')?.dataset.dp;
      if (!a || !P) return;
      if (a === 'close') close();
      else if (a === 'retry') search();
      else if (a === 'apply') apply();
      else if (a === 'unpin') { P.pinned.clear(); P.excluded.clear(); plan(); }
      else if (a === 'zoom') zoomDay(+e.target.closest('[data-day]').dataset.day);
    });
    /* popup buttons on the map */
    document.addEventListener('click', e => {
      if (!P) return;
      const pin = e.target.closest('[data-dp-pin]'), un = e.target.closest('[data-dp-unpin]');
      if (!pin && !un) return;
      if (pin) { P.pinned.add(pin.dataset.dpPin); P.excluded.delete(pin.dataset.dpPin); } else P.pinned.delete(un.dataset.dpUnpin);
      MapView.getMap().closePopup();
      plan();
    });
  }

  function init() { if (panel()) bind(); }

  return { open, close, init, isNightStop, isOpen: () => !!P, _state: () => P };
})();
DayPlan.init();
