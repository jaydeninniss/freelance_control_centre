// Data access layer — currently backed by localStorage.
// To migrate to PHP/MySQL: replace each method body with a fetch() call
// to the corresponding PHP endpoint. All section JS stays the same.

const DB = {

  // ── Core helpers ──────────────────────────────────────────
  _get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  },
  _set(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) { console.error('DB write failed', e); }
  },
  _uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback for non-secure contexts (file://)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },
  _now() {
    return new Date().toISOString();
  },

  // ── Generic collection methods ────────────────────────────
  getAll(key) {
    return this._get(key);
  },

  getById(key, id) {
    return this._get(key).find(r => r.id === id) || null;
  },

  insert(key, record) {
    const rows = this._get(key);
    const newRecord = { ...record, id: this._uuid(), created_at: this._now() };
    rows.push(newRecord);
    this._set(key, rows);
    return newRecord;
  },

  update(key, id, changes) {
    const rows = this._get(key);
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) return null;
    rows[idx] = { ...rows[idx], ...changes, updated_at: this._now() };
    this._set(key, rows);
    return rows[idx];
  },

  delete(key, id) {
    const rows = this._get(key);
    const filtered = rows.filter(r => r.id !== id);
    this._set(key, filtered);
    return filtered.length < rows.length;
  },

  // ── Junction table helpers ────────────────────────────────
  junctionGet(key, filterKey, filterVal) {
    return this._get(key).filter(r => r[filterKey] === filterVal);
  },

  junctionAdd(key, record) {
    const rows = this._get(key);
    const exists = rows.some(r =>
      Object.keys(record).every(k => r[k] === record[k])
    );
    if (!exists) { rows.push(record); this._set(key, rows); }
  },

  junctionRemove(key, record) {
    const rows = this._get(key).filter(r =>
      !Object.keys(record).every(k => r[k] === record[k])
    );
    this._set(key, rows);
  },

};
