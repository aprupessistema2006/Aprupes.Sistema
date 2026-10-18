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

  _iconSVG: function(type) {
    const color = 'currentColor';
    const size = '24';
    if (type === 'logout') {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`;
    }
    if (type === 'alert') {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
    }
    if (type === 'sync') {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 8"/><path d="M3.51 15A9 9 0 0 0 18.36 18.36L23 16"/></svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`;
  },

  confirm: function(opts) {
    opts = opts || {};
    const pending = opts.pending !== undefined ? opts.pending : this.getPending();
    const backgroundSync = opts.backgroundSync === true;
    const t = (key, vars) => {
      let text = window.t ? window.t(key) : key;
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          text = text.replace('{' + k + '}', v);
        });
      }
      return text;
    };
    return new Promise((resolve) => {
      const hasPending = pending > 0;
      const iconType = hasPending ? (backgroundSync ? 'sync' : 'alert') : 'logout';
      const iconColor = backgroundSync ? 'var(--ds-primary)' : (hasPending ? 'var(--ds-critical)' : 'var(--ds-primary)');
      const title = hasPending
        ? (backgroundSync ? t('logoutSyncingTitle') : t('logoutConfirmUnsaved'))
        : t('logoutConfirmTitle');
      const msg = hasPending
        ? (backgroundSync
            ? t('logoutSyncingMsg')
            : t('logoutConfirmUnsavedMsg', { count: pending }))
        : t('logoutConfirmAllSaved');
      const securityLabel = t('logoutSecurityLabel');

      const overlay = document.createElement('div');
      overlay.className = 'logout-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'logoutConfirmTitle');
      overlay.innerHTML = `
        <div class="logout-modal-card" role="document">
          <div class="logout-modal-icon" style="color: ${iconColor};">
            ${this._iconSVG(iconType)}
          </div>
          <h2 id="logoutConfirmTitle" class="logout-modal-title">${title}</h2>
          <p class="logout-modal-desc">${msg}</p>
          <p class="logout-modal-security">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            ${securityLabel}
          </p>
          <div class="logout-modal-actions">
            <button type="button" class="btn btn-secondary" data-act="cancel">${t('logoutCancelBtn')}</button>
            ${hasPending && !backgroundSync ? '<button type="button" class="btn btn-primary" data-act="sync">' + t('logoutSyncNowBtn') + '</button>' : ''}
            <button type="button" class="btn btn-primary" data-act="ok">${backgroundSync ? t('logoutExitBtn') : t('logoutOkBtn')}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const confirmBtn = overlay.querySelector('[data-act="ok"]');
      const cancelBtn = overlay.querySelector('[data-act="cancel"]');
      const syncBtn = overlay.querySelector('[data-act="sync"]');
      const focusables = overlay.querySelectorAll('button[data-act]');
      const firstFocusable = focusables[0];
      const lastFocusable = focusables[focusables.length - 1];

      const previouslyFocused = document.activeElement;

      let syncInProgress = false;
      let confirmInProgress = false;

      const cleanup = () => {
        document.removeEventListener('keydown', handleKeyDown);
        if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
          previouslyFocused.focus();
        }
      };

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          if (!syncInProgress && !confirmInProgress) {
            cleanup();
            overlay.remove();
            resolve(false);
          }
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const currentIndex = Array.from(focusables).indexOf(document.activeElement);
          if (e.shiftKey) {
            const idx = currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
            focusables[idx].focus();
          } else {
            const idx = currentIndex >= focusables.length - 1 ? 0 : currentIndex + 1;
            focusables[idx].focus();
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown);

      requestAnimationFrame(() => {
        overlay.classList.add('is-open');
        if (firstFocusable) firstFocusable.focus();
      });

      const setLoading = (btn, loading) => {
        if (loading) {
          btn.disabled = true;
          btn.setAttribute('aria-busy', 'true');
          btn.dataset.originalText = btn.textContent;
          btn.textContent = t('logoutSyncingBtnText');
        } else {
          btn.disabled = false;
          btn.removeAttribute('aria-busy');
          if (btn.dataset.originalText) {
            btn.textContent = btn.dataset.originalText;
            delete btn.dataset.originalText;
          }
        }
      };

      const setErrorState = (msgHtml, count) => {
        const msgEl = overlay.querySelector('.logout-modal-desc');
        if (msgEl) {
          msgEl.innerHTML = msgHtml;
        }
        const iconEl = overlay.querySelector('.logout-modal-icon');
        if (iconEl) iconEl.innerHTML = this._iconSVG('alert');
        const iconContainer = overlay.querySelector('.logout-modal-icon');
        if (iconContainer) iconContainer.style.color = 'var(--ds-critical)';
        if (syncBtn) {
          setLoading(syncBtn, false);
          syncBtn.textContent = t('logoutRetryBtn');
        }
      };

      overlay.addEventListener('click', async (e) => {
        if (e.target === overlay) {
          if (!syncInProgress && !confirmInProgress) {
            cleanup();
            overlay.remove();
            resolve(false);
          }
          return;
        }

        const act = e.target.dataset && e.target.dataset.act;
        if (act === 'cancel') {
          cleanup();
          overlay.remove();
          resolve(false);
        } else if (act === 'sync') {
          if (syncInProgress) return;
          syncInProgress = true;
          setLoading(syncBtn, true);
          try {
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
            let remaining = flush.remaining;
            if (!remaining && window.careSync && typeof window.careSync.getUnsyncedCount === 'function') {
              remaining = await window.careSync.getUnsyncedCount();
            }
            if (remaining === 0) {
              cleanup();
              overlay.remove();
              resolve(true);
            } else {
              setErrorState(t('logoutSyncFailedMsg', { count: remaining }), remaining);
            }
          } catch (err) {
            setErrorState(t('logoutErrorMsg', { error: err.message }));
          } finally {
            syncInProgress = false;
          }
        } else if (act === 'ok') {
          if (confirmInProgress) return;
          confirmInProgress = true;
          setLoading(confirmBtn, true);
          cleanup();
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
    const t = (key, vars) => {
      let text = window.t ? window.t(key) : key;
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          text = text.replace('{' + k + '}', v);
        });
      }
      return text;
    };
    const compliments = [
      t('goodbyeCompliment1', { name: fname }),
      t('goodbyeCompliment2', { name: fname }),
      t('goodbyeCompliment3', { name: fname }),
      t('goodbyeCompliment4', { name: fname }),
      t('goodbyeCompliment5', { name: fname }),
      t('goodbyeCompliment6', { name: fname }),
      t('goodbyeCompliment7', { name: fname }),
      t('goodbyeCompliment8', { name: fname }),
      t('goodbyeCompliment9', { name: fname }),
      t('goodbyeCompliment10', { name: fname }),
    ];
    const msg = compliments[Math.floor(Math.random() * compliments.length)];

    const goodbye = document.createElement('div');
    goodbye.className = 'logout-goodbye-overlay';
    goodbye.innerHTML = `
      <div class="logout-goodbye-card">
        <div class="logout-goodbye-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
        </div>
        <div class="logout-goodbye-msg">${msg}</div>
        <div class="logout-goodbye-sub">${t('goodbyeSubtitle')}</div>
      </div>
    `;
    document.body.appendChild(goodbye);

    setTimeout(async () => {
      try {
        if (window.careSync && typeof window.careSync.sync === 'function') {
          window.careSync.sync();
        }
      } catch (e) {}
      try {
        await callBackend('logout', {}, 5000);
      } catch (e) {
        console.warn('[logout] servera sesijas likvidācija neizdevās (ignorē):', e && e.message);
      }
      clearSessionToken();
      sessionStorage.removeItem('careUser');
      sessionStorage.removeItem('careAdminMode');
      sessionStorage.removeItem('careAdminCaregiverId');
      this.clearPending();
      window.location.href = 'index.html';
    }, 1800);
  },

  attach: function(buttonEl, opts) {
    if (!buttonEl) return;
    buttonEl.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      try {
        if (window.careSync && typeof window.careSync.flushQueue === 'function') {
          await Promise.race([
            window.careSync.flushQueue(),
            new Promise(r => setTimeout(r, 5000))
          ]);
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
      const ok = await this.confirm({ pending, backgroundSync: pending > 0 });
      if (ok) this.performLogout();
    });
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.Logout = Logout;
}
