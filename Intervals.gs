/**
 * ガーミンのデータの取り込み（intervals.icu 経由）
 * intervals.icu をガーミンと直接連携し、設定ページの「Developer Settings」にある
 * アスリートIDとAPIキーをアプリのデータタブで入力して使う。
 */

const ICU_API = 'https://intervals.icu/api/v1';

function sp_() {
  return PropertiesService.getScriptProperties();
}

function linkStatus_() {
  const p = sp_();
  return {
    linked: !!p.getProperty('ICU_API_KEY'),
    linkName: p.getProperty('ICU_NAME') || '',
    lastSync: p.getProperty('ICU_LAST_SYNC') || '',
  };
}

// ============================================================
//  接続
// ============================================================
function connectIntervals(athleteId, apiKey) {
  const id = clean_(athleteId) || '0';
  const key = clean_(apiKey);
  if (!key) throw new Error('APIキーを入力してください');
  if (!/^i?\d+$/.test(id)) throw new Error('アスリートIDは「i123456」のような形です');
  const p = sp_();
  p.setProperty('ICU_ATHLETE_ID', id);
  p.setProperty('ICU_API_KEY', key);
  try {
    const a = icuGet_(`/athlete/${id}`);
    if (a && a.id) p.setProperty('ICU_ATHLETE_ID', String(a.id));
    p.setProperty('ICU_NAME', (a && (a.name || a.firstname)) || id);
  } catch (e) {
    p.deleteProperty('ICU_API_KEY');
    p.deleteProperty('ICU_NAME');
    throw e;
  }
  return getSettings();
}

function disconnectIntervals() {
  ['ICU_API_KEY', 'ICU_NAME', 'ICU_ATHLETE_ID'].forEach(k => sp_().deleteProperty(k));
  setAutoSync_(false);
  return getSettings();
}

