// ⚠️ Kešas nosaukumam JĀBŪT jauns katrā versijā. Ja tas paliek tāds pats,
// `activate` nopirksīs veco kešu, bet jaunais SW joprojām izmantojtu to pašu
// kešu — un vecās rindas (ar vecajiem `?v=`) paliktu tur.
// 20260929-1559: klienta formas datu svaigums starp ierīcēm (fona atsvaidzināšana).
// 20260929-1048: atzīmes skenēšanas labojums + mērījumi.
// 20261002-2100: GAS_URL jaunā skripta adrese; forceUpdate pārlādē jaunu URL.
// 20261004-1600: HTML zarojums bezsaimes režīmā atgriež īstu Response.
const CACHE_NAME = 'aprupes-sistema-v62'; // SW never intercepts cross-origin JSONP
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
  'js/perf.js',
  'js/operation_registry.js',
  'js/login.js',
  'js/logout.js',
  'js/admin.js',
  'js/aprupe.js',
  'js/control.js',
  'js/care_form.js',
  'js/medicine_view.js',
  'js/tasks.js',
  'js/excel_export.js',
  'Aprūpes lapas.xlsx',
  'css/medicine.css',
  'js/xlsx.full.min.js',
  'js/exceljs.bare.min.js',
  'manifest.json',
  'logo/logoDS.png',
  'logo/logo_admin.png'
];

// ⚠️ Precachējam TIEŠI tās adreses, ko lapas pieprasa, ar to pašu
// `?v=` parametru. Bez tā precache ieraksti un lapu pieprasījumi
// nesakrīt, un bezsaimes režīmā fails netiek atrasts vispār.
//
// BUILD_VERSION jābūt SYNCHRONIZĒTS ar version.json. To pārbauda
// test_deploy_consistency.js.
const BUILD_VERSION = '20261008-1910';

// Koda failus precachējam ar versijas parametru, pārējos — bez tā.
const withVersion = (path) =>
  /\.(?:js|css)$/.test(path) ? path + '?v=' + BUILD_VERSION : path;

