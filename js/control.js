class ControlPanel {
  constructor() {
    this.db = null;
    this.sync = null;
    this.currentUser = null;
    this.allClients = [];
    this.allEmployees = [];
    this.allLog = [];
    this.allMarks = [];
    this.allDiary = [];
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
    this.setupUI();
    await this.loadData();
    this.renderAll();
    await this.setupTasksUI();

    this.sync.loadInitialData().then(async () => {
      await this.loadData();
      this.renderAll();
      await this.renderTasksList();
    });
  }

  setupUI() {
    document.getElementById('backBtn').addEventListener('click', () => {
      window.location.href = 'index.html';
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

    const today = this.todayLocal();
    const dateEl = document.getElementById('dateFilter');
    if (dateEl) {
      dateEl.value = today;
      dateEl.addEventListener('change', () => {
        this.renderAll();
        this.updateDateModeBadge();
      });
    }

    const addDateRangeUI = () => {
      const filterBar = document.querySelector('.filter-bar');
      if (!filterBar || document.getElementById('showAllBtn')) return;
      const btn = document.createElement('button');
      btn.id = 'showAllBtn';
      btn.className = 'btn-secondary';
      btn.textContent = '📅 Rādīt visu';
      btn.style.cssText = 'padding:8px 14px;border:1px solid #2c3e50;background:white;color:#2c3e50;border-radius:6px;cursor:pointer;font-size:13px;margin-left:8px;font-weight:600;';
      btn.addEventListener('click', () => {
        if (dateEl) dateEl.value = '';
        this.renderAll();
        this.updateDateModeBadge();
      });
      const mode = document.createElement('span');
      mode.id = 'dateModeBadge';
      mode.style.cssText = 'margin-left:10px;font-size:12px;color:#27ae60;font-weight:600;';
      filterBar.appendChild(btn);
      filterBar.appendChild(mode);
    };
    addDateRangeUI();
    this.updateDateModeBadge();

    document.getElementById('refreshBtn').addEventListener('click', async () => {
      const btn = document.getElementById('refreshBtn');
      if (btn) btn.disabled = true;
      this.toast('Atjauninu no servera...');
      try {
        await this.sync.loadInitialData();
        await this.loadData();
        this.renderAll();
        this.toast('Dati atjaunināti');
      } catch (e) {
        this.toast('Kļūda: ' + e.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    document.getElementById('exportBtn').addEventListener('click', () => this.exportExcel());
    document.getElementById('onlyEdited').addEventListener('change', () => this.renderHistory());
  }

  todayLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  updateDateModeBadge() {
    const badge = document.getElementById('dateModeBadge');
    if (!badge) return;
    const dateEl = document.getElementById('dateFilter');
    if (!dateEl || !dateEl.value) {
      badge.textContent = '✓ Rāda visus ierakstus';
      badge.style.color = '#2980b9';
    } else {
      badge.textContent = '✓ Filtrs: ' + dateEl.value;
      badge.style.color = '#27ae60';
    }
  }

  async loadData() {
    this.allClients = await this.db.getAll('klienti');
    this.allEmployees = await this.db.getAll('darbinieki');
    this.allMarks = await this.db.getAll('atzimes');
    this.allLog = await this.db.getAll('atzimes_log');
    this.allDiary = await this.db.getAll('dienas_ierakti');

    const diagEl = document.getElementById('dbStats');
    if (diagEl) {
      const fills = (arr) => (arr || []).filter(r => {
        if (!r) return false;
        return Object.values(r).some(v => v !== '' && v !== null && v !== undefined);
      }).length;
      diagEl.innerHTML =
        '<strong>DB saturā (pēc pēdējās sync):</strong><br>' +
        '👥 Darbinieki: ' + fills(this.allEmployees) + '<br>' +
        '🏠 Klienti: ' + fills(this.allClients) + '<br>' +
        '📝 Atzīmes: ' + fills(this.allMarks) + '<br>' +
        '📜 Žurnāls: ' + fills(this.allLog);
    }

    if (!this.allClients || this.allClients.length === 0) {
      const fromMarks = new Map();
      [...(this.allMarks || []), ...(this.allLog || [])].forEach(r => {
        const cid = r.clientId || r.klientiId || r.klients_id;
        if (cid && !fromMarks.has(String(cid))) {
          fromMarks.set(String(cid), { id: String(cid), vards: '?', uzvards: '?' });
        }
      });
      this.allClients = Array.from(fromMarks.values());
    }

    const clientFilter = document.getElementById('clientFilter');
    if (clientFilter) {
      clientFilter.innerHTML = '<option value="">Visi klienti (' + this.allClients.length + ')</option>' +
        this.allClients.map(c => {
          const name = (c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '');
          return `<option value="${c.id || c.ID}">${this.escapeHtml(name.trim() || ('ID: ' + (c.id || c.ID)))}</option>`;
        }).join('');
    }

    const empFilter = document.getElementById('employeeFilter');
    if (empFilter) {
      empFilter.innerHTML = '<option value="">Visi (' + this.allEmployees.length + ')</option>' +
        this.allEmployees.map(e => {
          const name = (e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '');
          return `<option value="${e.id || e.ID}">${this.escapeHtml(name.trim() || ('ID: ' + (e.id || e.ID)))}</option>`;
        }).join('');
    }
  }

  normalizeDateForFilter(d) {
    if (!d) return '';
    if (typeof d === 'string') {
      if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(d)) {
        const p = d.split('.');
        return p[2] + '-' + p[1] + '-' + p[0];
      }
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
        const p = d.split('/');
        return p[2] + '-' + p[0] + '-' + p[1];
      }
    }
    return '';
  }

  extractDateFromAnyField(row) {
    const candidates = [row.date, row.created, row.lastModified, row.izveidots, row.pedeja_laiks];
    for (const c of candidates) {
      if (c === null || c === undefined || c === '') continue;
      let s = '';
      if (c instanceof Date) {
        if (isNaN(c.getTime())) continue;
        if (c.getFullYear() < 1900) continue;
        s = c.toISOString();
      } else if (typeof c === 'string') {
        s = c;
      } else if (typeof c === 'number') {
        s = new Date(c).toISOString();
      }
      if (!s) continue;
      const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m1) {
        const y = parseInt(m1[1]);
        if (y >= 2020 && y <= 2035) return m1[0];
      }
      const m2 = s.match(/(\d{4}-\d{2}-\d{2})/);
      if (m2) {
        const y = parseInt(m2[1].substring(0, 4));
        if (y >= 2020 && y <= 2035) return m2[1];
      }
    }
    return '';
  }

  getFilteredData() {
    const date = document.getElementById('dateFilter').value;
    const clientId = document.getElementById('clientFilter').value;
    const employeeId = document.getElementById('employeeFilter').value;
    const onlyEdited = document.getElementById('onlyEdited').checked;

    const extractAll = (row) => [
      this.extractDateFromAnyField(row),
      this.extractDateFromAnyFieldField(row, 'izveidots'),
      this.extractDateFromAnyFieldField(row, 'created')
    ].filter(Boolean);

    const filterBy = (row) => {
      if (date) {
        const rowDates = extractAll(row);
        if (rowDates.length > 0 && !rowDates.includes(date)) return false;
      }
      if (clientId) {
        const cid = String(row.clientId || '');
        if (cid !== String(clientId)) return false;
      }
      if (employeeId) {
        const eid = String(row.employeeId || '');
        if (eid !== String(employeeId)) return false;
      }
      return true;
    };

    let marks = this.allMarks.filter(filterBy);
    let log = this.allLog.filter(filterBy);
    if (onlyEdited) log = log.filter(l => l.type === 'Labots' || l.type === 'Labots' || l.prevValue);

    return { marks, log, date, clientId, employeeId, onlyEdited };
  }

  extractDateFromAnyFieldField(row, field) {
    const v = row[field];
    if (!v) return '';
    if (v instanceof Date) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, '0');
      const d = String(v.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
    if (typeof v === 'string') {
      const m1 = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m1) return m1[0];
    }
    return '';
  }

  renderAll() {
    const data = this.getFilteredData();
    this.renderStats(data);
    this.renderHistory();
  }

  renderStats(data) {
    const { marks, log, date, clientId } = data;
    const activeClients = this.allClients.filter(c => {
      const a = c.aktivs;
      return a === true || a === 'true' || a === 'TRUE' || a === 1 || a === '1' || a === undefined;
    });
    const targetClients = clientId ? [clientId] : activeClients.map(c => c.id || c.ID);

    const completed = new Set();
    marks.filter(m => m.category === 'paraksts' || m.field === 'aprupetaja_paraksts').forEach(m => {
      completed.add(m.clientId);
    });

    let tempHigh = 0;
    let fluid = 0;
    let urine = 0;
    let diapers = 0;
    let foodCount = 0;

    marks.forEach(m => {
      if (m.category === 'temp' && (m.field === 'temperatura' || m.field === 'temperatūra')) {
        const v = parseFloat(m.value);
        if (!isNaN(v) && v >= 37) tempHigh++;
      }
      if (m.category === 'sikdrumi' && (m.field === 'uznemts_ml' || m.field === 'uzņemts_ml' || m.field === 'uzņemts_h2o')) {
        fluid += parseFloat(m.value) || 0;
      }
      if (m.category === 'sikdrumi' && (m.field === 'urina_daudzums' || m.field === 'urīna_daudzums')) {
        urine += parseFloat(m.value) || 0;
      }
      if (m.category === 'citsi_pasakomi' && (m.field === 'autins_biksitu_skaits' || m.field === 'autiņbiksīšu_skaits')) {
        diapers += parseInt(m.value) || 0;
      }
      if (m.category === 'edinasana' || m.category === 'ēdināšana') {
        if (m.value && m.value !== '') foodCount++;
      }
    });

    const incomplete = Math.max(0, targetClients.length - completed.size);
    const edits = log.filter(l => l.type === 'Labots' || l.prevValue).length;

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setText('statTotal', targetClients.length);
    setText('statCompleted', completed.size);
    setText('statIncomplete', incomplete);
    setText('statFever', tempHigh);
    setText('statFluid', fluid);
    setText('statUrine', urine);
    setText('statDiapers', diapers);
    setText('statEdits', edits);
    setText('statFood', foodCount);

    const empStats = {};
    marks.forEach(m => {
      const eid = String(m.employeeId || '?');
      empStats[eid] = (empStats[eid] || 0) + 1;
    });
    log.forEach(l => {
      const eid = String(l.employeeId || '?');
      empStats[eid] = (empStats[eid] || 0) + 1;
    });
    const empNames = {};
    this.allEmployees.forEach(e => {
      empNames[String(e.id || e.ID)] = ((e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '')).trim();
    });
    const empLines = Object.keys(empStats).map(eid => {
      const n = empNames[eid] || ('ID: ' + eid);
      return '• ' + n + ': ' + empStats[eid];
    });
    const empEl = document.getElementById('statByEmployee');
    if (empEl) {
      empEl.innerHTML = empLines.length
        ? empLines.join('<br>')
        : '<em style="color:#999">Nav datu</em>';
    }

    const rangeEl = document.getElementById('statRange');
    if (rangeEl) {
      const dates = marks.map(m => this.extractDateFromAnyField(m)).filter(d => d);
      if (dates.length > 0) {
        dates.sort();
        rangeEl.textContent = dates[0] + ' — ' + dates[dates.length - 1];
      } else {
        rangeEl.textContent = 'Nav ierakstu';
      }
    }
  }

  formatTimeForDisplay(t) {
    if (!t) return '';
    if (t instanceof Date) {
      if (isNaN(t.getTime())) return '';
      return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    }
    if (typeof t === 'string') {
      if (/^\d{2}:\d{2}:\d{2}/.test(t)) return t.substring(0, 8);
      if (/^\d{2}:\d{2}/.test(t)) return t.substring(0, 5);
      if (t.includes('T')) {
        const d = new Date(t);
        if (!isNaN(d.getTime())) {
          return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
        }
      }
    }
    return String(t);
  }

  formatFieldLabel(category, field) {
    if (!field) return category || '';
    const map = {
      'mutes_dobuma_kopsana': 'Mutes dobuma kopšana',
      'vana_dns': 'Vanna, duša',
      'daleja_apmazgasana': 'Daļēja apmazgāšana',
      'velas_maina': 'Veļas maiņa',
      'nagu_kopsana': 'Nagu kopšana',
      'matu_kopsana': 'Matu kopšana',
      'bardas_skushana': 'Bārdas skūšana',
      'parvietojas_ar_palidzlekli': 'Pārvietojas ar palīglīdzekli',
      'stav_ar_palidziigu': 'Stāv ar palīdzību',
      'sedz_ar_palidziigu': 'Sēž ar palīdzību',
      'temperatura': 'Temperatūra',
      'brokastis': 'Brokastis',
      'pusdienas': 'Pusdienas',
      'launags': 'Launags',
      'vakariņi': 'Vakariņas',
      'urina_daudzums': 'Urīna daudzums',
      'uznemts_ml': 'Uzņemts H2O',
      'vedera_izeja': 'Vēdera izeja',
      'adas_kopsana': 'Ādas kopšana',
      'pastaigas': 'Pastaiga',
      'ciemini': 'Ciemiņi',
      'autins_biksitu_skaits': 'Higiēnas maiņa',
      'aprupetaja_paraksts': 'Paraksts'
    };
    return map[field] || field;
  }

  formatCategoryLabel(category) {
    const map = {
      'temp': '🌡️ Temperatūra',
      'higiena': '🧼 Higiēna',
      'aktivitate': '🚶 Aktivitāte',
      'edinasana': '🍽️ Ēdināšana',
      'sikdrumi': '💧 Šķidrumi',
      'fiziologija': '🚽 Vēdera izeja',
      'citsi_pasakomi': '📋 Citi pasākumi',
      'paraksts': '✍️ Paraksts'
    };
    return map[category] || category;
  }

  renderHistory() {
    const data = this.getFilteredData();
    const { log } = data;

    const clientMap = {};
    this.allClients.forEach(c => {
      clientMap[String(c.id || c.ID)] = (c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '');
    });

    const empMap = {};
    this.allEmployees.forEach(e => {
      empMap[String(e.id || e.ID)] = (e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '');
    });

    const body = document.getElementById('historyBody');
    if (!body) return;

    if (log.length === 0) {
      body.innerHTML = '<tr><td colspan="9" class="loading">Nav datu izvēlētajā datumā / filtrā</td></tr>';
      return;
    }

    const sorted = [...log].sort((a, b) => {
      const da = this.extractDateFromAnyField(a) || '';
      const db = this.extractDateFromAnyField(b) || '';
      if (da !== db) return db.localeCompare(da);
      const ta = this.formatTimeForDisplay(a.time);
      const tb = this.formatTimeForDisplay(b.time);
      return tb.localeCompare(ta);
    });

    body.innerHTML = sorted.slice(0, 500).map(l => {
      const date = this.extractDateFromAnyField(l) || '-';
      const time = this.formatTimeForDisplay(l.time);
      const cid = String(l.clientId || '');
      const eid = String(l.employeeId || '');
      const clientName = clientMap[cid] || ('ID: ' + cid);
      const empName = empMap[eid] || ('ID: ' + eid);
      const isEdit = l.type === 'Labots' || l.prevValue;
      const value = l.value === '' || l.value === undefined ? '<em style="color:#999">(tukšs)</em>' : this.escapeHtml(String(l.value));
      return `
        <tr>
          <td><strong>${this.escapeHtml(date)}</strong></td>
          <td><strong>${this.escapeHtml(time)}</strong></td>
          <td>${this.escapeHtml(clientName.trim())}</td>
          <td>${this.escapeHtml(empName.trim())}</td>
          <td>${this.escapeHtml(this.formatCategoryLabel(l.category))}</td>
          <td>${this.escapeHtml(this.formatFieldLabel(l.category, l.field))}</td>
          <td>${value}</td>
          <td>${l.prevValue ? this.escapeHtml(String(l.prevValue)) : '-'}</td>
          <td>${isEdit ? '<span class="edit-tag">Labots</span>' : '<span class="new-tag">Jauns</span>'}</td>
        </tr>
      `;
    }).join('');

    const countEl = document.getElementById('historyCount');
    if (countEl) countEl.textContent = log.length + ' ierakstu';
  }

  async setupTasksUI() {
    const assignee = document.getElementById('taskAssignee');
    const clientSel = document.getElementById('taskClient');
    const deadline = document.getElementById('taskDeadline');
    const form = document.getElementById('taskCreateForm');

    if (deadline) deadline.value = this.todayLocal();

    if (assignee) {
      assignee.innerHTML = '<option value="">— izvēlies darbinieku —</option>' +
        this.allEmployees.map(e => {
          const id = e.id || e.ID;
          const v = e.vards || e.Vārds || '';
          const u = e.uzvards || e.Uzvārds || '';
          const l = e.loma || e.Loma || '';
          return `<option value="${id}">${this.escapeHtml((v + ' ' + u).trim())} (${this.escapeHtml(l)})</option>`;
        }).join('');
    }

    if (clientSel) {
      clientSel.innerHTML = '<option value="">— bez klienta —</option>' +
        this.allClients.map(c => {
          const id = c.id || c.ID;
          const v = c.vards || c.Vārds || '';
          const u = c.uzvards || c.Uzvārds || '';
          return `<option value="${id}">${this.escapeHtml((v + ' ' + u).trim())}</option>`;
        }).join('');
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const employeeId = assignee.value;
        const klientsId = clientSel.value;
        const termins = deadline.value;
        const prioritate = document.getElementById('taskPriority').value;
        const teksts = document.getElementById('taskText').value.trim();
        if (!employeeId || !teksts || !termins) {
          this.toast('Aizpildi darbinieku, termiņu un uzdevuma tekstu');
          return;
        }
        if (window.TaskManager) {
          await window.TaskManager.create({
            teksts: teksts,
            klientsId: klientsId,
            pieskirtDarbiniekamId: employeeId,
            termins: termins,
            prioritate: prioritate,
            izveidotajsId: this.currentUser.id
          });
          this.toast('✓ Uzdevums nosūtīts');
          document.getElementById('taskText').value = '';
          await this.renderTasksList();
        }
      });
    }

    await this.renderTasksList();
  }

  async renderTasksList() {
    const container = document.getElementById('tasksList');
    const countEl = document.getElementById('tasksCount');
    if (!container || !window.TaskManager) return;
    await window.TaskManager.loadAll();
    const all = window.TaskManager.tasks || [];
    const active = all.filter(t => !t.irPabeigts && t.irPabeigts !== 'true' && t.irPabeigts !== 'TRUE');
    const completed = all.filter(t => t.irPabeigts === true || t.irPabeigts === 'true' || t.irPabeigts === 'TRUE');

    if (countEl) countEl.textContent = active.length + ' aktīvi / ' + completed.length + ' pabeigti';

    const empMap = {};
    this.allEmployees.forEach(e => {
      empMap[String(e.id || e.ID)] = (e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '');
    });
    const clientMap = {};
    this.allClients.forEach(c => {
      clientMap[String(c.id || c.ID)] = (c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '');
    });

    if (all.length === 0) {
      container.innerHTML = '<div class="loading">Nav uzdevumu. Pievieno jaunu augstāk.</div>';
      return;
    }

    const sorted = [...all].sort((a, b) => {
      const ad = a.irPabeigts ? 1 : 0;
      const bd = b.irPabeigts ? 1 : 0;
      if (ad !== bd) return ad - bd;
      const pa = window.TaskManager.priorityWeight(a.prioritate);
      const pb = window.TaskManager.priorityWeight(b.prioritate);
      if (pa !== pb) return pb - pa;
      return (a.termins || '').localeCompare(b.termins || '');
    });

    container.innerHTML = sorted.map(t => {
      const assignee = empMap[String(t.pieskirtDarbiniekamId || t.employeeId)] || 'ID: ' + (t.pieskirtDarbiniekamId || t.employeeId);
      const client = t.klientsId ? (clientMap[String(t.klientsId)] || 'ID: ' + t.klientsId) : '—';
      const pr = (t.prioritate || 'videja').toLowerCase();
      const prLabel = { augsta: '🔴 Augsta', videja: '🟡 Vidēja', zema: '🟢 Zema' }[pr] || pr;
      const done = t.irPabeigts === true || t.irPabeigts === 'true' || t.irPabeigts === 'TRUE';
      const doneBy = t.pabeigtajsId ? empMap[String(t.pabeigtajsId)] || 'ID: ' + t.pabeigtajsId : '';
      const overdue = window.TaskManager.isOverdue(t.termins) && !done;
      const today = window.TaskManager.isToday(t.termins) && !done;
      return `
        <div class="task-row ${done ? 'done' : ''} ${overdue ? 'overdue' : ''} ${today ? 'today' : ''}">
          <div class="task-row-left">
            <div class="task-row-header">
              <span class="task-row-priority">${prLabel}</span>
              <span class="task-row-deadline">${overdue ? '⏰ ' : ''}${today ? '📅 ' : ''}${this.escapeHtml(t.termins || '')}</span>
              <span class="task-row-status">${done ? '✅ PABEIGTS' : '⏳ aktīvs'}</span>
            </div>
            <div class="task-row-text">${this.escapeHtml(t.teksts || '')}</div>
            <div class="task-row-meta">
              <span>👤 ${this.escapeHtml(assignee.trim())}</span>
              <span>🏥 ${this.escapeHtml(client.trim())}</span>
              ${doneBy ? '<span>✓ Izpildīja: ' + this.escapeHtml(doneBy.trim()) + '</span>' : ''}
            </div>
          </div>
          <div class="task-row-actions">
            ${done
              ? '<button class="btn-secondary task-reopen" data-task-id="' + t.id + '">Atvērt atpakaļ</button>'
              : '<button class="btn-secondary task-complete" data-task-id="' + t.id + '">✓ Pabeidza</button>'}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.task-complete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.taskId;
        btn.disabled = true;
        await window.TaskManager.complete(id, this.currentUser.id);
        this.toast('✓ Atzīmēts kā pabeigts');
        await this.renderTasksList();
      });
    });
    container.querySelectorAll('.task-reopen').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.taskId;
        btn.disabled = true;
        await window.TaskManager.reopen(id);
        this.toast('Uzdevums atvērts atpakaļ');
        await this.renderTasksList();
      });
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  async exportExcel() {
    if (typeof XLSX === 'undefined') {
      this.toast('Excel bibliotēka nav ielādēta');
      return;
    }
    const date = document.getElementById('dateFilter').value;
    const clientId = document.getElementById('clientFilter').value;
    if (!clientId) {
      this.toast('Izvēlieties klientu Excel eksportam');
      return;
    }
    const client = this.allClients.find(c => String(c.id || c.ID) === String(clientId));
    if (!client) return;

    try {
      const exporter = new ExcelExporter();
      const year = parseInt(date.split('-')[0]);
      const month = parseInt(date.split('-')[1]);
      const clientMarks = this.allMarks.filter(m => String(m.clientId) === String(clientId));
      const filename = await exporter.generateMonth(client, year, month, clientMarks);
      this.toast('Excel lejupielādēts: ' + filename);
    } catch (err) {
      this.toast('Eksporta kļūda: ' + err.message);
      console.error(err);
    }
  }

  toast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.controlPanel = new ControlPanel();
});
