const ExcelJS = require('exceljs');
const path = require('path');

const VARDS_M = ['Janis','Peteris','Andris','Martins','Kristaps','Edgars','Karlis','Aleksandrs','Viktors','Igors','Sergejs','Dmitrijs','Oleg','Vladislavs','Arturs','Roberts','Raimonds','Guntars','Aivars','Maris'];
const VARDS_F = ['Anna','Marija','Kristine','Inese','Dace','Liene','Santa','Ieva','Elina','Marta','Zane','Liga','Sarmite','Ruta','Aija','Baiba','Ilze','Sandra','Vita','Gita'];
const UZVARDI = ['Berzins','Kalnins','Ozolins','Liepins','Krumins','Balodis','Eglitis','Zarins','Celmins','Vanags','Ozols','Briedis','Lucis','Titers','Kaza','Kulis','Vitols','Strazdins','Prieditis','Saulitis','Zelts','Rozitis','Lapins','Upitis','Abele','Karklins','Kiselis','Murnieks','Talberga','Ziemelis'];
const DIETAS = ['Nav noteikta dieta','VEGETARA UN VEGANISKA DIETA','BEZLAKTOZES DIETA','PALEO DIETA','DIABETA DIETA','MAKSLIGA UZTURESANA','KETO DIETA','GLITENA BRIVA DIETA'];
const SASKARSMES = ['Nav saskarsmes ipatnibas','Demence','Vajredziga','Ausimtrukums','Kustibu ierobezojumi','Atminas traucejumi','Depresija','Psihiskie traucejumi','Autisms','Cita'];

const KLIENTI_SKAITS = 500;
const DARBINIEKI_SKAITS = 10;
const DIENAS_SKAITS = 30;

const SHIFTS = ['R', 'V'];
const KATEGORIJAS = {
  temp:           { fields: ['temperatura'],                              vals: () => (36.0 + Math.random() * 3.5).toFixed(1) },
  slimnica:       { fields: ['statuss'],                                    vals: () => ['atgriezies SAC','hospitalizets slimnica','SAC'][Math.floor(Math.random()*3)] },
  higiena:        { fields: ['vana_dns','mutes_dobuma_kopsana','daleja_apmazgasana'], vals: () => 'X' },
  edinasana:      { fields: ['brokastis','pusdienas','vakarienas'],         vals: () => ['A','½','X'][Math.floor(Math.random()*3)] },
  fiziologija:    { fields: ['vedera_izeja'],                               vals: () => ['N','D','K'][Math.floor(Math.random()*3)] },
  sikdrumi:       { fields: ['uznemts_ml','urina_daudzums'],                 vals: () => String(100 + Math.floor(Math.random()*400)) },
  citsi_pasakomi: { fields: ['adas_kopsana','autins_biksitu_skaits','pastaigas'], vals: () => Math.random() > 0.5 ? 'X' : String(Math.floor(Math.random()*3)) },
  aktivitate:     { fields: ['stav_ar_palidziigu','parvietojas_ar_palidzlekli'], vals: () => 'X' },
  paraksts:       { fields: ['aprupetaja_paraksts'],                        vals: () => UZVARDI[Math.floor(Math.random()*UZVARDI.length)] }
};

