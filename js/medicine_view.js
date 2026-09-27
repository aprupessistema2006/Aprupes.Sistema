// MedicineView — Medicīniskais darbinieka skats
// Filtrē kritiskus rādījumus no visiem klientiem, parāda izmaiņu salīdzinājumu un tendenci.
// neatkarīgs no aprūpes lapas — tikai lasa IndexedDB datus.

const CRITICAL_FIELDS = {
  temp: { field: 'temperatura', threshold: 37, direction: 'above', label: 'Temperatūra', unit: '°C' },
  sikdrumi: [
    { field: 'urina_daudzums', threshold: 400, direction: 'below', label: 'Urīna daudzums (24h)', unit: 'ml' },
    { field: 'uznemts_ml', threshold: 1200, direction: 'below', label: 'Uzņemts H2O (24h)', unit: 'ml' }
  ],
  edinasana: { fields: ['brokastis', 'pusdienas', 'launags', 'vakariņi'], label: 'Ēdienreze' },
  fiziologija: { field: 'vedera_izeja', criticalValues: ['A', 'K'], label: 'Vēdera izeja' },
  aktivitate: { fields: ['parvietojas_ar_palidzlekli', 'stav_ar_palidziigu', 'sedz_ar_palidziigu'], label: 'Pārvietošanās' },
  citsi_pasakomi: [
    { field: 'adas_kopsana', value: null, label: 'Ādas kopšana nav veikta' },
    { field: 'pastaigas', value: null, label: 'Pastaiga nav notika' }
  ]
};

const ATTENTION_CATEGORY = 'pievienot';
const ATTENTION_FIELD = 'uzmaniba';

class MedicineView {
  constructor() {
    this.db = null;
    this.sync = null;
    this.currentUser = null;
    this.allClients = [];
    this.allEmployees = [];
    this.allMarks = [];
    this.allLog = [];
    this.employeeMap = {};
    this.filteredFindings = [];
    this.selectedClient = null;
    this.activeTab = 'findings';
    this.init();
  }

  async init() {
    const userData = sessionStorage.getItem('careUser');
    if (!userData) {
      window.location.href = 'index.html';
      return;
    }
    this.currentUser = JSON.parse(userData);

    this.db = new CareDB();
    await this.db.init();
    window.careDB = this.db;
    this.sync = new CareSync(this.db, CONFIG);
    window.careSync = this.sync;

    // Version check — ja kodā ir jaunāka versija par serveri, refresh
    try {
      const serverVersion = await this.sync.getServerVersion();
      if (serverVersion && serverVersion !== CONFIG.VERSION) {
        console.log('[medicine] Version mismatch — reloading. Client:', CONFIG.VERSION, 'Server:', serverVersion);
        window.location.reload(true);
        return;
      }
    } catch (e) {
      console.warn('[medicine] Version check failed:', e);
    }

    const role = (this.currentUser.loma || '').toLowerCase();
    if (role !== 'administrators' && role !== 'kontroliere') {
      window.location.href = 'aprupe.html';
      return;
    }

    this.setupUI();
    this.setupLanguageSwitcher();

    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    if (overlay) overlay.style.display = 'flex';

    try {
      await this.sync.loadInitialData((msg) => {
        if (loadingText) loadingText.textContent = msg;
      });
      await this.loadData();
      this.renderAll();
      this.renderFindings();
    } catch (e) {
      console.error('[medicine] init error:', e);
    } finally {
      if (overlay) overlay.style.display = 'none';
      const splash = document.getElementById('splashScreen');
      if (splash) splash.style.display = 'none';
    }

    window.addEventListener('syncComplete', (e) => {
      if (e.detail && !e.detail.offline) {
        this.loadData().then(() => this.renderAll());
      }
    });
  }

