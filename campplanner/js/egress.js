/* Camp Planner — egress points: where a walking route meets roads or vehicle tracks, and what vehicle can use them.
   NSW: official NSW Spatial Services road network (class & surface) + RFS classified fire trails.
   Elsewhere: OpenStreetMap highway / tracktype / 4wd_only / surface / access tags.
   Fallback: the track types recorded when the trail was routed. */

const Egress = (() => {
  const NSW = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Transport_Theme/FeatureServer';
  const CORRIDOR = 60;  // m either side of the route to search for vehicle tracks
  const TOUCH = 40;     // m: route this close to a vehicle track counts as an access point
  const LEVELS = {
    '2wd': { label: '2WD', color: '#2b8a3e', icon: '🚗', rank: 1 },
    awd: { label: 'High-clearance / AWD', color: '#f08c00', icon: '🚙', rank: 2 },
    '4wd': { label: '4WD only', color: '#c92a2a', icon: '🛻', rank: 3 },
    fire: { label: 'Fire trail — 4WD, may be gated', color: '#a61e4d', icon: '🚒', rank: 3.5 },
    restricted: { label: 'Gated / authorised vehicles only', color: '#7048e8', icon: '🚧', rank: 4 },
    unknown: { label: 'Vehicle track — check access', color: '#868e96', icon: '❔', rank: 5 }
  };
  const busy = new Map();
  const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const keyOf = f => `${f.coords.length}:${f.coords[0]}:${f.coords[f.coords.length - 1]}:${Math.round(Geo.lineLength(f.coords))}`;
  const fresh = f => f.egress && f.egress.key === keyOf(f);

  /* ---------- classification ---------- */
  function nswClass(p) {
    const fh = p.functionhierarchy, sf = p.surface;
    if (fh === 8) {
      if (sf === 3 || sf === 4) return ['4wd', '4WD track'];
      if (sf === 2) return ['awd', 'Unsealed vehicle track — high clearance, 4WD when wet'];
      if (sf === 1) return ['2wd', 'Sealed track'];
      return ['4wd', 'Vehicle track (surface not recorded) — assume 4WD'];
    }
    if (sf === 3 || sf === 4) return ['4wd', '4WD road'];
    if (sf === 2) return ['2wd', 'Unsealed road — 2WD in dry weather'];
    if (sf === 1) return ['2wd', 'Sealed road'];
    return ['2wd', 'Road'];
  }

  function osmClass(t) {
    const h = t.highway, sf = t.surface || '', tt = t.tracktype || '';
    let level, desc;
    if (h === 'track') {
      if (t['4wd_only'] === 'yes' || /grade[45]/.test(tt) || /sand|mud|dirt|earth|ground|rock/.test(sf)) [level, desc] = ['4wd', '4WD track'];
      else if (tt === 'grade1') [level, desc] = ['2wd', 'Firm (sealed/hard) track'];
      else if (tt === 'grade2' || /gravel|compacted|fine_gravel/.test(sf)) [level, desc] = ['awd', 'Gravel track — high clearance, 4WD when wet'];
      else if (tt === 'grade3') [level, desc] = ['awd', 'Mixed-surface track — high clearance / AWD'];
      else [level, desc] = ['4wd', 'Vehicle track (grade not recorded) — assume 4WD'];
    } else if (/sand|mud|dirt|earth|ground/.test(sf)) [level, desc] = ['4wd', 'Dirt road — 4WD recommended'];
    else if (/unpaved|gravel|compacted/.test(sf)) [level, desc] = ['2wd', 'Unsealed road — 2WD in dry weather'];
    else [level, desc] = ['2wd', h === 'service' ? 'Service road' : 'Sealed road'];
    const acc = t.motor_vehicle || t.vehicle || t.access;
    if (['no', 'private', 'forestry', 'agricultural', 'permit', 'delivery', 'customers'].includes(acc)) {
      desc += ` · access: ${acc}`;
      level = 'restricted';
    }
    if (t['4wd_only'] === 'yes') desc += ' · signed 4WD only';
    if (t.seasonal === 'yes' || t.access === 'seasonal') desc += ' · seasonal closure';
    return [level, desc];
  }

  /* ---------- data: vehicle network along the route ---------- */
  function corridorPath(coords, max) {
    const step = Math.max(1, Math.ceil(coords.length / max));
    return coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
  }

  async function arcgisAlong(layer, where, coords, outFields) {
    const body = new URLSearchParams({
      where, geometry: JSON.stringify({ paths: [corridorPath(coords, 250).map(c => [c[1], c[0]])], spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPolyline', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: String(CORRIDOR),
      units: 'esriSRUnit_Meter', outFields, outSR: '4326', geometryPrecision: '6', resultRecordCount: '2000', f: 'geojson'
    });
    const r = await fetch(`${NSW}/${layer}/query`, { method: 'POST', body });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.features;
  }
  const linesOf = g => !g ? [] : (g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]).map(l => l.map(c => [c[1], c[0]]));

  async function nswNetwork(coords) {
    const [roads, fire] = await Promise.all([
      arcgisAlong(5, 'functionhierarchy IN (1,2,3,4,5,6,7,8)', coords, 'roadnamebase,roadnametype,functionhierarchy,surface,operationalstatus'),
      arcgisAlong(9, '1=1', coords, 'operationalstatus').catch(() => [])
    ]);
    const net = roads.filter(f => f.properties.operationalstatus !== 6).map(f => {
      const p = f.properties, [level, desc] = nswClass(p);
      const name = p.roadnamebase ? titleCase([p.roadnamebase, p.roadnametype].filter(Boolean).join(' ')) : (p.functionhierarchy === 8 ? 'Unnamed vehicle track' : 'Unnamed road');
      return { lines: linesOf(f.geometry), name, level, desc };
    });
    return { net, fire: fire.flatMap(f => linesOf(f.geometry)), src: 'NSW Spatial Services (official road & fire trail network)' };
  }

  async function osmNetwork(coords) {
    const pts = corridorPath(coords, 120).map(c => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join(',');
    const j = await Parks.overpass(`[out:json][timeout:40];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|living_street|road)$"](around:${CORRIDOR},${pts});out tags geom;`, 30000);
    const net = j.elements.filter(e => e.geometry).map(e => {
      const t = e.tags || {}, [level, desc] = osmClass(t);
      return { lines: [e.geometry.map(g => [g.lat, g.lon])], name: t.name || (t.highway === 'track' ? 'Unnamed vehicle track' : 'Unnamed road'), level, desc };
    });
    return { net, fire: [], src: 'OpenStreetMap' };
  }

  /* Last resort: the road / track types recorded on the routed trail itself. */
  function routeNetwork(f) {
    const labels = Routing.expand(f.ways, f.coords.length - 1);
    if (!labels) return null;
    const net = [];
    labels.forEach((l, i) => {
      const [cat, name, surface] = l.split('|');
      if (cat !== 'road' && cat !== 'trail') return;
      const level = cat === 'road' ? (/4WD/.test(surface) ? '4wd' : '2wd') : (/gravel|compacted/.test(surface) ? 'awd' : '4wd');
      net.push({ lines: [[f.coords[i], f.coords[i + 1]]], name: name || (cat === 'road' ? 'Road' : 'Vehicle / fire trail'), level,
        desc: cat === 'road' ? `Road${surface ? ' (' + surface + ')' : ''}` : `Vehicle / fire trail${surface ? ' (' + surface + ')' : ''} — assume 4WD` });
    });
    return { net, fire: [], src: 'track types recorded when the trail was routed (no live data)' };
  }

  /* ---------- analysis ---------- */
  function analyse(f, data) {
    const total = Geo.lineLength(f.coords);
    const S = Geo.densify(f.coords, Math.min(800, Math.max(2, Math.ceil(total / 25))));
    const lat0 = S[0].lat, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    const xy = p => [p[1] * kx, p[0] * ky];
    const segs = [];
    data.net.forEach((n, ni) => n.lines.forEach(l => { for (let i = 1; i < l.length; i++) segs.push([xy(l[i - 1]), xy(l[i]), ni]); }));
    const fireSegs = [];
    data.fire.forEach(l => { for (let i = 1; i < l.length; i++) fireSegs.push([xy(l[i - 1]), xy(l[i])]); });
    const distTo = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    /* nearest vehicle track to each route sample */
    const touch = S.map(s => {
      const p = xy([s.lat, s.lng]);
      let best = null;
      for (const [a, b, ni] of segs) {
        if (Math.abs(p[0] - a[0]) > 400 && Math.abs(p[0] - b[0]) > 400) continue; // quick reject
        const d = distTo(p, a, b);
        if (d <= TOUCH && (!best || d < best.d || LEVELS[data.net[ni].level].rank < LEVELS[data.net[best.ni].level].rank && d < TOUCH / 2)) best = { d, ni };
      }
      return best ? best.ni : -1;
    });
    /* group consecutive samples on the same road/track into runs */
    const runs = [];
    let cur = null;
    S.forEach((s, i) => {
      const ni = touch[i];
      const k = ni < 0 ? null : data.net[ni].name + '|' + data.net[ni].level;
      if (k && cur && cur.k === k && i - cur.last <= 2) { cur.last = i; cur.d1 = s.d; return; }
      if (cur) runs.push(cur);
      cur = k ? { k, ni, first: i, last: i, d0: s.d, d1: s.d } : null;
    });
    if (cur) runs.push(cur);

    /* most of a run on an RFS classified fire trail → fire trail (tracks only, never public roads) */
    const nearFire = i => fireSegs.some(([a, b]) => distTo(xy([S[i].lat, S[i].lng]), a, b) < 20);
    const entries = runs.map(r => {
      const n = data.net[r.ni], len = r.d1 - r.d0;
      const mid = S[Math.round((r.first + r.last) / 2)], at = len < 120 ? mid : S[r.first];
      let level = n.level, desc = n.desc;
      if (fireSegs.length && level !== '2wd') {
        let hit = 0;
        for (let i = r.first; i <= r.last; i++) if (nearFire(i)) hit++;
        if (hit / (r.last - r.first + 1) >= 0.6) {
          level = 'fire';
          desc += ' · RFS classified fire trail — often locked to public vehicles; emergency services can use it';
        }
      }
      const where = r.d0 < 60 ? 'At the start' : r.d1 > total - 60 ? 'At the finish' : len < 120 ? `Crosses ${n.name}` : `Follows ${n.name} for ${(len / 1000).toFixed(1)} km`;
      return { kind: len < 120 ? 'cross' : 'follow', d0: r.d0, d1: r.d1, lat: +at.lat.toFixed(6), lng: +at.lng.toFixed(6), name: n.name, level, desc, where };
    });

    /* merge access points of the same vehicle class that are close together (e.g. streets in a village) */
    for (let i = entries.length - 1; i > 0; i--) {
      const a = entries[i - 1], b = entries[i];
      if (a.level !== b.level || b.d0 - a.d1 > 200) continue;
      const names = [...new Set([...a.name.split(', '), ...b.name.split(', ')])].filter(n => !/^Unnamed/.test(n) || !a.name);
      a.d1 = Math.max(a.d1, b.d1);
      a.name = names.slice(0, 3).join(', ') + (names.length > 3 ? ' …' : '') || a.name;
      if (!a.desc.split(' / ').includes(b.desc)) a.desc += ' / ' + b.desc;
      a.kind = 'follow';
      a.where = a.d0 < 60 ? 'At the start' : a.d1 > total - 60 ? 'At the finish' : `Roads / tracks for ${((a.d1 - a.d0) / 1000).toFixed(1)} km`;
      entries.splice(i, 1);
    }

    /* user-marked exits on the map */
    Store.state.map.features.filter(x => x.type === 'landmark' && ['evac', 'parking'].includes(x.kind)).forEach(x => {
      let best = { off: Infinity, d: 0 };
      S.forEach(s => { const off = Geo.hav([s.lat, s.lng], [x.lat, x.lng]); if (off < best.off) best = { off, d: s.d }; });
      if (best.off < 200 && !entries.some(e => Math.abs(e.d0 - best.d) < 50)) {
        entries.push({ kind: 'landmark', d0: best.d, d1: best.d, lat: x.lat, lng: x.lng, name: x.name, level: 'unknown',
          desc: `${(MapView.KINDS[x.kind] || {}).label} marked on your map${x.notes ? ' — ' + x.notes : ''}`, where: `${x.name} (${Math.round(best.off)} m off route)` });
      }
    });
    entries.sort((a, b) => a.d0 - b.d0);

    /* stretches with no vehicle access */
    const gaps = [];
    let reach = 0;
    entries.forEach(e => { if (e.d0 - reach > 100) gaps.push([reach, e.d0]); reach = Math.max(reach, e.d1); });
    if (total - reach > 100) gaps.push([reach, total]);
    const worst = gaps.reduce((w, g) => (g[1] - g[0] > (w ? w[1] - w[0] : 0) ? g : w), null);
    /* furthest walk to a vehicle track: half a gap between two access points, a whole gap at either end */
    const furthest = gaps.reduce((m, [a, b]) => Math.max(m, (a === 0 || b === total) ? b - a : (b - a) / 2), 0);
    return { key: keyOf(f), at: Date.now(), src: data.src, entries, gaps, worst, furthest, total };
  }

  /* Find egress points for a trail; caches the result on the trail. */
  function run(f, force) {
    if (!force && fresh(f)) return Promise.resolve(f.egress);
    if (busy.has(f.id)) return busy.get(f.id);
    const p = (async () => {
      const lats = f.coords.map(c => c[0]), lngs = f.coords.map(c => c[1]);
      const inNsw = Math.max(...lngs) > 140.9 && Math.min(...lngs) < 153.7 && Math.max(...lats) > -37.6 && Math.min(...lats) < -28.1;
      const tries = inNsw ? [nswNetwork, osmNetwork] : [osmNetwork];
      let data = null, errs = [];
      for (const t of tries) {
        try { data = await t(f.coords); break; } catch (e) { errs.push(e.message); }
      }
      if (!data) data = routeNetwork(f);
      if (!data) throw new Error(errs.join('; ') || 'no vehicle track data');
      f.egress = analyse(f, data);
      Store.save();
      return f.egress;
    })().finally(() => busy.delete(f.id));
    busy.set(f.id, p);
    return p;
  }

  return { run, fresh, LEVELS };
})();
