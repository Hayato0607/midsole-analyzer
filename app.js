(() => {
'use strict';
const C = Core;
const $ = s => document.querySelector(s);
const video = $('#video'), overlay = $('#overlay'), octx = overlay.getContext('2d');
const chart = $('#chart'), cctx = chart.getContext('2d');
const kymoCanvases = [...document.querySelectorAll('.kymo canvas')];
const gauges = [...document.querySelectorAll('.gauge')];
const grabCv = document.createElement('canvas'); let gctx = null;
const NAMES = ['ヒール', 'ミッド', 'フォア'], ZONE_NAMES = NAMES;
const S = { loaded: false, fps: 30, N: 0, vw: 0, vh: 0, aw: 0, ah: 0, mark: null, start: null, end: null, stations: null, box: null, toeRight: true, A: null, busy: false, drag: null, lam: 0.03, capFps: 0, kymo: [], name: 'video', scale: { mm: null, px: null, p0: null, p1: null, picking: 0 } };
let colors = [], css = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  colors = ['--heel', '--mid', '--fore'].map(v => cs.getPropertyValue(v).trim());
  ['--ink', '--muted', '--line', '--surface', '--bg'].forEach(v => { css[v] = cs.getPropertyValue(v).trim(); });
}
readColors();
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); drawAll(); }); } catch (e) {}
const downloadsP = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

function say(sel, text, tone) { const el = $(sel); el.textContent = text || ''; el.dataset.tone = tone || ''; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const curIdx = () => S.N ? clamp(Math.floor(video.currentTime * S.fps + 1e-3), 0, S.N - 1) : 0;
const tOf = i => clamp((i + 0.5) / S.fps, 0, Math.max(0, video.duration - 0.002));

// ---------- video loading ----------
function tryUrl(url) {
  return new Promise((res, rej) => {
    const ok = () => { cleanup(); res(); }, bad = () => { cleanup(); rej(new Error('load')); };
    const cleanup = () => { video.removeEventListener('loadeddata', ok); video.removeEventListener('error', bad); };
    video.addEventListener('loadeddata', ok); video.addEventListener('error', bad);
    video.src = url; video.load();
  });
}
async function loadFile(file) {
  if (!file || S.busy) return;
  S.busy = true; resetAll(); updateUI();
  say('#loadStatus', '読み込み中…');
  S.name = (file.name || 'video').replace(/\.[^.]+$/, '');
  try { await tryUrl(URL.createObjectURL(file)); }
  catch (e) {
    try {
      const d = await new Promise((r, j) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = j; fr.readAsDataURL(file); });
      await tryUrl(d);
    } catch (e2) {
      S.busy = false; updateUI();
      say('#loadStatus', 'この動画はブラウザで開けませんでした。H.264（MP4またはMOV）で書き出したファイルを試してください。', 'warn');
      return;
    }
  }
  try { await video.play(); video.pause(); } catch (e) {}
  S.vw = video.videoWidth; S.vh = video.videoHeight;
  const sc = Math.min(1, 1280 / Math.max(S.vw, S.vh));
  S.aw = Math.round(S.vw * sc); S.ah = Math.round(S.vh * sc);
  grabCv.width = S.aw; grabCv.height = S.ah; gctx = grabCv.getContext('2d', { willReadFrequently: true });
  $('#stage').style.setProperty('--ar', `${S.vw} / ${S.vh}`);
  S.fps = +$('#fps').value || 30; S.N = Math.max(1, Math.floor(video.duration * S.fps + 1e-6));
  S.loaded = true; S.busy = false;
  $('#drop').hidden = true;
  $('#scrub').max = S.N - 1;
  video.playbackRate = +$('#rate').value;
  await seekTo(0);
  say('#loadStatus', `${S.vw}×${S.vh}、約${video.duration.toFixed(1)}秒、${S.N}フレーム。`, 'ok');
  say('#stageNote', '靴がはっきり写るフレームまで進めて、「このフレームで自動検出」を押してください。');
  updateUI(); drawAll();
}
function resetAll() {
  S.loaded = false; S.mark = S.start = S.end = null; S.stations = null; S.box = null; S.A = null; S.kymo = []; S.autoMark = false;
  say('#detectStatus', ''); say('#runStatus', ''); say('#rangeStatus', ''); say('#baseStatus', ''); say('#csvStatus', '');
  $('#csvBox').hidden = true;
  S.scale = { mm: S.scale ? S.scale.mm : null, px: null, p0: null, p1: null, picking: 0 }; say('#scaleStatus', '');
}

