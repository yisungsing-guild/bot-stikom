/**
 * Program Tracer - Track program studi consistency across the entire pipeline
 * 
 * BUG FIX: Ensures program studi remains consistent from query -> RAG -> final output
 * 
 * Exports:
 * - extractProgramFromQuery(q): Extract program from user query
 * - extractProgramFromAnswer(answer): Extract program from RAG answer
 * - validateProgramConsistency(query, answer): Check if header and content match
 * - normalizeProgramName(name): Convert all variations to canonical form
 * - STIKOM_PROGRAM_WHITELIST: List of valid STIKOM programs
 */

const logger = require('../logger');

// STIKOM Bali official programs only
const STIKOM_PROGRAM_WHITELIST = new Set([
  'TI',
  'TEKNOLOGI_INFORMASI',
  'Teknologi Informasi',
  'SI',
  'SISTEM_INFORMASI',
  'Sistem Informasi',
  'SK',
  'SISTEM_KOMPUTER',
  'Sistem Komputer',
  'BD',
  'BISNIS_DIGITAL',
  'Bisnis Digital',
  'MI',
  'MANAJEMEN_INFORMATIKA',
  'Manajemen Informatika',
  'DKV',
  'DESAIN_KOMUNIKASI_VISUAL',
  'Desain Komunikasi Visual',
  'TRPL',
  'TEKNOLOGI_REKAYASA_PERANGKAT_LUNAK',
  'Teknologi Rekayasa Perangkat Lunak',
  'TK',
  'TEKNOLOGI_KOMPUTER',
  'Teknologi Komputer',
  'MM',
  'MULTIMEDIA',
  'Multimedia',
  'AN',
  'ANIMASI',
  'Animasi',
  'DG',
  'DESAIN_GRAFIS',
  'Desain Grafis',
  'RPL',
  'REKOGNISI_PEMBELAJARAN_LAMPAU',
  'Rekognisi Pembelajaran Lampau'
]);

// Non-STIKOM programs to filter out
const NON_STIKOM_PROGRAMS = [
  /\bteknik\s+informatika\b/i,
  /\bilmu\s+komputer\b/i,
  /\bstatistika\b/i,
  /\bteknik\s+industri\b/i,
  /\bilmu\s+pengetahuan\s+alam\b/i,
  /\bfisika\s+(teknik|terapan)\b/i,
  /\bmatematika\s+(terapan)?\b/i,
  /\bkimia\b/i,
  /\bbiologi\b/i
];

/**
 * Normalize program name to canonical form
 * Input: "TI", "ti", "teknologi informasi", "Teknologi Informasi"
 * Output: "Teknologi Informasi"
 */
function normalizeProgramName(rawName) {
  if (!rawName) return null;
  
  const name = String(rawName).trim().toLowerCase();
  
  const map = {
    'ti': 'Teknologi Informasi',
    'teknologi informasi': 'Teknologi Informasi',
    'teknologi informasi (ti)': 'Teknologi Informasi',
    
    'si': 'Sistem Informasi',
    'sistem informasi': 'Sistem Informasi',
    'sistem informasi (si)': 'Sistem Informasi',
    
    'sk': 'Sistem Komputer',
    'sistem komputer': 'Sistem Komputer',
    'sistem komputer (sk)': 'Sistem Komputer',
    's.kom': 'Sistem Komputer',
    
    'bd': 'Bisnis Digital',
    'bisnis digital': 'Bisnis Digital',
    'bisnis digital (bd)': 'Bisnis Digital',
    
    'mi': 'Manajemen Informatika',
    'manajemen informatika': 'Manajemen Informatika',
    'manajemen informasi': 'Manajemen Informatika',
    'manajemen informatika (mi)': 'Manajemen Informatika',
    
    'dkv': 'Desain Komunikasi Visual',
    'desain komunikasi visual': 'Desain Komunikasi Visual',
    'desain komunikasi visual (dkv)': 'Desain Komunikasi Visual',
    
    'trpl': 'Teknologi Rekayasa Perangkat Lunak',
    'teknologi rekayasa perangkat lunak': 'Teknologi Rekayasa Perangkat Lunak',
    'rekayasa perangkat lunak': 'Teknologi Rekayasa Perangkat Lunak',
    
    'tk': 'Teknologi Komputer',
    'teknologi komputer': 'Teknologi Komputer',
    
    'mm': 'Multimedia',
    'multimedia': 'Multimedia',
    
    'an': 'Animasi',
    'animasi': 'Animasi',
    
    'dg': 'Desain Grafis',
    'desain grafis': 'Desain Grafis',
    
    'rpl': 'Rekognisi Pembelajaran Lampau',
    'rekognisi pembelajaran lampau': 'Rekognisi Pembelajaran Lampau'
  };
  
  if (map[name]) return map[name];
  
  // Regex fallback for partial matches
  const regexPatterns = [
    { pattern: /teknologi\s+informasi/i, result: 'Teknologi Informasi' },
    { pattern: /sistem\s+informasi/i, result: 'Sistem Informasi' },
    { pattern: /sistem\s+komputer|s\.?\s*kom/i, result: 'Sistem Komputer' },
    { pattern: /bisnis\s+digital/i, result: 'Bisnis Digital' },
    { pattern: /manajemen\s+informatika|manajemen\s+informasi/i, result: 'Manajemen Informatika' },
    { pattern: /desain\s+komunikasi\s+visual/i, result: 'Desain Komunikasi Visual' },
    { pattern: /teknologi\s+rekayasa\s+perangkat\s+lunak|rekayasa\s+perangkat\s+lunak/i, result: 'Teknologi Rekayasa Perangkat Lunak' },
    { pattern: /teknologi\s+komputer/i, result: 'Teknologi Komputer' },
    { pattern: /\bmultimedia\b/i, result: 'Multimedia' },
    { pattern: /\banimasi\b/i, result: 'Animasi' },
    { pattern: /desain\s+grafis/i, result: 'Desain Grafis' },
    { pattern: /rekognisi\s+pembelajaran\s+lampau/i, result: 'Rekognisi Pembelajaran Lampau' }
  ];
  
  for (const { pattern, result } of regexPatterns) {
    if (pattern.test(name)) return result;
  }
  
  return null;
}

