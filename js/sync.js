const FIELD_ALIASES = {
  'vārds': 'vards',
  'uzvārds': 'uzvards',
  'loma': 'loma',
  'pin_kods': 'pin',
  'aktīvs': 'aktivs',
  'dzimšanas_datums': 'dzimis',
  'diēta': 'dieta',
  'saskarsmes_īpatnības': 'saskarsmes',
  'parole': 'parole',
  'id': 'id',
  'klients_id': 'klientsId',
  'darbinieks_id': 'employeeId',
  'datums': 'date',
  'periods': 'shift',
  'kategorija': 'category',
  'lauka_nosaukums': 'field',
  'vērtība': 'value',
  'pēdējā_vērtība': 'lastValue',
  'pēdējais_laiks': 'lastModified',
  'darbinieks_pēdējais': 'lastBy',
  'atzīmes_id': 'markId',
  'laiks': 'time',
  'papildus_info': 'reason',
  'izveidots': 'created',
  'teksts': 'teksts',
  'termiņš': 'termins',
  'prioritāte': 'prioritate',
  'statuss': 'status',
  'pabeigts': 'completed',
  'labotājs_id': 'editorId',
  '24h': 'h24',
  'skaits': 'count',
  'piešķirt_darbiniekam_id': 'pieskirtDarbiniekamId',
  'termiņš': 'termins',
  'prioritāte': 'prioritate',
  'ir_pabeigts': 'irPabeigts',
  'izveidotājs_id': 'izveidotajsId',
  'pabeigts_laiks': 'pabeigtsLaiks',
  'pabeigtājs_id': 'pabeigtajsId'
};

function normalizeDate(v) {
  if (!v) return '';
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return '';
    // Ja datums jau satur YYYY-MM-DD, uzreiz izņemam pirmos 10 simbolus (novērš jebkādu datumu bojāšanu)
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.substring(0, 10);
    }
  }
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return '';
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
      const parts = s.split('.');
      return parts[2] + '-' + parts[1] + '-' + parts[0];
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const parts = s.split('/');
      return parts[2] + '-' + parts[0] + '-' + parts[1];
    }
    if (/^\d{4}\.\d{1,2}\.\d{1,2}/.test(s)) {
      const parts = s.split('.');
      const y = parts[0];
      const p1 = parseInt(parts[1], 10);
      const p2 = parseInt(parts[2].split(/[\s.T]/)[0], 10);
      if (p1 >= 1 && p1 <= 31 && p2 >= 1 && p2 <= 12) {
        return y + '-' + String(p2).padStart(2, '0') + '-' + String(p1).padStart(2, '0');
      }
      if (p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 31) {
        return y + '-' + String(p1).padStart(2, '0') + '-' + String(p2).padStart(2, '0');
      }
      return y + '-' + String(p1).padStart(2, '0') + '-' + String(p2).padStart(2, '0');
    }
  }
  return v;
}

function repairDateString(dateStr, refDateStr) {
  if (!dateStr || dateStr.length < 10) {
    if (!refDateStr || refDateStr.length < 10) return dateStr || '';
    const refParts = refDateStr.substring(0, 10).split('-');
    if (refParts.length === 3) return refParts[0] + '-' + refParts[1] + '-' + refParts[2];
    return dateStr || '';
  }
  const dateParts = dateStr.substring(0, 10).split('-');
  if (dateParts.length !== 3) {
    if (!refDateStr || refDateStr.length < 10) return dateStr;
    const refParts = refDateStr.substring(0, 10).split('-');
    if (refParts.length === 3) return refParts[0] + '-' + refParts[1] + '-' + refParts[2];
    return dateStr;
  }

  const year = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10);
  const day = parseInt(dateParts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    if (!refDateStr || refDateStr.length < 10) return dateStr;
    const refParts = refDateStr.substring(0, 10).split('-');
    if (refParts.length === 3) return refParts[0] + '-' + refParts[1] + '-' + refParts[2];
    return dateStr;
  }
  if (year === 0 || year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) {
    if (!refDateStr || refDateStr.length < 10) return dateStr;
    const refParts = refDateStr.substring(0, 10).split('-');
    if (refParts.length === 3) return refParts[0] + '-' + refParts[1] + '-' + refParts[2];
    return dateStr;
  }

  if (refDateStr && refDateStr.length >= 10) {
    const refParts = refDateStr.substring(0, 10).split('-');
    if (refParts.length === 3) {
      const refYear = parseInt(refParts[0], 10);
      const refMonth = parseInt(refParts[1], 10);
      if (!isNaN(refYear) && !isNaN(refMonth) && (year !== refYear || month !== refMonth)) {
        return refDateStr.substring(0, 10);
      }
    }
  }

  return dateStr;
}

