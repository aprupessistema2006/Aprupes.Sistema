const SHEET_ID = '1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E';
const TZ = 'Europe/Riga';

function formatSheetDateValue(headerKey, value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return value;
  if (headerKey === 'laiks') {
    return Utilities.formatDate(value, TZ, 'HH:mm:ss');
  }
  if ([
    'notikuma_laiks',
    'eventtime',
    'event_time',
    'skaits',
    'pedeja_laiks',
    'pedejais_laiks',
    'izveidots',
    'pabeigts_laiks'
  ].includes(headerKey)) {
    return Utilities.formatDate(value, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return Utilities.formatDate(value, TZ, 'yyyy-MM-dd');
}

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
        row[headerKey] = formatSheetDateValue(headerKey, v);
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
        v = formatSheetDateValue(normalizeKey(k), v);
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
      v = formatSheetDateValue(normalizeKey(canonicalField), v);
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
    if (action === 'ping') return { success: true, pong: true, version: '20260927-1730' };
    if (action === 'check_retry_not_allowed') return handleCheckRetryNotAllowed(data);
    if (action === 'createClient') return handleCreateClient(data);
    if (action === 'createEmployee') return handleCreateEmployee(data);
    if (action === 'updateClient') return handleUpdate(data, 'klienti');
    if (action === 'updateEmployee') return handleUpdate(data, 'darbinieki');
    if (action === 'mark') return handleMark(data);
  if (action === 'setShift') return handleSetShift(data);
    if (action === 'createTask') return handleCreateTask(data);
    if (action === 'updateTask') return handleUpdateTask(data);
    return { success: true };
  } catch (err) {
    return { error: 'Kļūda: ' + err.toString() };
  }
}

// --- operation_registry infrastruktūra ---

// Izveido operation_registry lapu, ja tā neeksistē, un nodrošina kolonnas.
// Esošie dati netiek skarti — kolonnas pievieno tikai ja trūc.
function initOperationRegistry() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName('operation_registry');
  if (!sheet) {
    sheet = ss.insertSheet('operation_registry');
  }
  ensureColumns(sheet, [
    'operation_id', 'employee_id', 'action_type', 'record_id',
    'record_version', 'created_at', 'result', 'official_record_id',
    'status_code', 'deduplication_valid_until', 'replacement_op_id'
  ]);
  return sheet;
}

// Atgriež operation_registry ierakstu pēc operation_id, ja nav — null.
function findOperation(operationId) {
  const sheet = initOperationRegistry();
  return findRow(sheet, [['operation_id', operationId]]);
}

// Reģistrē jaunu operāciju operation_registry, ja tāda vēl nepastāv.
// Atgriež { registered: true, row: { ... } } ja jauns, vai { registered: false, row: { ... } } ja eksistējoša.
function registerOperation(operationId, employeeId, actionType, recordId, recordVersion) {
  const sheet = initOperationRegistry();
  const existing = findRow(sheet, [['operation_id', operationId]]);
  if (existing) {
    return { registered: false, row: existing.data, rowNum: existing.row };
  }
  const now = new Date();
  const dedupUntil = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000); // 180 dienas
  appendRow(sheet, {
    operation_id: operationId,
    employee_id: employeeId || '',
    action_type: actionType || '',
    record_id: recordId || '',
    record_version: recordVersion || '',
    created_at: formatDateTimeLV(now),
    result: '',
    official_record_id: '',
    status_code: '',
    deduplication_valid_until: formatDateTimeLV(dedupUntil),
    replacement_op_id: ''
  });
  return { registered: true, row: null, rowNum: sheet.getLastRow() };
}

// Atjaunina operation_registry ieraksta rezultātu pēc apstrādes.
function updateOperationResult(operationId, resultObj) {
  if (!operationId) return;
  const found = findOperation(operationId);
  if (!found) return;
  if (resultObj.result) setCellValue(getSheet('operation_registry'), found.row, 'result', resultObj.result);
  if (resultObj.officialRecordId) setCellValue(getSheet('operation_registry'), found.row, 'official_record_id', resultObj.officialRecordId);
  if (resultObj.statusCode) setCellValue(getSheet('operation_registry'), found.row, 'status_code', resultObj.statusCode);
  if (resultObj.replacementOpId) setCellValue(getSheet('operation_registry'), found.row, 'replacement_op_id', resultObj.replacementOpId);
}

// Read-only pārbaude: vai operationId var manuāli atkārtot?
function handleCheckRetryNotAllowed(data) {
  const params = data.data || data;
  const operationId = params.operationId || params.operation_id;
  if (!operationId) {
    return { error: 'operationId nav norādīts' };
  }

  const found = findOperation(operationId);

  // Ja serveris nekad nav redzējis šo operationId → droši var atkārtot
  if (!found) {
    return { can_retry: true, reason: 'never_received' };
  }

  const result = String(found.data.result || '').trim().toLowerCase();
  const dedupUntil = found.data.deduplication_valid_until;

  // Ja ir vieglais results — neatkārtot (accepted/rejected ir galīgi)
  if (result === 'accepted' || result === 'rejected') {
    return { can_retry: false, result: result };
  }

  // Ja result ir blocked/conflict/error — var atkārtot (apstākļi varēja mainīties)
  if (result === 'blocked' || result === 'conflict' || result === 'error') {
    return { can_retry: true, reason: result };
  }

  // Ja deduplizācijas periods vēl spēkā — neeksistē galīgais results
  if (dedupUntil) {
    const dedupDate = parseTimestamp(dedupUntil);
    if (dedupDate && new Date() < dedupDate) {
      // Operācija vēl ir aktīvā deduplikācijas periodā
      return { can_retry: true, reason: 'dedup_window_active' };
    }
  }

  // Periods ir pagājis, results nav galīgs → server lemj vai atkārtot
  return { can_retry: true, reason: 'dedup_expired' };
}


