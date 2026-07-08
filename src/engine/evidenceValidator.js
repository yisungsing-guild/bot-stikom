/**
 * Evidence Validator Module
 * 
 * Validates whether chunk content contains actual evidence required for the intent.
 * Prevents retriever from using chunks that merely mention keywords but don't answer the question.
 */

const logger = require('../logger');
const { getRequiredEvidenceKeywords } = require('./intentClassifier');

// ============================================================================
// EVIDENCE VALIDATION RULES
// ============================================================================

/**
 * Evidence patterns for each intent type
 */
const EVIDENCE_PATTERNS = {
  DEFINISI_PRODI: {
    // Must contain clear definition/description of program
    patterns: [
      /\b(program\s+studi|prodi|jurusan)\b[\s\S]{0,200}?\b(adalah|merupakan|ialah|yaitu|yakni|itu)\b/i,
      /\b(tujuan|visi|misi|fokus|bidang keahlian|capaian pembelajaran|lulusan program|profil lulusan)\b[\s\S]{0,150}?\b(menciptakan|menghasilkan|mempersiapkan|fokus pada|mengembangkan|melatih|mengajarkan)\b/i,
      /\b(definisi|pengertian|deskripsi)\b[\s\S]{0,200}?\b(program|prodi|jurusan|teknik|sistem|informasi|bisnis|digital|komputer|manajemen)\b/i,
      /\b(ilmu|studi|pembelajaran|keilmuan)\b[\s\S]{0,150}?\b(yang berfokus|yang mempelajari|tentang|bidang|konsentrasi)\b/i
    ],
    minLength: 100,
    forbiddenPatterns: [/\brincian\s+biaya\b/i, /\bsk\s+akreditasi\b/i, /\bmou\s+kerjasama\b/i, /\badministrasi\b/i]
  },

  KURIKULUM_PEMBELAJARAN: {
    // Must contain actual curriculum/subjects
    patterns: [
      /\b(mata\s+kuliah|matakuliah|subject|course|kelas|bahan ajar|modul pembelajaran)\b/i,
      /\b(kurikulum|curriculum|program\s+pembelajaran|learning outcome|capaian pembelajaran)\b/i,
      /\b(semester|tahun|pertemuan|minggu)\b[\s\S]{0,200}?\b(mata\s+kuliah|kode|sks|credit|dosen)\b/i,
      /\b(kompetensi|skill|kemampuan|keahlian|penguasaan|ketahanan)\b[\s\S]{0,150}?\b(yang\s+dikuasai|yang\s+diperoleh|yang\s+diajarkan|dilatih|difokuskan)\b/i
    ],
    minLength: 150,
    forbiddenPatterns: [/\brincian\s+biaya\b/i, /\bsk\s+akreditasi\b/i, /\badministrasi\b/i]
  },

  PROSPEK_KERJA: {
    // Must contain career/job opportunities
    patterns: [
      /\b(prospek\s+kerja|peluang\s+karir|lulusan|profesi|pekerjaan|karir|industri|lapangan kerja)\b/i,
      /\b(bekerja\s+di|dapat\s+menjadi|bisa\s+menjadi|menjadi|posisi|jabatan|peran)\b[\s\S]{0,150}?\b(perusahaan|industri|sektor|bidang|organisasi|startup|perusahaan teknologi|bank)\b/i,
      /\b(alumni|lulusan)\b[\s\S]{0,150}?\b(bekerja|kerja|profesional|posisi|jabatan|karir)\b/i
    ],
    minLength: 100,
    forbiddenPatterns: [/\brincian\s+biaya\b/i, /\bsk\s+akreditasi\b/i, /\badministrasi\b/i]
  },

  BIAYA_PENDIDIKAN: {
    // Must contain actual costs/amounts
    patterns: [
      /\b(biaya|harga|dpp|ukt|spp|rp\.?|rupiah|nominal|iuran)\b[\s\S]{0,100}?\b(\d{1,3}(?:\.\d{3})+|\d{4,}|juta|ribu|rb|jt)\b/i,
      /\b(semester|tahun|tahap|gelombang|prodi)\b[\s\S]{0,100}?\b(biaya|dpp|ukt|spp|rp|rupiah|\d{1,3}(?:\.\d{3})+|\d{4,})\b/i,
      /\b(pendaftaran|registrasi|kuliah|pendidikan)\b[\s\S]{0,100}?\b(rp\.?|rupiah|\d{1,3}(?:\.\d{3})+|\d{4,}|juta|ribu|rb)\b/i
    ],
    minLength: 80,
    forbiddenPatterns: [/\b(administrasi|template|surat|mou|beasiswa)\b/i] // May mention beasiswa but focus must be cost
  },

  AKREDITASI_PERINGKAT: {
    // Must contain accreditation info
    patterns: [
      /\b(akreditasi|terakreditasi|sertifikat\s+akreditasi|ban-pt|badan\s+akreditasi)\b/i,
      /\b(peringkat|ranking|grade|sk\s+nomor|nomor\s+sk|surat\s+keputusan)\b[\s\S]{0,150}?\b(akreditasi|ban|akred)\b/i,
      /\b(akreditasi|sertifikat|peringkat)\b[\s\S]{0,100}?\b(unggul|baik\s+sekali|baik|a|b|c|berlaku|masa|validity)\b/i
    ],
    minLength: 80,
    forbiddenPatterns: [/\brincian\s+biaya\b/i, /\badministrasi\s+internal\b/i]
  },

  JADWAL_PENDAFTARAN: {
    // Must contain dates/deadlines
    patterns: [
      /\b(\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)\w*\s+\d{4}|\d{1,2}\s+-\s+\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)\w*\s+\d{4})/i,
      /\b(jadwal|tanggal|deadline|pembukaan|penutupan|tutup|deadline|batas akhir|kapan)\b[\s\S]{0,150}?\b(\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)|tanggal|waktu|jam)\b/i,
      /\b(gelombang|wave|tahap)\b[\s\S]{0,100}?\b(tanggal|jadwal|pembukaan|tutup|deadline|\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des))\b/i
    ],
    minLength: 80,
    forbiddenPatterns: [/\brincian\s+biaya\b/i]
  },

  BEASISWA: {
    // Must contain scholarship info
    patterns: [
      /\b(beasiswa|scholarship|bantuan\s+finansial|bantuan\s+keuangan|potongan\s+biaya|diskon|subsidi)\b/i,
      /\b(beasiswa|potongan|diskon)\b[\s\S]{0,150}?\b(syarat|persyaratan|kriteria|ketentuan|jumlah|nominal|persen|persentase)\b/i,
      /\b(program\s+beasiswa|beasiswa\s+penuh|bantuan\s+parsial)\b/i
    ],
    minLength: 80,
    forbiddenPatterns: [/\brincian\s+biaya\s+kuliah\b/i]
  },

  LOKASI_KAMPUS: {
    // Must contain location/address info
    patterns: [
      /\b(lokasi|alamat|kampus|tempat|jalan|jl|gedung|ruang kelas|lab|laboratorium|fasilitas|lokasi kuliah)\b/i,
      /\b(di\s+(?:bali|jakarta|china|surabaya|bandung|medan|yogyakarta|malaysia|beijing|dalian))\b/i,
      /\b(kampus|lokasi|gedung)\b[\s\S]{0,150}?\b(jalan|jl|alamat|lokasi|tempat|berlokasi|berada)\b/i
    ],
    minLength: 80,
    forbiddenPatterns: [/\brincian\s+biaya\b/i, /\bsk\s+akreditasi\b/i]
  },

  PROGRAM_KHUSUS: {
    // Must contain info about special programs
    patterns: [
      /\b(double\s+degree|dual\s+degree|program\s+khusus|kelas\s+internasional|kelas\s+nasional|program\s+kerjasama)\b/i,
      /\b(dnui|utb|help|malaysia|bali|china|internasional|mitra)\b[\s\S]{0,150}?\b(program|kerjasama|kolaborasi|kelas|partner)\b/i,
      /\b(kerjasama|kerja\s+sama|mou|kolaborasi|partner|partnership)\b[\s\S]{0,150}?\b(universitas|program|pendidikan|beasiswa|gelar)\b/i
    ],
    minLength: 80,
    forbiddenPatterns: [/\brincian\s+biaya\s+(?!.*?(double degree|international|khusus))\b/i]
  }
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Check if chunk contains actual evidence for the intent
 * @param {object} chunk - RAG chunk with .chunk (text) property
 * @param {string} intentKey - Intent classification (e.g., 'DEFINISI_PRODI')
 * @returns {object} {hasEvidence: boolean, confidence: 'HIGH'|'MEDIUM'|'LOW', reasons: string[]}
 */
