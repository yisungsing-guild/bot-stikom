const ragEngine = require('./ragEngine');
const fs = require('fs');
const path = require('path');

function parseAmount(raw) {
  return ragEngine.parseCompactRupiahNumber(raw);
}

function formatRp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `Rp. ${Math.round(n).toLocaleString('id-ID')}`;
}

function formatRange(low, high) {
  const a = Number(low);
  const b = Number(high);
  if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
  if (!Number.isFinite(b) || a === b) return formatRp(a);
  return `${formatRp(a)} - ${formatRp(b)}`;
}

function normalizeWave(question) {
  const q = String(question || '').toLowerCase();
  const normalized = q
    .replace(/\bsatu\b/g, '1')
    .replace(/\bdua\b/g, '2')
    .replace(/\btiga\b/g, '3')
    .replace(/\bempat\b/g, '4')
    .replace(/\bpertama\b/g, '1')
    .replace(/\bkedua\b/g, '2')
    .replace(/\bketiga\b/g, '3')
    .replace(/\bkeempat\b/g, '4');
  const m = normalized.match(/\b(?:gel(?:ombang)?\.?\s*)?((?:khusus)|(?:[1-4]|i{1,3}|iv))\s*([a-c])?\b/i);
  if (!m) return null;
  const raw = String(m[1] || '').toLowerCase();
  const sub = String(m[2] || '').toUpperCase();
  const groupMap = {
    khusus: 'Khusus',
    '1': 'I',
    i: 'I',
    '2': 'II',
    ii: 'II',
    '3': 'III',
    iii: 'III',
    '4': 'IV',
    iv: 'IV'
  };
  const group = groupMap[raw] || null;
  if (!group) return null;
  return {
    group,
    suffix: sub || '',
    label: sub ? `${group} ${sub}` : group,
    display: group === 'Khusus' ? 'Gelombang Khusus' : `Gelombang ${group}${sub ? ` ${sub}` : ''}`
  };
}

function detectProgram(question) {
  const q = String(question || '').toLowerCase();
  if (/\b(dnui|dalian\s+neusoft)\b/.test(q)) return { key: 'dnui', label: 'Double Degree DNUI', family: 'international' };
  if (/\b(help\s+university|help\b.*malaysia|biaya\s+pendaftaran\s+help\b|pendaftaran\s+help\b|help)\b/.test(q)) return { key: 'help', label: 'Double Degree HELP University', family: 'international' };
  if (/\b(utb|universitas\s+teknologi\s+bandung)\b/.test(q)) return { key: 'utb', label: 'Double Degree UTB', family: 'utb' };
  if (/\b(s2|pascasarjana|magister|master)\b/.test(q)) return { key: 's2', label: 'S2 Sistem Informasi', family: 's2' };
  if (/\bsistem\s+komputer\b/.test(q)) return { key: 'sk', label: 'Sistem Komputer', family: 'sk' };
  if (/\bsistem\s+(?:informasi|infomrasi|infromasi)\b/.test(q)) return { key: 'si', label: 'Sistem Informasi', family: 's1' };
  if (/\b(?:teknologi\s+informasi|teknik\s+informatika|tek\s*info|tekinfo)\b/.test(q)) return { key: 'ti', label: 'Teknologi Informasi', family: 's1' };
  if (/\b(?:bisnis|binis|bisinis)\s+digital\b/.test(q)) return { key: 'bd', label: 'Bisnis Digital', family: 's1' };
  if (/\bmanajemen\s+informatika\b/.test(q)) return { key: 'mi', label: 'Manajemen Informatika', family: 'd3' };
  if (/\bti\b/.test(q)) return { key: 'ti', label: 'Teknologi Informasi', family: 's1' };
  if (/\bbd\b/.test(q)) return { key: 'bd', label: 'Bisnis Digital', family: 's1' };
  if (/\bsk\b/.test(q)) return { key: 'sk', label: 'Sistem Komputer', family: 'sk' };
  if (/\bmi\b/.test(q)) return { key: 'mi', label: 'Manajemen Informatika', family: 'd3' };
  if (/\bsi\b(?!\s+sistem)\b/.test(q)) return { key: 'si', label: 'Sistem Informasi', family: 's1' };
  return null;
}

const WAVE_DISCOUNTS = {
  s1: {
    pendaftaran: { Khusus: 300000, I: 250000, II: 200000, III: 150000, IV: 100000 },
    dppNominal: { Khusus: 3000000, I: 2000000, II: 1500000, III: 1000000, IV: 500000 },
    dppPercent: { Khusus: 0.6, I: 0.5, II: 0.4, III: 0.3, IV: 0.2 }
  },
  sk: {
    pendaftaran: { Khusus: 300000, I: 250000, II: 200000, III: 150000, IV: 100000 },
    dppNominal: { Khusus: 2000000, I: 1000000, II: 750000, III: 0, IV: 0 },
    dppPercent: { Khusus: 0.6, I: 0.5, II: 0.4, III: 0.3, IV: 0.2 }
  },
  d3: {
    pendaftaran: { Khusus: 300000, I: 250000, II: 200000, III: 150000, IV: 100000 },
    dppNominal: { Khusus: 2000000, I: 1000000, II: 750000, III: 500000, IV: 0 },
    dppPercent: { Khusus: 0.6, I: 0.5, II: 0.4, III: 0.3, IV: 0.2 }
  },
  international: {
    pendaftaran: { Khusus: 1500000, I: 1250000, II: 1000000, III: 750000, IV: 500000 },
    dppNominal: { Khusus: 10000000, I: 8000000, II: 6000000, III: 4000000, IV: 2000000 },
    dppPercent: {}
  },
  utb: {
    pendaftaran: { Khusus: 300000, I: 250000, II: 200000, III: 150000, IV: 100000 },
    dppNominal: { Khusus: 3000000, I: 2000000, II: 1500000, III: 1000000, IV: 500000 },
    dppPercent: {}
  },
  s2: {
    pendaftaran: { Khusus: 0, I: 200000, II: 100000, III: 0, IV: 0 },
    dppNominal: {},
    dppPercent: {}
  }
};

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n * 100)}%`;
}

function calculateDppDiscount(dpp, discounts, waveGroup) {
  const base = Number(dpp) || 0;
  const nominal = (discounts.dppNominal && discounts.dppNominal[waveGroup]) || 0;
  const percent = (discounts.dppPercent && discounts.dppPercent[waveGroup]) || 0;
  const percentAmount = Math.round(base * percent);
  const total = Math.min(base, nominal);
  return {
    nominal,
    percent,
    percentAmount,
    total,
    note: ''
  };
}

function feeProfileByProgram(question, index = ragEngine.loadIndex()) {
  const program = detectProgram(question);
  if (!program) return null;
  const profiles = extractProfiles(index);
  return {
    program,
    profile: profiles.find((p) => p.key === program.key) || null
  };
}

function detectMentionedPrograms(question) {
  const q = String(question || '').toLowerCase();
  const specs = [
    { key: 'dnui', label: 'Double Degree DNUI', re: /\b(dnui|dalian\s+neusoft)\b/ },
    { key: 'help', label: 'Double Degree HELP University', re: /\b(help\s+university|help\b.*malaysia|biaya\s+pendaftaran\s+help\b|pendaftaran\s+help\b|help)\b/ },
    { key: 'utb', label: 'Double Degree UTB', re: /\b(utb|universitas\s+teknologi\s+bandung)\b/ },
    { key: 's2', label: 'S2 Sistem Informasi', re: /\b(s2|pascasarjana|magister|master)\b/ },
    { key: 'si', label: 'Sistem Informasi', re: /\b(sistem\s+informasi|sistem\s+infomrasi|sistem\s+infromasi|si\b(?!\s+sistem))\b/ },
    { key: 'ti', label: 'Teknologi Informasi', re: /\b(ti|teknologi\s+informasi|teknik\s+informatika|tek\s*info|tekinfo)\b/ },
    { key: 'bd', label: 'Bisnis Digital', re: /\b(bd|(?:bisnis|binis|bisinis)\s+digital)\b/ },
    { key: 'sk', label: 'Sistem Komputer', re: /\b(sk|sistem\s+komputer)\b/ },
    { key: 'mi', label: 'Manajemen Informatika', re: /\b(mi|manajemen\s+informatika)\b/ }
  ];
  return specs.filter((spec) => spec.re.test(q));
}

function detectProgramsFromHint(value) {
  const text = String(value || '');
  if (!text.trim()) return [];
  return detectMentionedPrograms(text);
}

function detectProgramsFromSessionData(sessionData) {
  if (!sessionData || typeof sessionData !== 'object') return [];
  const texts = [];
  const messages = Array.isArray(sessionData.messages) ? sessionData.messages : [];
  for (const msg of messages.slice(-8)) {
    const value = msg && (msg.message || msg.text || msg.content || msg.body);
    if (value) texts.push(String(value));
  }
  for (const key of ['lastUserMessage', 'lastBotMessage', 'lastQuestion', 'lastAnswer', 'previousQuestion']) {
    if (sessionData[key]) texts.push(String(sessionData[key]));
  }
  const seen = new Set();
  const out = [];
  for (const found of detectMentionedPrograms(texts.join('\n'))) {
    if (seen.has(found.key)) continue;
    seen.add(found.key);
    out.push(found);
  }
  return out;
}

const PROGRAM_DOMAIN_FILES = {
  si: 'program_studi_sistem_informasi.md',
  ti: 'program_studi_teknologi_informasi.md',
  sk: 'program_studi_sistem_komputer.md',
  bd: 'program_studi_bisnis_digital.md'
};

const MI_DOMAIN_FALLBACK = {
  title: 'Program Studi Manajemen Informatika',
  ringkasan: 'Program Studi Manajemen Informatika adalah program D3 yang berfokus pada penerapan teknologi informasi untuk kebutuhan operasional, pengolahan data, pengembangan aplikasi, dan administrasi sistem informasi. Program ini lebih praktis dan terapan, sehingga cocok untuk calon mahasiswa yang ingin cepat menguasai skill kerja di bidang IT.',
  prospek: 'Prospek kerja Manajemen Informatika mencakup programmer junior, web developer junior, IT support, database/admin data, operator sistem informasi, technical support, dan staf pengelola aplikasi pada perusahaan, instansi, sekolah, kampus, maupun unit bisnis digital.'
};

function readProgramDomain(programKey) {
  if (programKey === 'mi') return MI_DOMAIN_FALLBACK;
  const filename = PROGRAM_DOMAIN_FILES[programKey];
  if (!filename) return null;
  const filePath = path.resolve(__dirname, '..', '..', 'docs', 'retrieval', 'knowledge_domains', filename);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return {
      title: raw.split(/\r?\n/).find((line) => line.trim()) || '',
      ringkasan: extractMdSection(raw, 'Ringkasan Program'),
      prospek: extractMdSection(raw, 'Prospek Kerja')
    };
  } catch (err) {
    return null;
  }
}

function extractMdSection(markdown, heading) {
  const text = String(markdown || '');
  const re = new RegExp(`^##\\s+${heading}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s+|$)`, 'im');
  const match = text.match(re);
  return match ? match[1].replace(/\r/g, '').trim() : '';
}

