const SHEET_ID = '1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E';

function getSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function getSheet(sheetName) {
  return getSpreadsheet().getSheetByName(sheetName);
}

function getSheetData(sheet) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol === 0) return [];
  const range = sheet.getRange(1, 1, lastRow, lastCol);
  const values = range.getValues();
  if (values.length === 0) return [];
  const headers = values[0];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = {};
    let hasData = false;
    for (let j = 0; j < headers.length; j++) {
      if (values[i][j] !== '' && values[i][j] !== null && values[i][j] !== undefined) {
        hasData = true;
      }
      row[headers[j].toString().toLowerCase().replace(/ /g, '_')] = values[i][j];
    }
    if (hasData) rows.push(row);
  }
  return rows;
}

function appendRow(sheet, data) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const row = new Array(headers.length).fill('');
  const aliasMap = buildAliasMap(headers);
  // Normalizējam datu atslēgas: 'vertiba' -> 'vērtība' -> 'value'
  // un pēc tam salīdzinām ar aliasMap.
  const headerAliases = {
    'vertiba': 'vērtība',
    'pedeja_vertiba': 'pēdējā_vērtība',
    'pedeja_laiks': 'pēdējais_laiks',
    'darbinieks_pedejais': 'darbinieks pēdējais',
    'papilgs_info': 'papildus info',
    'labotajs_id': 'labotājs id',
    'klients_id': 'klients id',
    'darbinieks_id': 'darbinieks id',
    'atzimes_id': 'atzīmes id',
    'lauka_nosaukums': 'lauka nosaukums',
    'datums': 'datums',
    'periods': 'periods',
    'kategorija': 'kategorija',
    'laiks': 'laiks',
    'izveidots': 'izveidots'
  };
  const normalizedData = {};
  Object.keys(data).forEach(k => {
    const latvianKey = headerAliases[k] || k;
    normalizedData[k] = data[k];
    normalizedData[latvianKey] = data[k];
    normalizedData[normalizeKey(latvianKey)] = data[k];
  });
  headers.forEach((h, i) => {
    const key = aliasMap[i];
    const normH = normalizeKey(h);
    for (const k of Object.keys(normalizedData)) {
      if (k === key || k === normH || k === h) {
        let v = normalizedData[k];
        if (typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE';
        if (v === null || v === undefined) v = '';
        row[i] = v;
        break;
      }
    }
  });
  sheet.appendRow(row);
}

function buildAliasMap(headers) {
  const aliases = {
    'vārds': 'vards',
    'uzvārds': 'uzvards',
    'loma': 'loma',
    'pin_kods': 'pin',
    'aktīvs': 'aktivs',
    'dzimšanas_datums': 'dzimis',
    'diēta': 'dieta',
    'saskarsmes_īpatnības': 'saskarsmes',
    'klients_id': 'clientId',
    'darbinieks_id': 'employeeId',
    'atzīmes_id': 'markId',
    'periods': 'shift',
    'kategorija': 'category',
    'lauka_nosaukums': 'field',
    'vērtība': 'value',
    'pēdējā_vērtība': 'lastValue',
    'pēdējais_laiks': 'lastModified',
    'darbinieks_pēdējais': 'lastBy',
    'papildus_info': 'reason',
    'izveidots': 'created',
    'termiņš': 'termins',
    'prioritāte': 'prioritate',
    'labotājs_id': 'editorId',
    'piešķirt_darbiniekam_id': 'pieskirtDarbiniekamId',
    'ir_pabeigts': 'irPabeigts',
    'izveidotājs_id': 'izveidotajsId',
    'pabeigts_laiks': 'pabeigtsLaiks',
    'pabeigtājs_id': 'pabeigtajsId'
  };
  const map = {};
  headers.forEach((h, i) => {
    const k = normalizeKey(h);
    map[i] = aliases[k] || k;
  });
  return map;
}

function normalizeKey(h) {
  return h.toString().toLowerCase().replace(/ /g, '_');
}

function findRow(sheet, conditions) {
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const range = sheet.getRange(1, 1, lastRow, sheet.getLastColumn());
  const values = range.getValues();
  const headers = values[0];
  const colMap = {};
  headers.forEach((h, i) => { colMap[h.toString().toLowerCase().replace(/ /g, '_')] = i; });
  for (let i = 1; i < values.length; i++) {
    let match = true;
    for (const [field, value] of conditions) {
      const colIdx = colMap[field];
      if (colIdx === undefined || String(values[i][colIdx]) !== String(value)) {
        match = false;
        break;
      }
    }
    if (match) return { row: i + 1, data: values[i], headers: headers };
  }
  return null;
}

