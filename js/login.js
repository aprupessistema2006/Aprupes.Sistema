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

    const statusMsg = document.getElementById('statusMessage');
    statusMsg.textContent = 'Pārbaudām savienojumu...';

    const hasRemote = await this.sync.hasRemoteEmployees();
    const hasLocal = await this.sync.hasLocalData();

    if (!hasRemote && !hasLocal) {
      this.enterSetupMode();
      return;
    }

    if (hasRemote) {
      statusMsg.textContent = 'Ielādēju datus...';
      try {
        await this.sync.loadInitialData();
        statusMsg.textContent = '✓ Savienojums aktīvs';
        document.body.classList.add('online');
      } catch (e) {
        statusMsg.textContent = '⚠️ Neizdevās ielādēt datus. Mēģinam lokāli...';
      }
    } else if (hasLocal) {
      statusMsg.textContent = '⚠️ Bezsaistē (lokāli dati)';
    }

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
    await this.sync.loadInitialData();
    await this.loadEmployees();
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

    employeeSearch.addEventListener('input', (e) => {
      this.filterEmployees(e.target.value.trim().toLowerCase());
      this.renderEmployeeList();
    });

    clearBtn.addEventListener('click', () => {
      this.clearSelection();
    });

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

    pinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.pin.length >= 4 && this.selectedEmployee) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit'));
      }
    });

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
          if (setupStatus) {
            setupStatus.textContent = 'Kļūda: ' + err.message;
            setupStatus.style.color = '#e74c3c';
          }
        }
      });
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
    if (!term) {
      this.filteredEmployees = [...this.employees];
      return;
    }
    this.filteredEmployees = this.employees.filter(e => {
      const v = (e.vards || e.Vārds || '').toLowerCase();
      const u = (e.uzvards || e.Uzvārds || '').toLowerCase();
      const l = (e.loma || e.Loma || '').toLowerCase();
      return v.includes(term) || u.includes(term) || l.includes(term);
    });
  }

  renderEmployeeList() {
    const list = document.getElementById('employeeList');
    if (!list) return;
    if (this.filteredEmployees.length === 0) {
      list.innerHTML = '<div class="loading">Nav darbinieku, kas atbilst meklēšanai</div>';
      return;
    }
    const roleLabel = (l) => {
      const m = { 'administrators': '👑 administrators', 'kontroliere': '📊 kontroliere', 'aprūpētājs': '🤝 aprūpētājs' };
      return m[(l || '').toLowerCase()] || ('👤 ' + l);
    };
    const initials = (e) => {
      const v = (e.vards || e.Vārds || '').trim();
      const u = (e.uzvards || e.Uzvārds || '').trim();
      return ((v[0] || '?') + (u[0] || '')).toUpperCase();
    };
    list.innerHTML = this.filteredEmployees.map(e => {
      const id = e.id || e.ID;
      const v = e.vards || e.Vārds || '';
      const u = e.uzvards || e.Uzvārds || '';
      const l = e.loma || e.Loma || '';
      const sel = this.selectedEmployee && String(this.selectedEmployee.id || this.selectedEmployee.ID) === String(id) ? 'selected' : '';
      return `
        <div class="employee-item ${sel}" data-id="${id}">
          <div class="emp-avatar">${initials(e)}</div>
          <div class="emp-meta">
            <div class="emp-name">${this.escapeHtml(v)} ${this.escapeHtml(u)}</div>
            <div class="emp-role">${roleLabel(l)}</div>
          </div>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.employee-item').forEach(el => {
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
    if (sel) sel.style.display = 'flex';
    if (avatar) avatar.textContent = ((emp.vards || emp.Vārds || '?')[0] || '?') + ((emp.uzvards || emp.Uzvārds || '')[0] || '');
    if (name) name.textContent = (emp.vards || emp.Vārds || '') + ' ' + (emp.uzvards || emp.Uzvārds || '');
    const roleLbl = { 'administrators': '👑 administrators', 'kontroliere': '📊 kontroliere', 'aprūpētājs': '🤝 aprūpētājs' };
    if (role) role.textContent = roleLbl[(emp.loma || emp.Loma || '').toLowerCase()] || emp.loma;
    const sub = document.getElementById('loginSubtitle');
    if (sub) sub.textContent = 'Ievadiet PIN kodu darbiniekam:';
    const search = document.getElementById('employeeSearch');
    if (search) {
      search.value = '';
      this.filteredEmployees = [...this.employees];
      this.renderEmployeeList();
    }
    this.refreshLoginButton();
  }

  clearSelection() {
    this.selectedEmployee = null;
    this.pin = '';
    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
      pinInput.value = '';
      pinInput.disabled = true;
    }
    const sel = document.getElementById('selectedEmployee');
    if (sel) sel.style.display = 'none';
    const sub = document.getElementById('loginSubtitle');
    if (sub) sub.textContent = 'Izvēlies darbinieku un ievadi PIN kodu';
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

    const user = {
      id: employee.id || employee.ID,
      vards: employee.vards || employee.Vārds,
      uzvards: employee.uzvards || employee.Uzvārds,
      loma: employee.loma || employee.Loma,
      pin: pin,
      pinVerified: true,
      loginTime: Date.now()
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
}

document.addEventListener('DOMContentLoaded', () => {
  window.loginController = new LoginController();
});
