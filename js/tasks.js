// ─────────────────────────────────────────────────────────────
// Tasks — Kanban board backed by localStorage.
// Exposed global: initTasks() — called by router.js section init pattern.
// All functions prefixed tk* to avoid collisions.
// ─────────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────────────

const TK_COLORS = [
  null,           // "none" swatch (first)
  '#5a9c5a',      // green (accent)
  '#c9923a',      // amber (warning)
  '#d45c5c',      // red (danger)
  '#5a8abf',      // blue
  '#8a6abf',      // purple
  '#bf6a8a',      // pink
  '#4a9a8a',      // teal
];

const TK_DEFAULT_COLUMNS = [
  { name: 'To Do',       color: '#5a9c5a', position: 0 },
  { name: 'In Progress', color: '#c9923a', position: 1 },
  { name: 'Done',        color: '#5e7a5e', position: 2 },
];

const TK_KEY = 'fcc_tasks';

// ── Module state ──────────────────────────────────────────────

let TK = {
  columns: [],
  tasks: [],
  projects: [],
  filters: { search: '', projectId: '', label: '', due: '' },
  openMenuColId: null,
};

// Pending detail panel state
let TK_PANEL = {
  taskId: null,
  colId: null,
  title: '',
  description: '',
  color: null,
  labels: [],
  dueDate: '',
  projectId: '',
};

// Drag state
let TK_DRAG = {
  type: null,     // 'task' | 'column'
  taskId: null,
  srcColId: null,
  colId: null,
};

// Modal callback
let TK_MODAL_CB = null;

// Toast timer
let TK_TOAST_TIMER = null;

// ── localStorage persistence ──────────────────────────────────

function tkSave() {
  try {
    localStorage.setItem(TK_KEY, JSON.stringify({
      columns: TK.columns,
      tasks: TK.tasks,
      projects: TK.projects,
    }));
  } catch(e) {}
}

function tkLoad() {
  try {
    const raw = localStorage.getItem(TK_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      TK.columns  = data.columns  || [];
      TK.tasks    = data.tasks    || [];
      TK.projects = data.projects || [];
    }
  } catch(e) {}
}

function tkNextId() {
  return String(Date.now() + Math.floor(Math.random() * 1000));
}

// ── Entry point ───────────────────────────────────────────────

function initTasks() {
  // Reset state for re-navigation
  TK.filters = { search: '', projectId: '', label: '', due: '' };
  TK.openMenuColId = null;
  TK_DRAG = { type: null, taskId: null, srcColId: null, colId: null };
  tkCloseDetail(true);

  tkLoad();

  if (TK.columns.length === 0) {
    const colTodo  = { id: tkNextId(), name: 'To Do',       color: '#5a9c5a', position: 0 };
    const colProg  = { id: tkNextId(), name: 'In Progress', color: '#c9923a', position: 1 };
    const colDone  = { id: tkNextId(), name: 'Done',        color: '#5e7a5e', position: 2 };
    TK.columns = [colTodo, colProg, colDone];

    const today = new Date();
    const addDays = d => { const dt = new Date(today); dt.setDate(dt.getDate() + d); return dt.toISOString().slice(0, 10); };

    TK.tasks = [
      { id: tkNextId(), title: 'Edit wedding highlight reel',      description: 'Deliver 3–5 min edit. Client wants upbeat music.',  column_id: colProg.id, color: '#5a8abf', labels: ['Video'],       due_date: addDays(3),  project_id: null, position: 0 },
      { id: tkNextId(), title: 'Send invoice — Chen shoot',        description: null,                                                column_id: colTodo.id, color: '#c9923a', labels: ['Admin'],       due_date: addDays(1),  project_id: null, position: 0 },
      { id: tkNextId(), title: 'Back up drone footage',            description: null,                                                column_id: colTodo.id, color: null,      labels: [],              due_date: null,        project_id: null, position: 1 },
      { id: tkNextId(), title: 'Cull + colour grade product shoot',description: '~400 selects, deliver 80 finals.',                 column_id: colTodo.id, color: '#8a6abf', labels: ['Photo'],       due_date: addDays(5),  project_id: null, position: 2 },
      { id: tkNextId(), title: 'Update portfolio website',         description: 'Add 2026 projects to the gallery page.',           column_id: colTodo.id, color: null,      labels: ['Admin'],       due_date: null,        project_id: null, position: 3 },
      { id: tkNextId(), title: 'Export social cuts — café promo',  description: 'Square + 9:16 versions for IG and Stories.',       column_id: colProg.id, color: '#4a9a8a', labels: ['Video','Edit'], due_date: addDays(2),  project_id: null, position: 1 },
      { id: tkNextId(), title: 'Deliver family portraits',         description: null,                                                column_id: colDone.id, color: '#5a9c5a', labels: ['Photo'],       due_date: null,        project_id: null, position: 0 },
      { id: tkNextId(), title: 'Submit broadcast package',         description: null,                                                column_id: colDone.id, color: null,      labels: [],              due_date: null,        project_id: null, position: 1 },
    ];
    tkSave();
  }

  // Hide loading spinner, show board
  const loading = document.getElementById('tk-loading');
  const wrap    = document.getElementById('tk-board-wrap');
  if (loading) loading.style.display = 'none';
  if (wrap)    wrap.style.display    = 'flex';

  tkRefreshLabelFilter();
  tkRefreshProjectFilter();
  tkRenderBoard();
  tkBindFilterBar();
  tkBindDocEvents();
}

