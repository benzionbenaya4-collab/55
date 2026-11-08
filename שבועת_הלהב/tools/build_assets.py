# -*- coding: utf-8 -*-
"""
צנרת נכסים: קוראת את האמנות המקורית בתיקייה הראשית (בלי לשנות אותה)
ומייצרת ספרייטים נקיים בתיקיית assets/.
הרצה:  python tools/build_assets.py
"""
import os, sys, shutil, glob
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')
DEBUG = os.path.join(ROOT, 'tools', 'debug')

SRC = {
    'hero_front':  'ChatGPT Image Sep 7, 2026, 07_47_03 PM.png',
    'hero_right':  'ChatGPT Image Sep 7, 2026, 07_50_15 PM.png',
    'hero_left':   'ChatGPT Image Sep 7, 2026, 07_51_24 PM.png',
    'hero_walk':   'Gemini_Generated_Image_p70dpmp70dpmp70d.jpg',
    'monsters_sheet': 'ChatGPT Image Sep 7, 2026, 07_13_17 PM.png',
    'bosses_sheet':   'ChatGPT Image Sep 7, 2026, 07_12_14 PM.png',
    'final_boss':  'ChatGPT Image Sep 7, 2026, 07_06_06 PM.png',
    'cabin':       'ChatGPT Image Sep 7, 2026, 07_48_04 PM.png',
    'story_attack':  'Gemini_Generated_Image_jtm83sjtm83sjtm8.jpg',
    'story_grief':   'Gemini_Generated_Image_e2iwhle2iwhle2iw.jpg',
    'story_farewell':'Gemini_Generated_Image_r6xg74r6xg74r6xg.jpg',
    'start_button': '3456.png',
}

def P(name): return os.path.join(ROOT, SRC[name])
def ensure(*parts):
    d = os.path.join(OUT, *parts); os.makedirs(d, exist_ok=True); return d

# ---------- כלי עזר ----------
def flood_bg_mask_fast(rgb, is_bg_fn):
    """מסכת רקע: פיקסלים 'רקעיים' שמחוברים לשולי התמונה. הרחבה איטרטיבית ב-numpy."""
    cand = is_bg_fn(rgb)
    h, w = cand.shape
    mask = np.zeros((h, w), bool)
    mask[0, :] = cand[0, :]; mask[-1, :] = cand[-1, :]
    mask[:, 0] |= cand[:, 0]; mask[:, -1] |= cand[:, -1]
    while True:
        grown = mask.copy()
        grown[1:, :] |= mask[:-1, :]
        grown[:-1, :] |= mask[1:, :]
        grown[:, 1:] |= mask[:, :-1]
        grown[:, :-1] |= mask[:, 1:]
        grown &= cand
        if np.array_equal(grown, mask): return mask
        mask = grown

def remove_light_bg(img, thresh=215):
    """מסיר רקע לבן / שחמט בהיר שמחובר לשוליים. מחזיר RGBA."""
    rgb = np.array(img.convert('RGB')).astype(np.int16)
    def is_bg(a):
        mn = a.min(axis=2); mx = a.max(axis=2)
        return (mn > thresh) & ((mx - mn) < 18)
    mask = flood_bg_mask_fast(rgb, is_bg)
    a = np.full(rgb.shape[:2], 255, np.uint8); a[mask] = 0
    return Image.fromarray(np.dstack([rgb.astype(np.uint8), a]), 'RGBA')

def remove_dark_bg(img, thresh=48):
    """מסיר רקע כהה שמחובר לשוליים (גיליונות המפלצות). מחזיר RGBA."""
    rgb = np.array(img.convert('RGB')).astype(np.int16)
    def is_bg(a):
        return a.max(axis=2) < thresh
    mask = flood_bg_mask_fast(rgb, is_bg)
    a = np.full(rgb.shape[:2], 255, np.uint8); a[mask] = 0
    return Image.fromarray(np.dstack([rgb.astype(np.uint8), a]), 'RGBA')

def crop_alpha(img, pad=2):
    a = np.array(img)[:, :, 3]
    ys, xs = np.where(a > 0)
    if len(ys) == 0: return img
    return img.crop((max(0, xs.min()-pad), max(0, ys.min()-pad), min(img.width, xs.max()+1+pad), min(img.height, ys.max()+1+pad)))

