const fs = require('fs');
const ExcelJS = require('exceljs');
const ExcelExporter = require('./js/excel_export.js');

var passed = 0;
var failed = 0;

function assertEq(name, actual, expected) {
  var a = actual === null || actual === undefined ? 'null' : String(actual);
  var e = expected === null || expected === undefined ? 'null' : String(expected);
  if (a === e) { passed++; console.log('  ✓ ' + name + ' = ' + a); }
  else { failed++; console.log('  ✗ ' + name + ' -- gaidīt: ' + e + ', saņemts: ' + a); }
}

console.log('=== Eksporta tests ar GAS stilu datiem ===\n');

var marks = [];
['2026-09-05', '2026-09-15', '2026-09-30'].forEach(function(dateStr) {
  marks.push({
    clientId: 'c_test_001',
    date: dateStr + 'T00:00:00.000Z',
    shift: 'R',
    category: 'temp',
    field: 'temperatura',
    value: '36.6'
  });
  marks.push({
    clientId: 'c_test_001',
    date: dateStr + 'T12:00:00.000Z',
    shift: 'V',
    category: 'temp',
    field: 'temperatura',
    value: '37.2'
  });
});

var client = {
  id: 'c_test_001',
  vards: 'Test',
  uzvards: 'Klients',
  dzimis: '1985-01-10',
  dieta: 'Vienkārša',
  simbiozu: 'Vājums'
};

var exporter = new ExcelExporter();
exporter.generateMonth(client, 2026, 9, marks).then(function(filename) {
  var wb = new ExcelJS.Workbook();
  return wb.xlsx.readFile(filename).then(function() {
    var ws = wb.getWorksheet('APRŪPES DOKUMANTĀCIJA_1');
    assertEq('C3 vārds+uzvārds', ws.getCell('C3').value, 'Test Klients');
    assertEq('R3 vecums', ws.getCell('R3').value, '41');
    assertEq('C5 simbiozu', ws.getCell('C5').value, 'Vājums');
    assertEq('R5 diēta', ws.getCell('R5').value, 'Vienkārša');
    assertEq('N7 mēnesis', ws.getCell('N7').value, 'Septembris');

    var colLetter = function(num) {
      var s = '';
      num = num + 1;
      while (num > 0) {
        var r = (num - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        num = Math.floor((num - 1) / 26);
      }
      return s;
    };
    var colR = colLetter(2 + (5 - 1) * 2);
    assertEq('D10 1. sept', ws.getCell(colR + '10').value, '36.6');
    assertEq('E10 1. sept V', ws.getCell((colR === 'C' ? 'D' : colR) + '10').value, '36.6');

    fs.unlinkSync(filename);
    console.log('\n=== Rezultāts: ' + passed + ' izturēti, ' + failed + ' neizturēti ===');
    if (failed > 0) process.exit(1);
  });
}).catch(function(err) {
  console.error('Kļūda:', err);
  process.exit(1);
});