// ── Board render ──────────────────────────────────────────────

function tkRenderBoard() {
  const board = document.getElementById('tk-board');
  if (!board) return;

  board.innerHTML = '';

  TK.columns.forEach(col => {
    board.appendChild(tkBuildColumn(col));
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'tk-add-col-btn';
  addBtn.id = 'tk-add-col-btn';
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add column`;
  addBtn.addEventListener('click', tkShowAddColForm);
  board.appendChild(addBtn);
}

function tkBuildColumn(col) {
  const visibleTasks = tkGetFilteredTasks(col.id);

  const wrap = document.createElement('div');
  wrap.className = 'tk-column';
  wrap.dataset.colId = col.id;

  wrap.innerHTML = `
    <div class="tk-col-header" draggable="true">
      <div class="tk-col-dot" style="background:${esc(col.color || '#5e7a5e')}"></div>
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
    <button class="tk-add-task-btn" onclick="tkOpenDetail(null, '${col.id}')">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      Add task
    </button>
  `;

  const body = wrap.querySelector('.tk-col-body');
  visibleTasks.forEach(task => body.appendChild(tkBuildCard(task)));

  const header = wrap.querySelector('.tk-col-header');
  header.addEventListener('dragstart', e => tkColDragStart(e, col.id));
  header.addEventListener('dragend',   e => tkColDragEnd(e));

  body.addEventListener('dragover',  e => tkCardDragOver(e, col.id));
  body.addEventListener('dragleave', e => tkCardDragLeave(e));
  body.addEventListener('drop',      e => tkCardDrop(e, col.id));

  wrap.addEventListener('dragover',  e => tkColDragOver(e, col.id));
  wrap.addEventListener('drop',      e => tkColDrop(e, col.id));

  return wrap;
}

function tkRenderColumn(colId) {
  const col = TK.columns.find(c => c.id === colId);
  if (!col) return;

  const body  = document.getElementById(`tk-col-body-${colId}`);
  const count = document.getElementById(`tk-col-count-${colId}`);
  if (!body) return;

  const visibleTasks = tkGetFilteredTasks(colId);
  body.innerHTML = '';
  visibleTasks.forEach(task => body.appendChild(tkBuildCard(task)));
  if (count) count.textContent = visibleTasks.length;
}

function tkBuildCard(task) {
  const card = document.createElement('div');
  card.className = 'tk-card';
  card.dataset.taskId = task.id;
  card.draggable = true;

  const borderColor = task.color || 'var(--border-light)';
  card.style.borderLeftColor = borderColor;

  const labels  = (task.labels || []).slice(0, 3);
  const project = task.project_id ? TK.projects.find(p => p.id === task.project_id) : null;
  const due     = task.due_date ? tkFormatDue(task.due_date) : null;

  card.innerHTML = `
    <div class="tk-card-title">${esc(task.title || 'Untitled')}</div>
    ${(labels.length || project) ? `
      <div class="tk-card-chips">
        ${labels.map(l => `<span class="tk-card-label">${esc(l)}</span>`).join('')}
        ${project ? `<span class="tk-card-project">${esc(project.title)}</span>` : ''}
      </div>` : ''}
    ${due ? `
      <div class="tk-card-meta">
        <span class="tk-card-due ${due.cls}">${due.text}</span>
      </div>` : ''}
  `;

  card.addEventListener('click',     () => tkOpenDetail(task.id, task.column_id));
  card.addEventListener('dragstart', e  => tkCardDragStart(e, task.id, task.column_id));
  card.addEventListener('dragend',   e  => tkCardDragEnd(e));

  return card;
}

// ── Filters ───────────────────────────────────────────────────

function tkGetFilteredTasks(colId) {
  let tasks = TK.tasks.filter(t => t.column_id === colId);
  const f = TK.filters;

  if (f.search) {
    const q = f.search.toLowerCase();
    tasks = tasks.filter(t => (t.title || '').toLowerCase().includes(q));
  }
  if (f.projectId) {
    tasks = tasks.filter(t => t.project_id === f.projectId);
  }
  if (f.label) {
    tasks = tasks.filter(t => (t.labels || []).includes(f.label));
  }
  if (f.due === 'overdue') {
    const today = todayIso();
    tasks = tasks.filter(t => t.due_date && t.due_date < today);
  } else if (f.due === 'this-week') {
    const today = new Date();
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 7);
    const todayStr  = todayIso();
    const weekEndStr = weekEnd.toISOString().slice(0, 10);
    tasks = tasks.filter(t => t.due_date && t.due_date >= todayStr && t.due_date <= weekEndStr);
  } else if (f.due === 'no-date') {
    tasks = tasks.filter(t => !t.due_date);
  }

  return tasks.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
}

function tkBindFilterBar() {
  const search   = document.getElementById('tk-search');
  const projSel  = document.getElementById('tk-filter-project');
  const labelSel = document.getElementById('tk-filter-label');
  const dueSel   = document.getElementById('tk-filter-due');

  if (search)   search.addEventListener('input',  () => { TK.filters.search    = search.value;   tkReRenderAllColumns(); });
  if (projSel)  projSel.addEventListener('change',() => { TK.filters.projectId = projSel.value;  tkReRenderAllColumns(); });
  if (labelSel) labelSel.addEventListener('change',()=> { TK.filters.label     = labelSel.value; tkReRenderAllColumns(); });
  if (dueSel)   dueSel.addEventListener('change', () => { TK.filters.due       = dueSel.value;   tkReRenderAllColumns(); });
}

function tkReRenderAllColumns() {
  TK.columns.forEach(col => tkRenderColumn(col.id));
}

function tkRefreshProjectFilter() {
  const sel = document.getElementById('tk-filter-project');
  if (!sel) return;
  sel.innerHTML = '<option value="">All projects</option>' +
    TK.projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
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

function tkToggleColMenu(colId) {
  const menu = document.getElementById(`tk-col-menu-${colId}`);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  tkCloseAllMenus();
  if (!isOpen) {
    menu.classList.add('open');
    TK.openMenuColId = colId;
  }
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
  const input = document.createElement('input');
  input.className = 'tk-col-rename-input';
  input.value = current;
  input.maxLength = 40;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const newName = input.value.trim() || current;
    input.replaceWith(nameEl);
    nameEl.textContent = newName;
    if (newName === current) return;
    const col = TK.columns.find(c => c.id === colId);
    if (col) col.name = newName;
    tkSave();
  };

  input.addEventListener('blur',    commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  input.blur();
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

function tkRecolorColOpen(colId) {
  const swatchWrap = document.getElementById(`tk-col-swatches-${colId}`);
  if (!swatchWrap) return;
  swatchWrap.style.display = swatchWrap.style.display === 'none' ? 'grid' : 'none';
}

function tkRecolorCol(colId, color) {
  tkCloseAllMenus();
  const col = TK.columns.find(c => c.id === colId);
  if (!col) return;
  col.color = color;
  tkSave();

  const column = document.querySelector(`.tk-column[data-col-id="${colId}"]`);
  if (column) {
    const dot = column.querySelector('.tk-col-dot');
    if (dot) dot.style.background = color;
  }
}

function tkDeleteCol(colId) {
  tkCloseAllMenus();
  const col = TK.columns.find(c => c.id === colId);
  if (!col) return;
  const taskCount = TK.tasks.filter(t => t.column_id === colId).length;
  const msg = taskCount > 0
    ? `Delete "${col.name}"? The ${taskCount} task${taskCount !== 1 ? 's' : ''} in this column will remain but become unlinked.`
    : `Delete column "${col.name}"?`;

  tkShowModal('Delete column?', msg, () => {
    TK.tasks.forEach(t => { if (t.column_id === colId) t.column_id = null; });
    TK.columns = TK.columns.filter(c => c.id !== colId);
    tkSave();
    tkRenderBoard();
    tkToast(`Column "${col.name}" deleted.`);
  });
}

function tkShowAddColForm() {
  const board  = document.getElementById('tk-board');
  const addBtn = document.getElementById('tk-add-col-btn');
  if (!board || !addBtn) return;

  addBtn.style.display = 'none';

  const form = document.createElement('div');
  form.className = 'tk-add-col-form';
  form.id = 'tk-add-col-form';
  form.innerHTML = `
    <input class="tk-col-name-input" id="tk-new-col-input" placeholder="Column name…" maxlength="40" autocomplete="off">
    <div class="tk-add-col-form-btns">
      <button class="btn-primary" style="padding:6px 14px;font-size:var(--text-xs)" onclick="tkSubmitAddCol()">Add</button>
      <button class="btn-ghost"   style="padding:6px 14px;font-size:var(--text-xs)" onclick="tkCancelAddCol()">Cancel</button>
    </div>
  `;
  board.appendChild(form);

  const input = document.getElementById('tk-new-col-input');
  if (input) {
    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  tkSubmitAddCol();
      if (e.key === 'Escape') tkCancelAddCol();
    });
  }
}

function tkSubmitAddCol() {
  const input = document.getElementById('tk-new-col-input');
  const name = (input ? input.value.trim() : '');
  if (!name) { if (input) input.focus(); return; }

  tkCancelAddCol();

  const col = { id: tkNextId(), name, color: '#5a9c5a', position: TK.columns.length };
  TK.columns.push(col);
  tkSave();
  tkRenderBoard();
  tkToast(`Column "${name}" created.`);
}

function tkCancelAddCol() {
  const form   = document.getElementById('tk-add-col-form');
  const addBtn = document.getElementById('tk-add-col-btn');
  if (form)   form.remove();
  if (addBtn) addBtn.style.display = '';
}

// ── Task Detail Panel ─────────────────────────────────────────

function tkOpenDetail(taskId, defaultColId) {
  const task = taskId ? TK.tasks.find(t => t.id === taskId) : null;

  TK_PANEL = {
    taskId: task ? task.id : null,
    colId:  task ? (task.column_id || defaultColId) : defaultColId,
    title:       task ? (task.title       || '') : '',
    description: task ? (task.description || '') : '',
    color:       task ? (task.color       || null) : null,
    labels:      task ? [...(task.labels  || [])] : [],
    dueDate:     task ? (task.due_date    || '') : '',
    projectId:   task ? (task.project_id  || '') : '',
  };

  tkRenderDetailPanel();

  const panel    = document.getElementById('tk-detail');
  const backdrop = document.getElementById('tk-backdrop');
  const label    = document.getElementById('tk-detail-header-label');

  if (label) label.textContent = task ? 'Edit Task' : 'New Task';
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

  const colOptions = TK.columns.map(c =>
    `<option value="${c.id}" ${c.id === TK_PANEL.colId ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');

  const projOptions = '<option value="">None</option>' +
    (TK.projects.length === 0
      ? '<option disabled>No projects yet</option>'
      : TK.projects.map(p =>
          `<option value="${p.id}" ${p.id === TK_PANEL.projectId ? 'selected' : ''}>${esc(p.title)}</option>`
        ).join(''));

  const swatches = TK_COLORS.map(c => {
    if (c === null) {
      return `<button class="tk-swatch none-swatch ${!TK_PANEL.color ? 'selected' : ''}"
        onclick="tkPanelSetColor(null)" title="No colour">×</button>`;
    }
    return `<button class="tk-swatch ${TK_PANEL.color === c ? 'selected' : ''}"
      style="background:${c}" onclick="tkPanelSetColor('${c}')" title="${c}"></button>`;
  }).join('');

  const labelChips = TK_PANEL.labels.map((l, i) =>
    `<span class="tk-label-chip" onclick="tkPanelRemoveLabel(${i})">${esc(l)}<span class="tk-chip-x"></span></span>`
  ).join('');

  body.innerHTML = `
    <input class="tk-detail-title" id="tk-detail-title"
      value="${esc(TK_PANEL.title)}" placeholder="Task title…" autocomplete="off"
      oninput="TK_PANEL.title=this.value">

    <div class="tk-detail-field">
      <label>Column</label>
      <select id="tk-detail-col" onchange="TK_PANEL.colId=this.value">${colOptions}</select>
    </div>

    <div class="tk-detail-field">
      <label>Due date</label>
      <input type="date" id="tk-detail-due"
        value="${esc(TK_PANEL.dueDate)}"
        onchange="TK_PANEL.dueDate=this.value">
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
          placeholder="${TK_PANEL.labels.length ? '' : 'Add label…'}"
          autocomplete="off">
      </div>
    </div>

    <div class="tk-detail-field">
      <label>Project</label>
      <select id="tk-detail-proj" onchange="TK_PANEL.projectId=this.value">${projOptions}</select>
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
        tkPanelAddLabel(labelInput.value.replace(/,/g, '').trim());
        labelInput.value = '';
      }
    });
  }
}

function tkPanelSetColor(color) {
  TK_PANEL.color = color;
  const wrap = document.querySelector('.tk-detail-panel .tk-swatches');
  if (wrap) {
    wrap.querySelectorAll('.tk-swatch').forEach(s => {
      const sColor = s.style.background || null;
      s.classList.toggle('selected',
        (color === null && s.classList.contains('none-swatch')) ||
        (color !== null && sColor === color)
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

  const input    = document.getElementById('tk-label-input');
  const inputVal = input ? input.value : '';

  wrap.innerHTML = chips + `<input class="tk-label-text-input" id="tk-label-input"
    placeholder="${TK_PANEL.labels.length ? '' : 'Add label…'}" autocomplete="off" value="${esc(inputVal)}">`;

  const newInput = document.getElementById('tk-label-input');
  if (newInput) {
    newInput.focus();
    newInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        tkPanelAddLabel(newInput.value.replace(/,/g, '').trim());
        newInput.value = '';
      }
    });
  }
}

function tkSaveTask() {
  const title = (document.getElementById('tk-detail-title') || {}).value || TK_PANEL.title;
  if (!title.trim()) { tkToast('Please enter a task title.'); return; }

  TK_PANEL.title = title.trim();

  const payload = {
    title:       TK_PANEL.title,
    description: TK_PANEL.description || null,
    column_id:   TK_PANEL.colId   || null,
    color:       TK_PANEL.color   || null,
    labels:      TK_PANEL.labels.length ? TK_PANEL.labels : null,
    due_date:    TK_PANEL.dueDate || null,
    project_id:  TK_PANEL.projectId || null,
  };

  const affectedCols = new Set();

  if (TK_PANEL.taskId) {
    const existing = TK.tasks.find(t => t.id === TK_PANEL.taskId);
    if (existing && existing.column_id !== TK_PANEL.colId) {
      affectedCols.add(existing.column_id);
    }
    affectedCols.add(TK_PANEL.colId);

    const idx = TK.tasks.findIndex(t => t.id === TK_PANEL.taskId);
    if (idx !== -1) Object.assign(TK.tasks[idx], payload);
  } else {
    const position = TK.tasks.filter(t => t.column_id === TK_PANEL.colId).length;
    const newTask  = { id: tkNextId(), position, ...payload };
    TK.tasks.push(newTask);
    affectedCols.add(TK_PANEL.colId);
  }

  tkSave();
  tkCloseDetail();
  affectedCols.forEach(colId => { if (colId) tkRenderColumn(colId); });
  tkRefreshLabelFilter();
  tkToast('Task saved.');
}

function tkDeleteTask(taskId) {
  const task = TK.tasks.find(t => t.id === taskId);
  if (!task) return;
  const colId = task.column_id;

  tkShowModal('Delete task?', `"${task.title}" will be permanently deleted.`, () => {
    TK.tasks = TK.tasks.filter(t => t.id !== taskId);
    tkSave();
    tkCloseDetail();
    if (colId) tkRenderColumn(colId);
    tkRefreshLabelFilter();
    tkToast('Task deleted.');
  });
}

// ── Drag and Drop — Cards ─────────────────────────────────────

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

function tkCardDragEnd(e) {
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
  let inserted   = false;

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

  const task = TK.tasks.find(t => t.id === taskId);
  if (!task) return;

  task.column_id = destColId;
  task.position  = newPosition;

  tkReindexColumn(destColId);
  if (srcColId !== destColId) tkReindexColumn(srcColId);

  tkSave();
  tkRenderColumn(destColId);
  if (srcColId !== destColId) tkRenderColumn(srcColId);

  TK_DRAG = { type: null, taskId: null, srcColId: null, colId: null };
}

function tkReindexColumn(colId) {
  const tasks = TK.tasks
    .filter(t => t.column_id === colId)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  tasks.forEach((t, i) => { t.position = i; });
}

// ── Drag and Drop — Columns ───────────────────────────────────

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

function tkColDragEnd(e) {
  document.querySelectorAll('.tk-column.col-dragging, .tk-column.col-drag-over').forEach(c => {
    c.classList.remove('col-dragging', 'col-drag-over');
  });
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

  document.querySelectorAll('.tk-column.col-drag-over, .tk-column.col-dragging').forEach(c => {
    c.classList.remove('col-drag-over', 'col-dragging');
  });

  const dragColId = TK_DRAG.colId;
  if (dragColId === targetColId) { TK_DRAG.type = null; return; }

  const dragCol   = TK.columns.find(c => c.id === dragColId);
  const targetCol = TK.columns.find(c => c.id === targetColId);
  if (!dragCol || !targetCol) { TK_DRAG.type = null; return; }

  const dragPos      = dragCol.position;
  dragCol.position   = targetCol.position;
  targetCol.position = dragPos;

  TK.columns.sort((a, b) => a.position - b.position);
  tkSave();
  tkRenderBoard();

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

// ── Document-level events ─────────────────────────────────────

function tkBindDocEvents() {
  document.addEventListener('click',   _tkDocClick);
  document.addEventListener('keydown', _tkDocKey);
}

function _tkDocClick(e) {
  if (!e.target.closest('.tk-col-menu-wrap')) {
    tkCloseAllMenus();
  }
}

function _tkDocKey(e) {
  if (e.key === 'Escape') {
    tkCloseDetail();
    tkModalCancel();
    tkCancelAddCol();
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
  const today    = todayIso();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  if (dateStr < today)         return { text: 'Overdue',  cls: 'overdue' };
  if (dateStr === today)       return { text: 'Today',    cls: 'due-today' };
  if (dateStr === tomorrowStr) return { text: 'Tomorrow', cls: '' };

  const [y, m, d] = dateStr.split('-').map(Number);
  const dt    = new Date(y, m - 1, d);
  const label = dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return { text: label, cls: '' };
}
