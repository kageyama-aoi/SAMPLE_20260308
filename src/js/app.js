// ===== ストレージ =====
const STORAGE_KEY = 'braft_entries';

function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ===== 祝日データ =====
// src/data/holidays.json を fetch して使う。失敗時は空マップ。
let holidayMap = {};

async function loadHolidays() {
  try {
    const res = await fetch('src/data/holidays.json');
    if (!res.ok) throw new Error();
    holidayMap = await res.json();
    setHolidayStatus(`祝日データ読み込み済み（${Object.keys(holidayMap).length}件）`);
  } catch {
    setHolidayStatus('祝日データを読み込めませんでした（ローカルサーバー経由で開いてください）', true);
  }
  renderCalendars();
}

function isHoliday(dateKey) { return !!holidayMap[dateKey]; }
function getHolidayName(dateKey) { return holidayMap[dateKey] || ''; }

function setHolidayStatus(msg, isError = false) {
  const el = document.getElementById('holiday-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `holiday-status${isError ? ' holiday-status-error' : ''}`;
}

// 祝日データ更新ボタン：API取得 → holidays.json としてダウンロード
document.getElementById('holiday-update-btn').addEventListener('click', async () => {
  const btn = document.getElementById('holiday-update-btn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'sync';
  setHolidayStatus('APIから取得中...');

  try {
    // holidays-jp API：YYYY-MM-DD 形式で返ってくる
    const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
    if (!res.ok) throw new Error();
    const raw = await res.json();

    // YYYY-MM-DD → YYYY/MM/DD に変換
    const converted = {};
    for (const [k, v] of Object.entries(raw)) {
      converted[k.replace(/-/g, '/')] = v;
    }

    // ダウンロード
    const blob = new Blob([JSON.stringify(converted, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'holidays.json';
    a.click();
    URL.revokeObjectURL(a.href);

    // メモリ上のマップも更新
    holidayMap = converted;
    renderCalendars();
    setHolidayStatus(`祝日データを更新しました（${Object.keys(converted).length}件）。ダウンロードしたファイルを src/data/holidays.json に置き換えてください。`);
  } catch {
    setHolidayStatus('取得に失敗しました。インターネット接続を確認してください。', true);
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'event';
  }
});

// ===== 状態 =====
let sortState = { col: 'date', dir: 'asc' };
const now = new Date();
let calMonth = { year: now.getFullYear(), month: now.getMonth() };
let calWeekStart = getWeekStart(new Date()); // 月曜日

// ===== テキスト解析パーサー =====
function parseText(text) {
  const results = [];
  const urlMatch = text.match(/https?:\/\/\S+/);
  const url = urlMatch ? urlMatch[0] : '';
  const requesterMatch = text.match(/^(.{2,10})(?:です|より|から)[\s。]/m);
  const requester = requesterMatch ? requesterMatch[1].trim() : '';

  const isInline = /\d+\/\d+[（(]\S[)）]\s+\S+\s+\d+:\d+[〜~]\d+:\d+/.test(text);
  const isBullet = /(?:場所|時間|プログラム)[：:]/u.test(text);

  if (isInline) parseInline(text, url, requester, results);
  if (isBullet)  parseBullet(text, url, requester, results);
  if (results.length === 0) parseGeneric(text, url, requester, results);

  return results.filter(r => r.date && (r.gym || r.time));
}

function parseInline(text, url, requester, results) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(
      /(\d+\/\d+)[（(]\S[)）]\s+([^\s　]+(?:\s[^\s　]+)*?)[　\s]+(\d+:\d+[〜~]\d+:\d+)\s*([\S].*)?/
    );
    if (m) {
      results.push({
        date: normalizeDate(m[1]), gym: m[2].trim(),
        time: m[3].replace('~', '〜'), className: m[4] ? m[4].trim() : '',
        requester, deputy: '', status: 'open', url
      });
    }
  }
}

function parseBullet(text, url, requester, results) {
  const datePattern = /(\d+月\d+日[（(]\S[)）]|\d+\/\d+[（(]\S[)）])/g;
  const blocks = [];
  let lastIndex = 0, match;
  while ((match = datePattern.exec(text)) !== null) {
    if (lastIndex > 0) blocks.push(text.slice(lastIndex, match.index));
    lastIndex = match.index;
  }
  if (lastIndex < text.length) blocks.push(text.slice(lastIndex));

  for (const body of blocks) {
    const dateMatch = body.match(/(\d+月\d+日[（(]\S[)）]|\d+\/\d+[（(]\S[)）])/);
    if (!dateMatch) continue;
    const gymMatch   = body.match(/場所[：:]\s*(.+)/);
    const timeMatch  = body.match(/時間[：:]\s*(\d+:\d+[〜~]\d+:\d+)/);
    const classMatch = body.match(/プログラム[：:]\s*(.+)/);
    const gym       = gymMatch   ? gymMatch[1].trim()              : '';
    const time      = timeMatch  ? timeMatch[1].replace('~', '〜') : '';
    const className = classMatch ? classMatch[1].trim()            : '';
    if (gym || time || className) {
      results.push({ date: normalizeDate(dateMatch[1]), gym, time, className, requester, deputy: '', status: 'open', url });
    }
  }
}

function parseGeneric(text, url, requester, results) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let currentDate = '', currentGym = '', currentTime = '', currentClass = '';
  for (const line of lines) {
    const dateM = line.match(/(\d+月\d+日|\d+\/\d+)/);
    if (dateM && line.length < 30) {
      if (currentDate && (currentGym || currentTime)) {
        results.push({ date: currentDate, gym: currentGym, time: currentTime, className: currentClass, requester, deputy: '', status: 'open', url });
      }
      currentDate = normalizeDate(dateM[1]);
      currentGym = ''; currentTime = ''; currentClass = '';
      continue;
    }
    const timeM = line.match(/(\d+:\d+)[〜~](\d+:\d+)/);
    if (timeM) currentTime = `${timeM[1]}〜${timeM[2]}`;
    if (!line.startsWith('http') && line.length < 25 && !timeM && currentDate && !currentGym) {
      currentGym = line;
    }
  }
  if (currentDate && (currentGym || currentTime)) {
    results.push({ date: currentDate, gym: currentGym, time: currentTime, className: currentClass, requester, deputy: '', status: 'open', url });
  }
}

function normalizeDate(str) {
  const jpMatch = str.match(/(\d+)月(\d+)日/);
  if (jpMatch) {
    const year = guessYear(parseInt(jpMatch[1]));
    return `${year}/${String(jpMatch[1]).padStart(2,'0')}/${String(jpMatch[2]).padStart(2,'0')}`;
  }
  const slashMatch = str.match(/(\d+)\/(\d+)/);
  if (slashMatch) {
    const year = guessYear(parseInt(slashMatch[1]));
    return `${year}/${String(slashMatch[1]).padStart(2,'0')}/${String(slashMatch[2]).padStart(2,'0')}`;
  }
  return str;
}

function guessYear(month) {
  const n = new Date();
  return month < n.getMonth() ? n.getFullYear() + 1 : n.getFullYear();
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ===== プレビュー =====
function showPreview(parsed) {
  const list = document.getElementById('preview-list');
  list.innerHTML = '';
  parsed.forEach((entry, i) => {
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.dataset.index = i;
    card.innerHTML = `
      <div><label>日付</label><input type="text" name="date" value="${esc(entry.date)}" placeholder="例: 2026/05/17"></div>
      <div><label>ジム名</label><input type="text" name="gym" value="${esc(entry.gym)}" placeholder="例: エスフォルタ八王子"></div>
      <div><label>時間</label><input type="text" name="time" value="${esc(entry.time)}" placeholder="例: 9:45〜10:45"></div>
      <div><label>クラス名</label><input type="text" name="className" value="${esc(entry.className)}" placeholder="例: マーシャルワークアウト"></div>
      <div><label>依頼者</label><input type="text" name="requester" value="${esc(entry.requester)}" placeholder="依頼者名"></div>
      <div><label>代行者</label><input type="text" name="deputy" value="${esc(entry.deputy)}" placeholder="代行者名"></div>
      <div class="field-url"><label>調整さんURL</label><input type="text" name="url" value="${esc(entry.url)}" placeholder="https://chouseisan.com/..."></div>
    `;
    list.appendChild(card);
  });
  document.getElementById('preview-section').classList.remove('hidden');
}

function collectPreviewData() {
  return [...document.querySelectorAll('.preview-card')].map(card => ({
    id: generateId(),
    date:      card.querySelector('[name="date"]').value.trim(),
    gym:       card.querySelector('[name="gym"]').value.trim(),
    time:      card.querySelector('[name="time"]').value.trim(),
    className: card.querySelector('[name="className"]').value.trim(),
    requester: card.querySelector('[name="requester"]').value.trim(),
    deputy:    card.querySelector('[name="deputy"]').value.trim(),
    status:    card.querySelector('[name="deputy"]').value.trim() ? 'done' : 'open',
    url:       card.querySelector('[name="url"]').value.trim(),
  }));
}

// ===== テーブル =====
function getTodayKey() {
  return dateToKey(new Date());
}

function getSortedEntries() {
  const entries = loadEntries();
  const filterOpen   = document.getElementById('filter-open').checked;
  const filterFuture = document.getElementById('filter-future').checked;
  const todayKey = getTodayKey();
  const filtered = entries.filter(e => {
    if (filterOpen   && e.status !== 'open') return false;
    if (filterFuture && e.date < todayKey)   return false;
    return true;
  });
  const { col, dir } = sortState;
  filtered.sort((a, b) => {
    const av = (a[col] || '').toLowerCase();
    const bv = (b[col] || '').toLowerCase();
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ?  1 : -1;
    return 0;
  });
  return filtered;
}

function renderTable() {
  const filtered = getSortedEntries();
  const tbody    = document.getElementById('entries-body');
  const emptyMsg = document.getElementById('empty-msg');

  document.querySelectorAll('#entries-table .sort-icon').forEach(el => { el.className = 'sort-icon'; });
  const activeIcon = document.querySelector(`#entries-table th[data-col="${sortState.col}"] .sort-icon`);
  if (activeIcon) activeIcon.className = `sort-icon ${sortState.dir}`;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');
  tbody.innerHTML = filtered.map(entry => `
    <tr data-id="${entry.id}">
      <td>${esc(entry.date)}</td>
      <td>${esc(entry.gym)}</td>
      <td style="white-space:nowrap">${esc(entry.time)}</td>
      <td>${esc(entry.className)}</td>
      <td><input type="text" value="${esc(entry.requester)}" data-field="requester" data-id="${entry.id}" style="min-width:70px"></td>
      <td><input type="text" value="${esc(entry.deputy)}"    data-field="deputy"    data-id="${entry.id}" style="min-width:70px"></td>
      <td>
        <span class="status-badge ${entry.status === 'open' ? 'status-open' : 'status-done'}"
              data-id="${entry.id}" data-action="toggle-status">
          <span class="material-icons-round">${entry.status === 'open' ? 'pending' : 'check_circle'}</span>
          ${entry.status === 'open' ? '未決' : '対応済み'}
        </span>
      </td>
      <td>${entry.url ? `<a href="${esc(entry.url)}" target="_blank" rel="noopener">調整さん</a>` : ''}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-danger" data-action="delete" data-id="${entry.id}">
            <span class="material-icons-round">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

document.querySelector('#entries-table thead').addEventListener('click', e => {
  const th = e.target.closest('th.sortable');
  if (!th) return;
  const col = th.dataset.col;
  sortState = { col, dir: sortState.col === col && sortState.dir === 'asc' ? 'desc' : 'asc' };
  renderTable();
});

document.getElementById('entries-body').addEventListener('click', e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  const id     = e.target.closest('[data-id]')?.dataset.id;
  if (!action || !id) return;
  if (action === 'delete') {
    if (!confirm('この依頼を削除しますか？')) return;
    saveEntries(loadEntries().filter(en => en.id !== id));
    renderTable(); renderCalendars();
  }
  if (action === 'toggle-status') {
    const entries = loadEntries();
    const entry = entries.find(en => en.id === id);
    if (entry) {
      entry.status = entry.status === 'open' ? 'done' : 'open';
      saveEntries(entries);
      renderTable(); renderCalendars();
    }
  }
});

document.getElementById('entries-body').addEventListener('change', e => {
  const field = e.target.dataset.field;
  const id    = e.target.dataset.id;
  if (!field || !id) return;
  const entries = loadEntries();
  const entry   = entries.find(en => en.id === id);
  if (!entry) return;
  entry[field] = e.target.value.trim();
  if (field === 'deputy') entry.status = entry.deputy ? 'done' : 'open';
  saveEntries(entries);
  renderTable(); renderCalendars();
});

// ===== JSON エクスポート =====
document.getElementById('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(loadEntries(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `braft_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ===== CSV / TSV エクスポート =====
const EXPORT_HEADERS = ['日付','ジム名','時間','クラス名','依頼者','代行者','ステータス','URL'];
const EXPORT_FIELDS  = ['date','gym','time','className','requester','deputy','status','url'];

function statusLabel(s) { return s === 'open' ? '未決' : '対応済み'; }

function toCSV(entries) {
  const escape = v => {
    const s = String(v ?? '');
    // カンマ・ダブルクォート・改行を含む場合はクォートで囲む
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    EXPORT_HEADERS.map(escape).join(','),
    ...entries.map(e =>
      EXPORT_FIELDS.map(f => escape(f === 'status' ? statusLabel(e[f]) : (e[f] ?? ''))).join(',')
    )
  ];
  // Excel用 UTF-8 BOM付き
  return '\uFEFF' + rows.join('\r\n');
}

function toTSV(entries) {
  const escape = v => String(v ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  const rows = [
    EXPORT_HEADERS.map(escape).join('\t'),
    ...entries.map(e =>
      EXPORT_FIELDS.map(f => escape(f === 'status' ? statusLabel(e[f]) : (e[f] ?? ''))).join('\t')
    )
  ];
  return '\uFEFF' + rows.join('\r\n');
}

function downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function dateSuffix() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

document.getElementById('export-csv-btn').addEventListener('click', () => {
  downloadText(toCSV(loadEntries()), `braft_${dateSuffix()}.csv`, 'text/csv;charset=utf-8;');
});

document.getElementById('export-tsv-btn').addEventListener('click', () => {
  downloadText(toTSV(loadEntries()), `braft_${dateSuffix()}.tsv`, 'text/tab-separated-values;charset=utf-8;');
});

// ===== JSON インポート =====
document.getElementById('import-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error();
      const existing    = loadEntries();
      const existingIds = new Set(existing.map(en => en.id));
      const toAdd = imported
        .map(en => ({ ...en, id: en.id || generateId() }))
        .filter(en => !existingIds.has(en.id));
      saveEntries([...existing, ...toAdd]);
      renderTable(); renderCalendars();
      alert(`${toAdd.length}件インポートしました。`);
    } catch { alert('JSONの読み込みに失敗しました。'); }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// ===== 解析ボタン =====
document.getElementById('parse-btn').addEventListener('click', () => {
  const text = document.getElementById('input-text').value.trim();
  if (!text) { alert('テキストを貼り付けてください。'); return; }
  const parsed = parseText(text);
  document.getElementById('preview-section').classList.add('hidden');
  if (parsed.length === 0) {
    showFallback();
  } else {
    showPreview(parsed);
    document.getElementById('fallback-section').classList.add('hidden');
  }
});

// ===== AIフォールバック =====
function showFallback() {
  document.getElementById('copy-feedback').classList.add('hidden');
  document.getElementById('fallback-section').classList.remove('hidden');
  document.getElementById('fallback-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById('show-ai-btn').addEventListener('click', showFallback);
document.getElementById('hide-ai-btn').addEventListener('click', () => {
  document.getElementById('fallback-section').classList.add('hidden');
});

document.getElementById('copy-prompt-btn').addEventListener('click', () => {
  const text = document.getElementById('input-text').value.trim();
  const prompt = `以下のテキストから代行依頼情報を抽出し、JSON形式で出力してください。

抽出する項目：
- date（日付、例: 2026/05/17）
- gym（ジム名・施設名）
- time（時間帯、例: 9:45〜10:45）
- className（クラス・プログラム名）
- requester（依頼者名、不明なら空文字）
- url（調整さんなどのURL、なければ空文字）

複数の依頼がある場合は配列で返してください。

---
${text}
---`;

  const feedback = document.getElementById('copy-feedback');
  const doCopy = () => feedback.classList.remove('hidden');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(prompt).then(doCopy).catch(() => { legacyCopy(prompt); doCopy(); });
  } else {
    legacyCopy(prompt); doCopy();
  }
});

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

// ===== 登録ボタン =====
document.getElementById('register-btn').addEventListener('click', () => {
  const newEntries = collectPreviewData();
  saveEntries([...loadEntries(), ...newEntries]);
  document.getElementById('input-text').value = '';
  document.getElementById('preview-section').classList.add('hidden');
  document.getElementById('preview-list').innerHTML = '';
  renderTable(); renderCalendars();
  document.getElementById('view-section').scrollIntoView({ behavior: 'smooth' });
});

// ===== フィルター =====
document.getElementById('filter-open').addEventListener('change', () => { renderTable(); renderCalendars(); });
document.getElementById('filter-future').addEventListener('change', () => { renderTable(); renderCalendars(); });

// ===== タブ切替 =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

// ===== ツールチップ =====
const tooltip = document.getElementById('tooltip');

function showTooltip(el, entry) {
  const holiday = getHolidayName(entry.date);
  tooltip.innerHTML = `
    <strong>${esc(entry.gym) || '（ジム名なし）'}</strong><br>
    📅 ${esc(entry.date)}${holiday ? ` <em>（${esc(holiday)}）</em>` : ''}<br>
    🕐 ${esc(entry.time)}<br>
    🥊 ${esc(entry.className) || '-'}<br>
    依頼者: ${esc(entry.requester) || '-'}<br>
    代行者: ${esc(entry.deputy)    || '-'}<br>
    ${entry.status === 'open' ? '⚠️ 未決' : '✅ 対応済み'}
  `;
  tooltip.classList.remove('hidden');
  const rect = el.getBoundingClientRect();
  let top  = rect.bottom + 6;
  let left = rect.left;
  if (left + 260 > window.innerWidth)  left = window.innerWidth - 265;
  if (top  + 170 > window.innerHeight) top  = rect.top - 174;
  tooltip.style.top  = top  + 'px';
  tooltip.style.left = left + 'px';
}

function hideTooltip() { tooltip.classList.add('hidden'); }

// ===== カレンダー共通 =====
function dateToKey(date) {
  return `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`;
}

function entriesByDate() {
  const filterFuture = document.getElementById('filter-future').checked;
  const todayKey = getTodayKey();
  const map = {};
  for (const entry of loadEntries()) {
    if (filterFuture && entry.date < todayKey) continue;
    if (!map[entry.date]) map[entry.date] = [];
    map[entry.date].push(entry);
  }
  return map;
}

function makeChip(entry) {
  const div = document.createElement('div');
  div.className = `cal-entry ${entry.status === 'open' ? 'entry-open' : 'entry-done'}`;
  const deputyPart = entry.deputy ? ` ✅ ${entry.deputy}` : '';
  div.textContent = `${entry.gym} ${entry.time}${deputyPart}`;
  div.addEventListener('mouseenter', () => showTooltip(div, entry));
  div.addEventListener('mouseleave', hideTooltip);
  return div;
}

// 時間帯判定
function getTimeGroup(time) {
  if (!time) return null;
  const m = time.match(/^(\d+):/);
  if (!m) return null;
  const h = parseInt(m[1]);
  if (h < 12) return 'morning';
  if (h < 19) return 'daytime';
  return 'evening';
}

// ===== 月カレンダー =====
// 月カレンダーは日曜始まり（一般的なカレンダー表示）
function renderMonthCalendar() {
  const { year, month } = calMonth;
  document.getElementById('month-label').textContent = `${year}年${month+1}月`;

  const byDate    = entriesByDate();
  const container = document.getElementById('month-calendar');
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'month-grid';

  [['日','sun'],['月',''],['火',''],['水',''],['木',''],['金',''],['土','sat']].forEach(([d, cls]) => {
    const el = document.createElement('div');
    el.className = `month-dow${cls ? ' '+cls : ''}`;
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const todayKey = dateToKey(new Date());

  for (let i = 0; i < firstDay.getDay(); i++) {
    grid.appendChild(makeMonthCell(new Date(year, month, i - firstDay.getDay() + 1), byDate, true, todayKey));
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    grid.appendChild(makeMonthCell(new Date(year, month, d), byDate, false, todayKey));
  }
  const totalDataCells = firstDay.getDay() + lastDay.getDate();
  const remaining = (7 - (totalDataCells % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    grid.appendChild(makeMonthCell(new Date(year, month + 1, d), byDate, true, todayKey));
  }
  container.appendChild(grid);
}

function makeMonthCell(date, byDate, otherMonth, todayKey) {
  const key  = dateToKey(date);
  const dow  = date.getDay();
  const holiday = getHolidayName(key);
  const cell = document.createElement('div');
  cell.className = `month-cell${otherMonth ? ' other-month' : ''}${key === todayKey ? ' today' : ''}`;

  const numEl = document.createElement('div');
  numEl.className = `month-day-num${holiday ? ' holiday' : dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}`;

  const numSpan = document.createElement('span');
  if (key === todayKey) numSpan.className = 'today-num';
  numSpan.textContent = date.getDate();
  numEl.appendChild(numSpan);

  if (holiday) {
    const hLabel = document.createElement('span');
    hLabel.className = 'holiday-label';
    hLabel.textContent = holiday;
    numEl.appendChild(hLabel);
  }

  cell.appendChild(numEl);
  (byDate[key] || []).forEach(entry => cell.appendChild(makeChip(entry)));
  return cell;
}

document.getElementById('month-prev').addEventListener('click', () => {
  calMonth.month--;
  if (calMonth.month < 0) { calMonth.month = 11; calMonth.year--; }
  renderMonthCalendar();
});
document.getElementById('month-next').addEventListener('click', () => {
  calMonth.month++;
  if (calMonth.month > 11) { calMonth.month = 0; calMonth.year++; }
  renderMonthCalendar();
});

// ===== 週カレンダー（月曜始まり） =====
function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // 月曜日に合わせる
  d.setDate(d.getDate() + diff);
  return d;
}

function renderWeekCalendar() {
  const weekEnd = new Date(calWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
  document.getElementById('week-label').textContent = `${fmt(calWeekStart)}（月）〜 ${fmt(weekEnd)}（日）`;

  const byDate   = entriesByDate();
  const todayKey = dateToKey(new Date());
  const container = document.getElementById('week-calendar');
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'week-grid';

  // 月〜日の順
  const dowLabels = ['月','火','水','木','金','土','日'];
  const dowDays   = [1, 2, 3, 4, 5, 6, 0]; // getDay()対応

  for (let i = 0; i < 7; i++) {
    const date    = new Date(calWeekStart);
    date.setDate(date.getDate() + i);
    const key     = dateToKey(date);
    const dow     = date.getDay(); // 0=Sun, 6=Sat
    const isToday   = key === todayKey;
    const holiday   = getHolidayName(key);
    const isSat     = dow === 6;
    const isSun     = dow === 0;

    const col = document.createElement('div');
    col.className = 'week-col';

    // ヘッダー
    const header = document.createElement('div');
    let headerCls = 'week-col-header';
    if (holiday)    headerCls += ' header-holiday';
    else if (isSun) headerCls += ' header-sun';
    else if (isSat) headerCls += ' header-sat';
    if (isToday)    headerCls += ' today-col';
    header.className = headerCls;
    header.innerHTML = `
      <span class="week-dow">${dowLabels[i]}</span>
      <span class="week-date">${date.getMonth()+1}/${date.getDate()}</span>
      ${holiday ? `<span class="week-holiday">${esc(holiday)}</span>` : ''}
    `;
    col.appendChild(header);

    // 時間帯グループ
    const dayEntries = byDate[key] || [];
    const groups = [
      { key: 'morning',  label: '午前',  entries: [] },
      { key: 'daytime',  label: '昼間',  entries: [] },
      { key: 'evening',  label: '夜間',  entries: [] },
      { key: 'none',     label: '',      entries: [] },
    ];
    dayEntries.forEach(entry => {
      const g = getTimeGroup(entry.time);
      const group = groups.find(gr => gr.key === (g || 'none'));
      group.entries.push(entry);
    });

    const body = document.createElement('div');
    body.className = 'week-col-body';

    groups.forEach(group => {
      if (group.entries.length === 0) return;
      if (group.label) {
        const label = document.createElement('div');
        label.className = 'week-time-label';
        label.textContent = group.label;
        body.appendChild(label);
      }
      group.entries.forEach(entry => body.appendChild(makeChip(entry)));
    });

    col.appendChild(body);
    grid.appendChild(col);
  }
  container.appendChild(grid);
}

document.getElementById('week-prev').addEventListener('click', () => {
  calWeekStart.setDate(calWeekStart.getDate() - 7);
  renderWeekCalendar();
});
document.getElementById('week-next').addEventListener('click', () => {
  calWeekStart.setDate(calWeekStart.getDate() + 7);
  renderWeekCalendar();
});

function renderCalendars() {
  renderMonthCalendar();
  renderWeekCalendar();
}

// ===== ユーティリティ =====
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== 印刷 =====
const printMenuBtn  = document.getElementById('print-menu-btn');
const printDropdown = document.getElementById('print-dropdown');

printMenuBtn.addEventListener('click', e => {
  e.stopPropagation();
  printDropdown.classList.toggle('hidden');
});

document.addEventListener('click', () => printDropdown.classList.add('hidden'));

document.querySelectorAll('.print-option').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    printDropdown.classList.add('hidden');
    printCalendar(btn.dataset.target);
  });
});

function printCalendar(target) {
  const listTab  = document.getElementById('tab-list');
  const monthTab = document.getElementById('tab-month');
  const weekTab  = document.getElementById('tab-week');

  if (target === 'list') {
    listTab.classList.remove('hidden');
    monthTab.classList.add('hidden');
    weekTab.classList.add('hidden');
    // 一覧は横向きA4
    const s = document.createElement('style');
    s.id = 'print-page-style';
    s.textContent = '@page { size: A4 landscape; margin: 1cm; }';
    document.head.appendChild(s);
    // ファイル名用にタイトルにタイムスタンプを付与
    const d = new Date();
    const ts = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
    document.title = `BRAFT代行一覧_${ts}`;
  } else {
    document.getElementById('print-page-style')?.remove();
    listTab.classList.add('hidden');
    if (target === 'month' || target === 'both') monthTab.classList.remove('hidden');
    if (target === 'week'  || target === 'both') weekTab.classList.remove('hidden');
    if (target === 'month') weekTab.classList.add('hidden');
    if (target === 'week')  monthTab.classList.add('hidden');
  }

  document.body.dataset.print = target;
  window.print();
}

window.addEventListener('afterprint', () => {
  delete document.body.dataset.print;
  document.getElementById('print-page-style')?.remove();
  document.title = 'BRAFT 代行情報整理';
  // 印刷後はタブ表示を元に戻す（アクティブタブのみ表示）
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  if (activeTab) document.getElementById(`tab-${activeTab}`)?.classList.remove('hidden');
});

// ===== 使い方ガイド =====
document.getElementById('help-btn').addEventListener('click', () => {
  const panel = document.getElementById('help-panel');
  const btn   = document.getElementById('help-btn');
  const isOpen = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isOpen);
  btn.classList.toggle('active', !isOpen);
  btn.setAttribute('aria-expanded', String(!isOpen));
});

// ===== QRコード生成（URL形式） =====
function buildShareUrl(entries) {
  const json = JSON.stringify(entries);
  const b64  = btoa(unescape(encodeURIComponent(json)));
  const base = location.href.split('#')[0];
  return base + '#share=' + b64;
}

document.getElementById('qr-btn').addEventListener('click', () => {
  const entries = loadEntries();
  const modal   = document.getElementById('qr-modal');
  const wrap    = document.getElementById('qr-canvas-wrap');
  const errEl   = document.getElementById('qr-error');

  wrap.innerHTML = '';
  errEl.classList.add('hidden');

  if (entries.length === 0) {
    errEl.textContent = '登録されたデータがありません。';
    errEl.classList.remove('hidden');
    modal.classList.remove('hidden');
    return;
  }

  // localhostの場合は案内を表示
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocalhost) {
    errEl.textContent = 'スマホからアクセスするには、PCのIPアドレスで開き直してください。（例：http://192.168.1.XX:5500/）';
    errEl.classList.remove('hidden');
    modal.classList.remove('hidden');
    return;
  }

  // QRCodeライブラリ未ロードチェック
  if (typeof QRCode === 'undefined') {
    errEl.textContent = 'QRコードライブラリの読み込みに失敗しました。インターネット接続を確認してください。';
    errEl.classList.remove('hidden');
    modal.classList.remove('hidden');
    return;
  }

  const shareUrl = buildShareUrl(entries);

  if (shareUrl.length > 2900) {
    errEl.textContent = `データが多すぎます（${entries.length}件）。「今日以降のみ」フィルターで件数を絞ってからお試しください。`;
    errEl.classList.remove('hidden');
    modal.classList.remove('hidden');
    return;
  }

  modal.classList.remove('hidden'); // 先にモーダルを開く

  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);

  QRCode.toCanvas(canvas, shareUrl, { width: 256, errorCorrectionLevel: 'L' }, err => {
    if (err) {
      wrap.innerHTML = '';
      errEl.textContent = 'QRコードの生成に失敗しました。';
      errEl.classList.remove('hidden');
    }
  });
});

// ===== 共有ビュー（#share= で開いた時） =====
function initShareView() {
  const hash = location.hash;
  if (!hash.startsWith('#share=')) return;

  const b64 = hash.slice('#share='.length);
  let entries;
  try {
    entries = JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch {
    return;
  }

  // 通常UIを非表示にして共有ビューを表示
  document.querySelector('header').classList.add('hidden');
  document.querySelector('main').classList.add('hidden');
  document.getElementById('share-view').classList.remove('hidden');

  const d = new Date();
  document.getElementById('share-view-date').textContent =
    `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} 時点`;

  const tbody = document.getElementById('share-table-body');
  const emptyMsg = document.getElementById('share-empty-msg');

  if (entries.length === 0) {
    emptyMsg.classList.remove('hidden');
    return;
  }

  tbody.innerHTML = entries.map(e => `
    <tr>
      <td style="white-space:nowrap">${esc(e.date)}</td>
      <td>${esc(e.gym)}</td>
      <td style="white-space:nowrap">${esc(e.time)}</td>
      <td>${esc(e.className)}</td>
      <td>${esc(e.requester)}</td>
      <td>${esc(e.deputy)}</td>
      <td style="white-space:nowrap">
        <span class="status-badge ${e.status === 'open' ? 'status-open' : 'status-done'}">
          <span class="material-icons-round">${e.status === 'open' ? 'pending' : 'check_circle'}</span>
          ${e.status === 'open' ? '未決' : '対応済み'}
        </span>
      </td>
      <td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">調整さん</a>` : ''}</td>
    </tr>
  `).join('');
}

document.getElementById('qr-close-btn').addEventListener('click', () => {
  document.getElementById('qr-modal').classList.add('hidden');
});

document.getElementById('qr-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('qr-modal')) {
    document.getElementById('qr-modal').classList.add('hidden');
  }
});

// ===== 初期描画 =====
initShareView(); // #share= ハッシュがあれば共有ビューを表示（なければ通常UI）
if (!location.hash.startsWith('#share=')) {
  renderTable();
  loadHolidays();
}
