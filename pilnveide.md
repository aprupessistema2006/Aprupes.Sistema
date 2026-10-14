# Drošības ieviešanas plāns — Aprūpes sistēma

**Mērķis:** klientu dati pieejami tikai autorizētiem darbiniekiem. GitHub Pages ir publiska sākumlapa; aprūpes lietne darbojas Google Apps Script HtmlService saskarnē; Google Sheets paliek privāta. 100% bezmaksas, bez Cloudflare Workers.

**Pieņemšanas kritērijs:** persona, kas zina GitHub Pages adresi, publisko pirmkodu un GAS adresi, nevar nolasīt vai mainīt klientu datus un nevar veikt neatļautas darbības.

**Draudu modelis:** ārzemjš ar visu publisko kodu un GAS adresi; neautorizēts tiešs `google.script.run` funkcijas izsaukums (nosaukumi ir redzami served HTML); viltots vai pagadīts sesijas ID; brute-force pēc paroles/PIN; ierīces zaudēšana (offline krājumi).

**Noteikums:** drošība nekad nepārlēdzas uz klienta kodu slēpumu — HtmlService served HTML/JS ir redzams pārlūka darba rīkos; visa pārbaude notiek serverī.

---

## Fāze 0 — Sagatavošanās (pirms izmaiņām)

1. **Novērst SHEET_ID nesakritību** starp `backend/gas_webhook.gs` (`1uUf-qZ...`) un `js/config.js` (`1OQAdi...`). Abās vietās viens un tas pats ID.
2. **Inventarizēt visus datu piekļuves ceļus** (tagadējās `routeActionData` darbības): `ping`, `load`, `createClient`, `createEmployee`, `updateClient`, `updateEmployee`, `mark`, `setShift`, `createTask`, `updateTask`, `check_retry_not_allowed`, `dump_raw`, `repair_dates`, `repair_times`, `backfill_keys`. Katru pārvest par servera funkciju ar sesijas un lomas pārbaudi vai noņemt.
3. **Kartēt esošo login plūsmu** (`js/login.js`): PIN tagad tiek pārbaudīts klientā pret `darbinieki.pin`, kas nāk `load` atbildē — abas daļas jāmaina.
4. **Saglabāja versiju** (tagadējā izvietotā GAS versija), lai izejas atpakaļ (rollback), ja jaunā versija bojā darbu.
5. **TRANSPORTA PROTOTIPS (būtisks, pirms pārveides):** transporta risinājums ir **viens noteikts** — pašreizējā lietotnes saskarna pārvietojama uz **GAS HtmlService**, datu funkcijas izsauc ar **`google.script.run`**; GitHub Pages paliek publiska sākumlapa, kas atver aprūpes lietotni. Klientu dati **netiek nosūtīti caur publisku JSONP galapunktu**. Pirms pārveides izveidot nelielu prototipu un **pārbaudīt, ka GAS saskarne darbojas visās sešās ierīcēs** (iepriekšējā saskarnē, bez datiem), ieskaitot offline režīmu un LV/RU/EN valodas. Pēc tam pārnest esošo saskarni un darbības, **saglabājot pašreizējo izskatu un funkcionalitāti**. Prototipa iznākums dokumentēts šeit, ar rezultātiem un ierīcēm.

## Fāze 1 — Servera autentifikācijas kodols (`gas_webhook.gs` / HtmlService server-faili)

