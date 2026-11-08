# -*- coding: utf-8 -*-
"""
בונה גרסת קובץ אחד לשיתוף: dist/oath_of_the_blade.html – כל התמונות מוטמעות בתוך הקובץ (data URI).
הרצה:  python tools/bundle.py
"""
import os, re, base64, mimetypes, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'game.html'), encoding='utf-8').read()
def data_uri(rel):
    path = os.path.join(ROOT, rel.replace('/', os.sep))
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    return 'data:%s;base64,%s' % (mime, base64.b64encode(open(path, 'rb').read()).decode())
files = [os.path.relpath(f, ROOT).replace(os.sep, '/') for f in glob.glob(os.path.join(ROOT, 'assets', '**', '*.*'), recursive=True)]
i = src.index('<script>')
html, js = src[:i], src[i:]
# ב-HTML (תגי img / css) – מטמיעים ישירות
html = re.sub(r"""(['"])(assets/[^'"]+)(['"])""", lambda m: m.group(1) + data_uri(m.group(2)) + m.group(3), html)
# ב-JS – טבלה אחת של כל הנכסים + פונקציה שממירה נתיב ל-data URI
table = '{' + ','.join('"%s":"%s"' % (f, data_uri(f)) for f in files) + '}'
js = js.replace("'use strict';", "'use strict';\nconst ASSET_DATA = %s;\nfunction assetURL(p){ return ASSET_DATA[p] || p; }\n" % table, 1)
js = re.sub(r"""'(assets/[^']+)'""", lambda m: "assetURL('%s')" % m.group(1), js)
js = re.sub(r"`(assets/[^`]+)`", lambda m: "assetURL(`%s`)" % m.group(1), js)
js = js.replace("'url(assets/story/cabin.jpg)'", "'url(' + assetURL('assets/story/cabin.jpg') + ')'")
js = js.replace("im.src = src;", "im.src = assetURL(src);")
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
dst = os.path.join(ROOT, 'dist', 'oath_of_the_blade.html')
open(dst, 'w', encoding='utf-8').write(html + js)
print('bundle written:', dst, '%.1f MB' % (os.path.getsize(dst)/1e6))
