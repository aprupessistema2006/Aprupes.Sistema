# Aprūpes sistēma

Tīmekļu balstīta sociālās aprūpes dokumentēšanas sistēma veco ķermeņu un cilvēku ar invaliditāti atbalstošiem aprūpes ierakliem. Sistēma ir izveidota kā Progresīvā tīmekļa lietotne (PWA) ar iespēju darboties bezsaistē, izmantojot Google Sheets kā galveno datu avotu caur Google Apps Script aizmugursistēmu.

## Galvenās funkcijas

- **Trīs lietotāju lomas**: aprūpētājs (caregiver), kontroliere (controller), administrators
- **Darbība bezsaistē pirmās**: Izmanto IndexedDB kā lokālo kešatmiņu; izmaiņas tiek rindā un sinhronizētas, kad atjaunojas savienojums
- **Daudzvalodu atbalsts**: Latviešu (LV), krievu (RU) un angļu (EN) interfeisi
- **Divi maiņu veidi**: Rīts (Rīts, R) un Vakars (Vakars, V)
- **Aprūpes dokumentēšana**: Temperatūra, higiēna, aktivitāte, ēdienreizes, šķidruma uzņemšana/izvadīšana, vēdera izeja, ādas kopšana, pastaigas, ciemiņi, autiņbiksīšu maiņa un paraksti
- **Uzdevumu pārvaldība**: Piešķirami, priorītātei izložņamie uzdevumi ar termiņu izsekošanu
- **Excel eksporta funkcija**: Ikmēneša aprūpes dokumentācija, kas tiek ģenerēta no Excel veidnes (`Aprūpes lapas.xlsx`)
- **Dublikātu novēršana**: Dublikātu novēršana servera pusē, izmantojot `actionId`, un lokālā aizkavēšanās (debouncing)

## Arhitektūras pārskats

```
Google Sheets (patiesības avots)
    ↑ (JSONP/CORS caur skriptu tagu)
Google Apps Script (backend/gas_webhook.gs)
    ↓ (JSON)
js/sync.js → requestData() → normalizeRow()
    ↓ (IndexedDB caur CareDB)
js/db.js → IndexedDB krātuves
    ↓ (DOM renderēšana)
HTML lapas → kategoriju formas → care_form.js / aprupe.js / admin.js / control.js
```

### Datu plūsma

1. **Sākotnējā ielāde**: `CareSync.loadInitialData()` ielasa visus lapas datus caur GAS webhook URL (`CONFIG.GAS_URL`)
2. **Normalizācija**: `normalizeRow()` failā `js/sync.js` kartē Google Sheets kolonnu nosaukumus (latviešu valodā, ar diakritiskajām zīmēm) uz camelCase atslēgām un apstrādā datumu no ID laika zīmogiem
3. **Glābāšana**: Normalizētie dati tiek glabāti IndexedDB, izmantojot `CareDB.replaceStores()` piecās krātuvēs: `darbinieki`, `klienti`, `atzimes`, `atzimes_log`, `uzdevomi`
4. **Kešatmiņa**: Sinhronizācijas statuss tiek izsekots `meta` krātuvē; gaidāmās izmaiņas nonāk `sync_queue` krātuvē
5. **Notikumu vadīti atjauninājumi**: Pielāgotais notikums `syncComplete` aktivizē UI atkārtotu renderēšanu visos lapu kontrolleros
6. **Bezsaistes noteikšana**: `window.addEventListener('online'/'offline')` aktivizē `forceFullSync()`, kad savienojums atjaunojas

### Saziņa ar aizmugursistēmu

- GAS aizmugursistēma nesūta CORS galvenes POST pieprasījumiem, tāpēc sistēma izmanto **JSONP** (skriptu taga injekciju) kā primāro transporta metodi
- `requestData()` vispirms mēģina izmantot `fetch` ar CORS, pēc tam pāriet uz `jsonpRequest()` ar 10 sekunžu taimautu un atkārtotu mēģinājumu loģiku
- Rakstīšanas operācijas izmanto `postAction()`, kas ir `jsonpAction()` aizvietotājs ar pieprasījumu dublikātu novēršanu, izmantojot `pendingActions` karti (Map)
- Katra rakstīšanas operācija ietver unikālu `actionId`, lai novēretu dubultu apstrādi serverī

