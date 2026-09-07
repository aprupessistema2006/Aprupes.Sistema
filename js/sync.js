const SYNC_URL = typeof CONFIG !== 'undefined' ? CONFIG.GAS_URL : null;

function normalizeKey(h) {
  return String(h)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ /g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

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
    date: 'date',
    datums: 'date',
    clientId: 'clientId',
    clientid: 'clientId',
    klientsId: 'clientId',
    klients_id: 'clientId',
    employeeId: 'employeeId',
    employeeid: 'employeeId',
    darbinieksId: 'employeeId',
    darbinieks_id: 'employeeId',
    markId: 'markId',
    markid: 'markId',
    atzimesId: 'markId',
    atzimes_id: 'markId',
    shift: 'shift',
    periods: 'shift',
    category: 'category',
    kategorija: 'category',
    field: 'field',
    lauka_nosaukums: 'field',
    value: 'value',
    vertiba: 'value',
    vertiba2: 'value',
    lastValue: 'lastValue',
    pedejaVertiba: 'lastValue',
    pedeja_vertiba: 'lastValue',
    lastModified: 'lastModified',
    pedejaLaiks: 'lastModified',
    pedeja_laiks: 'lastModified',
    pedejaisLaiks: 'lastModified',
    pedejais_laiks: 'lastModified',
    lastBy: 'lastBy',
    darbinieksPedejais: 'lastBy',
    darbinieks_pedejais: 'lastBy',
    created: 'created',
    izveidots: 'created',
    time: 'time',
    laiks: 'time',
    reason: 'reason',
    papilgsInfo: 'reason',
    papilgs_info: 'reason',
    pieskirtDarbiniekamId: 'pieskirtDarbiniekamId',
    pieskirt_darbiniekam_id: 'pieskirtDarbiniekamId',
    irPabeigts: 'irPabeigts',
    ir_pabeigts: 'irPabeigts',
    pabeigts: 'irPabeigts',
    pabeigt: 'irPabeigts',
    pabeigtsLaiks: 'pabeigtsLaiks',
    pabeigts_laiks: 'pabeigtsLaiks',
    pabeigtajsId: 'pabeigtajsId',
    pabeigtajs_id: 'pabeigtajsId',
    vards: 'vards',
    uzvards: 'uzvards',
    pin: 'pin',
    pinKods: 'pin',
    pin_kods: 'pin',
    parole: 'parole'
  };

  const normalizedRow = {};
  Object.keys(row).forEach(k => {
    const nk = normalizeKey(k);
    if (map[nk]) {
      if (normalizedRow[map[nk]] === undefined) normalizedRow[map[nk]] = row[k];
    } else {
      normalizedRow[k] = row[k];
    }
  });

  if (row.id) normalizedRow.id = row.id;

  const idTs = String(normalizedRow.id || '').match(/^[a-z]+_(\d+)/);
  if (idTs) {
    const d = new Date(parseInt(idTs[1], 10));
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      normalizedRow.date = y + '-' + m + '-' + day;
    }
  }

  if (normalizedRow.clientId && !normalizedRow.klientsId) normalizedRow.klientsId = normalizedRow.clientId;
  if (normalizedRow.employeeId && !normalizedRow.darbinieksId) normalizedRow.darbinieksId = normalizedRow.employeeId;

  return normalizedRow;
}

class SyncManager {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.syncing = false;
    this.loaded = false;
  }

  async loadInitialData(onProgress) {
    onProgress = onProgress || function() {};
    try {
      onProgress('Ielādēju datus no servera...');
      const url = SYNC_URL + '?action=load&t=' + Date.now();
      const response = await fetch(url);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const criticalStores = ['darbinieki', 'klienti'];
      const otherStores = ['atzimes', 'atzimes_log', 'dienas_ierakti', 'uzdevomi'];
      const counts = {};

      onProgress('Saglabāju darbiniekus un klientus...');
      for (const store of criticalStores) {
        const items = (data[store] || []).map(normalizeRow);
        counts[store] = items.length;
        await this.db.clear(store);
        for (const item of items) {
          await this.db.put(store, item);
        }
      }

      onProgress('Saglabāju atzīmes un uzdevumus...');
      for (const store of otherStores) {
        const items = (data[store] || []).map(normalizeRow);
        counts[store] = items.length;
        await this.db.clear(store);
        for (const item of items) {
          await this.db.put(store, item);
        }
      }

      await this.db.setMeta('lastSync', Date.now());
      onProgress('✓ Dati veiksmīgi ielādēti');
      return { offline: false, count: counts };
    } catch (err) {
      onProgress('⚠️ Neizdevās ielādēt datus: ' + err.message);
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
