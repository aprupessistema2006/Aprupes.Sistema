class LoginController {
  constructor() {
    this.db = null;
    this.sync = null;
    this.user = null;
    this.employees = [];
    this.filteredEmployees = [];
    this.selectedEmployee = null;
    this.pin = '';
    this.setupMode = false;
    this.init();
  }

  async init() {
    this.db = new CareDB();
    await this.db.init();
    window.careDB = this.db;
    this.sync = new CareSync(this.db, CONFIG);
    window.careSync = this.sync;

    const savedUser = sessionStorage.getItem('careUser');
    if (savedUser) {
      try {
        const user = JSON.parse(savedUser);
        if (user.pinVerified) {
          this.redirectByRole(user.loma);
          return;
        }
      } catch (e) {}
    }

    this.setupUI();
    this.setupLanguageSwitcher();
    this.hideSplash();

    const statusMsg = document.getElementById('statusMessage');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');

    const showLoading = (text) => {
      if (loadingOverlay) loadingOverlay.style.display = 'flex';
      if (loadingText) loadingText.textContent = text;
    };
    const hideLoading = () => {
      if (loadingOverlay) loadingOverlay.style.display = 'none';
    };

    showLoading('Pārbaudām savienojumu ar Google...');

    let hasRemote = false;
    let hasLocal = false;
    let remoteError = null;

    // Quick connection check (short timeout) — informational only.
    // We ALWAYS proceed to loadInitialData afterwards because GAS cold-start
    // can exceed the quick ping timeout on mobile networks.
    try {
      const conn = await this.sync.checkConnection();
      hasRemote = conn.connected;
      if (!hasRemote) remoteError = conn.message || 'Nav savienojuma';
    } catch (e) {
      console.error('[login] remote check failed', e);
      remoteError = e.message;
    }

    if (!hasRemote) {
      try {
        hasLocal = await this.sync.hasLocalData();
      } catch (e) {
        console.error('[login] local check failed', e);
      }
    }

    // Vienmēr censties ielādēt pilnos datus — ping ir tikai agrīns signāls,
    // savukārt loadInitialData iekšpusmē atkārto pieprasījumus.
    showLoading('Ielādēju datus no Google...');
    let syncResult = null;
    let loadError = null;
    try {
      syncResult = await this.sync.loadInitialData((msg) => {
        showLoading(msg);
      });
      if (syncResult && syncResult.offline) {
        loadError = syncResult.error || remoteError || 'Nav savienojuma';
        if (statusMsg) {
          statusMsg.textContent = '⚠️ ' + loadError;
          statusMsg.style.color = '#e74c3c';
        }
        document.body.classList.remove('online');
      } else {
        hasRemote = true;
        if (statusMsg) {
          statusMsg.textContent = '✓ Savienojums ar Google aktīvs • ' + syncResult.count.darbinieki + ' darbinieki';
          statusMsg.style.color = '#27ae60';
        }
        document.body.classList.add('online');
      }
    } catch (e) {
      loadError = e;
      if (statusMsg) {
        statusMsg.textContent = '⚠️ Neizdevās ielādēt no Google Sheets';
        statusMsg.style.color = '#e74c3c';
      }
      console.error('[login] initial load failed', e);
    }

    hideLoading();

    const loadedEmployees = syncResult && syncResult.count ? syncResult.count.darbinieki : 0;

    // Pārliecinošs savienojuma pierādījums — to izmanto enterSetupMode(),
    // lai netaisītu setup veidlapu, ja serveris nav sasniedzams.
    this._serverReachable = hasRemote;

    // Pārbaudīt vietējos datus NO JAUNA — pēc neveiksmīga ielādes tie var būt
    // atlicināti (pirms "Atjaunot" nospiešanas tie tika notīrīti).
    if (!hasRemote) {
      try {
        hasLocal = await this.sync.hasLocalData();
      } catch (e) {
        console.error('[login] local re-check failed', e);
      }
    }

    // Only enter setup mode if BOTH the quick check AND the full load failed
    // to find any data (remote or local).
    // Bez savienojuma UN bez vietējiem datiem nevar neko ielādēt.
    // Setup ekrānu šeit RĀDĀT NEDRĪKST — administrators, kas izveidots
    // bezsaistē, paliktu tikai šajā ierīcē un nevis Google Sheets.
    if (!hasRemote && !hasLocal && !loadedEmployees) {
      await this.enterNoConnectionMode(loadError);
      return;
    }

    if (!hasRemote) {
      // Reģistrēšana NAV jābloķē — ierīcē jau ir dati, strādājam bezsaistē.
      await this.enterOfflineMode(loadError);
      return;
    }

    this.clearOfflineMode();
    await this.loadEmployees();

    // Setup režīms tikai tad, kad esam tieši sazinājušies ar serveri un
    // serveris patiešām neko neatgriež.
    if (this.employees.length === 0) {
      this.enterSetupMode();
      return;
    }
  }

  // Nav savienojuma un nav ko rādīt. Rāda skaidru iemeslu un mēģinājuma
  // pogu, nevis neuzskaitītu setup veidlapu.
  async enterNoConnectionMode(error) {
    document.body.classList.remove('online');
    this.setupMode = false;

    const loginSection = document.getElementById('loginSection');
    const setupSection = document.getElementById('setupSection');
    if (loginSection) loginSection.style.display = 'block';
    if (setupSection) setupSection.style.display = 'none';

    const list = document.getElementById('employeeList');
    if (list) {
      list.innerHTML = '<div class="no-results" style="color:#e74c3c;text-align:center;padding:20px;">' +
        '🔴 Nevar ielādēt darbiniekus — Google Sheets nav sasniedzams un šai ierīcei vēl nav saglabātu datu.</div>';
    }
    ['pinInput', 'loginBtn', 'employeeSearch'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });

    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg) {
      statusMsg.textContent = '⚠️ Nevar ielādēt datus no Google Sheets' +
        (error ? ' (' + (error.message || error) + ')' : '') + '.';
      statusMsg.style.color = '#e74c3c';
    }

    this.showRetryButton(error);
    this.runConnectionDiagnostics();
  }

  // Diagnostika: pārbauda, vai vispār var sasniegt Google serveri, lai
  // lietotājs (vai atbalsts) varētu nokopēt precīzu iemeslu.
  async runConnectionDiagnostics() {
    const old = document.getElementById('connDiagBox');
    if (old) old.remove();

    const wrap = document.createElement('div');
    wrap.id = 'connDiagBox';
    wrap.style.cssText = 'margin-top:14px;padding:12px;border-radius:8px;background:#f8f9fa;' +
      'border:1px solid #dee2e6;font-size:12px;color:#495057;text-align:left;word-break:break-word;';

    const url = (typeof CONFIG !== 'undefined' && CONFIG.GAS_URL) || 'nav iestatīts';
    const host = (() => { try { return new URL(url).host; } catch (e) { return 'nepareizs URL'; } })();
    const lines = ['Serveris: ' + host];

    wrap.innerHTML = '<b>Pārbaudu...</b>';
    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg && statusMsg.parentNode) statusMsg.parentNode.appendChild(wrap);
    const render = () => {
      wrap.innerHTML = '<b>Savienojuma diagnostika</b><br>' + lines.join('<br>');
    };
    render();

    // Katrai pārbaudei ir CIETS timeout — kastīte vienmēr pabeidzies,
    // pat ja tīkla nav. Agrākā versija atkārtoja caur visiem mēģinājumiem,
    // tāpēc kastīte palika tukša gandrīz 5 minūtes.
    const probe = async (label, probeUrl) => {
      const t0 = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(probeUrl, { mode: 'cors', cache: 'no-store', credentials: 'omit', signal: controller.signal });
        return label + ': HTTP ' + res.status + ' (' + (Date.now() - t0) + ' ms)';
      } catch (e) {
        if (e && e.name === 'AbortError') return label + ': nav atbildes 6s laikā';
        return label + ': NEIZDEVĀS (' + (Date.now() - t0) + ' ms) — ' + (e && e.message ? e.message : e);
      } finally {
        clearTimeout(timer);
      }
    };

    // navigator.onLine norāda tikai tīkla interfeisu un bieži guļ pat bez
    // interneta, tāpēc to neuzskatām par atbildi — pārbaudām faktiski.
    lines.push(await probe('Kontroles vietne', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/package.json'));
    render();

    lines.push(await probe('Google serveris', url + '?action=ping&_t=' + Date.now()));
    render();

    const reachable = lines.some(l => /HTTP 2/.test(l));
    if (!reachable) lines.push('Secinājums: nav interneta vai serveri nevar sasniegt.');
    else if (lines.some(l => /Google serveris: NEIZDEVĀS|Google serveris: nav atbildes/.test(l))) {
      lines.push('Secinājums: internets ir, bet Google serveris nav pieejams.');
    }
    render();
  }

  // Bezsaistes režīms: serveris nepieejams, bet vietējie dati ir.
  // Darbinieku saraksts un PIN ievade paliek iespējami, jo dati var būt
  // nedaudā novecojuši, bet tie noteikti ir pilnīgāki nekā nekas.
  async enterOfflineMode(error) {
    document.body.classList.remove('online');
    await this.loadEmployees();

    const total = this.employees.length;
    const lastSync = await this.sync.getLastSyncTime();
    let when = 'šai ierīcei';
    if (lastSync) {
      try {
        const d = new Date(lastSync);
        when = d.toLocaleDateString('lv-LV') + ' ' +
               String(d.getHours()).padStart(2, '0') + ':' +
               String(d.getMinutes()).padStart(2, '0');
      } catch (e) {
        when = new Date(lastSync).toISOString().slice(0, 16).replace('T', ' ');
      }
    }

    const statusMsg = document.getElementById('statusMessage');
    const reason = error ? (' (' + (error.message || error) + ')') : '';
    if (statusMsg) {
      statusMsg.textContent = total > 0
        ? '⚠️ Bez savienojuma ar Google Sheets' + reason + ' — darbi pēdējoreiz atjaunināti ' + when +
          '. Darbi tiks saglabāti un nosūtīti, kad savienojums atgriezīsies.'
        : '⚠️ Nav savienojuma ar Google Sheets' + reason + '. Pārbaudi interneta savienojumu un mēģini vēlreiz.';
      statusMsg.style.color = '#f39c12';
    }

    if (total === 0) {
      const list = document.getElementById('employeeList');
      if (list) {
        list.innerHTML = '<div class="no-results" style="color:#e74c3c;text-align:center;padding:20px;">' +
          '🔴 Nevar ielādēt darbiniekus — nav savienojuma ar serveri un šai ierīcei vēl nav saglabātu datu.</div>';
      }
    }

    this.showRetryButton(error);
  }

  // Poga "Mēģināt vēlreiz" — atkārto ielādi bez pilnas lapas pārlādēšanas
  showRetryButton(error) {
    const statusMsg = document.getElementById('statusMessage');
    if (!statusMsg || !statusMsg.parentNode) return;
    if (document.getElementById('retrySyncBtn')) return;

    const wrap = document.createElement('div');
    wrap.id = 'retrySyncWrap';
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:12px;';

    const btn = document.createElement('button');
    btn.id = 'retrySyncBtn';
    btn.textContent = '🔄 Mēģināt vēlreiz';
    btn.style.cssText = 'background:#2196F3;color:#fff;border:none;padding:12px 28px;border-radius:8px;' +
      'font-size:16px;font-weight:600;cursor:pointer;width:100%;max-width:280px;';
    btn.addEventListener('click', () => this.retryInitialLoad());

    const detail = document.createElement('div');
    detail.textContent = error ? ('Kļūda: ' + (error.message || error)) : '';
    detail.style.cssText = 'font-size:12px;color:#7f8c8d;word-break:break-word;text-align:center;';

    wrap.appendChild(btn);
    wrap.appendChild(detail);
    statusMsg.parentNode.insertBefore(wrap, statusMsg.nextSibling);
  }

  async retryInitialLoad() {
    const btn = document.getElementById('retrySyncBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Pārbaudu...';
    }
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    if (loadingText) loadingText.textContent = 'Pārbaudu savienojumu ar Google...';

    let result = null;
    try {
      result = await this.sync.loadInitialData((msg) => {
        if (loadingText) loadingText.textContent = msg;
      });
    } catch (e) {
      console.warn('[login] retry failed', e);
    }

    if (loadingOverlay) loadingOverlay.style.display = 'none';

    if (result && !result.offline) {
      const wrap = document.getElementById('retrySyncWrap');
      if (wrap) wrap.remove();
      const diag = document.getElementById('connDiagBox');
      if (diag) diag.remove();
      document.body.classList.add('online');
      await this.loadEmployees();
      const statusMsg = document.getElementById('statusMessage');
      if (statusMsg) {
        statusMsg.textContent = '✓ Savienojums ar Google atjaunots • ' + this.employees.length + ' darbinieki';
        statusMsg.style.color = '#27ae60';
      }
      this.sync.processQueue().catch(() => {});
      return;
    }

    const errMsg = (result && result.error) || 'Nav savienojuma';
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Mēģināt vēlreiz';
    }
    const detail = document.querySelector('#retrySyncWrap div:last-child');
    if (detail) detail.textContent = 'Kļūda: ' + errMsg;
    // Vēlreiz pārbauda, vai serveris vispār atbild
    this.runConnectionDiagnostics();
  }

  clearOfflineMode() {
    ['retrySyncWrap', 'connDiagBox'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  enterSetupMode() {
    // Setup veidlapu rādam TIKAI tad, ja esam pārliecinoši sazinājušies ar
    // serveri. navigator.onTime nevar balstīties — tas daudzās ierīcēs ir
    // neprecīzs un var būt false, pat ja serveris ir sasniedzams.
    if (!this._serverReachable) {
      this.enterNoConnectionMode(new Error('nav savienojuma'));
      return;
    }
    this.setupMode = true;
    const loginSection = document.getElementById('loginSection');
    const setupSection = document.getElementById('setupSection');
    const statusMsg = document.getElementById('statusMessage');
    if (loginSection) loginSection.style.display = 'none';
    if (setupSection) setupSection.style.display = 'block';
    if (statusMsg) statusMsg.textContent = 'Nav darbinieku. Izveido pirmo administratoru.';
  }

  async exitSetupMode() {
    this.setupMode = false;
    const loginSection = document.getElementById('loginSection');
    const setupSection = document.getElementById('setupSection');
    if (loginSection) loginSection.style.display = 'block';
    if (setupSection) setupSection.style.display = 'none';
    try {
      await this.sync.loadInitialData();
    } catch (e) {
      console.warn('[login] initial load failed', e);
    }
    await this.loadEmployees();
  }

  async createLocalEmployee(data) {
    const id = this.db.generateId();
    const employee = {
      id,
      vards: data.vards,
      uzvards: data.uzvards,
      loma: data.loma || 'administrators',
      pin: data.pin,
      aktivs: true
    };
    await this.db.add('darbinieki', employee);
    return id;
  }

  setupUI() {
    const form = document.getElementById('loginForm');
    const pinInput = document.getElementById('pinInput');
    const loginBtn = document.getElementById('loginBtn');
    const errorMsg = document.getElementById('errorMessage');
    const statusMsg = document.getElementById('statusMessage');
    const employeeSearch = document.getElementById('employeeSearch');
    const clearBtn = document.getElementById('clearSelection');

    const maxLength = 6;

    if (pinInput) {
      pinInput.addEventListener('input', (e) => {
        const raw = e.target.value.replace(/\D/g, '');
        let newPin = this.pin + raw;
        if (newPin.length > maxLength) {
          newPin = newPin.substring(0, maxLength);
        }
        this.pin = newPin;
        e.target.value = '•'.repeat(this.pin.length);
        this.refreshLoginButton();
        errorMsg.style.display = 'none';
      });

      pinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
          e.preventDefault();
          this.pin = this.pin.substring(0, this.pin.length - 1);
          e.target.value = '•'.repeat(this.pin.length);
          this.refreshLoginButton();
          errorMsg.style.display = 'none';
        }
      });
    }

    if (employeeSearch) {
      employeeSearch.addEventListener('input', (e) => {
        this.filterEmployees(e.target.value.trim().toLowerCase());
        this.renderEmployeeList();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearSelection();
      });
    }

    const roleFilter = document.getElementById('roleFilter');
    if (roleFilter) {
      roleFilter.addEventListener('click', (e) => {
        const btn = e.target.closest('.role-btn');
        if (!btn) return;
        document.querySelectorAll('#roleFilter .role-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filterByRole(btn.dataset.role);
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!this.selectedEmployee) {
          errorMsg.textContent = 'Izvēlies darbinieku no saraksta';
          errorMsg.style.display = 'block';
          return;
        }
        if (this.pin.length < 4) {
          errorMsg.textContent = 'PIN kodā jābūt vismaz 4 cipariem';
          errorMsg.style.display = 'block';
          return;
        }
        loginBtn.disabled = true;
        statusMsg.textContent = 'Pārbaudējam...';

        await this.authenticate(this.selectedEmployee, this.pin);
      });
    }

    if (pinInput) {
      pinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && this.pin.length >= 4 && this.selectedEmployee) {
          e.preventDefault();
          form.dispatchEvent(new Event('submit'));
        }
      });
    }

    const setupForm = document.getElementById('setupForm');
    if (setupForm) {
      setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
          vards: formData.get('vards'),
          uzvards: formData.get('uzvards'),
          pin: formData.get('pin'),
          loma: 'administrators'
        };
        const setupStatus = document.getElementById('setupStatus');
        if (setupStatus) {
          setupStatus.textContent = 'Izveidoju administratoru...';
          setupStatus.style.display = 'block';
        }
        try {
          await this.sync.createEmployee(data);
          if (setupStatus) {
            setupStatus.textContent = '✓ Administrators izveidots! Ielādēju...';
            setupStatus.style.color = '#27ae60';
          }
          await this.exitSetupMode();
          if (statusMsg) {
            statusMsg.textContent = '✓ Administrators izveidots';
            statusMsg.style.color = '#27ae60';
          }
        } catch (err) {
          const localId = await this.createLocalEmployee(data);
          if (localId) {
            if (setupStatus) {
              setupStatus.textContent = '✓ Administrators izveidots lokāli (bez interneta). Dati tiks sinhronizēti, kad būs savienojums.';
              setupStatus.style.color = '#f39c12';
            }
            await this.exitSetupMode();
            if (statusMsg) {
              statusMsg.textContent = '✓ Administrators izveidots lokāli';
              statusMsg.style.color = '#f39c12';
            }
          } else {
            if (setupStatus) {
              setupStatus.textContent = 'Kļūda: ' + err.message;
              setupStatus.style.color = '#e74c3c';
            }
          }
        }
      });
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

  async loadEmployees() {
    const raw = await this.db.getAll('darbinieki');
    const active = raw.filter(e => {
      const a = e.aktivs;
      return a === true || a === 'true' || a === 'TRUE' || a === 1 || a === '1' || a === undefined;
    });

    // Load tasks to determine which employee ID has tasks assigned
    // When duplicate employee entries exist (same name, different ID),
    // prefer the ID that actually has tasks assigned to it
    let taskCounts = new Map();
    try {
      const allTasks = await this.db.getAll('uzdevomi');
      allTasks.forEach(t => {
        const empId = String(t.pieskirtDarbiniekamId || t.employeeId || '');
        if (empId) taskCounts.set(empId, (taskCounts.get(empId) || 0) + 1);
      });
    } catch (e) {
      console.warn('[login] Failed to load tasks for employee matching:', e);
    }

    // Gruppē pa vārdu/uzvārdu — viena persona var būt ar vairākām lomām
    const grouped = new Map();
    for (const e of active) {
      const empId = String(e.id || e.ID || '');
      const key = ((e.vards || e.Vārds || '') + '|' + (e.uzvards || e.Uzvārds || '')).toLowerCase().trim();
      const taskCount = taskCounts.get(empId) || 0;
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: empId,
          vards: e.vards || e.Vārds,
          uzvards: e.uzvards || e.Uzvārds,
          lomas: [],
          pins: new Set(),
          mainaTips: e.maina_tips || e.mainaTips || 'diennakts',
          allIds: [empId],
          taskCount: taskCount
        });
      } else {
        // Duplicate employee (same name, different ID) — prefer the one with tasks
        const g = grouped.get(key);
        g.allIds.push(empId);
        if (taskCount > g.taskCount) {
          console.log('[login] Duplicate darbinieks "' + key + '" — pārslēdzu ID no', g.id, 'uz', empId, '(' + taskCount + ' uzdevumi)');
          g.id = empId;
          g.taskCount = taskCount;
        } else if (taskCount === 0 && g.taskCount === 0 && empId > g.id) {
          // Neither has tasks — prefer the most recent (lexicographically larger timestamp)
          g.id = empId;
        }
      }
      const g = grouped.get(key);
      // Normalize role to remove diacritics (GAS may return 'aprupetajs' instead of 'aprūpētājs')
      const role = (e.loma || e.Loma || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const roleCanonical = { 'aprupetajs': 'aprūpētājs', 'kontroliere': 'kontroliere', 'administrators': 'administrators' }[role] || role;
      if (roleCanonical && !g.lomas.includes(roleCanonical)) g.lomas.push(roleCanonical);
      if (e.pin) g.pins.add(String(e.pin));
    }

    if (grouped.size > active.length) {
      console.warn('[login] Konstatēti duplikāti darbinieki (' + (active.length - grouped.size) + ' ieraksti grupēti vienā)');
    }

    this.employees = Array.from(grouped.values()).sort((a, b) => {
      const aN = (a.uzvards + ' ' + a.vards).toLowerCase();
      const bN = (b.uzvards + ' ' + b.vards).toLowerCase();
      return aN.localeCompare(bN);
    });

    this.filteredEmployees = [...this.employees];
    this.renderEmployeeList();
    const total = this.employees.length;
    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg && total > 0) {
      const existing = statusMsg.textContent;
      if (existing && !existing.includes('darbinieki')) {
        statusMsg.textContent = existing + ' • ' + total + ' darbinieki';
      }
    }
  }

  filterEmployees(term) {
    this.applyFilters(term || '');
  }

  applyFilters(searchTerm) {
    console.log('[login] applyFilters: searchTerm="' + searchTerm + '" activeRoleFilter="' + this.activeRoleFilter + '" totalEmployees=' + this.employees.length);
    const role = this.activeRoleFilter || 'all';
    let result = this.employees;
    if (role !== 'all') {
      result = result.filter(e => {
        const roles = e.lomas || [];
        return roles.some(r => {
          const l = r.toLowerCase();
          return l === role || l === (CONFIG.ROLES[role] || role);
        });
      });
    }
    if (searchTerm) {
      const term = this._normalizeForSearch(searchTerm.trim());
      console.log('[login] applyFilters: normalized term="' + term + '" roleFilter="' + role + '" filteredByRole=' + result.length);
      if (term) {
        const words = term.split(/\s+/).filter(w => w.length > 0);
        result = result.filter(e => {
          const v = this._normalizeForSearch(e.vards || '');
          const u = this._normalizeForSearch(e.uzvards || '');
          const fullName = (v + ' ' + u).trim();
          const roles = e.lomas || [];
          const roleMatch = roles.some(r => this._normalizeForSearch(r).includes(term));

          let matches = false;
          if (words.length === 1) {
            // Single word: match anywhere
            matches = v.includes(term) || u.includes(term) || v.startsWith(term) || u.startsWith(term) || roleMatch;
          } else {
            // Multi-word: ALL words must match somewhere in the full name
            matches = words.every(w => fullName.includes(w)) || roleMatch;
          }

          if (matches) console.log('[login] applyFilters: MATCH ' + (e.vards || '') + ' ' + (e.uzvards || '') + ' id=' + e.id);
          return matches;
        });
      }
    }
    console.log('[login] applyFilters: final result=' + result.length + ' matches');
    this.filteredEmployees = [...result];
  }

  // Nozīmē diakritiskos zīmes, lai meklēšana darbotos arī bez diakritikas
  // (piem., "Janis" atrada "Jānis", "Berzin" atrada "Bērziņš")
  _normalizeForSearch(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  filterByRole(role) {
    this.activeRoleFilter = role;
    const searchTerm = document.getElementById('employeeSearch')?.value || '';
    this.applyFilters(searchTerm);
    this.renderEmployeeList();
  }

  renderEmployeeList() {
    const list = document.getElementById('employeeList');
    if (!list) return;
    if (this.filteredEmployees.length === 0) {
      list.innerHTML = '<div class="no-results" data-i18n="noEmployees">Nav darbinieku, kas atbilst meklēšanai</div>';
      return;
    }
    const roleLabel = (l) => {
      const m = { 'administrators': 'Admin', 'kontroliere': 'Kontrole', 'aprūpētājs': 'Aprūpe' };
      return m[(l || '').toLowerCase()] || l;
    };
    const initials = (e) => {
      const v = (e.vards || '').trim();
      const u = (e.uzvards || '').trim();
      return ((v[0] || '?') + (u[0] || '')).toUpperCase();
    };
    const roleColor = (l) => {
      const r = (l || '').toLowerCase();
      if (r === 'administrators' || r === 'admins' || r === 'admin') return 'var(--danger)';
      if (r === 'kontroliere' || r === 'kontrolieris' || r === 'controller') return 'var(--primary-light)';
      return 'var(--accent)';
    };
    
    list.innerHTML = this.filteredEmployees.map(e => {
      const id = e.id;
      const v = e.vards || '';
      const u = e.uzvards || '';
      const roles = e.lomas || [];
      const sel = this.selectedEmployee && String(this.selectedEmployee.id) === String(id) ? 'selected' : '';
      const roleBadges = roles.map(r => `<span class="role-badge" style="background:${roleColor(r)}20;color:${roleColor(r)};border-color:${roleColor(r)}">${roleLabel(r)}</span>`).join('');
      return `
        <div class="employee-card ${sel}" data-id="${id}">
          <div class="emp-avatar" style="background:${roleColor(roles[0])};color:#fff">${initials(e)}</div>
          <div class="emp-info">
            <div class="emp-name">${this.escapeHtml(v)} ${this.escapeHtml(u)}</div>
            <div class="emp-roles">${roleBadges}</div>
          </div>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.employee-card').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const emp = this.employees.find(x => String(x.id) === String(id));
        if (emp) this.selectEmployee(emp);
      });
    });
  }

  selectEmployee(emp) {
    this.selectedEmployee = emp;
    this.pin = '';
    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
      pinInput.value = '';
      pinInput.disabled = false;
      pinInput.placeholder = 'Ievadi PIN kodu';
    }
    const sel = document.getElementById('selectedEmployee');
    const avatar = document.getElementById('selectedAvatar');
    const name = document.getElementById('selectedName');
    const role = document.getElementById('selectedRole');
    const shiftSelector = document.getElementById('shiftTypeSelector');
    if (sel) sel.style.display = 'flex';
    if (avatar) avatar.textContent = ((emp.vards || '?')[0] || '?') + ((emp.uzvards || '')[0] || '');
    if (name) name.textContent = (emp.vards || '') + ' ' + (emp.uzvards || '');
    const roleLabel = (l) => {
      const m = { 'administrators': '👑 Admin', 'kontroliere': '📊 Kontrole', 'aprūpētājs': '🤝 Aprūpe' };
      return m[(l || '').toLowerCase()] || l;
    };
    const roleColor = (l) => {
      const r = (l || '').toLowerCase();
      if (r === 'administrators' || r === 'admins' || r === 'admin') return 'var(--danger)';
      if (r === 'kontroliere' || r === 'kontrolieris' || r === 'controller') return 'var(--primary-light)';
      return 'var(--accent)';
    };
    const roles = emp.lomas || [];
    if (role) {
      if (roles.length === 1) {
        role.textContent = roleLabel(roles[0]);
        role.style.color = roleColor(roles[0]);
        role.innerHTML = '';
      } else {
        role.innerHTML = roles.map(r => `<span class="role-badge" style="background:${roleColor(r)}20;color:${roleColor(r)};border:1px solid ${roleColor(r)}">${roleLabel(r)}</span>`).join(' ');
      }
    }
    if (shiftSelector) shiftSelector.style.display = 'block';
    const sub = document.getElementById('loginSubtitle');
    if (sub) sub.textContent = 'Izvēlies maiņas tipu un ievadi PIN kodu:';
    const search = document.getElementById('employeeSearch');
    if (search) {
      search.value = '';
      this.applyFilters('');
      this.renderEmployeeList();
    }
    this.refreshLoginButton();

    // Ja VIENS loma → uzreiz fokus uz PIN (scroll to bottom)
    // Ja VAIRĀKAS lomas → rādīt role selector iekš kartiņas UN scroll uz to
    if (roles.length === 1) {
      this.focusPinInput();
    } else if (roles.length > 1) {
      this.showRoleSelector(emp);
      // Scroll uz selected employee kartiņu, lai lietotājs redzētu role selector
      const selectedEl = document.getElementById('selectedEmployee');
      if (selectedEl) {
        setTimeout(() => {
          selectedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    }
  }

  focusPinInput() {
    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
      pinInput.disabled = false;
      setTimeout(() => {
        pinInput.focus();
        pinInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.disabled = false;
  }

showRoleSelector(emp) {
    console.log('[login] showRoleSelector called for', emp.vards, emp.uzvards, 'roles:', emp.lomas);
    const roles = emp.lomas || [];
    const roleLabel = (l) => {
      const m = { 'administrators': 'Administrators', 'kontroliere': 'Kontrolieris', 'aprūpētājs': 'Aprūpētājs' };
      return m[(l || '').toLowerCase()] || l;
    };
    const roleColor = (l) => {
      const r = (l || '').toLowerCase();
      if (r === 'administrators' || r === 'admins' || r === 'admin') return 'var(--danger)';
      if (r === 'kontroliere' || r === 'kontrolieris' || r === 'controller') return 'var(--primary-light)';
      return 'var(--accent)';
    };
    const roleColorAlpha = (l) => {
      const r = (l || '').toLowerCase();
      if (r === 'administrators' || r === 'admins' || r === 'admin') return 'rgba(231,76,60,0.25)';
      if (r === 'kontroliere' || r === 'kontrolieris' || r === 'controller') return 'rgba(52,152,219,0.25)';
      return 'rgba(39,174,96,0.25)';
    };
    const pinInput = document.getElementById('pinInput');
    const loginBtn = document.getElementById('loginBtn');
    if (pinInput) pinInput.disabled = true;
    if (loginBtn) loginBtn.disabled = true;

    const preSelected = emp.chosenRole || roles[0];

    // Rādīt role selector IEKŠ selected employee kartiņas
    const selectedEl = document.getElementById('selectedEmployee');
    const roleEl = document.getElementById('selectedRole');
    if (!selectedEl || !roleEl) return;

    // Saglabājam originalo saturu
    this._originalRoleContent = roleEl.innerHTML;

    // Izveidojam radio pogas IEKŠ kartiņas
    roleEl.innerHTML = `
      <div class="inline-role-selector">
        <p class="inline-role-prompt">Izvēlies lomu:</p>
        <div class="inline-role-options">
          ${roles.map(r => `
            <label class="inline-role-option" style="--role-color:${roleColor(r)};--role-color-alpha:${roleColorAlpha(r)}">
              <input type="radio" name="inlineRoleChoice" value="${r}" ${r === preSelected ? 'checked' : ''}>
              <span class="inline-role-radio"></span>
              <span class="inline-role-label">${roleLabel(r)}</span>
            </label>
          `).join('')}
        </div>
        <div class="inline-role-actions">
          <button id="inlineRoleConfirm" class="inline-role-confirm" disabled>✓ Apstiprināt un ievadīt PIN</button>
          <button id="inlineRoleCancel" class="inline-role-cancel">Atcelt</button>
        </div>
      </div>
    `;

    const radioInputs = roleEl.querySelectorAll('input[name="inlineRoleChoice"]');
    const confirmBtn = roleEl.querySelector('#inlineRoleConfirm');
    const cancelBtn = roleEl.querySelector('#inlineRoleCancel');

    const updateConfirm = () => {
      const checked = roleEl.querySelector('input[name="inlineRoleChoice"]:checked');
      confirmBtn.disabled = !checked;
    };

    radioInputs.forEach(input => {
      input.addEventListener('change', updateConfirm);
      input.parentElement.addEventListener('click', (e) => {
        if (e.target !== input) input.checked = true;
        updateConfirm();
      });
    });

    confirmBtn.addEventListener('click', () => {
      console.log('[login] confirmBtn clicked');
      const checked = roleEl.querySelector('input[name="inlineRoleChoice"]:checked');
      if (!checked) return;
      console.log('[login] inline role confirmed:', checked.value);
      this.selectedEmployee.chosenRole = checked.value;
      roleEl.innerHTML = `<span class="role-badge" style="background:${roleColor(checked.value)}20;color:${roleColor(checked.value)};border:1px solid ${roleColor(checked.value)}">${roleLabel(checked.value)}</span>`;
      const pinInput = document.getElementById('pinInput');
      const loginBtn = document.getElementById('loginBtn');
      console.log('[login] pinInput found:', !!pinInput, pinInput);
      if (pinInput) {
        pinInput.disabled = false;
        setTimeout(() => {
          console.log('[login] focusing and scrolling to pinInput');
          pinInput.focus();
          pinInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.scrollTo({ top: pinInput.offsetTop - 80, behavior: 'smooth' });
        }, 50);
      }
      if (loginBtn) loginBtn.disabled = false;
    });

    cancelBtn.addEventListener('click', () => {
      console.log('[login] cancelBtn clicked');
      roleEl.innerHTML = this._originalRoleContent || '';
      const pinInput = document.getElementById('pinInput');
      const loginBtn = document.getElementById('loginBtn');
      if (pinInput) pinInput.disabled = true;
      if (loginBtn) loginBtn.disabled = true;
      this.clearSelection();
    });
  }

  clearSelection() {
    this.selectedEmployee = null;
    this.pin = '';
    this.activeRoleFilter = 'all';
    const roleBtns = document.querySelectorAll('#roleFilter .role-btn');
    if (roleBtns.length) {
      roleBtns.forEach(b => b.classList.remove('active'));
      const allBtn = document.querySelector('#roleFilter .role-btn[data-role="all"]');
      if (allBtn) allBtn.classList.add('active');
    }
    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
      pinInput.value = '';
      pinInput.disabled = true;
    }
    const sel = document.getElementById('selectedEmployee');
    if (sel) sel.style.display = 'none';
    const shiftSelector = document.getElementById('shiftTypeSelector');
    if (shiftSelector) shiftSelector.style.display = 'none';
    const sub = document.getElementById('loginSubtitle');
    if (sub) sub.textContent = 'Izvēlies darbinieku un ievadi PIN kodu';
    this.applyFilters('');
    this.renderEmployeeList();
    this.refreshLoginButton();
  }

  refreshLoginButton() {
    const btn = document.getElementById('loginBtn');
    if (!btn) return;
    btn.disabled = !(this.selectedEmployee && this.pin.length >= 4);
  }

  async authenticate(employee, pin) {
    const errorMsg = document.getElementById('errorMessage');
    const statusMsg = document.getElementById('statusMessage');
    const pinInput = document.getElementById('pinInput');

    const pins = employee.pins || new Set([String(employee.pin)]);
    let pinMatch = false;
    for (const p of pins) {
      if (String(p) === String(pin)) { pinMatch = true; break; }
    }
    if (!pinMatch) {
      errorMsg.textContent = 'Nepareizs PIN kods';
      errorMsg.style.display = 'block';
      statusMsg.textContent = '';
      this.pin = '';
      if (pinInput) {
        pinInput.value = '';
        setTimeout(() => pinInput.focus(), 50);
      }
      this.refreshLoginButton();
      return;
    }

    const shiftTypeInput = document.querySelector('input[name="shiftType"]:checked');
    const mainaTips = shiftTypeInput ? shiftTypeInput.value : 'diennakts';

    // Ja izvēlējās lomu — izmantot to, citāk pirmo
    const chosenRole = employee.chosenRole || (employee.lomas || [])[0];

    const user = {
      id: employee.id,
      vards: employee.vards,
      uzvards: employee.uzvards,
      loma: chosenRole,
      visulasLomas: employee.lomas || [],
      pin: pin,
      pinVerified: true,
      loginTime: Date.now(),
      mainaTips: mainaTips
    };

    sessionStorage.setItem('careUser', JSON.stringify(user));
    this.user = user;
    this.showSuccess(user);
  }

  showSuccess(user) {
    const card = document.querySelector('.login-card');
    if (!card) {
      this.redirectByRole(user.loma);
      return;
    }
    const roleLbl = { 'administrators': 'administrator', 'kontroliere': 'kontrolier', 'aprūpētājs': 'aprūpētāj' };
    const role = roleLbl[(user.loma || '').toLowerCase()] || user.loma;
    const fname = user.vards || '';
    const compliments = [
      'Paldies par darbu! 🌟',
      'Tu esi fantastisks! 💪',
      'Labi, ka esi šeit! 🤝',
      'Veiksmīgu dienu! ☀️',
      'Tu esi super! ✨',
      'Paldies, ka rūpējies! 💙',
      'Tu esi lielisks komandas loceklis! 👏',
      'Lai izdodas! 🌻',
      'Komanda ir spēcīga, pateicoties Tev! 🙌',
      'Cieņā un pateicībā! 🙏'
    ];
    const greeting = compliments[Math.floor(Math.random() * compliments.length)];
    card.innerHTML = `
      <img src="logo/logoDS.png" alt="Aprūpes sistēma" class="login-logo">
      <div style="font-size:64px;line-height:1;margin:6px 0;">🎉</div>
      <h1 style="color:#27ae60;margin-bottom:6px;">Laipni lūdzam, ${this.escapeHtml(fname)}!</h1>
      <p style="font-size:16px;color:#2c3e50;font-weight:600;margin-bottom:14px;">${role}</p>
      <div style="background:linear-gradient(135deg,#e8f5e9 0%,#c8e6c9 100%);padding:18px;border-radius:14px;margin-top:10px;border-left:4px solid #27ae60;">
        <div style="font-size:17px;color:#1b5e20;font-weight:600;line-height:1.4;">${greeting}</div>
      </div>
      <div id="statusMessage" class="status-message" style="margin-top:18px;color:#1976d2;">⏳ Ielādēju sadaļu...</div>
    `;
    setTimeout(() => this.redirectByRole(user.loma), 1500);
  }

  redirectByRole(role) {
    const r = String(role || '').toLowerCase().trim();
    if (r === 'administrators' || r === 'admins' || r === 'admin') {
      window.location.href = 'admin.html';
    } else if (r === 'kontroliere' || r === 'kontrolieris' || r === 'controller') {
      window.location.href = 'control.html';
    } else {
      window.location.href = 'aprupe.html';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  hideSplash() {
    const splash = document.getElementById('splashScreen');
    if (!splash) return;
    setTimeout(() => {
      splash.classList.add('hidden');
      splash.style.pointerEvents = 'none';
      setTimeout(() => {
        splash.style.display = 'none';
      }, 600);
    }, 800);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.loginController = new LoginController();
});
