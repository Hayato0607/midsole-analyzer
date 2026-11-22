/**
 * Run Coach（フェーズ2）
 * ファイル構成：Code.gs / Intervals.gs / Analysis.gs / index.html（4つとも同じプロジェクトに置く）
 *
 * Code.gs      … 画面とのやりとり、データ保存、日誌への反映、練習メニューの読み取り
 * Intervals.gs … ガーミンのデータの取り込み（intervals.icu 経由）
 * Analysis.gs  … VDOT・走行距離・効率・パワーマックスなどの指標計算
 */

// ============================================================
//  設定
// ============================================================
const CONFIG = {
  DIARY_SPREADSHEET_ID: '1JrXDtpmsUKhBMfALbnux6W6VM7AAeAUyzOD1xQ2fmIM',
  DIARY_SHEET_NAMES: ['島田'],
  MENU_SPREADSHEET_ID: 'ここに練習メニューのスプレッドシートIDを貼り付け',
  MENU_SHEET_NAMES: [],              // 空ならメニューの全タブから探す
  WEIGHT_SUMMARY_COLUMN: '備考',     // ウェイトの内容を書き込む日誌の列（不要なら ''）

  EXERCISES: [
    'ベンチプレス', 'スクワット', 'クリーン', 'スナッチ', 'デッドリフト', 'ルーマニアンデッドリフト',
    'ランジ', 'ブルガリアンスクワット', 'ステップアップ', 'ヒップスラスト', 'カーフレイズ',
    'レッグカール', 'レッグエクステンション', 'レッグプレス',
    'プルダウン', '懸垂', 'ローイング', 'ショルダープレス', 'ディップス',
    '腹筋', '背筋', 'プランク', 'メディシンボール', 'その他',
  ],
  PB_EVENTS: ['100m', '200m', '400m', '800m', '1500m', '3000m', '3000mSC', '5000m', '10000m', 'ハーフ', 'フル'],
  POWERMAX_TESTS: ['無酸素パワーテスト', 'ウィンゲートテスト', 'ミドルパワー', 'ハイパワー', 'タバタ'],
  DEFAULT_OPTIONS: ['1', '2', '3', '4', '5'],
  RUN_TYPES: ['Run', 'TrailRun', 'VirtualRun'],
};

const SUBJECTIVE = ['主観的強度', 'コンディション', '疲労感', '蓄積疲労'];
const RECORD_CATEGORIES = ['身体', '専門種目', 'PB', '目標'];
const SHEETS = {
  daily: ['日付', '走行回数', 'トレセン回数', '補強回数', '主観的強度', 'コンディション', '疲労感', '蓄積疲労',
          '入眠', '起床', '睡眠時間', '体重', '備考', '更新日時'],
  weights: ['日付', '種目', '重量kg', '回数', 'セット'],
  records: ['日付', '区分', '項目', '値', 'メモ'],
  powermax: ['記録ID', '日付', 'テスト', '番号', '負荷kp', '回転数rpm', 'パワーW', '対ピーク%', '平均パワーW', '最低パワーW', 'メモ'],
  activities: ['ID', '日付', '開始', '名前', '種類', '距離m', '移動時間s', '経過時間s', '獲得標高m', '平均心拍', '最大心拍',
               '平均ピッチ', '平均パワーW', 'レース', 'ペース分布', 'ラップ', '心拍乖離%', '取得日時'],
  wellness: ['日付', '安静時心拍', 'HRV', '睡眠時間', '睡眠スコア', '体重', 'VO2max', '取得日時'],
};
const DEFAULT_SETTINGS = { walkPace: '7:00', z1Limit: '3:45', z2Limit: '3:15', menuGroup: 'long', autoSync: 'off' };

// ============================================================
//  Webアプリの入口
// ============================================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Run Coach')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

