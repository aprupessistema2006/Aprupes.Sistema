const SYNC_URL = typeof CONFIG !== 'undefined' ? CONFIG.GAS_URL : null;

function normalizeRow(raw) {
  if (!raw) return raw;
  const row = { ...raw };

  if ((!row.datums || /T\d{2}:\d{2}/.test(String(row.datums))) && row.izveidots) {
    const created = String(row.izveidots);
    if (/^\d{4}-\d{2}-\d{2}/.test(created)) {
      row.datums = created.substring(0, 10);
    }
  }

  if ((!row.datums || /T\d{2}:\d{2}/.test(String(row.datums))) && row.pedeja_laiks) {
    const lastMod = String(row.pedeja_laiks);
    if (/^\d{4}-\d{2}-\d{2}/.test(lastMod)) {
      row.datums = lastMod.substring(0, 10);
    }
  }

  if ((!row.datums || /T\d{2}:\d{2}/.test(String(row.datums))) && row.pēdējais_laiks) {
    const lastMod = String(row.pēdējais_laiks);
    if (/^\d{4}-\d{2}-\d{2}/.test(lastMod)) {
      row.datums = lastMod.substring(0, 10);
    }
  }

  const map = {
    datums: 'date',
    klients_id: 'clientId',
    darbinieks_id: 'employeeId',
    atzimes_id: 'markId',
    periods: 'shift',
    kategorija: 'category',
    lauka_nosaukums: 'field',
    vērtība: 'value',
    vertiba: 'value',
    pedeja_vertiba: 'lastValue',
    pedeja_laiks: 'lastModified',
    darbinieks_pedejais: 'lastBy',
    izveidots: 'created',
    laiks: 'time',
    papilgs_info: 'reason',
    piešķirt_darbiniekam_id: 'pieskirtDarbiniekamId',
    ir_pabeigts: 'irPabeigts',
    pabeigts_laiks: 'pabeigtsLaiks',
    pabeigtajs_id: 'pabeigtajsId'
  };

  Object.keys(map).forEach(oldKey => {
    if (row[oldKey] !== undefined && row[map[oldKey]] === undefined) {
      row[map[oldKey]] = row[oldKey];
    }
  });

  if (row.clientId && !row.klientsId) row.klientsId = row.clientId;
  if (row.employeeId && !row.darbinieksId) row.darbinieksId = row.employeeId;

  return row;
}

class SyncManager {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.pending = [];
    this.syncing = false;
    this.loaded = false;
  }

  async loadInitialData() {
    if (this.loaded) return { offline: false, count: {} };

    try {
      const url = SYNC_URL + '?action=load&t=' + Date.now();
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const stores = ['darbinieki', 'klienti', 'atzimes', 'atzimes_log', 'dienas_ierakti', 'uzdevomi'];
      const counts = {};

      for (const store of stores) {
        const items = (data[store] || []).map(normalizeRow);
        counts[store] = items.length;
        await this.db.clear(store);
        for (const item of items) {
          await this.db.put(store, item);
        }
      }

      await this.db.setMeta('lastSync', Date.now());
      this.loaded = true;

      return { offline: false, count: counts };
    } catch (err) {
      return { offline: true, error: err.message, count: {} };
    }
  }

  enqueueChange(change) {
    this.pending.push({
      ...change,
      _ts: Date.now()
    });
  }

  async getUnsyncedItems() {
    return this.pending;
  }

  async getUnsyncedCount() {
    return this.pending.length;
  }

  async sync() {
    if (this.syncing || !SYNC_URL || this.pending.length === 0) return;

    this.syncing = true;
    const items = [...this.pending];
    this.pending = [];

    try {
      for (const item of items) {
        const response = await fetch(SYNC_URL, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(item)
        });

        if (!response.ok) {
          throw new Error('Sync failed: ' + response.status);
        }
      }

      await this.db.setMeta('lastSync', Date.now());
    } catch (err) {
      this.pending = [...this.pending, ...items];
      throw err;
    } finally {
      this.syncing = false;
    }
  }

  async hasLocalData() {
    const darbinieki = await this.db.getAll('darbinieki');
    return darbinieki.length > 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeRow, SyncManager };
}
if (typeof globalThis !== 'undefined') {
  globalThis.normalizeRow = normalizeRow;
  globalThis.SyncManager = SyncManager;
}
