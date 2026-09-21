const MEAL_SHIFT = {
  brokastis: 'R',
  pusdienas: 'R',
  launags: 'V',
  vakariņi: 'V'
};

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
    this.adminMode = false;
    this._processing = new Map();
    this._initialLoadDone = false;
    this.init();
  }

  detectCurrentShift() {
    const hour = TimezoneUtils.getHourRiga();
    if (hour >= 5 && hour < 19) return 'R';
    return 'V';
  }

  // No complex time logic needed - R = nododu, V = pieņemu
  // Date is always TODAY when clicked
  getSignatureShift() {
    return this.currentShift; // Use selected tab (R or V)
  }

  // Check if a shift is already signed for today (immutable for non-admins)
  isShiftSigned(shift) {
    if (this.adminMode) return false; // Admins can always edit
    const today = this.getToday();
    const sectionField = 'aprupetaja_paraksts';
    return this.history.some(h => 
      h.category === 'paraksts' && 
      h.field === sectionField && 
      h.shift === shift && 
      this.extractDateFromAnyField(h) === today
    );
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

    this.adminMode = sessionStorage.getItem('careAdminMode') === 'true' || params.get('mode') === 'admin';

    const adminBanner = document.getElementById('adminModeBanner');
    if (adminBanner) {
      adminBanner.style.display = this.adminMode ? 'block' : 'none';
    }

    this.db = new CareDB();
    await this.db.init();
    window.careDB = this.db;
    this.sync = new CareSync(this.db, CONFIG);
    window.careSync = this.sync;

    if (this.adminMode) {
      const caregiverId = sessionStorage.getItem('careAdminCaregiverId') || params.get('caregiverId');
      if (caregiverId) {
        const caregiver = await this.db.get('darbinieki', caregiverId);
        if (caregiver) {
          this.currentUser = {
            ...this.currentUser,
            id: caregiver.id || caregiver.ID,
            vards: caregiver.vards || caregiver.Vārds,
            uzvards: caregiver.uzvards || caregiver.Uzvārds,
            loma: caregiver.loma || caregiver.Loma,
            pin: caregiver.pin || caregiver['PIN kods'],
            mainaTips: caregiver.maina_tips || caregiver.mainaTips || caregiver[' Maiņa tips'] || 'diennakts',
            _adminOverride: true,
            _adminName: (this.currentUser.vards || this.currentUser.Vārds || '') + ' ' + (this.currentUser.uzvards || this.currentUser.Uzvārds || '')
          };
        }
      }
    }

    const adminCaregiverName = document.getElementById('adminModeCaregiverName');
    if (adminCaregiverName && this.adminMode && this.currentUser._adminOverride) {
      adminCaregiverName.textContent = (this.currentUser.vards || this.currentUser.Vārds || '') + ' ' + (this.currentUser.uzvards || this.currentUser.Uzvārds || '');
    }

    // DZEST syncComplete listener — neauto renderēt, lai lietotājs nezaudētu fokusu

    this.setupLanguageSwitcher();

    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const retryBtn = document.getElementById('retryLoadBtn');
    if (overlay) overlay.style.display = 'flex';

    // Retry button handler - clears IndexedDB cache and reloads
    if (retryBtn) {
      retryBtn.onclick = async () => {
        retryBtn.disabled = true;
        retryBtn.textContent = '⏳ Notīra cache...';
        try {
          // Clear all IndexedDB stores
          const stores = ['darbinieki', 'klienti', 'atzimes', 'atzimes_log', 'uzdevomi', 'sync_queue'];
          for (const store of stores) {
            await this.db.clear(store);
          }
          // Reload page
          window.location.reload();
        } catch (e) {
          this.toast('Kļūda: ' + e.message, 4000);
          retryBtn.disabled = false;
          retryBtn.textContent = t('retryLoad');
        }
      };
    }

try {
      const syncResult = await this.sync.loadInitialData((msg) => {
        if (loadingText) loadingText.textContent = msg;
      }, { clientId: this.clientId });
      if (syncResult && syncResult.offline) {
        // NO FALLBACK - Google Sheets is ONLY source of truth
        this.toast('⛔ NEIZDEVĀS ielādēt datus no Google Sheets: ' + (syncResult.error || 'Nav savienojuma'), 10000);
        if (retryBtn) {
          retryBtn.style.display = 'block';
        }
        if (overlay) overlay.style.display = 'flex';
        return; // Don't render anything - no data loaded
      }
      await Promise.all([
        this.loadClient(),
        this.loadMarks(),
        this.loadHistory(),
        this.loadAllClientMarks()
      ]);
      this.renderForm();
      this.renderHistory();
      this.renderSignature();
      this.updateTeamSummary();
      this.renderQuickTotals();
      this.toast('✓ Dati ielādēti no Google Sheets');
    } catch (e) {
      console.error(e);
      this.toast('⛔ Kļūda ielādējot datus: ' + (e.message || 'Nezināma kļūda'), 10000);
      if (retryBtn) {
        retryBtn.style.display = 'block';
      }
      if (overlay) overlay.style.display = 'flex';
      return; // Don't render
    } finally {
      if (overlay) overlay.style.display = 'none';
      this._initialLoadDone = true;
    }

    this.setupEventListeners();
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
      if (this.adminMode) {
        window.location.href = 'admin.html';
      } else {
        window.location.href = 'aprupe.html';
      }
    });

    // Sync status listener
    window.addEventListener('syncStatusChange', (e) => {
      const syncStatusEl = document.getElementById('syncStatus');
      const manualSyncBtn = document.getElementById('manualSyncBtn');
      if (syncStatusEl) {
        syncStatusEl.textContent = e.detail;
        syncStatusEl.className = 'sync-badge ' + e.detail.replace(/ /g, '-');
      }
      if (manualSyncBtn) {
        manualSyncBtn.style.display = navigator.onLine ? 'inline-flex' : 'none';
      }
    });

    // Manual sync button handler
    const manualSyncBtn = document.getElementById('manualSyncBtn');
    if (manualSyncBtn) {
      manualSyncBtn.addEventListener('click', async () => {
        if (!navigator.onLine) {
          this.toast(t('offline'));
          return;
        }
        manualSyncBtn.disabled = true;
        manualSyncBtn.innerHTML = '<span>⏳</span> <span data-i18n="syncing">Sinhronizē...</span>';
        try {
          const result = await this.sync.forceFullSync((msg) => {
            if (typeof this.toast === 'function') this.toast(msg, 3000);
          }, { clientId: this.clientId });
          if (result.offline) {
            this.toast('⚠️ ' + (result.error || 'Sinhronizācija neizdevās'), 4000);
          } else {
            // Rendering is handled by syncComplete event listener
            this.toast('✅ Sinhronizācija pabeigta. Visi dati atjaunoti no Google Sheets.');
          }
        } catch (err) {
          this.toast('⚠️ Kļūda: ' + err.message, 4000);
        } finally {
          manualSyncBtn.disabled = false;
          manualSyncBtn.innerHTML = '<span>🔄</span> <span data-i18n="syncBtn">Sinhronizēt</span>';
          if (typeof applyLanguage === 'function') applyLanguage();
        }
      });
    }

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
          sessionStorage.removeItem('careAdminMode');
          sessionStorage.removeItem('careAdminCaregiverId');
          window.location.href = 'index.html';
        }
      });
    }

    document.querySelectorAll('.shift-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.shift-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentShift = e.currentTarget.dataset.shift;
        this.updateCategoryStatuses();
        this.renderSignature();
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
      this.toast(t('clientNotFound'));
      setTimeout(() => window.location.href = 'aprupe.html', 1500);
      return;
    }

    const vards = this.client.vards || this.client.Vārds || '';
    const uzvards = this.client.uzvards || this.client.Uzvārds || '';
    document.getElementById('clientName').textContent = vards + ' ' + uzvards;
    document.getElementById('clientName2').textContent = vards + ' ' + uzvards;
    const dobRaw = this.client.dzimis || this.client['Dzimšanas datums'] || this.client.dzimsans_datums || this.client.birth_date || '';
    const dobDisplay = this.formatDob(dobRaw);
    const age = this.calculateAge(dobRaw);
    const ageDisplay = age ? (age + ' gadi') : 'Vecums nav norādīts';
    document.getElementById('clientDob').textContent = 'Dzimis: ' + dobDisplay + ' • ' + ageDisplay;
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

  calculateAge(dob) {
    if (!dob) return '';
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return '';
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age >= 0 ? age : '';
  }

  extractDate(v) {
    if (!v) return '';
    return TimezoneUtils.formatDateRiga(v);
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

  extractTimeForSort(t) {
    if (!t) return '';
    return TimezoneUtils.formatTimeRiga(t).substring(0, 5);
  }

  extractTimeDisplay(t) {
    if (!t) return '';
    return TimezoneUtils.formatTimeRiga(t);
  }

  getMarkTime(m) {
    return m.created || m.izveidots || m.lastModified || m.pedeja_laiks || m.pēdējais_laiks || m.time || m.laiks || '';
  }

  getMarkTimeLocal(m) {
    const t = this.getMarkTime(m);
    if (!t) return null;
    if (t instanceof Date) return t;
    if (typeof t === 'string') {
      const d = new Date(t);
      if (!isNaN(d.getTime()) && d.getFullYear() > 1900) return d;
    }
    return null;
  }

  async loadMarks() {
    const today = this.getToday();
    const allMarks = await this.db.getAll('atzimes');
    if (allMarks.length > 0) {
      const sample = allMarks[0];
      if (sample.date || sample.datums || sample.lastModified || sample.pedeja_laiks || sample.created) {
        console.log('[care_form] sample dates:',
          sample.date, '|', sample.datums, '|', sample.lastModified, '|', sample.pedeja_laiks, '|', sample.created,
          '| today=', today, '| recent=', this.isRecent(sample, today));
      }
    }
    this.marks.clear();
    let matched = 0;
    allMarks.filter(m => this.clientIdsMatch(m, this.clientId))
            .filter(m => {
              if (this.isToday(m, today)) { matched++; return true; }
              return false;
            })
            .forEach(m => {
              const shift = m.shift || m.periods;
              const key = shift + '|' + m.category + '|' + m.field;
              this.marks.set(key, m);
            });
  }

  isToday(m, today) {
    const date = this.extractDate(m.created) ||
                 this.extractDate(m.izveidots) ||
                 this.extractDate(m.date) ||
                 this.extractDate(m.datums) ||
                 this.extractDate(m.pedeja_laiks) ||
                 this.extractDate(m.lastModified);
    return date === today;
  }

  isRecent(m, today) {
    const primary = [
      this.extractDate(m.created),
      this.extractDate(m.izveidots),
      this.extractDate(m.date),
      this.extractDate(m.datums),
      this.extractDate(m.pedeja_laiks),
      this.extractDate(m.lastModified)
    ].filter(Boolean);
    if (primary.length === 0) return true;
    if (primary.includes(today)) return true;
    for (let i = 1; i <= 7; i++) {
      if (primary.includes(TimezoneUtils.offsetDaysRiga(-i))) return true;
    }
    return false;
  }

  getToday() {
    return TimezoneUtils.getTodayRiga();
  }

  getOffsetDate(days) {
    return TimezoneUtils.offsetDaysRiga(days);
  }

  clientIdsMatch(mark, clientId) {
    if (!mark) return false;
    const ids = [mark.clientId, mark.klients_id, mark.klientsId, mark.klienti_id];
    return ids.includes(clientId);
  }

  async loadHistory() {
    const today = this.getToday();
    const allLog = await this.db.getAll('atzimes_log');
    console.log('[loadHistory] allLog count:', allLog.length, 'clientId:', this.clientId, 'today:', today);
    const clientMatched = allLog.filter(l => this.clientIdsMatch(l, this.clientId));
    console.log('[loadHistory] client matched:', clientMatched.length);
    const todayMatched = clientMatched.filter(l => this.isToday(l, today));
    console.log('[loadHistory] today matched:', todayMatched.length);
    console.log('[loadHistory] sample log:', JSON.stringify(allLog.length > 0 ? allLog[0] : null));

    // Fallback: if log is empty, build history from current atzimes marks
    let historyEntries = todayMatched;
    if (historyEntries.length === 0) {
      const allMarks = await this.db.getAll('atzimes');
      const clientMarks = allMarks.filter(m => this.clientIdsMatch(m, this.clientId) && this.isToday(m, today));
      historyEntries = clientMarks.map(m => ({
        id: m.id,
        markId: m.id,
        clientId: m.clientId,
        employeeId: m.employeeId || m.darbinieks_id,
        date: today,
        time: m.laiks || m.lastModified || m.pedeja_laiks || '',
        shift: m.shift || m.periods,
        category: m.category || m.kategorija,
        field: m.field || m.lauka_nosaukums,
        value: m.value || m.vertiba,
        prevValue: m.pedeja_vertiba || '',
        type: 'Jauns',
        created: m.lastModified || m.pedeja_laiks || m.created || m.izveidots || ''
      }));
      console.log('[loadHistory] fallback from atzimes:', historyEntries.length);
    }

    this.history = historyEntries
      .sort((a, b) => {
        const ta = this.extractTimeForSort(this.getMarkTime(a)) || a.lastModified || a.created || a.izveidots || '';
        const tb = this.extractTimeForSort(this.getMarkTime(b)) || b.lastModified || b.created || b.izveidots || '';
        return String(tb).localeCompare(String(ta));
      });

    const employees = await this.db.getAll('darbinieki');
    const empMap = {};
    employees.forEach(e => {
      const id = e.id || e.ID;
      const uzvards = e.uzvards || e.Uzvārds || e.uzvārds || '';
      empMap[id] = uzvards;
      empMap[String(id)] = uzvards;
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
        tempEl.textContent = t('tempNotMeasured');
        tempEl.className = 'cat-status';
      }
    }

    const higienaFields = CONFIG.FIELD_DEFINITIONS.higiena.fields;
    const higienaDone = higienaFields.filter(f => this.getMark(shift, 'higiena', f.field)).length;
    const higienaEl = document.getElementById('status-higiena');
    if (higienaEl) {
      if (higienaDone === higienaFields.length) {
        higienaEl.textContent = t('hygieneAllDone');
        higienaEl.className = 'cat-status completed';
      } else if (higienaDone > 0) {
        higienaEl.textContent = higienaDone + ' / ' + higienaFields.length;
        higienaEl.className = 'cat-status';
      } else {
        higienaEl.textContent = t('hygieneNotStarted');
        higienaEl.className = 'cat-status';
      }
    }

    const aktFields = CONFIG.FIELD_DEFINITIONS.aktivitate.fields;
    const aktDone = aktFields.filter(f => this.getMark(shift, 'aktivitate', f.field)).length;
    const aktEl = document.getElementById('status-aktivitate');
    if (aktEl) {
      if (aktDone === aktFields.length) {
        aktEl.textContent = t('activityAllDone');
        aktEl.className = 'cat-status completed';
      } else if (aktDone > 0) {
        aktEl.textContent = aktDone + ' / ' + aktFields.length;
        aktEl.className = 'cat-status';
      } else {
        aktEl.textContent = t('activityNotStarted');
        aktEl.className = 'cat-status';
      }
    }

    const edinFields = CONFIG.FIELD_DEFINITIONS.edinasana.fields;
    const edinDone = edinFields.filter(f => this.getMark(shift, 'edinasana', f.field)).length;
    const edinEl = document.getElementById('status-edinasana');
    if (edinEl) {
      if (edinDone === edinFields.length) {
        edinEl.textContent = t('mealsAllDone');
        edinEl.className = 'cat-status completed';
      } else if (edinDone > 0) {
        edinEl.textContent = edinDone + ' / ' + edinFields.length;
        edinEl.className = 'cat-status';
      } else {
        edinEl.textContent = t('mealsNotStarted');
        edinEl.className = 'cat-status';
      }
    }

    const uznemts = this.getMark(shift, 'sikdrumi', 'uznemts_ml');
    const h2oEl = document.getElementById('status-h2o');
    if (h2oEl) {
      if (uznemts && uznemts.value) {
        h2oEl.innerHTML = '✓ ' + uznemts.value + ' ml' + lastByFor(uznemts);
        h2oEl.className = 'cat-status completed';
      } else {
        h2oEl.textContent = t('fluidNoRecord');
        h2oEl.className = 'cat-status';
      }
    }

    const urins = this.getMark(shift, 'sikdrumi', 'urina_daudzums');
    const urinaEl = document.getElementById('status-urina');
    if (urinaEl) {
      if (urins && urins.value) {
        urinaEl.innerHTML = '✓ ' + urins.value + ' ml' + lastByFor(urins);
        urinaEl.className = 'cat-status completed';
      } else {
        urinaEl.textContent = t('urineNoRecord');
        urinaEl.className = 'cat-status';
      }
    }

    const fizMark = this.getMark(shift, 'fiziologija', 'vedera_izeja');
    const fizEl = document.getElementById('status-fiziologija');
    if (fizEl) {
      if (fizMark && fizMark.value) {
        fizEl.innerHTML = '✓ ' + fizMark.value + lastByFor(fizMark);
        fizEl.className = 'cat-status completed';
      } else {
        fizEl.textContent = t('stoolNoRecord');
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
        diapersEl.textContent = t('diaperNoChange');
        diapersEl.className = 'cat-status';
      }
    }

    const markAda = this.getMark(shift, 'citsi_pasakomi', 'adas_kopsana');
    const adaEl = document.getElementById('status-ada');
    if (adaEl) {
      if (markAda && markAda.value === 'X') {
        adaEl.textContent = t('skinCareDone');
        adaEl.className = 'cat-status completed';
      } else {
        adaEl.textContent = t('skinCareNotDone');
        adaEl.className = 'cat-status';
      }
    }

    const markPastaiga = this.getMark(shift, 'citsi_pasakomi', 'pastaigas');
    const pastaigaEl = document.getElementById('status-pastaiga');
    if (pastaigaEl) {
      if (markPastaiga && markPastaiga.value === 'X') {
        pastaigaEl.textContent = t('walkDone');
        pastaigaEl.className = 'cat-status completed';
      } else {
        pastaigaEl.textContent = t('walkNotDone');
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
        cieminiEl.textContent = t('visitorsNoRecord');
        cieminiEl.className = 'cat-status';
      }
    }
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
      h2o: '💧 H2O',
      urina: '💧 Urīna daudzums',
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
    else if (cat === 'h2o') html = this.renderH2oSection(shift);
    else if (cat === 'urina') html = this.renderUrinaSection(shift);
    else if (cat === 'fiziologija') html = this.renderFiziologijaSection(shift);
    else if (cat === 'ada') html = this.renderAdaSection(shift);
    else if (cat === 'pastaiga') html = this.renderPastaigaSection(shift);
    else if (cat === 'ciemini') html = this.renderCieminiSection(shift);
    else if (cat === 'diapers') html = this.renderDiapersSection(shift);
    body.innerHTML = html;
    modal.style.display = 'flex';
    this.bindFormEvents();
    if (cat === 'h2o' || cat === 'urina') this.attachSikdrumiHandlers();
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
    return this.renderH2oSection(shift) + this.renderUrinaSection(shift);
  }

  renderH2oSection(shift) {
    const uznemtsMark = this.getMark(shift, 'sikdrumi', 'uznemts_ml');
    const dayTotals = this.getDaySikdrumiTotals();
    const currentTotal = uznemtsMark ? uznemtsMark.value : '0';
    const uznLast = uznemtsMark ? uznemtsMark.value + ' ml' : '-';
    const body = `
      <div class="section-row">
        <div class="section-row-label">
          <span>H2O (ml)</span>
          <span class="current-value ${currentTotal !== '0' ? 'has-value' : 'empty'}">${currentTotal !== '0' ? '✓ Kopā: ' + currentTotal + ' ml' : 'Nav ieraksta'}</span>
        </div>
        <input type="number" min="0" step="50" class="number-input" data-cat="sikdrumi" data-field="uznemts_ml" data-shift="${shift}" placeholder="Pievienot (ml)" value="0">
        <small style="color:#666;font-size:11px;display:block;margin-top:4px;">Pašreizējais kopsumma: ${currentTotal} ml. Ievadiet daudzumu, ko pievienot.</small>
        <button class="submit-btn" data-submit-sikdrumi="uznemts_ml" data-shift="${shift}">✓ Pievienot</button>
      </div>
      <div class="section-row" style="border-bottom: none;">
        <div class="field-info">
          <strong>Dienas kopā:</strong> ${dayTotals.uznemts} ml<br>
          <strong>Pēdējais ieraksts:</strong> ${uznLast}
        </div>
      </div>
    `;
    return this.sectionCard('section-h2o', '💧', 'H2O', null, body);
  }

  renderUrinaSection(shift) {
    const urinsMark = this.getMark(shift, 'sikdrumi', 'urina_daudzums');
    const dayTotals = this.getDaySikdrumiTotals();
    const currentTotal = urinsMark ? urinsMark.value : '0';
    const urinLast = urinsMark ? urinsMark.value + ' ml' : '-';
    const body = `
      <div class="section-row">
        <div class="section-row-label">
          <span>Urīna daudzums (ml)</span>
          <span class="current-value ${currentTotal !== '0' ? 'has-value' : 'empty'}">${currentTotal !== '0' ? '✓ Kopā: ' + currentTotal + ' ml' : 'Nav ieraksta'}</span>
        </div>
        <input type="number" min="0" step="50" class="number-input" data-cat="sikdrumi" data-field="urina_daudzums" data-shift="${shift}" placeholder="Pievienot (ml)" value="0">
        <small style="color:#666;font-size:11px;display:block;margin-top:4px;">Pašreizējais kopsumma: ${currentTotal} ml. Ievadiet daudzumu, ko pievienot.</small>
        <button class="submit-btn" data-submit-sikdrumi="urina_daudzums" data-shift="${shift}">✓ Pievienot</button>
      </div>
      <div class="section-row" style="border-bottom: none;">
        <div class="field-info">
          <strong>Dienas kopā:</strong> ${dayTotals.urina} ml<br>
          <strong>Pēdējais ieraksts:</strong> ${urinLast}
        </div>
      </div>
    `;
    return this.sectionCard('section-urina', '💧', 'Urīna daudzums', null, body);
  }

  getDaySikdrumiTotals() {
    let urina = 0;
    let uznemts = 0;
    const today = this.getToday();
    if (this.allClientMarks) {
      this.allClientMarks.forEach(m => {
        if (!this.isToday(m, today)) return;
        if (m.category !== 'sikdrumi') return;
        const v = parseInt(m.value);
        if (isNaN(v)) return;
        if (m.field === 'urina_daudzums') urina += v;
        if (m.field === 'uznemts_ml') uznemts += v;
      });
    }
    return { urina, uznemts };
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
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        const cat = e.currentTarget.dataset.cat;
        const field = e.currentTarget.dataset.field;
        const value = e.currentTarget.dataset.value;
        const shift = e.currentTarget.dataset.shift;
        this.handleOptionSelect(shift, cat, field, value, e.currentTarget);
      });
    });

    document.querySelectorAll('.diaper-btn').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        const cat = e.currentTarget.dataset.cat;
        const field = e.currentTarget.dataset.field;
        const shift = e.currentTarget.dataset.shift;
        this.handleDiaperIncrement(shift, cat, field, e.currentTarget);
      });
    });

    document.querySelectorAll('.fiziologija-select').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
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
      if (btn.dataset.submitSikdrumi) return;
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        const type = e.currentTarget.dataset.submit;
        if (type === 'temp') {
          const input = document.querySelector('input[data-cat="temp"][data-field="temperatura"]');
          if (input && input.value) {
            this.handleNumberChange('temp', 'temperatura', input.value, this.currentShift);
          } else {
            this.toast(t('enterTemperature'));
          }
        } else if (type === 'fiziologija') {
          this.handleFiziologijaSubmit();
        }
      });
    });

    document.querySelectorAll('.number-input').forEach(input => {
      if (input.dataset.bound) return;
      input.dataset.bound = '1';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (input.dataset.cat === 'temp') {
            const btn = document.querySelector('[data-submit="temp"]');
            if (btn) btn.click();
          } else if (input.dataset.cat === 'sikdrumi') {
            const field = input.dataset.field;
            const btn = document.querySelector('[data-submit-sikdrumi="' + field + '"]');
            if (btn) btn.click();
          }
        }
      });
    });
  }

  async handleSikdrumiSubmit(field) {
    if (this._processing.has('sikdrumi_submit')) return;
    this._processing.set('sikdrumi_submit', true);

    const urinsInput = document.querySelector('input[data-cat="sikdrumi"][data-field="urina_daudzums"]');
    const uznemtsInput = document.querySelector('input[data-cat="sikdrumi"][data-field="uznemts_ml"]');

    try {
      if (field === 'urina_daudzums') {
        const val = urinsInput ? urinsInput.value : '';
        const enteredVal = parseFloat(val) || 0;
        if (enteredVal <= 0) { this.toast(t('enterUrineAmount')); return; }
        const existing = this.marks.get(this.currentShift + '|sikdrumi|urina_daudzums');
        const currentTotal = existing ? parseFloat(existing.value) || 0 : 0;
        const newTotal = currentTotal + enteredVal;
        const result = await this.saveMarkDirect('sikdrumi', 'urina_daudzums', String(newTotal), this.currentShift, existing?.id);
        if (!result) return;
        if (urinsInput) urinsInput.value = '0';
      } else if (field === 'uznemts_ml') {
        const val = uznemtsInput ? uznemtsInput.value : '';
        const enteredVal = parseFloat(val) || 0;
        if (enteredVal <= 0) { this.toast(t('enterFluidAmount')); return; }
        const existing = this.marks.get(this.currentShift + '|sikdrumi|uznemts_ml');
        const currentTotal = existing ? parseFloat(existing.value) || 0 : 0;
        const newTotal = currentTotal + enteredVal;
        const result = await this.saveMarkDirect('sikdrumi', 'uznemts_ml', String(newTotal), this.currentShift, existing?.id);
        if (!result) return;
        if (uznemtsInput) uznemtsInput.value = '0';
      } else {
        return;
      }

      this.updateCategoryStatuses();
      this.renderQuickTotals();
      this.renderHistory();
      await this.loadAllClientMarks();
      await this.loadMarks();
      this.closeCategoryModal();
      this.toast(t('fluidSaved'));
    } catch (err) {
      console.error('[handleSikdrumiSubmit] Error:', err);
      this.toast('Kļūda saglabājot: ' + err.message);
    } finally {
      this._processing.delete('sikdrumi_submit');
    }
  }

  async saveMarkDirect(category, field, value, shift, existingId) {
    return await this.saveMark({
      clientId: this.clientId,
      shift: shift,
      category: category,
      field: field,
      value: value,
      prevValue: this.marks.get(shift + '|' + category + '|' + field) ? this.marks.get(shift + '|' + category + '|' + field).value : null,
      type: this.marks.get(shift + '|' + category + '|' + field) ? 'Labots' : 'Jauns',
      existingId: existingId
    });
  }

  attachSikdrumiHandlers() {
    document.querySelectorAll('button[data-submit-sikdrumi]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        this.handleSikdrumiSubmit(btn.dataset.submitSikdrumi);
      });
    });
  }

  async handleFiziologijaSubmit() {
    const selected = document.querySelector('.fiziologija-select.selected');
    if (!selected) {
      this.toast(t('selectValue'));
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
      return this.isToday(m, today);
    });

    const allLog = await this.db.getAll('atzimes_log');
    this.allClientLog = allLog.filter(l => {
      if (!this.clientIdsMatch(l, this.clientId)) return false;
      return this.isToday(l, today);
    });
  }

  renderQuickTotals() {
    if (!this.allClientMarks) return;

    const shift = this.currentShift;

    const fluidSum = this.allClientMarks
      .filter(m => m.category === 'sikdrumi' && (m.field === 'uznemts_ml' || m.field === 'uzņemts_ml' || m.field === 'uznemts_h2o'))
      .reduce((sum, m) => sum + (parseFloat(m.value) || 0), 0);

    const fluidLog = (this.allClientLog || [])
      .filter(l => l.category === 'sikdrumi' && (l.field === 'uznemts_ml' || l.field === 'uzņemts_ml' || l.field === 'uznemts_h2o'))
      .sort((a, b) => {
        const ta = this.extractTimeForSort(this.getMarkTime(a)) || a.created || '';
        const tb = this.extractTimeForSort(this.getMarkTime(b)) || b.created || '';
        return tb.localeCompare(ta);
      });
    const fluidLast = fluidLog[0];
    const fluidLastBy = fluidLast ? (this.empMap[fluidLast.employeeId] || '?') : null;
    const fluidTime = fluidLast ? this.extractTimeDisplay(this.getMarkTime(fluidLast)) : null;

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
        const ta = this.extractTimeForSort(this.getMarkTime(a)) || a.created || '';
        const tb = this.extractTimeForSort(this.getMarkTime(b)) || b.created || '';
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
        const lastTimeStr = this.extractTimeDisplay(this.getMarkTime(last));
        stoolMeta.textContent = 'Pēdējais: ' + valLabel + (lastTimeStr ? ' (' + lastTimeStr + ')' : '');
      } else {
        stoolMeta.textContent = 'Vēl neviens nav ievadījis';
      }
    }

    const diaperMarks = this.allClientMarks
      .filter(m => m.category === 'citsi_pasakomi' && (m.field === 'autins_biksitu_skaits' || m.field === 'autiņbiksīšu_skaits'));
    const diaperLog = (this.allClientLog || [])
      .filter(l => l.category === 'citsi_pasakomi' && (l.field === 'autins_biksitu_skaits' || l.field === 'autiņbiksīšu_skaits'))
      .sort((a, b) => {
        const ta = this.extractTimeForSort(this.getMarkTime(a)) || a.created || '';
        const tb = this.extractTimeForSort(this.getMarkTime(b)) || b.created || '';
        return tb.localeCompare(ta);
      });
    const diaperValue = document.getElementById('qtDiaperValue');
    if (diaperValue) {
      const total = diaperMarks.length > 0
        ? diaperMarks.reduce((sum, m) => sum + (parseInt(m.value) || 0), 0)
        : diaperLog.length;
      diaperValue.innerHTML = total + ' <span class="qt-unit">maiņas</span>';
    }
    const diaperMeta = document.getElementById('qtDiaperMeta');
    if (diaperMeta) {
      const last = diaperLog[0];
      if (last) {
        const lastBy = this.empMap[last.employeeId] || '?';
        const lastTimeStr = this.extractTimeDisplay(this.getMarkTime(last));
        diaperMeta.textContent = 'Pēdējais: ' + lastBy + (lastTimeStr ? ' (' + lastTimeStr + ')' : '');
      } else {
        diaperMeta.textContent = 'Vēl neviens nav ievadījis';
      }
    }
  }

  async handleDiaperIncrement(shift, category, field, btn) {
    if (this._processing.has('diaper_increment')) return;
    this._processing.set('diaper_increment', true);

    try {
      const key = shift + '|' + category + '|' + field;
      const existing = this.marks.get(key);
      const currentCount = existing ? parseInt(existing.value) || 0 : 0;
      const newCount = currentCount + 1;

      if (newCount > 99) {
        this.toast(t('tooManyDiaperChanges'));
        return;
      }

if (existing && existing.lastBy && existing.lastBy !== this.currentUser.id) {
      const otherName = this.empMap && this.empMap[existing.lastBy] ? this.empMap[existing.lastBy] : 'cits darbinieks';
      this.toast(t('recordModifiedBy') + otherName);
    }

      btn.classList.add('pulse');
      setTimeout(() => btn.classList.remove('pulse'), 300);

      const saveResult = await this.saveMark({
        clientId: this.clientId,
        shift: shift,
        category: category,
        field: field,
        value: String(newCount),
        prevValue: existing ? existing.value : null,
        type: existing ? 'Labots' : 'Jauns'
      });

      if (!saveResult) {
        return;
      }

      const logEntry = {
        id: this.db.generateId(),
        markId: saveResult.mark.id,
        clientId: this.clientId,
        employeeId: this.currentUser.id,
        date: this.getToday(),
        time: TimezoneUtils.getTimeRiga(),
        shift: shift,
        category: category,
        field: field,
        value: '+1 (kopā: ' + newCount + ')',
        type: 'Jauns',
        created: TimezoneUtils.getDateTimeRiga() + '.000Z'
      };
      await this.db.add('atzimes_log', logEntry);

      if (this.allClientLog) {
        this.allClientLog.unshift(logEntry);
      }
      this.history.unshift(logEntry);

      this.toast(t('diaperChangeAdded') + newCount + ')');
      this.updateCategoryStatuses();
      this.closeCategoryModal();
      this.renderQuickTotals();
      this.renderHistory();
    } finally {
      this._processing.delete('diaper_increment');
    }
  }

