const CONFIG = {
  APP_NAME: 'Aprūpes sistēma',
  VERSION: '1.0.0',

  GAS_URL: 'https://script.google.com/macros/s/AKfycbw7vTRi6umdfWu0mZ602jFiWxXSwG6nU-o2FXqQgXv9r_mCOp1ShxoUnXq7sqhbw4guKA/exec',

  SHEET_ID: '1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E',

  SHIFTS: {
    R: 'Rīts',
    V: 'Vakars'
  },

  ROLES: {
    aprupetas: 'aprūpētājs',
    kontroliere: 'kontroliere',
    admins: 'administrators'
  },

  STORES: {
    DARBINIEKI: 'darbinieki',
    KLIENTI: 'klienti',
    ATZIMES: 'atzimes',
    ATZIMES_LOG: 'atzimes_log',
    DIENAS_IERAKTI: 'dienas_ierakti',
    UZDEVOMI: 'uzdevomi'
  },

  SHIFT_OPTIONS: [
    { value: 'R', label: 'Rīts' },
    { value: 'V', label: 'Vakars' }
  ],

  FIELD_DEFINITIONS: {
    temp: {
      category: 'temp',
      label: 'Temperatūra',
      field: 'temperatura',
      type: 'number',
      unit: '°C',
      lowLabel: 'N',
      lowThreshold: 37,
      highColor: 'red',
      description: 'Skaitlis (piem. 36.6). Zem 37° = N. 37+ = sarkans.'
    },
    higiena: {
      label: 'Higiēna',
      fields: [
        { field: 'mutes_dobuma_kopsana', label: 'Mutes dobuma kopšana', type: 'toggle', values: ['X', null] },
        { field: 'vana_dns', label: 'Vanna, duša', type: 'toggle', values: ['X', null] },
        { field: 'daleja_apmazgasana', label: 'Daļēja apmazgāšana', type: 'toggle', values: ['X', null] },
        { field: 'velas_maina', label: 'Veļas maiņa', type: 'toggle', values: ['X', null] },
        { field: 'nagu_kopsana', label: 'Nagu kopšana', type: 'toggle', values: ['X', null] },
        { field: 'matu_kopsana', label: 'Matu kopšana', type: 'toggle', values: ['X', null] },
        { field: 'bardas_skushana', label: 'Bārdas skūšana', type: 'toggle', values: ['X', null] }
      ]
    },
    aktivitate: {
      label: 'Aktivitāte',
      fields: [
        { field: 'parvietojas_ar_palidzlekli', label: 'Pārvietojas ar palīglīdzekli', type: 'toggle', values: ['X', null] },
        { field: 'stav_ar_palidziigu', label: 'Stāv ar palīdzību', type: 'toggle', values: ['X', null] },
        { field: 'sedz_ar_palidziigu', label: 'Sēž ar palīdzību', type: 'toggle', values: ['X', null] }
      ]
    },
    edinasana: {
      label: 'Ēdīšana',
      fields: [
        { field: 'brokastis', label: 'Brokastis', type: 'food', values: ['X', '½', 'A', null] },
        { field: 'pusdienas', label: 'Pusdienas', type: 'food', values: ['X', '½', 'A', null] },
        { field: 'launags', label: 'Launags', type: 'food', values: ['X', '½', 'A', null] },
        { field: 'vakariņi', label: 'Vakariņas', type: 'food', values: ['X', '½', 'A', null] }
      ]
    },
    sikdrumi: {
      label: 'Šķidrumi',
      fields: [
        { field: 'urina_daudzums', label: 'Diennakts urīna daudzums', type: 'number', unit: 'ml' },
        { field: 'uznemts_ml', label: 'Uzņemts H2O (24h)', type: 'number', unit: 'ml' }
      ]
    },
    fiziologija: {
      label: 'Fizioloģija',
      fields: [
        { field: 'vedera_izeja', label: 'Vēdera izeja', type: 'select', values: [
          { value: 'N', label: 'Normāla' },
          { value: 'A', label: 'Aizcietējums' },
          { value: 'S', label: 'Svecīte' },
          { value: 'C', label: 'Caureja' },
          { value: 'K', label: 'Klizma' }
        ]}
      ]
    },
    citi_pasakomi: {
      label: 'Citi pasākomi',
      fields: [
        { field: 'adas_kopsana', label: 'Ādas kopšanas līdzekļi', type: 'toggle', values: ['X', null] },
        { field: 'pastaigas', label: 'Pastaigas svaigā gaisā', type: 'toggle', values: ['X', null] },
        { field: 'ciemini', label: 'Ciemiņi', type: 'toggle', values: ['X', 'Nē', null] },
        { field: 'autins_biksitu_skaits', label: 'Autiņbiksīšu maiņa', type: 'number', unit: 'skaits' }
      ]
    },
    paraksts: {
      label: 'Paraksts',
      field: 'aprupetaja_paraksts',
      type: 'signature'
    }
  },

  EXCEL_TEMPLATE: {
    workbook: 'Aprūpes lapas.xlsx',
    sheets: {
      'APRŪPES DOKUMANTĀCIJA_1': { startDay: 1, endDay: 15 },
      'APRŪPES DOKUMANTĀCIJA_2': { startDay: 16, endDay: 31 }
    },
    startRow: 9,
    rowMapping: [
      { row: 9, category: 'temp', field: 'temperatura' },
      { row: 10, category: 'higiena', field: 'mutes_dobuma_kopsana' },
      { row: 11, category: 'higiena', field: 'vana_dns' },
      { row: 12, category: 'higiena', field: 'daleja_apmazgasana' },
      { row: 13, category: 'higiena', field: 'velas_maina' },
      { row: 14, category: 'higiena', field: 'nagu_kopsana' },
      { row: 15, category: 'higiena', field: 'matu_kopsana' },
      { row: 16, category: 'higiena', field: 'bardas_skushana' },
      { row: 17, category: 'aktivitate', field: 'parvietojas_ar_palidzlekli' },
      { row: 18, category: 'aktivitate', field: 'stav_ar_palidziigu' },
      { row: 19, category: 'aktivitate', field: 'sedz_ar_palidziigu' },
      { row: 20, category: 'edinasana', field: 'brokastis' },
      { row: 21, category: 'edinasana', field: 'pusdienas' },
      { row: 22, category: 'edinasana', field: 'launags' },
      { row: 23, category: 'edinasana', field: 'vakariņi' },
      { row: 24, category: 'sikdrumi', field: 'urina_daudzums' },
      { row: 25, category: 'sikdrumi', field: 'uznemts_ml' },
      { row: 26, category: 'citsi_pasakomi', field: 'adas_kopsana' },
      { row: 27, category: 'fiziologija', field: 'vedera_izeja' },
      { row: 28, category: 'citsi_pasakomi', field: 'pastaigas' },
      { row: 29, category: 'citsi_pasakomi', field: 'ciemini' },
      { row: 30, category: 'citsi_pasakomi', field: 'autins_biksitu_skaits' },
      { row: 31, category: 'paraksts', field: 'aprupetaja_paraksts' }
    ],
    getColumnForDay: function(day) {
      var startCol = 2;
      return startCol + (day - 1) * 2;
    },
    getColumnForDayShift: function(day, shift) {
      var base = this.getColumnForDay(day);
      return shift === 'V' ? base + 1 : base;
    }
  },

  STATUS: {
    SAVED: 'saglabāts',
    SYNCED: 'nosūtīts',
    PENDING: 'gaida nosūtīšanu',
    ERROR: 'neizdevās nosūtīt'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
if (typeof globalThis !== 'undefined') {
  globalThis.CONFIG = CONFIG;
}
