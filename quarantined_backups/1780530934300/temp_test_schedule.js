const path = require('path');
const fs = require('fs');

const file = path.join(__dirname, 'src', 'routes', 'provider.js');
const prov = require(file);

console.log('parseScheduleWaveKey(\"jadwal gelombang 2C?\") ->', prov.parseScheduleWaveKey('jadwal gelombang 2C?'));
console.log('parseScheduleWaveKey(\"2C\") ->', prov.parseScheduleWaveKey('2C'));
console.log('parseScheduleWaveKey(\"2 C\") ->', prov.parseScheduleWaveKey('2 C'));
console.log('parseScheduleWaveKey(\"Gelombang 2C\") ->', prov.parseScheduleWaveKey('Gelombang 2C'));

const cal = prov.extractAdmissionCalendarFromBundledIndex();
console.log('calendar rows count:', cal && cal.rows && cal.rows.length);
if (cal && cal.rows) {
  console.log('keys:', cal.rows.map(r => r.key).slice(0, 20));
  const row = cal.rows.find(r => r.key === 'II C');
  console.log('II C row:', row ? JSON.stringify(row, null, 2) : 'not found');
}
