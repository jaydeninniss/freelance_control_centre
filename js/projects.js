// ─────────────────────────────────────────────────────────────
// Projects — backed by db.js (localStorage via DB).
// Exposed global: window.initProjects — called by router.
// All project functions prefixed proj*; inline board functions projB*.
// ─────────────────────────────────────────────────────────────

const PROJ_STATUS_LABELS = {
  'onboarding':     'Onboarding',
  'pre-production': 'Pre-production',
  'production':     'Production',
  'post':           'Post',
  'retro':          'Retro',
};

const PROJ_TYPE_LABELS = {
  'photo':     'Photo',
  'video':     'Video',
  'broadcast': 'Broadcast',
};

const PROJ_B_COLORS = [
  null,
  '#3d7a3d', '#c9923a', '#d45c5c', '#5a8abf',
  '#8a6abf', '#bf6a8a', '#4a9a8a',
];

// ── State ─────────────────────────────────────────────────────

const PROJ = {
  selectedId:           null,
  mode:                 null,
  boardProjectId:       null,
  sortMode:             localStorage.getItem('fcc_proj_sort') || 'recent',
  filter:               { status: '', type: '', search: '' },
  projects:             [],
  clients:              [],
  collaborators:        [],
  projectClients:       [],
  projectCollaborators: [],
  tasks:                [],
  taskColumns:          [],
};

let PROJ_B_PANEL = {
  taskId: null, colId: null, title: '', description: '',
  color: null, labels: [], dueDate: '',
};

let _projBDrag          = { type: null, taskId: null, srcColId: null };
let _projBOpenMenuColId = null;
let _projModalCb        = null;
let _projToastTimer     = null;
let _projArchivedOpen   = false;
let _projArchivedSearch = '';
let _projListDrag       = { id: null };
let _projListDragging   = false;
let _dpCallback         = null;

// ── Data ──────────────────────────────────────────────────────

function projLoad() {
  PROJ.projects             = DB.getAll('fcc_projects');
  PROJ.clients              = DB.getAll('fcc_clients');
  PROJ.collaborators        = DB.getAll('fcc_collaborators');
  PROJ.projectClients       = DB.getAll('fcc_project_clients');
  PROJ.projectCollaborators = DB.getAll('fcc_project_collaborators');
  PROJ.tasks                = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  PROJ.taskColumns          = DB.getAll('fcc_task_columns').sort((a, b) => a.position - b.position);
}

// ── Init ──────────────────────────────────────────────────────

async function initProjects() {
  PROJ.selectedId   = null;
  PROJ.mode         = null;
  PROJ.boardProjectId = null;
  PROJ.sortMode     = localStorage.getItem('fcc_proj_sort') || 'recent';
  PROJ.filter       = { status: '', type: '', search: '' };
  PROJ_B_PANEL      = { taskId: null, colId: null, title: '', description: '', color: null, labels: [], dueDate: '' };
  _projBDrag        = { type: null, taskId: null, srcColId: null };
  _projBOpenMenuColId = null;

  await DB.hydrate([
    'fcc_projects', 'fcc_clients', 'fcc_collaborators',
    'fcc_project_clients', 'fcc_project_collaborators',
    'fcc_tasks', 'fcc_task_columns',
  ]);
  projLoad();
  projRenderList();
  projShowEmpty();

  document.addEventListener('click', _projDocClick);
  document.addEventListener('keydown', _projDocKey);

  if (window.__openProjectId) {
    const projectId = window.__openProjectId;
    window.__openProjectId = null;
    projSelectProject(projectId);
  }
}

function _projDocClick(e) {
  if (!e.target.closest('.tk-col-menu-wrap')) projBCloseAllMenus();
  if (!e.target.closest('#proj-date-picker') &&
      !e.target.closest('.proj-compact-date-field') &&
      !e.target.closest('#projb-detail-due-btn')) {
    projDatePickerHide();
  }
}

function _projDocKey(e) {
  if (e.key === 'Escape') {
    projBCloseDetail();
    projModalCancel();
    projBCancelAddCol();
    projBCloseAllMenus();
    projDatePickerHide();
  }
}

// ── List ──────────────────────────────────────────────────────

