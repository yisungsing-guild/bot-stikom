const PROGRAMS = {
  si: {
    key: 'si',
    label: 'Sistem Informasi (SI)',
    type: 'S1',
    grounding: 'Program S1 reguler ITB STIKOM Bali',
    strengths: ['sistem informasi', 'proses bisnis', 'basis data', 'dashboard', 'analisis kebutuhan', 'solusi digital organisasi']
  },
  ti: {
    key: 'ti',
    label: 'Teknologi Informasi (TI)',
    type: 'S1',
    grounding: 'Program S1 reguler ITB STIKOM Bali',
    strengths: ['coding', 'software', 'aplikasi', 'frontend', 'backend', 'cloud', 'jaringan', 'cyber security']
  },
  sk: {
    key: 'sk',
    label: 'Sistem Komputer (SK)',
    type: 'S1',
    grounding: 'Program S1 reguler ITB STIKOM Bali',
    strengths: ['hardware', 'IoT', 'embedded system', 'jaringan', 'mikrokontroler', 'robotika', 'integrasi perangkat']
  },
  bd: {
    key: 'bd',
    label: 'Bisnis Digital (BD)',
    type: 'S1',
    grounding: 'Program S1 reguler ITB STIKOM Bali',
    strengths: ['digital marketing', 'e-commerce', 'branding', 'konten', 'produk digital', 'analisis pasar', 'wirausaha digital']
  },
  mi: {
    key: 'mi',
    label: 'Manajemen Informatika (MI)',
    type: 'D3',
    grounding: 'Program D3 ITB STIKOM Bali',
    strengths: ['aplikasi praktis', 'pengolahan data', 'IT support', 'administrasi sistem', 'programmer junior']
  },
  utb: {
    key: 'utb',
    label: 'Double Degree UTB',
    type: 'Double Degree National Class',
    grounding: 'Data resmi mencantumkan Prodi di ITB STIKOM Bali: Bisnis Digital; jurusan di UTB: DKV (Desain Komunikasi Visual)',
    strengths: ['DKV', 'desain komunikasi visual', 'desain grafis', 'ilustrasi', 'visual branding', 'konten visual', 'bisnis kreatif']
  },
  dnui: {
    key: 'dnui',
    label: 'Double Degree DNUI',
    type: 'Double Degree International Class',
    grounding: 'Data resmi mencantumkan Prodi di ITB STIKOM Bali: Bisnis Digital; jurusan partner DNUI belum tercantum pada data tersedia',
    strengths: ['bisnis digital', 'pengalaman internasional', 'teknologi dan bisnis digital']
  },
  help: {
    key: 'help',
    label: 'Double Degree HELP University',
    type: 'Double Degree International Class',
    grounding: 'Data resmi mencantumkan Prodi di ITB STIKOM Bali: Sistem Informasi; jurusan partner HELP belum tercantum pada data tersedia',
    strengths: ['sistem informasi', 'pengalaman internasional', 'bisnis dan sistem organisasi']
  }
};