// ============================================================
//  画面から呼ばれる関数
// ============================================================
function getInitData() {
  let options = {};
  let diaryError = null;
  try {
    options = readDropdownOptions_();
  } catch (e) {
    diaryError = e.message;
  }
  SUBJECTIVE.forEach(k => {
    if (!options[k] || !options[k].length) options[k] = CONFIG.DEFAULT_OPTIONS;
  });
  return {
    today: today_(),
    options,
    exercises: CONFIG.EXERCISES,
    pbEvents: CONFIG.PB_EVENTS,
    powermaxTests: CONFIG.POWERMAX_TESTS,
    categories: RECORD_CATEGORIES,
    dataUrl: dataSS_().getUrl(),
    diaryError,
    menuReady: menuReady_(),
  };
}

function getDay(key) {
  checkKey_(key);
  const daily = readRows_('daily').sort((a, b) => a['日付'].localeCompare(b['日付']));
  const entry = daily.find(d => d['日付'] === key) || null;
  const prev = daily.filter(d => d['日付'] < key && (d['入眠'] || d['起床'])).pop();

  const weights = readRows_('weights');
  const pick = w => ({ 種目: w['種目'], 重量kg: w['重量kg'], 回数: w['回数'], セット: w['セット'] });
  const lastDate = weights.map(w => w['日付']).filter(d => d < key).sort().pop() || '';

  let menu = '';
  let menuError = null;
  try { menu = menuMap_(false)[key] || ''; } catch (e) { menuError = e.message; }
  const day = runsByDate_(key, key)[key];
  const wl = readRows_('wellness').find(w => w['日付'] === key);

  return {
    entry: entry ? strip_(entry) : null,
    weights: weights.filter(w => w['日付'] === key).map(pick),
    lastSleep: prev ? { 入眠: prev['入眠'], 起床: prev['起床'] } : null,
    lastWeights: lastDate ? weights.filter(w => w['日付'] === lastDate).map(pick) : [],
    lastWeightsDate: lastDate,
    menu,
    menuError,
    runs: day ? {
      count: day.count,
      zones: day.zones.map(m => round1_(m / 1000)),
      reps: formatReps_(day.reps),
      list: day.runs,
    } : null,
    wellness: wl ? strip_(wl) : null,
  };
}

function saveDay(p) {
  checkKey_(p['日付']);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = dataSS_();
    const head = SHEETS.daily;
    const rec = {};
    head.forEach(h => { rec[h] = clean_(p[h]); });
    rec['睡眠時間'] = sleepHours_(rec['入眠'], rec['起床']);
    rec['更新日時'] = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

    const sh = ss.getSheetByName('daily');
    const existing = readRows_('daily').find(d => d['日付'] === rec['日付']);
    const at = existing ? existing._row : sh.getLastRow() + 1;
    sh.getRange(at, 1, 1, head.length).setNumberFormat('@').setValues([head.map(h => rec[h])]);

    const wsh = ss.getSheetByName('weights');
    readRows_('weights')
      .filter(w => w['日付'] === rec['日付'])
      .map(w => w._row)
      .sort((a, b) => b - a)
      .forEach(r => wsh.deleteRow(r));
    const ws = (p.weights || [])
      .filter(w => clean_(w['種目']))
      .map(w => [rec['日付'], clean_(w['種目']), clean_(w['重量kg']), clean_(w['回数']), clean_(w['セット'])]);
    if (ws.length) {
      wsh.getRange(wsh.getLastRow() + 1, 1, ws.length, SHEETS.weights.length).setNumberFormat('@').setValues(ws);
    }
    return { sleepHours: rec['睡眠時間'] };
  } finally {
    lock.releaseLock();
  }
}

/** データタブ用：記録の一覧とパワーマックスのまとめ */
function getRecords() {
  return {
    records: readRows_('records').map(strip_).sort((a, b) => b['日付'].localeCompare(a['日付'])),
    powermax: powermaxSessions_(),
  };
}

function saveRecord(r) {
  checkKey_(r['日付']);
  if (!RECORD_CATEGORIES.includes(r['区分'])) throw new Error('区分が正しくありません');
  const item = clean_(r['項目']);
  const value = clean_(r['値']);
  if (!item) throw new Error('項目を選んでください');
  if (!value) throw new Error('値を入力してください');
  if (r['区分'] === 'PB' && parseTime_(value) === null) {
    throw new Error('記録は「14:35.20」「1:55.30」「52.10」のような形で入力してください');
  }
  appendRows_('records', [[r['日付'], r['区分'], item, value, clean_(r['メモ'])]]);
  return getRecords();
}

