// אולפן ה-AI – יוצרים דמויות, עלילה, סרטים, סדרות ומשחקים.
'use strict';
const NS = 'kolnoa-studio-55';

// =====================================================================
// כלים קטנים
// =====================================================================
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const safeParse = s => { try { return JSON.parse(s); } catch { return null; } };
const hashStr = s => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x); };
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  kids.flat(9).forEach(c => { if (c != null && c !== false) el.append(c.nodeType ? c : String(c)); });
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return el;
}

function toast(msg, type = '') {
  const t = h('div', { class: 'toast ' + type }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 4200);
  setTimeout(() => t.remove(), 4800);
}

const busy = {
  n: 0,
  show(msg) { this.n++; $('#busy-msg').textContent = msg; $('#busy').hidden = false; },
  set(msg) { $('#busy-msg').textContent = msg; },
  hide() { this.n = Math.max(0, this.n - 1); if (!this.n) $('#busy').hidden = true; },
};
async function withBusy(msg, fn) {
  busy.show(msg);
  try { return await fn(); }
  catch (e) { console.error(e); toast('שגיאה: ' + (e.message || e), 'err'); }
  finally { busy.hide(); }
}

function download(name, blobOrText, type = 'text/html') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => a.remove(), 1000);
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const fileName = s => (String(s || 'project').replace(/[\\/:*?"<>|]+/g, '').trim() || 'project');

// =====================================================================
// שמירה מקומית (IndexedDB – נשמר בדפדפן, בלי שרת)
// =====================================================================
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('ai-studio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('projects', mode), req = fn(t.objectStore('projects'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: () => tx('readonly', s => s.getAll()),
    put: p => tx('readwrite', s => s.put(p)),
    del: id => tx('readwrite', s => s.delete(id)),
  };
})();

// =====================================================================
// הגדרות
// =====================================================================
const SKEY = 'aiStudioSettings';
const S = Object.assign({
  geminiKey: '', textProvider: 'auto', imageProvider: 'auto',
  textModel: 'gemini-2.5-flash', imageModel: 'gemini-2.5-flash-image',
}, safeParse(localStorage.getItem(SKEY)) || {});
const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch {} };

// =====================================================================
// AI – טקסט
// =====================================================================
const GEM = 'https://generativelanguage.googleapis.com/v1beta/models/';

async function fetchT(url, init = {}, ms = 120000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'הבקשה לקחה יותר מדי זמן' : 'אין חיבור לשירות (' + e.message + ')'); }
  finally { clearTimeout(t); }
}

async function geminiText(prompt, json) {
  const r = await fetchT(`${GEM}${encodeURIComponent(S.textModel)}:generateContent?key=${encodeURIComponent(S.geminiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 1, ...(json ? { responseMimeType: 'application/json' } : {}) } }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || 'HTTP ' + r.status);
  const t = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!t) throw new Error('ג׳מיני החזיר תשובה ריקה');
  return t;
}

async function pollText(prompt, json) {
  const r = await fetchT('https://text.pollinations.ai/openai', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai', seed: Math.floor(Math.random() * 1e6),
      messages: [{ role: 'system', content: json ? 'You are a creative screenwriter. Reply with valid JSON only, no markdown.' : 'You are a creative screenwriter.' }, { role: 'user', content: prompt }],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!r.ok) throw new Error('Pollinations HTTP ' + r.status);
  const d = await r.json();
  const t = d.choices?.[0]?.message?.content;
  if (!t) throw new Error('Pollinations החזיר תשובה ריקה');
  return t;
}

function textProviders() {
  const p = S.textProvider;
  if (p === 'offline') return [];
  if (p === 'gemini') return S.geminiKey ? ['gemini'] : [];
  if (p === 'pollinations') return ['pollinations'];
  return S.geminiKey ? ['gemini', 'pollinations'] : ['pollinations'];
}

function parseJSON(t) {
  t = String(t).replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('התשובה לא הייתה JSON');
  return JSON.parse(t.slice(a, b + 1));
}

// מחזיר אובייקט JSON מה-AI, או null אם אין AI זמין (ואז משתמשים במחולל המובנה)
async function aiJSON(prompt, label) {
  const errs = [];
  for (const p of textProviders()) {
    busy.set(`${label} (${p === 'gemini' ? 'ג׳מיני' : 'Pollinations – חינמי'})…`);
    try { return parseJSON(p === 'gemini' ? await geminiText(prompt, true) : await pollText(prompt, true)); }
    catch (e) { errs.push(`${p}: ${e.message}`); }
  }
  if (errs.length) toast('ה-AI לא הצליח, משתמש במחולל המובנה. ' + errs.join(' | '), 'warn');
  return null;
}

// =====================================================================
// AI – תמונות (ננו בננה / Pollinations / ציור מובנה)
// =====================================================================
const DIMS = { '1:1': [768, 768], '3:4': [768, 1024], '16:9': [1024, 576] };

async function geminiImage(prompt, aspect, refs = []) {
  const parts = [];
  refs.forEach((r, i) => {
    const m = /^data:(.*?);base64,(.*)$/.exec(r.src || '');
    if (!m) return;
    parts.push({ text: `Reference image ${i + 1}: ${r.name}` });
    parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  });
  parts.push({ text: prompt });
  const call = async withAspect => {
    const r = await fetchT(`${GEM}${encodeURIComponent(S.imageModel)}:generateContent?key=${encodeURIComponent(S.geminiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(withAspect ? { imageConfig: { aspectRatio: aspect } } : {}) },
      }),
    }, 180000);
    const d = await r.json().catch(() => ({}));
    return { r, d };
  };
  let { r, d } = await call(true);
  if (!r.ok && r.status === 400 && /aspect|imageConfig|Unknown name/i.test(d.error?.message || '')) ({ r, d } = await call(false));
  if (!r.ok) throw new Error(d.error?.message || 'HTTP ' + r.status);
  const part = (d.candidates?.[0]?.content?.parts || []).find(p => p.inlineData || p.inline_data);
  if (!part) throw new Error('ננו בננה לא החזיר תמונה (אולי נחסם ע״י סינון תוכן)');
  const inl = part.inlineData || part.inline_data;
  return `data:${inl.mimeType || inl.mime_type};base64,${inl.data}`;
}

async function pollImage(prompt, aspect) {
  const [w, hh] = DIMS[aspect] || DIMS['1:1'];
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=${w}&height=${hh}&seed=${Math.floor(Math.random() * 1e6)}&nologo=true&model=flux`;
  const r = await fetchT(url, {}, 150000);
  if (!r.ok) throw new Error('Pollinations HTTP ' + r.status);
  const blob = await r.blob();
  if (!/^image\//.test(blob.type)) throw new Error('Pollinations לא החזיר תמונה');
  return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
}

function imageProviders() {
  const p = S.imageProvider;
  if (p === 'offline') return [];
  if (p === 'gemini') return S.geminiKey ? ['gemini'] : [];
  if (p === 'pollinations') return ['pollinations'];
  return S.geminiKey ? ['gemini', 'pollinations'] : ['pollinations'];
}

// ציור חלופי מובנה – כדי שהאולפן יעבוד גם בלי אינטרנט / בלי AI
function placeholderSVG(label, aspect, kind) {
  const [w, hh] = DIMS[aspect] || DIMS['1:1'], hue = hashStr(label) % 360;
  const esc = s => String(s).replace(/[<&>"]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));
  let body = '';
  if (kind === 'char') {
    body = `<circle cx="${w / 2}" cy="${hh * 0.36}" r="${w * 0.17}" fill="hsl(${(hue + 30) % 360},45%,70%)"/>
      <path d="M${w * 0.2} ${hh} Q${w / 2} ${hh * 0.45} ${w * 0.8} ${hh} Z" fill="hsl(${hue},55%,45%)"/>
      <circle cx="${w * 0.45}" cy="${hh * 0.34}" r="${w * 0.018}" fill="#222"/><circle cx="${w * 0.55}" cy="${hh * 0.34}" r="${w * 0.018}" fill="#222"/>
      <path d="M${w * 0.45} ${hh * 0.41} Q${w / 2} ${hh * 0.45} ${w * 0.55} ${hh * 0.41}" stroke="#222" stroke-width="5" fill="none"/>`;
  } else {
    body = `<circle cx="${w * 0.78}" cy="${hh * 0.25}" r="${hh * 0.1}" fill="hsl(${(hue + 50) % 360},90%,75%)" opacity=".8"/>
      <path d="M0 ${hh * 0.72} Q${w * 0.25} ${hh * 0.55} ${w * 0.5} ${hh * 0.7} T${w} ${hh * 0.65} V${hh} H0Z" fill="hsl(${(hue + 120) % 360},35%,25%)"/>
      <path d="M0 ${hh * 0.85} Q${w * 0.3} ${hh * 0.75} ${w * 0.6} ${hh * 0.86} T${w} ${hh * 0.82} V${hh} H0Z" fill="hsl(${(hue + 140) % 360},35%,15%)"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,38%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},70%,10%)"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>${body}
    <text x="50%" y="${hh - 30}" text-anchor="middle" font-family="Arial" font-size="${Math.round(w / 18)}" font-weight="bold" fill="#fff" opacity=".9">${esc(label).slice(0, 40)}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// מקטין ודוחס כל תמונה ל-JPEG כדי לחסוך מקום