const SIGNALS = [
  {
    key: 'visual_design',
    label: 'desain visual / DKV',
    re: /\b(menggambar|gambar|drawing|ilustrasi|illustration|desain\s+(?:visual|grafis|poster|logo|brand|branding|komunikasi|kemasan)|desain\s+komunikasi\s+visual|dkv|visual\s+branding|poster|logo|tipografi|typography|fotografi|photography|edit\s+video|video\s+editing|motion\s+graphic|animasi|konten\s+visual)\b/i,
    candidates: [
      ['utb', 'primary', 'Jalur ini paling dekat untuk minat visual karena Double Degree UTB memasangkan Bisnis Digital di ITB STIKOM Bali dengan DKV di UTB.'],
      ['bd', 'alternative', 'Cocok sebagai alternatif kalau minat visualnya ingin dipakai untuk branding, konten, digital marketing, e-commerce, atau bisnis kreatif.'],
      ['ti', 'supporting', 'Bisa dipertimbangkan kalau desainnya mengarah ke UI aplikasi, frontend, prototyping, atau produk digital teknis.']
    ]
  },
  {
    key: 'data',
    label: 'data / analisis bisnis',
    re: /\b(data\s+analyst|data\s+analis|analisis\s+data|menganalisa\s+data|mengolah\s+data|dashboard|basis\s+data|database|sql|business\s+intelligence|bi\b|analytics|analitik|laporan\s+data)\b/i,
    candidates: [
      ['si', 'primary', 'Paling dekat karena SI kuat di basis data, dashboard, analisis proses bisnis, dan kebutuhan sistem perusahaan.'],
      ['ti', 'alternative', 'Cocok kalau kakak ingin sisi data yang lebih teknis seperti coding, backend, data engineering, atau integrasi sistem.'],
      ['bd', 'alternative', 'Relevan untuk data bisnis, marketing analytics, e-commerce, riset pasar, dan analisis perilaku konsumen.']
    ]
  },
  {
    key: 'software',
    label: 'coding / software',
    re: /\b(coding|ngoding|pemrograman|programmer|software|developer|backend|frontend|web\s+developer|mobile\s+developer|app\s+developer|aplikasi|bikin\s+aplikasi|membuat\s+aplikasi)\b/i,
    candidates: [
      ['ti', 'primary', 'Paling dekat karena TI kuat di coding, software, aplikasi, frontend/backend, cloud, jaringan, dan keamanan.'],
      ['si', 'alternative', 'Cocok kalau coding ingin digabung dengan analisis kebutuhan bisnis, sistem perusahaan, dan basis data.'],
      ['mi', 'practical', 'Bisa jadi jalur praktis untuk aplikasi, web developer junior, pengolahan data, dan dukungan sistem.']
    ]
  },
  {
    key: 'business',
    label: 'bisnis digital / marketing',
    re: /\b(bisnis|marketing|marketer|digital\s+marketer|pemasaran|jualan|e-commerce|marketplace|wirausaha|entrepreneur|konten|sosmed|social\s+media|analisis\s+pasar|riset\s+pasar|iklan|campaign|kampanye|brand\s+strategy)\b/i,
    candidates: [
      ['bd', 'primary', 'Paling dekat karena BD kuat di digital marketing, e-commerce, produk digital, branding, analisis pasar, dan bisnis digital.'],
      ['si', 'alternative', 'Cocok kalau ingin masuk ke sistem bisnis, CRM, dashboard, data operasional, atau solusi digital perusahaan.'],
      ['utb', 'alternative', 'Bisa dipertimbangkan kalau minat bisnis digitalnya kuat di sisi visual branding, desain komunikasi, atau konten kreatif.']
    ]
  },
  {
    key: 'hardware',
    label: 'hardware / IoT / jaringan',
    re: /\b(hardware|perangkat\s+keras|iot|embedded|mikrokontroler|jaringan|network|robot|robotik|merakit|rakit\s+pc|komputer\s+rakitan|infrastruktur\s+jaringan)\b/i,
    candidates: [
      ['sk', 'primary', 'Paling dekat karena SK kuat di hardware, IoT, embedded system, mikrokontroler, jaringan, dan integrasi perangkat.'],
      ['ti', 'alternative', 'Cocok kalau minatnya lebih ke jaringan, server, cloud, keamanan, atau pengelolaan layanan digital.']
    ]
  },
  {
    key: 'security',
    label: 'cyber security / keamanan sistem',
    re: /\b(cyber\s*security|cybersecurity|keamanan\s+siber|keamanan\s+sistem|security|ethical\s+hacking|pentest|penetration|forensik\s+digital)\b/i,
    candidates: [
      ['ti', 'primary', 'Paling dekat karena TI kuat di keamanan sistem, jaringan, infrastruktur IT, cloud, dan aplikasi.'],
      ['sk', 'alternative', 'Cocok kalau keamanan yang diminati dekat dengan jaringan, perangkat, embedded system, IoT, atau infrastruktur.'],
      ['si', 'supporting', 'Bisa mendukung dari sisi tata kelola sistem, risiko, proses bisnis, dan pengelolaan data.']
    ]
  },
  {
    key: 'uiux',
    label: 'UI/UX / produk digital',
    re: /\b(ui\/ux|uiux|user\s+interface|user\s+experience|ux|desain\s+aplikasi|desain\s+produk|produk\s+digital|product\s+manager|product\s+design|prototyping|prototype)\b/i,
    candidates: [
      ['bd', 'primary', 'Cocok kalau UI/UX dilihat dari sisi pengguna, produk, pasar, branding, dan strategi digital.'],
      ['ti', 'primary', 'Cocok kalau UI/UX ingin masuk ke implementasi teknis aplikasi, frontend, prototyping, dan produk digital.'],
      ['utb', 'alternative', 'Bisa dipertimbangkan kalau minat UI/UX sangat kuat di visual design atau DKV.'],
      ['si', 'alternative', 'Relevan kalau ingin menghubungkan kebutuhan user, proses bisnis, sistem, dan solusi digital.']
    ]
  },
  {
    key: 'game',
    label: 'game / produk digital interaktif',
    re: /\b(game|gaming|developer\s+game|game\s+developer|bikin\s+game|membuat\s+game|desain\s+game|game\s+design|unity|unreal|esport|e-sport|streaming)\b/i,
    candidates: [
      ['ti', 'primary', 'Paling dekat kalau ingin membuat game, aplikasi interaktif, software, atau teknologi digitalnya.'],
      ['bd', 'alternative', 'Cocok kalau fokusnya ke bisnis game, marketing, komunitas, monetisasi, konten, atau produk digital.'],
      ['utb', 'alternative', 'Bisa dipertimbangkan kalau minat game lebih kuat ke visual, ilustrasi, desain karakter, atau DKV.']
    ]
  },
  {
    key: 'introvert',
    label: 'gaya belajar lebih mandiri / introvert',
    re: /\b(introvert|pendiam|suka\s+kerja\s+sendiri|lebih\s+suka\s+sendiri|tidak\s+suka\s+presentasi|ga\s+suka\s+presentasi|gak\s+suka\s+presentasi|malu\s+ngomong)\b/i,
    candidates: [
      ['ti', 'primary', 'Bisa cocok untuk jalur teknis seperti coding, aplikasi, cloud, jaringan, dan keamanan yang banyak memberi ruang kerja fokus.'],
      ['si', 'alternative', 'Cocok kalau tetap ingin teknologi tetapi lebih banyak di analisis sistem, data, dan proses bisnis.'],
      ['sk', 'alternative', 'Cocok kalau suka eksplorasi perangkat, jaringan, IoT, atau hal teknis yang praktis.']
    ]
  },
  {
    key: 'extrovert',
    label: 'komunikasi / kerja dengan orang',
    re: /\b(ekstrovert|extrovert|suka\s+komunikasi|suka\s+ngobrol|suka\s+presentasi|suka\s+jualan|senang\s+ketemu\s+orang|kerja\s+tim|public\s+speaking)\b/i,
    candidates: [
      ['bd', 'primary', 'Cocok kalau kekuatan komunikasinya ingin dipakai untuk marketing, bisnis digital, branding, sales, atau e-commerce.'],
      ['si', 'alternative', 'Cocok kalau suka menjadi penghubung antara kebutuhan user/bisnis dan tim teknis.'],
      ['utb', 'alternative', 'Bisa dipertimbangkan kalau komunikasi dipadukan dengan visual branding atau desain komunikasi.']
    ]
  },
  {
    key: 'afraid_math',
    label: 'khawatir matematika',
    re: /\b(takut\s+matematika|takut\s+math|ga\s+bisa\s+matematika|gak\s+bisa\s+matematika|lemah\s+matematika|kurang\s+suka\s+matematika|tidak\s+suka\s+matematika)\b/i,
    candidates: [
      ['bd', 'primary', 'Bisa lebih nyaman kalau kakak lebih tertarik bisnis, marketing, konten, e-commerce, dan strategi digital.'],
      ['si', 'alternative', 'Masih bisa cocok kalau ingin teknologi dari sisi sistem, proses bisnis, dan data, dengan catatan tetap siap belajar dasar analisis.'],
      ['ti', 'alternative', 'Bisa dipilih kalau minat coding kuat, tetapi perlu siap bertemu logika dan pemecahan masalah teknis.']
    ]
  },
  {
    key: 'afraid_coding',
    label: 'khawatir coding',
    re: /\b(takut\s+coding|takut\s+ngoding|ga\s+bisa\s+coding|gak\s+bisa\s+coding|tidak\s+suka\s+coding|kurang\s+suka\s+coding|lemah\s+coding)\b/i,
    candidates: [
      ['bd', 'primary', 'Cocok kalau ingin dunia digital dari sisi bisnis, marketing, produk, e-commerce, dan branding.'],
      ['si', 'alternative', 'Bisa cocok kalau ingin memahami sistem dan kebutuhan bisnis, meski tetap perlu mengenal dasar teknologi.'],
      ['utb', 'alternative', 'Bisa dipertimbangkan kalau minatnya lebih visual seperti DKV, desain komunikasi, konten, atau branding.']
    ]
  }
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/+-]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function detectProgramFitSignals(question) {
  const q = normalizeText(question);
  if (!q) return [];
  const negativeCoding = /\b(takut|khawatir|tidak\s+suka|ga\s+suka|gak\s+suka|kurang\s+suka|lemah)\s+(?:coding|ngoding|pemrograman)\b/i.test(q);
  const negativeMath = /\b(takut|khawatir|tidak\s+suka|ga\s+suka|gak\s+suka|kurang\s+suka|lemah)\s+(?:matematika|math)\b/i.test(q);
  return SIGNALS.filter((signal) => {
    if (negativeCoding && signal.key === 'software') return false;
    if (negativeMath && signal.key === 'data') return false;
    return signal.re.test(q);
  });
}

