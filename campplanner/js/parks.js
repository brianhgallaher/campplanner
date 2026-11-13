/* Camp Planner — national parks & track data overlays.
   - Protected areas: CAPAD (Collaborative Australian Protected Areas Database), all states.
   - Official tracks & fire trails: NSW Spatial Services topographic road network.
   - Campgrounds, huts, lookouts, water: NSW Spatial Services points of interest + OpenStreetMap (Overpass). */

const Parks = (() => {
  const CAPAD = 'https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/CAPAD/MapServer/0/query';
  const NSW = 'https://portal.spatial.nsw.gov.au/server/rest/services';
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const MIN_ZOOM = { parks: 7, tracks: 12, pois: 10 };

  let map, timer;
  const groups = {}, lastKey = {}, poiStore = new Map();
  const D = () => Store.state.map.data;

  function init(m) {
    map = m;
    for (const k of Object.keys(MIN_ZOOM)) groups[k] = L.layerGroup();
    groups.parks.addTo(map); // below user features
    groups.tracks.addTo(map);
    groups.pois.addTo(map);
    map.on('moveend', schedule);
    schedule();
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 350); }

  function setEnabled(k, on) {
    D()[k] = on;
    Store.save();
    if (!on) { groups[k].clearLayers(); lastKey[k] = null; }
    refresh();
  }

  function status(k, text) {
    const el = $(`#dataStatus-${k}`);
    if (el) el.textContent = text;
  }

  async function refresh() {
    if (!map) return;
    const z = map.getZoom(), b = map.getBounds();
    for (const k of Object.keys(MIN_ZOOM)) {
      if (!D()[k]) { status(k, ''); continue; }
      if (z < MIN_ZOOM[k]) { groups[k].clearLayers(); lastKey[k] = null; status(k, `zoom in to see (level ${MIN_ZOOM[k]}+)`); continue; }
      const key = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => v.toFixed(3)).join(',') + '@' + Math.round(z);
      if (key === lastKey[k]) continue;
      lastKey[k] = key;
      status(k, 'loading…');
      try {
        const n = await ({ parks: loadParks, tracks: loadTracks, pois: loadPois })[k](b, z);
        if (lastKey[k] === key) status(k, n ? `${n} shown` : 'none in view');
      } catch (e) {
        if (lastKey[k] === key) status(k, 'unavailable — ' + e.message);
        lastKey[k] = null;
      }
    }
  }

  const env = b => `geometry=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects`;

  /* ---------- protected areas ---------- */
  async function loadParks(b, z) {
    const tol = (360 / (256 * 2 ** z)).toFixed(6); // ~1 pixel simplification
    const j = await getJSON(`${CAPAD}?where=1%3D1&${env(b)}&outFields=NAME,TYPE,STATE,AUTHORITY&maxAllowableOffset=${tol}&geometryPrecision=5&resultRecordCount=400&f=geojson`);
    groups.parks.clearLayers();
    L.geoJSON(j, {
      style: { color: '#2b8a3e', weight: 1.5, fillColor: '#8ce99a', fillOpacity: 0.15, dashArray: '5 4' },
      interactive: true,
      onEachFeature: (f, l) => {
        l.bindTooltip(`<b>${esc(f.properties.NAME)}</b><br>${esc(f.properties.TYPE)} · ${esc(f.properties.STATE)}`, { sticky: true });
      }
    }).addTo(groups.parks);
    return j.features.length;
  }

  /* ---------- NSW official tracks ---------- */
  async function loadTracks(b) {
    const j = await getJSON(`${NSW}/NSW_Transport_Theme/FeatureServer/5/query?where=functionhierarchy+IN+(8,9,11)&${env(b)}` +
      '&outFields=roadnamebase,roadnametype,functionhierarchy,surface&geometryPrecision=6&resultRecordCount=2000&f=geojson');
    groups.tracks.clearLayers();
    L.geoJSON(j, {
      style: f => f.properties.functionhierarchy === 8
        ? { color: '#8b4513', weight: 2.5, opacity: 0.8, dashArray: '8 4' }
        : { color: '#c2255c', weight: 2.5, opacity: 0.85, dashArray: '2 5' },
      onEachFeature: (f, l) => {
        const p = f.properties;
        const name = p.roadnamebase ? [p.roadnamebase, p.roadnametype].filter(Boolean).join(' ') : 'Unnamed';
        l.bindTooltip(`<b>${esc(name)}</b><br>${p.functionhierarchy === 8 ? 'Vehicular track / fire trail' : 'Walking track'} (NSW official)`, { sticky: true });
      }
    }).addTo(groups.tracks);
    return j.features.length;
  }

  /* ---------- points of interest ---------- */
  function kindFromName(n) {
    const s = n.toUpperCase();
    if (/CAMP/.test(s)) return 'campsite';
    if (/LOOKOUT|VIEWPOINT/.test(s)) return 'lookout';
    if (/HUT|SHELTER/.test(s)) return 'hut';
    if (/PICNIC/.test(s)) return 'picnic';
    if (/WATER|TANK|SPRING/.test(s)) return 'water';
    return 'info';
  }
  function kindFromOsm(t) {
    if (t.tourism === 'camp_site') return 'campsite';
    if (t.tourism === 'alpine_hut' || t.tourism === 'wilderness_hut' || t.amenity === 'shelter') return 'hut';
    if (t.tourism === 'viewpoint') return 'lookout';
    if (t.amenity === 'drinking_water' || t.natural === 'spring' || t.amenity === 'water_point') return 'water';
    if (t.natural === 'peak') return 'summit';
    if (t.tourism === 'picnic_site') return 'picnic';
    if (t.amenity === 'toilets') return 'toilet';
    return 'info';
  }
  const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  /* Overpass servers are often busy: ask several mirrors at once, take the first answer, give up after a while. */
  async function overpass(q, ms = 30000) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
    const ask = url => fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('OpenStreetMap busy (' + r.status + ')')));
    try {
      return await Promise.any(OVERPASS.map(ask));
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'OpenStreetMap timed out' : 'OpenStreetMap unavailable');
    } finally { clearTimeout(to); ctl.abort(); }
  }

  /* Draws NSW official points as soon as they arrive, then merges in OpenStreetMap points. */
  async function loadPois(b, z) {
    const key = lastKey.pois;
    const found = [];
    const draw = list => {
      if (lastKey.pois !== key) return;
      for (const p of list) if (!found.some(q => q.kind === p.kind && Geo.hav([q.lat, q.lng], [p.lat, p.lng]) < 150)) found.push(p);
      drawPois(found);
      status('pois', `${found.length} shown${pending ? ' · loading OpenStreetMap…' : ''}`);
    };
    let pending = true;
    const tasks = [];
    if (b.getEast() > 140.9 && b.getWest() < 153.7 && b.getNorth() > -37.6 && b.getSouth() < -28.1) {
      tasks.push(getJSON(`${NSW}/NSW_Features_of_Interest_Category/FeatureServer/2/query?where=classsubtype%3D1&${env(b)}` +
        '&outFields=generalname&geometryPrecision=6&resultRecordCount=1000&f=geojson').then(j => j.features
        .filter(f => f.properties.generalname && f.geometry)
        .map(f => ({ name: titleCase(f.properties.generalname), kind: kindFromName(f.properties.generalname), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], src: 'NSW Spatial Services' })))
        .then(draw));
    }
    const bb = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
    const extra = z >= 13 ? `nwr["amenity"="toilets"](${bb});` : '';
    const q = `[out:json][timeout:20];(nwr["tourism"~"^(camp_site|alpine_hut|wilderness_hut|viewpoint|picnic_site)$"](${bb});` +
      `nwr["amenity"~"^(drinking_water|shelter|water_point)$"](${bb});node["natural"="spring"](${bb});node["natural"="peak"]["name"](${bb});${extra});out center 400;`;
    tasks.push(overpass(q).then(j => j.elements.map(e => {
      const t = e.tags || {}, kind = kindFromOsm(t);
      const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
      const label = (MapView.KINDS[kind] || {}).label || 'Point';
      return { name: t.name || label, kind, lat, lng, src: 'OpenStreetMap', ele: t.ele };
    }).filter(p => p.lat != null)).then(list => (tasks.length > 1 ? tasks[0].catch(() => {}) : Promise.resolve()).then(() => draw(list))));
    const results = await Promise.allSettled(tasks);
    pending = false;
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
    if (!found.length && failed.length) throw new Error(failed.join('; '));
    draw([]);
    if (failed.length && lastKey.pois === key) status('pois', `${found.length} shown · ${failed.join('; ')}`);
    return found.length;
  }

  function drawPois(pois) {
    groups.pois.clearLayers();
    poiStore.clear();
    pois.forEach((p, i) => {
      const k = MapView.KINDS[p.kind] || MapView.KINDS.info;
      poiStore.set(String(i), p);
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: 'poi-icon', html: `<span>${k.icon}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] })
      }).bindPopup(() => `<b>${esc(p.name)}</b><br><small>${k.label}${p.ele ? ` · ${esc(p.ele)} m` : ''}<br>${Geo.grText(p.lat, p.lng)} · ${Geo.mgaText(p.lat, p.lng)}<br>Source: ${p.src}</small>
          <br><button class="btn small primary" data-poi-add="${i}">+ Add to my map</button>`)
        .on('click', e => { if (MapView.isDrawing()) { e.target.closePopup(); MapView.forwardClick(e); } })
        .addTo(groups.pois);
    });
  }

  function poi(i) { return poiStore.get(String(i)); }

  /* ---------- lookups ---------- */
  async function parkAt(lat, lon) {
    const j = await getJSON(`${CAPAD}?where=1%3D1&geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=NAME,TYPE,STATE&returnGeometry=false&f=json`);
    const a = (j.features || [])[0]?.attributes;
    return a ? { name: a.NAME, type: a.TYPE, state: a.STATE } : null;
  }

  /* Protected areas a trail passes through (POST: the line can be long). */
  async function parksAlong(coords) {
    const step = Math.max(1, Math.ceil(coords.length / 300));
    const path = coords.filter((_, i) => i % step === 0 || i === coords.length - 1).map(c => [c[1], c[0]]);
    const body = new URLSearchParams({
      where: '1=1', geometry: JSON.stringify({ paths: [path], spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPolyline',
      inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'NAME,TYPE,STATE', returnGeometry: 'false', f: 'json'
    });
    const r = await fetch(CAPAD, { method: 'POST', body });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    const seen = new Set();
    return (j.features || []).map(f => f.attributes).filter(a => !seen.has(a.NAME + a.TYPE) && seen.add(a.NAME + a.TYPE));
  }

  /* Nearest hospital / police station for the emergency plan: NSW official facilities inside NSW, else OpenStreetMap. */
  const NSW_FACILITY = {
    hospital: 'NSW_FOI_Health_Facilities/FeatureServer/1', police: 'NSW_FOI_Emergency_Service_Facilities/FeatureServer/1'
  };
  const OSM_FACILITY = { hospital: '["amenity"="hospital"]', police: '["amenity"="police"]' };

  async function nearest(lat, lon, what) {
    const inNsw = lon > 140.9 && lon < 153.7 && lat > -37.6 && lat < -28.1;
    if (inNsw) {
      try {
        for (const km of [50, 200]) {
          const j = await getJSON(`${NSW}/${NSW_FACILITY[what]}/query?where=1%3D1&geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326` +
            `&distance=${km * 1000}&units=esriSRUnit_Meter&outFields=generalname&outSR=4326&f=geojson`);
          const list = j.features.filter(f => f.geometry).map(f => {
            const [lng, la] = f.geometry.type === 'Point' ? f.geometry.coordinates : f.geometry.coordinates.flat(3).slice(0, 2);
            return { name: titleCase(f.properties.generalname || what), tags: {}, lat: la, lng, src: 'NSW Spatial Services' };
          });
          if (list.length) return list.map(p => ({ ...p, km: Geo.hav([lat, lon], [p.lat, p.lng]) / 1000 })).sort((a, b) => a.km - b.km);
        }
      } catch (e) { /* fall through to OpenStreetMap */ }
    }
    return nearestOsm(lat, lon, OSM_FACILITY[what]);
  }

  async function nearestOsm(lat, lon, filter) {
    let j;
    for (const km of [40, 150]) { // small search first — big radius queries are slow
      j = await overpass(`[out:json][timeout:40];nwr${filter}(around:${km * 1000},${lat},${lon});out center 60;`, 45000);
      if (j.elements.length) break;
    }
    return j.elements.map(e => ({
      name: e.tags?.name || 'Unnamed', tags: e.tags || {}, src: 'OpenStreetMap',
      lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon
    })).filter(p => p.lat != null).map(p => ({ ...p, km: Geo.hav([lat, lon], [p.lat, p.lng]) / 1000 })).sort((a, b) => a.km - b.km);
  }

  return { init, setEnabled, refresh, poi, parkAt, parksAlong, nearest, overpass, MIN_ZOOM };
})();