function validateChunkEvidence(chunk, intentKey) {
  if (!chunk || !chunk.chunk || typeof chunk.chunk !== 'string') {
    return { hasEvidence: false, confidence: 'LOW', reasons: ['chunk_is_empty'] };
  }

  const text = String(chunk.chunk).trim();
  if (!text || text.length < 50) {
    return { hasEvidence: false, confidence: 'LOW', reasons: ['chunk_too_short'] };
  }

  const intent = String(intentKey || '').toUpperCase().trim() || 'GENERAL';
  const patterns = EVIDENCE_PATTERNS[intent];

  // If no pattern defined for this intent, use keyword-based validation
  if (!patterns) {
    return validateChunkEvidenceByKeywords(chunk, intentKey);
  }

  const reasons = [];
  let matchCount = 0;
  let confidence = 'LOW';

  // Check minimum length
  if (text.length < patterns.minLength) {
    reasons.push(`too_short: ${text.length} < ${patterns.minLength}`);
  } else {
    reasons.push(`adequate_length: ${text.length} chars`);
  }

  // Check for forbidden patterns
  for (const forbiddenPattern of patterns.forbiddenPatterns || []) {
    if (forbiddenPattern.test(text)) {
      reasons.push(`contains_forbidden_pattern: ${forbiddenPattern.source}`);
      return { hasEvidence: false, confidence: 'LOW', reasons };
    }
  }

  // Check for required evidence patterns
  for (const pattern of patterns.patterns || []) {
    if (pattern.test(text)) {
      matchCount++;
      reasons.push(`matched_pattern: ${pattern.source.substring(0, 60)}...`);
    }
  }

  // Determine confidence based on pattern matches
  if (matchCount === 0) {
    reasons.push('no_pattern_matches');
    return { hasEvidence: false, confidence: 'LOW', reasons };
  } else if (matchCount === 1) {
    confidence = 'MEDIUM';
    reasons.push('single_pattern_match');
  } else if (matchCount >= 2) {
    confidence = 'HIGH';
    reasons.push(`multiple_pattern_matches: ${matchCount}`);
  }

  const hasEvidence = matchCount > 0;
  return { hasEvidence, confidence, reasons, matchCount };
}