function savePowermax(p) {
  checkKey_(p['日付']);
  const test = p['テスト'];
  if (!CONFIG.POWERMAX_TESTS.includes(test)) throw new Error('テストの種類が正しくありません');
  const id = 'pm' + Date.now();
  const load = num_(p['負荷kp']);
  const memo = clean_(p['メモ']);
  let rows;
  if (test === 'ウィンゲートテスト') {
    const w = p.wingate || {};
    if (!num_(w['ピークパワーW'])) throw new Error('ピークパワーを入力してください');
    rows = [[id, p['日付'], test, '1', load, num_(w['回転数rpm']), num_(w['ピークパワーW']), '',
             num_(w['平均パワーW']), num_(w['最低パワーW']), memo]];
  } else {
    rows = (p.sets || [])
      .filter(s => num_(s['パワーW']))
      .map((s, i) => [id, p['日付'], test, String(i + 1), load, num_(s['回転数rpm']), num_(s['パワーW']),
                      num_(s['対ピーク%']), '', '', i === 0 ? memo : '']);
    if (!rows.length) throw new Error('少なくとも1セット分のパワーを入力してください');
  }
  appendRows_('powermax', rows);
  return getRecords();
}

function getSettings() {
  const p = PropertiesService.getScriptProperties();
  const s = {};
  Object.keys(DEFAULT_SETTINGS).forEach(k => { s[k] = p.getProperty('SET_' + k) || DEFAULT_SETTINGS[k]; });
  return Object.assign(s, linkStatus_());
}

function saveSettings(s) {
  const paces = ['walkPace', 'z1Limit', 'z2Limit'].map(k => String(s[k] || '').trim());
  if (!paces.every(v => /^\d{1,2}:\d{2}$/.test(v))) throw new Error('ペースは「3:45」の形で入力してください');
  const [w, z1, z2] = paces.map(paceToSec_);
  if (!(w > z1 && z1 > z2)) throw new Error('walk → z1 → z2 の順に速いペースになるように入力してください');
  if (!['long', 'middle'].includes(s.menuGroup)) throw new Error('メニューの列が正しくありません');

  const p = PropertiesService.getScriptProperties();
  const before = p.getProperty('SET_menuGroup');
  p.setProperty('SET_walkPace', paces[0]);
  p.setProperty('SET_z1Limit', paces[1]);
  p.setProperty('SET_z2Limit', paces[2]);
  p.setProperty('SET_menuGroup', s.menuGroup);
  if (before !== s.menuGroup) CacheService.getScriptCache().remove('menu_' + before);
  setAutoSync_(s.autoSync === 'on');
  return getSettings();
}