def components(alpha, min_area=200):
    """רכיבים מחוברים (4-שכנים) על מסכת אלפא. מחזיר רשימת [x0,y0,x1,y1,area]."""
    h, w = alpha.shape
    lab = np.zeros((h, w), np.int32)
    boxes = []
    cur = 0
    on = alpha > 0
    ys, xs = np.where(on)
    for y, x in zip(ys, xs):
        if lab[y, x] == 0:
            cur += 1
            q = deque([(y, x)]); lab[y, x] = cur
            x0=x1=x; y0=y1=y; area=0
            while q:
                cy, cx = q.popleft(); area += 1
                if cx<x0:x0=cx
                if cx>x1:x1=cx
                if cy<y0:y0=cy
                if cy>y1:y1=cy
                for ny, nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                    if 0<=ny<h and 0<=nx<w and on[ny,nx] and lab[ny,nx]==0:
                        lab[ny,nx]=cur; q.append((ny,nx))
            if area >= min_area: boxes.append([int(x0),int(y0),int(x1)+1,int(y1)+1,area])
    return boxes

def merge_boxes(boxes, gap):
    """מאחד קופסאות קרובות (חלקיקים שמרחפים ליד המפלצת)."""
    boxes = [list(b) for b in boxes]
    changed = True
    while changed:
        changed = False
        out = []
        while boxes:
            b = boxes.pop()
            merged = False
            for o in out:
                if b[0] < o[2]+gap and b[2] > o[0]-gap and b[1] < o[3]+gap and b[3] > o[1]-gap:
                    o[0]=min(o[0],b[0]); o[1]=min(o[1],b[1]); o[2]=max(o[2],b[2]); o[3]=max(o[3],b[3]); o[4]+=b[4]
                    merged = True; changed = True; break
            if not merged: out.append(b)
        boxes = out
    return boxes

def save(img, *parts):
    d = ensure(*parts[:-1]); p = os.path.join(d, parts[-1]); img.save(p); return p

def fit(img, max_w, max_h):
    s = min(max_w/img.width, max_h/img.height, 1.0)
    if s >= 1.0: return img
    return img.resize((max(1,int(img.width*s)), max(1,int(img.height*s))), Image.LANCZOS)

def crop_to_width(img):
    a = np.array(img)[:,:,3]
    xs = np.where(a.any(axis=0))[0]
    return img.crop((xs.min(), 0, xs.max()+1, img.height))

# ---------- 1. מדי חיים ושריון (פריימים שצייר המשתמש) ----------
def build_bars():
    for f in glob.glob(os.path.join(ROOT, '*.png')):
        im = Image.open(f)
        if im.width != 45 or im.height != 12: continue
        a = np.array(im.convert('RGB'))[1:-1, 1:-1]
        red = ((a[:,:,0]>200)&(a[:,:,1]<80)).mean()
        blue = ((a[:,:,2]>200)&(a[:,:,0]<80)).mean()
        if red > 0: kind, frac = 'red', red
        elif blue > 0: kind, frac = 'blue', blue
        else:
            for k in ('red','blue'):
                shutil.copy(f, os.path.join(ensure('ui','bars'), 'bar_%s_000.png' % k))
            continue
        shutil.copy(f, os.path.join(ensure('ui','bars'), 'bar_%s_%03d.png' % (kind, int(round(frac*100)))))
    print('bars ok')

