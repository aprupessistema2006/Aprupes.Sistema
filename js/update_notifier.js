/**
 * UpdateNotifier — automātiski pārbauda jaunu versiju un piedāvā vienu
 * lielu, vienkāršu pogu. Tas ir izstrādāts DARBA vietai, nevis manai
 * mašīnai: lietotājs (65+ aprūpētājs) nekad neatvērs pārlūka kešatmiņu,
 * netīrīs vēsturi un nezinā ko nozīmē Ctrl+Shift+R. Viņš tikai nospied
 * vienu pogu.
 *
 * ⚠️ Trīs noteikumi, kas šo failu padara par drošu:
 *
 *  1. PAZIŅOJUMU NEDRĪKST PATARVINĀT. Vecākais kods rakstīja appVersion
 *     uzreiz pēc atklāšanas — tāpēc brīdinājums parādījās VIENU reizi
 *     un pēc tam pazuda pats sevī. Lietotājs, kas aizvēra lapu pirms
 *     poga izskatīšanās, vairs NEBŪS brīdināts nekad. Versija tagad
 *     tiek saglabāta TIKAI pēc tam, kad atjauninājums ir patiešām
 *     pielāgots.
 *
 *  2. DATUS DRĪKST SAGLABĀT PIRMS TĪRĪŠANAS. Vecākais kods, nospiežot
 *     "Atjaunot", tīrīja IndexedDB un sync_queue BEZ brīdinājuma —
 *     tā pazaudina jebkuru ierakstu, kas vēl nebija nosūtīts uz
 *     Google Sheets. Tagad rinda tiek vispirms nosūtīta, un ja tas
 *     neizdodas, atjauninājums tiek apturēts ar skaidru iemeslu.
 *
 *  3. LANGU IZĀGLABĀT. localStorage.clear() dzēsa arī 'lang', tāpēc
 *     katrs atjauninājums klusējot atgrieza lietotāju uz latviešu.
 */
const BUILD_VERSION = '20260928-2330';