1. **Slēptās vērtības glabā Script Properties** (`PropertiesService.getScriptProperties()`): kopīgā parole, HMAC slēptā atslēga. **Nevienā gadījumā** šīs vērtības netiek ievietotas GitHub.
2. **Pieteikšanās (jauna darbība `login`):**
   - Darbinieks ievada **kopīgo paroli**, pēc tam **izvēlas savu vārdu no saraksta** un ievada **personīgo PIN**.
   - Darbiniekam **nav jāzina vai jāievada savs ID**.
   - Darbinieku sarakstu serveris atdod **tikai pēc kopīgās paroles pārbaudes**; sarakstā nav PIN, PIN jaucējvērtības vai citu slepenu lauku.
   - Serveris pārbauda darbinieka PIN un to, vai darbinieks ir **aktīvs**.
   - Ja pārbaude veiksmīga, serveris **izveido sesiju**; ja nav veiksmīga, klientu dati netiek ielādēti.
   - Parole un PIN **netiek sūtīti URL**.
   - Kļūdas ziņojums ir vienkāršs un vienots: **„Nepareiza parole vai PIN."** (neatklāj, vai eksistē vārds vai kurš no diviem elementiem bija nepareizs).
   - Ja diviem darbiniekiem ir vienāds vārds, sarakstā to atdala (piem., ar lomas vai kodu papildinājumu) — apstiprināt biznesa pusē.
3. **Sesija:**
   - Sessijas ID = nejauši `Utilities.getUuid()`, glabā serverī (Script Properties vai `sessions` lapa): darbinieka ID, loma, izdošanas laiks, paroles versija, darbinieka versija.
   - Sessijas ilgums **8 stundas**.
   - Klients nosūta sessijas ID ar katru `google.script.run` izsaukumu; **sesijas identifikatoru nedrīkst pieņemt kā derīgu bez servera puses pārbaudes**.
4. **Pieprasījumu transports:** visas datu darbības veikt, izsaucot **autorizētas servera funkcijas ar `google.script.run`**. Pirms katras datu lasīšanas vai izmaiņas serveris pārbauda **sesiju un darbinieka tiesības**. Neatļautas darbības tiek noraidītas. Paroli un PIN neievieto URL, pārlūka vēsturē vai žurnālos. Ja sesija ir nederīga vai beigusies, lietnei jāatgriežas pieteikšanās ekrānā.
5. **Kļūdu ziņas neatklāj**, vai darbinieka vārs eksistē vai PIN pareizs.
6. **PIN glabāšana:** katram darbiniekam glabāt **individuālu sāli un PIN jaucējvērtību** (`pin_salt`, `pin_hash`). PIN pārbaudi veikt **tikai serverī**, izmantojot paroļu glabāšanai piemērotu, pārbaudītu jaucējalgoritmu — Apps Script neiestāda native PBKDF2/bcrypt, tāpēc: `pin_salt` = nejauši 16 baiti, `pin_hash` = iterēts HMAC-SHA256 (`HMAC(pin_salt, pin)` atkārtots 10 000 reizes, `Utilities.computeHmacSha256Signature`). **Pirms ieviešanas pārbaudīt tā darbību un izpildes laiku Apps Script vidē** (mērķis < 1 s, ievērojot kvotas). Obligāti **vismaz 6 ciparu PIN**, neveiksmīgo mēģinājumu ierobežošana un neaktīvu darbinieku bloķēšana. **Pēc migrācijas atklātos PIN izņemt no datu lapas un no visām klientam atdotajām atbildēm.**
7. **Sesiju atcelšana:**
   - Kopīgās paroles maiņas gadījumā **visas iepriekšējās sesijas kļūst nederīgas** (paroles versija).
   - Darbinieka deaktivizēšanas gadījumā **viņa sesija kļūst nederīga** (darbinieka versija / `aktivs=false`).
   - Serveris pārbauda **sesijas derīgumu, darbinieka statusu un tiesības katrā datu darbībā**.
   - **Sesiju atcelšanas pārbaudēs neizmantot kešatmiņu, kas varētu turpināt atļaut piekļuvi pēc atcelšanas** — darbinieka statusa pārbaude notiek serverī katrā izsaukumā (slodze pieejama 6 ierīcēm; kvotas jānovēro).
8. **`ping` atbildē tikai nekonfidenciāls statuss** (`success`, `pong`, versija) — nekādi dati, ne klientu/darbinieku informācija, ne konfigurācijas noslēpumi, ne `_diag`.

## Fāze 2 — Klienta puse (HtmlService saskarne)