function setCellValue(sheet, rowNum, field, value) {
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const aliasMap = buildAliasMap(headers);
  const reverseAlias = {
    'vards': 'vārds',
    'uzvards': 'uzvārds',
    'pin': 'pin kods',
    'aktivs': 'aktīvs',
    'dzimis': 'dzimšanas datums',
    'dieta': 'diēta',
    'saskarsmes': 'saskarsmes īpatnības',
    'clientId': 'klients id',
    'employeeId': 'darbinieks id',
    'markId': 'atzīmes id',
    'shift': 'periods',
    'category': 'kategorija',
    'field': 'lauka nosaukums',
    'value': 'vērtība',
    'lastValue': 'pēdējā vērtība',
    'lastModified': 'pēdējais laiks',
    'lastBy': 'darbinieks pēdējais',
    'reason': 'papildus info',
    'created': 'izveidots',
    'editorId': 'labotājs id'
  };
  const target = reverseAlias[field] || field;
  const normTarget = normalizeKey(target);
  let colIdx = -1;
  headers.forEach((h, i) => {
    const k = aliasMap[i];
    if (k === field || k === normTarget || normalizeKey(h) === normTarget || normalizeKey(h) === field) colIdx = i;
  });
  if (colIdx >= 0) {
    let v = value;
    if (typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE';
    if (v === null || v === undefined) v = '';
    sheet.getRange(rowNum, colIdx + 1).setValue(v);
  }
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === 'load') {
      try { fixDates(); } catch (fe) { Logger.log('fixDates error: ' + fe); }
      return handleLoad();
    }
    if (params.data) {
      let data;
      try { data = JSON.parse(params.data); } catch (pe) {
        return createResponse(400, { error: 'Nederīgs JSON' });
      }
      return routeAction(data);
    }
    if (params.action) {
      return routeAction({ action: params.action, data: params });
    }
    return createResponse(400, { error: 'Nezināma darbība' });
  } catch (err) {
    return createResponse(500, { error: 'Kļūda: ' + err.toString() });
  }
}

function doPost(e) {
  try {
    let data;
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e && e.parameter && e.parameter.data) {
      data = JSON.parse(e.parameter.data);
    } else {
      return createResponse(400, { error: 'Nav datu' });
    }
    return routeAction(data);
  } catch (err) {
    return createResponse(500, { error: 'Kļūda: ' + err.toString() });
  }
}

function routeAction(data) {
  const action = data.action;
  try {
    if (action === 'createClient') return handleCreateClient(data);
    if (action === 'createEmployee') return handleCreateEmployee(data);
    if (action === 'updateClient') return handleUpdate(data, 'klienti');
    if (action === 'updateEmployee') return handleUpdate(data, 'darbinieki');
    if (action === 'mark') return handleMark(data);
    if (action === 'createTask') return handleCreateTask(data);
    if (action === 'updateTask') return handleUpdateTask(data);
    if (action === 'logDay') return handleLogDay(data);
    return createResponse(200, { success: true });
  } catch (err) {
    return createResponse(500, { error: 'Kļūda: ' + err.toString() });
  }
}

function handleLoad() {
  return createResponse(200, {
    darbinieki: getSheetData(getSheet('darbinieki')),
    klienti: getSheetData(getSheet('klienti')),
    atzimes: getSheetData(getSheet('atzimes')),
    atzimes_log: getSheetData(getSheet('atzimes_log')),
    dienas_ierakti: getSheetData(getSheet('dienas_ierakti')),
    uzdevomi: getSheetData(getSheet('uzdevomi'))
  });
}

function handleCreateClient(data) {
  const sheet = getSheet('klienti');
  const c = data.data;
  const id = 'c_' + Date.now();
  appendRow(sheet, {
    id: id,
    vards: c.vards || '',
    uzvards: c.uzvards || '',
    dzimis: c.dzimis || '',
    dieta: c.dieta || '',
    saskarsmes: c.saskarsmes || '',
    aktivs: true
  });
  return createResponse(200, { success: true, id: id });
}

function handleCreateEmployee(data) {
  const sheet = getSheet('darbinieki');
  const e = data.data;
  const id = 'e_' + Date.now();
  appendRow(sheet, {
    id: id,
    vards: e.vards || '',
    uzvards: e.uzvards || '',
    loma: e.loma || 'aprūpētājs',
    pin_kods: String(e.pin || ''),
    aktivs: true,
    parole: e.parole || ''
  });
  return createResponse(200, { success: true, id: id });
}

