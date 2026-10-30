'use strict';

/**
 * src/engine/programFitReasoning.js
 *
 * Wave 2 Architecture: Generalization of Academic Program Recommendations.
 *
 * Invariants:
 * 1. Single Source of Truth: Official curriculum competencies, study focus, and career prospects
 *    from official ITB STIKOM Bali documents (including 'Penjelasan Prodi dan Karier Masa Depan').
 * 2. Zero Lexical / Heuristic Winner Selection: Does NOT use regex/phrase matching against
 *    keyword lists or static/heuristic score constants to rank or crown a winning program.
 * 3. Neutral Curriculum Profile Gathering: Assembles relevant official curriculum profiles
 *    so the single AI synthesis stage can compare user semantic needs against official curriculum
 *    evidence, or so the fallback can present curriculum profiles neutrally without forcing a winner.
 * 4. Safe Boundaries: No hallucination of fictitious faculties or standalone majors.
 *    Double degree partner majors remain explicitly uninvented unless grounded.
 * 5. Broad / Ambiguous Inquiries: Triggers BROAD_GUIDANCE with neutral clarifying questions.
 */

const PROGRAMS = Object.freeze({
  si: {
    key: 'si',
    label: 'Sistem Informasi (SI)',
    type: 'S1',
    canonicalName: 'S1 Sistem Informasi',
    grounding: 'Program S1 reguler ITB STIKOM Bali',
    strengths: ['sistem informasi', 'proses bisnis', 'basis data', 'dashboard', 'analisis kebutuhan', 'solusi digital organisasi'],
    curriculumProfile: {
      competencyDomainTag: { key: 'data', label: 'data / analisis bisnis' },
      studyFocus: 'Analisis sistem informasi, manajemen basis data (database), business intelligence & analytics, tata kelola IT, sistem enterprise, dan penyelarasan proses bisnis',
      suitableFor: 'Minat pada perpaduan teknologi informasi dengan manajemen proses bisnis, pengolahan data, dan perancangan solusi organisasi',
      careerProspects: 'Business Analyst, System Analyst, Database Administrator, IT Consultant, Project Manager'
    }
  },
  ti: {
    key: 'ti',
    label: 'Teknologi Informasi (TI)',
    type: 'S1',
    canonicalName: 'S1 Teknologi Informasi',
    grounding: 'Program S1 reguler ITB STIKOM Bali',
    strengths: ['coding', 'software', 'aplikasi', 'frontend', 'backend', 'cloud', 'jaringan', 'cyber security'],
    curriculumProfile: {
      competencyDomainTag: { key: 'software', label: 'coding / software' },
      studyFocus: 'Rekayasa perangkat lunak (software engineering), pemrograman web dan mobile (fullstack), cloud computing, arsitektur jaringan komputer, dan keamanan siber (cyber security)',
      suitableFor: 'Minat pada pemrograman/coding, pembuatan aplikasi, arsitektur software, infrastruktur server, dan pertahanan siber',
      careerProspects: 'Software Engineer, Fullstack Web/Mobile Developer, Cloud Engineer, Network Engineer, Cybersecurity Specialist'
    }
  },
  sk: {
    key: 'sk',
    label: 'Sistem Komputer (SK)',
    type: 'S1',
    canonicalName: 'S1 Sistem Komputer',
    grounding: 'Program S1 reguler ITB STIKOM Bali',
    strengths: ['hardware', 'IoT', 'embedded system', 'jaringan', 'mikrokontroler', 'robotika', 'integrasi perangkat'],
    curriculumProfile: {
      competencyDomainTag: { key: 'hardware', label: 'hardware / IoT / robotika' },
      studyFocus: 'Perangkat keras (hardware), arsitektur komputer, mikroelektronika, mikrokontroler, embedded system, Internet of Things (IoT), robotika, dan transmisi jaringan',
      suitableFor: 'Minat pada perangkat fisik, perakitan perangkat, elektronika cerdas, robotika, dan integrasi hardware-software',
      careerProspects: 'IoT Engineer, Embedded Systems Engineer, Hardware Engineer, Network Specialist, Robotics Developer'
    }
  },
  bd: {
    key: 'bd',
    label: 'Bisnis Digital (BD)',
    type: 'S1',
    canonicalName: 'S1 Bisnis Digital',
    grounding: 'Program S1 reguler ITB STIKOM Bali',
    strengths: ['digital marketing', 'e-commerce', 'branding', 'konten', 'produk digital', 'analisis pasar', 'wirausaha digital'],
    curriculumProfile: {
      competencyDomainTag: { key: 'business', label: 'bisnis digital / marketing' },
      studyFocus: 'Digital marketing, e-commerce, strategi branding produk digital, social media marketing, live commerce, analisis pasar dan perilaku konsumen digital, serta rintisan bisnis digital (startup)',
      suitableFor: 'Minat pada bisnis, pemasaran digital, media sosial, riset pasar online, dan strategi produk komersial berbasis teknologi',
      careerProspects: 'Digital Marketing Specialist, E-Commerce Specialist, Brand Strategist, Growth Hacker, Digital Entrepreneur'
    }
  },
  mi: {
    key: 'mi',
    label: 'Manajemen Informatika (MI)',
    type: 'D3',
    canonicalName: 'D3 Manajemen Informatika',
    grounding: 'Program D3 ITB STIKOM Bali',
    strengths: ['aplikasi praktis', 'pengolahan data', 'IT support', 'administrasi sistem', 'programmer junior'],
    curriculumProfile: {
      competencyDomainTag: { key: 'vocational_it', label: 'vokasi / komputasi terapan' },
      studyFocus: 'Komputasi terapan, pengolahan data praktis, administrasi basis data operasional, perancangan aplikasi terapan, dan dukungan teknis IT jenjang vokasi 3 tahun',
      suitableFor: 'Mencari program vokasi 3 tahun siap kerja dengan keterampilan praktis di bidang teknologi informasi dan administrasi data',
      careerProspects: 'Junior Programmer, IT Support Specialist, Database Administrator Junior, Information System Staff'
    }
  },
  utb: {
    key: 'utb',
    label: 'Double Degree UTB',
    type: 'Double Degree National Class',
    canonicalName: 'Double Degree UTB',
    grounding: 'Data resmi mencantumkan Prodi di ITB STIKOM Bali: Bisnis Digital; jurusan di UTB: DKV (Desain Komunikasi Visual)',
    strengths: ['DKV', 'desain komunikasi visual', 'desain grafis', 'ilustrasi', 'visual branding', 'konten visual', 'bisnis kreatif'],
    curriculumProfile: {
      competencyDomainTag: { key: 'visual_design', label: 'desain visual / DKV' },
      studyFocus: 'Perpaduan S1 Bisnis Digital di ITB STIKOM Bali dan Desain Komunikasi Visual (DKV) di Universitas Teknologi Bandung (UTB), desain grafis, ilustrasi, visual branding, dan multimedia kreatif',
      suitableFor: 'Minat pada perancangan visual, seni grafis, ilustrasi, DKV, dan ingin mengintegrasikannya dengan strategi bisnis digital & branding',
      careerProspects: 'Visual Designer, Illustrator, Brand Identity Designer, Creative Director, Digital Media Producer'
    }
  },
  dnui: {
    key: 'dnui',
    label: 'Double Degree DNUI',
    type: 'Double Degree International Class',
    canonicalName: 'Double Degree DNUI',
    grounding: 'Data resmi mencantumkan Prodi di ITB STIKOM Bali: Bisnis Digital; jurusan partner DNUI belum tercantum pada data tersedia',
    strengths: ['bisnis digital', 'pengalaman internasional', 'teknologi dan bisnis digital'],
    curriculumProfile: {
      competencyDomainTag: { key: 'international_business', label: 'double degree internasional bisnis digital' },
      studyFocus: 'Bisnis Digital dengan kemitraan internasional Dalian Neusoft University of Information (DNUI China)',
      suitableFor: 'Tertarik bisnis digital dengan perspektif dan jejaring internasional',
      careerProspects: 'International Digital Business Specialist, Global Market Analyst'
    }
  },
  help: {
    key: 'help',
    label: 'Double Degree HELP University',
    type: 'Double Degree International Class',
    canonicalName: 'Double Degree HELP University',
    grounding: 'Data resmi mencantumkan Prodi di ITB STIKOM Bali: Sistem Informasi; jurusan partner HELP belum tercantum pada data tersedia',
    strengths: ['sistem informasi', 'pengalaman internasional', 'bisnis dan sistem organisasi'],
    curriculumProfile: {
      competencyDomainTag: { key: 'international_systems', label: 'double degree internasional sistem informasi' },
      studyFocus: 'Sistem Informasi dengan kemitraan internasional HELP University Malaysia',
      suitableFor: 'Tertarik sistem informasi perusahaan dengan eksposur internasional',
      careerProspects: 'International IT Project Manager, Global Systems Consultant'
    }
  }
});

