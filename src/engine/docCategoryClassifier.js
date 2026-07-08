/**
 * Document Category Classifier Module
 * 
 * Automatically classifies chunks/documents into specific categories during ingest.
 * This enables fine-grained document-type filtering at query time.
 */

const logger = require('../logger');

// ============================================================================
// DOCUMENT CATEGORY DEFINITIONS
// ============================================================================

const DOC_CATEGORIES = {
  PRODI_PROFILE: 'PRODI_PROFILE',
  KURIKULUM: 'KURIKULUM',
  MATA_KULIAH: 'MATA_KULIAH',
  PROSPEK_KERJA: 'PROSPEK_KERJA',
  BIAYA: 'BIAYA',
  AKREDITASI: 'AKREDITASI',
  BEASISWA: 'BEASISWA',
  LOKASI: 'LOKASI',
  PROGRAM_KHUSUS: 'PROGRAM_KHUSUS',
  JADWAL: 'JADWAL',
  MOU: 'MOU',
  ADMINISTRASI: 'ADMINISTRASI',
  SK: 'SK',
  SURAT: 'SURAT',
  TEMPLATE: 'TEMPLATE',
  UNKNOWN: 'UNKNOWN'
};

// Category detection patterns
const CATEGORY_PATTERNS = {
  [DOC_CATEGORIES.PRODI_PROFILE]: {
    patterns: [
      /\b(?:profil|profile)\s+(?:program|prodi|jurusan|studi)\b/i,
      /\b(?:tentang|about)\s+(?:program|prodi|jurusan)\b/i,
      /\b(?:penjelasan|penjelasan prodi|penjelasan semua program studi)\b/i,
      /\b(?:pengertian|definisi|deskripsi)\s+(?:program|prodi|jurusan|ti|si|bd|sk|mi)\b/i,
      /\b(?:visi|misi|tujuan)\s+(?:program|prodi|jurusan)\b/i,
      /\b(?:capaian pembelajaran|learning outcome|kompetensi lulusan)\b/i,
      /\b(?:profil lulusan|alumni profile|lulusan kami)\b/i,
      /^(?:profil|tentang|pengenalan)\b/i
    ],
    keyword_weight: 0.3,
    filePatterns: [/profile|profil|tentang|about|pengenalan|overview/i],
    minScore: 2
  },

  [DOC_CATEGORIES.KURIKULUM]: {
    patterns: [
      /\bkurikulum\b/i,
      /\b(?:struktur|susunan|rancangan)\s+(?:kurikulum|program|pembelajaran)\b/i,
      /\b(?:program|rencana)\s+pembelajaran\b/i,
      /\b(?:mata\s+kuliah|matakuliah|course|subject)\b/i,
      /\b(?:daftar\s+(?:mata\s+kuliah|matakuliah|courses))\b/i,
      /\b(?:struktur kurikulum|rps|rencana pembelajaran semester)\b/i,
      /\b(?:semester)\s+(?:1|2|3|4|5|6|7|8|i|ii|iii|iv|v|vi|vii|viii)\b/i,
      /\b(?:sks|credit|jam|pertemuan)\s+(?:mata\s+kuliah|matakuliah|pembelajaran)\b/i
    ],
    keyword_weight: 0.4,
    filePatterns: [/kurikulum|curriculum|course|matakuliah|struktur|penjelasan|penjelasan prodi/i],
    minScore: 2
  },

  [DOC_CATEGORIES.MATA_KULIAH]: {
    patterns: [
      /\b(?:mata\s+kuliah|matakuliah|mata kuliah|course|kursus|subject)\b/i,
      /\b(?:daftar|list)\s+(?:mata\s+kuliah|matakuliah|courses|subjects)\b/i,
      /\b(?:rincian|detail|penjelasan)\s+(?:mata\s+kuliah|matakuliah|course)\b/i,
      /\b(?:kode|code)\s+(?:mk|matakuliah|mata\s+kuliah|subject|course)\b/i,
      /\b(?:sks|credit|prerequisite|prasyarat)\b.*\b(?:mata\s+kuliah|matakuliah|course)\b/i,
      /\b(?:dosen|lecturer|instruktur|pembimbing)\s+(?:mata\s+kuliah|matakuliah|course)\b/i
    ],
    keyword_weight: 0.5,
    filePatterns: [/matakuliah|mata_kuliah|course|kode_mk|silabus|rps/i],
    minScore: 2
  },

  [DOC_CATEGORIES.PROSPEK_KERJA]: {
    patterns: [
      /\b(?:prospek|peluang)\s+(?:kerja|karir|career|employment)\b/i,
      /\b(?:lulusan|alumni)\s+(?:bekerja|kerja|work|employed)\b/i,
      /\b(?:profesi|pekerjaan|jabatan|position|job)\s+(?:lulusan|alumni|graduate)\b/i,
      /\b(?:industri|sektor|bidang)\s+(?:kerja|employment|pekerjaan)\b/i,
      /\b(?:karir|career)\s+(?:path|track|prospek|peluang)\b/i,
      /\b(?:dapat\s+menjadi|bisa\s+menjadi|could\s+become)\s+(?:engineer|developer|analyst|manager|consultant)\b/i
    ],
    keyword_weight: 0.35,
    filePatterns: [/prospek|career|kerja|employment|lulusan|alumni/i],
    minScore: 2
  },

  [DOC_CATEGORIES.BIAYA]: {
    patterns: [
      /\b(?:biaya|biaya pendidikan|pendidikan|cost|fee|tuition)\b/i,
      /\b(?:rincian|detail|breakdown)\s+(?:biaya|cost|fee|payment)\b/i,
      /\b(?:dpp|ukt|spp|sumbangan|iuran|payment)\b/i,
      /\b(?:rp\.?|rupiah|\d+\s+(?:juta|ribu|rb|jt))\b/i,
      /\b(?:semester|tahun|tahap|gelombang)\s+(?:biaya|cost|fee|pendaftaran)\b/i,
      /\b(?:harga|tarif|nominal|amount)\s+(?:pendaftaran|kuliah|pendidikan)\b/i,
      /\b(?:pembayaran|payment|bayar|iuran|potongan|diskon)\b/i
    ],
    keyword_weight: 0.5,
    filePatterns: [/biaya|cost|fee|tuition|payment|tarif|harga|rp/i],
    minScore: 2
  },

  [DOC_CATEGORIES.AKREDITASI]: {
    patterns: [
      /\b(?:akreditasi|terakreditasi|accredited|accreditation)\b/i,
      /\b(?:ban-pt|badan\s+akreditasi|sertifikat\s+akreditasi)\b/i,
      /\b(?:peringkat|ranking|grade|a|b|c)\s+(?:akreditasi|accreditation)\b/i,
      /\b(?:sk|surat\s+keputusan|nomor\s+sk)\b[\s\S]{0,200}?\b(?:akreditasi|ban-pt)\b/i,
      /\b(?:berlaku|validity|masa\s+berlaku)\s+(?:akreditasi|sertifikat)\b/i
    ],
    keyword_weight: 0.4,
    filePatterns: [/akreditasi|accreditation|ban-pt|sertifikat|ranking/i],
    minScore: 2
  },

  [DOC_CATEGORIES.BEASISWA]: {
    patterns: [
      /\b(?:beasiswa|scholarship|bantuan|grant|aid|scholarship program)\b/i,
      /\b(?:potongan\s+biaya|diskon|subsidi)\s+(?:pendidikan|kuliah|tuition)\b/i,
      /\b(?:syarat|kriteria|ketentuan)\s+(?:beasiswa|scholarship)\b/i,
      /\b(?:program\s+beasiswa|bantuan\s+pendidikan|financial\s+aid)\b/i,
      /\b(?:penerima\s+beasiswa|beasiswa\s+penuh|partial\s+scholarship)\b/i
    ],
    keyword_weight: 0.4,
    filePatterns: [/beasiswa|scholarship|grant|bantuan|aid/i],
    minScore: 2
  },

  [DOC_CATEGORIES.LOKASI]: {
    patterns: [
      /\b(?:lokasi|location|alamat|address|tempat)\s+(?:kampus|campus|kuliah|office)\b/i,
      /\b(?:gedung|ruang|lab|laboratorium|fasilitas|building|facility)\b/i,
      /\b(?:di\s+(?:jakarta|bali|surabaya|bandung|medan|yogyakarta|makassar|medan|china|malaysia|beijing))\b/i,
      /\b(?:jalan|jl|alamat|address|tepatnya\s+di)\b[\s\S]{0,150}?\b(?:jakarta|bali|surabaya|bandung|medan|yogyakarta|makassar|china|malaysia)\b/i,
      /\b(?:kampus\s+utama|main\s+campus|kampus\s+cabang|branch\s+campus)\b/i
    ],
    keyword_weight: 0.35,
    filePatterns: [/lokasi|location|alamat|address|kampus|gedung/i],
    minScore: 2
  },

  [DOC_CATEGORIES.PROGRAM_KHUSUS]: {
    patterns: [
      /\b(?:double\s+degree|dual\s+degree|program\s+khusus|special\s+program)\b/i,
      /\b(?:kelas\s+internasional|international\s+class|kelas\s+nasional|national\s+class)\b/i,
      /\b(?:dnui|utb|help|malaysia|bali|china|internasional)\b/i,
      /\b(?:program\s+kerjasama|kerjasama\s+internasional|international\s+collaboration)\b/i,
      /\b(?:mitra|partner|partnership|kolaborasi)\s+(?:universitas|university|program|pendidikan)\b/i,
      /\b(?:tukar\s+pelajar|student\s+exchange|abroad|luar\s+negeri)\b/i
    ],
    keyword_weight: 0.4,
    filePatterns: [/double_degree|dnui|utb|help|international|kelas_internasional|program_khusus/i],
    minScore: 2
  },

  [DOC_CATEGORIES.JADWAL]: {
    patterns: [
      /\b(?:jadwal|schedule|timeline|waktu|time)\s+(?:pendaftaran|registration|daftar|pembukaan|opening|tutup|closing)\b/i,
      /\b(?:gelombang|wave|tahap|round|fase)\s+(?:pendaftaran|penerimaan|intake|registration)\b/i,
      /\b(?:tanggal|date|tgl)\s+(?:mulai|start|akhir|end|pembukaan|opening|tutup|closing)\b/i,
      /\b(?:deadline|batas\s+akhir|akhir|last\s+date)\s+(?:pendaftaran|registration|daftar)\b/i,
      /\b(?:jadwal\s+penerimaan|intake\s+schedule|penerimaan\s+gelombang)\b/i,
      /\b(?:\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)\w*\s+\d{4})\b/i
    ],
    keyword_weight: 0.45,
    filePatterns: [/jadwal|schedule|gelombang|wave|pendaftaran|registration|deadline/i],
    minScore: 2
  },

  [DOC_CATEGORIES.MOU]: {
    patterns: [
      /\b(?:mou|moa|memorandum\s+of\s+understanding|nota\s+kesepakatan)\b/i,
      /\b(?:perjanjian|agreement|kesepakatan|kerjasama|kolaborasi)\b.*\b(?:universitas|partner|mitra|lembaga)\b/i,
      /\b(?:kerjasama|kerja\s+sama|collaboration|partnership)\s+(?:akademik|pendidikan|educational|research)\b/i,
      /\b(?:ditandatangani|tandatangan|signed|signature|penandatanganan)\b/i
    ],
    keyword_weight: 0.35,
    filePatterns: [/mou|moa|perjanjian|agreement|kerjasama|partnership/i],
    minScore: 1.5
  },

  [DOC_CATEGORIES.SK]: {
    patterns: [
      /\b(?:sk|surat\s+keputusan|keputusan|decision|circular|edaran)\b/i,
      /\b(?:nomor\s+sk|no\.\s+sk|sk\s+nomor|sk\s+no\.)\b[\s\S]{0,100}?\b(?:\d{3}\/\d{4}\/\d{3}|\d{3}\.\d{4}|\d{4})\b/i,
      /\b(?:dikeluarkan|ditetapkan|issued|released|tanggal|date|berlaku)\b[\s\S]{0,150}?\b(?:rektoral|universitas|kampus|institusi)\b/i,
      /\b(?:ketua|rektor|direktur|dean|kepala|leadership)\b[\s\S]{0,100}?\b(?:mengeluarkan|menetapkan|menyatakan|declares)\b/i
    ],
    keyword_weight: 0.35,
    filePatterns: [/sk|keputusan|decision|circular|edaran|nomor/i],
    minScore: 1.5
  },

  [DOC_CATEGORIES.SURAT]: {
    patterns: [
      /\b(?:surat|letter|memo|memorandum)\b/i,
      /\b(?:nomor\s+surat|no\.\s+surat|no\s+surat|surat\s+nomor)\b/i,
      /\b(?:perihal|subject|hal|re:|tentang|regarding)\b[\s\S]{0,100}?\b(?:permohonan|pengajuan|pertanyaan|inquiry)\b/i,
      /\b(?:hormat|yang\s+terhormat|dear|salam)\b/i,
      /\b(?:tanda\s+tangan|ttd|tandatangan|signed|signature)\b/i,
      /\b(?:kop\s+surat|letterhead)\b/i
    ],
    keyword_weight: 0.35,
    filePatterns: [/surat|letter|memo|nomor_surat|correspondence/i],
    minScore: 1.5
  },

  [DOC_CATEGORIES.TEMPLATE]: {
    patterns: [
      /\b(?:template|format|contoh|sample|example|contoh surat|contoh proposal)\b/i,
      /\b(?:formulir|form|template form|form template)\b/i,
      /\b(?:\[\s*isi\s+di\s+sini\s*\]|\[fill\s+in\]|<.*?>|{.*?})\b/i,
      /\b(?:silakan\s+isi|please\s+fill|isi\s+sesuai|fill\s+with)\b/i
    ],
    keyword_weight: 0.3,
    filePatterns: [/template|format|contoh|sample|example|formulir/i],
    minScore: 1.5
  },

  [DOC_CATEGORIES.ADMINISTRASI]: {
    patterns: [
      /\b(?:administrasi|administrasi\s+internal|internal|manajemen|management|keuangan|financial|kepegawaian|personnel)\b/i,
      /\b(?:rapat|meeting|notulen|notes|agenda|berita\s+acara|minutes)\b/i,
      /\b(?:pengumuman\s+internal|internal\s+announcement|memo\s+internal)\b/i,
      /\b(?:laporan|report|evaluasi|evaluation|monitoring|audit)\b.*\b(?:internal|manajemen|keuangan)\b/i,
      /\b(?:rekapitulasi|summary|daftar|list)\s+(?:karyawan|staff|pegawai|anggaran|budget)\b/i
    ],
    keyword_weight: 0.3,
    filePatterns: [/administrasi|internal|manajemen|keuangan|kepegawaian|rapat|notulen/i],
    minScore: 2
  }
};

