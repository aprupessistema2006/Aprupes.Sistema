class CareFormController {
  constructor() {
    this.db = null;
    this.sync = null;
    this.client = null;
    this.clientId = null;
    this.currentShift = this.detectCurrentShift();
    this.marks = new Map();
    this.currentUser = null;
    this.history = [];
    this.init();
  }

  detectCurrentShift() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 19) return 'R';
    return 'V';
  }

  setupShiftAutoUpdate() {
    const applyShift = () => {
      const detected = this.detectCurrentShift();
      const tabs = document.querySelectorAll('.shift-tab');
      tabs.forEach(t => {
        const isActive = t.dataset.shift === detected;
        t.classList.toggle('active', isActive);
        t.classList.toggle('auto-detected', isActive);
      });
      this.currentShift = detected;
      if (this.marks) this.updateCategoryStatuses();
    };

    applyShift();

    setInterval(applyShift, 60000);
  }

  async init() {
    const userData = sessionStorage.getItem('careUser');
    if (!userData) {
      window.location.href = 'index.html';
      return;
    }
    this.currentUser = JSON.parse(userData);

    const params = new URLSearchParams(window.location.search);
    this.clientId = params.get('client');
    if (!this.clientId) {
      window.location.href = 'aprupe.html';
      return;
    }

    this.db = new CareDB();
    await this.db.init();
    window.careDB = this.db;
    this.sync = new SyncManager(this.db, CONFIG);
    window.careSync = this.sync;

    window.addEventListener('syncStatusChange', (e) => {
      const badge = document.getElementById('syncStatus');
      if (badge) badge.textContent = e.detail;
    });

    this.setupEventListeners();
    await this.loadClient();
    await this.loadMarks();
    await this.loadHistory();
    await this.loadAllClientMarks();
    this.renderForm();
    this.renderHistory();
    this.renderSignature();
    this.updateTeamSummary();
    this.renderQuickTotals();
    this.renderTaskBanner();

    this.sync.loadInitialData().then(async () => {
      await new Promise(r => setTimeout(r, 200));
      await this.loadClient();
      await this.loadMarks();
      await this.loadHistory();
      await this.loadAllClientMarks();
      this.renderForm();
      this.renderHistory();
      this.renderSignature();
      this.updateTeamSummary();
      this.renderQuickTotals();
      this.renderTaskBanner();
      this.toast('✓ Dati sinhronizēti ar serveri');
    });
  }

  async renderTaskBanner() {
    const container = document.getElementById('taskBannerContainer');
    if (!container || !window.TaskManager || !this.currentUser) return;
    await window.TaskManager.loadAll();
    const html = window.TaskManager.renderBanner(this.currentUser, this.clientId);
    container.innerHTML = html;
    container.querySelectorAll('.task-complete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const taskId = btn.dataset.taskId;
        btn.disabled = true;
        btn.textContent = '⏳ Saglabā...';
        await window.TaskManager.complete(taskId, this.currentUser.id);
        this.toast('✓ Uzdevums atzīmēts kā izdarīts');
        await this.renderTaskBanner();
        await this.loadHistory();
        this.renderHistory();
      });
    });
  }

  updateTeamSummary() {
    const el = document.getElementById('teamSummary');
    if (!el) return;
    const employees = new Set();
    this.history.forEach(h => {
      if (h.employeeId && h.employeeId !== this.currentUser.id) {
        employees.add(h.employeeId);
      }
    });
    const total = this.history.length;
    const mineCount = this.history.filter(h => h.employeeId === this.currentUser.id).length;
    const othersCount = total - mineCount;
    if (total === 0) {
      el.innerHTML = '<em style="color:#999">Vēl nav ierakstu par šo klientu šodien. Pievieno pirmo!</em>';
    } else {
      const empNames = Array.from(employees).map(eid => this.empMap[eid] || ('ID: ' + eid));
      const namesList = empNames.length > 0
        ? '<br>👥 <strong>Komanda:</strong> ' + empNames.join(', ')
        : '';
      el.innerHTML =
        '📊 <strong>Šodienas komandas darbs:</strong> ' + total + ' ieraksti' +
        ' (' + mineCount + ' mani, ' + othersCount + ' citi)' + namesList;
    }
  }

  setupEventListeners() {
    document.getElementById('backBtn').addEventListener('click', () => {
      window.location.href = 'aprupe.html';
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        if (e) e.preventDefault();
        if (window.Logout) {
          const pending = await (async () => {
            try {
              if (window.careSync) {
                const items = await window.careSync.getUnsyncedItems();
                return items.length;
              }
            } catch (err) {}
            return 0;
          })();
          const ok = await Logout.confirm({ pending });
          if (ok) Logout.performLogout();
        } else {
          sessionStorage.removeItem('careUser');
          window.location.href = 'index.html';
        }
      });
    }

    document.querySelectorAll('.shift-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.shift-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentShift = e.target.dataset.shift;
        this.renderForm();
      });
    });

    document.getElementById('signBtn').addEventListener('click', () => {
      this.handleSign();
    });
  }

  async loadClient() {
    this.client = await this.db.get('klienti', this.clientId);
    if (!this.client) {
      const allClients = await this.db.getAll('klienti');
      console.log('[care_form] clientId from URL:', this.clientId, 'type:', typeof this.clientId);
      console.log('[care_form] all clients:', allClients.map(c => ({ id: c.id, ID: c.ID, vards: c.vards, uzvards: c.uzvards })));
      this.client = allClients.find(c => c.id === this.clientId || c.ID === this.clientId || String(c.id) === String(this.clientId));
    }
    if (!this.client) {
      console.warn('[care_form] client not found for id:', this.clientId);
      this.toast('Klients nav atrasts');
      setTimeout(() => window.location.href = 'aprupe.html', 1500);
      return;
    }

    const vards = this.client.vards || this.client.Vārds || '';
    const uzvards = this.client.uzvards || this.client.Uzvārds || '';
    document.getElementById('clientName').textContent = vards + ' ' + uzvards;
    document.getElementById('clientName2').textContent = vards + ' ' + uzvards;
    document.getElementById('clientDob').textContent = 'Dzimis: ' + this.formatDob(this.client.dzimis || this.client['Dzimšanas datums']);
    const diet = this.client.dieta || this.client.Diēta || '';
    const saskarsme = this.client.saskarsmes || this.client['Saskarsmes īpatnības'] || '';
    document.getElementById('clientDiet').textContent = diet || 'Diēta nav norādīta';
    document.getElementById('clientDiet').classList.toggle('empty', !diet);
    document.getElementById('clientSaskarsme').textContent = saskarsme || 'Saskarsme nav norādīta';
    document.getElementById('clientSaskarsme').classList.toggle('empty', !saskarsme);
  }

  formatDob(dob) {
    if (!dob) return 'Dzimšanas datums nav norādīts';
    const d = new Date(dob);
    if (isNaN(d.getTime())) return dob;
    return d.toLocaleDateString('lv-LV');
  }

  extractDate(v) {
    if (!v) return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      if (v.getFullYear() < 1900) return '';
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, '0');
      const d = String(v.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.substring(0, 10);
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {
        const p = v.split('.');
        return p[2] + '-' + p[1] + '-' + p[0];
      }
    }
    return v;
  }

  extractTimeForSort(t) {
    if (!t) return '';
    if (t instanceof Date) {
      if (isNaN(t.getTime())) return '';
      return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    }
    if (typeof t === 'string') {
      if (/^\d{2}:\d{2}/.test(t)) return t.substring(0, 5);
      const m = t.match(/T(\d{2}):(\d{2})/);
      if (m) return m[1] + ':' + m[2];
    }
    return String(t);
  }

  extractTimeDisplay(t) {
    if (!t) return '';
    if (t instanceof Date) {
      if (isNaN(t.getTime())) return '';
      return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    }
    if (typeof t === 'string') {
      if (/^\d{2}:\d{2}:\d{2}/.test(t)) return t.substring(0, 8);
      if (/^\d{2}:\d{2}/.test(t)) return t.substring(0, 5);
      const m = t.match(/T(\d{2}):(\d{2}):(\d{2})/);
      if (m) return m[1] + ':' + m[2] + ':' + m[3];
      const m2 = t.match(/T(\d{2}):(\d{2})/);
      if (m2) return m2[1] + ':' + m2[2];
    }
    return String(t);
  }

  async loadMarks() {
    const today = this.getToday();
    const allMarks = await this.db.getAll('atzimes');
    console.log('[care_form] loadMarks: clientId=' + this.clientId + ' total=' + allMarks.length);
    this.marks.clear();
    let matched = 0;
    allMarks.filter(m => this.clientIdsMatch(m, this.clientId))
            .filter(m => {
              if (this.isRecent(m, today)) { matched++; return true; }
              return false;
            })
            .forEach(m => {
              const shift = m.shift || m.periods;
              const key = shift + '|' + m.category + '|' + m.field;
              this.marks.set(key, m);
            });
    console.log('[care_form] loadMarks: matched=' + matched + ' marks.size=' + this.marks.size);
  }

  isRecent(m, today) {
    const primary = [
      this.extractDate(m.pedeja_laiks),
      this.extractDate(m.lastModified),
      this.extractDate(m.created),
      this.extractDate(m.izveidots)
    ].filter(Boolean);
    if (primary.length === 0) {
      const fallback = [
        this.extractDate(m.date),
        this.extractDate(m.datums)
      ].filter(Boolean);
      if (fallback.length === 0) return true;
      if (fallback.includes(today)) return true;
      for (let i = 1; i <= 7; i++) {
        if (fallback.includes(this.getOffsetDate(-i))) return true;
      }
      return false;
    }
    if (primary.includes(today)) return true;
    for (let i = 1; i <= 7; i++) {
      if (primary.includes(this.getOffsetDate(-i))) return true;
    }
    return false;
  }

  getToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  getOffsetDate(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  clientIdsMatch(mark, clientId) {
    if (!mark) return false;
    const ids = [mark.clientId, mark.klients_id, mark.klienti_id];
    const result = ids.includes(clientId);
    if (!result && ids.some(x => x)) {
      console.log('[care_form] clientIdsMatch miss: mark.cid=' + JSON.stringify(ids) + ' wanted=' + clientId);
    }
    return result;
  }

  async loadHistory() {
    const today = this.getToday();
    const allLog = await this.db.getAll('atzimes_log');
    this.history = allLog
      .filter(l => this.clientIdsMatch(l, this.clientId))
      .filter(l => this.isRecent(l, today))
      .sort((a, b) => {
        const ta = this.extractTimeForSort(a.time);
        const tb = this.extractTimeForSort(b.time);
        return tb.localeCompare(ta);
      });

    const employees = await this.db.getAll('darbinieki');
    const empMap = {};
    employees.forEach(e => {
      const id = e.id || e.ID;
      const uzvards = e.uzvards || e.Uzvārds || '';
      empMap[id] = uzvards;
    });
    this.empMap = empMap;
  }

  getMark(shift, category, field) {
    return this.marks.get(shift + '|' + category + '|' + field);
  }

  renderForm() {
    this.updateCategoryStatuses();
  }

  updateCategoryStatuses() {
    const shift = this.currentShift;
    const lastByFor = (mark) => {
      if (!mark || !mark.lastBy) return '';
      const name = this.empMap[mark.lastBy] || '';
      if (!name) return '';
      return ' <span style="font-size:10px;color:#888;font-weight:normal;">(' + name + ')</span>';
    };

    const tempMark = this.getMark(shift, 'temp', 'temperatura');
    const tempEl = document.getElementById('status-temp');
    if (tempEl) {
      if (tempMark && tempMark.value) {
        const v = parseFloat(tempMark.value);
        if (!isNaN(v) && v >= 37) {
          tempEl.innerHTML = '🔥 ' + tempMark.value + '°C' + lastByFor(tempMark);
          tempEl.className = 'cat-status alert';
        } else {
          tempEl.innerHTML = '✓ ' + tempMark.value + '°C' + lastByFor(tempMark);
          tempEl.className = 'cat-status completed';
        }
      } else {
        tempEl.textContent = 'Nav mērīts';
        tempEl.className = 'cat-status';
      }
    }

    const higienaFields = CONFIG.FIELD_DEFINITIONS.higiena.fields;
    const higienaDone = higienaFields.filter(f => this.getMark(shift, 'higiena', f.field)).length;
    const higienaEl = document.getElementById('status-higiena');
    if (higienaEl) {
      if (higienaDone === higienaFields.length) {
        higienaEl.textContent = '✓ Viss pabeigts';
        higienaEl.className = 'cat-status completed';
      } else if (higienaDone > 0) {
        higienaEl.textContent = higienaDone + ' / ' + higienaFields.length;
        higienaEl.className = 'cat-status';
      } else {
        higienaEl.textContent = 'Nav sākts';
        higienaEl.className = 'cat-status';
      }
    }

    const aktFields = CONFIG.FIELD_DEFINITIONS.aktivitate.fields;
    const aktDone = aktFields.filter(f => this.getMark(shift, 'aktivitate', f.field)).length;
    const aktEl = document.getElementById('status-aktivitate');
    if (aktEl) {
      if (aktDone === aktFields.length) {
        aktEl.textContent = '✓ Viss pabeigts';
        aktEl.className = 'cat-status completed';
      } else if (aktDone > 0) {
        aktEl.textContent = aktDone + ' / ' + aktFields.length;
        aktEl.className = 'cat-status';
      } else {
        aktEl.textContent = 'Nav sākts';
        aktEl.className = 'cat-status';
      }
    }

    const edinFields = CONFIG.FIELD_DEFINITIONS.edinasana.fields;
    const edinDone = edinFields.filter(f => this.getMark(shift, 'edinasana', f.field)).length;
    const edinEl = document.getElementById('status-edinasana');
    if (edinEl) {
      if (edinDone === edinFields.length) {
        edinEl.textContent = '✓ Visas ēdienreizes';
        edinEl.className = 'cat-status completed';
      } else if (edinDone > 0) {
        edinEl.textContent = edinDone + ' / ' + edinFields.length;
        edinEl.className = 'cat-status';
      } else {
        edinEl.textContent = 'Nav sākts';
        edinEl.className = 'cat-status';
      }
    }

    const urins = this.getMark(shift, 'sikdrumi', 'urina_daudzums');
    const uznemts = this.getMark(shift, 'sikdrumi', 'uznemts_ml');
    const sikEl = document.getElementById('status-sikdrumi');
    if (sikEl) {
      if (urins || uznemts) {
        const latest = urins && uznemts
          ? (urins.lastModified > uznemts.lastModified ? urins : uznemts)
          : (urins || uznemts);
        sikEl.innerHTML = '✓ Ierakstīts' + lastByFor(latest);
        sikEl.className = 'cat-status completed';
      } else {
        sikEl.textContent = 'Nav ierakstu';
        sikEl.className = 'cat-status';
      }
    }

    const fizMark = this.getMark(shift, 'fiziologija', 'vedera_izeja');
    const fizEl = document.getElementById('status-fiziologija');
    if (fizEl) {
      if (fizMark && fizMark.value) {
        fizEl.innerHTML = '✓ ' + fizMark.value + lastByFor(fizMark);
        fizEl.className = 'cat-status completed';
      } else {
        fizEl.textContent = 'Nav ieraksta';
        fizEl.className = 'cat-status';
      }
    }

    const autins = this.getMark(shift, 'citsi_pasakomi', 'autins_biksitu_skaits');
    const diapersEl = document.getElementById('status-diapers');
    if (diapersEl) {
      if (autins && autins.value) {
        diapersEl.innerHTML = '✓ ' + autins.value + ' maiņas' + lastByFor(autins);
        diapersEl.className = 'cat-status completed';
      } else {
        diapersEl.textContent = 'Nav maiņu';
        diapersEl.className = 'cat-status';
      }
    }

    const markAda = this.getMark(shift, 'citsi_pasakomi', 'adas_kopsana');
    const adaEl = document.getElementById('status-ada');
    if (adaEl) {
      if (markAda && markAda.value === 'X') {
        adaEl.textContent = '✓ Veikta';
        adaEl.className = 'cat-status completed';
      } else {
        adaEl.textContent = 'Nav veikta';
        adaEl.className = 'cat-status';
      }
    }

    const markPastaiga = this.getMark(shift, 'citsi_pasakomi', 'pastaigas');
    const pastaigaEl = document.getElementById('status-pastaiga');
    if (pastaigaEl) {
      if (markPastaiga && markPastaiga.value === 'X') {
        pastaigaEl.textContent = '✓ Bijusi';
        pastaigaEl.className = 'cat-status completed';
      } else {
        pastaigaEl.textContent = 'Nav bijis';
        pastaigaEl.className = 'cat-status';
      }
    }

    const markCiemini = this.getMark(shift, 'citsi_pasakomi', 'ciemini');
    const cieminiEl = document.getElementById('status-ciemini');
    if (cieminiEl) {
      if (markCiemini && markCiemini.value) {
        cieminiEl.innerHTML = '✓ ' + markCiemini.value + lastByFor(markCiemini);
        cieminiEl.className = 'cat-status completed';
      } else {
        cieminiEl.textContent = 'Nav ieraksta';
        cieminiEl.className = 'cat-status';
      }
    }
  }

  setupEventListeners() {
    document.getElementById('backBtn').addEventListener('click', () => {
      window.location.href = 'aprupe.html';
    });

    document.querySelectorAll('.shift-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.shift-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentShift = e.currentTarget.dataset.shift;
        this.updateCategoryStatuses();
      });
    });

    this.setupShiftAutoUpdate();

    document.getElementById('signBtn').addEventListener('click', () => {
      this.handleSign();
    });

    document.querySelectorAll('.category-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const cat = e.currentTarget.dataset.cat;
        this.openCategoryModal(cat);
      });
    });

    document.getElementById('modalClose').addEventListener('click', () => {
      this.closeCategoryModal();
    });
    document.getElementById('categoryModal').addEventListener('click', (e) => {
      if (e.target.id === 'categoryModal') this.closeCategoryModal();
    });
  }

  openCategoryModal(cat) {
    const modal = document.getElementById('categoryModal');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');
    const shift = this.currentShift;
    const titles = {
      temp: '🌡️ Temperatūra',
      higiena: '🧼 Higiēna',
      aktivitate: '🚶 Aktivitāte',
      edinasana: '🍽️ Ēdīšana',
      sikdrumi: '💧 Šķidrumi',
      fiziologija: '🚽 Vēdera izeja',
      ada: '🧴 Ādas kopšana',
      pastaiga: '🌳 Pastaiga',
      ciemini: '👥 Ciemiņi',
      diapers: '🧻 Autiņbikšu maiņa'
    };
    title.textContent = titles[cat] || cat;
    let html = '';
    if (cat === 'temp') html = this.renderTempSection(shift);
    else if (cat === 'higiena') html = this.renderHigienaSection(shift);
    else if (cat === 'aktivitate') html = this.renderAktivitateSection(shift);
    else if (cat === 'edinasana') html = this.renderEdinasanaSection(shift);
    else if (cat === 'sikdrumi') html = this.renderSikdrumiSection(shift);
    else if (cat === 'fiziologija') html = this.renderFiziologijaSection(shift);
    else if (cat === 'ada') html = this.renderAdaSection(shift);
    else if (cat === 'pastaiga') html = this.renderPastaigaSection(shift);
    else if (cat === 'ciemini') html = this.renderCieminiSection(shift);
    else if (cat === 'diapers') html = this.renderDiapersSection(shift);
    body.innerHTML = html;
    modal.style.display = 'flex';
    this.bindFormEvents();
    if (cat === 'sikdrumi') this.attachSikdrumiHandlers();
  }

  closeCategoryModal() {
    document.getElementById('categoryModal').style.display = 'none';
    this.updateCategoryStatuses();
  }

  sectionCard(cssClass, emoji, title, statusKey, body) {
    let status = '';
    if (statusKey) {
      const completed = this.isSectionCompleted(statusKey);
      status = completed ? '<span class="section-status completed">Pabeigts</span>' : '<span class="section-status">Aktīvs</span>';
    }
    return `<div class="section-card ${cssClass}">
      <div class="section-header">
        <div class="section-title"><span class="section-emoji">${emoji}</span><span>${title}</span></div>
        ${status}
      </div>
      ${body}
    </div>`;
  }

  isSectionCompleted(sectionKey) {
    if (sectionKey === 'temp') {
      const m = this.getMark(this.currentShift, 'temp', 'temperatura');
      return m && m.value !== '';
    }
    if (sectionKey === 'edinasana') {
      const fields = CONFIG.FIELD_DEFINITIONS.edinasana.fields;
      return fields.some(f => {
        const m = this.getMark(this.currentShift, 'edinasana', f.field);
        return m && m.value;
      });
    }
    return false;
  }

  renderTempSection(shift) {
    const mark = this.getMark(shift, 'temp', 'temperatura');
    const value = mark ? mark.value : '';
    const numVal = parseFloat(value);
    const isFever = !isNaN(numVal) && numVal >= 37;

    const body = `
      <div class="section-row">
        <div class="section-row-label">
          <span>Temperatūra (°C)</span>
          <span class="current-value ${value ? (isFever ? 'fever' : '') : 'empty'}">${value ? (isFever ? '🔥 ' + value + '°C' : '✓ ' + value + '°C') : ''}</span>
        </div>
        <input type="number" step="0.1" min="30" max="45" class="number-input temp-input ${isFever ? 'fever' : ''} ${value ? 'has-value' : ''}" data-cat="temp" data-field="temperatura" data-shift="${shift}" value="${value}" placeholder="36.6">
        <button class="submit-btn" data-submit="temp">✓ Saglabāt temperatūru</button>
      </div>
      <div class="section-row" style="border-bottom: none;">
        <div class="field-info">
          <strong>Norma:</strong> 36.0 - 37.0°C<br>
          <strong>Drudzis:</strong> virs 37.0°C (iezīmējas sarkanā krāsā)<br>
          <strong>Padoms:</strong> ievadi vērtību un nospied "Saglabāt temperatūru"
        </div>
      </div>
    `;
    return this.sectionCard('section-temp', '🌡️', 'Temperatūra', 'temp', body);
  }

  renderHigienaSection(shift) {
    const fields = CONFIG.FIELD_DEFINITIONS.higiena.fields;
    let body = '';
    fields.forEach(f => {
      const mark = this.getMark(shift, 'higiena', f.field);
      const hasValue = mark && mark.value === 'X';
      body += `
        <div class="section-row">
          <div class="section-row-label">
            <span>${f.label}</span>
            <span class="current-value ${hasValue ? '' : 'empty'}">${hasValue ? '✓ Izpildīts' : ''}</span>
          </div>
          <div class="opt-group">
            <button class="opt-btn ${hasValue ? 'active' : ''}" data-cat="higiena" data-field="${f.field}" data-value="X" data-shift="${shift}">
              ${hasValue ? '✓' : 'X'}
            </button>
          </div>
        </div>
      `;
    });
    return this.sectionCard('section-higiena', '🧼', 'Higiēna', null, body);
  }

  renderAktivitateSection(shift) {
    const fields = CONFIG.FIELD_DEFINITIONS.aktivitate.fields;
    let body = '';
    fields.forEach(f => {
      const mark = this.getMark(shift, 'aktivitate', f.field);
      const hasValue = mark && mark.value === 'X';
      body += `
        <div class="section-row">
          <div class="section-row-label">
            <span>${f.label}</span>
            <span class="current-value ${hasValue ? '' : 'empty'}">${hasValue ? '✓' : ''}</span>
          </div>
          <div class="opt-group">
            <button class="opt-btn ${hasValue ? 'active' : ''}" data-cat="aktivitate" data-field="${f.field}" data-value="X" data-shift="${shift}">
              ${hasValue ? '✓' : 'X'}
            </button>
          </div>
        </div>
      `;
    });
    return this.sectionCard('section-aktivitate', '🚶', 'Aktivitāte', null, body);
  }

  renderEdinasanaSection(shift) {
    const fields = CONFIG.FIELD_DEFINITIONS.edinasana.fields;
    let body = '';
    fields.forEach(f => {
      const mark = this.getMark(shift, 'edinasana', f.field);
      const current = mark ? mark.value : '';
      const valueLabel = current === 'X' ? '✓ Visa' : current === '½' ? '½ Puse' : current === 'A' ? '✗ Atteicās' : '';
      body += `
        <div class="section-row">
          <div class="section-row-label">
            <span>${f.label}</span>
            <span class="current-value ${valueLabel ? '' : 'empty'}">${valueLabel}</span>
          </div>
          <div class="opt-group">
            <button class="opt-btn ${current === 'X' ? 'active' : ''}" data-cat="edinasana" data-field="${f.field}" data-value="X" data-shift="${shift}">X</button>
            <button class="opt-btn food-half ${current === '½' ? 'active' : ''}" data-cat="edinasana" data-field="${f.field}" data-value="½" data-shift="${shift}">½</button>
            <button class="opt-btn refused ${current === 'A' ? 'active' : ''}" data-cat="edinasana" data-field="${f.field}" data-value="A" data-shift="${shift}">A</button>
          </div>
        </div>
      `;
    });
    return this.sectionCard('section-edinasana', '🍽️', 'Ēdīšana', 'edinasana', body);
  }

  renderSikdrumiSection(shift) {
    const urinsMark = this.getMark(shift, 'sikdrumi', 'urina_daudzums');
    const uznemtsMark = this.getMark(shift, 'sikdrumi', 'uznemts_ml');
    const body = `
      <div class="section-row">
        <div class="section-row-label">
          <span>Diennakts urīna daudzums (ml)</span>
          ${urinsMark && urinsMark.value ? `<span class="current-value">${urinsMark.value} ml</span>` : '<span class="current-value empty"></span>'}
        </div>
        <input type="number" min="0" step="50" class="number-input sikdrumi-input ${urinsMark && urinsMark.value ? 'has-value' : ''}" data-cat="sikdrumi" data-field="urina_daudzums" data-shift="${shift}" value="${urinsMark ? urinsMark.value : ''}" placeholder="0">
      </div>
      <div class="section-row">
        <div class="section-row-label">
          <span>Uzņemts H2O (24h, ml)</span>
          ${uznemtsMark && uznemtsMark.value ? `<span class="current-value">${uznemtsMark.value} ml</span>` : '<span class="current-value empty"></span>'}
        </div>
        <input type="number" min="0" step="50" class="number-input sikdrumi-input ${uznemtsMark && uznemtsMark.value ? 'has-value' : ''}" data-cat="sikdrumi" data-field="uznemts_ml" data-shift="${shift}" value="${uznemtsMark ? uznemtsMark.value : ''}" placeholder="0">
        <button class="submit-btn" data-submit="sikdrumi">✓ Saglabāt šķidrumus</button>
      </div>
      <div class="section-row" style="border-bottom: none;">
        <div class="field-info">
          <strong>Urīna daudzums:</strong> parasti 1000-2000 ml dienā pieaugušajam.<br>
          <strong>Uzņemtais šķidrums:</strong> ūdens, tēja, zupa u.c. dzērieni.<br>
          <strong>Padoms:</strong> ievadi abus laukus un nospied "Saglabāt šķidrumus".
        </div>
      </div>
    `;
    return this.sectionCard('section-sikdrumi', '💧', 'Šķidrumi', null, body);
  }

  renderFiziologijaSection(shift) {
    const mark = this.getMark(shift, 'fiziologija', 'vedera_izeja');
    const current = mark ? mark.value : '';
    const labels = { 'N': 'Normāla', 'A': 'Aizcietējums', 'S': 'Svecīte', 'C': 'Caureja', 'K': 'Klizma' };
    const valueLabel = labels[current] || '';
    const descriptions = {
      'N': 'Normāla vēdera izeja — bez sarežģījumiem',
      'A': 'Aizcietējums — grūtības ar vēdera izeju',
      'S': 'Svecīte — izmantota svecīte',
      'C': 'Caureja — šķidra vēdera izeja',
      'K': 'Klizma — veikta klizma'
    };
    const body = `
      <div class="section-row">
        <div class="section-row-label">
          <span>Vērtība</span>
          <span class="current-value ${valueLabel ? '' : 'empty'}">${valueLabel}</span>
        </div>
        <div class="opt-group">
          <button class="opt-btn fiziologija-select ${current === 'N' ? 'selected' : ''}" data-select="fiziologija" data-value="N" data-shift="${shift}">
            <strong>N</strong> Normāla
          </button>
          <button class="opt-btn fiziologija-select ${current === 'A' ? 'selected' : ''}" data-select="fiziologija" data-value="A" data-shift="${shift}">
            <strong>A</strong> Aizcietējums
          </button>
          <button class="opt-btn fiziologija-select ${current === 'S' ? 'selected' : ''}" data-select="fiziologija" data-value="S" data-shift="${shift}">
            <strong>S</strong> Svecīte
          </button>
          <button class="opt-btn fiziologija-select ${current === 'C' ? 'selected' : ''}" data-select="fiziologija" data-value="C" data-shift="${shift}">
            <strong>C</strong> Caureja
          </button>
          <button class="opt-btn fiziologija-select ${current === 'K' ? 'selected' : ''}" data-select="fiziologija" data-value="K" data-shift="${shift}">
            <strong>K</strong> Klizma
          </button>
        </div>
        <div id="fiziologijaDesc" class="fiziologija-desc ${current ? 'visible' : ''}">${current ? descriptions[current] : 'Izvēlieties vienu no opcijām un nospiediet "Saglabāt".'}</div>
        <button class="submit-btn" data-submit="fiziologija" ${current ? '' : 'disabled'}>✓ Saglabāt izvēli</button>
      </div>
      <div class="section-row" style="border-bottom: none;">
        <div class="field-info">
          Šī sadaļa apraksta vēdera izejas veidu. Izvēlieties atbilstošo burtu un nospiediet "Saglabāt izvēli". Pirms saglabāšanas nekas netiek ierakstīts.
        </div>
      </div>
    `;
    return this.sectionCard('section-fiziologija', '🚽', 'Vēdera izeja', null, body);
  }

  renderAdaSection(shift) {
    const markAda = this.getMark(shift, 'citsi_pasakomi', 'adas_kopsana');
    const hasValue = markAda && markAda.value === 'X';
    const body = `
      <div class="section-row" style="border-bottom: none;">
        <div class="section-row-label">
          <span>Ādas kopšanas līdzekļi uzklāti</span>
          <span class="current-value ${hasValue ? '' : 'empty'}">${hasValue ? '✓ Veikta' : ''}</span>
        </div>
        <div class="opt-group">
          <button class="opt-btn ${hasValue ? 'active' : ''}" data-cat="citsi_pasakomi" data-field="adas_kopsana" data-value="X" data-shift="${shift}">
            ${hasValue ? '✓ Jā, veikta' : 'X Nospiest, kad veikta'}
          </button>
        </div>
      </div>
    `;
    return this.sectionCard('section-citi', '🧴', 'Ādas kopšana', null, body);
  }

  renderPastaigaSection(shift) {
    const markPastaiga = this.getMark(shift, 'citsi_pasakomi', 'pastaigas');
    const hasValue = markPastaiga && markPastaiga.value === 'X';
    const body = `
      <div class="section-row" style="border-bottom: none;">
        <div class="section-row-label">
          <span>Pastaiga svaigā gaisā</span>
          <span class="current-value ${hasValue ? '' : 'empty'}">${hasValue ? '✓ Bijusi' : ''}</span>
        </div>
        <div class="opt-group">
          <button class="opt-btn ${hasValue ? 'active' : ''}" data-cat="citsi_pasakomi" data-field="pastaigas" data-value="X" data-shift="${shift}">
            ${hasValue ? '✓ Jā, bijusi' : 'X Nospiest, kad bijis'}
          </button>
        </div>
      </div>
    `;
    return this.sectionCard('section-citi', '🌳', 'Pastaiga', null, body);
  }

  renderCieminiSection(shift) {
    const markCiemini = this.getMark(shift, 'citsi_pasakomi', 'ciemini');
    const current = markCiemini ? markCiemini.value : '';
    const valueLabel = current === 'X' ? '✓ Jā' : current === 'Nē' ? '✓ Nē' : '';
    const body = `
      <div class="section-row" style="border-bottom: none;">
        <div class="section-row-label">
          <span>Vai bija ciemiņi šodien?</span>
          <span class="current-value ${valueLabel ? '' : 'empty'}">${valueLabel}</span>
        </div>
        <div class="opt-group">
          <button class="opt-btn ${current === 'X' ? 'active' : ''}" data-cat="citsi_pasakomi" data-field="ciemini" data-value="X" data-shift="${shift}">Jā, bija</button>
          <button class="opt-btn refused ${current === 'Nē' ? 'active' : ''}" data-cat="citsi_pasakomi" data-field="ciemini" data-value="Nē" data-shift="${shift}">Nē, nebija</button>
        </div>
      </div>
    `;
    return this.sectionCard('section-citi', '👥', 'Ciemiņi', null, body);
  }

  renderDiapersSection(shift) {
    const markAutins = this.getMark(shift, 'citsi_pasakomi', 'autins_biksitu_skaits');
    const count = markAutins && markAutins.value ? markAutins.value : '0';
    const body = `
      <div class="section-row">
        <div class="section-row-label">
          <span>Maiņu skaits šodien</span>
          <span class="current-value" id="diaperCountDisplay">${count}</span>
        </div>
        <button class="opt-btn diaper-btn" data-cat="citsi_pasakomi" data-field="autins_biksitu_skaits" data-shift="${shift}">
          <span class="diaper-icon">🧻</span>
          <span>+1 maiņa</span>
        </button>
      </div>
      <div class="section-row" style="border-bottom: none;">
        <div style="font-size:13px;color:var(--text-light);text-align:center;padding:8px;">
          Nospied pogu pēc katras Autiņbikšu maiņas.<br>
          Katra maiņa tiek reģistrēta vēsturē ar laiku un aprūpētāja vārdu.
        </div>
      </div>
    `;
    return this.sectionCard('section-citi', '🧻', 'Higiēnas maiņa', null, body);
  }

  bindFormEvents() {
    document.querySelectorAll('.opt-btn:not(.diaper-btn):not(.fiziologija-select)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cat = e.currentTarget.dataset.cat;
        const field = e.currentTarget.dataset.field;
        const value = e.currentTarget.dataset.value;
        const shift = e.currentTarget.dataset.shift;
        this.handleOptionSelect(shift, cat, field, value, e.currentTarget);
      });
    });

    document.querySelectorAll('.diaper-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cat = e.currentTarget.dataset.cat;
        const field = e.currentTarget.dataset.field;
        const shift = e.currentTarget.dataset.shift;
        this.handleDiaperIncrement(shift, cat, field, e.currentTarget);
      });
    });

    document.querySelectorAll('.fiziologija-select').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.fiziologija-select').forEach(b => b.classList.remove('selected'));
        e.currentTarget.classList.add('selected');
        const desc = document.getElementById('fiziologijaDesc');
        const descriptions = {
          'N': 'Normāla vēdera izeja — bez sarežģījumiem',
          'A': 'Aizcietējums — grūtības ar vēdera izeju',
          'S': 'Svecīte — izmantota svecīte',
          'C': 'Caureja — šķidra vēdera izeja',
          'K': 'Klizma — veikta klizma'
        };
        if (desc) {
          desc.textContent = descriptions[e.currentTarget.dataset.value] || '';
          desc.classList.add('visible');
        }
        const submitBtn = document.querySelector('[data-submit="fiziologija"]');
        if (submitBtn) submitBtn.disabled = false;
      });
    });

    document.querySelectorAll('.submit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.currentTarget.dataset.submit;
        if (type === 'temp') {
          const input = document.querySelector('input[data-cat="temp"][data-field="temperatura"]');
          if (input && input.value) {
            this.handleNumberChange('temp', 'temperatura', input.value, this.currentShift);
          } else {
            this.toast('Ievadiet temperatūras vērtību');
          }
        } else if (type === 'sikdrumi') {
          this.handleSikdrumiSubmit();
        } else if (type === 'fiziologija') {
          this.handleFiziologijaSubmit();
        }
      });
    });

    document.querySelectorAll('.number-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const submitType = input.dataset.cat === 'temp' ? 'temp' :
                            input.dataset.cat === 'sikdrumi' ? 'sikdrumi' : null;
          if (submitType) {
            const btn = document.querySelector('[data-submit="' + submitType + '"]');
            if (btn) btn.click();
          }
        }
      });
    });
  }

  async handleSikdrumiSubmit() {
    const urinsInput = document.querySelector('input[data-cat="sikdrumi"][data-field="urina_daudzums"]');
    const uznemtsInput = document.querySelector('input[data-cat="sikdrumi"][data-field="uznemts_ml"]');
    if (!urinsInput && !uznemtsInput) return;
    const urinsVal = urinsInput ? urinsInput.value : '';
    const uznemtsVal = uznemtsInput ? uznemtsInput.value : '';
    if (urinsVal === '' && uznemtsVal === '') {
      this.toast('Ievadiet vismaz vienu vērtību');
      return;
    }
    if (urinsVal !== '') {
      await this.saveMarkDirect('sikdrumi', 'urina_daudzums', urinsVal, this.currentShift);
    }
    if (uznemtsVal !== '') {
      await this.saveMarkDirect('sikdrumi', 'uznemts_ml', uznemtsVal, this.currentShift);
    }
    await this.loadAllClientMarks();
    await this.loadHistory();
    this.renderTaskBanner();
    this.renderQuickTotals();
    this.renderHistory();
    const modalBody = document.getElementById('modalBody');
    if (modalBody) {
      const shift = this.currentShift;
      modalBody.innerHTML = this.renderSikdrumiSection(shift) + this.renderFiziologijaSection(shift);
      this.attachSikdrumiHandlers();
    }
    this.toast('✓ Šķidrumi saglabāti');
  }

  async saveMarkDirect(category, field, value, shift) {
    await this.saveMark({
      clientId: this.clientId,
      shift: shift,
      category: category,
      field: field,
      value: value,
      prevValue: null,
      type: 'Jauns'
    });
  }

  attachSikdrumiHandlers() {
    const submitBtn = document.querySelector('button[data-submit="sikdrumi"]');
    if (submitBtn && !submitBtn.dataset.bound) {
      submitBtn.dataset.bound = '1';
      submitBtn.addEventListener('click', () => this.handleSikdrumiSubmit());
    }
  }

  async handleFiziologijaSubmit() {
    const selected = document.querySelector('.fiziologija-select.selected');
    if (!selected) {
      this.toast('Izvēlieties vērtību');
      return;
    }
    const value = selected.dataset.value;
    const shift = selected.dataset.shift;
    await this.handleOptionSelect(shift, 'fiziologija', 'vedera_izeja', value, selected);
  }

  async loadAllClientMarks() {
    const today = this.getToday();
    const allMarks = await this.db.getAll('atzimes');
    this.allClientMarks = allMarks.filter(m => {
      if (!this.clientIdsMatch(m, this.clientId)) return false;
      return this.isRecent(m, today);
    });

    const allLog = await this.db.getAll('atzimes_log');
    this.allClientLog = allLog.filter(l => {
      if (!this.clientIdsMatch(l, this.clientId)) return false;
      return this.isRecent(l, today);
    });
  }

  renderQuickTotals() {
    if (!this.allClientMarks) return;

    const fluidSum = this.allClientMarks
      .filter(m => m.category === 'sikdrumi' && (m.field === 'uznemts_ml' || m.field === 'uzņemts_ml' || m.field === 'uznemts_h2o'))
      .reduce((sum, m) => sum + (parseFloat(m.value) || 0), 0);

    const fluidLog = (this.allClientLog || [])
      .filter(l => l.category === 'sikdrumi' && (l.field === 'uznemts_ml' || l.field === 'uzņemts_ml' || l.field === 'uznemts_h2o'))
      .sort((a, b) => {
        const ta = this.extractTimeForSort(a.time) || a.created || '';
        const tb = this.extractTimeForSort(b.time) || b.created || '';
        return tb.localeCompare(ta);
      });
    const fluidLast = fluidLog[0];
    const fluidLastBy = fluidLast ? (this.empMap[fluidLast.employeeId] || '?') : null;
    const fluidTime = fluidLast ? this.extractTimeDisplay(fluidLast.time) : null;

    const fluidValue = document.getElementById('qtFluidValue');
    if (fluidValue) {
      fluidValue.innerHTML = Math.round(fluidSum) + ' <span class="qt-unit">ml</span>';
    }
    const fluidMeta = document.getElementById('qtFluidMeta');
    if (fluidMeta) {
      fluidMeta.textContent = fluidLastBy
        ? 'Pēdējais: ' + fluidLastBy + (fluidTime ? ' (' + fluidTime + ')' : '')
        : 'Vēl neviens nav ievadījis';
    }

    const stoolLog = (this.allClientLog || [])
      .filter(l => l.category === 'fiziologija' && l.field === 'vedera_izeja')
      .sort((a, b) => {
        const ta = this.extractTimeForSort(a.time) || a.created || '';
        const tb = this.extractTimeForSort(b.time) || b.created || '';
        return tb.localeCompare(ta);
      });
    const stoolValue = document.getElementById('qtStoolValue');
    if (stoolValue) {
      stoolValue.innerHTML = stoolLog.length + ' <span class="qt-unit">reizes</span>';
    }
    const stoolMeta = document.getElementById('qtStoolMeta');
    if (stoolMeta) {
      const last = stoolLog[0];
      if (last) {
        const labels = { 'N': 'Normāla', 'A': 'Aizcietējums', 'S': 'Svecīte', 'C': 'Caureja', 'K': 'Klizma' };
        const lastBy = this.empMap[last.employeeId] || '?';
        const valLabel = labels[last.value] || last.value;
        stoolMeta.textContent = 'Pēdējais: ' + valLabel + (last.time ? ' (' + this.extractTimeDisplay(last.time) + ')' : '');
      } else {
        stoolMeta.textContent = 'Vēl neviens nav ievadījis';
      }
    }

    const diaperMarks = this.allClientMarks
      .filter(m => m.category === 'citsi_pasakomi' && (m.field === 'autins_biksitu_skaits' || m.field === 'autiņbiksīšu_skaits'));
    const diaperLog = (this.allClientLog || [])
      .filter(l => l.category === 'citsi_pasakomi' && (l.field === 'autins_biksitu_skaits' || l.field === 'autiņbiksīšu_skaits'))
      .sort((a, b) => {
        const ta = this.extractTimeForSort(a.time) || a.created || '';
        const tb = this.extractTimeForSort(b.time) || b.created || '';
        return tb.localeCompare(ta);
      });
    const diaperValue = document.getElementById('qtDiaperValue');
    if (diaperValue) {
      const total = diaperMarks.length > 0
        ? Math.max(...diaperMarks.map(m => parseInt(m.value) || 0))
        : diaperLog.length;
      diaperValue.innerHTML = total + ' <span class="qt-unit">maiņas</span>';
    }
    const diaperMeta = document.getElementById('qtDiaperMeta');
    if (diaperMeta) {
      const last = diaperLog[0];
      if (last) {
        const lastBy = this.empMap[last.employeeId] || '?';
        diaperMeta.textContent = 'Pēdējais: ' + lastBy + (last.time ? ' (' + this.extractTimeDisplay(last.time) + ')' : '');
      } else {
        diaperMeta.textContent = 'Vēl neviens nav ievadījis';
      }
    }
  }

  async handleDiaperIncrement(shift, category, field, btn) {
    const key = shift + '|' + category + '|' + field;
    const existing = this.marks.get(key);
    const currentCount = existing ? parseInt(existing.value) || 0 : 0;
    const newCount = currentCount + 1;

    btn.classList.add('pulse');
    setTimeout(() => btn.classList.remove('pulse'), 300);

    await this.saveMark({
      clientId: this.clientId,
      shift: shift,
      category: category,
      field: field,
      value: String(newCount),
      prevValue: existing ? existing.value : null,
      type: existing ? 'Labots' : 'Jauns'
    });

    const logEntry = {
      id: this.db.generateId(),
      markId: 'diaper_' + Date.now(),
      clientId: this.clientId,
      employeeId: this.currentUser.id,
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().split(' ')[0],
      shift: shift,
      category: category,
      field: field,
      value: '+1 (kopā: ' + newCount + ')',
      type: 'Jauns',
      created: new Date().toISOString()
    };
    await this.db.add('atzimes_log', logEntry);

    this.sync.enqueueChange({
      action: 'mark',
      table: 'atzimes',
      data: {
        clientId: this.clientId,
        employeeId: this.currentUser.id,
        date: logEntry.date,
        shift: shift,
        category: category,
        field: field,
        value: String(newCount)
      }
    });

    this.toast('✓ Maiņa pievienota (' + newCount + ')');
    this.openCategoryModal('diapers');
    await this.loadAllClientMarks();
    await this.loadHistory();
    this.renderTaskBanner();
    this.renderQuickTotals();
    this.renderHistory();
  }

  async handleOptionSelect(shift, category, field, value, btn) {
    const key = shift + '|' + category + '|' + field;
    const existing = this.marks.get(key);

    if (existing && existing.value === value) {
      await this.saveMark({
        clientId: this.clientId,
        shift: shift,
        category: category,
        field: field,
        value: '',
        prevValue: value,
        type: 'Labots'
      });
      this.marks.delete(key);
    } else {
      await this.saveMark({
        clientId: this.clientId,
        shift: shift,
        category: category,
        field: field,
        value: value,
        prevValue: existing ? existing.value : null,
        type: existing ? 'Labots' : 'Jauns'
      });
    }

    const catMap = { temp: 'temp', higiena: 'higiena', aktivitate: 'aktivitate', edinasana: 'edinasana', sikdrumi: 'sikdrumi', fiziologija: 'fiziologija', citsi_pasakomi: 'citi' };
    const openCat = catMap[category];
    if (openCat && category !== 'fiziologija') {
      this.openCategoryModal(openCat);
    } else if (category === 'fiziologija') {
      const modal = document.getElementById('categoryModal');
      if (modal) modal.style.display = 'none';
      this.updateCategoryStatuses();
    }
    await this.loadAllClientMarks();
    await this.loadHistory();
    this.renderTaskBanner();
    this.renderQuickTotals();
    this.renderHistory();
    this.toast('Saglabāts');
  }

  async handleNumberChange(category, field, value, shiftOverride) {
    const shift = shiftOverride || this.currentShift;
    await this.saveMark({
      clientId: this.clientId,
      shift: shift,
      category: category,
      field: field,
      value: value,
      prevValue: null,
      type: 'Jauns'
    });
    this.toast('Saglabāts');
    await this.loadAllClientMarks();
    await this.loadHistory();
    this.renderTaskBanner();
    this.renderQuickTotals();
    this.renderHistory();
    if (typeof this.renderModalContent === 'function') {
      const catMap = { temp: 'temp', higiena: 'higiena', aktivitate: 'aktivitate', edinasana: 'edinasana', sikdrumi: 'sikdrumi', fiziologija: 'fiziologija', citsi_pasakomi: 'citi' };
      const openCat = catMap[category];
      if (openCat) this.renderModalContent(openCat);
    }
  }

  async saveMark(data) {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    const id = this.db.generateId();

    const mark = {
      id: id,
      clientId: data.clientId,
      employeeId: this.currentUser.id,
      date: today,
      shift: data.shift,
      category: data.category,
      field: data.field,
      value: data.value,
      lastModified: now.toISOString(),
      lastBy: this.currentUser.id
    };

    const key = data.shift + '|' + data.category + '|' + data.field;
    this.marks.set(key, mark);

    await this.db.put('atzimes', mark);

    const logEntry = {
      id: this.db.generateId(),
      markId: id,
      clientId: data.clientId,
      employeeId: this.currentUser.id,
      date: today,
      time: timeStr,
      shift: data.shift,
      category: data.category,
      field: data.field,
      value: data.value,
      prevValue: data.prevValue,
      type: data.type,
      created: now.toISOString()
    };
    await this.db.add('atzimes_log', logEntry);

    this.sync.enqueueChange({
      action: 'mark',
      table: 'atzimes',
      data: {
        clientId: data.clientId,
        employeeId: this.currentUser.id,
        date: today,
        shift: data.shift,
        category: data.category,
        field: data.field,
        value: data.value,
        reason: data.type === 'Labots' ? 'Labots' : null
      }
    });

    this.toast('Saglabāts');
  }

  renderHistory() {
    const container = document.getElementById('historyContainer');
    if (this.history.length === 0) {
      container.innerHTML = '<div class="loading">Nav ierakstu</div>';
      return;
    }

    container.innerHTML = this.history.map(entry => {
      const actor = this.empMap[entry.employeeId] || 'Nezināms';
      const fieldLabel = this.getFieldLabel(entry.category, entry.field);
      const valueDisplay = this.formatHistoryValue(entry.category, entry.field, entry.value);
      const isEdit = entry.type === 'Labots';
      const time = this.extractTimeDisplay(entry.time) || '';
      return `
        <div class="history-item">
          <div class="history-action">
            <strong>${this.escapeHtml(time)}</strong> – ${fieldLabel}: <strong>${valueDisplay}</strong>
            ${isEdit ? '<span class="history-edit-tag">Labots</span>' : ''}
          </div>
          <div class="history-actor">${this.escapeHtml(actor)}</div>
        </div>
      `;
    }).join('');
  }

  getFieldLabel(category, field) {
    if (category === 'temp' && field === 'temperatura') return 'Temperatūra';
    if (category === 'paraksts') return 'Paraksts';

    const cat = CONFIG.FIELD_DEFINITIONS[category];
    if (!cat || !cat.fields) return field;

    const f = cat.fields.find(x => x.field === field);
    return f ? f.label : field;
  }

  formatHistoryValue(category, field, value) {
    if (category === 'temp' && field === 'temperatura') {
      const v = parseFloat(value);
      if (!isNaN(v) && v >= 37) return `<span style="color:#e74c3c">${value}°C</span>`;
      return value || '-';
    }
    if (!value || value === '') return 'notīrīts';
    return value;
  }

  async renderSignature() {
    const signBtn = document.getElementById('signBtn');
    const signedBy = document.getElementById('signedBy');

    const signature = this.history.find(h => h.category === 'paraksts' && h.field === 'aprupetaja_paraksts');

    if (signature) {
      const actor = this.empMap[signature.employeeId] || 'Nezināms';
      signBtn.textContent = '🔄 Pārparakstīt';
      signBtn.classList.add('signed');
      signBtn.disabled = false;
      const who = actor === this.empMap[this.currentUser.id] ? 'Tu' : actor;
      signedBy.textContent = 'Diennakts paraksts: ' + who + ' (' + this.extractTimeDisplay(signature.time) + ')';
      signedBy.style.display = 'block';
    } else {
      signBtn.textContent = '✍️ Parakstīties';
      signBtn.classList.remove('signed');
      signBtn.disabled = false;
      signedBy.style.display = 'none';
    }
  }

  async handleSign() {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    const existing = this.history.find(h => h.category === 'paraksts' && h.field === 'aprupetaja_paraksts');
    const signatureValue = this.currentUser.uzvards || this.currentUser.vards || '';
    const isResign = !!existing;

    const mark = {
      id: existing ? existing.markId : this.db.generateId(),
      clientId: this.clientId,
      employeeId: this.currentUser.id,
      date: today,
      shift: 'D',
      category: 'paraksts',
      field: 'aprupetaja_paraksts',
      value: signatureValue,
      lastModified: now.toISOString(),
      lastBy: this.currentUser.id
    };

    const key = 'D|paraksts|aprupetaja_paraksts';
    this.marks.set(key, mark);
    await this.db.put('atzimes', mark);

    const logEntry = {
      id: this.db.generateId(),
      markId: mark.id,
      clientId: this.clientId,
      employeeId: this.currentUser.id,
      date: today,
      time: timeStr,
      shift: 'D',
      category: 'paraksts',
      field: 'aprupetaja_paraksts',
      value: signatureValue,
      prevValue: existing ? existing.value : null,
      type: isResign ? 'Labots' : 'Jauns',
      created: now.toISOString()
    };
    await this.db.add('atzimes_log', logEntry);

    this.sync.enqueueChange({
      action: 'mark',
      table: 'atzimes',
      data: {
        clientId: this.clientId,
        employeeId: this.currentUser.id,
        date: today,
        shift: 'D',
        category: 'paraksts',
        field: 'aprupetaja_paraksts',
        value: signatureValue,
        reason: isResign ? 'Pārparakstīts' : 'Diennakts paraksts'
      }
    });

    await this.loadMarks();
    await this.loadHistory();
    this.renderSignature();
    this.updateCategoryStatuses();
    this.toast(isResign ? '✓ Pārparakstīts' : '✓ Parakstīts');
  }

  toast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.careForm = new CareFormController();
});
