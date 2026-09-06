const SHEET_ID = '1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E';
const TZ = Session.getScriptTimeZone() || 'Europe/Riga';

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
  const headers = values[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = {};
    let hasData = false;
    for (let j = 0; j < headers.length; j++) {
      const v = values[i][j];
      if (v !== '' && v !== null && v !== undefined) {
        hasData = true;
      }
      if (v instanceof Date) {
        row[normalizeKey(headers[j])] = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
      } else {
        row[normalizeKey(headers[j])] = v;
      }
    }
    if (hasData) rows.push(row);
  }
  return rows;
}

function appendRow(sheet, data) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const row = new Array(headers.length).fill('');
  const keyMap = {};
  headers.forEach((h, i) => {
    keyMap[normalizeKey(h)] = i;
    keyMap[h] = i;
  });

  Object.keys(data).forEach(k => {
    const idx = keyMap[normalizeKey(k)] !== undefined ? keyMap[normalizeKey(k)] : keyMap[k];
    if (idx !== undefined) {
      let v = data[k];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
      } else if (typeof v === 'boolean') {
        v = v ? 'TRUE' : 'FALSE';
      } else if (v === null || v === undefined) {
        v = '';
      }
      row[idx] = v;
    }
  });
  sheet.appendRow(row);
}

function findRow(sheet, conditions) {
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const range = sheet.getRange(1, 1, lastRow, sheet.getLastColumn());
  const values = range.getValues();
  const headers = values[0].map(h => String(h).trim());
  const colMap = {};
  headers.forEach((h, i) => { colMap[normalizeKey(h)] = i; });

  for (let i = 1; i < values.length; i++) {
    let match = true;
    for (const [field, value] of conditions) {
      const colIdx = colMap[normalizeKey(field)];
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
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const colMap = {};
  headers.forEach((h, i) => { colMap[normalizeKey(h)] = i; });

  const idx = colMap[normalizeKey(field)];
  if (idx !== undefined) {
    let v = value;
    if (v instanceof Date) {
      v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    } else if (typeof v === 'boolean') {
      v = v ? 'TRUE' : 'FALSE';
    } else if (v === null || v === undefined) {
      v = '';
    }
    sheet.getRange(rowNum, idx + 1).setValue(v);
  }
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === 'load') {
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

  ensureColumns(atzimesSheet, ['Pēdējais laiks', 'Darbinieks pēdējais', 'Pēdējā vērtība']);
  ensureColumns(logSheet, ['Pēdējais laiks', 'Darbinieks pēdējais', 'Pēdējā vērtība']);

  appendRow(atzimesSheet, {
    id: id,
    klients_id: m.clientId,
    darbinieks_id: m.employeeId,
    datums: today,
    laiks: nowStr,
    periods: m.shift || 'R',
    kategorija: m.category,
    lauka_nosaukums: m.field,
    vertiba: m.value,
    pedeja_vertiba: m.value,
    pedeja_laiks: nowStr,
    darbinieks_pedejais: m.employeeId,
    izveidots: nowStr
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

function ensureColumns(sheet, requiredColumns) {
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const missing = requiredColumns.filter(col => !headers.includes(col));
  if (missing.length > 0) {
    const lastCol = headers.length;
    missing.forEach((col, i) => {
      sheet.getRange(1, lastCol + 1 + i).setValue(col);
    });
  }
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
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function formatDateTimeLV(d) {
  return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

function normalizeToDateString(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return formatDate(v);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
      const p = s.split('.');
      return p[2] + '-' + p[1] + '-' + p[0];
    }
  }
  return '';
}

function normalizeKey(h) {
  return String(h)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ /g, '_')
    .replace(/[^a-z0-9_]/g, '');
}
