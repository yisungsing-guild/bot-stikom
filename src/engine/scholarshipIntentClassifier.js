/**
 * Scholarship Intent Classifier
 * 
 * BUG FIX: Distinguish between specific scholarship detail questions vs list questions
 * 
 * Functions:
 * - classifyScholarshipIntent(query): Determine if asking for list or specific scholarship
 * - isSpecificScholarshipQuestion(query): Check if asking about specific scholarship
 * - extractScholarshipName(query): Extract which scholarship user is asking about
 * - isGenericScholarshipList(query): Check if asking for list of all scholarships
 */

const logger = require('../logger');

const KNOWN_SCHOLARSHIPS = [
  { 
    name: 'KIP',
    keywords: ['kip', 'kartu indonesia pintar', 'kartu pintar'],
    description: 'Beasiswa KIP dari pemerintah untuk siswa berprestasi dan kurang mampu'
  },
  { 
    name: '1K1S',
    keywords: ['1k1s', 'satu keluarga satu sarjana', 'satu keluarga'],
    description: 'Beasiswa untuk satu keluarga satu sarjana'
  },
  { 
    name: 'Prestasi',
    keywords: ['prestasi', 'berprestasi', 'juara', 'academic excellence'],
    description: 'Beasiswa berdasarkan prestasi akademik dan non-akademik'
  },
  { 
    name: 'Yayasan',
    keywords: ['yayasan', 'kemitraan', 'kerjasama', 'partner'],
    description: 'Beasiswa dari yayasan dan mitra institusi'
  },
  { 
    name: 'Kuliah Sambil Kerja',
    keywords: ['kuliah sambil kerja', 'ksn', 'kerjasama jepang', 'work study'],
    description: 'Program kuliah sambil kerja di luar negeri'
  }
];

/**
 * Classify scholarship intent
 * Returns: 'SPECIFIC_SCHOLARSHIP_DETAIL' | 'SCHOLARSHIP_LIST' | 'SCHOLARSHIP_CLARIFICATION' | 'NOT_SCHOLARSHIP'
 */
function classifyScholarshipIntent(query) {
  if (!query) return 'NOT_SCHOLARSHIP';
  
  const q = String(query).toLowerCase().trim();
  
  // Check if it's a scholarship question at all
  const isScholarshipQuery = /\b(beasiswa|scholarship|potongan|diskon)\b/i.test(q);
  if (!isScholarshipQuery) {
    return 'NOT_SCHOLARSHIP';
  }
  
  // Pattern 1: "Apa itu beasiswa KIP?" -> SPECIFIC_SCHOLARSHIP_DETAIL
  if (/\b(apa\s+itu|apa\s+yang\s+dimaksud|penjelasan|jelaskan|informasi)\b/i.test(q)) {
    const scholarship = extractScholarshipName(q);
    if (scholarship) {
      return 'SPECIFIC_SCHOLARSHIP_DETAIL';
    }
  }
  
  // Pattern 2: "Apa saja beasiswa?" or "Ada beasiswa apa?" -> SCHOLARSHIP_LIST
  if (/\b(apa\s+saja|ada\s+apa|apa\s+ada|jenis\s+beasiswa|macam\s+beasiswa|list\b|daftar\b)\b/i.test(q)) {
    return 'SCHOLARSHIP_LIST';
  }
  
  // Pattern 3: "Berapa potongan KIP?" or "Syarat beasiswa Prestasi?" -> SPECIFIC_SCHOLARSHIP_DETAIL
  if (/\b(berapa|syarat|persyaratan|cara|bagaimana|proses|pendaftaran)\b/i.test(q)) {
    const scholarship = extractScholarshipName(q);
    if (scholarship) {
      return 'SPECIFIC_SCHOLARSHIP_DETAIL';
    }
    // If it's asking about details but no specific scholarship, might be clarifying
    return 'SCHOLARSHIP_CLARIFICATION';
  }
  
  // Pattern 4: Short question with specific scholarship -> SPECIFIC_SCHOLARSHIP_DETAIL
  if (q.length < 50) {
    const scholarship = extractScholarshipName(q);
    if (scholarship) {
      return 'SPECIFIC_SCHOLARSHIP_DETAIL';
    }
  }
  
  return 'SCHOLARSHIP_LIST';
}

