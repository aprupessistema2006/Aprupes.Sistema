// ───────────────────────────────────────────────────────────────────
// PIETEIKŠANĀS — trīssoļu plūsma (drošība: "nulle uzticēšanās klientam")
//
//   1) Kopīgā parole      → atver ierīci (login.start)
//   2) Darbinieka vārds   → saraksts nāk no SERVERA, bez PIN laukiem
//   3) Individuālais PIN  → serveris salīdzina HMAC-SHA256 (login.pin)
//
// PIN un paroles NEKAD netiek saglabāti lokāli. Pēc veiksmīgas
// pārbaudes serveris atgriež sesijas tokenu (der 8 stundas),
// ko glabājam localStorage; identitāte un loma — TIKAI no sesijas.
// ───────────────────────────────────────────────────────────────────
class LoginController {
  constructor() {
    this.db = null;
    this.sync = null;
    this.user = null;
    this.employees = [];        // no servera atdotā saraksta (bez PIN)
    this.filteredEmployees = [];
    this.selectedEmployee = null;
    this.pin = '';
    this.setupMode = false;
    this.unlocked = false;      // kopīgā parole apstiprināta
    this.init();
  }

  async init() {
    this.db = new CareDB();
    await this.db.init();
    window.careDB = this.db;
    this.sync = new CareSync(this.db, CONFIG);
    window.careSync = this.sync;

    // Ja jau ir derīga sesija (tokens localStorage + lietotājs
    // sessionStorage), pārbaudām to serverī un atgriežamies
    // atbilstošajā sadaļā bez atkārtotas pieteikšanās.
    const savedUserRaw = sessionStorage.getItem('careUser');
    const token = getSessionToken();
    if (savedUserRaw && token) {
      try {
        const user = JSON.parse(savedUserRaw);
        const check = await callBackend('session.check', {}, 15000);
        if (check && check.valid === true) {
          this.redirectByRole(user.loma);
          return;
        }
      } catch (e) {
        // Sesija beigusies vai servers nepieejams — rādām pieteikšanos.
        console.warn('[login] sesijas pārbaude neizdevās:', e && e.message);
      }
    }

    this.setupUI();
    this.setupLanguageSwitcher();
    this.hideSplash();
    // Sākotnēji redzams TIKAI kopīgās paroles solis. Darbinieku
    // saraksts nāk no servera pēc atbildes (login.start).
  }

  enterSetupMode() {
    this.setupMode = true;
    const loginSection = document.getElementById('loginSection');
    const setupSection = document.getElementById('setupSection');
    const passwordSection = document.getElementById('passwordSection');
    const employeeArea = document.getElementById('employeeArea');
    const statusMsg = document.getElementById('statusMessage');
    if (passwordSection) passwordSection.style.display = 'none';
    if (employeeArea) employeeArea.style.display = 'none';
    if (loginSection) loginSection.style.display = 'none';
    if (setupSection) setupSection.style.display = 'block';
    if (statusMsg) statusMsg.textContent = 'Sistēma nav konfigurēta — izveido pirmo administratoru.';
  }

  async exitSetupMode() {
    this.setupMode = false;
    const loginSection = document.getElementById('loginSection');
    const setupSection = document.getElementById('setupSection');
    const passwordSection = document.getElementById('passwordSection');
    if (setupSection) setupSection.style.display = 'none';
    if (passwordSection) passwordSection.style.display = 'block';
    if (loginSection) loginSection.style.display = 'block';
  }