// ============================================================================
// CLASSIFICATION FUNCTIONS
// ============================================================================

/**
 * Classify chunk/document into a category based on content analysis
 * @param {string} chunkText - The text content of the chunk
 * @param {string} filename - Optional filename hint
 * @param {object} metadata - Optional metadata (sourceFile, sectionTitle, etc.)
 * @returns {string} Category key from DOC_CATEGORIES
 */
function classifyDocumentCategory(chunkText, filename = '', metadata = {}) {
  if (!chunkText || typeof chunkText !== 'string') {
    return DOC_CATEGORIES.UNKNOWN;
  }

  const text = String(chunkText).trim();
  if (!text || text.length < 30) {
    return DOC_CATEGORIES.UNKNOWN;
  }

  const fname = String(filename || '').toLowerCase();
  
  // Calculate scores for each category
  const categoryScores = {};

  for (const [categoryKey, categoryConfig] of Object.entries(CATEGORY_PATTERNS)) {
    let score = 0;

    // Check filename patterns
    if (fname && categoryConfig.filePatterns) {
      for (const filePattern of categoryConfig.filePatterns) {
        if (filePattern.test(fname)) {
          score += 3;
        }
      }
    }

    // Check content patterns
    if (categoryConfig.patterns) {
      for (const pattern of categoryConfig.patterns) {
        if (pattern.test(text)) {
          score += 1;
        }
      }
    }

    // Check for keywords from metadata
    if (metadata && typeof metadata === 'object') {
      if (metadata.sectionTitle) {
        const sectionLower = String(metadata.sectionTitle).toLowerCase();
        if (categoryConfig.filePatterns && categoryConfig.filePatterns.some(p => p.test(sectionLower))) {
          score += 2;
        }
      }

      // If metadata says it's a certain type, boost that score
      if (metadata.docType && metadata.docType === categoryKey) {
        score += 2;
      }
    }

    categoryScores[categoryKey] = score;
  }

  // Find category with highest score
  let maxScore = 0;
  let bestCategory = DOC_CATEGORIES.UNKNOWN;

  for (const [categoryKey, score] of Object.entries(categoryScores)) {
    const minThreshold = CATEGORY_PATTERNS[categoryKey]?.minScore || 1;
    if (score >= minThreshold && score > maxScore) {
      maxScore = score;
      bestCategory = categoryKey;
    }
  }

  return bestCategory;
}