/** 保存済みの記録・練習メニュー・Stravaのデータを日誌に書き込む（fromKey〜toKey） */
function reflectToDiary(fromKey, toKey) {
  checkKey_(fromKey);
  checkKey_(toKey);
  const today = today_();
  const actualEnd = toKey < today ? toKey : today;

  const daily = {};
  readRows_('daily').forEach(d => { daily[d['日付']] = d; });
  const weightsByDate = {};
  readRows_('weights').forEach(w => { (weightsByDate[w['日付']] = weightsByDate[w['日付']] || []).push(w); });
  let menu = {};
  try { menu = menuMap_(fromKey !== toKey); } catch (e) { /* メニューが読めなくても他は反映する */ }
  const runs = actualEnd >= fromKey ? runsByDate_(fromKey, actualEnd) : {};
  const wellness = {};
  readRows_('wellness').forEach(w => { wellness[w['日付']] = w; });

  const layouts = diaryLayouts_();
  const fields = ['トレセン回数', '補強回数', '主観的強度', 'コンディション', '疲労感', '蓄積疲労', '体重', '睡眠時間'];
  const target = CONFIG.WEIGHT_SUMMARY_COLUMN;
  let changed = 0, days = 0;

  dateKeysBetween_(fromKey, toKey).forEach(key => {
    const d = daily[key];
    const day = runs[key];
    const plan = menu[key] || '';
    let touched = false;

    layouts.forEach(L => {
      const r = L.rows[key];
      if (r === undefined) return;
      const before = changed;

      // 練習計画（範囲内の全日）
      if (plan) changed += setIfChanged_(L, r, L.cols['練習計画'], plan);
      if (key > actualEnd) { if (changed > before) touched = true; return; }

      // ウェイトの1行
      const summary = weightSummary_(weightsByDate[key] || []);
      const wline = summary ? '【ウェイト】' + summary : '';

      // 実施内容：計画＋実際のラップ（手で書き換えた内容は残す）
      const ac = L.cols['実施内容'];
      if (ac !== undefined) {
        let text = plan;
        if (day && day.reps.length) text = (text ? text + '\n' : '') + '→ ' + formatReps_(day.reps);
        const cur = String(L.values[r][ac] || '');
        const base = stripTag_(cur);
        const body = text && (base === '' || base === plan || base === text) ? text : base;
        const tag = target === '実施内容' ? wline : (cur.split('\n').find(s => s.startsWith('【ウェイト】')) || '');
        const next = [body, tag].filter(Boolean).join('\n');
        if (next) changed += setIfChanged_(L, r, ac, next);
      }

      // 走行回数とz1〜z3・walk
      const runCount = d && d['走行回数'] !== '' ? d['走行回数'] : (day ? String(day.count) : '');
      if (runCount !== '') changed += setIfChanged_(L, r, L.cols['走行回数'], Number(runCount));
      if (day) {
        ['walk', 'z1', 'z2', 'z3'].forEach((h, i) => {
          changed += setIfChanged_(L, r, L.cols[h], round1_(day.zones[i] / 1000));
        });
      }

      // 手入力の項目
      if (d) {
        fields.forEach(f => { if (d[f] !== '') changed += setIfChanged_(L, r, L.cols[f], toCellValue_(d[f])); });
        if (target === '備考') {
          const text = [d['備考'], wline].filter(Boolean).join('\n');
          if (text) changed += setIfChanged_(L, r, L.cols['備考'], text);
        } else {
          if (d['備考']) changed += setIfChanged_(L, r, L.cols['備考'], d['備考']);
          const c = L.cols[target];
          if (target && target !== '実施内容' && wline && c !== undefined) {
            const kept = stripTag_(String(L.values[r][c] || ''));
            changed += setIfChanged_(L, r, c, kept ? kept + '\n' + wline : wline);
          }
        }
      }
      // 手入力がない日は、ガーミンの睡眠時間と体重を使う
      const wl = wellness[key];
      if (wl) {
        if (wl['睡眠時間'] && (!d || d['睡眠時間'] === '')) changed += setIfChanged_(L, r, L.cols['睡眠時間'], Number(wl['睡眠時間']));
        if (wl['体重'] && (!d || d['体重'] === '')) changed += setIfChanged_(L, r, L.cols['体重'], Number(wl['体重']));
      }
      if (changed > before) touched = true;
    });
    if (touched) days++;
  });

  return days
    ? `${days}日分を日誌に反映しました（${changed}か所を更新）`
    : '日誌はすでに最新の状態です';
}

// ============================================================
//  データ用スプレッドシート
// ============================================================
let _ss = null;

function dataSS_() {
  if (_ss) return _ss;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DATA_SS_ID');
  if (id) {
    try { _ss = SpreadsheetApp.openById(id); } catch (e) { _ss = null; }
  }
  if (!_ss) {
    _ss = SpreadsheetApp.create('Run Coach データ');
    props.setProperty('DATA_SS_ID', _ss.getId());
  }
  Object.keys(SHEETS).forEach(name => {
    if (_ss.getSheetByName(name)) return;
    const sh = _ss.insertSheet(name);
    sh.getRange('A:Z').setNumberFormat('@');
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  ['シート1', 'Sheet1'].forEach(n => {
    const s = _ss.getSheetByName(n);
    if (s && _ss.getSheets().length > 1) _ss.deleteSheet(s);
  });
  return _ss;
}

function readRows_(name) {
  const sh = dataSS_().getSheetByName(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const head = SHEETS[name];
  return sh.getRange(2, 1, last - 1, head.length).getDisplayValues()
    .map((r, i) => {
      const o = { _row: i + 2 };
      head.forEach((h, j) => { o[h] = String(r[j]).trim(); });
      return o;
    })
    .filter(o => o[head[0]]);
}

function appendRows_(name, rows) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = dataSS_().getSheetByName(name);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, SHEETS[name].length).setNumberFormat('@')
      .setValues(rows.map(r => r.map(v => (v === null || v === undefined ? '' : String(v)))));
  } finally {
    lock.releaseLock();
  }
}

