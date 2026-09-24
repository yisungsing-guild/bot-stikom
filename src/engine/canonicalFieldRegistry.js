'use strict';

/**
 * canonicalFieldRegistry.js
 *
 * Central Single Source of Truth for Semantic Field Families and Evidence Hints.
 * Shared across:
 * 1. BindingRetrievalPlanner (field derivation and hint indexing)
 * 2. PGVector Shadow Provider (natural language embedding query builder)
 * 3. Generic Structural Reranker (field-category compatibility & penalty logic)
 * 4. EvidenceEvaluator (evidence text compatibility verification)
 *
 * INVARIANTS:
 * - Pure & immutable registry.
 * - SPECIFIC_FIELD > FIELD_FAMILY: specific fields retain their identity while mapping to a parent family.
 * - Generic Indonesian & canonical vocabulary only: NO query-specific or filename-specific hardcoding.
 */

const CANONICAL_FIELD_FAMILIES = Object.freeze({
  CAREER: 'career',
  PROGRAM_FIT: 'program_fit',
  ACADEMIC_LEVEL: 'academic_level',
  INTERNATIONAL: 'international',
  PROFILE: 'profile',
  CONTACT: 'contact',
  FINANCIAL: 'financial',
  HISTORY: 'history',
  CERTIFICATION: 'certification',
  ACADEMIC_QUALITY: 'academic_quality',
  CURRICULUM: 'curriculum',
  PROCEDURE: 'procedure',
  GOVERNANCE: 'governance',
  GEOGRAPHIC: 'geographic',
  ORGANIZATION: 'organization'
});