/**
 * @deprecated Legacy static signals array archived in favor of AI semantic synthesis over official curriculum profiles.
 * Preserved as an empty array strictly for backward-compatibility with external imports.
 */
const SIGNALS = [];

/**
 * @deprecated Legacy static competency domain list archived in Wave 2.
 */
const COMPETENCY_DOMAINS = Object.freeze([]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/+-]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Derives neutral official curriculum-grounded description for a program
 */
function deriveCurriculumReason(progKey) {
  const prog = PROGRAMS[progKey];
  if (!prog) return '';
  const focus = prog.curriculumProfile?.studyFocus || prog.strengths.join(', ');
  const suitable = prog.curriculumProfile?.suitableFor || '';
  return suitable
    ? `Kurikulum ${prog.label} berfokus pada ${focus}. Relevan untuk: ${suitable}.`
    : `Kurikulum ${prog.label} berfokus pada ${focus}.`;
}

/**
 * Gathers official curriculum profiles neutrally without lexical phrase matching or heuristic scoring.
 *
 * When a user inquiry is ungrounded/failed interpretation (speechAct === 'UNKNOWN' or executionRoute === 'UNKNOWN')
 * or out of domain / unsupported, returns [] so the pipeline can ask for clarification or return SAFE_UNKNOWN.
 * When ambiguous or broad, returns [] so BROAD_GUIDANCE is triggered.
 * Otherwise, assembles the official curriculum profiles for AI synthesis comparison or neutral fallback presentation.
 */
