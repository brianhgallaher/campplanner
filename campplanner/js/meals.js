/* Camp Planner — recipes, daily meal plan, ingredient list, equipment and food weight */

const Meals = (() => {
  const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks & drinks']];
  const slotLabel = s => (SLOTS.find(x => x[0] === s) || [s, s])[1];
  let bound = false;
  const root = () => $('#tab-meals');
  const recipe = id => Store.state.recipes.find(r => r.id === id);
  const plan = () => Store.state.mealPlan;
  /* how many to cook for: everyone with a place when registration is in use, otherwise the party on the Trip tab */
  const defaultServings = () => { const R = typeof Rego !== 'undefined' && Rego.peek ? Rego.peek() : null, n = R && R.trip.reg !== 'off' ? R.people.filter(p => !p.wait).length : 0; return Math.max(1, n || Store.state.people.length); };

  function recipePerServing(r) {
    return r.ingredients.reduce((a, i) => ({ g: a.g + num(i.weightG), kcal: a.kcal + num(i.kcal), cost: a.cost + num(i.cost) }), { g: 0, kcal: 0, cost: 0 });
  }

  /* Everything derived from the plan: ingredient totals, equipment, food weight per day. */
  function totals() {
    const ingredients = new Map(), equipment = new Map(), perDay = [];
    let weightG = 0, kcal = 0, waterMl = 0, servings = 0, cost = 0;
    tripDays().forEach(d => {
      let dw = 0, dk = 0;
      const dp = plan()[d.key] || {};
      SLOTS.forEach(([s]) => (dp[s] || []).forEach(e => {
        const r = recipe(e.recipeId);
        if (!r) return;
        const sv = num(e.servings, 1);
        servings += sv;
        r.ingredients.forEach(i => {
          if (!i.name || !i.name.trim()) return;
          const key = i.name.trim().toLowerCase() + '|' + (i.unit || '').trim().toLowerCase();
          const x = ingredients.get(key) || { key, name: i.name.trim(), unit: (i.unit || '').trim(), qty: 0, weightG: 0, cost: 0, unpriced: false, recipes: new Set() };
          x.qty += num(i.qty) * sv;
          x.weightG += num(i.weightG) * sv;
          x.cost += num(i.cost) * sv;
          if (!num(i.cost)) x.unpriced = true;
          cost += num(i.cost) * sv;
          x.recipes.add(r.name);
          ingredients.set(key, x);
          dw += num(i.weightG) * sv;
          dk += num(i.kcal) * sv;
        });
        (r.equipment || []).forEach(eq => {
          const n = eq.trim();
          if (!n) return;
          const x = equipment.get(n.toLowerCase()) || { name: n, recipes: new Set() };
          x.recipes.add(r.name);
          equipment.set(n.toLowerCase(), x);
        });
        waterMl += num(r.waterMl) * sv;
      }));
      perDay.push({ day: d, weightG: dw, kcal: dk });
      weightG += dw;
      kcal += dk;
    });
    const unpriced = [...ingredients.values()].filter(x => x.unpriced).length;
    return { ingredients, equipment, perDay, weightG, kcal, waterMl, servings, cost, unpriced };
  }

  function render() {
    if (!bound) bind();
    const st = Store.state, days = tripDays(), T = totals(), n = defaultServings();
    $('#gearNames').innerHTML = st.gear.map(g => `<option value="${esc(g.name)}">`).join('');
    root().innerHTML = `
      <div class="page-head"><h2>Meal planner</h2>
        <div class="btn-row no-print"><button class="btn primary" id="findRecipes" title="Search hiking & camping recipes and add them to this trip">📚 Recipe library</button><button class="btn" id="newRecipe">+ New recipe</button></div></div>
      <p class="muted">Add recipes to each meal — servings default to the number of people (${n}). Ingredients, equipment and food weight are worked out automatically.</p>

      <div class="card">
        <h3>Meal plan</h3>
        <div class="table-scroll"><table class="tbl plan">
          <thead><tr><th>Day</th>${SLOTS.map(s => `<th>${s[1]}</th>`).join('')}<th>Food</th></tr></thead>
          <tbody>${days.map((d, i) => `<tr>
            <th class="day-cell"><b>${d.label}</b><small>${d.date ? fmtDate(d.date) : ''}</small>
              ${i < days.length - 1 ? `<button class="icon-btn no-print" data-copy="${d.key}" title="Copy this day's meals to the next day">⧉ copy ↓</button>` : ''}</th>
            ${SLOTS.map(([s]) => cell(d.key, s)).join('')}
            <td class="num">${fmtG(T.perDay[i].weightG)}<br><small class="muted">${Math.round(T.perDay[i].kcal / n)} kcal pp</small></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="grid2">
        <div class="card">
          <div class="cat-head"><h3>Ingredients &amp; shopping list</h3><span>${fmtG(T.weightG)}</span></div>
          ${ingredientTable(T)}
        </div>
        <div class="card">
          <h3>Equipment needed to cook</h3>
          ${equipmentTable(T)}
        </div>
      </div>

      <div class="card">
        <h3>Food weight &amp; energy</h3>
        ${foodSummary(T)}
      </div>

      <div class="card no-print">
        <div class="cat-head"><h3>This trip's recipes</h3><button class="btn small" id="findRecipes2">📚 Find more recipes</button></div>
        <div class="recipe-list">${st.recipes.map(recipeCard).join('') || '<p class="muted">No recipes yet.</p>'}</div>
      </div>

      <div class="print-only">
        <h2>Recipes</h2>
        ${usedRecipes().map(r => `<div class="print-recipe"><h3>${esc(r.name)}</h3>
          <p>${r.ingredients.map(i => `${esc(i.qty)} ${esc(i.unit)} ${esc(i.name)}`).join(' · ')} <i>(per serving)</i></p>
          ${r.equipment.length ? `<p><b>Equipment:</b> ${r.equipment.map(esc).join(', ')}</p>` : ''}
          ${r.notes ? `<p>${esc(r.notes)}</p>` : ''}
          ${r.source && r.source.url ? `<p class="small muted">Adapted from ${esc(r.source.site || '')}: ${esc(r.source.url)}</p>` : ''}</div>`).join('')}
      </div>`;
  }

  function usedRecipes() {
    const ids = new Set();
    Object.values(plan()).forEach(dp => Object.values(dp).forEach(list => list.forEach(e => ids.add(e.recipeId))));
    return Store.state.recipes.filter(r => ids.has(r.id));
  }

  function cell(dayKey, slot) {
    const entries = (plan()[dayKey] || {})[slot] || [];
    const recipes = Store.state.recipes;
    const suggested = recipes.filter(r => r.slot === slot), others = recipes.filter(r => r.slot !== slot);
    const opt = r => `<option value="${r.id}">${esc(r.name)}</option>`;
    return `<td class="meal-cell">
      ${entries.map(e => {
        const r = recipe(e.recipeId);
        if (!r) return '';
        const ref = `${dayKey}|${slot}|${e.id}`;
        return `<div class="chip"><span>${esc(r.name)}</span>
          <span class="serv">× <input type="number" min="0.5" step="0.5" data-serv="${ref}" value="${num(e.servings, 1)}" title="Servings"></span>
          <button class="x no-print" data-rm="${ref}" title="Remove">✕</button></div>`;
      }).join('')}
      <select class="add-meal no-print" data-add="${dayKey}|${slot}">
        <option value="">+ add…</option>
        ${suggested.length ? `<optgroup label="${slotLabel(slot)}">${suggested.map(opt).join('')}</optgroup>` : ''}
        ${others.length ? `<optgroup label="Other recipes">${others.map(opt).join('')}</optgroup>` : ''}
      </select>
    </td>`;
  }

  function fmtQty(q) { return Math.round(q * 100) / 100; }

  function ingredientTable(T) {
    const rows = [...T.ingredients.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) return '<p class="muted">Add meals to the plan to build your shopping list.</p>';
    const sh = Store.state.shopping;
    return `<table class="tbl">
      <thead><tr><th class="c-pk">✓</th><th>Ingredient</th><th class="num">Quantity</th><th class="num">Weight</th><th class="num">Cost</th><th>Used in</th></tr></thead>
      <tbody>${rows.map(x => `<tr class="${sh[x.key] ? 'done' : ''}">
        <td class="c-pk"><input type="checkbox" data-shop="${esc(x.key)}" ${sh[x.key] ? 'checked' : ''}></td>
        <td>${esc(x.name)}</td>
        <td class="num">${x.unit === 'g' && x.qty >= 1000 ? fmtKg(x.qty) : fmtQty(x.qty) + ' ' + esc(x.unit)}</td>
        <td class="num">${fmtG(x.weightG)}</td>
        <td class="num">${x.cost ? fmtMoney(x.cost) : '<span class="muted">—</span>'}${x.unpriced && x.cost ? ' <span class="muted" title="Some recipes using this have no price">*</span>' : ''}</td>
        <td class="muted small">${[...x.recipes].map(esc).join(', ')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th></th><th>Total</th><th></th><th class="num">${fmtG(T.weightG)}</th><th class="num">${fmtMoney(T.cost)}</th><th></th></tr></tfoot>
    </table>
    ${T.unpriced ? `<p class="muted small">${T.unpriced} ingredient(s) have no price — add a “$ / serving” in the recipe editor so the Budget is complete.</p>` : ''}`;
  }

  function equipmentTable(T) {
    const rows = [...T.equipment.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) return '<p class="muted">Equipment listed on planned recipes shows here.</p>';
    const missing = rows.filter(x => !Gear.has(x.name));
    return `<table class="tbl">
      <thead><tr><th>Equipment</th><th>Needed for</th><th>Gear list</th></tr></thead>
      <tbody>${rows.map(x => {
        const g = Gear.has(x.name);
        return `<tr><td>${esc(x.name)}</td><td class="muted small">${[...x.recipes].map(esc).join(', ')}</td>
          <td>${g ? `<span class="ok">✔ ${esc(g.name)}</span>` : `<button class="btn small" data-add-gear="${esc(x.name)}">+ Add to gear</button>`}</td></tr>`;
      }).join('')}</tbody>
    </table>
    ${missing.length > 1 ? `<button class="btn small no-print" id="addAllGear">+ Add all ${missing.length} missing items to gear list</button>` : ''}`;
  }

  function foodSummary(T) {
    const n = defaultServings(), days = T.perDay.length;
    const ppDay = T.weightG / n / days, kcalDay = T.kcal / n / days;
    const flag = (v, lo, hi) => v < lo ? 'warn' : v > hi ? 'warn' : 'ok';
    return `<div class="big-stats">
        <div><b>${fmtKg(T.weightG)}</b><span>total food (group)</span></div>
        <div><b>${fmtKg(T.weightG / n)}</b><span>food per person</span></div>
        <div class="${T.weightG ? flag(ppDay, 500, 1000) : ''}"><b>${Math.round(ppDay)} g</b><span>per person per day</span></div>
        <div class="${T.kcal ? flag(kcalDay, 2000, 4500) : ''}"><b>${Math.round(kcalDay)}</b><span>kcal per person per day</span></div>
        <div><b>${(T.waterMl / 1000).toFixed(1)} L</b><span>water needed for cooking</span></div>
        <div><b>${fmtMoney(T.cost)}</b><span>food cost (${fmtMoney(T.cost / n)} per person)</span></div>
      </div>
      <p class="muted small">Guide for multi-day hiking: about 600–900 g of food and 2,500–4,000 kcal per person per day. Food weight is split evenly across the group in Pack Weight and goes down each day as it's eaten.</p>`;
  }

  function recipeCard(r) {
    const p = recipePerServing(r);
    return `<div class="recipe">
      <div><b>${esc(r.name)}</b> <span class="badge">${slotLabel(r.slot)}</span></div>
      <div class="muted small">${fmtG(p.g)} · ${Math.round(p.kcal)} kcal · ${p.cost ? fmtMoney(p.cost) : 'no price'} per serving${r.equipment.length ? ' · ' + r.equipment.map(esc).join(', ') : ''}</div>
      ${r.source && r.source.url ? `<div class="small"><a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.site || 'Source')} ↗</a></div>` : ''}
      <div class="btn-row">
        <button class="btn small" data-edit="${r.id}">Edit</button>
        <button class="btn small" data-dup="${r.id}">Duplicate</button>
        <button class="btn small danger" data-del="${r.id}">Delete</button>
      </div>
    </div>`;
  }

  function entryRef(ref) {
    const [dayKey, slot, id] = ref.split('|');
    const list = (plan()[dayKey] || {})[slot] || [];
    return { list, idx: list.findIndex(e => e.id === id) };
  }

  function bind() {
    bound = true;
    const r = root();
    r.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.add && el.value) {
        const [dayKey, slot] = el.dataset.add.split('|');
        const dp = plan()[dayKey] = plan()[dayKey] || {};
        (dp[slot] = dp[slot] || []).push({ id: uid(), recipeId: el.value, servings: defaultServings() });
        Store.save(); render();
      } else if (el.dataset.serv) {
        const { list, idx } = entryRef(el.dataset.serv);
        if (idx >= 0) list[idx].servings = Math.max(0.5, num(el.value, 1));
        Store.save(); render();
      } else if (el.dataset.shop) {
        Store.state.shopping[el.dataset.shop] = el.checked;
        el.closest('tr').classList.toggle('done', el.checked);
        Store.save();
      }
    });

    r.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const st = Store.state;
      if (b.dataset.rm) {
        const { list, idx } = entryRef(b.dataset.rm);
        if (idx >= 0) list.splice(idx, 1);
        Store.save(); render();
      } else if (b.dataset.copy) {
        const days = tripDays(), i = days.findIndex(d => d.key === b.dataset.copy);
        const src = plan()[b.dataset.copy] || {}, next = days[i + 1].key;
        plan()[next] = {};
        SLOTS.forEach(([s]) => { plan()[next][s] = (src[s] || []).map(x => ({ ...x, id: uid() })); });
        Store.save(); render();
        toast(`Copied ${days[i].label} to ${days[i + 1].label}`);
      } else if (b.id === 'findRecipes' || b.id === 'findRecipes2') RecipeBook.open();
      else if (b.id === 'newRecipe') editRecipe(null);
      else if (b.dataset.edit) editRecipe(b.dataset.edit);
      else if (b.dataset.dup) {
        const src = recipe(b.dataset.dup);
        st.recipes.push({ ...JSON.parse(JSON.stringify(src)), id: uid(), name: src.name + ' (copy)' });
        Store.save(); render();
      } else if (b.dataset.del) {
        const rec = recipe(b.dataset.del);
        if (!confirm(`Delete recipe "${rec.name}"? It will also be removed from the meal plan.`)) return;
        st.recipes = st.recipes.filter(x => x.id !== rec.id);
        Object.values(plan()).forEach(dp => Object.keys(dp).forEach(s => { dp[s] = dp[s].filter(x => x.recipeId !== rec.id); }));
        Store.save(); render();
      } else if (b.dataset.addGear) {
        Gear.add({ name: b.dataset.addGear, category: 'Kitchen' });
        toast(`Added "${b.dataset.addGear}" to gear — set its weight on the Gear tab`);
        render();
      } else if (b.id === 'addAllGear') {
        const T = totals();
        let n = 0;
        T.equipment.forEach(x => { if (!Gear.has(x.name)) { Gear.add({ name: x.name, category: 'Kitchen' }); n++; } });
        toast(`Added ${n} items to the gear list — set their weights on the Gear tab`);
        render();
      }
    });
  }

  /* ---------- recipe editor ---------- */
  function ingRow(i = {}) {
    return `<tr>
      <td><input data-k="name" value="${esc(i.name || '')}" placeholder="e.g. Rolled oats"></td>
      <td><input type="number" step="any" min="0" data-k="qty" value="${i.qty ?? ''}"></td>
      <td><input data-k="unit" value="${esc(i.unit ?? 'g')}" size="6"></td>
      <td><input type="number" step="any" min="0" data-k="weightG" value="${i.weightG ?? ''}"></td>
      <td><input type="number" step="any" min="0" data-k="kcal" value="${i.kcal ?? ''}"></td>
      <td><input type="number" step="0.01" min="0" data-k="cost" value="${i.cost ?? ''}" placeholder="0.00"></td>
      <td><button type="button" class="icon-btn" data-rm-ing title="Remove">✕</button></td></tr>`;
  }

  function editRecipe(id) {
    const r = id ? recipe(id) : { name: '', slot: 'dinner', ingredients: [{}], equipment: [], waterMl: 0, notes: '' };
    const dlg = $('#dialog');
    dlg.innerHTML = `<form class="dlg-form" id="recipeForm">
      <h3>${id ? 'Edit' : 'New'} recipe</h3>
      <div class="row">
        <label class="field grow"><span>Name</span><input name="name" required value="${esc(r.name)}"></label>
        <label class="field"><span>Usual meal</span><select name="slot">${SLOTS.map(([k, l]) => `<option value="${k}" ${k === r.slot ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <h4>Ingredients <small class="muted">— amounts for ONE serving; packed weight is what you carry</small></h4>
      <div class="table-scroll"><table class="tbl compact">
        <thead><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Packed weight (g)</th><th>kcal</th><th>$ / serving</th><th></th></tr></thead>
        <tbody id="ingRows">${r.ingredients.map(ingRow).join('')}</tbody>
      </table></div>
      <button type="button" class="btn small" id="addIng">+ Ingredient</button>
      <label class="field"><span>Equipment needed (comma separated — matched against your gear list)</span>
        <input name="equipment" value="${esc(r.equipment.join(', '))}" placeholder="Stove, Cooking pot, Spork"></label>
      <label class="field"><span>Water needed to cook (ml per serving)</span><input type="number" min="0" name="waterMl" value="${num(r.waterMl)}"></label>
      <label class="field"><span>Method / notes</span><textarea name="notes" rows="3">${esc(r.notes)}</textarea></label>
      <div class="dlg-actions">
        <button type="button" class="btn" id="dlgCancel">Cancel</button>
        <button type="submit" class="btn primary">Save recipe</button>
      </div>
    </form>`;
    const form = $('#recipeForm');
    form.addEventListener('click', e => {
      if (e.target.id === 'addIng') $('#ingRows').insertAdjacentHTML('beforeend', ingRow());
      if (e.target.closest('[data-rm-ing]')) e.target.closest('tr').remove();
      if (e.target.id === 'dlgCancel') dlg.close();
    });
    /* Weight defaults to the quantity when the unit is grams. */
    form.addEventListener('change', e => {
      const tr = e.target.closest('#ingRows tr');
      if (!tr || e.target.dataset.k !== 'qty') return;
      const unit = $('[data-k=unit]', tr).value.trim().toLowerCase(), w = $('[data-k=weightG]', tr);
      if (unit === 'g' && !w.value) w.value = e.target.value;
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(form);
      const ingredients = $$('#ingRows tr').map(tr => {
        const v = k => $(`[data-k=${k}]`, tr).value;
        const unit = v('unit').trim();
        let weightG = num(v('weightG'));
        if (!weightG && unit.toLowerCase() === 'g') weightG = num(v('qty'));
        return { name: v('name').trim(), qty: num(v('qty')), unit, weightG, kcal: num(v('kcal')), cost: num(v('cost')) };
      }).filter(i => i.name);
      const data = {
        name: fd.get('name').trim(), slot: fd.get('slot'), ingredients,
        equipment: fd.get('equipment').split(',').map(s => s.trim()).filter(Boolean),
        waterMl: num(fd.get('waterMl')), notes: fd.get('notes')
      };
      if (id) Object.assign(recipe(id), data);
      else Store.state.recipes.push({ id: uid(), ...data });
      Store.save();
      dlg.close();
      render();
    });
    dlg.showModal();
  }

  return { render, totals, usedRecipes, recipePerServing, SLOTS, slotLabel };
})();
