// ─────────────────────────────────────────────────────────────
// Tasks — Multi-board Kanban backed by db.js (localStorage + PHP).
// Exposed global: initTasks() — called by router.js section init pattern.
// All functions prefixed tk*
// ─────────────────────────────────────────────────────────────

const TK_COLORS = [
  null,
  '#3d7a3d', '#c9923a', '#d45c5c', '#5a8abf',
  '#8a6abf', '#bf6a8a', '#4a9a8a',
];

const TK_DEFAULT_COLUMNS = [
  { name: 'To Do',       color: '#3d7a3d', position: 0, project_id: null },
  { name: 'In Progress', color: '#c9923a', position: 1, project_id: null },
  { name: 'Done',        color: '#737373', position: 2, project_id: null },
];

// ── Module state ──────────────────────────────────────────────

let TK = {
  columns:       [],
  tasks:         [],
  projects:      [],
  filters:       { search: '', label: '', due: '' },
  openMenuColId: null,
  selectedIds:   new Set(),
  lastClickedId: null,
};

let TK_PANEL = {
  taskId:         null,
  colId:          null,
  boardProjectId: null,
  title:          '',
  description:    '',
  color:          null,
  labels:         [],
  dueDate:        '',
};

let TK_DRAG = { type: null, taskId: null, srcColId: null, colId: null };
let TK_MODAL_CB    = null;
let TK_TOAST_TIMER = null;

// ── Data ──────────────────────────────────────────────────────

function tkLoad() {
  try {
    const raw = localStorage.getItem('fcc_tasks');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && !Array.isArray(parsed) && parsed.tasks) {
        localStorage.setItem('fcc_tasks',        JSON.stringify(parsed.tasks   || []));
        localStorage.setItem('fcc_task_columns', JSON.stringify(parsed.columns || []));
        if ((parsed.projects || []).length > 0)
          localStorage.setItem('fcc_projects', JSON.stringify(parsed.projects));
      }
    }
  } catch(e) {}

  TK.columns  = DB.getAll('fcc_task_columns').sort((a, b) => a.position - b.position);
  TK.tasks    = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  TK.projects = DB.getAll('fcc_projects');
}

// ── Entry ─────────────────────────────────────────────────────

async function initTasks() {
  TK.filters       = { search: '', label: '', due: '' };
  TK.openMenuColId = null;
  TK.selectedIds   = new Set();
  TK.lastClickedId = null;
  TK_DRAG          = { type: null, taskId: null, srcColId: null, colId: null };
  tkCloseDetail(true);

  await DB.hydrate(['fcc_task_columns', 'fcc_tasks', 'fcc_projects']);
  tkLoad();

  const hasGeneralCols = TK.columns.some(c => (c.project_id || null) === null);
  if (!hasGeneralCols) {
    TK_DEFAULT_COLUMNS.forEach(col => DB.insert('fcc_task_columns', col));
    tkLoad();

    if (TK.tasks.length === 0) {
      const colTodo = TK.columns.find(c => c.name === 'To Do'       && (c.project_id || null) === null);
      const colProg = TK.columns.find(c => c.name === 'In Progress' && (c.project_id || null) === null);
      const colDone = TK.columns.find(c => c.name === 'Done'        && (c.project_id || null) === null);
      const addDays = d => { const dt = new Date(); dt.setDate(dt.getDate() + d); return dt.toISOString().slice(0, 10); };
      [
        { title: 'Edit wedding highlight reel',       description: 'Deliver 3–5 min edit. Client wants upbeat music.', column_id: colProg?.id, color: '#5a8abf', labels: ['Video'],         due_date: addDays(3), project_id: null, position: 0 },
        { title: 'Send invoice — Chen shoot',         description: null,                                               column_id: colTodo?.id, color: '#c9923a', labels: ['Admin'],         due_date: addDays(1), project_id: null, position: 0 },
        { title: 'Back up drone footage',             description: null,                                               column_id: colTodo?.id, color: null,      labels: [],                due_date: null,       project_id: null, position: 1 },
        { title: 'Cull + colour grade product shoot', description: '~400 selects, deliver 80 finals.',                column_id: colTodo?.id, color: '#8a6abf', labels: ['Photo'],         due_date: addDays(5), project_id: null, position: 2 },
        { title: 'Update portfolio website',          description: 'Add 2026 projects to the gallery page.',          column_id: colTodo?.id, color: null,      labels: ['Admin'],         due_date: null,       project_id: null, position: 3 },
        { title: 'Export social cuts — café promo',   description: 'Square + 9:16 versions for IG and Stories.',      column_id: colProg?.id, color: '#4a9a8a', labels: ['Video','Edit'],  due_date: addDays(2), project_id: null, position: 1 },
        { title: 'Deliver family portraits',          description: null,                                               column_id: colDone?.id, color: '#5a9c5a', labels: ['Photo'],         due_date: null,       project_id: null, position: 0 },
        { title: 'Submit broadcast package',          description: null,                                               column_id: colDone?.id, color: null,      labels: [],                due_date: null,       project_id: null, position: 1 },
      ].forEach(task => DB.insert('fcc_tasks', task));
      tkLoad();
    }
  }

  const loading   = document.getElementById('tk-loading');
  const container = document.getElementById('tk-boards-container');
  if (loading)   loading.style.display   = 'none';
  if (container) container.style.display = 'block';

  tkRefreshLabelFilter();
  tkRenderAllBoards();
  tkBindFilterBar();
  tkBindDocEvents();

  if (window.__openTaskId) {
    const taskId = window.__openTaskId;
    window.__openTaskId = null;
    const task = TK.tasks.find(t => t.id === taskId);
    tkOpenDetail(taskId, task?.column_id || null);
  }
}