  setupUI() {
    const passwordForm = document.getElementById('passwordForm');
    const sharedPassword = document.getElementById('sharedPassword');
    const unlockBtn = document.getElementById('unlockBtn');
    const pinInput = document.getElementById('pinInput');
    const loginBtn = document.getElementById('loginBtn');
    const errorMsg = document.getElementById('errorMessage');
    const statusMsg = document.getElementById('statusMessage');
    const employeeSearch = document.getElementById('employeeSearch');
    const clearBtn = document.getElementById('clearSelection');

    const maxLength = 6;

    // ── SOLIS 1: kopīgā parole ──────────────────────────────────
    if (passwordForm) {
      passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = sharedPassword ? sharedPassword.value : '';
        if (!password) {
          if (errorMsg) {
            errorMsg.textContent = 'Ievadi kopīgo paroli';
            errorMsg.style.display = 'block';
          }
          return;
        }
        if (unlockBtn) unlockBtn.disabled = true;
        if (statusMsg) statusMsg.textContent = 'Pārbaudēju paroli...';
        try {
          const res = await callBackend('login.start', { password: password }, 30000);
          if (res && res.setup_required) {
            this.enterSetupMode();
            return;
          }
          if (res && res.success === true && Array.isArray(res.employees)) {
            this.employees = this.groupEmployees(res.employees);
            this.filteredEmployees = [...this.employees];
            this.unlocked = true;
            const passwordSection = document.getElementById('passwordSection');
            const employeeArea = document.getElementById('employeeArea');
            if (passwordSection) passwordSection.style.display = 'none';
            if (employeeArea) employeeArea.style.display = 'block';
            this.renderEmployeeList();
            if (statusMsg) {
              statusMsg.textContent = '✓ Ierīce atvērta • ' + this.employees.length + ' darbinieki';
              statusMsg.style.color = '#27ae60';
            }
            document.body.classList.add('online');
          } else {
            if (errorMsg) {
              errorMsg.textContent = (res && res.error) ? res.error : 'Nepareiza kopīgā parole';
              errorMsg.style.display = 'block';
            }
            if (statusMsg) statusMsg.textContent = '';
          }
        } catch (err) {
          if (errorMsg) {
            errorMsg.textContent = 'Neizdevās sazināties ar serveri: ' + (err && err.message ? err.message : err);
            errorMsg.style.display = 'block';
            errorMsg.style.color = '#e74c3c';
          }
          if (statusMsg) {
            statusMsg.textContent = '⚠️ Serveris nav pieejams. Pārbaudi interneta savienojumu.';
            statusMsg.style.color = '#e74c3c';
          }
          document.body.classList.remove('online');
        } finally {
          if (unlockBtn) unlockBtn.disabled = false;
        }
      });
    }

    // ── SOLIS 3: PIN ievade ─────────────────────────────────────
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
        if (errorMsg) errorMsg.style.display = 'none';
      });

      pinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
          e.preventDefault();
          this.pin = this.pin.substring(0, this.pin.length - 1);
          e.target.value = '•'.repeat(this.pin.length);
          this.refreshLoginButton();
          if (errorMsg) errorMsg.style.display = 'none';
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

    const form = document.getElementById('loginForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!this.selectedEmployee) {
          if (errorMsg) {
            errorMsg.textContent = 'Izvēlies darbinieku no saraksta';
            errorMsg.style.display = 'block';
          }
          return;
        }
        if (this.pin.length < 4) {
          if (errorMsg) {
            errorMsg.textContent = 'PIN kodā jābūt vismaz 4 cipariem';
            errorMsg.style.display = 'block';
          }
          return;
        }
        loginBtn.disabled = true;
        if (statusMsg) statusMsg.textContent = 'Pārbaudējam...';
        await this.authenticate(this.selectedEmployee, this.pin);
        loginBtn.disabled = false;
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

    // ── Pirmā konfigurācija: parole + pirmais administrators ────
    const setupForm = document.getElementById('setupForm');
    if (setupForm) {
      setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const password = String(formData.get('password') || '');
        const data = {
          vards: String(formData.get('vards') || ''),
          uzvards: String(formData.get('uzvards') || ''),
          pin: String(formData.get('pin') || ''),
          loma: 'administrators'
        };
        const setupStatus = document.getElementById('setupStatus');
        if (setupStatus) {
          setupStatus.textContent = 'Konfigurēju sistēmu...';
          setupStatus.style.display = 'block';
        }
        try {
          const res = await callBackend('setup', {
            password: password,
            employee: data
          }, 30000);
          if (res && res.success) {
            if (setupStatus) {
              setupStatus.textContent = '✓ Sistēma konfigurēta! Ielādēju...';
              setupStatus.style.color = '#27ae60';
            }
            await this.exitSetupMode();
            // Automātiski atver ar tikko izveidoto paroli
            if (sharedPassword) sharedPassword.value = password;
            passwordForm.dispatchEvent(new Event('submit'));
          } else {
            if (setupStatus) {
              setupStatus.textContent = 'Kļūda: ' + (res && res.error ? res.error : 'Neizdevās konfigurēt');
              setupStatus.style.color = '#e74c3c';
            }
          }
        } catch (err) {
          if (setupStatus) {
            setupStatus.textContent = 'Kļūda: ' + (err && err.message ? err.message : err);
            setupStatus.style.color = '#e74c3c';
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

  // Servera saraksts (viena rinda = viens darbinieka ieraksts)
  // tiek grupēts pa vārdu/uzvārdu — viena persona var būt ar
  // vairākām lomām (vairākiem ierakstiem).
  groupEmployees(list) {
    const grouped = new Map();
    for (const e of list) {
      const empId = String(e.id || '');
      const key = empId; // Katrs ieraksts ir atsevišķs pēc ID
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: empId,
          vards: e.vards,
          uzvards: e.uzvards,
          lomas: [],
          allIds: [empId],
          mainaTips: e.maina_tips || 'diennakts'
        });
      } else {
        const g = grouped.get(key);
        if (empId && !g.allIds.includes(empId)) g.allIds.push(empId);
      }
      const g = grouped.get(key);
      const role = (e.loma || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const roleCanonical = { 'aprupetajs': 'aprūpētājs', 'kontroliere': 'kontroliere', 'administrators': 'administrators', 'medicis': 'medic', 'medicina': 'medic', 'medicinska': 'medic', 'arsts': 'medic', 'medicin': 'medic', 'medicinas': 'medic', 'medicinas darbinieks': 'medic' }[role] || (role.indexOf('medic') !== -1 ? 'medic' : e.loma);
      if (roleCanonical && !g.lomas.includes(roleCanonical)) g.lomas.push(roleCanonical);
    }
    return Array.from(grouped.values()).sort((a, b) => {
      const aN = (a.uzvards + ' ' + a.vards).toLowerCase();
      const bN = (b.uzvards + ' ' + b.vards).toLowerCase();
      return aN.localeCompare(bN);
    });
  }

  filterEmployees(term) {
    this.applyFilters(term || '');
  }

  applyFilters(searchTerm) {
    const role = this.activeRoleFilter || 'all';
    let result = this.employees;
    if (role !== 'all') {
      result = result.filter(e => {
        const roles = e.lomas || [];
        return roles.some(r => { const rRaw2 = r || ''; const rN2 = this._normalizeForSearch(rRaw2); if (t.indexOf('medic') !== -1 && (rN2.indexOf('medic') !== -1 || rRaw2.toLowerCase().indexOf('medic') !== -1 || rRaw2.toLowerCase().indexOf('ārsts') !== -1 || rRaw2.toLowerCase().indexOf('medicī') !== -1 || rRaw2.toLowerCase().indexOf('medicin') !== -1)) return true; if (t.indexOf('aprup') !== -1 && rN2.indexOf('aprup') !== -1) return true; if (t.indexOf('kontrol') !== -1 && rN2.indexOf('kontrol') !== -1) return true; if (t.indexOf('admin') !== -1 && rN2.indexOf('admin') !== -1) return true;
          const l = r.toLowerCase();
          return l === role || l === (CONFIG.ROLES[role] || role);
        });
      });
    }
    if (searchTerm) {
      const term = this._normalizeForSearch(searchTerm.trim());
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
            matches = v.includes(term) || u.includes(term) || v.startsWith(term) || u.startsWith(term) || roleMatch;
          } else {
            matches = words.every(w => fullName.includes(w)) || roleMatch;
          }
          return matches;
        });
      }
    }
    this.filteredEmployees = [...result];
  }

  // Nozīmē diakritiskos zīmes, lai meklēšana darbotos arī bez diakritikas
  _normalizeForSearch(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
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

    if (roles.length === 1) {
      this.focusPinInput();
    } else if (roles.length > 1) {
      this.showRoleSelector(emp);
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

    const selectedEl = document.getElementById('selectedEmployee');
    const roleEl = document.getElementById('selectedRole');
    if (!selectedEl || !roleEl) return;

    this._originalRoleContent = roleEl.innerHTML;

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
      const checked = roleEl.querySelector('input[name="inlineRoleChoice"]:checked');
      if (!checked) return;
      this.selectedEmployee.chosenRole = checked.value;
      roleEl.innerHTML = `<span class="role-badge" style="background:${roleColor(checked.value)}20;color:${roleColor(checked.value)};border:1px solid ${roleColor(checked.value)}">${roleLabel(checked.value)}</span>`;
      const pinInput = document.getElementById('pinInput');
      const loginBtn = document.getElementById('loginBtn');
      if (pinInput) {
        pinInput.disabled = false;
        setTimeout(() => {
          pinInput.focus();
          pinInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.scrollTo({ top: pinInput.offsetTop - 80, behavior: 'smooth' });
        }, 50);
      }
      if (loginBtn) loginBtn.disabled = false;
    });

    cancelBtn.addEventListener('click', () => {
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

  // ── SOLIS 3: PIN pārbaude SERVERĪ (HMAC-SHA256) ────────────────
  // Klients NODRĪKST salīdzināt PIN lokāli — to dara serveris.
  async authenticate(employee, pin) {
    const errorMsg = document.getElementById('errorMessage');
    const statusMsg = document.getElementById('statusMessage');
    const pinInput = document.getElementById('pinInput');

    const shiftTypeInput = document.querySelector('input[name="shiftType"]:checked');
    const mainaTips = shiftTypeInput ? shiftTypeInput.value : 'diennakts';

    // Ja izvēlējās lomu — izmantot to, citāk pirmo
    const chosenRole = employee.chosenRole || (employee.lomas || [])[0];

    if (statusMsg) statusMsg.textContent = 'Pārbaudējam PIN...';

    try {
      const res = await callBackend('login.pin', {
        vards: employee.vards,
        uzvards: employee.uzvards,
        pin: pin
      }, 30000);

      if (res && res.success === true && res.sessionToken) {
        // ✅ Serveris apstiprināja PIN un atdeva sesijas tokenu.
        setSessionToken(res.sessionToken);

        const user = {
          id: (res.employee && res.employee.id) || employee.id,
          vards: (res.employee && res.employee.vards) || employee.vards,
          uzvards: (res.employee && res.employee.uzvards) || employee.uzvards,
          loma: (res.employee && res.employee.loma) || chosenRole,
          visulasLomas: employee.lomas || [],
          pinVerified: true,
          loginTime: Date.now(),
          mainaTips: mainaTips
        };

        sessionStorage.setItem('careUser', JSON.stringify(user));
        this.user = user;

        // Atspoguļot izvēlēto maiņu tipu Google Sheet darbinieka
        // ierakstā — SAVĀ (sesijas) identitātē.
        if (this.sync && typeof this.sync.syncShift === 'function') {
          try {
            this.sync.syncShift(user.id, mainaTips);
          } catch (e) {
            console.warn('[login] maiņas tipa sinhronizācija neizdevās (nav kritiska):', e);
          }
        }

        this.showSuccess(user);
        return;
      }

      // ❌ Serveris noraidīja PIN
      const msg = (res && res.error) ? res.error : 'Nepareizs PIN kods';
      if (errorMsg) {
        errorMsg.textContent = msg;
        errorMsg.style.display = 'block';
      }
      if (statusMsg) statusMsg.textContent = '';
      this.pin = '';
      if (pinInput) {
        pinInput.value = '';
        setTimeout(() => pinInput.focus(), 50);
      }
      this.refreshLoginButton();
    } catch (err) {
      if (err && err.sessionExpired) return; // handleSessionExpired jau pārsauc uz login
      if (errorMsg) {
        errorMsg.textContent = 'Neizdevās pārbaudīt PIN: ' + (err && err.message ? err.message : err);
        errorMsg.style.display = 'block';
      }
      if (statusMsg) statusMsg.textContent = '';
      this.pin = '';
      this.refreshLoginButton();
    }
  }

  showSuccess(user) {
    const card = document.querySelector('.login-card');
    if (!card) {
      this.redirectByRole(user.loma);
      return;
    }
    const roleLbl = { 'administrators': 'administrator', 'kontroliere': 'kontrolier', 'aprūpētājs': 'aprūpētāj', 'medic': 'medicīnas darbinieks', 'mediķis': 'medicīnas darbinieks', 'ārsts': 'medicīnas darbinieks' };
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







