function projGetFiltered() {
  let list = [...PROJ.projects].filter(p => !p.archived);
  const f  = PROJ.filter;
  if (f.status) list = list.filter(p => p.status === f.status);
  if (f.type)   list = list.filter(p => p.type   === f.type);
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(p => (p.title || '').toLowerCase().includes(q));
  }
  if (PROJ.sortMode === 'manual') {
    list.sort((a, b) => {
      const posA = a.board_position ?? 999;
      const posB = b.board_position ?? 999;
      if (posA !== posB) return posA - posB;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  } else {
    list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  return list;
}

function projSetSortMode(mode) {
  PROJ.sortMode = mode;
  localStorage.setItem('fcc_proj_sort', mode);

  // When switching to manual, initialise board_position from current display order
  if (mode === 'manual') {
    const ordered = [...PROJ.projects].sort((a, b) =>
      (b.created_at || '').localeCompare(a.created_at || '')
    );
    ordered.forEach((p, i) => {
      if ((p.board_position ?? -1) < 0 || p.board_position === undefined) {
        DB.update('fcc_projects', p.id, { board_position: i });
        p.board_position = i;
      }
    });
    projLoad();
  }

  const sel = document.getElementById('proj-sort-mode');
  if (sel) sel.value = mode;
  projRenderList();
}

function projMoveProject(id, dir) {
  const list = projGetFiltered();
  const idx  = list.findIndex(p => p.id === id);
  const swap = dir === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= list.length) return;

  const a = list[idx];
  const b = list[swap];
  const posA = a.board_position ?? idx;
  const posB = b.board_position ?? swap;
  DB.update('fcc_projects', a.id, { board_position: posB });
  DB.update('fcc_projects', b.id, { board_position: posA });
  a.board_position = posB;
  b.board_position = posA;
  projRenderList();
}

function projRenderList() {
  const listEl = document.getElementById('proj-list');
  if (!listEl) return;

  // Sync sort dropdown
  const sortSel = document.getElementById('proj-sort-mode');
  if (sortSel) sortSel.value = PROJ.sortMode;

  const projects = projGetFiltered();

  if (projects.length === 0) {
    listEl.innerHTML = PROJ.projects.filter(p => !p.archived).length === 0
      ? `<div class="proj-empty-state"><p>No projects yet.</p>
           <button class="btn-primary" onclick="projOpenNew()">+ New Project</button></div>`
      : `<div class="proj-empty-state"><p>No projects match your filters.</p></div>`;
    projRenderArchivedSection();
    return;
  }

  const isManual = PROJ.sortMode === 'manual';

  projRenderArchivedSection();

  listEl.innerHTML = projects.map(p => {
    const junctions   = PROJ.projectClients.filter(j => j.project_id === p.id);
    const clientNames = PROJ.clients.filter(c => junctions.some(j => j.client_id === c.id)).map(c => c.name).join(', ');
    const selected    = p.id === PROJ.selectedId ? ' proj-selected' : '';
    const statusClass = PROJ_STATUS_LABELS[p.status] ? 'proj-status-' + p.status : 'proj-status-custom';
    const statusLabel = PROJ_STATUS_LABELS[p.status] || p.status || '';
    const typeLabel   = PROJ_TYPE_LABELS[p.type]     || p.type   || '';

    let dateStr = '';
    if (p.shoot_day) {
      if (p.start_date) dateStr = projFmtDate(p.start_date);
    } else {
      if (p.start_date && p.end_date) dateStr = `${projFmtDate(p.start_date)} – ${projFmtDate(p.end_date)}`;
      else if (p.start_date)          dateStr = projFmtDate(p.start_date);
      else if (p.end_date)            dateStr = projFmtDate(p.end_date);
    }

    const dragAttrs = isManual
      ? `draggable="true" data-proj-id="${p.id}" ondragstart="projListDragStart(event,'${p.id}')" ondragend="projListDragEnd(event)"`
      : '';

    return `<div class="proj-card${selected}${isManual ? ' proj-card-draggable' : ''}" ${dragAttrs} onclick="projListCardClick(event,'${p.id}')">
      <div class="proj-card-title-row">
        <div class="proj-card-title">${projEsc(p.title || 'Untitled')}</div>
      </div>
      <div class="proj-card-badges">
        ${statusLabel ? `<span class="proj-status-badge ${statusClass}">${projEsc(statusLabel)}</span>` : ''}
        ${typeLabel   ? `<span class="proj-type-badge">${projEsc(typeLabel)}</span>` : ''}
      </div>
      ${clientNames ? `<div class="proj-card-clients">${projEsc(clientNames)}</div>` : ''}
      ${dateStr     ? `<div class="proj-card-dates">${projEsc(dateStr)}</div>`       : ''}
    </div>`;
  }).join('');

  listEl.removeEventListener('dragover',  _projListDragOver);
  listEl.removeEventListener('drop',      _projListDrop);
  listEl.removeEventListener('dragleave', _projListDragLeave);
  if (isManual) {
    listEl.addEventListener('dragover',  _projListDragOver);
    listEl.addEventListener('drop',      _projListDrop);
    listEl.addEventListener('dragleave', _projListDragLeave);
  }
}

function projFilterList() {
  PROJ.filter.search = document.getElementById('proj-search')?.value        || '';
  PROJ.filter.status = document.getElementById('proj-filter-status')?.value || '';
  PROJ.filter.type   = document.getElementById('proj-filter-type')?.value   || '';
  projRenderList();
}

function projFmtDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Detail panel ──────────────────────────────────────────────

function projShowEmpty() {
  const empty   = document.getElementById('proj-detail-empty');
  const content = document.getElementById('proj-detail-content');
  if (empty)   empty.style.display   = '';
  if (content) content.style.display = 'none';
  document.getElementById('proj-list-panel')?.classList.remove('proj-detail-open');
}

function projListCardClick(e, id) {
  if (_projListDragging) return;
  projSelectProject(id);
}

function projSelectProject(id) {
  PROJ.selectedId     = id;
  PROJ.boardProjectId = id;
  PROJ.mode           = null;
  projRenderList();

  const project = PROJ.projects.find(p => p.id === id);
  if (!project) return;

  projRenderDetail(project);
  document.getElementById('proj-list-panel')?.classList.add('proj-detail-open');
}

// ── Project List Drag-to-reorder ──────────────────────────────

function projListDragStart(e, id) {
  _projListDrag.id = id;
  _projListDragging = true;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  setTimeout(() => {
    document.querySelector(`.proj-card[data-proj-id="${id}"]`)?.classList.add('dragging');
  }, 0);
}

function projListDragEnd(e) {
  document.querySelectorAll('.proj-card.dragging').forEach(c => c.classList.remove('dragging'));
  document.querySelectorAll('.proj-list-drop-line').forEach(l => l.remove());
  _projListDrag.id = null;
  setTimeout(() => { _projListDragging = false; }, 80);
}

function _projListDragOver(e) {
  if (!_projListDrag.id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.proj-list-drop-line').forEach(l => l.remove());
  const listEl = document.getElementById('proj-list');
  const cards  = [...(listEl?.querySelectorAll('.proj-card:not(.dragging)') || [])];
  let inserted = false;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      const line = document.createElement('div');
      line.className = 'proj-list-drop-line';
      card.parentNode.insertBefore(line, card);
      inserted = true;
      break;
    }
  }
  if (!inserted && listEl) {
    const line = document.createElement('div');
    line.className = 'proj-list-drop-line';
    listEl.appendChild(line);
  }
}

function _projListDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    document.querySelectorAll('.proj-list-drop-line').forEach(l => l.remove());
  }
}

function _projListDrop(e) {
  e.preventDefault();
  const dragId = _projListDrag.id;
  if (!dragId) return;

  const listEl   = document.getElementById('proj-list');
  const indicator = listEl?.querySelector('.proj-list-drop-line');
  const allItems  = [...(listEl?.querySelectorAll('.proj-card, .proj-list-drop-line') || [])];
  let   newIndex  = indicator ? allItems.indexOf(indicator) : allItems.length;

  document.querySelectorAll('.proj-list-drop-line').forEach(l => l.remove());

  const ordered  = projGetFiltered();
  const oldIndex = ordered.findIndex(p => p.id === dragId);
  if (oldIndex === -1) { _projListDrag.id = null; return; }

  const reordered = [...ordered];
  const [item]    = reordered.splice(oldIndex, 1);
  if (newIndex > oldIndex) newIndex--;
  reordered.splice(Math.min(newIndex, reordered.length), 0, item);

  reordered.forEach((p, i) => {
    if (p.board_position !== i) {
      DB.update('fcc_projects', p.id, { board_position: i });
      p.board_position = i;
    }
  });

  _projListDrag.id = null;
  projRenderList();
}

