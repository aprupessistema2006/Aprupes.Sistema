class LoginController {
  constructor() {
    this.db = null;
    this.sync = null;
    this.user = null;
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
    const pinInput = document.getElementById('pinInput');
    pinInput.disabled = false;

    const hasLocal = await this.sync.hasLocalData();
    const statusMsg = document.getElementById('statusMessage');
    if (hasLocal) {
      statusMsg.textContent = 'Gatavs (lokāli dati)';
      document.body.classList.add('online');
    } else {
      statusMsg.textContent = 'Ielādēju datus...';
    }

    this.sync.loadInitialData().then(async (result) => {
      if (result.offline) {
        const hasAfter = await this.sync.hasLocalData();
        if (!hasAfter) {
          statusMsg.textContent = '⚠️ Nav interneta un nav lokālu datu.';
        } else {
          statusMsg.textContent = '⚠️ Bezsaistē (lokāli dati)';
        }
      } else {
        const total = Object.values(result.count || {}).reduce((a, b) => a + b, 0);
        const marks = result.count['atzimes'] || 0;
        const log = result.count['atzimes_log'] || 0;
        statusMsg.textContent = '✓ Gatavs (' + marks + ' atzīmes, ' + log + ' žurnāla ieraksti)';
        document.body.classList.add('online');
      }
    });

    pinInput.focus();
  }

  setupUI() {
    const form = document.getElementById('loginForm');
    const pinInput = document.getElementById('pinInput');
    const loginBtn = document.getElementById('loginBtn');
    const errorMsg = document.getElementById('errorMessage');
    const statusMsg = document.getElementById('statusMessage');

    let pin = '';
    const maxLength = 6;

    pinInput.addEventListener('input', (e) => {
      const raw = e.target.value.replace(/\D/g, '');
      let newPin = pin + raw;
      if (newPin.length > maxLength) {
        newPin = newPin.substring(0, maxLength);
      }
      pin = newPin;
      e.target.value = '•'.repeat(pin.length);

      if (pin.length >= 4) {
        loginBtn.disabled = false;
      } else {
        loginBtn.disabled = true;
      }

      errorMsg.style.display = 'none';
    });

    pinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        e.preventDefault();
        pin = pin.substring(0, pin.length - 1);
        e.target.value = '•'.repeat(pin.length);
        if (pin.length < 4) loginBtn.disabled = true;
        errorMsg.style.display = 'none';
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (pin.length < 4) {
        errorMsg.textContent = 'PIN kodā jābūt vismaz 4 cipariem';
        errorMsg.style.display = 'block';
        return;
      }
      loginBtn.disabled = true;
      statusMsg.textContent = 'Pārbaudējam...';

      await this.authenticate(pin);
    });

    pinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && pin.length >= 4) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit'));
      }
    });

    pinInput.focus();
  }

  async loadInitialData() {
    const statusMsg = document.getElementById('statusMessage');
    statusMsg.textContent = 'Ielādēju datus...';

    let result;
    try {
      result = await this.sync.loadInitialData();
    } catch (e) {
      console.error('[login] loadInitialData threw:', e);
      statusMsg.textContent = 'Kļūda: ' + (e.message || e);
      return;
    }

    if (result.offline) {
      const hasLocal = await this.sync.hasLocalData();
      if (!hasLocal) {
        statusMsg.textContent = 'Nav interneta un nav lokālu datu. Atveriet konsoli (F12).';
        console.warn('[login] offline, no local data');
        return;
      }
      statusMsg.textContent = 'Bezsaistē ar lokāliem datiem';
      document.body.classList.remove('online');
    } else {
      const total = Object.values(result.count || {}).reduce((a, b) => a + b, 0);
      statusMsg.textContent = 'Gatavs (' + total + ' ieraksti)';
      document.body.classList.add('online');
    }
  }

  async authenticate(pin) {
    const errorMsg = document.getElementById('errorMessage');
    const statusMsg = document.getElementById('statusMessage');

    let employee = null;
    const employees = await this.db.getAll('darbinieki');

    employee = employees.find(e => String(e.pin) === String(pin) && e.aktivs !== false && e.aktivs !== 'false');

    if (!employee) {
      errorMsg.textContent = 'Nepareizs PIN kods';
      errorMsg.style.display = 'block';
      statusMsg.textContent = '';
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
    this.redirectByRole(user.loma);
  }

  redirectByRole(role) {
    const normalizedRole = String(role || '').toLowerCase().trim();

    if (normalizedRole === 'administrators' || normalizedRole === 'admins' || normalizedRole === 'admin') {
      window.location.href = 'admin.html';
    } else if (normalizedRole === 'kontroliere' || normalizedRole === 'controller') {
      window.location.href = 'control.html';
    } else {
      window.location.href = 'aprupe.html';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.loginController = new LoginController();
});
