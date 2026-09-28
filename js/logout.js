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
    const backgroundSync = opts.backgroundSync === true;
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'logout-confirm-overlay';
      const hasPending = pending > 0;
      const icon = hasPending ? (backgroundSync ? '🔄' : '⚠️') : '👋';
      const title = hasPending 
        ? (backgroundSync ? 'Dati sinhronizējas...' : 'Ir nesaglabāti dati!') 
        : 'Vai tiešām vēlies iziet?';
      const msg = hasPending
        ? (backgroundSync
            ? 'Dati tiks nosūtīti uz Google Sheets fonā. Varat droši iziet — sinhronizācija turpināsies automātiski.'
            : 'Tev pašlaik ir <strong>' + pending + ' nesaglabāts(-i) ieraksts(-i)</strong>. Tie tiks nosūtīti automātiski, bet, ja nav interneta, tie var pazust.<br><br>Vai tiešām vēlies iziet?')
        : 'Visi dati ir saglabāti. Vai tiešām vēlies iziet no sistēmas?';
      overlay.innerHTML = `
        <div class="logout-confirm-card">
          <div class="logout-confirm-icon">${icon}</div>
          <div class="logout-confirm-title">${title}</div>
          <div class="logout-confirm-msg ${hasPending ? (backgroundSync ? 'syncing' : 'unsaved') : ''}">${msg}</div>
          <div class="logout-buttons">
            <button class="logout-btn-cancel" data-act="cancel">Palikt</button>
            ${hasPending && !backgroundSync ? '<button class="logout-btn-sync" data-act="sync">🔄 Sinhronizēt tagad</button>' : ''}
            <button class="logout-btn-confirm" data-act="ok">${backgroundSync ? 'Iziet' : 'Jā, iziet'}</button>
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
            // ⚠️ Izejam no lietojuma → jānosūta RINDA, nevis jāielādē no
            // servera. forceFullSync() ir lasīšana (pilnā bootstrap ielāde),
            // tā bloķējas COOLDOWN un negarantē, ka dati ir saglabāti.
            let flush = { pushed: 0, remaining: 0, skipped: true };
            if (window.careSync) {
              if (typeof window.careSync.flushBeforeExit === 'function') {
                flush = await window.careSync.flushBeforeExit();
              } else if (typeof window.careSync.processQueue === 'function') {
                await window.careSync.processQueue();
                flush = {
                  pushed: 0,
                  remaining: await window.careSync.getUnsyncedCount(),
                  skipped: false
                };
              }
            }
            // Re-check pending
            let remaining = flush.remaining;
            if (!remaining && window.careSync && typeof window.careSync.getUnsyncedCount === 'function') {
              remaining = await window.careSync.getUnsyncedCount();
            }
            if (remaining === 0) {
              overlay.remove();
              resolve(true); // Allow logout after successful sync
            } else {
              // ⚠️ RINDA NAV TUKŠA. nedrīkst apgalvot, ka dati saglabāti —
              // tie joprojām ir tikai ierīcē. Piedāvājam mēģināt vēlreiz
              // un brīdinām, ka iziešana var pazaudēt šos ierakstus.
              const msgEl = overlay.querySelector('.logout-confirm-msg');
              if (msgEl) {
                msgEl.innerHTML = '⚠️ <b>' + remaining + '</b> ierakstu vēl nav saglabāti Google Sheets.<br><br>' +
                  'Dati ir tikai šajā ierīcē — ja iziesi tagad, tie var pazust.<br><br>' +
                  'Vai vēlies mēģināt vēlreiz, vai tomēr iziet?';
                msgEl.classList.add('unsaved');
              }
              const titleEl = overlay.querySelector('.logout-confirm-title');
              if (titleEl) titleEl.textContent = 'Ne visas izmaiņas saglabātas';
              const iconEl = overlay.querySelector('.logout-confirm-icon');
              if (iconEl) iconEl.textContent = '⚠️';
              if (syncBtn) {
                syncBtn.disabled = false;
                syncBtn.textContent = '🔄 Mēģināt vēlreiz';
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
      // Izsauc queue apstrādi un gaida līdz 5s, lai processQueue iziet cauri vienumiem
      try {
        if (window.careSync && typeof window.careSync.flushQueue === 'function') {
          // Gaida flushQueue pabeigšanos, bet ne ilgāk par 5 sekundēm (GAS cold start aizsardzība)
          await Promise.race([
            window.careSync.flushQueue(),
            new Promise(r => setTimeout(r, 5000))
          ]);
        }
      } catch (err) {}
      // Pārbauda pašreizējo stāvokli pēc flushQueue
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
      // Ja ir vienumi rindā - parāda mirogo brīdinājumu, ka tiks sinhronizēti fonā
      const ok = await this.confirm({ pending, backgroundSync: pending > 0 });
      if (ok) this.performLogout();
    });
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.Logout = Logout;
}