self.addEventListener('install', (event) => {
  console.log('[SW] Installing new service worker (cache:', CACHE_NAME, ')');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching static assets (BUILD', BUILD_VERSION + ')');
      return cache.addAll(STATIC_ASSETS.map(withVersion).map(url => new Request(url, { cache: 'reload' })));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating new service worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
      .then(() => {
        // ⚠️ BRĪDINĀJUMS: NEizsaukt klientu pārlādēšanu.
        //
        // Vecākais kods šeit pēc katras aktivācijas nosūtīja
        // SW_REPLACED visiem atvērtajiem logiem, un lapa pārlādējās.
        // Tas nozīmēja, ka SW atjaunināšanās BRĪĶA laikā jebkurš
        // lietotājs, kas pustāpa aprūpes ierakstu, zaudēja visu ievadīto.
        //
        // Tas nav pieņemami darba vietā, kurā ieraksti ir svarīgi.
        // Jaunā versija tiek piedāvāta caur UpdateNotifier baneri, un
        // pārlādēšanās notiek TIKAI tad, kad lietotājs pats nospiež
        // "Atjaunot" — tāpēc viņš jau ir beidzis darbu un neko
        // nezaudē. clients.claim() augstāk joprojām nodrošina, ka
        // jaunais kods sāk darboties tūlīt nākamajā navigācijā.
        console.log('[SW] Aktivizācija pabeigta. Klienti netiek pārlādēti —' +
          ' atjauninājumu lietotājs apstiprina pats (skat. UpdateNotifier).');
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

// ĀRĒJIE pieprasījumi (script.google.com JSONP u.c.) SW NEDRĪKST apkalpot!
// SW pārtverot šos pieprasījumus laiž caur fetch() un pārnes JSONP
// skriptu uz no-cors režīmu — tad skripts neielādējas un JSONP
// atzvanīšana nekad nenotiek. Tieši tāpēc darbojas datorā, bet ne telefonā.
//
// ⚠️ Šeit NEBĪJA rakstīts, ka GAS neatgriež CORS galvenes — tas ir nepareizi.
// Mērījums 2026-09-28: GAS /exec atgriež `Access-Control-Allow-Origin: *`
// un `Content-Type: application/json`, tāpēc tamdēļ arī fetch strādā.
// Ārējos pieprasījumus tomēr nedrīkst ļaut SW apkalpot, jo pārtveršana
// no-cors režīmā nogriež skripta ielādēšanos.
  if (url.origin !== self.location.origin) {
    return; // ļauj pārlūkam apstrādāt pašam
  }

  const isHTML = event.request.headers.get('accept')?.includes('text/html');

  // version.json NEVER kešojama. To dēļ uz telefoniem cache-first stratēģija
  // atgrieza veco versiju, "Atjaunot" josma parādījās bezgalīgi un
  // neizraisīja nekādu atjauninājumu.
  if (url.pathname.endsWith('version.json')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
    );
    return;
  }

if (isHTML) {
    // ⚠️ HTML vienmēr no tīkla (tāpēc jauns kods ir svaigs), bet KEŠA ir
    // obligāta rezerve — lai darba vietā bez interneta lapa joprojām
    // atveras.
    //
    // ⚠️ PROBLĒMA: `caches.match(event.request)` meklē ar query string,
    // bet precache satur tikai `aprupetajs.html` bez `?client=...`.
    // Risinājums: HTML saglabājam UN meklējam ignorējot query string
    // (tikai origin + pathname). Tā `aprupetajs.html?client=...` atrod
    // kešoto `aprupetajs.html`.
    //
    // ⚠️ ⚠️ ŠEIT BIJA NEDARBOJAS KODA.
    //
    // Vecākais kods beidzās ar `.catch(() => caches.match(event.request))`.
    // Ja bija BEZSAIME **un** HTML nebija kešotā, `caches.match()` atgriež
    // `undefined`, nevis `Response`. `respondWith(undefined)` tad izmet
    // `TypeError: Failed to convert value to 'Response'` — un pārlūks
    // parāda savu pašu kļūdu lapu, nevis mūsu.
    //
    // Bezsaime bez kešas ir iespējams: pirmā apmeklēšana notiek pirms
    // `activate` pabeidzas, un keša tad vēl nav piepildīta.
    //
    // Tāpēc `catch` VIENMĒR atgriež īstu `Response` — vai nu no kešas
    // (meklējot bez query string), vai nu vienkāršu "Bezsaime" lapiņu ar 503.
    const htmlCacheKey = new Request(url.origin + url.pathname, { ignoreSearch: true });
    event.respondWith(
      fetch(event.request, { cache: 'no-store', credentials: 'same-origin' })
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                // Saglabājam AR query string (par precision) UN bez tā (par deep links)
                cache.put(event.request, clone);
                cache.put(htmlCacheKey, clone.clone());
              })
              .catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(htmlCacheKey);
          if (cached) return cached;
          return new Response(
            '<!doctype html><meta charset="utf-8">' +
            '<title>Bezsaime</title>' +
            '<p style="font:16px system-ui;padding:24px">Nav savienojuma ar internetu.</p>',
            { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // ── KODA FAILI (js/css) ──────────────────────────────────────────────────
  //
  // ⚠️ ⚠️ Lielākā klūda, kas šai lietojumai jebkad bijusi.
  //
  // Vecākais kods šeit darīja šo:
  //
  //     const urlNoQuery = new URL(event.request.url);
  //     urlNoQuery.search = '';            // izmet ?v=20260928-2230
  //     const cacheKey = new Request(urlNoQuery.toString(), { ignoreSearch: true });
  //     caches.match(cacheKey) → ja atrasts, atgriež to
  //
  // Tāpēc katrs `?v=` bumpojums HTML lapās bija BEZDARBĪGS. Service
  // worker izmeta versijas parametru un atgrieza kešoto kopiju — mūžmūžīgi.
  // Lietotājs redzēja veco atjauninājuma baneri, vecus kļūdas, vecus
  // ierakstus, un neviens versijas bumpojums to nevarēja mainīt.
  //
  // Tāpēc šeit:
  //   • kešes atslēga SAGLABĀ query parametrus → dažādas versijas ir
  //     dažādi ieraksti, un jaunais URL ir kešā trūstošs;
  //   • STRATĒĠIJA: vispirms tīkls (vienmēr svaigs kods), keše kā
  //     rezerves variants, ja ir bezsaime.
  //
  // Kāpēc tīkls-vispirms, nevis keše-vispirms: šī programma pārmaiņas
  // datus no IndexedDB, nevis no SW kešes, tāpēc tīkla izmantošana nepalieina
  // ielādes laiku. Bet tā garantē, ka lietotājs vienmēr izmanto TO versiju,
  // kura ir izvietota.
  const isCodeAsset = /\.(?:js|css)$/.test(url.pathname);

  // Kešes atslēga AR query parametru. Tas ir galvenais, kas padara
  // `?v=` bumpošanu par darbīgu.
  const cacheKey = event.request;

  if (isCodeAsset) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store', credentials: 'same-origin' })
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(cacheKey, clone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(cacheKey).then((cached) => {
          if (cached) return cached;
          return new Response('Bezsaime', { status: 508 });
        }))
    );
    return;
  }

  // Pārējie faili (attēli, xlsx, favicon) — keše-vispirms ar precīzu atslēgu.
  event.respondWith(
    caches.match(cacheKey).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(cacheKey, clone))
              .catch(() => {});
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















