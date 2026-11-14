/* Camp Planner — Dashboard tab: home base's view while the activity is running.
   • the map with everyone's latest position (phones and satellite trackers), with a "zoom to" selector for a party or one person
   • a basemap selector, pins where each group stays overnight on the drive, and across the bottom the next event in the timeline
   • tiles: check-in numbers, the weather now with links to the BOM radar and warnings, participants and emergency contacts
   • alerts: when a phone's status is ALERT (or "trying to contact home base"), the whole planner turns red on any tab and a
     pop-up takes you to them on the map, to their party's contacts, or to the emergency plan. It stays until acknowledged.
   Positions come from the Live module (api/track.php); people come from the People tab (api/rego.php). */

const Dash = (() => {
  const COLORS = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#c2255c', '#0c8599', '#f08c00', '#5f3dc4'];
  const ALERTS = { alert: 2, contact: 1 };                       // status -> how serious (2 = red, 1 = amber)
  const root = () => $('#tab-dash');
  let map = null, layer = null, baseLayer = null, stayLayer = null, bound = false, R = null, wx = null, wxAt = 0, sel = 'all', follow = true, fitted = '';
  let base = (() => { try { return localStorage.getItem('camp.dash.base') || ''; } catch (e) { return ''; } })();
  const withPlace = d => (d ? { ...d, people: d.people.filter(p => !p.wait) } : d);   // not the waiting list
  const acked = (() => { try { return JSON.parse(localStorage.getItem('camp.dash.acked') || '{}'); } catch (e) { return {}; } })();
  const live = () => (Live.data() || { devices: [], now: Math.floor(Date.now() / 1000) });
  const devices = () => live().devices.filter(d => !d.revoked);
  const ago = t => { const s = Math.max(0, live().now - t); return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
  const tel = n => (n ? `<a href="tel:${esc(String(n).replace(/[^0-9+]/g, ''))}">${esc(n)}</a>` : '—');

  /* which party / person a phone belongs to, from the name it joined with (e.g. "Alex Scout (Kookaburras)") */
  function owner(d) {
    if (!R) return {};
    const nm = d.name.toLowerCase();
    const person = R.people.find(p => nm.includes(p.name.toLowerCase()));
    const group = R.groups.find(g => nm.includes(g.name.toLowerCase())) || (person && R.groups.find(g => g.id === person.group));
    return { person, group };
  }
  const inSel = d => { if (sel === 'all') return true; if (sel.startsWith('d')) return d.id === +sel.slice(1); const o = owner(d); return !!o.group && o.group.id === +sel.slice(1); };

  /* ---------- alerts (on every tab) ---------- */
  const alerting = () => devices().filter(d => ALERTS[d.status] && d.statusAt && (acked[d.id] || 0) < d.statusAt);
  function onLive() {
    const A = alerting(), worst = Math.max(0, ...A.map(d => ALERTS[d.status]));
    if (A.length && !R) Rego.data().then(d => { if (d && !R) { R = withPlace(d); const el = $('#dashAlert'); if (el) { el.dataset.key = ''; onLive(); } } });   // so the pop-up can name their party
    document.body.classList.toggle('dash-alert', worst === 2);
    document.body.classList.toggle('dash-warn', worst === 1);
    let el = $('#dashAlert');
    if (!A.length) { if (el) el.remove(); }
    else {
      const fresh = !el || el.dataset.key !== A.map(d => d.id + ':' + d.statusAt).join(',');
      if (!el) { el = document.createElement('div'); el.id = 'dashAlert'; el.className = 'dash-pop no-print'; document.body.appendChild(el); el.addEventListener('click', popClick); }
      if (fresh) {
        el.dataset.key = A.map(d => d.id + ':' + d.statusAt).join(',');
        el.innerHTML = `<div class="dash-pop-box ${worst === 2 ? 'red' : 'amber'}" role="alertdialog" aria-live="assertive">
          <h2>${worst === 2 ? '🚨 ALERT from the field' : '📞 Trying to contact home base'}</h2>
          ${A.map(d => { const o = owner(d), st = Live.STATUS[d.status]; return `<div class="dash-pop-item">
            <p><b>${st[0]} ${esc(d.name)}</b>${o.group ? ` · ${esc(o.group.name)}` : ''} — ${esc(st[1])} <small>(${ago(d.statusAt)})</small></p>
            ${d.message ? `<p class="dash-pop-msg">“${esc(d.message)}”</p>` : ''}
            <p class="small">${d.last ? `Last position ${ago(d.last.t)}: <b>${Geo.grText(d.last.lat, d.last.lon)}</b> · ${d.last.lat.toFixed(5)}, ${d.last.lon.toFixed(5)}` : 'No position received from this phone yet.'}</p>
            <div class="btn-row"><button class="btn primary" data-p="map" data-d="${d.id}">📍 Show on the map</button><button class="btn" data-p="people" data-d="${d.id}">👥 Their party's contacts</button>
              <button class="btn" data-p="plan">⛑️ Emergency plan</button><button class="btn" data-p="ack" data-d="${d.id}">Acknowledge</button></div></div>`; }).join('')}
          <p class="small">If life is at risk call <b>000</b> and give the grid reference. This stays up until each alert is acknowledged.</p></div>`;
        beep(worst);
      }
    }
    if (App.current === 'dash') { tiles(); draw(); }
  }
  function popClick(e) {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    const d = devices().find(x => x.id === +b.dataset.d), k = b.dataset.p;
    if (k === 'ack') { acked[d.id] = d.statusAt; try { localStorage.setItem('camp.dash.acked', JSON.stringify(acked)); } catch (err) { /* ignore */ } return onLive(); }
    if (k === 'plan') { $('#dashAlert').classList.add('min'); return App.show('risk'); }
    $('#dashAlert').classList.add('min');
    if (App.current !== 'dash') App.show('dash');
    if (k === 'map') { sel = 'd' + d.id; follow = true; fitted = ''; setTimeout(() => { tiles(); draw(); root().scrollIntoView(); }, 300); }
    else setTimeout(() => people(owner(d).group ? owner(d).group.id : null, d.name), 300);
  }
  function beep(level) {
    try { const C = window.AudioContext || window.webkitAudioContext, ac = new C(), o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = level === 2 ? 880 : 520; o.connect(g); g.connect(ac.destination); g.gain.value = 0.15; o.start(); o.stop(ac.currentTime + (level === 2 ? 0.9 : 0.35)); } catch (e) { /* sound is blocked until the page is clicked */ }
  }

  /* ---------- the tab ---------- */
  async function render() {
    if (!bound) bind();
    const r = root();
    if (!Store.canEdit || !Store.tripId) { r.innerHTML = '<div class="card"><h2>🛰 Dashboard</h2><p class="muted">The live dashboard is for the trip\'s leaders. Sign in to see it.</p></div>'; return; }
    if (map) { map.remove(); map = null; }
    r.innerHTML = `<div class="dash">
        <div class="dash-map-wrap"><div class="dash-bar"><label>Zoom to <select id="dashSel"></select></label>
            <label>Map <select id="dashBase">${Object.entries(MapView.BASES).map(([k, b]) => `<option value="${k}">${esc(b.name)}</option>`).join('')}</select></label>
            <label class="check"><input type="checkbox" id="dashFollow" ${follow ? 'checked' : ''}> keep them in view</label><span class="muted small" id="dashUpd"></span></div>
          <div id="dashMap" class="dash-map"></div></div>
        <div class="dash-tiles" id="dashTiles"></div></div>
      <div class="dash-next" id="dashNext"></div>`;
    map = L.map('dashMap', { zoomSnap: 0.25 });
    baseLayer = null; setBase();
    const s = Store.state;
    s.map.features.filter(f => f.type === 'trail').forEach(f => L.polyline(f.coords, { color: f.color || '#c2255c', weight: 3, opacity: 0.7 }).addTo(map));
    if (s.trip.lat != null) L.marker([s.trip.lat, s.trip.lon], { icon: L.divIcon({ className: 'dash-camp', html: '⛺', iconSize: [22, 22] }) }).addTo(map);
    stayLayer = L.layerGroup().addTo(map);
    layer = L.layerGroup().addTo(map);
    fitted = '';
    tiles(); draw(); next();
    R = withPlace(await Rego.data(true));
    loadWx();
    tiles(); draw(); stays(); next();
  }

  /* the basemap: any of the Map tab's, remembered on this computer (starts as the trip's own) */
  function setBase() {
    const B = MapView.BASES;
    if (!B[base]) base = B[Store.state.map.base] ? Store.state.map.base : 'topo';
    if (baseLayer) baseLayer.remove();
    baseLayer = L.tileLayer(B[base].url, { ...B[base].opts, maxZoom: 19 }).addTo(map);
    baseLayer.bringToBack();
    const el = $('#dashBase'); if (el) el.value = base;
  }

  /* where each group is staying on the drive (suggested overnight towns, or the place the group chose) */
  function stays() {
    if (!map || !stayLayer) return;
    stayLayer.clearLayers();
    Travel.stayPins().forEach(x => L.marker([x.lat, x.lon], { icon: L.divIcon({ className: 'dash-stay', html: x.booked ? '🏨' : '🛏️', iconSize: [24, 24], iconAnchor: [12, 12] }) })
      .bindTooltip(`${esc(x.group)}: ${x.booked ? 'staying at' : 'suggested overnight stop,'} ${esc(x.place)}${x.night ? ` — night of ${fmtDate(parseDate(x.night))}` : ''}`).addTo(stayLayer));
  }

  /* ---------- across the bottom: where we are in the timeline, and what happens next ---------- */
  function timeline() {
    const out = Travel.events(), s = Store.state, days = tripDays();
    try {
      const f = s.map.features.filter(x => x.type === 'trail').find(Traverse.hasProfile), T = f ? Traverse.analyse(f) : null;
      days.forEach((d, i) => {
        if (!d.date || i === 0) return;
        const ls = T ? T.legs.filter(l => l.day === i + 1) : [];
        out.push({ t: new Date(d.date), day: true, html: `🥾 <b>Day ${i + 1}</b>${ls.length ? ` — ${esc(ls[0].from.name)} → <b>${esc(ls[ls.length - 1].to.name)}</b>` : i === days.length - 1 ? ' — the last day' : ''}` });
      });
    } catch (e) { /* no trail analysis: the travel timetable still shows */ }
    const cl = parseDate((s.rego || {}).closes);
    if (cl) { cl.setHours(23, 59); out.push({ t: cl, html: '📝 <b>Registrations close</b>' }); }
    return out.filter(x => x.t && !isNaN(x.t)).sort((a, b) => a.t - b.t);
  }
  const whenTxt = e => fmtDate(e.t) + (e.day ? '' : ' · ' + e.t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  function inTxt(ms) {
    const m = Math.round(ms / 60000);
    return m < 1 ? 'now' : m < 60 ? `in ${m} min` : m < 48 * 60 ? `in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `in ${Math.round(m / 1440)} days`;
  }
  function next() {
    const el = $('#dashNext');
    if (!el) return;
    const E = timeline(), now = Date.now(), i = E.findIndex(e => e.t.getTime() > now), go = '<button class="btn small" data-goto="travel">Full timeline</button>';
    if (!E.length) { el.innerHTML = `<div class="dash-next-main"><span class="dash-next-lab">⏭ Next</span><span class="muted">Set the trip's dates (Trip tab) and add cars (Travel tab) to see the timeline here.</span></div>`; return; }
    const prev = i === -1 ? E[E.length - 1] : i > 0 ? E[i - 1] : null, nx = i === -1 ? null : E[i], after = i === -1 ? [] : E.slice(i + 1, i + 3);
    el.innerHTML = `<div class="dash-next-main"><span class="dash-next-lab">⏭ Next</span>${nx ? `<span class="dash-next-when"><b>${inTxt(nx.t.getTime() - now)}</b><small>${whenTxt(nx)}</small></span><span class="dash-next-what">${nx.html}</span>` : '<span class="muted">Everything in the timeline has happened — the activity is finished.</span>'}${go}</div>
      <div class="dash-next-rest">${prev ? `<span><i>${i === -1 ? 'Last' : 'Before that'}</i> <small>${whenTxt(prev)}</small> ${prev.html}</span>` : ''}${after.map(e => `<span><i>Then</i> <small>${whenTxt(e)}</small> ${e.html}</span>`).join('')}</div>`;
  }

  function draw() {
    if (!map || !layer) return;
    layer.clearLayers();
    const now = live().now, shown = devices().filter(d => d.last && inSel(d)), pts = [];
    devices().filter(d => d.last).forEach((d, i) => {
      const on = inSel(d), col = COLORS[i % COLORS.length], lvl = ALERTS[d.status] && (acked[d.id] || 0) < d.statusAt ? ALERTS[d.status] : 0, old = now - d.last.t > 1800;
      const st = Live.STATUS[d.status], mv = Live.motionOf(d, now);
      if (on && d.trail && d.trail.length > 1) L.polyline(d.trail.map(p => [p[0], p[1]]), { color: col, weight: 3, opacity: 0.8 }).addTo(layer);
      L.marker([d.last.lat, d.last.lon], { zIndexOffset: lvl ? 2000 : on ? 1000 : 0, opacity: on ? 1 : 0.45,
        icon: L.divIcon({ className: 'dash-mk', iconSize: [0, 0], html: `<i class="${lvl === 2 ? 'red' : lvl === 1 ? 'amber' : ''} ${old ? 'old' : ''}" style="background:${col}"></i><b>${st ? st[0] + ' ' : ''}${esc(d.name)}${mv ? ' · ' + Live.motionText(mv) : ''}</b>` }) })
        .bindPopup(`<b>${esc(d.name)}</b><br>${esc(Live.statusText(d) || '')}${d.message ? `<br>“${esc(d.message)}”` : ''}<br>${Geo.grText(d.last.lat, d.last.lon)} · ${ago(d.last.t)}${d.last.batt != null ? ` · 🔋 ${d.last.batt}%` : ''}`).addTo(layer);
      if (on) pts.push([d.last.lat, d.last.lon]);
    });
    /* fit: once for a new selection, and again as they move while "keep them in view" is ticked */
    const key = sel + ':' + shown.length;
    if (pts.length && (follow || fitted !== key)) { map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: sel === 'all' ? 15 : 16, animate: fitted === key }); fitted = key; }
    else if (!pts.length && fitted === '') {
      const tr = Store.state.map.features.filter(f => f.type === 'trail').flatMap(f => f.coords), t = Store.state.trip;
      if (tr.length) map.fitBounds(L.latLngBounds(tr).pad(0.1)); else map.setView(t.lat != null ? [t.lat, t.lon] : Store.state.map.center, 11);
      fitted = 'none';
    }
    const up = $('#dashUpd'); if (up) up.textContent = Live.data() ? `updated ${new Date().toLocaleTimeString()}` : 'waiting for the first position…';
  }

  function tiles() {
    const el = $('#dashTiles'), sl = $('#dashSel');
    if (!el) return;
    const D = devices(), P = R ? R.people : [], C = R ? R.cars : [], G = R ? R.groups : [];
    const parties = G.filter(g => D.some(d => (owner(d).group || {}).id === g.id));
    sl.innerHTML = `<option value="all">Everyone (${D.filter(d => d.last).length})</option>${parties.length ? `<optgroup label="Parties">${parties.map(g => `<option value="g${g.id}">${esc(g.name)}</option>`).join('')}</optgroup>` : ''}
      <optgroup label="Phones and trackers">${D.map(d => `<option value="d${d.id}">${esc(d.name)}${d.last ? '' : ' (no position yet)'}</option>`).join('')}</optgroup>`;
    if (![...sl.options].some(o => o.value === sel)) sel = 'all';
    sl.value = sel;
    const A = alerting(), here = P.filter(p => p.attend === 'present').length, exp = P.filter(p => p.attend === 'expected').length;
    const quiet = D.filter(d => !d.last || live().now - d.last.t > 1800);
    el.innerHTML = `
      <div class="dash-tile ${A.length ? (A.some(d => d.status === 'alert') ? 'red' : 'amber') : 'ok'}"><h3>${A.length ? '🚨 Alerts' : '✅ Status'}</h3>
        ${A.length ? A.map(d => `<p><b>${esc(d.name)}</b> — ${esc(Live.STATUS[d.status][1])} <small>${ago(d.statusAt)}</small> <button class="btn small" data-zoom="d${d.id}">show</button></p>`).join('') : `<p>No alerts. ${D.length} phone${D.length === 1 ? '' : 's'} and trackers reporting.</p>`}
        <ul class="dash-devs">${D.map(d => { const st = Live.STATUS[d.status]; return `<li><button data-zoom="d${d.id}" title="Zoom to">${st ? st[0] : '•'} <b>${esc(d.name)}</b> <small>${esc(Live.statusText(d) || '')}${d.message ? ` — “${esc(d.message)}”` : ''} · ${d.last ? ago(d.last.t) : 'no position'}</small></button></li>`; }).join('')}</ul>
        ${quiet.length ? `<p class="small bad-text">Not heard from in 30 minutes: ${quiet.map(d => esc(d.name)).join(', ')}</p>` : ''}
        ${D.length ? '' : '<p class="muted small">Nobody is sharing a location yet. Phones join with the trip\'s join code (Map tab → Live tracking).</p>'}</div>
      <div class="dash-tile"><h3>👥 People</h3>
        ${R ? `<div class="dash-nums"><div><b>${here}</b><span>checked in</span></div><div><b>${exp}</b><span>still to come</span></div><div><b>${P.filter(p => p.attend === 'noshow').length}</b><span>not coming</span></div><div><b>${C.filter(c => c.arrivedAt).length}/${C.length}</b><span>cars in</span></div></div>
          <button class="btn primary" data-people>📇 Participant details &amp; emergency contacts</button>${P.some(p => p.medFlag) ? `<p class="small">⚕ Medical notes on paper forms: ${P.filter(p => p.medFlag).map(p => esc(p.name)).join(', ')}</p>` : ''}`
          : '<p class="muted small">No registrations for this trip (People tab).</p>'}</div>
      <div class="dash-tile" id="dashWx">${wxHtml()}</div>
      <div class="dash-tile"><h3>⛑️ Emergency</h3><p><b>000</b> · 112 from a mobile with no coverage</p>
        ${['contact', 'ranger', 'police', 'hospital'].filter(k => (Store.state.emergency || {})[k]).map(k => `<p class="small"><b>${Risk.EMERGENCY.find(e => e[0] === k)[1]}:</b> ${esc(Store.state.emergency[k])}</p>`).join('')}
        <button class="btn small" data-goto="risk">Emergency plan &amp; risks</button> <button class="btn small" data-goto="map">Full map &amp; tracking</button></div>`;
  }

  /* ---------- weather now ---------- */
  function wxPoint() {
    const t = Store.state.trip, d = devices().filter(x => x.last);
    if (d.length) return [d.reduce((a, x) => a + x.last.lat, 0) / d.length, d.reduce((a, x) => a + x.last.lon, 0) / d.length];
    if (t.lat != null) return [t.lat, t.lon];
    const tr = Store.state.map.features.find(f => f.type === 'trail');
    return tr ? tr.coords[0] : null;
  }
  /* the last reading is kept in this browser (per trip, for a day) so an outage of the weather service still shows something */
  const WX_KEY = 'camp.dash.wx';
  let wxFail = false, wxTrip = null;
  const wxCached = () => { try { const c = JSON.parse(localStorage.getItem(WX_KEY) || 'null'); return c && c.trip === Store.tripId && c.wx && c.wx.current && c.wx.hourly && Date.now() - c.wx.at < 24 * 3600000 ? c.wx : null; } catch (e) { return null; } };
  const wxAge = at => { const m = Math.max(0, Math.round((Date.now() - at) / 60000)); return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} hours ago`; };
  async function loadWx() {
    if (wxTrip !== Store.tripId) { wxTrip = Store.tripId; wx = null; wxAt = 0; wxFail = false; }      // another trip: not the last trip's weather
    const pt = wxPoint();
    if (!pt || Date.now() - wxAt < 10 * 60000) return;
    wxAt = Date.now();
    const paint = () => { const el = $('#dashWx'); if (el) el.innerHTML = wxHtml(); };
    if (!wx) { wx = wxCached(); if (wx) paint(); }
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pt[0].toFixed(3)}&longitude=${pt[1].toFixed(3)}&timezone=auto&wind_speed_unit=kmh&forecast_hours=6` +
        '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m&hourly=precipitation_probability,precipitation,temperature_2m,weather_code', ctl ? { signal: ctl.signal } : undefined);
      const j = await r.json();
      if (!r.ok || !j.current) throw new Error('no forecast');
      wx = { at: Date.now(), ...j }; wxFail = false;
      try { localStorage.setItem(WX_KEY, JSON.stringify({ trip: Store.tripId, wx })); } catch (e) { /* private window or storage full: fine */ }
    } catch (e) { wxAt = 0; wxFail = true; }          // tried again on the next minute's refresh
    clearTimeout(timer);
    paint();
  }
  function wxHtml() {
    const links = `<p class="dash-links"><a href="http://www.bom.gov.au/australia/radar/" target="_blank" rel="noopener">🌧 BOM rain radar</a> · <a href="http://www.bom.gov.au/australia/warnings/" target="_blank" rel="noopener">⚠️ BOM warnings</a> · <a href="#weather" data-goto="weather">Full forecast</a></p>`;
    if (!wx) return `<h3>🌦️ Weather now</h3><p class="muted small">${!wxPoint() ? 'Set the camp location or map a trail to see the weather.' : wxFail ? '<b class="bad-text">The weather service is not responding</b> — trying again every minute. The BOM links below still work.' : 'Loading…'}</p>${links}`;
    const c = wx.current, [ic, txt] = Weather.wmo(c.weather_code), h = wx.hourly;
    const maxP = Math.max(0, ...(h.precipitation_probability || []).filter(x => x != null)), rain = (h.precipitation || []).reduce((a, x) => a + (x || 0), 0);
    return `<h3>🌦️ Weather now <small class="muted">${new Date(wx.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></h3>
      ${wxFail ? `<p class="small bad-text"><b>Weather service not responding</b> — this is the last reading, from ${wxAge(wx.at)}. Trying again every minute.</p>` : ''}
      <p class="dash-wx"><span>${ic}</span><b>${Math.round(c.temperature_2m)}°</b> <small>feels ${Math.round(c.apparent_temperature)}° · ${txt}</small></p>
      <p class="small">💨 ${Math.round(c.wind_speed_10m)} km/h ${Weather.dirText(c.wind_direction_10m)}, gusts ${Math.round(c.wind_gusts_10m)} · rain now ${c.precipitation.toFixed(1)} mm</p>
      <p class="small ${maxP >= 60 || rain >= 5 ? 'bad-text' : ''}">Next 6 hours: up to ${maxP}% chance of rain, ${rain.toFixed(1)} mm · ${(h.time || []).map((t, i) => `${new Date(t).getHours()}h ${Weather.wmo(h.weather_code[i])[0]}`).filter((_, i) => i % 2 === 0).join(' ')}</p>${links}`;
  }

  /* ---------- participant details and emergency contacts ---------- */
  function people(groupId, find) {
    if (!R) return;
    const dlg = $('#dialog');
    const row = p => { const g = R.groups.find(x => x.id === p.group), c = R.cars.find(x => x.id === p.car);
      return `<tr data-g="${p.group || 0}" data-s="${esc((p.name + ' ' + (g ? g.name : '')).toLowerCase())}"><td><b>${esc(p.name)}</b> ${p.attend === 'present' ? '✅' : p.attend === 'noshow' ? '❌' : ''}<br><small>${p.kind === 'adult' ? 'Adult' : 'Youth'} · ${g ? esc(g.name) : 'no group'}${g && g.leader === p.id ? ' (leader)' : ''}${c ? ' · ' + esc(c.label) : ''}</small></td>
        <td>${tel(p.mobile)}</td><td><b>${esc(p.emName || '—')}</b><br>${tel(p.emPhone)}</td><td class="small">${esc(p.dietary || '')}${p.medFlag ? `${p.dietary ? '<br>' : ''}<b class="bad-text">⚕ medical notes on paper form</b>` : ''}</td></tr>`; };
    dlg.innerHTML = `<div class="dash-people"><div class="page-head"><h3>📇 Participants &amp; emergency contacts</h3><button class="btn" id="dpClose">Close</button></div>
      <div class="row wrap"><input id="dpFind" type="search" placeholder="Find a person…"><select id="dpGroup"><option value="">All groups</option>${R.groups.map(g => `<option value="${g.id}" ${g.id === groupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
      ${find && groupId == null ? `<p class="small muted">Couldn't match “${esc(find)}” to a registered party, so everyone is listed.</p>` : ''}
      <table class="tbl compact"><thead><tr><th>Name</th><th>Mobile</th><th>Emergency contact</th><th>Dietary / medical</th></tr></thead><tbody>${R.people.slice().sort((a, b) => (a.group || 0) - (b.group || 0) || a.name.localeCompare(b.name)).map(row).join('')}</tbody></table></div>`;
    const filt = () => { const q = $('#dpFind').value.toLowerCase(), g = $('#dpGroup').value; dlg.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = (q && !tr.dataset.s.includes(q)) || (g && tr.dataset.g !== g); }); };
    $('#dpFind').oninput = filt; $('#dpGroup').onchange = filt; $('#dpClose').onclick = () => dlg.close();
    filt();
    if (!dlg.open) dlg.showModal();
  }

  function bind() {
    bound = true;
    const r = root();
    r.addEventListener('change', e => {
      if (e.target.id === 'dashSel') { sel = e.target.value; fitted = ''; draw(); }
      if (e.target.id === 'dashBase') { base = e.target.value; try { localStorage.setItem('camp.dash.base', base); } catch (err) { /* not remembered */ } setBase(); }
      if (e.target.id === 'dashFollow') { follow = e.target.checked; if (follow) { fitted = ''; draw(); } }
    });
    r.addEventListener('click', e => {
      const z = e.target.closest('[data-zoom]');
      if (z) { sel = z.dataset.zoom; fitted = ''; tiles(); draw(); return; }
      if (e.target.closest('[data-people]')) people(sel.startsWith('g') ? +sel.slice(1) : null);
    });
    setInterval(() => { if (App.current === 'dash') { loadWx(); next(); Rego.data(true).then(d => { R = withPlace(d); tiles(); stays(); next(); }); } }, 60000);
  }

  return { render, onLive };
})();
