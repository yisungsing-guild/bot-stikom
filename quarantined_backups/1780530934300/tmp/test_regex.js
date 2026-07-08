const text = 'Potongan Biaya Pendaftaran: Rp 200.000, Jika Mendaftar pada Gelombang 1\nPotongan DPP: Rp 1.000.000, Gelombang 1';
const patterns = [
  '(?:potongan\\s+(?:biaya\\s+)?pendaftaran|diskon\\s+pendaftaran|diskon\\s+biaya\\s+pendaftaran)[^\\n]{0,120}?([0-9][0-9\\s\\.,]{1,40})',
  '(?:potongan\\s+dpp|diskon\\s+dpp|potongan\\s+dana\\s+pendidikan\\s+pokok)[^\\n]{0,120}?([0-9][0-9\\s\\.,]{1,40})'
];
for (const pat of patterns) {
  const re = new RegExp(pat, 'ig');
  let m;
  console.log('PATTERN', pat);
  while ((m = re.exec(text)) !== null) {
    console.log('MATCH', m[0], 'group1=', m[1]);
  }
}
