/* Camp Planner — gear list / packing checklist */

const Gear = (() => {
  const TYPES = { base: 'Base (in pack)', worn: 'Worn / carried', consumable: 'Consumable' };
  const SOURCES = { own: 'Own', hire: 'Hire', buy: 'Buy', borrow: 'Borrow' };
  const BASIS = { trip: 'per trip', day: 'per day' };
  let bound = false, filter = 'all';
  const root = () => $('#tab-gear');
  const G = () => Store.state.gear;
  const defaultCarrier = () => Store.state.people.length === 1 ? Store.state.people[0].id : 'group';
  const itemTotal = g => num(g.weightG) * num(g.qty, 1);
  /* Hire or purchase cost of an item: rate × quantity × (trip days when hired per day). */
  const costOf = g => (g.source === 'hire' || g.source === 'buy')
    ? num(g.cost) * num(g.qty, 1) * (g.source === 'hire' && g.costBasis === 'day' ? tripDays().length : 1) : 0;

  function carrierOptions(sel) {
    return `<option value="group" ${sel === 'group' ? 'selected' : ''}>Group (shared)</option>` +
      Store.state.people.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }
  const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  const catOpts = sel => GEAR_CATEGORIES.concat(sel && !GEAR_CATEGORIES.includes(sel) ? [sel] : [])
    .map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');

  /* Find a gear item matching an equipment name from a recipe (loose match). */
  function has(name) {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    return G().find(g => g.name.toLowerCase() === n) ||
      G().find(g => { const m = g.name.toLowerCase(); return m.includes(n) || n.includes(m); }) || null;
  }

  function add(item) {
    G().push({
      id: uid(), name: item.name, category: item.category || 'Other', weightG: num(item.weightG), qty: num(item.qty, 1),
      type: item.type || 'base', carrier: item.carrier || defaultCarrier(), packed: false, notes: item.notes || '',
      source: item.source || 'own', cost: num(item.cost), costBasis: item.costBasis || 'trip', paidBy: '',
      ...(item.url ? { url: item.url } : {})
    });
    Store.save();
  }

  function render() {
    if (!bound) bind();
    const people = Store.state.people;
    const items = G().filter(g => filter === 'all' || g.carrier === filter);
    const cats = [...new Set([...GEAR_CATEGORIES, ...items.map(g => g.category)])].filter(c => items.some(g => g.category === c));
    const total = items.filter(g => g.type !== 'worn').reduce((s, g) => s + itemTotal(g), 0);
    const worn = items.filter(g => g.type === 'worn').reduce((s, g) => s + itemTotal(g), 0);
    const packed = items.filter(g => g.packed).length;
    const hireCost = items.reduce((s, g) => s + costOf(g), 0);
    const hired = items.filter(g => g.source === 'hire').length, toBuy = items.filter(g => g.source === 'buy').length;

    root().innerHTML = `
      <div class="page-head"><h2>Gear list</h2>
        <div class="btn-row no-print">
          <select id="gearFilter">
            <option value="all">Everyone</option>
            <option value="group" ${filter === 'group' ? 'selected' : ''}>Shared group gear</option>
            ${people.map(p => `<option value="${p.id}" ${filter === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
          <button class="btn primary" id="gearCatalog" title="Search products from Australian outdoor stores — weights and prices">🔎 Gear catalogue</button>
          <button class="btn" id="gearStarter">Load starter list</button>
          <button class="btn" id="gearUnpack">Untick all</button>
        </div></div>
      <div class="big-stats">
        <div><b>${items.length}</b><span>items</span></div>
        <div class="${packed === items.length && items.length ? 'ok' : ''}"><b>${packed} / ${items.length}</b><span>packed</span></div>
        <div><b>${fmtKg(total)}</b><span>in packs (excl. food &amp; water)</span></div>
        <div><b>${fmtKg(worn)}</b><span>worn / carried</span></div>
        <div><b>${fmtMoney(hireCost)}</b><span>${hired} to hire, ${toBuy} to buy — <a href="#budget" data-goto="budget">budget</a></span></div>
      </div>

      <form class="card add-row no-print" id="gearAdd">
        <input name="name" placeholder="Item name" required>
        <select name="category">${catOpts('Other')}</select>
        <input name="weightG" type="number" min="0" step="any" placeholder="Weight (g)">
        <input name="qty" type="number" min="1" step="1" value="1" title="Quantity">
        <select name="type">${opts(TYPES, 'base')}</select>
        <select name="carrier">${carrierOptions(filter !== 'all' ? filter : defaultCarrier())}</select>
        <select name="source" title="Own, hire, buy or borrow">${opts(SOURCES, 'own')}</select>
        <input name="cost" type="number" min="0" step="0.5" placeholder="Cost $" title="Hire or purchase cost">
        <button class="btn primary">+ Add</button>
      </form>

      ${items.length ? '' : `<div class="card empty"><p>No gear yet. Add items above, or <button class="btn small" id="gearStarter2">load a starter list</button> of typical hiking gear with average weights you can adjust, or pick real products from the <button class="btn small" id="gearCatalog2">🔎 gear catalogue</button>.</p></div>`}
      ${cats.map(cat => {
        const list = items.filter(g => g.category === cat);
        const sub = list.filter(g => g.type !== 'worn').reduce((s, g) => s + itemTotal(g), 0);
        return `<div class="card gear-cat">
          <div class="cat-head"><h3>${esc(cat)}</h3><span>${fmtG(sub)}</span></div>
          <div class="table-scroll"><table class="tbl gear">
            <thead><tr><th class="c-pk">✓</th><th>Item</th><th class="num">Qty</th><th class="num">Each (g)</th><th class="num">Total</th><th>Type</th><th>Carried by</th><th>Source &amp; cost</th><th class="no-print">Category</th><th>Notes</th><th class="no-print"></th></tr></thead>
            <tbody>${list.map(row).join('')}</tbody>
          </table></div></div>`;
      }).join('')}
      <p class="muted small">Weigh your own gear with kitchen scales for accurate pack weights. <b>Base</b> = always in your pack. <b>Worn</b> = clothes, boots, poles (not counted in pack weight). <b>Consumable</b> = used up during the trip (fuel, sunscreen). Shared group gear is split evenly between people. Mark items to <b>hire</b> or <b>buy</b> with their cost and they're added to the Budget. Tip: some NSW National Parks offices and police stations lend PLBs free of charge.</p>`;
  }

  function row(g) {
    return `<tr data-id="${g.id}" class="${g.packed ? 'done' : ''}">
      <td class="c-pk"><input type="checkbox" data-k="packed" ${g.packed ? 'checked' : ''}></td>
      <td class="gear-name"><input data-k="name" value="${esc(g.name)}">${g.url ? `<a class="gear-link no-print" href="${esc(g.url)}" target="_blank" rel="noopener" title="Open the product page">↗</a>` : ''}<button class="icon-btn no-print" data-find title="Find a product for this item in the gear catalogue (real weights and prices)">🔎</button></td>
      <td class="num"><input type="number" min="0" step="1" data-k="qty" value="${num(g.qty, 1)}" class="w-sm"></td>
      <td class="num"><input type="number" min="0" step="any" data-k="weightG" value="${num(g.weightG)}" class="w-md"></td>
      <td class="num">${fmtG(itemTotal(g))}</td>
      <td><select data-k="type">${opts(TYPES, g.type)}</select></td>
      <td><select data-k="carrier">${carrierOptions(g.carrier)}</select></td>
      <td class="source-cell"><select data-k="source">${opts(SOURCES, g.source || 'own')}</select>
        ${g.source === 'hire' || g.source === 'buy' ? `<span class="cost-in">$<input type="number" min="0" step="0.5" data-k="cost" value="${num(g.cost) || ''}" class="w-sm" placeholder="0">
          ${g.source === 'hire' ? `<select data-k="costBasis">${opts(BASIS, g.costBasis || 'trip')}</select>` : ''}</span>
          ${costOf(g) ? `<small class="muted">= ${fmtMoney(costOf(g))}</small>` : ''}` : ''}</td>
      <td class="no-print"><select data-k="category">${catOpts(g.category)}</select></td>
      <td><input data-k="notes" value="${esc(g.notes || '')}" placeholder="—"></td>
      <td class="no-print"><button class="icon-btn" data-del title="Delete">🗑</button></td>
    </tr>`;
  }

  function loadStarter() {
    const people = Store.state.people;
    let n = 0;
    GEAR_STARTER.forEach(s => {
      const carriers = s.per === 'person' ? people.map(p => p.id) : ['group'];
      carriers.forEach(c => {
        if (G().some(g => g.name.toLowerCase() === s.name.toLowerCase() && (g.carrier === c || people.length === 1))) return;
        add({ ...s, carrier: people.length === 1 ? people[0].id : c });
        n++;
      });
    });
    toast(`Added ${n} items with typical weights — adjust them to your own gear`);
    render();
  }

  function bind() {
    bound = true;
    const r = root();
    r.addEventListener('change', e => {
      const el = e.target;
      if (el.id === 'gearFilter') { filter = el.value; render(); return; }
      const tr = el.closest('tr[data-id]');
      if (!tr || !el.dataset.k) return;
      const g = G().find(x => x.id === tr.dataset.id);
      const k = el.dataset.k;
      g[k] = k === 'packed' ? el.checked : (k === 'qty' || k === 'weightG' || k === 'cost') ? num(el.value) : el.value;
      Store.save();
      if (k === 'packed') { tr.classList.toggle('done', el.checked); render(); }
      else if (k !== 'notes' && k !== 'name') render();
    });
    r.addEventListener('submit', e => {
      if (e.target.id !== 'gearAdd') return;
      e.preventDefault();
      const fd = new FormData(e.target);
      add(Object.fromEntries(fd));
      render();
      $('#gearAdd [name=name]').focus();
    });
    r.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'gearStarter' || b.id === 'gearStarter2') loadStarter();
      else if (b.id === 'gearCatalog' || b.id === 'gearCatalog2') Catalog.open();
      else if (b.hasAttribute('data-find')) {
        const g = G().find(x => x.id === b.closest('tr').dataset.id);
        Catalog.open({ q: g.name, cat: GEAR_CATEGORIES.includes(g.category) && g.category !== 'Other' ? g.category : '', replaceId: g.id, loose: true });
      }
      else if (b.id === 'gearUnpack') { G().forEach(g => { g.packed = false; }); Store.save(); render(); }
      else if (b.hasAttribute('data-del')) {
        const id = b.closest('tr').dataset.id;
        Store.state.gear = G().filter(g => g.id !== id);
        Store.save(); render();
      }
    });
  }

  /* For the budget: items to hire or buy. Paid by the chosen payer, else the person carrying it. */
  function costs() {
    return G().filter(g => costOf(g) > 0).map(g => ({
      id: g.id, name: g.name, source: g.source, basis: g.costBasis, rate: num(g.cost), qty: num(g.qty, 1), amount: costOf(g),
      payer: g.paidBy || (g.carrier !== 'group' ? g.carrier : '')
    }));
  }

  return { render, has, add, costs, costOf, TYPES, SOURCES };
})();