function detectProgramFitSignals(question, semanticFrame = {}, evidenceList = []) {
  const q = normalizeText(question);
  const hasFrameInput = Boolean(
    semanticFrame?.userInterest ||
    (Array.isArray(semanticFrame?.semanticConcepts) && semanticFrame.semanticConcepts.length > 0) ||
    (Array.isArray(semanticFrame?.entities) && semanticFrame.entities.length > 0) ||
    (Array.isArray(semanticFrame?.candidateEntities) && semanticFrame.candidateEntities.length > 0)
  );

  if (!q && !hasFrameInput) {
    return [];
  }

  // Fail closed when semantic interpretation failed / unknown or unsupported / out-of-domain
  if (
    semanticFrame?.speechAct === 'UNKNOWN' ||
    semanticFrame?.executionRoute === 'UNKNOWN' ||
    semanticFrame?.domain === 'OUT_OF_DOMAIN' ||
    semanticFrame?.domain === 'UNSUPPORTED_PROGRAM' ||
    semanticFrame?.isUnsupportedEntity ||
    semanticFrame?.unsupportedEntity
  ) {
    return [];
  }

  // Broad or high-ambiguity inquiries trigger broad overview & clarification without locking candidates
  if (
    semanticFrame?.ambiguityLevel === 'HIGH' ||
    isBroadSchoolBackgroundWithoutSpecificPreference(question, { canonical: semanticFrame })
  ) {
    return [];
  }

  // Filter curriculum catalog only by explicit structural scope constraints if specified
  const requestedLevel = (
    semanticFrame?.scopeConstraints?.academicLevel ||
    semanticFrame?.academicLevel ||
    ''
  ).toUpperCase();

  let selectedKeys = Object.keys(PROGRAMS);
  if (requestedLevel === 'D3') {
    selectedKeys = ['mi', 'si', 'ti', 'bd'];
  } else if (requestedLevel === 'S1') {
    selectedKeys = ['bd', 'si', 'ti', 'sk', 'utb', 'dnui', 'help'];
  }

  // If retrieved RAG evidence chunks reference specific programs, ensure they are included in the curriculum profile set
  if (Array.isArray(evidenceList) && evidenceList.length > 0) {
    for (const progKey of Object.keys(PROGRAMS)) {
      if (!selectedKeys.includes(progKey)) {
        selectedKeys.push(progKey);
      }
    }
  }

  const candidateTuples = selectedKeys.map((progKey) => [
    progKey,
    'candidate',
    deriveCurriculumReason(progKey)
  ]);

  return [
    {
      key: 'official_curriculum_profiles',
      label: 'Profil Kurikulum & Kompetensi Resmi ITB STIKOM Bali',
      evidenceSource: 'Pedoman Akademik & Kurikulum Resmi ITB STIKOM Bali',
      evidenceSnippet: candidateTuples
        .map(([k, , r]) => `${PROGRAMS[k]?.canonicalName || k}: ${r}`)
        .join('; '),
      weights: {},
      candidates: candidateTuples
    }
  ];
}

