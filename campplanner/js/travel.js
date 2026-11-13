/* Camp Planner — travel: driving distances home ↔ camp, car shuffle between walk start & finish,
   fuel use & cost per car, and a timed travel plan.
   Driving routes: Valhalla (OpenStreetMap) — the fastest route, alternatives and the shortest route, each with
   turn-by-turn directions and a road elevation profile; OSRM as a fallback. Fuel use allows for the climbs and
   descents on the road, and the route for each leg is chosen for time, fuel or a balance of both. */

const Travel = (() => {
  const SHUFFLE_KM = 1;        // start & finish further apart than this need a shuffle (or a shuttle)
  const BREAK_EVERY = 120, BREAK_MIN = 15, BREAK_OVER = 180; // driver reviver: drives over 3 h get a 15 min break every 2 h
  const BREAK_SLACK = 15;          // a rest stop can be 15 min either side of the 2-hour mark, to land in a town
  const FUEL_MIN = 15, BOTH_MIN = 20, RESERVE = 0.2;   // fuel stop 15 min, rest + fuel 20 min; refuel before 20% left
  const STOPS_SRC = 'data/stops.json?v=20261113a';
  let stopsData = null, stopsLoading = null, stopsErr = '';
  const MODES = {
    auto: 'Automatic',
    shuffle: 'Car shuffle (leave cars at the finish)',
    shuttle: 'Shuttle service / taxi from finish to start',
    none: 'No shuffle — loop walk or walk back to the start'
  };
  const VALHALLA = 'https://valhalla1.openstreetmap.de';
  const OPTIMISE = { balanced: 'Balance time and fuel', time: 'Fastest', fuel: 'Least fuel' };
  /* Energy in a litre / kWh (MJ) and how much of it reaches the wheels — for the climb / descent allowance */
  const ENERGY = { petrol: [34.2, 0.24], diesel: [38.6, 0.30], lpg: [26.0, 0.22], ev: [3.6, 0.85] };
  const energyOf = car => ENERGY[car.fuel === 'diesel' ? 'diesel' : car.fuel === 'lpg' ? 'lpg' : car.fuel === 'ev' ? 'ev' : 'petrol'];
  const MASS = 1900;          // kg — a loaded family car / small 4WD with people and gear
  let bound = false, map = null, fetching = false, progress = '', dirSel = '';
  const root = () => $('#tab-travel');
  const T = () => Store.state.travel;

  /* ---------- walk start & finish points ---------- */
  function pointOptions() {
    const st = Store.state, out = [];
    st.map.features.filter(f => f.type === 'trail').forEach(f => {
      const a = f.coords[0], b = f.coords[f.coords.length - 1];
      const s0 = f.stops?.[0]?.name, s1 = f.stops?.[f.stops.length - 1]?.name;
      out.push({ id: 'ts:' + f.id, name: s0 ? `${s0} (start of ${f.name})` : `Start of ${f.name}`, lat: a[0], lon: a[1] });
      out.push({ id: 'te:' + f.id, name: s1 ? `${s1} (end of ${f.name})` : `End of ${f.name}`, lat: b[0], lon: b[1] });
    });
    if (st.trip.lat != null) out.push({ id: 'camp', name: 'Camp' + (st.trip.location ? ` – ${st.trip.location}` : ''), lat: st.trip.lat, lon: st.trip.lon });
    const order = ['parking', 'campsite'];
    st.map.features.filter(f => f.type === 'landmark')
      .sort((a, b) => (order.indexOf(a.kind) + 1 || 9) - (order.indexOf(b.kind) + 1 || 9))
      .forEach(f => out.push({ id: 'lm:' + f.id, name: `${(MapView.KINDS[f.kind] || {}).icon || '📍'} ${f.name}`, lat: f.lat, lon: f.lng }));
    return out;
  }
  function defaultIds() {
    const trails = Store.state.map.features.filter(f => f.type === 'trail');
    return trails.length ? ['ts:' + trails[0].id, 'te:' + trails[trails.length - 1].id] : ['camp', 'camp'];
  }
  function point(which) {
    const opts = pointOptions(), i = which === 'start' ? 0 : 1;
    return opts.find(o => o.id === T()[which + 'Id']) || opts.find(o => o.id === defaultIds()[i]) || null;
  }
  /* Walking distance from start to finish: the trail joining them, else all trails. */
  function walkKm(S, F) {
    const trails = Store.state.map.features.filter(f => f.type === 'trail');
    const one = trails.find(f => S && F && S.id === 'ts:' + f.id && F.id === 'te:' + f.id);
    return (one ? Geo.lineLength(one.coords) : trails.reduce((s, f) => s + Geo.lineLength(f.coords), 0)) / 1000;
  }

  /* ---------- cars & fuel ---------- */
  const fuelOf = car => FUEL_TYPES[car.fuel] || FUEL_TYPES.ulp91;
  const priceOf = car => num(T().prices[car.fuel], fuelOf(car).price);
  const homeOf = car => (car.home && car.home.lat != null ? car.home : T().home);
  const valid = p => p && p.lat != null && p.lon != null;
  const roleOf = car => car.role === 'finish' ? 'finish' : 'start';

  /* ---------- driving routes ----------
     Stored per direction (turns and climbs differ each way): T().routes['lat,lon>lat,lon'] =
       { alts: [{ label, via, km, min, coords, steps: [[instruction, km, min]], elev: { d: [m], h: [m] }, up, down }], src, est? }
     T().routePick[key] = index chosen by hand; otherwise the best by T().optimise. */
  const pkey = p => `${(+p.lat).toFixed(4)},${(+p.lon).toFixed(4)}`;
  const rkey = (a, b) => `${pkey(a)}>${pkey(b)}`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* The chosen alternative of a leg as { km, min, coords, est, alt, rec, key, pick, auto } */
  function route(a, b, car) {
    if (!valid(a) || !valid(b)) return null;
    if (Geo.hav([a.lat, a.lon], [b.lat, b.lon]) < 200) return { km: 0, min: 0, coords: [], alt: null };
    const key = rkey(a, b), rec = T().routes[key];
    if (!rec || !rec.alts || !rec.alts.length) return null;
    const auto = bestAlt(rec), hand = num((T().routePick || {})[key], -1);
    const pick = hand >= 0 && hand < rec.alts.length ? hand : auto;
    const alt = rec.alts[pick];
    return { km: alt.km, min: alt.min, coords: alt.coords, est: !!rec.est, alt, rec, key, pick, auto, manual: pick !== auto };
  }

  /* ---------- fuel: flat-road economy, plus the climbs, less the descents ----------
     Climbing m·g·h needs extra fuel at the engine's efficiency. Going downhill the car's weight does the work, so
     the engine uses less — down to almost nothing — but no more is saved than the flat-road fuel for that stretch
     (brakes waste the rest). Electric cars get some back by regenerative braking. */
  function fuelFor(alt, car, km) {
    const econ = carEcon(car);
    const flat = (alt ? alt.km : km || 0) * econ / 100;
    if (!alt || !alt.elev || alt.elev.d.length < 2) return { amount: flat, flat, extra: 0, saved: 0 };
    const [mj, eff] = energyOf(car), mass = num(car.mass, MASS), ev = car.fuel === 'ev';
    const { d, h } = alt.elev, scale = alt.km * 1000 / (d[d.length - 1] || 1);
    let extra = 0, saved = 0;
    for (let i = 1; i < d.length; i++) {
      const dz = h[i] - h[i - 1], seg = (d[i] - d[i - 1]) * scale / 1000 * econ / 100;
      const units = mass * 9.81 * Math.abs(dz) / 1e6 / mj;          // energy of the height change, in litres / kWh
      if (dz > 0) extra += units / eff;
      else if (dz < 0) saved += ev ? Math.min(seg * 1.5, units * eff * 0.7 + Math.min(seg, units)) : Math.min(seg * 0.9, units / eff);
    }
    return { amount: Math.max(flat * 0.3, flat + extra - saved), flat, extra, saved };
  }
  const carEcon = car => num(car.economy, fuelOf(car).economy) * (1 + num(car.extraPct) / 100);
  const refCar = () => T().cars[0] || { fuel: 'ulp91', economy: FUEL_TYPES.ulp91.economy, extraPct: 10, mass: MASS };

  /* Pick the route for a leg: fastest, least fuel, or the lowest cost counting time at $/hour */
  function bestAlt(rec) {
    const c = refCar(), how = T().optimise || 'balanced', value = num(T().timeValue, 25);
    const score = a => {
      const f = fuelFor(a, c).amount;
      if (how === 'time') return a.min + f * 1e-3;
      if (how === 'fuel') return f + a.min * 1e-4;
      return f * priceOf(c) + a.min / 60 * value;
    };
    let best = 0;
    rec.alts.forEach((a, i) => { if (score(a) < score(rec.alts[best])) best = i; });
    return best;
  }

  /* Valhalla polyline6 → [[lat, lon]] */
  function decode6(str) {
    const out = [];
    let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const v = res & 1 ? ~(res >> 1) : res >> 1;
        if (k === 0) lat += v; else lon += v;
      }
      out.push([lat / 1e6, lon / 1e6]);
    }
    return out;
  }
  const thin = (pts, max) => { const st = Math.max(1, Math.ceil(pts.length / max)); return pts.filter((_, i) => i % st === 0 || i === pts.length - 1).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]); };

  async function vpost(path, body) {
    const r = await fetch(VALHALLA + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || 'route service ' + r.status);
    return j;
  }

  /* The longest-driven road names on a route, for "via …" */
  function viaOf(maneuvers) {
    const len = new Map();
    maneuvers.forEach(m => (m.street_names || []).slice(0, 1).forEach(n => len.set(n, (len.get(n) || 0) + m.length)));
    return [...len.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(x => x[0]).join(' & ');
  }

  async function valhallaRoute(a, b) {
    const locs = [{ lat: +a.lat, lon: +a.lon }, { lat: +b.lat, lon: +b.lon }];
    const sealed = T().avoidUnsealed ? { exclude_unpaved: true } : {};
    const base = { locations: locs, costing: 'auto', costing_options: { auto: { ...sealed } }, directions_options: { units: 'kilometers', language: 'en-AU' } };
    const fast = await vpost('/route', { ...base, alternates: 2 });
    await sleep(1100);
    let short = null;
    try { short = (await vpost('/route', { ...base, costing_options: { auto: { ...sealed, shortest: true } } })).trip; } catch (e) { /* optional */ }
    const trips = [[fast.trip, 'Fastest'], ...(fast.alternates || []).map(x => [x.trip, 'Alternative']), ...(short ? [[short, 'Shortest']] : [])];
    const alts = [];
    for (const [t, label] of trips) {
      const leg = t.legs[0], km = t.summary.length, min = t.summary.time / 60;
      if (alts.some(x => Math.abs(x.km - km) < Math.max(0.3, km * 0.01) && Math.abs(x.min - min) < Math.max(1, min * 0.02))) continue;   // the same road
      alts.push({
        label, km: +km.toFixed(2), min: +min.toFixed(1), via: viaOf(leg.maneuvers), shape: leg.shape,
        coords: thin(decode6(leg.shape), 400),
        steps: leg.maneuvers.map(m => [m.instruction, +m.length.toFixed(2), +(m.time / 60).toFixed(1)])
      });
    }
    /* road elevation for each alternative */
    for (const alt of alts) {
      try {
        await sleep(1100);
        const j = await vpost('/height', { encoded_polyline: alt.shape, shape_format: 'polyline6', range: true, resample_distance: Math.max(150, Math.round(alt.km * 1000 / 300)) });
        const pts = (j.range_height || []).filter(p => p[1] != null && p[1] > -500);
        if (pts.length > 1) alt.elev = { d: pts.map(p => Math.round(p[0])), h: pts.map(p => Math.round(p[1])) };
      } catch (e) { /* profile is optional */ }
      delete alt.shape;
      climbStats(alt);
    }
    return { alts, src: 'Valhalla (OpenStreetMap)' };
  }

  /* Total climb / descent (lightly smoothed against terrain-model noise) and the steepest kilometre */
  function climbStats(alt) {
    if (!alt.elev) { alt.up = alt.down = null; return; }
    const h = alt.elev.h, sm = h.map((v, i) => (h[Math.max(0, i - 1)] + v + h[Math.min(h.length - 1, i + 1)]) / 3);
    let up = 0, down = 0;
    for (let i = 1; i < sm.length; i++) { const dz = sm[i] - sm[i - 1]; if (dz > 0) up += dz; else down -= dz; }
    alt.up = Math.round(up); alt.down = Math.round(down);
    alt.high = Math.max(...h); alt.low = Math.min(...h);
  }

  /* Fallback: OSRM (no road names in the instructions beyond the street, no alternatives on most country roads) */
  async function osrmRoute(a, b) {
    const j = await getJSON(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&steps=true&alternatives=2`);
    const word = { turn: 'Turn', 'new name': 'Continue', depart: 'Head off', arrive: 'Arrive', merge: 'Merge', 'on ramp': 'Take the ramp', 'off ramp': 'Take the exit', fork: 'Keep', 'end of road': 'Turn', continue: 'Continue', roundabout: 'At the roundabout, take the exit', rotary: 'At the roundabout, take the exit' };
    return {
      src: 'OSRM (OpenStreetMap)',
      alts: j.routes.map((r, i) => {
        const steps = r.legs[0].steps.map(st => {
          const m = st.maneuver, name = st.name || st.ref || '';
          const txt = m.type === 'arrive' ? 'Arrive at your destination.' : `${word[m.type] || 'Continue'}${m.modifier && !['roundabout', 'rotary'].includes(m.type) ? ' ' + m.modifier : ''}${name ? ' onto ' + name : ''}.`;
          return [txt, +(st.distance / 1000).toFixed(2), +(st.duration / 60).toFixed(1)];
        });
        const alt = { label: i ? 'Alternative' : 'Fastest', km: +(r.distance / 1000).toFixed(2), min: +(r.duration / 60).toFixed(1), via: '', steps,
          coords: thin(r.geometry.coordinates.map(c => [c[1], c[0]]), 400) };
        climbStats(alt);
        return alt;
      })
    };
  }

  async function fetchRoute(a, b) {
    try { return await valhallaRoute(a, b); } catch (e) { /* try the other service */ }
    try { return await osrmRoute(a, b); } catch (e) { /* offline */ }
    const km = Geo.hav([a.lat, a.lon], [b.lat, b.lon]) / 1000 * 1.3; // rough road factor
    return { est: true, src: 'straight-line estimate', alts: [{ label: 'Estimate', km, min: km / 70 * 60, coords: [[a.lat, a.lon], [b.lat, b.lon]], steps: [], via: '' }] };
  }

  /* Fetch any routes the plan needs, then call done(). */
  async function ensure(done) {
    const P = plan();
    if (!P.needs.length || fetching) return;
    fetching = true;
    const todo = [];
    P.needs.forEach(([a, b]) => { if (!todo.some(([x, y]) => rkey(x, y) === rkey(a, b))) todo.push([a, b]); });
    for (let i = 0; i < todo.length; i++) {
      const [a, b] = todo[i];
      progress = `Finding routes, road profiles and directions… ${i + 1} of ${todo.length}`;
      const el = $('#trvProgress'); if (el) el.textContent = progress;
      if (!T().routes[rkey(a, b)]) T().routes[rkey(a, b)] = await fetchRoute(a, b);
    }
    progress = '';
    fetching = false;
    /* Drop cached routes the plan no longer uses. */
    const used = new Set(plan().used);
    for (const k of Object.keys(T().routes)) if (!used.has(k)) delete T().routes[k];
    Store.save();
    if (done) done();
  }

  /* ---------- the plan ---------- */
  function plan() {
    const tr = T(), cars = tr.cars, nPeople = Store.state.people.length;
    const S = point('start'), F = point('finish'), H = tr.home;
    const apart = valid(S) && valid(F) ? Geo.hav([S.lat, S.lon], [F.lat, F.lon]) / 1000 : 0;
    const through = apart > SHUFFLE_KM;
    let mode = tr.mode;
    if (mode === 'auto') mode = !through ? 'none' : cars.length >= 2 ? 'shuffle' : 'shuttle';
    if (!through && mode !== 'none') mode = 'none';
    const needs = [], used = [];
    const leg = (label, a, b, phase, car) => {
      const r = route(a, b, car);
      if (valid(a) && valid(b)) { used.push(rkey(a, b)); if (!r) needs.push([a, b]); }
      return { label, a, b, phase, r };
    };
    /* headline distances from the group home */
    const toStart = leg('Home → start', H, S), between = leg('Start ↔ finish', S, F), fromFinish = leg('Finish → home', F, H);
    const carPlans = cars.map(car => {
      const h = homeOf(car), role = roleOf(car);
      let legs;
      const L = (label, a, b, phase) => leg(label, a, b, phase, car);
      if (mode === 'shuffle') legs = role === 'start'
        ? [L('Home → finish', h, F, 'out'), L('Finish → start (carrying the group)', F, S, 'out'), L('Start → home', S, h, 'ret')]
        : [L('Home → finish (car left here)', h, F, 'out'), L('Finish → start (carrying start-car drivers)', F, S, 'ret'), L('Start → home', S, h, 'ret')];
      else if (mode === 'shuttle') legs = [L('Home → finish (car left here)', h, F, 'out'), L('Finish → home', F, h, 'ret')];
      else legs = [L('Home → start', h, S, 'out'), L('Start → home', S, h, 'ret')];
      const complete = legs.every(l => l.r);
      const km = legs.reduce((s, l) => s + (l.r ? l.r.km : 0), 0), min = legs.reduce((s, l) => s + (l.r ? l.r.min : 0), 0);
      const f = fuelOf(car), econ = carEcon(car);
      legs.forEach(l => { l.fuel = l.r ? fuelFor(l.r.alt, car, l.r.km) : null; });
      const amount = legs.reduce((s, l) => s + (l.fuel ? l.fuel.amount : 0), 0), flat = legs.reduce((s, l) => s + (l.fuel ? l.fuel.flat : 0), 0);
      const up = legs.reduce((s, l) => s + (l.r && l.r.alt && l.r.alt.up || 0), 0), down = legs.reduce((s, l) => s + (l.r && l.r.alt && l.r.alt.down || 0), 0);
      const cost = amount * priceOf(car);
      const range = num(car.tank) ? num(car.tank) / econ * 100 : null;
      return { car, home: h, role, legs, complete, km, min, econ, amount, flat, up, down, unit: f.unit, price: priceOf(car), cost, range };
    });
    const P = { S, F, H, apart, through, mode, cars: carPlans, toStart, between, fromFinish, needs, used, nPeople, walkKm: walkKm(S, F) };
    P.fuelCost = carPlans.reduce((s, c) => s + c.cost, 0);
    P.km = carPlans.reduce((s, c) => s + c.km, 0);
    P.shuttleCost = mode === 'shuttle' ? num(tr.shuttleCost) : 0;
    P.checks = checks(P);
    return P;
  }

  function checks(P) {
    const out = [], cars = P.cars, seats = list => list.reduce((s, c) => s + num(c.car.seats, 5), 0);
    if (!valid(P.H)) out.push(['bad', 'Set your home location on the <a href="#trip" data-goto="trip">Trip tab</a>.']);
    if (!valid(P.S)) out.push(['bad', 'Set a camp location or map a trail so the walk start is known.']);
    if (!cars.length) out.push(['bad', 'Add the cars travelling to the trip.']);
    if (cars.length && seats(cars) < P.nPeople) out.push(['bad', `Only ${seats(cars)} seats for ${P.nPeople} people.`]);
    if (P.mode === 'shuffle') {
      const st = cars.filter(c => c.role === 'start'), fi = cars.filter(c => c.role === 'finish');
      if (!fi.length) out.push(['bad', 'Car shuffle: mark at least one car “Left at finish”.']);
      if (!st.length) out.push(['bad', 'Car shuffle: at least one car must wait at the start.']);
      if (st.length && seats(st) < P.nPeople) out.push(['warn', `Start car(s) seat ${seats(st)} but all ${P.nPeople} people ride from the finish to the start — two trips needed, or move a bigger car to the start.`]);
      if (fi.length && seats(fi) < P.nPeople) out.push(['warn', `Finish car(s) seat ${seats(fi)} but everyone (${P.nPeople}) leaves the finish together — two trips needed, or leave a bigger car at the finish.`]);
      out.push(['tip', '🔑 Carry the keys for the finish car(s) on the walk — not locked in a car at the start.']);
    }
    if (P.mode === 'shuttle' && !num(T().shuttleCost)) out.push(['warn', 'Book a shuttle / taxi from the finish to the start, and enter its cost below so it shows in the Budget.']);
    if (P.mode === 'none' && P.through) out.push(['warn', `Start and finish are ${P.apart.toFixed(1)} km apart — with no shuffle you must walk back to the start.`]);
    cars.forEach(c => {
      if (c.range && c.km > c.range * 0.9) out.push(['warn', `${esc(c.car.name)}: ${Math.round(c.km)} km trip vs ~${Math.round(c.range)} km per ${c.unit === 'kWh' ? 'charge' : 'tank'} — plan a ${c.unit === 'kWh' ? 'charging stop' : 'refuel'} (fill up in the last town before the park).`]);
      if (c.unit === 'kWh') out.push(['tip', `${esc(c.car.name)} is electric — check chargers along the route; remote trailheads rarely have one.`]);
    });
    if (P.cars.length && startTime()) {
      schedule(P);
      const early = P.cars.filter(c => c.drive != null && c.leaveAt < 5 * 60);
      if (early.length) out.push(['warn', `${early.map(c => esc(c.car.name)).join(', ')} would leave at ${early.map(c => clock(c.leaveAt).replace(/<[^>]+>/g, '')).join(', ')} to start walking at ${esc(startTime() || '')} — consider a later start, or driving up the day before.`]);
    }
    if (P.cars.some(c => c.legs.some(l => l.r && l.r.est))) out.push(['warn', 'Some distances are straight-line estimates (route service unavailable) — press Recalculate when online.']);
    return out;
  }

  /* ---------- timetable ---------- */
  const toMin = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const clock = m => {
    const d = Math.floor(m / 1440), mm = ((Math.round(m) % 1440) + 1440) % 1440;
    return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}${d > 0 ? ` <small>(+${d} day)</small>` : d < 0 ? ' <small>(the day before)</small>' : ''}`;
  };
  /* Rest stops: only on drives over 3 hours — 15 minutes after every 2 hours of driving (none at the very end) */
  const breaksIn = min => (min > BREAK_OVER ? Math.floor((min - 1) / BREAK_EVERY) : 0);
  const withBreaks = min => min + breaksIn(min) * BREAK_MIN;

  /* Minutes from the cars meeting up to the group starting to walk (parking, the shuffle or shuttle drive) */
  function walkOffset(P) {
    const fs = P.between.r ? withBreaks(P.between.r.min) : 0;
    return P.mode === 'shuffle' ? 30 + fs : P.mode === 'shuttle' ? 25 + fs : 20;
  }
  const startTime = () => /^\d{1,2}:\d{2}$/.test(Store.state.trip.startTime || '') ? Store.state.trip.startTime : '';

  /* Staggered departures so every car arrives at the meeting point (the walk start, or the finish for a shuffle /
     shuttle) at the same time. With a walk start time (Trip tab) the plan works backwards from it; otherwise the car
     with the longest drive leaves at "First car leaves home at". */
  function schedule(P) {
    if (stopsData) P.cars.forEach(c => planStops(c));
    const drives = P.cars.map(c => (c.legs[0] && c.legs[0].r ? c.legs[0].r.min + legStopMin(c, 0) : null));
    const longest = Math.max(0, ...drives.filter(x => x != null));
    const fromStart = !!startTime();
    const meet = fromStart ? toMin(startTime()) - walkOffset(P) : toMin(T().departTime) + longest;
    const dep = meet - longest;
    P.fromStart = fromStart;
    P.cars.forEach((c, i) => {
      c.drive = drives[i];
      c.stops = drives[i] == null ? 0 : c.stopPlan ? c.stopPlan.legs[0].stops.length : breaksIn(c.legs[0].r.min);
      c.leaveAt = drives[i] == null ? dep : meet - drives[i];
      c.arriveAt = drives[i] == null ? null : meet;
    });
    return { dep, meet, longest, fromStart };
  }

  /* ---------- rest & fuel stops ----------
     Towns, roadhouses and rest areas near the chosen road (data/stops.json, from OpenStreetMap), and a plan per car:
     every car starts with a full tank; rest every 2 h (± 15 min) on drives over 3 h; refuel before 20% is left —
     combined with a rest stop where possible; towns first (bigger towns, places with fuel), then roadhouses, then
     rest areas, and only if there's nothing else a stop on the open road. */
  function loadStops() {
    if (stopsData || stopsLoading) return stopsLoading;
    stopsLoading = fetch(STOPS_SRC).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(j => { stopsData = j.items; stopsErr = ''; return stopsData; })
      .catch(e => { stopsErr = 'Town list unavailable (' + e.message + ')'; stopsLoading = null; return null; });
    return stopsLoading;
  }
  const candCache = new WeakMap();

  /* Places near a route with their distance along it (km, scaled to the route's real length) */
  function candidates(alt) {
    if (!stopsData || !alt || !alt.coords || alt.coords.length < 2) return [];
    if (candCache.has(alt)) return candCache.get(alt);
    const c = alt.coords, lat0 = c[0][0], kx = Math.cos(lat0 * Math.PI / 180) * 111.32, ky = 110.54;
    const cum = [0];
    for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + Math.hypot((c[i][1] - c[i - 1][1]) * kx, (c[i][0] - c[i - 1][0]) * ky));
    const scale = alt.km / (cum[cum.length - 1] || 1);
    let s = 90, w = 180, n = -90, e = -180;
    c.forEach(([la, lo]) => { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); });
    const out = [];
    for (const it of stopsData) {
      const [name, la, lo, cls, fuel, ev, toilets] = it;
      if (la < s - 0.1 || la > n + 0.1 || lo < w - 0.1 || lo > e + 0.1) continue;
      const lim = cls === 3 ? 8 : cls >= 1 ? 4 : cls === 0 ? 1.5 : 0.5;     // km off the road
      let best = { off: Infinity, d: 0 };
      for (let i = 1; i < c.length; i++) {
        const ax = (c[i - 1][1] - lo) * kx, ay = (c[i - 1][0] - la) * ky, dx = (c[i][1] - c[i - 1][1]) * kx, dy = (c[i][0] - c[i - 1][0]) * ky;
        const L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
        const off = Math.hypot(ax + t * dx, ay + t * dy);
        if (off < best.off) best = { off, d: cum[i - 1] + t * (cum[i] - cum[i - 1]) };
      }
      if (best.off <= lim) out.push({ name, lat: la, lon: lo, cls, fuel: fuel > 0, ev: !!ev, toilets: !!toilets, d: best.d * scale, off: best.off });
    }
    out.sort((a, b) => a.d - b.d);
    /* one entry per place (a town can sit near the road twice) */
    const uniq = out.filter((x, i) => !out.some((y, j) => j < i && y.name === x.name && Math.abs(y.d - x.d) < 15));
    candCache.set(alt, uniq);
    return uniq;
  }

  /* Driving minutes at a distance along the route (from the turn-by-turn steps), and back */
  function clockOf(alt) {
    const K = [0], M = [0];
    (alt.steps || []).forEach(([, km, min]) => { K.push(K[K.length - 1] + km); M.push(M[M.length - 1] + min); });
    const sk = alt.km / (K[K.length - 1] || alt.km || 1), sm = alt.min / (M[M.length - 1] || alt.min || 1);
    const k = K.map(x => x * sk), m = M.map(x => x * sm);
    const interp = (xs, ys, v) => {
      if (xs.length < 2) return v * (ys === m ? alt.min / alt.km : alt.km / alt.min);
      if (v <= 0) return 0;
      for (let i = 1; i < xs.length; i++) if (xs[i] >= v) { const f = (v - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1); return ys[i - 1] + f * (ys[i] - ys[i - 1]); }
      return ys[ys.length - 1];
    };
    return { minAt: d => interp(k, m, d), kmAt: t => interp(m, k, t) };
  }

  const placeKind = s => s.cls === 3 ? 'city' : s.cls === 2 ? 'town' : s.cls === 1 ? 'village' : s.cls === 0 ? 'service station' : s.cls === -1 ? 'rest area' : 'roadside';

  /* Plan one car's stops across its legs (fuel carried over from leg to leg). Fills c.stopPlan. */
  function planStops(c) {
    const car = c.car, tank = num(car.tank), ev = car.fuel === 'ev';
    let fuel = tank;                                              // every car starts with a full tank
    const warn = [];
    const legs = c.legs.map(l => {
      const out = { stops: [], extra: 0, fuelStart: fuel, fuelEnd: null };
      if (!l.r || !l.r.alt || !l.r.km) return out;
      const alt = l.r.alt, total = alt.km, T0 = clockOf(alt), totMin = alt.min;
      const perKm = (l.fuel ? l.fuel.amount : total * c.econ / 100) / total;
      const cands = candidates(alt).filter(x => x.d > 3 && x.d < total - 3);
      const canFuel = x => (ev ? x.ev : x.fuel);
      const reserve = tank * RESERVE;
      const needRest = totMin > BREAK_OVER;
      let pos = 0, last = 0;                                       // km and driving minutes at the last stop
      for (let guard = 0; guard < 25; guard++) {
        const limKm = tank ? pos + Math.max(0, fuel - reserve) / perKm : Infinity;   // where the tank reaches 20%
        const fuelNeeded = limKm < total;
        const restDue = needRest && totMin - last > BREAK_EVERY + BREAK_SLACK;
        if (!fuelNeeded && !restDue) break;
        const tWin = [last + BREAK_EVERY - BREAK_SLACK, last + BREAK_EVERY + BREAK_SLACK];
        const limMin = T0.minAt(limKm);
        let pick = null, why = '';
        const score = (x, target) => x.cls * 3 + (x.toilets ? 1 : 0) - Math.abs(T0.minAt(x.d) - target) / 10;
        if (fuelNeeded && limMin < tWin[0] + (restDue ? 0 : 1e9)) {
          /* fuel runs low before the next rest is due: refuel at the best place before the limit (prefer later) */
          const opts = cands.filter(x => x.d > pos + 1 && x.d <= limKm && canFuel(x));
          pick = opts.sort((a, b) => (b.cls * 3 + b.d / limKm * 4) - (a.cls * 3 + a.d / limKm * 4))[0] || null;
          why = 'fuel';
          if (!pick) { warn.push(`${esc(car.name)}: no ${ev ? 'charger' : 'fuel'} found before the ${ev ? 'battery' : 'tank'} gets low on ${esc(l.label.toLowerCase())} — fill up beforehand${ev ? '' : ' or carry a jerry can'}.`); break; }
        } else if (restDue) {
          const target = last + BREAK_EVERY;
          const inWin = (lo, hi) => cands.filter(x => x.d > pos + 1 && x.d <= limKm + (fuelNeeded ? 0 : 1e9) && T0.minAt(x.d) >= lo && T0.minAt(x.d) <= hi);
          /* fuel soon (before the following rest) → strongly prefer somewhere with fuel */
          const fuelSoon = tank && T0.minAt(limKm) < tWin[1] + BREAK_EVERY;
          const rank = x => score(x, target) + (fuelSoon && canFuel(x) ? 6 : canFuel(x) ? 1 : 0);
          let opts = inWin(tWin[0], tWin[1]).filter(x => x.cls >= 0);
          if (!opts.length) opts = inWin(tWin[0], tWin[1]);                         // rest areas
          if (!opts.length) opts = inWin(last + 90, last + 150);                    // a little wider
          pick = opts.sort((a, b) => rank(b) - rank(a))[0] || null;
          if (!pick) {
            const d = T0.kmAt(Math.min(target, totMin - 10));
            pick = { name: 'a safe spot by the road', cls: -2, d, off: 0, fuel: false, ev: false, roadside: true };
          }
          why = 'rest';
        } else break;
        /* drive to the stop */
        fuel -= (pick.d - pos) * perKm;
        const fill = canFuel(pick) && tank && (fuelNeeded && (why === 'fuel' || T0.minAt(limKm) < T0.minAt(pick.d) + BREAK_EVERY + BREAK_SLACK) || fuel < tank * 0.45);
        const rest = why === 'rest' || T0.minAt(pick.d) - last > 60;
        const dur = fill && rest ? BOTH_MIN : fill ? FUEL_MIN : BREAK_MIN;
        out.stops.push({ ...pick, at: T0.minAt(pick.d), fill, rest, dur, fuelBefore: fuel, kind: placeKind(pick) });
        if (fill) fuel = tank;
        pos = pick.d; last = T0.minAt(pick.d);
        out.extra += dur;
      }
      /* heading to the walk: top up in the last town before the trailhead if under half full, so the trip home starts well */
      if (tank && l.phase === 'out' && fuel - (total - pos) * perKm < tank * 0.5) {
        const near = cands.filter(x => canFuel(x) && x.d > Math.max(pos + 1, total - 60)).sort((a, b) => (b.cls * 2 + b.d / total) - (a.cls * 2 + a.d / total))[0];
        if (near) {
          fuel -= (near.d - pos) * perKm;
          out.stops.push({ ...near, at: T0.minAt(near.d), fill: true, rest: false, dur: FUEL_MIN, fuelBefore: fuel, kind: placeKind(near), topUp: true });
          fuel = tank; pos = near.d; out.extra += FUEL_MIN;
        }
      }
      fuel -= (total - pos) * perKm;
      out.fuelEnd = fuel;
      if (tank && fuel < 0) warn.push(`${esc(car.name)} runs out of fuel on ${esc(l.label.toLowerCase())} — check the tank size and economy.`);
      return out;
    });
    c.stopPlan = { legs, warn, tank, unit: c.unit };
    return c.stopPlan;
  }

  /* Do any cars need stops (long drives or more than a tank)? */
  function needsStops(P) {
    return P.cars.some(c => c.legs.some(l => l.r && l.r.alt && (l.r.min > BREAK_OVER || (num(c.car.tank) && l.r.km * c.econ / 100 > num(c.car.tank) * (1 - RESERVE) * 0.6))));
  }
  const legStopMin = (c, i) => (c.stopPlan && c.stopPlan.legs[i] ? c.stopPlan.legs[i].extra : (c.legs[i] && c.legs[i].r ? withBreaks(c.legs[i].r.min) - c.legs[i].r.min : 0));

  function timetable(P) {
    const tr = T(), names = list => list.map(c => esc(c.car.name)).join(', ') || '—';
    const out = [], ret = [];
    const { meet } = schedule(P);
    const arrivals = P.cars.map(c => ({ c, at: c.arriveAt }));
    const stops = c => c.stops ? ` · ${c.stops} stop${c.stops > 1 ? 's' : ''}` : '';
    P.cars.forEach(c => out.push([c.leaveAt, `🚗 <b>${esc(c.car.name)}</b> leaves ${esc(c.home?.name || 'home')}${c.car.driver ? ` — driver ${esc(personName(c.car.driver))}` : ''}${c.drive != null ? ` <small class="muted">(${fmtMins(c.drive)} drive${stops(c)})</small>` : ''}`]));
    const stopLines = (c, i, from, list) => {
      const sp = c.stopPlan && c.stopPlan.legs[i];
      if (!sp) return;
      let added = 0;
      sp.stops.forEach(s => { list.push([from + s.at + added, `${stopIcon(s)} <b>${esc(c.car.name)}</b> — ${stopWhat(s)} at <b>${esc(s.name)}</b> <small class="muted">(km ${Math.round(s.d)}, ${s.dur} min)</small>`]); added += s.dur; });
    };
    P.cars.forEach(c => stopLines(c, 0, c.leaveAt, out));
    const fs = P.between.r ? withBreaks(P.between.r.min) : 0;
    const together = P.cars.length > 1 ? ' — all cars together' : '';
    let walkStart;
    if (P.mode === 'shuffle') {
      out.push([meet, `All cars arrive at the finish — ${esc(P.F?.name || '')}${together}`]);
      const st = P.cars.filter(c => c.role === 'start'), fi = P.cars.filter(c => c.role === 'finish');
      out.push([meet + 15, `🅿️ Leave <b>${names(fi)}</b> at the finish. Everyone gets into <b>${names(st)}</b>.`]);
      out.push([meet + 15 + fs, `Arrive at the start — ${esc(P.S?.name || '')} (${P.between.r ? P.between.r.km.toFixed(1) : '?'} km shuffle drive)`]);
      walkStart = meet + walkOffset(P);
    } else if (P.mode === 'shuttle') {
      out.push([meet, `${P.cars.length > 1 ? 'All cars arrive' : `${esc(P.cars[0]?.car.name || 'The car')} arrives`} at the finish and ${P.cars.length > 1 ? 'park' : 'parks'} — ${esc(P.F?.name || '')}`]);
      out.push([meet + 15, '🚐 Shuttle / taxi takes the group from the finish to the start']);
      walkStart = meet + walkOffset(P);
    } else {
      if (arrivals.some(a => a.at != null)) out.push([meet, `${P.cars.length > 1 ? `All ${P.cars.length} cars arrive` : `${esc(P.cars[0].car.name)} arrives`} at the trail start — ${esc(P.S?.name || '')}${together}`]);
      walkStart = meet + walkOffset(P);
    }
    out.push([walkStart, '🥾 <b>Start walking</b>']);

    const end = toMin(tr.walkEndTime);
    ret.push([end, `🏁 Walk finishes at ${esc((P.mode === 'none' ? P.S : P.F)?.name || '')}`]);
    let leaveFrom = end + 20;
    if (P.mode === 'shuffle') {
      const st = P.cars.filter(c => c.role === 'start'), fi = P.cars.filter(c => c.role === 'finish');
      ret.push([end + 20, `<b>${names(fi)}</b> ${fi.length > 1 ? 'drive' : 'drives'} the drivers of <b>${names(st)}</b> back to the start (${P.between.r ? P.between.r.km.toFixed(1) : '?'} km)`]);
      ret.push([end + 20 + fs, 'Collect the start car(s) — everyone heads home']);
      leaveFrom = end + 30 + fs;
    }
    P.cars.forEach(c => {
      const li = c.legs.length - 1, last = c.legs[li];
      if (!last.r) return;
      stopLines(c, li, leaveFrom, ret);
      ret.push([leaveFrom + last.r.min + legStopMin(c, li), `🏠 <b>${esc(c.car.name)}</b> arrives ${esc(c.home?.name || 'home')} (${last.r.km.toFixed(0)} km)`]);
    });
    const sort = list => list.sort((a, b) => a[0] - b[0]);
    return { out: sort(out), ret: sort(ret) };
  }

  /* ---------- render ---------- */
  function render() {
    if (!bound) bind();
    const tr = T(), P = plan(), people = Store.state.people;
    const opts = pointOptions();
    const s = Store.state.trip, startDate = parseDate(s.start), endDate = parseDate(s.end);
    const km = l => l.r ? `${l.r.km.toFixed(l.r.km < 10 ? 1 : 0)} km${l.r.est ? '*' : ''}` : (valid(l.a) && valid(l.b) ? '…' : '—');
    const tm = l => l.r ? fmtMins(l.r.min) : '';
    const tt = timetable(P);
    root().innerHTML = `
      <div class="page-head"><h2>Travel plan</h2>
        <div class="btn-row no-print"><span class="small muted" id="trvProgress">${esc(progress)}</span><button class="btn" id="trvRecalc">↻ Recalculate routes</button></div></div>

      <div class="grid2">
        <div class="card">
          <h3>Where</h3>
          <table class="kv">
            <tr><th>🏠 Home</th><td>${valid(tr.home) ? `${esc(tr.home.name)} <small class="muted">${Geo.grText(tr.home.lat, tr.home.lon)}</small>` : '<span class="bad-text">not set</span>'}
              <a href="#trip" data-goto="trip" class="no-print small">change</a></td></tr>
          </table>
          <label class="field"><span>🟢 Walk start (where you start walking)</span>
            <select data-tr="startId">${opts.map(o => `<option value="${o.id}" ${P.S?.id === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('') || '<option>Set a camp location or map a trail</option>'}</select></label>
          <label class="field"><span>🏁 Walk finish (where you finish walking)</span>
            <select data-tr="finishId">${opts.map(o => `<option value="${o.id}" ${P.F?.id === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('') || '<option>—</option>'}</select></label>
          <label class="field"><span>Getting between finish and start</span>
            <select data-tr="mode">${Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${tr.mode === k ? 'selected' : ''}>${v}${k === 'auto' ? ` (${MODES[P.mode].split(' (')[0].toLowerCase()})` : ''}</option>`).join('')}</select></label>
          ${P.mode === 'shuttle' ? `<label class="field"><span>Shuttle / taxi cost (total, $)</span><input type="number" min="0" step="1" data-tr="shuttleCost" value="${num(tr.shuttleCost)}"></label>` : ''}
          <p class="small muted">Driving routes reach the nearest road to each point — check vehicle access to remote trailheads.</p>
        </div>
        <div class="card"><div id="travelMap" class="travel-map"></div></div>
      </div>

      <div class="card">
        <h3>Distances</h3>
        <div class="big-stats">
          <div><b>${km(P.toStart)}</b><span>home → walk start ${tm(P.toStart)}</span></div>
          <div><b>${km(P.between)}</b><span>drive between start & finish ${tm(P.between)}</span></div>
          <div><b>${P.walkKm ? P.walkKm.toFixed(1) + ' km' : '—'}</b><span>walk from start to finish</span></div>
          <div><b>${km(P.fromFinish)}</b><span>finish → home ${tm(P.fromFinish)}</span></div>
          <div class="hero"><b>${Math.round(P.km)} km</b><span>total driving, all cars</span></div>
          <div class="hero"><b>${fmtMoney(P.fuelCost + P.shuttleCost)}</b><span>fuel${P.shuttleCost ? ' + shuttle' : ''} (${fmtMoney((P.fuelCost + P.shuttleCost) / Math.max(1, people.length))} pp)</span></div>
        </div>
        ${P.cars.some(c => c.legs.some(l => l.r?.est)) ? '<p class="small muted">* straight-line estimate</p>' : ''}
      </div>

      <div class="card">
        <h3>Cars</h3>
        ${tr.cars.length ? `<div class="table-scroll"><table class="tbl cars">
          <thead><tr><th>Car</th><th>Driver</th><th class="num">Seats</th><th>Fuel</th><th class="num">Economy</th><th class="num">Load +%</th><th class="num">Tank</th><th class="num" title="Car, people and gear — used for the hill allowance">Loaded kg</th><th>Leaves from</th>
            ${P.mode === 'shuffle' ? '<th>During the walk</th>' : ''}<th class="num">Driving</th><th class="num">Fuel</th><th class="num">Cost</th><th class="no-print"></th></tr></thead>
          <tbody>${(schedule(P), P.cars.map(c => carRow(c, P, people)).join(''))}</tbody>
          <tfoot><tr><th colspan="${P.mode === 'shuffle' ? 10 : 9}">Total</th><th class="num">${Math.round(P.km)} km</th><th></th><th class="num">${fmtMoney(P.fuelCost)}</th><th class="no-print"></th></tr></tfoot>
        </table></div>` : '<p class="muted">No cars yet.</p>'}
        <button class="btn no-print" id="addCar">+ Add car</button>
        <p class="small muted">Economy: litres (or kWh for electric) per 100 km on mostly flat roads — check your car's trip computer; real-world figures are usually 10–20% above the label. “Load +%” adds for a full car, roof boxes, towing or dirt roads.
          The fuel figure also allows for the <b>hills on the route</b>: climbing takes extra fuel for the car's loaded weight, and descents save some (more for electric cars, which recover energy when braking). The small grey line shows the hill effect.</p>
      </div>

      ${routesCard(P)}
      ${stopsCard(P)}
      ${directionsCard(P)}

      ${P.mode === 'shuffle' ? shuffleCard(P) : ''}

      <div class="card">
        <h3>Checks</h3>
        ${P.checks.length ? `<ul class="checks">${P.checks.map(([cls, t]) => `<li class="${cls}">${t}</li>`).join('')}</ul>` : '<p class="ok">✔ Travel plan looks complete.</p>'}
      </div>

      <div class="card">
        <h3>Timetable</h3>
        <div class="row no-print">
          ${startTime() ? `<div class="field"><span>Start walking at</span><b>${esc(startTime())}</b> <small class="muted">— set on the <a href="#trip" data-goto="trip">Trip tab</a>; leaving times are worked out from it</small></div>`
            : `<label class="field"><span>${P.cars.length > 1 ? 'First car leaves home at' : 'Leave home at'}</span><input type="time" data-tr="departTime" value="${esc(tr.departTime)}"></label>`}
          <label class="field"><span>Finish walking at (last day)</span><input type="time" data-tr="walkEndTime" value="${esc(tr.walkEndTime)}"></label>
        </div>
        <div class="grid2 tight">
          <div><h4>Getting there — ${startDate ? fmtDate(startDate) : 'day 1'}</h4>${timeList(tt.out)}</div>
          <div><h4>Getting home — ${endDate ? fmtDate(endDate) : 'last day'}</h4>${timeList(tt.ret)}</div>
        </div>
        ${!startTime() ? '<p class="small no-print">💡 Set <b>Start walking at</b> on the <a href="#trip" data-goto="trip">Trip tab</a> to have each car\'s leaving time worked out for you.</p>' : ''}
        <p class="small muted">${P.cars.length > 1 ? `Departures are staggered so all cars arrive together${startTime() ? ' in time to start walking' : ': the car with the longest drive leaves at the time above, the others later'}. ` : ''}Drives over ${BREAK_OVER / 60} hours include a ${BREAK_MIN}-minute rest stop every ${BREAK_EVERY / 60} hours (Stop. Revive. Survive.). Drive times are free-flowing estimates — allow extra for traffic, dirt roads and wildlife at dawn and dusk.</p>
      </div>

      <div class="card">
        <h3>Fuel prices <small class="muted">— set to local prices</small></h3>
        <div class="fuel-prices">${Object.entries(FUEL_TYPES).map(([k, f]) => `<label class="field"><span>${f.label} ($/${f.unit})</span>
          <input type="number" min="0" step="0.01" data-price="${k}" value="${num(tr.prices[k], f.price)}"></label>`).join('')}</div>
        <p class="small muted no-print">Check today's prices: <a href="https://www.fuelcheck.nsw.gov.au/" target="_blank" rel="noopener">FuelCheck NSW</a> ·
          <a href="https://www.fuelwatch.wa.gov.au/" target="_blank" rel="noopener">FuelWatch WA</a> ·
          <a href="https://www.qld.gov.au/transport/projects/fuel-prices" target="_blank" rel="noopener">QLD fuel prices</a> ·
          <a href="https://servo.vic.gov.au/" target="_blank" rel="noopener">Servo Saver VIC</a>. Electric: home charging ≈ $0.30/kWh, fast chargers ≈ $0.60–0.70/kWh.</p>
      </div>`;
    drawMap(P);
    if (P.needs.length) ensure(() => { if (App.current === 'travel') render(); });
    else if (!stopsData && !stopsErr && needsStops(P)) loadStops().then(() => { if (App.current === 'travel') render(); });
  }

  function carRow(c, P, people) {
    const car = c.car, f = fuelOf(car);
    const sel = (k, options) => `<select data-car="${car.id}" data-k="${k}">${options}</select>`;
    return `<tr data-id="${car.id}">
      <td><input data-car="${car.id}" data-k="name" value="${esc(car.name)}"></td>
      <td>${sel('driver', '<option value="">—</option>' + people.map(p => `<option value="${p.id}" ${car.driver === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join(''))}</td>
      <td class="num"><input type="number" min="1" max="12" class="w-sm" data-car="${car.id}" data-k="seats" value="${num(car.seats, 5)}"></td>
      <td>${sel('fuel', Object.entries(FUEL_TYPES).map(([k, v]) => `<option value="${k}" ${car.fuel === k ? 'selected' : ''}>${v.label}</option>`).join(''))}</td>
      <td class="num"><input type="number" min="0" step="0.1" class="w-sm" data-car="${car.id}" data-k="economy" value="${num(car.economy, f.economy)}"> <small>${f.unit}/100km</small></td>
      <td class="num"><input type="number" min="0" max="100" step="5" class="w-sm" data-car="${car.id}" data-k="extraPct" value="${num(car.extraPct)}"></td>
      <td class="num"><input type="number" min="0" step="1" class="w-sm" data-car="${car.id}" data-k="tank" value="${num(car.tank) || ''}" placeholder="${f.unit}"></td>
      <td class="num"><input type="number" min="500" max="6000" step="50" class="w-md" data-car="${car.id}" data-k="mass" value="${num(car.mass, MASS)}"></td>
      <td>${car.home?.lat != null ? `${esc(car.home.name)} <button class="icon-btn no-print" data-car-home-clear="${car.id}" title="Use the group home">✕</button>`
        : `Group home <button class="btn small no-print" data-car-home="${car.id}">Other…</button>`}</td>
      ${P.mode === 'shuffle' ? `<td>${sel('role', `<option value="start" ${c.role === 'start' ? 'selected' : ''}>Waits at start</option><option value="finish" ${c.role === 'finish' ? 'selected' : ''}>Left at finish</option>`)}</td>` : ''}
      <td class="num">${c.complete ? `${Math.round(c.km)} km<br><small class="muted">${fmtMins(c.min)}</small>` : '…'}${c.drive != null && P.cars.length > 1 ? `<br><small title="Leaves so that all cars arrive together">leaves ${clock(c.leaveAt)}</small>` : ''}</td>
      <td class="num">${c.complete ? `${c.amount.toFixed(1)} ${c.unit}<br><small class="muted" title="Fuel on a flat road ${c.flat.toFixed(1)} ${c.unit}; climbs ↑${c.up} m, descents ↓${c.down} m">${hillNote(c)}</small><br><small class="muted">@ ${fmtMoney(c.price)}</small>` : ''}</td>
      <td class="num"><b>${c.complete ? fmtMoney(c.cost) : ''}</b></td>
      <td class="no-print"><button class="icon-btn" data-car-del="${car.id}" title="Remove">🗑</button></td>
    </tr>`;
  }

  /* ---------- one car's own plan (a report page each, for its driver) ---------- */
  function carPlan(P, c) {
    const S = schedule(P), car = c.car, f = fuelOf(car), tr = T();
    const sp = c.stopPlan || (stopsData ? planStops(c) : null);
    const fs = P.between.r ? withBreaks(P.between.r.min) : 0;
    const end = toMin(tr.walkEndTime), leaveHome = P.mode === 'shuffle' ? end + 30 + fs : end + 20;
    /* a leg's timeline: departure, stops, arrival */
    const legLines = (i, from, toText) => {
      const l = c.legs[i], L = sp && sp.legs[i];
      if (!l || !l.r) return [];
      const lines = [];
      let added = 0;
      (L ? L.stops : []).forEach(s => { lines.push([from + s.at + added, `${stopIcon(s)} ${stopWhat(s)} at <b>${esc(s.name)}</b> <small class="muted">(km ${Math.round(s.d)} · ${s.dur} min${s.toilets ? ' · toilets' : ''})</small>`]); added += s.dur; });
      lines.push([from + l.r.min + added, toText]);
      return lines;
    };
    const first = c.legs[0], last = c.legs[c.legs.length - 1];
    const day1 = [[c.leaveAt, `🚗 Leave <b>${esc(c.home?.name || 'home')}</b>`], ...legLines(0, c.leaveAt, `📍 Arrive at <b>${esc(first.b.name || '')}</b>${P.cars.length > 1 ? ' — with the other cars' : ''}`)];
    if (P.mode === 'none') day1.push([S.meet + walkOffset(P), '🥾 Start walking']);
    else day1.push([S.meet + walkOffset(P), P.mode === 'shuffle' ? `🥾 Start walking (after the car shuffle — this car ${c.role === 'finish' ? 'stays at the finish' : 'drives everyone to the start'})` : '🥾 Start walking (after the shuttle)']);
    const lastDay = [[end, '🏁 Walk finishes'], [leaveHome, `🚗 Leave <b>${esc(last.a.name || '')}</b>`], ...legLines(c.legs.length - 1, leaveHome, `🏠 Arrive <b>${esc(c.home?.name || 'home')}</b>`)];
    const list = rows => `<table class="timeline">${rows.sort((a, b) => a[0] - b[0]).map(([m, t]) => `<tr><td class="tl-time">${clock(m)}</td><td>${t}</td></tr>`).join('')}</table>`;
    const pct = v => (sp && sp.tank ? `${Math.max(0, v).toFixed(0)} ${c.unit} (${Math.max(0, v / sp.tank * 100).toFixed(0)}%)` : '—');
    const sd = parseDate(Store.state.trip.start), ed = parseDate(Store.state.trip.end);
    return `
      <table class="kv">
        <tr><th>Driver</th><td>${car.driver ? esc(personName(car.driver)) : '—'} · ${num(car.seats, 5)} seats</td></tr>
        <tr><th>Car</th><td>${esc(f.label)} · ${c.econ.toFixed(1)} ${c.unit}/100 km${num(car.tank) ? ` · ${num(car.tank)} ${c.unit} tank` : ''} · ${num(car.mass, MASS)} kg loaded</td></tr>
        <tr><th>Leaves from</th><td>${esc(c.home?.name || 'home')}${P.mode === 'shuffle' ? ` · during the walk this car <b>${c.role === 'finish' ? 'is left at the finish' : 'waits at the start'}</b>` : ''}</td></tr>
        <tr><th>Driving</th><td><b>${Math.round(c.km)} km</b> · ${fmtMins(c.min)} at the wheel · ${c.amount.toFixed(1)} ${c.unit} (${fmtMoney(c.cost)}) ${c.flat ? `<small class="muted">${hillNote(c)}</small>` : ''}</td></tr>
      </table>
      <div class="rpt-cols">
        <div><h3>Getting there — ${sd ? fmtDate(sd) : 'day 1'}</h3>${list(day1)}</div>
        <div><h3>Getting home — ${ed ? fmtDate(ed) : 'last day'}</h3>${list(lastDay)}</div>
      </div>
      <h3>Drives</h3>
      <table class="tbl compact"><thead><tr><th>Drive</th><th>Route</th><th class="num">Distance</th><th class="num">Time</th><th class="num">Climb</th><th class="num">Fuel</th><th>Stops</th><th class="num">Tank on arrival</th></tr></thead><tbody>
        ${c.legs.map((l, i) => { const L = sp && sp.legs[i]; return l.r ? `<tr><td>${esc(l.label)}</td><td>${l.r.alt ? `${esc(l.r.alt.label)}${l.r.alt.via ? ` via ${esc(l.r.alt.via)}` : ''}` : '—'}</td>
          <td class="num">${l.r.km.toFixed(0)} km</td><td class="num">${fmtMins(l.r.min)}</td><td class="num">${l.r.alt && l.r.alt.up != null ? `↑${l.r.alt.up} m` : '—'}</td>
          <td class="num">${l.fuel ? l.fuel.amount.toFixed(1) + ' ' + c.unit : '—'}</td><td>${L && L.stops.length ? L.stops.map(s => `${stopIcon(s)} ${esc(s.name)}`).join(', ') : '<span class="muted">none</span>'}</td>
          <td class="num">${L ? pct(L.fuelEnd) : '—'}</td></tr>` : ''; }).join('')}
      </tbody></table>
      ${sp && sp.warn.length ? `<ul class="checks">${sp.warn.map(w => `<li class="warn">${w}</li>`).join('')}</ul>` : ''}
      <p class="small muted">Starts with a full tank. Rest about every 2 hours on drives over 3 hours; refuel before 20% is left. Check fuel is open on long country runs.</p>
      ${c.legs.filter(l => l.r && l.r.alt && l.r.km).map(l => `<div class="rpt-dir">${legDirections(l, true)}</div>`).join('')}`;
  }

  const stopIcon = s => (s.fill && s.rest ? '☕⛽' : s.fill ? '⛽' : '☕');
  const stopWhat = s => (s.fill && s.rest ? 'rest &amp; refuel' : s.topUp ? 'top up before the trailhead' : s.fill ? 'refuel' : 'rest stop');

  /* ---------- rest & fuel stops card ---------- */
  function stopsCard(P) {
    if (!P.cars.length || !P.cars.some(c => c.complete)) return '';
    const need = needsStops(P);
    if (!stopsData) return need ? `<div class="card"><h3>⛽ Rest &amp; fuel stops</h3><p class="muted">${stopsErr ? esc(stopsErr) : 'Finding towns, fuel and rest areas along the way…'}</p></div>` : '';
    const rows = [];
    P.cars.forEach(c => {
      const sp = c.stopPlan || planStops(c);
      c.legs.forEach((l, i) => {
        const L = sp.legs[i];
        if (!l.r || !L) return;
        const pct = v => sp.tank ? `${Math.max(0, v).toFixed(0)} ${sp.unit} <small class="muted">(${Math.max(0, v / sp.tank * 100).toFixed(0)}%)</small>` : '—';
        rows.push(`<tr class="sub"><td colspan="5"><b>${esc(c.car.name)}</b> — ${esc(l.label)} <small class="muted">${l.r.km.toFixed(0)} km · ${fmtMins(l.r.min)} driving${L.stops.length ? ` + ${L.extra} min stopped` : ''} · starts with ${pct(L.fuelStart)}</small></td></tr>`);
        L.stops.forEach(s => rows.push(`<tr><td>${stopIcon(s)} ${stopWhat(s)}</td><td><b>${esc(s.name)}</b> <small class="muted">${s.roadside ? 'no town nearby — pull over somewhere safe' : `${s.kind}${s.off > 0.8 ? `, ${s.off.toFixed(1)} km off the road` : ''}${s.toilets ? ' · toilets' : ''}`}</small></td>
          <td class="num">km ${Math.round(s.d)}</td><td class="num">${fmtMins(s.at)} in</td><td class="num">${s.fill ? `${pct(s.fuelBefore)} → full` : pct(s.fuelBefore)}</td></tr>`));
        if (!L.stops.length) rows.push(`<tr><td colspan="5" class="muted small">No stops needed${l.r.min > BREAK_OVER ? '' : ` (under ${BREAK_OVER / 60} hours)`}.</td></tr>`);
        rows.push(`<tr><td colspan="4" class="muted small">Arrive with</td><td class="num small">${pct(L.fuelEnd)}</td></tr>`);
      });
    });
    const warns = P.cars.flatMap(c => (c.stopPlan ? c.stopPlan.warn : []));
    const noTank = P.cars.filter(c => !num(c.car.tank));
    return `<div class="card">
      <h3>⛽ Rest &amp; fuel stops</h3>
      ${warns.length ? `<ul class="checks">${warns.map(w => `<li class="warn">${w}</li>`).join('')}</ul>` : ''}
      ${noTank.length ? `<p class="small warn-text">Enter the tank size for ${noTank.map(c => esc(c.car.name)).join(', ')} to plan fuel stops.</p>` : ''}
      <div class="table-scroll"><table class="tbl compact trv-stops"><thead><tr><th>Stop</th><th>Where</th><th class="num">Along the road</th><th class="num">Driving</th><th class="num">Fuel</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>
      <p class="small muted">Every car starts with a full tank. Drives over ${BREAK_OVER / 60} hours stop every ${BREAK_EVERY / 60} hours (± ${BREAK_SLACK} min, to stop in a town), and cars refuel before ${RESERVE * 100}% is left — combined with a rest stop where possible.
        Towns are preferred, then service stations and roadhouses, then rest areas. Rest ${BREAK_MIN} min, fuel ${FUEL_MIN} min, both ${BOTH_MIN} min. Town, fuel and rest-area data © OpenStreetMap contributors — check opening hours on long country runs, especially at night.</p>
    </div>`;
  }

  const hillNote = c => {
    if (!c.flat) return '';
    const pct = (c.amount / c.flat - 1) * 100;
    return Math.abs(pct) < 0.5 ? 'hills: no change' : `hills ${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`;
  };

  /* The legs the plan drives, each once (in driving order) */
  function drivenLegs(P) {
    const seen = new Map();
    const add = l => { if (l.r && l.r.alt && !seen.has(l.r.key)) seen.set(l.r.key, l); };
    P.cars.forEach(c => c.legs.forEach(add));
    if (!P.cars.length) [P.toStart, P.fromFinish].forEach(add);
    return [...seen.values()];
  }
  const legTitle = l => `${esc(l.a.name || 'Home')} → ${esc(l.b.name || 'Home')}`;

  /* ---------- route options: time vs fuel per leg ---------- */
  function routesCard(P) {
    const legs = drivenLegs(P), tr = T(), c = refCar(), unit = fuelOf(c).unit;
    if (!legs.length) return '';
    const anyChoice = legs.some(l => l.r.rec.alts.length > 1);
    return `<div class="card">
      <div class="cat-head"><h3>🛣️ Route options</h3>
        <div class="row no-print trv-opt">
          <label class="inline">Choose routes for <select data-tr="optimise">${Object.entries(OPTIMISE).map(([k, v]) => `<option value="${k}" ${(tr.optimise || 'balanced') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          ${(tr.optimise || 'balanced') === 'balanced' ? `<label class="inline" title="What an hour of driving is worth, to weigh time against fuel">time worth $<input type="number" min="0" step="5" class="w-sm" data-tr="timeValue" value="${num(tr.timeValue, 25)}">/h</label>` : ''}
          <label class="check inline" title="For 2WD cars, caravans and trailers — finds the routes again"><input type="checkbox" data-unsealed ${tr.avoidUnsealed ? 'checked' : ''}> Avoid unsealed roads</label>
        </div></div>
      ${legs.map(l => {
        const rec = l.r.rec;
        return `<h4>${legTitle(l)}</h4>
        <div class="table-scroll"><table class="tbl compact trv-alts">
          <thead><tr><th></th><th>Route</th><th class="num">Distance</th><th class="num">Time</th><th class="num">Climb / descent</th><th class="num">Fuel*</th><th class="num">Fuel cost*</th></tr></thead>
          <tbody>${rec.alts.map((a, i) => {
            const f = fuelFor(a, c), on = i === l.r.pick;
            return `<tr class="${on ? 'on' : ''}">
              <td><input type="radio" name="alt-${esc(l.r.key)}" data-route="${esc(l.r.key)}" value="${i}" ${on ? 'checked' : ''} ${rec.alts.length < 2 ? 'disabled' : ''}></td>
              <td><b>${esc(a.label)}</b>${a.via ? ` <small class="muted">via ${esc(a.via)}</small>` : ''}${i === l.r.auto ? ' <span class="badge">best</span>' : ''}</td>
              <td class="num">${a.km.toFixed(a.km < 10 ? 1 : 0)} km</td><td class="num">${fmtMins(a.min)}</td>
              <td class="num">${a.up != null ? `↑${a.up} m ↓${a.down} m` : '<span class="muted">—</span>'}</td>
              <td class="num">${f.amount.toFixed(1)} ${unit}${f.flat ? ` <small class="muted">(${f.amount >= f.flat ? '+' : '−'}${Math.abs((f.amount / f.flat - 1) * 100).toFixed(0)}%)</small>` : ''}</td>
              <td class="num">${fmtMoney(f.amount * priceOf(c))}</td></tr>`;
          }).join('')}</tbody></table></div>
        ${l.r.manual ? `<p class="small no-print">Chosen by hand. <button class="linkish" data-route-auto="${esc(l.r.key)}">Go back to the best route</button></p>` : ''}`;
      }).join('')}
      <p class="small muted">${anyChoice ? 'The best route for each drive is picked automatically — click another to use it instead. ' : 'Only one sensible road was found for each drive. '}${tr.avoidUnsealed ? 'Unsealed roads are avoided where possible. ' : 'Shorter routes can include unsealed roads — tick <i>Avoid unsealed roads</i> for 2WD cars or when towing. '}
        * Fuel for ${esc(c.name || 'the first car')} (${c.economy || fuelOf(c).economy} ${unit}/100 km, ${num(c.mass, MASS)} kg), including the climbs and descents. Routes: ${esc([...new Set(legs.map(l => l.r.rec.src))].join(', '))}.</p>
    </div>`;
  }

  /* ---------- turn-by-turn directions and the road profile ---------- */
  function directionsCard(P) {
    const legs = drivenLegs(P);
    if (!legs.length) return '';
    if (!legs.some(l => l.r.key === dirSel)) dirSel = legs[0].r.key;
    return `<div class="card" id="trvDirections">
      <div class="cat-head"><h3>🧭 Directions &amp; road profile</h3>
        <select class="no-print" data-dir-leg>${legs.map(l => `<option value="${esc(l.r.key)}" ${l.r.key === dirSel ? 'selected' : ''}>${legTitle(l)}</option>`).join('')}</select></div>
      ${legs.filter(l => l.r.key === dirSel).map(l => legDirections(l)).join('')}
      <p class="small muted">Directions and elevations come from OpenStreetMap and a 30–90 m terrain model, so treat grades as a guide. Check road conditions and closures before you go (<a href="https://www.livetraffic.com/" target="_blank" rel="noopener">Live Traffic NSW</a>).</p>
    </div>`;
  }

  /* One leg: summary, profile (steepest kilometres marked) and the numbered steps */
  function legDirections(l, print) {
    const a = l.r.alt;
    let cum = 0;
    const rows = (a.steps || []).map(([t, km, min], i) => { const at = cum; cum += km; return `<tr><td class="num">${i + 1}</td><td>${esc(t)}</td><td class="num">${km ? (km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km') : ''}</td><td class="num muted">${at.toFixed(1)}</td></tr>`; }).join('');
    return `<div class="trv-leg">
      <p><b>${legTitle(l)}</b> — ${esc(a.label)}${a.via ? ` via ${esc(a.via)}` : ''} · <b>${a.km.toFixed(a.km < 10 ? 1 : 0)} km</b> · ${fmtMins(a.min)}${a.up != null ? ` · ↑${a.up} m ↓${a.down} m · highest ${a.high} m` : ''}</p>
      ${a.elev ? roadProfile(a, print) : '<p class="muted small">No elevation profile for this road.</p>'}
      ${rows ? `<table class="tbl compact trv-steps"><thead><tr><th class="num">#</th><th>Direction</th><th class="num">Then drive</th><th class="num">At km</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted small">No turn-by-turn directions (estimated route).</p>'}
    </div>`;
  }

  /* Road elevation profile (SVG): grades over 8% shaded orange, over 12% red; the steepest kilometre labelled */
  function roadProfile(a, print) {
    const sc = a.km * 1000 / (a.elev.d[a.elev.d.length - 1] || 1), d = a.elev.d.map(v => v * sc), h = a.elev.h;   // stretch to the route's real length
    const W = 760, H = print ? 150 : 170, L = 42, R = 8, TOP = 10, B = 24;
    const maxD = d[d.length - 1] || 1, lo = Math.min(...h), hi = Math.max(lo + 50, Math.max(...h));
    const x = v => L + v / maxD * (W - L - R), y = v => TOP + (1 - (v - lo) / (hi - lo)) * (H - TOP - B);
    const line = d.map((v, i) => `${i ? 'L' : 'M'}${x(v).toFixed(1)},${y(h[i]).toFixed(1)}`).join('');
    let steep = '', worst = { g: 0 };
    for (let i = 1; i < d.length; i++) {
      const g = (h[i] - h[i - 1]) / Math.max(1, d[i] - d[i - 1]) * 100;
      if (Math.abs(g) >= 8) steep += `<path d="M${x(d[i - 1]).toFixed(1)},${y(h[i - 1]).toFixed(1)}L${x(d[i]).toFixed(1)},${y(h[i]).toFixed(1)}L${x(d[i]).toFixed(1)},${H - B}L${x(d[i - 1]).toFixed(1)},${H - B}Z" fill="${Math.abs(g) >= 12 ? '#e03131' : '#f08c00'}" opacity=".55"/>`;
    }
    /* steepest ~1 km stretch */
    for (let i = 0, j = 0; i < d.length; i++) {
      while (j < d.length - 1 && d[j] - d[i] < 1000) j++;
      if (d[j] - d[i] >= 600) { const g = (h[j] - h[i]) / (d[j] - d[i]) * 100; if (Math.abs(g) > Math.abs(worst.g)) worst = { g, at: (d[i] + d[j]) / 2 }; }
    }
    const ticks = []; const step = maxD > 200000 ? 50000 : maxD > 80000 ? 20000 : maxD > 30000 ? 10000 : 5000;
    for (let t = step; t < maxD; t += step) ticks.push(t);
    return `<svg class="trv-profile" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Road elevation profile">
      <path d="${line}L${x(maxD)},${H - B}L${x(0)},${H - B}Z" fill="#b9dcf0" opacity=".7"/>${steep}
      <path d="${line}" fill="none" stroke="#262661" stroke-width="1.6"/>
      ${ticks.map(t => `<line x1="${x(t)}" x2="${x(t)}" y1="${TOP}" y2="${H - B}" stroke="#adb5bd" stroke-dasharray="2 3" stroke-width=".6"/><text x="${x(t)}" y="${H - 8}" font-size="10" text-anchor="middle">${t / 1000} km</text>`).join('')}
      <text x="${L - 4}" y="${y(hi) + 4}" font-size="10" text-anchor="end">${Math.round(hi)} m</text><text x="${L - 4}" y="${y(lo)}" font-size="10" text-anchor="end">${Math.round(lo)} m</text>
      <text x="${W - R}" y="${H - 8}" font-size="10" text-anchor="end">${(maxD / 1000).toFixed(0)} km</text>
      ${worst.at ? `<text x="${Math.min(W - 120, Math.max(L + 40, x(worst.at)))}" y="${TOP + 10}" font-size="10" text-anchor="middle" fill="#c92a2a">steepest ${worst.g > 0 ? 'climb' : 'descent'} ${Math.abs(worst.g).toFixed(0)}% at km ${(worst.at / 1000).toFixed(0)}</text>` : ''}
    </svg><div class="legend small"><span><i style="background:#f08c00"></i>8–12% grade</span><span><i style="background:#e03131"></i>over 12% — low gear down, watch brakes and caravans</span></div>`;
  }

  function shuffleCard(P) {
    const st = P.cars.filter(c => c.role === 'start'), fi = P.cars.filter(c => c.role === 'finish');
    const names = list => list.map(c => `<b>${esc(c.car.name)}</b>`).join(', ') || '<i>none</i>';
    const fs = P.between.r ? `${P.between.r.km.toFixed(1)} km, ~${fmtMins(P.between.r.min)}` : '…';
    return `<div class="card">
      <h3>🔁 Car shuffle</h3>
      <div class="grid2 tight">
        <div><h4>Day 1 — before the walk</h4><ol class="steps">
          <li>All cars drive to the <b>finish</b>: ${esc(P.F?.name || '')} <small class="muted">${valid(P.F) ? Geo.grText(P.F.lat, P.F.lon) : ''}</small>.</li>
          <li>Leave ${names(fi)} at the finish (lock it, take its keys on the walk).</li>
          <li>Everyone rides in ${names(st)} to the <b>start</b>: ${esc(P.S?.name || '')} <small class="muted">${valid(P.S) ? Geo.grText(P.S.lat, P.S.lon) : ''}</small> — ${fs}.</li>
          <li>Walk from the start to the finish.</li></ol></div>
        <div><h4>Last day — after the walk</h4><ol class="steps">
          <li>At the finish, ${names(fi)} ${fi.length > 1 ? 'drive' : 'drives'} the drivers of ${names(st)} back to the start — ${fs}.</li>
          <li>Collect ${names(st)} and everyone drives home.</li></ol></div>
      </div>
      <p class="small muted">Seats: start cars ${st.reduce((s, c) => s + num(c.car.seats, 5), 0)}, finish cars ${fi.reduce((s, c) => s + num(c.car.seats, 5), 0)}, people ${P.nPeople}. Each car drives the shuffle leg once.</p>
    </div>`;
  }

  function timeList(list) {
    return list.length ? `<table class="timeline">${list.map(([m, t]) => `<tr><td class="tl-time">${clock(m)}</td><td>${t}</td></tr>`).join('')}</table>` : '<p class="muted">Add cars and a home location.</p>';
  }

  const L2 = window.L;    // Leaflet (a local 'L' is used for other things in some functions)
  function drawMap(P) {
    const el = $('#travelMap');
    if (map) { map.remove(); map = null; }
    if (!el) return;
    map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map);
    const pts = [];
    const mark = (p, html, title) => {
      if (!valid(p)) return;
      pts.push([p.lat, p.lon]);
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'trv-icon', html, iconSize: [28, 28], iconAnchor: [14, 14] }) }).bindTooltip(esc(title)).addTo(map);
    };
    const line = (r, color, dash) => { if (r && r.coords.length > 1) { L.polyline(r.coords, { color, weight: 4, opacity: 0.8, dashArray: dash }).addTo(map); r.coords.forEach(c => pts.push(c)); } };
    const homes = new Map();
    P.cars.forEach(c => { if (valid(c.home)) homes.set(pkey(c.home), c.home); });
    if (valid(P.H)) homes.set(pkey(P.H), P.H);
    drivenLegs(P).forEach(l => l.r.rec.alts.forEach((a, i) => { if (i !== l.r.pick && a.coords.length > 1) L.polyline(a.coords, { color: '#868e96', weight: 3, opacity: 0.45, dashArray: '2 6' }).bindTooltip(`${esc(a.label)}${a.via ? ' via ' + esc(a.via) : ''} — ${a.km.toFixed(0)} km`).addTo(map); }));
    P.cars.forEach(c => c.legs.forEach(l => line(l.r, l.phase === 'ret' ? '#2b8a3e' : '#1c7ed6', l.a === P.F && l.b === P.S ? '8 6' : null)));
    if (!P.cars.length) { line(P.toStart.r, '#1c7ed6'); line(P.fromFinish.r, '#2b8a3e'); }
    if (P.mode !== 'none') line(P.between.r, '#e8590c', '8 6');
    homes.forEach(h => mark(h, '🏠', h.name));
    P.cars.forEach(c => (c.stopPlan ? c.stopPlan.legs : []).forEach(L => L.stops.forEach(s => {
      if (s.lat != null) L2.marker([s.lat, s.lon], { icon: L2.divIcon({ className: 'trv-icon trv-stop', html: stopIcon(s), iconSize: [30, 22], iconAnchor: [15, 11] }) })
        .bindTooltip(`${esc(c.car.name)}: ${stopWhat(s)} at ${esc(s.name)} (km ${Math.round(s.d)})`).addTo(map);
    })));
    mark(P.S, '🟢', 'Walk start: ' + (P.S?.name || ''));
    if (P.through) mark(P.F, '🏁', 'Walk finish: ' + (P.F?.name || ''));
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [20, 20], maxZoom: 13 });
    else map.setView([-28, 134], 4);
  }

  /* Pick a different starting point for one car (e.g. a passenger collecting people elsewhere). */
  function chooseCarHome(car) {
    const dlg = $('#dialog');
    dlg.innerHTML = `<form class="dlg-form" id="carHomeForm"><h3>Where does ${esc(car.name)} leave from?</h3>
      <div class="row"><input id="chQ" placeholder="Suburb, town or address"><button class="btn" type="submit">Search</button></div>
      <div id="chRes" class="results"></div>
      <div class="dlg-actions"><button type="button" class="btn" id="chCancel">Cancel</button></div></form>`;
    const form = $('#carHomeForm');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const out = $('#chRes');
      out.innerHTML = '<p class="muted">Searching…</p>';
      try {
        const res = await geocode($('#chQ').value);
        out.innerHTML = res.map(x => `<button type="button" class="result" data-lat="${x.lat}" data-lon="${x.lon}" data-short="${esc(x.short)}">${esc(x.name)}</button>`).join('') || '<p class="muted">No results.</p>';
      } catch (err) { out.innerHTML = '<p class="muted">Search failed.</p>'; }
    });
    form.addEventListener('click', e => {
      if (e.target.id === 'chCancel') dlg.close();
      const r = e.target.closest('[data-lat]');
      if (r) {
        car.home = { name: r.dataset.short, lat: +(+r.dataset.lat).toFixed(5), lon: +(+r.dataset.lon).toFixed(5) };
        Store.save();
        dlg.close();
        render();
      }
    });
    dlg.showModal();
    $('#chQ').focus();
  }

  function bind() {
    bound = true;
    const r = root();
    r.addEventListener('change', e => {
      const el = e.target, tr = T();
      if (el.hasAttribute('data-unsealed')) {
        tr.avoidUnsealed = el.checked;
        tr.routes = {}; tr.routePick = {};                       // find the routes again with the new rule
      } else if (el.dataset.route) {
        tr.routePick = tr.routePick || {};
        tr.routePick[el.dataset.route] = +el.value;
      } else if (el.hasAttribute('data-dir-leg')) {
        dirSel = el.value; render(); return;
      } else if (el.dataset.tr) {
        tr[el.dataset.tr] = ['shuttleCost', 'timeValue'].includes(el.dataset.tr) ? num(el.value) : el.value;
        if (el.dataset.tr === 'optimise') tr.routePick = {};          // a new goal: let it choose again
      } else if (el.dataset.price) {
        tr.prices[el.dataset.price] = num(el.value);
      } else if (el.dataset.car) {
        const car = tr.cars.find(c => c.id === el.dataset.car), k = el.dataset.k;
        if (k === 'fuel' && num(car.economy) === (FUEL_TYPES[car.fuel] || {}).economy) car.economy = FUEL_TYPES[el.value].economy;
        car[k] = ['seats', 'economy', 'extraPct', 'tank', 'mass'].includes(k) ? num(el.value) : el.value;
      } else return;
      Store.save();
      render();
    });
    r.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const tr = T(), people = Store.state.people;
      if (b.id === 'addCar') {
        const i = tr.cars.length;
        const used = new Set(tr.cars.map(c => c.driver));
        tr.cars.push({
          id: uid(), name: `Car ${i + 1}`, driver: (people.find(p => !used.has(p.id)) || people[0]).id, seats: 5,
          fuel: 'ulp91', economy: FUEL_TYPES.ulp91.economy, extraPct: 10, tank: 55, mass: MASS, home: null, role: i % 2 ? 'finish' : 'start'
        });
      } else if (b.dataset.carDel) {
        tr.cars = tr.cars.filter(c => c.id !== b.dataset.carDel);
      } else if (b.dataset.carHome) {
        return chooseCarHome(tr.cars.find(c => c.id === b.dataset.carHome));
      } else if (b.dataset.carHomeClear) {
        tr.cars.find(c => c.id === b.dataset.carHomeClear).home = null;
      } else if (b.dataset.routeAuto) {
        delete (tr.routePick || {})[b.dataset.routeAuto];
      } else if (b.id === 'trvRecalc') {
        tr.routes = {};
      } else return;
      Store.save();
      render();
    });
  }

  /* For the budget: fuel cost per car (with who pays) and any shuttle cost. */
  function costs() {
    const P = plan();
    return {
      cars: P.cars.map(c => ({ name: c.car.name, payer: c.car.driver, km: c.km, amount: c.amount, unit: c.unit, cost: c.cost, complete: c.complete })),
      fuel: P.fuelCost, shuttle: P.shuttleCost, km: P.km, pending: P.needs.length > 0
    };
  }

  return { render, plan, costs, ensure, timetable, schedule, stopsCard, loadStops, planStops, carPlan, needsStops, stopsReady: () => !!stopsData, timeList, shuffleCard, drivenLegs, legDirections, routesCard, MODES, OPTIMISE };
})();
