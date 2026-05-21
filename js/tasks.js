// ─────────────────────────────────────────────────────────────
// Tasks — Kanban board backed by Supabase.
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
  taskId: null,   // null = new task
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
  colId: null,    // for column drag
};

// Modal callback
let TK_MODAL_CB = null;

// Toast timer
let TK_TOAST_TIMER = null;

// ── Guard: check Supabase is configured ───────────────────────

function tkSupabaseReady() {
  return typeof CONFIG !== 'undefined'
    && CONFIG.SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE'
    && CONFIG.SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE';
}

// ── Entry point ───────────────────────────────────────────────

async function initTasks() {
  if (!tkSupabaseReady()) {
    tkShowConfigError();
    return;
  }

  // Reset state for re-navigation
  TK.filters = { search: '', projectId: '', label: '', due: '' };
  TK.openMenuColId = null;
  TK_DRAG = { type: null, taskId: null, srcColId: null, colId: null };
  tkCloseDetail(true);

  tkShowLoading(true);

  try {
    await tkLoadData();
  } catch (err) {
    tkToast('Failed to load board data. Check your Supabase connection.');
    tkShowLoading(false);
    return;
  }

  tkShowLoading(false);
  tkRenderBoard();
  tkBindFilterBar();
  tkBindDocEvents();
}

function tkShowConfigError() {
  const loading = document.getElementById('tk-loading');
  if (loading) {
    loading.innerHTML = `
      <div style="text-align:center;max-width:340px;padding:20px">
        <div style="font-size:2rem;margin-bottom:12px">🔌</div>
        <div style="color:var(--text-secondary);font-size:var(--text-sm);line-height:1.6">
          Supabase is not configured yet.<br>
          Fill in <code style="color:var(--accent-bright)">SUPABASE_URL</code> and <code style="color:var(--accent-bright)">SUPABASE_ANON_KEY</code> in <code style="color:var(--accent-bright)">config.js</code>.
        </div>
      </div>
    `;
  }
}

function tkShowLoading(show) {
  const loading = document.getElementById('tk-loading');
  const wrap    = document.getElementById('tk-board-wrap');
  if (loading) loading.style.display = show ? 'flex' : 'none';
  if (wrap)    wrap.style.display    = show ? 'none'  : 'flex';
}

// ── Data loading ──────────────────────────────────────────────

async function tkLoadData() {
  const [colRes, taskRes, projRes] = await Promise.all([
    supabaseClient.from('task_columns').select('*').order('position'),
    supabaseClient.from('tasks').select('*').order('position'),
    supabaseClient.from('projects').select('id, title').order('title'),
  ]);

  if (colRes.error)  throw colRes.error;
  if (taskRes.error) throw taskRes.error;
  // Projects error is non-fatal

  TK.columns  = colRes.data  || [];
  TK.tasks    = taskRes.data || [];
  TK.projects = projRes.data || [];

  // Seed default columns on first run
  if (TK.columns.length === 0) {
    await tkSeedDefaultColumns();
  }

  tkRefreshLabelFilter();
  tkRefreshProjectFilter();
}

async function tkSeedDefaultColumns() {
  const { data, error } = await supabaseClient
    .from('task_columns')
    .insert(TK_DEFAULT_COLUMNS)
    .select();
  if (error) throw error;
  TK.columns = data || [];
}

// ── Board render ──────────────────────────────────────────────

function tkRenderBoard() {
  const board = document.getElementById('tk-board');
  if (!board) return;

  board.innerHTML = '';

  TK.columns.forEach(col => {
    board.appendChild(tkBuildColumn(col));
  });

  // Add column button
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

  // Header
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

  // Populate cards
  const body = wrap.querySelector('.tk-col-body');
  visibleTasks.forEach(task => body.appendChild(tkBuildCard(task)));

  // Column header drag (reorder columns)
  const header = wrap.querySelector('.tk-col-header');
  header.addEventListener('dragstart', e => tkColDragStart(e, col.id));
  header.addEventListener('dragend',   e => tkColDragEnd(e));

  // Column body drop zone
  body.addEventListener('dragover',  e => tkCardDragOver(e, col.id));
  body.addEventListener('dragleave', e => tkCardDragLeave(e));
  body.addEventListener('drop',      e => tkCardDrop(e, col.id));

  // Column drop zone (for column reorder)
  wrap.addEventListener('dragover',  e => tkColDragOver(e, col.id));
  wrap.addEventListener('drop',      e => tkColDrop(e, col.id));

  return wrap;
}

