// ⚠️ Šis ir GALVENĀS datu lapas ID. Izvietojot pēc datu maiņas šeit ir
// jāupdaugina VIENMĒRĪGI ar SHEET_ID failā js/config.js, un pēc tam skriptu
// jāizvieto no jauna. Ja to neizdarāt, serveris lasīs veco lapu, bet
// klientu domā, ka dati ir jaunajā.
const SHEET_ID = '1uUf-qZKm5ovEVJaJbzjRn5RR5k3-b__3OlNBNdqT6os';
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

// ───────────────────────────────────────────────────────────────────────
// DIAGNOSTIKA. Šie skaitļi tiek atgriezti katrā atbildē laukā `_diag`.
// Tā mērīšana, nevis minēšana — lai redzētu, kur tiek pavadīts laiks.
// ───────────────────────────────────────────────────────────────────────
var _diag = { getRangeCalls: 0, cellsRead: 0, openById: 0, phases: {}, notes: [] };
// Skripta sākuma laiks. Ļauj aprēķināt, cik daudz no kopējā laika iztika
// ārpus izmērītajiem posmiem.
var _startedAt = Date.now();

function _t() { return new Date().getTime(); }

function _phase(name, fn) {
  const t0 = _t();
  const r = fn();
  _diag.phases[name] = _t() - t0;
  return r;
}

// Skaits, cik reizes nolasīta kaut kāda šūnu apakšzona. Galvenais GAS
// izmaksu rādītājs ir ZVANU skaits, nevis šūnu skaits.
function _readRange(sheet, row, col, numRows, numCols) {
  _diag.getRangeCalls++;
  _diag.cellsRead += numRows * numCols;
  return sheet.getRange(row, col, numRows, numCols).getValues();
}

// ───────────────────────────────────────────────────────────────────────
// ⚠️ ŠEIT BIJA REĀLS DEFECTS. `getSpreadsheet()` katru reizi zvanīja
// `SpreadsheetApp.openById()`. Tas ir tīkla zvans uz Google serveri, un tas
// notika katru reizi, kad tika izsaukts `getSheet()` — tas ir pie katra
// ensureColumns, katras lapas nolasīšanas, katras ieraksta operācijas.
// Vienā `load` pieprasījumā tas nozīmēja desmitiem atsevišķu openById.
//
// Komentārs 391. rindā jau norādīja, ka jāizmanto kešatmiņa, bet tā nekad
// netika implementēta. Tagad tā ir.
// ───────────────────────────────────────────────────────────────────────
var _ssCache = null;
var _sheetCache = {};

function getSpreadsheet() {
  if (_ssCache === null) {
    _diag.openById++;
    _ssCache = SpreadsheetApp.openById(SHEET_ID);
  }
  return _ssCache;
}

