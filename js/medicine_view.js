// MedicineView — "PROBLĒMU PIRMS" medicīniskais skats.
//
// KAS ŠIS NEDARA (un tas bija galvenā sūkšba)
// -------------------------------------------------
// Vecajā versijā katrs rādījums katram klientam tika rādīts atsevišķi:
//   🔴 Anna Kanna Temperatūra 38.4   🔴 Anna Kanna Temperatūra 39
//   🔴 Janīna Kaucīte H2O (bez vērtības)  🟡 Anna Kanna Pārvietošanās X ⊘ - X
// Rezultāts: 20 kartes, 5 no tām — tukši lauki, 3 dublēti ieraksti par
// vienu un to pašu lauku dienas laikā, 0 informācijas. Mediķis bija
// spiestu iet cauri visiem klientiem, lai saprastu, kas notiek.
//
// KO ŠIS NODARĀ
// -------------
// 1. Sākums = klientu saraksts ar skaitļiem:
//        Anna Kanna          35 g · BEZLAKTOZES    🔴 2  🟡 1  📈 1
//        Jānis Bērziņš       35 g · VEGĀNISKĀ     ✅ stabilā stāvoklī
//    Mediķis redz PROBLEMU skaitu pirms klienta pats tika atvērts.
// 2. Klikšķis uz klienta = sava veida kopsavilkums ar trijām grupām:
//        🔴 Kritiskie rādījumi   — tikai tie, kas patiešām ir kritiski, ar iemeslu
//        🟡 Uzmanība             — tikai AKTĪVAS problēmas (vecās → vēsturē)
//        📈 Tendences           — tikai ar ≥2 salīdzinājamiem punktiem
// 3. Dublēšanās nav iespējama: viens klients + viens lauks = viens ieraksts.
// 4. Pilna aprūpes lapa ir kā sekundārais, detalizētais skats.

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// NOTEIKUMI — viens avots patiesībai.
//
// Vecajā kodā bija divas nesakārtotas kopas (CRITICAL_FIELDS konstantē un
// atkārtoti ierakstīti if-zari analizē), un tās strīdējās savā starpā:
// urine < 400 vienā vietā, uznemts_ml < 1200 citā un < 800 trešajā.
// Tagad katrs noteikums ir VIENĀ vietā un katrs sev līdzi iemeslu, kas
// parādās ekrānā — lai mediķis redzētu, KĀPĒC šis rādījums ir sarakstā.
// ─────────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// MEDICĪNAS FILTRIS
//
// Sadaļa ir "filtrs", nevis datu izgāztuve. Tā analizē TIKAI četras
// medicīniski nozīmīgas kategorijas (spec §3):
//
//   🌡 Temperatūra      temp/temperatura
//   🍽 Ēšana            edinasana/brokastis|pusdienas|launags|vakariņi
//   💧 Šķidrumi         sikdrumi/urina_daudzums|uznemts_ml
//   🚽 Vēdera izeja     fiziologija/vedera_izeja
//
// Viss pārējais (higiēna, vanna, veļa, nagi, mati, bārda, pastaigas,
// ciemiņi, autiņbiksītes, pārvietošanās, paraksti) ir sociālā darba
// aprūpes dati un ŠEIT NEDRĪKST parādīties (spec §8).
//
// Galvenais princips (spec §9):
//   "Aprūpes darbs nav izdarīts" ≠ "medicīniska problēma".
//   Neatzīmēta brokastis / neatzīmēts temps / neatzīmēts H2O — TIE
//   NĒRĀDA brīdinājumu. Brīdinājumu rada tikai reāls medicīniskais
//   saturs vai tā atkārtošanās.
// ═══════════════════════════════════════════════════════════════════════════

// Vienīgais atļauto lauku saraksts. Viss pārējais tiek izfiltrēts pirms
// analīzes — pat ja kāds lauks tur būtu, tas nevar parādīties.
// Šis ir vienīgais veids, kā garantēt spec §8.
const MEDICINE_FIELDS = [
  { cat: 'temp', field: 'temperatura', label: 'Temperatūra', icon: '🌡', unit: '°C' },
  { cat: 'edinasana', field: 'brokastis', label: 'Brokastis', icon: '🍽', unit: '' },
  { cat: 'edinasana', field: 'pusdienas', label: 'Pusdienas', icon: '🍽', unit: '' },
  { cat: 'edinasana', field: 'launags', label: 'Launags', icon: '🍽', unit: '' },
  { cat: 'edinasana', field: 'vakariņi', label: 'Vakariņas', icon: '🍽', unit: '' },
  { cat: 'sikdrumi', field: 'urina_daudzums', label: 'Urīns 24h', icon: '💧', unit: 'ml' },
  { cat: 'sikdrumi', field: 'uznemts_ml', label: 'H₂O 24h', icon: '💧', unit: 'ml' },
  { cat: 'fiziologija', field: 'vedera_izeja', label: 'Vēdera izeja', icon: '🚽', unit: '' }
];

const MEDICINE_FIELD_SET = new Set(MEDICINE_FIELDS.map(f => f.field));
const MEDICINE_CATEGORIES = new Set(MEDICINE_FIELDS.map(f => f.cat));

// ── 🌡 Temperatūra ──────────────────────────────────────────────────────────
const TEMP_CRITICAL = 37;          // CONFIG.FIELD_DEFINITIONS.temp.lowThreshold
const TEMP_RISE_NOTABLE = 0.5;     // °C kāpums, ko jau rāda kā tendenci

// ── 💧 Šķidrumi (robežas konfigurējamas — pielāgo pēc klīniskajām norādēm) ──
const URINE_LOW = 400;             // ml/24h — zem → 🔴
const URINE_HIGH = 2000;           // ml/24h — virs → 🟡
const H2O_LOW = 800;               // ml/24h — zem → 🔴
const H2O_HIGH = 2500;             // ml/24h — virs → 🟡
const FLUID_CHANGE_PCT = 30;        // % diennakts maiņa → 📈

// ── 🚽 Vēdera izeja ─────────────────────────────────────────────────────────
// Vērtības ņemtas no CONFIG.VALUE_LEGEND.VEDERA_IZEJA.
// ⚠️ "S" = Svecīte. "Slimnīca" NAV šeit — tā ir klienta statuss laukā
// `statuss` un to apstrādā atsevišķi (_isHospital).
const BOWEL_LABEL = (typeof CONFIG !== 'undefined' && CONFIG.VALUE_LEGEND && CONFIG.VALUE_LEGEND.VEDERA_IZEJA)
  ? CONFIG.VALUE_LEGEND.VEDERA_IZEJA
  : { N: 'Normāla', S: 'Svecīte', A: 'Aizcietējumi', C: 'Caureja', K: 'Klizma' };

// Patoloģiskas vērtības → 🔴. "Klizma" ir medicīniska iejauksme, nevis
// patoloģija → 🟡.
const BOWEL_CRITICAL = { A: 'aizcietējumi', C: 'caureja' };
const BOWEL_ATTENTION = { K: 'medicīniska iejauksme' };
const BOWEL_NORMAL = ['N', 'S'];
const BOWEL_ABSENT_DAYS = 2;       // bez izkārnīšanās N dienas → 🟡

// Atzīmētas vērtības (rādāmās), atšķirībā no null = "nav ieraksta".
// Ieskaitās arī "P – patstāvīgi", kas tiek rādīts, bet netiek mērīts.
const MEAL_KNOWN = (typeof CONFIG !== 'undefined' && CONFIG.VALUE_LEGEND && CONFIG.VALUE_LEGEND.ĒDIŠANA)
  ? CONFIG.VALUE_LEGEND.ĒDIŠANA
  : { X: 'Visa porcija', '½': 'Puse porcijas', A: 'Atteicās', P: 'Patstāvīgi' };

// Koliko punktu dotam vērtībai ēšanas apjoma aprēķinam. "P" apzināti nav
// iekļauts — tā klīniskā nozīme nav apstiprināta (skatīt MEAL_TEXT).
const mealScore = (v) =>
  (Object.prototype.hasOwnProperty.call(MEAL_SCORE, v) ? MEAL_SCORE[v] : null);
const mealKnown = (v) =>
  !!v && Object.prototype.hasOwnProperty.call(MEAL_KNOWN, v);

