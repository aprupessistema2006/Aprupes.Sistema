const SYNC_URL = typeof CONFIG !== 'undefined' ? CONFIG.GAS_URL : null;

// Mērīšanas fasāde.
//
// js/perf.js nav iekļauts visur, kur sync.js tiek izmantots (Node testi,
// minimālās HTML lapas). Tāpēc mēs NEDRĪKST uz to tieši atsaukties —
// lai nejaužas ar ReferenceError un iekšējā loģika paliek tīra.
const _nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const PERF = (typeof Perf !== 'undefined' && Perf) ? Perf : {
  measure: (_label, fn) => fn(),
  sub: () => {},
  skipped: () => {},
  note: () => {},
  markUI: () => {},
  autoSummary: () => {},
  net: (_label, fn) => fn({ onSent: () => {}, onResponse: () => {} })
};

// Vienreizēju brīdinājumu logs. Izmanto reģistru, ja tā ielādēta, un
// vienkāršu atmiņas kešu citādi (Node testi, atsevišķas lapas).
const _throttleCache = new Map();
function _throttleLog(key, windowMs) {
  if (typeof opRegistry !== 'undefined' && opRegistry && typeof opRegistry.throttle === 'function') {
    return opRegistry.throttle(key, windowMs);
  }
  const now = Date.now();
  if (_throttleCache.has(key) && now - _throttleCache.get(key) < windowMs) return false;
  _throttleCache.set(key, now);
  return true;
}

const CACHE_BUSTER = () => Date.now() + '_' + Math.random().toString(36).substr(2, 9);

function getSyncStatusClass(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('kļū') || value.includes('neizdev') || value.includes('error')) return 'sync-badge error';
  if (value.includes('gaida') || value.includes('rindā')) return 'sync-badge pending';
  if (value.includes('sinhronizē')) return 'sync-badge syncing';
  if (value.includes('saglabāts') || value.includes('saved') || value.includes('saglabāt')) return 'sync-badge saved';
  if (value.includes('offline') || value.includes('bezsaist') || value.includes('nav savienojuma')) return 'sync-badge offline';
  return 'sync-badge saved';
}

async function fetchWithTimeout(url, timeout = 8000, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const separator = url.includes('?') ? '&' : '?';
    const urlWithCacheBuster = url + separator + '_t=' + CACHE_BUSTER();
    const response = await fetch(urlWithCacheBuster, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// VIENĪGAIS TRANSPORTS
//
// Situācija, kas tika novērotra uz telefoniem: pirmais pieprasījums
// (bootstrap) atgrieja 200, bet pārējie atgrieza HTTP 404 — pat lai pats
// GAS /exec URL atbildēja kārtīgi (pārbaudīts ar ārēju pieprasījumu).
// Tas nozīmē, ka 404 nerada serveris, bet kaut kas starp pārlūku un GAS:
// reklāmu bloķētājs, DNS filtrēšana vai service worker. JSONP (<script>)
// šīs barjeras apiet, tāpēc dati tomēr ielādējās — bet katrs mēģinājums
// maksāja līdz 126 sekundēm, un lietotājs visu laiku skatīja
// "Ielādēju klientus un darbiniekus...".
//
// LĒMUMS: viens transports, nevis divi pārslēdzami katrā pieprasījumā.
//   1. Mēģinām fetch (ātrāks, dod īstas kļūdas).
//   2. Ja kāds konkrēts ceļš (mode=marks, mode=range, ...) neizdodas
//      FETCH_FAILURES_BEFORE_STICKY reizes, tas ceļš uz sesiju paliek
//      JSONP — mēs vairs nemēģinām fetch tam.
//   3. Kopējā kļūdu skaita līdzstarp → pārejam uz JSONP visai sesijai.
// Rezultāts: 404 parādās konsolē divas reizes, nevis desmitiem, un katrs
// mēģinājums ir ar stingru, īsu laika budžetu.
// ───────────────────────────────────────────────────────────────────────────
const TRANSPORT_DEAD_KEY = 'aprupes.fetchDead';

// localStorage ne vienmēr ir pieejams (privātais režīms, ierīču politika).
// Tāpēc lasīšana ir aizsargāta — transports nedrīkst būt iemesls, kāpēc
// lietotājs nevar strādāt.
function readTransportDead() {
  try { return localStorage.getItem(TRANSPORT_DEAD_KEY) === '1'; }
  catch (e) { return false; }
}

const Transport = {
  // ───────────────────────────────────────────────────────────────────────
  // TRANSPORTA IEVĒLE (2026-09-29)
  //
  // ⚠️ KĀPĒC JSONP IR NOKLUSUMIS
  //
  // Mērījumi reālajā lietojumā (telefons + dators, viena un tā pati lapa):
  //   • Visi RAKSTĪŠANAS pieprasījumi gāja caur JSONP un bija veiksmīgi.
  //   • fetch uz telefona TIMEOUToja katru reizi (8s), pat tad, ja serveris
  //     bija pilnīgi vesels un atbilda par 1,2–1,8s.
  //   • Katrs neizdevušais fetch zondeja 8s (rakstīšana) vai 15s (lasīšana)
  //     tukšas gaidīšanas pirms pārslēgšanās uz JSONP.
  //   • Servera aukstais starts ir 4–9,3s, tāpēc ACTION_FETCH_TIMEOUT = 8s
  //     uz lēnāku ierīci bija GARANTĒTS timeout, lai gan serveris bija vesels.
  //
  // JSONP izmanto <script> tagu — tam NAV CORS prasību, tāpēc tas strādā
  // IDENTISKI uz telefonu, planšeti un datoru. Tas ir vienīgais transports,
  // kura uzvedību var garantēt visās ierīcēs.
  //
  // LĒMUMS: JSONP ir noklusējums. fetch vairs netiek mēģināts PIRMS tam —
  // mēs to izmantojam TIKAI kā rezerves ceļu, ja JSONP neizdodas. Tas
  // noņem 8–15s kļūdas zondēšanu no katras ielādes.
  //
  // Ja kādreiz tomēr vēlēsies atgriezties uz fetch kā noklusējumu, tas ir
  // VIENA rinda:  Transport.mode = 'fetch';
  // ───────────────────────────────────────────────────────────────────────
  mode: 'jsonp',              // 'jsonp' (noklusējums) | 'fetch'
  fetchFailures: 0,
  fetchOk: 0,
  jsonpOk: 0,
  failedModes: new Map(),     // modeKey -> kļūdu skaits
  lastError: null,
  // Iegultā atmiņa pārdzīvo lapas pārlādēšanai. Bez tā katra ielāde
  // no jauna mēģina fetch un maksā 15s, ja tas neizdodas.
  fetchKnownDead: readTransportDead(),

    FETCH_TIMEOUT: 20000,       // bija 120000 — GAS aukstais starts ir 3–10s
    JSONP_TIMEOUT: 25000,       // bija 120000
    // ⚠️ Šis Timeout bija 8000ms, bet novērotā realitāte ir 4–9,3s aukstajā
    // startā un 1,2–1,8s silenī. Astes sekundes BEZ MARĒĶINĀJUMA nozīmēja,
    // ka katrs rakstīšanas pieprasījums uz lēnāku ierīci tika nogadāts, lai
    // gan serveris bija vesels — tāpēc rindas kavējās un parādījās kļūdas,
    // kuras neko neizteica.
    ACTION_FETCH_TIMEOUT: 20000,
  // fetch limits lasīšanai (šis vairs netiek izmantots kā noklusējums,
  // bet paliek, ja kāds manuāli pārslēdz uz fetch).
  FETCH_PROBE_TIMEOUT: 20000,
    FETCH_FAILURES_BEFORE_STICKY: 2,

  shouldSkipFetch(url) {
    if (this.mode === 'jsonp') return true;
    // ⚠️ IZMEKLĒŠANAS CENA. Katrs fetch mēģinājums, kas neizdodas, maksā
    // līdz FETCH_PROBE_TIMEOUT (15s lasīšanai) tukšas gaidīšanas. Bez
    // atmiņas katrs pārlādējums to maksā no jauna, un lietotājs redz
    // 34.7s auksto sākumu, kurā 15s ir mirkļa laiks.
    //
    // Mērījums 2026-09-28 no servera puses: 4.44 / 4.53 / 4.54 / 4.92s un
    // HTTP 200 ar Access-Control-Allow-Origin: * — tātad fetch ŠAI adresē
    // strādā. Pārlūkā tas reizēm atgriež 404.
    //
    // LĒMUMS: atmiņā saglabājam, nevis izmēģinām katru reizi. Kad fetch
    // ir pierādījis, ka strādā, izmantojam to ar pilnu timeout. Kad tas ir
    // FETCH_FAILURES_BEFORE_STICKY reizes neizdevies, vairs to nemēģinām
    // NEBUDU — ne šai sesijai, ne visās nākamajās.
    if (this.fetchKnownDead) return true;
    const n = this.failedModes.get(this._modeKey(url)) || 0;
    return n >= this.FETCH_FAILURES_BEFORE_STICKY;
  },

  // localStorage var nebūt pieejams (privātais režīms, ierīču politika).
  // Tāpēc katrai lasīšanai/rakstīšanai ir aizsargājums — transports nedrīkst
  // būt iemesls, kāpēc lietotājs nevar strādāt.
  _persist(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch (e) { /* ignorējam */ }
  },

  _modeKey(url) {
    const m = /[?&]mode=([^&]*)/.exec(url);
    return m ? 'mode=' + m[1] : 'action';
  },

  noteSuccess(usedFetch) {
    if (usedFetch) {
      this.fetchOk++;
      this.fetchKnownDead = false;
      this._persist(TRANSPORT_DEAD_KEY, null);
    } else {
      this.jsonpOk++;
    }
  },

  noteFetchFailure(url, err) {
    this.fetchFailures++;
    this.lastError = err && err.message;
    const key = this._modeKey(url);
    this.failedModes.set(key, (this.failedModes.get(key) || 0) + 1);
    if (this.fetchFailures >= this.FETCH_FAILURES_BEFORE_STICKY && this.mode !== 'jsonp') {
      this.mode = 'jsonp';
      this.fetchKnownDead = true;
      this._persist(TRANSPORT_DEAD_KEY, '1');
      console.warn(
        '[sync] 🔁 TRANSPORTS: pārejos uz JSONP (fetch neizdevās ' +
        this.fetchFailures + ' reizes: ' + this.lastError + '). ' +
        'Šis lēmums ir SAGLABĀTS — vairs nemēģināsim fetch ne šajā, ne ' +
        'turpmākajās sesijās, tāpēc ielāde vairs neapmaksās 15s zondi.'
      );
    }
  },

  reset() {
    this.mode = 'jsonp';
    this.fetchFailures = 0;
    this.fetchOk = 0;
    this.jsonpOk = 0;
    this.failedModes.clear();
    // `reset()` nozīmē "sākt no jauna", tāpēc arī iekšējo un ārējo atmiņu.
    this.fetchKnownDead = false;
    this._persist(TRANSPORT_DEAD_KEY, null);
  },

  stats() {
    return {
      mode: this.mode,
      fetchOk: this.fetchOk,
      jsonpOk: this.jsonpOk,
      fetchFailures: this.fetchFailures,
      fetchKnownDead: this.fetchKnownDead,
      failedModes: Array.from(this.failedModes.entries()),
      lastError: this.lastError
    };
  }
};

if (typeof globalThis !== 'undefined') globalThis.Transport = Transport;

// transports lēmums jābūt redzams, nevis neredzams.
if (Transport.mode === 'jsonp') {
  console.log(
    '[sync] ⏩ TRANSPORTS: JSONP (noklusējums). Tas strādā identiski uz ' +
    'telefonu, planšeti un datoru, jo tam nav CORS prasību. ' +
    '(fetch kā rezerve, ja JSONP neizdodas)'
  );
}

// Primārais transports: fetch() + tīrs JSON.
async function fetchRequest(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = new Error('Serveris atbildēja ar HTTP ' + res.status);
      err.httpStatus = res.status;
      throw err;
    }
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Serveris atgrieza tukšu atbildi');
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // Ja tomēr atgriezts JSONP, izpakojam to
      const m = /^[^({]*\(([\s\S]*)\)\s*;?\s*$/.exec(trimmed);
      if (m) {
        try { return JSON.parse(m[1]); } catch (e2) { /* tālāk */ }
      }
      throw new Error('Neatpazīsta servera atbildi');
    }
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new Error('Timeout');
    if (e && e.permanent) throw e;
    const err = new Error(e && e.message ? e.message : 'Savienojuma kļūda');
    if (e && e.httpStatus) err.httpStatus = e.httpStatus;
    throw err;
  }
}

// Rezerves transports — JSONP (<script>), ja fetch neizdevās.
function jsonpRequest(url, timeout = Transport.JSONP_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_cb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    let script;
    let resolved = false;

    const cleanup = () => {
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
      // Timeout gadījumā GAS var vēl atsaukties mūsu callback — nomet to
      // nevis uzreiz, bet pēc 30s, lai callback function nepaliek atmiņā
      // mūžīgi un nevartu pārņemt nākamo pieprasījumu.
      if (resolved && window[callbackName]) {
        const drop = () => { delete window[callbackName]; };
        setTimeout(drop, 30000);
        resolved = false; // neļauj atkārtotu drop
      }
    };

    const done = (fn, arg) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanup();
      fn(arg);
    };

    const timer = setTimeout(() => {
      resolved = true;
      clearTimeout(timer);
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
      reject(new Error('Timeout'));
    }, timeout);

    window[callbackName] = function (data) {
      delete window[callbackName];
      done(resolve, data);
    };

    const separator = url.includes('?') ? '&' : '?';
    const jsonpUrl = url + separator + 'callback=' + callbackName;
    script = document.createElement('script');
    script.src = jsonpUrl;
    script.onerror = function () {
      delete window[callbackName];
      done(reject, new Error('Savienojuma kļūda'));
    };
    const target = document.head || document.documentElement;
    target.appendChild(script);
  });
}

