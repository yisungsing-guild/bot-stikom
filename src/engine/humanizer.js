/**
 * Humanizer Engine - Layer presentasi/humanization untuk WhatsApp responses
 * 
 * Fokus HANYA pada layer presentasi tanpa mengubah:
 * - RAG answer generation
 * - Retrieval & scoring
 * - Source selection
 * - Knowledge base
 * 
 * Improvement areas:
 * 1. Intent confirmation yang natural/humanis
 * 2. Generasi 3 follow-up questions berbasis context
 * 3. Hapus system labels (Topik:, Informasi Terkait:, Kesimpulan:)
 * 4. Improve virtual assistant persona
 */

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (typeof raw === 'undefined') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

// =====================================================
// 1. HUMANIZED INTENT CONFIRMATION
// =====================================================

/**
 * Konversi detected intent menjadi kalimat natural yang menunjukkan 
 * bahwa bot memahami maksud user
 * 
 * Bukan: "Topik: Program Studi Teknologi Informasi"
 * Melainkan: "Saya pahami Kakak sedang menanyakan tentang Program Studi Teknologi Informasi."
 */
function buildHumanizedIntentConfirmation(intent, userQuery = '', context = {}) {
  const intentConfirmations = {
    // Program definitions and program summaries
    'program_definition': buildProgramDefinitionConfirmation,
    'program_studi': buildProgramStudyConfirmation,
    'international_double_degree': buildInternationalDoubleDegreeConfirmation,
    'akademik': buildAkademikConfirmation,
    'ukm': buildUkmConfirmation,
    'campus_support': buildCampusSupportConfirmation,
    
    // Costs & Finance
    'biaya': buildFeeConfirmation,
    'beasiswa': buildScholarshipConfirmation,
    'pendaftaran': buildRegistrationConfirmation,
    'jadwal_pendaftaran': buildScheduleConfirmation,
    
    // Campus & Location
    'lokasi': buildLocationConfirmation,
    'akreditasi': buildAccreditationConfirmation,
    
    // Career & Prospects
    'prospek_kerja': buildCareerProspectConfirmation,
    
    // Comparisons
    'perbandingan_prodi': buildComparisonConfirmation,
    
    // Default
    'general': buildGeneralConfirmation
  };

  const builder = intentConfirmations[intent] || intentConfirmations['general'];
  return builder(userQuery, context);
}

function buildProgramDefinitionConfirmation(userQuery, context) {
  const program = context.program || extractProgramName(userQuery);
  if (program) {
    return `Baik Kak, saya bantu jelaskan mengenai Program Studi ${program}.`;
  }

  return `Baik Kak, berikut penjelasan mengenai Program Studi yang Kakak tanyakan.`;
}

function buildInternationalDoubleDegreeConfirmation(userQuery, context) {
  return `Baik Kak, berikut informasi mengenai program Double Degree Internasional yang tersedia di ITB STIKOM Bali.`;
}

function buildProgramStudyConfirmation(userQuery, context) {
  const program = context.program || extractProgramName(userQuery);
  
  if (program) {
    return `Saya bantu jelaskan mengenai Program Studi ${program} ya Kak.`;
  }
  
  return `Baik Kak, saya bantu jelaskan program studi yang tersedia di ITB STIKOM Bali.`;
}

function buildCampusSupportConfirmation(userQuery) {
  const q = String(userQuery || '').toLowerCase();
  if (/\bgccp\b/i.test(q)) return 'Saya bantu jawab tentang program GCCP di ITB STIKOM Bali.';
  if (/\bbccp\b/i.test(q)) return 'Saya bantu jawab tentang program BCCP di ITB STIKOM Bali.';
  if (/\blinked\s*in|linkedin\b/i.test(q)) return 'Saya bantu jawab tentang program LinkedIn yang terkait Career Center di ITB STIKOM Bali.';
  if (/\bsoftskill|career\s*center|pusat\s+karier|pusat\s+karir\b/i.test(q)) return 'Saya bantu jawab tentang Career Center dan pengembangan softskill di ITB STIKOM Bali.';
  if (/\bbahasa|language\s+learning|llc\b/i.test(q)) return 'Saya bantu jawab tentang fasilitas belajar bahasa di ITB STIKOM Bali.';
  return 'Saya bantu jawab tentang fasilitas atau program pendukung di ITB STIKOM Bali.';
}

function buildUkmConfirmation(userQuery) {
  if (/\b(esport|esports|athena)\b/i.test(userQuery)) {
    return 'Baik Kak, saya bantu jawab tentang UKM esports di ITB STIKOM Bali.';
  }
  if (/\b(musik|band|nyanyi|vokal|vocal)\b/i.test(userQuery)) {
    return 'Baik Kak, saya bantu jawab tentang UKM musik di ITB STIKOM Bali.';
  }
  return 'Baik Kak, saya bantu jawab tentang UKM/Ormawa di ITB STIKOM Bali.';
}
function buildAkademikConfirmation(userQuery) {
  const topicMap = [
    { pattern: /\b(kurikulum|mata\s+kuliah|dipelajari|materi|belajar)\b/i, reply: 'mengenai kurikulum dan mata kuliah' },
    { pattern: /\b(prospek\s+kerja|karir|pekerjaan)\b/i, reply: 'mengenai prospek kerja' },
    { pattern: /\b(syarat|persyaratan|apa\s+saja)\b/i, reply: 'mengenai informasi program studi' }
  ];
  
  const matched = topicMap.find(m => m.pattern.test(userQuery));
  const topic = matched ? matched.reply : 'tentang program studi yang tersedia';
  
  return `Saya bantu jelaskan ${topic} di ITB STIKOM Bali ya Kak.`;
}