### Google Apps Script aizmugursistēma (`backend/gas_webhook.gs`)

Nodrošina trīs ieejas punktus:

| HTTP metode | Parametri | Nolūks |
|-------------|-----------|--------|
| `doGet` | `action`, `data`, `callback` | Datu ielāde (`action=load`) un rakstīšanas operācijas (caur `data` JSON parametru) |
| `doPost` | POST pamatteksts (JSON) | Rakstīšanas operācijas (izveidot/atjaunināt atzīmes, uzdevumus, klientus, darbiniekus) |
| `doOptions` | — | CORS priekšpieprasījuma apstrādātājs |

**Atbalstītās darbības** (caur `routeActionData`):

| Darbība | Apstrādātājs | Lapa (Sheet) | Apraksts |
|--------|-------------|-------------|----------|
| `ping` | — | — | Veselības pārbaude, atgriež `{ success: true, pong: true }` |
| `load` | `handleLoadData` | Visi | Ielādē visas lapas ar iespēju filtrēt pēc `clientId`, `employeeId`, `dateFrom`, `dateTo`, `limit` |
| `createClient` | `handleCreateClient` | `klienti` | Izveido jaunu klientu ar dublikāta vārda pārbaudi |
| `createEmployee` | `handleCreateEmployee` | `darbinieki` | Izveido jaunu darbinieku ar vārda un lomas dublējuma pārbaudi |
| `updateClient` | `handleUpdate` | `klienti` | Atjaunina klientu pēc `id` |
| `updateEmployee` | `handleUpdate` | `darbinieki` | Atjaunina darbinieku pēc `id` |
| `mark` | `handleMark` | `atzimes` + `atzimes_log` | Izveido vai atjaunina aprūpes atzīmi; ieraksta žurnāla ierakstu |
| `createTask` | `handleCreateTask` | `uzdevomi` | Izveido uzdevumu ar `actionId` dublikātu novēršanu |
| `updateTask` | `handleUpdateTask` | `uzdevomi` | Atjaunina uzdevuma statusu, izpildi un laika zīmogus |

Visi laika zīmogi aizmugursistēmā tiek konvertēti uz `Europe/Riga` laika joslu, izmantojot `Utilities.formatDate(v, TZ, formāts)`. Datumlauki izmanto formātu `yyyy-MM-dd`, laiklauki — `HH:mm:ss`.

## Projekta struktūra