// ── Project board ordering ─────────────────────────────────────

function tkGetProjectOrder() {
  return [...TK.projects].sort((a, b) => {
    const posA = a.board_position ?? 0;
    const posB = b.board_position ?? 0;
    if (posA !== posB) return posA - posB;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
}

function tkMoveProjectBoard(id, direction) {
  const ordered = tkGetProjectOrder();
  const idx     = ordered.findIndex(p => p.id === id);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= ordered.length) return;

  ordered.forEach((p, i) => { p._newPos = i * 10; });
  const tmp = ordered[idx]._newPos;
  ordered[idx]._newPos    = ordered[swapIdx]._newPos;
  ordered[swapIdx]._newPos = tmp;

  ordered.forEach(p => DB.update('fcc_projects', p.id, { board_position: p._newPos }));
  tkLoad();
  tkRenderAllBoards();
}

// ── All boards render ──────────────────────────────────────────

function tkRenderAllBoards() {
  const container = document.getElementById('tk-boards-container');
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(tkBuildBoardSection(null, null));
  tkGetProjectOrder().filter(p => !p.archived).forEach(proj => container.appendChild(tkBuildBoardSection(proj.id, proj)));
}

const TK_BOARD_TINTS = [
  '#3d7a3d', '#5a8abf', '#bf6a8a', '#8a6abf', '#c9923a', '#4a9a8a', '#d45c5c', '#bf8a3d',
];

function tkBuildBoardSection(boardProjectId, project) {
  const boardId = boardProjectId || 'general';

  const section = document.createElement('div');
  section.className = 'tk-board-section';
  section.id        = `tk-board-section-${boardId}`;

  // Assign a stable topo tint colour per board for visual distinction
  if (project) {
    const idx = TK.projects.findIndex(p => p.id === project.id);
    section.style.setProperty('--board-tint', TK_BOARD_TINTS[idx % TK_BOARD_TINTS.length]);
  } else {
    section.style.setProperty('--board-tint', TK_BOARD_TINTS[0]);
  }

  // Header
  const header = document.createElement('div');
  header.className = 'tk-board-section-header';

  const titleEl = document.createElement('span');
  titleEl.className   = 'tk-board-section-title';
  titleEl.textContent = project ? project.title : 'General';
  header.appendChild(titleEl);

  if (project) {
    const ordered = tkGetProjectOrder();
    const idx     = ordered.findIndex(p => p.id === project.id);

    const upBtn = document.createElement('button');
    upBtn.className   = 'tk-order-btn';
    upBtn.title       = 'Move up';
    upBtn.textContent = '↑';
    if (idx === 0) upBtn.disabled = true;
    upBtn.addEventListener('click', () => tkMoveProjectBoard(project.id, 'up'));

    const downBtn = document.createElement('button');
    downBtn.className   = 'tk-order-btn';
    downBtn.title       = 'Move down';
    downBtn.textContent = '↓';
    if (idx === ordered.length - 1) downBtn.disabled = true;
    downBtn.addEventListener('click', () => tkMoveProjectBoard(project.id, 'down'));

    const linkBtn = document.createElement('button');
    linkBtn.className   = 'tk-board-proj-link';
    linkBtn.textContent = 'Open project →';
    linkBtn.addEventListener('click', () => {
      window.__openProjectId = project.id;
      navigate('projects');
    });

    // All controls sit inline beside the title, flush left
    header.appendChild(upBtn);
    header.appendChild(downBtn);
    header.appendChild(linkBtn);
  }

  // Board row (horizontal kanban)
  const boardRow = document.createElement('div');
  boardRow.className = 'tk-board';
  boardRow.id        = `tk-board-${boardId}`;

  const cols = TK.columns
    .filter(c => (c.project_id || null) === boardProjectId)
    .sort((a, b) => a.position - b.position);

  cols.forEach(col => boardRow.appendChild(tkBuildColumn(col, boardProjectId)));

  const addBtn = document.createElement('button');
  addBtn.className = 'tk-add-col-btn';
  addBtn.id        = `tk-add-col-btn-${boardId}`;
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add column`;
  addBtn.addEventListener('click', () => tkShowAddColForm(boardProjectId));
  boardRow.appendChild(addBtn);

  section.appendChild(header);
  section.appendChild(boardRow);
  return section;
}

function tkBuildColumn(col, boardProjectId) {
  const visibleTasks = tkGetFilteredTasks(col.id);

  const wrap = document.createElement('div');
  wrap.className     = 'tk-column';
  wrap.dataset.colId = col.id;

  wrap.innerHTML = `
    <div class="tk-col-header" draggable="true">
      <div class="tk-col-dot" style="background:${esc(col.color || '#737373')}"></div>
      <span class="tk-col-name" id="tk-col-name-${col.id}">${esc(col.name)}</span>
      <span class="tk-col-count" id="tk-col-count-${col.id}">${visibleTasks.length}</span>
      <div class="tk-col-menu-wrap">
        <button class="tk-col-menu-btn" onclick="tkToggleColMenu('${col.id}')" aria-label="Column options">⋯</button>
        <div class="tk-col-menu" id="tk-col-menu-${col.id}">
          <button class="tk-col-menu-item" onclick="tkRenameCol('${col.id}')">Rename</button>
          <button class="tk-col-menu-item" onclick="tkRecolorColOpen('${col.id}')">Change colour</button>
          <div class="tk-col-swatches" id="tk-col-swatches-${col.id}" style="display:none">
            ${TK_COLORS.filter(c => c !== null).map(c =>
              `<button class="tk-swatch" style="background:${c};${col.color===c?'border-color:#fff;transform:scale(1.1)':''}"
                onclick="tkRecolorCol('${col.id}','${c}')"></button>`
            ).join('')}
          </div>
          <button class="tk-col-menu-item danger" onclick="tkDeleteCol('${col.id}')">Delete</button>
        </div>
      </div>
    </div>
    <div class="tk-col-body" id="tk-col-body-${col.id}"></div>
    <button class="tk-add-task-btn" onclick="tkOpenDetail(null,'${col.id}')">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      Add task
    </button>
  `;

  const body = wrap.querySelector('.tk-col-body');
  visibleTasks.forEach(task => body.appendChild(tkBuildCard(task)));

  const header = wrap.querySelector('.tk-col-header');
  header.addEventListener('dragstart', e => tkColDragStart(e, col.id));
  header.addEventListener('dragend',   () => tkColDragEnd());

  body.addEventListener('dragover',  e => tkCardDragOver(e, col.id));
  body.addEventListener('dragleave', e => tkCardDragLeave(e));
  body.addEventListener('drop',      e => tkCardDrop(e, col.id));

  wrap.addEventListener('dragover', e => tkColDragOver(e, col.id));
  wrap.addEventListener('drop',     e => tkColDrop(e, col.id));

  return wrap;
}

function tkRenderColumn(colId) {
  const col  = TK.columns.find(c => c.id === colId);
  if (!col) return;
  const body  = document.getElementById(`tk-col-body-${colId}`);
  const count = document.getElementById(`tk-col-count-${colId}`);
  if (!body) return;
  const visible = tkGetFilteredTasks(colId);
  body.innerHTML = '';
  visible.forEach(task => body.appendChild(tkBuildCard(task)));
  if (count) count.textContent = visible.length;
}

// ── Card ──────────────────────────────────────────────────────

function tkBuildCard(task) {
  const card = document.createElement('div');
  card.className      = 'tk-card';
  card.dataset.taskId = task.id;
  card.draggable      = true;

  if (TK.selectedIds.has(task.id)) card.classList.add('selected');
  card.style.borderLeftColor = task.color || 'var(--border-light)';

  const labels = (task.labels || []).slice(0, 3);
  const due    = task.due_date ? tkFormatDue(task.due_date) : null;

  card.innerHTML = `
    <div class="tk-card-title">${esc(task.title || 'Untitled')}</div>
    ${labels.length ? `
      <div class="tk-card-chips">
        ${labels.map(l => `<span class="tk-card-label">${esc(l)}</span>`).join('')}
      </div>` : ''}
    ${due ? `
      <div class="tk-card-meta">
        <span class="tk-card-due ${due.cls}">${due.text}</span>
      </div>` : ''}
  `;

  card.addEventListener('click',     e  => tkCardClick(e, task.id, task.column_id));
  card.addEventListener('dragstart', e  => tkCardDragStart(e, task.id, task.column_id));
  card.addEventListener('dragend',   () => tkCardDragEnd());

  return card;
}

// ── Multi-select ──────────────────────────────────────────────

function tkCardClick(e, taskId, colId) {
  if (e.shiftKey) {
    e.preventDefault();
    tkShiftSelect(taskId);
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    tkToggleSelect(taskId);
    return;
  }
  if (TK.selectedIds.size > 0) tkClearSelection();
  tkOpenDetail(taskId, colId);
}

function tkToggleSelect(taskId) {
  if (TK.selectedIds.has(taskId)) {
    TK.selectedIds.delete(taskId);
  } else {
    TK.selectedIds.add(taskId);
    TK.lastClickedId = taskId;
  }
  const card = document.querySelector(`.tk-card[data-task-id="${taskId}"]`);
  if (card) card.classList.toggle('selected', TK.selectedIds.has(taskId));
  tkUpdateBulkBar();
}

function tkShiftSelect(taskId) {
  if (!TK.lastClickedId) { tkToggleSelect(taskId); return; }
  const allCards = [...document.querySelectorAll('.tk-card[data-task-id]')];
  const allIds   = allCards.map(c => c.dataset.taskId);
  const startIdx = allIds.indexOf(TK.lastClickedId);
  const endIdx   = allIds.indexOf(taskId);
  if (startIdx === -1 || endIdx === -1) { tkToggleSelect(taskId); return; }
  const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
  for (let i = lo; i <= hi; i++) TK.selectedIds.add(allIds[i]);
  allCards.forEach(c => c.classList.toggle('selected', TK.selectedIds.has(c.dataset.taskId)));
  tkUpdateBulkBar();
}

function tkClearSelection() {
  TK.selectedIds.clear();
  TK.lastClickedId = null;
  document.querySelectorAll('.tk-card.selected').forEach(c => c.classList.remove('selected'));
  tkUpdateBulkBar();
}

function tkUpdateBulkBar() {
  const bar     = document.getElementById('tk-bulk-bar');
  const countEl = document.getElementById('tk-bulk-count');
  if (!bar) return;

  if (TK.selectedIds.size === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  if (countEl) countEl.textContent = `${TK.selectedIds.size} selected`;

  const boardSel = document.getElementById('tk-bulk-board');
  if (boardSel) {
    const cur = boardSel.value;
    boardSel.innerHTML = '<option value="">Assign to board…</option><option value="__general__">General</option>' +
      tkGetProjectOrder().map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
    if (cur) boardSel.value = cur;
  }
}

function tkBulkUpdateColOptions() {
  const boardSel = document.getElementById('tk-bulk-board');
  const colSel   = document.getElementById('tk-bulk-col');
  if (!boardSel || !colSel) return;
  const boardVal = boardSel.value;
  if (!boardVal) { colSel.innerHTML = '<option value="">Move to column…</option>'; return; }
  const projId = boardVal === '__general__' ? null : boardVal;
  const cols   = TK.columns.filter(c => (c.project_id || null) === projId).sort((a,b) => a.position - b.position);
  colSel.innerHTML = '<option value="">Move to column…</option>' +
    cols.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (cols.length) colSel.value = cols[0].id;
}

function tkBulkApply() {
  const boardSel = document.getElementById('tk-bulk-board');
  const colSel   = document.getElementById('tk-bulk-col');
  if (!boardSel || !colSel) return;
  const boardVal = boardSel.value;
  const colId    = colSel.value;
  if (!boardVal || !colId) { tkToast('Select a board and column first.'); return; }
  const newProjectId = boardVal === '__general__' ? null : boardVal;
  const count = TK.selectedIds.size;
  TK.selectedIds.forEach(taskId => {
    DB.update('fcc_tasks', taskId, { project_id: newProjectId, column_id: colId });
  });
  TK.tasks = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  tkClearSelection();
  tkRenderAllBoards();
  tkToast(`${count} task${count !== 1 ? 's' : ''} moved.`);
}

function tkBulkDelete() {
  const count = TK.selectedIds.size;
  if (!count) return;
  tkShowModal('Delete tasks?', `Permanently delete ${count} task${count !== 1 ? 's' : ''}?`, () => {
    TK.selectedIds.forEach(taskId => DB.delete('fcc_tasks', taskId));
    TK.tasks = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    tkClearSelection();
    tkRenderAllBoards();
    tkRefreshLabelFilter();
    tkToast(`${count} task${count !== 1 ? 's' : ''} deleted.`);
  });
}

// ── Filters ───────────────────────────────────────────────────

function tkGetFilteredTasks(colId) {
  let tasks = TK.tasks.filter(t => t.column_id === colId);
  const f   = TK.filters;
  if (f.search) {
    const q = f.search.toLowerCase();
    tasks = tasks.filter(t => (t.title || '').toLowerCase().includes(q));
  }
  if (f.label) {
    tasks = tasks.filter(t => (t.labels || []).includes(f.label));
  }
  if (f.due === 'overdue') {
    const today = todayIso();
    tasks = tasks.filter(t => t.due_date && t.due_date < today);
  } else if (f.due === 'this-week') {
    const todayStr   = todayIso();
    const weekEndStr = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
    tasks = tasks.filter(t => t.due_date && t.due_date >= todayStr && t.due_date <= weekEndStr);
  } else if (f.due === 'no-date') {
    tasks = tasks.filter(t => !t.due_date);
  }
  return tasks.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
}

function tkBindFilterBar() {
  const search   = document.getElementById('tk-search');
  const labelSel = document.getElementById('tk-filter-label');
  const dueSel   = document.getElementById('tk-filter-due');
  if (search)   search.addEventListener('input',   () => { TK.filters.search = search.value;   tkReRenderAllColumns(); });
  if (labelSel) labelSel.addEventListener('change',() => { TK.filters.label  = labelSel.value; tkReRenderAllColumns(); });
  if (dueSel)   dueSel.addEventListener('change',  () => { TK.filters.due    = dueSel.value;   tkReRenderAllColumns(); });
}

function tkReRenderAllColumns() {
  TK.columns.forEach(col => tkRenderColumn(col.id));
}

function tkRefreshLabelFilter() {
  const allLabels = new Set();
  TK.tasks.forEach(t => (t.labels || []).forEach(l => allLabels.add(l)));
  const sel = document.getElementById('tk-filter-label');
  if (!sel) return;
  sel.innerHTML = '<option value="">All labels</option>' +
    [...allLabels].sort().map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
}

// ── Column CRUD ───────────────────────────────────────────────

function tkGetBoardCols(boardProjectId) {
  return TK.columns
    .filter(c => (c.project_id || null) === (boardProjectId || null))
    .sort((a, b) => a.position - b.position);
}

function tkToggleColMenu(colId) {
  const menu   = document.getElementById(`tk-col-menu-${colId}`);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  tkCloseAllMenus();
  if (!isOpen) { menu.classList.add('open'); TK.openMenuColId = colId; }
}

function tkCloseAllMenus() {
  document.querySelectorAll('.tk-col-menu.open').forEach(m => m.classList.remove('open'));
  TK.openMenuColId = null;
}

function tkRenameCol(colId) {
  tkCloseAllMenus();
  const nameEl = document.getElementById(`tk-col-name-${colId}`);
  if (!nameEl) return;
  const current = nameEl.textContent;
  const input   = document.createElement('input');
  input.className = 'tk-col-rename-input';
  input.value     = current;
  input.maxLength = 40;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const newName = input.value.trim() || current;
    input.replaceWith(nameEl);
    nameEl.textContent = newName;
    if (newName === current) return;
    DB.update('fcc_task_columns', colId, { name: newName });
    TK.columns = DB.getAll('fcc_task_columns').sort((a, b) => a.position - b.position);
  };
  input.addEventListener('blur',    commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  input.blur();
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

function tkRecolorColOpen(colId) {
  const sw = document.getElementById(`tk-col-swatches-${colId}`);
  if (sw) sw.style.display = sw.style.display === 'none' ? 'grid' : 'none';
}

function tkRecolorCol(colId, color) {
  tkCloseAllMenus();
  DB.update('fcc_task_columns', colId, { color });
  TK.columns = DB.getAll('fcc_task_columns').sort((a, b) => a.position - b.position);
  const dot = document.querySelector(`.tk-column[data-col-id="${colId}"] .tk-col-dot`);
  if (dot) dot.style.background = color;
}

function tkDeleteCol(colId) {
  tkCloseAllMenus();
  const col = TK.columns.find(c => c.id === colId);
  if (!col) return;
  const taskCount = TK.tasks.filter(t => t.column_id === colId).length;
  const msg = taskCount > 0
    ? `Delete "${col.name}"? The ${taskCount} task${taskCount !== 1 ? 's' : ''} will remain but become unlinked.`
    : `Delete column "${col.name}"?`;
  tkShowModal('Delete column?', msg, () => {
    DB.getAll('fcc_tasks').filter(t => t.column_id === colId)
      .forEach(t => DB.update('fcc_tasks', t.id, { column_id: null }));
    DB.delete('fcc_task_columns', colId);
    tkLoad();
    tkRenderAllBoards();
    tkToast(`Column "${col.name}" deleted.`);
  });
}

function tkShowAddColForm(boardProjectId) {
  const boardId = boardProjectId || 'general';
  const boardEl = document.getElementById(`tk-board-${boardId}`);
  const addBtn  = document.getElementById(`tk-add-col-btn-${boardId}`);
  if (!boardEl || !addBtn) return;
  addBtn.style.display = 'none';

  const form = document.createElement('div');
  form.className = 'tk-add-col-form';
  form.id        = `tk-add-col-form-${boardId}`;

  const nameInput = document.createElement('input');
  nameInput.className   = 'tk-col-name-input';
  nameInput.placeholder = 'Column name…';
  nameInput.maxLength   = 40;

  const btnsRow = document.createElement('div');
  btnsRow.className = 'tk-add-col-form-btns';

  const okBtn = document.createElement('button');
  okBtn.className  = 'btn-primary';
  okBtn.style.cssText = 'padding:6px 14px;font-size:var(--text-xs)';
  okBtn.textContent = 'Add';
  okBtn.addEventListener('click', () => tkSubmitAddCol(boardId, boardProjectId, nameInput));

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-ghost';
  cancelBtn.style.cssText = 'padding:6px 14px;font-size:var(--text-xs)';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => tkCancelAddCol(boardId));

  btnsRow.appendChild(okBtn);
  btnsRow.appendChild(cancelBtn);
  form.appendChild(nameInput);
  form.appendChild(btnsRow);
  boardEl.appendChild(form);

  nameInput.focus();
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  tkSubmitAddCol(boardId, boardProjectId, nameInput);
    if (e.key === 'Escape') tkCancelAddCol(boardId);
  });
}

function tkSubmitAddCol(boardId, boardProjectId, inputEl) {
  const name = inputEl ? inputEl.value.trim() : '';
  if (!name) { if (inputEl) inputEl.focus(); return; }

  tkCancelAddCol(boardId);

  const existingCols = TK.columns.filter(c => (c.project_id || null) === (boardProjectId || null));
  DB.insert('fcc_task_columns', { name, color: '#3d7a3d', position: existingCols.length, project_id: boardProjectId || null });
  tkLoad();

  const container  = document.getElementById('tk-boards-container');
  const oldSection = document.getElementById(`tk-board-section-${boardId}`);
  if (container && oldSection) {
    const project = boardProjectId ? TK.projects.find(p => p.id === boardProjectId) : null;
    container.replaceChild(tkBuildBoardSection(boardProjectId, project), oldSection);
  } else {
    tkRenderAllBoards();
  }
  tkToast(`Column "${name}" created.`);
}

function tkCancelAddCol(boardId) {
  const form   = document.getElementById(`tk-add-col-form-${boardId}`);
  const addBtn = document.getElementById(`tk-add-col-btn-${boardId}`);
  if (form)   form.remove();
  if (addBtn) addBtn.style.display = '';
}

// ── Task Detail Panel ─────────────────────────────────────────

function tkOpenDetail(taskId, defaultColId) {
  const task = taskId ? TK.tasks.find(t => t.id === taskId) : null;

  let boardProjectId = task ? (task.project_id || null) : null;
  if (!task && defaultColId) {
    const col = TK.columns.find(c => c.id === defaultColId);
    if (col) boardProjectId = col.project_id || null;
  }

  TK_PANEL = {
    taskId:         task ? task.id            : null,
    colId:          task ? (task.column_id   || defaultColId) : defaultColId,
    boardProjectId: boardProjectId,
    title:          task ? (task.title       || '') : '',
    description:    task ? (task.description || '') : '',
    color:          task ? (task.color       || null) : null,
    labels:         task ? [...(task.labels  || [])] : [],
    dueDate:        task ? (task.due_date    || '') : '',
  };

  tkRenderDetailPanel();

  const panel    = document.getElementById('tk-detail');
  const backdrop = document.getElementById('tk-backdrop');
  const label    = document.getElementById('tk-detail-header-label');
  if (label)    label.textContent = task ? 'Edit Task' : 'New Task';
  if (panel)    panel.classList.add('open');
  if (backdrop) backdrop.classList.add('visible');

  setTimeout(() => {
    const title = document.getElementById('tk-detail-title');
    if (title) title.focus();
  }, 60);
}

function tkCloseDetail(silent) {
  const panel    = document.getElementById('tk-detail');
  const backdrop = document.getElementById('tk-backdrop');
  if (panel)    panel.classList.remove('open');
  if (backdrop) backdrop.classList.remove('visible');
  TK_PANEL.taskId = null;
}

function tkRenderDetailPanel() {
  const body = document.getElementById('tk-detail-body');
  if (!body) return;

  const boardOptions = `<option value="__general__" ${!TK_PANEL.boardProjectId ? 'selected' : ''}>General</option>` +
    tkGetProjectOrder().map(p =>
      `<option value="${p.id}" ${p.id === TK_PANEL.boardProjectId ? 'selected' : ''}>${esc(p.title)}</option>`
    ).join('');

  const boardCols = tkGetBoardCols(TK_PANEL.boardProjectId);
  const colOptions = boardCols.length
    ? boardCols.map(c => `<option value="${c.id}" ${c.id === TK_PANEL.colId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
    : '<option value="">No columns yet</option>';

  const swatches = TK_COLORS.map(c => {
    if (c === null) return `<button class="tk-swatch none-swatch ${!TK_PANEL.color ? 'selected' : ''}" onclick="tkPanelSetColor(null)" title="No colour">×</button>`;
    return `<button class="tk-swatch ${TK_PANEL.color === c ? 'selected' : ''}" data-color="${c}" style="background:${c}" onclick="tkPanelSetColor('${c}')" title="${c}"></button>`;
  }).join('');

  const labelChips = TK_PANEL.labels.map((l, i) =>
    `<span class="tk-label-chip" onclick="tkPanelRemoveLabel(${i})">${esc(l)}<span class="tk-chip-x"></span></span>`
  ).join('');

  body.innerHTML = `
    <input class="tk-detail-title" id="tk-detail-title"
      value="${esc(TK_PANEL.title)}" placeholder="Task title…" autocomplete="off"
      oninput="TK_PANEL.title=this.value">

    <div class="tk-detail-field">
      <label>Board</label>
      <select id="tk-detail-board" onchange="tkPanelSetBoard(this.value)">${boardOptions}</select>
    </div>

    <div class="tk-detail-field">
      <label>Column</label>
      <select id="tk-detail-col" onchange="TK_PANEL.colId=this.value">${colOptions}</select>
    </div>

    <div class="tk-detail-field">
      <label>Due date</label>
      <input type="date" id="tk-detail-due" value="${esc(TK_PANEL.dueDate)}" onchange="TK_PANEL.dueDate=this.value">
    </div>

    <div class="tk-detail-field">
      <label>Colour</label>
      <div class="tk-swatches">${swatches}</div>
    </div>

    <div class="tk-detail-field">
      <label>Labels</label>
      <div class="tk-label-input-wrap" id="tk-label-wrap">
        ${labelChips}
        <input class="tk-label-text-input" id="tk-label-input"
          placeholder="${TK_PANEL.labels.length ? '' : 'Add label…'}" autocomplete="off">
      </div>
    </div>

    <div class="tk-detail-desc-section">
      <div class="tk-detail-desc-label">Notes</div>
      <textarea class="tk-detail-description" id="tk-detail-desc"
        placeholder="Add notes…"
        oninput="TK_PANEL.description=this.value">${esc(TK_PANEL.description)}</textarea>
    </div>

    <div class="tk-detail-actions">
      <button class="btn-primary" onclick="tkSaveTask()">Save task</button>
      ${TK_PANEL.taskId ? `<button class="btn-danger" onclick="tkDeleteTask('${TK_PANEL.taskId}')">Delete</button>` : ''}
    </div>
  `;

  const labelInput = document.getElementById('tk-label-input');
  if (labelInput) {
    labelInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const label = labelInput.value.replace(/,/g, '').trim();
        labelInput.value = '';
        tkPanelAddLabel(label);
      }
    });
  }
}