function buildFeeConfirmation(userQuery, context) {
  const program = context.program || extractProgramName(userQuery);
  const specific = context.feeChoice; // 'dpp', 'semester', 'breakdown', 'pendaftaran', etc.
  
  let detail = 'biaya kuliah';
  
  if (specific === 'dpp') detail = 'Dana Pendidikan Pokok (DPP)';
  else if (specific === 'semester') detail = 'biaya per semester';
  else if (specific === 'breakdown') detail = 'rincian biaya lengkap';
  else if (specific === 'pendaftaran') detail = 'biaya pendaftaran';
  else if (/dpp|dana\s*pendidikan/i.test(userQuery)) detail = 'Dana Pendidikan Pokok (DPP)';
  else if (/semester|per\s*semester|ukt/i.test(userQuery)) detail = 'biaya per semester';
  else if (/rincian|detail|lengkap/i.test(userQuery)) detail = 'rincian biaya lengkap';
  
  if (program) {
    return `Jadi Kakak ingin tahu ${detail} untuk Program Studi ${program}. Saya jelaskan sekarang ya.`;
  }
  
  return `Baik Kak, berikut penjelasan mengenai ${detail} di ITB STIKOM Bali.`;
}

function buildScholarshipConfirmation(userQuery) {
  const topicMap = [
    { pattern: /\b1k1s\b/i, reply: 'beasiswa KIP 1K1S' },
    { pattern: /\bkip\b/i, reply: 'beasiswa KIP' },
    { pattern: /\b(prestasi|berprestasi|juara)\b/i, reply: 'beasiswa prestasi' },
    { pattern: /\b(kemitraan|kerjasama|yayasan)\b/i, reply: 'beasiswa kemitraan/yayasan' },
    { pattern: /\b(tidak mampu|kurang\s*mampu)\b/i, reply: 'beasiswa kurang mampu' }
  ];
  
  const matched = topicMap.find(m => m.pattern.test(userQuery));
  const detail = matched ? matched.reply : 'pilihan beasiswa yang tersedia';
  
  return `Baik Kak, saya bantu jelaskan mengenai ${detail}.`;
}

function buildRegistrationConfirmation(userQuery) {
  const topicMap = [
    { pattern: /\b(cara|langkah|prosedur|bagaimana)\b/i, reply: 'cara/langkah pendaftaran' },
    { pattern: /\b(syarat|persyaratan|dokumen|berkas)\b/i, reply: 'persyaratan dan dokumen' },
    { pattern: /\b(online|offline|portal|form|formulir)\b/i, reply: 'sistem pendaftaran' }
  ];
  
  const matched = topicMap.find(m => m.pattern.test(userQuery));
  const detail = matched ? matched.reply : 'pendaftaran mahasiswa baru';
  
  return `Baik Kak, saya jelaskan tentang ${detail} di ITB STIKOM Bali.`;
}

function buildScheduleConfirmation(userQuery) {
  const topicMap = [
    { pattern: /\b(gelombang|gel\.?|gbg)\b/i, reply: 'jadwal pendaftaran per gelombang' },
    { pattern: /\b(deadline|tutup|sampai\s+kapan)\b/i, reply: 'deadline pendaftaran' },
    { pattern: /\b(kapan|tanggal|bulan)\b/i, reply: 'jadwal/tanggal penting' }
  ];
  
  const matched = topicMap.find(m => m.pattern.test(userQuery));
  const detail = matched ? matched.reply : 'jadwal pendaftaran';
  
  return `Saya bantu jelaskan tentang ${detail} untuk PMB ITB STIKOM Bali.`;
}

function buildLocationConfirmation(userQuery) {
  return `Saya bantu jelaskan lokasi kampus ITB STIKOM Bali dan cara menjangkaunya ya Kak.`;
}

function buildAccreditationConfirmation(userQuery) {
  return `Saya bantu jelaskan tentang akreditasi program studi ITB STIKOM Bali.`;
}

function buildCareerProspectConfirmation(userQuery, context) {
  const program = context.program || extractProgramName(userQuery);
  
  if (program) {
    return `Baik Kak, saya bantu jelaskan prospek karier lulusan ${program}.`;
  }
  
  return `Baik Kak, saya bantu jelaskan prospek karier lulusan ITB STIKOM Bali.`;
}

function buildComparisonConfirmation(userQuery, context) {
  const programs = context.programs || extractProgramsFromQuery(userQuery);
  
  if (programs && programs.length >= 2) {
    const list = programs.slice(0, 2).join(' dan ');
    return `Baik Kak, saya bandingkan kedua program studi tersebut: ${list}.`;
  }
  
  return `Saya bantu jelaskan perbedaan antar program studi di ITB STIKOM Bali.`;
}

function buildGeneralConfirmation(userQuery) {
  if (userQuery && userQuery.trim()) {
    return `Baik Kak, berikut informasi yang saya temukan terkait pertanyaan Kakak.`;
  }

  return `Baik Kak, saya bantu Anda menemukan informasi yang Kakak butuhkan.`;
}

// =====================================================
// 2. INTELLIGENT 3 FOLLOW-UP QUESTIONS GENERATION
// =====================================================