function compress(src, max = 1024, q = 0.86) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const sc = Math.min(1, max / Math.max(im.width, im.height));
      const c = h('canvas', { width: Math.round(im.width * sc), height: Math.round(im.height * sc) });
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#1a1a24'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(im, 0, 0, c.width, c.height);
      try { res(c.toDataURL('image/jpeg', q)); } catch { res(src); }
    };
    im.onerror = () => res(src);
    im.src = src;
  });
}

async function aiImage(prompt, { aspect = '1:1', refs = [], label = 'תמונה', kind = 'scene', fallbackLabel = '' } = {}) {
  const errs = [];
  for (const p of imageProviders()) {
    busy.set(`מצייר ${label} (${p === 'gemini' ? 'ג׳מיני ננו בננה 🍌' : 'Pollinations – חינמי'})…`);
    try { return await compress(p === 'gemini' ? await geminiImage(prompt, aspect, refs) : await pollImage(prompt, aspect)); }
    catch (e) { errs.push(`${p}: ${e.message}`); }
  }
  if (errs.length) toast('יצירת התמונה נכשלה, נוצר ציור זמני. ' + errs.join(' | '), 'warn');
  return compress(placeholderSVG(fallbackLabel || label, aspect, kind));
}

// =====================================================================
// סגנונות וז'אנרים
// =====================================================================
const STYLES = {
  pixar: ['תלת־ממד בסגנון אנימציה', '3D animated movie style, Pixar-like, soft cinematic lighting, expressive, highly detailed'],
  anime: ['אנימה', 'anime style, vibrant colors, clean line art, Studio-quality key visual'],
  real: ['ריאליסטי קולנועי', 'photorealistic cinematic film still, dramatic lighting, 35mm, shallow depth of field'],
  comic: ['קומיקס', 'comic book illustration, bold ink lines, halftone shading, vivid colors'],
  water: ['צבעי מים', 'soft watercolor storybook illustration, gentle colors, paper texture'],
  pixel: ['פיקסל ארט', 'detailed pixel art, 16-bit retro game style'],
};
const GENRES = ['הרפתקה', 'פנטזיה', 'מדע בדיוני', 'קומדיה', 'מתח', 'אימה (קלה)', 'דרמה', 'פעולה', 'ילדים'];

const WORLDS = {
  'פנטזיה': { he: 'ממלכת אלדור הקסומה', en: 'a magical fantasy kingdom with castles and enchanted forests', obj: 'הקריסטל העתיק', places: ['כפר קטן לרגלי ההרים', 'יער קסום', 'מערת הדרקון', 'טירה עתיקה', 'גשר אבן מעל תהום', 'אולם הכתר'] },
  'מדע בדיוני': { he: 'תחנת החלל אוריון', en: 'a futuristic space station orbiting a distant planet', obj: 'שבב הניווט האבוד', places: ['גשר הפיקוד', 'מעבדה סודית', 'כוכב לכת סגול', 'ספינת חלל נטושה', 'עיר עתידנית', 'ליבת הכור'] },
  'אימה (קלה)': { he: 'העיירה השקטה ערפילים', en: 'a foggy small town with an old abandoned mansion', obj: 'היומן הנעול', places: ['רחוב ריק בערב', 'אחוזה נטושה', 'עליית גג חשוכה', 'בית קברות ישן', 'מרתף מתחת לאחוזה', 'שחר מעל העיירה'] },
  'קומדיה': { he: 'העיר הכי מבולגנת בעולם', en: 'a colorful chaotic cartoon city', obj: 'העוגה המפורסמת', places: ['מטבח של מסעדה', 'שוק עמוס', 'תחנת אוטובוס', 'פסטיבל העיר', 'גג של בניין', 'במה מרכזית'] },
  default: { he: 'העיר הגדולה', en: 'a vibrant modern city with hidden secrets', obj: 'המפה הסודית', places: ['שכונה שקטה', 'ספרייה ישנה', 'נמל בלילה', 'מגדל גבוה', 'מנהרה תת־קרקעית', 'גג מעל העיר'] },
};

// =====================================================================
// מחולל עלילה מובנה (כשאין AI זמין)
// =====================================================================
const ARCH = [
  { role: 'גיבור/ה', names: ['נועה', 'איתי', 'מאיה', 'יונתן', 'תמר', 'אורי'], visual: 'a brave young hero with messy brown hair, bright determined eyes, red jacket, jeans and sneakers', pers: 'אמיץ, סקרן ולפעמים פזיז' },
  { role: 'חבר/ה הכי טוב', names: ['גיל', 'ליה', 'עומר', 'רוני', 'הילה'], visual: 'a cheerful friend with curly black hair, round glasses, yellow hoodie and backpack', pers: 'מצחיק, נאמן וחכם' },
  { role: 'מנטור/ית', names: ['סבתא רחל', 'הקוסם זוהר', 'הקפטנית דנה', 'המורה אליעזר'], visual: 'a wise elderly mentor with long silver hair and beard, kind eyes, flowing deep-blue robe', pers: 'רגוע, יודע סודות עתיקים' },
  { role: 'נבל/ה', names: ['לורד צל', 'ד״ר קרח', 'המכשפה מורגנה', 'הגנרל ברזל'], visual: 'a menacing tall villain in a dark armored cloak with glowing purple eyes and a sinister smile', pers: 'ערמומי, שאפתן ואכזר' },
];

function offlineCharacters(seed) {
  return ARCH.map((a, i) => ({ id: uid(), name: pick(a.names, seed + i * 7), role: a.role, personality: a.pers, visual: a.visual, img: '' }));
}

