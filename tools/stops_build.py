"""Build campplanner/data/stops.json: Australian towns, fuel, EV charging, roadhouses and rest areas for planning
rest and fuel stops on drives. Data © OpenStreetMap contributors (ODbL). Re-run now and then to refresh.

usage: python tools/stops_build.py            (about 10-15 minutes; polite to the Overpass server)

Output items: [name, lat, lon, cls, fuel, ev, toilets]
  cls  3 city · 2 town · 1 village (only villages with fuel) · 0 roadhouse (fuel away from a town) · -1 rest area
  fuel number of fuel stations in / near the place · ev 1 if there's an EV charger · toilets 1 if known
"""
import json, math, os, sys, time, datetime, urllib.request, urllib.parse
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'campplanner', 'data', 'stops.json')
OVERPASS = os.environ.get('OVERPASS', 'https://overpass-api.de/api/interpreter')
REGIONS = {  # south, west, north, east
    'NSW': (-37.6, 140.9, -28.1, 153.7), 'VIC': (-39.3, 140.9, -33.9, 150.1), 'QLD-S': (-29.3, 137.9, -20.0, 153.6),
    'QLD-N': (-20.0, 137.9, -10.0, 146.5), 'SA': (-38.1, 129.0, -25.9, 141.0), 'WA-S': (-35.2, 112.9, -26.0, 129.0),
    'WA-N': (-26.0, 112.9, -13.6, 129.0), 'NT': (-26.0, 129.0, -10.9, 138.1), 'TAS': (-43.7, 143.8, -39.5, 148.5),
}

def overpass(q):
    for attempt in range(4):
        try:
            req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'grafton-camp-planner-build/1.0'})
            j = json.loads(urllib.request.urlopen(req, timeout=300).read())
            if j.get('remark') and 'error' in j['remark'].lower():
                raise RuntimeError(j['remark'])
            return j['elements']
        except Exception as e:
            print('   retry after error:', str(e)[:120]); time.sleep(30 * (attempt + 1))
    raise RuntimeError('Overpass failed')

def km(a, b):
    R = 6371.0; p1, p2 = math.radians(a[0]), math.radians(b[0]); dp = p2 - p1; dl = math.radians(b[1] - a[1])
    return 2 * R * math.asin(math.sqrt(math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2))

def pos(e):
    if 'lat' in e: return (e['lat'], e['lon'])
    c = e.get('center'); return (c['lat'], c['lon']) if c else None

places, fuel, chargers, rests = {}, [], [], []
for name, (s, w, n, e) in REGIONS.items():
    bb = f'{s},{w},{n},{e}'
    q = (f'[out:json][timeout:240];(node["place"~"^(city|town|village)$"]["name"]({bb});nwr["amenity"="fuel"]({bb});'
         f'nwr["amenity"="charging_station"]({bb});nwr["highway"="rest_area"]({bb}););out center tags;')
    t = time.time(); els = overpass(q)
    print(f'{name}: {len(els)} elements in {time.time() - t:.0f}s')
    for el in els:
        tg, p = el.get('tags', {}), pos(el)
        if not p: continue
        if tg.get('place'):
            places[(el['type'], el['id'])] = {'name': tg['name'], 'p': p, 'cls': {'city': 3, 'town': 2, 'village': 1}[tg['place']], 'fuel': 0, 'ev': 0}
        elif tg.get('amenity') == 'fuel':
            fuel.append({'name': tg.get('name') or tg.get('brand') or 'Fuel', 'p': p, 'id': (el['type'], el['id'])})
        elif tg.get('amenity') == 'charging_station':
            chargers.append(p)
        elif tg.get('highway') == 'rest_area':
            rests.append({'name': tg.get('name') or 'Rest area', 'p': p, 'toilets': 1 if tg.get('toilets') == 'yes' else 0, 'id': (el['type'], el['id'])})
    time.sleep(15)

# grid of places for nearest lookups
cell = lambda p: (int(p[0] * 10), int(p[1] * 10))
grid = {}
for k, pl in places.items():
    grid.setdefault(cell(pl['p']), []).append(pl)
def near_place(p, maxkm):
    c, best = cell(p), (None, maxkm)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for pl in grid.get((c[0] + dx, c[1] + dy), []):
                lim = maxkm * (2 if pl['cls'] == 3 else 1)          # cities spread further
                d = km(p, pl['p'])
                if d <= lim and d < best[1] * (2 if pl['cls'] == 3 else 1): best = (pl, d)
    return best[0]

seen_fuel, roadhouses = set(), []
for f in fuel:
    if f['id'] in seen_fuel: continue
    seen_fuel.add(f['id'])
    pl = near_place(f['p'], 3.0)
    if pl: pl['fuel'] += 1
    else: roadhouses.append(f)
for p in chargers:
    pl = near_place(p, 3.0)
    if pl: pl['ev'] = 1

items = []
for pl in places.values():
    if pl['cls'] == 1 and not pl['fuel']: continue            # villages only when you can buy fuel there
    items.append([pl['name'], round(pl['p'][0], 4), round(pl['p'][1], 4), pl['cls'], pl['fuel'], pl['ev'], 1 if pl['cls'] >= 2 else 0])
rh_seen = []
for f in roadhouses:
    if any(km(f['p'], q) < 0.3 for q in rh_seen[-50:]): continue
    rh_seen.append(f['p'])
    items.append([f['name'], round(f['p'][0], 4), round(f['p'][1], 4), 0, 1, 0, 1])
rid = set()
for r in rests:
    if r['id'] in rid: continue
    rid.add(r['id'])
    items.append([r['name'], round(r['p'][0], 4), round(r['p'][1], 4), -1, 0, 0, r['toilets']])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({'updated': datetime.date.today().isoformat(), 'source': 'OpenStreetMap contributors (ODbL)',
           'fields': ['name', 'lat', 'lon', 'cls', 'fuel', 'ev', 'toilets'], 'items': items},
          open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print(f'{len(items)} stops -> {os.path.normpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)', dict(Counter(i[3] for i in items)))