/**
 * Generate maksimal 3 follow-up questions yang relevan
 * Priority: query-specific > intent-specific > generic
 */
function detectScholarshipType(userQuery = '', context = {}) {
  const text = `${String(userQuery || '')} ${String(context.program || '')}`.toLowerCase();
  if (/\b1k1s\b/i.test(text)) return '1K1S';
  if (/\bkip\b/i.test(text)) return 'KIP';
  if (/\bprestasi\b/i.test(text)) return 'prestasi';
  if (/\b(yayasan|kemitraan)\b/i.test(text)) return 'yayasan';
  if (/\b(kurang mampu|tidak mampu)\b/i.test(text)) return 'kurang_mampu';
  return null;
}

function generateFollowUpQuestions(intent, userQuery = '', context = {}) {
  const questions = [];
  const seen = new Set();
  const enrichedContext = { ...context, scholarshipType: context.scholarshipType || detectScholarshipType(userQuery, context) };
  
  const add = (q) => {
    if (!q || seen.has(q)) return;
    questions.push(q);
    seen.add(q);
  };
  
  // PRIORITY 1: Query-specific questions (e.g., coding, data analyst)
  const queryQuestions = getQuerySpecificFollowUps(userQuery, intent, enrichedContext);
  queryQuestions.forEach(q => add(q));

  // PRIORITY 2: Intent-specific questions (if we need more)
  if (questions.length < 3) {
    const intentQuestions = getIntentSpecificFollowUps(intent, enrichedContext);
    intentQuestions.forEach(q => add(q));
  }

  // PRIORITY 3: Generic questions (if we still need more)
  if (questions.length < 3) {
    const genericQuestions = getGenericFollowUps(context);
    genericQuestions.forEach(q => add(q));
  }
  
  return questions.slice(0, 3);
}

function getIntentSpecificFollowUps(intent, context) {
  const program = context.program || '';
  const q = [];
  
  switch (intent) {
    case 'program_definition':
    case 'program_studi':
      if (program) {
        q.push(`Apa saja mata kuliah inti di ${program}?`);
        q.push(`Bagaimana prospek kerja lulusan ${program}?`);
        q.push(`Apa perbedaan ${program} dengan prodi serupa?`);
      } else {
        q.push('Apa saja program studi yang ada di ITB STIKOM Bali?');
        q.push('Apa perbedaan antara TI, SI, dan Sistem Komputer?');
        q.push('Program studi mana yang paling cocok untuk minat saya?');
      }
      break;
    case 'international_double_degree':
      q.push('Apa saja syarat mengikuti program Double Degree Internasional?');
      q.push('Universitas mitra mana saja yang tersedia untuk program ini?');
      q.push('Bagaimana pembiayaan untuk Double Degree Internasional?');
      break;
      
    case 'biaya':
      if (program) {
        q.push(`Apa prospek kerja ${program}?`);
        q.push(`Apa mata kuliah ${program}?`);
        q.push(`Berapa biaya ${program}?`);
      } else {
        q.push('Apakah ada beasiswa atau potongan biaya?');
        q.push('Berapa cicilan biaya per bulannya?');
        q.push('Apakah ada skema pembayaran yang fleksibel?');
      }
      break;
      
    case 'ukm':
      q.push('UKM apa saja yang tersedia?');
      q.push('Bagaimana cara ikut UKM?');
      q.push('Ada UKM olahraga atau seni apa saja?');
      break;

    case 'campus_support':
      q.push('Apa saja fasilitas pendukung mahasiswa?');
      q.push('Bagaimana cara konfirmasi detail program ini?');
      q.push('Program internasional atau softskill apa saja yang tersedia?');
      break;

    case 'beasiswa': {
      const scholarshipType = context.scholarshipType || '';
      if (scholarshipType === 'KIP') {
        q.push('Apa syarat KIP?');
        q.push('Bagaimana cara daftar KIP?');
        q.push('Kapan pendaftaran KIP?');
      } else if (scholarshipType === '1K1S') {
        q.push('Apa syarat 1K1S?');
        q.push('Bagaimana proses seleksi 1K1S?');
        q.push('Kapan pendaftaran 1K1S?');
      } else if (scholarshipType === 'prestasi') {
        q.push('Apa syarat Beasiswa Prestasi?');
        q.push('Bagaimana cara mengajukan Beasiswa Prestasi?');
        q.push('Berapa besar potongan biaya Beasiswa Prestasi?');
      } else if (scholarshipType === 'yayasan' || scholarshipType === 'kurang_mampu') {
        q.push('Apa syarat beasiswa yang tersedia?');
        q.push('Bagaimana cara mengajukannya?');
        q.push('Kapan pendaftaran beasiswa dibuka?');
      } else {
        q.push('Apa syarat mendapatkan beasiswa?');
        q.push('Bagaimana cara mengajukan beasiswa?');
        q.push('Berapa besar potongan biaya dari beasiswa?');
      }
      break;
    }
      
    case 'pendaftaran':
      q.push('Apa saja syarat/berkas yang dibutuhkan?');
      q.push('Berapa biaya pendaftarannya?');
      q.push('Kapan pendaftaran dibuka?');
      break;
      
    case 'jadwal_pendaftaran':
      q.push('Apa saja gelombang pendaftaran yang ada?');
      q.push('Kapan deadline pendaftaran terakhir?');
      q.push('Bagaimana prosedur pendaftaran?');
      break;
      
    case 'lokasi':
      q.push('Apakah ada beberapa lokasi kampus?');
      q.push('Bagaimana cara ke lokasi kampus dengan transportasi umum?');
      q.push('Apa saja fasilitas di kampus?');
      break;
      
    case 'prospek_kerja':
      if (program) {
        q.push(`Berapa rata-rata gaji lulusan ${program}?`);
        q.push(`Apakah ada program magang untuk ${program}?`);
      } else {
        q.push('Mana program studi dengan prospek karier terbaik?');
        q.push('Apakah ada kerjasama dengan industri?');
      }
      q.push('Apa saja sertifikasi yang bisa didapat?');
      break;
      
    case 'perbandingan_prodi':
      q.push('Program mana yang lebih cocok untuk saya?');
      q.push('Mana yang lebih mudah?');
      q.push('Mana yang lebih menguntungkan secara karier?');
      break;
      
    default:
      break;
  }
  
  return q;
}

