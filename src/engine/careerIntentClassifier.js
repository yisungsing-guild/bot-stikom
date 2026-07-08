/**
 * Career Guidance Intent Classifier
 * 
 * BUG FIX: Distinguish career guidance questions from scholarship questions
 * 
 * Career questions should NEVER return scholarship info
 * Career answers should ONLY contain STIKOM programs
 * 
 * Functions:
 * - classifyCareerIntent(query): Detect if asking for career guidance
 * - isCareerGuidanceQuestion(query): Boolean check
 * - extractCareerInterest(query): What's the user interested in?
 * - getRecommendedPrograms(interest): Which programs fit the interest?
 */

const logger = require('../logger');

// Interest keywords mapped to recommended programs
const CAREER_INTEREST_MAP = {
  'coding': {
    keywords: ['coding', 'ngoding', 'program', 'code', 'develop', 'aplikasi', 'software'],
    programs: ['Teknologi Informasi', 'Sistem Informasi', 'Sistem Komputer'],
    description: 'Untuk pengembangan aplikasi dan software'
  },
  'data': {
    keywords: ['data', 'analitik', 'analytics', 'scientist', 'scientist', 'big data', 'database', 'sql'],
    programs: ['Sistem Informasi', 'Teknologi Informasi', 'Bisnis Digital'],
    description: 'Untuk analisis data dan big data'
  },
  'keamanan': {
    keywords: ['keamanan', 'security', 'cybersecurity', 'hacking', 'network', 'jaringan', 'sistem'],
    programs: ['Sistem Komputer', 'Teknologi Informasi', 'Sistem Informasi'],
    description: 'Untuk keamanan jaringan dan sistem'
  },
  'bisnis': {
    keywords: ['bisnis', 'startup', 'entrepreneur', 'usaha', 'bisnis digital', 'e-commerce', 'marketing'],
    programs: ['Bisnis Digital', 'Sistem Informasi', 'Teknologi Informasi'],
    description: 'Untuk pengembangan bisnis dan digital'
  },
  'desain': {
    keywords: ['desain', 'grafis', 'visual', 'kreatif', 'ui', 'ux', 'multimedia', 'animasi'],
    programs: ['Desain Komunikasi Visual', 'Multimedia', 'Animasi', 'Desain Grafis'],
    description: 'Untuk desain grafis dan multimedia'
  },
  'jaringan': {
    keywords: ['jaringan', 'network', 'infrastructure', 'admin', 'sistem', 'cloud', 'devops'],
    programs: ['Sistem Komputer', 'Teknologi Komputer', 'Teknologi Informasi'],
    description: 'Untuk infrastruktur dan administrasi jaringan'
  },
  'game': {
    keywords: ['game', 'gaming', 'development', 'engine', 'unreal', 'unity'],
    programs: ['Teknologi Informasi', 'Sistem Komputer', 'Multimedia'],
    description: 'Untuk pengembangan game'
  }
};

// Phrases that indicate career guidance intent
const CAREER_PHRASES = [
  /\b(cocok|sesuai|pas|tepat)\s+(jurusan|prodi|program)\s+(apa|yang\s+mana|apa\s+saja)/i,
  /\b(suka|senang|minat|hobi|passion)\s+([a-z\s]+)\s+(cocok|sesuai|jurusan|prodi)/i,
  /\b(ingin|mau|pengen)\s+(jadi|menjadi)\s+([a-z\s]+)\s+(cocok|sesuai|jurusan|prodi)/i,
  /\b(rekomendasi|saran)\s+(jurusan|prodi|program|untuk)/i,
  /\b(mana|yang\s+mana)\s+(jurusan|prodi|program)\s+(cocok|pas|bagus)\s+(untuk|kalau)/i,
  /\b(cocok jurusan apa|program apa yang cocok|jurusan apa|prodi apa)\b/i,
  /\b(untuk\s+)?([a-z\s]+)\s+(cocok|sesuai)\s+(dengan|untuk)\s+(jurusan|prodi|program)\s+(apa|yang\s+mana)/i
];

// Phrases that indicate it's NOT career guidance (it's scholarship/cost/schedule)
const NON_CAREER_INDICATORS = [
  /\b(beasiswa|biaya|cicilan|pendaftaran|dpp|ukt|gelombang|jadwal|tanggal|deadline|kapan)\b/i,
  /\b(apa itu|penjelasan|jelaskan)\b.*\b(beasiswa|biaya|dpp|program\s+studi)\b/i
];

/**
 * Classify if query is career guidance question
 * Returns: 'CAREER_GUIDANCE' | 'NOT_CAREER' | 'UNCERTAIN'
 */
function classifyCareerIntent(query) {
  if (!query) return 'NOT_CAREER';
  
  const q = String(query).toLowerCase().trim();
  
  // Check for non-career indicators first (they override career patterns)
  for (const pattern of NON_CAREER_INDICATORS) {
    if (pattern.test(q)) {
      return 'NOT_CAREER';
    }
  }
  
  // Check for career guidance phrases
  for (const pattern of CAREER_PHRASES) {
    if (pattern.test(q)) {
      return 'CAREER_GUIDANCE';
    }
  }
  
  // Check for career interest keywords with action verbs
  const hasActionVerb = /\b(suka|senang|minat|hobi|ingin|mau|pengen|cocok|sesuai)\b/i.test(q);
  const hasInterestKeyword = Object.values(CAREER_INTEREST_MAP).some(interest =>
    interest.keywords.some(keyword => new RegExp(`\\b${keyword}\\b`, 'i').test(q))
  );
  
  if (hasActionVerb && hasInterestKeyword) {
    return 'CAREER_GUIDANCE';
  }
  
  return 'NOT_CAREER';
}

