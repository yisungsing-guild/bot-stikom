const schemaVersion = 1;
const fixtureVersion = 'rag-engine-legacy-v2';
const generatedBy = 'scripts/testFixtures/deterministicRagFixture.js';

const documents = [
  {
    id: 'pmb-overview-2026', filename: 'fixture-pmb-overview-2026.md', source: 'fixture', docCategory: 'PMB', chunks: [
      'PMB ITB STIKOM Bali tahun akademik 2026/2027 menerima mahasiswa baru melalui jalur pendaftaran reguler, jalur prestasi, dan jalur kerja sama. Calon mahasiswa dapat memilih program studi Sistem Informasi, Teknologi Informasi, Sistem Komputer, Bisnis Digital, dan D3 Manajemen Informatika.',
      'Persyaratan umum pendaftaran mahasiswa baru ITB STIKOM Bali: mengisi formulir pendaftaran, melampirkan ijazah atau surat keterangan lulus, melampirkan KTP atau kartu keluarga, pas foto, dan mengikuti ketentuan administrasi PMB. Persyaratan ini berlaku untuk pilihan program studi termasuk D3 Manajemen Informatika selama tidak ada syarat khusus lain pada dokumen PMB.',
      'Daftar program studi ITB STIKOM Bali: Sistem Informasi (SI), Teknologi Informasi (TI), Sistem Komputer (SK), Bisnis Digital (BD), dan Manajemen Informatika jenjang D3 (MI).'
    ]
  },
  {
    id: 'pmb-schedule-2026', filename: 'fixture-pmb-schedule-2026.md', source: 'fixture', docCategory: 'JADWAL', chunks: [
      'KALENDER PENDAFTARAN MAHASISWA BARU 2026/2027\nGELOMBANG | MASA PENDAFTARAN | TESTING | PENGUMUMAN | REGISTRASI ULANG\nKHUSUS | 28 OKTOBER 2025 s/d 27 DESEMBER 2025 | 29 DESEMBER 2025 | 30 DESEMBER 2025 | 31 DESEMBER 2025\nI A | 28 DESEMBER 2025 s/d 17 JANUARI 2026 | 18 JANUARI 2026 | 19 JANUARI 2026 | 20 JANUARI 2026\nI B | 18 JANUARI 2026 s/d 7 FEBRUARI 2026 | 8 FEBRUARI 2026 | 9 FEBRUARI 2026 | 10 FEBRUARI 2026\nI C | 8 FEBRUARI 2026 s/d 28 FEBRUARI 2026 | 1 MARET 2026 | 2 MARET 2026 | 3 MARET 2026',
      'KALENDER PENDAFTARAN MAHASISWA BARU 2026/2027\nGELOMBANG | MASA PENDAFTARAN | TESTING | PENGUMUMAN | REGISTRASI ULANG\nII A | 1 MARET 2026 s/d 28 MARET 2026 | 29 MARET 2026 | 30 MARET 2026 | 31 MARET 2026\nII B | 29 MARET 2026 s/d 18 APRIL 2026 | 19 APRIL 2026 | 20 APRIL 2026 | 21 APRIL 2026\nII C | 19 APRIL 2026 s/d 9 MEI 2026 | 10 MEI 2026 | 11 MEI 2026 | 12 MEI 2026',
      'KALENDER PENDAFTARAN MAHASISWA BARU 2026/2027\nGELOMBANG | MASA PENDAFTARAN | TESTING | PENGUMUMAN | REGISTRASI ULANG\nIII A | 10 MEI 2026 s/d 30 MEI 2026 | 31 MEI 2026 | 1 JUNI 2026 | 2 JUNI 2026\nIII B | 31 MEI 2026 s/d 20 JUNI 2026 | 21 JUNI 2026 | 22 JUNI 2026 | 23 JUNI 2026\nIII C | 21 JUNI 2026 s/d 11 JULI 2026 | 12 JULI 2026 | 13 JULI 2026 | 14 JULI 2026',
      'KALENDER PENDAFTARAN MAHASISWA BARU 2026/2027\nGELOMBANG | MASA PENDAFTARAN | TESTING | PENGUMUMAN | REGISTRASI ULANG\nIV A | 12 JULI 2026 s/d 1 AGUSTUS 2026 | 2 AGUSTUS 2026 | 3 AGUSTUS 2026 | 4 AGUSTUS 2026\nIV B | 2 AGUSTUS 2026 s/d 22 AGUSTUS 2026 | 23 AGUSTUS 2026 | 24 AGUSTUS 2026 | 25 AGUSTUS 2026\nIV C | 23 AGUSTUS 2026 s/d 12 SEPTEMBER 2026 | 13 SEPTEMBER 2026 | 14 SEPTEMBER 2026 | 15 SEPTEMBER 2026'
    ]
  },  {
    id: 'fee-si-ti-bd-2026', filename: 'fixture-rincian-biaya-si-ti-bd-2026.md', source: 'fixture', docCategory: 'BIAYA', chunks: [
      'PROGRAM STUDI SISTEM INFORMASI TA 2026/2027 Gelombang 1A. Biaya Pendaftaran Rp 250.000. Dana Pendidikan Pokok (DPP) Rp 7.000.000. Biaya Pendidikan Per Semester Rp 6.000.000. Jas almamater, topi, kaos, tas, dan kegiatan mahasiswa tercantum sebagai komponen awal.',
      'PROGRAM STUDI SISTEM INFORMASI TA 2026/2027 Gelombang 2A. Biaya Pendaftaran Rp 500.000. Dana Pendidikan Pokok (DPP) Rp 9.000.000. Biaya Pendidikan Per Semester Rp 6.000.000.',
      'PROGRAM STUDI TEKNOLOGI INFORMASI TA 2026/2027 Gelombang 1A. Biaya Pendaftaran Rp 500.000. Dana Pendidikan Pokok (DPP) Rp 14.000.000. Biaya Pendidikan Per Semester Rp 7.000.000.',
      'PROGRAM STUDI TEKNOLOGI INFORMASI TA 2026/2027 Gelombang 1C. Biaya Pendaftaran Rp 500.000. Dana Pendidikan Pokok (DPP) Rp 14.000.000. Biaya Pendidikan Per Semester Rp 7.000.000. Jas almamater, Topi, Kaos, Tas, GMTI.',
      'PROGRAM STUDI BISNIS DIGITAL TA 2026/2027 Gelombang 1A. Biaya Pendaftaran Rp 500.000. Dana Pendidikan Pokok (DPP) Rp 8.000.000. Biaya Pendidikan Per Semester Rp 6.500.000.'
    ]
  },
  { id: 'fee-sk-2026', filename: 'fixture-rincian-biaya-sk-2026.md', source: 'fixture', docCategory: 'BIAYA', chunks: [
      'PROGRAM STUDI SISTEM KOMPUTER TA 2026/2027 Gelombang 1A. Biaya Pendaftaran Rp 500.000. Dana Pendidikan Pokok (DPP) Rp 11.000.000. Biaya Pendidikan Per Semester Rp 6.000.000.',
      'PROGRAM STUDI SISTEM KOMPUTER TA 2026/2027 Gelombang 2A. Biaya Pendaftaran Rp 500.000. Dana Pendidikan Pokok (DPP) Rp 12.000.000. Biaya Pendidikan Per Semester Rp 6.000.000.'
    ] },
  { id: 'fee-d3-mi-2026', filename: 'fixture-rincian-biaya-d3-mi-2026.md', source: 'fixture', docCategory: 'BIAYA', chunks: [
      'PROGRAM STUDI MANAJEMEN INFORMATIKA D3 TA 2026/2027 Gelombang 1A. Biaya Pendaftaran Rp 500.000. Dana Pendidikan Pokok (DPP) Rp 5.000.000. Biaya Pendidikan Per Semester Rp 4.500.000.'
    ] },
  { id: 'fee-dual-degree-2026', filename: 'fixture-rincian-biaya-dual-degree-2026.md', source: 'fixture', docCategory: 'BIAYA', chunks: [
      'Biaya program Double Degree nasional UTB TA 2026/2027 mencakup biaya pendaftaran Rp 500.000, DPP Rp 6.000.000, dan biaya pendidikan per semester Rp 5.000.000.',
      'Biaya program Double Degree internasional DNUI TA 2026/2027 mencakup biaya pendaftaran Rp 500.000, Dana Pendidikan Pokok (DPP) Rp 20.000.000, Bahasa Mandarin Rp 5.000.000, dan Biaya Pendidikan Per Semester Rp 16.000.000.',
      'Biaya program Double Degree internasional HELP University Malaysia TA 2026/2027 mencakup biaya pendaftaran Rp 500.000, Dana Pendidikan Pokok (DPP) Rp 20.000.000, Bahasa Inggris Rp 5.000.000, dan Biaya Pendidikan per semester Rp 16.000.000.'
    ] },
  { id: 'program-profiles-2026', filename: 'fixture-program-profiles-2026.md', source: 'fixture', docCategory: 'PRODI', chunks: [
      'Program Studi Sistem Informasi mempelajari analisis proses bisnis, perancangan sistem informasi, basis data, manajemen proyek TI, dan penerapan teknologi untuk kebutuhan organisasi. Lulusan dapat bekerja sebagai system analyst, business analyst, database administrator, dan konsultan sistem informasi.',
      'Program Studi Teknologi Informasi mempelajari pemrograman, jaringan komputer, keamanan siber, cloud computing, pengembangan aplikasi, dan infrastruktur teknologi. Lulusan dapat bekerja sebagai software developer, network engineer, cyber security analyst, dan cloud engineer.',
      'Program Studi Sistem Komputer mempelajari arsitektur komputer, embedded system, Internet of Things, jaringan, robotika, dan integrasi perangkat keras dengan perangkat lunak. Lulusan mendapat gelar S.Kom dan dapat bekerja sebagai IoT engineer, embedded system engineer, dan network engineer.',
      'Program Studi Bisnis Digital mempelajari digital marketing, e-commerce, kewirausahaan digital, analisis data bisnis, manajemen produk digital, dan strategi bisnis berbasis teknologi. Lulusan dapat bekerja sebagai digital business analyst, product specialist, entrepreneur, dan digital marketer.',
      'Program Studi Manajemen Informatika D3 mempelajari pemrograman terapan, basis data, aplikasi perkantoran, analisis sistem sederhana, dan praktik pengelolaan teknologi informasi.'
    ] },
  { id: 'campus-location', filename: 'fixture-campus-location.md', source: 'fixture', docCategory: 'KAMPUS', chunks: [
      'Lokasi kampus ITB STIKOM Bali berada di Denpasar, Bali. Informasi ini menjelaskan alamat dan lokasi kampus, bukan biaya pendidikan atau kewirausahaan.',
      'Canonical legacy campus-location fixture: ITB STIKOM Bali memiliki lokasi kampus di Renon, Jimbaran, dan Abiansemal. Fakta ini dipakai untuk menguji retrieval lokasi kampus secara terpisah dari biaya, beasiswa, dan kewirausahaan.',
      'Dokumen fixture ini menetapkan tiga lokasi kampus ITB STIKOM Bali: Renon, Jimbaran, dan Abiansemal.'
    ] },
  { id: 'accreditation-2026', filename: 'fixture-accreditation-2026.md', source: 'fixture', docCategory: 'AKREDITASI', chunks: [
      'SERTIFIKAT AKREDITASI PROGRAM STUDI BISNIS DIGITAL (BD). Status akreditasi: Terakreditasi Baik Sekali. Nomor SK: 0123/BAN-PT/AK/S/2024. Masa berlaku 05 Oktober 2022 sampai 05 Oktober 2027.',
      'SERTIFIKAT AKREDITASI PROGRAM STUDI SISTEM INFORMASI (SI). Status akreditasi: Terakreditasi Baik Sekali. Nomor SK: 0456/BAN-PT/AK/S/2024. Masa berlaku 06 September 2022 sampai 06 September 2027.'
    ] },
  { id: 'scholarship-2026', filename: 'fixture-scholarship-2026.md', source: 'fixture', docCategory: 'BEASISWA', chunks: [
      'Program beasiswa dan potongan biaya ITB STIKOM Bali meliputi KIP Kuliah, beasiswa prestasi, potongan ranking sekolah, potongan pendaftaran gelombang awal, dan potongan khusus sesuai ketentuan PMB.',
      'Potongan ranking sekolah diberikan untuk calon mahasiswa dari sekolah tertentu yang tercantum dalam lampiran kerja sama. Ranking 1 sampai 3 mendapat potongan lebih besar daripada ranking berikutnya sesuai ketentuan PMB.',
      'Sekolah tertentu berarti sekolah asal calon mahasiswa yang tercantum dalam lampiran daftar sekolah kerja sama ITB STIKOM Bali. Jika sekolah tidak tercantum dalam lampiran, eligibility potongan ranking perlu dikonfirmasi ke PMB.',
      'Lampiran sekolah kerja sama berisi daftar sekolah mitra untuk potongan ranking. Fixture test sengaja tidak memuat daftar lengkap sekolah agar jawaban tidak mengarang short list.'
    ] },
  { id: 'dual-degree-2026', filename: 'fixture-dual-degree-2026.md', source: 'fixture', docCategory: 'DOUBLE_DEGREE', chunks: [
      'ITB STIKOM Bali memiliki program Double Degree nasional dengan Universitas Teknologi Bandung (UTB).',
      'ITB STIKOM Bali memiliki program Double Degree internasional dengan DNUI dan HELP University.',
      'Keuntungan Double Degree adalah mahasiswa dapat memperoleh pengalaman pembelajaran lintas institusi, penguatan jejaring akademik, dan nilai tambah kompetensi sesuai ketentuan masing-masing partner.'
    ] },
  { id: 'student-organization-2026', filename: 'fixture-ukm-ormawa-2026.md', source: 'fixture', docCategory: 'ORGANISASI', chunks: [
      'Organisasi mahasiswa ITB STIKOM Bali meliputi BEM, DPM, Himaprodi, dan UKM untuk mendukung minat mahasiswa di luar pembelajaran formal.',
      'Catalogue UKM minat seni meliputi UKM Tabuh Bramara Gita dan UKM Paduan Suara. Catalogue UKM olahraga meliputi UKM Basket dan UKM Futsal. Catalogue UKM teknologi meliputi komunitas coding dan multimedia. Catalogue UKM kewirausahaan meliputi komunitas entrepreneurship mahasiswa.'
    ] },
  { id: 'hobby-recommendation-2026', filename: 'fixture-hobby-recommendation-2026.md', source: 'fixture', docCategory: 'REKOMENDASI', chunks: [
      'Rekomendasi minat: siswa yang suka ngoding, membuat aplikasi, jaringan, dan keamanan sistem cocok mempertimbangkan Teknologi Informasi.',
      'Rekomendasi minat: siswa yang suka tawar-menawar, jualan online, e-commerce, promosi digital, dan wirausaha cocok mempertimbangkan Bisnis Digital.',
      'Rekomendasi minat: siswa yang suka menganalisis proses kerja, studi kasus perusahaan, dan alur bisnis cocok mempertimbangkan Sistem Informasi.'
    ] }
];

module.exports = { schemaVersion, fixtureVersion, generatedBy, documents };