```
Aprupes_sistema/
├── index.html              # Pieteikšanās lapa — autentifikācija ar PIN
├── aprupe.html             # Aprūpētāja sākumlapa — klientu saraksts + uzdevumu tabula
├── aprupetajs.html         # Klienta detalizētā informācija — aprūpes forma ar kategorijām
├── admin.html              # Administrācijas panelis — informācijas panelis, klientu/darbinieku pārvaldība
├── control.html            # Kontroleiļa panelis — statistika, vēsture, Excel eksports, mēneša skats
├── Aprūpes lapas.xlsx      # Excel veidne ikmēneša aprūpes dokumentācijai
├── backend/
│   └── gas_webhook.gs      # Google Apps Script aizmugursistēma (visas datu operācijas)
├── js/
│   ├── config.js           # Konfigurācijas konstantes (GAS_URL, SHEET_ID, lauku definīcijas, maiņu opcijas)
│   ├── i18n.js             # Daudzvalodu tulkojumi (LV/RU/EN) ar setLang/applyLanguage
│   ├── timezone.js         # Laika joslas utilītas (Europe/Riga) izmantojot Intl.DateTimeFormat
│   ├── db.js               # IndexedDB ietvars (CareDB) ar atmiņas rezerves iespēju
│   ├── sync.js             # Sinhronizācijas dzinējs (CareSync) — ielādēt, rinda, sinhronizēt, tīkla noteikšana
│   ├── login.js            # Pieteikšanās kontrolleris — PIN autentifikācija, iestatīšanas režīms, darbinieku izlase
│   ├── logout.js           # Iziet ar nesaglabāto izmaiņu apstiprinājumu un sinhronizācijas iespēju
│   ├── tasks.js            # Uzdevumu pārvaldnieks — ielādēt, filtrēt, izveidot, pabeigt, atkārtoti atvērt
│   ├── aprupe.js           # AprupeController — klientu saraksta lapas logika
│   ├── care_form.js        # CareFormController — klienta detalizētā lapa ar aprūpes kategorijām un parakstu
│   ├── admin.js            # AdminPanel — informācijas panelis, CRUD klientiem/darbiniekiem, dublikātu noteikšana
│   ├── control.js          # ControlPanel — statistika, vēstures tabula, Excel eksports, mēneša skata renderēšana
│   └── excel_export.js     # ExcelExporter — ģenerē ikmēneša Excel failus no veidnes
├── css/
│   ├── index.css           # Pieteikšanās lapas stili (sākuma ekrāns, pieteikšanās karte, valodas pārslēgs)
│   ├── aprupe.css          # Aprūpētāja sākumlapas stili (klientu režģis, uzdevumu tabula)
│   ├── aprupetajs.css      # Klienta detalizētās lapas stili (kategoriju režģis, modālais logs, paraksta karte)
│   └── admin.css           # Administrācijas un kontroleiļa paneļa stili ( koplietoti starp admin.html un control.html)
├── scripts/                # (norādīts package.json, nav repozitorijā)
├── package.json            # Node.js konfigurācija (exceljs, xlsx atkarības; izstrādes serveris un būvēšanas skripti)
├── DUPLICATE_FIX_README.md # Dokumentācija par dublikātu novēršanas pasākumiem
└── test*.js                # Testa faili (test, test_e2e, test_duplicate_*, test_gas_style, utt.)
```

## Google Sheets struktūra

Sistēma izmanto šādas lapas (identificētas pēc `SHEET_ID` failā `config.js`):

| Lapas nosaukums | Apraksts |
|-----------------|----------|
| `darbinieki` | Darbinieki (vārds, loma, PIN, aktīvais statuss) |
| `klienti` | Klienti (vārds, dzimšanas datums, diēta, kontaktinformācija, aktīvais statuss) |
| `atzimes` | Aprūpes atzīmes/rezultāti (klients, darbinieks, datums, maiņa, kategorija, lauks, vērtība) |
| `atzimes_log` | Visu aprūpes atzīmju izmaiņu auditņš (jauni ieraksti, labojumi) |
| `uzdevomi` | Darbiniekiem piešķirti uzdevumi (teksts, termiņš, prioritāte, statuss) |

**Galvenās kolonnas `atzimes` (aprūpes atzīmēs):**
- `id` — unikālais identifikators (formāts: `m_` + laika zīmogs)
- `klients_id` — klienta ID
- `darbinieks_id` — darbinieka ID
- `datums` — datums Europe/Riga laika joslā
- `laiks` — laiks `HH:mm:ss` formātā
- `periods` — maiņa: `R` (Rīts) vai `V` (Vakars)
- `kategorija` — aprūpes kategorija (skat. Lauku definīcijas zemāk)
- `lauka_nosaukums` — lauka nosaukums kategorijas ietvaros
- `vertiba` — reģistrētā vērtība
- `pedeja_laiks` — pēdējās modificēšanas laika zīmogs
- `action_id` — sinhronizācijas dublikātu novēršanas atslēga

**Galvenās kolonnas `uzdevomi` (uzdevumos):**
- `id` — unikālais identifikators (formāts: `t_` + laika zīmogs)
- `teksts` — uzdevuma apraksts
- `klients_id` — izvēles klienta ID
- `piešķirt_darbiniekam_id` — piešķirā pašreizējais darbinieka ID
- `termins` — izpildes termiņa datums
- `prioritate` — `augsta` (high), `videja` (medium), vai `zema` (low)
- `statuss` — `jauns` (new), `procesā` (in progress), vai `pabeigts` (completed)
- `pabeigts` — boolean izpildes karodziņš
- `izveidots` — izveides laika zīmogs
- `izveidotajs_id` — izveidotāja darbinieka ID
- `pabeigts_laiks` — izpildes laika zīmogs
- `pabeigtajs_id` — izpildītāja darbinieka ID
- `action_id` — sinhronizācijas dublikātu novēršanas atslēga