function offlineEpisode(p, epNo, scenesN) {
  const W = WORLDS[p.genre] || WORLDS.default, seed = hashStr(p.title + p.idea + epNo);
  const cs = p.characters;
  const [hero, friend, mentor, villain] = [0, 1, 2, 3].map(i => cs[i] || cs[0]);
  const idea = (p.idea || '').trim() || `${W.obj} נעלם`;
  const pl = k => W.places[(k + epNo) % W.places.length];
  const beats = [
    { t: 'ההתחלה', loc: pl(0), n: `ב${W.he} ${hero.name} חי/ה חיים רגילים, עד שיום אחד קורה דבר מוזר: ${idea}.`, d: [[hero, 'משהו כאן לא בסדר... אני מרגיש/ה את זה.'], [friend, 'גם אני! בוא/י נבדוק מה קורה.']], who: [hero, friend], img: `establishing wide shot of ${W.en}, a young hero and a friend looking surprised` },
    { t: 'הקריאה להרפתקה', loc: pl(1), n: `${mentor.name} מגלה ל${hero.name} שרק מי שאמיץ באמת יוכל לעצור את ${villain.name}.`, d: [[mentor, 'הגורל בחר בך. הדרך לא תהיה קלה.'], [hero, 'אני לא בטוח/ה שאני מוכן/ה... אבל אנסה.']], who: [mentor, hero], img: `a wise mentor speaking to a young hero in ${W.en}, warm candle light` },
    { t: 'הנבל מופיע', loc: pl(2), n: `${villain.name} חושף/ת את התוכנית: להשתלט על ${W.he} בעזרת ${W.obj}.`, d: [[villain, 'אף אחד לא יעצור אותי! הכול יהיה שלי.'], [friend, 'הוא/היא חזק/ה מדי בשבילנו...']], who: [villain, friend], img: `a menacing villain revealing an evil plan, dramatic dark lighting, ${W.en}` },
    { t: 'המסע', loc: pl(3), n: `${hero.name} ו${friend.name} יוצאים למסע מסוכן דרך ${pl(3)}, ולומדים לסמוך אחד על השני.`, d: [[friend, 'לא משנה מה יקרה – אני איתך.'], [hero, 'ביחד אנחנו יכולים הכול.']], who: [hero, friend], img: `two friends on a dangerous journey through ${pl(3)} in ${W.en}, epic landscape` },
    { t: 'התפנית', loc: pl(4), n: `הפתעה! מתברר ש${W.obj} נמצא ממש מתחת לאף של כולם – אבל ${villain.name} הגיע/ה ראשון/ה.`, d: [[hero, 'לא! איחרנו!'], [mentor, 'עוד לא. תזכור/י מה לימדתי אותך.']], who: [hero, mentor, villain], img: `dramatic plot twist moment, glowing magical object, villain grabbing it, heroes shocked` },
    { t: 'העימות הגדול', loc: pl(5), n: `העימות הגדול מתחיל. ${hero.name} עומד/ת מול ${villain.name}, ומשתמש/ת בכוח האמיתי – האומץ והחברות.`, d: [[villain, 'אתה/את רק ילד/ה!'], [hero, 'אולי. אבל אני לא לבד!']], who: [hero, villain, friend], img: `epic final battle between hero and villain, energy beams, cinematic action shot` },
    { t: 'הסוף הטוב', loc: pl(0), n: `${W.he} ניצלה. ${hero.name} ו${friend.name} חוזרים הביתה כגיבורים – אבל משהו מרמז שזו רק ההתחלה...`, d: [[friend, 'עשינו את זה!'], [hero, 'כן... אבל ראית את האור הזה בשמיים?']], who: [hero, friend, mentor], img: `happy ending celebration at sunset in ${W.en}, heroes smiling, hint of mystery in the sky` },
  ];
  const n = Math.max(1, Math.min(beats.length, scenesN));
  const chosen = Array.from({ length: n }, (_, i) => beats[Math.round(i * (beats.length - 1) / Math.max(1, n - 1))]);
  const epTitles = ['ההתחלה', 'הסוד נחשף', 'בעקבות הצל', 'הבגידה', 'הקרב על הבית', 'עידן חדש'];
  return {
    id: uid(),
    title: p.type === 'series' ? pick(epTitles, epNo) : (p.title || 'הסרט'),
    scenes: chosen.map((b, i) => ({
      id: uid(), title: b.t, location: b.loc, narration: b.n,
      dialogue: b.d.map(([c, line]) => ({ charId: c.id, line })),
      charIds: [...new Set(b.who.map(c => c.id))], imagePrompt: b.img, img: '',
    })),
    _seed: seed,
  };
}

// =====================================================================
// בקשות AI לעלילה
// =====================================================================
const castText = p => p.characters.map(c => `- ${c.name} (${c.role || ''}): ${c.personality || ''}. Visual: ${c.visual || ''}`).join('\n');

const SCENE_SCHEMA = `{"title":"שם הסצנה","location":"מיקום","narration":"1-2 משפטי קריינות","dialogue":[{"character":"שם דמות","line":"שורת דיאלוג"}],"characters":["שמות הדמויות בסצנה"],"imagePrompt":"detailed ENGLISH visual description of the shot: setting, action, mood, camera angle"}`;

function storyPrompt(p) {
  const kind = p.type === 'series' ? `סדרה עם ${p.episodesN} פרקים` : 'סרט';
  return `אתה תסריטאי מוכשר. כתוב ${kind} מקורי ומרתק בעברית.
רעיון: ${p.idea || 'הפתע אותי'}
ז׳אנר: ${p.genre}
טון/הערות: ${p.tone || 'מותאם לכל המשפחה'}
${p.characters.length ? 'דמויות קיימות שחובה לכלול (שמור על השמות):\n' + castText(p) : 'צור 3-5 דמויות מעניינות, כולל נבל.'}
בכל פרק בדיוק ${p.scenesN} סצנות, עם התחלה, אמצע, שיא וסוף. ${p.type === 'series' ? 'כל פרק נגמר במתח שמוביל לפרק הבא.' : ''}
2-4 שורות דיאלוג בכל סצנה.
החזר JSON בלבד במבנה:
{"title":"שם","logline":"משפט אחד","synopsis":"תקציר 3-5 משפטים",
"characters":[{"name":"שם","role":"תפקיד בסיפור","personality":"אופי","visual":"detailed ENGLISH appearance: age, body, face, hair, clothes, colors","villain":false}],
"episodes":[{"title":"שם הפרק","scenes":[${SCENE_SCHEMA}]}]}
כל הטקסטים בעברית, חוץ מ-visual ו-imagePrompt שחייבים להיות באנגלית.`;
}

function nextEpisodePrompt(p) {
  const prev = p.episodes.map((e, i) => `פרק ${i + 1} – ${e.title}: ${e.scenes.map(s => s.narration).join(' ')}`).join('\n');
  return `אתה תסריטאי. המשך את הסדרה "${p.title}" (${p.genre}).
תקציר: ${p.synopsis}
דמויות:\n${castText(p)}
הפרקים עד עכשיו:\n${prev}
כתוב את פרק ${p.episodes.length + 1} עם ${p.scenesN} סצנות, שממשיך את העלילה ומוסיף תפנית. אפשר להוסיף דמות חדשה אחת.
החזר JSON בלבד: {"title":"שם הפרק","newCharacters":[{"name":"","role":"","personality":"","visual":"ENGLISH"}],"scenes":[${SCENE_SCHEMA}]}
טקסטים בעברית, visual ו-imagePrompt באנגלית.`;
}

function findChar(p, name) {
  if (!name) return null;
  const n = String(name).trim();
  return p.characters.find(c => c.name === n) || p.characters.find(c => n.includes(c.name) || c.name.includes(n)) || null;
}

function mergeCharacters(p, list) {
  for (const c of list || []) {
    if (!c || !c.name) continue;
    const ex = findChar(p, c.name);
    if (ex) { ex.role = ex.role || c.role || ''; ex.personality = ex.personality || c.personality || ''; ex.visual = ex.visual || c.visual || ''; if (c.villain) ex.villain = true; }
    else p.characters.push({ id: uid(), name: c.name, role: c.role || '', personality: c.personality || '', visual: c.visual || '', villain: !!c.villain || /נבל|villain/i.test(c.role || ''), img: '' });
  }
}

function toScenes(p, scenes) {
  return (scenes || []).map(s => ({
    id: uid(), title: s.title || '', location: s.location || '', narration: s.narration || '',
    dialogue: (s.dialogue || []).map(d => { const c = findChar(p, d.character); return { charId: c ? c.id : '', name: c ? '' : (d.character || ''), line: d.line || '' }; }),
    charIds: [...new Set((s.characters || []).map(n => findChar(p, n)).filter(Boolean).map(c => c.id))],
    imagePrompt: s.imagePrompt || '', img: '',
  }));
}

async function generateStory(p) {
  if (p.episodes.some(e => e.scenes.length) && !confirm('יצירת עלילה חדשה תחליף את הסצנות הקיימות (הדמויות והתמונות שלהן יישארו). להמשיך?')) return;
  await withBusy('כותב עלילה…', async () => {
    const d = await aiJSON(storyPrompt(p), 'כותב עלילה');
    if (d && Array.isArray(d.episodes) && d.episodes.length) {
      p.title = d.title || p.title; p.logline = d.logline || ''; p.synopsis = d.synopsis || '';
      mergeCharacters(p, d.characters);
      p.episodes = d.episodes.map(e => ({ id: uid(), title: e.title || '', scenes: toScenes(p, e.scenes) }));
      toast('העלילה מוכנה! ✨', 'ok');
    } else {
      if (!p.characters.length) p.characters = offlineCharacters(hashStr(p.title + p.idea));
      const n = p.type === 'series' ? p.episodesN : 1;
      p.episodes = Array.from({ length: n }, (_, i) => offlineEpisode(p, i, p.scenesN));
      const W = WORLDS[p.genre] || WORLDS.default;
      p.logline = p.logline || `${p.characters[0].name} חייב/ת לעצור את ${p.characters[3]?.name || 'הנבל'} לפני ש${W.he} תיפול.`;
      p.synopsis = p.synopsis || `סיפור ${p.genre} על אומץ וחברות ב${W.he}. ${p.idea || ''}`;
      toast('נוצרה עלילה עם המחולל המובנה (בלי AI). אפשר לערוך הכול ידנית.', 'ok');
    }
    save(p);
  });
  render();
}

