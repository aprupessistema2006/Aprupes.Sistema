class AdminPanel {
  constructor() {
    this.db = null;
    this.sync = null;
    this.currentUser = null;
    this.clients = [];
    this.employees = [];
    this._createClientDebounce = null;
    this._createEmployeeDebounce = null;
    this.roleFilter = '';
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

    const syncStatusEl = document.getElementById('syncStatus');
    const manualSyncBtn = document.getElementById('manualSyncBtn');
    if (syncStatusEl) {
      window.addEventListener('syncStatusChange', (e) => {
        if (!syncStatusEl) return;
        syncStatusEl.textContent = e.detail;
        syncStatusEl.className = 'sync-badge ' + e.detail.replace(/ /g, '-');
      });
      // DZEST syncComplete listener — neauto renderēt, lai lietotājs nezaudētu fokusu
    }
    if (manualSyncBtn) {
      manualSyncBtn.style.display = navigator.onLine ? 'inline-flex' : 'none';
      manualSyncBtn.addEventListener('click', async () => {
        if (!navigator.onLine) {
          this.toast && this.toast(t('offline'));
          return;
        }
        manualSyncBtn.disabled = true;
        manualSyncBtn.innerHTML = '<span>⏳</span> <span data-i18n="syncing">Sinhronizē...</span>';
        const overlay = document.getElementById('loadingOverlay');
        const loadingText = document.getElementById('loadingText');
        if (overlay) overlay.style.display = 'flex';
        try {
          const result = await this.sync.forceFullSync((msg) => {
            if (loadingText) loadingText.textContent = msg;
          });
          if (result.offline) {
            this.toast && this.toast('⚠️ ' + (result.error || 'Sinhronizācija neizdevās'), 4000);
          } else {
            await this.loadData();
            this.renderDashboard();
            this.renderClientList();
            this.renderEmployeeList();
            this.toast && this.toast('✅ Sinhronizācija pabeigta. Visi dati atjaunoti no Google Sheets.');
          }
        } catch (err) {
          this.toast && this.toast('⚠️ Kļūda: ' + err.message, 4000);
        } finally {
          manualSyncBtn.disabled = false;
          manualSyncBtn.innerHTML = '<span>🔄</span> <span data-i18n="syncBtn">Sinhronizēt</span>';
          if (overlay) overlay.style.display = 'none';
          if (typeof applyLanguage === 'function') applyLanguage();
        }
      });
    }

    this.setupTabs();
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
      this.renderDashboard();
      this.renderClientList();
      this.renderEmployeeList();
      await this.populateExportDropdowns();
      this.setExportDateDefaults();
    } catch (e) {
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  }

  setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        document.getElementById(tab).classList.add('active');
      });
    });
  }

  setupUI() {
    document.getElementById('backBtn').addEventListener('click', () => {
      window.location.href = 'index.html';
    });
    document.getElementById('logoutBtn').addEventListener('click', async (e) => {
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

    document.getElementById('clientSearch').addEventListener('input', (e) => {
      this.renderClientList(e.target.value);
    });
    document.getElementById('employeeSearch').addEventListener('input', (e) => {
      this.renderEmployeeList(e.target.value);
    });
    document.querySelectorAll('#employeeRoleFilterBar .role-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#employeeRoleFilterBar .role-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.roleFilter = btn.dataset.role;
        this.renderEmployeeList(document.getElementById('employeeSearch').value);
      });
    });

    document.getElementById('addClientBtn').addEventListener('click', () => this.showClientForm());
    document.getElementById('addEmployeeBtn').addEventListener('click', () => this.showEmployeeForm());

    document.getElementById('syncNow').addEventListener('click', () => this.syncNow());
    document.getElementById('checkConnection').addEventListener('click', () => this.checkConnection());
    document.getElementById('testConnection').addEventListener('click', () => this.checkConnection());
    document.getElementById('findDuplicates').addEventListener('click', () => this.findDuplicates());
    document.getElementById('clearLocal').addEventListener('click', () => this.clearLocal());
    document.getElementById('manualBackup').addEventListener('click', () => this.manualBackup());

    document.querySelector('.modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') this.closeModal();
    });

    document.getElementById('enterAsCaregiverBtn').addEventListener('click', () => this.showCaregiverSelectModal());

    const caregiverClose = document.querySelector('#caregiverModal .modal-close');
    if (caregiverClose) {
      caregiverClose.addEventListener('click', () => this.closeCaregiverModal());
    }
    document.getElementById('caregiverModal').addEventListener('click', (e) => {
      if (e.target.id === 'caregiverModal') this.closeCaregiverModal();
    });

    document.getElementById('caregiverConfirmBtn').addEventListener('click', () => this.confirmEnterAsCaregiver());

    document.getElementById('gasUrl').textContent = CONFIG.GAS_URL;

    this.setupExports();
  }

  extractDateFromAnyField(row) {
    const candidates = [row.date, row.created, row.lastModified, row.izveidots, row.pedeja_laiks, row.pēdējais_laiks];
    for (const c of candidates) {
      if (c === null || c === undefined || c === '') continue;
      const formatted = TimezoneUtils.formatDateRiga(c);
      if (formatted) return formatted;
    }
    return '';
  }

  formatTimeForDisplay(t) {
    if (!t) return '';
    return TimezoneUtils.formatTimeRiga(t);
  }

  setExportDateDefaults() {
    const fromEl = document.getElementById('exportMultiFrom');
    const toEl = document.getElementById('exportMultiTo');
    if (fromEl && !fromEl.value) {
      const d = new Date();
      fromEl.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }
    if (toEl && !toEl.value) {
      const d = new Date();
      toEl.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }
  }

  setupExports() {
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportSingleClient());
    }
    const exportAllBtn = document.getElementById('exportAllBtn');
    if (exportAllBtn) {
      exportAllBtn.addEventListener('click', () => this.exportAllClientsMonth());
    }
    const exportMultiBtn = document.getElementById('exportMultiBtn');
    if (exportMultiBtn) {
      exportMultiBtn.addEventListener('click', () => this.exportSelectedClients());
    }
  }

  async populateExportDropdowns() {
    const exportClient = document.getElementById('exportClient');
    if (exportClient && exportClient.options.length <= 1) {
      exportClient.innerHTML = '<option value="" data-i18n="selectClientPrompt">— izvēlies klientu —</option>' +
        this.clients.map(c => {
          const name = (c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '');
          return `<option value="${c.id || c.ID}">${this.escapeHtml(name.trim() || ('ID: ' + (c.id || c.ID)))}</option>`;
        }).join('');
    }

    const exportMultiClients = document.getElementById('exportMultiClients');
    if (exportMultiClients && exportMultiClients.options.length === 0) {
      const activeClients = this.clients.filter(c => c.aktivs === true || c.aktivs === 'true' || c.aktivs === 1 || c.aktivs === '1');
      exportMultiClients.innerHTML = activeClients.map(c => {
        const name = (c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '');
        return `<option value="${c.id || c.ID}">${this.escapeHtml(name.trim())}</option>`;
      }).join('');
    }
  }

  async exportSingleClient() {
    if (typeof ExcelExporter === 'undefined' && typeof ExcelJS === 'undefined') {
      this.toast('Excel bibliotēka nav ielādēta');
      return;
    }
    const monthEl = document.getElementById('exportMonth');
    const clientEl = document.getElementById('exportClient');
    const monthVal = monthEl ? monthEl.value : '';
    const clientId = clientEl ? clientEl.value : '';
    if (!monthVal) { this.toast('Izvēlieties mēnesi'); return; }
    if (!clientId) { this.toast('Izvēlieties klientu'); return; }

    const client = this.clients.find(c => String(c.id || c.ID) === String(clientId));
    if (!client) { this.toast('Klients nav atrasts'); return; }

    try {
      await this.populateExportDropdowns();
      const exporter = new ExcelExporter();
      const overlay = document.getElementById('loadingOverlay');
      const loadingText = document.getElementById('loadingText');
      if (overlay) overlay.style.display = 'flex';

      if (window.careSync && navigator.onLine) {
        if (loadingText) loadingText.textContent = 'Sinhronizēju datus no Google Sheets pirms eksporta...';
        await window.careSync.forceFullSync((msg) => { if (loadingText) loadingText.textContent = msg; });
      }

      const allMarks = await this.db.getAll('atzimes');
      const cid = client.id || client.ID;
      const clientMarks = allMarks.filter(m => String(m.clientId || m.klientsId || '') === String(cid));
      clientMarks.sort((a, b) => {
        const da = this.extractDateFromAnyField(a) || '';
        const db = this.extractDateFromAnyField(b) || '';
        if (da !== db) return db.localeCompare(da);
        const ta = this.formatTimeForDisplay(a.time);
        const tb = this.formatTimeForDisplay(b.time);
        return tb.localeCompare(ta);
      });
      const filename = await exporter.generateMonth(client, parseInt(monthVal.split('-')[0]), parseInt(monthVal.split('-')[1]), clientMarks);
      this.toast('✓ Lejupielādejts: ' + filename);
      if (overlay) overlay.style.display = 'none';
    } catch (err) {
      this.toast('Eksporta kļūda: ' + err.message);
      const overlay = document.getElementById('loadingOverlay');
      if (overlay) overlay.style.display = 'none';
    }
  }

  async exportAllClientsMonth() {
    if (typeof ExcelExporter === 'undefined' && typeof ExcelJS === 'undefined') {
      this.toast('Excel bibliotēka nav ielādēta');
      return;
    }
    const monthEl = document.getElementById('exportAllMonth');
    const monthVal = monthEl ? monthEl.value : '';
    if (!monthVal) { this.toast('Izvēlieties mēnesi'); return; }

    const activeClients = this.clients.filter(c => c.aktivs === true || c.aktivs === 'true' || c.aktivs === 1 || c.aktivs === '1');
    if (activeClients.length === 0) { this.toast('Nav aktīvu klientu'); return; }

    try {
      await this.populateExportDropdowns();
      const exporter = new ExcelExporter();
      const overlay = document.getElementById('loadingOverlay');
      const loadingText = document.getElementById('loadingText');
      if (overlay) overlay.style.display = 'flex';

      if (window.careSync && navigator.onLine) {
        if (loadingText) loadingText.textContent = 'Sinhronizēju datus no Google Sheets pirms eksporta...';
        await window.careSync.forceFullSync((msg) => { if (loadingText) loadingText.textContent = msg; });
      }

      const allMarks = await this.db.getAll('atzimes');
      const [y, m] = monthVal.split('-');
      const year = parseInt(y);
      const month = parseInt(m);


      let successCount = 0;
      let errorCount = 0;
      for (const client of activeClients) {
        const cid = client.id || client.ID;
        const clientMarks = allMarks.filter(mark => String(mark.clientId || mark.klientsId || '') === String(cid));
        clientMarks.sort((a, b) => {
          const da = this.extractDateFromAnyField(a) || '';
          const db = this.extractDateFromAnyField(b) || '';
          if (da !== db) return db.localeCompare(da);
          const ta = this.formatTimeForDisplay(a.time);
          const tb = this.formatTimeForDisplay(b.time);
          return tb.localeCompare(ta);
        });
        try {
          const filename = await exporter.generateMonth(client, year, month, clientMarks);
          successCount++;
          if (loadingText) loadingText.textContent = 'Eksportēts: ' + filename + ' (' + successCount + '/' + activeClients.length + ')';
        } catch (err) {
          errorCount++;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      this.toast('✓ Lejupielādēti ' + successCount + '/' + activeClients.length + ' klienti' + (errorCount > 0 ? ' | Kļūdas: ' + errorCount : ''));
      if (overlay) overlay.style.display = 'none';
    } catch (err) {
      this.toast('Eksporta kļūda: ' + err.message);
      const overlay = document.getElementById('loadingOverlay');
      if (overlay) overlay.style.display = 'none';
    }
  }

  async exportSelectedClients() {
    if (typeof ExcelExporter === 'undefined' && typeof ExcelJS === 'undefined') {
      this.toast('Excel bibliotēka nav ielādēta');
      return;
    }
    const fromEl = document.getElementById('exportMultiFrom');
    const toEl = document.getElementById('exportMultiTo');
    const clientsEl = document.getElementById('exportMultiClients');
    const fromVal = fromEl ? fromEl.value : '';
    const toVal = toEl ? toEl.value : '';
    if (!fromVal || !toVal) { this.toast('Izvēlieties datumu diapazonu'); return; }

    const selectedOptions = clientsEl ? Array.from(clientsEl.selectedOptions).map(o => o.value) : [];
    if (selectedOptions.length === 0) { this.toast('Izvēlieties vismaz vienu klientu'); return; }

    try {
      await this.populateExportDropdowns();
      const exporter = new ExcelExporter();
      const overlay = document.getElementById('loadingOverlay');
      const loadingText = document.getElementById('loadingText');
      if (overlay) overlay.style.display = 'flex';

      if (window.careSync && navigator.onLine) {
        if (loadingText) loadingText.textContent = 'Sinhronizēju datus no Google Sheets pirms eksporta...';
        await window.careSync.forceFullSync((msg) => { if (loadingText) loadingText.textContent = msg; });
      }

      const allMarks = await this.db.getAll('atzimes');
      const dateFrom = fromVal;
      const dateTo = toVal;

      const selectedClients = selectedOptions.map(cid =>
        this.clients.find(c => String(c.id || c.ID) === String(cid))
      ).filter(Boolean);

      selectedClients.forEach(c => console.log('[exportMulti]   - ' + c.vards + ' ' + c.uzvards + ' (id=' + (c.id || c.ID) + ')'));

      let successCount = 0;
      let errorCount = 0;
      let totalFiles = 0;
      for (const client of selectedClients) {
        const cid = client.id || client.ID;
        const clientMarks = allMarks.filter(mark => {
          if (String(mark.clientId || mark.klientsId || '') !== String(cid)) return false;
          const markDate = this.extractDateFromAnyField(mark) || '';
          return markDate >= dateFrom && markDate <= dateTo;
        });

        const monthsInRange = [];
        const cur = new Date(parseInt(fromVal.split('-')[0]), parseInt(fromVal.split('-')[1]) - 1, 1);
        const end = new Date(parseInt(toVal.split('-')[0]), parseInt(toVal.split('-')[1]) - 1, 1);
        while (cur <= end) {
          monthsInRange.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
          cur.setMonth(cur.getMonth() + 1);
        }

        for (const { year, month } of monthsInRange) {
          const monthMarks = clientMarks.filter(m => {
            const d = new Date(this.extractDateFromAnyField(m) || 0);
            return d.getFullYear() === year && (d.getMonth() + 1) === month;
          });
          totalFiles++;
          try {
            const filename = await exporter.generateMonth(client, year, month, monthMarks);
            successCount++;
            if (loadingText) loadingText.textContent = 'Eksportēts: ' + filename + ' (' + successCount + '/' + totalFiles + ')';
          } catch (err) {
            errorCount++;
          }
          await new Promise(r => setTimeout(r, 500));
        }
      }
      this.toast('✓ Lejupielādēti ' + successCount + ' faili' + (errorCount > 0 ? ' | Kļūdas: ' + errorCount : ''));
      if (overlay) overlay.style.display = 'none';
    } catch (err) {
      this.toast('Eksporta kļūda: ' + err.message);
      const overlay = document.getElementById('loadingOverlay');
      if (overlay) overlay.style.display = 'none';
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
    if (typeof applyLanguage === 'function') {
      applyLanguage();
    }
  }

  async loadData() {
    this.clients = await this.db.getAll('klienti');
    this.employees = await this.db.getAll('darbinieki');
  }

  async renderDashboard() {
    const activeClients = this.clients.filter(c => c.aktivs === true || c.aktivs === 'true' || c.aktivs === 1 || c.aktivs === '1');
    const activeEmployees = this.employees.filter(e => e.aktivs === true || e.aktivs === 'true' || e.aktivs === 1 || e.aktivs === '1');

    const unsynced = await this.sync.getUnsyncedCount();
    const lastSync = await this.db.getMeta('lastSync');

    document.getElementById('dashActiveClients').textContent = activeClients.length;
    document.getElementById('dashActiveEmployees').textContent = activeEmployees.length;
    document.getElementById('dashUnsynced').textContent = unsynced;

    if (lastSync) {
      const date = new Date(lastSync);
      document.getElementById('dashLastSync').textContent = date.toLocaleString('lv-LV');
    }
  }

  renderClientList(filter) {
    const list = document.getElementById('clientList');
    let items = this.clients;
    if (filter) {
      const term = filter.toLowerCase();
      items = items.filter(c => {
        const name = ((c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '')).toLowerCase();
        return name.includes(term);
      });
    }

    if (items.length === 0) {
      list.innerHTML = '<div class="loading">Nav klientu</div>';
      return;
    }

    list.innerHTML = items.map(c => {
      const name = (c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '');
       const dob = c.dzimis || c['Dzimšanas datums'] || c.dzimsans_datums || c.dzimšans_datums || c.birth_date || '';
      const active = c.aktivs === true || c.aktivs === 'true' || c.aktivs === 1 || c.aktivs === '1';
      const id = c.id || c.ID;

      return `
        <div class="item-card">
          <div class="item-info">
            <div class="item-name">${this.escapeHtml(name)}</div>
            <div class="item-meta">${dob ? 'Dzimis: ' + dob : ''} ${c.dieta || c.Diēta ? '· Diēta: ' + (c.dieta || c.Diēta) : ''} ${active ? '' : '· Neaktīvs'}</div>
          </div>
          <div class="item-actions">
            <button class="item-btn" onclick="window.adminPanel.editClient('${id}')">Labot</button>
            <button class="item-btn danger" onclick="window.adminPanel.toggleClient('${id}', ${!active})">${active ? 'Deaktivēt' : 'Aktivizēt'}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderEmployeeList(filter) {
    const list = document.getElementById('employeeList');
    let items = this.employees;
    if (this.roleFilter) {
      const roleTerm = this.roleFilter.toLowerCase();
      items = items.filter(e => {
        const loma = String(e.loma || e.Loma || '').toLowerCase();
        return loma === roleTerm || loma.includes(roleTerm);
      });
    }
    if (filter) {
      const term = filter.toLowerCase();
      items = items.filter(e => {
        const name = ((e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '')).toLowerCase();
        return name.includes(term);
      });
    }

    if (items.length === 0) {
      list.innerHTML = '<div class="loading">Nav darbinieku</div>';
      return;
    }

    list.innerHTML = items.map(e => {
      const name = (e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '');
      const loma = e.loma || e.Loma || '';
      const pin = e.pin || e['PIN kods'] || '';
      const active = e.aktivs === true || e.aktivs === 'true' || e.aktivs === 1 || e.aktivs === '1';
      const id = e.id || e.ID;

      return `
        <div class="item-card">
          <div class="item-info">
            <div class="item-name">${this.escapeHtml(name)}</div>
            <div class="item-meta">${loma} · PIN: ${pin} ${active ? '' : '· Neaktīvs'}</div>
          </div>
          <div class="item-actions">
            <button class="item-btn" onclick="window.adminPanel.editEmployee('${id}')">Labot</button>
            <button class="item-btn danger" onclick="window.adminPanel.toggleEmployee('${id}', ${!active})">${active ? 'Deaktivēt' : 'Aktivizēt'}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  showCaregiverSelectModal() {
    const modal = document.getElementById('caregiverModal');
    const clientSelect = document.getElementById('caregiverClientSelect');
    const employeeSelect = document.getElementById('caregiverEmployeeSelect');
    if (!modal || !clientSelect || !employeeSelect) return;

    clientSelect.innerHTML = '<option value="">— Izvēlies klientu —</option>';
    (this.clients || []).forEach(c => {
      const name = (c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '');
      const id = c.id || c.ID;
      clientSelect.innerHTML += `<option value="${this.escapeHtml(id)}">${this.escapeHtml(name)}</option>`;
    });

    employeeSelect.innerHTML = '<option value="">— Izvēlies aprūpētāju —</option>';
    (this.employees || []).forEach(e => {
      const loma = String(e.loma || e.Loma || '').toLowerCase();
      if (!loma.includes('aprūpētājs') && !loma.includes('aprupetas') && !loma.includes('aprūpe')) return;
      const name = (e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '');
      const id = e.id || e.ID;
      employeeSelect.innerHTML += `<option value="${this.escapeHtml(id)}">${this.escapeHtml(name)}</option>`;
    });

    modal.style.display = 'flex';
  }

  closeCaregiverModal() {
    const modal = document.getElementById('caregiverModal');
    if (modal) modal.style.display = 'none';
  }

  confirmEnterAsCaregiver() {
    const clientSelect = document.getElementById('caregiverClientSelect');
    const employeeSelect = document.getElementById('caregiverEmployeeSelect');
    const clientId = clientSelect ? clientSelect.value : '';
    const employeeId = employeeSelect ? employeeSelect.value : '';

    if (!clientId || !employeeId) {
      this.toast(t('selectBothClientAndCaregiver'));
      return;
    }

    this.closeCaregiverModal();
    sessionStorage.setItem('careAdminMode', 'true');
    sessionStorage.setItem('careAdminCaregiverId', employeeId);
    window.location.href = 'aprupetajs.html?client=' + clientId + '&mode=admin&caregiverId=' + employeeId;
  }

  showClientForm(client) {
    const isEdit = !!client;
    const id = client ? (client.id || client.ID) : '';
    const vards = client ? (client.vards || client.Vārds || '') : '';
    const uzvards = client ? (client.uzvards || client.Uzvārds || '') : '';
    const dzimis = client ? (client.dzimis || client['Dzimšanas datums'] || client.dzimsans_datums || client.birth_date || '') : '';
    const dieta = client ? (client.dieta || client.Diēta || '') : '';
    const saskarsmes = client ? (client.saskarsmes || client['Saskarsmes īpatnības'] || '') : '';
    const slimnica = client ? (client.slimnica || client['Slimnīcā'] || false) : false;

    const html = `
      <h2>${isEdit ? 'Labot klientu' : 'Pievienot klientu'}</h2>
      <form id="clientForm">
        <div class="form-group">
          <label>Vārds *</label>
          <input type="text" name="vards" value="${this.escapeHtml(vards)}" required>
        </div>
        <div class="form-group">
          <label>Uzvārds *</label>
          <input type="text" name="uzvards" value="${this.escapeHtml(uzvards)}" required>
        </div>
        <div class="form-group">
          <label>Dzimšanas datums</label>
          <input type="date" name="dzimis" value="${dzimis}">
        </div>
        <div class="form-group">
          <label>Diēta</label>
          <input type="text" name="dieta" value="${this.escapeHtml(dieta)}">
        </div>
        <div class="form-group">
          <label>Saskarsmes īpatnības</label>
          <textarea name="saskarsmes" rows="2">${this.escapeHtml(saskarsmes)}</textarea>
        </div>
        <div class="form-group form-checkbox">
          <label class="checkbox-label">
            <input type="checkbox" name="slimnica" ${slimnica ? 'checked' : ''}>
            <span>Klients atrodas slimnīcā</span>
          </label>
        </div>
        <button type="submit" class="btn-primary">${isEdit ? 'Saglabāt' : 'Pievienot'}</button>
        <button type="button" class="btn-secondary" onclick="window.adminPanel.closeModal()">Atcelt</button>
      </form>
    `;
    document.getElementById('modalBody').innerHTML = html;
    this.openModal();

    document.getElementById('clientForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        vards: formData.get('vards'),
        uzvards: formData.get('uzvards'),
        dzimis: formData.get('dzimis'),
        dieta: formData.get('dieta'),
        saskarsmes: formData.get('saskarsmes'),
        slimnica: formData.get('slimnica') === 'on',
        aktivs: true
      };
      if (isEdit) {
        await this.updateClient(id, data);
      } else {
        await this.createClient(data);
      }
    });
  }

  showEmployeeForm(employee) {
    const isEdit = !!employee;
    const id = employee ? (employee.id || employee.ID) : '';
    const vards = employee ? (employee.vards || employee.Vārds || '') : '';
    const uzvards = employee ? (employee.uzvards || employee.Uzvārds || '') : '';
    const loma = employee ? (employee.loma || employee.Loma || 'aprūpētājs') : 'aprūpētājs';
    const pin = employee ? (employee.pin || employee['PIN kods'] || '') : '';

    const html = `
      <h2>${isEdit ? 'Labot darbinieku' : 'Pievienot darbinieku'}</h2>
      <form id="employeeForm">
        <div class="form-group">
          <label>Vārds *</label>
          <input type="text" name="vards" value="${this.escapeHtml(vards)}" required>
        </div>
        <div class="form-group">
          <label>Uzvārds *</label>
          <input type="text" name="uzvards" value="${this.escapeHtml(uzvards)}" required>
        </div>
        <div class="form-group">
          <label>Loma *</label>
          <select name="loma">
            <option value="aprūpētājs" ${loma === 'aprūpētājs' ? 'selected' : ''}>Aprūpētājs/a</option>
            <option value="kontroliere" ${loma === 'kontroliere' ? 'selected' : ''}>Kontrolieris/e</option>
            <option value="administrators" ${loma === 'administrators' ? 'selected' : ''}>Administrators/e</option>
          </select>
        </div>
        <div class="form-group">
          <label>PIN kods ${isEdit ? '(atstājiet tukšu, lai nemainītu)' : '*'}</label>
          <input type="text" name="pin" value="${this.escapeHtml(pin)}" pattern="[0-9]{4,6}" maxlength="6" ${isEdit ? '' : 'required'}>
          <small>4-6 cipari</small>
        </div>
        <button type="submit" class="btn-primary">${isEdit ? 'Saglabāt' : 'Pievienot'}</button>
        <button type="button" class="btn-secondary" onclick="window.adminPanel.closeModal()">Atcelt</button>
      </form>
    `;
    document.getElementById('modalBody').innerHTML = html;
    this.openModal();

    document.getElementById('employeeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        vards: formData.get('vards'),
        uzvards: formData.get('uzvards'),
        loma: formData.get('loma'),
        pin: formData.get('pin'),
        aktivs: true
      };
      if (isEdit) {
        await this.updateEmployee(id, data);
      } else {
        await this.createEmployee(data);
      }
    });
  }

  async createClient(data) {
    // Prevent duplicate submissions
    if (this._createClientDebounce) {
      clearTimeout(this._createClientDebounce);
    }

    return new Promise((resolve, reject) => {
      this._createClientDebounce = setTimeout(async () => {
        try {
          const id = this.db.generateId();
          const client = { id, ...data };
          if (data.dzimis) {
            client.dzimsanas_datums = data.dzimis;
          }
          if (data.saskarsmes) {
            client.saskarsmes_ipatnibas = data.saskarsmes;
          }

          // Check for duplicate in local data
          const duplicate = this.clients.find(c =>
            (c.vards || c.Vārds) === (data.vards || '') &&
            (c.uzvards || c.Uzvārds) === (data.uzvards || '')
          );
          if (duplicate) {
            this.toast(t('clientAlreadyExists'));
            reject(new Error('Duplicate client'));
            return;
          }

          await this.db.add('klienti', client);

          this.sync.enqueueChange({
            action: 'createClient',
            table: 'klienti',
            data: client
          });

          this.clients.push(client);
          this.renderClientList();
          this.renderDashboard();
          this.closeModal();
          this.toast(t('clientAdded'));
          resolve(id);
        } catch (error) {
          reject(error);
        }
      }, 300); // 300ms debounce
    });
  }

  async updateClient(id, data) {
    const client = await this.db.get('klienti', id);
    if (!client) return;
    Object.assign(client, data);
    if (data.dzimis) {
      client.dzimsanas_datums = data.dzimis;
    }
    if (data.saskarsmes) {
      client.saskarsmes_ipatnibas = data.saskarsmes;
    }
    await this.db.put('klienti', client);

    const syncData = { id, ...data };
    if (data.dzimis) {
      syncData.dzimsanas_datums = data.dzimis;
    }
    if (data.saskarsmes) {
      syncData.saskarsmes_ipatnibas = data.saskarsmes;
    }
    this.sync.enqueueChange({
      action: 'updateClient',
      table: 'klienti',
      data: syncData
    });

    await this.loadData();
    this.renderClientList();
    this.closeModal();
    this.toast(t('clientUpdated'));
  }

  async toggleClient(id, newState) {
    const client = await this.db.get('klienti', id);
    if (!client) return;
    client.aktivs = newState;
    await this.db.put('klienti', client);

    this.sync.enqueueChange({
      action: 'updateClient',
      table: 'klienti',
      data: { id, aktivs: newState }
    });

    await this.loadData();
    this.renderClientList();
    this.renderDashboard();
    this.toast(newState ? 'Klients aktivizēts' : 'Klients deaktivizēts');
  }

  editClient(id) {
    const client = this.clients.find(c => (c.id || c.ID) === id);
    this.showClientForm(client);
  }

  async createEmployee(data) {
    if (!data.pin || data.pin.length < 4) {
      this.toast(t('pinMin4Digits'));
      return;
    }

    // Prevent duplicate submissions
    if (this._createEmployeeDebounce) {
      clearTimeout(this._createEmployeeDebounce);
    }

    return new Promise((resolve, reject) => {
      this._createEmployeeDebounce = setTimeout(async () => {
        try {
          const existing = this.employees.find(e => {
            const eName = ((e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '')).trim().toLowerCase();
            const eRole = (e.loma || e.Loma || '').toLowerCase();
            const newName = ((data.vards || '') + ' ' + (data.uzvards || '')).trim().toLowerCase();
            const newRole = (data.loma || '').toLowerCase();
            return eName === newName && eRole === newRole;
          });
          if (existing) {
            this.toast(t('employeeAlreadyExists'));
            reject(new Error('Duplicate employee'));
            return;
          }

          const id = this.db.generateId();
          const employee = { id, ...data };
          await this.db.add('darbinieki', employee);

          this.sync.enqueueChange({
            action: 'createEmployee',
            table: 'darbinieki',
            data: employee
          });

          this.employees.push(employee);
          this.renderEmployeeList();
          this.renderDashboard();
          this.closeModal();
          this.toast(t('employeeAdded') + data.pin);
          resolve(id);
        } catch (error) {
          reject(error);
        }
      }, 300); // 300ms debounce
    });
  }

  async updateEmployee(id, data) {
    const employee = await this.db.get('darbinieki', id);
    if (!employee) return;
    Object.assign(employee, data);
    if (!data.pin) delete employee.pin;
    await this.db.put('darbinieki', employee);

    this.sync.enqueueChange({
      action: 'updateEmployee',
      table: 'darbinieki',
      data: { id, ...data }
    });

    await this.loadData();
    this.renderEmployeeList();
    this.closeModal();
    this.toast(t('employeeUpdated'));
  }

  async toggleEmployee(id, newState) {
    const employee = await this.db.get('darbinieki', id);
    if (!employee) return;
    employee.aktivs = newState;
    await this.db.put('darbinieki', employee);

    this.sync.enqueueChange({
      action: 'updateEmployee',
      table: 'darbinieki',
      data: { id, aktivs: newState }
    });

    await this.loadData();
    this.renderEmployeeList();
    this.renderDashboard();
    this.toast(newState ? 'Darbinieks aktivizēts' : 'Darbinieks deaktivizēts');
  }

  editEmployee(id) {
    const employee = this.employees.find(e => (e.id || e.ID) === id);
    this.showEmployeeForm(employee);
  }

  async syncNow() {
    if (!navigator.onLine) {
      this.toast(t('offline'));
      return;
    }
    this.toast(t('syncing'));
    try {
      const result = await this.sync.forceFullSync();
      if (result.offline) {
        this.toast('⚠️ ' + (result.error || 'Sinhronizācija neizdevās'), 4000);
      } else {
        await this.loadData();
        this.renderDashboard();
        this.renderClientList();
        this.renderEmployeeList();
        this.toast('✅ ' + t('syncCompleted'));
      }
    } catch (err) {
      this.toast('⚠️ Kļūda: ' + err.message, 4000);
    }
  }

  async checkConnection() {
    const result = document.getElementById('connectionResult');
    result.style.display = 'block';
    result.className = 'connection-result';
    result.textContent = t('checkingConnection');

    try {
      const url = CONFIG.GAS_URL + '?action=load&t=' + Date.now();
      const data = await requestData(url, 10000);
      if (data) {
        result.className = 'connection-result success';
        result.textContent = t('connectionActive');
      } else {
        result.className = 'connection-result error';
        result.textContent = t('emptyResponse');
      }
    } catch (err) {
      result.className = 'connection-result error';
      result.textContent = t('noConnection') + err.message;
    }
  }

  async findDuplicates() {
    const seen = new Map();
    const dupes = [];
    this.clients.forEach(c => {
      const key = ((c.vards || c.Vārds || '') + '|' + (c.uzvards || c.Uzvārds || '')).toLowerCase();
      if (seen.has(key)) {
        dupes.push(c, seen.get(key));
      } else {
        seen.set(key, c);
      }
    });

    if (dupes.length === 0) {
      this.toast(t('noDuplicatesFound'));
    } else {
      const list = dupes.map(c => (c.vards || c.Vārds) + ' ' + (c.uzvards || c.Uzvārds)).join('\n');
      alert(t('duplicatesFound') + '\n' + list);
    }
  }

  async clearLocal() {
    if (!confirm(t('confirmClearLocal'))) return;
    await this.db.clear('klienti');
    await this.db.clear('atzimes');
    await this.db.clear('atzimes_log');
    await this.db.clear('darbinieki');
    await this.db.clear('sync_queue');
    this.toast(t('localDataCleared'));
    await this.loadData();
    this.renderClientList();
    this.renderEmployeeList();
    this.renderDashboard();
  }

  async manualBackup() {
    const data = {
      timestamp: new Date().toISOString(),
      clients: this.clients,
      employees: this.employees
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'care_backup_' + new Date().toISOString().split('T')[0] + '.json';
    link.click();
    this.toast(t('backupCreated'));
  }

  openModal() {
    document.getElementById('modal').style.display = 'flex';
  }

  closeModal() {
    document.getElementById('modal').style.display = 'none';
  }

  toast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.adminPanel = new AdminPanel();
});