## Lauku definīcijas

Definēts failā `js/config.js` sadaļā `FIELD_DEFINITIONS`, aprūpes kategorijas un to lauki ir:

| Kategorijas atslēga | Etiķete (LV) | Lauki |
|-------------------|-----------|------|
| `temp` | Temperatūra | `temperatura` (skaitlis, °C; ≥37 = drudzis) |
| `higiena` | Higiēna | 7 pārslēdzami lauki: mutes dobuma kopšana, vana/duša, daļēja apmazgāšana, veļas maiņa, nagu kopšana, matu kopšana, bārdas skūšana |
| `aktivitate` | Aktivitāte | 3 pārslēdzami lauki: pārvietojas ar palīglīdzekli, stāv ar palīdzību, sēž ar palīdzību |
| `edinasana` | Ēdīšana | 4 ēdienrezei lauki: brokastis, pusdienas, launags, vakariņi (vērtības: X = pilna, ½ = puse, A = atteicās) |
| `sikdrumi` | Šķidrumi | `urina_daudzums` (skaitlis, ml), `uznemts_ml` (skaitlis, ml) — kumulatīvi maiņas ietvaros |
| `fiziologija` | Fiziologija | `vedera_izeja` (izvēle: N=Normāla, A=Aizcietējums, S=Caureja, C=Svecīte, K=Klizma) |
| `citsi_pasakomi` | Citi pasākumi | `adas_kopsana` (pārslēgs), `pastaigas` (pārslēgs), `ciemini` (pārslēgs: X/Nē), `autins_biksitu_skaits` (skaitlis, pieaugoši) |
| `paraksts` | Paraksts | `aprupetaja_paraksts` (paraksta lauks) |

Excel veidnes lauku kartēšana (`EXCEL_TEMPLATE.rowMapping` failā `config.js`):
Excel veidne kartē 23 laukus uz 9.–31. rindu, kolonnām dienā mainoties par 2 (R maiņa = bāzes kolonna, V maiņa = bāse + 1).

## Sinhronizācija

### CareSync klase (`js/sync.js`)

Klase `CareSync` pārvalda notikumu vadītu sinhronizācijas arhitektūru:

**Inicializācija** (`loadInitialData`):
- Vispirms palaiž rindas apstrādi (lai nosūtītu gaidāmās lokālās izmaiņas)
- Ielādē visus datus no GAS `?action=load` galapunkta
- Izsauc `normalizeRow()` katrai rindai pirms saglabāšanas IndexedDB
- Praftē notikumu `syncComplete` ar rezultāta kopsavilkumu (skaitļi, gaidāmo skaits, versija)
- Atgriežas pie lokālo IndexedDB datu, kad ir bezsaistē

**Rindas apstrāde** (`processQueue`):
- Apstrādā vienumus no `sync_queue` krātuves hronoloģiskā secībā
- Klasificē darbības kā rakstīšanas operācijas (`mark`, `createTask`, `updateTask`, `createClient`, `createEmployee`, `updateClient`, `updateEmployee`) vai citus veidus
- Rakstīšanas operācijas izmanto `postAction()`, pārējās izmanto `jsonpAction()`
- Atkārto neizdevušos vienumus (palielinot `retries` skaitītāju)
- Dzēš vienumus tikai pēc sekmīgas izpildes
- Procesi tiek serializēti caur `_runExclusive()`, lai novērtēstraides stāvokļus (race conditions)

**Atbalsts bezsaistē**:
- `_setupOfflineDetection()` klausās `online`/`offline` loga notikumiem
- Atjaunojoties savienojumam, aktivizē `forceFullSync()`
- `checkConnection()` sūta ping signālu uz aizmugursistēmu, lai pārbaudītu savienojamību

**Pieprasījumu dublikātu novēršana**:
- `pendingActions` karte (Map) novērš paralēlus identiskus pieprasījumus
- Servera puses `actionId` dublikātu novēršana novērš dubultas atzīmes/uzdevumus atkārtotās mēģinājumā