/**
 * Check if query is a career guidance question
 */
function isCareerGuidanceQuestion(query) {
  const intent = classifyCareerIntent(query);
  return intent === 'CAREER_GUIDANCE';
}

/**
 * Extract what the user is interested in
 * Returns: object with { interest, keywords, programs }
 */
function extractCareerInterest(query) {
  if (!query) return null;
  
  const q = String(query).toLowerCase();
  
  // Match against each interest type
  for (const [interestName, interestData] of Object.entries(CAREER_INTEREST_MAP)) {
    for (const keyword of interestData.keywords) {
      const keywordRegex = new RegExp(`\\b${keyword.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
      if (keywordRegex.test(q)) {
        return {
          interest: interestName,
          keywords: interestData.keywords,
          programs: interestData.programs,
          description: interestData.description
        };
      }
    }
  }
  
  return null;
}

/**
 * Get recommended programs for a career interest
 */
function getRecommendedPrograms(interest) {
  if (!interest) return [];
  
  // If interest is a string (interest name)
  if (typeof interest === 'string') {
    const data = CAREER_INTEREST_MAP[interest];
    return data ? data.programs : [];
  }
  
  // If interest is an object with programs
  if (interest.programs && Array.isArray(interest.programs)) {
    return interest.programs;
  }
  
  return [];
}

/**
 * Build a career guidance recommendation prompt
 */
function buildCareerRecommendationPrompt(query, opts = {}) {
  const interest = extractCareerInterest(query);
  
  if (!interest) {
    return null;
  }
  
  const tracer = opts.trace ? {
    TRACE_CAREER_INTENT: {
      userQuery: query,
      detectedInterest: interest.interest,
      recommendedPrograms: interest.programs,
      intent: 'CAREER_GUIDANCE_RECOMMENDATION'
    }
  } : null;
  
  if (tracer && opts.logger) {
    opts.logger.info(tracer, '[TRACER]');
  }
  
  const programsList = interest.programs
    .map(prog => `- ${prog}`)
    .join('\n');
  
  return {
    interest: interest.interest,
    programs: interest.programs,
    description: interest.description,
    prompt: `Untuk minat Kakak di bidang ${interest.interest}, saya rekomendasikan program studi berikut di ITB STIKOM Bali:\n\n${programsList}`
  };
}

/**
 * Validate that career guidance answer only contains STIKOM programs
 * Returns: { valid, nonStikomPrograms, message }
 */
function validateCareerAnswerHasOnlyStikomPrograms(answer) {
  const stikomPrograms = [
    'Teknologi Informasi',
    'Sistem Informasi',
    'Sistem Komputer',
    'Bisnis Digital',
    'Manajemen Informatika',
    'Desain Komunikasi Visual',
    'Teknologi Rekayasa Perangkat Lunak',
    'Teknologi Komputer',
    'Multimedia',
    'Animasi',
    'Desain Grafis'
  ];
  
  const nonStikomPatterns = [
    /\bteknik\s+informatika\b/i,
    /\bilmu\s+komputer\b/i,
    /\bstatistika\b/i,
    /\bteknik\s+industri\b/i
  ];
  
  const found = [];
  for (const pattern of nonStikomPatterns) {
    if (pattern.test(answer)) {
      found.push(pattern.source);
    }
  }
  
  return {
    valid: found.length === 0,
    nonStikomPrograms: found,
    message: found.length > 0
      ? `Jawaban mengandung program non-STIKOM: ${found.join(', ')}`
      : null
  };
}

/**
 * Filter career answer to only contain STIKOM programs
 */
function filterCareerAnswerForStikomOnly(answer, opts = {}) {
  if (!answer) return answer;
  
  let result = answer;
  const nonStikomPatterns = [
    /\bteknik\s+informatika\b/gi,
    /\bilmu\s+komputer\b/gi,
    /\bstatistika\b/gi,
    /\bteknik\s+industri\b/gi
  ];
  
  const removedPrograms = [];
  for (const pattern of nonStikomPatterns) {
    if (pattern.test(result)) {
      removedPrograms.push(pattern.source);
      result = result.replace(pattern, '');
    }
  }
  
  if (removedPrograms.length > 0 && opts.trace && opts.logger) {
    opts.logger.warn({
      TRACE_CAREER_FILTER: {
        removedNonStikomPrograms: removedPrograms,
        originalLength: answer.length,
        filteredLength: result.length
      }
    }, '[TRACER]');
  }
  
  return result;
}

module.exports = {
  classifyCareerIntent,
  isCareerGuidanceQuestion,
  extractCareerInterest,
  getRecommendedPrograms,
  buildCareerRecommendationPrompt,
  validateCareerAnswerHasOnlyStikomPrograms,
  filterCareerAnswerForStikomOnly,
  CAREER_INTEREST_MAP,
  CAREER_PHRASES,
  NON_CAREER_INDICATORS
};
