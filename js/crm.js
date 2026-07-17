const CRM = {
  tab: 'clients',
  selectedId: null,
  mode: null,
  search: '',
};

let _crmModalCallback = null;
let _crmToastTimer   = null;

const CRM_KEYS = {
  clients:       'fcc_clients',
  collaborators: 'fcc_collaborators',
};

// ── Init ──────────────────────────────────────────────────

function initCRM() {
  CRM.tab        = 'clients';
  CRM.selectedId = null;
  CRM.mode       = null;
  CRM.search     = '';

  const searchEl = document.getElementById('crm-search');
  if (searchEl) searchEl.value = '';

  crmSeedIfEmpty();
  crmSwitchTab('clients');
}

function crmSeedIfEmpty() {
  const today = new Date();
  const sub = d => { const dt = new Date(today); dt.setDate(dt.getDate() - d); return dt.toISOString().slice(0, 10); };
  const add = d => { const dt = new Date(today); dt.setDate(dt.getDate() + d); return dt.toISOString().slice(0, 10); };

  if (DB.getAll('fcc_clients').length === 0) {
    DB.insert('fcc_clients', { name: 'Sarah Chen', email: 'sarah@chenmedia.ca', phone: '604-555-0142', company: 'Chen Media', type: 'client', notes: 'Prefers communication via email. Interested in quarterly brand shoots.', last_contacted: sub(18), follow_up_date: add(5) });
    DB.insert('fcc_clients', { name: 'Mike Rodriguez', email: 'mike@elegantevents.ca', phone: '778-555-0287', company: 'Elegant Events', type: 'client', notes: 'Wedding season keeps him busy May–September. Best to book early.', last_contacted: sub(65), follow_up_date: sub(2) });
    DB.insert('fcc_clients', { name: 'Priya Kapoor', email: 'priya.kapoor@horizoncorp.com', phone: '604-555-0391', company: 'Horizon Corp', type: 'client', notes: 'Corporate headshots + annual report photography. Budget is generous.', last_contacted: sub(40), follow_up_date: add(14) });
    DB.insert('fcc_clients', { name: 'James Whitfield', email: 'j.whitfield@gmail.com', phone: '250-555-0088', company: '', type: 'client', notes: 'Personal family portrait client. Referred by Sarah Chen.', last_contacted: sub(8), follow_up_date: null });
  }

  if (DB.getAll('fcc_collaborators').length === 0) {
    DB.insert('fcc_collaborators', { name: 'Alex Thompson', email: 'alex.t.sound@gmail.com', phone: '604-555-0214', role: 'Sound Engineer', notes: 'Freelance. Works weekends. Has his own gear for small events.', last_contacted: sub(12), follow_up_date: null });
    DB.insert('fcc_collaborators', { name: 'Jordan Lee', email: 'jordanlee.photo@gmail.com', phone: '778-555-0365', role: 'Photo Assistant', notes: 'Available for day shoots. Learning second shooter role.', last_contacted: sub(35), follow_up_date: add(3) });
    DB.insert('fcc_collaborators', { name: 'Sam Wilson', email: 'sam@wilsondrones.ca', phone: '604-555-0502', role: 'Drone Operator', notes: 'Licensed AdvROC. Essential for landscape and real estate work.', last_contacted: sub(75), follow_up_date: sub(5) });
  }
}

// ── Warning helpers ───────────────────────────────────────

function crmGetWarningLevel(contact) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let isDanger  = false;
  let isWarning = false;

  if (contact.last_contacted) {
    const last     = new Date(contact.last_contacted + 'T00:00:00');
    const daysSince = Math.floor((today - last) / 864e5);
    if (daysSince > 60) isDanger  = true;
    else if (daysSince > 30) isWarning = true;
  }

  if (contact.follow_up_date) {
    const followUp  = new Date(contact.follow_up_date + 'T00:00:00');
    const daysUntil = Math.floor((followUp - today) / 864e5);
    if (daysUntil <= 0)      isDanger  = true;
    else if (daysUntil <= 7) isWarning = true;
  }

  if (isDanger)  return 'danger';
  if (isWarning) return 'warning';
  return 'ok';
}

