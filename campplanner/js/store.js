/* Camp Planner — shared state, persistence and helpers.
   Trips live in the website's database (api/camp.php). Anyone can view and print them;
   signed-in leaders with Camp Planner access can change them. */

const ACTIVE_KEY = 'campPlanner.activeTrip';  // last trip opened on this device
const API_BASE = '../api/';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid() { return Math.random().toString(36).slice(2, 10); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function num(v, d = 0) { const n = parseFloat(v); return isFinite(n) ? n : d; }
function fmtKg(g, dp = 2) { return (g / 1000).toFixed(dp) + ' kg'; }
function fmtG(g) { return Math.abs(g) >= 1000 ? fmtKg(g) : Math.round(g) + ' g'; }
function fmtMoney(v) { return (v || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }); }
function fmtMins(m) { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm} min`; }

function isoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}
function fmtDate(d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return d.toLocaleDateString(undefined, opts);
}

/* Days of the trip, keyed by index (D1, D2…) so changing dates keeps the meal plan. */
function tripDays() {
  const t = Store.state.trip;
  const s = parseDate(t.start), e = parseDate(t.end);
  if (!s || !e || e < s) return [{ key: 'D1', label: 'Day 1', date: s }];
  const out = [];
  for (let d = new Date(s), i = 1; d <= e && i <= 60; d.setDate(d.getDate() + 1), i++) {
    out.push({ key: 'D' + i, label: 'Day ' + i, date: new Date(d) });
  }
  return out;
}

function personName(id) {
  if (id === 'group') return 'Group';
  const p = Store.state.people.find(p => p.id === id);
  return p ? p.name : 'Group';
}

function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms);
}

function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsText(file);
  });
}

function safeName(s) { return String(s || 'camp').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'camp'; }

async function getJSON(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new Error((j && j.reason) || `HTTP ${r.status}`);
  return j;
}

const AU_STATES = {
  'New South Wales': 'NSW', 'Victoria': 'VIC', 'Queensland': 'QLD', 'South Australia': 'SA', 'Western Australia': 'WA',
  'Tasmania': 'TAS', 'Northern Territory': 'NT', 'Australian Capital Territory': 'ACT', 'Jervis Bay Territory': 'ACT'
};

/* Place search in Australia: OpenStreetMap Nominatim (finds parks, tracks, campgrounds), falling back to Open-Meteo. */
async function geocode(q) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=au&addressdetails=1&q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    return j.map(x => ({
      name: x.display_name.replace(/, Australia$/, ''), short: x.name || x.display_name.split(',')[0],
      lat: +x.lat, lon: +x.lon, state: AU_STATES[x.address?.state] || ''
    }));
  } catch (e) {
    const j = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=8&countryCode=AU&name=' + encodeURIComponent(q));
    return (j.results || []).map(x => ({
      name: [x.name, x.admin1].filter(Boolean).join(', '), short: x.name, lat: x.latitude, lon: x.longitude, state: AU_STATES[x.admin1] || ''
    }));
  }
}

/* State/territory code for a point (NSW, VIC…), or '' outside Australia. */
async function stateAt(lat, lon) {
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&addressdetails=1&lat=${lat}&lon=${lon}`);
  const j = await r.json();
  return AU_STATES[j.address?.state] || '';
}

