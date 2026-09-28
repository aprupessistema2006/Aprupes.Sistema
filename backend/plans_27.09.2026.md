# Implementācijas plāns — Spec 27.09.2026

## Mērķis

Pārdefinēt sinhronizāciju, operāciju identitāti un konfliktu risināšanu atbilstoši oficiālajai specifikācijai.

## Ierobežojumi

- Google Sheets ir vienīgais oficiālais datu avots
- Bezsaistē līdz 2 stundām
- Vairāki lietotāji vienlaicīgi (katrs ar savu ierīci)
- Dati nedrīkst pazust
- 100% bez maksas rīkli (GAS + Google Sheets + HTML/JS/CSS/IndexedDB)
- Vienā operācija ≠ viens oficiāls ieraksts
- Client clock ≠ server autors

---

## DAŻĀDI PUNKTI (Kas jāmaina)

### 1. Sinhronizācijas rindas dzēšana pēc datu ielādes (sync.js:855–866)

Kods dzēš `sync_queue` pēc veiksmīgas `loadInitialData`. 

**Spec:** 10.1 — datu ielāde nedrīkst dzēst sinhronizācijas rindu.

**Atrisinājums:** Noņemt `sync_queue` masīgo dzēšanu no `_loadInitialDataUnlocked`. Rinda tiek dzēsta tikai kad konkrēta operācija saņem `accepted` vai `already_processed` no servera.

### 2. Queue item dzēšana pēc jebkāras atbildes (sync.js:1034–1037)

Kods dzēš pēc jebkāras servera atbildes.

**Spec:** 10.6 — dzēst tikai `accepted` / `already_processed`; 10.6 — "Nedrīkst uzskatīt par veiksmīgu tikai HTTP atbildes saņemšanu."

**Atrisinājums:** Mainīt dzēšanas loģiku uz `accepted === true` vai `already_processed === true`. Visos pārējos gadījumos Operācijas dati tiek atjaunināti ar atbilstošo stāvokli.

### 3. actionId → operationId (visos slāņos)

**Spec:** 4.1 — operationId ir unikāla identitāte. 5.2 — operationId nedrīkst būt satura identifikators. 28.2 — nedublēt vienu operāciju.

**Atrisinājums:**
- `operationId` tiek ģenerēts klientā kā `op_<employeeId>_<timestamp>_<random>` (employeeId iekļauts, lai divi dažādi lietotāji nevarētu kollīdzinēt operationId)
   - Server registre `operation_id` unikāli `operation_registry` lapā (Google Sheets kolonnas: `operation_id`, `employee_id`, `action_type`, `record_id`, `record_version`, `created_at`, `result`, `official_record_id`, `status_code`, `deduplication_valid_until`, `replacement_op_id`)
- Serveriz deduplikācija: pirms apstrādes pārbauda `operation_id` → ja eksistē, atgriež iepriekšējo rezultātu (`already_processed` / `rejected` / `blocked`)
- `payload_hash` NAV iekļauts — divas vienādas pēc satura darbības IR divas dažādas operācijas (sekcija 5.2)

### 4. Tīkla kļūdas klasificēšana kā "permanent" (sync.js:1045)

Kods klasificē `Savienojuma kļūda` kā permanentu un pārtvērš uz `permanentlyFailed`.

**Spec:** 11.1 — tīkla kļūme → atkārto ar to pašu operationId. 28.6 — jauns operationId nav atļauts tikai tīkla kļūmes dēļ.

**Atrisinājums:** Noņemt `isPermanent` logiku. Tīkla kļūde (timeout, DNS, CORS) atgriež `KĻŪDA` stāvokli. Automātiskā atkārtošana turpinās ar to pašu `operationId` līdz `deduplicationValidUntil` vai servera `retry_not_allowed`.

### 5. MAX_RETRIES = 5 (sync.js:1005)

Kods pēc 5 neveiksmīgiem pārtvērš uz `permanentlyFailed`.