function cleanProgramSummary(summary, programLabel) {
  return String(summary || '')
    .replace(new RegExp(`^Program\\s+Studi\\s+${programLabel}\\s+`, 'i'), '')
    .replace(/^Program\s+Studi\s+/i, '')
    .replace(/^adalah\s+/i, '')
    .replace(/\.$/, '')
    .trim();
}

function tryProgramDefinitionAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(apa\s+itu|itu\s+apa|apaan|maksudnya|jelaskan|tentang|pengertian|belajar\s+apa|ngulik\s+apa|arahnya\s+(?:ke)?mana|kemana|tuh|sebenernya|sebenarnya)\b/.test(q)) return null;
  const program = detectProgram(question);
  if (!program) return null;
  const domain = readProgramDomain(program.key);
  if (!domain || !domain.ringkasan) return null;
  const summary = cleanProgramSummary(domain.ringkasan, program.label);
  const definition = /^program\s+/i.test(summary)
    ? `${program.label} adalah ${summary}.`
    : `${program.label} adalah program studi yang ${summary}.`;
  return {
    answer: [
      definition,
      '',
      `Singkatnya, prodi ini cocok untuk kakak yang tertarik pada ${program.key === 'si' ? 'analisis kebutuhan, proses bisnis, data, dan solusi sistem informasi' : program.key === 'ti' ? 'coding, aplikasi, jaringan, cloud, keamanan, dan pengelolaan layanan digital' : program.key === 'sk' ? 'hardware, embedded system, IoT, jaringan, dan integrasi perangkat' : program.key === 'bd' ? 'bisnis, digital marketing, e-commerce, data analytics, dan kewirausahaan digital' : 'pemrograman terapan, pengolahan data, aplikasi, dan dukungan sistem informasi'}.`
    ].join('\n')
  };
}

function tryProgramComparisonAnswer(question) {
  const q = String(question || '').toLowerCase();
  const asksDifference = /\b(beda|bedanya|bedain|perbedaan|bandingkan|perbandingan|apa\s+yang\s+membedakan|mana\s+bedanya|bingung\s+pilih)\b/.test(q);
  if (!asksDifference) return null;
  if (/\b(biaya|harga|tarif|ongkos|bayar|uang|dpp|ukt|semester|pendaftaran|termurah|termahal|murah|mahal|hemat)\b/.test(q)) return null;
  const mentioned = detectMentionedPrograms(question);
  const keys = new Set(mentioned.map((p) => p.key));
  if (mentioned.length < 2) return null;
  const displayOrder = ['si', 'sk', 'ti', 'bd', 'mi'];
  const orderedMentioned = displayOrder
    .filter((key) => keys.has(key))
    .map((key) => mentioned.find((p) => p.key === key))
    .filter(Boolean);

  const lines = [
    `Program S1 ${orderedMentioned.map((p) => p.label).join(', ')} memiliki fokus yang berbeda. Berikut penjelasan singkat tiap prodi dan perbedaannya:`,
    ''
  ];

  let number = 1;

  if (keys.has('si')) {
    lines.push(`${number}) Sistem Informasi (SI)`);
    lines.push('SI adalah prodi yang mempelajari bagaimana teknologi digunakan untuk membantu kebutuhan organisasi atau perusahaan. Fokusnya ada pada perancangan dan pengelolaan sistem informasi, analisis kebutuhan bisnis, basis data, proses organisasi, dashboard, dan solusi digital.');
    lines.push('Arah kariernya dekat dengan Business Analyst, System Analyst, Data Analyst, IT Consultant, Project Manager, atau pengelola sistem informasi perusahaan.');
    lines.push('');
    number += 1;
  }

  if (keys.has('sk')) {
    lines.push(`${number}) Sistem Komputer (SK)`);
    lines.push('SK adalah prodi yang mempelajari hubungan antara perangkat keras dan perangkat lunak. Fokusnya lebih dekat ke hardware, arsitektur komputer, embedded system, Internet of Things (IoT), jaringan, mikrokontroler, robotika, dan integrasi perangkat.');
    lines.push('Arah kariernya dekat dengan IoT Engineer, Embedded Engineer, Hardware Engineer, Network Engineer, atau bidang infrastruktur/perangkat.');
    lines.push('');
    number += 1;
  }

  if (keys.has('ti')) {
    lines.push(`${number}) Teknologi Informasi (TI)`);
    lines.push('TI adalah prodi yang mempelajari penerapan teknologi untuk membangun, mengelola, dan mengamankan sistem digital. Fokusnya lebih kuat pada software, pemrograman, pengembangan aplikasi, infrastruktur IT, cloud, keamanan siber, jaringan, dan pengolahan data.');
    lines.push('Arah kariernya dekat dengan Software Developer, Web/App Developer, DevOps, Cybersecurity Specialist, Network Engineer, Data Engineer, atau pengembang layanan digital.');
    lines.push('');
    number += 1;
  }

  if (keys.has('bd')) {
    lines.push(`${number}) Bisnis Digital (BD)`);
    lines.push('BD adalah prodi yang mempelajari pengembangan bisnis berbasis teknologi digital. Fokusnya ada pada digital marketing, e-commerce, strategi produk digital, analisis pasar, branding, dan kewirausahaan digital.');
    lines.push('Arah kariernya dekat dengan Digital Marketer, E-commerce Specialist, Product Manager, Business Development, atau wirausaha digital.');
    lines.push('');
    number += 1;
  }

  if (keys.has('mi')) {
    lines.push(`${number}) Manajemen Informatika (MI)`);
    lines.push('MI adalah prodi D3 yang lebih praktis dan terapan. Fokusnya pada pengolahan data, aplikasi bisnis, administrasi sistem, dan dukungan operasional teknologi informasi.');
    lines.push('Arah kariernya dekat dengan IT Support, Programmer Junior, Admin Data, Technical Support, atau operator sistem informasi.');
    lines.push('');
    number += 1;
  }

  const summaryParts = [];
  if (keys.has('si')) summaryParts.push('SI lebih ke sistem informasi, data, dan proses bisnis');
  if (keys.has('sk')) summaryParts.push('SK lebih ke perangkat, jaringan, embedded system, dan IoT');
  if (keys.has('ti')) summaryParts.push('TI lebih ke software, aplikasi, infrastruktur IT, dan keamanan teknologi');
  if (keys.has('bd')) summaryParts.push('BD lebih ke bisnis digital, marketing, e-commerce, dan strategi pasar');
  if (keys.has('mi')) summaryParts.push('MI lebih ke praktik operasional IT, aplikasi bisnis, dan dukungan sistem');

  lines.push(`Jadi, perbedaan utamanya: ${summaryParts.join('; ')}.`);
  return { answer: lines.join('\n') };
}

function tryProgramListAnswer(question) {
  const q = String(question || '').toLowerCase();
  const asksProgramList = /\b(jurusan|prodi|program\s+studi|program\s+kuliah|pilihan\s+jurusan|daftar\s+jurusan|fakultas)\b/.test(q);
  const asksAvailable = /\b(apa\s+saja|apa\s+aja|ada\s+apa|tersedia|yang\s+ada|di\s+stikom|stikom)\b/.test(q);
  const recommendationIntent = /\b(sebaiknya|cocok|cocoknya|sesuai|rekomendasi|saran|sarankan|pilih|mengambil|ambil|ingin|mau|pengen|bekerja|kerja|karir|karier|minat|hobi)\b/.test(q);
  if (recommendationIntent) return null;
  if (!asksProgramList || !asksAvailable) return null;

  return {
    answer: [
      'S2 (Pascasarjana):',
      '',
      '- S2 Sistem Informasi (SI)',
      '',
      'S1 (Sarjana):',
      '',
      '- Sistem Informasi',
      '- Teknologi Informasi',
      '- Bisnis Digital',
      '- Sistem Komputer',
      '',
      'D3 (Diploma):',
      '',
      '- D3 Manajemen Informatika',
      '',
      'Double Degree:',
      '',
      '- Dual Degree (National Class) dengan Universitas Teknologi Bandung (UTB) - Prodi STIKOM Bali: Bisnis Digital; di UTB: DKV (Desain Komunikasi Visual)',
      '- Dual Degree (International Class) dengan Dalian Neusoft University of Information (DNUI), China - Prodi STIKOM Bali: Bisnis Digital; jurusan di DNUI belum tercantum pada data yang tersedia',
      '- Dual Degree (International Class) dengan HELP University, Malaysia - Prodi STIKOM Bali: Sistem Informasi; jurusan di HELP belum tercantum pada data yang tersedia'
    ].join('\n')
  };
}

