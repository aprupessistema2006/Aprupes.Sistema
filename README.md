# Aprūpes sistēma

A web-based social care documentation system for recording eldercare and disability support care. The system is built as a Progressive Web App (PWA) with offline capability, using Google Sheets as the authoritative data source via a Google Apps Script backend.

## Key Features

- **Three user roles**: aprūpētājs (caregiver), kontroliere (controller), administrators
- **Offline-first**: Uses IndexedDB as a local cache; changes are queued and synced when connectivity is restored
- **Multi-language**: Latvian (LV), Russian (RU), and English (EN) interfaces
- **Two shift types**: Rīts (Morning, R) and Vakars (Evening, V)
- **Care documentation**: Temperature, hygiene, activity, meals, fluid intake/output, bowel movements, skin care, walks, visitors, diaper changes, and signatures
- **Task management**: Assignable, prioritizable tasks with deadline tracking
- **Excel export**: Monthly care documentation generated from an Excel template (`Aprūpes lapas.xlsx`)
- **Duplicate prevention**: Server-side deduplication via `actionId` and local debouncing

## Architecture Overview

```
Google Sheets (source of truth)
    ↑ (JSONP/CORS via script tag)
Google Apps Script (backend/gas_webhook.gs)
    ↓ (JSON)
js/sync.js → requestData() → normalizeRow()
    ↓ (IndexedDB via CareDB)
js/db.js → IndexedDB stores
    ↓ (DOM rendering)
HTML pages → category forms → care_form.js / aprupe.js / admin.js / control.js
```

### Data Flow

1. **Initial load**: `CareSync.loadInitialData()` fetches all sheet data via the GAS webhook URL (`CONFIG.GAS_URL`)
2. **Normalization**: `normalizeRow()` in `js/sync.js` maps Google Sheets column names (Latvian, with diacritics) to camelCase keys and handles date parsing from ID timestamps
3. **Storage**: Normalized data is stored in IndexedDB via `CareDB.replaceStores()` across five stores: `darbinieki`, `klienti`, `atzimes`, `atzimes_log`, `uzdevomi`
4. **Caching**: Sync status is tracked in a `meta` store; pending changes go to a `sync_queue` store
5. **Event-driven updates**: The `syncComplete` custom event triggers UI re-renders across all page controllers
6. **Offline detection**: `window.addEventListener('online'/'offline')` triggers `forceFullSync()` on reconnection

### Communication with Backend

- The GAS backend does not send CORS headers on POST, so the system uses **JSONP** (script tag injection) as the primary transport method
- `requestData()` tries `fetch` with CORS first, then falls back to `jsonpRequest()` with a 10-second timeout and retry logic
- Write operations use `postAction()` which is an alias for `jsonpAction()` with request deduplication via the `pendingActions` Map
- Each write operation includes a unique `actionId` to prevent duplicate processing on the server

### Google Apps Script Backend (`backend/gas_webhook.gs`)

Exposes two entry points:

| HTTP Method | Parameters | Purpose |
|-------------|-----------|---------|
| `doGet` | `action`, `data`, `callback` | Data loading (`action=load`) and write operations (via `data` JSON parameter) |
| `doPost` | POST body (JSON) | Write operations (create/update marks, tasks, clients, employees) |
| `doOptions` | — | CORS preflight handler |

**Supported actions** (via `routeActionData`):

| Action | Handler | Sheet | Description |
|--------|---------|-------|-------------|
| `ping` | — | — | Health check, returns `{ success: true, pong: true }` |
| `load` | `handleLoadData` | All | Fetches all sheets with optional filtering by `clientId`, `employeeId`, `dateFrom`, `dateTo`, `limit` |
| `createClient` | `handleCreateClient` | `klienti` | Creates a new client with duplicate name checking |
| `createEmployee` | `handleCreateEmployee` | `darbinieki` | Creates a new employee with duplicate name+role checking |
| `updateClient` | `handleUpdate` | `klienti` | Updates a client by `id` |
| `updateEmployee` | `handleUpdate` | `darbinieki` | Updates an employee by `id` |
| `mark` | `handleMark` | `atzimes` + `atzimes_log` | Creates or updates a care mark; writes a log entry |
| `createTask` | `handleCreateTask` | `uzdevomi` | Creates a task with `actionId` deduplication |
| `updateTask` | `handleUpdateTask` | `uzdevomi` | Updates task status, completion, and timestamps |