## Lietotāju lomas

| Loma (lv) | Loma (en) | Lapa | Atļaujas |
|-----------|-----------|------|----------|
| `aprūpētājs` | Caregiver | aprupe.html, aprupetajs.html | Skatīt klientus, reģistrēt aprūpes atzīmes, parakstīt maiņas, pabeigt uzdevumus |
| `kontroliere` | Controller | control.html | Skatīt statistiku, auditņa vēsturi, izveidot uzdevumus, eksportēt uz Excel |
| `administrators` | Administrator | admin.html, aprupetajs.html (administrators režīmā) | Pilna piekļuve; izveidot/rediģēt klientus un darbiniekus; ieiet aprūpētāja režīmā |

### Pieteikšanās plūsma (`js/login.js`)

1. Ielādējot lapu, pārbauda `sessionStorage` esošo `careUser` — ja atrasts ar `pinVerified: true`, pāradresē pēc lomas
2. Pārbauda Google Sheets savienojamību, izmantojot `sync.checkConnection()`
3. Ja nav attālinātā savienojuma un nav lokālo datu → pāriet iestatīšanas režīmā, lai izveidotu pirmo administratoru
4. Ielādē datus no Google Sheets, izmantojot `sync.loadInitialData()`
5. Veiksmīgā savienojumā ielādē darbiniekus no `darbinieki` krātuves
6. Darbinieka izvēle ar lomu filtrēšanu (Administratorsi, Kontroleiri, Aprūpētāji vai Visi)
7. PIN ievade (4–6 cipari, skaitliski) ar atpakaļspausces atbalstu
8. Maiņu tipa izvēle: `diennakts` (nakts maiņa, 19:00–07:00) vai `dienas` (dienas maiņa)
9. Pieteikšanās brīdī validē PIN pret `employee.pin` (lokalā salīdzinājums), saglabā lietotāju `sessionStorage`, atskaņo nejaušu iedrošinājuma ziņojumu, pēc tam pāradresē pēc lomas

### Pāradresācija pēc lomas (`login.js` `redirectByRole`)
- `administrators` → `admin.html`
- `kontroliere` → `control.html`
- visi pārējie → `aprupe.html`

## Aprūpētāja režīms (Administrators ignorēšana)

Administrācijas panelis var darboties kā aprūpētājs:
1. Noklikšķiniet uz pogas "Ieiet kā aprūpētājs"
2. Atlasiet klientu un aprūpētāju no nolaižamajām izvēlēm
3. Iestata `careAdminMode=true` un `careAdminCaregiverId` `sessionStorage`
4. Navigē uz `aprupetajs.html?client=<id>&mode=admin&caregiverId=<id>`
5. Administrācijas režīmā administrators var parakstīt maiņas, labot ierakstus pēc to parakstīšanas, un administratora vārds tiek pievienots kā `[ADMIN: Vārds]`

## Parakstu sistēma (`js/care_form.js`)

- **Kas var parakstīt**: Nakts maiņas (`diennakts`) darbinieki un administratori
- **Kad**: Katrā maiņā (R/V) dienā ir atsevišķs paraksts
- **Nemainīgība**: Neadministratoriem parakstīta ma maiņu nevar labot (`isShiftSigned()` pārbaude)
- **Administrators ignorēšana**: Administratori var atkārtoti parakstīt vai parakstīt citu maiņu pašreizējā aprūpētāja identitātei
- Paraksti tiek glabāti kā atzīmes ar `kategorija: 'paraksts'` un `lauks: 'aprupetaja_paraksts'`

## Excel eksports (`js/excel_export.js`)

Izmanto `ExcelJS` bibliotēku un Excel veidnes failu (`Aprūpes lapas.xlsx`), lai ģenerētu ikmēneša aprūpes dokumentāciju:

- **Veidnes lapas**: `APRŪPES DOKUMANTĀCIJA_1` (dienu 1–15) un `APRŪPES DOKUMANTĀCIJA_2` (dienu 16–31)
- **Datu kartēšana**: Rinda 9 = temperatūra, rindas 10–16 = higiēnas lauki, rindas 17–19 = aktivitāte, rindas 20–23 = ēdienrezes, rinda 24 = urīns, rinda 25 = H2O, rindas 26–31 = citi pasākumi un paraksts
- **Kolonnas**: Katrā dienā ir 2 kolonnas (R maiņas bāse, V maiņas bāse + 1), sākot no 2. kolonnas
- **Kopsavilkuma rindas**: Tiek automātiski ģenerētas beigās ar kopsummām urīnam, H2O un autiņbiksīšu maiņām
- Pieejams `control.html` (kontroleiļa panelis)

## Mēneša skats (`js/control.js`)

Kontroleiļa panelis ietver mēneša skata funkciju, kas renderē visu aprūpes atzīmju režģi:
- Rindas = aprūpes kategorijas un lauki (23 rindas, kā definēts `fieldMap`)
- Kolonnas = mēneša dienas, ar atsevišķām kolonnām R un V maiņām
- Parakstu šūnas tiek filtrētas, lai noņemtu administratora ignorēšanas tagus
- Skaitliskie lauki (urīns, H2O, autiņbiksīšu maiņas) tiek summēti pēc maiņām un kopumā

## Konfigurācija (`js/config.js`)

Visa konfigurācija ir centralizēta vienā `CONFIG` objektā:

| Īpašība | Vērtība |
|--------|---------|
| `APP_NAME` | `Aprūpes sistēma` |
| `VERSION` | `1.0.0` |
| `GAS_URL` | Google Apps Script izvietošanas URL |
| `SHEET_ID` | `1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E` |
| `TIMEZONE` | `Europe/Riga` |
| `SHIFTS` | `{ R: 'Rīts', V: 'Vakars' }` |
| `ROLES` | `{ aprupetas: 'aprūpētājs', kontroliere: 'kontroliere', admins: 'administrators' }` |
| `STORES` | IndexedDB krātuvju nosaukumu kartējumi |

## Starptautifikācija (`js/i18n.js`)

Objekts `I18N` satur tulkojumu vārdnīcas valodām `lv`, `ru` un `en` ar vairāk nekā 300 atslēgām, kas aptver visu lietotāja saskarnes tekstu, statusa ziņojumus, lomu etiķetes, datum/laika terminus un kļūdu ziņojumus.

Valodas maiņa tiek pārvaldīta ar:
- `setLang(lang)` — iestata pašreizējo valodu un saglabā `localStorage`
- `applyLanguage()` — tulko visus `data-i18n` atribūtus DOM
- `t(key)` — īsa funkcija, kas atgriež tulkojumu pašreizējai valodai

Funkcija `t()` ir pieejama globāli un tiek izmantota visos kontrolleros.

## Laika joslas apstrāde (`js/timezone.js`)

Visas datuma/laika operācijas izmanto `Europe/Riga` laika joslu, izmantojot `Intl.DateTimeFormat`:

| Metode | Atgriež |
|--------|---------|
| `getNowRiga()` | Pašreizējo `Date` objektu |
| `getHourRiga(date)` | stundu (0–23) Rīgas laikā |
| `getTodayRiga()` | Šodieno datumu kā `YYYY-MM-DD` Rīgas laikā |
| `getTimeRiga()` | Pašreizējo laiku kā `HH:mm:ss` Rīgas laikā |
| `getDateTimeRiga()` | Apvienoto `YYYY-MM-DD'T'HH:mm:ss` |
| `formatDateRiga(date)` | Datumu kā `YYYY-MM-DD` (apstrādā ISO virknes un Date objektus) |
| `formatTimeRiga(date)` | Laiku kā `HH:mm:ss` |
| `formatDateTimeRiga(date)` | Apvienoto datuma un laika virkni |
| `offsetDaysRiga(days)` | Datumu, kas pārvietots par N dienām (negatīvs pagātnei) |
| `isSameDay(date1, date2)` | Būla salīdzinājums |
| `isTodayRiga(date)` | Būla vērtība: vai dotais datums ir šodien Rīgas laikā |