// ── 🍽 Ēšana ────────────────────────────────────────────────────────────────
// Vērtības ņemtas no CONFIG.VALUE_LEGEND.ĒDIŠANA (vienīgais avots):
//   X = visa porcija, ½ = puse porcijas, A = atteicās, P = patstāvīgi.
// null = NAV IERAKSTA un NĒKAD netiek rādīts kā brīdinājums (spec §9).
//
// ⚠️ "P – patstāvīgi" tiek rādīts, bet NETIEK mērīts porciju punktos.
// Mēs neizdomājam tā klīnisko nozīmi, tāpēc tas nevar ne palielināt, ne
// samazināt diennakts ēšanas apjomu. Ja tam jābūt ar punktu vērtību,
// izmainiet P_COLOR/MEAL_SCORE — bet ne paņemiet to klīniski nozīmīgu
// nozīmi bez apstiprinājuma.
const MEAL_FIELDS = ['brokastis', 'pusdienas', 'launags', 'vakariņi'];
const MEAL_LABEL = { brokastis: 'Brokastis', pusdienas: 'Pusdienas', launags: 'Launags', 'vakariņi': 'Vakariņas' };
const MEAL_SCORE = { 'X': 2, '½': 1, 'A': 0 };
const MEAL_TEXT = { 'X': 'ēdis', '½': '½', 'A': 'atteicies', 'P': 'patstāvīgi' };
const MEAL_LOW_DAYS = 3;           // dienas pēc kārtas ar ≤½ porcijām → 🔴
const MEAL_REFUSAL_DAYS = 2;       // dienas pēc kārtas ar atteikumiem → 🟡
const MEAL_REFUSALS_ONE_DAY = 2;   // atteikumi vienā dienā → 🟡
const MEAL_TREND_DROP = 0.5;       // punktu zudums diennakts vidē → 📈

// Kāpēc šis konstatējums ir uzmanības/zuma brīdinājums, nevis 🔴.
const TREND_DAYS = 5;              // cik dienas tiek rādīta tendence
const TREND_MIN_POINTS = 2;        // vismaz 2 salīdzinājami punkti

const ATTENTION_CATEGORY = 'pievienot';
const ATTENTION_FIELD = 'uzmaniba';
// Cik dienas "Pievērst medicīnisko uzmanību" ieraksts paliek AKTĪVS.
// Pēc tam tas pāriet uz vēsturi — lai saraksts nepārtaptu par besgalīgu
// notikumu žurnālu (skatīt sākotnējo kļūdu: trīs ieraksti par vienu dienu).
const ATTENTION_ACTIVE_DAYS = 7;

const num = (v) => {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(',', '.');
  if (s === '' || s === '-') return NaN;
  return parseFloat(s);
};

// Ēšanas diennakts vidējais porciju punkts → īss apzīmējums virknei
// (2 = X, 1 = ½, 0 = A). Procentuālās daļas nevar precīzi atainot ar 3
// simboliem, tāpēc tās tiek noapaļotas līdz tuvākajam veselajam punktam.
const fmtScore = (s) => {
  if (s === null || s === undefined || isNaN(s)) return '·';
  const r = Math.round(s);
  return r >= 2 ? 'X' : (r === 1 ? '½' : 'A');
};

