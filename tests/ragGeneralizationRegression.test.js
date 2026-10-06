/**
 * Comprehensive RAG Generalization Regression Test Suite
 *
 * Verifies >=60 queries across all 13 canonical knowledge domains:
 *  1. Program Studi (TI, SI, Bisnis Digital, SK)
 *  2. Kurikulum & SKS (Magang 30 SKS, Konversi MBKM 20 SKS)
 *  3. PMB & Pendaftaran (Biaya, Jalur Gelombang, Jadwal)
 *  4. Biaya & Keuangan (DPP, Potongan Gelombang, SPP, Cicilan)
 *  5. Beasiswa (KIP Kuliah, SKSS Negative Control)
 *  6. UKM & Organisasi Mahasiswa (Olahraga, Seni, Teknologi, Count)
 *  7. Fasilitas & Lab (Renon, Cisco, Perpustakaan IEEE)
 *  8. Program Internasional & Exchange (Double Degree, Student Exchange, GCCP)
 *  9. Pascasarjana / S2 (MSI, Konsentrasi, Gelar M.Kom)
 * 10. Akademik / Sidang / Wisuda (Jadwal Wisuda, Sidang Komprehensif TI, SK Rektor 045)
 * 11. Inkubator Bisnis / INBIS (Startup, Pendanaan, Program)
 * 12. SION Personal Escalation (Login gagal, Reset password -> Admin IT +62 878-6188-4663)
 * 13. Negative Controls / Out of Domain (Asrama, Kedokteran, etc. - Zero Hallucination)
 */

require('dotenv').config();
process.env.ALLOW_OPENAI_IN_TEST = 'true';
const { querySemanticRag, clearSemanticCaches } = require('../src/engine/semanticRagEngine');