// Lāžņu ielāde, kas negaida Timeout lielu datu apjomu gadījumā.
// mode=bootstrap -> tikai nelielas tabulas (darbinieki, klienti, uzdevomi) + rindu skaits
// mode=marks    -> atzimes/atzimes_log pa blokiem (markOffset/logOffset/limit)
// mode=range    -> atzimes/atzimes_log ar filtru (clientId/dateFrom/dateTo/limit/offset)
function handleLoadData(params) {
    const mode = String(params.mode || '').toLowerCase();
    const filters = {
      clientId: params.clientId || '',
      employeeId: params.employeeId || '',
      dateFrom: params.dateFrom || '',
      dateTo: params.dateTo || '',
      limit: params.limit ? parseInt(params.limit, 10) : 0,
      offset: params.offset ? parseInt(params.offset, 10) : 0
    };
    if (isNaN(filters.limit) || filters.limit < 0) filters.limit = 0;
    if (isNaN(filters.offset) || filters.offset < 0) filters.offset = 0;

    // Use cached spreadsheet reference to avoid repeated openById calls
    getSpreadsheet();
    
    // Ensure all sheets have required columns (headers)
    ensureColumns(getSheet('darbinieki'), ['maina_tips', 'version']);
    ensureColumns(getSheet('klienti'), ['slimnica', 'statuss', 'statusa_laiks', 'statusa_darbinieks_id', 'version']);
    ensureColumns(getSheet('atzimes'), ['action_id', 'maina_tips', 'notikuma_laiks', 'version']);
    ensureColumns(getSheet('atzimes_log'), ['id', 'atzimes_id', 'klients_id', 'darbinieks_id', 'datums', 'laiks', 'periods', 'kategorija', 'lauka_nosaukums', 'vertiba', 'skaits', 'notikuma_laiks', 'pedeja_vertiba', 'pedeja_laiks', 'darbinieks_pedejais', 'action_id', 'maina_tips']);
    ensureColumns(getSheet('uzdevomi'), ['action_id', 'version']);
    
    const serverTime = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
    
    if (mode === 'marks') {
      return handleLoadMarksPaged(filters, serverTime);
    }
    
    if (mode === 'range') {
      return handleLoadMarksRange(filters, serverTime);
    }
    
    // mode=bootstrap vai nav režīma -> tikai nelielās tabulas + skaitļi
    const counts = getSheetCounts();
    const isFiltered = !!(filters.clientId || filters.employeeId || filters.dateFrom || filters.dateTo);
    
    if (isFiltered) {
      // Vecais filtrētais ceļš - ja tiek prasīts konkrēts klients/datums
      return {
        darbinieki: getSheetData(getSheet('darbinieki')),
        klienti: getSheetData(getSheet('klienti')),
        atzimes: getSheetDataFiltered(getSheet('atzimes'), filters),
        atzimes_log: getSheetDataFiltered(getSheet('atzimes_log'), filters),
        uzdevomi: getSheetDataFiltered(getSheet('uzdevomi'), filters),
        counts: counts,
        success: true,
        serverTime: serverTime,
        filters: filters
      };
    }
    
    return {
      darbinieki: getSheetData(getSheet('darbinieki')),
      klienti: getSheetData(getSheet('klienti')),
      uzdevomi: getSheetData(getSheet('uzdevomi')),
      counts: counts,
      bootstrap: true,
      success: true,
      serverTime: serverTime,
      filters: filters
    };
  }
  
  // Rindu skaiti, bez datu nolasīšanas (ātri)
  function getSheetCounts() {
    return {
      darbinieki: getDataRowCount(getSheet('darbinieki')),
      klienti: getDataRowCount(getSheet('klienti')),
      atzimes: getDataRowCount(getSheet('atzimes')),
      atzimes_log: getDataRowCount(getSheet('atzimes_log')),
      uzdevomi: getDataRowCount(getSheet('uzdevomi'))
    };
  }
  
  function getDataRowCount(sheet) {
    if (!sheet) return 0;
    const lastRow = sheet.getLastRow();
    return lastRow > 1 ? lastRow - 1 : 0;
  }
  
  // Nolasīt noteiktu rindu diapazonu (0-based offset, izmantojam datu rindas, nevis galvene)
  function readSlice(sheet, offset, limit) {
    if (!sheet) return { rows: [], next: offset || 0, total: 0 };
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const total = lastRow > 1 ? lastRow - 1 : 0;
    if (total === 0 || lastCol === 0) return { rows: [], next: offset || 0, total: total };
    
    const start = 1 + (offset || 0) + 1; // +1 galvene, +1 uz datu rindu
    if (start > lastRow) return { rows: [], next: offset || 0, total: total };
    
    const numRows = Math.min(limit > 0 ? limit : 3000, lastRow - start + 1);
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    const values = sheet.getRange(start, 1, numRows, lastCol).getValues();
    const rows = [];
    
    for (let i = 0; i < values.length; i++) {
      const row = {};
      let hasData = false;
      for (let j = 0; j < headers.length; j++) {
        const v = values[i][j];
        if (v !== '' && v !== null && v !== undefined) hasData = true;
        const hk = normalizeKey(headers[j]);
        row[hk] = v instanceof Date ? formatSheetDateValue(hk, v) : v;
      }
      if (hasData) rows.push(row);
    }
    
    // Nākamais offset pēc NOLASĪTĀJU rindu, nevis pēc saglabāto (stabila lapošana)
    return { rows: rows, next: (offset || 0) + values.length, total: total };
  }
  
  // mode=marks - pa blokiem, bez filtriem
  function handleLoadMarksPaged(filters, serverTime) {
    const limit = filters.limit > 0 ? Math.min(filters.limit, 5000) : 3000;
    const markOffset = filters.offset > 0 ? filters.offset : 0;
    const marks = readSlice(getSheet('atzimes'), markOffset, limit);
    const logSlice = readSlice(getSheet('atzimes_log'), markOffset, limit);
    
    return {
      atzimes: marks.rows,
      atzimes_log: logSlice.rows,
      markNext: marks.next,
      markTotal: marks.total,
      logNext: logSlice.next,
      logTotal: logSlice.total,
      done: marks.next >= marks.total && logSlice.next >= logSlice.total,
      success: true,
      serverTime: serverTime
    };
  }
  // mode=range - ar filtru (konkrēts klients / datumu diapazons)
  function handleLoadMarksRange(filters, serverTime) {
    const limit = filters.limit > 0 ? Math.min(filters.limit, 5000) : 2000;
    const offset = filters.offset > 0 ? filters.offset : 0;
    
    const marks = readFilteredSlice(getSheet('atzimes'), filters, offset, limit);
    const logSlice = readFilteredSlice(getSheet('atzimes_log'), filters, offset, limit);
    
    return {
      atzimes: marks.rows,
      atzimes_log: logSlice.rows,
      nextOffset: marks.nextOffset,
      totalMatched: marks.totalMatched,
      logNextOffset: logSlice.nextOffset,
      logTotalMatched: logSlice.totalMatched,
      done: marks.done && logSlice.done,
      success: true,
      serverTime: serverTime
    };
  }
  
  // Effektīva filtrēta nolasīšana: vispirms tikai filtra kolonnas, tad pilnās rindas
  function readFilteredSlice(sheet, filters, offset, limit) {
    const empty = { rows: [], nextOffset: offset, totalMatched: offset };
    if (!sheet) return empty;
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return empty;
    
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => normalizeKey(h));
    const idxClient = headers.indexOf('klients_id');
    const idxEmp = headers.indexOf('darbinieks_id');
    const idxDate = headers.indexOf('datums');
    
    const needClient = !!filters.clientId && idxClient >= 0;
    const needEmp = !!filters.employeeId && idxEmp >= 0;
    const needDate = (filters.dateFrom || filters.dateTo) && idxDate >= 0;
    
    // Bez filtriem - lasīt tieši
    if (!needClient && !needEmp && !needDate) {
      const slice = readSlice(sheet, offset, limit);
      const done = slice.next >= slice.total;
      return { rows: slice.rows, nextOffset: slice.next, done: done, totalMatched: slice.total };
    }
    
    // 1. Filtra kolonnu skenēšana partijās (daudz mazāk šūnu nekā pilnas rindas)
    const BATCH = 2000;
    const matchRows = [];
    let exhausted = true;
    for (let s = 2; s <= lastRow; s += BATCH) {
      const n = Math.min(BATCH, lastRow - s + 1);
      const cVals = needClient ? sheet.getRange(s, idxClient + 1, n, 1).getValues() : null;
      const eVals = needEmp ? sheet.getRange(s, idxEmp + 1, n, 1).getValues() : null;
      const dVals = needDate ? sheet.getRange(s, idxDate + 1, n, 1).getValues() : null;
      
      for (let i = 0; i < n; i++) {
        if (needClient && String(cVals[i][0]).trim() !== filters.clientId) continue;
        if (needEmp && String(eVals[i][0]).trim() !== filters.employeeId) continue;
        if (needDate) {
          const d = normalizeDateCell(dVals[i][0]);
          if (!d) continue;
          if (filters.dateFrom && d < filters.dateFrom) continue;
          if (filters.dateTo && d > filters.dateTo) continue;
        }
        matchRows.push(s + i);
        if (matchRows.length >= offset + limit) break;
      }
      if (matchRows.length >= offset + limit) { exhausted = false; break; }
    }
    
    const totalMatched = exhausted ? matchRows.length : Infinity;
    const page = matchRows.slice(offset, offset + limit);
    if (page.length === 0) {
      return { rows: [], nextOffset: offset, done: true, totalMatched: totalMatched };
    }
    
    // 2. Pilno rindu nolasīšana tikai atrastajām
    const rows = [];
    for (let k = 0; k < page.length; k += 200) {
      const group = page.slice(k, k + 200);
      // Group contiguous runs into single range reads
      let runStart = group[0], runEnd = group[0];
      for (let g = 1; g <= group.length; g++) {
        const isContig = g < group.length && group[g] === runEnd + 1;
        if (isContig) { runEnd = group[g]; continue; }
        const block = sheet.getRange(runStart, 1, runEnd - runStart + 1, lastCol).getValues();
        for (let b = 0; b < block.length; b++) {
          const row = {};
          let hasData = false;
          for (let j = 0; j < headers.length; j++) {
            const v = block[b][j];
            if (v !== '' && v !== null && v !== undefined) hasData = true;
            const hk = normalizeKey(headers[j]);
            row[hk] = v instanceof Date ? formatSheetDateValue(hk, v) : v;
          }
          if (hasData) rows.push(row);
        }
        if (g < group.length) { runStart = group[g]; runEnd = group[g]; }
      }
    }
    
    return { rows: rows, nextOffset: offset + page.length, done: exhausted || page.length < limit, totalMatched: totalMatched };
  }
  
  function normalizeDateCell(v) {
    if (!v) return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    }
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    return s;
  }
  
  function getSheetDataFiltered(sheet, filters) {
    const result = readFilteredSlice(sheet, filters, 0, filters.limit > 0 ? filters.limit : 5000);
    return result.rows;
  }