All timestamps are converted to `Europe/Riga` timezone on the backend using `Utilities.formatDate(v, TZ, format)`. Date fields use `yyyy-MM-dd`, time fields use `HH:mm:ss`.

## Project Structure

```
Aprupes_sistema/
├── index.html              # Login page — PIN-based authentication
├── aprupe.html             # Caregiver start page — client list + task table
├── aprupetajs.html         # Client detail page — care form with categories
├── admin.html              # Admin panel — dashboard, client/employee management
├── control.html            # Controller panel — stats, history, Excel export, month view
├── Aprūpes lapas.xlsx      # Excel template for monthly care documentation
├── backend/
│   └── gas_webhook.gs      # Google Apps Script backend (all data operations)
├── js/
│   ├── config.js           # Configuration constants (GAS_URL, SHEET_ID, field definitions, shift options)
│   ├── i18n.js             # Multi-language translations (LV/RU/EN) with setLang/applyLanguage
│   ├── timezone.js         # Timezone utilities (Europe/Riga) using Intl.DateTimeFormat
│   ├── db.js               # IndexedDB wrapper (CareDB) with in-memory fallback
│   ├── sync.js             # Synchronization engine (CareSync) — load, queue, sync, network detection
│   ├── login.js            # Login controller — PIN auth, setup mode, employee selection
│   ├── logout.js           # Logout with pending changes confirmation and sync option
│   ├── tasks.js            # Task manager — load, filter, create, complete, reopen tasks
│   ├── aprupe.js           # AprupeController — client list page logic
│   ├── care_form.js        # CareFormController — client detail page with care categories and signature
│   ├── admin.js            # AdminPanel — dashboard, CRUD for clients/employees, backups, duplicate detection
│   ├── control.js          # ControlPanel — stats, history table, Excel export, month view rendering
│   └── excel_export.js     # ExcelExporter — generates monthly Excel files from template
├── css/
│   ├── index.css           # Login page styles (splash screen, login card, language switcher)
│   ├── aprupe.css          # Caregiver start page styles (client grid, task table)
│   ├── aprupetajs.css      # Client detail page styles (category grid, modal, signature card)
│   └── admin.css           # Admin and controller panel styles (shared by admin.html and control.html)
├── scripts/                    # (referenced in package.json, not present in repo)
├── package.json            # Node.js config (exceljs, xlsx dependencies; dev server and build scripts)
├── DUPLICATE_FIX_README.md # Documentation of duplicate prevention measures
└── test*.js                # Test files (test, test_e2e, test_duplicate_*, test_gas_style, etc.)
```

## Google Sheets Structure

The system uses the following sheets (identified by `SHEET_ID` in `config.js`):

| Sheet Name | Description |
|------------|-------------|
| `darbinieki` | Employees (name, role, PIN, active status) |
| `klienti` | Clients (name, birth date, diet, contact info, active status) |
| `atzimes` | Care marks/records (client, employee, date, shift, category, field, value) |
| `atzimes_log` | Audit log of all care mark changes (new entries, edits) |
| `uzdevomi` | Tasks assigned to employees (text, deadline, priority, status) |

**Key columns in `atzimes`** (care marks):
- `id` — unique identifier (format: `m_` + timestamp)
- `klients_id` — client ID
- `darbinieks_id` — employee ID
- `datums` — date in Europe/Riga timezone
- `laiks` — time in HH:mm:ss format
- `periods` — shift: `R` (Rīts) or `V` (Vakars)
- `kategorija` — care category (see Field Definitions below)
- `lauka_nosaukums` — field name within the category
- `vertiba` — the recorded value
- `pedeja_laiks` — last modified timestamp
- `action_id` — deduplication key for sync