// ---------- frame access ----------
function seekTo(i) {
  return new Promise(res => {
    const t = tOf(i);
    if (Math.abs(video.currentTime - t) < 1e-4 && !video.seeking) { res(); return; }
    let done = false;
    const fin = () => { if (done) return; done = true; video.removeEventListener('seeked', onSeeked); res(); };
    const onSeeked = () => {
      if (typeof video.requestVideoFrameCallback === 'function') { video.requestVideoFrameCallback(() => fin()); setTimeout(fin, 90); }
      else requestAnimationFrame(() => requestAnimationFrame(fin));
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = t;
    setTimeout(fin, 2000);
  });
}
function grabNow() { gctx.drawImage(video, 0, 0, S.aw, S.ah); const d = gctx.getImageData(0, 0, S.aw, S.ah); return { rgba: d.data, w: S.aw, h: S.ah }; }
async function grab(i) { await seekTo(i); return grabNow(); }

// ---------- detection & stations ----------
function thicknessInfo() {
  if (!S.stations) return '';
  const st = S.stations[0], h = Math.hypot(st.bot[0] - st.top[0], st.bot[1] - st.top[1]);
  return `ヒールの厚みは約${h.toFixed(0)} px（1 pxで約${(100 / h).toFixed(1)}%）。`;
}
function onStationsChanged(msg, warn) {
  S.A = null; S.kymo = [];
  const st = S.stations[0], h = Math.hypot(st.bot[0] - st.top[0], st.bot[1] - st.top[1]);
  say('#detectStatus', `${msg}${thicknessInfo()}${h < 35 ? '厚みが小さいので誤差が大きくなります。靴を大きく写すと精度が上がります。' : ''}`, (h < 35 || warn) ? 'warn' : 'ok');
  say('#runStatus', ''); say('#baseStatus', '');
  updateUI(); drawAll();
}
function markerMsg(st) {
  const m = st && st.markers; if (!m) return '';
  const n = m.used.filter(Boolean).length;
  if (!m.found.length) return '赤いテープは見つからなかったので、測定点を靴の長さの15%・42%・68%に置きました。';
  return `赤いテープを${m.found.length}か所見つけ、${n}か所の測定点をテープのすぐ横に合わせました。${n < 3 ? '見つからなかった部位は、靴の長さの割合で置いています。' : ''}`;
}
function defaultRange() {
  S.start = null; S.end = null;
  say('#rangeStatus', '接地した瞬間（靴底が地面に触れた最初のフレーム）と、離地した瞬間を指定してください。');
}
// finds the shoe and the stickers in frame i (no UI changes)
async function detectAt(i, keep) {
  const cur = await grab(i);
  if (keep) {
    // re-detection during the analysis: the toe direction and the shoe's extent were already confirmed on the
    // detection frame (the shoe is planted while on the ground), so they are kept. Something else moving in the
    // background, such as the other foot, then cannot flip heel and toe.
    return { cur, det: null, ms: C.markerStations(cur, { box: keep.box, toeRight: keep.toeRight, lockToe: true }) };
  }
  const prev = i >= 3 ? await grab(i - 3) : null;
  const samples = [];
  for (let k = 0; k < 9; k++) samples.push(await grab(Math.round(k * (S.N - 1) / 8)));
  const det = C.autoDetect(cur, samples, prev);
  return { cur, det, ms: C.markerStations(cur, det) };
}
async function detect() {
  if (!S.loaded || S.busy) return;
  S.busy = true; video.pause(); updateUI();
  const i = curIdx();
  say('#detectStatus', '検出中…');
  try {
    const { cur, det, ms } = await detectAt(i);
    await seekTo(i);
    S.busy = false; S.autoMark = false;
    if (ms) {
      S.box = ms.box; S.toeRight = ms.toeRight; S.mark = i; S.stations = ms.stations; S.autoMark = true;
      defaultRange();
      const n = ms.stations.markers.used.filter(Boolean).length;
      onStationsChanged(`赤いシールを${ms.stations.markers.found.length}か所見つけ、シールのすぐ横で、アッパーとの境目から靴底までを測る位置に合わせました（つま先は${S.toeRight ? '右' : '左'}向き）。${n < 3 ? '見つからなかった部位は、靴の長さの割合で置いています。' : ''}靴底の線が地面との境目に合っているか確認してください。`);
      return;
    }
    if (!det) { say('#detectStatus', '靴を見つけられませんでした。動画の上でミッドソールを囲むようにドラッグしてください。', 'warn'); updateUI(); drawAll(); return; }
    S.box = det.box; S.toeRight = det.toeRight; S.mark = i;
    S.stations = C.placeStations(cur, det.box, det.toeRight);
    defaultRange();
    const clipMsg = det.clipped ? `靴の${det.clipped === 'left' ? '左' : '右'}端が画面の外にかかっているため、測定位置がずれることがあります。靴全体が写るフレームで検出し直すと正確になります。` : '';
    onStationsChanged(`検出しました（つま先は${S.toeRight ? '右' : '左'}向き）。${markerMsg(S.stations)}${clipMsg || '点の位置が境目に合っているか確認してください。'}`, !!det.clipped);
  } catch (e) {
    S.busy = false; say('#detectStatus', `検出に失敗しました：${e.message}`, 'warn'); updateUI();
  }
}
function flip() {
  if (!S.stations) return;
  S.toeRight = !S.toeRight; S.autoMark = false;
  S.stations = S.stations.slice().reverse();
  onStationsChanged(`つま先を${S.toeRight ? '右' : '左'}向きにしました。`);
}

// ---------- analysis ----------
async function analyze() {
  if (!S.stations || S.busy) return;
  S.busy = true; video.pause(); S.A = null; updateUI();
  const fw = [], bw = [];
  for (let i = S.mark; i <= S.end; i++) fw.push(i);
  for (let i = S.mark; i >= S.start; i--) bw.push(i);
  let done = 0;
  const prog = $('#prog'); prog.hidden = false; prog.value = 0;
  say('#runStatus', '解析中…');
  const t0 = performance.now();
  let remark = '';
  try {
    // The tracking templates and the measuring points come from the marked frame. A frame where the whole sole
    // is on the ground gives the clearest sole edge at all three places (at heel strike or toe-off part of the
    // sole is in the air, and its edge is easily confused with its shadow or the printed bands), so automatic
    // points are re-detected about a third of the way into contact. Points moved by hand are kept as they are.
    if (S.autoMark && S.start !== null && S.end !== null && S.end - S.start >= 6) {
      const tgt = S.start + Math.round(0.35 * (S.end - S.start));
      if (tgt !== S.mark) {
        say('#runStatus', '足裏全体が地面に着いているフレームで、測定点を合わせ直しています…');
        const r = await detectAt(tgt, { box: S.box, toeRight: S.toeRight });
        const nUsed = st => st && st.markers && st.markers.used ? st.markers.used.filter(Boolean).length : 0;
        if (r.ms && r.ms.toeRight === S.toeRight && nUsed(r.ms.stations) >= nUsed(S.stations)) {
          S.mark = tgt; S.stations = r.ms.stations; S.box = r.ms.box; S.toeRight = r.ms.toeRight;
          remark = `測定点は、足裏全体が地面に着いている f${tgt + 1} で合わせ直しました。`;
          fw.length = 0; bw.length = 0;
          for (let i = S.mark; i <= S.end; i++) fw.push(i);
          for (let i = S.mark; i >= S.start; i--) bw.push(i);
        }
        say('#runStatus', '解析中…');
      }
    }
    const markFrame = await grab(S.mark);
    const run = async (order) => {
      const tr = new C.Tracker(markFrame, S.stations);
      for (const i of order.slice(1)) {
        const f = await grab(i); tr.step(f); done++;
        prog.value = done / Math.max(1, fw.length + bw.length - 2);
        say('#stageNote', `解析中 f${i + 1}`);
      }
      return tr;
    };
    const tf = await run(fw);
    const tb = bw.length > 1 ? await run(bw) : null;
    const halves = [[tf, fw], [tb, bw]].filter(x => x[0]).map(([tr, order]) => ({
      order,
      local: tr.frames.map(f => f.local),
      profiles: tr.meta.map((m, k) => tr.frames.map(f => f.profiles[k])),
      scores: tr.meta.map((m, k) => C.scoreStation(tr.frames.map(f => f.profiles[k]), m, m.an == null ? null : tr.frames.map(f => f.aprofiles[k]))),
      cons: tr.meta.map(() => new Map()),
      res: null
    }));
    const A = { meta: tf.meta, halves, first: S.start, last: S.end, base: S.start, timeline: new Map(), hb: [], peak: [], td: [], heelOff: null, heelOffAuto: true };
    halves.forEach((H, hi) => H.order.forEach((fi, j) => { if (!A.timeline.has(fi)) A.timeline.set(fi, { hi, j }); }));
    S.A = A;
    solveAll(); buildKymos(); afterSolve();
    const lost = tf.frames.concat(tb ? tb.frames : []).filter(f => f.nInliers < 4).length;
    const q = qualityOf(A), qLow = q.some(v => v < 0.8);
    say('#runStatus', `完了しました（${A.timeline.size}フレーム、${((performance.now() - t0) / 1000).toFixed(1)}秒）。${remark}品質（有効フレームの割合）：${ZONE_NAMES.map((z, k) => `${z} ${Math.round(q[k] * 100)}%`).join('・')}。${lost ? `靴全体の追跡が不安定なフレームが${lost}あります。` : ''}${qLow ? '80%未満の部位があるため、相性スコアは保留になることがあります。' : ''}`, (lost || qLow) ? 'warn' : 'ok');
    say('#stageNote', '');
    await seekTo(0);
  } catch (e) {
    S.A = null; say('#runStatus', `解析に失敗しました：${e.message}`, 'warn');
  }
  prog.hidden = true; S.busy = false; updateUI(); drawAll();
}
// sticker-anchored stations measure from the sticker to the sole, marked on a frame where the whole sole is on
// the ground: from there a real midsole never loses more than about a quarter, so thinner solutions are the
// edges of printed bands, not the sole edge
function solveParams() { return { lamThick: S.lam, mMinFrac: S.stations && S.stations.markers && S.stations.markers.anchored ? 0.72 : 0.42 }; }
function solveAll() {
  const A = S.A; if (!A) return;
  A.halves.forEach(H => { H.res = A.meta.map((m, k) => C.solveStation(H.scores[k], m, solveParams(), H.cons[k])); });
}
function resAt(k, fi) { const e = S.A && S.A.timeline.get(fi); return e ? S.A.halves[e.hi].res[k][e.j] : null; }
function compRaw(k, fi) { const r = resAt(k, fi); return r && r.valid ? 1 - r.h / S.A.hb[k] : null; }
function heelZero(k, fi) { return k === 0 && !!S.A && S.A.heelOff !== null && fi >= S.A.heelOff && fi <= S.A.last; }
// before a part of the sole has touched the ground it carries no load: its compression is zero there
function preTouch(k, fi) { const t = S.A && S.A.td ? S.A.td[k] : null; return t != null && fi >= S.A.first && fi < t; }
function compAt(k, fi) { if (heelZero(k, fi) || preTouch(k, fi)) return 0; const v = compRaw(k, fi); return v === null ? null : Math.max(0, v); }
// The frame where this part of the sole comes down onto the floor. At heel strike the midfoot and forefoot are
// still in the air, and there their lower edge cannot be told reliably from the shadow or the printed bands.
// So each part is referenced to its own touchdown: the first frame from which its lower edge stays on the floor
// line (the lowest place the edge reaches) with a plausible thickness.
function touchdownOf(k) {
  const A = S.A, fr = [];
  for (let fi = A.first; fi <= A.last; fi++) { const g = A.timeline.has(fi) ? stationGeom(k, fi) : null; if (g && g.r && g.r.valid) fr.push({ fi, y: g.bot[1], h: g.r.h }); }
  if (fr.length < 5) return null;
  const ys = fr.map(o => o.y).sort((a, b) => a - b), floorY = ys[Math.floor(0.8 * (ys.length - 1))];
  const tol = Math.max(2.5, 0.04 * A.meta[k].h0);
  const near = fr.filter(o => o.y >= floorY - tol);
  if (near.length < 3) return null;
  const hs = near.map(o => o.h).sort((a, b) => a - b), medH = hs[Math.floor(hs.length / 2)];
  const on = new Map(fr.map(o => [o.fi, o.y >= floorY - tol && o.h <= 1.3 * medH && o.h >= 0.6 * medH]));
  for (let fi = A.first; fi <= A.last; fi++) {
    if (!on.get(fi)) continue;
    let n = 0; for (let q = fi; q <= Math.min(A.last, fi + 3); q++) if (on.get(q)) n++;
    if (n >= 3) return k === 0 || fi - A.first <= 2 ? A.first : fi;
  }
  return null;
}
function afterSolve() {
  const A = S.A;
  A.td = A.meta.map((m, k) => touchdownOf(k));
  A.hb = A.meta.map((m, k) => {
    const ref = A.td[k] != null ? A.td[k] : A.base;
    let best = null, bd = Infinity;
    for (const fi of A.timeline.keys()) { const r = resAt(k, fi); if (r && r.valid && Math.abs(fi - ref) < bd) { bd = Math.abs(fi - ref); best = r.h; } }
    return best || m.h0;
  });
  A.heelOff = A.first + Math.round(0.7 * (A.last - A.first));
  // the heel leaves the ground earlier on rocker soles: once the heel's top point has risen clearly above
  // where it sat at contact, what follows is the heel lifting, not compression
  {
    const g0 = stationGeom(0, A.base);
    if (g0) {
      const lift = 0.12 * A.meta[0].h0 * g0.s;
      for (let fi = A.base + 1; fi < A.heelOff; fi++) { const g = stationGeom(0, fi); if (g && g0.top[1] - g.top[1] > lift) { A.heelOff = fi; break; } }
    }
  }
  // the peak is read from a 3-frame median, so a single mis-tracked frame cannot set it
  A.peak = A.meta.map((m, k) => {
    let pk = null;
    for (let fi = A.first; fi <= A.last; fi++) {
      const v = compAt(k, fi); if (v === null) continue;
      const nb = [compAt(k, fi - 1), v, compAt(k, fi + 1)].filter(x => x !== null && x !== undefined && fi >= A.first);
      const sm = nb.length === 3 ? nb.sort((a, b) => a - b)[1] : v;
      if (!pk || sm > pk.v) pk = { v: sm, fi };
    }
    return pk;
  });
  const tdTxt = A.td.map((t, k) => `${ZONE_NAMES[k]} f${(t != null ? t : A.base) + 1}`).join('・');
  say('#baseStatus', `無負荷の基準は、各部位が地面に着いた瞬間です（${tdTxt}）。`);
  drawAll();
}
function stationGeom(k, fi) {
  const e = S.A.timeline.get(fi); if (!e) return null;
  const H = S.A.halves[e.hi], m = S.A.meta[k], M = H.local[e.j][k], s = C.scaleOf(M), c = C.apply(M, m.T);
  const ca = M.a / s, sb = M.b / s, d = [ca * m.d0[0] - sb * m.d0[1], sb * m.d0[0] + ca * m.d0[1]];
  const r = H.res[k][e.j];
  return { e, H, m, s, c, d, r, top: [c[0] + d[0] * r.uTop * s, c[1] + d[1] * r.uTop * s], bot: [c[0] + d[0] * r.uBot * s, c[1] + d[1] * r.uBot * s] };
}
function applyConstraint(d) {
  const g = stationGeom(d.k, d.fi); if (!g) return;
  const u = ((d.p[0] - g.c[0]) * g.d[0] + (d.p[1] - g.c[1]) * g.d[1]) / g.s;
  const j = Math.round((u - g.m.uMin) / g.m.step);
  let jt = g.r.jt, jb = g.r.jt + g.r.m;
  if (d.which === 'top') jt = j; else jb = j;
  if (jb - jt < 3) return;
  g.H.cons[d.k].set(g.e.j, { jt, m: jb - jt });
  g.H.res[d.k] = C.solveStation(g.H.scores[d.k], g.m, solveParams(), g.H.cons[d.k]);
  afterSolve();
  say('#runStatus', `${NAMES[d.k]}の f${d.fi + 1} を補正して追跡をやり直しました。`, 'ok');
}
function buildKymos() {
  const A = S.A, nF = A.last - A.first + 1;
  S.kymo = A.meta.map((m, k) => {
    const cv = document.createElement('canvas'); cv.width = nF; cv.height = m.count;
    const cx = cv.getContext('2d'), img = cx.createImageData(nF, m.count);
    for (let fi = A.first; fi <= A.last; fi++) {
      const e = A.timeline.get(fi); if (!e) continue;
      const P = A.halves[e.hi].profiles[k][e.j], x = fi - A.first;
      for (let j = 0; j < m.count; j++) { const o = (j * nF + x) * 4; img.data[o] = P[j * 3]; img.data[o + 1] = P[j * 3 + 1]; img.data[o + 2] = P[j * 3 + 2]; img.data[o + 3] = 255; }
    }
    cx.putImageData(img, 0, 0);
    return cv;
  });
}

// ---------- drawing ----------
function sizeCanvas(cv, ctx) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return [w, h];
}
function dispRect() {
  const cw = overlay.clientWidth, ch = overlay.clientHeight, ks = Math.min(cw / S.vw, ch / S.vh);
  return { K: ks * S.vw / S.aw, ox: (cw - S.vw * ks) / 2, oy: (ch - S.vh * ks) / 2 };
}
const toD = (r, p) => [r.ox + p[0] * r.K, r.oy + p[1] * r.K];
const toA = (r, x, y) => [(x - r.ox) / r.K, (y - r.oy) / r.K];
function seg(ctx, a, b, col, w, dash) {
  ctx.save(); ctx.lineCap = 'round'; ctx.setLineDash(dash || []);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = w + 3; ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); ctx.restore();
}
function dot(ctx, p, col, r) { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.stroke(); }
function tag(ctx, p, text, col) {
  ctx.save(); ctx.font = '600 16px "Barlow Condensed","IBM Plex Sans JP",sans-serif';
  const w = ctx.measureText(text).width + 12, x = p[0] - w / 2, y = p[1] - 32;
  ctx.fillStyle = 'rgba(10,14,18,.8)'; ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, 22, 5); else ctx.rect(x, y, w, 22);
  ctx.fill(); ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 6, y + 11.5); ctx.restore();
}
function drawOverlay() {
  const [cw, ch] = sizeCanvas(overlay, octx);
  if (!S.loaded) return;
  const r = dispRect(), fi = curIdx();
  if (S.scale.p0) { const a = toD(r, S.scale.p0), b = S.scale.p1 ? toD(r, S.scale.p1) : a; octx.save(); octx.setLineDash([4, 3]); octx.strokeStyle = '#fff'; octx.lineWidth = 1.5; octx.beginPath(); octx.moveTo(a[0], a[1]); octx.lineTo(b[0], b[1]); octx.stroke(); octx.setLineDash([]); octx.fillStyle = '#fff'; [a, b].forEach(q => { octx.beginPath(); octx.arc(q[0], q[1], 4, 0, Math.PI * 2); octx.fill(); }); octx.restore(); }
  if (S.A) {
    if (!S.A.timeline.has(fi)) return;
    for (let k = 0; k < 3; k++) {
      const g = stationGeom(k, fi);
      let a = toD(r, g.top), b = toD(r, g.bot);
      if (S.drag && S.drag.kind === 'cons' && S.drag.k === k) { if (S.drag.which === 'top') a = toD(r, S.drag.p); else b = toD(r, S.drag.p); }
      const v = compAt(k, fi), pre = preTouch(k, fi);
      // before this part of the sole touches down it is not measured: drawn faint so its line is not read as a result
      if (pre) octx.globalAlpha = 0.35;
      seg(octx, a, b, v === null || pre ? 'rgba(205,210,215,.85)' : colors[k], 3, v === null || pre ? [5, 5] : null);
      if (video.paused) { dot(octx, a, colors[k], 5); dot(octx, b, colors[k], 5); }
      if (g.r.constrained) { octx.save(); octx.strokeStyle = '#fff'; octx.lineWidth = 1.5; octx.beginPath(); octx.arc(b[0], b[1], 9, 0, Math.PI * 2); octx.stroke(); octx.restore(); }
      octx.globalAlpha = 1;
      tag(octx, a, pre ? `${NAMES[k]} 接地前` : v === null ? `${NAMES[k]} —` : `${(v * 100).toFixed(1)}%`, colors[k]);
    }
  } else if (S.stations) {
    const editable = fi === S.mark;
    octx.globalAlpha = editable ? 1 : 0.4;
    if (editable && S.stations.markers) S.stations.markers.found.forEach(c => c.ys.forEach(y => { const q = toD(r, [c.x, y]); octx.save(); octx.setLineDash([3, 3]); octx.strokeStyle = '#fff'; octx.lineWidth = 1.5; octx.beginPath(); octx.arc(q[0], q[1], c.r * r.K + 5, 0, Math.PI * 2); octx.stroke(); octx.restore(); }));
    S.stations.forEach((st, k) => {
      const a = toD(r, st.top), b = toD(r, st.bot);
      seg(octx, a, b, colors[k], 2.5);
      if (editable) { dot(octx, a, colors[k], 6); dot(octx, b, colors[k], 6); }
      tag(octx, a, NAMES[k], colors[k]);
    });
    octx.globalAlpha = 1;
  }
  if (S.drag && S.drag.kind === 'box') {
    const a = toD(r, S.drag.p0), b = toD(r, S.drag.p1);
    octx.save(); octx.setLineDash([6, 4]); octx.strokeStyle = '#fff'; octx.lineWidth = 1.5;
    octx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); octx.restore();
  }
}
function drawReadouts() {
  const fi = curIdx();
  gauges.forEach((el, k) => {
    const v = S.A ? compAt(k, fi) : null, r = S.A ? resAt(k, fi) : null;
    el.querySelector('.g-val').firstChild.nodeValue = v === null ? '—' : (v * 100).toFixed(1);
    el.style.setProperty('--sq', v === null ? 1 : clamp(1 - v, 0.45, 1.12).toFixed(3));
    let sub = '解析前';
    if (S.A) {
      const pk = S.A.peak[k];
      sub = pk ? `最大 ${(pk.v * 100).toFixed(1)}%（f${pk.fi + 1}）` : '測定できたフレームがありません';
      if (preTouch(k, fi)) sub += '\nこの部位はまだ地面に着いていません';
      else if (r && !heelZero(k, fi)) sub += r.valid ? `\n厚み ${(r.h).toFixed(1)} px` : (S.A.timeline.has(fi) ? (r.inFrame ? '\nこのフレームは追跡不良' : '\nこのフレームは画面外') : '');
    }
    el.querySelector('.g-sub').textContent = sub;
    el.querySelector('.g-sub').style.whiteSpace = 'pre-line';
  });
}
function niceStep(range, target) { const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; }
function drawChart() {
  const [w, h] = sizeCanvas(chart, cctx);
  cctx.font = '12px "IBM Plex Sans JP",system-ui,sans-serif';
  if (!S.A) {
    cctx.fillStyle = css['--muted']; cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
    cctx.fillText('解析するとここに圧縮率の推移が表示されます', w / 2, h / 2); return;
  }
  const A = S.A, f0 = A.first, f1 = Math.max(A.last, f0 + 1), pad = { l: 46, r: 12, t: 12, b: 30 };
  let ymax = 20, ymin = 0;
  for (let k = 0; k < 3; k++) for (const fi of A.timeline.keys()) { const v = compAt(k, fi); if (v !== null) { ymax = Math.max(ymax, v * 100 + 4); } }
  const ys = ymax - ymin > 45 ? 10 : 5; ymax = Math.ceil(ymax / ys) * ys; ymin = Math.floor(ymin / ys) * ys;
  const X = fi => pad.l + (fi - f0) / (f1 - f0) * (w - pad.l - pad.r), Y = v => pad.t + (ymax - v) / (ymax - ymin) * (h - pad.t - pad.b);
  S.chartMap = { f0, f1, pad, w };
  cctx.textAlign = 'right'; cctx.textBaseline = 'middle';
  for (let v = ymin; v <= ymax + 1e-6; v += ys) {
    cctx.strokeStyle = css['--line']; cctx.lineWidth = v === 0 ? 1.4 : 0.8; cctx.globalAlpha = v === 0 ? 1 : 0.7;
    cctx.beginPath(); cctx.moveTo(pad.l, Y(v)); cctx.lineTo(w - pad.r, Y(v)); cctx.stroke(); cctx.globalAlpha = 1;
    cctx.fillStyle = css['--muted']; cctx.fillText(`${v}%`, pad.l - 6, Y(v));
  }
  cctx.textAlign = 'center'; cctx.textBaseline = 'top';
  const st = Math.max(1, niceStep(f1 - f0, 7));
  for (let fi = Math.ceil(f0 / st) * st; fi <= f1; fi += st) {
    const label = S.capFps ? `${Math.round((fi - A.base) / S.capFps * 1000)} ms` : `f${fi + 1}`;
    cctx.fillStyle = css['--muted']; cctx.fillText(label, X(fi), h - pad.b + 8);
  }
  // baseline
  cctx.save(); cctx.setLineDash([4, 4]); cctx.strokeStyle = css['--muted']; cctx.lineWidth = 1;
  cctx.beginPath(); cctx.moveTo(X(A.base), pad.t); cctx.lineTo(X(A.base), h - pad.b); cctx.stroke(); cctx.restore();
  for (let k = 0; k < 3; k++) {
    cctx.strokeStyle = colors[k]; cctx.lineWidth = 2; cctx.lineJoin = 'round'; cctx.beginPath();
    let pen = false;
    for (let fi = f0; fi <= A.last; fi++) { const v = compAt(k, fi); if (v === null) { pen = false; continue; } const x = X(fi), y = Y(v * 100); if (pen) cctx.lineTo(x, y); else cctx.moveTo(x, y); pen = true; }
    cctx.stroke();
    const pk = A.peak[k];
    if (pk) { cctx.beginPath(); cctx.arc(X(pk.fi), Y(pk.v * 100), 3.5, 0, Math.PI * 2); cctx.fillStyle = colors[k]; cctx.fill(); }
    A.halves.forEach(H => H.cons[k].forEach((c, j) => { const fi = H.order[j], v = compAt(k, fi); if (v === null) return; cctx.beginPath(); cctx.arc(X(fi), Y(v * 100), 5, 0, Math.PI * 2); cctx.strokeStyle = colors[k]; cctx.lineWidth = 1.5; cctx.stroke(); }));
  }
  const fi = curIdx();
  if (fi >= f0 && fi <= A.last) { cctx.strokeStyle = css['--ink']; cctx.globalAlpha = 0.6; cctx.lineWidth = 1; cctx.beginPath(); cctx.moveTo(X(fi), pad.t); cctx.lineTo(X(fi), h - pad.b); cctx.stroke(); cctx.globalAlpha = 1; }
}
function drawKymos() {
  kymoCanvases.forEach((cv, k) => {
    const ctx = cv.getContext('2d'), [w, h] = sizeCanvas(cv, ctx);
    if (!S.A || !S.kymo[k]) return;
    const A = S.A, m = A.meta[k], nF = A.last - A.first + 1, sx = w / nF, sy = h / m.count;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(S.kymo[k], 0, 0, w, h);
    for (const key of ['uTop', 'uBot']) {
      ctx.beginPath(); let pen = false;
      for (let fi = A.first; fi <= A.last; fi++) {
        const r = resAt(k, fi); if (!r) { pen = false; continue; }
        const x = (fi - A.first + 0.5) * sx, y = ((r[key] - m.uMin) / m.step + 0.5) * sy;
        if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = true;
      }
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = colors[k]; ctx.lineWidth = 1.5; ctx.stroke();
    }
    const fi = curIdx();
    if (fi >= A.first && fi <= A.last) { const x = (fi - A.first + 0.5) * sx; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  });
}
function drawLabels() {
  if (!S.loaded) { $('#frameLabel').innerHTML = 'f —'; return; }
  const fi = curIdx();
  let extra = `${video.currentTime.toFixed(2)} 秒`;
  if (S.A && S.capFps) extra += `　実時間 ${((fi - S.A.base) / S.capFps * 1000).toFixed(1)} ms`;
  $('#frameLabel').innerHTML = `f${fi + 1} / ${S.N}<small>${extra}</small>`;
  if (!scrubbing) $('#scrub').value = fi;
  if (!S.busy) {
    let note = '';
    if (S.A && !S.A.timeline.has(fi)) note = '解析範囲の外のフレームです。';
    else if (!S.A && S.stations && fi !== S.mark) note = `測定点はマークしたフレーム f${S.mark + 1} で編集できます。`;
    else if (!S.A && !S.stations) note = '靴がはっきり写るフレームまで進めて、「このフレームで自動検出」を押してください。';
    say('#stageNote', note);
  }
  $('#rStart').textContent = S.start === null ? '—' : `f${S.start + 1}`;
  $('#rMark').textContent = S.mark === null ? '—' : `f${S.mark + 1}`;
  $('#rEnd').textContent = S.end === null ? '—' : `f${S.end + 1}`;
}
function drawAll() { drawOverlay(); drawReadouts(); drawChart(); drawKymos(); drawLabels(); }
function updateUI() {
  const L = S.loaded && !S.busy, St = !!S.stations && !S.busy, A = !!S.A && !S.busy;
  ['#prev', '#play', '#next', '#scrub'].forEach(s => { $(s).disabled = !S.loaded || S.busy; });
  $('#detect').disabled = !L; $('#flip').disabled = !St || !!S.A;
  $('#setStart').disabled = !St; $('#setEnd').disabled = !St; $('#run').disabled = !St || S.start === null || S.end === null;
  ['#clearCons', '#csv', '#rangeOnly'].forEach(s => { $(s).disabled = !A; });
  $('#pick').disabled = S.busy; $('#scalePick').disabled = !S.loaded || S.busy;
  const state = (done, active) => done ? 'done' : (active ? 'active' : '');
  $('#s1').dataset.state = state(S.loaded, true);
  $('#s2').dataset.state = state(!!S.stations, S.loaded);
  $('#s3').dataset.state = state(!!S.stations && S.start !== null && S.end !== null, !!S.stations);
  $('#s4').dataset.state = state(!!S.A, !!S.stations);
  $('#s5').dataset.state = state(false, !!S.A);
  window.dispatchEvent(new Event('msa:update'));
}

// ---------- events ----------
let playLoopOn = false, scrubbing = false;
function rangeOnly() { return !!S.A && $('#rangeOnly').checked; }
function playLoop() {
  if (rangeOnly() && !video.paused && curIdx() >= S.A.last) { video.pause(); seekTo(S.A.last); }
  drawAll();
  if (!video.paused && !video.ended) {
    if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(playLoop); else requestAnimationFrame(playLoop);
  } else playLoopOn = false;
}
video.addEventListener('play', () => { $('#playIcon').innerHTML = '<path d="M3 2h4v12H3zM9 2h4v12H9z"/>'; $('#play').setAttribute('aria-label', '一時停止'); if (!playLoopOn) { playLoopOn = true; playLoop(); } });
video.addEventListener('pause', () => { $('#playIcon').innerHTML = '<path d="M4 2l10 6-10 6z"/>'; $('#play').setAttribute('aria-label', '再生'); drawAll(); });
video.addEventListener('seeked', () => { if (!S.busy) drawAll(); else drawLabels(); });
$('#play').addEventListener('click', () => {
  if (!S.loaded) return;
  if (video.paused) {
    const i = curIdx();
    if (rangeOnly() && (i < S.A.first || i >= S.A.last)) seekTo(S.A.first).then(() => video.play());
    else if (!rangeOnly() && (video.ended || i >= S.N - 1)) seekTo(0).then(() => video.play());
    else video.play();
  } else video.pause();
});
const step = d => { if (!S.loaded || S.busy) return; video.pause(); seekTo(clamp(curIdx() + d, 0, S.N - 1)); };
$('#prev').addEventListener('click', () => step(-1));
$('#next').addEventListener('click', () => step(1));
$('#scrub').addEventListener('input', e => { scrubbing = true; video.pause(); seekTo(+e.target.value).then(() => { scrubbing = false; drawAll(); }); });
$('#scrub').addEventListener('change', () => { scrubbing = false; });
$('#rate').addEventListener('change', e => { video.playbackRate = +e.target.value; });
$('#rangeOnly').addEventListener('change', e => {
  if (e.target.checked && S.A) { const i = curIdx(); if (i < S.A.first || i > S.A.last) { video.pause(); seekTo(S.A.first); } }
});
document.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === ' ' && S.loaded) { e.preventDefault(); $('#play').click(); }
});
$('#pick').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; loadFile(f); e.target.value = ''; });
const stage = $('#stage'), drop = $('#drop');
stage.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
stage.addEventListener('dragleave', () => drop.classList.remove('over'));
stage.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
$('#fps').addEventListener('change', e => {
  const v = +e.target.value; if (!(v > 0)) return;
  S.fps = v;
  if (S.loaded) {
    S.N = Math.max(1, Math.floor(video.duration * S.fps + 1e-6)); $('#scrub').max = S.N - 1;
    if (S.stations || S.A) { S.stations = null; S.A = null; S.mark = S.start = S.end = null; say('#detectStatus', 'fpsを変えたので、測定点を指定し直してください。', 'warn'); }
  }
  updateUI(); drawAll();
});
$('#detect').addEventListener('click', detect);
$('#flip').addEventListener('click', flip);
function rangeMsg() {
  if (S.start === null || S.end === null) { say('#rangeStatus', '接地した瞬間と離地した瞬間を両方指定すると解析できます。'); return; }
  const n = S.end - S.start, ms = S.capFps ? `（${(n / S.capFps * 1000).toFixed(0)} ms）` : '';
  say('#rangeStatus', `接地時間 ${n}フレーム${ms}。接地の瞬間（f${S.start + 1}）を無負荷の基準にします。`, 'ok');
}
$('#setStart').addEventListener('click', () => {
  const i = curIdx();
  if (S.mark !== null && i > S.mark) { say('#rangeStatus', `接地はマークしたフレーム（f${S.mark + 1}）以前にしてください。`, 'warn'); return; }
  if (S.end !== null && i >= S.end) { say('#rangeStatus', '接地は離地より前にしてください。', 'warn'); return; }
  S.start = i; S.A = null; rangeMsg(); updateUI(); drawAll();
});
$('#setEnd').addEventListener('click', () => {
  const i = curIdx();
  if (S.mark !== null && i < S.mark) { say('#rangeStatus', `離地はマークしたフレーム（f${S.mark + 1}）以降にしてください。`, 'warn'); return; }
  if (S.start !== null && i <= S.start) { say('#rangeStatus', '離地は接地より後にしてください。', 'warn'); return; }
  S.end = i; S.A = null; rangeMsg(); updateUI(); drawAll();
});
$('#run').addEventListener('click', analyze);
$('#capfps').addEventListener('input', e => { S.capFps = +e.target.value > 0 ? +e.target.value : 0; drawAll(); });
$('#clearCons').addEventListener('click', () => { if (!S.A) return; S.A.halves.forEach(H => H.cons.forEach(c => c.clear())); solveAll(); afterSolve(); say('#runStatus', '手動の補正を消しました。'); });
function scaleMsg() {
  const sc = S.scale;
  if (sc.px && sc.mm) say('#scaleStatus', `${sc.mm} mm = ${sc.px.toFixed(1)} px（1 px ≒ ${(sc.mm / sc.px).toFixed(3)} mm）。次の解析から厚さをmmでも記録します。`, 'ok');
  else if (sc.px) say('#scaleStatus', `目印の長さは ${sc.px.toFixed(1)} px です。長さ（mm）を入れてください。`);
}
$('#scalePick').addEventListener('click', () => { if (!S.loaded) return; video.pause(); S.scale.picking = 1; S.scale.p0 = S.scale.p1 = null; S.scale.px = null; say('#scaleStatus', '目印の一方の端をクリックしてください。'); drawOverlay(); });
$('#scaleMm').addEventListener('input', e => { S.scale.mm = +e.target.value > 0 ? +e.target.value : null; scaleMsg(); });
function buildCSV() {
  const A = S.A, head = ['frame', 'time_s'];
  if (S.capFps) head.push('real_ms_from_baseline');
  ['heel', 'mid', 'fore'].forEach(n => head.push(`${n}_thickness_px`, `${n}_compression_pct`, `${n}_valid`));
  head.push('heel_zero_fixed');
  const rows = [head.join(',')];
  for (let fi = A.first; fi <= A.last; fi++) {
    if (!A.timeline.has(fi)) continue;
    const row = [fi + 1, (fi / S.fps).toFixed(4)];
    if (S.capFps) row.push(((fi - A.base) / S.capFps * 1000).toFixed(2));
    for (let k = 0; k < 3; k++) { const r = resAt(k, fi), v = compRaw(k, fi); row.push(r.h.toFixed(2), v === null ? '' : (v * 100).toFixed(2), r.valid ? 1 : 0); }
    row.push(heelZero(0, fi) ? 1 : 0);
    rows.push(row.join(','));
  }
  rows.push(`# baseline_frame=${A.base + 1}, touchdown_frames=${(A.td || []).map(t => t == null ? '' : t + 1).join('/')}, mark_frame=${S.mark + 1}, video_fps=${S.fps}, heel_zero_from_frame=${A.heelOff === null ? '' : A.heelOff + 1}`);
  return rows.join('\n') + '\n';
}
$('#csv').addEventListener('click', async () => {
  if (!S.A) return;
  const text = buildCSV(), filename = `${S.name}_midsole_compression.csv`;
  if (!window.claude) {
    // standalone (local file or GitHub Pages): a normal browser download
    try {
      const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
      say('#csvStatus', 'CSVを保存しました。', 'ok'); return;
    } catch (e) {}
  }
  const dl = await downloadsP;
  if (dl) {
    try { await dl.save({ filename, data: text }); say('#csvStatus', 'CSVを保存しました。', 'ok'); return; }
    catch (e) { if (e && e.code === 'declined') { say('#csvStatus', '保存を取り消しました。'); return; } if (e && e.code === 'rate_limited') { say('#csvStatus', '少し待ってからもう一度押してください。', 'warn'); return; } }
  }
  try { await navigator.clipboard.writeText(text); say('#csvStatus', 'この画面ではファイルを保存できないため、CSVをクリップボードにコピーしました。', 'ok'); }
  catch (e) { const box = $('#csvBox'); box.hidden = false; box.value = text; box.select(); say('#csvStatus', '下の欄のCSVをコピーしてください。'); }
});
// pointer editing on the video
function evPoint(ev) { const r = dispRect(), b = overlay.getBoundingClientRect(); return { r, p: toA(r, ev.clientX - b.left, ev.clientY - b.top) }; }
overlay.addEventListener('pointerdown', ev => {
  if (!S.loaded || S.busy) return;
  if (S.scale.picking) {
    const { p } = evPoint(ev);
    if (S.scale.picking === 1) { S.scale.p0 = p; S.scale.p1 = null; S.scale.picking = 2; say('#scaleStatus', 'もう一方の端をクリックしてください。'); }
    else { S.scale.p1 = p; S.scale.picking = 0; S.scale.px = Math.hypot(p[0] - S.scale.p0[0], p[1] - S.scale.p0[1]); scaleMsg(); }
    drawOverlay(); return;
  }
  const { r, p } = evPoint(ev), fi = curIdx(), hit = 18 / r.K;
  const near = q => Math.hypot(q[0] - p[0], q[1] - p[1]) < hit;
  if (S.A) {
    if (!S.A.timeline.has(fi) || !video.paused) return;
    for (let k = 0; k < 3; k++) {
      const g = stationGeom(k, fi);
      for (const which of ['top', 'bot']) if (near(g[which])) {
        if (g.e.j === 0) { say('#runStatus', 'マークしたフレームは追跡の基準なので、ここでは補正できません。', 'warn'); return; }
        S.drag = { kind: 'cons', k, which, p, fi }; overlay.setPointerCapture(ev.pointerId); drawOverlay(); return;
      }
    }
    return;
  }
  video.pause();
  if (S.stations && fi === S.mark) {
    for (let k = 0; k < 3; k++) for (const which of ['top', 'bot']) if (near(S.stations[k][which])) { S.drag = { kind: 'pt', k, which }; overlay.setPointerCapture(ev.pointerId); return; }
  }
  S.drag = { kind: 'box', p0: p, p1: p }; overlay.setPointerCapture(ev.pointerId);
});
overlay.addEventListener('pointermove', ev => {
  if (!S.drag) return;
  const { p } = evPoint(ev);
  if (S.drag.kind === 'pt') { S.stations[S.drag.k][S.drag.which] = p; S.drag.moved = true; }
  else if (S.drag.kind === 'box') S.drag.p1 = p; else S.drag.p = p;
  drawOverlay();
});
overlay.addEventListener('pointerup', () => {
  const d = S.drag; S.drag = null; if (!d) return;
  if (d.kind === 'box') {
    const x0 = Math.min(d.p0[0], d.p1[0]), x1 = Math.max(d.p0[0], d.p1[0]), y0 = Math.min(d.p0[1], d.p1[1]), y1 = Math.max(d.p0[1], d.p1[1]);
    if (x1 - x0 > 24 && y1 - y0 > 6) {
      S.box = { x0, y0, x1, y1 }; S.mark = curIdx(); S.autoMark = false;
      S.stations = C.placeStations(grabNow(), S.box, S.toeRight); defaultRange();
      onStationsChanged(`枠の中でミッドソールの上端・下端に合わせました（つま先は${S.toeRight ? '右' : '左'}向き）。${markerMsg(S.stations)}`);
    }
  } else if (d.kind === 'pt') { if (d.moved) { S.autoMark = false; onStationsChanged('点を動かしました。'); } }
  else if (d.kind === 'cons' && d.p) applyConstraint(d);
  drawAll();
});
overlay.addEventListener('pointercancel', () => { S.drag = null; drawOverlay(); });
function seekFromX(x, f0, f1, l, w) { const fi = Math.round(f0 + (x - l) / (w) * (f1 - f0)); if (!S.busy) { video.pause(); seekTo(clamp(fi, 0, S.N - 1)); } }
let chartDrag = false, seekBusy = false, seekWant = null;
function seekLatest(fi) {
  seekWant = fi; if (seekBusy) return; seekBusy = true;
  (async () => { while (seekWant !== null) { const t = seekWant; seekWant = null; await seekTo(t); drawAll(); } seekBusy = false; })();
}
function chartFrame(ev) {
  const b = chart.getBoundingClientRect(), m = S.chartMap, w = m.w - m.pad.l - m.pad.r;
  return clamp(Math.round(m.f0 + (ev.clientX - b.left - m.pad.l) / w * (m.f1 - m.f0)), S.A.first, S.A.last);
}
chart.addEventListener('pointerdown', ev => {
  if (!S.A || !S.chartMap || S.busy) return;
  chartDrag = true; try { chart.setPointerCapture(ev.pointerId); } catch (e) {}
  video.pause(); seekLatest(chartFrame(ev));
});
chart.addEventListener('pointermove', ev => { if (chartDrag && S.A && !S.busy) seekLatest(chartFrame(ev)); });
const endChartDrag = () => { chartDrag = false; };
chart.addEventListener('pointerup', endChartDrag);
chart.addEventListener('pointercancel', endChartDrag);
kymoCanvases.forEach(cv => cv.addEventListener('pointerdown', ev => { if (!S.A) return; const b = cv.getBoundingClientRect(), nF = S.A.last - S.A.first + 1; const fi = S.A.first + Math.floor((ev.clientX - b.left) / b.width * nF); if (!S.busy) { video.pause(); seekTo(clamp(fi, 0, S.N - 1)); } }));
if (window.ResizeObserver) new ResizeObserver(() => drawAll()).observe(document.body); else window.addEventListener('resize', drawAll);
// ---------- API for the event (try-on) module ----------
async function saveText(filename, text) {
  if (!window.claude) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: /\.json$/.test(filename) ? 'application/json' : 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
      return 'ok';
    } catch (e) {}
  }
  const dl = await downloadsP;
  if (dl) {
    try { await dl.save({ filename, data: text }); return 'ok'; }
    catch (e) { if (e && e.code === 'declined') return 'declined'; if (e && e.code === 'rate_limited') return 'rate'; }
  }
  try { await navigator.clipboard.writeText(text); return 'clipboard'; } catch (e) { return 'fail'; }
}
function qualityOf(A) { return A.meta.map((m, k) => { let n = 0, ok = 0; for (let fi = A.first; fi <= A.last; fi++) { const r = resAt(k, fi); if (!r || heelZero(k, fi) || preTouch(k, fi)) continue; n++; if (r.valid) ok++; } return n ? ok / n : 0; }); }
function snapshot() {
  const A = S.A; if (!A || S.busy) return null;
  const frames = []; for (let fi = A.first; fi <= A.last; fi++) if (A.timeline.has(fi)) frames.push(fi);
  const pct = v => v === null ? null : +(v * 100).toFixed(2);
  return {
    video: S.name, baseAbs: A.base, fps: S.fps, capFps: S.capFps || 0, first: A.first - A.base, last: A.last - A.base, mark: S.mark - A.base,
    frames: frames.map(fi => fi - A.base),
    comp: [0, 1, 2].map(k => frames.map(fi => pct(compAt(k, fi)))),
    raw: [0, 1, 2].map(k => frames.map(fi => pct(compRaw(k, fi)))),
    thick: [0, 1, 2].map(k => frames.map(fi => { const r = resAt(k, fi); return r ? +r.h.toFixed(2) : null; })),
    peak: A.peak.map(p => p ? { v: +(p.v * 100).toFixed(2), f: p.fi - A.base } : null),
    vw: S.vw, vh: S.vh, quality: qualityOf(A).map(v => +v.toFixed(3)), h0: A.hb.map(v => +v.toFixed(2)), td: (A.td || []).map(t => t == null ? null : t - A.base),
    mmPerPx: S.scale && S.scale.mm && S.scale.px ? +(S.scale.mm / S.scale.px).toFixed(5) : null,
    savedAt: new Date().toISOString()
  };
}
window.MSA = { snapshot, saveText, hasResult: () => !!S.A && !S.busy };
updateUI(); drawAll();
})();