async function generateNextEpisode(p) {
  await withBusy('כותב פרק חדש…', async () => {
    const d = await aiJSON(nextEpisodePrompt(p), 'כותב פרק חדש');
    if (d && Array.isArray(d.scenes)) {
      mergeCharacters(p, d.newCharacters);
      p.episodes.push({ id: uid(), title: d.title || `פרק ${p.episodes.length + 1}`, scenes: toScenes(p, d.scenes) });
    } else {
      if (!p.characters.length) p.characters = offlineCharacters(hashStr(p.title));
      p.episodes.push(offlineEpisode(p, p.episodes.length, p.scenesN));
    }
    ui.ep = p.episodes.length - 1;
    save(p);
    toast('פרק חדש נוסף! 🎬', 'ok');
  });
  render();
}

// =====================================================================
// תמונות לדמויות וסצנות
// =====================================================================
const styleEn = p => (STYLES[p.style] || STYLES.pixar)[1];

function charPrompt(p, c) {
  return `${styleEn(p)}. Character design portrait of ${c.name}, ${c.role || 'a character'}: ${c.visual || c.personality || 'unique memorable look'}. Upper body, facing camera, expressive face, simple clean background, no text.`;
}

async function genCharImage(p, c) {
  c.img = await aiImage(charPrompt(p, c), { aspect: '1:1', label: `את ${c.name}`, kind: 'char', fallbackLabel: c.name });
  save(p);
}

async function editCharImage(p, c, instruction) {
  if (!S.geminiKey || S.imageProvider === 'pollinations' || S.imageProvider === 'offline') {
    toast('עריכת תמונה קיימת עובדת רק עם ג׳מיני ננו בננה. יוצר במקום זה תמונה חדשה לפי ההוראה…', 'warn');
    c.img = await aiImage(charPrompt(p, c) + ' ' + instruction, { label: `את ${c.name}`, kind: 'char', fallbackLabel: c.name });
  } else {
    busy.set(`ננו בננה עורך את ${c.name} 🍌…`);
    c.img = await compress(await geminiImage(`Edit this character image: ${instruction}. Keep the same character identity, face and art style.`, '1:1', [{ name: c.name, src: c.img }]));
  }
  save(p);
}

function scenePrompt(p, s, withRefs) {
  const cs = s.charIds.map(id => p.characters.find(c => c.id === id)).filter(Boolean);
  const who = cs.map(c => `${c.name} (${c.visual || c.role})`).join('; ');
  return `${styleEn(p)}. Cinematic wide 16:9 movie frame. Scene: ${s.imagePrompt || s.narration}. Location: ${s.location || ''}. ${who ? 'Characters in the shot: ' + who + '.' : ''} ${withRefs ? 'Keep each character looking exactly like their reference image.' : ''} No text, no subtitles, no watermark.`;
}

async function genSceneImage(p, s) {
  const refs = s.charIds.map(id => p.characters.find(c => c.id === id)).filter(c => c && /^data:image\/(png|jpeg|webp)/.test(c.img)).map(c => ({ name: c.name, src: c.img })).slice(0, 3);
  const gem = imageProviders()[0] === 'gemini';
  s.img = await aiImage(scenePrompt(p, s, gem && refs.length), { aspect: '16:9', refs: gem ? refs : [], label: `את הסצנה "${s.title}"`, kind: 'scene', fallbackLabel: s.title });
  save(p);
}

async function batch(items, fn, label) {
  let i = 0;
  busy.show(label);
  try {
    for (const it of items) { i++; busy.set(`${label} ${i}/${items.length}`); await fn(it); render(); await sleep(300); }
    toast('הסתיים! ✅', 'ok');
  } catch (e) { toast('שגיאה: ' + e.message, 'err'); }
  finally { busy.hide(); render(); }
}

// =====================================================================
// משחקים
// =====================================================================
function allScenes(p) { return p.episodes.flatMap(e => e.scenes); }

async function generateGame(p, kind) {
  const scenes = allScenes(p);
  if (!scenes.length && kind !== 'arcade') return toast('קודם צרו עלילה וסצנות 🙂', 'warn');
  if (!p.characters.length) return toast('קודם צרו דמויות 🙂', 'warn');
  p.game = p.game || {};
  p.game.kind = kind;
  if (kind === 'arcade') { save(p); render(); return toast('משחק הארקייד מוכן! לחצו "שחק"', 'ok'); }
  const list = scenes.map((s, i) => `${i}. ${s.title}: ${s.narration}`).join('\n');
  await withBusy('בונה את המשחק…', async () => {
    if (kind === 'adventure') {
      const d = await aiJSON(`הפוך את הסיפור "${p.title}" למשחק הרפתקה אינטראקטיבי בעברית ("בחר את הדרך שלך").
דמויות:\n${castText(p)}
הסצנות (מספר: שם: תוכן):\n${list}
צור 10-14 צמתים. השחקן משחק בתור ${p.characters[0].name}. בכל צומת 2-3 בחירות. לפחות סוף טוב אחד (end:"win") ושני סופים רעים (end:"lose").
לכל צומת שייך מספר סצנה מהרשימה (scene) לתמונה.
JSON בלבד: {"start":"n1","nodes":{"n1":{"text":"2-4 משפטים בגוף שני","scene":0,"choices":[{"text":"בחירה","to":"n2"}]},"w1":{"text":"...","scene":5,"end":"win"}}}`, 'בונה הרפתקה');
      p.game.adventure = validAdventure(d, scenes.length) || offlineAdventure(p);
    } else {
      const d = await aiJSON(`צור טריוויה בעברית של 8 שאלות על הסיפור "${p.title}".
דמויות:\n${castText(p)}\nסצנות:\n${list}
לכל שאלה 4 תשובות, answer הוא האינדקס (0-3) של התשובה הנכונה, scene הוא מספר הסצנה הקשורה.
JSON בלבד: {"questions":[{"q":"שאלה","options":["א","ב","ג","ד"],"answer":0,"scene":0}]}`, 'כותב טריוויה');
      const qs = (d && Array.isArray(d.questions) ? d.questions : []).filter(q => q && q.q && Array.isArray(q.options) && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length);
      p.game.quiz = qs.length >= 3 ? qs : offlineQuiz(p);
    }
    save(p);
    toast('המשחק מוכן! 🎮', 'ok');
  });
  render();
}

function validAdventure(d, nScenes) {
  if (!d || !d.nodes || typeof d.nodes !== 'object') return null;
  const ids = Object.keys(d.nodes);
  if (ids.length < 3) return null;
  const start = d.nodes[d.start] ? d.start : ids[0];
  for (const id of ids) {
    const n = d.nodes[id];
    n.text = String(n.text || '');
    if (n.scene != null) n.scene = Math.max(0, Math.min(nScenes - 1, +n.scene || 0));
    if (n.end && n.end !== 'win') n.end = 'lose';
    if (!n.end) {
      n.choices = (n.choices || []).filter(c => c && c.text).map(c => ({ text: String(c.text), to: d.nodes[c.to] ? c.to : start }));
      if (!n.choices.length) n.end = 'lose';
    }
  }
  if (!ids.some(id => d.nodes[id].end === 'win')) { const last = ids[ids.length - 1]; d.nodes[last].end = 'win'; delete d.nodes[last].choices; }
  return { start, nodes: d.nodes };
}

function offlineAdventure(p) {
  const sc = allScenes(p), hero = p.characters[0], nodes = {};
  const wrong = ['לברוח ולהסתתר', 'ללכת לבד בלי לספר לאף אחד', 'להתעלם מהסימנים', 'לסמוך על הזר המסתורי'];
  sc.forEach((s, i) => {
    const next = i + 1 < sc.length ? 'n' + (i + 1) : 'win';
    nodes['n' + i] = {
      text: `${s.narration} מה ${hero.name} יעשה/תעשה עכשיו?`, scene: i,
      choices: [{ text: i + 1 < sc.length ? `להמשיך אל: ${sc[i + 1].title}` : 'להתמודד עם האתגר האחרון!', to: next }, { text: pick(wrong, i), to: 'lose' + i }].sort(() => (hashStr(s.id) % 2 ? 1 : -1)),
    };
    nodes['lose' + i] = { text: `הבחירה הזו הייתה טעות... ${p.characters[3]?.name || 'הנבל'} ניצל/ה את ההזדמנות.`, scene: i, end: 'lose' };
  });
  nodes.win = { text: `כל הכבוד! ${hero.name} הציל/ה את המצב. ${p.logline || ''}`, scene: Math.max(0, sc.length - 1), end: 'win' };
  return { start: 'n0', nodes };
}