## Lietotnes palaišana

### Priekšnosacījumi

- Google konts ar piekļuvi Google izklājlapai (SHEET_ID: `1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E`)
- Node.js 14+ (Excel eksportam un testa skriptiem)

### Iestatīšana

1. Ievietojiet `backend/gas_webhook.gs` Google Apps Script vidē un iestatiet `doGet` un `doPost` galapunktus
2. Pārliecinieties, ka Google izklājlapa ar ID `1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E` satur lapas ar nosaukumiem `darbinieki`, `klienti`, `atzimes`, `atzimes_log` un `uzdevomi`
3. Palaidiet lietotni lokāli:
   ```bash
   npm install
   npm run dev
   ```
4. Atveriet `http://localhost:3000` (vai parādīto pieslēgumu) pārlūkprogrammā

### Excel eksporta atkarības

```bash
npm install
```

Paketes `exceljs` un `xlsx` tiek izmantotas failā `js/excel_export.js`, lai ģenerētu ikmēneša aprūpes dokumentāciju. Skripts dinamiski ielādē bibliotēkas (`xlsx.full.min.js`, `exceljs.bare.min.js`) failā `control.html`.

## Testēšana

```bash
node test.js                  # Vienības testi
node test_e2e.js              # Gala-gala testi
node test_duplicate_fix.js    # Dublikātu novēršanas testi
node test_verify_fixes.js     # Labojumu pārbaude
```

## Galvenie arhitektūras lēmumi

### Notikumu vadīta sinhronizācija (nevis periodiska vaicāšana)

Sistēma nepārtraukti neatpakaļo serveri. Tā vietā:
- Dati ielādējas vienu reizi lapas inicializācijā, izmantojot `loadInitialData()`
- Pielāgotais notikums `syncComplete` informēt visus kontrollerus par nepieciešamību veikt atkārtotu renderēšanu
- Manuālā sinhronizācija tiek aktivizēta tieši ar pogu "Sinhronizēt"
- Notikumu klausītājs `syncComplete` failā `tasks.js` izsauc `invalidateCache()`, lai piespiestu pārlādēt uzdevumus

### Lokālā pirmā prioritāte ar atbalstu bezsaistē

- IndexedDB ir darbojošā datu bāze; Google Sheets ir patiesības avots
- Visas aprūpes atzīmes tiek nekavējoties rakstītas IndexedDB tūlītējai lietotāja saskarnes atgriezeniskajai saitei
- Izmaiņas tiek ievietotas rindā `sync_queue` un fonā nosūtītas uz aizmugursistēmu
- Ja nav interneta savienojuma, atzīmes saglabājas lokāli un sinhronizējas, kad savienojums atjaunojas
- Atkārtota mēģinājuma poga notīra visas IndexedDB krātuves un veic atkārtotu ielādi no Google Sheets

### Dublikātu novēršana

Trīs dublikātu novēršanas līmeņi:
1. **Servera pusē**: `handleMark()` pārbauda esošās atzīmes pēc klients+darbinieks+datums+maiņa+kategorija+lauks, pirms izveido jaunus ierakstus
2. **actionId dublikātu novēršana**: Katrs rakstīšanas pieprasījums ietver unikālu `actionId`, kas pirms ievietošanas tiek pārbaudīts serverī
3. **Klienta pusē**: 300 ms aizkavēšanās klientu/darbinieku izveidē; `_processing` karte (Map) novērš dubultklikšķi uz aprūpes formas iesniegšanas pogām

### Datumu un laika parsēšana

Sistēma apstrādā vairākas datuma formātu konvencijas:
- Google Sheets datuma objekti tiek konvertēti uz `yyyy-MM-dd` vai `HH:mm:ss` atkarībā no lauka nosaukuma
- `normalizeRow()` failā `js/sync.js` secina datumus no ID laika zīmogiem (piemēram, `m_1234567890`) ik vien trūkst eksplīcīti datumu
- Funkcija `normalizeKey()` noņem diakritiskās zīmes no latviešu valodas kolonnu nosaukumiem (piemēram, `Ā` → `a`), lai nodrošinātu uzticamu lauku sakritību