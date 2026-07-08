/**
 * Intent Classifier Module
 * 
 * Classifies user queries into specific intents to enable intent-aware retrieval.
 * Each intent has associated document categories and evidence requirements.
 */

const logger = require('../logger');

// ============================================================================
// INTENT DEFINITIONS & CLASSIFICATIONS
// ============================================================================

/**
 * Map of intent types with their properties
 */
const INTENT_CATALOG = {
  DEFINISI_PRODI: {
    key: 'DEFINISI_PRODI',
    label: 'Definisi Program Studi',
    docCategories: ['PRODI_PROFILE'],
    requiredEvidenceKeywords: ['pengertian', 'deskripsi', 'profil', 'tujuan', 'visi', 'misi', 'capaian pembelajaran', 'lulusan', 'fokus', 'bidang', 'keahlian'],
    forbiddenDocCategories: ['BIAYA', 'ADMINISTRASI', 'MOU', 'SK', 'SURAT', 'TEMPLATE'],
    description: 'Menanyakan tentang pengertian/definisi/deskripsi suatu program studi',
    examples: [
      'Apa itu Teknologi Informasi?',
      'Jelaskan tentang program SI',
      'Program Bisnis Digital itu apa?'
    ]
  },

  KURIKULUM_PEMBELAJARAN: {
    key: 'KURIKULUM_PEMBELAJARAN',
    label: 'Kurikulum & Pembelajaran',
    docCategories: ['KURIKULUM', 'MATA_KULIAH'],
    requiredEvidenceKeywords: ['mata kuliah', 'kurikulum', 'pembelajaran', 'dipelajari', 'materi', 'perkuliahan', 'silabus', 'bahan ajar', 'kompetesi', 'kompetensi', 'konsentrasi', 'bidang keahlian', 'skill', 'teknik'],
    forbiddenDocCategories: ['BIAYA', 'ADMINISTRASI', 'MOU', 'SURAT', 'TEMPLATE'],
    description: 'Menanyakan tentang kurikulum, mata kuliah, dan apa yang dipelajari',
    examples: [
      'TI belajar apa saja?',
      'Mata kuliah SI apa aja?',
      'Kurikulum BD terdiri dari apa?',
      'Apa saja yang dipelajari di Teknologi Informasi?'
    ]
  },

  PROSPEK_KERJA: {
    key: 'PROSPEK_KERJA',
    label: 'Prospek Kerja & Karir',
    docCategories: ['PROSPEK_KERJA'],
    requiredEvidenceKeywords: ['karir', 'prospek', 'kerja', 'profesi', 'pekerjaan', 'lulusan', 'peluang', 'industri', 'posisi', 'jabatan', 'gaji'],
    forbiddenDocCategories: ['BIAYA', 'ADMINISTRASI', 'MOU', 'SK', 'SURAT', 'TEMPLATE'],
    description: 'Menanyakan tentang prospek kerja dan peluang karir lulusan',
    examples: [
      'Prospek kerja TI apa?',
      'Lulusan SI kerja di mana?',
      'Peluang karir Bisnis Digital?',
      'Apa saja pekerjaan yang bisa dilakukan lulusan TI?'
    ]
  },

  BIAYA_PENDIDIKAN: {
    key: 'BIAYA_PENDIDIKAN',
    label: 'Biaya Pendidikan',
    docCategories: ['BIAYA'],
    requiredEvidenceKeywords: ['biaya', 'harga', 'mahal', 'murah', 'rp', 'rupiah', 'dpp', 'ukt', 'spp', 'pendaftaran', 'gelombang', 'kuliah', 'semester', 'bayar', 'iuran', 'tagihan'],
    forbiddenDocCategories: ['ADMINISTRASI', 'MOU', 'SK', 'SURAT', 'TEMPLATE'],
    description: 'Menanyakan tentang biaya pendidikan dan pembiayaan',
    examples: [
      'Berapa biaya TI?',
      'Brp DPP BD?',
      'Biaya kuliah SI per semester?',
      'Mahal tidak SI?'
    ]
  },

  AKREDITASI_PERINGKAT: {
    key: 'AKREDITASI_PERINGKAT',
    label: 'Akreditasi & Peringkat',
    docCategories: ['AKREDITASI'],
    requiredEvidenceKeywords: ['akreditasi', 'ban-pt', 'sertifikat', 'peringkat', 'ranking', 'terakreditasi', 'sk', 'nomor', 'berlaku', 'baik'],
    forbiddenDocCategories: ['ADMINISTRASI', 'MOU', 'SURAT', 'TEMPLATE'],
    description: 'Menanyakan tentang akreditasi dan peringkat program',
    examples: [
      'Akreditasi TI apa?',
      'Peringkat SI berapa?',
      'SK akreditasi BD?'
    ]
  },

  JADWAL_PENDAFTARAN: {
    key: 'JADWAL_PENDAFTARAN',
    label: 'Jadwal & Pendaftaran',
    docCategories: ['JADWAL'],
    requiredEvidenceKeywords: ['jadwal', 'gelombang', 'daftar', 'pendaftaran', 'deadline', 'tanggal', 'waktu', 'kapan', 'registrasi', 'pembukaan', 'tutup', 'tanggal mulai', 'tanggal akhir'],
    forbiddenDocCategories: ['ADMINISTRASI', 'MOU', 'SK', 'SURAT', 'TEMPLATE'],
    description: 'Menanyakan tentang jadwal pendaftaran dan gelombang penerimaan',
    examples: [
      'Kapan pendaftaran buka?',
      'Deadline gelombang 1?',
      'Jadwal daftar TI?'
    ]
  },

  BEASISWA: {
    key: 'BEASISWA',
    label: 'Beasiswa',
    docCategories: ['BEASISWA'],
    requiredEvidenceKeywords: ['beasiswa', 'scholarship', 'potongan', 'diskon', 'bantuan', 'pendanaan', 'biaya gratis', 'bantuan keuangan', 'program beasiswa', 'syarat beasiswa'],
    forbiddenDocCategories: ['ADMINISTRASI', 'MOU', 'SK', 'SURAT', 'TEMPLATE'],
    description: 'Menanyakan tentang beasiswa dan potongan biaya',
    examples: [
      'Ada beasiswa TI?',
      'Syarat beasiswa BD?',
      'Potongan biaya apa aja?'
    ]
  },

  LOKASI_KAMPUS: {
    key: 'LOKASI_KAMPUS',
    label: 'Lokasi Kampus',
    docCategories: ['LOKASI'],
    requiredEvidenceKeywords: ['lokasi', 'kampus', 'alamat', 'tempat', 'gedung', 'ruang kelas', 'lab', 'laboratorium', 'fasilitas', 'bali', 'china', 'jakarta', 'kota'],
    forbiddenDocCategories: ['ADMINISTRASI', 'MOU', 'SK', 'SURAT', 'TEMPLATE'],
    description: 'Menanyakan tentang lokasi kampus dan fasilitas',
    examples: [
      'TI di mana aja?',
      'Kampus BD di mana?',
      'Lokasi SI?'
    ]
  },

  PROGRAM_KHUSUS: {
    key: 'PROGRAM_KHUSUS',
    label: 'Program Khusus (Double Degree, Internasional)',
    docCategories: ['PROGRAM_KHUSUS'],
    requiredEvidenceKeywords: ['double degree', 'dual degree', 'internasional', 'dnui', 'utb', 'help', 'kelas internasional', 'kelas nasional', 'china', 'bali', 'malaysia', 'partner', 'kolaborasi'],
    forbiddenDocCategories: ['ADMINISTRASI', 'MOU', 'SK', 'SURAT', 'TEMPLATE'],
    description: 'Menanyakan tentang program khusus seperti double degree atau kelas internasional',
    examples: [
      'Ada double degree?',
      'Apa itu DNUI?',
      'TI bisa yang internasional?'
    ]
  },

  GENERAL: {
    key: 'GENERAL',
    label: 'Pertanyaan Umum',
    docCategories: ['PRODI_PROFILE', 'KURIKULUM', 'MATA_KULIAH', 'PROSPEK_KERJA', 'BIAYA', 'AKREDITASI', 'JADWAL', 'BEASISWA', 'LOKASI', 'PROGRAM_KHUSUS'],
    requiredEvidenceKeywords: [], // No strict requirement
    forbiddenDocCategories: ['ADMINISTRASI', 'MOU', 'SK', 'SURAT', 'TEMPLATE'],
    description: 'Pertanyaan yang tidak termasuk kategori spesifik',
    examples: []
  }
};