**Key columns in `uzdevomi`** (tasks):
- `id` — unique identifier (format: `t_` + timestamp)
- `teksts` — task description
- `klients_id` — optional client ID
- `piešķirt_darbiniekam_id` — assigned employee ID
- `termins` — deadline date
- `prioritate` — `augsta` (high), `videja` (medium), or `zema` (low)
- `statuss` — `jauns` (new), `procesā` (in progress), or `pabeigts` (completed)
- `pabeigts` — boolean completion flag
- `izveidots` — creation timestamp
- `izveidotajs_id` — creator employee ID
- `pabeigts_laiks` — completion timestamp
- `pabeigtajs_id` — completing employee ID
- `action_id` — deduplication key for sync

## Field Definitions

Defined in `js/config.js` under `FIELD_DEFINITIONS`, the care categories and their fields are:

| Category Key | Label (LV) | Fields |
|-------------|-----------|--------|
| `temp` | Temperatūra | `temperatura` (number, °C; ≥37 = fever) |
| `higiena` | Higiēna | 7 toggle fields: mutes dobuma kopšana, vana/duša, daļēja apmazgāšana, veļas maiņa, nagu kopšana, matu kopšana, bārdas skūšana |
| `aktivitate` | Aktivitāte | 3 toggle fields: parvietojas ar palīglīdzekli, stāv ar palīdzību, sēž ar palīdzību |
| `edinasana` | Ēdīšana | 4 food fields: brokastis, pusdienas, launags, vakariņi (values: X = full, ½ = half, A = refused) |
| `sikdrumi` | Šķidrumi | `urina_daudzums` (number, ml), `uznemts_ml` (number, ml) — cumulative within shift |
| `fiziologija` | Fiziologija | `vedera_izeja` (select: N=Normal, A=Constipation, S=Diarrhea, C=Constipated, K=Laxative) |
| `citsi_pasakomi` | Citi pasākumi | `adas_kopsana` (toggle), `pastaigas` (toggle), `ciemini` (toggle: X/Nē), `autins_biksitu_skaits` (number, incremental) |
| `paraksts` | Paraksts | `aprupetaja_paraksts` (signature field) |

**Excel template field mapping** (`EXCEL_TEMPLATE.rowMapping` in `config.js`):
The Excel template maps 23 fields to rows 9–31, with columns offset by 2 per day (R shift = base column, V shift = base + 1).

## Synchronization

### CareSync Class (`js/sync.js`)

The `CareSync` class manages the event-driven sync architecture:

**Initialization** (`loadInitialData`):
- Runs queue processing first (to flush pending local changes)
- Fetches all data from the GAS `?action=load` endpoint
- Calls `normalizeRow()` on each row before storing in IndexedDB
- Dispatches `syncComplete` event with result summary (counts, pending count, revision)
- Falls back to local IndexedDB data when offline

**Queue processing** (`processQueue`):
- Processes items from the `sync_queue` store in chronological order
- Classifies actions as write operations (`mark`, `createTask`, `updateTask`, `createClient`, `createEmployee`, `updateClient`, `updateEmployee`) or non-write
- Write operations use `postAction()`, others use `jsonpAction()`
- Retries failed items (incrementing `retries` counter)
- Deletes items only on success
- Processes are serialized via `_runExclusive()` to prevent race conditions

**Offline support**:
- `_setupOfflineDetection()` listens for `online`/`offline` window events
- On reconnection, triggers `forceFullSync()`
- `checkConnection()` pings the backend to verify connectivity

**Request deduplication**:
- `pendingActions` Map prevents parallel identical requests
- Server-side `actionId` deduplication prevents duplicate marks/tasks on retry

## User Roles

| Role (lv) | Role (en) | Page | Permissions |
|-----------|-----------|------|-------------|
| `aprūpētājs` | Caregiver | aprupe.html, aprupetajs.html | View clients, record care marks, sign shifts, complete tasks |
| `kontroliere` | Controller | control.html | View stats, audit history, create tasks, export Excel |
| `administrators` | Administrator | admin.html, aprupetajs.html (admin mode) | Full access; create/edit clients and employees; enter caregiver mode |