const CAREER_PROFILES = [
  {
    key: 'data',
    label: 'data analyst / analisis data',
    re: /\b(mengolah\s+data|olah\s+data|analisis\s+data|menganalisa\s+data|menganalisis\s+data|data\s+analyst|data\s+analis|business\s+intelligence|bi\b|dashboard|basis\s+data|database|sql|analytics|analitik)\b/,
    primary: 'si',
    alternative: ['ti', 'bd', 'mi'],
    fit: {
      si: { level: 'utama', text: 'Sistem Informasi paling cocok karena dekat dengan basis data, dashboard, business intelligence, analisis proses bisnis, dan kebutuhan data perusahaan.' },
      ti: { level: 'alternatif teknis', text: 'Teknologi Informasi cocok kalau kakak ingin sisi data yang lebih teknis, seperti coding, backend, data engineering, integrasi sistem, atau aplikasi berbasis data.' },
      bd: { level: 'cocok untuk konteks bisnis', text: 'Bisnis Digital tetap cocok untuk data analyst yang arahnya bisnis, marketing, e-commerce, produk digital, riset pasar, dan analisis perilaku konsumen.' },
      sk: { level: 'bukan jalur utama', text: 'Sistem Komputer bukan jalur utama untuk data analyst umum. SK lebih kuat ke hardware, jaringan, IoT, embedded system, dan integrasi perangkat.' },
      mi: { level: 'cocok untuk dasar praktis', text: 'Manajemen Informatika bisa menjadi dasar praktis untuk pengolahan data, aplikasi bisnis, admin data, dan operasional sistem informasi.' }
    }
  },
  {
    key: 'software',
    label: 'programmer / software developer',
    re: /\b(coding|ngoding|pemrograman|programmer|software|developer|backend|frontend|web\s+developer|app\s+developer|mobile\s+developer|aplikasi|membuat\s+aplikasi|bikin\s+aplikasi)\b/,
    primary: 'ti',
    alternative: ['si', 'mi'],
    fit: {
      ti: { level: 'utama', text: 'Teknologi Informasi paling cocok karena fokusnya lebih dekat ke coding, pengembangan aplikasi, software, backend/frontend, infrastruktur IT, cloud, dan keamanan.' },
      si: { level: 'alternatif', text: 'Sistem Informasi tetap bisa cocok kalau kakak ingin menggabungkan coding dengan analisis kebutuhan bisnis, sistem perusahaan, basis data, dan solusi digital organisasi.' },
      mi: { level: 'alternatif praktis', text: 'Manajemen Informatika bisa cocok untuk jalur praktis seperti programmer junior, web developer junior, pengolahan data, dan dukungan aplikasi.' },
      sk: { level: 'cocok untuk software-perangkat', text: 'Sistem Komputer cocok kalau coding yang kakak minati berhubungan dengan hardware, IoT, embedded system, mikrokontroler, jaringan, atau integrasi perangkat.' },
      bd: { level: 'bukan jalur utama', text: 'Bisnis Digital bukan jalur utama untuk programmer murni. BD lebih kuat ke bisnis digital, marketing, e-commerce, produk digital, dan kewirausahaan.' }
    }
  },
  {
    key: 'business',
    label: 'digital marketing / bisnis digital',
    re: /\b(bisnis|marketing|marketer|digital\s+marketer|pemasaran|jualan|e-commerce|marketplace|wirausaha|entrepreneur|konten|sosmed|social\s+media|analisis\s+pasar|riset\s+pasar|branding|iklan|campaign|kampanye)\b/,
    primary: 'bd',
    alternative: ['si'],
    fit: {
      bd: { level: 'utama', text: 'Bisnis Digital paling cocok karena dekat dengan digital marketing, e-commerce, strategi produk digital, analisis pasar, branding, dan pengembangan bisnis.' },
      si: { level: 'alternatif', text: 'Sistem Informasi bisa menjadi alternatif kalau kakak ingin masuk ke sisi sistem bisnis, data operasional, dashboard, CRM, atau solusi digital untuk perusahaan.' },
      ti: { level: 'pendukung teknis', text: 'Teknologi Informasi bisa mendukung kalau kakak ingin membangun platform, aplikasi, website, atau infrastruktur teknis untuk bisnis digital.' },
      sk: { level: 'bukan jalur utama', text: 'Sistem Komputer bukan jalur utama untuk digital marketing. SK lebih kuat ke hardware, jaringan, IoT, dan sistem perangkat.' },
      mi: { level: 'pendukung operasional', text: 'Manajemen Informatika bisa mendukung pekerjaan operasional digital, pengolahan data, aplikasi bisnis, dan administrasi sistem.' }
    }
  },
  {
    key: 'hardware',
    label: 'IoT / jaringan / hardware',
    re: /\b(hardware|perangkat\s+keras|iot|embedded|mikrokontroler|jaringan|network|robot|robotik|merakit|rakit\s+pc|komputer\s+rakitan|infrastruktur\s+jaringan)\b/,
    primary: 'sk',
    alternative: ['ti'],
    fit: {
      sk: { level: 'utama', text: 'Sistem Komputer paling cocok karena fokusnya dekat dengan hardware, IoT, embedded system, mikrokontroler, jaringan, robotika, dan integrasi perangkat.' },
      ti: { level: 'alternatif teknis', text: 'Teknologi Informasi bisa cocok kalau kakak lebih tertarik ke jaringan, server, infrastruktur IT, cloud, keamanan, atau pengelolaan layanan digital.' },
      si: { level: 'bukan jalur utama', text: 'Sistem Informasi bukan jalur utama untuk hardware atau IoT. SI lebih kuat ke sistem informasi, data, proses bisnis, dan solusi digital organisasi.' },
      bd: { level: 'bukan jalur utama', text: 'Bisnis Digital bukan jalur utama untuk hardware, jaringan, atau IoT. BD lebih kuat ke bisnis, marketing, e-commerce, dan produk digital.' },
      mi: { level: 'pendukung operasional', text: 'Manajemen Informatika bisa mendukung dari sisi operasional IT, aplikasi, dan dukungan sistem, tetapi bukan jalur utama untuk hardware.' }
    }
  },
  {
    key: 'security',
    label: 'cyber security / keamanan sistem',
    re: /\b(cyber\s*security|cybersecurity|keamanan\s+siber|keamanan\s+sistem|security|hacker|ethical\s+hacking|penetration|pentest|forensik\s+digital)\b/,
    primary: 'ti',
    alternative: ['sk'],
    fit: {
      ti: { level: 'utama', text: 'Teknologi Informasi paling cocok karena dekat dengan keamanan sistem, jaringan, infrastruktur IT, server, cloud, aplikasi, dan pengelolaan layanan digital.' },
      sk: { level: 'alternatif teknis', text: 'Sistem Komputer bisa cocok kalau fokus keamanan yang kakak minati dekat dengan jaringan, perangkat, embedded system, IoT, atau infrastruktur.' },
      si: { level: 'pendukung', text: 'Sistem Informasi bisa mendukung dari sisi tata kelola sistem, analisis kebutuhan, risiko, proses bisnis, dan pengelolaan data, tetapi bukan jalur teknis utama keamanan siber.' },
      bd: { level: 'bukan jalur utama', text: 'Bisnis Digital bukan jalur utama untuk cyber security. BD lebih kuat ke bisnis digital, marketing, e-commerce, produk digital, dan analisis pasar.' },
      mi: { level: 'dasar operasional', text: 'Manajemen Informatika bisa memberi dasar operasional IT, tetapi untuk cyber security yang lebih teknis biasanya TI lebih tepat.' }
    }
  },
  {
    key: 'uiux',
    label: 'UI/UX / produk digital',
    re: /\b(ui\/ux|uiux|user\s+interface|user\s+experience|ux|desain\s+aplikasi|desain\s+produk|produk\s+digital|product\s+manager|product\s+design)\b/,
    primary: 'bd',
    alternative: ['ti', 'si'],
    fit: {
      bd: { level: 'utama untuk produk/bisnis', text: 'Bisnis Digital cocok kalau kakak ingin UI/UX atau produk digital dari sisi kebutuhan pasar, produk, pengguna, bisnis, branding, dan strategi digital.' },
      ti: { level: 'utama untuk implementasi teknis', text: 'Teknologi Informasi cocok kalau kakak ingin masuk ke implementasi teknis aplikasi, frontend, prototyping, dan pengembangan produk digital.' },
      si: { level: 'alternatif', text: 'Sistem Informasi bisa cocok kalau kakak ingin menghubungkan kebutuhan pengguna, proses bisnis, sistem, dan solusi digital.' },
      sk: { level: 'bukan jalur utama', text: 'Sistem Komputer bukan jalur utama untuk UI/UX. SK lebih kuat ke hardware, jaringan, IoT, dan embedded system.' },
      mi: { level: 'pendukung praktis', text: 'Manajemen Informatika bisa mendukung dari sisi aplikasi praktis dan sistem informasi, tetapi bukan pilihan utama untuk UI/UX.' }
    }
  }
];

function detectCareerProfile(question) {
  const q = String(question || '').toLowerCase();
  return CAREER_PROFILES.find((profile) => profile.re.test(q)) || null;
}

function formatProgramCareerFitAnswer(program, career) {
  if (!program || !career) return null;
  const fit = career.fit[program.key];
  if (!fit) return null;
  const programLabels = { si: 'Sistem Informasi (SI)', ti: 'Teknologi Informasi (TI)', bd: 'Bisnis Digital (BD)', sk: 'Sistem Komputer (SK)', mi: 'Manajemen Informatika (MI)' };
  const primaryFit = career.fit[career.primary];
  const primaryLabel = programLabels[career.primary] || '';
  const alternativeLabels = (career.alternative || [])
    .filter((key) => key !== program.key)
    .map((key) => programLabels[key])
    .filter(Boolean);
  const lead = program.label + ' ' + (fit.level === 'bukan jalur utama' ? 'kurang cocok sebagai jalur utama' : 'bisa cocok') + ' untuk arah ' + career.label + ', dengan catatan konteksnya perlu tepat.';
  const lines = [lead, '', fit.text];
  if (program.key !== career.primary && primaryLabel && primaryFit) {
    lines.push('');
    lines.push('Kalau kakak ingin jalur yang paling langsung untuk ' + career.label + ', pilihan utamanya biasanya ' + primaryLabel + '. ' + primaryFit.text);
  }
  if (alternativeLabels.length) {
    lines.push('');
    lines.push('Alternatif yang juga bisa dipertimbangkan: ' + alternativeLabels.join(', ') + '.');
  }
  lines.push('');
  lines.push('Jadi, jawabannya bukan sekadar cocok atau tidak cocok. ' + program.label + ' ' + (fit.level === 'bukan jalur utama' ? 'masih bisa mendukung, tetapi bukan pilihan utama' : 'bisa dipilih') + ' kalau arah yang kakak incar sesuai dengan fokus prodi tersebut.');
  return { answer: lines.join('\n') };
}

function tryProgramRecommendationAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!q.trim()) return null;

  const asksRecommendation = /\b(sebaiknya|cocok|cocoknya|sesuai|rekomendasi|saran|sarankan|pilih|mengambil|ambil|jurusan\s+yang\s+mana|prodi\s+yang\s+mana|program\s+yang\s+mana|masuk\s+jurusan\s+apa|ambil\s+jurusan\s+apa)\b/.test(q);
  const hasCareerGoal = /\b(ingin|mau|pengen|nanti|kerja|bekerja|karir|karier|perusahaan|menjadi|jadi|minat|hobi|hobby|suka|senang)\b/.test(q);
  const asksMajor = /\b(jurusan|prodi|program\s+studi|kuliah)\b/.test(q);

  const dataInterest = /\b(mengolah\s+data|olah\s+data|analisis\s+data|menganalisa\s+data|menganalisis\s+data|data\s+analyst|data\s+analis|business\s+intelligence|bi\b|dashboard|basis\s+data|database|sql|analytics|analitik)\b/.test(q);
  const codingInterest = /\b(coding|ngoding|pemrograman|programmer|software|developer|aplikasi|backend|frontend|data\s+engineer|data\s+engineering)\b/.test(q);
  const businessInterest = /\b(bisnis|marketing|marketer|digital\s+marketer|pemasaran|jualan|e-commerce|marketplace|wirausaha|entrepreneur|konten|sosmed|social\s+media|analisis\s+pasar|riset\s+pasar)\b/.test(q);
  const hardwareInterest = /\b(hardware|perangkat\s+keras|iot|embedded|mikrokontroler|jaringan|network|robot|merakit|rakit\s+pc|komputer\s+rakitan)\b/.test(q);
  const hasStrongInterestSignal = dataInterest || codingInterest || businessInterest || hardwareInterest;
  const mentionedPrograms = detectMentionedPrograms(question);
  const asksProgramOutcome = mentionedPrograms.length === 1
    && /\b(cocoknya|nantinya|lulusannya?|jurusan|prodi|program\s+studi)\b/.test(q)
    && /\b(jadi\s+apa|kerja\s+apa|kerjanya\s+apa|pekerjaan\s+apa|profesi\s+apa|prospek|karir|karier|peluang)\b/.test(q);
  if (asksProgramOutcome) {
    const careerAnswer = tryCareerAnswer(question);
    return careerAnswer ? { ...careerAnswer, frameSource: 'semantic-rag-career' } : null;
  }

  const careerProfile = detectCareerProfile(question);
  const asksSuitability = /\b(cocok|sesuai|bisa|bs|boleh|tidak\s+cocok|nggak\s+cocok|ga\s+cocok|gak\s+cocok|kurang\s+cocok|ambil|mengambil|pilih)\b/.test(q);
  if (careerProfile && mentionedPrograms.length === 1 && asksSuitability) {
    return formatProgramCareerFitAnswer(mentionedPrograms[0], careerProfile);
  }

  if (!asksRecommendation && !(hasCareerGoal && (asksMajor || hasStrongInterestSignal || careerProfile))) return null;

  if (dataInterest) {
    return {
      answer: [
        'Pilihan utama yang paling cocok adalah Sistem Informasi (SI).',
        '',
        'Alasannya, SI paling dekat dengan pekerjaan mengolah dan menganalisis data untuk kebutuhan perusahaan: analisis proses bisnis, basis data, sistem informasi, dashboard, business intelligence, dan penerjemahan kebutuhan organisasi menjadi solusi digital.',
        '',
        'Arah kerja yang relevan untuk target itu antara lain Data Analyst, Business Analyst, System Analyst, Database/Admin Data, IT Consultant, atau role yang menghubungkan data, proses bisnis, dan sistem perusahaan.',
        '',
        'Teknologi Informasi (TI) juga bisa dipertimbangkan kalau kakak ingin masuk ke sisi yang lebih teknis, seperti coding, backend, data engineering, pengembangan aplikasi data, atau integrasi sistem. Sistem Komputer (SK) lebih cocok kalau minat utamanya hardware, IoT, embedded system, jaringan, atau perangkat.',
        '',
        'Jadi untuk target bekerja di perusahaan yang mengolah dan menganalisis data, rekomendasi saya: Sistem Informasi (SI) sebagai pilihan pertama, lalu Teknologi Informasi (TI) sebagai alternatif kalau kakak lebih suka jalur teknis/programming.'
      ].join('\n')
    };
  }

  if (codingInterest) {
    return {
      answer: [
        'Pilihan utama yang paling cocok adalah Teknologi Informasi (TI).',
        '',
        'TI lebih dekat dengan pengembangan aplikasi, pemrograman, software, backend/frontend, infrastruktur IT, cloud, keamanan, dan pekerjaan teknis digital.',
        '',
        'Sistem Informasi (SI) bisa jadi alternatif kalau kakak juga ingin menggabungkan coding dengan analisis kebutuhan bisnis, proses organisasi, dan pengelolaan data.'
      ].join('\n')
    };
  }

  if (businessInterest) {
    return {
      answer: [
        'Pilihan utama yang paling cocok adalah Bisnis Digital (BD).',
        '',
        'BD lebih dekat dengan bisnis berbasis teknologi, digital marketing, e-commerce, strategi produk digital, analisis pasar, dan pengembangan usaha digital.',
        '',
        'Sistem Informasi (SI) bisa jadi alternatif kalau kakak ingin lebih banyak masuk ke analisis proses bisnis, sistem perusahaan, dan data operasional.'
      ].join('\n')
    };
  }

  if (hardwareInterest) {
    return {
      answer: [
        'Pilihan utama yang paling cocok adalah Sistem Komputer (SK).',
        '',
        'SK lebih dekat dengan hardware, IoT, embedded system, jaringan, integrasi perangkat, dan sistem komputer yang menghubungkan perangkat keras dengan perangkat lunak.',
        '',
        'Teknologi Informasi (TI) bisa jadi alternatif kalau kakak lebih ingin fokus ke software, aplikasi, jaringan, cloud, atau keamanan sistem.'
      ].join('\n')
    };
  }

  return null;
}

function tryScholarshipAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(beasiswa|potongan|diskon|bantuan\s+biaya|kip|1k1s|1\s*k\s*1\s*s|satu\s+keluarga\s+satu\s+sarjana|prestasi|yayasan|smkti|pandawa|kuliah\s+sambil\s+kerja|luar\s+negeri)\b/.test(q)) return null;
  return {
    answer: [
      'Ya, ada beberapa pilihan beasiswa/program bantuan yang bisa ditanyakan di ITB STIKOM Bali:',
      '',
      '* Beasiswa KIP',
      '* Beasiswa 1K1S (Satu Keluarga Satu Sarjana)',
      '* Beasiswa Prestasi',
      '* Beasiswa Yayasan',
      '* Beasiswa Khusus Siswa SMKTI Bali Global dan SMK Pandawa Bali Global',
      '* Kuliah Sambil Kerja di Luar Negeri',
      '',
      'Selain itu, pada data biaya PMB juga ada potongan biaya yang mengikuti gelombang pendaftaran:',
      '* Potongan biaya pendaftaran per gelombang',
      '* Potongan DPP nominal per gelombang',
      '* Tambahan beasiswa DPP berupa persentase dari DPP',
      '',
      'Untuk S1 SI/TI/BD, tambahan beasiswa DPP yang terbaca di dokumen:',
      '* Gelombang Khusus: 60%',
      '* Gelombang I: 50%',
      '* Gelombang II: 40%',
      '* Gelombang III: 30%',
      '* Gelombang IV: 20%',
      '',
      'Kalau kakak sebutkan prodi dan gelombangnya, saya bisa hitungkan rincian biaya setelah potongan.'
    ].join('\n')
  };
}

function tryGeneralFeeQuestionAnswer(question, index = ragEngine.loadIndex()) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return null;
  const asksFee = /\b(biaya|harga|bayar|uang|ukt|dpp|pendaftaran|rincian\s+biaya|biaya\s+s1|s1)\b/.test(q);
  if (!asksFee) return null;

  const hasProgram = !!detectProgram(question);
  const hasWave = !!normalizeWave(question);
  const raw = String(question || '').trim();
  const asksOnlyFee = /^(ada\s+biaya|biaya|biaya\s+kuliah|biaya\s+s1|rincian\s+biaya\s*(?:[1-4]|i{1,3}|iv)?\s*[a-c]?)\??$/i.test(raw);
  const asksFeeComponents = /\b(biaya\s+(?:apa\s+aja|apa\s+saja|yang\s+dibayar|masuk)|bayar\s+apa\s+aja|komponen\s+biaya)\b/i.test(raw);

  if (hasWave && !hasProgram) {
    return {
      answer: [
        'Bisa, Kak. Untuk menghitung rincian biaya berdasarkan gelombang, saya perlu tahu prodi yang kakak maksud dulu.',
        '',
        'Contoh format pertanyaan:',
        '- Rincian biaya SI Gelombang I B',
        '- Rincian biaya TI Gelombang I B',
        '- Rincian biaya SK Gelombang I B',
        '- Rincian biaya BD Gelombang I B'
      ].join('\n')
    };
  }

  if (/\bbiaya\s+s1\b|^biaya\s*s1\??$/i.test(raw)) {
    const profiles = extractProfiles(index)
      .filter((p) => ['si', 'ti', 'bd', 'sk'].includes(p.key) && Number.isFinite(p.biayaAwalLow))
      .sort((a, b) => ['si', 'ti', 'bd', 'sk'].indexOf(a.key) - ['si', 'ti', 'bd', 'sk'].indexOf(b.key));
    if (profiles.length) {
      return {
        answer: [
          'Berikut gambaran biaya S1 yang tersedia pada data:',
          '',
          ...profiles.map((p) => '- ' + p.label + ' (' + p.degree + '): biaya awal masuk ' + formatRange(p.biayaAwalLow, p.biayaAwalHigh) + '; biaya pendidikan per semester ' + formatRange(p.semester, p.semester) + '/semester'),
          '',
          'Kalau kakak ingin rincian lengkap setelah potongan gelombang, sebutkan prodi dan gelombangnya. Contoh: rincian biaya SI Gelombang I B.'
        ].join('\n')
      };
    }
  }

  if ((asksOnlyFee || asksFeeComponents) && !hasProgram) {
    return {
      answer: [
        'Ada biaya pendaftaran, biaya awal masuk/DPP, dan biaya pendidikan per semester. Namun untuk angka yang tepat, saya perlu tahu prodi dan gelombangnya dulu.',
        '',
        'Contoh pertanyaan yang bisa kakak kirim:',
        '- Rincian biaya SI Gelombang I B',
        '- Rincian biaya TI Gelombang IV A',
        '- UKT Sistem Komputer',
        '- Biaya S1 termurah apa?'
      ].join('\n')
    };
  }

  return null;
}

function isRegistrationFeeQuestion(question) {
  const q = String(question || '').toLowerCase();
  if (/\b(cara|gimana|bagaimana|dimana|di\s*mana)\b.*\b(daftar|mendaftar|pendaftaran|registrasi)\b/.test(q)) return false;
  const hasRegistration = /\b(biaya\s+pendaftaran|uang\s+pendaftaran|harga\s+pendaftaran|bayar\s+pendaftaran|pendaftaran\s+(?:berapa|rp|mahal|murah)|daftar\s+(?:berapa|rp))\b/.test(q);
  const asksAmount = /\b(berapa|biaya|harga|bayar|uang|rp|nominal)\b/.test(q);
  return hasRegistration && asksAmount;
}

function renderRegistrationDiscountLines(base, discounts) {
  return [
    '- Gelombang Khusus: potongan ' + formatRp(discounts.pendaftaran.Khusus || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.Khusus || 0))),
    '- Gelombang I: potongan ' + formatRp(discounts.pendaftaran.I || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.I || 0))),
    '- Gelombang II: potongan ' + formatRp(discounts.pendaftaran.II || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.II || 0))),
    '- Gelombang III: potongan ' + formatRp(discounts.pendaftaran.III || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.III || 0))),
    '- Gelombang IV: potongan ' + formatRp(discounts.pendaftaran.IV || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.IV || 0)))
  ];
}

function tryRegistrationFeeAnswer(question, index = ragEngine.loadIndex()) {
  if (!isRegistrationFeeQuestion(question)) return null;

  const wave = normalizeWave(question);
  const found = feeProfileByProgram(question, index);
  const program = found && found.program ? found.program : null;
  const profile = found && found.profile ? found.profile : null;
  const profiles = extractProfiles(index);
  const fallbackProfile = profiles.find((p) => Number.isFinite(p.pendaftaran));
  const basePendaftaran = (profile && profile.pendaftaran) || (fallbackProfile && fallbackProfile.pendaftaran) || 500000;
  const family = program ? program.family : 's1';
  const discounts = WAVE_DISCOUNTS[family] || WAVE_DISCOUNTS.s1;
  const programText = program ? ' untuk Prodi ' + program.label : '';

  if (program && program.family === 's2' && !wave) {
    return {
      answer: [
        'Biaya pendaftaran untuk Prodi S2 Sistem Informasi: ' + formatRp(basePendaftaran) + '.',
        '',
        'Potongan biaya pendaftaran S2 yang tercantum pada dokumen:',
        '- Gelombang I: potongan Rp. 200.000, total Rp. 500.000',
        '- Gelombang II: potongan Rp. 100.000, total Rp. 600.000',
        '- Tambahan potongan Rp. 200.000 jika alumni ITB STIKOM Bali',
        '',
        'Untuk gelombang lain, saya belum menemukan potongan pendaftaran S2 pada data yang tersedia.'
      ].join('\n'),
      program,
      profile,
      wave: null
    };
  }

  if (wave) {
    const discount = (discounts.pendaftaran && discounts.pendaftaran[wave.group]) || 0;
    const total = Math.max(0, basePendaftaran - discount);
    return {
      answer: [
        'Biaya pendaftaran' + programText + ' ' + wave.display + ':',
        '',
        '* Biaya pendaftaran: ' + formatRp(basePendaftaran),
        '* Potongan biaya pendaftaran (' + wave.display + '): ' + formatRp(discount),
        'Total biaya pendaftaran (' + wave.display + '): ' + formatRp(total),
        '',
        'Catatan: ini hanya komponen pendaftaran, belum termasuk DPP, biaya awal masuk/perlengkapan, dan UKT per semester.'
      ].join('\n'),
      program,
      profile,
      wave
    };
  }

  return {
    answer: [
      'Biaya pendaftaran' + programText + ': ' + formatRp(basePendaftaran) + '.',
      '',
      'Nominal yang dibayar bisa berubah setelah potongan sesuai gelombang pendaftaran:',
      ...renderRegistrationDiscountLines(basePendaftaran, discounts),
      '',
      'Kalau kakak sebutkan gelombangnya, misalnya Gelombang I B atau Gelombang IV A, saya bisa hitungkan total biaya pendaftarannya.'
    ].join('\n'),
    program,
    profile,
    wave: null
  };
}