/**
 * Classify document with detailed scoring info (useful for debugging)
 * @param {string} chunkText - The text content
 * @param {string} filename - Optional filename
 * @param {object} metadata - Optional metadata
 * @returns {object} {category: string, score: number, scores: object, confidence: string}
 */
function classifyDocumentCategoryDetailed(chunkText, filename = '', metadata = {}) {
  if (!chunkText || typeof chunkText !== 'string') {
    return {
      category: DOC_CATEGORIES.UNKNOWN,
      score: 0,
      scores: {},
      confidence: 'LOW',
      reason: 'no_text'
    };
  }

  const text = String(chunkText).trim();
  if (!text || text.length < 30) {
    return {
      category: DOC_CATEGORIES.UNKNOWN,
      score: 0,
      scores: {},
      confidence: 'LOW',
      reason: 'text_too_short'
    };
  }

  const fname = String(filename || '').toLowerCase();
  const categoryScores = {};

  for (const [categoryKey, categoryConfig] of Object.entries(CATEGORY_PATTERNS)) {
    let score = 0;
    const details = [];

    // Filename patterns
    if (fname && categoryConfig.filePatterns) {
      for (const filePattern of categoryConfig.filePatterns) {
        if (filePattern.test(fname)) {
          score += 3;
          details.push(`filename_match: ${filePattern.source}`);
        }
      }
    }

    // Content patterns
    let patternMatches = 0;
    if (categoryConfig.patterns) {
      for (const pattern of categoryConfig.patterns) {
        if (pattern.test(text)) {
          score += 1;
          patternMatches++;
        }
      }
      if (patternMatches > 0) {
        details.push(`pattern_matches: ${patternMatches}/${categoryConfig.patterns.length}`);
      }
    }

    // Metadata boost
    if (metadata && typeof metadata === 'object') {
      if (metadata.sectionTitle) {
        const sectionLower = String(metadata.sectionTitle).toLowerCase();
        if (categoryConfig.filePatterns && categoryConfig.filePatterns.some(p => p.test(sectionLower))) {
          score += 2;
          details.push('section_title_match');
        }
      }

      if (metadata.docType && metadata.docType === categoryKey) {
        score += 2;
        details.push('docType_metadata_match');
      }
    }

    categoryScores[categoryKey] = { score, details };
  }

  // Find best category
  let maxScore = 0;
  let bestCategory = DOC_CATEGORIES.UNKNOWN;
  let bestDetails = [];

  for (const [categoryKey, { score, details }] of Object.entries(categoryScores)) {
    const minThreshold = CATEGORY_PATTERNS[categoryKey]?.minScore || 1;
    if (score >= minThreshold && score > maxScore) {
      maxScore = score;
      bestCategory = categoryKey;
      bestDetails = details;
    }
  }

  // Determine confidence
  let confidence = 'LOW';
  if (maxScore >= 4) confidence = 'HIGH';
  else if (maxScore >= 2) confidence = 'MEDIUM';

  return {
    category: bestCategory,
    score: maxScore,
    scores: Object.fromEntries(
      Object.entries(categoryScores).map(([k, v]) => [k, v.score])
    ),
    confidence,
    details: bestDetails,
    reason: 'classification_complete'
  };
}