### Login Flow (`js/login.js`)

1. On page load, checks `sessionStorage` for existing `careUser` — if found with `pinVerified: true`, redirects by role
2. Checks Google Sheets connectivity via `sync.checkConnection()`
3. If no remote connection and no local data → enters **setup mode** to create the first administrator
4. Loads data from Google Sheets via `sync.loadInitialData()`
5. On successful connection, loads employees from the `darbinieki` store
6. Employee selection with role filtering ( Admins, Controllers, Caregivers, or All)
7. PIN input (4-6 digits, numeric) with backspace support
8. Shift type selection: `diennakts` (night shift, 19:00–07:00) or `dienas` (day shift)
9. On login, validates PIN against `employee.pin` (local comparison), saves user to sessionStorage, plays a random encouragement message, then redirects by role

### Role-Based Redirects (`login.js` `redirectByRole`)
- `administrators` → `admin.html`
- `kontroliere` → `control.html`
- all others → `aprupe.html`

## Caregiver Mode (Admin Override)

The admin panel can act as a caregiver:
1. Click "Ieiet kā aprūpētājs" (Enter as Caregiver) button
2. Select a client and caregiver from dropdowns
3. Sets `careAdminMode=true` and `careAdminCaregiverId` in sessionStorage
4. Navigates to `aprupetajs.html?client=<id>&mode=admin&caregiverId=<id>`
5. In admin mode, the admin can sign shifts, edit records after they've been signed, and the admin's name is appended as `[ADMIN: Name]`

## Signature System (`js/care_form.js`)

- **Who can sign**: Night shift (`diennakts`) employees and administrators
- **When**: Each shift (R/V) per day has a separate signature
- **Immutability**: For non-admins, a signed shift cannot be edited (`isShiftSigned()` check)
- **Admin override**: Admins can re-sign or sign a different shift for the current caregiver's identity
- Signatures are stored as marks with `category: 'paraksts'` and `field: 'aprupetaja_paraksts'`

## Excel Export (`js/excel_export.js`)

Uses the `ExcelJS` library and an Excel template file (`Aprūpes lapas.xlsx`) to generate monthly care documentation:

- **Template sheets**: `APRŪPES DOKUMANTĀCIJA_1` (days 1-15) and `APRŪPES DOKUMANTĀCIJA_2` (days 16-31)
- **Data mapping**: Row 9 = temperature, rows 10–16 = hygiene fields, rows 17–19 = activity, rows 20–23 = meals, row 24 = urine, row 25 = H2O, rows 26–31 = other activities and signature
- **Columns**: Each day gets 2 columns (R shift base, V shift base+1), starting at column 2
- **Summary rows**: Auto-generated at the end with totals for urine, H2O, and diaper changes
- Available in `control.html` (controller panel)

## Month View (`js/control.js`)

The controller panel includes a month view feature that renders a grid of all care marks:
- Rows = care categories and fields (23 rows as defined in `fieldMap`)
- Columns = days of the month, with separate columns for R and V shifts
- Signature cells are filtered for admin override tags
- Numeric fields (urine, H2O, diaper changes) are summed per shift and overall

## Configuration (`js/config.js`)

All configuration is centralized in a single `CONFIG` object:

| Property | Value |
|----------|-------|
| `APP_NAME` | `Aprūpes sistēma` |
| `VERSION` | `1.0.0` |
| `GAS_URL` | Google Apps Script deployment URL |
| `SHEET_ID` | `1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E` |
| `TIMEZONE` | `Europe/Riga` |
| `SHIFTS` | `{ R: 'Rīts', V: 'Vakars' }` |
| `ROLES` | `{ aprupetas: 'aprūpētājs', kontroliere: 'kontroliere', admins: 'administrators' }` |
| `STORES` | IndexedDB store name mappings |

## Internationalization (`js/i18n.js`)

The `I18N` object contains translation dictionaries for `lv`, `ru`, and `en` with over 300 keys covering all UI text, status messages, role labels, date/time terms, and error messages.

