# Šūnu kartējums (RANGE) — `Aprūpes lapas.xlsx` + datu ievade

## 📂 Fails: `Aprūpes lapas.xlsx`

Failā ir **2 lapas ar atšķirīgu rindu izkārtojumu** (katra lapa sākas no jauna):

---

## 📄 Lapa 1: `APRŪPES DOKUMANTĀCIJA_1` (dienas 1–15)

| Rinda | Kolonna A / B (virsraksts)              | Datu lauks                  | Datu tips           |
|-------|-----------------------------------------|------------------------------|---------------------|
| 1     | A1 — `VISPĀRĒJĀS APRŪPES DOKUMENTĀCIJA` | —                            | virsraksts          |
| 3     | A3 — Klienta vārds, uzvārds, vecums    | —                            | aizpilda rokasgr.   |
| 5     | A5 — Saskarsmes īpatnības, N5 — Diēta  | —                            | aizpilda rokasgr.   |
| 6     | A6 — Atzīmēšanas kritēriji              | —                            | virsraksts          |
| 7     | J7 — `Mēnesis`                          | —                            | virsraksts          |
| **8** | A8 — `Datums`                           | dienas numurs (1, 2, 3…)     | skaitlis            |
| **9** | C9..AF9 — `R`/`V` (katrai dienai)       | Rīts / Vakars virsraksts     | burts `R` vai `V`   |
| **10**| A10 — `Temperatūra`                     | rīts/vakars temperatūra      | skaitlis vai `N`    |
| 11    | A11 — `Higiēna`, B11 — Mutes dobums     | mutes dobuma kopšana         | `X` / `P` / `A`     |
| 12    | B12 — Vanna, duša                       | vanna/duša                   | `X` / `P` / `A`     |
| 13    | B13 — Daļēja apmazgāšana                | daļēja apmazgāšana           | `X` / `P` / `A`     |
| 14    | B14 — Veļas maiņa                      | veļas maiņa                  | `X` / `P` / `A`     |
| 15    | B15 — Nagu kopšana                      | nagu kopšana                 | `X` / `P` / `A`     |
| 16    | B16 — Matu kopšana                      | matu kopšana                 | `X` / `P` / `A`     |
| 17    | B17 — Bārdas skūšana                    | bārdas skūšana               | `X` / `P` / `A`     |
| 18    | A18 — `Aktivitātes`, B18 — Pārvietojas   | pārvietojas ar palīglīdzekli | `X` / `P` / `A`     |
| 19    | B19 — Stāv ar palīdzību                 | stāv ar palīdzību            | `X` / `P` / `A`     |
| 20    | B20 — Sēž ar palīdzību                  | sēž ar palīdzību             | `X` / `P` / `A`     |
| 21    | A21 — `* Ēšana`, B21 — Brokastis        | brokastis                    | `X` / `½` / `A`     |
| 22    | B22 — Pusdienas                         | pusdienas                    | `X` / `½` / `A`     |
| 23    | B23 — Launags                           | launags                      | `X` / `½` / `A`     |
| 24    | B24 — Vakariņas                        | vakariņas                    | `X` / `½` / `A`     |
| 25    | A25 — `Šķidrumi`, B25 — Urīna daudzums   | diennakts urīna daudzums (ml)| skaitlis            |
| 26    | B26 — Uzņemts H2O                       | uzņemts H2O 24h (ml)         | skaitlis            |
| 27    | A27 — Ādas kopšanas līdzekļi            | ādas kopšana                 | `X` / `P` / `A` / teksts |
| 28    | A28 — `* Vēdera izeja`                  | vēdera izeja                 | `N` / `A` / `S` / `C` / `K` |
| 29    | A29 — Pastaigas svaigā gaisā            | pastaigas                    | `X` / `P` / `A` / teksts |
| 30    | A30 — Ciemiņi                           | ciemiņi                      | `X` / `Jā` / `Nē` / teksts |
| 31    | A31 — Autiņbiksīšu maiņa                | autiņbiksīšu skaits          | skaitlis            |
| **32**| A32 — `Aprūpētāju paraksts`             | paraksts (diennakts)         | vārds / `X`         |

### Kolonnas 1. lapā (dienas 1–15)

