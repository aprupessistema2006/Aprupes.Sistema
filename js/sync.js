const SYNC_URL = typeof CONFIG !== 'undefined' ? CONFIG.GAS_URL : null;

async function fetchWithTimeout(url, timeout = 8000, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

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
    this._queueProcessing = false;
    this._queueTimer = null;
    this._loading = false;
    this._setupOfflineDetection();
  }

  _setupOfflineDetection() {
    const updateStatus = () => {
      this._updateSyncStatus(navigator.onLine ? 'Saglabāts' : 'Bezsaistē');
    };
    updateStatus();
    window.addEventListener('online', () => {
      updateStatus();
      this._scheduleQueueProcessing();
    });
    window.addEventListener('offline', updateStatus);
  }

  _updateSyncStatus(status) {
    try {
      const event = new CustomEvent('syncStatusChange', { detail: status });
      window.dispatchEvent(event);
    } catch (e) {}
  }

  async loadInitialData(onProgress) {
    if (this._loading) {
      return { offline: true, error: 'Sinhronizācija jau notiek', count: {} };
    }
    this._loading = true;
    this._updateSyncStatus('Sinhronizē...');
    onProgress = onProgress || function() {};
    try {
      onProgress('Ielādēju datus no servera...');
      const url = SYNC_URL + '?action=load&t=' + Date.now();
      const response = await fetchWithTimeout(url, 10000);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const criticalStores = ['darbinieki', 'klienti'];
      const otherStores = ['atzimes', 'atzimes_log', 'uzdevomi'];
      const counts = {};

      onProgress('Saglabāju darbiniekus un klientus...');
      for (const store of criticalStores) {
        const items = (data[store] || []).map(normalizeRow);
        counts[store] = items.length;
        if (items.length > 0) {
          await this.db.batchPut(store, items);
        }
      }

      onProgress('Saglabāju atzīmes un uzdevumus...');
      for (const store of otherStores) {
        const items = (data[store] || []).map(normalizeRow);
        counts[store] = items.length;
        if (items.length > 0) {
          await this.db.batchPut(store, items);
        }
      }

      await this.db.setMeta('lastSync', Date.now());
      this._updateSyncStatus('Saglabāts');
      onProgress('✓ Dati veiksmīgi ielādēti');
      return { offline: false, count: counts };
    } catch (err) {
      this._updateSyncStatus('Bezsaistē');
      onProgress('⚠️ Neizdevās ielādēt datus: ' + err.message);
      return { offline: true, error: err.message, count: {} };
    } finally {
      this._loading = false;
    }
  }

  async enqueueChange(change) {
    if (!SYNC_URL) return;
    const queueItem = {
      id: this.db.generateId(),
      change: change,
      timestamp: Date.now(),
      retries: 0,
      lastError: null
    };
    await this.db.add('sync_queue', queueItem);
    this._scheduleQueueProcessing();
  }

  _scheduleQueueProcessing() {
    if (this._queueTimer) return;
    this._queueTimer = setTimeout(() => {
      this._queueTimer = null;
      this.processQueue();
    }, 500);
  }

  async processQueue() {
    if (this._queueProcessing || !SYNC_URL) return;
    this._queueProcessing = true;
    this._updateSyncStatus('Sinhronizē...');
    try {
      const items = await this.db.getAll('sync_queue');
      if (items.length === 0) {
        this._updateSyncStatus('Saglabāts');
        return;
      }

      const sorted = items.sort((a, b) => a.timestamp - b.timestamp);
      for (const item of sorted) {
        try {
          const response = await fetchWithTimeout(SYNC_URL, 8000, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(item.change)
          });
          if (response.ok) {
            await this.db.delete('sync_queue', item.id);
          } else {
            item.retries++;
            item.lastError = 'HTTP ' + response.status;
            await this.db.put('sync_queue', item);
          }
        } catch (e) {
          item.retries++;
          item.lastError = e.message;
          await this.db.put('sync_queue', item);
        }
      }
      const remaining = await this.db.getAll('sync_queue');
      this._updateSyncStatus(remaining.length === 0 ? 'Saglabāts' : 'Gaida nosūtīšanu');
    } finally {
      this._queueProcessing = false;
    }
  }

  async getUnsyncedItems() {
    const items = await this.db.getAll('sync_queue');
    return items.map(i => i.change);
  }

  async getUnsyncedCount() {
    const items = await this.db.getAll('sync_queue');
    return items.length;
  }

  async sync() {
    await this.processQueue();
  }

  async hasLocalData() {
    try {
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve(false), 5000);
      });
      const dbPromise = this.db.getAll('darbinieki');
      const darbinieki = await Promise.race([dbPromise, timeoutPromise]);
      return darbinieki && darbinieki.length > 0;
    } catch (e) {
      return false;
    }
  }

  async hasRemoteEmployees() {
    try {
      const url = SYNC_URL + '?action=load&t=' + Date.now();
      const response = await fetchWithTimeout(url, 5000);
      if (!response || !response.ok) return false;
      const data = await response.json();
      if (data.error) return false;
      return (data.darbinieki || []).length > 0;
    } catch (e) {
      return false;
    }
  }

  async createEmployee(data) {
    const response = await fetchWithTimeout(SYNC_URL, 8000, {
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
