/* Camp Planner — recipe library: search hiking & camping recipes collected from Australian and overseas sites
   and copy them into the trip's recipes. Data: data/recipe-library.json (built by tools/recipe_library_build.py).
   Each recipe is in the planner's own format (quantities per serving) plus tags, prepMin and source {site,title,url}. */

const RecipeBook = (() => {
  const SRC = 'data/recipe-library.json?v=20261113c';
  const PAGE = 40;
  let data = null, loading = null;
  let st = { q: '', slot: '', tag: '', site: '', maxW: '', sort: 'best', shown: PAGE, open: null };

  const per = r => r.ingredients.reduce((a, i) => ({ g: a.g + num(i.weightG), kcal: a.kcal + num(i.kcal), cost: a.cost + num(i.cost) }), { g: 0, kcal: 0, cost: 0 });

  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) loading = fetch(SRC).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(d => {
      d.recipes.forEach((r, i) => {
        r.i = i;
        r.p = per(r);
        r.nl = r.name.toLowerCase();
        r.hay = [r.name, ...(r.tags || []), ...r.ingredients.map(x => x.name), (r.source || {}).site, Meals.slotLabel(r.slot)].join(' ').toLowerCase();
      });
      data = d;
      return d;
    }).catch(e => { loading = null; throw e; });
    return loading;
  }

  const inTrip = r => Store.state.recipes.some(x => (x.source && r.source && x.source.url === r.source.url && x.name === r.name) || x.name.toLowerCase() === r.nl);

  function search() {
    const words = st.q.toLowerCase().split(/\s+/).filter(Boolean), maxW = num(st.maxW) || 0;
    const out = [];
    for (const r of data.recipes) {
      if (st.slot && r.slot !== st.slot) continue;
      if (st.tag && !(r.tags || []).includes(st.tag)) continue;
      if (st.site && (r.source || {}).site !== st.site) continue;
      if (maxW && r.p.g > maxW) continue;
      let score = 0, ok = true;
      for (const w of words) {
        if (!r.hay.includes(w)) { ok = false; break; }
        score += r.nl.includes(w) ? 3 : 1;
      }
      if (!ok) continue;
      r.score = score;
      out.push(r);
    }
    const dens = r => r.p.g ? r.p.kcal / r.p.g : 0;
    const by = {
      best: (a, b) => b.score - a.score || a.name.localeCompare(b.name),
      light: (a, b) => a.p.g - b.p.g,
      kcal: (a, b) => b.p.kcal - a.p.kcal,
      dense: (a, b) => dens(b) - dens(a),
      cheap: (a, b) => (a.p.cost || 1e9) - (b.p.cost || 1e9),
      quick: (a, b) => (a.prepMin ?? 1e9) - (b.prepMin ?? 1e9),
      name: (a, b) => a.name.localeCompare(b.name)
    }[st.sort];
    return out.sort(by);
  }

  function open(opt = {}) {
    st = { ...st, q: opt.q ?? st.q, slot: opt.slot ?? st.slot, shown: PAGE, open: null };
    const dlg = $('#dialog');
    dlg.classList.add('cat-dialog', 'rb-dialog');
    dlg.innerHTML = `<div class="cat-wrap">
      <div class="cat-top"><h3>📚 Recipe library</h3><span class="grow"></span>
        <button type="button" class="btn small" data-r="close" title="Close (Esc)">✕</button></div>
      <div class="cat-body"><p class="muted">Loading recipes…</p></div></div>`;
    dlg.addEventListener('close', () => dlg.classList.remove('cat-dialog', 'rb-dialog'), { once: true });
    if (!dlg.open) dlg.showModal();
    load().then(() => { if (dlg.classList.contains('rb-dialog')) shell(dlg); })
      .catch(e => { dlg.querySelector('.cat-body').innerHTML = `<p class="bad">Couldn't load the recipe library (${esc(e.message)}).</p>`; });
    if (!dlg.dataset.rbBound) bind(dlg);
  }

  function shell(dlg) {
    const tags = [...new Set(data.recipes.flatMap(r => r.tags || []))].sort();
    const sites = [...new Set(data.recipes.map(r => (r.source || {}).site).filter(Boolean))].sort();
    dlg.querySelector('.cat-body').innerHTML = `
      <div class="cat-filters">
        <input type="search" id="rbQ" placeholder="Search recipes or ingredients — e.g. curry, couscous, porridge, no-cook" value="${esc(st.q)}" aria-label="Search recipes">
        <select id="rbSlot" aria-label="Meal"><option value="">All meals</option>${Meals.SLOTS.map(([k, l]) => `<option value="${k}" ${k === st.slot ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="rbTag" aria-label="Type"><option value="">Any type</option>${tags.map(t => `<option ${t === st.tag ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <select id="rbSite" aria-label="Source"><option value="">All sources</option>${sites.map(s => `<option ${s === st.site ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <label class="cat-num">≤ <input type="number" id="rbMaxW" min="0" step="50" placeholder="max g" value="${esc(st.maxW)}" title="Maximum packed weight per serving"> g / serve</label>
        <select id="rbSort" aria-label="Sort">${[['best', 'Best match'], ['light', 'Lightest first'], ['kcal', 'Most energy'], ['dense', 'Most kcal per gram'], ['cheap', 'Cheapest first'], ['quick', 'Quickest at camp'], ['name', 'Name A–Z']]
          .map(([k, v]) => `<option value="${k}" ${k === st.sort ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button type="button" class="btn small" data-r="clear">Clear filters</button>
      </div>
      <div class="cat-count small muted" id="rbCount"></div>
      <div class="cat-results" id="rbResults"></div>
      <p class="small muted cat-foot">${data.recipes.length} recipes from ${sites.map(esc).join(', ')}. Quantities are per serving; weights, energy and costs are estimates — adjust them in the recipe editor. Follow the source link for the full original method.</p>`;
    results();
    dlg.querySelector('#rbQ').focus();
  }

  function results() {
    const dlg = $('#dialog'), list = search();
    dlg.querySelector('#rbCount').textContent = `${list.length} recipe${list.length === 1 ? '' : 's'}`;
    dlg.querySelector('#rbResults').innerHTML = !list.length ? '<p class="muted cat-none">No recipes match. Try fewer words or clear a filter.</p>'
      : list.slice(0, st.shown).map(card).join('')
        + (list.length > st.shown ? `<div class="cat-more"><button type="button" class="btn" data-r="more">Show more (${list.length - st.shown} left)</button></div>` : '');
  }

  function card(r) {
    const have = inTrip(r), isOpen = st.open === r.i;
    return `<div class="rb-card ${isOpen ? 'open' : ''}" data-i="${r.i}">
      <div class="rb-head">
        <button type="button" class="rb-title" data-r="toggle" aria-expanded="${isOpen}">${isOpen ? '▾' : '▸'} <b>${esc(r.name)}</b></button>
        <span class="badge">${esc(Meals.slotLabel(r.slot))}</span>
        <span class="muted small">${fmtG(r.p.g)} · ${Math.round(r.p.kcal)} kcal${r.p.cost ? ' · ' + fmtMoney(r.p.cost) : ''}${r.waterMl ? ` · ${r.waterMl} ml water` : ''}${r.prepMin ? ` · ${r.prepMin} min` : ''} <i>per serve</i></span>
        <span class="grow"></span>
        ${have ? '<span class="ok small">✓ in this trip</span>' : `<button type="button" class="btn small primary" data-r="add">+ Add to trip</button>`}
      </div>
      <div class="cat-meta">${(r.tags || []).map(t => `<button type="button" class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
        ${r.source ? `<a class="small" href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.site)} ↗</a>` : ''}</div>
      ${isOpen ? `<div class="rb-body">
        <table class="tbl compact"><thead><tr><th>Ingredient (per serve)</th><th class="num">Qty</th><th class="num">Weight</th><th class="num">kcal</th></tr></thead>
          <tbody>${r.ingredients.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${esc(i.qty)} ${esc(i.unit)}</td><td class="num">${fmtG(num(i.weightG))}</td><td class="num">${Math.round(num(i.kcal))}</td></tr>`).join('')}</tbody></table>
        ${r.equipment && r.equipment.length ? `<p class="small"><b>Equipment:</b> ${r.equipment.map(esc).join(', ')}</p>` : ''}
        ${r.notes ? `<p class="small">${esc(r.notes)}</p>` : ''}
        ${r.source ? `<p class="small muted">Adapted from <a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.title || r.name)}</a> — ${esc(r.source.site)}.</p>` : ''}
      </div>` : ''}
    </div>`;
  }

  function add(r) {
    const copy = JSON.parse(JSON.stringify({ name: r.name, slot: r.slot, waterMl: r.waterMl || 0, ingredients: r.ingredients, equipment: r.equipment || [], notes: r.notes || '', source: r.source, tags: r.tags || [] }));
    Store.state.recipes.push({ id: uid(), ...copy });
    Store.save();
    toast(`Added “${r.name}” to this trip's recipes — pick it in the meal plan`);
    Meals.render();
  }

  function bind(dlg) {
    dlg.dataset.rbBound = '1';
    let t = null;
    const rerun = () => { st.shown = PAGE; results(); };
    dlg.addEventListener('input', e => {
      if (!dlg.classList.contains('rb-dialog')) return;
      if (e.target.id === 'rbQ') { st.q = e.target.value; clearTimeout(t); t = setTimeout(rerun, 150); }
      if (e.target.id === 'rbMaxW') { st.maxW = e.target.value; clearTimeout(t); t = setTimeout(rerun, 250); }
    });
    dlg.addEventListener('change', e => {
      if (!dlg.classList.contains('rb-dialog')) return;
      const map = { rbSlot: 'slot', rbTag: 'tag', rbSite: 'site', rbSort: 'sort' };
      if (map[e.target.id]) { st[map[e.target.id]] = e.target.value; rerun(); }
    });
    dlg.addEventListener('click', e => {
      if (!dlg.classList.contains('rb-dialog')) return;
      const tag = e.target.closest('[data-tag]');
      if (tag) { st.tag = tag.dataset.tag; dlg.querySelector('#rbTag').value = st.tag; return rerun(); }
      const a = e.target.closest('[data-r]')?.dataset.r;
      if (!a) return;
      if (a === 'close') return dlg.close();
      if (a === 'more') { st.shown += PAGE; return results(); }
      if (a === 'clear') { Object.assign(st, { q: '', slot: '', tag: '', site: '', maxW: '', sort: 'best', shown: PAGE }); return shell(dlg); }
      const r = data.recipes[+e.target.closest('[data-i]').dataset.i];
      if (a === 'toggle') { st.open = st.open === r.i ? null : r.i; return results(); }
      if (a === 'add') { add(r); results(); }
    });
  }

  return { open, load };
})();