let idCounter = 0;
function genId(prefix) {
  idCounter++;
  return prefix + '_' + (Date.now() - idCounter * 1000).toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

function fmtDate(d) { return d.toISOString().split('T')[0]; }
function fmtDT(d) { return d.toISOString().replace('T', ' ').substring(0, 19); }
function fmtTime(d) { return d.toTimeString().substring(0, 5); }
function pad(n, w) { return String(n).padStart(w, '0'); }

async function main() {
  console.log('Generēju testa datus...');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aprūpes sistēma - Test Data Generator';
  wb.created = new Date();

  // ===== DARBINIEKI =====
  const wsEmp = wb.addWorksheet('darbinieki');
  wsEmp.columns = [
    { header: 'id', key: 'id', width: 30 },
    { header: 'vards', key: 'vards', width: 14 },
    { header: 'uzvards', key: 'uzvards', width: 16 },
    { header: 'loma', key: 'loma', width: 16 },
    { header: 'pin_kods', key: 'pin_kods', width: 12 },
    { header: 'aktivs', key: 'aktivs', width: 10 },
    { header: 'maina_tips', key: 'maina_tips', width: 14 }
  ];
  wsEmp.getRow(1).font = { bold: true };

  const darbinieki = [];
  const rolePlan = [
    ...Array(6).fill({ role: 'aprupetajs',   shift: 'diennakts' }),
    ...Array(2).fill({ role: 'aprupetajs',   shift: 'diena' }),
    { role: 'kontroliere',   shift: 'diena' },
    { role: 'administrators', shift: 'diena' }
  ];
  rolePlan.forEach((cfg, i) => {
    const male = Math.random() > 0.5;
    const vards = (male ? VARDS_M : VARDS_F)[Math.floor(Math.random() * (male ? 20 : 20))];
    const uzvards = UZVARDI[Math.floor(Math.random() * UZVARDI.length)];
    const pin = String(100000 + Math.floor(Math.random() * 900000));
    const emp = {
      id: 'e_' + (1789840000000 + i * 1000000),
      vards, uzvards, loma: cfg.role,
      pin_kods: pin, aktivs: 'TRUE', maina_tips: cfg.shift
    };
    darbinieki.push(emp);
    wsEmp.addRow(emp);
  });
  const aprupetaji = darbinieki.filter(d => d.loma === 'aprupetajs');
  const diennakts = aprupetaji.filter(d => d.maina_tips === 'diennakts');
  console.log('Darbinieki:', darbinieki.length, '| diennakts aprupetaji:', diennakts.length);

  // ===== KLIENTI =====
  const wsCli = wb.addWorksheet('klienti');
  wsCli.columns = [
    { header: 'ID', key: 'ID', width: 30 },
    { header: 'Vārds', key: 'Vards', width: 14 },
    { header: 'Uzvārds', key: 'Uzvards', width: 16 },
    { header: 'Dzimšanas datums', key: 'Dzimsanas', width: 16 },
    { header: 'Diēta', key: 'Dieta', width: 32 },
    { header: 'Saskarsmes īpatnības', key: 'Saskarsmes', width: 26 },
    { header: 'Aktīvs', key: 'Aktivs', width: 10 },
    { header: 'slimnica', key: 'slimnica', width: 10 },
    { header: 'statuss klienti', key: 'statuss_kl', width: 14 },
    { header: 'statuss', key: 'statuss', width: 10 },
    { header: 'statusa_laiks', key: 'statusa_laiks', width: 22 },
    { header: 'statusa_darbinieks_id', key: 'statusa_darb', width: 26 }
  ];
  wsCli.getRow(1).font = { bold: true };

  const klienti = [];
  const now = new Date();
  for (let i = 0; i < KLIENTI_SKAITS; i++) {
    const male = Math.random() > 0.5;
    const vards = (male ? VARDS_M : VARDS_F)[Math.floor(Math.random() * 20)];
    const uzvards = UZVARDI[Math.floor(Math.random() * UZVARDI.length)];
    const by = 1920 + Math.floor(Math.random() * 55);
    const bm = 1 + Math.floor(Math.random() * 12);
    const bd = 1 + Math.floor(Math.random() * 28);
    const dzimis = by + '-' + pad(bm, 2) + '-' + pad(bd, 2);
    const dieta = DIETAS[Math.floor(Math.random() * DIETAS.length)];
    const saskarsmes = SASKARSMES[Math.floor(Math.random() * SASKARSMES.length)];
    // Vienam klientam piesaistits VIENS galvenais diennakts aprupetajs (bez konflikta)
    const galvais = diennakts[i % diennakts.length];

    const kl = {
      ID: 'c_' + (1789841000000 + i * 10000),
      Vards: vards, Uzvards: uzvards, Dzimsanas: dzimis,
      Dieta: dieta, Saskarsmes: saskarsmes, Aktivs: 'TRUE',
      slimnica: 'FALSE', statuss_kl: '', statuss: 'SAC',
      statusa_laiks: fmtDT(now), statusa_darb: galvais.id
    };
    kl._galvais = galvais.id;
    klienti.push(kl);
    wsCli.addRow(kl);
  }
  console.log('Klienti:', klienti.length);

  // ===== ATZIMES =====
  const wsMark = wb.addWorksheet('atzimes');
  wsMark.columns = [
    { header: 'ID', key: 'ID', width: 30 },
    { header: 'Klients ID', key: 'KlientsID', width: 30 },
    { header: 'Darbinieks ID', key: 'DarbinieksID', width: 30 },
    { header: 'Datums', key: 'Datums', width: 12 },
    { header: 'Laiks', key: 'Laiks', width: 10 },
    { header: 'Periods', key: 'Periods', width: 10 },
    { header: 'Kategorija', key: 'Kategorija', width: 16 },
    { header: 'Lauka nosaukums', key: 'Lauka', width: 24 },
    { header: 'Vērtība', key: 'Vertiba', width: 20 },
    { header: 'Pēdējā vērtība', key: 'PedejaV', width: 16 },
    { header: 'Darbinieks pēdējais', key: 'DarbPedejais', width: 30 },
    { header: 'Pēdējais laiks', key: 'PedejaisLaiks', width: 22 },
    { header: 'action_id', key: 'action_id', width: 52 },
    { header: 'maina_tips', key: 'maina_tips', width: 14 },
    { header: 'notikuma_laiks', key: 'notikuma_laiks', width: 22 }
  ];
  wsMark.getRow(1).font = { bold: true };

  // ===== ATZIMES_LOG =====
  const wsLog = wb.addWorksheet('atzimes_log');
  wsLog.columns = [
    { header: 'id', key: 'id', width: 30 },
    { header: 'atzimes_id', key: 'atzimes_id', width: 30 },
    { header: 'klients_id', key: 'klients_id', width: 30 },
    { header: 'darbinieks_id', key: 'darbinieks_id', width: 30 },
    { header: 'datums', key: 'datums', width: 12 },
    { header: 'laiks', key: 'laiks', width: 10 },
    { header: 'periods', key: 'periods', width: 10 },
    { header: 'kategorija', key: 'kategorija', width: 16 },
    { header: 'lauka_nosaukums', key: 'lauka_nosaukums', width: 24 },
    { header: 'vertiba', key: 'vertiba', width: 20 },
    { header: 'skaits', key: 'skaits', width: 22 },
    { header: 'pedeja_vertiba', key: 'pedeja_vertiba', width: 16 },
    { header: 'pedeja_laiks', key: 'pedeja_laiks', width: 22 },
    { header: 'darbinieks_pedejais', key: 'darbinieks_pedejais', width: 30 },
    { header: 'action_id', key: 'action_id', width: 52 },
    { header: 'maina_tips', key: 'maina_tips', width: 14 },
    { header: 'notikuma_laiks', key: 'notikuma_laiks', width: 22 }
  ];
  wsLog.getRow(1).font = { bold: true };

  // ===== UZDEVOMI =====
  const wsTask = wb.addWorksheet('uzdevomi');
  wsTask.columns = [
    { header: 'id', key: 'id', width: 30 },
    { header: 'teksts', key: 'teksts', width: 40 },
    { header: 'klients_id', key: 'klients_id', width: 30 },
    { header: 'pieskirt_darbiniekam_id', key: 'pieskirt', width: 30 },
    { header: 'termins', key: 'termins', width: 12 },
    { header: 'prioritate', key: 'prioritate', width: 12 },
    { header: 'statuss', key: 'statuss', width: 12 },
    { header: 'ir_pabeigts', key: 'ir_pabeigts', width: 12 },
    { header: 'izveidots', key: 'izveidots', width: 22 },
    { header: 'izveidotajs_id', key: 'izveidotajs_id', width: 30 },
    { header: 'pabeigts_laiks', key: 'pabeigts_laiks', width: 22 },
    { header: 'pabeigtajs_id', key: 'pabeigtajs_id', width: 30 }
  ];
  wsTask.getRow(1).font = { bold: true };

  // ===== GENERE ATSZIMES UN LOGUS =====
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - DIENAS_SKAITS + 1);

  let markCount = 0, logCount = 0;
  for (let d = 0; d < DIENAS_SKAITS; d++) {
    const day = new Date(startDate);
    day.setDate(startDate.getDate() + d);
    const dateStr = fmtDate(day);

    for (const kl of klienti) {
      const emp = darbinieki.find(x => x.id === kl._galvais);
      for (const shift of SHIFTS) {
        const cats = Object.keys(KATEGORIJAS).sort(() => Math.random() - 0.5);
        const n = 3 + Math.floor(Math.random() * 3);
        for (const cat of cats.slice(0, n)) {
          const cfg = KATEGORIJAS[cat];
          for (const field of cfg.fields) {
            const val = cfg.vals();
            const dt = new Date(day);
            dt.setHours(shift === 'R' ? 6 + Math.floor(Math.random() * 4) : 18 + Math.floor(Math.random() * 4), Math.floor(Math.random() * 60), 0, 0);
            const iso = dt.toISOString();
            const tstr = fmtTime(dt);
            const actionId = 'mark_' + kl.ID + '_' + shift + '_' + cat + '_' + field + '_' + dateStr + '_' + emp.id;
            const markId = 'm_' + (1790000000000 + markCount * 1000);

            wsMark.addRow({
              ID: markId, KlientsID: kl.ID, DarbinieksID: emp.id,
              Datums: dateStr, Laiks: tstr, Periods: shift,
              Kategorija: cat, Lauka: field, Vertiba: val,
              PedejaV: '', DarbPedejais: emp.id, PedejaLaiks: iso,
              action_id: actionId, maina_tips: emp.maina_tips, notikuma_laiks: iso
            });
            markCount++;

            wsLog.addRow({
              id: 'l_' + (1795000000000 + logCount * 1000),
              atzimes_id: markId, klients_id: kl.ID, darbinieks_id: emp.id,
              datums: dateStr, laiks: tstr, periods: shift,
              kategorija: cat, lauka_nosaukums: field, vertiba: val,
              skaits: iso, pedeja_vertiba: '', pedeja_laiks: iso,
              darbinieks_pedejais: emp.id, action_id: actionId,
              maina_tips: emp.maina_tips, notikuma_laiks: iso
            });
            logCount++;
          }
        }
      }
    }
    if ((d + 1) % 5 === 0) console.log('  diena ' + (d + 1) + '/' + DIENAS_SKAITS + ' -> atzimes: ' + markCount + ', logi: ' + logCount);
  }

  // ===== UZDEVOMI =====
  const TEXTI = ['Parbaudit cukuru','Nomainit apdares','Aizvest pie arsta','Atzimet receptes','Sazinaties ar gimeni','Parbaudit asinsspiedienu','Nomainit kateteru','Veikt rietumu merijumus','Parbaudit medikamentus','Izveidot aprupes planu'];
  let taskCount = 0;
  for (let i = 0; i < klienti.length * 2; i++) {
    const kl = klienti[Math.floor(Math.random() * klienti.length)];
    const emp = darbinieki.find(x => x.id === kl._galvais);
    const dd = new Date(now); dd.setDate(now.getDate() + Math.floor(Math.random() * 30));
    const done = Math.random() > 0.65;
    wsTask.addRow({
      id: 't_' + (1799000000000 + taskCount * 1000),
      teksts: TEXTI[Math.floor(Math.random() * TEXTI.length)],
      klients_id: kl.ID, pieskirt: emp.id,
      termins: fmtDate(dd),
      prioritate: ['zema','videja','augsta'][Math.floor(Math.random() * 3)],
      statuss: done ? 'pabeigts' : ['jauns','procesā'][Math.floor(Math.random() * 2)],
      ir_pabeigts: done ? 'TRUE' : 'FALSE',
      izveidots: fmtDT(new Date(Date.now() - Math.random() * 7 * 86400000)),
      izveidotajs_id: emp.id,
      pabeigts_laiks: done ? fmtDT(new Date()) : '',
      pabeigtajs_id: done ? emp.id : ''
    });
    taskCount++;
  }

  // Freeze headers + autofilter
  [wsEmp, wsCli, wsMark, wsLog, wsTask].forEach(ws => {
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columnCount } };
  });

  const outPath = path.join(__dirname, 'Testa_Dati_' + KLIENTI_SKAITS + '_klienti_' + DIENAS_SKAITS + '_dienas.xlsx');
  await wb.xlsx.writeFile(outPath);

  console.log('');
  console.log('========================================');
  console.log('  FAILS IZGENERETS');
  console.log('========================================');
  console.log('  darbinieki:   ' + darbinieki.length);
  console.log('  klienti:      ' + klienti.length);
  console.log('  atzimes:      ' + markCount);
  console.log('  atzimes_log:  ' + logCount);
  console.log('  uzdevomi:     ' + taskCount);
  console.log('========================================');
  console.log('  Fails: ' + outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