function getQuerySpecificFollowUps(userQuery, intent, context = {}) {
  const q = String(userQuery || '').toLowerCase();
  const questions = [];
  const hasCodingIntent = /\b(coding|pemrograman|programming|software development|developer|ngoding|programmer|koding|buat aplikasi|develop software)\b/i.test(q);
  const hasDataIntent = /\b(data analyst|data analis|analyst data|data science|scientist data|analisis data|statistik|business intelligence|bi)\b/i.test(q);

  // Query-specific: Coding
  if (hasCodingIntent) {
    questions.push('Prodi apa yang paling cocok untuk yang suka coding?');
    questions.push('Apa perbedaan antara TI dan Sistem Komputer jika suka programming?');
    questions.push('Bagaimana prospek kerja untuk lulusan yang suka programming?');
    return questions;
  }

  // Query-specific: Data Analyst
  if (hasDataIntent) {
    questions.push('Jurusan apa yang cocok untuk menjadi Data Analyst?');
    questions.push('Apakah Sistem Informasi atau TI lebih tepat untuk Data Analyst?');
    questions.push('Skill apa yang penting untuk karier Data Analyst?');
    return questions;
  }

  // Program-specific follow-ups if no special query intent detected
  if (intent === 'program_studi') {
    const program = context.program || '';
    if (program) {
      questions.push(`Apa saja mata kuliah inti di ${program}?`);
      questions.push(`Bagaimana prospek kerja lulusan ${program}?`);
      questions.push(`Apa perbedaan ${program} dengan prodi serupa?`);
    } else {
      questions.push('Apa saja perbedaan antara program studi TI, SI, dan Sistem Komputer?');
      questions.push('Program studi mana yang paling cocok untuk minat saya?');
      questions.push('Bagaimana prospek kerja tiap program studi?');
    }
  }

  return questions;
}

function getGenericFollowUps(context) {
  return [
    'Apakah ada informasi lain yang Kakak butuhkan?',
    'Mau saya jelaskan tentang aspek lain dari ITB STIKOM Bali?',
    'Adakah pertanyaan lain tentang pendaftaran atau program studi?'
  ];
}

// =====================================================
// 3. FORMAT RESPONSE WITHOUT SYSTEM LABELS
// =====================================================

/**
 * Format response yang natural, tanpa labels seperti:
 * - Topik:
 * - Informasi Terkait:
 * - Kesimpulan:
 */
function buildNoDataResponse(userQuery, intent = 'general', context = {}) {
  const program = context.program || extractProgramName(userQuery);
  const programText = program ? ` untuk Program Studi ${program}` : '';
  // Career guidance fallback: never reply with generic no-data for career queries
  const q = String(userQuery || '').toLowerCase();
  const isCareerCoding = /\b(coding|pemrograman|programmer|software engineer|software developer|ngoding|programming)\b/i.test(q);
  const isCareerData = /\b(data analyst|data analis|data science|data scientist|analisis data)\b/i.test(q);
  const isCareerDesign = /\b(desain|design|content creator|desain digital)\b/i.test(q);

  if (isCareerCoding) {
    const base = 'Kalau Kakak suka coding, program yang sering cocok adalah:\n- Teknologi Informasi\n- Sistem Komputer\nKakak mau tahu perbedaan keduanya atau prospek kerjanya?';
    return base;
  }
  if (isCareerData) {
    const base = 'Untuk karier sebagai Data Analyst, program yang sering direkomendasikan:\n- Sistem Informasi\n- Teknologi Informasi\nMau saya jelaskan kenapa masing-masing cocok?';
    return base;
  }
  if (isCareerDesign) {
    const base = 'Untuk desain digital / content creator, program yang relevan adalah:\n- Bisnis Digital\nMau contoh mata kuliah atau prospeknya?';
    return base;
  }

  const noDataTopic = (intent === 'beasiswa' || intent === 'scholarship' || /\b(?:beasiswa|scholarship)\b/i.test(userQuery))
    ? 'detail beasiswa tersebut'
    : 'informasi tersebut';
  const base = `Maaf Kak, saat ini saya belum menemukan ${noDataTopic} pada basis pengetahuan saya${programText}. Silakan hubungi Admin PMB atau ajukan pertanyaan lain terkait PMB ITB STIKOM Bali.`;
  const showFollowUps = envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false);
  const followUps = showFollowUps ? generateFollowUpQuestions(intent, userQuery, context) : [];
  if (!followUps || !followUps.length) return base;

  return [base, '', formatFollowUpSection(followUps)].join('\n');
}

