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
  logMetadataGateApplication
};
