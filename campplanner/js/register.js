/* Camp Planner — registration page (register.html). No sign-in: the link is the key.
     ?r=<trip's registration link>   register for the activity (yourself, or a parent for a youth member)
     ?p=<your own link>              your registration: QR card, gear ticks, details, cancel
     ?g=<group leader's link>        your group: members, gear progress, cars and who rides in which, printing
   Server: api/rego.php. */

(() => {
  const { esc, link, qr, span, gearList, gearState, gearBadge } = RegoLib;
  const API = '../api/rego.php?action=';
  const $ = (s, el = document) => el.querySelector(s);
  const main = $('#rgMain');
  const Q = new URLSearchParams(location.search);

  async function api(action, body) {
    const init = { headers: { Accept: 'application/json' } };
    if (body) { init.method = 'POST'; init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(API + action, init); } catch (e) { throw new Error('Could not reach the website — check your internet connection.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `The website returned an error (${r.status}).`);
    return j;
  }
  let toastT;
  function toast(msg) { const t = $('#rgToast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500); }
  const fatal = msg => { main.innerHTML = `<section class="rg-card"><h2>Sorry</h2><p>${esc(msg)}</p></section>`; };

  /* links this device has been given, so a parent can come back to each child's registration */
  const saved = {
    get() { try { return JSON.parse(localStorage.getItem('rego.links') || '[]'); } catch (e) { return []; } },
    add(x) { try { localStorage.setItem('rego.links', JSON.stringify([...this.get().filter(y => y.p !== x.p), x].slice(-30))); } catch (e) { /* private window */ } },
    drop(p) { try { localStorage.setItem('rego.links', JSON.stringify(this.get().filter(y => y.p !== p))); } catch (e) { /* ignore */ } }
  };

  const tripHead = t => `<section class="rg-card rg-trip"><h1>${esc(t.name)}</h1><p class="rg-dates">${span(t)}</p>
      ${t.info.where ? `<p>📍 ${esc(t.info.where)}</p>` : ''}${t.info.note ? `<p>${esc(t.info.note).replace(/\n/g, '<br>')}</p>` : ''}</section>`;
  const mealsLine = t => (t.info.meals === 'provided'
    ? '<p>🍳 <b>Meals are organised and provided</b> for this activity. Tell us about any dietary needs below.</p>'
    : '<p>🍳 <b>Bring your own food</b> for the whole activity. Your group can share cooking — talk to your group leader.</p>');
  const gearCard = t => (gearList(t).length ? `<section class="rg-card"><h2>🎒 What everyone needs</h2>
      <ul class="rg-gear">${gearList(t).map(g => `<li>${esc(g.name)}${g.req === false ? ' <small>(optional)</small>' : ''}</li>`).join('')}</ul>
      <p class="rg-muted">You organise your own gear. Group gear (like tents and stoves) is shared within your group — your group leader coordinates who brings what.</p>${mealsLine(t)}</section>`
    : `<section class="rg-card"><h2>🎒 Gear and food</h2><p class="rg-muted">The gear list will be sent out by the organiser.</p>${mealsLine(t)}</section>`);

  const decisionCard = t => { const dc = t.info.decision; if (!dc || dc.go == null) return '';
    return `<section class="rg-card ${dc.go ? 'rg-ok' : 'rg-alert'}"><h2>${dc.go ? '✅ The activity is going ahead' : '❌ The activity is NOT going ahead'}</h2>${dc.note ? `<p>${esc(dc.note).replace(/\n/g, '<br>')}</p>` : ''}</section>`; };

  /* the fields for one person; `c` = whether to ask for consent; `light` = an expression of interest (name and a phone number) */
  function personForm(p = {}, c = true, light = false) {
    if (light) return `<label>Participant's full name<input name="name" required maxlength="80" value="${esc(p.name || '')}" autocomplete="off"></label>
      <div class="rg-seg"><label><input type="radio" name="kind" value="youth" ${p.kind !== 'adult' ? 'checked' : ''}> Youth member</label><label><input type="radio" name="kind" value="adult" ${p.kind === 'adult' ? 'checked' : ''}> Adult</label></div>
      <label>Mobile <small>(the participant's, or a parent's)</small><input name="mobile" type="tel" required maxlength="30" value="${esc(p.mobile || '')}"></label>
      <p class="rg-muted">That's all for now. If the activity goes ahead we'll ask for an emergency contact and consent. Your details are deleted 30 days after the activity.</p>`;
    return `<label>Participant's full name<input name="name" required maxlength="80" value="${esc(p.name || '')}" autocomplete="off"></label>
      <div class="rg-seg"><label><input type="radio" name="kind" value="youth" ${p.kind !== 'adult' ? 'checked' : ''}> Youth member</label><label><input type="radio" name="kind" value="adult" ${p.kind === 'adult' ? 'checked' : ''}> Adult</label></div>
      <label>Mobile <small>(the participant's, or a parent's)</small><input name="mobile" type="tel" maxlength="30" value="${esc(p.mobile || '')}"></label>
      <div class="rg-two"><label>Emergency contact name<input name="emName" required maxlength="80" value="${esc(p.emName || '')}"></label>
        <label>Emergency contact phone<input name="emPhone" type="tel" required maxlength="30" value="${esc(p.emPhone || '')}"></label></div>
      <label>Dietary needs <small>(leave empty if none)</small><input name="dietary" maxlength="200" value="${esc(p.dietary || '')}" placeholder="e.g. vegetarian, no nuts"></label>
      <label class="rg-check"><input type="checkbox" name="medFlag" ${p.medFlag ? 'checked' : ''}> <span>This participant has medical conditions, allergies or medication the leaders need to know about.
        <small>Don't write the details here — give them to the leader on the Scouts medical form. This box just tells leaders to check it.</small></span></label>
      ${c ? `<fieldset class="rg-consent"><legend>Consent</legend>
        <label class="rg-check"><input type="checkbox" name="consent" ${p.consent ? 'checked' : ''} required> <span>I give consent for this participant to take part in this activity, including travel in the cars organised by their group, and I confirm the details above are correct.</span></label>
        <label>Name of the person giving consent <small>(a parent or carer for a youth member)</small><input name="consentBy" required maxlength="80" value="${esc(p.consentBy || '')}"></label>
        <p class="rg-muted">Your details are used only to run this activity and are deleted 30 days after it ends. Only the organisers and check-in leaders see emergency contacts.</p></fieldset>` : ''}`;
  }
  function readPerson(f) {
    const v = n => (f.elements[n] ? f.elements[n].value.trim() : '');
    return { name: v('name'), kind: f.elements.kind.value, mobile: v('mobile'), emName: v('emName'), emPhone: v('emPhone'), dietary: v('dietary'),
      medFlag: f.elements.medFlag ? f.elements.medFlag.checked : false, consent: f.elements.consent ? f.elements.consent.checked : false, consentBy: v('consentBy') };
  }
  async function submit(form, fn) {
    const b = form.querySelector('button[type=submit]'), err = form.querySelector('.rg-err');
    b.disabled = true; if (err) err.textContent = '';
    try { await fn(); } catch (e) { if (err) err.textContent = e.message; else toast(e.message); }
    b.disabled = false;
  }

  /* ---------- ?r= : register ---------- */
  async function viewRegister(r) {
    const d = await api('info&r=' + encodeURIComponent(r)), t = d.trip;
    $('#rgTitle').textContent = t.name;
    const mine = saved.get().filter(x => x.r === r);
    const light = t.reg === 'interest', open = t.reg === 'open' || light, pl = t.places || { max: 0 };
    const gLabel = g => `${esc(g.name)} (${g.seats == null ? `${g.people} so far` : g.people >= g.seats ? `full: ${g.people} for ${g.seats} seats — waiting list` : `${g.people} of ${g.seats} seats`})`;
    main.innerHTML = `${tripHead(t)}${decisionCard(t)}
      ${pl.max && open ? `<section class="rg-card ${pl.full ? 'rg-alert' : ''}"><div class="rg-meter"><i style="width:${Math.min(100, Math.round(pl.in / pl.max * 100))}%"></i></div>
        <p><b>${pl.in} of ${pl.max} places taken</b>${pl.full ? ` — the activity is full. You can still put your name down: you'll go on the <b>waiting list</b>${pl.waiting ? ` (${pl.waiting} waiting now)` : ''} and move up automatically if a place opens.` : `, ${pl.max - pl.in} left.`}</p></section>` : ''}
      ${mine.length ? `<section class="rg-card"><h2>Registered from this device</h2><ul class="rg-list">${mine.map(x => `<li><a href="${link.me(x.p)}"><b>${esc(x.name)}</b> — open registration</a>${x.g ? ` · <a href="${link.group(x.g)}">manage group</a>` : ''}</li>`).join('')}</ul></section>` : ''}
      ${gearCard(t)}
      ${open ? `<form class="rg-card" id="regForm"><h2>${light ? '🙋 Express your interest' : '✍️ Register'}${mine.length ? ' — another person' : ''}</h2>
        ${light ? '<p>We\'re gauging numbers. Put your name down if you\'d like to come — it isn\'t a commitment yet.</p>' : ''}
        ${t.closes ? `<p class="rg-muted">${light ? 'Expressions of interest close' : 'Registration closes'} at the end of ${RegoLib.fmtDay(t.closes)}.</p>` : ''}
        ${personForm({}, true, light)}
        <fieldset><legend>Group</legend>
          <p class="rg-muted">Groups travel and share gear together. Join yours, or start one — whoever starts a group is its leader and gets a link to manage it. A group has as many places as seats in its cars; if it's full you go on that group's waiting list until its leader adds a car.</p>
          <label>Your group<select name="group"><option value="">I don't have a group yet</option>${d.groups.map(g => `<option value="${g.id}">${gLabel(g)}</option>`).join('')}<option value="new">➕ Start a new group…</option></select></label>
          <label id="newGroup" hidden>New group's name<input name="groupName" maxlength="60" placeholder="e.g. Kookaburra Patrol"></label>
        </fieldset>
        <input name="website" class="rg-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <p class="rg-err" role="alert"></p>
        <button class="rg-btn primary" type="submit">${pl.full ? 'Join the waiting list' : light ? 'I\'m interested' : 'Register'}</button></form>`
      : `<section class="rg-card"><h2>Registration is ${t.reg === 'closed' ? 'closed' : 'not open yet'}</h2><p>${t.reg === 'closed' ? 'Registrations for this activity have closed. Contact the organiser if you still need to join.' : 'Check back soon, or ask the organiser.'}</p></section>`}`;
    const f = $('#regForm');
    if (!f) return;
    f.elements.group.onchange = () => { $('#newGroup').hidden = f.elements.group.value !== 'new'; };
    f.onsubmit = e => {
      e.preventDefault();
      submit(f, async () => {
        const gv = f.elements.group.value, person = readPerson(f);
        if (gv === 'new' && !f.elements.groupName.value.trim()) throw new Error('Please give your new group a name.');
        const res = await api('register', { r, person, website: f.elements.website.value, group: gv === 'new' ? { name: f.elements.groupName.value.trim() } : gv ? { id: +gv } : null });
        saved.add({ r, p: res.p, g: res.g || null, name: person.name });
        location.href = link.me(res.p) + '&new=1';
      });
    };
  }

  /* ---------- ?p= : my registration ---------- */
  async function viewMe(p) {
    const d = await api('me&p=' + encodeURIComponent(p)), t = d.trip, me = d.me;
    $('#rgTitle').textContent = t.name;
    const gs = gearState(t, me), have = new Set(me.gear);
    const light = t.reg === 'interest', todo = !me.complete && !light;      // interest was enough until full registration opened
    main.innerHTML = `${decisionCard(t)}
      ${me.wait ? `<section class="rg-card rg-alert"><h2>⏳ ${esc(me.name)} is on the waiting list</h2><p>The activity is full. ${esc(me.name)} is <b>number ${d.waitPos || '?'}</b> on the waiting list and will get a place automatically if one opens. Check back on this page — it will say when that happens.</p></section>` : ''}
      ${me.waitGroup ? `<section class="rg-card rg-alert"><h2>⏳ Waiting for a seat in ${esc(d.group ? d.group.name : 'the group')}</h2><p>${esc(me.name)} has a place on the activity, but ${esc(d.group ? d.group.name : 'the group')}'s cars are full. Ask the group leader${d.leader ? ` (${esc(d.leader.name)})` : ''} whether another car can come, or contact the organiser about another group.</p></section>` : ''}
      ${todo ? `<section class="rg-card rg-alert"><h2>✍️ Please complete ${esc(me.name)}'s registration</h2><p>The activity is being organised. We now need an emergency contact and consent.</p>
        <form id="doneForm">${personForm(me)}<p class="rg-err" role="alert"></p><button class="rg-btn primary" type="submit">Complete registration</button></form></section>` : ''}
      ${!me.complete && light && !Q.get('new') ? `<section class="rg-card rg-ok"><p><b>${esc(me.name)} is on the interested list.</b> We'll ask for the rest of the details if the activity goes ahead.</p></section>` : ''}
      ${Q.get('new') ? `<section class="rg-card rg-ok"><h2>✅ ${esc(me.name)} is ${me.wait ? 'on the waiting list' : me.complete ? 'registered' : 'on the interested list'}</h2><p><b>Save this page</b> (bookmark it or keep the link) — it's how you come back to tick off gear, change details or show the QR code.</p>
        <button class="rg-btn" id="copyMe">Copy my link</button>${d.groupToken ? `<p>You started <b>${esc(d.group.name)}</b>, so you're its group leader. <a class="rg-btn primary" href="${link.group(d.groupToken)}">Manage my group</a></p>` : ''}</section>` : ''}
      <section class="rg-card rg-idcard"><div>${qr(link.person(me.code), 150)}</div>
        <div><h1>${esc(me.name)}</h1><p>${esc(t.name)}<br>${span(t)}</p>
          <p>${d.group ? `Group: <b>${esc(d.group.name)}</b>` : '<span class="rg-warn">No group yet</span>'}${d.car ? `<br>Car: <b>${esc(d.car.label)}</b>${d.car.driver ? ' · driver ' + esc(d.car.driver) : ''}` : ''}</p>
          <p class="rg-muted">Show this code to the organisers on site. ${esc(me.code)}</p></div></section>
      ${d.leader ? `<section class="rg-card"><h2>👥 ${esc(d.group.name)}</h2><p>Group leader: <b>${esc(d.leader.name)}</b>${d.leader.mobile ? ` · <a href="tel:${esc(d.leader.mobile.replace(/\s/g, ''))}">${esc(d.leader.mobile)}</a>` : ''}. They coordinate your group's shared gear, food and cars.</p>
        ${d.isLeader ? `<a class="rg-btn primary" href="${link.group(d.groupToken)}">Manage my group</a>` : ''}</section>` : ''}
      ${t.info.briefing ? `<section class="rg-card" id="briefCard"><h2>📣 Briefing</h2><p>${esc(t.info.briefing).replace(/\n/g, '<br>')}</p>
        <label class="rg-check"><input type="checkbox" id="briefAck" ${me.briefAt ? 'checked' : ''}> <span><b>I've read the briefing</b>${me.briefAt ? ' <small>— thanks, noted</small>' : ''}</span></label>
        <label>A question or comment for the organisers<input id="briefFb" maxlength="500" value="${esc(me.feedback)}" placeholder="Optional"></label>
        <button class="rg-btn primary" id="briefSend">Send</button></section>` : ''}
      ${gearList(t).length ? `<section class="rg-card"><h2>🎒 My gear <span id="gearBadge">${gearBadge(t, me)}</span></h2><p class="rg-muted">Tick each item once it's packed. Your group leader and the check-in leader can see your progress.</p>
        <div class="rg-ticks">${gearList(t).map(g => `<label class="rg-check"><input type="checkbox" data-gear="${esc(g.id)}" ${have.has(g.id) ? 'checked' : ''}> <span>${esc(g.name)}${g.req === false ? ' <small>(optional)</small>' : ''}</span></label>`).join('')}</div>
        <label>Anything else I'm bringing or still need<input id="gearNote" maxlength="300" value="${esc(me.gearNote)}"></label></section>` : ''}
      <details class="rg-card" ${todo ? 'hidden' : ''}><summary><b>✏️ Change my details</b></summary><form id="meForm">${personForm(me, true, light && !me.complete)}<p class="rg-err" role="alert"></p><button class="rg-btn primary" type="submit">Save changes</button></form></details>
      <details class="rg-card"><summary>Can't come any more?</summary><p>Cancelling removes ${esc(me.name)} from the activity and lets the organisers know.</p><button class="rg-btn danger" id="cancelMe">Cancel this registration</button></details>
      <p class="rg-muted rg-center">${gs.total ? '' : ''}Your details are deleted 30 days after the activity ends.</p>`;
    const c = $('#copyMe'); if (c) c.onclick = () => navigator.clipboard.writeText(link.me(p)).then(() => toast('Link copied'), () => toast(link.me(p)));
    let t0;
    const saveGear = () => { clearTimeout(t0); t0 = setTimeout(async () => {
      const ids = [...main.querySelectorAll('[data-gear]:checked')].map(x => x.dataset.gear);
      try { await api('me_save', { p, gear: ids, gearNote: $('#gearNote').value }); me.gear = ids; $('#gearBadge').innerHTML = gearBadge(t, me); } catch (e) { toast(e.message); }
    }, 500); };
    main.querySelectorAll('[data-gear]').forEach(x => { x.onchange = saveGear; });
    if ($('#gearNote')) $('#gearNote').onchange = saveGear;
    const df = $('#doneForm'); if (df) df.onsubmit = e => { e.preventDefault(); submit(df, async () => { await api('me_save', { p, person: readPerson(df) }); toast('Registration complete — thank you'); viewMe(p); }); };
    const bs = $('#briefSend'); if (bs) bs.onclick = async () => { try { await api('me_brief', { p, ack: $('#briefAck').checked, feedback: $('#briefFb').value }); toast('Sent — thank you'); viewMe(p); } catch (e) { toast(e.message); } };
    $('#meForm').onsubmit = e => { e.preventDefault(); submit(e.target, async () => { await api('me_save', { p, person: readPerson(e.target) }); toast('Saved'); viewMe(p); }); };
    $('#cancelMe').onclick = async () => {
      if (!confirm(`Cancel ${me.name}'s registration?`)) return;
      try { await api('me_cancel', { p }); saved.drop(p); main.innerHTML = '<section class="rg-card"><h2>Registration cancelled</h2><p>Thanks for letting us know.</p></section>'; } catch (e) { toast(e.message); }
    };
  }

  /* ---------- ?g= : group leader ---------- */
  async function viewGroup(g, data) {
    const d = data || await api('group&g=' + encodeURIComponent(g)), t = d.trip, G = d.group; if (!G.plan || Array.isArray(G.plan)) G.plan = {};
    const light = t.reg === 'interest', open = t.reg === 'open' || light;
    /* ----- accommodation on the way: prefilled with the overnight town from the organisers' travel plan. Each row keeps
       the place's position (Find), so a different choice shows up in the travel plan and on the maps. ----- */
    const tvStops = ((((t.info && t.info.travel) || {})[G.id] || {}).stops || []);
    const normPlace = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const kmApart = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180) * 111.32, (b.lat - a.lat) * 110.54);
    const pinned = x => x.lat != null && x.lat !== '' && x.lon != null && x.lon !== '';
    function stayState(x) {
      const sg = tvStops.find(k => k.key === x.for);
      if (!String(x.place || '').trim()) return sg ? `<span class="rg-muted">Suggested stop: ${esc(sg.sug)}. Type where you'll stay and press Find.</span>` : '<span class="rg-muted">Type the town or place, then press Find to pin it on the map.</span>';
      if (!pinned(x)) return '<span class="rg-warn">⚠ Press <b>Find</b> and pick the place, so it goes on the map and into the travel plan.</span>';
      if (sg && sg.lat != null && kmApart({ lat: +x.lat, lon: +x.lon }, sg) < 3) return `<span class="rg-pin">📍 The suggested overnight stop${+x.cost > 0 || x.note ? ' — booked' : ' — add the cost once it\'s booked, or change the town if you\'re staying somewhere else'}.</span>`;
      if (sg) return `<span class="rg-pin">📍 Pinned — your choice instead of the suggested stop (${esc(sg.sug)}). The organisers' travel plan and map use it once you save.</span>`;
      return '<span class="rg-pin">📍 Pinned — it goes on the organisers\' map and travel itinerary once you save.</span>';
    }
    const stayRow = (x = {}) => `<div class="rg-prow rg-stay"><input data-k="place" placeholder="Town / where you're staying" maxlength="80" value="${esc(x.place || '')}"><input data-k="night" type="date" value="${esc(x.night || '')}" aria-label="Night of">
          <input data-k="cost" type="number" min="0" step="1" placeholder="Total cost $" value="${x.cost || ''}"><input data-k="note" placeholder="Booking notes" maxlength="120" value="${esc(x.note || '')}">
          <span class="rg-stay-btns"><button class="rg-btn" type="button" data-findstay>📍 Find</button><button class="rg-x" type="button" data-rmrow title="Remove">✕</button></span>
          <input type="hidden" data-k="lat" value="${pinned(x) ? esc(String(x.lat)) : ''}"><input type="hidden" data-k="lon" value="${pinned(x) ? esc(String(x.lon)) : ''}"><input type="hidden" data-k="for" value="${esc(x.for || '')}">
          <div class="rg-stay-st">${stayState(x)}</div><div class="rg-start-res"></div></div>`;
    /* saved stays, plus a prefilled row for each suggested overnight stop that has none yet */
    function stayList(plan) {
      const rows = (plan.stay || []).map(x => ({ ...x }));
      tvStops.forEach(sg => {
        const old = rows.find(x => !x.for && normPlace(x.place) && normPlace(x.place) === normPlace(sg.sug));      // entered before stops were linked
        if (old) { old.for = sg.key; if (!pinned(old) && sg.lat != null) { old.lat = sg.lat; old.lon = sg.lon; } return; }
        if (!rows.some(x => x.for === sg.key)) rows.push({ place: sg.lat != null ? sg.sug : '', night: sg.night || '', lat: sg.lat, lon: sg.lon, for: sg.key, _new: true });
      });
      return rows.sort((a, b) => String(a.night || '9').localeCompare(String(b.night || '9')));
    }
    const rowVals = row => ({ cost: $('[data-k=cost]', row).value, note: $('[data-k=note]', row).value, place: $('[data-k=place]', row).value, lat: $('[data-k=lat]', row).value, lon: $('[data-k=lon]', row).value, for: $('[data-k=for]', row).value });
    $('#rgTitle').textContent = G.name;
    const ready = d.people.filter(p => gearState(t, p).ok).length, seats = d.cars.reduce((a, c) => a + c.seats, 0);
    const waitG = d.people.filter(p => p.waitGroup), waitT = d.people.filter(p => p.wait), inGroup = d.people.length - waitT.length;
    const carOpts = id => `<option value="0">—</option>${d.cars.map(c => `<option value="${c.id}" ${c.id === id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}`;
    main.innerHTML = `<section class="rg-card rg-trip"><h1>👥 ${esc(G.name)}</h1><p class="rg-dates">${esc(t.name)} · ${span(t)}</p>
        <p>You're this group's leader: you coordinate its gear, food and cars. <b>Keep this page's link private</b> — anyone with it can change the group.</p>
        <div class="rg-stats"><div><b>${d.people.length}</b><span>people</span></div><div><b>${d.cars.length}</b><span>cars</span></div>
          <div class="${d.cars.length && seats < inGroup ? 'bad' : ''}"><b>${d.cars.length ? `${Math.max(0, seats - inGroup)}` : '—'}</b><span>spare seats (${seats} total)</span></div><div><b>${ready}/${d.people.length}</b><span>gear packed</span></div></div>
        ${waitG.length ? `<p class="rg-warn">⏳ ${waitG.length} ${waitG.length === 1 ? 'person is' : 'people are'} waiting for a seat: ${waitG.map(p => esc(p.name)).join(', ')}. Your group has ${seats} seats. Add a car (or seats) below and they get a place automatically, in the order they joined.</p>` : ''}
        ${d.cars.length ? '' : '<p class="rg-muted">Your group has no limit until you add your first car. After that, it has as many places as seats.</p>'}
        ${waitT.length ? `<p class="rg-muted">⏳ On the activity's waiting list (the activity is full): ${waitT.map(p => esc(p.name)).join(', ')}.</p>` : ''}
        ${open ? '' : '<p class="rg-warn">Registration has closed: the organisers are building the travel plan on your car numbers. You can still set drivers, passengers and gear.</p>'}</section>
      ${(G.plan.flags || []).length ? `<section class="rg-card rg-alert"><h2>🚩 From the organisers</h2><ul class="rg-list">${G.plan.flags.map(f => `<li><b>${esc(f.what)}</b>${f.note ? ` — ${esc(f.note)}` : ''} <small class="rg-muted">${esc(f.by || '')}${f.at ? ' · ' + new Date(f.at).toLocaleDateString() : ''}</small></li>`).join('')}</ul><p class="rg-muted">Please sort these out in your plan. The organisers clear each one when it's dealt with.</p></section>` : ''}
      <section class="rg-card"><h2>Members</h2>
        <table class="rg-table"><thead><tr><th>Name</th><th>Gear</th><th>Car</th><th></th></tr></thead><tbody>
          ${d.people.map(p => `<tr><td><b>${esc(p.name)}</b>${p.id === G.leader ? ' <small>(leader)</small>' : ''}<br><small>${p.kind === 'adult' ? 'Adult' : 'Youth'}${p.mobile ? ` · <a href="tel:${esc(p.mobile.replace(/\s/g, ''))}">${esc(p.mobile)}</a>` : ''}${p.dietary ? ' · 🍽 ' + esc(p.dietary) : ''}${p.medFlag ? ' · ⚕' : ''}${p.wait ? ' · <span class="rg-warn">⏳ activity waiting list</span>' : p.waitGroup ? ' · <span class="rg-warn">⏳ waiting for a seat</span>' : ''}${p.complete ? '' : light ? ' · interested' : ' · <span class="rg-warn">registration not complete</span>'}${t.info.briefing && !p.briefAt ? ' · briefing not read' : ''}</small>
            ${gearState(t, p).missing.length && gearState(t, p).done ? `<br><small class="rg-muted">Still to pack: ${esc(gearState(t, p).missing.join(', '))}</small>` : ''}</td>
            <td>${gearBadge(t, p)}</td><td>${p.wait || p.waitGroup ? '<small class="rg-muted">no seat yet</small>' : `<select data-seat="${p.id}">${carOpts(p.car)}</select>`}</td>
            <td>${open && p.id !== G.leader ? `<button class="rg-x" data-rm="${p.id}" title="Remove from the group and the activity">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="rg-muted">Nobody yet.</td></tr>'}
        </tbody></table>
        ${open ? `<details><summary><b>➕ Add someone to this group</b></summary><p class="rg-muted">People can also register themselves with the activity's registration link and choose this group.</p>
          <form id="addForm">${personForm({}, true, light)}<p class="rg-err" role="alert"></p><button class="rg-btn primary" type="submit">Add to the group</button></form></details>` : ''}</section>
      <section class="rg-card"><h2>🚗 Cars to the start</h2><p class="rg-muted">How many cars is your group providing? Give each a driver, seats (counting the driver) and <b>where it leaves from</b> — the organisers use that to work out drive times, departure times and fuel. Then choose each person's car in the list above.</p>
        <form id="carForm"><div id="carRows">${d.cars.map((c, i) => carRow(c, i)).join('')}</div>
          ${open ? '<button class="rg-btn" type="button" id="addCar">➕ Add a car</button>' : ''}
          <label>Notes for the organisers<input name="note" maxlength="300" value="${esc(G.note)}" placeholder="e.g. one car has a roof rack; leaving from Yamba"></label>
          <p class="rg-err" role="alert"></p><button class="rg-btn primary" type="submit">Save cars and seats</button></form></section>
      ${planCards()}
      <section class="rg-card no-print"><h2>🖨 Print for the day</h2>
        <div class="rg-btns"><button class="rg-btn primary" data-print="plan">Group plan (report)</button><button class="rg-btn" data-print="emerg">⛑ Emergency sheet</button><button class="rg-btn" data-print="list">Check-in list</button><button class="rg-btn" data-print="covers" ${d.cars.length ? '' : 'disabled'}>Car cover pages (QR)</button><button class="rg-btn" data-print="cards">Participant cards (QR)</button></div>
        <p class="rg-muted">The emergency sheet is one page for the lead car and the contact at home: who to call, your stops, cars and plates, and everyone's emergency contact. Put a cover page on each car's dashboard: the check-in leader scans it at the start to check in everyone in that car.</p>
        <h3>🏷 Bag tags</h3><p class="rg-muted">A fold-over tag for each member's bag: a QR code on one side (a leader can scan it to see whose bag it is and who to call) and the name, group and trip on the other. Set the size of your tag holder — the tag folds to fit it.</p>
        ${(() => { let T = RegoLib.tagSize({}); try { T = RegoLib.tagSize(JSON.parse(localStorage.getItem('rego.tag') || '{}')); } catch (e) { /* defaults */ } return `<div class="rg-tagform"><label>Width (mm)<input type="number" min="20" max="120" step="1" data-tag="w" value="${T.w}"></label><label>Height (mm)<input type="number" min="12" max="120" step="1" data-tag="h" value="${T.h}"></label>
          <label>Tags per person<input type="number" min="1" max="6" step="1" data-tag="each" value="${T.each}"></label><label class="wide">“If found” line <small>(optional — e.g. a leader's mobile or the hall)</small><input data-tag="contact" maxlength="60" value="${esc(T.contact)}" placeholder="${t.info && t.info.tagPhone ? 'If found, phone ' + esc(t.info.tagPhone) : 'If found, please hand to a Scout leader'}"></label></div>`; })()}
        <button class="rg-btn primary" data-print="tags">Print bag tags</button></section>`;
    /* ----- the group's own plan: meals, overnight stays, public transport, costs ----- */
    function planCards() {
      const plan = G.plan || {}, L = RegoLib, mine = d.people.filter(p => !p.wait), C = L.planCosts(t, G, plan, mine.length), issues = L.mealIssues(t, plan, d.people), own = t.info.meals !== 'provided', tv = C.tv;
      const diets = d.people.filter(p => p.dietary);
      const trRow = (x = {}) => `<div class="rg-prow rg-trans"><select data-k="mode">${Object.entries(L.MODES).map(([k, v]) => `<option value="${k}" ${x.mode === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <input data-k="from" placeholder="From" maxlength="80" value="${esc(x.from || '')}"><input data-k="to" placeholder="To" maxlength="80" value="${esc(x.to || '')}">
          <label>Leaves<input data-k="depart" type="datetime-local" value="${esc(x.depart || '')}"></label><label>Arrives<input data-k="arrive" type="datetime-local" value="${esc(x.arrive || '')}"></label>
          <input data-k="cost" type="number" min="0" step="1" placeholder="Total cost $" value="${x.cost || ''}"><input data-k="note" placeholder="Flight / service, booking ref" maxlength="120" value="${esc(x.note || '')}"><button class="rg-x" type="button" data-rmrow title="Remove">✕</button></div>`;
      return `<form id="planForm">
        <section class="rg-card rg-wide"><h2>🍳 Meals</h2>
          ${own ? `${diets.length ? `<p><b>Dietary needs in your group:</b> ${diets.map(p => `${esc(p.name)} — ${esc(p.dietary)}`).join(' · ')}</p>` : ''}<div id="gpMenu" class="gp"></div>`
          : '<p>Meals are organised and provided for this activity, so there\'s nothing to plan here. Make sure everyone\'s dietary needs are on their registration.</p>'}</section>
        <section class="rg-card"><h2>🎒 Gear and pack weights</h2>
          <p class="rg-muted">Aim to keep every pack at or under <b>20% of the person's body weight</b>. Tick gear for anyone who hasn't done it themselves, and weigh the packed bags when you can — until then the weight is estimated from the gear list plus about ${L.kg(L.packState(t, plan, { gear: [] }).extra)} of food and water.</p>
          <div id="gpGear" class="gp"></div>
          <h3>Pack weights</h3><p class="rg-muted">Worked out from the gear list above (each person's items plus an even share of the group's shared gear) once it has items for that person; otherwise from the organisers' list they've ticked.</p>
          <div id="gpPacks" class="gp"></div>
          <p class="rg-muted">Body weights are only used for this check. They are seen by you and the organisers, and deleted with everything else 30 days after the activity. The figures update as you type; press <b>Save our plan</b> to keep the weights.</p></section>
        <section class="rg-card rg-wide"><h2>⚠️ Risks and controls <small>— risk assessment for ${esc(G.name)}</small></h2>
          <p class="rg-muted">The organisers' assessed risks and the controls everyone follows, plus any risks particular to your group. Tick <b>Read</b> for each of the organisers' risks once your group has talked it through, and add a note if your group needs to do something extra.</p>
          <div class="gp"><div class="rk-top"><div class="gp-card" id="rkMatrix"></div><div class="gp-card" id="rkSummary"></div></div>
            <div class="gp-card"><div class="gp-head"><h3>Hazards &amp; controls</h3><button class="gp-btn" type="button" data-add="risk">+ Add a risk for our group</button></div>
              <div class="gp-scroll"><table class="rk-table"><thead><tr><th>Read</th><th>Hazard &amp; cause</th><th>Location</th><th>Likelihood</th><th>Consequence</th><th>Risk</th><th>Controls</th><th>Residual L</th><th>Residual C</th><th>Residual</th><th>Who</th><th></th></tr></thead>
                <tbody id="riskRows">${(t.info.risks || []).slice().sort((x, y) => (y.l * y.c || 0) - (x.l * x.c || 0)).map(r => { const R = L.RiskUI, lab = (v, arr) => (v ? `${v} ${arr[v - 1]}` : '—');
                  return `<tr class="rk-org" data-l="${r.l || ''}" data-c="${r.c || ''}" data-rl="${r.rl || ''}" data-rc="${r.rc || ''}"><td class="rk-tick"><input type="checkbox" data-rk="${esc(r.k)}" ${((plan.risks || {}).ack || []).includes(r.k) ? 'checked' : ''} aria-label="Read"></td>
                    <td><b>${esc(r.hazard)}</b><small>${esc(r.cause || '')}</small></td><td>${esc(r.location || '')}</td><td>${lab(r.l, R.LIKE)}</td><td>${lab(r.c, R.CONS)}</td><td>${r.l ? R.badge(r.l, r.c) : `<span class="gp-muted">${esc(r.rating || '')}</span>`}</td>
                    <td>${esc(r.controls)}<input data-rn="${esc(r.k)}" maxlength="200" placeholder="Anything extra for our group (optional)" value="${esc(((plan.risks || {}).notes || {})[r.k] || '')}"></td>
                    <td>${lab(r.rl, R.LIKE)}</td><td>${lab(r.rc, R.CONS)}</td><td>${r.rl ? R.badge(r.rl, r.rc) : `<span class="gp-muted">${esc(r.rating || '')}</span>`}</td><td>${esc(r.owner || '')}</td><td></td></tr>`; }).join('')}
                  ${((plan.risks || {}).own || []).map(L.RiskUI.ownRow).join('')}</tbody></table></div>
              ${(t.info.risks || []).length ? '' : '<p class="gp-muted">The organisers haven\'t published their risk assessment yet. You can still add risks particular to your group.</p>'}
              <p class="gp-muted">Only add what isn't already covered — for example a long drive, a member's first overnight hike, or towing a trailer. Rate each risk before and after your controls.</p></div></div></section>
        <section class="rg-card"><h2>🛏 Overnight on the way</h2>
          ${tv ? `<p>The organisers' travel plan has your group driving about <b>${L.hm(tv.outMin)}</b> to the start${tvStops.length ? `. That's over 12 hours, so it includes an <b>overnight stop — suggested: ${[...new Set(tvStops.map(x => x.sug))].map(esc).join(', ')}</b>. The suggested town is filled in below: book somewhere to stay and add the cost. Staying somewhere else? Change the town and press <b>Find</b> — the organisers' travel plan and map then use your choice.` : (tv.nights || []).length ? `. That's over 12 hours, so it includes an <b>overnight stop — suggested: ${tv.nights.map(esc).join(', ')}</b>. Book somewhere to stay and add it here.` : '.'}${(tv.meals || []).length ? ` Meal stops: ${tv.meals.map(esc).join(', ')}.` : ''}</p>` : '<p class="rg-muted">If your drive is over 12 hours, plan to stop overnight. Add where you\'re staying and what it costs.</p>'}
          <div id="stayRows">${stayList(plan).map(stayRow).join('')}</div><button class="rg-btn" type="button" data-add="stay">➕ Add accommodation</button></section>
        <section class="rg-card"><h2>🚌 Public transport</h2><p class="rg-muted">For very long trips your group can go by bus, train or plane instead of (or as well as) driving. Add each leg with its times and total cost.</p>
          <div id="transRows">${(plan.transport || []).map(trRow).join('')}</div><button class="rg-btn" type="button" data-add="trans">➕ Add a bus, train or flight</button></section>
        <section class="rg-card"><h2>💰 Our travel costs</h2>
          <table class="rg-kv"><tr><th>Fuel</th><td>${C.fuel == null ? '<span class="rg-muted">worked out by the organisers once your cars and start places are in the travel plan</span>' : `${L.money(C.fuel)} <small class="rg-muted">from the organisers' travel plan${tv && tv.km ? `, ${Math.round(tv.km)} km` : ''}</small>`}</td></tr>
            <tr><th>Accommodation</th><td>${L.money(C.stay)}</td></tr><tr><th>Public transport</th><td>${L.money(C.transport)}</td></tr><tr><th>Group total</th><td><b>${L.money(C.total)}</b></td></tr>
            <tr><th>${C.shared ? 'Each person pays' : `Each person (${mine.length})`}</th><td><b>${C.each == null ? '—' : L.money(C.each)}</b>${C.shared ? ' <small class="rg-muted">— the organisers are sharing all groups\' travel costs evenly across everyone on the activity</small>' : ''}</td></tr></table>
          </section>
        <div class="rg-savebar no-print"><span class="rg-err" role="alert"></span><span class="rg-muted">Meals, pack weights, risks, stays and transport are saved together.</span><button class="rg-btn primary" type="submit">Save our plan</button></div></form>`;
      /* row templates are needed again when adding rows */
    }
    const blankTrans = `<div class="rg-prow rg-trans"><select data-k="mode">${Object.entries(RegoLib.MODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><input data-k="from" placeholder="From" maxlength="80"><input data-k="to" placeholder="To" maxlength="80">
        <label>Leaves<input data-k="depart" type="datetime-local"></label><label>Arrives<input data-k="arrive" type="datetime-local"></label><input data-k="cost" type="number" min="0" step="1" placeholder="Total cost $"><input data-k="note" placeholder="Flight / service, booking ref" maxlength="120"><button class="rg-x" type="button" data-rmrow title="Remove">✕</button></div>`;
    function readPlan() {
      const meals = (G.plan && G.plan.meals) || {};          // the meal planner and gear list keep G.plan up to date themselves
      const rows = sel => [...main.querySelectorAll(sel)].map(r => { const o = {}; r.querySelectorAll('[data-k]').forEach(i => { o[i.dataset.k] = i.type === 'number' ? (+i.value || 0) : i.value.trim(); }); return o; });
      const weights = {};
      main.querySelectorAll('[data-wb]').forEach(i => { const b = +i.value || 0, pk = +main.querySelector(`[data-wp="${i.dataset.wb}"]`).value || 0; if (b || pk) weights[i.dataset.wb] = { body: b, pack: pk }; });
      const notes = {}; main.querySelectorAll('[data-rn]').forEach(i => { if (i.value.trim()) notes[i.dataset.rn] = i.value.trim(); });
      const risks = { ack: [...main.querySelectorAll('[data-rk]:checked')].map(i => i.dataset.rk), notes, own: rows('.rg-own').filter(x => x.hazard).map(x => ({ ...x, l: +x.l || 3, c: +x.c || 3, rl: +x.rl || 2, rc: +x.rc || 3 })) };
      return { meals, menu: G.plan.menu, gear: G.plan.gear, _n: d.people.filter(p => !p.wait).length, stay: rows('.rg-stay').filter(x => x.place).map(x => ({ ...x, lat: x.lat === '' || !Number.isFinite(+x.lat) ? null : +x.lat, lon: x.lon === '' || !Number.isFinite(+x.lon) ? null : +x.lon })), transport: rows('.rg-trans').filter(x => x.from || x.to), weights, risks };
    }
    function carRow(c, i) {
      return `<div class="rg-car" data-car="${c.id || ''}"><input data-c="label" maxlength="60" value="${esc(c.label || `Car ${i + 1}`)}" aria-label="Car name"><input data-c="driver" maxlength="80" value="${esc(c.driver || '')}" placeholder="Driver" aria-label="Driver">
        <input data-c="seats" type="number" min="1" max="60" value="${c.seats || 5}" aria-label="Seats">${open ? '<button class="rg-x" type="button" data-delcar title="Remove this car">✕</button>' : ''}
        <div class="rg-start" data-lat="${c.start ? c.start.lat : ''}" data-lon="${c.start ? c.start.lon : ''}" data-name="${esc(c.start ? c.start.name : '')}">
          <span class="rg-start-now">${c.start ? `📍 Leaves from <b>${esc(c.start.name)}</b>` : '<span class="rg-warn">📍 Where does this car leave from?</span>'}</span>
          <span class="rg-start-find"><input data-c="q" placeholder="Suburb, town or address" aria-label="Where the car leaves from"><button class="rg-btn" type="button" data-find>Find</button></span>
          <div class="rg-start-res"></div></div>
        ${RegoLib.carSpec.form(t, c)}</div>`;
    }
    /* look a place up (OpenStreetMap), Australia only */
    async function findPlace(q) {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=au&q=' + encodeURIComponent(q));
      if (!r.ok) throw new Error('search failed');
      return (await r.json()).map(x => ({ name: x.display_name.replace(/, Australia$/, ''), short: (x.name || x.display_name.split(',')[0]) + (x.display_name.split(',')[1] && x.name ? ',' + x.display_name.split(',')[1] : ''), lat: +x.lat, lon: +x.lon }));
    }
    async function startSearch(box) {
      const q = $('[data-c=q]', box).value.trim(), out = $('.rg-start-res', box);
      if (q.length < 3) { out.innerHTML = '<p class="rg-muted">Type a suburb, town or address first.</p>'; return; }
      out.innerHTML = '<p class="rg-muted">Searching…</p>';
      try {
        const res = await findPlace(q);
        out.innerHTML = res.map(x => `<button type="button" class="rg-place" data-lat="${x.lat}" data-lon="${x.lon}" data-short="${esc(x.short)}">${esc(x.name)}</button>`).join('') || '<p class="rg-muted">Nothing found — try the suburb or town name.</p>';
      } catch (e) { out.innerHTML = '<p class="rg-warn">The search didn\'t work just now. Try again in a moment.</p>'; }
    }
    layoutGroup(d, t, G);
    const pf = $('#planForm');
    /* pack weights: a card per person (the same cards the organisers see), redrawn as gear, ticks and weights change */
    function drawPacks() {
      const el = $('#gpPacks'); if (!el) return;
      if (!G.plan._n) G.plan._n = d.people.filter(p => !p.wait).length;
      const openTicks = new Set([...el.querySelectorAll('details.rg-tick[open]')].map(x => x.dataset.p));
      el.innerHTML = RegoLib.packCards(t, G.plan, d.people, { extra: p => `<details class="rg-tick" data-p="${p.id}" ${openTicks.has(String(p.id)) ? 'open' : ''}><summary>${gearBadge(t, p)} tick their gear from the organisers' list</summary>${gearList(t).map(x => `<label class="rg-check"><input type="checkbox" data-gg="${p.id}" value="${esc(x.id)}" ${(p.gear || []).includes(x.id) ? 'checked' : ''}> <span>${esc(x.name)}${+x.w > 0 ? ` <small>${x.w >= 1000 ? (x.w / 1000).toFixed(1) + ' kg' : x.w + ' g'}</small>` : ''}</span></label>`).join('') || '<small>No gear list yet.</small>'}</details>` });
    }
    pf.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.wb || el.dataset.wp) { RegoLib.packRead($('#gpPacks'), G.plan); drawPacks(); }
      else if (el.dataset.gg) { const p = d.people.find(x => x.id === +el.dataset.gg); if (p) { p.gear = [...main.querySelectorAll(`[data-gg="${p.id}"]:checked`)].map(x => x.value); drawPacks(); } }
    });
    /* the meal planner and the gear list (same layout as the organisers' planner); they save as you go */
    { const UI = RegoLib.PlanUI, ctx = { t, plan: G.plan, people: d.people, who: '',
        share: what => api('group_add', { g, ...what }).then(r => { t.info.extra = r.extra; }).catch(() => {}),          // new recipes and gear go on the trip's list for every group
        save: async () => { try { const nd = await api('group_plan', { g, plan: { ...readPlan() } }); G.plan.flags = nd.group.plan.flags; toast('Saved'); } catch (err) { toast(err.message); } },
        draw: () => { const m = $('#gpMenu'), ge = $('#gpGear'); if (m) m.innerHTML = UI.menu(t, G.plan, d.people); if (ge) ge.innerHTML = UI.gear(t, G.plan, d.people, ctx.who); drawPacks(); } };
      ctx.draw(); ['#gpMenu', '#gpGear'].forEach(q => { if ($(q)) UI.bind($(q), ctx); }); }
    pf.onclick = e => {
      const add = e.target.closest('[data-add]');
      if (add && add.dataset.add === 'risk') { $('#riskRows').insertAdjacentHTML('beforeend', RegoLib.RiskUI.ownRow()); riskView(); return $('#riskRows tr:last-child [data-k=hazard]').focus(); }
      if (add) return $(add.dataset.add === 'stay' ? '#stayRows' : '#transRows').insertAdjacentHTML('beforeend', add.dataset.add === 'stay' ? stayRow() : blankTrans);
      const fs = e.target.closest('[data-findstay]');
      if (fs) {          // look the place up, so it can be pinned on the map
        const row = fs.closest('.rg-stay'), q = $('[data-k=place]', row).value.trim(), out = $('.rg-start-res', row);
        if (q.length < 3) { out.innerHTML = '<p class="rg-muted">Type the town or place first.</p>'; return; }
        out.innerHTML = '<p class="rg-muted">Searching…</p>';
        return findPlace(q).then(res => { out.innerHTML = res.map(x => `<button type="button" class="rg-place" data-lat="${x.lat}" data-lon="${x.lon}" data-short="${esc(x.short)}">${esc(x.name)}</button>`).join('') || '<p class="rg-muted">Nothing found — try the town name.</p>'; })
          .catch(() => { out.innerHTML = '<p class="rg-warn">The search didn\'t work just now. Try again in a moment.</p>'; });
      }
      const pl = e.target.closest('.rg-stay .rg-place');
      if (pl) {
        const row = pl.closest('.rg-stay');
        $('[data-k=place]', row).value = pl.dataset.short.slice(0, 80); $('[data-k=lat]', row).value = pl.dataset.lat; $('[data-k=lon]', row).value = pl.dataset.lon;
        $('.rg-start-res', row).innerHTML = ''; $('.rg-stay-st', row).innerHTML = stayState(rowVals(row));
        return;
      }
      if (e.target.closest('[data-rmrow]')) { e.target.closest('.rg-prow, .rg-own').remove(); riskView(); }
    };
    /* the matrix, the summary and the rating badges follow the table as it is edited */
    function riskView() {
      if (!$('#rkMatrix')) return;
      const list = [...main.querySelectorAll('#riskRows tr')].map(tr => { if (tr.classList.contains('rk-org')) return { l: +tr.dataset.l, c: +tr.dataset.c, rl: +tr.dataset.rl, rc: +tr.dataset.rc };
        const v = k => +tr.querySelector(`[data-k="${k}"]`).value, r = { l: v('l'), c: v('c'), rl: v('rl'), rc: v('rc') };
        tr.querySelector('.rk-b1').innerHTML = RegoLib.RiskUI.badge(r.l, r.c); tr.querySelector('.rk-b2').innerHTML = RegoLib.RiskUI.badge(r.rl, r.rc); return r; }).filter(r => r.l && r.c);
      $('#rkMatrix').innerHTML = RegoLib.RiskUI.matrix(list); $('#rkSummary').innerHTML = RegoLib.RiskUI.summary(list);
    }
    riskView();
    pf.addEventListener('change', e => { if (e.target.closest('#riskRows')) riskView(); });
    let ggT = {};
    pf.addEventListener('change', e => {          // ticking a member's gear saves straight away
      const el = e.target; if (!el.dataset.gg) return;
      const pid = +el.dataset.gg; clearTimeout(ggT[pid]);
      ggT[pid] = setTimeout(async () => { try { const nd = await api('group_gear', { g, id: pid, gear: [...main.querySelectorAll(`[data-gg="${pid}"]:checked`)].map(x => x.value) }); d.people = nd.people; drawPacks(); toast('Gear saved'); } catch (err) { toast(err.message); } }, 600);
    });
    /* a retyped place is no longer the pinned one */
    pf.addEventListener('input', e => {
      if (!e.target.matches('.rg-stay [data-k=place], .rg-stay [data-k=cost], .rg-stay [data-k=note]')) return;
      const row = e.target.closest('.rg-stay');
      if (e.target.dataset.k === 'place') { $('[data-k=lat]', row).value = ''; $('[data-k=lon]', row).value = ''; } $('.rg-stay-st', row).innerHTML = stayState(rowVals(row));
    });
    pf.onsubmit = e => { e.preventDefault(); submit(pf, async () => { const nd = await api('group_plan', { g, plan: readPlan() }); toast('Plan saved'); viewGroup(g, nd); }); };
    const rows = $('#carRows');
    if ($('#addCar')) $('#addCar').onclick = () => { rows.insertAdjacentHTML('beforeend', carRow({}, rows.children.length)); };
    /* vehicle details: the trailer's fields show when a trailer is ticked; the summary follows what is typed */
    rows.addEventListener('change', e => {
      const car = e.target.closest('.rg-car');
      if (!car || !e.target.matches('[data-s]')) return;
      if (e.target.dataset.s === 'trailer') $('.rg-trailer', car).hidden = !e.target.checked;
      $('.rg-spec-sum', car).innerHTML = RegoLib.carSpec.summary(t, { spec: RegoLib.carSpec.read(car) });
    });
    rows.onclick = e => {
      if (e.target.closest('[data-delcar]')) return e.target.closest('.rg-car').remove();
      const box = e.target.closest('.rg-start');
      if (!box) return;
      if (e.target.closest('[data-find]')) return startSearch(box);
      const pl = e.target.closest('.rg-place');
      if (pl) {          // chosen: kept on the row and saved with "Save cars and seats"
        box.dataset.lat = pl.dataset.lat; box.dataset.lon = pl.dataset.lon; box.dataset.name = pl.dataset.short;
        $('.rg-start-now', box).innerHTML = `📍 Leaves from <b>${esc(pl.dataset.short)}</b> <small class="rg-warn">— not saved yet</small>`;
        $('.rg-start-res', box).innerHTML = ''; $('[data-c=q]', box).value = '';
      }
    };
    rows.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('[data-c=q]')) { e.preventDefault(); startSearch(e.target.closest('.rg-start')); } };
    $('#carForm').onsubmit = e => {
      e.preventDefault();
      submit(e.target, async () => {
        const cars = [...rows.children].map(r => { const sb = $('.rg-start', r);
          return { id: +r.dataset.car || 0, label: $('[data-c=label]', r).value, driver: $('[data-c=driver]', r).value, seats: +$('[data-c=seats]', r).value,
            start: sb.dataset.lat ? { name: sb.dataset.name, lat: +sb.dataset.lat, lon: +sb.dataset.lon } : null, spec: RegoLib.carSpec.read(r) }; });
        const seatsOf = {}; main.querySelectorAll('[data-seat]').forEach(s => { seatsOf[s.dataset.seat] = +s.value; });
        const nd = await api('group_save', { g, cars, seats: seatsOf, note: e.target.elements.note.value });
        toast('Saved'); viewGroup(g, nd);
      });
    };
    main.querySelectorAll('[data-seat]').forEach(s => { s.onchange = async () => {
      try { const nd = await api('group_save', { g, seats: { [s.dataset.seat]: +s.value } }); d.people = nd.people; d.cars = nd.cars; toast('Saved'); } catch (e) { toast(e.message); } }; });
    main.querySelectorAll('[data-rm]').forEach(b => { b.onclick = async () => {
      const p = d.people.find(x => x.id === +b.dataset.rm);
      if (!confirm(`Remove ${p.name} from the activity?`)) return;
      try { viewGroup(g, await api('group_person', { g, id: p.id, remove: true })); } catch (e) { toast(e.message); } }; });
    const af = $('#addForm');
    if (af) af.onsubmit = e => { e.preventDefault(); submit(af, async () => { const nd = await api('group_person', { g, person: readPerson(af) }); toast('Added'); viewGroup(g, nd); }); };
    main.querySelectorAll('[data-print]').forEach(b => { b.onclick = () => {
      const k = b.dataset.print;
      if (k === 'tags') { const o = {}; main.querySelectorAll('[data-tag]').forEach(i => { o[i.dataset.tag] = i.value; }); try { localStorage.setItem('rego.tag', JSON.stringify(RegoLib.tagSize(o))); } catch (e) { /* private window */ }
        return RegoLib.print(RegoLib.bagTags(t, [G], d.people, o)); }
      RegoLib.print(k === 'plan' ? RegoLib.groupReport(t, G, d.people, d.cars) : k === 'emerg' ? RegoLib.emergencySheet(t, G, d.people, d.cars) : k === 'list' ? RegoLib.checkList(t, G, d.people, d.cars) : k === 'covers' ? RegoLib.carCovers(t, G, d.people, d.cars) : RegoLib.cards(t, [G], d.people));
    }; });
  }

  /* The group leader's page has two layouts. On a computer it looks and works like the planner: a tab ribbon with one
     part of the plan per tab, full width. On a phone it stays a simple column with the basics and quick changes; the
     detailed planning (meals, pack weights, risks, stays and transport) is tucked away unless asked for. */
  const GTABS = [['overview', '🏠 Overview'], ['members', '👥 Members'], ['cars', '🚗 Cars'], ['meals', '🍳 Meals'], ['gear', '🎒 Gear & weights'], ['risks', '⚠️ Risks'], ['travel', '🛏 Stays & transport'], ['costs', '💰 Costs'], ['print', '🖨 Print']];
  function layoutGroup(d, t, G) {
    const L = RegoLib, plan = G.plan || {}, mine = d.people.filter(p => !p.wait);
    document.body.classList.add('rg-group');
    const tabOf = h => (/Members/.test(h) ? 'members' : /Cars to/.test(h) ? 'cars' : /Print for/.test(h) ? 'print' : /Meals/.test(h) ? 'meals' : /Gear and pack/.test(h) ? 'gear' : /Risks and/.test(h) ? 'risks' : /Overnight|Public transport/.test(h) ? 'travel' : /travel costs/.test(h) ? 'costs' : 'overview');
    main.querySelectorAll('section.rg-card').forEach(s => { const h = s.querySelector('h2'); s.dataset.tab = tabOf(h ? h.textContent : ''); s.classList.toggle('rg-fine', ['meals', 'gear', 'risks', 'travel'].includes(s.dataset.tab)); });
    /* overview: where the plan is up to */
    const mc = L.mealCount(t, plan), issues = L.mealIssues(t, plan, d.people), off = L.offList(t, plan), risks = t.info.risks || [], ack = ((plan.risks || {}).ack || []).filter(k => risks.some(r => r.k === k)).length;
    const packs = mine.map(p => L.packState(t, plan, p)), seats = d.cars.reduce((a, c) => a + c.seats, 0), own = t.info.meals !== 'provided';
    const row = (ok, text, tab) => `<li class="${ok ? 'ok' : 'todo'}">${ok ? '✓' : '○'} ${text} <button class="rg-link" type="button" data-go="${tab}">open</button></li>`;
    $('section.rg-trip').insertAdjacentHTML('afterend', `<section class="rg-card rg-progress" data-tab="overview"><h2>📋 Where our plan is up to</h2><ul>
        ${row(d.people.every(p => p.complete), `${d.people.filter(p => p.complete).length} of ${d.people.length} members registered in full`, 'members')}
        ${row(d.cars.length > 0 && seats >= mine.length && d.cars.every(c => c.start) && d.cars.every(c => RegoLib.carSpec.state(t, c).ok), d.cars.length ? `${d.cars.length} car${d.cars.length === 1 ? '' : 's'}, ${seats} seats for ${mine.length}; ${d.cars.filter(c => c.start).length} with a start place, ${d.cars.filter(c => RegoLib.carSpec.state(t, c).ok).length} with full vehicle details` : 'No cars added yet', 'cars')}
        ${own ? row(mc.n === mc.of && !issues.length, `${mc.n} of ${mc.of} main meals planned${off.length ? ` · ${off.length} not on the recipe list` : ''}${issues.length ? ` · <b class="rg-warn">${issues.length} to check for dietary needs</b>` : ''}`, 'meals') : ''}
        ${row(packs.every(s => s.pct != null) && !packs.some(s => s.pct > 20), `${packs.filter(s => s.pct != null).length} of ${mine.length} pack weights worked out${packs.some(s => s.pct > 20) ? ` · <b class="rg-warn">${packs.filter(s => s.pct > 20).length} over 20%</b>` : ''}`, 'gear')}
        ${risks.length ? row(ack === risks.length, `${ack} of ${risks.length} risks and controls read`, 'risks') : ''}
        ${row(true, `${(plan.stay || []).length} stay${(plan.stay || []).length === 1 ? '' : 's'}, ${(plan.transport || []).length} public transport leg${(plan.transport || []).length === 1 ? '' : 's'} entered`, 'travel')}
      </ul></section>
      <section class="rg-card rg-mobnote no-print" data-tab="overview"><p><b>On a phone this page shows the basics</b> — members, cars, seats and costs — for quick changes. Plan the detail (meals, pack weights, risks, stays and transport) on a computer: open this same link there.</p>
        <button class="rg-btn" type="button" id="rgAll">${document.body.classList.contains('rg-all') ? 'Hide the detailed planning' : 'Show the detailed planning here anyway'}</button></section>`);
    $('#rgAll').onclick = () => { document.body.classList.toggle('rg-all'); $('#rgAll').textContent = document.body.classList.contains('rg-all') ? 'Hide the detailed planning' : 'Show the detailed planning here anyway'; };
    /* the tab ribbon (full-screen layout) */
    let nav = $('#rgTabs');
    if (!nav) { nav = document.createElement('nav'); nav.id = 'rgTabs'; nav.className = 'rg-tabs no-print'; main.parentNode.insertBefore(nav, main); }
    const badge = { meals: issues.length + off.length, gear: packs.filter(s => s.pct > 20).length, risks: risks.length - ack, overview: (plan.flags || []).length };
    nav.innerHTML = GTABS.filter(([k]) => own || k !== 'meals' || true).map(([k, label]) => `<button type="button" data-tab="${k}">${label}${badge[k] ? ` <i>${badge[k]}</i>` : ''}</button>`).join('');
    const show = k => {
      try { sessionStorage.setItem('rg.tab', k); } catch (e) { /* private window */ }
      main.dataset.tab = k;
      nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === k));
      main.querySelectorAll('section[data-tab]').forEach(s => s.classList.toggle('rg-on', s.dataset.tab === k));
      if (matchMedia('(min-width: 900px)').matches) window.scrollTo(0, 0);
    };
    nav.onclick = e => { const b = e.target.closest('button[data-tab]'); if (b) show(b.dataset.tab); };
    $('.rg-progress').onclick = e => { const b = e.target.closest('[data-go]'); if (!b) return; if (!matchMedia('(min-width: 900px)').matches) document.body.classList.add('rg-all'); show(b.dataset.go);
      const first = main.querySelector(`section[data-tab="${b.dataset.go}"]`); if (first) first.scrollIntoView({ behavior: 'smooth' }); };
    let k0 = 'overview'; try { k0 = sessionStorage.getItem('rg.tab') || 'overview'; } catch (e) { /* ignore */ }
    show(GTABS.some(x => x[0] === k0) ? k0 : 'overview');
    /* header like the planner's */
    const head = $('.rg-head');
    if (!head.querySelector('.rg-brand')) head.insertAdjacentHTML('afterbegin', '<span class="rg-brand"><img src="img/logo-header.png" alt="" width="26" height="37"> Camp Planner · Group planning</span>');
    head.querySelector('span:last-child').textContent = t.name;
  }

  (async () => {
    try {
      if (Q.get('g')) await viewGroup(Q.get('g'));
      else if (Q.get('p')) await viewMe(Q.get('p'));
      else if (Q.get('r')) await viewRegister(Q.get('r'));
      else fatal('This page needs a registration link from the activity\'s organiser.');
    } catch (e) { fatal(e.message); }
  })();
})();
