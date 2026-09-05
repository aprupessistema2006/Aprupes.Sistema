const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const ExcelExporter = require('./js/excel_export.js');

let testsPassed = 0;
let testsFailed = 0;
let testsTotal = 0;

function assert(name, condition, details) {
  testsTotal++;
  if (condition) {
    testsPassed++;
    console.log('  ✓ ' + name);
  } else {
    testsFailed++;
    console.log('  ✗ ' + name);
    if (details) console.log('    ' + details);
  }
}

function assertEq(name, actual, expected) {
  testsTotal++;
  const a = actual === null || actual === undefined ? null : String(actual);
  const e = expected === null || expected === undefined ? null : String(expected);
  if (a === e) {
    testsPassed++;
    console.log('  ✓ ' + name);
  } else {
    testsFailed++;
    console.log('  ✗ ' + name);
    console.log('    Sagaidīts: ' + e);
    console.log('    Saņemts:  ' + a);
  }
}

function colLetter(num) {
  let s = '';
  num = num + 1;
  while (num > 0) {
    const r = (num - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

function makeMark(id, date, shift, category, field, value, employeeId) {
  return {
    id: id,
    clientId: 'c_jānis',
    employeeId: employeeId,
    date: date,
    shift: shift,
    category: category,
    field: field,
    value: value,
    lastModified: new Date().toISOString(),
    lastBy: employeeId
  };
}

async function runE2ETest() {
  console.log('═══════════════════════════════════════════════');
  console.log('  E2E TESTS: 2 darbinieki, 1 klients, 31 diena');
  console.log('═══════════════════════════════════════════════\n');

  const ANNA = 'e_anna';
  const DAVIS = 'e_davis';
  const CLIENT = 'c_jānis';

  const YEAR = 2026;
  const MONTH = 10;
  const DAYS = 31;

  const allMarks = [];

  console.log('[1] Datu ģenerēšana (31 dienas, 2 darbinieki)...');
  for (let day = 1; day <= DAYS; day++) {
    const dateStr = YEAR + '-' + String(MONTH).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const isMorningShift = (day % 2 === 1);
    const morning = isMorningShift ? ANNA : DAVIS;
    const evening = isMorningShift ? DAVIS : ANNA;

    allMarks.push(makeMark('m_t' + day, dateStr, 'R', 'temp', 'temperatura', (36.3 + (day % 7) * 0.1).toFixed(1), morning));
    allMarks.push(makeMark('m_h1' + day, dateStr, 'R', 'higiena', 'mutes_dobuma_kopsana', 'X', morning));
    allMarks.push(makeMark('m_h2' + day, dateStr, 'R', 'higiena', 'vana_dns', day % 3 === 0 ? 'X' : '', morning));
    allMarks.push(makeMark('m_h3' + day, dateStr, 'R', 'higiena', 'daleja_apmazgasana', day % 2 === 0 ? 'X' : '', morning));
    allMarks.push(makeMark('m_h4' + day, dateStr, 'R', 'higiena', 'velas_maina', day % 2 === 1 ? 'X' : '', morning));
    allMarks.push(makeMark('m_h5' + day, dateStr, 'R', 'higiena', 'nagu_kopsana', 'X', morning));
    allMarks.push(makeMark('m_h6' + day, dateStr, 'R', 'higiena', 'matu_kopsana', 'X', morning));
    allMarks.push(makeMark('m_h7' + day, dateStr, 'R', 'higiena', 'bardas_skushana', day % 4 === 0 ? 'X' : '', morning));

    allMarks.push(makeMark('m_a1' + day, dateStr, 'R', 'aktivitate', 'parvietojas_ar_palidzlekli', 'X', morning));
    allMarks.push(makeMark('m_a2' + day, dateStr, 'R', 'aktivitate', 'stav_ar_palidziigu', day % 2 === 0 ? 'X' : '', morning));
    allMarks.push(makeMark('m_a3' + day, dateStr, 'R', 'aktivitate', 'sedz_ar_palidziigu', 'X', morning));

    const foodPattern = ['X', 'X', '½', 'A', 'X'];
    allMarks.push(makeMark('m_e1' + day, dateStr, 'R', 'edinasana', 'brokastis', foodPattern[day % 5], morning));
    allMarks.push(makeMark('m_e2' + day, dateStr, 'R', 'edinasana', 'pusdienas', foodPattern[(day + 1) % 5], morning));
    allMarks.push(makeMark('m_e3' + day, dateStr, 'R', 'edinasana', 'launags', day % 2 === 0 ? 'X' : '', morning));
    allMarks.push(makeMark('m_e4' + day, dateStr, 'R', 'edinasana', 'vakariņi', foodPattern[(day + 2) % 5], morning));

    allMarks.push(makeMark('m_s1' + day, dateStr, 'R', 'sikdrumi', 'urina_daudzums', String(1200 + day * 10), morning));
    allMarks.push(makeMark('m_s2' + day, dateStr, 'R', 'sikdrumi', 'uznemts_ml', String(1500 + day * 15), morning));

    allMarks.push(makeMark('m_f1' + day, dateStr, 'R', 'fiziologija', 'vedera_izeja', ['N', 'A', 'N', 'N', 'S'][day % 5], morning));

    allMarks.push(makeMark('m_c1' + day, dateStr, 'R', 'citsi_pasakomi', 'adas_kopsana', 'X', morning));
    allMarks.push(makeMark('m_c2' + day, dateStr, 'R', 'citsi_pasakomi', 'pastaigas', day % 2 === 0 ? 'X' : '', morning));
    allMarks.push(makeMark('m_c3' + day, dateStr, 'R', 'citsi_pasakomi', 'ciemini', day % 7 === 0 ? 'X' : 'Nē', morning));
    allMarks.push(makeMark('m_c4' + day, dateStr, 'R', 'citsi_pasakomi', 'autins_biksitu_skaits', String(day % 5 + 1), morning));
    allMarks.push(makeMark('m_c4v' + day, dateStr, 'V', 'citsi_pasakomi', 'autins_biksitu_skaits', String(2 + (day % 3)), evening));

    allMarks.push(makeMark('m_t2' + day, dateStr, 'V', 'temp', 'temperatura', (36.5 + (day % 5) * 0.1).toFixed(1), evening));
    allMarks.push(makeMark('m_h1v' + day, dateStr, 'V', 'higiena', 'mutes_dobuma_kopsana', 'X', evening));
    allMarks.push(makeMark('m_h2v' + day, dateStr, 'V', 'higiena', 'velas_maina', day % 3 === 0 ? 'X' : '', evening));
    allMarks.push(makeMark('m_e1v' + day, dateStr, 'V', 'edinasana', 'vakariņi', foodPattern[(day + 3) % 5], evening));
    allMarks.push(makeMark('m_e2v' + day, dateStr, 'V', 'edinasana', 'launags', 'X', evening));
    allMarks.push(makeMark('m_s2v' + day, dateStr, 'V', 'sikdrumi', 'uznemts_ml', String(800 + day * 5), evening));
    allMarks.push(makeMark('m_c4v' + day, dateStr, 'V', 'citsi_pasakomi', 'autins_biksitu_skaits', String(2 + (day % 3)), evening));

    const lastToLeave = isMorningShift ? ANNA : DAVIS;
    allMarks.push(makeMark('m_p' + day, dateStr, 'D', 'paraksts', 'aprupetaja_paraksts', lastToLeave === ANNA ? 'Kalna' : 'Strazds', lastToLeave));
  }

  console.log('  Izveidoti ' + allMarks.length + ' atzīmju ieraksti\n');

  console.log('[2] Excel eksporta izsaukums (exceljs, saglabā formatējumu)...');
  const exporter = new ExcelExporter();
  const client = { id: CLIENT, vards: 'Jānis', uzvards: 'Bērziņš' };
  const outPath = await exporter.generateMonth(client, YEAR, MONTH, allMarks);
  assert('Fails izveidots', fs.existsSync(outPath), outPath);
  console.log('  Fails: ' + outPath + '\n');

  console.log('[3] Ģenerētā faila nolasīšana un pārbaude...');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(outPath);
  const sheet1 = wb.getWorksheet('APRŪPES DOKUMANTĀCIJA_1');
  const sheet2 = wb.getWorksheet('APRŪPES DOKUMANTĀCIJA_2');
  assert('Lapa 1 (1-15) eksistē', !!sheet1);
  assert('Lapa 2 (16-31) eksistē', !!sheet2);

  const get = (sheet, row, col) => {
    const addr = colLetter(col) + row;
    const cell = sheet.getCell(addr);
    if (cell.value === null || cell.value === undefined) return null;
    if (typeof cell.value === 'object' && cell.value.text) return cell.value.text;
    if (typeof cell.value === 'object' && cell.value.formula) return null;
    return cell.value;
  };

  console.log('\n[4] 1. lapa (dienas 1-15) temperatūra rīts (rinda 10, atsevišķi R/V):');
  for (let day = 1; day <= 15; day++) {
    const colR = 2 + (day - 1) * 2;
    const tempR = get(sheet1, 10, colR);
    const tempV = get(sheet1, 10, colR + 1);
    const expectedR = (36.3 + (day % 7) * 0.1).toFixed(1);
    const expectedV = (36.5 + (day % 5) * 0.1).toFixed(1);
    assertEq('Diena ' + day + ' R temperatūra (C10)', tempR, expectedR);
    assertEq('Diena ' + day + ' V temperatūra (D10)', tempV, expectedV);
  }

  console.log('\n[5] 2. lapa (dienas 16-31) temperatūra rīts (rinda 4):');
  for (let day = 16; day <= 31; day++) {
    const colR = 2 + (day - 16) * 2;
    const tempR = get(sheet2, 4, colR);
    const expected = (36.3 + (day % 7) * 0.1).toFixed(1);
    assertEq('Diena ' + day + ' rīts temperatūra (R4, col ' + colLetter(colR) + ')', tempR, expected);
  }

  console.log('\n[6] 1. lapa paraksts (rinda 32, 1×dienā):');
  for (let day = 1; day <= 15; day++) {
    const colR = 2 + (day - 1) * 2;
    const signR = get(sheet1, 32, colR);
    const signV = get(sheet1, 32, colR + 1);
    const totalSigns = (signR ? 1 : 0) + (signV ? 1 : 0);
    assertEq('Diena ' + day + ' parakstu skaits (1×dienā)', totalSigns, 1);
  }

  console.log('\n[7] 2. lapa paraksts (rinda 26, 1×dienā):');
  for (let day = 16; day <= 31; day++) {
    const colR = 2 + (day - 16) * 2;
    const signR = get(sheet2, 26, colR);
    const signV = get(sheet2, 26, colR + 1);
    const totalSigns = (signR ? 1 : 0) + (signV ? 1 : 0);
    assertEq('Diena ' + day + ' parakstu skaits (1×dienā)', totalSigns, 1);
  }

  console.log('\n[7b] 1. lapa paraksts (rinda 32, atsevišķi R/V):');
  let annaDays1 = 0, davisDays1 = 0;
  for (let day = 1; day <= 15; day++) {
    const colR = 2 + (day - 1) * 2;
    const signR = get(sheet1, 32, colR);
    const signV = get(sheet1, 32, colR + 1);
    if (signR === 'Kalna') annaDays1++;
    if (signR === 'Strazds') davisDays1++;
    if (signR && signV) {
      assertEq('Diena ' + day + ' paraksts (1. lapa: R=V)', signR, signV);
    } else if (signR) {
      assertEq('Diena ' + day + ' paraksts (1. lapa R=' + signR + ')', signR, signR);
    } else {
      console.log('  ✗ Diena ' + day + ' paraksts tukšs');
      testsFailed++; testsTotal++;
    }
  }
  assert('1. lapa Anna parakstīja ≥1 dienu', annaDays1 > 0, 'Anna: ' + annaDays1);
  assert('1. lapa Dāvis parakstīja ≥1 dienu', davisDays1 > 0, 'Dāvis: ' + davisDays1);

  console.log('\n[8] Specifiskas vērtības (diena 1, 1. lapa):');
  const expectedR = (36.3 + (1 % 7) * 0.1).toFixed(1);
  const expectedV = (36.5 + (1 % 5) * 0.1).toFixed(1);
  assertEq('Diena 1 R temperatūra (C10)', get(sheet1, 10, 2), expectedR);
  assertEq('Diena 1 V temperatūra (D10)', get(sheet1, 10, 3), expectedV);
  assertEq('Diena 1 R mutes (C11)', get(sheet1, 11, 2), 'X');
  assertEq('Diena 1 V mutes (D11)', get(sheet1, 11, 3), 'X');
  assertEq('Diena 1 R urīna (C25)', get(sheet1, 25, 2), '1210');
  assertEq('Diena 1 R autiņbikses (C31, merged R+V)', get(sheet1, 31, 2), '2 / 3');

  console.log('\n[9] Specifiskas vērtības (diena 31, 2. lapa):');
  const colR31 = 2 + (31 - 16) * 2;
  assertEq('Diena 31 rīts temperatūra (' + colLetter(colR31) + '4)', get(sheet2, 4, colR31), (36.3 + (31 % 7) * 0.1).toFixed(1));
  const colV31 = colR31 + 1;
  assertEq('Diena 31 vakars temperatūra (' + colLetter(colV31) + '4)', get(sheet2, 4, colV31), (36.5 + (31 % 5) * 0.1).toFixed(1));

  console.log('\n[10] Komandas darbs:');
  let annaDays = 0, davisDays = 0;
  for (let day = 1; day <= 15; day++) {
    const colR = 2 + (day - 1) * 2;
    const signR = get(sheet1, 32, colR);
    if (signR === 'Kalna') annaDays++;
    if (signR === 'Strazds') davisDays++;
  }
  for (let day = 16; day <= 31; day++) {
    const colR = 2 + (day - 16) * 2;
    const signR = get(sheet2, 26, colR);
    if (signR === 'Kalna') annaDays++;
    if (signR === 'Strazds') davisDays++;
  }
  assert('Anna parakstīja ≥1 dienu', annaDays > 0, 'Anna: ' + annaDays);
  assert('Dāvis parakstīja ≥1 dienu', davisDays > 0, 'Dāvis: ' + davisDays);
  assertEq('Kopā 31 diena', annaDays + davisDays, 31);

  console.log('\n[11] Diētas lauki (1. lapa, pirmās 5 dienas):');
  const foodPattern = ['X', 'X', '½', 'A', 'X'];
  for (let day = 1; day <= 5; day++) {
    const colR = 2 + (day - 1) * 2;
    const brokastisR = get(sheet1, 21, colR);
    const expectedR = foodPattern[day % 5];
    if (brokastisR === expectedR) {
      console.log('  ✓ Diena ' + day + ' brokastis (R21): ' + brokastisR);
      testsPassed++; testsTotal++;
    } else {
      console.log('  ✗ Diena ' + day + ' brokastis: gaidīts ' + expectedR + ', saņemts ' + brokastisR);
      testsFailed++; testsTotal++;
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  REZULTĀTS: ' + testsPassed + '/' + testsTotal + ' testi izturēti');
  if (testsFailed > 0) {
    console.log('  ⚠ ' + testsFailed + ' testi neizturēti');
  } else {
    console.log('  ✓ VISI TESTI IZTURĒTI');
  }
  console.log('═══════════════════════════════════════════════');

  console.log('\n  📊 Statistika:');
  console.log('    Kopā atzīmes: ' + allMarks.length);
  console.log('    Anna parakstīja: ' + annaDays + ' dienas');
  console.log('    Dāvis parakstīja: ' + davisDays + ' dienas');
  console.log('    Mēnesis: ' + MONTH + '/' + YEAR + ' (' + DAYS + ' dienas)');

  process.exit(testsFailed > 0 ? 1 : 0);
}

runE2ETest().catch(err => {
  console.error('TESTA KĻŪDA:', err);
  process.exit(1);
});
