/**
 * Hard Metadata Gates for Production-Safe RAG
 * 
 * CRITICAL: Metadata correctness > embedding similarity
 * 
 * ALL chunks must pass strict validation gates:
 * - NO soft penalties
 * - Hard rejection on metadata mismatch
 * - Deterministic behavior
 */

const logger = require('../logger');

// ============================================================================
// METADATA EXTRACTION & NORMALIZATION
// ============================================================================

function extractMetadataFromChunk(chunk) {
  /**
   * Extract structured metadata from RAG chunk
   */
  if (!chunk || typeof chunk !== 'object') {
    return { valid: false, reason: 'invalid_chunk' };
  }

  const metadata = {
    id: chunk.id || null,
    trainingId: chunk.trainingId || null,
    filename: chunk.filename || null,
    chunkType: chunk.chunkType || null,
    program: chunk.program ? String(chunk.program).trim().toUpperCase() : null,
    wave: chunk.wave ? String(chunk.wave).trim() : null,
    academicYear: chunk.academicYear ? String(chunk.academicYear).trim() : null,
    campus: chunk.campus ? String(chunk.campus).trim() : null,
    ocrQualityScore: typeof chunk.ocrQualityScore === 'number' ? chunk.ocrQualityScore : null,
    sourceType: chunk.sourceType || 'unknown'
  };

  return { valid: true, metadata };
}

// ============================================================================
// QUERY METADATA EXTRACTION
// ============================================================================

function extractMetadataFromQuery(query) {
  /**
   * Extract what metadata constraints the query specifies
   */
  if (!query || typeof query !== 'object') {
    return { constraints: {}, reason: 'invalid_query' };
  }

  const constraints = {
    program: query.program ? String(query.program).trim().toUpperCase() : null,
    wave: query.wave ? String(query.wave).trim() : null,
    academicYear: query.academicYear ? String(query.academicYear).trim() : null,
    campus: query.campus ? String(query.campus).trim() : null,
    category: query.category ? String(query.category).trim() : null,
    pageNumber: query.pageNumber || null
  };

  return { constraints, specificity: Object.values(constraints).filter(v => v !== null).length };
}

// ============================================================================
// HARD METADATA GATES
// ============================================================================

function applyHardMetadataGate(chunk, queryConstraints) {
  /**
   * HARD GATE: Reject chunk if ANY metadata mismatches query constraint
   * 
   * NO soft penalties. NO scoring adjustments.
   * BINARY: accept or reject.
   */

  if (!chunk || typeof chunk !== 'object') {
    return { pass: false, reason: 'invalid_chunk' };
  }

  const chunkMeta = extractMetadataFromChunk(chunk);
  if (!chunkMeta.valid) {
    return { pass: false, reason: 'metadata_extraction_failed', detail: chunkMeta.reason };
  }

  const meta = chunkMeta.metadata;
  const query = queryConstraints || {};

  // RULE 1: Program mismatch = HARD REJECT
  // If query specifies a program, chunk MUST match
  if (query.program && meta.program && query.program !== meta.program) {
    return {
      pass: false,
      reason: 'program_mismatch',
      expected: query.program,
      found: meta.program
    };
  }

  // RULE 2: Wave mismatch = HARD REJECT (if both specified)
  if (query.wave && meta.wave && query.wave !== meta.wave) {
    return {
      pass: false,
      reason: 'wave_mismatch',
      expected: query.wave,
      found: meta.wave
    };
  }

  // RULE 3: Academic year mismatch = HARD REJECT
  if (query.academicYear && meta.academicYear && query.academicYear !== meta.academicYear) {
    return {
      pass: false,
      reason: 'academic_year_mismatch',
      expected: query.academicYear,
      found: meta.academicYear
    };
  }

  // RULE 4: Campus mismatch = HARD REJECT
  if (query.campus && meta.campus && query.campus !== meta.campus) {
    return {
      pass: false,
      reason: 'campus_mismatch',
      expected: query.campus,
      found: meta.campus
    };
  }

  // RULE 5: Page number mismatch = HARD REJECT (if specified)
  if (query.pageNumber && chunk.pageNumber && query.pageNumber !== chunk.pageNumber) {
    return {
      pass: false,
      reason: 'page_number_mismatch',
      expected: query.pageNumber,
      found: chunk.pageNumber
    };
  }

  // RULE 6: OCR quality too low for critical data
  // If query is for HIGH-confidence numeric data AND OCR is poor, reject
  if (query.category === 'FINANCIAL' && meta.ocrQualityScore !== null) {
    if (meta.ocrQualityScore < 0.70) {
      return {
        pass: false,
        reason: 'ocr_quality_too_low_for_financial',
        ocrScore: meta.ocrQualityScore,
        threshold: 0.70
      };
    }
  }

  // All gates passed
  return { pass: true, reason: 'all_gates_passed', metadata: meta };
}

