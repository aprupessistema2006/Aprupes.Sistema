const CONFIG = {
  APP_NAME: 'Aprūpes sistēma',
  // Uzkopējama ar version.json un HTML ?v= parametriem. Šis lauks pats
  // nekur netiek lasīts (skripti izmanto version.json), bet tas ir jātur
  // saskaņots, lai neviens uz to nepaliekoties nepareizas versijas.
  VERSION: '20260929-1454',

  GAS_URL: 'https://script.google.com/macros/s/AKfycbwsW5xns0rOECVKku9HDwiLZ3gZydFSF9Kay6siW30eGc_LymwHMGFfsCJEd_pqi07xiA/exec',

  // ⚠️ Šis lauks klientā netiek lasīts — patieso nolasījumu dara
  // backend/gas_webhook.gs (SHEET_ID, 1. rinda). Šeit tas ir tikai
  // dokumentācijai, un tam JĀBŪT saskaņotam ar serveri, citādi jūs
  // atjaunināt šo failu, bet serveris joprojām lasīs veco lapu.
  SHEET_ID: '1uUf-qZKm5ovEVJaJbzjRn5RR5k3-b__3OlNBNdqT6os',

  TIMEZONE: 'Europe/Riga',

  // ═══════════════════════════════════════════════════════════════════════
  // VĒRTĪBU LEĢENDA — VIENS AUTENTISKAIS AVOTS
  //
  // Visas zīmīgas un skaitliskās vērtības, ko lietotājs var ierakstīt.
  // Šeit tās ir definētas vienreiz, lai medicīnas skats, aprūpes forma
  // un eksporta atskite nevar atšķirīties.
  //
  // ⚠️  Vērtība "S" parādās divās vietās — tas NAV viena un tā pati vērtība:
  //      • vēdera izejā  S = Svecīte   (normāls stāvoklis)
  //      • klienta statuss  "Slimnīca" ir TEKSTS laukā `statuss`
  //        (`hospitalizēts slimnīcā`, `atgriezies SAC`), nevis burtis "S".
  //      Tāpēc "S" Medicīnā nozīmē TIKAI "Svecīte". Ja kāds ieraksta
  //      burtu "S" vēdera izejas laukā, tas tiek lasīts kā Svecīte.
  // ═══════════════════════════════════════════════════════════════════════
  VALUE_LEGEND: {

    // Vispārējie atzīmēšanas kritēriji (pārslēdzamie lauki: X izpildīts,
    // P patstāvīgi, A atteicās)
    MARK: {
      X: 'Izpildīts',
      P: 'Patstāvīgi',
      A: 'Atteicās'
    },

    // 🍽 ēdināšana: X – visa porcija; ½ – puse porcijas; A – atteicās;
    //                P – patstāvīgi (atzīts, bet NEmērīts porciju punktos)
    ĒDIŠANA: {
      X: 'Visa porcija',
      '½': 'Puse porcijas',
      A: 'Atteicās',
      P: 'Patstāvīgi'
    },

    // 🚽 vēdera izeja: N – normāla; A – aizcietējumi; S – svecīte;
    //                 C – caureja; K – klizma
    // ⚠️ "Slimnīca" NAV šeit — tā ir klienta statuss, nevis izkārnīšanas veids.
    VEDERA_IZEJA: {
      N: 'Normāla',
      A: 'Aizcietējumi',
      S: 'Svecīte',
      C: 'Caureja',
      K: 'Klizma'
    }
  },

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
      field: ['r_paraksts', 'v_paraksts'],
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