| Diena | Rīts kolonna | Vakars kolonna |
|-------|--------------|----------------|
| 1     | C            | D              |
| 2     | E            | F              |
| 3     | G            | H              |
| 4     | I            | J              |
| 5     | K            | L              |
| 6     | M            | N              |
| 7     | O            | P              |
| 8     | Q            | R              |
| 9     | S            | T              |
| 10    | U            | V              |
| 11    | W            | X              |
| 12    | Y            | Z              |
| 13    | AA           | AB             |
| 14    | AC           | AD             |
| 15    | AE           | AF             |

---

## 📄 Lapa 2: `APRŪPES DOKUMANTĀCIJA_2` (dienas 16–31)

| Rinda | Kolonna A / B (virsraksts)              | Datu lauks                  | Datu tips           |
|-------|-----------------------------------------|------------------------------|---------------------|
| 1     | A1 — Atzīmēšanas kritēriji              | —                            | virsraksts          |
| **2** | A2 — `Datums`                           | dienas numurs (16, 17, …)    | skaitlis            |
| **3** | C3..AH3 — `R`/`V` (katrai dienai)       | Rīts / Vakars virsraksts     | burts `R` vai `V`   |
| **4** | A4 — `Temperatūra`                     | rīts/vakars temperatūra      | skaitlis vai `N`    |
| 5     | A5 — `Higiēna`, B5 — Mutes dobums       | mutes dobuma kopšana         | `X` / `P` / `A`     |
| 6     | B6 — Vanna, duša                        | vanna/duša                   | `X` / `P` / `A`     |
| 7     | B7 — Daļēja apmazgāšana                 | daļēja apmazgāšana           | `X` / `P` / `A`     |
| 8     | B8 — Veļas maiņa                       | veļas maiņa                  | `X` / `P` / `A`     |
| 9     | B9 — Nagu kopšana                       | nagu kopšana                 | `X` / `P` / `A`     |
| 10    | B10 — Matu kopšana                      | matu kopšana                 | `X` / `P` / `A`     |
| 11    | B11 — Bārdas skūšana                    | bārdas skūšana               | `X` / `P` / `A`     |
| 12    | A12 — `Aktivitātes`, B12 — Pārvietojas   | pārvietojas ar palīglīdzekli | `X` / `P` / `A`     |
| 13    | B13 — Stāv ar palīdzību                 | stāv ar palīdzību            | `X` / `P` / `A`     |
| 14    | B14 — Sēž ar palīdzību                  | sēž ar palīdzību             | `X` / `P` / `A`     |
| 15    | A15 — `* Ēšana`, B15 — Brokastis        | brokastis                    | `X` / `½` / `A`     |
| 16    | B16 — Pusdienas                         | pusdienas                    | `X` / `½` / `A`     |
| 17    | B17 — Launags                           | launags                      | `X` / `½` / `A`     |
| 18    | B18 — Vakariņas                        | vakariņas                    | `X` / `½` / `A`     |
| 19    | A19 — `Šķidrumi`, B19 — Urīna daudzums   | diennakts urīna daudzums (ml)| skaitlis            |
| 20    | B20 — Uzņemts H2O                       | uzņemts H2O 24h (ml)         | skaitlis            |
| 21    | A21 — Ādas kopšanas līdzekļi            | ādas kopšana                 | `X` / `P` / `A` / teksts |
| 22    | A22 — `* Vēdera izeja`                  | vēdera izeja                 | `N` / `A` / `S` / `C` / `K` |
| 23    | A23 — Pastaigas svaigā gaisā            | pastaigas                    | `X` / `P` / `A` / teksts |
| 24    | A24 — Ciemiņi                           | ciemiņi                      | `X` / `Jā` / `Nē` / teksts |
| 25    | A25 — Autiņbiksīšu maiņa                | autiņbiksīšu skaits          | skaitlis            |
| **26**| A26 — `Aprūpētāju paraksts`             | paraksts (diennakts)         | vārds / `X`         |

### Kolonnas 2. lapā (dienas 16–31)

