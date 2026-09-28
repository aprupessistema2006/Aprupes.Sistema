const SYNC_URL = typeof CONFIG !== 'undefined' ? CONFIG.GAS_URL : null;

const CACHE_BUSTER = () => Date.now() + '_' + Math.random().toString(36).substr(2, 9);

function getSyncStatusClass(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('kļū') || value.includes('neizdev') || value.includes('error')) return 'sync-badge error';
  if (value.includes('gaida') || value.includes('rindā')) return 'sync-badge pending';
  if (value.includes('sinhronizē')) return 'sync-badge syncing';
  if (value.includes('saglabāts') || value.includes('saved') || value.includes('saglabāt')) return 'sync-badge saved';
  if (value.includes('offline') || value.includes('bezsaist') || value.includes('nav savienojuma')) return 'sync-badge offline';
  return 'sync-badge saved';
}

async function fetchWithTimeout(url, timeout = 8000, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const separator = url.includes('?') ? '&' : '?';
    const urlWithCacheBuster = url + separator + '_t=' + CACHE_BUSTER();
    const response = await fetch(urlWithCacheBuster, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// Primārais transports: fetch() + tīrs JSON.
//
// IEPRIEKŠĒJAIS KOMENTS KODS BIJA NEPAREIZS — GAS /exec nosūta
// "Access-Control-Allow-Origin: *", tāpēc fetch ar mode:'cors' strādā.
// Izmantojot JSONP (<script> tagu), dažas ierīces (telefoni, reklāmu
// bloķētāji, DNS filtrēšana) skriptu noraida un dati neielādējas.
// fetch nav atkarīgs no <script> tagu ielādes un dod īstas kļūdas.
async function fetchRequest(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('Serveris atbildēja ar HTTP ' + res.status);
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Serveris atgrieza tukšu atbildi');
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // Ja tomēr atgriezts JSONP, izpakojam to
      const m = /^[^({]*\(([\s\S]*)\)\s*;?\s*$/.exec(trimmed);
      if (m) {
        try { return JSON.parse(m[1]); } catch (e2) { /* tālāk */ }
      }
      throw new Error('Neatpazīsta servera atbildi');
    }
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new Error('Timeout');
    if (e && e.permanent) throw e;
    throw new Error(e && e.message ? e.message : 'Savienojuma kļūda');
  }
}

// Rezerves transports — JSONP, ja fetch neizdevās
function jsonpRequest(url, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_cb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    let script;
    let resolved = false;

    const done = (fn, arg) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanup();
      fn(arg);
    };

    const cleanup = () => {
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
      // NEVER delete callback on timeout - GAS might still call it later
      // Only delete on success (in the callback itself via done)
    };

    const timer = setTimeout(() => {
      // On timeout, don't delete callback - GAS cold start can take 30-60s
      // Just reject, leave callback registered
      resolved = true;
      clearTimeout(timer);
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
      reject(new Error('Timeout'));
    }, timeout);

    window[callbackName] = function (data) {
      // Success - now safe to delete callback
      delete window[callbackName];
      done(resolve, data);
    };

    const separator = url.includes('?') ? '&' : '?';
    const jsonpUrl = url + separator + 'callback=' + callbackName;
    script = document.createElement('script');
    script.src = jsonpUrl;
    script.onerror = function () {
      delete window[callbackName];
      done(reject, new Error('Savienojuma kļūda'));
    };
    // Use document.head or fallback to document.documentElement for early initialization
    const target = document.head || document.documentElement;
    target.appendChild(script);
  });
}

// Galvenais pieprasījumu funkcija.
// Primāri — fetch() (CORS droši, dod īstas kļūdas).
// Ja tas neizdodas — JSONP kā rezinē (dažas ierīces bloķē <script>).
async function requestData(url, timeout = 60000, loadTimeoutOverride) {
  // Add cache buster to prevent stale redirect URLs from GAS
  const separator = url.includes('?') ? '&' : '?';
  const stamp = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const urlWithCacheBuster = url + separator + '_t=' + stamp;
  // Load action (action=load) goes through redirect URL, needs more time
  const isLoadAction = url.includes('action=load');
  const effectiveTimeout = isLoadAction ? (loadTimeoutOverride || 120000) : timeout;

  // fetch ceļš neizmanto callback parametru — GAS tad atgriež tīru JSON
  const jsonUrl = url.replace(/([?&])callback=[^&]*&?/, '$1').replace(/[?&]$/, '');

  try {
    return await fetchRequest(jsonUrl, effectiveTimeout);
  } catch (err) {
    console.warn('[sync] fetch transports neizdevās (' + err.message + '), mēģinu JSONP');
    // jsonpRequest() pats pievieno callback parametru
    return jsonpRequest(urlWithCacheBuster, effectiveTimeout);
  }
}

// Request deduplication — prevent parallel identical requests
const pendingActions = new Map();

async function jsonpAction(action, data, timeout = 120000) {
  const actionKey = action + ':' + JSON.stringify(data);

  if (pendingActions.has(actionKey)) {
    console.log('[sync] jsonpAction deduplicated:', actionKey);
    return pendingActions.get(actionKey);
  }

  const payload = encodeURIComponent(JSON.stringify({ action: action, data: data }));
  let url = SYNC_URL + '?data=' + payload;
  console.log('[sync] jsonpAction SENDING:', action, JSON.stringify(data));

  const promise = requestData(url, timeout)
    .then(result => {
      console.log('[sync] jsonpAction RESPONSE:', action, JSON.stringify(result));
      return result;
    })
    .catch(err => {
      console.error('[sync] jsonpAction ERROR:', action, err.message);
      throw err;
    })
    .finally(() => {
      pendingActions.delete(actionKey);
    });

  pendingActions.set(actionKey, promise);
  return promise;
}

// POST-based action for write operations
// Uses JSONP (GET) since GAS doesn't support CORS for fetch POST.
// This is equivalent to jsonpAction but with a distinct key prefix.
async function postAction(action, data, timeout = 120000) {
  return jsonpAction(action, data, timeout);
}

function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || isNaN(serial) || serial <= 0 || serial > 100000) return null;
  var d = new Date((serial - 25569) * 86400000);
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() < 1900 || d.getFullYear() > 2100) return null;
  return d;
}

