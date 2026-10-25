// MedicineView — medicīniskais uzraudzība ar diena/nedēļa/mēneša skatiem
'use strict';

const MEDICINE_FIELDS = [
  { key: 'temperatura', label: '🌡', cat: 'temp', unit: '°C', critMin: null, critMax: 38.0, dirInv: false },
  { key: 'brokastis', label: '🍽', cat: 'food', unit: '', critMin: null, critMax: null, dirInv: false },
  { key: 'pusdienas', label: '🍽', cat: 'food', unit: '', critMin: null, critMax: null, dirInv: false },
  { key: 'launags', label: '🍽', cat: 'food', unit: '', critMin: null, critMax: null, dirInv: false },
  { key: 'vakariņi', label: '🍽', cat: 'food', unit: '', critMin: null, critMax: null, dirInv: false },
  { key: 'urina_daudzums', label: '💧', cat: 'fluid', unit: 'ml', critMin: 400, critMax: null, dirInv: true },
  { key: 'uznemts_ml', label: '🥤', cat: 'fluid', unit: 'ml', critMin: 800, critMax: null, dirInv: true },
  { key: 'vedera_izeja', label: '🚽', cat: 'physio', unit: '', critMin: null, critMax: null, dirInv: false }
];
const FIELD_BY_KEY = new Map(MEDICINE_FIELDS.map(f => [f.key, f]));

function num(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(',', '.');
  if (s === '' || s === '-') return NaN;
  return parseFloat(s);
}

function isCrit(f, v) {
  const n = num(v);
  if (isNaN(n)) return false;
  const fd = FIELD_BY_KEY.get(f);
  if (!fd) return false;
  if (fd.critMin !== null && n < fd.critMin) return true;
  if (fd.critMax !== null && n > fd.critMax) return true;
  return false;
}

class MedicineView {
  constructor() {
    this.db = null;
    this.sync = null;
    this.currentUser = null;
    this.allClients = [];
    this.allEmployees = [];
    this.allMarks = [];
    this._byClientField = new Map();
    this._byClient = new Map();
    this.searchTerm = '';
    this.selectedClientId = null;
    this.filteredClientIds = [];
    this.view = 'day';
    this._autoSyncTimer = null;
    this._autoSyncRunning = false;
    this.init();
  }

  async init() {
    console.log('[MED] init start');
    let userData = sessionStorage.getItem('careUser');
    if (!userData) {
      console.log('[MED] no session, creating guest');
      userData = JSON.stringify({ id: 'guest', vards: '', uzvards: '', loma: 'administrators' });
      try { sessionStorage.setItem('careUser', userData); } catch (e) { console.warn('[MED] sessionStorage failed', e); }
    }
    try {
      this.currentUser = JSON.parse(userData);
      console.log('[MED] user ok', this.currentUser);
    } catch (e) {
      console.error('[MED] parse user failed', e);
      userData = JSON.stringify({ id: 'guest', vards: '', uzvards: '', loma: 'administrators' });
      try { sessionStorage.setItem('careUser', userData); } catch (ex) {}
      this.currentUser = JSON.parse(userData);
    }
    this.db = new CareDB();
    await this.db.init();
    window.careDB = this.db;
    this.sync = new CareSync(this.db, CONFIG);
    window.careSync = this.sync;
    const role = (this.currentUser.loma || '').toLowerCase();
    if (role.indexOf('medic') === -1 && role.indexOf('medicin') === -1 && role !== 'mediķis' && role !== 'arsts' && role !== 'medicinska' && role !== 'medicīnas darbinieks' && role !== 'administrators' && role !== 'kontroliere') {
      window.location.href = 'aprupe.html';
      return;
    }

    const offlineBox = document.getElementById('mhOffline');
    const blockOffline = () => {
      if (!navigator.onLine) {
        if (offlineBox) offlineBox.style.display = 'flex';
        const main = document.querySelector('.mh-main');
        if (main) main.style.display = 'none';
        return true;
      }
      if (offlineBox) offlineBox.style.display = 'none';
      const main = document.querySelector('.mh-main');
      if (main) main.style.display = 'block';
      return false;
    };
    if (blockOffline()) {
      window.addEventListener('online', () => { if (!blockOffline()) location.reload(); });
      window.addEventListener('offline', blockOffline);
      return;
    }
    window.addEventListener('online', blockOffline);
    window.addEventListener('offline', blockOffline);
    this.setupUI();
    this.setupLanguageSwitcher();
    try {
      await this.sync.bootstrapUI({
        onLocalReady: async () => {},
        onServerData: async () => {
          try { await this.loadData(); } catch (e) { console.warn('[medicine] loadData (server) kļūda, vizualizācija tāpat tiks rādīta:', e); }
          this.renderAll();
        },
        onProgress: (msg) => this._setStatus(msg)
      });
    } catch (e) { console.warn('[medicine] ielādes kļūda:', e); }
    finally { 
      console.log('[MED] init finally');
      this._setStatus(null);
      // Garantēts splash slēpšana — ja renderView() nekad netika izsaukts vai kļūda notika pirms to
      const splash = document.getElementById('splashScreen');
      if (splash) {
        splash.classList.add('hidden');
        splash.style.display = 'none';
      }
    }
    // Piespiedu sinhronizācija uzreiz pēc ielādes, lai iegūtu visjaunākos datus no Google Sheets
    if (navigator.onLine && this.sync) {
      setTimeout(async () => {
        try {
          let res = null;
          if (typeof this.sync.forceFullSync === 'function') {
            res = await this.sync.forceFullSync(() => {});
          } else if (typeof this.sync.reloadFromSheets === 'function') {
            res = await this.sync.reloadFromSheets(() => {});
          } else if (typeof this.sync.loadInitialData === 'function') {
            res = await this.sync.loadInitialData(() => {}, {}, { force: true });
          }
          if (res && !res.offline) {
            try { if (typeof this.sync.waitForMarks === 'function') await this.sync.waitForMarks(); } catch (e) {}
            await this.loadData();
            this.renderView();
          }
        } catch (e) {
          console.warn('[medicine] uzreizējā sinhronizācija kļūda:', e);
        }
      }, 300);
    }
    this._startAutoSync();
  }

