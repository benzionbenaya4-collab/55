// מנוע המשחקים של האולפן.
// הפונקציה הזו חייבת להיות עצמאית לגמרי (בלי תלות בקוד אחר), כי היא מועתקת כטקסט
// (GameRuntime.toString()) לתוך קובץ ה-HTML של המשחק שמורידים ומשתפים.
function GameRuntime(root, data, opts) {
  opts = opts || {};
  var NS = 'kolnoa-studio-55';
  var timers = [], rafId = 0, keyHandler = null, destroyed = false;
  var imgSrc = function (i) { return (i != null && data.images && data.images[i]) || ''; };

  // ---------- מונה כניסות (שירות מונה חינמי – לא צריך שרת משלך) ----------
  function hit(key) {
    var k = encodeURIComponent(data.id + '-' + key);
    return fetch('https://abacus.jasoncameron.dev/hit/' + NS + '/' + k)
      .then(function (r) { if (!r.ok) throw 0; })
      .catch(function () { return fetch('https://api.counterapi.dev/v1/' + NS + '/' + k + '/up').catch(function () {}); });
  }
  if (!opts.noCount) {
    try {
      hit('plays');
      var seenKey = 'gr-seen-' + data.id;
      if (!localStorage.getItem(seenKey)) { localStorage.setItem(seenKey, '1'); hit('unique'); }
    } catch (e) {}
  }

  // ---------- עיצוב ----------
  if (!document.getElementById('gr-style')) {
    var st = document.createElement('style');
    st.id = 'gr-style';
    st.textContent = [
      '.gr{direction:rtl;font-family:system-ui,"Segoe UI",Arial,sans-serif;color:#f3efe6;background:radial-gradient(circle at 50% 0,#2a2350,#0b0b14 70%);border-radius:16px;padding:18px;min-height:420px;position:relative;overflow:hidden;box-sizing:border-box}',
      '.gr *{box-sizing:border-box}',
      '.gr h1{margin:0 0 6px;font-size:clamp(22px,4vw,34px);color:#ffd166;text-align:center}',
      '.gr h2{margin:0 0 10px;font-size:20px;color:#ffd166}',
      '.gr p{line-height:1.6;font-size:17px;margin:8px 0}',
      '.gr .sub{text-align:center;opacity:.8;margin-bottom:14px}',
      '.gr .cover{width:100%;max-height:320px;object-fit:cover;border-radius:12px;display:block;margin:0 auto 14px;box-shadow:0 8px 30px #0008}',
      '.gr .btn{display:inline-block;border:0;border-radius:999px;padding:12px 22px;margin:5px;font-size:17px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#ffd166,#f4a261);color:#1b1430;box-shadow:0 4px 14px #0006;transition:transform .12s}',
      '.gr .btn:hover{transform:translateY(-2px)}',
      '.gr .btn.ghost{background:#ffffff1a;color:#f3efe6}',
      '.gr .center{text-align:center}',
      '.gr .choices{display:flex;flex-direction:column;gap:8px;margin-top:12px}',
      '.gr .choice{text-align:right;border:1px solid #ffd16655;background:#ffffff10;color:#f3efe6;border-radius:12px;padding:12px 16px;font-size:17px;cursor:pointer}',
      '.gr .choice:hover{background:#ffd16622}',
      '.gr .choice.ok{background:#2a9d8f;border-color:#2a9d8f}',
      '.gr .choice.bad{background:#e63946;border-color:#e63946}',
      '.gr .fade{animation:grfade .45s ease}',
      '@keyframes grfade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '.gr .heroes{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin:12px 0}',
      '.gr .hero{width:120px;cursor:pointer;text-align:center;border-radius:14px;padding:8px;background:#ffffff10;border:2px solid transparent}',
      '.gr .hero:hover{border-color:#ffd166}',
      '.gr .hero img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:50%;display:block;margin-bottom:6px}',
      '.gr canvas{width:100%;display:block;border-radius:12px;touch-action:none;background:#000}',
      '.gr .bar{display:flex;justify-content:space-between;opacity:.85;font-size:15px;margin-bottom:8px}',
      '.gr .big{font-size:48px;text-align:center;margin:10px 0}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var wrap = document.createElement('div');
  wrap.className = 'gr';
  root.innerHTML = '';
  root.appendChild(wrap);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(text, fn, cls) { var b = el('button', 'btn' + (cls ? ' ' + cls : ''), text); b.onclick = fn; return b; }
  function img(src, cls) { var i = el('img', cls); i.src = src; i.alt = ''; return i; }
  function screen() { stopLoop(); wrap.innerHTML = ''; var s = el('div', 'fade'); wrap.appendChild(s); return s; }
  function stopLoop() {
    cancelAnimationFrame(rafId); rafId = 0;
    timers.forEach(clearTimeout); timers = [];
    if (keyHandler) { window.removeEventListener('keydown', keyHandler); window.removeEventListener('keyup', keyHandler); keyHandler = null; }
  }

  // ---------- מסך פתיחה ----------
  function titleScreen() {
    var s = screen();
    s.appendChild(el('h1', '', data.title || 'המשחק שלי'));
    var kindName = { adventure: 'הרפתקה אינטראקטיבית', arcade: 'משחק ארקייד', quiz: 'טריוויה' }[data.kind] || '';
    s.appendChild(el('div', 'sub', kindName + (data.subtitle ? ' · ' + data.subtitle : '')));
    if (data.cover != null && imgSrc(data.cover)) s.appendChild(img(imgSrc(data.cover), 'cover'));
    var c = el('div', 'center');
    c.appendChild(btn('▶ התחל לשחק', function () {
      if (data.kind === 'adventure') adventure(data.adventure.start);
      else if (data.kind === 'quiz') quiz();
      else chooseHero();
    }));
    s.appendChild(c);
    if (data.credit) s.appendChild(el('div', 'sub', data.credit));
  }

  // ---------- הרפתקה ----------
  function adventure(nodeId) {
    var nodes = data.adventure.nodes, n = nodes[nodeId];
    if (!n) return titleScreen();
    var s = screen();
    if (imgSrc(n.img)) s.appendChild(img(imgSrc(n.img), 'cover'));
    if (n.end) s.appendChild(el('div', 'big', n.end === 'win' ? '🏆' : '💀'));
    s.appendChild(el('p', '', n.text));
    var ch = el('div', 'choices');
    if (n.end) {
      ch.appendChild(el('h2', 'center', n.end === 'win' ? 'ניצחת! סוף טוב' : 'זה נגמר רע... נסה שוב'));
      var c = el('div', 'center');
      c.appendChild(btn('↺ שחק שוב', function () { adventure(data.adventure.start); }));
      c.appendChild(btn('תפריט', titleScreen, 'ghost'));
      ch.appendChild(c);
    } else {
      (n.choices || []).forEach(function (o) {
        var b = el('button', 'choice', '◀ ' + o.text);
        b.onclick = function () { adventure(o.to); };
        ch.appendChild(b);
      });
    }
    s.appendChild(ch);
    root.scrollIntoView && wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- טריוויה ----------
  function quiz() {
    var qs = data.quiz || [], i = 0, score = 0;
    function show() {
      if (i >= qs.length) return end();
      var q = qs[i], s = screen();
      s.appendChild(el('div', 'bar', 'שאלה ' + (i + 1) + ' מתוך ' + qs.length + '   ·   ניקוד: ' + score));
      if (imgSrc(q.img)) s.appendChild(img(imgSrc(q.img), 'cover'));
      s.appendChild(el('h2', '', q.q));
      var ch = el('div', 'choices'), locked = false;
      q.options.forEach(function (o, k) {
        var b = el('button', 'choice', o);
        b.onclick = function () {
          if (locked) return; locked = true;
          if (k === q.answer) { score++; b.classList.add('ok'); }
          else { b.classList.add('bad'); ch.children[q.answer] && ch.children[q.answer].classList.add('ok'); }
          timers.push(setTimeout(function () { i++; show(); }, 1100));
        };
        ch.appendChild(b);
      });
      s.appendChild(ch);
    }
    function end() {
      var s = screen(), pct = qs.length ? score / qs.length : 0;
      s.appendChild(el('div', 'big', pct >= 0.8 ? '🌟🌟🌟' : pct >= 0.5 ? '🌟🌟' : '🌟'));
      s.appendChild(el('h1', '', 'ענית נכון על ' + score + ' מתוך ' + qs.length));
      var c = el('div', 'center');
      c.appendChild(btn('↺ שוב', quiz));
      c.appendChild(btn('תפריט', titleScreen, 'ghost'));
      s.appendChild(c);
    }
    show();
  }

  // ---------- ארקייד ----------
  function chooseHero() {
    var s = screen();
    s.appendChild(el('h2', 'center', 'בחר את הדמות שלך'));
    var row = el('div', 'heroes');
    (data.characters || []).forEach(function (c, idx) {
      if (c.villain && data.characters.some(function (x) { return !x.villain; })) return;
      var card = el('div', 'hero');
      if (imgSrc(c.img)) card.appendChild(img(imgSrc(c.img)));
      card.appendChild(el('div', '', c.name));
      card.onclick = function () { arcade(idx); };
      row.appendChild(card);
    });
    s.appendChild(row);
    s.appendChild(el('div', 'sub', 'אסוף ⭐ ותתחמק מהנבלים! הזזה: עכבר / אצבע / חיצים'));
  }

  function loadImage(src) {
    return new Promise(function (res) {
      if (!src) return res(null);
      var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src;
    });
  }

  function arcade(heroIdx) {
    var s = screen();
    var bar = el('div', 'bar'); s.appendChild(bar);
    var cv = el('canvas'); cv.width = 900; cv.height = 506; s.appendChild(cv);
    var ctx = cv.getContext('2d');
    var hero = data.characters[heroIdx];
    var villains = data.characters.filter(function (c, k) { return k !== heroIdx && c.villain; });
    if (!villains.length) villains = data.characters.filter(function (c, k) { return k !== heroIdx; });
    Promise.all([loadImage(imgSrc(hero.img)), loadImage(imgSrc(data.bg))].concat(villains.map(function (v) { return loadImage(imgSrc(v.img)); })))
      .then(function (imgs) { if (!destroyed) run(imgs[0], imgs[1], imgs.slice(2)); });

    function run(heroImg, bgImg, vImgs) {
      var W = cv.width, H = cv.height;
      var p = { x: W / 2, y: H - 60, r: 40, tx: W / 2 };
      var items = [], score = 0, lives = 3, t0 = performance.now(), last = t0, spawnT = 0, hurtT = 0, over = false;
      var best = 0; try { best = +localStorage.getItem('gr-best-' + data.id) || 0; } catch (e) {}
      var keys = {};
      keyHandler = function (e) { keys[e.key] = e.type === 'keydown'; if (/Arrow/.test(e.key)) e.preventDefault(); };
      window.addEventListener('keydown', keyHandler); window.addEventListener('keyup', keyHandler);
      function point(e) { var r = cv.getBoundingClientRect(); p.tx = (e.clientX - r.left) / r.width * W; }
      cv.onpointermove = point; cv.onpointerdown = point;

      function circleImg(im, x, y, r, ring) {
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath();
        ctx.fillStyle = '#334'; ctx.fill(); ctx.clip();
        if (im) { var sc = Math.max(2 * r / im.width, 2 * r / im.height); ctx.drawImage(im, x - im.width * sc / 2, y - im.height * sc / 2, im.width * sc, im.height * sc); }
        ctx.restore();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = ring; ctx.stroke();
      }
      function star(x, y, r, rot) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath();
        for (var k = 0; k < 10; k++) { var a = k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; ctx.lineTo(Math.sin(a) * rr, -Math.cos(a) * rr); }
        ctx.closePath(); ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 16; ctx.fill(); ctx.restore();
      }
      function frame(now) {
        if (destroyed) return;
        var dt = Math.min(50, now - last) / 1000; last = now;
        var el2 = (now - t0) / 1000, level = 1 + Math.floor(el2 / 15);
        if (!over) {
          if (keys.ArrowLeft || keys.a) p.tx = p.x - 600 * dt;
          if (keys.ArrowRight || keys.d) p.tx = p.x + 600 * dt;
          p.tx = Math.max(p.r, Math.min(W - p.r, p.tx));
          p.x += (p.tx - p.x) * Math.min(1, dt * 14);
          spawnT -= dt;
          if (spawnT <= 0) {
            spawnT = Math.max(0.28, 0.9 - level * 0.08) * (0.6 + Math.random() * 0.8);
            var roll = Math.random(), kind = roll < 0.62 ? 'star' : roll < 0.97 ? 'bad' : 'life';
            items.push({ kind: kind, x: 40 + Math.random() * (W - 80), y: -40, r: kind === 'bad' ? 34 : 22, v: (140 + level * 35) * (0.8 + Math.random() * 0.5), rot: 0, im: vImgs[Math.floor(Math.random() * vImgs.length)] });
          }
          for (var k = items.length - 1; k >= 0; k--) {
            var it = items[k]; it.y += it.v * dt; it.rot += dt * 2;
            var dx = it.x - p.x, dy = it.y - p.y;
            if (Math.sqrt(dx * dx + dy * dy) < it.r + p.r - 6) {
              items.splice(k, 1);
              if (it.kind === 'star') score += 10 * level;
              else if (it.kind === 'life') lives = Math.min(5, lives + 1);
              else if (now > hurtT) { lives--; hurtT = now + 900; if (lives <= 0) gameOver(); }
            } else if (it.y > H + 50) items.splice(k, 1);
          }
        }
        // ציור
        ctx.fillStyle = '#0b0b14'; ctx.fillRect(0, 0, W, H);
        if (bgImg) { var sc = Math.max(W / bgImg.width, H / bgImg.height); ctx.globalAlpha = 0.45; ctx.drawImage(bgImg, (W - bgImg.width * sc) / 2, (H - bgImg.height * sc) / 2, bgImg.width * sc, bgImg.height * sc); ctx.globalAlpha = 1; }
        items.forEach(function (it) {
          if (it.kind === 'star') star(it.x, it.y, it.r, it.rot);
          else if (it.kind === 'life') { ctx.font = '40px serif'; ctx.textAlign = 'center'; ctx.fillText('❤️', it.x, it.y + 14); }
          else circleImg(it.im, it.x, it.y, it.r, '#e63946');
        });
        if (!(now < hurtT && Math.floor(now / 100) % 2)) circleImg(heroImg, p.x, p.y, p.r, '#ffd166');
        bar.textContent = 'ניקוד: ' + score + '   ·   ' + '❤️'.repeat(Math.max(0, lives)) + '   ·   שלב ' + level + '   ·   שיא: ' + Math.max(best, score);
        if (!over) rafId = requestAnimationFrame(frame);
      }
      function gameOver() {
        over = true;
        if (score > best) { try { localStorage.setItem('gr-best-' + data.id, score); } catch (e) {} }
        timers.push(setTimeout(function () {
          var o = el('div', 'fade center');
          o.style.cssText = 'position:absolute;inset:0;background:#000b;display:flex;flex-direction:column;align-items:center;justify-content:center';
          o.appendChild(el('h1', '', 'המשחק נגמר!'));
          o.appendChild(el('p', '', 'ניקוד: ' + score + (score > best ? ' — שיא חדש! 🎉' : '')));
          var c = el('div');
          c.appendChild(btn('↺ שוב', function () { arcade(heroIdx); }));
          c.appendChild(btn('דמות אחרת', chooseHero, 'ghost'));
          o.appendChild(c);
          wrap.appendChild(o);
        }, 400));
      }
      rafId = requestAnimationFrame(frame);
    }
  }

  titleScreen();
  return { destroy: function () { destroyed = true; stopLoop(); root.innerHTML = ''; } };
}