// Galvenais pieprasījumu funkcija. Vienā vietā izvēlas transportu, lai
// katrs izsaukētais nezinātu par JSONP atkārtošanos.
async function requestData(url, timeout) {
  const sep = url.includes('?') ? '&' : '?';
  const stamp = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const urlWithCacheBuster = url + sep + '_t=' + stamp;
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  // fetch ceļš neizmanto callback parametru — GAS tad atgriež tīru JSON
  const jsonUrl = url.replace(/([?&])callback=[^&]*&?/, '$1').replace(/[?&]$/, '');

  // ⚠️ BUDŽETS. `timeout` ir visas ŠĀ pieprasījuma maksimālais laiks, nevis
  // katra transporta atsevišķais limits. Vecākais kods to padzina abiem:
  //
  //     fetchRequest(jsonUrl, timeout)        // 35s
  //     jsonpRequest(url, timeout)             // vēl 35s  → 70s
  //
  // un tad _requestWithRetry to atkārtoja vēlreiz → līdz 140s. Tas bija
  // tieši tas, ko lietotājs redzēja žurnālā: "mēģinājums 1/2, 70012ms"
  // un kopējā sinhronizācija 85 sekundes.
  //
  // Tagad: fetch ir IZMEKLĒŠANA (vai CORS/404 to bloķē?) un tā saņem savu
  // mazo budžetu. JSONP saņem PĀRĒJU no visas budžeta, tāpēc kopējais
  // laiks vienmēr ietilpst izsauktāja ierobežojumā.
  const budget = timeout || Transport.JSONP_TIMEOUT;
  const elapsed = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
  const isAction = Transport._modeKey(url) === 'action';

  // Izmeklēšanai pietiek 15s. Mērījumi (2026-09-28) pret jauno deploy
  // URL: 4.6 / 5.2 / 5.7 / 5.9 / 12.1 / 12.3 s — tāpēc 15s aptver
  // visu normālu gadījumu, arī auksto sākumu, bet neļauj 35s iztērēt
  // tam, kas acīmredzami nedarbosies.
  const probeTimeout = isAction
    ? Transport.ACTION_FETCH_TIMEOUT
    : Math.min(Transport.FETCH_PROBE_TIMEOUT, budget);

  // JSONP ir NOKLUSĒJUMS (skat. Transport komentu). Tas strādā identiski
  // uz telefonu, planšeti un datoru, jo <script> tagam nav CORS prasību.
  //
  // jsonpRequest() pats pievieno callback parametru. Saņem TIKAI
  // atlikušo no sākotnējā budžeta, lai kopējais laiks nepārsniedz
  // izsauktāja ierobežojumu. Grīda ir 1000ms — zem tās pieprasījums
  // jebkurā gadījumā neatgrieztos, un tā tomēr ir mazāka par jebkuru
  // reālu budžetu (2000–35000ms).
  const remaining = Math.max(1000, budget - elapsed());

  if (Transport.mode !== 'fetch') {
    try {
      const data = await jsonpRequest(urlWithCacheBuster, remaining);
      Transport.noteSuccess(false);
      PERF.sub('transport', 'jsonp', elapsed());
      return data;
    } catch (jsonpErr) {
      // JSONP neizdevās. Tas ir nega zīme — mēģinām fetch kā rezervi,
      // lai mēs nekad nepaliktos bez datiem.
      console.warn('[sync] JSONP neizdevās (' + jsonpErr.message +
        '), mēģinu fetch kā rezerves ceļu.');
      const fbTimeout = Math.max(3000, Math.min(Transport.FETCH_TIMEOUT, budget - elapsed()));
      const data = await fetchRequest(jsonUrl, fbTimeout);
      Transport.noteSuccess(true);
      PERF.sub('transport', 'fetch (rezerve)', elapsed());
      return data;
    }
  }

  // Režīms 'fetch' (manuāli pārslēgts). Tas ir veco ceļu, ja kāds to vēlas.
  try {
    const result = await fetchRequest(jsonUrl, probeTimeout);
    Transport.noteSuccess(true);
    PERF.sub('transport', 'fetch', elapsed());
    return result;
  } catch (err) {
    Transport.noteFetchFailure(url, err);
    if (_throttleLog('jsonp-fallback:' + Transport._modeKey(url), 30000)) {
      console.warn(
        '[sync] fetch neizdevās (' + err.message + ' pēc ' + Math.round(probeTimeout / 1000) +
        's) → pāreju uz JSONP.'
      );
    }
    const data = await jsonpRequest(urlWithCacheBuster, Math.max(1000, budget - elapsed()));
    Transport.noteSuccess(false);
    PERF.sub('transport', 'jsonp', elapsed());
    return data;
  }
}

// Request deduplication — prevent parallel identical requests
const pendingActions = new Map();

async function jsonpAction(action, data, timeout = 30000) {
  const actionKey = action + ':' + JSON.stringify(data);

  if (pendingActions.has(actionKey)) {
    console.log('[sync] jsonpAction deduplicated:', actionKey);
    return pendingActions.get(actionKey);
  }

  const payload = encodeURIComponent(JSON.stringify({ action: action, data: data }));
  let url = SYNC_URL + '?data=' + payload;
  console.log('[sync] jsonpAction SENDING:', action, JSON.stringify(data));

  const promise = requestData(url, timeout)
    .then(result => {
      console.log('[sync] jsonpAction RESPONSE:', action, JSON.stringify(result));
      return result;
    })
    .catch(err => {
      console.error('[sync] jsonpAction ERROR:', action, err.message);
      throw err;
    })
    .finally(() => {
      pendingActions.delete(actionKey);
    });

  pendingActions.set(actionKey, promise);
  return promise;
}

// POST-based action for write operations
// Uses JSONP (GET) since GAS doesn't support CORS for fetch POST.
// This is equivalent to jsonpAction but with a distinct key prefix.
async function postAction(action, data, timeout = 30000) {
  return jsonpAction(action, data, timeout);
}

function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || isNaN(serial) || serial <= 0 || serial > 100000) return null;
  var d = new Date((serial - 25569) * 86400000);
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() < 1900 || d.getFullYear() > 2100) return null;
  return d;
}

// Spec 4.1: operationId ir unikāla identitāte, ģenerēta klientā.
// employeeId iekļauts, lai divi dažāgi lietotāji nevarētu kollīdzinēt operationId.
// payload_hash NAV iet (divas vienādas pēc satura darbības IR divas dažādas operācijas).
function generateOperationId(employeeId) {
  var ts = Date.now();
  var rand = Math.random().toString(36).substr(2, 9);
  return 'op_' + (employeeId || 'unknown') + '_' + ts + '_' + rand;
}

