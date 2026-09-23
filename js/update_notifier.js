/**
 * UpdateNotifier - Automātiski pārbauda jaunu versiju un paziņo lietotājam ar vienkāršu pogu.
 * 65+ aprūpētāji: vienkāršs paziņojums ar vienu lielo pogu "Atjaunot".
 * Pēc nospiešanas: notīra visus lokālos datus, aktivizē jauno SW un pārlādē lapu.
 */
class UpdateNotifier {
  constructor() {
    this.versionParam = '?v=20260923-1900';
    console.log('[UpdateNotifier] Initializing with version param:', this.versionParam);
    this.init();
    this.checkVersionOnPageLoad();
  }

  init() {
    if ('serviceWorker' in navigator) {
      console.log('[UpdateNotifier] Reģistrējam Service Worker ar versiju:', this.versionParam);
      navigator.serviceWorker.register('sw.js' + this.versionParam, { updateViaCache: 'none' })
        .then(reg => console.log('[UpdateNotifier] SW reģistrēts veiksmīgi:', reg.scope))
        .catch(err => console.warn('[SW] Registration failed:', err));

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'UPDATE_AVAILABLE') {
          console.log('[UpdateNotifier] Jauna versija pieejama no SW');
          this.showUpdateBanner();
        }
      });
    }
  }

  
  // Pārbaudīt jaunu versiju lapas ielādes brīdī (pirmais, kas dari, atverot programmu)
  async checkVersionOnPageLoad() {
    try {
      const response = await fetch('version.json?t=' + Date.now());
      console.log('[UpdateNotifier] Fetching version.json, response status:', response.status);
      if (!response.ok) {
        console.warn('[UpdateNotifier] version.json fetch failed:', response.status);
        return;
      }
      const manifest = await response.json();
      const currentVersion = manifest.version;
      const storedVersion = localStorage.getItem('appVersion') || '';
      console.log('[UpdateNotifier] Version check:', { storedVersion, currentVersion });

      // Show banner if versions differ (covers both v1855->v1900 upgrade and future updates)
      if (storedVersion && storedVersion !== currentVersion) {
        console.log('[UpdateNotifier] Jauna versija konstatēta ielādes laikā:', storedVersion, '->', currentVersion);
        this.showUpdateBanner();
      } else if (!storedVersion) {
        console.log('[UpdateNotifier] Pirma reize, iestatam versiju:', currentVersion);
      }
      localStorage.setItem('appVersion', currentVersion);
    } catch (e) {
      console.warn('[UpdateNotifier] Versijas pārbaude neizdevās:', e);
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
    window.location = window.location.href.split('?')[0] + '?v=20260923-1900';
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
