// 体験会モード：事前入力、2足×複数歩の解析結果、距離ごとの適性度の推定（ミッドソール解析ベース）
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const MSA = window.MSA;
const KEY = 'msa-event-v1';
const ZONES = ['ヒール', 'ミッド', 'フォア'];
const DISTS = [['5K', 5], ['10K', 10], ['ハーフ', 21.0975], ['30K', 30], ['フル', 42.195]];
const A_W = [0.8, 0.7, 0.5, 0.35, 0.25];       // 距離ごとの活用の重み a
const PB_KEYS = ['5K', '10K', 'ハーフ', 'フル'];
const SAME = 3;            // 表示上「ほぼ同じ」とする差（ポイント）
const STEPS_GOAL = 5;
const ONSET = 3;           // 潰れ始め：荷重なしから3%以上
const STRIKE_LABEL = { rear: 'リア接地', mid: 'ミッド接地', fore: 'フォア接地' };
const WEIGHTS = { rear: [0.6, 0.1, 0.3], mid: [0.1, 0.5, 0.4], fore: [0, 0.2, 0.8] };

// ---------- data ----------
function defaultCfg() {
  return {
    cal: [1, 1, 1],                                                 // 校正係数（動画の圧縮率 → 試験機相当）
    bandA: { heel: [38, 59, 70], fore: [46, 57, 64] },             // [下限, 目安, 上限]（%）
    bandB: { heel: [31, 52, 65], fore: [48, 60, 69] },
    kA: { heel: 0.95, fore: 0.98 }, kB: { heel: 0.91, fore: 1.00 }, // 反発係数K（活用度にかける）
    pA: { heel: 1.00, fore: 0.82 }, pB: { heel: 1.00, fore: 1.00 }, // 保護係数P（余裕度にかける）
    refA: [35.9, 32.45, 29.0], refB: [39.2, 35.8, 32.4],            // 実測の厚さ（mm）
    paceFlag: '5:30', fastFull: '3:05', lowMileage: 150
  };
}
function blank() { return { shoes: ['マジックスピード5', 'YOGIRI SPEED'], capFps: 0, participants: [], currentId: null, activeShoe: 0, activePace: 'race', cfg: defaultCfg() }; }
function newParticipant(no) {
  return { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), no, name: `参加者${no}`, slot: '', consent: false,
    pb: { '5K': '', '10K': '', 'ハーフ': '', 'フル': '' }, race: { dist: '', time: '' }, weight: '', monthly: '', longest: '',
    size: '', highInstep: false, pronation: false, concern: '', results: [[], []], strikeManualBy: ['', ''], choice: '', reason: '', createdAt: new Date().toISOString() };
}
function migrate(p) {
  const q = Object.assign(newParticipant(p.no || 1), p);
  q.id = p.id || q.id;
  q.results = [0, 1].map(i => { const r = p.results && p.results[i]; return Array.isArray(r) ? r : (r ? [r] : []); });
  q.pb = Object.assign({ '5K': '', '10K': '', 'ハーフ': '', 'フル': '' }, p.pb || {});
  q.race = Object.assign({ dist: '', time: '' }, p.race || {});
  if (!Array.isArray(p.strikeManualBy)) { const m = { heel: 'rear', mid: 'mid', fore: 'fore' }[p.strikeManual] || ''; q.strikeManualBy = [m, m]; }
  if (p.usual && !p.usualRace) q.usualRace = p.usual;
  if (p.goal && !(p.concern || '').includes(p.goal)) q.concern = `目標：${p.goal}${p.concern ? '\n' + p.concern : ''}`;
  delete q.usual; delete q.goal; delete q.strikeManual;
  return q;
}
function mergeCfg(c) {
  const d = defaultCfg(); if (!c) return d;
  for (const k of Object.keys(d)) if (c[k] !== undefined) d[k] = (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) ? Object.assign(d[k], c[k]) : c[k];
  return d;
}
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Array.isArray(v.participants)) { const e = Object.assign(blank(), v); e.cfg = mergeCfg(v.cfg); e.participants = v.participants.map(migrate); return e; }
  } catch (e) {}
  return blank();
}
let E = load(), warned = false, persistTimer = null;
function persist(now) {
  clearTimeout(persistTimer);
  const doIt = () => { try { localStorage.setItem(KEY, JSON.stringify(E)); } catch (e) { if (!warned) { warned = true; say('#evDataStatus', 'このブラウザに保存できませんでした。こまめにバックアップを書き出してください。', 'warn'); } } };
  if (now) doIt(); else persistTimer = setTimeout(doIt, 300);
}
function say(sel, text, tone) { const el = $(sel); if (!el) return; el.textContent = text || ''; el.dataset.tone = tone || ''; }
const cur = () => E.participants.find(p => p.id === E.currentId) || null;
const shoeName = i => E.shoes[i] || (i ? 'シューズB' : 'シューズA');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const num = v => { const x = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return isFinite(x) ? x : null; };
const clamp01 = v => Math.max(0, Math.min(1, v));
const firstShoe = p => (p.no || 1) % 2 === 1 ? 0 : 1;
const paceOf = s => s.pace === '10k' ? '10k' : 'race';

