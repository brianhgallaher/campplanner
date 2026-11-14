/* Camp Planner — shared by the registration page, the check-in app and the planner's People tab:
   QR codes, links, and the printable check-in list, car cover pages and participant cards.
   QR codes hold a link to the check-in app (#c=<car code> or #p=<person code>), so they mean nothing to anyone
   whose phone hasn't been set up with the trip's check-in link. */

const RegoLib = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base = () => location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  const link = {
    register: r => `${base()}register.html?r=${encodeURIComponent(r)}`,
    me: p => `${base()}register.html?p=${encodeURIComponent(p)}`,
    group: g => `${base()}register.html?g=${encodeURIComponent(g)}`,
    checkin: k => `${base()}checkin.html?k=${encodeURIComponent(k)}`,
    car: code => `${base()}checkin.html#c=${code}`,
    person: code => `${base()}checkin.html#p=${code}`
  };
  /* What a scanned QR code means: { kind: 'c' | 'p', code } or null */
  const parse = text => { const m = /[#&?]([cp])=([A-Z0-9]{6,12})\b/.exec(String(text || '')); return m ? { kind: m[1], code: m[2] } : null; };

  function qr(text, px = 160) {
    if (typeof qrcode !== 'function') return '';
    const q = qrcode(0, 'M');
    q.addData(text); q.make();
    const n = q.getModuleCount(), m = 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    return `<svg class="rg-qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  const fmtDay = iso => { if (!iso) return ''; const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
  const span = t => (t.start ? fmtDay(t.start) + (t.end && t.end !== t.start ? ' – ' + fmtDay(t.end) : '') : 'Dates to be confirmed');
  const gearList = t => ((t.info && t.info.gear) || []).filter(g => g && g.name);
  /* gear progress for one person: required items ticked / required items */
  function gearState(t, p) {
    const req = gearList(t).filter(g => g.req !== false), have = new Set(p.gear || []);
    const done = req.filter(g => have.has(g.id)).length;
    return { done, total: req.length, ok: req.length > 0 && done === req.length, missing: req.filter(g => !have.has(g.id)).map(g => g.name) };
  }
  const gearBadge = (t, p) => { const s = gearState(t, p); return s.total ? `<span class="rg-pill ${s.ok ? 'ok' : s.done ? 'part' : 'none'}">${s.done}/${s.total}</span>` : ''; };

  /* ---------- printable sheets (one group at a time; the planner prints them for every group) ---------- */
  const box = '<span class="rg-box"></span>';
  function checkList(t, g, people, cars) {
    const leader = people.find(p => p.id === g.leader);
    const carName = id => { const c = cars.find(x => x.id === id); return c ? c.label : ''; };
    const rows = people.slice().sort((a, b) => (carName(a.car) || 'zzz').localeCompare(carName(b.car) || 'zzz') || a.name.localeCompare(b.name));
    return `<section class="rg-sheet">
      <header><h1>Check-in list — ${esc(g.name)}</h1><p>${esc(t.name)} · ${span(t)}</p></header>
      <p>Group leader: <b>${leader ? esc(leader.name) : '________________'}</b>${leader && leader.mobile ? ' · ' + esc(leader.mobile) : ''} · ${people.length} people · ${cars.length} car${cars.length === 1 ? '' : 's'}</p>
      <table class="rg-table"><thead><tr><th>Here</th><th>Name</th><th>Youth / adult</th><th>Car</th><th>Gear packed</th><th>Dietary</th><th>Notes</th></tr></thead><tbody>
        ${rows.map(p => `<tr><td>${box}</td><td><b>${esc(p.name)}</b>${p.id === g.leader ? ' <small>(leader)</small>' : ''}</td><td>${p.kind === 'adult' ? 'Adult' : 'Youth'}</td><td>${esc(carName(p.car)) || '—'}</td>
          <td>${box} ${gearBadge(t, p)}</td><td>${esc(p.dietary || '')}</td><td>${p.medFlag ? '⚕ medical notes — see leader' : ''}</td></tr>`).join('')}
      </tbody></table>
      ${gearList(t).length ? `<h3>Gear everyone needs</h3><p class="rg-gearline">${gearList(t).map(x => `${box} ${esc(x.name)}${x.req === false ? ' <small>(optional)</small>' : ''}`).join(' &nbsp; ')}</p>` : ''}
      <p class="rg-foot">At the start: show each car's cover page to the check-in leader to scan. Tell them about anyone who isn't coming.</p>
    </section>`;
  }
  /* ---------- vehicle details (the group's Cars screen): what the travel plan needs to work out seats, loads, fuel and
     towing, and whether the car and any trailer are registered for the trip ---------- */
  const FUELS = { ulp91: ['Unleaded 91', 8.5], e10: ['E10', 8.8], pulp95: ['Premium 95', 8.5], pulp98: ['Premium 98', 8.5], diesel: ['Diesel', 9.5], lpg: ['LPG', 12], ev: ['Electric', 17] };
  const BRAKES = { none: 'No brakes', override: 'Override brakes', electric: 'Electric brakes' };
  const carSpec = {
    FUELS, BRAKES,
    /* what is missing and what is wrong: { missing: [...], issues: [...], ok } */
    state(t, c) {
      const s = c.spec || {}, miss = [], bad = [], end = (t && t.end) || (t && t.start) || '';
      if (!s.model) miss.push('make and model');
      if (!s.fuel) miss.push('fuel type');
      if (!(s.economy > 0)) miss.push('fuel economy');
      if (!(s.tank > 0)) miss.push(s.fuel === 'ev' ? 'battery size' : 'tank size');
      if (!(s.payload > 0)) miss.push('payload');
      if (!s.rego) miss.push('registration plate');
      if (!s.regoExp) miss.push('registration expiry');
      else if (end && s.regoExp < end) bad.push(`registration runs out ${fmtDay(s.regoExp)}, before the trip ends`);
      if (s.trailer) {
        if (!(s.towMax > 0)) miss.push("the car's towing capacity");
        if (!s.tRego) miss.push('trailer registration plate');
        if (!s.tRegoExp) miss.push('trailer registration expiry');
        else if (end && s.tRegoExp < end) bad.push(`the trailer's registration runs out ${fmtDay(s.tRegoExp)}, before the trip ends`);
        if (!(s.tAtm > 0)) miss.push("the trailer's maximum loaded weight (ATM)");
        if (!(s.tLoad > 0)) miss.push("the trailer's loaded weight for this trip");
        if (s.tLoad > 0 && s.tAtm > 0 && s.tLoad > s.tAtm) bad.push(`the trailer will weigh ${s.tLoad} kg, over its ${s.tAtm} kg maximum (ATM)`);
        if (s.tLoad > 0 && s.towMax > 0 && s.tLoad > s.towMax) bad.push(`the trailer will weigh ${s.tLoad} kg, over the car's ${s.towMax} kg towing capacity`);
        if (s.tLoad > 750 && s.tBrakes === 'none') bad.push('a trailer over 750 kg loaded must have brakes');
      }
      const ok = !miss.length && !bad.length;                          // insurance is asked for, but does not hold up "complete"
      if (!s.insured) miss.push('insurance not confirmed');
      return { missing: miss, issues: bad, ok, insured: !!s.insured, any: Object.keys(s).length > 0 };
    },
    /* one line for lists and reports */
    line(c) {
      const s = c.spec || {}, f = FUELS[s.fuel];
      const car = [s.model, f ? `${f[0]}${s.economy ? ` ${s.economy} ${s.fuel === 'ev' ? 'kWh' : 'L'}/100 km` : ''}` : '', s.tank ? `${s.tank} ${s.fuel === 'ev' ? 'kWh' : 'L'} ${s.fuel === 'ev' ? 'battery' : 'tank'}` : '', s.payload ? `payload ${s.payload} kg` : '',
        s.rego ? `rego ${s.rego}${s.regoExp ? ` to ${fmtDay(s.regoExp)}` : ''}` : '', s.insured ? 'insured' : ''].filter(Boolean).map(esc).join(' · ');
      const tr = s.trailer ? [`🚚 trailer ${s.tDesc || ''}`.trim(), s.tLoad ? `${s.tLoad} kg loaded` : '', s.tAtm ? `ATM ${s.tAtm} kg` : '', s.towMax ? `car tows up to ${s.towMax} kg` : '', BRAKES[s.tBrakes] || '', s.tRego ? `rego ${s.tRego}${s.tRegoExp ? ` to ${fmtDay(s.tRegoExp)}` : ''}` : ''].filter(Boolean).map(esc).join(' · ') : '';
      return car + (tr ? (car ? '<br>' : '') + tr : '');
    },
    summary(t, c) {
      const S = carSpec.state(t, c);
      return S.ok ? `<span class="rg-pin">✓ complete</span>${S.insured ? '' : ' <span class="rg-muted">· insurance not confirmed</span>'}` : `<span class="rg-warn">${S.issues.length ? '⚠ ' + esc(S.issues[0]) + (S.issues.length > 1 ? ` (+${S.issues.length - 1})` : '') : `${S.missing.length} detail${S.missing.length === 1 ? '' : 's'} to add`}</span>`;
    },
    form(t, c) {
      const s = c.spec || {}, S = carSpec.state(t, c), v = k => (s[k] == null ? '' : esc(String(s[k]))), ev = s.fuel === 'ev';
      const num = (k, label, ph, max, step = 1) => `<label>${label}<input type="number" min="0" max="${max}" step="${step}" data-s="${k}" value="${v(k)}" placeholder="${ph}"></label>`;
      return `<details class="rg-spec" ${S.any && !S.ok ? 'open' : ''}><summary>🚗 Vehicle details <span class="rg-spec-sum">${carSpec.summary(t, c)}</span></summary>
        <p class="rg-muted">The organisers use these to check seats, how much each car can carry, fuel stops and costs. The figures are in the owner's handbook or on the compliance plate; payload is the most the car can carry (people and gear).</p>
        <div class="rg-specgrid">
          <label class="wide">Make and model<input data-s="model" maxlength="60" value="${v('model')}" placeholder="e.g. Toyota Prado 2019"></label>
          <label>Fuel<select data-s="fuel"><option value="">—</option>${Object.entries(FUELS).map(([k, f]) => `<option value="${k}" ${s.fuel === k ? 'selected' : ''}>${f[0]}</option>`).join('')}</select></label>
          ${num('economy', `Economy <small>(${ev ? 'kWh' : 'L'}/100 km)</small>`, 'e.g. 9.5', 60, 0.1)}
          ${num('tank', `${ev ? 'Battery' : 'Tank'} <small>(${ev ? 'kWh' : 'L'})</small>`, 'e.g. 70', 400)}
          ${num('payload', 'Payload <small>(kg it can carry)</small>', 'e.g. 600', 5000, 10)}
          <label>Registration plate<input data-s="rego" maxlength="12" value="${v('rego')}" placeholder="e.g. ABC12D" autocapitalize="characters"></label>
          <label>Registered until<input type="date" data-s="regoExp" value="${v('regoExp')}"></label>
        </div>
        <label class="rg-check rg-spec-ins"><input type="checkbox" data-s="insured" ${s.insured ? 'checked' : ''}> Comprehensive or third-party property insurance is current</label>
        <label class="rg-check rg-spec-tr"><input type="checkbox" data-s="trailer" ${s.trailer ? 'checked' : ''}> This car is towing a trailer</label>
        <div class="rg-specgrid rg-trailer" ${s.trailer ? '' : 'hidden'}>
          <label class="wide">Trailer<input data-s="tDesc" maxlength="60" value="${v('tDesc')}" placeholder="e.g. 7 × 5 box trailer"></label>
          ${num('tLoad', 'Loaded weight this trip <small>(kg)</small>', 'e.g. 600', 10000, 10)}
          ${num('tAtm', 'Trailer max weight <small>(ATM, kg)</small>', 'e.g. 750', 10000, 10)}
          ${num('tTare', 'Trailer empty weight <small>(tare, kg)</small>', 'e.g. 250', 5000, 10)}
          ${num('towMax', "Car's towing capacity <small>(kg)</small>", 'e.g. 1500', 10000, 10)}
          ${num('gcm', 'Combined limit <small>(GCM, kg — optional)</small>', 'e.g. 5000', 20000, 10)}
          <label>Brakes<select data-s="tBrakes"><option value="">—</option>${Object.entries(BRAKES).map(([k, b]) => `<option value="${k}" ${s.tBrakes === k ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
          <label>Trailer plate<input data-s="tRego" maxlength="12" value="${v('tRego')}" autocapitalize="characters"></label>
          <label>Trailer registered until<input type="date" data-s="tRegoExp" value="${v('tRegoExp')}"></label>
        </div></details>`;
    },
    read(row) {
      const o = {};
      row.querySelectorAll('[data-s]').forEach(i => {
        const k = i.dataset.s;
        if (i.type === 'checkbox') { if (i.checked) o[k] = true; }
        else if (i.type === 'number') { if (i.value !== '' && +i.value > 0) o[k] = +i.value; }
        else if (i.value.trim()) o[k] = k === 'rego' || k === 'tRego' ? i.value.trim().toUpperCase() : i.value.trim();
      });
      if (o.fuel && !o.economy) o.economy = FUELS[o.fuel][1];          // a typical figure until the real one is known
      return o;
    }
  };

  function carCovers(t, g, people, cars) {
    return cars.map(c => {
      const pax = people.filter(p => p.car === c.id);
      return `<section class="rg-sheet rg-cover">
        <header><h1>${esc(g.name)}</h1><p>${esc(t.name)} · ${span(t)}</p></header>
        <div class="rg-cover-main"><div>${qr(link.car(c.code), 300)}<p class="rg-code">${esc(c.code)}</p></div>
          <div><h2>${esc(c.label)}</h2>
            <p>Driver: <b>${esc(c.driver) || '________________'}</b> · ${c.seats} seats${c.start ? `<br>Leaves from: <b>${esc(c.start.name)}</b>` : ''}</p>
            <h3>Passengers (${pax.length})</h3>
            ${pax.length ? `<ol>${pax.map(p => `<li>${esc(p.name)}${p.kind === 'adult' ? ' <small>(adult)</small>' : ''}</li>`).join('')}</ol>` : '<p>Not listed yet — the check-in leader will see the whole group.</p>'}
          </div></div>
        <p class="rg-foot">Put this page on the dashboard. At the start, the check-in leader scans the code to check in everyone in this car.</p>
      </section>`;
    }).join('');
  }
  function cards(t, groups, people) {
    const gname = id => (groups.find(g => g.id === id) || {}).name || 'No group yet';
    return `<section class="rg-sheet rg-cards">${people.map(p => `<div class="rg-card">
        ${qr(link.person(p.code), 110)}
        <div><b>${esc(p.name)}</b><span>${esc(gname(p.group))}</span><span>${esc(t.name)}</span><small>${esc(p.code)}</small></div>
      </div>`).join('')}</section>`;
  }
  /* Bag tags: each tag is two panels side by side — the QR code on one, the readable details on the other — and folds down
     the middle to fit a tag holder of w × h mm (so the printed piece is 2w × h). The QR code is the participant's own code:
     a leader with the check-in app sees whose bag it is and who to call. Nobody else gets personal details from it.
     opt: { w, h, each (tags per person), contact (a "if found" line) } */
  const TAG = { w: 38, h: 22 };
  const tagSize = o => ({ w: Math.max(20, Math.min(120, +((o || {}).w) || TAG.w)), h: Math.max(12, Math.min(120, +((o || {}).h) || TAG.h)), each: Math.max(1, Math.min(6, Math.round(+((o || {}).each) || 1))), contact: String((o || {}).contact || '').trim().slice(0, 60) });
  function bagTags(t, groups, people, opt) {
    const o = tagSize(opt), gname = id => (groups.find(g => g.id === id) || {}).name || '';
    const tagPhone = String((t && t.info && t.info.tagPhone) || '').trim().slice(0, 30);      // the organisers' return number; a typed "if found" line wins
    const q = Math.max(8, Math.min(o.h, o.w) - 3);                                   // QR size, mm
    const fs = Math.max(1.7, Math.min(4.2, o.h * 0.14, o.w * 0.095));                  // name size, mm
    const tag = p => `<div class="rg-tag" style="width:${o.w * 2}mm;height:${o.h}mm">
        <div class="rg-tag-qr" style="width:${o.w}mm">${qr(link.person(p.code), 100).replace('<svg class="rg-qr"', `<svg class="rg-qr" style="width:${q}mm;height:${q}mm"`)}</div>
        <div class="rg-tag-txt" style="width:${o.w}mm;font-size:${fs}mm"><b style="font-size:${p.name.length > 26 ? 0.7 : p.name.length > 17 ? 0.84 : 1}em">${esc(p.name)}</b>${gname(p.group) ? `<span>${esc(gname(p.group))}</span>` : ''}${o.h >= 18 ? `<span class="rg-tag-trip">${esc(t.name)}</span>` : ''}
          <span class="rg-tag-found">${o.contact ? `If found: ${esc(o.contact)}` : tagPhone ? `If found, phone ${esc(tagPhone)}` : 'If found, please hand to a Scout leader'}</span><small>${esc(p.code)}</small></div></div>`;
    const list = people.filter(p => !p.wait);
    return `<section class="rg-sheet rg-tagsheet"><p class="rg-tag-help">Bag tags, ${o.w} × ${o.h} mm when folded. Cut around each tag on the solid line, fold on the dashed line with the printing outside, and slide it into the tag holder. Print at 100% (no “fit to page”).</p>
      <div class="rg-tags">${list.map(p => tag(p).repeat(o.each)).join('')}</div></section>`;
  }

  /* Show the sheets on their own and open the print dialog */
  function print(html) {
    let el = document.getElementById('rgPrint');
    if (!el) { el = document.createElement('div'); el.id = 'rgPrint'; document.body.appendChild(el); }
    el.innerHTML = html;
    document.body.classList.add('rg-printing');
    const done = () => { window.removeEventListener('afterprint', done); document.body.classList.remove('rg-printing'); el.innerHTML = ''; };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  }

  /* ---------- a group's own plan: meals, accommodation, public transport, costs ---------- */
  const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks']];
  const MODES = { coach: '🚌 Bus / coach', plane: '✈️ Plane', train: '🚆 Train', ferry: '⛴️ Ferry', other: '🚐 Other' };
  const money = v => (+v || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  const days = t => { if (!t.start) return [{ key: 'D1', label: 'Day 1' }]; const a = new Date(t.start + 'T00:00:00'), b = new Date((t.end || t.start) + 'T00:00:00'), n = Math.max(1, Math.min(30, Math.round((b - a) / 864e5) + 1));
    return Array.from({ length: n }, (_, i) => ({ key: 'D' + (i + 1), label: `Day ${i + 1} · ${new Date(+a + i * 864e5).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}` })); };
  /* What a food contains / what a person avoids, from plain words. A guide only: it can't read labels. */
  const FOODS = {
    nuts: ['nut', 'peanut', 'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'satay', 'nutella', 'trail mix', 'scroggin', 'muesli', 'praline', 'marzipan'],
    gluten: ['gluten', 'wheat', 'pasta', 'spaghetti', 'noodle', 'bread', 'roll', 'wrap', 'tortilla', 'flour', 'couscous', 'pancake', 'damper', 'cracker', 'biscuit', 'weet', 'cereal', 'pizza', 'burger', 'sandwich', 'toast', 'muesli', 'oat', 'porridge', 'pie', 'cake', 'pita'],
    dairy: ['dairy', 'milk', 'cheese', 'butter', 'yoghurt', 'yogurt', 'cream', 'custard', 'chocolate', 'pizza', 'carbonara', 'alfredo', 'mac and cheese', 'macaroni'],
    egg: ['egg', 'omelette', 'frittata', 'pancake', 'mayonnaise', 'mayo', 'french toast', 'carbonara', 'quiche'],
    seafood: ['fish', 'tuna', 'salmon', 'prawn', 'seafood', 'sardine', 'crab', 'shellfish', 'oyster', 'calamari'],
    meat: ['beef', 'chicken', 'bacon', 'ham', 'sausage', 'salami', 'jerky', 'mince', 'lamb', 'pork', 'steak', 'burger', 'bolognese', 'meat', 'tuna', 'salmon', 'fish', 'prawn', 'chorizo', 'pepperoni', 'hot dog'],
    soy: ['soy', 'tofu', 'tempeh', 'edamame', 'miso'], sesame: ['sesame', 'tahini', 'hummus', 'hommus']
  };
  const LABEL = { nuts: 'nuts', gluten: 'gluten', dairy: 'dairy', egg: 'egg', seafood: 'seafood', meat: 'meat or fish', soy: 'soy', sesame: 'sesame' };
  const DIETS = [[/vegan/, ['meat', 'dairy', 'egg']], [/vegetarian|no meat/, ['meat']], [/pescatarian/, []], [/nut/, ['nuts']], [/gluten|coeliac|celiac|wheat/, ['gluten']], [/dairy|lactose|milk/, ['dairy']],
    [/egg/, ['egg']], [/fish|seafood|shellfish|prawn/, ['seafood']], [/soy/, ['soy']], [/sesame/, ['sesame']]];
  const avoids = diet => { const d = String(diet || '').toLowerCase(), out = new Set(); DIETS.forEach(([re, ks]) => { if (re.test(d)) ks.forEach(k => out.add(k)); }); return out; };
  const has = text => { const x = ' ' + String(text || '').toLowerCase() + ' ', out = new Set();
    Object.entries(FOODS).forEach(([k, ws]) => { if (ws.some(w => x.includes(w)) && !new RegExp(`(no|without|free of|free from) ${k === 'nuts' ? 'nut' : k}|${k === 'nuts' ? 'nut' : k}[- ]free`).test(x)) out.add(k); }); return out; };
  /* Meals in the plan that clash with what someone in the group avoids */
  /* The organisers' master recipe list (name -> recipe with its ingredients), and meals a group has planned that aren't on it */
  const recipesOf = t => { const a = (t.info && t.info.recipes) || [], seen = new Set(a.map(r => String(r.name).trim().toLowerCase())); return a.concat((((t.info && t.info.extra) || {}).recipes || []).filter(r => !seen.has(String(r.name).trim().toLowerCase()))); };
  const sharedGear = t => { const a = gearList(t).map(g => ({ name: g.name, w: +g.w || 0, k: g.k || '' })), seen = new Set(a.map(g => g.name.toLowerCase())); return a.concat((((t.info && t.info.extra) || {}).gear || []).filter(g => !seen.has(String(g.name).toLowerCase()))); };
  const master = t => new Map(recipesOf(t).map(r => [String(r.name).trim().toLowerCase(), r]));
  const onList = (t, text) => master(t).get(String(text || '').trim().toLowerCase()) || null;
  /* What a group plans to eat at one meal: [{ n: recipe or meal name, s: servings }] (older plans hold one line of text) */
  function mealItems(plan, dk, sl) {
    const m = (((plan && plan.menu) || {})[dk] || {})[sl];
    if (Array.isArray(m)) return m.filter(x => x && x.n);
    const text = ((((plan && plan.meals) || {})[dk] || {})[sl] || '').trim();
    return text ? [{ n: text, s: 0 }] : [];
  }
  function offList(t, plan) {
    const M = master(t), out = [];
    if (!M.size) return out;
    days(t).forEach(d => SLOTS.forEach(([sl, label]) => mealItems(plan, d.key, sl).forEach(x => { if (!M.has(x.n.trim().toLowerCase())) out.push({ day: d.label, slot: label, text: x.n }); })));
    return out;
  }
  function mealIssues(t, plan, people) {
    const meals = (plan && plan.meals) || {}, out = [];
    const eaters = people.filter(p => !p.wait && p.dietary).map(p => ({ p, av: avoids(p.dietary) })).filter(x => x.av.size);
    days(t).forEach(d => SLOTS.forEach(([sl, label]) => mealItems(plan, d.key, sl).forEach(({ n: text }) => {
      const rec = onList(t, text), inFood = has(text + (rec ? ' ' + (rec.ing || []).join(' ') : ''));       // a master recipe is checked by its ingredients too
      eaters.forEach(({ p, av }) => { const hit = [...av].filter(k => inFood.has(k)); if (hit.length) out.push({ day: d.label, slot: label, text, who: p.name, diet: p.dietary, what: hit.map(k => LABEL[k]) }); });
    })));
    return out;
  }
  const mealCount = (t, plan) => { let n = 0, of = 0; days(t).forEach(d => SLOTS.slice(0, 3).forEach(([sl]) => { of++; if (mealItems(plan, d.key, sl).length) n++; })); return { n, of }; };
  /* Costs the group has entered, and its share of the fuel from the organisers' travel plan (t.info.travel) */
  function planCosts(t, g, plan, members) {
    const stay = ((plan && plan.stay) || []).reduce((a, x) => a + (+x.cost || 0), 0), transport = ((plan && plan.transport) || []).reduce((a, x) => a + (+x.cost || 0), 0);
    const tv = ((t.info && t.info.travel) || {})[g.id] || null, fuel = tv && tv.fuel != null ? tv.fuel : null, total = stay + transport + (fuel || 0);
    const share = (t.info && t.info.cost) || { share: 'group' };
    return { stay, transport, fuel, total, each: share.share === 'all' && share.perAll != null ? share.perAll : members ? total / members : null, shared: share.share === 'all', tv };
  }
  /* Pack weight for one person: what they've ticked (or everything needed, if nothing is ticked yet) plus food and water,
     or the weight the leader measured; against 20% of their body weight. Item weights come from the organisers' gear list. */
  function packState(t, plan, p) {
    const items = gearList(t), have = new Set(p.gear || []), W = ((plan && plan.weights) || {})[p.id] || {};
    const counted = items.filter(g => (have.size ? have.has(g.id) : g.req !== false)), known = counted.filter(g => +g.w > 0);
    const n = days(t).length, extra = 2 + Math.min(5, 0.8 * n) * (t.info && t.info.meals === 'provided' ? 0 : 1);       // 2 L water + about 0.8 kg food a day (up to 5 kg)
    const est = known.length ? known.reduce((a, g) => a + +g.w, 0) / 1000 + extra : null;
    const rows = (plan && plan.gear) || [], n2 = Math.max(1, (plan && plan._n) || 1);
    if (rows.some(x => String(x.c) === String(p.id))) {          // the group's own gear list: this person's items plus an even share of the shared ones
      const mineG = rows.filter(x => String(x.c) === String(p.id) && x.t !== 'w').reduce((a, x) => a + (+x.w || 0) * (+x.q || 1), 0), shared = rows.filter(x => x.c === 'group' && x.t !== 'w').reduce((a, x) => a + (+x.w || 0) * (+x.q || 1), 0);
      const e2 = (mineG + shared / n2) / 1000 + extra, pk = +W.pack > 0 ? +W.pack : e2, bd = +W.body > 0 ? +W.body : null, pc = bd ? pk / bd * 100 : null;
      return { est: e2, pack: pk, body: bd, pct: pc, weighed: +W.pack > 0, limit: bd ? bd * 0.2 : null, cls: pc == null ? '' : pc <= 20 ? 'ok' : pc <= 25 ? 'part' : 'none', extra, unknown: 0, fromList: true };
    }
    const pack = +W.pack > 0 ? +W.pack : est, body = +W.body > 0 ? +W.body : null, pct = pack != null && body ? pack / body * 100 : null;
    return { est, pack, body, pct, weighed: +W.pack > 0, limit: body ? body * 0.2 : null, cls: pct == null ? '' : pct <= 20 ? 'ok' : pct <= 25 ? 'part' : 'none', extra, unknown: counted.length - known.length };
  }
  const kg = v => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1) + ' kg');
  const hm = min => (min == null ? '' : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`);
  const when = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? esc(v) : d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };

  /* The group leader's report: everything the group has planned, on paper */
  /* One-page emergency sheet for a group: who to call, where the group is going and stopping, who is in which car and
     everyone's emergency contact. No medical details exist — only the "see the paper form" flag.
     opt.bare: just the body (no page wrapper or heading), for the planner's report. */
  const EM_KEYS = [['contact', 'Emergency contact at home'], ['returnBy', 'Raise the alarm if not back by'], ['hospital', 'Nearest hospital / medical centre'], ['police', 'Local police station'], ['ranger', 'Park / ranger office'],
    ['reception', 'Nearest mobile reception'], ['plb', 'PLB / satellite messenger'], ['evac', 'Evacuation route / exit points'], ['firstAider', 'First aider(s)']];
  function emergencySheet(t, g, people, cars, opt = {}) {
    const info = t.info || {}, em = info.emergency || {}, plan = g.plan || {}, tv = (info.travel || {})[g.id] || null, leader = people.find(p => p.id === g.leader);
    const mine = people.filter(p => !p.wait), rows = EM_KEYS.filter(([k]) => String(em[k] || '').trim());
    const stays = (plan.stay || []).filter(x => String(x.place || '').trim()), used = new Set();
    const stops = ((tv && tv.stops) || []).map(sg => { const own = stays.find(x => x.for === sg.key); if (own) used.add(own); return { night: (own && own.night) || sg.night, place: own ? own.place : sg.sug, note: own ? (own.note || '') : '', what: own ? (own.place === sg.sug ? 'suggested stop' : `the group's choice (suggested: ${sg.sug})`) : 'suggested stop - nothing booked yet' }; })
      .concat(stays.filter(x => !used.has(x)).map(x => ({ night: x.night, place: x.place, note: x.note || '', what: "the group's own stop" })))
      .sort((a, b) => String(a.night || '').localeCompare(String(b.night || '')));
    const tel = v => (v ? `<b>${esc(v)}</b>` : '________');
    const body = `
      <div class="rg-em-call"><b>000</b><span>Police, fire, ambulance. From a mobile with no coverage on your network try <b>112</b>. Say where you are: use the map, a grid reference or the Emergency Plus app.</span></div>
      <p>Group leader: <b>${leader ? esc(leader.name) : '________________'}</b>${leader && leader.mobile ? ' · ' + esc(leader.mobile) : ''} · ${mine.length} people · ${cars.length} car${cars.length === 1 ? '' : 's'}${info.where ? ` · Where: <b>${esc(String(info.where))}</b>` : ''}</p>
      <h3>Who to call</h3>
      ${rows.length ? `<table class="rg-table rg-kvp"><tbody>${rows.map(([k, l]) => `<tr><th>${l}</th><td>${esc(em[k])}</td></tr>`).join('')}</tbody></table>` : "<p>The organisers have not filled in the trip's emergency details yet (Risk tab, emergency plan). Write them here: home contact ________________ · nearest hospital ________________</p>"}
      <h3>Route and overnight stops</h3>
      ${tv ? `<p>About <b>${hm(tv.outMin)}</b> of driving to the start${tv.km ? `, ${Math.round(tv.km)} km in all` : ''}${(tv.meals || []).length ? ` · meal stops: ${tv.meals.map(esc).join(', ')}` : ''}.</p>` : "<p>Driving route: see the organisers' travel plan.</p>"}
      ${stops.length ? `<table class="rg-table"><thead><tr><th>Night of</th><th>Staying at</th><th></th><th>Booking / notes</th></tr></thead><tbody>${stops.map(x => `<tr><td>${x.night ? fmtDay(x.night) : ''}</td><td><b>${esc(x.place)}</b></td><td><small>${esc(x.what)}</small></td><td>${esc(x.note)}</td></tr>`).join('')}</tbody></table>` : '<p>No overnight stops on the way.</p>'}
      ${(plan.transport || []).length ? `<p>Public transport: ${plan.transport.map(x => `${MODES[x.mode] || MODES.other} ${esc(x.from)} → ${esc(x.to)}${x.depart ? ' (' + when(x.depart) + ')' : ''}`).join('; ')}.</p>` : ''}
      <h3>Cars</h3>
      ${cars.length ? `<table class="rg-table"><thead><tr><th>Car</th><th>Driver</th><th>Plate</th><th>Leaves from</th><th>In the car</th></tr></thead><tbody>${cars.map(c => { const s = c.spec || {}, pax = mine.filter(p => p.car === c.id);
        return `<tr><td><b>${esc(c.label)}</b>${s.model ? `<br><small>${esc(s.model)}</small>` : ''}</td><td>${esc(c.driver) || '________'}</td><td>${s.rego ? `<b>${esc(s.rego)}</b>` : '________'}${s.trailer ? `<br><small>trailer ${esc(s.tRego || '________')}</small>` : ''}</td><td>${c.start ? esc(c.start.name) : ''}</td><td>${pax.map(p => esc(p.name)).join(', ') || '—'}</td></tr>`; }).join('')}</tbody></table>` : '<p>No cars listed.</p>'}
      <h3>People and emergency contacts</h3>
      <table class="rg-table"><thead><tr><th>Name</th><th>Youth / adult</th><th>Own mobile</th><th>Emergency contact</th><th>Contact's phone</th><th>Medical</th></tr></thead><tbody>
        ${mine.map(p => `<tr><td><b>${esc(p.name)}</b>${p.id === g.leader ? ' <small>(leader)</small>' : ''}</td><td>${p.kind === 'adult' ? 'Adult' : 'Youth'}</td><td>${esc(p.mobile || '')}</td><td>${esc(p.emName || '') || '________'}</td><td>${tel(p.emPhone)}</td><td>${p.medFlag ? '⚕ notes — see paper form' : ''}</td></tr>`).join('')}</tbody></table>
      <p class="rg-foot">Medical details are not kept here: the group leader carries the paper forms. Keep this sheet in the lead car and leave a copy with the contact at home. Printed ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.</p>`;
    return opt.bare ? `<div class="rg-em">${body}</div>` : `<section class="rg-sheet rg-em"><header><h1>⛑ Emergency sheet — ${esc(g.name)}</h1><p>${esc(t.name)} · ${span(t)}</p></header>${body}</section>`;
  }
  function groupReport(t, g, people, cars) {
    const plan = g.plan || {}, mine = people.filter(p => !p.wait), C = planCosts(t, g, plan, mine.length), issues = mealIssues(t, plan, people), leader = people.find(p => p.id === g.leader);
    const carName = id => (cars.find(c => c.id === id) || {}).label || '—';
    const own = !t.info || t.info.meals !== 'provided';
    return `<section class="rg-sheet">
      <header><h1>${esc(g.name)} — group plan</h1><p>${esc(t.name)} · ${span(t)}</p></header>
      <p>Group leader: <b>${leader ? esc(leader.name) : '________________'}</b>${leader && leader.mobile ? ' · ' + esc(leader.mobile) : ''} · ${mine.length} people · ${cars.length} car${cars.length === 1 ? '' : 's'}</p>
      <h3>People</h3><table class="rg-table"><thead><tr><th>Name</th><th>Youth / adult</th><th>Car</th><th>Dietary</th><th>Gear</th><th>Notes</th></tr></thead><tbody>
        ${people.map(p => `<tr><td><b>${esc(p.name)}</b>${p.id === g.leader ? ' <small>(leader)</small>' : ''}</td><td>${p.kind === 'adult' ? 'Adult' : 'Youth'}</td><td>${p.wait ? 'waiting list' : p.waitGroup ? 'no seat yet' : esc(carName(p.car))}</td><td>${esc(p.dietary || '')}</td><td>${gearBadge(t, p)}</td><td>${p.medFlag ? '⚕ medical notes — see leader' : ''}</td></tr>`).join('')}</tbody></table>
      <h3>Travel</h3>
      ${cars.length ? `<table class="rg-table"><thead><tr><th>Car</th><th>Driver</th><th>Seats</th><th>Leaves from</th><th>Vehicle</th></tr></thead><tbody>${cars.map(c => `<tr><td><b>${esc(c.label)}</b></td><td>${esc(c.driver)}</td><td>${c.seats}</td><td>${c.start ? esc(c.start.name) : '—'}</td><td>${carSpec.line(c) || '—'}${carSpec.state(t, c).issues.map(x => `<br><b>⚠ ${esc(x)}</b>`).join('')}</td></tr>`).join('')}</tbody></table>` : '<p>No cars.</p>'}
      ${C.tv ? `<p>From the organisers' travel plan: about <b>${hm(C.tv.outMin)}</b> to the start${C.tv.km ? `, ${Math.round(C.tv.km)} km of driving in all` : ''}${(C.tv.nights || []).length ? ` · overnight stop at <b>${C.tv.nights.map(esc).join(', ')}</b>` : ''}${(C.tv.meals || []).length ? ` · meal stops: ${C.tv.meals.map(esc).join(', ')}` : ''}.</p>` : ''}
      ${(plan.transport || []).length ? `<table class="rg-table"><thead><tr><th>Public transport</th><th>From</th><th>To</th><th>Leaves</th><th>Arrives</th><th>Cost</th><th>Notes</th></tr></thead><tbody>${plan.transport.map(x => `<tr><td>${MODES[x.mode] || MODES.other}</td><td>${esc(x.from)}</td><td>${esc(x.to)}</td><td>${when(x.depart)}</td><td>${when(x.arrive)}</td><td>${money(x.cost)}</td><td>${esc(x.note || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${(plan.stay || []).length ? `<table class="rg-table"><thead><tr><th>Overnight on the way</th><th>Night of</th><th>Cost</th><th>Notes</th></tr></thead><tbody>${plan.stay.map(x => `<tr><td><b>${esc(x.place)}</b></td><td>${x.night ? fmtDay(x.night) : ''}</td><td>${money(x.cost)}</td><td>${esc(x.note || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      <h3>Meals</h3>
      ${own ? `<table class="rg-table"><thead><tr><th>Day</th>${SLOTS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${days(t).map(d => `<tr><td><b>${d.label}</b></td>${SLOTS.map(([sl]) => `<td>${mealItems(plan, d.key, sl).map(x => esc(x.n) + (x.s ? ` ×${x.s}` : '')).join('<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table>
        ${(plan.gear || []).length ? `<h3>Gear list</h3><table class="rg-table"><thead><tr><th>Item</th><th>Qty</th><th>Each</th><th>Carried by</th><th>Source</th><th>Notes</th></tr></thead><tbody>${plan.gear.map(x => `<tr><td>${x.p ? '☑' : box} ${esc(x.n)}</td><td>${x.q || 1}</td><td>${x.w ? x.w + ' g' : ''}</td><td>${x.c === 'group' ? 'Group (shared)' : esc((people.find(p => String(p.id) === String(x.c)) || {}).name || '')}</td><td>${esc(x.s || 'own')}${x.$ ? ' ' + money(x.$) : ''}</td><td>${esc(x.o || '')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${issues.length ? `<p><b>⚠ Check these meals against dietary needs:</b></p><ul>${issues.map(i => `<li>${esc(i.day)} ${i.slot.toLowerCase()} “${esc(i.text)}” may contain <b>${i.what.join(', ')}</b> — ${esc(i.who)} (${esc(i.diet)})</li>`).join('')}</ul>` : ''}` : '<p>Meals are organised and provided for this activity.</p>'}
      <h3>Pack weights <small>(aim: no more than 20% of body weight)</small></h3>
      <table class="rg-table"><thead><tr><th>Name</th><th>Gear ticked</th><th>Pack</th><th>Body weight</th><th>% of body weight</th><th>20% limit</th></tr></thead><tbody>
        ${mine.map(p => { const s = packState(t, plan, p); return `<tr><td><b>${esc(p.name)}</b></td><td>${gearBadge(t, p)}</td><td>${kg(s.pack)}${s.pack != null && !s.weighed ? ' <small>(est.)</small>' : ''}</td><td>${s.body ? s.body + ' kg' : '____'}</td><td>${s.pct == null ? '____' : `<b>${s.pct.toFixed(0)}%</b>${s.pct > 20 ? ' ⚠ over' : ''}`}</td><td>${kg(s.limit)}</td></tr>`; }).join('')}</tbody></table>
      <h3>Risks and controls</h3>
      ${((t.info && t.info.risks) || []).length ? `<table class="rg-table"><thead><tr><th>Read</th><th>Hazard</th><th>Controls we will follow</th><th>Our notes</th></tr></thead><tbody>
        ${t.info.risks.map(r => `<tr><td>${((plan.risks || {}).ack || []).includes(r.k) ? '☑' : box}</td><td><b>${esc(r.hazard)}</b>${r.rating ? ` <small>(${esc(r.rating)})</small>` : ''}</td><td>${esc(r.controls)}</td><td>${esc(((plan.risks || {}).notes || {})[r.k] || '')}</td></tr>`).join('')}</tbody></table>` : '<p>The organisers have not listed risks yet.</p>'}
      ${((plan.risks || {}).own || []).length ? `<table class="rg-table"><thead><tr><th>Our group's extra risks</th><th>Risk</th><th>Our controls</th><th>After controls</th><th>Who</th></tr></thead><tbody>${plan.risks.own.map(r => `<tr><td><b>${esc(r.hazard)}</b>${r.cause ? `<br><small>${esc(r.cause)}</small>` : ''}</td><td>${RiskUI.rate(r.l, r.c)[0]}</td><td>${esc(r.controls)}</td><td>${RiskUI.rate(r.rl, r.rc)[0]}</td><td>${esc(r.owner || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      <h3>Costs</h3>
      <table class="rg-table"><tbody><tr><td>Fuel (from the organisers' travel plan)</td><td>${C.fuel == null ? 'not worked out yet' : money(C.fuel)}</td></tr><tr><td>Accommodation on the way</td><td>${money(C.stay)}</td></tr><tr><td>Public transport</td><td>${money(C.transport)}</td></tr>
        <tr><td><b>Group travel total</b></td><td><b>${money(C.total)}</b></td></tr><tr><td>${C.shared ? 'Each person pays (travel costs are shared across everyone on the activity)' : `Each person in the group (${mine.length})`}</td><td><b>${C.each == null ? '—' : money(C.each)}</b></td></tr></tbody></table>
      <p class="rg-foot">Allergen checks are a guide from the words in the meal plan — always read the labels.</p>
    </section>`;
  }

  /* Risk rating = likelihood × consequence: Low 1–4, Medium 5–9, High 10–14, Extreme 15–25 */
  const LIKE = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'], CONS = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];
  const RiskUI = {
    LIKE, CONS,
    rate: (l, c) => { const s = (+l || 0) * (+c || 0); return !s ? ['', ''] : s <= 4 ? ['Low', 'low'] : s <= 9 ? ['Medium', 'med'] : s <= 14 ? ['High', 'high'] : ['Extreme', 'ext']; },
    badge(l, c) { const [t, k] = RiskUI.rate(l, c); return t ? `<span class="rk-badge ${k}">${t} <small>${l * c}</small></span>` : '<span class="gp-muted">—</span>'; },
    /* list: [{ l, c, rl, rc }] */
    matrix(list) {
      const n = (f1, f2, L, C) => list.filter(r => +r[f1] === L && +r[f2] === C).length;
      return `<div class="gp-head"><h3>Risk matrix</h3></div><table class="rk-matrix"><thead><tr><th>Likelihood ↓ /<br>Consequence →</th>${CONS.map((c, i) => `<th>${i + 1}<br>${c}</th>`).join('')}</tr></thead><tbody>
        ${[5, 4, 3, 2, 1].map(L => `<tr><th>${L}<br>${LIKE[L - 1]}</th>${[1, 2, 3, 4, 5].map(C => { const a = n('rl', 'rc', L, C), b = n('l', 'c', L, C);
          return `<td class="${RiskUI.rate(L, C)[1]}">${a ? `<b>${a}</b>` : ''}${b ? `<small>(${b})</small>` : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
        <p class="gp-muted">Bold = number of risks after controls; (brackets) = before controls.</p>`;
    },
    summary(list) {
      const cnt = (f1, f2, t) => list.filter(r => RiskUI.rate(r[f1], r[f2])[0] === t).length;
      return `<div class="gp-head"><h3>Summary</h3></div><table class="rk-sum"><thead><tr><th>Rating</th><th class="gp-num">Before controls</th><th class="gp-num">After controls</th></tr></thead><tbody>
        ${[['Extreme', 'ext'], ['High', 'high'], ['Medium', 'med'], ['Low', 'low']].map(([t, k]) => `<tr><td><span class="rk-badge ${k}">${t}</span></td><td class="gp-num">${cnt('l', 'c', t)}</td><td class="gp-num">${cnt('rl', 'rc', t)}</td></tr>`).join('')}</tbody></table>
        <p class="gp-muted">Rating = likelihood × consequence. Low 1–4 · Medium 5–9 · High 10–14 · Extreme 15–25.</p>`;
    },
    sel: (k, v, labels) => `<select data-k="${k}">${labels.map((t, i) => `<option value="${i + 1}" ${+v === i + 1 ? 'selected' : ''}>${i + 1} ${t}</option>`).join('')}</select>`,
    /* an editable row for one of the group's own risks */
    ownRow: (r = {}) => `<tr class="rg-own"><td class="rk-tick" title="A risk your group added">ours</td>
      <td><input data-k="hazard" placeholder="What could go wrong" maxlength="120" value="${esc(r.hazard || '')}"><textarea data-k="cause" rows="2" placeholder="Why / when" maxlength="200">${esc(r.cause || '')}</textarea></td>
      <td><textarea data-k="location" rows="2" placeholder="Where" maxlength="80">${esc(r.location || '')}</textarea></td>
      <td>${RiskUI.sel('l', r.l || 3, LIKE)}</td><td>${RiskUI.sel('c', r.c || 3, CONS)}</td><td class="rk-b1">${RiskUI.badge(r.l || 3, r.c || 3)}</td>
      <td><textarea data-k="controls" rows="3" placeholder="What we'll do about it" maxlength="400">${esc(r.controls || '')}</textarea></td>
      <td>${RiskUI.sel('rl', r.rl || 2, LIKE)}</td><td>${RiskUI.sel('rc', r.rc || 3, CONS)}</td><td class="rk-b2">${RiskUI.badge(r.rl || 2, r.rc || 3)}</td>
      <td><input data-k="owner" placeholder="Name" maxlength="40" value="${esc(r.owner || '')}"></td><td><button class="gp-x" type="button" data-rmrow title="Remove">🗑</button></td></tr>`
  };
  const CATS = ['Shelter', 'Sleep', 'Pack', 'Kitchen', 'Water', 'Clothing', 'Footwear', 'Navigation', 'Safety & First Aid', 'Hygiene', 'Electronics', 'Tools', 'Fishing & Leisure', 'Other'];
  const TYPES = { b: 'Base (in pack)', w: 'Worn / carried', c: 'Consumable' }, SRC = { own: 'Own', hire: 'Hire', buy: 'Buy', borrow: 'Borrow' };
  const catOf = n => { const x = String(n).toLowerCase(); return /tent|tarp|shelter|bivy/.test(x) ? 'Shelter' : /sleep|pillow|mat\b/.test(x) ? 'Sleep' : /pack|bag liner|rain cover/.test(x) ? 'Pack' : /stove|pot|plate|bowl|mug|cutlery|spork|fuel|gas/.test(x) ? 'Kitchen' : /water|bottle|bladder|filter/.test(x) ? 'Water'
    : /shoe|boot|sandal|gaiter/.test(x) ? 'Footwear' : /jacket|jumper|fleece|clothes|sock|hat|glove|thermal|shirt|shorts|pants/.test(x) ? 'Clothing' : /map|compass|gps/.test(x) ? 'Navigation' : /first aid|medication|whistle|plb|sunscreen|snake/.test(x) ? 'Safety & First Aid'
    : /toilet|towel|trowel|soap|tooth/.test(x) ? 'Hygiene' : /torch|phone|battery|charger|camera/.test(x) ? 'Electronics' : /knife|rope|repair|tape/.test(x) ? 'Tools' : 'Other'; };
  const gid = () => Math.random().toString(36).slice(2, 8);
  const fmtG = g => (g >= 1000 ? (g / 1000).toFixed(2) + ' kg' : Math.round(g) + ' g');

  /* ---------- pack weights for a group: one card per person, like the planner's Pack Weight tab ---------- */
  const PK = [['base', 'Base gear', '#262661'], ['food', 'Food', '#e8590c'], ['water', 'Water', '#1c7ed6'], ['cons', 'Other consumables', '#f2a93b']];
  /* what one person carries, in grams: from the group's own gear list when it has items for them (their items plus an
     even share of the shared ones), otherwise from the organisers' list they have ticked */
  function packDetail(t, plan, p) {
    const S = packState(t, plan, p), rows = (plan && plan.gear) || [], n2 = Math.max(1, (plan && plan._n) || 1), items = [];
    if (S.fromList) {
      rows.filter(x => String(x.c) === String(p.id)).forEach(x => items.push({ n: x.n, w: (+x.w || 0) * (+x.q || 1), t: x.t || 'b', k: x.k || 'Other' }));
      rows.filter(x => x.c === 'group').forEach(x => items.push({ n: x.n, w: (+x.w || 0) * (+x.q || 1) / n2, t: x.t || 'b', k: x.k || 'Other', shared: true }));
    } else {
      const have = new Set(p.gear || []);
      gearList(t).filter(g => (have.size ? have.has(g.id) : g.req !== false)).forEach(g => items.push({ n: g.name, w: +g.w || 0, t: 'b', k: g.k || catOf(g.name) }));
    }
    const sum = f => items.filter(f).reduce((a, x) => a + x.w, 0);
    const water = 2000, food = Math.max(0, S.extra * 1000 - water), cats = {};
    items.filter(x => x.t !== 'w').forEach(x => { cats[x.k] = (cats[x.k] || 0) + x.w; });
    return { S, items, base: sum(x => x.t === 'b'), cons: sum(x => x.t === 'c'), worn: sum(x => x.t === 'w'), food, water, cats, noWeights: items.length > 0 && !items.some(x => x.w > 0) };
  }
  function packCards(t, plan, people, opt = {}) {
    const mine = people.filter(p => !p.wait);
    if (!mine.length) return '<div class="gp-card"><p>Nobody is in this group yet.</p></div>';
    const D = mine.map(p => ({ p, ...packDetail(t, plan, p) })), W = (plan && plan.weights) || {};
    const known = D.filter(d => d.S.pack != null), over = D.filter(d => d.S.pct != null && d.S.pct > 20), noBody = D.filter(d => !d.S.body);
    const card = d => {
      const { S, p } = d, segs = PK.map(([k, l, c]) => ({ l, c, v: d[k] })).filter(x => x.v > 0), tot = segs.reduce((a, x) => a + x.v, 0);
      const cats = Object.entries(d.cats).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]), mx = cats.length ? cats[0][1] : 1, w = W[p.id] || {};
      return `<div class="gp-card pk-card"><div class="gp-head"><h3>${esc(p.name)} <small>${p.kind === 'adult' ? 'adult' : 'youth'}</small></h3>
          ${S.pct == null ? `<span class="rg-pill">${S.body ? 'no pack weight yet — weigh the pack or add gear weights' : 'add body weight for the 20% check'}</span>` : `<span class="rg-pill ${S.cls}">${S.pct.toFixed(1)}% of body weight (${S.body} kg)${S.pct > 20 ? ` — ${kg(S.pack - S.limit)} over` : ''}</span>`}</div>
        <div class="gp-stats pk-stats"><div class="pk-hero ${S.cls}"><b>${kg(S.pack)}</b><span>pack weight at the start${S.pack == null ? '' : S.weighed ? ' — weighed' : ' — estimated'}</span></div>
          <div><b>${fmtG(d.base)}</b><span>base gear</span></div><div><b>${fmtG(d.food)}</b><span>food</span></div><div><b>${fmtG(d.water)}</b><span>water (2 L)</span></div>
          <div><b>${fmtG(d.cons)}</b><span>other consumables</span></div><div><b>${fmtG(d.worn)}</b><span>worn / carried</span></div>${S.limit ? `<div><b>${kg(S.limit)}</b><span>20% limit</span></div>` : ''}</div>
        ${S.weighed && S.est != null ? `<p class="rg-muted">Weighed at ${kg(S.pack)}; the gear list adds up to ${kg(S.est)}.</p>` : ''}
        ${tot ? `<div class="pk-bar">${segs.map(x => `<i style="width:${x.v / tot * 100}%;background:${x.c}" title="${x.l}: ${fmtG(x.v)}"></i>`).join('')}</div>
          <div class="pk-legend">${segs.map(x => `<span><i style="background:${x.c}"></i>${x.l} ${fmtG(x.v)} (${Math.round(x.v / tot * 100)}%)</span>`).join('')}</div>` : ''}
        <div class="pk-cols"><div>${cats.length ? `<h4>Pack breakdown by category</h4><table class="pk-cats">${cats.map(([c, v]) => `<tr><td>${esc(c)}</td><td class="pk-barcell"><i style="width:${v / mx * 100}%"></i></td><td class="pk-num">${fmtG(v)}</td></tr>`).join('')}</table>`
            : `<p class="rg-muted">${d.noWeights ? 'The gear on the list has no weights yet.' : 'No gear listed for this person yet — add items on the gear list above, or tick the organisers\' list.'}</p>`}
            <p class="rg-muted">${S.fromList ? 'From the group\'s gear list: their own items plus an even share of the shared gear.' : 'From the organisers\' gear list' + ((p.gear || []).length ? ' (the items ticked).' : ' (the required items — nothing ticked yet).')}${S.unknown ? ` ${S.unknown} item${S.unknown > 1 ? 's have' : ' has'} no weight.` : ''}</p>${opt.extra ? opt.extra(p) : ''}</div>
          <div class="pk-in"><label>Body weight (kg)<input type="number" min="20" max="200" step="1" data-wb="${p.id}" value="${w.body || ''}"></label>
            <label>Weighed pack (kg)<input type="number" min="0" max="60" step="0.1" data-wp="${p.id}" value="${w.pack || ''}" placeholder="${S.est == null ? '' : S.est.toFixed(1)}"></label></div></div></div>`;
    };
    const top = new Map();
    D.forEach(d => d.items.filter(x => x.t !== 'w' && x.w > 0).forEach(x => { const k = x.n + (x.shared ? '|g' : '|' + d.p.id), m = top.get(k) || { n: x.n, w: 0, who: x.shared ? 'Shared' : d.p.name }; m.w += x.w; top.set(k, m); }));
    const heavy = [...top.values()].sort((a, b) => b.w - a.w).slice(0, 10);
    return `<div class="gp-stats"><div><b>${known.length ? kg(known.reduce((a, d) => a + d.S.pack, 0)) : '—'}</b><span>all packs combined</span></div>
        <div><b>${D.length - noBody.length} / ${D.length}</b><span>with a body weight</span></div><div><b>${D.filter(d => d.S.weighed).length} / ${D.length}</b><span>packs weighed</span></div>
        <div class="${over.length ? 'pk-bad' : ''}"><b>${over.length}</b><span>over 20% of body weight</span></div></div>
      ${over.length ? `<p class="rg-warn">Over 20%: ${over.map(d => `${esc(d.p.name)} (${d.S.pct.toFixed(0)}%, ${kg(d.S.pack - d.S.limit)} over)`).join(', ')}. Move shared gear to someone with room, or leave extras behind.</p>` : ''}
      ${D.map(card).join('')}
      ${heavy.length ? `<div class="gp-card"><div class="gp-head"><h3>Heaviest items</h3></div><table class="pk-cats">${heavy.map(x => `<tr><td>${esc(x.n)} <small>${esc(x.who)}</small></td><td class="pk-barcell"><i style="width:${x.w / heavy[0].w * 100}%"></i></td><td class="pk-num">${fmtG(x.w)}</td></tr>`).join('')}</table></div>` : ''}`;
  }
  /* read the body and pack weights typed into the cards */
  function packRead(host, plan) {
    const weights = {};
    host.querySelectorAll('[data-wb]').forEach(i => { const b = +i.value || 0, pk = +host.querySelector(`[data-wp="${i.dataset.wb}"]`).value || 0; if (b || pk) weights[i.dataset.wb] = { body: b, pack: pk }; });
    plan.weights = weights;
    return weights;
  }

  const PlanUI = {
    /* Meal plan: a row per day, a column per meal; recipes from the organisers' list with servings; food weight and energy per day */
    menu(t, plan, people) {
      const recs = recipesOf(t), n = Math.max(1, people.filter(p => !p.wait).length), issues = mealIssues(t, plan, people), off = offList(t, plan);
      const opts = sl => { const a = recs.filter(r => r.slot === sl), b = recs.filter(r => r.slot !== sl), o = r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`;
        return `<option value="">+ add…</option>${a.length ? `<optgroup label="${esc((SLOTS.find(x => x[0] === sl) || [])[1] || sl)}">${a.map(o).join('')}</optgroup>` : ''}${b.length ? `<optgroup label="Other recipes">${b.map(o).join('')}</optgroup>` : ''}<option value="__other">Something not on the list…</option>`; };
      return `<div class="gp-card"><div class="gp-head"><h3>Meal plan</h3><span class="gp-tools"><span class="gp-muted">Servings default to the people in the group (${n}). The trip's recipe list has ${recs.length}.</span><button type="button" class="gp-btn primary" data-gp-lib title="Search hundreds of hiking and camp recipes. Any you add also go on the trip's list for other groups.">📚 Recipe library</button></span></div>
        <div class="gp-scroll"><table class="gp-menu"><thead><tr><th>Day</th><th>Breakfast</th><th>Lunch</th><th>Dinner</th><th>Snacks &amp; drinks</th><th class="gp-num">Food</th></tr></thead><tbody>
        ${days(t).map((d, di, all) => { let g = 0, kcal = 0;
          const cells = SLOTS.map(([sl]) => `<td>${mealItems(plan, d.key, sl).map((x, i) => { const r = onList(t, x.n), sv = +x.s || n; if (r) { g += (+r.g || 0) * sv; kcal += (+r.kcal || 0) * sv; }
              const bad = issues.some(q => q.day === d.label && q.text === x.n);
              return `<div class="gp-chip ${r ? '' : 'off'} ${bad ? 'bad' : ''}" title="${r ? '' : 'Not on the organisers\' recipe list'}${bad ? ' May clash with a dietary need' : ''}"><span>${esc(x.n)}${r ? '' : ' <small>off list</small>'}${bad ? ' ⚠' : ''}</span><small>×</small><input type="number" min="1" max="400" value="${sv}" data-gp-sv="${d.key}.${sl}.${i}" aria-label="Servings"><button type="button" class="gp-x" data-gp-rm="${d.key}.${sl}.${i}" title="Remove">✕</button></div>`; }).join('')}
            <select class="gp-add" data-gp-add="${d.key}.${sl}">${opts(sl)}</select></td>`).join('');
          return `<tr><td class="gp-day"><b>${d.label.split(' · ')[0]}</b><br>${esc(d.label.split(' · ')[1] || '')}${di < all.length - 1 ? `<br><button type="button" class="gp-link" data-gp-copy="${d.key}" title="Copy this day's meals to the next day">⧉ copy ↓</button>` : ''}</td>${cells}
            <td class="gp-num">${g ? `<b>${(g / 1000).toFixed(2)} kg</b><br><small>${Math.round(kcal / n)} kcal pp</small>` : '<small>—</small>'}</td></tr>`; }).join('')}
        </tbody></table></div>
        ${off.length ? `<p class="gp-warn">📋 ${off.length} meal${off.length > 1 ? 's are' : ' is'} not on the organisers' recipe list (marked “off list”). Pick a listed recipe if one fits.</p>` : ''}
        ${issues.length ? `<div class="gp-issues"><b>⚠ Check these against dietary needs</b><ul>${issues.map(i => `<li>${esc(i.day)} ${i.slot.toLowerCase()} “${esc(i.text)}” may contain <b>${i.what.join(', ')}</b> — ${esc(i.who)} (${esc(i.diet)})</li>`).join('')}</ul><small>A guide from the recipe's ingredients and name — always read the labels.</small></div>` : ''}</div>`;
    },
    /* Gear list: totals, an add row, then a table per category */
    gear(t, plan, people, who) {
      const G = plan.gear || [], mine = people.filter(p => !p.wait), show = G.filter(x => !who || String(x.c) === String(who)), tot = x => (+x.w || 0) * (+x.q || 1);
      const carr = v => `<option value="group" ${v === 'group' ? 'selected' : ''}>Group (shared)</option>${mine.map(p => `<option value="${p.id}" ${String(v) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
      const sel = (obj, v) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('');
      const cats = CATS.filter(c => show.some(x => (x.k || 'Other') === c));
      const costs = G.filter(x => +x.$ > 0 && x.s && x.s !== 'own');
      return `<div class="gp-head"><h3>Gear list</h3><span class="gp-tools"><select data-gp-who><option value="">Everyone</option>${carr(who || '')}</select>
          <button type="button" class="gp-btn primary" data-gp-cat title="Search thousands of products from outdoor stores, with weights and prices">🔎 Gear catalogue</button><button type="button" class="gp-btn" data-gp-seed title="Adds every item on the organisers' gear list for each member of the group">Load the organisers' list</button><button type="button" class="gp-btn" data-gp-untick>Untick all</button></span></div>
        <div class="gp-stats"><div><b>${show.length}</b><span>items</span></div><div><b>${show.filter(x => x.p).length} / ${show.length}</b><span>packed</span></div>
          <div><b>${fmtG(show.filter(x => x.t !== 'w').reduce((a, x) => a + tot(x), 0))}</b><span>in packs (excl. food &amp; water)</span></div><div><b>${fmtG(show.filter(x => x.t === 'w').reduce((a, x) => a + tot(x), 0))}</b><span>worn / carried</span></div>
          <div><b>${money(costs.reduce((a, x) => a + +x.$, 0))}</b><span>${costs.filter(x => x.s === 'hire').length} to hire, ${costs.filter(x => x.s === 'buy').length} to buy</span></div></div>
        <datalist id="gpGearNames">${sharedGear(t).map(g => `<option value="${esc(g.name)}">${g.w ? g.w + ' g' : ''}</option>`).join('')}</datalist>
        <div class="gp-card gp-addrow"><input data-gp-new="n" placeholder="Item name — type a new item, or pick from the trip's list" maxlength="80" list="gpGearNames" autocomplete="off"><select data-gp-new="k">${CATS.map(c => `<option ${c === 'Other' ? 'selected' : ''}>${c}</option>`).join('')}</select><input data-gp-new="w" type="number" min="0" placeholder="Weight (g)"><input data-gp-new="q" type="number" min="1" value="1" aria-label="Quantity">
          <select data-gp-new="t">${sel(TYPES, 'b')}</select><select data-gp-new="c">${carr(who || 'group')}</select><select data-gp-new="s">${sel(SRC, 'own')}</select><input data-gp-new="$" type="number" min="0" placeholder="Cost $"><button type="button" class="gp-btn primary" data-gp-newadd>+ Add</button></div>
        ${cats.map(c => { const rows = show.filter(x => (x.k || 'Other') === c);
          return `<div class="gp-card"><div class="gp-head"><h3>${c}</h3><b>${fmtG(rows.reduce((a, x) => a + tot(x), 0))}</b></div><div class="gp-scroll"><table class="gp-gear"><thead><tr><th>✓</th><th>Item</th><th>Qty</th><th>Each (g)</th><th class="gp-num">Total</th><th>Type</th><th>Carried by</th><th>Source &amp; cost</th><th>Category</th><th>Notes</th><th></th></tr></thead><tbody>
            ${rows.map(x => `<tr data-gp-row="${x.i}"><td><input type="checkbox" data-gp-f="p" ${x.p ? 'checked' : ''} aria-label="Packed"></td><td><input data-gp-f="n" value="${esc(x.n)}" maxlength="80"></td><td><input data-gp-f="q" type="number" min="1" value="${x.q || 1}" class="gp-sm"></td><td><input data-gp-f="w" type="number" min="0" value="${x.w || ''}" class="gp-md"></td><td class="gp-num">${fmtG(tot(x))}</td>
              <td><select data-gp-f="t">${sel(TYPES, x.t || 'b')}</select></td><td><select data-gp-f="c">${carr(x.c)}</select></td><td class="gp-src"><select data-gp-f="s">${sel(SRC, x.s || 'own')}</select>${x.s && x.s !== 'own' ? `<input data-gp-f="$" type="number" min="0" value="${x.$ || ''}" placeholder="$" class="gp-sm">` : ''}</td>
              <td><select data-gp-f="k">${CATS.map(k => `<option ${k === (x.k || 'Other') ? 'selected' : ''}>${k}</option>`).join('')}</select></td><td><input data-gp-f="o" value="${esc(x.o || '')}" placeholder="—" maxlength="100"></td><td><button type="button" class="gp-x" data-gp-del title="Remove">🗑</button></td></tr>`).join('')}
          </tbody></table></div></div>`; }).join('') || '<div class="gp-card"><p class="gp-muted">No gear listed yet. Add items above, or load the organisers\' list to start with what everyone needs.</p></div>'}`;
    },
    /* A search dialog over the page. */
    modal(title, controls, onSearch) {
      let m = document.getElementById('gpModal'); if (m) m.remove();
      m = document.createElement('div'); m.id = 'gpModal'; m.className = 'gp gp-modal';
      m.innerHTML = `<div class="gp-modal-box"><div class="gp-head"><h3>${title}</h3><button type="button" class="gp-btn" data-close>Close</button></div><div class="gp-modal-tools">${controls}</div><div class="gp-modal-res"><p class="gp-muted">Loading…</p></div></div>`;
      document.body.appendChild(m);
      const res = m.querySelector('.gp-modal-res'), run = () => onSearch(m, res);
      m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
      let tm; m.querySelector('.gp-modal-tools').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(run, 250); });
      m.querySelector('.gp-modal-tools').addEventListener('change', run);
      return { m, res, run };
    },
    /* Recipe library: hundreds of hiking and camp recipes. Adding one puts it in the chosen meal and on the trip's list. */
    async library(ctx) {
      const t = ctx.t, ds = days(t);
      const ui = PlanUI.modal('📚 Recipe library', `<input type="search" data-q placeholder="Search recipes or ingredients, e.g. pasta, vegetarian, standing camp…" style="flex:2;min-width:220px">
        <select data-slot><option value="">Any meal</option>${SLOTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <label>Add to <select data-day>${ds.map(d => `<option value="${d.key}">${d.label}</option>`).join('')}</select></label>`, (m, res) => {
          if (!PlanUI._lib) return;
          const words = m.querySelector('[data-q]').value.toLowerCase().split(/\s+/).filter(Boolean), slot = m.querySelector('[data-slot]').value;
          const hits = PlanUI._lib.filter(r => (!slot || r.slot === slot) && words.every(w => r.hay.includes(w)));
          res.innerHTML = `<p class="gp-muted">${hits.length} recipes${hits.length > 60 ? ' — showing the first 60' : ''}. Weights and energy are per serving.</p>` + hits.slice(0, 60).map(r => `<div class="gp-hit"><div><b>${esc(r.name)}</b> <small>${esc((SLOTS.find(x => x[0] === r.slot) || [])[1] || r.slot)} · ${r.g} g · ${r.kcal} kcal${r.tags.length ? ' · ' + r.tags.map(esc).join(', ') : ''}</small>
              <small class="gp-muted">${r.ing.slice(0, 9).map(esc).join(', ')}${r.ing.length > 9 ? '…' : ''}</small></div><button type="button" class="gp-btn primary" data-add="${r.i}">${onList(t, r.name) ? '+ Add' : '+ Add (new to the trip)'}</button></div>`).join('');
        });
      ui.res.addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (!b) return; const r = PlanUI._lib[+b.dataset.add], sl = ui.m.querySelector('[data-slot]').value || r.slot || 'dinner';
        if (!onList(t, r.name)) { const c = { name: r.name, slot: r.slot, g: r.g, kcal: r.kcal, ing: r.ing.slice(0, 25), lib: 1 }; ((t.info.extra = t.info.extra || {}).recipes = t.info.extra.recipes || []).push(c); if (ctx.share) ctx.share({ recipe: c }); }
        ctx.addMeal(ui.m.querySelector('[data-day]').value, sl, r.name); b.textContent = '✓ Added'; b.disabled = true; });
      try {
        if (!PlanUI._lib) { const d = await (await fetch('data/recipe-library.json')).json();
          PlanUI._lib = d.recipes.map((r, i) => { const ing = (r.ingredients || []).map(x => x.name); return { i, name: r.name, slot: r.slot, tags: r.tags || [], ing, g: Math.round((r.ingredients || []).reduce((a, x) => a + (+x.weightG || 0), 0)), kcal: Math.round((r.ingredients || []).reduce((a, x) => a + (+x.kcal || 0), 0)), hay: [r.name, r.slot, ...(r.tags || []), ...ing].join(' ').toLowerCase() }; }); }
        ui.run(); ui.m.querySelector('[data-q]').focus();
      } catch (e) { ui.res.innerHTML = '<p class="gp-warn">The recipe library couldn\'t be loaded. Check your connection and try again.</p>'; }
    },
    /* Gear catalogue: products from outdoor stores with weights and prices, plus what's already on the trip's list. */
    async catalogue(ctx) {
      const t = ctx.t, mine = ctx.people.filter(p => !p.wait);
      const ui = PlanUI.modal('🔎 Gear catalogue', `<input type="search" data-q placeholder="Search products, e.g. sleeping bag -5, 2 person tent, head torch…" style="flex:2;min-width:220px">
        <select data-cat><option value="">Any category</option>${CATS.map(c => `<option>${c}</option>`).join('')}</select><label class="gp-check"><input type="checkbox" data-hasw checked> has a weight</label>
        <select data-sort><option value="">Best match</option><option value="w">Lightest first</option><option value="p">Cheapest first</option></select>
        <label>For <select data-carrier><option value="group">Group (shared)</option>${mine.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>`, (m, res) => {
          if (!PlanUI._cat) return;
          const words = m.querySelector('[data-q]').value.toLowerCase().split(/\s+/).filter(Boolean), cat = m.querySelector('[data-cat]').value, hasW = m.querySelector('[data-hasw]').checked, sort = m.querySelector('[data-sort]').value;
          const trip = sharedGear(t).filter(g => (!cat || (g.k || catOf(g.name)) === cat) && words.every(w => g.name.toLowerCase().includes(w)));
          if (!words.length && !cat) { res.innerHTML = `<h4>On this trip's list (${trip.length})</h4>` + trip.map((g, i) => `<div class="gp-hit"><div><b>${esc(g.name)}</b> <small>${g.w ? g.w + ' g' : 'no weight'}${g.by ? ' · added by ' + esc(g.by) : ''}</small></div><button type="button" class="gp-btn primary" data-trip="${i}">+ Add</button></div>`).join('') + '<p class="gp-muted">Type to search the store catalogue.</p>'; PlanUI._trip = trip; return; }
          let hits = PlanUI._cat.items.filter(x => (!cat || x.c === cat) && (!hasW || x.w) && words.every(w => x.h.includes(w)));
          if (sort) hits = hits.filter(x => x[sort] != null).sort((a, b) => a[sort] - b[sort]);
          PlanUI._trip = trip; PlanUI._hits = hits.slice(0, 60);
          res.innerHTML = (trip.length ? `<h4>On this trip's list</h4>` + trip.map((g, i) => `<div class="gp-hit"><div><b>${esc(g.name)}</b> <small>${g.w ? g.w + ' g' : 'no weight'}</small></div><button type="button" class="gp-btn primary" data-trip="${i}">+ Add</button></div>`).join('') : '')
            + `<h4>Store catalogue — ${hits.length} products${hits.length > 60 ? ' (first 60)' : ''}</h4>` + PlanUI._hits.map((x, i) => `<div class="gp-hit"><div><b>${esc(x.n)}</b> <small>${esc(x.b || '')} · ${esc((PlanUI._cat.stores[x.s] || {}).name || x.s)} · ${x.c}${x.w ? ' · <b>' + (x.w >= 1000 ? (x.w / 1000).toFixed(2) + ' kg' : x.w + ' g') + '</b>' : ' · no weight'}${x.p ? ' · ' + money(x.p) : ''}</small>
              ${x.l ? `<small><a href="${esc(x.l)}" target="_blank" rel="noopener">store page</a></small>` : ''}</div><button type="button" class="gp-btn primary" data-item="${i}">+ Add</button></div>`).join('');
        });
      ui.res.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const carrier = ui.m.querySelector('[data-carrier]').value;
        if (b.dataset.trip) { const g = PlanUI._trip[+b.dataset.trip]; ctx.addGear({ n: g.name, w: g.w || 0, k: g.k || catOf(g.name), c: carrier }); }
        else if (b.dataset.item) { const x = PlanUI._hits[+b.dataset.item], name = x.n.slice(0, 80);
          ctx.addGear({ n: name, w: x.w || 0, k: x.c || 'Other', c: carrier, s: 'own', $: 0, o: x.p ? `${(PlanUI._cat.stores[x.s] || {}).name || x.s} ${money(x.p)}` : '' });
          if (!sharedGear(t).some(g => g.name.toLowerCase() === name.toLowerCase())) { ((t.info.extra = t.info.extra || {}).gear = t.info.extra.gear || []).push({ name, w: x.w || 0, k: x.c || 'Other' }); if (ctx.share) ctx.share({ gear: { name, w: x.w || 0, k: x.c || 'Other' } }); } }
        else return;
        b.textContent = '✓ Added'; b.disabled = true; });
      try {
        if (!PlanUI._cat) { ui.res.innerHTML = '<p class="gp-muted">Loading the catalogue (about 4 MB, first time only)…</p>'; const d = await (await fetch('data/gear-catalog.json')).json(); d.items.forEach(x => { x.h = `${x.n} ${x.b || ''} ${x.u || ''} ${x.c}`.toLowerCase(); }); PlanUI._cat = d; }
        ui.run(); ui.m.querySelector('[data-q]').focus();
      } catch (e) { ui.res.innerHTML = '<p class="gp-warn">The gear catalogue couldn\'t be loaded. Check your connection and try again.</p>'; ui.run(); }
    },
    /* Wire up a container holding menu() and/or gear(). ctx: { t, plan, people, save(plan), draw() } — plan is changed in place. */
    bind(root, ctx) {
      if (root.dataset.gpBound) return;            // one set of handlers per container, however often its contents are redrawn
      root.dataset.gpBound = 1;
      const { t, plan } = ctx, n = () => Math.max(1, ctx.people.filter(p => !p.wait).length);
      let timer = null;
      const sync = () => { plan.meals = {}; days(t).forEach(d => SLOTS.forEach(([sl]) => { const it = (((plan.menu || {})[d.key] || {})[sl] || []); if (it.length) (plan.meals[d.key] = plan.meals[d.key] || {})[sl] = it.map(x => x.n).join(', '); })); plan._n = n(); };
      const changed = redraw => { sync(); clearTimeout(timer); timer = setTimeout(() => ctx.save(plan), 700); if (redraw) ctx.draw(); };
      /* older plans hold one line of text per meal: turn them into entries the first time something changes */
      const menu = () => { if (!plan.menu) { plan.menu = {}; days(t).forEach(d => SLOTS.forEach(([sl]) => { const it = mealItems(plan, d.key, sl); if (it.length) (plan.menu[d.key] = plan.menu[d.key] || {})[sl] = it.map(x => ({ n: x.n, s: x.s || n() })); })); } return plan.menu; };
      const slot = (dk, sl) => { const m = menu(); m[dk] = m[dk] || {}; m[dk][sl] = m[dk][sl] || []; return m[dk][sl]; };
      const stop = e => e.stopPropagation();
      ['click', 'change', 'input', 'submit'].forEach(ev => root.addEventListener(ev, stop));        // the page around it has its own handlers
      ctx.addMeal = (dk, sl, name) => { slot(dk, sl).push({ n: name, s: n() }); changed(true); };
      ctx.addGear = row => { (plan.gear = plan.gear || []).push({ i: gid(), q: 1, t: 'b', s: 'own', $: 0, o: '', p: 0, ...row }); changed(true); };
      root.addEventListener('change', e => {
        const el = e.target, ds = el.dataset;
        if (ds.gpAdd) { const [dk, sl] = ds.gpAdd.split('.'); let v = el.value;
          if (v === '__other') { v = (prompt('What is the meal? It will be added to the trip\'s recipe list so other groups can pick it too.') || '').trim().slice(0, 80);
            if (v && !onList(t, v)) { ((t.info.extra = t.info.extra || {}).recipes = t.info.extra.recipes || []).push({ name: v, slot: sl, g: 0, kcal: 0, ing: [] }); if (ctx.share) ctx.share({ recipe: { name: v, slot: sl } }); } }
          if (v) slot(dk, sl).push({ n: v, s: n() }); return changed(true); }
        if (ds.gpSv) { const [dk, sl, i] = ds.gpSv.split('.'); slot(dk, sl)[+i].s = Math.max(1, Math.round(+el.value || 1)); return changed(true); }
        if (ds.gpWho !== undefined) { ctx.who = el.value; return ctx.draw(); }
        if (ds.gpF) { const x = (plan.gear || []).find(g => g.i === el.closest('[data-gp-row]').dataset.gpRow); if (!x) return;
          x[ds.gpF] = ds.gpF === 'p' ? (el.checked ? 1 : 0) : ['q', 'w', '$'].includes(ds.gpF) ? (+el.value || 0) : el.value;
          if (ds.gpF === 'q') x.q = Math.max(1, x.q);
          return changed(ds.gpF !== 'n' && ds.gpF !== 'o'); }
      });
      root.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return; const ds = b.dataset;
        if (ds.gpRm) { const [dk, sl, i] = ds.gpRm.split('.'); slot(dk, sl).splice(+i, 1); return changed(true); }
        if (ds.gpCopy) { const ds2 = days(t), i = ds2.findIndex(d => d.key === ds.gpCopy), m = menu(); m[ds2[i + 1].key] = JSON.parse(JSON.stringify(m[ds.gpCopy] || {})); return changed(true); }
        if ('gpNewadd' in ds) { const v = k => root.querySelector(`[data-gp-new="${k}"]`).value, name = v('n').trim(); if (!name) return root.querySelector('[data-gp-new="n"]').focus();
          const known = sharedGear(t).find(g => g.name.toLowerCase() === name.toLowerCase()), row = { i: gid(), n: name, q: Math.max(1, +v('q') || 1), w: +v('w') || (known ? known.w : 0), t: v('t'), c: v('c'), s: v('s'), $: +v('$') || 0, k: v('k') !== 'Other' ? v('k') : (known && known.k) || catOf(name), o: '', p: 0 };
          (plan.gear = plan.gear || []).push(row);
          if (!known && ctx.share) ctx.share({ gear: { name, w: row.w, k: row.k } });            // a new item: onto the trip's list for other groups
          return changed(true); }
        if ('gpLib' in ds) return PlanUI.library(ctx);
        if ('gpCat' in ds) return PlanUI.catalogue(ctx);
        if ('gpDel' in ds) { plan.gear = plan.gear.filter(g => g.i !== b.closest('[data-gp-row]').dataset.gpRow); return changed(true); }
        if ('gpUntick' in ds) { (plan.gear || []).forEach(g => { g.p = 0; }); return changed(true); }
        if ('gpSeed' in ds) { const list = gearList(t), mine = ctx.people.filter(p => !p.wait); if (!list.length) return alert('The organisers haven\'t set a gear list yet.');
          if ((plan.gear || []).length && !confirm('Add the organisers\' list for every member to the gear already here?')) return;
          plan.gear = plan.gear || [];
          mine.forEach(p => list.forEach(g => { if (!plan.gear.some(x => String(x.c) === String(p.id) && x.n === g.name)) plan.gear.push({ i: gid(), n: g.name, q: 1, w: +g.w || 0, t: /shoe|boot|hat/i.test(g.name) ? 'w' : 'b', c: String(p.id), s: 'own', $: 0, k: g.k || catOf(g.name), o: g.req === false ? 'optional' : '', p: (p.gear || []).includes(g.id) ? 1 : 0 }); }));
          return changed(true); }
      });
    }
  };

  return { packCards, packRead, packDetail, carSpec, bagTags, tagSize, TAG, RiskUI, PlanUI, mealItems, CATS, recipesOf, sharedGear, esc, link, parse, qr, fmtDay, span, gearList, gearState, gearBadge, checkList, carCovers, cards, print,
    master, onList, offList, SLOTS, MODES, money, days, mealIssues, mealCount, planCosts, groupReport, emergencySheet, hm, when, avoids, has, packState, kg };
})();
