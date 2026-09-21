// SyncGuard — savienojuma pārvaldītājs.
// Google Sheets ir vienīgais patiesības avots.
// Ja nav savienojuma — programma neļauj strādāt.
//
// Darbības secība:
//   1. checkConnection() — pārbauda, vai GS ir sasniedzams.
//   2. Ja nav — rāda kļūdu un neļauj turpināt.
//   3. Ja ir — atjauno datus no GS.
//   4. Katrā pārejā — atjauno datus no GS.

const SyncGuard = {
  online: false,
  lastCheck: 0,
  CHECK_INTERVAL: 30000, // 30 sekundes
  _checkPromise: null,

  async checkConnection() {
    if (this._checkPromise) return this._checkPromise;

    this._checkPromise = (async () => {
      try {
        const url = CONFIG.GAS_URL + '?action=ping&t=' + Date.now();
        const response = await fetch(url, { mode: 'no-cors', cache: 'no-store' });
        // no-cors mode always returns opaque response, so we can't read it
        // But if fetch succeeds, we assume connection is OK
        this.online = true;
        this.lastCheck = Date.now();
      } catch (e) {
        this.online = false;
        this.lastCheck = Date.now();
      }
      this._checkPromise = null;
      return this.online;
    })();

    return this._checkPromise;
  },

  needsRefresh() {
    return (Date.now() - this.lastCheck) > this.CHECK_INTERVAL;
  },

  async ensureOnline() {
    if (!this.online || this.needsRefresh()) {
      await this.checkConnection();
    }
    if (!this.online) {
      throw new Error('Nav savienojuma ar Google Sheets');
    }
  },

  async refreshData(onProgress) {
    await this.ensureOnline();
    if (window.careSync) {
      return window.careSync.reloadFromSheets(onProgress);
    }
    throw new Error('Sinhronizācija nav inicializēta');
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.SyncGuard = SyncGuard;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncGuard;
}