function handleCreateClient(data) {
  const sheet = getSheet('klienti');
  ensureColumns(sheet, ['version']);
  const c = data.data;
  const operationId = c.operationId || c.operation_id;
  const employeeId = c.employeeId || c.employeeID || c.darbinieksId || '';

  // operation_registry dedup (spec 12.2)
  if (operationId) {
    const opFound = findOperation(operationId);
    if (opFound) {
      const opResult = String(opFound.data.result || '').trim().toLowerCase();
      if (opResult === 'accepted') {
        return { accepted: true, already_processed: true, id: opFound.data.official_record_id || undefined };
      }
      if (opResult === 'rejected') {
        return { rejected: true, already_processed: true };
      }
    } else {
      registerOperation(operationId, employeeId, 'createClient', null, '');
    }
  }

  const existing = findRow(sheet, [
    ['vards', c.vards || ''],
    ['uzvards', c.uzvards || '']
  ]);
  if (existing) {
    if (operationId) {
      updateOperationResult(operationId, {
        result: 'rejected',
        statusCode: 409
      });
    }
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
    aktivs: true,
    version: 1
  });
  if (operationId) {
    updateOperationResult(operationId, {
      result: 'accepted',
      officialRecordId: id,
      statusCode: 200
    });
  }
  return { success: true, id: id, accepted: true };
}