/**
 * Returns neutral official curriculum profiles for candidate study programs without heuristic ranking.
 */
function getProgramFitCandidates(question, semanticFrame = {}, evidenceList = []) {
  const signals = detectProgramFitSignals(question, semanticFrame, evidenceList);
  const profileMap = new Map();

  for (const signal of signals) {
    if (!signal || !Array.isArray(signal.candidates)) continue;
    signal.candidates.forEach(([programKey, level, reason]) => {
      const progMeta = PROGRAMS[programKey];
      if (!progMeta) return;

      const canonicalName = progMeta.canonicalName || progMeta.label;
      if (!profileMap.has(programKey)) {
        profileMap.set(programKey, {
          program: progMeta,
          programKey,
          canonicalName,
          studyFocus: progMeta.curriculumProfile?.studyFocus || progMeta.strengths.join(', '),
          suitableFor: progMeta.curriculumProfile?.suitableFor || '',
          careerProspects: progMeta.curriculumProfile?.careerProspects || '',
          grounding: progMeta.grounding,
          levels: [],
          reasons: [],
          signals: []
        });
      }
      const entry = profileMap.get(programKey);
      entry.levels.push(level || 'candidate');
      entry.reasons.push(reason || deriveCurriculumReason(programKey));
      entry.signals.push(signal.label);
    });
  }

  return Array.from(profileMap.values())
    .sort((a, b) => {
      const nameA = String(a.canonicalName || '').normalize('NFC');
      const nameB = String(b.canonicalName || '').normalize('NFC');
      return nameA < nameB ? -1 : (nameA > nameB ? 1 : 0);
    })
    .map((entry) => ({
      ...entry,
      confidence: 'NEUTRAL',
      signals: Array.from(new Set(entry.signals)),
      levels: Array.from(new Set(entry.levels)),
      reasons: Array.from(new Set(entry.reasons))
    }));
}

function detectExplicitProgram(question, options = {}) {
  const canonicalProgs = options?.canonical?.entities?.programs;
  if (Array.isArray(canonicalProgs) && canonicalProgs.length > 0) {
    const rawName = String(canonicalProgs[0]?.name || canonicalProgs[0]?.canonical || canonicalProgs[0] || '').toLowerCase();
    if (rawName.includes('sistem informasi') || rawName === 'si') return PROGRAMS.si;
    if (rawName.includes('teknologi informasi') || rawName === 'ti') return PROGRAMS.ti;
    if (rawName.includes('sistem komputer') || rawName === 'sk') return PROGRAMS.sk;
    if (rawName.includes('bisnis digital') || rawName === 'bd') return PROGRAMS.bd;
    if (rawName.includes('manajemen informatika') || rawName === 'mi') return PROGRAMS.mi;
  }
  const q = normalizeText(question);
  if (/\b(?:sistem\s+informasi|prodi\s+si|jurusan\s+si)\b/i.test(q)) return PROGRAMS.si;
  if (/\b(?:teknologi\s+informasi|prodi\s+ti|jurusan\s+ti)\b/i.test(q)) return PROGRAMS.ti;
  if (/\b(?:sistem\s+komputer|prodi\s+sk|jurusan\s+sk)\b/i.test(q)) return PROGRAMS.sk;
  if (/\b(?:bisnis\s+digital|prodi\s+bd|jurusan\s+bd)\b/i.test(q)) return PROGRAMS.bd;
  if (/\b(?:manajemen\s+informatika|prodi\s+mi|jurusan\s+mi)\b/i.test(q)) return PROGRAMS.mi;
  if (/\b(?:utb)\b/i.test(q)) return PROGRAMS.utb;
  if (/\b(?:dnui)\b/i.test(q)) return PROGRAMS.dnui;
  if (/\b(?:help)\b/i.test(q)) return PROGRAMS.help;
  return null;
}

