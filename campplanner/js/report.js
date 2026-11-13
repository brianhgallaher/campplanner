/* Camp Planner — printable trip report: the whole plan as a multi-page document.
   Each section prints on its own paper size and orientation (A4 / A3, portrait / landscape) using CSS named pages,
   so "Save as PDF" produces one file with mixed page sizes. Maps are drawn at true print size. */

const Report = (() => {
  const PAPER = {
    a4p: { label: 'A4 portrait', w: 210, h: 297, m: 12 },
    a4l: { label: 'A4 landscape', w: 297, h: 210, m: 10 },
    a3p: { label: 'A3 portrait', w: 297, h: 420, m: 12 },
    a3l: { label: 'A3 landscape', w: 420, h: 297, m: 10 }
  };
  /* key, title, default paper, why that paper */
  const SECTIONS = [
    ['cover', '🧭 Cover & trip summary', 'a4p'],
    ['itinerary', '📅 Day-by-day itinerary', 'a4l'],
    ['map', '🗺️ Overview map', 'a3l'],
    ['mapkey', '📍 Map key & grid references', 'a4p'],
    ['daymaps', '🗺️ Daily section maps', 'a4l'],
    ['traverse', '🥾 Terrain profile & route card', 'a4l'],
    ['egress', '🚙 Egress & vehicle access', 'a4l'],
    ['drops', '📦 Food & water drops', 'a4p'],
    ['travel', '🚗 Travel plan & car shuffle', 'a4p'],
    ['meals', '🍳 Meal plan', 'a4l'],
    ['shopping', '🛒 Shopping list, cooking gear & recipes', 'a4p'],
    ['gear', '🎒 Gear checklist', 'a4p'],
    ['weight', '⚖️ Pack weights', 'a4p'],
    ['risk', '⚠️ Risk assessment', 'a4l'],
    ['emergency', '⛑️ Emergency plan', 'a4p'],
    ['weather', '🌦️ Weather & tides', 'a4l'],
    ['budget', '💰 Budget', 'a4p']
  ];
  const HEAD_MM = 12; // section heading strip

  let bound = false, maps = [], timer = null;
  const views = new Map();          // map key → user-chosen centre/zoom, kept across re-renders
  const tried = new Set();          // async look-ups already attempted (don't loop on failures)
  const root = () => $('#tab-report');
  const st = () => Store.state;
  const kmTxt = m => (m / 1000).toFixed(m >= 10000 ? 1 : 2);
  const dateTxt = d => d ? fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const box = '<span class="rpt-box"></span>';

  /* ---------- settings (saved with the trip) ---------- */
  function cfg() {
    const s = st();
    s.report = s.report || {};
    const r = s.report;
    r.sections = r.sections || {};
    SECTIONS.forEach(([k, , p]) => { r.sections[k] = Object.assign({ on: true, paper: p }, r.sections[k]); });
    if (r.labels == null) r.labels = true;
    if (r.grid == null) r.grid = true;
    if (r.dayAuto == null) r.dayAuto = true;   // day maps: orient to the direction of travel, split long diagonal days
    return r;
  }

  /* ---------- data for the report ---------- */
  function context() {
    const s = st();
    const trails = s.map.features.filter(f => f.type === 'trail');
    const analysed = trails.filter(Traverse.hasProfile).map(f => Traverse.analyse(f));
    return {
      trails, analysed, missing: trails.filter(f => !Traverse.hasProfile(f)),
      hasMap: s.map.features.length > 0 || s.trip.lat != null,
      days: tripDays(), P: Travel.plan()
    };
  }
  function available(k, X) {
    switch (k) {
      case 'map': case 'mapkey': return X.hasMap;
      case 'daymaps': return X.analysed.some(T => T.days > 1 || T.legs.length > 1);
      case 'traverse': case 'egress': case 'drops': return X.trails.length > 0;
      case 'weather': return st().trip.lat != null;
      case 'meals': case 'shopping': return Object.keys(st().mealPlan).length > 0;
      case 'gear': case 'weight': return st().gear.length > 0;
      default: return true;
    }
  }

  /* ---------- page frame ---------- */
  function sheet(key, paper, title, body, sub = '') {
    const P = PAPER[paper] || PAPER.a4p, t = st().trip;
    return `<section class="rpt-sheet ${paper}" data-key="${key}" data-paper="${P.label}" style="--pw:${P.w}mm;--ph:${P.h}mm;--pm:${P.m}mm">
      <header class="rpt-head"><b>${title}</b><span>${esc(t.name)}${sub ? ' · ' + sub : ''}</span></header>
      ${body}
    </section>`;
  }
  const contentMM = paper => { const P = PAPER[paper]; return { w: P.w - 2 * P.m, h: P.h - 2 * P.m }; };
  const tripSpan = () => {
    const t = st().trip, a = parseDate(t.start), b = parseDate(t.end);
    return a ? dateTxt(a) + (b && +b !== +a ? ' – ' + dateTxt(b) : '') : 'Dates not set';
  };
  const placedByName = v => {
    if (!v) return '';
    const [k, id] = v.split(':');
    return k === 'car' ? '🚗 ' + ((st().travel.cars.find(c => c.id === id) || {}).name || 'car') : personName(id);
  };

  /* ---------- sections ---------- */
  function cover(X, paper, included) {
    const s = st(), t = s.trip, P = X.P;
    const W = s.gear.length || Object.keys(s.mealPlan).length ? Weight.compute() : [];
    /* pack at the start per person: on a mapped traverse use the route model (water for the first dry section, drops) */
    const ser = W.length ? X.analysed.flatMap(T => Drops.model(T, true).series) : [];
    const packs = W.map(r => {
      const sx = ser.filter(q => q.person.id === r.person.id);
      const pack = sx.length ? Math.max(...sx.map(q => q.start)) : r.pack;
      return { person: r.person, pack, pct: num(r.person.bodyKg) ? pack / (num(r.person.bodyKg) * 1000) * 100 : null };
    });
    const heaviest = packs.length ? packs.reduce((a, b) => (b.pack > a.pack ? b : a)) : null;
    const B = Budget.totals();
    const T0 = X.analysed[0];
    const em = s.emergency;
    const stat = (v, l, cls = '') => `<div class="${cls}"><b>${v}</b><span>${l}</span></div>`;
    return sheet('cover', paper, '🧭 Trip plan', `
      <div class="rpt-cover">
        <div class="rpt-title">
          <h1>${esc(t.name)}</h1>
          <p class="rpt-dates">${tripSpan()} · ${X.days.length} day${X.days.length === 1 ? '' : 's'}</p>
          <p>${esc([t.location, t.park ? `${t.park.name} ${t.park.type}` : '', t.state].filter(Boolean).join(' · ') || 'Location not set')}
            <span class="status" style="background:${(Trips.STATUS[t.status] || Trips.STATUS.planning).color}">${(Trips.STATUS[t.status] || Trips.STATUS.planning).label}</span></p>
        </div>
        <div class="big-stats">
          ${T0 ? stat(`${kmTxt(X.analysed.reduce((a, T) => a + T.total, 0))} km`, `walking${X.analysed.length > 1 ? ` · ${X.analysed.length} trails` : ''}`, 'hero') : ''}
          ${T0 ? stat(`↑ ${Math.round(X.analysed.reduce((a, T) => a + T.ascent, 0))} m`, 'total climb') : ''}
          ${T0 ? stat(MapView.fmtHours(X.analysed.reduce((a, T) => a + T.hours, 0)), 'est. walking time') : ''}
          ${T0 ? stat(`${Math.round(T0.high.e)} m`, 'high point') : ''}
          ${heaviest ? stat(fmtKg(heaviest.pack, 1), `heaviest pack at start (${esc(heaviest.person.name)})`, Weight.pctClass(heaviest.pct)) : ''}
          ${P.km ? stat(`${Math.round(P.km)} km`, 'driving, all cars') : ''}
          ${B.total ? stat(fmtMoney(B.total), `budget · ${fmtMoney(B.perPerson)} per person`) : ''}
        </div>
        <div class="rpt-cols">
          <div>
            <h3>Where</h3>
            <table class="kv">
              ${t.lat != null ? `<tr><th>⛺ Camp / base</th><td><b>${Geo.grText(t.lat, t.lon)}</b> · ${Geo.mgaText(t.lat, t.lon)}<br><small>${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}</small></td></tr>` : ''}
              ${P.S ? `<tr><th>🟢 Walk start</th><td>${esc(P.S.name)} <b>${Geo.grText(P.S.lat, P.S.lon)}</b></td></tr>` : ''}
              ${P.F && P.through ? `<tr><th>🏁 Walk finish</th><td>${esc(P.F.name)} <b>${Geo.grText(P.F.lat, P.F.lon)}</b></td></tr>` : ''}
              ${s.travel.home ? `<tr><th>🏠 Home</th><td>${esc(s.travel.home.name)}</td></tr>` : ''}
              <tr><th>🚗 Getting there</th><td>${esc(Travel.MODES[P.mode] || P.mode)}</td></tr>
            </table>
            <h3>Who</h3>
            <table class="tbl compact"><thead><tr><th>Name</th><th class="num">Body kg</th><th class="num">Pack at start</th><th>Role</th></tr></thead><tbody>
              ${s.people.map(p => {
                const w = packs.find(r => r.person.id === p.id);
                const roles = [s.travel.cars.filter(c => c.driver === p.id).map(c => 'drives ' + esc(c.name)).join(', '),
                  /plb|beacon/i.test(em.plb || '') && (em.plb || '').includes(p.name) ? 'PLB' : ''].filter(Boolean).join(' · ');
                return `<tr><td><b>${esc(p.name)}</b></td><td class="num">${num(p.bodyKg) || '—'}</td><td class="num">${w ? fmtKg(w.pack, 1) + (w.pct != null ? ` <small>(${w.pct.toFixed(0)}%)</small>` : '') : '—'}</td><td>${roles}</td></tr>`;
              }).join('')}
            </tbody></table>
          </div>
          <div>
            <div class="rpt-sos">
              <h3>⛑️ In an emergency</h3>
              <p class="rpt-000">Call <b>000</b> <small>(112 from a mobile with no coverage)</small></p>
              ${t.lat != null ? `<p>Camp grid reference: <b>${Geo.grText(t.lat, t.lon)}</b></p>` : ''}
              <dl class="rpt-dl">
                ${['plb', 'contact', 'returnBy', 'hospital', 'reception'].filter(k => em[k]).map(k => `<dt>${Risk.EMERGENCY.find(e => e[0] === k)[1]}</dt><dd>${esc(em[k])}</dd>`).join('')}
              </dl>
            </div>
            <h3>In this report</h3>
            <ol class="rpt-toc">${included.map(([k, title, p]) => `<li>${title.replace(/^\S+\s/, '')} <small class="muted">${PAPER[p].label}</small></li>`).join('')}</ol>
          </div>
        </div>
        ${t.notes ? `<h3>Notes</h3><p class="rpt-notes">${esc(t.notes)}</p>` : ''}
        <p class="muted small rpt-foot">Prepared ${dateTxt(new Date())} with Camp Planner. Distances, times, weights and costs are planning estimates — check track conditions, closures, fire danger and the forecast with the park authority before you go.</p>
      </div>`);
  }

  function itinerary(X, paper) {
    if (!X.analysed.length) {
      return sheet('itinerary', paper, '📅 Day-by-day itinerary', `<table class="tbl"><thead><tr><th>Day</th><th>Date</th><th>Meals</th></tr></thead><tbody>
        ${X.days.map((d, i) => `<tr><td><b>${d.label}</b></td><td>${dateTxt(d.date)}</td><td>${mealsLine(i + 1)}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">Map a trail to add walking distances, climbs and campsites.</p>`);
    }
    return X.analysed.map(T => {
      const M = Drops.model(T, true), drops = T.f.drops || [];
      const rows = [];
      for (let k = 1; k <= T.days; k++) {
        const ls = T.legs.filter(l => l.day === k);
        if (!ls.length) continue;
        const a = ls[0].from.d, b = ls[ls.length - 1].to.d, end = ls[ls.length - 1].to;
        const dist = ls.reduce((s, l) => s + l.dist, 0), up = ls.reduce((s, l) => s + l.ascent, 0), dn = ls.reduce((s, l) => s + l.descent, 0), h = ls.reduce((s, l) => s + l.hours, 0);
        const water = M.refills.filter(r => r.d >= a - 1 && r.d <= b + 1).map(r => (r.type === 'drop' ? '📦 ' : r.type === 'water' ? '💧 ' : '🟢 ') + esc(r.name));
        const dry = M.sections.flatMap(sx => sx.dryCamps).some(cp => Math.abs(cp.d - b) < 50);
        const pick = drops.filter(dr => Drops.dayAt(T, num(dr.d)) === k).map(dr => `📦 ${esc(dr.name || 'drop')}${Drops.dropDays(dr).length ? ` <small>(food days ${Math.min(...Drops.dropDays(dr))}–${Math.max(...Drops.dropDays(dr))})</small>` : ''}`);
        const eg = Egress.fresh(T.f) ? T.f.egress.entries.filter(e => e.d1 >= a && e.d0 < b).length : null;
        const day = X.days[k - 1];
        rows.push(`<tr>
          <td><b>Day ${k}</b><br><small>${day && day.date ? fmtDate(day.date) : ''}</small></td>
          <td>${esc(ls[0].from.name)} → <b>${esc(end.name)}</b>${k < T.days && (end.kind === 'campsite' || end.night) ? `<br><small>⛺ ${Geo.grText(end.lat, end.lng)}${dry ? ' · <span class="bad-text">dry camp — carry water</span>' : ''}</small>` : ''}</td>
          <td class="num">${kmTxt(dist)} km<br><small class="muted">km ${kmTxt(a)}–${kmTxt(b)}</small></td>
          <td class="num">↑${Math.round(up)}<br>↓${Math.round(dn)}</td>
          <td class="num">${MapView.fmtHours(h)}</td>
          <td>${water.join('<br>') || '<span class="muted">—</span>'}</td>
          <td>${pick.join('<br>') || ''}</td>
          <td class="num">${eg == null ? '…' : eg || '<span class="bad-text">none</span>'}</td>
          <td class="small">${mealsLine(k)}</td>
        </tr>`);
      }
      return sheet('itinerary', paper, '📅 Day-by-day itinerary', `
        <p class="small"><b>${esc(T.f.name)}</b> — ${kmTxt(T.total)} km, ↑${Math.round(T.ascent)} m ↓${Math.round(T.descent)} m over ${T.days} day${T.days > 1 ? 's' : ''}.
          Start <b>${esc(T.stops[0].name)}</b> ${Geo.grText(T.stops[0].lat, T.stops[0].lng)} · finish <b>${esc(T.stops[T.stops.length - 1].name)}</b> ${Geo.grText(T.stops[T.stops.length - 1].lat, T.stops[T.stops.length - 1].lng)}</p>
        <table class="tbl rpt-itin"><thead><tr><th>Day</th><th>Walk · overnight</th><th class="num">Distance</th><th class="num">Climb m</th><th class="num">Time</th><th>Water refills</th><th>Pick up</th><th class="num">Vehicle access</th><th>Meals</th></tr></thead>
          <tbody>${rows.join('')}</tbody></table>
        <p class="muted small">Times are walking estimates without breaks. Water refills are mapped water sources on the route — check tank levels with the park before relying on them. Vehicle access = roads or tracks touching that day's walk (see Egress).</p>`, esc(T.f.name));
    }).join('');
  }
  function mealsLine(k) {
    const dp = st().mealPlan['D' + k] || {};
    return Meals.SLOTS.filter(([sl]) => sl !== 'snacks').map(([sl, label]) => {
      const n = (dp[sl] || []).map(e => (st().recipes.find(r => r.id === e.recipeId) || {}).name).filter(Boolean);
      return n.length ? `<b>${label[0]}</b> ${n.map(esc).join(', ')}` : '';
    }).filter(Boolean).join(' · ') || '<span class="muted">—</span>';
  }

  /* ---------- maps ---------- */
  function mapSheet(X, paper) {
    const c = contentMM(paper), C = cfg();
    const h = c.h - HEAD_MM - 14;
    return sheet('map', paper, '🗺️ Overview map', `
      <div class="rpt-map" data-map="overview" style="height:${h}mm"></div>
      <div class="rpt-map-foot"><span data-scale="overview"></span><span data-gridinfo="overview"></span>
        <span>${legendKinds()}</span></div>`);
  }
  function legendKinds() {
    const used = [...new Set(st().map.features.filter(f => f.type === 'landmark').map(f => f.kind))];
    return used.map(k => `${(MapView.KINDS[k] || MapView.KINDS.waypoint).icon} ${(MapView.KINDS[k] || MapView.KINDS.waypoint).label}`).join(' · ');
  }

  function mapKey(X, paper) {
    const s = st(), t = s.trip, fs = s.map.features;
    const lms = fs.filter(f => f.type === 'landmark'), trails = fs.filter(f => f.type === 'trail'), areas = fs.filter(f => f.type === 'area');
    const T = X.analysed[0];
    const kmOn = f => {
      for (const A of X.analysed) {
        const s2 = A.stops.find(x => x.ref === f.id);
        if (s2) return kmTxt(s2.d);
      }
      return '';
    };
    const ref = T || { stops: [{ lat: t.lat ?? s.map.center[0], lng: t.lon ?? s.map.center[1] }] };
    const a = ref.stops[0];
    const decl = a.lat != null ? Geo.declination(a.lat, a.lng) : null;
    return sheet('mapkey', paper, '📍 Map key & grid references', `
      ${t.lat != null ? `<p><b>⛺ Camp:</b> ${esc(t.location || '')} — <b>${Geo.grText(t.lat, t.lon)}</b> · ${Geo.mgaText(t.lat, t.lon)} · ${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}</p>` : ''}
      ${decl != null ? `<p class="small">MGA2020 zone ${Geo.zoneOf(a.lng)} · magnetic declination ≈ ${Geo.fmtDecl(decl)} · grid magnetic angle ≈ ${Geo.fmtDecl(decl - Geo.convergence(a.lat, a.lng))}</p>` : ''}
      ${trails.length ? `<h3>Trails</h3><table class="tbl compact"><thead><tr><th>Trail</th><th>Start → finish</th><th class="num">Distance</th><th class="num">Climb</th><th>Notes</th></tr></thead><tbody>
        ${trails.map(f => { const S = MapView.trailStats(f), p = f.coords[0], q = f.coords[f.coords.length - 1];
          return `<tr><td><span class="sw line" style="border-color:${esc(f.color)}"></span> <b>${esc(f.name)}</b></td><td>${Geo.grText(p[0], p[1])} → ${Geo.grText(q[0], q[1])}</td>
          <td class="num">${MapView.fmtDist(S.dist)}</td><td class="num">${f.elev ? `↑${S.gain} ↓${S.loss} m` : '—'}</td><td class="small">${esc(f.notes || '')}</td></tr>`; }).join('')}</tbody></table>` : ''}
      ${lms.length ? `<h3>Landmarks</h3><table class="tbl compact rpt-lm"><thead><tr><th></th><th>Name</th><th>Type</th><th class="num">km</th><th>Grid ref</th><th>MGA2020</th><th>Lat, long</th><th>Notes</th></tr></thead><tbody>
        ${lms.map(f => ({ f, k: kmOn(f) })).sort((x, y) => (x.k === '' ? 1e9 : +x.k) - (y.k === '' ? 1e9 : +y.k)).map(({ f, k }) => `<tr><td>${(MapView.KINDS[f.kind] || MapView.KINDS.waypoint).icon}</td><td><b>${esc(f.name)}</b></td>
          <td>${(MapView.KINDS[f.kind] || MapView.KINDS.waypoint).label}</td><td class="num">${k}</td><td><b>${Geo.grText(f.lat, f.lng)}</b></td><td class="small">${Geo.mgaText(f.lat, f.lng)}</td>
          <td class="small">${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}</td><td class="small">${esc(f.notes || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${areas.length ? `<h3>Areas</h3><table class="tbl compact"><tbody>${areas.map(f => `<tr><td><span class="sw" style="background:${esc(f.color)}"></span> <b>${esc(f.name)}</b></td><td>${MapView.fmtArea(f)}</td><td class="small">${esc(f.notes || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="muted small">Grid references are six-figure MGA2020 references (easting then northing, 100 m precision), compatible with Australian topographic maps. km = distance along the trail.</p>`);
  }

  /* ---------- daily section maps ----------
     With "dayAuto" on, each day (or part of a day) is laid out on the page orientation that shows it at the
     largest scale: portrait for north–south travel, landscape for east–west, at the paper size chosen for the
     section. A diagonal day that still prints smaller than SPLIT_DIAG (or any day smaller than SPLIT_ANY) is
     split over 2 pages at a stop near the middle. */
  const SPLIT_DIAG = 50000, SPLIT_ANY = 100000;
  const PAD_MM = 13;   // fitBounds padding (24 px each side)

  /* Map height for a day page: landscape keeps the profile & table beside each other under the map;
     portrait stacks them, so the map gets most of the page height. */
  function dayMapH(paper, legs) {
    const c = contentMM(paper);
    if (paper.endsWith('l')) return Math.round(c.h * Math.max(0.42, 0.64 - 0.06 * (legs - 1)));
    return Math.round(Math.max(c.h * 0.45, c.h - HEAD_MM - 72 - 6.5 * (legs + 1)));
  }

  /* The section of trail from km a to b: its points and its east–west / north–south extent in metres. */
  function sectionBox(f, cum, a, b) {
    const pts = [Drops.pointAt(f, a), ...f.coords.filter((_, i) => cum[i] > a && cum[i] < b), Drops.pointAt(f, b)];
    const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
    const mid = (Math.min(...lats) + Math.max(...lats)) / 2;
    return {
      wM: Math.max(50, (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos(mid * Math.PI / 180)),
      hM: Math.max(50, (Math.max(...lats) - Math.min(...lats)) * 110540)
    };
  }

  /* Printed scale (1:n) needed to fit the box on a page. */
  function fitScale(box, paper, legs) {
    const c = contentMM(paper);
    return Math.max(box.wM / ((c.w - PAD_MM) / 1000), box.hM / ((dayMapH(paper, legs) - PAD_MM) / 1000));
  }

  /* Best orientation for a section, at the section's paper size. */
  function dayLayout(T, cum, a, b, legs, paper) {
    const box = sectionBox(T.f, cum, a, b);
    const size = paper.slice(0, 2);
    const opts = [size + 'l', size + 'p'].map(pk => ({ paper: pk, scale: fitScale(box, pk, legs) }));
    const best = opts.reduce((x, y) => (y.scale < x.scale * 0.97 ? y : x));   // prefer landscape when it's a tie
    const aspect = box.hM / box.wM;
    return { ...best, box, aspect, diagonal: aspect > 0.67 && aspect < 1.5 };
  }

  /* Split [a, b] at the stop nearest the middle (if there's one in the middle 40%), else at the halfway point. */
  function splitPoint(T, a, b) {
    const mid = (a + b) / 2, span = b - a;
    const near = T.stops.filter(sp => sp.d > a + span * 0.3 && sp.d < b - span * 0.3).sort((x, y) => Math.abs(x.d - mid) - Math.abs(y.d - mid))[0];
    return near ? near.d : mid;
  }

  function dayMaps(X, paper) {
    const auto = cfg().dayAuto;
    return X.analysed.flatMap(T => {
      const out = [], cum = Geo.cumDist(T.f.coords);
      for (let k = 1; k <= T.days; k++) {
        const ls = T.legs.filter(l => l.day === k);
        if (!ls.length) continue;
        const a = ls[0].from.d, b = ls[ls.length - 1].to.d;
        let parts = [[a, b]];
        if (auto) {
          const L1 = dayLayout(T, cum, a, b, ls.length, paper);
          if ((L1.diagonal && L1.scale > SPLIT_DIAG) || L1.scale > SPLIT_ANY) {
            const m = splitPoint(T, a, b);
            parts = [[a, m], [m, b]];
          }
        }
        parts.forEach(([pa, pb], pi) => {
          const pls = parts.length > 1 ? ls.filter(l => l.to.d > pa + 1 && l.from.d < pb - 1) : ls;
          const pp = auto ? dayLayout(T, cum, pa, pb, pls.length, paper).paper : paper;
          out.push(daySheet(X, T, k, ls, pls, pa, pb, pp, parts.length > 1 ? { n: pi + 1, of: parts.length } : null));
        });
      }
      return out;
    }).join('');
  }

  function daySheet(X, T, k, dayLegs, ls, a, b, paper, part) {
    const day = X.days[k - 1];
    const stopAt = d => T.stops.find(sp => Math.abs(sp.d - d) < 30);
    const nameAt = d => { const sp = stopAt(d); return sp ? esc(sp.name) : `km ${kmTxt(d)}`; };
    /* distance, climb and time for just this part (legs cut by the split are pro-rated) */
    const share = l => Math.max(0, Math.min(b, l.to.d) - Math.max(a, l.from.d)) / Math.max(1, l.to.d - l.from.d);
    const sum = fn => ls.reduce((s, l) => s + fn(l) * share(l), 0);
    const dist = b - a, up = sum(l => l.ascent), dn = sum(l => l.descent), h = sum(l => l.hours);
    const key = `day-${T.f.id}-${k}${part ? '-' + part.n : ''}`;
    const portrait = paper.endsWith('p');
    const mapH = dayMapH(paper, ls.length);
    const cont = l => (l.to.d > b + 1 ? ' <small class="muted">(continues on next page)</small>' : l.from.d < a - 1 ? ' <small class="muted">(from previous page)</small>' : '');
    const partNote = !part ? '' : part.n === 1 ? `Continues on the next page from ${nameAt(b)}` : `Continued from the previous page`;
    return sheet('daymaps', paper, `🗺️ Day ${k}${part ? ` (${part.n} of ${part.of})` : ''}${day && day.date ? ' · ' + fmtDate(day.date) : ''}`, `
      <p class="rpt-dayline"><b>${nameAt(a)} → ${nameAt(b)}</b> · ${kmTxt(dist)} km (km ${kmTxt(a)}–${kmTxt(b)}) · ↑${Math.round(up)} m ↓${Math.round(dn)} m · ${MapView.fmtHours(h)}
        ${part ? `<span class="muted"> · whole day: ${esc(dayLegs[0].from.name)} → ${esc(dayLegs[dayLegs.length - 1].to.name)}, ${kmTxt(dayLegs[dayLegs.length - 1].to.d - dayLegs[0].from.d)} km</span>` : ''}</p>
      <div class="rpt-map" data-map="${key}" data-trail="${T.f.id}" data-a="${a}" data-b="${b}" style="height:${mapH}mm"></div>
      <div class="rpt-map-foot"><span data-scale="${key}"></span><span data-gridinfo="${key}"></span><span>${partNote ? `<b>${partNote}.</b> ` : ''}Today's section in bold; ● numbered stops match the table below</span></div>
      <div class="rpt-day-grid ${portrait ? 'stack' : ''}">
        <div>${dayProfile(T, a, b)}</div>
        <table class="tbl compact"><thead><tr><th>#</th><th>To</th><th>Grid ref</th><th class="num">km</th><th class="num">Climb</th><th class="num">Bearing</th><th class="num">Time</th><th>Terrain</th></tr></thead><tbody>
          ${ls.map(l => `<tr><td>${T.stops.indexOf(l.to) + 1}</td><td><b>${esc(l.to.name)}</b>${cont(l)}</td><td><b>${Geo.grText(l.to.lat, l.to.lng)}</b></td><td class="num">${kmTxt(l.dist)}</td>
            <td class="num">↑${Math.round(l.ascent)} ↓${Math.round(l.descent)}</td><td class="num">${Geo.fmtBearing(l.gridB)}</td><td class="num">${MapView.fmtHours(l.hours)}</td>
            <td class="small">${Traverse.terrainText(l)}</td></tr>`).join('')}
        </tbody></table>
      </div>`, esc(T.f.name));
  }

  /* Small elevation profile for one day's section, shaded by gradient. */
  function dayProfile(T, a, b) {
    const idx = T.d.map((_, i) => i).filter(i => T.d[i] >= a - 1 && T.d[i] <= b + 1);
    if (idx.length < 2) return '';
    const Wd = 520, H = 150, L = 40, R = 8, Tp = 10, Bm = 22;
    const els = idx.map(i => T.el[i]);
    const lo = Math.floor(Math.min(...els) / 50) * 50, hi = Math.max(lo + 100, Math.ceil(Math.max(...els) / 50) * 50);
    const x = d => L + (d - a) / Math.max(1, b - a) * (Wd - L - R), y = v => Tp + (1 - (v - lo) / (hi - lo)) * (H - Tp - Bm);
    const G = Traverse.GRADES, gi = g => G.findIndex(q => Math.abs(g) < q[0]);
    let svg = '';
    const ystep = (hi - lo) > 400 ? 200 : (hi - lo) > 200 ? 100 : 50;
    for (let v = lo; v <= hi; v += ystep) svg += `<line x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}" class="c-grid light"/><text x="${L - 4}" y="${y(v) + 3}" class="c-lbl tiny" text-anchor="end">${v}</text>`;
    for (let n = 0; n < idx.length - 1; n++) {
      const i = idx[n], j = idx[n + 1];
      svg += `<path d="M${x(T.d[i]).toFixed(1)},${H - Bm}L${x(T.d[i]).toFixed(1)},${y(T.el[i]).toFixed(1)}L${x(T.d[j]).toFixed(1)},${y(T.el[j]).toFixed(1)}L${x(T.d[j]).toFixed(1)},${H - Bm}Z" fill="${G[gi(T.grades[i] || 0)][2]}"/>`;
    }
    svg += `<path d="${idx.map((i, n) => `${n ? 'L' : 'M'}${x(T.d[i]).toFixed(1)},${y(T.el[i]).toFixed(1)}`).join('')}" fill="none" stroke="#262661" stroke-width="1.5"/>`;
    T.stops.forEach((s, i) => {
      if (s.d < a - 1 || s.d > b + 1) return;
      svg += `<line x1="${x(s.d)}" x2="${x(s.d)}" y1="${Tp}" y2="${H - Bm}" stroke="#1f2a24" stroke-dasharray="2 3" stroke-width=".8"/><text x="${Math.min(Wd - R - 4, Math.max(L + 4, x(s.d)))}" y="${Tp + 8}" class="c-lbl tiny" text-anchor="middle">${i + 1}</text>`;
    });
    svg += `<text x="${L}" y="${H - 6}" class="c-lbl tiny">km ${kmTxt(a)}</text><text x="${Wd - R}" y="${H - 6}" class="c-lbl tiny" text-anchor="end">km ${kmTxt(b)}</text>`;
    return `<svg viewBox="0 0 ${Wd} ${H}" class="chart" role="img" aria-label="Day profile">${svg}</svg>`;
  }

  /* ---------- traverse, egress, drops ---------- */
  function waiting(f) { return `<p class="muted">⛰ ${esc(f.name)}: calculating the terrain profile…</p>`; }

  /* Traverse: page 1 = summary + terrain profile; page 2 = gradient / track type + the route card, which
     flows onto as many continuation pages as it needs (see paginate()). */
  function traverse(X, paper) {
    const P = Traverse.parts;
    const note = `<p class="muted small">Elevations from a 90 m terrain model, smoothed. Times: ${Object.values(Routing.CATS).map(c => `${c.label.toLowerCase()} ${c.kmh} km/h`).join(', ')}, plus 1 hour per 600 m of climb. Bearings are straight-line stop to stop; magnetic values are estimates.</p>`;
    return X.trails.map(f => {
      const T = X.analysed.find(A => A.f === f);
      if (!T) return sheet('traverse', paper, '🥾 Traverse', waiting(f));
      const parks = Traverse.parksFor(f) !== undefined ? `<p class="small">${Traverse.parksText(Traverse.parksFor(f))}</p>` : '';
      const summary = P.summaryCard(T).replace(/<p class="small" id="trParks">[\s\S]*?<\/p>/, parks);
      const title = `🥾 Traverse — ${esc(f.name)}`;
      return sheet('traverse', paper, title, summary + P.profileCard(T) + note, 'terrain profile')
        + sheet('traverse', paper, title, P.breakdownCards(T) + P.routeCard(T), 'route card');
    }).join('');
  }

  /* Kept for the route card: the generic paginate() below handles every section now. */
  const flow = html => html;

  /* ---------- pagination ----------
     After layout, every sheet taller than its paper moves what doesn't fit onto continuation sheets of the same
     size (same heading), repeatedly — so each printed page is exactly one A4 / A3 page:
       • tables split between rows (a day / group heading row moves with the rows under it; column titles repeat);
       • cards and other containers split between their children, and carry their heading as "… (continued)";
       • anything that mustn't be split (charts, maps, side-by-side columns, items marked break-inside: avoid,
         paragraphs, list items) moves whole.
     Measured in the preview at true size, which matches print. Sheets with live maps are not split. */
  function paginate() {
    const mm = 96 / 25.4;
    const kids = n => [...n.children].filter(c => c.offsetParent !== null || c.getClientRects().length);
    const bottomOf = n => n.getBoundingClientRect().bottom;
    const topOf = n => n.getBoundingClientRect().top;
    const hasText = n => [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
    const isHeadingRow = r => r.classList.contains('day-row') || r.classList.contains('rpt-sub') || r.classList.contains('cat-row')
      || !r.querySelector('td') || (r.cells.length === 1 && r.cells[0].colSpan > 1);
    const sideBySide = n => { const k = kids(n); return k.length > 1 && k.some((c, i) => i && topOf(c) < bottomOf(k[i - 1]) - 2); };
    const atomic = n => {
      if (/^(P|H[1-6]|LI|SVG|IMG|CANVAS|TR|LABEL|FIGURE|PRE|BUTTON|SELECT|INPUT)$/i.test(n.tagName)) return true;
      if (n.classList.contains('rpt-map') || n.classList.contains('leaflet-container') || n.classList.contains('rpt-head')) return true;
      const cs = getComputedStyle(n);
      if (cs.breakInside === 'avoid' || cs.pageBreakInside === 'avoid') return true;
      if (n.tagName === 'TABLE') return false;
      if (!kids(n).length || hasText(n)) return true;
      return sideBySide(n);
    };

    /* Split a table at the first row past `limit`. Returns the overflow table, 'all', or null. */
    function splitTable(t, limit) {
      const bodies = [...t.tBodies];
      const rows = bodies.flatMap(b => [...b.rows]);
      if (!rows.length) return bottomOf(t) > limit ? 'all' : null;
      let cut = rows.findIndex(r => bottomOf(r) > limit);
      if (cut < 0) return null;
      while (cut > 0 && isHeadingRow(rows[cut - 1])) cut--;          // keep headings with their rows
      if (cut === 0) return 'all';
      const t2 = t.cloneNode(false);
      if (t.tHead) t2.appendChild(t.tHead.cloneNode(true));
      const first = rows[cut];
      let started = false;
      bodies.forEach(b => {
        const moving = [...b.rows].filter(r => { if (r === first) started = true; return started; });
        if (!moving.length) return;
        const b2 = b.cloneNode(false);
        if (moving.length === b.rows.length) { t2.appendChild(b); return; }
        moving.forEach(r => b2.appendChild(r));
        t2.appendChild(b2);
      });
      const firstRow = t2.tBodies[0] && t2.tBodies[0].rows[0];
      if (firstRow && !isHeadingRow(firstRow) && firstRow.dataset.day) {
        t2.tBodies[0].insertAdjacentHTML('afterbegin', `<tr class="day-row"><td colspan="${firstRow.cells.length}">Day ${firstRow.dataset.day} (continued)</td></tr>`);
      }
      return t2;
    }

    /* Move everything in `node` below `limit` into a shallow copy of it. Returns that copy, 'all', or null. */
    function splitNode(node, limit) {
      if (bottomOf(node) <= limit) return null;
      if (node.tagName === 'TABLE') return splitTable(node, limit);
      /* newspaper columns (e.g. the gear checklist): move items from the end until the rest fits */
      const cs = getComputedStyle(node);
      if ((cs.columnCount !== 'auto' && +cs.columnCount > 1) || cs.columnWidth !== 'auto') {
        const copy = node.cloneNode(false);
        copy.removeAttribute('id');
        while (bottomOf(node) > limit && kids(node).length > 1) copy.prepend(kids(node).pop());
        if (!copy.children.length) return 'all';
        if (bottomOf(node) > limit) { [...copy.children].forEach(c => node.appendChild(c)); return 'all'; }   // even one item doesn't fit here
        return copy;
      }
      if (atomic(node)) return 'all';
      const k = kids(node);
      const i = k.findIndex(c => bottomOf(c) > limit);
      if (i < 0) return null;
      let moveFrom = i, partial = null;
      if (topOf(k[i]) < limit) {
        const r = splitNode(k[i], limit);
        if (r && r !== 'all') { partial = r; moveFrom = i + 1; }
      }
      /* don't leave a heading at the bottom on its own */
      while (moveFrom > 0 && !partial && /^H[1-6]$/.test(k[moveFrom - 1].tagName)) moveFrom--;
      if (moveFrom === 0 && !partial) return 'all';
      const copy = node.cloneNode(false);
      copy.removeAttribute('id');
      const h = k[0] && /^H[1-6]$/.test(k[0].tagName) && (partial || moveFrom > 0) ? k[0] : null;
      if (h) { const hc = h.cloneNode(true); hc.querySelectorAll('.help-i').forEach(b => b.remove()); hc.insertAdjacentText('beforeend', ' (continued)'); copy.appendChild(hc); }
      if (partial) copy.appendChild(partial);
      k.slice(moveFrom).forEach(c => copy.appendChild(c));
      return copy;
    }

    function splitSheet(sh, guard = 0) {
      if (guard > 40 || sh.querySelector('.rpt-map')) return;
      const ph = parseFloat(sh.style.getPropertyValue('--ph')), pm = parseFloat(sh.style.getPropertyValue('--pm'));
      const zoom = sh.style.zoom;
      sh.style.zoom = '';
      const limit = topOf(sh) + (ph - pm - 6) * mm;             // bottom of the printable area, less 6 mm: print sets text a little taller than the preview
      const head = sh.querySelector('.rpt-head');
      const k = kids(sh).filter(c => c !== head);
      const i = k.findIndex(c => bottomOf(c) > limit);
      if (i < 0) { sh.style.zoom = zoom; return; }
      let partial = null, moveFrom = i;
      if (topOf(k[i]) < limit) {
        const r = splitNode(k[i], limit);
        if (r && r !== 'all') { partial = r; moveFrom = i + 1; }
      }
      while (moveFrom > 0 && !partial && /^H[1-6]$/.test(k[moveFrom - 1].tagName)) moveFrom--;
      if (moveFrom === 0 && !partial) { sh.style.zoom = zoom; return; }   // a single block taller than the page: leave it
      const ns = sh.cloneNode(false);
      ns.style.zoom = '';
      ns.classList.add('rpt-cont');
      ns.appendChild(head.cloneNode(true));
      if (partial) ns.appendChild(partial);
      k.slice(moveFrom).forEach(c => ns.appendChild(c));
      sh.after(ns);
      sh.style.zoom = zoom;
      splitSheet(ns, guard + 1);
    }

    $$('#rptPreview .rpt-sheet').forEach(sh => splitSheet(sh));
  }

  function egress(X, paper) {
    return X.trails.map(f => {
      const T = X.analysed.find(A => A.f === f);
      if (!T) return sheet('egress', paper, '🚙 Egress', waiting(f));
      const body = Egress.fresh(f) ? Traverse.parts.egressCard(T)
        : `<p class="warn-text">Vehicle access along this trail hasn't been checked yet (the road and track data service was busy or offline). Open the Traverse tab when online, then print the report again.</p>`;
      return sheet('egress', paper, `🚙 Egress & vehicle access — ${esc(f.name)}`, body);
    }).join('');
  }

  function drops(X, paper) {
    return X.trails.map(f => {
      const T = X.analysed.find(A => A.f === f);
      if (!T) return sheet('drops', paper, '📦 Food & water drops', waiting(f));
      const withM = Drops.model(T, true), noM = Drops.model(T, false), c = Drops.cfg(f), list = f.drops || [], n = st().people.length;
      const startW = Math.max(...withM.series.map(s => s.start)), startN = Math.max(...noM.series.map(s => s.start));
      return sheet('drops', paper, `📦 Food & water drops — ${esc(f.name)}`, `
        <div class="big-stats">
          <div class="hero"><b>${fmtKg(startW, 1)}</b><span>heaviest pack at the start${list.length ? ` (${fmtKg(startN, 1)} without drops)` : ''}</span></div>
          <div><b>${list.length}</b><span>drop${list.length === 1 ? '' : 's'}</span></div>
          <div><b>${fmtKg(withM.trailFood, 1)}</b><span>food per person, ${withM.days} days</span></div>
        </div>
        <h3>Pack weight along the route</h3>
        ${Drops.loadChart(T, withM, noM)}
        ${list.length ? `<h3>Drops</h3><table class="tbl compact"><thead><tr><th>#</th><th>Drop</th><th>Where</th><th>Collect</th><th>Contents</th><th>Vehicle access</th><th>Placed</th></tr></thead><tbody>
          ${list.map((dr, i) => {
            const d = num(dr.d), [lat, lng] = Drops.pointAt(f, d), v = Drops.vehicleAt(f, d), days = Drops.dropDays(dr);
            const foodKg = days.reduce((s, k) => s + Drops.dayFoodPP(k), 0) * n;
            const gear = st().gear.filter(g => (dr.gearIds || []).includes(g.id));
            const warn = Drops.warnings(T, dr);
            return `<tr><td><b>${i + 1}</b></td><td><b>${esc(dr.name || 'Drop')}</b>${dr.notes ? `<br><small>${esc(dr.notes)}</small>` : ''}${warn.length ? `<br><small class="bad-text">⚠ ${warn.map(esc).join('; ')}</small>` : ''}</td>
              <td>km ${kmTxt(d)}<br><b>${Geo.grText(lat, lng)}</b></td><td>Day ${Drops.dayAt(T, d)}</td>
              <td>${[days.length ? `🍲 food days ${Math.min(...days)}–${Math.max(...days)} (${fmtKg(foodKg, 1)})` : '', num(dr.waterL) ? `💧 ${num(dr.waterL)} L` : '', gear.length ? '🎒 ' + gear.map(g => esc(g.name)).join(', ') : ''].filter(Boolean).join('<br>') || '—'}</td>
              <td>${v ? `${Egress.LEVELS[v.e.level].icon} ${Egress.LEVELS[v.e.level].label}<br><small>${esc(v.e.name)}</small>` : '<small class="muted">none within 300 m</small>'}</td>
              <td>${esc(placedByName(dr.placedBy))}${dr.placedOn ? `<br><small>${dateTxt(parseDate(dr.placedOn))}</small>` : ''}</td></tr>`;
          }).join('')}</tbody></table>
          <h3>Packing list for each drop</h3>
          <div class="rpt-cols">${list.map((dr, i) => `<div class="rpt-dropbox"><b>📦 Drop ${i + 1} — ${esc(dr.name || '')}</b>
            <ul>${Drops.dropDays(dr).map(k => `<li>${box} <b>Day ${k}:</b> ${Drops.mealsFor(k).map(esc).join(', ') || 'no meals planned'}</li>`).join('')}
              ${num(dr.waterL) ? `<li>${box} ${num(dr.waterL)} L water</li>` : ''}
              ${st().gear.filter(g => (dr.gearIds || []).includes(g.id)).map(g => `<li>${box} ${esc(g.name)}</li>`).join('')}
              <li>${box} Label: names, phone, pick-up date</li></ul></div>`).join('')}</div>` : '<p class="muted">No drops planned on this trail.</p>'}
        <h3>💧 Water plan <small class="muted">(per person: ${c.rate} L/hour walking, ${c.camp} L per dry camp, ${c.reserve} L reserve)</small></h3>
        <table class="tbl compact"><thead><tr><th>Fill up at</th><th class="num">km</th><th class="num">To next refill</th><th class="num">Walking</th><th>Dry camps</th><th class="num">Carry</th></tr></thead>
          <tbody>${withM.sections.map(s => `<tr><td>${s.from.type === 'drop' ? '📦' : s.from.type === 'water' ? '💧' : '🟢'} ${esc(s.from.name)}</td><td class="num">${kmTxt(s.a)}</td>
            <td class="num">${kmTxt(s.b - s.a)} km</td><td class="num">${MapView.fmtHours(s.hours)}</td><td>${s.dryCamps.map(cp => esc(cp.name)).join(', ') || '—'}</td>
            <td class="num"><b>${s.litres.toFixed(1)} L</b></td></tr>`).join('')}</tbody></table>
        <p class="muted small">Treat all creek and tank water. Use sealed, animal-proof, labelled containers for drops; collect everything you leave; check park rules on caches.</p>`);
    }).join('');
  }

  /* ---------- travel ---------- */
  function travel(X, paper) {
    const P = X.P, tr = st().travel, s = st().trip;
    const kmT = l => l.r ? `${l.r.km.toFixed(l.r.km < 10 ? 1 : 0)} km · ${fmtMins(l.r.min)}` : '—';
    const tt = Travel.timetable(P);
    const sd = parseDate(s.start), ed = parseDate(s.end);
    return sheet('travel', paper, '🚗 Travel plan', `
      <div class="rpt-cols">
        <table class="kv">
          <tr><th>🏠 Home</th><td>${tr.home ? esc(tr.home.name) : '<span class="bad-text">not set</span>'}</td></tr>
          <tr><th>🟢 Walk start</th><td>${P.S ? `${esc(P.S.name)} <b>${Geo.grText(P.S.lat, P.S.lon)}</b>` : '—'}</td></tr>
          <tr><th>🏁 Walk finish</th><td>${P.F ? `${esc(P.F.name)} <b>${Geo.grText(P.F.lat, P.F.lon)}</b>` : '—'}</td></tr>
          <tr><th>Between finish & start</th><td>${esc(Travel.MODES[P.mode])}${P.shuttleCost ? ` · ${fmtMoney(P.shuttleCost)}` : ''}</td></tr>
        </table>
        <table class="kv">
          <tr><th>Home → start</th><td>${kmT(P.toStart)}</td></tr>
          <tr><th>Start ↔ finish (drive)</th><td>${kmT(P.between)}</td></tr>
          <tr><th>Walk start → finish</th><td>${P.walkKm ? P.walkKm.toFixed(1) + ' km' : '—'}</td></tr>
          <tr><th>Finish → home</th><td>${kmT(P.fromFinish)}</td></tr>
          <tr><th>Total driving</th><td><b>${Math.round(P.km)} km</b> · fuel ${fmtMoney(P.fuelCost)}${P.shuttleCost ? ` + shuttle ${fmtMoney(P.shuttleCost)}` : ''}</td></tr>
        </table>
      </div>
      ${P.cars.length ? `<h3>Cars</h3><table class="tbl compact"><thead><tr><th>Car</th><th>Driver</th><th class="num">Seats</th><th>Fuel</th><th class="num">Economy</th><th>Leaves from</th>${P.mode === 'shuffle' ? '<th>During the walk</th>' : ''}<th class="num">Driving</th><th class="num">Fuel</th><th class="num">Cost</th></tr></thead><tbody>
        ${P.cars.map(c => `<tr><td><b>${esc(c.car.name)}</b></td><td>${esc(personName(c.car.driver))}</td><td class="num">${num(c.car.seats, 5)}</td><td>${esc((FUEL_TYPES[c.car.fuel] || FUEL_TYPES.ulp91).label)}</td>
          <td class="num">${c.econ.toFixed(1)} ${c.unit}/100 km</td><td>${esc(c.home?.name || 'home')}</td>${P.mode === 'shuffle' ? `<td>${c.role === 'finish' ? 'Left at finish' : 'Waits at start'}</td>` : ''}
          <td class="num">${c.complete ? Math.round(c.km) + ' km' : '…'}</td><td class="num">${c.complete ? `${c.amount.toFixed(1)} ${c.unit}` : ''}</td><td class="num">${c.complete ? fmtMoney(c.cost) : ''}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">No cars added.</p>'}
      ${P.mode === 'shuffle' ? Travel.shuffleCard(P) : ''}
      <div class="rpt-cols">
        <div><h3>Getting there — ${sd ? fmtDate(sd) : 'day 1'}</h3>${Travel.timeList(tt.out)}</div>
        <div><h3>Getting home — ${ed ? fmtDate(ed) : 'last day'}</h3>${Travel.timeList(tt.ret)}</div>
      </div>
      ${P.checks.length ? `<h3>Checks</h3><ul class="checks">${P.checks.map(([cls, t]) => `<li class="${cls}">${t}</li>`).join('')}</ul>` : ''}
      <p class="muted small">Drive times are free-flowing estimates; drives over 3 hours include a 15-minute rest stop every 2 hours, and departures are staggered so all cars arrive together. Allow extra for dirt roads and wildlife at dawn and dusk.
        Fuel allows for the climbs and descents on each road.</p>`)
      /* one plan per car, each starting on its own page (its timetable, stops, drives and directions) */
      + (P.cars.length ? P.cars.filter(c => c.complete).map(c => sheet('travel', paper, `🚗 ${esc(c.car.name)} — travel plan`, Travel.carPlan(P, c), 'car plan')).join('')
        : Travel.drivenLegs(P).length ? sheet('travel', paper, '🧭 Driving directions', Travel.drivenLegs(P).map(l => `<div class="card rpt-dir">${Travel.legDirections(l, true)}</div>`).join(''), 'directions') : '');
  }

  /* ---------- meals ---------- */
  function meals(X, paper) {
    const M = Meals.totals(), n = Math.max(1, st().people.length);
    return sheet('meals', paper, '🍳 Meal plan', `
      <table class="tbl compact rpt-plan"><thead><tr><th>Day</th>${Meals.SLOTS.map(s => `<th>${s[1]}</th>`).join('')}<th class="num">Food</th></tr></thead><tbody>
        ${X.days.map((d, i) => {
          const dp = st().mealPlan[d.key] || {};
          return `<tr><td><b>${d.label}</b><br><small>${d.date ? fmtDate(d.date) : ''}</small></td>
            ${Meals.SLOTS.map(([sl]) => `<td>${(dp[sl] || []).map(e => { const r = st().recipes.find(x => x.id === e.recipeId); return r ? `${esc(r.name)}${num(e.servings, 1) !== n ? ` <small>×${num(e.servings, 1)}</small>` : ''}` : ''; }).filter(Boolean).join('<br>') || '<span class="muted">—</span>'}</td>`).join('')}
            <td class="num">${fmtG(M.perDay[i]?.weightG || 0)}<br><small class="muted">${Math.round((M.perDay[i]?.kcal || 0) / n)} kcal pp</small></td></tr>`;
        }).join('')}</tbody></table>
      <div class="big-stats">
        <div><b>${fmtKg(M.weightG, 1)}</b><span>total food (group)</span></div>
        <div><b>${Math.round(M.weightG / n / Math.max(1, X.days.length))} g</b><span>per person per day</span></div>
        <div><b>${Math.round(M.kcal / n / Math.max(1, X.days.length))}</b><span>kcal per person per day</span></div>
        <div><b>${(M.waterMl / 1000).toFixed(1)} L</b><span>water for cooking</span></div>
        <div><b>${fmtMoney(M.cost)}</b><span>food cost</span></div>
      </div>
      <p class="muted small">Servings are for the whole group (${n}) unless shown (×n). Food is split evenly between packs.</p>`);
  }

  function shopping(X, paper) {
    const M = Meals.totals();
    const ing = [...M.ingredients.values()].sort((a, b) => a.name.localeCompare(b.name));
    const eq = [...M.equipment.values()].sort((a, b) => a.name.localeCompare(b.name));
    const qty = x => x.unit === 'g' && x.qty >= 1000 ? fmtKg(x.qty) : `${Math.round(x.qty * 100) / 100} ${esc(x.unit)}`;
    return sheet('shopping', paper, '🛒 Shopping list, cooking gear & recipes', `
      <h3>Shopping list</h3>
      <table class="tbl compact"><thead><tr><th></th><th>Ingredient</th><th class="num">Quantity</th><th class="num">Weight</th><th class="num">Cost</th><th>Used in</th></tr></thead><tbody>
        ${ing.map(x => `<tr><td>${st().shopping[x.key] ? '☑' : box}</td><td>${esc(x.name)}</td><td class="num">${qty(x)}</td><td class="num">${fmtG(x.weightG)}</td><td class="num">${x.cost ? fmtMoney(x.cost) : '—'}</td><td class="small muted">${[...x.recipes].map(esc).join(', ')}</td></tr>`).join('')}
      </tbody><tfoot><tr><th></th><th>Total</th><th></th><th class="num">${fmtG(M.weightG)}</th><th class="num">${fmtMoney(M.cost)}</th><th></th></tr></tfoot></table>
      ${eq.length ? `<h3>Cooking equipment</h3><table class="tbl compact"><thead><tr><th></th><th>Equipment</th><th>Needed for</th><th>On gear list</th></tr></thead><tbody>
        ${eq.map(x => { const g = Gear.has(x.name); return `<tr><td>${box}</td><td>${esc(x.name)}</td><td class="small muted">${[...x.recipes].map(esc).join(', ')}</td><td>${g ? '✔ ' + esc(g.name) : '<span class="bad-text">not on gear list</span>'}</td></tr>`; }).join('')}
      </tbody></table>` : ''}
      <h3>Recipes</h3>
      <div class="rpt-recipes">${Meals.usedRecipes().map(r => { const p = Meals.recipePerServing(r);
        return `<div class="rpt-recipe"><b>${esc(r.name)}</b> <small class="muted">${Meals.slotLabel(r.slot)} · ${fmtG(p.g)} · ${Math.round(p.kcal)} kcal per serving${num(r.waterMl) ? ` · ${num(r.waterMl)} mL water` : ''}</small>
          <div class="small">${r.ingredients.filter(i => i.name).map(i => `${esc(i.qty)} ${esc(i.unit)} ${esc(i.name)}`).join(' · ')}</div>
          ${r.equipment.length ? `<div class="small"><b>Equipment:</b> ${r.equipment.map(esc).join(', ')}</div>` : ''}
          ${r.notes ? `<div class="small">${esc(r.notes)}</div>` : ''}
          ${r.source && r.source.url ? `<div class="small muted">Adapted from ${esc(r.source.site || '')}: ${esc(r.source.url)}</div>` : ''}</div>`; }).join('')}</div>`);
  }

  /* ---------- gear & weight ---------- */
  function gear(X, paper) {
    const s = st(), G = s.gear;
    const inDrop = new Map();
    X.trails.forEach(f => (f.drops || []).forEach((dr, i) => (dr.gearIds || []).forEach(id => inDrop.set(id, `📦 drop ${i + 1}`))));
    const cats = [...new Set([...GEAR_CATEGORIES, ...G.map(g => g.category)])].filter(c => G.some(g => g.category === c));
    const tot = g => num(g.weightG) * num(g.qty, 1);
    const who = id => id === 'group' ? 'Group' : personName(id);
    return sheet('gear', paper, '🎒 Gear checklist', `
      <p class="small">${G.length} items · ${fmtKg(G.filter(g => g.type !== 'worn').reduce((a, g) => a + tot(g), 0), 1)} in packs · ${fmtKg(G.filter(g => g.type === 'worn').reduce((a, g) => a + tot(g), 0), 1)} worn.
        Carried by: ${['group', ...s.people.map(p => p.id)].map(id => `${esc(who(id))} ${fmtKg(G.filter(g => g.carrier === id && g.type !== 'worn').reduce((a, g) => a + tot(g), 0), 1)}`).join(' · ')}</p>
      <div class="rpt-gear">${cats.map(cat => `<div class="rpt-gcat"><h3>${esc(cat)} <small class="muted">${fmtG(G.filter(g => g.category === cat && g.type !== 'worn').reduce((a, g) => a + tot(g), 0))}</small></h3>
        <table class="tbl compact"><tbody>${G.filter(g => g.category === cat).map(g => `<tr><td class="c-pk">${g.packed ? '☑' : box}</td>
          <td>${esc(g.name)}${num(g.qty, 1) > 1 ? ` ×${num(g.qty, 1)}` : ''}${g.notes ? ` <small class="muted">${esc(g.notes)}</small>` : ''}
            ${g.type !== 'base' ? `<small class="muted"> · ${g.type === 'worn' ? 'worn' : 'consumable'}</small>` : ''}${g.source && g.source !== 'own' ? ` <small class="tag">${esc(Gear.SOURCES[g.source])}</small>` : ''}${inDrop.has(g.id) ? ` <small class="tag">${inDrop.get(g.id)}</small>` : ''}</td>
          <td class="small">${esc(who(g.carrier))}</td><td class="num">${fmtG(tot(g))}</td></tr>`).join('')}</tbody></table></div>`).join('')}</div>`);
  }

  function weight(X, paper) {
    const res = Weight.compute(), days = X.days;
    const group = res.reduce((s, r) => s + r.pack, 0);
    return sheet('weight', paper, '⚖️ Pack weights', `
      ${res.map(Weight.personCard).join('')}
      ${res.length > 1 ? `<p><b>Group total:</b> ${fmtKg(group, 1)} — ${res.map(r => `${esc(r.person.name)} ${fmtKg(r.pack, 1)}`).join(' · ')}</p>` : ''}
      ${days.length > 1 ? Weight.byDayCard(res, days) : ''}
      ${Weight.heaviestCard(res)}`);
  }

  /* ---------- risk & emergency ---------- */
  function risk(X, paper) {
    const R = st().risks.slice().sort((a, b) => Risk.score(b.l, b.c) - Risk.score(a.l, a.c));
    const badge = (l, c) => { const [t, cls] = Risk.rating(l, c); return `<span class="risk ${cls}">${t} <small>${Risk.score(l, c)}</small></span>`; };
    const em = st().emergency;
    return sheet('risk', paper, `⚠️ Risk assessment — ${esc(st().trip.location || st().trip.name)}`, `
      <div class="rpt-cols rpt-cols-risk">
        <div>${Risk.matrix()}</div>
        <div><table class="tbl compact"><thead><tr><th>Rating</th><th class="num">Before controls</th><th class="num">After controls</th></tr></thead><tbody>
          ${[['Extreme', 'ext'], ['High', 'high'], ['Medium', 'med'], ['Low', 'low']].map(([t, cls]) => `<tr><td><span class="risk ${cls}">${t}</span></td>
            <td class="num">${R.filter(r => Risk.rating(r.l, r.c)[0] === t).length}</td><td class="num">${R.filter(r => Risk.rating(r.rl, r.rc)[0] === t).length}</td></tr>`).join('')}</tbody></table>
          <p class="muted small">Rating = likelihood × consequence: Low 1–4 · Medium 5–9 · High 10–14 · Extreme 15–25.</p></div>
      </div>
      <table class="tbl compact rpt-risk"><thead><tr><th>Hazard &amp; cause</th><th>Location</th><th>L × C</th><th>Risk</th><th>Controls</th><th>Residual</th><th>Who</th></tr></thead><tbody>
        ${R.map(r => `<tr><td><b>${esc(r.hazard)}</b><br><small>${esc(r.cause)}</small></td><td class="small">${esc(r.location)}</td>
          <td class="small">${num(r.l)} ${Risk.LIKELIHOOD[num(r.l, 1) - 1]}<br>× ${num(r.c)} ${Risk.CONSEQUENCE[num(r.c, 1) - 1]}</td><td>${badge(r.l, r.c)}</td>
          <td class="small">${esc(r.controls)}</td><td>${badge(r.rl, r.rc)}</td><td class="small">${esc(r.owner || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No risks recorded.</td></tr>'}
      </tbody></table>
      <p class="small">Assessed by: <b>${esc(em.assessedBy || '________________')}</b> · Date: <b>${esc(em.assessedOn || '__________')}</b> · Reviewed by: <b>${esc(em.reviewedBy || '________________')}</b></p>`);
  }

  function emergency(X, paper) {
    const s = st(), em = s.emergency, t = s.trip;
    const camps = X.analysed.flatMap(T => T.legs.filter((l, i) => (l.to.kind === 'campsite' || l.to.night) && i < T.legs.length - 1).map(l => ({ day: l.day, s: l.to, T })));
    const eg = X.analysed.flatMap(T => Egress.fresh(T.f) ? T.f.egress.entries.map(e => ({ e, T })) : []);
    return sheet('emergency', paper, '⛑️ Emergency plan', `
      <p class="small">Leave a copy with your emergency contact. If the group is overdue, they call <b>000</b> and ask for the police, quoting the grid references below.</p>
      ${Risk.campLine()}
      <div class="au-numbers">
        <span><b>000</b> Police, fire, ambulance</span><span><b>112</b> mobiles, no coverage</span><span><b>132 500</b> SES</span>
        <span><b>131 444</b> Police Assistance</span><span><b>13 11 26</b> Poisons</span><span><b>1800 022 222</b> healthdirect</span>
      </div>
      <table class="kv rpt-em">${Risk.EMERGENCY.map(([k, l]) => `<tr><th>${l}</th><td>${esc(em[k] || '') || '<span class="rpt-blank"></span>'}</td></tr>`).join('')}</table>
      <h3>Party</h3>
      <table class="tbl compact"><thead><tr><th>Name</th><th>Car</th><th>Medical / notes</th></tr></thead><tbody>
        ${s.people.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${s.travel.cars.filter(c => c.driver === p.id).map(c => esc(c.name)).join(', ')}</td><td><span class="rpt-blank"></span></td></tr>`).join('')}
      </tbody></table>
      ${camps.length ? `<h3>Where we plan to be each night</h3><table class="tbl compact"><thead><tr><th>Night</th><th>Date</th><th>Campsite</th><th>Grid ref</th><th>Lat, long</th></tr></thead><tbody>
        ${camps.map(c => { const d = X.days[c.day - 1]; return `<tr><td>${c.day}</td><td>${d && d.date ? fmtDate(d.date) : ''}</td><td><b>${esc(c.s.name)}</b></td><td><b>${Geo.grText(c.s.lat, c.s.lng)}</b></td><td>${c.s.lat.toFixed(5)}, ${c.s.lng.toFixed(5)}</td></tr>`; }).join('')}
      </tbody></table>` : ''}
      ${eg.length ? `<h3>Vehicle access points (egress)</h3><table class="tbl compact"><thead><tr><th class="num">km</th><th>Road / track</th><th>Vehicle</th><th>Grid ref</th></tr></thead><tbody>
        ${eg.map(({ e }) => `<tr><td class="num">${kmTxt(e.d0)}</td><td><b>${esc(e.name)}</b> <small>${esc(e.where)}</small></td><td>${Egress.LEVELS[e.level].icon} ${Egress.LEVELS[e.level].label}</td><td><b>${Geo.grText(e.lat, e.lng)}</b></td></tr>`).join('')}
      </tbody></table>` : ''}
      ${t.state ? '' : ''}`);
  }

  /* ---------- weather ---------- */
  function weather(X, paper) {
    const W = st().weather, c = W.cache, t = st().trip;
    if (!c || c.key !== Weather.locKey()) return sheet('weather', paper, '🌦️ Weather & tides', '<p class="muted">Forecast not loaded yet — it loads when you are online.</p>');
    const d = c.data.daily, td = new Set(X.days.filter(x => x.date).map(x => isoDate(x.date)));
    const inTrip = d.time.filter(x => td.has(x));
    const rows = d.time.map((day, i) => ({ day, i })).filter(r => !inTrip.length || td.has(r.day));
    return sheet('weather', paper, `🌦️ Weather & tides — ${esc(t.location || 'camp')}`, `
      <p class="small">Forecast issued ${new Date(c.at).toLocaleString()} for ${num(t.lat).toFixed(4)}, ${num(t.lon).toFixed(4)} (Open-Meteo).
        ${inTrip.length ? `Showing your trip days${inTrip.length < td.size ? ` — ${td.size - inTrip.length} trip day(s) are beyond the 16-day forecast` : ''}.` : '<b>Your trip is outside the 16-day forecast — showing the next 16 days. Print again closer to the date.</b>'}</p>
      <table class="tbl compact"><thead><tr><th>Day</th><th>Weather</th><th class="num">Max / min</th><th class="num">Feels (min)</th><th class="num">Rain</th><th class="num">Wind / gusts</th><th class="num">UV</th><th class="num">Sunrise / sunset</th></tr></thead><tbody>
        ${rows.map(({ day, i }) => { const [ic, txt] = Weather.wmo(d.weather_code[i]); return `<tr class="${td.has(day) ? 'trip-row' : ''}">
          <td><b>${Weather.dayLabel(Weather.tms(day))}</b></td><td>${ic} ${txt}</td><td class="num"><b>${Math.round(d.temperature_2m_max[i])}°</b> / ${Math.round(d.temperature_2m_min[i])}°</td>
          <td class="num">${Math.round(d.apparent_temperature_min[i])}°</td><td class="num">${(d.precipitation_sum[i] ?? 0).toFixed(1)} mm${d.precipitation_probability_max[i] != null ? ` · ${d.precipitation_probability_max[i]}%` : ''}</td>
          <td class="num">${Math.round(d.wind_speed_10m_max[i])} / ${Math.round(d.wind_gusts_10m_max[i])} km/h ${Weather.dirText(d.wind_direction_10m_dominant[i])}</td>
          <td class="num">${d.uv_index_max[i] != null ? Math.round(d.uv_index_max[i]) : '—'}</td><td class="num">${Weather.hhmm(Weather.tms(d.sunrise[i]))} / ${Weather.hhmm(Weather.tms(d.sunset[i]))}</td></tr>`; }).join('')}
      </tbody></table>
      ${Weather.hourlyChart(c.data)}
      ${t.coastal ? Weather.tidesSection() : ''}
      <p class="muted small">Check the Bureau of Meteorology forecast and warnings, fire danger ratings and park alerts the day before you leave.</p>`);
  }

  /* ---------- budget ---------- */
  function budget(X, paper) {
    const { out } = Budget.lines(), total = out.reduce((s, l) => s + l.amount, 0), n = Math.max(1, st().people.length);
    const S = Budget.settle(out), target = num(st().budget.targetPP);
    const order = ['Fuel', 'Food', 'Gear', 'Camp fees'];
    const cats = [...new Set(out.map(l => l.cat))].sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
    return sheet('budget', paper, '💰 Budget', `
      <div class="big-stats">
        <div class="hero"><b>${fmtMoney(total)}</b><span>trip total</span></div>
        <div class="hero ${target ? (total / n <= target ? 'ok' : 'bad') : ''}"><b>${fmtMoney(total / n)}</b><span>per person (${n})${target ? ` · budget ${fmtMoney(target)}` : ''}</span></div>
      </div>
      <table class="tbl compact"><thead><tr><th>Category</th><th>Item</th><th>Paid by</th><th class="num">Amount</th></tr></thead>
        ${cats.map(cat => { const ls = out.filter(l => l.cat === cat); return `<tbody>${ls.map((l, i) => `<tr><td>${i ? '' : `<b>${esc(cat)}</b>`}</td><td>${esc(l.name)}</td><td>${esc(l.payer ? personName(l.payer) : '')}</td><td class="num">${fmtMoney(l.amount)}</td></tr>`).join('')}
          <tr class="rpt-sub"><td></td><td colspan="2">${esc(cat)} subtotal</td><td class="num"><b>${fmtMoney(ls.reduce((s, l) => s + l.amount, 0))}</b></td></tr></tbody>`; }).join('')}
        <tfoot><tr><th colspan="3">Total</th><th class="num">${fmtMoney(total)}</th></tr></tfoot></table>
      ${st().people.length > 1 ? `<h3>Settle up <small class="muted">(costs shared equally)</small></h3>
        ${S.transfers.length ? `<ul class="transfers">${S.transfers.map(([a, b, amt]) => `<li>💸 <b>${esc(a.name)}</b> pays <b>${esc(b.name)}</b> ${fmtMoney(amt)}</li>`).join('')}</ul>` : '<p>All square.</p>'}
        ${S.unassigned ? `<p class="small muted">${fmtMoney(S.unassigned)} has no payer yet and isn't included in the settle-up.</p>` : ''}` : ''}
      <p class="muted small">Estimates — confirm fees and prices when booking.</p>`);
  }

  const BUILD = { cover, itinerary, map: mapSheet, mapkey: mapKey, daymaps: dayMaps, traverse, egress, drops, travel, meals, shopping, gear, weight, risk, emergency, weather, budget };

  /* ---------- render ---------- */
  function render() {
    if (!bound) bind();
    destroyMaps();
    const C = cfg(), X = context();
    const included = SECTIONS.filter(([k]) => C.sections[k].on && available(k, X)).map(([k, title]) => [k, title, C.sections[k].paper]);
    const counts = {};
    let html = '';
    included.forEach(([k, , p]) => {
      let h = '';
      try { h = BUILD[k](X, p, included); } catch (e) { console.error(e); h = sheet(k, p, SECTIONS.find(x => x[0] === k)[1], `<p class="bad-text">Could not build this section: ${esc(e.message)}</p>`); }
      counts[p] = (counts[p] || 0) + (h.match(/class="rpt-sheet/g) || []).length;
      html += h;
    });
    root().innerHTML = `
      <div class="card rpt-tools no-print">
        <div class="page-head"><h2>Trip report</h2>
          <div class="btn-row">
            <button class="btn" data-r="mixed" title="Maps on A3, wide tables on A4 landscape, lists on A4 portrait">Mixed A4 + A3</button>
            <button class="btn" data-r="a4" title="For printers without A3">All A4</button>
            <button class="btn" data-r="refit" title="Re-fit every map to its route">↺ Re-fit maps</button>
            <button class="btn primary" data-r="print">🖨 Print / Save as PDF</button>
          </div></div>
        <p class="small">${included.length} sections · ${Object.entries(counts).map(([p, nn]) => `${nn} × ${PAPER[p].label}`).join(' · ')} (long sections continue onto more pages of the same size).
          <span id="rptStatus" class="muted"></span></p>
        <div class="rpt-sections">${SECTIONS.map(([k, title]) => {
          const ok = available(k, X), sc = C.sections[k];
          return `<label class="rpt-sec ${ok ? '' : 'off'}"><input type="checkbox" data-sec="${k}" ${sc.on && ok ? 'checked' : ''} ${ok ? '' : 'disabled'}> ${title}
            <select data-paper="${k}" ${ok ? '' : 'disabled'}>${Object.entries(PAPER).map(([pk, P]) => `<option value="${pk}" ${sc.paper === pk ? 'selected' : ''}>${P.label}</option>`).join('')}</select></label>`;
        }).join('')}</div>
        <div class="row wrap">
          <label class="check"><input type="checkbox" data-opt="labels" ${C.labels ? 'checked' : ''}> Label landmarks on maps</label>
          <label class="check"><input type="checkbox" data-opt="grid" ${C.grid ? 'checked' : ''}> MGA grid on maps</label>
          <label class="check" title="North–south days print on portrait pages and east–west days on landscape (same paper size). A diagonal day that would print smaller than 1:${(SPLIT_DIAG / 1000)}k is split over 2 pages."><input type="checkbox" data-opt="dayAuto" ${C.dayAuto ? 'checked' : ''}> Day maps: turn each page to suit the direction of travel, and split long diagonal days over 2 pages</label>
        </div>
        <p class="muted small">Use <b>Save as PDF</b> to keep each section's own page size. When printing, keep the scale at <b>100% / Default</b> and turn off the browser's headers and footers, so map scales are true and page numbers show.
          No A3 printer? Click <b>All A4</b>, or print the A3 map pages at a print shop. You can drag and zoom each map in the preview to frame it before printing.</p>
      </div>
      <div class="rpt-preview" id="rptPreview">${html}</div>`;
    buildMaps(X);
    paginate();
    fit();
    kick(X);
  }

  /* Fetch anything the report is still missing, then render again. */
  function kick(X) {
    const again = () => { clearTimeout(timer); timer = setTimeout(() => { if (App.current === 'report') render(); }, 500); };
    X.missing.forEach(f => { if (tried.has('elev' + f.id)) return; tried.add('elev' + f.id); MapView.fetchElevation(f, true).then(again); });
    X.analysed.forEach(T => {
      const f = T.f;
      if (!Egress.fresh(f) && !tried.has('eg' + f.id)) { tried.add('eg' + f.id); Egress.run(f).then(again).catch(() => {}); }
      if (Traverse.parksFor(f) === undefined && !tried.has('pk' + f.id)) { tried.add('pk' + f.id); Traverse.loadParks(f).then(again); }
    });
    if (st().trip.lat != null && !Weather.isFresh() && !tried.has('wx' + Weather.locKey())) { tried.add('wx' + Weather.locKey()); Weather.refresh().then(again); }
    if (X.P.needs.length) Travel.ensure(again);
    else if (!Travel.stopsReady() && Travel.needsStops(X.P) && !tried.has('stops')) { tried.add('stops'); Travel.loadStops().then(again); }
  }

  /* Each sheet is shown at real size where it fits, otherwise scaled down to the window. */
  function fit() {
    const pv = $('#rptPreview');
    if (!pv) return;
    const avail = pv.clientWidth - 8;
    $$('.rpt-sheet', pv).forEach(s => {
      const w = s.offsetWidth;
      s.style.zoom = w > avail ? (avail / w).toFixed(3) : '';
    });
  }

  /* ---------- Leaflet maps at print size ---------- */
  function destroyMaps() {
    maps.forEach(x => x.m.remove());
    maps = [];
  }

  function buildMaps(X) {
    const s = st(), C = cfg();
    $$('#rptPreview .rpt-map').forEach(el => {
      const key = el.dataset.map;
      const base = MapView.BASES[s.map.base] || MapView.BASES.topo;
      const m = L.map(el, { zoomSnap: 0.25, zoomDelta: 0.5, scrollWheelZoom: false, fadeAnimation: false, zoomAnimation: false, attributionControl: true });
      const rec = { m, key, el, loading: false, grid: null };
      const tiles = L.tileLayer(base.url, { ...base.opts, maxZoom: 19 }).addTo(m);
      tiles.on('loading', () => { rec.loading = true; status(); });
      tiles.on('load', () => { rec.loading = false; status(); });
      if (s.map.hillshade) L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 19, opacity: 0.35 }).addTo(m);
      L.control.scale({ imperial: false, maxWidth: 180 }).addTo(m);
      const North = L.Control.extend({ onAdd() { const d = L.DomUtil.create('div', 'north-arrow'); d.innerHTML = '<span>▲</span>N'; return d; } });
      new North({ position: 'topright' }).addTo(m);

      const focusTrail = el.dataset.trail ? s.map.features.find(f => f.id === el.dataset.trail) : null;
      const a = num(el.dataset.a), b = num(el.dataset.b);
      let focusCoords = null;
      s.map.features.forEach(f => {
        if (f !== focusTrail && MapView.isHidden(f)) return;      // hidden on the map: left off report maps too
        if (f.type === 'area') L.polygon(f.coords, { color: f.color, weight: 2, fillOpacity: 0.15, dashArray: '6 4', interactive: false }).addTo(m);
        if (f.type === 'trail') {
          const w = num(f.width, 4), dim = !!focusTrail;
          L.polyline(f.coords, { color: '#fff', weight: w + 4, opacity: dim ? 0.5 : 0.85, interactive: false }).addTo(m);
          L.polyline(f.coords, { color: f.color, weight: dim ? w - 1 : w, opacity: dim ? 0.45 : 1, dashArray: f.style === 'dashed' ? '10 8' : f.style === 'dotted' ? '1 8' : null, interactive: false }).addTo(m);
          if (f === focusTrail) {
            const cum = Geo.cumDist(f.coords);
            focusCoords = [Drops.pointAt(f, a), ...f.coords.filter((_, i) => cum[i] > a && cum[i] < b), Drops.pointAt(f, b)];
            L.polyline(focusCoords, { color: '#fff', weight: w + 6, opacity: 0.9, interactive: false }).addTo(m);
            L.polyline(focusCoords, { color: f.color, weight: w + 2, interactive: false }).addTo(m);
          }
        }
      });
      const lms = s.map.features.filter(f => f.type === 'landmark' && !MapView.isHidden(f));
      const labelled = labelPick(lms, focusCoords ? L.latLngBounds(focusCoords) : boundsAll());
      lms.forEach(f => {
        const k = MapView.KINDS[f.kind] || MapView.KINDS.waypoint;
        const mk = L.marker([f.lat, f.lng], { icon: L.divIcon({ className: 'lm-icon rpt-lm-icon', html: `<span>${k.icon}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }), interactive: false, keyboard: false }).addTo(m);
        if (C.labels && labelled.has(f.id)) mk.bindTooltip(esc(f.name), { permanent: true, className: 'map-label', direction: 'right', offset: [10, 0] });
      });
      /* numbered stops on day maps */
      if (focusTrail) {
        const T = X.analysed.find(A => A.f === focusTrail);
        T.stops.forEach((sp, i) => {
          if (sp.d < a - 1 || sp.d > b + 1) return;
          L.marker([sp.lat, sp.lng], { icon: L.divIcon({ className: 'rpt-stop', html: String(i + 1), iconSize: [18, 18], iconAnchor: [-6, 22] }), interactive: false }).addTo(m);
        });
      }
      if (s.trip.lat != null && !MapView.isHidden({ type: 'camp' })) L.marker([s.trip.lat, s.trip.lon], { icon: L.divIcon({ className: 'lm-icon rpt-lm-icon camp', html: '<span>⛺</span>', iconSize: [24, 24], iconAnchor: [12, 12] }), interactive: false }).addTo(m);

      const bounds = focusCoords ? L.latLngBounds(focusCoords) : boundsAll();
      const v = views.get(key);
      if (v) m.setView(v.c, v.z);
      else if (bounds) m.fitBounds(bounds, { padding: [24, 24], maxZoom: focusCoords ? 15 : 14 });
      else m.setView(s.map.center, s.map.zoom);
      const after = () => { drawGrid(rec); scaleText(rec); };
      m.on('moveend', after);
      m.on('dragend zoomend', () => { if (rec.ready) views.set(key, { c: m.getCenter(), z: m.getZoom() }); });
      after();
      setTimeout(() => { rec.ready = true; }, 300);
      maps.push(rec);
    });
    status();
  }

  /* Which landmarks get a name label: campsites and trailheads first, and nothing crowding a label already placed
     (closer than ~1/40 of the map's extent). Every landmark still gets its icon. */
  function labelPick(lms, bounds) {
    const out = new Set();
    if (!bounds) return out;
    const gap = Geo.hav([bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]) / 40;
    const rank = ['campsite', 'parking', 'summit', 'hut', 'evac', 'danger', 'crossing', 'lookout'];
    const placed = [];
    lms.slice().sort((a, b) => (rank.indexOf(a.kind) + 1 || 99) - (rank.indexOf(b.kind) + 1 || 99)).forEach(f => {
      if (placed.some(p => Geo.hav([p.lat, p.lng], [f.lat, f.lng]) < gap)) return;
      placed.push(f);
      out.add(f.id);
    });
    return out;
  }

  function boundsAll() {
    const s = st(), pts = [];
    s.map.features.forEach(f => { if (f.type === 'landmark') pts.push([f.lat, f.lng]); else (f.coords || []).forEach(c => pts.push(c)); });
    if (s.trip.lat != null) pts.push([s.trip.lat, s.trip.lon]);
    return pts.length ? L.latLngBounds(pts) : null;
  }

  /* Approximate printed scale (CSS mm = real mm when printed at 100%). */
  function scaleText(rec) {
    const el = $(`[data-scale="${rec.key}"]`);
    if (!el) return;
    const c = rec.m.getCenter(), z = rec.m.getZoom();
    const mpp = 40075016.686 * Math.cos(c.lat * Math.PI / 180) / (256 * 2 ** z);
    const scale = mpp / (0.0254 / 96);
    const r = scale >= 1000 ? Math.round(scale / 100) * 100 : Math.round(scale);
    el.textContent = `Scale ≈ 1:${String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} when printed at 100%`;
  }

  function drawGrid(rec) {
    if (rec.grid) { rec.grid.remove(); rec.grid = null; }
    const info = $(`[data-gridinfo="${rec.key}"]`);
    if (!cfg().grid) { if (info) info.textContent = ''; return; }
    const m = rec.m, b = m.getBounds(), c = m.getCenter();
    if (c.lat >= 0) return;
    const zone = Geo.zoneOf(c.lng);
    const corners = [b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()].map(p => Geo.toMGA(p.lat, p.lng, zone));
    const minE = Math.min(...corners.map(q => q.E)), maxE = Math.max(...corners.map(q => q.E));
    const minN = Math.min(...corners.map(q => q.N)), maxN = Math.max(...corners.map(q => q.N));
    const span = Math.max(maxE - minE, maxN - minN);
    const step = [1000, 2000, 5000, 10000, 20000, 50000, 100000].find(sx => span / sx <= 22) || 100000;
    const g = rec.grid = L.layerGroup().addTo(m);
    const style = { color: '#1c4f8a', weight: 0.7, opacity: 0.55, interactive: false };
    const label = v => step < 10000 ? String(Math.floor(v / 1000) % 100).padStart(2, '0') : String(Math.floor(v / 1000));
    const lab = (ll, t, cls) => L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'grid-label ' + cls, html: t, iconSize: null }) }).addTo(g);
    const topN = Geo.toMGA(b.getNorth(), c.lng, zone).N, leftE = Geo.toMGA(c.lat, b.getWest(), zone).E;
    for (let E = Math.ceil(minE / step) * step; E <= maxE; E += step) {
      const line = []; for (let k = 0; k <= 8; k++) line.push(Geo.fromMGA(E, minN + (maxN - minN) * k / 8, zone));
      L.polyline(line, style).addTo(g); lab(Geo.fromMGA(E, topN, zone), label(E), 'gl-e');
    }
    for (let N = Math.ceil(minN / step) * step; N <= maxN; N += step) {
      const line = []; for (let k = 0; k <= 8; k++) line.push(Geo.fromMGA(minE + (maxE - minE) * k / 8, N, zone));
      L.polyline(line, style).addTo(g); lab(Geo.fromMGA(leftE, N, zone), label(N), 'gl-n');
    }
    if (info) info.textContent = `MGA2020 zone ${zone} · ${step / 1000} km grid · GMA ≈ ${Geo.fmtDecl(Geo.declination(c.lat, c.lng) - Geo.convergence(c.lat, c.lng))}`;
  }

  function status(msg) {
    const el = $('#rptStatus');
    if (!el) return;
    const n = maps.filter(x => x.loading).length;
    el.textContent = msg || (n ? `Loading map tiles (${n} of ${maps.length} maps)…` : maps.length ? `${maps.length} map${maps.length > 1 ? 's' : ''} ready.` : '');
  }

  /* ---------- printing ---------- */
  async function print() {
    const t0 = Date.now();
    while (maps.some(x => x.loading) && Date.now() - t0 < 25000) {
      status('Waiting for map tiles before printing…');
      await new Promise(r => setTimeout(r, 300));
    }
    status();
    const name = String(st().trip.name || '').replace(/["\\]/g, '');
    /* page numbers and trip name in the page margins (browsers that support @page margin boxes) */
    $('#pageStyle').textContent = `@page { @bottom-left { content: "${name} · Emergency 000"; font: 8pt system-ui, sans-serif; color: #666; }
      @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt system-ui, sans-serif; color: #666; } }`;
    window.print();
  }

  function bind() {
    bound = true;
    const r = root();
    r.addEventListener('change', e => {
      const el = e.target, C = cfg();
      if (el.dataset.sec) C.sections[el.dataset.sec].on = el.checked;
      else if (el.dataset.paper && el.tagName === 'SELECT') { C.sections[el.dataset.paper].paper = el.value; views.clear(); }
      else if (el.dataset.opt) C[el.dataset.opt] = el.checked;
      else return;
      Store.save();
      render();
    });
    r.addEventListener('click', e => {
      const b = e.target.closest('button[data-r]');
      if (!b) return;
      const C = cfg();
      if (b.dataset.r === 'print') return print();
      if (b.dataset.r === 'mixed') SECTIONS.forEach(([k, , p]) => { C.sections[k].paper = p; });
      if (b.dataset.r === 'a4') SECTIONS.forEach(([k]) => { C.sections[k].paper = C.sections[k].paper.replace('a3', 'a4'); });
      views.clear();
      Store.save();
      render();
    });
    window.addEventListener('resize', () => { if (App.current === 'report') fit(); });
  }

  return { render, print, PAPER, SECTIONS };
})();