  async loadData() {
    console.log('[MED] loadData start');
    try {
    [this.allClients, this.allEmployees, this.allMarks] = await Promise.all([
      this.db.getAll('klienti'),
      this.db.getAll('darbinieki'),
      this.db.getAll('atzimes')
    ]);
    console.log('[MED] loaded', this.allClients?.length, this.allMarks?.length);
    this._buildIndex();
    this._rebuildFilteredClientIds();
    } catch(e) { console.error('[MED] loadData err', e); throw e; }
  }

  _rebuildFilteredClientIds() {
    const term = (this.searchTerm || '').toLowerCase();
    this.filteredClientIds = this.allClients.filter(c => {
      const name = ((c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '')).trim().toLowerCase();
      return term ? name.indexOf(term) !== -1 : true;
    }).map(c => String(c.id || c.ID));
  }

  _buildIndex() {
    this._byClientField = new Map();
    this._byClient = new Map();
    this.allMarks.forEach(raw => {
      if (!raw) return;
      const clientId = String(raw.clientId || raw.klients_id || raw.klienti_id || '').trim();
      if (!clientId) return;
      const field = String(raw.field || raw.lauka_nosaukums || '').trim();
      if (!field) return;
      const item = {
        raw, clientId, field,
        value: raw.value !== undefined && raw.value !== null ? raw.value : raw.vertiba,
        date: this._markDate(raw),
        time: String(raw.time || raw.laiks || '').slice(0, 5),
        ts: raw.lastModified || raw.pedeja_laiks || raw.created || 0
      };
      let list = this._byClient.get(clientId); if (!list) { list = []; this._byClient.set(clientId, list); }
      list.push(item);
      let byField = this._byClientField.get(clientId); if (!byField) { byField = new Map(); this._byClientField.set(clientId, byField); }
      let series = byField.get(field); if (!series) { series = []; byField.set(field, series); }
      series.push(item);
    });
    const bySort = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
    this._byClient.forEach(list => list.sort(bySort));
    this._byClientField.forEach(byField => byField.forEach(series => series.sort(bySort)));
  }