function handleCreateEmployee(data) {
  const sheet = getSheet('darbinieki');
  ensureColumns(sheet, ['version']);
  const e = data.data;
  const operationId = e.operationId || e.operation_id;
  const employeeId = e.employeeId || e.employeeID || e.darbinieksId || '';

  // operation_registry dedup (spec 12.2)
  if (operationId) {
    const opFound = findOperation(operationId);
    if (opFound) {
      const opResult = String(opFound.data.result || '').trim().toLowerCase();
      if (opResult === 'accepted') {
        return { accepted: true, already_processed: true, id: opFound.data.official_record_id || undefined };
      }
      if (opResult === 'rejected') {
        return { rejected: true, already_processed: true };
      }
    } else {
      registerOperation(operationId, employeeId, 'createEmployee', null, '');
    }
  }

  const existing = findRow(sheet, [
    ['vards', e.vards || ''],
    ['uzvards', e.uzvards || ''],
    ['loma', e.loma || 'aprūpētājs']
  ]);
  if (existing) {
    if (operationId) {
      updateOperationResult(operationId, {
        result: 'rejected',
        statusCode: 409
      });
    }
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
    maina_tips: e.shiftType || e.maina_tips || 'diennakts',
    version: 1
  });
  if (operationId) {
    updateOperationResult(operationId, {
      result: 'accepted',
      officialRecordId: id,
      statusCode: 200
    });
  }
  return { success: true, id: id, accepted: true };
}