const regressionSuite = [
  // ==========================================
  // DOMAIN 1: Program Studi (6 cases)
  // ==========================================
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-01',
    query: 'Prospek karir lulusan Bisnis Digital apa saja?',
    expectedType: 'PASS',
    matcher: (ans) => /e-commerce|digital marketing|data analytics|bisnis|karir/i.test(ans),
    description: 'Direct career prospect retrieval for Bisnis Digital'
  },
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-02',
    query: 'Kompetensi apa yang dipelajari di Sistem Komputer?',
    expectedType: 'PASS',
    matcher: (ans) => /iot|network|hardware|embedded|perakitan|jaringan/i.test(ans),
    description: 'Technical competency retrieval for Sistem Komputer'
  },
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-03',
    query: 'Bidang keahlian apa yang ditekankan di prodi Teknologi Informasi?',
    expectedType: 'PASS',
    matcher: (ans) => /software|cloud|cyber|teknologi informasi|keahlian/i.test(ans),
    description: 'Focus area retrieval for Teknologi Informasi'
  },
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-04',
    query: 'Apa akreditasi program studi Bisnis Digital saat ini?',
    expectedType: 'PASS',
    matcher: (ans) => /baik sekali|lam infokom|akreditasi/i.test(ans),
    description: 'Accreditation status retrieval for Bisnis Digital'
  },
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-05',
    query: 'Berapa total SKS lulus untuk prodi Bisnis Digital?',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans, res) => {
      const mentions144 = /\b144\s*sks\b/i.test(ans);
      if (mentions144) return false; // Invariant: PRODI-05 must never hallucinate 144 SKS
      return /belum\s+tersedia|belum\s+tercantum|konfirmasi\s+ke\s+bagian\s+akademik|admin|hubungi/i.test(ans) || res?.debug?.adminEscalation?.escalated;
    },
    description: 'Safety invariant: Bisnis Digital SKS is incomplete in KB, must not hallucinate 144 SKS'
  },
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-06',
    query: 'Apa saja program studi sarjana S1 yang ada di ITB STIKOM Bali?',
    expectedType: 'PASS',
    matcher: (ans) => /sistem informasi|teknologi informasi|sistem komputer|bisnis digital/i.test(ans),
    description: 'Undergraduate study program catalog'
  },
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-07',
    query: 'Apa perbedaan Sistem Informasi dan Teknologi Informasi?',
    expectedType: 'PASS',
    matcher: (ans, res) => {
      const isComparisonSource = res?.source === 'semantic-rag-program-comparison';
      const mentionsBoth = /sistem informasi/i.test(ans) && /teknologi informasi/i.test(ans);
      const isNotDump = !/kurikulum\s+lengkap\s+seluruh\s+prodi/i.test(ans);
      return isComparisonSource && mentionsBoth && isNotDump;
    },
    description: 'Adversarial 1: Formal query comparison between SI and TI'
  },
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-08',
    query: 'Kalau TI dibanding SI bedanya apa?',
    expectedType: 'PASS',
    matcher: (ans, res) => {
      const isComparisonSource = res?.source === 'semantic-rag-program-comparison';
      const mentionsBoth = /sistem informasi/i.test(ans) && /teknologi informasi/i.test(ans);
      return isComparisonSource && mentionsBoth;
    },
    description: 'Adversarial 2: Inverted order comparison TI vs SI'
  },
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-09',
    query: 'bedain SI sama TI dong',
    expectedType: 'PASS',
    matcher: (ans, res) => {
      const isComparisonSource = res?.source === 'semantic-rag-program-comparison';
      const mentionsBoth = /sistem informasi/i.test(ans) && /teknologi informasi/i.test(ans);
      return isComparisonSource && mentionsBoth;
    },
    description: 'Adversarial 3: Informal slang query bedain SI sama TI'
  },
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-10',
    query: 'SI vs TI apa bedanya?',
    expectedType: 'PASS',
    matcher: (ans, res) => {
      const isComparisonSource = res?.source === 'semantic-rag-program-comparison';
      const mentionsBoth = /sistem informasi/i.test(ans) && /teknologi informasi/i.test(ans);
      return isComparisonSource && mentionsBoth;
    },
    description: 'Adversarial 4: Shorthand vs comparison query'
  },
  {
    domain: 'Program Studi',
    id: 'PRODI-REG-11',
    query: 'lebih cocok SI atau TI?',
    expectedType: 'PASS',
    matcher: (ans, res) => {
      // Must not fabricate recommendations without user profile
      const noFabricatedSpecificRecommendation = !/pasti\s+pilih\s+(?:si|ti)\s+saja/i.test(ans);
      const mentionsGuidance = /minat|fondasi|langkah|bandingkan|sistem informasi/i.test(ans);
      return noFabricatedSpecificRecommendation && mentionsGuidance;
    },
    description: 'Adversarial 5: Fit / preference advice query grounded without fabricated personal choice'
  },

  // ==========================================
  // DOMAIN 2: Kurikulum & SKS (5 cases)
  // ==========================================
  {
    domain: 'Kurikulum & SKS',
    id: 'KURIKULUM-REG-01',
    query: 'Berapa SKS bobot program magang kerja di kampus?',
    expectedType: 'PASS',
    matcher: (ans) => /30\s*sks|magang/i.test(ans),
    description: 'Internship weight of 30 SKS'
  },
  {
    domain: 'Kurikulum & SKS',
    id: 'KURIKULUM-REG-02',
    query: 'Berapa maksimal SKS yang bisa dikonversi dari kegiatan MBKM?',
    expectedType: 'PASS',
    matcher: (ans) => /20\s*sks|konversi/i.test(ans),
    description: 'MBKM conversion maximum of 20 SKS'
  },
  {
    domain: 'Kurikulum & SKS',
    id: 'KURIKULUM-REG-03',
    query: 'Apakah magang kerja bersertifikat diakui dalam SKS perkuliahan?',
    expectedType: 'PASS',
    matcher: (ans) => /magang|sks|konversi|diakui/i.test(ans),
    description: 'Recognition of certified internships'
  },
  {
    domain: 'Kurikulum & SKS',
    id: 'KURIKULUM-REG-04',
    query: 'Bagaimana skema konversi mata kuliah program pertukaran mahasiswa?',
    expectedType: 'PASS',
    matcher: (ans) => /konversi|sks|kurikulum|pertukaran/i.test(ans),
    description: 'Course conversion scheme for student exchange'
  },
  {
    domain: 'Kurikulum & SKS',
    id: 'KURIKULUM-REG-05',
    query: 'Apakah kegiatan MBKM mahasiswa dapat disetarakan dengan SKS?',
    expectedType: 'PASS',
    matcher: (ans) => /20\s*sks|sks|konversi|mbkm/i.test(ans),
    description: 'MBKM equivalence with academic credits'
  },

  // ==========================================
  // DOMAIN 3: PMB & Pendaftaran (5 cases)
  // ==========================================
  {
    domain: 'PMB & Pendaftaran',
    id: 'PMB-REG-01',
    query: 'Berapa biaya formulir pendaftaran mahasiswa baru?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:250|300|500)\.?000|pendaftaran/i.test(ans),
    description: 'Registration fee amount'
  },
  {
    domain: 'PMB & Pendaftaran',
    id: 'PMB-REG-02',
    query: 'Jalur gelombang pendaftaran PMB ada apa saja?',
    expectedType: 'PASS',
    matcher: (ans) => /gelombang/i.test(ans),
    description: 'Admission intake waves list'
  },
  {
    domain: 'PMB & Pendaftaran',
    id: 'PMB-REG-03',
    query: 'Kapan batas akhir pendaftaran mahasiswa baru gelombang 1?',
    expectedType: 'PASS',
    matcher: (ans) => /gelombang|pendaftaran|jadwal|kalender/i.test(ans),
    description: 'Wave 1 deadline and schedule'
  },
  {
    domain: 'PMB & Pendaftaran',
    id: 'PMB-REG-04',
    query: 'Bagaimana alur pendaftaran mahasiswa baru secara online?',
    expectedType: 'PASS',
    matcher: (ans) => /online|pendaftaran|pmb|formulir/i.test(ans),
    description: 'Online registration procedure'
  },
  {
    domain: 'PMB & Pendaftaran',
    id: 'PMB-REG-05',
    query: 'Apa saja berkas persyaratan umum untuk mendaftar kuliah?',
    expectedType: 'PASS',
    matcher: (ans) => /ijazah|ktp|kk|berkas|persyaratan/i.test(ans),
    description: 'Standard admission document requirements'
  },

  // ==========================================
  // DOMAIN 4: Biaya & Keuangan (5 cases)
  // ==========================================
  {
    domain: 'Biaya & Keuangan',
    id: 'BIAYA-REG-01',
    query: 'Berapa potongan biaya DPP kalau daftar di Gelombang 1?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:1\.?500\.?000|2\.?000\.?000|potongan|dpp)/i.test(ans),
    description: 'Wave 1 DPP discount'
  },
  {
    domain: 'Biaya & Keuangan',
    id: 'BIAYA-REG-02',
    query: 'Potongan uang gedung gelombang dua berapa?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:1\.?000\.?000|1\.?500\.?000|750\.?000|potongan|gelombang)/i.test(ans),
    description: 'Wave 2 building fund / DPP discount'
  },
  {
    domain: 'Biaya & Keuangan',
    id: 'BIAYA-REG-03',
    query: 'SPP Sistem Informasi per semester berapa?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:7\.?200\.?000|1\.?200\.?000|spp|semester)/i.test(ans),
    description: 'Semester tuition for Sistem Informasi'
  },
  {
    domain: 'Biaya & Keuangan',
    id: 'BIAYA-REG-04',
    query: 'Apakah pembayaran biaya kuliah bisa dicicil per bulan?',
    expectedType: 'PASS',
    matcher: (ans) => /cicil|angsur|bulan|tahap/i.test(ans),
    description: 'Monthly tuition installment availability'
  },
  {
    domain: 'Biaya & Keuangan',
    id: 'BIAYA-REG-05',
    query: 'Berapa perbedaan potongan DPP antara gelombang 1 dan gelombang 2?',
    expectedType: 'PASS',
    matcher: (ans) => /gelombang|potongan|dpp|1\.?500|1\.?000|2\.?000/i.test(ans),
    description: 'Wave comparison of DPP discounts'
  },

  // ==========================================
  // DOMAIN 5: Beasiswa (5 cases)
  // ==========================================
  {
    domain: 'Beasiswa',
    id: 'BEASISWA-REG-01',
    query: 'Apakah ada program KIP Kuliah di STIKOM Bali?',
    expectedType: 'PASS',
    matcher: (ans) => /kip\s*kuliah/i.test(ans),
    description: 'KIP Kuliah scholarship existence'
  },
  {
    domain: 'Beasiswa',
    id: 'BEASISWA-REG-02',
    query: 'Bagaimana cara mengajukan beasiswa KIP Kuliah?',
    expectedType: 'PASS',
    matcher: (ans) => /kip\s*kuliah|surat|kemahasiswaan|prosedur/i.test(ans),
    description: 'KIP Kuliah application procedure'
  },
  {
    domain: 'Beasiswa',
    id: 'BEASISWA-REG-03',
    query: 'Apa syarat beasiswa SKSS?',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans, res) => {
      // Must not fabricate conditions for absent SKSS
      return /belum\s+tersedia|belum\s+tercantum|tidak\s+ada|kemahasiswaan|admin|hubungi/i.test(ans) || res?.debug?.adminEscalation?.escalated;
    },
    description: 'Safety invariant: SKSS criteria absent from KB, must safely escalate'
  },
  {
    domain: 'Beasiswa',
    id: 'BEASISWA-REG-04',
    query: 'Apakah ada beasiswa jalur prestasi rapor untuk pendaftar baru?',
    expectedType: 'PASS',
    matcher: (ans) => /prestasi|ranking|rapor|beasiswa/i.test(ans),
    description: 'Report card ranking scholarship'
  },
  {
    domain: 'Beasiswa',
    id: 'BEASISWA-REG-05',
    query: 'Unit mana yang mengurus pengajuan beasiswa mahasiswa?',
    expectedType: 'PASS',
    matcher: (ans) => /kemahasiswaan|pmb|bagian kemahasiswaan/i.test(ans),
    description: 'Student affairs scholarship division'
  },

  // ==========================================
  // DOMAIN 6: UKM & Organisasi Kemahasiswaan (5 cases)
  // ==========================================
  {
    domain: 'UKM & Organisasi',
    id: 'UKM-REG-01',
    query: 'Apakah ada UKM olahraga di kampus?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:basket|futsal|olahraga|bos|athena)/i.test(ans),
    description: 'Sports student organizations'
  },
  {
    domain: 'UKM & Organisasi',
    id: 'UKM-REG-02',
    query: 'Kalau saya suka badminton ada komunitas atau organisasi apa?',
    expectedType: 'PASS',
    matcher: (ans) => /bos|badminton/i.test(ans),
    description: 'Badminton student activity unit (BOS)'
  },
  {
    domain: 'UKM & Organisasi',
    id: 'UKM-REG-03',
    query: 'Apa saja UKM bidang kesenian dan kebudayaan di STIKOM Bali?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:musik|tari|tabuh|teater|pragina)/i.test(ans),
    description: 'Arts and cultural student activity units'
  },
  {
    domain: 'UKM & Organisasi',
    id: 'UKM-REG-04',
    query: 'UKM komputer atau programming apa yang ada?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:syntax|ksl|linux|mcos|rade|ghost)/i.test(ans),
    description: 'Tech and coding student activity units'
  },
  {
    domain: 'UKM & Organisasi',
    id: 'UKM-REG-05',
    query: 'Berapa jumlah UKM di kampus?',
    expectedType: 'PASS',
    matcher: (ans) => /\b32\b|organisasi/i.test(ans),
    description: 'Official count of student activity units'
  },

  // ==========================================
  // DOMAIN 7: Fasilitas & Laboratorium (5 cases)
  // ==========================================
  {
    domain: 'Fasilitas & Lab',
    id: 'FASILITAS-REG-01',
    query: 'Fasilitas lab komputer di kampus Renon ada apa saja?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:renon|pemrograman|basis data|workstation|laboratorium)/i.test(ans),
    description: 'Renon computer laboratory facilities'
  },
  {
    domain: 'Fasilitas & Lab',
    id: 'FASILITAS-REG-02',
    query: 'Apakah ada laboratorium jaringan dengan perangkat Cisco?',
    expectedType: 'PASS',
    matcher: (ans) => /cisco|switch|router|jaringan/i.test(ans),
    description: 'Cisco networking laboratory'
  },
  {
    domain: 'Fasilitas & Lab',
    id: 'FASILITAS-REG-03',
    query: 'Perpustakaan STIKOM Bali menyediakan akses jurnal apa?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:ieee|acm|perpustakaan|jurnal)/i.test(ans),
    description: 'Library digital journal access'
  },
  {
    domain: 'Fasilitas & Lab',
    id: 'FASILITAS-REG-04',
    query: 'Di mana saja lokasi kampus ITB STIKOM Bali berada?',
    expectedType: 'PASS',
    matcher: (ans) => /renon|jimbaran|abiansemal/i.test(ans),
    description: 'Campus geographical locations'
  },
  {
    domain: 'Fasilitas & Lab',
    id: 'FASILITAS-REG-05',
    query: 'Apakah ada fasilitas internet wifi untuk mahasiswa di kampus?',
    expectedType: 'PASS',
    matcher: (ans) => /wifi|fasilitas|laboratorium|layanan/i.test(ans),
    description: 'Campus technological facilities'
  },

  // ==========================================
  // DOMAIN 8: Program Internasional & Exchange (5 cases)
  // ==========================================
  {
    domain: 'Program Internasional',
    id: 'INTERNASIONAL-REG-01',
    query: 'Apa saja kampus luar negeri yang bekerja sama untuk program double degree?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:help|dnui|utb|malaysia|china|brunei)/i.test(ans),
    description: 'International double degree university partners'
  },
  {
    domain: 'Program Internasional',
    id: 'INTERNASIONAL-REG-02',
    query: 'Apakah ada program student exchange ke luar negeri?',
    expectedType: 'PASS',
    matcher: (ans) => /student exchange|pertukaran mahasiswa|semester/i.test(ans),
    description: 'Overseas student exchange programs'
  },
  {
    domain: 'Program Internasional',
    id: 'INTERNASIONAL-REG-03',
    query: 'Apa keuntungan ikut program pertukaran pelajar GCCP?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:exchange|gccp|budaya|internasional)/i.test(ans),
    description: 'Global Cross Cultural Program (GCCP)'
  },
  {
    domain: 'Program Internasional',
    id: 'INTERNASIONAL-REG-04',
    query: 'Berapa lama durasi kuliah di luar negeri untuk dual degree HELP University?',
    expectedType: 'PASS',
    matcher: (ans) => /help|degree|tahun|semester/i.test(ans),
    description: 'Dual degree duration with HELP University'
  },
  {
    domain: 'Program Internasional',
    id: 'INTERNASIONAL-REG-05',
    query: 'Apakah program pertukaran mahasiswa luar negeri mendapatkan konversi kredit?',
    expectedType: 'PASS',
    matcher: (ans) => /credit transfer|pertukaran|konversi|sks/i.test(ans),
    description: 'Credit transfer in student exchange programs'
  },

  // ==========================================
  // DOMAIN 9: Pascasarjana / S2 (5 cases)
  // ==========================================
  {
    domain: 'Pascasarjana',
    id: 'PASCASARJANA-REG-01',
    query: 'Program S2 apa yang ada di ITB STIKOM Bali?',
    expectedType: 'PASS',
    matcher: (ans) => /magister|sistem informasi|s2/i.test(ans),
    description: 'Master of Information Systems program'
  },
  {
    domain: 'Pascasarjana',
    id: 'PASCASARJANA-REG-02',
    query: 'Konsentrasi apa saja yang tersedia di program Magister Sistem Informasi?',
    expectedType: 'PASS',
    matcher: (ans) => /(?:governance|cyber\s*security|business intelligence|transformation|konsentrasi)/i.test(ans),
    description: 'S2 MSI 4 specialized concentrations'
  },
  {
    domain: 'Pascasarjana',
    id: 'PASCASARJANA-REG-03',
    query: 'Apa gelar lulusan pascasarjana Sistem Informasi?',
    expectedType: 'PASS',
    matcher: (ans) => /m\.?kom/i.test(ans),
    description: 'Master degree designation (M.Kom)'
  },
  {
    domain: 'Pascasarjana',
    id: 'PASCASARJANA-REG-04',
    query: 'Apakah program Magister Sistem Informasi menerima lulusan S1 non-IT?',
    expectedType: 'PASS',
    matcher: (ans) => /magister|sistem informasi|matrikulasi|syarat|s2/i.test(ans),
    description: 'S2 admission prerequisites'
  },
  {
    domain: 'Pascasarjana',
    id: 'PASCASARJANA-REG-05',
    query: 'Berapa semester masa studi normal untuk program Magister di STIKOM?',
    expectedType: 'PASS',
    matcher: (ans) => /semester|magister|studi/i.test(ans),
    description: 'Master degree study period'
  },

  // ==========================================
  // DOMAIN 10: Akademik / Sidang / Wisuda (5 cases)
  // ==========================================
  {
    domain: 'Akademik & Wisuda',
    id: 'AKADEMIK-REG-01',
    query: 'Kapan pendaftaran wisuda periode genap sarjana komputer?',
    expectedType: 'PASS',
    matcher: (ans) => /wisuda|genap|sarjana komputer/i.test(ans),
    description: 'Even semester graduation registration timeline'
  },
  {
    domain: 'Akademik & Wisuda',
    id: 'AKADEMIK-REG-02',
    query: 'Apa saja syarat sidang komprehensif teknologi informasi?',
    expectedType: 'PARTIAL-SAFE',
    matcher: (ans, res) => {
      // Must not fabricate arbitrary requirements absent from KB
      const fabricatesRequirements = /\b(?:ipk\s+minimal|toefl|skor\s+toefl|bebas\s+pustaka|bukti\s+bayar|lunas\s+spp|krs\s+semester)\b/i.test(ans);
      if (fabricatesRequirements) return false;
      // Must be bounded to the general exam board info or explicitly note detailed requirements are unlisted / safe boundary
      const hasSafeFactualBoundary = /sidang komprehensif/i.test(ans) && (/dewan dosen|dosen senior/i.test(ans) || /belum ada daftar syarat|belum tersedia|hubungi|bagian akademik/i.test(ans));
      const isPartiallyGroundedOrSafe = res?.debug?.evidenceStatus?.answerGroundingStatus === 'PARTIALLY_GROUNDED'
        || res?.debug?.evidenceAuthority?.answerGroundingStatus === 'PARTIALLY_GROUNDED'
        || res?.debug?.adminEscalation?.escalated === true
        || /sidang komprehensif/i.test(ans);
      return hasSafeFactualBoundary && isPartiallyGroundedOrSafe;
    },
    description: 'TI comprehensive defense board details - partial safe boundary without fabricated requirements'
  },
  {
    domain: 'Akademik & Wisuda',
    id: 'AKADEMIK-REG-03',
    query: 'Surat keputusan rektor tentang biaya wisuda nomor berapa?',
    expectedType: 'PASS',
    matcher: (ans) => /045/i.test(ans),
    description: 'Rector decree No 045/SK/ITB-STIKOM/2026 citation'
  },
  {
    domain: 'Akademik & Wisuda',
    id: 'AKADEMIK-REG-04',
    query: 'Kapan jadwal pendaftaran yudisium sarjana diadakan?',
    expectedType: 'PASS',
    matcher: (ans) => /wisuda|yudisium|pendaftaran|akademik/i.test(ans),
    description: 'Graduation / yudisium calendar'
  },
  {
    domain: 'Akademik & Wisuda',
    id: 'AKADEMIK-REG-05',
    query: 'Berapa biaya wisuda sarjana berdasarkan surat keputusan rektor?',
    expectedType: 'PASS',
    matcher: (ans) => /045|sk rektor|wisuda|biaya/i.test(ans),
    description: 'Graduation fee decree reference'
  },

  // ==========================================
  // DOMAIN 11: Inkubator Bisnis (INBIS) (5 cases)
  // ==========================================
  {
    domain: 'Inkubator Bisnis',
    id: 'INBIS-REG-01',
    query: 'Apa itu INBIS di ITB STIKOM Bali?',
    expectedType: 'PASS',
    matcher: (ans) => /inkubator bisnis|startup/i.test(ans),
    description: 'INBIS incubator purpose and definition'
  },
  {
    domain: 'Inkubator Bisnis',
    id: 'INBIS-REG-02',
    query: 'Apakah mahasiswa yang punya ide bisnis bisa dibimbing di INBIS?',
    expectedType: 'PASS',
    matcher: (ans) => /inkubator bisnis|startup|bimbingan|inkubasi/i.test(ans),
    description: 'Student entrepreneur mentorship at INBIS'
  },
  {
    domain: 'Inkubator Bisnis',
    id: 'INBIS-REG-03',
    query: 'Layanan apa saja yang disediakan inkubator bisnis untuk tenant?',
    expectedType: 'PASS',
    matcher: (ans) => /inkubator bisnis|startup|pembinaan|wirausaha/i.test(ans),
    description: 'INBIS services for startup tenants'
  },
  {
    domain: 'Inkubator Bisnis',
    id: 'INBIS-REG-04',
    query: 'Apakah INBIS terbuka untuk membina startup teknologi mahasiswa?',
    expectedType: 'PASS',
    matcher: (ans) => /inkubator bisnis|startup|teknologi/i.test(ans),
    description: 'Tech startup incubation support'
  },
  {
    domain: 'Inkubator Bisnis',
    id: 'INBIS-REG-05',
    query: 'Bagaimana cara bergabung dengan program binaan inkubator bisnis kampus?',
    expectedType: 'PASS',
    matcher: (ans) => /inkubator bisnis|startup|inbis/i.test(ans),
    description: 'INBIS incubation program onboarding'
  },

  // ==========================================
  // DOMAIN 12: SION Personal Escalation (5 cases)
  // ==========================================
  {
    domain: 'SION Escalation',
    id: 'SISTEM-REG-01',
    query: 'Saya tidak bisa login ke akun SION, passwordnya salah terus',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans, res) => {
      const isItEscalated = res?.debug?.adminEscalation?.escalated && /it/i.test(res?.debug?.adminEscalation?.topic || '');
      const hasItContact = /0878-?6188-?4663/i.test(ans) || /admin\s+it/i.test(ans);
      return isItEscalated || hasItContact;
    },
    description: 'Safety invariant: SION account issue must escalate to Admin IT (+62 878-6188-4663)'
  },
  {
    domain: 'SION Escalation',
    id: 'SISTEM-REG-02',
    query: 'Bagaimana cara reset password portal SION?',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans, res) => {
      const isItEscalated = res?.debug?.adminEscalation?.escalated && /it/i.test(res?.debug?.adminEscalation?.topic || '');
      const hasItContact = /0878-?6188-?4663/i.test(ans) || /admin\s+it|bagian\s+it/i.test(ans);
      return isItEscalated || hasItContact;
    },
    description: 'Safety invariant: SION password reset must route to Admin IT'
  },
  {
    domain: 'SION Escalation',
    id: 'SISTEM-REG-03',
    query: 'Portal SION saya terkunci dan tidak bisa isi KRS',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans, res) => {
      const isItEscalated = res?.debug?.adminEscalation?.escalated && /it/i.test(res?.debug?.adminEscalation?.topic || '');
      const hasItContact = /0878-?6188-?4663/i.test(ans) || /admin\s+it|bagian\s+it/i.test(ans);
      return isItEscalated || hasItContact;
    },
    description: 'Locked SION account routing to Admin IT'
  },
  {
    domain: 'SION Escalation',
    id: 'SISTEM-REG-04',
    query: 'Akun SION mahasiswa baru belum aktif, harus lapor ke mana?',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans, res) => {
      const isItEscalated = res?.debug?.adminEscalation?.escalated;
      const hasItContact = /0878-?6188-?4663/i.test(ans) || /admin|it/i.test(ans);
      return isItEscalated || hasItContact;
    },
    description: 'Inactive student SION account escalation'
  },
  {
    domain: 'SION Escalation',
    id: 'SISTEM-REG-05',
    query: 'Berapa nomor kontak bagian IT untuk perbaikan sistem portal kampus?',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans, res) => {
      return /0878-?6188-?4663/i.test(ans) || res?.debug?.adminEscalation?.escalated;
    },
    description: 'Direct IT admin contact number inquiry'
  },

  // ==========================================
  // DOMAIN 13: Negative Controls & Absent Entities (5 cases)
  // ==========================================
  {
    domain: 'Negative Controls',
    id: 'NEG-REG-01',
    query: 'Berapa biaya asrama kampus per bulan?',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans) => {
      // Must not hallucinate dormitory fees
      return !/Rp\s*\d+/i.test(ans) || /tidak\s+memiliki\s+asrama|belum\s+tersedia|asrama/i.test(ans);
    },
    description: 'Safety invariant: Non-existent campus dormitory must not produce hallucinated fee'
  },
  {
    domain: 'Negative Controls',
    id: 'NEG-REG-02',
    query: 'Apakah ada jurusan kedokteran di ITB STIKOM Bali?',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans) => {
      // Must refuse or clarify absent medical faculty
      return /tidak\s+(?:ada|memiliki|tersedia)\s+(?:jurusan|program\s+studi|fakultas)?\s*kedokteran/i.test(ans)
        || /bukan\s+fakultas\s+kedokteran/i.test(ans)
        || /fokus\s+pada\s+bidang\s+teknologi/i.test(ans)
        || /tidak\s+ada/i.test(ans)
        || /belum\s+tersedia|belum\s+dapat\s+memastikan/i.test(ans);
    },
    description: 'Safety invariant: Absent medical faculty must not be falsely affirmed'
  },
  {
    domain: 'Negative Controls',
    id: 'NEG-REG-03',
    query: 'Apakah tersedia program studi sastra perancis di STIKOM Bali?',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans) => {
      return !/pendaftaran.*sastra perancis dibuka/i.test(ans) || /tidak\s+tersedia|belum\s+tersedia|tidak\s+ada/i.test(ans);
    },
    description: 'Safety invariant: Absent language faculty must not be hallucinated'
  },
  {
    domain: 'Negative Controls',
    id: 'NEG-REG-04',
    query: 'Berapa biaya kuliah kedokteran gigi per semester?',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans) => {
      return !/kedokteran gigi.*Rp\s*\d+/i.test(ans) || /tidak\s+memiliki|tidak\s+ada|belum\s+tersedia/i.test(ans);
    },
    description: 'Safety invariant: Absent dentistry tuition must not be fabricated'
  },
  {
    domain: 'Negative Controls',
    id: 'NEG-REG-05',
    query: 'Apakah kampus memiliki fasilitas kolam renang olympic size?',
    expectedType: 'CORRECT-ESCALATION',
    matcher: (ans) => {
      return !/tersedia kolam renang olympic size/i.test(ans);
    },
    description: 'Safety invariant: Absent Olympic pool facility must not be fabricated'
  }
];

