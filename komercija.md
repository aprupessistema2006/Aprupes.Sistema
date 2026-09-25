# Komercizstrāde ar Aprupes Sistema

## 1. Kā izveidot 1:1 GitHub repozitoriju (pilna kopija)

### Soļi:

1. **Izveidot jaunu GitHub repozitoriju:**
   - Pārgāt uniesiet uz github.com
   - Klikšķiniet "New" (jauns repo)
   - Nosaukums: piemēram, `CompanyCareSystem`
   - Iestāvokas: Private (privāts) ja ir jāsedz uzņēmuma noslēpumbarādība
   - Neatzīmēt "Initialize with README" — tiks iztukšots
   - Izveidot repo

2. **Pievienot jauno repo kā "remote":**
   ```bash
   cd C:\Users\davis\Desktop\Aprupes_sistema
   git remote add commercial https://github.com/JūsuUzņēmums/CompanyCareSystem.git
   git remote -v
   ```
   *Izveidots `remote` ar nosaukumu "commercial" — tas ir tikai vienkārša atauce, nedzēst "origin"*

3. **Push bez tagiem:**
   ```bash
   git push commercial main
   ```
   *Visi faili, .html, .js, sw2.js, version.json, backend/ etc. tiks pārsūtīti 1:1*

4. **Tagu pārliegšana (ja ir tagi):**
   ```bash
   git push --tags commercial
   ```

5. **Pārbaudīt 1:1 atkārtotu:**
   ```bash
   git remote -v
   # origin  https://github.com/aprupessistema2006/Aprupes.Sistema.git (fetch)
   # origin  https://github.com/aprupessistema2006/Aprupes.Sistema.git (push)
   # commercial https://github.com/JūsuUzņēmums/CompanyCareSystem.git (fetch)
   # commercial https://github.com/JūsuUzņēmums/CompanyCareSystem.git (push)
   
   git log --oneline -1 commercial/main
   git log --oneline -1 main
   # Hash vajadzētu būt vienāds → tas ir zelts, ka kods ir 1:1
   ```

6. **Upstream iestatīšana (izvēlnei):**
   ```bash
   git branch --set-upstream-to=commercial/main main
   # Tagad `git pull` un `git push` noklusēti iet uz commercial
   ```

## 2. Kas ir 1:1 - kas tiek pārliegts

| Elements | 1:1 režīmā |
|---------|-----------|
| Visi `.html` faili | ✅ Pilnīgi bez izmaiņām |
| `sw2.js` (service worker) | ✅ Pilnīgi bez izmaiņām |
| `js/*.js` visi faili | ✅ Pilnīgi bez izmaiņām |
| `css/*.css` faili | ✅ Pilnīgi bez izmaiņām |
| `version.json` | ✅ Bez izmaiņām |
| `backend/gas_webhook.gs` | ⚠️ Šo failu NAV git repozitorijā (ir `.gitignore`) — to manuāli jākopē |
| `AGENTS.md` | ✅ Bez izmaiņām |
| `README.md` | ✅ Bez izmaiņām |

**Svarīgi:** `backend/gas_webhook.gs` ir `.gitignore` — tas nozīmē, ka tas netiek pārsūtīts git. Pēc push jāmanuāli ielādēt GAS kodu Google Apps Script redaktorā.

## 3. Konkrēta konfigurācija komercdrošībai

### 3.1 main.js → config.js: Mainīt CONFIG

Atveriet `js/config.js` un mainiet:
```javascript
// Tagad:
SYNC_URL: 'https://script.google.com/macros/s/AKfycbzu.../exec',

// Jums vajag izveidot savu Google Apps Script un ielādēt backend/gas_webhook.gs tur,
// tad aizstāt URL ar savu:
SYNC_URL: 'https://script.google.com/macros/s/AKfycbxyzJūsuID.../exec',
```

### 3.2 Service Worker versija

Atveriet `sw2.js` un mainiet:
```javascript
const CACHE_NAME = 'company-caresystem-v1'; // Mainiet no 'aprupes-sistema-v30'
```

### 3.3 version.json

Mainiet:
```json
{ "version": "commercial-v1", "sw_version": "company-caresystem-v1" }
```

### 3.4 Google Apps Script iestatīšana

1. Pārgāt uz script.google.com
2. Izveidot jaunu projectu
3. Kliksi "Extend" → "Apps Script"
4. Izņemiet visu saturu no `backend/gas_webhook.gs` (fails nav repozitorijā — tas ir lokāli)
5. Ielīmēt to Apps Script projektā
6. Izmainiet Google Spreadsheet ID uz komercdrošības datiem (redaktorā: `var SHEET_ID = 'jūsu-gsheet-id'`)
7. Publicēt → "Deploy" → "New Deployment" → "Web App"
8. Iestatiet: "Execute as: Me", "Who has access: Anyone" (vai "Anyone with Google account" ja gribat drošīgu piekļuvi)
9. Kopēt published URL un ielīmēt `js/config.js` `SYNC_URL`

### 3.5 CORS un SSL

- Google Apps Script publicētā vietne automātiski ir HTTPS
- CORS ir konfigurēts GAS `doGet` funkcijā ar `ContentService`
- Service Worker reģistrējas automātiski no `index.html`

## 4. Komercdrošības noteikumi

### 4.1 Datu struktūra

Datu formāts paliek **1:1**:
- `vards`, `uzvards` klientu laukā
- `loma` darbinieka laukā (aprūpētājs/kontroliere/administrators)
- `aktivs` boolean/polja laukā
- Svērā datums formāts `YYYY-MM-DD`

### 4.2 Veidlapu migrācija

Visas formas (`aprupetajs.html`, `control.html`, `admin.html`) darbojas bez izmaiņām:
- Hospitalizācijas pārvaldība
- Hinārijas ieraksti
- Uzdevumu pievienošana
- Kartu renderēšana

### 4.3 Ielādes optimizācija 300k rindām

Ar 33 klientiem × 90 dienām = ~300k atzīmju rindas, sistēma ir optimizēta:
- Bootstrap ielādē tikai `klienti` (500 rindas maks.) — ~1s
- Fonā ielādē attīstās 2000/s (500/lapa)
- `loadClientRange` ielādē konkrētā klienta datus pēc pieprasījuma (7 dienas, 1000/lapa maks.)
- UI nepārflegtīs — visas fonā ielādes izmanto `setTimeout(0)` atzīmējuma atzīmē

## 5. Pārbaudes saraksts pēc deploy

1. ✅ Atveriet `index.html` — versija mainījās
2. ✅ Ielogojoties ar darbinieku — šeit būtu 10 darbinieki
3. ✅ Pārbaudiet klientu karti — būs 4 klienti (maināmi uz Jūsu 33)
4. ✅ Meklēšana darbojas abiem vārdiem (diakritiskie tēli)
5. ✅ Atveriet karti — dati ielādējas (vai klienta vēsture)
6. ✅ Rakstīt atzīmi — sinhronizācija ar GAS notiek fonā
7. ✅ Logout — sinhronizācijas stāvoklis "Dati sinhronizējas fonā"

## 6. Saglabājiet šo failu

- Nodosiet šo failu Jūsu komandai kā dokumentāciju
- Atjaunojiet versijas numurus katru reizi, kad mainat `version.json`
- Sekojiet `AGENTS.md` failam sekojošajai attīstībai