**Spec:** 11.4 — retry limits tikai apturo automātisko atkārtošanu. Ne dzēj, ne kļūst NORAIDĪTS/NEVAR ATKĀRTOT, ne izveido jaunu operationId. Lietotājam jāvar manuāli atkārtot.

**Atrisinājums:** Pēc retry limita operācija palik `KĻŪDA` stāvoklī. Automātiskā atkārtošana apturēta. Lietotājs var spieda "Mēģināt vēlreiz" pogu, kas manuāli triggero atkārtošanu ar to pašu `operationId`.

### 6. Dati dzēšanas pretīstāvība local storage politikai (spec 19.4 vs 19.1)

**Spec 19.1:** nepabeigtu operāciju nedrīkst dzēst.
**Spec 19.4:** operāciju, kuru serveris nekad nav saņēmis, drīkst dzēst pēc retention periods.

**Atšķirība:** Operācija kurai serveris nekad nav atbildējis = `KĻŪDA`/`GAIDA` stāvoklī. Tā ir nepabeigta. Secīgā mērķī nedrīkst tikt automātiski dzēsta.

**Atrisinājums:** Izņemt 19.4 punktu. Operācijas kuras nekādā veidā nemaz nezinām servera gala rezultāta, tiek dzēltas tikai ar lietotāja manuālo darbību (ATCELTS). Visas nepabeigtas operācijas vienmēr saglabājas.

---

## STĀVOKŁU MODELS

10 pastāvīgi stāvokļi + 1 funkcionālais:

| Stāvoklis | Pāreja |
|---|---|
| GAIDA | → SINHRONIZĀCIJA (nosūtīšana) |
| BLOĶĒTS | → GAIDA (pēc servera pārbaudes) |
| KONFLIKTS | → AIZVIETA + jauns operationId (turpināt) \| ATCELTS (atcelt) |
| GAIDA LIETOTĀJU | → GAIDA (pēc lietotāja darbības) |
| NORAIDĪTS | (gāles) |
| ATCELTS | (gāles) |
| AIZVIETA | (gāles) |
| KĻŪDA | → GAIDA (manuāla atkārtošana) |
| NEVAR ATKĀRTOT | (gāles) |
| PIEŅEMTS | (gāles) |
| SINHRONIZĀCIJA NOTIEK | → viens no gālējiem/gala stāvokļiem |

---

## OPERĀCIJU REĢISTRĀCIJA (Serveris)

Google Sheet lapa `operation_registry`:

| Kolonna | Tips | Apraksts |
|---|---|---|
| operation_id | string (PK) | Unikāla identitāte, ģenerēta klientā |
| employee_id | string | Kas veica darbību |
| action_type | string | createClient/updateClient/mark/createTask/updateTask |
| record_id | string | Aizmainētā ieraksta ID (NULL ja jauns) |
| record_version | string | Ieraksta versija pirms operācijas |
| created_at | timestamp | Kad serveris pirmo reizi saņēma |
| result | string | accepted/rejected/blocked/conflict/error |
| official_record_id | string | Oficiālais ieraksta ID (NULL ja rejected/blocked/error) |
| deduplication_valid_until | timestamp | Servera 180 dienu minimālā garantija no pirmajā saņemšanas brīža; atzīme kad klients sāk veikt lasīšanas pārbaudes |
| status_code | integer | HTTP status kods |
| replacement_op_id | string | Ja AIZVIETA — jaunā operationId |

### Servera deduplication process

 1. Pirms apstrādes, pārbauda `operation_id` eksistēcenšu `operation_registry`
 2. Ja eksistē:
    - Ja `deduplication_valid_until` ir pagājis → server lēmjā: atgriež iepriekšējo rezultātu, ja operācija vēl ir aktīvā reģistrā (var pagarināts); pretējā gadījumā `retry_not_allowed`
    - Ja `deduplication_valid_until` ir spēkā → atgriež iepriekšējo rezultātu (`already_processed` / `rejected` / `blocked`)
 3. Ja nepastāv:
    - Reģistrē operāciju; `deduplication_valid_until` = 180 dienas no reģistrācijas brīža
    - Apstrādā operāciju
    - Saglabā rezultātu

