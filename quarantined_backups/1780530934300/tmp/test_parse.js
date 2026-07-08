function repairOcrNumericNoise(text) {
  return String(text || '')
    .replace(/([\dRrPp\.])([oO])(?=[\d\.])/g, '$10')
    .replace(/([\dRrPp\.])([lI])(?=[\d\.])/g, '$11')
    .replace(/(?<=\d)[oO](?=\d)/g, '0')
    .replace(/(?<=\d)[lI](?=\d)/g, '1')
    .replace(/[^\dRp.,\-A-Za-z ]+/g, ' ');
}
const chunk = 'Potongan Biaya Pendaftaran: Rp 200.000, Jika Mendaftar pada Gelombang 1\nPotongan DPP: Rp 1.000.000, Gelombang 1';
const normalized = repairOcrNumericNoise(chunk.replace(/\r\n/g, '\n'));
console.log('normalized', normalized);
function findMoney(pattern) {
  const re = new RegExp(pattern, 'ig');
  let m;
  while ((m = re.exec(normalized)) !== null) {
    const raw = String(m[1] || '').trim();
    console.log('found raw', raw);
    const parsed = parseMoneyText(raw);
    console.log('parsed', parsed);
    if (parsed) return parsed;
  }
  return null;
}
function normalizeOcrMoneyText(raw) {
  let value = String(raw || '').trim();
  value = value.replace(/([0-9])\s+([0-9])/g, '$1$2');
  value = value.replace(/\s*[.,]\s*/g, '.');
  value = value.replace(/[^0-9.]/g, '');
  value = value.replace(/\.{2,}/g, '.');
  return value;
}
function parseMoneyText(raw) {
  const repaired = repairOcrNumericNoise(raw);
  const normalized = normalizeOcrMoneyText(repaired);
  const digits = normalized.replace(/\./g, '');
  if (!/^[0-9]+$/.test(digits)) return null;
  return `Rp ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
console.log('registrationDiscount', findMoney('(?:potongan\\s+(?:biaya\\s+)?pendaftaran|diskon\\s+pendaftaran|diskon\\s+biaya\\s+pendaftaran)[^\\n]{0,120}?([0-9][0-9\\s\\.,]{1,40})'));
console.log('dppDiscount', findMoney('(?:potongan\\s+dpp|diskon\\s+dpp|potongan\\s+dana\\s+pendidikan\\s+pokok)[^\\n]{0,120}?([0-9][0-9\\s\\.,]{1,40})'));
