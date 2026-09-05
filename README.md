# Aprūpes sistēma

Bezmaksas sociālās aprūpes dokumentēšanas sistēma, kas strādā ar Google Sheets kā datubāzi un GitHub Pages kā programmas ekrānu.

## Arhitektūra

```
GitHub Pages (HTML/CSS/JS)  →  Google Apps Script  →  Google Sheets
         ↑                                                  ↓
         └──────── Lokālais IndexedDB kešs ←────────────── ┘
```

- **Klienta puse**: Pārlūkprogramma ar IndexedDB kešu
- **Serveris**: Google Apps Script (slēpta datu vārteja)
- **Datu bāze**: Google Sheets ar 8 loģiskām lapām

## Lapas

- `index.html` - PIN autorizācija ar darbinieku sarakstu
- `aprupe.html` - Aprūpētāja klientu saraksts
- `aprupetajs.html` - Konkrēta klienta aprūpes forma
- `control.html` - Kontroliera panelis (statistika, vēsture, Excel eksports)
- `admin.html` - Administratora panelis (klienti, darbinieki, iestatījumi)

## Datu struktūra (Google Sheets)

- `darbinieki` - lietotāji, lomas, PIN
- `klienti` - klientu pamatdati
- `atzimes` - aktuālās vērtības (pašreizējais stāvoklis)
- `atzimes_log` - nemaināma visu izmaiņu vēsture
- `dienas_ierakti` - dienas pabeigšanas statuss
- `sessions` - aktīvās sesijas
- `uzdevomi` - papildu uzdevumi
- `pamaciba` - lauku skaidrojumi

## Konfigurācija

1. Atvērt `js/config.js` un iestatīt `GAS_URL` un `SHEET_ID`.
2. Google Apps Script backend (`backend/gas_webhook.gs`) izvietot ar `Deploy as Web App` (`Anyone` piekļuve).
3. Google Sheets izveidot ar 8 lapām un aizpildīt kolonnu galvenes pēc `Aprupes_sistema.xlsx` parauga.

## Testēšana

```bash
node -c js/config.js
node -c js/db.js
node -c js/sync.js
node -c js/login.js
node -c js/aprupe.js
node -c js/care_form.js
node -c js/control.js
node -c js/admin.js
node -c js/excel_export.js
node -c js/logout.js
```

Visiem jāizvada tukšs (bez kļūdām).

## Lokālā izstrāde

```bash
python -m http.server 8000
# vai
npx http-server -p 8000
# vai
npx serve .
```

Pēc tam atvērt `http://localhost:8000`.

## Failu karte

| Fails | Apraksts |
|-------|----------|
| `index.html` | Darbinieku izvēle + PIN ievade |
| `aprupe.html` | Aprūpētāja klientu saraksts |
| `aprupetajs.html` | Klienta aprūpes forma (kartiņas, modālis, paraksts) |
| `control.html` | Kontroliera panelis + Excel eksports |
| `admin.html` | Administratora panelis (4 cilnes) |
| `js/config.js` | Konfigurācija, lauku definīcijas |
| `js/db.js` | IndexedDB datubāze ar in-memory fallback |
| `js/sync.js` | Fona sinhronizācija ar Google Sheets (POST + GET fallback) |
| `js/excel_export.js` | Excel eksports pēc MK veidlapas parauga |
| `js/logout.js` | Izlogšanās apstiprinājuma dialogs + goodbye ekrāns |
| `js/xlsx.full.min.js` | Lokāla XLSX bibliotēka |
| `js/login.js` | Darbinieku saraksts + PIN + laipni lūdzam ekrāns |
| `js/aprupe.js` | Klientu saraksts ar meklēšanu un komandas indikatoru |
| `js/care_form.js` | Aprūpes formas loģika: 10 kartiņas, modālis, paraksts, quick totals |
| `js/control.js` | Kontroliera panelis: filtri, statistika, vēsture, DB diagnostika |
| `js/admin.js` | Administratora cilnes: Pārskats, Klienti, Darbinieki, Iestatījumi |
| `backend/gas_webhook.gs` | Google Apps Script backend ar visiem handleriem |
| `css/login.css` | Login ekrāna stils + logout modal |
| `css/aprupe.css` | Klientu saraksta stils + logout modal |
| `css/aprupetajs.css` | Aprūpes formas stils + quick totals + logout modal |
| `css/admin.css` | Kontroliera un administratora stils + logout modal |
| `logo/logoDS.png` | Sistēmas logo |
| `Aprupes_sistema.xlsx` | Datu parauga fails ar visām lapām |
| `Aprūpes lapas.xlsx` | MK veidlapas Excel veidne eksportam |
| `test.js` | In-memory datu un loģikas testi |
| `test_final.js` | Excel eksporta loģikas tests |
| `package.json` | npm konfigurācija |
| `range_aprupe.txt` | Šūnu diapazoni aprūpes lapai |