function projRenderDetail(project) {
  const empty   = document.getElementById('proj-detail-empty');
  const content = document.getElementById('proj-detail-content');
  if (!empty || !content) return;

  PROJ.boardProjectId = project.id;

  empty.style.display   = 'none';
  content.style.display = '';

  const _knownStatuses = new Set(Object.keys(PROJ_STATUS_LABELS));
  const _knownTypes    = new Set(Object.keys(PROJ_TYPE_LABELS));
  const _customStatus  = project.status && !_knownStatuses.has(project.status);
  const _customType    = project.type   && !_knownTypes.has(project.type);

  const statusOptions = Object.entries(PROJ_STATUS_LABELS).map(([v, l]) =>
    `<option value="${v}" ${project.status === v ? 'selected' : ''}>${l}</option>`
  ).join('') +
  (_customStatus ? `<option value="${projEsc(project.status)}" selected>${projEsc(project.status)}</option>` : '') +
  `<option value="__custom__">Custom…</option>`;

  const typeOptions = `<option value="" ${!project.type ? 'selected' : ''}>—</option>` +
    Object.entries(PROJ_TYPE_LABELS).map(([v, l]) =>
      `<option value="${v}" ${project.type === v ? 'selected' : ''}>${l}</option>`
    ).join('') +
  (_customType ? `<option value="${projEsc(project.type)}" selected>${projEsc(project.type)}</option>` : '') +
  `<option value="__custom__">Custom…</option>`;

  const linkedClientIds  = PROJ.projectClients.filter(j => j.project_id === project.id).map(j => j.client_id);
  const linkedClients    = PROJ.clients.filter(c => linkedClientIds.includes(c.id));
  const availableClients = PROJ.clients.filter(c => !linkedClientIds.includes(c.id));

  const linkedCollabIds  = PROJ.projectCollaborators.filter(j => j.project_id === project.id).map(j => j.collaborator_id);
  const linkedCollabs    = PROJ.collaborators.filter(c => linkedCollabIds.includes(c.id));
  const availableCollabs = PROJ.collaborators.filter(c => !linkedCollabIds.includes(c.id));

  const clientChipsHtml  = projPeopleChipsHtml(project.id, linkedClients, 'client');
  const collabChipsHtml  = projPeopleChipsHtml(project.id, linkedCollabs, 'collab');
  const addClientHtml    = projAddPersonSelectHtml(project.id, availableClients, PROJ.clients, 'client');
  const addCollabHtml    = projAddPersonSelectHtml(project.id, availableCollabs, PROJ.collaborators, 'collab');

  content.innerHTML = `
    <!-- Compact metadata header -->
    <div class="proj-compact-header">
      <div class="proj-compact-title-row">
        <h2 class="proj-detail-title" onclick="projEditTitle('${project.id}', this)">${projEsc(project.title || 'Untitled')}</h2>
        <button class="proj-back-btn" onclick="projShowEmpty()">← Back</button>
      </div>

      <div class="proj-compact-fields">
        <div class="proj-compact-field">
          <span class="proj-compact-field-label">Status</span>
          <select class="proj-compact-select" onchange="projCompactSelectChange('${project.id}','status',this)">${statusOptions}</select>
        </div>
        <div class="proj-compact-field">
          <span class="proj-compact-field-label">Type</span>
          <select class="proj-compact-select" onchange="projCompactSelectChange('${project.id}','type',this)">${typeOptions}</select>
        </div>
        <div class="proj-compact-field proj-compact-toggle-field" onclick="projToggleShootDay('${project.id}')">
          <span class="proj-compact-field-label">Shoot Day</span>
          <span class="proj-compact-toggle${project.shoot_day ? ' on' : ''}"></span>
        </div>
        ${project.shoot_day ? `
        <div class="proj-compact-field proj-compact-date-field" onclick="projPickDate(this,'${project.id}','start_date')">
          <span class="proj-compact-field-label">Date</span>
          <span class="field-row__value proj-field-val" data-field="start_date">${projFmtFieldDate(project.start_date)}</span>
        </div>` : `
        <div class="proj-compact-field proj-compact-date-field" onclick="projPickDate(this,'${project.id}','start_date')">
          <span class="proj-compact-field-label">Start</span>
          <span class="field-row__value proj-field-val" data-field="start_date">${projFmtFieldDate(project.start_date)}</span>
        </div>
        <div class="proj-compact-field proj-compact-date-field" onclick="projPickDate(this,'${project.id}','end_date')">
          <span class="proj-compact-field-label">End</span>
          <span class="field-row__value proj-field-val" data-field="end_date">${projFmtFieldDate(project.end_date)}</span>
        </div>`}
      </div>

      <div class="proj-compact-meta-row">
        <div class="proj-compact-people">
          <div class="proj-compact-people-group">
            <span class="proj-compact-people-label">Clients</span>
            <div class="proj-compact-people-chips">${clientChipsHtml}</div>
            ${addClientHtml}
          </div>
          <div class="proj-compact-people-group">
            <span class="proj-compact-people-label">Collaborators</span>
            <div class="proj-compact-people-chips">${collabChipsHtml}</div>
            ${addCollabHtml}
          </div>
        </div>
        <div class="proj-notes-wrap proj-detail-notes">
          <label class="proj-section-label">Notes</label>
          <textarea class="proj-notes-textarea" placeholder="Add notes…"
            onblur="projSaveNotes('${project.id}',this.value)">${projEsc(project.notes || '')}</textarea>
        </div>
      </div>
    </div>

    <!-- Inline Kanban board -->
    <div class="proj-board-panel-section">
      <div class="proj-board-panel-wrap">
        <div class="tk-board" id="projb-board"></div>
      </div>
    </div>

    <!-- Footer -->
    ${project.archived
      ? `<div class="proj-detail-footer proj-detail-footer--archived">
           <span class="proj-archive-status-badge">Archived</span>
           <div class="proj-detail-footer-actions">
             <button class="btn-ghost" onclick="projUnarchiveProject('${project.id}')">Restore Project</button>
             <button class="btn-danger" onclick="projConfirmPermDelete('${project.id}')">Delete Permanently</button>
           </div>
         </div>`
      : `<div class="proj-detail-footer">
           <button class="btn-archive" onclick="projConfirmArchive('${project.id}')">Archive Project</button>
         </div>`
    }
  `;

  // Render the board into the container
  projBRenderBoard();
}

function projPeopleChipsHtml(projectId, people, kind) {
  return people.map(p => {
    const removeCall = kind === 'client'
      ? `projUnlinkClient('${projectId}','${p.id}')`
      : `projUnlinkCollab('${projectId}','${p.id}')`;
    return `<span class="proj-person-chip">
      <button class="proj-person-chip-name" onclick="projOpenPersonInCrm('${p.id}','${kind}')" title="Open in CRM">${projEsc(p.name)}</button>
      <button class="proj-person-chip-remove" onclick="${removeCall}" title="Remove">×</button>
    </span>`;
  }).join('');
}

function projOpenPersonInCrm(personId, kind) {
  window.__openCrmPersonId   = personId;
  window.__openCrmPersonKind = kind === 'client' ? 'clients' : 'collaborators';
  navigate('crm');
}

function projAddPersonSelectHtml(projectId, available, all, kind) {
  if (all.length === 0) {
    return `<p class="proj-people-empty">Add ${kind === 'client' ? 'clients' : 'collaborators'} in the CRM tab first.</p>`;
  }
  if (available.length === 0) {
    return `<p class="proj-people-empty">All ${kind === 'client' ? 'clients' : 'collaborators'} linked.</p>`;
  }
  const onchange = kind === 'client'
    ? `projLinkClient('${projectId}',this.value);this.value=''`
    : `projLinkCollab('${projectId}',this.value);this.value=''`;
  return `<select class="proj-add-person-select" onchange="${onchange}">
    <option value="">+ Add ${kind === 'client' ? 'client' : 'collaborator'}…</option>
    ${available.map(p => `<option value="${p.id}">${projEsc(p.name)}</option>`).join('')}
  </select>`;
}

function projFmtFieldDate(val) {
  if (!val) return '<span class="proj-empty-val">—</span>';
  const [y, m, d] = val.split('-').map(Number);
  return projEsc(new Date(y, m - 1, d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }));
}

// ── Inline field editing ──────────────────────────────────────

function projEditField(id, field, type, rowEl) {
  if (rowEl.querySelector('input')) return;
  const project = PROJ.projects.find(p => p.id === id);
  if (!project) return;

  const valEl = rowEl.querySelector('.proj-field-val');
  if (!valEl) return;

  const input     = document.createElement('input');
  input.type      = type;
  input.value     = project[field] || '';
  input.className = 'proj-inline-input';
  valEl.replaceWith(input);
  rowEl.onclick = null;
  input.focus();

  function commit() {
    const newVal  = input.value || null;
    const updated = DB.update('fcc_projects', id, { [field]: newVal });
    const idx     = PROJ.projects.findIndex(p => p.id === id);
    if (idx !== -1 && updated) PROJ.projects[idx] = updated;

    const newSpan = document.createElement('span');
    newSpan.className = 'field-row__value proj-field-val';
    newSpan.setAttribute('data-field', field);
    newSpan.innerHTML = projFmtFieldDate(newVal);
    input.replaceWith(newSpan);
    rowEl.onclick = () => projEditField(id, field, type, rowEl);
    projShowToast('Saved');
    projRenderList();
  }

  input.addEventListener('blur',    commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.blur(); }
  });
}

function projSaveField(id, field, value) {
  const val     = value || null;
  const updated = DB.update('fcc_projects', id, { [field]: val });
  const idx     = PROJ.projects.findIndex(p => p.id === id);
  if (idx !== -1 && updated) PROJ.projects[idx] = updated;
  projShowToast('Saved');
  projRenderList();
}

function projCompactSelectChange(id, field, selectEl) {
  if (selectEl.value !== '__custom__') {
    projSaveField(id, field, selectEl.value || null);
    return;
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'proj-compact-custom-input';
  input.placeholder = 'Custom value…';
  input.autocomplete = 'off';
  selectEl.replaceWith(input);
  input.focus();
  function commit() {
    const val = input.value.trim() || null;
    if (val) {
      const updated = DB.update('fcc_projects', id, { [field]: val });
      const idx = PROJ.projects.findIndex(p => p.id === id);
      if (idx !== -1 && updated) PROJ.projects[idx] = updated;
      projShowToast('Saved');
      projRenderList();
    }
    const project = PROJ.projects.find(p => p.id === id);
    if (project) projRenderDetail(project);
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      const project = PROJ.projects.find(p => p.id === id);
      if (project) projRenderDetail(project);
    }
  });
}