  setupUI() {
    const backBtn = document.getElementById('btnBack');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        window.location.href = 'control.html';
      });
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
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

    const syncBtn = document.getElementById('manualSyncBtn');
    if (syncBtn) {
      syncBtn.style.display = navigator.onLine ? 'inline-flex' : 'none';
      window.addEventListener('online', () => syncBtn.style.display = 'inline-flex');
      window.addEventListener('offline', () => syncBtn.style.display = 'none');
      syncBtn.addEventListener('click', async () => {
        if (!navigator.onLine) {
          this.toast(t('offline'));
          return;
        }
        syncBtn.disabled = true;
        syncBtn.innerHTML = '<span>⏳</span> Sinhronizē...';
        const overlay = document.getElementById('loadingOverlay');
        const loadingText = document.getElementById('loadingText');
        if (overlay) overlay.style.display = 'flex';
        try {
          const result = await this.sync.forceFullSync((msg) => {
            if (loadingText) loadingText.textContent = msg;
          });
          if (result.offline) {
            this.toast('⚠️ ' + (result.error || 'Sinhronizācija neizdevās'), 4000);
          } else {
            await this.loadData();
            this.renderAll();
            this.toast('✅ Sinhronizācija pabeigta.');
          }
        } catch (err) {
          this.toast('⚠️ Kļūda: ' + err.message, 4000);
        } finally {
          syncBtn.disabled = false;
          syncBtn.innerHTML = '<span>🔄</span> Sinhronizēt';
          if (overlay) overlay.style.display = 'none';
        }
      });
    }

    const tabFindings = document.getElementById('tabFindings');
    const tabTrends = document.getElementById('tabTrends');
    const tabAttention = document.getElementById('tabAttention');
    [tabFindings, tabTrends, tabAttention].forEach(tab => {
      if (tab) tab.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.medicine-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeTab = tab.dataset.tab;
        this.renderTabContent();
      });
    });

    const clientSearch = document.getElementById('clientSearch');
    if (clientSearch) {
      clientSearch.addEventListener('input', (e) => {
        this.filterClients(e.target.value.trim().toLowerCase());
        this.renderClientList();
      });
    }

    const dateFilter = document.getElementById('dateFilter');
    if (dateFilter) {
      dateFilter.value = TimezoneUtils.getTodayRiga();
      dateFilter.addEventListener('change', () => this.renderFindings());
    }
  }

  setupLanguageSwitcher() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        if (lang && typeof setLang === 'function') {
          setLang(lang);
          document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });
    if (typeof applyLanguage === 'function') applyLanguage();
  }

  async loadData() {
    this.allClients = await this.db.getAll('klienti');
    this.allEmployees = await this.db.getAll('darbinieki');
    this.allMarks = await this.db.getAll('atzimes');
    this.allLog = await this.db.getAll('atzimes_log');

    this.employeeMap = {};
    this.allEmployees.forEach(e => {
      const id = e.id || e.ID;
      const vards = e.vards || e.Vārds || '';
      const uzvards = e.uzvards || e.Uzvārds || '';
      this.employeeMap[id] = vards + ' ' + uzvards;
      this.employeeMap[String(id)] = vards + ' ' + uzvards;
    });

    if (this.allMarks.length === 0 && this.allLog.length > 0) {
      this.allMarks = this.allLog.map(l => ({
        id: l.id,
        clientId: l.clientId || l.klients_id,
        employeeId: l.employeeId || l.darbinieks_id,
        date: l.date || l.datums,
        shift: l.shift || l.periods,
        category: l.category || l.kategorija,
        field: l.field || l.lauka_nosaukums,
        value: l.value || l.vertiba,
        lastModified: l.lastModified || l.pedeja_laiks || l.notikuma_laija || l.created,
        type: l.type,
        prevValue: l.prevValue || l.pedeja_vertiba,
        eventTime: l.eventTime || l.notikuma_laijs || l.created
      }));
    }
  }

  getToday() {
    return TimezoneUtils.getTodayRiga();
  }

  extractDate(m) {
    if (!m) return '';
    return TimezoneUtils.formatDateRiga(m.date || m.datums || m.lastModified || m.pedeja_laiks || m.created || '');
  }

  getClientMarks(clientId, date) {
    const today = date || this.getToday();
    const marks = [];
    this.allMarks.forEach(m => {
      if (!this.clientIdsMatch(m, clientId)) return;
      const mDate = this.extractDate(m);
      if (!mDate) return;
      if (mDate === today) {
        marks.push(m);
      }
    });
    return marks;
  }

  getClientAllMarksForField(clientId, field, category, days) {
    const numDays = days || 7;
    const result = [];
    const dates = [];
    for (let i = numDays - 1; i >= 0; i--) {
      dates.push(TimezoneUtils.offsetDaysRiga(-i));
    }
    const targetDates = new Set(dates);

    this.allMarks.forEach(m => {
      if (!this.clientIdsMatch(m, clientId)) return;
      if (m.category !== category && m.kategorija !== category) return;
      if (m.field !== field && m.lauka_nosaukums !== field) return;
      const mDate = this.extractDate(m);
      if (!mDate || !targetDates.has(mDate)) return;
      result.push({ ...m, _date: mDate });
    });

    result.sort((a, b) => {
      const ta = a._date + ' ' + (a.time || a.laiks || '');
      const tb = b._date + ' ' + (b.time || b.laiks || '');
      return ta.localeCompare(tb);
    });

    const byDate = {};
    result.forEach(m => {
      if (!byDate[m._date]) byDate[m._date] = [];
      byDate[m._date].push(m);
    });

    return dates.map(d => ({
      date: d,
      marks: byDate[d] || []
    }));
  }

  clientIdsMatch(mark, clientId) {
    if (!mark) return false;
    const ids = [mark.clientId, mark.klients_id, mark.klientsId, mark.klienti_id];
    return ids.includes(clientId);
  }

  getPreviousValue(clientId, field, category, currentDate) {
    const dates = this.getClientAllMarksForField(clientId, field, category, 14);
    const priorDates = dates.filter(d => d.date !== currentDate && d.marks.length > 0);
    if (priorDates.length === 0) return null;

    const latest = priorDates[priorDates.length - 1];
    if (latest.marks.length === 0) return null;
    const lastMark = latest.marks[latest.marks.length - 1];
    return lastMark.value || lastMark.vertiba;
  }

  getTrendValues(clientId, field, category, days) {
    const data = this.getClientAllMarksForField(clientId, field, category, days || 3);
    return data.map(d => {
      if (d.marks.length === 0) return null;
      const lastMark = d.marks[d.marks.length - 1];
      return { date: d.date, value: lastMark.value || lastMark.vertiba };
    });
  }

  isCritical(mark, fieldDef) {
    if (!mark || !mark.value) return false;

    if (fieldDef.threshold) {
      const numVal = parseFloat(mark.value);
      if (isNaN(numVal)) return false;
      if (fieldDef.direction === 'above') return numVal >= fieldDef.threshold;
      if (fieldDef.direction === 'below') return numVal <= fieldDef.threshold;
    }

    if (fieldDef.criticalValues) {
      return fieldDef.criticalValues.includes(String(mark.value).trim());
    }

    if (fieldDef.missingValue) {
      return !mark.value || mark.value === '' || mark.value === null;
    }

    return false;
  }

  getMissingFields(clientId, date) {
    const marks = this.getClientMarks(clientId, date);
    const missing = [];
    const today = date || this.getToday();

    const tempMark = marks.find(m =>
      m.category === 'temp' && (m.field === 'temperatura' || m.lauka_nosaukums === 'temperatura')
    );
    if (!tempMark || !tempMark.value) {
      missing.push({ field: 'temperatura', label: 'Temperatūra', priority: 'high' });
    }

    const h2oMark = marks.find(m =>
      m.category === 'sikdrumi' && (m.field === 'uznemts_ml' || m.lauka_nosaukums === 'uznemts_ml')
    );
    if (!h2oMark || !h2oMark.value) {
      missing.push({ field: 'uznemts_ml', label: 'H2O', priority: 'high' });
    }

    const urinaMark = marks.find(m =>
      m.category === 'sikdrumi' && (m.field === 'urina_daudzums' || m.lauka_nosaukums === 'urina_daudzums')
    );
    if (!urinaMark || !urinaMark.value) {
      missing.push({ field: 'urina_daudzums', label: 'Urīna daudzums', priority: 'high' });
    }

    const edinFields = ['brokastis', 'pusdienas', 'launags', 'vakariņi'];
    const missingMeals = edinFields.filter(f => {
      const m = marks.find(m => m.category === 'edinasana' && (m.field === f || m.lauka_nosaukums === f));
      return !m || !m.value;
    });
    if (missingMeals.length >= 3) {
      missing.push({ field: 'edinasana', label: 'Visas ēdienrezes', priority: 'high' });
    } else if (missingMeals.length > 0) {
      missing.push({ field: 'edinasana', label: 'Trūkst: ' + missingMeals.length + ' ēdienrezeļi', priority: 'medium' });
    }

    const fizMark = marks.find(m =>
      m.category === 'fiziologija' && (m.field === 'vedera_izeja' || m.lauka_nosaukums === 'vedera_izeja')
    );
    if (!fizMark || !fizMark.value) {
      missing.push({ field: 'vedera_izeja', label: 'Vēdera izeja', priority: 'medium' });
    }

    return missing;
  }

  getAttentionMarks(clientId) {
    const marks = this.allMarks.filter(m => this.clientIdsMatch(m, clientId));
    const attentionMarks = marks.filter(m => {
      const cat = (m.category || m.kategorija || '').toLowerCase();
      const field = (m.field || m.lauka_nosaukums || '').toLowerCase();
      return cat === ATTENTION_CATEGORY || field === ATTENTION_FIELD;
    });
    return attentionMarks.sort((a, b) => {
      const ta = a.lastModified || a.created || '';
      const tb = b.lastModified || b.created || '';
      return String(tb).localeCompare(String(ta));
    });
  }

  analyzeCriticalFindings(date) {
    const today = date || this.getToday();
    const findings = [];

    this.allClients.forEach(client => {
      const clientId = client.id || client.ID;
      const vards = client.vards || client.Vārds || '';
      const uzvards = client.uzvards || client.Uzvārds || '';
      const clientName = vards + ' ' + uzvards;

      const marks = this.getClientMarks(clientId, today);
      if (marks.length === 0) return;

      const isHospital = this.isClientHospital(client, marks);

      marks.forEach(m => {
        const category = (m.category || m.kategorija || '').toLowerCase();
        const field = (m.field || m.lauka_nosaukums || '').toLowerCase();
        const value = m.value || m.vertiba;

        const finding = this.analyzeMark(m, category, field, value, clientId, clientName, today);
        if (finding) findings.push(finding);
      });

      const missing = this.getMissingFields(clientId, today);
      missing.forEach(mf => {
        findings.push({
          clientId,
          clientName,
          category: 'missing',
          field: mf.field,
          label: mf.label,
          type: 'missing',
          value: null,
          priority: mf.priority,
          date: today
        });
      });

      const attentionMarks = this.getAttentionMarks(clientId);
      attentionMarks.forEach(am => {
        findings.push({
          clientId,
          clientName,
          category: 'attention',
          field: am.field || am.lauka_nosaukums || 'comments',
          label: 'Pievērst medicīnisko uzmanību',
          type: 'attention',
          value: am.comment || am.virsenis || am.value || am.vertiba || am.comment,
          employeeId: am.employeeId || am.darbinieks_id,
          dateTime: am.lastModified || am.created || am.notikuma_laijs,
          date: today,
          markId: am.id,
          priority: 'high'
        });
      });
    });

    findings.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const pa = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 3;
      const pb = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 3;
      if (pa !== pb) return pa - pb;
      return a.clientName.localeCompare(b.clientName);
    });

    return findings;
  }

  analyzeMark(m, category, field, value, clientId, clientName, today) {
    let isCritical = false;
    let label = '';
    let trend = null;
    let priority = 'medium';

    const prevValue = this.getPreviousValue(clientId, m.field || m.lauka_nosaukums, m.category || m.kategorija, today);
    const trendValues = this.getTrendValues(clientId, m.field || m.lauka_nosaukums, m.category || m.kategorija, 3);

    if (category === 'temp' && field === 'temperatura') {
      const numVal = parseFloat(value);
      if (!isNaN(numVal) && numVal >= 37) {
        isCritical = true;
        label = 'Temperatūra';
        priority = 'high';
      }
    }

    if (category === 'sikdrumi' && field === 'urina_daudzums') {
      const numVal = parseFloat(value);
      if (!isNaN(numVal) && numVal < 400) {
        isCritical = true;
        label = 'Urīna daudzums (24h)';
        priority = 'high';
      }
    }

    if (category === 'sikdrumi' && field === 'uznemts_ml') {
      const numVal = parseFloat(value);
      if (!isNaN(numVal) && numVal < 800) {
        isCritical = true;
        label = 'Uzņemts H2O (24h)';
        priority = 'high';
      }
    }

    if (category === 'fiziologija' && field === 'vedera_izeja') {
      const criticalValues = ['A', 'K'];
      if (criticalValues.includes(String(value).trim())) {
        isCritical = true;
        label = 'Vēdera izeja';
        priority = 'high';
      }
    }

    if (category === 'citsi_pasakomi' && field === 'adas_kopsana') {
      const hasValue = value === 'X' || value === 'x';
      if (!hasValue) {
        isCritical = true;
        label = 'Ādas kopšana nav veikta';
        priority = 'medium';
      }
    }

    if (category === 'citsi_pasakomi' && field === 'pastaigas') {
      const hasValue = value === 'X' || value === 'x';
      if (!hasValue) {
        isCritical = true;
        label = 'Pastaiga nav notika';
        priority = 'medium';
      }
    }

    if (!isCritical && prevValue && value && String(value) !== String(prevValue)) {
      isCritical = true;
      label = m.field || field;
      priority = 'medium';
    }

    if (!isCritical) return null;

    return {
      clientId,
      clientName,
      category,
      field,
      label: label || field,
      type: 'critical' + (prevValue ? '' : ''),
      value: value,
      prevValue: prevValue || null,
      trend: trendValues,
      employeeId: m.employeeId || m.darbinieks_id,
      dateTime: m.lastModified || m.created || m.notikuma_laijs,
      date: today,
      priority,
      markId: m.id,
      isHospital: this.isClientHospital(null, marks || [])
    };
  }

  isClientHospital(client, marks) {
    if (client && (client.slimnica || client['Slimnīcā'])) return true;
    if (marks && marks.length) {
      const statusMarks = marks.filter(m => {
        const cat = (m.category || m.kategorija || '').toLowerCase();
        const field = (m.field || m.lauka_nosaukums || '').toLowerCase();
        return cat === 'slimnica' && field === 'statuss';
      });
      if (statusMarks.length > 0) {
        const latest = statusMarks[statusMarks.length - 1];
        const val = String(latest.value || latest.vertiba || '').toLowerCase();
        return val.includes('slimnīcā') || val.includes('hospitaliz');
      }
    }
    return false;
  }

  renderAll() {
    this.renderClientList();
    this.renderTabContent();
  }

  renderClientList() {
    const list = document.getElementById('medicineClientList');
    if (!list) return;
    const filtered = this.allClients.filter(c =>
      (c.vards || c.Vārds || '').toLowerCase().includes(this._searchTerm || '') ||
      (c.uzvards || c.Uzvārds || '').toLowerCase().includes(this._searchTerm || '')
    );
    list.innerHTML = filtered.map(c => {
      const clientId = c.id || c.ID;
      const name = (c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '');
      const age = this.calculateAge(c.dzimis || c['Dzimšanas datums'] || c.birth_date);
      const room = '';
      return `<div class="medicine-client-item" data-id="${clientId}">
        <div class="medicine-client-name">${this.escapeHtml(name)}</div>
        <div class="medicine-client-meta">${age ? age + ' gadi' : ''} ${c.dieta ? '• ' + (c.dieta || c.Diēta || '') : ''}</div>
      </div>`;
    }).join('');
    list.querySelectorAll('.medicine-client-item').forEach(el => {
      el.addEventListener('click', () => {
        this.selectClient(el.dataset.id);
      });
    });
  }

  filterClients(term) {
    this._searchTerm = term;
  }

  selectClient(clientId) {
    this.selectedClient = this.allClients.find(c => (c.id || c.ID) === clientId);
    this.renderClientDetail();
  }

  renderClientDetail() {
    const detail = document.getElementById('medicineClientDetail');
    if (!detail || !this.selectedClient) return;

    const clientId = this.selectedClient.id || this.selectedClient.ID;
    const vards = this.selectedClient.vards || this.selectedClient.Vārds || '';
    const uzvards = this.selectedClient.uzvards || this.selectedClient.Uzvārds || '';
    const age = this.calculateAge(this.selectedClient.dzimis || this.selectedClient['Dzimšanas datums']);
    const dieta = this.selectedClient.dieta || this.selectedClient.Diēta || '';
    const saskarsme = this.selectedClient.saskarsmes || this.selectedClient['Saskarsmes īpatnības'] || '';
    const isHospital = this.isClientHospital(this.selectedClient);

    const today = this.getToday();
    const marks = this.getClientMarks(clientId, today);

    const criticalFields = [
      { category: 'temp', field: 'temperatura', label: 'Temperatūra' },
      { category: 'sikdrumi', field: 'urina_daudzums', label: 'Urīns (24h)' },
      { category: 'sikdrumi', field: 'uznemts_ml', label: 'H2O (24h)' },
      { category: 'aktivitate', field: 'parvietojas_ar_palidzlekli', label: 'Pārvietošanās' },
      { category: 'fiziologija', field: 'vedera_izeja', label: 'Vēdera izeja' }
    ];

    const fieldRows = criticalFields.map(f => {
      const mark = marks.find(m =>
        (m.category === f.category || m.kategorija === f.category) &&
        (m.field === f.field || m.lauka_nosaukums === f.field)
      );
      const value = mark ? (mark.value || mark.vertiba) : '—';
      const prev = this.getPreviousValue(clientId, f.field, f.category, today);
      const trend = this.getTrendValues(clientId, f.field, f.category, 3);
      const trendHtml = this.renderTrendMini(trend);

      let valueClass = '';
      if (f.field === 'temperatura') {
        const numVal = parseFloat(value);
        if (!isNaN(numVal) && numVal >= 37) valueClass = 'critical';
      } else if (f.field === 'urina_daudzums' || f.field === 'uznemts_ml') {
        const numVal = parseFloat(value);
        if (!isNaN(numVal) && numVal < 400 && f.field === 'urina_daudzums') valueClass = 'critical';
        if (!isNaN(numVal) && numVal < 800 && f.field === 'uznemts_ml') valueClass = 'critical';
      }

      const changeHtml = this.renderChangeIndicator(value, prev);

      return `<div class="medicine-field-row">
        <span class="medicine-field-label">${f.label}</span>
        <span class="medicine-field-value ${valueClass}">${value}</span>
        ${changeHtml}
        ${trendHtml}
      </div>`;
    }).join('');

    const edinMark = marks.find(m =>
      (m.category === 'edinasana' || m.kategorija === 'edinasana') &&
      (m.field === 'brokastis' || m.lauka_nosaukums === 'brokastis')
    );

    const attentionMarks = this.getAttentionMarks(clientId);
    const attentionHtml = attentionMarks.length > 0
      ? `<div class="medicine-attention-list">
          ${attentionMarks.slice(0, 5).map(am => {
            const empName = this.employeeMap[am.employeeId || am.darbinieks_id] || 'Nezināms';
            const dt = am.lastModified || am.created || '';
            return `<div class="medicine-attention-item">
              <span class="medicine-attention-text">${this.escapeHtml(am.comment || am.virsenis || am.value || am.vertiba || '')}</span>
              <span class="medicine-attention-meta">— ${empName} ${dt ? formatDateTimeLVShort(dt) : ''}</span>
            </div>`;
          }).join('')}
        </div>`
      : '<div class="medicine-no-attention">Nav "Pievērst uzmanību" atzīmju</div>';

    const missing = this.getMissingFields(clientId, today);
    const missingHtml = missing.length > 0
      ? `<ul class="medicine-missing-list">
          ${missing.map(mf => `<li class="medicine-missing-item ${mf.priority}">${this.escapeHtml(mf.label)}</li>`).join('')}
        </ul>`
      : '<div class="medicine-no-missing">Visi lauki ir aizpildīti</div>';

    detail.innerHTML = `
      <div class="medicine-client-header">
        <h2>${this.escapeHtml(vards)} ${this.escapeHtml(ujvards)}</h2>
        ${isHospital ? '<span class="medicine-hospital-badge">🏥 Slimnīcā</span>' : ''}
      </div>
      <div class="medicine-client-meta-grid">
        <div class="medicine-meta-item"><strong>Vecums:</strong> ${age || 'Nav norādīts'}</div>
        <div class="medicine-meta-item"><strong>Diēta:</strong> ${dieta || 'Nav norādīta'}</div>
        <div class="medicine-meta-item"><strong>Saskarsme:</strong> ${saskarsme || 'Nav norādīta'}</div>
      </div>

      <h3 class="medicine-section-title">Kritiskie rādījumi</h3>
      <div class="medicine-fields-grid">
        ${fieldRows}
      </div>

      <h3 class="medicine-section-title">Trūkstošie lauki (${today})</h3>
      ${missingHtml}

      <h3 class="medicine-section-title">Pievērst medicīnisko uzmanību</h3>
      ${attentionHtml}

      <div class="medicine-actions">
        <button class="medicine-btn primary" onclick="medicineView.openFullRecord('${clientId}')">
          📋 Pilna aprūpes lapa
        </button>
        <button class="medicine-btn secondary" onclick="medicineView.closeDetail()">
          ← Atpakaļ pie klientiem
        </button>
      </div>
    `;
  }

  renderTrendMini(trend) {
    if (!trend || trend.length === 0) return '';
    return `<div class="medicine-trend-mini">
      ${trend.map(t => {
        const v = t && t.value ? String(t.value) : '-';
        return `<span class="medicine-trend-day" title="${t && t.date ? t.date : ''}">${v}</span>`;
      }).join('')}
    </div>`;
  }

  renderChangeIndicator(value, prevValue) {
    if (!prevValue) return '';
    if (String(value) === String(prevValue)) return '<span class="medicine-change no-change">⊘</span>';

    const numVal = parseFloat(value);
    const numPrev = parseFloat(prevValue);
    if (!isNaN(numVal) && !isNaN(numPrev)) {
      const delta = numVal - numPrev;
      const arrow = delta > 0 ? '↗' : delta < 0 ? '↘' : '';
      const cls = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'no-change';
      return `<span class="medicine-change ${cls}" title="Iepriekšējā: ${prevValue}">${arrow} ${Math.abs(delta).toFixed(1)}</span>`;
    }
    return `<span class="medicine-change changed" title="Iepriekšējā: ${prevValue}">⚠</span>`;
  }

  renderFindings() {
    const dateFilter = document.getElementById('dateFilter');
    const selectedDate = dateFilter ? dateFilter.value : this.getToday();
    this.filteredFindings = this.analyzeCriticalFindings(selectedDate);

    const findings = document.getElementById('medicineFindingsList');
    if (!findings) return;

    if (this.filteredFindings.length === 0) {
      findings.innerHTML = '<div class="medicine-empty">✅ Kritisku rādījumu nav. Visi klienti ir stabilā stāvoklī.</div>';
      return;
    }

    findings.innerHTML = this.filteredFindings.map(f => this.renderFindingCard(f)).join('');
  }

  renderFindingCard(f) {
    const empName = this.employeeMap[f.employeeId] || '';
    const isCritical = f.priority === 'high';
    const icon = isCritical ? '🔴' : '🟡';
    const prevHtml = f.prevValue
      ? `<div class="medicine-prev-value">Iepriekšējā: ${this.escapeHtml(String(f.prevValue))}</div>`
      : '';

    const trendHtml = f.trend && f.trend.length > 0
      ? `<div class="medicine-trend">${f.trend.map(t => {
          const v = t && t.value ? String(t.value) : '-';
          return `<span>${t.date}: ${v}</span>`;
        }).join(' • ')}</div>`
      : '';

    return `<div class="medicine-finding-card ${f.priority}" data-client="${f.clientId}">
      <div class="medicine-finding-header">
        <span class="medicine-finding-icon">${icon}</span>
        <div class="medicine-finding-title">${this.escapeHtml(f.clientName)}</div>
        <span class="medicine-finding-type">${this.escapeHtml(f.label)}</span>
      </div>
      <div class="medicine-finding-body">
        <div class="medicine-finding-value">${this.escapeHtml(String(f.value || ''))}</div>
        ${prevHtml}
        ${trendHtml}
        ${empName ? `<div class="medicine-finding-author">Autors: ${this.escapeHtml(empName)}</div>` : ''}
      </div>
      <div class="medicine-finding-actions">
        <button class="medicine-small-btn" onclick="medicineView.viewClient('${f.clientId}')">Skatīt</button>
        ${f.type === 'attention' || f.category === 'attention'
          ? `<button class="medicine-small-btn" onclick="medicineView.openLog('${f.clientId}')">Pilna vēsture</button>`
          : `<button class="medicine-small-btn" onclick="medicineView.openForm('${f.clientId}')">Atzīme</button>`}
      </div>
    </div>`;
  }

  renderTrends() {
    const trends = document.getElementById('medicineTrendsContent');
    if (!trends) return;

    const today = this.getToday();
    const criticalFields = [
      { id: 'temperatura', label: 'Temperatūra', unit: '°C' },
      { id: 'urina_daudzums', label: 'Urīna daudzums (24h)', unit: 'ml' },
      { id: 'uznemts_ml', label: 'Uzņemts H2O (24h)', unit: 'ml' },
      { id: 'brokastis', label: 'Brokastis', unit: '' },
      { id: 'pusdienas', label: 'Pusdienas', unit: '' },
      { id: 'launags', label: 'Launags', unit: '' },
      { id: 'vakariņi', label: 'Vakariņas', unit: '' },
      { id: 'vedera_izeja', label: 'Vēdera izeja', unit: '' }
    ];

    let html = '<div class="medicine-trends-grid">';
    for (const client of this.allClients) {
      const clientId = client.id || client.ID;
      const vards = client.vards || client.Vārds || '';
      const uzvards = client.uzvards || client.Uzvārds || '';
      const name = vards + ' ' + uzvards;

      const clientFindings = this.filteredFindings.filter(f => f.clientId === clientId);
      if (clientFindings.length === 0) continue;

      html += `<div class="medicine-trend-client" data-client="${clientId}">
        <h3>${this.escapeHtml(name)}</h3>
        <div class="medicine-trend-fields">
          ${criticalFields.map(f => {
            let trendValues = [];
            const catMap = {
              temperatura: { category: 'temp', field: 'temperatura' },
              urina_daudzums: { category: 'sikdrumi', field: 'urina_daudzums' },
              uznemts_ml: { category: 'sikdrumi', field: 'uznemts_ml' },
              brokastis: { category: 'edinasana', field: 'brokastis' },
              pusdienas: { category: 'edinasana', field: 'pusdienas' },
              launags: { category: 'edinasana', field: 'launags' },
              vakariņi: { category: 'edinasana', field: 'vakariņi' },
              vedera_izeja: { category: 'fiziologija', field: 'vedera_izeja' }
            };
            const def = catMap[f.id];
            if (def) {
              trendValues = this.getTrendValues(clientId, def.field, def.category, 5);
            }
            const hasData = trendValues.some(t => t && t.value);
            if (!hasData) return '';
            return `<div class="medicine-trend-field">
              <span class="medicine-trend-field-label">${f.label}</span>
              <span class="medicine-trend-values">${trendValues.map(t => {
                return `<span title="${t && t.date ? t.date : ''}">${t && t.value ? String(t.value) : '-'}</span>`;
              }).join(' → ')}</span>
            </div>`;
          }).filter(h => h).join('')}
        </div>
      </div>`;
    }
    html += '</div>';
    trends.innerHTML = html;
  }

  renderAttention() {
    const container = document.getElementById('medicineAttentionContent');
    if (!container) return;

    const allAttention = [];
    this.allClients.forEach(client => {
      const clientId = client.id || client.ID;
      const vards = client.vards || client.Vārds || '';
      const uzvards = client.uzvards || client.Uzvārds || '';
      const marks = this.getAttentionMarks(clientId);
      marks.forEach(m => {
        allAttention.push({
          clientId,
          clientName: vards + ' ' + uzvards,
          id: m.id,
          comment: m.comment || m.virsenis || m.value || m.vertiba || '',
          employeeId: m.employeeId || m.darbinieks_id,
          dateTime: m.lastModified || m.created || '',
          field: m.field || m.lauka_nosaukums
        });
      });
    });

    allAttention.sort((a, b) => String(b.dateTime).localeCompare(String(a.dateTime)));

    if (allAttention.length === 0) {
      container.innerHTML = '<div class="medicine-empty">Nav atzīmēts "Pievērst medicīnisko uzmanību".</div>';
      return;
    }

    container.innerHTML = allAttention.map(a => {
      const empName = this.employeeMap[a.employeeId] || 'Nezināms';
      const dt = formatDateTimeLVShort(a.dateTime);
      return `<div class="medicine-attention-card" data-client="${a.clientId}">
        <div class="medicine-attention-header">
          <span class="medicine-attention-client">${this.escapeHtml(a.clientName)}</span>
          <span class="medicine-attention-time">${dt}</span>
        </div>
        <div class="medicine-attention-comment">${this.escapeHtml(a.comment)}</div>
        <div class="medicine-attention-author">Aprūpētājs: ${this.escapeHtml(empName)}</div>
      </div>`;
    }).join('');
  }

  renderTabContent() {
    if (this.activeTab === 'findings') this.renderFindings();
    else if (this.activeTab === 'trends') this.renderTrends();
    else if (this.activeTab === 'attention') this.renderAttention();
  }

  viewClient(clientId) {
    this.selectedClient = this.allClients.find(c => (c.id || c.ID) === clientId);
    this.renderClientDetail();
  }

  openFullRecord(clientId) {
    window.location.href = 'control.html#client-' + clientId;
  }

  openForm(clientId) {
    window.location.href = 'aprupe.html?client=' + clientId;
  }

  openLog(clientId) {
    window.location.href = 'control.html#client-' + clientId;
  }

  closeDetail() {
    this.selectedClient = null;
    const detail = document.getElementById('medicineClientDetail');
    if (detail) detail.innerHTML = '';
    this.renderClientList();
  }

  calculateAge(dob) {
    if (!dob) return '';
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return '';
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age >= 0 ? String(age) : '';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  toast(msg, duration) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:#333;color:#fff;padding:12px 24px;border-radius:8px;z-index:10000;' +
      'font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,0.3);';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration || 3000);
  }
}

let medicineView;
document.addEventListener('DOMContentLoaded', () => {
  medicineView = new MedicineView();
});

function formatDateTimeLVShort(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('lv-LV') + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function t(key, params) {
  if (typeof window.t === 'function') return window.t(key, params);
  return key;
}
