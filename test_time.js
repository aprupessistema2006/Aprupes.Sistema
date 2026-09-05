console.log('=== Datuma un laika pārbaude ===\n');

const now = new Date();

console.log('1. Šodienas datums (Latvija):');
const lvDate = new Intl.DateTimeFormat('lv-LV', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Europe/Riga'
}).format(now);
console.log('   ' + lvDate);

console.log('\n2. Tagadējais laiks (Latvija):');
const lvTime = new Intl.DateTimeFormat('lv-LV', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Europe/Riga',
  hour12: false
}).format(now);
console.log('   ' + lvTime + ' (24h formātā)');

console.log('\n3. Pasaules laiks (UTC):');
const utcDate = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'UTC',
  hour12: false
}).format(now);
console.log('   ' + utcDate.replace(/\//g, '-'));

console.log('\n=== Beigas ===');
