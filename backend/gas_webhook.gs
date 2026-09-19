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
    if (match) {
      const rowData = {};
      headers.forEach((h, j) => {
        rowData[normalizeKey(h)] = values[i][j];
      });
      return { row: i + 1, data: rowData, headers: headers };
    }
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
      result = handleLoadData(params);
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
  output.setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
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
    if (action === 'ping') return { success: true, pong: true };
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

function handleLoadData(params) {
    // Support optional filtering parameters
    const filters = {
      clientId: params.clientId || '',
      employeeId: params.employeeId || '',
      dateFrom: params.dateFrom || '',
      dateTo: params.dateTo || '',
      limit: params.limit ? parseInt(params.limit) : 0
    };
    
    // Use cached spreadsheet reference to avoid repeated openById calls
    const ss = getSpreadsheet();
    
    // Ensure all sheets have required columns (headers)
    ensureColumns(getSheet('darbinieki'), ['maina_tips']);
    ensureColumns(getSheet('atzimes'), ['action_id']);
    ensureColumns(getSheet('atzimes_log'), ['id', 'atzimes_id', 'klients_id', 'darbinieks_id', 'datums', 'laiks', 'periods', 'kategorija', 'lauka_nosaukums', 'vertiba', 'skaits', 'pedeja_vertiba', 'pedeja_laiks', 'darbinieks_pedejais', 'action_id']);
    ensureColumns(getSheet('uzdevomi'), ['action_id']);
    
    // Load reference data (small, rarely changes)
    const darbinieki = getSheetData(getSheet('darbinieki'));
    const klienti = getSheetData(getSheet('klienti'));
    
    // Load transactional data with optional filtering
    const atzimes = getSheetDataFiltered(getSheet('atzimes'), filters);
    const atzimes_log = getSheetDataFiltered(getSheet('atzimes_log'), filters);
    const uzdevomi = getSheetDataFiltered(getSheet('uzdevomi'), filters);
    
    return {
      darbinieki: darbinieki,
      klienti: klienti,
      atzimes: atzimes,
      atzimes_log: atzimes_log,
      uzdevomi: uzdevomi,
      success: true,
      serverTime: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"),
      filters: filters
    };
  }

  function getSheetDataFiltered(sheet, filters) {
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow === 0 || lastCol === 0) return [];
    
    const range = sheet.getRange(1, 1, lastRow, lastCol);
    const values = range.getValues();
    const headers = values[0].map(h => String(h).trim());
    const rows = [];
    
    // Build column index map once
    const colMap = {};
    headers.forEach((h, i) => { colMap[normalizeKey(h)] = i; });
    
    for (let i = 1; i < values.length; i++) {
      const row = {};
      let hasData = false;
      
      // Check filters early to skip unnecessary processing
      if (filters.clientId && colMap['klients_id'] !== undefined) {
        if (String(values[i][colMap['klients_id']]) !== filters.clientId) continue;
      }
      if (filters.employeeId && colMap['darbinieks_id'] !== undefined) {
        if (String(values[i][colMap['darbinieks_id']]) !== filters.employeeId) continue;
      }
      if (filters.dateFrom && colMap['datums'] !== undefined) {
        const rowDate = String(values[i][colMap['datums']]);
        if (rowDate && rowDate < filters.dateFrom) continue;
      }
      if (filters.dateTo && colMap['datums'] !== undefined) {
        const rowDate = String(values[i][colMap['datums']]);
        if (rowDate && rowDate > filters.dateTo) continue;
      }
      
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
      
      // Respect limit
      if (filters.limit > 0 && rows.length >= filters.limit) break;
    }
    return rows;
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
    parole: e.parole || '',
    maina_tips: e.shiftType || e.maina_tips || 'diennakts'
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

function signatureFieldAlias(field) {
  if (field === 'r_paraksts' || field === 'v_paraksts') return 'aprupetaja_paraksts';
  return field;
}