function crmWarnSort(level) {
  return level === 'danger' ? 0 : level === 'warning' ? 1 : 2;
}

// ── Tab switching ─────────────────────────────────────────

function crmSwitchTab(tab) {
  CRM.tab        = tab;
  CRM.selectedId = null;
  CRM.mode       = null;

  document.getElementById('crm-tab-clients')?.classList.toggle('active', tab === 'clients');
  document.getElementById('crm-tab-collaborators')?.classList.toggle('active', tab === 'collaborators');

  const newBtn = document.getElementById('crm-new-btn');
  if (newBtn) newBtn.textContent = tab === 'clients' ? '+ New Client' : '+ New Collaborator';

  crmRenderList();
  crmShowEmpty();
}

// ── List ──────────────────────────────────────────────────

function crmGetFilteredSorted() {
  const q   = CRM.search.toLowerCase().trim();
  const all = DB.getAll(CRM_KEYS[CRM.tab]);

  const filtered = q ? all.filter(c =>
    (c.name    || '').toLowerCase().includes(q) ||
    (c.email   || '').toLowerCase().includes(q) ||
    (c.company || '').toLowerCase().includes(q) ||
    (c.role    || '').toLowerCase().includes(q)
  ) : all;

  return filtered.sort((a, b) => {
    const diff = crmWarnSort(crmGetWarningLevel(a)) - crmWarnSort(crmGetWarningLevel(b));
    return diff !== 0 ? diff : (a.name || '').localeCompare(b.name || '');
  });
}

function crmRenderList() {
  const list = document.getElementById('crm-list');
  if (!list) return;

  const contacts = crmGetFilteredSorted();

  if (contacts.length === 0) {
    const q   = CRM.search.trim();
    const all = DB.getAll(CRM_KEYS[CRM.tab]);
    const noun = CRM.tab === 'clients' ? 'client' : 'collaborator';

    if (all.length === 0) {
      list.innerHTML = `<div class="crm-empty-state">
        <p>No ${noun}s yet.</p>
        <button class="btn-primary" onclick="crmOpenNew()">+ Add ${CRM.tab === 'clients' ? 'Client' : 'Collaborator'}</button>
      </div>`;
    } else {
      list.innerHTML = `<div class="crm-empty-state"><p>No contacts match "${crmEsc(q)}"</p></div>`;
    }
    return;
  }

  list.innerHTML = contacts.map(c => {
    const level    = crmGetWarningLevel(c);
    const subtitle = CRM.tab === 'clients' ? (c.company || '') : (c.role || '');
    const selected = c.id === CRM.selectedId ? ' crm-selected' : '';
    return `<div class="crm-contact-card crm-warn-${level}${selected}" onclick="crmSelectContact('${c.id}')">
      <div class="crm-card-name">${crmEsc(c.name || 'Unnamed')}</div>
      ${subtitle ? `<div class="crm-card-sub">${crmEsc(subtitle)}</div>` : ''}
    </div>`;
  }).join('');
}

function crmFilterList() {
  CRM.search = document.getElementById('crm-search')?.value || '';
  crmRenderList();
}

// ── Detail panel ──────────────────────────────────────────

function crmShowEmpty() {
  const empty   = document.getElementById('crm-detail-empty');
  const content = document.getElementById('crm-detail-content');
  if (empty)   empty.style.display   = '';
  if (content) content.style.display = 'none';
  document.getElementById('crm-list-panel')?.classList.remove('crm-detail-open');
}

function crmSelectContact(id) {
  CRM.selectedId = id;
  CRM.mode       = null;
  crmRenderList();

  const contact = DB.getById(CRM_KEYS[CRM.tab], id);
  if (!contact) return;

  crmRenderDetail(contact);
  document.getElementById('crm-list-panel')?.classList.add('crm-detail-open');
}