function handleUpdate(data, sheetName) {
  const sheet = getSheet(sheetName);
  ensureColumns(sheet, ['version']);
  if (sheetName === 'klienti') {
    ensureColumns(sheet, ['slimnica', 'statuss', 'statusa_laiks', 'statusa_darbinieks_id']);
  }
  const operationId = data.data.operationId || data.data.operation_id;

  // operation_registry dedup (spec 12.2) — check pirms jebkāri mainījumiem
  if (operationId) {
    const opFound = findOperation(operationId);
    if (opFound) {
      const opResult = String(opFound.data.result || '').trim().toLowerCase();
      if (opResult) {
        if (opResult === 'accepted') {
          return { accepted: true, already_processed: true };
        }
        if (opResult === 'conflict') {
          return { conflict: true, already_processed: true };
        }
        if (opResult === 'rejected') {
          return { rejected: true, already_processed: true };
        }
        if (opResult === 'error') {
          return { error: 'Operation previously failed on server', already_processed: true };
        }
      }
    } else {
      const recordRow = findRow(sheet, [['id', data.data.id]]);
      registerOperation(operationId, data.data.employeeId || data.data.employeeID || '',
        'update' + sheetName, data.data.id, recordRow ? recordRow.data.version : '');
    }
  }

  const row = findRow(sheet, [['id', data.data.id]]);
  if (!row) {
    if (operationId) {
      updateOperationResult(operationId, {
        result: 'rejected',
        statusCode: 404
      });
    }
    return { error: 'Nav atrasts' };
  }

  // OCC: ja klients nosūtījis recordVersion, salīdzina ar servera versiju
  const clientVersion = data.data.recordVersion || data.data.version;
  const colMap = {};
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  headers.forEach((h, i) => { colMap[normalizeKey(h)] = i; });
  const versionCol = colMap['version'];
  if (clientVersion !== undefined && clientVersion !== '' && versionCol !== undefined) {
    const serverVersion = row.data.version;
    const serverVerNum = parseInt(serverVersion, 10);
    const clientVerNum = parseInt(clientVersion, 10);
    if (!isNaN(serverVerNum) && !isNaN(clientVerNum) && serverVerNum !== clientVerNum) {
      // Conflict — servera versija nesakrīt ar klienta
      if (data.data.operationId) {
        updateOperationResult(data.data.operationId, {
          result: 'conflict',
          statusCode: 409,
          officialRecordId: row.data.id
        });
      }
      return {
        conflict: true,
        success: false,
        error: 'Konflikts: ieraksts ir mainījies kļūdos.',
        serverVersion: serverVerNum,
        recordId: row.data.id
      };
    }
  }

  Object.keys(data.data).forEach(f => {
    if (f !== 'id' && f !== 'operationId' && f !== 'operation_id' && f !== 'recordVersion' && f !== 'version') {
      if (data.data[f] !== undefined) setCellValue(sheet, row.row, f, data.data[f]);
    }
  });

  // Increment version column
  let currentVersion = 1;
  if (versionCol !== undefined) {
    currentVersion = parseInt(row.data.version, 10);
    setCellValue(sheet, row.row, 'version', isNaN(currentVersion) ? 1 : currentVersion + 1);
  }

   if (operationId) {
     updateOperationResult(operationId, {
       result: 'accepted',
       officialRecordId: row.data.id || data.data.id,
       statusCode: 200
     });
   }
   return { success: true, accepted: true, serverVersion: isNaN(currentVersion) ? 1 : currentVersion + 1, recordVersion: isNaN(currentVersion) ? 1 : currentVersion + 1 };
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
        v = formatSheetDateValue(nk, v);
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

// ───────────────────────────────────────────────────────────────────────
// MAIŅAS TIPS — atsevišķa, viegla darbība.
//
// Kāpēc nevis handleUpdate? handleUpdate raksta VISUS nosūtītos laukus un
// palielina `version` kolonnu. Maiņa tips to nedrīkst darīt: `version` ir
// OCC (optimistiskās sinhronizācijas) mehānisma pamatā, un tā ieslēgtība
// šeit radītu konfliktus administratora darbinieku rediģēšanā, neizmantojot
// neko labu.
//
// Kāpēc bez globālas slēdzena? Tā ir viena šūnas rakstīšana. Slēdzene
// serializētu šo ar katru aprūpes atzīmi, kuras ir daudz svarīgākas, un
// ar 200 klientiem rindas kļūtu garāka nevis īsāka.
//
// Kļūda ir NEKritiska: maiņas tips jau ceļo līdz katrai atzīmei, tāpēc
// ja šis rakstījums neizdodas, nekas netiek zaudēts.
// ───────────────────────────────────────────────────────────────────────
function handleSetShift(data) {
  const d = (data && data.data) || data || {};
  const empId = d.employeeId || d.employee_id || d.id;
  const shift = String(d.maina_tips || d.mainaTips || '').trim().toLowerCase();

  if (!empId) return { success: false, error: 'Nav darbinieka id' };
  // Tikai divas atļautās vērtības. Viss pārējais tiek noraidīts, nevis
  // rakstīts, lai neprecīzi dati nekad nenonāk tabulā.
  if (shift !== 'diennakts' && shift !== 'dienas') {
    return { success: false, error: 'Nezinams maiņas tips: ' + shift };
  }

  const sheet = getSheet('darbinieki');
  ensureColumns(sheet, ['maina_tips']);
  const row = findRow(sheet, [['id', empId]]);
  if (!row) {
    return { success: false, error: 'Darbinieks nav atrasts', employeeId: empId };
  }

  const current = String(row.data.maina_tips || '').trim().toLowerCase();
  if (current === shift) {
    return { success: true, changed: false, maina_tips: shift, employeeId: empId };
  }

  setCellValue(sheet, row.row, 'maina_tips', shift);
  return { success: true, changed: true, maina_tips: shift, employeeId: empId };
}

function handleMark(data) {
  const atzimesSheet = getSheet('atzimes');
  const logSheet = getSheet('atzimes_log');
  const klientiSheet = getSheet('klienti');
  const m = data.data;
  const operationId = m.operationId || m.operation_id;

  // Normalize signature field names to canonical 'aprupetaja_paraksts'
  // (shift R/V is already distinguished by the 'periods' column).
  const mFieldNormalized = signatureFieldAlias(m.field || '');
  m.field = mFieldNormalized;

  ensureColumns(atzimesSheet, ['action_id', 'maina_tips', 'notikuma_laiks', 'last_modified', 'version']);
  ensureColumns(logSheet, ['id', 'atzimes_id', 'klients_id', 'darbinieks_id', 'datums', 'laiks', 'periods', 'kategorija', 'lauka_nosaukums', 'vertiba', 'skaits', 'notikuma_laiks', 'pedeja_vertiba', 'pedeja_laiks', 'darbinieks_pedejais', 'action_id', 'maina_tips']);
  ensureColumns(klientiSheet, ['slimnica', 'statuss', 'statusa_laiks', 'statusa_darbinieks_id']);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { error: 'Sistēma ir aizņemta, mēģini vēlreiz' };
  }

  try {
    // --- operation_registry dedup (spec 12.2) ---
    // Pirms apstrādes pārbauda operation_id. Ja ir eksistējošs rezultāts — atgriež to.
    if (operationId) {
      const opFound = findOperation(operationId);
      if (opFound) {
        const opResult = String(opFound.data.result || '').trim().toLowerCase();
        if (opResult) {
          // Operation was previously processed — return stored result
          const officialId = opFound.data.official_record_id || '';
          if (opResult === 'accepted') {
            return { accepted: true, already_processed: true, id: officialId || undefined };
          }
          if (opResult === 'blocked') {
            return { blocked: true, already_processed: true };
          }
          if (opResult === 'rejected') {
            return { rejected: true, already_processed: true };
          }
          if (opResult === 'conflict') {
            return { conflict: true, already_processed: true };
          }
          return { accepted: true, error: 'Operation result: ' + opResult, already_processed: true };
        }
      } else {
        // Register new operation — deduplication_valid_until = 180 dienas
        registerOperation(
          operationId, m.employeeId, 'mark',
          m.clientId || null, m.lastModified || ''
        );
      }
    }

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
          // Ja vērtība nav mainījusies — rakstīti nav ko
           if (String(atzimesData[i][atzimesColMap['vertiba']]) === String(m.value)) {
             if (operationId) {
               updateOperationResult(operationId, {
                 result: 'accepted',
                 officialRecordId: atzimesData[i][atzimesColMap['id']],
                 statusCode: 200
               });
             }
             return {
               success: true,
               id: atzimesData[i][atzimesColMap['id']],
               already_processed: true,
               logId: null
             };
           }
          // Vērtība mainījusies — turpināt ar atjaunošanu (zemāk)
          break;
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

    const modificationTime = getModificationTimeFromPayload(m);
    const existingMarkData = existingMarkRow > 0 ? atzimesData[existingMarkRow - 2] : null;
    const existingMarkId = existingMarkData ? existingMarkData[atzimesColMap.id] : null;
    const existingEventTime = existingMarkData
      ? getEventTimeForExistingMark(existingMarkData, atzimesColMap, logData, logColMap, existingMarkId)
      : null;
     const existingMarkVersion = existingMarkData
       ? (atzimesColMap['last_modified'] !== undefined ? String(existingMarkData[atzimesColMap['last_modified']]) : '')
       : '';

     // Spec 8: OCC — ja klients nosūtījis lastModified, salīdzina ar servera last_modified.
     // Ja servera versija ir jaunāka nekā klients, konflikts.
     if (existingMarkRow > 0 && m.lastModified && existingMarkVersion) {
       const clientVer = String(m.lastModified).trim();
       const serverVer = existingMarkVersion.trim();
       if (clientVer !== '' && serverVer !== '' && clientVer !== serverVer) {
         if (operationId) {
           updateOperationResult(operationId, {
             result: 'conflict',
             statusCode: 409,
             officialRecordId: existingMarkId
           });
         }
         return {
           conflict: true,
           success: false,
           error: 'Konflikts: atzīme ir mainījusies.',
           serverVersion: serverVer,
           recordId: existingMarkId
         };
       }
     } else if (existingMarkRow > 0 && m.lastModified && !existingMarkVersion) {
       // Server doesn't have last_modified yet for this mark — accept and set it
     }

     const eventTime = getEventTimeFromPayload(m, existingEventTime || modificationTime, m.date);
    const eventDateRiga = formatDate(eventTime);
    const eventTimeRiga = formatTimeOnly(eventTime);
    const eventDateTimeRiga = formatDateTimeLV(eventTime);
    const modificationDateTimeRiga = formatDateTimeLV(modificationTime);

    const updates = []; // Batch updates to apply at once

    // Status toggle detection: category=slimnica, field=statuss
    const isStatusToggle = (normalizeKey(m.field) === 'statuss' && String(m.category || '').toLowerCase() === 'slimnica');

    // Server-side enforcement: if the client is currently in hospital, non-status
    // care marks must be rejected. Status toggles are always allowed.
    if (!isStatusToggle) {
      const hospitalNow = getLatestClientStatus(logData, logColMap, m.clientId) || isClientHospitalRow(klientiSheet, m.clientId);
       if (hospitalNow) {
         if (operationId) {
           updateOperationResult(operationId, {
             result: 'blocked',
             statusCode: 403
           });
         }
         return {
           success: false,
           error: 'Klients atrodas slimnīcā; aprūpes ierakstus nevar saglabāt.',
           blocked: true
         };
       }
    }

    if (existingMarkRow > 0) {
      // Ja vērtība ir tā pati, neizveido duplikātu žurnāla ierakstu
      if (existingMarkValue === String(m.value)) {
        if (operationId) {
          updateOperationResult(operationId, {
            result: 'accepted',
            officialRecordId: atzimesData[existingMarkRow - 2][atzimesColMap['id']],
            statusCode: 200
          });
        }
        return {
          success: true,
          id: atzimesData[existingMarkRow - 2][atzimesColMap['id']],
          already_processed: true,
          logId: null
        };
      }

      // Batch updates for existing mark
      if (atzimesColMap['vertiba'] !== undefined) updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['vertiba'] + 1, value: m.value });
      if (atzimesColMap['pedeja_laiks'] !== undefined) updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['pedeja_laiks'] + 1, value: modificationDateTimeRiga });
      if (atzimesColMap['pedejais_laiks'] !== undefined) updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['pedejais_laiks'] + 1, value: modificationDateTimeRiga });
      if (atzimesColMap['darbinieks_pedejais'] !== undefined) updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['darbinieks_pedejais'] + 1, value: m.employeeId });
      if (m.actionId && atzimesColMap['action_id'] !== undefined) updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['action_id'] + 1, value: m.actionId });
      if (m.mainaTips && atzimesColMap['maina_tips'] !== undefined) updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['maina_tips'] + 1, value: m.mainaTips });
      // Inkrementē version kolonnu (OCC)
      if (atzimesColMap['version'] !== undefined) {
        const currentVer = parseInt(atzimesData[existingMarkRow - 2][atzimesColMap['version']], 10);
        updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['version'] + 1, value: isNaN(currentVer) ? 1 : currentVer + 1 });
      }
      // Atjaunina last_modified (OCC)
      if (atzimesColMap['last_modified'] !== undefined) {
        updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['last_modified'] + 1, value: modificationTime });
      }
      
      const markId = atzimesData[existingMarkRow - 2][atzimesColMap['id']];
      
      // Prepare log entry
      const logId = 'l_' + Date.now() + Math.floor(Math.random() * 1000);
      // For sikdrumi category, show increment in log instead of running total
      let logValue = m.value;
      if (m.category === 'sikdrumi' && existingMarkValue !== '' && existingMarkValue !== null && existingMarkValue !== undefined) {
        const prev = parseFloat(existingMarkValue);
        const current = parseFloat(m.value);
        if (!isNaN(prev) && !isNaN(current)) {
          const diff = current - prev;
          if (diff > 0) logValue = '+' + diff;
          else if (diff < 0) logValue = String(diff);
        }
      }

      const logRowData = {
        id: logId,
        atzimes_id: markId,
        klients_id: m.clientId,
        darbinieks_id: m.employeeId,
        datums: eventDateRiga,
        laiks: eventTimeRiga,
        periods: m.shift || 'R',
        kategorija: m.category,
        lauka_nosaukums: m.field,
        vertiba: logValue,
        notikuma_laiks: eventDateTimeRiga,
        skaits: eventDateTimeRiga,
        pedeja_vertiba: existingMarkValue,
        pedeja_laiks: modificationDateTimeRiga,
        darbinieks_pedejais: m.employeeId,
        action_id: m.actionId || '',
        maina_tips: m.mainaTips || m.maina_tips || 'diennakts'
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

      // Keep the client's hospital status in sync (source of truth for other devices)
      if (isStatusToggle) {
        updateClientStatus(klientiSheet, m, modificationDateTimeRiga, m.employeeId);
      }

      if (operationId) {
        updateOperationResult(operationId, {
          result: 'accepted',
          officialRecordId: markId,
          statusCode: 200
        });
      }

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
      else if (nk === 'laiks') markRow[i] = eventTimeRiga;
      else if (nk === 'periods') markRow[i] = m.shift || 'R';
      else if (nk === 'kategorija') markRow[i] = m.category;
      else if (nk === 'lauka_nosaukums') markRow[i] = m.field;
      else if (nk === 'vertiba') markRow[i] = m.value;
      else if (nk === 'pedeja_laiks') markRow[i] = modificationDateTimeRiga;
      else if (nk === 'pedejais_laiks') markRow[i] = modificationDateTimeRiga;
      else if (nk === 'darbinieks_pedejais') markRow[i] = m.employeeId;
      else if (nk === 'action_id') markRow[i] = m.actionId || '';
      else if (nk === 'maina_tips') markRow[i] = m.mainaTips || m.maina_tips || 'diennakts';
      else if (nk === 'notikuma_laiks') markRow[i] = eventDateTimeRiga;
      else if (nk === 'version') markRow[i] = 1;
      else if (nk === 'last_modified') markRow[i] = modificationTime;
    });

    const logId = 'l_' + Date.now() + Math.floor(Math.random() * 1000);
    const logRowData = {
      id: logId,
      atzimes_id: id,
      klients_id: m.clientId,
      darbinieks_id: m.employeeId,
      datums: eventDateRiga,
      laiks: eventTimeRiga,
      periods: m.shift || 'R',
      kategorija: m.category,
      lauka_nosaukums: m.field,
      vertiba: m.value,
      notikuma_laiks: eventDateTimeRiga,
      skaits: eventDateTimeRiga,
      pedeja_vertiba: '',
      pedeja_laiks: modificationDateTimeRiga,
      darbinieks_pedejais: m.employeeId,
      action_id: m.actionId || '',
      maina_tips: m.mainaTips || m.maina_tips || 'diennakts'
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

    // Keep the client's hospital status in sync (source of truth for other devices)
    if (isStatusToggle) {
      updateClientStatus(klientiSheet, m, modificationDateTimeRiga, m.employeeId);
    }

    if (operationId) {
      updateOperationResult(operationId, {
        result: 'accepted',
        officialRecordId: id,
        statusCode: 200
      });
    }

    return { success: true, id: id, already_processed: false, serverVersion: modificationTime, recordVersion: modificationTime };
  } finally {
    lock.releaseLock();
  }
}