/**
 * Fallback: Validate chunk by keyword-based matching
 * @param {object} chunk - RAG chunk
 * @param {string} intentKey - Intent classification
 * @returns {object} {hasEvidence: boolean, confidence: string, reasons: string[]}
 */
function validateChunkEvidenceByKeywords(chunk, intentKey) {
  if (!chunk || !chunk.chunk) {
    return { hasEvidence: false, confidence: 'LOW', reasons: ['chunk_empty'] };
  }

  const text = String(chunk.chunk).toLowerCase();
  const keywords = getRequiredEvidenceKeywords(intentKey);

  if (!keywords || keywords.length === 0) {
    // No specific keywords required (generic intent)
    return { hasEvidence: true, confidence: 'MEDIUM', reasons: ['no_keywords_required'] };
  }

  const foundKeywords = [];
  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      foundKeywords.push(keyword);
    }
  }

  const matchRatio = foundKeywords.length / keywords.length;
  let confidence = 'LOW';

  if (matchRatio >= 0.5) {
    confidence = 'HIGH';
  } else if (matchRatio >= 0.2) {
    confidence = 'MEDIUM';
  }

  const hasEvidence = foundKeywords.length > 0;
  const reasons = [
    `keyword_match: ${foundKeywords.length}/${keywords.length}`,
    `matched_keywords: ${foundKeywords.join(', ')}`
  ];

  return { hasEvidence, confidence, reasons };
}

/**
 * Stricter validation: Check if chunk is truly relevant to answer the specific question
 * Prevents using chunks that mention keywords but are about different context
 * 
 * Example:
 * Question: "Apa itu Teknologi Informasi?"
 * Chunk: "Rincian Biaya Pendidikan Mahasiswa Baru Program Studi Teknologi Informasi..."
 * Result: INVALID (mentions TI but is about cost, not definition)
 */
