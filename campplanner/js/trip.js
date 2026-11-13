/* Camp Planner — trip details, people, location and backups */

const Trip = (() => {
  let bound = false;
  const root = () => $('#tab-trip');

  function render() {
    if (!bound) bind();
    const t = Store.state.trip, people = Store.state.people, home = Store.state.travel.home;
    const days = tripDays();
    root().innerHTML = `
      <div class="page-head"><h2>Trip details</h2></div>
      ${Publish.card()}
      <div class="grid2">
        <div class="card">
          <h3>Basics</h3>
          <div class="row">
            <label class="field grow"><span>Trip name</span><input data-trip="name" value="${esc(t.name)}"></label>
            <label class="field"><span>Status</span><select data-trip="status">${Object.entries(Trips.STATUS).map(([k, v]) => `<option value="${k}" ${(t.status || 'planning') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
          </div>
          <div class="row">
            <label class="field"><span>Start date</span><input type="date" data-trip="start" value="${esc(t.start)}"></label>
            <label class="field"><span>End date</span><input type="date" data-trip="end" value="${esc(t.end)}"></label>
            <label class="field" title="When the group starts walking on day 1 — the Travel tab works out when each car leaves home"><span>Start walking at</span><input type="time" data-trip="startTime" value="${esc(t.startTime || '')}"></label>
          </div>
          <p class="muted">${days.length} day${days.length > 1 ? 's' : ''}, ${days.length - 1} night${days.length === 2 ? '' : 's'}</p>
          <label class="field"><span>Notes / trip intentions (route, planned campsites, return time)</span>
            <textarea rows="5" data-trip="notes">${esc(t.notes)}</textarea></label>
        </div>
        <div class="card">
          <h3>Camp location</h3>
          <div class="row no-print">
            <input id="locSearch" placeholder="Search a place, park, campground or town…">
            <button class="btn" id="locGo">Search</button>
          </div>
          <div id="locResults" class="results no-print"></div>
          <label class="field"><span>Location name</span><input data-trip="location" value="${esc(t.location)}"></label>
          <div class="row">
            <label class="field"><span>Latitude</span><input type="number" step="any" data-trip="lat" value="${t.lat ?? ''}"></label>
            <label class="field"><span>Longitude</span><input type="number" step="any" data-trip="lon" value="${t.lon ?? ''}"></label>
          </div>
          <div id="locInfo" class="loc-info">${locInfo()}</div>
          <div class="btn-row no-print"><button class="btn" id="pickOnMap">⛺ Pick on map</button></div>
          <label class="check"><input type="checkbox" data-trip="coastal" ${t.coastal ? 'checked' : ''}> Coastal camp — show tides in Weather</label>
          <p class="muted small" id="coastalHint"></p>
        </div>
      </div>

      <div class="card">
        <h3>🏠 Home location <small class="muted">(setting — used for travel distances, fuel and the travel plan)</small></h3>
        <div class="grid2 tight">
          <div>
            <div class="row no-print">
              <input id="homeSearch" placeholder="Search your address, suburb or town…">
              <button class="btn" id="homeGo">Search</button>
              <button class="btn" id="homeHere" title="Use this device's location">📍 Use my location</button>
            </div>
            <div id="homeResults" class="results no-print"></div>
          </div>
          <div>
            <label class="field"><span>Home name</span><input data-home="name" value="${esc(home?.name || '')}" placeholder="e.g. Home – Newcastle"></label>
            <div class="row">
              <label class="field"><span>Latitude</span><input type="number" step="any" data-home="lat" value="${home?.lat ?? ''}"></label>
              <label class="field"><span>Longitude</span><input type="number" step="any" data-home="lon" value="${home?.lon ?? ''}"></label>
            </div>
            ${home?.lat != null ? `<p class="small muted">${Geo.grText(home.lat, home.lon)} · ${Geo.mgaText(home.lat, home.lon)}${t.lat != null ? ` · ${Math.round(Geo.hav([home.lat, home.lon], [t.lat, t.lon]) / 1000)} km straight-line to camp — see <a href="#travel" data-goto="travel">Travel</a> for driving distance` : ''}</p>` : ''}
          </div>
        </div>
      </div>

      <div class="card">
        <h3>People</h3>
        <table class="tbl">
          <thead><tr><th>Name</th><th>Body weight (kg)</th><th>Water carried (L)</th><th class="no-print"></th></tr></thead>
          <tbody>${people.map(p => `<tr>
            <td><input data-person="${p.id}" data-field="name" value="${esc(p.name)}"></td>
            <td><input type="number" min="0" step="0.5" data-person="${p.id}" data-field="bodyKg" value="${num(p.bodyKg)}"></td>
            <td><input type="number" min="0" step="0.25" data-person="${p.id}" data-field="waterL" value="${num(p.waterL)}"></td>
            <td class="no-print">${people.length > 1 ? `<button class="icon-btn" data-del-person="${p.id}" title="Remove">🗑</button>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table>
        <button class="btn no-print" id="addPerson">+ Add person</button>
        <p class="muted small">Body weight is used to check pack weight (aim for ≤ 20% of body weight). Water is the amount each person carries at the start of a day.</p>
      </div>

      <div class="card"><h3>Trip overview</h3>${summary()}</div>

      <div class="card no-print">
        <h3>Save &amp; backup</h3>
        <p class="muted">${Store.canEdit ? 'This trip saves automatically to the Grafton Scout Group website.' : 'You are viewing this trip — changes you make on this page are not saved.'} See <a href="#trips" data-goto="trips">Group trips</a> to switch between plans. Export this plan to keep a copy or use it in the offline Camp Planner.</p>
        <div class="btn-row">
          <button class="btn" id="exportJson">⬇ Export this trip</button>
          <label class="btn plan-only">⬆ Import a trip<input type="file" id="importJson" accept=".json,application/json" hidden></label>
          <button class="btn danger edit-only" id="resetAll">Clear this trip</button>
        </div>
      </div>`;
  }

  function locInfo() {
    const t = Store.state.trip;
    if (t.lat == null || t.lon == null) return '';
    const rows = [
      ['Grid ref', `<b>${Geo.grText(t.lat, t.lon)}</b> · ${Geo.mgaText(t.lat, t.lon)}`],
      ['State', t.state || '—'],
      ['Park', t.park ? `🌿 ${esc(t.park.name)} ${esc(t.park.type)}` : '<span class="muted">Not in a gazetted protected area</span>'],
      ['Declination', `≈ ${Geo.fmtDecl(Geo.declination(t.lat, t.lon))} (magnetic)`]
    ];
    return `<table class="kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  }

  function summary() {
    const st = Store.state;
    const w = Weight.compute();
    const groupKg = w.reduce((s, r) => s + r.pack, 0);
    const meals = Meals.totals();
    const highRisks = st.risks.filter(r => Risk.score(r.rl || r.l, r.rc || r.c) >= 10).length;
    const tiles = [
      ['map', '🗺️', st.map.features.length, 'map features'],
      ['meals', '🍳', meals.servings, 'meal servings planned'],
      ['gear', '🎒', st.gear.length, 'gear items'],
      ['weight', '⚖️', fmtKg(groupKg, 1), 'total group pack weight'],
      ['risk', '⚠️', st.risks.length, `risks (${highRisks} high/extreme residual)`],
      ['weather', '🌦️', st.trip.lat != null ? '✓' : '—', st.trip.lat != null ? 'location set' : 'set a location'],
      ['travel', '🚗', st.travel.cars.length ? `${Math.round(Travel.costs().km)} km` : '—', st.travel.cars.length ? `driving, ${st.travel.cars.length} car(s)` : 'add cars & home'],
      ['budget', '💰', fmtMoney(Budget.totals().perPerson), 'per person budget']
    ];
    return `<div class="tiles">${tiles.map(([tab, ic, v, l]) =>
      `<a href="#${tab}" data-goto="${tab}" class="tile"><span class="tile-ic">${ic}</span><b>${v}</b><span>${l}</span></a>`).join('')}</div>`;
  }

  function bind() {
    bound = true;
    const r = root();
    Publish.bind(r);
    r.addEventListener('change', async e => {
      const el = e.target;
      if (el.dataset.trip) {
        const k = el.dataset.trip;
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (k === 'lat' || k === 'lon') v = el.value === '' ? null : num(el.value);
        Store.state.trip[k] = v;
        Store.save();
        App.refreshHeader();
        if (k === 'lat' || k === 'lon') { MapView.refreshCamp(); locationChanged(); }
        if (k === 'start' || k === 'end') render();
        if (k === 'name' || k === 'status') App.refreshHeader();
        return;
      }
      if (el.dataset.home) {
        const tr = Store.state.travel, k = el.dataset.home;
        tr.home = tr.home || { name: 'Home', lat: null, lon: null };
        tr.home[k] = k === 'name' ? el.value : (el.value === '' ? null : num(el.value));
        Store.save();
        if (k !== 'name') render();
        return;
      }
      if (el.dataset.person) {
        const p = Store.state.people.find(p => p.id === el.dataset.person);
        p[el.dataset.field] = el.dataset.field === 'name' ? el.value : num(el.value);
        Store.save();
        return;
      }
      if (el.id === 'importJson' && el.files[0]) {
        try {
          const n = await Store.importData(JSON.parse(await readFile(el.files[0])));
          toast(`Imported ${n} trip${n > 1 ? 's' : ''} — find ${n > 1 ? 'them' : 'it'} under Group trips`);
          App.refreshHeader();
        } catch (err) { toast('Import failed: ' + err.message); }
        el.value = '';
      }
    });

    r.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'addPerson') {
        Store.state.people.push({ id: uid(), name: 'Person ' + (Store.state.people.length + 1), bodyKg: 70, waterL: 2 });
        Store.save(); render();
      } else if (b.dataset.delPerson) {
        const id = b.dataset.delPerson;
        if (!confirm('Remove this person? Their gear becomes shared group gear.')) return;
        Store.state.people = Store.state.people.filter(p => p.id !== id);
        Store.state.gear.forEach(g => { if (g.carrier === id) g.carrier = 'group'; });
        Store.save(); render();
      } else if (b.id === 'locGo') {
        search();
      } else if (b.id === 'homeGo') {
        searchHome();
      } else if (b.dataset.homeLat) {
        setHome(b.dataset.short, +b.dataset.homeLat, +b.dataset.homeLon);
      } else if (b.id === 'homeHere') {
        if (!navigator.geolocation) return toast('Location is not available in this browser');
        toast('Finding your location…');
        navigator.geolocation.getCurrentPosition(async pos => {
          const { latitude: lat, longitude: lon } = pos.coords;
          let name = 'Home';
          try {
            const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`)).json();
            const a = j.address || {};
            name = 'Home – ' + (a.suburb || a.town || a.city || a.village || 'current location');
          } catch (e) { /* keep default name */ }
          setHome(name, lat, lon);
        }, () => toast('Could not get your location — search for your address instead'), { timeout: 15000 });
      } else if (b.dataset.lat) {
        const t = Store.state.trip;
        t.lat = +(+b.dataset.lat).toFixed(5);
        t.lon = +(+b.dataset.lon).toFixed(5);
        t.location = b.dataset.short;
        Store.save();
        MapView.flyTo(t.lat, t.lon, 13);
        MapView.refreshCamp();
        App.refreshHeader();
        render();
        locationChanged();
      } else if (b.id === 'pickOnMap') {
        App.show('map');
        MapView.setMode('camp');
      } else if (b.id === 'exportJson') {
        download(safeName(Store.state.trip.name) + '-camp-plan.json', JSON.stringify(Store.state, null, 1));
      } else if (b.id === 'resetAll') {
        if (!confirm('Clear this trip (map, meals, gear, risks) back to a blank plan? Your other trips are not affected. Export it first if you want to keep it.')) return;
        try { await Store.reset(); App.reloadAll(); } catch (err) { toast(err.message); }
      }
    });

    r.addEventListener('keydown', e => {
      if (e.target.id === 'locSearch' && e.key === 'Enter') search();
      if (e.target.id === 'homeSearch' && e.key === 'Enter') searchHome();
    });
  }

  function setHome(name, lat, lon) {
    Store.state.travel.home = { name: name || 'Home', lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
    Store.save();
    render();
    toast('Home location saved');
  }

  async function searchHome() {
    const q = $('#homeSearch').value.trim();
    if (!q) return;
    const out = $('#homeResults');
    out.innerHTML = '<p class="muted">Searching…</p>';
    try {
      const res = await geocode(q);
      out.innerHTML = res.length
        ? res.map(x => `<button class="result" data-home-lat="${x.lat}" data-home-lon="${x.lon}" data-short="${esc('Home – ' + x.short)}">${esc(x.name)}</button>`).join('')
        : '<p class="muted">No results — try your suburb and state.</p>';
    } catch (e) { out.innerHTML = '<p class="muted">Search failed — are you online?</p>'; }
  }

  async function search() {
    const q = $('#locSearch').value.trim();
    if (!q) return;
    const out = $('#locResults');
    out.innerHTML = '<p class="muted">Searching…</p>';
    try {
      const res = await geocode(q);
      out.innerHTML = res.length
        ? res.map(x => `<button class="result" data-lat="${x.lat}" data-lon="${x.lon}" data-short="${esc(x.short)}">${esc(x.name)}</button>`).join('')
        : '<p class="muted">No results — try a nearby town, or pick the spot on the map.</p>';
    } catch (e) { out.innerHTML = '<p class="muted">Search failed — are you online?</p>'; }
  }

  /* New camp location: look up state, national park and whether tides apply. */
  async function locationChanged() {
    const t = Store.state.trip;
    if (t.lat == null || t.lon == null) return;
    if (!Geo.inAustralia(t.lat, t.lon)) toast('That location is outside Australia — grid references, parks data and links are Australian');
    const refresh = () => { const el = $('#locInfo'); if (el) el.innerHTML = locInfo(); App.refreshHeader(); };
    const [state, park] = await Promise.allSettled([stateAt(t.lat, t.lon), Parks.parkAt(t.lat, t.lon)]);
    if (state.status === 'fulfilled') t.state = state.value;
    if (park.status === 'fulfilled') t.park = park.value;
    Store.save();
    refresh();
    checkCoastal();
  }

  /* If the marine model has sea-level data at the camp, it's coastal: switch tides on. */
  async function checkCoastal() {
    const t = Store.state.trip;
    if (t.lat == null || t.lon == null) return;
    try {
      const j = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${t.lat}&longitude=${t.lon}&hourly=sea_level_height_msl&forecast_days=1`);
      const has = (j.hourly?.sea_level_height_msl || []).some(v => v != null);
      const hint = $('#coastalHint');
      if (has && !t.coastal) {
        t.coastal = true;
        Store.save();
        toast('Tide data found for this location — tides switched on');
        if (App.current === 'trip') render();
      }
      if (hint) hint.textContent = has ? 'Tide data is available at this location.' : 'No tide data at this exact point (inland, or move the pin onto the water’s edge).';
    } catch (e) { /* offline — leave as is */ }
  }

  return { render, locationChanged };
})();