## Backend (Google Apps Script)

`backend/gas_webhook.gs` satur:

- `SHEET_ID` - Google Sheets ID
- `getSpreadsheet()`, `getSheet(name)` - piekļuve Sheets
- `getSheetData(sheet)` - nolasīt visu lapu kā masīvu ar galvenēm
- `appendRow(sheet, data)` - pievienot rindu ar aliasu atpazīšanu (latviešu/diacritics/snake_case)
- `setCellValue(sheet, rowNum, field, value)` - atjaunināt vienu šūnu
- `findRow(sheet, conditions)` - atrast rindu pēc nosacījumiem
- `buildAliasMap(headers)` - izveidot kolonnu aliasu karti (vērtība→value, klients_id→clientId utt.)
- `normalizeKey(h)` - normalizēt virsrakstu uz snake_case
- `routeAction(data)` - maršrutēt darbību uz atbilstošo handleri
- `doGet(e)` / `doPost(e)` - HTTP ieejas punkti
- `handleLoad()` - atgriezt visus datus (GET `?action=load`)
- `handleCreateClient(data)` - izveidot jaunu klientu
- `handleCreateEmployee(data)` - izveidot jaunu darbinieku
- `handleUpdate(data, sheetName)` - atjaunināt klientu vai darbinieku
- `handleMark(data)` - pievienot jaunu atzīmi (atzimes + atzimes_log)
- `handleCreateTask(data)` - izveidot uzdevumu
- `handleLogDay(data)` - atzīmēt dienas pabeigšanu
- `createResponse(status, data)` - izveidot JSON atbildi
- `formatDate(d)` - formatēt datumu kā `YYYY-MM-DD`
- `migrateBackfill()` - migrācija: aizpildīt tukšās Vērtība kolonnas no atzimes_log
- `fixDates()` - migrācija: pārrakstīt datuma formātu uz `YYYY-MM-DD`

## Klienta puse (JavaScript)

### `js/db.js` - IndexedDB

- Klase `CareDB`
- DB nosaukums: `AprupesSistema`, versija `2`
- 9 object stores: `darbinieki`, `klienti`, `atzimes`, `atzimes_log`, `dienas_ierakti`, `uzdevomi`, `pending`, `pamaciba`, `meta` (atslēga `key`)
- In-memory fallback kad IndexedDB nav pieejams
- Metodes: `init()`, `getAll(store)`, `get(store, key)`, `add(store, value)`, `put(store, value)`, `delete(store, key)`, `clear(store)`, `getByIndex(store, idx, value)`, `generateId()`, `getMeta(key)`, `setMeta(key, value)`

### `js/sync.js` - Sinhronizācija

- Klase `SyncManager`
- `FIELD_ALIASES` - latviešu→angļu lauku nosaukumu karte
- `normalizeDate(v)` - Date/ISO string/dd.mm.yyyy → `YYYY-MM-DD`
- `normalizeRow(row)` - normalizēt rindu: atslēgas, datumi, `aktivs`→boolean, `pin`→string
- `loadInitialData()` - GET `?action=load`, iztīra un aizpilda IndexedDB
- `sendToServer(item)` - POST (no-cors) + GET fallback
- `enqueueChange(change)` - pievienot `pending` rindu
- `sync()` - nosūtīt visas nesinhronizētās izmaiņas
- Periodiska sync ik 30s + uz `online` eventa

### `js/login.js` - Autorizācija