function formatHumanizedResponse(mainAnswer, userQuery, context = {}) {
  const lines = [];
  const intent = context.intent || 'general';
  const detectedIntent = intent;
  const originalLength = String(mainAnswer || '').length;

  // 1. Intent confirmation (opening)
  const confirmation = buildHumanizedIntentConfirmation(intent, userQuery, context);
  console.log('[TRACE_TEMPLATE_SELECTION]', {
    function: 'formatHumanizedResponse',
    detectedIntent: intent,
    selectedTemplate: confirmation ? confirmation.slice(0, 240) : null,
    reason: 'buildHumanizedIntentConfirmation selected opening confirmation'
  });
  if (confirmation) {
    lines.push(confirmation);
    lines.push('');
  }
  
  // 2. Main answer (already from RAG, unchanged)
  console.log('[TRACE_BEFORE_CLEANING]', {
    detectedIntent,
    originalLength,
    preview: String(mainAnswer || '').slice(0, 240)
  });
  const cleaned = cleanMainAnswer(mainAnswer, intent);
  console.log('[TRACE_AFTER_CLEANING]', {
    detectedIntent,
    originalLength,
    cleanedLength: String(cleaned || '').length,
    preview: String(cleaned || '').slice(0, 240)
  });
  if (!cleaned) {
    console.log('[TRACE_BEFORE_NODATA]', { detectedIntent, userQuery, context });
    return buildNoDataResponse(userQuery, intent, context);
  }
  lines.push(cleaned);

  // 3. Mini summary closing (ringkasan 1 kalimat tanpa mengulang seluruh jawaban)
  const miniSummary = buildMiniSummary(cleaned, intent, userQuery);
  if (miniSummary) {
    lines.push('');
    lines.push(miniSummary);
  }
  
  // 4. Natural closing + follow-up questions (tidak label "Kesimpulan:")
  const showFollowUps = envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false);
  const followUps = showFollowUps ? generateFollowUpQuestions(intent, userQuery, context) : [];
  if (followUps && followUps.length > 0) {
    lines.push('');
    lines.push(formatFollowUpSection(followUps));
  }
  
  return lines.join('\n').trim();
}

function cleanMainAnswer(text, intent = 'general') {
  let cleaned = String(text || '');
  
  // 1. Remove "Topik:", "Informasi Terkait:", "Kesimpulan:" sections
  cleaned = cleaned.replace(/^\s*Topik\s*:?.*$/im, '');
  cleaned = cleaned.replace(/^\s*Informasi\s+Terkait\s*[:\-]?\s*[\s\S]*$/im, '');
  cleaned = cleaned.replace(/^\s*Kesimpulan\s*:?[\s\S]*$/im, '');
  cleaned = cleaned.replace(/(?:\n\s*)?(?:Rekomendasi pertanyaan berikutnya[:\s]*|Rekomendasi pertanyaan[:\s]*|Apakah\s+Kakak\s+ingin\s+dijelaskan[^\n]*\?|Balas(?:\s+saja)?\s*:\s*|Silakan\s+diketikkkan|Butuh\s+informasi|Coba\s+tanya|Mau\s+(?:saya\s+jelaskan|tahu|info)\b)[\s\S]*$/i, '');
  
  // 2. Remove standalone markers
  cleaned = cleaned.replace(/^Baik kak,\s*$/im, '');
  cleaned = cleaned.replace(/^Siap kak,\s*$/im, '');
  cleaned = cleaned.replace(/^Oke kak,\s*$/im, '');
  
  // 3. Remove retrieval artifacts (URLs, "Saya menemukan", "Sumber:", etc.)
  cleaned = removeRetrievalArtifacts(cleaned);
  
  // 4. Remove irrelevant marketing sections based on intent
  cleaned = removeIrrelevantMarketingSections(cleaned, intent);
  
  // 5. Remove rhetorical questions from body (move to follow-ups)
  cleaned = removeRetoricalQuestions(cleaned);
  
  // 6. Convert raw quotes to natural explanation (for program_definition)
  if (intent === 'program_definition' || intent === 'program_studi') {
    cleaned = convertRawQuotesToNatural(cleaned);
  }
  
  // 7. Filter non-STIKOM programs from answers about programs/careers
  if (['program_studi', 'prospek_kerja', 'perbandingan_prodi', 'program_definition', 'international_double_degree'].includes(intent)) {
    cleaned = filterNonStikomPrograms(cleaned);
  }
  
  return cleaned.trim();
}

function removeRetoricalQuestions(text) {
  if (!text) return '';

  // Remove rhetorical questions that appear in the middle of answer
  // These should only appear in follow-up section
  const rhetoricPatterns = [
    // "Apa saja peluang karir..." + next sentence
    /Apa(?:\s+|-)saja[^\n]*\?\s*(?:[A-Z][^\n]*\.)?/gi,
    // "Apakah Anda ingin tahu..." + next sentence
    /Apakah(?:\s+|-|kamu|Anda|Kakak).*(?:ingin|mau|tertarik)[^\n]*\?[^\n]*\n?/gi,
    // "Bagaimana jika..."
    /Bagaimana\s+jika[^\n]*\?\s*(?:[A-Z][^\n]*\.)?/gi,
    // "Ingin tahu lebih lanjut..."
    /Ingin\s+tahu[^\n]*\?\s*(?:[A-Z][^\n]*\.)?/gi,
    // "Berminat untuk..."
    /Berminat\s+untuk[^\n]*\?\s*(?:[A-Z][^\n]*\.)?/gi,
    // "Tertarik dengan..."
    /Tertarik\s+dengan[^\n]*\?\s*(?:[A-Z][^\n]*\.)?/gi,
    // "Balas saja:" / "Balas:"
    /Balas(?:\s+saja)?\s*:\s*[^\n]*\n?/gi,
    // "Hubungi kami..."
    /Hubungi\s+kami[^\n]*\n?/gi,
    // "Jangan ragu..."
    /Jangan\s+ragu[^\n]*\n?/gi,
    // Cleanup extra newlines
    /\n\s*\n\s*\n/g
  ];

  let cleaned = String(text);
  for (const pattern of rhetoricPatterns) {
    cleaned = cleaned.replace(pattern, '\n');
  }

  return cleaned.trim();
}

