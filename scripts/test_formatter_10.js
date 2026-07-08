const { buildWhatsappConversationalReply } = require('../src/utils/whatsappFormatter');

const tests = [
  { q: 'TI belajar apa saja', a: 'Teknologi Informasi mempelajari pemrograman, basis data, jaringan, keamanan siber, dan analisis data.' },
  { q: 'Sistem Informasi belajar apa saja', a: 'Sistem Informasi fokus pada analisis bisnis, manajemen basis data, pemodelan sistem, dan manajemen proyek TI.' },
  { q: 'Prospek kerja TI', a: 'Lulusan TI dapat bekerja sebagai software developer, data analyst, network engineer, cybersecurity specialist, dan system architect.' },
  { q: 'Biaya kuliah TI', a: 'Biaya kuliah per semester sekitar Rp 6.500.000 untuk reguler; ada juga biaya pendaftaran Rp 500.000 dan biaya administrasi awal Rp 1.000.000.' },
  { q: 'Beasiswa yang tersedia', a: 'Beasiswa prestasi, beasiswa kurang mampu, dan beasiswa mitra industri tersedia dengan persyaratan berbeda.' },
  { q: 'Jadwal pendaftaran', a: 'Pendaftaran dibuka setiap gelombang: Gelombang 1 (Januari), Gelombang 2 (Mei), Gelombang 3 (September); deadline dan persyaratan tiap gelombang tercantum di situs.' },
  { q: 'Cara daftar mahasiswa baru', a: '* Isi formulir online\n* Unggah dokumen (ijazah, KTP)\n* Bayar biaya pendaftaran\n* Ikuti seleksi dan pengumuman' },
  { q: 'Lokasi kampus', a: 'Kampus utama berlokasi di Denpasar, Bali, dekat kawasan pendidikan utama dengan akses transportasi umum.' },
  { q: 'Akreditasi kampus', a: 'STIKOM Bali terakreditasi B untuk institusi dan beberapa program studi memiliki akreditasi B atau A sesuai SK terbaru.' },
  { q: 'Perbandingan TI dan SI', a: 'Teknologi Informasi lebih fokus pada aspek teknis pengembangan perangkat lunak dan infrastruktur, sementara Sistem Informasi menekankan integrasi teknologi dan proses bisnis.' }
];

function parseFormatted(text) {
  const parts = text.split(/\n\n/).map(p => p.trim()).filter(Boolean);
  const out = { greeting: null, assumption: null, mainAnswer: null, conclusion: null, suggestions: null, raw: text };
  if (parts.length >= 1) out.greeting = parts[0];
  if (parts.length >= 2) out.assumption = parts[1];
  if (parts.length >= 3) out.mainAnswer = parts[2];
  for (let i=3;i<parts.length;i++){
    const p = parts[i];
    if (/^Kesimpulannya|^Ringkasnya|^Intinya/i.test(p)) out.conclusion = p;
    else if (/^Rekomendasi pertanyaan/i.test(p) || /^Mau tahu|Cek |Prospek kerja|Perbedaan|Rekomendasi/i.test(p) || p.startsWith('-') || p.startsWith('*')) out.suggestions = p;
  }
  // normalize suggestions: if suggestions is a multiline block without header, include all trailing blocks
  if (!out.suggestions) {
    const rest = parts.slice(3).join('\n\n').trim();
    if (rest) out.suggestions = rest;
  }
  return out;
}

console.log('Running 10-case formatter batch test...');
const results = [];
for (const t of tests) {
  const formatted = buildWhatsappConversationalReply({ rawMainAnswer: t.a, userQuery: t.q, includeMeta: true });
  const parsed = parseFormatted(formatted);
  results.push({ query: t.q, mainAnswer: parsed.mainAnswer || t.a, conclusion: parsed.conclusion || '', suggestions: parsed.suggestions || '' });
}

console.log(JSON.stringify(results, null, 2));
