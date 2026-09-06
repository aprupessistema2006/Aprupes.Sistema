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

  if (row.datums && row.izveidots && /^\d{4}-\d{2}-\d{2}/.test(String(row.izveidots)) && row.datums !== row.izveidots.substring(0, 10)) {
    row.datums = row.izveidots.substring(0, 10);
  }

  if (row.datums && row.pedeja_laiks && /^\d{4}-\d{2}-\d{2}/.test(String(row.pedeja_laiks)) && row.datums !== row.pedeja_laiks.substring(0, 10)) {
    row.datums = row.pedeja_laiks.substring(0, 10);
  }

  if (row.datums && row.pēdējais_laiks && /^\d{4}-\d{2}-\d{2}/.test(String(row.pēdējais_laiks)) && row.datums !== row.pēdējais_laiks.substring(0, 10)) {
    row.datums = row.pēdējais_laiks.substring(0, 10);
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
    pabeigtajs_id: 'pabeigtajsId',
    vārds: 'vards',
    uzvārds: 'uzvards',
    pin_kods: 'pin',
    parole: 'parole'
  };

  Object.keys(map).forEach(oldKey => {
    if (row[oldKey] !== undefined && row[map[oldKey]] === undefined) {
      row[map[oldKey]] = row[oldKey];
    }
  });

  if (row.clientId && !row.klientsId) row.klientsId = row.clientId;
  if (row.employeeId && !row.darbinieksId) row.darbinieksId = row.employeeId;

  if (!row.datums || row.datums === '0000-00-00') {
    const ts = String(row.id || '').match(/^[a-z]+_(\d+)/);
    if (ts) {
      const d = new Date(parseInt(ts[1], 10));
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        row.datums = y + '-' + m + '-' + day;
      }
    }
  }

  return row;
}

class SyncManager {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.syncing = false;
    this.loaded = false;
  }

  async loadInitialData() {
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

      return { offline: false, count: counts };
    } catch (err) {
      return { offline: true, error: err.message, count: {} };
    }
  }

  async enqueueChange(change) {
    if (!SYNC_URL) return;
    try {
      await fetch(SYNC_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(change)
      });
    } catch (e) {
      console.error('[sync] send failed', e);
    }
  }

  async getUnsyncedItems() {
    return [];
  }

  async getUnsyncedCount() {
    return 0;
  }

  async sync() {
    this.syncing = false;
  }

  async hasLocalData() {
    const darbinieki = await this.db.getAll('darbinieki');
    return darbinieki.length > 0;
  }

  async hasRemoteEmployees() {
    try {
      const url = SYNC_URL + '?action=load&t=' + Date.now();
      const response = await fetch(url);
      const data = await response.json();
      if (data.error) return false;
      return (data.darbinieki || []).length > 0;
    } catch (e) {
      return false;
    }
  }

  async createEmployee(data) {
    const response = await fetch(SYNC_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'createEmployee', data })
    });
    if (!response.ok) throw new Error('Neizdevās izveidot darbinieku');
    const result = await response.json();
    return result;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeRow, SyncManager };
}
if (typeof globalThis !== 'undefined') {
  globalThis.normalizeRow = normalizeRow;
  globalThis.SyncManager = SyncManager;
}