class UpdateNotifier {
  constructor() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('force_update') === '1' || urlParams.get('v') === 'force') {
      this.forceUpdate();
      return;
    }

    this.applied = false;          // atkārtojamu nospiešņu aizsardzība
    this.versionParam = '?v=' + BUILD_VERSION;
    this.init();
    this.checkVersionOnPageLoad();

    // index.html inline pārbaude notiek pirms šī faila ielādes. Tā
    // atklāj versiju agrāk (pirms SW var pārķert), tāpēc tā atzīmē
    // rezultātu, un mēs rādām to pašu baneri.
    if (window.__UPDATE_PENDING_VERSION) {
      this.showUpdateBanner(window.__UPDATE_PENDING_VERSION);
    }
  }

  // ── Pilnīga atjaunināšana no URL parametriem (diagnostika / avārijas atgriezšana)
  forceUpdate() {
    console.log('[UpdateNotifier] Force update requested via URL param');
    // SW atsaukšana + kešu iztīrīšana + pārlādēšana. Bez kešu
    // iztīrīšanas pārlūks var 10 minūtes atgriezt vecus JS failus
    // (GitHub Pages sūta Cache-Control: max-age=600).
    const hardReset = () => {
      window.location.href = window.location.origin + window.location.pathname;
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => {
          const jobs = (regs || []).map(r => r.unregister().catch(() => {}));
          if ('caches' in window) {
            jobs.push(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
          }
          return Promise.all(jobs);
        })
        .then(hardReset)
        .catch(hardReset);
    } else if (typeof caches !== 'undefined') {
      caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(hardReset)
        .catch(hardReset);
    } else {
      hardReset();
    }
  }

  init() {
    if (!('serviceWorker' in navigator)) return;
    // SVARĪGI: NEDRĪKST katrā ielādē atsaukt un pārreģistrēt SW.
    // Tas liek lapai nonākt zem jauna SW pārvaldības, kas pārķert arējos
    // JSONP pieprasījumus uz script.google.com un nogriek datu ielādi.
    // SW atjaunināšanos pārvalda pats pārlūks.
    this.registerNewSW();
  }

  registerNewSW() {
    navigator.serviceWorker.register('sw2.js' + this.versionParam, { updateViaCache: 'none' })
      .then(reg => {
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        return reg.update().catch(() => {});
      })
      .catch(err => console.warn('[SW] Registration failed:', err));

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'UPDATE_AVAILABLE') {
        this.showUpdateBanner(event.data.version);
      }
      // ⚠️ SW_REPLACED vairs NAV jāapstrādā ar location.reload().
      // Pārlādēšana notiek tikai no applyUpdate(), kurā lietotājs jau
      // ir skatījis brīdinājumu un neko neievada. Automātiska
      // pārlādēšana dzēstu lietotāja pustāpa ievadīto ierakstu.
    });
  }

  // ── Versijas pārbaude ────────────────────────────────────────────────────
  //
  // ⚠️ Šeit APZĪMĒJUMU "jāatjaunina" drīkst atzīmēt TIKAI pēc veiksmīgas
  // atjaunināšanas, nevis pēc atklāšanas. Pretējā gadījumā brīdinājums
  // sevi anulē un lietotājs paliek uz veco kodu uz mužību.
  async checkVersionOnPageLoad() {
    const BUILD = BUILD_VERSION;
    let currentVersion = null;
    try {
      const response = await fetch('version.json?v=' + BUILD, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const manifest = await response.json();
      currentVersion = manifest.version;
    } catch (e) {
      console.warn('[UpdateNotifier] version.json nepieejams:', e);
      // Nav versijas manifesta → nevaram pārliecināties, ka versija ir
      // tāda pati. Tāpēc rāda baneri, ja vien mēs patiešām neesam
      // jau šajā versijā.
      if (this.storedVersion() !== BUILD) this.showUpdateBanner(BUILD);
      return;
    }

    const stored = this.storedVersion();
    if (stored && stored !== currentVersion) {
      this.showUpdateBanner(currentVersion);
    }
    // ⚠️ NEDRĪKST šeit rakstīt appVersion — skatīt 1. noteikumu augstāk.
  }

  storedVersion() {
    try { return localStorage.getItem('appVersion') || ''; }
    catch (e) { return ''; }
  }

  // ── Baneris ──────────────────────────────────────────────────────────────
  //
  // ⚠️ NEPIEVIENOT šeit skaidrojumus. Lietotājs (65+ aprūpētājs) vēlās
  // tikai vienu domu: "vai man jākļo kaut ko?". Katrs papildu teikums —
  // "ieraksti netiks dzēsti", "būs jāpiesakās vēlreiz" — neko neuzlabina,
  // bet padara brīdinājumu smagāku un biežāk ignorējamu.
  showUpdateBanner(version) {
    if (document.getElementById('updateBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.style.cssText = [
      'position: fixed', 'top: 0', 'left: 0', 'right: 0',
      'z-index: 10001',
      'background: #1565C0', 'color: #fff',
      'padding: 18px 14px',
      'font-family: system-ui, -apple-system, "Segoe UI", sans-serif',
      'text-align: center',
      'box-shadow: 0 4px 14px rgba(0,0,0,0.4)'
    ].join(';');

    banner.innerHTML = `
      <div style="font-size: 20px; font-weight: 700; line-height: 1.25; margin-bottom: 14px;">
        🔄 Programma ir atjaunināta
      </div>
      <button id="updateNowBtn" style="
        background: #fff; color: #1565C0; border: none;
        padding: 16px 28px; border-radius: 10px;
        font-weight: 700; cursor: pointer; font-size: 18px;
        width: 100%; max-width: 320px; margin: 0 auto; display: block;
        min-height: 56px;
      ">Atjaunot tagad</button>
    `;
    document.body.insertBefore(banner, document.body.firstChild);

    document.getElementById('updateNowBtn').addEventListener('click', () => {
      this.applyUpdate(version);
    });

    console.log('[UpdateNotifier] Rāda atjauninājuma baneri. Versija:', version || BUILD_VERSION);
  }

  setUpdateState(text, busy) {
    const btn = document.getElementById('updateNowBtn');
    if (!btn) return;
    btn.disabled = !!busy;
    btn.textContent = busy ? text : 'Atjaunot tagad';
    btn.style.opacity = busy ? '0.7' : '1';
  }

  // ── Atjaunināšana ────────────────────────────────────────────────────────
  //
  // ⚠️ Šī funkcija NEDRĪKST apturēt atjauninājumu. Lietotājs nospiež
  // pogu un sagaida, ka lapa pārstartēs. Ja mēs viņu brīdināsim un
  // neļausim iziet, viņš nevar neko darīt — un nākamajā reizē jūs
  // nepatiesībā teiksiet, ka tas nestrādā.
  //
  // Tāpēc: neizsūtīto rindu mēgina nosūtīt (par labu), bet ja tas
  // neizdodas, vienkārši turpinām. Iemesls: rindas ieraksti jau ir
  // serverī vai arī nevar tikt nosūtīti vispār (skat. QUEUE_TERMINAL),
  // un labāk jauns kods nekā iestrēgta programma ar brīdinājumu, ko
  // nevar aizvārt.
  async applyUpdate(version) {
    if (this._applying) return;   // dubultspiedes aizsardzība
    this._applying = true;

    try {
      // ── 1) Mēģinām nosūtīt neizsūtīto rindu ────────────────────────────
      // ⚠️ NEAPTURĀJAM atjauninājumu, ja tas neizdodas.
      try {
        const flush = await this.safelyFlushPendingData();
        if (!flush.ok) {
          console.warn('[UpdateNotifier] Rinda nav pilnībā nosūtīta, tomēr turpinām: ' + flush.reason);
        }
      } catch (e) {
        console.warn('[UpdateNotifier] Rindas nosūtīšana neizdevās, tomēr turpinām:', e);
      }

      this.setUpdateState('Notiek…', true);

      // ── 2) Service worker ───────────────────────────────────────────────
      if ('serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready;
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        } catch (e) {
          console.warn('[UpdateNotifier] SW nav pieejams:', e);
        }
      }

      // ── 3) Lokālo datu tīrīšana ──────────────────────────────────────────
      await this.clearAllLocalData();

      // ── 4) Atzīmējam versiju TIKAI tagad ───────────────────────────────
      try {
        localStorage.setItem('appVersion', version || BUILD_VERSION);
      } catch (e) {}

      // ── 5) Pārlādēšana ──────────────────────────────────────────────────
      const base = window.location.href.split('?')[0];
      window.location.replace(base + '?v=' + Date.now());
    } catch (e) {
      console.error('[UpdateNotifier] Atjaunināšana neizdevās:', e);
      this.setUpdateState('Mēģiniet vēlreiz', false);
      this._applying = false;
    }
  }

  // Nosūta neizsūtīto rindu uz serveri. Atgriež { ok, reason }.
  async safelyFlushPendingData() {
    const sync = window.careSync;
    if (!sync) return { ok: true, reason: 'nav careSync (pieteikšanās lapa)' };

    try {
      if (typeof sync.getUnsyncedCount !== 'function') return { ok: true, reason: '' };
      const pending = await sync.getUnsyncedCount();
      if (!pending) return { ok: true, reason: '' };

      if (typeof sync.flushBeforeExit === 'function') {
        const res = await sync.flushBeforeExit();
        if (res && res.remaining === 0) return { ok: true, reason: '' };
        return { ok: false, reason: res && res.remaining ? res.remaining + ' ieraksti' : 'neatpēkts' };
      }
      if (typeof sync.processQueue === 'function') {
        await sync.processQueue();
        if ((await sync.getUnsyncedCount()) === 0) return { ok: true, reason: '' };
        return { ok: false, reason: 'rinda nav tukša' };
      }
      return { ok: false, reason: 'sinhronizācija nav pieejama' };
    } catch (e) {
      console.warn('[UpdateNotifier] Rindas nosūtīšana neizdevās:', e);
      return { ok: false, reason: (e && e.message) || 'kļūda' };
    }
  }

  async clearAllLocalData() {
    const storeNames = ['darbinieki', 'klienti', 'atzime', 'atzimes', 'atzimes_log', 'uzdevomi', 'meta', 'sync_queue', 'sync_audit'];

    try {
      if (window.indexedDB) {
        const db = new CareDB();
        await db.init();
        for (const storeName of storeNames) {
          try {
            await db.clear(storeName);
          } catch (e) {
            // Store, ko šī versija nelieto, nav jāiztīra.
          }
        }
        if (db.db && db.db.close) db.db.close();
        indexedDB.deleteDatabase('AprupesSistema');
      }
    } catch (e) {
      try { indexedDB.deleteDatabase('AprupesSistema'); }
      catch (e2) { console.warn('[UpdateNotifier] deleteDatabase neizdevās:', e2); }
    }

    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const key of keys) await caches.delete(key);
      } catch (e) {
        console.warn('[UpdateNotifier] Cache notīrīšana neizdevās:', e);
      }
    }

    // ⚠️ localStorage.clear() dzēstu arī 'lang' — katrs atjauninājums
    // klusējot atgrieztu lietotāju uz latviešu. Tāpēc glabājam to.
    let lang = null;
    try { lang = localStorage.getItem('lang'); } catch (e) {}
    try { localStorage.clear(); } catch (e) {}
    if (lang) {
      try { localStorage.setItem('lang', lang); } catch (e) {}
    }
    try { sessionStorage.clear(); } catch (e) {}
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.UpdateNotifier = UpdateNotifier;
  // index.html inline pārbaude izmanto šo, lai abi ceļi rādītu vienu un to pašu baneri.
  globalThis.__showUpdateBanner = function (version) {
    if (globalThis._updateNotifier) return globalThis._updateNotifier.showUpdateBanner(version);
    // UpdateNotifier vēl nav ielādēts — viņš uzņems to, tiklīdz sāksies.
    globalThis.__UPDATE_PENDING_VERSION = version;
  };
}

// Pašinicializācija.
//
// ⚠️ Vecākajā versijā `new UpdateNotifier()` nekur netika izsaukts —
// fails tikai definēja klasi. Tāpēc brīdinājums parādījās TIKAI
// index.html inline bloka dēļ, un pārējās piecas sadaļas (medicīna,
// kontrolieris, aprūpētājs, administrators, pārcēlēties) NEKAD
// nepaziņoja lietotāju par atjauninājumu. Tagad katra lapa, kas ielādē
// šo failu, to darbojas automātiski.
(function autoStart() {
  const start = () => {
    if (globalThis._updateNotifier) return;          // jau palaists
    if (globalThis.__updateAutoStartDisabled) return; // pārbaudēm
    try {
      globalThis._updateNotifier = new UpdateNotifier();
    } catch (e) {
      console.warn('[UpdateNotifier] Neizdevās startēt:', e);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
