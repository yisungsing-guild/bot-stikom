const { buildWhatsappConversationalReply, detectIntentFromAnswer } = require('../src/utils/whatsappFormatter');

// Test cases dari berbagai divisi (non-akademik, lebih domain-agnostic)
const testCases = [
  // 1. AKADEMIK (existing) - baseline
  {
    divisi: 'Akademik',
    topik: 'Kurikulum Program Studi',
    query: 'TI belajar apa saja',
    answer: 'Teknologi Informasi mempelajari pemrograman, basis data, jaringan, keamanan siber, dan analisis data.'
  },
  
  // 2. KEUANGAN
  {
    divisi: 'Keuangan',
    topik: 'Laporan Keuangan',
    query: 'Apa komponen laporan keuangan bulanan',
    answer: 'Laporan keuangan bulanan mencakup catatan kas masuk, pengeluaran operasional, gaji karyawan, biaya utilitas, dan ringkasan aset kampus.'
  },
  
  // 3. PENDAFTARAN (tapi bukan tentang gelombang)
  {
    divisi: 'Pendaftaran',
    topik: 'Status Pendaftaran',
    query: 'Bagaimana cek status pendaftaran',
    answer: 'Untuk mengecek status pendaftaran, masuk ke portal akademik dengan NIM dan password, lalu buka menu "Status Aplikasi". Sistem akan menampilkan tahap verifikasi dokumen, hasil seleksi, dan status kelulusan. Hubungi bagian pendaftaran jika ada masalah akses.'
  },
  
  // 4. BEASISWA (tapi context berbeda, misalnya untuk pegawai)
  {
    divisi: 'Beasiswa',
    topik: 'Beasiswa Pegawai',
    query: 'Beasiswa apa saja untuk pegawai yang melanjutkan pendidikan',
    answer: 'Pegawai dapat mengajukan beasiswa melanjutkan studi tingkat diploma atau sarjana, beasiswa sertifikasi profesional, atau beasiswa pelatihan keterampilan. Persyaratan mencakup minimum 2 tahun kerja, rekomendasi atasan, dan rencana pembelajaran yang jelas.'
  },
  
  // 5. KERJA SAMA INDUSTRI
  {
    divisi: 'Kerja Sama Industri',
    topik: 'Partnership Benefits',
    query: 'Apa saja keuntungan kerja sama dengan industri untuk mahasiswa',
    answer: 'Mahasiswa mendapatkan akses magang berbayar di perusahaan mitra, kesempatan penelitian kolaboratif, akses ke teknologi terkini, sertifikasi industri gratis, dan peluang rekrutmen langsung. Perusahaan mitra juga mengadakan workshop bulanan dan mentoring untuk skills development.'
  },
  
  // 6. PENELITIAN
  {
    divisi: 'Penelitian',
    topik: 'Pendanaan Riset',
    query: 'Bagaimana proses dan kriteria pendanaan penelitian mahasiswa',
    answer: 'Penelitian mahasiswa dapat didanai melalui skema internal universitas (Rp 5 juta - 50 juta), hibah penelitian nasional DIKTI (Rp 50 juta - 200 juta), dan kerjasama industri. Proposal harus melalui review tim dosen, memenuhi standar etika penelitian, dan sesuai dengan prioritas penelitian universitas tahun berjalan.'
  },
  
  // 7. LABORATORIUM
  {
    divisi: 'Laboratorium',
    topik: 'Fasilitas Lab',
    query: 'Fasilitas apa saja yang tersedia di laboratorium komputer',
    answer: 'Laboratorium komputer dilengkapi dengan 50 unit komputer terbaru dengan spesifikasi gaming-grade, server minikomputer untuk eksperimen jaringan, software development tools profesional (VS Code, IntelliJ, Visual Studio), simulator jaringan Cisco, dan ruang kerja kolaboratif untuk proyek kelompok. Jam operasional 07:00-19:00 setiap hari kerja.'
  },
  
  // 8. MAGANG
  {
    divisi: 'Magang',
    topik: 'Program Magang',
    query: 'Persyaratan dan durasi program magang industri',
    answer: 'Program magang wajib bagi semua mahasiswa dengan durasi 4 bulan selama semester 7. Mahasiswa harus telah menyelesaikan minimal 100 SKS, memiliki IPK minimal 2.75, dan penempatan di perusahaan yang sudah memiliki MOU dengan universitas. Pembimbing lapangan dari perusahaan akan memberikan nilai akhir magang yang berkontribusi pada transkrip.'
  }
];

