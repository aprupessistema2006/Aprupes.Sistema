/**
 * UpdateNotifier - Automātiski pārbauda jaunu versiju un paziņo lietotājam ar vienkāršu pogu.
 * 65+ aprūpētāji: vienkāršs paziņojums ar vienu lielo pogu "Atjaunot".
 * Pēc nospiešanas: notīra visus lokālos datus, aktivizē jauno SW un pārlādē lapu.
 */
class UpdateNotifier {
  constructor() {
    this.versionParam = '?v=20260923-1745';
    this.init();
    this.checkVersionOnPageLoad();
  }

  init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js' + this.versionParam, { updateViaCache: 'none' })
        .catch(err => console.warn('[SW] Registration failed:', err));

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'UPDATE_AVAILABLE') {
          console.log('[UpdateNotifier] Jauna versija pieejama');
          this.showUpdateBanner();
        }
      });
    }
  }

  
  // Pārbaudīt jaunu versiju lapas ielādes brīdī (pirmais, kas dari, atverot programmu)
  async checkVersionOnPageLoad() {
    try {
      const response = await fetch('version.json?t=' + Date.now());
      if (!response.ok) return;
      const manifest = await response.json();
      const currentVersion = manifest.version;
      const storedVersion = localStorage.getItem('appVersion') || '';

      if (storedVersion && storedVersion !== currentVersion) {
        console.log('[UpdateNotifier] Jauna versija konstatēta ielādes laikā:', storedVersion, '->', currentVersion);
        this.showUpdateBanner();
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
    const banner = document.getElementById('updateBanner');
    if (banner) banner.style.opacity = '0.5';

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      } catch (e) {
        console.warn('[UpdateNotifier] SKIP_WAITING neizdevās:', e);
      }
    }

    await this.clearAllLocalData();

    window.location.reload();
  }

  async clearAllLocalData() {
    console.log('[UpdateNotifier] Tīra visus lokālos datus...');

    try {
      if (window.indexedDB) {
        const db = new CareDB();
        await db.init();
        const storeNames = ['darbinieki', 'klienti', 'atzime', 'atzimes', 'atzimes_log', 'uzdevomi', 'meta', 'sync_queue'];
        for (const storeName of storeNames) {
          try {
            await db.clear(storeName);
          } catch (e) {
            console.warn('[UpdateNotifier] Neizdevās notīrīt ' + storeName + ':', e);
          }
        }
        if (db.db && db.db.close) {
          db.db.close();
        }
        indexedDB.deleteDatabase('AprupesSistema');
      }
    } catch (e) {
      console.warn('[UpdateNotifier] IndexedDB notīrīšana neizdevās:', e);
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
        }
      } catch (e) {
        console.warn('[UpdateNotifier] Cache notīrīšana neizdevās:', e);
      }
    }

    localStorage.clear();
    sessionStorage.clear();

    console.log('[UpdateNotifier] Visi dati notīrīti. Pārlādē...');
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.UpdateNotifier = UpdateNotifier;
}