function buildLogRow(headers, colMap, data) {
  const row = new Array(headers.length).fill('');
  Object.keys(data).forEach(k => {
    const nk = normalizeKey(k);
    const idx = colMap[nk];
    if (idx !== undefined) {
      let v = data[k];
      if (v instanceof Date) {
        if (nk === 'laiks') {
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
  return row;
}

function handleMark(data) {
  const atzimesSheet = getSheet('atzimes');
  const logSheet = getSheet('atzimes_log');
  const m = data.data;

  // Normalize signature field names to canonical 'aprupetaja_paraksts'
  // (shift R/V is already distinguished by the 'periods' column).
  const mFieldNormalized = signatureFieldAlias(m.field || '');
  m.field = mFieldNormalized;

  ensureColumns(atzimesSheet, ['action_id']);
  ensureColumns(logSheet, ['id', 'atzimes_id', 'klients_id', 'darbinieks_id', 'datums', 'laiks', 'periods', 'kategorija', 'lauka_nosaukums', 'vertiba', 'skaits', 'pedeja_vertiba', 'pedeja_laiks', 'darbinieks_pedejais', 'action_id']);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { error: 'Sistēma ir aizņemta, mēģini vēlreiz' };
  }

  try {
    // Get all data at once to minimize API calls
    const atzimesLastRow = atzimesSheet.getLastRow();
    const logLastRow = logSheet.getLastRow();
    
    // Build column maps once
    const atzimesHeaders = atzimesSheet.getRange(1, 1, 1, atzimesSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const logHeaders = logSheet.getRange(1, 1, 1, logSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const atzimesColMap = {};
    const logColMap = {};
    atzimesHeaders.forEach((h, i) => { atzimesColMap[normalizeKey(h)] = i; });
    logHeaders.forEach((h, i) => { logColMap[normalizeKey(h)] = i; });
    
    // Read all data at once
    const atzimesData = atzimesLastRow > 1 ? atzimesSheet.getRange(2, 1, atzimesLastRow - 1, atzimesHeaders.length).getValues() : [];
    const logData = logLastRow > 1 ? logSheet.getRange(2, 1, logLastRow - 1, logHeaders.length).getValues() : [];

    // Dubultās ieraksta novēršana: ja ir actionId, pārbaudām vai tas jau eksistē
    if (m.actionId && atzimesColMap['action_id'] !== undefined) {
      for (let i = 0; i < atzimesData.length; i++) {
        if (String(atzimesData[i][atzimesColMap['action_id']]) === String(m.actionId)) {
          return {
            success: true,
            id: atzimesData[i][atzimesColMap['id']],
            already_processed: true
          };
        }
      }
    }

    // Find existing mark in memory
    let existingMarkRow = -1;
    let existingMarkValue = '';
    for (let i = 0; i < atzimesData.length; i++) {
      if (String(atzimesData[i][atzimesColMap['klients_id']]) === String(m.clientId || '') &&
          String(atzimesData[i][atzimesColMap['darbinieks_id']]) === String(m.employeeId || '') &&
          String(atzimesData[i][atzimesColMap['datums']]) === String(m.date || '') &&
          String(atzimesData[i][atzimesColMap['periods']]) === String(m.shift || 'R') &&
          String(atzimesData[i][atzimesColMap['kategorija']]) === String(m.category || '') &&
          String(atzimesData[i][atzimesColMap['lauka_nosaukums']]) === String(m.field || '')) {
        existingMarkRow = i + 2; // +2 because data starts at row 2 (1-indexed, plus header)
        existingMarkValue = String(atzimesData[i][atzimesColMap['vertiba']]);
        break;
      }
    }

    // Parse timestamp from frontend (UTC ISO string) and convert to Europe/Riga
    let lastModifiedRiga;
    if (m.lastModified) {
      const frontendTime = new Date(m.lastModified);
      if (!isNaN(frontendTime.getTime())) {
        lastModifiedRiga = Utilities.formatDate(frontendTime, TZ, 'HH:mm:ss');
      }
    }
    if (!lastModifiedRiga) {
      lastModifiedRiga = formatTimeOnly(new Date());
    }

    // Parse timestamp for log entry
    let logDateTimeRiga;
    if (m.lastModified) {
      const frontendTime = new Date(m.lastModified);
      if (!isNaN(frontendTime.getTime())) {
        logDateTimeRiga = Utilities.formatDate(frontendTime, TZ, "yyyy-MM-dd'T'HH:mm:ss");
      }
    }
    if (!logDateTimeRiga) {
      logDateTimeRiga = formatDateTimeLV(new Date());
    }

    const updates = []; // Batch updates to apply at once
    
    if (existingMarkRow > 0) {
      // Ja vērtība ir tā pati, neizveido duplikātu žurnāla ierakstu
      if (existingMarkValue === String(m.value)) {
        return {
          success: true,
          id: atzimesData[existingMarkRow - 2][atzimesColMap['id']],
          already_processed: true,
          logId: null
        };
      }

      // Batch updates for existing mark
      if (atzimesColMap['vertiba'] !== undefined) updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['vertiba'] + 1, value: m.value });
      if (atzimesColMap['pedeja_laiks'] !== undefined) updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['pedeja_laiks'] + 1, value: lastModifiedRiga });
      if (m.actionId && atzimesColMap['action_id'] !== undefined) updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['action_id'] + 1, value: m.actionId });
      
      const markId = atzimesData[existingMarkRow - 2][atzimesColMap['id']];
      
      // Prepare log entry
      const logId = 'l_' + Date.now() + Math.floor(Math.random() * 1000);
      const logRowData = {
        id: logId,
        atzimes_id: markId,
        klients_id: m.clientId,
        darbinieks_id: m.employeeId,
        datums: formatDate(new Date()),
        laiks: lastModifiedRiga,
        periods: m.shift || 'R',
        kategorija: m.category,
        lauka_nosaukums: m.field,
        vertiba: m.value,
        skaits: logDateTimeRiga,
        pedeja_vertiba: existingMarkValue,
        pedeja_laiks: logDateTimeRiga,
        darbinieks_pedejais: m.employeeId,
        action_id: m.actionId || ''
      };
      const logRow = buildLogRow(logHeaders, logColMap, logRowData);
      
      // Apply all updates at once
      updates.forEach(u => u.sheet.getRange(u.row, u.col).setValue(u.value));
      
      // Append log row
      if (logData.length > 0) {
        logSheet.getRange(logLastRow + 1, 1, 1, logHeaders.length).setValues([logRow]);
      } else {
        logSheet.getRange(2, 1, 1, logHeaders.length).setValues([logRow]);
      }
      
      SpreadsheetApp.flush();

      return {
        success: true,
        id: markId,
        already_processed: true,
        updated: true,
        logId: logId
      };
    }

    // New mark - prepare both rows and write at once
    const id = 'm_' + Date.now();
    const markRow = new Array(atzimesHeaders.length).fill('');
    atzimesHeaders.forEach((h, i) => {
      const nk = normalizeKey(h);
      if (nk === 'id') markRow[i] = id;
      else if (nk === 'klients_id') markRow[i] = m.clientId;
      else if (nk === 'darbinieks_id') markRow[i] = m.employeeId;
      else if (nk === 'datums') markRow[i] = m.date || formatDate(new Date());
      else if (nk === 'laiks') markRow[i] = lastModifiedRiga;
      else if (nk === 'periods') markRow[i] = m.shift || 'R';
      else if (nk === 'kategorija') markRow[i] = m.category;
      else if (nk === 'lauka_nosaukums') markRow[i] = m.field;
      else if (nk === 'vertiba') markRow[i] = m.value;
      else if (nk === 'pedeja_laiks') markRow[i] = lastModifiedRiga;
      else if (nk === 'darbinieks_pedejais') markRow[i] = m.employeeId;
      else if (nk === 'action_id') markRow[i] = m.actionId || '';
    });

    const logId = 'l_' + Date.now() + Math.floor(Math.random() * 1000);
    const logRowData = {
      id: logId,
      atzimes_id: id,
      klients_id: m.clientId,
      darbinieks_id: m.employeeId,
      datums: formatDate(new Date()),
      laiks: lastModifiedRiga,
      periods: m.shift || 'R',
      kategorija: m.category,
      lauka_nosaukums: m.field,
      vertiba: m.value,
      skaits: logDateTimeRiga,
      pedeja_laiks: logDateTimeRiga,
      darbinieks_pedejais: m.employeeId,
      action_id: m.actionId || ''
    };
    const logRow = buildLogRow(logHeaders, logColMap, logRowData);

    // Write both rows at once
    atzimesSheet.getRange(atzimesLastRow + 1, 1, 1, atzimesHeaders.length).setValues([markRow]);
    if (logData.length > 0) {
      logSheet.getRange(logLastRow + 1, 1, 1, logHeaders.length).setValues([logRow]);
    } else {
      logSheet.getRange(2, 1, 1, logHeaders.length).setValues([logRow]);
    }
    
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

    const id = t.id || 't_' + Date.now();
    // Jauns uzdevums: ierakstam ar action_id dubultās izveides novēršanai
    // Convert UTC timestamp from frontend to Europe/Riga
    let izveidotsRiga = '';
    if (t.izveidots) {
      const frontendTime = new Date(t.izveidots);
      if (!isNaN(frontendTime.getTime())) {
        izveidotsRiga = Utilities.formatDate(frontendTime, TZ, "yyyy-MM-dd'T'HH:mm:ss");
      }
    }
    if (!izveidotsRiga) {
      izveidotsRiga = formatDateTimeLV(new Date());
    }
    appendRow(sheet, {
      id: id,
      teksts: t.teksts || '',
      klients_id: t.klientsId || t.clientId || '',
      'piešķirt_darbiniekam_id': t.pieskirtDarbiniekamId || t.employeeId || '',
      termins: t.termins || '',
      prioritate: t.prioritate || 'videja',
      statuss: t.statuss || 'jauns',
      pabeigts: t.irPabeigts === true || t.irPabeigts === 'true',
      izveidots: izveidotsRiga,
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
  if (t.pabeigtsLaiks !== undefined) {
    // Convert UTC ISO string from frontend to Europe/Riga timezone
    let pabeigtsLaiksRiga = '';
    if (t.pabeigtsLaiks) {
      const frontendTime = new Date(t.pabeigtsLaiks);
      if (!isNaN(frontendTime.getTime())) {
        pabeigtsLaiksRiga = Utilities.formatDate(frontendTime, TZ, "yyyy-MM-dd'T'HH:mm:ss");
      }
    }
    setCellValue(sheet, row.row, 'pabeigts_laiks', pabeigtsLaiksRiga || '');
  }
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
