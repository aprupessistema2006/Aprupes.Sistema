class CareDB {
  constructor() {
    this.db = null;
    this.dbName = 'AprupesSistema';
    this.version = 2;
  }

  async init() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        resolve(this._initMemory());
        return;
      }
      const req = indexedDB.open(this.dbName, this.version);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const migrations = {
          darbinieki: { keyPath: 'id' },
          klienti: { keyPath: 'id' },
          atzimes: { keyPath: 'id' },
          atzimes_log: { keyPath: 'id' },
          dienas_ierakti: { keyPath: 'id' },
          uzdevomi: { keyPath: 'id' },
          meta: { keyPath: 'key' }
        };
        Object.keys(migrations).forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, migrations[storeName]);
          }
        });
      };
    });
  }

  _initMemory() {
    this._memory = {
      darbinieki: {}, klienti: {}, atzimes: {}, atzimes_log: {},
      dienas_ierakti: {}, uzdevomi: {}, meta: {}
    };
    this.db = { _memory: this._memory, _isMemory: true };
    return this.db;
  }

  _getStore(storeName, mode) {
    if (this.db._isMemory) {
      const store = this.db._memory[storeName];
      const tx = {
        _s: store,
        add: (val) => { store[val.id] = val; return { onsuccess: null, onerror: null, result: val.id }; },
        put: (val) => { store[val.id] = val; return { onsuccess: null, onerror: null, result: val.id }; },
        get: (key) => { return { onsuccess: null, onerror: null, result: store[key] }; },
        getAll: () => { return { onsuccess: null, result: Object.values(store) }; },
        delete: (key) => { delete store[key]; return { onsuccess: null }; },
        openCursor: () => { return { onsuccess: null }; },
        createIndex: () => {}, getAllKeys: () => ({ onsuccess: null, result: Object.keys(store) })
      };
      return tx;
    }
    return this.db.transaction(storeName, mode).objectStore(storeName);
  }

  async getAll(storeName) {
    if (this.db && this.db._isMemory) {
      return Object.values(this.db._memory[storeName] || {});
    }
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readonly');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async get(storeName, key) {
    if (this.db && this.db._isMemory) {
      return this.db._memory[storeName] ? this.db._memory[storeName][key] : null;
    }
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readonly');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async add(storeName, value) {
    if (this.db && this.db._isMemory) {
      this.db._memory[storeName][value.id] = value;
      return value.id;
    }
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readwrite');
      const req = store.add(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async put(storeName, value) {
    if (this.db && this.db._isMemory) {
      this.db._memory[storeName][value.id] = value;
      return value.id;
    }
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readwrite');
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(storeName, key) {
    if (this.db && this.db._isMemory) {
      if (this.db._memory[storeName]) delete this.db._memory[storeName][key];
      return;
    }
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readwrite');
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(storeName) {
    if (this.db && this.db._isMemory) {
      this.db._memory[storeName] = {};
      return;
    }
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readwrite');
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const store = this._getStore(storeName, 'readonly');
      if (store._isMemory) {
        resolve(Object.values(store._s).filter(v => v[indexName] === value));
        return;
      }
      const req = store.index ? store.index(indexName).getAll(value) : store.getAll();
      if (req) {
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } else {
        resolve(Object.values(store._s).filter(v => v[indexName] === value));
      }
    });
  }

  generateId() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  async getMeta(key) {
    const val = await this.get('meta', key);
    return val ? val.value : null;
  }

  async setMeta(key, value) {
    await this.put('meta', { key, value, ts: Date.now() });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CareDB;
}
if (typeof globalThis !== 'undefined') {
  globalThis.CareDB = CareDB;
}