function ensureColumns(sheet, requiredColumns) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return; // Sheet is empty — no columns to inspect
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const missing = requiredColumns.filter(col => !headers.some(h => normalizeKey(h) === normalizeKey(col)));
  if (missing.length > 0) {
    missing.forEach((col, i) => {
      sheet.getRange(1, lastCol + 1 + i).setValue(col);
    });
  }
}

function handleCreateTask(data) {
  const sheet = getSheet('uzdevomi');
  const t = data.data;
  const operationId = t.operationId || t.operation_id;

  ensureColumns(sheet, ['action_id', 'pabeigts_laiks', 'pabeigtajs_id']);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { error: 'Sistēma ir aizņemta, mēģini vēlreiz' };
  }

  try {
    // --- operation_registry dedup (spec 12.2) ---
    if (operationId) {
      const opFound = findOperation(operationId);
      if (opFound) {
        const opResult = String(opFound.data.result || '').trim().toLowerCase();
        if (opResult) {
          const officialId = opFound.data.official_record_id || '';
          if (opResult === 'accepted') {
            return { accepted: true, already_processed: true, id: officialId || undefined, taskId: officialId || undefined };
          }
          if (opResult === 'blocked') {
            return { blocked: true, already_processed: true, taskId: '' };
          }
          if (opResult === 'rejected') {
            return { rejected: true, already_processed: true, taskId: '' };
          }
        }
      } else {
        registerOperation(operationId, t.employeeId || t.izveidotajsId, 'createTask', null, '');
      }
    }

    // Dubultās izveides novēršana: actionId pārbaude pirms pamata lauku pārbaudes
    if (t.actionId) {
      const existingById = findRow(sheet, [['action_id', t.actionId]]);
       if (existingById) {
         if (operationId) {
           updateOperationResult(operationId, {
             result: 'accepted',
             officialRecordId: existingById.data.id,
             statusCode: 200
           });
         }
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
       if (operationId) {
         updateOperationResult(operationId, {
           result: 'accepted',
           officialRecordId: existingTask.data.id,
           statusCode: 200
         });
       }
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
      action_id: t.actionId || '',
      version: 1
    });
    SpreadsheetApp.flush();

    if (operationId) {
      updateOperationResult(operationId, {
        result: 'accepted',
        officialRecordId: id,
        statusCode: 200
      });
    }

    return { success: true, id: id, already_processed: false };
  } finally {
    lock.releaseLock();
  }
}

