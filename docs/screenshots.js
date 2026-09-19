/* =============================================================================
 * docs/screenshots.js
 * -----------------------------------------------------------------------------
 * Automātiska ekrānuzņēmumu ģenerēšanas rīks aprūpes sistēmai.
 *
 * Kas tas dara:
 *  1. Palaicina vienkāršu statisko WEB serveri (http) ar to mapi (nevajag `npm run dev`).
 *  2. Palaiž pārlūkprogrammu (Playwright + Chromium) un "jauş" (mockē) visus Google
 *     Sheets / Google Apps Script pieprasījumus (ping, load, rakstīšanas darbības),
 *     tāpēc lietotne darbojas pilnīgi lokāli bez internetla kaunāmiemiem.
 *  3. Pāriet cauri galvenajām darbību plūsmām (pieslēgšanās, aprūpētāja skats,
 *     aprūpes forma, administrators, kontroleļļa panelis), ņemot ekrānuzņēmumus.
 *  4. Saglabā ekrānuzņēmumus mapē docs/screenshots/ un ģenerē index.md ar
 *     aprakstiem — to var izmantot kā bāzi aprūpētāju instrukcijām.
 *
 * Palaišana:
 *   node docs/screenshots.js            # headless režīmā (automātiski)
 *   HEADED=1 node docs/screenshots.js   # redzama pārlūkprogramma (lai redzētu)
 *   SLOW=100 docs/screenshots.js        # lēts pārlūks (milisecūdes starp darbībām)
 *
 * Piezīme: skripts NEIZMAINĀ esošo lietotnes kodu. Tas tikai palaidzina to
 * lokāli un simulē datu avotu.
 * =========================================================================== */

'use strict';

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');          // projekta mape
const SCREEN_DIR = __dirname;                         // docs/
const IMG_DIR = path.join(__dirname, 'screenshots');  // docs/screenshots/
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain; charset=utf-8',
};

/* --------------------------------------------------------------------------
 * Rīgas laika palīdzīgfunkcijas (tiek atkārtoti lietotājsaskaitē) —
 * tās klasiskie Node Intl ar Europe/Riga laika joslu.
 * ------------------------------------------------------------------------- */
const RIGA_FMT = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Riga',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false
});
function rigaParts(d = new Date()) {
  const parts = {};
  for (const p of RIGA_FMT.formatToParts(d)) parts[p.type] = p.value;
  return parts;
}
function rigaISO(d = new Date()) {
  const p = rigaParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}
function rigaTime(d = new Date()) {
  const p = rigaParts(d);
  return `${p.hour}:${p.minute}:${p.second}`;
}
function rigaHour(d = new Date()) {
  return Number(rigaParts(d).hour);
}
const TODAY = rigaISO();
const TOMORROW = rigaISO(new Date(Date.now() + 86400000));
const YESTERDAY = rigaISO(new Date(Date.now() - 86400000));
const NOW_TIME = rigaTime();
// Maiņas noteikšana tāpat kā care_form.js: 05:00–18:59 = Rīts (R), citādi Vakars (V)
const SHIFT = (rigaHour() >= 5 && rigaHour() < 19) ? 'R' : 'V';
const OTHER_SHIFT = SHIFT === 'R' ? 'V' : 'R';
const SHIFT_LABEL = SHIFT === 'R' ? 'Rīts' : 'Vakars';
const OTHER_LABEL = OTHER_SHIFT === 'R' ? 'Rīts' : 'Vakars';

/* --------------------------------------------------------------------------
 * Paraugdatu kopa (simulēts Google Sheets saturs).
 * Ietver darbiniekus, klientus, aprūpes atzīmes, žurnālu un uzdevumus.
 * ------------------------------------------------------------------------- */
