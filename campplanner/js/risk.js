/* Camp Planner — location risk assessment and emergency information */

const Risk = (() => {
  const LIKELIHOOD = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
  const CONSEQUENCE = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];
  const EMERGENCY = [
    ['number', 'Emergency number', '000 (112 from mobiles)'],
    ['hospital', 'Nearest hospital / medical centre', 'Name, address, phone, drive time'],
    ['ranger', 'Park / ranger office', 'Phone number'],
    ['police', 'Local police station', 'Phone number'],
    ['reception', 'Nearest mobile reception', 'Where you can get signal'],
    ['plb', 'PLB / satellite messenger', 'Who carries it, AMSA registration (beacons.amsa.gov.au)'],
    ['contact', 'Emergency contact at home', 'Name & phone — has a copy of this plan'],
    ['returnBy', 'Raise the alarm if not back by', 'Date & time'],
    ['evac', 'Evacuation route / exit points', 'Nearest road access, alternate exits'],
    ['medical', 'Group medical conditions & allergies', 'e.g. asthma, anaphylaxis — where medication is kept'],
    ['firstAider', 'First aider(s)', 'Names, qualifications']
  ];
  let bound = false;
  const root = () => $('#tab-risk');
  const R = () => Store.state.risks;

  const score = (l, c) => num(l, 1) * num(c, 1);
  function rating(l, c) {
    const s = score(l, c);
    if (s >= 15) return ['Extreme', 'ext'];
    if (s >= 10) return ['High', 'high'];
    if (s >= 5) return ['Medium', 'med'];
    return ['Low', 'low'];
  }
  const badge = (l, c) => { const [t, cls] = rating(l, c); return `<span class="risk ${cls}">${t} <small>${score(l, c)}</small></span>`; };
  const lcSelect = (k, v, labels) => `<select data-k="${k}">${labels.map((l, i) => `<option value="${i + 1}" ${num(v) === i + 1 ? 'selected' : ''}>${i + 1} ${l}</option>`).join('')}</select>`;

  function add(p) {
    R().push({
      id: uid(), hazard: p.hazard || '', cause: p.cause || '', location: p.location || '', mapId: p.mapId,
      l: p.l || 3, c: p.c || 3, controls: p.controls || '', rl: p.rl || p.l || 2, rc: p.rc || p.c || 3, owner: p.owner || ''
    });
    Store.save();
  }

  function render() {
    if (!bound) bind();
    const em = Store.state.emergency;
    const sorted = R().slice().sort((a, b) => score(b.l, b.c) - score(a.l, a.c));
    root().innerHTML = `
      <div class="page-head"><h2>Risk assessment — ${esc(Store.state.trip.location || Store.state.trip.name)}</h2>
        <div class="btn-row no-print">
          <select id="riskPreset"><option value="">Add a common hazard…</option>
            ${HAZARD_PRESETS.map((h, i) => `<option value="${i}" ${R().some(r => r.hazard === h.hazard) ? 'disabled' : ''}>${esc(h.hazard)}</option>`).join('')}</select>
          <button class="btn" id="riskBlank">+ Blank risk</button>
          <button class="btn" id="riskFromMap" title="Create risks from Hazard and River crossing landmarks on your map">⚠️ From map hazards</button>
        </div></div>

      <div class="grid2">
        <div class="card">
          <h3>Risk matrix</h3>
          ${matrix()}
        </div>
        <div class="card">
          <h3>Summary</h3>
          ${R().length ? `<table class="tbl"><thead><tr><th>Rating</th><th class="num">Before controls</th><th class="num">After controls</th></tr></thead><tbody>
            ${[['Extreme', 'ext'], ['High', 'high'], ['Medium', 'med'], ['Low', 'low']].map(([t, cls]) => `<tr><td><span class="risk ${cls}">${t}</span></td>
              <td class="num">${R().filter(r => rating(r.l, r.c)[0] === t).length}</td><td class="num">${R().filter(r => rating(r.rl, r.rc)[0] === t).length}</td></tr>`).join('')}
          </tbody></table>
          ${R().some(r => score(r.rl, r.rc) >= 15) ? '<p class="bad-text">⚠ Some risks remain <b>Extreme</b> after controls — reconsider the trip, route or timing.</p>' : ''}`
          : '<p class="muted">No risks recorded yet. Add common hazards for your location from the list above, or add your own.</p>'}
          <p class="muted small">Rating = likelihood × consequence. Low 1–4 · Medium 5–9 · High 10–14 · Extreme 15–25.</p>
        </div>
      </div>

      <div class="card">
        <h3>Hazards &amp; controls</h3>
        ${sorted.length ? `<div class="table-scroll"><table class="tbl risk-tbl">
          <thead><tr><th>Hazard &amp; cause</th><th>Location</th><th>Likelihood</th><th>Consequence</th><th>Risk</th><th>Controls</th><th>Residual L</th><th>Residual C</th><th>Residual</th><th>Who</th><th class="no-print"></th></tr></thead>
          <tbody>${sorted.map(row).join('')}</tbody></table></div>` : '<p class="muted">—</p>'}
      </div>

      <div class="card">
        <h3>Emergency information</h3>
        ${campLine()}
        <div class="au-numbers">
          <span><b>000</b> Police, fire, ambulance</span><span><b>112</b> from mobiles (no coverage / no SIM)</span>
          <span><b>132 500</b> SES (flood &amp; storm)</span><span><b>131 444</b> Police Assistance Line</span>
          <span><b>13 11 26</b> Poisons Information</span><span><b>1800 022 222</b> healthdirect</span>
          <span>📱 Install the <b>Emergency+</b> app — it reads out your GPS location to 000</span>
        </div>
        <div class="btn-row no-print" style="margin:8px 0">
          <button class="btn small" data-find="hospital">🔍 Find nearest hospital</button>
          <button class="btn small" data-find="police">🔍 Find nearest police station</button>
          <span class="muted small" id="findStatus"></span>
        </div>
        <div class="em-grid">${EMERGENCY.map(([k, l, ph]) => `<label class="field"><span>${l}</span>
          <input data-em="${k}" value="${esc(em[k] ?? (k === 'number' ? '000' : ''))}" placeholder="${esc(ph)}"></label>`).join('')}</div>
      </div>

      <div class="card">
        <h3>Sign-off</h3>
        <div class="row">
          <label class="field grow"><span>Assessed by</span><input data-em="assessedBy" value="${esc(em.assessedBy || '')}"></label>
          <label class="field"><span>Date</span><input type="date" data-em="assessedOn" value="${esc(em.assessedOn || isoDate(new Date()))}"></label>
          <label class="field grow"><span>Reviewed by</span><input data-em="reviewedBy" value="${esc(em.reviewedBy || '')}"></label>
        </div>
      </div>`;
    $$('textarea', root()).forEach(autoGrow);
  }

  function campLine() {
    const t = Store.state.trip;
    if (t.lat == null) return '<p class="muted small">Set the camp location on the Trip tab to show its grid reference here.</p>';
    return `<p class="camp-loc">⛺ Camp location to give 000: <b>${Geo.grText(t.lat, t.lon)}</b> · ${Geo.mgaText(t.lat, t.lon)} · lat ${t.lat.toFixed(5)}, long ${t.lon.toFixed(5)}
      ${t.park ? ` · ${esc(t.park.name)} ${esc(t.park.type)}` : ''}${t.location ? ` · near ${esc(t.location)}` : ''}</p>`;
  }

  /* Nearest hospital (with an emergency department where tagged) or police station, via OpenStreetMap. */
  async function findNearest(what) {
    const t = Store.state.trip, st = $('#findStatus');
    if (t.lat == null) return toast('Set the camp location first');
    st.textContent = 'Searching…';
    try {
      let list = await Parks.nearest(t.lat, t.lon, what);
      if (what === 'hospital') {
        list = list.filter(p => p.tags.emergency !== 'no');
        const pub = list.filter(p => !/private/i.test(p.name)); // private hospitals rarely have an emergency department
        if (pub.length) list = pub;
      }
      if (!list.length) { st.textContent = 'None found within 150 km.'; return; }
      const p = list[0];
      const phone = p.tags.phone || p.tags['contact:phone'] || '';
      const addr = [p.tags['addr:street'] && [p.tags['addr:housenumber'], p.tags['addr:street']].filter(Boolean).join(' '), p.tags['addr:suburb'] || p.tags['addr:city']].filter(Boolean).join(', ');
      Store.state.emergency[what] = [p.name, addr, phone, `${p.km.toFixed(0)} km straight-line, ${Geo.grText(p.lat, p.lng)}`].filter(Boolean).join(' · ');
      Store.save();
      render();
      toast(`Nearest ${what}: ${p.name} (${p.src}) — check it has the services you need`);
    } catch (e) { st.textContent = 'Search failed — are you online?'; }
  }

  function row(r) {
    return `<tr data-id="${r.id}">
      <td><input data-k="hazard" value="${esc(r.hazard)}" placeholder="Hazard"><textarea data-k="cause" rows="1" placeholder="Cause / description">${esc(r.cause)}</textarea></td>
      <td><textarea data-k="location" rows="1" placeholder="Where">${esc(r.location)}</textarea></td>
      <td>${lcSelect('l', r.l, LIKELIHOOD)}</td>
      <td>${lcSelect('c', r.c, CONSEQUENCE)}</td>
      <td>${badge(r.l, r.c)}</td>
      <td class="controls"><textarea data-k="controls" rows="2" placeholder="What you'll do to reduce the risk">${esc(r.controls)}</textarea></td>
      <td>${lcSelect('rl', r.rl, LIKELIHOOD)}</td>
      <td>${lcSelect('rc', r.rc, CONSEQUENCE)}</td>
      <td>${badge(r.rl, r.rc)}</td>
      <td><input data-k="owner" value="${esc(r.owner)}" placeholder="Name" class="w-md"></td>
      <td class="no-print"><button class="icon-btn" data-del title="Delete">🗑</button></td>
    </tr>`;
  }

  function matrix() {
    const cell = (l, c) => {
      const n = R().filter(r => num(r.rl) === l && num(r.rc) === c).length;
      const b = R().filter(r => num(r.l) === l && num(r.c) === c).length;
      return `<td class="risk-cell ${rating(l, c)[1]}" title="${LIKELIHOOD[l - 1]} × ${CONSEQUENCE[c - 1]}">${n ? `<b>${n}</b>` : ''}${b ? `<small>(${b})</small>` : ''}</td>`;
    };
    return `<table class="matrix"><thead><tr><th>Likelihood ↓ / Consequence →</th>${CONSEQUENCE.map((c, i) => `<th>${i + 1}<br><small>${c}</small></th>`).join('')}</tr></thead>
      <tbody>${[5, 4, 3, 2, 1].map(l => `<tr><th>${l} <small>${LIKELIHOOD[l - 1]}</small></th>${[1, 2, 3, 4, 5].map(c => cell(l, c)).join('')}</tr>`).join('')}</tbody></table>
      <p class="muted small">Bold = number of risks after controls; (brackets) = before controls.</p>`;
  }

  function autoGrow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }

  function bind() {
    bound = true;
    const r = root();
    r.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') autoGrow(e.target); });
    r.addEventListener('change', e => {
      const el = e.target;
      if (el.id === 'riskPreset' && el.value !== '') {
        add(HAZARD_PRESETS[+el.value]);
        render();
        return;
      }
      if (el.dataset.em) { Store.state.emergency[el.dataset.em] = el.value; Store.save(); return; }
      const tr = el.closest('tr[data-id]');
      if (!tr || !el.dataset.k) return;
      const risk = R().find(x => x.id === tr.dataset.id);
      const k = el.dataset.k;
      risk[k] = ['l', 'c', 'rl', 'rc'].includes(k) ? num(el.value) : el.value;
      Store.save();
      if (['l', 'c', 'rl', 'rc'].includes(k)) render();
    });
    r.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.find) findNearest(b.dataset.find);
      else if (b.id === 'riskBlank') { add({}); render(); }
      else if (b.id === 'riskFromMap') fromMap();
      else if (b.hasAttribute('data-del')) {
        const id = b.closest('tr').dataset.id;
        Store.state.risks = R().filter(x => x.id !== id);
        Store.save(); render();
      }
    });
  }

  /* ---------- risks from map landmarks ---------- */
  /* Words in a landmark's name or notes that suggest a hazard, and the preset that suits it */
  const HAZARD_WORDS = [
    [/cross|ford|creek|river|flood|wade|waterfall|causeway/i, 'Flash flooding', 'crossing'],
    [/tide|headland|rock platform|rock shelf/i, 'Tidal cut-off', 'danger'],
    [/surf|rip|swim|beach/i, 'Rips / surf', 'danger'],
    [/cliff|edge|drop|ledge|lookout|scramble|exposed|ladder/i, 'Falls from height', 'danger'],
    [/steep|scree|loose|slip|rock ?fall|erosion|wash ?out|landslip|mud|boulder/i, 'Slips, trips', 'danger'],
    [/fire|burn/i, 'Bushfire', 'danger'],
    [/snake/i, 'Snake bite', 'danger'],
    [/tree|branch|limb/i, 'Falling trees', 'danger'],
    [/hazard|danger|caution|warning|care|unsafe|risk/i, '', 'danger']
  ];
  const NOT_HAZARDS = ['campsite', 'parking', 'toilet', 'picnic', 'evac', 'signal', 'info', 'hut'];
  const wordMatch = f => HAZARD_WORDS.find(([re]) => re.test(`${f.name || ''} ${f.notes || ''}`));
  const isHazardKind = f => f.kind === 'danger' || f.kind === 'crossing';
  const suggested = f => isHazardKind(f) || (!NOT_HAZARDS.includes(f.kind) && !!wordMatch(f));

  function presetFor(f) {
    const m = wordMatch(f);
    const key = f.kind === 'crossing' ? 'Flash flooding' : (m && m[1]);
    return key ? { ...HAZARD_PRESETS.find(h => h.hazard.startsWith(key)) } : {};
  }

  /* Choose which map landmarks become risks. Hazard / crossing landmarks, and landmarks whose name or
     notes suggest a hazard (e.g. "Water Crossing" left as a Waypoint), are ticked to start with. */
  function fromMap() {
    const lms = Store.state.map.features.filter(f => f.type === 'landmark');
    if (!lms.length) return toast('Add landmarks on the Map tab first — e.g. a Hazard or River / creek crossing');
    const inReg = f => R().some(r => r.mapId === f.id);
    const kindLabel = f => (MapView.KINDS[f.kind] || MapView.KINDS.waypoint);
    const sorted = lms.slice().sort((a, b) => (suggested(b) - suggested(a)) || (NOT_HAZARDS.includes(a.kind) - NOT_HAZARDS.includes(b.kind)));
    const dlg = $('#dialog');
    dlg.innerHTML = `<form class="dlg-form" id="hazForm">
      <h3>⚠️ Add risks from the map</h3>
      <p class="muted small">Tick the landmarks to add to the risk assessment. Each one is added with its grid reference, and a suitable preset where one fits (e.g. flooding for a creek crossing) — adjust the ratings and controls afterwards.</p>
      <div class="haz-list">${sorted.map(f => {
        const k = kindLabel(f), done = inReg(f), pre = presetFor(f);
        return `<label class="haz-item ${done ? 'done' : ''}">
          <input type="checkbox" name="lm" value="${f.id}" ${done ? 'disabled' : suggested(f) ? 'checked' : ''}>
          <span>${k.icon} <b>${esc(f.name)}</b> <small class="muted">${esc(k.label)} · ${Geo.grText(f.lat, f.lng)}</small>
            ${done ? '<small class="ok"> ✓ already in the risk assessment</small>' : pre.hazard ? `<small class="muted"> → ${esc(pre.hazard)}</small>` : ''}</span>
        </label>`;
      }).join('')}</div>
      <label class="check"><input type="checkbox" name="mark" checked> Also show the ticked landmarks as ⚠️ Hazard / 🌊 Crossing on the map</label>
      <div class="dlg-actions">
        <button type="button" class="btn" data-haz="none">Untick all</button>
        <span class="grow"></span>
        <button type="button" class="btn" data-haz="cancel">Cancel</button>
        <button type="submit" class="btn primary">Add to risks</button>
      </div>
    </form>`;
    const form = $('#hazForm');
    form.addEventListener('click', e => {
      const a = e.target.closest('[data-haz]')?.dataset.haz;
      if (a === 'cancel') dlg.close();
      if (a === 'none') form.querySelectorAll('input[name=lm]:not(:disabled)').forEach(c => { c.checked = false; });
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const ids = [...form.querySelectorAll('input[name=lm]:checked')].map(c => c.value);
      if (!ids.length) return toast('Tick at least one landmark');
      const mark = form.mark.checked;
      ids.forEach(id => {
        const f = lms.find(x => x.id === id);
        const pre = presetFor(f);
        add({ ...pre, hazard: f.name || pre.hazard || 'Map hazard', cause: f.notes || pre.cause || '', location: `${Geo.grText(f.lat, f.lng)} (${Geo.mgaText(f.lat, f.lng)})`, mapId: f.id });
        if (mark && !isHazardKind(f)) { const m = wordMatch(f); f.kind = m ? m[2] : 'danger'; }
      });
      Store.save();
      if (mark) MapView.redraw();
      dlg.close();
      toast(`Added ${ids.length} risk${ids.length > 1 ? 's' : ''} from the map`);
      render();
    });
    dlg.showModal();
  }

  return { render, add, score, rating, matrix, campLine, LIKELIHOOD, CONSEQUENCE, EMERGENCY };
})();
