const Logout = {
  pendingChanges: 0,
  setPending: function(n) {
    this.pendingChanges = Math.max(0, n || 0);
  },
  addPending: function(n) {
    this.pendingChanges = Math.max(0, (this.pendingChanges || 0) + (n || 1));
  },
  clearPending: function() {
    this.pendingChanges = 0;
  },
  getPending: function() {
    return this.pendingChanges || 0;
  },

  confirm: function(opts) {
    opts = opts || {};
    const pending = opts.pending !== undefined ? opts.pending : this.getPending();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'logout-confirm-overlay';
      const hasPending = pending > 0;
      const icon = hasPending ? '⚠️' : '👋';
      const title = hasPending ? 'Ir nesaglabāti dati!' : 'Vai tiešām vēlies iziet?';
      const msg = hasPending
        ? 'Tev pašlaik ir <strong>' + pending + ' nesaglabāts(-i) ieraksts(-i)</strong>. Tie tiks nosūtīti automātiski, bet, ja nav interneta, tie var pazust.<br><br>Vai tiešām vēlies iziet?'
        : 'Visi dati ir saglabāti. Vai tiešām vēlies iziet no sistēmas?';
      overlay.innerHTML = `
        <div class="logout-confirm-card">
          <div class="logout-confirm-icon">${icon}</div>
          <div class="logout-confirm-title">${title}</div>
          <div class="logout-confirm-msg ${hasPending ? 'unsaved' : ''}">${msg}</div>
          <div class="logout-buttons">
            <button class="logout-btn-cancel" data-act="cancel">Palikt</button>
            ${hasPending ? '<button class="logout-btn-sync" data-act="sync">🔄 Sinhronizēt tagad</button>' : ''}
            <button class="logout-btn-confirm" data-act="ok">Jā, iziet</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      let syncInProgress = false;
      overlay.addEventListener('click', async (e) => {
        const act = e.target.dataset && e.target.dataset.act;
        if (act === 'cancel' || e.target === overlay) {
          overlay.remove();
          resolve(false);
        } else if (act === 'sync') {
          if (syncInProgress) return;
          syncInProgress = true;
          const syncBtn = overlay.querySelector('[data-act="sync"]');
          if (syncBtn) {
            syncBtn.disabled = true;
            syncBtn.textContent = '⏳ Sinhronizē...';
          }
          try {
            if (window.careSync && typeof window.careSync.forceFullSync === 'function') {
              await window.careSync.forceFullSync();
            } else if (window.careSync && typeof window.careSync.sync === 'function') {
              await window.careSync.sync();
            }
            // Re-check pending
            let remaining = 0;
            if (window.careSync && typeof window.careSync.getUnsyncedCount === 'function') {
              remaining = await window.careSync.getUnsyncedCount();
            }
            if (remaining === 0) {
              overlay.remove();
              resolve(true); // Allow logout after successful sync
            } else {
              // Update message
              const msgEl = overlay.querySelector('.logout-confirm-msg');
              if (msgEl) {
                msgEl.innerHTML = '✅ Sinhronizācija pabeigta. Visi dati saglabāti Google Sheets.<br><br>Vai tiešām vēlies iziet?';
                msgEl.classList.remove('unsaved');
              }
              const titleEl = overlay.querySelector('.logout-confirm-title');
              if (titleEl) titleEl.textContent = 'Dati sinhronizēti!';
              const iconEl = overlay.querySelector('.logout-confirm-icon');
              if (iconEl) iconEl.textContent = '✅';
              if (syncBtn) {
                syncBtn.remove();
              }
            }
          } catch (err) {
            const msgEl = overlay.querySelector('.logout-confirm-msg');
            if (msgEl) {
              msgEl.innerHTML = '⚠️ Sinhronizācija neizdevās: ' + err.message + '<br><br>Vai tiešām vēlies iziet?';
              msgEl.classList.add('unsaved');
            }
            if (syncBtn) {
              syncBtn.disabled = false;
              syncBtn.textContent = '🔄 Mēģināt vēlreiz';
            }
          } finally {
            syncInProgress = false;
          }
        } else if (act === 'ok') {
          overlay.remove();
          resolve(true);
        }
      });
    });
  },

  performLogout: function() {
    const user = (() => {
      try { return JSON.parse(sessionStorage.getItem('careUser') || 'null'); } catch (e) { return null; }
    })();
    const fname = (user && (user.vards || '')) || 'draugs';
    const compliments = [
      'Paldies par darbu, ' + fname + '! 🌟',
      'Tu esi fantastisks, ' + fname + '! 💪',
      'Labi, ka rūpējies par klientiem! 🤝',
      'Veiksmīgu dienas turpinājumu, ' + fname + '! ☀️',
      'Tu esi super, ' + fname + '! ✨',
      'Paldies, ka esi lielisks komandas loceklis! 💙',
      'Cieņā un pateicībā par Tavu darbu! 🙏',
      'Atpūties un uz tikšanos! 🌻',
      'Tava darba devums ir nenovērtējams! 🙌',
      'Lai jauka diena, ' + fname + '! 🌈'
    ];
    const msg = compliments[Math.floor(Math.random() * compliments.length)];

    const goodbye = document.createElement('div');
    goodbye.className = 'logout-goodbye-overlay';
    goodbye.innerHTML = `
      <div class="logout-goodbye-emoji">🌻</div>
      <div class="logout-goodbye-msg">${msg}</div>
      <div class="logout-goodbye-sub">Uz drīzu tikšanos!</div>
    `;
    document.body.appendChild(goodbye);

    setTimeout(() => {
      try {
        if (window.careSync && typeof window.careSync.sync === 'function') {
          window.careSync.sync();
        }
      } catch (e) {}
      sessionStorage.removeItem('careUser');
      sessionStorage.removeItem('careAdminMode');
      this.clearPending();
      window.location.href = 'index.html';
    }, 1800);
  },

  attach: function(buttonEl, opts) {
    if (!buttonEl) return;
    buttonEl.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      // Pirms pārbaudes - tīra rindu, lai novērstu false positive brīdinājumus
      try {
        if (window.careSync && typeof window.careSync.flushQueue === 'function') {
          await window.careSync.flushQueue();
        }
      } catch (err) {}
      const pending = (opts && typeof opts.pending === 'number')
        ? opts.pending
        : await (async () => {
            try {
              if (window.careSync) {
                const items = await window.careSync.getUnsyncedItems();
                return items.length;
              }
            } catch (err) {}
            return this.getPending();
          })();
      const ok = await this.confirm({ pending });
      if (ok) this.performLogout();
    });
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.Logout = Logout;
}