1. **Pieteikšanās plūsma (`js/login.js`):**
   1. Atverot lietotni, parādās kopīgās paroles lauks.
   2. Pēc pareizas paroles pārbaudes parādās darbinieku vārdu saraksts.
   3. Darbinieks izvēlas savu vārdu un ievada PIN.
   4. Pēc sekmīgas servera pārbaudes atveras ierastā darba vide ar darbiniekam atbilstošajām tiesībām.
   5. Sessiju atcerēties tikai tās derīguma laikā; pēc izrakstīšanās vai sesijas beigām pieprasīt atkārtotu pieteikšanos.
   - Darbiniekam **nav jāievada ID, jāmaina pārlūka iestatījumi vai jāveic tehniskas darbības**.
2. **`js/sync.js` aizstāt** ar `google.script.run` ietveri: katrs pieprasījums (`load`, `mark`, u.c.) iet ar sessijas ID; atraidītās atbildes → izrakstīšanās un atgriešanās pie pieteikšanās ekrāna.
3. **`load` datu apjums pēc lomas** — nedrīkst izsniegt visus klientu datus visām lomām: aprūpētājs → savi klienti un savas atzīmes; kontroliere → statistika/atzīmju vēsture bez klientu PII, ja biznesa loģika to neprasa; administrators → viss. Konkrēto datu apjomu apstiprina biznesa puse, pirms izstrādes.
4. **Darbinieka identitāte serveris ņem no sesijas**, nevis no klienta nosūtīta parametra (`mark`, `updateTask` u.c.) — tā novērš identitātes izlikšanu. `operation_registry` kļūst uzticams, jo `employee_id` vairs nav klienta kontrolē.
5. **Vecais publiskais JSONP datu galapunkts (`doGet`/`doPost` datu darbības) jānoņem no izvietotās versijas** — publiska GAS adrese pati par sevi nedrīkst dot iespēju nolasīt vai mainīt klientu datus.

## Fāze 3 — Lomu tiesību matrica (serverī, katrā funkcijā)

| Funkcija | aprūpētājs | kontroliere | administrators |
|---|---|---|---|
| `ping` | jā (bez datiem) | jā | jā |
| `login` | jā | jā | jā |
| `load` | jā (savi klienti) | jā (statistika) | jā (viss) |
| `mark`, `setShift` | jā | nē | jā |
| `createTask`, `updateTask` | tikai pabeigt savus | jā | jā |
| `createClient`, `updateClient`, `createEmployee`, `updateEmployee` | nē | nē | jā |
| `check_retry_not_allowed` | nē | jā | jā |
| `dump_raw`, `repair_dates`, `repair_times`, `backfill_keys` | **izņemt no izvietotās versijas** vai tikai admins | — | tikai admins |

## Fāze 4 — Neveiksmīgo mēģinājumu ierobežošana (apkeicei noturīga)

1. **Pastāvīgs skaitītājs** dedikētā lapā (piem., `auth_attempts`): katrs neveiksmīgs mēģinājums ieraksta laika zīmogu ar darbinieka ID.
2. **`LockService` (document lock) ap skaitītāja lasīšanu+palielināšanu+ierakstīšanu**, lai vienlaicīgi pieprasījumi neiznīcinātu skaitītāju. Ja slēdpunktu nevar iegūt pirms timeout — **fail-closed**: pieteikšanās tiek noraidīta (drošība priekšā pieejamībai), un gadījums tiek žurnālēts.
3. **Slēgšana:** N (piem., 5) neveiksmīgi mēģinājumi M minūšu logā → slēgts L minūtēm (piem., 15). Skaitīšana notiek serverī, neatkarīgi no klienta.
4. **Atslēga pēc darbinieka ID un papildu atslēga pēc paroles** (globāls mēģinājumu limits), lai nevarētu apiet, mainot darbinieka ID.
5. **Globāls ierobežojums:** kopējais neveiksmīgu mēģinājumu limits visiem lietotājiem minūtē (piem., 50) → īss globāls atspēšanas periods; aizsargs pret masveida uzbrukumu.
6. **Ierobežojums attiecas uz pieteikšanās funkciju**, nevis uz visām datu funkcijām (lai nebloķētu likumīgo sinhronizāciju).
7. Ņemt vērā GAS bezmaksas kvotas (izpildes laiks, diennakts zvani) — skaitītāja rakstīšana ir vēl viens zvans, tāpēc ierakstīt tikai neveiksmīgos mēģinājumus, vecos ierakstus periodiski tīrīt, un `LockService` izmantot tikai īsā darījuma laikā.

