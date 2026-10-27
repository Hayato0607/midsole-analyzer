// 体験会モード：事前入力、2足×複数歩の解析結果、主観評価、適性距離の推定（ルール v0.1）
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const MSA = window.MSA;
const KEY = 'msa-event-v1';
const ZONES = ['ヒール', 'ミッド', 'フォア'];
const DISTS = [['5K', 5], ['10K', 10], ['ハーフ', 21.0975], ['30K', 30], ['フル', 42.195]];
const PB_KEYS = ['5K', '10K', 'ハーフ', 'フル'];
const SAME = 3;          // この差（ポイント）未満は「ほぼ同じ」
const STEPS_GOAL = 5;    // 1足あたりの推奨歩数
const RATE_ITEMS = [
  ['fsoft', '前足部の柔らかさ', '硬い', '柔らかい'],
  ['bounce', '弾む感じ', '弾まない', '弾む'],
  ['roll', '転がって進む感じ', 'ない', '強い'],
  ['harsh', '着地の突き上げ', 'ない', '強い'],
  ['snappy', '蹴り出しのキビキビ感', 'ない', '強い'],
  ['ground', '地面を感じる度合い', '感じない', '感じる'],
  ['protect', '脚を守られている感じ', 'ない', '強い'],
  ['stability', '安定感', '不安定', '安定'],
  ['overall', '総合（このペースで長く走りたいか）', '走りたくない', '走りたい']
];
const STRIKE_LABEL = { heel: 'かかと着地', mid: '中足部着地', fore: '前足部着地' };
const STRIKE_ZONE = { heel: 0, mid: 1, fore: 2 };

// ---------- data ----------
function defaultCfg() { return { refA: [35.9, 32.45, 29.0], refB: [39.2, 35.8, 32.4], thrB: '', thrC: '', paceFlag: '5:30', fastFull: '3:05', lowMileage: 150 }; }
function blank() { return { shoes: ['マジックスピード5', 'YOGIRI SPEED'], capFps: 0, participants: [], currentId: null, activeShoe: 0, cfg: defaultCfg() }; }
function newParticipant(no) {
  return { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), no, name: `参加者${no}`, slot: '', consent: false,
    pb: { '5K': '', '10K': '', 'ハーフ': '', 'フル': '' }, race: { dist: '', time: '' }, weight: '', monthly: '', longest: '',
    usualRace: '', usualTrain: '', msExp: '', msLegTired: false, style: '', selfStrike: '', carbon: '', size: '', width: '', highInstep: false, pronation: false,
    concern: '', results: [[], []], ratings: [{}, {}], comments: ['', ''], strikeManual: '', choice: '', reason: '', createdAt: new Date().toISOString() };
}
function migrate(p) {
  const q = Object.assign(newParticipant(p.no || 1), p);
  q.id = p.id || q.id;
  q.results = [0, 1].map(i => { const r = p.results && p.results[i]; return Array.isArray(r) ? r : (r ? [r] : []); });
  q.ratings = [0, 1].map(i => (p.ratings && p.ratings[i]) || {});
  q.comments = [0, 1].map(i => (p.comments && p.comments[i]) || '');
  q.pb = Object.assign({ '5K': '', '10K': '', 'ハーフ': '', 'フル': '' }, p.pb || {});
  q.race = Object.assign({ dist: '', time: '' }, p.race || {});
  if (p.usual && !p.usualRace) q.usualRace = p.usual;
  if (p.goal && !(p.concern || '').includes(p.goal)) q.concern = `目標：${p.goal}${p.concern ? '\n' + p.concern : ''}`;
  delete q.usual; delete q.goal;
  return q;
}
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Array.isArray(v.participants)) { const e = Object.assign(blank(), v); e.cfg = Object.assign(defaultCfg(), v.cfg || {}); e.participants = v.participants.map(migrate); return e; }
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
const firstShoe = p => (p.no || 1) % 2 === 1 ? 0 : 1;

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
  if (!best) return null;
  return { sec: best.t * Math.pow(42.195 / best.km, 1.06), from: best.from };
}
function raceInfo(p) {
  const d = DISTS.find(x => x[0] === p.race.dist); if (!d) return null;
  const t = parseTime(p.race.time, d[1]); if (!t) return { dist: d[0], km: d[1], pace: null };
  return { dist: d[0], km: d[1], t, pace: t / d[1] };
}

