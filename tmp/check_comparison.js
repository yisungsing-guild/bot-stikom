const providerFactory = require('../src/routes/provider.js');
const provider = {};
const mod = providerFactory(provider);
const tests = [
  'Apa perbedaan Sistem Informasi dan Teknik Informatika?',
  'Bandingkan SI dengan Informatika',
  'Mana yang lebih murah SI atau TI?',
  'Bandingkan TI vs SK',
  'Beda SI sama TI gimana?',
  'Bandingkan Sistem Informasi dengan Sistem Komputer',
  'Perbedaan si vs sk',
  'apa perbedaan si dengan ti?'
];
for (const q of tests) {
  const res = mod.buildProgramComparisonRewrite(q);
  console.log('Q:', q);
  console.log(JSON.stringify(res, null, 2));
}