function tkPanelSetBoard(value) {
  TK_PANEL.boardProjectId = value === '__general__' ? null : value;
  const cols = tkGetBoardCols(TK_PANEL.boardProjectId);
  TK_PANEL.colId = cols[0]?.id || null;
  const colSel = document.getElementById('tk-detail-col');
  if (colSel) {
    colSel.innerHTML = cols.length
      ? cols.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
      : '<option value="">No columns yet</option>';
    if (TK_PANEL.colId) colSel.value = TK_PANEL.colId;
  }
}

function tkPanelSetColor(color) {
  TK_PANEL.color = color;
  const wrap = document.querySelector('.tk-detail-panel .tk-swatches');
  if (wrap) {
    wrap.querySelectorAll('.tk-swatch').forEach(s => {
      s.classList.toggle('selected',
        (color === null && s.classList.contains('none-swatch')) ||
        (color !== null && s.dataset.color === color)
      );
    });
  }
}

function tkPanelAddLabel(label) {
  if (!label || TK_PANEL.labels.includes(label)) return;
  TK_PANEL.labels.push(label);
  tkRerenderLabelChips();
  tkRefreshLabelFilter();
}

function tkPanelRemoveLabel(idx) {
  TK_PANEL.labels.splice(idx, 1);
  tkRerenderLabelChips();
}