function icuGet_(path, allow404) {
  const key = sp_().getProperty('ICU_API_KEY');
  if (!key) throw new Error('intervals.icu と接続していません。データタブの設定から接続できます');
  const res = UrlFetchApp.fetch(ICU_API + path, {
    headers: { Authorization: 'Basic ' + Utilities.base64Encode('API_KEY:' + key) },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 429) { const e = new Error('rate limit'); e.rateLimited = true; throw e; }
  if (code === 404 && allow404) return null;
  if (code === 401 || code === 403) throw new Error('intervals.icu のAPIキーが正しくないか、無効になっています。設定から入れ直してください');
  if (code === 404) throw new Error('intervals.icu でデータが見つかりません。アスリートIDを確認してください');
  if (code >= 400) throw new Error(`intervals.icu エラー ${code}: ${res.getContentText().slice(0, 200)}`);
  return JSON.parse(res.getContentText());
}

// ============================================================
//  取り込み
// ============================================================
/** 新しいランと健康データ（睡眠・安静時心拍など）を取り込む。初回は過去8週間分 */
function syncData() {
  const p = sp_();
  if (!p.getProperty('ICU_API_KEY')) throw new Error('intervals.icu と接続していません。データタブの設定から接続できます');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) throw new Error('別の取り込みが実行中です。少し待ってからもう一度押してください');
  try {
    const started = Date.now();
    const today = today_();
    const lastDate = p.getProperty('ICU_LAST_SYNC_DATE');
    const oldest = lastDate ? addDays_(lastDate, -3) : addDays_(today, -56);
    const id = p.getProperty('ICU_ATHLETE_ID') || '0';
    const have = new Set(readRows_('activities').map(a => a['ID']));

    const list = icuGet_(`/athlete/${id}/activities?oldest=${oldest}&newest=${today}`) || [];
    let viaStrava = 0;
    const todo = list
      .filter(a => {
        if (!CONFIG.RUN_TYPES.includes(a.type)) return false;
        if (String(a.source || '').toUpperCase() === 'STRAVA') { viaStrava++; return false; }
        return !have.has(String(a.id));
      })
      .sort((a, b) => String(a.start_date_local).localeCompare(String(b.start_date_local)));

    const th = thresholds_();
    const rows = [];
    let pending = 0, limited = false;
    for (const a of todo) {
      if (limited || Date.now() - started > 240000) { pending++; continue; }
      try {
        rows.push(activityRow_(a, th));
      } catch (e) {
        if (e.rateLimited) { limited = true; pending++; } else throw e;
      }
    }
    if (rows.length) appendRows_('activities', rows);

    let wellNote = '';
    try {
      syncWellness_(id, oldest, today);
    } catch (e) {
      wellNote = '（睡眠・心拍などの健康データは取得できませんでした）';
    }

    if (!pending) p.setProperty('ICU_LAST_SYNC_DATE', today);
    p.setProperty('ICU_LAST_SYNC', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d HH:mm'));

    let msg = rows.length ? `${rows.length}件のランを取り込みました` : '新しいランはありませんでした';
    if (pending) msg += `。残り${pending}件は時間がかかるため、もう一度押すと続きを取り込みます`;
    if (viaStrava) msg += `。Strava経由のランが${viaStrava}件あり、取り込めませんでした（intervals.icu でガーミンと直接連携してください）`;
    return msg + wellNote;
  } finally {
    lock.releaseLock();
  }
}

/** 毎晩の自動取り込み（トリガーから呼ばれる） */
function autoSyncData() {
  try { console.log(syncData()); } catch (e) { console.log('自動取り込みエラー: ' + e.message); }
}

function setAutoSync_(on) {
  ScriptApp.getProjectTriggers()
    .filter(t => ['autoSyncData', 'autoSyncStrava'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (on) ScriptApp.newTrigger('autoSyncData').timeBased().everyDays(1).atHour(22).create();
  sp_().setProperty('SET_autoSync', on ? 'on' : 'off');
}

/** 1つのランを、データ用シートの1行にする */
function activityRow_(a, th) {
  const s = normStreams_(icuGet_(`/activity/${a.id}/streams?types=time,distance,velocity_smooth,heartrate`, true));
  let laps = [];
  try {
    laps = intervalsOf_(icuGet_(`/activity/${a.id}/intervals`, true));
  } catch (e) {
    if (e.rateLimited) throw e;
  }
  if (!laps.length) laps = segmentsFromStreams_(s, th);
  const cad = Number(a.average_cadence) || 0;
  const hr = Number(a.average_heartrate || a.average_hr) || 0;
  const watts = Number(a.icu_average_watts || a.average_watts) || 0;
  const decoup = decoupling_(s);
  return [
    String(a.id),
    String(a.start_date_local).slice(0, 10),
    String(a.start_date_local).slice(11, 16),
    a.name || '',
    a.type || '',
    Math.round(Number(a.distance) || 0),
    Number(a.moving_time) || 0,
    Number(a.elapsed_time) || 0,
    Math.round(Number(a.total_elevation_gain) || 0),
    hr ? round1_(hr) : '',
    a.max_heartrate || '',
    cad ? round1_(cad < 120 ? cad * 2 : cad) : '',   // 片足ぶんの値なら2倍して歩/分に
    watts ? Math.round(watts) : '',
    a.race ? '1' : '',
    JSON.stringify(paceHistogram_(s, laps, a)),
    JSON.stringify(laps),
    decoup === null ? '' : decoup,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
  ];
}

function normStreams_(s) {
  const get = type => {
    if (!s) return null;
    if (Array.isArray(s)) return (s.find(x => x.type === type) || {}).data || null;
    return (s[type] && (s[type].data || s[type])) || null;
  };
  const out = { time: get('time'), distance: get('distance'), velocity: get('velocity_smooth'), heartrate: get('heartrate'), moving: get('moving') };
  if (!out.time && out.distance) out.time = out.distance.map((_, i) => i); // 時刻がなければ1秒ごとの記録とみなす
  return out;
}

/** intervals.icu の区間（ラップ・自動検出のインターバル）→ [[距離m, 秒, 平均速度m/s], ...] */
function intervalsOf_(res) {
  const arr = Array.isArray(res) ? res : ((res && (res.icu_intervals || res.intervals)) || []);
  return arr.map(iv => {
    const d = Number(iv.distance) || 0;
    const t = Number(iv.elapsed_time || iv.moving_time) || 0;
    const mt = Number(iv.moving_time || iv.elapsed_time) || 0;
    const v = Number(iv.average_speed) || (mt ? d / mt : 0);
    return [Math.round(d), t, Math.round(v * 100) / 100];
  }).filter(l => l[0] > 0 && l[1] > 0);
}

/** 区間データがないときの代わり：10秒平均の速度が z2 以上の区間を1本として切り出す */
function segmentsFromStreams_(s, th) {
  if (!s.distance || !s.time || s.distance.length < 20) return [];
  const n = s.distance.length;
  const speedAt = i => {
    const j = Math.max(0, i - 10);
    const dt = s.time[i] - s.time[j];
    return dt > 0 ? (s.distance[i] - s.distance[j]) / dt : 0;
  };
  const segs = [];
  let start = -1;
  for (let i = 1; i < n; i++) {
    const v = speedAt(i);
    const fast = v > 0 && zoneOfPace_(1000 / v, th) >= 2;
    if (fast && start < 0) start = Math.max(0, i - 5);
    if (start >= 0 && (!fast || i === n - 1)) {
      const end = fast ? i : Math.max(start, i - 5);
      const d = s.distance[end] - s.distance[start];
      const t = s.time[end] - s.time[start];
      if (d >= 150 && t > 0) segs.push([Math.round(d), t, Math.round(d / t * 100) / 100]);
      start = -1;
    }
  }
  return segs;
}

/** ペースごとの距離（1秒/km刻み、2:00〜15:00/km）。ゾーンの区切りを後で変えても計算し直せる */
function paceHistogram_(s, laps, a) {
  const h = {};
  const add = (pace, m) => {
    if (!(m > 0)) return;
    const k = String(Math.min(900, Math.max(120, Math.round(pace))));
    h[k] = (h[k] || 0) + m;
  };
  if (s.distance && s.distance.length > 1) {
    for (let i = 1; i < s.distance.length; i++) {
      const dd = s.distance[i] - s.distance[i - 1];
      if (!(dd > 0)) continue;
      let v = s.velocity ? s.velocity[i] : null;
      if (!(v > 0) && s.time) v = dd / Math.max(1, s.time[i] - s.time[i - 1]);
      add(v > 0 ? 1000 / v : 900, dd);
    }
  } else if (laps.length) {
    laps.forEach(l => add(l[2] > 0 ? 1000 / l[2] : 900, l[0]));
  } else {
    const v = Number(a.average_speed) || ((Number(a.moving_time) || 0) ? Number(a.distance) / Number(a.moving_time) : 0);
    add(v > 0 ? 1000 / v : 900, Number(a.distance) || 0);
  }
  Object.keys(h).forEach(k => { h[k] = Math.round(h[k]); });
  return h;
}

/** 前半と後半で「速度÷心拍」がどれだけ落ちたか（%）。30分以上動いたランだけ */
function decoupling_(s) {
  const { time, distance, heartrate, moving } = s;
  if (!time || !distance || !heartrate || time.length < 10) return null;
  const seg = [];
  let total = 0;
  for (let i = 1; i < time.length; i++) {
    const dt = time[i] - time[i - 1];
    if (dt <= 0 || dt > 30 || (moving && !moving[i]) || !(heartrate[i] > 0)) continue;
    const dd = Math.max(0, distance[i] - distance[i - 1]);
    if (dd / dt < 1) continue; // 止まっている間は除く
    seg.push([dt, dd, heartrate[i]]);
    total += dt;
  }
  if (total < 1800) return null;
  const half = [{ t: 0, d: 0, hb: 0 }, { t: 0, d: 0, hb: 0 }];
  let acc = 0;
  seg.forEach(([dt, dd, hr]) => {
    const h = half[acc < total / 2 ? 0 : 1];
    h.t += dt; h.d += dd; h.hb += hr * dt;
    acc += dt;
  });
  if (!half[0].hb || !half[1].hb || !half[0].d) return null;
  const ef = h => (h.d / h.t) / (h.hb / h.t);
  return round1_((ef(half[0]) - ef(half[1])) / ef(half[0]) * 100);
}

/** 睡眠・安静時心拍・HRV・体重・VO2max（ガーミンから intervals.icu に届いているもの） */
function syncWellness_(id, oldest, newest) {
  const list = icuGet_(`/athlete/${id}/wellness?oldest=${oldest}&newest=${newest}`) || [];
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const rows = list.map(w => {
    const date = String(w.id || w.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const vals = [
      w.restingHR || '',
      w.hrv || w.hrvSDNN || '',
      w.sleepSecs ? round1_(w.sleepSecs / 3600) : '',
      w.sleepScore || '',
      w.weight || '',
      w.vo2max || '',
    ];
    return vals.every(v => v === '') ? null : [date].concat(vals, [now]);
  }).filter(Boolean);
  upsertByDate_('wellness', rows);
  return rows.length;
}

function upsertByDate_(name, rows) {
  if (!rows.length) return;
  const sh = dataSS_().getSheetByName(name);
  const at = {};
  readRows_(name).forEach(r => { at[r['日付']] = r._row; });
  const add = [];
  rows.forEach(r => {
    const vals = r.map(v => (v === null || v === undefined ? '' : String(v)));
    if (at[r[0]]) sh.getRange(at[r[0]], 1, 1, vals.length).setNumberFormat('@').setValues([vals]);
    else add.push(vals);
  });
  if (add.length) appendRows_(name, add);
}