function offlineQuiz(p) {
  const cs = p.characters, sc = allScenes(p), qs = [];
  const opts = (right, pool) => { const o = [right, ...pool.filter(x => x !== right).slice(0, 3)]; while (o.length < 4) o.push(['אף אחד', 'לא ידוע', 'כולם'][o.length - 1] || '—'); const s = o.sort(() => Math.random() - 0.5); return { options: s, answer: s.indexOf(right) }; };
  cs.slice(0, 4).forEach(c => qs.push({ q: `מי ${c.role ? 'הוא/היא ה' + c.role.replace(/^ה/, '') : 'מופיע/ה בסיפור'}?`, ...opts(c.name, cs.map(x => x.name)) }));
  sc.slice(0, 4).forEach((s, i) => qs.push({ q: `איפה מתרחשת הסצנה "${s.title}"?`, scene: sc.indexOf(s), ...opts(s.location || '—', [...new Set(sc.map(x => x.location || '—'))].concat(['על הירח', 'בבית ספר'])) }));
  return qs;
}

// הופך את הפרויקט לנתוני משחק עצמאיים (בלי מפתחות API!)
function buildGameData(p) {
  const images = [], idx = new Map();
  const add = src => { if (!src) return null; if (!idx.has(src)) { idx.set(src, images.length); images.push(src); } return idx.get(src); };
  const sc = allScenes(p), g = p.game || {};
  const sceneImg = i => (sc[i] && sc[i].img) || '';
  const data = {
    id: p.id, kind: g.kind, title: p.title || 'המשחק שלי', subtitle: p.logline || '', images,
    credit: 'נוצר באולפן ה-AI',
    characters: p.characters.map(c => ({ name: c.name, img: add(c.img), villain: !!c.villain || /נבל|villain/i.test(c.role || '') })),
  };
  data.cover = add((sc.find(s => s.img) || {}).img || (p.characters[0] || {}).img);
  data.bg = add((sc[sc.length - 1] || {}).img || '');
  if (g.kind === 'adventure' && g.adventure) {
    const nodes = {};
    for (const [id, n] of Object.entries(g.adventure.nodes)) nodes[id] = { text: n.text, end: n.end, choices: n.choices, img: add(sceneImg(n.scene)) };
    data.adventure = { start: g.adventure.start, nodes };
  }
  if (g.kind === 'quiz') data.quiz = (g.quiz || []).map(q => ({ q: q.q, options: q.options, answer: q.answer, img: q.scene != null ? add(sceneImg(q.scene)) : null }));
  return data;
}