function tryDetailedFeeAnswer(question, index) {
  const q = String(question || '').toLowerCase();
  if (!/\b(biaya|rincian|detail|dpp|ukt|gelombang|gel\b|bayar|bayarnya|pendaftaran|registrasi|duit|uang|harga|total|awal(?:nya)?|masuk)\b/.test(q)) return null;
  if (isRegistrationFeeQuestion(question) && !/\b(rincian|detail|dpp|ukt|awal(?:nya)?|masuk|total\s+(?:awal|kuliah)|semua)\b/.test(q)) return null;
  const wave = normalizeWave(question);
  const found = feeProfileByProgram(question, index);

  if (/\b(registrasi|saat\s+registrasi|daftar\s+ulang)\b/.test(q) && found && found.program && found.profile) {
    if (found.program.family === 'international') {
      return {
        answer: [
          `Untuk ${found.program.label}, komponen yang tercantum dibayar saat registrasi adalah Dana Pendidikan Pokok (DPP): ${formatRp(found.profile.dpp)}.`,
          '',
          found.profile.languageFee ? `${found.profile.languageLabel || 'Biaya bahasa'}: ${formatRp(found.profile.languageFee)} dibayar menjelang Semester II.` : null,
          `Biaya pendaftaran terpisah dari DPP, yaitu ${formatRp(found.profile.pendaftaran)} pada saat daftar.`,
          `Biaya pendidikan per semester: ${formatRp(found.profile.semester)}.`
        ].filter(Boolean).join('\n'),
        program: found.program,
        profile: found.profile,
        wave: null
      };
    }
    if (found.program.family === 's2') {
      return {
        answer: [
          `Untuk S2 Sistem Informasi/Pascasarjana, opsi pembayaran yang tercantum saat registrasi adalah pembayaran lunas 2 tahun: ${formatRp(found.profile.lunas2Tahun)}.`,
          '',
          `Biaya pendaftaran: ${formatRp(found.profile.pendaftaran)}.`,
          `Biaya pendidikan per semester: ${formatRp(found.profile.semester)}.`
        ].join('\n'),
        program: found.program,
        profile: found.profile,
        wave: null
      };
    }
  }

  if (/\b(ukt|uang\s+kuliah\s+tunggal|biaya\s+pendidikan\s+per\s+semester|biaya\s+semester|per\s+semester)\b/.test(q)) {
    const profiles = extractProfiles(index);
    if (found && found.program && found.profile && !Number.isFinite(found.profile.semester)) {
      return {
        answer: [
          `Biaya pendidikan per semester (UKT) untuk Prodi ${found.program.label} belum tercantum pada data biaya yang tersedia.`,
          '',
          'Data yang tersedia baru mencantumkan komponen seperti pendaftaran dan DPP/biaya awal. Untuk nominal UKT yang pasti, sebaiknya konfirmasi ke admin/PMB.'
        ].join('\n'),
        program: found.program,
        profile: found.profile,
        wave: null
      };
    }

    if (found && found.program && found.profile && Number.isFinite(found.profile.semester)) {
      const mentionedAmountMatch = q.match(/\b(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d{5,})\b/i);
      const mentionedAmount = mentionedAmountMatch ? parseAmount(mentionedAmountMatch[1]) : null;
      const discrepancyNote = Number.isFinite(mentionedAmount) && mentionedAmount !== found.profile.semester
        ? [
            '',
            `Kalau tagihan yang kakak lihat berbeda (${formatRp(mentionedAmount)}), kemungkinan ada komponen lain atau penyesuaian administrasi. Untuk memastikan rincian tagihan pribadi, sebaiknya cek ke admin/PMB atau bagian keuangan.`
          ].join('\n')
        : '';
      return {
        answer: [
          `Biaya pendidikan per semester (UKT) untuk Prodi ${found.program.label}: ${formatRp(found.profile.semester)}.`,
          '',
          `UKT/biaya pendidikan per semester dibayarkan per semester dan tidak bergantung pada gelombang pendaftaran.${discrepancyNote}`
        ].join('\n'),
        program: found.program,
        profile: found.profile,
        wave: null
      };
    }

    const available = profiles
      .filter((p) => Number.isFinite(p.semester))
      .sort((a, b) => {
        const order = ['si', 'ti', 'bd', 'sk', 'mi', 's2'];
        return order.indexOf(a.key) - order.indexOf(b.key);
      });
    if (available.length) {
      return {
        answer: [
          'Berikut UKT/biaya pendidikan per semester yang terbaca pada data biaya:',
          '',
          ...available.map((p) => `- ${p.label} (${p.degree}): ${formatRp(p.semester)}/semester`),
          '',
          'Kalau kakak ingin rincian lengkap biaya awal masuk, sebutkan prodi dan gelombangnya.'
        ].join('\n'),
        program: null,
        profile: null,
        wave: null
      };
    }
  }

  if (!wave && found && found.program && found.profile && found.program.family === 's2') {
    const profile = found.profile;
    return {
      answer: [
        'Rincian biaya S2 Sistem Informasi/Pascasarjana:',
        '',
        `* Biaya pendaftaran: ${formatRp(profile.pendaftaran)}`,
        '* Potongan biaya pendaftaran Gelombang I: Rp. 200.000',
        '* Potongan biaya pendaftaran Gelombang II: Rp. 100.000',
        `* Biaya pendidikan per semester (UKT): ${formatRp(profile.semester)}`,
        profile.lunas2Tahun ? `* Pembayaran lunas selama 2 tahun: ${formatRp(profile.lunas2Tahun)}` : null,
        profile.thesisSemester ? `* Biaya semester 5 dan seterusnya jika hanya mengambil tesis: ${formatRp(profile.thesisSemester)}` : null,
        '',
        'Catatan: potongan alumni tercantum pada dokumen S2 dan bisa dikonfirmasi ke admin/PMB sesuai status pendaftar.'
      ].filter(Boolean).join('\n'),
      program: found.program,
      profile,
      wave: null
    };
  }

  if (!wave || !found || !found.program || !found.profile) return null;

  const { program, profile } = found;
  const discounts = WAVE_DISCOUNTS[program.family] || WAVE_DISCOUNTS.s1;
  const basePendaftaran = profile.pendaftaran || 0;
  const pendaftaranDiscount = discounts.pendaftaran[wave.group] || 0;
  const totalPendaftaran = Math.max(0, basePendaftaran - pendaftaranDiscount);
  const dpp = profile.dpp || profile.registrasi || 0;
  const dppDiscount = calculateDppDiscount(dpp, discounts, wave.group);
  const jasTopi = profile.atribut ? null : null;
  const equipmentTotal = profile.atribut || 0;

  let jas = null;
  let kaos = null;
  if (program.family === 's1' || program.family === 'sk') {
    jas = 750000;
    kaos = 750000;
  } else if (program.family === 'd3') {
    jas = profile.registrasi || null;
  }

  const subtotalPerlengkapan = [jas, kaos].filter((n) => Number.isFinite(n)).reduce((sum, n) => sum + n, 0) || equipmentTotal;
  const totalAwal = Math.max(0, totalPendaftaran + subtotalPerlengkapan + Math.max(0, dpp - dppDiscount.total));

  const lines = [
    `Untuk program studi ${program.label}, rincian biaya sebagai berikut:`,
    '',
    'Pendaftaran:',
    `* Biaya pendaftaran: ${formatRp(basePendaftaran)}`,
    `* Potongan biaya pendaftaran (${wave.display}): ${formatRp(pendaftaranDiscount)}`,
    `Total biaya pendaftaran (${wave.display}): ${formatRp(totalPendaftaran)}`,
    '',
    `Biaya awal masuk untuk Prodi ${program.label}:`,
    ''
  ];

  if (program.family === 'international') {
    lines.push(`* DPP / Dana Pendidikan Pokok: ${formatRp(profile.dpp || 0)}`);
    lines.push(`* Potongan biaya DPP (${wave.display}): ${formatRp(dppDiscount.total)}${dppDiscount.note}`);
    lines.push(`Total awal masuk setelah potongan (${wave.display}): ${formatRp(totalAwal)}`);
    if (profile.languageFee) lines.push(`* ${profile.languageLabel || 'Biaya bahasa'}: ${formatRp(profile.languageFee)} (menjelang Semester II)`);
    lines.push('');
    lines.push(`Biaya pendidikan per semester (UKT): ${profile.semester ? formatRp(profile.semester) : 'belum tercantum pada data biaya'}`);
    return { answer: lines.join('\n').trim(), program, profile, wave };
  }

  if (program.family === 'utb') {
    lines.push(`* DPP / Dana Pendidikan Pokok: ${formatRp(profile.dpp || 0)}`);
    lines.push(`* Potongan biaya DPP (${wave.display}): ${formatRp(dppDiscount.total)}${dppDiscount.note}`);
    lines.push(`Total awal masuk setelah potongan (${wave.display}): ${formatRp(totalAwal)}`);
    lines.push('');
    lines.push(`Biaya pendidikan per semester (UKT): ${profile.semester ? formatRp(profile.semester) : 'belum tercantum pada data biaya UTB yang tersedia'}`);
    return { answer: lines.join('\n').trim(), program, profile, wave };
  }

  if (jas !== null && program.family === 'd3') {
    lines.push(`* Biaya registrasi/perlengkapan: ${formatRp(jas)}`);
  } else {
    lines.push(`* Jas almamater dan topi: ${formatRp(jas || 0)}`);
    lines.push(`* Kaos, tas, GMTI: ${formatRp(kaos || 0)}`);
  }
  lines.push(`Subtotal biaya awal masuk: ${formatRp(subtotalPerlengkapan)}`);
  lines.push(`* DPP: ${formatRp(dpp)}`);
  lines.push(`* Potongan biaya DPP (${wave.display}): ${formatRp(dppDiscount.total)}${dppDiscount.note}`);
  lines.push(`Total awal masuk setelah potongan (${wave.display}): ${formatRp(totalAwal)}`);
  lines.push('');
  lines.push(`Biaya pendidikan per semester (UKT): ${formatRp(profile.semester || 0)}`);

  return { answer: lines.join('\n').trim(), program, profile, wave };
}

