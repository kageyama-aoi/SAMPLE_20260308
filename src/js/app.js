// ===== ストレージ =====
const STORAGE_KEY = 'braft_entries';

function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ===== 状態 =====
let sortState = { col: 'date', dir: 'asc' };
const now = new Date();
let calMonth = { year: now.getFullYear(), month: now.getMonth() };
let calWeekStart = getWeekStart(new Date());

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

  // 日付または（ジム名か時間）が取れていない結果は除外
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
        date: normalizeDate(m[1]),
        gym: m[2].trim(),
        time: m[3].replace('~', '〜'),
        className: m[4] ? m[4].trim() : '',
        requester, deputy: '', status: 'open', url
      });
    }
  }
}

function parseBullet(text, url, requester, results) {
  const datePattern = /(\d+月\d+日[（(]\S[)）]|\d+\/\d+[（(]\S[)）])/g;
  const blocks = [];
  let lastIndex = 0;
  let match;
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
    const gym       = gymMatch   ? gymMatch[1].trim()                    : '';
    const time      = timeMatch  ? timeMatch[1].replace('~', '〜')       : '';
    const className = classMatch ? classMatch[1].trim()                  : '';
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
function getSortedEntries() {
  const entries = loadEntries();
  const filterOpen = document.getElementById('filter-open').checked;
  const filtered = filterOpen ? entries.filter(e => e.status === 'open') : entries;
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

// ソートクリック
document.querySelector('#entries-table thead').addEventListener('click', e => {
  const th = e.target.closest('th.sortable');
  if (!th) return;
  const col = th.dataset.col;
  sortState = { col, dir: sortState.col === col && sortState.dir === 'asc' ? 'desc' : 'asc' };
  renderTable();
});

// テーブルイベント委譲
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

  const doCopy = () => { feedback.classList.remove('hidden'); };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(prompt).then(doCopy).catch(() => {
      legacyCopy(prompt); doCopy();
    });
  } else {
    legacyCopy(prompt); doCopy();
  }
});

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
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
document.getElementById('filter-open').addEventListener('change', renderTable);

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
  tooltip.innerHTML = `
    <strong>${esc(entry.gym) || '（ジム名なし）'}</strong><br>
    📅 ${esc(entry.date)}<br>
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
  if (left + 260 > window.innerWidth) left = window.innerWidth - 265;
  if (top  + 160 > window.innerHeight) top  = rect.top - 164;
  tooltip.style.top  = top  + 'px';
  tooltip.style.left = left + 'px';
}

function hideTooltip() { tooltip.classList.add('hidden'); }

// ===== カレンダー共通 =====
function dateToKey(date) {
  return `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`;
}

function entriesByDate() {
  const map = {};
  for (const entry of loadEntries()) {
    if (!map[entry.date]) map[entry.date] = [];
    map[entry.date].push(entry);
  }
  return map;
}

function makeChip(entry) {
  const div = document.createElement('div');
  div.className = `cal-entry ${entry.status === 'open' ? 'entry-open' : 'entry-done'}`;
  div.textContent = `${entry.gym} ${entry.time}`;
  div.addEventListener('mouseenter', () => showTooltip(div, entry));
  div.addEventListener('mouseleave', hideTooltip);
  return div;
}

// ===== 月カレンダー =====
function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function renderMonthCalendar() {
  const { year, month } = calMonth;
  document.getElementById('month-label').textContent = `${year}年${month+1}月`;

  const byDate   = entriesByDate();
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

  const firstDay  = new Date(year, month, 1);
  const lastDay   = new Date(year, month + 1, 0);
  const todayKey  = dateToKey(new Date());

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
  const cell = document.createElement('div');
  const key  = dateToKey(date);
  cell.className = `month-cell${otherMonth ? ' other-month' : ''}${key === todayKey ? ' today' : ''}`;

  const dow   = date.getDay();
  const numEl = document.createElement('div');
  numEl.className = `month-day-num${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}`;

  const numSpan = document.createElement('span');
  if (key === todayKey) numSpan.className = 'today-num';
  numSpan.textContent = date.getDate();
  numEl.appendChild(numSpan);
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

// ===== 週カレンダー =====
function renderWeekCalendar() {
  const weekEnd = new Date(calWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
  document.getElementById('week-label').textContent = `${fmt(calWeekStart)} 〜 ${fmt(weekEnd)}`;

  const byDate  = entriesByDate();
  const todayKey = dateToKey(new Date());
  const container = document.getElementById('week-calendar');
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'week-grid';

  const dows    = ['日','月','火','水','木','金','土'];
  const dowCls  = ['dow-sun','','','','','','dow-sat'];

  for (let i = 0; i < 7; i++) {
    const date = new Date(calWeekStart);
    date.setDate(date.getDate() + i);
    const key     = dateToKey(date);
    const isToday = key === todayKey;

    const col = document.createElement('div');
    col.className = 'week-col';

    const header = document.createElement('div');
    header.className = `week-col-header ${dowCls[i]}${isToday ? ' today-col' : ''}`;
    header.innerHTML = `<span class="week-dow">${dows[i]}</span><span class="week-date">${date.getMonth()+1}/${date.getDate()}</span>`;
    col.appendChild(header);

    const body = document.createElement('div');
    body.className = 'week-col-body';
    (byDate[key] || []).forEach(entry => body.appendChild(makeChip(entry)));
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

// ===== 初期描画 =====
renderTable();
renderCalendars();
