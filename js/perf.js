// perf.js — ielādes laika mērīšana.
//
// KO DARA
// -------
// Katrs nozīmīgais ielādes posms tiek mērīts un izdrukāts konsolē vienā
// kopsavilkuma blokā, lai uzreiz redzētu kur paliek laiks:
//
//   pieprasījuma sākums → servera atbilde → datu apstrāde →
//   dati gatavi lietošanai → UI gatavs
//
// Lietošana:
//   Perf.init('control.html');
//   await Perf.measure('bootstrap', async () => { ... });
//   Perf.sub('bootstrap', 'servera atbilde', ms);
//   Perf.markUI('UI gatavs');
//   Perf.summary();
//
// Konsolē:
//   __carePerf.summary()   — pilns kopsavilkums
//   __carePerf.dict()      — mašīnlasāms masīvs (lai kopēt/analizēt)

(function (global) {
  'use strict';

  const now = () => (global.performance && global.performance.now ? performance.now() : Date.now());

  function fmt(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return '   —  ';
    const v = Math.round(ms);
    if (v < 1000) return String(v).padStart(5) + ' ms';
    return (v / 1000).toFixed(2).padStart(6) + ' s';
  }

  function fmtSec(ms) {
    return ((ms || 0) / 1000).toFixed(2) + ' s';
  }

  class Perf {
    constructor() {
      this.reset('');
    }

    reset(session) {
      this.session = session || '';
      this.t0 = now();
      this.pageStart = Date.now();
      this.entries = [];
      this.byKey = new Map();
      this.notes = [];
      this.uiReadyAt = null;
      this._net = [];
    }

    // reset() galvenais nosaukums; init() ir vaija, lai izsaukumi no lapām
    // būtu skaidrāki: Perf.init('control.html').
    init(session) {
      this.reset(session);
      if (this._auto) { clearTimeout(this._auto); this._auto = null; }
      return this;
    }

    // --- galvenie mērījumi -------------------------------------------------

    /**
     * Mēra asinhrono darbību un reģistrē to ar norādīto nozīmi.
     * Atgriež tā paša funkcijas rezultātu.
     */
    async measure(label, fn, opts) {
      const options = opts || {};
      const start = now();
      const entry = {
        label,
        group: options.group || 'ielāde',
        start,
        ms: null,
        subs: [],
        error: null,
        skipped: false,
        skippedReason: null
      };
      this.entries.push(entry);
      if (!this.byKey.has(label)) this.byKey.set(label, entry);
      console.log('[perf] ▶ ' + label + '…');
      try {
        const result = await fn(entry);
        entry.ms = now() - start;
        console.log('[perf] ◀ ' + label + ': ' + fmt(entry.ms));
        return result;
      } catch (err) {
        entry.ms = now() - start;
        entry.error = err;
        console.warn('[perf] ✖ ' + label + ' neizdevās pēc ' + fmt(entry.ms) + ': ' + (err && err.message));
        throw err;
      }
    }

    /** Rāda, ka posms tika izlaists (piem. dati jau aktuāli). */
    skipped(label, reason) {
      const existing = this.byKey.get(label);
      if (existing) {
        existing.skipped = true;
        existing.skippedReason = reason;
        return existing;
      }
      const entry = { label, group: 'ielāde', start: now(), ms: 0, subs: [], skipped: true, skippedReason: reason, error: null };
      this.entries.push(entry);
      this.byKey.set(label, entry);
      console.log('[perf] ⏭ ' + label + ' izlaista — ' + reason);
      return entry;
    }

    /** Reģistrē apakšposmu (servera atbilde, datu apstrāde, ...). */
    sub(label, name, ms) {
      const entry = this.byKey.get(label) || null;
      const rec = { name, ms };
      if (entry) entry.subs.push(rec);
      this._net.push({ op: label, phase: name, ms });
      return rec;
    }

    /** Brīva piezīme, parādās kopsavilkumā. */
    note(text) {
      this.notes.push({ text, at: now() - this.t0 });
      console.log('[perf] · ' + text);
    }

    // --- tīkla mērījumi ---------------------------------------------------

    /**
     * Mēra vienu HTTP pieprasījumu: request → response → parse.
     * atvienojamais: atgriež { sent, sentMs, responseMs, totalMs, bytes }
     */
    async net(label, fn) {
      const t = now();
      const pending = { op: label, sentAt: Date.now() };
      this._net.push(pending);
      try {
        const data = await fn({
          onSent: () => { pending.sentMs = now() - t; },
          onResponse: (bytes) => {
            pending.responseMs = now() - t;
            pending.sentMs = pending.sentMs || 0;
            pending.bytes = bytes;
            console.log(
              '[perf] 🌐 ' + label + ': sūts ' + Math.round(pending.sentMs) + 'ms → ' +
              'serveris ' + Math.round(pending.responseMs) + 'ms' +
              (bytes ? ' (' + Math.round(bytes / 1024) + ' KB)' : '')
            );
          }
        });
        pending.totalMs = now() - t;
        return data;
      } catch (err) {
        pending.totalMs = now() - t;
        pending.error = err && err.message;
        throw err;
      }
    }

    // --- UI notācijas -----------------------------------------------------

    markUI(label, ms) {
      this.uiReadyAt = ms !== undefined ? ms : now() - this.t0;
      this.note(label || 'UI gatavs');
      return this.uiReadyAt;
    }

    // --- izvade -----------------------------------------------------------

    total() {
      return now() - this.t0;
    }

    /** Pirmie dati bija gatavi pēc šī daudzuma ms. */
    timeToData() {
      const e = this.byKey.get('lokālie dati (IndexedDB)') ||
                this.byKey.get('local') || null;
      if (e && e.ms !== null) return e.ms;
      return null;
    }

    summary() {
      const total = this.total();
      const line = '─'.repeat(58);
      console.log('%c[perf] ' + line + ' [%c' + fmt(total) + '%c  kopā] ' + line,
        'color:#fff;background:#2c3e50;padding:2px 6px', 'color:#fff;background:#e74c3c;padding:2px 6px;font-weight:700', '');

      if (this.session) console.log('[perf] 📄 ' + this.session);

      const rows = [];
      this.entries.forEach(e => {
        const detail = e.subs && e.subs.length
          ? e.subs.map(s => s.name + ' ' + Math.round(s.ms) + 'ms').join(' · ')
          : '';
        if (e.skipped) {
          rows.push({ posms: Math.round(e.start - this.t0), posmsS: fmtSec(e.start - this.t0), pos: e.label, ilgaums: 'izlaista ⚠️', kas: e.skippedReason || '' });
          return;
        }
        rows.push({
          posms: Math.round(e.start - this.t0),
          posmsS: fmtSec(e.start - this.t0),
          pos: e.label,
          ilgaums: fmt(e.ms),
          kas: e.error ? ('✖ ' + e.error) : detail
        });
      });

      if (typeof console.table === 'function') console.table(rows);
      else rows.forEach(r => console.log('[perf]   ' + r.posmsS + '  ' + r.pos + ' → ' + r.ilgaums + '  ' + r.kas));

      const t2d = this.timeToData();
      if (t2d !== null) {
        console.log('%c[perf] ⚡ pirmie lietojami dati ekrānā pēc ' + Math.round(t2d) + ' ms (' + fmtSec(t2d) + ')',
          'color:#fff;background:#27ae60;padding:2px 6px;border-radius:3px;font-weight:700');
      }
      if (this.uiReadyAt !== null) {
        console.log('%c[perf] 🖥️ UI gatavs pēc ' + Math.round(this.uiReadyAt) + ' ms (' + fmtSec(this.uiReadyAt) + ')',
          'color:#fff;background:#2980b9;padding:2px 6px;border-radius:3px;font-weight:700');
      }
      if (this.notes.length) {
        console.log('[perf] piezīmes:');
        this.notes.forEach(n => console.log('   +' + Math.round(n.at) + 'ms  ' + n.text));
      }
      console.log('[perf] kopējais ielādes laiks: ' + Math.round(total) + ' ms / ' + fmtSec(total));
      return { total, rows, t2d, uiReady: this.uiReadyAt };
    }

    /** Kopsavilkums automātiski, 60 s pēc pirmā mērījuma. */
    autoSummary(delayMs) {
      if (this._auto) clearTimeout(this._auto);
      this._auto = setTimeout(() => {
        this._auto = null;
        this.summary();
        if (global.opRegistry && global.opRegistry.logSummary) global.opRegistry.logSummary();
      }, delayMs || 60000);
    }

    dict() {
      return {
        session: this.session,
        totalMs: Math.round(this.total()),
        totalSec: (this.total() / 1000).toFixed(2),
        timeToDataMs: this.timeToData(),
        uiReadyMs: this.uiReadyAt === null ? null : Math.round(this.uiReadyAt),
        steps: this.entries.map(e => ({
          label: e.label,
          startedAtMs: Math.round(e.start - this.t0),
          durationMs: e.ms === null ? null : Math.round(e.ms),
          skipped: !!e.skipped,
          skipReason: e.skippedReason || null,
          error: e.error ? String(e.error.message || e.error) : null,
          subPhases: (e.subs || []).map(s => ({ name: s.name, ms: Math.round(s.ms) }))
        })),
        network: this._net.map(n => ({
          op: n.op,
          sentMs: n.sentMs === undefined ? null : Math.round(n.sentMs),
          responseMs: n.responseMs === undefined ? null : Math.round(n.responseMs),
          totalMs: n.totalMs === undefined ? null : Math.round(n.totalMs),
          bytes: n.bytes || null,
          error: n.error || null
        })),
        notes: this.notes.map(n => n.text)
      };
    }
  }

  const perf = new Perf();

  // Lapa ielādēta / DOM gatavs — pirmais iespējamais "sākums".
  if (global.document) {
    perf.init(document.title || 'sala');
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        perf.markUI('DOM gatavs', performance.now());
      });
    }
    global.addEventListener('load', () => {
      perf.markUI('window load', performance.now());
    });
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.Perf = perf;
    globalThis.__carePerf = perf;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = perf;
})(typeof globalThis !== 'undefined' ? globalThis : this);
