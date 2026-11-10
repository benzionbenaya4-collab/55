// נגן הקולנוע: מציג את הסרט/הסדרה על קנבס – תמונות עם תנועת מצלמה, כתוביות,
// קריינות קולית (דיבור של הדפדפן) ומוזיקת רקע, ויכול להקליט הכול לקובץ וידאו.
'use strict';
const Cinema = (() => {
  class Stop extends Error {}
  let stopFlag = false, running = false, raf = 0;
  const view = { kind: 'black', img: null, start: 0, dur: 1, title: '', subtitle: '', lines: [], sub: null, idx: 0 };

  const wait = ms => new Promise((res, rej) => {
    const t0 = performance.now();
    (function tick() {
      if (stopFlag) return rej(new Stop());
      if (performance.now() - t0 >= ms) return res();
      setTimeout(tick, 50);
    })();
  });

  const loadImg = src => new Promise(res => {
    if (!src) return res(null);
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });

  function wrapText(ctx, text, maxW) {
    const words = String(text).split(/\s+/), lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function draw(ctx, now) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const t = (now - view.start) / 1000;
    if (view.kind === 'card') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1d1640'); g.addColorStop(1, '#05040a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = Math.min(1, t / 0.8);
      ctx.textAlign = 'center'; ctx.direction = 'rtl';
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 64px system-ui, Arial';
      ctx.fillText(view.title, W / 2, H / 2 - (view.lines.length ? 80 : 10));
      ctx.fillStyle = '#f3efe6';
      ctx.font = '34px system-ui, Arial';
      if (view.subtitle) ctx.fillText(view.subtitle, W / 2, H / 2 + 40 - (view.lines.length ? 80 : 0));
      ctx.font = '26px system-ui, Arial';
      ctx.fillStyle = '#c9c2d8';
      view.lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + 30 + i * 38));
      ctx.globalAlpha = 1;
      return;
    }
    if (view.kind === 'scene') {
      const im = view.img, p = Math.min(1, t / Math.max(1, view.dur));
      if (im) {
        // תנועת מצלמה (Ken Burns) – כל סצנה בכיוון אחר
        const zIn = view.idx % 2 === 0;
        const zoom = zIn ? 1.04 + 0.12 * p : 1.16 - 0.12 * p;
        const sc = Math.max(W / im.width, H / im.height) * zoom;
        const dir = [[-1, 0], [1, 0], [0, -1], [0, 1]][view.idx % 4];
        const dw = im.width * sc, dh = im.height * sc;
        const ox = (W - dw) / 2 + dir[0] * (dw - W) / 2 * (p - 0.5);
        const oy = (H - dh) / 2 + dir[1] * (dh - H) / 2 * (p - 0.5);
        ctx.drawImage(im, ox, oy, dw, dh);
      } else {
        ctx.fillStyle = '#222'; ctx.fillRect(0, 0, W, H);
      }
      if (view.sub) {
        const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
        g.addColorStop(0, '#0000'); g.addColorStop(1, '#000d');
        ctx.fillStyle = g; ctx.fillRect(0, H * 0.55, W, H * 0.45);
        ctx.direction = 'rtl'; ctx.textAlign = 'center';
        ctx.font = '34px system-ui, Arial';
        const lines = wrapText(ctx, view.sub.text, W * 0.82).slice(-3);
        let y = H - 40 - (lines.length - 1) * 44;
        if (view.sub.speaker) {
          ctx.font = 'bold 30px system-ui, Arial';
          ctx.fillStyle = '#ffd166';
          ctx.fillText(view.sub.speaker, W / 2, y - 48);
        }
        ctx.font = view.sub.speaker ? '34px system-ui, Arial' : 'italic 32px system-ui, Arial';
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 8;
        for (const l of lines) { ctx.fillText(l, W / 2, y); y += 44; }
        ctx.shadowBlur = 0;
      }
      if (t < 0.7) { ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.7})`; ctx.fillRect(0, 0, W, H); }
    }
  }

  // ---------- מוזיקה (סינתיסייזר בדפדפן) ----------
  const MOODS = {
    happy: [[261.6, 329.6, 392], [349.2, 440, 523.3], [392, 493.9, 587.3], [261.6, 329.6, 392]],
    epic: [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]],
    dark: [[220, 261.6, 329.6], [207.7, 246.9, 311.1], [196, 233.1, 293.7], [174.6, 207.7, 261.6]],
    calm: [[293.7, 370, 440], [246.9, 293.7, 370], [329.6, 392, 493.9], [220, 277.2, 329.6]],
  };
  function startMusic(actx, out, mood) {
    const chords = MOODS[mood] || MOODS.calm;
    const master = actx.createGain(); master.gain.value = 0.07;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    master.connect(lp); lp.connect(out);
    let i = 0;
    const play = () => {
      const ch = chords[i++ % chords.length], t = actx.currentTime;
      ch.concat([ch[0] / 2]).forEach((f, k) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = k === 3 ? 'sine' : 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.6, t + 0.6); g.gain.linearRampToValueAtTime(0, t + 2.9);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 3);
      });
    };
    play();
    const iv = setInterval(play, 2600);
    return { stop() { clearInterval(iv); master.disconnect(); } };
  }
  const moodFor = genre => /אימה|מתח|אפל|horror|thriller/i.test(genre) ? 'dark'
    : /קומדיה|ילדים|comedy/i.test(genre) ? 'happy'
    : /פנטזיה|הרפתקה|פעולה|מדע|epic|action/i.test(genre) ? 'epic' : 'calm';

  // ---------- קריינות ----------
  let heVoices = [];
  const loadVoices = () => { if ('speechSynthesis' in window) heVoices = speechSynthesis.getVoices().filter(v => /^he|^iw/i.test(v.lang)); };
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  function speak(text, key) {
    return new Promise(res => {
      if (!('speechSynthesis' in window)) return res();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'he-IL';
      let hsh = 0; for (const c of String(key)) hsh = (hsh * 31 + c.charCodeAt(0)) | 0;
      hsh = Math.abs(hsh);
      if (heVoices.length) u.voice = heVoices[hsh % heVoices.length];
      u.pitch = key === 'narrator' ? 0.9 : 0.75 + (hsh % 6) * 0.1;
      u.rate = key === 'narrator' ? 0.95 : 1.05;
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      u.onend = fin; u.onerror = fin;
      setTimeout(fin, 20000);
      speechSynthesis.speak(u);
    });
  }

  async function play(canvas, project, opts = {}) {
    if (running) stop();
    await new Promise(r => setTimeout(r, 80));
    stopFlag = false; running = true;
    const ctx = canvas.getContext('2d');
    const useTTS = opts.tts && !opts.record;
    let actx = null, music = null, rec = null, chunks = [];
    const loop = now => { draw(ctx, now); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    try {
      if (opts.music || opts.record) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = opts.record ? actx.createMediaStreamDestination() : null;
        if (opts.music) {
          const out = actx.createGain(); out.connect(actx.destination); if (dest) out.connect(dest);
          music = startMusic(actx, out, moodFor(project.genre || ''));
        }
        if (opts.record) {
          const stream = canvas.captureStream(30);
          if (dest) dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
          const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
          if (!mime) throw new Error('הדפדפן הזה לא תומך בהקלטת וידאו. נסו כרום או אדג׳.');
          rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
          rec.ondataavailable = e => e.data.size && chunks.push(e.data);
          rec.start(500);
        }
      }
      const chars = Object.fromEntries((project.characters || []).map(c => [c.id, c]));
      const eps = opts.episodes || project.episodes;
      const series = project.type === 'series';
      let sceneNo = 0;
      for (let e = 0; e < eps.length; e++) {
        const ep = eps[e];
        Object.assign(view, { kind: 'card', start: performance.now(), title: project.title || 'הסרט שלי', subtitle: series ? `פרק ${project.episodes.indexOf(ep) + 1}: ${ep.title || ''}` : (project.logline || ''), lines: [] });
        opts.onProgress && opts.onProgress(`${view.title} – ${view.subtitle}`);
        await wait(3200);
        for (const sc of ep.scenes) {
          const lines = [];
          if (sc.narration) lines.push({ speaker: '', text: sc.narration, key: 'narrator' });
          for (const d of sc.dialogue || []) if (d.line) lines.push({ speaker: (chars[d.charId] && chars[d.charId].name) || d.name || '', text: d.line, key: d.charId || d.name || 'x' });
          const est = l => Math.max(2300, l.text.length * 75);
          const total = lines.reduce((a, l) => a + est(l) + 300, 0) || 3000;
          Object.assign(view, { kind: 'scene', img: await loadImg(sc.img), start: performance.now(), dur: total / 1000 + 1, idx: sceneNo++, sub: null });
          opts.onProgress && opts.onProgress(sc.title || `סצנה ${sceneNo}`);
          await wait(lines.length ? 600 : 3000);
          for (const l of lines) {
            view.sub = l;
            await Promise.race([
              Promise.all([wait(est(l)), useTTS ? speak(l.text, l.key) : null]),
              new Promise((_, rej) => { const iv = setInterval(() => { if (stopFlag) { clearInterval(iv); rej(new Stop()); } }, 100); }),
            ]);
            view.sub = null;
            await wait(300);
          }
        }
      }
      const cast = (project.characters || []).slice(0, 6).map(c => `${c.name}${c.role ? ' – ' + c.role : ''}`);
      Object.assign(view, { kind: 'card', start: performance.now(), title: 'סוף', subtitle: '', lines: ['משתתפים:', ...cast, '', 'נוצר באולפן ה-AI'] });
      await wait(4500);
    } catch (err) {
      if (!(err instanceof Stop)) { finish(); throw err; }
    }
    return finish();

    function finish() {
      cancelAnimationFrame(raf);
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      music && music.stop();
      running = false;
      Object.assign(view, { kind: 'black' });
      draw(ctx, performance.now());
      return new Promise(res => {
        if (!rec) { actx && actx.close(); return res(null); }
        rec.onstop = () => { actx && actx.close(); res(new Blob(chunks, { type: rec.mimeType })); };
        rec.stop();
      });
    }
  }

  function stop() {
    stopFlag = true;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  return { play, stop, isRunning: () => running };
})();