class MedicineView {
  constructor() {
    this.db = null;
    this.sync = null;
    this.currentUser = null;
    this.allClients = [];
    this.allEmployees = [];
    this.allMarks = [];
    this.allLog = [];
    this.employeeMap = {};
    this.selectedClientId = null;
    this.searchTerm = '';
    // Noklusējumā "Visi klienti" ir aizvākti — 50 klientu nav jāskatās
    // cauri, lai atrastu 3–4 ar reālu medicīnisku uzmanību (spec §2).
    this.showAll = false;
    this.focus = null;
    this.analysis = [];
    this.init();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // START
  // ───────────────────────────────────────────────────────────────────────────
  async init() {
    const userData = sessionStorage.getItem('careUser');
    if (!userData) { window.location.href = 'index.html'; return; }
    this.currentUser = JSON.parse(userData);

    this.db = new CareDB();
    await this.db.init();
    window.careDB = this.db;
    this.sync = new CareSync(this.db, CONFIG);
    window.careSync = this.sync;

    const role = (this.currentUser.loma || '').toLowerCase();
    if (role !== 'administrators' && role !== 'kontroliere') {
      window.location.href = 'aprupe.html';
      return;
    }

    this.setupUI();
    this.setupLanguageSwitcher();

    // Drošības tīkls: splash ekrāns nedrīkst palikt virsū pat ja kaut kas
    // aizķģē renderēšanos. Reālais slēpšana notiek render() laikā.
    this._splashFallback = setTimeout(() => this._hideSplash(), 4000);

    // ── Vietējie dati PIRMS ──────────────────────────────────────────────
    // UI parādās no IndexedDB (desmitiem ms), nevis pēc Google atbildes.
    // Sinhronizācija notiek fonā. Ja serveris nepasniedz, lietotājs joprojām
    // strādā ar pēdējiem datiem — nevis skata tukšu ekrānu minūti garā.
    try {
      await this.sync.bootstrapUI({
        onLocalReady: async () => {
          await this.loadData();
          this.render();
          Perf.markUI('UI gatavs (no lokālajiem datiem)');
        },
        onServerData: async () => {
          await this.loadData();
          this.render();
          Perf.markUI('UI atjaunināts pēc servera datiem');
        },
        onProgress: (msg) => this._setStatus(msg)
      });
    } catch (e) {
      console.warn('[medicine] ielādes kļūda:', e);
    } finally {
      this._setStatus(null);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DATI
  // ───────────────────────────────────────────────────────────────────────────
  async loadData() {
    const t0 = performance.now();
    [this.allClients, this.allEmployees, this.allMarks, this.allLog] = await Promise.all([
      this.db.getAll('klienti'),
      this.db.getAll('darbinieki'),
      this.db.getAll('atzimes'),
      this.db.getAll('atzimes_log')
    ]);

    // Ja atzimes tukšas, bet žurnāls nav — rādām žurnālu (skatīt loadData
    // veco versiju). Pēc tam DUBULTU rādīšanas iespēja ir 0, jo
    // _buildIndex() vienā indeksā savieno abus avotus.
    if (this.allMarks.length === 0 && this.allLog.length > 0) {
      this.allMarks = this.allLog.map(l => ({
        id: l.id,
        clientId: l.clientId || l.klients_id,
        employeeId: l.employeeId || l.darbinieks_id,
        date: l.date || l.datums,
        time: l.time || l.laiks,
        shift: l.shift || l.periods,
        category: l.category || l.kategorija,
        field: l.field || l.lauka_nosaukums,
        value: l.value !== undefined ? l.value : l.vertiba,
        lastModified: l.lastModified || l.pedeja_laiks || l.created,
        prevValue: l.prevValue !== undefined ? l.prevValue : l.pedeja_vertiba,
        eventTime: l.eventTime || l.notikuma_laiks
      }));
    }

    this.employeeMap = {};
    this.allEmployees.forEach(e => {
      const id = e.id || e.ID;
      const name = (e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '');
      this.employeeMap[String(id)] = name;
    });

    this._buildIndex();
    Perf.sub('datu apstrāde', 'medicīna: dati no IndexedDB', performance.now() - t0);
    Perf.sub('datu apstrāde', 'medicīna: indekss (' + this.allMarks.length + ' ieraksti)', performance.now() - t0);
  }

  // Indekss: klients → lauks → ieraksti (kārtoti pēc datuma un laika).
  //
  // Iepriekšējā implementācija katru analīzes punktu skrēja cauri VISIEM
  // ierakstiem (getClientMarks + getPreviousValue + getTrendValues katrs
  // no saviem). Ar dažiem tūkstošiem ierakstiem tas nozīmēja desmitiem
  // tūkstošu atkārtojumu uz vienu renderēšanu. Tagad: O(1) uz lauku.
  _buildIndex() {
    this._byClientField = new Map();
    this._byClient = new Map();

    this.allMarks.forEach(raw => {
      if (!raw) return;
      const clientId = String(raw.clientId || raw.klients_id || raw.klientsId || raw.klienti_id || '');
      if (!clientId) return;
      const field = String(raw.field || raw.lauka_nosaukums || '').trim();
      if (!field) return;
      const item = {
        raw,
        id: raw.id,
        clientId,
        field,
        category: String(raw.category || raw.kategorija || '').trim(),
        value: raw.value !== undefined && raw.value !== null ? raw.value : raw.vertiba,
        date: this._markDate(raw),
        time: String(raw.time || raw.laiks || '').slice(0, 8),
        ts: raw.lastModified || raw.pedeja_laiks || raw.created || ''
      };

      let list = this._byClient.get(clientId);
      if (!list) { list = []; this._byClient.set(clientId, list); }
      list.push(item);

      let byField = this._byClientField.get(clientId);
      if (!byField) { byField = new Map(); this._byClientField.set(clientId, byField); }
      let series = byField.get(field);
      if (!series) { series = []; byField.set(field, series); }
      series.push(item);
    });

    const bySort = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
    this._byClient.forEach(list => list.sort(bySort));
    this._byClientField.forEach(byField => byField.forEach(series => series.sort(bySort)));
  }

  _markDate(m) {
    if (!m) return '';
    const raw = m.date || m.datums || '';
    const s = String(raw);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    const lv = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (lv) return lv[3] + '-' + lv[2] + '-' + lv[1];
    // Atzīmju ID satur lauku: m_1790450592535 → datums no timestamp
    const idTs = String(m.id || '').match(/^[a-z]+_(\d{10,13})/);
    if (idTs) {
      const d = new Date(parseInt(idTs[1], 10));
      if (!isNaN(d.getTime())) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }
    }
    return this._fmtDate(raw);
  }

  _fmtDate(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  _today() {
    return (typeof TimezoneUtils !== 'undefined' && TimezoneUtils.getTodayRiga)
      ? TimezoneUtils.getTodayRiga()
      : this._fmtDate(Date.now());
  }

  _offsetDays(dateStr, delta) {
    if (typeof TimezoneUtils !== 'undefined' && TimezoneUtils.offsetDaysRiga && delta !== 0) {
      // offsetDaysRiga(-n) attiecas uz šodienu, nevis izvēlēto datumu
      const d = new Date(dateStr + 'T12:00:00');
      d.setDate(d.getDate() + delta);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ANALĪZE
  // ───────────────────────────────────────────────────────────────────────────
  //
  // Deduplicēšana notiek ŠEIT, nevis renderēšanas laikā: vispirms ieraksti
  // grupējami pa (klients, lauks, datums) un ņemam TIKAI PĒDĒJO no dienas.
  // Tāpēc Anna Kanna 38.4 un 39 vairs neparādās kā divas kartītes — tā ir
  // viena atzīme, kuras vērtība ir 39 un iepriekšējā 36.9.
  _dailyLatest(clientId, date) {
    const fields = this._byClientField.get(clientId);
    const out = new Map();
    if (!fields) return out;
    fields.forEach((list, field) => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].date === date) { out.set(field, list[i]); break; }
      }
    });
    return out;
  }

  // Vēsture pa dienām. ⚠️ Masīvs ir VECĀKŠAIS → JAUNĀKAIS (h[0] = 5 dienas
  // atpakaļ, h[h.length-1] = ŠODIEN). Tas ir tendences zīmju dabūšanai
  // pareizā secībā. Vienas dienas ierakstu ņem ar _todayItem(), lai šo
  // secību nevar sajaukt.
  _history(clientId, field, date, days) {
    const fields = this._byClientField.get(clientId);
    const list = (fields && fields.get(field)) || [];
    // pa dienām: pēdējā vērtība
    const byDate = new Map();
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (!byDate.has(it.date)) byDate.set(it.date, it);
    }
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = this._offsetDays(date, -i);
      out.push({ date: d, item: byDate.get(d) || null });
    }
    return out;
  }

  // Ieraksts ŠODIEN (vai pēdējais zināmais, ja šodien nav). Neatkarīgs no
  // _history() secības.
  _todayItem(clientId, field, day, days) {
    const hist = this._history(clientId, field, day, days || TREND_DAYS);
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].item) return hist[i].item;
    }
    return null;
  }


  // ═══════════════════════════════════════════════════════════════════════
  // ĒŠANAS ANALĪZE
  //
  // Rāda TENDENCI, nevis tikai pēdējo ierakstu: "½ → ½ → ½ → X".
  // Brīdinājumu rada tikai atkārtošanās, nevis viens atsevišķs ½.
  //
  // null (nav ieraksta) → NEKAD nav brīdinājums. Tas tiek skaitīts tikai
  // kā "nav datu", lai nezinātu, ko domāt, bet netiek rādīts kā problēma.
  // ═══════════════════════════════════════════════════════════════════════
  _foodBlock(clientId, day) {
    const days = TREND_DAYS;
    const history = {};   // field → [{date, value}] (vecākais → jaunākais)
    MEAL_FIELDS.forEach(f => { history[f] = this._history(clientId, f, day, days); });

    // Ēdienrežu kopējais stāvoklis šai dienai
    const meals = {};
    let anyRecorded = 0, scored = 0, refusals = 0, halves = 0, scoreSum = 0;
    MEAL_FIELDS.forEach(f => {
      const now = this._todayItem(clientId, f, day, days);
      const raw = now ? String(now.value).trim() : '';
      const valid = mealKnown(raw);
      if (valid) anyRecorded++;
      meals[f] = { label: MEAL_LABEL[f], field: f, value: valid ? raw : '', recorded: valid, item: now, date: now ? now.date : '' };
      const sc = mealScore(raw);
      if (sc !== null) {
        scored++;                     // tikai mērāmie punkti ietilpst aprēkinos
        scoreSum += sc;
        if (raw === 'A') refusals++;
        if (raw === '½') halves++;
      }
    });

    const dayScore = scored ? scoreSum / scored : null;

    // Dienas līmenī: katru dienu vidējais porciju punkts + atteikumi
    const daySeries = [];
    for (let i = 0; i < days; i++) {
      let sum = 0, n = 0, ref = 0, half = 0;
      MEAL_FIELDS.forEach(f => {
        // history ir vecākais→jaunākais, bet daySeries[0] jābūt ŠODIENAI
        const h = history[f][days - 1 - i];
        if (!h || !h.item) return;
        const v = String(h.item.value).trim();
        const sc = mealScore(v);
        if (sc === null) return;     // "P" un nezināmas vērtības netiek mērītas
        sum += sc; n++;
        if (v === 'A') ref++;
        if (v === '½') half++;
      });
      daySeries.push({ date: this._offsetDays(day, -i), score: n ? sum / n : null, refusals: ref, halves: half, recorded: n });
    }

    // Tendences virziens pa dienām (vecākais → jaunākais)
    const pts = daySeries.filter(d => d.score !== null);
    let dir = 'flat', delta = 0;
    if (pts.length >= TREND_MIN_POINTS) {
      delta = pts[pts.length - 1].score - pts[0].score;
      dir = delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat');
    }

    // Secība "½ → ½ → ½ → X" tiek rādīta IZVIKLĒJIENĀ noteik virzienā, ja
    // visu dienu apjoms ir vienāds (tas jau ir 🔴, nevis 📈). Tāpēc tā ir
    // atsevišķi laukā, nevis trendī.
    const series = pts.map(p => fmtScore(p.score));
    const seriesDates = pts.map(p => p.date);

    // ── Secinājumi ─────────────────────────────────────────────────────────
    const findings = [];

    // 🔴 N dienas pēc kārtas visi ierakstītie ēdienreizes ≤½ un vismaz viens
    //    atteikums. Tā ir "3 dienas pēc kārtas ½ un atteikumi" (spec §9).
    const recent = daySeries.slice(0, MEAL_LOW_DAYS);
    const lowRun = recent.length === MEAL_LOW_DAYS &&
      recent.every(d => d.recorded > 0 && d.score <= 1) &&
      recent.reduce((s, d) => s + d.refusals, 0) > 0;
    if (lowRun) {
      const totalRef = recent.reduce((s, d) => s + d.refusals, 0);
      const totalHalf = recent.reduce((s, d) => s + d.halves, 0);
      findings.push({
        sev: 'crit', cat: 'edinasana', field: 'edinasana', label: 'Ēšana',
        reason: MEAL_LOW_DAYS + ' dienas pēc kārtas tikai ½ porcijas, ' + totalRef + ' × atteikums',
        detail: totalHalf + ' × ½ porcija', icon: '🍽'
      });
    }

    // 🟡 N dienas pēc kārtas ar atteikumiem
    const refRun = daySeries.slice(0, MEAL_REFUSAL_DAYS);
    if (!lowRun && refRun.length === MEAL_REFUSAL_DAYS && refRun.every(d => d.refusals > 0)) {
      findings.push({
        sev: 'attn', cat: 'edinasana', field: 'edinasana', label: 'Ēšana',
        reason: MEAL_REFUSAL_DAYS + ' dienas pēc kārtas atteikums no ēšanas',
        detail: 'atteikumi katrā no šīm dienām', icon: '🍽'
      });
    }

    // 🟡 Vairāki atteikumi vienā dienā (neatkarīgi no vairāku dienu secības)
    if (refusals >= MEAL_REFUSALS_ONE_DAY && !lowRun) {
      findings.push({
        sev: 'attn', cat: 'edinasana', field: 'edinasana', label: 'Ēšana',
        reason: refusals + ' × atteikums no ēšanas šodien',
        detail: 'atteikumi vienā dienā', icon: '🍽'
      });
    }

    // 📈 Tendence: ievērojama maiņa ēšanas apjomā
    const trend = (dir !== 'flat' && Math.abs(delta) >= MEAL_TREND_DROP) ? {
      dir, delta, label: 'Ēšana', icon: '🍽', series, dates: seriesDates
    } : null;

    return {
      icon: '🍽', title: 'Ēšana', meals, dayScore, refusals, halves,
      recorded: anyRecorded, scored,
      daySeries, series, seriesDates, trend, findings,
      emptyNote: anyRecorded === 0 ? 'Šodien ēšanas datu nav' : ''
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 🌡 TEMPERATŪRA
  // ═══════════════════════════════════════════════════════════════════════
  _tempBlock(clientId, day) {
    const hist = this._history(clientId, 'temperatura', day, TREND_DAYS);
    const today = hist[hist.length - 1];          // pēdējais = šodien
    const item = today && today.item ? today.item : null;
    const n = item ? num(item.value) : NaN;
    const prevItem = this._prevItem(clientId, 'temperatura', day);
    const prev = prevItem ? num(prevItem.value) : NaN;
    const findings = [];

    let state = 'none';
    if (item && !isNaN(n)) {
      state = n >= TEMP_CRITICAL ? 'crit' : 'norm';
      if (n >= TEMP_CRITICAL) {
        findings.push({
          sev: 'crit', cat: 'temp', field: 'temperatura', label: 'Temperatūra', icon: '🌡',
          reason: n.toFixed(1) + ' °C — virs ' + TEMP_CRITICAL + ' °C (drudzis)',
          value: item.value, unit: '°C', item
        });
      } else if (!isNaN(prev) && n - prev >= TEMP_RISE_NOTABLE) {
        // Augsts, bet vēl zem 37 — tomēr strauji kāpj: tas ir tendence, nevis kritiskums
        findings.push({
          sev: 'attn', cat: 'temp', field: 'temperatura', label: 'Temperatūra', icon: '🌡',
          reason: '+' + (n - prev).toFixed(1) + ' °C pret iepriekšējo mērījumu',
          value: item.value, unit: '°C', item
        });
      }
    }

    const t = this._trendFor(clientId, { field: 'temperatura' }, day);
    const trend = (t.points.length >= TREND_MIN_POINTS && t.points[t.points.length - 1].value - t.points[0].value !== 0) ? {
      dir: t.points[t.points.length - 1].value - t.points[0].value > 0 ? 'up' : 'down',
      delta: t.points[t.points.length - 1].value - t.points[0].value,
      label: 'Temperatūra', icon: '🌡', series: t.series, dates: t.points.map(p => p.date), unit: '°C'
    } : null;

    return {
      icon: '🌡', title: 'Temperatūra', value: item ? String(item.value) : '', unit: '°C',
      date: today ? today.date : '', time: item ? item.time : '',
      state, item, prevValue: isNaN(prev) ? null : prev,
      delta: (!isNaN(n) && !isNaN(prev)) ? +(n - prev).toFixed(1) : null,
      author: item ? (this.employeeMap[String(item.raw.employeeId || item.raw.darbinieks_id)] || '') : '',
      trend, findings,
      emptyNote: item ? '' : 'Nav temperatūras datu'
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 💧 ŠĶIDRUMI
  // ═══════════════════════════════════════════════════════════════════════
  _fluidBlock(clientId, day) {
    const parts = [];
    const findings = [];
    const cfg = [
      { field: 'urina_daudzums', label: 'Urīns 24h', low: URINE_LOW, lowText: 'zem ' + URINE_LOW + ' ml diennakts minima', high: URINE_HIGH, highText: 'virs ' + URINE_HIGH + ' ml — paaugsts diennakts apjoms' },
      { field: 'uznemts_ml', label: 'H₂O 24h', low: H2O_LOW, lowText: 'zem ' + H2O_LOW + ' ml diennakts minima', high: H2O_HIGH, highText: 'virs ' + H2O_HIGH + ' ml diennakts apjoms' }
    ];
    const trends = [];

    cfg.forEach(c => {
      const hist = this._history(clientId, c.field, day, TREND_DAYS);
      const today = hist[hist.length - 1];
      const item = today && today.item ? today.item : null;
      const n = item ? num(item.value) : NaN;
      const part = {
        field: c.field, label: c.label, unit: 'ml',
        value: item ? String(item.value) : '', state: 'none', item,
        date: today ? today.date : '', time: item ? item.time : '',
        author: item ? (this.employeeMap[String(item.raw.employeeId || item.raw.darbinieks_id)] || '') : '',
        findings: []
      };

      if (item && !isNaN(n)) {
        part.state = 'norm';
        if (n < c.low) {
          part.state = 'crit';
          part.findings.push({ sev: 'crit', cat: 'sikdrumi', field: c.field, label: c.label, icon: '💧', reason: c.lowText, value: item.value, unit: 'ml', item });
        } else if (n > c.high) {
          part.state = 'attn';
          part.findings.push({ sev: 'attn', cat: 'sikdrumi', field: c.field, label: c.label, icon: '💧', reason: c.highText, value: item.value, unit: 'ml', item });
        }

        // 📈 nozīmīga diennakts maiņa (≥ FLUID_CHANGE_PCT %)
        const pts = hist.map(h => (h.item && !isNaN(num(h.item.value)) ? { date: h.date, value: num(h.item.value) } : null)).filter(Boolean);
        if (pts.length >= 2) {
          const first = pts[0].value, last = pts[pts.length - 1].value;
          if (first > 0 && Math.abs(last - first) / first * 100 >= FLUID_CHANGE_PCT) {
            const dir = last > first ? 'up' : 'down';
            part.findings.push({
              sev: 'attn', cat: 'sikdrumi', field: c.field, label: c.label, icon: '💧',
              reason: (dir === 'up' ? '+' : '−') + Math.round(Math.abs(last - first) / first * 100) + ' % pret ' + this._offsetDays(day, -(pts.length - 1)),
              value: item.value, unit: 'ml', item
            });
            trends.push({ dir, delta: last - first, label: c.label, icon: '💧', unit: 'ml', series: pts.map(p => String(p.value)), dates: pts.map(p => p.date) });
          }
        }
      } else {
        part.emptyNote = 'Nav datu';
      }
      part.findings.forEach(f => findings.push(f));
      parts.push(part);
    });

    return { icon: '💧', title: 'Šķidrumi', parts, trends, findings };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 🚽 VĒDERA IZEJA
  // ═══════════════════════════════════════════════════════════════════════
  _bowelBlock(clientId, day) {
    const field = 'vedera_izeja';
    const LOOKBACK = 7;
    const hist = this._history(clientId, field, day, LOOKBACK);
    const today = hist[hist.length - 1];
    const item = today && today.item ? today.item : null;
    const v = item ? String(item.value).trim() : '';
    const findings = [];
    let state = 'none';

    // Cik dienas nav bijusi izkārnīšanās. hist ir vecākais→jaunākais,
    // tāpēc "šodien" ir pēdējais ieraksts.
    //
    // ⚠️ Šis aprēķins NEDRĪKST būt atkarīgs no tā, vai šodien ir ieraksts.
    // "Nav 2 dienas" ir tieši gadījums, kad šodien ieraksta NAV.
    let daysSince = null;
    for (let i = hist.length - 1; i >= 0; i--) {
      const hv = hist[i].item ? String(hist[i].item.value).trim() : '';
      if (hv && hv !== '-' && hv !== 'K') { daysSince = hist.length - 1 - i; break; }
    }

    if (item && v) {
      state = 'norm';
      if (BOWEL_CRITICAL[v]) {
        state = 'crit';
        findings.push({ sev: 'crit', cat: 'fiziologija', field, label: 'Vēdera izeja', icon: '🚽', reason: BOWEL_LABEL[v] + ' — ' + BOWEL_CRITICAL[v], value: v, item });
      } else if (BOWEL_ATTENTION[v]) {
        state = 'attn';
        findings.push({ sev: 'attn', cat: 'fiziologija', field, label: 'Vēdera izeja', icon: '🚽', reason: BOWEL_LABEL[v] + ' — ' + BOWEL_ATTENTION[v], value: v, item });
      } else if (BOWEL_NORMAL.includes(v)) {
        state = 'norm';
      }
    } else if (daysSince !== null && daysSince >= BOWEL_ABSENT_DAYS) {
      state = 'attn';
    }

    // Nav izkārnīšanās vismaz N dienas — tas ir medicīniski nozīmīgi
    // (atšķirbā no neatzīmēta aprūdes uzdevuma).
    if (daysSince !== null && daysSince >= BOWEL_ABSENT_DAYS && !findings.length) {
      state = state === 'none' ? 'attn' : state;
      findings.push({
        sev: 'attn', cat: 'fiziologija', field, label: 'Vēdera izeja', icon: '🚽',
        reason: 'nav ' + daysSince + (daysSince === 1 ? ' dienu' : ' dienas'), detail: 'bez izkārnīšanās'
      });
    }

    const prevItem = this._prevItem(clientId, field, day);
    const prev = prevItem ? String(prevItem.value).trim() : '';
    const changed = v && prev && v !== prev;

    return {
      icon: '🚽', title: 'Vēdera izeja',
      value: v, label: v ? (BOWEL_LABEL[v] || v) : '',
      state, item, date: today ? today.date : '', time: item ? item.time : '',
      daysSince, changed, prevValue: prev,
      author: item ? (this.employeeMap[String(item.raw.employeeId || item.raw.darbinieks_id)] || '') : '',
      findings,
      emptyNote: item ? '' : 'Nav datu'
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GALVĀ ANALĪZE — 4 bloki → secinājumu saraksts
  // ═══════════════════════════════════════════════════════════════════════
  analyze(date) {
    const day = date || this._today();
    const result = [];

    this.allClients.forEach(client => {
      const clientId = String(client.id || client.ID);
      if (!clientId) return;
      const latest = this._dailyLatest(clientId, day);
      const all = this._byClient.get(clientId) || [];
      if (!latest.size && !all.length) return;

      const name = ((client.vards || client.Vārds || '') + ' ' + (client.uzvards || client.Uzvārds || '')).trim();
      const entry = {
        clientId,
        client,
        name: name || ('ID ' + clientId),
        age: this.calculateAge(client.dzimis || client['Dzimšanas datums'] || client.birth_date),
        diet: client.dieta || client.Diēta || '',
        contact: client.saskarsmes || client['Saskarsmes īpatnības'] || '',
        hospital: this._isHospital(client, all, day),
        historyCount: 0
      };

      // ── TIKAI četras medicīniskās kategorijas ──────────────────────────
      entry.med = {
        temp: this._tempBlock(clientId, day),
        food: this._foodBlock(clientId, day),
        fluid: this._fluidBlock(clientId, day),
        bowel: this._bowelBlock(clientId, day)
      };

      // ── Secinājumi (kārtoti: 🔴 tad 🟡 tad 📈) ─────────────────────────
      const crit = [], attn = [], trends = [];
      ['temp', 'food', 'fluid', 'bowel'].forEach(k => {
        const b = entry.med[k];
        (b.findings || []).forEach(f => (f.sev === 'crit' ? crit : attn).push(f));
        (b.trends || []).forEach(t => trends.push(t));
      });
      entry.critical = this._uniqueBy(crit, 'field');
      entry.attention = this._dedupeAttention(attn);
      entry.trends = this._uniqueBy(trends, 'label');

      // ── Aktīvās "Pievērst medicīnisko uzmanību" atzīmes ─────────────────
      const cutoff = this._offsetDays(day, -ATTENTION_ACTIVE_DAYS);
      const attentionItems = all.filter(it =>
        (it.category.toLowerCase() === ATTENTION_CATEGORY || it.field.toLowerCase() === ATTENTION_FIELD) &&
        it.date >= cutoff && it.date <= day
      );
      attentionItems.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
      attentionItems.forEach(it => {
        const text = String(it.raw.comment || it.raw.virsenis || it.raw.reason || it.value || '').trim();
        entry.attention.push({
          kind: 'note', cat: 'pievienot', field: 'uzmaniba',
          label: text || 'Pievērst medicīnisko uzmanību', reason: '',
          author: this.employeeMap[String(it.raw.employeeId || it.raw.darbinieks_id)] || '',
          date: it.date, markId: it.id
        });
      });
      entry.attention = this._dedupeAttention(entry.attention);
      entry.historyCount = all.filter(it =>
        (it.category.toLowerCase() === ATTENTION_CATEGORY || it.field.toLowerCase() === ATTENTION_FIELD) &&
        it.date < cutoff
      ).length;

      // KPI uz klientu līmeni (spec §7)
      entry.needsAttention = entry.critical.length > 0 || entry.attention.length > 0;
      entry.hasTrend = entry.trends.length > 0;
      entry.problems = entry.critical.length + entry.attention.length + entry.trends.length;

      result.push(entry);
    });

    const weight = (e) => (e.critical.length * 1000) + (e.attention.length * 100) + (e.trends.length * 10);
    result.sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name));
    return result;
  }

  _uniqueBy(arr, key) {
    const seen = new Set();
    return arr.filter(item => {
      if (seen.has(item[key])) return false;
      seen.add(item[key]);
      return true;
    });
  }

  // Divas atzīmes par vienu un to pašu lauku vienā dienā (piem. Anna
  // temperatūra 38.4 un 39) jau ir apkopoti PIRMS šīs vietas — šeit
  // noņemam tikai atkārtojumus no dažādiem avotiem.
  _dedupeAttention(list) {
    const seen = new Set();
    return list.filter(item => {
      const key = item.kind + '|' + item.label;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Pēdējais ieraksts šim laukam, kas ir STRICTLY pirms norādītās dienas.
  // Tas dod "iepriekšējā vērtība" salīdzinājumam pat tad, ja šodien
  // ieraksta vispār nav (piem. rāda slimnīcā esošam klientam).
  _prevItem(clientId, field, date) {
    const fields = this._byClientField.get(clientId);
    const list = (fields && fields.get(field)) || [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].date < date) return list[i];
    }
    return null;
  }

  _trendFor(clientId, rule, date) {
    const hist = this._history(clientId, rule.field, date, TREND_DAYS);
    const points = [];
    const series = [];
    hist.forEach(h => {
      if (!h.item) { series.push('·'); return; }
      const v = h.item.value;
      series.push(v === undefined || v === null || v === '' ? '·' : String(v));
      const n = num(v);
      if (!isNaN(n)) points.push({ date: h.date, value: n });
    });
    // Noņemt tukšās dienas no galu — "36.9 → 38.4 → 39.0" ir skaidrāks par
    // "· → · → 36.9 → 38.4 → 39.0". Iekšējie pārraukumi tiek saglabāti.
    while (series.length && series[0] === '·') series.shift();
    while (series.length && series[series.length - 1] === '·') series.pop();
    return { points, series };
  }

  _isHospital(client, allItems, day) {
    if (client) {
      const s = client.slimnica !== undefined ? client.slimnica : client['Slimnīcā'];
      if (s === true || String(s).toLowerCase() === 'true' || s === 1 || s === '1') return true;
    }
    const statusItem = this._dailyLatest(String(client.id || client.ID), day).get('statuss');
    const v = String((statusItem && statusItem.value) || '').toLowerCase();
    return v.indexOf('slimnīc') !== -1 || v.indexOf('hospitaliz') !== -1;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ZĪMĒŠANA
  // ───────────────────────────────────────────────────────────────────────────
  render() {
    const dateEl = document.getElementById('dateFilter');
    const date = (dateEl && dateEl.value) || this._today();
    const t0 = performance.now();
    this.analysis = this.analyze(date);
    Perf.sub('datu apstrāde', 'medicīna: analīze', performance.now() - t0);
    this.renderHeadline();
    this.renderClientList();
    this.renderDetail();
    // UI ir zīmēts — splash ekrānam vairs nav vietas.
    this._hideSplash();
  }

  _hideSplash() {
    if (this._splashHidden) return;
    this._splashHidden = true;
    if (this._splashFallback) { clearTimeout(this._splashFallback); this._splashFallback = null; }
    const splash = document.getElementById('splashScreen');
    if (splash) {
      splash.classList.add('hidden');
      // .hidden ir tikai izmantošanas animācija; pēc tam noņemam no DOM,
      // lai tas nevar neko klikšķināmu aizsegt.
      setTimeout(() => { splash.style.display = 'none'; }, 650);
    }
  }

  // KPI — tikai trīs, uz klientu līmeni (spec §7). Neviens cits skaitlis
  // neaizpilda ekrānu, ja tas nepalīdz pieņemt lēmumu.
  renderHeadline() {
    const el = document.getElementById('medHeadline');
    if (!el) return;
    const attention = this.analysis.filter(a => a.needsAttention);
    const trends = this.analysis.filter(a => a.hasTrend);
    const total = this.analysis.length;

    const tile = (cls, icon, num, label) =>
      '<button class="med-kpi ' + cls + '" data-kpi="' + cls + '">' +
        '<span class="med-kpi-num">' + icon + ' ' + num + '</span>' +
        '<span class="med-kpi-label">' + label + '</span>' +
      '</button>';

    el.innerHTML =
      '<div class="med-kpis">' +
        tile('attn', '🔴', attention.length, 'Steens') +
        tile('trend', '📈', trends.length, 'Tendence') +
        tile('all', '👥', total, 'Klienti') +
      '</div>' +
      '<div class="med-legend">' +
        '<span class="med-legend-item crit"><b>🔴 Steens</b> — ārpus robežām, rīcība tagad</span>' +
        '<span class="med-legend-item attn"><b>🟡 Uzmanīt</b> — tuvs robežai, sekot līdzi</span>' +
        '<span class="med-legend-item trend"><b>📈 Tendence</b> — mainās 3+ dienas</span>' +
        '<span class="med-legend-item ok"><b>✅ Normāli</b> — bez brīdinājuma</span>' +
      '</div>' +
      (attention.length === 0 && trends.length === 0
        ? '<div class="med-ok">✅ Nevienam klientam šobrīd nav ne kritisks rādījums, ne tendence.</div>'
        : '<div class="med-hint">Pirmais klients sarakstā ir tas, kas jāapskata pirmais.</div>');

    el.querySelectorAll('.med-kpi').forEach(b => {
      b.addEventListener('click', () => {
        const k = b.dataset.kpi;
        if (k === 'all') { this.showAll = !this.showAll; this.renderClientList(); }
        else { this.showAll = false; this.focus = (this.focus === k ? null : k); this.renderClientList(); }
      });
    });
  }

  // Klientu saraksts pēc prioritātes. 50 klientu nav jāskatās cauri —
  // pēc noklusējuma redzamas TIKAI tās grupas, kurām ir kas redzams
  // (spec §2). "Visi klienti" ir atvērams tikai ar apzinātu pieskārsienu.
  renderClientList() {
    const list = document.getElementById('medClientList');
    if (!list) return;
    const term = this.searchTerm;
    const match = (a) => !term ||
      a.name.toLowerCase().indexOf(term) !== -1 ||
      String(a.clientId).toLowerCase().indexOf(term) !== -1;

    const attention = this.analysis.filter(a => a.needsAttention && match(a));
    const trends = this.analysis.filter(a => !a.needsAttention && a.hasTrend && match(a));
    const rest = this.analysis.filter(a => !a.needsAttention && !a.hasTrend && match(a));

    const section = (id, icon, title, rows, collapsed) => {
      if (!rows.length) return '';
      const body = collapsed
        ? '<button class="med-more" data-more="' + id + '">Parādīt ' + rows.length + ' klientus</button>'
        : '<div class="med-group-body">' + rows.map(a => this._clientRow(a)).join('') + '</div>';
      return '<section class="med-group" data-group="' + id + '">' +
        '<h2 class="med-group-head" data-toggle="' + id + '">' +
          '<span class="med-group-title">' + icon + ' ' + title + '</span>' +
          '<span class="med-group-count">' + rows.length + '</span>' +
        '</h2>' + body + '</section>';
    };

    let html = '';
    if (this.focus === 'attn') {
      html = attention.length || trends.length || rest.length
    ? section('attn', '🔴', 'Rīcība tagad', attention, false) +
    section('trend', '📈', 'Tendence', trends, false) +
    section('rest', '👥', 'Visi klienti', rest, false)
        : this._emptyRow(term);
    } else if (this.focus === 'trend') {
      html = attention.length || trends.length || rest.length
        ? section('trend', '📈', 'Tendence', trends, false) +
          section('attn', '🔴', 'Rīcība tagad', attention, false) +
          section('rest', '👥', 'Visi klienti', rest, false)
        : this._emptyRow(term);
    } else {
      // Noklusējums: uzmanība + tendence. Visi pārējie ir aizvākti.
      html = section('attn', '🔴', 'Rīcība tagad', attention, false) +
        section('trend', '📈', 'Tendence', trends, false) +
        section('rest', '👥', 'Visi klienti', rest, !this.showAll);
    }
    if (!html) html = this._emptyRow(term);
    list.innerHTML = html;

    list.querySelectorAll('.med-client').forEach(el => {
      el.addEventListener('click', () => this.selectClient(el.dataset.id));
    });
    list.querySelectorAll('[data-more]').forEach(el => {
      el.addEventListener('click', () => { this.showAll = true; this.renderClientList(); });
    });
    list.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const g = el.parentElement;
        if (g) g.classList.toggle('collapsed');
      });
    });
  }

  _emptyRow(term) {
    return '<div class="med-empty">' +
      (term ? 'Klienti ar "' + this.escapeHtml(term) + '" nav atrasti.' : 'Nav klientu ar medicīniski nozīmīgām novirzēm.') +
      '</div>';
  }

  // 🔴 38,4 °C ↑  ·  🍽 ½ → ½ → X  —  secināms fakts uzreiz uz kartes,
  // bez ritināšanas (spec §4, §10).
  _clientRow(a) {
    const badges =
      (a.critical.length ? '<span class="med-badge crit" title="Kritiskie rādījumi">🔴 ' + a.critical.length + '</span>' : '') +
      (a.attention.length ? '<span class="med-badge warn" title="Uzmanība">🟡 ' + a.attention.length + '</span>' : '') +
      (a.trends.length ? '<span class="med-badge trend" title="Tendences">📈 ' + a.trends.length + '</span>' : '');

    return '<button class="med-client' + (a.problems ? ' has-problem' : '') + '" data-id="' +
      this.escapeHtml(a.clientId) + '">' +
      '<span class="med-client-row">' +
        '<span class="med-client-name">' + this.escapeHtml(a.name) +
          (a.hospital ? ' <span class="med-hosp">🏥</span>' : '') + '</span>' +
        badges +
      '</span>' +
      '<span class="med-client-sum">' + this._clientSummary(a) + '</span>' +
      (a.problems
        ? '<span class="med-client-reasons">' + a.critical.slice(0, 2).map(c =>
            '<span class="med-reason crit">🔴 ' + this.escapeHtml(c.reason) + '</span>').join('') +
          (a.attention.length ? '<span class="med-reason warn">🟡 ' + this.escapeHtml(a.attention[0].label) + '</span>' : '') +
          '</span>'
        : '<span class="med-client-reasons"><span class="med-reason ok">Stabils stāvoklis</span></span>') +
      '</button>';
  }

  // Kompaktā 4 kategoriju uzskats uz kartes.
  _clientSummary(a) {
    const m = a.med;
    const bits = [];
    if (m.temp.value) {
      const arrow = m.temp.delta === null ? '' : (m.temp.delta > 0 ? ' ↑' : (m.temp.delta < 0 ? ' ↓' : ''));
      bits.push('<span class="med-sum' + (m.temp.state === 'crit' ? ' crit' : '') + '">🌡 ' +
        this.escapeHtml(m.temp.value) + '°' + arrow + '</span>');
    }
    if (m.food.recorded) {
      bits.push('<span class="med-sum' + (m.food.findings.length ? ' crit' : '') + '">🍽 ' +
        this.escapeHtml(m.food.daySeries.filter(d => d.score !== null).map(d => fmtScore(d.score)).join('→') || '—') + '</span>');
    }
    const fbits = m.fluid.parts.filter(p => p.value);
    if (fbits.length) {
      bits.push('<span class="med-sum' + (m.fluid.findings.some(f => f.sev === 'crit') ? ' crit' : '') + '">💧 ' +
        this.escapeHtml(fbits.map(p => p.value).join(' / ')) + '</span>');
    }
    if (m.bowel.value) {
      bits.push('<span class="med-sum' + (m.bowel.state === 'crit' ? ' crit' : '') + '">🚽 ' +
        this.escapeHtml(m.bowel.label) + '</span>');
    }
    return bits.length ? bits.join('') : '<span class="med-sum none">Nav medicīnisko datu</span>';
  }

  renderDetail() {
    const detail = document.getElementById('medDetail');
    const listView = document.getElementById('medListView');
    const detailView = document.getElementById('medDetailView');
    if (!detail) return;

    if (!this.selectedClientId) {
      if (listView) listView.style.display = '';
      if (detailView) detailView.style.display = 'none';
      detail.innerHTML = '';
      return;
    }

    const a = this.analysis.find(x => x.clientId === this.selectedClientId);
    if (!a) {
      this.selectedClientId = null;
      this.renderDetail();
      return;
    }

    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = '';

    detail.innerHTML = this._detailHtml(a);
    detail.querySelectorAll('[data-act]').forEach(el => {
      el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'back') this.closeDetail();
      });
    });
  }

  // Klienta medicīnas kopsavilkums — VIENMĒR 4 bloki, vienmēr tādā pašā
  // secībā, lai pirksts un acs zina, kur skatīties (spec §6).
  // "Tukši" lauki netiek rādīti kā brīdinājums — tie tiek atzīmēti kā
  // "nav datu" (spec §9).
  _detailHtml(a) {
    const dateEl = document.getElementById('dateFilter');
    const date = (dateEl && dateEl.value) || this._today();
    const dateLabel = this._dateLabel(date);

    const head =
      '<div class="med-detail-head">' +
        '<button class="med-back" data-act="back">← Klienti</button>' +
        '<div class="med-detail-id">' +
          '<h2>' + this.escapeHtml(a.name) + '</h2>' +
          '<div class="med-detail-meta">' +
            (a.age ? this.escapeHtml(a.age) + ' gadi · ' : '') +
            (a.diet ? this.escapeHtml(a.diet) : 'Nav noteikta diēta') +
            (a.hospital ? ' · <span class="med-hosp">🏥 Slimnīcā</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="med-detail-date">Dati par ' + dateLabel + '</div>';

    const blocks =
      this._tempBlockHtml(a.med.temp) +
      this._foodBlockHtml(a.med.food) +
      this._fluidBlockHtml(a.med.fluid) +
      this._bowelBlockHtml(a.med.bowel);

    // Aktīvās "Pievērst medicīnisko uzmanību" atzīmes
    const notes = a.attention.filter(x => x.kind === 'note');
    const noteHtml = notes.length
      ? '<section class="med-block warn"><h3>🟡 Uzmanības atzīmes (' + notes.length + ')</h3>' +
        notes.map(x => this._attHtml(x)).join('') +
        (a.historyCount
          ? '<div class="med-history">ℹ️ Vecākas ' + a.historyCount + ' atzīmes pārceltas uz vēsturi.</div>'
          : '') +
        '</section>'
      : (a.historyCount
          ? '<div class="med-history">Vecākas ' + a.historyCount + ' uzmanības atzīmes ir vēsturē.</div>'
          : '');

    const clean = !a.problems
      ? '<div class="med-ok big">✅ Visi četri rādītāji normāli, tendencēm nav ko rādīt.</div>'
      : '';

    // Medicīniskais skats ir FILTRS, nevis jauna darbvieta. Šeit nav ne
    // "Pievienot atzīmi", ne "Pilna aprūpes lapa" — abas dzīvo savās
    // lapās. Medicīnā lietotājs tikai skata un noklikšķina uz klienta.
    return head + clean + blocks + noteHtml;
  }

  // Bloku galvene ar stāvokļa krāsu: 🔴 / 🟡 / normāls
  //
  // Pie emoji ir arī VĀRDS. Emoji bez vārda nozīmē gandrīz neko jaunam
  // darbiniekam — tas nespēj atšķirt, kas ir steens un kas uzmanība.
  _blockHead(icon, title, state, extra) {
    const stateTag = state === 'crit'
        ? '<span class="med-state crit" title="Rādītājs ir ārpus pieņemamajiem robežām — nepieciešama rīcība tagad.">🔴 steens</span>'
        : state === 'attn'
          ? '<span class="med-state attn" title="Rādītājs tuvs robežai vai izmainījies — sekot līdzi.">🟡 uzmanīt</span>'
          : '';
    return '<h3>' + icon + ' ' + this.escapeHtml(title) + ' ' + stateTag + (extra || '') + '</h3>';
  }

  _findingsHtml(findings) {
    if (!findings || !findings.length) return '';
    return '<div class="med-findings">' + findings.map(f =>
      '<div class="med-finding ' + (f.sev === 'crit' ? 'crit' : 'attn') + '">' +
        '<span class="med-finding-label">' + (f.sev === 'crit' ? '🔴' : '🟡') + ' ' + this.escapeHtml(f.label) + '</span>' +
        '<span class="med-finding-reason">' + this.escapeHtml(f.reason) + '</span>' +
        (f.detail ? '<span class="med-finding-detail">' + this.escapeHtml(f.detail) + '</span>' : '') +
        (f.author ? '<span class="med-finding-author">ierakstījis ' + this.escapeHtml(f.author) + '</span>' : '') +
      '</div>').join('') + '</div>';
  }

  _trendLineHtml(t) {
    if (!t || !t.series || !t.series.length) return '';
    const arrow = t.dir === 'up' ? ' ↑' : (t.dir === 'down' ? ' ↓' : '');
    return '<div class="med-trend-line">📈 ' + t.series.join(' → ') + arrow + '</div>';
  }

  // 🌡 TEMPERATŪRA
  _tempBlockHtml(t) {
    if (!t.item) {
      return '<section class="med-block med-cat none">' + this._blockHead('🌡', 'Temperatūra', 'none') +
        '<div class="med-none">' + this.escapeHtml(t.emptyNote) + '</div></section>';
    }
    const isCrit = t.state === 'crit';
    const delta = t.delta === null ? '' :
      ' <span class="med-delta ' + (t.delta > 0 ? 'up' : (t.delta < 0 ? 'down' : '')) + '">' +
      (t.delta > 0 ? '↑ +' : (t.delta < 0 ? '↓ ' : '')) + Math.abs(t.delta).toFixed(1) + ' °C</span>';
    return '<section class="med-block med-cat ' + (isCrit ? 'crit' : 'ok') + '">' +
      this._blockHead('🌡', 'Temperatūra', t.state) +
      '<div class="med-big ' + (isCrit ? 'crit' : 'norm') + '">' +
        this.escapeHtml(t.value) + ' <small>°C</small>' +
        (isCrit ? '' : ' <span class="med-n">N</span>') +
      '</div>' +
      delta +
      '<div class="med-when">' + this._whenHtml(t.date, t.time) + '</div>' +
      this._findingsHtml(t.findings) +
      this._trendLineHtml(t.trend) +
      (t.author ? '<div class="med-author">ierakstījis ' + this.escapeHtml(t.author) + '</div>' : '') +
      '</section>';
  }

  // 🍽 ĒŠANA — 4 ēdienreizes + tendence, nevis tikai pēdējais ieraksts
  _foodBlockHtml(f) {
    if (!f.recorded) {
      return '<section class="med-block med-cat none">' + this._blockHead('🍽', 'Ēšana', 'none') +
        '<div class="med-none">' + this.escapeHtml(f.emptyNote) + '</div></section>';
    }
    const state = f.findings.some(x => x.sev === 'crit') ? 'crit' : (f.findings.length ? 'attn' : 'ok');
    const cells = MEAL_FIELDS.map(k => {
      const m = f.meals[k];
      const v = m.recorded ? m.value : '·';
      // "P – patstāvīgi" ir atzīts, bet nav mērīts, tāpēc nezaļējojoša krāsa
      const cls = m.value === 'A' ? 'refused'
        : (m.value === '½' ? 'half'
          : (m.value === 'P' ? 'patst'
            : (m.recorded ? 'ate' : 'empty')));
      const title = m.recorded && MEAL_KNOWN[m.value] ? ' title="' + this.escapeHtml(MEAL_KNOWN[m.value]) + '"' : '';
      return '<div class="med-meal ' + cls + '"' + title + '>' +
        '<span class="med-meal-name">' + this.escapeHtml(MEAL_LABEL[k]) + '</span>' +
        '<span class="med-meal-val">' + this.escapeHtml(v) + '</span>' +
      '</div>';
    }).join('');

    return '<section class="med-block med-cat ' + (state === 'ok' ? 'ok' : state) + '">' +
      this._blockHead('🍽', 'Ēšana', state) +
      '<div class="med-meals">' + cells + '</div>' +
      this._findingsHtml(f.findings) +
      // Secība "½ → ½ → ½" rāda diennakts apjomu pat tad, ja tas nav
      // maināts (tas jau ir 🔴 brīdinājums, nevis 📈 tendence).
      (f.series && f.series.length >= TREND_MIN_POINTS
        ? '<div class="med-series">🍽 ' + f.series.join(' → ') + '</div>' +
          '<div class="med-hint small">Dienas vidējais ēdienreižu apjoms, vecākais → šodien (' +
          this._dateLabel(f.seriesDates[0]) + ' → ' + this._dateLabel(f.seriesDates[f.seriesDates.length - 1]) + ')</div>'
        : '') +
      this._trendLineHtml(f.trend) +
      '</section>';
  }

  // 💧 ŠĶIDRUMI
  _fluidBlockHtml(f) {
    const crit = f.findings.some(x => x.sev === 'crit');
    const state = crit ? 'crit' : (f.findings.length ? 'attn' : 'ok');
    const rows = f.parts.map(p => {
      if (!p.value) {
        return '<div class="med-fluid none"><span class="med-fluid-name">' + this.escapeHtml(p.label) +
          '</span><span class="med-fluid-val">nav datu</span></div>';
      }
      const cls = p.state === 'crit' ? 'crit' : (p.state === 'attn' ? 'attn' : 'ok');
      return '<div class="med-fluid ' + cls + '">' +
        '<span class="med-fluid-name">' + this.escapeHtml(p.label) + '</span>' +
        '<span class="med-fluid-val">' + this.escapeHtml(p.value) + ' <small>ml</small></span>' +
        '<span class="med-when">' + this._whenHtml(p.date, p.time) + '</span>' +
      '</div>';
    }).join('');

    return '<section class="med-block med-cat ' + (state === 'ok' ? 'ok' : state) + '">' +
      this._blockHead('💧', 'Šķidrumi', state) +
      '<div class="med-fluids">' + rows + '</div>' +
      this._findingsHtml(f.findings) +
      f.trends.map(t => this._trendLineHtml(t)).join('') +
      '</section>';
  }

  // 🚽 VĒDERA IZEJA
  _bowelBlockHtml(b) {
    if (!b.item && b.daysSince === null) {
      return '<section class="med-block med-cat none">' + this._blockHead('🚽', 'Vēdera izeja', 'none') +
        '<div class="med-none">' + this.escapeHtml(b.emptyNote) + '</div></section>';
    }
    const state = b.state === 'crit' ? 'crit' : (b.state === 'attn' ? 'attn' : 'ok');
    const since = b.daysSince === null ? '' :
      '<div class="med-when">Pēdējā izkārnīšanās: pirms ' + b.daysSince +
      (b.daysSince === 1 ? ' dienas' : ' dienām') + '</div>';
    return '<section class="med-block med-cat ' + (state === 'ok' ? 'ok' : state) + '">' +
      this._blockHead('🚽', 'Vēdera izeja', state) +
      (b.value
        ? '<div class="med-big ' + (b.state === 'crit' ? 'crit' : 'norm') + '">' +
            this.escapeHtml(b.label) + '</div>' + since
        : '<div class="med-big ' + (b.state === 'crit' ? 'crit' : 'norm') + '">nav ' +
            (b.daysSince || 0) + (b.daysSince === 1 ? ' dienu' : ' dienas') + '</div>') +
      this._findingsHtml(b.findings) +
      (b.author ? '<div class="med-author">ierakstījis ' + this.escapeHtml(b.author) + '</div>' : '') +
      '</section>';
  }

  _whenHtml(date, time) {
    if (!date) return '';
    return this._dateLabel(date) + (time ? ' ' + this.escapeHtml(time) : '');
  }

  _attHtml(x) {
    const meta = [];
    if (x.author) meta.push(this.escapeHtml(x.author));
    if (x.date) meta.push(this._dateLabel(x.date));
    return '<div class="med-card warn">' +
      '<div class="med-card-label">' + this.escapeHtml(x.label) + '</div>' +
      (x.reason ? '<div class="med-card-reason">' + this.escapeHtml(x.reason) + '</div>' : '') +
      (meta.length ? '<div class="med-card-author">' + meta.join(' · ') + '</div>' : '') +
      '</div>';
  }

  _dateLabel(iso) {
    if (!iso) return '';
    const p = String(iso).split('-');
    if (p.length !== 3) return String(iso);
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // UI
  // ───────────────────────────────────────────────────────────────────────────
  setupUI() {
    const backBtn = document.getElementById('btnBack');
    if (backBtn) backBtn.addEventListener('click', () => { window.location.href = 'control.html'; });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (window.Logout) {
          const pending = await (async () => {
            try {
              if (window.careSync) return (await window.careSync.getUnsyncedItems()).length;
            } catch (err) {}
            return 0;
          })();
          const ok = await Logout.confirm({ pending });
          if (ok) Logout.performLogout();
        } else {
          sessionStorage.removeItem('careUser');
          window.location.href = 'index.html';
        }
      });
    }

    const syncBtn = document.getElementById('manualSyncBtn');
    if (syncBtn) {
      syncBtn.style.display = navigator.onLine ? 'inline-flex' : 'none';
      window.addEventListener('online', () => { syncBtn.style.display = 'inline-flex'; });
      window.addEventListener('offline', () => { syncBtn.style.display = 'none'; });
      syncBtn.addEventListener('click', async () => {
        if (!navigator.onLine) { this.toast('⚠️ ' + (typeof t === 'function' ? t('offline') : 'Nav savienojuma')); return; }
        syncBtn.disabled = true;
        this._setStatus('Sinhronizē...');
        try {
          // forceFullSync = TIEŠRAI LŪDZAMS. Reģistrs joprojām bloķē
          // paralēlu "fona" ielādi, ja tā jau notiek.
          const result = await this.sync.forceFullSync((msg) => this._setStatus(msg));
          if (result.offline) {
            this.toast('⚠️ ' + (result.error || 'Sinhronizācija neizdevās'), 4000);
          } else {
            await this.loadData();
            this.render();
            this.toast('✅ Sinhronizācija pabeigta.');
          }
        } catch (err) {
          this.toast('⚠️ Kļūda: ' + err.message, 4000);
        } finally {
          syncBtn.disabled = false;
          this._setStatus(null);
        }
      });
    }

    const search = document.getElementById('clientSearch');
    if (search) {
      search.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.trim().toLowerCase();
        this.renderClientList();
      });
    }

    const dateFilter = document.getElementById('dateFilter');
    if (dateFilter) {
      dateFilter.value = this._today();
      dateFilter.addEventListener('change', () => this.render());
    }

    window.addEventListener('syncComplete', (e) => {
      if (e.detail && !e.detail.offline) {
        this.loadData().then(() => this.render());
      }
    });
    window.addEventListener('recentMarksLoaded', () => {
      this.loadData().then(() => this.render());
    });
  }

  setupLanguageSwitcher() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        if (lang && typeof setLang === 'function') {
          setLang(lang);
          document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });
    if (typeof applyLanguage === 'function') applyLanguage();
  }

  // Neliela josla fonā, nevis bloķējošs ekrāns. Lietotājs var strādāt.
  _setStatus(msg) {
    let el = document.getElementById('medStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = 'medStatus';
      document.body.appendChild(el);
    }
    if (msg) {
      el.textContent = '🔄 ' + msg;
      el.className = 'med-status on';
    } else {
      el.className = 'med-status';
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DARBĪBAS
  // ───────────────────────────────────────────────────────────────────────────
  selectClient(clientId) {
    this.selectedClientId = String(clientId);
    this.renderDetail();
    const view = document.getElementById('medDetailView');
    if (view) view.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  closeDetail() {
    this.selectedClientId = null;
    this.renderDetail();
  }

  // Atvērt konkrētu klientu no ārējās saites (piem. no kontroliera).
  viewClient(clientId) { this.selectClient(clientId); }

  // Pāriet uz kontroliera paneli, kurā ir šī klienta pilna aprūpes vēsture.
  openLog(clientId) { window.location.href = 'control.html#client-' + clientId; }

  calculateAge(dob) {
    if (!dob) return '';
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return '';
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age >= 0 && age < 130 ? String(age) : '';
  }

  escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  toast(msg, duration) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:#333;color:#fff;padding:12px 24px;border-radius:8px;z-index:10000;' +
      'font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,0.3);';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration || 3000);
  }
}

function trendArrow(trend) {
  if (!trend || trend.points.length < 2) return '';
  const a = trend.points[0].value;
  const b = trend.points[trend.points.length - 1].value;
  const d = b - a;
  if (d > 0) return '↑';
  if (d < 0) return '↓';
  return '→';
}

let medicineView;
document.addEventListener('DOMContentLoaded', () => { medicineView = new MedicineView(); });

function formatDateTimeLVShort(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('lv-LV') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function t(key, params) {
  if (typeof window.t === 'function') return window.t(key, params);
  return key;
}
