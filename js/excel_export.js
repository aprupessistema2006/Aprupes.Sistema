class ExcelExporter {
  constructor() {
    this.templateUrl = 'Aprūpes lapas.xlsx';
  }

  async loadTemplateBuffer() {
    if (typeof require !== 'undefined' && typeof window === 'undefined') {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(__dirname || __filename);
      return fs.readFileSync(path.join(dir, this.templateUrl));
    }
    const response = await fetch(this.templateUrl);
    if (!response.ok) throw new Error('Neizdevās ielādēt MK veidni: ' + this.templateUrl);
    return await response.arrayBuffer();
  }

  getMarkDate(m) {
    const ts = String(m.id || '').match(/^[a-z]+_(\d+)/);
    if (ts) {
      const d = new Date(parseInt(ts[1], 10));
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + mo + '-' + day;
      }
    }
    if (m.date && /^\d{4}-\d{2}-\d{2}/.test(m.date)) return m.date;
    return null;
  }

  async generateMonth(client, year, month, marks) {
    if (typeof ExcelJS === 'undefined' && typeof require !== 'undefined') {
      globalThis.ExcelJS = require('exceljs');
    }
    if (typeof ExcelJS === 'undefined') {
      throw new Error('ExcelJS bibliotēka nav ielādēta');
    }

    const buffer = await this.loadTemplateBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    const daysInMonth = new Date(year, month, 0).getDate();

    const dataByDay = {};
    marks.forEach(m => {
      const dateStr = this.getMarkDate(m);
      if (!dateStr) return;
      const parts = dateStr.split('-');
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      if (d.getFullYear() === year && (d.getMonth() + 1) === month) {
        const day = d.getDate();
        if (!dataByDay[day]) dataByDay[day] = {};
        const shift = m.shift === 'D' ? 'D' : m.shift;
        const key = shift + '|' + m.category + '|' + m.field;
        if (dataByDay[day][key] === undefined) {
          dataByDay[day][key] = m.value;
        }
      }
    });

    if (wb.getWorksheet('APRŪPES DOKUMANTĀCIJA_1')) {
      this.fillSheet(wb.getWorksheet('APRŪPES DOKUMANTĀCIJA_1'), dataByDay, 1, 15, 10, 32);
      this.fillClientInfo(wb.getWorksheet('APRŪPES DOKUMANTĀCIJA_1'), client, year, month);
    }
    if (wb.getWorksheet('APRŪPES DOKUMANTĀCIJA_2')) {
      this.fillSheet(wb.getWorksheet('APRŪPES DOKUMANTĀCIJA_2'), dataByDay, 16, daysInMonth, 4, 26);
    }

    const fullName = (client.vards || client.Vārds || '') + ' ' + (client.uzvards || client.Uzvārds || '');
    const filename = `${fullName}_${year}_${String(month).padStart(2, '0')}.xlsx`;

    if (typeof window !== 'undefined') {
      const blob = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([blob]));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return filename;
    } else {
      const path = require('path');
      const dir = path.dirname(__dirname || __filename);
      const outPath = path.join(dir, 'test_output_' + filename);
      await wb.xlsx.writeFile(outPath);
      return outPath;
    }
  }

  fillClientInfo(ws, client, year, month) {
    const fullName = (client.vards || client.Vārds || '') + ' ' + (client.uzvards || client.Uzvārds || '');
    ws.getCell('C3').value = fullName.trim();

    if (client.dzimis) {
      const birth = (client.dzimis instanceof Date) ? client.dzimis : new Date(client.dzimis);
      const today = new Date(year, month - 1, 1);
      let age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
      ws.getCell('R3').value = age;
    }

    const dieta = client.dieta || client.Dieta || '';
    ws.getCell('R5').value = dieta || null;

    if (client.simbiozu || client.Simbiozu) {
      let s = client.simbiozu || client.Simbiozu;
      if (typeof s === 'string') {
        s = s.trim();
        ws.getCell('C5').value = s || null;
      }
    }

    const months = ['Januāris', 'Februāris', 'Marts', 'Aprīlis', 'Maijs', 'Jūnijs', 'Jūlijs', 'Augusts', 'Septembris', 'Oktobris', 'Novembris', 'Decembris'];
    ws.getCell('N7').value = months[(month - 1 + 12) % 12] || null;
  }

  fillSheet(ws, dataByDay, startDay, endDay, dataRowStart, dataRowEnd) {
    const fieldMap = {
      'temp|temperatura': dataRowStart,
      'higiena|mutes_dobuma_kopsana': dataRowStart + 1,
      'higiena|vana_dns': dataRowStart + 2,
      'higiena|daleja_apmazgasana': dataRowStart + 3,
      'higiena|velas_maina': dataRowStart + 4,
      'higiena|nagu_kopsana': dataRowStart + 5,
      'higiena|matu_kopsana': dataRowStart + 6,
      'higiena|bardas_skushana': dataRowStart + 7,
      'aktivitate|parvietojas_ar_palidzlekli': dataRowStart + 8,
      'aktivitate|stav_ar_palidziigu': dataRowStart + 9,
      'aktivitate|sedz_ar_palidziigu': dataRowStart + 10,
      'edinasana|brokastis': dataRowStart + 11,
      'edinasana|pusdienas': dataRowStart + 12,
      'edinasana|launags': dataRowStart + 13,
      'edinasana|vakariņi': dataRowStart + 14,
      'sikdrumi|urina_daudzums': dataRowStart + 15,
      'sikdrumi|uznemts_ml': dataRowStart + 16,
      'citsi_pasakomi|adas_kopsana': dataRowStart + 17,
      'fiziologija|vedera_izeja': dataRowStart + 18,
      'citsi_pasakomi|pastaigas': dataRowStart + 19,
      'citsi_pasakomi|ciemini': dataRowStart + 20,
      'citsi_pasakomi|autins_biksitu_skaits': dataRowStart + 21,
      'paraksts|aprupetaja_paraksts': dataRowEnd
    };

    const colLetter = (num) => {
      let s = '';
      num = num + 1;
      while (num > 0) {
        const r = (num - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        num = Math.floor((num - 1) / 26);
      }
      return s;
    };

    for (let day = startDay; day <= endDay; day++) {
      const dayData = dataByDay[day] || {};
      const dayOffset = day - startDay;
      const colR = 2 + dayOffset * 2;
      const colV = colR + 1;
      const addrR = colLetter(colR);
      const addrV = colLetter(colV);

      for (const key of Object.keys(fieldMap)) {
        const [category, field] = key.split('|');
        const row = fieldMap[key];
        const isSig = category === 'paraksts';
        const cR = ws.getCell(`${addrR}${row}`);
        const cV = ws.getCell(`${addrV}${row}`);

        if (isSig) {
          const valD = dayData['D|' + category + '|' + field];
          if (valD !== undefined && valD !== '') cR.value = valD;
        } else {
          const valR = dayData['R|' + category + '|' + field];
          const valV = dayData['V|' + category + '|' + field];
          if (valR !== undefined && valR !== '') cR.value = valR;
          if (valV !== undefined && valV !== '') cV.value = valV;
        }
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExcelExporter;
}
if (typeof globalThis !== 'undefined') {
  globalThis.ExcelExporter = ExcelExporter;
}