console.log('='.repeat(100));
console.log('DOMAIN-AGNOSTIC FORMATTER VERIFICATION TEST');
console.log('='.repeat(100));

const results = [];
for (const tc of testCases) {
  console.log(`\n${'─'.repeat(100)}`);
  console.log(`DIVISI: ${tc.divisi.toUpperCase()} | TOPIK: ${tc.topik}`);
  console.log(`Query: "${tc.query}"`);
  console.log(`─`.repeat(100));
  
  // Detect intent
  const intent = detectIntentFromAnswer(tc.answer, tc.query);
  
  // Build full formatted message
  const formatted = buildWhatsappConversationalReply({
    rawMainAnswer: tc.answer,
    userQuery: tc.query,
    includeMeta: true
  });
  
  // Parse parts (simplified)
  const parts = formatted.split(/\n\n/).filter(Boolean);
  let conclusion = '';
  let suggestion = '';
  for (let i = 0; i < parts.length; i++) {
    if (/^Kesimpulannya|^Ringkasnya/i.test(parts[i])) {
      conclusion = parts[i];
    } else if (i > 2 && !conclusion) {
      // treat trailing parts as suggestions
      suggestion = parts.slice(i).join('\n\n');
      break;
    } else if (conclusion && i > 3) {
      suggestion = parts.slice(i).join('\n\n');
      break;
    }
  }
  
  console.log(`Detected Intent: ${intent}`);
  console.log(`\nConclusion:\n  ${conclusion || '(empty)'}`);
  console.log(`\nSuggestions:\n  ${suggestion ? suggestion.split('\n').slice(0, 3).join('\n  ') : '(empty)'}`);
  
  results.push({
    divisi: tc.divisi,
    topik: tc.topik,
    intent,
    conclusion: conclusion || '(empty)',
    suggestions: suggestion || '(empty)'
  });
}

console.log(`\n${'='.repeat(100)}`);
console.log('SUMMARY TABLE');
console.log('='.repeat(100));
console.log(JSON.stringify(results, null, 2));

// Check: any hardcoded program names or akademik-only keywords?
console.log(`\n${'='.repeat(100)}`);
console.log('HARDCODING AUDIT');
console.log('='.repeat(100));
const nonAcademicResults = results.filter(r => r.divisi.toLowerCase() !== 'akademik');
const allResults = nonAcademicResults.map(r => r.conclusion + ' ' + r.suggestions).join('\n');
const akademikKeywords = ['program studi', 'kurikulum', 'mata kuliah', 'pembelajaran'];
const foundKeywords = akademikKeywords.filter(kw => allResults.toLowerCase().includes(kw));
console.log(`Akademik-specific keywords found in non-akademik results: ${foundKeywords.length > 0 ? foundKeywords.join(', ') : 'NONE (✓ GOOD)'}`);

// Check: generic intent fallback works
const generalIntentResults = results.filter(r => r.intent === 'general');
console.log(`\nResults with 'general' intent (fallback): ${generalIntentResults.length}/${results.length}`);
if (generalIntentResults.length > 0) {
  console.log('General intent cases:');
  generalIntentResults.forEach(r => console.log(`  - ${r.divisi}: ${r.topik}`));
}

console.log(`\n${'='.repeat(100)}`);
console.log('CONCLUSION');
console.log('='.repeat(100));
const hasGoodFallback = generalIntentResults.length > 0;
const noHardcoding = foundKeywords.length === 0;
const goodVariety = results.length === 8;
console.log(`✓ Tested ${goodVariety ? 'all 8' : 'some'} divisi variations`);
console.log(`✓ Fallback to 'general' intent: ${hasGoodFallback ? 'YES (handles unknown categories)' : 'NO (potential issue)'}`);
console.log(`✓ No akademik hardcoding: ${noHardcoding ? 'YES (truly domain-agnostic)' : 'NO (found akademik keywords)'}`);
console.log(`\nFormatter is ${hasGoodFallback && noHardcoding && goodVariety ? 'READY FOR PRODUCTION ✓' : 'NEEDS REVIEW'}`);
