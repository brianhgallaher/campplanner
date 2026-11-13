/* Camp Planner — pack weight: per-person base, consumables, food, water, worn */

const Weight = (() => {
  let bound = false;
  const root = () => $('#tab-weight');
  const SEG = [['base', 'Base gear', '#262661'], ['food', 'Food', '#e8590c'], ['water', 'Water', '#1c7ed6'], ['cons', 'Other consumables', '#f2a93b']];
  const COLOR = Object.fromEntries(SEG.map(([k, , c]) => [k, c]));
  const LABEL = Object.fromEntries(SEG.map(([k, l]) => [k, l]));
  /* A bar split into the same colours as the pack bar: parts = { base, cons, food, water } in grams */
  const stackBar = (parts, widthPct) => {
    const segs = SEG.map(([k]) => [k, parts[k] || 0]).filter(([, v]) => v > 0);
    return `<div class="bar bar-stack" style="width:${widthPct}%">${segs.map(([k, v]) =>
      `<i style="flex:${v};background:${COLOR[k]}" title="${LABEL[k]}: ${fmtG(v)}"></i>`).join('')}</div>`;
  };

  /* Weight each person carries. Shared ("group") gear and food are split evenly.
     Food and gear left in food drops aren't carried until the drop is collected (raw = ignore drops). */
  function compute(raw) {
    const st = Store.state, people = st.people, n = Math.max(1, people.length);
    const meals = Meals.totals();
    const drops = raw ? [] : Drops.all();
    const dropped = new Set(drops.flatMap(d => d.days));
    const pickupOf = id => Math.min(...drops.filter(d => d.gearIds.includes(id)).map(d => d.pickupDay));
    const res = people.map(p => ({
      person: p, base: 0, worn: 0, cons: 0, water: num(p.waterL) * 1000, cats: {}, catParts: {}, items: [], moved: [], drops,
      food: meals.perDay.reduce((s, d, i) => s + (dropped.has(i + 1) ? 0 : d.weightG), 0) / n,
      foodAll: meals.weightG / n,
      foodByDay: meals.perDay.map(d => d.weightG / n)
    }));
    const byId = Object.fromEntries(res.map(r => [r.person.id, r]));
    for (const g of st.gear) {
      const w = num(g.weightG) * num(g.qty, 1);
      const targets = byId[g.carrier] ? [[byId[g.carrier], 1]] : res.map(r => [r, 1 / n]);
      for (const [r, f] of targets) {
        const x = w * f;
        if (drops.some(d => d.gearIds.includes(g.id))) { r.moved.push({ day: pickupOf(g.id), w: x }); continue; }
        const k = g.type === 'worn' ? 'worn' : g.type === 'consumable' ? 'cons' : 'base';
        r[k] += x;
        if (k !== 'worn') {
          const cat = g.category || 'Other';
          r.cats[cat] = (r.cats[cat] || 0) + x;
          r.catParts[cat] = r.catParts[cat] || {};
          r.catParts[cat][k] = (r.catParts[cat][k] || 0) + x;
        }
        r.items.push({ g, w: x, shared: f < 1 });
      }
    }
    res.forEach(r => {
      r.pack = r.base + r.cons + r.food + r.water;
      r.skinOut = r.pack + r.worn;
      r.pct = num(r.person.bodyKg) ? r.pack / (num(r.person.bodyKg) * 1000) * 100 : null;
      /* food and water from the meal plan / water carried keep their own colours (added to any gear filed under the same name) */
      if (r.food) { r.cats['Food'] = (r.cats['Food'] || 0) + r.food; r.catParts['Food'] = { ...(r.catParts['Food'] || {}), food: r.food }; }
      if (r.water) { r.cats['Water'] = (r.cats['Water'] || 0) + r.water; r.catParts['Water'] = { ...(r.catParts['Water'] || {}), water: r.water }; }
    });
    return res;
  }

  function baseClass(g) {
    if (g < 4500) return ['Ultralight', 'ok'];
    if (g < 9000) return ['Lightweight', 'ok'];
    if (g < 13600) return ['Traditional', 'warn'];
    return ['Heavy', 'bad'];
  }
  function pctClass(p) { return p == null ? '' : p <= 20 ? 'ok' : p <= 25 ? 'warn' : 'bad'; }

  function render() {
    if (!bound) bind();
    const res = compute(), days = tripDays();
    const group = res.reduce((s, r) => s + r.pack, 0);
    root().innerHTML = `
      <div class="page-head"><h2>Pack weight</h2></div>
      <p class="muted">Worked out from your <a href="#gear" data-goto="gear">gear list</a>, <a href="#meals" data-goto="meals">meal plan</a> and water carried. Aim for a pack at or under <b>20% of body weight</b> for multi-day hikes (about 10% for day walks).</p>
      ${res.map(personCard).join('')}
      ${res.length > 1 ? `<div class="card"><h3>Group total</h3><div class="big-stats">
        <div><b>${fmtKg(group)}</b><span>all packs combined</span></div>
        ${res.map(r => `<div><b>${fmtKg(r.pack)}</b><span>${esc(r.person.name)}</span></div>`).join('')}
      </div><p class="muted small">Unbalanced? Move shared items to a specific person on the Gear tab using “Carried by”.</p></div>` : ''}
      ${days.length > 1 ? byDayCard(res, days) : ''}
      ${heaviestCard(res)}`;
  }

  function personCard(r) {
    const [cls, ccls] = baseClass(r.base);
    const segs = SEG.map(([k, l, c]) => ({ k, l, c, v: r[k] })).filter(s => s.v > 0);
    const cats = Object.entries(r.cats).sort((a, b) => b[1] - a[1]);
    const maxCat = cats.length ? cats[0][1] : 1;
    return `<div class="card person-card">
      <div class="cat-head"><h3>${esc(r.person.name)}</h3>
        ${r.pct != null ? `<span class="badge ${pctClass(r.pct)}">${r.pct.toFixed(1)}% of body weight (${num(r.person.bodyKg)} kg)</span>` : ''}</div>
      <div class="big-stats">
        <div class="hero ${pctClass(r.pct)}"><b>${fmtKg(r.pack)}</b><span>pack weight at start${r.drops.length ? ` — ${fmtKg(r.foodAll - r.food + r.moved.reduce((s, m) => s + m.w, 0))} left in <a href="#traverse" data-goto="traverse">drops</a>` : ''}</span></div>
        <div class="${ccls}"><b>${fmtKg(r.base)}</b><span>base weight · ${cls}</span></div>
        <div><b>${fmtKg(r.food)}</b><span>food</span></div>
        <div><b>${fmtKg(r.water)}</b><span>water (${num(r.person.waterL)} L)</span></div>
        <div><b>${fmtKg(r.cons)}</b><span>other consumables</span></div>
        <div><b>${fmtKg(r.worn)}</b><span>worn / carried</span></div>
        <div><b>${fmtKg(r.skinOut)}</b><span>total skin-out</span></div>
      </div>
      ${r.pack ? `<div class="stackbar">${segs.map(s => `<div style="width:${s.v / r.pack * 100}%;background:${s.c}" title="${s.l}: ${fmtKg(s.v)}"></div>`).join('')}</div>
      <div class="legend">${segs.map(s => `<span><i style="background:${s.c}"></i>${s.l} ${fmtKg(s.v)} (${Math.round(s.v / r.pack * 100)}%)</span>`).join('')}</div>` : ''}
      <div class="row wrap">
        <div class="grow">
          <h4>Pack breakdown by category</h4>
          ${cats.length ? `<table class="tbl bars">${cats.map(([c, v]) => `<tr><td>${esc(c)}</td>
            <td class="bar-cell">${stackBar(r.catParts[c] || { base: v }, v / maxCat * 100)}</td><td class="num">${fmtG(v)}</td></tr>`).join('')}</table>
            <p class="muted small">Bar colours match the pack bar above: ${SEG.map(([k, l]) => `<span class="key-dot" style="background:${COLOR[k]}"></span>${l.toLowerCase()}`).join(' · ')}.</p>`
            : '<p class="muted">Nothing in this pack yet.</p>'}
        </div>
        <div class="no-print water-adj">
          <label class="field"><span>Water carried (L)</span><input type="number" min="0" step="0.25" data-water="${r.person.id}" value="${num(r.person.waterL)}"></label>
          <label class="field"><span>Body weight (kg)</span><input type="number" min="0" step="0.5" data-body="${r.person.id}" value="${num(r.person.bodyKg)}"></label>
        </div>
      </div>
    </div>`;
  }

  /* Pack gets lighter each day as food is eaten. */
  function byDayCard(res, days) {
    return `<div class="card"><h3>Pack weight by day</h3>
      <p class="muted small">Weight at the start of each day, as food is eaten (water assumed refilled daily)${res[0]?.drops.length ? ', including food and gear collected from food drops' : ''}. See the Traverse tab for weight along the route and the water plan.</p>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Day</th>${res.map(r => `<th class="num">${esc(r.person.name)}</th>`).join('')}</tr></thead>
        <tbody>${days.map((d, i) => `<tr><td>${d.label} <small class="muted">${d.date ? fmtDate(d.date) : ''}</small></td>
          ${res.map(r => {
            /* at the start of day i+1: food still to eat, less food waiting in drops not yet collected; plus gear already collected */
            const waiting = new Set(r.drops.filter(d => d.pickupDay >= i + 1).flatMap(d => d.days));
            const food = r.foodByDay.reduce((s, v, k) => s + (k >= i && !waiting.has(k + 1) ? v : 0), 0);
            const gear = r.moved.filter(m => m.day < i + 1).reduce((s, m) => s + m.w, 0);
            return `<td class="num">${fmtKg(r.base + r.cons + r.water + food + gear)}</td>`;
          }).join('')}</tr>`).join('')}</tbody>
      </table></div></div>`;
  }

  function heaviestCard(res) {
    const all = res.flatMap(r => r.items.filter(i => i.g.type !== 'worn').map(i => ({ ...i, who: r.person.name })));
    const merged = new Map();
    all.forEach(i => {
      const m = merged.get(i.g.id) || { g: i.g, w: 0, who: i.shared ? 'Group' : i.who };
      m.w += i.w;
      merged.set(i.g.id, m);
    });
    const top = [...merged.values()].sort((a, b) => b.w - a.w).slice(0, 10);
    if (!top.length) return '';
    const tips = [];
    const maxBase = Math.max(...res.map(r => r.base));
    if (maxBase > 9000) tips.push('Base weight over 9 kg — the “big three” (pack, shelter, sleep system) usually offer the biggest savings.');
    if (res.some(r => r.water > 3000)) tips.push('Carrying more than 3 L of water — check water sources on your route and carry less between refills.');
    if (res.some(r => r.pct != null && r.pct > 20)) tips.push('A pack over 20% of body weight increases fatigue and injury risk — share group gear or cut extras.');
    return `<div class="card"><h3>Heaviest items</h3>
      <table class="tbl bars">${top.map(i => `<tr><td>${esc(i.g.name)} <small class="muted">${esc(i.who)}</small></td>
        <td class="bar-cell">${stackBar({ [i.g.type === 'consumable' ? 'cons' : 'base']: i.w }, i.w / top[0].w * 100)}</td><td class="num">${fmtG(i.w)}</td></tr>`).join('')}</table>
      ${tips.length ? `<h4>Ways to save weight</h4><ul>${tips.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function bind() {
    bound = true;
    root().addEventListener('change', e => {
      const id = e.target.dataset.water || e.target.dataset.body;
      if (!id) return;
      const p = Store.state.people.find(p => p.id === id);
      p[e.target.dataset.water ? 'waterL' : 'bodyKg'] = num(e.target.value);
      Store.save();
      render();
    });
  }

  return { render, compute, baseClass, pctClass, SEG, personCard, byDayCard, heaviestCard };
})();