/**
 * Enhance chunk with document category metadata
 * This is called during ingest to add docCategory field to chunk
 */
function enrichChunkWithCategory(chunk, options = {}) {
  if (!chunk || typeof chunk !== 'object') {
    return chunk;
  }

  const chunkText = chunk.chunk || '';
  const filename = chunk.filename || chunk.sourceFile || '';
  const metadata = {
    sectionTitle: chunk.sectionTitle,
    docType: chunk.chunkType,
    trainingId: chunk.trainingId
  };

  const category = classifyDocumentCategory(chunkText, filename, metadata);
  
  // Debug logging
  if (process.env.RAG_AUDIT_LOGGING === 'true' && Math.random() < 0.05) {
    // Log 5% of chunks for debugging
    logger.debug({
      chunkId: chunk.id,
      filename,
      classifiedCategory: category,
      textLength: chunkText.length,
      hasFilename: !!filename
    }, '[DOC CLASSIFIER] Enriched chunk category');
  }
  
  const enrichedChunk = {
    ...chunk,
    docCategory: category,
    // Keep existing category field for backward compatibility
    category: chunk.category || category
  };
  
  return enrichedChunk;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Constants
  DOC_CATEGORIES,
  CATEGORY_PATTERNS,

  // Functions
  classifyDocumentCategory,
  classifyDocumentCategoryDetailed,
  enrichChunkWithCategory
};