const Store = {
  state: null,
  tripId: null,       // database id (string), or null when nothing is saved yet
  created: null,
  updated: null,
  version: 0,
  user: null,         // from auth.php?action=me
  canEdit: false,     // signed in with Camp Planner access
  dbOk: true,
  dirty: false,       // changes not yet sent to the website
  saving: null,       // the save in flight
  conflict: null,     // set when someone else saved this trip first
  loadError: '',

  defaults() {
    const today = new Date();
    const end = new Date(today); end.setDate(end.getDate() + 2);
    return {
      version: 1,
      trip: { name: 'My Camp Trip', start: isoDate(today), end: isoDate(end), startTime: '09:00', location: '', lat: null, lon: null, coastal: false, notes: '', state: '', park: null, status: 'planning' },
      people: [{ id: uid(), name: 'Me', bodyKg: 75, waterL: 2 }],
      map: {
        base: 'topo', hillshade: false, labels: true, grid: 'mga', center: [-29.69, 152.93], zoom: 8, features: [],
        routeSource: 'osm', snap: true, data: { parks: true, tracks: false, pois: false },
        hidden: { groups: [], ids: [], camp: false }
      },
      recipes: [],
      mealPlan: {},
      shopping: {},
      gear: [],
      risks: [],
      emergency: {},
      weather: { cache: null, marine: null },
      travel: {
        home: null, startId: '', finishId: '', mode: 'auto', departTime: '07:00', walkEndTime: '14:00', shuttleCost: 0,
        prices: Object.fromEntries(Object.entries(FUEL_TYPES).map(([k, f]) => [k, f.price])),
        cars: [], routes: {}, routePick: {}, optimise: 'balanced', timeValue: 25, avoidUnsealed: false
      },
      budget: { fees: [], items: [], foodPaidBy: '', targetPP: 0 }
    };
  },

  /* Who is signed in, then open the requested (or most relevant) trip.
     ?trip=<id> (trips you can see), ?t=<share link> (private / secret trips), ?new=1 (a blank plan). */
  async load() {
    try { this.user = await Server.call('auth.php?action=me'); } catch (e) { this.user = { signedIn: false }; }
    const u = this.user;
    this.role = u.signedIn && !u.mustChange ? (u.campRole || 'none') : 'none';
    this.canPlan = this.role === 'leader' || this.role === 'super';
    this.isSuper = this.role === 'super';
    this.isAdmin = !!(u.signedIn && !u.mustChange && u.campAdmin);
    const q = new URLSearchParams(location.search);
    this.token = q.get('t') || '';
    if (q.get('new') && this.canPlan) return this.blank();
    if (this.token) {
      try { return this.use(await this.fetchTrip(null, this.token)); }
      catch (e) {
        if (e.status === 423) return this.locked();
        this.loadError = e.message; return this.blank();
      }
    }
    let trips = [];
    try { trips = await this.fetchList(); } catch (e) { this.loadError = e.message; }
    const asked = q.get('trip');
    if (asked && !trips.some(t => t.id === asked)) {
      /* not in your list (e.g. a draft you can't see): ask anyway for the right message */
      try { return this.use(await this.fetchTrip(asked)); } catch (e) { this.loadError = e.message; return this.blank(); }
    }
    const today = isoDate(new Date());
    const mine = trips.filter(t => t.team || t.canEdit);
    const pool = mine.length ? mine : trips;
    const live = pool.filter(t => !t.meta.example && !['completed', 'archived'].includes(t.meta.status));
    const pick = trips.find(t => t.id === (asked || remembered()))
      || live.filter(t => (t.meta.end || t.meta.start || '') >= today).sort((a, b) => String(a.meta.start).localeCompare(String(b.meta.start)))[0]
      || live.sort((a, b) => b.updated - a.updated)[0]
      || pool.slice().sort((a, b) => b.updated - a.updated)[0];
    if (pick) {
      try { return this.use(await this.fetchTrip(pick.id)); } catch (e) { this.loadError = e.message; }
    }
    this.blank();
  },

  /* A new, unsaved plan: planners' first change saves it as their own draft. */
  blank() {
    this.state = this.newState();
    this.tripId = null;
    this.access = null;
    this.canEdit = this.canPlan;
  },

  /* A secret trip: ask for its lock code, then load it. */
  locked() {
    this.blank();
    this.canEdit = false;
    this.needsCode = true;
  },

  use(rec) {
    this.tripId = rec.id;
    this.created = rec.created;
    this.updated = rec.updated;
    this.version = rec.version;
    this.access = rec;                     // owner, planners, publishing state, what you may do
    this.history = rec.history || [];
    this.canEdit = !!(this.canPlan && rec.canEdit);
    this.state = this.migrate(rec.state);
    this.remember();
  },

  /* Keep the open trip in the address bar (shareable link) and on this device. */
  remember() {
    if (!this.tripId) return;
    try { localStorage.setItem(ACTIVE_KEY, this.tripId); } catch (e) { /* storage blocked */ }
    if (this.token) return;                // came by a share link: keep it
    try { history.replaceState(null, '', '?trip=' + encodeURIComponent(this.tripId) + location.hash); } catch (e) { /* ignore */ }
  },

  /* The link to give people: public trips by number, private and secret ones by their share link. */
  shareUrl() {
    const a = this.access;
    const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'app.html';
    if (!a) return '';
    return a.visibility === 'public' || !a.shareToken ? `${base}?trip=${a.id}` : `${base}?t=${a.shareToken}`;
  },

  /* Publishing and sharing actions (server checks who may do what). */
  async act(action, body = {}) {
    await this.persist();
    const r = await Server.call('camp.php?action=' + action, { id: this.tripId, ...body });
    if (r.trip) {
      this.access = { ...this.access, ...r.trip };
      this.history = r.history || this.history;
      this.canEdit = !!(this.canPlan && this.access.canEdit);
    }
    return r;
  },

  newState() {
    const s = this.defaults();
    s.recipes = SAMPLE_RECIPES.map(r => ({ ...JSON.parse(JSON.stringify(r)), id: uid() }));
    return s;
  },

  /* Summary shown in the trip list without loading the whole plan. */
  metaOf(s) {
    const trails = (s.map?.features || []).filter(f => f.type === 'trail');
    /* a pin for the trip map: the camp, else where the first trail starts */
    const at = s.trip.lat != null && s.trip.lon != null ? [s.trip.lat, s.trip.lon] : (trails[0] && trails[0].coords[0]) || null;
    return {
      name: s.trip.name, status: s.trip.status || 'planning', start: s.trip.start, end: s.trip.end, location: s.trip.location || '',
      park: s.trip.park ? `${s.trip.park.name} ${s.trip.park.type}` : '', state: s.trip.state || '', people: (s.people || []).length,
      km: trails.reduce((t, f) => t + Geo.lineLength(f.coords), 0) / 1000, example: !!s.trip.example,
      lat: at ? +(+at[0]).toFixed(3) : null, lon: at ? +(+at[1]).toFixed(3) : null,
      summary: (s.trip.notes || '').replace(/\s+/g, ' ').slice(0, 160)
    };
  },

  /* Fill in any fields added since the plan was saved. */
  migrate(s) {
    const d = this.defaults();
    for (const k of Object.keys(d)) if (s[k] === undefined || s[k] === null) s[k] = d[k];
    for (const k of ['trip', 'map', 'emergency', 'weather', 'travel', 'budget']) s[k] = Object.assign({}, d[k], s[k]);
    /* objects keyed by day or item must stay objects */
    for (const k of ['mealPlan', 'shopping']) if (Array.isArray(s[k]) || typeof s[k] !== 'object') s[k] = {};
    if (!s.travel.routes || Array.isArray(s.travel.routes)) s.travel.routes = {};
    s.travel.prices = Object.assign({}, d.travel.prices, s.travel.prices);
    /* Price the starter recipes in plans saved before costs existed. */
    s.recipes.forEach(r => r.ingredients.forEach(i => {
      if (i.cost === undefined) i.cost = INGREDIENT_PRICES[(i.name || '').toLowerCase()] ?? 0;
    }));
    if (!s.people.length) s.people = d.people;
    if (typeof s.map.grid === 'boolean') s.map.grid = s.map.grid ? 'latlon' : 'mga';
    s.map.data = Object.assign({}, d.map.data, s.map.data);
    /* Trails always follow tracks by default; straight lines are chosen per leg */
    if (s.map.routeSource === 'straight') s.map.routeSource = 'osm';
    s.map.snap = true;
    return s;
  },

  /* Called after every change. Editors' changes are saved to the website shortly after. */
  save() {
    if (!this.canEdit) return;   // visitors: nothing is saved (Account tells them once)
    if (this.conflict) return;
    this.dirty = true;
    Account.saveState('pending');
    clearTimeout(this._t);
    this._t = setTimeout(() => this.persist(), 1500);
  },

  /* Send the open trip to the website (one save at a time). */
  async persist() {
    clearTimeout(this._t);
    if (this.saving) await this.saving;
    if (!this.canEdit || this.conflict || !this.dirty) return;
    this.dirty = false;
    Account.saveState('saving');
    this.saving = Server.call('camp.php?action=save', { id: this.tripId, version: this.version, state: this.state, meta: this.metaOf(this.state) })
      .then(r => {
        const first = !this.tripId;
        this.tripId = r.id; this.version = r.version; this.updated = r.updated;
        if (!this.created) this.created = r.updated;
        this.remember();
        /* a new trip: fetch its publishing details (owner, share link) */
        if (first) this.fetchTrip(r.id).then(rec => { this.access = rec; this.history = rec.history; if (App.current === 'trip') Trip.render(); }).catch(() => {});
        Account.saveState(this.dirty ? 'pending' : 'saved');
      })
      .catch(e => {
        if (e.status === 409) { this.conflict = e.message; Account.conflict(e.message); return; }
        this.dirty = true;
        if (e.status === 401 || e.status === 403) { this.canEdit = false; Account.lostAccess(e.message); return; }
        Account.saveState('error', e.message);
        clearTimeout(this._t);
        this._t = setTimeout(() => this.persist(), 15000);   // try again
      })
      .finally(() => { this.saving = null; });
    return this.saving;
  },

  /* Someone else saved first: save mine over the top of theirs. */
  async overwrite() {
    const cur = await this.fetchTrip(this.tripId);
    this.version = cur.version;
    this.conflict = null;
    this.dirty = true;
    return this.persist();
  },

  hasUnsaved() { return this.canEdit && (this.dirty || !!this.saving); },

  saveNow() { return this.persist(); },

  /* ---------- trip database (on the website) ---------- */
  async fetchList() {
    return (await Server.call('camp.php?action=list')).trips.map(t => ({ ...t, meta: { ...t.meta, status: t.status } }));
  },

  async fetchTrip(id, token) {
    const r = await Server.call('camp.php?action=get&' + (token ? 't=' + encodeURIComponent(token) : 'id=' + encodeURIComponent(id)));
    return { ...r.trip, history: r.history || [] };
  },

  async list() {
    await this.persist();
    const all = await this.fetchList();
    if (!this.tripId) all.unshift({ id: null, meta: this.metaOf(this.state), created: Date.now(), updated: Date.now() });
    return all;
  },

  async open(id) {
    await this.persist();
    try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) { /* ignore */ }
    const url = location.pathname + '?trip=' + encodeURIComponent(id) + location.hash;
    if (url === location.pathname + location.search + location.hash) location.reload();
    else location.href = url;
  },

  requireEdit() {
    if (this.canEdit) return;
    if (!this.user.signedIn) { Account.prompt(); throw new Error('Sign in as a leader with Camp Planner access to change trips.'); }
    throw new Error(this.canPlan ? 'Only this trip\'s leaders (owner and co-planners) or a superuser can change it.' : 'Your account can view trips but not plan them — ask a Camp Planner admin for access.');
  },

  /* Making a new trip only needs planning access (it becomes your own draft). */
  requirePlan() {
    if (this.canPlan) return;
    if (!this.user.signedIn) { Account.prompt(); throw new Error('Sign in as a leader with Camp Planner access to plan trips.'); }
    throw new Error('Your account can view trips but not plan them — ask a Camp Planner admin for access.');
  },

  async create(state, open = true) {
    this.requirePlan();
    const s = this.migrate(state);
    const r = await Server.call('camp.php?action=save', { state: s, meta: this.metaOf(s) });
    if (open) await this.open(r.id);
    return r.id;
  },

  async get(id) {
    if (id === this.tripId) { await this.persist(); return { id, state: this.state }; }
    return this.fetchTrip(id);
  },

  async duplicate(id) {
    const rec = await this.get(id);
    const s = JSON.parse(JSON.stringify(rec.state));
    s.trip.name += ' (copy)';
    s.trip.status = 'planning';
    delete s.trip.example;
    return this.create(s, false);
  },

  /* A new plan that reuses people, gear, recipes, cars and fuel prices — not the map, meals or dates. */
  async fromTemplate(id) {
    const src = JSON.parse(JSON.stringify((await this.get(id)).state));
    const s = this.newState();
    s.people = src.people;
    s.recipes = src.recipes;
    s.gear = src.gear.map(g => ({ ...g, packed: false }));
    s.travel = { ...s.travel, home: src.travel.home, cars: src.travel.cars, prices: src.travel.prices };
    ['contact', 'medical', 'firstAider', 'plb'].forEach(k => { if (src.emergency[k]) s.emergency[k] = src.emergency[k]; });
    s.trip.name = 'New trip';
    return this.create(s);
  },

  async update(id, fn) {
    if (id === this.tripId) this.requireEdit(); else this.requirePlan();   // the website checks other trips
    if (id === this.tripId) { fn(this.state); this.dirty = true; return this.persist(); }
    const rec = await this.fetchTrip(id);
    fn(rec.state);
    return Server.call('camp.php?action=save', { id, version: rec.version, state: rec.state, meta: this.metaOf(rec.state) });
  },

  async remove(id) {
    this.requirePlan();                    // owner or superuser: the website checks
    await Server.call('camp.php?action=delete', { id });
    if (id === this.tripId) {
      this.dirty = false;
      try { localStorage.removeItem(ACTIVE_KEY); } catch (e) { /* ignore */ }
      location.href = location.pathname + location.hash;
    }
  },

  /* Clear the active trip back to a blank plan (other trips are not affected). */
  reset() { this.requireEdit(); this.state = this.newState(); this.dirty = true; return this.persist(); },

  async exportAll() {
    await this.persist();
    const trips = [];
    for (const t of await this.fetchList()) {
      const rec = await this.get(t.id);
      trips.push({ id: t.id, created: t.created, state: rec.state });
    }
    return { app: 'camp-planner', version: 1, exported: new Date().toISOString(), trips };
  },

  /* Import a single-plan file or an all-trips backup. Imported trips are always added, never overwritten. */
  async importData(data) {
    this.requirePlan();
    const plans = data.trips ? data.trips.map(t => t.state) : [data];
    for (const p of plans) if (!p || !p.trip || !p.people) throw new Error('not a Camp Planner file');
    for (const p of plans) await this.create(p, false);
    return plans.length;
  }
};

function remembered() { try { return localStorage.getItem(ACTIVE_KEY) || ''; } catch (e) { return ''; } }

/* Calls to the website's API (same session cookie and CSRF token as the leaders' program editor). */
const Server = {
  csrf: '',
  async call(path, body) {
    const init = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-CSRF-Token'] = this.csrf;
      init.body = JSON.stringify(body);
    }
    let r;
    try { r = await fetch(API_BASE + path, init); }
    catch (e) { const err = new Error('Could not reach the website — check your internet connection.'); err.status = 0; throw err; }
    const j = await r.json().catch(() => ({}));
    if (j && j.csrf) this.csrf = j.csrf;
    if (!r.ok) { const err = new Error(j.error || `The website returned an error (${r.status}).`); err.status = r.status; err.data = j; throw err; }
    return j;
  }
};
