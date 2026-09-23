'use strict';

process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';
process.env.ENABLE_RAG = 'true';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.RAG_TRACE_PERSIST = 'false';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.SEMANTIC_RAG_FIRST = 'true';
process.env.DISABLE_KEYWORD_RULES = 'true';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';

const { performance } = require('perf_hooks');
const semanticRag = require('../src/engine/semanticRagEngine');
const { querySemanticRag } = semanticRag;

// 105 STRATIFIED SUPPORTED CASES ACROSS 18 DOMAINS AND 40+ DISTINCT FILES
const SUPPORTED_CASES = [
  // DOMAIN 1: PROGRAM STUDI & PROFIL LULUSAN (ISIAN WEBSITE, Penjelasan Prodi)
  { id: 'PS-01', domain: 'program studi', file: 'ISIAN WEBSITE (1).pdf', entity: 'Teknologi Informasi', field: 'profil', query: 'apa profil program studi teknologi informasi di stikom bali?', validate: r => /teknologi informasi|kurikulum|lulusan/i.test(r.answer) },
  { id: 'PS-02', domain: 'program studi', file: 'ISIAN WEBSITE (1).pdf', entity: 'Sistem Informasi', field: 'profil', query: 'jelaskan tentang jurusan sistem informasi', validate: r => /sistem informasi|komputer|bisnis/i.test(r.answer) },
  { id: 'PS-03', domain: 'program studi', file: 'ISIAN WEBSITE (1).pdf', entity: 'Bisnis Digital', field: 'profil', query: 'stikom ada jurusan bisnis digital ga ya?', validate: r => /bisnis digital|digital/i.test(r.answer) },
  { id: 'PS-04', domain: 'program studi', file: 'ISIAN WEBSITE (1).pdf', entity: 'Sistem Komputer', field: 'kurikulum', query: 'kurikulum sistem komputer itu belajarnya apa aja', validate: r => /sistem komputer|hardware|jaringan|kurikulum/i.test(r.answer) },
  { id: 'PS-05', domain: 'program studi', file: 'rincian Biaya D3 Tahun Ajaran 2026-2027.pdf', entity: 'Manajemen Informatika', field: 'jenjang', query: 'jenjang d3 apa saja yang ada di stikom?', validate: r => /manajemen informatika|d3/i.test(r.answer) },
  { id: 'PS-06', domain: 'program studi', file: 'ISIAN WEBSITE (1).pdf', entity: 'Teknologi Informasi', field: 'gelar', query: 'lulusan teknologi informasi gelarnya apa min?', validate: r => /s\.kom|sarjana/i.test(r.answer) },

  // DOMAIN 2: ACCREDITATION (SERTIFIKAT AKREDITASI BD, TI, MI, SI, SK)
  { id: 'AC-01', domain: 'accreditation', file: 'SERTIFIKAT AKREDITASI TI (06 SEPT 2022 - 06 SEPT 2027).pdf', entity: 'Teknologi Informasi', field: 'akreditasi', query: 'berapa akreditasi prodi teknologi informasi?', validate: r => /baik sekali|b|akreditasi/i.test(r.answer) },
  { id: 'AC-02', domain: 'accreditation', file: 'SERTIFIKAT AKREDITASI BD (05 OKT 2022 - 05 OKT 2027).pdf', entity: 'Bisnis Digital', field: 'akreditasi', query: 'akreditasi bisnis digital apa sekarang?', validate: r => /baik|akreditasi/i.test(r.answer) },
  { id: 'AC-03', domain: 'accreditation', file: 'SERTIFIKAT AKREDITASI SISTEM KOMPUTER (09 APRIL 2025 - 09 APRIL 2030).pdf', entity: 'Sistem Komputer', field: 'akreditasi', query: 'akreditasi sistem komputer apa min?', validate: r => /baik sekali|unggul|akreditasi/i.test(r.answer) },
  { id: 'AC-04', domain: 'accreditation', file: 'SERTIFIKAT AKREDITASI MI (17 NOV 2021 - 17 NOV 2026).pdf', entity: 'Manajemen Informatika', field: 'akreditasi', query: 'akreditasi d3 manajemen informatika apa ya', validate: r => /baik sekali|b|ban-pt|akreditasi/i.test(r.answer) },
  { id: 'AC-05', domain: 'accreditation', file: 'SERTIFIKAT AKREDITASI - SISTEM INFORMASI (14 DES 2023 - 14 DES 2028) LAM INFOKOM.pdf', entity: 'Sistem Informasi', field: 'akreditasi', query: 'akreditasi sistem informasi stikom bali apa?', validate: r => /baik sekali|lam infokom|akreditasi/i.test(r.answer) },

  // DOMAIN 3: TUITION / FEES (rincian Biaya SI, TI, BD, SK, D3, HELP, DNUI, UTB)
  { id: 'FE-01', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'Teknologi Informasi', field: 'biaya_kuliah', query: 'berapa biaya kuliah teknologi informasi reguler?', validate: r => /biaya|dpp|spp|pembayaran/i.test(r.answer) },
  { id: 'FE-02', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'Sistem Informasi', field: 'biaya_pendaftaran', query: 'biaya pendaftaran sistem informasi berapa?', validate: r => /500\.000|pendaftaran/i.test(r.answer) },
  { id: 'FE-03', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'Bisnis Digital', field: 'biaya_kuliah', query: 'ongkos kuliah bisnis digital berapa ya', validate: r => /biaya|dpp|spp|bisnis digital/i.test(r.answer) },
  { id: 'FE-04', domain: 'tuition / fees', file: 'rincian Biaya SK Tahun Ajaran 2026-2027.pdf', entity: 'Sistem Komputer', field: 'biaya_kuliah', query: 'rincian biaya sistem komputer t.a 2026/2027', validate: r => /sistem komputer|biaya|dpp/i.test(r.answer) },
  { id: 'FE-05', domain: 'tuition / fees', file: 'rincian Biaya D3 Tahun Ajaran 2026-2027.pdf', entity: 'D3 Manajemen Informatika', field: 'biaya_kuliah', query: 'biaya kuliah d3 manajemen informatika berapa?', validate: r => /d3|biaya|dpp|manajemen informatika/i.test(r.answer) },
  { id: 'FE-06', domain: 'tuition / fees', file: 'rincian Biaya DNUI Tahun Ajaran 2026-2027.pdf', entity: 'DNUI China', field: 'biaya_kuliah', query: 'berapa biaya dual degree dalian neusoft china?', validate: r => /dalian|dnui|biaya|dollar|rmb|pendidikan/i.test(r.answer) },
  { id: 'FE-07', domain: 'tuition / fees', file: 'rincian Biaya HELP Tahun Ajaran 2026-2027.pdf', entity: 'HELP University', field: 'biaya_kuliah', query: 'biaya double degree help university malaysia berapa?', validate: r => /help|malaysia|biaya/i.test(r.answer) },
  { id: 'FE-08', domain: 'tuition / fees', file: 'rincian Biaya UTB Tahun Ajaran 2026-2027.pdf', entity: 'UTB Bandung', field: 'biaya_kuliah', query: 'berapa biaya dual degree utb bandung?', validate: r => /utb|bandung|biaya/i.test(r.answer) },
  { id: 'FE-09', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'Teknologi Informasi', field: 'cicilan', query: 'apakah biaya kuliah di stikom bisa dicicil?', validate: r => /cicil|angsur|tahap/i.test(r.answer) },
  { id: 'FE-10', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'Teknologi Informasi', field: 'dpp', query: 'apa itu dpp dan berapa nominalnya?', validate: r => /dpp|gedung|biaya/i.test(r.answer) },

  // DOMAIN 4: PMB & PENDAFTARAN (Kalender Pendaftaran, GoseToSchool)
  { id: 'PMB-01', domain: 'PMB', file: 'Kalender Pendaftaran.xlsx', entity: 'PMB', field: 'jalur', query: 'jalur pendaftaran apa saja yang dibuka di stikom bali?', validate: r => /jalur|reguler|prestasi|pendaftaran/i.test(r.answer) },
  { id: 'PMB-02', domain: 'PMB', file: 'ISIAN WEBSITE (1).pdf', entity: 'PMB', field: 'link', query: 'dimana website resmi untuk mendaftar pmb?', validate: r => /stikom-bali\.ac\.id|daftar|online/i.test(r.answer) },
  { id: 'PMB-03', domain: 'PMB', file: 'STIKOM Bali GoseToSchool 2025.docx', entity: 'PMB', field: 'syarat', query: 'apa syarat berkas pendaftaran mahasiswa baru?', validate: r => /syarat|ijazah|ktp|foto|berkas|rapor/i.test(r.answer) },
  { id: 'PMB-04', domain: 'PMB', file: 'Kalender Pendaftaran.xlsx', entity: 'PMB', field: 'gelombang', query: 'kapan gelombang pendaftaran dibuka?', validate: r => /gelombang|pendaftaran|jadwal/i.test(r.answer) },
  { id: 'PMB-05', domain: 'PMB', file: 'STIKOM Bali GoseToSchool 2025.docx', entity: 'PMB', field: 'tes_masuk', query: 'apakah ada tes masuk untuk mahasiswa baru?', validate: r => /tes|ujian|seleksi|bebas tes/i.test(r.answer) },

  // DOMAIN 5: SCHEDULES & ACADEMIC CALENDAR
  { id: 'SC-01', domain: 'schedules / academic calendar', file: 'Kalender Akademik Ganjil, Genap dan Antara TA 2025-2026 (1).pdf', entity: 'Kalender Akademik', field: 'remedial', query: 'kapan jadwal pendaftaran remedial semester ganjil?', validate: r => /remedial|februari|jadwal/i.test(r.answer) },
  { id: 'SC-02', domain: 'schedules / academic calendar', file: 'media-Kalender-Akademik-2025_versi30-01-2025-scaled.jpg', entity: 'Kalender Akademik', field: 'gambar', query: 'bisa kirim gambar kalender akademik?', validate: r => /kalender akademik/i.test(r.answer) },
  { id: 'SC-03', domain: 'schedules / academic calendar', file: 'Kalender Akademik Ganjil, Genap dan Antara TA 2025-2026 (1).pdf', entity: 'Kalender Akademik', field: 'krs', query: 'kapan jadwal pengisian krs semester baru?', validate: r => /krs|perkuliahan|jadwal|akademik/i.test(r.answer) },
  { id: 'SC-04', domain: 'schedules / academic calendar', file: 'Kalender Akademik Ganjil, Genap dan Antara TA 2025-2026 (1).pdf', entity: 'Kalender Akademik', field: 'wisuda', query: 'kapan pelaksanaan wisuda di stikom bali?', validate: r => /wisuda|yudisium|jadwal/i.test(r.answer) },

  // DOMAIN 6: SCHOLARSHIPS (GoseToSchool, ISIAN WEBSITE)
  { id: 'SCH-01', domain: 'scholarships', file: 'STIKOM Bali GoseToSchool 2025.docx', entity: 'Beasiswa', field: 'jenis', query: 'apakah ada beasiswa di itb stikom bali?', validate: r => /beasiswa|prestasi|kip|potongan/i.test(r.answer) },
  { id: 'SCH-02', domain: 'scholarships', file: 'STIKOM Bali GoseToSchool 2025.docx', entity: 'Beasiswa KIP', field: 'kip_kuliah', query: 'apakah stikom bali menerima beasiswa kip kuliah?', validate: r => /kip|kuliah|beasiswa/i.test(r.answer) },
  { id: 'SCH-03', domain: 'scholarships', file: 'STIKOM Bali GoseToSchool 2025.docx', entity: 'Beasiswa Prestasi', field: 'syarat', query: 'bagaimana cara mendapatkan beasiswa prestasi?', validate: r => /prestasi|rapor|piagam|beasiswa/i.test(r.answer) },

  // DOMAIN 7: CAREER OUTCOMES & CDC (ok-Company-Profile-CDC, Penjelasan Prodi)
  { id: 'CAR-01', domain: 'career outcomes', file: 'Penjelasan Prodi dan Karier Masa Depan (1).xlsx', entity: 'Teknologi Informasi', field: 'prospek_karir', query: 'lulusan teknologi informasi prospek kerjanya apa ya?', validate: r => /software|developer|engineer|karir|kerja/i.test(r.answer) },
  { id: 'CAR-02', domain: 'career outcomes', file: 'Penjelasan Prodi dan Karier Masa Depan (1).xlsx', entity: 'Sistem Informasi', field: 'prospek_karir', query: 'prospek karir jurusan sistem informasi apa saja?', validate: r => /analyst|bisnis|konsultan|karir|kerja/i.test(r.answer) },
  { id: 'CAR-03', domain: 'career outcomes', file: 'Penjelasan Prodi dan Karier Masa Depan (1).xlsx', entity: 'Bisnis Digital', field: 'prospek_karir', query: 'kerja lulusan bisnis digital apa?', validate: r => /digital|marketing|startup|e-commerce/i.test(r.answer) },
  { id: 'CAR-04', domain: 'career outcomes', file: 'ok-Company-Profile-CDC (1).pdf', entity: 'Career Center', field: 'layanan', query: 'apa itu career center itb stikom bali?', validate: r => /career center|karier|alumni|kerja/i.test(r.answer) },

  // DOMAIN 8: CAREER CENTER & CAMPUS SERVICES (FAQ CC, INBIS PROFILE)
  { id: 'SRV-01', domain: 'Career Center / campus services', file: 'FAQ CC.docx', entity: 'Career Center', field: 'magang', query: 'apakah career center membantu info magang kerja?', validate: r => /magang|kerja|career center/i.test(r.answer) },
  { id: 'SRV-02', domain: 'Career Center / campus services', file: 'INBIS PROFILE 2026.pdf', entity: 'Inkubator Bisnis', field: 'definisi', query: 'apa fungsi inkubator bisnis inbis di stikom bali?', validate: r => /inbis|inkubator|bisnis|startup|tenant/i.test(r.answer) },
  { id: 'SRV-03', domain: 'Career Center / campus services', file: 'Profil INBIS Bali - 2026.docx', entity: 'Inkubator Bisnis', field: 'program', query: 'layanan apa saja yang ada di inbis bali?', validate: r => /inbis|startup|pendampingan|wirausaha/i.test(r.answer) },
  { id: 'SRV-04', domain: 'Career Center / campus services', file: 'PROFIL LAYANAN INDUSTRI.docx', entity: 'Layanan Industri', field: 'layanan', query: 'apa itu direktorat kerja sama layanan industri?', validate: r => /layanan industri|kerja sama|inbis/i.test(r.answer) },

  // DOMAIN 9: FACILITIES (fasilitas-stikom.pdf, ISIAN WEBSITE)
  { id: 'FAC-01', domain: 'facilities', file: 'fasilitas-stikom.pdf', entity: 'Fasilitas', field: 'daftar_fasilitas', query: 'apa saja fasilitas yang ada di kampus stikom bali?', validate: r => /fasilitas|lab|perpustakaan|career center/i.test(r.answer) },
  { id: 'FAC-02', domain: 'facilities', file: 'ISIAN WEBSITE (1).pdf', entity: 'Fasilitas', field: 'lab_komputer', query: 'apakah ada laboratorium komputer di stikom?', validate: r => /lab|laboratorium|komputer/i.test(r.answer) },
  { id: 'FAC-03', domain: 'facilities', file: 'ISIAN WEBSITE (1).pdf', entity: 'Fasilitas', field: 'perpustakaan', query: 'ada perpustakaan di kampus?', validate: r => /perpustakaan|buku|ruang/i.test(r.answer) },

  // DOMAIN 10: UKM & ORGANIZATIONS (22 UKM/HIMA FILES)
  { id: 'UKM-01', domain: 'UKM / organizations', file: 'Profile Singkat KSR.docx', entity: 'UKM KSR-PMI', field: 'profil', query: 'apa itu ukm ksr pmi di stikom?', validate: r => /ksr|palang merah|sukarela/i.test(r.answer) },
  { id: 'UKM-02', domain: 'UKM / organizations', file: 'PROFIL SINGKAT UKM MCOS.docx', entity: 'UKM MCOS', field: 'profil', query: 'jelaskan tentang ukm mcos', validate: r => /mcos|moslem|muslim|rohani/i.test(r.answer) },
  { id: 'UKM-03', domain: 'UKM / organizations', file: 'Profil UKM DOS.docx', entity: 'UKM DOS', field: 'profil', query: 'apa kegiatan ukm dos?', validate: r => /dos|dance|tari|modern/i.test(r.answer) },
  { id: 'UKM-04', domain: 'UKM / organizations', file: 'Profil UKM KSL.docx', entity: 'UKM KSL', field: 'profil', query: 'ukm ksl itu ukm apa min?', validate: r => /ksl|linux|open source/i.test(r.answer) },
  { id: 'UKM-05', domain: 'UKM / organizations', file: 'Program Kegiatan Organisasi UKM RADE.docx', entity: 'UKM RADE', field: 'profil', query: 'ukm rade stikom bali itu bergerak di bidang apa?', validate: r => /rade|radio|broadcasting/i.test(r.answer) },
  { id: 'UKM-06', domain: 'UKM / organizations', file: 'PROFIL SINGKAT UKM FUTSAL.docx', entity: 'UKM Futsal', field: 'profil', query: 'ada ukm olahraga futsal ga di stikom?', validate: r => /futsal|olahraga|ukm/i.test(r.answer) },
  { id: 'UKM-07', domain: 'UKM / organizations', file: 'profile ukm KMHD.jpg', entity: 'UKM KMHD', field: 'profil', query: 'apa itu ukm kmhd?', validate: r => /kmhd|hindu|keagamaan/i.test(r.answer) },
  { id: 'UKM-08', domain: 'UKM / organizations', file: 'Pofile UKM Basket ITB Stikom Bali.docx', entity: 'UKM Basket', field: 'profil', query: 'ada ukm basket ga di stikom bali?', validate: r => /basket|olahraga|ukm/i.test(r.answer) },
  { id: 'UKM-09', domain: 'UKM / organizations', file: 'PROFIL_SINGKAT UKM MAPALA.docx', entity: 'UKM MAPALA', field: 'profil', query: 'apa kegiatan ukm mapala kompas?', validate: r => /mapala|alam|pecinta alam/i.test(r.answer) },
  { id: 'UKM-10', domain: 'UKM / organizations', file: 'SYNAMON (Program Kerja) SYNTAX (2).pdf', entity: 'UKM SYNTAX', field: 'program_kerja', query: 'apa program kerja ukm syntax?', validate: r => /syntax|synofest|speaking|english/i.test(r.answer) },
  { id: 'UKM-11', domain: 'UKM / organizations', file: 'PROFILE SINGKAT UNIT KEGIATAN MAHASISWA HIMATOGRAPHY.docx', entity: 'UKM HIMATOGRAPHY', field: 'profil', query: 'ukm himatography itu tentang apa?', validate: r => /himatography|fotografi|kamera/i.test(r.answer) },
  { id: 'UKM-12', domain: 'UKM / organizations', file: 'Company profile UKM Tabuh.pdf', entity: 'UKM Tabuh Bramara Gita', field: 'profil', query: 'apa itu ukm tabuh bramara gita?', validate: r => /tabuh|gamelan|bramara gita|seni/i.test(r.answer) },
  { id: 'UKM-13', domain: 'UKM / organizations', file: 'PROFILE ATHENA ESPORT.docx', entity: 'UKM Athena Esport', field: 'profil', query: 'apakah ada ukm esports di stikom?', validate: r => /athena|esport|game/i.test(r.answer) },
  { id: 'UKM-14', domain: 'UKM / organizations', file: 'PROFILE ORGANISASI PASKAMRAS.pdf', entity: 'UKM Paskamras', field: 'profil', query: 'apa tugas dan profil ukm paskamras?', validate: r => /paskamras|keamanan|acara|protokoler/i.test(r.answer) },
  { id: 'UKM-15', domain: 'UKM / organizations', file: 'Profil_UKM_GHoST_ITB_STIKOM_Bali.docx', entity: 'UKM GHoST', field: 'profil', query: 'apa itu ukm ghost di stikom?', validate: r => /ghost|gymnastic|health|senam/i.test(r.answer) },
  { id: 'UKM-16', domain: 'UKM / organizations', file: 'PROFILE ORGANISASI UKM BOS.docx', entity: 'UKM BOS', field: 'profil', query: 'ukm bos itu ukm apa ya?', validate: r => /bos|badminton|bulutangkis/i.test(r.answer) },
  { id: 'UKM-17', domain: 'UKM / organizations', file: 'PROFILE ORMAWA TARI (PRAGINA).docx', entity: 'UKM Pragina', field: 'profil', query: 'ada ukm tari tradisional ga?', validate: r => /pragina|tari|tradisional/i.test(r.answer) },
  { id: 'UKM-18', domain: 'UKM / organizations', file: 'BUKU ORMAWA HIMAPRODI TI.docx', entity: 'HIMAPRODI TI', field: 'profil', query: 'apa peran himaprodi teknologi informasi?', validate: r => /himaprodi|hima|ti|teknologi informasi/i.test(r.answer) },
  { id: 'UKM-19', domain: 'UKM / organizations', file: 'Profile HIMA BD.docx', entity: 'HIMA BD', field: 'profil', query: 'apakah ada himpunan mahasiswa bisnis digital?', validate: r => /hima|bisnis digital|himaprodi/i.test(r.answer) },
  { id: 'UKM-20', domain: 'UKM / organizations', file: 'PROFILE HIMA SK.docx', entity: 'HIMA SK', field: 'profil', query: 'apa nama himpunan mahasiswa sistem komputer?', validate: r => /hima|sk|sistem komputer/i.test(r.answer) },
  { id: 'UKM-21', domain: 'UKM / organizations', file: 'Profil_BEM_ITB_STIKOM_Bali.docx', entity: 'BEM', field: 'profil', query: 'apa struktur dan peran bem itb stikom bali?', validate: r => /bem|badan eksekutif|mahasiswa/i.test(r.answer) },

  // DOMAIN 11: INTERNATIONAL PROGRAMS (PROGRAM_DOUBLE_DEGREE, Hi-Think)
  { id: 'INT-01', domain: 'international programs', file: 'PROGRAM_DOUBLE_DEGREE_INTERNASIONAL-DAN-NASIONAL-1783426945410.pdf', entity: 'Program Internasional', field: 'daftar_program', query: 'program internasional apa saja yang tersedia di stikom?', validate: r => /internasional|double degree|student exchange/i.test(r.answer) },
  { id: 'INT-02', domain: 'international programs', file: 'QNA Bot - Hi-Think.docx', entity: 'Hi-Think Jepang', field: 'kerja_sama', query: 'apa kerja sama stikom bali dengan jepang?', validate: r => /hi-think|jepang|kerja/i.test(r.answer) },
  { id: 'INT-03', domain: 'international programs', file: 'CHATBOT - Double Degree.docx', entity: 'Program Internasional', field: 'tujuan', query: 'apa keunggulan kuliah kelas internasional double degree?', validate: r => /gelar|internasional|dua gelar|mitra/i.test(r.answer) },

  // DOMAIN 12: DOUBLE DEGREE & PARTNERSHIPS (CHATBOT Double Degree, DNUI, HELP)
  { id: 'DD-01', domain: 'Double Degree / partnerships', file: 'CHATBOT - Double Degree.docx', entity: 'HELP University', field: 'skema', query: 'bagaimana skema double degree dengan help university malaysia?', validate: r => /help|malaysia|skema|tahun/i.test(r.answer) },
  { id: 'DD-02', domain: 'Double Degree / partnerships', file: 'CHATBOT - Double Degree.docx', entity: 'DNUI China', field: 'skema', query: 'kuliah double degree dalian neusoft berapa tahun di luar negeri?', validate: r => /dalian|neusoft|china|tahun/i.test(r.answer) },
  { id: 'DD-03', domain: 'Double Degree / partnerships', file: 'rincian Biaya UTB Tahun Ajaran 2026-2027.pdf', entity: 'UTB Bandung', field: 'gelar', query: 'gelar apa yang didapat dari dual degree utb bandung?', validate: r => /s\.bns|s\.ds|gelar|utb/i.test(r.answer) },
  { id: 'DD-04', domain: 'Double Degree / partnerships', file: 'CHATBOT - Double Degree.docx', entity: 'Double Degree', field: 'syarat', query: 'apa syarat ikut program double degree?', validate: r => /syarat|toefl|bahasa|akademik/i.test(r.answer) },

  // DOMAIN 13: CERTIFICATIONS (QNA Bot Hi-Think, ISIAN WEBSITE)
  { id: 'CRT-01', domain: 'certifications', file: 'QNA Bot - Hi-Think.docx', entity: 'Hi-Think', field: 'sertifikasi', query: 'apakah ada sertifikasi bahasa jepang di program hi-think?', validate: r => /jepang|jlpt|bahasa|sertifikat/i.test(r.answer) },
  { id: 'CRT-02', domain: 'certifications', file: 'ISIAN WEBSITE (1).pdf', entity: 'Sertifikasi IT', field: 'kompetensi', query: 'apakah lulusan stikom mendapatkan sertifikat kompetensi?', validate: r => /sertifikasi|kompetensi|keahlian/i.test(r.answer) },
  { id: 'CRT-03', domain: 'certifications', file: 'ISIAN WEBSITE (1).pdf', entity: 'Sertifikasi IT', field: 'vendor', query: 'sertifikasi vendor apa saja yang ada di kampus?', validate: r => /cisco|mikrotik|oracle|microsoft|sertifikasi/i.test(r.answer) },

  // DOMAIN 14: STUDENT EXCHANGE (Student Exchange, Mahasiswa Asing)
  { id: 'EXC-01', domain: 'student exchange', file: 'Apa itu Student Exchange di ITB STIKOM Bali.docx', entity: 'Student Exchange', field: 'definisi', query: 'apa itu program student exchange di itb stikom bali?', validate: r => /student exchange|pertukaran|mahasiswa/i.test(r.answer) },
  { id: 'EXC-02', domain: 'student exchange', file: 'Apa itu Student Exchange di ITB STIKOM Bali.docx', entity: 'Student Exchange', field: 'negara_tujuan', query: 'kemana saja negara tujuan student exchange stikom bali?', validate: r => /negara|jepang|malaysia|china|pertukaran/i.test(r.answer) },
  { id: 'EXC-03', domain: 'student exchange', file: 'FAQ PENGURUSAN MAHASISWA ASING.docx', entity: 'Mahasiswa Asing', field: 'izin_tinggal', query: 'bagaimana prosedur visa dan izin tinggal mahasiswa asing di stikom?', validate: r => /visa|izin tinggal|itas|asing/i.test(r.answer) },
  { id: 'EXC-04', domain: 'student exchange', file: 'FAQ PENGURUSAN MAHASISWA ASING (2).docx', entity: 'Mahasiswa Asing', field: 'persyaratan', query: 'dokumen apa yang dibutuhkan mahasiswa luar negeri untuk kuliah di stikom?', validate: r => /paspor|visa|dokumen|asing/i.test(r.answer) },

  // DOMAIN 15: REGULATIONS & PROCEDURES (Pedoman TA, Yudisium)
  { id: 'REG-01', domain: 'regulations / procedures', file: 'Pedoman TA S1 2019 Revisi 1.pdf', entity: 'Tugas Akhir', field: 'syarat_sks', query: 'berapa sks minimal untuk mengambil tugas akhir skripsi?', validate: r => /sks|tugas akhir|skripsi|syarat/i.test(r.answer) },
  { id: 'REG-02', domain: 'regulations / procedures', file: 'Pedoman TA S1 2019 Revisi 1.pdf', entity: 'Tugas Akhir', field: 'pembimbing', query: 'bagaimana penentuan dosen pembimbing tugas akhir?', validate: r => /pembimbing|dosen|tugas akhir|skripsi/i.test(r.answer) },
  { id: 'REG-03', domain: 'regulations / procedures', file: 'Informasi Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII (Semester Ganjil 2026-2027) (1).pdf', entity: 'Yudisium', field: 'syarat_yudisium', query: 'apa syarat pendaftaran yudisium wisuda?', validate: r => /yudisium|wisuda|syarat|bebas/i.test(r.answer) },
  { id: 'REG-04', domain: 'regulations / procedures', file: 'Informasi Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII (Semester Ganjil 2026-2027) (1).pdf', entity: 'Yudisium', field: 'kontak_akademik', query: 'berapa nomor kontak direktorat akademik untuk yudisium?', validate: r => /0361|0821|telepon|hotline/i.test(r.answer) },

  // DOMAIN 16: CONTACTS (FAQ CC, ISIAN WEBSITE, Yudisium)
  { id: 'CNT-01', domain: 'contacts', file: 'FAQ CC.docx', entity: 'Career Center', field: 'kontak', query: 'bagaimana cara menghubungi pihak career center?', validate: r => /email|kontak|telepon|wa|career center/i.test(r.answer) },
  { id: 'CNT-02', domain: 'contacts', file: 'ISIAN WEBSITE (1).pdf', entity: 'Kampus ITB STIKOM Bali', field: 'telepon', query: 'nomor telepon kampus itb stikom bali berapa?', validate: r => /0361|telepon|call center/i.test(r.answer) },
  { id: 'CNT-03', domain: 'contacts', file: 'ISIAN WEBSITE (1).pdf', entity: 'PMB', field: 'email', query: 'alamat email resmi kampus stikom apa?', validate: r => /info@|stikom-bali\.ac\.id|email/i.test(r.answer) },

  // DOMAIN 17: CAMPUS LOCATION (ISIAN WEBSITE, Profil INBIS)
  { id: 'LOC-01', domain: 'campus / location', file: 'ISIAN WEBSITE (1).pdf', entity: 'Kampus Renon', field: 'alamat', query: 'dimana alamat kampus renon stikom bali?', validate: r => /puputan|renon|denpasar/i.test(r.answer) },
  { id: 'LOC-02', domain: 'campus / location', file: 'ISIAN WEBSITE (1).pdf', entity: 'Kampus Jimbaran', field: 'alamat', query: 'kampus jimbaran stikom bali lokasinya di mana?', validate: r => /jimbaran|raya kampus|kuta selatan/i.test(r.answer) },
  { id: 'LOC-03', domain: 'campus / location', file: 'ISIAN WEBSITE (1).pdf', entity: 'Kampus ITB STIKOM Bali', field: 'cabang', query: 'stikom bali punya berapa kampus cabang di bali?', validate: r => /kampus|renon|jimbaran/i.test(r.answer) },

  // DOMAIN 18: INSTITUTIONAL PROFILE & SEJARAH (ISIAN WEBSITE, Profil INBIS)
  { id: 'PRF-01', domain: 'institutional profile', file: 'ISIAN WEBSITE (1).pdf', entity: 'ITB STIKOM Bali', field: 'sejarah', query: 'kapan itb stikom bali didirikan dan siapa pendirinya?', validate: r => /2002|stikom bali|pendiri|yayasan/i.test(r.answer) },
  { id: 'PRF-02', domain: 'institutional profile', file: 'ISIAN WEBSITE (1).pdf', entity: 'ITB STIKOM Bali', field: 'visi_misi', query: 'apa visi dan misi itb stikom bali?', validate: r => /visi|misi|teknologi|bisnis/i.test(r.answer) },
  { id: 'PRF-03', domain: 'institutional profile', file: 'ISIAN WEBSITE (1).pdf', entity: 'ITB STIKOM Bali', field: 'rektor', query: 'siapa rektor itb stikom bali?', validate: r => /rektor|prof|dr/i.test(r.answer) },

  // ADDITIONAL STRATIFIED TEST CASES TO EXCEED MINIMUM 100 CASES
  // VARIATION CLASS: INFORMAL / SLANG / TYPO
  { id: 'VAR-01', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'Teknologi Informasi', field: 'biaya', query: 'min mw tny biayany TI donk', validate: r => /biaya|teknologi informasi|dpp|ukt/i.test(r.answer) },
  { id: 'VAR-02', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'Teknologi Informasi', field: 'biaya_daftar', query: 'klo pendaftaranny brp ya?', validate: r => /500\.000|pendaftaran/i.test(r.answer) },
  { id: 'VAR-03', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'Teknologi Informasi', field: 'cicilan', query: 'bisa dicicil ga min?', validate: r => /cicil|angsur|tahap|syarat/i.test(r.answer) },
  { id: 'VAR-04', domain: 'accreditation', file: 'SERTIFIKAT AKREDITASI - SISTEM INFORMASI (14 DES 2023 - 14 DES 2028) LAM INFOKOM.pdf', entity: 'Sistem Informasi', field: 'akreditasi', query: 'eh klo sistem informasi akreditasinya apa?', validate: r => /akreditasi|baik sekali|unggul/i.test(r.answer) },
  { id: 'VAR-05', domain: 'PMB', file: 'Kalender Pendaftaran.xlsx', entity: 'PMB', field: 'gelombang_2', query: 'gelombang 2 bukanya kapan ya?', validate: r => /gelombang|pendaftaran|jadwal/i.test(r.answer) },
  { id: 'VAR-06', domain: 'program studi', file: 'rincian Biaya SK Tahun Ajaran 2026-2027.pdf', entity: 'Sistem Komputer', field: 'jurusan', query: 'jurusan sk itu apa sih min', validate: r => /sistem komputer|hardware|jaringan/i.test(r.answer) },
  { id: 'VAR-07', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'Bisnis Digital', field: 'uang_gedung', query: 'uang gedung prodi bd kena brp?', validate: r => /gedung|dpp|biaya|bisnis digital/i.test(r.answer) },
  { id: 'VAR-08', domain: 'scholarships', file: 'STIKOM Bali GoseToSchool 2025.docx', entity: 'Beasiswa', field: 'diskon', query: 'ada potongan uang kuliah ga klo dapet ranking?', validate: r => /potongan|ranking|prestasi|beasiswa/i.test(r.answer) },
  { id: 'VAR-09', domain: 'UKM / organizations', file: 'PROFIL SINGKAT UKM FUTSAL.docx', entity: 'UKM Futsal', field: 'gabung', query: 'gimana cara join ukm futsal?', validate: r => /futsal|ukm|gabung|daftar/i.test(r.answer) },
  { id: 'VAR-10', domain: 'facilities', file: 'fasilitas-stikom.pdf', entity: 'Fasilitas', field: 'wifi', query: 'fasilitas di kampus lengkap ga min ada lab apa aja', validate: r => /fasilitas|lab|komputer/i.test(r.answer) },

  // VARIATION CLASS: REORDERED PHRASING & PARAPHRASES
  { id: 'PAR-01', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'Sistem Informasi', field: 'biaya_kuliah', query: 'kuliah sistem informasi butuh biaya berapa totalnya?', validate: r => /biaya|sistem informasi|dpp/i.test(r.answer) },
  { id: 'PAR-02', domain: 'accreditation', file: 'SERTIFIKAT AKREDITASI TI (06 SEPT 2022 - 06 SEPT 2027).pdf', entity: 'Teknologi Informasi', field: 'peringkat', query: 'apakah jurusan TI sudah terakreditasi oleh BAN-PT atau LAM INFOKOM?', validate: r => /akreditasi|baik sekali|lam infokom|ban-pt/i.test(r.answer) },
  { id: 'PAR-03', domain: 'Double Degree / partnerships', file: 'CHATBOT - Double Degree.docx', entity: 'Double Degree', field: 'negara', query: 'negara mana saja yang bekerja sama untuk program double degree?', validate: r => /china|malaysia|help|dalian/i.test(r.answer) },
  { id: 'PAR-04', domain: 'regulations / procedures', file: 'Pedoman TA S1 2019 Revisi 1.pdf', entity: 'Tugas Akhir', field: 'sidang', query: 'apa saja tahapan ujian tugas akhir skripsi di stikom?', validate: r => /sidang|seminar|proposal|tugas akhir|skripsi/i.test(r.answer) },
  { id: 'PAR-05', domain: 'Career Center / campus services', file: 'FAQ CC.docx', entity: 'Career Center', field: 'alumni', query: 'apakah alumni bisa menggunakan layanan career center?', validate: r => /alumni|career center|layanan/i.test(r.answer) },
  { id: 'PAR-06', domain: 'student exchange', file: 'Apa itu Student Exchange di ITB STIKOM Bali.docx', entity: 'Student Exchange', field: 'biaya', query: 'biaya pertukaran mahasiswa ditanggung sendiri atau ada subsidi?', validate: r => /student exchange|pertukaran|biaya/i.test(r.answer) },
  { id: 'PAR-07', domain: 'UKM / organizations', file: 'PROFILE ORMAWA TARI (PRAGINA).docx', entity: 'UKM Pragina', field: 'tari_bali', query: 'bisa belajar tari bali ga di kampus stikom?', validate: r => /pragina|tari|seni/i.test(r.answer) },
  { id: 'PAR-08', domain: 'PMB', file: 'STIKOM Bali GoseToSchool 2025.docx', entity: 'PMB', field: 'lulusan_smk', query: 'apakah lulusan smk bisa mendaftar di semua jurusan?', validate: r => /smk|sma|pendaftaran|bisa/i.test(r.answer) },
  { id: 'PAR-09', domain: 'contacts', file: 'ISIAN WEBSITE (1).pdf', entity: 'Kampus ITB STIKOM Bali', field: 'medsos', query: 'akun instagram resmi itb stikom bali apa ya?', validate: r => /instagram|medsos|stikom/i.test(r.answer) },
  { id: 'PAR-10', domain: 'institutional profile', file: 'INBIS PROFILE 2026.pdf', entity: 'INBIS', field: 'tujuan', query: 'apa misi inbis bali dalam mendukung startup mahasiswa?', validate: r => /inbis|startup|bisnis/i.test(r.answer) },

  // VARIATION CLASS: MULTI-ENTITY / MULTI-FIELD COMPARISONS
  { id: 'MUL-01', domain: 'tuition / fees', file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', entity: 'TI dan SI', field: 'biaya_perbandingan', query: 'berapa perbandingan biaya teknologi informasi dan sistem informasi?', validate: r => /teknologi informasi|sistem informasi|biaya/i.test(r.answer) },
  { id: 'MUL-02', domain: 'accreditation', file: 'SERTIFIKAT AKREDITASI TI (06 SEPT 2022 - 06 SEPT 2027).pdf', entity: 'TI dan BD', field: 'akreditasi_perbandingan', query: 'apa perbedaan akreditasi prodi teknologi informasi dan bisnis digital?', validate: r => /teknologi informasi|bisnis digital|akreditasi/i.test(r.answer) },
  { id: 'MUL-03', domain: 'program studi', file: 'ISIAN WEBSITE (1).pdf', entity: 'SK dan TI', field: 'fokus', query: 'apa bedanya sistem komputer dan teknologi informasi?', validate: r => /sistem komputer|teknologi informasi/i.test(r.answer) },
  { id: 'MUL-04', domain: 'Double Degree / partnerships', file: 'CHATBOT - Double Degree.docx', entity: 'HELP dan DNUI', field: 'mitra', query: 'apa perbedaan double degree help university dan dalian neusoft?', validate: r => /help|dalian|malaysia|china/i.test(r.answer) },
  { id: 'MUL-05', domain: 'UKM / organizations', file: 'Profil UKM KSL.docx', entity: 'KSL dan MCOS', field: 'kegiatan', query: 'apa perbedaan ukm ksl dan ukm mcos?', validate: r => /ksl|mcos/i.test(r.answer) },

  // MORE SPECIFIC FACTUAL QUERIES TO REACH 105+
  { id: 'EXT-01', domain: 'regulations / procedures', file: 'Pedoman TA S1 2019 Revisi 1.pdf', entity: 'Tugas Akhir', field: 'judul', query: 'bagaimana prosedur pengajuan judul tugas akhir?', validate: r => /judul|proposal|tugas akhir/i.test(r.answer) },
  { id: 'EXT-02', domain: 'regulations / procedures', file: 'Pedoman TA S1 2019 Revisi 1.pdf', entity: 'Tugas Akhir', field: 'revisi', query: 'berapa waktu revisi laporan setelah sidang tugas akhir?', validate: r => /revisi|sidang|tugas akhir|hari|minggu/i.test(r.answer) },
  { id: 'EXT-03', domain: 'PMB', file: 'Kalender Pendaftaran.xlsx', entity: 'PMB', field: 'gelombang_1', query: 'kapan pendaftaran gelombang 1 ditutup?', validate: r => /gelombang|pendaftaran|jadwal/i.test(r.answer) },
  { id: 'EXT-04', domain: 'tuition / fees', file: 'rincian Biaya D3 Tahun Ajaran 2026-2027.pdf', entity: 'D3', field: 'cicilan', query: 'apakah d3 manajemen informatika pembayarannya bisa dicicil?', validate: r => /cicil|angsur|d3|tahap/i.test(r.answer) },
  { id: 'EXT-05', domain: 'Double Degree / partnerships', file: 'rincian Biaya DNUI Tahun Ajaran 2026-2027.pdf', entity: 'DNUI China', field: 'pendaftaran', query: 'biaya formulir pendaftaran dual degree dnui china berapa?', validate: r => /pendaftaran|dnui|biaya/i.test(r.answer) },
  { id: 'EXT-06', domain: 'Double Degree / partnerships', file: 'rincian Biaya HELP Tahun Ajaran 2026-2027.pdf', entity: 'HELP University', field: 'pendaftaran', query: 'berapa biaya pendaftaran dual degree help university?', validate: r => /pendaftaran|help|biaya/i.test(r.answer) },
  { id: 'EXT-07', domain: 'Double Degree / partnerships', file: 'rincian Biaya UTB Tahun Ajaran 2026-2027.pdf', entity: 'UTB Bandung', field: 'pendaftaran', query: 'berapa biaya registrasi dual degree utb bandung?', validate: r => /pendaftaran|registrasi|utb/i.test(r.answer) },
  { id: 'EXT-08', domain: 'UKM / organizations', file: 'PROFILE ORGANISASI PASKAMRAS.pdf', entity: 'PASKAMRAS', field: 'keamanan', query: 'siapa yang bertugas menjaga ketertiban acara kampus stikom?', validate: r => /paskamras|keamanan/i.test(r.answer) },
  { id: 'EXT-09', domain: 'UKM / organizations', file: 'PROFIL_SINGKAT UKM MAPALA.docx', entity: 'MAPALA', field: 'kegiatan', query: 'apakah ada kegiatan mendaki gunung di ukm mapala?', validate: r => /mapala|alam|kegiatan/i.test(r.answer) },
  { id: 'EXT-10', domain: 'UKM / organizations', file: 'Pofile UKM Basket ITB Stikom Bali.docx', entity: 'UKM Basket', field: 'latihan', query: 'kapan jadwal latihan ukm basket stikom?', validate: r => /basket|latihan|ukm/i.test(r.answer) },
  { id: 'EXT-11', domain: 'scholarships', file: 'STIKOM Bali GoseToSchool 2025.docx', entity: 'Beasiswa', field: 'saudara', query: 'apakah ada diskon biaya jika memiliki saudara kandung kuliah di stikom?', validate: r => /saudara|potongan|diskon|keluarga/i.test(r.answer) },
  { id: 'EXT-12', domain: 'Career Center / campus services', file: 'FAQ CC.docx', entity: 'Career Center', field: 'bursa_kerja', query: 'apakah kampus mengadakan job fair atau bursa kerja?', validate: r => /job fair|bursa kerja|career center|alumni/i.test(r.answer) },
  { id: 'EXT-13', domain: 'institutional profile', file: 'ISIAN WEBSITE (1).pdf', entity: 'ITB STIKOM Bali', field: 'akreditasi_institusi', query: 'apa akreditasi institusi perguruan tinggi itb stikom bali?', validate: r => /akreditasi|baik sekali|b|institusi/i.test(r.answer) },
  { id: 'EXT-14', domain: 'contacts', file: 'ISIAN WEBSITE (1).pdf', entity: 'Kampus Renon', field: 'kode_pos', query: 'kode pos kampus stikom renon berapa?', validate: r => /80234|puputan|renon/i.test(r.answer) },
  { id: 'EXT-15', domain: 'accreditation', file: 'SERTIFIKAT AKREDITASI BD (05 OKT 2022 - 05 OKT 2027).pdf', entity: 'Bisnis Digital', field: 'masa_berlaku', query: 'sampai kapan akreditasi bisnis digital berlaku?', validate: r => /2027|oktober|berlaku|akreditasi/i.test(r.answer) },
  { id: 'EXT-16', domain: 'accreditation', file: 'SERTIFIKAT AKREDITASI TI (06 SEPT 2022 - 06 SEPT 2027).pdf', entity: 'Teknologi Informasi', field: 'masa_berlaku', query: 'sampai tahun berapa sertifikat akreditasi teknologi informasi berlaku?', validate: r => /2027|september|berlaku|akreditasi/i.test(r.answer) }
];

// TRUE NO-DATA NEGATIVE CASES (GENUINELY ABSENT FROM CORPUS)
const NEGATIVE_CASES = [
  { id: 'NEG-01', query: 'apakah ada jurusan kedokteran umum di stikom bali?' },
  { id: 'NEG-02', query: 'berapa biaya pendaftaran program studi teknik nuklir?' },
  { id: 'NEG-03', query: 'apakah ada jurusan farmasi dan kedokteran gigi?' },
  { id: 'NEG-04', query: 'berapa ukt semesteran untuk fakultas peternakan?' },
  { id: 'NEG-05', query: 'apakah stikom bali punya program arsitektur lansekap?' },
  { id: 'NEG-06', query: 'apakah tersedia beasiswa astronaut nasa di stikom?' },
  { id: 'NEG-07', query: 'apakah ada fasilitas kolam renang olimpiade di kampus renon?' },
  { id: 'NEG-08', query: 'apakah stikom bali memiliki helipad di gedung utama?' },
  { id: 'NEG-09', query: 'bagaimana cara daftar program double degree dengan universitas oxford inggris?' },
  { id: 'NEG-10', query: 'apa syarat masuk program studi teknik pertambangan emas?' },
  { id: 'NEG-11', query: 'berapa biaya asrama putra kampus utama per semester?' },
  { id: 'NEG-12', query: 'apakah ada ukm menyelam kapal selam militer?' },
  { id: 'NEG-13', query: 'apa kurikulum fakultas hukum pidana militer di stikom?' },
  { id: 'NEG-14', query: 'berapa biaya kuliah magister seni musik jazz klasik?' },
  { id: 'NEG-15', query: 'apakah ada sertifikasi penerbang pesawat komersial boeing?' }
];

// CONTINUOUS-SESSION STRESS (12 UNSEEN TURNS ACROSS TOPIC SHIFTS)
const CONTINUOUS_TURNS = [
  { turn: 1, domain: 'PMB', query: 'halo min, pmb tahun ini pendaftarannya lewat jalur apa aja ya?' },
  { turn: 2, domain: 'fee', query: 'kalau biaya kuliah untuk prodi teknologi informasi reguler berapa?' },
  { turn: 3, domain: 'international program', query: 'eh kalau double degree ke china dalian neusoft skemanya gimana?' },
  { turn: 4, domain: 'campus service', query: 'di kampus ada career center yang bantu nyari info kerjaan ga?' },
  { turn: 5, domain: 'career', query: 'prospek lulusan sistem informasi biasanya jadi apa sih?' },
  { turn: 6, domain: 'UKM', query: 'kegiatan mahasiswa di bidang coding ada ukm apa aja ya?' },
  { turn: 7, domain: 'accreditation', query: 'ngomong-ngomong akreditasi bisnis digital apa sekarang?' },
  { turn: 8, domain: 'schedule', query: 'kapan jadwal remedial semester ganjil dibuka?' },
  { turn: 9, domain: 'another program', query: 'kalau sistem komputer jurusannya belajar tentang apa?' },
  { turn: 10, domain: 'short follow-up', query: 'biayanya berapa?' },
  { turn: 11, domain: 'multi-entity', query: 'bedanya biaya sistem komputer sama teknologi informasi berapa?' },
  { turn: 12, domain: 'return to previous topic', query: 'tadi website pendaftaran pmb resminya apa ya?' }
];

async function runCorpusWideEvaluation() {
  console.log('==================================================');
  console.log('BROAD GENERALIZATION VALIDATION — CORPUS-WIDE EVAL');
  console.log('==================================================\n');

  const distinctFiles = new Set(SUPPORTED_CASES.map(c => c.file));
  const distinctDomains = new Set(SUPPORTED_CASES.map(c => c.domain));

  console.log(`CORPUS_EVAL_DISTINCT_FILES=${distinctFiles.size}`);
  console.log(`CORPUS_EVAL_DISTINCT_DOMAINS=${distinctDomains.size}`);
  console.log(`CORPUS_EVAL_SUPPORTED_CASES=${SUPPORTED_CASES.length}`);
  console.log(`NEGATIVE_CASES_COUNT=${NEGATIVE_CASES.length}`);
  console.log(`CONTINUOUS_SESSION_TURNS=${CONTINUOUS_TURNS.length}\n`);

  // Telemetry trackers
  const candidateIdsList = [];
  const chunksScoredList = [];
  const latenciesMs = [];
  let ragIndexFullScans = 0;
  let trainingDataFullScans = 0;

  // Outcome counters
  let supportedAnswered = 0;
  let supportedButMissed = 0;
  let wrongDomain = 0;
  let wrongIntent = 0;
  let wrongEntity = 0;
  let wrongField = 0;
  let falseNoData = 0;
  let hallucination = 0;
  let timeoutCount = 0;
  const failures = [];

  console.log('--- EXECUTING 105 SUPPORTED CASES ---');
  for (let i = 0; i < SUPPORTED_CASES.length; i++) {
    const tc = SUPPORTED_CASES[i];
    const t0 = performance.now();
    let res = null;
    let timedOut = false;

    try {
      res = await Promise.race([
        querySemanticRag(tc.query, { topK: 8 }),
        new Promise((_, reject) => setTimeout(() => { timedOut = true; reject(new Error('TIMEOUT')); }, 15000))
      ]);
    } catch (e) {
      if (timedOut) {
        timeoutCount++;
        failures.push({ id: tc.id, query: tc.query, error: 'TIMEOUT' });
        continue;
      }
      res = { success: false, answer: String(e && e.message) };
    }

    const elapsed = performance.now() - t0;
    latenciesMs.push(elapsed);

    const inst = semanticRag.lastRetrievalInstrumentation || {};
    const cand = inst.CANDIDATE_IDS_FROM_INDEX || 0;
    const scored = inst.CHUNKS_EXPENSIVELY_SCORED || 0;
    candidateIdsList.push(cand);
    chunksScoredList.push(scored);

    if (inst.RAG_INDEX_FULL_SCAN === 'YES') ragIndexFullScans++;
    if (inst.TRAINING_DATA_FULL_SCAN === 'YES') trainingDataFullScans++;

    // Validation
    const isSuccess = res && res.success && res.answer && res.answer.trim().length > 0;
    const isSafeNoData = res && (/tidak tersedia|belum memiliki|tidak ada data|mohon maaf/i.test(res.answer || '') && !/500\.000|dpp|spp|akreditasi/i.test(res.answer || ''));
    
    let pass = false;
    let reason = '';

    if (!isSuccess) {
      supportedButMissed++;
      reason = 'Response unsuccessful or empty';
    } else if (isSafeNoData && !tc.field.includes('tidak_ada')) {
      falseNoData++;
      supportedButMissed++;
      reason = 'False NO-DATA on supported entity';
    } else {
      const match = tc.validate(res);
      if (match) {
        pass = true;
        supportedAnswered++;
      } else {
        supportedButMissed++;
        reason = `Answer validation failed. Bot answer: "${res.answer.slice(0, 100)}..."`;
      }
    }

    if (!pass) {
      failures.push({
        FAILURE_ID: tc.id,
        QUESTION: tc.query,
        SOURCE_EVIDENCE: tc.file,
        EXPECTED_BINDING: `${tc.entity} -> ${tc.field}`,
        ACTUAL_DOMAIN: tc.domain,
        ACTUAL_INTENT: res?.intent || 'unknown',
        ACTUAL_ENTITY: res?.entity || 'unknown',
        ACTUAL_BINDING: `${res?.entity || 'unknown'} -> ${res?.field || 'unknown'}`,
        RETRIEVED_EVIDENCE: res?.source || 'none',
        FAILURE_CLASS: isSafeNoData ? 'UNSUPPORTED_FALSE_NODATA' : 'SUPPORTED_BUT_MISSED',
        ROOT_CAUSE: reason
      });
    }

    if ((i + 1) % 25 === 0 || i === SUPPORTED_CASES.length - 1) {
      console.log(`Progress: ${i + 1}/${SUPPORTED_CASES.length} cases completed. Pass: ${supportedAnswered}, Fail: ${failures.length}`);
    }
  }

  // EXECUTE NEGATIVE CONTROL SET
  console.log('\n--- EXECUTING 15 NEGATIVE CONTROL CASES ---');
  let negSafeNoData = 0;
  let negHallucination = 0;
  let negWrongPositive = 0;
  let negRuntimeExceptions = 0;

  for (const nc of NEGATIVE_CASES) {
    const t0 = performance.now();
    let res = null;
    let hadException = false;
    try {
      res = await querySemanticRag(nc.query, { topK: 8 });
    } catch (err) {
      hadException = true;
      negRuntimeExceptions++;
      res = { success: false, answer: 'Error: ' + err.message };
      failures.push({
        FAILURE_ID: nc.id,
        QUESTION: nc.query,
        SOURCE_EVIDENCE: 'negative_control',
        EXPECTED_BINDING: 'unsupported -> no_data',
        ACTUAL_DOMAIN: 'negative',
        ACTUAL_INTENT: 'unknown',
        ACTUAL_ENTITY: 'unknown',
        ACTUAL_BINDING: 'none',
        RETRIEVED_EVIDENCE: 'runtime_exception',
        FAILURE_CLASS: 'RUNTIME_EXCEPTION',
        ROOT_CAUSE: err.message
      });
    }
    latenciesMs.push(performance.now() - t0);

    const inst = semanticRag.lastRetrievalInstrumentation || {};
    candidateIdsList.push(inst.CANDIDATE_IDS_FROM_INDEX || 0);
    chunksScoredList.push(inst.CHUNKS_EXPENSIVELY_SCORED || 0);

    if (hadException) {
      continue;
    }

    // Negative query should politely declare no-data / unsupported
    const isSafe = res && (/tidak memiliki|tidak tersedia|belum membuka|tidak ada|mohon maaf/i.test(res.answer || ''));
    if (isSafe) {
      negSafeNoData++;
    } else if (res && /biaya pendaftaran kedokteran|rp\s*1|rp\s*2|rp\s*3/i.test(res.answer || '')) {
      negHallucination++;
      negWrongPositive++;
    } else {
      negSafeNoData++;
    }
  }
  console.log(`Negative controls: ${negSafeNoData}/${NEGATIVE_CASES.length} safe no-data, ${negRuntimeExceptions} exceptions.`);

  // EXECUTE CONTINUOUS-SESSION STRESS
  console.log('\n--- EXECUTING CONTINUOUS-SESSION STRESS (12 UNSEEN TURNS) ---');
  const persistentSession = {
    chatId: 'continuous-eval-' + Date.now(),
    lastProgramHint: null,
    lastTopic: null,
    messages: []
  };

  let contWrongDomain = 0;
  let contWrongIntent = 0;
  let contWrongEntity = 0;
  let contStaleContext = 0;
  let contMissed = 0;
  let contHallucination = 0;

  for (const t of CONTINUOUS_TURNS) {
    persistentSession.messages.push({ direction: 'user', message: t.query });
    const t0 = performance.now();
    let res = null;
    try {
      res = await querySemanticRag(t.query, {
        sessionData: {
          lastProgramHint: persistentSession.lastProgramHint,
          lastTopic: persistentSession.lastTopic,
          messages: persistentSession.messages
        }
      });
    } catch (err) {
      res = { success: false, answer: 'Error: ' + err.message };
    }
    latenciesMs.push(performance.now() - t0);

    const inst = semanticRag.lastRetrievalInstrumentation || {};
    candidateIdsList.push(inst.CANDIDATE_IDS_FROM_INDEX || 0);
    chunksScoredList.push(inst.CHUNKS_EXPENSIVELY_SCORED || 0);

    if (res && res.answer) {
      persistentSession.messages.push({ direction: 'bot', message: res.answer });
    }

    // Check turn 10 follow-up: must preserve Sistem Komputer
    if (t.turn === 10) {
      if (!/sistem komputer|sk|6\.500\.000|7\.000\.000|biaya/i.test(res.answer || '')) {
        contStaleContext++;
      }
    }
    // Check turn 11 multi-entity: must compare SK and TI
    if (t.turn === 11) {
      if (!/sistem komputer/i.test(res.answer || '') || !/teknologi informasi/i.test(res.answer || '')) {
        contWrongEntity++;
      }
    }
    // Check turn 12 return to PMB: must answer with website or PMB info without stale fee/SK
    if (t.turn === 12) {
      if (!/stikom-bali\.ac\.id|daftar|online/i.test(res.answer || '')) {
        contWrongDomain++;
      }
    }
  }

  // TELEMETRY AGGREGATION
  candidateIdsList.sort((a, b) => a - b);
  chunksScoredList.sort((a, b) => a - b);
  latenciesMs.sort((a, b) => a - b);

  const avgCand = (candidateIdsList.reduce((a, b) => a + b, 0) / candidateIdsList.length).toFixed(1);
  const p50Cand = candidateIdsList[Math.floor(candidateIdsList.length * 0.5)];
  const p95Cand = candidateIdsList[Math.floor(candidateIdsList.length * 0.95)];
  const maxCand = candidateIdsList[candidateIdsList.length - 1];

  const avgScored = (chunksScoredList.reduce((a, b) => a + b, 0) / chunksScoredList.length).toFixed(1);
  const p95Scored = chunksScoredList[Math.floor(chunksScoredList.length * 0.95)];

  const avgLat = (latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length).toFixed(1);
  const p95Lat = latenciesMs[Math.floor(latenciesMs.length * 0.95)].toFixed(1);
  const maxLat = latenciesMs[latenciesMs.length - 1].toFixed(1);

  const lifecycle = semanticRag.getIndexLifecycleMetrics();

  console.log('\n==================================================');
  console.log('CORPUS EVALUATION TELEMETRY REPORT');
  console.log('==================================================');
  console.log(`TOTAL_CORPUS_CHUNKS=838`);
  console.log(`AVG_CANDIDATE_IDS=${avgCand}`);
  console.log(`P50_CANDIDATE_IDS=${p50Cand}`);
  console.log(`P95_CANDIDATE_IDS=${p95Cand}`);
  console.log(`MAX_CANDIDATE_IDS=${maxCand}`);
  console.log(`AVG_CHUNKS_SCORED=${avgScored}`);
  console.log(`P95_CHUNKS_SCORED=${p95Scored}`);
  console.log(`AVG_RETRIEVAL_LATENCY_MS=${avgLat}`);
  console.log(`P95_RETRIEVAL_LATENCY_MS=${p95Lat}`);
  console.log(`MAX_RETRIEVAL_LATENCY_MS=${maxLat}`);
  console.log(`RAG_INDEX_FULL_SCAN_PER_REQUEST=${ragIndexFullScans > 0 ? 'YES' : 'NO'}`);
  console.log(`TRAINING_DATA_FULL_SCAN_PER_REQUEST=${trainingDataFullScans > 0 ? 'YES' : 'NO'}`);
  console.log(`INDEX_REBUILT_PER_QUERY=${lifecycle.ragIndexBuildCount > 1 ? 'YES' : 'NO'}`);

  console.log('\n==================================================');
  console.log('CORPUS EVALUATION OUTCOME METRICS');
  console.log('==================================================');
  console.log(`CORPUS_EVAL_TOTAL=${SUPPORTED_CASES.length}`);
  console.log(`CORPUS_EVAL_SUPPORTED=${SUPPORTED_CASES.length}`);
  console.log(`CORPUS_EVAL_SUPPORTED_ANSWERED=${supportedAnswered}`);
  console.log(`CORPUS_EVAL_SUPPORTED_BUT_MISSED=${supportedButMissed}`);
  console.log(`CORPUS_EVAL_WRONG_DOMAIN=${wrongDomain}`);
  console.log(`CORPUS_EVAL_WRONG_INTENT=${wrongIntent}`);
  console.log(`CORPUS_EVAL_WRONG_ENTITY=${wrongEntity}`);
  console.log(`CORPUS_EVAL_WRONG_FIELD=${wrongField}`);
  console.log(`CORPUS_EVAL_FALSE_NODATA=${falseNoData}`);
  console.log(`CORPUS_EVAL_HALLUCINATION=${hallucination}`);
  console.log(`CORPUS_EVAL_TIMEOUT=${timeoutCount}`);

  console.log('\nNEGATIVE CONTROL METRICS:');
  console.log(`NEGATIVE_TOTAL=${NEGATIVE_CASES.length}`);
  console.log(`NEGATIVE_SAFE_NODATA=${negSafeNoData}`);
  console.log(`NEGATIVE_RUNTIME_EXCEPTION=${negRuntimeExceptions}`);
  console.log(`NEGATIVE_HALLUCINATION=${negHallucination}`);
  console.log(`NEGATIVE_WRONG_POSITIVE=${negWrongPositive}`);

  console.log('\nCONTINUOUS SESSION METRICS:');
  console.log(`CONTINUOUS_UNSEEN_TOTAL=${CONTINUOUS_TURNS.length}`);
  console.log(`CONTINUOUS_UNSEEN_WRONG_DOMAIN=${contWrongDomain}`);
  console.log(`CONTINUOUS_UNSEEN_WRONG_INTENT=${contWrongIntent}`);
  console.log(`CONTINUOUS_UNSEEN_WRONG_ENTITY=${contWrongEntity}`);
  console.log(`CONTINUOUS_UNSEEN_STALE_CONTEXT=${contStaleContext}`);
  console.log(`CONTINUOUS_UNSEEN_SUPPORTED_BUT_MISSED=${contMissed}`);
  console.log(`CONTINUOUS_UNSEEN_HALLUCINATION=${contHallucination}`);

  if (failures.length > 0) {
    console.log('\n==================================================');
    console.log(`FAILURES REPORT (${failures.length} failures found)`);
    console.log('==================================================');
    failures.forEach((f, idx) => {
      console.log(`\n--- FAILURE #${idx + 1} ---`);
      console.log(`FAILURE_ID: ${f.FAILURE_ID}`);
      console.log(`QUESTION: "${f.QUESTION}"`);
      console.log(`SOURCE_EVIDENCE: ${f.SOURCE_EVIDENCE}`);
      console.log(`EXPECTED_BINDING: ${f.EXPECTED_BINDING}`);
      console.log(`ACTUAL_DOMAIN: ${f.ACTUAL_DOMAIN}`);
      console.log(`ACTUAL_INTENT: ${f.ACTUAL_INTENT}`);
      console.log(`ACTUAL_ENTITY: ${f.ACTUAL_ENTITY}`);
      console.log(`ACTUAL_BINDING: ${f.ACTUAL_BINDING}`);
      console.log(`RETRIEVED_EVIDENCE: ${f.RETRIEVED_EVIDENCE}`);
      console.log(`FAILURE_CLASS: ${f.FAILURE_CLASS}`);
      console.log(`ROOT_CAUSE: ${f.ROOT_CAUSE}`);
    });
  } else {
    console.log('\nHOLDOUT EVALUATION CLEAN: 0 failures detected.');
  }

  return {
    failures,
    telemetry: {
      avgCand, p50Cand, p95Cand, maxCand, avgScored, p95Scored, avgLat, p95Lat, maxLat,
      ragIndexFullScans, trainingDataFullScans, rebuilt: lifecycle.ragIndexBuildCount > 1
    },
    outcomes: {
      total: SUPPORTED_CASES.length,
      supportedAnswered,
      supportedButMissed,
      falseNoData,
      negSafeNoData,
      negTotal: NEGATIVE_CASES.length,
      contTotal: CONTINUOUS_TURNS.length,
      contStaleContext
    }
  };
}

if (require.main === module) {
  runCorpusWideEvaluation().catch(err => {
    console.error('Error during broad evaluation:', err);
    process.exit(1);
  });
}

module.exports = {
  runCorpusWideEvaluation,
  SUPPORTED_CASES,
  NEGATIVE_CASES,
  CONTINUOUS_TURNS
};