function buildProgramAlternativeAnswer(program) {
  const focus = program.curriculumProfile?.studyFocus || program.strengths.join(', ');
  const suitable = program.curriculumProfile?.suitableFor || '';
  const lines = [
    `${program.label} menjadi pilihan tepat terutama bagi calon mahasiswa yang ${suitable}.`,
    '',
    `Karakteristik & Fokus Utama Kurikulum:`,
    `- Jenjang & Status: ${program.grounding}.`,
    `- Fokus Kajian: ${focus}.`,
    `- Prospek Karir: ${program.curriculumProfile?.careerProspects || program.strengths.slice(0, 4).join(', ')}.`,
    '',
    'Catatan: Ini adalah gambaran fokus kurikulum untuk membantu pertimbangan minat Kakak. Untuk informasi kurikulum spesifik, biaya kuliah, atau pendaftaran resmi, silakan merujuk pada ketentuan resmi admisi PMB ITB STIKOM Bali.'
  ];

  return {
    answer: lines.join('\n'),
    candidates: [{
      program,
      confidence: 'HIGH',
      signals: ['program_curriculum_profile'],
      levels: ['primary'],
      reasons: [`Fokus kurikulum pada ${focus}`]
    }],
    source: 'semantic-rag-program-recommendation'
  };
}

function isBroadSchoolBackgroundWithoutSpecificPreference(question, options = {}) {
  if (options?.canonical?.constraints?.profileInsufficient) return true;
  const q = normalizeText(question);
  if (!q) return false;
  const hasSchoolOrigin = /\b(?:berasal\s+dari|lulusan|dari|tamatan|anak|siswa|alumni)\s+(?:smk|sma|ma|stm|sekolah\b)|(?:\bsmk\b|\bsma\b)\s+(?:bidang\s+komputer|jurusan\s+komputer|komputer|tkj|rpl|multimedia|dkv|ipa|ips|it\b|teknik\s+komputer)/i.test(q);
  const isGenericBroad = /\b(?:bingung\s+(?:mau\s+)?(?:pilih|kuliah|masuk)|belum\s+tahu\s+mau\s+pilih|rekomendasi\s+prodi\s+yang\s+bagus|pilihan\s+jurusan\s+apa\s+saja\s+yang\s+cocok|ada\s+jurusan\s+apa\s+saja\s+yang\s+bagus|bingung\s+mau\s+kuliah\s+apa)\b/i.test(q);
  if (!hasSchoolOrigin && !isGenericBroad) return false;
  const hasSpecificCareerOrInterest = /\b(?:ingin\s+(?:jadi|bekerja|kerja|fokus|mendalami)|mau\s+(?:jadi|bekerja|kerja|fokus)|pengen\s+(?:jadi|bekerja|kerja|fokus)|cita\s*-?\s*cita|suka\s+(?:coding|ngoding|pemrograman|hardware|iot|bisnis|marketing|data|desain|gambar|jaringan|cyber)|minat\s+(?:di|ke|pada)\s+(?:coding|ngoding|pemrograman|hardware|iot|bisnis|marketing|data|desain|jaringan|cyber)|hobi\s+(?:coding|ngoding|gambar|desain|merakit)|programmer|software\s+developer|web\s+developer|data\s+analyst|digital\s+marketer|cyber\s*security|iot\s+engineer|network\s+engineer|ui\s*\/?\s*ux)\b/i.test(q);
  return !hasSpecificCareerOrInterest;
}