function handleUpdateTask(data) {
  const sheet = getSheet('uzdevomi');
  ensureColumns(sheet, ['version']);
  const t = data.data;
  const operationId = t.operationId || t.operation_id;

  // operation_registry dedup (spec 12.2)
  if (operationId) {
    const opFound = findOperation(operationId);
    if (opFound) {
      const opResult = String(opFound.data.result || '').trim().toLowerCase();
      if (opResult) {
        if (opResult === 'accepted') {
          return { accepted: true, already_processed: true };
        }
        if (opResult === 'conflict') {
          return { conflict: true, already_processed: true };
        }
        if (opResult === 'rejected') {
          return { rejected: true, already_processed: true };
        }
        if (opResult === 'error') {
          return { error: 'Operation previously failed on server', already_processed: true };
        }
      }
    } else {
      const recordRow = findRow(sheet, [['id', t.id]]);
      registerOperation(operationId, t.employeeId || '', 'update_uzdevomi', t.id, recordRow ? recordRow.data.version : '');
    }
  }

  const row = findRow(sheet, [['id', t.id]]);
  if (!row) {
    if (operationId) {
      updateOperationResult(operationId, { result: 'rejected', statusCode: 404 });
    }
    return { error: 'Uzdevums nav atrasts' };
  }

  // OCC check
  const clientVersion = t.recordVersion || t.version;
  if (clientVersion !== undefined && clientVersion !== '') {
    const colMap = {};
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    headers.forEach((h, i) => { colMap[normalizeKey(h)] = i; });
    if (colMap['version'] !== undefined) {
      const serverVerNum = parseInt(row.data.version, 10);
      const clientVerNum = parseInt(clientVersion, 10);
      if (!isNaN(serverVerNum) && !isNaN(clientVerNum) && serverVerNum !== clientVerNum) {
        if (operationId) {
          updateOperationResult(operationId, { result: 'conflict', statusCode: 409, officialRecordId: row.data.id });
        }
        return {
          conflict: true,
          success: false,
          error: 'Konflikts: uzdevums ir mainījies.',
          serverVersion: serverVerNum,
          recordId: row.data.id
        };
      }
    }
  }

  // Ensure completion columns exist before writing
  ensureColumns(sheet, ['pabeigts_laiks', 'pabeigtajs_id', 'pabeigts']);

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

  // Increment version
  const curVersion = parseInt(row.data.version, 10);
  setCellValue(sheet, row.row, 'version', isNaN(curVersion) ? 1 : curVersion + 1);

  if (operationId) {
    updateOperationResult(operationId, {
      result: 'accepted',
      officialRecordId: row.data.id,
      statusCode: 200
    });
  }

  return { success: true, accepted: true, id: row.data.id, recordVersion: isNaN(curVersion) ? 1 : curVersion + 1 };
}

function doOptions(e) {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.JSON);
}