function tkRerenderLabelChips() {
  const wrap = document.getElementById('tk-label-wrap');
  if (!wrap) return;
  const chips = TK_PANEL.labels.map((l, i) =>
    `<span class="tk-label-chip" onclick="tkPanelRemoveLabel(${i})">${esc(l)}<span class="tk-chip-x"></span></span>`
  ).join('');
  wrap.innerHTML = chips + `<input class="tk-label-text-input" id="tk-label-input"
    placeholder="${TK_PANEL.labels.length ? '' : 'Add label…'}" autocomplete="off">`;
  const newInput = document.getElementById('tk-label-input');
  if (newInput) {
    newInput.focus();
    newInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const label = newInput.value.replace(/,/g, '').trim();
        newInput.value = '';
        tkPanelAddLabel(label);
      }
    });
  }
}

function tkSaveTask() {
  const titleEl = document.getElementById('tk-detail-title');
  const title   = (titleEl ? titleEl.value : TK_PANEL.title).trim();
  if (!title) { tkToast('Please enter a task title.'); return; }
  TK_PANEL.title = title;

  const payload = {
    title:       TK_PANEL.title,
    description: TK_PANEL.description || null,
    column_id:   TK_PANEL.colId       || null,
    color:       TK_PANEL.color       || null,
    labels:      TK_PANEL.labels      || [],
    due_date:    TK_PANEL.dueDate     || null,
    project_id:  TK_PANEL.boardProjectId || null,
  };

  const affectedCols = new Set();

  if (TK_PANEL.taskId) {
    const existing = TK.tasks.find(t => t.id === TK_PANEL.taskId);
    if (existing?.column_id) affectedCols.add(existing.column_id);
    if (payload.column_id)   affectedCols.add(payload.column_id);
    DB.update('fcc_tasks', TK_PANEL.taskId, payload);
  } else {
    const position = DB.getAll('fcc_tasks').filter(t => t.column_id === TK_PANEL.colId).length;
    DB.insert('fcc_tasks', { ...payload, position });
    if (payload.column_id) affectedCols.add(payload.column_id);
  }

  TK.tasks = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  tkCloseDetail();

  // If task moved boards, do a full re-render; otherwise targeted column updates
  const uniqueBoards = new Set([...affectedCols].map(cid => {
    const c = TK.columns.find(col => col.id === cid);
    return c ? (c.project_id || '__gen__') : '__gen__';
  }));
  if (uniqueBoards.size > 1) {
    tkRenderAllBoards();
  } else {
    affectedCols.forEach(colId => { if (colId) tkRenderColumn(colId); });
  }

  tkRefreshLabelFilter();
  tkToast('Task saved.');
}

