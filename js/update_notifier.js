/**
 * UpdateNotifier - Automātiski pārbauda jaunu versiju un paziņo lietotājam ar vienkāršu pogu.
 * 65+ aprūpētāji: vienkāršs paziņojums ar vienu lielo pogu "Atjaunot".
 * Pēc nospiešanas: notīra visus lokālos datus, aktivizē jauno SW un pārlādē lapu.
 */
class UpdateNotifier {
  constructor() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('force_update') === '1' || urlParams.get('v') === 'force') {
      console.log('[UpdateNotifier] Force update requested via URL param');
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (reg) {
            console.log('[UpdateNotifier] Unregistering old SW to break cache lock...');
            reg.unregister().then(() => {
              console.log('[UpdateNotifier] Old SW unregistered, reloading with new SW...');
              localStorage.removeItem('appVersion');
              // Reload without any params to get fresh HTML/JS from server (not SW cache)
              window.location.href = window.location.origin + window.location.pathname;
            });
          } else {
            console.log('[UpdateNotifier] No SW found, reloading for fresh code...');
            localStorage.removeItem('appVersion');
            window.location.href = window.location.origin + window.location.pathname;
          }
        });
      } else {
        localStorage.removeItem('appVersion');
        window.location.href = window.location.origin + window.location.pathname;
      }
      return;
    }

    this.versionParam = '?v=20260925-1257';
    console.log('[UpdateNotifier] Initializing with version param:', this.versionParam);
    this.init();
    this.checkVersionOnPageLoad();
  }

  init() {
    if ('serviceWorker' in navigator) {
      console.log('[UpdateNotifier] Checking for old Service Worker to unregister');
      // Check for and unregister any old Service Worker that might be caching stale content
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          console.log('[UpdateNotifier] Found existing SW registration, unregistering...');
          reg.unregister().then(() => {
            console.log('[UpdateNotifier] Old SW unregistered, registering new one...');
            this.registerNewSW();
          });
        } else {
          console.log('[UpdateNotifier] No existing SW, registering new one...');
          this.registerNewSW();
        }
      });
    }
  }

  registerNewSW() {
    console.log('[UpdateNotifier] Reģistrējam jauno Service Worker (sw2.js):', this.versionParam);
    // Use sw2.js to bypass any cached sw.js from old Service Worker
    navigator.serviceWorker.register('sw2.js' + this.versionParam, { updateViaCache: 'none' })
      .then(reg => console.log('[UpdateNotifier] Jaunā SW reģistrēta:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'UPDATE_AVAILABLE') {
        console.log('[UpdateNotifier] Jauna versija pieejama no SW');
        this.showUpdateBanner();
      }
      if (event.data && event.data.type === 'SW_REPLACED') {
        console.log('[UpdateNotifier] Vecā SW aizvietota, pārslādē...');
        window.location.reload();
      }
    });
  }

  
  // Pārbaudīt jaunu versiju lapas ielādes brīdī (pirmais, kas dari, atverot programmu)
  async checkVersionOnPageLoad() {
    try {
      const response = await fetch('version.json?v=20260925-1257');
      console.log('[UpdateNotifier] Fetching version.json, response status:', response.status);
      if (!response.ok) {
        console.warn('[UpdateNotifier] version.json fetch failed:', response.status);
        // Fallback: Always show banner if version.json unavailable
        // This ensures users get the update even if version.json is cached or unavailable
        const storedVersion = localStorage.getItem('appVersion') || '';
        if (!storedVersion || storedVersion !== '20260925-1257') {
          this.showUpdateBanner();
        }
        return;
      }
      const manifest = await response.json();
      const currentVersion = manifest.version;
      const storedVersion = localStorage.getItem('appVersion') || '';
      console.log('[UpdateNotifier] Version check:', { storedVersion, currentVersion });

      // Show banner if versions differ OR if localStorage is empty (upgrade scenario)
      if (storedVersion !== currentVersion) {
        console.log('[UpdateNotifier] Version mismatched:', storedVersion || '(tukšs)', '->', currentVersion);
        this.showUpdateBanner();
      }
      localStorage.setItem('appVersion', currentVersion);
    } catch (e) {
      console.warn('[UpdateNotifier] Versijas pārbaude neizdevās:', e);
      // Fallback: Show banner on error
      const storedVersion = localStorage.getItem('appVersion') || '';
      if (!storedVersion || storedVersion !== '20260925-1257') {
        this.showUpdateBanner();
      }
    }
  }

  showUpdateBanner() {
    if (document.getElementById('updateBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 10001;
      background: #2196F3; color: white; padding: 12px 16px;
      font-family: system-ui, sans-serif; text-align: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    banner.innerHTML = `
      <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">🔄 Jauna versija pieejama</div>
      <button id="updateNowBtn" style="
        background: white; color: #2196F3; border: none; padding: 12px 24px;
        border-radius: 6px; font-weight: 600; cursor: pointer;
        font-size: 16px; width: 100%; max-width: 240px; margin: 0 auto;
        display: block;
      ">Atjaunot</button>
    `;
    document.body.insertBefore(banner, document.body.firstChild);

    document.getElementById('updateNowBtn').addEventListener('click', () => {
      this.applyUpdate();
    });

    // Debug pogas, kas veic manuālu versijas pārbaudi (noder, ja baneris neparādās)
    this.addDebugButton();
  }

  addDebugButton() {
    // Check if force_update param is in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('force_update') === '1') {
      this.showUpdateBanner();
      return;
    }

    const debugBtn = document.createElement('button');
    debugBtn.id = 'debugForceUpdateBtn';
    debugBtn.innerHTML = 'Pārbaudīt atjauninājumu';
    debugBtn.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 10002;
      background: #ff9800; color: white; border: none; padding: 10px 15px;
      border-radius: 6px; font-size: 14px; cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    `;
    debugBtn.onclick = async () => {
      debugBtn.textContent = 'Pārbauda...';
      const response = await fetch('version.json?t=' + Date.now());
      const manifest = await response.json();
      const currentVersion = manifest.version;
      const storedVersion = localStorage.getItem('appVersion') || '';
      if (storedVersion !== currentVersion) {
        debugBtn.textContent = 'Atjaunot!';
        debugBtn.style.background = '#2196F3';
        debugBtn.onclick = () => this.applyUpdate();
      } else {
        debugBtn.textContent = 'Nav jauninājuma';
        setTimeout(() => { debugBtn.style.display = 'none'; }, 3000);
      }
    };
    document.body.appendChild(debugBtn);
  }

  async applyUpdate() {
    console.log('[UpdateNotifier] applyUpdate sākās');
    const banner = document.getElementById('updateBanner');
    if (banner) banner.style.opacity = '0.5';

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        console.log('[UpdateNotifier] SW gatavs, checking waiting SW...');
        if (reg.waiting) {
          console.log('[UpdateNotifier] Atrodas gaidījošais SW, sūtām SKIP_WAITING');
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          console.log('[UpdateNotifier] Nav gaidīgoša SW');
        }
      } catch (e) {
        console.warn('[UpdateNotifier] SKIP_WAITING neizdevās:', e);
      }
    }

    console.log('[UpdateNotifier] Tīra visus datus...');
    await this.clearAllLocalData();

    console.log('[UpdateNotifier] Pārlādē lapu...');
    window.location = window.location.href.split('?')[0] + '?v=20260925-1257';
  }

  async clearAllLocalData() {
    console.log('[UpdateNotifier] Tīra visus lokālos datus...');

    const storeNames = ['darbinieki', 'klienti', 'atzime', 'atzime', 'atzimes', 'atzimes_log', 'uzdevomi', 'meta', 'sync_queue'];

    try {
      if (window.indexedDB) {
        console.log('[UpdateNotifier] Tīra IndexedDB: AprupesSistema');
        const db = new CareDB();
        await db.init();
        for (const storeName of storeNames) {
          try {
            await db.clear(storeName);
            console.log('[UpdateNotifier] Notīrīts:', storeName);
          } catch (e) {
            console.warn('[UpdateNotifier] Neizdevās notīrīt ' + storeName + ':', e.message);
          }
        }
        if (db.db && db.db.close) {
          db.db.close();
        }
        indexedDB.deleteDatabase('AprupesSistema');
      }
    } catch (e) {
      console.warn('[UpdateNotifier] IndexedDB notīrīšana neizdevās:', e.message);
      try {
        indexedDB.deleteDatabase('AprupesSistema');
      } catch (e2) {
        console.warn('[UpdateNotifier] deleteDatabase neizdevās:', e2);
      }
    }

    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
          console.log('[UpdateNotifier] Cache dzēsts:', key);
        }
      } catch (e) {
        console.warn('[UpdateNotifier] Cache notīrīšana neizdevās:', e);
      }
    }

    localStorage.clear();
    sessionStorage.clear();

    console.log('[UpdateNotifier] Visi dati notīrīti.');
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.UpdateNotifier = UpdateNotifier;
}
