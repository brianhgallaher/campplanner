/* Camp Planner — gear catalogue: search products from Australian outdoor stores and add them to the gear list.
   Data: data/gear-catalog.json (built by tools/gear_catalog_build.py from the store scrapes). Loaded on first use.
   Item keys: s store, n name, b brand, c planner category, u store's own category, w weight g, p price AUD, l url, a specs */

const Catalog = (() => {
  const SRC = 'data/gear-catalog.json?v=20261114n';
  const PAGE = 60;
  const ACCESSORY = /\b(sheets?|straps?|repair|spares?|replacement|covers?|stuff sack|storage bag|pump|valve|footprint|pegs?|poles?|patch|repair kit|adaptor|adapter|pouch|cord|guy|buckle|hose|parts?)\b/;
  let data = null, loading = null;
  let st = { q: '', cat: '', brand: '', store: '', maxW: '', maxP: '', weighed: false, sort: 'best', shown: PAGE, replaceId: null };

  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) loading = fetch(SRC).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(d => {
      d.items.forEach((it, i) => {
        it.i = i;
        it.hay = [it.n, it.b, it.u, it.c, ...Object.values(it.a || {})].filter(Boolean).join(' ').toLowerCase();
        it.nl = it.n.toLowerCase();
      });
      data = d;
      return d;
    }).catch(e => { loading = null; throw e; });
    return loading;
  }

  const storeName = k => (data.stores[k] || {}).name || k;
  const fmtW = w => w == null ? '<span class="muted">—</span>' : w >= 1000 ? (w / 1000).toFixed(w >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' kg' : w + ' g';
  const fmtP = p => p == null ? '<span class="muted">—</span>' : '$' + (p % 1 ? p.toFixed(2) : p.toLocaleString());

  /* all words must match; ranked by how well the name matches */
  function search() {
    const words = st.q.toLowerCase().split(/\s+/).filter(Boolean);
    const maxW = num(st.maxW) || 0, maxP = num(st.maxP) || 0;
    const phrase = words.length > 1 ? words.join(' ') : '';
    const out = [];
    for (const it of data.items) {
      if (st.cat && it.c !== st.cat) continue;
      if (st.store && it.s !== st.store) continue;
      if (st.brand && it.b !== st.brand) continue;
      if (st.weighed && it.w == null) continue;
      if (maxW && (it.w == null || it.w > maxW)) continue;
      if (maxP && (it.p == null || it.p > maxP)) continue;
      let score = 0, ok = true;
      for (const w of words) {
        if (!it.hay.includes(w)) { ok = false; break; }
        const e = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        score += new RegExp('(^|[^a-z0-9])' + e + '(e?s)?($|[^a-z0-9])').test(it.nl) ? 5   // the whole word (or plural) in the name
          : new RegExp('(^|[^a-z0-9])' + e).test(it.nl) ? 3 : it.nl.includes(w) ? 2 : 1;
      }
      if (!ok) continue;
      if (phrase && it.nl.includes(phrase)) score += 3;                                   // the words together
      if (words.length && ACCESSORY.test(it.nl) && !ACCESSORY.test(st.q.toLowerCase())) score -= 2.5;   // the thing itself before its spares
      it.score = score + (it.w != null ? 0.5 : 0) + (it.p != null ? 0.2 : 0);
      out.push(it);
    }
    const by = {
      best: (a, b) => b.score - a.score || a.n.localeCompare(b.n),
      light: (a, b) => (a.w ?? 1e9) - (b.w ?? 1e9),
      cheap: (a, b) => (a.p ?? 1e9) - (b.p ?? 1e9),
      dear: (a, b) => (b.p ?? -1) - (a.p ?? -1),
      name: (a, b) => a.n.localeCompare(b.n),
      brand: (a, b) => (a.b || '~').localeCompare(b.b || '~') || a.n.localeCompare(b.n)
    }[st.sort];
    return out.sort(by);
  }

  /* brands / stores that still have results under the other filters, with counts */
  function facet(key, list) {
    const m = new Map();
    list.forEach(it => { const v = it[key]; if (v) m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].sort((a, b) => key === 'b' ? a[0].localeCompare(b[0]) : b[1] - a[1]);
  }
  function facetList(skip) {
    const keep = { ...st }; st[skip] = '';
    const r = search();
    Object.assign(st, keep);
    return r;
  }

  function open(opt = {}) {
    st = { ...st, q: opt.q ?? '', cat: opt.cat ?? '', brand: '', store: '', shown: PAGE, replaceId: opt.replaceId || null };
    const dlg = $('#dialog');
    dlg.classList.add('cat-dialog');
    dlg.innerHTML = `<div class="cat-wrap">
      <div class="cat-top">
        <h3>🔎 Gear catalogue</h3>
        <span class="grow"></span>
        <button type="button" class="btn small" data-c="close" title="Close (Esc)">✕</button>
      </div>
      <div class="cat-body"><p class="muted">Loading the catalogue…</p></div>
    </div>`;
    dlg.addEventListener('close', () => dlg.classList.remove('cat-dialog'), { once: true });
    if (!dlg.open) dlg.showModal();
    load().then(() => {
      if (!dlg.classList.contains('cat-dialog')) return;
      /* "find a product for this item": loosen the words until something matches */
      if (opt.loose && st.q) {
        st.q = st.q.replace(/\([^)]*\)|[&/,+]/g, ' ').replace(/\s+/g, ' ').trim();
        while (st.q && !search().length) st.q = st.q.split(' ').slice(0, -1).join(' ');
        if (!search().length) st.cat = '';
      }
      shell(dlg);
    })
      .catch(e => { dlg.querySelector('.cat-body').innerHTML = `<p class="bad">Couldn't load the gear catalogue (${esc(e.message)}).</p>`; });
    if (!dlg.dataset.catBound) bind(dlg);
  }

  function shell(dlg) {
    const repl = st.replaceId && Store.state.gear.find(g => g.id === st.replaceId);
    const stores = Object.entries(data.stores);
    dlg.querySelector('.cat-body').innerHTML = `
      ${repl ? `<p class="cat-replace">Choosing a product for <b>${esc(repl.name)}</b> — click <b>Use this</b> to copy its name, weight and price onto that gear item. <button type="button" class="btn small" data-c="unreplace">Just browse</button></p>` : ''}
      <div class="cat-filters">
        <input type="search" id="catQ" placeholder="Search — e.g. sleeping bag -5, 2 person tent, Sea to Summit mat, rain jacket" value="${esc(st.q)}" aria-label="Search the gear catalogue">
        <select id="catCat" aria-label="Category"><option value="">All categories</option>${GEAR_CATEGORIES.map(c => `<option ${c === st.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="catBrand" aria-label="Brand"></select>
        <select id="catStore" aria-label="Store"></select>
        <label class="cat-num">≤ <input type="number" id="catMaxW" min="0" step="50" placeholder="max g" value="${esc(st.maxW)}" title="Maximum weight in grams"> g</label>
        <label class="cat-num">≤ $<input type="number" id="catMaxP" min="0" step="10" placeholder="max" value="${esc(st.maxP)}" title="Maximum price"></label>
        <label class="check"><input type="checkbox" id="catWeighed" ${st.weighed ? 'checked' : ''}> Has weight</label>
        <select id="catSort" aria-label="Sort">
          ${[['best', 'Best match'], ['light', 'Lightest first'], ['cheap', 'Cheapest first'], ['dear', 'Dearest first'], ['brand', 'Brand A–Z'], ['name', 'Name A–Z']]
            .map(([k, v]) => `<option value="${k}" ${st.sort === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <button type="button" class="btn small" data-c="clear">Clear filters</button>
      </div>
      <div class="cat-count small muted" id="catCount"></div>
      <div class="cat-results" id="catResults"></div>
      <p class="small muted cat-foot">${data.items.length.toLocaleString()} products from ${stores.map(([, s]) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(', ')} · prices and weights as listed by each store on ${esc(fmtDate(data.updated))} — check the store before buying. Weights are the store's published figure (packed / trail weight where given).</p>`;
    results();
    dlg.querySelector('#catQ').focus();
  }

  function fmtDate(d) { try { return new Date(d + 'T00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d; } }

  function results() {
    const dlg = $('#dialog');
    const list = search();
    const brandSel = dlg.querySelector('#catBrand'), storeSel = dlg.querySelector('#catStore');
    const brands = facet('b', facetList('brand')), stores = facet('s', facetList('store'));
    brandSel.innerHTML = `<option value="">All brands (${brands.length})</option>` + brands.map(([b, n]) => `<option value="${esc(b)}" ${b === st.brand ? 'selected' : ''}>${esc(b)} (${n})</option>`).join('')
      + (st.brand && !brands.some(([b]) => b === st.brand) ? `<option selected value="${esc(st.brand)}">${esc(st.brand)} (0)</option>` : '');
    storeSel.innerHTML = `<option value="">All stores</option>` + stores.map(([s, n]) => `<option value="${s}" ${s === st.store ? 'selected' : ''}>${esc(storeName(s))} (${n})</option>`).join('')
      + (st.store && !stores.some(([s]) => s === st.store) ? `<option selected value="${st.store}">${esc(storeName(st.store))} (0)</option>` : '');
    const weighed = list.filter(it => it.w != null);
    dlg.querySelector('#catCount').textContent = list.length
      ? `${list.length.toLocaleString()} match${list.length === 1 ? '' : 'es'}` + (weighed.length > 1 ? ` · ${weighed.length} with a weight, ${fmtWText(Math.min(...weighed.map(i => i.w)))}–${fmtWText(Math.max(...weighed.map(i => i.w)))}` : '')
      : '';
    const repl = !!st.replaceId;
    dlg.querySelector('#catResults').innerHTML = !list.length ? '<p class="muted cat-none">No products match. Try fewer words or clear a filter.</p>' : `
      <table class="tbl cat-tbl">
        <thead><tr><th>Product</th><th>Store</th><th class="num">Weight</th><th class="num">Price</th><th></th></tr></thead>
        <tbody>${list.slice(0, st.shown).map(it => `<tr data-i="${it.i}">
          <td><a href="${esc(it.l)}" target="_blank" rel="noopener" class="cat-name">${esc(it.n)}</a>
            <div class="cat-meta">${it.b ? `<button type="button" class="chip" data-brand="${esc(it.b)}" title="Only ${esc(it.b)}">${esc(it.b)}</button>` : ''}
              <span class="muted">${esc(it.c)}${it.u && it.u !== it.c ? ' › ' + esc(it.u) : ''}</span>
              ${Object.entries(it.a || {}).map(([k, v]) => `<span class="spec" title="${esc(k)}">${esc(v)}</span>`).join('')}</div></td>
          <td class="nowrap">${esc(storeName(it.s))}</td>
          <td class="num nowrap">${fmtW(it.w)}</td>
          <td class="num nowrap">${fmtP(it.p)}</td>
          <td class="nowrap cat-act">${repl
            ? `<button type="button" class="btn small primary" data-add="use">Use this</button>`
            : `<button type="button" class="btn small primary" data-add="own" title="Add to the gear list (already owned)">+ Add</button>
               <button type="button" class="btn small" data-add="buy" title="Add to the gear list as an item to buy — its price goes to the Budget">+ To buy</button>`}</td>
        </tr>`).join('')}</tbody>
      </table>
      ${list.length > st.shown ? `<div class="cat-more"><button type="button" class="btn" data-c="more">Show more (${(list.length - st.shown).toLocaleString()} left)</button></div>` : ''}`;
  }
  const fmtWText = w => w >= 1000 ? (w / 1000).toFixed(2).replace(/\.?0+$/, '') + ' kg' : w + ' g';

  function addItem(it, how) {
    const notes = [it.b && !it.n.toLowerCase().includes(it.b.toLowerCase()) ? it.b : '', storeName(it.s)].filter(Boolean).join(' · ');
    if (how === 'use') {
      const g = Store.state.gear.find(x => x.id === st.replaceId);
      if (!g) return;
      Object.assign(g, { name: it.n, weightG: it.w != null ? it.w : g.weightG, url: it.l, notes: g.notes || notes });
      if (GEAR_CATEGORIES.includes(it.c) && g.category === 'Other') g.category = it.c;
      if (g.source === 'buy' && it.p != null) g.cost = it.p;
      Store.save();
      $('#dialog').close();
      toast(`Updated “${it.n}”${it.w != null ? ` — ${fmtWText(it.w)}` : ''}`);
      Gear.render();
      return;
    }
    Gear.add({ name: it.n, category: it.c, weightG: it.w || 0, qty: 1, type: guessType(it), notes, url: it.l,
      source: how === 'buy' ? 'buy' : 'own', cost: how === 'buy' ? it.p || 0 : 0 });
    toast(`Added “${it.n}”${it.w == null ? ' — no published weight, enter it on the gear list' : ''}`);
    Gear.render();
  }
  /* clothes and boots are usually worn; fuel, sunscreen etc. are used up */
  function guessType(it) {
    const n = it.n.toLowerCase();
    if (/\b(fuel|gas canister|canister|sunscreen|repellent|wipes|meal|tablets)\b/.test(n)) return 'consumable';
    if (it.c === 'Footwear' && !/\b(sandal|camp shoe|thong|slide|gaiter|insole)/.test(n)) return 'worn';
    if (/\btrekking pole|hiking pole/.test(n)) return 'worn';
    return 'base';
  }

  function bind(dlg) {
    dlg.dataset.catBound = '1';
    let t = null;
    const rerun = () => { st.shown = PAGE; results(); };
    dlg.addEventListener('input', e => {
      if (!dlg.classList.contains('cat-dialog')) return;
      const id = e.target.id;
      if (id === 'catQ') { st.q = e.target.value; clearTimeout(t); t = setTimeout(rerun, 150); }
      else if (id === 'catMaxW') { st.maxW = e.target.value; clearTimeout(t); t = setTimeout(rerun, 250); }
      else if (id === 'catMaxP') { st.maxP = e.target.value; clearTimeout(t); t = setTimeout(rerun, 250); }
    });
    dlg.addEventListener('change', e => {
      if (!dlg.classList.contains('cat-dialog')) return;
      const map = { catCat: 'cat', catBrand: 'brand', catStore: 'store', catSort: 'sort' };
      if (map[e.target.id]) { st[map[e.target.id]] = e.target.value; rerun(); }
      else if (e.target.id === 'catWeighed') { st.weighed = e.target.checked; rerun(); }
    });
    dlg.addEventListener('click', e => {
      if (!dlg.classList.contains('cat-dialog')) return;
      const c = e.target.closest('[data-c]')?.dataset.c;
      if (c === 'close') return dlg.close();
      if (c === 'more') { st.shown += PAGE * 2; return results(); }
      if (c === 'clear') { Object.assign(st, { q: '', cat: '', brand: '', store: '', maxW: '', maxP: '', weighed: false, sort: 'best', shown: PAGE }); return shell(dlg); }
      if (c === 'unreplace') { st.replaceId = null; return shell(dlg); }
      const br = e.target.closest('[data-brand]');
      if (br) { st.brand = br.dataset.brand; return rerun(); }
      const add = e.target.closest('[data-add]');
      if (add) {
        const it = data.items[+add.closest('tr').dataset.i];
        addItem(it, add.dataset.add);
        if (add.dataset.add !== 'use') { add.textContent = '✓ Added'; add.disabled = true; }
      }
    });
  }

  return { open, load };
})();