### Record versioning (konflikti)

Google Sheet lapām pievieno kolonnu `version` (automātiska, inkrementē katru maiņu):
- `atzimes`: `version` kolonna
- `klienti`: `version` kolonna
- `darbinieki`: `version` kolonna
- `uzdevomi`: `version` kolonna

Serveris salīdzina klienta pārsūtīto `record_version` ar servera pašreizējo. Ja nesakrīt → `conflict`.

---

## KLIENTA IMPLEMENTĀCIJA (sync.js)

### Operācijas modelis

Katrs `sync_queue` ieraksts satur:

```javascript
{
  id: string,            // Lokālais ID (generateId)
  operationId: string,    // operationId (koģenerē klients)
  action: string,         // createClient, updateClient, mark, createTask, updateTask
  data: object,           // Darbības dati
  recordId: string|null,  // Aizmainētā ieraksta ID
  recordVersion: string,  // Versija, kad operācija tika izveidota
  employeeId: string,     // Kurš veica darbību
  createdAt: timestamp,   // Lokālais izveides laiks
  status: string,         // GAIDA, BLOĶĒTS, KONFLIKTS, ..., PIEŅEMTS, NORAIDĪTS
  retries: number,        // Automātisko mēģinājumu skaits
  lastError: string|null,
  deduplicationValidUntil: timestamp|null, // No servera (ja saņemts)
  serverResult: object|null,              // Pēdējais servera responses
  officialRecordId: string|null,          // No servera
  replacementOpId: string|null           // Ja AIZVIETA
}
```

### Sync queue apstrāde (_processQueueUnlocked)

1. Iegūt visus `sync_queue` ierakstus
2. Kārtot hronoloģiskā secībā (createdAt)
3. Katram ierakstam:
   a. Ja `retries >= MAX_AUTO_RETRIES` (5) → pāriet uz `KĻŪDA` (ne dzēj, ne pārverš uz `NEVAR ATKĀRTOT`)
   b. Ja `deduplicationValidUntil` ir iepriekš noteikts un ir pagājis → izpildīt `check_retry_not_allowed` read-only pieprasījumu:
      - Ja `can_retry: false` → `NEVAR ATKĀRTOT`, noņemt no aktīvās rindas (saglabāt audit), **izlaiž no sūtīšanas**
      - Ja `can_retry: true` → turpināt sople (c)
   c. Nosūtīt operāciju ar `operationId`
    d. Apstrādāt servera atbildi:
       - `accepted` → `PIEŅEMTS`, noņemt no aktīvās rindas (saglabāt audit)
       - `already_processed` → `PIEŅEMTS`, noņemt no aktīvās rindas (saglabāt audit)
       - `blocked` → `BLOĶĒTS` (palik rindā)
       - `conflict` → `KONFLIKTS` (palik rindā)
       - `rejected` → `NORAIDĪTS`, noņemt no aktīvās rindas (saglabāt audit)
       - `retry_not_allowed` → `NEVAR ATKĀRTOT`, noņemt no aktīvās rindas (saglabāt audit informāciju)
       - `error` → `KĻŪDA`, palikt rindā
       - Nezināma atbilde → `KĻŪDA`
   e. Laikā `SINHRONIZĀCIJA NOTIEK` (neuzskaicināts lokālā; tikai UI indikators)

### Atkārtošanas un neveiksmīgo rezultātu kopsavilkums