function projNewFormCustomSelect(selectEl) {
  if (selectEl.value !== '__custom__') return;
  const input = document.createElement('input');
  input.type = 'text';
  input.name = selectEl.name;
  input.className = 'proj-new-input proj-compact-custom-input';
  input.placeholder = 'Enter custom value…';
  input.autocomplete = 'off';
  selectEl.replaceWith(input);
  input.focus();
}

function projEditTitle(id, titleEl) {
  if (titleEl.querySelector('input')) return;
  const project = PROJ.projects.find(p => p.id === id);
  if (!project) return;

  const input     = document.createElement('input');
  input.type      = 'text';
  input.value     = project.title || '';
  input.className = 'proj-title-input';
  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();
  titleEl.onclick = null;

  function commit() {
    const newTitle = input.value.trim() || project.title || 'Untitled';
    const updated  = DB.update('fcc_projects', id, { title: newTitle });
    const idx      = PROJ.projects.findIndex(p => p.id === id);
    if (idx !== -1 && updated) PROJ.projects[idx] = updated;
    titleEl.textContent = newTitle;
    titleEl.onclick = () => projEditTitle(id, titleEl);
    projRenderList();
    projShowToast('Saved');
  }

  input.addEventListener('blur',    commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      titleEl.textContent = project.title || 'Untitled';
      titleEl.onclick = () => projEditTitle(id, titleEl);
    }
  });
}

function projSaveNotes(id, value) {
  const updated = DB.update('fcc_projects', id, { notes: value || null });
  const idx     = PROJ.projects.findIndex(p => p.id === id);
  if (idx !== -1 && updated) PROJ.projects[idx] = updated;
  projShowToast('Notes saved');
}

// ── Client / collaborator linking ─────────────────────────────

function projLinkClient(projectId, clientId) {
  if (!clientId) return;
  DB.junctionAdd('fcc_project_clients', { project_id: projectId, client_id: clientId });
  projLoad();
  const project = PROJ.projects.find(p => p.id === projectId);
  if (project) projRenderDetail(project);
  projRenderList();
  projShowToast('Client linked');
}

function projUnlinkClient(projectId, clientId) {
  DB.junctionRemove('fcc_project_clients', { project_id: projectId, client_id: clientId });
  projLoad();
  const project = PROJ.projects.find(p => p.id === projectId);
  if (project) projRenderDetail(project);
  projRenderList();
  projShowToast('Client removed');
}

function projLinkCollab(projectId, collabId) {
  if (!collabId) return;
  DB.junctionAdd('fcc_project_collaborators', { project_id: projectId, collaborator_id: collabId });
  projLoad();
  const project = PROJ.projects.find(p => p.id === projectId);
  if (project) projRenderDetail(project);
  projShowToast('Collaborator linked');
}

function projUnlinkCollab(projectId, collabId) {
  DB.junctionRemove('fcc_project_collaborators', { project_id: projectId, collaborator_id: collabId });
  projLoad();
  const project = PROJ.projects.find(p => p.id === projectId);
  if (project) projRenderDetail(project);
  projShowToast('Collaborator removed');
}

// ── New Project ───────────────────────────────────────────────

function projOpenNew() {
  PROJ.selectedId = null;
  PROJ.mode       = 'new';
  projRenderList();

  const empty   = document.getElementById('proj-detail-empty');
  const content = document.getElementById('proj-detail-content');
  if (!empty || !content) return;
  empty.style.display   = 'none';
  content.style.display = '';

  const statusOptions = Object.entries(PROJ_STATUS_LABELS).map(([v, l]) =>
    `<option value="${v}" ${v === 'onboarding' ? 'selected' : ''}>${l}</option>`
  ).join('') + `<option value="__custom__">Custom…</option>`;

  const typeOptions = '<option value="">— Select type —</option>' +
    Object.entries(PROJ_TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('') +
    `<option value="__custom__">Custom…</option>`;

  content.innerHTML = `
    <div class="proj-detail-header">
      <div class="proj-detail-title-row">
        <h2 class="proj-detail-title" style="cursor:default">New Project</h2>
      </div>
      <button class="proj-back-btn" onclick="projShowEmpty()">← Back</button>
    </div>
    <div class="proj-detail-body">
      <form id="proj-new-form" onsubmit="projCreateProject(event)">
        <div class="proj-new-fields">
          <div class="proj-new-field">
            <label class="proj-section-label">Title *</label>
            <input type="text" name="title" class="proj-new-input" placeholder="Required" autocomplete="off">
          </div>
          <div class="proj-new-field">
            <label class="proj-section-label">Status</label>
            <select name="status" class="proj-new-select" onchange="projNewFormCustomSelect(this)">${statusOptions}</select>
          </div>
          <div class="proj-new-field">
            <label class="proj-section-label">Type</label>
            <select name="type" class="proj-new-select" onchange="projNewFormCustomSelect(this)">${typeOptions}</select>
          </div>
          <div class="proj-new-field">
            <label class="proj-section-label">Start Date</label>
            <input type="date" name="start_date" class="proj-new-input">
          </div>
          <div class="proj-new-field">
            <label class="proj-section-label">End Date</label>
            <input type="date" name="end_date" class="proj-new-input">
          </div>
        </div>
        <div class="proj-notes-wrap" style="margin-bottom:20px">
          <label class="proj-section-label">Notes</label>
          <textarea name="notes" class="proj-notes-textarea" placeholder="Add notes…"></textarea>
        </div>
        <div class="proj-detail-footer">
          <button type="submit" class="btn-primary">Create Project</button>
          <button type="button" class="btn-ghost" onclick="projShowEmpty()">Cancel</button>
        </div>
      </form>
    </div>`;

  content.querySelector('input[name="title"]')?.focus();
  document.getElementById('proj-list-panel')?.classList.add('proj-detail-open');
}

function projCreateProject(e) {
  e.preventDefault();
  const form = document.getElementById('proj-new-form');
  if (!form) return;

  const raw  = Object.fromEntries(new FormData(form));
  const data = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.trim() || null]));

  if (!data.title) {
    projShowToast('Title is required');
    form.querySelector('input[name="title"]')?.focus();
    return;
  }

  const created   = DB.insert('fcc_projects', data);
  PROJ.projects   = DB.getAll('fcc_projects');
  PROJ.mode       = null;
  PROJ.selectedId = created.id;

  projRenderList();
  projRenderDetail(created);
  projShowToast('Project created');
}

// ── Archive / Delete ──────────────────────────────────────────

function projConfirmArchive(id) {
  const project = PROJ.projects.find(p => p.id === id);
  if (!project) return;

  const confirmBtn = document.getElementById('proj-modal-confirm-btn');
  const confirmWrap = document.getElementById('proj-modal-confirm-wrap');
  document.getElementById('proj-modal-title').textContent = 'Archive Project';
  document.getElementById('proj-modal-msg').textContent =
    `"${project.title || 'Untitled'}" will move to your archive. Its board will be hidden from the main task view, but remains fully accessible in the archive.`;
  if (confirmWrap) confirmWrap.style.display = 'none';
  if (confirmBtn) { confirmBtn.textContent = 'Archive'; confirmBtn.disabled = false; confirmBtn.className = 'btn-ghost'; }
  document.getElementById('proj-modal-overlay').style.display = 'flex';

  _projModalCb = () => {
    const updated = DB.update('fcc_projects', id, { archived: true });
    const idx = PROJ.projects.findIndex(p => p.id === id);
    if (idx !== -1 && updated) PROJ.projects[idx] = updated;
    PROJ.selectedId = null;
    projRenderList();
    projShowEmpty();
    projShowToast('Project archived');
  };
}