function tkRenderColumn(colId) {
  const col = TK.columns.find(c => c.id === colId);
  if (!col) return;

  const body = document.getElementById(`tk-col-body-${colId}`);
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

  const labels = (task.labels || []).slice(0, 3);
  const project = task.project_id ? TK.projects.find(p => p.id === task.project_id) : null;
  const due = task.due_date ? tkFormatDue(task.due_date) : null;

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
    const todayStr = todayIso();
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

  if (search)   search.addEventListener('input', () => { TK.filters.search = search.value; tkReRenderAllColumns(); });
  if (projSel)  projSel.addEventListener('change', () => { TK.filters.projectId = projSel.value; tkReRenderAllColumns(); });
  if (labelSel) labelSel.addEventListener('change', () => { TK.filters.label = labelSel.value; tkReRenderAllColumns(); });
  if (dueSel)   dueSel.addEventListener('change', () => { TK.filters.due = dueSel.value; tkReRenderAllColumns(); });
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

  const commit = async () => {
    const newName = input.value.trim() || current;
    input.replaceWith(nameEl);
    nameEl.textContent = newName;

    if (newName === current) return;

    const col = TK.columns.find(c => c.id === colId);
    if (col) col.name = newName;

    const { error } = await supabaseClient
      .from('task_columns')
      .update({ name: newName })
      .eq('id', colId);
    if (error) { tkToast('Failed to rename column.'); col.name = current; nameEl.textContent = current; }
  };

  input.addEventListener('blur',    commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { input.blur(); }
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

function tkRecolorColOpen(colId) {
  const swatchWrap = document.getElementById(`tk-col-swatches-${colId}`);
  if (!swatchWrap) return;
  swatchWrap.style.display = swatchWrap.style.display === 'none' ? 'grid' : 'none';
}

async function tkRecolorCol(colId, color) {
  tkCloseAllMenus();
  const col = TK.columns.find(c => c.id === colId);
  if (!col) return;
  const old = col.color;
  col.color = color;

  // Update the dot immediately
  const column = document.querySelector(`.tk-column[data-col-id="${colId}"]`);
  if (column) {
    const dot = column.querySelector('.tk-col-dot');
    if (dot) dot.style.background = color;
  }

  const { error } = await supabaseClient
    .from('task_columns')
    .update({ color })
    .eq('id', colId);
  if (error) { tkToast('Failed to update colour.'); col.color = old; }
}

function tkDeleteCol(colId) {
  tkCloseAllMenus();
  const col = TK.columns.find(c => c.id === colId);
  if (!col) return;
  const taskCount = TK.tasks.filter(t => t.column_id === colId).length;
  const msg = taskCount > 0
    ? `Delete "${col.name}"? The ${taskCount} task${taskCount !== 1 ? 's' : ''} in this column will remain but become unlinked.`
    : `Delete column "${col.name}"?`;

  tkShowModal('Delete column?', msg, async () => {
    const { error } = await supabaseClient
      .from('task_columns')
      .delete()
      .eq('id', colId);
    if (error) { tkToast('Failed to delete column.'); return; }

    // Unlink tasks locally (they stay in DB but column_id → null)
    TK.tasks.forEach(t => { if (t.column_id === colId) t.column_id = null; });
    TK.columns = TK.columns.filter(c => c.id !== colId);
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

async function tkSubmitAddCol() {
  const input = document.getElementById('tk-new-col-input');
  const name = (input ? input.value.trim() : '');
  if (!name) { if (input) input.focus(); return; }

  tkCancelAddCol(); // remove form first

  const position = TK.columns.length;
  const { data, error } = await supabaseClient
    .from('task_columns')
    .insert({ name, color: '#5a9c5a', position })
    .select()
    .single();

  if (error) { tkToast('Failed to create column.'); return; }

  TK.columns.push(data);
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

  // Focus title
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

  // Label input: add on Enter or comma
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
  // Re-render just the swatches
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

  const input = document.getElementById('tk-label-input');
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

async function tkSaveTask() {
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
    // Update existing
    const existing = TK.tasks.find(t => t.id === TK_PANEL.taskId);
    if (existing && existing.column_id !== TK_PANEL.colId) {
      affectedCols.add(existing.column_id);
    }
    affectedCols.add(TK_PANEL.colId);

    const { error } = await supabaseClient
      .from('tasks')
      .update(payload)
      .eq('id', TK_PANEL.taskId);

    if (error) { tkToast('Failed to save task.'); return; }

    // Update local state
    const idx = TK.tasks.findIndex(t => t.id === TK_PANEL.taskId);
    if (idx !== -1) Object.assign(TK.tasks[idx], payload);

  } else {
    // Insert new
    const position = TK.tasks.filter(t => t.column_id === TK_PANEL.colId).length;
    const { data, error } = await supabaseClient
      .from('tasks')
      .insert({ ...payload, position })
      .select()
      .single();

    if (error) { tkToast('Failed to create task.'); return; }

    TK.tasks.push(data);
    affectedCols.add(TK_PANEL.colId);
  }

  tkCloseDetail();
  affectedCols.forEach(colId => { if (colId) tkRenderColumn(colId); });
  tkRefreshLabelFilter();
  tkToast('Task saved.');
}

async function tkDeleteTask(taskId) {
  const task = TK.tasks.find(t => t.id === taskId);
  if (!task) return;
  const colId = task.column_id;

  tkShowModal('Delete task?', `"${task.title}" will be permanently deleted.`, async () => {
    const { error } = await supabaseClient
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (error) { tkToast('Failed to delete task.'); return; }

    TK.tasks = TK.tasks.filter(t => t.id !== taskId);
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

  // Visual feedback
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

  // Remove existing indicators
  document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());

  const body  = document.getElementById(`tk-col-body-${colId}`);
  if (!body) return;

  const cards = [...body.querySelectorAll('.tk-card:not(.dragging)')];
  let inserted = false;

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
  // Only clean up if leaving the column body entirely
  const body = e.currentTarget;
  if (!body.contains(e.relatedTarget)) {
    document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());
  }
}

async function tkCardDrop(e, destColId) {
  e.preventDefault();
  if (TK_DRAG.type !== 'task') return;

  const taskId   = TK_DRAG.taskId;
  const srcColId = TK_DRAG.srcColId;

  // Find drop position from indicator
  const body = document.getElementById(`tk-col-body-${destColId}`);
  let newPosition = 0;
  if (body) {
    const indicator = body.querySelector('.tk-drop-line');
    const allItems  = [...body.querySelectorAll('.tk-card, .tk-drop-line')];
    newPosition     = indicator ? allItems.indexOf(indicator) : allItems.length;
  }

  document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());

  // Update local task
  const task = TK.tasks.find(t => t.id === taskId);
  if (!task) return;

  const oldColId   = task.column_id;
  const oldPos     = task.position;
  task.column_id   = destColId;
  task.position    = newPosition;

  // Reindex all tasks in affected columns
  tkReindexColumn(destColId);
  if (srcColId !== destColId) tkReindexColumn(srcColId);

  // Re-render affected columns immediately (optimistic)
  tkRenderColumn(destColId);
  if (srcColId !== destColId) tkRenderColumn(srcColId);

  // Persist to Supabase
  try {
    const updates = [];

    // Update the moved task's column and position
    updates.push(
      supabaseClient.from('tasks').update({ column_id: destColId, position: task.position }).eq('id', taskId)
    );

    // Update positions of all tasks in dest col
    const destTasks = TK.tasks.filter(t => t.column_id === destColId && t.id !== taskId);
    destTasks.forEach(t => {
      updates.push(supabaseClient.from('tasks').update({ position: t.position }).eq('id', t.id));
    });

    // Update positions of all tasks in src col (if different)
    if (srcColId !== destColId) {
      const srcTasks = TK.tasks.filter(t => t.column_id === srcColId);
      srcTasks.forEach(t => {
        updates.push(supabaseClient.from('tasks').update({ position: t.position }).eq('id', t.id));
      });
    }

    await Promise.all(updates);
  } catch (err) {
    tkToast('Failed to save task position.');
  }

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
  if (TK_DRAG.type === 'task') return; // don't interfere with card drag
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

async function tkColDrop(e, targetColId) {
  if (TK_DRAG.type !== 'column') return;
  e.preventDefault();
  e.stopPropagation();

  document.querySelectorAll('.tk-column.col-drag-over, .tk-column.col-dragging').forEach(c => {
    c.classList.remove('col-drag-over', 'col-dragging');
  });

  const dragColId = TK_DRAG.colId;
  if (dragColId === targetColId) { TK_DRAG.type = null; return; }

  // Swap positions
  const dragCol   = TK.columns.find(c => c.id === dragColId);
  const targetCol = TK.columns.find(c => c.id === targetColId);
  if (!dragCol || !targetCol) { TK_DRAG.type = null; return; }

  const dragPos   = dragCol.position;
  dragCol.position   = targetCol.position;
  targetCol.position = dragPos;

  TK.columns.sort((a, b) => a.position - b.position);
  tkRenderBoard();

  // Persist
  try {
    await Promise.all([
      supabaseClient.from('task_columns').update({ position: dragCol.position }).eq('id', dragColId),
      supabaseClient.from('task_columns').update({ position: targetCol.position }).eq('id', targetColId),
    ]);
  } catch (err) {
    tkToast('Failed to save column order.');
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

// ── Document-level events ─────────────────────────────────────

function tkBindDocEvents() {
  // Close column menus on outside click
  document.addEventListener('click', _tkDocClick);
  // Escape key closes panel and modal
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
  const today   = todayIso();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  if (dateStr < today)        return { text: 'Overdue',  cls: 'overdue' };
  if (dateStr === today)      return { text: 'Today',    cls: 'due-today' };
  if (dateStr === tomorrowStr)return { text: 'Tomorrow', cls: '' };

  // Format as "May 25"
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const label = dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return { text: label, cls: '' };
}