function hasFeeComparisonSignal(question) {
  const q = String(question || '').toLowerCase();
  return /\b(biaya(?:nya)?|harga(?:nya)?|tarif(?:nya)?|ongkos(?:nya)?|uang|kuliah|bayar(?:nya)?|dpp|ukt|pendaftaran|semester|termurah|termahal|murah|mahal|hemat|irit|terjangkau)\b/.test(q);
}

function tryContextualMultiProgramFeeAnswer(question, index, options = {}) {
  const q = String(question || '').toLowerCase();
  const basisQuestion = String(options && options.originalQuestion ? options.originalQuestion : question).toLowerCase();
  if (!hasFeeComparisonSignal(basisQuestion)) return null;
  if (!/\b(biaya|harga|tarif|ongkos|uang|kuliah|bayar|dpp|ukt|pendaftaran|semester|termurah|termahal|murah|mahal|hemat|irit|terjangkau|perbandingan|bandingkan|compare)\b/.test(q)) return null;
  if (isRegistrationFeeQuestion(question)) return null;

  const explicitPrograms = detectMentionedPrograms(question);
  const hintedPrograms = detectProgramsFromHint(options && options.programHint);
  const sessionPrograms = detectProgramsFromSessionData(options && options.sessionData);
  const asksExplicitComparison = /\b(perbandingan\s+(?:harga|biaya|tarif|ongkos)|bandingkan\s+(?:harga|biaya|tarif|ongkos)|compare)\b/.test(q);
  const asksFollowupGroup = /\b(ketiga|tiga|semua|program\s+studi\s+itu|prodi\s+itu|ketiganya|tadi|tersebut|yang\s+tadi|biaya(?:nya)?|harga(?:nya)?)\b/.test(q);
  const hasPureGroupReference = /\b(ketiga|tiga|semua|program\s+studi\s+itu|prodi\s+itu|ketiganya|tadi|tersebut|yang\s+tadi)\b/.test(q);
  if (explicitPrograms.length === 1 && !asksExplicitComparison && !hasPureGroupReference) return null;
  const requestedPrograms = explicitPrograms.length >= 2
    ? explicitPrograms
    : (hintedPrograms.length >= 2 ? hintedPrograms : sessionPrograms);
  const asksContextualGroup = asksExplicitComparison || asksFollowupGroup;
  if (requestedPrograms.length < 2 || (!asksContextualGroup && explicitPrograms.length < 2)) return null;

  const requestedKeys = new Set(requestedPrograms.map((p) => p.key));
  const profiles = extractProfiles(index).filter((p) => requestedKeys.has(p.key) && Number.isFinite(p.biayaAwalLow));
  if (profiles.length < 2) return null;

  const sorted = profiles.slice().sort((a, b) => {
    const order = ['si', 'sk', 'ti', 'bd', 'mi'];
    return order.indexOf(a.key) - order.indexOf(b.key);
  });

  const lines = [
    'Berikut gambaran biaya untuk program studi yang kakak tanyakan:',
    '',
    'Saya tampilkan biaya awal masuk dan biaya pendidikan per semester. Biaya semester tidak saya kalikan menjadi total sampai lulus agar tidak menebak di luar data.'
  ];

  for (const p of sorted) {
    lines.push(`- ${p.label} (${p.degree}): biaya awal masuk ${formatRange(p.biayaAwalLow, p.biayaAwalHigh)}; biaya pendidikan per semester ${formatRange(p.semester, p.semester)}/semester`);
  }

  const cheapest = sorted.slice().sort((a, b) => a.biayaAwalLow - b.biayaAwalLow)[0];
  const sameInitial = sorted.every((p) => p.biayaAwalLow === cheapest.biayaAwalLow && p.biayaAwalHigh === cheapest.biayaAwalHigh);
  const sameSemester = sorted.every((p) => p.semester === cheapest.semester);
  lines.push('');
  if (sameInitial && sameSemester) {
    lines.push(`Kesimpulan: biaya awal masuk dan biaya semester untuk ${sorted.map((p) => p.label).join(', ')} terbaca setara pada data ini.`);
  } else {
    lines.push(`Kesimpulan: dari biaya awal masuk, yang paling murah adalah ${cheapest.label} dengan ${formatRange(cheapest.biayaAwalLow, cheapest.biayaAwalHigh)}.`);
  }

  lines.push('');
  lines.push('Kalau kakak sebutkan gelombang pendaftaran, misalnya Gelombang II B atau IV A, saya bisa hitungkan rincian setelah potongan.');

  return { answer: lines.join('\n'), profiles: sorted };
}

function tryDualDegreeAnswer(question) {
  const q = String(question || '').toLowerCase();
  const hasDoubleDegreeSignal = /\b(double\s*degree(?:nya)?|dual\s*degree(?:nya)?|dd)\b/.test(q);
  const hasPartnerSignal = /\b(utb|universitas\s+teknologi\s+bandung|dnui|dalian\s+neusoft|help\s+university|help)\b/.test(q);
  const asksPartnerProgram = /\b(jurusan|prodi|program\s+studi|padanan|pasangan|di\s+stikom|stikom\s+bali|di\s+sana|disana|mitra|partner|yang\s+diambil|harus\s+diambil)\b/.test(q);
  if (!hasDoubleDegreeSignal && !(hasPartnerSignal && asksPartnerProgram)) return null;
  const asksInternational = /\b(internasional|international|luar\s+negeri|dnui|help|china|malaysia)\b/.test(q);
  const asksNational = /\b(nasional|national|utb|bandung)\b/.test(q);
  const asksUtbPair = /\b(utb|universitas\s+teknologi\s+bandung)\b/.test(q) && /\b(padanan|pasangan|di\s+stikom|stikom\s+bali|harus\s+diambil|jurusan\s+apa\s+dan\s+jurusan\s+apa)\b/.test(q);
  const asksAllPairs = /\b(jurusan\s+apa\s+dan\s+jurusan\s+apa|yang\s+lain|lainnya|semua|dnui|help|di\s+sana|disana)\b/.test(q) && (hasDoubleDegreeSignal || hasPartnerSignal);
  const asksUtbMajor = /\b(utb|universitas\s+teknologi\s+bandung)\b/.test(q) && /\b(jurusan|prodi|mengambil|ambil|dapat|dapet|di\s+utb|utb\s+nya|utbnya)\b/.test(q);
  const asksUtbSpecific = /\b(utb|universitas\s+teknologi\s+bandung)\b/.test(q) && /\b(seperti\s+apa|spesifik|khusus|dibanding|beda|bedanya|perbedaan|program\s+lain)\b/.test(q);
  const asksMeaning = /\b(apa\s+itu|maksudnya|pengertian|jelaskan|seperti\s+apa)\b/.test(q);

  const pairLines = [
    '* UTB - Universitas Teknologi Bandung: Prodi di STIKOM Bali adalah Bisnis Digital; jurusan di UTB adalah DKV (Desain Komunikasi Visual).',
    '* DNUI - Dalian Neusoft University of Information, China: Prodi di STIKOM Bali adalah Bisnis Digital; jurusan di DNUI belum tercantum pada data yang tersedia.',
    '* HELP University, Malaysia: Prodi di STIKOM Bali adalah Sistem Informasi; jurusan di HELP belum tercantum pada data yang tersedia.'
  ];

  if (asksUtbPair) {
    return {
      answer: [
        'Untuk Double Degree Nasional dengan UTB, pasangannya adalah:',
        '',
        '* Prodi di ITB STIKOM Bali: Bisnis Digital',
        '* Jurusan di UTB: DKV (Desain Komunikasi Visual)',
        '',
        'Jadi, kalau kakak mengambil jalur Double Degree UTB, sisi STIKOM Bali-nya adalah Bisnis Digital, sedangkan sisi UTB-nya DKV.'
      ].join('\n')
    };
  }

  if (asksAllPairs && !asksUtbSpecific) {
    return {
      answer: [
        'Berikut pasangan prodi/jurusan Double Degree yang tersedia pada data:',
        '',
        ...pairLines,
        '',
        'Catatan: untuk DNUI dan HELP, data yang tersedia baru mencantumkan prodi di sisi STIKOM Bali. Nama jurusan di kampus mitra belum tercantum, jadi saya tidak menebak di luar data.'
      ].join('\n')
    };
  }

  if (asksUtbMajor) {
    return {
      answer: [
        'Untuk Double Degree Nasional dengan UTB:',
        '',
        '* Prodi di ITB STIKOM Bali: Bisnis Digital',
        '* Jurusan di UTB: DKV (Desain Komunikasi Visual)',
        '',
        'Jadi, konteksnya adalah pasangan prodi pada program kerja sama Double Degree Nasional dengan UTB.'
      ].join('\n')
    };
  }

  if (asksUtbSpecific) {
    return {
      answer: [
        'Double Degree Nasional dengan UTB adalah program kerja sama ITB STIKOM Bali dengan Universitas Teknologi Bandung (UTB).',
        '',
        'Hal yang spesifik dari jalur UTB:',
        '* Jalurnya National Class/nasional, bukan International Class.',
        '* Kampus mitranya adalah UTB - Universitas Teknologi Bandung.',
        '* Untuk sisi STIKOM Bali, prodi yang terkait adalah Bisnis Digital.',
        '* Untuk sisi UTB, jurusan yang diambil adalah DKV (Desain Komunikasi Visual).',
        '* Berbeda dari DNUI dan HELP yang masuk jalur internasional.',
        '',
        'Jadi, kalau pertanyaannya pasangan UTB dan STIKOM Bali, jawabannya: STIKOM Bali Bisnis Digital, UTB DKV (Desain Komunikasi Visual).'
      ].join('\n')
    };
  }

  if (asksInternational && !asksNational) {
    return {
      answer: [
        'Ya, ada program Double Degree internasional di ITB STIKOM Bali:',
        '',
        '* DNUI - Dalian Neusoft University of Information, China',
        '* HELP University, Malaysia',
        '',
        'Pada data yang tersedia, DNUI terkait Prodi Bisnis Digital di STIKOM Bali, sedangkan HELP University terkait Prodi Sistem Informasi di STIKOM Bali. Nama jurusan di sisi DNUI/HELP belum tercantum, jadi saya tidak menebak di luar data.'
      ].join('\n')
    };
  }

  if (asksNational && !asksInternational) {
    return {
      answer: [
        'Ya, ada program Double Degree nasional di ITB STIKOM Bali:',
        '',
        '* UTB - Universitas Teknologi Bandung',
        '',
        'Untuk sisi STIKOM Bali, prodi yang terkait adalah Bisnis Digital. Untuk sisi UTB, jurusan yang diambil adalah DKV (Desain Komunikasi Visual).'
      ].join('\n')
    };
  }

  return {
    answer: [
      asksMeaning
        ? 'Double Degree adalah program kerja sama kuliah dengan kampus mitra, sehingga mahasiswa mengikuti skema akademik yang melibatkan ITB STIKOM Bali dan universitas partner.'
        : 'Ya, ada program Double Degree di ITB STIKOM Bali.',
      '',
      'Pilihan yang tersedia:',
      ...pairLines,
      '',
      'Kalau kakak mau, saya bisa jelaskan detail program UTB, DNUI, atau HELP.'
    ].join('\n')
  };
}

function tryCareerAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(prospek|kerja|karir|karier|lulusan|peluang|profesi|pekerjaan|bidang|bisa\s+jadi|jadi\s+apa|kerja\s+apa|kerjanya\s+apa|profesi\s+apa)\b/.test(q)) return null;
  const program = detectProgram(question);
  if (!program) return null;
  const domain = readProgramDomain(program.key);
  if (domain && domain.prospek) {
    return {
      answer: [
        `Prospek kerja lulusan ${program.label}:`,
        '',
        domain.prospek,
        '',
        `Secara umum, ${program.label} cocok untuk kakak yang ingin membangun karier di bidang ${program.key === 'si' ? 'analisis bisnis, sistem informasi, data, dan transformasi digital' : program.key === 'ti' ? 'software, infrastruktur IT, cloud, jaringan, keamanan, dan aplikasi digital' : program.key === 'sk' ? 'integrasi hardware-software, IoT, otomasi, jaringan, dan infrastruktur' : program.key === 'bd' ? 'pemasaran digital, growth, e-commerce, pengembangan bisnis, produk digital, dan wirausaha' : 'pengembangan aplikasi, pengelolaan data, IT support, dan administrasi sistem informasi'}.`
      ].join('\n')
    };
  }
  return {
    answer: [
      'Prospek kerja lulusan Teknologi Informasi berfokus pada bidang teknis teknologi, pengembangan sistem, jaringan, data, keamanan, dan aplikasi digital.',
      '',
      'Beberapa peluang kerja yang relevan:',
      '1) Software Developer / Programmer',
      '2) Web Developer / App Developer',
      '3) Network Engineer',
      '4) Cybersecurity Specialist',
      '5) Data Analyst / Data Engineer',
      '6) IT Support / IT Operations',
      '7) UI/UX atau pengembangan produk digital',
      '',
      'Secara umum, TI cocok untuk kakak yang tertarik pada coding, infrastruktur IT, keamanan sistem, pengolahan data, dan pengembangan aplikasi.'
    ].join('\n')
  };
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r/g, '')
    .trim();
}

function corpusByFilename(index, filenameRe) {
  return normalizeText((Array.isArray(index) ? index : [])
    .filter((item) => filenameRe.test(String(item && item.filename ? item.filename : '')))
    .map((item) => String(item && item.chunk ? item.chunk : ''))
    .join('\n'));
}

function grab(text, patterns, opts = {}) {
  const min = Number.isFinite(opts.min) ? opts.min : 1;
  const max = Number.isFinite(opts.max) ? opts.max : Number.MAX_SAFE_INTEGER;
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let match;
    while ((match = re.exec(text)) !== null) {
      const raw = match && match[1] ? match[1] : '';
      const amount = parseAmount(raw);
      if (amount && amount >= min && amount <= max) return amount;
      if (re.lastIndex === match.index) re.lastIndex += 1;
    }
  }
  return null;
}

function collectIndustryRange(text) {
  const entries = [
    grab(text, [/\bInternasio[a-z]*\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 50000000 }),
    grab(text, [/\bNasional\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 50000000 }),
    grab(text, [/\bLokal\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 50000000 })
  ].filter((n) => Number.isFinite(n));
  if (!entries.length) return { low: 0, high: 0 };
  return { low: Math.min(...entries), high: Math.max(...entries) };
}

function buildProfile({ key, label, degree, source, normalSemesters, pendaftaran, dpp, registrasi, uniform, activity, semester, industry, includeIndustryInInitial = false, includeFirstSemesterInInitial = false }) {
  const awalParts = [pendaftaran, dpp, registrasi, uniform, activity].filter((n) => Number.isFinite(n));
  const baseAwal = awalParts.reduce((sum, n) => sum + n, 0);
  const semesterCount = Number.isFinite(normalSemesters) ? normalSemesters : null;
  const industryLow = industry && Number.isFinite(industry.low) ? industry.low : 0;
  const industryHigh = industry && Number.isFinite(industry.high) ? industry.high : industryLow;
  const firstSemester = includeFirstSemesterInInitial && Number.isFinite(semester) ? semester : 0;
  const biayaAwalLow = baseAwal + firstSemester + (includeIndustryInInitial ? industryLow : 0);
  const biayaAwalHigh = baseAwal + firstSemester + (includeIndustryInInitial ? industryHigh : 0);

  if (!biayaAwalLow && !semester) return null;
  return {
    key,
    label,
    degree,
    source,
    normalSemesters: semesterCount,
    pendaftaran: pendaftaran || null,
    dpp: dpp || null,
    registrasi: registrasi || null,
    atribut: [uniform, activity].filter((n) => Number.isFinite(n)).reduce((sum, n) => sum + n, 0) || null,
    semester: semester || null,
    biayaAwal: biayaAwalLow,
    biayaAwalLow,
    biayaAwalHigh
  };
}

function extractProfiles(index = ragEngine.loadIndex()) {
  const s1Text = corpusByFilename(index, /rincian\s+biaya\s+si,ti\s+dan\s+bd/i);
  const skText = corpusByFilename(index, /rincian\s+biaya\s+sk/i);
  const d3Text = corpusByFilename(index, /rincian\s+biaya\s+d3/i);
  const s2Text = corpusByFilename(index, /camscanner/i);
  const dnuiText = corpusByFilename(index, /rincian\s+biaya\s+dnui/i);
  const helpText = corpusByFilename(index, /rincian\s+biaya\s+help/i);
  const utbText = corpusByFilename(index, /rincian\s+biaya\s+utb/i);

  const s1Common = s1Text ? {
    pendaftaran: grab(s1Text, [/\bPendaftaran\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 5000000 }),
    dpp: grab(s1Text, [/Dana\s+Pendidikan\s+Pokok\s*([0-9][0-9.]{0,20})/i], { min: 1000000, max: 100000000 }),
    uniform: grab(s1Text, [/Jas\s+Alamater,\s*Topi\s*([0-9][0-9.]{0,20})/i, /Jas\s+Almamater[^0-9]{0,80}([0-9][0-9.]{0,20})/i], { min: 100000, max: 10000000 }),
    activity: grab(s1Text, [/Kaos,\s*Tas,\s*GMTI\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 10000000 }),
    semester: grab(s1Text, [/Biaya\s+Pendidikan\s+Per\s+Semester\s*([0-9][0-9.]{0,20})/i], { min: 1000000, max: 50000000 }),
    industry: collectIndustryRange(s1Text)
  } : null;

  const sk = skText ? {
    pendaftaran: grab(skText, [/\bPendaftaran\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 5000000 }),
    dpp: grab(skText, [/Dana\s+Pendidikan\s+Pokok\s*(?:\(DPP\))?\s*([0-9][0-9.]{0,20})/i, /\(DPP\)\s*([0-9][0-9.]{0,20})/i], { min: 1000000, max: 100000000 }),
    uniform: grab(skText, [/Jas,\s*Topi\s+Almamater\s*([0-9][0-9.]{0,20})/i, /Jas[^0-9]{0,80}([0-9][0-9.]{0,20})/i], { min: 100000, max: 10000000 }),
    activity: grab(skText, [/Kaos,\s*Topi,\s*GMTI\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 10000000 }),
    semester: grab(skText, [/Biaya\s+Pendidikan\s+Per\s+Semester\s*([0-9][0-9.]{0,20})/i], { min: 1000000, max: 50000000 }),
    industry: collectIndustryRange(skText)
  } : null;

  const d3 = d3Text ? {
    pendaftaran: grab(d3Text, [/\bPendaftaran\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 5000000 }),
    registrasi: grab(d3Text, [/Biaya\s+Registrasi[^0-9]{0,80}([0-9][0-9.]{0,20})/i], { min: 1000000, max: 100000000 }),
    semester: grab(d3Text, [/Biaya\s+Pendidikan\s+Per\s+Semester\s*([0-9][0-9.]{0,20})/i], { min: 1000000, max: 50000000 }),
    industry: collectIndustryRange(d3Text)
  } : null;

  const s2 = s2Text ? {
    pendaftaran: grab(s2Text, [/\bPendaftaran\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 5000000 }),
    semester: grab(s2Text, [/Biaya\s+Pendidikan\s+Per\s+Semester\s*([0-9][0-9.]{0,20})/i], { min: 1000000, max: 50000000 }),
    lunas2Tahun: grab(s2Text, [/Lunas\s+Selama\s+2\s*Tahun\s*[?-]\s*([0-9][0-9.]{0,20})/i, /Pembayaran\s+Secara\s+Lunas\s+Selama\s+2\s*Tahun[^0-9]{0,80}([0-9][0-9.]{0,20})/i], { min: 1000000, max: 100000000 }),
    thesisSemester: grab(s2Text, [/Semester\s+5[^0-9]{0,120}([0-9][0-9.]{0,20})/i], { min: 1000000, max: 50000000 })
  } : null;

    const parseDoubleDegree = (value) => value ? {
    pendaftaran: grab(value, [/\bPendaftaran\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 10000000 }),
    dpp: grab(value, [/Dana\s+Pendidikan\s+Pokok\s*([0-9][0-9.]{0,20})/i], { min: 1000000, max: 100000000 }),
    language: grab(value, [/Bahasa\s+(?:Mandarin|Inggris)\s*([0-9][0-9.]{0,20})/i], { min: 1000000, max: 50000000 }),
    semester: grab(value, [/Biaya\s+Pendidikan(?:\s+Per\s+Semester|\s*&\s*Ujian\/Subject)?[^0-9]{0,80}([0-9][0-9.]{0,20})/i], { min: 1000000, max: 50000000 })
  } : null;
  const dnui = parseDoubleDegree(dnuiText);
  const help = parseDoubleDegree(helpText);
    const utb = utbText ? {
    pendaftaran: grab(utbText, [/\bPendaftaran\s*([0-9][0-9.]{0,20})/i], { min: 100000, max: 10000000 }),
    dpp: grab(utbText, [/Dana\s+Pendidikan\s+Pokok\s*(?:\(DPP\))?\s*([0-9][0-9.]{0,20})/i], { min: 1000000, max: 100000000 }),
    uniform: grab(utbText, [/Jas[^0-9]{0,80}([0-9][0-9.]{0,20})/i], { min: 100000, max: 10000000 }),
    activity: grab(utbText, [/Kaos[^0-9]{0,80}([0-9][0-9.]{0,20})/i], { min: 100000, max: 10000000 }),
    semester: grab(utbText, [/Biaya\s+Pendidikan\s+Per\s+Semester\s*([0-9][0-9.]{0,20})/i], { min: 1000000, max: 50000000 })
  } : null;

  const profiles = [];
  if (s1Common) {
    for (const [key, label] of [
      ['si', 'Sistem Informasi'],
      ['ti', 'Teknologi Informasi'],
      ['bd', 'Bisnis Digital']
    ]) {
      const profile = buildProfile({
        key,
        label,
        degree: 'S1',
        source: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
        normalSemesters: 8,
        includeIndustryInInitial: false,
        includeFirstSemesterInInitial: false,
        ...s1Common
      });
      if (profile) profiles.push(profile);
    }
  }
  if (sk) {
    const profile = buildProfile({
      key: 'sk',
      label: 'Sistem Komputer',
      degree: 'S1',
      source: 'rincian Biaya SK Tahun Ajaran 2026-2027.pdf',
      normalSemesters: /10\s*Semester|5\s*Tahun/i.test(skText) ? 10 : 8,
      includeIndustryInInitial: false,
      includeFirstSemesterInInitial: false,
      ...sk
    });
    if (profile) profiles.push(profile);
  }
  if (d3) {
    const profile = buildProfile({
      key: 'mi',
      label: 'Manajemen Informatika',
      degree: 'D3',
      source: 'rincian Biaya D3 Tahun Ajaran 2026-2027.pdf',
      normalSemesters: 6,
      includeIndustryInInitial: true,
      includeFirstSemesterInInitial: false,
      ...d3
    });
    if (profile) profiles.push(profile);
  }
  for (const [key, label, data, source] of [
    ['dnui', 'Double Degree DNUI', dnui, 'rincian Biaya DNUI Tahun Ajaran 2026-2027.pdf'],
    ['help', 'Double Degree HELP University', help, 'rincian Biaya HELP Tahun Ajaran 2026-2027.pdf']
  ]) {
    const profile = buildProfile({
      key,
      label,
      degree: 'Double Degree International',
      source,
      normalSemesters: key === 'dnui' ? 8 : null,
      includeIndustryInInitial: false,
      includeFirstSemesterInInitial: false,
      pendaftaran: data && data.pendaftaran,
      dpp: data && data.dpp,
      registrasi: null,
      uniform: null,
      activity: null,
      semester: data && data.semester
    });
    if (profile && data && data.language) {
      profile.languageFee = data.language;
      profile.languageLabel = key === 'dnui' ? 'Bahasa Mandarin' : 'Bahasa Inggris';
    }
    if (profile) profiles.push(profile);
  }
  if (utb) {
    const profile = buildProfile({
      key: 'utb',
      label: 'Double Degree UTB',
      degree: 'Double Degree National',
      source: 'rincian Biaya UTB Tahun Ajaran 2026-2027.pdf',
      normalSemesters: 8,
      includeIndustryInInitial: false,
      includeFirstSemesterInInitial: false,
      pendaftaran: utb.pendaftaran,
      dpp: utb.dpp,
      registrasi: null,
      uniform: utb.uniform,
      activity: utb.activity,
      semester: utb.semester
    });
    if (profile) profiles.push(profile);
  }

  if (s2 && (s2.pendaftaran || s2.semester || s2.lunas2Tahun)) {
    profiles.push({
      key: 's2',
      label: 'S2 Sistem Informasi',
      degree: 'S2',
      source: 'CamScanner 12-02-2026 14.39 (1).pdf',
      normalSemesters: 4,
      pendaftaran: s2.pendaftaran || null,
      dpp: null,
      registrasi: null,
      atribut: null,
      semester: s2.semester || null,
      biayaAwal: s2.pendaftaran || 0,
      biayaAwalLow: s2.pendaftaran || 0,
      biayaAwalHigh: s2.pendaftaran || 0,
      lunas2Tahun: s2.lunas2Tahun || null,
      thesisSemester: s2.thesisSemester || null
    });
  }

  return profiles;
}