// ---------- time helpers ----------
function parseTime(s, km) {
  s = String(s || '').trim().replace(/[：]/g, ':'); if (!s) return null;
  const pt = s.split(':').map(x => Number(x));
  if (pt.some(x => !isFinite(x))) return null;
  if (pt.length === 3) return pt[0] * 3600 + pt[1] * 60 + pt[2];
  if (pt.length === 2) return (km >= 21 && pt[0] <= 9) ? pt[0] * 3600 + pt[1] * 60 : pt[0] * 60 + pt[1];
  if (pt.length === 1) return pt[0] * 60;
  return null;
}
const fmtHMS = sec => { if (sec == null) return '—'; sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
const fmtPace = sec => sec == null ? '—' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
function fullEquivalent(p) {
  let best = null;
  PB_KEYS.forEach(k => { const km = DISTS.find(d => d[0] === k)[1], t = parseTime(p.pb[k], km); if (t && (!best || km > best.km)) best = { km, t, from: k }; });
  return best ? { sec: best.t * Math.pow(42.195 / best.km, 1.06), from: best.from } : null;
}
function raceInfo(p) {
  const d = DISTS.find(x => x[0] === p.race.dist); if (!d) return null;
  const t = parseTime(p.race.time, d[1]);
  return { dist: d[0], km: d[1], t, pace: t ? t / d[1] : null };
}

// ---------- Step 1: 接地タイプ ----------
function strikeOfStep(s) {
  const on = [0, 1, 2].map(k => {
    for (let j = 0; j < s.frames.length; j++) { if (s.frames[j] < 0) continue; const v = s.comp[k][j]; if (v != null && v >= ONSET) return s.frames[j]; }
    return Infinity;
  });
  const [h, m, f] = on;
  if (!isFinite(Math.min(h, m, f))) return null;
  if (m < h && m < f) return 'mid';
  if (h <= f) return f - h >= 2 ? 'rear' : 'mid';
  return h - f >= 2 ? 'fore' : 'mid';
}
function strikeShoe(p, i) {
  const cnt = { rear: 0, mid: 0, fore: 0 };
  (p.results[i] || []).forEach(s => { const t = strikeOfStep(s); if (t) cnt[t]++; });
  const total = cnt.rear + cnt.mid + cnt.fore, manual = (p.strikeManualBy || [])[i];
  if (manual) return { type: manual, weights: WEIGHTS[manual], cnt, total, manual: true, label: STRIKE_LABEL[manual] };
  if (!total) return null;
  const top = ['rear', 'mid', 'fore'].reduce((a, b) => cnt[b] > cnt[a] ? b : a, 'rear');
  if (cnt[top] > total / 2) return { type: top, weights: WEIGHTS[top], cnt, total, label: STRIKE_LABEL[top] };
  const w = [0, 0, 0];
  ['rear', 'mid', 'fore'].forEach(t => WEIGHTS[t].forEach((v, z) => { w[z] += v * cnt[t] / total; }));
  return { type: 'mixed', weights: w, cnt, total, label: `混在（${['rear', 'mid', 'fore'].filter(t => cnt[t]).map(t => STRIKE_LABEL[t].replace('接地', '')).join('・')}）` };
}

// ---------- Step 2: 活用度と余裕度 ----------
function statsOf(steps) {
  return [0, 1, 2].map(k => {
    const vals = steps.map(s => s.peak[k] && s.peak[k].v).filter(v => v != null), n = vals.length;
    const mean = n ? vals.reduce((a, b) => a + b, 0) / n : null;
    const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
    return { n, mean, sd };
  });
}
function zoneParams(i) {
  const C = E.cfg, band = i ? C.bandB : C.bandA, K = i ? C.kB : C.kA, P = i ? C.pB : C.pA;
  const h = band.heel.map(num), f = band.fore.map(num), m = h.map((v, j) => (v + f[j]) / 2);
  const kh = num(K.heel), kf = num(K.fore), ph = num(P.heel), pf = num(P.fore);
  return [{ b: h, k: kh, p: ph }, { b: m, k: (kh + kf) / 2, p: (ph + pf) / 2 }, { b: f, k: kf, p: pf }];
}
function scoreShoe(i, steps, weights) {
  if (!steps.length || !weights) return null;
  const st = statsOf(steps), zp = zoneParams(i), cal = E.cfg.cal.map(v => num(v) || 1);
  let use = 0, res = 0, wsum = 0; const zones = [];
  for (let z = 0; z < 3; z++) {
    const mean = st[z].mean, w = weights[z];
    if (mean == null) { zones.push({ z, w, mean: null }); continue; }
    const c = mean * cal[z], [lo, tg, hi] = zp[z].b;
    const U = clamp01((c - lo) / (tg - lo)), R = clamp01((hi - c) / (hi - tg));
    zones.push({ z, w, mean, sd: st[z].sd, c, U, R, k: zp[z].k, p: zp[z].p, hi });
    if (w > 0) { use += w * U * zp[z].k; res += w * R * zp[z].p; wsum += w; }
  }
  if (wsum <= 0) return null;
  return { use: use / wsum, res: res / wsum, zones, n: steps.length };
}
function stepSets(p, i) {
  const all = p.results[i] || [], r = all.filter(s => paceOf(s) === 'race'), t = all.filter(s => paceOf(s) === '10k');
  return { short: t.length ? t : r, long: r.length ? r : t, two: r.length > 0 && t.length > 0 };
}

// ---------- Step 3〜5: 距離ごとの適性度とおすすめ ----------
function rowsFor(p, sc, practice) {
  return DISTS.map((d, k) => {
    let a = A_W[k]; if (practice && k >= 2) a = Math.max(0, a - 0.1);
    const key = k <= 1 ? 'short' : 'long';
    const vA = 100 * (a * sc[0][key].use + (1 - a) * sc[0][key].res), vB = 100 * (a * sc[1][key].use + (1 - a) * sc[1][key].res);
    const diff = vB - vA;
    return { dist: d[0], a, vA, vB, diff, rec: diff >= 10 ? 'B' : diff <= -10 ? 'A' : 'either' };
  });
}
function estimate(p) {
  const C = E.cfg, A = shoeName(0), B = shoeName(1);
  const out = { missing: [], flags: [], rows: null };
  const fe = fullEquivalent(p), race = raceInfo(p), strikes = [strikeShoe(p, 0), strikeShoe(p, 1)];
  out.fe = fe; out.race = race; out.strikes = strikes;
  [0, 1].forEach(i => { if (!p.results[i].length) out.missing.push(`${shoeName(i)}の解析結果`); else if (!strikes[i]) out.missing.push(`${shoeName(i)}の接地タイプ（どの部位も${ONSET}%以上潰れていません）`); });
  if (out.missing.length) return out;
  const longest = num(p.longest);
  out.practice = !!(race && longest != null && longest < 0.7 * race.km);
  const sets = [stepSets(p, 0), stepSets(p, 1)];
  out.twoPace = sets[0].two || sets[1].two;
  const sc = [0, 1].map(i => ({ short: scoreShoe(i, sets[i].short, strikes[i].weights), long: scoreShoe(i, sets[i].long, strikes[i].weights) }));
  if (sc.some(s => !s.short || !s.long)) { out.missing.push('重みのある部位の圧縮率'); return out; }
  out.sc = sc;
  out.rows = rowsFor(p, sc, out.practice);
  // 注意フラグ（適性度は動かさない）
  const paceLim = parseTime(C.paceFlag, 0) || 330;
  if (race && race.pace != null && race.pace > paceLim) out.flags.push(['ペース', `${B}はキロ${fmtPace(paceLim)}前後から転がりに変わるという評価があります。レースペースで転がる感覚があったか、突き上げがなかったかを一緒に確認しましょう。`]);
  if (out.rows[3].rec === 'A' || out.rows[4].rec === 'A') out.flags.push(['脚へのダメージ', `${A}は脚を守る感覚が控えめという評価があります。長い練習で脚の残り方を確かめてから使いましょう。`]);
  if (strikes.some(s => s.type === 'rear') || p.pronation) out.flags.push(['安定性', '安定性スコアは2足とも6点台です。後半にぐらつかないか、長めの練習で確認しましょう。']);
  const monthly = num(p.monthly);
  if (strikes.some(s => s.type === 'fore' || s.type === 'mid') && monthly != null && monthly < num(C.lowMileage)) {
    const scR = [0, 1].map(i => ({ short: scoreShoe(i, sets[i].short, WEIGHTS.rear), long: scoreShoe(i, sets[i].long, WEIGHTS.rear) }));
    let alt = '';
    if (scR.every(s => s.short && s.long)) alt = 'リア接地として計算すると：' + rowsFor(p, scR, out.practice).map(r => `${r.dist} ${r.rec === 'A' ? A : r.rec === 'B' ? B : 'どちらでも'}`).join('、') + '。';
    out.flags.push(['後半の着地変化', `レース後半はかかと着地に変わりやすくなります。${alt}`]);
  }
  if (p.highInstep) out.flags.push(['フィット', `${B}はつま先の高さに余裕が少なめです。甲や指先の当たりを確認しましょう。`]);
  const fastLim = parseTime(C.fastFull, 42.195) || (3 * 3600 + 5 * 60);
  if (fe && fe.sec <= fastLim) out.flags.push(['速いランナー', `フルでは${B}は効率面で物足りない可能性があります。`]);
  // 説明
  const talkShoe = (i) => {
    const u = sc[i].short.use, r = sc[i].long.res, n = shoeName(i);
    const a = u >= 0.7 ? `${n}はフォームをしっかり潰して反発を使えています` : u < 0.5 ? `${n}はまだフォームを使い切れていないので、短い距離では力を出しにくいです` : `${n}はフォームをほどよく使えています`;
    const b = r >= 0.9 ? '。底つきまでの余裕が大きく、長い距離で活きます' : r < 0.75 ? '。一方で、長い距離では底つきまでの余裕が少なめです' : '';
    return a + b + '。';
  };
  const list = kind => out.rows.filter(r => r.rec === kind).map(r => r.dist).join('・');
  const aD = list('A'), gD = list('either'), bD = list('B');
  const strikeNote = strikes[0].type !== strikes[1].type ? `靴によって着地が変わりました（${A}：${strikes[0].label}、${B}：${strikes[1].label}）。` : '';
  out.talk = strikeNote + talkShoe(0) + talkShoe(1) + [aD ? `${aD}は${A}` : '', gD ? `${gD}はどちらでも（体感で選んでください）` : '', bD ? `${bD}は${B}がおすすめです` : ''].filter(Boolean).join('、') + '。';
  return out;
}
function staffChecks(p, est) {
  const C = E.cfg, A = shoeName(0), B = shoeName(1), out = [];
  if (!p.consent) out.push(['warn', '撮影・データ利用の同意が未確認です。']);
  if (C.cal.every(v => (num(v) || 1) === 1)) out.push(['warn', '校正係数が1.0のまま（未設定）です。動画の圧縮率を試験機相当に換算できていないため、適性度は参考になりません。「判定の詳細設定」で校正係数を入れてください。']);
  [0, 1].forEach(i => { const n = (p.results[i] || []).length; if (n && n < STEPS_GOAL) out.push(['info', `${shoeName(i)}は${n}歩です（${STEPS_GOAL}歩以上を推奨）。`]); });
  const sA = statsOf(p.results[0] || []), sB = statsOf(p.results[1] || []);
  if (sA[2].mean != null && sB[2].mean != null) {
    const mmA = sA[2].mean / 100 * num(C.refA[2]), mmB = sB[2].mean / 100 * num(C.refB[2]);
    if (mmB < mmA) out.push(['warn', `前足部の推定圧縮量が ${B} ${mmB.toFixed(1)}mm < ${A} ${mmA.toFixed(1)}mm で、試験機の傾向（${B}の方が深く潰れる）と逆です。撮影ペース・着地・カメラ位置を確認してください。`]);
  }
  const st = est.strikes;
  [0, 1].forEach(i => { if (st[i] && st[i].type === 'mixed') out.push(['info', `${shoeName(i)}の接地タイプが歩ごとに分かれたため「混在」として重みを平均しました（リア${st[i].cnt.rear}・ミッド${st[i].cnt.mid}・フォア${st[i].cnt.fore}歩）。`]); });
  if (est.sc) {
    [0, 1].forEach(i => ['short', 'long'].forEach(key => est.sc[i][key].zones.forEach(z => {
      if (z.c != null && z.c > z.hi + 10) out.push(['warn', `${shoeName(i)}の${ZONES[z.z]}が試験機相当で ${z.c.toFixed(0)}% と上限（${z.hi}%）を大きく超えています。校正係数の設定ミスを疑ってください。`]);
    })));
    [0, 1].forEach(i => est.sc[i].long.zones.forEach(z => { if (z.w >= 0.3 && z.sd != null && z.sd > 5) out.push(['info', `${shoeName(i)}の${ZONES[z.z]}は歩ごとのばらつきが大きめです（SD ${z.sd.toFixed(1)}ポイント）。`]); }));
    const lv = q => { const e = q === p ? est : estimate(q); return e.sc ? Math.max(...[0, 1].map(i => e.sc[i].long.zones.reduce((a, z) => a + (z.c != null ? z.w * z.c : 0), 0))) : null; };
    const w = num(p.weight), my = lv(p);
    const others = E.participants.map(q => ({ w: num(q.weight), v: q === p ? my : lv(q) })).filter(o => o.w != null && o.v != null);
    if (w != null && my != null && others.length >= 3) {
      const wp = others.filter(o => o.w < w).length / others.length, lp = others.filter(o => o.v < my).length / others.length;
      if (wp < 1 / 3 && lp >= 2 / 3) out.push(['warn', '体重が軽い方なのに圧縮率が上位です。撮影ミスや、無負荷の基準フレームの取り違えがないか確認してください。']);
    }
  }
  return out;
}

// ---------- tabs & save bar ----------
function showTab(which) {
  const ev = which === 'event';
  $('#viewAnalysis').hidden = ev; $('#viewEvent').hidden = !ev;
  $('#tabAnalysis').setAttribute('aria-selected', String(!ev)); $('#tabEvent').setAttribute('aria-selected', String(ev));
  if (ev) renderAll(true); else renderSaveBar();
  window.dispatchEvent(new Event('resize'));
}
function renderSaveBar() {
  const sel = $('#evSaveP'); if (!sel) return;
  sel.innerHTML = E.participants.length
    ? E.participants.map(p => `<option value="${p.id}"${p.id === E.currentId ? ' selected' : ''}>${esc(p.name)}${p.slot ? `（${esc(p.slot)}枠）` : ''}</option>`).join('')
    : '<option value="">参加者がいません</option>';
  const p = cur();
  $$('#evShoeSeg button').forEach((b, i) => { const n = p ? p.results[i].length : 0; b.textContent = `${shoeName(i)}（${n}/${STEPS_GOAL}）`; b.setAttribute('aria-pressed', String(E.activeShoe === i)); });
  $$('#evPaceSeg button').forEach(b => b.setAttribute('aria-pressed', String((E.activePace || 'race') === b.dataset.p)));
  const has = MSA.hasResult();
  $('#evSave').disabled = !p || !has;
  let hint = '';
  if (!E.participants.length) hint = '「体験会・比較」タブで参加者を追加すると、解析結果を保存できます。';
  else if (p && !p.results[0].length && !p.results[1].length) hint = `おすすめの撮影順：${shoeName(firstShoe(p))} → ${shoeName(1 - firstShoe(p))}。${has ? '' : '解析が終わると追加できます。'}`;
  else if (!has) hint = '解析が終わると、この歩を追加できます。';
  say('#evSaveStatus', hint);
}
function saveCurrent() {
  const p = cur(); if (!p) return;
  const snap = MSA.snapshot(); if (!snap) { say('#evSaveStatus', '先に解析を完了してください。', 'warn'); return; }
  snap.pace = E.activePace === '10k' ? '10k' : 'race';
  const i = E.activeShoe, list = p.results[i];
  if (list.some(s => s.video === snap.video && s.baseAbs === snap.baseAbs && s.mark === snap.mark && s.last === snap.last && JSON.stringify(s.peak) === JSON.stringify(snap.peak))) {
    say('#evSaveStatus', 'この解析はすでに追加済みです。次の歩に移動して解析してください。', 'warn'); return;
  }
  list.push(snap); persist(true);
  const t = strikeOfStep(snap), pk = snap.peak.map((v, k) => `${ZONES[k]} ${v ? v.v.toFixed(1) + '%' : '—'}`).join('、');
  renderSaveBar();
  say('#evSaveStatus', `${p.name}さんの${shoeName(i)}（${snap.pace === '10k' ? '10Kペース' : 'レースペース'}）に${list.length}歩目を追加しました（最大：${pk}${t ? `、${STRIKE_LABEL[t]}` : ''}）。${list.length < STEPS_GOAL ? `あと${STEPS_GOAL - list.length}歩以上あると安定します。` : ''}`, 'ok');
}

// ---------- list ----------
function renderList() {
  const ul = $('#evList');
  if (!E.participants.length) { ul.innerHTML = '<li class="ev-empty">まだ参加者がいません。</li>'; return; }
  ul.innerHTML = E.participants.map(p => {
    const chip = i => { const n = p.results[i].length; return `<span class="chip${n >= STEPS_GOAL ? ' on' : n ? ' part' : ''}">${esc(shoeName(i))} ${n}歩</span>`; };
    const est = estimate(p);
    let res = '';
    if (est.rows) { const b = est.rows.filter(r => r.rec === 'B').map(r => r.dist), a = est.rows.filter(r => r.rec === 'A').map(r => r.dist);
      res = `<span class="pick">${a.length ? `${esc(shoeName(0))}：${a.join('・')}` : ''}${a.length && b.length ? '　' : ''}${b.length ? `${esc(shoeName(1))}：${b.join('・')}` : ''}${!a.length && !b.length ? '全距離どちらでも' : ''}</span>`; }
    return `<li><button type="button" class="ev-item${p.id === E.currentId ? ' sel' : ''}" data-id="${p.id}">
      <span class="ev-name">${esc(p.name)}</span><span class="ev-slot">${p.slot ? esc(p.slot) + '枠' : ''}${p.consent ? '' : ' 同意未'}</span>
      <span class="chips">${chip(0)}${chip(1)}</span>${res}</button></li>`;
  }).join('');
}

// ---------- detail ----------
function getPath(o, path) { return path.split('.').reduce((a, k) => a == null ? a : a[k], o); }
function setPath(o, path, v) { const ks = path.split('.'), last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; }
function renderDetail(force) {
  const p = cur();
  $('#evDetail').hidden = !p; $('#evNone').hidden = !!p;
  if (!p) return;
  if (force) {
    $$('#evDetail [data-f]').forEach(el => { const v = getPath(p, el.dataset.f); if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; });
    $('#evReason').value = p.reason || '';
    [0, 1].forEach(i => { $(`#evStrike${i}`).value = (p.strikeManualBy || [])[i] || ''; });
  }
  $$('.shoeA-name').forEach(el => { el.textContent = shoeName(0); });
  $$('.shoeB-name').forEach(el => { el.textContent = shoeName(1); });
  $('#evOrder').textContent = `${shoeName(firstShoe(p))} → ${shoeName(1 - firstShoe(p))}`;
  renderPreSummary(p); renderChoice(p); renderCompare(p); renderSheet(p);
  $('#evDelete').textContent = 'この参加者を削除'; $('#evDelete').dataset.armed = '';
}
function renderPreSummary(p) {
  const fe = fullEquivalent(p), race = raceInfo(p), parts = [];
  parts.push(fe ? `フル換算 <b>${fmtHMS(fe.sec)}</b>（${esc(fe.from)}の自己ベストから）` : 'フル換算：自己ベストを入れると計算します');
  if (race && race.pace != null) parts.push(`目標レースペース <b>キロ${fmtPace(race.pace)}</b>`);
  $('#evPreSummary').innerHTML = parts.join('　');
}
function renderChoice(p) { $$('#evChoice button').forEach(b => { b.setAttribute('aria-pressed', String(p.choice === b.dataset.v)); if (b.dataset.v === '0') b.textContent = shoeName(0); if (b.dataset.v === '1') b.textContent = shoeName(1); }); }

// ---------- comparison ----------
function renderCompare(p) {
  const has = p.results[0].length || p.results[1].length;
  $('#evCompare').hidden = !has; $('#evNoResult').hidden = !!has;
  [0, 1].forEach(i => {
    const s = strikeShoe(p, i);
    $(`#evStrikeAuto${i}`).textContent = s ? `${s.manual ? '手動：' : ''}${s.label}${s.total ? `（リア${s.cnt.rear}・ミッド${s.cnt.mid}・フォア${s.cnt.fore}歩）` : ''}` : '未判定';
  });
  if (!has) return;
  const sA = statsOf(p.results[0]), sB = statsOf(p.results[1]);
  const cell = (s, k) => { const z = s[k]; if (!z.n) return '<td class="na">—</td>'; return `<td><span class="big">${z.mean.toFixed(1)}</span><span class="u">%</span><span class="t">${z.sd != null ? `±${z.sd.toFixed(1)}　` : ''}${z.n}歩</span></td>`; };
  const diff = k => {
    const a = sA[k].mean, b = sB[k].mean; if (a == null || b == null) return '<td class="na">—</td>';
    const d = b - a; if (Math.abs(d) < SAME) return `<td class="same">ほぼ同じ<span class="t">${d >= 0 ? '+' : ''}${d.toFixed(1)}</span></td>`;
    return `<td class="${d > 0 ? 'moreB' : 'moreA'}"><span class="num">${d > 0 ? '+' : ''}${d.toFixed(1)}</span><span class="t">${esc(shoeName(d > 0 ? 1 : 0))}が大きい</span></td>`;
  };
  $('#evTable').innerHTML = `<thead><tr><th></th><th><i class="sw a"></i>${esc(shoeName(0))}</th><th><i class="sw b"></i>${esc(shoeName(1))}</th><th>差（B−A）</th></tr></thead><tbody>${
    ZONES.map((z, k) => `<tr><th>${z}</th>${cell(sA, k)}${cell(sB, k)}${diff(k)}</tr>`).join('')}</tbody>`;
  const C = E.cfg, mm = [sA, sB].map((s, i) => s.map((z, k) => z.mean == null ? null : z.mean / 100 * num((i ? C.refB : C.refA)[k])));
  $('#evMm').textContent = `動画で測った圧縮率です（校正前）。推定圧縮量（率 × 実測の厚さ）：${ZONES.map((z, k) => `${z} ${shoeName(0)} ${mm[0][k] == null ? '—' : mm[0][k].toFixed(1) + 'mm'} / ${shoeName(1)} ${mm[1][k] == null ? '—' : mm[1][k].toFixed(1) + 'mm'}`).join('、')}`;
  [0, 1].forEach(i => {
    const list = p.results[i];
    $(`#evSteps${i}`).innerHTML = list.length ? list.map((s, j) => {
      const t = strikeOfStep(s);
      return `<li><span class="sn">${j + 1}</span><span class="sv">${s.peak.map(pk => pk ? pk.v.toFixed(1) : '—').join(' / ')}</span><span class="ss">${t ? STRIKE_LABEL[t] : '判定不可'}${paceOf(s) === '10k' ? '・10K' : ''}</span><span class="sf" title="${esc(s.video)}">${esc(s.video)}</span><button type="button" class="btn small" data-del="${i}:${j}">削除</button></li>`;
    }).join('') : '<li class="ev-empty">まだありません</li>';
  });
  drawBars(p); drawCurves(p);
}
function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return [ctx, w, h];
}
function drawBars(p) {
  const cv = $('#evBars'); if (!cv || !cv.clientWidth) return;
  const [ctx, w, h] = sizeCanvas(cv), cols = [cssVar('--shoeA'), cssVar('--shoeB')], ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line');
  const S = [statsOf(p.results[0]), statsOf(p.results[1])];
  let ymax = 10; S.forEach(s => s.forEach(z => { if (z.mean != null) ymax = Math.max(ymax, z.mean + (z.sd || 0) + 3); }));
  ymax = Math.ceil(ymax / 5) * 5;
  const pad = { l: 40, r: 10, t: 18, b: 26 }, gw = (w - pad.l - pad.r) / 3, Y = v => pad.t + (1 - v / ymax) * (h - pad.t - pad.b);
  ctx.font = '12px "IBM Plex Sans JP",system-ui,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = 0; v <= ymax; v += ymax > 30 ? 10 : 5) { ctx.strokeStyle = line; ctx.lineWidth = v ? 0.8 : 1.4; ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke(); ctx.fillStyle = muted; ctx.fillText(v + '%', pad.l - 6, Y(v)); }
  ZONES.forEach((z, k) => {
    const x0 = pad.l + k * gw, bw = Math.min(46, gw * 0.3);
    [0, 1].forEach(i => {
      const zz = S[i][k], x = x0 + gw / 2 + (i ? 4 : -4 - bw);
      if (zz.mean == null) { ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('—', x + bw / 2, Y(0) - 2); return; }
      ctx.fillStyle = cols[i]; ctx.fillRect(x, Y(zz.mean), bw, Y(0) - Y(zz.mean));
      if (zz.sd != null) { ctx.strokeStyle = ink; ctx.lineWidth = 1.2; const xc = x + bw / 2; ctx.beginPath(); ctx.moveTo(xc, Y(Math.max(0, zz.mean - zz.sd))); ctx.lineTo(xc, Y(zz.mean + zz.sd)); ctx.moveTo(xc - 4, Y(zz.mean + zz.sd)); ctx.lineTo(xc + 4, Y(zz.mean + zz.sd)); ctx.stroke(); }
      ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = '600 14px "Barlow Condensed","IBM Plex Sans JP",sans-serif';
      ctx.fillText(zz.mean.toFixed(1), x + bw / 2 + (zz.sd != null ? (i ? 10 : -10) : 0), Y(zz.mean + (zz.sd || 0)) - 2); ctx.font = '12px "IBM Plex Sans JP",system-ui,sans-serif';
    });
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(z, x0 + gw / 2, h - pad.b + 7);
  });
}
function drawCurves(p) {
  const all = [p.results[0], p.results[1]], useMs = all.every(l => l.every(s => s.capFps > 0));
  const cols = [cssVar('--shoeA'), cssVar('--shoeB')], muted = cssVar('--muted'), line = cssVar('--line');
  const X = (s, f) => useMs ? f / s.capFps * 1000 : f;
  let x0 = Infinity, x1 = -Infinity;
  all.forEach(l => l.forEach(s => { if (s.frames.length) { x0 = Math.min(x0, X(s, s.frames[0])); x1 = Math.max(x1, X(s, s.frames[s.frames.length - 1])); } }));
  if (!(x1 > x0)) { x0 = 0; x1 = 1; }
  $$('#evCurves canvas').forEach((cv, k) => {
    if (!cv.clientWidth) return;
    const [ctx, w, h] = sizeCanvas(cv);
    let ymax = 10; all.forEach(l => l.forEach(s => s.comp[k].forEach(v => { if (v != null) ymax = Math.max(ymax, v + 2); })));
    ymax = Math.ceil(ymax / 5) * 5;
    const pad = { l: 34, r: 8, t: 8, b: 22 }, PX = x => pad.l + (x - x0) / (x1 - x0) * (w - pad.l - pad.r), PY = v => pad.t + (1 - v / ymax) * (h - pad.t - pad.b);
    ctx.font = '11px "IBM Plex Sans JP",system-ui,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= ymax; v += ymax > 30 ? 10 : 5) { ctx.strokeStyle = line; ctx.lineWidth = v ? 0.7 : 1.2; ctx.beginPath(); ctx.moveTo(pad.l, PY(v)); ctx.lineTo(w - pad.r, PY(v)); ctx.stroke(); ctx.fillStyle = muted; ctx.fillText(v + '%', pad.l - 4, PY(v)); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = muted;
    ctx.fillText(useMs ? `${Math.round(x0)} ms` : `f${x0 >= 0 ? '+' : ''}${x0}`, pad.l, h - pad.b + 6);
    ctx.textAlign = 'right'; ctx.fillText(useMs ? `${Math.round(x1)} ms` : `f+${x1}`, w - pad.r, h - pad.b + 6);
    all.forEach((l, i) => l.forEach(s => {
      ctx.strokeStyle = cols[i]; ctx.globalAlpha = l.length > 1 ? 0.75 : 1; ctx.lineWidth = 1.6; ctx.setLineDash(i ? [6, 4] : []); ctx.beginPath(); let pen = false;
      s.frames.forEach((f, j) => { const v = s.comp[k][j]; if (v == null) { pen = false; return; } const x = PX(X(s, f)), y = PY(v); if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = true; });
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }));
  });
}

