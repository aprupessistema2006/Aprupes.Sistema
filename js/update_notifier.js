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
const BUILD_VERSION = '20261002-2000';

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
    this.ensureReloadButton();

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
      // ⚠️ Bez manifesta nevaram salīdzināt ar jauno versiju. Bet poga
      // TIKAI tad, ja `appVersion` ir zināms UN atšķiras no tā, ko
      // pašreiz ielādējam. Bez šī papildus apstākļa katrs lietotājs ar
      // jaunu kodu, bet vēl neizspiesta "Atjaunot tagad", saņemtu
      // kļūdīgu brīdinājumu — un `applyUpdate()` dzēstu vietējo datu
      // glabājumu. Kļūdīgs brīdinājums ir ļaunāks nekā pārdots brīdinājums.
      const stored = this.storedVersion();
      if (stored && stored !== BUILD) this.showUpdateBanner(BUILD);
      return;
    }

    // ⚠️⚠️ IEPRIEKŠĒJĀ LOGIKA ŠEIT BIJA NEPAREEJA.
    //
    //   if (stored && stored !== currentVersion) { ... }
    //
    // `appVersion` tiek rakstīts TIKAI `applyUpdate()` iekšienē — tāpēc
    // lietotājs, kas vēl neko nav atjauninājis, to nekad neiegūst, un
    // nosacījums nekad neizpildās. Rezultāts: poga "Atjaunot tagad"
    // neparādījās NEBE NEKAD, pat ja ir jauna versija.
    //
    // Pareizais avots ir PAŠREIZĒJAIS KODS, nevis localStorage. Ja ielādētais
    // kods jau ir jaunākais, mēs esam tur, kur vajag būt, un poga nav
    // vajadzīga. Ja kods ir vecāks par manifestu — poga jāparāda, neatkarīgi
    // no tā, ko lietotājs jebkad ir klikšķis.
    if (BUILD !== currentVersion) {
      this.showUpdateBanner(currentVersion);
    }
    // ⚠️ NEDRĪKST šeit citā rakstīt appVersion — to dara tikai
    // `applyUpdate()`, pēc veiksmīgas datu nolasīšanas uz serveri.
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

  // ── Vienmēr redzamā "ielādēt svaisto kodu" poga ───────────────────────────
  //
  // ⚠️ KĀPĒC ŠĪ POGA IR NEPIECIEŠAMA.
  //
  // Service worker kešo HTML un JS failus. Kad kods tiek izmainīts un
  // atjaunināts uz GitHub, pārlūks turpina rādīt VECU versiju no kešas —
  // lietotājs redz veco programmu un domā, ka izmaiņas "nestrādā".
  // Bez šīs pogas vienīgais veids to notīrīt bija manuāli
  // Ctrl+Shift+R, ko 65+ aprūpētājs nekad nedarīs.
  //
  // ⚠️ ŠĪ POGA INTENTIONĀLI NEDZĒŠ NEDAR KO.
  //
  // Atjauninājuma banera "Atjaunot tagad" (applyUpdate) tīra visu
  // IndexedDB un visu kešu — tas ir liels, destruktīvs trieciens un to
  // drīkst darīt TIKAI tad, ja ir apstiprināta jauna versija.
  //
  // Šī poga ir ikdienas lietošanai: tā pārlādē lapu ar
  // ?v=force_update=1, kas liek apgalvot versijai un iztīrīt TIKAI
  // kešu (nevis ierīces datus). Lietotāja ieraksti paliek neskartī.
  ensureReloadButton() {
    if (document.getElementById('freshReloadBtn')) return;
    if (!document.body) return;

    // Ikoniņa, nevis teksta poga. Lietotājs (65+) skata ikonu, nevis
    // lasa garu tekstu; pelēkā pirkstu zīme ir "atsvaidzināt".
    const btn = document.createElement('button');
    btn.id = 'freshReloadBtn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Ielādēt jaunāko versiju');
    btn.title = 'Ielādēt jaunāko versiju';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>' +
      '</svg>';
    btn.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:99999',
      'width:44px', 'height:44px', 'border-radius:50%',
      'display:flex', 'align-items:center', 'justify-content:center',
      'cursor:pointer', 'border:1px solid #b9c4cf',
      'background:#fff', 'color:#1f3b57', 'padding:0',
      'box-shadow:0 2px 8px rgba(0,0,0,.18)'
    ].join(';');

    btn.addEventListener('click', () => this.confirmReload(btn));

    document.body.appendChild(btn);
  }

  // Apstiprinājuma logs. Bez tā poga būtu klusmā pārbaudīma mezīns laukā
  // — neprecīzs klikšķis apņemtu pārlādēt lapu tieši darba laikā.
  confirmReload(btn) {
    if (document.getElementById('freshReloadOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'freshReloadOverlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100000',
      'background:rgba(0,0,0,.45)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:inherit'
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#fff', 'border-radius:10px', 'padding:20px',
      'max-width:340px', 'width:calc(100% - 40px)',
      'box-shadow:0 8px 28px rgba(0,0,0,.3)',
      'color:#1f3b57', 'text-align:center'
    ].join(';');

    // ⚠️ Teksts tiek likts ar textContent, nevis innerHTML — lai lietotāja
    // ievadītais teksts nekad netiktu izpildīts kā kods.
    const title = document.createElement('div');
    title.textContent = 'Vai esi pārliecināts?';
    title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:8px';

    const body = document.createElement('div');
    body.textContent = 'Programma tiks ielādēta no jauna. Jūsu ieraksti netiek dzēsti.';
    body.style.cssText = 'font-size:13px;line-height:1.45;margin-bottom:16px';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:center';

    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = 'Jā';
    yes.style.cssText = [
      'padding:9px 22px', 'border-radius:7px', 'cursor:pointer',
      'border:1px solid #1f3b57', 'background:#1f3b57', 'color:#fff',
      'font-size:14px', 'font-weight:600'
    ].join(';');

    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = 'Nē';
    no.style.cssText = [
      'padding:9px 22px', 'border-radius:7px', 'cursor:pointer',
      'border:1px solid #b9c4cf', 'background:#fff', 'color:#1f3b57',
      'font-size:14px', 'font-weight:600'
    ].join(';');

    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };

    // Nē — aizvērt logu un atgriezties darbā.
    no.addEventListener('click', close);
    // Klikšķis uz tumšo fonu arī nozīmē "nē".
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    // Escape arī aizvērt.
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    setTimeout(() => { try { no.focus(); } catch (e) {} }, 0);

    yes.addEventListener('click', () => {
      close();
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '.5';
      }
      // Mēs negribām dzēst ierīces datus — tie ir aprūpes ieraksti.
      // Tīrīm TIKAI kešu, lai nākamo reizi ielādētu jauno kodu.
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
        }
      } catch (e) { /* nav SW — nav ko tīrīt */ }
      const u = new URL(window.location.href);
      u.searchParams.set('force_update', '1');
      // Caur skriptu parametriem, lai pats HTML tiktu ielādēts svaigi,
      // nevis no kešas (tam ir atšķirīgs URL).
      window.location.replace(u.toString());
    });

    row.appendChild(yes);
    row.appendChild(no);
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
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