function exportGameHTML(p) {
  const data = buildGameData(p);
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${(data.title || '').replace(/[<&]/g, '')}</title>
<style>html,body{margin:0;background:#07060d;min-height:100%}#g{max-width:960px;margin:0 auto;padding:12px}</style></head>
<body><div id="g"></div>
<script>${GameRuntime.toString()}
GameRuntime(document.getElementById('g'), ${json}, {});<\/script></body></html>`;
  download(fileName(p.title) + ' - משחק.html', html);
  toast('הקובץ ירד! שלחו אותו לחברים – כל פתיחה שלו נספרת בסטטיסטיקה 📈', 'ok');
}

// =====================================================================
// מונה כניסות
// =====================================================================
async function readCount(p, key) {
  const k = encodeURIComponent(p.id + '-' + key);
  const one = async (url, field) => { try { const r = await fetchT(url, {}, 10000); if (!r.ok) return { v: 0, ok: r.status === 404 }; const d = await r.json(); return { v: +d[field] || 0, ok: true }; } catch { return { v: 0, ok: false }; } };
  const [a, b] = await Promise.all([one(`https://abacus.jasoncameron.dev/get/${NS}/${k}`, 'value'), one(`https://api.counterapi.dev/v1/${NS}/${k}`, 'count')]);
  return { value: a.v + b.v, ok: a.ok || b.ok };
}

// =====================================================================
// מצב ותצוגה
// =====================================================================
let projects = [];
const ui = { view: 'home', pid: null, tab: 'story', ep: 0, game: null };
const cur = () => projects.find(x => x.id === ui.pid);

const saveTimers = {};
function save(p) {
  p = p || cur(); if (!p) return;
  p.updated = Date.now();
  clearTimeout(saveTimers[p.id]);
  saveTimers[p.id] = setTimeout(() => DB.put(p).catch(e => toast('שמירה נכשלה: ' + e.message, 'err')), 400);
}

function newProject(o) {
  return {
    id: uid(), created: Date.now(), updated: Date.now(),
    title: o.title || 'פרויקט חדש', type: o.type || 'movie', genre: o.genre || 'הרפתקה', style: o.style || 'pixar',
    idea: o.idea || '', tone: '', logline: '', synopsis: '', episodesN: 3, scenesN: 5,
    characters: [], episodes: [{ id: uid(), title: '', scenes: [] }], game: null,
  };
}

// ---------- רכיבי טופס ----------
function inp(obj, key, o = {}) {
  const tag = o.rows ? 'textarea' : 'input';
  const el = h(tag, { class: 'inp ' + (o.cls || ''), placeholder: o.ph || '', rows: o.rows, type: tag === 'input' ? (o.type || 'text') : null, min: o.min, max: o.max, dir: o.dir });
  el.value = obj[key] ?? '';
  el.addEventListener('input', () => { obj[key] = o.type === 'number' ? Math.max(o.min ?? -1e9, Math.min(o.max ?? 1e9, +el.value || 0)) : el.value; save(); o.onInput && o.onInput(el.value); });
  return el;
}
function sel(obj, key, options, onChange) {
  const el = h('select', { class: 'inp' }, options.map(([v, l]) => h('option', { value: v }, l)));
  el.value = obj[key];
  el.addEventListener('change', () => { obj[key] = el.value; save(); onChange && onChange(el.value); });
  return el;
}
const label = (t, ...c) => h('label', { class: 'fld' }, h('span', {}, t), ...c);
const btn = (t, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, t);
const imgOr = (src, cls, ph) => src ? h('img', { src, class: cls, alt: '' }) : h('div', { class: cls + ' empty' }, ph);

function uploadImage(cb) {
  const f = h('input', { type: 'file', accept: 'image/*' });
  f.onchange = () => { const file = f.files[0]; if (!file) return; const fr = new FileReader(); fr.onload = async () => cb(await compress(fr.result)); fr.readAsDataURL(file); };
  f.click();
}

function providerBadge() {
  const t = textProviders()[0], i = imageProviders()[0];
  const n = x => x === 'gemini' ? 'ג׳מיני' : x === 'pollinations' ? 'Pollinations (חינמי)' : 'מובנה (בלי AI)';
  return h('div', { class: 'badge-line' }, `✍️ עלילה: ${n(t)}  ·  🎨 תמונות: ${n(i)}${i === 'gemini' ? ' 🍌' : ''}  `, h('a', { href: '#', onclick: e => { e.preventDefault(); go('settings'); } }, 'שינוי בהגדרות'));
}

function go(view, pid) {
  if (ui.game) { ui.game.destroy(); ui.game = null; }
  Cinema.stop();
  ui.view = view;
  if (pid !== undefined) { ui.pid = pid; ui.tab = 'story'; ui.ep = 0; }
  render();
  window.scrollTo(0, 0);
}

function render() {
  const main = $('#main');
  const y = window.scrollY;
  main.innerHTML = '';
  $('#nav-home').classList.toggle('on', ui.view === 'home' || ui.view === 'project');
  $('#nav-settings').classList.toggle('on', ui.view === 'settings');
  if (ui.view === 'settings') main.append(viewSettings());
  else if (ui.view === 'project' && cur()) main.append(viewProject(cur()));
  else main.append(viewHome());
  window.scrollTo(0, y);
}

// ---------- מסך הבית ----------
function viewHome() {
  const draft = { title: '', type: 'movie', genre: 'הרפתקה', style: 'pixar', idea: '' };
  const form = h('div', { class: 'card new-proj' },
    h('h2', {}, '🎬 פרויקט חדש'),
    h('div', { class: 'grid2' },
      label('שם הסרט / הסדרה', inp(draft, 'title', { ph: 'למשל: שומרי הכוכבים' })),
      label('סוג', sel(draft, 'type', [['movie', '🎞️ סרט'], ['series', '📺 סדרה']])),
      label('ז׳אנר', sel(draft, 'genre', GENRES.map(g => [g, g]))),
      label('סגנון ציור', sel(draft, 'style', Object.entries(STYLES).map(([k, v]) => [k, v[0]]))),
    ),
    label('רעיון בכמה מילים (לא חובה)', inp(draft, 'idea', { rows: 2, ph: 'למשל: חתול שמגלה שהוא יכול לדבר עם כוכבים, ונבל רוצה לגנוב את האור שלהם' })),
    h('div', { class: 'row' }, btn('✨ צור פרויקט', async () => {
      const p = newProject(draft);
      projects.unshift(p); await DB.put(p);
      go('project', p.id);
    }, 'primary')),
  );
  const list = h('div', { class: 'proj-grid' },
    projects.length ? projects.map(p => {
      const cover = (allScenes(p).find(s => s.img) || {}).img || (p.characters.find(c => c.img) || {}).img;
      return h('div', { class: 'proj', onclick: () => go('project', p.id) },
        imgOr(cover, 'proj-cover', p.type === 'series' ? '📺' : '🎞️'),
        h('div', { class: 'proj-body' },
          h('b', {}, p.title || 'ללא שם'),
          h('small', {}, `${p.type === 'series' ? 'סדרה' : 'סרט'} · ${p.genre} · ${p.characters.length} דמויות · ${allScenes(p).length} סצנות`)),
        h('button', { class: 'x', title: 'מחיקה', onclick: async e => { e.stopPropagation(); if (!confirm(`למחוק את "${p.title}"?`)) return; await DB.del(p.id); projects = projects.filter(x => x !== p); render(); } }, '🗑'));
    }) : h('p', { class: 'muted' }, 'עוד אין פרויקטים. צרו את הראשון למעלה! 👆'));
  return h('div', {},
    h('section', { class: 'hero-box' },
      h('h1', {}, 'אולפן ה-AI שלך'),
      h('p', {}, 'יוצרים דמויות עם ג׳מיני ננו בננה 🍌, כותבים עלילה עם AI חינמי, מרכיבים סרט או סדרה – ואז הופכים אותם למשחק שאפשר לשתף ולראות כמה אנשים שיחקו בו.'),
      h('ol', { class: 'steps' }, ['עלילה', 'דמויות', 'סצנות', 'קולנוע', 'משחק', 'סטטיסטיקה'].map((s, i) => h('li', {}, h('b', {}, i + 1), s))),
      !S.geminiKey ? h('p', { class: 'tip' }, '💡 עובד מיד בחינם (Pollinations). לתמונות של ננו בננה – הוסיפו מפתח ג׳מיני חינמי ב', h('a', { href: '#', onclick: e => { e.preventDefault(); go('settings'); } }, 'הגדרות'), '.') : null),
    form,
    h('div', { class: 'row space' }, h('h2', {}, '📁 הפרויקטים שלי'),
      btn('📥 ייבוא פרויקט', () => {
        const f = h('input', { type: 'file', accept: '.json,application/json' });
        f.onchange = async () => { const p = safeParse(await f.files[0].text()); if (!p || !p.episodes) return toast('קובץ לא תקין', 'err'); p.id = uid(); projects.unshift(p); await DB.put(p); render(); toast('הפרויקט יובא', 'ok'); };
        f.click();
      }, 'ghost')),
    list);
}

// ---------- מסך פרויקט ----------
const TABS = [['story', '✍️ עלילה'], ['chars', '🧑‍🎤 דמויות'], ['scenes', '🎞️ סצנות'], ['cinema', '🍿 קולנוע'], ['game', '🎮 משחק'], ['stats', '📈 סטטיסטיקה']];

function viewProject(p) {
  const tabs = h('nav', { class: 'tabs' }, TABS.map(([k, t]) => h('button', { class: 'tab' + (ui.tab === k ? ' on' : ''), onclick: () => { if (ui.game) { ui.game.destroy(); ui.game = null; } Cinema.stop(); ui.tab = k; render(); } }, t)));
  const body = { story: tabStory, chars: tabChars, scenes: tabScenes, cinema: tabCinema, game: tabGame, stats: tabStats }[ui.tab](p);
  return h('div', {},
    h('div', { class: 'row space proj-head' },
      h('div', { class: 'row' }, btn('→ חזרה', () => go('home'), 'ghost sm'), h('h1', { class: 'ptitle' }, p.title || 'ללא שם'), h('span', { class: 'pill' }, p.type === 'series' ? '📺 סדרה' : '🎞️ סרט')),
      btn('💾 גיבוי לקובץ', () => download(fileName(p.title) + '.json', JSON.stringify(p), 'application/json'), 'ghost sm')),
    tabs, body);
}

function tabStory(p) {
  return h('div', { class: 'card' },
    providerBadge(),
    h('div', { class: 'grid2' },
      label('סוג', sel(p, 'type', [['movie', '🎞️ סרט'], ['series', '📺 סדרה']], render)),
      label('ז׳אנר', sel(p, 'genre', GENRES.map(g => [g, g]))),
      label('סגנון ציור (לכל התמונות)', sel(p, 'style', Object.entries(STYLES).map(([k, v]) => [k, v[0]]))),
      label('טון / הערות לתסריטאי', inp(p, 'tone', { ph: 'מצחיק, לכל המשפחה, עם סוף מפתיע…' })),
      p.type === 'series' ? label('מספר פרקים', inp(p, 'episodesN', { type: 'number', min: 1, max: 8 })) : null,
      label('סצנות בכל ' + (p.type === 'series' ? 'פרק' : 'סרט'), inp(p, 'scenesN', { type: 'number', min: 1, max: 10 })),
    ),
    label('הרעיון שלך', inp(p, 'idea', { rows: 3, ph: 'כתבו כמה מילים או פסקה שלמה. אפשר גם להשאיר ריק וה-AI יפתיע.' })),
    h('div', { class: 'row' },
      btn('✨ צור עלילה מלאה עם AI', () => generateStory(p), 'primary'),
      p.type === 'series' && allScenes(p).length ? btn('➕ צור פרק נוסף', () => generateNextEpisode(p)) : null),
    h('hr'),
    h('h3', {}, 'התסריט (אפשר לערוך הכול)'),
    label('שם', inp(p, 'title', { onInput: v => { const t = $('.ptitle'); if (t) t.textContent = v; } })),
    label('משפט אחד שמתאר את הסיפור', inp(p, 'logline')),
    label('תקציר', inp(p, 'synopsis', { rows: 4 })),
    allScenes(p).length ? h('p', { class: 'muted' }, `יש ${p.characters.length} דמויות ו-${allScenes(p).length} סצנות ב-${p.episodes.length} ${p.type === 'series' ? 'פרקים' : 'חלקים'}. המשיכו ללשונית "דמויות" ← "סצנות".`) : null);
}

function tabChars(p) {
  const missing = p.characters.filter(c => !c.img);
  return h('div', {},
    h('div', { class: 'card row' },
      btn('➕ דמות חדשה', () => { p.characters.push({ id: uid(), name: 'דמות חדשה', role: '', personality: '', visual: '', img: '' }); save(p); render(); }),
      btn(`🎨 צור תמונות לכל הדמויות${missing.length ? ` (${missing.length} חסרות)` : ''}`, () => batch(missing.length ? missing : p.characters, c => genCharImage(p, c), 'מצייר דמויות'), 'primary'),
      providerBadge()),
    p.characters.length ? null : h('p', { class: 'muted card' }, 'עוד אין דמויות. הוסיפו ידנית, או צרו עלילה בלשונית "עלילה" וה-AI ימציא אותן.'),
    h('div', { class: 'char-grid' }, p.characters.map(c => h('div', { class: 'card char' },
      h('div', { class: 'char-img-wrap' }, imgOr(c.img, 'char-img', '🧑‍🎤')),
      h('div', { class: 'row tight' },
        btn(c.img ? '🔄 צור מחדש' : '🎨 צור תמונה', () => withBusy('מצייר…', () => genCharImage(p, c)).then(render), 'sm primary'),
        c.img ? btn('🍌 ערוך', () => { const ins = prompt('מה לשנות בתמונה? (למשל: תן לו כובע קוסמים כחול, תחליף רקע ליער)'); if (ins) withBusy('עורך…', () => editCharImage(p, c, ins)).then(render); }, 'sm') : null,
        btn('📁 העלה', () => uploadImage(src => { c.img = src; save(p); render(); }), 'sm ghost'),
        btn('🗑', () => { if (!confirm('למחוק את ' + c.name + '?')) return; p.characters = p.characters.filter(x => x !== c); save(p); render(); }, 'sm ghost')),
      label('שם', inp(c, 'name')),
      label('תפקיד', inp(c, 'role', { ph: 'גיבור, נבל, חבר…' })),
      h('label', { class: 'chk' }, (() => { const x = h('input', { type: 'checkbox', checked: !!c.villain }); x.onchange = () => { c.villain = x.checked; save(p); }; return x; })(), ' נבל (מופיע כאויב במשחק הארקייד)'),
      label('אופי', inp(c, 'personality', { rows: 2 })),
      label('איך נראה/ית (עדיף באנגלית – עוזר ל-AI)', inp(c, 'visual', { rows: 3, dir: 'auto', ph: 'young girl, red curly hair, green cloak…' })),
    ))));
}

function tabScenes(p) {
  if (ui.ep >= p.episodes.length) ui.ep = 0;
  const ep = p.episodes[ui.ep];
  const series = p.type === 'series';
  const missing = ep.scenes.filter(s => !s.img);
  const charOpts = [['', 'קריין / אחר'], ...p.characters.map(c => [c.id, c.name])];
  return h('div', {},
    series ? h('div', { class: 'card row' },
      p.episodes.map((e, i) => btn(`פרק ${i + 1}${e.title ? ': ' + e.title : ''}`, () => { ui.ep = i; render(); }, 'sm ' + (i === ui.ep ? 'primary' : 'ghost'))),
      btn('➕ פרק ריק', () => { p.episodes.push({ id: uid(), title: '', scenes: [] }); ui.ep = p.episodes.length - 1; save(p); render(); }, 'sm'),
      allScenes(p).length ? btn('✨ פרק חדש עם AI', () => generateNextEpisode(p), 'sm') : null) : null,
    series ? h('div', { class: 'card row' }, label('שם הפרק', inp(ep, 'title')),
      p.episodes.length > 1 ? btn('🗑 מחק פרק', () => { if (!confirm('למחוק את הפרק?')) return; p.episodes.splice(ui.ep, 1); ui.ep = 0; save(p); render(); }, 'sm ghost') : null) : null,
    h('div', { class: 'card row' },
      btn('➕ סצנה חדשה', () => { ep.scenes.push({ id: uid(), title: 'סצנה חדשה', location: '', narration: '', dialogue: [], charIds: [], imagePrompt: '', img: '' }); save(p); render(); }),
      ep.scenes.length ? btn(`🎨 צור תמונות לכל הסצנות${missing.length ? ` (${missing.length} חסרות)` : ''}`, () => batch(missing.length ? missing : ep.scenes, s => genSceneImage(p, s), 'מצייר סצנות'), 'primary') : null,
      p.characters.some(c => !c.img) ? h('span', { class: 'muted' }, '💡 כדאי לצייר קודם את הדמויות – ננו בננה ישתמש בהן כדי שייראו אותו דבר בכל סצנה.') : null),
    ep.scenes.length ? null : h('p', { class: 'card muted' }, 'אין עדיין סצנות. צרו עלילה בלשונית "עלילה" או הוסיפו סצנה ידנית.'),
    ep.scenes.map((s, i) => h('div', { class: 'card scene' },
      h('div', { class: 'scene-media' },
        h('div', { class: 'scene-num' }, i + 1),
        imgOr(s.img, 'scene-img', '🎞️ אין תמונה עדיין'),
        h('div', { class: 'row tight' },
          btn(s.img ? '🔄 צייר מחדש' : '🎨 צייר סצנה', () => withBusy('מצייר…', () => genSceneImage(p, s)).then(render), 'sm primary'),
          btn('📁 העלה', () => uploadImage(src => { s.img = src; save(p); render(); }), 'sm ghost'),
          btn('▲', () => { if (i) { [ep.scenes[i - 1], ep.scenes[i]] = [ep.scenes[i], ep.scenes[i - 1]]; save(p); render(); } }, 'sm ghost'),
          btn('▼', () => { if (i < ep.scenes.length - 1) { [ep.scenes[i + 1], ep.scenes[i]] = [ep.scenes[i], ep.scenes[i + 1]]; save(p); render(); } }, 'sm ghost'),
          btn('🗑', () => { if (!confirm('למחוק את הסצנה?')) return; ep.scenes.splice(i, 1); save(p); render(); }, 'sm ghost'))),
      h('div', { class: 'scene-body' },
        h('div', { class: 'grid2' }, label('שם הסצנה', inp(s, 'title')), label('מיקום', inp(s, 'location'))),
        label('קריינות', inp(s, 'narration', { rows: 2 })),
        h('div', { class: 'fld' }, h('span', {}, 'מי בסצנה (ישמש כרפרנס לתמונה)'),
          h('div', { class: 'chips' }, p.characters.map(c => h('button', {
            class: 'chip' + (s.charIds.includes(c.id) ? ' on' : ''),
            onclick: () => { s.charIds = s.charIds.includes(c.id) ? s.charIds.filter(x => x !== c.id) : [...s.charIds, c.id]; save(p); render(); },
          }, c.img ? h('img', { src: c.img, alt: '' }) : null, c.name)))),
        h('div', { class: 'fld' }, h('span', {}, 'דיאלוג'),
          s.dialogue.map((d, k) => h('div', { class: 'dl' },
            sel(d, 'charId', charOpts),
            inp(d, 'line', { ph: 'מה נאמר…' }),
            btn('✕', () => { s.dialogue.splice(k, 1); save(p); render(); }, 'sm ghost'))),
          btn('➕ שורה', () => { s.dialogue.push({ charId: s.charIds[0] || '', line: '' }); save(p); render(); }, 'sm ghost')),
        h('details', {}, h('summary', {}, 'תיאור חזותי לתמונה (אנגלית)'), inp(s, 'imagePrompt', { rows: 3, dir: 'ltr' })),
      ))));
}

function tabCinema(p) {
  const opts = { which: 'all', tts: true, music: true };
  const cv = h('canvas', { width: 1280, height: 720, class: 'screen' });
  const status = h('div', { class: 'muted' }, 'מוכן להקרנה');
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 60px system-ui'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
  ctx.fillText(p.title || 'הסרט שלי', 640, 350);
  ctx.fillStyle = '#aaa'; ctx.font = '28px system-ui'; ctx.fillText('לחצו ▶ כדי להקרין', 640, 410);
  const eps = () => opts.which === 'all' ? p.episodes.filter(e => e.scenes.length) : [p.episodes[+opts.which]].filter(e => e && e.scenes.length);
  const run = async record => {
    if (!eps().length) return toast('אין סצנות להקרנה. צרו עלילה קודם.', 'warn');
    if (allScenes(p).some(s => !s.img)) toast('לחלק מהסצנות אין תמונה – כדאי לצייר אותן בלשונית "סצנות".', 'warn');
    try {
      status.textContent = record ? '⏺ מקליט… (הסרטון יירד בסוף)' : '▶ מקרין…';
      const blob = await Cinema.play(cv, p, { episodes: eps(), tts: opts.tts, music: opts.music, record, onProgress: t => { status.textContent = (record ? '⏺ ' : '▶ ') + t; } });
      status.textContent = 'ההקרנה הסתיימה';
      if (blob) { download(fileName(p.title) + (blob.type.includes('mp4') ? '.mp4' : '.webm'), blob); toast('הסרטון ירד! 🎬', 'ok'); }
    } catch (e) { status.textContent = 'שגיאה'; toast(e.message, 'err'); }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'row' },
      p.type === 'series' ? label('מה להקרין', sel(opts, 'which', [['all', 'כל הסדרה'], ...p.episodes.map((e, i) => [String(i), `פרק ${i + 1}: ${e.title || ''}`])])) : null,
      h('label', { class: 'chk' }, (() => { const x = h('input', { type: 'checkbox', checked: true }); x.onchange = () => opts.tts = x.checked; return x; })(), ' 🗣️ קריינות ודיבוב קולי'),
      h('label', { class: 'chk' }, (() => { const x = h('input', { type: 'checkbox', checked: true }); x.onchange = () => opts.music = x.checked; return x; })(), ' 🎵 מוזיקת רקע')),
    cv,
    h('div', { class: 'row' },
      btn('▶ הקרן', () => run(false), 'primary'),
      btn('⏹ עצור', () => Cinema.stop(), 'ghost'),
      btn('⏺ הקלט והורד כסרטון', () => run(true)),
      status),
    h('p', { class: 'muted' }, 'ההקלטה שומרת קובץ וידאו (WebM) עם התמונות, תנועת המצלמה, הכתוביות והמוזיקה – אפשר להעלות אותו ליוטיוב או לשלוח בוואטסאפ. הדיבוב הקולי של הדפדפן לא נכנס להקלטה, ולכן הוא כבוי בזמן הקלטה.'));
}

