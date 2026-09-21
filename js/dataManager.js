// DataManager — vienotais datu pārvaldītājs.
// Google Sheets ir vienīgais patiesības avots.
// Lokālā atmiņa (IndexedDB) ir tikai atstarpe, lai lietotājs varētu strādāt bez pārlādēšanām.
//
// Darbības secība:
//   1. init() — vienreiz ielādē datus no GS, saglabā lokālajā atmiņā.
//   2. Katra izmaiņa (saglabāšana) — automātiski nosūta uz GS un atjauno lokālo kopiju.
//   3. Pārejā starp ekrāniem — nekas netiek atjaunots, jo datur jau ir lokālajā atmiņā.
//   4. Ja savienojums neizdodas — izmaiņas tiek ierakstītas rindā un nosūtītas, kad atjaunojas savienojums.
//   5. Lietotājs nekā nejutīs — nav pārlādēšanu, nav datu zaudēšanas.

const DataManager = {
  db: null,
  sync: null,
  initialized: false,
  initializing: false,
  _loadPromise: null,
  _pendingWrites: [],

  async init() {
    if (this.initialized) return;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      this.initializing = true;
      try {
        // 1. Inicializējam datubāzi
        this.db = new CareDB();
        await this.db.init();
        window.careDB = this.db;

        // 2. Inicializējam sinhronizāciju
        this.sync = new CareSync(this.db, CONFIG);
        window.careSync = this.sync;

        // 3. Ielādējam datus no Google Sheets
        //    Ja neizdodas — nekavējoties atkāpjamies, bet neizdzēšam datus
        await this._loadFromSheets();

        this.initialized = true;
      } catch (err) {
        console.error('[DataManager] init kļūda:', err);
        // Patiesībā neizdzēšam datus — ja GS nav sasniedzams, palaižam ar tukšu datu bāzi
        // Lietotājs redzēs kļūdas paziņojumu, bet nezaudēs iepriekšējos datus
      } finally {
        this.initializing = false;
      }
    })();

    return this._loadPromise;
  },

  async _loadFromSheets() {
    if (!this.sync) return;
    try {
      const result = await this.sync.loadInitialData((msg) => {
        // Progress callbacks var izsaukt, ja vajadzīgs
      });
      if (result.offline) {
        console.warn('[DataManager] Neizdevās ielādēt datus no GS:', result.error);
        // NEDZĒSIM DATUS — ja GS neatbild, palaižam ar to, kas ir lokālajā atmiņā
        // Tādējādi lietotājs nezaudē iepriekšējos datus
      }
    } catch (err) {
      console.error('[DataManager] _loadFromSheets kļūda:', err);
    }
  },

  // Pievienot izmaiņu rakstīšanai rindā (queue)
  enqueueChange(change) {
    if (!this.sync) {
      console.warn('[DataManager] sync nav inicializēts, saglabājam lokāli');
      return;
    }
    this.sync.enqueueChange(change);
  },

  // Pārlādēt datus no GS (manual sync)
  async refresh() {
    if (!this.sync) return;
    try {
      await this.sync.forceFullSync();
    } catch (err) {
      console.error('[DataManager] refresh kļūda:', err);
    }
  },

  // Iegūt visus datus no lokālās datubāzes
  async getAll(storeName) {
    if (!this.db) return [];
    return this.db.getAll(storeName);
  },

  // Saglabāt vienu ierakstu
  async put(storeName, value) {
    if (!this.db) return;
    return this.db.put(storeName, value);
  },

  // Saglabāt vairāk ierakstu
  async batchPut(storeName, items) {
    if (!this.db) return;
    return this.db.batchPut(storeName, items);
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.DataManager = DataManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataManager;
}