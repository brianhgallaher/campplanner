/* Camp Planner — example trips. Each builder returns a complete plan (same shape as Store.defaults()). */

const Examples = {
  list: [
    { key: 'larapinta', name: 'Larapinta Trail end-to-end (NT)', blurb: '223 km, 17 days, Alice Springs to Mt Sonder — 16 campsites, 3 food drops, desert water plan' }
  ],

  build(key) { return this[key](); },

  larapinta() {
    const s = Store.defaults(), L = LARAPINTA;
    const id = p => 'lp-' + p;
    s.trip = {
      ...s.trip, name: 'Larapinta Trail end-to-end (example)', start: '2027-06-05', end: '2027-06-21',
      location: 'Ormiston Gorge', lat: -23.6332, lon: 132.727, coastal: false, state: 'NT',
      park: { name: 'Tjoritja / West MacDonnell', type: 'National Park', state: 'NT' }, status: 'planning', example: true,
      notes: 'Example plan: the Larapinta Trail end-to-end, west from the Alice Springs Telegraph Station to Redbank Gorge, finishing with a sunrise climb of Mt Sonder (Rwetyepme) and back to Redbank. ' +
        '17 days / 16 nights in the cool season (June). Food drops at Standley Chasm, Ellery Creek and Ormiston Gorge. Transfer back to Alice Springs from Redbank Gorge. ' +
        'Check NT Parks for current trail conditions, campsite bookings and fees before you go.'
    };
    s.people = [{ id: 'p1', name: 'Alex', bodyKg: 78, waterL: 3 }, { id: 'p2', name: 'Sam', bodyKg: 64, waterL: 3 }];

    /* ---- map: landmarks, itinerary campsites and the trail ---- */
    const feats = [];
    L.stops.forEach((st, i) => feats.push({ id: id('stop' + i), type: 'landmark', kind: st.kind, name: st.name, lat: st.lat, lng: st.lng,
      notes: i ? (i === L.stops.length - 1 ? 'Sunrise summit, 1380 m — return to Redbank Gorge' : `Night ${i}`) : 'Start of Section 1' }));
    L.landmarks.forEach((m, i) => {
      if (feats.some(f => Geo.hav([f.lat, f.lng], [m.lat, m.lng]) < 60 && f.kind === m.kind)) return;
      feats.push({ id: id('lm' + i), type: 'landmark', kind: m.kind, name: m.name, lat: m.lat, lng: m.lng, notes: m.notes });
    });
    const byName = n => feats.find(f => f.name === n);
    const trail = {
      id: id('trail'), type: 'trail', name: 'Larapinta Trail', color: '#d9480f', style: 'solid', width: 4, source: 'osm',
      notes: 'Route: OpenStreetMap Larapinta Trail hiking relations, sections 1–12 (© OpenStreetMap contributors).',
      coords: L.coords, ways: [[L.coords.length - 1, 'track|Larapinta Trail|']],
      stops: L.stops.map((st, i) => ({ ref: id('stop' + i), name: st.name, kind: st.kind, lat: st.lat, lng: st.lng })),
      dropCfg: { rate: 0.6, camp: 4, reserve: 0.5 },
      drops: [
        ['Standley Chasm', 6, 9, 'Day 5 — resupply for days 6–9 (Standley Chasm kiosk)'],
        ['Ellery Creek', 10, 13, 'Day 9 — resupply for days 10–13 (Ellery Creek Big Hole trailhead)'],
        ['Ormiston Gorge', 14, 17, 'Day 13 — resupply for days 14–17 (Ormiston Gorge)']
      ].map(([n, a, b, note]) => ({ n, a, b, note })).map(({ n, a, b, note }) => {
        const st = L.stops.find(x => x.name === n);
        return { id: id('drop-' + a), name: `${n} food drop`, d: st.d, pickupDay: a - 1, foodFrom: a, foodTo: b, waterL: 0, gearIds: [], placedBy: '', placedOn: '2027-06-03',
          notes: note + '. Use a food drop service from Alice Springs or place sealed, labelled, animal-proof boxes yourself — check NT Parks rules.' };
      })
    };
    feats.unshift(trail);
    s.map = { ...s.map, features: feats, center: [-23.68, 133.2], zoom: 9, base: 'topo', labels: false, data: { parks: true, tracks: false, pois: false } };

    /* ---- meals: rotate the sample recipes over 17 days ---- */
    s.recipes = SAMPLE_RECIPES.map(r => ({ ...JSON.parse(JSON.stringify(r)), id: id('r-' + r.name.toLowerCase().replace(/\W+/g, '-')) }));
    const R = n => s.recipes.find(r => r.name.startsWith(n)).id;
    const e = rid => [{ id: uid(), recipeId: rid, servings: 2 }];
    const dinners = ['Pasta bolognese', 'Couscous with chorizo', 'Freeze-dried meal'];
    for (let k = 1; k <= 17; k++) {
      s.mealPlan['D' + k] = {
        breakfast: e(R(k % 4 === 0 ? 'Pancakes' : 'Porridge')),
        lunch: e(R(k % 2 ? 'Tuna & cheese wraps' : 'Salami, crackers')),
        dinner: e(R(dinners[k % 3])),
        snacks: [...e(R('Scroggin')), ...e(R('Muesli bars')), ...e(R('Coffee'))]
      };
    }

    /* ---- gear: starter list for two, plus desert extras ---- */
    const extras = [
      { name: 'Water bladder (3 L)', category: 'Water', weightG: 160, type: 'base', per: 'person' },
      { name: 'Spare water bottle (1.5 L)', category: 'Water', weightG: 45, type: 'base', per: 'person' },
      { name: 'Fly net', category: 'Clothing', weightG: 20, type: 'base', per: 'person' },
      { name: 'Gaiters', category: 'Footwear', weightG: 180, type: 'worn', per: 'person' },
      { name: 'Beanie & gloves (cold desert nights)', category: 'Clothing', weightG: 120, type: 'base', per: 'person' },
      { name: 'Satellite messenger', category: 'Safety & First Aid', weightG: 115, type: 'base', per: 'group', source: 'hire', cost: 8, costBasis: 'day' },
      { name: 'Spare gas canister (230 g)', category: 'Kitchen', weightG: 360, type: 'consumable', per: 'group', source: 'buy', cost: 9.5 }
    ];
    [...GEAR_STARTER, ...extras].forEach(g => (g.per === 'person' ? ['p1', 'p2'] : ['group']).forEach(c => s.gear.push({
      id: id('g-' + s.gear.length), name: g.name, category: g.category, weightG: g.weightG, qty: 1, type: g.type, carrier: c,
      packed: false, notes: '', source: g.source || 'own', cost: g.cost || 0, costBasis: g.costBasis || 'trip', paidBy: ''
    })));
    const spare = s.gear.find(g => g.name.startsWith('Spare gas'));
    trail.drops[1].gearIds = [spare.id]; // the second canister waits at Ellery Creek

    /* ---- risks & emergency ---- */
    const pick = n => ({ ...HAZARD_PRESETS.find(h => h.hazard.startsWith(n)) });
    s.risks = [
      { ...pick('Heat illness'), l: 3, c: 4, location: 'Whole route — exposed ridges, little shade', controls: pick('Heat illness').controls + ' Walk in the cool season (May–August); start at first light.' },
      { ...pick('Hypothermia'), cause: 'Desert nights below 0 °C in June–July', location: 'Ridge-top and gorge campsites' },
      { ...pick('Getting lost'), location: 'Ridgelines and creek beds (follow blue triangle markers)' },
      { ...pick('Slips, trips'), cause: 'Loose quartzite scree, steep rocky climbs', location: 'Sections 3, 6, 8, 9 and Mt Sonder' },
      { ...pick('Snake bite'), location: 'Spinifex and creek beds' },
      { ...pick('Bushfire'), location: 'Spinifex country' },
      { hazard: 'Remote — long response times', cause: 'No mobile reception for most of the trail; help can be many hours away', l: 3, c: 5, rl: 2, rc: 4, location: 'Whole route',
        controls: 'Carry a registered PLB and a satellite messenger. Leave a detailed trip plan with a contact. Note the vehicle-accessible trailheads (Traverse → egress points).' },
      { hazard: 'Running out of water', cause: 'Dry camps (Wallaby Gap, Standley Chasm, Hermits Hideaway) and empty or broken tanks', l: 3, c: 5, rl: 1, rc: 4, location: 'See Traverse → water plan',
        controls: 'Check tank status with NT Parks before leaving. Carry capacity for at least 6 L each. Treat tank water. Follow the water plan; never pass a tank without topping up.' }
    ].map(r => ({ id: uid(), owner: '', l: 3, c: 4, rl: 1, rc: 3, location: '', ...r }));
    s.emergency = {
      number: '000 (112 from mobiles)', hospital: 'Alice Springs Hospital — Gap Road, Alice Springs', ranger: 'NT Parks & Wildlife — Alice Springs office',
      reception: 'Patchy near Alice Springs; mostly none west of Standley Chasm — some ridge tops', plb: 'PLB (registered with AMSA) carried by Alex; satellite messenger carried by Sam',
      evac: 'Vehicle trailheads: Simpsons Gap, Standley Chasm, Ellery Creek, Serpentine Gorge, Ormiston Gorge, Finke River (Glen Helen), Redbank Gorge',
      medical: '', firstAider: '', contact: '', returnBy: '2027-06-22 12:00 — call NT Police if not heard from'
    };

    /* ---- travel & budget (estimates — check current prices) ---- */
    s.travel = { ...s.travel, mode: 'shuttle', shuttleCost: 0, departTime: '06:30', walkEndTime: '11:00' };
    s.budget = {
      ...s.budget, targetPP: 1750,
      fees: [
        { id: uid(), name: 'NT Parks Pass (interstate visitors, 2 weeks+)', type: 'flat', rate: 30, units: 2, nights: '', ref: '', paid: false, paidBy: '' },
        { id: uid(), name: 'Larapinta Trail campsites (check NT Parks booking)', type: 'pppn', rate: 0, units: '', nights: '', ref: '', paid: false, paidBy: '' }
      ],
      items: [
        { id: uid(), cat: 'Shuttle / transport', name: 'Return flights to Alice Springs (estimate, 2 people)', amount: 1200, paidBy: '' },
        { id: uid(), cat: 'Shuttle / transport', name: 'Transfer Redbank Gorge → Alice Springs (estimate)', amount: 400, paidBy: '' },
        { id: uid(), cat: 'Shuttle / transport', name: 'Taxi to Telegraph Station (estimate)', amount: 25, paidBy: '' },
        { id: uid(), cat: 'Other', name: 'Food drop service — 3 drops (estimate)', amount: 450, paidBy: '' },
        { id: uid(), cat: 'Accommodation', name: 'Alice Springs — night before & after (estimate)', amount: 320, paidBy: '' }
      ]
    };
    return s;
  }
};
