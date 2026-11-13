/* Camp Planner — food & water drops (resupply caches) on a traverse, and their effect on pack weight.
   A drop sits at a distance along a trail and holds food for meal-plan days, water, and gear moved out of the packs.
   Pack weight along the route = base gear + food still to eat (minus food waiting in drops)
   + gear moved to drops once collected + water for the current dry section. */

const Drops = (() => {
  const DEFAULTS = { rate: 0.5, camp: 3, reserve: 0.5 }; // L/hour walking, L per person for a dry camp, L arrival reserve
  const COLORS = ['#1c7ed6', '#e8590c', '#2b8a3e', '#7048e8', '#c2255c', '#0c8599'];

  const list = f => (f.drops = f.drops || []);
  const cfg = f => (f.dropCfg = Object.assign({}, DEFAULTS, f.dropCfg));
  const kmTxt = m => (m / 1000).toFixed(m >= 10000 ? 1 : 2);

  /* ---------- geometry & route helpers ---------- */
  function pointAt(f, d) {
    const cum = Geo.cumDist(f.coords);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1], t = seg ? Math.min(1, Math.max(0, (d - cum[i - 1]) / seg)) : 0;
    const a = f.coords[i - 1], b = f.coords[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  /* Day the drop is collected: the day whose legs include it (arriving at an overnight camp counts as that day). */
  function dayAt(T, d) {
    const l = T.legs.find(l => d >= l.from.d - 1 && d <= l.to.d + 1);
    return l ? l.day : d <= 0 ? 1 : T.days;
  }
  function hoursBetween(T, a, b) {
    return T.legs.reduce((h, l) => {
      const o = Math.min(b, l.to.d) - Math.max(a, l.from.d);
      return o > 0 && l.dist > 0 ? h + l.hours * o / l.dist : h;
    }, 0);
  }
  function vehicleAt(f, d) {
    if (!Egress.fresh(f)) return null;
    let best = null;
    f.egress.entries.forEach(e => {
      const off = d < e.d0 ? e.d0 - d : d > e.d1 ? d - e.d1 : 0;
      if (off <= 300 && (!best || off < best.off)) best = { e, off };
    });
    return best;
  }
  /* Places a drop can go: route stops (campsites, water, landmarks) and vehicle egress points. */
  function candidates(T) {
    const out = T.stops.map(s => ({ name: s.name, d: s.d, icon: (MapView.KINDS[s.kind] || MapView.KINDS.waypoint).icon }));
    if (Egress.fresh(T.f)) T.f.egress.entries.forEach(e => out.push({ name: e.name, d: e.d0, icon: Egress.LEVELS[e.level].icon }));
    out.sort((a, b) => a.d - b.d);
    return out.filter((c, i) => !i || c.d - out[i - 1].d > 30 || c.name !== out[i - 1].name);
  }

  /* ---------- food ---------- */
  const mealDays = () => tripDays();
  function dayFoodPP(k) {
    const m = Meals.totals();
    return (m.perDay[k - 1]?.weightG || 0) / Math.max(1, Store.state.people.length);
  }
  function dropDays(dr) {
    const a = num(dr.foodFrom), b = num(dr.foodTo);
    if (!a || !b) return [];
    const out = [];
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) out.push(k);
    return out;
  }
  function mealsFor(k) {
    const dp = Store.state.mealPlan['D' + k] || {};
    return Object.entries(dp).flatMap(([slot, es]) => es.map(e => {
      const r = Store.state.recipes.find(x => x.id === e.recipeId);
      return r ? `${slot}: ${r.name} ×${e.servings}` : '';
    })).filter(Boolean);
  }

  /* Gear moved into a drop: weight per person (shared items split evenly). */
  function gearShare(ids, person, people) {
    let g = 0;
    Store.state.gear.filter(x => ids.includes(x.id)).forEach(x => {
      const w = num(x.weightG) * num(x.qty, 1);
      if (x.carrier === person.id) g += w;
      else if (!people.some(p => p.id === x.carrier)) g += w / people.length;
    });
    return g;
  }

  /* ---------- the model ---------- */
  function model(T, withDrops) {
    const f = T.f, c = cfg(f), people = Store.state.people;
    const W = Weight.compute(true), total = T.total;
    const days = Math.max(1, T.days);
    const ranges = [];
    for (let k = 1; k <= days; k++) {
      const ls = T.legs.filter(l => l.day === k);
      ranges.push(ls.length ? [ls[0].from.d, ls[ls.length - 1].to.d] : [0, total]);
    }
    const dayFood = []; for (let k = 1; k <= days; k++) dayFood.push(dayFoodPP(k));
    const trailFood = dayFood.reduce((s, v) => s + v, 0);
    const drops = withDrops ? list(f).map(dr => ({
      ...dr, d: num(dr.d), food: dropDays(dr).filter(k => k <= days).reduce((s, k) => s + dayFood[k - 1], 0)
    })) : [];
    const eatenBy = x => {
      let eaten = 0;
      for (let k = 0; k < days; k++) {
        const [a, b] = ranges[k];
        if (x >= b) eaten += dayFood[k];
        else if (x > a) eaten += dayFood[k] * (x - a) / Math.max(1, b - a);
      }
      return eaten;
    };

    /* water: refill at the start, water-source stops and drops with water */
    const refills = [{ d: 0, name: T.stops[0]?.name || 'Start', type: 'start' }];
    /* every water landmark near the route (not just route stops — tanks often sit at a campsite stop) */
    const cum = Geo.cumDist(f.coords);
    Store.state.map.features.filter(x => x.type === 'landmark' && x.kind === 'water').forEach(x => {
      const kx = Math.cos(x.lat * Math.PI / 180) * 111320, ky = 110540;
      let best = { off: Infinity, d: 0 };
      for (let i = 1; i < f.coords.length; i++) {
        const a = f.coords[i - 1], b = f.coords[i];
        const ax = (a[1] - x.lng) * kx, ay = (a[0] - x.lat) * ky, dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky;
        const l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
        const off = Math.hypot(ax + t * dx, ay + t * dy);
        if (off < best.off) best = { off, d: cum[i - 1] + t * (cum[i] - cum[i - 1]) };
      }
      if (best.off < 250) refills.push({ d: best.d, name: x.name, type: 'water' });
    });
    drops.filter(dr => num(dr.waterL) > 0).forEach(dr => refills.push({ d: dr.d, name: dr.name || 'Water drop', type: 'drop', litresPP: num(dr.waterL) / Math.max(1, people.length) }));
    refills.sort((a, b) => a.d - b.d);
    const pts = refills.filter((r, i) => !i || r.d - refills[i - 1].d > 20);
    const camps = T.legs.filter((l, i) => i < T.legs.length - 1 && (l.to.kind === 'campsite' || l.to.night)).map(l => l.to);
    const sections = pts.map((r, i) => {
      const a = r.d, b = i < pts.length - 1 ? pts[i + 1].d : total;
      const hours = hoursBetween(T, a, b);
      const dryCamps = camps.filter(cp => cp.d > a + 1 && cp.d <= b + 1000 && !pts.some(p => Math.abs(p.d - cp.d) < 1000)); // a tank within 1 km serves the camp
      const litres = Math.max(1, hours * c.rate + dryCamps.length * c.camp + c.reserve);
      /* a drop at an overnight camp also supplies that night's cooking & drinking water */
      const campHere = r.type === 'drop' && camps.some(cp => Math.abs(cp.d - a) < 1000) && !pts.some(p => p.type === 'water' && Math.abs(p.d - a) < 1000) ? c.camp : 0;
      const need = litres + campHere;
      return { from: r, a, b, hours, dryCamps, litres, campHere, need, short: r.type === 'drop' && r.litresPP < need ? r.litresPP : null };
    });
    const waterAt = x => {
      const s = sections.find(s => x >= s.a && x < s.b) || sections[sections.length - 1];
      const carry = s.short != null ? s.short : s.litres;
      return Math.max(c.reserve, carry - (carry - c.reserve) * (x - s.a) / Math.max(1, s.b - s.a)) * 1000;
    };

    /* samples along the route, with points either side of each pick-up so steps show */
    const xs = new Set();
    for (let i = 0; i <= 160; i++) xs.add(total * i / 160);
    [...drops.map(d => d.d), ...pts.map(p => p.d)].forEach(d => { xs.add(Math.max(0, d - 1)); xs.add(Math.min(total, d + 1)); });
    const X = [...xs].sort((a, b) => a - b);
    const series = W.map(r => {
      const moved = drops.map(dr => ({ d: dr.d, g: gearShare(dr.gearIds || [], r.person, people) }));
      const fixed = r.base + r.cons;
      const load = X.map(x => {
        const waiting = drops.filter(dr => dr.d > x);
        const food = Math.max(0, trailFood - eatenBy(x) - waiting.reduce((s, dr) => s + dr.food, 0));
        const gearAway = moved.filter(m => m.d > x).reduce((s, m) => s + m.g, 0);
        return fixed - gearAway + food + waterAt(x);
      });
      return { person: r.person, load, start: load[0], max: Math.max(...load) };
    });
    return { X, series, sections, refills: pts, drops, trailFood, days, ranges };
  }

  /* ---------- checks ---------- */
  function warnings(T, dr) {
    const out = [], pick = dayAt(T, num(dr.d));
    const days = dropDays(dr);
    if (days.length && Math.min(...days) < pick) out.push(`picked up on day ${pick} but holds food for day ${Math.min(...days)} — that food would be needed before you reach the drop`);
    if (!days.length && !num(dr.waterL) && !(dr.gearIds || []).length) out.push('empty — add food days, water or gear');
    const v = vehicleAt(T.f, num(dr.d));
    if (Egress.fresh(T.f) && !v) out.push('no road or vehicle track within 300 m — the drop must be carried in on foot');
    else if (v && v.e.level === 'fire') out.push('only reachable by a fire trail that may be gated — check access with the park office');
    else if (v && v.e.level === 'restricted') out.push('vehicle access is restricted here — get permission before placing the drop');
    return out;
  }

  /* ---------- UI ---------- */
  function card(T) {
    const f = T.f, c = cfg(f), drops = list(f), people = Store.state.people, days = mealDays();
    let changed = false;
    drops.forEach(dr => { const p = dayAt(T, num(dr.d)); if (dr.pickupDay !== p) { dr.pickupDay = p; changed = true; } }); // for the Pack Weight tab
    if (changed) Store.save();
    const withM = model(T, true), noM = model(T, false);
    const startW = Math.max(...withM.series.map(s => s.start)), startN = Math.max(...noM.series.map(s => s.start));
    const maxW = Math.max(...withM.series.map(s => s.max)), maxN = Math.max(...noM.series.map(s => s.max));
    const cands = candidates(T);
    const gearOpts = Store.state.gear.slice().sort((x, y) => (x.type !== 'consumable') - (y.type !== 'consumable')); // consumables first
    const placers = [...Store.state.travel.cars.map(cr => ['car:' + cr.id, '🚗 ' + cr.name]), ...people.map(p => ['p:' + p.id, p.name])];
    return `<div class="card drops-card" data-trail="${f.id}">
      <div class="cat-head"><h3>📦 Food &amp; water drops</h3>
        <div class="btn-row no-print"><button class="btn small" data-drop="suggest">✨ Suggest drops</button><button class="btn small primary" data-drop="add">+ Add drop</button></div></div>
      <div class="big-stats">
        <div class="hero ${drops.length && startW < startN ? 'ok' : ''}"><b>${fmtKg(startW)}</b><span>heaviest pack at the start${drops.length ? ` (was ${fmtKg(startN)})` : ''}</span></div>
        <div><b>${fmtKg(maxW)}</b><span>heaviest pack anywhere on the route${drops.length && maxN !== maxW ? ` (was ${fmtKg(maxN)})` : ''}</span></div>
        <div><b>${drops.length}</b><span>drop${drops.length === 1 ? '' : 's'}${drops.length ? ` · saves ${fmtKg(Math.max(0, startN - startW))} at the start` : ''}</span></div>
        <div><b>${fmtKg(withM.trailFood)}</b><span>food per person for ${withM.days} day${withM.days > 1 ? 's' : ''} on this route</span></div>
      </div>
      ${loadChart(T, withM, noM)}

      ${drops.map((dr, i) => {
        const d = num(dr.d), [lat, lng] = pointAt(f, d), v = vehicleAt(f, d), w = warnings(T, dr);
        const foodKg = dropDays(dr).reduce((s, k) => s + dayFoodPP(k), 0) * people.length;
        const gearKg = Store.state.gear.filter(g => (dr.gearIds || []).includes(g.id)).reduce((s, g) => s + num(g.weightG) * num(g.qty, 1), 0);
        return `<div class="drop" data-drop-id="${dr.id}">
          <div class="drop-head"><b>📦 Drop ${i + 1}</b> <input data-dk="name" value="${esc(dr.name || '')}" placeholder="Name, e.g. Day 2 resupply">
            <button class="icon-btn no-print" data-drop="del" title="Remove drop">🗑</button></div>
          <div class="drop-grid">
            <label class="field"><span>Location</span><select data-dk="at"><option value="">km along trail…</option>
              ${cands.map(cn => `<option value="${cn.d}" ${Math.abs(cn.d - d) < 1 ? 'selected' : ''}>${cn.icon} ${esc(cn.name)} — km ${kmTxt(cn.d)}</option>`).join('')}</select></label>
            <label class="field"><span>km along trail</span><input type="number" min="0" max="${kmTxt(T.total)}" step="0.1" data-dk="km" value="${kmTxt(d)}"></label>
            <div class="field"><span>Where</span><div><b>${Geo.grText(lat, lng)}</b> · picked up on <b>day ${dr.pickupDay}</b><br>
              ${v ? `<span class="veh" style="background:${Egress.LEVELS[v.e.level].color}">${Egress.LEVELS[v.e.level].icon} ${Egress.LEVELS[v.e.level].label}</span> <small>${esc(v.e.name)}${v.off ? `, ${Math.round(v.off)} m away` : ''}</small>`
                : `<small class="muted">${Egress.fresh(f) ? 'No vehicle access nearby' : 'Checking vehicle access…'}</small>`}</div></div>
            <label class="field"><span>Food for days</span><div class="row">
              <select data-dk="foodFrom"><option value="">—</option>${days.map((x, k) => `<option value="${k + 1}" ${num(dr.foodFrom) === k + 1 ? 'selected' : ''}>Day ${k + 1}</option>`).join('')}</select>
              <span>to</span>
              <select data-dk="foodTo"><option value="">—</option>${days.map((x, k) => `<option value="${k + 1}" ${num(dr.foodTo) === k + 1 ? 'selected' : ''}>Day ${k + 1}</option>`).join('')}</select></div></label>
            <label class="field"><span>Water left at drop (litres, whole group)</span><input type="number" min="0" step="1" data-dk="waterL" value="${num(dr.waterL) || ''}" placeholder="0"></label>
            <label class="field"><span>Placed by</span><select data-dk="placedBy"><option value="">—</option>${placers.map(([k, l]) => `<option value="${k}" ${dr.placedBy === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label class="field"><span>Placed on</span><input type="date" data-dk="placedOn" value="${esc(dr.placedOn || '')}"></label>
          </div>
          <details class="drop-gear" ${(dr.gearIds || []).length ? 'open' : ''}><summary>Gear moved into this drop (${(dr.gearIds || []).length}) — e.g. spare gas, toilet paper, fresh socks</summary>
            ${gearOpts.length ? `<div class="gear-pick">${gearOpts.map(g => `<label class="check"><input type="checkbox" data-gear="${g.id}" ${(dr.gearIds || []).includes(g.id) ? 'checked' : ''}> ${esc(g.name)} <small class="muted">${fmtG(num(g.weightG) * num(g.qty, 1))} · ${esc(personName(g.carrier))}</small></label>`).join('')}</div>`
              : '<p class="muted small">Add items on the Gear tab first.</p>'}
          </details>
          <div class="drop-contents"><b>Contents:</b> ${[
            foodKg ? `food ${fmtKg(foodKg)} (${dropDays(dr).map(k => `day ${k}`).join(', ')})` : '',
            num(dr.waterL) ? `water ${num(dr.waterL)} L (${fmtKg(num(dr.waterL) * 1000)})` : '',
            gearKg ? `gear ${fmtKg(gearKg)}` : ''].filter(Boolean).join(' · ') || '<span class="muted">nothing yet</span>'}
            ${dropDays(dr).length ? `<div class="small muted">${dropDays(dr).map(k => `<b>Day ${k}:</b> ${mealsFor(k).map(esc).join(', ') || 'no meals planned'}`).join('<br>')}</div>` : ''}
          </div>
          <label class="field"><span>Notes</span><input data-dk="notes" value="${esc(dr.notes || '')}" placeholder="Container, where it's hidden, permission reference…"></label>
          ${w.length ? `<ul class="checks">${w.map(x => `<li class="warn">⚠ ${x}</li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('') || '<p class="muted">No drops yet. A drop lets you start lighter by leaving food, water and spare gear at a point on the route — usually a campsite or a vehicle-accessible egress point. Try ✨ Suggest drops.</p>'}

      <h4>💧 Water plan <small class="muted">(per person)</small></h4>
      <div class="row wrap no-print">
        <label class="field"><span>Drinking on the move (L/hour)</span><input type="number" min="0.1" max="2" step="0.1" data-dc="rate" value="${c.rate}"></label>
        <label class="field"><span>Dry camp — cooking &amp; overnight (L)</span><input type="number" min="0" max="10" step="0.5" data-dc="camp" value="${c.camp}"></label>
        <label class="field"><span>Reserve on arrival (L)</span><input type="number" min="0" max="3" step="0.5" data-dc="reserve" value="${c.reserve}"></label>
      </div>
      <table class="tbl"><thead><tr><th>Fill up at</th><th class="num">km</th><th class="num">To next refill</th><th class="num">Walking</th><th>Dry camps</th><th class="num">Carry</th><th class="num">Weight</th></tr></thead>
        <tbody>${withM.sections.map(s => `<tr>
          <td>${s.from.type === 'drop' ? '📦' : s.from.type === 'water' ? '💧' : '🟢'} ${esc(s.from.name)}</td><td class="num">${kmTxt(s.a)}</td>
          <td class="num">${kmTxt(s.b - s.a)} km</td><td class="num">${MapView.fmtHours(s.hours)}</td>
          <td>${s.dryCamps.map(cp => esc(cp.name) + ` (+${c.camp} L)`).join(', ') || '—'}${s.campHere ? `<br><small>+ ${s.campHere} L used at this camp</small>` : ''}</td>
          <td class="num"><b>${s.litres.toFixed(1)} L</b>${s.short != null ? `<br><small class="bad-text">drop has ${s.short.toFixed(1)} L pp, needs ${s.need.toFixed(1)} L</small>` : ''}</td>
          <td class="num">${fmtKg(s.litres * 1000, 1)}</td></tr>`).join('')}</tbody></table>
      <p class="small muted">Refill points are the start, water-source landmarks on the route (add them on the Map, e.g. from the campgrounds &amp; water overlay) and drops with water.
        Treat all creek and tank water. In hot weather allow 1 L/hour or more.
        Food drops: use sealed, animal-proof containers labelled with your name, phone and pick-up date; never bury food; collect everything you leave. Some parks restrict caches — check with the park office first.</p>
    </div>`;
  }

  function loadChart(T, withM, noM) {
    const Wd = 1000, H = 240, L = 50, R = 16, Tp = 16, B = 34;
    const all = [...withM.series, ...noM.series].flatMap(s => s.load);
    const hi = Math.ceil(Math.max(...all) / 2000) * 2, lo = Math.max(0, Math.floor(Math.min(...all) / 2000) * 2 - 2);
    const x = d => L + d / Math.max(1, T.total) * (Wd - L - R), y = g => Tp + (1 - (g / 1000 - lo) / Math.max(1, hi - lo)) * (H - Tp - B);
    let svg = '';
    for (let v = lo; v <= hi; v += 2) svg += `<line x1="${L}" x2="${Wd - R}" y1="${y(v * 1000)}" y2="${y(v * 1000)}" class="c-grid light"/><text x="${L - 6}" y="${y(v * 1000) + 4}" class="c-lbl" text-anchor="end">${v} kg</text>`;
    withM.ranges.forEach(([, b], k) => { if (k < withM.ranges.length - 1) svg += `<line x1="${x(b)}" x2="${x(b)}" y1="${Tp}" y2="${H - B}" class="c-grid"/><text x="${x(b) + 3}" y="${Tp + 10}" class="c-lbl tiny">${withM.ranges.length > 8 ? 'D' + (k + 1) : 'end day ' + (k + 1)}</text>`; });
    withM.drops.forEach((dr, i) => { svg += `<text x="${x(dr.d)}" y="${H - B + 14}" text-anchor="middle" class="c-lbl">📦${i + 1}</text>`; });
    withM.refills.filter(r => r.type === 'water').forEach(r => { svg += `<text x="${x(r.d)}" y="${H - B + 14}" text-anchor="middle" class="c-lbl">💧</text>`; });
    const path = (s, X) => s.map((g, i) => `${i ? 'L' : 'M'}${x(X[i]).toFixed(1)},${y(g).toFixed(1)}`).join('');
    noM.series.forEach((s, i) => { if (withM.drops.length) svg += `<path d="${path(s.load, noM.X)}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="1.5" stroke-dasharray="5 4" opacity=".55"/>`; });
    withM.series.forEach((s, i) => { svg += `<path d="${path(s.load, withM.X)}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="2.2"/>`; });
    svg += `<text x="${Wd - R}" y="${H - 4}" class="c-lbl" text-anchor="end">${kmTxt(T.total)} km</text><text x="${L}" y="${H - 4}" class="c-lbl">0 km</text>`;
    return `<svg viewBox="0 0 ${Wd} ${H}" class="chart" role="img" aria-label="Pack weight along the route">${svg}</svg>
      <div class="legend">${withM.series.map((s, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(s.person.name)} ${fmtKg(s.start, 1)} → ${fmtKg(s.load[s.load.length - 1], 1)}</span>`).join('')}
        ${withM.drops.length ? '<span>dashed = without drops</span>' : ''}</div>`;
  }

  /* Suggest a drop at each overnight camp (or vehicle access near it) for the following days' food. */
  function suggest(T) {
    const f = T.f, drops = list(f), days = tripDays().length;
    const camps = T.legs.filter((l, i) => i < T.legs.length - 1 && (l.to.kind === 'campsite' || l.to.night)).map(l => ({ d: l.to.d, name: l.to.name, day: l.day }));
    if (!camps.length) return toast('Suggestions need overnight campsites on the route (a multi-day traverse)');
    let added = 0;
    camps.forEach((cp, i) => {
      if (drops.some(dr => Math.abs(num(dr.d) - cp.d) < 500)) return;
      const v = vehicleAt(f, cp.d);
      const near = v ? (v.e.d0 <= cp.d && v.e.d1 >= cp.d ? cp.d : (Math.abs(v.e.d0 - cp.d) < Math.abs(v.e.d1 - cp.d) ? v.e.d0 : v.e.d1)) : cp.d;
      const to = i < camps.length - 1 ? camps[i + 1].day : Math.min(days, T.days);
      const hasWater = T.stops.some(s => s.kind === 'water' && Math.abs(s.d - cp.d) < 300);
      drops.push({
        id: uid(), name: `${cp.name} resupply`, d: Math.round(near), foodFrom: cp.day + 1, foodTo: Math.max(cp.day + 1, to),
        waterL: hasWater ? 0 : Math.ceil(cfg(f).camp + 2) * Store.state.people.length, // the night at camp plus the next day gearIds: [], placedBy: '', placedOn: '', notes: v ? '' : 'No vehicle access found nearby'
      });
      added++;
    });
    Store.save();
    toast(added ? `Suggested ${added} drop(s) — adjust food days and water` : 'Every overnight camp already has a drop');
  }

  /* Events from the drops card (delegated from the Traverse tab). Returns true when handled. */
  function onEvent(e, T) {
    const cardEl = e.target.closest('.drops-card');
    if (!cardEl) return false;
    const f = T.f, el = e.target;
    if (e.type === 'click') {
      const act = el.closest('button')?.dataset.drop;
      if (!act) return false;
      if (act === 'add') {
        const mid = T.stops.length > 2 ? T.stops[Math.floor(T.stops.length / 2)].d : T.total / 2;
        list(f).push({ id: uid(), name: '', d: Math.round(mid), foodFrom: '', foodTo: '', waterL: 0, gearIds: [], placedBy: '', placedOn: '', notes: '' });
      } else if (act === 'del') {
        const id = el.closest('[data-drop-id]').dataset.dropId;
        f.drops = list(f).filter(d => d.id !== id);
      } else if (act === 'suggest') suggest(T);
      Store.save();
      return true;
    }
    if (el.dataset.dc) { cfg(f)[el.dataset.dc] = num(el.value, DEFAULTS[el.dataset.dc]); Store.save(); return true; }
    const box = el.closest('[data-drop-id]');
    if (!box) return false;
    const dr = list(f).find(d => d.id === box.dataset.dropId);
    if (el.dataset.gear) {
      const ids = new Set(dr.gearIds || []);
      if (el.checked) ids.add(el.dataset.gear); else ids.delete(el.dataset.gear);
      dr.gearIds = [...ids];
    } else if (el.dataset.dk === 'at') { if (el.value !== '') dr.d = Math.round(num(el.value)); }
    else if (el.dataset.dk === 'km') dr.d = Math.round(Math.min(T.total, Math.max(0, num(el.value) * 1000)));
    else if (el.dataset.dk) dr[el.dataset.dk] = ['foodFrom', 'foodTo', 'waterL'].includes(el.dataset.dk) ? (el.value === '' ? '' : num(el.value)) : el.value;
    else return false;
    Store.save();
    return true;
  }

  /* For the Pack Weight tab: every drop on every trail. */
  function all() {
    return Store.state.map.features.filter(f => f.type === 'trail').flatMap(f => list(f).map(dr => ({
      pickupDay: num(dr.pickupDay, 1), days: dropDays(dr), gearIds: dr.gearIds || [], waterL: num(dr.waterL)
    })));
  }

  return { card, onEvent, all, model, loadChart, dropDays, mealsFor, pointAt, vehicleAt, warnings, dayAt, dayFoodPP, cfg };
})();
