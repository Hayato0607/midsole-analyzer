// 体験会モード：マラソンペース適合プロファイル（2足 × 左右の外側、サブスコア3つ、結果は第1候補／明確な差なし／判定保留、信頼度は「限定的」）
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const MSA = window.MSA;
const KEY = 'msa-event-v1';
const CFG_VER = 7;
const ZONES = ['ヒール', 'ミッド', 'フォア'];
const SIDES = ['R', 'L'];
const SIDE_LABEL = { R: '右', L: '左' };
const ONSET = 3;                    // 潰れ始め：荷重なし（接地の瞬間）から3%以上
const STRIKE_LABEL = { rear: 'リア接地', mid: 'ミッド接地', fore: 'フォア接地' };
const WEIGHTS = { rear: [0.6, 0.1, 0.3], mid: [0.1, 0.5, 0.4], fore: [0, 0.2, 0.8] };
const SUB_NAMES = ['クッションの使い方', '左右整合性', '継続許容性'];
const FACE_LABEL = { lat: '外側', med: '内側' };
const DISC = { none: ['なし', 100], some: ['少しあり', 50], clear: ['明確にあり', 0] };
const CONT = { yes: ['はい', 100], neutral: ['どちらともいえない', 50], no: ['いいえ', 0] };
const MARATHON = 42.195;
const MONTHLY_LOW = 150;            // 月間走行距離（km）がこれ未満なら、底つきまでの余裕を重く見る
const D_WIN = 1.0;                  // D がこれ以上なら第1候補

