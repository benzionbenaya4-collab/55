// נוצר אוטומטית ע"י tools/bundle.py – לא לערוך ידנית (עורכים את tools/sw_template.js)
const CACHE = 'oath-__VERSION__';
const FILES = __FILES__;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('oath-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // יוטיוב וכו' – רגיל
  const page = e.request.mode === 'navigate' || u.pathname.endsWith('.html') || u.pathname.endsWith('/');
  if (page) {   // דפים: קודם מהאינטרנט (כדי לקבל עדכונים), בלי אינטרנט – מהשמירה
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {      // תמונות: קודם מהשמירה (מהיר)
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request)));
  }
});
