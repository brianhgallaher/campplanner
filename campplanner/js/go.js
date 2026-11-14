/* Camp Planner Go — the phone app for people on a camp (an installable web app; works offline).
   Join a trip with its code, keep the plan and map on the phone, and (if switched on) share this phone's location
   with the trip's leaders. Server: api/track.php. Offline: sw.js caches the app, the plan and map tiles.
   Location is sent while the app is open; points taken without service are queued and sent later. */

(() => {
  const API = '../api/track.php?action=';
  const TILE = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
  const MOVING_MS = 30000;                 // while moving: a position about every 30 seconds
  const STILL_MS = 120000;                 // standing still: every 2 minutes is enough
  const MOVED_M = 20;                      // "moving" = at least this far from the last position sent
  const QUEUE_MAX = 3000;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('go.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('go.' + k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } },
    del(k) { try { localStorage.removeItem('go.' + k); } catch (e) { /* ignore */ } }
  };
  let me = store.get('me', null);          // { token, name, trip: { id, name } }
  let pack = null, packAt = store.get('packAt', 0), tab = 'plan', map = null, meMarker = null, lastFix = store.get('lastFix', null);
  let sharing = store.get('sharing', false), timer = null, wake = null, sending = false, lastSent = store.get('lastSent', 0), shareMsg = '';

  function toast(msg, ms = 3200) {
    const t = $('#goToast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
  }
  async function call(action, body, query = '') {
    const init = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    const r = await fetch(API + action + query, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `The website returned an error (${r.status}).`); e.status = r.status; throw e; }
    return j;
  }
  const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : ''; };
  const fmtH = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  const ago = ms => { const m = (Date.now() - ms) / 60000; return m < 1 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

  /* ---------- the plan, kept on the phone ---------- */
  async function savePack(p) { try { const c = await caches.open('go-data'); await c.put('pack.json', new Response(JSON.stringify(p))); } catch (e) { store.set('pack', p); } }
  async function loadPack() {
    try { const c = await caches.open('go-data'); const r = await c.match('pack.json'); if (r) return await r.json(); } catch (e) { /* fall through */ }
    return store.get('pack', null);
  }
  async function refreshPack(quiet) {
    if (!me || !navigator.onLine) return;
    try {
      const j = await call('pack', null, '&token=' + encodeURIComponent(me.token));
      if (j.updated !== packAt || !pack) {
        pack = j.pack; packAt = j.updated;
        store.set('packAt', packAt);
        savePack(pack);                         // keep it on the phone (no need to wait before showing it)
        if (!quiet) toast('Plan updated');
        if (tab !== 'share') render();          // never redraw the Status screen while someone is filling it in
        else $('#goTitle').textContent = pack.name;
      } else if (!quiet) toast('You have the latest plan');
    } catch (e) {
      if (e.status === 401) return kicked(e.message);
      if (!quiet || !pack) toast(e.message, 5000);
    }
  }
  function kicked(msg) {
    stopSharing();
    me = null; pack = null; store.del('me'); store.del('queue');
    render(); toast(msg, 6000);
  }

  /* ---------- screens ---------- */
  function render() {
    $('#goNav').hidden = !me;
    $('#goTitle').textContent = me ? (pack ? pack.name : me.trip.name) : 'Camp Planner Go';
    net();
    if (!me) return joinScreen();
    document.querySelectorAll('#goNav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab !== 'map' && map) { map.remove(); map = null; meMarker = null; }
    ({ plan: planScreen, map: mapScreen, help: helpScreen, share: shareScreen })[tab]();
    watch();
  }
  function net() {
    const q = store.get('queue', []).length;
    $('#goNet').textContent = (navigator.onLine ? '' : 'offline') + (sharing ? (navigator.onLine ? '📡 sharing' : ' · 📡') : '') + (q ? ` · ${q} to send` : '');
  }

  function joinScreen() {
    const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
    $('#goMain').innerHTML = `<section class="go-card go-join">
      <h1>⛺ Join your camp</h1>
      <p>Enter the join code your leader gave you. The plan and map are then kept on this phone, so they work without service.</p>
      <form id="joinForm">
        <label>Join code<input id="jCode" inputmode="latin" autocapitalize="characters" autocomplete="off" maxlength="9" placeholder="ABCD 2345" value="${esc(code)}" required></label>
        <label>Your name<input id="jName" maxlength="40" autocomplete="name" placeholder="e.g. Sam (Kookaburra patrol)" value="${esc(new URLSearchParams(location.search).get('name') || '')}" required></label>
        <p class="go-err" id="jErr"></p>
        <button class="go-btn primary">Join</button>
      </form>
      <p class="small">Sharing your location is your choice — it is off until you switch it on.</p>
    </section>`;
    $('#joinForm').addEventListener('submit', async e => {
      e.preventDefault();
      $('#jErr').textContent = '';
      try {
        const j = await call('join', { code: $('#jCode').value, name: $('#jName').value.trim() });
        me = { token: j.token, name: $('#jName').value.trim(), trip: j.trip };
        store.set('me', me);
        try { history.replaceState(null, '', location.pathname); } catch (ex) { /* ignore */ }
        render();
        await refreshPack(true);
        if (tab !== 'share') render();
      } catch (ex) { $('#jErr').textContent = navigator.onLine ? ex.message : 'You need internet service to join. Try again when you have signal.'; }
    });
  }

  function planScreen() {
    if (!pack) { $('#goMain').innerHTML = `<section class="go-card"><h2>Waiting for the plan</h2><p>Your leaders haven't sent this trip's plan to the phone app yet, or this phone hasn't had service since joining.</p><button class="go-btn" id="pRef">↻ Check again</button></section>`; $('#pRef').onclick = () => refreshPack(); return; }
    const p = pack, today = new Date().toISOString().slice(0, 10);
    const day = d => {
      const km = d.legs.reduce((s, l) => s + l.km, 0), h = d.legs.reduce((s, l) => s + (l.h || 0), 0), camp = d.legs.filter(l => l.camp).pop();
      return `<details class="go-day" ${d.date === today || (!p.days.some(x => x.date === today) && d.n === 1) ? 'open' : ''}>
        <summary><b>Day ${d.n}</b> <span>${esc(fmtDate(d.date))}</span><em>${km ? `${km.toFixed(1)} km${h ? ' · ' + fmtH(h) : ''}` : ''}</em></summary>
        ${d.legs.length ? `<table class="go-legs"><tbody>${d.legs.map(l => `<tr><td><b>${esc(l.from)}</b> → <b>${esc(l.to)}</b>${l.camp ? ' ⛺' : ''}<br><small>${l.km.toFixed(1)} km${l.h ? ` · ${fmtH(l.h)}` : ''}${l.up != null ? ` · ↑${l.up} m ↓${l.down} m` : ''}${l.mag != null ? ` · ${l.mag}° mag` : ''} · ${esc(l.gr)}</small></td></tr>`).join('')}</tbody></table>` : '<p class="small">No walking planned.</p>'}
        ${camp ? `<p>⛺ Camp: <b>${esc(camp.to)}</b> <small>${esc(camp.gr)}</small></p>` : ''}
        ${Object.keys(d.meals || {}).length ? `<p class="go-meals">${Object.entries(d.meals).map(([k, v]) => `<span><b>${esc(k)}:</b> ${v.map(esc).join(', ')}</span>`).join('<br>')}</p>` : ''}
      </details>`;
    };
    const cats = [...new Set(p.gear.map(g => g.cat))];
    $('#goMain').innerHTML = `
      <section class="go-card"><p><b>${esc(fmtDate(p.start))}${p.end && p.end !== p.start ? ' – ' + esc(fmtDate(p.end)) : ''}</b>${p.startTime ? ` · start walking ${esc(p.startTime)}` : ''}<br>
        ${esc([p.location, p.park, p.state].filter(Boolean).join(' · '))}</p>
        ${p.notes ? `<p class="small">${esc(p.notes)}</p>` : ''}
        <p class="small muted">Plan saved on this phone · updated ${packAt ? ago(packAt * 1000) : ''} <button class="go-link" id="pRef">check for changes</button></p></section>
      <section class="go-card" id="wxCard"></section>
      ${p.days.map(day).join('')}
      ${p.recipes.length ? `<details class="go-day"><summary><b>🍳 Recipes</b><em>${p.recipes.length}</em></summary>${p.recipes.map(r => `<p><b>${esc(r.name)}</b>${r.water ? ` <small>${r.water} mL water</small>` : ''}<br><small>${r.items.map(esc).join(' · ')}</small>${r.notes ? `<br>${esc(r.notes)}` : ''}</p>`).join('')}</details>` : ''}
      ${p.gear.length ? `<details class="go-day"><summary><b>🎒 Gear</b><em>${p.gear.length} items</em></summary>${cats.map(c => `<p><b>${esc(c)}</b><br>${p.gear.filter(g => g.cat === c).map(g => `<label class="go-tick"><input type="checkbox" data-gear="${esc(g.name + '|' + g.who)}"> ${g.qty > 1 ? g.qty + ' × ' : ''}${esc(g.name)} <small>${esc(g.who)}</small></label>`).join('')}</p>`).join('')}</details>` : ''}
      ${p.risks.length ? `<details class="go-day"><summary><b>⚠️ Risks</b><em>${p.risks.length}</em></summary>${p.risks.map(r => `<p><b>${esc(r.hazard)}</b>${r.where ? ` <small>${esc(r.where)}</small>` : ''}<br>${esc(r.controls)}</p>`).join('')}</details>` : ''}
      <p class="small muted go-foot">👥 ${p.people.map(esc).join(', ')}</p>`;
    $('#pRef').onclick = () => refreshPack();
    wxShow(); refreshWx(false);
    const ticks = store.get('gear', {});
    document.querySelectorAll('[data-gear]').forEach(cb => { cb.checked = !!ticks[cb.dataset.gear]; cb.onchange = () => { ticks[cb.dataset.gear] = cb.checked; store.set('gear', ticks); }; });
  }

  /* ---------- map ---------- */
  function mapScreen() {
    $('#goMain').innerHTML = `<div id="goMap"></div><div class="go-mapbar"><button class="go-btn small" id="mMe">📍 Me</button><button class="go-btn small" id="mFit">🥾 Route</button><button class="go-btn small" id="mSave">⬇ Save map for offline</button><span id="mMsg" class="small"></span></div>`;
    map = L.map('goMap', { zoomControl: true, attributionControl: true }).setView([-29.7, 152.9], 9);
    L.tileLayer(TILE, { subdomains: 'abc', maxNativeZoom: 16, maxZoom: 18, attribution: '© OpenStreetMap, SRTM | © OpenTopoMap' }).addTo(map);
    const pts = [];
    if (pack) {
      pack.map.trails.forEach(t => { L.polyline(t.coords, { color: '#fff', weight: 7, opacity: 0.8 }).addTo(map); L.polyline(t.coords, { color: t.color, weight: 4 }).addTo(map); t.coords.forEach(c => pts.push(c)); });
      pack.map.marks.forEach(m => { pts.push([m.lat, m.lon]); L.marker([m.lat, m.lon], { icon: L.divIcon({ className: 'go-mark', html: `<span>${m.icon}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) }).bindPopup(`<b>${esc(m.name)}</b><br><small>${esc(m.kind)} · ${esc(m.gr)}${m.notes ? '<br>' + esc(m.notes) : ''}</small>`).addTo(map); });
      if (pack.camp) { pts.push(pack.camp); }
    }
    const fit = () => { if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [25, 25], maxZoom: 15 }); };
    fit();
    $('#mFit').onclick = fit;
    $('#mMe').onclick = () => locate(true);
    $('#mSave').onclick = () => saveTiles(pts);
    if (lastFix) showMe(lastFix);
    locate(false);
  }
  function showMe(f) {
    if (!map) return;
    if (!meMarker) meMarker = L.circleMarker([f.lat, f.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#1971c2', fillOpacity: 1 }).addTo(map);
    meMarker.setLatLng([f.lat, f.lon]).bindPopup(`You are here<br><small>${Geo.grText(f.lat, f.lon)}<br>± ${Math.round(f.acc || 0)} m · ${ago(f.t * 1000)}</small>`);
  }
  function locate(centre) {
    if (!navigator.geolocation) return toast('This phone can\'t give its location');
    navigator.geolocation.getCurrentPosition(pos => {
      lastFix = fixOf(pos); store.set('lastFix', lastFix);
      showMe(lastFix);
      if (centre && map) map.setView([lastFix.lat, lastFix.lon], Math.max(map.getZoom(), 15));
    }, () => { if (centre) toast('Couldn\'t get your location — check location is allowed for this app'); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  }

  /* Save the map tiles around the route (zoom 10–15) so the map works without service */
  async function saveTiles(pts) {
    if (!pts.length) return toast('There is no route to save a map for yet');
    if (!navigator.onLine) return toast('You need service to download the map');
    const b = L.latLngBounds(pts).pad(0.15), list = [];
    const xy = (lat, lon, z) => { const n = 2 ** z; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; };
    for (let z = 10; z <= 15; z++) {
      const [x0, y0] = xy(b.getNorth(), b.getWest(), z), [x1, y1] = xy(b.getSouth(), b.getEast(), z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) list.push(TILE.replace('{s}', 'abc'[(x + y) % 3]).replace('{z}', z).replace('{x}', x).replace('{y}', y));
      if (list.length > 900) break;                     // big areas: stop at the zoom that fits
    }
    const todo = list.slice(0, 900), msg = $('#mMsg');
    let done = 0, failed = 0;
    const cache = await caches.open('go-tiles');
    const worker = async () => {
      while (todo.length) {
        const u = todo.shift();
        try { if (!(await cache.match(u))) { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await cache.put(u, r); else failed++; } } catch (e) { failed++; }
        done++;
        if (msg) msg.textContent = `Saving map… ${done} of ${done + todo.length}`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (msg) msg.textContent = failed ? `Saved, but ${failed} pieces failed — try again with better service` : '✓ Map saved on this phone';
    store.set('tilesAt', Date.now());
  }

  /* ---------- emergency ---------- */
  function helpScreen() {
    const f = lastFix;
    $('#goMain').innerHTML = `
      <section class="go-card go-sos"><button class="go-btn danger" id="hCall">📞 Call 000…</button>
        <p class="small">No service? Try <b>112</b>, move to high ground, or use the group's PLB. Give your grid reference.</p></section>
      <section class="go-card"><h2>📍 Where am I?</h2>
        <p id="hPos">${f ? posText(f) : 'Finding your location…'}</p><button class="go-btn small" id="hRef">↻ Update</button>
        <p class="small"><b>what3words:</b> Triple Zero call takers also accept a what3words address. The free <a href="https://www.triplezero.gov.au/triple-zero/smartphone-applications" target="_blank" rel="noopener">Emergency Plus app</a> shows yours, even without service. Install it before the trip.</p></section>
      <section class="go-card"><h2>Emergency plan</h2>
        ${pack && pack.emergency.length ? `<dl class="go-dl">${pack.emergency.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${linkPhones(esc(v))}</dd>`).join('')}</dl>` : '<p class="small">No emergency plan in the phone copy yet.</p>'}</section>`;
    const upd = () => navigator.geolocation && navigator.geolocation.getCurrentPosition(pos => { lastFix = fixOf(pos); store.set('lastFix', lastFix); const el = $('#hPos'); if (el) el.innerHTML = posText(lastFix); },
      () => { const el = $('#hPos'); if (el && !lastFix) el.textContent = 'Couldn\'t get your location.'; }, { enableHighAccuracy: true, timeout: 25000, maximumAge: 15000 });
    $('#hRef').onclick = upd; upd();
    $('#hCall').onclick = sosSlider;
  }
  /* Calling 000 takes a deliberate drag from the top of the screen to the bottom, so it can't happen by a stray tap */
  function sosSlider() {
    const o = document.createElement('div');
    o.className = 'go-sos-ov';
    o.innerHTML = `<p>Drag the phone down to the bottom to call <b>000</b></p>
      <div class="go-sos-track" id="sosTrack"><div class="go-sos-fill" id="sosFill"></div><div class="go-sos-end">000</div><div class="go-sos-knob" id="sosKnob" role="slider" aria-label="Drag down to call 000">📞</div></div>
      <button class="go-btn" id="sosCancel">Cancel</button>`;
    document.body.appendChild(o);
    const knob = $('#sosKnob', o), track = $('#sosTrack', o), fill = $('#sosFill', o);
    let startY = null, y = 0;
    const max = () => track.clientHeight - knob.offsetHeight;
    const place = v => { y = Math.max(0, Math.min(max(), v)); knob.style.transform = `translateY(${y}px)`; fill.style.height = `${y + knob.offsetHeight / 2}px`; track.classList.toggle('armed', y >= max() * 0.92); };
    const close = () => o.remove();
    knob.addEventListener('pointerdown', e => { startY = e.clientY - y; knob.setPointerCapture(e.pointerId); knob.classList.add('drag'); });
    knob.addEventListener('pointermove', e => { if (startY != null) place(e.clientY - startY); });
    const end = () => {
      if (startY == null) return;
      startY = null; knob.classList.remove('drag');
      if (y >= max() * 0.92) { close(); location.href = 'tel:000'; }
      else place(0);                                    // let go early: nothing happens
    };
    knob.addEventListener('pointerup', end);
    knob.addEventListener('pointercancel', () => { startY = null; knob.classList.remove('drag'); place(0); });
    $('#sosCancel', o).onclick = close;
  }

  /* ---------- weather forecast (saved on the phone; refreshed when there is service) ---------- */
  const WX_FRESH = 3 * 3600 * 1000;
  const wxCode = c => (c === 0 ? ['☀️', 'Clear'] : c <= 2 ? ['🌤️', 'Mostly sunny'] : c === 3 ? ['☁️', 'Cloudy'] : c <= 48 ? ['🌫️', 'Fog'] : c <= 57 ? ['🌦️', 'Drizzle'] : c <= 67 ? ['🌧️', 'Rain']
    : c <= 77 ? ['❄️', 'Snow'] : c <= 82 ? ['🌧️', 'Showers'] : c <= 86 ? ['🌨️', 'Snow showers'] : ['⛈️', 'Storms']);
  const wxPoint = () => (pack && (pack.camp || (pack.map.trails[0] && pack.map.trails[0].coords[0]) || (pack.map.marks[0] && [pack.map.marks[0].lat, pack.map.marks[0].lon]))) || null;
  function wxHtml() {
    const w = store.get('wx', null), pt = wxPoint();
    if (!pt) return '<h2>🌦️ Weather</h2><p class="small">The plan has no location yet, so there is no forecast.</p>';
    if (!w || !w.daily) return `<h2>🌦️ Weather</h2><p class="small">${navigator.onLine ? 'Getting the forecast…' : 'No forecast saved yet — it downloads when this phone has service.'}</p>`;
    const d = w.daily, old = Date.now() - w.at > 12 * 3600 * 1000;
    const inTrip = iso => pack.start && iso >= pack.start && iso <= (pack.end || pack.start);
    return `<h2>🌦️ Weather <small>${esc(pack.location || 'trip area')}</small></h2>
      <table class="go-wx"><tbody>${d.time.map((iso, i) => { const [ic, label] = wxCode(d.weather_code[i]); const rain = d.precipitation_sum[i], pr = d.precipitation_probability_max[i];
        return `<tr class="${inTrip(iso) ? 'trip' : ''}"><td><b>${esc(fmtDate(iso).split(',')[0])}</b><br><small>${esc(fmtDate(iso).split(',').slice(1).join(',').trim())}</small></td>
          <td class="ic" title="${label}">${ic}<br><small>${label}</small></td>
          <td><b>${Math.round(d.temperature_2m_max[i])}°</b> / ${Math.round(d.temperature_2m_min[i])}°</td>
          <td>${pr != null ? `💧 ${pr}%` : ''}${rain >= 0.2 ? `<br><small>${rain.toFixed(rain < 10 ? 1 : 0)} mm</small>` : ''}</td>
          <td>💨 ${Math.round(d.wind_speed_10m_max[i])}<br><small>gusts ${Math.round(d.wind_gusts_10m_max[i])} km/h</small></td></tr>`; }).join('')}</tbody></table>
      <p class="small ${old ? 'go-err' : ''}">Forecast downloaded ${ago(w.at)}${old ? ' — it may be out of date' : ''}. <button class="go-link" id="wxRef">update</button><br>Highlighted days are the trip. Check for warnings before you go; conditions in the hills can differ.</p>`;
  }
  function wxShow() {
    const el = $('#wxCard');
    if (!el) return;
    el.innerHTML = wxHtml();
    const b = $('#wxRef'); if (b) b.onclick = () => (navigator.onLine ? refreshWx(true) : toast('No service — showing the saved forecast'));
  }
  async function refreshWx(force) {
    const pt = wxPoint(), w = store.get('wx', null);
    if (!pt || !navigator.onLine) return;
    const moved = w && (Math.abs(w.lat - pt[0]) > 0.05 || Math.abs(w.lon - pt[1]) > 0.05);
    if (!force && w && !moved && Date.now() - w.at < WX_FRESH) return;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pt[0]}&longitude=${pt[1]}&timezone=auto&forecast_days=7&wind_speed_unit=kmh` +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max');
      const j = await r.json();
      if (!r.ok || !j.daily) throw new Error('no forecast');
      store.set('wx', { at: Date.now(), lat: pt[0], lon: pt[1], daily: j.daily });
      wxShow();
      if (force) toast('Forecast updated');
    } catch (e) { if (force) toast('Couldn\'t get the forecast just now'); }
  }

  const posText = f => `<b class="go-gr">${Geo.grText(f.lat, f.lon)}</b><br>${Geo.mgaText(f.lat, f.lon)}<br>${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}${f.alt != null ? ` · ${Math.round(f.alt)} m` : ''}<br><small>± ${Math.round(f.acc || 0)} m · ${ago(f.t * 1000)}</small>`;
  const linkPhones = s => s.replace(/(\+?\d[\d ]{7,}\d)/g, m => `<a href="tel:${m.replace(/\s/g, '')}">${m}</a>`);

  /* ---------- status and a one-line message for the leaders ---------- */
  const STATUS = { ok: ['✅', 'OK — on the move'], stopped: ['⏸️', 'Stopped'], problem: ['🛠️', 'Sorting out a minor problem'], contact: ['📞', 'Trying to contact home base'], alert: ['🚨', 'ALERT — we need help'] };
  let say = store.get('say', null);            // { status, note, message, t, sent }
  async function sendSay() {
    if (!say || say.sent || !me || !navigator.onLine) return;
    try {
      await call('say', { token: me.token, status: say.status, note: say.note, message: say.message, t: say.t });
      say.sent = true; store.set('say', say);
      const el = $('#stSent'); if (el) el.textContent = '✓ Sent to the leaders just now';
    } catch (e) { if (e.status === 401) kicked(e.message); }
  }
  function statusCard() {
    const cur = say || { status: '', note: '', message: '' };
    return `<section class="go-card"><h2>📣 My status</h2>
      <div class="go-status">${Object.entries(STATUS).map(([k, [ic, label]]) => `<button type="button" class="${cur.status === k ? 'on' : ''}" data-st="${k}"><span>${ic}</span>${label}${k === 'stopped' ? ' — for…' : ''}</button>`).join('')}</div>
      <label id="stNoteWrap" ${cur.status === 'stopped' ? '' : 'hidden'}>Stopped for<input id="stNote" maxlength="60" placeholder="e.g. lunch, a swim, the night" value="${esc(cur.note || '')}"></label>
      <label>Message <small>(one line, optional)</small><input id="stMsg" maxlength="140" placeholder="e.g. At Red Cliff, all well" value="${esc(cur.message || '')}"></label>
      <button class="go-btn primary" id="stSend">Send to the leaders</button>
      <p class="small" id="stSent">${say ? (say.sent ? `✓ Sent ${ago(say.t * 1000)}` : '⏳ Will send as soon as this phone has service') : 'Nothing sent yet'}</p>
      <p class="small">This is not for emergencies — call 000.</p></section>`;
  }
  function bindStatus() {
    let pick = say ? say.status : '';
    document.querySelectorAll('[data-st]').forEach(b => { b.onclick = () => {
      pick = b.dataset.st;
      document.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b));
      $('#stNoteWrap').hidden = pick !== 'stopped';
      if (pick === 'stopped') $('#stNote').focus();
    }; });
    $('#stSend').onclick = () => {
      if (!pick) return toast('Choose a status first');
      say = { status: pick, note: pick === 'stopped' ? $('#stNote').value.trim() : '', message: $('#stMsg').value.trim(), t: Math.round(Date.now() / 1000), sent: false };
      store.set('say', say);
      $('#stSent').textContent = navigator.onLine ? 'Sending…' : '⏳ Will send as soon as this phone has service';
      sendSay();
      if (sharing && lastFix && Date.now() / 1000 - lastFix.t < 120) queueFix({ ...lastFix, t: Math.round(Date.now() / 1000) }, true);   // where the status was sent from
      else if (sharing) takeFix(false);
    };
  }

  /* ---------- location sharing ---------- */
  const fixOf = pos => ({ t: Math.round(pos.timestamp / 1000), lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6), acc: pos.coords.accuracy, alt: pos.coords.altitude, spd: pos.coords.speed });

  function shareScreen() {
    const q = store.get('queue', []).length;
    $('#goMain').innerHTML = `${statusCard()}
      <section class="go-card"><h2>📡 Share my location</h2>
        <label class="go-switch"><input type="checkbox" id="sOn" ${sharing ? 'checked' : ''}><span></span> ${sharing ? 'On — sharing with the trip\'s leaders' : 'Off'}</label>
        <p class="small">When on, this phone sends its position about every 30 seconds while moving (every 2 minutes when stopped), <b>while this app is open</b>. Only this trip's leaders can see it. Without service, positions are saved and sent later.</p>
        <p id="sStat" class="small">${shareMsg || (lastSent ? `Last sent ${ago(lastSent)}` : 'Nothing sent yet')}${q ? ` · ${q} waiting to send` : ''}</p>
        <label class="go-tick"><input type="checkbox" id="sWake" ${store.get('wake', false) ? 'checked' : ''}> Keep the screen on while sharing <small>(uses more battery — dim the screen)</small></label>
      </section>
      <section class="go-card"><h2>This phone</h2>
        <p>${esc(me.name)} · ${esc(me.trip.name)}</p>
        <p class="small">To put this app on your home screen: in your browser menu choose <b>Add to Home Screen</b> (iPhone: the Share button first).</p>
        <button class="go-btn small" id="sLeave">Leave this trip</button></section>`;
    bindStatus();
    $('#sOn').onchange = e => (e.target.checked ? startSharing(true) : (stopSharing(), render()));
    $('#sWake').onchange = e => { store.set('wake', e.target.checked); wakeLock(); };
    $('#sLeave').onclick = async () => {
      if (!confirm('Leave this trip? The plan is removed from this phone and it stops sharing its location.')) return;
      stopSharing();
      try { await call('leave', { token: me.token }); } catch (e) { /* offline: forget locally anyway */ }
      me = null; pack = null; say = null; ['me', 'queue', 'pack', 'packAt', 'gear', 'lastSent', 'say', 'wx'].forEach(k => store.del(k));
      try { await caches.delete('go-data'); } catch (e) { /* ignore */ }
      render();
    };
  }

  function startSharing(ask) {
    if (!navigator.geolocation) return toast('This phone can\'t give its location');
    sharing = true; store.set('sharing', true);
    clearInterval(timer);
    takeFix(ask);
    timer = setInterval(() => takeFix(false), STILL_MS);      // safety net if the phone stops giving live positions
    watch();
    wakeLock();
    if (tab === 'share') render(); else net();
  }
  function stopSharing() {
    sharing = false; store.set('sharing', false);
    clearInterval(timer); timer = null;
    watch();
    if (wake) { try { wake.release(); } catch (e) { /* ignore */ } wake = null; }
    net();
  }
  async function wakeLock() {
    if (wake) { try { await wake.release(); } catch (e) { /* ignore */ } wake = null; }
    if (sharing && store.get('wake', false) && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      try { wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed right now */ }
    }
  }
  /* Follow the phone's position while the app is open: moves the "me" dot on the map straight away, and (when
     sharing) queues a position every 30 s while moving, every 2 min while still. */
  let watchId = null, lastQueued = store.get('lastQueued', null);
  function watch() {
    const want = me && document.visibilityState === 'visible' && (sharing || tab === 'map') && navigator.geolocation && navigator.geolocation.watchPosition;
    if (!want) { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } return; }
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(pos => {
      const f = fixOf(pos);
      lastFix = f; store.set('lastFix', f);
      showMe(f);
      if (sharing) queueFix(f, false);
    }, () => { /* takeFix reports problems */ }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 60000 });
  }
  async function queueFix(f, force) {
    const since = lastQueued ? (f.t - lastQueued.t) * 1000 : Infinity;
    const moved = lastQueued ? Geo.hav([lastQueued.lat, lastQueued.lon], [f.lat, f.lon]) : Infinity;
    if (!force && !(since >= STILL_MS || (since >= MOVING_MS && moved >= Math.max(MOVED_M, (f.acc || 0) * 0.7)))) return;
    if (since <= 0) return;
    lastQueued = { t: f.t, lat: f.lat, lon: f.lon }; store.set('lastQueued', lastQueued);
    try { if (navigator.getBattery) f.batt = Math.round((await navigator.getBattery()).level * 100); } catch (e) { /* no battery info */ }
    const q = store.get('queue', []);
    q.push(f);
    store.set('queue', q.slice(-QUEUE_MAX));
    shareMsg = '';
    flush();
  }

  function takeFix(ask) {
    if (!sharing || document.visibilityState !== 'visible') return;
    navigator.geolocation.getCurrentPosition(async pos => {
      const f = fixOf(pos);
      lastFix = f; store.set('lastFix', f);
      showMe(f);
      queueFix(f, false);
    }, err => {
      shareMsg = err.code === 1 ? '⚠ Location is blocked for this app — allow it in your phone\'s settings.' : '⚠ Couldn\'t get a position just now.';
      if (err.code === 1 && ask) { stopSharing(); }
      if (tab === 'share') render();
    }, { enableHighAccuracy: true, timeout: 45000, maximumAge: 60000 });
  }
  async function flush() {
    if (sending || !me || !navigator.onLine) return net();
    const q = store.get('queue', []);
    if (!q.length) return net();
    sending = true;
    try {
      const batch = q.slice(0, 400);
      await call('report', { token: me.token, points: batch });
      store.set('queue', store.get('queue', []).slice(batch.length));
      lastSent = Date.now(); store.set('lastSent', lastSent);
      const el = $('#sStat'); if (el) el.textContent = 'Last sent just now';
    } catch (e) {
      if (e.status === 401) { sending = false; return kicked(e.message); }
    }
    sending = false;
    net();
    if (store.get('queue', []).length && navigator.onLine) setTimeout(flush, 1500);
  }

  /* ---------- start ---------- */
  async function init() {
    $('#goNav').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) { tab = b.dataset.tab; render(); window.scrollTo(0, 0); } });
    window.addEventListener('online', () => { net(); flush(); sendSay(); refreshPack(true); refreshWx(false); });
    window.addEventListener('offline', net);
    document.addEventListener('visibilitychange', () => { watch(); if (document.visibilityState === 'visible') { if (sharing) { takeFix(false); wakeLock(); } flush(); } });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (me) pack = await loadPack();
    render();
    if (me) { refreshPack(true); if (sharing) startSharing(false); flush(); sendSay(); }
  }
  init();
})();
