/* Camp Planner — check-in phone app (checkin.html).
   Set up once with the trip's check-in link (?k=…) while there is service: the roster is kept on the phone, so
   scanning, the passenger list, no-shows and the gear confirmation all work with no signal. Check-ins are
   queued and sent to the website when service returns.
     • scan a car's cover page  -> that car's passengers: untick anyone who didn't show, confirm gear, check in
     • scan a participant's card -> everything the organisers hold about that person
   Server: api/rego.php (roster, checkin). */

(() => {
  const { esc, parse, span, gearList, gearState, gearBadge } = RegoLib;
  const API = '../api/rego.php?action=';
  const $ = (s, el = document) => el.querySelector(s);
  const main = $('#ckMain');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ck.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ck.' + k, JSON.stringify(v)); } catch (e) { /* storage full / blocked */ } },
    del(k) { try { localStorage.removeItem('ck.' + k); } catch (e) { /* ignore */ } }
  };
  let R = null;            // the roster: { trip, groups, people, cars, at }
  let stopScan = null;
  let toastT;
  const toast = msg => { const t = $('#rgToast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3000); };
  const now = () => Math.floor(Date.now() / 1000);
  const clock = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const tel = n => (n ? `<a href="tel:${esc(String(n).replace(/[^0-9+]/g, ''))}">${esc(n)}</a>` : '—');
  const group = id => R.groups.find(g => g.id === id) || null;
  const car = id => R.cars.find(c => c.id === id) || null;
  const person = id => R.people.find(p => p.id === id) || null;

  /* ---------- website ---------- */
  async function api(action, body) {
    const init = { headers: { Accept: 'application/json' } };
    if (body) { init.method = 'POST'; init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const r = await fetch(API + action, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `The website returned an error (${r.status}).`); e.status = r.status; throw e; }
    return j;
  }
  function net() {
    const q = store.get('queue', []).length;
    $('#ckNet').textContent = (navigator.onLine ? '' : '📴 offline') + (q ? ` · ${q} to send` : '');
  }
  /* queue a change, apply it to the roster on the phone straight away, and send it when we can */
  function record(ev) {
    ev.t = now(); ev.by = store.get('by', '');
    store.set('queue', [...store.get('queue', []), ev]);
    apply(ev); store.set('roster', R); net(); flush();
  }
  function apply(ev) {
    if (ev.car) { const c = car(ev.car); if (c) { const on = ev.arrived !== false; c.arrivedAt = on ? ev.t : null; c.arrivedBy = on ? ev.by : ''; c.gearOk = on ? (ev.gearOk == null ? null : !!ev.gearOk) : null; } }
    else if (ev.person) { const p = person(ev.person); if (p) { p.attend = ev.attend; p.attendAt = ev.t; } }
  }
  let flushing = false;
  async function flush() {
    const q = store.get('queue', []);
    if (flushing || !q.length || !navigator.onLine) return;
    flushing = true;
    try {
      await api('checkin', { k: store.get('k'), events: q });
      store.set('queue', store.get('queue', []).slice(q.length));
    } catch (e) { if (e.status === 404) toast('The check-in link was changed. Ask the organiser for the new one.'); }
    flushing = false; net();
  }
  /* fresh roster from the website, with anything still queued on this phone applied on top */
  async function refresh(quiet) {
    if (!navigator.onLine) { if (!quiet) toast('No service — using the list saved on this phone'); return; }
    try {
      await flush();
      R = await api('roster&k=' + encodeURIComponent(store.get('k')));
      store.get('queue', []).forEach(apply);
      store.set('roster', R);
      if (!quiet) toast('List updated');
    } catch (e) { if (!quiet) toast(e.message); }
  }

  /* ---------- screens ---------- */
  function setup(msg) {
    main.innerHTML = `<section class="rg-card"><h2>Set up check-in</h2><p>${esc(msg || 'Open the check-in link from the trip\'s organiser on this phone (it\'s on the planner\'s People tab), while you have service.')}</p>
      <p class="rg-muted">The participant list is then kept on this phone so check-in works with no signal.</p></section>`;
  }

  function home() {
    if (stopScan) stopScan();
    const P = R.people, cars = R.cars;
    const n = k => P.filter(p => p.attend === k).length;
    const q = (store.get('filter', '') || '').toLowerCase();
    const match = p => !q || p.name.toLowerCase().includes(q) || ((group(p.group) || {}).name || '').toLowerCase().includes(q);
    $('#ckTitle').textContent = R.trip.name;
    main.innerHTML = `<section class="rg-card"><p class="rg-dates">${span(R.trip)}</p>
        <div class="rg-stats"><div class="ok"><b>${n('present')}</b><span>here</span></div><div><b>${n('expected')}</b><span>to come</span></div><div class="${n('noshow') ? 'bad' : ''}"><b>${n('noshow')}</b><span>not coming</span></div>
          <div><b>${cars.filter(c => c.arrivedAt).length}/${cars.length}</b><span>cars in</span></div></div>
        <button class="rg-btn primary big" id="scan">📷 Scan a QR code</button>
        <p class="rg-muted rg-center">Scan a car's cover page to check in the car, or a participant's card to see their details.<br>List saved ${clock(R.at)} · <button class="rg-link" id="upd">update</button></p></section>
      <section class="rg-card"><input id="find" type="search" placeholder="Find a person or group…" value="${esc(store.get('filter', ''))}">
        ${R.groups.map(g => {
          const ps = P.filter(p => p.group === g.id && match(p)); if (!ps.length && q) return '';
          const cs = cars.filter(c => c.group === g.id);
          return `<h3>${esc(g.name)} <small>${P.filter(p => p.group === g.id && p.attend === 'present').length}/${P.filter(p => p.group === g.id && p.attend !== 'noshow').length} here</small></h3>
            <div class="ck-cars">${cs.map(c => `<button class="ck-car ${c.arrivedAt ? 'in' : ''}" data-car="${c.id}">🚗 ${esc(c.label)}${c.arrivedAt ? ' ✓' : ''}</button>`).join('')}</div>
            <ul class="ck-people">${ps.map(pRow).join('')}</ul>`; }).join('')}
        ${P.some(p => p.group == null && match(p)) ? `<h3>No group</h3><ul class="ck-people">${P.filter(p => p.group == null && match(p)).map(pRow).join('')}</ul>` : ''}</section>
      <section class="rg-card"><label>Check-ins are recorded as<input id="by" maxlength="40" value="${esc(store.get('by', ''))}" placeholder="Your name"></label>
        <button class="rg-btn danger" id="forget">Remove this trip from this phone</button>
        <p class="rg-muted">The list holds personal details. Remove it from this phone when the activity is over.</p></section>`;
    $('#scan').onclick = scan;
    $('#upd').onclick = async () => { await refresh(); home(); };
    $('#by').onchange = e => store.set('by', e.target.value.trim());
    $('#find').oninput = e => { store.set('filter', e.target.value); clearTimeout(home.t); home.t = setTimeout(() => { home(); const f = $('#find'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 350); };
    $('#forget').onclick = () => {
      if (store.get('queue', []).length && !confirm('Some check-ins haven\'t been sent to the website yet and will be lost. Remove anyway?')) return;
      if (!confirm('Remove this trip\'s list from this phone?')) return;
      ['k', 'roster', 'queue', 'filter'].forEach(k => store.del(k)); R = null; setup('Removed. Open the check-in link again to set this phone up.');
    };
    main.querySelectorAll('[data-car]').forEach(b => { b.onclick = () => carScreen(+b.dataset.car); });
    main.querySelectorAll('[data-person]').forEach(b => { b.onclick = () => personScreen(+b.dataset.person); });
    net();
  }
  const mark = p => (p.attend === 'present' ? '✅' : p.attend === 'noshow' ? '❌' : '⬜');
  const pRow = p => `<li><button data-person="${p.id}">${mark(p)} <b>${esc(p.name)}</b> <small>${p.kind === 'adult' ? 'adult' : 'youth'}${p.medFlag ? ' · ⚕' : ''}${p.waitGroup ? ' · ⏳ no seat in a group car' : ''}</small> ${gearBadge(R.trip, p)}</button></li>`;

  /* A car at the start: who's in it, who didn't show, gear confirmed, check in */
  function carScreen(id) {
    if (stopScan) stopScan();
    const c = car(id), g = group(c.group);
    let pax = R.people.filter(p => p.car === c.id);
    const whole = !pax.length;               // nobody was given a seat in this car: offer the group's people not yet in another car
    if (whole) pax = R.people.filter(p => p.group === c.group && (p.car == null));
    const absent = new Set(pax.filter(p => p.attend === 'noshow').map(p => p.id));
    let gearOk = c.gearOk;
    const draw = () => {
      main.innerHTML = `<section class="rg-card"><button class="rg-link" id="back">‹ Back</button>
          <h1>🚗 ${esc(c.label)}</h1><p><b>${esc(g ? g.name : '')}</b>${c.driver ? ' · driver ' + esc(c.driver) : ''} · ${c.seats} seats</p>
          ${c.arrivedAt ? `<p class="rg-okline">✓ Checked in ${clock(c.arrivedAt)}${c.arrivedBy ? ' by ' + esc(c.arrivedBy) : ''}</p>` : ''}
          ${whole ? '<p class="rg-warn">Nobody was listed for this car, so this is everyone in the group without a car. Untick anyone who isn\'t in it.</p>' : ''}</section>
        <section class="rg-card"><h2>Passengers <small>${pax.length - absent.size} of ${pax.length} here</small></h2><p class="rg-muted">Tap anyone who didn't come.</p>
          <ul class="ck-pax">${pax.map(p => { const gs = gearState(R.trip, p); return `<li class="${absent.has(p.id) ? 'off' : ''}"><button data-tog="${p.id}">${absent.has(p.id) ? '❌' : '✅'} <b>${esc(p.name)}</b>
            <small>${p.kind === 'adult' ? 'adult' : 'youth'}${p.medFlag ? ' · ⚕ medical notes' : ''}${p.dietary ? ' · 🍽 ' + esc(p.dietary) : ''}</small>
            ${gs.total && !gs.ok ? `<small class="rg-warn">Gear not ticked: ${esc(gs.missing.slice(0, 6).join(', '))}${gs.missing.length > 6 ? '…' : ''}</small>` : ''}</button>
            <button class="rg-link" data-info="${p.id}">details</button></li>`; }).join('') || '<li class="rg-muted">No passengers listed.</li>'}</ul></section>
        <section class="rg-card"><h2>🎒 Gear</h2><p>Ask out loud: <b>“Is all the gear on your list packed and here?”</b></p>
          ${gearList(R.trip).length ? `<p class="rg-muted">${gearList(R.trip).filter(x => x.req !== false).map(x => esc(x.name)).join(' · ')}</p>` : ''}
          <div class="rg-seg ck-gear"><button class="${gearOk === true ? 'on ok' : ''}" data-gear="1">✓ Yes, all here</button><button class="${gearOk === false ? 'on bad' : ''}" data-gear="0">✗ Something's missing</button></div>
          <button class="rg-btn primary big" id="doCheck" ${gearOk == null ? 'disabled' : ''}>${c.arrivedAt ? 'Update check-in' : 'Check in this car'}</button>
          ${c.arrivedAt ? '<button class="rg-btn" id="undo">Undo this car\'s check-in</button>' : ''}</section>`;
      $('#back').onclick = home;
      main.querySelectorAll('[data-tog]').forEach(b => { b.onclick = () => { const i = +b.dataset.tog; if (absent.has(i)) absent.delete(i); else absent.add(i); draw(); }; });
      main.querySelectorAll('[data-info]').forEach(b => { b.onclick = () => personScreen(+b.dataset.info, () => carScreen(id)); });
      main.querySelectorAll('[data-gear]').forEach(b => { b.onclick = () => { gearOk = b.dataset.gear === '1'; draw(); }; });
      $('#doCheck').onclick = () => {
        record({ car: c.id, arrived: true, gearOk });
        pax.forEach(p => { const a = absent.has(p.id) ? 'noshow' : 'present'; if (p.attend !== a) record({ person: p.id, attend: a }); });
        toast(`${c.label}: ${pax.length - absent.size} checked in${absent.size ? `, ${absent.size} not coming` : ''}`); home();
      };
      const u = $('#undo'); if (u) u.onclick = () => { if (!confirm('Undo this car\'s check-in? Its passengers go back to "to come".')) return;
        record({ car: c.id, arrived: false }); pax.forEach(p => { if (p.attend !== 'expected') record({ person: p.id, attend: 'expected' }); }); home(); };
      window.scrollTo(0, 0);
    };
    draw();
  }

  /* Everything held about one person */
  function personScreen(id, back = home) {
    if (stopScan) stopScan();
    const p = person(id), g = group(p.group), c = car(p.car), lead = g && g.leader ? person(g.leader) : null, gs = gearState(R.trip, p), have = new Set(p.gear);
    main.innerHTML = `<section class="rg-card"><button class="rg-link" id="back">‹ Back</button>
        <h1>${esc(p.name)}</h1><p>${p.kind === 'adult' ? 'Adult' : 'Youth member'} · ${g ? `<b>${esc(g.name)}</b>` : '<span class="rg-warn">no group</span>'}${c ? ` · 🚗 ${esc(c.label)}` : ''}</p>
        <div class="rg-seg ck-att"><button class="${p.attend === 'present' ? 'on ok' : ''}" data-att="present">✅ Here</button><button class="${p.attend === 'expected' ? 'on' : ''}" data-att="expected">⬜ To come</button><button class="${p.attend === 'noshow' ? 'on bad' : ''}" data-att="noshow">❌ Not coming</button></div>
        ${p.attendAt && p.attend !== 'expected' ? `<p class="rg-muted">Marked ${clock(p.attendAt)}</p>` : ''}</section>
      ${p.medFlag ? '<section class="rg-card rg-alert"><b>⚕ Has medical notes.</b> The details are on the leader\'s paper medical form — check it.</section>' : ''}
      <section class="rg-card"><table class="rg-kv">
        <tr><th>Mobile</th><td>${tel(p.mobile)}</td></tr>
        <tr><th>Emergency contact</th><td><b>${esc(p.emName || '—')}</b><br>${tel(p.emPhone)}</td></tr>
        <tr><th>Dietary</th><td>${esc(p.dietary || 'None listed')}</td></tr>
        <tr><th>Consent</th><td>${p.consent ? `✓ given by ${esc(p.consentBy || '?')}` : '<span class="rg-warn">✗ not recorded</span>'}</td></tr>
        <tr><th>Group leader</th><td>${lead ? `${esc(lead.name)} · ${tel(lead.mobile)}` : '—'}</td></tr>
        <tr><th>Car</th><td>${c ? `${esc(c.label)}${c.driver ? ' · driver ' + esc(c.driver) : ''}${c.arrivedAt ? ` · in ${clock(c.arrivedAt)}` : ''}` : '—'}</td></tr>
        <tr><th>Card code</th><td>${esc(p.code)}</td></tr></table></section>
      ${gearList(R.trip).length ? `<section class="rg-card"><h2>🎒 Gear ${gearBadge(R.trip, p)}</h2><ul class="ck-gearlist">${gearList(R.trip).map(x => `<li class="${have.has(x.id) ? 'yes' : 'no'}">${have.has(x.id) ? '☑' : '☐'} ${esc(x.name)}${x.req === false ? ' <small>(optional)</small>' : ''}</li>`).join('')}</ul>
        ${p.gearNote ? `<p>Note: ${esc(p.gearNote)}</p>` : ''}${gs.total && !gs.ok ? '<p class="rg-muted">Ticks are what they marked as packed before leaving.</p>' : ''}</section>` : ''}`;
    $('#back').onclick = () => back();
    main.querySelectorAll('[data-att]').forEach(b => { b.onclick = () => { if (p.attend !== b.dataset.att) record({ person: p.id, attend: b.dataset.att }); personScreen(id, back); }; });
    window.scrollTo(0, 0);
  }

  /* what a scanned (or typed) code points to */
  function open(text) {
    const hit = parse(text) || (/^[A-Z0-9]{8}$/.test(String(text).trim().toUpperCase()) ? { kind: '?', code: String(text).trim().toUpperCase() } : null);
    if (!hit) return false;
    const c = hit.kind !== 'p' && R.cars.find(x => x.code === hit.code), p = hit.kind !== 'c' && R.people.find(x => x.code === hit.code);
    if (c) { carScreen(c.id); return true; }
    if (p) { personScreen(p.id); return true; }
    toast('That code isn\'t on this trip\'s list. Try "update", or it may be for another activity.');
    return false;
  }

  /* ---------- camera ---------- */
  async function scan() {
    main.innerHTML = `<section class="rg-card"><button class="rg-link" id="back">‹ Back</button><h2>Scan a QR code</h2>
        <div class="ck-cam"><video id="cam" playsinline muted></video><div class="ck-aim"></div></div><p class="rg-muted rg-center" id="camMsg">Starting the camera…</p>
        <form id="codeForm" class="rg-two"><input id="code" placeholder="…or type the code under the QR" maxlength="8" autocapitalize="characters" autocomplete="off"><button class="rg-btn">Open</button></form></section>`;
    $('#back').onclick = home;
    $('#codeForm').onsubmit = e => { e.preventDefault(); open($('#code').value); };
    const video = $('#cam');
    let stream = null, live = true, raf = 0;
    stopScan = () => { live = false; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); stopScan = null; };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    } catch (e) { $('#camMsg').textContent = 'The camera isn\'t available (check this page is allowed to use it). You can type the code instead, or find the car or person in the list.'; return; }
    if (!live) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream; await video.play().catch(() => {});
    $('#camMsg').textContent = 'Point the camera at the code.';
    const det = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    let last = 0;
    const tick = async ts => {
      if (!live) return;
      raf = requestAnimationFrame(tick);
      if (ts - last < 180 || video.readyState < 2) return;
      last = ts;
      let text = '';
      try {
        if (det) { const r = await det.detect(video); if (r.length) text = r[0].rawValue; }
        else if (typeof jsQR === 'function') {
          const s = Math.min(1, 640 / video.videoWidth); cv.width = video.videoWidth * s; cv.height = video.videoHeight * s;
          cx.drawImage(video, 0, 0, cv.width, cv.height);
          const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' });
          if (r) text = r.data;
        }
      } catch (e) { /* a bad frame: try the next */ }
      if (text && live) { if (navigator.vibrate) navigator.vibrate(60); if (!open(text)) { last = ts + 1500; } }
    };
    raf = requestAnimationFrame(tick);
  }

  /* ---------- start ---------- */
  (async () => {
    const k = new URLSearchParams(location.search).get('k');
    if (k && k !== store.get('k')) { ['roster', 'queue', 'filter'].forEach(x => store.del(x)); store.set('k', k); }
    if (k) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* keep the link out of the address bar and history */ } }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.addEventListener('online', () => { net(); refresh(true).then(() => { if ($('#scan')) home(); }); });
    window.addEventListener('offline', net);
    window.addEventListener('hashchange', () => { if (R && location.hash.length > 1) { open(location.hash); history.replaceState(null, '', location.pathname); } });
    setInterval(flush, 30000);
    if (!store.get('k')) {
      if (parse(location.hash)) {          // someone has scanned a bag tag or card with an ordinary phone
        main.innerHTML = `<section class="rg-card"><h2>This belongs to someone on a Grafton Scout Group activity</h2><p>If you've found a bag or gear with this tag, thank you. Please hand it to a Scout leader, or contact Grafton Scout Group through <a href="../contact.html">our contact page</a>, and quote the code <b>${esc(parse(location.hash).code)}</b>.</p>
          <p class="rg-muted">Leaders: open your check-in link on this phone first, then scan again to see whose it is.</p></section>`;
        return;
      }
      return setup();
    }
    R = store.get('roster', null);
    if (navigator.onLine) {
      try { await flush(); R = await api('roster&k=' + encodeURIComponent(store.get('k'))); store.get('queue', []).forEach(apply); store.set('roster', R); }
      catch (e) { if (!R) return setup(e.message); }
    }
    if (!R) return setup('This phone has no service. Open the check-in link once with service to download the list.');
    /* opened by scanning a code with the phone's own camera: go straight to it */
    if (location.hash.length > 1 && parse(location.hash)) { const h = location.hash; history.replaceState(null, '', location.pathname); if (open(h)) return; }
    home();
  })();
})();