// ============================================================================
// INTENT DETECTION
// ============================================================================

/**
 * Classify user query into specific intent
 * @param {string} question - User's question
 * @returns {string} Intent key (e.g., 'DEFINISI_PRODI', 'BIAYA_PENDIDIKAN', 'GENERAL')
 */
function classifyIntent(question) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return 'GENERAL';

  // Prefer BIAYA_PENDIDIKAN when fee-related words co-occur with program indicators
  if (/\b(biaya|biaya\s+kuliah|biaya\s+pendidikan|ukt|dpp|rp|rupiah|brp|berapa|harga|spp|pendaftaran|gelombang|bayar)\b/i.test(q) &&
      /\b(prodi|program\s+studi|jurusan)\b/i.test(q)) {
    return 'BIAYA_PENDIDIKAN';
  }

  // KURIKULUM_PEMBELAJARAN
  if (/\b(belajar\s+apa|apa\s+yang\s+dipelajari|dipelajari|materi|perkuliahan|silabus|mata\s+kuliah|kurikulum|pembelajaran|kompetensi|skill|teknik|konsentrasi|bidang\s+keahlian|apa\s+saja|apa\s+aja)\b/i.test(q) &&
      /\b(prodi|program\s+studi|jurusan|si|ti|bd|sk|mi|dkv|trpl|teknologi informasi|sistem informasi|bisnis digital|sistem komputer|manajemen informatika)\b/i.test(q)) {
    return 'KURIKULUM_PEMBELAJARAN';
  }

  // DEFINISI_PRODI
  if (/\b(apa\s+itu|jelaskan|explain|pengertian|definisi|deskripsi|profil|fokus|tujuan)\b/i.test(q) &&
      /\b(prodi|program\s+studi|jurusan|program|si|ti|bd|sk|mi|dkv|trpl|teknologi informasi|sistem informasi|bisnis digital|sistem komputer|manajemen informatika)\b/i.test(q)) {
    return 'DEFINISI_PRODI';
  }

  // PROSPEK_KERJA
  if (/\b(prospek\s+kerja|lulusan\s+kerja|kerja\s+di\s+mana|karir|pekerjaan|profesi|peluang\s+kerja|prospek\s+lulusan)\b/i.test(q)) {
    return 'PROSPEK_KERJA';
  }

  // BIAYA_PENDIDIKAN
  if (/\b(biaya|harga|mahal|murah|brp|berapa|rp|rupiah|dpp|ukt|spp|bayar|pendaftaran|kuliah|semester|iuran|tagihan|potongan|diskon)\b/i.test(q) &&
      /\b(prodi|program\s+studi|jurusan|si|ti|bd|sk|mi|dkv|trpl|teknologi informasi|sistem informasi|bisnis digital|sistem komputer|manajemen informatika)\b/i.test(q)) {
    return 'BIAYA_PENDIDIKAN';
  }

  // JADWAL_PENDAFTARAN
  if (/\b(jadwal|gelombang|daftar|pendaftaran|deadline|tanggal|kapan|waktu|registrasi|pembukaan|tutup|mulai|akhir)\b/i.test(q)) {
    return 'JADWAL_PENDAFTARAN';
  }

  // AKREDITASI_PERINGKAT
  if (/\b(akreditasi|akredit|peringkat|ranking|ban-pt|sertifikat\s+akreditasi|terakreditasi|sk\s+akreditasi)\b/i.test(q)) {
    return 'AKREDITASI_PERINGKAT';
  }

  // BEASISWA
  if (/\b(beasiswa|scholarship|potongan|diskon|bantuan\s+keuangan|gratis|bantuan)\b/i.test(q)) {
    return 'BEASISWA';
  }

  // LOKASI_KAMPUS
  if (/\b(lokasi|kampus|alamat|tempat|mana\s+aja|di mana|fasilitas|gedung|lab|laboratorium)\b/i.test(q)) {
    return 'LOKASI_KAMPUS';
  }

  // PROGRAM_KHUSUS
  if (/\b(double\s+degree|dual\s+degree|internasional|dnui|utb|help|kelas\s+internasional|kelas\s+nasional|china|bali|malaysia|program\s+khusus)\b/i.test(q)) {
    return 'PROGRAM_KHUSUS';
  }

  return 'GENERAL';
}