/**
 * Check if query is asking for specific scholarship details
 */
function isSpecificScholarshipQuestion(query) {
  const intent = classifyScholarshipIntent(query);
  return intent === 'SPECIFIC_SCHOLARSHIP_DETAIL';
}

/**
 * Extract which scholarship user is asking about
 * Returns: 'KIP' | '1K1S' | 'Prestasi' | 'Yayasan' | etc. or null
 */
function extractScholarshipName(query) {
  if (!query) return null;
  
  const q = String(query).toLowerCase();
  
  for (const scholarship of KNOWN_SCHOLARSHIPS) {
    for (const keyword of scholarship.keywords) {
      const keywordRegex = new RegExp(`\\b${keyword.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
      if (keywordRegex.test(q)) {
        return scholarship.name;
      }
    }
  }
  
  return null;
}

/**
 * Check if asking for list of all scholarships
 */
function isGenericScholarshipList(query) {
  if (!query) return false;
  
  const q = String(query).toLowerCase().trim();
  
  return /\b(apa\s+saja|ada\s+apa|apa\s+ada|jenis|macam|list|daftar)\b/i.test(q) &&
         !extractScholarshipName(q);
}

/**
 * Get description for specific scholarship
 */
function getScholarshipDescription(scholarshipName) {
  if (!scholarshipName) return null;
  
  const scholarship = KNOWN_SCHOLARSHIPS.find(s => s.name === scholarshipName);
  return scholarship ? scholarship.description : null;
}

/**
 * Build response for specific scholarship explanation
 */
function buildScholarshipExplanationPrompt(scholarshipName, opts = {}) {
  if (!scholarshipName) {
    return 'Tolong sebutkan beasiswa mana yang ingin Kakak ketahui.';
  }
  
  const scholarship = KNOWN_SCHOLARSHIPS.find(s => s.name === scholarshipName);
  if (!scholarship) {
    return `Maaf, saya tidak menemukan informasi tentang beasiswa "${scholarshipName}". Silakan hubungi admin untuk informasi lengkap.`;
  }
  
  const tracer = opts.trace ? {
    TRACE_SCHOLARSHIP_INTENT: {
      query: opts.query,
      targetScholarship: scholarshipName,
      intent: 'SPECIFIC_SCHOLARSHIP_DETAIL'
    }
  } : null;
  
  if (tracer && opts.logger) {
    opts.logger.info(tracer, '[TRACER]');
  }
  
  return `Berikut penjelasan mengenai ${scholarship.name}: ${scholarship.description}`;
}

/**
 * Filter RAG answer for scholarship relevance
 * If user asked for specific scholarship, extract relevant parts from answer
 */
function filterScholarshipAnswerForIntent(answer, userQuery) {
  if (!answer || !userQuery) return answer;
  
  const intent = classifyScholarshipIntent(userQuery);
  const scholarship = extractScholarshipName(userQuery);
  
  if (intent === 'SPECIFIC_SCHOLARSHIP_DETAIL' && scholarship) {
    // If the answer is just a generic list, return empty to trigger fallback
    if (/\badministrasi hanya menampilkan daftar semua beasiswa\b/i.test(answer) ||
        (/\bada beberapa jenis beasiswa/i.test(answer) && !answer.includes(scholarship))) {
      return null; // Signal to use fallback explanation
    }
    
    // Extract only the relevant scholarship section
    const scholarshipRegex = new RegExp(
      `((?:^|\\n)[^\\n]*\\b${scholarship.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b[^\\n]*(?:\\n[^\\n]+)*?)(?=\\n\\n|\\n(?:[a-z]*(?:beasiswa|beasiswa|syarat))|$)`,
      'im'
    );
    
    const match = scholarshipRegex.exec(answer);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return answer;
}

module.exports = {
  classifyScholarshipIntent,
  isSpecificScholarshipQuestion,
  extractScholarshipName,
  isGenericScholarshipList,
  getScholarshipDescription,
  buildScholarshipExplanationPrompt,
  filterScholarshipAnswerForIntent,
  KNOWN_SCHOLARSHIPS
};
