const TimezoneUtils = {
  TZ: 'Europe/Riga',

  _parts(date, options) {
    const d = date instanceof Date ? date : new Date(date);
    if (!d || isNaN(d.getTime())) return null;
    const formatter = new Intl.DateTimeFormat('en-US', Object.assign({
      timeZone: this.TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }, options || {}));
    const values = {};
    formatter.formatToParts(d).forEach(part => {
      if (part.type !== 'literal') values[part.type] = part.value;
    });
    if (values.hour === '24') values.hour = '00';
    return values;
  },

  getNowRiga() {
    return new Date();
  },

  getHourRiga(date) {
    const parts = this._parts(date || new Date());
    return parts ? parseInt(parts.hour, 10) : new Date().getHours();
  },

  getTodayRiga() {
    const parts = this._parts(new Date());
    if (!parts) return '';
    return parts.year + '-' + parts.month + '-' + parts.day;
  },

  getTimeRiga() {
    const parts = this._parts(new Date());
    if (!parts) return '';
    return parts.hour + ':' + parts.minute + ':' + parts.second;
  },

  getDateTimeRiga() {
    return this.getTodayRiga() + 'T' + this.getTimeRiga();
  },

  toRigaISOString(date) {
    return this.formatDateTimeRiga(date);
  },

  formatDateRiga(date) {
    if (!date) return '';
    if (typeof date === 'string') {
      // Atbalstīt gan "YYYY-MM-DD", gan "YYYY-MM-DDTHH:mm:ss" formātus
      const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (dateMatch) {
        return dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3];
      }
    }
    const parts = this._parts(date);
    if (!parts) return '';
    return parts.year + '-' + parts.month + '-' + parts.day;
  },

  formatTimeRiga(date) {
    if (!date) return '';
    const parts = this._parts(date);
    if (!parts) return '';
    return parts.hour + ':' + parts.minute + ':' + parts.second;
  },

  formatDateTimeRiga(date) {
    const datePart = this.formatDateRiga(date);
    const timePart = this.formatTimeRiga(date);
    return datePart && timePart ? datePart + 'T' + timePart : '';
  },

  parseDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;
    if (typeof dateStr === 'string') {
      const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return new Date(parseInt(m[1], 10), parseInt(m[2]) - 1, parseInt(m[3], 10));
    }
    return null;
  },

  isSameDay(date1, date2) {
    const d1 = this.formatDateRiga(date1);
    const d2 = this.formatDateRiga(date2);
    return d1 !== '' && d1 === d2;
  },

  isTodayRiga(date) {
    return this.isSameDay(date, this.getTodayRiga());
  },

  offsetDaysRiga(days) {
    const today = this.getTodayRiga();
    if (!today) return '';
    const parts = today.split('-').map(value => parseInt(value, 10));
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    return date.getUTCFullYear() + '-' +
      String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(date.getUTCDate()).padStart(2, '0');
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TimezoneUtils;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TimezoneUtils = TimezoneUtils;
}