function getSheet(sheetName) {
  if (!_sheetCache[sheetName]) {
    _sheetCache[sheetName] = getSpreadsheet().getSheetByName(sheetName);
    // Reālais rindu skaits katrai lapai — lai `_diag` rādītu fakti, nevis
    // minējumu par datu apjomu.
    try {
      if (_diag.sheetRows === undefined) _diag.sheetRows = {};
      _diag.sheetRows[sheetName] = _sheetCache[sheetName].getLastRow();
    } catch (e) {
      _diag.notes.push('sheetRows neizdevās: ' + e);
    }
  }
  return _sheetCache[sheetName];
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

// ───────────────────────────────────────────────────────────────────────
// MEKLĒŠANA PA ID — ierīču izpētījums ar 225 000 rindām.
//
// Vecākā versija lasīja `getRange(1, 1, lastRow, lastCol).getValues()` —
// tā ir 3,8 miljoni šūnu KATRĀ izsaukumā, un tā tiek izsaukta uz katru
// rakstīšanu (handleMark, handleUpdate, setShift, registerOperation).
// Ar 500 klientiem un 225 000 atzīmēm tas nogrieza katru ierakstu pēc
// 25 sekundēm. Tā nebija tīkla problēma, tā bija šī viena rinda.
//
// JAUNĀ stratēģija: lai atrastu rindu, lasām TIKAI nosacījuma kolonnas
// (1–2 kolonnas nevis 17), un tad lasām vienu atrasto rindu pilnībā.
// Tas samazina lasījumu ~17 reizes un, svarīgāk, vairs never veido
// miljoniem šūnu lielu masīvu atmiņā.
// ───────────────────────────────────────────────────────────────────────
function findRow(sheet, conditions) {
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const lastCol = sheet.getLastColumn();

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const colMap = {};
  headers.forEach((h, i) => { colMap[normalizeKey(h)] = i; });

  // Kurās kolonnās meklājam? Ja kaut viena nav, rindas nevar atrast.
  const wanted = [];
  for (const [field, value] of conditions) {
    const colIdx = colMap[normalizeKey(field)];
    if (colIdx === undefined) return null;
    wanted.push({ colIdx: colIdx, want: String(value) });
  }
  if (wanted.length === 0) return null;

  const foundRow = scanWantedColumns(sheet, wanted, lastRow);
  if (foundRow === null) return null;

  // Tagad lasām TIKAI vienu rindu pilnībā.
  const rowValues = sheet.getRange(foundRow, 1, 1, lastCol).getValues()[0];
  const rowData = {};
  headers.forEach((h, j) => { rowData[normalizeKey(h)] = rowValues[j]; });
  return { row: foundRow, data: rowData, headers: headers };
}

// Skenē TIKAI meklējamās kolonnas, partijās pa 2000 rindām, lai atmiņā
// nekad nebūtu vairāk par 2000 šūnām vienlaik (nevis 225 000 × 17).
// Atgriež rindas ABSOLŪTO NUMURU vai null.
//
// ⚠️ Skenēšana sākas no LAPAS BEIGĀM. Tas ir būtiski ātrāk nekā no augšas:
// katra partija nolasīšana no 225 930 rindu kolonnas maksā ~18 s, un
// `handleMark` to izsauca vairākas reizes — tas bija 74 sekundes uz vienu
// ierakstu. Bet meklējamie ID (operation_id, action_id) vienmēr ir nesen
// pievienotie, tāpē tie atrodas lapas beigās un pirmajā partijā.
//
// Secībai šeit NAV nozīmes (meklējam vienu konkrētu ID, nevis diapazonu),
// tāpē droši var sākt no beigām. Ja ID tomēr nav beigās, pēc beigām
// skenēšanas sekos pārskats no sākuma — rezultāts ir tāds pats.
function scanWantedColumns(sheet, wanted, lastRow) {
  const BATCH = 2000;

  function scanRange(from, to) {
    for (let s = from; s <= to; s += BATCH) {
      const n = Math.min(BATCH, to - s + 1);
      const cols = wanted.map(w => {
        const vals = sheet.getRange(s, w.colIdx + 1, n, 1).getValues();
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = String(vals[i][0]);
        return out;
      });
      _diag.getRangeCalls += wanted.length;
      _diag.cellsRead += wanted.length * n;
      for (let i = 0; i < n; i++) {
        let match = true;
        for (let k = 0; k < wanted.length; k++) {
          if (cols[k][i] !== wanted[k].want) { match = false; break; }
        }
        if (match) return s + i;
      }
    }
    return null;
  }

  // 1) No beigām uz priekšu (ātrs ceļš jaunākiem ID)
  const fromEnd = scanRange(lastRow, 2);
  if (fromEnd !== null) return fromEnd;
  // 2) No sākuma (vecāki ID, ja tie joprojām lietoti)
  return scanRange(2, lastRow);
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
  // ⚠️ Diagnostika atgriezta KATRĀ atbildē, nevis rakstīta tikai logā. Bez
  // tās ir neiespējami noteikt, kur tiek pavadīts laiks — manas agrīnās
  // secinājumi par to, kāds kods ir izvietots, bija nepareizi, jo es
  // minēju, nevis mērīju.
  if (data && typeof data === 'object') {
    // `totalMs` ir laiks no skripta sākuma. Salīdzinot ar `phasesMs`
    // summu, tas rāda, cik daudz laika palika ārpus izmērītajiem
    // posmiem — GAS palaišanā, tīkla zvanos un JSON apstrādē.
    data._diag = {
      getRangeCalls: _diag.getRangeCalls,
      cellsRead: _diag.cellsRead,
      openById: _diag.openById,
      phasesMs: _diag.phases,
      notes: _diag.notes,
      sheetRows: _diag.sheetRows,
      totalMs: Date.now() - _startedAt,
      phasesSumMs: (function () {
        let s = 0;
        for (const k in _diag.phases) s += _diag.phases[k];
        return s;
      })()
    };
  }
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
    if (action === 'backfill_keys') return handleBackfillKeys(data);
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
      offset: params.offset ? parseInt(params.offset, 10) : 0,
      logOffset: params.logOffset ? parseInt(params.logOffset, 10) : null,
      marksDone: params.marksDone === 'true',
      logDone: params.logDone === 'true'
    };
    if (isNaN(filters.limit) || filters.limit < 0) filters.limit = 0;
    // ⚠️ Neizspiest negatīvu offset uz 0! Negatīvs offset ir derīgs un to
    // izmanto apgrieztā skenēšana (skatiet reverseScan). Iepriekšējā
    // versija to nospieža uz 0, un katra lapa atgrieztu jaunākos ierakstus
    // no jauna, neizbeidzoties nekad.
    if (isNaN(filters.offset)) filters.offset = 0;
    if (filters.logOffset === null || isNaN(filters.logOffset)) filters.logOffset = null;

    // Use cached spreadsheet reference to avoid repeated openById calls
    _phase('openSpreadsheet', getSpreadsheet);

    // ⚠️ Šie 5 ensureColumns izsaukumi katrs dara 2-3 getRange zvanus, tāpēc
    // katrs pieprasījums nešmēja ~10-15 zvanus, pat ja datumus nelādēja.
    // Šis ir reālais katras ielādes fiksētais pamats, nevis datu apjoms.
    _phase('ensureColumns', function () {
      ensureColumns(getSheet('darbinieki'), ['maina_tips', 'version']);
      ensureColumns(getSheet('klienti'), ['slimnica', 'statuss', 'statusa_laiks', 'statusa_darbinieks_id', 'version']);
      ensureColumns(getSheet('atzimes'), ['action_id', 'maina_tips', 'notikuma_laiks', 'version']);
      ensureColumns(getSheet('atzimes_log'), ['id', 'atzimes_id', 'klients_id', 'darbinieks_id', 'datums', 'laiks', 'periods', 'kategorija', 'lauka_nosaukums', 'vertiba', 'skaits', 'notikuma_laiks', 'pedeja_vertiba', 'pedeja_laiks', 'darbinieks_pedejais', 'action_id', 'maina_tips']);
      ensureColumns(getSheet('uzdevomi'), ['action_id', 'version']);
    });
    
    const serverTime = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
    
    if (mode === 'marks') {
      return _phase('loadMarks', function () { return handleLoadMarksPaged(filters, serverTime); });
    }

    if (mode === 'range') {
      return _phase('loadRange', function () { return handleLoadMarksRange(filters, serverTime); });
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
    // Katrai no divām tabulām ir SAVS offset. Kopējais offset nedarbojas,
    // kad vienas tabulas dati beidzas pirms otras — nākamā lapa atgrieztu
    // pabeigtās tabulas rindas atkārtoti, kamēr otra vēl tikai sākta.
    // Offset var būt arī NEGATĪVS: tas nozīmē "atsākt no lapas beigām un
    // lādēt atpakaļ uz vecākiem ierakstiem" (skatiet reverseScan zemāk).
    // Iepriekšējā versija to nospieža uz 0, kas lika katrai lapai sākties no
    // jaunākajiem ierakstiem un atgrieztu tos pašus datus bezgalīgi.
    const offset = isFinite(filters.offset) ? Math.floor(filters.offset) : 0;
    const logOffset = isFinite(filters.logOffset) ? Math.floor(filters.logOffset) : offset;
    const marksDone = filters.marksDone === true || filters.marksDone === 'true';
    const logDone = filters.logDone === true || filters.logDone === 'true';

    const marks = marksDone
      ? { rows: [], nextOffset: offset, totalMatched: 0, done: true }
      : readFilteredSlice(getSheet('atzimes'), filters, offset, limit);
    const logSlice = logDone
      ? { rows: [], nextOffset: logOffset, totalMatched: 0, done: true }
      : readFilteredSlice(getSheet('atzimes_log'), filters, logOffset, limit);
    
    return {
      atzimes: marks.rows,
      atzimes_log: logSlice.rows,
      nextOffset: marks.nextOffset,
      totalMatched: marks.totalMatched,
      logNextOffset: logSlice.nextOffset,
      logTotalMatched: logSlice.totalMatched,
      marksDone: marks.done === true,
      logDone: logSlice.done === true,
      scanDirection: marks.scanDirection || logSlice.scanDirection || 'forward',
      done: marks.done === true && logSlice.done === true,
      success: true,
      serverTime: serverTime
    };
  }
  
  // Effektīva filtrēta nolasīšana: vispirms tikai filtra kolonnas, tad pilnās rindas
  function readFilteredSlice(sheet, filters, offset, limit) {
    // `done: true` ir svarīgs arī tukšai lapai: bez tā atgrieztais
    // `nextOffset` būtu vienāds ar iesniegto un klients ieskaitītu to par
    // neprogresējošu lapu.
    const empty = { rows: [], nextOffset: offset, totalMatched: 0, done: true, scanDirection: 'forward' };
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
      return {
        rows: slice.rows,
        nextOffset: slice.next,
        done: done,
        totalMatched: slice.total,
        scanDirection: 'forward'
      };
    }
    
    // 1. Filtra kolonnu skenēšana partijās (daudz mazāk šūnu nekā pilnas rindas)
    // Apgrieztajā režīmā mēs skenējam no lapas BEIGĀS uz priekšu: jaunākie
    // ieraksti ir apakšā, un sākuma ekrāna 3 dienu logs tos meklē. Skenējot
    // no 2. rindas, mēs lēcām pāri ~223 000 rindām, pirms vispār atrodam
    // pirmo atbilsti.
    //
    // Ja filtrē pēc klienta vai darbinieka, virziens NAV svarīgs, jo
    // atbilstes izkaisās pa visu lapu, tāpē skenējam kā vienmēr no augšas.
    const reverseScan = needDate && !needClient && !needEmp;
    // Klientam jāzinā, kādā virzienā skenēt, lai pareizi pārbaudītu, vai
    // lapa progresē. To nevar secināt no offset zīmes: pirmajā pieprasījumā
    // offset ir 0, bet nākamais jau būs negatīvs.
    const scanDirection = reverseScan ? 'reverse' : 'forward';
    // Cik daudz atbilstošu rindu mums šajā pieprasījumā vajag. Apgrieztajā
    // režīmā offset ir negatīvs un apzīmē "jau atgriezto rindu skaitu".
    const target = reverseScan ? (-offset + limit) : (offset + limit);

    const cols = [];
    if (needClient) cols.push({ i: idxClient, val: String(filters.clientId).trim() });
    if (needEmp) cols.push({ i: idxEmp, val: String(filters.employeeId).trim() });
    if (needDate) cols.push({ i: idxDate, date: true });

    const nRows = lastRow - 1;
    if (_diag.sheetRows === undefined) _diag.sheetRows = {};
    _diag.notes.push('rows=' + nRows + ' filterCols=' + cols.length + ' reverse=' + reverseScan);
    // ⚠️ Klienta filtrs tiek atrisināts ar `TextFinder`, nevis ar pilnas
    // kolonnas lasīšanu. Tas ir tāds pats paņēmiens kā `mark` ceļā: 225 930
    // šūnas tiek lasītas tikai tad, ja klientam patiešām nav atbilstošu rindu.
    // Ar `TextFinder` mēs iegūstam TIKAI rindu numurus, un datuma filtrs
    // tiek piemērots tām rindām, nevis visai kolonnai.
    //
    // ⚠️ `TextFinder` izmantojam arī tad, ja filtrs ir pēc DARBINIEKA vai
    // abiem vienlaikus. Agrāk šis ceļš tika atstāts vejam, jo divas
    // `TextFinder` meklēšanas bija dārgākas par vienu pilnu kolonnu.
    // Slodzes tests pierādīja, ka tas bija nepareizs lēmums: 180 000
    // rindās vecais ceļš nolasīja 367 701 šūnu, lai atrastu 450 rindas.
    // Šeit DARBINIEKA kolonnas šūnas tiek lasītas tikai kandidāta rindām,
    // tāpēc papildu maksa ir ierobežota ar klienta ierakstu skaitu, nevis
    // ar vispārējo rindu skaitu.
    const useFinder = needClient || needEmp;
    // ⚠️ Kolonnu MASĪVS tiek lasīts TIKAI vecajā skenēšanas režīmā. Apgrieztajā
    // režīmā lasām tikai logu, tāpēc pilnas kolonnas lasīšana būtu tukša
    // darbība, kas patērētu 18 sekundes katrai lapai.
    const colVals = (reverseScan || useFinder) ? null : _phase('scanFilterCols', function () {
      return cols.map(c => {
        if (c.date) return sheet.getRange(2, c.i + 1, nRows, 1).getValues().map(r => normalizeDateCell(r[0]));
        return sheet.getRange(2, c.i + 1, nRows, 1).getValues().map(r => String(r[0]).trim());
      });
    });
    if (colVals) {
      _diag.getRangeCalls += cols.length;
      _diag.cellsRead += cols.length * nRows;
    }

    // ⚠️ ŠEIT BIJA REĀLAIS AIZTURE. Servera `_diag` mērīšana parādīja:
    //     scanFilterCols = 18 446 ms, cellsRead = 519 860
    // Tas ir divas lapas × 225 930 šūnu, lai atrastu 2000 rindas 3 dienu
    // logam. Mērījums pierādīja, ka izmaksas šeit ir ŠŪNĀS, nevis zvanos —
    // man agrākais secinājums bija pretējs tam.
    //
    // Apgrieztajā režīmā vajag TIKAI jaunākās rindas. Vecāko vēsturi lasīt
    // nav vajadzīgs, ja 3 dienu logā ir vairāk par `limit` ierakstiem — un
    // tas šajā datubāzē ir, jo pirmā lapa atgriež 2000 un `marksDone` ir
    // `false`. Tāpēc nolasām TIKAI pēdējo logu, sākot ar 5000 rindām, un
    // paplašinām to tikai tad, ja atbilstību tomēr pietrūkst.
    //
    // TIEVA SKAŅA režīms (pēc klienta/darbinieka) paliek nenozīmīgs: tur
    // rindas izkaisās pa visu lapu, tāpēc loga lasīšana nepalīdz.
    const matchRows = [];
    let exhausted = false;

    if (reverseScan) {
      // ⚠️ ŠEIT BIJA REĀLS DATU ZAUDĒJUMS. Es lasīju pēdējās `target` FIZISKĀS
      // rindas un, ja atrastu mazāk par `target`, atzīmēju `exhausted = true`.
      // Bet tas ir nepareizi: mazāk par `target` nozīmē, ka logā bija
      // ne-atbilstošas rindas, NEVIS ka viss ir izskatīts. 2000. atbilstība
      // tad atradās virs loga un tika zaudēta. Dzīvā pārbaude to pierādīja:
      // jaunais izvietojums atgrieza 1999 rindas, vecais 2000, un trūka
      //   m_1790223929000 | 2026-09-25 | slimnica | SAC
      //
      // ⚠️ OTRĀ KĻŪDA, ko tests noķēra: kad logs paplašinās, katra nākamā
      // kārta dod VECĀKAS rindas. Tās jāpievieno masīva PRIEKŠĀ, nevis
      // beigā — citādi kopējā secība kļūst ne-monotona (20001, tad 15503)
      // un contīgo bloku apvienošana nokļūst uz ~2000 atsevišķiem lasījumiem.
      //
      // Katrs HTTP pieprasījums šo dara no jauna, bet tas ir deterministiski:
      // katrā kārtā tiek lasīta TIKAI JAUNA daļa (`scannedFrom` → `lo`).
      let windowSize = Math.max(target, 2000);
      let scannedFrom = lastRow + 1;   // 2-based; virs tā nekas nav skatīts
      exhausted = true;

      while (true) {
        const lo = Math.max(2, scannedFrom - windowSize);
        const cnt = scannedFrom - lo;  // rindas šajā kārtā
        if (cnt <= 0) { exhausted = true; break; }

        const t0 = _t();
        const block = cols.map(c => {
          const rng = sheet.getRange(lo, c.i + 1, cnt, 1);
          if (c.date) return rng.getValues().map(r => normalizeDateCell(r[0]));
          return rng.getValues().map(r => String(r[0]).trim());
        });
        _diag.phases.scanFilterCols = (_diag.phases.scanFilterCols || 0) + (_t() - t0);
        _diag.getRangeCalls += cols.length;
        _diag.cellsRead += cols.length * cnt;

        // Skenējam no `scannedFrom-1` uz `lo`. `local` ir JAUNĀKĀS → VECĀKAS.
        const local = [];
        const need = target - matchRows.length;
        for (let r = scannedFrom - 1; r >= lo && local.length < need; r--) {
          const j = r - lo;
          let ok = true;
          for (let k = 0; k < cols.length; k++) {
            const v = block[k][j];
            if (cols[k].date) {
              if (!v) { ok = false; break; }
              if (filters.dateFrom && v < filters.dateFrom) { ok = false; break; }
              if (filters.dateTo && v > filters.dateTo) { ok = false; break; }
            } else if (v !== cols[k].val) { ok = false; break; }
          }
          if (ok) local.push(r);
        }

        // ⚠️ Pievienojam PRIEKŠĀ, un `local` jābūt APGRIEZTAM. `local` tika
        // savākts no `scannedFrom-1` uz lejup, tāpē tas ir JAUNĀKĀS → VECĀKAS
        // (descending). Šī kārta skenēja ZEMĀKAS rindas par jau savāktajām,
        // tāpē tās ir vecākas un jāstāv masīva sākumā, AUGŠUPEJOŠĀ secībā.
        //
        // Bez `.reverse()` secība būtu ne-monotona (20001, tad 15503), un
        // contīgo bloku apvienošana nokristu uz ~2000 atsevišķiem getRange
        // zvaniem. Tas bija redzams arī testa skaitļos: 2002 zvani.
        if (local.length > 0) {
          matchRows.unshift.apply(matchRows, local.reverse());
        }

        scannedFrom = lo;   // nākamā kārta lasīs TIKAI zemāk par `lo`
        if (matchRows.length >= target) { exhausted = false; break; }
        if (lo <= 2) { exhausted = true; break; }   // sasniegta lapas sākums
        windowSize = Math.min(nRows, windowSize * 2);
        _diag.notes.push('logu paplašināju līdz rindai ' + lo);
      }
    } else if (useFinder) {
      // ⚠️ ŠIS ir galvenais `load` optimizācijas punkts. Vecais ceļš lasīja
      // `klients_id` un `darbinieks_id` kolonnas PILNĪBĀ (225 930 šūnas katra)
      // tikai tāpēc, lai atrastu apmēram 2000 rindas. `TextFinder` atgriež
      // rindas tieši faila secībā, bez šūnu nolasīšanas.
      //
      // Mēs vienmēr sākam no KLIENTA, ja tāds filtrs ir — tas parasti ir
      // daudz selektīvāks par darbinieku, tāpēc kandidātu saraksts ir
      // īsāks un visas turpmākās šūnu nolasīšanas ir lētākas.
      const tFind = _t();
      const cand = needClient
        ? _textFindAll(sheet, idxClient + 1, String(filters.clientId).trim(), 2)
        : _textFindAll(sheet, idxEmp + 1, String(filters.employeeId).trim(), 2);
      _diag.phases.textFindRows = (_diag.phases.textFindRows || 0) + (_t() - tFind);
      _diag.notes.push('textFind kandidāti=' + cand.length);

      // ⚠️ Ja filtrs ir pēc ABIEVIEM, pārējā kolonnas vērtības tiek pārbaudītas
      // katrai kandidāta rindai. Tas ir lētāk par pilnu kolonnas lasīšanu
      // TIKAI tad, ja kandidātu ir ievērojami mazāk nekā rindu — un tas
      // vienmēr ir tāds gadījums, jo klienta ieraksti ir daļa no kopējā.
      // Ja kandidātu ir ļoti daudz, lasām pārējo kolonnu pilnībā — tas ir
      // ātrāk par tūkstošiem atsevišķiem zvaniem.
      const secondIdx = needClient && needEmp ? idxEmp : -1;
      const secondVal = secondIdx >= 0 ? String(filters.employeeId).trim() : '';
      const needSecond = secondIdx >= 0 && cand.length > 0;

      // `cand` jau ir augšupejošā secībā (faila secībā), tāpē secība, ko
      // atgriež šis ceļš, ir IDENTISKA vecajam skaidruma lasījumam: tās pašas
      // rindas, tāds pats `offset`/`limit` izvēlējums, pats `exhausted`.
      if (!needDate && !needSecond) {
        // Nav papildu filtru — visas atrastās rindas derīgas.
        for (let i = 0; i < cand.length && matchRows.length < target; i++) {
          matchRows.push(cand[i]);
        }
      } else {
        // ⚠️ Šeit ir divi konkurējoši varianti:
        //   A) PARTIJAS: lasām tikai kandidāta rindas, contīgās grupas.
        //      Šūnas ir maz, bet ZVANU skaits = contīgo grupu skaits, un
        //      izkaisītu rindu gadījumā katra grupa ir garuma 1.
        //   B) PILNA KOLONNA: `batchCols.length` zvani, bet katrs lasa
        //      `nRows` šūnas.
        //
        // Es apzināti NELIETOJU izmaksu modeli, lai izvēlētos starp šiem.
        // Divi mēģinājumi to darīt (kandidātu skaits pret `nRows / 4`, tad
        // kalibrēts laika modelis) abi kļuva neuzticami, jo pircēju
        // faktiskās latencies nav izmērījamas bez dzīva servera. Tā vietā
        // tiek izmantots skaidrs, pārbaudāms SLIEKSNIS uz zvanu skaitu.
        const batchCols = [];
        if (needDate) batchCols.push({ i: idxDate, date: true });
        if (needSecond) batchCols.push({ i: secondIdx, val: secondVal });

        // Skaitām contīgo grupu skaitu, neizdarot nevienu `getRange` zvanu.
        let runCount = 0;
        for (let i = 0; i < cand.length; i++) {
          if (i === 0 || cand[i] !== cand[i - 1] + 1) runCount++;
        }
        // 200 zvani uz vienu HTTP pieprasījumu ir drošs augstāko robežu:
        // pat 2 s uz zvanu tas ir 6–7 minūtes, kas ir pārāk daudz, un pat
        // 0,2 s uz zvanu tas ir 40 s, kas arī pārāk daudz. Tāpēc virs šī
        // skaita mēs katru gadījumu izmantojam pilno kolonnu.
        const MAX_RUNS = 200;
        const useBatch = runCount * batchCols.length <= MAX_RUNS;
        _diag.notes.push('kandidāti=' + cand.length + ' grupas=' + runCount +
          ' zvani=' + (runCount * batchCols.length) + ' -> ' +
          (useBatch ? 'partijas' : 'pilna kolonna'));
        if (!useBatch) {
          // Kandidāti ir pārāk izkaisīti, lai partijas būtu lētākas — lasām
          // nepieciešamās kolonnas pilnībā, lai izvairītos no tūkstošiem zvaniem.
          const full = _phase('scanFilterCols', function () {
            return batchCols.map(c => {
              if (c.date) return sheet.getRange(2, c.i + 1, nRows, 1).getValues().map(r => normalizeDateCell(r[0]));
              return sheet.getRange(2, c.i + 1, nRows, 1).getValues().map(r => String(r[0]).trim());
            });
          });
          _diag.getRangeCalls += batchCols.length;
          _diag.cellsRead += batchCols.length * nRows;
          for (let i = 0; i < cand.length && matchRows.length < target; i++) {
            const row = cand[i];
            let ok = true;
            for (let k = 0; k < batchCols.length; k++) {
              const v = full[k][row - 2];
              if (batchCols[k].date) {
                if (!v) { ok = false; break; }
                if (filters.dateFrom && v < filters.dateFrom) { ok = false; break; }
                if (filters.dateTo && v > filters.dateTo) { ok = false; break; }
              } else if (v !== batchCols[k].val) { ok = false; break; }
            }
            if (ok) matchRows.push(row);
          }
        } else {
          let i = 0;
          while (i < cand.length && matchRows.length < target) {
            const runStart = cand[i];
            let j = i;
            while (j + 1 < cand.length && cand[j + 1] === cand[j] + 1 && matchRows.length < target) j++;
            const cnt = j - i + 1;

            const tD = _t();
            const dvals = (needDate
              ? sheet.getRange(runStart, idxDate + 1, cnt, 1).getValues().map(r => normalizeDateCell(r[0]))
              : null);
            const svals = (needSecond
              ? sheet.getRange(runStart, secondIdx + 1, cnt, 1).getValues().map(r => String(r[0]).trim())
              : null);
            _diag.phases.scanFilterCols = (_diag.phases.scanFilterCols || 0) + (_t() - tD);
            _diag.getRangeCalls += (dvals ? 1 : 0) + (svals ? 1 : 0);
            _diag.cellsRead += cnt * ((dvals ? 1 : 0) + (svals ? 1 : 0));

            for (let k = 0; k < cnt && matchRows.length < target; k++) {
              if (dvals) {
                const v = dvals[k];
                if (!v) continue;
                if (filters.dateFrom && v < filters.dateFrom) continue;
                if (filters.dateTo && v > filters.dateTo) continue;
              }
              if (svals && svals[k] !== secondVal) continue;
              matchRows.push(runStart + k);
            }
            i = j + 1;
          }
        }
      }
      exhausted = matchRows.length < target;
    } else {
      for (let i = 0; i < nRows && matchRows.length < target; i++) {
        let ok = true;
        for (let k = 0; k < cols.length; k++) {
          const v = colVals[k][i];
          if (cols[k].date) {
            if (!v) { ok = false; break; }
            if (filters.dateFrom && v < filters.dateFrom) { ok = false; break; }
            if (filters.dateTo && v > filters.dateTo) { ok = false; break; }
          } else if (v !== cols[k].val) { ok = false; break; }
        }
        if (ok) matchRows.push(i + 2);
      }
      exhausted = matchRows.length < target;
    }
    
    // `matchRows` jau ir augšupejošā secībā: reverse ceļā katra loga kārta
    // savākās rindas pārvērsa uz augšupejošu pirms pievienošanas, bet logi tika
    // apstrādāti NO BEIGĀM uz priekšu. Tāpē papildu apvēršana saliktu datus.
    const totalMatched = exhausted ? matchRows.length : Infinity;
    // ⚠️ Neizmanto `slice(offset, offset + limit)`. Apgrieztajā režīmā
    // offset ir negatīvs, un `slice(-2000, 0)` atgriež TUKŠU masīvu, jo
    // beigu indekss 0 netiek normalizēts uz garumu. Tāpēc aprēķinām
    // skaidrus, nenolādus indeksus.
    let pageStart, pageEnd;
    if (reverseScan) {
      // `skip` = cik rindas jau atgrieztas iepriekšējās lapās. Tās pēc
      // apvēršanas atrodas masīva BEIGĀ, tāpē noņemam tās un ņemam nākamās.
      const skip = -offset;
      pageEnd = Math.max(0, matchRows.length - skip);
      pageStart = Math.max(0, pageEnd - limit);
    } else {
      pageStart = offset;
      pageEnd = offset + limit;
    }
    const page = matchRows.slice(pageStart, pageEnd);
    if (page.length === 0) {
      return {
        rows: [],
        nextOffset: offset,
        done: true,
        totalMatched: totalMatched,
        scanDirection: scanDirection
      };
    }
    
    // 2. Pilno rindu nolasīšana tikai atrastajām
    const rows = [];
    const tRows = _t();
    let readCalls = 0, readRows = 0;
    for (let k = 0; k < page.length; k += 200) {
      const group = page.slice(k, k + 200);
      // Group contiguous runs into single range reads
      let runStart = group[0], runEnd = group[0];
      for (let g = 1; g <= group.length; g++) {
        const isContig = g < group.length && group[g] === runEnd + 1;
        if (isContig) { runEnd = group[g]; continue; }
        readCalls++;
        readRows += (runEnd - runStart + 1);
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
    _diag.phases.fetchRows = _t() - tRows;
    _diag.getRangeCalls += readCalls;
    _diag.cellsRead += readRows * lastCol;
    // ⚠️ Šis skaitlis ir svarīgākais par visu pārējo. Ja `fetchCalls` ir liels
    // (piem. 2000), tad rindas nolasīšana notiek secīgi pa vienu, un katrs
    // zvans maksā ~0,4 s. Kontīgu rindu apvienošana to samazināt.
    _diag.notes.push('fetched rows=' + page.length + ' in ' + readCalls + ' getRange calls');
    
    // Apgrieztajā režīmā `nextOffset` ir negatīvs un paliek negatīvs, lai
    // nākamā lapa turpinātu kustēties uz vecākiem ierakstiem. Tas jāaprēķina
    // kā offset MINUS šīs lapas rindu skaits (nevis vienkārši -page.length),
    // citādi katra lapa atgrieztu tās pašas rindas.
    const nextOffset = reverseScan ? (offset - page.length) : (offset + page.length);
    return {
      rows: rows,
      nextOffset: nextOffset,
      done: exhausted || page.length < limit,
      totalMatched: totalMatched,
      scanDirection: scanDirection
    };
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

// ───────────────────────────────────────────────────────────────────────
// ĀTRĀ RINDU MEKLĒŠANA — bez lapas nolasīšanas uz klientu
// ───────────────────────────────────────────────────────────────────────
// Problēma: `mark` katrā pieprasījumā nolasīja DIVAS lapas pilnībā —
// 225 930 rindas × 17 kolonnas ≈ 7,7 milj. šūnu — lai atrastu vienu
// ierakstu. Tas ir ~52 sekundes, un tas nav izmērojams uz lejup: pat
// šaura 6 kolonnu skēne nozīmē 1,35 milj. šūnu ≈ 17 s.
//
// Risinājums: meklēšana notiek SERVERA pusē, tāpēc klientam pārsūta
// tikai atrastās rindas, nevis visu lapu.
//
//  1. `atslēga` kolonna — deterministiska atslēga vienai atzīmei
//     (klients|darbinieks|datums|periods|kategorija|lauks).
//  2. `TextFinder` ar `matchEntireCell` → serveris atgriež pozīciju,
//     nevis šūnu vērtības. Klientam nonāk tikai viena rinda.
//
// ⚠️ SEMANTIKA SAGLABĀTA. `TextFinder.findNext()` devina rindas
// failā no augšas uz leju, tieši tāpat kā vecais cikls
// `for (let i = 0; i < data.length; i++)`. Tātad gadījumā, kad
// dublējumi eksistē, mēs joprojām ņemam VECĀKO rindu, nevis jaunāko —
// tāpat kā pirms tam. Tas nav nejaušība, tā ir bijušā uzvedība.
//
// Rezerve: ja `atslēga` kolonna vēl nav aizpildīta visām rindām,
// `_idxReady()` ir false un tiek izmantota šauru kolonnu skēne, kas
// strādā pareizi, bet ir lēna. Tāpēc pēc izvietošanas jāpalaiž
// `backfill_keys` vienu reizi — pēc tam indekse ir pilnīgs.
// ───────────────────────────────────────────────────────────────────────

// Visām neielādētajām rindām: viena koplietojama tukša rinda, lai
// masīvs būtu indeksējams ar absolūtiem rindas numuriem, bet bez
// 225 930 atsevišķu masīvu atmine.
// ⚠️ `normalizeKey()` noņem rakstu zīmes, tāpēc 'atslēga' → 'atslega'.
// Kolonnas taustiņi visur tiek ņemti ŠO formu. Rakstīt `colMap['atslēga']`
// ir klusa kļūda: tā vienmēr ir `undefined`, kolonna netiek izmantota un
// esošs ieraksts tiek dublēts. Šī konsta novērš tieši to.
var MARK_KEY_COL = 'atslega';

var _EMPTY_ROW = [];

function _sparseRows(lastRow) {
  const n = Math.max(0, lastRow - 1);
  const a = new Array(n);
  for (let i = 0; i < n; i++) a[i] = _EMPTY_ROW;
  return a;
}

// Deterministiska atslēga vienai atzīmei. Nemainās, jo visas tā
// sastāvdaļas (klients, darbinieks, datums, periods, kategorija, lauks)
// ieraksta dzīvē nevar mainīties — mainās tikai `vertiba`.
function _markKeyOf(m) {
  return [
    'k1',
    String(m.clientId || '').trim(),
    String(m.employeeId || '').trim(),
    String(m.date || '').trim(),
    String(m.shift || 'R').trim(),
    String(m.category || '').trim(),
    String(m.field || '').trim()
  ].join('|');
}

function _idxReady() {
  try {
    return PropertiesService.getScriptProperties().getProperty('atzimes_key_index_v1') === '1';
  } catch (e) { return false; }
}

function _setIdxReady(v) {
  try {
    PropertiesService.getScriptProperties().setProperty('atzimes_key_index_v1', v ? '1' : '0');
  } catch (e) { /* ignorējam */ }
}

// Servera puses meklēšana. Atgriež rindas ABSOLŪTO numuru vai -1.
function _textFindOne(sheet, col, value, fromRow) {
  if (!sheet || col === undefined || value === null || value === undefined) return -1;
  const v = String(value);
  if (v === '') return -1;
  try {
    const n = sheet.getMaxRows() - fromRow + 1;
    if (n <= 0) return -1;
    const hit = sheet.getRange(fromRow, col, n, 1)
      .createTextFinder(v)
      .matchCase(true)
      .matchEntireCell(true)
      .useRegularExpression(false)
      .findNext();
    return hit ? hit.getRow() : -1;
  } catch (e) {
    return -1;
  }
}

// Servera puses meklēšana — visas atbilsmes faila secībā (augšas→lejas).
function _textFindAll(sheet, col, value, fromRow) {
  const out = [];
  if (!sheet || col === undefined || value === null || value === undefined) return out;
  const v = String(value);
  if (v === '') return out;
  try {
    const n = sheet.getMaxRows() - fromRow + 1;
    if (n <= 0) return out;
    const finder = sheet.getRange(fromRow, col, n, 1)
      .createTextFinder(v)
      .matchCase(true)
      .matchEntireCell(true)
      .useRegularExpression(false);
    let hit = finder.findNext();
    let guard = 0;
    while (hit && guard < 50000) {
      out.push(hit.getRow());
      hit = finder.findNext();
      guard++;
    }
  } catch (e) { /* daļēji atrastās rindas tiek atgrieztas tādas kādas */ }
  return out;
}

// Rezerves meklēšana pirms indeksa aizpildīšanas: skenē TIKAI
// atslēgas kolonnas, partijās pa 2000 rindām, un atgriež VECĀKO
// atbilsmi (mazo rindas numuru), lai semantika paliktu tāda pati.
function _scanKeyFallback(sheet, col, key) {
  if (!sheet || col === undefined) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const CH = 2000;
  let best = -1;
  for (let end = lastRow; end >= 2; end -= CH) {
    const start = Math.max(2, end - CH + 1);
    const vals = sheet.getRange(start, col, end - start + 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === key) {
        const row = start + i;
        if (best === -1 || row < best) best = row;
      }
    }
  }
  return best;
}

// Rezerves meklēšana pēc atslēgas komponentēm. Tas ir vajadzīgs PIRMS
// `backfill_keys` palaišanas: legacy rindām `atslēga` ir tukša, tāpēc
// atslēgas meklēšana atrastu neko un serveris DUBLĒTU esošu klīnisko
// ierakstu. Tāpēc, kamēr indekss nav pilnīgs, meklējam pēc sešām
// atsevišķām kolonnām. Lēns (~1,35 milj. šūnu), bet KORREKTS, un pēc
// `backfill_keys` vairs nekad netiek izmantots.
function _scanCompositeFallback(sheet, colMap, m) {
  if (!sheet) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const parts = [
    ['klients_id', String(m.clientId || '')],
    ['darbinieks_id', String(m.employeeId || '')],
    ['datums', String(m.date || '')],
    ['periods', String(m.shift || 'R')],
    ['kategorija', String(m.category || '')],
    ['lauka_nosaukums', String(m.field || '')]
  ];
  const cols = [];
  for (let i = 0; i < parts.length; i++) {
    const c = colMap[parts[i][0]];
    if (c === undefined) return -1;   // kolonna nav — nevar droši meklēt
    cols.push({ col: c + 1, want: parts[i][1] });
  }
  const CH = 2000;
  let best = -1;
  for (let end = lastRow; end >= 2; end -= CH) {
    const start = Math.max(2, end - CH + 1);
    const n = end - start + 1;
    const vals = sheet.getRange(start, 1, n, sheet.getLastColumn()).getValues();
    for (let i = 0; i < n; i++) {
      const r = vals[i];
      let ok = true;
      for (let c = 0; c < cols.length; c++) {
        if (String(r[cols[c].col - 1]) !== cols[c].want) { ok = false; break; }
      }
      if (ok) {
        const row = start + i;
        if (best === -1 || row < best) best = row;
      }
    }
  }
  return best;
}

// Ielādē TIKAI tās rindas, kas `mark` ceļam patiešām vajag, un pilda
// rezultātu retajā masīvā, tā lai zemākais kods (rindas numuri kā
// masīva indeksi) darbojas nemainīts.
function _loadMarkContext(atzimesSheet, logSheet, atzimesColMap, logColMap, m) {
  const lastColA = atzimesSheet.getLastColumn();
  const lastColL = logSheet.getLastColumn();
  const atz = _sparseRows(atzimesSheet.getLastRow());
  const log = _sparseRows(logSheet.getLastRow());

  function put(arr, sheet, lastCol, row) {
    if (row >= 2 && row - 2 < arr.length) arr[row - 2] = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  }

  // ⚠️ N+1. Vienā klientā var būt simti žurnāla rindu. Ja katru lasītu
  // atsevišķi, tas ir simti `getRange` zvani un katrs no tiem uz šī
  // servera maksā ~0,5–2 s. Tāpēc rindas SALĪM KOJUMS un lasām pa
  // partijām — desmit rindu vietā viens zvans.
  function putMany(arr, sheet, lastCol, rows) {
    if (!rows || rows.length === 0) return;
    const sorted = rows.slice().sort(function (a, b) { return a - b; });
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      const startRow = sorted[i];
      const n = sorted[j] - sorted[i] + 1;
      if (startRow >= 2 && startRow - 2 + n <= arr.length) {
        const vals = sheet.getRange(startRow, 1, n, lastCol).getValues();
        for (let k = 0; k < n; k++) arr[startRow - 2 + k] = vals[k];
      }
      i = j + 1;
    }
  }

  // 1) Dublējuma pārbaude pēc action_id
  if (m.actionId && atzimesColMap['action_id'] !== undefined) {
    const r = _phase('ctx_actionId', function () {
      return _idxReady()
        ? _textFindOne(atzimesSheet, atzimesColMap['action_id'] + 1, m.actionId, 2)
        : _scanKeyFallback(atzimesSheet, atzimesColMap['action_id'] + 1, String(m.actionId));
    });
    put(atz, atzimesSheet, lastColA, r);
  }

  // 2) Esošā atzīme pēc atslēgas
  let keyRow = -1;
  if (atzimesColMap[MARK_KEY_COL] !== undefined) {
    const key = _markKeyOf(m);
    keyRow = _phase('ctx_markKey', function () {
      return _idxReady()
        ? _textFindOne(atzimesSheet, atzimesColMap[MARK_KEY_COL] + 1, key, 2)
        : _scanKeyFallback(atzimesSheet, atzimesColMap[MARK_KEY_COL] + 1, key);
    });
    // ⚠️ Ja atslēgas meklēšana neko neatradusi UN indekse vēl nav pilnīgs,
    // tā vēl nenozīmē, ka ieraksta nav — tā var būt legacy rinda bez
    // atslēgas. Tādā gadījumā meklējam pēc komponentēm, lai NEJAUBLĒ
    // esošu klīnisko ierakstu.
    if (keyRow === -1 && !_idxReady()) {
      keyRow = _phase('ctx_componentFallback', function () {
        return _scanCompositeFallback(atzimesSheet, atzimesColMap, m);
      });
    }
    put(atz, atzimesSheet, lastColA, keyRow);
  }

  // 3) Šī klienta visas žurnāla rindas (slimnica/status pārbaudē).
  //    ⚠️ Šis skēns TIEK darīts UZREZ, nevis atlikts. Slimnīcas statusa
  //    pārbaude notiek PIRMS "vērtība tāda pati" atvārtes, tāpēc tā
  //    atlikšana nozīmētu mainīt atbildi no `blocked` uz `already_processed`.
  if (m.clientId && logColMap['klients_id'] !== undefined) {
    _phase('ctx_logForClient', function () {
      putMany(log, logSheet, lastColL, _textFindAll(logSheet, logColMap['klients_id'] + 1, String(m.clientId), 2));
    });
  }

  // 4) Šī atzīmes žurnāla rindas.
  //
  //    ⚠️ Tās JĀBŪT jau ielādētas augstāk esošajā klienta skēnā. Katra
  //    atzīmes žurnāla rinda satur arī `klients_id`, un atzīmes atslēga
  //    arī ietver klienta id. Tāpēc "šai atzīmei" rindas ir TIEK ĀRVAL
  //    no "šī klienta" rindām, un atsevišķs skēns būtu dublēts darbs
  //    par ~1 s uz katru pieprasījumu.
  //
  //    Šis skēns paliek TIKAI degradētai situācijai, kad `klients_id`
  //    kolonnas nav vispār un klienta skēns nevarēja notikt.
  const markId = (keyRow > 0 && atzimesColMap['id'] !== undefined)
    ? atz[keyRow - 2][atzimesColMap['id']]
    : null;
  const clientScanDone = logColMap['klients_id'] !== undefined;
  let markLogLoaded = false;
  const loadMarkLog = function () {
    if (markLogLoaded || clientScanDone) return;
    markLogLoaded = true;
    if (!markId || logColMap['atzimes_id'] === undefined) return;
    _phase('ctx_logForMark', function () {
      putMany(log, logSheet, lastColL, _textFindAll(logSheet, logColMap['atzimes_id'] + 1, String(markId), 2));
    });
  };

  return {
    atzimesData: atz,
    logData: log,
    keyRow: keyRow,
    markId: markId,
    loadMarkLog: loadMarkLog
  };
}

// Tā pati atslēga, bet no esošās rindas. ⚠️ Šeit `periods` NEDRĪKst saņemt
// 'R' noklusējumu, atšķirībā no `_markKeyOf`. Vecais kods salīdzināja
// `String(rinde.periods) === String(m.shift || 'R')`, tāpēc rinda ar tukšu
// `periods` patiešām neatbilst atzīmei ar noklusēto 'R'. Ja šeit
// noklusējumu pievienotu, tādas rindas kļūtu nepareizi atrodamas.
function _markKeyFromRow(r, colMap) {
  const g = function (name) {
    const c = colMap[normalizeKey(name)];
    return c === undefined ? '' : String(r[c] || '').trim();
  };
  return ['k1', g('klients_id'), g('darbinieks_id'), g('datums'), g('periods'), g('kategorija'), g('lauka_nosaukums')].join('|');
}

// 🔧 VIENREIZĒJS UZTURĒŠANAS PASĒMIENS. Aizpilda `atslēga` kolonnu visām
// esošajām rindām, lai `mark` varētu meklēt ātri un precīzi.
//
// ⚠️ KAMĒR ŠIS NAV PABEIGTS, `_idxReady()` ir false un `mark` izmanto lēno,
// bet KORREKTO rezerves skēni pa komponentēm. Tātad neizpildīts backfill
// neizjauc datus — tas tikai paliek lēns. Kad pabeigts, `_idxReady()` kļūst
// true un rezerves ceļš vairs netiek lietots.
//
// Lietošana: `?data={"action":"backfill_keys"}` atkārto līdz `done:true`.
function handleBackfillKeys() {
  const sheet = getSheet('atzimes');
  ensureColumns(sheet, ['action_id', 'maina_tips', 'notikuma_laiks', 'last_modified', 'version', 'atslēga']);
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const colMap = {};
  headers.forEach((h, i) => { colMap[normalizeKey(h)] = i; });
  const keyCol = colMap[MARK_KEY_COL];
  if (keyCol === undefined) return { error: 'atslēga kolonna nav pieejama' };

  const props = PropertiesService.getScriptProperties();
  const lastRow = sheet.getLastRow();
  const CHUNK = 10000;
  let cursor = parseInt(props.getProperty('atzimes_key_cursor') || '', 10);
  if (isNaN(cursor) || cursor < 2) cursor = 2;

  const lock = LockService.getScriptLock();
  try { lock.waitLock(60000); } catch (e) { return { error: 'Sistēma aizņemta, mēģini vēlreiz' }; }
  try {
    const end = Math.min(lastRow, cursor + CHUNK - 1);
    if (end < cursor) {
      props.setProperty('atzimes_key_cursor', '2');
      _setIdxReady(true);
      return { done: true, totalRows: lastRow, note: 'Indekss jau bija pabeigts' };
    }

    // 1) Nolasām tikai rindas ar atslēgas kolonnu + sešām komponentēm,
    //    nevis visu rindu — tas ir 7 kolonnas, nevis 17.
    const need = [];
    ['klients_id', 'darbinieks_id', 'datums', 'periods', 'kategorija', 'lauka_nosaukums']
      .forEach(n => { const c = colMap[normalizeKey(n)]; if (c !== undefined) need.push(c); });
    need.push(keyCol);
    const startCol = Math.min.apply(null, need);
    const width = Math.max.apply(null, need) - startCol + 1;

    // ⚠️ `colMap` un `keyCol` ir 0-bāzēti, bet `getRange` kolonnas
    // paņem 1-bāzēti. Bez `+1` atslēgas tiktu rakstītas `last_modified`
    // kolonnā un tā tiktu izdzīsta, kas nogāztu OCC konfliktus.
    const rows = sheet.getRange(cursor, startCol + 1, end - cursor + 1, width).getValues();
    const out = rows.map(r => {
      // ⚠️ `colMap` indeksi ir absolūti (skaitīti no 1. kolonnas), tāpēc
      // rindu pārvietojam atpakaļ uz absolūtajām pozīcijām. Citādi
      // komponentu kolonnas tiktu lasītas no nepareizām vietām.
      const shifted = new Array(lastCol);
      for (let i = 0; i < width; i++) shifted[startCol + i] = r[i];
      const cur = String(shifted[keyCol] || '').trim();
      if (cur) return [cur];
      return [_markKeyFromRow(shifted, colMap)];
    });
    sheet.getRange(cursor, keyCol + 1, end - cursor + 1, 1).setValues(out);

    const next = end + 1;
    props.setProperty('atzimes_key_cursor', String(next));
    const done = next > lastRow;
    if (done) {
      props.deleteProperty('atzimes_key_cursor');
      _setIdxReady(true);
    }
    return {
      done: done,
      fromRow: cursor,
      toRow: end,
      totalRows: lastRow,
      remaining: Math.max(0, lastRow - end),
      pct: lastRow > 1 ? Math.round((end / (lastRow - 1)) * 100) : 100,
      indexReady: _idxReady()
    };
  } finally {
    lock.releaseLock();
  }
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

  // ⚠️ Diagnostika. Rakstīšanas ceļš agrāk nebija mērīts, un tas slēpa
  // 74 sekundes uz vienu `mark`. Tagad katrs posms ir redzams.
  _diag.notes.push('action=' + (data && data.action ? data.action : '?'));

  // `ensureColumns` jau nolasīja galvenes rindu. Agrāk tā tika nolasīta
  // VĒL REIZ, lai uzbūvētu kolonnu vārdnīcu — divas identiskas nolasīšanas
  // uz katru no trim lapām, ~0,4 s katra uz šī servera.
  let atzimesHeaders = null;
  let logHeaders = null;
  _phase('ensureColumns', function () {
    atzimesHeaders = ensureColumns(atzimesSheet, ['action_id', 'maina_tips', 'notikuma_laiks', 'last_modified', 'version', 'atslēga']);
    logHeaders = ensureColumns(logSheet, ['id', 'atzimes_id', 'klients_id', 'darbinieks_id', 'datums', 'laiks', 'periods', 'kategorija', 'lauka_nosaukums', 'vertiba', 'skaits', 'notikuma_laiks', 'pedeja_vertiba', 'pedeja_laiks', 'darbinieks_pedejais', 'action_id', 'maina_tips']);
  });
  _phase('ensureColumnsMark', function () {
    ensureColumns(klientiSheet, ['slimnica', 'statuss', 'statusa_laiks', 'statusa_darbinieks_id']);
  });

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
      const opFound = _phase('findOperation', function () { return findOperation(operationId); });
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
        _phase('registerOperation', function () {
          registerOperation(
            operationId, m.employeeId, 'mark',
            m.clientId || null, m.lastModified || ''
          );
        });
      }
    }

    // Get all data at once to minimize API calls
    const atzimesLastRow = atzimesSheet.getLastRow();
    const logLastRow = logSheet.getLastRow();
    
    // Build column maps once
    // ⚠️ Rezerve: ja `ensureColumns` šajā izpuldē neizpildīja galvenes
    // rindu (tā jau bija pārbaudīta), to nolasām pašreizējā brīdī.
    if (!atzimesHeaders) atzimesHeaders = atzimesSheet.getRange(1, 1, 1, atzimesSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    if (!logHeaders) logHeaders = logSheet.getRange(1, 1, 1, logSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const atzimesColMap = {};
    const logColMap = {};
    atzimesHeaders.forEach((h, i) => { atzimesColMap[normalizeKey(h)] = i; });
    logHeaders.forEach((h, i) => { logColMap[normalizeKey(h)] = i; });
    
    // Ielādējam TIKAI vajadzīgās rindas. Vecais kods šeit nolasīja divas
    // lapas pilnībā (7,7 milj. šūnu, ~52 s) — pat ja bija vajadzīga viena.
    const ctx = _phase('loadContext', function () {
      return _loadMarkContext(atzimesSheet, logSheet, atzimesColMap, logColMap, m);
    });
    const atzimesData = ctx.atzimesData;
    const logData = ctx.logData;

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

    // Find existing mark.
    // `_loadMarkContext` jau atrada rindu pēc atslēgas, un tā ir TĀ PATI
    // rinda, ko atradtu šis cikls (abas ņem pirmo atbilsmi failā no
    // augšas). Šeit vairs nav ko skēnot — 225 931 iterācijas velti.
    let existingMarkRow = -1;
    let existingMarkValue = '';
    if (ctx.keyRow > 0) {
      existingMarkRow = ctx.keyRow;
      existingMarkValue = String(atzimesData[existingMarkRow - 2][atzimesColMap['vertiba']]);
    } else if (atzimesColMap[MARK_KEY_COL] === undefined) {
      // ⚠️ Rezerves variants: ja `atslēga` kolonnas vispār nav lapa,
      // meklēšana pa atslēgu nevarēja notikt, tāpēc pārbaudām komponentus.
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
    }

    const modificationTime = getModificationTimeFromPayload(m);
    const existingMarkData = existingMarkRow > 0 ? atzimesData[existingMarkRow - 2] : null;
    const existingMarkId = existingMarkData ? existingMarkData[atzimesColMap.id] : null;
    // Notikuma laiku rēķinām TIKAI rakstīšanas ceļā — skēns rādītajām
    // žurnāla rindām maksā ~1 s, un lielākajā daļā pieprasījumu, kas
    // šo ierakstu atkārto, rakstīšana vispār nenotiek.
    let existingEventTime = null;
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

    const updates = []; // Batch updates to apply at once

    // Status toggle detection: category=slimnica, field=statuss
    const isStatusToggle = (normalizeKey(m.field) === 'statuss' && String(m.category || '').toLowerCase() === 'slimnica');

    // Server-side enforcement: if the client is currently in hospital, non-status
    // care marks must be rejected. Status toggles are always allowed.
    if (!isStatusToggle) {
      const hospitalNow = _phase('clientStatus', function () {
        return getLatestClientStatus(logData, logColMap, m.clientId) || isClientHospitalRow(klientiSheet, m.clientId);
      });
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

    // ───────────────────────────────────────────────────────────────────
    // Notikuma laiks vajag TIKAI rakstīšanas ceļā. Žurnāla rindas šai
    // atzīmei jau ir ielādētas ar klienta skēnu, tāpēc šeit parasti
    // nekas nenotiek — ja nu vien klienta skēns nevarēja notikt.
    // ───────────────────────────────────────────────────────────────────
    if (existingMarkData) {
      ctx.loadMarkLog();
      existingEventTime = _phase('existingEventTime', function () {
        return getEventTimeForExistingMark(existingMarkData, atzimesColMap, logData, logColMap, existingMarkId);
      });
    }

    const eventTime = getEventTimeFromPayload(m, existingEventTime || modificationTime, m.date);
    const eventDateRiga = formatDate(eventTime);
    const eventTimeRiga = formatTimeOnly(eventTime);
    const eventDateTimeRiga = formatDateTimeLV(eventTime);
    const modificationDateTimeRiga = formatDateTimeLV(modificationTime);

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
      if (atzimesColMap['version'] !== undefined) {        const currentVer = parseInt(atzimesData[existingMarkRow - 2][atzimesColMap['version']], 10);
        updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap['version'] + 1, value: isNaN(currentVer) ? 1 : currentVer + 1 });
      }
      // 🔧 Pašizlabošanās: ja esošajā rindā `atslēga` ir tukša (legacy ieraksts,
      // kas izveidots pirms indeksa), to aizpildām tagad. Bez tā šī rinda
      // paliktu nemanāma adresēšanai un nākamais atjauninājums to dublētu.
      if (atzimesColMap[MARK_KEY_COL] !== undefined) {
        const cell = atzimesData[existingMarkRow - 2][atzimesColMap[MARK_KEY_COL]];
        if (!String(cell || '').trim()) {
          updates.push({ sheet: atzimesSheet, row: existingMarkRow, col: atzimesColMap[MARK_KEY_COL] + 1, value: _markKeyOf(m) });
        }
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
      _phase('write', function () {
        updates.forEach(u => u.sheet.getRange(u.row, u.col).setValue(u.value));
      });

      // Append log row
      _phase('writeLog', function () {
        if (logData.length > 0) {
          logSheet.getRange(logLastRow + 1, 1, 1, logHeaders.length).setValues([logRow]);
        } else {
          logSheet.getRange(2, 1, 1, logHeaders.length).setValues([logRow]);
        }
      });

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
      else if (nk === MARK_KEY_COL) markRow[i] = _markKeyOf(m);
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
    _phase('write', function () {
      atzimesSheet.getRange(atzimesLastRow + 1, 1, 1, atzimesHeaders.length).setValues([markRow]);
    });
    _phase('writeLog', function () {
      if (logData.length > 0) {
        logSheet.getRange(logLastRow + 1, 1, 1, logHeaders.length).setValues([logRow]);
      } else {
        logSheet.getRange(2, 1, 1, logHeaders.length).setValues([logRow]);
      }
    });
    
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

// ⚠️ `ensureColumns` katru reizi darīja 2 `getRange` zvanus pat tad, ja visas
// kolonnas jau bija vietā. Tā tiek izsaukta ~5–8 reizes uz katru pieprasījumu
// (katrs klientu/atzīmju/logu/uzdevumu izsaukums + operation_registry), un
// `_diag` to rādīja par 2 234 ms tīru izmaksu katrā pieprasījumā.
//
// Šeit vienas izpildes laikā kolonnu struktūra nevar mainīties — mēs to pati
// esam vienīgie, kas tās pievieno, un tā notiek šīs pašas funkcijas laikā.
// Tāpēc pārbaudīto kolonnu rezultātu var atcerēties, un otrā izsaukuma
// laikā tā ir bezmaksas (0 zvani).
var _ensuredCols = {};

// ⚠️ `_ensuredCols` ir kešs TIKAI vienas izpildes ietvaros. Katrs HTTP
// pieprasījums ir jauna izpilde, tāpēc tas sākas tukšs, un `_diag` katrā
// pieprasījumā rādīja `ensureColumns = 373–1396 ms` — 5 lapas × 2 zvani
// pirms katra pieprasījuma, pat ja nekas netika mainīts.
//
// Šeit tiek pievienots PIESTĀVĪGS atzīmes: kad shēma ir pārbaudīta, tā
// tiek atzīmēta Script Properties, un nākamie pieprasījumi to izlaiž.
//
// ⚠️ ŠĪ IR TIKAI DARĪT, KAD SHĒMA TIEK MAINĪTA. Katru reizi, kad kodā
// pievieno vai noņem kolonnu, ir jāpiedaļina `SCHEMA_VERSION`. Tas ir
// iespējama neuzticamības vieta: ja kāds manuāli izdzēs kolonnu, tas tiks
// pamanīts tikai pēc šī īpašuma izdzēšanas. Savukārt, ja īpašums ir
// nepareizs, rakstīšana aizietu nepareizā kolonnā.
const SCHEMA_VERSION = 'v3';

function _schemaReady() {
  try {
    return PropertiesService.getScriptProperties().getProperty('aprupes_schema_' + SCHEMA_VERSION) === '1';
  } catch (e) { return false; }
}

function _setSchemaReady() {
  try {
    PropertiesService.getScriptProperties().setProperty('aprupes_schema_' + SCHEMA_VERSION, '1');
  } catch (e) { /* ignorējam — tad nākamais pieprasījums pārbaudīs vēlreiz */ }
}

// 🔧 Atgriež galvenes rindu (arī pēc kolonnu pievienošanas), ja tā tika
// nolasīta, vai `null`, ja šī izpilde jau bija pārbaudījusi kolonnas.
// Ātriem zvaniem tas nozīmē, ka galvenes rinda tiek nolasīta VIENREIZ,
// nevis divreiz — vienu reizi šeit, otru tās pašas lapas kolonnu vārdnīcai.
// Divas nolasīšanas bija tukšas tāpēc, ka katrs `getRange` uz šī servera
// maksā ~0,4 s.
function ensureColumns(sheet, requiredColumns) {
  if (!sheet) return null;
  var key;
  try { key = sheet.getName(); } catch (e) { key = null; }
  if (!key) key = 'id_' + (sheet.getSheetId ? sheet.getSheetId() : 'x');

  var seen = _ensuredCols[key];
  if (!seen) { seen = _ensuredCols[key] = {}; }

  // Atliekam tikai tās kolonnas, ko vēl neesam pārbaudījuši šajā izpildē.
  var toCheck = [];
  for (var i = 0; i < requiredColumns.length; i++) {
    var c = requiredColumns[i];
    if (!seen[normalizeKey(c)]) toCheck.push(c);
  }
  if (toCheck.length === 0) return null;   // ✅ 0 zvani

  // ⚠️ Piestāvīgs ātrums. Ja shēma jau ir apstiprināta, katrai lapai nav
  // jālasa galvenes rinda — tas noņem 2 zvanus uz katru no 5 lapām, un tas
  // bija lielākais fiksētais izmaksas postenis katrā pieprasījumā.
  //
  // `toCheck.length > 0` ar no šeit ir Vecais skēns, kas pārbauda arī tās
  // kolonnas, ko šī izpilde jau apstiprināja, bet kuras šī izpilde vēl nav
  // atzīmējusi. Pēc pirmā pilnā pārbaudes šis ceļš vairs netiek izmantots.
  if (_schemaReady() && toCheck.length === requiredColumns.length) {
    for (var k = 0; k < toCheck.length; k++) seen[normalizeKey(toCheck[k])] = true;
    return null;
  }

  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null; // Sheet is empty — no columns to inspect
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  var missing = toCheck.filter(col => !headers.some(h => normalizeKey(h) === normalizeKey(col)));
  if (missing.length > 0) {
    missing.forEach((col, i) => {
      sheet.getRange(1, lastCol + 1 + i).setValue(col);
    });
  }
  // Atzīmējam pārbaudītās — arī tās, kas jau bija vietā, jo tās pēc tam
  // nevar izzust.
  for (var j = 0; j < toCheck.length; j++) seen[normalizeKey(toCheck[j])] = true;
  // Shēma ir pārbaudīta visā, nevis tikai šajā izpildē — nākamie
  // pieprasījumi to izlaiž (skatīt `_schemaReady`).
  _setSchemaReady();
  // ⚠️ Atgriežam galveni ARĀ pievienotajām kolonnām. Ja atgrieztu
  // sākotnējo, kolonnu vārdnīca būtu neprecīza un rakstīšana aizietu
  // nepareizā kolonnā.
  return headers.concat(missing);
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