function convertRawQuotesToNatural(text) {
  if (!text) return '';

  let cleaned = String(text);

  // Convert long quoted sentences to natural explanation
  // Pattern: "Single very long quoted sentence about ..."
  // Replace with: Introduction text mentioning the same topic naturally
  cleaned = cleaned.replace(
    /\n"([^"]{50,})"\n?/g,
    (match, quotedText) => {
      // If quoted text is too structured or formal, introduce it naturally
      if (quotedText.length > 80) {
        return `\n\n${quotedText.replace(/["]/g, '').trim()}\n`;
      }
      return match;
    }
  );

  // Remove standalone quoted headers that start with capital letters
  cleaned = cleaned.replace(/\n"([A-Z][^"]{10,50})"\n/g, '\n$1\n');

  return cleaned.trim();
}

function filterNonStikomPrograms(text) {
  if (!text) return '';

  // STIKOM programs available in knowledge base
  const stikomPrograms = [
    'Teknologi Informasi',
    'Sistem Informasi',
    'Sistem Komputer',
    'TI',
    'SI',
    'SK'
  ];

  // Programs NOT available at STIKOM (should be removed).
  // Use stricter detection so generic phrases like "manajemen data" do not get dropped.
  const nonStikomPatterns = [
    /\bTeknik Informatika\b/i,
    /\bIlmu Komputer\b/i,
    /\bStatistika\b/i,
    /\bTeknik Elektro\b/i,
    /\bTeknik Mesin\b/i,
    /\bTeknik Sipil\b/i,
    /^\s*[\d\-\*•]?\s*(?:Manajemen|Akuntansi|Administrasi|Bisnis)\b/i,
    /\bProgram Studi\s+(?:Manajemen|Akuntansi|Administrasi|Bisnis)\b/i,
    /\b(?:Manajemen|Akuntansi|Administrasi|Bisnis)\s*[-–—:]/i
  ];

  let cleaned = String(text);

  // Remove paragraphs that mention non-STIKOM programs
  const lines = cleaned.split('\n');
  const filtered = lines.filter(line => {
    // Check if line mentions non-STIKOM programs
    for (const pattern of nonStikomPatterns) {
      if (pattern.test(line)) {
        return false; // Exclude this line
      }
    }
    return true; // Keep line
  });

  return filtered.join('\n').trim();
}

