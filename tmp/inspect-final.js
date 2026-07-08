const fs = require('fs');
const data = JSON.parse(fs.readFileSync('tmp/uat-provider-output.json','utf8'));
const targets = [
  'Berapa biaya kuliah Sistem Informasi per semester?',
  'Berapa biaya masuk TI?',
  'Biaya Bisnis Digital berapa?',
  'Berapa biaya Sistem Komputer di ITB STIKOM Bali?',
  'Berapa DPP untuk TI?',
  'Berapa biaya pendaftaran untuk SI?',
  'Bagaimana cara daftar PMB?',
  'Apa fasilitas kampus yang tersedia?',
  'Bagaimana akses kantin dan fasilitas olahraga?',
  'Bagaimana cara menuju kampus dengan transportasi umum?'
];
function full(label, logs) {
  const idx = logs.findIndex(l => l.startsWith(label));
  if (idx < 0) return null;
  let text = logs[idx].slice(label.length);
  for (let j = idx + 1; j < logs.length; j++) {
    const l = logs[j];
    if (l.startsWith('=== ') && l !== label) break;
    text += '\n' + l;
  }
  return text.trim();
}
for (const r of data.results) {
  if (targets.includes(r.query)) {
    console.log('====', r.query);
    console.log(full('=== FULL_FINAL_WA_MESSAGE ===', r.logs));
    console.log();
  }
}