function strip_(o) {
  const c = Object.assign({}, o);
  delete c._row;
  return c;
}

/** 取り込んだランを日付ごとにまとめる（ゾーンは今の設定で計算） */
function runsByDate_(fromKey, toKey) {
  const th = thresholds_();
  const out = {};
  readRows_('activities')
    .map(parseActivity_)
    .filter(a => a.date >= fromKey && a.date <= toKey)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .forEach(a => {
      const d = out[a.date] || (out[a.date] = { count: 0, zones: [0, 0, 0, 0], reps: [], runs: [] });
      d.count++;
      zonesFromHist_(a.hist, th).forEach((m, i) => { d.zones[i] += m; });
      d.reps = d.reps.concat(repLaps_(a.laps, th));
      d.runs.push({ name: a.name, km: round1_(a.dist / 1000), start: a.start, hr: a.hr || '' });
    });
  return out;
}

// ============================================================
//  日誌スプレッドシート
// ============================================================
function diaryLayouts_() {
  if (!CONFIG.DIARY_SPREADSHEET_ID || CONFIG.DIARY_SPREADSHEET_ID.startsWith('ここに')) {
    throw new Error('Code.gs の DIARY_SPREADSHEET_ID に日誌のスプレッドシートIDを入れてください');
  }
  const ss = SpreadsheetApp.openById(CONFIG.DIARY_SPREADSHEET_ID);
  const tz = ss.getSpreadsheetTimeZone();
  return CONFIG.DIARY_SHEET_NAMES.map(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) throw new Error(`日誌にシート「${name}」が見つかりません。DIARY_SHEET_NAMES をタブ名に合わせてください`);
    const L = readDiary_(sh, tz);
    if (!L) throw new Error(`シート「${name}」に「日付」「走行回数」の見出しが見つかりません`);
    return L;
  });
}

function readDiary_(sheet, tz) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  const disp = range.getDisplayValues();
  const formulas = range.getFormulas();
  let cols = null;
  for (let r = 0; r < disp.length && !cols; r++) {
    const row = disp[r].map(s => String(s).trim());
    if (row.includes('日付') && row.includes('走行回数')) {
      cols = {};
      row.forEach((h, i) => { if (h && !(h in cols)) cols[h] = i; });
    }
  }
  if (!cols) return null;
  const rows = {};
  values.forEach((v, r) => {
    const k = toDateKey_(v[cols['日付']], tz);
    if (k && !(k in rows)) rows[k] = r;
  });
  return { sheet, cols, rows, values, formulas };
}

function readDropdownOptions_() {
  const L = diaryLayouts_()[0];
  const dateRows = Object.values(L.rows);
  if (!dateRows.length) return {};
  const firstRow = Math.min.apply(null, dateRows);
  const out = {};
  SUBJECTIVE.forEach(name => {
    const c = L.cols[name];
    if (c === undefined) return;
    const dv = L.sheet.getRange(firstRow + 1, c + 1).getDataValidation();
    if (!dv) return;
    const type = dv.getCriteriaType();
    const vals = dv.getCriteriaValues();
    let list = [];
    if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) list = vals[0];
    else if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) list = [].concat.apply([], vals[0].getDisplayValues());
    out[name] = list.map(s => String(s).trim()).filter(s => s && s !== '選択');
  });
  return out;
}

