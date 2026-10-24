# Aprūpes Sistēma — Pro Comercials Dokumentācija

**Versija:** 2.0 (Production Ready)  
**Valoda:** Latviešu / Krievu / Angļu  
**Platforma:** PWA (Progressive Web App), HTML5 + JavaScript, Google Sheets backend (Google Apps Script)  
**Cena:** 50 000 EUR (1:1 licence, pilna kopija, bez periodiskām maksājām)  

---

## 1. Ekssekutīvais apskats

Aprūpes Sistāma ir moderna, droša un lietojama tūkstošiem klientiem sociālās aprūpes iestādēs. Sistēma nodrošina digitālo aprūpes dokumentāciju, darbinieku un klientu pārvaldību, uzdevumu plānošanu un ikmēneša Excel atskaišu ģenerēšanu.

Sistēma ir veidota kā „mobile-first” progresīvā tīmekļa lietotne, kas darbojas visu ierīcēs (dators, plansēts, telefons) un atbalsta darbu arī bez interneta savienojuma.

---

## 2. Galvenās priekšrocības

| Parametrs | Vērtība |
|-----------|---------|
| Licences tips | 1:1 pilna kopija, private repozitorijs |
| Klientu skaits | Neierobežots (testēts ar 500+ klientiem, 300 000+ atzīmēm) |
| Darbinieku lomas | 3: aprūpētājs, kontroliere, administrators |
| Datu avots | Google Sheets (patiesības avots) + IndexedDB (loka kešatmiņa) |
| Darbošanās bezsaistē | Jā, visas izmaiņas saglabājas lokāli un sinhronizējas atkal |
| Eksports | Ikmenes Excel atskaites (vienam klientam vai visam mēnešam) |
| Valodas | Latviešu, Krievu, Angļu |
| Drošība | PIN hašēšana (HMAC-SHA256 + jaucējvērtība), sesijas 8h, brūtspēka aizsardzība |

---

## 3. Sistēmas arhitektūra

### 3.1 Sastāvdaļas

```
Klienta saskarne (HTML/CSS/JS, PWA)
        ↓ JSONP / HTTPS
Google Apps Script (backend)
        ↓
Google Sheets (patiesības avots)
```

| Līgums | Apraksts |
|--------|----------|
| `index.html` | Pieteikšanās lauka (autentifikācija ar kopīgo paroli un PIN) |
| `aprupe.html` | Aprūpētāja sākumlapa: klientu saraksts, uzdevumu tabula |
| `aprupetajs.html` | Klienta detaļas: aprūpes forma ar kategorijām un paraksti |
| `admin.html` | Administrācijas panelis: klienti, darbinieki, eksports |
| `control.html` | Kontroleiļa panelis: statistika, vēsture, mēneša skats |
| `js/config.js` | Vienotā konfigurācija (GAS URL, SHEET_ID, lauku definīcijas) |
| `js/db.js` | IndexedDB ietvars (CareDB) ar atmiņas rezerves modu |
| `js/sync.js` | Sinhronizācijas dzinējs (CareSync), rindas apstrāde, bezsaistes atbalsts |
| `js/login.js` | Autentifikācijas kontrolleris, sesiju pārvaldība |
| `js/logout.js` | Drošs iziešanās plūsmas ar nesaglabāto izmaiņu pārbaudi |
| `js/admin.js` | AdminPanel: CRUD klientiem/darbiniekiem, dublikātu meklēšana |
| `js/control.js` | ControlPanel: statistika, vēsture, Excel eksports, mēneša skats |
| `js/tasks.js` | Uzdevumu pārvaldnieks |
| `js/care_form.js` | Aprūpes forma un paraksta sistēma |
| `js/excel_export.js` | ExcelExporter — ikmēneša atskaišu ģenerētājs |
| `js/i18n.js` | Daudzvalodu tulkojumi (LV / RU / EN) |
| `js/timezone.js` | Laika joslas utilītas (Europe/Riga) |
| `backend/gas_webhook.gs` | Google Apps Script aizmugursistēma (drošā ieejas vārtnē) |

### 3.2 Datu plūsma

1. Sākotnējā ielāde no Google Sheets caur `loadInitialData()`
2. Normalizācija katrai rindai (`normalizeRow()`)
3. Saglabāšana IndexedDB (`CareDB.replaceStores()`)
4. Izmaiņas tiek ievietotas sinhronizācijas rindā (`sync_queue`)
5. Fons automatiski nosūta rindu uz serveri, kad ir savienojums
6. Lietotājs strādā ar lokālajiem datiem — bez gaidīšanas uz serveri