# ---------- 2. הגיבור ----------
def build_hero():
    for key, name in (('hero_front','portrait_front'),('hero_right','portrait_right'),('hero_left','portrait_left')):
        im = remove_light_bg(Image.open(P(key)))
        im = crop_alpha(im)
        save(fit(im, 512, 768), 'characters', 'hero', name+'.png')
    walk = remove_light_bg(Image.open(P('hero_walk')), thresh=225)
    walk = crop_alpha(walk, pad=0)
    walk = fit(walk, 400, 520)
    W, H = walk.size
    arr = np.array(walk)
    # קו החיתוך: מעבר מטוניקה למכנסיים – השורה הצרה ביותר בין 55% ל-75% מהגובה
    rows = (arr[:,:,3] > 0).sum(axis=1)
    y0, y1 = int(H*0.55), int(H*0.75)
    cut = y0 + int(np.argmin(rows[y0:y1]))
    torso = walk.crop((0, 0, W, cut))
    legs = walk.crop((0, cut, W, H))
    la = np.array(legs)[:,:,3]
    xs = np.where(la.any(axis=0))[0]
    lcx = (xs.min() + xs.max()+1)//2
    def squash(legs_img, factor):
        la = np.array(legs_img)[:,:,3]
        xs = np.where(la.any(axis=0))[0]
        x0, x1 = xs.min(), xs.max()+1
        part = legs_img.crop((x0, 0, x1, legs_img.height))
        nw = max(8, int(part.width*factor))
        part = part.resize((nw, part.height), Image.LANCZOS)
        out = Image.new('RGBA', legs_img.size, (0,0,0,0))
        out.paste(part, (lcx - nw//2, 0), part)
        return out
    def flip_legs(legs_img):
        la = np.array(legs_img)[:,:,3]
        xs = np.where(la.any(axis=0))[0]
        x0, x1 = xs.min(), xs.max()+1
        part = legs_img.crop((x0, 0, x1, legs_img.height)).transpose(Image.FLIP_LEFT_RIGHT)
        out = Image.new('RGBA', legs_img.size, (0,0,0,0))
        out.paste(part, (lcx - part.width//2, 0), part)
        return out
    frames = [
        ('walk_0', legs, 0),
        ('walk_1', squash(legs, 0.55), -3),
        ('walk_2', flip_legs(legs), 0),
        ('walk_3', squash(legs, 0.55), -3),
        ('idle',   squash(legs, 0.5), 0),
    ]
    for name, lg, bob in frames:
        canvas = Image.new('RGBA', (W, H+6), (0,0,0,0))
        la = np.array(lg)[:,:,3]
        ys = np.where(la.any(axis=1))[0]
        bottom = ys.max()+1
        ly = (H+3) - bottom   # כפות הרגליים תמיד על קו הקרקע
        canvas.paste(lg, (0, ly), lg)
        canvas.paste(torso, (0, 3+bob), torso)
        canvas = crop_to_width(canvas)
        save(canvas, 'characters', 'hero', name+'.png')
    print('hero ok, cut at', cut, 'of', H)


def strip_labels(img):
    """מסיר תוויות טקסט (פסים מלאים ומעוגלים) וחיצים שנדבקו לספרייט – בקצה העליון/התחתון בלבד."""
    arr = np.array(img)
    a = arr[:,:,3] > 0
    h, w = a.shape
    if h < 24: return img
    left = np.full(h, -1); right = np.full(h, -1); cnt = a.sum(axis=1)
    for y in range(h):
        xs = np.where(a[y])[0]
        if len(xs): left[y] = xs.min(); right[y] = xs.max()
    ext = right - left + 1
    mid = ext[int(h*0.3):int(h*0.7)]
    med = np.median(mid[mid > 0]) if (mid > 0).any() else w
    kill = np.zeros(h, bool)
    zones = list(range(0, int(h*0.25))) + list(range(int(h*0.7), h-12))
    y = 0
    for y0 in zones:
        if kill[y0]: continue
        L = left[y0:y0+12]; R = right[y0:y0+12]; C = cnt[y0:y0+12]; E = ext[y0:y0+12]
        if (L < 0).any(): continue
        solid = (C / np.maximum(E, 1)).mean()
        if L.std() < 1.5 and R.std() < 1.5 and E[0] > 50 and solid > 0.9:
            ya, yb = y0, y0+12
            while ya > 0 and left[ya-1] >= 0 and abs(left[ya-1]-L[0]) < 8 and abs(right[ya-1]-R[0]) < 8: ya -= 1
            while yb < h and left[yb] >= 0 and abs(left[yb]-L[0]) < 8 and abs(right[yb]-R[0]) < 8: yb += 1
            ph = yb - ya
            # פנים התווית כהה (כמעט שחור) – בניגוד לגוף מפלצת צבעוני
            inner = arr[ya:yb, int(L[0])+3:int(R[0])-2, :3]
            dark_frac = (inner.max(axis=2) < 70).mean() if inner.size else 0
            if ph < 60 and E[0] > 2.2*ph and dark_frac > 0.45:
                kill[max(0,ya-1):min(h,yb+1)] = True
    # חיצים: בחלק העליון בלבד – רצף דק (<=5 שורות) של שורות רחבות בהרבה מהגוף
    y = 0; top = int(h*0.2)
    while y < top:
        if ext[y] > 1.5*med and not kill[y]:
            y0 = y
            while y < h and ext[y] > 1.5*med: y += 1
            if y - y0 <= 5: kill[y0:y] = True
        else: y += 1
    if kill.any():
        arr = arr.copy(); arr[kill, :, 3] = 0
        out = crop_alpha(Image.fromarray(arr, 'RGBA'), pad=0)
        if out.height >= 0.6*h: return out
    return img

# ---------- 3. מפלצות ----------
ELEMENTS = ['water', 'fire', 'dark', 'nature', 'ice', 'blood']  # סדר השורות בגיליון
TOP_TRIM = {('dark', 0): 0.24}

def build_monsters():
    sheet = remove_dark_bg(Image.open(P('monsters_sheet')), thresh=52)
    alpha = np.array(sheet)[:,:,3]
    H, W = alpha.shape
    # רצועות שורה: מפרידים לפי שורות ריקות לגמרי (רוחב פער >= 3), ובוחרים את 6 הגדולות
    on = (alpha > 0).sum(axis=1)
    bands = []; y = 0
    while y < H:
        if on[y] > 0:
            y0 = y
            while y < H and on[y] > 0: y += 1
            bands.append([y0, y])
        else: y += 1
    merged = []
    for b in bands:
        if merged and b[0] - merged[-1][1] < 3: merged[-1][1] = b[1]
        else: merged.append(b)
    bands = sorted(sorted(merged, key=lambda b: b[1]-b[0], reverse=True)[:6])
    print('row bands:', bands)
    os.makedirs(DEBUG, exist_ok=True)
    dbg = sheet.convert('RGB').copy(); dd = ImageDraw.Draw(dbg)
    for i, (y0, y1) in enumerate(bands):
        el = ELEMENTS[i]
        y0e = max(0, y0-8); y1e = min(H, y1+8)
        band = alpha[y0e:y1e]
        bh = y1e - y0e
        boxes = components(band, min_area=150)
        # מסירים תוויות (פסים רחבים ונמוכים) וחיצים לפני האיחוד
        boxes = [b for b in boxes if not ((b[3]-b[1]) < bh*0.22 and (b[2]-b[0]) > 2.5*(b[3]-b[1]))]
        boxes = merge_boxes(boxes, gap=4)
        boxes = [b for b in boxes if (b[3]-b[1]) > bh*0.28]
        boxes.sort(key=lambda b: b[0])
        # פריימים שנדבקו זה לזה: מפצלים קופסה רחבה מדי לשניים
        if len(boxes) >= 4:
            widths = sorted(b[2]-b[0] for b in boxes[2:])
            med = widths[len(widths)//2]
            split = []
            for b in boxes:
                if b is not boxes[0] and (b[2]-b[0]) > 1.6*med:
                    mid = (b[0]+b[2])//2
                    split.append([b[0], b[1], mid, b[3], b[4]//2]); split.append([mid, b[1], b[2], b[3], b[4]//2])
                else: split.append(b)
            boxes = split
        for b in boxes:
            dd.rectangle((b[0], y0e+b[1], b[2], y0e+b[3]), outline=(255,0,0), width=2)
        print(el, 'boxes', [(b[0], b[2]) for b in boxes])
        crops = [strip_labels(sheet.crop((b[0], y0e+b[1], b[2], y0e+b[3]))) for b in boxes]
        if len(crops) < 3: continue
        big, mini, frames = crops[0], crops[1], crops[2:]
        # פריים גבוה מהאחרים = תווית שנדבקה מעליו; חותכים מלמעלה לגובה החציוני
        hs = sorted(f.height for f in frames); medh = hs[len(hs)//2]
        frames = [f.crop((0, f.height-int(medh*1.08), f.width, f.height)) if f.height > 1.2*medh else f for f in frames]
        # תיקונים ידניים: (יסוד, פריים) -> חלק מהגובה לחתוך מלמעלה
        for (e2, j), frac in TOP_TRIM.items():
            if e2 == el and j < len(frames):
                f = frames[j]; frames[j] = crop_alpha(f.crop((0, int(f.height*frac), f.width, f.height)), pad=0)
        save(fit(big, 420, 420), 'monsters', el, 'big.png')
        save(fit(mini, 200, 200), 'monsters', el, 'mini.png')
        for j, fr in enumerate(frames[:6]):
            save(fit(fr, 220, 220), 'monsters', el, 'walk_%d.png' % j)
    dbg.save(os.path.join(DEBUG, 'monsters_boxes.png'))
    print('monsters ok')

def hue_shift(im, delta, sat=1.0):
    hsv = np.array(im.convert('RGB').convert('HSV')).astype(np.int16)
    hsv[:,:,0] = (hsv[:,:,0] + delta) % 256
    hsv[:,:,1] = np.clip(hsv[:,:,1] * sat, 0, 255)
    rgb = Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB')
    return Image.merge('RGBA', (*rgb.split(), im.split()[3]))

def build_bosses():
    sheet = remove_dark_bg(Image.open(P('bosses_sheet')), thresh=52)
    W, H = sheet.size
    order = ['water', 'dark', 'fire', 'nature', 'ice', 'blood']   # רשת 3x2
    k = 0
    for r in range(2):
        for c in range(3):
            cell = sheet.crop((int(W*c/3), int(H*r/2), int(W*(c+1)/3), int(H*(r+1)/2)))
            cell = crop_alpha(cell)
            save(fit(cell, 600, 600), 'monsters', order[k], 'boss.png')
            k += 1
    # דרקון סגול = גרסת גוון של דרקון הקרח
    ice = Image.open(os.path.join(OUT, 'monsters', 'ice', 'boss.png')).convert('RGBA')
    save(hue_shift(ice, 60, 1.15), 'monsters', 'dragon', 'boss.png')
    for j in range(6):
        p = os.path.join(OUT, 'monsters', 'ice', 'walk_%d.png' % j)
        if os.path.exists(p):
            save(hue_shift(Image.open(p).convert('RGBA'), 60, 1.15), 'monsters', 'dragon', 'walk_%d.png' % j)
    fb = crop_alpha(Image.open(P('final_boss')).convert('RGBA'))
    save(fit(fb, 800, 600), 'monsters', 'shadow', 'boss.png')
    print('bosses ok')

# ---------- 4. סיפור ורקעים ----------
def build_story():
    for key in ('cabin', 'story_attack', 'story_grief', 'story_farewell'):
        im = Image.open(P(key)).convert('RGB')
        save(fit(im, 1280, 1280), 'story', key + '.jpg')
    save(Image.open(P('start_button')).convert('RGBA'), 'ui', 'start_button.png')
    print('story ok')

# ---------- 5. הקוסם והנשקים (האמנות של החבר – קבצים בתיקייה הראשית) ----------
SRC.update({
    'wizard': 'wizard.png',
    'wand_basic': 'wand_1.png', 'wand_sigil': 'wand_2.png', 'wand_orb': 'wand_3.png',
    'sword_basic': 'sword_basic.png', 'sword_red': 'sword_red.png', 'sword_dragon': 'sword_purple.png',
    'bow_wood': 'bow_wood.png', 'bow_red': 'bow_red.png', 'bow_dragon': 'bow_purple.png',
})

def load_clean(key):
    """טוען תמונה ומסיר את הרקע (לבן / שחמט / כהה) לפי מה שיש בפינה."""
    im = Image.open(P(key))
    if im.mode == 'RGBA' and np.array(im)[:, :, 3].min() == 0:
        return im.convert('RGBA')
    c = np.array(im.convert('RGB'))[0, 0].astype(int)
    if c.max() < 90: return remove_dark_bg(im, thresh=max(70, int(c.max()) + 25))
    return remove_light_bg(im, thresh=210)

def biggest_components(img, n):
    """מחזיר את n הרכיבים הגדולים (לפי שטח) כתמונות חתוכות, ממוינים משמאל לימין."""
    alpha = np.array(img)[:, :, 3]
    small = img.copy(); small.thumbnail((400, 400))
    sc = img.width / small.width
    boxes = components(np.array(small)[:, :, 3], min_area=80)
    boxes = merge_boxes(boxes, gap=3)
    boxes.sort(key=lambda b: -b[4])
    boxes = sorted(boxes[:n], key=lambda b: b[0])
    out = []
    for b in boxes:
        x0, y0, x1, y1 = [int(v * sc) for v in b[:4]]
        out.append(crop_alpha(img.crop((max(0, x0-4), max(0, y0-4), min(img.width, x1+4), min(img.height, y1+4))), pad=0))
    return out

def build_wizard():
    """הקוסם של החבר: תמונה אחת -> idle + 4 פריימי הליכה (נדנוד + הזזת כפות רגליים)."""
    im = crop_alpha(load_clean('wizard'), pad=0)
    im = fit(im, 400, 560)
    W, H = im.size
    save(im, 'characters', 'wizard', 'portrait_front.png')
    feet_y = int(H * 0.90)                       # מתחת לקו הזה – כפות הרגליים
    body = im.crop((0, 0, W, feet_y)); feet = im.crop((0, feet_y, W, H))
    fa = np.array(feet)[:, :, 3]; xs = np.where(fa.any(axis=0))[0]
    fx0, fx1 = xs.min(), xs.max() + 1; fcx = (fx0 + fx1) // 2
    left_foot = feet.crop((fx0, 0, fcx, feet.height)); right_foot = feet.crop((fcx, 0, fx1, feet.height))
    def frame(bob, lo, ro, skew):
        c = Image.new('RGBA', (W + 20, H + 8), (0, 0, 0, 0))
        c.paste(left_foot, (fx0 + lo + 10, feet_y + 4), left_foot)
        c.paste(right_foot, (fcx + ro + 10, feet_y + 4), right_foot)
        b = body.transform(body.size, Image.AFFINE, (1, skew, -skew * H * 0.5, 0, 1, 0), Image.BICUBIC)
        c.paste(b, (10, 4 + bob), b)
        return crop_to_width(c)
    save(frame(0, 0, 0, 0), 'characters', 'wizard', 'idle.png')
    for i, (bob, lo, ro, sk) in enumerate([(0, -14, 14, 0.03), (-6, 0, 0, 0), (0, 14, -14, -0.03), (-6, 0, 0, 0)]):
        save(frame(bob, lo, ro, sk), 'characters', 'wizard', 'walk_%d.png' % i)
    print('wizard ok')

def build_weapons():
    """שרביטים, חרבות וקשתות של החבר -> assets/weapons/<שם>.png (+ arrow_<שם>.png לחץ של כל קשת)."""
    for key in ('wand_basic', 'wand_sigil', 'wand_orb', 'sword_basic', 'sword_red', 'sword_dragon'):
        im = crop_alpha(load_clean(key), pad=2)
        save(fit(im, 256, 512), 'weapons', key + '.png')
    for key in ('bow_wood', 'bow_red', 'bow_dragon'):
        im = load_clean(key)
        # בקשתות האדומה והסגולה יש פאנלים של תקריב בצד ימין – מסתכלים רק על 60% השמאליים
        if key != 'bow_wood': im = im.crop((0, 0, int(im.width * 0.62), im.height))
        parts = biggest_components(im, 2)     # קשת (שמאל) + חץ (ימין)
        if len(parts) == 2:
            bow, arrow = parts
        else:
            bow, arrow = parts[0], None
        save(fit(bow, 256, 512), 'weapons', key + '.png')
        if arrow is not None: save(fit(arrow, 128, 512), 'weapons', 'arrow_' + key + '.png')
    print('weapons ok')


# ---------- 6. העולם ההפוך: נשקי הוויד (אחרי הפורטל) ונשקי הכאוס ----------
SRC.update({ 'void_set': 'void_set.png', 'chaos_wand': 'chaos_wand.png', 'chaos_bow': 'chaos_bow.png', 'chaos_sword': 'chaos_sword.png' })

def straighten(img, wide_up):
    """מסובב ציור אלכסוני כך שהציר הראשי אנכי. wide_up=True: הקצה הרחב (ראש שרביט) למעלה; False: הקצה הצר (חוד חרב) למעלה."""
    a = np.array(img)[:, :, 3] > 0
    ys, xs = np.nonzero(a)
    cx, cy = xs.mean(), ys.mean()
    cov = np.cov(np.vstack([xs - cx, ys - cy]))
    vals, vecs = np.linalg.eigh(cov)
    vx, vy = vecs[:, np.argmax(vals)]           # כיוון הציר הראשי
    ang = np.degrees(np.arctan2(vx, -vy))       # זווית שמביאה את הציר לאנכי
    rot = img.rotate(ang, resample=Image.BICUBIC, expand=True)
    rot = crop_alpha(rot, pad=0)
    ra = np.array(rot)[:, :, 3] > 0
    h = ra.shape[0]; n = max(1, int(h * 0.3))
    top_w = ra[:n].sum(axis=1).max(); bot_w = ra[-n:].sum(axis=1).max()
    if (wide_up and bot_w > top_w) or (not wide_up and top_w > bot_w):
        rot = rot.transpose(Image.ROTATE_180)
    return rot

def strip_checker(img, thresh=200):
    """מסיר שחמט/לבן גם בתוך צורה סגורה (למשל בין הקשת למיתר) – כל פיקסל בהיר ולא רווי."""
    a = np.array(img).astype(np.int16)
    rgb = a[:, :, :3]; mn = rgb.min(axis=2); mx = rgb.max(axis=2)
    bg = (mn > thresh) & ((mx - mn) < 22)
    a[:, :, 3][bg] = 0
    return Image.fromarray(a.astype(np.uint8), 'RGBA')

def build_void_chaos():
    # סט הוויד: 4 חפצים בשורה – קשת, חץ, שרביט, חרב
    im = strip_checker(load_clean('void_set'))
    parts = biggest_components(im, 4)
    parts = sorted(parts, key=lambda x: x.width * 0 + 0)  # שומרים סדר לפי x (biggest_components כבר ממיין לפי x)
    names = ['bow_void', 'arrow_bow_void', 'wand_void', 'sword_void']
    for name, part in zip(names, parts):
        if name == 'sword_void': part = part.transpose(Image.ROTATE_180)   # בציור הידית למעלה – במשחק הלהב למעלה
        save(fit(part, 128 if name.startswith('arrow') else 256, 512), 'weapons', name + '.png')
    # קשת הכאוס: חץ (צר) + קשת (רחבה)
    im = strip_checker(load_clean('chaos_bow'))
    parts = biggest_components(im, 2)
    parts = sorted(parts, key=lambda x: x.width)
    save(fit(parts[0], 128, 512), 'weapons', 'arrow_bow_chaos.png')
    save(fit(parts[1], 256, 512), 'weapons', 'bow_chaos.png')
    # חרב ושרביט הכאוס מצוירים באלכסון – מיישרים
    save(fit(straighten(crop_alpha(load_clean('chaos_sword'), pad=0), wide_up=False), 256, 512), 'weapons', 'sword_chaos.png')
    save(fit(straighten(crop_alpha(load_clean('chaos_wand'), pad=0), wide_up=True), 256, 512), 'weapons', 'wand_chaos.png')
    print('void/chaos ok')


# ---------- 7. סוף המשחק: נשקי האור (גרסה לבנה של הכאוס) והשטן בעל שש הרגליים ----------
def whiten(img):
    """הופך ציור לגרסה לבנה־בהירה: הבהירות נשמרת כפרטים, הצבע הופך ללבן־תכלת."""
    a = np.array(img.convert('RGBA')).astype(np.float32)
    lum = 0.299*a[:,:,0] + 0.587*a[:,:,1] + 0.114*a[:,:,2]
    base = 255 - (255 - lum) * 0.42
    a[:,:,0] = np.clip(base*0.96, 0, 255); a[:,:,1] = np.clip(base*0.985, 0, 255); a[:,:,2] = np.clip(base, 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')

def build_white_and_devil():
    from PIL import ImageFilter
    for src, dst in (('sword_chaos','sword_white'), ('bow_chaos','bow_white'), ('arrow_bow_chaos','arrow_bow_white'), ('wand_chaos','wand_white')):
        im = Image.open(os.path.join(OUT, 'weapons', src + '.png')).convert('RGBA')
        save(whiten(im), 'weapons', dst + '.png')
    # השטן: גוף אדום־שחור, קרניים, כנפיים, שש רגליים, עיניים זוהרות – מצויר פרוצדורלית
    W, H = 900, 720
    im = Image.new('RGBA', (W, H), (0,0,0,0)); d = ImageDraw.Draw(im)
    dark, red, hot = (40, 5, 10, 255), (140, 15, 25, 255), (230, 60, 40, 255)
    # כנפיים
    for sgn in (-1, 1):
        pts = [(450, 300), (450 + sgn*420, 90), (450 + sgn*400, 250), (450 + sgn*330, 330), (450 + sgn*250, 300), (450 + sgn*150, 380)]
        d.polygon(pts, fill=(20, 0, 8, 255)); d.line(pts + [pts[0]], fill=red, width=6)
    # שש רגליים (3 מכל צד)
    for i, (dx, dy) in enumerate([(-300, 690), (-200, 700), (-100, 690), (100, 690), (200, 700), (300, 690)]):
        hip = (450 + dx*0.35, 480 + (i%3)*10); knee = (450 + dx*0.8, 560 + (i%3)*15); foot = (450 + dx, dy)
        d.line([hip, knee, foot], fill=dark, width=34); d.line([hip, knee, foot], fill=red, width=16)
        d.polygon([(foot[0]-28, foot[1]), (foot[0]+28, foot[1]), (foot[0], foot[1]+22)], fill=dark)
        for c in (-18, 0, 18): d.polygon([(foot[0]+c-8, foot[1]+4), (foot[0]+c+8, foot[1]+4), (foot[0]+c, foot[1]+28)], fill=hot)
    # גוף
    d.ellipse((280, 300, 620, 600), fill=dark); d.ellipse((310, 330, 590, 580), fill=red)
    for y in range(360, 560, 40): d.line((330, y, 570, y+10), fill=dark, width=8)
    d.ellipse((400, 400, 500, 500), fill=hot)  # לב זוהר
    # ראש, קרניים, פנים
    d.ellipse((350, 150, 550, 340), fill=dark); d.ellipse((365, 165, 535, 325), fill=red)
    d.polygon([(370, 190), (300, 40), (410, 170)], fill=dark); d.polygon([(530, 190), (600, 40), (490, 170)], fill=dark)
    d.polygon([(375, 185), (320, 70), (405, 175)], fill=hot); d.polygon([(525, 185), (580, 70), (495, 175)], fill=hot)
    d.ellipse((395, 215, 435, 245), fill=(255, 230, 60, 255)); d.ellipse((465, 215, 505, 245), fill=(255, 230, 60, 255))
    d.ellipse((405, 222, 425, 240), fill=(0,0,0,255)); d.ellipse((475, 222, 495, 240), fill=(0,0,0,255))
    d.polygon([(400, 275), (500, 275), (450, 315)], fill=(0,0,0,255))
    for x in range(405, 500, 18): d.polygon([(x, 275), (x+14, 275), (x+7, 300)], fill=(240, 240, 220, 255))
    # הילה אדומה
    glow = Image.new('RGBA', (W, H), (0,0,0,0)); gd = ImageDraw.Draw(glow)
    gd.ellipse((200, 100, 700, 650), fill=(255, 40, 20, 120)); glow = glow.filter(ImageFilter.GaussianBlur(50))
    out = Image.alpha_composite(glow, im)
    save(out, 'monsters', 'devil', 'boss.png')
    print('white/devil ok')

if __name__ == '__main__':
    build_bars()
    build_hero()
    build_monsters()
    build_bosses()
    build_story()
    build_wizard()
    build_weapons()
    build_void_chaos()
    build_white_and_devil()
    print('ALL DONE')