const CANONICAL_FIELD_DEFINITIONS = Object.freeze({
  // ==========================================
  // 1. CAREER FAMILY
  // ==========================================
  careerOutcome: {
    field: 'careerOutcome',
    family: CANONICAL_FIELD_FAMILIES.CAREER,
    naturalSemantics: 'prospek kerja peluang karier profesi pekerjaan lulusan career outcome lulusan dapat bekerja bidang kerja posisi kerja profil lulusan masa depan',
    primaryHints: [
      'prospek kerja',
      'peluang karier',
      'peluang karir',
      'profesi',
      'pekerjaan lulusan',
      'lulusan dapat bekerja',
      'karier',
      'karir',
      'bidang kerja',
      'posisi kerja',
      'profil lulusan',
      'career outcome'
    ],
    secondaryHints: ['pekerjaan', 'kerja', 'lapangan kerja', 'masa depan'],
    compatibleDocCategories: ['PROSPEK_KERJA'],
    compatibleCategories: ['PROSPEK_KERJA', 'KARIR'],
    incompatibleDocCategories: ['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA']
  },
  jobRole: {
    field: 'jobRole',
    family: CANONICAL_FIELD_FAMILIES.CAREER,
    naturalSemantics: 'profesi jabatan posisi pekerjaan bidang kerja job role posisi kerja karir',
    primaryHints: [
      'profesi lulusan',
      'posisi kerja',
      'bidang kerja',
      'role pekerjaan',
      'posisi pekerjaan',
      'jabatan lulusan',
      'pekerjaan lulusan',
      'job role'
    ],
    secondaryHints: ['pekerjaan', 'karir', 'karier'],
    compatibleDocCategories: ['PROSPEK_KERJA'],
    compatibleCategories: ['PROSPEK_KERJA', 'KARIR'],
    incompatibleDocCategories: ['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA']
  },
  graduateProfile: {
    field: 'graduateProfile',
    family: CANONICAL_FIELD_FAMILIES.CAREER,
    naturalSemantics: 'profil lulusan kompetensi lulusan capaian lulusan graduate profile profesi pekerjaan lulusan',
    primaryHints: [
      'profil lulusan',
      'kompetensi lulusan',
      'capaian lulusan',
      'pekerjaan lulusan',
      'lulusan dapat bekerja',
      'lulusan siap kerja',
      'graduate profile'
    ],
    secondaryHints: ['profil', 'lulusan', 'karir'],
    compatibleDocCategories: ['PROSPEK_KERJA', 'PRODI_PROFILE'],
    compatibleCategories: ['PROSPEK_KERJA', 'KARIR'],
    incompatibleDocCategories: ['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA']
  },
  profession: {
    field: 'profession',
    family: CANONICAL_FIELD_FAMILIES.CAREER,
    naturalSemantics: 'profesi pekerjaan keahlian karir profession bidang profesi profesi lulusan',
    primaryHints: ['profesi lulusan', 'bidang profesi', 'keahlian profesi', 'pekerjaan lulusan', 'profesi kerja', 'profession'],
    secondaryHints: ['karir', 'pekerjaan'],
    compatibleDocCategories: ['PROSPEK_KERJA'],
    compatibleCategories: ['PROSPEK_KERJA', 'KARIR'],
    incompatibleDocCategories: ['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA']
  },
  prospect: {
    field: 'prospect',
    family: CANONICAL_FIELD_FAMILIES.CAREER,
    naturalSemantics: 'prospek kerja peluang kerja masa depan prospek karir',
    primaryHints: ['prospek kerja', 'peluang kerja', 'masa depan', 'prospek karir', 'peluang karier'],
    secondaryHints: ['karir', 'pekerjaan'],
    compatibleDocCategories: ['PROSPEK_KERJA'],
    compatibleCategories: ['PROSPEK_KERJA', 'KARIR'],
    incompatibleDocCategories: ['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA']
  },
  careerProspect: {
    field: 'careerProspect',
    family: CANONICAL_FIELD_FAMILIES.CAREER,
    naturalSemantics: 'prospek kerja peluang karir profesi lulusan lapangan kerja',
    primaryHints: ['prospek kerja', 'peluang karir', 'profesi lulusan', 'lapangan kerja'],
    secondaryHints: ['karir', 'pekerjaan'],
    compatibleDocCategories: ['PROSPEK_KERJA'],
    compatibleCategories: ['PROSPEK_KERJA', 'KARIR'],
    incompatibleDocCategories: ['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA']
  },
  careerProspects: {
    field: 'careerProspects',
    family: CANONICAL_FIELD_FAMILIES.CAREER,
    naturalSemantics: 'prospek kerja peluang karir profesi lulusan lapangan kerja',
    primaryHints: ['prospek kerja', 'peluang karir', 'profesi lulusan', 'lapangan kerja'],
    secondaryHints: ['karir', 'pekerjaan'],
    compatibleDocCategories: ['PROSPEK_KERJA'],
    compatibleCategories: ['PROSPEK_KERJA', 'KARIR'],
    incompatibleDocCategories: ['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA']
  },
  jobRoles: {
    field: 'jobRoles',
    family: CANONICAL_FIELD_FAMILIES.CAREER,
    naturalSemantics: 'posisi kerja bidang kerja role pekerjaan profil lulusan',
    primaryHints: ['posisi kerja', 'bidang kerja', 'role pekerjaan', 'profil lulusan'],
    secondaryHints: ['karir', 'profesi'],
    compatibleDocCategories: ['PROSPEK_KERJA'],
    compatibleCategories: ['PROSPEK_KERJA', 'KARIR'],
    incompatibleDocCategories: ['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA']
  },

  // ==========================================
  // 2. PROGRAM FIT FAMILY
  // ==========================================
  programRecommendation: {
    field: 'programRecommendation',
    family: CANONICAL_FIELD_FAMILIES.PROGRAM_FIT,
    naturalSemantics: 'rekomendasi program studi pilihan jurusan kecocokan minat bakat peminatan studi bidang keahlian',
    primaryHints: [
      'rekomendasi program studi',
      'pilihan jurusan',
      'kecocokan minat',
      'peminatan studi',
      'bidang keahlian',
      'keahlian',
      'kompetensi',
      'spesialisasi',
      'prodi yang cocok',
      'jurusan yang relevan',
      'program recommendation'
    ],
    secondaryHints: ['program studi', 'prodi', 'jurusan', 'bidang studi'],
    compatibleDocCategories: ['PRODI_PROFILE', 'KURIKULUM', 'PROGRAM_KHUSUS', 'KOMPETENSI'],
    compatibleCategories: ['PRODI_PROFILE', 'KURIKULUM'],
    incompatibleDocCategories: ['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA']
  },
  careerGoal: {
    field: 'careerGoal',
    family: CANONICAL_FIELD_FAMILIES.PROGRAM_FIT,
    naturalSemantics: 'tujuan karir cita-cita minat profesi prospek pekerjaan minat studi kecocokan jurusan',
    primaryHints: [
      'tujuan karir',
      'tujuan karier',
      'cita-cita',
      'minat profesi',
      'profesi yang diminati',
      'prospek pekerjaan',
      'kecocokan jurusan'
    ],
    secondaryHints: ['karir', 'profesi', 'jurusan'],
    compatibleDocCategories: ['PRODI_PROFILE', 'PROSPEK_KERJA', 'KURIKULUM'],
    compatibleCategories: ['PRODI_PROFILE', 'PROSPEK_KERJA'],
    incompatibleDocCategories: ['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA']
  },

  // ==========================================
  // 3. ACADEMIC LEVEL FAMILY
  // ==========================================
  academicLevel: {
    field: 'academicLevel',
    family: CANONICAL_FIELD_FAMILIES.ACADEMIC_LEVEL,
    naturalSemantics: 'jenjang pendidikan strata diploma sarjana pascasarjana program studi diploma d3 sarjana s1 magister s2',
    primaryHints: [
      'jenjang pendidikan',
      'strata',
      'program sarjana',
      'program diploma',
      'program magister',
      'jenjang s1',
      'jenjang s2',
      'jenjang d3',
      'strata satu',
      'strata satu (s1)',
      'strata dua',
      '(s1)',
      '(d3)',
      '(s2)',
      'diploma 3',
      'diploma d3',
      'sarjana (s1)',
      'magister (s2)',
      'ahli madya',
      'tingkat pendidikan'
    ],
    secondaryHints: ['program studi', 'pendidikan', 'program'],
    compatibleDocCategories: ['PRODI_PROFILE', 'PROGRAM_KHUSUS'],
    compatibleCategories: ['PROGRAM_STUDI', 'PRODI_PROFILE'],
    incompatibleDocCategories: ['ADMINISTRASI', 'SCHEDULE', 'BIAYA', 'PEDOMAN', 'TATA_TERTIB', 'TUGAS_AKHIR', 'SK', 'AKREDITASI']
  },

  // ==========================================
  // 4. INTERNATIONAL FAMILY
  // ==========================================
  internationalExperience: {
    field: 'internationalExperience',
    family: CANONICAL_FIELD_FAMILIES.INTERNATIONAL,
    naturalSemantics: 'pengalaman internasional magang luar negeri student exchange studi global internasional pertukaran mahasiswa kerja sama global dual degree',
    primaryHints: [
      'pengalaman internasional',
      'pertukaran mahasiswa',
      'student exchange',
      'luar negeri',
      'kerja sama global',
      'dual degree',
      'double degree',
      'studi global',
      'magang luar negeri',
      'international experience',
      'exchange'
    ],
    secondaryHints: ['internasional', 'global', 'mitra luar negeri', 'kampus luar negeri'],
    compatibleDocCategories: ['PROGRAM_KHUSUS', 'KERJASAMA'],
    compatibleCategories: ['PROGRAM_KHUSUS'],
    incompatibleDocCategories: ['BIAYA', 'ADMINISTRASI', 'SCHEDULE', 'SK', 'FASILITAS']
  },
  exchange: {
    field: 'exchange',
    family: CANONICAL_FIELD_FAMILIES.INTERNATIONAL,
    naturalSemantics: 'pertukaran mahasiswa student exchange studi luar negeri program pertukaran',
    primaryHints: ['pertukaran mahasiswa', 'student exchange', 'exchange program', 'luar negeri'],
    secondaryHints: ['internasional', 'global'],
    compatibleDocCategories: ['PROGRAM_KHUSUS'],
    compatibleCategories: ['PROGRAM_KHUSUS'],
    incompatibleDocCategories: ['BIAYA', 'ADMINISTRASI', 'SCHEDULE', 'SK']
  },
  internationalProgram: {
    field: 'internationalProgram',
    family: CANONICAL_FIELD_FAMILIES.INTERNATIONAL,
    naturalSemantics: 'program internasional jalur internasional kelas internasional dual degree double degree kerja sama internasional',
    primaryHints: [
      'jalur internasional',
      'program internasional',
      'kelas internasional',
      'dual degree',
      'double degree',
      'kerja sama internasional'
    ],
    secondaryHints: ['internasional', 'global'],
    compatibleDocCategories: ['PROGRAM_KHUSUS'],
    compatibleCategories: ['PROGRAM_KHUSUS'],
    incompatibleDocCategories: ['BIAYA', 'ADMINISTRASI', 'SCHEDULE', 'SK']
  },
  international: {
    field: 'international',
    family: CANONICAL_FIELD_FAMILIES.INTERNATIONAL,
    naturalSemantics: 'program internasional pertukaran mahasiswa student exchange luar negeri kerja sama global dual degree',
    primaryHints: ['program internasional', 'pertukaran mahasiswa', 'student exchange', 'luar negeri', 'dual degree'],
    secondaryHints: ['internasional', 'global'],
    compatibleDocCategories: ['PROGRAM_KHUSUS'],
    compatibleCategories: ['PROGRAM_KHUSUS'],
    incompatibleDocCategories: ['BIAYA', 'ADMINISTRASI', 'SCHEDULE']
  },

  // ==========================================
  // 5. PROFILE & DESCRIPTION FAMILY
  // ==========================================
  profile: {
    field: 'profile',
    family: CANONICAL_FIELD_FAMILIES.PROFILE,
    naturalSemantics: 'profil gambaran umum visi misi tentang institusi program studi informasi sejarah latar belakang',
    primaryHints: ['profil', 'visi', 'misi', 'tentang', 'sejarah', 'gambaran umum'],
    secondaryHints: ['informasi', 'penjelasan'],
    compatibleDocCategories: ['PRODI_PROFILE', 'PROGRAM_KHUSUS', 'TENTANG_KAMPUS'],
    compatibleCategories: ['PRODI_PROFILE', 'PROGRAM_STUDI'],
    incompatibleDocCategories: []
  },
  description: {
    field: 'description',
    family: CANONICAL_FIELD_FAMILIES.PROFILE,
    naturalSemantics: 'apa itu pengertian definisi penjelasan gambaran tentang',
    primaryHints: ['apa itu', 'pengertian', 'definisi', 'penjelasan'],
    secondaryHints: ['gambaran', 'tentang'],
    compatibleDocCategories: ['PRODI_PROFILE', 'PROGRAM_KHUSUS'],
    compatibleCategories: ['PRODI_PROFILE'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 6. CONTACT & SOCIAL MEDIA FAMILY
  // ==========================================
  instagram: {
    field: 'instagram',
    family: CANONICAL_FIELD_FAMILIES.CONTACT,
    naturalSemantics: 'akun instagram resmi ig media sosial',
    primaryHints: ['instagram', 'ig'],
    secondaryHints: ['sosmed', 'social media', 'media sosial', 'akun resmi'],
    compatibleDocCategories: ['KONTAK', 'PROFIL'],
    compatibleCategories: ['PMB', 'PROFIL'],
    incompatibleDocCategories: []
  },
  tiktok: {
    field: 'tiktok',
    family: CANONICAL_FIELD_FAMILIES.CONTACT,
    naturalSemantics: 'akun tiktok resmi media sosial',
    primaryHints: ['tiktok'],
    secondaryHints: ['sosmed', 'social media', 'media sosial'],
    compatibleDocCategories: ['KONTAK'],
    compatibleCategories: ['PMB'],
    incompatibleDocCategories: []
  },
  facebook: {
    field: 'facebook',
    family: CANONICAL_FIELD_FAMILIES.CONTACT,
    naturalSemantics: 'akun facebook resmi fb media sosial',
    primaryHints: ['facebook', 'fb'],
    secondaryHints: ['sosmed', 'social media'],
    compatibleDocCategories: ['KONTAK'],
    compatibleCategories: ['PMB'],
    incompatibleDocCategories: []
  },
  youtube: {
    field: 'youtube',
    family: CANONICAL_FIELD_FAMILIES.CONTACT,
    naturalSemantics: 'kanal youtube resmi video profil',
    primaryHints: ['youtube'],
    secondaryHints: ['media sosial', 'video'],
    compatibleDocCategories: ['KONTAK'],
    compatibleCategories: ['PMB'],
    incompatibleDocCategories: []
  },
  phone: {
    field: 'phone',
    family: CANONICAL_FIELD_FAMILIES.CONTACT,
    naturalSemantics: 'telepon nomor telepon hotline call center kontak',
    primaryHints: ['telepon', 'nomor telepon', 'no telp', 'phone'],
    secondaryHints: ['kontak', 'hubungi', 'narahubung'],
    compatibleDocCategories: ['KONTAK'],
    compatibleCategories: ['PMB'],
    incompatibleDocCategories: []
  },
  whatsapp: {
    field: 'whatsapp',
    family: CANONICAL_FIELD_FAMILIES.CONTACT,
    naturalSemantics: 'nomor whatsapp wa chat pmb layanan informasi',
    primaryHints: ['whatsapp', 'wa', 'nomor wa'],
    secondaryHints: ['chat', 'kontak', 'narahubung'],
    compatibleDocCategories: ['KONTAK'],
    compatibleCategories: ['PMB'],
    incompatibleDocCategories: []
  },
  email: {
    field: 'email',
    family: CANONICAL_FIELD_FAMILIES.CONTACT,
    naturalSemantics: 'alamat email surel surat elektronik kontak',
    primaryHints: ['email', 'surel', 'e-mail'],
    secondaryHints: ['kontak', 'surat'],
    compatibleDocCategories: ['KONTAK'],
    compatibleCategories: ['PMB'],
    incompatibleDocCategories: []
  },
  contact: {
    field: 'contact',
    family: CANONICAL_FIELD_FAMILIES.CONTACT,
    naturalSemantics: 'kontak narahubung call center layanan informasi alamat',
    primaryHints: ['kontak', 'narahubung', 'call center', 'layanan informasi'],
    secondaryHints: ['alamat', 'hubungi'],
    compatibleDocCategories: ['KONTAK'],
    compatibleCategories: ['PMB'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 7. FINANCIAL & FEES FAMILY
  // ==========================================
  tuitionFee: {
    field: 'tuitionFee',
    family: CANONICAL_FIELD_FAMILIES.FINANCIAL,
    naturalSemantics: 'biaya kuliah uang kuliah rincian pembayaran spp ukt dpp tarif kuliah biaya semester',
    primaryHints: ['biaya kuliah', 'uang kuliah', 'spp', 'dpp', 'ukt', 'biaya semester'],
    secondaryHints: ['tarif', 'nominal', 'pembayaran'],
    compatibleDocCategories: ['BIAYA'],
    compatibleCategories: ['BIAYA'],
    incompatibleDocCategories: ['AKREDITASI', 'SK']
  },
  fee: {
    field: 'fee',
    family: CANONICAL_FIELD_FAMILIES.FINANCIAL,
    naturalSemantics: 'biaya kuliah uang kuliah rincian pembayaran spp ukt dpp tarif kuliah',
    primaryHints: ['biaya', 'uang kuliah', 'spp', 'dpp', 'ukt', 'tarif'],
    secondaryHints: ['pembayaran', 'nominal'],
    compatibleDocCategories: ['BIAYA'],
    compatibleCategories: ['BIAYA'],
    incompatibleDocCategories: ['AKREDITASI', 'SK']
  },
  tuition: {
    field: 'tuition',
    family: CANONICAL_FIELD_FAMILIES.FINANCIAL,
    naturalSemantics: 'biaya pendidikan tarif kuliah pembayaran cicilan',
    primaryHints: ['biaya pendidikan', 'tarif kuliah', 'uang kuliah'],
    secondaryHints: ['pembayaran', 'cicilan'],
    compatibleDocCategories: ['BIAYA'],
    compatibleCategories: ['BIAYA'],
    incompatibleDocCategories: []
  },
  registrationFee: {
    field: 'registrationFee',
    family: CANONICAL_FIELD_FAMILIES.FINANCIAL,
    naturalSemantics: 'biaya pendaftaran uang pendaftaran biaya formulir registrasi',
    primaryHints: ['biaya pendaftaran', 'uang pendaftaran', 'biaya formulir'],
    secondaryHints: ['pendaftaran', 'registrasi', 'bayar'],
    compatibleDocCategories: ['BIAYA'],
    compatibleCategories: ['BIAYA'],
    incompatibleDocCategories: []
  },
  dpp: {
    field: 'dpp',
    family: CANONICAL_FIELD_FAMILIES.FINANCIAL,
    naturalSemantics: 'dpp dana pengembangan pendidikan uang gedung biaya awal',
    primaryHints: ['dpp', 'dana pengembangan pendidikan', 'uang gedung'],
    secondaryHints: ['biaya awal', 'angsuran'],
    compatibleDocCategories: ['BIAYA'],
    compatibleCategories: ['BIAYA'],
    incompatibleDocCategories: []
  },
  spp: {
    field: 'spp',
    family: CANONICAL_FIELD_FAMILIES.FINANCIAL,
    naturalSemantics: 'spp sumbangan pembinaan pendidikan biaya per semester biaya rutin',
    primaryHints: ['spp', 'sumbangan pembinaan pendidikan', 'biaya per semester'],
    secondaryHints: ['biaya rutin', 'angsuran'],
    compatibleDocCategories: ['BIAYA'],
    compatibleCategories: ['BIAYA'],
    incompatibleDocCategories: []
  },
  scholarship: {
    field: 'scholarship',
    family: CANONICAL_FIELD_FAMILIES.FINANCIAL,
    naturalSemantics: 'beasiswa potongan biaya bantuan pendidikan keringanan kip kip kuliah',
    primaryHints: ['beasiswa', 'kip', 'kip kuliah', 'potongan biaya', 'keringanan'],
    secondaryHints: ['bantuan', 'syarat beasiswa'],
    compatibleDocCategories: ['BIAYA', 'BEASISWA'],
    compatibleCategories: ['BEASISWA', 'BIAYA'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 8. INSTITUTIONAL HISTORY FAMILY
  // ==========================================
  foundingDate: {
    field: 'foundingDate',
    family: CANONICAL_FIELD_FAMILIES.HISTORY,
    naturalSemantics: 'tahun berdiri berdiri berdirinya didirikan tanggal berdiri hari jadi pendirian yayasan',
    primaryHints: ['tahun berdiri', 'berdiri', 'berdirinya', 'didirikan', 'tanggal berdiri', 'hari jadi', 'pendirian yayasan', 'sejarah'],
    secondaryHints: ['sejarah', 'profil', 'tentang', 'yayasan', 'pendiri'],
    compatibleDocCategories: ['PROFIL', 'TENTANG_KAMPUS'],
    compatibleCategories: ['PROFIL'],
    incompatibleDocCategories: []
  },
  legalDecreeDate: {
    field: 'legalDecreeDate',
    family: CANONICAL_FIELD_FAMILIES.HISTORY,
    naturalSemantics: 'izin operasional sk mendiknas sk menteri tanggal sk resmi berdiri izin pendirian',
    primaryHints: ['izin operasional', 'sk mendiknas', 'sk menteri', 'tanggal sk', 'resmi berdiri', 'izin pendirian'],
    secondaryHints: ['sk mendiknas', 'legalitas', 'izin operasional'],
    compatibleDocCategories: ['SK', 'LEGALITAS'],
    compatibleCategories: ['SK'],
    incompatibleDocCategories: []
  },
  founderNames: {
    field: 'founderNames',
    family: CANONICAL_FIELD_FAMILIES.HISTORY,
    naturalSemantics: 'pendiri tokoh pendiri siapa yang mendirikan didirikan oleh penggagas perintis yayasan',
    primaryHints: ['pendiri', 'tokoh pendiri', 'siapa yang mendirikan', 'didirikan oleh', 'penggagas', 'perintis'],
    secondaryHints: ['sejarah', 'profil', 'yayasan'],
    compatibleDocCategories: ['PROFIL'],
    compatibleCategories: ['PROFIL'],
    incompatibleDocCategories: []
  },
  history: {
    field: 'history',
    family: CANONICAL_FIELD_FAMILIES.HISTORY,
    naturalSemantics: 'sejarah awal mula berdiri didirikan perkembangan',
    primaryHints: ['sejarah', 'awal mula', 'berdiri', 'didirikan'],
    secondaryHints: ['profil', 'tentang'],
    compatibleDocCategories: ['PROFIL'],
    compatibleCategories: ['PROFIL'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 9. CERTIFICATION & ACADEMIC QUALITY
  // ==========================================
  accreditation: {
    field: 'accreditation',
    family: CANONICAL_FIELD_FAMILIES.ACADEMIC_QUALITY,
    naturalSemantics: 'akreditasi ban-pt lam infokom peringkat akreditasi terakreditasi',
    primaryHints: ['akreditasi', 'ban-pt', 'peringkat akreditasi', 'terakreditasi', 'lam infokom'],
    secondaryHints: ['mutu', 'status'],
    compatibleDocCategories: ['AKREDITASI'],
    compatibleCategories: ['AKREDITASI'],
    incompatibleDocCategories: ['BIAYA']
  },
  certification: {
    field: 'certification',
    family: CANONICAL_FIELD_FAMILIES.CERTIFICATION,
    naturalSemantics: 'sertifikasi sertifikat kompetensi keahlian profesi bnsp lsp',
    primaryHints: ['sertifikasi', 'sertifikat kompetensi', 'kompetensi'],
    secondaryHints: ['keahlian', 'profesi'],
    compatibleDocCategories: ['KOMPETENSI', 'PRODI_PROFILE'],
    compatibleCategories: ['KOMPETENSI'],
    incompatibleDocCategories: ['BIAYA']
  },
  competencyCertification: {
    field: 'competencyCertification',
    family: CANONICAL_FIELD_FAMILIES.CERTIFICATION,
    naturalSemantics: 'sertifikasi kompetensi sertifikasi profesi sertifikasi keahlian bnsp lsp',
    primaryHints: ['sertifikasi kompetensi', 'sertifikasi profesi', 'sertifikasi keahlian', 'bnsp', 'lsp'],
    secondaryHints: ['sertifikasi', 'kompetensi', 'lulusan', 'keahlian'],
    compatibleDocCategories: ['KOMPETENSI', 'PRODI_PROFILE'],
    compatibleCategories: ['KOMPETENSI'],
    incompatibleDocCategories: ['BIAYA']
  },
  vendorCertifications: {
    field: 'vendorCertifications',
    family: CANONICAL_FIELD_FAMILIES.CERTIFICATION,
    naturalSemantics: 'sertifikasi internasional vendor certification mikrotik cisco oracle redhat',
    primaryHints: ['sertifikasi internasional', 'vendor certification', 'mikrotik', 'cisco', 'oracle', 'redhat'],
    secondaryHints: ['sertifikasi', 'kompetensi'],
    compatibleDocCategories: ['KOMPETENSI', 'PRODI_PROFILE'],
    compatibleCategories: ['KOMPETENSI'],
    incompatibleDocCategories: []
  },
  degree: {
    field: 'degree',
    family: CANONICAL_FIELD_FAMILIES.ACADEMIC_QUALITY,
    naturalSemantics: 'gelar lulusan sebutan gelar sarjana magister ahli madya',
    primaryHints: ['gelar', 'lulusan', 'sebutan gelar', 'sarjana', 'magister', 'ahli madya'],
    secondaryHints: ['kualifikasi', 'strata'],
    compatibleDocCategories: ['PRODI_PROFILE'],
    compatibleCategories: ['PROGRAM_STUDI'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 10. CURRICULUM
  // ==========================================
  curriculum: {
    field: 'curriculum',
    family: CANONICAL_FIELD_FAMILIES.CURRICULUM,
    naturalSemantics: 'kurikulum mata kuliah silabus materi perkuliahan pembelajaran sks',
    primaryHints: ['kurikulum', 'mata kuliah', 'matkul', 'pembelajaran', 'sks'],
    secondaryHints: ['rencana studi', 'akademik'],
    compatibleDocCategories: ['KURIKULUM', 'PRODI_PROFILE'],
    compatibleCategories: ['KURIKULUM'],
    incompatibleDocCategories: ['BIAYA', 'SK']
  },
  courseList: {
    field: 'courseList',
    family: CANONICAL_FIELD_FAMILIES.CURRICULUM,
    naturalSemantics: 'daftar mata kuliah sebaran matkul silabus kurikulum',
    primaryHints: ['daftar mata kuliah', 'sebaran matkul', 'silabus'],
    secondaryHints: ['kurikulum', 'akademik'],
    compatibleDocCategories: ['KURIKULUM'],
    compatibleCategories: ['KURIKULUM'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 11. ADMISSIONS & PROCEDURES
  // ==========================================
  requirements: {
    field: 'requirements',
    family: CANONICAL_FIELD_FAMILIES.PROCEDURE,
    naturalSemantics: 'syarat berkas dokumen persyaratan pendaftaran kriteria kualifikasi',
    primaryHints: ['syarat', 'persyaratan', 'berkas', 'dokumen pendaftaran', 'kriteria'],
    secondaryHints: ['alur pendaftaran', 'ketentuan'],
    compatibleDocCategories: ['SYARAT', 'PMB'],
    compatibleCategories: ['PMB'],
    incompatibleDocCategories: []
  },
  procedureSteps: {
    field: 'procedureSteps',
    family: CANONICAL_FIELD_FAMILIES.PROCEDURE,
    naturalSemantics: 'cara daftar alur pendaftaran tahapan pendaftaran prosedur langkah-langkah',
    primaryHints: ['cara daftar', 'alur pendaftaran', 'tahapan pendaftaran', 'prosedur'],
    secondaryHints: ['langkah-langkah', 'pendaftaran'],
    compatibleDocCategories: ['PMB'],
    compatibleCategories: ['PMB'],
    incompatibleDocCategories: []
  },
  schedule: {
    field: 'schedule',
    family: CANONICAL_FIELD_FAMILIES.PROCEDURE,
    naturalSemantics: 'jadwal gelombang periode pendaftaran waktu pendaftaran tanggal batas waktu',
    primaryHints: ['jadwal', 'gelombang', 'periode pendaftaran', 'waktu pendaftaran', 'tanggal'],
    secondaryHints: ['batas waktu', 'deadline'],
    compatibleDocCategories: ['SCHEDULE', 'PMB'],
    compatibleCategories: ['SCHEDULE', 'PMB'],
    incompatibleDocCategories: []
  },
  registrationWave: {
    field: 'registrationWave',
    family: CANONICAL_FIELD_FAMILIES.PROCEDURE,
    naturalSemantics: 'gelombang gelombang 1 gelombang 2 gelombang 3 jadwal gelombang periode',
    primaryHints: ['gelombang', 'gelombang 1', 'gelombang 2', 'gelombang 3', 'jadwal gelombang'],
    secondaryHints: ['periode', 'pmb'],
    compatibleDocCategories: ['SCHEDULE', 'PMB'],
    compatibleCategories: ['PMB'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 12. DURATION & TEMPORAL
  // ==========================================
  duration: {
    field: 'duration',
    family: 'temporal_duration',
    naturalSemantics: 'durasi masa studi lama studi berapa tahun berapa semester jangka waktu',
    primaryHints: ['durasi', 'masa studi', 'lama studi', 'berapa tahun', 'berapa semester', 'jangka waktu'],
    secondaryHints: ['semester', 'tahun', 'perkuliahan'],
    compatibleDocCategories: ['PRODI_PROFILE', 'KURIKULUM'],
    compatibleCategories: ['PROGRAM_STUDI'],
    incompatibleDocCategories: ['BIAYA']
  },
  studyTimeline: {
    field: 'studyTimeline',
    family: 'temporal_duration',
    naturalSemantics: 'timeline studi tahapan kuliah skema studi pembagian semester',
    primaryHints: ['timeline studi', 'tahapan kuliah', 'skema studi', 'pembagian semester'],
    secondaryHints: ['jadwal kuliah', 'tahunan'],
    compatibleDocCategories: ['PROGRAM_KHUSUS', 'KURIKULUM'],
    compatibleCategories: ['PROGRAM_STUDI'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 13. FACILITIES
  // ==========================================
  facilities: {
    field: 'facilities',
    family: 'facility',
    naturalSemantics: 'fasilitas sarana laboratorium gedung prasarana kampus akses layanan',
    primaryHints: ['fasilitas', 'sarana', 'laboratorium', 'lab', 'gedung', 'prasarana'],
    secondaryHints: ['kampus', 'layanan'],
    compatibleDocCategories: ['FASILITAS'],
    compatibleCategories: ['FASILITAS'],
    incompatibleDocCategories: []
  },
  facility: {
    field: 'facility',
    family: 'facility',
    naturalSemantics: 'fasilitas sarana laboratorium gedung prasarana kampus akses layanan',
    primaryHints: ['fasilitas', 'sarana', 'laboratorium', 'lab', 'gedung', 'prasarana'],
    secondaryHints: ['kampus', 'layanan'],
    compatibleDocCategories: ['FASILITAS'],
    compatibleCategories: ['FASILITAS'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 14. DOCUMENT PURPOSE & GOVERNANCE
  // ==========================================
  documentPurpose: {
    field: 'documentPurpose',
    family: CANONICAL_FIELD_FAMILIES.GOVERNANCE,
    naturalSemantics: 'tujuan dokumen maksud dokumen fungsi dokumen indikator kinerja pelaporan kinerja',
    primaryHints: ['tujuan dokumen', 'maksud dokumen', 'fungsi dokumen', 'indikator kinerja', 'pelaporan kinerja', 'tujuan', 'maksud'],
    secondaryHints: ['dokumen', 'tata kelola', 'lldikti', 'kinerja', 'formulir'],
    compatibleDocCategories: ['PEDOMAN', 'SK', 'LAPORAN'],
    compatibleCategories: ['PEDOMAN', 'SK'],
    incompatibleDocCategories: []
  },
  purpose: {
    field: 'purpose',
    family: CANONICAL_FIELD_FAMILIES.GOVERNANCE,
    naturalSemantics: 'tujuan maksud fungsi kegunaan peruntukan',
    primaryHints: ['tujuan', 'maksud', 'fungsi', 'kegunaan', 'peruntukan'],
    secondaryHints: ['tata kelola', 'profil', 'dokumen'],
    compatibleDocCategories: ['PEDOMAN', 'SK'],
    compatibleCategories: ['PEDOMAN'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 15. COMPARISON & CONTRAST
  // ==========================================
  contrast: {
    field: 'contrast',
    family: 'comparison',
    naturalSemantics: 'perbedaan beda perbandingan apakah sama setara program deskripsi',
    primaryHints: ['perbedaan', 'beda', 'perbandingan', 'apakah sama', 'setara', 'program', 'deskripsi'],
    secondaryHints: ['program', 'karakteristik', 'keunggulan', 'profil'],
    compatibleDocCategories: ['PRODI_PROFILE', 'PROGRAM_KHUSUS'],
    compatibleCategories: ['PROGRAM_STUDI'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 16. ADMINISTRATIVE / SKTT
  // ==========================================
  sktt: {
    field: 'sktt',
    family: CANONICAL_FIELD_FAMILIES.PROCEDURE,
    naturalSemantics: 'sktt surat keterangan tempat tinggal syarat sktt dokumen sktt domisili mahasiswa asing',
    primaryHints: ['sktt', 'surat keterangan tempat tinggal', 'syarat sktt', 'dokumen sktt'],
    secondaryHints: ['disdukcapil', 'domisili', 'mahasiswa asing', 'izin tinggal', 'syarat'],
    compatibleDocCategories: ['ADMINISTRASI', 'SYARAT'],
    compatibleCategories: ['ADMINISTRASI'],
    incompatibleDocCategories: []
  },

  // ==========================================
  // 17. GEOGRAPHIC DESTINATION
  // ==========================================
  studyLocation: {
    field: 'studyLocation',
    family: CANONICAL_FIELD_FAMILIES.GEOGRAPHIC,
    naturalSemantics: 'negara tujuan negara mitra tujuan negara destinasi ke negara mana negara partner',
    primaryHints: ['negara tujuan', 'negara mitra', 'tujuan negara', 'destinasi', 'ke negara mana', 'negara partner', 'negara pertukaran', 'negara'],
    secondaryHints: ['pertukaran mahasiswa', 'student exchange', 'luar negeri', 'kampus mitra'],
    compatibleDocCategories: ['PROGRAM_KHUSUS'],
    compatibleCategories: ['PROGRAM_KHUSUS'],
    incompatibleDocCategories: []
  },
  destinationCountry: {
    field: 'destinationCountry',
    family: CANONICAL_FIELD_FAMILIES.GEOGRAPHIC,
    naturalSemantics: 'negara tujuan negara mitra tujuan negara destinasi ke negara mana negara partner',
    primaryHints: ['negara tujuan', 'negara mitra', 'tujuan negara', 'destinasi', 'ke negara mana', 'negara partner', 'negara pertukaran', 'negara'],
    secondaryHints: ['pertukaran mahasiswa', 'student exchange', 'luar negeri', 'kampus mitra'],
    compatibleDocCategories: ['PROGRAM_KHUSUS'],
    compatibleCategories: ['PROGRAM_KHUSUS'],
    incompatibleDocCategories: []
  },
  country: {
    field: 'country',
    family: CANONICAL_FIELD_FAMILIES.GEOGRAPHIC,
    naturalSemantics: 'negara tujuan negara mitra tujuan negara destinasi ke negara mana negara partner',
    primaryHints: ['negara tujuan', 'negara mitra', 'tujuan negara', 'destinasi', 'ke negara mana', 'negara partner', 'negara pertukaran', 'negara'],
    secondaryHints: ['pertukaran mahasiswa', 'student exchange', 'luar negeri', 'kampus mitra'],
    compatibleDocCategories: ['PROGRAM_KHUSUS'],
    compatibleCategories: ['PROGRAM_KHUSUS'],
    incompatibleDocCategories: []
  }
});

/**
 * Returns canonical field definition or creates a safe fallback for unknown fields.
 */
function getCanonicalFieldDefinition(field) {
  const norm = String(field || '').trim();
  if (CANONICAL_FIELD_DEFINITIONS[norm]) {
    return CANONICAL_FIELD_DEFINITIONS[norm];
  }
  // Case-insensitive lookup fallback
  const fLower = norm.toLowerCase();
  for (const [k, def] of Object.entries(CANONICAL_FIELD_DEFINITIONS)) {
    if (k.toLowerCase() === fLower) return def;
  }
  return {
    field: norm,
    family: norm,
    naturalSemantics: norm,
    primaryHints: [norm],
    secondaryHints: [],
    compatibleDocCategories: [],
    compatibleCategories: [],
    incompatibleDocCategories: []
  };
}

function getFieldFamily(field) {
  return getCanonicalFieldDefinition(field).family;
}

function getFieldNaturalSemantics(field) {
  return getCanonicalFieldDefinition(field).naturalSemantics;
}

function getFieldHints(field) {
  const def = getCanonicalFieldDefinition(field);
  return {
    primaryFieldHints: [...def.primaryHints],
    secondaryFamilyHints: [...def.secondaryHints]
  };
}

function getFieldSynonyms(field) {
  return getCanonicalFieldDefinition(field).primaryHints;
}

/**
 * Evaluates generic structural compatibility between a requested field and candidate chunk metadata.
 * Prohibits filename rules and broad PROGRAM_STUDI category over-boosting.
 *
 * @param {string} field
 * @param {string} docCategory
 * @param {string} category
 * @returns {number} Score adjustment (+0.02, +0.005, -0.02, etc.)
 */
function evaluateCategoryCompatibility(field, docCategory, category) {
  const def = getCanonicalFieldDefinition(field);
  const family = def.family;

  const docCat = docCategory ? String(docCategory).toUpperCase().trim() : null;
  const cat = category ? String(category).toUpperCase().trim() : null;

  // 1. Check generic incompatible document categories (administrative documents)
  if (Array.isArray(def.incompatibleDocCategories) && def.incompatibleDocCategories.length > 0) {
    if (docCat && def.incompatibleDocCategories.includes(docCat)) {
      return -0.02;
    }
    // If docCategory is missing or unknown, check coarse category
    if (!docCat || docCat === 'UNKNOWN') {
      if (cat && def.incompatibleDocCategories.includes(cat)) {
        return -0.02;
      }
    }
  }

  // 2. Specific family compatibility rules
  if (family === CANONICAL_FIELD_FAMILIES.CAREER) {
    if (docCat === 'PROSPEK_KERJA' || cat === 'PROSPEK_KERJA' || cat === 'KARIR') {
      return 0.02;
    }
    if (docCat === 'PRODI_PROFILE') {
      return 0.005;
    }
    if (['ADMINISTRASI', 'SCHEDULE', 'SK', 'AKREDITASI', 'PEDOMAN', 'TATA_TERTIB'].includes(docCat || cat)) {
      return -0.02;
    }
  } else if (family === CANONICAL_FIELD_FAMILIES.PROGRAM_FIT) {
    // Crucial: category=PROGRAM_STUDI alone does NOT grant +0.02!
    // Must be an actual program profile or curriculum document.
    if (docCat === 'PRODI_PROFILE' || docCat === 'KURIKULUM' || docCat === 'KOMPETENSI' || docCat === 'PROGRAM_KHUSUS') {
      return 0.02;
    }
    if (['AKREDITASI', 'SK', 'PEDOMAN', 'TATA_TERTIB', 'ADMINISTRASI', 'SCHEDULE', 'BIAYA'].includes(docCat || cat)) {
      return -0.02;
    }
  } else if (family === CANONICAL_FIELD_FAMILIES.INTERNATIONAL) {
    if (docCat === 'PROGRAM_KHUSUS' || cat === 'PROGRAM_KHUSUS' || docCat === 'KERJASAMA') {
      return 0.02;
    }
    if (docCat === 'BIAYA' || cat === 'BIAYA') {
      return -0.015;
    }
    if (['AKREDITASI', 'SK', 'ADMINISTRASI'].includes(docCat || cat)) {
      return -0.02;
    }
  } else if (family === CANONICAL_FIELD_FAMILIES.FINANCIAL) {
    if (docCat === 'BIAYA' || cat === 'BIAYA' || cat === 'BEASISWA') {
      return 0.02;
    }
  } else if (family === CANONICAL_FIELD_FAMILIES.PROFILE) {
    if (docCat === 'PRODI_PROFILE' || docCat === 'PROGRAM_KHUSUS' || docCat === 'TENTANG_KAMPUS') {
      return 0.01;
    }
  }

  // 3. Fallback to registry definition lists
  if (docCat && def.compatibleDocCategories.includes(docCat)) {
    return 0.02;
  }

  return 0;
}

module.exports = {
  CANONICAL_FIELD_FAMILIES,
  CANONICAL_FIELD_DEFINITIONS,
  getCanonicalFieldDefinition,
  getFieldFamily,
  getFieldNaturalSemantics,
  getFieldHints,
  getFieldSynonyms,
  evaluateCategoryCompatibility
};
