# Aprūpes sistēma — ekrānuzņēmumi

Šie ekrānuzņēmumi ir ģenerēti automātiski ar `docs/screenshots.js`.
Tostuļojiet tos kopā ar aprakstiem, lai izveidotu aprūpētāju instrukcijas.

## Sanākumā

| # | Ekrānuzņēmums | Apraksts |
|---|---------------|----------|
| 1 | ![01_splash.png](screenshots/01_splash.png) | Sākumlapa ar logotipu (spalšs ekrāns) |
| 2 | ![02_login_employee_list.png](screenshots/02_login_employee_list.png) | Pieteikšanās ekrāns — darbinieku saraksts ar lomu filtru |
| 3 | ![03_login_filter_caregivers.png](screenshots/03_login_filter_caregivers.png) | Darbinieku filtrēšana pēc lomas — tikai aprūpētāji |
| 4 | ![04_login_select_pin.png](screenshots/04_login_select_pin.png) | Darbinieks izvēlēts — ievadiet PIN kodu (4–6 cifri) |
| 5 | ![05_login_pin_entered.png](screenshots/05_login_pin_entered.png) | PIN kods ievadīts — spiediet "Ienākt" |
| 6 | ![06_caregiver_clients.png](screenshots/06_caregiver_clients.png) | Aprūpētāja sākumlapa — klientu saraksts ar statusa indikatoriem |
| 7 | ![07_care_form_overview.png](screenshots/07_care_form_overview.png) | Klienta aprūpes forma — kategoriju rīkjons, kas ir jāaizpilda |
| 8 | ![08_category_hygiene.png](screenshots/08_category_hygiene.png) | Higiēna — pārslēgļi (X = izdarīts) |
| 9 | ![09_category_meals.png](screenshots/09_category_meals.png) | Ēdīšana — ēdienrežu režīsti (X=pilna, ½=puse, A=atteikšanās) |
| 10 | ![10_category_fluids.png](screenshots/10_category_fluids.png) | Šķidrumi — urīns un patērētais ūdens (ml), kopsavilkums zemājā daļā |
| 11 | ![11_category_physiology.png](screenshots/11_category_physiology.png) | Vēdera izeja — izvēlieties stāvokli (N/A/S/C/K) un saglabājiet |
| 12 | ![12_category_temperature.png](screenshots/12_category_temperature.png) | Temperatūra — ievadiet skaitli °C (37°C+ dzidina sarkanā) |
| 13 | ![13_category_activity.png](screenshots/13_category_activity.png) | Aktivitāte — kustība ar palīdzību (pārslēgļi X) |
| 14 | ![14_category_other.png](screenshots/14_category_other.png) | Pārējās darbības — ādas kopšana, pastaiga, ciemiņi, autiņbiksu maiņa (+1) |
| 15 | ![15_signature_card.png](screenshots/15_signature_card.png) | Paraksts — aktīvā maiņa nav parakstīta, poga ir aktīva |
| 16 | ![16_client_already_signed.png](screenshots/16_client_already_signed.png) | Paraksts ir bloķēts — kāds cits jau ir parakstījis šo maiņu |

## Darbību plūsmas pāreja

1. **Pieteikšanās** — atlasiet darbinieku no saraksta un ievadiet PIN kodu.
2. **Aprūpētāja sākumlapa** — atlasiet klientu, spiediet "Atvērt".
3. **Aprūpes forma** — katru dienu aizpildiet kategorijas (temperatūra, higiēna, ēdīšana, šķidrumi, fizioloģija, citi).
4. **Paraksts** — nospiediet "Maiņu nododu/pieņemu", kad visi ieraksti ir veikti.
5. Ja kāds cits jau ir parakstījis, poga tiek bloķēta — katram klientam vienā maiņā ir tikai viens paraksts.