function buildMockData() {
  let counter = 0;
  const markId = (p) => `${p}_${TODAY.replace(/-/g, '')}_${++counter}_${Math.random().toString(36).slice(2, 8)}`;
  const dt = (d = TODAY) => `${d}T12:00:00`;

  const darbinieki = [
    { id: 'e_admin',    vards: 'Dāvis',   uzvards: 'Bērziņš', loma: 'administrators',  pin: '1234', aktivs: true, maina_tips: 'diennakts' },
    { id: 'e_janis',    vards: 'Jānis',   uzvards: 'Ozols',     loma: 'aprūpētājs',     pin: '1234', aktivs: true, maina_tips: 'diennakts' },
    { id: 'e_anna',     vards: 'Anna',    uzvards: 'Liepa',     loma: 'kontroliere',    pin: '1234', aktivs: true, maina_tips: 'diennakts' },
    { id: 'e_ruudolfs', vards: 'Ruudolfs', uzvards: 'Kļēvs',    loma: 'aprūpētājs',     pin: '1234', aktivs: true, maina_tips: 'diennakts' }
  ];

  const klienti = [
    { id: 'k_1', vards: 'Līga',    uzvards: 'Dzerbāne',  dzimis: '1952-05-14', dieta: 'Vājš ēdiens', saskarsmes: 'Ļaunatīga, valodas grūtības', aktivs: true, tel: '+371 22222222', e_pasts: 'liga@example.lv' },
    { id: 'k_2', vards: 'Roberts', uzvards: 'Kļaviņš',  dzimis: '1945-11-03', dieta: 'Tāls ēdiens', saskarsmes: 'Atvērta',              aktivs: true, tel: '+371 33333333', e_pasts: 'roberts@example.lv' }
  ];

  const atzimes = [];
  const log = [];
  // Helper: izveido atzīmi + atbilstošu žurnāla ierakstu
  const A = (cat, field, value, sh, emp, label) => {
    const id = markId('m');
    const m = {
      id, clientId: 'k_1', employeeId: emp, date: TODAY, time: NOW_TIME,
      shift: sh, category: cat, field: field, value: value,
      izveidots: dt(), lastModified: dt(), actionId: id + '_a'
    };
    atzimes.push(m);
    log.push({
      id: markId('l'), atzimeId: id, clientId: 'k_1', employeeId: emp,
      date: TODAY, time: NOW_TIME, shift: sh, category: cat, field: field,
      value: value, prevValue: '', type: 'Jauns', izveidots: dt(), lastModified: dt()
    });
    return m;
  };

  // --- Klients k_1: aktīvā maiņa (pēc reāla laika), ierakstījis Jānis ---
  // Temperatūra (drudzis — iemērs statistikai)
  A('temp', 'temperatura', '38.2', SHIFT, 'e_janis');
  // Higiēna (4 no 7 paveiktas)
  A('higiena', 'mutes_dobuma_kopsana', 'X', SHIFT, 'e_janis');
  A('higiena', 'vana_dns',           'X', SHIFT, 'e_janis');
  A('higiena', 'velas_maina',        'X', SHIFT, 'e_janis');
  A('higiena', 'nagu_kopsana',       'X', SHIFT, 'e_janis');
  // Aktivitāte (2 no 3)
  A('aktivitate', 'parvietojas_ar_palidzlekli', 'X', SHIFT, 'e_janis');
  A('aktivitate', 'sedz_ar_palidziigu',        'X', SHIFT, 'e_janis');
  // Ēdīšana (visas rezes)
  A('edinasana', 'brokastis',  'X', SHIFT, 'e_janis');
  A('edinasana', 'pusdienas',  '½', SHIFT, 'e_janis');
  A('edinasana', 'launags',    'A', SHIFT, 'e_janis');
  A('edinasana', 'vakariņi',   'X', SHIFT, 'e_janis');
  // Šķidrumi (kumulatīvi)
  A('sikdrumi', 'urina_daudzums', '420', SHIFT, 'e_janis');
  A('sikdrumi', 'uznemts_ml',     '1200', SHIFT, 'e_janis');
  // Fizioloģija + citi
  A('fiziologija', 'vedera_izeja',       'N', SHIFT, 'e_janis');
  A('citsi_pasakomi', 'adas_kopsana',          'X',  SHIFT, 'e_janis');
  A('citsi_pasakomi', 'pastaigas',             'X',  SHIFT, 'e_janis');
  A('citsi_pasakomi', 'ciemini',               'Nē', SHIFT, 'e_janis');
  A('citsi_pasakomi', 'autins_biksitu_skaits', '1',  SHIFT, 'e_janis');
  // Kolēģis Ruudolfs arī ierakstījis (komanddarbs)
  A('citsi_pasakomi', 'ciemini', 'X', SHIFT, 'e_ruudolfs');

  // --- Klients k_2: jau parakstījis Ruudolfs (aktīvā maiņa) → pabeigts ---
  atzimes.push({
    id: markId('m'), clientId: 'k_2', employeeId: 'e_ruudolfs',
    date: TODAY, time: NOW_TIME, shift: SHIFT, category: 'paraksts',
    field: 'aprupetaja_paraksts', value: 'Kļēvs',
    izveidots: dt(), lastModified: dt(), actionId: 'paraksts_k2'
  });
  log.push({
    id: markId('l'), clientId: 'k_2', employeeId: 'e_ruudolfs',
    date: TODAY, time: NOW_TIME, shift: SHIFT, category: 'paraksts',
    field: 'aprupetaja_paraksts', value: 'Kļēvs', prevValue: '',
    type: 'Jauns', izveidots: dt(), lastModified: dt()
  });
  // Viens labojums (rediģēts pieturele) — statistika "Labojumi"
  log.push({
    id: markId('l'), clientId: 'k_1', employeeId: 'e_janis',
    date: TODAY, time: '12:05:00', shift: SHIFT, category: 'temp',
    field: 'temperatura', value: '38.2', prevValue: '36.6',
    type: 'Labots', izveidots: dt(), lastModified: dt()
  });

  const uzdevomi = [
    { id: 't_1', teksts: 'Izveikt temperatūras mērījumu un ierakstīt klienta datus', klientsId: 'k_1', pieskirtDarbiniekamId: 'e_janis', termins: TODAY, prioritate: 'augsta', statuss: 'procesā', irPabeigts: false, izveidots: dt(), actionId: 't_1' },
    { id: 't_2', teksts: 'Atjaunināt kontaktinformāciju',                          klientsId: 'k_1', pieskirtDarbiniekamId: 'e_janis', termins: YESTERDAY, prioritate: 'zema',    statuss: 'jauns', irPabeigts: false, izveidots: dt(), actionId: 't_2' },
    { id: 't_3', teksts: 'Pārbaudīt medicīnisko karti',                             klientsId: 'k_2', pieskirtDarbiniekamId: 'e_anna',  termins: TODAY, prioritate: 'videja', statuss: 'pabeigts', irPabeigts: true, pabeigtajsId: 'e_anna', pabeigtsLaiks: NOW_TIME, izveidots: dt(), actionId: 't_3' }
  ];

  return { darbinieki, klienti, atzimes, atzimes_log: log, uzdevomi };
}

