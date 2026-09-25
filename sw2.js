const CACHE_NAME = 'aprupes-sistema-v13'; // New cache to bypass old v12 SW lock
const VERSION_URL = 'version.json';
const STATIC_ASSETS = [
  'index.html',
  'admin.html',
  'aprupe.html',
  'control.html',
  'aprupetajs.html',
  'css/index.css',
  'css/admin.css',
  'css/aprupe.css',
  'css/aprupetajs.css',
  'css/login.css',
  'js/config.js',
  'js/update_notifier.js',
  'js/i18n.js',
  'js/timezone.js',
  'js/db.js',
  'js/sync.js',
  'js/login.js',
  'js/logout.js',
  'js/admin.js',
  'js/aprupe.js',
  'js/control.js',
  'js/care_form.js',
  'js/tasks.js',
  'js/excel_export.js',
  'js/xlsx.full.min.js',
  'js/exceljs.bare.min.js',
  'logo/logoDS.png',
  'logo/logo_admin.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW-v13] Installing new service worker (cache:', CACHE_NAME, ')');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW-v13] Precaching static assets');
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW-v13] Activating new service worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW-v13] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
      .then(() => {
        console.log('[SW-v13] Activation complete, notifying clients to reload');
        // Force clients to reload immediately to pick up new SW
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => {
            client.postMessage({ type: 'SW_REPLACED' });
          });
        });
      })
  );
});

async function checkForUpdate() {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!response.ok) return false;
    const manifest = await response.json();
    const currentVersion = manifest.version;
    const storedVersion = await getStoredVersion();
    
    if (storedVersion && storedVersion !== currentVersion) {
      console.log('[SW] New version detected:', storedVersion, '->', currentVersion);
      // Store the new version immediately so we don't keep detecting it
      await setStoredVersion(currentVersion);
      return true;
    }
    await setStoredVersion(currentVersion);
    return false;
  } catch (e) {
    console.warn('[SW] Version check failed:', e);
    return false;
  }
}

function getStoredVersion() {
  return new Promise((resolve) => {
    const request = indexedDB.open('sw-db', 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('meta');
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('meta', 'readonly');
      const store = tx.objectStore('meta');
      const getReq = store.get('version');
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => resolve(null);
    };
    request.onerror = () => resolve(null);
  });
}

function setStoredVersion(version) {
  return new Promise((resolve) => {
    const request = indexedDB.open('sw-db', 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('meta');
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      store.put(version, 'version');
      tx.oncomplete = () => resolve();
    };
    request.onerror = () => resolve();
  });
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => {
    client.postMessage(message);
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isHTML = event.request.headers.get('accept')?.includes('text/html');

  if (isHTML) {
    // For HTML, always fetch fresh but cache it
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For static assets, use cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => new Response('Offline', { status: 508 }));
    })
  );
});

setInterval(async () => {
  // Pārbauda jaunu versiju ik 1 stundu (65+ aprūpētāji — pietiekami bieži)
  const hasUpdate = await checkForUpdate();
  if (hasUpdate) {
    console.log('[SW] Jauna versija konstatēta — paziņojam klientiem');
    await notifyClients({ type: 'UPDATE_AVAILABLE', action: 'notify' });
  }
}, 60 * 60 * 1000);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});