function removeRetrievalArtifacts(text) {
  if (!text) return '';

  const lines = String(text).split('\n').map(line => line.trim());
  const filtered = [];

  for (const line of lines) {
    if (!line) continue;
    if (/^\s*(Saya menemukan kutipan berikut|Saya menemukan kutipan|Saya menemukan|Saya mendapatkan|Dikutip dari|Menurut sumber|Sumber[:\-]?)/i.test(line)) continue;
    if (/^(Sumber|Source|Referensi|Catatan|Note)[:\-]/i.test(line)) continue;
    if (/https?:\/\/|www\.[^\s]+/i.test(line)) continue;
    if (/^[-*•◦]\s*https?:\/\/|^[-*•◦]\s*www\./i.test(line)) continue;
    if (/^(http|www)\b/i.test(line)) continue;
    if (/^['"“”‘’].*['"“”‘’]$/.test(line) && line.length < 160) continue;
    if (/\b(?:dokumen|file|pdf|artikel|laporan|riset)\b/i.test(line) && /\b(?:lihat|unduh|download|akses|dokumen|PDF|sumber)\b/i.test(line)) continue;
    filtered.push(line);
  }

  return filtered.join('\n');
}

function removeIrrelevantMarketingSections(text, intent = 'general') {
  if (!text) return '';

  const normalizedIntent = String(intent || '').toLowerCase();
  const feeIntents = new Set([
    'biaya',
    'biaya_kuliah',
    'biaya_prodi',
    'biaya_pendaftaran',
    'biaya_semester',
    'biaya_dpp',
    'fee'
  ]);
  const feeGuard = /\b(?:rp|dpp|ukt|biaya\s+kuliah|biaya\s+pendaftaran|biaya\s+semester|biaya\s+pendidikan|biaya\s+awal\s+masuk|biaya\s+masuk|rincian\s+biaya|total\s+biaya|dana\s+pendidikan(?:\s+poko?k)?|dana\s+pendidikan\s+poko?k|cicilan|fee|bayar|harga)\b/i;

  // Preserve fee/biaya blocks completely when the answer clearly contains price information
  if (feeIntents.has(normalizedIntent) || feeGuard.test(text)) {
    return text;
  }

  // Intents where marketing/fee/PMB blocks are RELEVANT and should be kept
  const marketingIntents = [
    'beasiswa',
    'pendaftaran',
    'registration',
    'tuition_fee',
    'pmb',
    'scholarship',
    'jadwal_pendaftaran',
    'biaya'
  ];

  // If this is a marketing-related query, keep marketing blocks
  if (marketingIntents.includes(normalizedIntent)) {
    return text;
  }

  // For ALL other intents, remove marketing/fee/PMB boilerplate
  // This includes: program_definition, perbandingan_prodi, rekomendasi_prodi, career_guidance, prospek_kerja, etc.
  const marketingPatterns = /(?:\n\s*\n)?(?:Untuk\s+meringankan\s+biaya|Silakan\s+hubungi\s+PMB|Beasiswa\s+KIP|Beasiswa\s+1K1S|Beasiswa\s+Prestasi|Beasiswa\s+Yayasan|Potongan\s+Biaya\s+Pendaftaran|Mau\s+saya\s+jelaskan[^\n]*beasiswa|Informasi\s+beasiswa|Biaya\s+pendaftaran|\bDPP\b|Dana\s+Pendidikan\s+Pokok|Biaya\s+Pendidikan\s+Per\s+Semester|\bUKT\b|\bKIP\b|cicilan|gelombang\s+pendaftaran|cara\s+mendaftar|persyaratan\s+pendaftaran)[\s\S]*$/i;

  return String(text)
    .replace(marketingPatterns, '')
    .trim();
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isStructuredHumanizerAnswer(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return false;
  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  const bulletLines = lines.filter(line => /^[-*•◦\d\.\)]\s+/.test(line));
  if (bulletLines.length >= Math.ceil(lines.length / 2)) return true;
  if (/\b(perbandingan\s+singkat|perbandingan\s+cepat|beasiswa\b|kip\b|1k1s\b|prestasi\b|yayasan\b|jadwal\b|gelombang\b|pendaftaran\b|daftar\b|akreditasi\b|biaya\b|dpp\b|ukt\b|cicilan\b)\b/i.test(normalized) && bulletLines.length > 0) {
    return true;
  }
  return false;
}

function buildMiniSummary(text, intent = 'general', userQuery = '') {
  if (!text || !text.trim()) return '';
  if (isStructuredHumanizerAnswer(text)) return '';

  const normalizedIntent = String(intent || '').toLowerCase();
  const skipSummaryIntents = new Set([
    'biaya',
    'biaya_kuliah',
    'biaya_prodi',
    'biaya_pendaftaran',
    'biaya_semester',
    'biaya_dpp',
    'fee',
    'beasiswa',
    'scholarship',
    'jadwal_pendaftaran',
    'schedule',
    'pmb',
    'registration'
  ]);
  const userQueryLooksStructured = /\b(?:beasiswa|scholarship|jadwal|gelombang|pendaftaran|biaya|dpp|ukt|cicilan|harga|dana\s+pendidikan)\b/i.test(String(userQuery || ''));
  if (skipSummaryIntents.has(normalizedIntent) || userQueryLooksStructured) return '';

  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n').filter(Boolean);
  
  // Check 1: If answer is too short, don't show summary
  if (lines.length < 5) return '';
  
  const paragraphs = raw.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return '';

  let candidate = '';
  
  // Skip patterns for structured content
  const skipPatterns = [
    /^[-•*•◦]/,  // Bullets
    /^Lulusan:|^Prospek:|^Kurikulum:|^Bidang:|^Informasi/,  // Structured headers
    /^".*"$/,  // Quoted lines
    /^\d+\.|^[-][\w\s]+[-]/  // Numbered lists or dashed items
  ];
  
  // Strategy 1: Find meaningful sentence from 2nd+ paragraph (skip bullets/lists)
  for (const para of paragraphs.slice(1)) {
    // Skip entire paragraph if it's mostly structured data
    const paraLines = para.split('\n');
    const structuredCount = paraLines.filter(line => {
      const trimmed = line.trim();
      return /^[A-Z][a-z]+:|^[-]/.test(trimmed) || trimmed.length < 20;
    }).length;
    
    // If more than half lines are structured, skip this paragraph
    if (structuredCount > paraLines.length / 2) continue;
    
    const sentences = para.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
    const firstMeaningful = sentences.find(s => {
      // Skip if starts with bullet/dash or contains structured data
      for (const pattern of skipPatterns) {
        if (pattern.test(s)) return false;
      }
      
      // Skip if contains too many structured headers inside
      if ((s.match(/:\s/g) || []).length > 2) return false;
      
      const words = s.replace(/[-•]/g, '').trim().split(/\s+/).filter(Boolean);
      return words.length >= 7 && !/^[a-z]/.test(s);
    });
    if (firstMeaningful) {
      candidate = firstMeaningful;
      break;
    }
  }
  
  // Strategy 2: If no good sentence found in later paragraphs, try 2nd sentence from first
  if (!candidate && paragraphs.length > 0) {
    const firstParaSentences = paragraphs[0].split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
    if (firstParaSentences.length > 1) {
      const meaningfulSentence = firstParaSentences.slice(1).find(s => {
        // Apply same filters
        for (const pattern of skipPatterns) {
          if (pattern.test(s)) return false;
        }
        if ((s.match(/:\s/g) || []).length > 2) return false;
        
        const words = s.replace(/[-•]/g, '').trim().split(/\s+/).filter(Boolean);
        return words.length >= 7;
      });
      if (meaningfulSentence) {
        candidate = meaningfulSentence;
      }
    }
  }
  
  if (!candidate) return '';
  
  // Clean up and format
  candidate = candidate.replace(/\s+/g, ' ').trim();
  if (!/[.?!]$/.test(candidate)) {
    candidate += '.';
  }
  
  // Limit length
  const words = candidate.split(/\s+/);
  if (words.length > 25) {
    candidate = words.slice(0, 25).join(' ') + '.';
  }
  
  // Only show if it's actually meaningful (minimum 25 chars)
  if (candidate.length < 25) return '';
  
  return `Singkatnya, ${candidate}`;
}

function formatFollowUpSection(questions) {
  if (!questions || questions.length === 0) return '';
  
  const lines = [];
  
  // Natural opening instead of "Rekomendasi pertanyaan berikutnya:"
  lines.push('Kalau Kakak ingin tahu lebih lanjut, mungkin pertanyaan berikut juga bisa membantu:');
  lines.push('');
  
  // Add questions with bullet points
  questions.forEach(q => {
    lines.push(`- ${q}`);
  });
  
  return lines.join('\n');
}

// =====================================================
// 4. IMPROVE VIRTUAL ASSISTANT PERSONA
// =====================================================

/**
 * Apply persona rules untuk membuat responses terasa lebih natural:
 * - Sopan, profesional, ramah
 * - Tidak terlalu formal, tidak terlalu santai
 * - Seperti staf informasi kampus digital
 * - Hindari standalone "Baik kak", "Siap kak", "Oke kak"
 */
function applyVirtualAssistantPersona(text) {
  let output = String(text || '');
  
  // 1. Remove standalone persona markers
  output = output.replace(/^Baik kak,?\s*$/im, '');
  output = output.replace(/^Siap kak,?\s*$/im, '');
  output = output.replace(/^Oke kak,?\s*$/im, '');
  output = output.replace(/^Sip kak,?\s*$/im, '');
  
  // 2. Improve opening phrases (embed persona in sentences)
  output = output.replace(/^Baik kak,\s+/im, 'Baik Kak, ');
  output = output.replace(/^Siap kak,\s+/im, 'Tentu Kak, ');
  output = output.replace(/^OK kak,\s+/im, 'Baik Kak, ');
  output = output.replace(/^OK,\s+/im, 'Baik, ');
  
  // 3. Normalize address terms
  output = output.replace(/\b(Anda)\b/gi, 'Kakak');
  output = output.replace(/\b(Saya akan)\b/gi, 'Saya bantu');
  
  // 4. Make language softer
  output = output.replace(/Mohon/gi, 'Tolong');
  output = output.replace(/\bJika\b/gi, 'Kalau');
  output = output.replace(/\bApabila\b/gi, 'Kalau');
  
  // 5. Remove excessive formality
  output = output.replace(/Dengan hormat,?/gi, '');
  output = output.replace(/Terima kasih atas perhatian Anda\./gi, 'Semoga membantu ya Kak!');
  
  return output.trim();
}

// =====================================================
// 5. HELPER FUNCTIONS
// =====================================================

function extractProgramName(userQuery) {
  const programMap = [
    { pattern: /\b(si|sistem\s+informasi)\b/i, name: 'Sistem Informasi' },
    { pattern: /\b(ti|teknologi\s+informasi)\b/i, name: 'Teknologi Informasi' },
    { pattern: /\b(bd|bisnis\s+digital)\b/i, name: 'Bisnis Digital' },
    { pattern: /\b(sk|sistem\s+komputer)\b/i, name: 'Sistem Komputer' },
    { pattern: /\b(mi|manajemen\s+informatika)\b/i, name: 'Manajemen Informatika' },
    { pattern: /\b(s2|pascasarjana|magister)\b/i, name: 'S2 Sistem Informasi' }
  ];
  
  const matched = programMap.find(m => m.pattern.test(userQuery));
  return matched ? matched.name : null;
}

function extractProgramsFromQuery(userQuery) {
  const programs = [];
  
  if (/\b(si|sistem\s+informasi)\b/i.test(userQuery)) programs.push('Sistem Informasi');
  if (/\b(ti|teknologi\s+informasi)\b/i.test(userQuery)) programs.push('Teknologi Informasi');
  if (/\b(bd|bisnis\s+digital)\b/i.test(userQuery)) programs.push('Bisnis Digital');
  if (/\b(sk|sistem\s+komputer)\b/i.test(userQuery)) programs.push('Sistem Komputer');
  
  return programs;
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  // Main entry points
  buildHumanizedIntentConfirmation,
  generateFollowUpQuestions,
  formatHumanizedResponse,
  applyVirtualAssistantPersona,
  cleanMainAnswer,
  formatFollowUpSection,
  
  // Helpers (for testing)
  extractProgramName,
  extractProgramsFromQuery,
  buildMiniSummary,
  removeRetrievalArtifacts,
  removeIrrelevantMarketingSections,
  removeRetoricalQuestions,
  convertRawQuotesToNatural,
  filterNonStikomPrograms,
  
  // Intent-specific builders
  buildProgramStudyConfirmation,
  buildFeeConfirmation,
  buildScholarshipConfirmation,
  buildRegistrationConfirmation,
  buildScheduleConfirmation,
  buildLocationConfirmation,
  buildCareerProspectConfirmation
};