function normalizeKey(h) {
  return String(h)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ /g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function normalizeRow(raw) {
  if (!raw) return raw;
  const row = { ...raw };
  const datePart = (value) => {
    if (!value) return '';
    const match = String(value).match(/^\s*(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
  };
  const timePart = (value) => {
    if (!value) return '';
    const match = String(value).match(/(?:T|\s)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return '';
    const hour = String(parseInt(match[1], 10)).padStart(2, '0');
    const minute = match[2];
    const second = match[3] || '00';
    return hour + ':' + minute + ':' + second;
  };

  const eventTime = row.eventTime || row.notikuma_laiks || row.skaits || '';
  const eventDate = datePart(eventTime);
  const explicitDate = row.date || row.datums || '';
  const createdDate = datePart(row.created || row.izveidots);
  // ⚠️ ŠIS PIRMAKUMU PASKAIROJUMĀ BIJA KLUSS DATU ZAUDĒJUMS.
  //
  // `datums` ir DIENA, kurā pakalpojums tiek sniegts, un tas ir vienīgais
  // autoritatīvais lauks. `notikuma_laiks` / `skaits` ir tikai laika zīme, un
  // tā dažām rindām ir BOJĀTA: vecākais serveris rakstīja to ar samainītiem
  // mēnesi un dienu (`2026-10-02` → `2026-02-10`, `2026-10-04` → `2026-04-10`).
  //
  // Iepriekš šeit `eventDate` tika likts PIRMS `datums`, tāpēc katrai ielādētai
  // rindai tika pārrakstīts `datums` ar bojāto vērtību. Seka: vēstures tabula,
  // mēneša skata diapazons (`statRange`) un "šodienas" filtrs visi rādīja
  // februāra un novembra datumus, un oktobra mēnesis bija tukšs.
  //
  // `datums` ir pirmais, laika zīme — tikai rezerve.
  const normalizedDate = datePart(explicitDate) || eventDate || createdDate || '';
  if (normalizedDate) row.datums = normalizedDate;

  const map = {
    date: 'date',
    datums: 'date',
    clientId: 'clientId',
    clientid: 'clientId',
    klientsId: 'clientId',
    klients_id: 'clientId',
    employeeId: 'employeeId',
    employeeid: 'employeeId',
    darbinieksId: 'employeeId',
    darbinieks_id: 'employeeId',
    markId: 'markId',
    markid: 'markId',
    atzimesId: 'markId',
    atzimes_id: 'markId',
    shift: 'shift',
    periods: 'shift',
    category: 'category',
    kategorija: 'category',
    field: 'field',
    lauka_nosaukums: 'field',
    value: 'value',
    vertiba: 'value',
    vertiba2: 'value',
    lastModified: 'lastModified',
    lastmodified: 'lastModified',
    pedejaLaiks: 'lastModified',
    pedeja_laiks: 'lastModified',
    pedejaisLaiks: 'lastModified',
    pedejais_laiks: 'lastModified',
    lastBy: 'lastBy',
    darbinieksPedejais: 'lastBy',
    darbinieks_pedejais: 'lastBy',
    darbinieks_pedejais_id: 'lastBy',
    prevValue: 'lastValue',
    ieprijuma: 'lastValue',
    iprijuma: 'lastValue',
    pievienots: 'lastValue',
    created: 'created',
    izveidots: 'created',
    time: 'time',
    laiks: 'time',
    eventtime: 'eventTime',
    event_time: 'eventTime',
    notikumaLaiks: 'eventTime',
    notikuma_laiks: 'eventTime',
    reason: 'reason',
    papilgsInfo: 'reason',
    papilgs_info: 'reason',
    action_id: 'actionId',
    atzimes_id: 'markId',
    pedeja_vertiba: 'lastValue',
    pedeja_laiks: 'lastModified',
    darbinieks_pedejais: 'lastBy',
    pieskirtDarbiniekamId: 'pieskirtDarbiniekamId',
    pieskirt_darbiniekam_id: 'pieskirtDarbiniekamId',
    irPabeigts: 'irPabeigts',
    ir_pabeigts: 'irPabeigts',
    pabeigts: 'irPabeigts',
    pabeigt: 'irPabeigts',
    pabeigtsLaiks: 'pabeigtsLaiks',
    pabeigts_laiks: 'pabeigtsLaiks',
    pabeigtajsId: 'pabeigtajsId',
    pabeigtajs_id: 'pabeigtajsId',
    vards: 'vards',
    uzvards: 'uzvards',
    pin: 'pin',
    pinKods: 'pin',
    pin_kods: 'pin',
    parole: 'parole',
    dzimsanas_datums: 'dzimis',
    dzimšans_datums: 'dzimis',
    dzimis: 'dzimis',
    birth_date: 'dzimis',
    date_of_birth: 'dzimis',
    dieta: 'dieta',
    diet: 'dieta',
    saskarsmes: 'saskarsmes',
    saskarsmesīpatnības: 'saskarsmes',
    saskarsmes_ipatnibas: 'saskarsmes',
    contacts: 'saskarsmes',
    contact: 'saskarsmes'
  };

  const normalizedRow = {};
  Object.keys(row).forEach(k => {
    const nk = normalizeKey(k);
    if (map[nk]) {
      if (normalizedRow[map[nk]] === undefined) normalizedRow[map[nk]] = row[k];
    } else {
      normalizedRow[nk] = row[k];
    }
  });

  // Ensure id is set for IndexedDB key — handle 'ID', 'Id', 'id' etc.
  if (!normalizedRow.id) {
    const idKey = Object.keys(row).find(k => normalizeKey(k) === 'id');
    if (idKey) normalizedRow.id = row[idKey];
  }
  if (eventTime) normalizedRow.eventTime = eventTime;
  if (row.skaits !== undefined) normalizedRow.skaits = row.skaits;
  if (row.notikuma_laiks !== undefined) normalizedRow.notikuma_laiks = row.notikuma_laiks;
  if (normalizedDate) normalizedRow.date = normalizedDate;

  if (typeof normalizedRow.date === 'number') {
    console.warn('[normalizeRow] numeric date not converted (not Excel serial):', normalizedRow.date, 'for id:', normalizedRow.id);
  }

  const idTs = String(normalizedRow.id || '').match(/^[a-z]+_(\d{10,13})/);
  if (idTs && !normalizedRow.date) {
    const d = new Date(parseInt(idTs[1], 10));
    const y = d.getFullYear();
    if (!isNaN(d.getTime()) && y >= 2000 && y <= 2100) {
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      normalizedRow.date = y + '-' + m + '-' + day;
    }
  }

  if (normalizedRow.clientId && !normalizedRow.klientsId) normalizedRow.klientsId = normalizedRow.clientId;
  if (normalizedRow.employeeId && !normalizedRow.darbinieksId) normalizedRow.darbinieksId = normalizedRow.employeeId;

  const timeVal = normalizedRow.time;
  const eventTimeVal = normalizedRow.eventTime || normalizedRow.skaits;
  const looksValidTime = timeVal && /^\d{2}:\d{2}:\d{2}$/.test(String(timeVal));
  if (!looksValidTime && eventTimeVal) {
    const eventTimeOnly = timePart(eventTimeVal);
    if (eventTimeOnly) normalizedRow.time = eventTimeOnly;
  }
  if (!normalizedRow.time) {
    const createdVal = normalizedRow.created;
    if (createdVal && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(createdVal))) {
      const t = String(createdVal).match(/T(\d{2}:\d{2}:\d{2})/);
      if (t) normalizedRow.time = t[1];
    }
  }

  return normalizedRow;
}

class CareSync {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.syncing = false;
    this.loaded = false;
    this._queueProcessing = false;
    this._queueTimer = null;
    this._loading = false;
    this._syncTail = Promise.resolve();
    this._connectionStatus = 'unknown';
    // Kad pēdējoreiz veiksmīgi ielādēti dati no Google (ms epoch, 0 = nekad)
    this._lastGoodLoad = 0;
    // Cik sekundes datus uzskatām par svaigiem — lietotājs, kas divreiz
    // nospieda "Sinhronizēt" vai atvērt divas sadaļas, nedrīkst palaist
    // otru identisku bootstrap.
    this.FRESH_MS = 60000;
    // Cik ilgi pēc PABEIGTAS pilnās ielādes identisku ceļu vēl nedrīkst
    // palaist. ACTIVE bloķēšana aptur tikai paralēlos izsaukumus; šis
    // logs aptur secīgus atkārtojumus (3 ielādes pēc kārtas = 80+ sekundes).
    // Lietotāja apzināta "Sinhronizēt" (force) to ignorē.
    this.REPEAT_COOLDOWN_MS = 20000;
    // Cik dienu aprūpes ierakstus ielādēt sākuma ekrānam. Tas ir
    // vienīgais papildus datu ielādes ceļš; pārējo vēsturi ielādē tikai
    // konkrēta klienta atvēršanai.
    this.RECENT_DAYS = 31;
    // ⚠️ ŠIS Limits vairs NEDARBOJAS un to nedrīkst atjaunot.
    //
    // Vecajā uzvedībā pēc 5 neizdevušiem mēģinājumiem ieraksts tika
    // arhivēts un DZĒSTS no rindas. Ar 2 sekunžu intervāliem tas nozīmēja,
    // ka ~7 sekunšu tīkla mirkšņis nezaudēja datus, kura patiesībā bija
    // derīgi. Tagad pārejošas kļūdas (tīkls, timeout, nepieejamība)
    // nekad nepārtrauk sūtīšanu — tās nav lēmums, tās ir "vēl nav".
    this.MAX_QUEUE_RETRIES = 5;   // ⚠️ vairs netiek izmantots kā filtrs
    this._setupOfflineDetection();
    this._startQueuePump();
  }

  // ── Fona sūtīšana ──────────────────────────────────────────────────────────
  //
  // ⚠️ KĀPĒC TAS VAJADZ (2026-09-29)
  //
  // Agrāk rindu apstrādāja TIKAI trīs brīžos: pēc saglabāšanas, pēc datu
  // ielādes un `online` notikumā. Ja telefonā pārslāca no WiFi uz mobilo
  // vai Signāls mirkst un atgriežas, NEKAD nenotika neviens no šiem
  // trim brīžiem — ieraksts palika rindā līdz nākamajai lietotnes
  // atvēršanai, kas aprūpētājai nozīmē "nepieciešams, bet nezināms".
  //
  // Šis pulkstis pārbauda rindu ik pēc minūtes un, ja kaut kas ir
  // neizsūtīts, mēģina to atsūtīt. Tas notiek FONĀ, netraucē nevienu
  // ekrānu un netērē enerģiju, ja rinda ir tukša — tad tiek izlasīts
  // tikai skaitlis no IndexedDB.
  _startQueuePump() {
    if (this._queuePump) return;          // jau palaists
    this._queuePump = setInterval(() => {
      // Nevis Visible lapā vai jau strādā — neko darīt nevajag.
      if (this._queueProcessing) return;
      this.getUnsyncedCount()
        .then(n => {
          // Indikators jāatjaunina pat tad, ja neko nav ko sūtīt —
          // citādi pēdējais ieraksts var palikt redzams, pat ja
          // fona sūtīšana to jau ir panākusi.
          this._renderUnsyncedBadge(n);
          if (n > 0) this.processQueue().catch(() => {});
        })
        .catch(() => {});
    }, 60_000);

    // Lietotājs atgriežas pie ekrāna — tas ir brīdis, kurā ir visvairāk
    // lietderīgi agresīvi mēģināt atsūtīt. Līdz šim tas notika tikai
    // ielādē, kas uz telefonā var būt vairākas minūtes atpakaļ.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (this._queueProcessing) return;
        this.getUnsyncedCount()
          .then(n => { if (n > 0) this.processQueue().catch(() => {}); })
          .catch(() => {});
      });
    }
  }

  // ── Rindas stāvokļi ────────────────────────────────────────────────────────
  //
  // GALĪGIE stāvokļi: šo ierakstu rinda vairs NEDOS sūtīt, un tas netiks
  // arī skaitīts par "nesaglabātu". Tie tiek arhivēti uz sync_audit un
  // noņemti.
  //
  // ⚠️ Kāpēc arī KONFLIKTS un BLOKKĒTS ir galīgi.
  //
  // Šie ieraksti JAU ir nosūtīti serverim, un serveris uz to jau atbildēja
  // (kā konflikts vai kā bloķēts) — tāpēc Google Sheets ir galīgais
  // avots, nevis šis ierīcē paliekais vecoļais.
  //
  // Vecākajā versijā tie netika arhivēti un palika rindā mūžmūžīgi, jo
  // šai lietojumā NAV nevienas UI, ar ko lietotājs šādu konfliktu varētu
  // atrisināt. Rezultāts bija trīs lietas uz reizi:
  //   • processQueue to izlaida 1 ms laikā, katru reizi no jauna;
  //   • iziešanas dialogs bezgalzīgi rādīja "Ir nesaglabāti dati";
  //   • atjauninājuma poga neko nevarēja izdarīt, jo rinda nekad
  //     neiztukšoja.
  //
  // Vienīgais godīgs risinājums ir šādu ierakstu pamanīt, nevis likt
  // lietotājam neko neizdarāmu.
  static get QUEUE_TERMINAL() {
    return new Set([
      'AIZVIETA',      // aizstāts ar jaunāku ierakstu
      'ATCELTS',       // lietotājs atcēla
      'PIEŅEMTS',      // serveris jau pieņēma
      'NEVAR ATKĀRTOT', // serveris noliedz atkārtošanu
      'KONFLIKTS',     // serverim ir jaunāka versija — tā ir patiesība
      'BLOKKĒTS',      // serveris bloķēja — šī ierīce nevar to atrisināt
      'NORAIDĪTS'      // serveris noraidīja bez skaidra iemesla
    ]);
  }

  // Vai šis rindas ieraksts tiek vēl sūtīts? Atbilde ir viens avots
  // gan skaitīšanai dialogā, gan rindas apstrādei.
  //
  // ⚠️ DATU ZUDUMA KĻŪDA, kas tika novērsta 2026-09-29
  //
  // Vecajā kodā bija arī šis:
  //     if ((item.retries || 0) >= this.MAX_QUEUE_RETRIES) return false;
  //
  // Tā nozīmēja, ka pēc 5 mēģinājumiem ieraksts kļuva "miris" un
  // `_purgeDeadQueueItems()` to arhivēja un DZĒSA no rindas. Ar
  // `backoff = [800, 2000]` pieci mēģinājumi aizņem apmēram 7 sekundes —
  // tātad TĪKLA MIRKŠĆIS UZ 10 SEKUNDĒM nezaudēja datus. Ne tikai
  // neizdevās nosūtīt, bet gan pavisam izmeta aprūpes ierakstu, kura
  // patiesībā bija derīgs, un `sync_audit` pat neuzglabāja vērtību —
  // tikai ID, lauku un mēģinājumu skaitu.
  //
  // TIKAI servera GALĪGIE lēmumi var padarīt ierakstu galīgu. Tīkla
  // kļūda, servera nepieejamība vai timeout nav galīgs lēmums — tas
  // ir "vēl nav", un tāds ieraksts tiek sūtīts atkal un atkal, līdz
  // tas patiešām nonāk Google Sheetā.
  isQueueItemPending(item) {
    if (!item) return false;
    if (CareSync.QUEUE_TERMINAL.has(item.status)) return false;
    return true;
  }

  // Cik ilgi jāgaida pirms nākamā mēģinājuma. Pakāpeniski aug, lai
  // neķildētu Google, bet NEKAD neapstājas.
  //
  // Vecajā skēns bija `Math.min(attempt, backoff.length - 1)` — tas
  // nofiksēja intervālu uz 2 sekundēm uz visiem mēģinājumiem pēc trešā.
  retryDelayMs(attempt) {
    const a = Math.max(0, attempt - 1);
    // 15 s → 30 s → 60 s → ... → 10 min
    return Math.min(15_000 * Math.pow(2, a), 600_000);
  }

  // Iemesls, kāpēc ieraksts ir galīgs — glabājas sync_audit, lai
  // attīstītājs varētu redzēt, kas notika, neizgriezot datus klusējot.
  deadReason(item) {
    switch (item.status) {
      case 'AIZVIETA': return 'superseded';
      case 'ATCELTS': return 'cancelled';
      case 'PIEŅEMTS': return 'already_accepted';
      case 'NEVAR ATKĀRTOT': return 'not_retryable';
      case 'KONFLIKTS': return 'server_has_newer';
      case 'BLOKKĒTS': return 'server_blocked';
      case 'NORAIDĪTS': return 'server_rejected';
      default: return 'unknown';
    }
  }

  // Noņem galīgos ierakstus no rindas, pirms tam arhivējot tos uz
  // sync_audit. Tas novērš gan Phantom brīdinājumu, gan rindas mūžmūžīgu
  // pieaugšanu. Atgriež noņemto ierakstu skaitu.
  async _purgeDeadQueueItems() {
    let items;
    try { items = await this.db.getAll('sync_queue'); }
    catch (e) { return 0; }
    const dead = items.filter(i => !this.isQueueItemPending(i));
    for (const item of dead) {
      await this._archiveItem(item, this.deadReason(item));
    }
    if (dead.length) {
      console.log('[sync] noņemti ' + dead.length + ' galīgie rindas ieraksti: ' +
        dead.map(i => (i.status || 'BEZ STATUSA') + (i.retries >= this.MAX_QUEUE_RETRIES ? ' (max retries)' : '')).join(', '));
    }
    return dead.length;
  }

  // Reģistra saīsne. Ja js/operation_registry.js nav ielādēts (piem. testi),
  // izmazgājam ar vienkāršu in-line fallback, lai nekas neuzlūdz.
  get _registry() {
    if (typeof opRegistry !== 'undefined' && opRegistry) return opRegistry;
    if (!this.__fallbackRegistry) {
      const entries = new Map();
      this.__fallbackRegistry = {
        run(key, fn) {
          if (entries.has(key)) return { started: false, promise: entries.get(key) };
          const p = Promise.resolve().then(fn);
          entries.set(key, p);
          p.finally(() => entries.delete(key));
          return { started: true, promise: p };
        },
        throttle: () => true,
        isActive: (k) => entries.has(k),
        stats: () => [],
        logSummary: () => {}
      };
    }
    return this.__fallbackRegistry;
  }

  isFresh() {
    return !!this._lastGoodLoad && (Date.now() - this._lastGoodLoad) < this.FRESH_MS;
  }

  _runExclusive(operation) {
    const run = this._syncTail.then(operation, operation);
    this._syncTail = run.catch(() => {});
    return run;
  }

  // Vienas un tās pašas darbības izpilde — vienu reizi.
  //
  // atslēga: piem. 'load:initial' vai 'load:marks'
  // atgriež pašu Promise, ja darbība jau izpildās. Tas ir galvenais
  // mehānisms, kas novērš "viena darbība = 3 sinhronizācijas".
  //
  // opts: { force, cooldownMs } — skat. operation_registry.js
  _runOnce(key, fn, opts) {
    return this._registry.run(key, fn, opts);
  }

  _setupOfflineDetection() {
    const updateStatus = () => {
      if (!navigator.onLine) {
        this._connectionStatus = 'offline';
        this._updateSyncStatus('Nav savienojuma');
      }
    };
    updateStatus();
    window.addEventListener('online', () => {
      updateStatus();
      // Savienojums atgriezies — atjaunini, TIKAI ja dati nav svaigi.
      // Agrāk šeit bija forceFullSync(), kas pēc katra "online"
      // notikuma dzināja pilnu bootstrap, pat ja dati jau bija ielādēti.
      if (this.isFresh()) {
        console.log('[sync] ⏭ Savienojums atgriezies, bet dati jau svaigi — neielādēju atkārtoti.');
        return;
      }
      this.loadInitialData().catch(() => {});
    });
    window.addEventListener('offline', updateStatus);
  }

  _updateSyncStatus(status) {
    try {
      const event = new CustomEvent('syncStatusChange', { detail: status });
      window.dispatchEvent(event);
    } catch (e) {}
  }

  // ── Pastāvīgais "nav nosūtīts" indikators ────────────────────────────────
  //
  // ⚠️ KĀPĒC TAS NEVAR BŪT PAZIŅOJUMS
  //
  // Aprūpētājs strādā blakus klientam, nevis pie ekrāna. Ieskatoties uz
  // telefonu, nevis uz Jāni. Īss paziņojums (2 sekundes) šeit ir nepiemērots:
  // brīdinājums par to, ka dati vēl nav Google Sheetā, ir jābūt redzamam
  // TIEKAM, kamēr tas ir aktuāls — nevis līdz paziņojums izgaist.
  //
  // Šis indikators:
  //   • parādās TIKAI tad, kad ir neizsūtīti ieraksti;
  //   • pazūd automātiski, tiklīdz rinda ir tukša;
  //   • nav jāaizvērš ar roku — tas nav paziņojums;
  //   • dod "Mēģināt tagad" pogu, lai negaidītu nākamo minūtes pārbaudi.
  _renderUnsyncedBadge(count) {
    if (typeof document === 'undefined' || !document.body) return;
    const ID = 'unsyncedBadge';
    let el = document.getElementById(ID);

    if (!count || count <= 0) {
      if (el) el.parentNode.removeChild(el);
      return;
    }

    if (!el) {
      el = document.createElement('div');
      el.id = ID;
      el.style.cssText = [
        'position: fixed', 'bottom: 0', 'left: 0', 'right: 0',
        'z-index: 10002',
        'background: #B26A00', 'color: #fff',
        'padding: 10px 14px',
        'font-family: system-ui, -apple-system, "Segoe UI", sans-serif',
        'font-size: 15px', 'font-weight: 600',
        'display: flex', 'align-items: center', 'gap: 10px',
        'flex-wrap: wrap',
        'box-shadow: 0 -3px 12px rgba(0,0,0,0.28)',
        'padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px))'
      ].join(';');

      const label = document.createElement('span');
      label.style.cssText = 'flex: 1 1 auto; min-width: 160px;';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Mēģināt tagad';
      btn.style.cssText = [
        'background: #fff', 'color: #B26A00', 'border: none',
        'padding: 9px 16px', 'border-radius: 8px',
        'font-size: 15px', 'font-weight: 700', 'cursor: pointer'
      ].join(';');
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = 'Sūtu…';
        this.processQueue()
          .catch(() => {})
          .finally(() => { btn.disabled = false; btn.textContent = 'Mēģināt tagad'; });
      });

      el.appendChild(label);
      el.appendChild(btn);
      document.body.appendChild(el);
    }

    const label = el.firstChild;
    if (label) {
      label.textContent = count === 1
        ? '⏳ 1 ieraksts vēl nav Google Sheetā'
        : '⏳ ' + count + ' ieraksti vēl nav Google Sheetā';
    }
  }

  // Atjaunina gan paziņojumu, gan pastāvīgo indikatoru. Izsauc no visur,
  // kur mainās rindas stāvoklis.
  async _refreshUnsyncedIndicator() {
    try {
      const n = await this.getUnsyncedCount();
      this._renderUnsyncedBadge(n);
      return n;
    } catch (e) {
      return 0;
    }
  }

  async checkConnection() {
    if (!navigator.onLine) {
      this._connectionStatus = 'offline';
      this._updateSyncStatus('Nav savienojuma');
      return { connected: false, status: 'offline', message: '🔴 Nav interneta savienojuma.' };
    }
    if (!SYNC_URL) {
      this._connectionStatus = 'offline';
      this._updateSyncStatus('Nav savienojuma');
      return { connected: false, status: 'offline', message: '🔴 Nav interneta savienojuma.' };
    }
    try {
      const url = SYNC_URL + '?action=ping&t=' + Date.now();
      const data = await requestData(url, 15000);
      if (data && (data.success === true || data.pong === true)) {
        this._connectionStatus = 'connected';
        this._updateSyncStatus('Saglabāts');
        return { connected: true, status: 'connected', message: '✅ Google Sheets savienojums aktīvs' };
      }
      this._connectionStatus = 'error';
      this._updateSyncStatus('Sinhronizācijas kļūda');
      return { connected: false, status: 'error', message: '⚠️ Neizdevās sazināties ar serveri.' };
    } catch (err) {
      this._connectionStatus = 'error';
      this._updateSyncStatus('Sinhronizācijas kļūda');
      return { connected: false, status: 'error', message: '⚠️ Neizdevās sazināties ar serveri.' };
    }
  }

  async getServerVersion() {
    if (!SYNC_URL) return null;
    try {
      const url = SYNC_URL + '?action=ping&t=' + Date.now();
      const data = await requestData(url, 15000);
      if (data && data.version) return data.version;
      return null;
    } catch (e) {
      return null;
    }
  }

  _collectLocalCompletions() {
    // Saglabā vietējos uzdevumu pabeigšanas statusus, pirms DB tīrīšanas.
    // Tādējādi pabeigšana netiek zaudēta, ja sinhronizācija neizdodas
    // vai Google Sheets atgriež vecus datus.
    return this.db.getAll('uzdevomi').then((all) => {
      if (!all || !all.length) return {};
      const map = {};
      all.forEach(t => {
        const id = String(t.id || t.ID);
        if (!id) return;
        const done = t.irPabeigts === true || t.irPabeigts === 'TRUE' || t.irPabeigts === 'true' || t.irPabeigts === 1 || t.irPabeigts === '1';
        const statusDone = String(t.statuss || '').toLowerCase() === 'pabeigts' || String(t.statuss || '').toLowerCase() === 'done' || String(t.statuss || '').toLowerCase() === 'completed';
        if (done || statusDone) {
          map[id] = {
            irPabeigts: true,
            statuss: t.statuss || 'pabeigts',
            pabeigtsLaiks: t.pabeigtsLaiks || null,
            pabeigtajsId: t.pabeigtajsId || null
          };
        }
      });
      return map;
    }).catch((e) => {
      console.warn('[sync] _collectLocalCompletions kļūda', e);
      return {};
    });
  }

  _applyLocalCompletions(completions) {
    if (!completions || !Object.keys(completions).length) return Promise.resolve();
    return this.db.getAll('uzdevomi').then((all) => {
      if (!all) return;
      let changed = false;
      all.forEach(t => {
        const id = String(t.id || t.ID);
        const c = completions[id];
        if (!c) return;
        const remoteDone = t.irPabeigts === true || t.irPabeigts === 'TRUE' || t.irPabeigts === 'true' || t.irPabeigts === 1 || t.irPabeigts === '1';
        const remoteStatusDone = String(t.statuss || '').toLowerCase() === 'pabeigts' || String(t.statuss || '').toLowerCase() === 'done' || String(t.statuss || '').toLowerCase() === 'completed';
        if (!remoteDone && !remoteStatusDone) {
          t.irPabeigts = true;
          t.statuss = c.statuss || 'pabeigts';
          if (c.pabeigtsLaiks) t.pabeigtsLaiks = c.pabeigtsLaiks;
          if (c.pabeigtajsId) t.pabeigtajsId = c.pabeigtajsId;
          this.db.put('uzdevomi', t);
          changed = true;
        }
      });
      if (changed) {
        console.log('[sync] atjaunoti lokālie pabeigšanas statusi pēc ielādes');
      }
    }).catch((e) => {
      console.warn('[sync] _applyLocalCompletions kļūda', e);
    });
  }

  async _collectLocalClientChanges() {
    const all = await this.db.getAll('klienti');
    if (!all || !all.length) return {};

    const queue = await this.db.getAll('sync_queue');
    const unsyncedHospitalClientIds = new Set();
    queue.forEach(item => {
      if (item && item.change && item.change.table === 'klienti' && item.change.action === 'updateClient') {
        const d = item.change.data || {};
        if (d.slimnica === true || String(d.slimnica).toLowerCase() === 'true' || d.slimnica === 1 || d.slimnica === '1') {
          unsyncedHospitalClientIds.add(String(d.id || d.ID));
        }
      }
    });

    const map = {};
    all.forEach(c => {
      const id = String(c.id || c.ID);
      if (!id) return;
      const slimnica = c.slimnica === true || c.slimnica === 'true' || c.slimnica === 1 || c.slimnica === '1' || c['Slimnīcā'] === true || c['Slimnīcā'] === 'true' || c['Slimnīcā'] === 1 || c['Slimnīcā'] === '1';
      if (slimnica && unsyncedHospitalClientIds.has(id)) {
        map[id] = { slimnica: true, Slimnīcā: true };
      }
    });
    return map;
  }

  _applyLocalClientChanges(changes) {
    if (!changes || !Object.keys(changes).length) return Promise.resolve();
    return this.db.getAll('klienti').then((all) => {
      if (!all) return;
      let changed = false;
      all.forEach(c => {
        const id = String(c.id || c.ID);
        const change = changes[id];
        if (!change) return;
        const remoteSlimnica = c.slimnica === true || c.slimnica === 'true' || c.slimnica === 1 || c.slimnica === '1' || c['Slimnīcā'] === true || c['Slimnīcā'] === 'true' || c['Slimnīcā'] === 1 || c['Slimnīcā'] === '1';
        if (!remoteSlimnica) {
          c.slimnica = true;
          c['Slimnīcā'] = true;
          this.db.put('klienti', c);
          changed = true;
        }
      });
      if (changed) {
        console.log('[sync] atjaunoti lokālie klientu izmaiņas (slimnīca) pēc ielādes');
      }
    }).catch((e) => {
      console.warn('[sync] _applyLocalClientChanges kļūda', e);
    });
  }

   // ───────────────────────────────────────────────────────────────────────
   // VIENĀS ielādes ceļš
   //
   // loadInitialData() ir VIENS publisks ieejas punkts visām lapām.
   // Tas nozīmē, ka neviens cits kods nedrīkst pa tiekām izsaukt
   // forceFullSync()/reloadFromSheets() — viss iet caur šeit, un šeit
   // reģistrs pārliecinās, ka tā pati ielāde notiek tikai vienu reizi.
   // ───────────────────────────────────────────────────────────────────────
   async loadInitialData(onProgress, filters = {}, opts = {}) {
      const options = opts || {};
      const force = !!options.force;
      const key = 'load:initial';

      // 0) Cooldown PRET SECĪGU atkārtošanu — pat force ceļam.
      //
      // Reģistra ACTIVE bloķēšana aptur TIKAI paralēlus izsaukumus. Ja kāds
      // kods izsauc ielādi, gaida tās beigās un tad izsauc vēlreiz, ACTIVE
      // jau ir beidzies — un mēs iegūstam tieši to, ko lietotājs redzēja:
      // 3 pilnās sinhronizācijas pēc kārtas, 80+ sekundes, 3× slodze GAS.
      //
      // Kāpēc arī force? Tāpēc ka pēc 20 sekundēm nekas nevar būt jaunāks —
      // serveris pats nevarētu atdot citus datus. Tāpēc šeit netiek nekas
      // zaudēts, bet lietotājs redz skaidru paziņojumu, nevis klusu nedarbošanos.
      if (this._lastGoodLoad) {
        const since = Date.now() - this._lastGoodLoad;
        if (since < this.REPEAT_COOLDOWN_MS) {
          const who = (new Error().stack || '').split('\n').slice(2, 5).join(' ← ');
          console.log(
            '[sync] ⏸ COOLDOWN: pilnā ielāde notika ' + Math.round(since / 100) / 10 +
            's atpakaļ (< ' + this.REPEAT_COOLDOWN_MS / 1000 + 's). Jaunu netaisu.' +
            (force ? ' Izsaucējs: ' + who : '')
          );
          PERF.skipped(key, 'pilnā ielāde notika ' + Math.round(since / 1000) + 's atpakaļ');
          return {
            offline: false, connected: true, cached: true, cooled: true,
            count: this._serverCounts || {},
            pending: await this.getUnsyncedCount(),
            revision: this.revision
          };
        }
      }

      // 0b) Diagnostics. Ja kāds ierēķina "force" lai gan jau ielādētiem
      //     svaigiem datiem, mēs to nebloķējam, bet atzīmējam, kas to
      //     izsauca — lai nākamajā reālajā ielādē būtu redzama konkrēta
      //     vieta kodā, nevis minējumi.
      if (force && this.isFresh()) {
        const who = (new Error().stack || '').split('\n').slice(2, 5).join(' ← ');
        console.log('[sync] ⚠ force sync, lai gan dati jau svaigi. Izsaucējs: ' + who);
      }


     // 1) Svaņi? — pārraksta nav vajadzīgas.
     if (!force && this.isFresh()) {
       const age = Math.round((Date.now() - this._lastGoodLoad) / 1000);
       PERF.skipped(key, 'dati jau svaigi (' + age + 's veci)');
       console.log('[sync] ⏭ Dati jau aktuāli (' + age + 's veci) — bootstrap izlaista.');
       return { offline: false, connected: true, cached: true, count: this._serverCounts || {}, pending: await this.getUnsyncedCount(), revision: this.revision };
     }

      // 2) Jau izpildās? — atgriež to pašu darbību, nevis sāk otru.
      const { started, promise } = this._runOnce(key, async () => {
        try { await this.runMigrations(); } catch (e) { console.warn('[sync] migration failed:', e); }
        return this._runExclusive(() => this._loadInitialDataUnlocked(onProgress, true, filters));
      });
      if (!started) PERF.skipped(key, 'ielāde jau izpildās vai tikko pabeidās');
      return promise;
   }

  // Faza 1: nelielās tabulas (darbinieki, klienti, uzdevomi) — ātri, vienā pieprasījumā
  async _loadBootstrap(onProgress) {
    const params = new URLSearchParams({ action: 'load', mode: 'bootstrap', t: Date.now() });
    const url = SYNC_URL + '?' + params.toString();
    console.log('[sync] bootstrap SENDING:', url);
    // Īss, kontrolēts mēģinājums. Nevis 3× 90 sekundēm — GAS aukstais
    // starts izmērīts 3–10s, tāpēc 2 mēģinājumi ar 1s/2s atkāpi ir
    // 40 reizes ātrāks nekā iepriekšējais 126s gaidišana.
    const data = await this._requestWithRetry(url, {
      label: 'bootstrap',
      attempts: 2,
      // ⚠️ Timeout ir izmērīts, nevis uzminēts. 2026-09-28 mērījumi pret
      // jauno deploy URL (6 mēģinājumi): 4.6 / 5.2 / 5.7 / 5.9 / 12.1 / 12.3 s
      // (silts serveris, vidēji 7.6s). PIRMS tam bija viena AUKSTĀ sākuma
      // reize 34.7s. Ar 25s timeoutu tā nogrieztos un sāktu no jauna, tāpēc
      // bootstrapam 35s — tā aptver visu novēroto diapazonu VIENĀ mēģinājumā.
      // Fona atzīmju ielāde paliek 25s: tas notiek PĒC bootstrapa, kad
      // serveris jau silts.
      timeout: 35000,
      onProgress
    });
    console.log('[sync] bootstrap RECEIVED:',
      'darbinieki=' + (data.darbinieki || []).length,
      'klienti=' + (data.klienti || []).length, 'counts=', JSON.stringify(data.counts || {}));
    if (data.error) {
      const err = new Error(data.error);
      err.permanent = true;
      throw err;
    }
    return data;
  }

  // Faza 2: atzimes + atzimes_log pa blokiem (jaunākie pirmāk). SAPLŪST, netīra.
  async _loadMarksPaged(onProgress, totals) {
    if (!SYNC_URL) return null;
     onProgress = onProgress || function() {}; // Fons: neatjaudājams console.log iekšā
     const LIMIT = 500; // Mazāk — ātrāk GAS atmoderas, mazāk timeoutu
     let totalMarks = (totals && totals.atzimes) || 0;
     let totalLog = (totals && totals.atzimes_log) || 0;

     // Ielādējam VISUS atzīmes, sākot no JAUNĀKOVI (beigām → sākumam),
     // lai "šodien" dati kļūtu pieejami pirmie.
     const end = Math.max(totalMarks, totalLog);
     let offset = Math.max(0, end - LIMIT);
     let loadedMarks = 0, loadedLog = 0;
     let guard = 0;
     const MAX_GUARD = 2000; // 500-row lapas → ~452 lapas

     while (guard++ < MAX_GUARD) {
       const params = new URLSearchParams({
         action: 'load', mode: 'marks', t: Date.now(),
         offset: String(offset), limit: String(LIMIT)
       });
       const url = SYNC_URL + '?' + params.toString();

       // GAS atgriež atzimes + atzimes_log vienā atbildē (vienā pieprasījumā)
       let data;
       try {
         data = await this._requestWithRetry(url, { label: 'marks@' + offset, attempts: 2, timeout: 25000 });
       } catch (e) {
         console.warn('[sync] marks page @offset ' + offset + ' neizdevās pēc retry:', e.message);
         break;
       }
       if (data.error) {
         console.warn('[sync] marks page kļūda:', data.error);
         break;
       }

       totalMarks = data.markTotal || totalMarks;
       totalLog = data.logTotal || totalLog;
       const marks = data.atzimes || [];
       const logs = data.atzimes_log || [];

       if (marks.length) await this.db.batchPut('atzimes', marks.map(normalizeRow));
       if (logs.length) await this.db.batchPut('atzimes_log', logs.map(normalizeRow));

       loadedMarks += marks.length;
       loadedLog += logs.length;
       onProgress('Ielādēju aprūpes ierakstus: ' + loadedMarks + ' / ' + (totalMarks || '?'));

       // Newest-first paging: stop when we've paged all the way down to offset 0.
       if (offset === 0) break;
       const next = Math.max(0, offset - LIMIT); // jaunākie pirmāk → atpakaļ
       if (next === offset) break;
       offset = next;
       await new Promise(r => setTimeout(r, 0)); // Atlaide UI starp lapām
     }

     console.log('[sync] vēsture ielādēta: ' + loadedMarks + ' atzīmes, ' + loadedLog + ' logi (kopā ' + totalMarks + '/' + totalLog + ')');
     this._marksLoaded = true;
     this.revision = (this.revision || 0) + 1;
     try { window.dispatchEvent(new CustomEvent('marksLoaded')); } catch (e) {}
     return { markTotal: totalMarks, logTotal: totalLog, loaded: loadedMarks, loadedLog: loadedLog };
   }

   // Aktuālie ieraksti sākuma ekrānam: vakardiena + šodiena + rītdiena.
   //
   // TIE ir vienīgie ieraksti, kas nepieciešami, lai lietotājs var sākt
   // darbu uzreiz. Vēsture netiek ielādēta līdz brīdim, kad konkrētais
   // klients tiek atvērts (loadClientRange) vai lietotājs to izvēlas
   // pats (sync.loadHistory()).
  async _loadRecentMarks(onProgress, days) {
    const span = days || this.RECENT_DAYS || 3;
    const dates = [];
    for (let i = -(span - 1); i <= 0; i++) {
      dates.push(TimezoneUtils ? TimezoneUtils.offsetDaysRiga(i) : new Date(Date.now() + i * 86400000).toISOString().slice(0, 10));
    }

    // ⚠️ LAPOŠANA. Serveris ierobežo katru atbildi ar Math.min(limit, 5000)
    // un atgriež `done`, `nextOffset`, `logNextOffset`. Vecākais klients šos
    // laukus IGNORĒJA un ņēma tikai pirmo lapu. Pie 200 klientiem 3 dienas
    // dod ~18 000 atzīmju, tāpēc pirmās 2000 būtu KLUSĀ datu zaudējuma.
    // Šeit atbilde tiek izlasta, kamēr serveris saka `done`.
    const PAGE = 2000;
    const MAX_PAGES = 60;          // 120 000 ieraksti — vairāk par jebkuru reālu dienu
    // ⚠️ Katrai tabulai ir SAVS offset. Kopējais offset nedarbojas, kad vienas
    // tabulas dati beidzas pirms otras — nākamā lapa atgrieztu pabeigtās
    // tabulas rindas atkārtoti, kamēr otra tikai sākta. Katrai arī savs done
    // karodziņš, lai beigušos klints vairs nesūta.
    let offset = 0, logOffset = 0;
    let marksDone = false, logDone = false;
    let rawMarks = [], rawLogs = [];
    let pages = 0, truncated = false;

    while (pages < MAX_PAGES) {
      const params = new URLSearchParams({
        action: 'load', mode: 'range', t: Date.now(),
        dateFrom: dates[0], dateTo: dates[dates.length - 1],
        limit: String(PAGE), offset: String(offset),
        logOffset: String(logOffset),
        marksDone: marksDone ? 'true' : 'false',
        logDone: logDone ? 'true' : 'false'
      });
      const url = SYNC_URL + '?' + params.toString();
      const data = await this._requestWithRetry(url, {
        label: 'atzīmes (' + span + ' dienas, lapa ' + (pages + 1) + ')',
        attempts: 2, timeout: 25000
      });

      rawMarks = rawMarks.concat(data.atzimes || []);
      rawLogs = rawLogs.concat(data.atzimes_log || []);
      pages++;

      // Servera mērījumi. Tas ir fakti, nevis minējumi — ar to var redzēt,
      // kur tiek pavadīts laiks, ja kaut kas izskatās dārgi.
      if (data._diag) {
        const d = data._diag;
        const ph = Object.entries(d.phasesMs || {})
          .map(([k, v]) => k + '=' + v + 'ms').join(' ');
        console.log('[sync] servera mērījumi: ' +
          d.getRangeCalls + ' getRange zvani, ' +
          d.cellsRead + ' šūnas, ' + d.openById + ' openById | ' + ph +
          (d.notes && d.notes.length ? ' | ' + d.notes.join('; ') : '') +
          (d.sheetRows ? ' | ' + JSON.stringify(d.sheetRows) : ''));
      }

      // Serveris pats pateiks, vai katrai tabulai ir vēl lapas.
      marksDone = marksDone || data.marksDone === true;
      logDone = logDone || data.logDone === true;
      if (marksDone && logDone) break;

      // Serveris datumu filtru skenē no lapas BEIGĀS, tāpēc offset var būt
      // NEGATĪVS un katra nākamā lapa ir mazāka par pašreizējo. Virzienu
      // ņemam no servera, nevis no offset zīmes — pirmajā pieprasījumā offset
      // ir 0, un tā zīme vēl neko nepasaka.
      const dir = data.scanDirection === 'reverse' ? -1 : 1;
      const offA = Number(data.nextOffset || 0);
      const offB = Number(data.logNextOffset || 0);
      const prevOffset = offset, prevLogOffset = logOffset;
      if (!marksDone) offset = offA;
      if (!logDone) logOffset = offB;
      const progressed = (marksDone || (offA - prevOffset) * dir > 0) &&
                          (logDone || (offB - prevLogOffset) * dir > 0);
      if (!progressed) {
        console.warn('[sync] atzīmju lapošana apstājās: neprogresējošs offset', offset);
        truncated = true;
        break;
      }
      if (onProgress) onProgress('Ielādēju aprūpes ierakstus: ' + rawMarks.length + ' …');
      await new Promise(r => setTimeout(r, 0)); // Atlaide UI starp lapām
    }

    if (pages >= MAX_PAGES) {
      truncated = true;
      console.warn('[sync] atzīmju lapošana apstājās pēc ' + MAX_PAGES +
        ' lapām. Šis ir drošības ierobežojums, nevis normāls ceļš.');
    }

    const tProcess = _nowMs();
    const marks = rawMarks.map(normalizeRow);
    const logs = rawLogs.map(normalizeRow);
    if (marks.length) await this.db.batchPut('atzimes', marks);
    if (logs.length) await this.db.batchPut('atzimes_log', logs);
    PERF.sub('atzīmes (' + span + ' dienas)', 'datu apstrāde (IndexedDB)', (_nowMs() - tProcess));

    console.log('[sync] aktuālie ieraksti ielādēti: ' + marks.length + ' atzīmes, ' +
      logs.length + ' logi (' + dates[0] + ' → ' + dates[dates.length - 1] + ')' +
      (pages > 1 ? ', ' + pages + ' lapas' : ''));
    if (truncated) {
      console.warn('[sync] ⚠️ Ne visas atzīmes varēja tikt ielādētas. Rādītais ' +
        'logs nav pilnīgs — pārlādē vai palielini MAX_PAGES.');
    }
    try { window.dispatchEvent(new CustomEvent('recentMarksLoaded')); } catch (e) {}
    return { marks: marks.length, logs: logs.length, from: dates[0], to: dates[dates.length - 1], pages: pages, truncated: truncated };
  }

   // FONĀ ielādē jaunākos ierakstus. Tas ir VIENS datu ielādes ceļš pēc
   // bootstrap — nevis divi paralēli (_loadMarksPaged + _loadRecentMarks),
   // kas dublēja katru ierakstu un kāpināja slodzi GAS serverim.
   _loadRecentMarksBackground(onProgress) {
     const { started, promise } = this._runOnce('load:recent', () => this._loadRecentMarks(null, this.RECENT_DAYS));
     if (!started) return this._recentLoadingPromise || promise;
     this._recentLoadingPromise = promise
       .then(r => {
         this.revision = (this.revision || 0) + 1;
         this._updateSyncStatus('Saglabāts');
         return r;
       })
       .catch(e => {
         console.warn('[sync] aktuālo ierakstu fona ielāde neizdevās:', e.message);
         return null;
       });
     return this._recentLoadingPromise;
   }

   // Pilnā vēsture — TIKAI pēc pieprasījuma (klienta atvēršana vai
   // manuāla darbība). Sākuma ekrānam tas nav vajadzīgs.
   loadHistory(onProgress) {
     const { started, promise } = this._runOnce('load:history', async () => {
       const counts = this._serverCounts || {};
       return PERF.measure('vēsture (fonā)', () => this._loadMarksPaged(onProgress || null, counts));
     });
     this._marksLoadingPromise = promise;
     return promise;
   }

  // ─────────────────────────────────────────────────────────────────────────
  // ĪSS, KONTROLĒTS MĒĒINĀJUMS
  //
  // Vecā loģika: 3–4 mēģinājumi × 60–120s = līdz 5 minūtēm gaidīšanas
  // vienam pieprasījumam, un katrs mēģinājums atkārtoja to pašu 404→JSONP
  // ķēdi. Rezultāts bija 126 sekundes tukša ekrāna.
  //
  // Jaunā loģika: 2 mēģinājumi, kopējais budžets, 800ms/2000ms atkāpe.
  // Nevis tā vietā mēģināt ilgāk — ātrāk atdot kļūdu un strādāt ar
  // vietējiem datiem.
  //
  // ⚠️ `timeout` ir KOPĒJĀIS budžets visam pieprasījumam, nevis limits
  // katram mēģinājumam. Vecākais kods katram no diviem mēģinājumiem
  // nodeva 35s, tāpēc bootstrap varēja ilgt 70s — tieši to lietotājs
  // redzēja žurnālā ("mēģinājums 1/2, 70012ms").
  // ─────────────────────────────────────────────────────────────────────────
  async _requestWithRetry(url, options = {}) {
    const {
      label = 'pieprasījums',
      attempts = 2,
      timeout = 25000,
      onProgress = null
    } = options;
    const backoff = [800, 2000];
    const budgetStart = _nowMs();
    let lastErr;

    for (let attempt = 0; attempt < attempts; attempt++) {
      // Šim mēģinājumam atliekas TIKAI budžeta atlikums.
      const left = timeout - (_nowMs() - budgetStart);
      if (left <= 0) {
        // Budžets izlietots. Labāk ātrāk atdot kļūdu un strādāt ar
        // vietējiem datiem nekā turpināt gaidīt.
        console.warn('[sync] ' + label + ': budžets ' + timeout + 'ms izlietots pirms ' +
          'mēģinājuma ' + (attempt + 1) + ' — pārtraucu');
        break;
      }
      const started = _nowMs();
      try {
        return await PERF.net(label, (hooks) => {
          hooks.onSent();
          return requestData(url, left);
        });
      } catch (e) {
        const spent = _nowMs() - started;
        lastErr = e;
        // Serveris pats atbildēja ar kļūdu (piem. GAS kvota) — atkārtošana
        // neatbūs palīdzēt, un mēs nezaudējam laiku.
        if (e && e.permanent) throw e;

        console.warn(
          '[sync] ' + label + ' neizdevās (mēģinājums ' + (attempt + 1) + '/' + attempts +
          ', ' + Math.round(spent) + 'ms): ' + (e && e.message)
        );

          if (attempt < attempts - 1) {
            if (onProgress) {
              try { onProgress('Pārbaudu savienojumu ar Google... (mēģinājums ' + (attempt + 2) + ')'); } catch (cbErr) {}
            }
            await new Promise(r => setTimeout(r, this.retryDelayMs(attempt + 1)));
          }
      }
    }
    throw lastErr;
  }

  // Konkrēta klienta dati pēc vajadzības (care_form, control)
  async loadClientRange(clientId, dateFrom, dateTo) {
    if (!SYNC_URL || !clientId) return { marks: [], logs: [] };
    const LIMIT = 1000; // Mazāk — ātrāk GAS atbildē
    let offset = 0;
    const allMarks = [];
    const allLogs = [];
    let guard = 0;

    while (guard++ < 60) {
      const params = new URLSearchParams({
        action: 'load', mode: 'range', t: Date.now(),
        clientId: String(clientId),
        dateFrom: dateFrom || '', dateTo: dateTo || '',
        offset: String(offset), limit: String(LIMIT)
      });
       const url = SYNC_URL + '?' + params.toString();
       let data;
       try {
         data = await this._requestWithRetry(url, { label: 'klients ' + clientId, attempts: 2, timeout: 20000 });
       } catch (e) {
         console.warn('[sync] loadClientRange neizdevās:', e.message);
         break;
       }
       if (data.error) break;

      const marks = (data.atzimes || []).map(normalizeRow);
      const logs = (data.atzimes_log || []).map(normalizeRow);
      if (marks.length) await this.db.batchPut('atzimes', marks);
      if (logs.length) await this.db.batchPut('atzimes_log', logs);
      // Neliels klienta apjoms - 90 dienas, tāpēc safe, bet bez spread, lai neuzkrauktu staku
      for (const m of marks) allMarks.push(m);
      for (const l of logs) allLogs.push(l);

      const next = (data.nextOffset !== undefined) ? data.nextOffset : (offset + marks.length);
      if (data.done === true) break;
      if (marks.length === 0 && logs.length === 0) break;
      // Šeit filtrs ir pēc klienta, tāpēc serveris skenē no augšas un offset
      // ir pozitīvs. Tomēr pārbaudām virzienu, lai loģika būtu noturīga arī
      // tad, ja servera skenēšanas virziens kādreiz mainās.
      if (offset < 0 ? (next >= offset) : (next <= offset)) break;
      offset = next;
    }

    return { marks: allMarks, logs: allLogs };
  }

  async _loadInitialDataUnlocked(onProgress, processQueueFirst, filters = {}) {
    this._loading = true;
    this._updateSyncStatus('Sinhronizē...');
    onProgress = onProgress || function() {};

    // Tikai viens mēģinājums — ātri, bez murgiem
    try {
      if (processQueueFirst) {
        // Rindas nosūtīšanai atvēlam tikai 10s — dati jāielādē ātrāk!
        await this._processQueueUnlocked(10000);
      }

      // === FAZA 1: nelielās tabulas (ātri) ===
      onProgress('Atjaunoju klientus un darbiniekus...');
      const tReq = _nowMs();
      const base = await PERF.measure('kopējā sinhronizācija', () => this._loadBootstrap(onProgress), { group: 'serveris' });
      const tResp = _nowMs();
      PERF.sub('kopējā sinhronizācija', 'servera atbilde', tResp - tReq);
      const lastSync = Date.now();

      // Saglabāt vietējos pabeigšanas statusus un klientu izmaiņas pirms DB tīrīšanas
      const localCompletions = await this._collectLocalCompletions();
      const localClientChanges = await this._collectLocalClientChanges();

      // NOMAINĀT atzimes/atzimes_log — tās tiek ielādētas daļās fonā un saplūstas
      // meta store is NOT included here — replaceStores clears it entirely,
      // which would delete the migration_v3_complete marker and force the O(n)
      // runMigrations to re-run on every sync. Instead we use db.put for
      // lastSync to preserve existing meta entries.
      await this.db.replaceStores({
        darbinieki: (base.darbinieki || []).map(normalizeRow),
        klienti: (base.klienti || []).map(normalizeRow),
        uzdevomi: (base.uzdevomi || []).map(normalizeRow)
      });
      await this.db.put('meta', { key: 'lastSync', value: lastSync, ts: lastSync });

      await this._applyLocalCompletions(localCompletions);
      await this._applyLocalClientChanges(localClientChanges);

      const tProc = _nowMs();
      PERF.sub('kopējā sinhronizācija', 'datu apstrāde (IndexedDB)', tProc - tResp);

      const counts = base.counts || {};
      this._serverCounts = counts;

      this.loaded = true;
      this.revision = (this.revision || 0) + 1;
      this._lastGoodLoad = Date.now();

      // sync_queue is NOT cleared after data load — pending operations
      // may not have been confirmed by the server yet. Each item is only
      // deleted when the server explicitly accepts it (accepted/already_processed).
      //
      // Bet GALĪGIE ieraksti (AIZVIETA, pārsniegtie MAX_RETRIES, ATCELTS)
      // jāiztīra tieši šeit. Tie nekad netiks nosūtīti, un, kamēr tie
      // paliek rindā, katra nākamā sesija ielādē rādīs "Ir nesaglabāti
      // dati!" pat tad, ja lietotājs neko neko nav mainījis.
      const purged = await this._purgeDeadQueueItems();
      const remaining = await this.getUnsyncedCount();
      this._updateSyncStatus(remaining > 0 ? 'Gaida nosūtīšanu' : 'Saglabāts');

      if (purged > 0) {
        console.log('[sync] pēc ielādes iztīrīti ' + purged + ' galīgie rindas ieraksti');
      }
      if (remaining > 0) {
        console.log('[sync] Pēc ielādes atlikuši ' + remaining + ' neatlasīti ieraksti, sūtu uz GS');
        this.processQueue().catch(() => {});
      }

      const result = {
        offline: false,
        connected: true,
        count: {
          darbinieki: (base.darbinieki || []).length,
          klienti: (base.klienti || []).length,
          atzimes: counts.atzimes || 0,
          atzimes_log: counts.atzimes_log || 0,
          uzdevomi: (base.uzdevomi || []).length
        },
        counts: counts,
        pending: remaining,
        revision: this.revision
      };
      try {
        window.dispatchEvent(new CustomEvent('syncComplete', { detail: result }));
      } catch (e) {}
      onProgress('✓ Klienti ielādēti.');

      // === FAZA 2: FONĀ — jaunākie aprūpes ieraksti (nevis pilnā vēsture) ===
      // VIENS datu ielādes ceļš, nevis divi paralēli. Reģistrs garantē, ka pat
      // ja forceFullSync() nokļuva šeit vairākas reizes, fona ielāde notiek
      // vienu reizi, nevis trīs.
      this._loadRecentMarksBackground(null);

      return result;
    } catch (err) {
      // JA NEIZDODAS — NEDZĒSIM DATUS!
      console.warn('[sync] loadInitialData kļūda, saglabājam esošos datus:', err.message);
      this._updateSyncStatus('Nav savienojuma ar Google Sheets');
      onProgress('⚠️ Neizdevās sazināties ar Google Sheets. Darbojies ar lokālajiem datiem.');
      return { offline: true, error: err.message, count: {}, pending: 0 };
    } finally {
      this._loading = false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // LOKĀLIE DATI PIRMS — galvenais veiktspējas lēmums.
  //
  // UI jāparādās no IndexedDB, nevis jāgaida Google. Servera kļūme vairs
  // nenoblokē programmu: ja GOOGLE nepasniedz, lietotājs joprojām strādā
  // ar pēdējiem datiem un var sākt darbu.
  // ───────────────────────────────────────────────────────────────────────
  async loadFromLocal() {
    const has = await this.hasLocalData();
    if (!has) {
      console.log('[sync] Lokālie dati nav pieejami — UI tiks parādīts pēc sinhronizācijas.');
      return false;
    }
    const lastSync = await this.getLastSyncTime();
    const age = lastSync ? Math.round((Date.now() - lastSync) / 1000) : null;
    console.log(
      '[sync] 💾 Lokālie dati pieejami' +
      (age !== null
        ? ' (pēdējoreiz sinhronizēts pirms ' + (age < 90 ? age + 's' : Math.round(age / 60) + ' min') + ')'
        : '')
    );
    return { has: true, lastSync, ageSec: age };
  }

  // Pilna "parādi lokāli, tad atjaunini fonā" plūsma, ko izmanto visas lapas.
  async bootstrapUI(options = {}) {
    const opts = options || {};
    const onProgress = opts.onProgress || null;

    // 1) Vietējie dati — acumērātiem.
    await PERF.measure('lokālie dati (IndexedDB)', async () => { await this.loadFromLocal(); });
    if (opts.onLocalReady) {
      await opts.onLocalReady();
      PERF.markUI('UI parādīts no lokālajiem datiem');
    }

    // 2) Serveris — fonā, ar paziņojumu, nevis ar bloķējošu ekrānu.
    const t0 = _nowMs();
    const result = await this.loadInitialData(onProgress, {}, { force: !!opts.force });
    PERF.sub('kopējā sinhronizācija', 'līdz datiem ierīcē',
      _nowMs() - t0);

    if (!result.offline && opts.onServerData) {
      await opts.onServerData();
    }
    PERF.autoSummary();
    return result;
  }

  // Gaidīt, kamēr fona ielāde (jaunākie ieraksti vai vēsture) beidzās
  async waitForMarks() {
    const p = this._marksLoadingPromise || this._recentLoadingPromise;
    if (p) {
      try { await p; } catch (e) {}
    }
    return this._marksLoaded;
  }

  // Atjauno datus no GS. Šis ir TIKAI API sasaitei — tā izmanto to pašu
  // ielādes ceļu un tā pašu reģistru, tāpēc nevar izraisīt dubultu ielādi.
  async reloadFromSheets(onProgress) {
    if (this._loading) {
      console.log('[sync] ⏭ jau ielādē — papildu reload nav vajadzīgs');
      PERF.skipped('load:initial', 'ielāde jau notiek');
      return { offline: false, cached: true };
    }
    return this.loadInitialData(onProgress, {});
  }

  async enqueueChange(change) {
    if (!SYNC_URL) return;
    if (this._loading) {
      // Saglabāt rindā, bet nekavējoties neprocesēt — processQueue tiks izsaukts pēc ielādes
      console.log('[sync] enqueueChange: saglabāju rindā (ielāde notiek)');
    }
    if (change.data && change.data.actionId) {
      const existing = await this.db.getAll('sync_queue');
      const duplicate = existing.find(item =>
        item.change && item.change.data &&
        item.change.data.actionId === change.data.actionId
      );
      if (duplicate) {
        // Preserve original operationId — do not overwrite with a new one
        const originalOpId = duplicate.change.data && duplicate.change.data.operationId;
        if (originalOpId) {
          change.data.operationId = originalOpId;
        }
        duplicate.change.data = change.data;
        duplicate.timestamp = Date.now();
        await this.db.put('sync_queue', duplicate);
        console.log('[sync] enqueueChange: atjaunināts dublets actionId:', change.data.actionId);
        return duplicate.id;
      }
    }
    // Spec 4.1: ģenerē operationId ja klients to nepieciešams
    // Ģenerējam tikai jauniem itemiem (ne dublikātiem), lai operationId paliktu stabili cauri retry
    if (change.data && !change.data.operationId) {
      var empId = change.data.employeeId || change.data.employeeID ||
        change.data.darbinieksId || (window.currentUser && window.currentUser.id) || 'unknown';
      change.data.operationId = generateOperationId(empId);
    }
    // Spec 12.4: OCC — pievieno recordVersion, ja tiek atjaunināts esošs ieraksts
    if (change.data && change.data.id && !change.data.recordVersion) {
      var tableName = change.table;
      if (tableName && this.db) {
        try {
          var record = await this.db.get(tableName, change.data.id);
          if (record && record.version) {
            change.data.recordVersion = record.version;
          }
        } catch (e) {
          // Best-effort: OCC nav kritisks
        }
      }
    }
    const queueItem = {
      id: this.db.generateId(),
      change: change,
      operationId: change.data.operationId,
      timestamp: Date.now(),
      retries: 0,
      lastError: null,
      status: 'GAIDA',
      recordVersion: change.data.recordVersion || null
    };
    await this.db.add('sync_queue', queueItem);
    this._scheduleQueueProcessing();
    return queueItem.id;
  }

  _scheduleQueueProcessing() {
    if (this._queueTimer) return;
    this._queueTimer = setTimeout(() => {
      this._queueTimer = null;
      this.processQueue().catch(() => {});
    }, 100); // Reduced from 500ms to 100ms for faster sync
  }

  // Tūlītējs rindas apstrādes izsaukums - atgriež Promise, lai varētu gaidīt pabeigšanu (ar timeout)
  async flushQueue() {
    if (this._queueTimer) {
      clearTimeout(this._queueTimer);
      this._queueTimer = null;
    }
    // Atgriežam processQueue promise, lai izsauktājs varētu await (ar timeout)
    return this.processQueue().catch(() => {});
  }

  async processQueue() {
    // Rindu apstrāde arī ir operācija — ja tā jau notiek, izmantojam to pašu.
    const { promise } = this._runOnce('queue:process', () =>
      this._runExclusive(() => this._processQueueUnlocked()));
    return promise;
  }

  async _processQueueUnlocked(maxMs) {
    const summary = { synced: 0, failed: 0, remaining: 0, permanentlyFailed: 0, superseded: 0 };
    if (!SYNC_URL) {
      this._updateSyncStatus('Nav savienojuma');
      return summary;
    }
    this._queueProcessing = true;
    this._updateSyncStatus('Sinhronizē...');
    // Grafiks: uz telefona bez savienojuma katrs rakstīšanas pieprasījums
    // var kavēties līdz timeoutam. Bez šī ierobežojuma rinda varētu aizturēt
    // lāpu ielādi desmitiem minūšu pirms datu ielādes sākas.
    const deadline = maxMs ? Date.now() + maxMs : 0;
    try {
      // Galīgie ieraksti (AIZVIETA, neattīrīti mēģinājumi, ATCELTS …) tiek
      // arhivēti un noņemti, NEVIS tikai izlaisti. Tie vairs netiks
      // nosūtīti, tāpēc kaņ glabāšana rindā tikai liek dialogam uzskatīt
      // katru ierakstu par "nesaglabātu" un bloķēt iziešanu uz mužību.
      await this._purgeDeadQueueItems();
      const items = (await this.db.getAll('sync_queue')).filter(i => this.isQueueItemPending(i));
      if (items.length === 0) {
        this._renderUnsyncedBadge(0);
        this._updateSyncStatus(navigator.onLine ? 'Saglabāts' : 'Nav savienojuma');
        return summary;
      }

      // ⚠️ `MAX_RETRIES` vairs NAV izmantojams kā filtrs. Vecajā kodā tas
      // pēc 5 mēģinājumiem padarīja ierakstu galīgu un tas tika DZĒSTS.
      // Tagad tīkla kļūda nekad nepārtrauk sūtīšanu — ieraksts paliek rindā
      // tik ilgi, cik nepieciešams, līdz tas nonāk Google Sheetā.
      const sorted = items.slice().sort((a, b) => a.timestamp - b.timestamp);
      for (const item of sorted) {
        if (deadline && Date.now() > deadline) {
          console.log('[sync] processQueue: laika budžets izlietots, pārlejot pārējos ' +
            (sorted.length - summary.synced - summary.failed) + ' ierakstus uz vēlāku');
          summary.skipped = true;
          break;
        }
        // ⚠️ KONFLIKTS / BLOKKĒTS / NORAIDĪTS vairs NAV šeit.
        // Iepriekš tie tika izlaidi šajā vietā un atstāti rindā, kas
        // radīja 1 ms bezmāksas atkārtošanās ciklu, jo nekas tos
        // nekad neiztīrīja. Tagad tos ^_purgeDeadQueueItems iztīrīja
        // pirms šī cikla, un šeit nonāk tikai īsts sūtāms darbs.
        // Spec 7: replacement detection — ja jaunāks item ar to pašu recordId jau ir,
        // atzīmē šo kā AIZVIETA un neapstrādā
        const itemRecordId = item.change?.data?.id;
        const itemTs = item.timestamp;
        if (itemRecordId) {
          const newerExists = sorted.find(other =>
            other.id !== item.id &&
            other.status !== 'AIZVIETA' &&
            other.status !== 'ATCELTS' &&
            other.change?.data?.id === itemRecordId &&
            other.timestamp > itemTs
          );
          if (newerExists) {
            // ⚠️ Vecākais kods šeit tikai atzīmēja statusu un atstāja ierakstu
            // rindā. Tas bija tiešs Phantom brīdinājuma avots: ieraksts, kuru
            // nomainīja jaunāks, palika mūžmūžīgi un katrā iziešanā tika
            // ieskaitīts kā "nesaglabāts". Tagad arhivējam un noņemam.
            item.status = 'AIZVIETA';
            item.replacedBy = newerExists.id;
            await this._archiveItem(item, 'superseded');
            summary.superseded++;
            continue;
          }
        }
 try {
            item.status = 'SINHRONIZĀCIJA NOTIEK';
            await this.db.put('sync_queue', item);
            const action = item.change.action || item.change.type || 'mark';
            const data = item.change.data || item.change;
            const isWriteOp = ['mark', 'createTask', 'updateTask', 'createClient', 'createEmployee', 'updateClient', 'updateEmployee'].includes(action);
            console.log('[sync] processQueue PROCESSING:', action, 'retries:', item.retries || 0, 'data:', JSON.stringify(data));
            let result;
            try {
              result = isWriteOp
                ? await postAction(action, data, 25000)
                : await jsonpAction(action, data, 25000);
              console.log('[sync] processQueue RESULT:', action, 'success:', result?.success, 'error:', result?.error, 'already_processed:', result?.already_processed);
            } catch (requestErr) {
              // Request failed (network error/timeout) - re-throw to trigger retry logic
              throw requestErr;
            }
            // Delete queue item only when server confirms acceptance.
            // Spec 10.6: HTTP response received != operation accepted.
            // Only accepted===true or already_processed===true triggers deletion.
            const wasAccepted = result && (
              result.already_processed === true ||
              result.accepted === true ||
              (result.success === true && result.blocked !== true)
            );
            if (wasAccepted) {
              // Spec 10: atjaunoj recordVersion no servera atbauves (ja pieejams)
              if (result && result.recordVersion) {
                item.recordVersion = result.recordVersion;
                if (item.change && item.change.data) {
                  item.change.data.recordVersion = result.recordVersion;
                }
              }
              try {
                await this.db.delete('sync_queue', item.id);
                console.log('[sync] Queue item DELETED (accepted):', item.id);
              } catch (delErr) {
                console.warn('[sync] Failed to delete queue item:', delErr);
              }
              summary.synced++;
             } else {
              // Server responded but not accepted — keep item, update status
              if (result && result.deduplication_valid_until && new Date(result.deduplication_valid_until) <= Date.now()) {
                item.status = 'NEVAR ATKĀRTOT';
                item.lastError = 'Deduplication window expired on server';
                await this._archiveItem(item, 'error');
              } else if (result && result.retry_not_allowed === true) {
                item.status = 'NEVAR ATKĀRTOT';
                item.lastError = result.error || 'Retry not allowed on server';
                await this._archiveItem(item, 'error');
              } else if (result && result.blocked === true) {
                item.status = 'BLOKKĒTS';
              } else if (result && result.conflict === true) {
                item.status = 'KONFLIKTS';
                item.conflictInfo = {
                  serverVersion: result.serverVersion,
                  recordId: result.recordId,
                  deduplicationValidUntil: result.deduplication_valid_until
                };
              } else if (result && result.error) {
                item.status = 'KĻŪDA';
                item.lastError = result.error;
              } else {
                item.status = 'NORAIDĪTS';
              }
              await this.db.put('sync_queue', item);
              summary.failed++;
            }
        } catch (e) {
          // Spec 11.1: network errors are NOT permanent — retry with same operationId.
          // isPermanent removed: timeout/DNS/CORS must retry, not be marked permanentlyFailed.
          const errorMsg = e.message || String(e);
          item.retries = (item.retries || 0) + 1;
          item.lastError = errorMsg;
          item.status = 'KĻŪDA';
          // ⚠️ Tīkla kļūda NAV galīga. Vecajā kodaj šeit bija
          // `if (retries >= MAX_RETRIES) summary.permanentlyFailed++` —
          // tas bija melīgs skaitītājs, jo patiesībā nekas nebija galīgs,
          // ieraksts palika rindā un tika sūtīts atkal. Tagad šis
          // skaitītājs ir NULLE, un tas precīzi atspoguļo, ka nekas
          // nav neatgriezts neatgriezis.
          await this.db.put('sync_queue', item);
          summary.failed++;
        }
      }
      summary.remaining = await this.getUnsyncedCount();
      // Indikators parādās uzreiz, nevis tikai dialoga iziešanas brīdī —
      // aprūpētājs bieži neizmanto iziešanas dialogu vispār.
      this._renderUnsyncedBadge(summary.remaining);
      const status = summary.remaining > 0 ? 'Gaida nosūtīšanu' : (navigator.onLine ? 'Saglabāts' : 'Nav savienojuma');
      this._updateSyncStatus(summary.synced || summary.failed
        ? status + ' (✓' + summary.synced + ' ✗' + summary.failed + ')'
        : status);
      return summary;
    } finally {
      this._queueProcessing = false;
    }
  }

  async forceFullSync(onProgress, filters = {}) {
    // forceFullSync atšķiras no loadInitialData TIKAI tāpēc, ka ignorē
    // "dati jau svaigi" logiku. Tas ir viss, ko tas dara. Tas NEPALAIST
    // otru bootstrap, ja lielā ielāde jau notiek — to apstrādā reģistrs.
    return this.loadInitialData(onProgress, filters || {}, { force: true });
  }

  // Izejam no lietojuma → jāgarantē, ka rindā nav neizdzīstu ierakstu.
  //
  // ⚠️ Šeit NEDRĪKST izmantot forceFullSync(): tas ir LASĪŠANA no servera,
  // nevis rakstīšana uz serveri. Tam piemērojās REPEAT_COOLDOWN_MS, tāpēc
  // aiziešanas brīdī tas varētu atgriezt tukšu ielādi, rindu neatgriezt,
  // un iziešana notiktu ar neizdzīstiem datiem.
  async flushBeforeExit() {
    const pending = await this.getUnsyncedCount();
    if (pending === 0) {
      // Nav ko sūtīt → NETIEKAM nekas uz servera. Tas ir vēlamais
      // ceļš: izejam uzreiz, bez 5 s pilnas bootstrap ielādes.
      return { pushed: 0, remaining: 0, skipped: true };
    }
    await this.processQueue();
    return { pushed: pending, remaining: await this.getUnsyncedCount(), skipped: false };
  }

  // Pūsta sync_queue - izsaucot, kad serveris ir "source of truth"
  async clearQueue() {
    try {
      const items = await this.db.getAll('sync_queue');
      if (items.length > 0) {
        console.log('[sync] clearQueue: dzēš', items.length, 'ierakstus');
        for (const item of items) {
          await this.db.delete('sync_queue', item.id);
          console.log('[sync] clearQueue DELETED:', item.id);
        }
      }
    } catch (e) {
      console.warn('[sync] clearQueue kļūda:', e);
    }
  }

  // ⚠️ Atgriež TIKAI tos ierakstus, kas vēl tiek sūtīti. Šo izmanto visu
  // četru sadaļu (admin, control, aprupe, medicine) iziešanas dialogs, lai
  // skaitītu "nesaglabātos ierakstus". Galīgie ieraksti (AIZVIETA,
  // pārsniegtie MAX_RETRIES, ATCELTS, PIEŅEMTS) NAV neizsūtāmi, tāpēc
  // tie nedrīkst skaitīties kā risks zaudēt datus — pretērā jebkurš
  // lietotājs, kam izdevās kaut ko izdzīvot, redzētu brīdinājumu par
  // ierakstu, kas nekur nevar pazust.
  async getUnsyncedItems() {
    const items = await this.db.getAll('sync_queue');
    return items.filter(i => this.isQueueItemPending(i)).map(i => i.change);
  }

  // Cik ieraksti patiešām VĒL NAV saglabāti serverī.
  //
  // ⚠️ Vecākā implementācija atgrieza items.length — tas skaitīja arī
  // galīgos ierakstus (AIZVIETA, BLOKKĒTS, pārsniegtie MAX_RETRIES),
  // kas nekad vairs netiks nosūtīti. Rezultāts: iziešanas dialogs
  // bezgalzīgi rādīja "Ir nesaglabāti dati!" pat tad, kad nekas nebija
  // mainīts un nekas nebija apsaimējoties zaudēt.
  async getUnsyncedCount() {
    const items = await this.db.getAll('sync_queue');
    return items.filter(i => this.isQueueItemPending(i)).length;
  }

  // Manuālā atkārtošana — lietotājs spyied "Mēģināt vēlreiz".
   // Atdatina retry counter un statusu, atkārto ar to pašu operationId/actionId.
    async retry(itemId) {
      const item = await this.db.get('sync_queue', itemId);
      if (!item) return false;
      // Spec 11.2: pārbauda, vai serveris atļauj atkārtot
      const opId = item.operationId || item.change?.data?.operationId;
      if (opId) {
        const allowed = await this.checkRetryAllowed(opId);
        if (!allowed || allowed.can_retry === false) {
          return { retried: false, reason: allowed.reason || 'retry_not_allowed' };
        }
      }
      // Spec 11.3: conflict resolution — refresh recordVersion before retry
      if (item.status === 'KONFLIKTS' && item.change?.data?.id && item.change?.table) {
        const record = await this.db.get(item.change.table, item.change.data.id);
        if (record && record.version) {
          item.change.data.recordVersion = record.version;
          item.recordVersion = record.version;
        }
      }
      item.retries = 0;
      item.lastError = null;
      item.status = 'GAIDA';
      delete item.conflictInfo;
      await this.db.put('sync_queue', item);
      this._scheduleQueueProcessing();
      return { retried: true };
    }

    async _archiveItem(item, outcome) {
      try {
        await this.db.put('sync_audit', {
          id: 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          originalItemId: item.id,
          operationId: item.operationId || item.change?.data?.operationId,
          action: item.change.action || item.change.type,
          recordId: item.change.data?.id,
          employeeId: item.change.data?.employeeId || item.change.data?.employeeID,
          retries: item.retries || 0,
          lastError: item.lastError,
          status: item.status,
          createdAt: item.timestamp,
          archivedAt: Date.now(),
          outcome: outcome
        });
        await this.db.delete('sync_queue', item.id);
        console.log('[sync] Item archived to sync_audit:', item.id, 'outcome:', outcome);
    } catch (e) {
      // Arhivēšanas kļūda nedrīkst būt par iemeslu mirkļa ieraksta atstāšanu
      // rindā. Ieraksts jebkurā gadījumā vairs netiks sūtīts, tāpēc, ja
      // arhīvu neizdās saglabāt, ierakstu tomēr noņemam — pretērā rinda
      // aug bezgalzīgi un katra ielāde kļūst lēnāka. Skaņu brīdinājums
      // saglabājas, lai zaudējumu būtu iespējams izpētīt.
      console.warn('[sync] _archiveItem audits saglabāšana neizdevās, ieraksts tomēr noņemts no rindas:', e);
      try {
        await this.db.delete('sync_queue', item.id);
        console.log('[sync] noņemts bez audita:', item.id, 'outcome:', outcome);
      } catch (e2) {
        console.warn('[sync] neizdevās noņemt arhivējamu ierakstu no rindas:', e2);
      }
    }
    }

   async checkRetryAllowed(operationId) {
     if (!operationId) return { can_retry: true, reason: 'no_operation_id' };
     try {
       const result = await jsonpAction('check_retry_not_allowed', { operationId: operationId });
       return result;
     } catch (e) {
       // Ja nav savienojuma — atkārtošana ir vienīgais variants
       return { can_retry: true, reason: 'network_error' };
     }
   }

  async sync() {
    const summary = await this.processQueue();
    // Fire queueComplete (not syncComplete) to avoid triggering re-renders
    try {
      window.dispatchEvent(new CustomEvent('queueComplete', { detail: { queue: summary } }));
    } catch (e) {}
  }

  async hasLocalData() {
    try {
      const darbinieki = await this.db.getAll('darbinieki');
      if (darbinieki.length > 0) return true;
      // Dārbnieku var nebūt, bet klienti/uzdevomi jābūt — tad dati nav jāielādē no servera
      const klienti = await this.db.getAll('klienti');
      return klienti.length > 0;
    } catch (e) {
      return false;
    }
  }

  // Kad pēdējoreiz veiksmīgi ielādēti dati no Google (0 = nekad šajā ierīcē)
  async getLastSyncTime() {
    try {
      const meta = await this.db.getAll('meta');
      const row = (meta || []).find(m => m && m.key === 'lastSync');
      const ts = row && row.value ? Number(row.value) : 0;
      return isNaN(ts) ? 0 : ts;
    } catch (e) {
      return 0;
    }
  }

  async createEmployee(data) {
    const result = await jsonpAction('createEmployee', data);
    return result;
  }

  // ───────────────────────────────────────────────────────────────────────
  // MAIŅAS TIPS UZ SERVERI.
  //
  // Izvēle notiek katrā ielādē (grafiks ir mainīgs), tāpēc tā JAU ceļo
  // līdz katrai atzīmei kā mainaTips. Šis papildina tikai vienu lietu:
  // darbinieka ieraksts Google Sheet rāda, kas šobrīd ir uz kurā maiņā.
  //
  // Trīs apzināti lēmumi:
  //   1. TIEŠS jsonpAction, nevis rinda. Rindas ieraksts parādītos kā
  //      "nesaglabāts" un dzenātu lietotāju prom no programmas par nieku.
  //   2. Sūtām TIKAI tad, ja vērtība patiešām mainās. Katrs ielādējums
  //      bez izmaiņām būtu lieks pieprasījums — ar 200 klientiem tas
  //      ir troksnis, nevis dati.
  //   3. Kļūda NEDRĪKST bloķēt ielādi. Maiņa tips jau ir katrā atzīmē,
  //      tāpēc neizdevušais rakstījums neko neizjaud.
  // ───────────────────────────────────────────────────────────────────────
  async syncShift(employeeId, shift) {
    const value = String(shift || '').trim().toLowerCase();
    if (!employeeId || (value !== 'diennakts' && value !== 'dienas')) {
      return { skipped: true };
    }
    try {
      const res = await jsonpAction('setShift', {
        employeeId: employeeId,
        maina_tips: value
      });
      if (res && res.success) {
        // Vecāks serveris nezin 'setShift' un atgriež success:true bez
        // `changed`. Tāpēc apgalvot, ka kaut kas tika atjaunināts, drīkst
        // TIKAI kad serveris to skaidri apstiprina.
        if (res.changed === true) {
          console.log('[sync] maiņas tips atjaunināts serverī:', employeeId, '->', value);
        } else {
          console.log('[sync] maiņas tips pārbaudīts, izmaiņu nav:', employeeId, '->', value);
        }
      } else {
        console.warn('[sync] maiņas tips nenosūtīts:', res && res.error);
      }
      return res;
    } catch (e) {
      // Vecāks serveris var nezināt 'setShift'. Tas ir normāli — nekas
      // neizjaud, jo maiņa tips jau ceļo līdz katrai atzīmei.
      console.warn('[sync] maiņas tipa sinhronizācija izlaižusies (nav kritiska):', e && e.message);
      return { skipped: true, error: e && e.message };
    }
  }

  // Spec: Migrācija actionId → operationId un version kolonnas sākotnējai sync
  async runMigrations() {
    const migratedKey = 'migration_v3_complete';
    try {
      const meta = await this.db.getAll('meta');
      const alreadyDone = meta.find(m => m.key === migratedKey);
      if (alreadyDone) {
        console.log('[sync] Migration v3 already complete');
        return;
      }

      let changes = 0;

      // 1. actionId → operationId mapping for sync_queue items
      const queueItems = await this.db.getAll('sync_queue');
      for (const item of queueItems) {
        if (!item.operationId && item.change && item.change.data && item.change.data.actionId) {
          const empId = item.change.data.employeeId || item.change.data.employeeID || 'unknown';
          item.operationId = generateOperationId(empId);
          item.change.data.operationId = item.operationId;
          await this.db.put('sync_queue', item);
          changes++;
        }
      }

      // 2. Pievieno version kolonnu ierakstiem (atzimes, klienti, darbinieki, uzdevomi)
      for (const store of ['atzimes', 'klienti', 'darbinieki', 'uzdevomi']) {
        const items = await this.db.getAll(store);
        for (const item of items) {
          if (!item.version) {
            item.version = 1;
            await this.db.put(store, item);
            changes++;
          }
        }
      }

      await this.db.put('meta', { key: migratedKey, value: Date.now() });
      console.log('[sync] Migration v3 complete (' + changes + ' changes)');
    } catch (e) {
      console.warn('[sync] Migration failed:', e);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeRow, CareSync, generateOperationId };
}
if (typeof globalThis !== 'undefined') {
  globalThis.normalizeRow = normalizeRow;
  globalThis.CareSync = CareSync;
}