/**
 * Extract program from user query with tracing
 */
function extractProgramFromQuery(query, opts = {}) {
  if (!query) return null;
  
  const q = String(query).toLowerCase();
  
  // Try specific program names first
  const specificPrograms = [
    'teknologi informasi',
    'sistem informasi',
    'sistem komputer',
    'bisnis digital',
    'manajemen informatika',
    'desain komunikasi visual',
    'teknologi rekayasa perangkat lunak',
    'teknologi komputer',
    'multimedia',
    'animasi',
    'desain grafis',
    'rekognisi pembelajaran lampau'
  ];
  
  for (const prog of specificPrograms) {
    if (q.includes(prog)) {
      const normalized = normalizeProgramName(prog);
      if (opts.trace) {
        logger.info({
          TRACE_PROGRAM_QUERY: {
            userQuery: query,
            programExtracted: normalized,
            confidence: 'HIGH',
            method: 'specific_name_match'
          }
        }, '[TRACER]');
      }
      return normalized;
    }
  }
  
  // Try short codes (TI, SI, SK, etc) only with context
  const hasProgramContext = /\b(biaya|pendaftaran|rincian|detail|dpp|semester|gelombang|kuliah|program\s+studi|prodi|jurusan|cocok)\b/i.test(q);
  if (hasProgramContext) {
    const codes = {
      'ti': 'Teknologi Informasi',
      'si': 'Sistem Informasi',
      'sk': 'Sistem Komputer',
      'bd': 'Bisnis Digital',
      'mi': 'Manajemen Informatika'
    };
    
    for (const [code, fullName] of Object.entries(codes)) {
      const codeRegex = new RegExp(`\\b${code}\\b`, 'i');
      if (codeRegex.test(q)) {
        if (opts.trace) {
          logger.info({
            TRACE_PROGRAM_QUERY: {
              userQuery: query,
              programExtracted: fullName,
              code,
              confidence: 'MEDIUM',
              method: 'short_code_with_context'
            }
          }, '[TRACER]');
        }
        return fullName;
      }
    }
  }
  
  return null;
}

/**
 * Extract program from RAG answer with tracing
 */
function extractProgramFromAnswer(answer, opts = {}) {
  if (!answer) return null;
  
  const text = String(answer).toLowerCase();
  
  // Look for explicit program mentions in header-like patterns
  const headerPatterns = [
    /program studi\s*:\s*([a-z\s&-]+?)(?:\n|$|[-–])/i,
    /untuk\s+program\s+studi\s+([a-z\s&-]+?)(?:\n|$|\.|,)/i,
    /([a-z\s&-]+?)\s+(?:biaya|rincian biaya|pendaftaran|dpp|ukt)/i,
    /biaya\s+(?:untuk\s+)?([a-z\s&-]+?)(?:\n|$|[-–]|:|\.)/i
  ];
  
  for (const pattern of headerPatterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const extracted = match[1].trim();
      const normalized = normalizeProgramName(extracted);
      if (normalized) {
        if (opts.trace) {
          logger.info({
            TRACE_PROGRAM_RAG: {
              rawExtracted: extracted,
              programExtracted: normalized,
              pattern: pattern.source,
              confidence: 'HIGH'
            }
          }, '[TRACER]');
        }
        return normalized;
      }
    }
  }
  
  // Fallback: search for any specific program name
  const specificPrograms = [
    'teknologi informasi',
    'sistem informasi',
    'sistem komputer',
    'bisnis digital',
    'manajemen informatika'
  ];
  
  for (const prog of specificPrograms) {
    if (text.includes(prog)) {
      const normalized = normalizeProgramName(prog);
      if (opts.trace) {
        logger.info({
          TRACE_PROGRAM_RAG: {
            programExtracted: normalized,
            method: 'text_search',
            confidence: 'MEDIUM'
          }
        }, '[TRACER]');
      }
      return normalized;
    }
  }
  
  return null;
}