// ---------- measurements ----------
function strikeOfStep(s) {
  const on = [0, 1, 2].map(k => {
    const pk = s.peak[k]; if (!pk || pk.v < 3) return Infinity;
    const thr = Math.max(2.5, 0.35 * pk.v);
    // 2フレーム続けてしきい値を超えた最初のフレームを「潰れ始め」とする（1フレームだけのノイズを無視）
    for (let j = 0; j < s.frames.length - 1; j++) { if (s.frames[j] < 0) continue; const v = s.comp[k][j], v2 = s.comp[k][j + 1]; if (v != null && v >= thr && v2 != null && v2 >= thr) return s.frames[j]; }
    return Infinity;
  });
  const [h, m, f] = on, tol = 2;
  if (!isFinite(Math.min(h, m, f))) return null;
  if (h + tol < f && h <= m) return 'heel';
  if (f + tol < h && f <= m) return 'fore';
  return 'mid';
}
function strikeType(p) {
  const cnt = { heel: 0, mid: 0, fore: 0 };
  p.results.forEach(steps => steps.forEach(s => { const t = strikeOfStep(s); if (t) cnt[t]++; }));
  const total = cnt.heel + cnt.mid + cnt.fore;
  let auto = null; if (total) auto = ['mid', 'heel', 'fore'].reduce((a, b) => cnt[b] > cnt[a] ? b : a, 'mid');
  const type = p.strikeManual || auto;
  return type ? { type, auto, manual: !!p.strikeManual, cnt, total } : null;
}
function shoeStats(p, i) {
  const steps = p.results[i] || [];
  const zones = [0, 1, 2].map(k => {
    const vals = steps.map(s => s.peak[k] && s.peak[k].v).filter(v => v != null), n = vals.length;
    const mean = n ? vals.reduce((a, b) => a + b, 0) / n : null;
    const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
    return { n, mean, sd };
  });
  return { n: steps.length, zones };
}
function landingValue(p, i) { const st = strikeType(p); if (!st) return null; return shoeStats(p, i).zones[STRIKE_ZONE[st.type]].mean; }
function relPos(i, value) {
  const vals = E.participants.map(q => landingValue(q, i)).filter(v => v != null);
  if (vals.length < 3 || value == null) return null;
  const below = vals.filter(v => v < value).length, ties = vals.filter(v => v === value).length;
  return { pct: (below + 0.5 * ties) / vals.length, n: vals.length };
}

