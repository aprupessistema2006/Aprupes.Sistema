// ═══════════════════════════════════════════════════════════════════════
//  Atslēgas indeksa aizpildīšana (backfill_keys)
// ═══════════════════════════════════════════════════════════════════════
//  PĒC tam, kad esi izvietojis jauno gas_webhook.gs, palaid:
//
//      node scripts/run_backfill.js <GAS_URL>
//
//  Piemēram:
//      node scripts/run_backfill.js https://script.google.com/macros/s/AKfy.../exec
//
//  Skripts pats atkārto zvanu, līdz pabeidz (parasti ~23 paudiensi ar
//  225 930 rindām), un pēc tam pārbauda, ka 'mark' strādā ātri.
//
//  ⚠️ Kamēr backfill NAV pabeidzis, dati ir pilnīgi KORREKTI, bet
//  'mark' vēl ir lēns (~17 s). Tas ir ar nodomu — neizpildīts backfill
//  nekad neizjauc datus, tas tikai paliek lēnāks. Tas tāpēc, lai tu
//  nevaru neparedzēti nogadīt klīniskos datus, ja backfill pēkšņi
//  apstājas.
// ═══════════════════════════════════════════════════════════════════════

const https = require('https');

const BASE = process.argv[2];
if (!BASE) {
  console.error('Lietojums: node scripts/run_backfill.js <GAS_URL>');
  process.exit(2);
}

function call(payload, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE);
    url.searchParams.set('data', JSON.stringify(payload));
    const t0 = Date.now();
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AprupesBackfill/1.0',
        'Accept': '*/*',
        'Connection': 'close'
      }
    };
    const req = https.get(url.toString(), opts, res => {
      // GAS dažkārt atsūta 302 uz citu adresi. Bez sekošanas tam
      // atbilde nonāk tukša un kļūda ir nesaprotama.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 5) return reject(new Error('Pārāk daudz novirzīšanu'));
        return resolve(call(payload, redirects + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => (body += d));
      res.on('end', () => {
        const trimmed = body.replace(/^﻿/, '').trim();
        if (res.statusCode !== 200 || trimmed === '') {
          return reject(new Error(
            `HTTP ${res.statusCode}, ${body.length} baiti. ` +
            (trimmed === '' ? 'Tukša atbilde — parasti nozīmē GAS izpildes timeout (>6 min) vai pārāk liels viens paudiens.' : 'Atbilde: ' + trimmed.slice(0, 200))
          ));
        }
        try { resolve({ json: JSON.parse(trimmed), ms: Date.now() - t0 }); }
        catch (e) { reject(new Error('Neatpārnesīgs JSON: ' + trimmed.slice(0, 200))); }
      });
    });
    req.setTimeout(590000, () => { req.destroy(new Error('Laika limits (590s)')); });
    req.on('error', reject);
  });
}

function bar(pct, width) {
  const n = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(n) + ' '.repeat(width - n) + '] ' + String(pct).padStart(3) + '%';
}

(async () => {
  console.log('Backfill sākas...\n');
  let guard = 0;
  let res;
  do {
    const out = await call({ action: 'backfill_keys' });
    res = out.json;
    if (res.error) { console.error('KļŪDA: ' + res.error); process.exit(1); }
    guard++;
    console.log(
      `  ${bar(res.pct || 0, 28)}  rindas ${res.fromRow || 0}–${res.toRow || 0} ` +
      `no ${res.totalRows || '?'}  (${(out.ms / 1000).toFixed(1)}s)`
    );
    if (guard > 200) { console.error('Nepārcāja 200 paudiensu — apstādinu.'); process.exit(1); }
  } while (!res.done);

  console.log('\nBackfill PABEIDZIS. Indekss ir aktīvs.\n');

  // ── Pārbaude: cik ātri tagad strādā `mark`? ───────────────────────
  const probe = {
    action: 'mark',
    data: {
      clientId: 'c_backfill_probe', employeeId: 'e_backfill_probe',
      date: '2026-09-29', shift: 'V', category: 'sikdrumi',
      field: 'udens', value: '1000',
      actionId: 'probe_' + Date.now(), operationId: 'probe_op_' + Date.now()
    }
  };
  for (let i = 1; i <= 2; i++) {
    const out = await call(probe);
    const d = out.json._diag || {};
    const ph = Object.entries(d.phasesMs || {}).map(([k, v]) => `${k}=${v}ms`).join('  ');
    console.log(`  mark mērījums ${i}: ${(out.ms / 1000).toFixed(2)}s   ` +
      `already_processed=${out.json.already_processed}   ${ph}`);
  }
  console.log('\nPiezīme: pirmais no diviem mērījumiem var būt lēnāks (aizpildīšana');
  console.log('Google kešatmiņu). Salīdzināšanai: pirms šī izmaiņa bija ~52s.');
})().catch(e => { console.error('KĻŪDA: ' + e.message); process.exit(1); });