## Fāze 5 — Offline datu aizsardzība (HtmlService lietnes lokālā krātuve)

1. **Visus lokāli glabātos klientu datus un sinhronizācijas rindu** (IndexedDB / lietnes krātuve `script.google.com` izcelsmē) **šifrēt**.
2. **Šifrēšanas atslēgu neglabāt kopā ar datiem**; pēc izrakstīšanās vai sesijas beigām to **izņemt no lietotnes atmiņas** (atslēga atvasināta no kopīgās paroles, WebCrypto PBKDF2).
3. **Pēc izrakstīšanās vai sesijas beigām bez jaunas autorizācijas nedrīkst būt iespējams atgūt lokālos klientu datus.**
4. **Pārbaudīt, ka offline izmaiņas pēc atkārtotas pieteikšanās un savienojuma atjaunošanas tiek sinhronizētas bez datu zuduma.**
5. **Ja šifrēšana nav pilnībā ieviesta, nepieņemt drošības prasību par izpildītu:** līdz tās ieviešanai izrakstoties dzēst lokālos datus un skaidri dokumentēt offline ierobežojumu.

## Fāze 6 — Izvietošana un ekspluatācija

1. **Izvietošana:** aprūpes lietni izvietot **Google Apps Script HTML saskarnē, izmantojot HtmlService**. GitHub Pages saglabāt kā **publisku sākumlapu** (saite uz lietni). Google Sheets paliek **privāta**, un klientu datiem var piekļūt **tikai GAS servera funkcijas pēc veiksmīgas autorizācijas**.
2. **Visām datu funkcijām jābūt aizsargātām serverī.** Publiska GAS adrese pati par sevi nedrīkst dot iespēju nolasīt vai mainīt klientu datus.
3. **Ievietot Script Properties** (parole, HMAC atslēga) — procedūra ar ekrānuzņēmumiem, 5 soļi, latviešu valodā.
4. **Paroles maiņas procedūra:** maiņa Script Properties → visas sesijas nederīgas → lietotāji pieteikas no jauna. Paroli maina tikai administrators.
5. **Konfigurācijas kontrole:** pēc katra izvietojuma pārbaudīt, ka `config.js` GAS_URL un servera skripta SHEET_ID sakrīt (šeit ir bijis nesakritība).
6. **Rollback:** ja jaunā versija bojā darbu — atgriezties pie saglabātās versijas un pārbaudīt, ka dati nav bojāti.

## Fāze 7 — Testēšana (obligāti, pēc ieviešanas)