function tkDeleteTask(taskId) {
  const task = TK.tasks.find(t => t.id === taskId);
  if (!task) return;
  const colId = task.column_id;
  tkShowModal('Delete task?', `"${task.title}" will be permanently deleted.`, () => {
    DB.delete('fcc_tasks', taskId);
    TK.tasks = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    tkCloseDetail();
    if (colId) tkRenderColumn(colId);
    tkRefreshLabelFilter();
    tkToast('Task deleted.');
  });
}

// ── Drag — Cards ──────────────────────────────────────────────

function tkCardDragStart(e, taskId, srcColId) {
  TK_DRAG.type     = 'task';
  TK_DRAG.taskId   = taskId;
  TK_DRAG.srcColId = srcColId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', taskId);
  setTimeout(() => {
    const card = document.querySelector(`.tk-card[data-task-id="${taskId}"]`);
    if (card) card.classList.add('dragging');
  }, 0);
}

function tkCardDragEnd() {
  document.querySelectorAll('.tk-card.dragging').forEach(c => c.classList.remove('dragging'));
  document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());
  TK_DRAG.type = null;
}

function tkCardDragOver(e, colId) {
  if (TK_DRAG.type !== 'task') return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());
  const body = document.getElementById(`tk-col-body-${colId}`);
  if (!body) return;
  const cards    = [...body.querySelectorAll('.tk-card:not(.dragging)')];
  let   inserted = false;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      const line = document.createElement('div');
      line.className = 'tk-drop-line';
      body.insertBefore(line, card);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    const line = document.createElement('div');
    line.className = 'tk-drop-line';
    body.appendChild(line);
  }
}

