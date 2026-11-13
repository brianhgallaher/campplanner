/* Camp Planner — route along tracks.
   osm:      BRouter hiking profile over OpenStreetMap paths/tracks (all of Australia).
   nsw:      shortest path over the official NSW topographic road & track network (NSW Spatial Services).
   straight: straight line (off-track).
   A route is { coords: [[lat,lng]…], labels: [one per edge "cat|name|surface"] }. */

const Routing = (() => {
  const SOURCES = {
    osm: 'OpenStreetMap tracks (all Australia)',
    nsw: 'NSW official tracks & fire trails',
    straight: 'Straight line (off-track)'
  };
  const CATS = {
    track: { label: 'Walking track', color: '#2b8a3e', kmh: 4 },
    trail: { label: 'Vehicle / fire trail', color: '#a0522d', kmh: 4.5 },
    road: { label: 'Road', color: '#495057', kmh: 5 },
    off: { label: 'Off-track', color: '#e8590c', kmh: 2 },
    unknown: { label: 'Unclassified', color: '#adb5bd', kmh: 4 }
  };
  const NSW_ROADS = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Transport_Theme/FeatureServer/5/query';
  const OFF_TRACK_GAP = 15; // metres before a gap is treated as an off-track connector

  const catOf = label => (label || 'unknown').split('|')[0];

  /* Per-edge labels <-> compact run-length form for storage. */
  function rle(labels) {
    const out = [];
    for (const l of labels) {
      const last = out[out.length - 1];
      if (last && last[1] === l) last[0]++; else out.push([1, l]);
    }
    return out;
  }
  function expand(runs, edges) {
    const out = [];
    (runs || []).forEach(([n, l]) => { for (let i = 0; i < n; i++) out.push(l); });
    return out.length === edges ? out : null; // stale after hand edits
  }

  /* Distance along the trail per category, and runs [d0, d1, label] for charts. */
  function runsByDistance(f) {
    const labels = expand(f.ways, f.coords.length - 1);
    const cum = Geo.cumDist(f.coords);
    const runs = [];
    for (let i = 0; i < f.coords.length - 1; i++) {
      const l = labels ? labels[i] : 'unknown';
      const last = runs[runs.length - 1];
      if (last && last[2] === l) last[1] = cum[i + 1]; else runs.push([cum[i], cum[i + 1], l]);
    }
    return runs;
  }
  function catDistances(runs, d0 = 0, d1 = Infinity) {
    const out = {};
    runs.forEach(([a, b, l]) => {
      const len = Math.min(b, d1) - Math.max(a, d0);
      if (len > 0) out[catOf(l)] = (out[catOf(l)] || 0) + len;
    });
    return out;
  }
  /* Walking time: speed by track type, plus Naismith's 1 hour per 600 m of ascent. */
  function hours(byCat, ascent) {
    let h = 0;
    for (const [c, m] of Object.entries(byCat)) h += m / 1000 / (CATS[c] || CATS.unknown).kmh;
    return h + (ascent || 0) / 600;
  }

  /* ---------- public entry ---------- */
  /* tolerance: how far (m) the route may start/end from the requested points before an off-track connector is added. */
  async function route(points, source, tolerance = OFF_TRACK_GAP) {
    if (points.length < 2) throw new Error('Need at least two points');
    let r;
    if (source === 'straight') r = straight(points);
    else if (source === 'nsw') r = await nsw(points);
    else r = await brouter(points);
    return attachEnds(r, points, tolerance);
  }

  function straight(points) {
    return { coords: points.map(p => [p[0], p[1]]), labels: points.slice(1).map(() => 'off') };
  }

  /* Join the clicked/stop points onto the routed line with off-track connectors where needed. */
  function attachEnds(r, points, tolerance) {
    const first = points[0], last = points[points.length - 1];
    if (Geo.hav(first, r.coords[0]) > tolerance) { r.coords.unshift(first); r.labels.unshift('off'); }
    if (Geo.hav(last, r.coords[r.coords.length - 1]) > tolerance) { r.coords.push(last); r.labels.push('off'); }
    return r;
  }

  /* ---------- BRouter (OpenStreetMap) ---------- */
  function osmLabel(tags) {
    const t = Object.fromEntries((tags || '').split(' ').filter(Boolean).map(kv => kv.split('=')));
    const h = t.highway;
    let cat = 'unknown';
    if (['path', 'footway', 'steps', 'bridleway', 'pedestrian', 'cycleway'].includes(h)) cat = 'track';
    else if (h === 'track') cat = 'trail';
    else if (h) cat = 'road';
    const extra = [t.surface, t.sac_scale && t.sac_scale !== 'hiking' ? t.sac_scale.replace(/_/g, ' ') : ''].filter(Boolean).join(', ');
    return `${cat}||${extra}`;
  }

  async function brouter(points) {
    const ll = points.map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join('|');
    const r = await fetch(`https://brouter.de/brouter?lonlats=${ll}&profile=hiking-mountain&alternativeidx=0&format=geojson`);
    const text = await r.text();
    if (!r.ok) throw new Error(text.includes('not mapped') ? 'no mapped tracks near a point' : text.slice(0, 120));
    const feat = JSON.parse(text).features[0];
    const coords = feat.geometry.coordinates.map(c => [+c[1].toFixed(6), +c[0].toFixed(6)]);
    if (coords.length < 2 || +feat.properties['track-length'] === 0) throw new Error('no tracks found between these points');
    const msgs = (feat.properties.messages || []).slice(1);
    const labels = [];
    let k = 0;
    for (let i = 1; i < coords.length; i++) {
      const m = msgs[Math.min(k, msgs.length - 1)];
      labels.push(osmLabel(m ? m[9] : ''));
      if (m && Math.abs(m[0] / 1e6 - coords[i][1]) < 2e-6 && Math.abs(m[1] / 1e6 - coords[i][0]) < 2e-6) k++;
    }
    return { coords, labels };
  }

  /* ---------- NSW official track network ---------- */
  const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const NSW_SURFACE = { 1: 'sealed', 2: 'unsealed', 3: '4WD', 4: '4WD' };

  async function fetchNswNetwork(w, s, e, n) {
    const feats = [];
    for (let off = 0; off < 20000; off += 2000) {
      const q = `${NSW_ROADS}?where=1%3D1&geometry=${w},${s},${e},${n}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326` +
        `&spatialRel=esriSpatialRelIntersects&outFields=roadnamebase,roadnametype,functionhierarchy,surface&geometryPrecision=6` +
        `&resultOffset=${off}&resultRecordCount=2000&f=geojson`;
      const j = await getJSON(q);
      feats.push(...j.features);
      if (j.features.length < 2000) break;
    }
    return feats;
  }

  async function nsw(points) {
    const lats = points.map(p => p[0]), lngs = points.map(p => p[1]);
    const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
    if (span > 0.7) throw new Error('stops too far apart for NSW track routing (keep within ~70 km)');
    const pad = Math.max(0.01, span * 0.25);
    const feats = await fetchNswNetwork(Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad);
    if (!feats.length) throw new Error('no NSW track data here (outside NSW?)');

    /* Build the graph: vertices shared at junctions are merged by rounding to ~1 m. */
    const ids = new Map(), pts = [], adj = [];
    const node = (lat, lng) => {
      const k = lat.toFixed(5) + ',' + lng.toFixed(5);
      let id = ids.get(k);
      if (id === undefined) { id = pts.length; ids.set(k, id); pts.push([lat, lng]); adj.push([]); }
      return id;
    };
    const edges = [];
    for (const f of feats) {
      const p = f.properties, fh = p.functionhierarchy;
      const cat = fh === 9 || fh === 11 ? 'track' : fh === 8 ? 'trail' : 'road';
      const name = p.roadnamebase ? titleCase([p.roadnamebase, p.roadnametype].filter(Boolean).join(' ')) : '';
      const label = `${cat}|${name}|${NSW_SURFACE[p.surface] || ''}`;
      const factor = fh <= 2 ? 5 : 1; // avoid walking along highways
      const g = f.geometry;
      if (!g) continue;
      const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const u = node(line[i - 1][1], line[i - 1][0]), v = node(line[i][1], line[i][0]);
          if (u === v) continue;
          const w = Geo.hav(pts[u], pts[v]) * factor;
          adj[u].push([v, w, label]); adj[v].push([u, w, label]);
          edges.push([u, v, label]);
        }
      }
    }

    /* Snap each stop onto the nearest edge, splitting it with a new node. */
    const snapped = points.map((p, i) => {
      const kx = Math.cos(p[0] * Math.PI / 180) * 111320, ky = 110540;
      let best = null;
      for (const [u, v, label] of edges) {
        const ax = (pts[u][1] - p[1]) * kx, ay = (pts[u][0] - p[0]) * ky;
        const bx = (pts[v][1] - p[1]) * kx, by = (pts[v][0] - p[0]) * ky;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const x = ax + t * dx, y = ay + t * dy, d = Math.hypot(x, y);
        if (!best || d < best.d) best = { d, u, v, t, label };
      }
      if (!best || best.d > 1500) throw new Error(`no NSW track within 1.5 km of stop ${i + 1}`);
      const { u, v, t, label } = best;
      const id = pts.length;
      pts.push([pts[u][0] + (pts[v][0] - pts[u][0]) * t, pts[u][1] + (pts[v][1] - pts[u][1]) * t]);
      adj.push([]);
      for (const o of [u, v]) {
        const w = Geo.hav(pts[id], pts[o]);
        adj[id].push([o, w, label]); adj[o].push([id, w, label]);
      }
      return id;
    });

    const coords = [], labels = [];
    for (let i = 1; i < snapped.length; i++) {
      const leg = dijkstra(adj, snapped[i - 1], snapped[i]);
      if (!leg) throw new Error(`the NSW tracks between stop ${i} and ${i + 1} don't connect`);
      leg.forEach(([id, label], j) => {
        if (coords.length && j === 0) return; // shared stop between legs
        coords.push(pts[id]);
        if (label) labels.push(label);
      });
    }
    return { coords: coords.map(c => [+c[0].toFixed(6), +c[1].toFixed(6)]), labels };
  }

  /* Returns [[nodeId, labelOfEdgeInto]…] or null. Binary-heap Dijkstra. */
  function dijkstra(adj, src, dst) {
    const dist = new Float64Array(adj.length).fill(Infinity), prev = new Int32Array(adj.length).fill(-1), prevLabel = [];
    const heap = [[0, src]];
    dist[src] = 0;
    const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (u === dst) break;
      if (d > dist[u]) continue;
      for (const [v, w, label] of adj[u]) {
        if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; prevLabel[v] = label; push([dist[v], v]); }
      }
    }
    if (dist[dst] === Infinity) return null;
    const path = [];
    for (let v = dst; v !== -1; v = prev[v]) path.push([v, prevLabel[v]]);
    path.reverse();
    path[0][1] = null;
    return path;
  }

  return { SOURCES, CATS, route, rle, expand, runsByDistance, catDistances, hours, catOf };
})();