- Tīkla kļūda (timeout, DNS, CORS) → `KĻŪDA` → automātisks retry ar to pašu `operationId`
- Servera kļūda (500, 502) → `KĻŪDA` → automātisks retry ar to pašu `operationId`
- Pēc `MAX_AUTO_RETRIES` (5) → automātiska atkārtošana apturēta, operācija palik `KĻŪDA`; **nepāriet** uz `NEVAR ATKĀRTOT` (tikai servera eksplīcita `retry_not_allowed`)
- `retry_not_allowed` no servera → `NEVAR ATKĀRTOT` (gāles; noņemt no aktīvās rindas, saglabāt audit)

### Lietotāja manuālā atkārtošana

Lietotājs var izvēlēties "Mēģināt vēlreiz" pogu:
- Operācija atgriežas uz `GAIDA`
- Izmantojam to pašu `operationId`
- Serveris deduplicē

### Konflikta risināšana

1. Operācija saņem `conflict` → klienta stāvoklis = `KONFLIKTS`
2. Lietotājam parādās paziņojums ar konflikta detaļām
3. Lietotāja izvēle:
   - **Turpināt**: izveidot JAUNU operationId ar pašreizējo `recordVersion`, vecā operācija → `AIZVIETA`
   - **Atcelt**: vecā operācija → `ATCELTS`

### 180 dienu deduplicācijas periods

- Serveris reģistrē `deduplication_valid_until` kā 180 dienu minimālo terminu no pirmajā reģistrācijas brīža (sekcja 12.1). Šis ir **brīdinājuma laiks**, kad klients sāk veikt read-only pārbaudi. Galīgā `NEVAR ATKĀRTOT` lēmums ir servera ekskluzīvi (sekcja 12.5).
- Kad lokālais laiks sasucin `deduplicationValidUntil`:
  - Klients veic **read-only** pieprasījumu: `?action=check_retry_not_allowed&operationId=...`
  - Serveris atgriež: `{ can_retry: true/false }`
  - Ja `false` → `NEVAR ATKĀRTOT`
  - Ja `true` → operācija palik `GAIDA`, atkārtošana turpinās

---

## DATU LĀDA APŠŪRINĀT (spec 19 — izslēdzot pretrunu)

| Stāvoklis | Lokālie glabāšanas princips |
|---|---|
| GAIDA, KĻŪDA, BLOĶĒTS, KONFLIKTS, GAIDA LIETOTĀJU | **Meklētāk** — ne dzēst, ne modificēt bez lietotāja/servera lēmuma |
| PIEŅEMTS | Pēc retention periods (14 dienas) drīkst dzēst pilno saturu; saglabāt: operationId, gala stāvoklis, servera rezultāts, officialRecordId |
| NORAIDĪTS | Pēc retention periods drīkst dzēst; saglabāt: operationId, gala stāvoklis, servera noraidījuma pamatojums |
| ATCELTS | Pēc retention periods drīkst dzēst; saglabāt: operationId, gala stāvoklis |
| AIZVIETA | Meklētāk — saistība ar aizvietojošo operāciju |
| NEVAR ATKĀRTOT | Pēc retention periods drīkst dzēst; saglabāt: operationId, gala stāvoklis, servera retry_not_allowed atbilde |

---

## MULTIUSERUNA ATBALSTS

- Katrs lietotājs glabā savas sesijas datus `sessionStorage` (login.js)
- `operationId` satur `employeeId`, tāpēc divi dažādi lietotāji nevar izveidot vienādu operationId
- Servera `LockService` nodrošina, ka paralēli pieprasījumi vienai operationId tiek apstrādāti secīgi
- Google Sheets ieraksto versija (`version` kolonna) nodrošina OCC (optimistic concurrency control)

---

## BEZSAISTES ATBALSTS (līdz 2h)