/**
 * Validate program consistency between query and answer
 * Returns { valid, queryProgram, answerProgram, message }
 */
function validateProgramConsistency(query, answer, opts = {}) {
  const queryProg = extractProgramFromQuery(query, { ...opts, trace: false });
  const answerProg = extractProgramFromAnswer(answer, { ...opts, trace: false });
  
  const result = {
    valid: true,
    queryProgram: queryProg,
    answerProgram: answerProg,
    message: null
  };
  
  // If user explicitly mentions a program, answer must use the same program
  if (queryProg && answerProg) {
    if (queryProg !== answerProg) {
      result.valid = false;
      result.message = `Program mismatch: user asked about "${queryProg}" but answer contains "${answerProg}"`;
      
      if (opts.trace) {
        logger.warn({
          TRACE_PROGRAM_FINAL: {
            userQuery: query,
            queryProgram: queryProg,
            answerProgram: answerProg,
            valid: false,
            issue: 'PROGRAM_MISMATCH'
          }
        }, '[TRACER] CONSISTENCY CHECK FAILED');
      }
    } else {
      if (opts.trace) {
        logger.info({
          TRACE_PROGRAM_FINAL: {
            queryProgram: queryProg,
            answerProgram: answerProg,
            valid: true
          }
        }, '[TRACER] CONSISTENCY CHECK PASSED');
      }
    }
  } else if (queryProg && !answerProg) {
    // User asked about program but answer doesn't mention it explicitly
    // This is OK if it's a generic answer, but warn if it's cost-related
    if (/\b(biaya|pendaftaran|dpp|ukt|semester|rincian)\b/i.test(query)) {
      result.valid = false;
      result.message = `Cost question for "${queryProg}" but answer doesn't specify which program`;
      
      if (opts.trace) {
        logger.warn({
          TRACE_PROGRAM_FINAL: {
            userQuery: query,
            queryProgram: queryProg,
            answerProgram: null,
            valid: false,
            issue: 'COST_WITHOUT_PROGRAM'
          }
        }, '[TRACER] CONSISTENCY CHECK WARNING');
      }
    }
  }
  
  return result;
}

/**
 * Filter out non-STIKOM programs from text
 */
function filterNonStikomPrograms(text, opts = {}) {
  if (!text) return text;
  
  let result = text;
  const removedPrograms = [];
  
  for (const pattern of NON_STIKOM_PROGRAMS) {
    if (pattern.test(result)) {
      removedPrograms.push(pattern.source);
      result = result.replace(pattern, '');
    }
  }
  
  if (removedPrograms.length > 0 && opts.trace) {
    logger.warn({
      TRACE_STIKOM_FILTER: {
        removedPrograms,
        originalLength: text.length,
        filteredLength: result.length
      }
    }, '[TRACER] Non-STIKOM programs filtered');
  }
  
  return result;
}

/**
 * Ensure all program mentions are from STIKOM whitelist
 */
function validateStikomOnly(text, opts = {}) {
  if (!text) return { valid: true, issues: [] };
  
  const issues = [];
  
  for (const pattern of NON_STIKOM_PROGRAMS) {
    if (pattern.test(text)) {
      issues.push(pattern.source);
    }
  }
  
  if (opts.trace && issues.length > 0) {
    logger.warn({
      TRACE_STIKOM_VALIDATION: {
        foundNonStikov: issues,
        text: text.substring(0, 200)
      }
    }, '[TRACER] Non-STIKOM validation failed');
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

module.exports = {
  extractProgramFromQuery,
  extractProgramFromAnswer,
  validateProgramConsistency,
  filterNonStikomPrograms,
  validateStikomOnly,
  normalizeProgramName,
  STIKOM_PROGRAM_WHITELIST,
  NON_STIKOM_PROGRAMS
};