---

## 4. Lietotāju lomas un atļaujas

| Loma | Atbildības | Pieejamās lapas |
|------|------------|-----------------|
| **Aprūpētājs** | Skatīt klientus, reģistrēt aprūpes atzīmes, parakstīt maiņas, pabeigt uzdevumus | `aprupe.html`, `aprupetajs.html` |
| **Kontroliere** | Skatīt statistiku, auditņa vēsturi, izveidot uzdevumus, eksportēt Excel | `control.html` |
| **Administrators** | Pilna piekļuve: izveidot/rediģēt klientus un darbiniekus, pārvaldīt licenci | `admin.html`, `aprupetajs.html` (admin režīms) |

### Autentifikācija

1. **Solī 1** — Kopīgā parole (ierīces atvērējs), der 8 stundas
2. **Solī 2** — Darbinieka izvēle no servera (bez PIN laukiem klientā)
3. **Solī 3** — Individuālais PIN (4–6 cipari), serveris salīdzina HMAC-SHA256
4. Pēc veiksmīgas pārbaudes tiek izsniegts sesijas tokens (der 8 stundas)
5. PIN un paroles nekad netiek saglabāti klienta ierīcē

---

## 5. Aprūpes dokumentēšana

Aprūpētājs reģistrē katrā maiņā (Rīts / Vakars) šādas kategorijas:

| Kategorija | Lauki | Apraksts |
|------------|-------|----------|
| Temperatūra | `temperatura` | Skaitlis (°C), ≥37 = sarkanais paziņojums |
| Higiēna | 7 pārslēdzami lauki | Mutes dobuma kopšana, vanna/duša, daļēja apmazgāšana, veļas maiņa, nāgu kopšana, matu kopšana, bārdas skūšana |
| Aktivitāte | 3 pārslēdzami lauki | Pārvietojas ar palīglīdzekli, stāv ar palīdzību, sēž ar palīdzību |
| Ēdīšana | 4 ēdienreizes | Brokastis, pusdienas, launags, vakariņas (X / ½ / A) |
| Šķidrumi | `urina_daudzums`, `uzņemts_ml` | Kumulatīvi maiņas ietvaros |
| Fizioloģija | `vēdera izeja` | Normāla / Aizcietējumus / Caureja / Svecīte / Klizma |
| Citi pasākumi | Ādas kopšana, pastaigas, ciemiņi, autiņbiksīšu maiņa | Toggle un skaitļa lauki |
| Paraksts | `aprupetaja_paraksts` | Digitālais paraksts katrai maiņai |

Parakstu sistēma novērš krustmaiņu konfliktus: viens aprūpētājs var parakstīt klientam tikai vienu maiņu; citi var veikt aprūpes darbības, bet nevar parakstīties, ja cits jau ir parakstījies.

---

## 6. Uzdevumu pārvaldība

- Piešķirami uzdevumi ar termiņu un prioritāti (augsta / vidēja / zema)
- Statuss: jauns / procesā / pabeigts
- Darbinieks var atzīt uzdevumu kā pabeigtu
- Administrators var pārskatīt visus uzdevumus un to izpildi

---

## 7. Excel eksports

Sistēma ģenerē ikmēneša aprūpes dokumentāciju no veidnes `Aprūpes lapas.xlsx`:

- Lapa 1: dienas 1–15, Lapa 2: dienas 16–31
- Katrā dienā divas kolonnas (R un V maiņa)
- Rindas 9–31 kartējas visām aprūpes kategorijām
- Skaitliskie lauki tiek summēti pēc maiņām un kopumā
- Pieejams eksports vienam klientam, visiem aktīviem klientiem vai izvēlētiem klientiem datu diapazonā

---

## 8. Drošība un datu apsauga

### 8.1 Autentifikācija

- PIN hašēts ar **HMAC-SHA256** un jaucējvērtību (pepper), atklāts PIN nekad netiek saglabāts
- Salīdzināšana notiek serverī, neatkarīgi no klienta
- Kopīgā parole aizsargs ierīces atvēršanu, sesijas tokens der 8 stundas
- Brūtspēka aizsardzība: pēc 10 neveiksmīgām mēģinājumiem — 5 minūšu bloķēšana

### 8.2 Datu saglabāšana