// ---------- data ----------
function defaultCfg() {
  return {
    cal: [3, 3, 3],                                        // 校正係数（部位ごと、2足共通）
    bandA: { heel: [38, 59, 70], fore: [46, 57, 64] },     // [下限, 目安, 上限]（試験機相当の%）
    bandB: { heel: [31, 52, 65], fore: [48, 60, 69] },
    weights: [35, 25, 20],                                 // クッションの使い方 / 左右整合性 / 継続許容性
    unitDiff: 10,                                          // 基準差（点）：D = 合計の差 ÷ 基準差
    lrZero: 50,                                            // 左右の差がこの値（%）で0点
    lrMin: 2,                                              // 圧縮率の平均がこの値（%）未満の部位は左右整合性から外す
    qualityMin: 80,                                        // 有効フレームの割合（%）がこれ未満なら品質ゲート
    stepsGoal: 1,                                          // 片脚あたりの目標歩数
    refA: [35.9, 32.45, 29.0], refB: [39.2, 35.8, 32.4]    // 実測の厚さ（mm、品質チェック用）
  };
}
function blank() { return { shoes: ['マジックスピード5', 'YOGIRI SPEED'], capFps: 0, participants: [], currentId: null, activeShoe: 0, activeSide: 'R', cfg: defaultCfg(), cfgVer: CFG_VER }; }
function newParticipant(no) {
  return { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), no, name: `参加者${no}`, slot: '', consent: false,
    pace: '', monthly: '', weight: '', shoeSize: '', concern: '', results: [[], []],
    strikeManual: [{ R: '', L: '' }, { R: '', L: '' }], subj: [{ discomfort: '', cont: '' }, { discomfort: '', cont: '' }],
    choice: '', reason: '', createdAt: new Date().toISOString() };
}
function parseTime(s) {
  s = String(s || '').trim().replace(/[：]/g, ':'); if (!s) return null;
  const pt = s.split(':').map(Number); if (pt.some(x => !isFinite(x))) return null;
  return pt.length === 3 ? pt[0] * 3600 + pt[1] * 60 + pt[2] : pt.length === 2 ? pt[0] * 60 + pt[1] : pt[0] * 60;
}
const fmtPace = sec => sec == null ? '—' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
function migrate(p) {
  const q = Object.assign(newParticipant(p.no || 1), p);
  q.id = p.id || q.id;
  q.results = [0, 1].map(i => { const r = p.results && p.results[i]; const l = Array.isArray(r) ? r : (r ? [r] : []); l.forEach(s => { if (!s.side) s.side = 'R'; if (!s.face) s.face = 'lat'; }); return l; });
  if (!Array.isArray(p.strikeManual)) { const m = p.strikeManualBy || ['', '']; q.strikeManual = [0, 1].map(i => ({ R: m[i] || '', L: m[i] || '' })); }
  if (!Array.isArray(p.subj)) q.subj = [{ discomfort: '', cont: '' }, { discomfort: '', cont: '' }];
  if (!q.pace && p.race && p.race.dist === 'フル' && p.race.time) { const t = parseTime(p.race.time); if (t) q.pace = fmtPace(t > 3600 ? t / MARATHON : t * 60 / MARATHON); }
  if (!q.shoeSize && p.size) q.shoeSize = p.size;
  ['pb', 'race', 'longest', 'pronation', 'highInstep', 'size', 'strikeManualBy', 'ratings', 'comments', 'usualRace', 'usualTrain', 'msExp', 'msLegTired', 'style', 'selfStrike', 'carbon', 'width', 'usual', 'goal'].forEach(k => delete q[k]);
  return q;
}
function mergeCfg(c, ver) {
  const d = defaultCfg(); if (!c) return d;
  for (const k of Object.keys(d)) if (c[k] !== undefined) d[k] = (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) ? Object.assign(d[k], c[k]) : c[k];
  if ((ver || 0) < 5) d.cal = [3, 3, 3];
  if (Array.isArray(d.weights) && d.weights.length === 4) d.weights = [d.weights[0], d.weights[1], d.weights[3]];  // 内外バランスを外す
  if ((ver || 0) < 6 || !Array.isArray(d.weights) || d.weights.length !== 3) d.weights = [35, 25, 20];
  return d;
}
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Array.isArray(v.participants)) { const e = Object.assign(blank(), v); e.cfg = mergeCfg(v.cfg, v.cfgVer); e.cfgVer = CFG_VER; e.participants = v.participants.map(migrate); if (e.activeSide !== 'L') e.activeSide = 'R'; return e; }
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
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sdv = a => { if (a.length < 2) return null; const m = avg(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const firstShoe = p => (p.no || 1) % 2 === 1 ? 0 : 1;
const f1 = v => v == null ? '—' : (+v).toFixed(1);
const f0 = v => v == null ? '—' : String(Math.round(v));

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
const faceOf = s => s.face === 'med' ? 'med' : 'lat';
const legSteps = (p, i, side, face = 'lat') => (p.results[i] || []).filter(s => (s.side || 'R') === side && faceOf(s) === face);
function onsetTn(s, k) { const c = contactOf(s); if (!(c > 0)) return null; for (let j = 0; j < s.frames.length; j++) { if (s.frames[j] < 0) continue; const v = s.comp[k][j]; if (v != null && v >= ONSET) return Math.min(1, s.frames[j] / c); } return null; }
function legStats(p, i, side, face = 'lat') {
  const steps = legSteps(p, i, side, face);
  const zones = [0, 1, 2].map(k => {
    const vals = steps.map(s => s.peak[k] && s.peak[k].v).filter(v => v != null), tns = steps.map(s => tnOf(s, k)).filter(v => v != null);
    const ons = steps.map(s => onsetTn(s, k)).filter(v => v != null);
    return { n: vals.length, mean: avg(vals), sd: sdv(vals), tn: avg(tns), on: avg(ons) };
  });
  const ms = steps.filter(s => s.capFps > 0 && contactOf(s) > 0).map(s => contactOf(s) / s.capFps * 1000);
  return { n: steps.length, zones, contactMs: avg(ms), contactFrames: avg(steps.map(contactOf).filter(v => v > 0)) };
}
function strikeLeg(p, i, side) {
  const cnt = { rear: 0, mid: 0, fore: 0 }; legSteps(p, i, side).forEach(s => { const t = strikeOfStep(s); if (t) cnt[t]++; });
  const total = cnt.rear + cnt.mid + cnt.fore, manual = ((p.strikeManual || [])[i] || {})[side];
  if (manual) return { type: manual, weights: WEIGHTS[manual], cnt, total, manual: true, label: STRIKE_LABEL[manual] };
  if (!total) return null;
  const top = ['rear', 'mid', 'fore'].reduce((a, b) => cnt[b] > cnt[a] ? b : a, 'rear');
  if (cnt[top] > total / 2) return { type: top, weights: WEIGHTS[top], cnt, total, label: STRIKE_LABEL[top] };
  const w = [0, 0, 0]; ['rear', 'mid', 'fore'].forEach(t => WEIGHTS[t].forEach((v, z) => { w[z] += v * cnt[t] / total; }));
  return { type: 'mixed', weights: w, cnt, total, label: `混在（${['rear', 'mid', 'fore'].filter(t => cnt[t]).map(t => STRIKE_LABEL[t].replace('接地', '')).join('・')}）` };
}
function bandsOf(i) {
  const b = i ? E.cfg.bandB : E.cfg.bandA, h = b.heel.map(num), f = b.fore.map(num);
  return [h, h.map((v, j) => (v + f[j]) / 2), f];
}
const lowMileage = p => { const m = num(p.monthly); return m != null && m < MONTHLY_LOW; };
const aOf = p => lowMileage(p) ? 0.15 : 0.25;
function cushionLeg(p, i, side) {
  const st = legStats(p, i, side), sk = strikeLeg(p, i, side); if (!st.n || !sk) return null;
  const bands = bandsOf(i), cal = E.cfg.cal.map(v => num(v) || 1), a = aOf(p);
  let use = 0, res = 0, ws = 0; const zones = [];
  for (let z = 0; z < 3; z++) {
    const m = st.zones[z].mean, w = sk.weights[z];
    if (m == null) { zones.push({ z, w, m: null }); continue; }
    const c = m * cal[z], [lo, tg, hi] = bands[z];
    const U = clamp01((c - lo) / (tg - lo)), R = clamp01((hi - c) / (hi - tg));
    zones.push({ z, w, m, c, U, R, hi });
    if (w > 0) { use += w * U; res += w * R; ws += w; }
  }
  if (ws <= 0) return null;
  use /= ws; res /= ws;
  return { use, res, a, score: 100 * (a * use + (1 - a) * res), zones, strike: sk };
}
function cushionShoe(p, i) { const l = SIDES.map(sd => cushionLeg(p, i, sd)).filter(Boolean); return l.length ? { score: avg(l.map(x => x.score)), legs: SIDES.map(sd => cushionLeg(p, i, sd)) } : null; }
function lrShoe(p, i) {
  const R = legStats(p, i, 'R'), L = legStats(p, i, 'L'); if (!R.n || !L.n) return null;
  const zero = num(E.cfg.lrZero) || 50, min = num(E.cfg.lrMin) ?? 2, items = [];
  for (let z = 0; z < 3; z++) {
    const mR = R.zones[z].mean, mL = L.zones[z].mean; if (mR == null || mL == null) continue;
    const mean = (mR + mL) / 2; if (mean < min) continue;
    items.push({ kind: '最大圧縮率', z, d: Math.abs(mR - mL) / mean * 100 });
    const tR = R.zones[z].tn, tL = L.zones[z].tn;
    if (tR != null && tL != null) items.push({ kind: '圧縮の時刻', z, d: Math.abs(tR - tL) * 100 });
  }
  if (!items.length) return { score: null, items };
  items.forEach(it => { it.pts = 100 * (1 - Math.min(1, it.d / zero)); });
  return { score: avg(items.map(it => it.pts)), items };
}
function contShoe(p, i) { const s = p.subj[i] || {}; if (!DISC[s.discomfort] || !CONT[s.cont]) return null; return (DISC[s.discomfort][1] + CONT[s.cont][1]) / 2; }

// ---------- decision ----------
function stepsRange(p) { const n = []; [0, 1].forEach(i => SIDES.forEach(sd => n.push(legSteps(p, i, sd).length))); return [Math.min(...n), Math.max(...n)]; }
function decide(p) {
  const C = E.cfg, A = shoeName(0), B = shoeName(1), out = { status: 'incomplete', missing: [], gates: [], holds: [], notes: [] };
  [0, 1].forEach(i => SIDES.forEach(sd => { if (!legSteps(p, i, sd).length) out.missing.push(`${shoeName(i)}の${SIDE_LABEL[sd]}脚の解析`); }));
  [0, 1].forEach(i => { if (contShoe(p, i) == null) out.missing.push(`${shoeName(i)}の主観評価（2問）`); });
  // 品質ゲート（外側の動画だけを使う）
  const all = []; [0, 1].forEach(i => (p.results[i] || []).filter(s => faceOf(s) === 'lat').forEach(s => all.push({ s, i })));
  const qMin = (num(C.qualityMin) ?? 80) / 100;
  all.forEach(({ s, i }) => {
    const where = `${shoeName(i)}・${SIDE_LABEL[s.side || 'R']}脚（${s.video}）`;
    if (!(contactOf(s) > 0)) out.gates.push([where, '接地・離地が未入力です']);
    if (!(s.capFps > 0)) out.gates.push([where, '撮影fpsが記録されていません']);
    const sk = strikeLeg(p, i, s.side || 'R'), w = sk ? sk.weights : [1, 1, 1];
    if (Array.isArray(s.quality)) s.quality.forEach((q, z) => { if (w[z] >= 0.3 && q < qMin) out.gates.push([where, `${ZONES[z]}の追跡が不安定、または画面外のフレームが多くなっています（有効${Math.round(q * 100)}%）`]); });
  });
  const fps = [...new Set(all.map(x => x.s.capFps))], reso = [...new Set(all.map(x => `${x.s.vw || '?'}×${x.s.vh || '?'}`))];
  if (all.length > 1 && fps.length > 1) out.gates.push(['全体', `撮影fpsが動画によって違います（${fps.join(' / ')}）`]);
  if (all.length > 1 && reso.length > 1) out.gates.push(['全体', `解像度が動画によって違います（${reso.join(' / ')}）`]);
  // サブスコア（そろっている分だけ計算しておく）
  out.cush = [0, 1].map(i => cushionShoe(p, i)); out.lr = [0, 1].map(i => lrShoe(p, i)); out.cont = [0, 1].map(i => contShoe(p, i));
  out.sub = [0, 1].map(i => [out.cush[i] && out.cush[i].score, out.lr[i] && out.lr[i].score, out.cont[i]]);
  const W = [0, 1, 2].map(k => num(C.weights[k]) || 0);
  const Ws = W.reduce((a, b) => a + b, 0) || 1; out.W = W;
  out.total = out.sub.map(s => s.every((v, k) => v != null || W[k] === 0) ? s.reduce((a, v, k) => a + (W[k] ? W[k] * v : 0), 0) / Ws : null);
  const [nMin, nMax] = all.length ? stepsRange(p) : [0, 0]; out.steps = [nMin, nMax];
  if (out.missing.length) { out.status = 'incomplete'; return out; }
  if (out.gates.length) { out.status = 'hold'; out.holds.push('品質が不足している動画があります。下の動画を撮り直すと判定できる可能性があります。'); return out; }
  if (out.lr.some(x => !x || x.score == null)) { out.status = 'hold'; out.holds.push('左右を比べられる部位がありません（どの部位も圧縮率が小さすぎます）。'); return out; }
  if (out.cush.some(x => !x)) { out.status = 'hold'; out.holds.push('接地タイプを判定できず、クッションの使い方を計算できませんでした。'); return out; }
  // 主観評価は継続許容性の点数としてだけ使い、判定から外す条件にはしない
  [0, 1].forEach(i => { if (p.subj[i].discomfort === 'some') out.notes.push(`${shoeName(i)}は少し違和感がありました。`); });
  const legD = SIDES.map(sd => { const a = cushionLeg(p, 0, sd), b = cushionLeg(p, 1, sd); return a && b ? b.score - a.score : null; });
  out.legD = legD;
  const unit = num(C.unitDiff) || 10;
  out.diff = out.total[1] - out.total[0]; out.D = Math.abs(out.diff) / unit; out.better = out.diff > 0 ? 1 : 0;
  // 左右で結論が逆、または指標が競合 → 明確な差なし
  if (legD[0] != null && legD[1] != null && legD[0] * legD[1] < 0 && Math.min(Math.abs(legD[0]), Math.abs(legD[1])) >= 1) {
    out.status = 'nodiff'; out.why = `クッションの使い方で、右脚は${shoeName(legD[0] > 0 ? 1 : 0)}、左脚は${shoeName(legD[1] > 0 ? 1 : 0)}が上回り、左右で結論が逆になりました。`; return out;
  }
  const dC = out.sub[1][0] - out.sub[0][0], dLR = out.sub[1][1] - out.sub[0][1];
  if (dC * dLR < 0 && Math.abs(dC) >= unit && Math.abs(dLR) >= unit) {
    out.status = 'nodiff'; out.why = `クッションの使い方は${shoeName(dC > 0 ? 1 : 0)}、左右整合性は${shoeName(dLR > 0 ? 1 : 0)}を支持していて、指標が競合しています。`; return out;
  }
  if (out.D >= D_WIN) { out.status = 'winner'; out.winner = out.better; return out; }
  out.status = 'nodiff';
  return out;
}
function headline(r) {
  if (r.status === 'winner') return { main: `長時間走で試す第1候補：${shoeName(r.winner)}`, sub: '（判定信頼度：限定的。長めの練習で追加の試走をおすすめします）', cls: r.winner ? 'B' : 'A' };
  if (r.status === 'nodiff') return { main: '明確な差なし', sub: '', cls: 'either' };
  if (r.status === 'hold') return { main: '判定保留', sub: '', cls: 'hold' };
  return { main: 'まだ判定できません', sub: '', cls: 'hold' };
}
function reasonText(p, r) {
  const t = [];
  if (r.status === 'winner') {
    const w = r.winner, l = 1 - w, s = r.sub, parts = [], nums = [];
    if (s[w][0] - s[l][0] >= 5) { parts.push(['クッションをうまく使えていて', 'クッションをうまく使えていました']); nums.push(`クッションの使い方 ${f0(s[w][0])}点 対 ${f0(s[l][0])}点`); }
    if (s[w][1] - s[l][1] >= 5) { parts.push(['左右の最大圧縮率と圧縮タイミングがそろっていて', '左右の最大圧縮率と圧縮タイミングがそろっていました']); nums.push(`左右整合性 ${f0(s[w][1])}点 対 ${f0(s[l][1])}点`); }
    if (s[w][2] - s[l][2] >= 5) { parts.push(['走り続けやすさの評価も高く', '走り続けやすさの評価も高めでした']); nums.push(`継続許容性 ${f0(s[w][2])}点 対 ${f0(s[l][2])}点`); }
    const body = parts.length ? parts.slice(0, -1).map(x => x[0]).join('、') + (parts.length > 1 ? '、' : '') + parts[parts.length - 1][1] : 'サブスコアの合計で上回りました';
    t.push(`今回のマラソンペースでは、${shoeName(w)}の方が${body}${nums.length ? `（${nums.join('、')}）` : `（合計の差 ${f0(Math.abs(r.diff))}点）`}。`);
  } else if (r.status === 'nodiff') {
    if (r.why) t.push(`${r.why}そのため、はっきりした差とは判断しませんでした。`);
    else t.push(`2足のサブスコアの合計の差は ${f1(Math.abs(r.diff))}点で、基準差（${num(E.cfg.unitDiff) || 10}点）より小さく、はっきりした差は見られませんでした。`);
  } else if (r.status === 'hold') {
    r.holds.forEach(h => t.push(h));
  }
  r.notes.forEach(n => t.push(n));
  return t;
}
function limitText(r) {
  const [a, b] = r.steps || [1, 1], n = a === b ? `${a}` : `${a}〜${b}`;
  return [
    `各脚${n}${b > 1 ? '歩の平均' : '接地のみ'}で、疲労後の変化や実際のフルマラソン中の性能は評価していません。`,
    '真横から見たミッドソールの見かけの変形からの推定です。故障の予防、ランニングエコノミー、反発力は評価していません。',
    `判定に使う基準差（${num(E.cfg.unitDiff) || 10}点）と校正係数（${E.cfg.cal.join('・')}）は暫定値です。`
  ].filter(Boolean);
}
function staffChecks(p, r) {
  const C = E.cfg, A = shoeName(0), B = shoeName(1), out = [];
  if (!p.consent) out.push(['warn', '撮影・データ利用の同意が未確認です。']);
  if (!(E.capFps > 0)) out.push(['warn', '撮影fpsが未設定です。設定しないと解析結果を保存できません。']);
  const goal = Math.max(1, num(C.stepsGoal) || 1);
  [0, 1].forEach(i => SIDES.forEach(sd => { const n = legSteps(p, i, sd).length; if (n && n < goal) out.push(['info', `${shoeName(i)}の${SIDE_LABEL[sd]}脚は${n}歩です（目標${goal}歩）。`]); }));
  [0, 1].forEach(i => SIDES.forEach(sd => { const st = legStats(p, i, sd), sk = strikeLeg(p, i, sd); if (!sk) return; st.zones.forEach((z, k) => { if (sk.weights[k] >= 0.3 && z.sd != null && z.sd > 5) out.push(['info', `${shoeName(i)}・${SIDE_LABEL[sd]}脚の${ZONES[k]}は歩ごとのばらつきが大きめです（SD ${z.sd.toFixed(1)}ポイント）。`]); }); if (sk.type === 'mixed') out.push(['info', `${shoeName(i)}・${SIDE_LABEL[sd]}脚の接地タイプが歩ごとに分かれたため、重みを平均しました。`]); }));
  const foreMean = i => avg(SIDES.map(sd => legStats(p, i, sd).zones[2].mean).filter(v => v != null));
  const fA = foreMean(0), fB = foreMean(1);
  if (fA != null && fB != null) { const mmA = fA / 100 * num(C.refA[2]), mmB = fB / 100 * num(C.refB[2]); if (mmB < mmA) out.push(['warn', `前足部の推定圧縮量が ${B} ${mmB.toFixed(1)}mm < ${A} ${mmA.toFixed(1)}mm で、試験機の傾向（${B}の方が深く潰れる）と逆です。撮影ペース・着地・カメラ位置を確認してください。`]); }
  [0, 1].forEach(i => SIDES.forEach(sd => { const c = cushionLeg(p, i, sd); if (c) c.zones.forEach(z => { if (z.c != null && z.c > z.hi + 10) out.push(['warn', `${shoeName(i)}・${SIDE_LABEL[sd]}脚の${ZONES[z.z]}が試験機相当で ${z.c.toFixed(0)}% と上限（${z.hi}%）を大きく超えています。校正係数を確認してください。`]); }); }));
  [0, 1].forEach(i => { const r0 = strikeLeg(p, i, 'R'), l0 = strikeLeg(p, i, 'L'); if (r0 && l0 && r0.type !== l0.type) out.push(['info', `${shoeName(i)}は右脚が${r0.label}、左脚が${l0.label}でした。`]); });
  SIDES.forEach(sd => { const a = strikeLeg(p, 0, sd), b = strikeLeg(p, 1, sd); if (a && b && a.type !== b.type) out.push(['info', `${SIDE_LABEL[sd]}脚の接地タイプが靴によって変わりました（${A}：${a.label}、${B}：${b.label}）。`]); });
  const lv = q => { const v = [0, 1].map(i => avg(SIDES.map(sd => { const c = cushionLeg(q, i, sd); return c ? c.zones.reduce((s, z) => s + (z.c != null ? z.w * z.c : 0), 0) : null; }).filter(x => x != null))).filter(x => x != null); return v.length ? Math.max(...v) : null; };
  const w = num(p.weight), my = lv(p), others = E.participants.map(q => ({ w: num(q.weight), v: q === p ? my : lv(q) })).filter(o => o.w != null && o.v != null);
  if (w != null && my != null && others.length >= 3) { const wp = others.filter(o => o.w < w).length / others.length, lp = others.filter(o => o.v < my).length / others.length; if (wp < 1 / 3 && lp >= 2 / 3) out.push(['warn', '体重が軽い方なのに圧縮率が上位です。撮影ミスや、接地フレームの取り違えがないか確認してください。']); }
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
function nextSlot(p) {
  const order = []; [firstShoe(p), 1 - firstShoe(p)].forEach(i => SIDES.forEach(sd => order.push([i, sd])));
  const goal = Math.max(1, num(E.cfg.stepsGoal) || 1);
  return order.find(([i, sd]) => legSteps(p, i, sd).length < goal) || null;
}
function renderSaveBar() {
  const sel = $('#evSaveP'); if (!sel) return;
  sel.innerHTML = E.participants.length
    ? E.participants.map(p => `<option value="${p.id}"${p.id === E.currentId ? ' selected' : ''}>${esc(p.name)}${p.slot ? `（${esc(p.slot)}枠）` : ''}</option>`).join('')
    : '<option value="">参加者がいません</option>';
  const p = cur();
  const cnt = (p, i) => (p.results[i] || []).filter(s => faceOf(s) === 'lat').length;
  $$('#evShoeSeg button').forEach((b, i) => { b.textContent = p ? `${shoeName(i)}（${cnt(p, i)}歩）` : shoeName(i); b.setAttribute('aria-pressed', String(E.activeShoe === i)); });
  $$('#evSideSeg button').forEach(b => b.setAttribute('aria-pressed', String(E.activeSide === b.dataset.s)));
  const has = MSA.hasResult();
  $('#evSave').disabled = !p || !has;
  let hint = '';
  if (!E.participants.length) hint = '「体験会・比較」タブで参加者を追加すると、解析結果を保存できます。';
  else if (!(E.capFps > 0)) hint = '撮影fpsが未設定です。「体験会・比較」タブの設定で入れてください。';
  else if (p) { const ns = nextSlot(p); hint = ns ? `次は ${shoeName(ns[0])} の${SIDE_LABEL[ns[1]]}脚です。${has ? '' : '解析が終わると追加できます。'}` : '4つの枠（2足×左右）がそろいました。'; }
  say('#evSaveStatus', hint);
}
function saveCurrent() {
  const p = cur(); if (!p) return;
  const snap = MSA.snapshot(); if (!snap) { say('#evSaveStatus', '先に解析を完了してください。', 'warn'); return; }
  if (!(snap.capFps > 0)) { say('#evSaveStatus', '撮影fpsが未設定のため保存できません。「体験会・比較」タブの設定で撮影fpsを入れてください。', 'warn'); return; }
  if (!(contactOf(snap) > 0)) { say('#evSaveStatus', '接地と離地を指定して解析してください。', 'warn'); return; }
  snap.side = E.activeSide === 'L' ? 'L' : 'R'; snap.face = 'lat';
  const i = E.activeShoe, list = p.results[i];
  if (list.some(s => s.video === snap.video && s.baseAbs === snap.baseAbs && s.last === snap.last && JSON.stringify(s.peak) === JSON.stringify(snap.peak))) { say('#evSaveStatus', 'この解析はすでに追加済みです。', 'warn'); return; }
  list.push(snap); persist(true);
  const t = strikeOfStep(snap), n = legSteps(p, i, snap.side, snap.face).length, ms = contactOf(snap) / snap.capFps * 1000;
  const ns = nextSlot(p); if (ns) { E.activeShoe = ns[0]; E.activeSide = ns[1]; persist(); }
  renderSaveBar();
  say('#evSaveStatus', `${p.name}さんの${shoeName(i)}・${SIDE_LABEL[snap.side]}脚に${n}歩目を追加しました（接地時間 ${ms.toFixed(0)} ms${t ? `、${STRIKE_LABEL[t]}` : ''}）。${ns ? `次は ${shoeName(ns[0])} の${SIDE_LABEL[ns[1]]}脚です。` : '4つの枠がそろいました。'}`, 'ok');
}

// ---------- list ----------
function renderList() {
  const ul = $('#evList');
  if (!E.participants.length) { ul.innerHTML = '<li class="ev-empty">まだ参加者がいません。</li>'; return; }
  const goal = Math.max(1, num(E.cfg.stepsGoal) || 1);
  ul.innerHTML = E.participants.map(p => {
    const chip = i => { const r = legSteps(p, i, 'R').length, l = legSteps(p, i, 'L').length, ok = r >= goal && l >= goal; return `<span class="chip${ok ? ' on' : (r || l) ? ' part' : ''}">${esc(shoeName(i))} 右${r}・左${l}</span>`; };
    const h = headline(decide(p));
    return `<li><button type="button" class="ev-item${p.id === E.currentId ? ' sel' : ''}" data-id="${p.id}">
      <span class="ev-name">${esc(p.name)}</span><span class="ev-slot">${p.slot ? esc(p.slot) + '枠' : ''}${p.consent ? '' : ' 同意未'}</span>
      <span class="chips">${chip(0)}${chip(1)}</span><span class="pick">${esc(h.main)}</span></button></li>`;
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
  }
  $$('.shoeA-name').forEach(el => { el.textContent = shoeName(0); });
  $$('.shoeB-name').forEach(el => { el.textContent = shoeName(1); });
  $('#evOrder').textContent = `${shoeName(firstShoe(p))}（右→左） → ${shoeName(1 - firstShoe(p))}（右→左）`;
  renderPreSummary(p); renderSubj(p); renderChoice(p); renderCompare(p); renderSheet(p);
  $('#evDelete').textContent = 'この参加者を削除'; $('#evDelete').dataset.armed = '';
}
function renderPreSummary(p) {
  const pace = parseTime(p.pace), parts = [];
  parts.push(pace ? `目標マラソンペース <b>キロ${fmtPace(pace)}</b>（フル ${Math.floor(pace * MARATHON / 3600)}:${String(Math.floor(pace * MARATHON % 3600 / 60)).padStart(2, '0')}相当）` : '目標マラソンペースを入れてください（例 4:58）');
  if (lowMileage(p)) parts.push(`月間走行距離が${MONTHLY_LOW}km未満のため、クッションの使い方で底つきまでの余裕を重く見ます`);
  $('#evPreSummary').innerHTML = parts.join('　');
}
function renderSubj(p) {
  [0, 1].forEach(i => {
    const s = p.subj[i] || {};
    const seg = (key, dict) => `<span class="seg3">${Object.entries(dict).map(([v, [lab]]) => `<button type="button" data-i="${i}" data-k="${key}" data-v="${v}" aria-pressed="${s[key] === v}">${lab}</button>`).join('')}</span>`;
    $(`#evSubj${i}`).innerHTML = `<div class="q"><div class="q-label">痛み、圧迫、ぐらつきなどの違和感は？</div>${seg('discomfort', DISC)}</div><div class="q"><div class="q-label">このペースで走り続けやすそうか？</div>${seg('cont', CONT)}</div>`;
  });
}
function renderChoice(p) { $$('#evChoice button').forEach(b => { b.setAttribute('aria-pressed', String(p.choice === b.dataset.v)); if (b.dataset.v === '0') b.textContent = shoeName(0); if (b.dataset.v === '1') b.textContent = shoeName(1); }); }

// ---------- measurement view ----------
function renderCompare(p) {
  const has = p.results[0].length || p.results[1].length;
  $('#evCompare').hidden = !has; $('#evNoResult').hidden = !!has;
  if (!has) return;
  const opt = (i, sd) => { const v = ((p.strikeManual || [])[i] || {})[sd] || ''; return `<select class="strike-sel" data-i="${i}" data-s="${sd}" aria-label="接地タイプ">${[['', '自動'], ['rear', 'リア'], ['mid', 'ミッド'], ['fore', 'フォア']].map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`; };
  const rows = [];
  [0, 1].forEach(i => SIDES.forEach(sd => {
    const st = legStats(p, i, sd), sk = strikeLeg(p, i, sd);
    const z = k => st.zones[k].mean == null ? '—' : `${st.zones[k].mean.toFixed(1)}${st.zones[k].sd != null ? `<small>±${st.zones[k].sd.toFixed(1)}</small>` : ''}`;
    const tn = k => st.zones[k].tn == null ? '—' : st.zones[k].tn.toFixed(2);
    rows.push(`<tr><th><i class="sw ${i ? 'b' : 'a'}"></i>${esc(shoeName(i))}<span class="t">${SIDE_LABEL[sd]}脚・${st.n}歩</span></th><td>${z(0)}</td><td>${z(1)}</td><td>${z(2)}</td><td>${st.contactMs == null ? '—' : st.contactMs.toFixed(0)}</td><td>${tn(0)} / ${tn(1)} / ${tn(2)}</td><td class="sk">${sk ? esc(sk.label) : '—'} ${opt(i, sd)}</td></tr>`);
  }));
  $('#evLegTable').innerHTML = `<thead><tr><th></th><th>ヒール%</th><th>ミッド%</th><th>フォア%</th><th>接地時間 ms</th><th>正規化最大圧縮時刻<br><small>ヒール / ミッド / フォア</small></th><th>接地タイプ</th></tr></thead><tbody>${rows.join('')}</tbody>`;
  const mm = [];
  [0, 1].forEach(i => (p.results[i] || []).forEach(s => { if (s.mmPerPx && s.h0) mm.push(s); }));
  $('#evMm').textContent = mm.length ? `実寸換算あり（${mm.length}歩）：歩ごとのCSVにmmの値を出力します。` : '動画で測った圧縮率です（校正前）。正規化最大圧縮時刻は、接地を0、離地を1としたときの最大圧縮の位置です。';
  [0, 1].forEach(i => {
    const list = p.results[i];
    $(`#evSteps${i}`).innerHTML = list.length ? list.map((s, j) => {
      const t = strikeOfStep(s), c = contactOf(s);
      return `<li><span class="sn">${SIDE_LABEL[s.side || 'R']}${faceOf(s) === 'med' ? '内（不使用）' : ''}</span><span class="sv">${s.peak.map(pk => pk ? pk.v.toFixed(1) : '—').join(' / ')}</span><span class="ss">${t ? STRIKE_LABEL[t] : '判定不可'}${c > 0 && s.capFps > 0 ? `・${(c / s.capFps * 1000).toFixed(0)}ms` : ''}</span><span class="sf" title="${esc(s.video)}">${esc(s.video)}</span><button type="button" class="btn small" data-del="${i}:${j}">削除</button></li>`;
    }).join('') : '<li class="ev-empty">まだありません</li>';
  });
  drawCurves(p);
}
function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return [ctx, w, h];
}
function drawCurves(p) {
  const cols = [cssVar('--shoeA'), cssVar('--shoeB')], muted = cssVar('--muted'), line = cssVar('--line');
  $$('#evCurves canvas').forEach((cv, k) => {
    if (!cv.clientWidth) return;
    const [ctx, w, h] = sizeCanvas(cv);
    let ymax = 10; [0, 1].forEach(i => p.results[i].filter(s => faceOf(s) === 'lat').forEach(s => s.comp[k].forEach(v => { if (v != null) ymax = Math.max(ymax, v + 2); })));
    ymax = Math.ceil(ymax / 5) * 5;
    const pad = { l: 34, r: 8, t: 8, b: 22 }, PX = x => pad.l + x * (w - pad.l - pad.r), PY = v => pad.t + (1 - v / ymax) * (h - pad.t - pad.b);
    ctx.font = '11px "IBM Plex Sans JP",system-ui,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= ymax; v += ymax > 30 ? 10 : 5) { ctx.strokeStyle = line; ctx.lineWidth = v ? 0.7 : 1.2; ctx.beginPath(); ctx.moveTo(pad.l, PY(v)); ctx.lineTo(w - pad.r, PY(v)); ctx.stroke(); ctx.fillStyle = muted; ctx.fillText(v + '%', pad.l - 4, PY(v)); }
    ctx.textBaseline = 'top'; ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.fillText('接地', pad.l, h - pad.b + 6); ctx.textAlign = 'right'; ctx.fillText('離地', w - pad.r, h - pad.b + 6);
    [0, 1].forEach(i => p.results[i].forEach(s => {
      const c = contactOf(s); if (!(c > 0) || faceOf(s) !== 'lat') return;
      ctx.strokeStyle = cols[i]; ctx.globalAlpha = (s.side || 'R') === 'R' ? 0.95 : 0.55; ctx.lineWidth = (s.side || 'R') === 'R' ? 1.8 : 1.4; ctx.setLineDash(i ? [6, 4] : []); ctx.beginPath(); let pen = false;
      s.frames.forEach((f, j) => { const v = s.comp[k][j]; if (v == null || f < 0 || f > c) { pen = false; return; } const x = PX(f / c), y = PY(v); if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = true; });
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }));
  });
}

// ---------- result sheet ----------
function renderSheet(p) {
  const r = decide(p), h = headline(r), el = $('#evSheet'), A = shoeName(0), B = shoeName(1);
  const checks = staffChecks(p, r);
  $('#evChecks').innerHTML = checks.length ? checks.map(([t, m]) => `<li class="${t}">${esc(m)}</li>`).join('') : '<li class="okc">気になる点はありません。</li>';
  if (r.status === 'incomplete') {
    el.innerHTML = `<div class="verdict hold"><span class="v-main">${esc(h.main)}</span></div><p class="sheet-missing">必要な情報：${esc(r.missing.join('、'))}</p>${r.gates.length ? `<ul class="sheet-gates">${r.gates.map(([w, m]) => `<li><b>${esc(w)}</b>　${esc(m)}</li>`).join('')}</ul>` : ''}`;
    return;
  }
  const bar = (v) => v == null ? '<span class="na">—</span>' : `<span class="sbar"><i style="width:${Math.max(2, Math.min(100, v))}%"></i></span><b class="num">${f0(v)}</b>`;
  const W = r.W || [0, 1, 2].map(k => num(E.cfg.weights[k]) || 0);
  const subs = SUB_NAMES.map((n, k) => `<tr><th>${n}<span class="t">重み${W[k]}%</span></th><td class="a">${bar(r.sub[0][k])}</td><td class="b">${bar(r.sub[1][k])}</td></tr>`).join('');
  const reasons = reasonText(p, r), limits = limitText(r);
  const legLine = (i) => SIDES.map(sd => { const c = cushionLeg(p, i, sd); if (!c) return ''; return `<li><b>${esc(shoeName(i))}・${SIDE_LABEL[sd]}脚</b>（${esc(c.strike.label)}、重み ${c.strike.weights.map(v => v.toFixed(2)).join('/')}）：${c.zones.filter(z => z.m != null).map(z => `${ZONES[z.z]} ${z.m.toFixed(1)}%→${z.c.toFixed(0)}%（活用${z.U.toFixed(2)}・余裕${z.R.toFixed(2)}）`).join('、')} → 活用 ${c.use.toFixed(2)}、余裕 ${c.res.toFixed(2)}、a=${c.a} → ${c.score.toFixed(1)}点</li>`; }).join('');
  const lrLine = i => { const l = r.lr[i]; if (!l) return ''; return `<li><b>${esc(shoeName(i))}の左右整合性</b>：${l.items.length ? l.items.map(it => `${ZONES[it.z]}の${it.kind} 差${it.d.toFixed(1)}%→${it.pts.toFixed(0)}点`).join('、') : '比べられる部位なし'}</li>`; };
  const contLine = i => { const s = p.subj[i]; return `<li><b>${esc(shoeName(i))}の継続許容性</b>：違和感「${DISC[s.discomfort] ? DISC[s.discomfort][0] : '—'}」、走り続けやすさ「${CONT[s.cont] ? CONT[s.cont][0] : '—'}」</li>`; };
  el.innerHTML = `
    <div class="sheet-head"><span class="sheet-name">${esc(p.name)}さん</span><span class="sheet-meta">マラソンペース適合プロファイル${parseTime(p.pace) ? `　目標 キロ${fmtPace(parseTime(p.pace))}` : ''}</span></div>
    <div class="verdict ${h.cls}"><span class="v-main">${esc(h.main)}</span>${h.sub ? `<span class="v-sub">${esc(h.sub)}</span>` : ''}</div>
    <p class="conf">判定信頼度：<b>限定的</b><span>（おすすめ度とは別の指標です。差が再現される可能性を、今回の測定条件ではこれ以上は支持できません）</span></p>
    <div class="apt-wrap"><table class="sub-table"><thead><tr><th>サブスコア</th><th><i class="sw a"></i>${esc(A)}</th><th><i class="sw b"></i>${esc(B)}</th></tr></thead><tbody>${subs}</tbody></table></div>
    <h3>理由</h3><ul class="sheet-reasons">${reasons.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    ${r.gates.length ? `<h3>撮り直しが必要な動画</h3><ul class="sheet-gates">${r.gates.map(([w, m]) => `<li><b>${esc(w)}</b>　${esc(m)}</li>`).join('')}</ul>` : ''}
    <h3>この結果の限界</h3><ul class="sheet-limits">${limits.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <details class="sheet-why"><summary>計算の中身</summary><ul>
      ${legLine(0)}${legLine(1)}${lrLine(0)}${lrLine(1)}${contLine(0)}${contLine(1)}
      ${r.total[0] != null && r.total[1] != null ? `<li>合計（判定用、画面には出さない値）：${esc(A)} ${r.total[0].toFixed(1)}、${esc(B)} ${r.total[1].toFixed(1)}、差 ${(r.total[1] - r.total[0]).toFixed(1)}点 → 基準差${num(E.cfg.unitDiff) || 10}点の${(Math.abs(r.total[1] - r.total[0]) / (num(E.cfg.unitDiff) || 10)).toFixed(2)}倍（${D_WIN.toFixed(1)}倍以上で第1候補）</li>` : ''}
    </ul></details>`;
}

// ---------- export / backup ----------
const csvEsc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const f2 = v => v == null ? '' : (+v).toFixed(2);
function buildCSV() {
  const head = ['no', 'name', 'slot', 'consent', 'target_pace', 'monthly_km', 'weight_kg', 'shoe_size'];
  ['A', 'B'].forEach(t => {
    head.push(`${t}_shoe`);
    SIDES.forEach(sd => head.push(`${t}_${sd}_steps`, `${t}_${sd}_strike`, `${t}_${sd}_heel`, `${t}_${sd}_mid`, `${t}_${sd}_fore`, `${t}_${sd}_contact_ms`, `${t}_${sd}_tn_heel`, `${t}_${sd}_tn_mid`, `${t}_${sd}_tn_fore`, `${t}_${sd}_cushion`));
    head.push(`${t}_cushion`, `${t}_lr`, `${t}_continuation`, `${t}_total`, `${t}_discomfort`, `${t}_continuability`);
  });
  head.push('result', 'first_candidate', 'confidence', 'diff_total', 'D', 'reasons', 'quality_gates', 'staff_checks', 'choice', 'reason', 'concern', 'unit_diff', 'calibration', 'weights');
  const rows = [head.join(',')];
  E.participants.forEach(p => {
    const r = decide(p), h = headline(r), checks = staffChecks(p, r);
    const row = [p.no, p.name, p.slot, p.consent ? 1 : 0, p.pace, p.monthly, p.weight, p.shoeSize];
    [0, 1].forEach(i => {
      row.push(shoeName(i));
      SIDES.forEach(sd => { const st = legStats(p, i, sd), sk = strikeLeg(p, i, sd), c = cushionLeg(p, i, sd); row.push(st.n, sk ? sk.label : '', ...st.zones.map(z => f2(z.mean)), f2(st.contactMs), ...st.zones.map(z => f2(z.tn)), c ? f2(c.score) : ''); });
      row.push(f2(r.sub[i][0]), f2(r.sub[i][1]), f2(r.sub[i][2]), f2(r.total[i]), DISC[p.subj[i].discomfort] ? DISC[p.subj[i].discomfort][0] : '', CONT[p.subj[i].cont] ? CONT[p.subj[i].cont][0] : '');
    });
    row.push(h.main, r.status === 'winner' ? shoeName(r.winner) : '', '限定的', r.diff != null ? f2(r.diff) : '', r.D != null ? f2(r.D) : '', reasonText(p, r).join(' / '), r.gates.map(g => g.join('：')).join(' / '), checks.map(c => c[1]).join(' / '),
      p.choice === '0' || p.choice === '1' ? shoeName(+p.choice) : (p.choice === 'none' ? '決められない' : ''), p.reason, p.concern, E.cfg.unitDiff, E.cfg.cal.join('/'), E.cfg.weights.join('/'));
    rows.push(row.map(csvEsc).join(','));
  });
  return '\ufeff' + rows.join('\r\n') + '\r\n';
}
function buildStepsCSV() {
  const head = ['no', 'name', 'shoe', 'side', 'face', 'step', 'video', 'capture_fps', 'resolution', 'contact_frames', 'contact_ms', 'heel_peak', 'mid_peak', 'fore_peak', 'tn_heel', 'tn_mid', 'tn_fore', 'strike', 'quality_heel', 'quality_mid', 'quality_fore', 'mm_per_px', 'heel_h0_mm', 'mid_h0_mm', 'fore_h0_mm', 'heel_comp_mm', 'mid_comp_mm', 'fore_comp_mm'];
  const rows = [head.join(',')];
  E.participants.forEach(p => [0, 1].forEach(i => { const cnt = {}; p.results[i].forEach(s => {
    const sd = s.side || 'R', c = contactOf(s), q = s.quality || [], mmp = s.mmPerPx || null, h0 = s.h0 || [];
    const ck = sd + faceOf(s); cnt[ck] = (cnt[ck] || 0) + 1;
    rows.push([p.no, p.name, shoeName(i), SIDE_LABEL[sd], FACE_LABEL[faceOf(s)], cnt[ck], s.video, s.capFps, s.vw ? `${s.vw}x${s.vh}` : '', c, c > 0 && s.capFps > 0 ? (c / s.capFps * 1000).toFixed(1) : '',
      ...s.peak.map(pk => pk ? pk.v.toFixed(2) : ''), ...[0, 1, 2].map(k => f2(tnOf(s, k))), strikeOfStep(s) || '', ...[0, 1, 2].map(k => q[k] != null ? (q[k] * 100).toFixed(0) : ''),
      mmp ? mmp.toFixed(4) : '', ...[0, 1, 2].map(k => mmp && h0[k] ? (h0[k] * mmp).toFixed(2) : ''), ...[0, 1, 2].map(k => mmp && h0[k] && s.peak[k] ? (h0[k] * mmp * s.peak[k].v / 100).toFixed(2) : '')].map(csvEsc).join(','));
  }); }));
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
      if (v.cfg) E.cfg = mergeCfg(v.cfg, v.cfgVer);
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
  const n = E.participants.reduce((m, p) => Math.max(m, p.no || 0), 0) + 1, p = newParticipant(n);
  E.participants.push(p); E.currentId = p.id; E.activeShoe = firstShoe(p); E.activeSide = 'R'; persist(true);
  renderAll(true);
  const nm = $('#evName'); if (nm) { nm.focus(); nm.select(); }
}
$('#tabHome').addEventListener('click', () => showTab('home'));
$('#tabAnalysis').addEventListener('click', () => showTab('analysis'));
$('#tabEvent').addEventListener('click', () => showTab('event'));
$('#homeStart').addEventListener('click', () => showTab('event'));
$('#evAdd').addEventListener('click', addParticipant);
$('#evAdd2').addEventListener('click', addParticipant);
$('#evList').addEventListener('click', e => { const b = e.target.closest('.ev-item'); if (!b) return; E.currentId = b.dataset.id; persist(); renderAll(true); });
$('#evSaveP').addEventListener('change', e => { E.currentId = e.target.value || null; const p = cur(); if (p) { const ns = nextSlot(p); if (ns) { E.activeShoe = ns[0]; E.activeSide = ns[1]; } } persist(); renderSaveBar(); });
$$('#evShoeSeg button').forEach((b, i) => b.addEventListener('click', () => { E.activeShoe = i; persist(); renderSaveBar(); }));
$$('#evSideSeg button').forEach(b => b.addEventListener('click', () => { E.activeSide = b.dataset.s; persist(); renderSaveBar(); }));
$('#evSave').addEventListener('click', saveCurrent);
$('#evDetail').addEventListener('input', e => {
  const el = e.target, p = cur(); if (!p || !el.dataset.f) return;
  setPath(p, el.dataset.f, el.type === 'checkbox' ? el.checked : el.value); persist();
  if (el.dataset.f === 'name' || el.dataset.f === 'slot') renderSaveBar();
  refreshLive();
});
$('#evDetail').addEventListener('change', e => { const el = e.target; if (el.dataset.f && (el.tagName === 'SELECT' || el.type === 'checkbox')) el.dispatchEvent(new Event('input', { bubbles: true })); });
$('#evReason').addEventListener('input', e => { const p = cur(); if (!p) return; p.reason = e.target.value; persist(); });
['#evSubj0', '#evSubj1'].forEach(sel => $(sel).addEventListener('click', e => {
  const b = e.target.closest('button[data-k]'), p = cur(); if (!b || !p) return;
  const i = +b.dataset.i, k = b.dataset.k; p.subj[i][k] = p.subj[i][k] === b.dataset.v ? '' : b.dataset.v;
  persist(); renderSubj(p); renderSheet(p); renderList();
}));
$('#evChoice').addEventListener('click', e => { const b = e.target.closest('button[data-v]'), p = cur(); if (!b || !p) return; p.choice = p.choice === b.dataset.v ? '' : b.dataset.v; persist(); renderChoice(p); });
$('#evCompare').addEventListener('change', e => {
  const s = e.target.closest('.strike-sel'), p = cur(); if (!s || !p) return;
  if (!Array.isArray(p.strikeManual)) p.strikeManual = [{ R: '', L: '' }, { R: '', L: '' }];
  p.strikeManual[+s.dataset.i][s.dataset.s] = s.value; persist(true); renderCompare(p); renderSheet(p); renderList();
});
$('#evCompare').addEventListener('click', e => {
  const b = e.target.closest('button[data-del]'), p = cur(); if (!b || !p) return;
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
$$('[data-cfg]').forEach(el => el.addEventListener('input', () => { setPath(E.cfg, el.dataset.cfg, el.value); persist(); const p = cur(); if (p) { renderCompare(p); renderSheet(p); } renderList(); renderSaveBar(); }));
$('#evCfgReset').addEventListener('click', () => { E.cfg = Object.assign(defaultCfg(), { stepsGoal: E.cfg.stepsGoal }); persist(true); applySettings(); renderAll(); say('#evDataStatus', '判定の設定を初期値に戻しました。', 'ok'); });
$('#evCsv').addEventListener('click', () => { if (!E.participants.length) { say('#evDataStatus', '書き出す参加者がいません。', 'warn'); return; } exportFile(buildCSV(), `体験会_${stamp()}.csv`, 'CSVを保存しました。'); });
$('#evStepsCsv').addEventListener('click', () => { if (!E.participants.length) { say('#evDataStatus', '書き出す参加者がいません。', 'warn'); return; } exportFile(buildStepsCSV(), `体験会_歩ごと_${stamp()}.csv`, '歩ごとのCSVを保存しました。'); });
$('#evBackup').addEventListener('click', () => exportFile(JSON.stringify({ app: 'midsole-analyzer', version: 4, exportedAt: new Date().toISOString(), shoes: E.shoes, capFps: E.capFps, cfg: E.cfg, cfgVer: CFG_VER, participants: E.participants }), `体験会バックアップ_${stamp()}.json`, 'バックアップを保存しました。'));
$('#evRestore').addEventListener('click', () => $('#evRestoreFile').click());
$('#evRestoreFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) restore(f); e.target.value = ''; });
$('#evClear').addEventListener('click', e => {
  const btn = e.currentTarget;
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'もう一度押すと全員分を削除します'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '全データを削除'; }, 4000); return; }
  E = Object.assign(blank(), { shoes: E.shoes, capFps: E.capFps, cfg: E.cfg }); persist(true); renderAll(true); btn.dataset.armed = ''; btn.textContent = '全データを削除';
  say('#evDataStatus', '全データを削除しました。');
});
window.addEventListener('msa:update', renderSaveBar);
let rz = null; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const p = cur(); if (!$('#viewEvent').hidden && p) drawCurves(p); }, 80); });
window.MSAEvent = { decide: id => { const p = E.participants.find(q => q.id === id) || cur(); return p ? decide(p) : null; } };
applySettings(); renderAll(true); showTab('home');
})();