function crmRenderDetail(contact) {
  const empty   = document.getElementById('crm-detail-empty');
  const content = document.getElementById('crm-detail-content');
  if (!empty || !content) return;

  empty.style.display   = 'none';
  content.style.display = '';

  const level     = crmGetWarningLevel(contact);
  const warnLabel = level === 'danger' ? 'Follow up overdue' : 'Follow up soon';
  const warnBadge = level !== 'ok'
    ? `<span class="crm-warn-badge crm-warn-badge--${level}">${warnLabel}</span>`
    : '';

  const isClient = CRM.tab === 'clients';
  const fields   = isClient
    ? [
        { key: 'email',          label: 'Email',          type: 'email' },
        { key: 'phone',          label: 'Phone',          type: 'tel'   },
        { key: 'company',        label: 'Company',        type: 'text'  },
        { key: 'last_contacted', label: 'Last Contacted', type: 'date'  },
        { key: 'follow_up_date', label: 'Follow-up Date', type: 'date'  },
      ]
    : [
        { key: 'email',          label: 'Email',           type: 'email' },
        { key: 'phone',          label: 'Phone',           type: 'tel'   },
        { key: 'role',           label: 'Role / Specialty',type: 'text'  },
        { key: 'last_contacted', label: 'Last Contacted',  type: 'date'  },
        { key: 'follow_up_date', label: 'Follow-up Date',  type: 'date'  },
      ];

  const fieldRowsHtml = `<div class="crm-field-group">
    ${fields.map(f => {
      const val = contact[f.key] || '';
      return `<div class="field-row" onclick="crmEditField('${contact.id}','${f.key}','${f.type}',this)">
        <span class="field-row__label">${f.label}</span>
        <div class="field-row__right">
          <span class="field-row__value crm-field-val" data-field="${f.key}">${crmFmtVal(f.key, val)}</span>
          <span class="field-row__chevron"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></span>
        </div>
      </div>`;
    }).join('')}
  </div>`;

  content.innerHTML = `
    <div class="crm-detail-header">
      <div class="crm-detail-name-row">
        <h2 class="crm-detail-name" onclick="crmEditName('${contact.id}',this)">${crmEsc(contact.name || 'Unnamed')}</h2>
        ${warnBadge}
      </div>
      <button class="crm-back-btn" onclick="crmShowEmpty()">← Back</button>
    </div>
    <div class="crm-detail-body">
      ${fieldRowsHtml}
      <div class="crm-notes-wrap">
        <label class="crm-section-label">Notes</label>
        <textarea class="crm-notes-textarea" placeholder="Add notes…" onblur="crmSaveNotes('${contact.id}',this.value)">${crmEsc(contact.notes || '')}</textarea>
      </div>
      ${crmLinkedProjectsHtml(contact.id)}
      <div class="crm-detail-footer">
        <button class="btn-danger" onclick="crmConfirmDelete('${contact.id}')">Delete Contact</button>
      </div>
    </div>`;
}

function crmFmtVal(key, val) {
  if (!val) return '<span class="crm-empty-val">—</span>';
  if (key === 'last_contacted' || key === 'follow_up_date') {
    const d = new Date(val + 'T00:00:00');
    return crmEsc(d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }));
  }
  return crmEsc(val);
}

function crmLinkedProjectsHtml(contactId) {
  const jKey   = CRM.tab === 'clients' ? 'fcc_project_clients'       : 'fcc_project_collaborators';
  const fKey   = CRM.tab === 'clients' ? 'client_id'                 : 'collaborator_id';
  const jrows  = DB.junctionGet(jKey, fKey, contactId);
  const linked = DB.getAll('fcc_projects').filter(p => jrows.some(j => j.project_id === p.id));

  if (linked.length === 0) {
    return `<div class="crm-linked-projects">
      <div class="crm-section-label">Linked Projects</div>
      <p class="crm-empty-text">No projects linked yet.</p>
    </div>`;
  }

  return `<div class="crm-linked-projects">
    <div class="crm-section-label">Linked Projects</div>
    <div class="crm-project-chips">
      ${linked.map(p => `<div class="crm-project-chip">
        <span>${crmEsc(p.name || p.title || 'Unnamed Project')}</span>
        ${p.status ? `<span class="badge">${crmEsc(p.status)}</span>` : ''}
      </div>`).join('')}
    </div>
  </div>`;
}

// ── Inline editing ────────────────────────────────────────