// Tukša kopa — lietotāja ielogušanai pirms pirmā administratora izvedes
function buildEmptyData() {
  return { darbinieki: [], klienti: [], atzimes: [], atzimes_log: [], uzdevomi: [] };
}

let MOCK_MODE = 'full'; // 'full' vai 'empty'

/* --------------------------------------------------------------------------
 * Locālais statiskais serveris (http)
 * ------------------------------------------------------------------------- */
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        let filePath = path.normalize(path.join(ROOT, urlPath));
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
        if (urlPath.endsWith('/') || urlPath === '') filePath = path.join(filePath, 'index.html');
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found'); return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const ctype = MIME[ext] || 'application/octet-stream';
        const buf = fs.readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': ctype,
          'Content-Length': buf.length,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': '*'
        });
        res.end(buf);
      } catch (e) {
        res.writeHead(500); res.end('Server error');
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

/* --------------------------------------------------------------------------
 * Palīga: sagaidīt noteiktu elementu / stāvokli
 * ------------------------------------------------------------------------- */
async function waitVisible(page, selector, timeout = 8000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}
async function waitFn(page, fn, timeout = 8000, poll = 100) {
  await page.waitForFunction(fn, { timeout, polling: poll });
}

/* ===========================================================================
 * GALVENĀ Funkcija
 * ========================================================================= */
async function run() {
  const HEADFUL = process.env.HEADED === '1';
  const SLOW = Number(process.env.SLOW || '0');
  const browser = await chromium.launch({ headless: !HEADFUL, slowMo: SLOW });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: HEADFUL ? 1 : 2
  });

  // "Jauss" Google Apps Script (script.google.com) pieprasījumus.
  // Lietotne domā, ka tā ir online ar Google Sheets datu bāzi.
  await context.route('**/*', (route, request) => {
    const url = request.url();
    if (url.includes('script.google.com') && url.includes('/exec')) {
      let u;
      try { u = new URL(url); } catch { return route.continue(); }
      const action = u.searchParams.get('action');
      const dataParam = u.searchParams.get('data');
      const callback = u.searchParams.get('callback');
      const cb = (n) => (n && n !== 'undefined' ? `${callback}(${n});` : `${callback}({success:true,result:true});`);

      if (action === 'ping') {
        return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8',
          body: `${callback}({success:true,pong:true});` });
      }
      if (action === 'load') {
        const payload = MOCK_MODE === 'empty' ? buildEmptyData() : buildMockData();
        return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8',
          body: `${callback}(${JSON.stringify(payload)});` });
      }
      if (dataParam) {
        let parsed = {};
        try { parsed = JSON.parse(decodeURIComponent(dataParam)); } catch { parsed = {}; }
        const result = parsed.action === 'createClient' || parsed.action === 'createEmployee'
          ? { success: true, id: 'id_' + Date.now() }
          : { success: true, result: true };
        return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8',
          body: `${callback}(${JSON.stringify(result)});` });
      }
    }
    return route.continue();
  });

  const page = await context.newPage();
  const screenshots = []; // { file, desc }
  function shoot(file, desc) {
    screenshots.push({ file, desc });
    return page.screenshot({ path: path.join(IMG_DIR, file), fullPage: true });
  }

  // === Statiskais serveris ===
  const { server, base } = await startStaticServer();
  console.log(`\nServeris: ${base}`);
  console.log(`Režīms: ${HEADFUL ? 'headed (redzams)' : 'headless'} | SlowMo: ${SLOW}ms\n`);

  try {
    /* ----------------------------------------------------------------
     * 1. Sākumlaps/app – spalšs ekrāns
     * -------------------------------------------------------------- */
    /* ----------------------------------------------------------------
     * 1. Sākumlaps/app — spalšs ekrāns, tad pieslēgšanās
     * ----------------------------------------------------------------
     * Skripts simulē, ka dati jau pastāv (darbinieki/klienti izveidoti),
     * tāpēc tieši ielogošanās forma tiek parādīta.
     * -------------------------------------------------------------- */
    MOCK_MODE = 'full';
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await waitFn(page, '!document.getElementById("splashScreen") || getComputedStyle(document.getElementById("splashScreen")).display === "none"');
    await shoot('01_splash.png', 'Sākumlapa ar logotipu (spalšs ekrāns)');

    await waitFn(page, 'document.querySelectorAll("#employeeList .employee-card").length > 0');
    await shoot('02_login_employee_list.png', 'Pieteikšanās ekrāns — darbinieku saraksts ar lomu filtru');

    // Filtrējam pēc aprūpētājiem (parāda lomu filtrēšanu)
    await page.click('#roleFilter .role-btn[data-role="aprupetas"]');
    await page.waitForTimeout(300);
    await shoot('03_login_filter_caregivers.png', 'Darbinieku filtrēšana pēc lomas — tikai aprūpētāji');
    await page.click('#roleFilter .role-btn[data-role="all"]');
    await page.waitForTimeout(300);

    // Izvēlam aprūpētāju (Jānis) un ievadam PIN
    await page.click('.employee-card[data-id="e_janis"]');
    await waitFn(page, 'document.getElementById("pinInput") && !document.getElementById("pinInput").disabled');
    await shoot('04_login_select_pin.png', 'Darbinieks izvēlēts — ievadiet PIN kodu (4–6 cifri)');
    await page.type('#pinInput', '1234', { delay: 200 });
    await waitFn(page, 'document.getElementById("loginBtn") && !document.getElementById("loginBtn").disabled');
    await shoot('05_login_pin_entered.png', 'PIN kods ievadīts — spiediet "Ienākt"');

    // Pieslēdzamies
    await page.click('#loginBtn');
    await page.waitForURL('**/aprupe.html', { timeout: 8000 });
    await waitFn(page, 'document.querySelectorAll("#clientGrid .client-card").length > 0');
    await shoot('06_caregiver_clients.png', 'Aprūpētāja sākumlapa — klientu saraksts ar statusa indikatoriem');

    /* ----------------------------------------------------------------
     * 5. Ekrāni ar piepildītām formām (aprupetajs.html)
     * -------------------------------------------------------------- */
    await page.goto(base + '/aprupetajs.html?client=k_1', { waitUntil: 'domcontentloaded' });
    await waitFn(page, 'document.getElementById("clientName") && document.getElementById("clientName").textContent.includes("Līga")');
    await shoot('07_care_form_overview.png', 'Klienta aprūpes forma — kategoriju rīkjons, kas ir jāaizpilda');

    // Higiēnas modāls (pārslēgļi)
    await page.click('.category-card[data-cat="higiena"]');
    await waitFn(page, 'document.getElementById("categoryModal") && getComputedStyle(document.getElementById("categoryModal")).display === "flex"');
    await shoot('08_category_hygiene.png', 'Higiēna — pārslēgļi (X = izdarīts)');
    await page.click('#modalClose');
    await page.waitForTimeout(200);

    // Ēdīšanas modāls (X / ½ / A)
    await page.click('.category-card[data-cat="edinasana"]');
    await waitFn(page, 'document.getElementById("categoryModal") && getComputedStyle(document.getElementById("categoryModal")).display === "flex"');
    await shoot('09_category_meals.png', 'Ēdīšana — ēdienrežu režīsti (X=pilna, ½=puse, A=atteikšanās)');
    await page.click('#modalClose');
    await page.waitForTimeout(200);

    // Šķidrumi modāls (ievade + kopsavilkums)
    await page.click('.category-card[data-cat="h2o"]');
    await waitFn(page, 'document.getElementById("categoryModal") && getComputedStyle(document.getElementById("categoryModal")).display === "flex"');
    await shoot('10_category_fluids.png', 'Šķidrumi — urīns un patērētais ūdens (ml), kopsavilkums zemājā daļā');
    await page.click('#modalClose');
    await page.waitForTimeout(200);

    // Fizioloģija modāls (izvēlne)
    await page.click('.category-card[data-cat="fiziologija"]');
    await waitFn(page, 'document.getElementById("categoryModal") && getComputedStyle(document.getElementById("categoryModal")).display === "flex"');
    await shoot('11_category_physiology.png', 'Vēdera izeja — izvēlieties stāvokli (N/A/S/C/K) un saglabājiet');
    await page.click('#modalClose');
    await page.waitForTimeout(200);

    // Temperatūras modāls (skaita ievade)
    await page.click('.category-card[data-cat="temp"]');
    await waitFn(page, 'document.getElementById("categoryModal") && getComputedStyle(document.getElementById("categoryModal")).display === "flex"');
    await shoot('12_category_temperature.png', 'Temperatūra — ievadiet skaitli °C (37°C+ dzidina sarkanā)');
    await page.click('#modalClose');
    await page.waitForTimeout(200);

    // Aktivitātes modāls (pārslēgļi)
    await page.click('.category-card[data-cat="aktivitate"]');
    await waitFn(page, 'document.getElementById("categoryModal") && getComputedStyle(document.getElementById("categoryModal")).display === "flex"');
    await shoot('13_category_activity.png', 'Aktivitāte — kustība ar palīdzību (pārslēgļi X)');
    await page.click('#modalClose');
    await page.waitForTimeout(200);

    // Pārējās darbības modāls (autiņbiksu skaitītājs)
    await page.click('.category-card[data-cat="diapers"]');
    await waitFn(page, 'document.getElementById("categoryModal") && getComputedStyle(document.getElementById("categoryModal")).display === "flex"');
    await shoot('14_category_other.png', 'Pārējās darbības — ādas kopšana, pastaiga, ciemiņi, autiņbiksu maiņa (+1)');
    await page.click('#modalClose');
    await page.waitForTimeout(200);

    // Paraksta kaste (aktīvā maiņa — nav parakstījis, poga aktīva)
    await waitFn(page, 'document.getElementById("signBtn")');
    await shoot('15_signature_card.png', 'Paraksts — aktīvā maiņa nav parakstīta, poga ir aktīva');

    /* ----------------------------------------------------------------
     * 6. Režīms: jau parakstījis cits (k_2) — paraksta bloķēšana
     * -------------------------------------------------------------- */
    await page.goto(base + '/aprupetajs.html?client=k_2', { waitUntil: 'domcontentloaded' });
    await waitFn(page, 'document.getElementById("clientName") && document.getElementById("clientName").textContent.includes("Roberts")');
    await waitFn(page, 'document.getElementById("signBtn")');
    await shoot('16_client_already_signed.png', 'Paraksts ir bloķēts — kāds cits jau ir parakstījis šo maiņu');

  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  /* ----------------------------------------------------------------
   * Ģenerējam satura indeksu README (markdown) no iegūtajiem
   * ekrānuzņēmumiem — to var iztulkot/tālveidot par instrukcijām.
   * -------------------------------------------------------------- */
  let md = '# Aprūpes sistēma — ekrānuzņēmumi\n\n';
  md += 'Šie ekrānuzņēmumi ir ģenerēti automātiski ar `docs/screenshots.js`.\n';
  md += 'Tostuļojiet tos kopā ar aprakstiem, lai izveidotu aprūpētāju instrukcijas.\n\n';
  md += '## Sanākumā\n\n';
  md += `| # | Ekrānuzņēmums | Apraksts |\n|---|---------------|----------|\n`;
  screenshots.forEach((s, i) => {
    md += `| ${i + 1} | ![${s.file}](screenshots/${s.file}) | ${s.desc} |\n`;
  });
  md += '\n## Darbību plūsmas pāreja\n\n';
  md += '1. **Pieteikšanās** — atlasiet darbinieku no saraksta un ievadiet PIN kodu.\n';
  md += '2. **Aprūpētāja sākumlapa** — atlasiet klientu, spiediet "Atvērt".\n';
  md += '3. **Aprūpes forma** — katru dienu aizpildiet kategorijas (temperatūra, higiēna, ēdīšana, šķidrumi, fizioloģija, citi).\n';
  md += '4. **Paraksts** — nospiediet "Maiņu nododu/pieņemu", kad visi ieraksti ir veikti.\n';
  md += '5. Ja kāds cits jau ir parakstījis, poga tiek bloķēta — katram klientam vienā maiņā ir tikai viens paraksts.\n\n';

  fs.writeFileSync(path.join(SCREEN_DIR, 'INSTRUCTIONS.md'), md, 'utf8');
  console.log(`\nGatavs! ${screenshots.length} ekrānuzņēmumi saglabāti:`);
  screenshots.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2, '0')}. screenshots/${s.file}  — ${s.desc}`));
  console.log(`\nIndeksa fails: ${path.join(SCREEN_DIR, 'INSTRUCTIONS.md')}`);
  process.exit(0);
}

if (require.main === module) {
  run().catch(async (err) => {
    console.error('Kļūda:', err);
    process.exit(1);
  });
}

module.exports = {
  buildMockData,
  buildEmptyData,
  startStaticServer,
  rigaISO, rigaTime, rigaHour, rigaParts,
  TODAY, SHIFT, OTHER_SHIFT
};