// Spec 4.1: operationId ir unikāla identitāte, ģenerēta klientā.
// employeeId iekļauts, lai divi dažāgi lietotāji nevarētu kollīdzinēt operationId.
// payload_hash NAV iet (divas vienādas pēc satura darbības IR divas dažādas operācijas).
function generateOperationId(employeeId) {
  var ts = Date.now();
  var rand = Math.random().toString(36).substr(2, 9);
  return 'op_' + (employeeId || 'unknown') + '_' + ts + '_' + rand;
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
  const datePart = (value) => {
    if (!value) return '';
    const match = String(value).match(/^\s*(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
  };
  const timePart = (value) => {
    if (!value) return '';
    const match = String(value).match(/(?:T|\s)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return '';
    const hour = String(parseInt(match[1], 10)).padStart(2, '0');
    const minute = match[2];
    const second = match[3] || '00';
    return hour + ':' + minute + ':' + second;
  };

  const eventTime = row.eventTime || row.notikuma_laiks || row.skaits || '';
  const eventDate = datePart(eventTime);
  const explicitDate = row.date || row.datums || '';
  const createdDate = datePart(row.created || row.izveidots);
  const normalizedDate = eventDate || datePart(explicitDate) || createdDate || '';
  if (normalizedDate) row.datums = normalizedDate;

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
    lastModified: 'lastModified',
    lastmodified: 'lastModified',
    pedejaLaiks: 'lastModified',
    pedeja_laiks: 'lastModified',
    pedejaisLaiks: 'lastModified',
    pedejais_laiks: 'lastModified',
    lastBy: 'lastBy',
    darbinieksPedejais: 'lastBy',
    darbinieks_pedejais: 'lastBy',
    darbinieks_pedejais_id: 'lastBy',
    prevValue: 'lastValue',
    ieprijuma: 'lastValue',
    iprijuma: 'lastValue',
    pievienots: 'lastValue',
    created: 'created',
    izveidots: 'created',
    time: 'time',
    laiks: 'time',
    eventtime: 'eventTime',
    event_time: 'eventTime',
    notikumaLaiks: 'eventTime',
    notikuma_laiks: 'eventTime',
    reason: 'reason',
    papilgsInfo: 'reason',
    papilgs_info: 'reason',
    action_id: 'actionId',
    atzimes_id: 'markId',
    pedeja_vertiba: 'lastValue',
    pedeja_laiks: 'lastModified',
    darbinieks_pedejais: 'lastBy',
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
    parole: 'parole',
    dzimsanas_datums: 'dzimis',
    dzimšans_datums: 'dzimis',
    dzimis: 'dzimis',
    birth_date: 'dzimis',
    date_of_birth: 'dzimis',
    dieta: 'dieta',
    diet: 'dieta',
    saskarsmes: 'saskarsmes',
    saskarsmesīpatnības: 'saskarsmes',
    saskarsmes_ipatnibas: 'saskarsmes',
    contacts: 'saskarsmes',
    contact: 'saskarsmes'
  };

  const normalizedRow = {};
  Object.keys(row).forEach(k => {
    const nk = normalizeKey(k);
    if (map[nk]) {
      if (normalizedRow[map[nk]] === undefined) normalizedRow[map[nk]] = row[k];
    } else {
      normalizedRow[nk] = row[k];
    }
  });

  // Ensure id is set for IndexedDB key — handle 'ID', 'Id', 'id' etc.
  if (!normalizedRow.id) {
    const idKey = Object.keys(row).find(k => normalizeKey(k) === 'id');
    if (idKey) normalizedRow.id = row[idKey];
  }
  if (eventTime) normalizedRow.eventTime = eventTime;
  if (row.skaits !== undefined) normalizedRow.skaits = row.skaits;
  if (row.notikuma_laiks !== undefined) normalizedRow.notikuma_laiks = row.notikuma_laiks;
  if (normalizedDate) normalizedRow.date = normalizedDate;

  if (typeof normalizedRow.date === 'number') {
    console.warn('[normalizeRow] numeric date not converted (not Excel serial):', normalizedRow.date, 'for id:', normalizedRow.id);
  }

  const idTs = String(normalizedRow.id || '').match(/^[a-z]+_(\d{10,13})/);
  if (idTs && !normalizedRow.date) {
    const d = new Date(parseInt(idTs[1], 10));
    const y = d.getFullYear();
    if (!isNaN(d.getTime()) && y >= 2000 && y <= 2100) {
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      normalizedRow.date = y + '-' + m + '-' + day;
    }
  }

  if (normalizedRow.clientId && !normalizedRow.klientsId) normalizedRow.klientsId = normalizedRow.clientId;
  if (normalizedRow.employeeId && !normalizedRow.darbinieksId) normalizedRow.darbinieksId = normalizedRow.employeeId;

  const timeVal = normalizedRow.time;
  const eventTimeVal = normalizedRow.eventTime || normalizedRow.skaits;
  const looksValidTime = timeVal && /^\d{2}:\d{2}:\d{2}$/.test(String(timeVal));
  if (!looksValidTime && eventTimeVal) {
    const eventTimeOnly = timePart(eventTimeVal);
    if (eventTimeOnly) normalizedRow.time = eventTimeOnly;
  }
  if (!normalizedRow.time) {
    const createdVal = normalizedRow.created;
    if (createdVal && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(createdVal))) {
      const t = String(createdVal).match(/T(\d{2}:\d{2}:\d{2})/);
      if (t) normalizedRow.time = t[1];
    }
  }

  return normalizedRow;
}

class CareSync {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.syncing = false;
    this.loaded = false;
    this._queueProcessing = false;
    this._queueTimer = null;
    this._loading = false;
    this._syncTail = Promise.resolve();
    this._connectionStatus = 'unknown';
    this._setupOfflineDetection();
  }

  _runExclusive(operation) {
    const run = this._syncTail.then(operation, operation);
    this._syncTail = run.catch(() => {});
    return run;
  }

  _setupOfflineDetection() {
    const updateStatus = () => {
      if (!navigator.onLine) {
        this._connectionStatus = 'offline';
        this._updateSyncStatus('Nav savienojuma');
      }
    };
    updateStatus();
    window.addEventListener('online', () => {
      updateStatus();
      this.forceFullSync().catch(() => {});
    });
    window.addEventListener('offline', updateStatus);
  }

  _updateSyncStatus(status) {
    try {
      const event = new CustomEvent('syncStatusChange', { detail: status });
      window.dispatchEvent(event);
    } catch (e) {}
  }

  async checkConnection() {
    if (!navigator.onLine) {
      this._connectionStatus = 'offline';
      this._updateSyncStatus('Nav savienojuma');
      return { connected: false, status: 'offline', message: '🔴 Nav interneta savienojuma.' };
    }
    if (!SYNC_URL) {
      this._connectionStatus = 'offline';
      this._updateSyncStatus('Nav savienojuma');
      return { connected: false, status: 'offline', message: '🔴 Nav interneta savienojuma.' };
    }
    try {
      const url = SYNC_URL + '?action=ping&t=' + Date.now();
      const data = await requestData(url, 15000);
      if (data && (data.success === true || data.pong === true)) {
        this._connectionStatus = 'connected';
        this._updateSyncStatus('Saglabāts');
        return { connected: true, status: 'connected', message: '✅ Google Sheets savienojums aktīvs' };
      }
      this._connectionStatus = 'error';
      this._updateSyncStatus('Sinhronizācijas kļūda');
      return { connected: false, status: 'error', message: '⚠️ Neizdevās sazināties ar serveri.' };
    } catch (err) {
      this._connectionStatus = 'error';
      this._updateSyncStatus('Sinhronizācijas kļūda');
      return { connected: false, status: 'error', message: '⚠️ Neizdevās sazināties ar serveri.' };
    }
  }

  async getServerVersion() {
    if (!SYNC_URL) return null;
    try {
      const url = SYNC_URL + '?action=ping&t=' + Date.now();
      const data = await requestData(url, 15000);
      if (data && data.version) return data.version;
      return null;
    } catch (e) {
      return null;
    }
  }

  _collectLocalCompletions() {
    // Saglabā vietējos uzdevumu pabeigšanas statusus, pirms DB tīrīšanas.
    // Tādējādi pabeigšana netiek zaudēta, ja sinhronizācija neizdodas
    // vai Google Sheets atgriež vecus datus.
    return this.db.getAll('uzdevomi').then((all) => {
      if (!all || !all.length) return {};
      const map = {};
      all.forEach(t => {
        const id = String(t.id || t.ID);
        if (!id) return;
        const done = t.irPabeigts === true || t.irPabeigts === 'TRUE' || t.irPabeigts === 'true' || t.irPabeigts === 1 || t.irPabeigts === '1';
        const statusDone = String(t.statuss || '').toLowerCase() === 'pabeigts' || String(t.statuss || '').toLowerCase() === 'done' || String(t.statuss || '').toLowerCase() === 'completed';
        if (done || statusDone) {
          map[id] = {
            irPabeigts: true,
            statuss: t.statuss || 'pabeigts',
            pabeigtsLaiks: t.pabeigtsLaiks || null,
            pabeigtajsId: t.pabeigtajsId || null
          };
        }
      });
      return map;
    }).catch((e) => {
      console.warn('[sync] _collectLocalCompletions kļūda', e);
      return {};
    });
  }

  _applyLocalCompletions(completions) {
    if (!completions || !Object.keys(completions).length) return Promise.resolve();
    return this.db.getAll('uzdevomi').then((all) => {
      if (!all) return;
      let changed = false;
      all.forEach(t => {
        const id = String(t.id || t.ID);
        const c = completions[id];
        if (!c) return;
        const remoteDone = t.irPabeigts === true || t.irPabeigts === 'TRUE' || t.irPabeigts === 'true' || t.irPabeigts === 1 || t.irPabeigts === '1';
        const remoteStatusDone = String(t.statuss || '').toLowerCase() === 'pabeigts' || String(t.statuss || '').toLowerCase() === 'done' || String(t.statuss || '').toLowerCase() === 'completed';
        if (!remoteDone && !remoteStatusDone) {
          t.irPabeigts = true;
          t.statuss = c.statuss || 'pabeigts';
          if (c.pabeigtsLaiks) t.pabeigtsLaiks = c.pabeigtsLaiks;
          if (c.pabeigtajsId) t.pabeigtajsId = c.pabeigtajsId;
          this.db.put('uzdevomi', t);
          changed = true;
        }
      });
      if (changed) {
        console.log('[sync] atjaunoti lokālie pabeigšanas statusi pēc ielādes');
      }
    }).catch((e) => {
      console.warn('[sync] _applyLocalCompletions kļūda', e);
    });
  }

  async _collectLocalClientChanges() {
    const all = await this.db.getAll('klienti');
    if (!all || !all.length) return {};

    const queue = await this.db.getAll('sync_queue');
    const unsyncedHospitalClientIds = new Set();
    queue.forEach(item => {
      if (item && item.change && item.change.table === 'klienti' && item.change.action === 'updateClient') {
        const d = item.change.data || {};
        if (d.slimnica === true || String(d.slimnica).toLowerCase() === 'true' || d.slimnica === 1 || d.slimnica === '1') {
          unsyncedHospitalClientIds.add(String(d.id || d.ID));
        }
      }
    });

    const map = {};
    all.forEach(c => {
      const id = String(c.id || c.ID);
      if (!id) return;
      const slimnica = c.slimnica === true || c.slimnica === 'true' || c.slimnica === 1 || c.slimnica === '1' || c['Slimnīcā'] === true || c['Slimnīcā'] === 'true' || c['Slimnīcā'] === 1 || c['Slimnīcā'] === '1';
      if (slimnica && unsyncedHospitalClientIds.has(id)) {
        map[id] = { slimnica: true, Slimnīcā: true };
      }
    });
    return map;
  }

  _applyLocalClientChanges(changes) {
    if (!changes || !Object.keys(changes).length) return Promise.resolve();
    return this.db.getAll('klienti').then((all) => {
      if (!all) return;
      let changed = false;
      all.forEach(c => {
        const id = String(c.id || c.ID);
        const change = changes[id];
        if (!change) return;
        const remoteSlimnica = c.slimnica === true || c.slimnica === 'true' || c.slimnica === 1 || c.slimnica === '1' || c['Slimnīcā'] === true || c['Slimnīcā'] === 'true' || c['Slimnīcā'] === 1 || c['Slimnīcā'] === '1';
        if (!remoteSlimnica) {
          c.slimnica = true;
          c['Slimnīcā'] = true;
          this.db.put('klienti', c);
          changed = true;
        }
      });
      if (changed) {
        console.log('[sync] atjaunoti lokālie klientu izmaiņas (slimnīca) pēc ielādes');
      }
    }).catch((e) => {
      console.warn('[sync] _applyLocalClientChanges kļūda', e);
    });
  }

   async loadInitialData(onProgress, filters = {}) {
     // Spec: Migrācija pirms datu ielādes
     try { await this.runMigrations(); } catch (e) { console.warn('[sync] migration failed:', e); }
     return this._runExclusive(() => this._loadInitialDataUnlocked(onProgress, true, filters));
   }

  // Faza 1: nelielās tabulas (darbinieki, klienti, uzdevomi) — ātri, vienā pieprasījumā
  async _loadBootstrap(onProgress) {
    const params = new URLSearchParams({ action: 'load', mode: 'bootstrap', t: Date.now() });
    const url = SYNC_URL + '?' + params.toString();
    console.log('[sync] bootstrap SENDING:', url);
    // Retries are essential on mobile: a single dropped request used to fail the
    // whole app. Each retry also gets a fresh URL (timestamp) so a cached GAS
    // 302/error response cannot poison every attempt.
    // Pirmais mēģinājums ir īsāks (45s), lai vāja tīkla lietotājs nenosaka
    // gaidīt bezgalīgi; atkārtojumiem 90s (GAS var būt aizvēsts).
    let lastAttempt = 0;
    const data = await this._fetchWithRetry(url, 60000, 3, {
      loadTimeout: (attempt) => (attempt === 0 ? 45000 : 90000),
      onRetry: (attempt) => {
        lastAttempt = attempt;
        if (onProgress) onProgress('Pārbaudu savienojumu ar Google... (mēģinājums ' + attempt + ')');
      }
    });
    console.log('[sync] bootstrap RECEIVED (attempt ' + lastAttempt + '):',
      'darbinieki=' + (data.darbinieki || []).length,
      'klienti=' + (data.klienti || []).length, 'counts=', JSON.stringify(data.counts || {}));
    if (data.error) {
      const err = new Error(data.error);
      err.permanent = true;
      throw err;
    }
    return data;
  }

  // Faza 2: atzimes + atzimes_log pa blokiem (jaunākie pirmāk). SAPLŪST, netīra.
  async _loadMarksPaged(onProgress, totals) {
    if (!SYNC_URL) return null;
    onProgress = onProgress || function() {}; // Fons: neatjaudājams console.log iekšā
    const LIMIT = 500; // Mazāk — ātrāk GAS atmoderas, mazāk timeoutu
    let totalMarks = (totals && totals.atzimes) || 0;
    let totalLog = (totals && totals.atzimes_log) || 0;

    // Ielādējam VISUS atzīmes, sākot no JAUNĀKOVI (beigām → sākumam),
    // lai "šodien" dati kļūtu pieejami pirmie.
    const end = Math.max(totalMarks, totalLog);
    let offset = Math.max(0, end - LIMIT);
    let loadedMarks = 0, loadedLog = 0;
    let guard = 0;
    const MAX_GUARD = 2000; // 500-row lapas → ~452 lapas

    while (guard++ < MAX_GUARD) {
      const params = new URLSearchParams({
        action: 'load', mode: 'marks', t: Date.now(),
        offset: String(offset), limit: String(LIMIT)
      });
      const url = SYNC_URL + '?' + params.toString();

      // GAS atgriež atzimes + atzimes_log vienā atbildē (vienā pieprasījumā)
      let data;
      try {
        data = await this._fetchWithRetry(url, 120000, 3);
      } catch (e) {
        console.warn('[sync] marks page @offset ' + offset + ' neizdevās pēc retry:', e.message);
        offset = Math.max(0, offset - LIMIT);
        if (offset === 0 && guard > 2) break;
        onProgress('⚠️ Pārlejot garš ' + offset);
        await new Promise(r => setTimeout(r, 0)); // Atladīg UI
        continue;
      }
      if (data.error) {
        console.warn('[sync] marks page kļūda:', data.error);
        offset = Math.max(0, offset - LIMIT);
        if (offset === 0 && guard > 2) break;
        await new Promise(r => setTimeout(r, 0));
        continue;
      }

      totalMarks = data.markTotal || totalMarks;
      totalLog = data.logTotal || totalLog;
      const marks = data.atzimes || [];
      const logs = data.atzimes_log || [];

      if (marks.length) await this.db.batchPut('atzimes', marks.map(normalizeRow));
      if (logs.length) await this.db.batchPut('atzimes_log', logs.map(normalizeRow));

      loadedMarks += marks.length;
      loadedLog += logs.length;
      onProgress('Ielādēju aprūpes ierakstus: ' + loadedMarks + ' / ' + (totalMarks || '?'));

      // Newest-first paging: stop when we've paged all the way down to offset 0.
      if (offset === 0) break;
      const next = Math.max(0, offset - LIMIT); // jaunākie pirmāk → atpakaļ
      if (next === offset) break;
      offset = next;
      await new Promise(r => setTimeout(r, 0)); // Atlaide UI starp lapām
    }

    console.log('[sync] marks ielādēti. offset=' + offset + ' markTotal=' + totalMarks + ' logTotal=' + totalLog);
    this._marksLoaded = true;
    this.revision = (this.revision || 0) + 1;
    try { window.dispatchEvent(new CustomEvent('marksLoaded')); } catch (e) {}
    return { markTotal: totalMarks, logTotal: totalLog };
  }

  // Ātra ielāde — tikai vakardiena + šodiena + rītdiena (3 dienas)
  // Ielādējas pirmos ~5 sekundes, UI nav bloķēts
  async _loadRecentMarks(onProgress) {
    const now = new Date();
    const dates = [];
    for (let i = -1; i <= 1; i++) { // -1=vakardiena, 0=šodiena, +1=rītdiena
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().slice(0, 10)); // "yyyy-mm-dd"
    }

    // Vienā pieprasījumā filtrēt pēc datuma diapazonam
    const params = new URLSearchParams({
      action: 'load', mode: 'range', t: Date.now(),
      dateFrom: dates[0], dateTo: dates[2], limit: '2000'
    });
    const url = SYNC_URL + '?' + params.toString();
    const data = await this._fetchWithRetry(url, 60000, 2);

    const marks = (data.atzimes || []).map(normalizeRow);
    const logs = (data.atzimes_log || []).map(normalizeRow);
    if (marks.length) await this.db.batchPut('atzimes', marks);
    if (logs.length) await this.db.batchPut('atzimes_log', logs);

    console.log('[sync] ielādēti aktuālie ieraksti: ' + marks.length + ' atzimes, ' + logs.length + ' logi');
    try { window.dispatchEvent(new CustomEvent('recentMarksLoaded')); } catch (e) {}
  }

  // Fonā ielādē visus pārējos atzimes (500/rindura lapām)
  // Neprasina await — turpinās neatkarībā no UI
  _loadMarksBackground(onProgress, counts) {
    const bgProgress = onProgress || function() {}; // Fons: klusi konsolē
    this._marksLoadingPromise = this._loadMarksPaged(bgProgress, counts)
      .then(r => {
        this._updateSyncStatus('Saglabāts');
        if (onProgress) onProgress('✓ Visi aprūpes ieraksti ielādēti');
        return r;
      })
      .catch(e => {
        console.warn('[sync] fona atzīmju ielāde neizdevās:', e.message);
        this._updateSyncStatus('Saglabāts');
        if (onProgress) onProgress('⚠️ Daži ieraksti netika ielādēti, bet varat turpināt darbu');
        return null;
      });
  }

  // Ārējiem pieprasījumiem (JSONP uz script.google.com) pārlūks izmanto
  // JSONP, nevis fetch — tāpēc SW nedrīkst tos pārtvert. Ja tomēr
  // gadījumā to dara, skripts neielādējas un JSONP atzvanīšana nenotiek.
  // Šeit noņemam SW un ļaujam pārlūkam strādāt pašam.
  async _teardownServiceWorker() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return false;
    try {
      const controlled = !!navigator.serviceWorker.controller;
      const regs = navigator.serviceWorker.getRegistrations
        ? await navigator.serviceWorker.getRegistrations()
        : [];
      if (!controlled && (!regs || regs.length === 0)) return false;

      await Promise.all((regs || []).map(r => r.unregister().catch(() => {})));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      console.log('[sync] Service Workers noņemti, mēģinu vēlreiz bez SW');
      return true;
    } catch (e) {
      console.warn('[sync] SW noņemšana neizdevās:', e);
      return false;
    }
  }

  // Palūkstīga pieprasījuma atkārtota mēģinājuma ar eksponenciālo atliki
  async _fetchWithRetry(url, timeout, retries, options = {}) {
    const { onRetry, loadTimeout } = options;
    let lastErr;
    let swTried = false;
    const backoff = [1000, 3000, 8000]; // Ātrāk atjauno GAS pēc cold start
    for (let attempt = 0; attempt <= retries; attempt++) {
      const started = Date.now();
      try {
        const lt = typeof loadTimeout === 'function' ? loadTimeout(attempt) : loadTimeout;
        return await requestData(url, timeout, lt);
      } catch (e) {
        const spent = Date.now() - started;
        lastErr = e;
        // Server atbildēja ar kļūdu (piem. GAS kvota) — atkārtošana neatbūs palīdzēt
        if (e && e.permanent) throw e;

        // Ātri nokrātis (DNS kļūda, "Failed to fetch", skripta kļūda) nozīmē,
        // ka nav tīkla, nevis ka serveris ir lēns. Bez tīkla katrs mēģinājums
        // kļūst par dažām sekundēm, tāpēc 2 ātri mēģinājumi ir lēti un izārst
        // arī vienu nejaušu zaudētu paketi. Bet turpmākos ar 90s timeoutiem
        // neizmaksā gaidīt — lietotājs beidz redzēt tikai mirkli.
        const fastNetErr = spent < 6000 && /Failed to fetch|NetworkError|load failed|ERR_|Savienojuma kļūda/i.test(String(e && e.message));
        if (fastNetErr && attempt >= 2) {
          console.warn('[sync] ātrs tīkla kļūdas (' + spent + 'ms) — tīkla nav, pārtraucu');
          throw e;
        }

        // Vienu reizi mēģinām noņemt SW — tas bieži novērš JSONP nokļūšanu
        if (!swTried && attempt === 0) {
          const removed = await this._teardownServiceWorker();
          if (removed) swTried = true;
        }

        console.warn('[sync] atkārtota mēģinājuma kļūda (mēģinājums ' + (attempt + 1) + '/' + (retries + 1) + ', ' + spent + 'ms):', e.message);
        if (attempt < retries) {
          if (onRetry) {
            try { onRetry(attempt + 2); } catch (cbErr) {}
          }
          const delay = backoff[Math.min(attempt, backoff.length - 1)];
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }

  // Konkrēta klienta dati pēc vajadzības (care_form, control)
  async loadClientRange(clientId, dateFrom, dateTo) {
    if (!SYNC_URL || !clientId) return { marks: [], logs: [] };
    const LIMIT = 1000; // Mazāk — ātrāk GAS atbildē
    let offset = 0;
    const allMarks = [];
    const allLogs = [];
    let guard = 0;

    while (guard++ < 60) {
      const params = new URLSearchParams({
        action: 'load', mode: 'range', t: Date.now(),
        clientId: String(clientId),
        dateFrom: dateFrom || '', dateTo: dateTo || '',
        offset: String(offset), limit: String(LIMIT)
      });
      const url = SYNC_URL + '?' + params.toString();
      let data;
      try {
        data = await requestData(url, 30000); // Ātrāk timeout — 30s
      } catch (e) {
        console.warn('[sync] loadClientRange neizdevās:', e.message);
        break;
      }
      if (data.error) break;

      const marks = (data.atzimes || []).map(normalizeRow);
      const logs = (data.atzimes_log || []).map(normalizeRow);
      if (marks.length) await this.db.batchPut('atzimes', marks);
      if (logs.length) await this.db.batchPut('atzimes_log', logs);
      // Neliels klienta apjoms - 90 dienas, tāpēc safe, bet bez spread, lai neuzkrauktu staku
      for (const m of marks) allMarks.push(m);
      for (const l of logs) allLogs.push(l);

      const next = (data.nextOffset !== undefined) ? data.nextOffset : (offset + marks.length);
      if (data.done === true) break;
      if (marks.length === 0 && logs.length === 0) break;
      if (next <= offset) break;
      offset = next;
    }

    return { marks: allMarks, logs: allLogs };
  }

  async _loadInitialDataUnlocked(onProgress, processQueueFirst, filters = {}) {
    this._loading = true;
    this._updateSyncStatus('Sinhronizē...');
    onProgress = onProgress || function() {};

    // Tikai viens mēģinājums — ātri, bez murgiem
    try {
      if (processQueueFirst) {
        // Rindas nosūtīšanai atvēlam tikai 20s — dati jāielādē ātrāk!
        await this._processQueueUnlocked(20000);
      }

      // === FAZA 1: nelielās tabulas (ātri) ===
      onProgress('Ielādēju klientus un darbiniekus...');
      const base = await this._loadBootstrap(onProgress);
      const lastSync = Date.now();

      // Saglabāt vietējos pabeigšanas statusus un klientu izmaiņas pirms DB tīrīšanas
      const localCompletions = await this._collectLocalCompletions();
      const localClientChanges = await this._collectLocalClientChanges();

      // NOMAINĀT atzimes/atzimes_log — tās tiek ielādētas daļās fonā un saplūstas
      // meta store is NOT included here — replaceStores clears it entirely,
      // which would delete the migration_v3_complete marker and force the O(n)
      // runMigrations to re-run on every sync. Instead we use db.put for
      // lastSync to preserve existing meta entries.
      await this.db.replaceStores({
        darbinieki: (base.darbinieki || []).map(normalizeRow),
        klienti: (base.klienti || []).map(normalizeRow),
        uzdevomi: (base.uzdevomi || []).map(normalizeRow)
      });
      await this.db.put('meta', { key: 'lastSync', value: lastSync, ts: lastSync });

      await this._applyLocalCompletions(localCompletions);
      await this._applyLocalClientChanges(localClientChanges);

      const counts = base.counts || {};
      this._serverCounts = counts;

      this.loaded = true;
      this.revision = (this.revision || 0) + 1;

      // sync_queue is NOT cleared after data load — pending operations
      // may not have been confirmed by the server yet. Each item is only
      // deleted when the server explicitly accepts it (accepted/already_processed).
      const remaining = await this.getUnsyncedCount();
      this._updateSyncStatus(remaining > 0 ? 'Gaida nosūtīšanu' : 'Saglabāts');

      if (remaining > 0) {
        console.log('[sync] Pēc ielādes atlikuši ' + remaining + ' neatlasīti ieraksti, sūtu uz GS');
        this.processQueue().catch(() => {});
      }

      const result = {
        offline: false,
        connected: true,
        count: {
          darbinieki: (base.darbinieki || []).length,
          klienti: (base.klienti || []).length,
          atzimes: counts.atzimes || 0,
          atzimes_log: counts.atzimes_log || 0,
          uzdevomi: (base.uzdevomi || []).length
        },
        counts: counts,
        pending: remaining,
        revision: this.revision
      };
      try {
        window.dispatchEvent(new CustomEvent('syncComplete', { detail: result }));
      } catch (e) {}
      onProgress('✓ Klienti ielādēti. Zemtā aprūpes ieraksti...');

      // === FAZA 2: FONĀ — ielādē pārējos atzimes, bet nebloķē UI ===
      // Fona ielāde ir klusa — tikai konsolē, neredzams lietotājam
      this._loadMarksBackground(null, counts);

      // === FAZA 3: Ātra ierakveida ielāde — tikai 3 dienas ===
      // Pilnīgi klusi — neredzams lietotājam, tikai konsolē
      this._loadRecentMarks(null);

      return result;
    } catch (err) {
      // JA NEIZDODAS — NEDZĒSIM DATUS!
      console.warn('[sync] loadInitialData kļūda, saglabājam esošos datus:', err.message);
      this._updateSyncStatus('Nav savienojuma ar Google Sheets');
      onProgress('⚠️ Neizdevās sazināties ar Google Sheets. Darbojies ar lokālajiem datiem.');
      return { offline: true, error: err.message, count: {}, pending: 0 };
    } finally {
      this._loading = false;
    }
  }

  // Gaidīt, kamēr fona atzīmju ielāde beidzās
  async waitForMarks() {
    if (this._marksLoadingPromise) {
      try { await this._marksLoadingPromise; } catch (e) {}
    }
    return this._marksLoaded;
  }

  // Atjauno datus no GS — izsaukt, kad lietotājs pāriet uz citu sadaļu
  async reloadFromSheets(onProgress) {
    if (this._loading) {
      console.log('[sync] jau ielādē, nē dzēst');
      return;
    }
    return this._runExclusive(() => this._loadInitialDataUnlocked(onProgress, false, {}));
  }

  async enqueueChange(change) {
    if (!SYNC_URL) return;
    if (this._loading) {
      // Saglabāt rindā, bet nekavējoties neprocesēt — processQueue tiks izsaukts pēc ielādes
      console.log('[sync] enqueueChange: saglabāju rindā (ielāde notiek)');
    }
    if (change.data && change.data.actionId) {
      const existing = await this.db.getAll('sync_queue');
      const duplicate = existing.find(item =>
        item.change && item.change.data &&
        item.change.data.actionId === change.data.actionId
      );
      if (duplicate) {
        // Preserve original operationId — do not overwrite with a new one
        const originalOpId = duplicate.change.data && duplicate.change.data.operationId;
        if (originalOpId) {
          change.data.operationId = originalOpId;
        }
        duplicate.change.data = change.data;
        duplicate.timestamp = Date.now();
        await this.db.put('sync_queue', duplicate);
        console.log('[sync] enqueueChange: atjaunināts dublets actionId:', change.data.actionId);
        return duplicate.id;
      }
    }
    // Spec 4.1: ģenerē operationId ja klients to nepieciešams
    // Ģenerējam tikai jauniem itemiem (ne dublikātiem), lai operationId paliktu stabili cauri retry
    if (change.data && !change.data.operationId) {
      var empId = change.data.employeeId || change.data.employeeID ||
        change.data.darbinieksId || (window.currentUser && window.currentUser.id) || 'unknown';
      change.data.operationId = generateOperationId(empId);
    }
    // Spec 12.4: OCC — pievieno recordVersion, ja tiek atjaunināts esošs ieraksts
    if (change.data && change.data.id && !change.data.recordVersion) {
      var tableName = change.table;
      if (tableName && this.db) {
        try {
          var record = await this.db.get(tableName, change.data.id);
          if (record && record.version) {
            change.data.recordVersion = record.version;
          }
        } catch (e) {
          // Best-effort: OCC nav kritisks
        }
      }
    }
    const queueItem = {
      id: this.db.generateId(),
      change: change,
      operationId: change.data.operationId,
      timestamp: Date.now(),
      retries: 0,
      lastError: null,
      status: 'GAIDA',
      recordVersion: change.data.recordVersion || null
    };
    await this.db.add('sync_queue', queueItem);
    this._scheduleQueueProcessing();
    return queueItem.id;
  }

  _scheduleQueueProcessing() {
    if (this._queueTimer) return;
    this._queueTimer = setTimeout(() => {
      this._queueTimer = null;
      this.processQueue().catch(() => {});
    }, 100); // Reduced from 500ms to 100ms for faster sync
  }

  // Tūlītējs rindas apstrādes izsaukums - atgriež Promise, lai varētu gaidīt pabeigšanu (ar timeout)
  async flushQueue() {
    if (this._queueTimer) {
      clearTimeout(this._queueTimer);
      this._queueTimer = null;
    }
    // Atgriežam processQueue promise, lai izsauktājs varētu await (ar timeout)
    return this.processQueue().catch(() => {});
  }

  async processQueue() {
    return this._runExclusive(() => this._processQueueUnlocked());
  }

  async _processQueueUnlocked(maxMs) {
    const summary = { synced: 0, failed: 0, remaining: 0, permanentlyFailed: 0 };
    if (!SYNC_URL) {
      this._updateSyncStatus('Nav savienojuma');
      return summary;
    }
    this._queueProcessing = true;
    this._updateSyncStatus('Sinhronizē...');
    // Grafiks: uz telefona bez savienojuma katrs rakstīšanas pieprasījums
    // var kavēties līdz timeoutam. Bez šī ierobežojuma rinda varētu aizturēt
    // lāpu ielādi desmitiem minūšu pirms datu ielādes sākas.
    const deadline = maxMs ? Date.now() + maxMs : 0;
    try {
      const items = await this.db.getAll('sync_queue');
      if (items.length === 0) {
        this._updateSyncStatus(navigator.onLine ? 'Saglabāts' : 'Nav savienojuma');
        return summary;
      }

      const MAX_RETRIES = 5;
      const sorted = items.slice().sort((a, b) => a.timestamp - b.timestamp);
      for (const item of sorted) {
        if (deadline && Date.now() > deadline) {
          console.log('[sync] processQueue: laika budžets izlietots, pārlejot pārējos ' +
            (sorted.length - summary.synced - summary.failed) + ' ierakstus uz vēlāku');
          summary.skipped = true;
          break;
        }
        // Skip permanently failed items (exceeded max retries)
        if ((item.retries || 0) >= MAX_RETRIES) {
          summary.permanentlyFailed++;
          continue;
        }
        // Spec 11.3: konfliktējoši itemi nav atkārtot automātiski —
        // lietotājam jārisolvē konflikts (serverVersion ≠ client recordVersion)
        if (item.status === 'KONFLIKTS') {
          summary.conflictSkipped = (summary.conflictSkipped || 0) + 1;
          continue;
        }
        // Spec 7: pārējie neattīrītie stāvokļi — izlaidi
        if (['NEVAR ATKĀRTOT', 'ATCELTS', 'AIZVIETA', 'PIEŅEMTS', 'BLOKKĒTS'].includes(item.status)) {
          if (item.status === 'NEVAR ATKĀRTOT') summary.permanentlyFailed++;
          if (item.status === 'BLOKKĒTS') summary.blocked = (summary.blocked || 0) + 1;
          continue;
        }
        // Spec 7: replacement detection — ja jaunāks item ar to pašu recordId jau ir,
        // atzīmē šo kā AIZVIETA un neapstrādā
        const itemRecordId = item.change?.data?.id;
        const itemTs = item.timestamp;
        if (itemRecordId) {
          const newerExists = sorted.find(other =>
            other.id !== item.id &&
            other.status !== 'AIZVIETA' &&
            other.status !== 'ATCELTS' &&
            other.change?.data?.id === itemRecordId &&
            other.timestamp > itemTs
          );
          if (newerExists) {
            item.status = 'AIZVIETA';
            item.replacedBy = newerExists.id;
            await this.db.put('sync_queue', item);
            continue;
          }
        }
 try {
            item.status = 'SINHRONIZĀCIJA NOTIEK';
            await this.db.put('sync_queue', item);
            const action = item.change.action || item.change.type || 'mark';
            const data = item.change.data || item.change;
            const isWriteOp = ['mark', 'createTask', 'updateTask', 'createClient', 'createEmployee', 'updateClient', 'updateEmployee'].includes(action);
            console.log('[sync] processQueue PROCESSING:', action, 'retries:', item.retries || 0, 'data:', JSON.stringify(data));
            let result;
            try {
              result = isWriteOp
                ? await postAction(action, data, 45000)
                : await jsonpAction(action, data, 45000);
              console.log('[sync] processQueue RESULT:', action, 'success:', result?.success, 'error:', result?.error, 'already_processed:', result?.already_processed);
            } catch (requestErr) {
              // Request failed (network error/timeout) - re-throw to trigger retry logic
              throw requestErr;
            }
            // Delete queue item only when server confirms acceptance.
            // Spec 10.6: HTTP response received != operation accepted.
            // Only accepted===true or already_processed===true triggers deletion.
            const wasAccepted = result && (
              result.already_processed === true ||
              result.accepted === true ||
              (result.success === true && result.blocked !== true)
            );
            if (wasAccepted) {
              // Spec 10: atjaunoj recordVersion no servera atbauves (ja pieejams)
              if (result && result.recordVersion) {
                item.recordVersion = result.recordVersion;
                if (item.change && item.change.data) {
                  item.change.data.recordVersion = result.recordVersion;
                }
              }
              try {
                await this.db.delete('sync_queue', item.id);
                console.log('[sync] Queue item DELETED (accepted):', item.id);
              } catch (delErr) {
                console.warn('[sync] Failed to delete queue item:', delErr);
              }
              summary.synced++;
             } else {
              // Server responded but not accepted — keep item, update status
              if (result && result.deduplication_valid_until && new Date(result.deduplication_valid_until) <= Date.now()) {
                item.status = 'NEVAR ATKĀRTOT';
                item.lastError = 'Deduplication window expired on server';
                await this._archiveItem(item, 'error');
              } else if (result && result.retry_not_allowed === true) {
                item.status = 'NEVAR ATKĀRTOT';
                item.lastError = result.error || 'Retry not allowed on server';
                await this._archiveItem(item, 'error');
              } else if (result && result.blocked === true) {
                item.status = 'BLOKKĒTS';
              } else if (result && result.conflict === true) {
                item.status = 'KONFLIKTS';
                item.conflictInfo = {
                  serverVersion: result.serverVersion,
                  recordId: result.recordId,
                  deduplicationValidUntil: result.deduplication_valid_until
                };
              } else if (result && result.error) {
                item.status = 'KĻŪDA';
                item.lastError = result.error;
              } else {
                item.status = 'NORAIDĪTS';
              }
              await this.db.put('sync_queue', item);
              summary.failed++;
            }
        } catch (e) {
          // Spec 11.1: network errors are NOT permanent — retry with same operationId.
          // isPermanent removed: timeout/DNS/CORS must retry, not be marked permanentlyFailed.
          const errorMsg = e.message || String(e);
          item.retries = (item.retries || 0) + 1;
          item.lastError = errorMsg;
          item.status = 'KĻŪDA';
          if ((item.retries || 0) >= MAX_RETRIES) {
            summary.permanentlyFailed++;
          }
          await this.db.put('sync_queue', item);
          summary.failed++;
        }
      }
      summary.remaining = await this.getUnsyncedCount();
      const status = summary.remaining > 0 ? 'Gaida nosūtīšanu' : (navigator.onLine ? 'Saglabāts' : 'Nav savienojuma');
      this._updateSyncStatus(summary.synced || summary.failed
        ? status + ' (✓' + summary.synced + ' ✗' + summary.failed + ')'
        : status);
      return summary;
    } finally {
      this._queueProcessing = false;
    }
  }

  async forceFullSync(onProgress, filters = {}) {
    return this._runExclusive(async () => {
      const queue = await this._processQueueUnlocked();
      const load = await this._loadInitialDataUnlocked(onProgress, false, filters);
      // Do NOT clearQueue here — pending operations not yet confirmed by server
      // must be preserved. Items are only removed when server accepts them.
      const result = { ...load, queue };
      try {
        window.dispatchEvent(new CustomEvent('syncComplete', { detail: result }));
      } catch (e) {}
      return result;
    });
  }

  // Pūsta sync_queue - izsaucot, kad serveris ir "source of truth"
  async clearQueue() {
    try {
      const items = await this.db.getAll('sync_queue');
      if (items.length > 0) {
        console.log('[sync] clearQueue: dzēš', items.length, 'ierakstus');
        for (const item of items) {
          await this.db.delete('sync_queue', item.id);
          console.log('[sync] clearQueue DELETED:', item.id);
        }
      }
    } catch (e) {
      console.warn('[sync] clearQueue kļūda:', e);
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

  // Manuālā atkārtošana — lietotājs spyied "Mēģināt vēlreiz".
   // Atdatina retry counter un statusu, atkārto ar to pašu operationId/actionId.
    async retry(itemId) {
      const item = await this.db.get('sync_queue', itemId);
      if (!item) return false;
      // Spec 11.2: pārbauda, vai serveris atļauj atkārtot
      const opId = item.operationId || item.change?.data?.operationId;
      if (opId) {
        const allowed = await this.checkRetryAllowed(opId);
        if (!allowed || allowed.can_retry === false) {
          return { retried: false, reason: allowed.reason || 'retry_not_allowed' };
        }
      }
      // Spec 11.3: conflict resolution — refresh recordVersion before retry
      if (item.status === 'KONFLIKTS' && item.change?.data?.id && item.change?.table) {
        const record = await this.db.get(item.change.table, item.change.data.id);
        if (record && record.version) {
          item.change.data.recordVersion = record.version;
          item.recordVersion = record.version;
        }
      }
      item.retries = 0;
      item.lastError = null;
      item.status = 'GAIDA';
      delete item.conflictInfo;
      await this.db.put('sync_queue', item);
      this._scheduleQueueProcessing();
      return { retried: true };
    }

    async _archiveItem(item, outcome) {
      try {
        await this.db.put('sync_audit', {
          id: 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          originalItemId: item.id,
          operationId: item.operationId || item.change?.data?.operationId,
          action: item.change.action || item.change.type,
          recordId: item.change.data?.id,
          employeeId: item.change.data?.employeeId || item.change.data?.employeeID,
          retries: item.retries || 0,
          lastError: item.lastError,
          status: item.status,
          createdAt: item.timestamp,
          archivedAt: Date.now(),
          outcome: outcome
        });
        await this.db.delete('sync_queue', item.id);
        console.log('[sync] Item archived to sync_audit:', item.id, 'outcome:', outcome);
      } catch (e) {
        console.warn('[sync] _archiveItem failed, keeping item in queue:', e);
      }
    }

   async checkRetryAllowed(operationId) {
     if (!operationId) return { can_retry: true, reason: 'no_operation_id' };
     try {
       const result = await jsonpAction('check_retry_not_allowed', { operationId: operationId });
       return result;
     } catch (e) {
       // Ja nav savienojuma — atkārtošana ir vienīgais variants
       return { can_retry: true, reason: 'network_error' };
     }
   }

  async sync() {
    const summary = await this.processQueue();
    // Fire queueComplete (not syncComplete) to avoid triggering re-renders
    try {
      window.dispatchEvent(new CustomEvent('queueComplete', { detail: { queue: summary } }));
    } catch (e) {}
  }

  async hasLocalData() {
    try {
      const darbinieki = await this.db.getAll('darbinieki');
      if (darbinieki.length > 0) return true;
      // Dārbnieku var nebūt, bet klienti/uzdevomi jābūt — tad dati nav jāielādē no servera
      const klienti = await this.db.getAll('klienti');
      return klienti.length > 0;
    } catch (e) {
      return false;
    }
  }

  // Kad pēdējoreiz veiksmīgi ielādēti dati no Google (0 = nekad šajā ierīcē)
  async getLastSyncTime() {
    try {
      const meta = await this.db.getAll('meta');
      const row = (meta || []).find(m => m && m.key === 'lastSync');
      const ts = row && row.value ? Number(row.value) : 0;
      return isNaN(ts) ? 0 : ts;
    } catch (e) {
      return 0;
    }
  }

  async createEmployee(data) {
    const result = await jsonpAction('createEmployee', data);
    return result;
  }

  // Spec: Migrācija actionId → operationId un version kolonnas sākotnējai sync
  async runMigrations() {
    const migratedKey = 'migration_v3_complete';
    try {
      const meta = await this.db.getAll('meta');
      const alreadyDone = meta.find(m => m.key === migratedKey);
      if (alreadyDone) {
        console.log('[sync] Migration v3 already complete');
        return;
      }

      let changes = 0;

      // 1. actionId → operationId mapping for sync_queue items
      const queueItems = await this.db.getAll('sync_queue');
      for (const item of queueItems) {
        if (!item.operationId && item.change && item.change.data && item.change.data.actionId) {
          const empId = item.change.data.employeeId || item.change.data.employeeID || 'unknown';
          item.operationId = generateOperationId(empId);
          item.change.data.operationId = item.operationId;
          await this.db.put('sync_queue', item);
          changes++;
        }
      }

      // 2. Pievieno version kolonnu ierakstiem (atzimes, klienti, darbinieki, uzdevomi)
      for (const store of ['atzimes', 'klienti', 'darbinieki', 'uzdevomi']) {
        const items = await this.db.getAll(store);
        for (const item of items) {
          if (!item.version) {
            item.version = 1;
            await this.db.put(store, item);
            changes++;
          }
        }
      }

      await this.db.put('meta', { key: migratedKey, value: Date.now() });
      console.log('[sync] Migration v3 complete (' + changes + ' changes)');
    } catch (e) {
      console.warn('[sync] Migration failed:', e);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeRow, CareSync, generateOperationId };
}
if (typeof globalThis !== 'undefined') {
  globalThis.normalizeRow = normalizeRow;
  globalThis.CareSync = CareSync;
}
