/* Camp Planner — phone app support for a trip's team (owner, co-planners, superusers):
     • build the "field pack" (the plan as the phone app shows it) and send it to the website;
     • the join code phones use to join the trip;
     • live locations of joined phones on the Map tab, and exporting the recorded tracks (GPX).
   Server: api/track.php. Phone app: go.html. */

const Live = (() => {
  const POLL_MS = 10000;
  const COLORS = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#c2255c', '#0c8599', '#f08c00', '#5f3dc4'];
  let emptyAt = 0;
  let status = null, err = '', showing = false, layer = null, timer = null, busy = false, lastLive = null;
  const el = () => $('#livePanel');
  const allowed = () => !!(Store.tripId && Store.access && Store.access.canEdit);
  const ago = t => { const m = Math.max(0, (Date.now() / 1000 - t) / 60); return m < 1 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const STATUS = { ok: ['✅', 'OK — on the move'], stopped: ['⏸️', 'Stopped'], problem: ['🛠️', 'Sorting out a minor problem'], contact: ['📞', 'Trying to contact home base'] };
  const statusText = d => (d.status && STATUS[d.status] ? STATUS[d.status][1] + (d.status === 'stopped' && d.note ? ` — for ${d.note}` : '') : '');
  const goUrl = code => location.origin + location.pathname.replace(/[^/]*$/, '') + 'go.html' + (code ? '?code=' + code : '');

  /* ---------- the field pack ---------- */
  const thin = (c, max) => { const st = Math.max(1, Math.ceil(c.length / max)); return c.filter((_, i) => i % st === 0 || i === c.length - 1).map(p => [+(+p[0]).toFixed(5), +(+p[1]).toFixed(5)]); };

  function buildPack() {
    const s = Store.state, t = s.trip, days = tripDays();
    const trails = s.map.features.filter(f => f.type === 'trail');
    const recipe = id => s.recipes.find(r => r.id === id);
    /* walking days from the route card (needs the terrain profile; falls back to distances only) */
    const walk = [];
    trails.forEach(f => {
      if (Traverse.hasProfile(f)) {
        const T = Traverse.analyse(f);
        T.legs.forEach(l => walk.push({ trail: f.name, day: l.day, from: l.from.name, to: l.to.name, km: +(l.dist / 1000).toFixed(2), h: +l.hours.toFixed(2), up: Math.round(l.ascent), down: Math.round(l.descent),
          mag: Math.round(((l.magB % 360) + 360) % 360), camp: l.to.kind === 'campsite' || !!l.to.night, gr: Geo.grText(l.to.lat, l.to.lng) }));
      } else {
        Traverse.daySegments(f).forEach(D => walk.push({ trail: f.name, day: D.day, from: D.from.name, to: D.to.name, km: +D.km.toFixed(2), camp: D.to.kind === 'campsite' || !!D.to.night, gr: Geo.grText(D.to.lat, D.to.lng) }));
      }
    });
    const emergency = Risk.EMERGENCY.filter(([k]) => k !== 'medical')          // medical notes stay with the leaders
      .map(([k, label]) => [label, k === 'number' ? (s.emergency[k] || '000 (112 from mobiles)') : (s.emergency[k] || '')]).filter(x => x[1]);
    return {
      v: 1, built: Date.now(), name: t.name, start: t.start, end: t.end, startTime: t.startTime || '', location: t.location || '',
      park: t.park ? `${t.park.name} ${t.park.type}` : '', state: t.state || '', notes: t.notes || '', people: s.people.map(p => p.name),
      camp: t.lat != null ? [t.lat, t.lon] : null,
      days: days.map((d, i) => ({
        n: i + 1, date: d.date ? isoDate(d.date) : '', legs: walk.filter(w => w.day === i + 1),
        meals: Object.fromEntries(Meals.SLOTS.map(([slot, label]) => [label, ((s.mealPlan[d.key] || {})[slot] || []).map(e => (recipe(e.recipeId) || {}).name).filter(Boolean)]).filter(x => x[1].length))
      })),
      recipes: Meals.usedRecipes().map(r => ({ name: r.name, items: r.ingredients.filter(i => i.name).map(i => `${i.qty} ${i.unit} ${i.name}`), water: num(r.waterMl), notes: r.notes || '' })),
      gear: s.gear.map(g => ({ name: g.name, qty: num(g.qty, 1), cat: g.category, who: personName(g.carrier) })),
      risks: s.risks.map(r => ({ hazard: r.hazard, where: r.location || '', controls: r.controls || '', score: Risk.score(r.rl || r.l, r.rc || r.c) })),
      emergency,
      map: {
        trails: trails.filter(f => !MapView.isHidden(f)).map(f => ({ name: f.name, color: f.color || '#c92a2a', coords: thin(f.coords, 1500) })),
        marks: s.map.features.filter(f => f.type === 'landmark').map(f => ({ name: f.name, kind: (MapView.KINDS[f.kind] || MapView.KINDS.waypoint).label, icon: (MapView.KINDS[f.kind] || MapView.KINDS.waypoint).icon,
          lat: f.lat, lon: f.lng, notes: f.notes || '', gr: Geo.grText(f.lat, f.lng) }))
      }
    };
  }

  async function sendPack() {
    await Store.persist();
    const r = await Server.call('track.php?action=pack_save', { id: Store.tripId, pack: buildPack() });
    status.packAt = r.packAt;
    toast('Plan sent to the phone app — phones pick it up next time they have service');
    render();
  }

  /* ---------- panel ---------- */
  async function load() {
    if (!allowed()) return;
    try { status = await Server.call('track.php?action=status&id=' + encodeURIComponent(Store.tripId)); err = ''; }
    catch (e) { err = e.message; }
    render();
  }

  function render() {
    const p = el();
    if (!p) return;
    if (!allowed()) { p.hidden = true; return; }
    p.hidden = false;
    if (!status) { p.innerHTML = `<h3>📱 Phone app &amp; live locations</h3><p class="small muted">${err ? esc(err) : 'Loading…'}</p>`; return; }
    const st = status, active = st.devices.filter(d => !d.revoked && !(st.trackers || []).some(k => k.device === d.id));
    const trk = st.trackers || [], dt = t => new Date(t * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const stale = st.packAt && Store.updated && Store.updated / 1000 > st.packAt + 60;
    p.innerHTML = `
      <h3>📱 Phone app &amp; live locations</h3>
      <p class="small"><b>1. Plan on phones:</b> ${st.packAt ? `sent ${ago(st.packAt)}${stale ? ' — <span class="warn-text">the plan has changed since</span>' : ''}` : '<span class="warn-text">not sent yet</span>'}
        <button class="btn small ${!st.packAt || stale ? 'primary' : ''}" data-live="pack">📤 ${st.packAt ? 'Send again' : 'Send plan to phones'}</button></p>
      <p class="small"><b>2. Join code:</b> ${st.joinCode ? `<b class="live-code">${esc(st.joinCode.slice(0, 4))} ${esc(st.joinCode.slice(4))}</b>
          <button class="btn small" data-live="copy" title="Copy a link that opens the phone app with the code filled in">📋 Copy join link</button>
          <button class="btn small" data-live="newcode" title="Make a new code — the old one stops working for new phones">↻</button>
          <button class="btn small" data-live="nocode" title="Stop new phones joining">✕</button>`
        : `joining is off <button class="btn small primary" data-live="newcode">Make a join code</button>`}</p>
      <p class="hint">On each phone open <b>${esc(goUrl().replace(/^https?:\/\//, ''))}</b>, enter the code and a name, then “Add to Home Screen”. No account needed.</p>
      <p class="small"><b>3. Phones:</b> ${active.length ? '' : '<span class="muted">none joined yet</span>'}</p>
      <div id="liveDevs">${devTable(active)}</div>
      <p class="small"><b>4. Satellite trackers</b> <small class="muted">(SPOT, Garmin inReach)</small> <button class="btn small" data-live="trkform">＋ Add a tracker</button></p>
      ${trk.length ? `<div class="live-devs">${trk.map(k => `<div class="live-dev" data-trk="${k.id}"><span>🛰 <b>${esc(k.label)}</b> <small class="muted">${k.kind === 'spot' ? 'SPOT' : 'Garmin'} · ${esc(k.feed)}${k.hasPass ? ' · 🔑' : ''}<br>
          ${dt(k.from)} → ${dt(k.to)} · ${k.active ? '<span class="ok">tracking now</span>' : Date.now() / 1000 < k.from ? 'not started' : 'finished'}<br>${esc(k.status || 'not read yet')}${k.polled ? ` · read ${ago(k.polled)}` : ''}</small></span>
          <button class="icon-btn" data-live="trktest" title="Read the feed now">↻</button><button class="icon-btn" data-live="trkdel" title="Remove this tracker (positions already recorded are kept)">✕</button></div>`).join('')}</div>` : ''}
      <div id="trkForm"></div>
      <label class="check"><input type="checkbox" data-live="show" ${showing ? 'checked' : ''}> Show live locations on the map <small class="muted" id="liveUpdated"></small></label>
      <div class="btn-row"><button class="btn small" data-live="gpx" ${st.points ? '' : 'disabled'}>⬇ Export tracks (GPX)</button><button class="btn small" data-live="json" ${st.points ? '' : 'disabled'}>⬇ Data (JSON)</button>
        <button class="btn small" data-live="refresh">↻</button></div>
      <p class="hint">${st.points ? `${st.points.toLocaleString()} positions recorded${st.first ? ` since ${new Date(st.first * 1000).toLocaleDateString()}` : ''}. ` : ''}Only this trip's leaders and superusers can see locations. Positions are deleted after ${Math.round(st.keepDays / 365)} year — export the tracks to keep them.
        ${st.points ? '<button class="linkish" data-live="clear">Delete all positions now</button>' : ''}</p>`;
  }

  /* The small table beside the map: each phone's status, message and when it was last heard from */
  function devTable(active) {
    if (!active.length) return '';
    const all = status.devices.filter(d => !d.revoked);
    return `<table class="tbl compact live-tbl"><thead><tr><th>Phone</th><th>Status</th><th></th></tr></thead><tbody>${active.map(d => {
      const col = COLORS[all.indexOf(d) % COLORS.length], st = d.status && STATUS[d.status];
      return `<tr data-dev="${d.id}" class="${d.status === 'problem' || d.status === 'contact' ? 'live-alert' : ''}"><td><i class="live-sw" style="background:${col}"></i><b>${esc(d.name)}</b><br>
          <small class="muted">${d.seen ? 'heard ' + ago(d.seen) : 'not heard from yet'}</small>${d.move ? `<br><small class="live-move"><i style="transform: rotate(${d.move.brg.toFixed(0)}deg)">↑</i> ${motionText(d.move)}</small>` : ''}</td>
        <td>${st ? `${st[0]} ${esc(statusText(d))}` : '<span class="muted">—</span>'}${d.message ? `<br><i>“${esc(d.message)}”</i>` : ''}${d.statusAt ? `<br><small class="muted">${ago(d.statusAt)}</small>` : ''}</td>
        <td class="nowrap"><button class="icon-btn" data-live="zoom" title="Show on the map">🔍</button><button class="icon-btn" data-live="revoke" title="Remove this phone from the trip">✕</button></td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function refreshDevs() {
    const el = $('#liveDevs');
    if (!el || !status || !lastLive) return;
    lastLive.devices.forEach(d => { const s = status.devices.find(x => x.id === d.id); if (s) Object.assign(s, { seen: d.seen, points: d.points, status: d.status, note: d.note, message: d.message, statusAt: d.statusAt, move: motionOf(d, lastLive.now) }); });
    el.innerHTML = devTable(status.devices.filter(d => !d.revoked && !(status.trackers || []).some(k => k.device === d.id)));
  }

  /* ---------- live layer ---------- */
  async function poll() {
    /* Runs all the time for the trip's team (not only when live locations are ticked), so a change of status or
       a new message shows within seconds. Markers are only drawn when "Show live locations" is ticked. */
    if (busy || !allowed() || !status || document.hidden) return;
    /* nobody joined yet: just look once a minute for the first phone */
    if (!status.devices.some(d => !d.revoked) && !(status.trackers || []).length) { if (Date.now() - emptyAt < 60000) return; emptyAt = Date.now(); }
    busy = true;
    try {
      lastLive = await Server.call('track.php?action=live&id=' + encodeURIComponent(Store.tripId));
      const map = MapView.getMap();
      if (showing && map) draw(map);
      announce();
      refreshDevs();
      const up = $('#liveUpdated'); if (up) up.textContent = 'updated ' + new Date().toLocaleTimeString();
    } catch (e) { /* try again next time */ }
    busy = false;
  }

  /* Speed and direction of travel, from the recent trail: the latest position against one 1–5 minutes earlier and
     at least 25 m away. Null when the phone is stopped, or hasn't been heard from for 5 minutes. */
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function motionOf(d, now) {
    const tr = d.trail || [];
    if (tr.length < 2) return null;
    const b = tr[tr.length - 1];
    if (now - b[2] > 300) return null;
    let a = null;
    for (let i = tr.length - 2; i >= 0; i--) {
      const dt = b[2] - tr[i][2];
      if (dt > 300) break;
      if (dt >= 60) { a = tr[i]; break; }
      a = tr[i];                                            // closer together than a minute: use it only if nothing older
    }
    if (!a || b[2] - a[2] < 20) return null;
    const m = Geo.hav([a[0], a[1]], [b[0], b[1]]), secs = b[2] - a[2];
    if (m < 25) return null;                                // GPS wobble, not walking
    const kmh = m / secs * 3.6;
    if (kmh < 0.8 || kmh > 160) return null;
    const brg = (Geo.bearing([a[0], a[1]], [b[0], b[1]]) + 360) % 360;
    return { kmh, brg, dir: COMPASS[Math.round(brg / 45) % 8] };
  }
  const motionText = m => (m ? `${m.kmh < 10 ? m.kmh.toFixed(1) : Math.round(m.kmh)} km/h ${m.dir}` : '');

  function draw(map) {
    if (!layer) layer = L.layerGroup().addTo(map);
    layer.clearLayers();
    const now = lastLive.now;
    lastLive.devices.filter(d => d.last).forEach((d, i) => {
      const col = COLORS[i % COLORS.length], old = now - d.last.t > 1800, mv = motionOf(d, now);
      d.move = mv;
      /* an arrow from the position, pointing the way they're heading (longer when faster) */
      if (mv) {
        const len = Math.round(Math.max(34, Math.min(80, 30 + mv.kmh * 6)));
        L.marker([d.last.lat, d.last.lon], { interactive: false, zIndexOffset: 1500, icon: L.divIcon({ className: 'live-arrow', iconSize: [0, 0],
          html: `<svg width="24" height="${len}" viewBox="0 0 24 ${len}" style="transform: translate(-12px, -${len}px) rotate(${mv.brg.toFixed(0)}deg); transform-origin: 12px ${len}px">
            <line x1="12" y1="${len}" x2="12" y2="12" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M12 0 L22 16 L2 16 Z" fill="#fff"/>
            <line x1="12" y1="${len}" x2="12" y2="13" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/><path d="M12 3 L19 14.5 L5 14.5 Z" fill="${col}"/></svg>` }) }).addTo(layer);
      }
      if (d.trail.length > 1) L.polyline(d.trail.map(p => [p[0], p[1]]), { color: col, weight: 3, opacity: 0.7, dashArray: '4 5', interactive: false }).addTo(layer);
      if (d.last.acc && d.last.acc > 30) L.circle([d.last.lat, d.last.lon], { radius: d.last.acc, color: col, weight: 1, fillOpacity: 0.08, interactive: false }).addTo(layer);
      L.marker([d.last.lat, d.last.lon], { zIndexOffset: 2000, icon: L.divIcon({ className: 'live-icon', html: `<span class="live-dot ${old ? 'old' : ''}" style="--c:${col}"></span><b class="${d.status === 'problem' || d.status === 'contact' ? 'alert' : ''}" style="${mv && mv.brg > 20 && mv.brg < 160 ? `position:absolute; right:100%; margin-right:5px; white-space:nowrap; top:${(i % 3 - 1) * 17}px` : `position:relative; top:${(i % 3 - 1) * 17}px`}" title="${esc(statusText(d))}">${d.status && STATUS[d.status] ? STATUS[d.status][0] + ' ' : ''}${esc(d.name)}${mv ? ` · ${motionText(mv)}` : ''}</b>`, iconSize: [240, 22], iconAnchor: [9, 11] }) })
        .bindPopup(`<b>${esc(d.name)}</b><br>${d.status && STATUS[d.status] ? `${STATUS[d.status][0]} <b>${esc(statusText(d))}</b>${d.statusAt ? ` <small>(${ago(d.statusAt)})</small>` : ''}<br>` : ''}${d.message ? `<i>“${esc(d.message)}”</i><br>` : ''}${mv ? `➤ Moving <b>${motionText(mv)}</b> (${Math.round(mv.brg)}° true)<br>` : ''}<small>${new Date(d.last.t * 1000).toLocaleString()} (${ago(d.last.t)})<br>${Geo.grText(d.last.lat, d.last.lon)} · ${d.last.lat.toFixed(5)}, ${d.last.lon.toFixed(5)}
          ${d.last.acc != null ? `<br>± ${d.last.acc} m` : ''}${d.last.alt != null ? ` · ${d.last.alt} m high` : ''}${d.last.batt != null ? ` · 🔋 ${d.last.batt}%` : ''}</small>`)
        .addTo(layer);
    });
  }

  function setShowing(on) {
    showing = on;
    if (on) poll();
    else if (layer) { layer.remove(); layer = null; }
  }

  /* Say so when a phone's status or message changes (and when a new phone joins) */
  const heard = new Map();
  let firstPoll = true;
  function announce() {
    const fresh = [];
    lastLive.devices.forEach(d => {
      const prev = heard.get(d.id);
      if (!firstPoll && d.statusAt && (!prev || d.statusAt > prev)) fresh.push(d);
      if (!status.devices.some(x => x.id === d.id)) status.devices.push({ ...d });             // joined since the page loaded
      heard.set(d.id, d.statusAt || 0);
    });
    firstPoll = false;
    if (!fresh.length) return;
    const d = fresh[fresh.length - 1], st = STATUS[d.status];
    toast(`${st ? st[0] + ' ' : ''}${d.name}: ${statusText(d) || 'new message'}${d.message ? ` — “${d.message}”` : ''}`, 8000);
    setTimeout(() => fresh.forEach(x => { const tr = document.querySelector(`.live-tbl tr[data-dev="${x.id}"]`); if (tr) tr.classList.add('live-new'); }), 50);
  }

  /* ---------- export ---------- */
  async function exportTracks(kind) {
    const j = await Server.call('track.php?action=export&id=' + encodeURIComponent(Store.tripId));
    const base = safeName(Store.state.trip.name) + '-tracks';
    if (kind === 'json') return download(base + '.json', JSON.stringify(j));
    const x = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Grafton Scout Group Camp Planner" xmlns="http://www.topografix.com/GPX/1/1">\n` +
      j.tracks.map(t => `<trk><name>${x(t.name)} — ${x(j.trip)}</name><trkseg>\n${t.points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.alt != null ? `<ele>${p.alt}</ele>` : ''}<time>${new Date(p.t * 1000).toISOString()}</time></trkpt>`).join('\n')}\n</trkseg></trk>`).join('\n') + '\n</gpx>\n';
    download(base + '.gpx', gpx);
  }

  /* Add a SPOT / Garmin tracker for this event: defaults to the trip's dates */
  function trackerForm() {
    const t = Store.state.trip, local = (iso, time) => (iso ? `${iso}T${time}` : '');
    $('#trkForm').innerHTML = `<div class="pub-ask live-form">
      <label class="field"><span>Tracker</span><select name="kind"><option value="spot">SPOT (Gen4, SPOT X, Trace)</option><option value="garmin">Garmin inReach</option></select></label>
      <label class="field"><span>Name (who carries it)</span><input name="label" maxlength="36" placeholder="e.g. Group SPOT – Sam"></label>
      <label class="field"><span id="trkFeedLbl">SPOT feed ID</span><input name="feed" maxlength="200" autocomplete="off" placeholder="paste the ID or the whole link"></label>
      <label class="field"><span>Feed password (if it has one)</span><input name="pass" maxlength="100" autocomplete="off"></label>
      <div class="row"><label class="field"><span>Track from</span><input type="datetime-local" name="from" value="${local(t.start, '00:00')}"></label>
        <label class="field"><span>until</span><input type="datetime-local" name="to" value="${local(t.end || t.start, '23:59')}"></label></div>
      <p class="hint" id="trkHint"></p>
      <div class="btn-row"><button class="btn small primary" data-live="trksave">Add and test</button><button class="btn small" data-live="trkcancel">Cancel</button></div></div>`;
    const kind = $('#trkForm [name=kind]'), hint = () => {
      const g = kind.value === 'garmin';
      $('#trkFeedLbl').textContent = g ? 'Garmin MapShare name' : 'SPOT feed ID';
      $('#trkHint').innerHTML = g ? 'In Garmin Explore: <b>Social → MapShare</b>, switch MapShare on. The name is the last part of your <i>share.garmin.com/…</i> link.'
        : 'In your SPOT account: <b>XML Feed → Create XML Feed</b>, tick the device and all message types, then <b>View Details</b> for the feed ID.';
    };
    kind.onchange = hint; hint();
  }

  function bind() {
    const p = el();
    if (!p || p.dataset.bound) return;
    p.dataset.bound = '1';
    p.addEventListener('change', e => { if (e.target.dataset.live === 'show') setShowing(e.target.checked); });
    p.addEventListener('click', async e => {
      const b = e.target.closest('[data-live]');
      if (!b || b.tagName === 'INPUT') return;
      const act = b.dataset.live, id = Store.tripId;
      try {
        if (act === 'pack') await sendPack();
        else if (act === 'newcode') {
          if (status.joinCode && !confirm('Make a new join code? Phones already joined keep working; the old code stops working for new phones.')) return;
          status.joinCode = (await Server.call('track.php?action=code', { id, on: true })).joinCode; render();
        } else if (act === 'nocode') { await Server.call('track.php?action=code', { id, on: false }); status.joinCode = null; render(); }
        else if (act === 'copy') {
          const link = goUrl(status.joinCode);
          (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Join link copied — send it to the people going')).catch(() => window.prompt('Copy this link', link));
        } else if (act === 'refresh') { await load(); poll(); }
        else if (act === 'trkform') trackerForm();
        else if (act === 'trkcancel') $('#trkForm').innerHTML = '';
        else if (act === 'trksave') {
          const f = $('#trkForm'), v = n => f.querySelector(`[name=${n}]`).value.trim(), ts = n => Math.floor(new Date(v(n)).getTime() / 1000);
          const r = await Server.call('track.php?action=tracker_add', { id, kind: v('kind'), label: v('label'), feed: v('feed'), pass: v('pass'), from: ts('from'), to: ts('to') });
          status.trackers = r.trackers; render();
          toast((r.test.ok ? '✓ Tracker added. ' : '⚠ Tracker added, but: ') + r.test.status, 7000);
          await load();
        } else if (act === 'trktest') {
          const r = await Server.call('track.php?action=tracker_test', { id, tracker: +b.closest('[data-trk]').dataset.trk });
          status.trackers = r.trackers; render(); toast((r.test.ok ? '✓ ' : '⚠ ') + r.test.status, 6000); poll();
        } else if (act === 'trkdel') {
          if (!confirm('Remove this tracker from the trip? Positions already recorded are kept for export.')) return;
          status.trackers = (await Server.call('track.php?action=tracker_remove', { id, tracker: +b.closest('[data-trk]').dataset.trk })).trackers; render();
        }
        else if (act === 'gpx' || act === 'json') await exportTracks(act);
        else if (act === 'clear') {
          if (!confirm('Delete every recorded position for this trip? Export the tracks first if you want to keep them.')) return;
          await Server.call('track.php?action=clear', { id }); await load(); poll();
        } else if (act === 'revoke') {
          const dev = +b.closest('[data-dev]').dataset.dev, d = status.devices.find(x => x.id === dev);
          if (!confirm(`Remove ${d.name}'s phone from this trip? It stops sharing its location and can't open the plan until it joins again.`)) return;
          status.devices = (await Server.call('track.php?action=device', { id, device: dev, revoke: true })).devices; render();
        } else if (act === 'zoom') {
          const dev = +b.closest('[data-dev]').dataset.dev;
          if (!showing) { setShowing(true); await poll(); render(); }
          const d = lastLive && lastLive.devices.find(x => x.id === dev);
          if (d && d.last) MapView.getMap().setView([d.last.lat, d.last.lon], Math.max(MapView.getMap().getZoom(), 14));
          else toast('That phone hasn\'t sent a location yet');
        }
      } catch (ex) { toast(ex.message, 5000); }
    });
  }

  function init() {
    bind();
    load().then(poll);
    timer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  }

  return { init, render, buildPack };
})();