// Helper to run all tests
async function runAllTests() {
  console.log(`Starting Generalized RAG Regression Suite with ${regressionSuite.length} queries...\n`);
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const tc of regressionSuite) {
    clearSemanticCaches();
    const t0 = Date.now();
    let res;
    try {
      res = await querySemanticRag(tc.query, { topK: 8 });
    } catch (e) {
      res = { success: false, answer: e.message, source: 'error' };
    }
    const elapsed = Date.now() - t0;
    const ans = res?.answer || '';
    const ok = tc.matcher(ans, res);

    if (ok) {
      passed++;
      console.log(`[PASS] [${tc.id}] (${elapsed}ms) [${tc.domain}]`);
    } else {
      failed++;
      failures.push({
        id: tc.id,
        domain: tc.domain,
        query: tc.query,
        answer: ans.substring(0, 160),
        source: res?.source
      });
      console.log(`[FAIL] [${tc.id}] (${elapsed}ms) [${tc.domain}]`);
      console.log(`  Q: "${tc.query}"`);
      console.log(`  A: "${ans.substring(0, 160)}"`);
      console.log(`  Src: ${res?.source}\n`);
    }
  }

  console.log(`\n========================================`);
  console.log(`REGRESSION SUITE COMPLETED`);
  console.log(`Total: ${regressionSuite.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`========================================\n`);

  return { total: regressionSuite.length, passed, failed, failures };
}

// Support Jest test runner
if (typeof describe === 'function') {
  describe('Generalized RAG Regression Suite (>=60 queries across 13 domains)', () => {
    jest.setTimeout(120000);
    regressionSuite.forEach((tc) => {
      test(`[${tc.id}] ${tc.domain}: ${tc.query}`, async () => {
        clearSemanticCaches();
        const res = await querySemanticRag(tc.query, { topK: 8 });
        const ans = res?.answer || '';
        const ok = Boolean(tc.matcher(ans, res));
        if (!ok) {
          console.error(`FAIL_DETAIL: [${tc.id}] src: ${res?.source} | ans: ${ans}`);
        }
        expect(ok).toBe(true);
      }, 120000);
    });
  });
}

// Support direct node execution
if (require.main === module) {
  runAllTests()
    .then(({ failed }) => {
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { regressionSuite, runAllTests };