- Klase `LoginController`
- Ielādē darbiniekus no IndexedDB, parāda meklēšanas lauku
- `selectEmployee(emp)` - izvēlas darbinieku, parāda kartīti ar vārdu/lomu
- `clearSelection()` - notīrīt izvēli
- `authenticate(employee, pin)` - pārbaudīt PIN
- `showSuccess(user)` - laipni lūdzam ekrāns ar nejaušu komplimentu (10 varianti)
- `redirectByRole(role)` - `administrators`→admin.html, `kontroliere`→control.html, pārējie→aprupe.html
- Statusa ziņa parāda ielādēto atzīmju un žurnāla ierakstu skaitu

### `js/aprupe.js` - Klientu saraksts

- Klase `AprupeController`
- `loadTodayMarks()` - ielādē šodienas atzīmes (filtrs pēc `date`/`created`/`izveidots`/`lastModified`/`pedeja_laiks`)
- `filterClients(term)` - meklēt pēc vārda, uzvārda vai ID
- `getClientStatus(clientId)` - atgriež `{text, class}` (Pabeigts / X atzīmes / Nav atzīmēts)
- `getTeamCount(clientId)` - cik citi darbinieki strādāja ar šo klientu
- `renderCards()` - klientu kartītes ar komandas indikatoru

### `js/care_form.js` - Aprūpes forma

- Klase `CareFormController`
- 10 kategoriju kartiņas: Temperatūra, Higiēna, Aktivitāte, Ēdīšana, Šķidrumi, Vēdera izeja, Ādas kopšana, Pastaiga, Ciemiņi, Higiēnas maiņa
- 3 quick totals: 💧 Šķidrumi, 🚽 Vēdera izeja, 🧻 Higiēnas maiņa
- `detectCurrentShift()` - Rīts (5:00-19:00) / Vakars (19:00-5:00), atjaunojas ik 60s
- `loadMarks()` / `loadHistory()` - filtrs pēc vairākiem datuma laukiem (atbalsta Sheet datuma formātu)
- `loadAllClientMarks()` - ielādē VISAS šodienas atzīmes un žurnālu priekš quick totals
- `renderQuickTotals()` - parāda kopējo skaitu un pēdējo autoru
- `openCategoryModal(cat)` / `closeCategoryModal()` - modālis ar laukiem
- `handleOptionSelect(shift, cat, field, value, btn)` - saglabāt izvēli
- `handleNumberChange(cat, field, value, shift)` - saglabāt skaitli
- `handleSikdrumiSubmit()` - saglabāt abus šķidrumu laukus
- `handleFiziologijaSubmit()` - saglabāt vēdera izejas izvēli
- `handleDiaperIncrement(shift, cat, field, btn)` - +1 pie higiēnas maiņas
- `saveMark(data)` - saglabāt `atzimes` + `atzimes_log` + sync
- `handleSign()` - parakstīties (atzīme ar `category: 'paraksts'`, `field: 'aprupetaja_paraksts'`)
- `renderSignature()` - parāda "Parakstīts" ar laiku
- `renderHistory()` - šodienas vēsture ar darbinieka vārdu
- `updateTeamSummary()` - "Šodienas komandas darbs: X ieraksti (Y mani, Z citi)"
- `extractDate(v)` - atpazīst Date/ISO string/dd.mm.yyyy, izlaiž gadus pirms 1900
- `extractTimeForSort(t)` / `extractTimeDisplay(t)` - laika formāts no Date/string/ISO

### `js/control.js` - Kontroliera panelis

- Klase `ControlPanel`
- Filtri: datums, klients, darbinieks, "Tikai labotie"
- "📅 Rādīt visu" poga + datuma režīma indikators
- "🔄 Atjaunināt no servera" poga - reload no GAS
- 9 statistikas kartes: Klienti, Pabeigtas dienas, Nepabeigti, Temperatūra ≥37, Šķidrums, Urīns, Maiņas, Ēdienreizes, Labojumi
- "👥 Darbinieku ieguldījums" - katra darbinieka ierakstu skaits filtrā
- "📅 Periods" - redzamais datuma diapazons
- "💾 DB diagnostika" - cik ierakstu katrā lapā
- Vēstures tabula ar kolonnām: Datums, Laiks, Klients, Aprūpētājs, Kategorija, Lauks, Vērtība, Iepriekšējā, Tips
- "📊 Lejupielādēt Excel" - izmanto `ExcelExporter.generateMonth()`
- `extractDateFromAnyField(row)` - meklē datumu `date`/`created`/`lastModified`/`izveidots`/`pedeja_laiks` (izlaiž gadus pirms 1900)