// ============================================================================
// BATCH METADATA GATE APPLICATION
// ============================================================================

function filterChunksByMetadataGates(chunks, queryConstraints) {
  /**
   * Apply hard metadata gates to entire chunk list
   * Returns filtered array and rejection log
   */

  if (!Array.isArray(chunks)) {
    return { filtered: [], rejected: 0, log: [] };
  }

  const filtered = [];
  const rejections = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const gateResult = applyHardMetadataGate(chunk, queryConstraints);

    if (gateResult.pass) {
      filtered.push(chunk);
    } else {
      rejections.push({
        chunkIndex: i,
        chunkId: chunk && chunk.id ? chunk.id : null,
        reason: gateResult.reason,
        detail: gateResult
      });
    }
  }

  return {
    filtered,
    rejected: rejections.length,
    originalCount: chunks.length,
    passRate: chunks.length > 0 ? (filtered.length / chunks.length * 100).toFixed(1) : 'N/A',
    rejections: rejections.slice(0, 10) // Log first 10 rejections
  };
}

// ============================================================================
// QUERY VALIDATION
// ============================================================================

function validateQueryConstraints(query) {
  /**
   * Validate that query constraints are well-formed
   * Returns { valid, issues }
   */

  if (!query || typeof query !== 'object') {
    return { valid: false, issues: ['query_is_not_object'] };
  }

  const issues = [];

  // Program validation
  if (query.program) {
    const prog = String(query.program).trim().toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(prog)) {
      issues.push(`program_invalid_format: "${query.program}"`);
    }
  }

  // Wave validation
  if (query.wave) {
    const wave = String(query.wave).trim();
    if (!/^(\d+|KHUSUS|SISIPAN\s+\d+)$/i.test(wave)) {
      issues.push(`wave_invalid_format: "${query.wave}"`);
    }
  }

  // Academic year validation
  if (query.academicYear) {
    const year = String(query.academicYear).trim();
    if (!/^\d{4}$/.test(year)) {
      issues.push(`academicYear_invalid_format: "${query.academicYear}"`);
    }
    const yNum = parseInt(year, 10);
    if (yNum < 2000 || yNum > 2100) {
      issues.push(`academicYear_out_of_range: ${yNum}`);
    }
  }

  // Page number validation
  if (query.pageNumber !== undefined && query.pageNumber !== null) {
    const pNum = Number(query.pageNumber);
    if (!Number.isFinite(pNum) || pNum < 1 || pNum > 1000) {
      issues.push(`pageNumber_invalid: ${query.pageNumber}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    constraintCount: Object.values(query).filter(v => v !== null && v !== undefined).length
  };
}

// ============================================================================
// METADATA CONSISTENCY CHECKING
// ============================================================================

function checkMetadataConsistencyAcrossChunks(chunks) {
  /**
   * Ensure all chunks have consistent metadata
   * 
   * Example: if first chunk says program="TI", all others should also say "TI"
   * If inconsistent, flag it
   */

  if (!Array.isArray(chunks) || chunks.length < 2) {
    return { consistent: true, reason: 'insufficient_chunks' };
  }

  const extractedPrograms = new Set();
  const extractedWaves = new Set();
  const extractedYears = new Set();

  for (const chunk of chunks) {
    const meta = extractMetadataFromChunk(chunk);
    if (!meta.valid) continue;

    const m = meta.metadata;
    if (m.program) extractedPrograms.add(m.program);
    if (m.wave) extractedWaves.add(m.wave);
    if (m.academicYear) extractedYears.add(m.academicYear);
  }

  const inconsistencies = [];

  if (extractedPrograms.size > 1) {
    inconsistencies.push({
      type: 'program_variance',
      values: Array.from(extractedPrograms),
      count: extractedPrograms.size
    });
  }

  if (extractedWaves.size > 1) {
    inconsistencies.push({
      type: 'wave_variance',
      values: Array.from(extractedWaves),
      count: extractedWaves.size
    });
  }

  if (extractedYears.size > 1) {
    inconsistencies.push({
      type: 'year_variance',
      values: Array.from(extractedYears),
      count: extractedYears.size
    });
  }

  return {
    consistent: inconsistencies.length === 0,
    inconsistencies,
    warning: inconsistencies.length > 0 ? 'MULTIPLE_PROGRAMS_IN_RESULT' : null
  };
}

// ============================================================================
// LOGGING & DEBUG
// ============================================================================

function logMetadataGateApplication(query, originalChunks, filteredChunks, gateResult) {
  /**
   * Structured logging for metadata gate decisions
   */

  const log = {
    timestamp: new Date().toISOString(),
    query: query,
    originalCount: originalChunks ? originalChunks.length : 0,
    filteredCount: filteredChunks ? filteredChunks.length : 0,
    rejected: (originalChunks ? originalChunks.length : 0) - (filteredChunks ? filteredChunks.length : 0),
    passRate: filteredChunks && originalChunks ? (filteredChunks.length / originalChunks.length * 100).toFixed(1) : 'N/A',
    gateResult: gateResult
  };

  logger.info(log, '[RAG] Metadata gates applied');
  return log;
}


// ============================================================================
// KNOWLEDGE DOMAIN / TOPIC HARD GATES
// ============================================================================

function normalizeGateText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function getNestedMetadata(chunk) {
  if (!chunk || typeof chunk !== 'object') return {};
  const metadata = chunk.metadata && typeof chunk.metadata === 'object' ? chunk.metadata : {};
  const governance = chunk.governance && typeof chunk.governance === 'object' ? chunk.governance : (metadata.governance && typeof metadata.governance === 'object' ? metadata.governance : {});
  const prep = governance.knowledgePreparation && typeof governance.knowledgePreparation === 'object'
    ? governance.knowledgePreparation
    : (metadata.knowledgePreparation && typeof metadata.knowledgePreparation === 'object' ? metadata.knowledgePreparation : {});
  return { metadata, governance, prep };
}

function inferKnowledgeDomainFromText(text, filename = '', metadata = {}) {
  const explicit = String(metadata.domain || metadata.knowledgeDomain || metadata.topicDomain || '').trim().toLowerCase();
  if (explicit) return explicit;

  const category = String(metadata.docCategory || metadata.category || metadata.documentCategory || '').toUpperCase();
  if (category === 'BIAYA') return 'fee';
  if (category === 'JADWAL') return 'schedule';
  if (category === 'AKREDITASI') return 'accreditation';
  if (category === 'KURIKULUM') return 'curriculum';
  if (category === 'PRODI_PROFILE') return 'program';
  if (category === 'PROSPEK_KERJA') return 'career';
  if (category === 'PROGRAM_KHUSUS') return 'international';
  if (category === 'ADMINISTRASI' || category === 'SURAT') return 'administration';
  if (category === 'SK') return 'governance';

  const hay = normalizeGateText([filename, text].filter(Boolean).join(' '));
  if (/\b(?:biaya|ukt|dpp|spp|rp|angsuran|potongan)\b/.test(hay) || (/\bgelombang\b/.test(hay) && /\b(?:biaya|pendaftaran|rp|potongan)\b/.test(hay))) return 'fee';
  if (/\b(?:akreditasi|ban pt|lam infokom|nomor sk|peringkat)\b/.test(hay)) return 'accreditation';
  if (/\b(?:yudisium|wisuda|sidang|tugas akhir|proyek akhir|kalender akademik|jadwal kuliah|semester genap|semester ganjil|krs|sion)\b/.test(hay)) return 'academic';
  if (/\b(?:izin belajar|study permit|visa|e30b|itas|kitas|sktt|mahasiswa asing|international office)\b/.test(hay)) return 'foreign_student_admin';
  if (/\b(?:double degree|dual degree|dnui|dalian|help university|student exchange|pertukaran mahasiswa|gccp|hi think|hithink|international class|program internasional)\b/.test(hay)) return 'international';
  if (/\b(?:career center|pusat karir|pusat karier|tracer study|job fair|campus hiring|lowongan|magang)\b/.test(hay)) return 'career';
  if (/\b(?:inkubator bisnis|inbis|startup|rintisan bisnis|kewirausahaan)\b/.test(hay)) return 'inbis';
  if (/\b(?:ukm|ormawa|organisasi mahasiswa|bem|dpm|himaprodi|himpunan mahasiswa|futsal|musik|teater|tari)\b/.test(hay)) return 'student_org';
  if (/\b(?:beasiswa|kip|skss|1k1s|prestasi|potongan beasiswa)\b/.test(hay)) return 'scholarship';
  if (/\b(?:program studi|prodi|jurusan|sistem informasi|teknologi informasi|bisnis digital|sistem komputer|manajemen informatika|kurikulum|sks)\b/.test(hay)) return 'program';
  if (/\b(?:fasilitas|laboratorium|lab|perpustakaan|parkir|kantin|aula|kampus denpasar|kampus jimbaran)\b/.test(hay)) return 'facility';
  if (/\b(?:pmb|penerimaan mahasiswa baru|cara daftar|daftar kuliah|syarat pendaftaran|siap stikom)\b/.test(hay)) return 'pmb';
  return 'unknown';
}

function deriveQueryMetadataConstraints(question, options = {}) {
  const q = normalizeGateText(question);
  const intent = normalizeGateText(options.intent || '');
  const domains = new Set();
  const entities = new Set();
  const intents = new Set(intent ? [intent] : []);

  const addDomain = (domain) => { if (domain) domains.add(domain); };
  const addEntity = (entity) => { if (entity) entities.add(entity); };

  if (/\b(?:biaya|harga|ukt|dpp|spp|rp|bayar|pendaftaran|gelombang|potongan)\b/.test(q) || intent === 'fee') addDomain('fee');
  if (/\b(?:kapan|jadwal|tanggal|pukul|yudisium|wisuda|sidang|kalender akademik|mulai kuliah)\b/.test(q) || intent === 'schedule') addDomain('academic');
  if (/\b(?:akreditasi|ban pt|lam infokom|peringkat)\b/.test(q)) addDomain('accreditation');
  if (/\b(?:izin belajar|study permit|visa|e30b|itas|kitas|sktt|mahasiswa asing|international office)\b/.test(q)) addDomain('foreign_student_admin');
  if (/\b(?:double degree|dual degree|dnui|dalian|help university|student exchange|pertukaran mahasiswa|gccp|hi think|hithink|program internasional|kelas internasional)\b/.test(q)) addDomain('international');
  if (/\b(?:career center|pusat karir|pusat karier|tracer study|job fair|campus hiring|lowongan|magang|karier|karir)\b/.test(q)) addDomain('career');
  if (/\b(?:inkubator bisnis|inbis|startup|rintisan bisnis|kewirausahaan)\b/.test(q)) addDomain('inbis');
  if (/\b(?:ukm|ormawa|organisasi mahasiswa|bem|dpm|himaprodi|himpunan|futsal|musik|teater|tari|olahraga|seni)\b/.test(q)) addDomain('student_org');
  if (/\b(?:beasiswa|kip|skss|1k1s|prestasi)\b/.test(q)) addDomain('scholarship');
  if (/\b(?:program studi|prodi|jurusan|sistem informasi|teknologi informasi|bisnis digital|sistem komputer|manajemen informatika|kurikulum|sks|fakultas)\b/.test(q)) addDomain('program');
  if (/\b(?:fasilitas|laboratorium|lab|perpustakaan|parkir|kantin|aula|kampus)\b/.test(q)) addDomain('facility');
  if (/\b(?:pmb|penerimaan mahasiswa baru|cara daftar|daftar kuliah|mendaftar|syarat pendaftaran)\b/.test(q)) addDomain('pmb');

  const entityRules = [
    ['sistem_informasi', /\b(?:sistem informasi|\bsi\b)\b/],
    ['teknologi_informasi', /\b(?:teknologi informasi|\bti\b)\b/],
    ['bisnis_digital', /\b(?:bisnis digital|\bbd\b)\b/],
    ['sistem_komputer', /\b(?:sistem komputer|\bsk\b)\b/],
    ['manajemen_informatika', /\b(?:manajemen informatika|\bmi\b)\b/],
    ['s2_sistem_informasi', /\b(?:s2|pascasarjana|pasca sarjana|magister)\b/],
    ['dnui', /\b(?:dnui|dalian)\b/],
    ['help_university', /\bhelp university\b|\bhelp\b/],
    ['utb', /\butb\b|universitas teknologi bandung/],
    ['student_exchange', /student exchange|pertukaran mahasiswa/],
    ['hi_think', /hi think|hithink|hi-think/],
    ['career_center', /career center|pusat karir|pusat karier/],
    ['inbis', /inkubator bisnis|\binbis\b/],
    ['ukm_ormawa', /\bukm\b|ormawa|organisasi mahasiswa/],
    ['yudisium', /yudisium/],
    ['wisuda', /wisuda/],
    ['visa_itas_sktt', /visa|e30b|itas|kitas|sktt|izin belajar|study permit/]
  ];
  for (const [entity, re] of entityRules) if (re.test(q)) addEntity(entity);

  return {
    domains: Array.from(domains),
    entities: Array.from(entities),
    intents: Array.from(intents),
    specificity: domains.size + entities.size + intents.size,
    strict: domains.size > 0 || entities.size > 0
  };
}

function extractKnowledgeMetadataFromChunk(chunk) {
  const { metadata, prep } = getNestedMetadata(chunk);
  const filename = chunk && (chunk.filename || chunk.sourceFile || chunk.source || metadata.filename || metadata.sourceFile) || '';
  const text = chunk && (chunk.chunk || chunk.text || chunk.content) || '';
  const prepCategory = prep.category || (prep.documentUnderstanding && prep.documentUnderstanding.category) || null;
  const entities = new Set();
  const rawEntities = metadata.entities || prep.entities || (prep.documentUnderstanding && prep.documentUnderstanding.entities) || {};
  for (const value of Object.values(rawEntities || {})) {
    if (Array.isArray(value)) value.forEach((v) => entities.add(normalizeGateText(v).replace(/\s+/g, '_')));
  }
  const domain = inferKnowledgeDomainFromText(text, filename, {
    ...metadata,
    category: metadata.category || metadata.docCategory || prepCategory || chunk.category || chunk.docCategory
  });
  return {
    domain,
    topic: metadata.topic || metadata.knowledgeTopic || prep.topic || null,
    entities: Array.from(entities),
    intentSupported: metadata.intentSupported || metadata.intents || prep.intentSupported || [],
    sourceFile: filename || null,
    effectiveDate: metadata.effectiveDate || prep.effectiveDate || null,
    authority: metadata.authority || prep.sourceAuthority || null,
    qaPairId: metadata.qaPairId || prep.qaPairId || null,
    category: metadata.category || metadata.docCategory || prepCategory || chunk.category || chunk.docCategory || null
  };
}

function areKnowledgeDomainsCompatible(queryDomains, chunkDomain) {
  const domains = Array.isArray(queryDomains) ? queryDomains.filter(Boolean) : [];
  const domain = String(chunkDomain || 'unknown');
  if (!domains.length || !domain || domain === 'unknown') return true;
  if (domains.includes(domain)) return true;
  if (domains.includes('academic') && ['schedule', 'curriculum'].includes(domain)) return true;
  if (domains.includes('program') && ['curriculum', 'career'].includes(domain)) return true;
  if (domains.includes('international') && ['foreign_student_admin'].includes(domain)) return false;
  if (domains.includes('fee') && domain === 'pmb') return true;
  if (domains.includes('pmb') && ['fee', 'program', 'scholarship'].includes(domain)) return true;
  return false;
}

function applyKnowledgeMetadataHardGate(chunk, queryConstraints) {
  const constraints = queryConstraints && typeof queryConstraints === 'object' ? queryConstraints : {};
  if (!constraints.strict) return { pass: true, reason: 'no_strict_knowledge_constraints' };
  const meta = extractKnowledgeMetadataFromChunk(chunk);
  if (!areKnowledgeDomainsCompatible(constraints.domains || [], meta.domain)) {
    return {
      pass: false,
      reason: 'knowledge_domain_mismatch',
      expectedDomains: constraints.domains || [],
      foundDomain: meta.domain,
      metadata: meta
    };
  }
  return { pass: true, reason: 'knowledge_metadata_compatible', metadata: meta };
}

function filterByKnowledgeMetadataGates(chunks, queryConstraints) {
  if (!Array.isArray(chunks)) return { filtered: [], rejected: 0, rejections: [] };
  const filtered = [];
  const rejections = [];
  for (const chunk of chunks) {
    const result = applyKnowledgeMetadataHardGate(chunk, queryConstraints);
    if (result.pass) filtered.push(chunk);
    else rejections.push({ chunkId: chunk && (chunk.id || chunk.chunkId || chunk.trainingId) || null, reason: result.reason, detail: result });
  }
  return { filtered, rejected: rejections.length, originalCount: chunks.length, rejections: rejections.slice(0, 20) };
}
// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Extraction
  extractMetadataFromChunk,
  extractMetadataFromQuery,

  // Gates
  applyHardMetadataGate,
  filterChunksByMetadataGates,

  // Validation
  validateQueryConstraints,
  checkMetadataConsistencyAcrossChunks,

  // Logging
  logMetadataGateApplication,

  // Knowledge domain gates
  deriveQueryMetadataConstraints,
  extractKnowledgeMetadataFromChunk,
  inferKnowledgeDomainFromText,
  applyKnowledgeMetadataHardGate,
  filterByKnowledgeMetadataGates
};
