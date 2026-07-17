// Data access layer.
// Reads are synchronous (localStorage cache).
// Writes go to localStorage immediately AND fire a background fetch to PHP.
// On section init, call await DB.hydrate([keys]) to pull fresh data from PHP.
// To migrate reads to PHP too: make getAll/getById async and remove localStorage.

const DB = {

  _api: 'api/db.php',

  // ── Core localStorage helpers ─────────────────────────────
  _get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  },
  _set(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) { console.error('DB local write failed', e); }
  },
  _uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },
  _now() {
    return new Date().toISOString();
  },

  // ── PHP sync ──────────────────────────────────────────────
  async _php(payload) {
    try {
      const res  = await fetch(this._api, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) console.warn('DB PHP error:', json.error, payload);
      return json.success ? json.data : null;
    } catch(e) {
      console.warn('DB PHP unreachable:', e.message);
      return null;
    }
  },

  // Fire-and-forget background write to PHP (non-blocking)
  _phpWrite(payload) {
    this._php(payload).catch(() => {});
  },

  // Pull fresh data from PHP and overwrite localStorage cache.
  // Call this at the top of each section's init function.
  async hydrate(keys) {
    for (const key of keys) {
      const data = await this._php({ action: 'getAll', key });
      if (Array.isArray(data)) this._set(key, data);
    }
  },

  // ── Generic collection methods (sync reads, dual writes) ──
  getAll(key) {
    return this._get(key);
  },

  getById(key, id) {
    return this._get(key).find(r => r.id === id) || null;
  },

  insert(key, record) {
    const rows      = this._get(key);
    const newRecord = { ...record, id: this._uuid(), created_at: this._now() };
    rows.push(newRecord);
    this._set(key, rows);
    this._phpWrite({ action: 'insert', key, record: newRecord });
    return newRecord;
  },

  update(key, id, changes) {
    const rows = this._get(key);
    const idx  = rows.findIndex(r => r.id === id);
    if (idx === -1) return null;
    rows[idx] = { ...rows[idx], ...changes, updated_at: this._now() };
    this._set(key, rows);
    this._phpWrite({ action: 'update', key, id, changes });
    return rows[idx];
  },

  delete(key, id) {
    const rows     = this._get(key);
    const filtered = rows.filter(r => r.id !== id);
    this._set(key, filtered);
    this._phpWrite({ action: 'delete', key, id });
    return filtered.length < rows.length;
  },

  // ── Junction table helpers ────────────────────────────────
  junctionGet(key, filterKey, filterVal) {
    return this._get(key).filter(r => r[filterKey] === filterVal);
  },

  junctionAdd(key, record) {
    const rows   = this._get(key);
    const exists = rows.some(r => Object.keys(record).every(k => r[k] === record[k]));
    if (!exists) {
      rows.push(record);
      this._set(key, rows);
      this._phpWrite({ action: 'junctionAdd', key, record });
    }
  },

  junctionRemove(key, record) {
    const rows = this._get(key).filter(r =>
      !Object.keys(record).every(k => r[k] === record[k])
    );
    this._set(key, rows);
    this._phpWrite({ action: 'junctionRemove', key, record });
  },

};