/**
 * Get intent metadata and configuration
 * @param {string} intentKey - Intent key from classifyIntent
 * @returns {object} Intent configuration with categories, evidence keywords, etc.
 */
function getIntentConfig(intentKey) {
  const key = String(intentKey || '').toUpperCase().trim();
  return INTENT_CATALOG[key] || INTENT_CATALOG['GENERAL'];
}

/**
 * Get all document categories that are allowed for this intent
 * @param {string} intentKey - Intent key
 * @returns {Set<string>} Set of allowed document categories
 */
function getAllowedDocCategories(intentKey) {
  const config = getIntentConfig(intentKey);
  return new Set(config.docCategories || []);
}

/**
 * Get document categories that should be excluded for this intent
 * @param {string} intentKey - Intent key
 * @returns {Set<string>} Set of forbidden document categories
 */
function getForbiddenDocCategories(intentKey) {
  const config = getIntentConfig(intentKey);
  return new Set(config.forbiddenDocCategories || []);
}

/**
 * Get evidence keywords required for this intent
 * @param {string} intentKey - Intent key
 * @returns {string[]} Array of evidence keywords
 */
function getRequiredEvidenceKeywords(intentKey) {
  const config = getIntentConfig(intentKey);
  return config.requiredEvidenceKeywords || [];
}