function crmEditField(id, field, type, rowEl) {
  if (rowEl.querySelector('input, select')) return;

  const contact = DB.getById(CRM_KEYS[CRM.tab], id);
  if (!contact) return;

  const valEl   = rowEl.querySelector('.crm-field-val');
  const chevron = rowEl.querySelector('.field-row__chevron');
  if (!valEl) return;

  const input = document.createElement('input');
  input.type      = type;
  input.value     = contact[field] || '';
  input.className = 'crm-inline-input';
  valEl.replaceWith(input);
  if (chevron) chevron.style.visibility = 'hidden';
  rowEl.onclick = null;
  input.focus();
  if (type !== 'date') input.select();

  function commit() {
    const newVal = input.value.trim() || null;
    DB.update(CRM_KEYS[CRM.tab], id, { [field]: newVal });

    const newSpan = document.createElement('span');
    newSpan.className         = 'field-row__value crm-field-val';
    newSpan.setAttribute('data-field', field);
    newSpan.innerHTML         = crmFmtVal(field, newVal || '');
    input.replaceWith(newSpan);
    if (chevron) chevron.style.visibility = '';
    rowEl.onclick = () => crmEditField(id, field, type, rowEl);

    // Refresh warning badge if a date field changed
    if (field === 'last_contacted' || field === 'follow_up_date') {
      const updated  = DB.getById(CRM_KEYS[CRM.tab], id);
      const level    = crmGetWarningLevel(updated);
      const nameRow  = document.querySelector('.crm-detail-name-row');
      if (nameRow) {
        nameRow.querySelector('.crm-warn-badge')?.remove();
        if (level !== 'ok') {
          const badge      = document.createElement('span');
          badge.className  = `crm-warn-badge crm-warn-badge--${level}`;
          badge.textContent = level === 'danger' ? 'Follow up overdue' : 'Follow up soon';
          nameRow.appendChild(badge);
        }
      }
      crmRenderList();
    }

    crmShowToast('Saved');
  }

  input.addEventListener('blur',    commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.blur(); }
  });
}

function crmEditName(id, nameEl) {
  if (nameEl.querySelector('input')) return;
  const contact = DB.getById(CRM_KEYS[CRM.tab], id);
  if (!contact) return;

  const input   = document.createElement('input');
  input.type    = 'text';
  input.value   = contact.name || '';
  input.className = 'crm-name-input';
  nameEl.textContent = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();
  nameEl.onclick = null;

  function commit() {
    const newName = input.value.trim() || contact.name || 'Unnamed';
    DB.update(CRM_KEYS[CRM.tab], id, { name: newName });
    nameEl.textContent = newName;
    nameEl.onclick = () => crmEditName(id, nameEl);
    crmRenderList();
    crmShowToast('Saved');
  }

  input.addEventListener('blur',    commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { nameEl.textContent = contact.name || 'Unnamed'; nameEl.onclick = () => crmEditName(id, nameEl); }
  });
}

function crmSaveNotes(id, value) {
  DB.update(CRM_KEYS[CRM.tab], id, { notes: value });
  crmShowToast('Notes saved');
}

// ── New contact ───────────────────────────────────────────