function tabGame(p) {
  const g = p.game || {};
  const kinds = [
    ['adventure', '🗺️ הרפתקה אינטראקטיבית', 'השחקן בוחר מה הגיבור עושה, ויש כמה סופים. ה-AI הופך את העלילה שלכם לעץ החלטות.'],
    ['arcade', '🕹️ משחק ארקייד', 'בוחרים דמות מהסרט, אוספים כוכבים ומתחמקים מהנבלים. הדמויות שציירתם הן הדמויות במשחק.'],
    ['quiz', '❓ טריוויה', 'שאלות על הסרט/הסדרה – כמה טוב צפיתם?'],
  ];
  const stage = h('div', { class: 'game-stage' });
  const ready = g.kind && (g.kind === 'arcade' || (g.kind === 'adventure' && g.adventure) || (g.kind === 'quiz' && g.quiz));
  return h('div', {},
    h('div', { class: 'kind-grid' }, kinds.map(([k, t, d]) => h('div', { class: 'card kind' + (g.kind === k ? ' on' : '') },
      h('h3', {}, t), h('p', { class: 'muted' }, d),
      btn(g.kind === k && ready ? '🔄 צור מחדש' : '✨ צור משחק כזה', () => generateGame(p, k), g.kind === k ? '' : 'primary')))),
    ready ? h('div', { class: 'card row' },
      h('b', {}, 'המשחק הנוכחי: ' + kinds.find(x => x[0] === g.kind)[1]),
      btn('▶ שחק עכשיו', () => {
        if (ui.game) ui.game.destroy();
        p.localPlays = (p.localPlays || 0) + 1; save(p);
        ui.game = GameRuntime(stage, buildGameData(p), { noCount: true });
        stage.scrollIntoView({ behavior: 'smooth' });
      }, 'primary'),
      btn('⬇ הורד את המשחק לשיתוף (HTML)', () => exportGameHTML(p))) : null,
    stage,
    ready ? h('p', { class: 'muted card' }, '📤 איך משתפים? מורידים את קובץ ה-HTML ושולחים לחברים (וואטסאפ, מייל, דרייב), או מעלים אותו לאתר (למשל GitHub Pages) ומקבלים קישור. כל פעם שמישהו פותח את המשחק – זה נספר בלשונית "סטטיסטיקה". מפתח ה-API שלכם לא נכלל בקובץ.') : null);
}