async handleOptionSelect(shift, category, field, value, btn) {
    if (MEAL_SHIFT[field] && shift !== MEAL_SHIFT[field]) {
      const correctShift = MEAL_SHIFT[field];
      const existing = this.marks.get(correctShift + '|' + category + '|' + field);
      if (existing && existing.value) {
        const who = this.empMap[existing.lastBy] || t('employee');
        const when = this.extractTimeDisplay(existing.lastModified) || '';
        const msg = correctShift === 'R' ? t('mealAlreadyMarkedMorning') : t('mealAlreadyMarkedEvening');
        this.toast(msg + ' (' + who + (when ? ', ' + when : '') + ')');
      } else {
        const msg = correctShift === 'R' ? t('mealSwitchToMorning') : t('mealSwitchToEvening');
        this.toast(msg);
      }
      return;
    }

    if (category === 'citsi_pasakomi' && field === 'ciemini' && value === 'Nē') {
      const otherShift = shift === 'R' ? 'V' : 'R';
      const otherMark = this.marks.get(otherShift + '|' + category + '|' + field);
      if (otherMark && otherMark.value === 'X') {
        const who = this.empMap[otherMark.lastBy] || t('employee');
        this.toast(t('visitorsMarkedByOther') + ' ' + who);
        return;
      }
    }

    const actionKey = 'opt_' + shift + '|' + category + '|' + field;
    if (this._processing.has(actionKey)) {
      return;
    }
    this._processing.set(actionKey, true);

    const key = shift + '|' + category + '|' + field;
    const existing = this.marks.get(key);

    if (existing && existing.lastBy && existing.lastBy !== this.currentUser.id) {
      const otherName = this.empMap && this.empMap[existing.lastBy] ? this.empMap[existing.lastBy] : 'cits darbinieks';
      this.toast('⚠️ Šis ieraksts ir modificēts no ' + otherName);
    }

    let result = null;
    try {
      if (existing && existing.value === value) {
        result = await this.saveMark({
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
        result = await this.saveMark({
          clientId: this.clientId,
          shift: shift,
          category: category,
          field: field,
          value: value,
          prevValue: existing ? existing.value : null,
          type: existing ? 'Labots' : 'Jauns'
        });
      }
    } finally {
      this._processing.delete(actionKey);
    }

    if (!result) return;

    const catMap = { temp: 'temp', higiena: 'higiena', aktivitate: 'aktivitate', edinasana: 'edinasana', sikdrumi: 'sikdrumi', fiziologija: 'fiziologija', citsi_pasakomi: 'citsi_pasakomi' };
    if (category === 'fiziologija') {
      const modal = document.getElementById('categoryModal');
      if (modal) modal.style.display = 'none';
    } else {
      const modal = document.getElementById('categoryModal');
      if (modal) modal.style.display = 'none';
    }
    this.renderQuickTotals();
    this.renderHistory();
    this.toast(t('saved'));
  }

  async handleNumberChange(category, field, value, shiftOverride) {
    const shift = shiftOverride || this.currentShift;
    
    if (category === 'temp') {
      const v = parseFloat(value);
      if (isNaN(v) || v < 30 || v > 45) {
        this.toast(t('temperatureRange'));
        return;
      }
    }
    if (category === 'sikdrumi') {
      const v = parseFloat(value);
      if (isNaN(v) || v < 0 || v > 10000) {
        this.toast(t('valueNotNegative'));
        return;
      }
    }
    
    const key = shift + '|' + category + '|' + field;
    const existing = this.marks.get(key);
    if (existing && existing.lastBy && existing.lastBy !== this.currentUser.id) {
      const otherName = this.empMap && this.empMap[existing.lastBy] ? this.empMap[existing.lastBy] : 'cits darbinieks';
      this.toast(t('recordModifiedBy') + otherName);
    }
    
    const result = await this.saveMark({
      clientId: this.clientId,
      shift: shift,
      category: category,
      field: field,
      value: value,
      prevValue: existing ? existing.value : null,
      type: existing ? 'Labots' : 'Jauns'
    });
    if (!result) return;
    this.toast(t('saved'));
    this.renderQuickTotals();
    this.renderHistory();
    const modal = document.getElementById('categoryModal');
    if (modal) modal.style.display = 'none';
  }

  async saveMark(data) {
    const actionKey = data.shift + '|' + data.category + '|' + data.field;
    if (this._processing.has(actionKey)) {
      return null;
    }
    this._processing.set(actionKey, true);

    try {
      const today = this.getToday();
      const nowRiga = TimezoneUtils.getNowRiga();
      const timeStr = TimezoneUtils.getTimeRiga();
      const nowUTC = nowRiga.toISOString();

      const existingMark = this.marks.get(actionKey);
      const id = data.existingId || existingMark?.id || this.db.generateId();

      const mark = {
        id: id,
        clientId: data.clientId,
        employeeId: this.currentUser.id,
        date: today,
        shift: data.shift,
        category: data.category,
        field: data.field,
        value: data.value,
        lastModified: nowUTC,
        lastBy: this.currentUser.id,
        mainaTips: this.currentUser.mainaTips || 'diennakts'
      };

      const key = data.shift + '|' + data.category + '|' + data.field;
      this.marks.set(key, mark);

      await this.db.put('atzimes', mark);

      // For sikdrumi category, show the increment in history instead of running total
      let logValue = data.value;
      if (data.category === 'sikdrumi' && data.prevValue !== null && data.prevValue !== undefined && data.prevValue !== '') {
        const prev = parseFloat(data.prevValue);
        const current = parseFloat(data.value);
        if (!isNaN(prev) && !isNaN(current)) {
          const diff = current - prev;
          if (diff > 0) logValue = '+' + diff;
          else if (diff < 0) logValue = String(diff);
        }
      }

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
        value: logValue,
        prevValue: data.prevValue,
        type: data.type,
        created: nowUTC,
        mainaTips: this.currentUser.mainaTips || 'diennakts'
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
          reason: data.type === 'Labots' ? 'Labots' : null,
          lastModified: nowUTC,
          actionId: 'mark_' + data.clientId + '_' + data.shift + '_' + data.category + '_' + data.field + '_' + today + '_' + (this.currentUser.id || ''),
          mainaTips: this.currentUser.mainaTips || 'diennakts'
        }
      });

      if (this.allClientMarks) {
        const idx = this.allClientMarks.findIndex(m => m.shift === mark.shift && m.category === mark.category && m.field === mark.field);
        if (idx >= 0) {
          this.allClientMarks[idx] = mark;
        } else {
          this.allClientMarks.push(mark);
        }
      }
      if (this.allClientLog) {
        this.allClientLog.unshift(logEntry);
      }
      this.history.unshift(logEntry);

      this.updateCategoryStatuses();
      this.toast('Saglabāts');
      return { mark, logEntry };
    } finally {
      this._processing.delete(actionKey);
    }
  }

  escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  renderHistory() {
    const container = document.getElementById('historyContainer');
    if (!container) return;
    if (!this.history || this.history.length === 0) {
      container.innerHTML = '<div class="loading">Nav ierakstu</div>';
      return;
    }

    container.innerHTML = this.history.map(entry => {
      const eid = entry.employeeId || entry.darbinieks_id;
      const actor = this.empMap[eid] || this.empMap[String(eid)] || 'Nezināms';
      const fieldLabel = this.getFieldLabel(entry.category, entry.field);
      const valueDisplay = this.formatHistoryValue(entry.category, entry.field, entry.value);
      const isEdit = entry.type === 'Labots';
      const time = this.extractTimeDisplay(this.getMarkTime(entry)) || '';
      return `
        <div class="history-item">
          <div class="history-action">
            <strong>${this.escapeHtml(time)}</strong> – ${fieldLabel}: <strong>${this.escapeHtml(valueDisplay)}</strong>
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
      if (!isNaN(v) && v >= 37) return value + '°C (drudzis)';
      return value || '-';
    }
    if (!value || value === '') return 'notīrīts';
    return value;
  }

  async renderSignature() {
    const signBtn = document.getElementById('signBtn');
    const signedBy = document.getElementById('signedBy');
    const userRole = String(this.currentUser.loma || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const mainaTips = String(this.currentUser.mainaTips || '').toLowerCase();
    const isDiennakts = mainaTips === 'diennakts';
    const isAdmin = userRole === 'administrators' || this.adminMode;
    // Tikai diennakts (24h) aprūpētāji var parakstīt
    const canSign = isDiennakts || isAdmin;
    // R/V no izvēlētās cilnes (currentShift)
    const signatureShift = this.currentShift;
    const today = this.getToday();

    // Button text based on shift
    const btnText = signatureShift === 'R' ? 'Maiņu nododu!' : 'Maiņu pieņemu!';
    const shiftLabel = signatureShift === 'V' ? 'Vakars' : 'Rīts';

    const sectionField = 'aprupetaja_paraksts';
    const signatureForShift = this.history.find(h => {
      return h.category === 'paraksts' &&
        (h.field === sectionField || h.field === 'r_paraksts' || h.field === 'v_paraksts') &&
        h.shift === signatureShift &&
        this.extractDateFromAnyField(h) === today;
    });
    const signatureAny = this.history.find(h => h.category === 'paraksts' && (h.field === sectionField || h.field === 'r_paraksts' || h.field === 'v_paraksts'));

    // Check database for any signature from any day for this client
    let anySignature = signatureAny;
    if (!anySignature && this.db) {
      try {
        const allMarks = await this.db.getAll('atzimes');
        anySignature = allMarks.find(m =>
          m.category === 'paraksts' &&
          (m.field === sectionField || m.field === 'r_paraksts' || m.field === 'v_paraksts') &&
          this.clientIdsMatch(m, this.clientId)
        );
      } catch (e) {
        console.warn('[care_form] renderSignature: DB query for sectionSignature failed:', e);
      }
    }

    const signature = signatureForShift || anySignature;

    // Check if another caregiver already signed this shift today
    const otherSignedId = signatureForShift ? (signatureForShift.employeeId || signatureForShift.darbinieks_id) : null;
    const otherEmployeeSigned = otherSignedId && !isAdmin && String(otherSignedId) !== String(this.currentUser.id || '');

    if (signatureForShift) {
      // Already signed this shift today
      const actor = this.empMap[signatureForShift.employeeId || signatureForShift.darbinieks_id] || 'Nezināms';
      const who = actor === this.empMap[this.currentUser.id] ? 'Tu' : actor;
      const time = this.extractTimeDisplay(this.getMarkTime(signatureForShift)) || '';
      const adminNote = this.currentUser._adminOverride ? ' (ADMIN: ' + (this.currentUser._adminName || 'Administrators') + ')' : '';

      signBtn.textContent = btnText + ' ✓';
      signBtn.classList.add('signed');
      signBtn.disabled = !isAdmin;
      signedBy.textContent = shiftLabel + ' paraksts: ' + who + adminNote + ' (' + time + ')';
      signedBy.style.display = 'block';
    } else if (otherEmployeeSigned) {
      // Another caregiver signed this shift today
      const actor = this.empMap[otherSignedId] || 'Cits darbinieks';
      signBtn.textContent = btnText;
      signBtn.classList.add('signed');
      signBtn.disabled = true;
      signedBy.textContent = shiftLabel + ' paraksts: ' + actor + ' (jau parakstījis šodien)';
      signedBy.style.display = 'block';
    } else {
      // Not signed yet
      signBtn.textContent = btnText;
      signBtn.classList.remove('signed');
      signBtn.disabled = !canSign;
      signedBy.style.display = 'none';
    }
  }

async handleSign() {
    if (this._processing.has('sign')) return;
    this._processing.set('sign', true);
    const signBtn = document.getElementById('signBtn');
    if (signBtn) signBtn.disabled = true;

    try {
      const userRole = (this.currentUser.loma || '').toLowerCase();
      const mainaTips = String(this.currentUser.mainaTips || '').toLowerCase();
      const isAdmin = userRole === 'administrators' || this.adminMode;
      const isDiennakts = mainaTips === 'diennakts';
      if (userRole !== 'aprūpētājs' && userRole !== 'aprupetas' && !isAdmin) {
        this.toast(t('onlyCaregiversCanSign'));
        return;
      }
      // Tikai diennakts (24h) aprūpētāji var parakstīt
      if (!isDiennakts && !isAdmin) {
        this.toast('Jūs esat dienas maiņas darbinieks. Jums nav jāparakstās — to darīs diennakts darbinieks!');
        return;
      }

      const today = this.getToday();
      const nowRiga = TimezoneUtils.getNowRiga();
      const timeStr = TimezoneUtils.getTimeRiga();
      const nowUTC = nowRiga.toISOString();
      const signatureShift = this.currentShift; // R/V from selected tab
      const shiftLabel = signatureShift === 'R' ? 'Rīts' : 'Vakars';

      const sectionField = 'aprupetaja_paraksts';
      const existingForShift = this.history.find(h => {
        return h.category === 'paraksts' &&
          (h.field === sectionField || h.field === 'r_paraksts' || h.field === 'v_paraksts') &&
          h.shift === signatureShift &&
          this.extractDateFromAnyField(h) === today;
      });

      // Check if another caregiver already signed this shift today
      if (existingForShift && !isAdmin) {
        const signerId = existingForShift.employeeId || existingForShift.darbinieks_id;
        if (signerId && String(signerId) !== String(this.currentUser.id || '')) {
          const signerName = this.empMap[signerId] || this.empMap[String(signerId)] || 'cits darbinieks';
          this.toast(shiftLabel + ' sadaļu šodien jau parakstījis ' + signerName);
          return;
        }
      }

      const signatureValue = this.currentUser.uzvards || this.currentUser.vards || '';
      const adminNote = this.currentUser._adminOverride ? t('adminOverridePrefix') + (this.currentUser._adminName || t('admins')) + ']' : '';
      const displayValue = signatureValue + adminNote;
      const mark = {
        id: existingForShift ? (existingForShift.id || existingForShift.markId) : this.db.generateId(),
        clientId: this.clientId,
        employeeId: this.currentUser.id,
        date: today,
        shift: signatureShift,
        category: 'paraksts',
        field: 'aprupetaja_paraksts',
        value: displayValue,
        lastModified: nowUTC,
        lastBy: this.currentUser.id,
        mainaTips: mainaTips
      };

      const key = signatureShift + '|paraksts|aprupetaja_paraksts';
      this.marks.set(key, mark);
      await this.db.put('atzimes', mark);

      const logEntry = {
        id: this.db.generateId(),
        markId: mark.id,
        clientId: this.clientId,
        employeeId: this.currentUser.id,
        date: today,
        time: timeStr,
        shift: signatureShift,
        category: 'paraksts',
        field: 'aprupetaja_paraksts',
        value: displayValue,
        prevValue: existingForShift ? existingForShift.value : null,
        type: existingForShift ? t('rewritten') : 'Jauns',
        created: nowUTC
      };
      await this.db.add('atzimes_log', logEntry);

      if (this.allClientLog) {
        this.allClientLog.unshift(logEntry);
      }
      this.history.unshift(logEntry);

      this.sync.enqueueChange({
        action: 'mark',
        table: 'atzimes',
        data: {
          clientId: this.clientId,
          employeeId: this.currentUser.id,
          date: today,
          shift: signatureShift,
          category: 'paraksts',
          field: 'aprupetaja_paraksts',
          value: displayValue,
          reason: existingForShift ? t('rewritten') : (this.currentUser._adminOverride ? t('adminSignatureReason') + (this.currentUser._adminName || t('admins')) : t('nightShiftSignatureReason')),
          // Sūtām UTC timestamp backendam
          lastModified: nowUTC,
          actionId: 'sign_' + (this.currentUser.id || '') + '_' + signatureShift + '_' + today
        }
      });

      // Sinhronizācija notiek fonā pēc 500ms (debounced), nevis pēc katra ieraksta

      this.renderSignature();
      this.updateCategoryStatuses();
      this.toast(existingForShift ? t('resigned') : t('signed'));
    } finally {
      this._processing.delete('sign');
      setTimeout(() => {
        const btn = document.getElementById('signBtn');
        if (btn) btn.disabled = false;
      }, 500);
    }
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
