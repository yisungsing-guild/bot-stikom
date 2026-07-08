const text = 'Potongan Biaya Pendaftaran: Rp 200.000, Jika Mendaftar pada Gelombang 1\nPotongan DPP: Rp 1.000.000, Gelombang 1';
const normalizeWaveLabel = (s) => {
  if (!s) return null;
  const x = String(s).trim().toUpperCase();
  if (/^KHUSUS$/.test(x)) return 'KHUSUS';
  if (/^I{1,3}$/.test(x)) return String(x.length);
  if (/^IV$/.test(x)) return '4';
  if (/^[0-9]{1,2}$/.test(x)) return x;
  return x;
};
const extractWaveAmounts = (text, matcher) => {
  const amounts = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || !matcher(line)) continue;
    for (const match of line.matchAll(/Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?[^\n]{0,120}?Rp\.?\s*([0-9][0-9\s\.,]{1,40})/gi)) {
      const waveLabel = normalizeWaveLabel(`${match[1] || ''}${match[2] || ''}`);
      if (waveLabel) amounts.push({ waveLabel, amount: `Rp ${match[3]}` });
    }
    for (const match of line.matchAll(/Rp\.?\s*([0-9][0-9\s\.,]{1,40})[^\n]{0,120}?Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?/gi)) {
      const waveLabel = normalizeWaveLabel(`${match[2] || ''}${match[3] || ''}`);
      if (waveLabel) amounts.push({ waveLabel, amount: `Rp ${match[1]}` });
    }
  }
  return amounts;
};
const regPairs = extractWaveAmounts(text, line => /\b(pendaftaran|registrasi|biaya\s+pendaftaran)\b/i.test(line));
const dppPairs = extractWaveAmounts(text, line => /\b(dpp|dana\s+pendidikan\s+pokok|dana\s+pendidikan)\b/i.test(line));
console.log('regPairs', JSON.stringify(regPairs));
console.log('dppPairs', JSON.stringify(dppPairs));