  _markDate(m) {
    if (!m) return '';
    // Prefer explicit ISO date fields
    const nl = m.notikuma_laiks || m.notikumaLaiks || '';
    const nlIso = String(nl).match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
    if (nlIso) return nlIso[1] + '-' + nlIso[2] + '-' + nlIso[3];
    const raw = m.date || m.datums || m.lastModified || m.pedeja_laiks || '';
    const s = String(raw);
    const iso = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    const ymd = s.match(/^(\\d{4})\\.(\\d{1,2})\\.(\\d{1,2})/);
    if (ymd) return ymd[1] + '-' + String(ymd[3]).padStart(2,'0') + '-' + String(ymd[2]).padStart(2,'0');
    const lv = s.match(/^(\\d{2})\\.(\\d{2})\\.(\\d{4})/);
    if (lv) return lv[3] + '-' + lv[2] + '-' + lv[1];
    // Timezone-aware conversion for timestamps (Riga)
    if (typeof TimezoneUtils !== 'undefined' && TimezoneUtils.formatDateRiga) {
      const tz = TimezoneUtils.formatDateRiga(s);
      if (tz) return tz;
    }
    const idTs = String(m.id || '').match(/^[a-z]+_(\\d{10,13})/);
    if (idTs) {
      const d = new Date(parseInt(idTs[1], 10));
      if (!isNaN(d.getTime()) && typeof TimezoneUtils !== 'undefined' && TimezoneUtils.formatDateRiga) {
        const tz = TimezoneUtils.formatDateRiga(d);
        if (tz) return tz;
      }
      if (!isNaN(d.getTime())) return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    return '';
  }

  _today() {
    if (typeof TimezoneUtils !== 'undefined' && TimezoneUtils.getTodayRiga) return TimezoneUtils.getTodayRiga();
    const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  _val(v) { return v === undefined || v === null ? '' : String(v); }

  _getLatestByClient(clientId, date) {
    const day = date || this._today();
    const fields = this._byClientField.get(String(clientId));
    const out = {};
    if (!fields) return out;
    MEDICINE_FIELDS.forEach(f => {
      const series = fields.get(f.key) || [];
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].date === day) { out[f.key] = series[i]; break; }
      }
    });
    return out;
  }

  _latestKnownValue(cid, day, fieldKey) {
    const target = new Date(day + 'T00:00:00');
    for (let i = 1; i <= 7; i++) {
      const d = new Date(target);
      d.setDate(d.getDate() - i);
      const iso = this._iso(d);
      const latest = this._getLatestByClient(cid, iso);
      const it = latest[fieldKey];
      if (it && it.value !== '' && it.value !== null && it.value !== undefined) return { it, sourceDay: iso };
    }
    return null;
  }

  _getItemsOnDate(clientId, date) {
    const list = this._byClient.get(String(clientId)) || [];
    return list.filter(i => i.date === date);
  }

  _clientStatusOnDate(cid, day) {
    let worst = 'none';
    let hasAny = false;
    MEDICINE_FIELDS.forEach(f => {
      const latest = this._getLatestByClient(cid, day)[f.key];
      if (!latest) return;
      hasAny = true;
      if (isCrit(f.key, latest.value)) { worst = 'crit'; return; }
      if (worst !== 'crit') worst = 'ok';
    });
    if (!hasAny) return 'none';
    return worst;
  }

  _clientAttentionOnDate(cid, day) {
    const items = this._getItemsOnDate(cid, day);
    return items.some(i => {
      const cat = String(i.category || i.kategorija || (i.raw && (i.raw.category || i.raw.kategorija)) || '').toLowerCase();
      const field = String(i.field || i.lauka_nosaukums || (i.raw && (i.raw.field || i.raw.lauka_nosaukums)) || '').toLowerCase();
      return cat === 'pievienot' || field === 'uzmaniba';
    });
  }

  renderAll() {
    console.log('[MED] renderAll');
    this._wireTabs();
    this.renderClientFilter();
    this.renderFieldFilter();
    this.renderDateDefault();
    this.renderView();
  }

  renderClientFilter() {
    const sel = document.getElementById('mhClientFilter');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="" data-i18n="allClients">Visi klienti</option>';
    this.allClients.forEach(c => {
      const id = String(c.id || c.ID);
      const name = ((c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '')).trim() || ('ID: ' + id);
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (current && Array.from(sel.options).some(o => o.value === current)) sel.value = current;
  }

  renderFieldFilter() {
    const sel = document.getElementById('mhFieldFilter');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Visi lauki</option>';
    MEDICINE_FIELDS.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.key;
      opt.textContent = f.label + ' ' + (f.unit || '');
      sel.appendChild(opt);
    });
    if (current && Array.from(sel.options).some(o => o.value === current)) sel.value = current;
    if (!this._fieldWired) {
      sel.onchange = () => { this.selectedField = sel.value || ''; this.renderView(); };
      this._fieldWired = true;
    }
  }
  renderDateDefault() {
    const el = document.getElementById('mhDateFilter');
    if (el && !el.value) el.value = this._today();
  }

  renderAttention() {
    const box = document.getElementById('mhAttentionList');
    const countEl = document.getElementById('mhAttnCount');
    if (!box) return;
    const day = document.getElementById('mhDateFilter').value || this._today();
    const items = [];
    this.filteredClientIds.forEach(cid => {
      const c = this.allClients.find(x => String(x.id || x.ID) === cid);
      if (!c) return;
      const crit = this._clientStatusOnDate(cid, day) === 'crit';
      const attn = this._clientAttentionOnDate(cid, day);
      if (crit || attn) items.push({ cid, name: this._clientName(c), crit, attn });
    });
    // Noņemt dublikātus pēc klienta ID
    const seen = new Set();
    const unique = items.filter(it => {
      if (seen.has(it.cid)) return false;
      seen.add(it.cid);
      return true;
    });
    unique.sort((a, b) => a.name.localeCompare(b.name));
    if (countEl) countEl.textContent = unique.length;
    if (!unique.length) {
      box.innerHTML = '<div class="mh-empty">Nav klientu, kam šodien nepieciešama uzmanība.</div>';
      return;
    }
    let html = '';
    unique.forEach(it => {
      html += '<div class="mh-attn-item ' + (it.crit ? 'mh-attn-crit' : 'mh-attn-warn') + '" onclick="medicineView.openClientDetail(\'' + it.cid.replace(/'/g, "\\'") + '\', \'' + day + '\');" style="cursor:pointer;">';
      html += '<span class="mh-attn-dot">' + (it.crit ? '🔴' : '🟡') + '</span>';
      html += '<span class="mh-attn-name">' + this.escapeHtml(it.name) + '</span>';
      html += '<span class="mh-attn-reason">' + (it.crit ? 'Objektīvs kritērijs šodien' : 'Manuāli atzīmēts uzmanībai') + '</span>';
      html += '</div>';
    });
    box.innerHTML = html;
  }

  _toggleCategoryView() {
    const main = document.querySelector('.mh-data-section');
    const cat = document.getElementById('mhCatSection');
    if (this.category === 'all') {
      if (main) main.style.display = '';
      if (cat) cat.style.display = 'none';
    } else {
      if (main) main.style.display = 'none';
      if (cat) cat.style.display = '';
      this.renderCategoryTable();
    }
  }

  renderCategoryTable() {
    const head = document.getElementById('mhCatHead');
    const body = document.getElementById('mhCatBody');
    const title = document.getElementById('mhCatTitle');
    const count = document.getElementById('mhCatCount');
    if (!head || !body) return;
    const day = document.getElementById('mhDateFilter').value || this._today();
    const fields = MEDICINE_FIELDS.filter(f => f.cat === this.category);
    if (title) title.textContent = '📋 ' + (this.category === 'temp' ? 'Temperatūra' : this.category === 'food' ? 'Ēdienreizes' : this.category === 'fluid' ? 'Šķidrumi' : 'Fizioloģija');
    let th = '<tr><th class="mh-th-client">Klients</th>';
    fields.forEach(f => { th += '<th class="mh-th-field">' + f.label + ' ' + (f.unit || '') + '</th>'; });
    th += '<th class="mh-th-time">Atjaunots</th></tr>';
    head.innerHTML = th;

    const list = [];
    this.filteredClientIds.forEach(cid => {
      const c = this.allClients.find(x => String(x.id || x.ID) === cid);
      if (!c) return;
      list.push({ cid, c, name: this._clientName(c) });
    });
    list.sort((a, b) => a.name.localeCompare(b.name));
    let html = '';
    list.forEach(({ cid, c, name }) => {
      const latest = this._getLatestByClient(cid, day);
      const items = this._getItemsOnDate(cid, day);
      const last = items.length ? items[items.length - 1] : null;
      html += '<tr onclick="medicineView.openClientDetail(\'' + cid.replace(/\'/g, "\\'") + '\', \'' + day + '\');" style="cursor:pointer;">';
      html += '<td class="mh-td-client"><span class="mh-client-name">' + this.escapeHtml(name) + '</span></td>';
      fields.forEach(f => {
        const it = latest[f.key];
        const crit = it && isCrit(f.key, it.value);
        html += '<td class="mh-td-val ' + (crit ? 'mh-val-crit' : '') + '">' + this._renderValCell(it, f) + '</td>';
      });
      html += '<td class="mh-td-time">' + (last ? (last.date + (last.time ? ' ' + last.time : '')) : '–') + '</td>';
      html += '</tr>';
    });
    body.innerHTML = html || '<tr><td colspan="' + (fields.length + 2) + '" class="mh-empty">Nav datu.</td></tr>';
    if (count) count.textContent = list.length + ' klienti';
  }
  renderDataQuality() {
    const el = document.getElementById('mhDataQuality');
    if (!el) return;
    const day = document.getElementById('mhDateFilter').value || this._today();
    let unmatched = 0;
    this.allMarks.forEach(m => {
      const cid = String(m.clientId || m.klients_id || m.klienti_id || '').trim();
      const d = this._markDate(m);
      if (!cid || !d) unmatched++;
    });
    let noData = 0;
    this.filteredClientIds.forEach(cid => {
      const latest = this._getLatestByClient(cid, day);
      if (!Object.keys(latest).length) noData++;
    });
    el.textContent = 'Datu kvalitāte: ' + this.allMarks.length + ' atzīmes, ' + unmatched + ' bez piesaistes; ' + noData + ' klienti bez datiem šodien.';
  }
  renderView() {
    console.log('[MED] renderView', this.view, this.category);
    const splash = document.getElementById('splashScreen');
    if (splash) splash.classList.add('hidden');
    this.renderAttention();
    this.renderDataQuality();
    if (this.category !== 'all') {
      const tabs = document.getElementById('mhCatTabs');
      if (tabs) tabs.style.display = 'none';
      this._toggleCategoryView();
      return;
    }
    const main = document.querySelector('.mh-data-section');
    if (main) main.style.display = '';
    ['mhViewDay', 'mhViewWeek', 'mhViewMonth'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const active = document.getElementById('mhView' + this.view.charAt(0).toUpperCase() + this.view.slice(1));
    if (active) active.style.display = 'block';
    if (this.view === 'day') this.renderDay();
    else if (this.view === 'week') this.renderWeek();
    else this.renderMonth();
  }

  // ════════════════════════════════════════════════════════════════════
  // DIENAS SKATS
  // ════════════════════════════════════════════════════════════════════

  renderDay() {
    const day = document.getElementById('mhDateFilter').value || this._today();
    document.getElementById('mhDayDateLabel').textContent = this._fmtDayLabel(day);
    const tbody = document.getElementById('mhDayBody');
    if (!tbody) return;
    const list = [];
    this.filteredClientIds.forEach(cid => {
      const c = this.allClients.find(x => String(x.id || x.ID) === cid);
      if (!c) return;
      list.push({ cid, c, name: this._clientName(c) });
    });
    list.sort((a, b) => a.name.localeCompare(b.name));

    let html = '';
    if (!list.length) {
      html = '<tr><td colspan="11" class="mh-empty">Nav klientu atbilstoši filtram.</td></tr>';
    } else {
      list.forEach(({ cid, c, name }) => {
        const latest = this._getLatestByClient(cid, day);
        const items = this._getItemsOnDate(cid, day);
        const attn = this._clientAttentionOnDate(cid, day);
        const worst = this._clientStatusOnDate(cid, day);
        const rowClass = worst === 'crit' ? 'mh-row-crit' : (worst === 'ok' ? 'mh-row-ok' : 'mh-row-none');
        const attnCls = attn ? ' mh-row-attn' : '';
        html += '<tr class="' + rowClass + attnCls + '" onclick="medicineView.openClientDetail(\'' + cid.replace(/'/g, "\\'") + '\', \'' + day + '\');" style="cursor:pointer;">';
        html += '<td class="mh-td-client"><span class="mh-client-name">' + this.escapeHtml(name) + '</span>' + (attn ? ' <span class="mh-attn-dot" title="Manuāli atzīmēts uzmanībai">🟡</span>' : '') + '</td>';
         MEDICINE_FIELDS.filter(f => this.category === 'all' || f.cat === this.category).forEach(f => {
           const it = latest[f.key];
          const crit = it && isCrit(f.key, it.value);
          html += '<td class="mh-td-val ' + (crit ? 'mh-val-crit' : '') + '">' + this._renderValCell(it, f) + '</td>';
        });
        const last = items.length ? items[items.length - 1] : null;
        html += '<td class="mh-td-time">' + (last ? (last.date + (last.time ? ' ' + last.time : '')) : '–') + '</td>';
        html += '</tr>';
      });
    }
    tbody.innerHTML = html;
    document.getElementById('mhDataTitle').textContent = '📋 Diena — ' + this._fmtDayLabel(day);
    document.getElementById('mhDataCount').textContent = list.length + ' klienti';
  }

  _renderValCell(it, f) {
    if (!it) return '<span class="mh-empty-cell">–</span>';
    const crit = isCrit(f.key, it.value);
    const unit = f.unit ? (' ' + f.unit) : '';
    return '<span class="mh-val ' + (crit ? 'mh-val-crit' : '') + '">' + this.escapeHtml(this._val(it.value)) + '</span>' +
      '<span class="mh-unit">' + this.escapeHtml(unit) + '</span>' +
      (it.time ? '<span class="mh-time">' + this.escapeHtml(it.time) + '</span>' : '');
  }

  // ════════════════════════════════════════════════════════════════════
  // NEDĒĻAS SKATS — 7 dienas kolonnas, klienti rindās
  // ════════════════════════════════════════════════════════════════════

  renderWeek() {
    const start = this._weekStart(document.getElementById('mhDateFilter').value || this._today());
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push(this._iso(d));
    }
    document.getElementById('mhWeekHeader').textContent = this._fmtWeekLabel(days[0], days[6]);

    const thead = document.querySelector('#mhWeekTable thead');
    const tbody = document.getElementById('mhWeekBody');
    if (!thead || !tbody) return;

    // Build header
    let thHtml = '<th class="mh-th-client" data-i18n="client">Klients</th>';
    days.forEach(d => {
      const dd = new Date(d);
      const dayName = ['Sv','Pirm','Otr','Treš','Cetur','Piekt','Sest'][dd.getDay()];
      thHtml += '<th class="mh-th-week-day"><div class="mh-week-dayname">' + dayName + '</div><div class="mh-week-daynum">' + dd.getDate() + '.' + String(dd.getMonth() + 1).padStart(2, '0') + '</div></th>';
    });
    thead.innerHTML = '<tr>' + thHtml + '</tr>';

    const list = [];
    this.filteredClientIds.forEach(cid => {
      const c = this.allClients.find(x => String(x.id || x.ID) === cid);
      if (!c) return;
      list.push({ cid, c, name: this._clientName(c) });
    });
    list.sort((a, b) => a.name.localeCompare(b.name));

    let html = '';
    if (!list.length) {
      html = '<tr><td colspan="8" class="mh-empty">Nav klientu atbilstoši filtram.</td></tr>';
    } else {
      list.forEach(({ cid, c, name }) => {
        html += '<tr class="mh-week-client-row" onclick="medicineView.openClientDetail(\'' + cid.replace(/'/g, "\\'") + '\');" style="cursor:pointer;">';
        html += '<td class="mh-td-client"><span class="mh-client-name">' + this.escapeHtml(name) + '</span></td>';
        days.forEach(day => {
          const worst = this._clientStatusOnDate(cid, day);
          const attn = this._clientAttentionOnDate(cid, day);
          const latest = this._getLatestByClient(cid, day);
          const parts = [];
          MEDICINE_FIELDS.forEach(f => {
            const it = latest[f.key];
            if (it && it.value !== '' && it.value !== null && it.value !== undefined) {
              parts.push(f.label + this._val(it.value) + (f.unit ? f.unit : ''));
            }
          });
          const tip = parts.length ? (name + ' — ' + day + ' — ' + parts.join(', ')) : (name + ' — ' + day + ' — nav datu');
          let cellClass = 'mh-week-cell ' + (worst === 'crit' ? 'mh-cell-crit' : worst === 'ok' ? 'mh-cell-ok' : 'mh-cell-none');
          if (attn) cellClass += ' mh-cell-attn';
          let show = '';
          if (this.selectedField && latest[this.selectedField]) {
            show = MEDICINE_FIELDS.find(x=>x.key===this.selectedField).label + this._val(latest[this.selectedField].value);
          } else if (parts.length) {
            show = parts[0];
          } else {
            const fk = MEDICINE_FIELDS[0].key;
            const known = this._latestKnownValue(cid, day, fk);
            if (known) show = '~' + MEDICINE_FIELDS[0].label + this._val(known.it.value);
            else show = (worst === 'none' ? '–' : '');
          }
          html += '<td class="' + cellClass + '" title="' + this.escapeHtml(tip) + '">' + this.escapeHtml(show) + '</td>';
        });
        html += '</tr>';
      });
    }
    tbody.innerHTML = html;
    document.getElementById('mhDataTitle').textContent = '📅 Nedēļa — ' + this._fmtWeekLabel(days[0], days[6]);
    document.getElementById('mhDataCount').textContent = list.length + ' klienti';
  }

  // ════════════════════════════════════════════════════════════════════
  // MĒNEŠA SKATS — klienti rindās, mēneša dienas kolonnas (heatmap)
  // ════════════════════════════════════════════════════════════════════

  renderMonth() {
    const dateVal = document.getElementById('mhDateFilter').value || this._today();
    const y = parseInt(dateVal.slice(0, 4), 10);
    const m = parseInt(dateVal.slice(5, 7), 10) - 1;
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const totalDays = last.getDate();
    const startWeekday = first.getDay(); // 0=Sun

    document.getElementById('mhMonthHeader').textContent = this._fmtMonthLabel(y, m);

    const thead = document.querySelector('#mhMonthTable thead');
    const tbody = document.getElementById('mhMonthBody');
    if (!thead || !tbody) return;

    let thHtml = '<th class="mh-th-client" data-i18n="client">Klients</th>';
    for (let d = 1; d <= totalDays; d++) thHtml += '<th class="mh-th-month-day">' + d + '</th>';
    thead.innerHTML = '<tr>' + thHtml + '</tr>';

    const list = [];
    this.filteredClientIds.forEach(cid => {
      const c = this.allClients.find(x => String(x.id || x.ID) === cid);
      if (!c) return;
      list.push({ cid, c, name: this._clientName(c) });
    });
    list.sort((a, b) => a.name.localeCompare(b.name));

    let html = '';
    if (!list.length) {
      html = '<tr><td colspan="' + (totalDays + 1) + '" class="mh-empty">Nav klientu atbilstoši filtram.</td></tr>';
    } else {
      list.forEach(({ cid, c, name }) => {
        html += '<tr class="mh-month-client-row" onclick="medicineView.openClientDetail(\'' + cid.replace(/'/g, "\\'") + '\');" style="cursor:pointer;">';
        html += '<td class="mh-td-client"><span class="mh-client-name">' + this.escapeHtml(name) + '</span></td>';
        for (let d = 1; d <= totalDays; d++) {
          const dayStr = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
          const worst = this._clientStatusOnDate(cid, dayStr);
          const attn = this._clientAttentionOnDate(cid, dayStr);
          const latest = this._getLatestByClient(cid, dayStr);
          let cellClass = 'mh-month-cell ' + (worst === 'crit' ? 'mh-cell-crit' : worst === 'ok' ? 'mh-cell-ok' : 'mh-cell-none');
          if (attn) cellClass += ' mh-cell-attn';
          const parts = [];
          MEDICINE_FIELDS.forEach(f => {
            const it = latest[f.key];
            if (it && it.value !== '' && it.value !== null && it.value !== undefined) parts.push(f.label + this._val(it.value));
          });
          const tip = parts.length ? (name + ' — ' + dayStr + ' — ' + parts.join(', ')) : (name + ' — ' + dayStr + ' — nav datu');
          let show = '';
          if (this.selectedField && latest[this.selectedField]) {
            show = MEDICINE_FIELDS.find(x=>x.key===this.selectedField).label + this._val(latest[this.selectedField].value);
          } else if (parts.length) {
            show = parts[0];
          } else {
            const fk = MEDICINE_FIELDS[0].key;
            const known = this._latestKnownValue(cid, dayStr, fk);
            if (known) show = '~' + MEDICINE_FIELDS[0].label + this._val(known.it.value);
          }
          html += '<td class="' + cellClass + '" title="' + this.escapeHtml(tip) + '">' + this.escapeHtml(show) + '</td>';
        }
        html += '</tr>';
      });
    }
    tbody.innerHTML = html;
    document.getElementById('mhDataTitle').textContent = '🗓️ Mēnesis — ' + this._fmtMonthLabel(y, m);
    document.getElementById('mhDataCount').textContent = list.length + ' klienti';
  }

  // ════════════════════════════════════════════════════════════════════
  // KLIEŅA DETĀĻA SKATS
  // ════════════════════════════════════════════════════════════════════

  openClientDetail(cid, day) {
    this.selectedClientId = cid;
    document.getElementById('mhViewDay').style.display = 'none';
    document.getElementById('mhViewWeek').style.display = 'none';
    document.getElementById('mhViewMonth').style.display = 'none';
    const detail = document.getElementById('mhClientDetail');
    if (detail) detail.style.display = 'block';
    document.querySelectorAll('.mh-view-btn').forEach(b => b.classList.remove('active'));
    this.renderClientDetail(cid, day || (document.getElementById('mhDateFilter').value || this._today()));
  }

  closeClientDetail() {
    this.selectedClientId = null;
    const detail = document.getElementById('mhClientDetail');
    if (detail) detail.style.display = 'none';
    document.getElementById('mhViewDay').style.display = 'block';
    document.getElementById('mhViewWeek').style.display = 'none';
    document.getElementById('mhViewMonth').style.display = 'none';
    document.querySelectorAll('.mh-view-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.mh-view-btn[data-view="day"]').classList.add('active');
    this.renderView();
  }

  renderClientDetail(cid, day) {
    const c = this.allClients.find(x => String(x.id || x.ID) === cid);
    if (!c) return;
    const name = this._clientName(c);

    document.getElementById('mhDetailName').textContent = name;
    document.getElementById('mhDetailMeta').textContent = 'ID: ' + cid;
    document.getElementById('mhDetailDate').textContent = this._fmtDayLabel(day);

    const latest = this._getLatestByClient(cid, day);
    const items = this._getItemsOnDate(cid, day);

    const kpiEl = document.getElementById('mhDetailKpis');
    kpiEl.innerHTML = '';
    MEDICINE_FIELDS.forEach(f => {
      const it = latest[f.key];
      const crit = it && isCrit(f.key, it.value);
      const div = document.createElement('div');
      div.className = 'mh-kpi ' + (crit ? 'mh-kpi-crit' : '') + (it ? '' : ' mh-kpi-empty');
      div.innerHTML = '<div class="mh-kpi-val">' + (it ? this.escapeHtml(this._val(it.value)) : '–') + '</div>' +
        '<div class="mh-kpi-label">' + f.label + ' ' + (f.unit ? f.unit : '') + '</div>' +
        (it && it.time ? '<div class="mh-kpi-time">' + this.escapeHtml(it.time) + '</div>' : '');
      kpiEl.appendChild(div);
    });

    const blocksEl = document.getElementById('mhDetailBlocks');
    blocksEl.innerHTML = '';

    // Timeline of all entries that day
    const tl = document.createElement('div');
    tl.className = 'mh-detail-section';
    tl.innerHTML = '<h3 class="mh-detail-section-title">Ieraksti dienas <span class="mh-detail-section-day">' + this._fmtDayLabel(day) + '</span></h3>';
    if (items.length) {
      const tbl = document.createElement('table');
      tbl.className = 'mh-detail-table';
      let th = '<thead><tr><th>Laiks</th><th>Lauks</th><th>Vērtība</th><th>Statuss</th></tr></thead>';
      let tb = '<tbody>';
      items.forEach(it => {
        const f = FIELD_BY_KEY.get(it.field);
        const label = f ? f.label + ' ' + (f.unit || '') : it.field;
        const crit = f && isCrit(it.field, it.value);
        tb += '<tr class="' + (crit ? 'mh-detail-row-crit' : '') + '">' +
          '<td class="mh-detail-time">' + this.escapeHtml(it.time) + '</td>' +
          '<td class="mh-detail-field">' + this.escapeHtml(label) + '</td>' +
          '<td class="mh-detail-val">' + this.escapeHtml(this._val(it.value)) + '</td>' +
          '<td class="mh-detail-status"><span class="mh-status-dot ' + (crit ? 'mh-status-crit' : 'mh-status-ok') + '"></span>' + (crit ? 'Kritiski' : 'Normāli') + '</td>' +
          '</tr>';
      });
      tb += '</tbody>';
      tbl.innerHTML = th + tb;
      tl.appendChild(tbl);
    } else {
      tl.innerHTML += '<div class="mh-empty">Nav ierakstīts neviens datums šajā dienā.</div>';
    }
    blocksEl.appendChild(tl);

    // Attention flag
    const attn = this._clientAttentionOnDate(cid, day);
    if (attn) {
      const box = document.createElement('div');
      box.className = 'mh-attention-box';
      box.innerHTML = '<span class="mh-attn-dot">🟡</span> <strong>Manuāli atzīmēts uzmanībai</strong> — aprūpētājs ir pievēris medicīnisko uzmanību.';
      blocksEl.appendChild(box);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // TABS + UI WIRING
  // ════════════════════════════════════════════════════════════════════

  _wireTabs() {
    document.querySelectorAll('.mh-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.selectedClientId) this.closeClientDetail();
        document.querySelectorAll('.mh-view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.view = btn.dataset.view;
        this.renderView();
      });
    });
  }

  _wireUi() {
    const search = document.getElementById('mhClientSearch');
    if (search) {
      search.oninput = () => { this.searchTerm = search.value; this._rebuildFilteredClientIds(); this.renderView(); };
    }
    const clientFilter = document.getElementById('mhClientFilter');
    if (clientFilter) {
      clientFilter.onchange = () => {
        const val = clientFilter.value;
        if (val) {
          this.selectedClientId = val;
          document.getElementById('mhViewDay').style.display = 'none';
          document.getElementById('mhViewWeek').style.display = 'none';
          document.getElementById('mhViewMonth').style.display = 'none';
          const detail = document.getElementById('mhClientDetail');
          if (detail) detail.style.display = 'block';
          document.querySelectorAll('.mh-view-btn').forEach(b => b.classList.remove('active'));
          this.renderClientDetail(val, document.getElementById('mhDateFilter').value || this._today());
        } else {
          this.selectedClientId = null;
          document.getElementById('mhClientDetail').style.display = 'none';
          document.getElementById('mhViewDay').style.display = 'block';
          document.querySelectorAll('.mh-view-btn').forEach(b => b.classList.remove('active'));
          document.querySelector('.mh-view-btn[data-view="day"]').classList.add('active');
    this.view = 'day';
    const params = new URLSearchParams(window.location.search);
    this.category = params.get('cat') || 'all';
          this.renderView();
        }
      };
    }
    const date = document.getElementById('mhDateFilter');
    if (date) {
      date.onchange = () => {
        if (this.selectedClientId) {
          this.renderClientDetail(this.selectedClientId, date.value || this._today());
        } else {
          this.renderView();
        }
      };
    }
    const refresh = document.getElementById('mhRefreshBtn');
    if (refresh) {
      refresh.onclick = async () => {
      if (!navigator.onLine) { this._setStatus('Nav savienojuma'); return; }
      refresh.disabled = true; this._setStatus('Sinhronizē...');
      try {
        let result = null;
        if (typeof this.sync.forceFullSync === 'function') {
          result = await this.sync.forceFullSync((msg) => this._setStatus(msg));
        } else if (typeof this.sync.reloadFromSheets === 'function') {
          result = await this.sync.reloadFromSheets((msg) => this._setStatus(msg));
        } else if (typeof this.sync.loadInitialData === 'function') {
          result = await this.sync.loadInitialData((msg) => this._setStatus(msg), {}, { force: true });
        }
        if (result && result.offline) { this._setStatus('Sinhronizācija neizdevās'); }
        else { try { if (typeof this.sync.waitForMarks === 'function') await this.sync.waitForMarks(); } catch (e) {} await this.loadData(); this.renderView(); this._setStatus(null); }
      } catch (err) { this._setStatus('Kļūda: ' + err.message); }
      finally { refresh.disabled = false; }
      };
    }
    document.querySelectorAll('.mh-cat-tab').forEach(btn => {
      btn.onclick = () => {
        const cat = btn.dataset.cat;
        if (cat === 'all') {
          window.location.href = 'medicine.html';
        } else {
          window.open('medicine.html?cat=' + cat, '_blank');
        }
      };
    });
    const back = document.getElementById('btnBack');
    if (back) back.onclick = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const medBack = document.getElementById('mhBackToList');
    if (medBack) medBack.onclick = () => { this.closeClientDetail(); };
  }

  setupUI() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (window.Logout) {
          const pending = await (async () => { try { if (window.careSync) return (await window.careSync.getUnsyncedItems()).length; } catch (err) { } return 0; })();
          const ok = await Logout.confirm({ pending });
          if (ok) Logout.performLogout();
        } else {
          sessionStorage.removeItem('careUser');
          window.location.href = 'index.html';
        }
      });
    }
    const syncBtn = document.getElementById('manualSyncBtn');
    if (syncBtn) {
      syncBtn.style.display = navigator.onLine ? 'inline-flex' : 'none';
      window.addEventListener('online', () => { syncBtn.style.display = 'inline-flex'; });
      window.addEventListener('offline', () => { syncBtn.style.display = 'none'; });
      syncBtn.addEventListener('click', async () => {
        if (!navigator.onLine) { this._setStatus('Nav savienojuma'); return; }
      syncBtn.disabled = true; this._setStatus('Sinhronizē...');
      try {
        let result = null;
        if (typeof this.sync.forceFullSync === 'function') {
          result = await this.sync.forceFullSync((msg) => this._setStatus(msg));
        } else if (typeof this.sync.reloadFromSheets === 'function') {
          result = await this.sync.reloadFromSheets((msg) => this._setStatus(msg));
        } else if (typeof this.sync.loadInitialData === 'function') {
          result = await this.sync.loadInitialData((msg) => this._setStatus(msg), {}, { force: true });
        }
        if (result && result.offline) { this._setStatus('Sinhronizācija neizdevās'); }
        else { try { if (typeof this.sync.waitForMarks === 'function') await this.sync.waitForMarks(); } catch (e) {} await this.loadData(); this.renderView(); this._setStatus(null); }
      } catch (err) { this._setStatus('Kļūda'); }
        finally { syncBtn.disabled = false; }
      });
    }
    this._wireUi();
  }

  setupLanguageSwitcher() {
    document.querySelectorAll('.mh-lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        if (lang && typeof setLang === 'function') {
          setLang(lang);
          document.querySelectorAll('.mh-lang-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });
    if (typeof applyLanguage === 'function') applyLanguage();
  }

  _startAutoSync() {
    if (this._autoSyncTimer) {
      try { clearInterval(this._autoSyncTimer); } catch (e) {}
      this._autoSyncTimer = null;
    }
    const run = async () => {
      if (this._autoSyncRunning) return;
      if (document.hidden) return;
      if (!navigator.onLine) return;
      if (!this.sync) return;
      this._autoSyncRunning = true;
      try {
        let result = null;
        if (typeof this.sync.forceFullSync === 'function') {
          result = await this.sync.forceFullSync(() => {});
        } else if (typeof this.sync.reloadFromSheets === 'function') {
          result = await this.sync.reloadFromSheets(() => {});
        } else if (typeof this.sync.loadInitialData === 'function') {
          result = await this.sync.loadInitialData(() => {}, {}, { force: true });
        }
        if (!result || result.offline) return;
        try { if (typeof this.sync.waitForMarks === 'function') await this.sync.waitForMarks(); } catch (e) {}
        await this.loadData();
        this.renderView();
      } catch (e) {
        // Klusi ignorēt, lai neapgrūtinātu UI
        console.warn('[medicine] autoSync kļūda:', e);
      } finally {
        this._autoSyncRunning = false;
      }
    };
    run();
    this._autoSyncTimer = setInterval(run, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) {
        run();
      }
    });
    window.addEventListener('online', () => {
      if (!document.hidden) run();
    });
  }

  _setStatus(msg) {
    const el = document.getElementById('mhStatus');
    if (!el) return;
    if (msg) { el.textContent = '🔄 ' + msg; el.style.display = 'block'; }
    else { el.style.display = 'none'; }
  }

  // ════════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════════

  _clientName(c) {
    return ((c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '')).trim() || ('ID: ' + (c.id || c.ID));
  }

  _weekStart(iso) {
    const d = new Date(iso + 'T00:00:00');
    const day = d.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day); // Monday start
    d.setDate(d.getDate() + diff);
    return d;
  }

  _iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  _fmtDayLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    const names = ['Svētdiena','Pirmdiena','Otrdiena','Trešdiena','Ceturtdiena','Piektdiena','Sestdiena'];
    const months = ['janv','febr','marts','apr','maijs','jūnijs','jūlijs','aug','sept','okt','nov','dec'];
    return names[d.getDay()] + ', ' + d.getDate() + '. ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  _fmtWeekLabel(start, end) {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    const months = ['janv','febr','marts','apr','maijs','jūnijs','jūlijs','aug','sept','okt','nov','dec'];
    return s.getDate() + '. ' + months[s.getMonth()] + ' – ' + e.getDate() + '. ' + months[e.getMonth()] + ' ' + e.getFullYear();
  }

  _fmtMonthLabel(y, m) {
    const months = ['janvāris','februāris','marts','aprīlis','maijs','jūnijs','jūlijs','augusts','septembris','oktobris','novembris','decembris'];
    return months[m] + ' ' + y;
  }

  escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  render() { this.renderAll(); }
}

let medicineView;
document.addEventListener('DOMContentLoaded', () => { 
  console.log('[MED] DOMContentLoaded, creating MedicineView');
  medicineView = new MedicineView(); 
});

// Additional compatibility
if(typeof window!== undefined){window.MedicineView=MedicineView;}