function tkCardDragLeave(e) {
  const body = e.currentTarget;
  if (!body.contains(e.relatedTarget)) {
    document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());
  }
}

function tkCardDrop(e, destColId) {
  e.preventDefault();
  if (TK_DRAG.type !== 'task') return;

  const taskId   = TK_DRAG.taskId;
  const srcColId = TK_DRAG.srcColId;

  const body = document.getElementById(`tk-col-body-${destColId}`);
  let newPosition = 0;
  if (body) {
    const indicator = body.querySelector('.tk-drop-line');
    const allItems  = [...body.querySelectorAll('.tk-card, .tk-drop-line')];
    newPosition     = indicator ? allItems.indexOf(indicator) : allItems.length;
  }
  document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());

  const destCol      = TK.columns.find(c => c.id === destColId);
  const newProjectId = destCol ? (destCol.project_id || null) : null;

  DB.update('fcc_tasks', taskId, { column_id: destColId, position: newPosition, project_id: newProjectId });
  tkReindexColumn(destColId);
  if (srcColId !== destColId) tkReindexColumn(srcColId);

  TK.tasks = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  tkRenderColumn(destColId);
  if (srcColId !== destColId) tkRenderColumn(srcColId);

  TK_DRAG = { type: null, taskId: null, srcColId: null, colId: null };
}

