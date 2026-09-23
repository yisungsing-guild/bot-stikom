// Validate displayed amounts without the permissive OCR repairs used for parsing.
const rupiahNumber = '(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,\\d{2})?';
const rupiahAmount = new RegExp('(?:\\brp\\.?\\s*' + rupiahNumber + '(?![\\w]|[.,]\\d)|\\b' + rupiahNumber + '\\s+rupiah\\b)', 'i');

function hasConcreteNumberOrAmount(value, { financial = false } = {}) {
  const text = String(value || '');
  if (rupiahAmount.test(text)) return true;
  if (financial) {
    // Relative amounts remain valid, but counts of people/classes are not money.
    return /\b\d+(?:[.,]\d+)?\s*(?:juta|ribu|persen|%)(?!\w)(?!\s+(?:orang|mahasiswa|kelas|unit)\b)/i.test(text);
  }
  return /\b(?:gelombang\s+(?:khusus|sisipan\s*\d+|[ivx]+|\d+)\s*[a-c]?|(?:no\.?\s*)?\d{1,4}\s*\/\s*[a-z0-9.-]+\s*\/\s*[a-z0-9.-]+(?:\s*\/\s*[a-z0-9.-]+)*|\d+[.,]?\d*\s*(?:juta|ribu|sks|semester|tahun|bulan|hari|minggu|orang|kali|lokasi|kampus|cabang|ukm|ormawa|organisasi|unit|himaprodi|hima|himpunan|prodi|program|jurusan|beasiswa|fasilitas|layanan|kata|karakter|halaman|lembar|poin|huruf|angka|%)|(?:tahun|semester|bulan|minggu|hari|tahap)\s*(?:ke\s*[-–—]?\s*\d+|\d+)|\d{1,3}(?:\.\d{3})+|\d+\s*\/\s*\d+)\b/i.test(text)
    || /\b(?:ipk|gpa|toefl)\b.*?\b\d+[.,]?\d*\b|\b\d+[.,]?\d*\b.*?\b(?:ipk|gpa)\b/i.test(text);
}

module.exports = { hasConcreteNumberOrAmount };
