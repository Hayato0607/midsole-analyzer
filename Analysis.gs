/**
 * 指標の計算（分析タブ用）
 */

const EVENT_M = { '800m': 800, '1500m': 1500, '3000m': 3000, '5000m': 5000, '10000m': 10000, 'ハーフ': 21097.5, 'フル': 42195 };

function getAnalysis() {
  const today = today_();
  const th = thresholds_();
  const acts = readRows_('activities').map(parseActivity_);
  const records = readRows_('records');
  const daily = readRows_('daily').map(strip_).sort((a, b) => a['日付'].localeCompare(b['日付']));
  return {
    daily,
    weights: readRows_('weights').map(strip_),
    weekly: weeklyZones_(acts, th, today),
    load: loadSummary_(acts, th, today),
    ef: efSeries_(acts, th),
    decoupling: decouplingList_(acts, th),
    vdot: vdotSummary_(records),
    powermax: powermaxSessions_(),
    wellness: readRows_('wellness').map(strip_).sort((a, b) => a['日付'].localeCompare(b['日付'])),
    thresholds: { walk: secToPace_(th.walk), z1: secToPace_(th.z1), z2: secToPace_(th.z2) },
  };
}

function parseActivity_(r) {
  let hist = {}, laps = [];
  try { hist = JSON.parse(r['ペース分布'] || '{}'); } catch (e) { hist = {}; }
  try { laps = JSON.parse(r['ラップ'] || '[]'); } catch (e) { laps = []; }
  return {
    id: r['ID'], date: r['日付'], start: r['開始'] || '', name: r['名前'],
    dist: Number(r['距離m']) || 0, moving: Number(r['移動時間s']) || 0,
    hr: Number(r['平均心拍']) || 0, cadence: Number(r['平均ピッチ']) || 0,
    race: r['レース'] === '1', hist, laps,
    decoup: r['心拍乖離%'] === '' ? null : Number(r['心拍乖離%']),
  };
}

// ---- 走行距離 ----
function weeklyZones_(acts, th, today) {
  const weeks = [];
  let w = weekStart_(today);
  for (let i = 0; i < 12; i++) { weeks.unshift(w); w = addDays_(w, -7); }
  const z = [0, 1, 2, 3].map(() => weeks.map(() => 0));
  acts.forEach(a => {
    const i = weeks.indexOf(weekStart_(a.date));
    if (i < 0) return;
    zonesFromHist_(a.hist, th).forEach((m, k) => { z[k][i] += m / 1000; });
  });
  return { weeks, zones: z.map(row => row.map(round1_)) };
}

function loadSummary_(acts, th, today) {
  const from7 = addDays_(today, -6), from28 = addDays_(today, -27);
  let last7 = 0, last28 = 0;
  const share = [0, 0, 0, 0];
  acts.forEach(a => {
    if (a.date > today || a.date < from28) return;
    const km = a.dist / 1000;
    last28 += km;
    if (a.date >= from7) last7 += km;
    zonesFromHist_(a.hist, th).forEach((m, k) => { share[k] += m; });
  });
  const total = share.reduce((x, y) => x + y, 0);
  const avg = last28 / 4;
  return {
    last7: round1_(last7),
    avgWeek: round1_(avg),
    ratio: avg > 0 ? Math.round(last7 / avg * 100) / 100 : null,
    share: total ? share.map(m => Math.round(m / total * 1000) / 10) : null,
  };
}