| Diena | Rīts kolonna | Vakars kolonna |
|-------|--------------|----------------|
| 16    | C            | D              |
| 17    | E            | F              |
| 18    | G            | H              |
| 19    | I            | J              |
| 20    | K            | L              |
| 21    | M            | N              |
| 22    | O            | P              |
| 23    | Q            | R              |
| 24    | S            | T              |
| 25    | U            | V              |
| 26    | W            | X              |
| 27    | Y            | Z              |
| 28    | AA           | AB             |
| 29    | AC           | AD             |
| 30    | AE           | AF             |
| 31    | AG           | AH             |

---

## 🔄 Kā `js/excel_export.js` saprot šo?

`excel_export.js` izmanto `Aprūpes lapas.xlsx` tieši tādu, kāds tas ir, un aizpilda vērtības pa vienai šūnai, **NEaiztiekot nevienu citu vietu**:

- **1. lapa** (`APRŪPES DOKUMANTĀCIJA_1`): dienas 1–15, datu rindas `R8` līdz `R32`
- **2. lapa** (`APRŪPES DOKUMANTĀCIJA_2`): dienas 16–31, datu rindas `R2` līdz `R26`

Rindu kartējums (`getFieldMap`):

| Lauka nosaukums (kategorija.lauks)        | 1. lapa rinda | 2. lapa rinda |
|-------------------------------------------|---------------|---------------|
| `temp.temperatura`                        | 10            | 4             |
| `higiena.mutes_dobuma_kopsana`            | 11            | 5             |
| `higiena.vana_dns`                        | 12            | 6             |
| `higiena.daleja_apmazgasana`              | 13            | 7             |
| `higiena.velas_maina`                     | 14            | 8             |
| `higiena.nagu_kopsana`                    | 15            | 9             |
| `higiena.matu_kopsana`                    | 16            | 10            |
| `higiena.bardas_skushana`                 | 17            | 11            |
| `aktivitate.parvietojas_ar_palidzlekli`   | 18            | 12            |
| `aktivitate.stav_ar_palidziigu`           | 19            | 13            |
| `aktivitate.sedz_ar_palidziigu`           | 20            | 14            |
| `edinasana.brokastis`                     | 21            | 15            |
| `edinasana.pusdienas`                     | 22            | 16            |
| `edinasana.launags`                       | 23            | 17            |
| `edinasana.vakariņi` (vakariņas)         | 24            | 18            |
| `sikdrumi.urina_daudzums`                 | 25            | 19            |
| `sikdrumi.uznemts_ml`                     | 26            | 20            |
| `citsi_pasakomi.adas_kopsana`             | 27            | 21            |
| `fiziologija.vedera_izeja`                | 28            | 22            |
| `citsi_pasakomi.pastaigas`                | 29            | 23            |
| `citsi_pasakomi.ciemini`                  | 30            | 24            |
| `citsi_pasakomi.autins_biksitu_skaits`    | 31            | 25            |
| `paraksts.aprupetaja_paraksts`            | 32            | 26            |

Datuma galvene (kas rāda dienas numuru) atrodas:
- 1. lapa: rinda `8` (piem. C8=1, E8=2, …, AE8=15)
- 2. lapa: rinda `2` (piem. C2=16, E2=17, …, AG2=31)

R/V virsraksts:
- 1. lapa: rinda `9` (C9=R, D9=V, E9=R, F9=V, …)
- 2. lapa: rinda `3` (C3=R, D3=V, …, AG3=R, AH3=V)

---

## ⚠️ SVARĪGI

1. **`Aprūpes lapas.xlsx` NEDRĪKST mainīt** — tā ir MK veidlapas struktūra (Ministru kabineta noteikumi).
2. **`excel_export.js` raksta TIKAI datu šūnās** (C, D, E, F, … kolonnas datu rindās 4–26 vai 10–32), nepārzīmējot virsrakstus, formatējumu vai citas šūnas.
3. **Paraksts** (`aprupetaja_paraksts`) tiek rakstīts **tikai R kolonnā** (1×dienā, nevis R + V), lai nodrošinātu vienu diennakts parakstu, ko pārraksta pēdējais darbinieks.
4. **Datuma kolonnas** (`Datums` rinda 8 1. lapā, rinda 2 2. lapā) satur tikai dienas numuru (1, 2, 3, …) — tās nav maināmas.
