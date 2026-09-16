const TaskManager = {
  tasks: [],
  lastFetch: 0,
  CACHE_TTL: 0,

  async loadAll(force) {
    if (!force && this.tasks.length > 0 && (Date.now() - this.lastFetch) < this.CACHE_TTL) {
      return this.tasks;
    }
    try {
      const local = await window.careDB.getAll('uzdevomi');
      this.tasks = local || [];
      this.lastFetch = Date.now();
      if (window.careSync && navigator.onLine) {
        window.careSync.sync().catch(() => {});
      }
    } catch (e) {
      this.tasks = [];
    }
    return this.tasks;
  },

  _isTaskCompleted(t) {
    const v = t.irPabeigts;
    return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
  },

  getActiveForEmployee(employeeId, clientId) {
    return this.tasks.filter(t => {
      if (this._isTaskCompleted(t)) return false;
      const assignee = String(t.pieskirtDarbiniekamId || t.employeeId || '');
      if (assignee !== String(employeeId)) return false;
      if (clientId) {
        const taskClient = String(t.klientsId || t.clientId || '');
        if (taskClient && taskClient !== String(clientId)) return false;
      }
      return true;
    }).sort((a, b) => {
      const pa = this.priorityWeight(a.prioritate);
      const pb = this.priorityWeight(b.prioritate);
      if (pa !== pb) return pb - pa;
      const da = new Date(a.termins || a.deadline || 0).getTime();
      const db = new Date(b.termins || b.deadline || 0).getTime();
      return da - db;
    });
  },

  priorityWeight(p) {
    const v = (p || '').toLowerCase();
    if (v === 'augsta' || v === 'high') return 3;
    if (v === 'videja' || v === 'medium') return 2;
    return 1;
  },

  formatDeadline(d) {
    if (!d) return '';
    return TimezoneUtils.formatDateRiga(d);
  },

  isOverdue(d) {
    const today = TimezoneUtils.getTodayRiga();
    const dd = this.formatDeadline(d);
    return dd && dd < today;
  },

  isToday(d) {
    const today = TimezoneUtils.getTodayRiga();
    return this.formatDeadline(d) === today;
  },

  _creating: false,

  async create(taskData) {
    if (this._creating) return null;
    this._creating = true;
    try {
      const record = {
        id: 't_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        teksts: taskData.teksts || '',
        klientsId: taskData.klientsId || '',
        pieskirtDarbiniekamId: taskData.pieskirtDarbiniekamId || '',
        termins: taskData.termins || '',
        prioritate: taskData.prioritate || 'videja',
        statuss: 'jauns',
        irPabeigts: false,
        izveidots: TimezoneUtils.getDateTimeRiga(),
        izveidotajsId: taskData.izveidotajsId || '',
        pabeigtsLaiks: null,
        pabeigtajsId: null
      };
    await window.careDB.put('uzdevomi', record);
    this.tasks.push(record);
    if (window.careSync) {
      window.careSync.enqueueChange({
        action: 'createTask',
        table: 'uzdevomi',
        data: {
          id: record.id,
          teksts: record.teksts,
          klientsId: record.klientsId,
          pieskirtDarbiniekamId: record.pieskirtDarbiniekamId,
          termins: record.termins,
          prioritate: record.prioritate,
          statuss: record.statuss,
          irPabeigts: record.irPabeigts,
        izveidotajsId: record.izveidotajsId,
        // actionId sinhronizācijai — novērš duplikātus uzdevumu izveidē
        actionId: 'create_' + record.id
        }
      });
    }
      this._notifyListeners();
      return record;
    } finally {
      this._creating = false;
    }
  },

  _completing: false,

  async complete(taskId, employeeId) {
    if (this._completing) return null;
    const task = this.tasks.find(t => String(t.id) === String(taskId));
    if (!task) return null;
    if (this._isTaskCompleted(task)) return null;
    this._completing = true;
    try {
    task.irPabeigts = true;
    task.statuss = 'pabeigts';
    task.pabeigtsLaiks = TimezoneUtils.getDateTimeRiga();
    task.pabeigtajsId = employeeId;
    await window.careDB.put('uzdevomi', task);
    if (window.careSync) {
      window.careSync.enqueueChange({
        action: 'updateTask',
        table: 'uzdevomi',
        data: {
          id: task.id,
          irPabeigts: true,
          statuss: 'pabeigts',
          pabeigtsLaiks: task.pabeigtsLaiks,
          pabeigtajsId: employeeId,
          // actionId sinhronizācijai — novērš duplikātus uzdevumu pabeigšanā
          actionId: 'complete_' + task.id + '_' + employeeId
        }
      });
    }
    this._notifyListeners();
    return task;
    } finally {
      this._completing = false;
    }
  },

  async reopen(taskId) {
    const task = this.tasks.find(t => String(t.id) === String(taskId));
    if (!task) return null;
    task.irPabeigts = false;
    task.statuss = 'jauns';
    task.pabeigtsLaiks = null;
    task.pabeigtajsId = null;
    await window.careDB.put('uzdevomi', task);
    if (window.careSync) {
      window.careSync.enqueueChange({
        action: 'updateTask',
        table: 'uzdevomi',
        data: {
          id: task.id,
          irPabeigts: false,
          statuss: 'jauns',
          pabeigtsLaiks: null,
          pabeigtajsId: null,
          actionId: 'reopen_' + task.id + '_' + Date.now()
        }
      });
    }
    this._notifyListeners();
    return task;
  },

  _listeners: [],
  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(l => l !== fn);
    };
  },
  _notifyListeners() {
    this._listeners.forEach(fn => {
      try { fn(this.tasks); } catch (e) { console.error('[tasks] listener error', e); }
    });
  },

  renderBadge(currentUser, options) {
    options = options || {};
    const active = this.getActiveForEmployee(currentUser.id, options.clientId || null);
    if (active.length === 0) return '';
    const overdue = active.filter(t => this.isOverdue(t.termins)).length;
    const today = active.filter(t => this.isToday(t.termins)).length;
    const total = active.length;
    const priorityClass = overdue > 0 ? 'urgent' : (today > 0 ? 'today' : 'normal');
    const priorityIcon = overdue > 0 ? '🔴' : (today > 0 ? '🟡' : '🔵');
    return `
      <div class="task-badge task-badge-${priorityClass}">
        <span class="task-badge-icon">${priorityIcon}</span>
        <span class="task-badge-text">
          <strong>${total} uzdevums${total === 1 ? '' : 'i'}</strong>
          ${overdue > 0 ? '<br><small>' + overdue + ' nokavēts</small>' : ''}
          ${today > 0 ? '<br><small>' + today + ' šodien</small>' : ''}
        </span>
        ${options.clickable !== false ? '<span class="task-badge-arrow">›</span>' : ''}
      </div>
    `;
  },

  async renderBanner(currentUser, clientId) {
    const active = this.getActiveForEmployee(currentUser.id, clientId || null);
    if (active.length === 0) return '';
    const clients = await window.careDB.getAll('klienti');
    const clientMap = {};
    clients.forEach(c => {
      const id = c.id || c.ID;
      const name = ((c.vards || c.Vārds || '') + ' ' + (c.uzvards || c.Uzvārds || '')).trim();
      clientMap[String(id)] = name;
    });
    const employees = await window.careDB.getAll('darbinieki');
    const employeeMap = {};
    employees.forEach(e => {
      const id = e.id || e.ID;
      const name = ((e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '')).trim();
      employeeMap[String(id)] = name;
    });
    const items = active.map(t => {
      const dd = this.formatDeadline(t.termins);
      const overdue = this.isOverdue(t.termins);
      const today = this.isToday(t.termins);
      const priorityLabel = { augsta: '🔴 AUGSTA', videja: '🟡 VIDĒJA', zema: '🟢 ZEMA' };
      const pr = priorityLabel[(t.prioritate || '').toLowerCase()] || t.prioritate;
      const tcid = t.klientsId || t.clientId;
      const cname = tcid ? (clientMap[String(tcid)] || 'ID: ' + tcid) : 'VISPĀRĪGS';
      const assigneeId = t.pieskirtDarbiniekamId || t.employeeId;
      const assigneeName = assigneeId ? (employeeMap[String(assigneeId)] || 'ID: ' + assigneeId) : '—';
      return `
        <div class="task-item ${overdue ? 'overdue' : ''} ${today ? 'today' : ''}">
          <div class="task-item-header">
            <span class="task-priority">${pr}</span>
            <span class="task-deadline">${overdue ? '⏰ NOKAVĒTS: ' : (today ? '📅 Šodien, ' : 'Līdz ')} ${dd}</span>
          </div>
          <div class="task-client">🏥 ${this.escapeHtml(cname)}</div>
          <div class="task-assignee">👤 ${this.escapeHtml(assigneeName)}</div>
          <div class="task-text">${this.escapeHtml(t.teksts || '')}</div>
          <button class="task-complete-btn" data-task-id="${t.id}">✓ Izdarīju</button>
        </div>
      `;
    }).join('');
    return `
      <div class="task-banner">
        <div class="task-banner-header">
          📋 <strong>Uzdevumi no kontroles (${active.length})</strong>
        </div>
        ${items}
      </div>
    `;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.TaskManager = TaskManager;
}

if (typeof window !== 'undefined') {
  window.addEventListener('syncComplete', () => {
    TaskManager.invalidateCache();
  });
}

TaskManager.invalidateCache = function() {
  this.tasks = [];
  this.lastFetch = 0;
};
