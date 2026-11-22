// 相性チェック：1足（エアロエリート）× 左右の解析結果から、相性スコア（0〜100）を出す
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const MSA = window.MSA;
const KEY = 'msa-aero-v1';
const ZONES = ['ヒール', 'ミッド', 'フォア'];
const SIDES = ['R', 'L'];
const SIDE_LABEL = { R: '右', L: '左' };
const ONSET = 3;                    // 潰れ始め：接地の瞬間の厚さから3%以上
const STRIKE_LABEL = { rear: 'かかと寄り（リア接地）', mid: '真ん中（ミッド接地）', fore: 'つま先寄り（フォア接地）' };
const STRIKE_SHORT = { rear: 'リア', mid: 'ミッド', fore: 'フォア' };
const WEIGHTS = { rear: [0.6, 0.1, 0.3], mid: [0.1, 0.5, 0.4], fore: [0, 0.2, 0.8] };
const SUB_NAMES = ['クッションの使い方', '左右のそろい具合', '走った感覚'];
const DISC = { none: ['なし', 100], some: ['少しあり', 50], clear: ['明確にあり', 0] };
const CONT = { yes: ['はい', 100], neutral: ['どちらともいえない', 50], no: ['いいえ', 0] };
const SLOTS = ['10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];
const MONTHLY = [['', '—'], ['25', '〜50km'], ['75', '50〜100km'], ['125', '100〜150km'], ['175', '150〜200km'], ['225', '200km〜']];
const SIZES = ['23.0', '23.5', '24.0', '24.5', '25.0', '25.5', '26.0', '26.5', '27.0', '27.5', '28.0'];
const SNS = [['', '—'], ['ok', '掲載してよい'], ['noface', '顔が写らなければよい'], ['no', '掲載しないでほしい']];

// ---------- data ----------
function defaultCfg() {
  return {
    cal: [3, 3, 3],                          // 校正係数（動画の圧縮率 → 試験機相当）
    band: { heel: [35, 55, 68], fore: [47, 58, 66] },   // [下限, 目安, 上限]（試験機相当の%、暫定）
    weights: [50, 30, 20],                   // クッションの使い方 / 左右のそろい具合 / 走った感覚
    a: 0.5, aLow: 0.4, lowMileage: 100,      // 活用の重みa。月間走行距離が少ないと余裕を重く見る
    lrZero: 50, lrMin: 2, qualityMin: 80, stepsGoal: 1,
    good: 80, okay: 60,                      // スコアの目安
    ref: [40, 38, 36]                        // 公称の厚さ（mm、参考表示用）
  };
}
function blank() { return { shoe: 'スケッチャーズ エアロエリート', capFps: 0, participants: [], currentId: null, activeSide: 'R', cfg: defaultCfg() }; }
function newParticipant(no) {
  return { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), no, name: `参加者${no}`, slot: '', consent: false, sns: '',
    pace: '', monthly: '', weight: '', shoeSize: '', memo: '', results: [], strikeManual: { R: '', L: '' }, subj: { discomfort: '', cont: '' }, createdAt: new Date().toISOString() };
}
function mergeCfg(c) {
  const d = defaultCfg(); if (!c) return d;
  for (const k of Object.keys(d)) if (c[k] !== undefined) d[k] = (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) ? Object.assign(d[k], c[k]) : c[k];
  return d;
}
function fixP(p) { const q = Object.assign(newParticipant(p.no || 1), p); q.results = Array.isArray(p.results) ? p.results : []; q.strikeManual = Object.assign({ R: '', L: '' }, p.strikeManual); q.subj = Object.assign({ discomfort: '', cont: '' }, p.subj); return q; }
function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.participants)) { const e = Object.assign(blank(), v); e.cfg = mergeCfg(v.cfg); e.participants = v.participants.map(fixP); return e; } } catch (e) {}
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
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const num = v => { const x = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return isFinite(x) ? x : null; };
const clamp01 = v => Math.max(0, Math.min(1, v));
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sdv = a => { if (a.length < 2) return null; const m = avg(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const f0 = v => v == null ? '—' : String(Math.round(v));
function parsePace(s) { s = String(s || '').trim().replace(/[：]/g, ':').replace(/\/km$/, ''); if (!s) return null; const pt = s.split(':').map(Number); if (pt.some(x => !isFinite(x))) return null; return pt.length >= 2 ? pt[0] * 60 + pt[1] : pt[0] * 60; }

// ---------- per step / per leg ----------
const contactOf = s => (s.last != null && s.first != null) ? s.last - s.first : null;
function tnOf(s, k) { const c = contactOf(s), pk = s.peak[k]; return pk && c > 0 ? Math.max(0, Math.min(1, pk.f / c)) : null; }
function strikeOfStep(s) {
  const on = [0, 1, 2].map(k => { for (let j = 0; j < s.frames.length; j++) { if (s.frames[j] < 0) continue; const v = s.comp[k][j]; if (v != null && v >= ONSET) return s.frames[j]; } return Infinity; });
  const [h, m, f] = on;
  if (!isFinite(Math.min(h, m, f))) return null;
  if (m < h && m < f) return 'mid';
  if (h <= f) return f - h >= 2 ? 'rear' : 'mid';
  return h - f >= 2 ? 'fore' : 'mid';
}
const legSteps = (p, side) => p.results.filter(s => (s.side || 'R') === side);
function legStats(p, side) {
  const steps = legSteps(p, side);
  const zones = [0, 1, 2].map(k => { const vals = steps.map(s => s.peak[k] && s.peak[k].v).filter(v => v != null), tns = steps.map(s => tnOf(s, k)).filter(v => v != null); return { n: vals.length, mean: avg(vals), sd: sdv(vals), tn: avg(tns) }; });
  const ms = steps.filter(s => s.capFps > 0 && contactOf(s) > 0).map(s => contactOf(s) / s.capFps * 1000);
  return { n: steps.length, zones, contactMs: avg(ms) };
}
function strikeLeg(p, side) {
  const cnt = { rear: 0, mid: 0, fore: 0 }; legSteps(p, side).forEach(s => { const t = strikeOfStep(s); if (t) cnt[t]++; });
  const total = cnt.rear + cnt.mid + cnt.fore, manual = (p.strikeManual || {})[side];
  if (manual) return { type: manual, weights: WEIGHTS[manual], manual: true, label: STRIKE_LABEL[manual] };
  if (!total) return null;
  const top = ['rear', 'mid', 'fore'].reduce((a, b) => cnt[b] > cnt[a] ? b : a, 'rear');
  if (cnt[top] > total / 2) return { type: top, weights: WEIGHTS[top], label: STRIKE_LABEL[top] };
  const w = [0, 0, 0]; ['rear', 'mid', 'fore'].forEach(t => WEIGHTS[t].forEach((v, z) => { w[z] += v * cnt[t] / total; }));
  return { type: 'mixed', weights: w, label: `混在（${['rear', 'mid', 'fore'].filter(t => cnt[t]).map(t => STRIKE_SHORT[t]).join('・')}）` };
}
function bands() { const b = E.cfg.band, h = b.heel.map(num), f = b.fore.map(num); return [h, h.map((v, j) => (v + f[j]) / 2), f]; }
const lowMileage = p => { const m = num(p.monthly); return m != null && m < (num(E.cfg.lowMileage) || 100); };
const aOf = p => lowMileage(p) ? (num(E.cfg.aLow) ?? 0.4) : (num(E.cfg.a) ?? 0.5);
function cushionLeg(p, side) {
  const st = legStats(p, side), sk = strikeLeg(p, side); if (!st.n || !sk) return null;
  const B = bands(), cal = E.cfg.cal.map(v => num(v) || 1), a = aOf(p);
  let use = 0, res = 0, ws = 0; const zones = [];
  for (let z = 0; z < 3; z++) {
    const m = st.zones[z].mean, w = sk.weights[z];
    if (m == null) { zones.push({ z, w, m: null }); continue; }
    const c = m * cal[z], [lo, tg, hi] = B[z];
    const U = clamp01((c - lo) / (tg - lo)), R = clamp01((hi - c) / (hi - tg));
    zones.push({ z, w, m, c, U, R, lo, tg, hi });
    if (w > 0) { use += w * U; res += w * R; ws += w; }
  }
  if (ws <= 0) return null;
  use /= ws; res /= ws;
  return { use, res, a, score: 100 * (a * use + (1 - a) * res), zones, strike: sk };
}
function lrScore(p) {
  const R = legStats(p, 'R'), L = legStats(p, 'L'); if (!R.n || !L.n) return null;
  const zero = num(E.cfg.lrZero) || 50, min = num(E.cfg.lrMin) ?? 2, items = [];
  for (let z = 0; z < 3; z++) {
    const mR = R.zones[z].mean, mL = L.zones[z].mean; if (mR == null || mL == null) continue;
    const mean = (mR + mL) / 2; if (mean < min) continue;
    items.push({ kind: '最大圧縮率', z, d: Math.abs(mR - mL) / mean * 100 });
    const tR = R.zones[z].tn, tL = L.zones[z].tn;
    if (tR != null && tL != null) items.push({ kind: '圧縮のタイミング', z, d: Math.abs(tR - tL) * 100 });
  }
  items.forEach(it => { it.pts = 100 * (1 - Math.min(1, it.d / zero)); });
  return { score: items.length ? avg(items.map(it => it.pts)) : null, items };
}
function feelScore(p) { const s = p.subj || {}; if (!DISC[s.discomfort] || !CONT[s.cont]) return null; return (DISC[s.discomfort][1] + CONT[s.cont][1]) / 2; }

// ---------- score ----------
function evaluate(p) {
  const C = E.cfg, out = { status: 'incomplete', missing: [], gates: [], notes: [] };
  SIDES.forEach(sd => { if (!legSteps(p, sd).length) out.missing.push(`${SIDE_LABEL[sd]}足の解析`); });
  const qMin = (num(C.qualityMin) ?? 80) / 100;
  p.results.forEach(s => {
    const where = `${SIDE_LABEL[s.side || 'R']}足（${s.video}）`;
    if (!(contactOf(s) > 0)) out.gates.push([where, '接地・離地が未入力です']);
    if (!(s.capFps > 0)) out.gates.push([where, '撮影fpsが記録されていません']);
    const sk = strikeLeg(p, s.side || 'R'), w = sk ? sk.weights : [1, 1, 1];
    if (Array.isArray(s.quality)) s.quality.forEach((q, z) => { if (w[z] >= 0.3 && q < qMin) out.gates.push([where, `${ZONES[z]}の追跡が不安定、または画面外のフレームが多くなっています（有効${Math.round(q * 100)}%）`]); });
  });
  const reso = [...new Set(p.results.map(s => `${s.vw || '?'}×${s.vh || '?'}`))], fps = [...new Set(p.results.map(s => s.capFps))];
  if (p.results.length > 1 && reso.length > 1) out.gates.push(['全体', `解像度が動画によって違います（${reso.join(' / ')}）`]);
  if (p.results.length > 1 && fps.length > 1) out.gates.push(['全体', `撮影fpsが動画によって違います（${fps.join(' / ')}）`]);
  out.legs = SIDES.map(sd => cushionLeg(p, sd));
  const legScores = out.legs.filter(Boolean).map(l => l.score);
  out.lr = lrScore(p);
  out.sub = [legScores.length === 2 ? avg(legScores) : null, out.lr ? out.lr.score : null, feelScore(p)];
  out.steps = [Math.min(...SIDES.map(sd => legSteps(p, sd).length)), Math.max(...SIDES.map(sd => legSteps(p, sd).length))];
  if (out.missing.length) return out;
  if (out.gates.length) { out.status = 'hold'; out.hold = '品質が不足している動画があります。下の動画を撮り直すと、スコアを出せる可能性があります。'; return out; }
  if (out.sub[0] == null) { out.status = 'hold'; out.hold = '着地のタイプを判定できず、クッションの使い方を計算できませんでした（どの部位も3%以上潰れていません）。'; return out; }
  const W = [0, 1, 2].map(k => num(C.weights[k]) || 0);
  if (out.sub[1] == null) { W[1] = 0; out.notes.push('どの部位も圧縮が小さく、左右を比べられなかったため、左右のそろい具合はスコアに入れていません。'); }
  if (out.sub[2] == null) W[2] = 0;
  const Ws = W.reduce((a, b) => a + b, 0) || 1;
  out.W = W; out.score = out.sub.reduce((a, v, k) => a + (W[k] ? W[k] * v : 0), 0) / Ws;
  out.level = out.score >= (num(C.good) || 80) ? 'hi' : out.score >= (num(C.okay) || 60) ? 'ok' : 'lo';
  // クッションをほとんど潰せていないときは、ほかの点が高くても「相性が良い」とはしない
  out.capped = out.level === 'hi' && avg(out.legs.map(l => l.use)) < 0.35; if (out.capped) out.level = 'ok';
  out.caution = p.subj.discomfort === 'clear' ? 'discomfort' : p.subj.cont === 'no' ? 'cont' : null;
  out.status = 'scored';
  return out;
}
const LEVEL_TEXT = { hi: '相性が良い', ok: '十分使える', lo: '力を引き出しにくい可能性' };
function reasonText(p, r) {
  const t = [], shoe = E.shoe, avgUse = avg(r.legs.map(l => l.use)), avgRes = avg(r.legs.map(l => l.res));
  const sk = r.legs.map(l => l.strike);
  t.push(sk[0].type === sk[1].type ? `着地は左右とも${sk[0].label}でした。` : `着地は右足が${sk[0].label}、左足が${sk[1].label}でした。`);
  if (avgUse >= 0.7) t.push(`着地で使う部位のクッションを、しっかり潰して使えていました。`);
  else if (avgUse >= 0.35) t.push(`着地で使う部位のクッションを、ほどよく使えていました。`);
  else t.push(`今回のペースでは、${shoe}のクッションをまだ潰し切れていませんでした。もう少し速いペースや、強く踏み込む走りで活きやすい可能性があります。`);
  if (avgRes >= 0.9) t.push('底つきまでの余裕は十分にありました。');
  else if (avgRes < 0.6) t.push('クッションが上限近くまで潰れていて、底つきまでの余裕は少なめでした。');
  if (r.sub[1] != null) {
    if (r.sub[1] >= 80) t.push('潰れ方とそのタイミングは、左右でよくそろっていました。');
    else if (r.sub[1] < 55) { const worst = r.lr.items.slice().sort((a, b) => b.d - a.d)[0]; t.push(`左右で潰れ方に差がありました（最も差が大きいのは${ZONES[worst.z]}の${worst.kind}）。`); }
    else t.push('左右の潰れ方には、少し差がありました。');
  }
  if (r.caution === 'discomfort') t.push('走ったときに明確な違和感があったため、スコアにかかわらず、無理に選ぶことはおすすめしません。');
  else if (r.caution === 'cont') t.push('このペースで走り続けやすいとは感じられていなかったため、スコアよりもご自身の感覚を優先してください。');
  else if (p.subj.discomfort === 'some') t.push('少し違和感があったとのことなので、長めに試してから判断するのがおすすめです。');
  if (r.capped) t.push('点数は高めですが、クッションをまだ潰し切れていないため、目安は「十分使える」としています。');
  r.notes.forEach(n => t.push(n));
  return t;
}
function limitText(p, r) {
  const [a, b] = r.steps, n = a === b ? `${a}` : `${a}〜${b}`;
  return [
    `左右それぞれ${n}${b > 1 ? '歩の平均' : '歩'}、数秒の走行からの推定です。疲れてきたときの変化や、レース後半の走りは評価していません。`,
    '真横から見たミッドソールの見かけの変形にもとづく簡易推定です。医学的な診断ではなく、ケガの予防、記録の向上、反発の大きさを示すものではありません。',
    'テスト版のため、判定の基準値と校正係数は暫定値です。'
  ];
}
function staffChecks(p, r) {
  const C = E.cfg, out = [];
  if (!p.consent) out.push(['warn', '撮影・データ利用の同意が未確認です。']);
  if (!p.sns) out.push(['info', '写真・動画のSNS掲載の可否が未確認です。']);
  if (!(E.capFps > 0)) out.push(['warn', '撮影fpsが未設定です。設定しないと解析結果を保存できません。']);
  const goal = Math.max(1, num(C.stepsGoal) || 1);
  SIDES.forEach(sd => { const n = legSteps(p, sd).length; if (n && n < goal) out.push(['info', `${SIDE_LABEL[sd]}足は${n}歩です（目標${goal}歩）。`]); });
  SIDES.forEach((sd, i) => { const l = r.legs && r.legs[i]; if (!l) return;
    l.zones.forEach(z => { if (z.c != null && z.c > z.hi + 10) out.push(['warn', `${SIDE_LABEL[sd]}足の${ZONES[z.z]}が試験機相当で ${z.c.toFixed(0)}% と上限（${z.hi}%）を大きく超えています。校正係数か、接地フレームの指定を確認してください。`]); });
    if (l.strike.type === 'mixed') out.push(['info', `${SIDE_LABEL[sd]}足の着地のタイプが歩ごとに分かれたため、重みを平均しました。`]);
    const st = legStats(p, sd); st.zones.forEach((z, k) => { if (l.strike.weights[k] >= 0.3 && z.sd != null && z.sd > 5) out.push(['info', `${SIDE_LABEL[sd]}足の${ZONES[k]}は歩ごとのばらつきが大きめです（SD ${z.sd.toFixed(1)}ポイント）。`]); });
  });
  if (r.status === 'scored' && r.sub[2] == null) out.push(['info', '走った感覚（2問）が未入力のため、スコアに入れていません。']);
  if (r.legs && r.legs.every(Boolean) && r.legs.every(l => l.use === 0)) out.push(['info', '両足とも「活用」が0です（試験機相当の圧縮率が下限に届いていません）。校正係数が小さすぎる可能性があります。']);
  return out;
}

// ---------- tabs & save bar ----------
function showTab(which) {
  ['home', 'analysis', 'event'].forEach(t => {
    const v = { home: '#viewHome', analysis: '#viewAnalysis', event: '#viewEvent' }[t], b = { home: '#tabHome', analysis: '#tabAnalysis', event: '#tabEvent' }[t];
    $(v).hidden = t !== which; $(b).setAttribute('aria-selected', String(t === which));
  });
  if (which === 'event') renderAll(true); else if (which === 'analysis') renderSaveBar();
  window.dispatchEvent(new Event('resize'));
}
function nextSide(p) { const goal = Math.max(1, num(E.cfg.stepsGoal) || 1); return SIDES.find(sd => legSteps(p, sd).length < goal) || null; }
function renderSaveBar() {
  const sel = $('#evSaveP'); if (!sel) return;
  sel.innerHTML = E.participants.length
    ? E.participants.map(p => `<option value="${p.id}"${p.id === E.currentId ? ' selected' : ''}>${p.slot ? esc(p.slot) + '　' : ''}${esc(p.name)}</option>`).join('')
    : '<option value="">参加者がいません</option>';
  const p = cur();
  $$('#evSideSeg button').forEach(b => { const n = p ? legSteps(p, b.dataset.s).length : 0; b.textContent = `${SIDE_LABEL[b.dataset.s]}足${p ? `（${n}）` : ''}`; b.setAttribute('aria-pressed', String(E.activeSide === b.dataset.s)); });
  const has = MSA.hasResult();
  $('#evSave').disabled = !p || !has;
  let hint = '';
  if (!E.participants.length) hint = '「相性チェック」タブで参加者を追加すると、解析結果を保存できます。';
  else if (!(E.capFps > 0)) hint = '撮影fpsが未設定です。「相性チェック」タブの設定で入れてください。';
  else if (p) { const ns = nextSide(p); hint = ns ? `次は${SIDE_LABEL[ns]}足です。${has ? '' : '解析が終わると追加できます。'}` : '左右がそろいました。「相性チェック」タブで結果を確認できます。'; }
  say('#evSaveStatus', hint);
}
function saveCurrent() {
  const p = cur(); if (!p) return;
  const snap = MSA.snapshot(); if (!snap) { say('#evSaveStatus', '先に解析を完了してください。', 'warn'); return; }
  if (!(snap.capFps > 0)) { say('#evSaveStatus', '撮影fpsが未設定のため保存できません。「相性チェック」タブの設定で撮影fpsを入れてください。', 'warn'); return; }
  if (!(contactOf(snap) > 0)) { say('#evSaveStatus', '接地と離地を指定して解析してください。', 'warn'); return; }
  snap.side = E.activeSide === 'L' ? 'L' : 'R';
  if (p.results.some(s => s.video === snap.video && s.baseAbs === snap.baseAbs && s.last === snap.last && JSON.stringify(s.peak) === JSON.stringify(snap.peak))) { say('#evSaveStatus', 'この解析はすでに追加済みです。', 'warn'); return; }
  p.results.push(snap); persist(true);
  const t = strikeOfStep(snap), n = legSteps(p, snap.side).length, ms = contactOf(snap) / snap.capFps * 1000, ns = nextSide(p);
  if (ns) { E.activeSide = ns; persist(); }
  renderSaveBar();
  say('#evSaveStatus', `${p.name}さんの${SIDE_LABEL[snap.side]}足に${n}歩目を追加しました（接地時間 ${ms.toFixed(0)} ms${t ? `、${STRIKE_SHORT[t]}接地` : ''}）。${ns ? `次は${SIDE_LABEL[ns]}足です。` : '左右がそろいました。「相性チェック」タブで結果を確認できます。'}`, 'ok');
}

// ---------- list ----------
function renderList() {
  const ul = $('#evList');
  if (!E.participants.length) { ul.innerHTML = '<li class="ev-empty">まだ参加者がいません。</li>'; return; }
  const goal = Math.max(1, num(E.cfg.stepsGoal) || 1);
  const sorted = E.participants.slice().sort((a, b) => (a.slot || '99').localeCompare(b.slot || '99') || a.no - b.no);
  ul.innerHTML = sorted.map(p => {
    const r = legSteps(p, 'R').length, l = legSteps(p, 'L').length, ok = r >= goal && l >= goal, ev = evaluate(p);
    const res = ev.status === 'scored' ? (isRevealed(p) ? `相性スコア ${Math.round(ev.score)}` : '発表まち') : ev.status === 'hold' ? 'スコア保留' : '';
    return `<li><button type="button" class="ev-item${p.id === E.currentId ? ' sel' : ''}" data-id="${p.id}">
      <span class="ev-name">${esc(p.name)}</span><span class="ev-slot">${esc(p.slot)}${p.consent ? '' : ' 同意未'}</span>
      <span class="chips"><span class="chip${ok ? ' on' : (r || l) ? ' part' : ''}">右${r}・左${l}</span>${p.shoeSize ? `<span class="chip">${esc(p.shoeSize)}cm</span>` : ''}</span>${res ? `<span class="pick">${res}</span>` : ''}</button></li>`;
  }).join('');
}

// ---------- detail ----------
function getPath(o, path) { return path.split('.').reduce((a, k) => a == null ? a : a[k], o); }
function setPath(o, path, v) { const ks = path.split('.'), last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; }
function renderDetail(force) {
  const p = cur();
  $('#evDetail').hidden = !p; $('#evNone').hidden = !!p;
  if (!p) return;
  if (force) $$('#evDetail [data-f]').forEach(el => { const v = getPath(p, el.dataset.f); if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; });
  $$('.shoe-name').forEach(el => { el.textContent = E.shoe; });
  renderPreSummary(p); renderSubj(p); renderCompare(p); renderSheet(p);
  $('#evDelete').textContent = 'この参加者を削除'; $('#evDelete').dataset.armed = '';
}
function renderPreSummary(p) {
  const pace = parsePace(p.pace);
  $('#evPreSummary').textContent = (pace ? `目標ペース キロ${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, '0')}。当日はこのペースを目安に走ってもらいます。` : '目標ペースを入れてください（例 4:58）。') + (lowMileage(p) ? '　月間走行距離が少なめのため、底つきまでの余裕をやや重く見ます。' : '');
}
function renderSubj(p) {
  const s = p.subj || {};
  const seg = (key, dict) => `<span class="seg3">${Object.entries(dict).map(([v, [lab]]) => `<button type="button" data-k="${key}" data-v="${v}" aria-pressed="${s[key] === v}">${lab}</button>`).join('')}</span>`;
  $('#evSubj').innerHTML = `<div class="q"><div class="q-label">痛み、圧迫、ぐらつきなどの違和感は？</div>${seg('discomfort', DISC)}</div><div class="q"><div class="q-label">このペースで走り続けやすそうか？</div>${seg('cont', CONT)}</div>`;
}
function renderCompare(p) {
  const has = p.results.length > 0;
  $('#evCompare').hidden = !has; $('#evNoResult').hidden = has;
  if (!has) return;
  const opt = sd => { const v = (p.strikeManual || {})[sd] || ''; return `<select class="strike-sel" data-s="${sd}" aria-label="着地のタイプ">${[['', '自動'], ['rear', 'リア'], ['mid', 'ミッド'], ['fore', 'フォア']].map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`; };
  $('#evLegTable').innerHTML = `<thead><tr><th></th><th>ヒール%</th><th>ミッド%</th><th>フォア%</th><th>接地時間 ms</th><th>最大圧縮のタイミング<br><small>ヒール / ミッド / フォア</small></th><th>着地のタイプ</th></tr></thead><tbody>${SIDES.map(sd => {
    const st = legStats(p, sd), sk = strikeLeg(p, sd);
    const z = k => st.zones[k].mean == null ? '—' : `${st.zones[k].mean.toFixed(1)}${st.zones[k].sd != null ? `<small>±${st.zones[k].sd.toFixed(1)}</small>` : ''}`;
    const tn = k => st.zones[k].tn == null ? '—' : st.zones[k].tn.toFixed(2);
    return `<tr><th>${SIDE_LABEL[sd]}足<span class="t">${st.n}歩</span></th><td>${z(0)}</td><td>${z(1)}</td><td>${z(2)}</td><td>${st.contactMs == null ? '—' : st.contactMs.toFixed(0)}</td><td>${tn(0)} / ${tn(1)} / ${tn(2)}</td><td class="sk">${sk ? esc(sk.type === 'mixed' ? sk.label : STRIKE_SHORT[sk.type]) : '—'} ${opt(sd)}</td></tr>`;
  }).join('')}</tbody>`;
  $('#evSteps').innerHTML = p.results.map((s, j) => { const t = strikeOfStep(s), c = contactOf(s);
    return `<li><span class="sn">${SIDE_LABEL[s.side || 'R']}</span><span class="sv">${s.peak.map(pk => pk ? pk.v.toFixed(1) : '—').join(' / ')}</span><span class="ss">${t ? STRIKE_SHORT[t] + '接地' : '判定不可'}${c > 0 && s.capFps > 0 ? `・${(c / s.capFps * 1000).toFixed(0)}ms` : ''}</span><span class="sf" title="${esc(s.video)}">${esc(s.video)}</span><button type="button" class="btn small" data-del="${j}">削除</button></li>`; }).join('');
  drawCurves(p);
}
function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return [ctx, w, h];
}
function drawCurves(p) {
  const zc = [cssVar('--heel'), cssVar('--mid'), cssVar('--fore')], muted = cssVar('--muted'), line = cssVar('--line');
  $$('#evCurves canvas').forEach((cv, k) => {
    if (!cv.clientWidth) return;
    const [ctx, w, h] = sizeCanvas(cv);
    let ymax = 10; p.results.forEach(s => s.comp[k].forEach(v => { if (v != null) ymax = Math.max(ymax, v + 2); })); ymax = Math.ceil(ymax / 5) * 5;
    const pad = { l: 34, r: 8, t: 8, b: 22 }, PX = x => pad.l + x * (w - pad.l - pad.r), PY = v => pad.t + (1 - v / ymax) * (h - pad.t - pad.b);
    ctx.font = '11px "IBM Plex Sans JP",system-ui,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= ymax; v += ymax > 30 ? 10 : 5) { ctx.strokeStyle = line; ctx.lineWidth = v ? 0.7 : 1.2; ctx.beginPath(); ctx.moveTo(pad.l, PY(v)); ctx.lineTo(w - pad.r, PY(v)); ctx.stroke(); ctx.fillStyle = muted; ctx.fillText(v + '%', pad.l - 4, PY(v)); }
    ctx.textBaseline = 'top'; ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.fillText('接地', pad.l, h - pad.b + 6); ctx.textAlign = 'right'; ctx.fillText('離地', w - pad.r, h - pad.b + 6);
    p.results.forEach(s => {
      const c = contactOf(s); if (!(c > 0)) return; const right = (s.side || 'R') === 'R';
      ctx.strokeStyle = zc[k]; ctx.lineWidth = 1.8; ctx.setLineDash(right ? [] : [6, 4]); ctx.beginPath(); let pen = false;
      s.frames.forEach((f, j) => { const v = s.comp[k][j]; if (v == null || f < 0 || f > c) { pen = false; return; } const x = PX(f / c), y = PY(v); if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = true; });
      ctx.stroke(); ctx.setLineDash([]);
    });
  });
}

// ---------- result sheet ----------
function renderSheet(p) {
  const r = evaluate(p), el = $('#evSheet'), checks = staffChecks(p, r);
  $('#evReplay').hidden = true;
  $('#evChecks').innerHTML = checks.length ? checks.map(([t, m]) => `<li class="${t}">${esc(m)}</li>`).join('') : '<li class="okc">気になる点はありません。</li>';
  const gates = r.gates.length ? `<h3>撮り直しが必要な動画</h3><ul class="sheet-gates">${r.gates.map(([w, m]) => `<li><b>${esc(w)}</b>　${esc(m)}</li>`).join('')}</ul>` : '';
  const head = `<div class="sheet-head"><span class="sheet-name">${esc(p.name)}さん</span><span class="sheet-meta">${esc(E.shoe)} 相性チェック${p.shoeSize ? `　${esc(p.shoeSize)}cm` : ''}${parsePace(p.pace) ? `　目標 キロ${esc(p.pace)}` : ''}</span></div>`;
  if (r.status === 'incomplete') { el.innerHTML = `${head}<div class="verdict hold"><span class="v-main">まだスコアを出せません</span></div><p class="sheet-missing">必要な情報：${esc(r.missing.join('、'))}</p>${gates}`; return; }
  if (r.status === 'hold') { el.innerHTML = `${head}<div class="verdict hold"><span class="v-main">スコア保留</span><span class="v-sub">${esc(r.hold)}</span></div>${gates}`; return; }
  // 発表前は点数を出さない（画面を切り替えた瞬間に結果が見えてしまわないように）
  $('#evReplay').hidden = !isRevealed(p);
  if (!isRevealed(p)) {
    const noFeel = !DISC[p.subj.discomfort] || !CONT[p.subj.cont];
    el.innerHTML = `${head}<div class="reveal-gate"><span class="rg-kicker">ANALYSIS COMPLETE</span><span class="rg-q">? ?</span><span class="rg-title">${esc(p.name)}さんの相性スコアが出ました</span><button type="button" class="btn primary reveal-go" data-reveal>結果を発表する</button>${noFeel ? '<p class="rg-warn">走った感覚（2問）がまだ入っていません。下の「走った感覚」に入れてから発表すると、スコアに反映されます。</p>' : ''}<p class="rg-foot">参加者と一緒に画面を見ながら押してください。</p></div>`;
    return;
  }
  const W = r.W, bar = v => v == null ? '<span class="na">未入力</span>' : `<span class="sbar"><i style="width:${Math.max(2, Math.min(100, v))}%"></i></span><b class="num">${f0(v)}</b>`;
  const subs = SUB_NAMES.map((n, k) => `<tr><th>${n}<span class="t">${W[k] ? `重み${Math.round(W[k] / W.reduce((a, b) => a + b, 0) * 100)}%` : 'スコアに含めず'}</span></th><td>${bar(r.sub[k])}</td></tr>`).join('');
  const zmax = Math.max(10, ...SIDES.flatMap(sd => legStats(p, sd).zones.map(z => z.mean || 0)));
  const zoneRows = ZONES.map((zn, k) => `<tr><th>${zn}</th>${SIDES.map(sd => { const m = legStats(p, sd).zones[k].mean; return `<td>${m == null ? '<span class="na">—</span>' : `<span class="sbar z${k}"><i style="width:${Math.max(2, m / zmax * 100)}%"></i></span><b class="num">${m.toFixed(1)}</b><small>%</small>`}</td>`; }).join('')}</tr>`).join('');
  const reasons = reasonText(p, r), limits = limitText(p, r);
  const legLine = (l, i) => `<li><b>${SIDE_LABEL[SIDES[i]]}足</b>（${esc(l.strike.label)}、重み ${l.strike.weights.map(v => v.toFixed(2)).join('/')}）：${l.zones.filter(z => z.m != null).map(z => `${ZONES[z.z]} ${z.m.toFixed(1)}%→${z.c.toFixed(0)}%（活用${z.U.toFixed(2)}・余裕${z.R.toFixed(2)}）`).join('、')} → 活用 ${l.use.toFixed(2)}、余裕 ${l.res.toFixed(2)}、a=${l.a} → ${l.score.toFixed(1)}点</li>`;
  el.innerHTML = `${head}
    <div class="score-card ${r.level}">
      <div class="score-num"><span class="num">${Math.round(r.score)}</span><small>/ 100</small></div>
      <div class="score-txt"><span class="score-label">相性スコア</span><span class="score-level">${LEVEL_TEXT[r.level]}</span>${r.caution ? '<span class="score-caution">走った感覚を優先してください</span>' : ''}</div>
      <div class="score-meter" aria-hidden="true"><i style="left:${Math.max(0, Math.min(100, r.score))}%"></i><span style="left:${num(E.cfg.okay) || 60}%"></span><span style="left:${num(E.cfg.good) || 80}%"></span></div>
    </div>
    <p class="apt-legend">${num(E.cfg.good) || 80}点以上：相性が良い　${num(E.cfg.okay) || 60}〜${(num(E.cfg.good) || 80) - 1}点：十分使える　${num(E.cfg.okay) || 60}点未満：力を引き出しにくい可能性</p>
    <div class="score-grid">
      <div><h3>スコアの内訳</h3><table class="sub-table one"><tbody>${subs}</tbody></table></div>
      <div><h3>部位ごとの潰れ方（最大圧縮率）</h3><table class="sub-table zone-table"><thead><tr><th></th><th>右足</th><th>左足</th></tr></thead><tbody>${zoneRows}</tbody></table></div>
    </div>
    <h3>わかったこと</h3><ul class="sheet-reasons">${reasons.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <h3>この結果の限界</h3><ul class="sheet-limits">${limits.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <details class="sheet-why no-print"><summary>計算の中身（スタッフ用）</summary><ul>
      ${r.legs.map(legLine).join('')}
      <li><b>左右のそろい具合</b>：${r.lr && r.lr.items.length ? r.lr.items.map(it => `${ZONES[it.z]}の${it.kind} 差${it.d.toFixed(1)}%→${it.pts.toFixed(0)}点`).join('、') : '比べられる部位なし'}</li>
      <li><b>走った感覚</b>：違和感「${DISC[p.subj.discomfort] ? DISC[p.subj.discomfort][0] : '未入力'}」、走り続けやすさ「${CONT[p.subj.cont] ? CONT[p.subj.cont][0] : '未入力'}」</li>
      <li>クッションの使い方 = 100 ×（a × 活用 +（1 − a）× 余裕）を左右で平均。相性スコア = 内訳の重み付き平均（${r.score.toFixed(1)}点）。</li>
    </ul></details>`;
}


// ---------- 結果発表の演出 ----------
const revealKey = p => p.results.map(s => s.savedAt || '').join('|');
const isRevealed = p => !!p.revealed && p.revealed === revealKey(p);
const RV = { tok: 0, p: null, r: null, final: false, fx: 0 };
const rvSleep = ms => new Promise(res => setTimeout(res, ms));
const rvCalm = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const RV_C = 2 * Math.PI * 96;
function rvColor(v) { return v >= (num(E.cfg.good) || 80) ? cssVar('--ok') : v >= (num(E.cfg.okay) || 60) ? cssVar('--accent') : '#8d8d8d'; }
function rvSet(v) {
  $('#rvNum').textContent = Math.round(v);
  $('#rvArc').setAttribute('stroke-dashoffset', String(RV_C * (1 - Math.max(0, Math.min(100, v)) / 100)));
  $('#rvRing').style.setProperty('--rc', rvColor(v));
}
function rvCountUp(target, ms, alive) {
  return new Promise(res => {
    if (ms <= 0) { rvSet(target); res(); return; }
    const t0 = performance.now(); let lastBand = -1;
    const ease = t => 1 - Math.pow(1 - t, 4); // 最後にじわっと止まる
    const tick = now => {
      if (!alive()) { res(); return; }
      const t = Math.min(1, (now - t0) / ms), v = target * ease(t);
      rvSet(v);
      const band = v >= (num(E.cfg.good) || 80) ? 2 : v >= (num(E.cfg.okay) || 60) ? 1 : 0;
      if (band !== lastBand && lastBand >= 0) { const w = $('#rvNumWrap'); w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop'); }
      lastBand = band;
      if (t < 1) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
}
function rvConfetti(n, from) {
  const cv = $('#rvFx'), dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight, my = ++RV.fx;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = [cssVar('--accent'), cssVar('--accent-ink'), cssVar('--heel'), cssVar('--mid'), cssVar('--fore'), cssVar('--ok'), '#ffffff'];
  const ps = [];
  from.forEach(([fx, fy, dir]) => { for (let i = 0; i < n; i++) {
    const a = dir + (Math.random() - 0.5) * 0.9, v = 9 + Math.random() * 11;
    ps.push({ x: fx * W, y: fy * H, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 6 + Math.random() * 7, h: 9 + Math.random() * 9, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.45, c: cols[(Math.random() * cols.length) | 0] });
  } });
  const t0 = performance.now();
  const tick = now => {
    if (RV.fx !== my) return;
    ctx.clearRect(0, 0, W, H); let any = false;
    for (const q of ps) {
      q.vy += 0.32; q.vx *= 0.985; q.vy *= 0.985; q.x += q.vx; q.y += q.vy; q.r += q.vr;
      if (q.y < H + 30) any = true;
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.r); ctx.fillStyle = q.c; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, Math.max(2, q.h * Math.abs(Math.cos(q.r * 1.7)))); ctx.restore();
    }
    if (any && now - t0 < 6000) requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(tick);
}
function rvSubsHtml(r) {
  return SUB_NAMES.map((n, k) => { const v = r.sub[k], on = !!r.W[k] && v != null;
    return `<li class="${on ? '' : 'off'}"><span class="rs-n">${n}</span><span class="rs-bar"><i data-w="${on ? Math.max(2, Math.min(100, v)) : 0}"></i></span><b class="num">${on ? Math.round(v) : '—'}</b></li>`; }).join('');
}
function rvFinal(animate) {
  const r = RV.r, score = Math.round(r.score); RV.final = true;
  $('#rvP1').hidden = true; $('#rvP2').hidden = true; $('#rvP3').hidden = false; $('#rvSkip').hidden = true;
  rvSet(score);
  $('#rvLevel').textContent = LEVEL_TEXT[r.level]; $('#rvLevel').classList.add('in');
  $$('#rvSubs li').forEach(li => { li.classList.add('in'); const i = li.querySelector('i'); i.style.width = i.dataset.w + '%'; });
  $('#rvActions').classList.add('in');
  if (animate && !rvCalm()) {
    if (r.level === 'hi') { rvConfetti(90, [[0, 0.75, -1.05], [1, 0.75, -2.09]]); setTimeout(() => RV.final && rvConfetti(70, [[0.5, 0.3, -Math.PI / 2]]), 650); }
    else if (r.level === 'ok') rvConfetti(55, [[0.5, 0.42, -Math.PI / 2]]);
  }
  setTimeout(() => $('#rvClose').focus(), 50);
}
// 店頭の大きな画面でも見やすいよう、画面の大きさに合わせて拡大する
function rvFit() { const el = document.querySelector('#rv .rv-in'); if (!el) return; const sc = Math.max(1, Math.min(1.8, innerWidth / 720, innerHeight / 790)); el.style.zoom = sc > 1.02 ? String(sc.toFixed(3)) : ''; }
window.addEventListener('resize', () => { if (!$('#rv').hidden) rvFit(); });
async function startReveal(p) {
  const r = evaluate(p); if (r.status !== 'scored') return;
  const tok = ++RV.tok, alive = () => RV.tok === tok && !$('#rv').hidden;
  RV.p = p; RV.r = r; RV.final = false; RV.fx++;
  const ov = $('#rv'), calm = rvCalm();
  ov.dataset.level = r.level; ov.hidden = false; document.body.classList.add('rv-open'); rvFit();
  $('#rvName').textContent = `${p.name}さんの相性スコア`;
  $('#rvP1').hidden = false; $('#rvP2').hidden = true; $('#rvP3').hidden = true; $('#rvSkip').hidden = false;
  $('#rvLevel').classList.remove('in'); $('#rvActions').classList.remove('in'); $('#rvSubs').innerHTML = rvSubsHtml(r); rvSet(0);
  $('#rvSkip').focus();
  if (calm) { rvFinal(false); return; }
  // 1) 計算中
  const prog = $('#rvProg'); prog.style.transition = 'none'; prog.style.width = '0'; void prog.offsetWidth; prog.style.transition = ''; prog.style.width = '100%';
  const msgs = ['右足の潰れ方を読み込んでいます', '左足の潰れ方と比べています', '走った感覚を合わせています', '相性スコアを計算しています'];
  for (const m of msgs) {
    if (!alive()) return;
    const el = $('#rvMsg'); el.classList.add('fade'); await rvSleep(180); el.textContent = m; el.classList.remove('fade');
    await rvSleep(680);
  }
  if (!alive()) return;
  // 2) 結果発表！
  $('#rvP1').hidden = true; $('#rvP2').hidden = false;
  await rvSleep(1200); if (!alive()) return;
  // 3) スコアが上がっていく
  $('#rvP2').hidden = true; $('#rvP3').hidden = false;
  await rvSleep(250); if (!alive()) return;
  await rvCountUp(Math.round(r.score), 2900, alive); if (!alive()) return;
  const w = $('#rvNumWrap'); w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop');
  const ring = $('#rvRing'); ring.classList.remove('flash'); void ring.offsetWidth; ring.classList.add('flash');
  RV.final = true; $('#rvSkip').hidden = true;
  if (r.level === 'hi') { rvConfetti(90, [[0, 0.75, -1.05], [1, 0.75, -2.09]]); setTimeout(() => alive() && rvConfetti(70, [[0.5, 0.3, -Math.PI / 2]]), 650); }
  else if (r.level === 'ok') rvConfetti(55, [[0.5, 0.42, -Math.PI / 2]]);
  await rvSleep(450); if (!alive()) return;
  $('#rvLevel').textContent = LEVEL_TEXT[r.level]; $('#rvLevel').classList.add('in');
  await rvSleep(800);
  for (const li of $$('#rvSubs li')) { if (!alive()) return; li.classList.add('in'); const i = li.querySelector('i'); requestAnimationFrame(() => { i.style.width = i.dataset.w + '%'; }); await rvSleep(380); }
  await rvSleep(500); if (!alive()) return;
  $('#rvActions').classList.add('in'); $('#rvClose').focus();
}
function closeReveal() {
  const p = RV.p; RV.tok++; RV.fx++;
  $('#rv').hidden = true; document.body.classList.remove('rv-open');
  const cv = $('#rvFx'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  if (p) { p.revealed = revealKey(p); persist(true); renderList(); renderSheet(p); }
  const sp = $('#evSheetPanel'); if (sp) sp.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
$('#evSheet').addEventListener('click', e => { if (e.target.closest('[data-reveal]')) { const p = cur(); if (p) startReveal(p); } });
$('#evReplay').addEventListener('click', () => { const p = cur(); if (p) startReveal(p); });
$('#rvSkip').addEventListener('click', () => { RV.tok++; rvFinal(true); });
$('#rvClose').addEventListener('click', closeReveal);
document.addEventListener('keydown', e => {
  if ($('#rv').hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); if (RV.final) closeReveal(); else { RV.tok++; rvFinal(true); } }
}, true);

// ---------- export / backup ----------
const csvEsc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const f2 = v => v == null ? '' : (+v).toFixed(2);
function buildCSV() {
  const head = ['no', 'name', 'slot', 'consent', 'sns', 'target_pace', 'monthly_km_band', 'weight_kg', 'shoe_size', 'shoe'];
  SIDES.forEach(sd => head.push(`${sd}_steps`, `${sd}_strike`, `${sd}_heel`, `${sd}_mid`, `${sd}_fore`, `${sd}_contact_ms`, `${sd}_tn_heel`, `${sd}_tn_mid`, `${sd}_tn_fore`, `${sd}_use`, `${sd}_reserve`, `${sd}_cushion`));
  head.push('cushion', 'lr', 'feel', 'score', 'level', 'status', 'discomfort', 'continuability', 'findings', 'quality_gates', 'staff_checks', 'memo', 'calibration', 'band_heel', 'band_fore', 'weights', 'a');
  const rows = [head.join(',')];
  E.participants.forEach(p => {
    const r = evaluate(p), checks = staffChecks(p, r), mb = MONTHLY.find(m => m[0] === String(p.monthly));
    const row = [p.no, p.name, p.slot, p.consent ? 1 : 0, (SNS.find(s => s[0] === p.sns) || ['', ''])[1], p.pace, mb ? mb[1] : '', p.weight, p.shoeSize, E.shoe];
    SIDES.forEach((sd, i) => { const st = legStats(p, sd), l = r.legs && r.legs[i]; row.push(st.n, l ? l.strike.label : '', ...st.zones.map(z => f2(z.mean)), f2(st.contactMs), ...st.zones.map(z => f2(z.tn)), l ? f2(l.use) : '', l ? f2(l.res) : '', l ? f2(l.score) : ''); });
    row.push(f2(r.sub[0]), f2(r.sub[1]), f2(r.sub[2]), r.status === 'scored' ? f2(r.score) : '', r.status === 'scored' ? LEVEL_TEXT[r.level] : '', r.status === 'scored' ? 'スコアあり' : r.status === 'hold' ? 'スコア保留' : '未完了',
      DISC[p.subj.discomfort] ? DISC[p.subj.discomfort][0] : '', CONT[p.subj.cont] ? CONT[p.subj.cont][0] : '', r.status === 'scored' ? reasonText(p, r).join(' / ') : (r.hold || ''), r.gates.map(g => g.join('：')).join(' / '), checks.map(c => c[1]).join(' / '),
      p.memo, E.cfg.cal.join('/'), E.cfg.band.heel.join('/'), E.cfg.band.fore.join('/'), E.cfg.weights.join('/'), aOf(p));
    rows.push(row.map(csvEsc).join(','));
  });
  return '﻿' + rows.join('\r\n') + '\r\n';
}
function buildStepsCSV() {
  const head = ['no', 'name', 'side', 'step', 'video', 'capture_fps', 'resolution', 'contact_frames', 'contact_ms', 'heel_peak', 'mid_peak', 'fore_peak', 'tn_heel', 'tn_mid', 'tn_fore', 'strike', 'quality_heel', 'quality_mid', 'quality_fore', 'mm_per_px', 'heel_h0_mm', 'mid_h0_mm', 'fore_h0_mm'];
  const rows = [head.join(',')];
  E.participants.forEach(p => { const cnt = {}; p.results.forEach(s => {
    const sd = s.side || 'R', c = contactOf(s), q = s.quality || [], mmp = s.mmPerPx || null, h0 = s.h0 || []; cnt[sd] = (cnt[sd] || 0) + 1;
    rows.push([p.no, p.name, SIDE_LABEL[sd], cnt[sd], s.video, s.capFps, s.vw ? `${s.vw}x${s.vh}` : '', c, c > 0 && s.capFps > 0 ? (c / s.capFps * 1000).toFixed(1) : '', ...s.peak.map(pk => pk ? pk.v.toFixed(2) : ''), ...[0, 1, 2].map(k => f2(tnOf(s, k))), strikeOfStep(s) || '',
      ...[0, 1, 2].map(k => q[k] != null ? (q[k] * 100).toFixed(0) : ''), mmp ? mmp.toFixed(4) : '', ...[0, 1, 2].map(k => mmp && h0[k] ? (h0[k] * mmp).toFixed(2) : '')].map(csvEsc).join(','));
  }); });
  return '﻿' + rows.join('\r\n') + '\r\n';
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
      if (!v || v.app !== 'midsole-analyzer-aero' || !Array.isArray(v.participants)) throw new Error('このアプリのバックアップではありません');
      let added = 0, updated = 0;
      v.participants.map(fixP).forEach(np => { const i = E.participants.findIndex(p => p.id === np.id); if (i >= 0) { E.participants[i] = np; updated++; } else { E.participants.push(np); added++; } });
      if (v.shoe) E.shoe = v.shoe; if (v.cfg) E.cfg = mergeCfg(v.cfg); if (v.capFps) E.capFps = v.capFps;
      if (!cur() && E.participants.length) E.currentId = E.participants[0].id;
      persist(true); applySettings(); renderAll(true);
      say('#evDataStatus', `読み込みました（追加${added}人、更新${updated}人）。`, 'ok');
    } catch (e) { say('#evDataStatus', `読み込めませんでした：${e.message}`, 'warn'); }
  };
  fr.readAsText(file);
}

// ---------- settings & events ----------
function applySettings() {
  $('#evShoe').value = E.shoe; $('#evCapFps').value = E.capFps || '';
  $$('[data-cfg]').forEach(el => { const v = getPath(E.cfg, el.dataset.cfg); el.value = v ?? ''; });
  const cf = $('#capfps'); if (cf && E.capFps && +cf.value !== E.capFps) { cf.value = E.capFps; cf.dispatchEvent(new Event('input')); }
}
function renderAll(force) { renderList(); renderDetail(force); renderSaveBar(); }
let liveTimer = null;
function refreshLive() { clearTimeout(liveTimer); liveTimer = setTimeout(() => { const p = cur(); if (!p) return; renderList(); renderPreSummary(p); renderSheet(p); }, 150); }
function addParticipant() {
  const n = E.participants.reduce((m, p) => Math.max(m, p.no || 0), 0) + 1, p = newParticipant(n);
  p.slot = SLOTS.find(s => !E.participants.some(q => q.slot === s)) || '';
  E.participants.push(p); E.currentId = p.id; E.activeSide = 'R'; persist(true); renderAll(true);
  const nm = $('#evName'); if (nm) { nm.focus(); nm.select(); }
}
const fill = (sel, opts) => { $(sel).innerHTML = opts.map(o => Array.isArray(o) ? `<option value="${o[0]}">${o[1]}</option>` : `<option value="${o}">${o}</option>`).join(''); };
fill('#evSlot', [['', '—']].concat(SLOTS)); fill('#evMonthly', MONTHLY); fill('#evSize', [['', '—']].concat(SIZES)); fill('#evSns', SNS);
$('#tabHome').addEventListener('click', () => showTab('home'));
$('#tabAnalysis').addEventListener('click', () => showTab('analysis'));
$('#tabEvent').addEventListener('click', () => showTab('event'));
$('#homeStart').addEventListener('click', () => showTab('event'));
$('#evAdd').addEventListener('click', addParticipant);
$('#evAdd2').addEventListener('click', addParticipant);
$('#evList').addEventListener('click', e => { const b = e.target.closest('.ev-item'); if (!b) return; E.currentId = b.dataset.id; const p = cur(); E.activeSide = (p && nextSide(p)) || 'R'; persist(); renderAll(true); });
$('#evSaveP').addEventListener('change', e => { E.currentId = e.target.value || null; const p = cur(); E.activeSide = (p && nextSide(p)) || 'R'; persist(); renderSaveBar(); });
$$('#evSideSeg button').forEach(b => b.addEventListener('click', () => { E.activeSide = b.dataset.s; persist(); renderSaveBar(); }));
$('#evSave').addEventListener('click', saveCurrent);
$('#evDetail').addEventListener('input', e => { const el = e.target, p = cur(); if (!p || !el.dataset.f) return; setPath(p, el.dataset.f, el.type === 'checkbox' ? el.checked : el.value); persist(); if (el.dataset.f === 'name' || el.dataset.f === 'slot') renderSaveBar(); refreshLive(); });
$('#evDetail').addEventListener('change', e => { const el = e.target; if (el.dataset.f && (el.tagName === 'SELECT' || el.type === 'checkbox')) el.dispatchEvent(new Event('input', { bubbles: true })); });
$('#evSubj').addEventListener('click', e => { const b = e.target.closest('button[data-k]'), p = cur(); if (!b || !p) return; p.subj[b.dataset.k] = p.subj[b.dataset.k] === b.dataset.v ? '' : b.dataset.v; persist(); renderSubj(p); renderSheet(p); renderList(); });
$('#evCompare').addEventListener('change', e => { const s = e.target.closest('.strike-sel'), p = cur(); if (!s || !p) return; p.strikeManual[s.dataset.s] = s.value; persist(true); renderCompare(p); renderSheet(p); renderList(); });
$('#evCompare').addEventListener('click', e => {
  const b = e.target.closest('button[data-del]'), p = cur(); if (!b || !p) return;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '本当に削除'; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = '削除'; } }, 3000); return; }
  p.results.splice(+b.dataset.del, 1); persist(true); renderAll();
});
$('#evDelete').addEventListener('click', e => {
  const btn = e.currentTarget, p = cur(); if (!p) return;
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'もう一度押すと削除します'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'この参加者を削除'; }, 4000); return; }
  E.participants = E.participants.filter(q => q.id !== p.id); E.currentId = E.participants.length ? E.participants[E.participants.length - 1].id : null; persist(true); renderAll(true);
});
$('#evPrint').addEventListener('click', () => { try { window.print(); } catch (e) {} });
$('#evShoe').addEventListener('input', e => { E.shoe = e.target.value || 'シューズ'; persist(); renderAll(); });
$('#evCapFps').addEventListener('input', e => { E.capFps = +e.target.value > 0 ? +e.target.value : 0; persist(); const cf = $('#capfps'); if (cf) { cf.value = E.capFps || ''; cf.dispatchEvent(new Event('input')); } renderAll(); });
$$('[data-cfg]').forEach(el => el.addEventListener('input', () => { setPath(E.cfg, el.dataset.cfg, el.value); persist(); const p = cur(); if (p) { renderCompare(p); renderSheet(p); } renderList(); renderSaveBar(); }));
$('#evCfgReset').addEventListener('click', () => { E.cfg = defaultCfg(); persist(true); applySettings(); renderAll(); say('#evDataStatus', '判定の設定を初期値に戻しました。', 'ok'); });
$('#evCsv').addEventListener('click', () => { if (!E.participants.length) { say('#evDataStatus', '書き出す参加者がいません。', 'warn'); return; } exportFile(buildCSV(), `エアロエリート相性チェック_${stamp()}.csv`, 'CSVを保存しました。'); });
$('#evStepsCsv').addEventListener('click', () => { if (!E.participants.length) { say('#evDataStatus', '書き出す参加者がいません。', 'warn'); return; } exportFile(buildStepsCSV(), `エアロエリート相性チェック_歩ごと_${stamp()}.csv`, '歩ごとのCSVを保存しました。'); });
$('#evBackup').addEventListener('click', () => exportFile(JSON.stringify({ app: 'midsole-analyzer-aero', version: 1, exportedAt: new Date().toISOString(), shoe: E.shoe, capFps: E.capFps, cfg: E.cfg, participants: E.participants }), `相性チェック_バックアップ_${stamp()}.json`, 'バックアップを保存しました。'));
$('#evRestore').addEventListener('click', () => $('#evRestoreFile').click());
$('#evRestoreFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) restore(f); e.target.value = ''; });
$('#evClear').addEventListener('click', e => {
  const btn = e.currentTarget;
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'もう一度押すと全員分を削除します'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '全データを削除'; }, 4000); return; }
  E = Object.assign(blank(), { shoe: E.shoe, capFps: E.capFps, cfg: E.cfg }); persist(true); renderAll(true); btn.dataset.armed = ''; btn.textContent = '全データを削除'; say('#evDataStatus', '全データを削除しました。');
});
window.addEventListener('msa:update', renderSaveBar);
let rz = null; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const p = cur(); if (!$('#viewEvent').hidden && p) drawCurves(p); }, 80); });
window.MSAEvent = { evaluate: id => { const p = E.participants.find(q => q.id === id) || cur(); return p ? evaluate(p) : null; } };
applySettings(); renderAll(true); showTab('home');
})();
