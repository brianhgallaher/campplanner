/* Camp Planner — custom trail map: Australian topo base maps, MGA grid, landmarks, trails (snapped to tracks),
   routes between campsites, parks & track overlays, GPX and printing */

const MapView = (() => {
  const BASES = {
    topo: {
      name: 'Topographic — contours (OpenTopoMap)',
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      opts: { subdomains: 'abc', maxNativeZoom: 17, attribution: 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }
    },
    nswtopo: {
      name: 'NSW official topographic (Spatial Services)',
      url: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      opts: { maxNativeZoom: 16, attribution: '© Spatial Services NSW' }
    },
    tastopo: {
      name: 'Tasmania official topographic (TASMAP / theLIST)',
      url: 'https://services.thelist.tas.gov.au/arcgis/rest/services/Basemaps/Topographic/MapServer/tile/{z}/{y}/{x}',
      opts: { maxNativeZoom: 18, attribution: '© State of Tasmania (theLIST)' }
    },
    esritopo: {
      name: 'Topographic (Esri)',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      opts: { maxNativeZoom: 19, attribution: 'Tiles © Esri and contributors' }
    },
    osm: {
      name: 'Streets & tracks (OpenStreetMap)',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      opts: { maxNativeZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }
    },
    sat: {
      name: 'Satellite (Esri)',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      opts: { maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }
    }
  };
  const HILLSHADE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';

  const KINDS = {
    campsite: { icon: '⛺', label: 'Campsite' },
    water: { icon: '💧', label: 'Water source' },
    summit: { icon: '⛰️', label: 'Summit / peak' },
    lookout: { icon: '👁️', label: 'Lookout' },
    hut: { icon: '🛖', label: 'Hut / shelter' },
    parking: { icon: '🅿️', label: 'Car park / trailhead' },
    toilet: { icon: '🚻', label: 'Toilet' },
    picnic: { icon: '🧺', label: 'Picnic area' },
    danger: { icon: '⚠️', label: 'Hazard' },
    crossing: { icon: '🌊', label: 'River / creek crossing' },
    bridge: { icon: '🌉', label: 'Bridge' },
    junction: { icon: '🔀', label: 'Track junction' },
    evac: { icon: '⛑️', label: 'Emergency / evacuation point' },
    signal: { icon: '📶', label: 'Mobile reception' },
    fire: { icon: '🔥', label: 'Fire place' },
    fishing: { icon: '🎣', label: 'Fishing spot' },
    beach: { icon: '🏖️', label: 'Beach' },
    info: { icon: 'ℹ️', label: 'Information' },
    waypoint: { icon: '📍', label: 'Waypoint' }
  };
  const DASH = { solid: null, dashed: '10 8', dotted: '1 8' };
  const HINTS = {
    pan: 'Drag to pan. Click a feature to edit it in the list below.',
    landmark: 'Click the map to drop a landmark. Drag landmarks to move them.',
    trail: 'Click along the trail — each click follows the tracks from the last point. For a straight (off-track) leg, hold Shift while clicking, or press S / “📏 Straight line” to switch. Double-click or Enter to finish, Backspace to undo, Esc to cancel.',
    area: 'Click around the area. Double-click or press Enter to finish, Backspace to undo, Esc to cancel.',
    camp: 'Click the map to set the camp location (used for weather, tides & park lookup).'
  };
  const SNAP_TOLERANCE = 75; // metres: clicks this close to a track snap onto it

  let map, baseLayer, hillLayer, featureGroup, campMarker, vertexLayer, gridLayer, draftLayer, readoutEl;
  let mode = 'pan', lmKind = 'campsite', draft = null, vertexEditId = null, openId = null, gridInfo = null;
  let routeStops = [];
  let dayLayer = null, dayPick = '';   // highlighted day: "trailId:day" 
  let legStraight = new Set();   // "refA>refB" legs of Route between places to draw as straight lines
  const layers = new Map(), elevBusy = new Map();

  const S = () => Store.state.map;
  const feat = id => S().features.find(f => f.id === id);
  const grOf = (lat, lng) => Geo.grText(lat, lng);

  /* ---------- formatting & stats ---------- */
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 1 : 2) + ' km' : Math.round(m) + ' m'; }
  function fmtHours(h) { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return mm === 60 ? `${hh + 1}h 00m` : `${hh}h ${String(mm).padStart(2, '0')}m`; }

  function trailStats(f) {
    const dist = Geo.lineLength(f.coords);
    const gain = f.elev ? f.elev.gain : 0, loss = f.elev ? f.elev.loss : 0;
    const byCat = Routing.catDistances(Routing.runsByDistance(f));
    return { dist, gain, loss, hours: Routing.hours(byCat, gain), byCat };
  }
  function trailSummary(f) {
    const s = trailStats(f);
    return fmtDist(s.dist) + (f.elev ? ` · ↑${s.gain} m ↓${s.loss} m` : '') + ` · ~${fmtHours(s.hours)}`;
  }
  function polyArea(coords) {
    const R = 6371000, r = Math.PI / 180;
    const lat0 = coords.reduce((s, c) => s + c[0], 0) / coords.length * r;
    const p = coords.map(c => [c[1] * r * R * Math.cos(lat0), c[0] * r * R]);
    let a = 0;
    for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
    return Math.abs(a / 2);
  }
  function fmtArea(f) {
    const a = polyArea(f.coords);
    return a >= 1e6 ? (a / 1e6).toFixed(2) + ' km²' : (a / 1e4).toFixed(1) + ' ha';
  }

  /* ---------- map setup ---------- */
  function render() {
    if (map) { setTimeout(() => { map.invalidateSize(); drawGrid(); }, 0); renderList(); return; }

    map = L.map('map', { maxZoom: 19, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 120 })
      .setView(S().center, S().zoom);
    L.control.scale({ imperial: false, maxWidth: 220 }).addTo(map);
    const North = L.Control.extend({ onAdd() { const d = L.DomUtil.create('div', 'north-arrow'); d.innerHTML = '<span>▲</span>N'; return d; } });
    new North({ position: 'topright' }).addTo(map);
    const Readout = L.Control.extend({ onAdd() { readoutEl = L.DomUtil.create('div', 'coord-readout'); readoutEl.textContent = 'Point at the map for a grid reference'; return readoutEl; } });
    new Readout({ position: 'bottomleft' }).addTo(map);
    /* Zoom to a day's walk (bar above the map) */
    $('#dayZoom').addEventListener('change', e => { if (e.target.value) zoomToDay(e.target.value); });

    Parks.init(map);
    featureGroup = L.featureGroup().addTo(map);

    $('#baseSelect').innerHTML = Object.entries(BASES).map(([k, b]) => `<option value="${k}">${b.name}</option>`).join('');
    $('#baseSelect').value = S().base;
    $('#optHill').checked = !!S().hillshade;
    $('#optLabels').checked = !!S().labels;
    $('#optGrid').value = S().grid;
    $('#routeSource').innerHTML = Object.entries(Routing.SOURCES).filter(([k]) => k !== 'straight').map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    $('#routeSource').value = S().routeSource === 'nsw' ? 'nsw' : 'osm';
    for (const k of Object.keys(Parks.MIN_ZOOM)) $(`#data-${k}`).checked = !!S().data[k];
    setBase();

    map.on('click', onMapClick);
    map.on('dblclick', () => { if (draft) finishDraft(); });
    map.on('mousemove', e => {
      const { lat, lng } = e.latlng;
      readoutEl.innerHTML = `<b>${grOf(lat, lng)}</b> · ${Geo.mgaText(lat, lng)} · ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (draft && !draft.pending) drawDraft([lat, lng]);
    });
    map.on('moveend', () => {
      const c = map.getCenter();
      S().center = [+c.lat.toFixed(5), +c.lng.toFixed(5)];
      S().zoom = map.getZoom();
      Store.save();
      drawGrid();
      if (document.body.classList.contains('map-printing')) updatePrintHead();
    });
    map.on('popupopen', e => {
      const btn = e.popup.getElement()?.querySelector('[data-poi-add]');
      if (btn) btn.onclick = () => addPoi(Parks.poi(btn.dataset.poiAdd));
    });

    bindUI();
    drawAll();
    refreshCamp();
    setMode('pan');
    renderList();
    setTimeout(() => { map.invalidateSize(); drawGrid(); }, 0);
  }

  function setBase() {
    if (baseLayer) baseLayer.remove();
    const b = BASES[S().base] || BASES.topo;
    baseLayer = L.tileLayer(b.url, { ...b.opts, maxZoom: 19 }).addTo(map);
    baseLayer.bringToBack();
    if (hillLayer) { hillLayer.remove(); hillLayer = null; }
    if (S().hillshade) {
      hillLayer = L.tileLayer(HILLSHADE, { maxNativeZoom: 16, maxZoom: 19, opacity: 0.35, attribution: 'Hillshade © Esri' }).addTo(map);
    }
  }

  function bindUI() {
    $('#mapTools').addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (b) setMode(b.dataset.mode);
    });
    $('#modeOptions').addEventListener('change', e => { if (e.target.id === 'lmKind') lmKind = e.target.value; });
    $('#draftBar').addEventListener('click', e => {
      const a = e.target.closest('button')?.dataset.draft;
      if (a === 'finish') finishDraft();
      if (a === 'undo') undoPoint();
      if (a === 'cancel') { cancelDraft(); setMode('pan'); }
      if ((a === 'tracks' || a === 'straight') && draft) { draft.straight = a === 'straight'; updateDraftBar(); }
    });
    $('#baseSelect').addEventListener('change', e => { S().base = e.target.value; Store.save(); setBase(); });
    $('#optHill').addEventListener('change', e => { S().hillshade = e.target.checked; Store.save(); setBase(); });
    $('#optLabels').addEventListener('change', e => { S().labels = e.target.checked; Store.save(); drawAll(); refreshCamp(); });
    $('#optGrid').addEventListener('change', e => { S().grid = e.target.value; Store.save(); drawGrid(); });
    $('#routeSource').addEventListener('change', e => { S().routeSource = e.target.value; Store.save(); });
    $('#dataPanel').addEventListener('change', e => {
      const k = e.target.id.replace('data-', '');
      if (k in Parks.MIN_ZOOM) Parks.setEnabled(k, e.target.checked);
    });

    $('#showPanel').addEventListener('change', onShowPanel);
    $('#showPanel').addEventListener('click', e => { if (e.target.closest('button[data-show-all]')) onShowPanel(e); });
    const list = $('#featureList');
    list.addEventListener('click', onListClick);
    list.addEventListener('change', onListChange);
    $('#routePanel').addEventListener('click', onRouteClick);
    $('#routePanel').addEventListener('change', e => {
      if (e.target.id === 'stopAdd' && e.target.value) { routeStops.push(e.target.value); renderRoutePanel(); }
      if (e.target.dataset.leg !== undefined) {
        const i = +e.target.dataset.leg, key = routeStops[i] + '>' + routeStops[i + 1];
        if (e.target.value === 'straight') legStraight.add(key); else legStraight.delete(key);
        renderRoutePanel();
      }
    });

    $('#mapSearchGo').addEventListener('click', search);
    $('#mapSearch').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
    $('#mapSearchResults').addEventListener('click', e => {
      const r = e.target.closest('[data-lat]');
      if (!r) return;
      map.setView([+r.dataset.lat, +r.dataset.lon], 13);
      $('#mapSearchResults').innerHTML = '';
    });

    $('#gpxExport').addEventListener('click', exportGpx);
    $('#gpxImport').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) await importMapFile(file);
      e.target.value = '';
    });
    $('#kmlExport').addEventListener('click', exportKml);

    $('#printPreview').addEventListener('click', openPrint);
    $('#printClose').addEventListener('click', closePrint);
    $('#printNow').addEventListener('click', () => window.print());
    $('#printOrient').addEventListener('change', updatePrintSheet);
    $('#printTitleIn').addEventListener('input', updatePrintHead);
    $('#printLegendOpt').addEventListener('change', updatePrintSheet);

    document.addEventListener('keydown', e => {
      if (App.current !== 'map' || !draft || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'Enter') { e.preventDefault(); finishDraft(); }
      if (e.key === 'Escape') { cancelDraft(); setMode('pan'); }
      if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); undoPoint(); }
      if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && draft.type === 'trail') { draft.straight = !draft.straight; updateDraftBar(); }
    });
  }

  async function search() {
    const q = $('#mapSearch').value.trim();
    if (!q) return;
    const out = $('#mapSearchResults');
    out.innerHTML = '<p class="muted">Searching…</p>';
    try {
      const res = await geocode(q);
      out.innerHTML = res.length
        ? res.map(r => `<button class="result" data-lat="${r.lat}" data-lon="${r.lon}">${esc(r.name)}</button>`).join('')
        : '<p class="muted">No results in Australia.</p>';
    } catch (e) { out.innerHTML = '<p class="muted">Search failed — are you online?</p>'; }
  }

  function addPoi(p) {
    if (!p) return;
    const f = { id: uid(), type: 'landmark', kind: p.kind, name: p.name, notes: `From ${p.src}`, lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) };
    S().features.push(f);
    commit(f);
    openId = f.id;
    map.closePopup();
    renderList();
    toast(`Added “${p.name}” to your map`);
  }

  /* ---------- modes & drawing ---------- */
  function setMode(m) {
    if (!map) return;
    if (draft && m !== draft.type) cancelDraft();
    mode = m;
    $$('#mapTools button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    map.getContainer().classList.toggle('crosshair', m !== 'pan');
    if (m === 'trail' || m === 'area') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    $('#modeOptions').innerHTML = m === 'landmark'
      ? `<label class="field"><span>Landmark type</span><select id="lmKind">${kindOptions(lmKind)}</select></label>`
      : '';
    $('#drawHint').textContent = HINTS[m];
    updateDraftBar();
  }
  const isDrawing = () => mode === 'trail' || mode === 'area';
  function forwardClick(e) { onMapClick(e); }

  function kindOptions(sel) {
    return Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('');
  }

  function onMapClick(e) {
    const ll = [+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)];
    if (mode === 'landmark') {
      const f = { id: uid(), type: 'landmark', kind: lmKind, name: KINDS[lmKind].label, notes: '', lat: ll[0], lng: ll[1] };
      S().features.push(f);
      commit(f);
      openId = f.id;
      renderList();
    } else if (isDrawing()) {
      const oe = e.originalEvent || {};
      addDraftPoint(ll, !!(oe.shiftKey || oe.altKey));
    } else if (mode === 'camp') {
      setCamp(ll[0], ll[1]);
      toast('Camp location set — weather, tides & park lookup will use this point');
      setMode('pan');
    }
  }

  /* draft = { type, coords, labels (one per edge), marks (undo stack of coords.length), editId, pending,
               straight (draw the next legs as straight lines) }
     Trails follow the tracks by default; a straight leg comes from Shift/Alt-click or the Straight line switch. */
  async function addDraftPoint(ll, straightLeg = false) {
    if (!draft) draft = { type: mode, coords: [], labels: [], marks: [], editId: null, pending: false, straight: false };
    const d = draft;
    if (d.pending) return toast('Still finding the track for the last section…');
    const last = d.coords[d.coords.length - 1];
    if (last && map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(ll)) < 5) return; // double-click repeats
    d.marks.push(d.coords.length);
    const straight = d.type === 'trail' && (straightLeg || d.straight);
    const snap = d.type === 'trail' && last && !straight;
    if (!snap) {
      if (last) d.labels.push(straight ? 'off' : 'unknown');
      d.coords.push(ll);
      drawDraft();
      return;
    }
    const at = d.coords.length;
    d.coords.push(ll);
    d.labels.push('off');
    d.pending = true;
    drawDraft();
    try {
      const r = await Routing.route([last, ll], trackSource(), SNAP_TOLERANCE);
      if (draft !== d) return;
      d.coords.length = at;
      d.labels.length = at - 1;
      if (at === 1 && Geo.hav(d.coords[0], r.coords[0]) < SNAP_TOLERANCE) d.coords[0] = r.coords[0]; // snap the start too
      d.coords.push(...r.coords.slice(1));
      d.labels.push(...r.labels);
    } catch (err) {
      if (draft === d) toast('No track found there — joined with a straight (off-track) line');
    }
    d.pending = false;
    if (draft !== d) return;
    drawDraft();
    if (d.finishWhenDone) finishDraft();
  }

  function drawDraft(cursor) {
    if (draftLayer) { draftLayer.remove(); draftLayer = null; }
    if (!draft) { updateDraftBar(); return; }
    draftLayer = L.layerGroup().addTo(map);
    const style = { color: '#e8590c', weight: 3, dashArray: '6 6', interactive: false };
    const pts = draft.coords;
    if (pts.length > 1) (draft.type === 'area' && pts.length > 2 ? L.polygon(pts, { ...style, fillOpacity: 0.1 }) : L.polyline(pts, { ...style, dashArray: null, weight: 4 })).addTo(draftLayer);
    if (cursor && pts.length) L.polyline([pts[pts.length - 1], cursor], style).addTo(draftLayer);
    const marks = draft.type === 'area' ? pts.map((_, i) => i) : draft.marks.concat(pts.length ? [pts.length - 1] : []);
    [...new Set(marks)].filter(i => pts[i]).forEach(i => L.circleMarker(pts[i], { radius: 4, color: '#e8590c', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(draftLayer));
    if (!cursor) updateDraftBar();
  }

  function updateDraftBar() {
    const el = $('#draftBar');
    if (!draft) { el.innerHTML = ''; return; }
    const len = draft.type === 'trail' ? fmtDist(Geo.lineLength(draft.coords)) : (draft.coords.length > 2 ? fmtArea(draft) : '');
    el.innerHTML = `<div class="draft-info">${draft.editId ? 'Extending' : 'Drawing'} ${draft.type} ${len ? '· ' + len : ''}
        ${draft.pending ? ' · <i>following tracks…</i>' : ''}</div>
      ${draft.type === 'trail' ? `<div class="seg leg-mode" title="How the next clicks join on (press S to switch; Shift-click for a single straight leg)">
        <button class="${draft.straight ? '' : 'on'}" data-draft="tracks">〰️ Follow tracks</button><button class="${draft.straight ? 'on' : ''}" data-draft="straight">📏 Straight line</button></div>` : ''}
      <div class="btn-row">
        <button class="btn small primary" data-draft="finish">✔ Finish</button>
        <button class="btn small" data-draft="undo">↶ Undo</button>
        <button class="btn small" data-draft="cancel">✕ Cancel</button>
      </div>`;
  }

  function undoPoint() {
    if (!draft || draft.pending || !draft.marks.length) return;
    const n = draft.marks.pop();
    draft.coords.length = n;
    draft.labels.length = Math.max(0, n - 1);
    drawDraft();
  }
  function cancelDraft() { draft = null; drawDraft(); }

  function finishDraft() {
    if (!draft) return;
    if (draft.pending) { draft.finishWhenDone = true; return; }
    const c = draft.coords;
    const min = draft.type === 'area' ? 3 : 2;
    if (c.length < min) { toast(`Add at least ${min} points first`); return; }
    let f;
    if (draft.editId && feat(draft.editId)) {
      f = feat(draft.editId);
      f.coords = c;
      delete f.elev;
    } else {
      const n = S().features.filter(x => x.type === draft.type).length + 1;
      f = draft.type === 'trail'
        ? { id: uid(), type: 'trail', name: `Trail ${n}`, color: '#d9480f', style: 'solid', width: 4, notes: '', coords: c }
        : { id: uid(), type: 'area', name: `Area ${n}`, color: '#1971c2', notes: '', coords: c };
      S().features.push(f);
    }
    if (f.type === 'trail') f.ways = Routing.rle(draft.labels);
    draft = null;
    drawDraft();
    commit(f);
    openId = f.id;
    setMode('pan');
    renderList();
    if (f.type === 'trail') fetchElevation(f, true);
  }

  /* ---------- feature layers ---------- */
  function lmIcon(kind) {
    const k = KINDS[kind] || KINDS.waypoint;
    return L.divIcon({ className: 'lm-icon', html: `<span>${k.icon}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  }

  function removeLayer(id) {
    const l = layers.get(id);
    if (l) { featureGroup.removeLayer(l); layers.delete(id); }
  }

  function drawFeature(f) {
    removeLayer(f.id);
    if (isHidden(f)) return;
    let layer, labelTarget;
    if (f.type === 'landmark') {
      layer = labelTarget = L.marker([f.lat, f.lng], { icon: lmIcon(f.kind), draggable: true, riseOnHover: true });
      layer.on('dragend', () => {
        const p = layer.getLatLng();
        f.lat = +p.lat.toFixed(6); f.lng = +p.lng.toFixed(6);
        Store.save(); renderList();
      });
      layer.on('click', ev => {
        if (isDrawing()) onMapClick({ latlng: layer.getLatLng(), originalEvent: ev.originalEvent }); // snap to landmark
        else if (mode === 'pan') select(f.id);
      });
    } else if (f.type === 'trail') {
      const w = num(f.width, 4);
      const casing = L.polyline(f.coords, { color: '#fff', weight: w + 4, opacity: 0.85, interactive: false });
      const line = L.polyline(f.coords, { color: f.color, weight: w, dashArray: DASH[f.style] || null, lineCap: 'round' });
      line.on('click', () => { if (mode === 'pan') select(f.id); });
      /* straight (off-track) legs: dashed white over the line so they stand out */
      const labels = Routing.expand(f.ways, f.coords.length - 1);
      const off = [];
      if (labels) labels.forEach((l, i) => { if (String(l).startsWith('off')) off.push([f.coords[i], f.coords[i + 1]]); });
      const parts = [casing, line];
      if (off.length) parts.push(L.polyline(off, { color: '#fff', weight: Math.max(1.5, w / 2), dashArray: '4 8', interactive: false }));
      layer = L.featureGroup(parts);
      labelTarget = line;
    } else {
      layer = labelTarget = L.polygon(f.coords, { color: f.color, weight: 2, fillOpacity: 0.18, dashArray: '6 4' });
      layer.on('click', () => { if (mode === 'pan') select(f.id); });
    }
    if (S().labels && f.name) {
      labelTarget.bindTooltip(esc(f.name), {
        permanent: true, className: 'map-label',
        direction: f.type === 'landmark' ? 'right' : 'center', offset: f.type === 'landmark' ? [12, 0] : [0, 0]
      });
    }
    layer.addTo(featureGroup);
    layers.set(f.id, layer);
  }

  function drawAll() {
    featureGroup.clearLayers();
    layers.clear();
    S().features.forEach(drawFeature);
    if (vertexEditId) { const id = vertexEditId; vertexEditId = null; toggleVertices(id); }
  }

  function commit(f) { drawFeature(f); Store.save(); }

  function select(id) {
    openId = id;
    renderList();
    const el = $(`#featureList [data-id="${id}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function toggleVertices(id) {
    if (vertexLayer) { vertexLayer.remove(); vertexLayer = null; }
    if (vertexEditId === id || !feat(id)) { vertexEditId = null; renderList(); return; }
    vertexEditId = id;
    const f = feat(id);
    if (f.coords.length > 300) toast('Long routed trail — showing every point; consider “Add points” or re-routing instead');
    vertexLayer = L.layerGroup().addTo(map);
    f.coords.forEach((c, i) => {
      const m = L.marker(c, { draggable: true, icon: L.divIcon({ className: 'vertex', iconSize: [12, 12] }) }).addTo(vertexLayer);
      m.on('drag', () => { const p = m.getLatLng(); f.coords[i] = [+p.lat.toFixed(6), +p.lng.toFixed(6)]; drawFeature(f); });
      m.on('dragend', () => { delete f.elev; Store.save(); renderList(); if (f.type === 'trail') fetchElevation(f, true); });
      m.on('contextmenu', () => {
        if (f.coords.length <= (f.type === 'area' ? 3 : 2)) return toast('Too few points to delete one');
        f.coords.splice(i, 1);
        if (f.ways) { const l = Routing.expand(f.ways, f.coords.length); if (l) { l.splice(Math.max(0, i - 1), 1); f.ways = Routing.rle(l); } else delete f.ways; }
        delete f.elev;
        commit(f);
        vertexEditId = null;
        toggleVertices(id);
      });
    });
    toast('Drag points to move them. Right-click a point to delete it.');
    renderList();
  }

  /* ---------- feature list (sidebar) ---------- */
  function renderList() {
    renderRoutePanel();
    fillDayZoom();
    renderShowPanel();
    const el = $('#featureList');
    if (!el) return;
    const fs = S().features;
    if (!fs.length) {
      el.innerHTML = '<p class="muted">No features yet. Use the tools above, or turn on “Campgrounds, huts…” under Parks &amp; track data and add them from the map.</p>';
      return;
    }
    el.innerHTML = [['trail', 'Trails'], ['area', 'Areas'], ['landmark', 'Landmarks']].map(([t, label]) => {
      const list = fs.filter(f => f.type === t);
      return list.length ? `<h4>${label} (${list.length})</h4>` + list.map(featureItem).join('') : '';
    }).join('');
  }

  function featureItem(f) {
    let swatch, stats, fields = '';
    if (f.type === 'landmark') {
      swatch = `<span class="sw-icon">${(KINDS[f.kind] || KINDS.waypoint).icon}</span>`;
      stats = `${grOf(f.lat, f.lng)} · ${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}`;
      fields = `<label class="field"><span>Type</span><select data-f="kind">${kindOptions(f.kind)}</select></label>
        <p class="small muted">${Geo.mgaText(f.lat, f.lng)}</p>`;
    } else {
      swatch = `<span class="sw" style="background:${esc(f.color)}"></span>`;
      const color = `<label class="field"><span>Colour</span><input type="color" data-f="color" value="${esc(f.color)}"></label>`;
      if (f.type === 'trail') {
        const a = f.coords[0], b = f.coords[f.coords.length - 1];
        stats = trailSummary(f) + `<br>${grOf(a[0], a[1])} → ${grOf(b[0], b[1])}`;
        fields = `<div class="row">${color}
          <label class="field"><span>Line</span><select data-f="style">${Object.keys(DASH).map(s => `<option ${s === f.style ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label class="field"><span>Width</span><input type="number" min="1" max="12" data-f="width" value="${num(f.width, 4)}"></label></div>
          ${legsEditor(f)}
          ${f.elev ? profileSvg(f.elev) : ''}`;
      } else {
        stats = fmtArea(f);
        fields = color;
      }
    }
    const isLine = f.type !== 'landmark';
    return `<details class="feat" data-id="${f.id}" ${f.id === openId ? 'open' : ''}>
      <summary class="${isHidden(f) ? 'is-hidden' : ''}">${swatch}<span class="feat-name">${esc(f.name)}${isHidden(f) ? ' <span class="hid-tag" title="Hidden on the map">🙈 hidden</span>' : ''}</span><small class="muted">${stats}</small></summary>
      <div class="feat-body">
        <label class="field"><span>Name</span><input data-f="name" value="${esc(f.name)}"></label>
        ${fields}
        <label class="field"><span>Notes</span><textarea rows="2" data-f="notes">${esc(f.notes || '')}</textarea></label>
        ${f.type === 'trail' ? dayButtons(f) : ''}
        <div class="btn-row">
          ${f.type === 'trail' ? '<button class="btn small primary" data-act="traverse">🥾 Traverse</button><button class="btn small primary" data-act="plan" title="Split this trail into days — find campsites and water along it">🗓 Plan days</button>' : ''}
          <button class="btn small" data-act="zoom">🔍 Zoom</button>
          ${isLine ? `<button class="btn small" data-act="extend">➕ Add points</button>
          <button class="btn small ${vertexEditId === f.id ? 'active' : ''}" data-act="vertices">✏️ Edit points</button>` : ''}
          ${f.type === 'trail' ? `<button class="btn small" data-act="elev">⛰ Elevation</button><button class="btn small" data-act="reverse">⇄ Reverse</button>` : ''}
          ${f.type === 'landmark' ? '<button class="btn small" data-act="stop">➕ Route stop</button>' : ''}
          <button class="btn small" data-act="hide" title="${isHidden(f) ? 'Show this on the map' : 'Hide this from the map (and printouts)'}">${hiddenSet().ids.includes(f.id) ? '👁 Show on map' : isHidden(f) ? '👁 Show on map' : '🙈 Hide on map'}</button>
          <button class="btn small danger" data-act="delete">🗑 Delete</button>
        </div>
      </div>
    </details>`;
  }

  function profileSvg(e, w = 280, h = 80) {
    const p = e.profile;
    if (!p || p.length < 2) return '';
    const maxD = p[p.length - 1][0] || 1, lo = e.min, hi = Math.max(e.max, e.min + 10);
    const x = d => 30 + d / maxD * (w - 34), y = v => 6 + (1 - (v - lo) / (hi - lo)) * (h - 22);
    const line = p.map((q, i) => `${i ? 'L' : 'M'}${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join('');
    const area = `${line}L${x(maxD)},${h - 16}L${x(0)},${h - 16}Z`;
    return `<svg class="profile" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Elevation profile">
      <path d="${area}" fill="#b9dcf0" opacity=".6"/><path d="${line}" fill="none" stroke="#262661" stroke-width="1.5"/>
      <text x="2" y="${y(hi) + 4}" font-size="9">${Math.round(hi)}m</text><text x="2" y="${h - 16}" font-size="9">${Math.round(lo)}m</text>
      <text x="${w - 4}" y="${h - 3}" font-size="9" text-anchor="end">${fmtDist(maxD)}</text><text x="30" y="${h - 3}" font-size="9">0</text>
    </svg>`;
  }

  function onListClick(e) {
    const sum = e.target.closest('summary');
    if (sum) {
      const d = sum.parentElement;
      openId = d.open ? null : d.dataset.id;
      return;
    }
    const dz = e.target.closest('button[data-day-zoom]');
    if (dz) return zoomToDay(dz.dataset.dayZoom);
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const f = feat(b.closest('[data-id]').dataset.id);
    if (!f) return;
    switch (b.dataset.act) {
      case 'traverse': App.show('traverse'); Traverse.select(f.id); break;
      case 'plan': DayPlan.open(f.id); break;
      case 'zoom':
        if (f.type === 'landmark') map.setView([f.lat, f.lng], Math.max(map.getZoom(), 15));
        else map.fitBounds(L.latLngBounds(f.coords), { padding: [40, 40] });
        break;
      case 'extend': {
        const labels = Routing.expand(f.ways, f.coords.length - 1) || f.coords.slice(1).map(() => 'unknown');
        setMode(f.type);
        draft = { type: f.type, coords: f.coords.slice(), labels, marks: [], editId: f.id, pending: false, straight: false };
        drawDraft();
        break;
      }
      case 'vertices': toggleVertices(f.id); break;
      case 'hide': {
        const H = hiddenSet();
        if (isHidden(f)) {
          H.ids = H.ids.filter(x => x !== f.id);
          /* hidden because its whole group is hidden: show just this one by un-hiding the group's others individually */
          const g = groupOf(f);
          if (isHidden(f)) { H.groups = H.groups.filter(x => x !== g); S().features.filter(x => x !== f && groupOf(x) === g && !H.ids.includes(x.id)).forEach(x => H.ids.push(x.id)); }
        } else H.ids.push(f.id);
        if (vertexEditId === f.id) toggleVertices(f.id);
        Store.save(); drawAll(); renderList();
        break;
      }
      case 'elev': fetchElevation(f); break;
      case 'reverse':
        f.coords.reverse();
        if (f.ways) f.ways = f.ways.slice().reverse();
        if (f.stops) f.stops.reverse();
        if (f.legs) f.legs.reverse();
        delete f.elev; commit(f); renderList(); fetchElevation(f, true);
        break;
      case 'stop': routeStops.push(f.id); renderRoutePanel(); $('#routePanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break;
      case 'delete':
        if (!confirm(`Delete "${f.name}"?`)) return;
        if (vertexEditId === f.id) toggleVertices(f.id);
        S().features = S().features.filter(x => x.id !== f.id);
        routeStops = routeStops.filter(s => s !== f.id);
        removeLayer(f.id);
        Store.save();
        renderList();
        break;
    }
  }

  function onListChange(e) {
    if (e.target.dataset.trailLeg !== undefined) return changeTrailLeg(e.target);
    const k = e.target.dataset.f;
    if (!k) return;
    const f = feat(e.target.closest('[data-id]').dataset.id);
    f[k] = k === 'width' ? num(e.target.value, 4) : e.target.value;
    commit(f);
    renderList();
  }

  /* Profile sampled every ~30 m (up to 200 points) from Open-Meteo's 90 m DEM: [distance, elevation, lat, lng]. */
  function fetchElevation(f, quiet) {
    if (!elevBusy.has(f.id)) elevBusy.set(f.id, loadElevation(f, quiet).finally(() => elevBusy.delete(f.id)));
    return elevBusy.get(f.id);
  }

  async function loadElevation(f, quiet) {
    const len = Geo.lineLength(f.coords);
    if (!len) return;
    const pts = Geo.densify(f.coords, Math.min(len > 50000 ? 600 : 200, Math.max(2, Math.ceil(len / 30)))); // long trails get more detail
    try {
      const el = [];
      for (let i = 0; i < pts.length; i += 100) {
        const b = pts.slice(i, i + 100);
        const url = 'https://api.open-meteo.com/v1/elevation?latitude=' + b.map(p => p.lat.toFixed(5)).join(',') +
          '&longitude=' + b.map(p => p.lng.toFixed(5)).join(',');
        for (let attempt = 0; ; attempt++) { // the free API rate-limits bursts — back off and retry
          try { el.push(...(await getJSON(url)).elevation); break; }
          catch (e) { if (attempt >= 3) throw e; await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); }
        }
      }
      const sm = el.map((v, i) => (el[Math.max(0, i - 1)] + v + el[Math.min(el.length - 1, i + 1)]) / 3); // tame DEM noise
      let gain = 0, loss = 0;
      for (let i = 1; i < sm.length; i++) { const d = sm[i] - sm[i - 1]; if (d > 0) gain += d; else loss -= d; }
      f.elev = {
        v: 2,
        profile: pts.map((p, i) => [Math.round(p.d), Math.round(el[i]), +p.lat.toFixed(5), +p.lng.toFixed(5)]),
        gain: Math.round(gain), loss: Math.round(loss), min: Math.min(...el), max: Math.max(...el)
      };
      Store.save();
      renderList();
      if (App.current === 'traverse') Traverse.render();
      if (!quiet) toast(`${f.name}: ↑${f.elev.gain} m ↓${f.elev.loss} m`);
    } catch (e) {
      if (!quiet) toast('Could not fetch elevation — are you online?');
    }
  }

  /* ---------- route between campsites ---------- */
  function stopPoint(ref) {
    const t = Store.state.trip;
    if (ref === 'camp') return t.lat != null ? { ref, name: 'Camp' + (t.location ? ` (${t.location})` : ''), kind: 'campsite', lat: t.lat, lng: t.lon } : null;
    const f = feat(ref);
    return f && f.type === 'landmark' ? { ref, name: f.name, kind: f.kind, lat: f.lat, lng: f.lng } : null;
  }

  function renderRoutePanel() {
    const el = $('#routePanel');
    if (!el) return;
    routeStops = routeStops.filter(r => stopPoint(r));
    const lms = S().features.filter(f => f.type === 'landmark');
    const order = ['campsite', 'parking', 'hut'];
    lms.sort((a, b) => ((order.indexOf(a.kind) + 1 || 9) - (order.indexOf(b.kind) + 1 || 9)));
    const opts = (Store.state.trip.lat != null ? '<option value="camp">⛺ Camp (trip location)</option>' : '') +
      lms.map(f => `<option value="${f.id}">${(KINDS[f.kind] || KINDS.waypoint).icon} ${esc(f.name)}</option>`).join('');
    el.innerHTML = `
      ${routeStops.length ? `<ol class="stop-list">${routeStops.map((r, i) => {
        const p = stopPoint(r);
        const leg = i < routeStops.length - 1
          ? `<div class="leg-pick">↓ <select data-leg="${i}" title="How to get from this stop to the next">
              <option value="tracks">〰️ Follow tracks</option>
              <option value="straight" ${legStraight.has(r + '>' + routeStops[i + 1]) ? 'selected' : ''}>📏 Straight line (off-track)</option></select></div>` : '';
        return `<li><span>${(KINDS[p.kind] || KINDS.waypoint).icon} ${esc(p.name)}<small class="muted"> ${grOf(p.lat, p.lng)}</small></span>
          <span class="stop-btns">${i ? `<button class="icon-btn" data-stop-up="${i}" title="Move up">↑</button>` : ''}<button class="icon-btn" data-stop-del="${i}" title="Remove">✕</button></span>${leg}</li>`;
      }).join('')}</ol>` : '<p class="small muted">Pick the campsites / waypoints to walk between, in order.</p>'}
      ${opts ? `<select id="stopAdd"><option value="">+ add a stop…</option>${opts}</select>` : '<p class="small muted">Add campsite landmarks first.</p>'}
      <div class="btn-row" style="margin-top:6px">
        <button class="btn small" data-stops="campsites">All campsites</button>
        ${routeStops.length ? '<button class="btn small" data-stops="clear">Clear</button>' : ''}
      </div>
      ${routeStops.length > 1 ? '<p class="small muted">Each leg follows the tracks unless you choose 📏 Straight line for it.</p>' : ''}
      <button class="btn primary block" id="routeGo" ${routeStops.length < 2 ? 'disabled' : ''} style="margin-top:8px">〰️ Map trail along tracks</button>`;
  }

  async function onRouteClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.stopUp) { const i = +b.dataset.stopUp; [routeStops[i - 1], routeStops[i]] = [routeStops[i], routeStops[i - 1]]; renderRoutePanel(); }
    else if (b.dataset.stopDel) { routeStops.splice(+b.dataset.stopDel, 1); renderRoutePanel(); }
    else if (b.dataset.stops === 'clear') { routeStops = []; renderRoutePanel(); }
    else if (b.dataset.stops === 'campsites') {
      routeStops = S().features.filter(f => f.type === 'landmark' && f.kind === 'campsite').map(f => f.id);
      if (!routeStops.length) toast('No campsite landmarks yet');
      renderRoutePanel();
    } else if (b.id === 'routeGo') {
      b.disabled = true;
      b.textContent = 'Finding tracks…';
      await createRoute();
      renderRoutePanel();
    }
  }

  /* The track source to use: the chosen one (never straight — straight lines are chosen per leg). */
  function trackSource() { return S().routeSource === 'nsw' ? 'nsw' : 'osm'; }

  /* Route through points along the tracks, falling back to the next source, then a straight line. */
  async function routeTracks(pts, errs, used) {
    const tries = trackSource() === 'nsw' ? ['nsw', 'osm', 'straight'] : ['osm', 'straight'];
    for (const src of tries) {
      try { const r = await Routing.route(pts, src); used.add(src); return r; }
      catch (e) { errs.push(`${Routing.SOURCES[src]}: ${e.message}`); }
    }
  }

  /* Route through stops; legs[i] = true makes the leg from stop i to i+1 a straight (off-track) line.
     Runs of track legs are routed together so the route flows through intermediate stops. */
  async function routeLegs(pts, legs) {
    const coords = [pts[0]], labels = [], errs = [], used = new Set();
    let i = 0;
    while (i < pts.length - 1) {
      if (legs[i]) { coords.push(pts[i + 1]); labels.push('off'); used.add('straight'); i++; continue; }
      let j = i;
      while (j < pts.length - 1 && !legs[j]) j++;
      const r = await routeTracks(pts.slice(i, j + 1), errs, used);
      const join = Geo.hav(coords[coords.length - 1], r.coords[0]) < 1 ? 1 : 0;
      if (!join) labels.push('off');                       // short connector onto the track
      coords.push(...r.coords.slice(join));
      labels.push(...r.labels);
      i = j;
    }
    return { coords, labels, errs, source: used.size === 1 ? [...used][0] : 'mixed' };
  }

  async function createRoute() {
    const stops = routeStops.map(stopPoint).filter(Boolean);
    if (stops.length < 2) return;
    const legs = stops.slice(1).map((s, i) => legStraight.has(stops[i].ref + '>' + s.ref));
    const r = await routeLegs(stops.map(s => [s.lat, s.lng]), legs);
    if (r.errs.length) toast(`${r.errs.join(' · ')} — joined with a straight line where no track was found`, 6000);
    const f = {
      id: uid(), type: 'trail', name: `${stops[0].name} → ${stops[stops.length - 1].name}`, color: '#d9480f', style: 'solid', width: 4,
      notes: '', coords: r.coords, ways: Routing.rle(r.labels), source: r.source, legs,
      stops: stops.map(s => ({ ref: s.ref, name: s.name, kind: s.kind, lat: s.lat, lng: s.lng }))
    };
    S().features.push(f);
    commit(f);
    openId = f.id;
    renderList();
    map.fitBounds(L.latLngBounds(f.coords), { padding: [40, 40] });
    fetchElevation(f, true);
    toast(`Mapped ${f.name}: ${trailSummary(f)}`);
  }

  /* Trails made from stops: choose tracks or a straight line for each leg, and re-map. */
  function legsEditor(f) {
    if (!f.stops || f.stops.length < 2) return '';
    const legs = f.legs || [];
    return `<div class="trail-legs"><span class="small muted"><b>Legs</b> — choose how each leg is mapped</span>
      ${f.stops.slice(1).map((s, i) => `<label class="trail-leg"><span>${esc(f.stops[i].name)} → ${esc(s.name)}</span>
        <select data-trail-leg="${i}"><option value="tracks">〰️ Tracks</option><option value="straight" ${legs[i] ? 'selected' : ''}>📏 Straight</option></select></label>`).join('')}
    </div>`;
  }

  async function changeTrailLeg(sel) {
    const f = feat(sel.closest('[data-id]').dataset.id);
    if (!f || !f.stops) return;
    const legs = f.stops.slice(1).map((_, i) => !!(f.legs || [])[i]);
    legs[+sel.dataset.trailLeg] = sel.value === 'straight';
    if (!confirm(`Re-map “${f.name}” with this change? Any points you have moved by hand on this trail will be replaced.`)) { renderList(); return; }
    sel.disabled = true;
    toast('Re-mapping the trail…');
    /* use each stop's landmark where it is now (it may have been moved) */
    const pts = f.stops.map(st => { const p = st.ref && stopPoint(st.ref); return p ? [p.lat, p.lng] : [st.lat, st.lng]; });
    try {
      const r = await routeLegs(pts, legs);
      if (r.errs.length) toast(`${r.errs.join(' · ')} — joined with a straight line where no track was found`, 6000);
      f.coords = r.coords; f.ways = Routing.rle(r.labels); f.legs = legs; f.source = r.source;
      delete f.elev;
      commit(f);
      renderList();
      fetchElevation(f, true);
      toast(`Re-mapped ${f.name}: ${trailSummary(f)}`);
    } catch (e) { toast('Could not re-map: ' + e.message); renderList(); }
  }

  /* ---------- show / hide objects on the map ----------
     Store.state.map.hidden = { groups: ['trail' | 'area' | 'lm:<kind>'], ids: [feature ids], camp: bool }.
     Saved with the trip; also applies to the printed map and the report's maps. */
  function hiddenSet() {
    const h = S().hidden = S().hidden || {};
    h.groups = h.groups || []; h.ids = h.ids || []; h.camp = !!h.camp;
    return h;
  }
  const groupOf = f => (f.type === 'landmark' ? 'lm:' + (KINDS[f.kind] ? f.kind : 'waypoint') : f.type);
  function isHidden(f) {
    if (!f) return false;
    if (f.type === 'camp') return hiddenSet().camp;
    const h = hiddenSet();
    return h.ids.includes(f.id) || h.groups.includes(groupOf(f));
  }

  function renderShowPanel() {
    const el = $('#showPanel');
    if (!el) return;
    const fs = S().features, H = hiddenSet();
    const groups = [];
    const add = (key, icon, label, list) => { if (list.length) groups.push({ key, icon, label, n: list.length, off: H.groups.includes(key), some: list.some(f => H.ids.includes(f.id)) }); };
    add('trail', '〰️', 'Trails', fs.filter(f => f.type === 'trail'));
    add('area', '⬠', 'Areas', fs.filter(f => f.type === 'area'));
    Object.entries(KINDS).forEach(([k, v]) => add('lm:' + k, v.icon, v.label, fs.filter(f => f.type === 'landmark' && groupOf(f) === 'lm:' + k)));
    const camp = Store.state.trip.lat != null;
    const anyHidden = H.groups.length || H.ids.length || H.camp;
    el.innerHTML = !groups.length && !camp ? '<p class="small muted">Nothing on the map yet.</p>' : `
      <div class="show-list">
        ${camp ? `<label class="check"><input type="checkbox" data-show="camp" ${H.camp ? '' : 'checked'}> ⛺ Camp location</label>` : ''}
        ${groups.map(g => `<label class="check"><input type="checkbox" data-show="${g.key}" ${g.off ? '' : 'checked'}> ${g.icon} ${esc(g.label)} <small class="muted">(${g.n}${g.some && !g.off ? ', some hidden' : ''})</small></label>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn small" data-show-all="1" ${anyHidden ? '' : 'disabled'}>👁 Show all</button>
        <button class="btn small" data-show-all="0">🙈 Hide all</button>
      </div>
      <p class="hint">Hidden items stay in the plan (route card, risks, report tables) — they're just left off the map and map printouts. Hide a single item with 🙈 under Features.</p>`;
  }

  function onShowPanel(e) {
    const H = hiddenSet();
    const cb = e.target.closest('input[data-show]');
    const all = e.target.closest('button[data-show-all]');
    if (!cb && !all) return;
    if (cb) {
      const k = cb.dataset.show;
      if (k === 'camp') H.camp = !cb.checked;
      else {
        H.groups = H.groups.filter(x => x !== k);
        if (!cb.checked) H.groups.push(k);
        else H.ids = H.ids.filter(id => { const f = feat(id); return !f || groupOf(f) !== k; });   // showing a group shows all of it
      }
    } else if (all.dataset.showAll === '1') { H.groups = []; H.ids = []; H.camp = false; }
    else {
      H.groups = [...new Set(S().features.map(groupOf))];
      H.camp = true;
      if (vertexEditId) toggleVertices(vertexEditId);
    }
    Store.save();
    drawAll();
    refreshCamp();
    renderList();
  }

  /* ---------- zoom to a day's walk ---------- */
  const dayLabel = (D, many, f) => {
    const td = tripDays()[D.day - 1];
    return `${many ? esc(f.name) + ' · ' : ''}Day ${D.day}${td && td.date ? ' (' + fmtDate(td.date) + ')' : ''}: ${esc(D.from.name)} → ${esc(D.to.name)} · ${D.km.toFixed(1)} km`;
  };

  function fillDayZoom() {
    const sel = $('#dayZoom');
    if (!sel) return;
    const trails = S().features.filter(f => f.type === 'trail' && f.coords && f.coords.length > 1);
    const many = trails.length > 1;
    const groups = trails.map(f => {
      const days = Traverse.daySegments(f);
      const opts = [`<option value="${f.id}:all">${many ? esc(f.name) + ' · ' : ''}Whole route${days.length > 1 ? ` (${days.length} days)` : ''}</option>`]
        .concat(days.length > 1 ? days.map(D => `<option value="${f.id}:${D.day}">${dayLabel(D, false, f)}</option>`) : []);
      return many ? `<optgroup label="${esc(f.name)}">${opts.join('')}</optgroup>` : opts.join('');
    });
    $('#dayBar').hidden = !trails.length;
    sel.innerHTML = '<option value="">Choose a day…</option>' + groups.join('');
    sel.value = [...sel.options].some(o => o.value === dayPick) ? dayPick : '';
  }

  function dayButtons(f) {
    const days = Traverse.daySegments(f);
    if (days.length < 2) return '';
    return `<div class="day-btns"><span class="small muted">Zoom to</span>
      ${days.map(D => `<button class="btn small" data-day-zoom="${f.id}:${D.day}" title="${dayLabel(D, false, f)}">Day ${D.day}</button>`).join('')}
      <button class="btn small" data-day-zoom="${f.id}:all">All</button></div>`;
  }

  /* Fit the map to one day (or the whole trail) and highlight it. */
  function zoomToDay(value) {
    const [id, which] = String(value).split(':');
    const f = feat(id);
    if (!f) return;
    if (dayLayer) { dayLayer.remove(); dayLayer = null; }
    dayPick = value;
    const sel = $('#dayZoom');
    if (sel) sel.value = value;
    if (which === 'all') {
      map.fitBounds(L.latLngBounds(f.coords), { padding: [40, 40] });
      return;
    }
    const D = Traverse.daySegments(f).find(x => String(x.day) === which);
    if (!D) return;
    dayLayer = L.layerGroup([
      L.polyline(D.coords, { color: '#ffc82e', weight: num(f.width, 4) + 10, opacity: 0.55, interactive: false }),
      L.circleMarker(D.coords[0], { radius: 7, color: '#00664a', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false })
        .bindTooltip(`Day ${D.day} start: ${esc(D.from.name)}`, { direction: 'top' }),
      L.circleMarker(D.coords[D.coords.length - 1], { radius: 7, color: '#c92a2a', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false })
        .bindTooltip(`Day ${D.day} end: ${esc(D.to.name)}`, { direction: 'top' })
    ]).addTo(map);
    dayLayer.getLayers()[0].bringToBack();   // highlight under the trail, end markers on top
    map.fitBounds(L.latLngBounds(D.coords), { padding: [50, 50] });
    toast(`Day ${D.day}: ${D.from.name} → ${D.to.name} · ${D.km.toFixed(1)} km`);
  }

  /* ---------- camp location ---------- */
  function setCamp(lat, lon) {
    const t = Store.state.trip;
    t.lat = +lat.toFixed(5); t.lon = +lon.toFixed(5);
    Store.save();
    refreshCamp();
    App.refreshHeader();
    Trip.locationChanged();
  }

  function refreshCamp() {
    if (!map) return;
    const t = Store.state.trip;
    if (campMarker) { campMarker.remove(); campMarker = null; }
    if (t.lat == null || t.lon == null || hiddenSet().camp) return;
    campMarker = L.marker([t.lat, t.lon], {
      draggable: true, zIndexOffset: 1000,
      icon: L.divIcon({ className: 'camp-icon', html: '<span>⛺</span>', iconSize: [40, 40], iconAnchor: [20, 20] })
    }).addTo(map);
    campMarker.bindTooltip('Camp' + (t.location ? ': ' + esc(t.location) : ''), {
      permanent: !!S().labels, direction: 'top', offset: [0, -18], className: 'map-label camp-label'
    });
    campMarker.on('dragend', () => { const p = campMarker.getLatLng(); setCamp(p.lat, p.lng); });
    campMarker.on('click', () => { if (isDrawing()) onMapClick({ latlng: campMarker.getLatLng() }); });
  }

  function flyTo(lat, lon, zoom = 13) {
    if (map) map.setView([lat, lon], zoom);
    else { S().center = [lat, lon]; S().zoom = zoom; Store.save(); }
  }

  /* ---------- grids ---------- */
  function drawGrid() {
    if (gridLayer) { gridLayer.remove(); gridLayer = null; }
    gridInfo = null;
    if (!map || !S().grid || S().grid === 'none') return;
    gridLayer = L.layerGroup().addTo(map);
    if (S().grid === 'mga' && map.getCenter().lat < 0) drawMgaGrid(); else drawLatLonGrid();
  }

  const gridStyle = { color: '#1c4f8a', weight: 0.8, opacity: 0.6, interactive: false };
  const gridLabel = (ll, text, cls) => L.marker(ll, {
    interactive: false, keyboard: false, icon: L.divIcon({ className: 'grid-label ' + cls, html: text, iconSize: null })
  }).addTo(gridLayer);

  /* MGA grid like an Australian topographic map: km lines labelled with the two km digits. */
  function drawMgaGrid() {
    const b = map.getBounds(), c = map.getCenter(), zone = Geo.zoneOf(c.lng);
    const corners = [b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()].map(p => Geo.toMGA(p.lat, p.lng, zone));
    const minE = Math.min(...corners.map(m => m.E)), maxE = Math.max(...corners.map(m => m.E));
    const minN = Math.min(...corners.map(m => m.N)), maxN = Math.max(...corners.map(m => m.N));
    const span = Math.max(maxE - minE, maxN - minN);
    const step = [1000, 2000, 5000, 10000, 20000, 50000, 100000].find(s => span / s <= 14) || 100000;
    if (span / step > 40) return;
    const label = v => step < 10000 ? String(Math.floor(v / 1000) % 100).padStart(2, '0') : String(Math.floor(v / 1000));
    const topN = Geo.toMGA(b.getNorth(), c.lng, zone).N, leftE = Geo.toMGA(c.lat, b.getWest(), zone).E;
    for (let E = Math.ceil(minE / step) * step; E <= maxE; E += step) {
      const line = [];
      for (let k = 0; k <= 8; k++) line.push(Geo.fromMGA(E, minN + (maxN - minN) * k / 8, zone));
      L.polyline(line, gridStyle).addTo(gridLayer);
      gridLabel(Geo.fromMGA(E, topN, zone), label(E), 'gl-e');
    }
    for (let N = Math.ceil(minN / step) * step; N <= maxN; N += step) {
      const line = [];
      for (let k = 0; k <= 8; k++) line.push(Geo.fromMGA(minE + (maxE - minE) * k / 8, N, zone));
      L.polyline(line, gridStyle).addTo(gridLayer);
      gridLabel(Geo.fromMGA(leftE, N, zone), label(N), 'gl-n');
    }
    gridInfo = { type: 'mga', zone, step };
  }

  function drawLatLonGrid() {
    const b = map.getBounds();
    const span = Math.max(b.getEast() - b.getWest(), b.getNorth() - b.getSouth());
    const steps = [10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
    const step = steps.find(s => span / s >= 4) || steps[steps.length - 1];
    const dp = (String(step).split('.')[1] || '').length;
    for (let lat = Math.ceil(b.getSouth() / step) * step; lat <= b.getNorth(); lat += step) {
      L.polyline([[lat, b.getWest()], [lat, b.getEast()]], gridStyle).addTo(gridLayer);
      gridLabel([lat, b.getWest()], lat.toFixed(dp) + '°', 'gl-n');
    }
    for (let lon = Math.ceil(b.getWest() / step) * step; lon <= b.getEast(); lon += step) {
      L.polyline([[b.getSouth(), lon], [b.getNorth(), lon]], gridStyle).addTo(gridLayer);
      gridLabel([b.getNorth(), lon], lon.toFixed(dp) + '°', 'gl-e');
    }
    gridInfo = { type: 'latlon', step };
  }

  /* ---------- GPX ---------- */
  function exportGpx() {
    const fs = S().features, t = Store.state.trip;
    if (!fs.length && t.lat == null) return toast('Nothing to export yet');
    const x = s => esc(s);
    const desc = (notes, lat, lng) => `<desc>${x([notes, `${grOf(lat, lng)} (${Geo.mgaText(lat, lng)})`].filter(Boolean).join(' — '))}</desc>`;
    const wpts = fs.filter(f => f.type === 'landmark').map(f =>
      `  <wpt lat="${f.lat}" lon="${f.lng}"><name>${x(f.name)}</name>${desc(f.notes, f.lat, f.lng)}<type>${x((KINDS[f.kind] || {}).label || '')}</type></wpt>`);
    if (t.lat != null) wpts.unshift(`  <wpt lat="${t.lat}" lon="${t.lon}"><name>Camp${t.location ? ' – ' + x(t.location) : ''}</name>${desc('', t.lat, t.lon)}<type>Campsite</type></wpt>`);
    const trks = fs.filter(f => f.type !== 'landmark').map(f => {
      const pts = f.type === 'area' ? [...f.coords, f.coords[0]] : f.coords;
      return `  <trk><name>${x(f.name)}</name>${f.notes ? `<desc>${x(f.notes)}</desc>` : ''}<type>${f.type}</type><trkseg>\n` +
        pts.map(c => `    <trkpt lat="${c[0]}" lon="${c[1]}"/>`).join('\n') + '\n  </trkseg></trk>';
    });
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Camp Planner" xmlns="http://www.topografix.com/GPX/1/1">\n` +
      `  <metadata><name>${x(t.name)}</name></metadata>\n${wpts.join('\n')}\n${trks.join('\n')}\n</gpx>\n`;
    download(safeName(t.name) + '.gpx', gpx, 'application/gpx+xml');
  }

  function importGpx(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) return toast('That file is not valid GPX');
    const nameOf = el => el.querySelector(':scope > name')?.textContent?.trim();
    const descOf = el => el.querySelector(':scope > desc, :scope > cmt')?.textContent?.trim() || '';
    const pt = el => [+(+el.getAttribute('lat')).toFixed(6), +(+el.getAttribute('lon')).toFixed(6)];
    let added = 0;
    doc.querySelectorAll('wpt').forEach(w => {
      S().features.push({ id: uid(), type: 'landmark', kind: 'waypoint', name: nameOf(w) || 'Waypoint', notes: descOf(w), lat: pt(w)[0], lng: pt(w)[1] });
      added++;
    });
    const addLine = (el, ptsSel) => {
      let coords = Array.from(el.querySelectorAll(ptsSel)).map(pt);
      if (coords.length < 2) return;
      const stride = Math.ceil(coords.length / 1500); // keep big GPS tracks manageable
      if (stride > 1) coords = coords.filter((_, i) => i % stride === 0 || i === coords.length - 1);
      const f = { id: uid(), type: 'trail', name: nameOf(el) || 'Imported trail', color: '#7048e8', style: 'solid', width: 4, notes: descOf(el), coords };
      S().features.push(f);
      fetchElevation(f, true);
      added++;
    };
    doc.querySelectorAll('trk').forEach(t => addLine(t, 'trkpt'));
    doc.querySelectorAll('rte').forEach(r => addLine(r, 'rtept'));
    if (!added) return toast('No waypoints or tracks found in that file');
    Store.save();
    drawAll();
    renderList();
    if (featureGroup.getLayers().length) map.fitBounds(featureGroup.getBounds(), { padding: [30, 30] });
    toast(`Imported ${added} feature(s)`);
  }

  /* ---------- Avenza Maps (and other map apps): KML out; KML / KMZ / GPX / CSV in ----------
     Out: the trip's landmarks, trails and areas as a KML layer Avenza can import onto any map.
     In: placemarks, tracks and areas exported from Avenza. Features already on the map (same kind of thing, same
     name, within 30 m) are skipped, so a layer can go out, be added to in the field, and come back without doubling up. */
  const kmlColor = (hex, alpha = 'ff') => { const h = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex.slice(1) : 'c92a2a'; return (alpha + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)).toLowerCase(); };

  function exportKml() {
    const fs = S().features, t = Store.state.trip;
    if (!fs.length && t.lat == null) return toast('Nothing to export yet');
    const x = s => esc(s);
    const where = (lat, lng) => `${grOf(lat, lng)} · ${Geo.mgaText(lat, lng)}`;
    const pm = (name, lines, geom, style = '') => `    <Placemark><name>${x(name)}</name><description>${x(lines.filter(Boolean).join('\n'))}</description>${style}${geom}</Placemark>`;
    const ring = c => c.map(p => `${p[1]},${p[0]},0`).join(' ');
    const marks = fs.filter(f => f.type === 'landmark').map(f => pm(f.name, [`Type: ${(KINDS[f.kind] || KINDS.waypoint).label}`, f.notes, where(f.lat, f.lng)], `<Point><coordinates>${f.lng},${f.lat},0</coordinates></Point>`));
    if (t.lat != null) marks.unshift(pm('Camp' + (t.location ? ' – ' + t.location : ''), ['Type: Campsite', where(t.lat, t.lon)], `<Point><coordinates>${t.lon},${t.lat},0</coordinates></Point>`));
    const trails = fs.filter(f => f.type === 'trail').map(f => pm(f.name, [f.notes, `${(Geo.lineLength(f.coords) / 1000).toFixed(1)} km`],
      `<LineString><tessellate>1</tessellate><coordinates>${ring(f.coords)}</coordinates></LineString>`, `<Style><LineStyle><color>${kmlColor(f.color)}</color><width>${f.width || 4}</width></LineStyle></Style>`));
    const areas = fs.filter(f => f.type === 'area').map(f => pm(f.name, [f.notes],
      `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring([...f.coords, f.coords[0]])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`,
      `<Style><LineStyle><color>${kmlColor(f.color)}</color><width>2</width></LineStyle><PolyStyle><color>${kmlColor(f.color, '40')}</color></PolyStyle></Style>`));
    const folder = (name, list) => (list.length ? `  <Folder><name>${name}</name>\n${list.join('\n')}\n  </Folder>\n` : '');
    const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document><name>${x(t.name)}</name>\n` +
      folder('Landmarks', marks) + folder('Trails', trails) + folder('Areas', areas) + '</Document>\n</kml>\n';
    download(safeName(t.name) + '-avenza.kml', kml, 'application/vnd.google-earth.kml+xml');
    toast('Saved. In Avenza Maps open your map, then Map Features (layers) → Import, and choose this file.', 7000);
  }

  /* The first .kml inside a .kmz (a zip file) */
  async function kmlFromKmz(buf) {
    const v = new DataView(buf), u8 = new Uint8Array(buf);
    let e = buf.byteLength - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;              // end of central directory
    if (e < 0) throw new Error('That KMZ file can\'t be read');
    let p = v.getUint32(e + 16, true);
    for (let n = v.getUint16(e + 10, true); n > 0; n--) {
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      if (/\.kml$/i.test(name)) {
        const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true), data = u8.subarray(start, start + size);
        if (method === 0) return new TextDecoder().decode(data);
        if (method !== 8 || !('DecompressionStream' in window)) throw new Error('This browser can\'t open KMZ files — export KML or GPX from Avenza instead');
        return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      }
      p += 46 + nameLen + extra + comment;
    }
    throw new Error('No map features found in that KMZ file');
  }

  /* What kind of landmark is this? Our own exports say ("Type: Campsite"); otherwise go by the words in the name. */
  function kindFor(name, desc) {
    const m = /^Type:\s*(.+)$/m.exec(desc || '');
    if (m) { const k = Object.keys(KINDS).find(key => KINDS[key].label.toLowerCase() === m[1].trim().toLowerCase()); if (k) return k; }
    const n = (name || '').toLowerCase();
    const words = [['campsite', /camp/], ['water', /water|tank|spring|tap\b/], ['danger', /hazard|danger|cliff|caution/], ['crossing', /crossing|ford/], ['parking', /car ?park|trailhead|parking/],
      ['lookout', /lookout|view/], ['hut', /hut|shelter/], ['summit', /summit|peak|\bmt\b|mount /], ['toilet', /toilet/], ['junction', /junction|turn ?off/], ['evac', /evac|egress|exit point/], ['bridge', /bridge/]];
    return (words.find(([, re]) => re.test(n)) || ['waypoint'])[0];
  }

  function parseKml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('That file is not valid KML');
    const all = (el, tag) => [...el.getElementsByTagNameNS('*', tag)];
    const txt = (el, tag) => { const c = [...el.children].find(k => k.localName === tag); return c ? c.textContent.trim() : ''; };
    const clean = s => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
    const coords = el => el.textContent.trim().split(/\s+/).map(c => c.split(',').map(Number)).filter(c => c.length >= 2 && isFinite(c[0]) && isFinite(c[1])).map(c => [+c[1].toFixed(6), +c[0].toFixed(6)]);
    const out = { points: [], lines: [], areas: [] };
    all(doc, 'Placemark').forEach(pm => {
      const name = txt(pm, 'name'), desc = clean(txt(pm, 'description'));
      all(pm, 'Point').forEach(g => { const c = coords(all(g, 'coordinates')[0] || g)[0]; if (c) out.points.push({ name, desc, lat: c[0], lng: c[1] }); });
      all(pm, 'LineString').forEach(g => { const c = coords(all(g, 'coordinates')[0] || g); if (c.length > 1) out.lines.push({ name, desc, coords: c }); });
      all(pm, 'Track').forEach(g => {                                     // recorded tracks (gx:Track)
        const c = all(g, 'coord').map(k => k.textContent.trim().split(/\s+/).map(Number)).filter(k => isFinite(k[0]) && isFinite(k[1])).map(k => [+k[1].toFixed(6), +k[0].toFixed(6)]);
        if (c.length > 1) out.lines.push({ name, desc, coords: c });
      });
      all(pm, 'Polygon').forEach(g => { const o = all(g, 'outerBoundaryIs')[0]; const c = o ? coords(all(o, 'coordinates')[0]) : []; if (c.length > 3) out.areas.push({ name, desc, coords: c.slice(0, -1) }); });
    });
    return out;
  }

  /* Points from a CSV (Avenza's placemark export, or any sheet with name / latitude / longitude columns) */
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim())) rows.push(row); row = []; }
      else cell += ch;
    }
    row.push(cell); if (row.some(c => c.trim())) rows.push(row);
    if (rows.length < 2) throw new Error('That CSV file has no rows');
    const head = rows[0].map(h => h.trim().toLowerCase());
    const col = (...names) => head.findIndex(h => names.some(n => h === n || h.startsWith(n)));
    const la = col('latitude', 'lat'), lo = col('longitude', 'lon', 'lng'), nm = col('title', 'name', 'label'), ds = col('description', 'desc', 'notes', 'comment');
    if (la < 0 || lo < 0) throw new Error('That CSV needs Latitude and Longitude columns');
    const points = rows.slice(1).map(r => ({ name: (nm >= 0 ? r[nm] : '').trim(), desc: (ds >= 0 ? r[ds] || '' : '').trim(), lat: +r[la], lng: +r[lo] }))
      .filter(p => isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) <= 90 && (p.lat || p.lng));
    return { points, lines: [], areas: [] };
  }

  /* Add imported things to the map, skipping ones already there */
  function addImported(data, label) {
    const fs = S().features;
    let added = 0, skipped = 0;
    const same = (type, name, at) => fs.some(f => f.type === type && (f.name || '').toLowerCase() === (name || '').toLowerCase()
      && Geo.hav(type === 'landmark' ? [f.lat, f.lng] : f.coords[0], at) < 30);
    data.points.forEach(p => {
      const name = p.name || 'Waypoint', camp = Store.state.trip;
      if (same('landmark', name, [p.lat, p.lng])) return skipped++;
      if (camp.lat != null && /^camp\b/i.test(name) && Geo.hav([camp.lat, camp.lon], [p.lat, p.lng]) < 30) return skipped++;   // the trip's own camp pin
      const notes = (p.desc || '').split('\n').filter(l => !/^Type:|^GR \d{3}/.test(l.trim())).join('\n').trim();
      fs.push({ id: uid(), type: 'landmark', kind: kindFor(name, p.desc), name, notes, lat: +(+p.lat).toFixed(6), lng: +(+p.lng).toFixed(6) });
      added++;
    });
    data.lines.forEach(l => {
      const name = l.name || 'Imported trail';
      if (same('trail', name, l.coords[0])) return skipped++;
      let coords = l.coords;
      const stride = Math.ceil(coords.length / 1500);                   // keep big GPS tracks manageable
      if (stride > 1) coords = coords.filter((_, i) => i % stride === 0 || i === coords.length - 1);
      const f = { id: uid(), type: 'trail', name, color: '#7048e8', style: 'solid', width: 4, notes: (l.desc || '').replace(/^[\d.]+ km$/m, '').trim(), coords };
      fs.push(f); fetchElevation(f, true); added++;
    });
    data.areas.forEach(a => {
      const name = a.name || 'Imported area';
      if (same('area', name, a.coords[0])) return skipped++;
      fs.push({ id: uid(), type: 'area', name, color: '#2f9e44', notes: a.desc || '', coords: a.coords });
      added++;
    });
    if (!added) return toast(skipped ? `Nothing new — all ${skipped} feature(s) in that file are already on the map` : `No placemarks, tracks or areas found in that ${label} file`);
    Store.save();
    drawAll();
    renderList();
    if (featureGroup.getLayers().length) map.fitBounds(featureGroup.getBounds(), { padding: [30, 30] });
    toast(`Imported ${added} feature(s)${skipped ? ` · ${skipped} already on the map were skipped` : ''}`, 5000);
  }

  async function importMapFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    try {
      if (ext === 'gpx') return importGpx(await readFile(file));
      if (ext === 'kmz') return addImported(parseKml(await kmlFromKmz(await file.arrayBuffer())), 'KMZ');
      if (ext === 'kml') return addImported(parseKml(await readFile(file)), 'KML');
      if (ext === 'csv') return addImported(parseCsv(await readFile(file)), 'CSV');
      toast('Choose a KML, KMZ, GPX or CSV file');
    } catch (e) { toast(e.message, 6000); }
  }

  /* ---------- printing ---------- */
  function openPrint() {
    App.show('map');
    setMode('pan');
    document.body.classList.add('map-printing');
    $('#printBar').hidden = false;
    if (!$('#printTitleIn').value) $('#printTitleIn').value = Store.state.trip.name;
    updatePrintSheet();
  }

  function closePrint() {
    document.body.classList.remove('map-printing');
    $('#printBar').hidden = true;
    $('#pageStyle').textContent = '';
    setTimeout(() => { map.invalidateSize(); drawGrid(); }, 50);
  }

  function updatePrintSheet() {
    const o = $('#printOrient').value;
    const sheet = $('#printSheet');
    sheet.classList.toggle('landscape', o === 'landscape');
    sheet.classList.toggle('portrait', o === 'portrait');
    $('#pageStyle').textContent = `@page { size: A4 ${o}; margin: 10mm; }`;
    $('#printLegend').classList.toggle('show', $('#printLegendOpt').checked);
    $('#printLegend').innerHTML = legendHtml();
    setTimeout(() => { map.invalidateSize(); drawGrid(); updatePrintHead(); }, 50);
  }

  function updatePrintHead() {
    const t = Store.state.trip;
    $('#printTitle').textContent = $('#printTitleIn').value || t.name;
    const s = parseDate(t.start), e = parseDate(t.end);
    const c = map.getCenter();
    const decl = Geo.declination(c.lat, c.lng), gma = decl - Geo.convergence(c.lat, c.lng);
    $('#printSub').innerHTML = [
      s ? fmtDate(s, { day: 'numeric', month: 'short', year: 'numeric' }) + (e && +e !== +s ? ' – ' + fmtDate(e, { day: 'numeric', month: 'short', year: 'numeric' }) : '') : '',
      esc(t.park ? `${t.park.name} ${t.park.type}` : t.location),
      t.lat != null ? `Camp ${grOf(t.lat, t.lon)}` : '',
      'Emergency 000'
    ].filter(Boolean).join(' · ');
    const grid = gridInfo?.type === 'mga'
      ? `MGA2020 Zone ${gridInfo.zone} · ${gridInfo.step / 1000} km grid`
      : gridInfo?.type === 'latlon' ? `Lat/lon grid ${gridInfo.step}°` : `MGA Zone ${Geo.zoneOf(c.lng)}`;
    $('#printBounds').innerHTML = `${grid}<br>Grid magnetic angle ≈ ${Geo.fmtDecl(gma)}<br>Magnetic declination ≈ ${Geo.fmtDecl(decl)}<br><small>GR = 6-figure grid reference (easting, northing)</small>`;
  }

  function legendHtml() {
    const fs = S().features, t = Store.state.trip;
    const shown = fs.filter(f => !isHidden(f));
    const trails = shown.filter(f => f.type === 'trail'), areas = shown.filter(f => f.type === 'area'), lms = shown.filter(f => f.type === 'landmark');
    let h = `<h2>${esc(t.name)} — map legend</h2>`;
    if (t.lat != null && !hiddenSet().camp) h += `<p><b>⛺ Camp:</b> ${esc(t.location || '')} — <b>${grOf(t.lat, t.lon)}</b> · ${Geo.mgaText(t.lat, t.lon)} · ${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}${t.park ? ` · in ${esc(t.park.name)} ${esc(t.park.type)}` : ''}</p>`;
    if (trails.length) {
      h += `<h3>Trails</h3><table class="tbl"><thead><tr><th></th><th>Name</th><th>Start → finish</th><th>Distance</th><th>Ascent / descent</th><th>Est. time*</th><th>Notes</th></tr></thead><tbody>` +
        trails.map(f => {
          const s = trailStats(f), a = f.coords[0], b = f.coords[f.coords.length - 1];
          return `<tr><td><span class="sw line" style="border-color:${esc(f.color)};border-top-style:${f.style === 'solid' ? 'solid' : f.style}"></span></td><td><b>${esc(f.name)}</b>${f.elev ? profileSvg(f.elev, 220, 60) : ''}</td>
            <td>${grOf(a[0], a[1])} → ${grOf(b[0], b[1])}</td><td>${fmtDist(s.dist)}</td>
            <td>${f.elev ? `↑${s.gain} m ↓${s.loss} m<br><small>${Math.round(f.elev.min)}–${Math.round(f.elev.max)} m</small>` : '—'}</td><td>${fmtHours(s.hours)}</td><td>${esc(f.notes || '')}</td></tr>`;
        }).join('') + `</tbody></table><p class="muted small">*4 km/h on walking tracks, 4.5 km/h fire trails, 2 km/h off-track, plus 1 hour per 600 m of climb. See the Traverse tab for a full route card.</p>`;
    }
    if (lms.length) {
      h += `<h3>Landmarks</h3><table class="tbl"><thead><tr><th></th><th>Name</th><th>Type</th><th>Grid ref</th><th>MGA2020</th><th>Lat, Lon</th><th>Notes</th></tr></thead><tbody>` +
        lms.map(f => `<tr><td class="lg-icon">${(KINDS[f.kind] || KINDS.waypoint).icon}</td><td><b>${esc(f.name)}</b></td><td>${(KINDS[f.kind] || KINDS.waypoint).label}</td>
          <td><b>${grOf(f.lat, f.lng)}</b></td><td>${Geo.mgaText(f.lat, f.lng)}</td><td>${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}</td><td>${esc(f.notes || '')}</td></tr>`).join('') + '</tbody></table>';
    }
    if (areas.length) {
      h += `<h3>Areas</h3><table class="tbl"><thead><tr><th></th><th>Name</th><th>Size</th><th>Notes</th></tr></thead><tbody>` +
        areas.map(f => `<tr><td><span class="sw" style="background:${esc(f.color)}"></span></td><td><b>${esc(f.name)}</b></td><td>${fmtArea(f)}</td><td>${esc(f.notes || '')}</td></tr>`).join('') + '</tbody></table>';
    }
    if (!fs.length) h += '<p class="muted">No trails or landmarks added.</p>';
    h += `<p class="muted small">Grid references are six-figure MGA2020 references (easting then northing, 100 m precision), compatible with Australian topographic maps. Magnetic values are estimates — confirm with the GMA on your printed topo map.</p>`;
    return h;
  }

  return {
    render, setMode, refreshCamp, flyTo, openPrint, fetchElevation, isDrawing, forwardClick, zoomToDay, isHidden,
    KINDS, BASES, trailStats, fmtDist, fmtHours, profileSvg, fmtArea,
    getMap: () => map,
    /* redraw features after another tab changed them (e.g. a landmark's type) */
    redraw() { if (map) { drawAll(); renderList(); } }
  };
})();