function isComparisonQuestion(question) {
  const q = String(question || '').toLowerCase();
  const hasComparison = /\b(termurah|termahal|paling\s+murah|paling\s+mahal|lebih\s+murah|lebih\s+mahal|paling\s+hemat|hemat|irit|terjangkau|bandingkan|perbandingan|compare)\b/.test(q);
  return hasComparison && hasFeeComparisonSignal(q);
}

function selectScope(question, profiles) {
  const q = String(question || '').toLowerCase();
  let scoped = profiles.slice();
  if (/\bs1\b|sarjana/.test(q)) scoped = scoped.filter((p) => p.degree === 'S1');
  if (/\bd3\b|diploma/.test(q)) scoped = scoped.filter((p) => p.degree === 'D3');
  if (/\bs2\b|pascasarjana/.test(q)) scoped = scoped.filter((p) => p.degree === 'S2');
  if (!/\bs2\b|pascasarjana/.test(q)) scoped = scoped.filter((p) => p.degree !== 'S2');
  return scoped.length ? scoped : profiles;
}

function renderProfileLine(profile) {
  const awal = formatRange(profile.biayaAwalLow, profile.biayaAwalHigh);
  const semester = profile.semester ? `${formatRp(profile.semester)}/semester` : 'tidak tercantum';
  return `- ${profile.label} (${profile.degree}): biaya awal masuk ${awal}; biaya semester ${semester}`;
}

function tryFeeComparisonAnswer(question, index, options = {}) {
  const basisQuestion = options && options.originalQuestion ? options.originalQuestion : question;
  if (!isComparisonQuestion(basisQuestion)) return null;
  const profiles = extractProfiles(index);
  const scoped = selectScope(question, profiles).filter((p) => Number.isFinite(p.biayaAwalLow));
  if (!scoped.length) return null;

  const q = String(question || '').toLowerCase();
  const mentionedPrograms = detectMentionedPrograms(question);
  const mentionedKeys = new Set(mentionedPrograms.map((p) => p.key));
  const explicitCompared = mentionedPrograms.length >= 2
    ? scoped.filter((p) => mentionedKeys.has(p.key))
    : [];
  const sortedLow = scoped.slice().sort((a, b) => a.biayaAwalLow - b.biayaAwalLow);
  const sortedHigh = scoped.slice().sort((a, b) => b.biayaAwalHigh - a.biayaAwalHigh);
  const cheapestValue = sortedLow[0].biayaAwalLow;
  const mostExpensiveValue = sortedHigh[0].biayaAwalHigh;
  const cheapest = sortedLow.filter((p) => p.biayaAwalLow === cheapestValue);
  const mostExpensive = sortedHigh.filter((p) => p.biayaAwalHigh === mostExpensiveValue);
  const wantsMostExpensive = /\b(termahal|paling\s+mahal|lebih\s+mahal)\b/.test(q);
  const mentionsBd = /\b(bd|(?:bisnis|binis|bisinis)\s+digital)\b/.test(q);
  const bd = scoped.find((p) => p.key === 'bd');

  const basis = 'Saya bandingkan dari biaya awal masuk yang tertulis di dokumen. Biaya semester saya tampilkan terpisah karena dibayar per semester, jadi tidak saya kalikan menjadi total kuliah agar tidak menebak di luar dokumen.';
  const lines = [basis, ''];

  if (explicitCompared.length >= 2) {
    const compared = explicitCompared.slice().sort((a, b) => a.biayaAwalLow - b.biayaAwalLow);
    lines.push(`Perbandingan biaya ${compared.map((p) => `${p.label} (${p.degree})`).join(' dan ')}:`);
    for (const p of compared) lines.push(renderProfileLine(p));

    const cheapestExplicit = compared[0];
    const sameInitialCost = compared.every((p) => p.biayaAwalLow === cheapestExplicit.biayaAwalLow && p.biayaAwalHigh === cheapestExplicit.biayaAwalHigh);
    const sameSemesterCost = compared.every((p) => p.semester === cheapestExplicit.semester);
    lines.push('');
    if (sameInitialCost && sameSemesterCost) {
      lines.push(`Kesimpulan biaya: ${compared.map((p) => p.label).join(' dan ')} setara, dengan biaya awal masuk ${formatRange(cheapestExplicit.biayaAwalLow, cheapestExplicit.biayaAwalHigh)} dan biaya semester ${formatRange(cheapestExplicit.semester, cheapestExplicit.semester)}/semester.`);
    } else if (sameInitialCost) {
      lines.push(`Kesimpulan biaya awal masuk: ${compared.map((p) => p.label).join(' dan ')} setara, yaitu ${formatRange(cheapestExplicit.biayaAwalLow, cheapestExplicit.biayaAwalHigh)}. Perbedaan bisa dilihat dari biaya semester masing-masing jika angkanya berbeda.`);
    } else {
      lines.push(`Yang lebih murah dari biaya awal masuk adalah ${cheapestExplicit.label}, yaitu ${formatRange(cheapestExplicit.biayaAwalLow, cheapestExplicit.biayaAwalHigh)}.`);
    }
    return { answer: lines.join('\n').trim(), profiles: compared };
  }

  if (mentionsBd && bd) {
    const cheaperThan = scoped.filter((p) => p.key !== 'bd' && bd.biayaAwalLow < p.biayaAwalLow);
    const sameAs = scoped.filter((p) => p.key !== 'bd' && bd.biayaAwalLow === p.biayaAwalLow);
    const moreExpensiveThan = scoped.filter((p) => p.key !== 'bd' && bd.biayaAwalLow > p.biayaAwalLow);
    lines.push(`Bisnis Digital (${bd.degree}) biaya awal masuknya ${formatRange(bd.biayaAwalLow, bd.biayaAwalHigh)}.`);
    if (cheaperThan.length) lines.push(`Lebih murah dari: ${cheaperThan.map((p) => `${p.label} (${formatRange(p.biayaAwalLow, p.biayaAwalHigh)})`).join(', ')}.`);
    if (sameAs.length) lines.push(`Setara dengan: ${sameAs.map((p) => `${p.label} (${formatRange(p.biayaAwalLow, p.biayaAwalHigh)})`).join(', ')}.`);
    if (moreExpensiveThan.length) lines.push(`Lebih mahal dari: ${moreExpensiveThan.map((p) => `${p.label} (${formatRange(p.biayaAwalLow, p.biayaAwalHigh)})`).join(', ')}.`);
    lines.push('');
    lines.push('Ringkasan data pembanding:');
    for (const p of sortedLow) lines.push(renderProfileLine(p));
    return { answer: lines.join('\n').trim(), profiles: scoped };
  }

  if (wantsMostExpensive) {
    lines.push(`Yang paling mahal dari data yang tersedia: ${mostExpensive.map((p) => `${p.label} (${p.degree})`).join(', ')} dengan biaya awal masuk ${formatRange(mostExpensiveValue, mostExpensiveValue)}.`);
  } else {
    lines.push(`Yang paling murah dari data yang tersedia: ${cheapest.map((p) => `${p.label} (${p.degree})`).join(', ')} dengan biaya awal masuk ${formatRange(cheapest[0].biayaAwalLow, cheapest[0].biayaAwalHigh)}.`);
  }

  lines.push('');
  lines.push('Rincian pembanding:');
  for (const p of (wantsMostExpensive ? sortedHigh : sortedLow)) lines.push(renderProfileLine(p));
  return { answer: lines.join('\n').trim(), profiles: scoped };
}

module.exports = {
  extractProfiles,
  tryFeeComparisonAnswer,
  tryDetailedFeeAnswer,
  tryRegistrationFeeAnswer,
  tryGeneralFeeQuestionAnswer,
  tryDualDegreeAnswer,
  tryProgramListAnswer,
  tryProgramRecommendationAnswer,
  tryProgramComparisonAnswer,
  tryProgramDefinitionAnswer,
  tryScholarshipAnswer,
  tryCareerAnswer,
  tryContextualMultiProgramFeeAnswer,
  formatRp,
  formatRange
};