1. `DataManager.init()` ielādē datus no IndexedDB
2. Ja nav interneta — lietotājs strādā ar lokālo DB
3. Jauns darbs → tiek izveidots `operationId` → saglabāts `sync_queue` ar stāvokli `GAIDA`
4. IndexedDB `replaceStores` **nedzēš** `sync_queue` (labojums no punkta 1)
5. Kad internets atgriežas → `online` notikums triggero `processQueue()`
6. Katra operācija tiek nosūtīta ar to pašu `operationId` — server deduplicē

---

## MĒNEŠA ARHIVĒŠANA UN GOOGLE DRIVE BACKUP

Aktīvajā Google Sheet glabājas tikai pēdējie 3 pilnie mēneši. Pēc mēneša noslēguma arhivē vecāko mēnesi.

**Obligātā sekvence:**
1. Izveidot arhīvu uz Google Drive faila (CSV/SPREADSHEET) vai nosūtīt e-pastā
2. Verificēt, ka arhīvs ir veiksmīgi izveidots
3. Tikai tad dzēst vecāko mēnesi no aktīvā Sheet

**Kritērijs:** ja arhivēšana neizdodas, dati paliek aktīvajā Sheet un atkārtojas nākajā diennakts.

Google Apps Script laika trigeris veic pārbaudi katru dienu plkst. 02:00.

Šī ir atsevišķa arhitektūra no 14-dienu `sync_queue` retention un no `operation_registry` 180-dienu deduplication.

---

## SERVERA PUNKTI (GAS gas_webhook.gs)

Jauns endpoint `check_retry_not_allowed`:
```
GET ?action=check_retry_not_allowed&operationId=<id>
```
Atgriež: `{ can_retry: boolean }`
- Ja `deduplication_valid_until` ir pagājis un operācija ir arhivēta: `false`
- Ja operācija vēl ir aktīvā reģistrā (pat pār 180 dienām): `true`

---

## MEDICĪNAS DARBINIEKA SKATS

Medicīniskai apkopošanai ir atsevišķs skats, kurā netiek rādītas visas aprūpes sadaļas.

### Kas jārāda medicīnas darbiniekam

**1. Kritiskie rādījumi (automātiski):**
- Temperatūra (īpaši izteiktas novirzes vai straujas izmaiņas)
- Diennakts urīna daudzums (būtiskas izmaiņas)
- Uzņemtais H₂O daudzums (būtiskas izmaiļas)
- Ēdienreižu uzņemšana (atkārtoti nepietiekama)
- Vēdera izeja (reģistrēta kā problēma vai ilgstoši neesoša)
- Pārvietošanās/pozicionēšanas spēja (būtiskas izmaiļas)
- Ādas problēmas (ja reģistrētas)
- Jebkuri aprūpētāja atzīmētie gadījumi "Pievērst medicīnisko uzmanību"

**2. Izmaiņu salīdzinājums:**
Katrā kritiskajā rādījumā jāsalīdzina ar iepriekšējo vērtību:
```
🔴 Temperatūra: 38.1 °C — iepriekšējā mērījuma laikā 36.7 °C
🔴 Urīns: 500 ml — iepriekšējā diennakts 800 ml ↓
```

**3. Tendencu attēlojums:**
Īsa vēsturiskā trenda (pēdējās 3 dienas/vērtības):
```
Temperatūra: 36.6 → 37.4 → 38.1 °C ↑
Urīns: 1100 → 800 → 500 ml ↓
H₂O: 1400 → 1050 → 700 ml ↓
```

**4. Aprūpētāja manuālas atzīmes:**
Katrs ieraksts var tikt atzīmēts ar "Pievērst medicīnisko uzmanību" + īss komentārs. Tā nedrīkst prasīt nozīmēt medicīnisko diagnozi.

**5. Pāreja uz pilno ierakstu:**
Katrs medicīniskais kopsavilkuma ieraksts ir klikšķināms, atverot sākotnējo aprūpētāja ievadīto informāciju.

### Principi