Language switching is handled by:
- `setLang(lang)` — sets the current language and saves to `localStorage`
- `applyLanguage()` — translates all `data-i18n` attributes in the DOM
- `t(key)` — shorthand function returning the translation for the current language

The `t()` function is available globally and used throughout all controllers.

## Timezone Handling (`js/timezone.js`)

All date/time operations use `Europe/Riga` timezone via `Intl.DateTimeFormat`:

| Method | Returns |
|--------|---------|
| `getNowRiga()` | Current `Date` object |
| `getHourRiga(date)` | Hour (0–23) in Riga time |
| `getTodayRiga()` | Today's date as `YYYY-MM-DD` in Riga time |
| `getTimeRiga()` | Current time as `HH:mm:ss` in Riga time |
| `getDateTimeRiga()` | Combined `YYYY-MM-DD'T'HH:mm:ss` |
| `formatDateRiga(date)` | Date as `YYYY-MM-DD` (handles ISO strings and Date objects) |
| `formatTimeRiga(date)` | Time as `HH:mm:ss` |
| `formatDateTimeRiga(date)` | Combined date-time string |
| `offsetDaysRiga(days)` | Date offset by N days (negative for past) |
| `isSameDay(date1, date2)` | Boolean comparison |
| `isTodayRiga(date)` | Boolean: is the given date today in Riga time |

## Running the Application

### Prerequisites

- A Google account with access to the Google Sheet (SHEET_ID: `1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E`)
- Node.js 14+ (for Excel export and test scripts)

### Setup

1. Deploy `backend/gas_webhook.gs` to Google Apps Script and set up the `doGet` and `doPost` endpoints
2. Ensure the Google Sheet with ID `1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E` has sheets named `darbinieki`, `klienti`, `atzimes`, `atzimes_log`, and `uzdevomi`
3. Serve the application locally:
   ```bash
   npm install
   npm run dev
   ```
4. Open `http://localhost:3000` (or the port shown) in a browser

### Excel Export Dependencies

```bash
npm install
```

The `exceljs` and `xlsx` packages are used by `js/excel_export.js` for generating monthly care documentation. The script loads libraries (`xlsx.full.min.js`, `exceljs.bare.min.js`) dynamically in `control.html`.

## Testing

```bash
node test.js              # Unit tests
node test_e2e.js          # End-to-end tests
node test_duplicate_fix.js # Duplicate prevention tests
node test_verify_fixes.js  # Fix verification
```

## Key Design Decisions

### Event-Driven Sync (Not Polling)

The system does not poll the server. Instead:
- Data loads once on page init via `loadInitialData()`
- The `syncComplete` custom event notifies all controllers to re-render
- Manual sync is triggered explicitly via the "Sinhronizēt" button
- The `syncComplete` event listener in `tasks.js` calls `invalidateCache()` to force task reload

### Local-First with Offline Support

- IndexedDB is the working database; Google Sheets is the source of truth
- All care marks are written to IndexedDB immediately for instant UI feedback
- Changes are enqueued in `sync_queue` and sent to the backend in the background
- If offline, marks persist locally and sync when connectivity returns
- The retry button clears all IndexedDB stores and reloads from Google Sheets

### Duplicate Prevention

Three layers of duplicate prevention:
1. **Server-side**: `handleMark()` checks for existing marks by client+employee+date+shift+category+field before creating new entries
2. **actionId deduplication**: Each write includes a unique `actionId` checked before insertion on the server
3. **Client-side**: 300ms debounce on client/employee creation; `_processing` Map prevents double-clicking on care form submissions

### Date/Date Parsing

The system handles multiple date format conventions:
- Google Sheets Date objects are converted to `yyyy-MM-dd` or `HH:mm:ss` based on field name
- `normalizeRow()` in `js/sync.js` infers dates from ID timestamps (e.g., `m_1234567890`) when explicit dates are missing
- The `normalizeKey()` function strips diacritics from Latvian column names (e.g., `Ā` → `a`) for reliable field matching