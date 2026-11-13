/* Camp Planner — landing page: the trip map and lists.
   Everyone sees published public trips. Signed-in leaders also see the trips they plan;
   superusers see every trip and the review queue; Camp Planner admins get the Users button. */

(() => {
  const API = '../api/';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let csrf = '';
  async function call(path, body) {
    const init = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) { init.method = 'POST'; init.headers['Content-Type'] = 'application/json'; init.headers['X-CSRF-Token'] = csrf; init.body = JSON.stringify(body); }
    const r = await fetch(API + path, init);
    const j = await r.json().catch(() => ({}));
    if (j && j.csrf) csrf = j.csrf;
    if (!r.ok) { const e = new Error(j.error || `The website returned an error (${r.status}).`); e.status = r.status; throw e; }
    return j;
  }

  const STATUS = { planning: ['Planning', '#006b9e'], ready: ['Ready to go', '#00664a'], completed: ['Completed', '#868e96'], archived: ['Archived', '#adb5bd'] };
  const PUB = { draft: ['📝', 'Draft', '#adb5bd'], review: ['⏳', 'In review', '#e67700'], published: ['✅', 'Published', '#00664a'] };
  const VIS = { public: ['🌏', 'Public'], private: ['🔗', 'Private (link only)'], secret: ['🔒', 'Secret (link + lock code)'] };
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
  const fmt = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = m => { const s = parse(m.start), e = parse(m.end); return s ? (e ? Math.round((e - s) / 864e5) + 1 : 1) : 0; };
  const when = m => { const s = parse(m.start), e = parse(m.end); return s ? fmt(s) + (e && +e !== +s ? ' – ' + fmt(e) : '') : 'No dates yet'; };
  const where = m => [m.location, m.park, m.state].filter(Boolean).join(' · ');
  const past = t => { const e = parse(t.meta.end) || parse(t.meta.start); return e && e < today; };
  const link = t => `app.html?trip=${encodeURIComponent(t.id)}`;

  let me = { signedIn: false }, role = 'none', trips = [], map, markers = new Map();

  /* Zoom choices for the trip map (south-west, north-east corners) */
  const AREAS = [
    ['AU', 'All of Australia', [[-43.8, 112.9], [-10.5, 153.7]]],
    ['NSW', 'New South Wales', [[-37.6, 140.9], [-28.1, 153.7]]],
    ['ACT', 'Australian Capital Territory', [[-35.95, 148.75], [-35.1, 149.4]]],
    ['VIC', 'Victoria', [[-39.2, 140.9], [-33.9, 150.0]]],
    ['QLD', 'Queensland', [[-29.2, 137.9], [-10.6, 153.6]]],
    ['SA', 'South Australia', [[-38.1, 129.0], [-25.9, 141.0]]],
    ['WA', 'Western Australia', [[-35.2, 112.9], [-13.7, 129.0]]],
    ['TAS', 'Tasmania', [[-43.7, 143.8], [-39.5, 148.5]]],
    ['NT', 'Northern Territory', [[-26.0, 129.0], [-10.9, 138.0]]]
  ];
  const ZOOM_KEY = 'campplanner.landingZoom';
  const zoomPref = () => { try { return localStorage.getItem(ZOOM_KEY) || 'AU'; } catch (e) { return 'AU'; } };
  function zoomTo(code) {
    const pts = trips.filter(t => t.meta.lat != null && t.meta.lon != null).map(t => [t.meta.lat, t.meta.lon]);
    if (code === 'trips' && pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 9 });
    else map.fitBounds((AREAS.find(a => a[0] === code) || AREAS[0])[2], { padding: [10, 10] });
    try { localStorage.setItem(ZOOM_KEY, code); } catch (e) { /* storage blocked */ }
  }
  function fillZoom() {
    const sel = $('#lpZoom'), cur = zoomPref();
    const n = code => trips.filter(t => (t.meta.state || '') === code).length;
    const withPins = trips.filter(t => t.meta.lat != null).length;
    sel.innerHTML = AREAS.map(([k, label]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${label}${k === 'AU' ? ` (${trips.length} trip${trips.length === 1 ? '' : 's'})` : n(k) ? ` (${n(k)})` : ''}</option>`).join('') +
      `<option value="trips" ${cur === 'trips' ? 'selected' : ''} ${withPins ? '' : 'disabled'}>Fit all trips on the map</option>`;
    sel.onchange = () => zoomTo(sel.value);
  }

  function badges(t, full) {
    const st = STATUS[t.status] || STATUS.planning, p = PUB[t.pub] || PUB.draft, v = VIS[t.visibility] || VIS.public;
    return `<span class="status" style="background:${st[1]}">${st[0]}</span>` +
      (full || t.pub !== 'published' ? `<span class="status" style="background:${p[2]}">${p[0]} ${p[1]}${t.pub === 'review' ? ` ${t.approvals}/${t.needed}` : ''}</span>` : '') +
      (full || t.visibility !== 'public' ? `<span class="status vis" title="${v[1]}">${v[0]}</span>` : '') +
      (t.meta.example ? '<span class="status ex">Example</span>' : '') +
      (t.changedSincePublished ? '<span class="status warn" title="Changed since it was approved">✎ changed</span>' : '');
  }

  function info(t, full) {
    const m = t.meta, d = days(m);
    return `<div class="lp-tip">
      <div class="lp-tip-badges">${badges(t, full)}</div>
      <b>${esc(m.name || 'Untitled trip')}</b>
      <div>📅 ${esc(when(m))}${d ? ` · ${d} day${d > 1 ? 's' : ''}` : ''}</div>
      ${where(m) ? `<div>📍 ${esc(where(m))}</div>` : ''}
      <div>👥 ${m.people || 0} ${m.people === 1 ? 'person' : 'people'}${m.km ? ` · 🥾 ${(+m.km).toFixed(1)} km` : ''}</div>
      ${role !== 'none' ? `<div class="muted">👤 ${esc(t.ownerName || t.owner)}</div>` : ''}
      ${m.summary ? `<div class="muted lp-sum">${esc(m.summary)}</div>` : ''}
    </div>`;
  }

  function card(t, full) {
    return `<a class="trip-card lp-card" href="${link(t)}" data-id="${esc(t.id)}">
      <div class="tc-head">${badges(t, full)}</div>
      <h3>${esc(t.meta.name || 'Untitled trip')}</h3>
      <div class="tc-meta">📅 ${esc(when(t.meta))}</div>
      <div class="tc-meta">📍 ${esc(where(t.meta) || 'No location yet')}</div>
      <div class="tc-meta">👥 ${t.meta.people || 0} · ${t.meta.km ? `🥾 ${(+t.meta.km).toFixed(1)} km` : 'no trails yet'}</div>
      ${role !== 'none' ? `<div class="tc-meta muted small">👤 ${esc(t.ownerName || t.owner)}${(t.planners || []).length ? ` + ${t.planners.length}` : ''}</div>` : ''}
    </a>`;
  }

  const grid = (list, full, empty) => list.length ? `<div class="trip-grid">${list.map(t => card(t, full)).join('')}</div>` : `<p class="muted">${empty}</p>`;
  const byDate = (a, b) => String(a.meta.start || '9').localeCompare(String(b.meta.start || '9'));

  function render() {
    const pub = trips.filter(t => t.pub === 'published' && t.visibility === 'public');
    const upcoming = pub.filter(t => !past(t)).sort(byDate), done = pub.filter(past).sort((a, b) => -byDate(a, b));
    $('#lpPublished').innerHTML = `<h2>Published trips</h2>${grid(upcoming, false, 'No upcoming published trips yet.')}
      ${done.length ? `<details class="lp-past"><summary>Past trips (${done.length})</summary>${grid(done, false, '')}</details>` : ''}`;

    if (role !== 'none') {
      const mine = trips.filter(t => t.team).sort(byDate);
      $('#lpMine').hidden = false;
      $('#lpMine').innerHTML = `<h2>My trips <small class="muted">— trips you own or co-plan</small></h2>
        ${grid(mine, true, 'You aren\'t planning any trips yet. <a href="app.html?new=1">Plan a new trip</a>.')}`;
    }
    if (role === 'super') {
      const queue = trips.filter(t => t.pub === 'review').sort(byDate);
      $('#lpReview').hidden = false;
      $('#lpReview').innerHTML = `<h2>⏳ Waiting for review <small class="muted">— one superuser's approval publishes a trip</small></h2>
        ${queue.length ? `<div class="trip-grid">${queue.map(t => card(t, true).replace('</a>', `<div class="tc-meta small">${t.canReview ? (t.iApproved ? '✓ You approved it' : '👉 Open it, check the plan, then approve or ask for changes on the Trip tab') : 'You plan this trip — another superuser reviews it'}</div></a>`)).join('')}</div>` : '<p class="muted">Nothing waiting for review.</p>'}`;
      const all = trips.slice().sort(byDate);
      $('#lpAll').hidden = false;
      $('#lpAll').innerHTML = `<h2>All trips <small class="muted">(${all.length})</small></h2>
        <div class="table-scroll"><table class="tbl lp-table"><thead><tr><th>Trip</th><th>Dates</th><th>Owner</th><th>Publishing</th><th>Who can see it</th><th>Updated</th></tr></thead><tbody>
        ${all.map(t => `<tr><td><a href="${link(t)}"><b>${esc(t.meta.name || 'Untitled trip')}</b></a><br><small class="muted">${esc(where(t.meta))}</small></td>
          <td class="nowrap">${esc(when(t.meta))}</td><td>${esc(t.ownerName || t.owner)}</td>
          <td>${(PUB[t.pub] || PUB.draft)[0]} ${(PUB[t.pub] || PUB.draft)[1]}${t.pub === 'review' ? ` (${t.approvals}/${t.needed})` : ''}${t.changedSincePublished ? ' ✎' : ''}</td>
          <td>${(VIS[t.visibility] || VIS.public).join(' ')}</td><td class="small muted nowrap">${new Date(t.updated).toLocaleDateString()}</td></tr>`).join('')}
        </tbody></table></div>`;
    }
    drawMap();
  }

  /* ---------- the trip map ---------- */
  function drawMap() {
    if (!map) {
      map = L.map('lpMap', { scrollWheelZoom: false, zoomSnap: 0.25 }).fitBounds(AREAS[0][2]);
      window.lpMap = map;   // for testing
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap contributors' }).addTo(map);
      map.on('click', () => map.scrollWheelZoom.enable());
    }
    markers.forEach(m => m.remove());
    markers.clear();
    const shown = trips.filter(t => t.meta.lat != null && t.meta.lon != null);
    shown.forEach(t => {
      const p = PUB[t.pub] || PUB.draft, gone = past(t) && t.pub === 'published';
      const icon = L.divIcon({ className: 'lp-pin-wrap', html: `<span class="lp-pin ${gone ? 'past' : ''}" style="--pin:${t.pub === 'published' ? (gone ? '#868e96' : '#262661') : p[2]}"><span>⛺</span></span>`, iconSize: [30, 30], iconAnchor: [15, 28], tooltipAnchor: [0, -26] });
      const mk = L.marker([t.meta.lat, t.meta.lon], { icon, title: t.meta.name, riseOnHover: true })
        .bindTooltip(info(t, role !== 'none'), { direction: 'top', className: 'lp-tooltip', opacity: 1 })
        .on('click', () => { location.href = link(t); })
        .addTo(map);
      markers.set(t.id, mk);
    });
    fillZoom();
    zoomTo(zoomPref());
    const leg = [['#262661', 'Published'], ['#868e96', 'Past']];
    if (role !== 'none') leg.push(['#e67700', 'In review'], ['#adb5bd', 'Draft']);
    $('#lpLegend').innerHTML = leg.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('') +
      `<span class="muted">${shown.length} trip${shown.length === 1 ? '' : 's'} on the map${trips.length > shown.length ? ` · ${trips.length - shown.length} without a location` : ''}</span>`;
  }

  /* hovering a trip card shows it on the map */
  document.addEventListener('mouseover', e => {
    const c = e.target.closest('.lp-card');
    const mk = c && markers.get(c.dataset.id);
    if (mk && !mk.isTooltipOpen()) mk.openTooltip();
  });
  document.addEventListener('mouseout', e => {
    const c = e.target.closest('.lp-card');
    const mk = c && markers.get(c.dataset.id);
    if (mk && !c.contains(e.relatedTarget)) mk.closeTooltip();
  });

  /* ---------- sign in / out ---------- */
  function account() {
    const btn = $('#lpAccount'), d = $('#signinDialog');
    btn.textContent = me.signedIn ? `👤 ${me.name || me.username} · Sign out` : '🔑 Leader sign in';
    btn.onclick = async () => {
      if (me.signedIn) { try { await call('auth.php?action=logout', {}); } catch (e) { /* signed out anyway */ } location.reload(); return; }
      $('#siError').textContent = ''; d.showModal(); $('#siUser').focus();
    };
    $('#siCancel').onclick = () => d.close();
    $('#siForm').onsubmit = async e => {
      e.preventDefault();
      const err = $('#siError'); err.textContent = '';
      try {
        const r = await call('auth.php?action=login', { username: $('#siUser').value.trim().toLowerCase(), password: $('#siPass').value });
        if (r.mustChange) { err.innerHTML = 'Signed in. You have a temporary password — choose your own on the <a href="../leaders/program.html">Leaders page</a> first.'; return; }
        location.reload();
      } catch (ex) { err.textContent = ex.message; }
    };
    $('#lpUsers').hidden = !(me.signedIn && !me.mustChange && me.campAdmin);
    document.querySelectorAll('.lp-plan').forEach(a => { a.hidden = !(role === 'leader' || role === 'super'); });
    $('#lpWho').innerHTML = !me.signedIn ? 'Leaders: sign in to plan trips and see your drafts.'
      : me.mustChange ? 'Change your temporary password on the <a href="../leaders/program.html">Leaders page</a> first.'
      : role === 'super' ? 'You\'re a <b>superuser</b>: you see every trip and review trips for publishing.'
      : role === 'leader' ? 'You can plan trips. New trips are drafts until you submit them and a superuser approves them.'
      : 'Your account can view published trips. Ask a Camp Planner admin if you need to plan trips.';
  }

  async function init() {
    try { me = await call('auth.php?action=me'); } catch (e) { me = { signedIn: false }; }
    role = me.signedIn && !me.mustChange ? (me.campRole || 'none') : 'none';
    account();
    try { trips = (await call('camp.php?action=list')).trips; }
    catch (e) { $('#lpPublished').innerHTML = `<p class="bad-text">Couldn't load trips: ${esc(e.message)}</p>`; }
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