- Medicīnas skats **ne dzēš** un **ne aizstāj** pilno aprūpes lapu. Tas ir filtrēts skats.
- Automātiskie brīdinājumi ir **informatīvi**, neatzīmē vai formulē kā diagnoze.
- Medicīnisko izvērtējumu veic medicīnas darbinieks.

### Sākuma ekrāna princips

Medicīnas darbinieka sākumlapa atbild uz četriem jautājumiem:
1. **Kas ir mainījās?** — izmaiņu salīdzinājums
2. **Kas ir ārpus noteiktā diapazona?** — kritiskie rādījumi
3. **Kas atkārtojas vai pasliktinās?** — tendencu attēlojums
4. **Ko atzīmējis aprūpētājs?** — manuālas atzīmes

---

## VERFIKĀCIJA — 29 testi (pilnais izvērtējums sekmīgi)

| Nr | Tests | Aizkļūt |
|---|---|---|
| 1 | Offline saglabāšana | operationId izveidots, stāvoklis GAIDA |
| 2 | Tīkla pārtraukums | Retry ar to pašu operationId, nav otrs oficiāls ieraksts |
| 3 | Divas vienādas darbības | Divi operationId |
| 4 | rejected | NORAIDĪTS, netiek ieskaitīts oficiālajos |
| 5 | Data load ne dzēš rindu | sync_queue palik |
| 6 | Logout ne dzēš darbu | Operācija saglabāta |
| 7 | Atjauninājums ne dzēš darbu | operationId nemainās |
| 8 | Conflict | server returns conflict |
| 9 | Conflict turpināšana | AIZVIETA + jauns operationId |
| 10 | Conflict atcelšana | ATCELTS |
| 11 | 180 dienas | Client check, server decides |
| 12 | Server return retry_not_allowed | NEVAR ATKĀRTOT |
| 13 | Server pagarina retry | can_retry = true |
| 14 | Retry limits | Operācija netika dzēsta |
| 15 | Blocked | BLOĶĒTS, netiek automātiski sūtīts |
| 16 | Unblock | GAIDA pēc check |
| 17 | Invalid response | KĻŪDA |
| 18 | Storage pilns | Operācija netiek izveidota |
| 19 | Final operācijas cleanup | Pilna kopija dzēsta, audit paliek |
| 20 | Never reached server | Audit paliek (operationId + stāvoklis) |
| 21-29 | PIN, multi-user, security, migration, traceability | Sektori 21-29 |

**Medicīniska skata testi:**

| Nr | Tests | Aizkļūt |
|---|---|---|
| 30 | Kritiskie rādījumi | Temperatūra/urīns/H₂O tiek parādīti ar izmaiņām |
| 31 | Izmaiņu salīdzinājums | Katrs rādījums salīdzināts ar iepriekšējo |
| 32 | Tendencu attēlojums | Parādās 3 dienu vēsture |
| 33 | Aprūpētāja atzīmes | "Pievērst uzmanību" parādās medicīniskajā skatā |
| 34 | Pilna ieraksta pāreja | Medicīniskais skats atver aprūpētāja ierakstu |

---

## IZMAINDZĒŠANAS

### Kāds darbs

1. Backend (gas_webhook.gs): 4 dienas
   - operation_registry lapas izveide un migrācija
   - version kolonnas pievienošana visām lapām
   - `check_retry_not_allowed` endpoint
   - actionId → operationId migrācija

 2. Frontend (sync.js, dataManager.js, medicine_view.js): 7 dienas
    - operationId ģenerēšana un glabāšana
    - Stāvokļu modelis (10+1)
    - Sync queue refactor (nedu dzēst pēc data load)
    - Conflict rešlīnāšana (version checking)
    - 180 dienu window implementācija
    - Medicīniska skata komponenti (kritiskie rādījumi, izmaiņas, tendences)

 3. Testi: 2 dienas
    - 34 spec testi
    - Integration tests

4. Migrācija (esoošie sync_queue): 1 diena
   - actionId → operationId mapping
   - version kolonnu sync