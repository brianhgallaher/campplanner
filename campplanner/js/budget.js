/* Camp Planner — budget: fuel (from Travel), food (from Meals), camp fees and other costs, split between the group */

const Budget = (() => {
  const CATS = ['Accommodation', 'Shuttle / transport', 'Park passes & permits', 'Extra food & drinks', 'Activities', 'Other'];
  const BOOKING = {
    NSW: ['NSW National Parks — camping & park entry fees', 'https://www.nationalparks.nsw.gov.au/camping-and-accommodation'],
    VIC: ['Parks Victoria — campsite bookings', 'https://www.parks.vic.gov.au/'],
    QLD: ['Queensland National Parks — camping permits', 'https://parks.qld.gov.au/camping'],
    SA: ['National Parks SA — bookings & park passes', 'https://www.parks.sa.gov.au/'],
    WA: ['Explore Parks WA — bookings & passes', 'https://exploreparks.dbca.wa.gov.au/'],
    TAS: ['Tasmania Parks — park passes & bookings', 'https://parks.tas.gov.au/'],
    NT: ['NT Parks — camping fees & bookings', 'https://nt.gov.au/parks'],
    ACT: ['ACT Parks — campground bookings', 'https://www.parks.act.gov.au/']
  };
  let bound = false;
  const root = () => $('#tab-budget');
  const B = () => Store.state.budget;

  function counts() {
    const days = tripDays().length;
    return { people: Store.state.people.length, days, nights: Math.max(0, days - 1), vehicles: Math.max(1, Store.state.travel.cars.length) };
  }
  const blank = v => v === '' || v == null;
  function feeUnits(f, c = counts()) {
    if (!blank(f.units)) return num(f.units);
    return { pppn: c.people, site: 1, vpd: c.vehicles, vpn: c.vehicles, flat: 1 }[f.type] ?? 1;
  }
  function feeNights(f, c = counts()) {
    if (f.type === 'flat') return 1;
    if (!blank(f.nights)) return num(f.nights);
    return f.type === 'vpd' ? c.days : c.nights;
  }
  const feeTotal = f => num(f.rate) * feeUnits(f) * feeNights(f);

  /* Every cost line: { cat, name, amount, payer } */
  function lines() {
    const out = [], tc = Travel.costs(), meals = Meals.totals(), b = B();
    tc.cars.forEach(c => out.push({ cat: 'Fuel', name: `${c.name} — ${Math.round(c.km)} km, ${c.amount.toFixed(1)} ${c.unit}`, amount: c.cost, payer: c.payer || '' }));
    if (tc.shuttle) out.push({ cat: 'Fuel', name: 'Shuttle / taxi (finish → start)', amount: tc.shuttle, payer: b.shuttlePaidBy || '' });
    out.push({ cat: 'Food', name: `Meal plan ingredients (${meals.servings} servings)`, amount: meals.cost, payer: b.foodPaidBy || '' });
    Gear.costs().forEach(g => out.push({ cat: 'Gear', name: `${g.name} (${g.source === 'hire' ? 'hire' : 'buy'})`, amount: g.amount, payer: g.payer }));
    b.fees.forEach(f => out.push({ cat: 'Camp fees', name: f.name || 'Camp fee', amount: feeTotal(f), payer: f.paidBy || '' }));
    b.items.forEach(i => out.push({ cat: i.cat || 'Other', name: i.name || i.cat, amount: num(i.amount), payer: i.paidBy || '' }));
    return { out, tc, meals };
  }

  function totals() {
    const { out } = lines();
    const total = out.reduce((s, l) => s + l.amount, 0);
    return { total, perPerson: total / Math.max(1, Store.state.people.length) };
  }

  /* Equal split: who has paid what, and the fewest transfers to square up. */
  function settle(out) {
    const people = Store.state.people;
    const assigned = out.filter(l => l.payer && people.some(p => p.id === l.payer));
    const total = assigned.reduce((s, l) => s + l.amount, 0), share = total / Math.max(1, people.length);
    const bal = people.map(p => ({ p, paid: assigned.filter(l => l.payer === p.id).reduce((s, l) => s + l.amount, 0) }))
      .map(x => ({ ...x, net: x.paid - share }));
    const cred = bal.filter(x => x.net > 0.005).map(x => ({ ...x })).sort((a, b) => b.net - a.net);
    const debt = bal.filter(x => x.net < -0.005).map(x => ({ ...x, net: -x.net })).sort((a, b) => b.net - a.net);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const amt = Math.min(debt[i].net, cred[j].net);
      transfers.push([debt[i].p, cred[j].p, amt]);
      debt[i].net -= amt; cred[j].net -= amt;
      if (debt[i].net < 0.005) i++;
      if (cred[j].net < 0.005) j++;
    }
    return { bal, share, transfers, unassigned: out.filter(l => !l.payer).reduce((s, l) => s + l.amount, 0) };
  }

  const payerSelect = (attrs, sel) => `<select ${attrs}><option value="">— who pays? —</option>${Store.state.people.map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;

  function render() {
    if (!bound) bind();
    const b = B(), c = counts(), { out, tc, meals } = lines();
    const total = out.reduce((s, l) => s + l.amount, 0), pp = total / Math.max(1, c.people);
    const byCat = {};
    out.forEach(l => { const k = ['Fuel', 'Food', 'Camp fees', 'Gear'].includes(l.cat) ? l.cat : 'Other costs'; byCat[k] = (byCat[k] || 0) + l.amount; });
    const gear = Gear.costs();
    const S = settle(out);
    const target = num(b.targetPP);
    const book = BOOKING[Store.state.trip.state];
    root().innerHTML = `
      <div class="page-head"><h2>Budget — ${esc(Store.state.trip.name)}</h2></div>
      <div class="card">
        <div class="big-stats">
          <div class="hero"><b>${fmtMoney(total)}</b><span>trip total</span></div>
          <div class="hero ${target ? (pp <= target ? 'ok' : 'bad') : ''}"><b>${fmtMoney(pp)}</b><span>per person (${c.people} ${c.people === 1 ? 'person' : 'people'})</span></div>
          ${['Fuel', 'Food', 'Camp fees', 'Gear', 'Other costs'].map(k => `<div><b>${fmtMoney(byCat[k] || 0)}</b><span>${{ Fuel: 'fuel & transport', Gear: 'gear hire & buy' }[k] || k.toLowerCase()}</span></div>`).join('')}
        </div>
        ${total ? `<div class="stackbar">${['Fuel', 'Food', 'Camp fees', 'Gear', 'Other costs'].map((k, i) => byCat[k] ? `<div style="width:${byCat[k] / total * 100}%;background:${['#1c7ed6', '#e8590c', '#2b8a3e', '#7048e8', '#868e96'][i]}" title="${k}: ${fmtMoney(byCat[k])}"></div>` : '').join('')}</div>` : ''}
        <div class="row no-print">
          <label class="field"><span>Budget per person ($, optional)</span><input type="number" min="0" step="10" data-b="targetPP" value="${target || ''}" placeholder="e.g. 150"></label>
          ${target ? `<p class="${pp <= target ? 'ok' : 'bad-text'}" style="align-self:center">${pp <= target ? `✔ ${fmtMoney(target - pp)} under budget per person` : `⚠ ${fmtMoney(pp - target)} over budget per person`}</p>` : ''}
        </div>
      </div>

      <div class="grid2">
        <div class="card">
          <div class="cat-head"><h3>⛽ Fuel &amp; transport</h3><span>${fmtMoney(byCat.Fuel || 0)}</span></div>
          ${tc.cars.length ? `<table class="tbl"><thead><tr><th>Car</th><th class="num">Driving</th><th class="num">Fuel</th><th class="num">Cost</th><th>Paid by</th></tr></thead><tbody>
            ${tc.cars.map(car => `<tr><td>${esc(car.name)}</td><td class="num">${car.complete ? Math.round(car.km) + ' km' : '…'}</td><td class="num">${car.amount.toFixed(1)} ${car.unit}</td>
              <td class="num">${fmtMoney(car.cost)}</td><td>${esc(car.payer ? personName(car.payer) : '— set driver —')}</td></tr>`).join('')}
            ${tc.shuttle ? `<tr><td>Shuttle / taxi</td><td></td><td></td><td class="num">${fmtMoney(tc.shuttle)}</td><td>${payerSelect('data-b="shuttlePaidBy"', b.shuttlePaidBy)}</td></tr>` : ''}
            </tbody></table>${tc.pending ? '<p class="small muted">Calculating driving distances…</p>' : ''}`
            : '<p class="muted">Add cars on the <a href="#travel" data-goto="travel">Travel</a> tab to work out fuel.</p>'}
          <p class="small muted">Fuel is paid by each car's driver. Change cars, fuel type, economy and prices on the <a href="#travel" data-goto="travel">Travel</a> tab.</p>
        </div>
        <div class="card">
          <div class="cat-head"><h3>🍳 Food</h3><span>${fmtMoney(meals.cost)}</span></div>
          <table class="kv">
            <tr><th>Meal plan</th><td>${meals.servings} servings · ${fmtMoney(meals.cost)} · ${fmtMoney(meals.cost / Math.max(1, c.people))} per person · ${fmtMoney(meals.cost / Math.max(1, c.people) / Math.max(1, c.days))} per person per day</td></tr>
            <tr><th>Bought by</th><td>${payerSelect('data-b="foodPaidBy"', b.foodPaidBy)}</td></tr>
          </table>
          ${meals.unpriced ? `<p class="small warn-text">⚠ ${meals.unpriced} ingredient(s) have no price — add a “$ / serving” in the <a href="#meals" data-goto="meals">recipe editor</a>.</p>` : ''}
          <p class="small muted">Costs come from the “$ / serving” of each recipe ingredient × planned servings. Add takeaway or drinks on the road under Other costs.</p>
        </div>
      </div>

      <div class="card">
        <div class="cat-head"><h3>⛺ Camp fees</h3><span>${fmtMoney(byCat['Camp fees'] || 0)}</span></div>
        ${b.fees.length ? `<div class="table-scroll"><table class="tbl fees">
          <thead><tr><th>Campground / park</th><th>Charged</th><th class="num">Rate $</th><th class="num">× Count</th><th class="num">× Nights / days</th><th class="num">Total</th><th>Booking ref</th><th class="c-pk">Paid</th><th>Paid by</th><th class="no-print"></th></tr></thead>
          <tbody>${b.fees.map(f => `<tr data-fee="${f.id}" class="${f.paid ? 'done' : ''}">
            <td><input data-f="name" value="${esc(f.name)}"></td>
            <td><select data-f="type">${Object.entries(FEE_TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></td>
            <td class="num"><input type="number" min="0" step="0.05" class="w-md" data-f="rate" value="${num(f.rate) || ''}" placeholder="0.00"></td>
            <td class="num"><input type="number" min="0" step="1" class="w-sm" data-f="units" value="${blank(f.units) ? '' : num(f.units)}" placeholder="${feeUnits({ ...f, units: '' })}"></td>
            <td class="num">${f.type === 'flat' ? '—' : `<input type="number" min="0" step="1" class="w-sm" data-f="nights" value="${blank(f.nights) ? '' : num(f.nights)}" placeholder="${feeNights({ ...f, nights: '' })}">`}</td>
            <td class="num"><b>${fmtMoney(feeTotal(f))}</b></td>
            <td><input data-f="ref" value="${esc(f.ref || '')}" class="w-md" placeholder="—"></td>
            <td class="c-pk"><input type="checkbox" data-f="paid" ${f.paid ? 'checked' : ''}></td>
            <td>${payerSelect('data-f="paidBy"', f.paidBy)}</td>
            <td class="no-print"><button class="icon-btn" data-fee-del="${f.id}" title="Remove">🗑</button></td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted">No camp fees yet.</p>'}
        <div class="btn-row no-print">
          <button class="btn small" id="feesFromMap">⛺ Add campsites from the map</button>
          <button class="btn small" id="feeEntry">🚗 Add park vehicle entry</button>
          <button class="btn small" id="feeBlank">+ Other fee</button>
        </div>
        <p class="small muted">Leave Count / Nights blank to use the trip: ${c.people} people, ${c.vehicles} vehicle${c.vehicles > 1 ? 's' : ''}, ${c.nights} night${c.nights === 1 ? '' : 's'}, ${c.days} days.
          ${book ? `Check current fees: <a href="${book[1]}" target="_blank" rel="noopener">${book[0]}</a>.` : ''} An annual park pass can be cheaper than daily vehicle entry for regular visitors.</p>
      </div>

      <div class="card">
        <div class="cat-head"><h3>🎒 Gear hire &amp; purchases</h3><span>${fmtMoney(byCat.Gear || 0)}</span></div>
        ${gear.length ? `<table class="tbl"><thead><tr><th>Item</th><th>Hire / buy</th><th class="num">Rate</th><th class="num">Qty</th><th class="num">Total</th><th>Paid by</th></tr></thead><tbody>
          ${gear.map(g => `<tr><td>${esc(g.name)}</td><td>${g.source === 'hire' ? 'Hire' : 'Buy'}</td>
            <td class="num">${fmtMoney(g.rate)}${g.source === 'hire' && g.basis === 'day' ? ` /day × ${c.days}` : ''}</td><td class="num">${g.qty}</td>
            <td class="num"><b>${fmtMoney(g.amount)}</b></td><td>${payerSelect(`data-g="${g.id}"`, g.payer)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">Nothing to hire or buy. On the <a href="#gear" data-goto="gear">Gear</a> tab, set the source of an item to <b>Hire</b> or <b>Buy</b> and enter its cost (per trip or per day).</p>'}
      </div>

      <div class="card">
        <div class="cat-head"><h3>🧾 Other costs</h3><span>${fmtMoney(byCat['Other costs'] || 0)}</span></div>
        ${b.items.length ? `<table class="tbl"><thead><tr><th>Category</th><th>Description</th><th class="num">Amount $</th><th>Paid by</th><th class="no-print"></th></tr></thead><tbody>
          ${b.items.map(i => `<tr data-item="${i.id}">
            <td><select data-i="cat">${CATS.map(k => `<option ${i.cat === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
            <td><input data-i="name" value="${esc(i.name || '')}" placeholder="e.g. Ferry, gas canisters, campground showers"></td>
            <td class="num"><input type="number" min="0" step="0.5" class="w-md" data-i="amount" value="${num(i.amount) || ''}"></td>
            <td>${payerSelect('data-i="paidBy"', i.paidBy)}</td>
            <td class="no-print"><button class="icon-btn" data-item-del="${i.id}" title="Remove">🗑</button></td></tr>`).join('')}
        </tbody></table>` : ''}
        <button class="btn small no-print" id="itemAdd">+ Add cost</button>
      </div>

      <div class="card">
        <h3>🤝 Settle up <small class="muted">— costs shared equally</small></h3>
        ${c.people < 2 ? '<p class="muted">Add more people on the Trip tab to split costs.</p>' : `
        <table class="tbl"><thead><tr><th>Person</th><th class="num">Paid</th><th class="num">Share</th><th class="num">Balance</th></tr></thead><tbody>
          ${S.bal.map(x => `<tr><td>${esc(x.p.name)}</td><td class="num">${fmtMoney(x.paid)}</td><td class="num">${fmtMoney(S.share)}</td>
            <td class="num ${x.net >= 0 ? 'ok' : 'bad-text'}">${x.net >= 0 ? 'gets back ' : 'owes '}${fmtMoney(Math.abs(x.net))}</td></tr>`).join('')}
        </tbody></table>
        ${S.transfers.length ? `<ul class="transfers">${S.transfers.map(([from, to, amt]) => `<li>💸 <b>${esc(from.name)}</b> pays <b>${esc(to.name)}</b> ${fmtMoney(amt)}</li>`).join('')}</ul>` : '<p class="ok">✔ All square.</p>'}
        ${S.unassigned ? `<p class="small warn-text">⚠ ${fmtMoney(S.unassigned)} has no payer yet and isn't included — choose who pays above.</p>` : ''}`}
      </div>`;
    if (tc.pending) Travel.ensure(() => { if (App.current === 'budget') render(); });
  }

  function addFee(f) {
    B().fees.push({ id: uid(), name: '', type: 'pppn', rate: 0, units: '', nights: '', ref: '', paid: false, paidBy: '', ...f });
  }

  function bind() {
    bound = true;
    const r = root();
    r.addEventListener('change', e => {
      const el = e.target, b = B();
      if (el.dataset.b) b[el.dataset.b] = el.dataset.b === 'targetPP' ? num(el.value) : el.value;
      else if (el.dataset.g) {
        const g = Store.state.gear.find(x => x.id === el.dataset.g);
        if (g) g.paidBy = el.value;
      } else if (el.dataset.f) {
        const f = b.fees.find(x => x.id === el.closest('[data-fee]').dataset.fee), k = el.dataset.f;
        f[k] = k === 'paid' ? el.checked : k === 'rate' ? num(el.value) : (k === 'units' || k === 'nights') ? (el.value === '' ? '' : num(el.value)) : el.value;
      } else if (el.dataset.i) {
        const it = b.items.find(x => x.id === el.closest('[data-item]').dataset.item);
        it[el.dataset.i] = el.dataset.i === 'amount' ? num(el.value) : el.value;
      } else return;
      Store.save();
      render();
    });
    r.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const b = B(), st = Store.state;
      if (btn.id === 'feesFromMap') {
        const camps = st.map.features.filter(f => f.type === 'landmark' && f.kind === 'campsite');
        const names = camps.map(f => f.name);
        if (st.trip.lat != null && !camps.length) names.push(st.trip.location || 'Camp');
        const fresh = [...new Set(names)].filter(n => !b.fees.some(f => f.name === n));
        if (!fresh.length) return toast(names.length ? 'Those campsites are already listed' : 'Add campsite landmarks on the map first');
        fresh.forEach(n => addFee({ name: n, type: 'pppn', nights: fresh.length > 1 ? 1 : '' }));
        toast(`Added ${fresh.length} campsite fee(s) — enter each rate from the booking site`);
      } else if (btn.id === 'feeEntry') {
        addFee({ name: (st.trip.park ? `${st.trip.park.name} ${st.trip.park.type}` : 'National park') + ' — vehicle entry', type: 'vpd' });
      } else if (btn.id === 'feeBlank') addFee({});
      else if (btn.dataset.feeDel) b.fees = b.fees.filter(f => f.id !== btn.dataset.feeDel);
      else if (btn.id === 'itemAdd') b.items.push({ id: uid(), cat: 'Other', name: '', amount: 0, paidBy: '' });
      else if (btn.dataset.itemDel) b.items = b.items.filter(i => i.id !== btn.dataset.itemDel);
      else return;
      Store.save();
      render();
    });
  }

  return { render, totals, lines, settle, counts, feeUnits, feeNights, feeTotal };
})();