function tkReindexColumn(colId) {
  const tasks = DB.getAll('fcc_tasks')
    .filter(t => t.column_id === colId)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  tasks.forEach((t, i) => DB.update('fcc_tasks', t.id, { position: i }));
}

// ── Drag — Columns ────────────────────────────────────────────

function tkColDragStart(e, colId) {
  if (TK_DRAG.type === 'task') return;
  TK_DRAG.type  = 'column';
  TK_DRAG.colId = colId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', colId);
  setTimeout(() => {
    const col = document.querySelector(`.tk-column[data-col-id="${colId}"]`);
    if (col) col.classList.add('col-dragging');
  }, 0);
}

function tkColDragEnd() {
  document.querySelectorAll('.tk-column.col-dragging, .tk-column.col-drag-over').forEach(c =>
    c.classList.remove('col-dragging', 'col-drag-over')
  );
  if (TK_DRAG.type === 'column') TK_DRAG = { type: null, taskId: null, srcColId: null, colId: null };
}

function tkColDragOver(e, targetColId) {
  if (TK_DRAG.type !== 'column' || TK_DRAG.colId === targetColId) return;
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.tk-column.col-drag-over').forEach(c => c.classList.remove('col-drag-over'));
  const col = document.querySelector(`.tk-column[data-col-id="${targetColId}"]`);
  if (col) col.classList.add('col-drag-over');
}