function getProgramFitCandidates(question) {
  const signals = detectProgramFitSignals(question);
  const scores = new Map();

  for (const signal of signals) {
    signal.candidates.forEach(([programKey, level, reason], index) => {
      const base = level === 'primary' ? 4 : level === 'alternative' ? 2 : 1;
      const score = base + Math.max(0, 3 - index) * 0.1;
      if (!scores.has(programKey)) {
        scores.set(programKey, {
          program: PROGRAMS[programKey],
          score: 0,
          levels: [],
          reasons: [],
          signals: []
        });
      }
      const entry = scores.get(programKey);
      entry.score += score;
      entry.levels.push(level);
      entry.reasons.push(reason);
      entry.signals.push(signal.label);
    });
  }

  return Array.from(scores.values())
    .filter((entry) => entry.program)
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({
      ...entry,
      confidence: entry.score >= 4 ? 'HIGH' : entry.score >= 2 ? 'MEDIUM' : 'LOW',
      signals: Array.from(new Set(entry.signals)),
      levels: Array.from(new Set(entry.levels)),
      reasons: Array.from(new Set(entry.reasons))
    }));
}

function buildProgramFitAnswer(question, options = {}) {
  const candidates = getProgramFitCandidates(question);
  if (!candidates.length) return null;

  const maxCandidates = Number.isFinite(options.maxCandidates) ? options.maxCandidates : 3;
  const selected = candidates.slice(0, Math.max(1, maxCandidates));
  const signalText = Array.from(new Set(selected.flatMap((item) => item.signals))).join(', ');
  const lines = [
    `Dari cerita kakak, saya menangkap arah minatnya ke ${signalText}.`,
    '',
    'Rekomendasi awal yang paling relevan:'
  ];

  selected.forEach((item, index) => {
    const program = item.program;
    lines.push(`${index + 1}. ${program.label}`);
    lines.push(`   ${item.reasons[0]}`);
    lines.push(`   Dasar data: ${program.grounding}.`);
  });

  lines.push('');
  lines.push('Catatan: ini rekomendasi awal berbasis kecocokan minat/tujuan, bukan keputusan mutlak. Untuk biaya, jadwal, syarat, dan detail resmi lain, bot tetap harus mengambil dari data yang tersedia dan tidak menebak.');

  return {
    answer: lines.join('\n'),
    candidates: selected,
    source: 'program-fit-reasoning'
  };
}

module.exports = {
  PROGRAMS,
  SIGNALS,
  detectProgramFitSignals,
  getProgramFitCandidates,
  buildProgramFitAnswer
};