### `js/admin.js` - Administratora panelis

- Klase `AdminController`
- 4 cilnes: Pārskats, Klienti, Darbinieki, Iestatījumi
- Pārskats: aktīvie klienti, aktīvie darbinieki, nesinhronizēti ieraksti, pēdējā sinhronizācija
- Klienti: meklēšana, saraksts, "+ Pievienot klientu" poga
- Darbinieki: meklēšana, saraksts, "+ Pievienot darbinieku" poga
- Iestatījumi: GAS URL, "Pārbaudīt savienojumu", "Meklēt dublikātus", "Notīrīt lokālos datus", "Izveidot rezerves kopiju"

### `js/excel_export.js` - Excel eksports

- Klase `ExcelExporter`
- `loadTemplateBuffer()` - ielādē `Aprūpes lapas.xlsx` no servera
- `generateMonth(client, year, month, marks, signers)` - aizpilda abas lapas
  - `APRŪPES DOKUMANTĀCIJA_1`: dienas 1-15, rindas 9-31
  - `APRŪPES DOKUMANTĀCIJA_2`: dienas 16-31, rindas 4-26
  - Kolonnas: Rīts=colR, Vakars=colV (colR = 2 + (day-1)*2)
- `getFieldMap(row)` - 23 rindu kartēšana uz `(category, field)`

### `js/logout.js` - Izlogšanās

- Objekt `Logout`
- `confirm({pending})` - Promise ar apstiprinājuma dialogu
  - Ja `pending > 0`: ⚠️ sarkans brīdinājums
  - Ja 0: 👋 "Vai tiešām vēlies iziet?"
- `performLogout()` - goodbye ekrāns ar nejaušu komplimentu (10 varianti), pēc 1.8s pāriet uz `index.html`
- `attach(buttonEl, opts)` - pieslēgt pogai

## Konfigurācija (`js/config.js`)

- `GAS_URL` - Google Apps Script Web App URL
- `SHEET_ID` - Google Sheets ID
- `SHIFTS` - `R: 'Rīts'`, `V: 'Vakars'`
- `ROLES` - `aprūpētājs`, `kontroliere`, `administrators`
- `STORES` - IndexedDB object store nosaukumi
- `FIELD_DEFINITIONS` - 8 kategoriju lauku definīcijas:
  - `temp`: `temperatura` (number, °C, slieksnis 37)
  - `higiena`: 7 toggle lauki
  - `aktivitate`: 3 toggle lauki
  - `edinasana`: 4 food lauki (X/½/A)
  - `sikdrumi`: `urina_daudzums`, `uznemts_ml` (number, ml)
  - `fiziologija`: `vedera_izeja` (select: N/A/S/C/K)
  - `citi_pasakomi`: `adas_kopsana`, `pastaigas`, `ciemini` (toggle), `autins_biksitu_skaits` (number)
  - `paraksts`: `aprupetaja_paraksts` (signature)
- `EXCEL_TEMPLATE` - rindu kartēšana Excel veidnei
- `STATUS` - sinhronizācijas statusa teksti

## Sistēmas principi

- **Vienkāršība**: katra poga dara vienu skaidru darbību
- **Lokāls pirmais**: dati tiek saglabāti IndexedDB uzreiz, pēc tam sinhronizēti fonā
- **Bez dublēšanās**: viena poga - viena darbība, viena datu vieta
- **Latviešu valoda**: lietotājam netiek rādīti API, tokeni, tehniski termini
- **Komandas darbs**: visi darbinieki redz iepriekšējo ierakstus vienam klientam
- **MK veidlapa**: Excel eksports saglabā oriģinālo `Aprūpes lapas.xlsx` formatējumu

## Licences un autortiesības

Šis ir bezmaksas rīks sociālajai aprūpei. Izmantojiet bez maksas.
