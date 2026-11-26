#!/usr/bin/env python3
"""Carry a client's new name from the Command Centre onto reelestatemedia.com.

  python3 tools/names.py renames.json        # run from the repo root

renames.json is the list the Vault sync produced: [{"key": "v17", "from": "Old Name", "to": "New Name"}].
It changes the agent name on those reels in index.html and keeps the old page link working (the old link forwards to the new one).
It prints what it changed as JSON; it does not commit."""
import io, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
slug = lambda t: re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', str(t).lower()))

def main():
    items = json.load(open(sys.argv[1], encoding='utf8'))
    idx = os.path.join(ROOT, 'index.html'); s = io.open(idx, encoding='utf8').read()
    a = s.index('/*LIB*/') + 7; b = s.index('/*END*/'); lib = json.loads(s[a:b]); by = {r['k']: r for r in lib}
    done, skipped = [], []
    for it in items:
        r = by.get(it.get('key')); to = str(it.get('to') or '').strip()
        if not r or not to or len(to) > 80 or re.search(r'[<>{}\\]|https?:', to):
            skipped.append(it); continue
        if r['a'] == to: continue
        done.append({'key': r['k'], 'from': r['a'], 'to': to}); r['a'] = to
    s = s[:a] + json.dumps(lib, ensure_ascii=False, separators=(',', ':')) + s[b:]
    c = s.index('/*AKA*/') + 7; d = s.index('/*END-AKA*/'); aka = json.loads(s[c:d])
    names = {r['a'] for r in lib}
    for x in done:
        old, new = slug(x['from']), slug(x['to'])
        if old and new and old != new and x['from'] not in names:
            aka[old] = new
            for k, v in list(aka.items()):
                if v == old: aka[k] = new
    aka = {k: v for k, v in aka.items() if k != v}
    s = s[:c] + json.dumps(aka, ensure_ascii=False, separators=(',', ':')) + s[d:]
    io.open(idx, 'w', encoding='utf8').write(s)
    print(json.dumps({'renamed': done, 'skipped': skipped, 'old_links': aka}, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
