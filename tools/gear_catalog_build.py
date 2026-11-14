"""Build campplanner/data/gear-catalog.json from the per-store scrape files.

Usage:  python tools/gear_catalog_build.py <folder with snowys.json, bcf.json, ...>

Each input file is a JSON array of {store, name, brand, category, sub, weightG, priceAUD, url, sku, attrs}.
Output keys per item: s store, n name, b brand, c category, u store category, w grams, p AUD price, l url, a specs.
"""
import json, os, re, sys, datetime, collections

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'campplanner', 'data', 'gear-catalog.json')

CATEGORIES = ['Shelter', 'Sleep', 'Pack', 'Kitchen', 'Water', 'Clothing', 'Footwear', 'Navigation',
              'Safety & First Aid', 'Hygiene', 'Electronics', 'Tools', 'Fishing & Leisure', 'Other']
STORES = {
    'snowys': ('Snowys', 'https://www.snowys.com.au/'),
    'tentworld': ('Tentworld', 'https://www.tentworld.com.au/'),
    'zenbivy': ('Zenbivy', 'https://zenbivy.com/'),
    'bcf': ('BCF', 'https://www.bcf.com.au/'),
    'anaconda': ('Anaconda', 'https://www.anacondastores.com/'),
    'altongoods': ('Alton Goods', 'https://altongoods.com/'),
    'drifta': ('Drifta', 'https://www.drifta.com.au/'),
    'seatosummit': ('Sea to Summit', 'https://seatosummit.com.au/'),
    'wildearth': ('Wild Earth', 'https://www.wildearth.com.au/'),
}
SMALL = {'to', 'and', 'of', 'the', 'by', 'for'}


def clean(s, n=200):
    if s is None:
        return None
    s = re.sub(r'\s+', ' ', str(s)).strip()
    return s[:n] or None


def main(src):
    rows = []
    for fn in sorted(os.listdir(src)):
        if not fn.endswith('.json'):
            continue
        with open(os.path.join(src, fn), encoding='utf-8') as f:
            part = json.load(f)
        print(f'{fn}: {len(part)}')
        rows += part

    # brand spelling: the most common spelling of each brand (case/space-insensitive) wins
    spell = collections.defaultdict(collections.Counter)
    key = lambda b: re.sub(r'[^a-z0-9]', '', b.lower())
    for r in rows:
        b = clean(r.get('brand'), 60)
        if b:
            spell[key(b)][b] += 1
    def brand(b):
        b = clean(b, 60)
        if not b:
            return None
        best = spell[key(b)].most_common()
        # prefer a mixed-case spelling over ALL CAPS when there's a choice
        mixed = [s for s, _ in best if not s.isupper()]
        return mixed[0] if mixed else best[0][0]

    seen, items = set(), []
    for r in rows:
        url, name = clean(r.get('url'), 400), clean(r.get('name'))
        st = r.get('store')
        if not url or not name or st not in STORES or url in seen:
            continue
        seen.add(url)
        cat = r.get('category') if r.get('category') in CATEGORIES else 'Other'
        w = r.get('weightG')
        try:
            w = int(round(float(w))) if w is not None else None
        except (TypeError, ValueError):
            w = None
        if w is not None and not (1 <= w <= 60000):
            w = None
        p = r.get('priceAUD')
        try:
            p = round(float(p), 2) if p is not None else None
        except (TypeError, ValueError):
            p = None
        if p is not None and not (0 < p < 20000):
            p = None
        it = {'s': st, 'n': name, 'c': cat, 'l': url}
        b = brand(r.get('brand'))
        if b: it['b'] = b
        sub = clean(r.get('sub'), 60)
        if sub: it['u'] = sub
        if w is not None: it['w'] = w
        if p is not None: it['p'] = p
        attrs = {clean(k, 30): clean(v, 40) for k, v in (r.get('attrs') or {}).items() if clean(k, 30) and clean(v, 40)}
        if attrs: it['a'] = dict(list(attrs.items())[:6])
        items.append(it)

    items.sort(key=lambda i: (CATEGORIES.index(i['c']), (i.get('b') or '~').lower(), i['n'].lower()))
    used = sorted({i['s'] for i in items})
    out = {'updated': datetime.date.today().isoformat(),
           'stores': {k: {'name': STORES[k][0], 'url': STORES[k][1]} for k in used},
           'items': items}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    print(f'\n{len(items)} products -> {os.path.normpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)')
    for s in used:
        its = [i for i in items if i['s'] == s]
        print(f"  {STORES[s][0]:12} {len(its):5}  weight {sum('w' in i for i in its):5}  price {sum('p' in i for i in its):5}")
    print('  by category:', dict(collections.Counter(i['c'] for i in items)))
    print('  brands:', len({i.get('b') for i in items if i.get('b')}))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