function setIfChanged_(L, r, c, value) {
  if (c === undefined || c < 0 || L.formulas[r][c]) return 0;
  const cur = L.values[r][c];
  if (cur === value || String(cur) === String(value)) return 0;
  L.sheet.getRange(r + 1, c + 1).setValue(value);
  L.values[r][c] = value;
  return 1;
}

function stripTag_(text) {
  return String(text || '').split('\n').filter(s => !s.startsWith('【ウェイト】')).join('\n');
}

// ============================================================
//  練習メニューの読み取り（6時間キャッシュ）
// ============================================================
function menuReady_() {
  return !!CONFIG.MENU_SPREADSHEET_ID && !CONFIG.MENU_SPREADSHEET_ID.startsWith('ここに');
}

function menuMap_(fresh) {
  if (!menuReady_()) return {};
  const group = PropertiesService.getScriptProperties().getProperty('SET_menuGroup') || DEFAULT_SETTINGS.menuGroup;
  const cache = CacheService.getScriptCache();
  const key = 'menu_' + group;
  if (!fresh) {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  const map = loadMenu_(group);
  try { cache.put(key, JSON.stringify(map), 21600); } catch (e) { /* 大きすぎる場合はキャッシュしない */ }
  return map;
}

function loadMenu_(group) {
  const ss = SpreadsheetApp.openById(CONFIG.MENU_SPREADSHEET_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const sheets = CONFIG.MENU_SHEET_NAMES.length
    ? CONFIG.MENU_SHEET_NAMES.map(n => ss.getSheetByName(n)).filter(Boolean)
    : ss.getSheets();
  const menu = {};
  sheets.forEach(sh => {
    const range = sh.getDataRange();
    const values = range.getValues();
    const disp = range.getDisplayValues();
    fillMerged_(range, [values, disp]);
    const cols = findMenuColumns_(disp);
    if (!cols) return;
    const col = group === 'middle' ? cols.middle : cols.long;
    if (col < 0) return;
    for (let r = cols.headerRow + 1; r < values.length; r++) {
      const key = toDateKey_(values[r][cols.date], tz);
      if (!key) continue;
      const text = String(disp[r][col] || '').trim();
      if (!text) continue;
      if (!menu[key]) menu[key] = text;
      else if (!menu[key].includes(text)) menu[key] += '\n' + text;
    }
  });
  return menu;
}

function findMenuColumns_(disp) {
  for (let r = 0; r < disp.length; r++) {
    const row = disp[r].map(s => String(s).trim());
    const date = row.indexOf('日付');
    const long = row.findIndex(s => s.includes('長距離'));
    const middle = row.findIndex(s => s.includes('中距離'));
    if (date >= 0 && (long >= 0 || middle >= 0)) return { headerRow: r, date, long, middle };
  }
  return null;
}

function fillMerged_(range, arrays) {
  const r0 = range.getRow(), c0 = range.getColumn();
  const nRows = arrays[0].length, nCols = nRows ? arrays[0][0].length : 0;
  range.getMergedRanges().forEach(m => {
    const top = m.getRow() - r0, left = m.getColumn() - c0;
    if (top < 0 || left < 0 || top >= nRows || left >= nCols) return;
    for (let r = top; r < Math.min(nRows, top + m.getNumRows()); r++) {
      for (let c = left; c < Math.min(nCols, left + m.getNumColumns()); c++) {
        if (r === top && c === left) continue;
        arrays.forEach(a => { a[r][c] = a[top][left]; });
      }
    }
  });
}

// ============================================================
//  ペース・ゾーン
// ============================================================
function thresholds_() {
  const p = PropertiesService.getScriptProperties();
  const g = k => paceToSec_(p.getProperty('SET_' + k) || DEFAULT_SETTINGS[k]);
  return { walk: g('walkPace'), z1: g('z1Limit'), z2: g('z2Limit') };
}

/** 1kmあたりの秒 → 0:walk 1:z1 2:z2 3:z3 */
function zoneOfPace_(pace, th) {
  if (pace > th.walk) return 0;
  if (pace >= th.z1) return 1;
  if (pace >= th.z2) return 2;
  return 3;
}

function zonesFromHist_(hist, th) {
  const z = [0, 0, 0, 0];
  Object.keys(hist || {}).forEach(k => { z[zoneOfPace_(Number(k), th)] += Number(hist[k]) || 0; });
  return z;
}

/** ラップ [[距離m, 秒, 平均速度m/s], ...] から z2 以上で100m以上のもの */
function repLaps_(laps, th) {
  return (laps || [])
    .filter(l => l[0] >= 100 && l[2] > 0 && zoneOfPace_(1000 / l[2], th) >= 2)
    .map(l => [l[0], l[1]]);
}

function formatReps_(reps) {
  const groups = [];
  reps.slice(0, 30).forEach(([d, t]) => {
    const dist = d >= 500 ? Math.round(d / 100) * 100 : Math.round(d / 50) * 50;
    const last = groups[groups.length - 1];
    if (last && last.dist === dist) last.times.push(t);
    else groups.push({ dist, times: [t] });
  });
  return groups.map(g => `${g.dist}m: ${g.times.map(fmtTime_).join('-')}`).join(' / ');
}

function fmtTime_(sec) {
  sec = Math.round(sec);
  if (sec < 60) return String(sec);
  return Math.floor(sec / 60) + "'" + String(sec % 60).padStart(2, '0');
}

function paceToSec_(s) {
  const [m, sec] = String(s).split(':').map(Number);
  return m * 60 + (sec || 0);
}

function secToPace_(sec) {
  const s = Math.round(sec);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// ============================================================
//  小物
// ============================================================
function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function weightSummary_(ws) {
  return ws.map(w => {
    const parts = [
      w['重量kg'] && `${w['重量kg']}kg`,
      w['回数'] && `${w['回数']}回`,
      w['セット'] && `${w['セット']}set`,
    ].filter(Boolean);
    return w['種目'] + (parts.length ? ' ' + parts.join('×') : '');
  }).join(', ');
}

function sleepHours_(a, b) {
  const t = s => {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const s = t(a), w = t(b);
  if (s === null || w === null) return '';
  let diff = w - s;
  if (diff <= 0) diff += 1440;
  return String(Math.round(diff / 6) / 10);
}

/** "14:35.20" "1:05:30" "52.10" → 秒（読めなければ null） */
function parseTime_(s) {
  const t = String(s || '').trim().replace(/[’'′]/g, ':').replace(/[”"″]/g, '.');
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  return t.split(':').reduce((acc, v) => acc * 60 + Number(v), 0);
}

function round1_(x) { return Math.round(x * 10) / 10; }
function toCellValue_(s) { return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s; }
function clean_(v) { return v === undefined || v === null ? '' : String(v).trim().slice(0, 2000); }
function num_(v) {
  const s = clean_(v).replace(/[^\d.\-]/g, '');
  return s && !isNaN(Number(s)) ? s : '';
}
function checkKey_(k) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(k))) throw new Error('日付の形式が正しくありません: ' + k);
}

function toDateKey_(v, tz) {
  if (v instanceof Date && !isNaN(v)) {
    const key = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return Number(key.slice(0, 4)) >= 2000 ? key : null;
  }
  if (typeof v !== 'string') return null;
  const m = v.match(/(?:(\d{4})\s*[\/年.-]\s*)?(\d{1,2})\s*[\/月.-]\s*(\d{1,2})/);
  if (!m) return null;
  const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const now = new Date();
  let y = m[1] ? +m[1] : now.getFullYear();
  if (!m[1]) {
    const cm = now.getMonth() + 1;
    if (mo - cm > 6) y--; else if (cm - mo > 6) y++;
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function keyToEpoch_(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 1000;
}

function addDays_(key, n) {
  return new Date((keyToEpoch_(key) + n * 86400) * 1000).toISOString().slice(0, 10);
}

function dateKeysBetween_(a, b) {
  const out = [];
  for (let k = a; k <= b; k = addDays_(k, 1)) out.push(k);
  return out;
}

function weekStart_(key) {
  const wd = (new Date(keyToEpoch_(key) * 1000).getUTCDay() + 6) % 7;
  return addDays_(key, -wd);
}
