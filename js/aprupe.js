class AprupeController {
  constructor() {
    this.db = null;
    this.sync = null;
    this.clients = [];
    this.filteredClients = [];
    this.currentUser = null;
    this.todayMarks = new Map();
    this.selectedClientId = null;
    this.visibleTasks = [];
    this.newTaskCount = 0;
    this.dismissedNewTaskIds = new Set();
    this.init();
  }

  async init() {
    const userData = sessionStorage.getItem('careUser');
    if (!userData) {
      window.location.href = 'index.html';
      return;
    }

    this.currentUser = JSON.parse(userData);
    this.adminMode = sessionStorage.getItem('careAdminMode') === 'true';

    this.db = new CareDB();
    await this.db.init();
    window.careDB = this.db;
    this.sync = new CareSync(this.db, CONFIG);
    window.careSync = this.sync;

    const roleLabels = { 'aprūpētājs': t('roleAprupetajs'), 'kontroliere': t('roleKontroliere'), 'administrators': t('roleAdmin') };
    const role = roleLabels[(this.currentUser.loma || '').toLowerCase()] || this.currentUser.loma || '';
    const fname = this.currentUser.vards || '';
    const lname = this.currentUser.uzvards || '';
    const labelEl = document.getElementById('currentUserLabel');
    if (labelEl) {
      const fullName = [fname, lname].filter(x => x).join(' ');
      if (role && fullName) {
        labelEl.textContent = role + ': ' + fullName;
      } else if (role) {
        labelEl.textContent = role;
      } else if (fullName) {
        labelEl.textContent = fullName;
      } else {
        labelEl.textContent = 'Aprūpētājs';
      }
    }

    const syncStatusEl = document.getElementById('syncStatus');
    window.addEventListener('syncStatusChange', (e) => {
      if (!syncStatusEl) return;
      syncStatusEl.textContent = e.detail;
      syncStatusEl.className = 'sync-badge ' + e.detail.replace(/ /g, '-');
    });

    // syncComplete listener — ielādē klientus pēc sync
    window.addEventListener('syncComplete', async (e) => {
      const result = e.detail;
      if (result && !result.offline) {
        await this.loadClients();
        this.filteredClients = [...this.clients];
        this.renderCards();
        await this.renderTasksTable(this.selectedClientId || null);
      }
    });

    // Manual sync button handler
    const manualSyncBtn = document.getElementById('manualSyncBtn');
    if (manualSyncBtn) {
      manualSyncBtn.style.display = navigator.onLine ? 'inline-flex' : 'none';
      window.addEventListener('online', () => manualSyncBtn.style.display = 'inline-flex');
      window.addEventListener('offline', () => manualSyncBtn.style.display = 'none');
      manualSyncBtn.addEventListener('click', async () => {
        if (!navigator.onLine) {
          this.toast && this.toast(t('offline'));
          return;
        }
        manualSyncBtn.disabled = true;
        manualSyncBtn.innerHTML = '<span>⏳</span> <span data-i18n="syncing">Sinhronizē...</span>';
        try {
          const result = await this.sync.forceFullSync((msg) => {
            if (loadingText) loadingText.textContent = msg;
          });
          if (result.offline) {
            this.toast && this.toast('⚠️ ' + (result.error || 'Sinhronizācija neizdevās'), 4000);
          } else {
            await Promise.all([
              this.loadClients(),
              this.loadTodayMarks()
            ]);
              this.filteredClients = [...this.clients];
             this.renderCards();
             await this.renderTasksTable(this.selectedClientId || null);
            this.toast && this.toast('✅ Sinhronizācija pabeigta. Visi dati atjaunoti no Google Sheets.');
          }
        } catch (err) {
          this.toast && this.toast('⚠️ Kļūda: ' + err.message, 4000);
        } finally {
          manualSyncBtn.disabled = false;
          manualSyncBtn.innerHTML = '<span>🔄</span> <span data-i18n="syncBtn">Sinhronizēt</span>';
          if (typeof applyLanguage === 'function') applyLanguage();
        }
      });
    }

    const adminBanner = document.getElementById('adminModeBanner');
    if (adminBanner) {
      adminBanner.style.display = this.adminMode ? 'block' : 'none';
    }

    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (this.adminMode) {
          window.location.href = 'admin.html';
        } else {
          window.location.href = 'aprupe.html';
        }
      });
    }

    this.setupSearch();
    this.setupLanguageSwitcher();

    // Task detail modal close handlers
    const taskDetailOverlay = document.getElementById('taskDetailOverlay');
    const taskDetailClose = document.getElementById('taskDetailClose');
    const taskDetailCloseBtn = document.getElementById('taskDetailCloseBtn');
    if (taskDetailClose) {
      taskDetailClose.addEventListener('click', () => this.closeTaskDetail());
    }
    if (taskDetailCloseBtn) {
      taskDetailCloseBtn.addEventListener('click', () => this.closeTaskDetail());
    }
    if (taskDetailOverlay) {
      taskDetailOverlay.addEventListener('click', (e) => {
        if (e.target === taskDetailOverlay) this.closeTaskDetail();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeTaskDetail();
    });

    const clearFilterBtn = document.getElementById('clearFilterBtn');
    if (clearFilterBtn) {
      clearFilterBtn.addEventListener('click', () => {
        this.clearClientFilter();
      });
    }

    const newTaskAlertBtn = document.getElementById('newTaskAlertBtn');
    const newTaskAlertClose = document.getElementById('newTaskAlertClose');
    const newTaskAlert = document.getElementById('newTaskAlert');
    if (newTaskAlertBtn) {
      newTaskAlertBtn.addEventListener('click', () => {
        this.dismissNewTaskAlert();
        const tasksSection = document.getElementById('tasksSection');
        if (tasksSection) tasksSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (newTaskAlertClose && newTaskAlert) {
      newTaskAlertClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissNewTaskAlert();
      });
    }

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
          this.toast && this.toast('Kļūda: ' + e.message, 4000);
          retryBtn.disabled = false;
          retryBtn.textContent = t('retryLoad');
        }
      };
    }

    try {
      await Promise.all([
        this.loadClients(),
        this.loadTodayMarks()
      ]);
      this.filteredClients = [...this.clients];
      this.renderCards();

      const syncResult = await this.sync.loadInitialData((msg) => {
        if (loadingText) loadingText.textContent = msg;
      });
      await Promise.all([
        this.loadClients(),
        this.loadTodayMarks()
      ]);
      this.filteredClients = [...this.clients];
      this.renderCards();
      await this.renderTasksTable();
    } catch (e) {
      console.error(e);
      if (retryBtn) {
        retryBtn.style.display = 'block';
      }
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  }

  async renderTasksTable(clientId) {
    const tbody = document.getElementById('tasksTableBody');
    if (!tbody || !window.TaskManager || !this.currentUser) {
      if (!window.TaskManager) console.warn('[aprupe] TaskManager nav pieejams');
      if (!this.currentUser) console.warn('[aprupe] currentUser nav ielogījies');
      return;
    }

    await window.TaskManager.loadAll();
    const allTasks = window.TaskManager.tasks || [];
    const currentUserId = String(this.currentUser.id || this.currentUser.ID || '');

    const userTasks = allTasks.filter(t => {
      const assignee = String(t.pieskirtDarbiniekamId || t.employeeId || '');
      if (assignee !== currentUserId) return false;
      if (clientId) {
        const taskClientId = String(t.klientsId || t.clientId || '');
        if (taskClientId !== String(clientId)) return false;
      }
      return true;
    }).sort((a, b) => {
      const pa = window.TaskManager.priorityWeight(a.prioritate);
      const pb = window.TaskManager.priorityWeight(b.prioritate);
      if (pa !== pb) return pb - pa;
      const ad = window.TaskManager._isTaskCompleted(a) ? 1 : 0;
      const bd = window.TaskManager._isTaskCompleted(b) ? 1 : 0;
      if (ad !== bd) return ad - bd;
      return (a.termins || '').localeCompare(b.termins || '');
    });

    this.visibleTasks = userTasks;
    this.updateNewTaskAlert(userTasks);

    if (userTasks.length === 0 && allTasks.length > 0) {
      const uniqueAssignees = [...new Set(allTasks.map(t => String(t.pieskirtDarbiniekamId || t.employeeId || '')))];
      if (!uniqueAssignees.includes(currentUserId)) {
        console.debug('[aprupe] tasks not matching current user', currentUserId);
      }
    }

    if (userTasks.length === 0) {
      tbody.innerHTML = '<tr class="tasks-empty-row"><td colspan="8" class="loading" data-i18n="noClientTasks">Jums pašlaik nav aktīvu uzdevumu.</td></tr>';
      if (typeof applyLanguage === 'function') applyLanguage();
      return;
    }

    const clients = await this.db.getAll('klienti');
    const clientMap = {};
    clients.forEach(c => {
      const id = c.id || c.ID;
      const name = ((c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '')).trim();
      clientMap[String(id)] = name;
    });
    this.clientMap = clientMap;

    const employees = await this.db.getAll('darbinieki');
    const employeeMap = {};
    employees.forEach(e => {
      const id = e.id || e.ID;
      const name = ((e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '')).trim();
      employeeMap[String(id)] = name;
    });
    this.employeeMap = employeeMap;

    const formatDateRiga = (isoString) => {
      if (!isoString) return '';
      return TimezoneUtils.formatDateRiga(isoString);
    };

    const formatDateTimeRiga = (isoString) => {
      if (!isoString) return '';
      return TimezoneUtils.formatDateTimeRiga(isoString);
    };

    const isOverdue = (deadline) => {
      if (!deadline) return false;
      const today = TimezoneUtils.getTodayRiga();
      const formatted = TimezoneUtils.formatDateRiga(deadline);
      return formatted && formatted < today;
    };

    const isToday = (deadline) => {
      if (!deadline) return false;
      const today = TimezoneUtils.getTodayRiga();
      const formatted = TimezoneUtils.formatDateRiga(deadline);
      return formatted === today;
    };

    const getStatusLabel = (task) => {
      if (window.TaskManager._isTaskCompleted(task)) return t('taskCompletedLabel');
      const status = (task.statuss || 'jauns').toLowerCase();
      if (status === 'jauns' || status === 'new') return t('statusNew');
      if (status === 'procesā' || status === 'in_progress') return t('statusInProgress');
      return status;
    };

    const priorityLabels = { augsta: '🔴 ' + t('priorityHigh'), videja: '🟡 ' + t('priorityMedium'), zema: '🟢 ' + t('priorityLow'), high: '🔴 ' + t('priorityHigh'), medium: '🟡 ' + t('priorityMedium'), low: '🟢 ' + t('priorityLow') };

    tbody.innerHTML = userTasks.map(task => {
      const done = window.TaskManager._isTaskCompleted(task);
      const deadline = task.termins;
      const deadlineDisplay = formatDateRiga(deadline);
      const priority = (task.prioritate || 'videja').toLowerCase();
      const priorityLabel = priorityLabels[priority] || priority;
      const priorityClass = priority === 'augsta' || priority === 'high' ? 'high' : (priority === 'zema' || priority === 'low' ? 'low' : 'medium');
      const overdue = isOverdue(deadline) && !done;
      const today = isToday(deadline) && !done;
      const rowClass = done ? 'task-completed' : (overdue ? 'task-overdue' : (today ? 'task-today' : ''));
      const statusLabel = getStatusLabel(task);
      const btnText = done ? t('taskMarkDoneDone') : t('taskMarkDone');
      const btnDisabled = done ? 'disabled' : '';
      const btnClass = done ? 'completed' : '';
      const taskText = task.teksts || '';
      const taskClientId = String(task.klientsId || task.clientId || '');
      const clientName = taskClientId ? (clientMap[taskClientId] || 'ID: ' + taskClientId) : '—';
      const completedDisplay = task.pabeigtsLaiks ? formatDateTimeRiga(task.pabeigtsLaiks) : (done ? '—' : '');
      return `
        <tr class="task-row-clickable ${rowClass}" data-task-id="${task.id}">
          <td class="task-description task-click-cell" title="${this.escapeHtml(taskText)}">${this.escapeHtml(taskText)}</td>
          <td class="task-client task-click-cell">${this.escapeHtml(clientName)}</td>
          <td class="task-deadline task-click-cell">${this.escapeHtml(deadlineDisplay)}${overdue ? ' ⏰' : (today ? ' 📅' : '')}</td>
          <td class="task-click-cell"><span class="task-priority ${priorityClass}">${this.escapeHtml(priorityLabel)}</span></td>
          <td class="task-status task-click-cell">${this.escapeHtml(statusLabel)}</td>
          <td class="task-created task-click-cell">${this.escapeHtml(formatDateTimeRiga(task.created || task.izveidots))}</td>
          <td class="task-completed task-click-cell">${this.escapeHtml(completedDisplay)}</td>
          <td class="task-buttons-cell">
            <button class="task-detail-btn" data-task-id="${task.id}" title="Detaļas">ℹ️</button>
            <button class="task-complete-btn ${btnClass}" data-task-id="${task.id}" ${btnDisabled}>${btnText}</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.task-row-clickable').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.task-complete-btn') || e.target.closest('.task-detail-btn')) return;
        const taskId = row.dataset.taskId;
        this.openTaskDetail(taskId);
      });
    });

    tbody.querySelectorAll('.task-detail-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const taskId = btn.dataset.taskId;
        this.openTaskDetail(taskId);
      });
    });

    tbody.querySelectorAll('.task-complete-btn:not(.completed)').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const taskId = btn.dataset.taskId;
        btn.disabled = true;
        btn.textContent = '⏳ Saglabā...';
        await window.TaskManager.complete(taskId, this.currentUser.id);
        this.toast && this.toast(t('taskMarkedDone'));
        await this.renderTasksTable(this.selectedClientId);
      });
    });

    if (typeof applyLanguage === 'function') {
      applyLanguage();
      this.updateNewTaskAlert(this.visibleTasks);
    }
  }

  dismissNewTaskAlert() {
    const newTasks = (this.visibleTasks || []).filter(task => {
      if (!task) return false;
      if (window.TaskManager && typeof window.TaskManager._isTaskCompleted === 'function' && window.TaskManager._isTaskCompleted(task)) return false;
      const status = String(task.statuss || '').toLowerCase();
      return status === 'jauns' || status === 'new';
    });
    newTasks.forEach(task => {
      const taskId = this._getTaskId(task);
      if (taskId) this.dismissedNewTaskIds.add(taskId);
    });
    const alert = document.getElementById('newTaskAlert');
    if (alert) alert.hidden = true;
    this.newTaskCount = 0;
  }

  _getTaskId(task) {
    return task.id || task.ID || null;
  }

  updateNewTaskAlert(tasks) {
    const alert = document.getElementById('newTaskAlert');
    const text = document.getElementById('newTaskAlertText');
    if (!alert || !text) return;

    const allTasks = tasks || this.visibleTasks || [];
    const newTasks = allTasks.filter(task => {
      if (!task) return false;
      if (window.TaskManager && typeof window.TaskManager._isTaskCompleted === 'function' && window.TaskManager._isTaskCompleted(task)) return false;
      const status = String(task.statuss || '').toLowerCase();
      return status === 'jauns' || status === 'new';
    });

    const unseenNewTasks = newTasks.filter(task => {
      const taskId = this._getTaskId(task);
      return taskId ? !this.dismissedNewTaskIds.has(taskId) : true;
    });

    const count = unseenNewTasks.length;
    this.newTaskCount = count;

    if (count === 0) {
      alert.hidden = true;
      return;
    }

    text.textContent = count === 1 ? t('newTaskAlert') : t('newTasksAlert').replace('{count}', String(count));
    alert.hidden = false;
  }

  openTaskDetail(taskId) {
    const allTasks = window.TaskManager && window.TaskManager.tasks ? window.TaskManager.tasks : [];
    const task = allTasks.find(t => String(t.id) === String(taskId));
    if (!task) {
      this.toast && this.toast('Uzdevums nav atrasts');
      return;
    }

    const done = window.TaskManager._isTaskCompleted(task);
    const deadline = task.termins;
    const deadlineDisplay = TimezoneUtils.formatDateRiga(deadline);
    const priority = (task.prioritate || 'videja').toLowerCase();
    const priorityLabels = { augsta: '🔴 Augsta', videja: '🟡 Vidēja', zema: '🟢 Zema', high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' };
    const priorityLabel = priorityLabels[priority] || priority;
    const overdue = TimezoneUtils.formatDateRiga(deadline) && TimezoneUtils.formatDateRiga(deadline) < TimezoneUtils.getTodayRiga() && !done;
    const today = TimezoneUtils.formatDateRiga(deadline) === TimezoneUtils.getTodayRiga() && !done;

    const statusLabel = done ? t('taskCompletedLabel') : ((task.statuss || 'jauns').toLowerCase() === 'jauns' ? t('statusNew') : ((task.statuss || '').toLowerCase() === 'procesā' ? t('statusInProgress') : (task.statuss || 'jauns')));

    const taskClientId = String(task.klientsId || task.clientId || '');
    const clientName = taskClientId ? (this.clientMap ? (this.clientMap[taskClientId] || 'ID: ' + taskClientId) : 'ID: ' + taskClientId) : '—';

    const assigneeId = String(task.pieskirtDarbiniekamId || task.employeeId || '');
    const employeeName = assigneeId ? (this.employeeMap ? (this.employeeMap[assigneeId] || 'ID: ' + assigneeId) : 'ID: ' + assigneeId) : '—';

    const createdDisplay = TimezoneUtils.formatDateTimeRiga(task.created || task.izveidots);
    const completedDisplay = task.pabeigtsLaiks ? TimezoneUtils.formatDateTimeRiga(task.pabeigtsLaiks) : '';

    const overlay = document.getElementById('taskDetailOverlay');
    const completeBtn = document.getElementById('taskDetailCompleteBtn');
    if (!overlay) return;

    document.getElementById('taskDetailText').textContent = task.teksts || '';
    document.getElementById('taskDetailClient').textContent = clientName;
    document.getElementById('taskDetailDeadline').innerHTML = this.escapeHtml(deadlineDisplay) + (overdue ? ' ⏰ Nokavēts' : (today ? ' 📅 Šodien' : ''));
    document.getElementById('taskDetailPriority').innerHTML = this.escapeHtml(priorityLabel);
    document.getElementById('taskDetailStatus').textContent = statusLabel;
    document.getElementById('taskDetailCreated').textContent = createdDisplay;
    document.getElementById('taskDetailAction').textContent = done ? '✅ Izpildīts' : '✓ Izpildīt';

    const completedSection = document.getElementById('taskDetailCompletedSection');
    if (completedSection) {
      if (done && completedDisplay) {
        completedSection.style.display = 'block';
        document.getElementById('taskDetailCompleted').textContent = completedDisplay;
      } else {
        completedSection.style.display = 'none';
      }
    }

    const assigneeSection = document.getElementById('taskDetailAssigneeSection');
    if (assigneeSection) {
      if (assigneeId) {
        assigneeSection.style.display = 'block';
        document.getElementById('taskDetailAssignee').textContent = employeeName;
      } else {
        assigneeSection.style.display = 'none';
      }
    }

    if (completeBtn) {
      if (done) {
        completeBtn.textContent = t('taskMarkDoneDone');
        completeBtn.classList.add('completed');
        completeBtn.disabled = true;
      } else {
        completeBtn.textContent = t('taskMarkDone');
        completeBtn.classList.remove('completed');
        completeBtn.disabled = false;
      }
    }

    completeBtn.onclick = async () => {
      if (done) return;
      completeBtn.disabled = true;
      completeBtn.textContent = '⏳ Saglabā...';
      await window.TaskManager.complete(taskId, this.currentUser.id);
      this.toast && this.toast(t('taskMarkedDone'));
      this.closeTaskDetail();
      await this.renderTasksTable(this.selectedClientId);
    };

    overlay.style.display = 'flex';
  }

  closeTaskDetail() {
    const overlay = document.getElementById('taskDetailOverlay');
    if (overlay) overlay.style.display = 'none';
  }
  setupSearch() {
    const searchBox = document.getElementById('searchBox');
    const searchCount = document.getElementById('searchCount');

    searchBox.addEventListener('input', (e) => {
      const term = e.target.value.trim().toLowerCase();
      this.filterClients(term);
      this.renderCards();
      if (term) {
        searchCount.textContent = this.filteredClients.length + t('clientsFound');
      } else {
        searchCount.textContent = this.clients.length + t('clientsTotal');
      }
    });

    searchBox.focus();
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
      this.updateNewTaskAlert(this.visibleTasks);
    }
  }

  async loadClients() {
    this.clients = await this.db.getAll(CONFIG.STORES.KLIENTI);
    this.clients = this.clients.filter(c => {
      const aktivs = c.aktivs;
      // Default to active if aktivs is missing (legacy clients without this column)
      if (aktivs === undefined || aktivs === null || aktivs === '') return true;
      const a = String(aktivs).toLowerCase();
      return a === 'true' || a === '1' || aktivs === true || aktivs === 1;
    });
    this.clients.sort((a, b) => {
      const aName = ((a.uzvards || a.Uzvārds || '') + ' ' + (a.vards || a.Vārds || '')).toLowerCase();
      const bName = ((b.uzvards || b.Uzvārds || '') + ' ' + (b.vards || b.Vārds || '')).toLowerCase();
      return aName.localeCompare(bName);
    });
  }

  async loadTodayMarks() {
    const today = this.todayLocal();
    const allMarks = await this.db.getAll(CONFIG.STORES.ATZIMES);
    const todayMarks = allMarks.filter(m => this.isRecent(m, today));

    this.todayMarks.clear();
    todayMarks.forEach(mark => {
      const cid = mark.clientId || mark.klients_id || mark.klientsId;
      const key = cid + '|' + mark.category + '|' + mark.field;
      this.todayMarks.set(key, mark);
    });

    const signedClients = new Set();
    todayMarks.forEach(m => {
      if (m.category === 'paraksts') {
        const cid = m.clientId || m.klients_id || m.klientsId;
        signedClients.add(cid);
      }
    });
    this.signedToday = signedClients;
  }

  isRecent(m, today) {
    const primary = [
      this.extractDate(m.pedeja_laiks),
      this.extractDate(m.lastModified),
      this.extractDate(m.created),
      this.extractDate(m.izveidots)
    ].filter(Boolean);
    if (primary.length === 0) {
      const fallback = [
        this.extractDate(m.date),
        this.extractDate(m.datums)
      ].filter(Boolean);
      if (fallback.length === 0) return true;
      if (fallback.includes(today)) return true;
      for (let i = 1; i <= 7; i++) {
        if (fallback.includes(this.offsetLocal(-i))) return true;
      }
      return false;
    }
    if (primary.includes(today)) return true;
    for (let i = 1; i <= 7; i++) {
      if (primary.includes(this.offsetLocal(-i))) return true;
    }
    return false;
  }

  todayLocal() {
    return TimezoneUtils.getTodayRiga();
  }

  offsetLocal(days) {
    return TimezoneUtils.offsetDaysRiga(days);
  }

  extractDate(v) {
    return TimezoneUtils.formatDateRiga(v);
  }

  filterClients(term) {
    if (!term) {
      this.filteredClients = [...this.clients];
      return;
    }

    const lowerTerm = term.toLowerCase();
    this.filteredClients = this.clients.filter(client => {
      const vards = (client.vards || client.Vārds || '').toLowerCase();
      const uzvards = (client.uzvards || client.Uzvārds || '').toLowerCase();
      const id = String(client.id || client.ID || '');
      return vards.includes(lowerTerm) || uzvards.includes(lowerTerm) || id.toLowerCase().includes(lowerTerm);
    });
  }

  getClientStatus(clientId) {
    const marks = Array.from(this.todayMarks.values()).filter(m => {
      const cid = m.clientId || m.klients_id || m.klientsId;
      return cid === clientId;
    });

    if (this.signedToday && this.signedToday.has(clientId)) {
      return { text: 'Pabeigts', class: 'status-complete' };
    }

    if (marks.length > 0) {
      return { text: marks.length + ' atzīmes', class: 'status-pending' };
    }

    return { text: 'Nav atzīmēts', class: 'status-not-started' };
  }

  renderCards() {
    console.log('[aprupe] renderCards: clients =', this.clients.length, 'filteredClients =', this.filteredClients.length);
    const grid = document.getElementById('clientGrid');
    if (this.filteredClients.length === 0 && this.clients.length === 0) {
      grid.innerHTML = '<div class="loading">Nav klientu datu. Pārbaudiet internetu.</div>';
      return;
    }

    if (this.filteredClients.length === 0) {
      grid.innerHTML = '<div class="client-not-found">Klients nav atrasts</div>';
      return;
    }

    const today = this.todayLocal();
    const currentUserId = String(this.currentUser.id || this.currentUser.ID || '');

    grid.innerHTML = this.filteredClients.map(client => {
      const id = client.id || client.ID;
      const vards = client.vards || client.Vārds || '';
      const uzvards = client.uzvards || client.Uzvārds || '';
      const dzimis = client.dzimis || client['Dzimšanas datums'] || client.dzimsans_datums || client.birth_date || '';
      const dieta = client.dieta || client.Diēta || '';
      const saskarsmes = client.saskarsmes || client['Saskarsmes īpatnības'] || '';

      const status = this.getClientStatus(id);
      const age = this.calculateAge(dzimis);
      const displayName = vards + ' ' + uzvards;

      let statusText = status.text;
      let statusClass = status.class;
      if (this.signedToday && this.signedToday.has(id)) {
        statusText = 'Pabeigts';
        statusClass = 'status-complete';
      }

      const teamCount = this.getTeamCount(id);
      const teamHtml = teamCount > 0
        ? '<div class="client-team">👥 ' + teamCount + (teamCount === 1 ? ' kolēģis' : ' kolēģi') + ' strādāja</div>'
        : '<div class="client-team" style="color:#999;">Nav komandas darba vēl</div>';

      const ageText = age ? (age + ' gadi') : 'Vecums nav norādīts';
      const clientInfo = dieta ? (ageText + ', ' + dieta) : ageText;

      const isHospital = (client.slimnica === true || client.slimnica === 'true' || client.slimnica === 1 || client.slimnica === '1' || client['Slimnīcā'] === true || client['Slimnīcā'] === 'true' || client['Slimnīcā'] === 1 || client['Slimnīcā'] === '1') || String(client.statuss || '').toUpperCase() === 'SLIMNĪCĀ';
      const hospitalBadge = isHospital ? '<span class="hospital-badge">🏥 Slimnīcā</span>' : '';

      return `
        <div class="client-card ${this.selectedClientId === String(id) ? 'selected' : ''} ${isHospital ? 'hospital' : ''}" data-client-id="${id}" data-client-name="${this.escapeHtml(displayName)}">
          <div>
            <div class="client-card-name">${this.escapeHtml(vards)} ${this.escapeHtml(uzvards)} ${hospitalBadge}</div>
            <div class="client-card-dob">${this.escapeHtml(clientInfo)}</div>
            ${teamHtml}
          </div>
          <div class="client-card-status">
            <span class="status-indicator ${statusClass}"></span>
            ${statusText}
          </div>
          <button class="open-btn" onclick="event.stopPropagation(); window.location.href='aprupetajs.html?client=${id}'">Atvērt</button>
        </div>
      `;
    }).join('');

    const searchCount = document.getElementById('searchCount');
    if (searchCount) {
      const searchBox = document.getElementById('searchBox');
      const term = searchBox ? searchBox.value.trim().toLowerCase() : '';
      if (term) {
        searchCount.textContent = this.filteredClients.length + t('clientsFound');
      } else {
        searchCount.textContent = this.clients.length + t('clientsTotal');
      }
    }

    grid.querySelectorAll('.client-card').forEach(card => {
      card.addEventListener('click', () => {
        this.selectClient(card.dataset.clientId, card.dataset.clientName);
      });
    });
  }

  selectClient(clientId, clientName) {
    this.selectedClientId = String(clientId);
    this.renderCards();
    this.renderTasksTable(this.selectedClientId);
    this.updateFilterBadge(clientName);
  }

  clearClientFilter() {
    this.selectedClientId = null;
    this.renderCards();
    this.renderTasksTable(null);
    const badge = document.getElementById('clientFilterBadge');
    if (badge) badge.style.display = 'none';
  }

  updateFilterBadge(clientName) {
    const badge = document.getElementById('clientFilterBadge');
    const nameEl = document.getElementById('filterClientName');
    if (badge && nameEl) {
      nameEl.textContent = clientName;
      badge.style.display = 'block';
    }
  }

  getTeamCount(clientId) {
    const marks = Array.from(this.todayMarks.values()).filter(m => {
      const cid = m.clientId || m.klients_id || m.klientsId;
      return cid === clientId;
    });
    const uniq = new Set();
    marks.forEach(m => {
      const eid = m.employeeId || m.darbinieks_id;
      if (eid) uniq.add(String(eid));
    });
    uniq.delete(String(this.currentUser.id));
    return uniq.size;
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

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  toast(message) {
    let toast = document.getElementById('taskToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'taskToast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  logout() {
    sessionStorage.removeItem('careUser');
    sessionStorage.removeItem('careAdminMode');
    window.location.href = 'index.html';
  }
}

document.getElementById('logoutBtn').addEventListener('click', (e) => {
  if (e) e.preventDefault();
  if (window.Logout) {
    Logout.confirm().then((ok) => {
      if (ok) Logout.performLogout();
    });
  } else {
    if (window.aprupeController) window.aprupeController.logout();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  window.aprupeController = new AprupeController();
});