// ---- 有酸素の効率 ----
/** 楽なペースのラン（walk＋z1 が9割以上、20分以上、心拍あり）の「速度(m/分)÷心拍」 */
function efSeries_(acts, th) {
  return acts
    .filter(a => a.moving >= 1200 && a.hr > 0 && a.dist > 0)
    .filter(a => {
      const z = zonesFromHist_(a.hist, th);
      const tot = z.reduce((x, y) => x + y, 0);
      return tot > 0 && (z[0] + z[1]) / tot >= 0.9 && z[1] > 0;
    })
    .map(a => ({
      date: a.date,
      ef: Math.round((a.dist / a.moving * 60) / a.hr * 1000) / 1000,
      km: round1_(a.dist / 1000),
      pace: secToPace_(a.moving / (a.dist / 1000)),
      hr: a.hr,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 40分以上の一定ペース走での心拍の乖離（直近8件） */
function decouplingList_(acts, th) {
  return acts
    .filter(a => a.decoup !== null && !isNaN(a.decoup) && a.moving >= 2400)
    .filter(a => {
      const z = zonesFromHist_(a.hist, th);
      const tot = z.reduce((x, y) => x + y, 0);
      return tot > 0 && z[3] / tot < 0.1;
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map(a => ({ date: a.date, name: a.name, km: round1_(a.dist / 1000), decoup: a.decoup }));
}

// ---- VDOT ----
function vdot_(meters, sec) {
  const t = sec / 60, v = meters / t;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
  return vo2 / pct;
}

/** VDOT の pct 倍の酸素摂取量で走れるペース（秒/km） */
function paceAt_(vdot, pct) {
  const a = 0.000104, b = 0.182258, c = -4.60 - pct * vdot;
  const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return 60000 / v;
}

function vdotSummary_(records) {
  const best = {};
  records.filter(r => r['区分'] === 'PB').forEach(r => {
    const sec = parseTime_(r['値']);
    if (sec === null || sec <= 0) return;
    if (!best[r['項目']] || sec < best[r['項目']].sec) best[r['項目']] = { sec, text: r['値'], date: r['日付'] };
  });
  const list = Object.keys(EVENT_M)
    .filter(ev => best[ev])
    .map(ev => ({ event: ev, time: best[ev].text, date: best[ev].date, vdot: round1_(vdot_(EVENT_M[ev], best[ev].sec)) }));
  if (!list.length) return { list, top: null, paces: null, profile: null };

  const top = list.reduce((x, y) => (y.vdot > x.vdot ? y : x));
  const paces = {
    E: secToPace_(paceAt_(top.vdot, 0.66)) + '〜' + secToPace_(paceAt_(top.vdot, 0.59)),
    T: secToPace_(paceAt_(top.vdot, 0.88)),
    I: secToPace_(paceAt_(top.vdot, 0.975)),
  };

  const pickBest = evs => list.filter(x => evs.includes(x.event)).reduce((x, y) => (!x || y.vdot > x.vdot ? y : x), null);
  const short = pickBest(['800m', '1500m']);
  const long = pickBest(['5000m', '10000m', 'ハーフ', 'フル']);
  let profile = null;
  if (short && long) {
    const d = round1_(short.vdot - long.vdot);
    if (d >= 1.5) profile = `${short.event}のVDOTが${long.event}より${d}高く、スピードに比べて持久力（有酸素）側に伸びしろがありそうです。`;
    else if (d <= -1.5) profile = `${long.event}のVDOTが${short.event}より${-d}高く、持久力に比べてスピード（無酸素）側に伸びしろがありそうです。`;
    else profile = `${short.event}と${long.event}のVDOTが近く、スピードと持久力のバランスが取れています。`;
  }
  return { list, top, paces, profile };
}

// ---- パワーマックス ----
function powermaxSessions_() {
  const weightsList = weightList_();
  const groups = {};
  readRows_('powermax').forEach(r => { (groups[r['記録ID']] = groups[r['記録ID']] || []).push(r); });
  return Object.keys(groups).map(id => {
    const rows = groups[id].sort((a, b) => Number(a['番号']) - Number(b['番号']));
    const head = rows[0];
    const s = { id, date: head['日付'], test: head['テスト'], load: head['負荷kp'], memo: head['メモ'] };
    const bw = weightAt_(s.date, weightsList);
    s.bodyWeight = bw;
    if (s.test === 'ウィンゲートテスト') {
      const peak = Number(head['パワーW']) || 0, mean = Number(head['平均パワーW']) || 0, low = Number(head['最低パワーW']) || 0;
      Object.assign(s, {
        peak, mean, low, rpm: head['回転数rpm'],
        fatigue: peak && low ? round1_((peak - low) / peak * 100) : null,
        peakWkg: bw && peak ? Math.round(peak / bw * 100) / 100 : null,
        meanWkg: bw && mean ? Math.round(mean / bw * 100) / 100 : null,
      });
    } else {
      const sets = rows.map(r => ({ rpm: Number(r['回転数rpm']) || null, power: Number(r['パワーW']) || 0, pct: Number(r['対ピーク%']) || null }));
      const powers = sets.map(x => x.power).filter(x => x > 0);
      const avg = powers.length ? powers.reduce((x, y) => x + y, 0) / powers.length : 0;
      const refs = sets.filter(x => x.power && x.pct).map(x => x.power / (x.pct / 100));
      Object.assign(s, {
        sets,
        avg: Math.round(avg),
        max: powers.length ? Math.max.apply(null, powers) : 0,
        drop: powers.length > 1 ? round1_((powers[0] - powers[powers.length - 1]) / powers[0] * 100) : null,
        refPeak: refs.length ? Math.round(refs.reduce((x, y) => x + y, 0) / refs.length) : null,
        avgWkg: bw && avg ? Math.round(avg / bw * 100) / 100 : null,
      });
    }
    return s;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/** 体重の記録の一覧（データタブの記録と毎日の記録の両方から、日付順） */
function weightList_() {
  const list = [];
  readRows_('records').forEach(r => { if (r['区分'] === '身体' && r['項目'] === '体重') list.push([r['日付'], Number(r['値'])]); });
  readRows_('daily').forEach(d => { if (d['体重']) list.push([d['日付'], Number(d['体重'])]); });
  return list.filter(x => x[1] > 0).sort((a, b) => a[0].localeCompare(b[0]));
}

/** その日以前でいちばん新しい体重 */
function weightAt_(date, ok) {
  if (!ok.length) return null;
  const before = ok.filter(x => x[0] <= date);
  return (before.length ? before[before.length - 1] : ok[0])[1];
}