function buildBroadBackgroundProgramGuidanceAnswer(question) {
  const q = normalizeText(question);
  const isSmkComputer = /\bsmk\b.*\b(?:komputer|tkj|rpl|multimedia|informatika|it\b)/i.test(q);
  const intro = isSmkComputer
    ? 'Latar belakang dari SMK bidang komputer sebenarnya punya dasar yang relevan untuk beberapa program studi di ITB STIKOM Bali. Karena bidang komputer cukup luas, prodi yang paling cocok bergantung pada fokus dan arah karier yang paling kakak minati:'
    : 'Latar belakang sekolah kakak bisa masuk ke beberapa program studi di ITB STIKOM Bali. Agar pilihannya paling pas, berikut gambaran perbedaan fokus tiap prodi yang relevan:';

  const lines = [
    intro,
    '',
    '1. **Teknologi Informasi (TI) — S1**',
    '   Cocok jika kakak lebih tertarik pada pemrograman (coding), pengembangan software/aplikasi (web/mobile), cloud computing, jaringan, dan keamanan siber (cyber security).',
    '2. **Sistem Informasi (SI) — S1**',
    '   Cocok jika kakak tertarik menghubungkan teknologi dengan proses bisnis, analisis sistem perusahaan, pengelolaan basis data (database), dashboard, dan solusi digital organisasi.',
    '3. **Sistem Komputer (SK) — S1**',
    '   Cocok jika kakak lebih menyukai sisi perangkat keras (hardware), arsitektur komputer, embedded system, Internet of Things (IoT), mikrokontroler, dan jaringan komputer.',
    '4. **Bisnis Digital (BD) — S1 / Manajemen Informatika (MI) — D3**',
    '   - **Bisnis Digital (S1)**: cocok jika ingin fokus ke pengembangan bisnis berbasis teknologi, digital marketing, e-commerce, dan strategi produk digital.',
    '   - **Manajemen Informatika (D3)**: cocok jika mencari jalur vokasi/praktis 3 tahun yang fokus pada aplikasi terapan, pengolahan data, dan dukungan operasional IT.',
    '',
    'Supaya saya bisa mengerucutkan rekomendasi yang paling pas buat kakak: selama di SMK atau untuk rencana karier ke depan, kakak lebih suka bagian **coding/pembuatan aplikasi**, **analisis data & sistem bisnis**, atau **perangkat keras (hardware), jaringan & IoT**?',
    '',
    'Catatan: Rekomendasi ini bersifat panduan awal berdasarkan keselarasan kurikulum resmi ITB STIKOM Bali. Untuk konsultasi lebih lanjut mengenai kurikulum dan pendaftaran, silakan menghubungi bagian admisi PMB.'
  ];

  return {
    answer: lines.join('\n'),
    candidates: [
      { program: PROGRAMS.ti, confidence: 'MEDIUM', signals: ['smk_computer_background'], levels: ['candidate'], reasons: ['Fokus software, coding, jaringan, dan keamanan siber'] },
      { program: PROGRAMS.si, confidence: 'MEDIUM', signals: ['smk_computer_background'], levels: ['candidate'], reasons: ['Fokus sistem informasi, analisis bisnis, dan basis data'] },
      { program: PROGRAMS.sk, confidence: 'MEDIUM', signals: ['smk_computer_background'], levels: ['candidate'], reasons: ['Fokus hardware, embedded system, IoT, dan jaringan'] },
      { program: PROGRAMS.bd, confidence: 'MEDIUM', signals: ['smk_computer_background'], levels: ['candidate'], reasons: ['Fokus bisnis digital, e-commerce, dan digital marketing'] }
    ],
    profileInsufficient: true,
    needsClarification: true,
    source: 'semantic-rag-program-recommendation'
  };
}

function buildProgramFitAnswer(question, options = {}) {
  const semanticFrame = options?.semanticFrame || options?.canonical || {};
  if (
    semanticFrame.ambiguityLevel === 'HIGH' ||
    isBroadSchoolBackgroundWithoutSpecificPreference(question, options)
  ) {
    return buildBroadBackgroundProgramGuidanceAnswer(question);
  }
  const explicitProgram = detectExplicitProgram(question, options);
  const q = normalizeText(question);
  const isFitInquiry = /\b(alternatif|pilihan|alasan|kenapa|mengapa|keunggulan|kelebihan|cocoknya)\b/i.test(q);
  if (explicitProgram && isFitInquiry) {
    return buildProgramAlternativeAnswer(explicitProgram, question);
  }

  const candidates = getProgramFitCandidates(question, semanticFrame, options?.evidenceList || []);
  if (!candidates.length) {
    return null;
  }

  const lines = [
    'Berikut informasi fokus kurikulum resmi beberapa program studi di ITB STIKOM Bali sebagai bahan pertimbangan minat Kakak:',
    ''
  ];

  candidates.forEach((item, index) => {
    const program = item.program;
    lines.push(`${index + 1}. ${program.label}`);
    lines.push(`   ${item.reasons[0]}`);
    lines.push(`   Dasar data: ${program.grounding}.`);
  });

  lines.push('');
  lines.push('Untuk membantu mengerucutkan pilihan, bidang kajian atau aktivitas apa yang paling ingin Kakak dalami selama kuliah?');
  lines.push('');
  lines.push('Catatan: ini panduan kurikulum awal berbasis data resmi ITB STIKOM Bali, bukan keputusan mutlak. Untuk biaya, jadwal, syarat, dan detail resmi lain, bot tetap harus mengambil dari data yang tersedia dan tidak menebak.');

  return {
    answer: lines.join('\n'),
    candidates,
    source: 'semantic-rag-program-recommendation'
  };
}

module.exports = {
  PROGRAMS,
  SIGNALS,
  detectProgramFitSignals,
  getProgramFitCandidates,
  buildProgramFitAnswer,
  isBroadSchoolBackgroundWithoutSpecificPreference,
  buildBroadBackgroundProgramGuidanceAnswer
};