function projUnarchiveProject(id) {
  const updated = DB.update('fcc_projects', id, { archived: false });
  const idx = PROJ.projects.findIndex(p => p.id === id);
  if (idx !== -1 && updated) PROJ.projects[idx] = updated;
  PROJ.selectedId = id;
  projRenderList();
  const project = PROJ.projects.find(p => p.id === id);
  if (project) { projRenderDetail(project); document.getElementById('proj-list-panel')?.classList.add('proj-detail-open'); }
  projShowToast('Project restored to active');
}

function projConfirmPermDelete(id) {
  const project = PROJ.projects.find(p => p.id === id);
  if (!project) return;

  const title = project.title || 'Untitled';
  const confirmWrap  = document.getElementById('proj-modal-confirm-wrap');
  const confirmBtn   = document.getElementById('proj-modal-confirm-btn');
  document.getElementById('proj-modal-title').textContent = 'Delete Permanently';
  document.getElementById('proj-modal-msg').textContent =
    `This cannot be undone. All project data and its board columns will be permanently deleted.`;

  if (confirmWrap) confirmWrap.style.display = '';
  if (confirmBtn)  { confirmBtn.textContent = 'Delete Permanently'; confirmBtn.disabled = true; confirmBtn.className = 'btn-danger'; }

  // Fresh input element to wipe stale listeners
  const oldInput = document.getElementById('proj-modal-confirm-input');
  const newInput = oldInput.cloneNode(true);
  newInput.placeholder = `Type "${title}" to confirm`;
  newInput.value = '';
  oldInput.replaceWith(newInput);
  newInput.addEventListener('input', () => {
    if (confirmBtn) confirmBtn.disabled = newInput.value !== title;
  });

  document.getElementById('proj-modal-overlay').style.display = 'flex';
  setTimeout(() => newInput.focus(), 60);

  _projModalCb = () => {
    DB.junctionGet('fcc_project_clients', 'project_id', id)
      .forEach(r => DB.junctionRemove('fcc_project_clients', r));
    DB.junctionGet('fcc_project_collaborators', 'project_id', id)
      .forEach(r => DB.junctionRemove('fcc_project_collaborators', r));
    DB.getAll('fcc_tasks').filter(t => t.project_id === id)
      .forEach(t => DB.update('fcc_tasks', t.id, { project_id: null, column_id: null }));
    DB.getAll('fcc_task_columns').filter(c => (c.project_id || null) === id)
      .forEach(c => DB.delete('fcc_task_columns', c.id));
    DB.delete('fcc_projects', id);
    projLoad();
    PROJ.selectedId = null;
    projRenderList();
    projShowEmpty();
    projShowToast('Project permanently deleted');
  };
}

function _projModalClose() {
  document.getElementById('proj-modal-overlay').style.display = 'none';
  const confirmWrap = document.getElementById('proj-modal-confirm-wrap');
  const confirmBtn  = document.getElementById('proj-modal-confirm-btn');
  if (confirmWrap) confirmWrap.style.display = 'none';
  if (confirmBtn)  { confirmBtn.disabled = false; confirmBtn.textContent = 'Delete'; confirmBtn.className = 'btn-danger'; }
}

function projModalCancel() {
  _projModalClose();
  _projModalCb = null;
}

function projModalConfirm() {
  const btn = document.getElementById('proj-modal-confirm-btn');
  if (btn?.disabled) return;
  _projModalClose();
  if (_projModalCb) { _projModalCb(); _projModalCb = null; }
}

// ── Archived Section ──────────────────────────────────────────

function projToggleArchived() {
  _projArchivedOpen = !_projArchivedOpen;
  projRenderArchivedSection();
}

function projSearchArchived(q) {
  _projArchivedSearch = q;
  projRenderArchivedSection();
}

function projRenderArchivedSection() {
  const el = document.getElementById('proj-archived-section');
  if (!el) return;

  const archived = PROJ.projects.filter(p => p.archived);
  if (archived.length === 0) { el.innerHTML = ''; return; }

  const q        = _projArchivedSearch.toLowerCase();
  const filtered = q ? archived.filter(p => (p.title || '').toLowerCase().includes(q)) : archived;
  const isOpen   = _projArchivedOpen;

  el.className = 'proj-archived-section' + (isOpen ? ' open' : '');
  el.innerHTML = `
    <button class="proj-archived-toggle" onclick="projToggleArchived()">
      <svg viewBox="0 0 24 24" width="13" height="13">
        <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/>
        <line x1="10" y1="12" x2="14" y2="12"/>
      </svg>
      Archived
      <span class="proj-archived-count">${archived.length}</span>
      <span class="proj-archived-chevron">›</span>
    </button>
    ${isOpen ? `
      <div class="proj-archived-body">
        <div class="proj-archived-search-wrap">
          <input type="search" class="proj-archived-search-input" placeholder="Search archived…"
            value="${projEsc(_projArchivedSearch)}"
            oninput="projSearchArchived(this.value)"
            autocomplete="off">
        </div>
        <div class="proj-archived-list">
          ${filtered.length === 0
            ? '<p class="proj-archived-empty">No archived projects found.</p>'
            : filtered.map(p => {
                const sel    = p.id === PROJ.selectedId ? ' proj-selected' : '';
                const sLabel = PROJ_STATUS_LABELS[p.status] || '';
                return `<div class="proj-archived-card${sel}" onclick="projSelectProject('${p.id}')">
                  <span class="proj-archived-card-title">${projEsc(p.title || 'Untitled')}</span>
                  ${sLabel ? `<span class="proj-archived-badge">${projEsc(sLabel)}</span>` : ''}
                </div>`;
              }).join('')
          }
        </div>
      </div>` : ''}
  `;
}

// ═══════════════════════════════════════════════════════════════
// INLINE BOARD — kanban within project detail panel
// Reuses tk-* CSS classes from tasks.css. IDs prefixed projb-.
// ═══════════════════════════════════════════════════════════════