// ---------- result sheet ----------
const cat = v => v >= 80 ? 'hi' : v >= 60 ? 'ok' : 'lo';
function renderSheet(p) {
  const est = estimate(p), A = shoeName(0), B = shoeName(1), el = $('#evSheet');
  const checks = staffChecks(p, est);
  $('#evChecks').innerHTML = checks.length ? checks.map(([t, m]) => `<li class="${t}">${esc(m)}</li>`).join('') : '<li class="okc">気になる点はありません。</li>';
  if (!est.rows) { el.innerHTML = `<p class="sheet-missing">推定に必要な情報が足りません：${esc(est.missing.join('、'))}</p>`; return; }
  const st = est.strikes, sameStrike = st[0].type === st[1].type;
  const recTxt = r => r.rec === 'A' ? `${esc(A)}がおすすめ` : r.rec === 'B' ? `${esc(B)}がおすすめ` : 'どちらでも';
  const val = v => `<span class="apt ${cat(v)}">${Math.round(v)}<small>%</small></span>`;
  const rows = est.rows.map(r => `<tr><th>${r.dist}</th><td>${val(r.vA)}</td><td>${val(r.vB)}</td><td class="num">${r.diff >= 0 ? '+' : ''}${Math.round(r.diff)}</td><td class="rec ${r.rec}">${recTxt(r)}</td></tr>`).join('');
  const zoneLines = i => ['short', 'long'].filter((k, idx) => idx === 0 || est.twoPace).map(key => {
    const s = est.sc[i][key];
    const zs = s.zones.filter(z => z.mean != null).map(z => `${ZONES[z.z]} ${z.c.toFixed(0)}%（重み${(+z.w).toFixed(2)}、活用${z.U.toFixed(2)}、余裕${z.R.toFixed(2)}）`).join('、');
    return `<li><b>${esc(shoeName(i))}${est.twoPace ? (key === 'short' ? '（5K・10K用）' : '（ハーフ以上用）') : ''}</b>：試験機相当 ${zs} → 活用スコア ${s.use.toFixed(2)}、余裕スコア ${s.res.toFixed(2)}</li>`;
  }).join('');
  el.innerHTML = `
    <div class="sheet-head"><span class="sheet-name">${esc(p.name)}さん</span><span class="sheet-meta">${sameStrike ? esc(st[0].label) : `${esc(A)}：${esc(st[0].label)}　${esc(B)}：${esc(st[1].label)}`}${est.race && est.race.pace != null ? `　目標：${esc(est.race.dist)} キロ${fmtPace(est.race.pace)}` : ''}</span></div>
    <div class="apt-wrap"><table class="apt-table"><thead><tr><th>距離</th><th><i class="sw a"></i>${esc(A)}</th><th><i class="sw b"></i>${esc(B)}</th><th>差</th><th>おすすめ</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="apt-legend"><span class="apt hi">80%以上</span>力を発揮しやすい　<span class="apt ok">60〜79%</span>十分使える　<span class="apt lo">60%未満</span>この距離では力を発揮しにくい</p>
    <p class="sheet-talk">${esc(est.talk)}</p>
    ${est.flags.length ? `<h3>確かめてほしいこと</h3><ul class="sheet-flags">${est.flags.map(([t, m]) => `<li><b>${esc(t)}</b>　${esc(m)}</li>`).join('')}</ul>` : ''}
    <details class="sheet-why"><summary>根拠（計算の中身）</summary><ul>
      <li>接地タイプ：${esc(A)} ${esc(st[0].label)}、${esc(B)} ${esc(st[1].label)}（重み ヒール/ミッド/前足部 = ${st[0].weights.map(v => v.toFixed(2)).join('/')}${sameStrike ? '' : `、${st[1].weights.map(v => v.toFixed(2)).join('/')}`}）</li>
      ${zoneLines(0)}${zoneLines(1)}
      <li>適性度 = 100 ×（a × 活用スコア +（1 − a）× 余裕スコア）、a = ${est.rows.map(r => `${r.dist} ${r.a.toFixed(2)}`).join('、')}${est.practice ? '（練習での最長距離が目標の7割未満のため、ハーフ以上のaを0.1下げています）' : ''}</li>
      <li>差が+10以上で${esc(B)}、−10以下で${esc(A)}、その間は「どちらでも」</li>
    </ul></details>
    <p class="sheet-note">ミッドソールの潰れ方と申告情報からの推定です。「合う・合わない」ではなく、距離ごとの使い分けの目安としてご覧ください。</p>`;
}