function handleUpdate(data, sheetName) {
  const sheet = getSheet(sheetName);
  const row = findRow(sheet, [['id', data.data.id]]);
  if (!row) return createResponse(404, { error: 'Nav atrasts' });
  Object.keys(data.data).forEach(f => {
    if (f !== 'id' && data.data[f] !== undefined) setCellValue(sheet, row.row, f, data.data[f]);
  });
  return createResponse(200, { success: true });
}

function handleMark(data) {
  const atzimesSheet = getSheet('atzimes');
  const logSheet = getSheet('atzimes_log');
  const m = data.data;
  const id = 'm_' + Date.now();
  const today = m.date ? normalizeToDateString(m.date) : formatDate(new Date());
  const nowStr = formatDateTimeLV(new Date());

  appendRow(atzimesSheet, {
    id: id,
    klients_id: m.clientId,
    darbinieks_id: m.employeeId,
    datums: today,
    periods: m.shift || 'R',
    kategorija: m.category,
    lauka_nosaukums: m.field,
    vertiba: m.value,
    pedeja_vertiba: m.value,
    pedeja_laiks: nowStr,
    darbinieks_pedejais: m.employeeId
  });

  appendRow(logSheet, {
    id: 'l_' + Date.now() + Math.floor(Math.random() * 1000),
    atzimes_id: id,
    klients_id: m.clientId,
    darbinieks_id: m.employeeId,
    datums: today,
    laiks: new Date().toTimeString().split(' ')[0],
    periods: m.shift || 'R',
    kategorija: m.category,
    lauka_nosaukums: m.field,
    vertiba: m.value,
    papilgs_info: '',
    izveidots: nowStr
  });

  return createResponse(200, { success: true, id: id });
}

function handleCreateTask(data) {
  const sheet = getSheet('uzdevomi');
  const t = data.data;
  const id = 't_' + Date.now();
  appendRow(sheet, {
    id: id,
    teksts: t.teksts || '',
    klients_id: t.klientsId || t.clientId || '',
    'piešķirt_darbiniekam_id': t.pieskirtDarbiniekamId || t.employeeId || '',
    termins: t.termins || '',
    prioritate: t.prioritate || 'videja',
    statuss: t.statuss || 'jauns',
    pabeigts: t.irPabeigts === true || t.irPabeigts === 'true',
    izveidots: t.izveidots || formatDateTimeLV(new Date()),
    izveidotajs_id: t.izveidotajsId || '',
    pabeigts_laiks: t.pabeigtsLaiks || '',
    pabeigtajs_id: t.pabeigtajsId || ''
  });
  return createResponse(200, { success: true, id: id });
}

function handleUpdateTask(data) {
  const sheet = getSheet('uzdevomi');
  const t = data.data;
  const row = findRow(sheet, [['id', t.id]]);
  if (!row) return createResponse(404, { error: 'Uzdevums nav atrasts' });
  if (t.statuss !== undefined) setCellValue(sheet, row.row, 'statuss', t.statuss);
  if (t.irPabeigts !== undefined) setCellValue(sheet, row.row, 'pabeigts', t.irPabeigts === true || t.irPabeigts === 'true');
  if (t.pabeigtsLaiks !== undefined) setCellValue(sheet, row.row, 'pabeigts_laiks', t.pabeigtsLaiks || '');
  if (t.pabeigtajsId !== undefined) setCellValue(sheet, row.row, 'pabeigtajs_id', t.pabeigtajsId || '');
  return createResponse(200, { success: true });
}

function handleLogDay(data) {
  const sheet = getSheet('dienas_ierakti');
  const id = 'd_' + Date.now();
  const today = data.data.date ? normalizeToDateString(data.data.date) : formatDate(new Date());
  appendRow(sheet, {
    id: id,
    klients_id: data.data.clientId,
    darbinieks_id: data.data.employeeId,
    datums: today,
    statuss: data.data.status || 'pabeigts',
    pabeigts: data.data.completed !== false,
    labotajs_id: data.data.employeeId
  });
  return createResponse(200, { success: true, id: id });
}

function createResponse(status, data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function formatDateTimeLV(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return y + '-' + m + '-' + day + 'T' + h + ':' + min + ':' + s;
}

function normalizeToDateString(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return formatDate(v);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    const parts = s.split(/[.\-/]/);
    if (parts.length >= 3) {
      const y = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      const p2 = parseInt(parts[2], 10);
      // Google Sheets "Date" objekta string forma ir Y.D.M (gads.dienn.mēnesis)
      // piem. "2026.6.9" = 2026. gada 6. septembris = 2026-09-06
      if (!isNaN(y) && !isNaN(p1) && !isNaN(p2) && y >= 100 && p1 >= 1 && p1 <= 31 && p2 >= 1 && p2 <= 12) {
        return y + '-' + String(p2).padStart(2, '0') + '-' + String(p1).padStart(2, '0');
      }
    }
  }
  return '';
}