function projBRenderBoard() {
  const board = document.getElementById('projb-board');
  if (!board || !PROJ.boardProjectId) return;

  PROJ.tasks       = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  PROJ.taskColumns = DB.getAll('fcc_task_columns').sort((a, b) => a.position - b.position);

  board.innerHTML = '';

  const cols = PROJ.taskColumns.filter(c => (c.project_id || null) === PROJ.boardProjectId);
  cols.forEach(col => board.appendChild(projBBuildColumn(col)));

  const addBtn = document.createElement('button');
  addBtn.className = 'tk-add-col-btn';
  addBtn.id        = 'projb-add-col-btn';
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add column`;
  addBtn.addEventListener('click', () => projBShowAddColForm(PROJ.boardProjectId));
  board.appendChild(addBtn);
}

function projBGetTasks(colId) {
  return PROJ.tasks
    .filter(t => t.column_id === colId && (t.project_id || null) === (PROJ.boardProjectId || null))
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
}

function projBBuildColumn(col) {
  const tasks = projBGetTasks(col.id);

  const wrap = document.createElement('div');
  wrap.className     = 'tk-column';
  wrap.dataset.colId = col.id;

  wrap.innerHTML = `
    <div class="tk-col-header">
      <div class="tk-col-dot" style="background:${col.color || '#737373'}"></div>
      <span class="tk-col-name" id="projb-col-name-${col.id}">${projEsc(col.name)}</span>
      <span class="tk-col-count" id="projb-col-count-${col.id}">${tasks.length}</span>
      <div class="tk-col-menu-wrap">
        <button class="tk-col-menu-btn" onclick="projBToggleColMenu('${col.id}')" aria-label="Column options">⋯</button>
        <div class="tk-col-menu" id="projb-col-menu-${col.id}">
          <button class="tk-col-menu-item" onclick="projBRenameCol('${col.id}')">Rename</button>
          <button class="tk-col-menu-item" onclick="projBRecolorColOpen('${col.id}')">Change colour</button>
          <div class="tk-col-swatches" id="projb-col-swatches-${col.id}" style="display:none">
            ${PROJ_B_COLORS.filter(c => c !== null).map(c =>
              `<button class="tk-swatch" style="background:${c};${col.color===c?'border-color:#fff;transform:scale(1.1)':''}"
                onclick="projBRecolorCol('${col.id}','${c}')"></button>`
            ).join('')}
          </div>
          <button class="tk-col-menu-item danger" onclick="projBDeleteCol('${col.id}')">Delete</button>
        </div>
      </div>
    </div>
    <div class="tk-col-body" id="projb-col-body-${col.id}"></div>
    <button class="tk-add-task-btn" onclick="projBOpenDetail(null,'${col.id}')">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      Add task
    </button>
  `;

  const body = wrap.querySelector('.tk-col-body');
  tasks.forEach(task => body.appendChild(projBBuildCard(task)));

  body.addEventListener('dragover',  e => projBCardDragOver(e, col.id));
  body.addEventListener('dragleave', e => projBCardDragLeave(e));
  body.addEventListener('drop',      e => projBCardDrop(e, col.id));

  return wrap;
}

function projBRenderColumn(colId) {
  PROJ.tasks = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  const body  = document.getElementById(`projb-col-body-${colId}`);
  const count = document.getElementById(`projb-col-count-${colId}`);
  if (!body) return;
  const tasks = projBGetTasks(colId);
  body.innerHTML = '';
  tasks.forEach(task => body.appendChild(projBBuildCard(task)));
  if (count) count.textContent = tasks.length;
}

function projBBuildCard(task) {
  const card = document.createElement('div');
  card.className      = 'tk-card';
  card.dataset.taskId = task.id;
  card.draggable      = true;
  card.style.borderLeftColor = task.color || 'var(--border-light)';

  const labels = (task.labels || []).slice(0, 3);
  const due    = task.due_date ? projBFormatDue(task.due_date) : null;

  card.innerHTML = `
    <div class="tk-card-title">${projEsc(task.title || 'Untitled')}</div>
    ${labels.length ? `<div class="tk-card-chips">${labels.map(l => `<span class="tk-card-label">${projEsc(l)}</span>`).join('')}</div>` : ''}
    ${due ? `<div class="tk-card-meta"><span class="tk-card-due ${due.cls}">${due.text}</span></div>` : ''}
  `;

  card.addEventListener('click',     () => projBOpenDetail(task.id, task.column_id));
  card.addEventListener('dragstart', e  => projBCardDragStart(e, task.id, task.column_id));
  card.addEventListener('dragend',   ()  => projBCardDragEnd());

  return card;
}

function projBFormatDue(dateStr) {
  if (!dateStr) return null;
  const today  = new Date().toISOString().slice(0, 10);
  const tmr    = new Date(); tmr.setDate(tmr.getDate() + 1);
  const tmrStr = tmr.toISOString().slice(0, 10);
  if (dateStr < today)    return { text: 'Overdue',  cls: 'overdue'   };
  if (dateStr === today)  return { text: 'Today',    cls: 'due-today' };
  if (dateStr === tmrStr) return { text: 'Tomorrow', cls: ''          };
  const [y, m, d] = dateStr.split('-').map(Number);
  return { text: new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }), cls: '' };
}

// ── Column CRUD (inline board) ────────────────────────────────

function projBToggleColMenu(colId) {
  const menu   = document.getElementById(`projb-col-menu-${colId}`);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  projBCloseAllMenus();
  if (!isOpen) { menu.classList.add('open'); _projBOpenMenuColId = colId; }
}

function projBCloseAllMenus() {
  document.querySelectorAll('[id^="projb-col-menu-"].open').forEach(m => m.classList.remove('open'));
  _projBOpenMenuColId = null;
}

function projBRenameCol(colId) {
  projBCloseAllMenus();
  const nameEl = document.getElementById(`projb-col-name-${colId}`);
  if (!nameEl) return;
  const current = nameEl.textContent;
  const input   = document.createElement('input');
  input.className = 'tk-col-rename-input';
  input.value     = current;
  input.maxLength = 40;
  nameEl.replaceWith(input);
  input.focus(); input.select();
  const commit = () => {
    const newName = input.value.trim() || current;
    input.replaceWith(nameEl);
    nameEl.textContent = newName;
    if (newName === current) return;
    DB.update('fcc_task_columns', colId, { name: newName });
    PROJ.taskColumns = DB.getAll('fcc_task_columns').sort((a, b) => a.position - b.position);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  input.blur();
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

function projBRecolorColOpen(colId) {
  const sw = document.getElementById(`projb-col-swatches-${colId}`);
  if (sw) sw.style.display = sw.style.display === 'none' ? 'grid' : 'none';
}

function projBRecolorCol(colId, color) {
  projBCloseAllMenus();
  DB.update('fcc_task_columns', colId, { color });
  PROJ.taskColumns = DB.getAll('fcc_task_columns').sort((a, b) => a.position - b.position);
  const dot = document.querySelector(`.tk-column[data-col-id="${colId}"] .tk-col-dot`);
  if (dot) dot.style.background = color;
}

function projBDeleteCol(colId) {
  projBCloseAllMenus();
  const col       = PROJ.taskColumns.find(c => c.id === colId);
  const taskCount = PROJ.tasks.filter(t => t.column_id === colId).length;
  const msg = taskCount > 0
    ? `Delete "${col?.name}"? The ${taskCount} task${taskCount !== 1 ? 's' : ''} will remain but become unlinked.`
    : `Delete column "${col?.name}"?`;

  document.getElementById('proj-modal-title').textContent = 'Delete column?';
  document.getElementById('proj-modal-msg').textContent   = msg;
  document.getElementById('proj-modal-overlay').style.display = 'flex';

  _projModalCb = () => {
    DB.getAll('fcc_tasks').filter(t => t.column_id === colId)
      .forEach(t => DB.update('fcc_tasks', t.id, { column_id: null }));
    DB.delete('fcc_task_columns', colId);
    projLoad();
    projBRenderBoard();
    projShowToast(`Column "${col?.name}" deleted.`);
  };
}

function projBShowAddColForm(projectId) {
  const board  = document.getElementById('projb-board');
  const addBtn = document.getElementById('projb-add-col-btn');
  if (!board || !addBtn) return;
  addBtn.style.display = 'none';

  const form = document.createElement('div');
  form.className = 'tk-add-col-form';
  form.id        = 'projb-add-col-form';

  const nameInput = document.createElement('input');
  nameInput.className   = 'tk-col-name-input';
  nameInput.placeholder = 'Column name…';
  nameInput.maxLength   = 40;

  const btnsRow = document.createElement('div');
  btnsRow.className = 'tk-add-col-form-btns';

  const okBtn = document.createElement('button');
  okBtn.className = 'btn-primary';
  okBtn.style.cssText = 'padding:6px 14px;font-size:var(--text-xs)';
  okBtn.textContent = 'Add';
  okBtn.addEventListener('click', () => projBSubmitAddCol(projectId, nameInput));

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-ghost';
  cancelBtn.style.cssText = 'padding:6px 14px;font-size:var(--text-xs)';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => projBCancelAddCol());

  btnsRow.appendChild(okBtn);
  btnsRow.appendChild(cancelBtn);
  form.appendChild(nameInput);
  form.appendChild(btnsRow);
  board.appendChild(form);

  nameInput.focus();
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  projBSubmitAddCol(projectId, nameInput);
    if (e.key === 'Escape') projBCancelAddCol();
  });
}

function projBSubmitAddCol(projectId, inputEl) {
  const name = inputEl ? inputEl.value.trim() : '';
  if (!name) { if (inputEl) inputEl.focus(); return; }
  projBCancelAddCol();
  const existing = PROJ.taskColumns.filter(c => (c.project_id || null) === projectId);
  DB.insert('fcc_task_columns', { name, color: '#3d7a3d', position: existing.length, project_id: projectId });
  projLoad();
  projBRenderBoard();
  projShowToast(`Column "${name}" created.`);
}

function projBCancelAddCol() {
  const form   = document.getElementById('projb-add-col-form');
  const addBtn = document.getElementById('projb-add-col-btn');
  if (form)   form.remove();
  if (addBtn) addBtn.style.display = '';
}

// ── Task Detail Panel (fixed overlay) ────────────────────────

function projBOpenDetail(taskId, defaultColId) {
  const task = taskId ? PROJ.tasks.find(t => t.id === taskId) : null;

  PROJ_B_PANEL = {
    taskId:      task ? task.id              : null,
    colId:       task ? (task.column_id || defaultColId) : defaultColId,
    title:       task ? (task.title       || '') : '',
    description: task ? (task.description || '') : '',
    color:       task ? (task.color       || null) : null,
    labels:      task ? [...(task.labels  || [])] : [],
    dueDate:     task ? (task.due_date    || '') : '',
  };

  projBRenderDetailPanel();

  const panel    = document.getElementById('projb-detail');
  const backdrop = document.getElementById('projb-backdrop');
  const label    = document.getElementById('projb-detail-label');
  if (label)    label.textContent = task ? 'Edit Task' : 'New Task';
  if (panel)    panel.classList.add('open');
  if (backdrop) backdrop.classList.add('visible');

  setTimeout(() => document.getElementById('projb-detail-title')?.focus(), 60);
}

function projBCloseDetail() {
  document.getElementById('projb-detail')?.classList.remove('open');
  document.getElementById('projb-backdrop')?.classList.remove('visible');
  PROJ_B_PANEL.taskId = null;
  projDatePickerHide();
}

function projBRenderDetailPanel() {
  const body = document.getElementById('projb-detail-body');
  if (!body) return;

  const projectCols = PROJ.taskColumns
    .filter(c => (c.project_id || null) === (PROJ.boardProjectId || null))
    .sort((a, b) => a.position - b.position);

  const colOptions = projectCols.length
    ? projectCols.map(c => `<option value="${c.id}" ${c.id === PROJ_B_PANEL.colId ? 'selected' : ''}>${projEsc(c.name)}</option>`).join('')
    : '<option value="">No columns yet</option>';

  const swatches = PROJ_B_COLORS.map(c => {
    if (c === null) return `<button class="tk-swatch none-swatch ${!PROJ_B_PANEL.color ? 'selected' : ''}" onclick="projBPanelSetColor(null)" title="No colour">×</button>`;
    return `<button class="tk-swatch ${PROJ_B_PANEL.color === c ? 'selected' : ''}" data-color="${c}" style="background:${c}" onclick="projBPanelSetColor('${c}')"></button>`;
  }).join('');

  const labelChips = PROJ_B_PANEL.labels.map((l, i) =>
    `<span class="tk-label-chip" onclick="projBPanelRemoveLabel(${i})">${projEsc(l)}<span class="tk-chip-x"></span></span>`
  ).join('');

  body.innerHTML = `
    <input class="tk-detail-title" id="projb-detail-title"
      value="${projEsc(PROJ_B_PANEL.title)}" placeholder="Task title…" autocomplete="off"
      oninput="PROJ_B_PANEL.title=this.value">

    <div class="tk-detail-field">
      <label>Column</label>
      <select id="projb-detail-col" onchange="PROJ_B_PANEL.colId=this.value">${colOptions}</select>
    </div>

    <div class="tk-detail-field">
      <label>Due date</label>
      <button class="proj-dp-trigger-btn" id="projb-detail-due-btn" onclick="projPickTaskDate(this)">${PROJ_B_PANEL.dueDate ? projFmtFieldDate(PROJ_B_PANEL.dueDate) : '<span class="proj-empty-val">Pick a date…</span>'}</button>
    </div>

    <div class="tk-detail-field">
      <label>Colour</label>
      <div class="tk-swatches">${swatches}</div>
    </div>

    <div class="tk-detail-field">
      <label>Labels</label>
      <div class="tk-label-input-wrap" id="projb-label-wrap">
        ${labelChips}
        <input class="tk-label-text-input" id="projb-label-input"
          placeholder="${PROJ_B_PANEL.labels.length ? '' : 'Add label…'}" autocomplete="off">
      </div>
    </div>

    <div class="tk-detail-desc-section">
      <div class="tk-detail-desc-label">Notes</div>
      <textarea class="tk-detail-description" id="projb-detail-desc"
        placeholder="Add notes…"
        oninput="PROJ_B_PANEL.description=this.value">${projEsc(PROJ_B_PANEL.description)}</textarea>
    </div>

    <div class="tk-detail-actions">
      <button class="btn-primary" onclick="projBSaveTask()">Save task</button>
      ${PROJ_B_PANEL.taskId ? `<button class="btn-danger" onclick="projBDeleteTask('${PROJ_B_PANEL.taskId}')">Delete</button>` : ''}
    </div>
  `;

  const labelInput = document.getElementById('projb-label-input');
  if (labelInput) {
    labelInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const label = labelInput.value.replace(/,/g, '').trim();
        labelInput.value = '';
        projBPanelAddLabel(label);
      }
    });
  }
}

function projBPanelSetColor(color) {
  PROJ_B_PANEL.color = color;
  document.getElementById('projb-detail-body')?.querySelectorAll('.tk-swatch').forEach(s => {
    s.classList.toggle('selected',
      (color === null && s.classList.contains('none-swatch')) ||
      (color !== null && s.dataset.color === color)
    );
  });
}

function projBPanelAddLabel(label) {
  if (!label || PROJ_B_PANEL.labels.includes(label)) return;
  PROJ_B_PANEL.labels.push(label);
  projBRerenderLabelChips();
}

function projBPanelRemoveLabel(idx) {
  PROJ_B_PANEL.labels.splice(idx, 1);
  projBRerenderLabelChips();
}

function projBRerenderLabelChips() {
  const wrap = document.getElementById('projb-label-wrap');
  if (!wrap) return;
  const chips = PROJ_B_PANEL.labels.map((l, i) =>
    `<span class="tk-label-chip" onclick="projBPanelRemoveLabel(${i})">${projEsc(l)}<span class="tk-chip-x"></span></span>`
  ).join('');
  wrap.innerHTML = chips + `<input class="tk-label-text-input" id="projb-label-input"
    placeholder="${PROJ_B_PANEL.labels.length ? '' : 'Add label…'}" autocomplete="off">`;
  const newInput = document.getElementById('projb-label-input');
  if (newInput) {
    newInput.focus();
    newInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const label = newInput.value.replace(/,/g, '').trim();
        newInput.value = '';
        projBPanelAddLabel(label);
      }
    });
  }
}

function projBSaveTask() {
  const titleEl = document.getElementById('projb-detail-title');
  const title   = (titleEl ? titleEl.value : PROJ_B_PANEL.title).trim();
  if (!title) { projShowToast('Please enter a task title.'); return; }
  PROJ_B_PANEL.title = title;

  const payload = {
    title:       PROJ_B_PANEL.title,
    description: PROJ_B_PANEL.description || null,
    column_id:   PROJ_B_PANEL.colId       || null,
    color:       PROJ_B_PANEL.color       || null,
    labels:      PROJ_B_PANEL.labels      || [],
    due_date:    PROJ_B_PANEL.dueDate     || null,
    project_id:  PROJ.boardProjectId,
  };

  const affectedCols = new Set();

  if (PROJ_B_PANEL.taskId) {
    const existing = PROJ.tasks.find(t => t.id === PROJ_B_PANEL.taskId);
    if (existing?.column_id) affectedCols.add(existing.column_id);
    if (payload.column_id)   affectedCols.add(payload.column_id);
    DB.update('fcc_tasks', PROJ_B_PANEL.taskId, payload);
  } else {
    const position = DB.getAll('fcc_tasks').filter(t => t.column_id === PROJ_B_PANEL.colId).length;
    DB.insert('fcc_tasks', { ...payload, position });
    if (payload.column_id) affectedCols.add(payload.column_id);
  }

  PROJ.tasks = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  projBCloseDetail();
  affectedCols.forEach(colId => { if (colId) projBRenderColumn(colId); });
  projShowToast('Task saved.');
}

function projBDeleteTask(taskId) {
  const task = PROJ.tasks.find(t => t.id === taskId);
  if (!task) return;

  document.getElementById('proj-modal-title').textContent = 'Delete task?';
  document.getElementById('proj-modal-msg').textContent   = `"${task.title || 'This task'}" will be permanently deleted.`;
  document.getElementById('proj-modal-overlay').style.display = 'flex';

  _projModalCb = () => {
    const colId = task.column_id;
    DB.delete('fcc_tasks', taskId);
    PROJ.tasks = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    projBCloseDetail();
    if (colId) projBRenderColumn(colId);
    projShowToast('Task deleted.');
  };
}

// ── Drag and Drop ─────────────────────────────────────────────

function projBCardDragStart(e, taskId, srcColId) {
  _projBDrag = { type: 'task', taskId, srcColId };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', taskId);
  setTimeout(() => {
    document.querySelector(`.tk-card[data-task-id="${taskId}"]`)?.classList.add('dragging');
  }, 0);
}

function projBCardDragEnd() {
  document.querySelectorAll('.tk-card.dragging').forEach(c => c.classList.remove('dragging'));
  document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());
  _projBDrag.type = null;
}

function projBCardDragOver(e, colId) {
  if (_projBDrag.type !== 'task') return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());
  const body  = document.getElementById(`projb-col-body-${colId}`);
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

function projBCardDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());
  }
}

function projBCardDrop(e, destColId) {
  e.preventDefault();
  if (_projBDrag.type !== 'task') return;
  const { taskId, srcColId } = _projBDrag;

  const body = document.getElementById(`projb-col-body-${destColId}`);
  let newPosition = 0;
  if (body) {
    const indicator = body.querySelector('.tk-drop-line');
    const allItems  = [...body.querySelectorAll('.tk-card, .tk-drop-line')];
    newPosition     = indicator ? allItems.indexOf(indicator) : allItems.length;
  }
  document.querySelectorAll('.tk-drop-line').forEach(l => l.remove());

  DB.update('fcc_tasks', taskId, { column_id: destColId, position: newPosition });
  projBReindexColumn(destColId);
  if (srcColId !== destColId) projBReindexColumn(srcColId);

  PROJ.tasks = DB.getAll('fcc_tasks').sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  projBRenderColumn(destColId);
  if (srcColId !== destColId) projBRenderColumn(srcColId);

  _projBDrag = { type: null, taskId: null, srcColId: null };
}

function projBReindexColumn(colId) {
  const tasks = DB.getAll('fcc_tasks')
    .filter(t => t.column_id === colId)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  tasks.forEach((t, i) => DB.update('fcc_tasks', t.id, { position: i }));
}

// ── Date Picker Popover ───────────────────────────────────────

function projDatePickerShow(anchorEl, currentValue, callback) {
  _dpCallback = callback;

  let dp = document.getElementById('proj-date-picker');
  if (!dp) {
    dp = document.createElement('div');
    dp.id = 'proj-date-picker';
    dp.className = 'proj-dp';
    document.body.appendChild(dp);
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const fmt   = d => d.toISOString().slice(0, 10);

  const tmr = new Date(today); tmr.setDate(today.getDate() + 1);

  const daysToSun = 7 - today.getDay() || 7;
  const thisSun   = new Date(today); thisSun.setDate(today.getDate() + daysToSun);

  const daysToMon = ((1 - today.getDay() + 7) % 7) || 7;
  const nextMon   = new Date(today); nextMon.setDate(today.getDate() + daysToMon);

  const [todayStr, tmrStr, thisSunStr, nextMonStr] = [today, tmr, thisSun, nextMon].map(fmt);

  dp.innerHTML = `
    <div class="proj-dp-pills">
      <button class="proj-dp-pill${currentValue === todayStr   ? ' active' : ''}" onclick="projDPPick('${todayStr}')">Today</button>
      <button class="proj-dp-pill${currentValue === tmrStr     ? ' active' : ''}" onclick="projDPPick('${tmrStr}')">Tomorrow</button>
      <button class="proj-dp-pill${currentValue === thisSunStr ? ' active' : ''}" onclick="projDPPick('${thisSunStr}')">This Sun</button>
      <button class="proj-dp-pill${currentValue === nextMonStr ? ' active' : ''}" onclick="projDPPick('${nextMonStr}')">Next Mon</button>
    </div>
    <input type="date" class="proj-dp-native" value="${currentValue || ''}" oninput="projDPPick(this.value)">
    ${currentValue ? '<button class="proj-dp-clear" onclick="projDPPick(null)">Clear date</button>' : ''}
  `;

  const rect = anchorEl.getBoundingClientRect();
  dp.style.top     = (rect.bottom + 6) + 'px';
  dp.style.left    = rect.left + 'px';
  dp.style.display = 'block';

  requestAnimationFrame(() => {
    const r = dp.getBoundingClientRect();
    if (r.right > window.innerWidth - 8)
      dp.style.left = Math.max(8, window.innerWidth - r.width - 8) + 'px';
    if (r.bottom > window.innerHeight - 8)
      dp.style.top = (rect.top - r.height - 6) + 'px';
  });
}

function projDPPick(val) {
  if (_dpCallback) _dpCallback(val || null);
  projDatePickerHide();
}

function projDatePickerHide() {
  const dp = document.getElementById('proj-date-picker');
  if (dp) dp.style.display = 'none';
  _dpCallback = null;
}

function projPickDate(anchorEl, id, field) {
  const project = PROJ.projects.find(p => p.id === id);
  if (!project) return;
  projDatePickerShow(anchorEl, project[field] || '', val => {
    const updated = DB.update('fcc_projects', id, { [field]: val });
    const idx     = PROJ.projects.findIndex(p => p.id === id);
    if (idx !== -1 && updated) PROJ.projects[idx] = updated;
    projShowToast('Saved');
    projRenderList();
    const p = PROJ.projects.find(p => p.id === id);
    if (p) projRenderDetail(p);
  });
}

function projToggleShootDay(id) {
  const project = PROJ.projects.find(p => p.id === id);
  if (!project) return;
  const newVal = !project.shoot_day;
  const updated = DB.update('fcc_projects', id, { shoot_day: newVal });
  const idx = PROJ.projects.findIndex(p => p.id === id);
  if (idx !== -1 && updated) PROJ.projects[idx] = updated;
  projRenderList();
  const p = PROJ.projects.find(p => p.id === id);
  if (p) projRenderDetail(p);
}

function projPickTaskDate(anchorEl) {
  projDatePickerShow(anchorEl, PROJ_B_PANEL.dueDate || '', val => {
    PROJ_B_PANEL.dueDate = val || '';
    const btn = document.getElementById('projb-detail-due-btn');
    if (btn) btn.innerHTML = val
      ? projFmtFieldDate(val)
      : '<span class="proj-empty-val">Pick a date…</span>';
  });
}

// ── Toast ─────────────────────────────────────────────────────

function projShowToast(msg) {
  const el = document.getElementById('proj-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('fi-toast--visible');
  clearTimeout(_projToastTimer);
  _projToastTimer = setTimeout(() => el.classList.remove('fi-toast--visible'), 2200);
}

// ── Utility ───────────────────────────────────────────────────

window.initProjects = initProjects;

function projEsc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
