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
    this.sync = new SyncManager(this.db, CONFIG);
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

    showLoading('Mēģinām pieslēgties Google...');
    try {
      hasRemote = await this.sync.hasRemoteEmployees();
    } catch (e) {
      console.error('[login] remote check failed', e);
    }

    if (hasLocal === false) {
      try {
        hasLocal = await this.sync.hasLocalData();
      } catch (e) {
        console.error('[login] local check failed', e);
      }
    }

    if (!hasRemote && !hasLocal) {
      hideLoading();
      this.enterSetupMode();
      return;
    }

    if (hasRemote) {
      showLoading('Ielādēju datus no Google...');
      try {
        await this.sync.loadInitialData((msg) => {
          showLoading(msg);
        });
        if (statusMsg) statusMsg.textContent = '✓ Savienojums ar Google aktīvs';
        document.body.classList.add('online');
      } catch (e) {
        if (statusMsg) statusMsg.textContent = '⚠️ Neizdevās ielādēt no Google. Mēģinam lokāli...';
      }
    }

    hideLoading();
    await this.loadEmployees();
  }

  enterSetupMode() {
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
    this.employees = await this.db.getAll('darbinieki');
    this.employees = this.employees.filter(e => {
      const a = e.aktivs;
      return a === true || a === 'true' || a === 'TRUE' || a === 1 || a === '1' || a === undefined;
    });
    this.employees.sort((a, b) => {
      const aN = ((a.uzvards || a.Uzvārds || '') + ' ' + (a.vards || a.Vārds || '')).toLowerCase();
      const bN = ((b.uzvards || b.Uzvārds || '') + ' ' + (b.vards || b.Vārds || '')).toLowerCase();
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
    const role = this.activeRoleFilter || 'all';
    let result = this.employees;
    if (role !== 'all') {
      result = result.filter(e => {
        const l = (e.loma || e.Loma || '').toLowerCase();
        return l === role || l === (CONFIG.ROLES[role] || role);
      });
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(e => {
        const v = (e.vards || e.Vārds || '').toLowerCase();
        const u = (e.uzvards || e.Uzvārds || '').toLowerCase();
        const l = (e.loma || e.Loma || '').toLowerCase();
        return v.includes(term) || u.includes(term) || l.includes(term);
      });
    }
    this.filteredEmployees = [...result];
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
      const m = { 'administrators': '👑 Administrators/e', 'kontroliere': '📊 Kontrolieris/e', 'aprūpētājs': '🤝 Aprūpētājs/a' };
      return m[(l || '').toLowerCase()] || ('👤 ' + l);
    };
    const initials = (e) => {
      const v = (e.vards || e.Vārds || '').trim();
      const u = (e.uzvards || e.Uzvārds || '').trim();
      return ((v[0] || '?') + (u[0] || '')).toUpperCase();
    };
    const roleColor = (l) => {
      const r = (l || '').toLowerCase();
      if (r === 'administrators' || r === 'admins' || r === 'admin') return 'var(--danger)';
      if (r === 'kontroliere' || r === 'kontrolieris' || r === 'controller') return 'var(--primary-light)';
      return 'var(--accent)';
    };
    list.innerHTML = this.filteredEmployees.map(e => {
      const id = e.id || e.ID;
      const v = e.vards || e.Vārds || '';
      const u = e.uzvards || e.Uzvārds || '';
      const l = e.loma || e.Loma || '';
      const sel = this.selectedEmployee && String(this.selectedEmployee.id || this.selectedEmployee.ID) === String(id) ? 'selected' : '';
      return `
        <div class="employee-card ${sel}" data-id="${id}">
          <div class="emp-card-header">
            <div class="emp-avatar" style="background:${roleColor(l)}20;color:${roleColor(l)}">${initials(e)}</div>
            <div class="emp-card-title">${this.escapeHtml(v)} ${this.escapeHtml(u)}</div>
          </div>
          <div class="emp-card-role" style="color:${roleColor(l)}">${roleLabel(l)}</div>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.employee-card').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const emp = this.employees.find(x => String(x.id || x.ID) === String(id));
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
      setTimeout(() => pinInput.focus(), 50);
    }
    const sel = document.getElementById('selectedEmployee');
    const avatar = document.getElementById('selectedAvatar');
    const name = document.getElementById('selectedName');
    const role = document.getElementById('selectedRole');
    const shiftSelector = document.getElementById('shiftTypeSelector');
    if (sel) sel.style.display = 'flex';
    if (avatar) avatar.textContent = ((emp.vards || emp.Vārds || '?')[0] || '?') + ((emp.uzvards || emp.Uzvārds || '')[0] || '');
    if (name) name.textContent = (emp.vards || emp.Vārds || '') + ' ' + (emp.uzvards || emp.Uzvārds || '');
    const roleLbl = { 'administrators': '👑 Administrators/e', 'kontroliere': '📊 Kontrolieris/e', 'aprūpētājs': '🤝 Aprūpētājs/a' };
    if (role) role.textContent = roleLbl[(emp.loma || emp.Loma || '').toLowerCase()] || emp.loma;
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

    if (String(employee.pin) !== String(pin)) {
      errorMsg.textContent = 'Nepareizs PIN kods';
      errorMsg.style.display = 'block';
      statusMsg.textContent = '';
      this.pin = '';
      const pinInput = document.getElementById('pinInput');
      if (pinInput) {
        pinInput.value = '';
        setTimeout(() => pinInput.focus(), 50);
      }
      this.refreshLoginButton();
      return;
    }

    const shiftTypeInput = document.querySelector('input[name="shiftType"]:checked');
    const shiftType = shiftTypeInput ? shiftTypeInput.value : 'diennakts';

    const user = {
      id: employee.id || employee.ID,
      vards: employee.vards || employee.Vārds,
      uzvards: employee.uzvards || employee.Uzvārds,
      loma: employee.loma || employee.Loma,
      pin: pin,
      pinVerified: true,
      loginTime: Date.now(),
      shiftType: shiftType
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
