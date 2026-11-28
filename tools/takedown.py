#!/usr/bin/env python3
"""Take reels off reelestatemedia.com because the piece is held until paid.

  python3 tools/takedown.py v19 v27          # run from the repo root

Removes each reel from the list inside index.html, deletes its web copy, poster and wall still, and moves its entry in
media/vault/manifest.json from "on" to "unpaid". A reel in "unpaid" is not on the site and is not blocked: once the order is
marked Paid (or the hold is released) the Vault sync lists it as new again and tools/publish.py puts it back.
Prints what it did as JSON, with the brokerage library each reel was in; it does not commit."""
import io, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = os.path.join(ROOT, 'media', 'vault')

def main():
    keys = [k for k in sys.argv[1:] if re.fullmatch(r'v\d{2,4}', k)]
    idx = os.path.join(ROOT, 'index.html'); s = io.open(idx, encoding='utf8').read()
    a = s.index('/*LIB*/') + 7; b = s.index('/*END*/'); lib = json.loads(s[a:b])
    man_p = os.path.join(V, 'manifest.json'); man = json.load(open(man_p)); man.setdefault('unpaid', {})
    done = []
    for k in keys:
        row = next((r for r in lib if r['k'] == k), None)
        if not row: continue
        lib.remove(row)
        for h, kk in list(man['on'].items()):
            if kk == k: man['unpaid'][h] = k; del man['on'][h]
        for ext in ('.mp4', '.jpg', '-w.webp'):
            p = os.path.join(V, k + ext)
            if os.path.exists(p): os.remove(p)
        done.append({'key': k, 'title': row['t'], 'agent': row['a'], 'lib': 'pinnacle' if row['co'] == 'P' else 'skyway' if row['co'] == 'S' else ''})
    s = s[:a] + json.dumps(lib, ensure_ascii=False, separators=(',', ':')) + s[b:]
    io.open(idx, 'w', encoding='utf8').write(s)
    json.dump(man, open(man_p, 'w'), indent=0, sort_keys=True)
    print(json.dumps({'removed': done, 'reels_on_site': len(lib)}, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
