/* Camp Planner — People tab: the activity's phases, registration, groups, cars, briefing, go / no-go and check-in, rolled up for the organisers.
   Phases: 1 plan the route and hike -> 2 approved -> 3 expressions of interest -> 4 logistics and coordination (full registration,
   groups, cars, gear, travel plan) -> 5 briefing and feedback -> 6 go / no-go -> 7 executing (check-in, then the Dashboard tab).
   What the registration page shows (gear everyone needs, meals, notes) is set here and saved with the trip (state.rego);
   the registrations themselves live on the website (api/rego.php) and are deleted 30 days after the trip. */

const Rego = (() => {
  const L = RegoLib;
  const root = () => $('#tab-people');
  let D = null, Did = null, err = '', bound = false, busy = false, pushT = null, tvT = null, open = new Set();
  const BASIC = ['Backpack with rain cover', 'Sleeping bag', 'Sleeping mat', 'Rain jacket', 'Warm jumper or fleece', 'Hat and sunscreen', 'Walking shoes or boots', 'Spare clothes and socks',
    'Water bottles (2 L)', 'Torch or head torch', 'Plate, bowl, mug and cutlery', 'Personal first aid and medication', 'Toiletries and towel'];

  const BASIC_G = { 'Backpack with rain cover': 1800, 'Sleeping bag': 1300, 'Sleeping mat': 600, 'Rain jacket': 400, 'Warm jumper or fleece': 450, 'Hat and sunscreen': 200, 'Walking shoes or boots': 0, 'Spare clothes and socks': 900,
    'Water bottles (2 L)': 150, 'Torch or head torch': 90, 'Plate, bowl, mug and cutlery': 300, 'Personal first aid and medication': 200, 'Toiletries and towel': 350 };
  function cfg() {
    const s = Store.state;
    s.rego = Object.assign({ closes: '', meals: 'own', note: '', gear: [], brief: '', briefOn: false, max: '', costShare: 'group', tagPhone: '' }, s.rego);
    s.rego.decision = Object.assign({ go: null, note: '', by: '', at: null }, s.rego.decision);
    return s.rego;
  }
  const where = () => { const t = Store.state.trip; return [t.location, t.park ? `${t.park.name} ${t.park.type}` : '', t.state].filter(Boolean).join(', '); };
  /* Each group's travel: fuel cost, driving time, overnight and meal stops (from the Travel tab, for cars sent there),
     plus what the group has entered itself (accommodation, public transport). */
  function groupCosts() {
    if (!D) return { rows: [], total: 0, people: 0, perAll: null };
    const facts = typeof Travel !== 'undefined' && Travel.carFacts ? Travel.carFacts() : [], P = D.people.filter(p => !p.wait);
    const rows = D.groups.map(g => {
      const cars = D.cars.filter(c => c.group === g.id), fs = cars.map(c => facts.find(f => f.regoCar === c.id)).filter(Boolean), done = fs.filter(f => f.complete);
      const plan = g.plan || {}, stay = (plan.stay || []).reduce((a, x) => a + (+x.cost || 0), 0), transport = (plan.transport || []).reduce((a, x) => a + (+x.cost || 0), 0);
      const fuel = done.length ? done.reduce((a, f) => a + f.cost, 0) : null, n = P.filter(p => p.group === g.id).length;
      return { g, n, cars: cars.length, inPlan: fs.length, fuel, km: done.reduce((a, f) => a + f.km, 0), outMin: Math.max(0, ...done.map(f => f.outMin || 0)) || null,
        nights: [...new Set(fs.flatMap(f => f.nights))], stops: fs.flatMap(f => f.stops || []).filter((x, i, a) => a.findIndex(y => y.key === x.key) === i), meals: [...new Set(fs.flatMap(f => f.meals))], stay, transport, total: (fuel || 0) + stay + transport };
    });
    const total = rows.reduce((a, r) => a + r.total, 0);
    return { rows, total, people: P.length, perAll: P.length ? total / P.length : null };
  }
  const travelInfo = () => { const G = groupCosts(), out = {}; G.rows.forEach(r => { if (r.inPlan) out[r.g.id] = { fuel: r.fuel == null ? null : Math.round(r.fuel * 100) / 100, km: Math.round(r.km), outMin: r.outMin == null ? null : Math.round(r.outMin), nights: r.nights, meals: r.meals,
      stops: r.stops.map(x => ({ key: x.key, sug: x.sug, lat: x.slat == null ? null : +(+x.slat).toFixed(5), lon: x.slon == null ? null : +(+x.slon).toFixed(5), night: x.night, home: x.home })) }; });
    return { travel: out, cost: { share: cfg().costShare, perAll: G.perAll == null ? null : Math.round(G.perAll * 100) / 100 } }; };
  /* the emergency plan's contacts (Risks tab) for the groups' printed plans; the return phone number for bag tags */
  const emergencyInfo = () => { const em = Store.state.emergency || {}, out = {}; ['plb', 'contact', 'returnBy', 'hospital', 'reception', 'ranger', 'police', 'evac', 'firstAider'].forEach(k => { const v = String(em[k] == null ? '' : em[k]).trim().slice(0, 200); if (v) out[k] = v; }); return out; };
  const tagPhone = () => String(cfg().tagPhone || '').trim().slice(0, 30);
  const info = () => { const c = cfg(); return { ...travelInfo(), emergency: emergencyInfo(), tagPhone: tagPhone(), where: where(), note: c.note, meals: c.meals, max: num(c.max) > 0 ? Math.round(num(c.max)) : 0, briefing: c.briefOn ? c.brief : '', decision: c.decision.go == null ? null : { go: c.decision.go, note: c.decision.note }, recipes: (Store.state.recipes || []).filter(r => r.name).slice(0, 200).map(r => ({ id: r.id, name: String(r.name).trim(), slot: r.slot || '', g: Math.round((r.ingredients || []).reduce((a, x) => a + num(x.weightG), 0)), kcal: Math.round((r.ingredients || []).reduce((a, x) => a + num(x.kcal), 0)), ing: (r.ingredients || []).map(x => String(x.name || '').trim()).filter(Boolean).slice(0, 30) })),
      risks: (Store.state.risks || []).map((r, i) => ({ k: String(r.id || 'r' + i), hazard: r.hazard || '', cause: r.cause || '', controls: r.controls || '', rating: (Risk.rating(r.rl, r.rc) || [''])[0], l: num(r.l), c: num(r.c), rl: num(r.rl), rc: num(r.rc), location: r.location || '', owner: r.owner || '' })).filter(r => r.hazard),
      gear: c.gear.filter(g => g.name.trim()).map(g => ({ id: g.id, name: g.name.trim(), req: g.req !== false, w: Math.round(num(g.w)) || 0 })) }; };
  const call = (action, body) => Server.call('rego.php?action=' + action, body);
  const id = () => Store.tripId;

  async function load() {
    if (!id() || !Store.canEdit) { D = null; return; }
    Did = id();
    try { D = await call('admin&id=' + encodeURIComponent(id())); err = ''; }
    catch (e) { D = null; err = e.message; }
  }
  /* send what the registration page shows, a moment after the last change */
  function push() {
    clearTimeout(pushT);
    pushT = setTimeout(() => { if (id() && Store.canEdit) call('info_save', { id: id(), info: info() }).then(() => { if (D) D.trip.info = info(); }).catch(e => toastMsg(e.message)); }, 900);
  }
  /* The travel plan, the risk assessment, the recipes or the emergency contacts may have changed: tell the group pages
     (only those parts — never capacity or gear from here). Called when the People or Travel tab is drawn and on every
     tab change, so the groups' suggested overnight towns don't wait for someone to open the People tab.
     While the stops data or a car's route is still loading the travel part is left as it was, so nothing is wiped. */
  function syncParts() {
    const was = D.trip.info || {}, full = info(), tr = Store.state.travel || { cars: [] };
    const inPlan = D.cars.filter(c => tr.cars.some(t => t.regoCar === c.id));
    let ready = true;
    if (inPlan.length && typeof Travel !== 'undefined') {
      if (Travel.stopsReady && !Travel.stopsReady()) ready = false;
      else { const facts = Travel.carFacts ? Travel.carFacts() : []; ready = inPlan.every(c => (facts.find(f => f.regoCar === c.id) || {}).complete); }
    }
    const parts = { risks: full.risks, recipes: full.recipes, emergency: full.emergency };
    if (ready) { parts.travel = full.travel; parts.cost = full.cost; }
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), sorted = o => Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {});
    parts.emergency = sorted(parts.emergency);
    const old = { risks: was.risks || [], recipes: was.recipes || [], emergency: sorted(obj(was.emergency)) };
    if (ready) { old.travel = obj(was.travel); old.cost = was.cost || { share: 'group', perAll: null }; }
    return { ready, parts, changed: JSON.stringify(parts) !== JSON.stringify(old) };
  }
  function syncTravel() {
    try {
      if (!D || Did !== id() || !id() || !Store.canEdit) return;
      if (!D.trip.reg || D.trip.reg === 'off') { if (!D.groups.length) return; }          // nobody has a registration page yet
      const S = syncParts();
      if (!S.ready && typeof Travel !== 'undefined' && Travel.stopsReady && !Travel.stopsReady() && Travel.loadStops && !stopsAsked) {
        stopsAsked = true; const p = Travel.loadStops(); if (p && p.then) p.then(() => syncTravel()).catch(() => {}); }
      if (!S.changed) return;
      clearTimeout(tvT);
      tvT = setTimeout(() => {
        if (!D || Did !== id() || !id() || !Store.canEdit) return;
        const N = syncParts(); if (!N.changed) return;
        const sig = Did + JSON.stringify(N.parts); if (sig === sent) return;          // the same thing is never sent twice (the server may store it a little differently)
        sent = sig;
        const next = { ...(D.trip.info || {}), ...N.parts };
        call('info_save', { id: id(), info: next }).then(() => { if (D) D.trip.info = next; }).catch(() => {});
      }, 1200);
    } catch (e) { /* never in the way of drawing a tab */ }
  }
  let stopsAsked = false, sent = '';
  const toastMsg = m => { const el = $('#regoMsg'); if (el) { el.textContent = m; setTimeout(() => { if (el.textContent === m) el.textContent = ''; }, 5000); } };

  /* ---------- phases ---------- */
  function stage() {
    const a = Store.access || {}, c = cfg();
    const approved = D ? D.trip.approved : a.pub === 'published', reg = D ? D.trip.reg : 'off';
    const cur = !approved ? 1 : reg === 'off' ? 2 : reg === 'interest' ? 3 : c.decision.go === true ? 7 : c.decision.go === false ? 6 : c.briefOn ? 5 : 4;
    return { cur, approved, reg, nogo: c.decision.go === false, go: c.decision.go === true };
  }
  function stepper(S) {
    const steps = [['Route & hike', 'Plan the trail, days and camps'], ['Approved', 'Reviewed and published'], ['Expressions of interest', 'Who would like to come'],
      ['Logistics & coordination', 'Registration, groups, cars, gear, travel'], ['Briefing & feedback', 'Everyone reads the plan'], ['Go / no-go', S.nogo ? 'NOT going ahead' : 'The decision point'], ['Executing', 'Check-in and the live dashboard']];
    return `<ol class="stage-steps">${steps.map(([t, d], i) => `<li class="${i + 1 < S.cur ? 'done' : i + 1 === S.cur ? (S.nogo ? 'now stop' : 'now') : ''}"><b>${i + 1 < S.cur ? '✓' : i + 1}</b><span>${t}<small>${d}</small></span></li>`).join('')}</ol>`;
  }
  /* a one-line reminder of the phase, shown under the tabs on every tab once registration is in use */
  function bar() {
    const el = $('#stageBar');
    if (!el) return;
    if (!D || D.trip.reg === 'off') { el.hidden = true; return; }
    const S = stage(), n = D.people.length, here = D.people.filter(p => p.attend === 'present').length, link = ' <a href="#people" data-goto="people">People</a>';
    el.hidden = false;
    el.classList.toggle('stop', S.nogo);
    el.innerHTML = S.cur === 3 ? `🙋 <b>Taking expressions of interest</b> — ${n} so far.${link}`
      : S.cur === 4 && S.reg === 'open' ? `📝 <b>Logistics: registration is open</b> — ${D.people.filter(p => p.complete).length} of ${n} registered in full, ${D.groups.length} group${D.groups.length === 1 ? '' : 's'}, ${D.cars.length} car${D.cars.length === 1 ? '' : 's'} nominated.${App.current === 'travel' ? ' <b>Build the travel plan after registration closes</b>, when the car numbers are final.' : ''}${link}`
      : S.cur === 4 ? `🔒 <b>Logistics: registration is closed</b> — ${n} people, ${D.cars.length} cars. Next: the travel plan, then the briefing.${link}`
      : S.cur === 5 ? `📣 <b>Briefing is out</b> — ${D.people.filter(p => p.briefAt).length} of ${n} have read it. Next: the go / no-go decision.${link}`
      : S.nogo ? `❌ <b>NO-GO</b> — the activity is not going ahead.${link}`
      : `🟢 <b>GO — executing.</b> ${here} of ${D.people.filter(p => p.attend !== 'noshow').length} checked in. <a href="#dash" data-goto="dash">Dashboard</a> ·${link}`;
  }

  /* ---------- render ---------- */
  async function render() {
    if (!bound) bind();
    const r = root();
    if (!Store.canEdit || !id()) {
      r.innerHTML = `<div class="card"><h2>👥 People</h2><p class="muted">${id() ? 'Registrations, groups and check-in are for the trip\'s leaders. Sign in to see them.' : 'Save the trip first, then registration can be set up here.'}</p></div>`;
      return;
    }
    if (!D && !err) r.innerHTML = '<div class="card"><p class="muted">Loading registrations…</p></div>';
    await load();
    draw();
  }

  function draw() {
    const r = root(), c = cfg();
    bar();
    if (D) adoptExtras();
    if (!D) { r.innerHTML = `<div class="card"><h2>👥 People</h2><p class="bad-text">${esc(err || 'Could not load registrations.')}</p></div>`; return; }
    const S = stage(), T = D.trip, P = D.people.filter(p => !p.wait), G = D.groups, C = D.cars, em = Store.state.emergency || {};   // P: people with a place
    const t = { ...T, info: info() };                         // gear progress against the list as it is now
    const A = D.people;                                       // everyone, including the waiting list
    const W = A.filter(p => p.wait), cap = t.info.max || 0;
    const seats = C.reduce((a, x) => a + x.seats, 0), ready = P.filter(p => L.gearState(t, p).ok).length;
    const n = f => P.filter(f).length;
    const diet = P.filter(p => p.dietary);
    const regUrl = T.regToken ? L.link.register(T.regToken) : '', ckUrl = T.checkinToken ? L.link.checkin(T.checkinToken) : '';
    const carName = cid => (C.find(x => x.id === cid) || {}).label || '';
    const pRow = (p, g) => { const gs = L.gearState(t, p); return `<tr>
        <td><b>${esc(p.name)}</b>${g && g.leader === p.id ? ' <span class="tag">leader</span>' : ''}${p.wait ? ' <span class="tag bad">⏳ waiting list</span>' : p.waitGroup ? ' <span class="tag bad">⏳ no seat</span>' : ''}<br><small class="muted">${p.kind === 'adult' ? 'Adult' : 'Youth'}${p.mobile ? ' · ' + esc(p.mobile) : ''}</small></td>
        <td class="small">${esc(p.emName)}<br>${esc(p.emPhone)}</td>
        <td class="small">${esc(p.dietary || '')}${p.medFlag ? `${p.dietary ? '<br>' : ''}<span class="bad-text">⚕ medical notes</span>` : ''}</td>
        <td>${p.consent ? `<span title="by ${esc(p.consentBy)}">✓</span>` : `<span class="bad-text" title="No consent recorded">${T.reg === 'interest' ? '—' : '✗'}</span>`}${c.briefOn ? (p.briefAt ? ' 📣' : '') : ''}</td>
        <td title="${esc(gs.missing.length ? 'Not ticked: ' + gs.missing.join(', ') : '')}">${L.gearBadge(t, p)}</td>
        <td class="small">${esc(carName(p.car))}</td>
        <td>${p.attend === 'present' ? '✅' : p.attend === 'noshow' ? '❌' : ''}</td>
        <td class="no-print"><select data-move="${p.id}" title="Move to another group"><option value="">No group</option>${G.map(x => `<option value="${x.id}" ${x.id === p.group ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          ${p.wait ? `<button class="btn small" data-admit="${p.id}" title="Give them a place now, even though the trip is at capacity">＋ place</button>` : ''}<button class="btn small" data-plink="${p.id}" title="Copy this person's own link (to send to them or their parent)">🔗</button>${g && g.leader !== p.id ? `<button class="btn small" data-lead="${p.id}" data-g="${g.id}" title="Make group leader">★</button>` : ''}<button class="btn small danger" data-prm="${p.id}" title="Remove from the activity">✕</button></td></tr>`; };
    const pTable = (list, g) => (list.length ? `<table class="tbl compact rego-people"><thead><tr><th>Name</th><th>Emergency contact</th><th>Dietary / medical</th><th>Consent</th><th>Gear</th><th>Car</th><th>Here</th><th class="no-print"></th></tr></thead><tbody>${list.map(p => pRow(p, g)).join('')}</tbody></table>` : '<p class="muted small">Nobody yet.</p>');

    /* the travel plan or the risk assessment may have changed: tell the group pages (only those parts — never capacity or gear from here) */
    syncTravel();
    r.innerHTML = `
      <div class="card"><div class="page-head"><h2>👥 People — registration, groups and check-in</h2><span id="regoMsg" class="muted small"></span></div>
        ${stepper(S)}
        <div class="btn-row">
          ${S.reg === 'off' ? `<button class="btn primary" data-a="interest" ${S.approved ? '' : 'disabled'}>Open for expressions of interest</button><button class="btn" data-a="open" ${S.approved ? '' : 'disabled'} title="Skip the interest phase: ask for full details and consent straight away">Go straight to full registration</button>` : ''}
          ${S.reg === 'interest' ? '<button class="btn primary" data-a="open" title="People who expressed interest are asked to complete their registration: emergency contact and consent">Start logistics: open full registration</button>' : ''}
          ${S.reg === 'open' ? '<button class="btn primary" data-a="close">Close registration</button>' : ''}
          ${S.reg === 'closed' ? '<button class="btn" data-a="open">Re-open registration</button>' : ''}
          ${S.reg !== 'off' ? '<button class="btn" data-a="off" title="Hide the registration page. Registrations already made are kept.">Switch registration off</button>' : ''}
          ${S.go ? '<button class="btn primary" data-goto="dash">🛰 Open the dashboard</button>' : ''}
          <button class="btn" data-a="reload">↻ Refresh</button>
        </div>
        ${S.approved ? '' : '<p class="small">Interest and registration can open once the plan is <b>approved</b>: submit it for review on the <a href="#trip" data-goto="trip">Trip</a> tab. You can set everything up below while you wait.</p>'}
        ${S.reg === 'interest' ? `<p class="small"><b>${P.length}</b> ${P.length === 1 ? 'person has' : 'people have'} expressed interest. When you're ready to organise it, start logistics: everyone is then asked for an emergency contact and consent, and groups nominate their cars.</p>` : ''}
        ${S.reg === 'closed' && S.cur === 4 ? `<p class="small">Registration is closed, so the numbers are final: <b>${P.length} people, ${C.length} cars (${seats} seats)</b>. Use <b>Send cars to the travel plan</b> in the roll-up below${C.some(x => !x.start) ? ` (<span class="bad-text">${C.filter(x => !x.start).length} of ${C.length} cars have no start location yet</span>)` : ''}, then build the <a href="#travel" data-goto="travel">Travel</a> plan, then send out the briefing below.</p>` : ''}
      </div>

      <div class="rego-cols">
        <div class="card"><h3>What people see when they register</h3>
          <div class="row wrap"><label class="field"><span>Registration closes (end of day)</span><input type="date" data-c="closes" value="${esc(c.closes)}"></label>
            <label class="field" title="Printed on the bag tags as the number to ring if a bag is found. Leave empty to print none."><span>Return phone number for bag tags</span><input type="tel" data-c="tagPhone" maxlength="30" value="${esc(c.tagPhone || '')}" placeholder="e.g. 0400 000 000"></label>
            <label class="field" title="The most people who can come. Once it is reached, new people go on a waiting list and move up automatically when a place opens. Leave empty for no limit."><span>Trip capacity (people)</span><span class="rego-cap"><b>${num(c.max) > 0 ? Math.round(num(c.max)) : 'no limit'}</b> <button class="btn small" type="button" data-a="cap" ${S.cur <= 4 ? '' : 'disabled'} title="${S.cur <= 4 ? 'Change the capacity, and choose who moves off or onto the waiting list' : 'The capacity is fixed once the briefing has gone out'}">Change…</button></span></label>
            <label class="field"><span>Meals</span><select data-c="meals"><option value="own" ${c.meals === 'own' ? 'selected' : ''}>People bring and organise their own food</option><option value="provided" ${c.meals === 'provided' ? 'selected' : ''}>Organised meals are provided (plan them on the Meals tab)</option></select></label></div>
          <label class="field"><span>Note for participants and families</span><textarea data-c="note" rows="2" placeholder="Cost, what the activity involves, who to contact…">${esc(c.note)}</textarea></label>
          <h4>Gear everyone needs <small class="muted">— the basics; people organise their own gear and tick it off</small></h4>
          <div class="rego-gear">${c.gear.map((g, i) => `<div><input data-gn="${i}" value="${esc(g.name)}" maxlength="80"><input type="number" min="0" step="10" class="w-sm" data-gw="${i}" value="${num(g.w) || ''}" placeholder="g" title="Weight in grams — used to estimate each person's pack weight"><label class="check" title="Untick for nice-to-have items"><input type="checkbox" data-gr="${i}" ${g.req !== false ? 'checked' : ''}> needed</label><button class="btn small danger" data-gx="${i}">✕</button></div>`).join('') || '<p class="muted small">No gear listed yet.</p>'}</div>
          <div class="btn-row"><button class="btn small" data-a="gadd">➕ Add an item</button><button class="btn small" data-a="gbasic" title="A basic overnight hiking list to edit">Start from a basic list</button>
            <button class="btn small" data-a="gplan" title="Everyone's personal gear from the Gear tab (not group gear)" ${Store.state.gear.some(g => g.carrier !== 'group') ? '' : 'disabled'}>Use the plan's personal gear</button></div>
          <p class="muted small">${c.meals === 'own' ? 'Each group organises its own food and shared gear through its group leader.' : 'Dietary needs from registration are listed on the right for whoever plans the meals.'}</p>
        </div>
        <div class="card"><h3>Links</h3>
          ${regUrl ? `<div class="rego-link">${L.qr(regUrl, 120)}<div><b>Registration link</b> ${S.reg === 'open' ? '<span class="tag ok">open</span>' : `<span class="tag">${S.reg}</span>`}<br><input readonly value="${esc(regUrl)}" onclick="this.select()"><br>
              <button class="btn small" data-copy="${esc(regUrl)}">Copy link</button> <a class="btn small" href="${esc(regUrl)}" target="_blank" rel="noopener">Open</a>
              <p class="muted small">Send this to members and families. Each person registers, and joins or starts a group.${T.closes ? ` Closes ${L.fmtDay(T.closes)}.` : ''}</p></div></div>` : '<p class="muted small">The registration link appears here once registration is opened.</p>'}
          <div class="rego-link">${ckUrl ? L.qr(ckUrl, 120) : ''}<div><b>Check-in app</b> <small class="muted">(for the leaders checking people in at the start)</small><br>
            ${ckUrl ? `<input readonly value="${esc(ckUrl)}" onclick="this.select()"><br><button class="btn small" data-copy="${esc(ckUrl)}">Copy link</button> <button class="btn small" data-a="cknew">New link</button> <button class="btn small danger" data-a="ckoff">Remove</button>
              <p class="muted small">Open it on the check-in phone <b>while it has service</b>: it then keeps the list and works offline. It shows everyone's details, so only give it to check-in leaders. "New link" stops the old one working.</p>`
            : '<button class="btn small" data-a="cknew">Make the check-in link</button><p class="muted small">Scans the QR codes on car cover pages and participant cards.</p>'}</div></div>
        </div>
      </div>

      ${S.reg !== 'off' && S.reg !== 'interest' ? `<div class="rego-cols">
        <div class="card"><h3>📣 Briefing &amp; feedback ${c.briefOn ? '<span class="tag ok">sent</span>' : ''}</h3>
          <textarea data-c="brief" rows="6" placeholder="The final plan for everyone: where and when to meet, what the days look like, what to wear and bring, who to call, what happens if the weather turns…">${esc(c.brief)}</textarea>
          <div class="btn-row">${c.briefOn ? '<button class="btn small" data-a="briefoff">Withdraw the briefing</button>' : `<button class="btn primary small" data-a="briefon" ${c.brief.trim() ? '' : 'disabled'}>Send the briefing to participants</button>`}</div>
          <p class="muted small">It appears on each person's registration page, where they tick <b>“I've read the briefing”</b> and can ask a question. ${c.briefOn ? 'Edits you make here update it straight away.' : 'Tell people to open their own link.'}</p>
          ${c.briefOn ? `<p class="small"><b>${n(p => p.briefAt)} of ${P.length}</b> have read it${n(p => !p.briefAt) ? ` — still to read: ${P.filter(p => !p.briefAt).map(p => esc(p.name)).join(', ')}` : ''}.</p>` : ''}
          ${P.some(p => p.feedback) ? `<h4>Questions and comments</h4><ul class="rego-fb">${P.filter(p => p.feedback).map(p => `<li><b>${esc(p.name)}:</b> ${esc(p.feedback)}</li>`).join('')}</ul>` : ''}
        </div>
        <div class="card ${S.go ? 'rego-go' : S.nogo ? 'rego-nogo' : ''}"><h3>🚦 Go / no-go</h3>
          ${(() => { const ready = P.filter(p => L.gearState(t, p).ok).length, ck = (ok, txt, warn) => `<li class="${ok ? 'ok' : warn ? 'warn' : 'bad'}">${ok ? '✓' : warn ? '!' : '✗'} ${txt}</li>`;
            return `<ul class="rego-check">
              ${ck(S.approved, 'Plan approved')}
              ${ck(S.reg === 'closed', S.reg === 'closed' ? 'Registration closed — numbers final' : 'Registration is still open')}
              ${ck(P.length > 0 && P.every(p => p.complete), `${n(p => p.complete)} of ${P.length} registered in full with consent`)}
              ${ck(G.length > 0 && P.every(p => p.group != null), n(p => p.group == null) ? `${n(p => p.group == null)} people have no group` : 'Everyone is in a group')}
              ${ck(seats >= P.length && C.length > 0 && !P.some(p => p.waitGroup), P.some(p => p.waitGroup) ? `${P.filter(p => p.waitGroup).length} people have no seat in their group's cars` : `${seats} seats for ${P.length} people in ${C.length} cars`)}
              ${(() => { const rk = t.info.risks.length, done = G.filter(g => rk && ((g.plan.risks || {}).ack || []).filter(k => t.info.risks.some(r => r.k === k)).length >= rk).length;
                const over = G.flatMap(g => P.filter(p => p.group === g.id).filter(p => { const s = L.packState(t, g.plan, p); return s.pct != null && s.pct > 20; }));
                return ck(rk > 0 && done === G.length, rk ? `${done} of ${G.length} groups have read all the risks and controls` : 'No risks assessed yet', true) + ck(!over.length, over.length ? `${over.length} packs are over 20% of body weight: ${over.map(p => esc(p.name)).join(', ')}` : 'No packs known to be over 20% of body weight', true); })()}
              ${W.length ? ck(false, `${W.length} on the trip's waiting list (not coming unless a place opens)`, true) : ''}
              ${ck(C.length > 0 && C.every(x => x.start), C.every(x => x.start) ? 'Every car has a start location' : `${C.filter(x => !x.start).length} of ${C.length} cars have no start location`)}
              ${(() => { const st = C.map(x => L.carSpec.state(t, x)), bad = st.filter(x => x.issues.length).length, inc = st.filter(x => !x.ok).length;
                return ck(C.length > 0 && !inc, !C.length ? 'No cars registered yet' : bad ? `${bad} car${bad > 1 ? 's have' : ' has'} a registration or trailer problem (see the group's car table)` : inc ? `${inc} of ${C.length} cars are missing vehicle details (payload, fuel, registration)` : 'Every car has its vehicle details and current registration', true); })()}
              ${ck(C.length > 0 && C.every(x => Store.state.travel.cars.some(tc => tc.regoCar === x.id)), 'Registered cars are in the travel plan', true)}
              ${ck(!t.info.gear.length || ready === P.length, t.info.gear.length ? `${ready} of ${P.length} have ticked all their gear` : 'No gear list set', true)}
              ${ck(c.briefOn && P.every(p => p.briefAt), c.briefOn ? `${n(p => p.briefAt)} of ${P.length} have read the briefing` : 'Briefing not sent yet', c.briefOn)}
              ${ck(!!(em.contact && em.hospital), em.contact && em.hospital ? 'Emergency plan has a home contact and hospital' : 'Emergency plan is missing the home contact or hospital (Risks tab)')}
              ${ck((Store.state.risks || []).length > 0, `${(Store.state.risks || []).length} risks assessed`)}
              ${ck(!!T.checkinToken, T.checkinToken ? 'Check-in link is ready' : 'Check-in link not made yet', true)}
              <li class="warn">! Check the forecast, fire danger and park alerts on the <a href="#weather" data-goto="weather">Weather</a> tab</li></ul>`; })()}
          <label class="field"><span>Decision note <small class="muted">(shown to participants)</small></span><textarea data-dn rows="2" placeholder="e.g. Going ahead as planned. / Postponed: severe weather warning.">${esc(c.decision.note)}</textarea></label>
          ${c.decision.go == null ? '<div class="btn-row"><button class="btn primary rego-gobtn" data-a="go">✅ GO</button><button class="btn danger" data-a="nogo">❌ NO-GO</button></div>'
            : `<p><b>${c.decision.go ? '✅ GO' : '❌ NO-GO'}</b> — decided by ${esc(c.decision.by || 'a leader')} on ${new Date(c.decision.at).toLocaleString()}. Participants see this on their registration page.</p>
               <div class="btn-row"><button class="btn small" data-a="undecide">Change the decision</button>${c.decision.go ? '<button class="btn primary small" data-goto="dash">🛰 Open the dashboard</button>' : ''}</div>`}
        </div></div>` : ''}

      ${G.length && S.reg !== 'off' ? `<div class="rego-cols"><div class="card" id="regoCosts">${costsCard()}</div><div class="card" id="regoMeals">${mealsCard()}</div></div>
        <div class="card" id="regoSafety">${safetyCard()}</div>
        <div class="card" id="regoSearch">${searchCard()}</div>` : ''}

      <div class="card"><h3>Roll-up</h3>
        <div class="big-stats">
          <div class="hero ${cap && P.length >= cap ? 'bad' : ''}"><b>${P.length}${cap ? ` / ${cap}` : ''}</b><span>${cap ? (P.length >= cap ? 'places taken — FULL' : `places taken · ${cap - P.length} left`) : 'registered'} · ${n(p => p.kind === 'youth')} youth, ${n(p => p.kind === 'adult')} adults</span></div>
          ${W.length || cap ? `<div class="${W.length ? 'bad' : ''}"><b>${W.length}</b><span>on the trip's waiting list</span></div>` : ''}
          ${n(p => p.waitGroup) ? `<div class="bad"><b>${n(p => p.waitGroup)}</b><span>waiting for a seat in their group</span></div>` : ''}
          <div><b>${G.length}</b><span>groups${n(p => p.group == null) ? ` · ${n(p => p.group == null)} without one` : ''}</span></div>
          <div class="${seats < P.length ? 'bad' : ''}"><b>${C.length}</b><span>cars · ${seats} seats for ${P.length}</span></div>
          <div class="${n(p => !p.complete) && S.reg !== 'interest' ? 'bad' : 'ok'}"><b>${n(p => p.complete)}/${P.length}</b><span>registered in full (contact + consent)</span></div>
          ${c.briefOn ? `<div><b>${n(p => p.briefAt)}/${P.length}</b><span>read the briefing</span></div>` : ''}
          <div><b>${t.info.gear.length ? `${ready}/${P.length}` : '—'}</b><span>gear all ticked</span></div>
          <div><b>${n(p => p.attend === 'present')}</b><span>checked in${n(p => p.attend === 'noshow') ? ` · ${n(p => p.attend === 'noshow')} not coming` : ''} · ${C.filter(x => x.arrivedAt).length}/${C.length} cars</span></div>
        </div>
        ${W.length ? `<p class="small"><b>⏳ Trip waiting list, in order:</b> ${W.map((p, i) => `${i + 1}. ${esc(p.name)}${p.group ? ` (${esc((G.find(g => g.id === p.group) || {}).name || '')})` : ''}`).join(' · ')}. They move up automatically when someone cancels or you raise the capacity; <b>＋ place</b> next to a name lets one in now.</p>` : ''}
        ${n(p => p.waitGroup) ? `<p class="small"><b>⏳ Waiting for a seat:</b> ${G.filter(g => P.some(p => p.group === g.id && p.waitGroup)).map(g => `${esc(g.name)} — ${P.filter(p => p.group === g.id && p.waitGroup).map(p => esc(p.name)).join(', ')}`).join(' · ')}. They get a seat when the group adds a car, or you can move them to a group with spare seats.</p>` : ''}
        ${((T.info.extra || {}).recipes || []).length || ((T.info.extra || {}).gear || []).length ? `<p class="small"><b>➕ Added by groups to the trip's lists:</b> ${((T.info.extra || {}).recipes || []).length} recipes${((T.info.extra || {}).recipes || []).length ? ` (${T.info.extra.recipes.slice(0, 6).map(x => esc(x.name)).join(', ')}${T.info.extra.recipes.length > 6 ? '…' : ''}) — now on the Meals tab's recipe list` : ''}; ${((T.info.extra || {}).gear || []).length} gear items${((T.info.extra || {}).gear || []).length ? ` (${T.info.extra.gear.slice(0, 6).map(x => esc(x.name)).join(', ')}${T.info.extra.gear.length > 6 ? '…' : ''})` : ''}. Every group can pick these.</p>` : ''}
        ${G.some(g => C.some(x => x.group === g.id)) ? `<p class="small"><b>Spare seats:</b> ${G.filter(g => C.some(x => x.group === g.id)).map(g => { const sg = C.filter(x => x.group === g.id).reduce((a, x) => a + x.seats, 0), m = P.filter(p => p.group === g.id).length; return `${esc(g.name)} ${Math.max(0, sg - m)}`; }).join(' · ')}</p>` : ''}
        ${diet.length ? `<p class="small"><b>🍽 Dietary:</b> ${diet.map(p => `${esc(p.name)} — ${esc(p.dietary)}`).join(' · ')}</p>` : ''}
        ${n(p => p.medFlag) ? `<p class="small"><b>⚕ Medical notes to check on the paper forms:</b> ${P.filter(p => p.medFlag).map(p => esc(p.name)).join(', ')}</p>` : ''}
        ${C.length ? `<p class="small"><b>🚗 Cars:</b> ${C.filter(x => x.start).length} of ${C.length} have a start location${C.some(x => !x.start) ? ` — missing: ${C.filter(x => !x.start).map(x => esc(((G.find(g => g.id === x.group) || {}).name || '') + ' ' + x.label)).join(', ')}` : ''}.
          ${C.filter(x => Store.state.travel.cars.some(tc => tc.regoCar === x.id)).length} of ${C.length} are in the travel plan.</p>` : ''}
        <div class="btn-row no-print"><button class="btn primary" data-a="cars" ${C.length ? '' : 'disabled'} title="Adds each registered car to the Travel tab, leaving from the place its group gave. Press again to pick up changes.">🚗 Send cars to the travel plan</button><button class="btn" data-print="list" ${G.length ? '' : 'disabled'}>🖨 Check-in lists (every group)</button><button class="btn" data-print="emerg" ${G.length ? '' : 'disabled'} title="One page per group: emergency numbers, overnight stops, cars and plates, everyone's emergency contact">⛑ Emergency sheets (every group)</button><button class="btn" data-print="covers" ${C.length ? '' : 'disabled'}>🖨 Car cover pages (QR)</button><button class="btn" data-print="cards" ${P.length ? '' : 'disabled'}>🖨 Participant cards (QR)</button><button class="btn" data-a="tags" ${P.length ? '' : 'disabled'} title="Fold-over tags for each person's bag, with a QR code and their name">🏷 Bag tags…</button></div>
        <p class="muted small">Group leaders can print their own group's list, cover pages and cards from their group page. Registrations are deleted ${T.keepDays} days after the trip ends.</p>
      </div>

      ${G.map(g => { const ps = A.filter(p => p.group === g.id), cs = C.filter(x => x.group === g.id), sg = cs.reduce((a, x) => a + x.seats, 0), lead = ps.find(p => p.id === g.leader);
        return `<details class="card rego-group" data-gid="${g.id}" ${open.has(g.id) ? 'open' : ''}><summary><b>${esc(g.name)}</b> — ${ps.length} people · ${cs.length} car${cs.length === 1 ? '' : 's'}${cs.length ? ` (${sg} seats)` : ''}
            · leader ${lead ? esc(lead.name) : '<span class="bad-text">none</span>'} ${cs.length ? (ps.some(p => p.waitGroup) ? `<span class="tag bad">full · ${ps.filter(p => p.waitGroup).length} waiting for a seat</span>` : `<span class="tag ok">${Math.max(0, sg - ps.filter(p => !p.wait).length)} spare</span>`) : '<span class="tag">no cars yet — no limit</span>'} ${cs.length && cs.every(x => x.arrivedAt) ? '<span class="tag ok">all cars in</span>' : ''}</summary>
          ${g.note ? `<p class="small">📝 ${esc(g.note)}</p>` : ''}
          ${pTable(ps, g)}
          ${cs.length ? `<table class="tbl compact"><thead><tr><th>Car</th><th>Driver</th><th>Leaves from</th><th>Vehicle</th><th class="num">Seats</th><th class="num">Passengers</th><th>Check-in</th><th>Gear confirmed</th></tr></thead><tbody>${cs.map(x => `<tr><td><b>${esc(x.label)}</b></td><td>${esc(x.driver)}</td><td>${x.start ? '📍 ' + esc(x.start.name) : '<span class="bad-text">not given</span>'}</td><td class="small">${(() => { const S = L.carSpec.state(T, x); return (L.carSpec.line(x) || '<span class="muted">no details yet</span>') + S.issues.map(i => `<br><b class="bad-text">⚠ ${esc(i)}</b>`).join('') + (S.missing.length ? `<br><span class="warn-text">Missing: ${S.missing.map(esc).join(', ')}</span>` : ''); })()}</td><td class="num">${x.seats}</td><td class="num">${ps.filter(p => p.car === x.id).length}</td>
            <td>${x.arrivedAt ? `✅ ${new Date(x.arrivedAt * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${x.arrivedBy ? ' · ' + esc(x.arrivedBy) : ''}` : ''}</td><td>${x.gearOk === true ? '✓ all here' : x.gearOk === false ? '<span class="bad-text">✗ something missing</span>' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No cars nominated yet.</p>'}
          <div class="btn-row no-print"><button class="btn small" data-copy="${esc(L.link.group(g.token))}" title="The group leader's link: they manage members, cars and seats, and print the group's pages">Copy group leader's link</button>
            <button class="btn small" data-gnew="${g.id}" title="Stops the old link working">New link</button><button class="btn small" data-gren="${g.id}">Rename</button><button class="btn small danger" data-gdel="${g.id}">Remove group</button></div></details>`; }).join('')}
      ${A.some(p => p.group == null) ? `<div class="card"><h3>Not in a group yet</h3>${pTable(A.filter(p => p.group == null), null)}</div>` : ''}

      <div class="card no-print"><h3>Add someone yourself</h3>
        <form id="regoAdd" class="rego-add"><input name="name" placeholder="Full name" required maxlength="80"><select name="kind"><option value="youth">Youth</option><option value="adult">Adult</option></select>
          <input name="mobile" placeholder="Mobile" maxlength="30"><input name="emName" placeholder="Emergency contact name" required maxlength="80"><input name="emPhone" placeholder="Emergency phone" required maxlength="30">
          <input name="dietary" placeholder="Dietary" maxlength="200"><select name="group"><option value="">No group</option>${G.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button class="btn primary">Add</button></form>
        <p class="muted small">Consent isn't recorded for people you add here: send them their own link (🔗) so they or a parent can confirm it. <button class="btn small" data-a="gnew">➕ New group</button></p></div>`;
  }

  /* ---------- group travel costs, and group meal plans ---------- */
  function costsCard() {
    const c = cfg(), X = groupCosts(), m = fmtMoney, all = c.costShare === 'all';
    return `<h3>💰 Group travel costs</h3>
      <table class="tbl compact"><thead><tr><th>Group</th><th class="num">People</th><th class="num">Fuel</th><th class="num">Accommodation</th><th class="num">Public transport</th><th class="num">Total</th><th class="num">Each pays</th>${all ? '<th class="num">Group balance</th>' : ''}</tr></thead><tbody>
        ${X.rows.map(r => { const each = all ? X.perAll : r.n ? r.total / r.n : null, bal = all && X.perAll != null ? X.perAll * r.n - r.total : 0;
          return `<tr><td><b>${esc(r.g.name)}</b>${r.stops.length ? `<br><small class="muted">${r.stops.map(x => `${x.booked ? '🏨' : '🛏'} ${esc(x.name)}${x.chosen ? ` (their choice — suggested ${esc(x.sug)})` : x.booked ? '' : ' (suggested)'}`).join(', ')}</small>` : ''}${(r.g.plan.transport || []).length ? `<br><small class="muted">${r.g.plan.transport.map(x => `${(L.MODES[x.mode] || L.MODES.other).split(' ')[0]} ${esc(x.from)} → ${esc(x.to)}`).join('; ')}</small>` : ''}</td>
            <td class="num">${r.n}</td><td class="num">${r.fuel == null ? `<small class="muted">${r.cars ? (r.inPlan ? 'working…' : 'not in travel plan') : 'no cars'}</small>` : m(r.fuel)}</td><td class="num">${r.stay ? m(r.stay) : '—'}</td><td class="num">${r.transport ? m(r.transport) : '—'}</td>
            <td class="num"><b>${m(r.total)}</b></td><td class="num">${each == null ? '—' : m(each)}</td>${all ? `<td class="num ${bal > 0.5 ? 'bad-text' : ''}">${Math.abs(bal) < 0.5 ? 'even' : bal > 0 ? `pays in ${m(bal)}` : `gets back ${m(-bal)}`}</td>` : ''}</tr>`; }).join('')}
      </tbody><tfoot><tr><th>All groups</th><th class="num">${X.people}</th><th colspan="3"></th><th class="num">${m(X.total)}</th><th class="num">${X.perAll == null ? '' : m(X.perAll) + ' avg'}</th>${all ? '<th></th>' : ''}</tr></tfoot></table>
      <label class="field"><span>Who pays for travel</span><select data-c="costShare"><option value="group" ${all ? '' : 'selected'}>Each group pays its own travel</option><option value="all" ${all ? 'selected' : ''}>Spread all travel costs evenly across everyone</option></select></label>
      <p class="muted small">Fuel comes from the Travel tab for cars sent there; accommodation and public transport are what each group has entered. ${all ? 'Groups that travelled cheaply pay in; groups with long trips get money back.' : 'Groups a long way from the start pay more.'} Group leaders see their figure on their group page.</p>`;
  }
  function mealsCard() {
    const t = { ...D.trip, info: info() }, own = cfg().meals === 'own';
    const rows = D.groups.map(g => ({ g, cnt: L.mealCount(t, g.plan), issues: L.mealIssues(t, g.plan, D.people.filter(p => p.group === g.id)) }));
    const issues = rows.flatMap(r => r.issues.map(i => ({ ...i, group: r.g.name })));
    return `<h3>🍳 Group meal plans ${issues.length ? `<span class="tag bad">${issues.length} to check</span>` : rows.some(r => r.cnt.n) ? '<span class="tag ok">no clashes found</span>' : ''}</h3>
      ${own ? '' : '<p class="small muted">Meals are set to "provided", so groups aren\'t asked for a meal plan. Anything they entered earlier is shown below.</p>'}
      ${issues.length ? `<div class="rego-issues"><b>⚠ Possible allergen or dietary clashes</b><ul>${issues.map(i => `<li><b>${esc(i.group)}</b> · ${esc(i.day)} ${i.slot.toLowerCase()} “${esc(i.text)}” may contain <b>${i.what.join(', ')}</b> — ${esc(i.who)} (${esc(i.diet)})</li>`).join('')}</ul></div>` : ''}
      ${rows.map(r => `<details class="rego-gm"><summary><b>${esc(r.g.name)}</b> — ${r.cnt.n} of ${r.cnt.of} main meals planned${r.issues.length ? ` · <span class="bad-text">${r.issues.length} to check</span>` : ''}${L.offList(t, r.g.plan).length ? ` · <span class="bad-text">${L.offList(t, r.g.plan).length} not on the master recipe list</span>` : ''}</summary>
        <table class="tbl compact"><thead><tr><th>Day</th>${L.SLOTS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${L.days(t).map(dy => `<tr><td>${dy.label}</td>${L.SLOTS.map(([sl]) => `<td class="small">${esc((((r.g.plan || {}).meals || {})[dy.key] || {})[sl] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`).join('')}
      <p class="muted small">Checked by matching words in each meal against the dietary needs people registered. It is a guide only — it can't read labels.</p>`;
  }
  /* Each group's risk sign-off, its own risks, pack weights against the 20% aim, and how loaded its cars are */
  function safetyCard() {
    const t = { ...D.trip, info: info() }, risks = t.info.risks, facts = typeof Travel !== 'undefined' && Travel.carFacts ? Travel.carFacts() : [];
    const rows = D.groups.map(g => { const plan = g.plan || {}, ps = D.people.filter(p => p.group === g.id && !p.wait), st = ps.map(p => ({ p, s: L.packState(t, plan, p) }));
      const ack = ((plan.risks || {}).ack || []).filter(k => risks.some(r => r.k === k)).length, cars = D.cars.filter(c => c.group === g.id).map(c => ({ c, f: facts.find(x => x.regoCar === c.id) }));
      return { g, ps, st, ack, own: (plan.risks || {}).own || [], notes: Object.entries((plan.risks || {}).notes || {}), over: st.filter(x => x.s.pct != null && x.s.pct > 20), known: st.filter(x => x.s.pct != null).length, cars }; });
    return `<h3>🦺 Group safety: risks, pack weights and car loads</h3>
      <table class="tbl compact"><thead><tr><th>Group</th><th>Risks read</th><th>Their own risks and notes</th><th>Pack weights (aim ≤ 20% of body weight)</th><th>Car loads</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td><b>${esc(r.g.name)}</b></td>
          <td class="${risks.length && r.ack < risks.length ? 'bad-text' : ''}">${risks.length ? `${r.ack} of ${risks.length}` : '—'}</td>
          <td class="small">${r.own.map(o => `<b>${esc(o.hazard)}</b>${o.l ? ` <span class="tag ${L.RiskUI.rate(o.rl, o.rc)[0] === 'Low' ? 'ok' : L.RiskUI.rate(o.rl, o.rc)[0] === 'Medium' ? '' : 'bad'}">${L.RiskUI.rate(o.l, o.c)[0]} → ${L.RiskUI.rate(o.rl, o.rc)[0]}</span>` : ''} — ${esc(o.controls)}`).concat(r.notes.map(([k, v]) => `<i>${esc((risks.find(x => x.k === k) || {}).hazard || 'note')}:</i> ${esc(v)}`)).join('<br>') || '<span class="muted">none</span>'}</td>
          <td class="small">${r.known} of ${r.ps.length} worked out${r.over.length ? `<br><span class="bad-text">Over 20%: ${r.over.map(x => `${esc(x.p.name)} ${x.s.pct.toFixed(0)}% (${L.kg(x.s.pack)})`).join(', ')}</span>` : r.known ? '<br><span class="ok-text">all within 20%</span>' : ''}</td>
          <td class="small">${r.cars.map(({ c, f }) => `${esc(c.label)}: ${f && f.payload ? `<span class="${f.over ? 'bad-text' : ''}">${f.load} of ${f.payload} kg${f.over ? ` — ${f.over} kg over` : ''}</span>${f.cans ? ` · 🛢️ ${f.cans} × 25 L` : ''}` : '<span class="muted">not in travel plan</span>'}`).join('<br>') || '<span class="muted">no cars</span>'}</td></tr>`).join('')}
      </tbody></table>
      <p class="muted small">Group leaders tick the trip's risks and controls on their group page, and can add risks particular to their group. Pack weights use the gear weights you set above, or the weight the leader measured. Car loads, payloads and trailers are set on the <a href="#travel" data-goto="travel">Travel</a> tab.</p>`;
  }
  /* ---------- every group's plan, searchable: find something, flag it for the group leader, or remove it ---------- */
  let searchQ = '';
  function planIndex() {
    const t = { ...D.trip, info: info() }, out = [];
    D.groups.forEach(g => {
      const plan = g.plan || {}, add = (kind, where, text, path, extra = '') => { if (String(text || '').trim()) out.push({ g, kind, where, text: String(text), path, hay: `${g.name} ${kind} ${where} ${text} ${extra}`.toLowerCase() }); };
      L.days(t).forEach(d => L.SLOTS.forEach(([sl, label]) => L.mealItems(plan, d.key, sl).forEach((x, i) => { const rec = L.onList(t, x.n);
        add('Meal', `${d.label} ${label.toLowerCase()}`, x.n + (x.s ? ` ×${x.s}` : ''), plan.menu ? ['menu', d.key, sl, i] : ['meals', d.key, sl], rec ? (rec.ing || []).join(' ') : 'off list not on the master recipe list'); })));
      (plan.gear || []).forEach((x, i) => add('Gear', x.c === 'group' ? 'group (shared)' : (D.people.find(p => String(p.id) === String(x.c)) || {}).name || 'gear', `${x.n}${x.q > 1 ? ' ×' + x.q : ''}${x.w ? ` · ${x.w} g` : ''}${x.o ? ' — ' + x.o : ''}`, ['gear', i], x.k || ''));
      ((plan.risks || {}).own || []).forEach((r, i) => add('Their own risk', 'risk', `${r.hazard} — ${r.controls}`, ['risks', 'own', i]));
      Object.entries((plan.risks || {}).notes || {}).forEach(([k, v]) => add('Risk note', (t.info.risks.find(r => r.k === k) || {}).hazard || 'risk', v, ['risks', 'notes', k]));
      (plan.stay || []).forEach((x, i) => add('Stay', x.night ? L.fmtDay(x.night) : 'overnight', `${x.place}${x.note ? ' — ' + x.note : ''} (${L.money(x.cost)})`, ['stay', i]));
      (plan.transport || []).forEach((x, i) => add('Public transport', (L.MODES[x.mode] || L.MODES.other), `${x.from} → ${x.to}${x.note ? ' — ' + x.note : ''} (${L.money(x.cost)})`, ['transport', i]));
      add('Group note', 'note', g.note, null);
      D.people.filter(p => p.group === g.id).forEach(p => { add('Person', p.name, [p.dietary && 'dietary: ' + p.dietary, p.medFlag && 'medical notes on paper form', p.gearNote && 'gear note: ' + p.gearNote].filter(Boolean).join(' · '), null, p.name);
        const s = L.packState(t, plan, p); if (s.pct != null && s.pct > 20) add('Pack weight', p.name, `${s.pct.toFixed(0)}% of body weight (${L.kg(s.pack)})`, null, 'over 20 overweight'); });
      D.cars.filter(c => c.group === g.id).forEach(c => add('Car', c.label, `${c.driver || 'no driver'} · ${c.seats} seats · leaves ${c.start ? c.start.name : 'not given'}`, null));
    });
    return out;
  }
  function searchCard() {
    const flags = D.groups.flatMap(g => ((g.plan || {}).flags || []).map((f, i) => ({ g, f, i })));
    const words = searchQ.toLowerCase().split(/\s+/).filter(Boolean), all = planIndex(), hits = words.length ? all.filter(x => words.every(w => x.hay.includes(w))) : [];
    return `<h3>🔎 Search every group's plan <small class="muted">— ${all.length} entries across ${D.groups.length} groups</small></h3>
      <div class="row wrap"><input id="regoQ" type="search" placeholder="e.g. peanut, off list, Coober Pedy, trailer, vegetarian, a person's name…" value="${esc(searchQ)}" style="flex:1;min-width:260px"><button class="btn" data-a="search">Search</button></div>
      ${words.length ? (hits.length ? `<table class="tbl compact"><thead><tr><th>Group</th><th>What</th><th>Where</th><th>Detail</th><th class="no-print"></th></tr></thead><tbody>
        ${hits.slice(0, 80).map(x => `<tr><td><b>${esc(x.g.name)}</b></td><td>${x.kind}</td><td class="small">${esc(x.where)}</td><td>${esc(x.text)}</td>
          <td class="no-print"><button class="btn small" data-flag="${all.indexOf(x)}" title="Tell the group leader this needs attention or an extra risk control. It shows at the top of their group page.">🚩 Flag</button>${x.path ? `<button class="btn small danger" data-cut="${all.indexOf(x)}" title="Take this out of the group's plan and tell the group leader">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table>${hits.length > 80 ? `<p class="muted small">Showing the first 80 of ${hits.length}.</p>` : ''}`
        : '<p class="muted">Nothing in any group\'s plan matches that.</p>') : '<p class="muted small">Searches meals (including the ingredients of master-list recipes), each group\'s own risks and notes, stays, public transport, cars, dietary needs and overweight packs. Use it to find something that has to come out, or that needs an extra risk control.</p>'}
      ${flags.length ? `<h4>Flags waiting on group leaders</h4><ul class="rego-fb">${flags.map(({ g, f, i }) => `<li><b>${esc(g.name)}:</b> ${esc(f.what)}${f.note ? ` — ${esc(f.note)}` : ''} <small class="muted">${esc(f.by || '')}</small> <button class="btn small" data-unflag="${g.id}:${i}">Clear</button></li>`).join('')}</ul>` : ''}`;
  }
  function planChange(x, remove) {
    const note = prompt(remove ? `Remove “${x.text}” from ${x.g.name}'s plan?\n\nAdd a note for the group leader (why it was removed, what to do instead):` : `Flag “${x.text}” for ${x.g.name}'s leader.\n\nWhat do they need to do? (e.g. an extra risk control)`, '');
    if (note === null) return;
    const plan = JSON.parse(JSON.stringify(x.g.plan || {})), who = (Store.user && (Store.user.name || Store.user.username)) || 'Organisers';
    if (remove) { const [a, b, c2] = x.path;
      if (a === 'menu') { const d3 = x.path[3]; plan.menu[b][c2].splice(d3, 1); (plan.meals = plan.meals || {})[b] = plan.meals[b] || {}; if (plan.menu[b][c2].length) plan.meals[b][c2] = plan.menu[b][c2].map(q => q.n).join(', '); else delete plan.meals[b][c2]; }
      else if (a === 'meals') { delete plan.meals[b][c2]; }
      else if (a === 'risks' && b === 'own') plan.risks.own.splice(c2, 1);
      else if (a === 'risks' && b === 'notes') delete plan.risks.notes[c2];
      else plan[a].splice(b, 1); }
    plan.flags = [...(plan.flags || []), { what: `${remove ? 'Removed' : 'Check'}: ${x.kind.toLowerCase()} — ${x.where}: ${x.text}`.slice(0, 240), note: note.trim().slice(0, 300), by: who, at: Date.now() }].slice(-30);
    act(() => call('admin_plan', { id: id(), gid: x.g.id, plan }), remove ? 'Removed, and the group leader has been told on their page' : 'Flagged: it shows at the top of their group page');
  }

  /* Meals for everyone: the head count the meal planner should cook for */
  function feedCard() {
    const n = D.people.filter(p => !p.wait).length, plan = Store.state.mealPlan || {}, entries = Object.values(plan).flatMap(d => Object.values(d).flat());
    if (!n || !entries.length) return '';
    const off = entries.filter(e => num(e.servings) !== n).length;
    return `<h3>🍽 Cooking for everyone</h3><p>${n} people have a place on this activity. ${off ? `<b>${off} of ${entries.length} planned meals are set for a different number.</b>` : `All ${entries.length} planned meals are set for ${n}.`}
      ${off ? `<button class="btn primary small" data-feed="${n}">Set every meal to ${n} servings</button>` : ''}</p>
      <p class="muted small">New meals you add are set to ${n} servings automatically; the shopping list and quantities follow. In <b>📚 Recipes</b>, the type <b>standing camp</b> lists meals for a base camp with a kitchen, where carry weight doesn't matter. ${D.people.filter(p => !p.wait && p.dietary).length ? `Dietary needs: ${D.people.filter(p => !p.wait && p.dietary).map(p => `${esc(p.name)} — ${esc(p.dietary)}`).join(' · ')}.` : ''}</p>`;
  }

  /* Recipes that groups added from the library join this trip's master recipe list (Meals tab), in full where the
     library has them, so the organisers can use, edit or remove them like any other recipe. */
  let libCache = null, adopting = false;
  async function adoptExtras() {
    const ex = ((D && D.trip.info && D.trip.info.extra) || {}).recipes || [], have = new Set((Store.state.recipes || []).map(r => String(r.name).trim().toLowerCase()));
    const todo = ex.filter(r => !have.has(String(r.name).trim().toLowerCase()));
    if (!todo.length || adopting || !Store.canEdit) return;
    adopting = true;
    try {
      if (todo.some(r => r.lib) && !libCache) libCache = (await (await fetch('data/recipe-library.json')).json()).recipes;
      todo.forEach(r => { const full = (libCache || []).find(x => x.name.toLowerCase() === r.name.toLowerCase());
        Store.state.recipes.push(full ? { ...JSON.parse(JSON.stringify({ name: full.name, slot: full.slot, waterMl: full.waterMl || 0, ingredients: full.ingredients, equipment: full.equipment || [], notes: full.notes || '', source: full.source })), id: uid(), addedBy: r.by || '' }
          : { id: uid(), name: r.name, slot: r.slot || 'dinner', waterMl: 0, ingredients: [], equipment: [], notes: `Added by ${r.by || 'a group'} — fill in the ingredients.`, addedBy: r.by || '' }); });
      Store.save();
      toast(`${todo.length} recipe${todo.length > 1 ? 's' : ''} added by groups ${todo.length > 1 ? 'are' : 'is'} now on the master recipe list`, 5000);
    } catch (e) { /* try again next time */ }
    adopting = false;
  }

  /* ---------- organiser view / group view ----------
     A selector under the tabs. In a group's view the Meals and Gear tabs show that group's own meal plan and gear list
     (the same screens its leader uses), and changes are saved to the group's plan. Other tabs stay on the master plan. */
  let view = '';
  /* the selector sits under the tabs on every tab, so it listens from the start (not only once the People tab has been opened) */
  document.addEventListener('change', e => { if (e.target.id === 'viewSel') { view = e.target.value; App.show(App.current); } });
  document.addEventListener('click', e => { if (e.target.id === 'viewBack') { view = ''; App.show(App.current); } });
  function viewBar() {
    const el = $('#viewBar');
    if (!el) return;
    if (!D || !D.groups.length || D.trip.reg === 'off') { el.hidden = true; view = ''; return; }
    if (view && !D.groups.some(g => String(g.id) === view)) view = '';
    const g = D.groups.find(x => String(x.id) === view);
    el.hidden = false; el.classList.toggle('on', !!g);
    el.innerHTML = `👁 <label>View <select id="viewSel"><option value="">Organisers — the master plan</option><optgroup label="A group's own plan">${D.groups.map(x => `<option value="${x.id}" ${String(x.id) === view ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup></select></label>
      ${g ? `<b>${esc(g.name)}</b>: the <a href="#meals" data-goto="meals">Meals</a>, <a href="#gear" data-goto="gear">Gear</a> and <a href="#weight" data-goto="weight">Pack Weight</a> tabs show this group's own plan, and your changes there go into it. Other tabs show the master plan. <button class="btn small" id="viewBack">Back to the organisers' view</button>` : '<span class="muted">Pick a group to see and edit its own meal plan, gear list and pack weights on the Meals, Gear and Pack Weight tabs.</span>'}`;
  }
  function groupView(tab) {
    viewBar();
    const g = D && D.groups.find(x => String(x.id) === view);
    if (!g || (tab !== 'meals' && tab !== 'gear' && tab !== 'weight')) return false;
    if (!g.plan || Array.isArray(g.plan)) g.plan = {};
    if (tab === 'weight') {          // the group's pack weights: the same cards its leader sees
      const host = $('#tab-weight'), t = { ...D.trip, info: info() }, people = D.people.filter(p => p.group === g.id && !p.wait);
      if (!g.plan._n) g.plan._n = people.length;
      host.innerHTML = `<div class="page-head"><h2>Pack weight — ${esc(g.name)}</h2><span class="tag ok">group view</span></div>
        <p class="muted">Each person's pack for ${esc(g.name)}, worked out from the group's own <a href="#gear" data-goto="gear">gear list</a> (their items plus an even share of the shared gear) or, where that has nothing for them, from the organisers' list they ticked — plus about ${L.kg(L.packState(t, g.plan, { gear: [] }).extra)} of food and water. Aim for 20% of body weight or less. Body weights and weighed packs typed here are saved to the group's plan.</p><div class="gp gp-host"></div>`;
      const body = host.querySelector('.gp-host'), draw = () => { body.innerHTML = L.packCards(t, g.plan, people); };
      draw();
      body.addEventListener('change', e => {
        if (!e.target.dataset.wb && !e.target.dataset.wp) return;
        L.packRead(body, g.plan); draw();
        call('admin_plan', { id: id(), gid: g.id, plan: g.plan }).then(() => toast('Saved to ' + g.name + "'s plan")).catch(err => toast(err.message, 5000));
      });
      return true;
    }
    const host = $('#tab-' + tab), t = { ...D.trip, info: info() }, people = D.people.filter(p => p.group === g.id), UI = L.PlanUI;
    host.innerHTML = `<div class="page-head"><h2>${tab === 'meals' ? 'Meal planner' : 'Gear list'} — ${esc(g.name)}</h2><span class="tag ok">group view</span></div>
      <p class="muted">${tab === 'meals' ? `This is ${esc(g.name)}'s own meal plan, chosen from this trip's recipes. ` : `This is ${esc(g.name)}'s own gear list. `}${people.length} people. Changes save to the group's plan and their leader sees them.</p><div class="gp gp-host"></div>`;
    const body = host.querySelector('.gp-host'), ctx = { t, plan: g.plan, people, who: '',
      share: what => call('admin_extra', { id: id(), ...what }).then(r => { D.trip.info.extra = r.extra; adoptExtras(); }).catch(() => {}),
      save: plan => call('admin_plan', { id: id(), gid: g.id, plan }).then(() => toast('Saved to ' + g.name + "'s plan")).catch(e => toast(e.message, 5000)),
      draw: () => { body.innerHTML = tab === 'meals' ? UI.menu(t, g.plan, people) : UI.gear(t, g.plan, people, ctx.who); } };
    ctx.draw(); UI.bind(body, ctx);
    return true;
  }

  /* The same cards on the Meals and Budget tabs, so the master plan shows them too */
  function decorate(tab) {
    if (groupView(tab)) return;
    const host = tab === 'meals' ? $('#tab-meals') : tab === 'budget' ? $('#tab-budget') : null;
    if (!host || !D || !D.groups.length || D.trip.reg === 'off') return;
    let el = host.querySelector('.rego-extra');
    if (!el) { el = document.createElement('div'); el.className = 'card rego-extra'; host.appendChild(el); }
    if (!el.dataset.bound) { el.dataset.bound = 1; el.addEventListener('click', e => { const b = e.target.closest('[data-feed]'); if (!b) return;
      Object.values(Store.state.mealPlan || {}).forEach(d => Object.values(d).forEach(list => list.forEach(x => { x.servings = +b.dataset.feed; }))); Store.save(); toast(`Every meal is now for ${b.dataset.feed} people`); App.show('meals'); }); }
    el.innerHTML = (tab === 'meals' ? feedCard() + mealsCard() : costsCard().replace(/<label class="field">[\s\S]*?<\/label>/, '')) + '<p class="small"><a href="#people" data-goto="people">Open the People tab</a> to change these.</p>';
  }

  /* ---------- bag tags: size and options, then print ---------- */
  function tagDialog() {
    const dlg = $('#dialog'), c = cfg(), T = L.tagSize(c.tag || {});
    dlg.innerHTML = `<form class="dlg-form" id="tagForm"><h3>🏷 Bag tags</h3>
      <p class="small muted">A fold-over tag for each person's bag: a QR code on one side and the name, group and trip on the other. A leader with the check-in app scans it to see whose bag it is and who to call; anyone else just sees that it belongs to a Scout activity.</p>
      <div class="rg-tagform"><label>Width (mm)<input type="number" min="20" max="120" step="1" data-tag="w" value="${T.w}"></label><label>Height (mm)<input type="number" min="12" max="120" step="1" data-tag="h" value="${T.h}"></label>
          <label>Tags per person<input type="number" min="1" max="6" step="1" data-tag="each" value="${T.each}"></label><label class="wide">“If found” line <small>(optional — e.g. a leader's mobile or the hall)</small><input data-tag="contact" maxlength="60" value="${esc(T.contact)}" placeholder="If found, please hand to a Scout leader"></label></div>
      <label class="field"><span>Print for</span><select id="tagWho"><option value="">Everyone with a place (${D.people.filter(p => !p.wait).length})</option>${D.groups.map(g => `<option value="${g.id}">${esc(g.name)} (${D.people.filter(p => p.group === g.id && !p.wait).length})</option>`).join('')}</select></label>
      <p class="small muted">The printed piece is twice the width (${T.w * 2} × ${T.h} mm at these settings) and folds down the middle. Print at 100%, not “fit to page”.</p>
      <div class="dlg-actions"><button type="button" class="btn" id="tagCancel">Cancel</button><button class="btn primary">🖨 Print tags</button></div></form>`;
    $('#tagCancel').onclick = () => dlg.close();
    $('#tagForm').onsubmit = e => {
      e.preventDefault();
      const o = {}; dlg.querySelectorAll('[data-tag]').forEach(i => { o[i.dataset.tag] = i.value; });
      c.tag = L.tagSize(o); Store.save();
      const who = $('#tagWho').value, people = D.people.filter(p => !who || String(p.group) === who).sort((x, y) => (x.group || 0) - (y.group || 0) || x.name.localeCompare(y.name));
      dlg.close();
      L.print(L.bagTags({ ...D.trip, info: info() }, D.groups, people, c.tag));
    };
    dlg.showModal();
  }

  /* ---------- capacity: its own dialog ---------- */
  function capacityDialog() {
    const dlg = $('#dialog'), c = cfg(), cur = num(c.max) > 0 ? Math.round(num(c.max)) : 0;
    const In = D.people.filter(p => !p.wait), W = D.people.filter(p => p.wait), gname = p => (D.groups.find(g => g.id === p.group) || {}).name || 'no group';
    const isLeader = p => D.groups.some(g => g.leader === p.id);
    const draw2 = val => {
      const max = val === '' ? 0 : Math.max(0, Math.round(+val || 0));
      const room = max ? max - In.length : W.length, over = max ? In.length - max : 0;
      const body = !max ? `<p>No limit: everyone on the waiting list (${W.length}) gets a place.</p>`
        : room > 0 && W.length ? `<p><b>${room} place${room > 1 ? 's' : ''} to give.</b> Tick who comes off the waiting list (the first in line are ticked). ${W.length > room ? 'The rest stay on the list.' : ''}</p>
            <div class="cap-list">${W.map((p, i) => `<label class="check"><input type="checkbox" data-pro="${p.id}" ${i < room ? 'checked' : ''}> ${i + 1}. <b>${esc(p.name)}</b> <small class="muted">${esc(gname(p))} · ${p.kind}</small></label>`).join('')}</div>`
        : over > 0 ? `<p class="bad-text"><b>${over} too many.</b> Tick ${over} ${over > 1 ? 'people' : 'person'} to move to the waiting list (the last to register are ticked). They keep their registration and move back up when a place opens.</p>
            <div class="cap-list">${In.slice().reverse().map((p, i) => `<label class="check"><input type="checkbox" data-dem="${p.id}" ${In.slice().reverse().filter(x => !isLeader(x)).indexOf(p) > -1 && In.slice().reverse().filter(x => !isLeader(x)).indexOf(p) < over ? 'checked' : ''}> <b>${esc(p.name)}</b> <small class="muted">${esc(gname(p))} · ${p.kind}${isLeader(p) ? ' · group leader' : ''}</small></label>`).join('')}</div>`
        : `<p>${max >= In.length ? `${In.length} of ${max} places are taken${W.length ? '' : '; nobody is waiting'}.` : ''}</p>`;
      $('#capBody').innerHTML = body;
      const need = () => { const n = dlg.querySelectorAll('[data-dem]:checked').length, p = dlg.querySelectorAll('[data-pro]:checked').length;
        const ok = over > 0 ? n === over : room > 0 && W.length ? p <= room : true;
        $('#capMsg').textContent = over > 0 ? `${n} of ${over} chosen` : room > 0 && W.length ? `${p} of ${Math.min(room, W.length)} chosen${p > room ? ' — too many' : ''}` : '';
        $('#capSave').disabled = !ok; };
      $('#capBody').onchange = need; need();
    };
    dlg.innerHTML = `<form class="dlg-form cap-dlg" id="capForm"><h3>Trip capacity</h3>
      <p class="small muted">Now: ${cur ? `${cur} places` : 'no limit'} · ${In.length} with a place · ${W.length} on the waiting list.</p>
      <label class="field"><span>Most people who can come <small class="muted">(empty = no limit)</small></span><input id="capMax" type="number" min="0" max="400" value="${cur || ''}" placeholder="no limit"></label>
      <div id="capBody"></div>
      <div class="dlg-actions"><span id="capMsg" class="muted small"></span><button type="button" class="btn" id="capCancel">Cancel</button><button class="btn primary" id="capSave">Save capacity</button></div></form>`;
    $('#capMax').oninput = e => draw2(e.target.value);
    $('#capCancel').onclick = () => dlg.close();
    $('#capForm').onsubmit = e => {
      e.preventDefault();
      const promote = [...dlg.querySelectorAll('[data-pro]:checked')].map(x => +x.dataset.pro), demote = [...dlg.querySelectorAll('[data-dem]:checked')].map(x => +x.dataset.dem);
      c.max = $('#capMax').value === '' ? '' : String(Math.max(0, Math.round(+$('#capMax').value || 0)) || '');
      Store.save(); dlg.close();
      act(() => call('capacity', { id: id(), info: info(), promote, demote }), `Capacity saved${promote.length ? ` — ${promote.length} given a place` : ''}${demote.length ? ` — ${demote.length} moved to the waiting list` : ''}`);
    };
    draw2(String(cur || ''));
    dlg.showModal();
  }

  /* ---------- actions ---------- */
  async function act(fn, okMsg) {
    if (busy) return;
    busy = true;
    try { const r = await fn(); if (r && r.trip) D = r; draw(); if (okMsg) toastMsg(okMsg); }
    catch (e) { toastMsg(e.message); alert(e.message); }
    busy = false;
  }
  const person = pid => D.people.find(p => p.id === pid);
  function addCars() {
    const tr = Store.state.travel, have = new Set(tr.cars.map(c => c.regoCar)), people = Store.state.people;
    let added = 0, moved = 0, detailed = 0;
    /* the group's vehicle details (their Cars screen) go onto the travel plan's car: fuel, economy, tank, payload, towing
       and the trailer's loaded weight. Returns true when something changed. */
    const spec = (t, c) => {
      const s = c.spec; if (!s) return false;
      const was = JSON.stringify([t.fuel, t.economy, t.tank, t.payload, t.towMax, t.gcm, t.trailerKg]);
      if (s.fuel && FUEL_TYPES[s.fuel]) { if (t.fuel !== s.fuel && !(s.economy > 0)) t.economy = FUEL_TYPES[s.fuel].economy; t.fuel = s.fuel; }
      ['economy', 'tank', 'payload', 'towMax', 'gcm'].forEach(k => { if (s[k] > 0) t[k] = s[k]; });
      if (s.trailer) { t.trailerKg = s.tLoad || s.tAtm || 0; t.specTrailer = true; }
      else if (t.specTrailer) { t.trailerKg = 0; t.specTrailer = false; }
      return was !== JSON.stringify([t.fuel, t.economy, t.tank, t.payload, t.towMax, t.gcm, t.trailerKg]);
    };
    const home = c => (c.start ? { name: c.start.name, lat: c.start.lat, lon: c.start.lon } : null);
    D.cars.forEach(c => {
      const g = D.groups.find(x => x.id === c.group), name = `${g ? g.name + ' – ' : ''}${c.label}${c.driver ? ` (${c.driver})` : ''}`;
      if (have.has(c.id)) {          // already in the plan: bring its start location, seats and name up to date
        const t = tr.cars.find(x => x.regoCar === c.id), h = home(c);
        if (h && (!t.home || t.home.lat !== h.lat || t.home.lon !== h.lon)) { t.home = h; moved++; }
        t.seats = c.seats; t.name = name;
        if (spec(t, c)) detailed++;
        return;
      }
      const t = { id: uid(), regoCar: c.id, name, driver: people[0] ? people[0].id : '', seats: c.seats,
        fuel: 'ulp91', economy: FUEL_TYPES.ulp91.economy, extraPct: 10, tank: 55, mass: 1700, home: home(c), role: tr.cars.length % 2 ? 'finish' : 'start' };
      spec(t, c);
      tr.cars.push(t);
      added++;
    });
    const gone = tr.cars.filter(x => x.regoCar && !D.cars.some(c => c.id === x.regoCar));       // a group removed a car since
    Store.save();
    const missing = D.cars.filter(c => !c.start).length;
    toastMsg(`${added ? `${added} car${added > 1 ? 's' : ''} added to the travel plan. ` : ''}${moved ? `${moved} start location${moved > 1 ? 's' : ''} updated. ` : ''}${detailed ? `Vehicle details updated on ${detailed} car${detailed > 1 ? 's' : ''}. ` : ''}${!added && !moved && !detailed ? 'The travel plan already matches the registered cars. ' : ''}${missing ? `${missing} car${missing > 1 ? 's have' : ' has'} no start location yet, so ${missing > 1 ? 'they leave' : 'it leaves'} from the trip's home. ` : ''}${gone.length ? `${gone.length} car${gone.length > 1 ? 's' : ''} in the travel plan ${gone.length > 1 ? 'are' : 'is'} no longer registered — remove ${gone.length > 1 ? 'them' : 'it'} on the Travel tab.` : ''}`);
    if (added || moved || detailed) App.show('travel');
  }

  function bind() {
    bound = true;
    const r = root();
    r.addEventListener('toggle', e => { const d = e.target.closest && e.target.closest('.rego-group'); if (d) { if (d.open) open.add(+d.dataset.gid); else open.delete(+d.dataset.gid); } }, true);
    r.addEventListener('change', e => {
      const el = e.target, c = cfg();
      if (el.dataset.c) { c[el.dataset.c] = el.value; if (el.dataset.c === 'closes' && D && ['interest', 'open'].includes(D.trip.reg)) act(() => call('stage', { id: id(), reg: D.trip.reg, closes: c.closes })); }
      else if ('dn' in el.dataset) c.decision.note = el.value;
      else if (el.dataset.gn) c.gear[+el.dataset.gn].name = el.value;
      else if (el.dataset.gr) c.gear[+el.dataset.gr].req = el.checked;
      else if (el.dataset.gw) c.gear[+el.dataset.gw].w = num(el.value);
      else if (el.dataset.move) return act(() => call('admin_person', { id: id(), pid: +el.dataset.move, group: +el.value || 0 }), 'Moved');
      else return;
      Store.save(); push();
      if (el.dataset.c === 'meals' || el.dataset.c === 'brief' || el.dataset.c === 'costShare') draw();
    });
    r.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'regoQ') { e.preventDefault(); searchQ = e.target.value.trim(); $('#regoSearch').innerHTML = searchCard(); const q = $('#regoQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } });
    r.addEventListener('submit', e => {
      if (e.target.id !== 'regoAdd') return;
      e.preventDefault();
      const f = e.target, v = k => f.elements[k].value.trim();
      act(() => call('admin_person', { id: id(), group: +v('group') || 0, person: { name: v('name'), kind: v('kind'), mobile: v('mobile'), emName: v('emName'), emPhone: v('emPhone'), dietary: v('dietary') } }), 'Added');
    });
    r.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const c = cfg(), a = b.dataset.a;
      if (b.dataset.copy) return navigator.clipboard.writeText(b.dataset.copy).then(() => toastMsg('Link copied'), () => prompt('Copy this link:', b.dataset.copy));
      if (b.dataset.print) {
        const t = { ...D.trip, info: info() }, k = b.dataset.print;
        const per = fn => D.groups.map(g => fn(t, g, D.people.filter(p => p.group === g.id), D.cars.filter(x => x.group === g.id))).join('');
        return L.print(k === 'list' ? per(L.checkList) : k === 'emerg' ? per(L.emergencySheet) : k === 'covers' ? per(L.carCovers) : L.cards(t, D.groups, D.people));
      }
      if (b.dataset.gx) { c.gear.splice(+b.dataset.gx, 1); Store.save(); push(); return draw(); }
      if (b.dataset.plink) return navigator.clipboard.writeText(L.link.me(person(+b.dataset.plink).token)).then(() => toastMsg('Their link is copied'), () => prompt('Copy this link:', L.link.me(person(+b.dataset.plink).token)));
      if (b.dataset.admit) { const p = person(+b.dataset.admit); return confirm(`Give ${p.name} a place now? This goes over the trip's capacity unless someone has dropped out.`) && act(() => call('admin_person', { id: id(), pid: p.id, admit: true }), 'Place given'); }
      if (b.dataset.flag || b.dataset.cut) return planChange(planIndex()[+(b.dataset.flag || b.dataset.cut)], !!b.dataset.cut);
      if (b.dataset.unflag) { const [gid, i] = b.dataset.unflag.split(':').map(Number), g = D.groups.find(x => x.id === gid), plan = JSON.parse(JSON.stringify(g.plan || {})); plan.flags.splice(i, 1); return act(() => call('admin_plan', { id: id(), gid, plan }), 'Flag cleared'); }
      if (b.dataset.lead) return act(() => call('admin_group', { id: id(), gid: +b.dataset.g, leader: +b.dataset.lead }), 'Group leader changed');
      if (b.dataset.prm) { const p = person(+b.dataset.prm); return confirm(`Remove ${p.name} from the activity?`) && act(() => call('admin_person', { id: id(), pid: p.id, remove: true }), 'Removed'); }
      if (b.dataset.gnew) return confirm('Make a new link for this group? The old link stops working.') && act(() => call('admin_group', { id: id(), gid: +b.dataset.gnew, newLink: true }), 'New group link made — copy it and send it to the group leader');
      if (b.dataset.gren) { const g = D.groups.find(x => x.id === +b.dataset.gren), nm = prompt('Group name', g.name); return nm && act(() => call('admin_group', { id: id(), gid: g.id, name: nm })); }
      if (b.dataset.gdel) return confirm('Remove this group? Its people stay registered without a group; its cars are removed.') && act(() => call('admin_group', { id: id(), gid: +b.dataset.gdel, remove: true }));
      if (!a) return;
      if (a === 'reload') return act(load.bind(null), 'Refreshed');
      if (a === 'cap') return capacityDialog();
      if (a === 'tags') return tagDialog();
      if (a === 'search') { searchQ = $('#regoQ').value.trim(); $('#regoSearch').innerHTML = searchCard(); return; }
      if (a === 'gadd') { c.gear.push({ id: uid(), name: '', req: true }); Store.save(); draw(); const ins = root().querySelectorAll('[data-gn]'); return ins[ins.length - 1].focus(); }
      if (a === 'gbasic' || a === 'gplan') {
        if (c.gear.length && !confirm('Replace the current list?')) return;
        const names = a === 'gbasic' ? BASIC.map(nm => [nm, BASIC_G[nm] || 0]) : [...new Map(Store.state.gear.filter(g => g.carrier !== 'group' && g.name).map(g => [g.name.trim().toLowerCase(), [g.name.trim(), num(g.weightG) * num(g.qty, 1)]])).values()];
        c.gear = names.map(([nm, w]) => ({ id: uid(), name: nm, req: true, w: Math.round(w) || 0 })); Store.save(); push(); return draw();
      }
      if (a === 'gnew') { const nm = prompt('New group\'s name'); return nm && act(() => call('admin_group', { id: id(), name: nm })); }
      if (a === 'cars') return addCars();
      if (a === 'open') return act(async () => { await call('info_save', { id: id(), info: info() }); return call('stage', { id: id(), reg: 'open', closes: c.closes }); }, 'Registration is open — send out the link');
      if (a === 'interest') return act(async () => { await call('info_save', { id: id(), info: info() }); return call('stage', { id: id(), reg: 'interest', closes: c.closes }); }, 'Open for expressions of interest — send out the link');
      if (a === 'briefon' || a === 'briefoff') { c.briefOn = a === 'briefon'; Store.save(); return act(() => call('info_save', { id: id(), info: info() }), c.briefOn ? 'Briefing sent: it is on everyone\'s registration page' : 'Briefing withdrawn'); }
      if (a === 'go' || a === 'nogo' || a === 'undecide') {
        if (a === 'go' && !confirm('Record the decision as GO? Participants will see that the activity is going ahead.')) return;
        if (a === 'nogo' && !confirm('Record the decision as NO-GO? Participants will see that the activity is not going ahead.')) return;
        const who = (Store.user && (Store.user.name || Store.user.username)) || '';
        c.decision = a === 'undecide' ? { go: null, note: c.decision.note, by: '', at: null } : { go: a === 'go', note: c.decision.note, by: who, at: Date.now() };
        Store.save();
        return act(() => call('info_save', { id: id(), info: info() }), a === 'go' ? 'GO recorded' : a === 'nogo' ? 'NO-GO recorded' : 'Decision cleared');
      }
      if (a === 'close') return confirm('Close registration? People can no longer register or change their group\'s number of cars. You can re-open it.') && act(() => call('stage', { id: id(), reg: 'closed', closes: c.closes }), 'Registration closed');
      if (a === 'off') return confirm('Switch registration off? The registration page stops working; registrations already made are kept.') && act(() => call('stage', { id: id(), reg: 'off', closes: c.closes }));
      if (a === 'cknew') return (!D.trip.checkinToken || confirm('Make a new check-in link? Phones set up with the old one stop syncing.')) && act(() => call('checkin_link', { id: id(), on: true }), 'Check-in link ready');
      if (a === 'ckoff') return confirm('Remove the check-in link?') && act(() => call('checkin_link', { id: id(), on: false }));
    });
  }

  /* called when the app starts and when the tab changes: keeps the stage reminder under the tabs up to date */
  async function refreshBar() {
    if (Did !== id()) { D = null; err = ''; open = new Set(); if (Store.canEdit && id()) await load(); }   // another trip was opened
    bar();
    syncTravel();
  }
  function reset() { D = null; err = ''; open = new Set(); const el = $('#stageBar'); if (el) el.hidden = true; }

  /* for the Dashboard: the registrations (loaded if need be) */
  async function data(fresh) { if (Store.canEdit && id() && (fresh || !D || Did !== id())) await load(); return D; }

  return { decorate, render, refreshBar, reset, stage, data, info, syncTravel, peek: () => (Did === id() ? D : null) };
})();