- Google Sheets ir vienīgais patiesības avots
- Loka IndexedDB kešatmiņa ļauj strādāt bez interneta
- Slēptie dati (PIN haši, paroles) glabāti Google Script Properties, ne vietā kodā
- Autentifikācijas dati neatkarīgi no klienta — „nulle uzticēšanās klientam” princips

### 8.3 Pievienojamība

- HTTPS caur Google Apps Script publiskā vietni
- CORS konfigurēts
- Service Worker (PWA) ātrāka ielāde un offline atbalsts

---

## 9. Uzturējami kodex (refaktorēts)

Sistēmas kods ir sagatavots komerciskai izmantošanai:

- **Vienotā konfigurācija** (`config.js`) — visi konstantes un URL vienā vietā
- **Modulārā struktūra** — katrai sadaļai atsevišķs kontrollers, nav savilktas atbildības
- **Nekas nav dublikēts** — palīgfunkcijas (escapeHtml, datumu formatēšana, lomu krāsas) izvietotas kopīgi un lietotas atkārtoti
- **Nav mirušo koda** — visās funkcijās ir reāli izmantošanas vietas, nav nedarbojošo fragmentu
- **Standartizēti lauku nosaukumi** — camelCase un snake_case kartēšana ir vienotā un dokumentēta

---

## 10. Lietošanas scenārijs (komerciskai iestādei)

1. **Iestatīšana**  
   - Izvieto `backend/gas_webhook.gs` Google Apps Script vidē  
   - Izveido savu Google Sheet datu lapu ar nepieciešamajām lapām  
   - Aizstāj `CONFIG.GAS_URL` un `SHEET_ID` savām vērtībām  
   - Publicē web app ar piekļuvi savam personālam  

2. **Pirmā startēšana**  
   - Ievada kopīgo paroli un izveido pirmo administratoru  
   - Pievieno darbiniekus un klientus caur Administrācijas panelī  

3. **Darbība**  
   - Aprūpētāji ieraksta aprūpi katrā maiņā  
   - Kontrolieri skatījas statistiku un vēsturi  
   - Administratori pārvaldīju personālu un eksportē atskaiti  

---

## 11. Licence un pārdošanas noteikumi

- **1:1 licence** — pirksis saņem visu kodu kā pilnu kopiju savā GitHub repozitorijā
- **Privāts repozitorijs** — ieteicams komerciem datiem
- **backend/gas_webhook.gs** jāiekopē manuāli Google Apps Script redaktorā (nav git repozitorijā)
- Katra iestāde iestata savu GAS izvietošanu un savu Google Sheet ID — pilna datu patiesa pats savā kontroles
- **Nekādas periodiskas maksājums** — vienreizs maksājums, pats patur savu sistēmu

---

## 12. Pamata konfigurācijas saraksts (komercdrošībai)

| Fail | Darbība |
|------|---------|
| `js/config.js` | Mainīt `GAS_URL` un `SHEET_ID` saviem |
| `sw2.js` | Mainīt `CACHE_NAME` uz savu mārkējumu |
| `version.json` | Mainīt versiju uz `commercial-v1` |
| `manifest.json` | Atjaunināt nosaukumu un ikonas |
| `backend/gas_webhook.gs` | Ievietot Google Apps Script, iestatīt `SHEET_ID` |

---

## 13. Kvalitātes pasāklamība

Sistēma ir testēta un paredzēta reāliem lietotājiem:

- E2E testi: 114/114 izturēti
- Atbalsta 300 000+ atzīmju rindas
- Darbojas bezinternetā, sinhronizējas automātiski
- Ģenerē pareizus Excel atskaitus ar visām maiņām un dienām
- Valodas skaitļi un diakritiskie zīmes strādā korekti

---

## 14. Tehniskā atbalsta un uzturēšanas modeļa ieteikums

Šis dokuments ir sagatavots tā, lai sistēma var tikt nodrošināta kā **pilnvērtīgs komercisks produkts**. Ieteicams:

1. Katrai klientam — savs GitHub private repozitorijs un savs GAS izvietošanas URL
2. Datu īpašniecība paliek klienta Google kontā (Google Sheets ir klienta īpašums)
3. Kods tiek nodrošināts kā 1:1 kopija, bez periodiskām abonementa maksātajām
4. Papildu izmaiņas un uzturēšana tiek pieņemtās atsevišķi, pēc līguma

---

*Aprūpes Sistāma — digitālā sociālās aprūpes dokumentācija, gatava komerciskai izmantošanai.*
