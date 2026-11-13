"""Build campplanner/data/recipe-library.json from collected recipes.

Usage:  python tools/recipe_library_build.py <recipes.json> [more.json ...]

Each input is a JSON array of recipes in the planner's format (per serving):
{name, slot, waterMl, ingredients:[{name, qty, unit, weightG, kcal, cost}], equipment:[], notes, tags:[], prepMin, source:{site,title,url}}
"""
import json, os, sys, datetime, collections

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'campplanner', 'data', 'recipe-library.json')
SLOTS = ('breakfast', 'lunch', 'dinner', 'snacks')


def n(v, nd=0):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0
    return round(x, nd) if nd else int(round(x))


def main(paths):
    out, seen, dropped = [], set(), 0
    for p in paths:
        with open(p, encoding='utf-8') as f:
            for r in json.load(f):
                name = ' '.join(str(r.get('name') or '').split())
                ings = [{'name': ' '.join(str(i.get('name') or '').split()), 'qty': n(i.get('qty'), 2) or 0, 'unit': str(i.get('unit') or '').strip(),
                         'weightG': n(i.get('weightG')), 'kcal': n(i.get('kcal')), 'cost': n(i.get('cost'), 2)}
                        for i in r.get('ingredients') or [] if str(i.get('name') or '').strip()]
                key = name.lower()
                if not name or not ings or r.get('slot') not in SLOTS or key in seen:
                    dropped += 1
                    continue
                seen.add(key)
                src = r.get('source') or {}
                rec = {'name': name, 'slot': r['slot'], 'waterMl': n(r.get('waterMl')), 'ingredients': ings,
                       'equipment': [str(e).strip() for e in r.get('equipment') or [] if str(e).strip()],
                       'notes': ' '.join(str(r.get('notes') or '').split()),
                       'tags': sorted({str(t).strip().lower() for t in r.get('tags') or [] if str(t).strip()})}
                if r.get('prepMin') is not None:
                    rec['prepMin'] = n(r.get('prepMin'))
                if src.get('url'):
                    rec['source'] = {'site': src.get('site') or '', 'title': src.get('title') or name, 'url': src['url']}
                out.append(rec)
    out.sort(key=lambda r: (SLOTS.index(r['slot']), r['name'].lower()))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'updated': datetime.date.today().isoformat(), 'recipes': out}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(out)} recipes ({dropped} dropped) -> {os.path.normpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)')
    print('  by slot:', dict(collections.Counter(r['slot'] for r in out)))
    print('  by site:', dict(collections.Counter((r.get('source') or {}).get('site') for r in out)))
    kc = sorted(sum(i['kcal'] for i in r['ingredients']) for r in out)
    if kc:
        print('  kcal/serve min/median/max:', kc[0], kc[len(kc) // 2], kc[-1])


if __name__ == '__main__':
    main(sys.argv[1:])