// ---------- estimation (rule v0.1) ----------
function estimate(p) {
  const C = E.cfg, A = shoeName(0), B = shoeName(1);
  const out = { missing: [], info: [], rules: [], flags: [], checks: [], base: null, final: null, total: 0 };
  const fe = fullEquivalent(p), race = raceInfo(p), st = strikeType(p);
  const sA = shoeStats(p, 0), sB = shoeStats(p, 1);
  out.fe = fe; out.race = race; out.strike = st;
  if (!fe) out.missing.push('自己ベスト（5K・10K・ハーフ・フルのどれか1つ）');
  if (!race || race.pace == null) out.missing.push('目標レースの距離と目標タイム');
  if (!st) out.missing.push('動画の解析結果（着地タイプの判定に使います）');
  if (!fe) return out;
  out.base = fe.sec <= 3 * 3600 + 15 * 60 ? 4 : fe.sec <= 3 * 3600 + 45 * 60 ? 3 : fe.sec <= 4 * 3600 + 15 * 60 ? 2 : 1;
  const add = (code, d, why, talk) => out.rules.push({ code, d, why, talk });
  const lz = st ? STRIKE_ZONE[st.type] : null;
  // A 着地
  if (st && (st.type === 'fore' || st.type === 'mid')) add('A', -1, `${STRIKE_LABEL[st.type]}（2足のクッション差は前足部に集中）`, `${STRIKE_LABEL[st.type]}で、2足のクッションの差が大きい前足部をよく使う走り方です。`);
  // B / C 着地部位の圧縮率
  if (lz !== null) {
    const vA = sA.zones[lz].mean, vB = sB.zones[lz].mean, tB = num(C.thrB), tC = num(C.thrC);
    if (vA != null) {
      let hit = null, basis = '';
      if (tB != null) { hit = vA >= tB; basis = `基準${tB}%以上`; }
      else { const r = relPos(0, vA); if (r) { hit = r.pct >= 2 / 3; basis = `参加者${r.n}人の上位1/3`; } }
      if (hit === null) out.info.push(`ルールB・Cは参加者が3人以上そろうか、詳細設定で基準値を入れると判定します。`);
      else if (hit) add('B', -1, `${A}の${ZONES[lz]}の圧縮率 ${vA.toFixed(1)}%（${basis}）`, `${A}では${ZONES[lz]}がしっかり潰れていて、長い距離だとクッションの余裕が少なめです。`);
    }
    if (vB != null) {
      let hit = null, basis = '';
      if (tC != null) { hit = vB <= tC; basis = `基準${tC}%以下`; }
      else { const r = relPos(1, vB); if (r) { hit = r.pct < 1 / 3; basis = `参加者${r.n}人の下位1/3`; } }
      if (hit) add('C', +1, `${B}の${ZONES[lz]}の圧縮率 ${vB.toFixed(1)}%（${basis}）`, `${B}では${ZONES[lz]}をまだ潰し切れておらず、前足部の柔らかさや反発の恩恵が小さめです。`);
    }
  }
  // D 練習量
  const longest = num(p.longest);
  if (race && longest != null && longest < 0.7 * race.km) add('D', -1, `練習の最長 ${longest}km が目標（${race.dist}）の7割未満`, `練習での最長距離が目標レースの7割未満なので、レース後半はクッションが長く持つ方が助けになります。`);
  // E 総合評価
  const oA = p.ratings[0].overall, oB = p.ratings[1].overall;
  if (oA && oB && Math.abs(oA - oB) >= 2) { const hiB = oB > oA; add('E', hiB ? -1 : +1, `総合評価 ${A} ${oA}・${B} ${oB}`, `走った直後の総合評価は${hiB ? B : A}の方が高く、その感覚を優先しました。`); }
  // F 走りのスタイル
  const rB = p.ratings[1], rA = p.ratings[0];
  const fNeg = rB.roll >= 4 && ((rB.harsh && rB.harsh <= 2) || p.style === 'roll');
  const fPos1 = rA.snappy >= 4 && p.style === 'push';
  const fPos2 = rB.harsh >= 4 && rB.roll && rB.roll <= 2;
  if (fNeg && !(fPos1 || fPos2)) add('F', -1, `${B}の転がり ${rB.roll}・突き上げ ${rB.harsh || '—'}${p.style === 'roll' ? '・好み「転がして進みたい」' : ''}`, `${B}の転がって進む感覚をしっかり感じられています。`);
  else if (!fNeg && fPos1) add('F', +1, `${A}のキビキビ感 ${rA.snappy}・好み「自分で踏んで回したい」`, `${A}のキビキビした蹴り出しを活かせる走り方です。`);
  else if (!fNeg && fPos2) add('F', +1, `${B}の突き上げ ${rB.harsh}・転がり ${rB.roll}`, `${B}では転がりが出にくく、着地の突き上げを感じていました。`);
  const sum = out.rules.reduce((a, r) => a + r.d, 0);
  out.total = Math.max(-2, Math.min(2, sum)); out.rawSum = sum;
  out.final = Math.max(0, Math.min(4, out.base + out.total));
  out.dist = DISTS.map((d, k) => k < out.final ? 'A' : k === out.final ? 'either' : 'B');
  // 注意フラグ（境界は動かさない）
  const paceLim = parseTime(C.paceFlag, 0) || 330;
  if (race && race.pace != null && race.pace > paceLim) out.flags.push(['ペース', `${B}はキロ${fmtPace(paceLim)}前後から転がりに変わるという評価があります。レースペースで転がる感覚があったか、突き上げがなかったかを一緒に確認しましょう。`]);
  if (out.final >= 4 || p.msLegTired) out.flags.push(['脚へのダメージ', `${A}は脚を守る感覚が控えめです。MS4よりは柔らかくなっていますが、長い距離では脚の残り方を練習で確かめてから使いましょう。`]);
  if ((st && st.type === 'heel') || p.pronation) out.flags.push(['安定性', `安定性は2足とも同程度です。${B}は接地幅が広い一方で厚さもあるので、後半にぐらつかないか長めの練習で確認しましょう。`]);
  const monthly = num(p.monthly);
  if (st && st.type === 'fore' && monthly != null && monthly < num(C.lowMileage)) out.flags.push(['後半の着地変化', 'レース後半はかかと着地に変わりやすくなります。ヒールの差は小さいので、後半は2足の違いが出にくくなります。']);
  if (p.highInstep) out.flags.push(['フィット', `${B}はつま先の高さに余裕が少なめです。甲や指先の当たりを確認しましょう。`]);
  const fastLim = parseTime(C.fastFull, 42.195) || (3 * 3600 + 5 * 60);
  if (fe.sec <= fastLim) out.flags.push(['速いランナー', `フルでは${B}は効率面で物足りない可能性があります。`]);
  return out;
}
function staffChecks(p, est) {
  const C = E.cfg, A = shoeName(0), B = shoeName(1), out = [];
  const sA = shoeStats(p, 0), sB = shoeStats(p, 1);
  if (!p.consent) out.push(['warn', '撮影・データ利用の同意が未確認です。']);
  [0, 1].forEach(i => { const n = (p.results[i] || []).length; if (n && n < STEPS_GOAL) out.push(['info', `${shoeName(i)}は${n}歩です（${STEPS_GOAL}歩以上の平均を推奨）。`]); });
  const fA = sA.zones[2].mean, fB = sB.zones[2].mean;
  if (fA != null && fB != null) {
    const mmA = fA / 100 * num(C.refA[2]), mmB = fB / 100 * num(C.refB[2]);
    if (mmB < mmA) out.push(['warn', `前足部の推定圧縮量が ${B} ${mmB.toFixed(1)}mm < ${A} ${mmA.toFixed(1)}mm で、試験機の傾向（${B}の方が深く潰れる）と逆です。撮影ペース・着地・カメラ位置を確認してください。`]);
  }
  const st = est.strike;
  if (st) {
    const lz = STRIKE_ZONE[st.type];
    [0, 1].forEach(i => { const z = shoeStats(p, i).zones[lz]; if (z.sd != null && z.sd > 5) out.push(['info', `${shoeName(i)}の${ZONES[lz]}は歩ごとのばらつきが大きめです（SD ${z.sd.toFixed(1)}ポイント）。`]); });
    if (p.selfStrike && p.selfStrike !== 'unknown' && st.auto && p.selfStrike !== st.auto) out.push(['info', `自己申告の着地（${STRIKE_LABEL[p.selfStrike]}）と動画の判定（${STRIKE_LABEL[st.auto]}）が違います。説明のときに一緒に確認してください。`]);
    if (st.auto && st.total && Math.max(st.cnt.heel, st.cnt.mid, st.cnt.fore) / st.total < 0.6) out.push(['info', `着地タイプの判定が歩ごとに割れています（かかと${st.cnt.heel}・中足部${st.cnt.mid}・前足部${st.cnt.fore}）。動画で確認し、必要なら手動で指定してください。`]);
    // 体重と圧縮率
    const w = num(p.weight), lv = Math.max(landingValue(p, 0) ?? -1, landingValue(p, 1) ?? -1);
    const ws = E.participants.map(q => num(q.weight)).filter(v => v != null);
    const ls = E.participants.map(q => Math.max(landingValue(q, 0) ?? -1, landingValue(q, 1) ?? -1)).filter(v => v >= 0);
    if (w != null && lv >= 0 && ws.length >= 3 && ls.length >= 3) {
      const wp = ws.filter(v => v < w).length / ws.length, lp = ls.filter(v => v < lv).length / ls.length;
      if (wp < 1 / 3 && lp >= 2 / 3) out.push(['warn', '体重が軽い方なのに圧縮率が上位です。撮影ミスや、無負荷の基準フレームの取り違えがないか確認してください。']);
    }
  }
  const rA = p.ratings[0], rB = p.ratings[1];
  if (rA.fsoft && rB.fsoft && rA.fsoft > rB.fsoft) out.push(['info', `前足部の柔らかさが ${A} > ${B} で、レビューの評価と逆です。履き替え順やサイズ違いを確認し、それでも逆なら貴重なデータとして記録してください。`]);
  if (rA.snappy && rB.snappy && rB.snappy >= rA.snappy + 2) out.push(['info', `蹴り出しのキビキビ感が ${B} の方が高く、レビューの評価と逆です。`]);
  if (est.rawSum != null && Math.abs(est.rawSum) > 2) out.push(['info', `補正の合計が ${est.rawSum > 0 ? '+' : ''}${est.rawSum} のため、±2に丸めました。`]);
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
  const i = E.activeShoe, list = p.results[i];
  if (list.some(s => s.video === snap.video && s.baseAbs === snap.baseAbs && s.mark === snap.mark && s.last === snap.last && JSON.stringify(s.peak) === JSON.stringify(snap.peak))) {
    say('#evSaveStatus', 'この解析はすでに追加済みです。次の歩に移動して解析してください。', 'warn'); return;
  }
  list.push(snap); persist(true);
  const t = strikeOfStep(snap), pk = snap.peak.map((v, k) => `${ZONES[k]} ${v ? v.v.toFixed(1) + '%' : '—'}`).join('、');
  renderSaveBar();
  say('#evSaveStatus', `${p.name}さんの${shoeName(i)}に${list.length}歩目を追加しました（最大：${pk}${t ? `、${STRIKE_LABEL[t]}` : ''}）。${list.length < STEPS_GOAL ? `あと${STEPS_GOAL - list.length}歩以上あると安定します。` : ''}`, 'ok');
}