function normalizeRow(row) {
  var out = {};
  for (var key of Object.keys(row)) {
    var k = key.toLowerCase().trim();
    var target = FIELD_ALIASES[k] || k.replace(/ /g, '_');
    var v = row[key];
    if (v === null || v === undefined) v = '';
    if (typeof v === 'string') v = v.trim();
    if (target === 'pin' && typeof v === 'number') v = String(v);
    if (target === 'aktivs' && typeof v === 'string') {
      v = v === 'TRUE' || v === 'true' || v === '1';
    }
    if (target === 'date' || target === 'datums' || target === 'created' || target === 'lastModified' || target === 'izveidots') {
      v = normalizeDate(v);
    }
    out[target] = v;
  }
  console.log('[sync] normalizeRow date=', out.date, 'lastModified=', out.lastModified);
  return out;
}

class SyncManager {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.queue = [];
    this.syncing = false;
    this.online = navigator.onLine;
    this.syncInterval = null;
    this.init();
  }

  init() {
    window.addEventListener('online', () => {
      this.online = true;
      this.sync();
    });
    window.addEventListener('offline', () => {
      this.online = false;
    });
    this.syncInterval = setInterval(() => this.sync(), 30000);
  }

  updateStatus(newStatus) {
    this.config.currentStatus = newStatus;
    window.dispatchEvent(new CustomEvent('syncStatusChange', { detail: newStatus }));
  }

  enqueueChange(change) {
    const record = {
      id: this.db.generateId(),
      ...change,
      ts: Date.now(),
      status: 'pending'
    };
    this.queue.push(record);
    this.db.add('pending', record);
    if (this.online) this.sync();
    return record;
  }

  async sync() {
    if (this.syncing) return;
    let pending;
    try {
      pending = await this.db.getAll('pending');
    } catch (e) {
      pending = [];
    }
    const unsynced = pending.filter(p => p.status !== 'synced');
    if (unsynced.length === 0) {
      this.updateStatus('Saglabāts');
      return;
    }
    if (!this.online) {
      this.updateStatus('Bezsaistē');
      return;
    }
    this.syncing = true;
    this.updateStatus('Gaida nosūtīšanu');
    for (const item of unsynced) {
      try {
        const ok = await this.sendToServer(item);
        if (ok) {
          item.status = 'synced';
          await this.db.put('pending', item);
        } else {
          item.status = 'error';
          await this.db.put('pending', item);
        }
      } catch (err) {
        item.status = 'error';
        await this.db.put('pending', item);
      }
    }
    const stillPending = unsynced.filter(p => p.status !== 'synced');
    this.updateStatus(stillPending.length > 0 ? 'Neizdevās nosūtīt' : 'Saglabāts');
    this.syncing = false;
  }

  async sendToServer(item) {
    const payload = JSON.stringify({
      action: item.action,
      data: item.data,
      clientId: item.id
    });
    const url = this.config.GAS_URL;
    const ts = Date.now();
    let sent = false;
    try {
      await fetch(url + '?t=' + ts, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: payload
      });
      console.log('[sync] POST nosūtīts', item.action, item.id);
      sent = true;
    } catch (err) {
      console.error('[sync] POST neizdevās', err);
    }
    if (!sent) {
      try {
        await fetch(url + '?data=' + encodeURIComponent(payload) + '&t=' + ts, {
          method: 'GET',
          mode: 'no-cors'
        });
        sent = true;
        console.log('[sync] GET fallback nosūtīts', item.action, item.id);
      } catch (err2) {
        console.error('[sync] GET fallback neizdevās', err2);
      }
    }
    if (sent) {
      // Pagaidām 1s un mēģinām vēlreiz pēc 2s, lai GAS noteikti apstrādātu
      await new Promise(r => setTimeout(r, 300));
      return true;
    }
    return false;
  }

  async loadInitialData() {
    const result = { offline: false, count: {} };
    const sheets = ['darbinieki', 'klienti', 'atzimes', 'atzimes_log', 'dienas_ierakti', 'uzdevomi'];

    try {
      const url = this.config.GAS_URL + '?action=load';
      console.log('[sync] GET', url);
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      console.log('[sync] status', response.status, response.statusText);
      if (response.ok) {
        const text = await response.text();
        console.log('[sync] response first 200:', text.substring(0, 200));
        let data;
        try { data = JSON.parse(text); } catch (pe) {
          console.error('[sync] JSON parse failed:', pe);
          throw new Error('Nederīgs JSON: ' + text.substring(0, 100));
        }
        if (!data || typeof data !== 'object') {
          throw new Error('Tukša atbilde');
        }
        const hasAny = sheets.some(s => Array.isArray(data[s]));
        if (!hasAny) {
          throw new Error('Atbilde nesatur nevienu gaidīto lapu');
        }
        for (const sheet of sheets) {
          const rows = (data && data[sheet]) || [];
          if (sheet === 'atzimes' || sheet === 'atzimes_log' || sheet === 'dienas_ierakti') {
            console.log('[sync]', sheet, 'rows sample:', rows.slice(0, 2));
          }
          await this.db.clear(sheet);
          for (const row of rows) {
            const normalized = normalizeRow(row);
            const id = normalized.id || (sheet + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
            normalized.id = id;
            await this.db.put(sheet, normalized);
          }
          result.count[sheet] = rows.length;
        }
        await this.db.setMeta('lastSync', Date.now());
        await this.db.setMeta('initData', true);
        const totalMarks = result.count['atzimes'] || 0;
        const totalLog = result.count['atzimes_log'] || 0;
        console.log('[sync] Ielādēts:', result.count, 'atzimes:', totalMarks, 'atzimes_log:', totalLog);
        this.updateStatus('✓ Sinhronizēts (' + totalMarks + ' ieraksti)');
        return result;
      } else {
        console.warn('[sync] non-ok', response.status);
        this.updateStatus('Serveris neatbild');
      }
    } catch (err) {
      console.error('[sync] load failed, keeping local data:', err);
      this.updateStatus('Bezsaistē');
    }

    result.offline = true;
    for (const sheet of sheets) {
      try {
        const localRows = await this.db.getAll(sheet);
        result.count[sheet] = localRows.length;
      } catch (e) {
        result.count[sheet] = 0;
      }
    }
    return result;
  }

  async hasLocalData() {
    const clients = await this.db.getAll('klienti');
    return clients.length > 0;
  }

  async getUnsyncedCount() {
    const pending = await this.db.getAll('pending');
    return pending.filter(p => p.status !== 'synced').length;
  }

  async getUnsyncedItems() {
    const pending = await this.db.getAll('pending');
    return pending.filter(p => p.status !== 'synced');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SyncManager, normalizeRow, FIELD_ALIASES };
}
if (typeof globalThis !== 'undefined') {
  globalThis.SyncManager = SyncManager;
  globalThis.normalizeRow = normalizeRow;
}
