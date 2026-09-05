const fs = require('fs');
const ExcelJS = require('exceljs');
const ExcelExporter = require('./js/excel_export.js');

const marks = [];
const client = {
  id: 'c_test_001',
  vards: 'Līga',
  uzvards: 'Bērziņa',
  dzimis: '1990-03-15',
  dieta: 'Bez glutēna',
  simbiozu: 'Hiperpireze, anēmija'
};

const exporter = new ExcelExporter();
exporter.generateMonth(client, 2026, 9, marks).then(function(filename) {
  const wb = new ExcelJS.Workbook();
  return wb.xlsx.readFile(filename).then(function() {
    const ws = wb.getWorksheet('APRŪPES DOKUMANTĀCIJA_1');
    let passed = 0;
    let failed = 0;

    function assertEq(name, actual, expected) {
      const a = actual === null || actual === undefined ? 'null' : String(actual);
      const e = expected === null || expected === undefined ? 'null' : String(expected);
      if (a === e) { passed++; console.log('  ✓ ' + name + ' = ' + a); }
      else { failed++; console.log('  ✗ ' + name + ' -- gaidīt: ' + e + ', saņemts: ' + a); }
    }

    console.log('=== Klienta info testi ===\n');
    assertEq('C3 klienta vārds+uzvards', ws.getCell('C3').value, 'Līga Bērziņa');
    assertEq('R3 vecums', ws.getCell('R3').value, '36');
    assertEq('C5 saskarsmes īpatnieba', ws.getCell('C5').value, 'Hiperpireze, anēmija');
    assertEq('R5 diēta', ws.getCell('R5').value, 'Bez glutēna');
    assertEq('N7 mēnesis', ws.getCell('N7').value, 'Septembris');

    fs.unlinkSync(filename);
    console.log('\n=== Rezultāts: ' + passed + ' izturēti, ' + failed + ' neizturēti ===');
    if (failed > 0) process.exit(1);
  });
}).catch(function(err) {
  console.error('Kļūda:', err);
  process.exit(1);
});
