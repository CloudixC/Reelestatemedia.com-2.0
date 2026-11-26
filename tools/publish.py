#!/usr/bin/env python3
"""Add approved Vault reels to reelestatemedia.com.

  python3 tools/publish.py new.json          # run from the repo root

new.json is the list the Vault sync produced: [{"id": drive file id, "h": short hash, "name": file name, "agent": ..., "co": "P" | "S" | brokerage name,
"title": ..., "date": "YYYY-MM-DD", optional "t": final title, optional "c": category}].
For each one it downloads the file, makes the 720p web copy, the poster and the wall still, adds the reel to the list inside index.html
and records it in media/vault/manifest.json. Files named "(web preview)" are refused. It prints what it did as JSON; it does not commit."""
import io, json, os, re, subprocess, sys, tempfile, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = os.path.join(ROOT, 'media', 'vault')
CATS = [('recruiting', r'recruit|join (us|our)|hiring'), ('events', r'event|recap|summit|gala|diwali|party|open house|launch|awards?'),
        ('precon', r'pre-?con|project tour|sales office|towns?\b|condos?\b|by [A-Z][a-z]+ homes|builder'),
        ('listings', r'\d+\s+\w+.*\b(rd|road|st|street|ave|avenue|dr|drive|cres|crescent|crt|court|blvd|way|lane|ln|pl|place|trail)\b|listing|walk ?through|for sale')]

def run(*a):
    return subprocess.run(a, capture_output=True, text=True, stdin=subprocess.DEVNULL)

def probe(path, entries, stream=True):
    a = ['ffprobe', '-v', 'error'] + (['-select_streams', 'v:0'] if stream else []) + ['-show_entries', entries, '-of', 'csv=p=0', path]
    return run(*a).stdout.strip().split('\n')[0].strip(', ')

def clean_title(t):
    t = re.sub(r'^\s*(reel|video)\s*[-·:]\s*', '', t or '', flags=re.I)
    t = re.sub(r'\s*\((tier[^)]*|v\d+|final)\)\s*', ' ', t, flags=re.I)
    t = re.sub(r'\s+[-–—]\s+', ', ', t).strip(' -·,')
    return (t[:1].upper() + t[1:]) if t else 'New reel'

def category(text):
    for c, pat in CATS:
        if re.search(pat, text, flags=re.I):
            return c
    return 'brand'

def main():
    items = json.load(open(sys.argv[1], encoding='utf8'))
    idx = os.path.join(ROOT, 'index.html'); s = io.open(idx, encoding='utf8').read()
    a = s.index('/*LIB*/') + 7; b = s.index('/*END*/'); lib = json.loads(s[a:b])
    man_p = os.path.join(V, 'manifest.json'); man = json.load(open(man_p))
    used = [int(k[1:]) for k in list(man['on'].values()) + list(man.get('hold', {}).values()) + [r['k'] for r in lib] if re.fullmatch(r'v\d+', k)]
    nxt = max(used + [0]) + 1
    done, failed = [], []
    for it in items:
        if re.search(r'web\s*preview', it.get('name', ''), flags=re.I):
            failed.append({'name': it.get('name'), 'why': 'web preview copy, refused'}); continue
        if it['h'] in man['on'] or it['h'] in man.get('hold', {}):
            continue
        key = 'v%02d' % nxt
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'src.bin')
            ok = False
            for _ in range(3):
                r = run('curl', '-sS', '-L', '-m', '900', '-o', src, 'https://drive.usercontent.google.com/download?id=%s&export=download&confirm=t' % it['id'])
                if os.path.exists(src) and probe(src, 'stream=width'):
                    ok = True; break
            if not ok:
                failed.append({'name': it.get('name'), 'why': 'could not download a video from Drive'}); continue
            w, h = int(probe(src, 'stream=width')), int(probe(src, 'stream=height'))
            rot = probe(src, 'stream_side_data=rotation').lstrip('-')
            if rot in ('90', '270'): w, h = h, w
            dur = float(probe(src, 'format=duration', stream=False))
            tall = h > w
            vf, pf = ('scale=720:-2:flags=lanczos', 'scale=540:-2') if tall else ('scale=-2:720:flags=lanczos', 'scale=-2:540')
            out = os.path.join(V, key + '.mp4')
            r = run('ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', src, '-vf', vf, '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'faster',
                    '-crf', '25', '-maxrate', '1500k', '-bufsize', '3000k', '-g', '96', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', out)
            if r.returncode or not os.path.getsize(out):
                failed.append({'name': it.get('name'), 'why': 'encode failed: ' + r.stderr[-120:]}); continue
            if os.path.getsize(out) > 95 * 1024 * 1024:
                os.remove(out); failed.append({'name': it.get('name'), 'why': 'web copy over 95 MB, too large for the site'}); continue
            run('ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', str(max(0.5, dur * 0.22)), '-i', src, '-frames:v', '1', '-vf', pf, '-q:v', '5', os.path.join(V, key + '.jpg'))
            if tall:
                run('ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', str(dur * 0.5), '-i', src, '-frames:v', '1',
                    '-vf', 'scale=216:384:force_original_aspect_ratio=increase,crop=216:384,format=gray', '-q:v', '60', os.path.join(V, key + '-w.webp'))
        agent = it.get('agent', '')
        if agent.startswith('Pinnacle ('): agent = 'Royal LePage Pinnacle'
        sec = int(round(dur)); title = it.get('t') or clean_title(it.get('title'))
        row = {'k': key, 't': title, 'a': agent, 'co': it.get('co') or 'Independent', 'c': it.get('c') or category((it.get('title') or '') + ' ' + (it.get('project') or '')),
               'l': '%d:%02d' % (sec // 60, sec % 60), 'dt': (it.get('date') or '')[:10]}
        if not tall: row['w'] = 1
        lib.append(row); man['on'][it['h']] = key; nxt += 1
        done.append({'key': key, 'title': title, 'agent': agent, 'co': row['co'], 'cat': row['c'], 'id': it['id'],
                     'lib': 'pinnacle' if row['co'] == 'P' else 'skyway' if row['co'] == 'S' else ''})
    lib.sort(key=lambda r: (r['dt'], r['k']), reverse=True)
    s = s[:a] + json.dumps(lib, ensure_ascii=False, separators=(',', ':')) + s[b:]
    io.open(idx, 'w', encoding='utf8').write(s)
    json.dump(man, open(man_p, 'w'), indent=0, sort_keys=True)
    print(json.dumps({'added': done, 'failed': failed, 'reels_on_site': len(lib)}, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
