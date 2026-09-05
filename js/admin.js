class AdminPanel {
  constructor() {
    this.db = null;
    this.sync = null;
    this.currentUser = null;
    this.clients = [];
    this.employees = [];
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
    this.sync = new SyncManager(this.db, CONFIG);
    window.careSync = this.sync;

    this.setupTabs();
    this.setupUI();
    await this.sync.loadInitialData();
    await this.loadData();
    this.renderDashboard();
    this.renderClientList();
    this.renderEmployeeList();
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

    document.getElementById('addClientBtn').addEventListener('click', () => this.showClientForm());
    document.getElementById('addEmployeeBtn').addEventListener('click', () => this.showEmployeeForm());

    document.getElementById('syncNow').addEventListener('click', () => this.syncNow());
    document.getElementById('checkConnection').addEventListener('click', () => this.checkConnection());
    document.getElementById('downloadTemplate').addEventListener('click', () => this.downloadTemplate());
    document.getElementById('testConnection').addEventListener('click', () => this.checkConnection());
    document.getElementById('findDuplicates').addEventListener('click', () => this.findDuplicates());
    document.getElementById('clearLocal').addEventListener('click', () => this.clearLocal());
    document.getElementById('manualBackup').addEventListener('click', () => this.manualBackup());

    document.querySelector('.modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') this.closeModal();
    });

    document.getElementById('gasUrl').textContent = CONFIG.GAS_URL;
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
      const dob = c.dzimis || c['Dzimšanas datums'] || '';
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

  showClientForm(client) {
    const isEdit = !!client;
    const id = client ? (client.id || client.ID) : '';
    const vards = client ? (client.vards || client.Vārds || '') : '';
    const uzvards = client ? (client.uzvards || client.Uzvārds || '') : '';
    const dzimis = client ? (client.dzimis || client['Dzimšanas datums'] || '') : '';
    const dieta = client ? (client.dieta || client.Diēta || '') : '';
    const saskarsmes = client ? (client.saskarsmes || client['Saskarsmes īpatnības'] || '') : '';

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
            <option value="aprūpētājs" ${loma === 'aprūpētājs' ? 'selected' : ''}>Aprūpētājs</option>
            <option value="kontroliere" ${loma === 'kontroliere' ? 'selected' : ''}>Kontrolieris</option>
            <option value="administrators" ${loma === 'administrators' ? 'selected' : ''}>Administrators</option>
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
    const id = this.db.generateId();
    const client = { id, ...data };
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
    this.toast('Klients pievienots');
  }

  async updateClient(id, data) {
    const client = await this.db.get('klienti', id);
    if (!client) return;
    Object.assign(client, data);
    await this.db.put('klienti', client);

    this.sync.enqueueChange({
      action: 'updateClient',
      table: 'klienti',
      data: { id, ...data }
    });

    await this.loadData();
    this.renderClientList();
    this.closeModal();
    this.toast('Klients atjaunināts');
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
      this.toast('PIN jābūt vismaz 4 cipariem');
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
    this.toast('Darbinieks pievienots. PIN: ' + data.pin);
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
    this.toast('Darbinieks atjaunināts');
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
    this.toast('Sinhronizē...');
    await this.sync.sync();
    await this.loadData();
    this.renderDashboard();
    this.toast('Sinhronizācija pabeigta');
  }

  async checkConnection() {
    const result = document.getElementById('connectionResult');
    result.style.display = 'block';
    result.className = 'connection-result';
    result.textContent = 'Pārbaudām...';

    try {
      const response = await fetch(CONFIG.GAS_URL + '?action=load&t=' + Date.now());
      const text = await response.text();
      if (text) {
        result.className = 'connection-result success';
        result.textContent = '✓ Savienojums ar Google Sheets ir aktīvs';
      } else {
        result.className = 'connection-result error';
        result.textContent = '✗ Tukša atbilde no servera';
      }
    } catch (err) {
      result.className = 'connection-result error';
      result.textContent = '✗ Nav savienojuma: ' + err.message;
    }
  }

  downloadTemplate() {
    const link = document.createElement('a');
    link.href = 'Aprūpes lapas.xlsx';
    link.download = 'Aprūpes lapas.xlsx';
    link.click();
    this.toast('Lejupielāde sākta');
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
      this.toast('Dublikātu nav');
    } else {
      const list = dupes.map(c => (c.vards || c.Vārds) + ' ' + (c.uzvards || c.Uzvārds)).join('\n');
      alert('Atrasti dublikāti:\n' + list);
    }
  }

  async clearLocal() {
    if (!confirm('Tiešām notīrīt visus lokālos datus?')) return;
    await this.db.clear('klienti');
    await this.db.clear('atzimes');
    await this.db.clear('atzimes_log');
    await this.db.clear('dienas_ierakti');
    this.toast('Lokālie dati notīrīti');
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
    this.toast('Rezerves kopija izveidota');
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