// ---------- export / backup ----------
const csvEsc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const f2 = v => v == null ? '' : (+v).toFixed(2);
const DK = ['5k', '10k', 'half', '30k', 'full'];
function buildCSV() {
  const head = ['no', 'name', 'slot', 'consent', 'pb_5k', 'pb_10k', 'pb_half', 'pb_full', 'full_equiv', 'race_dist', 'race_time', 'race_pace_per_km', 'weight_kg', 'monthly_km', 'longest_km', 'size', 'high_instep', 'pronation'];
  ['A', 'B'].forEach(t => head.push(`${t}_shoe`, `${t}_steps`, `${t}_steps_10kpace`, `${t}_strike`, `${t}_heel_mean`, `${t}_heel_sd`, `${t}_mid_mean`, `${t}_mid_sd`, `${t}_fore_mean`, `${t}_fore_sd`,
    `${t}_heel_cal`, `${t}_mid_cal`, `${t}_fore_cal`, `${t}_use_short`, `${t}_res_short`, `${t}_use_long`, `${t}_res_long`, `${t}_fore_est_mm`));
  DK.forEach(d => head.push(`apt_A_${d}`)); DK.forEach(d => head.push(`apt_B_${d}`)); DK.forEach(d => head.push(`diff_${d}`)); DK.forEach(d => head.push(`rec_${d}`));
  head.push('practice_corr', 'calibration', 'flags', 'staff_checks', 'choice', 'reason', 'concern');
  const rows = [head.join(',')];
  E.participants.forEach(p => {
    const est = estimate(p), fe = est.fe, race = est.race, checks = staffChecks(p, est);
    const row = [p.no, p.name, p.slot, p.consent ? 1 : 0, p.pb['5K'], p.pb['10K'], p.pb['ハーフ'], p.pb['フル'], fe ? fmtHMS(fe.sec) : '', p.race.dist, p.race.time, race && race.pace != null ? fmtPace(race.pace) : '', p.weight, p.monthly, p.longest, p.size, p.highInstep ? 1 : 0, p.pronation ? 1 : 0];
    [0, 1].forEach(i => {
      const all = p.results[i] || [], s = statsOf(all), sc = est.sc ? est.sc[i] : null, st = est.strikes[i];
      const cal = z => { const zz = sc && sc.long.zones[z]; return zz && zz.c != null ? f2(zz.c) : ''; };
      row.push(shoeName(i), all.length, all.filter(x => paceOf(x) === '10k').length, st ? st.label : '',
        f2(s[0].mean), f2(s[0].sd), f2(s[1].mean), f2(s[1].sd), f2(s[2].mean), f2(s[2].sd), cal(0), cal(1), cal(2),
        sc ? f2(sc.short.use) : '', sc ? f2(sc.short.res) : '', sc ? f2(sc.long.use) : '', sc ? f2(sc.long.res) : '',
        s[2].mean == null ? '' : f2(s[2].mean / 100 * num((i ? E.cfg.refB : E.cfg.refA)[2])));
    });
    const R = est.rows;
    DK.forEach((d, k) => row.push(R ? R[k].vA.toFixed(1) : '')); DK.forEach((d, k) => row.push(R ? R[k].vB.toFixed(1) : ''));
    DK.forEach((d, k) => row.push(R ? R[k].diff.toFixed(1) : ''));
    DK.forEach((d, k) => row.push(R ? (R[k].rec === 'A' ? shoeName(0) : R[k].rec === 'B' ? shoeName(1) : 'どちらでも') : ''));
    row.push(est.practice ? 1 : 0, E.cfg.cal.join('/'), est.flags.map(f => f[0]).join(' / '), checks.map(c => c[1]).join(' / '),
      p.choice === '0' || p.choice === '1' ? shoeName(+p.choice) : (p.choice === 'none' ? '決められない' : ''), p.reason, p.concern);
    rows.push(row.map(csvEsc).join(','));
  });
  return '\ufeff' + rows.join('\r\n') + '\r\n';
}
function buildStepsCSV() {
  const head = ['no', 'name', 'shoe', 'step', 'pace', 'video', 'heel_peak', 'mid_peak', 'fore_peak', 'heel_peak_time', 'mid_peak_time', 'fore_peak_time', 'time_unit', 'strike'];
  const rows = [head.join(',')];
  E.participants.forEach(p => [0, 1].forEach(i => p.results[i].forEach((s, j) => {
    const tm = pk => pk ? (s.capFps > 0 ? (pk.f / s.capFps * 1000).toFixed(1) : pk.f) : '';
    rows.push([p.no, p.name, shoeName(i), j + 1, paceOf(s) === '10k' ? '10K' : 'race', s.video, ...s.peak.map(pk => pk ? pk.v.toFixed(2) : ''), ...s.peak.map(tm), s.capFps > 0 ? 'ms' : 'frame', strikeOfStep(s) || ''].map(csvEsc).join(','));
  })));
  return '\ufeff' + rows.join('\r\n') + '\r\n';
}
const stamp = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`; };
async function exportFile(text, filename, okMsg) {
  const r = await MSA.saveText(filename, text);
  const msg = { ok: okMsg, declined: '保存を取り消しました。', rate: '少し待ってからもう一度押してください。', clipboard: 'ファイルを保存できないため、クリップボードにコピーしました。', fail: '保存できませんでした。' }[r] || okMsg;
  say('#evDataStatus', msg, r === 'ok' || r === 'clipboard' ? 'ok' : 'warn');
}
function restore(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const v = JSON.parse(fr.result);
      if (!v || !Array.isArray(v.participants)) throw new Error('形式が違います');
      let added = 0, updated = 0;
      v.participants.map(migrate).forEach(np => { const i = E.participants.findIndex(p => p.id === np.id); if (i >= 0) { E.participants[i] = np; updated++; } else { E.participants.push(np); added++; } });
      if (Array.isArray(v.shoes) && v.shoes.length === 2) E.shoes = v.shoes;
      if (v.cfg) E.cfg = mergeCfg(v.cfg);
      if (!cur() && E.participants.length) E.currentId = E.participants[0].id;
      persist(true); applySettings(); renderAll(true);
      say('#evDataStatus', `読み込みました（追加${added}人、更新${updated}人）。`, 'ok');
    } catch (e) { say('#evDataStatus', `読み込めませんでした：${e.message}`, 'warn'); }
  };
  fr.readAsText(file);
}

// ---------- settings ----------
function applySettings() {
  $('#evShoeA').value = E.shoes[0]; $('#evShoeB').value = E.shoes[1];
  $('#evCapFps').value = E.capFps || '';
  $$('[data-cfg]').forEach(el => { const v = getPath(E.cfg, el.dataset.cfg); el.value = v ?? ''; });
  const cf = $('#capfps');
  if (cf && E.capFps && +cf.value !== E.capFps) { cf.value = E.capFps; cf.dispatchEvent(new Event('input')); }
}
function renderAll(force) { renderList(); renderDetail(force); renderSaveBar(); }
let liveTimer = null;
function refreshLive() { clearTimeout(liveTimer); liveTimer = setTimeout(() => { const p = cur(); if (!p) return; renderList(); renderPreSummary(p); renderSheet(p); }, 150); }

// ---------- events ----------
function addParticipant() {
  const n = E.participants.reduce((m, p) => Math.max(m, p.no || 0), 0) + 1;
  const p = newParticipant(n);
  E.participants.push(p); E.currentId = p.id; E.activeShoe = firstShoe(p); persist(true);
  renderAll(true);
  const nm = $('#evName'); if (nm) { nm.focus(); nm.select(); }
}
$('#tabAnalysis').addEventListener('click', () => showTab('analysis'));
$('#tabEvent').addEventListener('click', () => showTab('event'));
$('#evAdd').addEventListener('click', addParticipant);
$('#evAdd2').addEventListener('click', addParticipant);
$('#evList').addEventListener('click', e => { const b = e.target.closest('.ev-item'); if (!b) return; E.currentId = b.dataset.id; persist(); renderAll(true); });
$('#evSaveP').addEventListener('change', e => { E.currentId = e.target.value || null; const p = cur(); if (p && !p.results[0].length && !p.results[1].length) E.activeShoe = firstShoe(p); persist(); renderSaveBar(); });
$$('#evShoeSeg button').forEach((b, i) => b.addEventListener('click', () => { E.activeShoe = i; persist(); renderSaveBar(); }));
$$('#evPaceSeg button').forEach(b => b.addEventListener('click', () => { E.activePace = b.dataset.p; persist(); renderSaveBar(); }));
$('#evSave').addEventListener('click', saveCurrent);
$('#evDetail').addEventListener('input', e => {
  const el = e.target, p = cur(); if (!p || !el.dataset.f) return;
  setPath(p, el.dataset.f, el.type === 'checkbox' ? el.checked : el.value); persist();
  if (el.dataset.f === 'name' || el.dataset.f === 'slot') renderSaveBar();
  refreshLive();
});
$('#evDetail').addEventListener('change', e => { const el = e.target; if (el.dataset.f && (el.tagName === 'SELECT' || el.type === 'checkbox')) el.dispatchEvent(new Event('input', { bubbles: true })); });
$('#evReason').addEventListener('input', e => { const p = cur(); if (!p) return; p.reason = e.target.value; persist(); });
[0, 1].forEach(i => $(`#evStrike${i}`).addEventListener('change', e => { const p = cur(); if (!p) return; if (!Array.isArray(p.strikeManualBy)) p.strikeManualBy = ['', '']; p.strikeManualBy[i] = e.target.value; persist(true); renderCompare(p); renderSheet(p); renderList(); }));
$('#evChoice').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); const p = cur(); if (!b || !p) return; p.choice = p.choice === b.dataset.v ? '' : b.dataset.v; persist(); renderChoice(p); });
$('#evCompare').addEventListener('click', e => {
  const b = e.target.closest('button[data-del]'); const p = cur(); if (!b || !p) return;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '本当に削除'; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = '削除'; } }, 3000); return; }
  const [i, j] = b.dataset.del.split(':').map(Number); p.results[i].splice(j, 1); persist(true); renderAll();
});
$('#evDelete').addEventListener('click', e => {
  const btn = e.currentTarget, p = cur(); if (!p) return;
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'もう一度押すと削除します'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'この参加者を削除'; }, 4000); return; }
  E.participants = E.participants.filter(q => q.id !== p.id); E.currentId = E.participants.length ? E.participants[E.participants.length - 1].id : null;
  persist(true); renderAll(true);
});
$('#evPrint').addEventListener('click', () => { try { window.print(); } catch (e) {} });
$('#evShoeA').addEventListener('input', e => { E.shoes[0] = e.target.value || 'シューズA'; persist(); renderAll(); });
$('#evShoeB').addEventListener('input', e => { E.shoes[1] = e.target.value || 'シューズB'; persist(); renderAll(); });
$('#evCapFps').addEventListener('input', e => { E.capFps = +e.target.value > 0 ? +e.target.value : 0; persist(); const cf = $('#capfps'); if (cf) { cf.value = E.capFps || ''; cf.dispatchEvent(new Event('input')); } renderAll(); });
$$('[data-cfg]').forEach(el => el.addEventListener('input', () => { setPath(E.cfg, el.dataset.cfg, el.value); persist(); const p = cur(); if (p) { renderCompare(p); renderSheet(p); } renderList(); }));
$('#evCfgReset').addEventListener('click', () => { const keep = { paceFlag: E.cfg.paceFlag, fastFull: E.cfg.fastFull, lowMileage: E.cfg.lowMileage, cal: E.cfg.cal }; E.cfg = Object.assign(defaultCfg(), keep); persist(true); applySettings(); renderAll(); say('#evDataStatus', '基準値と係数を企画書の値に戻しました（校正係数としきい値はそのまま）。', 'ok'); });
$('#evCsv').addEventListener('click', () => { if (!E.participants.length) { say('#evDataStatus', '書き出す参加者がいません。', 'warn'); return; } exportFile(buildCSV(), `体験会_${stamp()}.csv`, 'CSVを保存しました。'); });
$('#evStepsCsv').addEventListener('click', () => { if (!E.participants.length) { say('#evDataStatus', '書き出す参加者がいません。', 'warn'); return; } exportFile(buildStepsCSV(), `体験会_歩ごと_${stamp()}.csv`, '歩ごとのCSVを保存しました。'); });
$('#evBackup').addEventListener('click', () => exportFile(JSON.stringify({ app: 'midsole-analyzer', version: 3, exportedAt: new Date().toISOString(), shoes: E.shoes, capFps: E.capFps, cfg: E.cfg, participants: E.participants }), `体験会バックアップ_${stamp()}.json`, 'バックアップを保存しました。'));
$('#evRestore').addEventListener('click', () => $('#evRestoreFile').click());
$('#evRestoreFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) restore(f); e.target.value = ''; });
$('#evClear').addEventListener('click', e => {
  const btn = e.currentTarget;
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'もう一度押すと全員分を削除します'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '全データを削除'; }, 4000); return; }
  E = Object.assign(blank(), { shoes: E.shoes, capFps: E.capFps, cfg: E.cfg }); persist(true); renderAll(true); btn.dataset.armed = ''; btn.textContent = '全データを削除';
  say('#evDataStatus', '全データを削除しました。');
});
window.addEventListener('msa:update', renderSaveBar);
let rz = null; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const p = cur(); if (!$('#viewEvent').hidden && p) { drawBars(p); drawCurves(p); } }, 80); });
window.MSAEvent = { estimate: id => { const p = E.participants.find(q => q.id === id) || cur(); return p ? estimate(p) : null; } };
applySettings(); renderAll(true);
})();