/**
 * Determine if chunk should be filtered out based on intent
 * @param {object} chunk - RAG chunk with metadata
 * @param {string} intentKey - Intent key
 * @returns {object} {allowed: boolean, reason: string}
 */
function shouldIncludeChunkForIntent(chunk, intentKey) {
  if (!chunk) return { allowed: false, reason: 'chunk_is_null' };
  
  const chunkCategory = chunk.docCategory || chunk.category || 'UNKNOWN';
  const forbidden = getForbiddenDocCategories(intentKey);
  const allowed = getAllowedDocCategories(intentKey);

  // If chunk has forbidden category, reject
  if (forbidden.has(chunkCategory)) {
    return { allowed: false, reason: 'forbidden_category', category: chunkCategory };
  }

  // For GENERAL intent, allow all except forbidden
  if (intentKey === 'GENERAL') {
    return { allowed: true, reason: 'general_intent_allows_all' };
  }

  // For specific intent, chunk must be in allowed categories
  if (allowed.size > 0 && !allowed.has(chunkCategory)) {
    return { allowed: false, reason: 'not_in_allowed_categories', allowed: Array.from(allowed), category: chunkCategory };
  }

  return { allowed: true, reason: 'matches_intent_categories' };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Constants
  INTENT_CATALOG,

  // Functions
  classifyIntent,
  getIntentConfig,
  getAllowedDocCategories,
  getForbiddenDocCategories,
  getRequiredEvidenceKeywords,
  shouldIncludeChunkForIntent
};