function validateChunkRelevanceToQuestion(chunk, question, intentKey) {
  if (!chunk || !chunk.chunk) {
    return { relevant: false, reason: 'chunk_empty' };
  }

  const chunkText = String(chunk.chunk).toLowerCase();
  const originalQuestion = String(question || '').toLowerCase();

  // Abbreviation expansion map (preserve the original abbrev token)
  const ABBR_MAP = {
    si: 'sistem informasi',
    ti: 'teknologi informasi',
    sk: 'sistem komputer',
    bd: 'bisnis digital',
    mi: 'manajemen informatika'
  };

  // Expand abbreviations inline while keeping the original abbrev token
  let expandedQuestion = originalQuestion;
  for (const [abbr, full] of Object.entries(ABBR_MAP)) {
    const re = new RegExp('\\b' + abbr + '\\b', 'gi');
    expandedQuestion = expandedQuestion.replace(re, (m) => `${m} ${full}`);
  }

  const questionText = expandedQuestion;
  const intent = String(intentKey || '').toUpperCase().trim() || 'GENERAL';

  // Check 1: If question asks for DEFINITION but chunk is mostly about COST -> reject
  if (intent === 'DEFINISI_PRODI') {
    const isCostFocused = /\brincian\s+biaya|total\s+biaya|harga|bayar|rp\.?|\d+\s+(?:juta|ribu|rb)/i.test(chunkText);
    const isDefinitionFocused = /\b(?:adalah|merupakan|pengertian|definisi|profil|tujuan|visi|fokus)/i.test(chunkText);
    
    if (isCostFocused && !isDefinitionFocused) {
      return { relevant: false, reason: 'chunk_is_cost_not_definition' };
    }

    if (/\brincian\s+biaya/i.test(chunkText)) {
      return { relevant: false, reason: 'chunk_is_fee_breakdown_not_definition' };
    }
  }

  // Check 2: If question asks for CURRICULUM but chunk is mostly about SCHEDULE -> reject
  if (intent === 'KURIKULUM_PEMBELAJARAN') {
    const isScheduleFocused = /\b(?:jadwal|tanggal|gelombang|deadline|pembukaan|tutup)\b/i.test(chunkText);
    const isCurriculumFocused = /\b(?:mata kuliah|kurikulum|pembelajaran|sks|kompetensi|skill)\b/i.test(chunkText);
    
    if (isScheduleFocused && !isCurriculumFocused) {
      return { relevant: false, reason: 'chunk_is_schedule_not_curriculum' };
    }
  }

  // Check 3: Generic check - chunk should have reasonable overlap with question intent

  // Tokenize: keep tokens longer than 2 OR tokens that are known abbreviations
  const abbrKeys = Object.keys(ABBR_MAP);
  const questionKeywords = questionText
    .split(/\s+/)
    .filter(w => (w && (w.length > 2 || abbrKeys.includes(w.toLowerCase()))));

  const chunkKeywords = chunkText.split(/\s+/).filter(w => w.length > 2);

  let overlap = 0;
  const overlapTokens = [];
  for (const keyword of questionKeywords) {
    if (chunkKeywords.some(ck => ck.includes(keyword) || keyword.includes(ck))) {
      overlap++;
      overlapTokens.push(keyword);
    }
  }

  const overlapRatio = questionKeywords.length > 0 ? overlap / questionKeywords.length : 0;
  // Debug log: original and expanded query, tokens and overlap
  try {
    logger.info && logger.info(`relevance_audit originalQuery="${originalQuestion}" expandedQuery="${questionText}" questionTokens=${JSON.stringify(questionKeywords)} overlapTokens=${JSON.stringify(overlapTokens)} overlapRatio=${overlapRatio}`);
  } catch (e) {
    // swallow logging errors
  }

  if (overlapRatio < 0.1) {
    return { relevant: false, reason: 'low_semantic_overlap', overlapRatio };
  }

  return { relevant: true, reason: 'passed_relevance_checks' };
}

/**
 * Final validation before using chunk for answer generation
 * Combines evidence validation + relevance check
 */
function validateChunkForAnswer(chunk, question, intentKey) {
  // Evidence becomes a confidence signal (not an absolute gate).
  const evidenceResult = validateChunkEvidence(chunk, intentKey);
  const relevanceResult = validateChunkRelevanceToQuestion(chunk, question, intentKey);

  // If relevance check fails, reject.
  if (!relevanceResult.relevant) {
    return {
      valid: false,
      reason: 'not_relevant_to_question',
      detail: relevanceResult
    };
  }

  // If relevance passes, accept but include evidence confidence.
  return {
    valid: true,
    reason: 'relevance_passed_evidence_as_signal',
    evidenceConfidence: evidenceResult.confidence,
    detail: { evidence: evidenceResult, relevance: relevanceResult }
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Constants
  EVIDENCE_PATTERNS,

  // Functions
  validateChunkEvidence,
  validateChunkEvidenceByKeywords,
  validateChunkRelevanceToQuestion,
  validateChunkForAnswer
};