**Tieši GAS adreses pārbaude (curl/Postman vai konsoles izsaukumi), ne tikai lietotāja saskarna:**
1. Datu funkcijas izsaukums bez sesijas ID → noraidīts, datu neviens nav redzams.
2. Datu funkcijas izsaukums ar pagadītu vai viltotu sesijas ID (mainīts darbinieka ID/loma) → noraidīts.
3. Datu funkcijas izsaukums pēc darbinieka deaktivizēšanas vai paroles maiņas → noraidīts.
4. `mark`/`updateTask` ar klienta nosūtītu svešu darbinieka identitāti → serveris lieto sesijas identitāti, ne klienta vērtību.
5. `createClient` ar aprūpētāja sesiju → noraidīts (lomas pārbaude).
6. `load` atbilde nesatur PIN, `pin_salt`, `pin_hash` un pārējos slepenos laukus.
7. `login` ar nepareizu paroli/PIN → vienota kļūdas ziņa, nav sesijas; 5 reizes → slēgums; slēguma laikā pat pareizā parole → noraidīta.
8. `dump_raw` / `repair_*` bez admin sesijas → noraidīti vai nav izvietoti.
9. **Neautorizēts pieprasījums ar zināmu GAS adresi un publisko kodu** → nekādi dati neizdodas (pieņemšanas kritērija pārbaude).
10. Offline: bez pieteikšanās nav iespējams atgūt lokālos datus (šifrēti; darba rīku pārbaude parāda tikai šifrētu tekstu; restart pēc izrakstīšanās — dati neatgūstami).
11. Offline izmaiņas pēc atkārtotas pieteikšanās un savienojuma atjaunošanas sinhronizējas bez datu zuduma.
12. Slēgšanas pārbaude: vienlaicīgi neveiksmīgi mēģinājumi (paralēli pieprasījumi) — skaitītājs nekļūst mazāks nekā reālie mēģinājumi (`LockService` darbojas, fail-closed).
13. **Pārbaude sešās ierīcēs:** katrā ierīcē darbiniekam jāspēj atvērt sistēmu, ievadīt kopīgo paroli, izvēlēties savu vārdu, ievadīt PIN un strādāt kā līdz šim. Pārbaudīt **latviešu, krievu un angļu valodu, visas trīs lomas, maiņas, atzīmes un offline sinhronizāciju**. Darbiniekam nav jāzina ID vai jāveic tehniskas darbības.

## Ierobežojumi un kompromisi (jādokumentē)

- Vienots Google konts = nav personisku žurnālu (kurš no diviem aprūpētājiem) — daļēji mazina `operation_registry` ar servera identitāti.
- `google.script.run` izsaukumi ir POST, tāpēc parole/PIN/sesijas ID neparādās URL, vēsturē vai žurnālos.
- Kopīgā parole ir kopēja 6 ierīcēm — tā ir "ierīces atvērēja"; individuālā aizsardzība ir saldinātais PIN (6+ cipari, slēgšana pēc neveiksmīgiem mēģinājumiem).
- GAS bezmaksas kvotas (izpildes laiks, diennakts zvani, `google.script.run` ierobežojumi) — slodze ar 6 ierīcēm un mērenu klientu skaitu jānovēro prototipā.
- Offline režīms: līdz šifrēšanas ieviešanai — izrakstoties dzēst lokālos datus.
- Google konta parole + iespējama 2FA ir vēl vārteja — ieslēdzama Google līmenī.

## Pieņemšanas kontrolsaraksts

- [x] Lietotne atveras GAS HTML saskarnē (HtmlService); GitHub Pages paliek sākumlapa.
- [ ] Transporta prototips izpildīts un dokumentēts visās sešās ierīcēs.
- [x] SHEET_ID vienots abās vietās.
- [x] Pieteikšanās: kopīgā parole → darbinieka vārds → PIN; ID darbiniekam nevajadzīgs.
- [x] PIN un kopīgo paroli pārbauda tikai serveris; klienta pārbaude noņemta.
- [x] PIN glabājas kā sāls + jaucējvērtība; atklātais PIN noņemts no lapas un atbildēm.
- [x] Neautorizēts tiešs pieprasījums nevar nolasīt vai mainīt klientu datus.
- [x] Visas datu funkcijas pārbauda sesiju un lomu; identitāte no sesijas, ne no klienta parametra.
- [x] Sesijas atcelšana darbojas pēc paroles maiņas un darbinieka deaktivizēšanas (bez kešatmiņas apiešanas).
- [x] Slēgums pēc neveiksmīgiem mēģinājumiem (pastāvīgais skaitītājs + CacheService + LockService, fail-closed).
- [x] Debug darbības noņemtas vai admin-aizsargātas.
- [x] Offline dati šifrēti visā plūsmā; bez autorizācijas tos nevar atgūt (vai dzēsti izrakstoties + dokumentēts ierobežojums).
- [ ] Sešās ierīcēs pārbaudīta visa ikdienas darba plūsma (valodas, lomas, maiņas, atzīmes, offline sinhronizācija).
- [ ] Visi Fāzes 7 testi izpildīti un dokumentēti ar rezultātiem.
- [ ] Pieņemšanas kritērijs pierādīts ar tiešiem pieprasījumiem.
