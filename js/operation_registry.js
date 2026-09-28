// operation_registry.js — KLIENTA puses operāciju reģistrs.
//
// KO ŠIS IR UN KĀPŠU TAS VAJAG
// --------------------------------
// Google Sheets sinhronizācija ir dārga un lēna. Ja viena lietotāja darbība
// (piem. "atvērt control.html") izsauc 3–4 sync izsaukumus, tad mēs:
//   * dublējam pieprasījumus uz GAS (kvota, lēnāk, risks 429/500),
//   * katrs izsaukums pārraksta IndexedDB ar saviem rezultātiem,
//   * lietotājs 20+ sekundes skata "Ielādēju klientus un darbiniekus...".
//
// Šis reģistrs nodrošina vienu vienību: 1 DARBĪBA = 1 SINHRONIZĀCIJA.
// Ja tā pati darbība jau ir izpildēšanā, jaunais izsaukums saņem to pašu
// Promise — nevis sāk otru identisku ielādi, bet arī negaida bezgalīgi.
//
// KO ŠIS NAV
// ----------
// GAS "operation_registry" LAPA (backend/gas_webhook.gs) — tā ir cita lieta.
// Tā ir servera puses idempotence: lai rakstīšanas operācija (mark, createTask)
// netiktu izpildīta divreiz, ja mobilais tīkls nometīs atbildi un nosūtīs
// to pa jaunu. Šis klienta reģistrs par to nezin — viņš tādēļ saucas
// "registry", bet risina citu uzdevumu: dublējumu novēršanu vienā ierīcē.

(function (global) {
  'use strict';

  // Lietotājs var nomainīt logu ar LocalStorage atslēgu, ja grib izpētīt,
  // kas tiek bloķēts. Noklusējumā brīdinājumi ir ieslēgti — tie ir svarīgi.
  const DEBUG_KEY = 'careDebugSync';

  const STATUS_ACTIVE = 'ACTIVE';
  const STATUS_DONE = 'DONE';
  const STATUS_FAILED = 'FAILED';
  const STATUS_SKIPPED = 'SKIPPED';

  class OperationRegistry {
    constructor(name) {
      this.name = name || 'default';
      // key -> ieraksts
      this.entries = new Map();
      this._idSeq = 0;
    }

    _debug() {
      try { return global.localStorage && global.localStorage.getItem(DEBUG_KEY) === '1'; } catch (e) { return false; }
    }

    _nextId() {
      this._idSeq += 1;
      return this.name + '#' + this._idSeq;
    }

    _describe(entry) {
      const ms = entry.startedAt ? Math.round(entry.durationMs) : 0;
      return entry.id + ' "' + entry.key + '" ' + ms + 'ms';
    }

    isActive(key) {
      const e = this.entries.get(key);
      return !!e && e.status === STATUS_ACTIVE;
    }

    get(key) {
      return this.entries.get(key) || null;
    }

    /**
     * Reģistrē operāciju. Ja tā pati atslēga jau ir ACTIVE, atgriež to pašu
     * ierakstu (ar tā pašu promise) — lētākais un skaidrākais veids, kā
     * novērst dubultu darbu.
     *
     * @param {string} key      operācijas nosaukums, piem. 'sync:bootstrap'
     * @param {Function} fn     async () => any
     * @param {object} [opts]   { force } — ignorēt "jau pabeigta" kešu
     * @returns {{ started: boolean, entry: object, promise: Promise }}
     */
    run(key, fn, opts) {
      const options = opts || {};
      const existing = this.entries.get(key);

      if (existing && existing.status === STATUS_ACTIVE) {
        console.log(
          '[registry] ⛔ DUBLĒTS BLOĶĒTS: "' + key + '" jau izpildās (' +
          Math.round((global.performance ? performance.now() : Date.now()) - existing.startedPerf) +
          'ms). Izmantoju esošo ielādi, jaunu netaisu.'
        );
        existing.duplicateHits = (existing.duplicateHits || 0) + 1;
        return { started: false, entry: existing, promise: existing.promise };
      }

      const now = global.performance ? performance.now() : Date.now();
      const entry = {
        id: this._nextId(),
        key,
        status: STATUS_ACTIVE,
        startedAt: Date.now(),
        startedPerf: now,
        endedPerf: null,
        durationMs: null,
        error: null,
        result: null,
        duplicateHits: 0,
        promise: null
      };
      this.entries.set(key, entry);

      console.log('[registry] ▶ START ' + this._describe(entry) + (existing ? ' (atkārtoti pēc ' + existing.status + ')' : ''));

      entry.promise = (async () => {
        try {
          const result = await fn(entry);
          entry.result = result;
          entry.status = STATUS_DONE;
          return result;
        } catch (err) {
          entry.status = STATUS_FAILED;
          entry.error = err;
          throw err;
        } finally {
          entry.endedPerf = global.performance ? performance.now() : Date.now();
          entry.durationMs = entry.endedPerf - entry.startedPerf;
          if (entry.duplicateHits > 0) {
            console.log(
              '[registry] ⛔ ' + entry.key + ': bloķēti ' + entry.duplicateHits +
              ' dublētu izsaukumu. Īstā ielāde notika ' + Math.round(entry.durationMs) + 'ms reizē.'
            );
          }
          console.log('[registry] ■ END   ' + this._describe(entry) + ' → ' + entry.status);
        }
      })();

      return { started: true, entry, promise: entry.promise };
    }

    /**
     * Vienreizējs atzīmējums — ja tāds šāds notikums jau tika pierakstīts
     * noteiktajā laika loglodziņā, ignorē to. Lietojams tam, ko lietotājs
     * negaida katru reizi (piem. "rādīt paziņojumu par 404 transportu").
     */
    throttle(key, windowMs) {
      const now = Date.now();
      const last = this._throttle || (this._throttle = {});
      if (last[key] && now - last[key] < windowMs) return false;
      last[key] = now;
      return true;
    }

    stats() {
      const list = [];
      this.entries.forEach(e => list.push({
        key: e.key,
        status: e.status,
        ms: e.durationMs === null ? null : Math.round(e.durationMs),
        blocked: e.duplicateHits || 0
      }));
      return list;
    }

    logSummary() {
      const list = this.stats();
      if (!list.length) return;
      const blocked = list.reduce((n, e) => n + e.blocked, 0);
      console.log(
        '%c[registry] KOPĀ ' + list.length + ' operācijas, ' + blocked + ' dublēti izsaukumi bloķēti',
        'color:#fff;background:#7f8c8d;padding:2px 6px;border-radius:3px;font-weight:600'
      );
      console.table ? console.table(list) : console.log(list);
    }
  }

  // Vienis instanses lapā — visi CareSync objekti dalās ar to.
  const registry = new OperationRegistry('sync');
  if (typeof globalThis !== 'undefined') {
    globalThis.OperationRegistry = OperationRegistry;
    globalThis.opRegistry = registry;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OperationRegistry, opRegistry: registry, STATUS_ACTIVE, STATUS_DONE, STATUS_FAILED, STATUS_SKIPPED };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
