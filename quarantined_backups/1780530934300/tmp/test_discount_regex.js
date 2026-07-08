const text = 'Potongan Biaya Pendaftaran : Rp.  300.000,- Jika  Mendaftar pada Gelombang Khusus Rp.  250.000,- Jika  Mendaftar pada Gelombang I Rp.  200.000,- Jika  Mendaftar pada Gelombang II Rp.  150.000,- Jika  Mendaftar pada Gelombang III Rp.  100.000,- Jika Mendaftar pada Gelombang IV';
const queryWaveLabel = '1A';
const queryWaveGroup = '1';
const waveRoman = 'I';
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
const waveMatchers = [];
if (queryWaveLabel) waveMatchers.push(escapeRegex(queryWaveLabel));
if (queryWaveGroup) {
  waveMatchers.push(escapeRegex(String(queryWaveGroup)));
  if (waveRoman) waveMatchers.push(escapeRegex(waveRoman));
}
const wavePattern = `(?:${Array.from(new Set(waveMatchers)).join('|')})`;
const pat = `(?:potongan\\s+(?:biaya\\s+)?pendaftaran|diskon\\s+(?:pendaftaran|biaya\\s+pendaftaran))[^\\n]{0,120}?Rp\\.?\\s*([0-9][0-9\\s\\.,]{1,40})[^\\n]{0,120}?gelombang\\s*${wavePattern}`;
console.log('pattern', pat);
const re = new RegExp(pat, 'ig');
let m;
while ((m = re.exec(text)) !== null) {
  console.log('match', m[1], 'idx', m.index, 'matchtext', m[0]);
}