function tkColDrop(e, targetColId) {
  if (TK_DRAG.type !== 'column') return;
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.tk-column.col-drag-over, .tk-column.col-dragging').forEach(c =>
    c.classList.remove('col-drag-over', 'col-dragging')
  );

  const dragColId = TK_DRAG.colId;
  if (dragColId === targetColId) { TK_DRAG.type = null; return; }

  const dragCol   = TK.columns.find(c => c.id === dragColId);
  const targetCol = TK.columns.find(c => c.id === targetColId);
  if (!dragCol || !targetCol) { TK_DRAG.type = null; return; }

  // Block cross-board column drag
  if ((dragCol.project_id || null) !== (targetCol.project_id || null)) {
    TK_DRAG = { type: null, taskId: null, srcColId: null, colId: null };
    return;
  }

  const dragPos = dragCol.position;
  DB.update('fcc_task_columns', dragColId,   { position: targetCol.position });
  DB.update('fcc_task_columns', targetColId, { position: dragPos });
  TK.columns = DB.getAll('fcc_task_columns').sort((a, b) => a.position - b.position);

  const boardProjectId = dragCol.project_id || null;
  const boardId        = boardProjectId || 'general';
  const container      = document.getElementById('tk-boards-container');
  const oldSection     = document.getElementById(`tk-board-section-${boardId}`);
  if (container && oldSection) {
    const project = boardProjectId ? TK.projects.find(p => p.id === boardProjectId) : null;
    container.replaceChild(tkBuildBoardSection(boardProjectId, project), oldSection);
  } else {
    tkRenderAllBoards();
  }

  TK_DRAG = { type: null, taskId: null, srcColId: null, colId: null };
}

// ── Modal ─────────────────────────────────────────────────────

function tkShowModal(title, msg, onConfirm) {
  const overlay = document.getElementById('tk-modal-overlay');
  const tEl     = document.getElementById('tk-modal-title');
  const mEl     = document.getElementById('tk-modal-msg');
  if (!overlay) return;
  if (tEl) tEl.textContent = title;
  if (mEl) mEl.textContent = msg;
  overlay.classList.add('open');
  TK_MODAL_CB = onConfirm;
}

function tkModalConfirm() {
  const overlay = document.getElementById('tk-modal-overlay');
  if (overlay) overlay.classList.remove('open');
  if (TK_MODAL_CB) TK_MODAL_CB();
  TK_MODAL_CB = null;
}

function tkModalCancel() {
  const overlay = document.getElementById('tk-modal-overlay');
  if (overlay) overlay.classList.remove('open');
  TK_MODAL_CB = null;
}

// ── Toast ─────────────────────────────────────────────────────

function tkToast(msg) {
  const el = document.getElementById('tk-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(TK_TOAST_TIMER);
  TK_TOAST_TIMER = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Doc events ────────────────────────────────────────────────

function tkBindDocEvents() {
  document.addEventListener('click',   _tkDocClick);
  document.addEventListener('keydown', _tkDocKey);
}

function _tkDocClick(e) {
  if (!e.target.closest('.tk-col-menu-wrap')) tkCloseAllMenus();
}

function _tkDocKey(e) {
  if (e.key === 'Escape') {
    tkCloseDetail();
    tkModalCancel();
    document.querySelectorAll('[id^="tk-add-col-form-"]').forEach(form => {
      tkCancelAddCol(form.id.replace('tk-add-col-form-', ''));
    });
    tkCloseAllMenus();
  }
}

// ── Utility ───────────────────────────────────────────────────

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function tkFormatDue(dateStr) {
  if (!dateStr) return null;
  const today       = todayIso();
  const tomorrow    = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (dateStr < today)         return { text: 'Overdue',  cls: 'overdue'   };
  if (dateStr === today)       return { text: 'Today',    cls: 'due-today' };
  if (dateStr === tomorrowStr) return { text: 'Tomorrow', cls: ''          };
  const [y, m, d] = dateStr.split('-').map(Number);
  return { text: new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }), cls: '' };
}

window.initTasks = initTasks;