function tabStats(p) {
  const box = h('div', { class: 'stat-grid' },
    statTile('🎮', 'כניסות למשחק', '…'),
    statTile('🧑‍🤝‍🧑', 'שחקנים שונים', '…'),
    statTile('🧪', 'שיחקת כאן בעצמך', p.localPlays || 0),
    statTile('🧑‍🎤', 'דמויות', p.characters.length),
    statTile('🎞️', 'סצנות', allScenes(p).length),
    statTile('📺', p.type === 'series' ? 'פרקים' : 'חלקים', p.episodes.length));
  const note = h('p', { class: 'muted' }, 'טוען נתונים…');
  const load = async () => {
    note.textContent = 'טוען נתונים…';
    const [a, b] = await Promise.all([readCount(p, 'plays'), readCount(p, 'unique')]);
    box.children[0].querySelector('.v').textContent = a.value;
    box.children[1].querySelector('.v').textContent = b.value;
    note.textContent = a.ok || b.ok ? `עודכן ב-${new Date().toLocaleTimeString('he-IL')}` : 'לא הצלחתי להתחבר לשירות המונה כרגע (אולי אין אינטרנט). נסו שוב מאוחר יותר.';
  };
  setTimeout(load, 0);
  return h('div', { class: 'card' },
    h('div', { class: 'row space' }, h('h2', {}, '📈 כמה אנשים נכנסו?'), btn('🔄 רענן', load, 'ghost sm')),
    box, note,
    h('details', { open: true }, h('summary', {}, 'איך זה עובד בלי שרת?'),
      h('p', {}, 'צדקת שבלי שרת אי אפשר לספור לבד – אז האולפן נעזר בשירות מונים חינמי ופתוח (Abacus, ו-CounterAPI כגיבוי). ככה לא צריך להקים שרת משלך: כל משחק שהורדתם ושיתפתם שולח "+1" לשירות כשמישהו פותח אותו, והלשונית הזו קוראת את המספר.'),
      h('ul', {},
        h('li', {}, 'כניסות למשחק – כל פתיחה של קובץ המשחק, בכל מכשיר.'),
        h('li', {}, 'שחקנים שונים – נספר פעם אחת לכל דפדפן/מכשיר.'),
        h('li', {}, 'המשחקים שאתם משחקים כאן באולפן לא נספרים, כדי לא לנפח את המספרים.'),
        h('li', {}, 'הנתונים הם רק מספרים – לא נאסף שום מידע אישי על השחקנים.'))));
}
const statTile = (icon, t, v) => h('div', { class: 'stat' }, h('div', { class: 'ic' }, icon), h('div', { class: 'v' }, v), h('div', { class: 'l' }, t));

// ---------- הגדרות ----------
function viewSettings() {
  const test = h('span', { class: 'muted' });
  return h('div', { class: 'card settings' },
    h('h2', {}, '⚙️ הגדרות AI'),
    h('h3', {}, '🍌 ג׳מיני (Nano Banana) – מומלץ'),
    h('p', {}, 'מפתח חינמי מקבלים תוך דקה ב-', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'Google AI Studio'), ' (מתחברים עם חשבון גוגל ← Create API key). המפתח נשמר רק בדפדפן שלך ונשלח רק לגוגל.'),
    label('מפתח Gemini API', inp(S, 'geminiKey', { type: 'password', ph: 'AIza…', dir: 'ltr', onInput: saveSettings })),
    h('div', { class: 'row' }, btn('בדיקת חיבור', async () => {
      test.textContent = 'בודק…';
      try { await geminiText('Reply with the single word: OK', false); test.textContent = '✅ ג׳מיני מחובר!'; }
      catch (e) { test.textContent = '❌ ' + e.message; }
    }, 'sm'), test),
    h('div', { class: 'grid2' },
      label('מודל לעלילה', inp(S, 'textModel', { dir: 'ltr', onInput: saveSettings })),
      label('מודל לתמונות', inp(S, 'imageModel', { dir: 'ltr', onInput: saveSettings }))),
    h('p', { class: 'muted' }, 'ברירת מחדל: gemini-2.5-flash לעלילה (יש לו מכסה חינמית נדיבה) ו-gemini-2.5-flash-image ("ננו בננה") לתמונות. לננו בננה Pro כתבו gemini-3-pro-image-preview. שימו לב: גוגל לפעמים מגבילה יצירת תמונות במסלול החינמי – אם מופיעה שגיאת מכסה, האולפן עובר אוטומטית ל-Pollinations החינמי.'),
    h('hr'),
    h('h3', {}, 'מי עושה מה?'),
    h('div', { class: 'grid2' },
      label('✍️ כתיבת עלילה', sel(S, 'textProvider', [['auto', 'אוטומטי (ג׳מיני ← Pollinations ← מובנה)'], ['gemini', 'רק ג׳מיני'], ['pollinations', 'רק Pollinations (חינמי, בלי מפתח)'], ['offline', 'מחולל מובנה (בלי אינטרנט)']], saveSettings)),
      label('🎨 ציור תמונות', sel(S, 'imageProvider', [['auto', 'אוטומטי (ננו בננה ← Pollinations ← מובנה)'], ['gemini', 'רק ג׳מיני ננו בננה'], ['pollinations', 'רק Pollinations (חינמי, בלי מפתח)'], ['offline', 'ציור מובנה פשוט (בלי אינטרנט)']], saveSettings))),
    h('p', { class: 'muted' }, 'Pollinations.ai הוא שירות AI חינמי שלא דורש הרשמה – מצוין להתחלה. ננו בננה נותן תמונות איכותיות יותר ושומר על מראה הדמויות זהה בין הסצנות.'),
    h('hr'),
    h('h3', {}, '🗂️ נתונים'),
    h('p', { class: 'muted' }, 'כל הפרויקטים נשמרים בדפדפן הזה בלבד. כדי לא לאבד אותם – השתמשו ב"גיבוי לקובץ" בתוך כל פרויקט.'));
}

// =====================================================================
// הפעלה
// =====================================================================
(async () => {
  $('#nav-home').onclick = () => go('home');
  $('#nav-settings').onclick = () => go('settings');
  $('#logo').onclick = () => go('home');
  try { projects = (await DB.all()).sort((a, b) => b.updated - a.updated); }
  catch (e) { toast('לא ניתן לפתוח את האחסון המקומי: ' + e.message, 'err'); }
  render();
})();