// ---------- list ----------
function renderList() {
  const ul = $('#evList');
  if (!E.participants.length) { ul.innerHTML = '<li class="ev-empty">まだ参加者がいません。</li>'; return; }
  ul.innerHTML = E.participants.map(p => {
    const chip = i => { const n = p.results[i].length; return `<span class="chip${n >= STEPS_GOAL ? ' on' : n ? ' part' : ''}">${esc(shoeName(i))} ${n}歩</span>`; };
    const est = estimate(p);
    const res = est.final != null && est.strike ? `<span class="pick">切り替え：${esc(DISTS[est.final][0])}〜</span>` : '';
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
    [0, 1].forEach(i => { $(`#evComment${i}`).value = p.comments[i] || ''; });
    $('#evReason').value = p.reason || '';
    $('#evStrikeManual').value = p.strikeManual || '';
  }
  $$('.shoeA-name').forEach(el => { el.textContent = shoeName(0); });
  $$('.shoeB-name').forEach(el => { el.textContent = shoeName(1); });
  $('#evOrder').textContent = `${shoeName(firstShoe(p))} → ${shoeName(1 - firstShoe(p))}`;
  renderPreSummary(p); renderRatings(p); renderChoice(p); renderCompare(p); renderSheet(p);
  $('#evDelete').textContent = 'この参加者を削除'; $('#evDelete').dataset.armed = '';
}
function renderPreSummary(p) {
  const fe = fullEquivalent(p), race = raceInfo(p);
  const parts = [];
  parts.push(fe ? `フル換算 <b>${fmtHMS(fe.sec)}</b>（${esc(fe.from)}の自己ベストから）` : 'フル換算：自己ベストを入れると計算します');
  if (race && race.pace != null) parts.push(`目標レースペース <b>キロ${fmtPace(race.pace)}</b>`);
  $('#evPreSummary').innerHTML = parts.join('　');
}
function renderRatings(p) {
  [0, 1].forEach(i => {
    $(`#evRate${i}`).innerHTML = RATE_ITEMS.map(([key, label, lo, hi]) => {
      const v = p.ratings[i][key] || 0;
      const btns = [1, 2, 3, 4, 5].map(n => `<button type="button" data-shoe="${i}" data-key="${key}" data-v="${n}" aria-pressed="${v === n}">${n}</button>`).join('');
      return `<div class="rate"><div class="rate-label">${label}</div><div class="rate-row"><span class="lo">${lo}</span><span class="seg5">${btns}</span><span class="hi">${hi}</span></div></div>`;
    }).join('');
  });
}
function renderChoice(p) { $$('#evChoice button').forEach(b => { b.setAttribute('aria-pressed', String(p.choice === b.dataset.v)); if (b.dataset.v === '0') b.textContent = shoeName(0); if (b.dataset.v === '1') b.textContent = shoeName(1); }); }

// ---------- comparison ----------
function renderCompare(p) {
  const has = p.results[0].length || p.results[1].length;
  $('#evCompare').hidden = !has; $('#evNoResult').hidden = !!has;
  const st = strikeType(p);
  $('#evStrikeAuto').textContent = st && st.auto ? `動画の判定：${STRIKE_LABEL[st.auto]}（かかと${st.cnt.heel}・中足部${st.cnt.mid}・前足部${st.cnt.fore}歩）` : '動画の判定：解析結果を追加すると判定します';
  if (!has) return;
  const sA = shoeStats(p, 0), sB = shoeStats(p, 1), lz = st ? STRIKE_ZONE[st.type] : -1;
  const cell = (s, k) => { const z = s.zones[k]; if (!z.n) return '<td class="na">—</td>'; return `<td><span class="big">${z.mean.toFixed(1)}</span><span class="u">%</span><span class="t">${z.sd != null ? `±${z.sd.toFixed(1)}　` : ''}${z.n}歩</span></td>`; };
  const diff = k => {
    const a = sA.zones[k].mean, b = sB.zones[k].mean; if (a == null || b == null) return '<td class="na">—</td>';
    const d = b - a; if (Math.abs(d) < SAME) return `<td class="same">ほぼ同じ<span class="t">${d >= 0 ? '+' : ''}${d.toFixed(1)}</span></td>`;
    return `<td class="${d > 0 ? 'moreB' : 'moreA'}"><span class="num">${d > 0 ? '+' : ''}${d.toFixed(1)}</span><span class="t">${esc(shoeName(d > 0 ? 1 : 0))}が大きい</span></td>`;
  };
  $('#evTable').innerHTML = `<thead><tr><th></th><th><i class="sw a"></i>${esc(shoeName(0))}</th><th><i class="sw b"></i>${esc(shoeName(1))}</th><th>差（B−A）</th></tr></thead><tbody>${
    ZONES.map((z, k) => `<tr${k === lz ? ' class="landing"' : ''}><th>${z}${k === lz ? '<span class="t">着地部位</span>' : ''}</th>${cell(sA, k)}${cell(sB, k)}${diff(k)}</tr>`).join('')}</tbody>`;
  // estimated forefoot compression in mm
  const C = E.cfg, mm = [0, 1].map(i => { const z = shoeStats(p, i).zones; return z.map((zz, k) => zz.mean == null ? null : zz.mean / 100 * num((i ? C.refB : C.refA)[k])); });
  $('#evMm').textContent = `推定圧縮量（率 × 実測の厚さ）：${ZONES.map((z, k) => `${z} ${shoeName(0)} ${mm[0][k] == null ? '—' : mm[0][k].toFixed(1) + 'mm'} / ${shoeName(1)} ${mm[1][k] == null ? '—' : mm[1][k].toFixed(1) + 'mm'}`).join('、')}`;
  // step lists
  [0, 1].forEach(i => {
    const list = p.results[i];
    $(`#evSteps${i}`).innerHTML = list.length ? list.map((s, j) => {
      const t = strikeOfStep(s);
      return `<li><span class="sn">${j + 1}</span><span class="sv">${s.peak.map(pk => pk ? pk.v.toFixed(1) : '—').join(' / ')}</span><span class="ss">${t ? STRIKE_LABEL[t] : '判定不可'}</span><span class="sf" title="${esc(s.video)}">${esc(s.video)}</span><button type="button" class="btn small" data-del="${i}:${j}">削除</button></li>`;
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
  const S = [shoeStats(p, 0), shoeStats(p, 1)];
  let ymax = 10; S.forEach(s => s.zones.forEach(z => { if (z.mean != null) ymax = Math.max(ymax, z.mean + (z.sd || 0) + 3); }));
  ymax = Math.ceil(ymax / 5) * 5;
  const pad = { l: 40, r: 10, t: 18, b: 26 }, gw = (w - pad.l - pad.r) / 3, Y = v => pad.t + (1 - v / ymax) * (h - pad.t - pad.b);
  ctx.font = '12px "IBM Plex Sans JP",system-ui,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = 0; v <= ymax; v += ymax > 30 ? 10 : 5) { ctx.strokeStyle = line; ctx.lineWidth = v ? 0.8 : 1.4; ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke(); ctx.fillStyle = muted; ctx.fillText(v + '%', pad.l - 6, Y(v)); }
  ZONES.forEach((z, k) => {
    const x0 = pad.l + k * gw, bw = Math.min(46, gw * 0.3);
    [0, 1].forEach(i => {
      const zz = S[i].zones[k], x = x0 + gw / 2 + (i ? 4 : -4 - bw);
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
function distList(est, kind) { return DISTS.filter((d, k) => est.dist[k] === kind).map(d => d[0]).join('・'); }
function renderSheet(p) {
  const est = estimate(p), A = shoeName(0), B = shoeName(1), el = $('#evSheet');
  const checks = staffChecks(p, est);
  $('#evChecks').innerHTML = checks.length ? checks.map(([t, m]) => `<li class="${t}">${esc(m)}</li>`).join('') : '<li class="okc">気になる点はありません。</li>';
  if (est.base == null || !est.strike) {
    el.innerHTML = `<p class="sheet-missing">推定に必要な情報が足りません：${esc(est.missing.join('、'))}</p>`;
    return;
  }
  const cells = DISTS.map((d, k) => { const v = est.dist[k]; return `<div class="dcell ${v}"><span class="dn">${d[0]}</span><span class="dv">${v === 'A' ? esc(A) : v === 'B' ? esc(B) : 'どちらでも'}</span></div>`; }).join('');
  const sgn = d => d > 0 ? `+${d}` : `${d}`;
  const ruleLines = [`<li><b>基本境界：${DISTS[est.base][0]}</b>（フル換算 ${fmtHMS(est.fe.sec)}、${esc(est.fe.from)}の自己ベストから）</li>`]
    .concat(est.rules.map(r => `<li><b>${r.code} ${sgn(r.d)}</b>：${esc(r.why)}</li>`))
    .concat([`<li>補正の合計 ${sgn(est.total)} → <b>${B}に切り替える距離：${DISTS[est.final][0]}</b></li>`]);
  const aD = distList(est, 'A'), gD = distList(est, 'either'), bD = distList(est, 'B');
  const concl = [aD ? `${aD}は${A}` : '', gD ? `${gD}はどちらでも（体感で選んでください）` : '', bD ? `${bD}は${B}が活きます` : ''].filter(Boolean).join('、') + '。';
  const talk = est.rules.map(r => r.talk).join('') + concl;
  el.innerHTML = `
    <div class="sheet-head"><span class="sheet-name">${esc(p.name)}さん</span><span class="sheet-meta">${esc(STRIKE_LABEL[est.strike.type])}${est.race && est.race.pace != null ? `　目標：${esc(est.race.dist)} キロ${fmtPace(est.race.pace)}` : ''}</span></div>
    <div class="dists">${cells}</div>
    <p class="sheet-talk">${esc(talk)}</p>
    ${est.flags.length ? `<h3>確かめてほしいこと</h3><ul class="sheet-flags">${est.flags.map(([t, m]) => `<li><b>${esc(t)}</b>　${esc(m)}</li>`).join('')}</ul>` : ''}
    <details class="sheet-why" open><summary>根拠（どのルールで境界が動いたか）</summary><ul>${ruleLines.join('')}</ul>${est.info.map(t => `<p class="hint">${esc(t)}</p>`).join('')}</details>
    <p class="sheet-note">ミッドソールの潰れ方と申告情報からの推定です。「合う・合わない」ではなく、距離ごとの使い分けの目安としてご覧ください。</p>`;
}

// ---------- export / backup ----------
const csvEsc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const f1 = v => v == null ? '' : (+v).toFixed(2);
function buildCSV() {
  const head = ['no', 'name', 'slot', 'consent', 'pb_5k', 'pb_10k', 'pb_half', 'pb_full', 'full_equiv', 'race_dist', 'race_time', 'race_pace_per_km', 'weight_kg', 'monthly_km', 'longest_km',
    'usual_race', 'usual_train', 'ms_experience', 'ms_legs_tired_after_full', 'style', 'self_strike', 'carbon_exp', 'size', 'width', 'high_instep', 'pronation', 'strike_video', 'strike_used'];
  ['A', 'B'].forEach(t => { head.push(`${t}_shoe`, `${t}_steps`, `${t}_heel_mean`, `${t}_heel_sd`, `${t}_mid_mean`, `${t}_mid_sd`, `${t}_fore_mean`, `${t}_fore_sd`, `${t}_landing_mean`, `${t}_fore_est_mm`, ...RATE_ITEMS.map(r => `${t}_rate_${r[0]}`), `${t}_comment`); });
  head.push('base_boundary', 'rule_A', 'rule_B', 'rule_C', 'rule_D', 'rule_E', 'rule_F', 'total', 'final_boundary', 'rec_5k', 'rec_10k', 'rec_half', 'rec_30k', 'rec_full', 'flags', 'staff_checks', 'choice', 'reason', 'concern');
  const rows = [head.join(',')];
  E.participants.forEach(p => {
    const est = estimate(p), fe = est.fe, race = est.race, st = est.strike, checks = staffChecks(p, est);
    const row = [p.no, p.name, p.slot, p.consent ? 1 : 0, p.pb['5K'], p.pb['10K'], p.pb['ハーフ'], p.pb['フル'], fe ? fmtHMS(fe.sec) : '', p.race.dist, p.race.time, race && race.pace != null ? fmtPace(race.pace) : '', p.weight, p.monthly, p.longest,
      p.usualRace, p.usualTrain, p.msExp, p.msLegTired ? 1 : 0, p.style, p.selfStrike, p.carbon, p.size, p.width, p.highInstep ? 1 : 0, p.pronation ? 1 : 0, st && st.auto ? st.auto : '', st ? st.type : ''];
    [0, 1].forEach(i => {
      const s = shoeStats(p, i), lv = landingValue(p, i), ref = i ? E.cfg.refB : E.cfg.refA;
      row.push(shoeName(i), s.n, f1(s.zones[0].mean), f1(s.zones[0].sd), f1(s.zones[1].mean), f1(s.zones[1].sd), f1(s.zones[2].mean), f1(s.zones[2].sd), f1(lv), s.zones[2].mean == null ? '' : f1(s.zones[2].mean / 100 * num(ref[2])), ...RATE_ITEMS.map(r => p.ratings[i][r[0]] || ''), p.comments[i] || '');
    });
    const rd = c => { const r = est.rules.find(x => x.code === c); return r ? r.d : 0; };
    row.push(est.base != null ? DISTS[est.base][0] : '', rd('A'), rd('B'), rd('C'), rd('D'), rd('E'), rd('F'), est.base != null ? est.total : '', est.final != null ? DISTS[est.final][0] : '',
      ...DISTS.map((d, k) => est.dist ? (est.dist[k] === 'A' ? shoeName(0) : est.dist[k] === 'B' ? shoeName(1) : 'どちらでも') : ''),
      est.flags.map(f => f[0]).join(' / '), checks.map(c => c[1]).join(' / '),
      p.choice === '0' || p.choice === '1' ? shoeName(+p.choice) : (p.choice === 'none' ? '決められない' : ''), p.reason, p.concern);
    rows.push(row.map(csvEsc).join(','));
  });
  return '\ufeff' + rows.join('\r\n') + '\r\n';
}
function buildStepsCSV() {
  const head = ['no', 'name', 'shoe', 'step', 'video', 'heel_peak', 'mid_peak', 'fore_peak', 'heel_peak_time', 'mid_peak_time', 'fore_peak_time', 'time_unit', 'strike'];
  const rows = [head.join(',')];
  E.participants.forEach(p => [0, 1].forEach(i => p.results[i].forEach((s, j) => {
    const tm = pk => pk ? (s.capFps > 0 ? (pk.f / s.capFps * 1000).toFixed(1) : pk.f) : '';
    rows.push([p.no, p.name, shoeName(i), j + 1, s.video, ...s.peak.map(pk => pk ? pk.v.toFixed(2) : ''), ...s.peak.map(tm), s.capFps > 0 ? 'ms' : 'frame', strikeOfStep(s) || ''].map(csvEsc).join(','));
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
      if (v.cfg) E.cfg = Object.assign(defaultCfg(), v.cfg);
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
$('#evSave').addEventListener('click', saveCurrent);
$('#evDetail').addEventListener('input', e => {
  const el = e.target, p = cur(); if (!p || !el.dataset.f) return;
  setPath(p, el.dataset.f, el.type === 'checkbox' ? el.checked : el.value); persist();
  if (el.dataset.f === 'name' || el.dataset.f === 'slot') renderSaveBar();
  refreshLive();
});
$('#evDetail').addEventListener('change', e => { const el = e.target; if (el.dataset.f && (el.tagName === 'SELECT' || el.type === 'checkbox')) el.dispatchEvent(new Event('input', { bubbles: true })); });
[0, 1].forEach(i => $(`#evComment${i}`).addEventListener('input', e => { const p = cur(); if (!p) return; p.comments[i] = e.target.value; persist(); }));
$('#evReason').addEventListener('input', e => { const p = cur(); if (!p) return; p.reason = e.target.value; persist(); });
$('#evStrikeManual').addEventListener('change', e => { const p = cur(); if (!p) return; p.strikeManual = e.target.value; persist(true); renderCompare(p); renderSheet(p); renderList(); });
['#evRate0', '#evRate1'].forEach(sel => $(sel).addEventListener('click', e => {
  const b = e.target.closest('button[data-key]'); const p = cur(); if (!b || !p) return;
  const i = +b.dataset.shoe, k = b.dataset.key, v = +b.dataset.v;
  p.ratings[i][k] = p.ratings[i][k] === v ? 0 : v; persist(); renderRatings(p); renderSheet(p); renderList();
}));
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
$('#evCsv').addEventListener('click', () => { if (!E.participants.length) { say('#evDataStatus', '書き出す参加者がいません。', 'warn'); return; } exportFile(buildCSV(), `体験会_${stamp()}.csv`, 'CSVを保存しました。'); });
$('#evStepsCsv').addEventListener('click', () => { if (!E.participants.length) { say('#evDataStatus', '書き出す参加者がいません。', 'warn'); return; } exportFile(buildStepsCSV(), `体験会_歩ごと_${stamp()}.csv`, '歩ごとのCSVを保存しました。'); });
$('#evBackup').addEventListener('click', () => exportFile(JSON.stringify({ app: 'midsole-analyzer', version: 2, exportedAt: new Date().toISOString(), shoes: E.shoes, capFps: E.capFps, cfg: E.cfg, participants: E.participants }), `体験会バックアップ_${stamp()}.json`, 'バックアップを保存しました。'));
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
