const fs = require('fs');
const ExcelJS = require('exceljs');
const ExcelExporter = require('./js/excel_export.js');
const { normalizeRow } = require('./js/sync.js');

var passed = 0;
var failed = 0;

function assert(name, cond, detail) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name + (detail ? ' -- ' + detail : '')); }
}

function assertEq(name, actual, expected) {
  var a = actual === null || actual === undefined ? 'null' : String(actual);
  var e = expected === null || expected === undefined ? 'null' : String(expected);
  if (a === e) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name + ' -- gaidīt: ' + e + ', saņemts: ' + a); }
}

console.log('=== Datuma repārācijas + Excel eksporta tests ===\n');

console.log('[1] Repārācija: swapots datums, izmantojot created kā atsauci');
var raw1 = {
  id: 'm1',
  klients_id: 'c1',
  darbinieks_id: 'e1',
  datums: '2026-05-09T00:00:00.000Z',
  periods: 'V',
  kategorija: 'temp',
  lauka_nosaukums: 'temperatura',
  vērtība: '38',
  izveidots: '2026-09-05T14:24:02.064Z'
};
var norm1 = normalizeRow(raw1);
console.log('  Datums pirms: 2026-05-09 (mai)');
console.log('  Izveidots:    ' + norm1.created);
console.log('  Datums pēc:   ' + norm1.date);
assertEq('Datums repārēts uz septembrī', norm1.date, '2026-09-05');
assertEq('category', norm1.category, 'temp');
assertEq('field', norm1.field, 'temperatura');
assertEq('value', norm1.value, '38');
assertEq('shift', norm1.shift, 'V');
assertEq('klientsId', norm1.klientsId, 'c1');

console.log('\n[2] Repārācija: swapots datums, izmantojot pēdējais_laiks kā atsauci');
var raw2 = {
  id: 'm1',
  klients_id: 'c1',
  darbinieks_id: 'e1',
  datums: '2026-05-09T00:00:00.000Z',
  periods: 'V',
  kategorija: 'temp',
  lauka_nosaukums: 'temperatura',
  vērtība: '38',
  pēdējais_laiks: '2026-09-05T17:00:47.007Z'
};
var norm2 = normalizeRow(raw2);
assertEq('Datums repārēts (pēdējais_laiks)', norm2.date, '2026-09-05');

console.log('\n[3] Excel eksporta tests ar repārētiem datumami');

function colLetter(num) {
  var s = '';
  num = num + 1;
  while (num > 0) {
    var r = (num - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

var categories = [
  ['temp', 'temperatura', '36.6'],
  ['higiena', 'mutes_dobuma_kopsana', 'X'],
  ['higiena', 'vana_dns', 'X'],
  ['higiena', 'daleja_apmazgasana', ''],
  ['higiena', 'velas_maina', 'X'],
  ['higiena', 'nagu_kopsana', 'X'],
  ['higiena', 'matu_kopsana', 'X'],
  ['higiena', 'bardas_skushana', ''],
  ['aktivitate', 'parvietojas_ar_palidzlekli', 'X'],
  ['aktivitate', 'stav_ar_palidziigu', 'X'],
  ['aktivitate', 'sedz_ar_palidziigu', 'X'],
  ['edinasana', 'brokastis', 'A'],
  ['edinasana', 'pusdienas', 'X'],
  ['edinasana', 'launags', '½'],
  ['edinasana', 'vakariņi', 'X'],
  ['sikdrumi', 'urina_daudzums', '500'],
  ['sikdrumi', 'uznemts_ml', '250'],
  ['citsi_pasakomi', 'adas_kopsana', 'X'],
  ['fiziologija', 'vedera_izeja', 'N'],
  ['citsi_pasakomi', 'pastaigas', 'X'],
  ['citsi_pasakomi', 'ciemini', 'Nē'],
  ['citsi_pasakomi', 'autins_biksitu_skaits', '2'],
  ['paraksts', 'aprupetaja_paraksts', 'Bērziņš']
];

var day = 5;
var marks = [];
categories.forEach(function(cat) {
  var shift = cat[0] === 'paraksts' ? 'D' : 'R';
  var m = normalizeRow({
    id: 'm_test_' + cat[0] + '_' + cat[1],
    klients_id: 'c_1788594800646',
    darbinieks_id: 'e_1788627594320',
    datums: '2026-05-09T00:00:00.000Z',
    periods: shift,
    kategorija: cat[0],
    lauka_nosaukums: cat[1],
    vērtība: cat[2],
    izveidots: '2026-09-05T10:00:00.000Z'
  });
  marks.push(m);
});

var allRepaired = marks.every(function(m) { return m.date === '2026-09-05'; });
assert('Visi atzīmes datumas repārētas', allRepaired);

var exporter = new ExcelExporter();
var client = { id: 'c_1788594800646', vards: 'Jānis', uzvards: 'Bērziņš' };

exporter.generateMonth(client, 2026, 9, marks).then(function(filename) {
  var wb = new ExcelJS.Workbook();
  return wb.xlsx.readFile(filename).then(function() {
    var ws1 = wb.getWorksheet('APRŪPES DOKUMANTĀCIJA_1');
    var colR = 2 + (day - 1) * 2;
    var col = colLetter(colR);

    if (ws1) {
      assertEq('Temperatūra (' + col + '10)', ws1.getCell(col + '10').value, '36.6');
      assertEq('Mutes dobuma kopšana (' + col + '11)', ws1.getCell(col + '11').value, 'X');
      assertEq('Vanu, duša (' + col + '12)', ws1.getCell(col + '12').value, 'X');
      assertEq('Brokastis (' + col + '21)', ws1.getCell(col + '21').value, 'A');
      assertEq('Vakariņas (' + col + '24)', ws1.getCell(col + '24').value, 'X');
      assertEq('Paraksts (' + col + '32)', ws1.getCell(col + '32').value, 'Bērziņš');
    } else {
      assert('Lapa 1 ekzistē', false, 'ws1 is undefined');
    }

    fs.unlinkSync(filename);
    console.log('\n=== Rezultāts: ' + passed + ' izturēti, ' + failed + ' neizturēti ===');
    if (failed > 0) process.exit(1);
  });
}).catch(function(err) {
  console.error('Kļūda:', err);
  process.exit(1);
});