// Migrācija: aizpilda tukšās Vērtība/Pēdējā vērtība kolonnas atzimes un atzimes_log,
// izmantojot atzimes_log datus (kas satur jaunākos ierakstus).
// Papildus izlabo datuma formātu, ja tas saglabāts kā Date objekts ar nepareizu mēnesi.
function migrateBackfill() {
  const logSheet = getSheet('atzimes_log');
  const atzimesSheet = getSheet('atzimes');
  if (!logSheet || !atzimesSheet) return 0;

  const logHeaders = logSheet.getRange(1, 1, 1, logSheet.getLastColumn()).getValues()[0];
  const logAlias = buildAliasMap(logHeaders);
  const logColIdx = {};
  logHeaders.forEach((h, i) => { logColIdx[logAlias[i] || normalizeKey(h)] = i; });

  const lastLog = {};
  const logValues = logSheet.getRange(2, 1, Math.max(0, logSheet.getLastRow() - 1), logSheet.getLastColumn()).getValues();
  logValues.forEach(row => {
    const markId = String(row[logColIdx['markId']] || '');
    if (!markId) return;
    const existing = lastLog[markId];
    if (!existing || String(row[logColIdx['created']]) > String(existing[logColIdx['created']])) {
      lastLog[markId] = row;
    }
  });

  const atzHeaders = atzimesSheet.getRange(1, 1, 1, atzimesSheet.getLastColumn()).getValues()[0];
  const atzAlias = buildAliasMap(atzHeaders);
  const atzColIdx = {};
  atzHeaders.forEach((h, i) => { atzColIdx[atzAlias[i] || normalizeKey(h)] = i; });

  const atzRange = atzimesSheet.getRange(2, 1, Math.max(0, atzimesSheet.getLastColumn() ? atzimesSheet.getLastRow() - 1 : 0), atzimesSheet.getLastColumn());
  const atzValues = atzRange.getValues();
  let count = 0;
  for (let i = 0; i < atzValues.length; i++) {
    const id = String(atzValues[i][atzColIdx['id']] || '');
    if (!id) continue;
    const source = lastLog[id];
    if (!source) continue;
    const targetValue = String(source[logColIdx['value']] || '');
    const targetLastBy = String(source[logColIdx['employeeId']] || '');
    const targetLastMod = source[logColIdx['created']];
    let changed = false;
    if (targetValue && !atzValues[i][atzColIdx['value']]) {
      atzValues[i][atzColIdx['value']] = targetValue;
      atzValues[i][atzColIdx['lastValue']] = targetValue;
      changed = true;
    }
    if (targetLastBy && !atzValues[i][atzColIdx['lastBy']]) {
      atzValues[i][atzColIdx['lastBy']] = targetLastBy;
      changed = true;
    }
    if (targetLastMod && !atzValues[i][atzColIdx['lastModified']]) {
      atzValues[i][atzColIdx['lastModified']] = targetLastMod;
      changed = true;
    }
    if (changed) count++;
  }
  atzRange.setValues(atzValues);
  return count;
}

// Migrācija: izlabo datuma formātu visās lapās (atzimes un atzimes_log).
// Ja datums ir 'YYYY-MM-DDTHH:MM:SS.sssZ' (piem. 2026-05-09T00:00:00.000Z),
// pārraksta uz tādu pašu datumu, bet tikai YYYY-MM-DD formātā.
// Ja datums šūnā ir Date objekts, pārraksta to kā tekstu YYYY-MM-DD.
function fixDates() {
  const sheets = [getSheet('atzimes'), getSheet('atzimes_log')];
  let fixed = 0;
  sheets.forEach(sheet => {
    if (!sheet) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const aliasMap = buildAliasMap(headers);
    const dateColIdx = headers.findIndex((h, i) => aliasMap[i] === 'date');
    if (dateColIdx < 0) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const range = sheet.getRange(2, dateColIdx + 1, lastRow - 1, 1);
    const values = range.getValues();
    for (let i = 0; i < values.length; i++) {
      const v = values[i][0];
      if (v instanceof Date) {
        const y = v.getFullYear();
        const m = String(v.getMonth() + 1).padStart(2, '0');
        const d = String(v.getDate()).padStart(2, '0');
        values[i][0] = y + '-' + m + '-' + d;
        fixed++;
      } else if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}T/)) {
        values[i][0] = v.substring(0, 10);
        fixed++;
      } else if (typeof v === 'string' && v.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
        const p = v.split('.');
        values[i][0] = p[2] + '-' + p[1] + '-' + p[0];
        fixed++;
      }
    }
    range.setValues(values);
  });
  return fixed;
}
