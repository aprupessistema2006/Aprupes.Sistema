const SHEET_ID = '1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E';
const TZ = 'Europe/Riga';

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
      const headerKey = normalizeKey(headers[j]);
      if (v instanceof Date) {
        if (headerKey === 'laiks') {
          row[headerKey] = Utilities.formatDate(v, TZ, 'HH:mm:ss');
        } else {
          row[headerKey] = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
        }
      } else {
        row[headerKey] = v;
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

  const fieldAliases = {
    dzimis: 'dzimsanas_datums',
    saskarsmes: 'saskarsmes_ipatnibas'
  };

  Object.keys(data).forEach(k => {
    const nk = normalizeKey(k);
    const canonicalKey = fieldAliases[nk] || nk;
    const idx = keyMap[canonicalKey] !== undefined ? keyMap[canonicalKey] : keyMap[k];
    if (idx !== undefined) {
      let v = data[k];
      if (v instanceof Date) {
        const normalizedKey = normalizeKey(k);
        if (normalizedKey === 'laiks') {
          v = Utilities.formatDate(v, TZ, 'HH:mm:ss');
        } else {
          v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
        }
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

  const fieldAliases = {
    dzimis: 'dzimsanas_datums',
    saskarsmes: 'saskarsmes_ipatnibas'
  };
  const canonicalField = fieldAliases[normalizeKey(field)] || field;
  const idx = colMap[normalizeKey(canonicalField)];
  if (idx !== undefined) {
    let v = value;
    if (v instanceof Date) {
      const normalizedField = normalizeKey(field);
      if (normalizedField === 'laiks') {
        v = Utilities.formatDate(v, TZ, 'HH:mm:ss');
      } else {
        v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
      }
    } else if (typeof v === 'boolean') {
      v = v ? 'TRUE' : 'FALSE';
    } else if (v === null || v === undefined) {
      v = '';
    }
    sheet.getRange(rowNum, idx + 1).setValue(v);
  }
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  try {
    let result;
    if (params.action === 'load') {
      result = handleLoadData();
    } else if (params.data) {
      let data;
      try { data = JSON.parse(params.data); } catch (pe) {
        return wrapResponse(params, { error: 'Nederīgs JSON' });
      }
      result = routeActionData(data);
    } else if (params.action) {
      result = routeActionData({ action: params.action, data: params });
    } else {
      result = { error: 'Nezināma darbība' };
    }
    return wrapResponse(params, result);
  } catch (err) {
    return wrapResponse(params, { error: 'Kļūda: ' + err.toString() });
  }
}

function wrapResponse(params, data) {
  const json = JSON.stringify(data);
  const callback = params.callback;
  const output = ContentService.createTextOutput(
    callback ? (callback + '(' + json + ');') : json
  );
  output.setMimeType(callback ? ContentService.MimeType.TEXT : ContentService.MimeType.JSON);
  return output;
}

function doPost(e) {
  const params = (e && e.parameter) || {};
  try {
    let data;
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (params.data) {
      data = JSON.parse(params.data);
    } else {
      return wrapResponse(params, { error: 'Nav datu' });
    }
    return wrapResponse(params, routeActionData(data));
  } catch (err) {
    return wrapResponse(params, { error: 'Kļūda: ' + err.toString() });
  }
}

function routeActionData(data) {
  const action = data.action;
  try {
    if (action === 'createClient') return handleCreateClient(data);
    if (action === 'createEmployee') return handleCreateEmployee(data);
    if (action === 'updateClient') return handleUpdate(data, 'klienti');
    if (action === 'updateEmployee') return handleUpdate(data, 'darbinieki');
    if (action === 'mark') return handleMark(data);
    if (action === 'createTask') return handleCreateTask(data);
    if (action === 'updateTask') return handleUpdateTask(data);
    return { success: true };
  } catch (err) {
    return { error: 'Kļūda: ' + err.toString() };
  }
}

function handleLoadData() {
  return {
    darbinieki: getSheetData(getSheet('darbinieki')),
    klienti: getSheetData(getSheet('klienti')),
    atzimes: getSheetData(getSheet('atzimes')),
    atzimes_log: getSheetData(getSheet('atzimes_log')),
    uzdevomi: getSheetData(getSheet('uzdevomi')),
    success: true
  };
}

function handleCreateClient(data) {
  const sheet = getSheet('klienti');
  const c = data.data;

  const existing = findRow(sheet, [
    ['vards', c.vards || ''],
    ['uzvards', c.uzvards || '']
  ]);
  if (existing) {
    return { error: 'Klients ar šo vārdu un uzvārdu jau pastāv', existingId: existing.row };
  }

  const id = 'c_' + Date.now();
  appendRow(sheet, {
    id: id,
    vards: c.vards || '',
    uzvards: c.uzvards || '',
    dzimsanas_datums: c.dzimis || c.dzimsanas_datums || '',
    dieta: c.dieta || '',
    saskarsmes_ipatnibas: c.saskarsmes || c.saskarsmes_ipatnibas || '',
    aktivs: true
  });
  return { success: true, id: id };
}

function handleCreateEmployee(data) {
  const sheet = getSheet('darbinieki');
  const e = data.data;

  const existing = findRow(sheet, [
    ['vards', e.vards || ''],
    ['uzvards', e.uzvards || ''],
    ['loma', e.loma || 'aprūpētājs']
  ]);
  if (existing) {
    return { error: 'Darbinieks ar šo vārdu, uzvārdu un lomu jau pastāv', existingId: existing.row };
  }

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
  return { success: true, id: id };
}

function handleUpdate(data, sheetName) {
  const sheet = getSheet(sheetName);
  const row = findRow(sheet, [['id', data.data.id]]);
  if (!row) return { error: 'Nav atrasts' };
  Object.keys(data.data).forEach(f => {
    if (f !== 'id' && data.data[f] !== undefined) setCellValue(sheet, row.row, f, data.data[f]);
  });
  return { success: true };
}

function handleMark(data) {
  const atzimesSheet = getSheet('atzimes');
  const logSheet = getSheet('atzimes_log');
  const m = data.data;

  ensureColumns(atzimesSheet, ['action_id']);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { error: 'Sistēma ir aizņemta, mēģini vēlreiz' };
  }

  try {
    // Dubultās ieraksta novēršana: ja ir actionId, pārbaudām vai tas jau eksistē
    if (m.actionId) {
      const existingById = findRow(atzimesSheet, [['action_id', m.actionId]]);
      if (existingById) {
        return {
          success: true,
          id: existingById.data.id,
          already_processed: true
        };
      }
    }

    SpreadsheetApp.flush();

    const existingMark = findRow(atzimesSheet, [
      ['klients_id', m.clientId || ''],
      ['darbinieks_id', m.employeeId || ''],
      ['datums', m.date || ''],
      ['periods', m.shift || 'R'],
      ['kategorija', m.category || ''],
      ['lauka_nosaukums', m.field || '']
    ]);

    if (existingMark) {
      const existingLog = findRow(logSheet, [
        ['atzimes_id', existingMark.data.id]
      ]);
      // Ja vērtība ir tā pati, neizveido duplikātu žurnāla ierakstu
      if (existingMark.data.vertiba === m.value) {
        return {
          success: true,
          id: existingMark.data.id,
          already_processed: true,
          logId: existingLog ? existingLog.data.id : null
        };
      }

      // Ja vērtība atšķiras, atjaunojam esošo ierakstu un pievienojam žurnālā
      setCellValue(atzimesSheet, existingMark.row, 'vertiba', m.value);
      setCellValue(atzimesSheet, existingMark.row, 'pedeja_laiks', m.lastModified || formatTimeOnly(new Date()));
      if (m.actionId) setCellValue(atzimesSheet, existingMark.row, 'action_id', m.actionId);
      SpreadsheetApp.flush();

      const now = new Date();
      const logId = 'l_' + now.getTime() + Math.floor(Math.random() * 1000);
      appendRow(logSheet, {
        id: logId,
        atzimes_id: existingMark.data.id,
        klients_id: m.clientId,
        darbinieks_id: m.employeeId,
        datums: formatDate(now),
        laiks: formatTimeOnly(now),
        periods: m.shift || 'R',
        kategorija: m.category,
        lauka_nosaukums: m.field,
        vertiba: m.value,
        izveidots: formatDateTimeLV(now)
      });
      SpreadsheetApp.flush();

      return {
        success: true,
        id: existingMark.data.id,
        already_processed: true,
        updated: true,
        logId: logId
      };
    }

    const id = 'm_' + Date.now();
    // Jauna atzīme: ierakstam ar action_id dubultās ierakstīšanas novēršanai
    appendRow(atzimesSheet, {
      id: id,
      klients_id: m.clientId,
      darbinieks_id: m.employeeId,
      datums: m.date || formatDate(new Date()),
      laiks: formatTimeOnly(new Date()),
      periods: m.shift || 'R',
      kategorija: m.category,
      lauka_nosaukums: m.field,
      vertiba: m.value,
      action_id: m.actionId || ''
    });
    SpreadsheetApp.flush();

    const now = new Date();
    appendRow(logSheet, {
      id: 'l_' + now.getTime() + Math.floor(Math.random() * 1000),
      atzimes_id: id,
      klients_id: m.clientId,
      darbinieks_id: m.employeeId,
      datums: formatDate(now),
      laiks: formatTimeOnly(now),
      periods: m.shift || 'R',
      kategorija: m.category,
      lauka_nosaukums: m.field,
      vertiba: m.value,
      izveidots: formatDateTimeLV(now)
    });
    SpreadsheetApp.flush();

    return { success: true, id: id, already_processed: false };
  } finally {
    lock.releaseLock();
  }
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

  ensureColumns(sheet, ['action_id']);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { error: 'Sistēma ir aizņemta, mēģini vēlreiz' };
  }

  try {
    // Dubultās izveides novēršana: actionId pārbaude pirms pamata lauku pārbaudes
    if (t.actionId) {
      const existingById = findRow(sheet, [['action_id', t.actionId]]);
      if (existingById) {
        return {
          success: true,
          id: existingById.data.id,
          already_processed: true,
          taskId: existingById.data.id
        };
      }
    }

    SpreadsheetApp.flush();

    const existingTask = findRow(sheet, [
      ['teksts', t.teksts || ''],
      ['piešķirt_darbiniekam_id', t.pieskirtDarbiniekamId || t.employeeId || ''],
      ['termins', t.termins || '']
    ]);

    if (existingTask) {
      return {
        success: true,
        id: existingTask.data.id,
        already_processed: true,
        taskId: existingTask.data.id
      };
    }

    const id = 't_' + Date.now();
    // Jauns uzdevums: ierakstam ar action_id dubultās izveides novēršanai
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
      pabeigtajs_id: t.pabeigtajsId || '',
      action_id: t.actionId || ''
    });
    SpreadsheetApp.flush();

    return { success: true, id: id, already_processed: false };
  } finally {
    lock.releaseLock();
  }
}

function handleUpdateTask(data) {
  const sheet = getSheet('uzdevomi');
  const t = data.data;
  const row = findRow(sheet, [['id', t.id]]);
  if (!row) return { error: 'Uzdevums nav atrasts' };
  if (t.statuss !== undefined) setCellValue(sheet, row.row, 'statuss', t.statuss);
  if (t.irPabeigts !== undefined) setCellValue(sheet, row.row, 'pabeigts', t.irPabeigts === true || t.irPabeigts === 'true');
  if (t.pabeigtsLaiks !== undefined) setCellValue(sheet, row.row, 'pabeigts_laiks', t.pabeigtsLaiks || '');
  if (t.pabeigtajsId !== undefined) setCellValue(sheet, row.row, 'pabeigtajs_id', t.pabeigtajsId || '');
  return { success: true };
}

function doOptions(e) {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.JSON);
}

function createResponse(status, data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function formatDate(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function formatTimeOnly(d) {
  return Utilities.formatDate(d, TZ, 'HH:mm:ss');
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