function crmOpenNew() {
  CRM.selectedId = null;
  CRM.mode       = 'new';
  crmRenderList();

  const empty   = document.getElementById('crm-detail-empty');
  const content = document.getElementById('crm-detail-content');
  if (!empty || !content) return;
  empty.style.display   = 'none';
  content.style.display = '';

  const isClient = CRM.tab === 'clients';
  const label    = isClient ? 'Client' : 'Collaborator';

  const fields = isClient
    ? [
        { key: 'name',           label: 'Name',           type: 'text',  required: true },
        { key: 'email',          label: 'Email',          type: 'email'  },
        { key: 'phone',          label: 'Phone',          type: 'tel'    },
        { key: 'company',        label: 'Company',        type: 'text'   },
        { key: 'last_contacted', label: 'Last Contacted', type: 'date'   },
        { key: 'follow_up_date', label: 'Follow-up Date', type: 'date'   },
      ]
    : [
        { key: 'name',           label: 'Name',            type: 'text',  required: true },
        { key: 'email',          label: 'Email',           type: 'email'  },
        { key: 'phone',          label: 'Phone',           type: 'tel'    },
        { key: 'role',           label: 'Role / Specialty',type: 'text'   },
        { key: 'last_contacted', label: 'Last Contacted',  type: 'date'   },
        { key: 'follow_up_date', label: 'Follow-up Date',  type: 'date'   },
      ];

  content.innerHTML = `
    <div class="crm-detail-header">
      <div class="crm-detail-name-row">
        <h2 class="crm-detail-name" style="cursor:default">New ${label}</h2>
      </div>
      <button class="crm-back-btn" onclick="crmShowEmpty()">← Back</button>
    </div>
    <div class="crm-detail-body">
      <form id="crm-new-form" onsubmit="crmCreateContact(event)">
        <div class="crm-new-fields">
          ${fields.map(f => `<div class="crm-new-field">
            <label class="crm-section-label">${f.label}${f.required ? ' *' : ''}</label>
            <input type="${f.type}" name="${f.key}" class="crm-new-input" ${f.required ? 'placeholder="Required"' : ''}>
          </div>`).join('')}
        </div>
        <div class="crm-notes-wrap">
          <label class="crm-section-label">Notes</label>
          <textarea name="notes" class="crm-notes-textarea" placeholder="Add notes…"></textarea>
        </div>
        <div class="crm-detail-footer">
          <button type="submit" class="btn-primary">Create ${label}</button>
          <button type="button" class="btn-ghost" onclick="crmShowEmpty()">Cancel</button>
        </div>
      </form>
    </div>`;

  content.querySelector('input[name="name"]')?.focus();
  document.getElementById('crm-list-panel')?.classList.add('crm-detail-open');
}

function crmCreateContact(e) {
  e.preventDefault();
  try {
    const form = document.getElementById('crm-new-form');
    if (!form) return;

    const raw  = Object.fromEntries(new FormData(form));
    const data = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.trim() || null]));

    if (!data.name) {
      crmShowToast('Name is required');
      form.querySelector('input[name="name"]')?.focus();
      return;
    }

    if (CRM.tab === 'clients') data.type = 'client';

    const created  = DB.insert(CRM_KEYS[CRM.tab], data);
    CRM.mode       = null;
    CRM.selectedId = created.id;

    crmRenderList();
    crmRenderDetail(created);
    crmShowToast(`${CRM.tab === 'clients' ? 'Client' : 'Collaborator'} created`);
  } catch(err) {
    console.error('crmCreateContact failed:', err);
    crmShowToast('Error: ' + err.message);
  }
}

// ── Delete ────────────────────────────────────────────────

function crmConfirmDelete(id) {
  const contact = DB.getById(CRM_KEYS[CRM.tab], id);
  if (!contact) return;

  document.getElementById('crm-modal-title').textContent = 'Delete Contact';
  document.getElementById('crm-modal-msg').textContent   =
    `Delete "${contact.name || 'this contact'}"? This cannot be undone.`;
  document.getElementById('crm-modal-overlay').style.display = 'flex';

  _crmModalCallback = () => {
    DB.delete(CRM_KEYS[CRM.tab], id);
    const jKey = CRM.tab === 'clients' ? 'fcc_project_clients'  : 'fcc_project_collaborators';
    const fKey = CRM.tab === 'clients' ? 'client_id'            : 'collaborator_id';
    DB.junctionGet(jKey, fKey, id).forEach(row => DB.junctionRemove(jKey, row));

    CRM.selectedId = null;
    crmRenderList();
    crmShowEmpty();
    crmShowToast('Contact deleted');
  };
}

function crmModalCancel() {
  document.getElementById('crm-modal-overlay').style.display = 'none';
  _crmModalCallback = null;
}

function crmModalConfirm() {
  document.getElementById('crm-modal-overlay').style.display = 'none';
  if (_crmModalCallback) { _crmModalCallback(); _crmModalCallback = null; }
}

// ── Toast ─────────────────────────────────────────────────

function crmShowToast(msg) {
  const el = document.getElementById('crm-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('fi-toast--visible');
  clearTimeout(_crmToastTimer);
  _crmToastTimer = setTimeout(() => el.classList.remove('fi-toast--visible'), 2200);
}

// ── Utility ───────────────────────────────────────────────

// Router calls initCrm() (title-case) — alias to the canonical name
const initCrm = initCRM;

function crmEsc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
