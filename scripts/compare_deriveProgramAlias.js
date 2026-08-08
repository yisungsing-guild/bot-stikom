const { deriveProgramAlias: newDerive } = require('../src/engine/deriveProgramAlias');

// legacy implementation copied from src/engine/temp_ragEngine_before.js
function legacyDerive(raw) {
  const candidate = String(raw || '').replace(/[\(\)\[\]\.,]/g, ' ').trim();
  if (!candidate) return null;
  const ignored = /^(program|studi|prodi|jurusan|teknik|teknologi|manajemen|ilmu|pendidikan|sistem|informasi|internasional|bisnis|digital|perangkat|lunak|terapan|komputer|multi|media|animasi|desain|grafis|antara|kerja|sama|double|dual|degree|bali|china|dalian|dan|atau|serta|dengan|untuk|dari|ke|di|pada|oleh|dalam)$/i;
  const words = candidate.split(/\s+/).filter((word) => word && !ignored.test(word));
  if (words.length === 0) return null;

  const aliasWord = words
    .map((word) => String(word || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .find((token) => token && ['SI','TI','BD','SK','MI','DKV','TRPL','TK','MM','AN','DG','RPL'].includes(token));
  if (aliasWord) return aliasWord;

  if (words.length === 1) {
    const token = words[0].replace(/[^A-Za-z0-9]/g, '');
    if (token.length <= 5) return token.toUpperCase();
    const initials = token.match(/[A-Z]/g);
    if (initials && initials.length >= 2) return initials.join('').toUpperCase();
    return token.slice(0, 4).toUpperCase();
  }
  const alias = words.map(w => w[0]).join('').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return alias.length >= 2 ? alias.slice(0, 5) : null;
}

const fixtures = [
  'Sistem Informasi',
  'SI',
  'Teknologi Informasi',
  'TI',
  'Sistem Komputer',
  'SK',
  'siSTem inForMaSi',
  '  Sistem   Informasi  ',
  'Saya ingin tahu tentang program studi Sistem Informasi untuk pendaftaran',
  'ini bukan nama prodi yang dikenal 12345',
  '',
  null,
  'si dia'
];

console.log('input\t| legacy\t| restored');
console.log('---------------------------------------------');
for (const f of fixtures) {
  let legacyOut, newOut;
  try { legacyOut = legacyDerive(f); } catch (e) { legacyOut = 'ERROR'; }
  try { newOut = newDerive(f); } catch (e) { newOut = 'ERROR'; }
  console.log(`${String(f)}\t| ${legacyOut}\t| ${newOut}`);
}