function createResponse(status, data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function parseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  const text = String(value).trim();
  if (!text) return null;
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(
      parseInt(dateOnly[1], 10),
      parseInt(dateOnly[2], 10) - 1,
      parseInt(dateOnly[3], 10)
    );
  }
  const full = text.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (full) {
    const hasZone = !!full[8];
    if (hasZone) {
      const parsed = new Date(text.replace(' ', 'T'));
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date(
      parseInt(full[1], 10),
      parseInt(full[2], 10) - 1,
      parseInt(full[3], 10),
      parseInt(full[4], 10),
      parseInt(full[5], 10),
      parseInt(full[6] || '0', 10),
      parseInt((full[7] || '0') + '00', 10)
    );
  }
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function parseTimeOnly(value) {
  if (!value) return null;
  const parts = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!parts) return null;
  const hour = parseInt(parts[1], 10);
  const minute = parseInt(parts[2], 10);
  const second = parseInt(parts[3] || '0', 10);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour: hour, minute: minute, second: second };
}

function getEventDateFromPayload(payload, fallbackDate) {
  const eventTime = parseTimestamp(payload.eventTime || payload.notikuma_laiks || payload.skaits);
  if (eventTime) return eventTime;
  const dateValue = payload.date || payload.datums || fallbackDate || new Date();
  const parsedDate = parseTimestamp(dateValue);
  return parsedDate || new Date();
}

function getEventTimeFromPayload(payload, fallbackEventTime, fallbackDate) {
  const eventTime = parseTimestamp(payload.eventTime || payload.notikuma_laiks || payload.skaits);
  if (eventTime) return eventTime;
  if (fallbackEventTime) return fallbackEventTime;
  const timeOnly = parseTimeOnly(payload.time || payload.laiks);
  const eventDate = getEventDateFromPayload(payload, fallbackDate);
  if (timeOnly) {
    return new Date(
      eventDate.getFullYear(),
      eventDate.getMonth(),
      eventDate.getDate(),
      timeOnly.hour,
      timeOnly.minute,
      timeOnly.second
    );
  }
  return new Date();
}

function getEventTimeFromRow(row, colMap) {
  const fullTime = row[colMap.notikuma_laiks] || row[colMap.skaits];
  const parsedFullTime = parseTimestamp(fullTime);
  if (parsedFullTime) return parsedFullTime;

  const dateValue = row[colMap.datums];
  const timeOnly = parseTimeOnly(row[colMap.laiks]);
  const parsedDate = parseTimestamp(dateValue);
  if (parsedDate && timeOnly) {
    return new Date(
      parsedDate.getFullYear(),
      parsedDate.getMonth(),
      parsedDate.getDate(),
      timeOnly.hour,
      timeOnly.minute,
      timeOnly.second
    );
  }
  return null;
}

function getEventTimeForExistingMark(row, colMap, logData, logColMap, markId) {
  if (logData && logColMap && markId) {
    for (let i = 0; i < logData.length; i++) {
      if (String(logData[i][logColMap.atzimes_id]) === String(markId)) {
        const logEventTime = getEventTimeFromRow(logData[i], logColMap);
        if (logEventTime) return logEventTime;
      }
    }
  }
  return getEventTimeFromRow(row, colMap);
}

function getModificationTimeFromPayload(payload) {
  return parseTimestamp(payload.lastModified || payload.pedeja_laiks || payload.pēdējais_laiks) || new Date();
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

function isTruthy(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1';
  }
  return false;
}

function isHospitalValue(v) {
  const t = String(v || '').trim().toLowerCase();
  return t === 'true' || t === '1' ||
    t === 'slimnīcā' || t === 'sludnīcā' ||
    t.includes('hospitaliz') || t.includes('slimnīcā') || t.includes('iepazīdināts');
}

// Returns the most recent hospital status from the atzimes_log rows (source of truth)
function getLatestClientStatus(logData, logColMap, clientId) {
  if (!logData || !logColMap || !clientId) return false;
  const klientsCol = logColMap['klients_id'];
  const katCol = logColMap['kategorija'];
  const lauksCol = logColMap['lauka_nosaukums'];
  const vertCol = logColMap['vertiba'];
  if (klientsCol === undefined || katCol === undefined || lauksCol === undefined) return false;
  let latestTime = null;
  let latestValue = '';
  for (let i = 0; i < logData.length; i++) {
    if (String(logData[i][klientsCol]) !== String(clientId)) continue;
    if (String(logData[i][katCol]).toLowerCase() !== 'slimnica') continue;
    if (String(logData[i][lauksCol]).toLowerCase() !== 'statuss') continue;
    const et = getEventTimeFromRow(logData[i], logColMap);
    if (!et) continue;
    if (!latestTime || et.getTime() > latestTime.getTime()) {
      latestTime = et;
      latestValue = String(logData[i][vertCol != null ? vertCol : 0] || '');
    }
  }
  if (!latestTime) return false;
  return isHospitalValue(latestValue);
}

function isClientHospitalRow(klientiSheet, clientId) {
  if (!klientiSheet || !clientId) return false;
  const row = findRow(klientiSheet, [['id', clientId]]);
  if (!row) return false;
  const d = row.data;
  return isTruthy(d.slimnica) || isTruthy(d['Slimnīcā']) || isHospitalValue(d.statuss);
}

// Writes the current hospital status back to the klienti sheet so other devices
// can read it without scanning the entire change log.
function updateClientStatus(sheet, m, timestampRiga, employeeId) {
  if (!sheet || !m.clientId) return;
  const row = findRow(sheet, [['id', m.clientId]]);
  if (!row) return;
  const val = String(m.value || '').trim().toLowerCase();
  const isHosp = isHospitalValue(val);
  setCellValue(sheet, row.row, 'statuss', isHosp ? 'SLIMNĪCĀ' : 'SAC');
  setCellValue(sheet, row.row, 'slimnica', isHosp);
  setCellValue(sheet, row.row, 'Slimnīcā', isHosp);
  if (timestampRiga) setCellValue(sheet, row.row, 'statusa_laiks', timestampRiga);
  if (employeeId) setCellValue(sheet, row.row, 'statusa_darbinieks_id', employeeId);
  SpreadsheetApp.flush();
}
