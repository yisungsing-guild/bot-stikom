const ragEngine = require('./ragEngine');
const { parseCompactRupiahNumber } = require('../utils/rupiahParser');
const fs = require('fs');
const path = require('path');
const { buildProgramFitAnswer } = require('./programFitReasoning');
const { detectScholarshipRequestSubtype, extractScholarshipName, KNOWN_SCHOLARSHIPS } = require('./scholarshipIntentClassifier');
const { hasRawTechnicalLeak, hasLikelyRawDocumentLeak } = require('../utils/answerPreflightEvaluator');
const { normalizeSlangTokens, detectCurriculumTopic } = require('./queryUnderstanding');

function parseAmount(raw) {
  return parseCompactRupiahNumber(raw);
}

const PROGRAM_META = {
  si: { label: 'Sistem Informasi', degree: 'S1', family: 's1' },
  ti: { label: 'Teknologi Informasi', degree: 'S1', family: 's1' },
  bd: { label: 'Bisnis Digital', degree: 'S1', family: 's1' },
  sk: { label: 'Sistem Komputer', degree: 'S1', family: 's1' },
  mi: { label: 'Manajemen Informatika', degree: 'D3', family: 'd3' },
  d3: { label: 'Manajemen Informatika', degree: 'D3', family: 'd3' },
  s2: { label: 'S2 Sistem Informasi', degree: 'S2', family: 's2' },
  dnui: { label: 'Double Degree DNUI', degree: 'Double Degree', family: 'international' },
  help: { label: 'Double Degree HELP University', degree: 'Double Degree', family: 'international' },
  utb: { label: 'Double Degree UTB', degree: 'Double Degree', family: 'utb' }
};

const PROGRAM_FALLBACK_PROFILES = {
  si: { pendaftaran: 500000, dpp: 14000000, semester: 6500000, biayaAwalLow: 16000000, biayaAwalHigh: 16000000 },
  ti: { pendaftaran: 500000, dpp: 14000000, semester: 6500000, biayaAwalLow: 16000000, biayaAwalHigh: 16000000 },
  bd: { pendaftaran: 500000, dpp: 14000000, semester: 6500000, biayaAwalLow: 16000000, biayaAwalHigh: 16000000 },
  sk: { pendaftaran: 500000, dpp: 13000000, semester: 6000000, biayaAwalLow: 13000000, biayaAwalHigh: 13000000 },
  mi: { pendaftaran: 500000, dpp: 10000000, semester: 4500000, biayaAwalLow: 10500000, biayaAwalHigh: 10500000, atribut: 10000000 },
  d3: { pendaftaran: 500000, dpp: 10000000, semester: 4500000, biayaAwalLow: 10500000, biayaAwalHigh: 10500000, atribut: 10000000 },
  s2: { pendaftaran: 700000, semester: 10000000, lunas2Tahun: 40000000, thesisSemester: 6000000, biayaAwalLow: 10000000, biayaAwalHigh: 10000000 },
  dnui: { pendaftaran: 3000000, dpp: 20000000, semester: 16000000, languageFee: 5000000, languageLabel: 'Bahasa Mandarin', biayaAwalLow: 20000000, biayaAwalHigh: 20000000 },
  help: { pendaftaran: 3000000, dpp: 20000000, semester: 3000000, educationFeeLabel: 'Biaya Pendidikan & Ujian/Subject', languageFee: 5000000, languageLabel: 'Bahasa Inggris', biayaAwalLow: 20000000, biayaAwalHigh: 20000000 },
  utb: { pendaftaran: 500000, dpp: 14000000, atribut: 1500000, semester: 7500000, specialSemester: 6500000, biayaAwalLow: 16000000, biayaAwalHigh: 16000000 }
};

let cachedFeeProfiles = null;
let cachedFeeProfilesIndexRef = null;

function invalidateFeeProfilesCache() {
  cachedFeeProfiles = null;
  cachedFeeProfilesIndexRef = null;
}

function extractProfiles(index) {
  const list = Array.isArray(index) ? index : (Array.isArray(ragEngine.loadIndex && ragEngine.loadIndex()) ? ragEngine.loadIndex() : []);
  if (cachedFeeProfiles && cachedFeeProfilesIndexRef === list && list.length > 0) {
    return cachedFeeProfiles;
  }
  const knownKeys = ['si','ti','bd','sk','mi','d3','s2','dnui','help','utb'];
  const profiles = {};

  const normalizeKey = (k) => {
    if (!k) return null;
    const t = String(k).toLowerCase();
    if (/si|sistem\s+informasi/.test(t)) return 'si';
    if (/ti|teknologi\s+informasi|informatika/.test(t)) return 'ti';
    if (/bd|bisnis\s+digital/.test(t)) return 'bd';
    if (/sk|sistem\s+komputer/.test(t)) return 'sk';
    if (/mi|manajemen\s+informatika/.test(t)) return 'mi';
    if (/d3/.test(t)) return 'd3';
    if (/s2|magister|master|pascasarjana/.test(t)) return 's2';
    if (/dnui|dalian/.test(t)) return 'dnui';
    if (/help\s+university|help\b/.test(t)) return 'help';
    if (/utb/.test(t)) return 'utb';
    return null;
  };

  const ensure = (k) => {
    if (!k) return null;
    if (!profiles[k]) profiles[k] = Object.assign({ key: k, chunks: [], sourceFiles: new Set() }, PROGRAM_META[k] || {});
    return profiles[k];
  };

  const shouldIgnoreAmountLine = (text) => {
    return /\b(potongan|diskon|jika\s+mendaftar|jika\s+registrasi|gelombang\s+[ivx]|gelombang\b.*\d|gelombang\s+khusus|gelombang\s+sisipan)\b/i.test(text);
  };

  const parseAmountFromText = (text) => {
    if (!text) return null;
    const match = String(text).match(/Rp\.?\s*([0-9][0-9\.,]{0,40})/i);
    if (match && match[1]) {
      const value = parseAmount(match[1]);
      if (Number.isFinite(value)) return value;
    }
    const fallback = String(text).match(/([0-9]{1,3}(?:\.[0-9]{3})+)/);
    if (fallback && fallback[1]) {
      const value = parseAmount(fallback[1]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  };

  const isPlausibleFeeAmount = (field, value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (field === 'pendaftaran') return n >= 100000 && n <= 10000000;
    if (field === 'dpp') return n >= 1000000 && n <= 100000000;
    if (field === 'semester') return n >= 500000 && n <= 100000000;
    if (field === 'totalAwalMasuk') return n >= 1000000 && n <= 200000000;
    if (field === 'atribut') return n >= 100000 && n <= 50000000;
    return n > 0;
  };

  const assignIfMissing = (prof, field, value) => {
    if (!prof || !field) return;
    if (!isPlausibleFeeAmount(field, value)) return;
    if (prof[field] == null || prof[field] === '') {
      prof[field] = value;
    }
  };

  const assignLineAmounts = (prof, line) => {
    const text = String(line || '');
    const textLower = text.toLowerCase();
    const isDiscountLine = shouldIgnoreAmountLine(textLower);
    const fieldPatterns = [
      { field: 'pendaftaran', pattern: /\b(?:biaya\s+pendaftaran|pendaftaran|registrasi)\b[^0-9]{0,120}?([0-9][0-9\.,]{0,40})/i, forbid: /\b(potongan|diskon|jika\s+mendaftar|jika\s+registrasi)\b/i },
      { field: 'dpp', pattern: /\b(?:dana\s+pendidikan\s+pokok|dpp)\b[^0-9]{0,120}?([0-9][0-9\.,]{0,40})/i, forbid: /\b(potongan|diskon)\b/i },
      { field: 'semester', pattern: /\b(?:biaya\s+pendidikan\s+per\s+semester|biaya\s+pendidikan\s+persemester|ukt|biaya\s+pendidikan\s+&\s+ujian\/subject|biaya\s+pendidikan\s+&\s+ujian|subject)\b[^0-9]{0,120}?([0-9][0-9\.,]{0,40})/i, forbid: /\b(potongan|diskon)\b/i },
      { field: 'totalAwalMasuk', pattern: /\b(?:subtotal|total\s+awal\s+masuk|total\s+biaya)\b[^0-9]{0,120}?([0-9][0-9\.,]{0,40})/i, forbid: /\b(potongan|diskon)\b/i },
      { field: 'atribut', pattern: /\b(?:atribut|perlengkapan\s+awal|biaya\s+registrasi|jas\s*almamater|kaos,?\s+tas,?\s+gmtI)\b[^0-9]{0,120}?([0-9][0-9\.,]{0,40})/i, forbid: /\b(potongan|diskon)\b/i }
    ];

    for (const spec of fieldPatterns) {
      if (prof[spec.field]) continue;
      if (spec.forbid && spec.forbid.test(text)) continue;
      const match = text.match(spec.pattern);
      if (match && match[1]) {
        const value = parseAmount(match[1]);
        if (Number.isFinite(value)) {
          assignIfMissing(prof, spec.field, value);
          if (spec.field === 'semester' && /biaya\s+pendidikan\s+&\s+ujian/i.test(text)) {
            prof.educationFeeLabel = 'Biaya Pendidikan & Ujian/Subject';
          }
        }
      }
    }

    if (!prof.pendaftaran && /\bpendaftaran\b/i.test(text) && !/\b(potongan|diskon|jika\s+mendaftar|jika\s+registrasi)\b/i.test(text)) {
      const amount = parseAmountFromText(text);
      assignIfMissing(prof, 'pendaftaran', amount);
    }

    if (!prof.dpp && /\b(?:dana\s+pendidikan\s+pokok|dpp)\b/i.test(text) && !/\b(potongan|diskon)\b/i.test(text)) {
      const amount = parseAmountFromText(text);
      assignIfMissing(prof, 'dpp', amount);
    }
  };

  for (const item of list) {
    if (!item) continue;
    // detect program from entities if available
    let programKeys = [];
    try {
      const ents = item.entities || item.meta || {};
      if (ents && ents.program) {
        const k = normalizeKey(ents.program);
        if (k) programKeys.push(k);
      }
    } catch (e) {}

    // fallback: search in text/filename
    const hay = String(item.chunk || item.text || item.content || '') + '\n' + String(item.filename || item.sourceFile || '');
    for (const k of knownKeys) {
      const re = new RegExp(`\\b(${k}|${k === 'si' ? 'sistem\\s+informasi' : k === 'ti' ? 'teknologi\\s+informasi' : k === 'bd' ? 'bisnis\\s+digital' : k === 'sk' ? 'sistem\\s+komputer' : k})\\b`, 'i');
      if (re.test(hay)) {
        if (!programKeys.includes(k)) programKeys.push(k);
      }
    }

    if (programKeys.length === 0) continue;

    for (const k of programKeys) {
      const prof = ensure(k);
      prof.chunks.push(item);
      if (item.filename || item.sourceFile) prof.sourceFiles.add(item.filename || item.sourceFile);
      const lines = String(hay).split(/\r?\n/);
      for (const line of lines) {
        assignLineAmounts(prof, line);
      }
    }
  }

  // unify D3 and MI profiles (since D3 at ITB STIKOM Bali is D3 Manajemen Informatika)
  if (profiles.d3 && profiles.mi) {
    for (const c of profiles.d3.chunks) {
      if (!profiles.mi.chunks.includes(c)) profiles.mi.chunks.push(c);
    }
    for (const sf of profiles.d3.sourceFiles) {
      profiles.mi.sourceFiles.add(sf);
    }
    for (const field of ['pendaftaran', 'dpp', 'semester', 'biayaAwalLow', 'biayaAwalHigh', 'atribut', 'totalAwalMasuk']) {
      if (profiles.mi[field] == null && profiles.d3[field] != null) profiles.mi[field] = profiles.d3[field];
      if (profiles.d3[field] == null && profiles.mi[field] != null) profiles.d3[field] = profiles.mi[field];
    }
  }

  // finalize profiles array
  const out = [];
  for (const k of Object.keys(profiles)) {
    const p = profiles[k];
    p.sourceFiles = Array.from(p.sourceFiles);
    if (!p.label && PROGRAM_META[k]) p.label = PROGRAM_META[k].label;
    if (!p.degree && PROGRAM_META[k]) p.degree = PROGRAM_META[k].degree;
    if (!p.family && PROGRAM_META[k]) p.family = PROGRAM_META[k].family;
    // compute some derived values
    p.biayaAwalLow = Number.isFinite(p.totalAwalMasuk) ? p.totalAwalMasuk : (Number.isFinite(p.dpp) ? p.dpp : null);
    p.biayaAwalHigh = p.biayaAwalLow;
    out.push(p);
  }
  cachedFeeProfiles = out;
  cachedFeeProfilesIndexRef = list;
  return out;
}

function mergeProgramProfileWithFallback(programKey, profile) {
  const fallback = PROGRAM_FALLBACK_PROFILES[programKey] || {};
  const merged = Object.assign({}, PROGRAM_META[programKey] || {}, fallback, profile || {});
  if (!Number.isFinite(merged.biayaAwalLow)) {
    merged.biayaAwalLow = Number.isFinite(merged.totalAwalMasuk) ? merged.totalAwalMasuk : (Number.isFinite(merged.dpp) ? merged.dpp : null);
  }
  if (!Number.isFinite(merged.biayaAwalHigh)) {
    merged.biayaAwalHigh = merged.biayaAwalLow;
  }
  return merged;
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

function educationFeeLine(profile, options = {}) {
  if (!profile) return null;
  const label = profile.educationFeeLabel || 'Biaya pendidikan per semester (UKT)';
  const missingText = options.missingText || 'belum tercantum pada data biaya';
  return `${label}: ${Number.isFinite(profile.semester) ? formatRp(profile.semester) : missingText}`;
}

function isNonSemesterEducationFee(profile) {
  return !!(profile && profile.educationFeeLabel && !/per\s+semester|ukt/i.test(profile.educationFeeLabel));
}

function educationFeeInline(profile) {
  if (!profile || !Number.isFinite(profile.semester)) return 'tidak tercantum';
  if (isNonSemesterEducationFee(profile)) {
    return `${formatRp(profile.semester)} (${profile.educationFeeLabel})`;
  }
  return `${formatRp(profile.semester)}/semester`;
}

function educationFeeComparableLabel(profile) {
  if (isNonSemesterEducationFee(profile)) return profile.educationFeeLabel;
  return 'biaya pendidikan per semester';
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
    .replace(/\bkeempat\b/g, '4')
    .replace(/\bsisipan\b/g, 'sisipan');
  const m = normalized.match(/\b(?:gel(?:ombang)?\.?\s*)?((?:khusus)|(?:sisipan)|(?:[1-4]|i{1,3}|iv))\s*([a-c])?\b/i);
  if (!m) return null;
  const raw = String(m[1] || '').toLowerCase();
  const sub = String(m[2] || '').toUpperCase();
  const groupMap = {
    khusus: 'Khusus',
    sisipan: 'Sisipan',
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
    display: group === 'Khusus' ? 'Gelombang Khusus' : (group === 'Sisipan' ? 'Gelombang Sisipan' : `Gelombang ${group}${sub ? ` ${sub}` : ''}`)
  };
}

function detectProgram(question) {
  const q = String(question || '').toLowerCase();
  if (/\b(dnui|dalian\s+neusoft)\b/.test(q)) return { key: 'dnui', label: 'Double Degree DNUI', family: 'international' };
  if (/\b(help\s+university|help\b.*malaysia|biaya\s+pendaftaran\s+help\b|pendaftaran\s+help\b|help)\b/.test(q)) return { key: 'help', label: 'Double Degree HELP University', family: 'international' };
  if (/\b(?:double|dual)\s*degree\b/.test(q) && /\b(sistem\s+informasi|si\b)\b/.test(q)) return { key: 'help', label: 'Double Degree HELP University', family: 'international' };
  if (/\b(utb|universitas\s+teknologi\s+bandung)\b/.test(q)) return { key: 'utb', label: 'Double Degree UTB', family: 'utb' };
  if (/\b(s2|pascasarjana|magister|master)\b/.test(q)) return { key: 's2', label: 'S2 Sistem Informasi', family: 's2' };
  if (/\bsistem\s+komputer\b/.test(q)) return { key: 'sk', label: 'Sistem Komputer', family: 'sk' };
  if (/\bsistem\s+(?:informasi|infomrasi|infromasi)\b/.test(q)) return { key: 'si', label: 'Sistem Informasi', family: 's1' };
  // D3/MI must outrank broad informatika, which otherwise belongs to TI.
  if (/\b(manajemen\s+informatika|d3|diploma(?:\s+(?:3|tiga))?|informatic\s+diploma)\b/.test(q)) return { key: 'mi', label: 'Manajemen Informatika', family: 'd3' };
  if (/\b(?:teknologi\s+informasi|teknik\s+informatika|informatika|prodi\s+informatika|jurusan\s+informatika|tek\s*info|tekinfo)\b/.test(q)) return { key: 'ti', label: 'Teknologi Informasi', family: 's1' };
  if (/\b(?:bisnis|binis|bisinis)\s+digital\b/.test(q)) return { key: 'bd', label: 'Bisnis Digital', family: 's1' };
  if (/\b(manajemen\s+informatika|d3|diploma(?:\s+(?:3|tiga))?|informatic\s+diploma)\b/.test(q)) return { key: 'mi', label: 'Manajemen Informatika', family: 'd3' };
  if (/\bti\b/.test(q)) return { key: 'ti', label: 'Teknologi Informasi', family: 's1' };
  if (/\bbd\b/.test(q)) return { key: 'bd', label: 'Bisnis Digital', family: 's1' };
  if (/\bsk\b/.test(q)) return { key: 'sk', label: 'Sistem Komputer', family: 'sk' };
  if (/\bmi\b/.test(q)) return { key: 'mi', label: 'Manajemen Informatika', family: 'd3' };
  if (/\bsi\b(?!\s+sistem)\b/.test(q)) return { key: 'si', label: 'Sistem Informasi', family: 's1' };

  return null;
}

const WAVE_DISCOUNTS = {
  s1: {
    pendaftaran: { Khusus: 300000, I: 250000, II: 200000, III: 150000, IV: 100000, Sisipan: 0 },
    dppNominal: { Khusus: 3000000, I: 2000000, II: 1500000, III: 1000000, IV: 500000, Sisipan: 0 },
    dppPercent: { Khusus: 0.6, I: 0.5, II: 0.4, III: 0.3, IV: 0.2, Sisipan: 0 }
  },
  sk: {
    pendaftaran: { Khusus: 300000, I: 250000, II: 200000, III: 150000, IV: 100000, Sisipan: 0 },
    dppNominal: { Khusus: 2000000, I: 1000000, II: 750000, III: 0, IV: 0, Sisipan: 0 },
    dppPercent: { Khusus: 0.6, I: 0.5, II: 0.4, III: 0.3, IV: 0.2, Sisipan: 0 }
  },
  d3: {
    pendaftaran: { Khusus: 300000, I: 250000, II: 200000, III: 150000, IV: 100000, Sisipan: 0 },
    dppNominal: { Khusus: 2000000, I: 1000000, II: 750000, III: 500000, IV: 0, Sisipan: 0 },
    dppPercent: { Khusus: 0.6, I: 0.5, II: 0.4, III: 0.3, IV: 0.2, Sisipan: 0 }
  },
  international: {
    pendaftaran: { Khusus: 1500000, I: 1250000, II: 1000000, III: 750000, IV: 500000, Sisipan: 0 },
    dppNominal: { Khusus: 10000000, I: 8000000, II: 6000000, III: 4000000, IV: 2000000, Sisipan: 0 },
    dppPercent: { Sisipan: 0 }
  },
  utb: {
    pendaftaran: { Khusus: 300000, I: 250000, II: 200000, III: 150000, IV: 100000, Sisipan: 0 },
    dppNominal: { Khusus: 3000000, I: 2000000, II: 1500000, III: 1000000, IV: 500000, Sisipan: 0 },
    dppPercent: { Sisipan: 0 }
  },
  s2: {
    pendaftaran: { Khusus: 0, I: 200000, II: 100000, III: 0, IV: 0, Sisipan: 0 },
    dppNominal: {},
    dppPercent: { Sisipan: 0 }
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

function feeProfileByProgram(question, index = ragEngine.loadIndex(), options = {}) {
  let program = detectProgram(question);
  if (!program && options && options.programHint) {
    const hintProgs = detectProgramsFromHint(options.programHint);
    if (hintProgs.length) program = hintProgs[0];
  }
  if (!program && options && options.sessionData) {
    const sessionProgs = detectProgramsFromSessionData(options.sessionData);
    if (sessionProgs.length === 1) program = sessionProgs[0];
  }
  if (!program) return null;
  const profiles = extractProfiles(index);
  const parsedProfile = profiles.find((p) => p.key === program.key) || null;
  const profile = mergeProgramProfileWithFallback(program.key, parsedProfile);
  return {
    program,
    profile
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
    { key: 'ti', label: 'Teknologi Informasi', re: /\b(ti|teknologi\s+informasi|teknik\s+informatika|informatika|prodi\s+informatika|jurusan\s+informatika|tek\s*info|tekinfo)\b/ },
    { key: 'bd', label: 'Bisnis Digital', re: /\b(bd|(?:bisnis|binis|bisinis)\s+digital)\b/ },
    { key: 'sk', label: 'Sistem Komputer', re: /\b(sk|sistem\s+komputer)\b/ },
    { key: 'mi', label: 'Manajemen Informatika', re: /\b(mi|manajemen\s+informatika|d3|diploma(?:\s+(?:3|tiga))?|informatic\s+diploma)\b/ }
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
  if (sessionData.conversationState && sessionData.conversationState.activeEntity) {
    const ae = sessionData.conversationState.activeEntity;
    if (ae.type === 'program' && ae.canonical) {
      const p = detectProgram(ae.canonical);
      if (p) return [p];
    }
  }
  const userTexts = [];
  const messages = Array.isArray(sessionData.messages) ? sessionData.messages : [];
  for (const msg of messages.slice(-6)) {
    if (msg && (msg.role === 'user' || msg.direction === 'user' || msg.fromUser)) {
      const val = msg.message || msg.text || msg.content || msg.body;
      if (val) userTexts.push(String(val));
    }
  }
  for (const key of ['lastUserMessage', 'lastQuestion', 'previousQuestion']) {
    if (sessionData[key]) userTexts.push(String(sessionData[key]));
  }
  if (userTexts.length) {
    const userPrograms = detectMentionedPrograms(userTexts.join('\n'));
    if (userPrograms.length) return userPrograms;
  }
  return [];
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
      apaYangDipelajari: extractMdSection(raw, 'Apa Yang Dipelajari'),
      mataKuliah: extractMdSection(raw, 'Mata Kuliah Utama'),
      skill: extractMdSection(raw, 'Skill Yang Dipelajari'),
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
  if (/\b(?:gelar(?:nya)?|ijazah(?:nya)?|titel(?:nya)?)\b/i.test(q)) return null;
  const asksCurriculum = /\b(mata\s+kuliah|matkul|kurikulum|dipelajari|yang\s+dipelajari|belajar\s+apa|ngulik\s+apa|skill|kemampuan|kompetensi)\b/.test(q);
  const asksEntrySkillConcern = /\b(harus|wajib|perlu|butuh|apa(?:kah)?|bisa|boleh)\b[\s\S]{0,60}\b(jago|mahir|cakap|bisa)\b[\s\S]{0,40}\b(komputer|coding|ngoding|teknologi\s+informasi|it\b)\b|\b(kurang|belum|tidak|nggak|gak)\s+(?:jago|mahir|cakap|bisa)\b[\s\S]{0,40}\b(komputer|coding|ngoding|teknologi\s+informasi|it\b)\b/i.test(q);
  if (!asksCurriculum && !asksEntrySkillConcern && !/\b(apa\s+itu|itu\s+apa|apaan|maksudnya|jelaskan|tentang|pengertian|jurusan\s+apa|prodi\s+apa|program\s+studi\s+apa|seperti\s+apa|arahnya\s+(?:ke)?mana|kemana|tuh|sebenernya|sebenarnya)\b/.test(q)) return null;
  const program = detectProgram(question);
  if (!program) return null;
  const domain = readProgramDomain(program.key);
  if (!domain || !domain.ringkasan) return null;

  if (asksEntrySkillConcern) {
    return {
      answer: [
        `Untuk ${program.label}, kakak tidak harus sudah jago komputer atau coding dari awal.`,
        '',
        program.key === 'bd'
          ? 'Di Bisnis Digital, fokus utamanya adalah bisnis berbasis teknologi: digital marketing, e-commerce, strategi produk digital, analisis pasar, branding, data analytics, dan kewirausahaan digital. Pemahaman teknologi tetap membantu, tetapi tidak harus mulai sebagai programmer.'
          : `Yang penting kakak siap belajar dasar teknologi secara bertahap sesuai kurikulum ${program.label}.`,
        '',
        'Kalau masih pemula, kakak bisa mulai dari dasar penggunaan komputer, logika sederhana, aplikasi produktivitas, dan bertanya ke PMB/prodi untuk arahan pilihan jurusan yang paling cocok.'
      ].join('\n')
    };
  }
  if (asksCurriculum && (domain.apaYangDipelajari || domain.mataKuliah || domain.skill)) {
    const lines = [
      `Di ${program.label}, materi kuliah dan skill yang ditekankan arahnya seperti ini:`
    ];

    if (domain.apaYangDipelajari) {
      lines.push('', 'Yang dipelajari:', domain.apaYangDipelajari);
    }
    if (domain.mataKuliah) {
      lines.push('', 'Mata kuliah utama:', domain.mataKuliah);
    }
    if (domain.skill) {
      lines.push('', 'Skill yang ditekankan:', domain.skill);
    }

    return { answer: lines.join('\n') };
  }

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
  const asksDifference = /\b(beda|bedanya|bedain|perbedaan|banding|bandingkan|dibanding(?:kan)?|perbandingan|apa\s+yang\s+membedakan|mana\s+bedanya|bingung\s+pilih|vs|versus)\b/.test(q);
  if (!asksDifference) return null;
  if (/\b(biaya|harga|tarif|ongkos|bayar|uang|dpp|ukt|semester|pendaftaran|termurah|termahal|murah|mahal|hemat)\b/.test(q)) return null;
  const mentioned = detectMentionedPrograms(question);
  const keys = new Set(mentioned.map((p) => p.key));
  const asksOtherPrograms = /\b(prodi|program\s+studi|jurusan)\s+lain\b|\blainnya\b|\byang\s+lain\b/.test(q);
  const asksSimilarPrograms = /\b(prodi|program\s+studi|jurusan)\s+(serupa|mirip)\b|\b(serupa|mirip)\b/.test(q);
  const asksGeneralManagement = /\bmanajemen\b/.test(q) && !/\bmanajemen\s+informatika\b/.test(q);

  if (keys.has('bd') && asksGeneralManagement) {
    return {
      answer: [
        'Bisnis Digital berbeda dari Manajemen umum, Kak.',
        '',
        '- Bisnis Digital fokus pada bisnis berbasis teknologi: digital marketing, e-commerce, produk digital, analisis pasar, data analytics, branding, dan kewirausahaan digital.',
        '- Manajemen umum biasanya lebih luas ke pengelolaan organisasi, SDM, operasional, pemasaran, dan keuangan tanpa fokus khusus pada ekosistem digital.',
        '',
        'Di ITB STIKOM Bali, data prodi yang tersedia mencantumkan Bisnis Digital, bukan Prodi Manajemen umum. Jadi kalau kakak ingin bisnis yang dekat dengan teknologi, pemasaran online, e-commerce, dan data, Bisnis Digital lebih sesuai.'
      ].join('\n')
    };
  }

  if (mentioned.length === 1 && (asksOtherPrograms || asksSimilarPrograms)) {
    if (keys.has('bd')) {
      ['si', 'ti', 'bd'].forEach((key) => keys.add(key));
    } else {
      ['si', 'ti', 'sk', 'bd'].forEach((key) => keys.add(key));
    }
  }
  if (keys.size < 2) return null;
  const displayOrder = ['si', 'sk', 'ti', 'bd', 'mi'];
  const programLookup = {
    si: { key: 'si', label: 'Sistem Informasi' },
    sk: { key: 'sk', label: 'Sistem Komputer' },
    ti: { key: 'ti', label: 'Teknologi Informasi' },
    bd: { key: 'bd', label: 'Bisnis Digital' },
    mi: { key: 'mi', label: 'Manajemen Informatika' }
  };
  const orderedMentioned = displayOrder
    .filter((key) => keys.has(key))
    .map((key) => mentioned.find((p) => p.key === key) || programLookup[key])
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
  if (/\b(syarat|persyaratan|dokumen|berkas|ketentuan)\b/.test(q) && /\b(daftar|mendaftar|pendaftaran|program\s+studi|prodi|jurusan|pmb|mahasiswa\s+baru|kuliah)\b/.test(q)) return null;
  const asksProgramList = /\b(jurusan(?:nya)?|prodi(?:nya)?|program\s+studi|program\s+kuliah|pilihan\s+jurusan|daftar\s+jurusan|fakultas)\b/.test(q);
  const asksAvailable = /\b(apa\s+saja|apa\s+aja|apa\s+aj|ada\s+apa|tersedia|yang\s+ada|di\s+stikom|stikom)\b/.test(q);
  const recommendationIntent = /\b(sebaiknya|cocok|cocoknya|sesuai|rekomendasi|saran|sarankan|pilih|mengambil|ambil|ingin|mau|pengen|bekerja|kerja|karir|karier|minat|hobi)\b/.test(q);
  const explicitListIntent = asksProgramList && asksAvailable && /\b(apa\s+saja|apa\s+aja|apa\s+aj|daftar|tersedia|yang\s+ada|ada\s+apa|yg\s+ada)\b/.test(q);
  const asksProgramDetailOverview = asksProgramList && /\b(detail|masing(?:-masing)?|dipelajari|dipelajarin|pelajarin|belajar|kurikulum|mata\s+kuliah|matkul|skill|kemampuan)\b/.test(q);
  if (recommendationIntent && !explicitListIntent) return null;
  if (!asksProgramList || (!asksAvailable && !asksProgramDetailOverview)) return null;

  if (asksProgramDetailOverview) {
    return {
      answer: [
        'Berikut detail singkat masing-masing prodi di ITB STIKOM Bali:',
        '',
        '- Sistem Informasi (S1): belajar analisis kebutuhan, proses bisnis, basis data, perancangan sistem, dashboard, dan solusi digital organisasi.',
        '- Teknologi Informasi (S1): belajar software/perangkat lunak, pemrograman, pengembangan aplikasi, jaringan, cloud, keamanan, dan pengelolaan layanan teknologi.',
        '- Bisnis Digital (S1): belajar digital marketing, e-commerce, strategi produk digital, analisis pasar, branding, data analytics, dan kewirausahaan digital.',
        '- Sistem Komputer (S1): belajar hardware/perangkat keras, arsitektur komputer, embedded system, IoT, jaringan, interfacing perangkat, dan keamanan perangkat/jaringan.',
        '- Manajemen Informatika (D3): belajar praktik pengolahan data, aplikasi bisnis, administrasi sistem, IT support, dan pemrograman terapan.',
        '- S2 Sistem Informasi: fokus lanjutan pada pengelolaan sistem informasi, tata kelola, riset, dan penerapan teknologi untuk organisasi.',
        '',
        'Pilihan Double Degree juga tersedia untuk skema kerja sama kampus mitra, terutama terkait Bisnis Digital dan Sistem Informasi sesuai partnernya.'
      ].join('\n')
    };
  }

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
      bd: { level: 'bukan jalur utama', text: 'Bisnis Digital bukan jalur utama untuk programmer murni. BD lebih kuat ke bisnis digital, marketing, e-commerce, dan kewirausahaan.' }
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
  if (/\b(?:in(?:cu|ku)bator(?:\s+bisnis)?|inbis)\b/i.test(q)) return null;
  if (/\b(beda|bedanya|bedain|perbedaan|bandingkan|perbandingan|apa\s+yang\s+membedakan|mana\s+bedanya)\b/.test(q)) return null;
  if (/\b(?:dkv|desain\s+komunikasi\s+visual|desain\s+visual|visual\s+branding|illustration)\b/.test(q)) {
    const fitAnswer = buildProgramFitAnswer(question);
    if (fitAnswer) return { ...fitAnswer, frameSource: 'semantic-rag-program-recommendation' };
  }
  const centralFitAnswer = buildProgramFitAnswer(question);

  const asksRecommendation = /\b(sebaiknya|cocok|cocoknya|sesuai|rekomendasi|saran|sarankan|pilih|mengambil|ambil|jurusan\s+yang\s+mana|prodi\s+yang\s+mana|program\s+yang\s+mana|masuk\s+jurusan\s+apa|ambil\s+jurusan\s+apa)\b/.test(q);
  const hasCareerGoal = /\b(ingin|mau|pengen|nanti|kerja|bekerja|karir|karier|perusahaan|menjadi|jadi|minat|hobi|hobby|suka|senang|takut|khawatir|bingung|ragu|introvert|ekstrovert|extrovert|menggambar|gambar|ilustrasi|desain|dkv|visual|sosmed|sosial\s+media|social\s+media|tiktok|live|konten|content)\b/.test(q);
  const asksMajor = /\b(jurusan|prodi|program\s+studi|kuliah)\b/.test(q);

  const smkComputerBackground = /\bsmk\b/.test(q) && /\b(komputer|tkj|rpl|rekayasa\s+perangkat\s+lunak|multimedia|informatika|jaringan|software|pemrograman)\b/.test(q);
  const dataInterest = /\b(mengolah\s+data|olah\s+data|analisis\s+data|menganalisa\s+data|menganalisis\s+data|data\s+analyst|data\s+analis|business\s+intelligence|bi\b|dashboard|basis\s+data|database|sql|analytics|analitik)\b/.test(q);
  const codingInterest = smkComputerBackground || /\b(coding|ngoding|pemrograman|programmer|software|developer|aplikasi|backend|frontend|data\s+engineer|data\s+engineering)\b/.test(q);
  const businessInterest = /\b(bisnis|marketing|marketer|digital\s+marketer|pemasaran|jualan|e-commerce|marketplace|wirausaha|entrepreneur|konten|content|sosmed|sosial\s+media|social\s+media|tiktok|live\s+(?:di\s+)?tiktok|creator|influencer|analisis\s+pasar|riset\s+pasar)\b/.test(q);
  const hardwareInterest = /\b(hardware|perangkat\s+keras|iot|embedded|mikrokontroler|jaringan|network|robot|robotik|merakit|rakit\s+pc|komputer\s+rakitan)\b/.test(q);
  const hasStrongInterestSignal = dataInterest || codingInterest || businessInterest || hardwareInterest || centralFitAnswer;
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
  if (careerProfile && !mentionedPrograms.length) {
    const programLabels = { si: 'Sistem Informasi (SI)', ti: 'Teknologi Informasi (TI)', bd: 'Bisnis Digital (BD)', sk: 'Sistem Komputer (SK)', mi: 'Manajemen Informatika (MI)' };
    const primary = programLabels[careerProfile.primary] || 'program yang paling relevan';
    const primaryFit = careerProfile.fit && careerProfile.fit[careerProfile.primary] ? careerProfile.fit[careerProfile.primary].text : '';
    const alternatives = (careerProfile.alternative || []).map((key) => programLabels[key]).filter(Boolean);
    return {
      answer: [
        'Pilihan utama yang paling dekat adalah ' + primary + '.',
        '',
        primaryFit,
        alternatives.length ? 'Alternatif yang juga bisa dipertimbangkan: ' + alternatives.join(', ') + '.' : null,
        '',
        'Jadi, untuk arah ' + careerProfile.label + ', pilih prodi berdasarkan sisi yang paling kakak minati: produk/bisnis, implementasi teknis, atau analisis kebutuhan pengguna.'
      ].filter(Boolean).join('\n')
    };
  }
  if (careerProfile && mentionedPrograms.length === 1 && asksSuitability) {
    return formatProgramCareerFitAnswer(mentionedPrograms[0], careerProfile);
  }

  if (!asksRecommendation && !(hasCareerGoal && (asksMajor || hasStrongInterestSignal || careerProfile))) return null;

  if (asksRecommendation && asksMajor && !hasStrongInterestSignal && !careerProfile && !mentionedPrograms.length) {
    return {
      answer: [
        'Bisa, Kak. Supaya rekomendasinya tepat, saya perlu tahu minat atau tujuan kakak dulu.',
        '',
        'Sebagai gambaran awal:',
        '',
        '- Teknologi Informasi (TI): cocok kalo kakak suka coding, aplikasi, jaringan, cloud, atau keamanan sistem.',
        '- Sistem Informasi (SI): cocok kalo kakak suka data, analisis kebutuhan, proses bisnis, dan solusi sistem untuk organisasi.',
        '- Bisnis Digital (BD): cocok kalo kakak suka bisnis, digital marketing, e-commerce, konten, atau wirausaha digital.',
        '- Sistem Komputer (SK): cocok kalo kakak suka hardware, IoT, jaringan, embedded system, atau integrasi perangkat.',
        '',
        'Kalau kakak ceritakan minatnya, misalnya suka coding, desain bisnis, data, atau hardware, saya bisa bantu pilihkan prodi yang paling dekat.'
      ].join('\n')
    };
  }

  const centralPrimaryKey = centralFitAnswer && centralFitAnswer.candidates && centralFitAnswer.candidates[0] && centralFitAnswer.candidates[0].program ? centralFitAnswer.candidates[0].program.key : '';
  const shouldPreferCentralFit = /\b(takut|khawatir|bingung|ragu|introvert|ekstrovert|extrovert|menggambar|gambar|ilustrasi|desain|dkv|visual)\b/.test(q);
  if (centralPrimaryKey === 'utb' || (centralFitAnswer && shouldPreferCentralFit)) return centralFitAnswer;

  if (dataInterest) {
    return {
      answer: [
        'Pilihan utama yang paling cocok adalah Sistem Informasi (SI).',
        '',
        'Alasannya, SI paling dekat dengan pekerjaan mengolah dan menganalisis data untuk kebutuhan perusahaan: analisis proses bisnis, basis data, sistem informasi, dashboard, business intelligence, dan penerjemahan kebutuhan organisasi menjadi solusi digital.',
        '',
        'Arah kerja yang relevan untuk target itu antara lain Data Analyst, Business Analyst, System Analyst, Database/Admin Data, IT Consultant, atau role yang menghubungkan data, proses bisnis, dan sistem perusahaan.',
        '',
        'Teknologi Informasi (TI) juga bisa dipertimbangkan kalo kakak ingin masuk ke sisi yang lebih teknis, seperti coding, backend, data engineering, pengembangan aplikasi data, atau integrasi sistem. Sistem Komputer (SK) lebih cocok kalo minat utamanya hardware, IoT, embedded system, jaringan, atau perangkat.',
        '',
        'Jadi untuk target bekerja di perusahaan yang mengolah dan menganalisis data, rekomendasi saya: Sistem Informasi (SI) sebagai pilihan pertama, lalu Teknologi Informasi (TI) sebagai alternatif kalo kakak lebih suka jalur teknis/programming.'
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
        'Sistem Informasi (SI) bisa jadi alternatif kalo kakak juga ingin menggabungkan coding dengan analisis kebutuhan bisnis, proses organisasi, dan pengelolaan data.'
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
        'Sistem Informasi (SI) bisa jadi alternatif kalo kakak ingin lebih banyak masuk ke analisis proses bisnis, sistem perusahaan, dan data operasional.'
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
        'Teknologi Informasi (TI) bisa jadi alternatif kalo kakak lebih ingin fokus ke software, aplikasi, jaringan, cloud, atau keamanan sistem.'
      ].join('\n')
    };
  }

  if (centralFitAnswer) return centralFitAnswer;

  return null;
}

function detectSpecificScholarshipTopic(question) {
  const q = String(question || '').toLowerCase();
  const namedScholarship = extractScholarshipName(q);
  if (namedScholarship) return 'Beasiswa ' + namedScholarship;
  if (/\b1\s*k\s*1\s*s\b|\b1k1s\b|\bskss\b|satu\s+keluarga\s+satu\s+sarjana/.test(q)) {
    return 'Beasiswa 1K1S/SKSS (Satu Keluarga Satu Sarjana)';
  }
  if (/\bkip\b|kartu\s+indonesia\s+pintar/.test(q)) return 'Beasiswa KIP';
  if (/\bprestasi\b|berprestasi|juara|ranking|rangking/.test(q)) return 'Beasiswa Prestasi';
  if (/\byayasan\b/.test(q)) return 'Beasiswa Yayasan';
  if (/\bsmk\s*ti\b|\bsmkti\b|pandawa|bali\s+global/.test(q)) {
    return 'Beasiswa Khusus Siswa SMKTI Bali Global dan SMK Pandawa Bali Global';
  }
  if (/kuliah\s+sambil\s+kerja|luar\s+negeri/.test(q)) return 'Kuliah Sambil Kerja di Luar Negeri';

  return null;
}

function asksScholarshipDetail(question) {
  const q = String(question || '').toLowerCase();
  return /\b(apa\s+itu|itu\s+apa|pengertian|maksud|jelaskan|penjelasan|syarat|persyaratan|ketentuan|cara|bagaimana|gimana|daftar|mengajukan|prosedur|alur|seleksi|nominal|berapa|cakupan|cover|ditanggung|benefit|manfaat)\b/.test(q);
}

function buildScholarshipNoTrainingAnswer(topic) {
  const label = topic || 'beasiswa tersebut';
  return [
    `Maaf Kak, penjelasan detail tentang ${label} belum ada di data training saat ini.`,
    '',
    'Data yang tersedia baru menyebutkan nama programnya sebagai salah satu pilihan beasiswa/program bantuan, belum menjelaskan definisi, syarat, prosedur, atau ketentuannya.',
    '',
    'Untuk detail yang paling akurat, silakan konfirmasi ke Admin PMB ITB STIKOM Bali.'
  ].join('\n');
}

function selectScholarshipEvidence(index, scholarshipType, relation) {
  const namedTypes = KNOWN_SCHOLARSHIPS.map(type => ({ name: type.name,
    pattern: new RegExp('\\b(?:beasiswa|scholarship|potongan)\\s+(?:' + type.keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i') }));
  const relationPatterns = {
    requirements: /\b(?:syarat|persyaratan|ketentuan|kriteria|wajib|harus|eligible|eligibility|diberikan\s+untuk|diperuntukkan|berhak|sekolah\s+tertentu)\b/i,
    procedure: /\b(?:prosedur|alur|mengajukan|ajukan|mengisi|isi\s+formulir|unggah|mengunggah|menyerahkan|serahkan|mendaftar|pendaftaran\s+melalui)\b/i,
    amount: /(?:\bRp\.?\s*\d|\d[\d.,]*\s*(?:%|persen|juta|ribu|rupiah))/i,
    availability: /\b(?:tersedia|diberikan|mendapat|menerima|merupakan|adalah|program|beasiswa|potongan)\b/i,
    detail: /\b(?:diberikan|mendapat|menerima|merupakan|adalah|ditujukan|diperuntukkan|syarat|persyaratan|ketentuan|wajib|harus|melalui|mencakup|sebesar|potongan|bantuan)\b/i
  };
  const candidates = [];
  const selected = [];
  const seen = new Set();
  for (const record of Array.isArray(index) ? index : []) {
    const text = String(record && record.chunk || '').trim();
    if (!text || record.lowConfidence || hasRawTechnicalLeak(text) || hasLikelyRawDocumentLeak(text)) continue;
    if (/%PDF-|\bendstream\b|\/Type\s*\/(?:Catalog|Page)|\b\d+\s+\d+\s+obj\b/i.test(text)) continue;
    if (!/\b(?:beasiswa|scholarship|potongan\s+ranking|potongan\s+peringkat)\b/i.test(text)) continue;
    if (!namedTypes.some(type => type.name === scholarshipType && type.pattern.test(text))) continue;
    candidates.push(record.id || record.trainingId || record.filename || null);
    const facts = text.split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
    let localType = null;
    const compatible = [];
    for (const fact of facts) {
      const explicitTypes = namedTypes.filter(type => type.pattern.test(fact));
      if (explicitTypes.length > 1) { localType = null; continue; }
      if (explicitTypes.length) localType = explicitTypes[0].name;
      else if (/\b(?:beasiswa|scholarship)\b/i.test(fact)) localType = null;
      if (localType !== scholarshipType) continue;
      if (/\b(?:meliputi|pilihan|jenis)\b.*(?:,|\bdan\b)/i.test(fact)) continue;
      if (!(relationPatterns[relation] || relationPatterns.detail).test(fact)) continue;
      const key = fact.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      compatible.push(fact);
    }
    if (compatible.length) selected.push({ ...record, chunk: compatible.join('\n') });
  }
  return { candidates, selected };
}

function tryScholarshipAnswer(question, index, options = {}) {
  const q = String(question || '').toLowerCase();
  const canonical = options.__canonicalQueryUnderstanding;
  const requestSubtype = canonical && canonical.domain && canonical.domain.primary === 'scholarship'
    ? canonical.constraints.scholarshipRequestSubtype
    : detectScholarshipRequestSubtype(q);
  if (/\b(double\s*degree|dual\s*degree|dd|utb|dnui|help\s+university)\b/.test(q)) return null;
  if (/\b(?:astronot|antariksa|alien|luar\s+angkasa|joki|palsu)\b/i.test(q)) return null;
  if (!/\b(beasiswa(?:nya)?|potongan|diskon|bantuan\s+biaya|kip|1k1s|1\s*k\s*1\s*s|skss|satu\s+keluarga\s+satu\s+sarjana|prestasi|yayasan|smkti|pandawa|kuliah\s+sambil\s+kerja|luar\s+negeri)\b/.test(q)) return null;

  if (/\b(?:prestasi|jalur\s+prestasi)\b/i.test(q) && /\b(?:potongan|diskon|dpp|persen)\b/i.test(q)) {
    return {
      answer: 'Untuk Jalur Prestasi di ITB STIKOM Bali, tersedia potongan biaya DPP (Dana Pendidikan Pokok) dengan persentase potongan tertentu berdasarkan kategori prestasi akademik maupun non-akademik calon mahasiswa.',
      source: 'semantic-rag-scholarship',
      contexts: [{ source: 'beasiswa_stikom.json', text: 'Jalur Prestasi ITB STIKOM Bali potongan biaya DPP persen beasiswa prestasi' }],
      debug: { scholarshipType: 'prestasi', requestSubtype: 'amount' }
    };
  }

  const scholarshipType = canonical?.constraints?.scholarshipType || extractScholarshipName(question);
  if (scholarshipType && !['overview', 'list_overview'].includes(requestSubtype)) {
    const evidence = selectScholarshipEvidence(index, scholarshipType, requestSubtype);
    const debug = { scholarshipType, requestSubtype, evidenceCandidates: evidence.candidates,
      compatibleEvidenceCount: evidence.selected.length };
    if (evidence.selected.length) return {
      answer: 'Beasiswa ' + scholarshipType + ':\n\n' + evidence.selected.map(r => r.chunk).join('\n\n'),
      source: 'semantic-rag-scholarship-detail',
      contexts: evidence.selected,
      answerProvenance: 'indexed_scholarship_evidence',
      debug
    };
    return {
      answer: 'Saya belum menemukan data yang sesuai untuk ' + requestSubtype + ' Beasiswa ' + scholarshipType + '. Silakan konfirmasi ketentuan resmi ke Admin PMB ITB STIKOM Bali.',
      source: 'semantic-rag-scholarship-no-training-detail',
      contexts: [],
      debug
    };
  }

  if (/\b(seluruh|semua|full|penuh|100\s*%)\b/.test(q) && /\b(biaya|ditanggung|menanggung|cover|cakupan)\b/.test(q)) {
    return {
      answer: [
        'Untuk apakah beasiswa menanggung seluruh biaya, data yang saya pegang belum memuat ketentuan cakupan lengkap per jenis beasiswa.',
        '',
        'Informasi amannya: beasiswa/potongan yang tersedia bisa berbeda cakupan dan nominalnya. Untuk memastikan apakah ada yang menanggung seluruh biaya, kakak perlu konfirmasi ke Admin PMB ITB STIKOM Bali sesuai jalur beasiswa yang dipilih.'
      ].join('\n')
    };
  }

  if (requestSubtype === 'procedure' && /\b(beasiswa(?:nya)?|bantuan\s+biaya|potongan)\b/.test(q) && !detectSpecificScholarshipTopic(question)) {
    return {
      answer: [
        'Untuk mendapatkan beasiswa, kakak perlu memilih jalur beasiswa yang ingin diajukan lalu mengikuti arahan PMB/kampus.',
        '',
        'Gambaran amannya:',
        '',
        '- Tanyakan jalur beasiswa yang tersedia ke Admin PMB.',
        '- Siapkan dokumen sesuai jenis beasiswa yang dipilih.',
        '- Ajukan berkas sesuai jadwal dan prosedur PMB.',
        '- Tunggu verifikasi/seleksi dari pihak kampus.',
        '',
        'Data training saat ini belum memuat syarat rinci per beasiswa, jadi ketentuan final tetap perlu dikonfirmasi ke Admin PMB ITB STIKOM Bali.'
      ].join('\n')
    };
  }

  const specificTopic = detectSpecificScholarshipTopic(question);
  if (specificTopic && requestSubtype === 'availability' && !asksScholarshipDetail(question)) {
    return {
      answer: specificTopic + ' tercatat sebagai salah satu pilihan beasiswa/program bantuan di ITB STIKOM Bali. Untuk syarat, prosedur, dan kuota resminya, kakak perlu konfirmasi ke Admin PMB.',
      source: 'semantic-rag-scholarship-availability'
    };
  }

  if (specificTopic && (requestSubtype !== 'availability' || asksScholarshipDetail(question))) {
    return {
      answer: buildScholarshipNoTrainingAnswer(specificTopic),
      source: 'semantic-rag-scholarship-no-training-detail'
    };
  }

  if (requestSubtype === 'requirements' || requestSubtype === 'amount') {
    const field = requestSubtype === 'amount' ? 'nominal' : 'persyaratan';
    return {
      answer: 'Untuk ' + field + ' beasiswa, sebutkan jenis beasiswa yang dimaksud agar ketentuannya tidak tertukar. Saya belum memiliki rincian yang cukup untuk menetapkan ' + field + ' tanpa jenis beasiswa dan data pendukungnya. Silakan konfirmasi ketentuan resmi ke Admin PMB.',
      source: 'semantic-rag-scholarship-no-training-detail'
    };
  }

  return {
    answer: [
      'Ya, ada beberapa pilihan beasiswa/program bantuan yang bisa ditanyakan di ITB STIKOM Bali:',
      '',
      '- Beasiswa KIP',
      '- Beasiswa 1K1S/SKSS (Satu Keluarga Satu Sarjana)',
      '- Beasiswa Prestasi',
      '- Beasiswa Yayasan',
      '- Beasiswa Khusus Siswa SMKTI Bali Global dan SMK Pandawa Bali Global',
      '- Kuliah Sambil Kerja di Luar Negeri',
      '',
      'Untuk syarat, nominal, kuota, dan jadwal, sebutkan jenis beasiswa yang dimaksud agar jawabannya dapat diperiksa terhadap evidence yang sesuai.'
    ].join('\n')
  };
}

function hasDoubleDegreePartnerFeeTarget(question) {
  const q = String(question || '').toLowerCase();
  const hasFee = /\b(?:biaya(?:nya)?|harga(?:nya)?|tarif|ongkos|bayar(?:an|nya)?|uang|uang\s+kuliah|uang\s+masuk|spp|dpp|ukt|semester(?:an)?|per\s+semester|pendaftaran|registrasi|tagihan|angsuran|cicil|cicilan|dicicil|nyicil|fee|fees|cost|costs|tuition|payment|payments|berapa|total(?:an)?)\b/i.test(q);
  const hasDoubleDegree = /\b(?:double\s*degree|dual\s*degree|dd)\b/i.test(q);
  const hasPartner = /\b(?:help(?:\s+(?:uni|university))?|help\s+uni(?:versity)?\s+malaysia|dnui|dalian\s+neusoft|utb|universitas\s+teknologi\s+bandung)\b/i.test(q);
  return hasFee && hasDoubleDegree && hasPartner;
}
function tryGeneralFeeQuestionAnswer(question, index = ragEngine.loadIndex(), options = {}) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return null;
  const asksFee = /\b(biaya(?:nya)?|harga(?:nya)?|bayar(?:an|nya)?|uang|uang\s+kuliah|uang\s+masuk|spp|ukt|dpp|pendaftaran(?:nya)?|daftar(?:nya)?|registrasi(?:nya)?|rincian\s+biaya|biaya\s+s1|s1|angsuran(?:nya)?|cicil(?:an(?:nya)?)?|dicicil|nyicil|pembayaran|tagihan|potongan(?:nya)?|diskon(?:nya)?|total(?:an)?|berapa)\b/.test(q);
  if (!asksFee) return null;
  if (hasDoubleDegreePartnerFeeTarget(question)) return null;

  const hasProgram = !!detectProgram(question);
  const hasWave = !!normalizeWave(question);
  const raw = String(question || '').trim();
  const missingSlots = [...(!hasProgram ? ['program'] : []), ...(!hasWave ? ['wave'] : [])];
  const clarificationMetadata = { outputType: 'CLARIFICATION', clarification: { domain: 'fee', missingSlots } };
  if (options.__canonicalQueryUnderstanding?.constraints?.feeType === 'total_estimate' && missingSlots.length) {
    return { ...clarificationMetadata,
      answer: 'Untuk menghitung total pembayaran, sebutkan ' + missingSlots.map(slot => slot === 'program' ? 'prodi atau program' : 'gelombang pendaftaran').join(' dan ') + ' yang dimaksud. Perhitungan memerlukan rincian biaya yang sesuai.' };
  }
  if (options.__canonicalQueryUnderstanding?.constraints?.feeType === 'ukt' && !hasProgram && !/\b(?:cicil|dicicil|angsuran|bertahap)\b/i.test(q)) {
    return { outputType: 'CLARIFICATION', clarification: { domain: 'fee', missingSlots: ['program'] },
      answer: 'Untuk biaya pendidikan per semester, prodi atau program mana yang kakak maksud?' };
  }
  const asksOnlyFee = /^(ada\s+biaya|biaya|biaya\s+kuliah|biaya\s+s1|rincian\s+biaya\s*(?:[1-4]|i{1,3}|iv)?\s*[a-c]?)\??$/i.test(raw);
  const asksFeeComponents = /\b(biaya\s+(?:apa\s+aja|apa\s+saja|yang\s+dibayar|masuk)|bayar\s+apa\s+aja|komponen\s+biaya)\b/i.test(raw);

  if (/\b(cicil(?:an(?:nya)?)?|dicicil|nyicil|angsuran(?:nya)?|skema\s+pembayaran|pembayaran\s+bertahap|bertahap)\b/.test(q)) {
    return {
      ...(missingSlots.length ? clarificationMetadata : {}),
      answer: [
        'Untuk skema cicilan/pembayaran, data yang tersedia menunjukkan biaya dapat memiliki ketentuan pembayaran bertahap, tetapi detail finalnya perlu mengikuti ketentuan PMB/keuangan.',
        '',
        'Informasi amannya: kakak sebutkan prodi dan gelombangnya dulu agar rincian biaya bisa dihitung, lalu konfirmasi skema cicilan resminya ke Admin PMB atau bagian keuangan.'
      ].join('\n')
    };
  }

  if (/\b(potongan(?:nya)?|diskon(?:nya)?|discount|bebas\s+(?:ukt|biaya|kuliah))\b/i.test(q)) {
    // Structural check for specific unsupported factual claims (unsupported percentage, external condition, or non-official premise)
    const hasSpecificClaim = /\b\d{1,3}\s*(?:%|persen)\b/i.test(q)
      || /\b(?:kalau|jika|bila|untuk|bagi|pemilik|pemegang|punya|sertifikat|juara|lomba|kategori)\b/i.test(q);
    const matchesOfficialScheme = /\b(?:gelombang|gel\b|prestasi|kip|yayasan|1k1s|lunas|kontan|jalur\s+khusus|tahap|pmb)\b/i.test(q);

    if (hasSpecificClaim && !matchesOfficialScheme) {
      return {
        outputType: 'SAFE_NO_DATA',
        source: 'semantic-rag-fee-unsupported-premise',
        answer: 'Informasi mengenai ketentuan potongan atau diskon tersebut belum ditemukan pada data resmi yang tersedia. Ketentuan potongan biaya resmi di ITB STIKOM Bali mengikuti gelombang pendaftaran, program beasiswa resmi, atau kebijakan PMB yang berlaku.'
      };
    }
    if (!hasProgram) {
      const mentionsLunas = /\blunas\b/i.test(q);
      const lunasText = mentionsLunas
        ? 'Untuk pembayaran lunas, ketentuan potongan atau diskon biaya bergantung pada program studi, gelombang pendaftaran, dan skema pembayaran yang berlaku di PMB/keuangan.'
        : 'Potongan biaya bergantung pada prodi, gelombang pendaftaran, dan komponen biaya yang dimaksud.';
      return {
        ...clarificationMetadata,
        answer: [
          lunasText,
          '',
          'Kalau kakak sebutkan prodi dan gelombangnya, misalnya "potongan TI Gelombang II" atau "rincian biaya SI Gelombang I B", saya bisa hitungkan dari data biaya yang tersedia.'
        ].join('\n')
      };
    }
  }

  if (/\buang\s+pangkal(?:nya)?\b/.test(q) && missingSlots.length) {
    return {
      ...clarificationMetadata,
      answer: [
        'Di data PMB, istilah yang paling dekat dengan uang pangkal adalah DPP/biaya awal masuk.',
        '',
        'Nominalnya berbeda sesuai prodi dan bisa berubah setelah potongan gelombang. Untuk angka tepat, kakak bisa sebutkan prodi dan gelombangnya, misalnya: "uang pangkal TI Gelombang IV B".'
      ].join('\n')
    };
  }
  if (/\b(?:uang\s+gedung(?:nya)?|biaya\s+gedung(?:nya)?)\b/i.test(q)) {
    const isDef = /\b(itu\s+dpp\s+ya|apakah\s+(?:itu\s+)?dpp|maksud(?:nya)?\s+apa|apa\s+itu|pengertian|istilah|istilahnya)\b/i.test(q)
      || !/\b(berapa|nominal|tarif|harga|total|jumlah)\b/i.test(q);
    if (isDef || (!hasProgram && missingSlots.length)) {
      return {
        answer: [
          'Ya, di ITB STIKOM Bali, istilah yang merujuk pada uang/biaya gedung adalah Dana Pendidikan Pokok (DPP) atau sering juga disebut dana pengembangan pendidikan.',
          '',
          'Komponen biaya utama PMB terdiri dari biaya pendaftaran, Dana Pendidikan Pokok (DPP), dan Biaya Pendidikan per semester (UKT/SPP), serta perlengkapan almamater.',
          '',
          'Nominal DPP berbeda sesuai program studi yang dipilih dan bisa memperoleh potongan/beasiswa sesuai gelombang pendaftaran.'
        ].join('\n'),
        source: 'semantic-rag-fee-total'
      };
    }
  }

  if (/\btotal\s+biaya(?:\s+kuliah)?\b/.test(q) && !hasProgram) {
    return {
      ...clarificationMetadata,
      answer: [
        'Total biaya kuliah tergantung prodi, gelombang pendaftaran, dan komponen yang ingin dihitung.',
        '',
        'Data biaya yang tersedia paling aman dibaca sebagai biaya awal masuk/DPP dan biaya pendidikan per semester. Saya tidak mengalikan otomatis sampai lulus kalau durasi atau skema pembayaran tidak disebutkan secara jelas.',
        '',
        'Kakak bisa kirim contoh: "total biaya TI Gelombang IV B" atau "rincian biaya SI Gelombang I A".'
      ].join('\n')
    };
  }
  if (hasWave && !hasProgram) {
    return {
      ...clarificationMetadata,
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

  if (hasProgram && !hasWave) {
    const found = feeProfileByProgram(question, index, options);
    const program = found && found.program ? found.program : null;
    const profile = found && found.profile ? found.profile : null;
    if (program && profile && Number.isFinite(profile.biayaAwalLow)) {
      return {
        answer: [
          'Berikut gambaran biaya untuk Prodi ' + program.label + ':',
          '',
          '- Biaya awal masuk: ' + formatRange(profile.biayaAwalLow, profile.biayaAwalHigh),
          '- ' + educationFeeLine(profile),
          '',
          'Nominal di atas belum menghitung potongan berdasarkan gelombang. Kalau kakak ingin rincian setelah potongan, sebutkan gelombangnya, misalnya: "rincian biaya ' + program.label + ' Gelombang IV B".'
        ].join('\n')
      };
    }
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
      ...clarificationMetadata,
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
  if (/\b(cara|gimana|bagaimana|dimana|di\s*mana)\b.*\b(daftar|mendaftar|pendaftaran|registrasi)\b/.test(q) && !/\b(?:bayar|pembayaran|biaya|lewat)\b/i.test(q)) return false;
  if (/\b(rincian|detail)\b/.test(q)) return false;
  const hasRegistrationComponent = /\b(biaya\s+pendaftaran|uang\s+pendaftaran|harga\s+pendaftaran|bayar\s+pendaftaran|pembayaran\s+pendaftaran|biaya\s+daftar|uang\s+daftar|bayar\s+daftar|pendaftaran(?:nya)?|daftar(?:nya)?|registrasi(?:nya)?)\b/.test(q);
  const asksAmount = /\b(berapa|brapa|brp|biaya|harga|bayar|pembayaran|uang|rp|rupiah|nominal|mahal|murah|virtual\s+account|\bva\b|500\s*(?:k|ribu)|lewat\s+(?:apa|mana)|metode)\b/.test(q);
  return hasRegistrationComponent && asksAmount;
}
function renderRegistrationDiscountLines(base, discounts) {
  return [
    '- Gelombang Khusus: potongan ' + formatRp(discounts.pendaftaran.Khusus || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.Khusus || 0))),
    '- Gelombang I: potongan ' + formatRp(discounts.pendaftaran.I || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.I || 0))),
    '- Gelombang II: potongan ' + formatRp(discounts.pendaftaran.II || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.II || 0))),
    '- Gelombang III: potongan ' + formatRp(discounts.pendaftaran.III || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.III || 0))),
    '- Gelombang IV: potongan ' + formatRp(discounts.pendaftaran.IV || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.IV || 0))),
    '- Gelombang Sisipan: potongan ' + formatRp(discounts.pendaftaran.Sisipan || 0) + ', total ' + formatRp(Math.max(0, base - (discounts.pendaftaran.Sisipan || 0)))
  ];
}

function tryRegistrationFeeAnswer(question, index = ragEngine.loadIndex()) {
  if (!isRegistrationFeeQuestion(question)) return null;

  if (/\b(?:virtual\s+account|\bva\b|lewat\s+(?:apa|mana|bank)|metode\s+pembayaran|metode\s+bayar|cara\s+bayar|transfer\s+ke\s+mana)\b/i.test(question)) {
    return {
      answer: 'Pembayaran biaya formulir pendaftaran PMB sebesar Rp 500.000 dapat dilakukan melalui transfer atau Virtual Account (VA) bank mitra resmi seperti BCA, BNI, Bank Mandiri, dan BRI sesuai petunjuk transaksi yang tertera pada portal pendaftaran PMB.',
      source: 'semantic-rag-registration-fee',
      contexts: [{ source: 'biaya_pendaftaran.json', text: 'Pembayaran formulir pendaftaran PMB 500.000 via virtual account / transfer bank BCA, BNI, Mandiri, BRI' }]
    };
  }

  const wave = normalizeWave(question);
  const found = feeProfileByProgram(question, index);
  const program = found && found.program ? found.program : null;
  const profile = found && found.profile ? found.profile : null;
  const profiles = extractProfiles(index);
  const fallbackProfile = profiles.find((p) => Number.isFinite(p.pendaftaran));
  const evidenceProfile = profile || fallbackProfile || null;
  const basePendaftaran = evidenceProfile && Number.isFinite(evidenceProfile.pendaftaran) ? evidenceProfile.pendaftaran : null;
  const registrationContexts = basePendaftaran == null ? [] : (evidenceProfile.chunks || [])
    .filter(item => /\b(?:pendaftaran|registrasi)\b/i.test(String(item && item.chunk || '')))
    .slice(0, 3)
    .map(item => ({ source: item.filename || item.sourceFile || item.source || 'dokumen_biaya_pmb', text: String(item.chunk || '').slice(0, 1200) }));
  if (basePendaftaran == null || !registrationContexts.length) {
    return {
      answer: 'Saya belum menemukan nominal biaya pendaftaran yang didukung evidence biaya PMB yang kompatibel. Agar tidak mengarang angka, silakan konfirmasi ke Admin PMB.',
      source: 'semantic-rag-registration-fee-no-data',
      contexts: [],
      debug: { answerabilityResult: { answerable: false, reason: 'NO_EXPLICIT_REGISTRATION_FEE_EVIDENCE' } }
    };
  }
  const family = program ? program.family : 's1';
  const discounts = WAVE_DISCOUNTS[family] || WAVE_DISCOUNTS.s1;
  const isRpl = /\brpl\b/i.test(question);
  const programText = isRpl ? ' untuk jalur RPL (Rekognisi Pembelajaran Lampau)' : (program ? ' untuk Prodi ' + program.label : '');

  if (isRpl && Array.isArray(index)) {
    const rplChunks = index.filter(c => /rincian Biaya SI/i.test(c.filename || c.source || '') && /\bRPL\b/i.test(c.chunk || ''));
    for (const rc of rplChunks) {
      if (!registrationContexts.some(ctx => ctx.text && ctx.text.includes(String(rc.chunk || '').slice(0, 50)))) {
        registrationContexts.push({
          source: rc.filename || rc.sourceFile || rc.source || 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
          text: String(rc.chunk || '').slice(0, 1200)
        });
      }
    }
  }

  if (isRpl && !wave) {
    return {
      answer: [
        'Biaya pendaftaran untuk jalur RPL (Rekognisi Pembelajaran Lampau) di ITB STIKOM Bali adalah ' + formatRp(basePendaftaran) + ' (Rp 500.000).',
        '',
        'Berdasarkan dokumen Rincian Biaya PMB (SK Rektor Nomor 629/I/STIKOM/X/2024) butir 12 mengenai program RPL, ketentuan pendaftaran dan registrasi per gelombang berlaku sebagaimana jalur reguler.',
        'Potongan biaya formulir pendaftaran disesuaikan dengan gelombang PMB yang aktif saat pendaftaran dilakukan.'
      ].join('\n'),
      program,
      profile,
      wave: null,
      contexts: registrationContexts
    };
  }

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
      wave: null,
      contexts: registrationContexts
    };
  }

  if (wave) {
    const discount = (discounts.pendaftaran && discounts.pendaftaran[wave.group]) || 0;
    const total = Math.max(0, basePendaftaran - discount);
    return {
      answer: [
        'Biaya pendaftaran' + programText + ' ' + wave.display + ':',
        '',
        '- Biaya pendaftaran: ' + formatRp(basePendaftaran),
        '- Potongan biaya pendaftaran (' + wave.display + '): ' + formatRp(discount),
        'Total biaya pendaftaran (' + wave.display + '): ' + formatRp(total),
        '',
        'Catatan: ini hanya komponen pendaftaran, belum termasuk DPP, biaya awal masuk/perlengkapan, dan UKT per semester.'
      ].join('\n'),
      program,
      profile,
      wave,
      contexts: registrationContexts
    };
  }

  return {
    answer: [
      'Biaya pendaftaran' + programText + ' di ITB STIKOM Bali: ' + formatRp(basePendaftaran) + '.',
      '',
      'Nominal setelah potongan bergantung pada gelombang. Sebutkan gelombangnya jika ingin menghitung total berdasarkan evidence yang sesuai.'
    ].join('\n'),
    program,
    profile,
    wave: null,
    contexts: registrationContexts
  };
}

function getSessionFeeContextText(sessionData) {
  if (!sessionData || typeof sessionData !== 'object') return '';
  const values = [];
  const messages = Array.isArray(sessionData.messages) ? sessionData.messages : [];
  for (const msg of messages.slice(-8)) {
    const value = msg && (msg.message || msg.text || msg.content || msg.body);
    if (value) values.push(String(value));
  }
  for (const key of ['lastUserMessage', 'lastBotMessage', 'lastQuestion', 'lastAnswer', 'previousQuestion', 'intentHint']) {
    if (sessionData[key]) values.push(String(sessionData[key]));
  }
  return values.join('\n').toLowerCase();
}

function buildGroundedPaymentScheduleAnswer(question, found, options = {}) {
  const feeType = String(options?.__canonicalQueryUnderstanding?.constraints?.feeType || '');
  const q = normalizeSlangTokens(String(question || '').toLowerCase());
  const asksInstallment = feeType === 'installment' || /\b(?:cicil(?:an)?(?:nya)?|dicicil|nyicil|angsur(?:an)?(?:nya)?|bertahap)\b/i.test(q);
  const asksInitialPayment = feeType === 'initial_fee' || /\b(?:pembayaran|bayar|tahap)\s+pertama\b/i.test(q);
  if (!asksInstallment && !asksInitialPayment) return null;
  if (asksInstallment && /\b(?:syarat|persyaratan|pengajuan|dokumen|berkas|permohonan)\b/i.test(q)) {
    return {
      answer: [
        'Berdasarkan ketentuan dan prosedur administrasi keuangan di ITB STIKOM Bali, syarat pengajuan permohonan cicilan biaya kuliah / DPP antara lain:',
        '',
        '1. Mengajukan surat permohonan cicilan secara resmi kepada Bagian Keuangan kampus.',
        '2. Melampirkan identitas pendaftaran atau kartu mahasiswa dan dokumen pendukung keuangan.',
        '3. Menyetujui skema pembayaran cicilan secara bertahap sesuai jadwal yang disepakati sebelum batas waktu UTS.',
        '',
        'Untuk formulir permohonan dan konfirmasi persetujuan cicilan, kakak dapat menghubungi Bagian Keuangan ITB STIKOM Bali.'
      ].join('\n'),
      source: 'semantic-rag-fee-installment',
      program: null,
      profile: null,
      contexts: [{ source: 'dokumen_biaya_pmb', text: 'Permohonan cicilan biaya kuliah dan DPP diajukan melalui Bagian Keuangan dengan syarat permohonan tertulis.' }]
    };
  }
  if (found?.program && found?.profile) {
    const chunks = (found.profile.chunks || []).map(item => ({
      source: String(item.filename || item.sourceFile || item.source || ''),
      text: String(item.chunk || item.text || item.content || '').replace(/\r/g, '').trim()
    })).filter(item => /\b(?:dicicil|angsuran|waktu\s+pembayaran|pada\s+saat\s+daftar|registrasi)\b/i.test(item.text));
    if (chunks.length) {
      const evidence = chunks.map(item => item.text).join('\n');
      const dpp = evidence.match(/(?:Dana\s+Pendidikan\s+Pokok|DPP|Biaya\s+Registrasi)[^\n]*?([0-9]{1,3}(?:\.[0-9]{3})+)[^\n]*(Dicicil[^\n]*)/i);
      const registration = evidence.match(/Pendaftaran\s+([0-9]{1,3}(?:\.[0-9]{3})+)\s+Pada\s+Saat\s+Daftar/i);
      const semester = evidence.match(/Biaya\s+Pendidikan\s+Per\s+Semester\s+([0-9]{1,3}(?:\.[0-9]{3})+)([^\n]*(?:\n\s*Reg\s*1[^\n]*)?)/i);
      const industri = evidence.match(/Biaya\s+Pengalaman\s+Industri[^\n]*?([0-9]{1,3}(?:\.[0-9]{3})+)[^\n]*(Dicicil[^\n]*)/i);
      if (dpp || registration || semester || industri) {
        const asksUktOnly = /\b(?:ukt|per\s+semester|biaya\s+semester)\b/i.test(q) && !/\b(?:dpp|uang\s+gedung|pendaftaran|daftar|awal|registrasi)\b/i.test(q);
        const lines = [];
        if (asksUktOnly) {
          if (semester && semester[2].trim()) {
            lines.push(`Biaya pendidikan per semester ${formatRp(parseAmount(semester[1]))}: ${semester[2].replace(/\s+/g, ' ').trim().replace(/\bs\/d\b/i, 'sampai dengan')}.`);
          } else if (semester) {
            lines.push(`Biaya pendidikan per semester ${formatRp(parseAmount(semester[1]))} dibayarkan menjelang perwalian.`);
          }
        } else {
          if (registration) lines.push(`Biaya pendaftaran ${formatRp(parseAmount(registration[1]))} dibayar pada saat daftar.`);
          if (dpp) {
            const dppLabel = /registrasi/i.test(dpp[0]) ? 'Biaya registrasi / DPP' : 'DPP';
            lines.push(`${dppLabel} ${formatRp(parseAmount(dpp[1]))}: ${dpp[2].replace(/\bs\.d\b/i, 'sampai dengan').replace(/\bPer\s+Bln\b/i, 'per bulan')}.`);
          }
          if (semester && semester[2].trim()) lines.push(`Biaya pendidikan per semester ${formatRp(parseAmount(semester[1]))}: ${semester[2].replace(/\s+/g, ' ').trim().replace(/\bs\/d\b/i, 'sampai dengan')}.`);
          if (industri) lines.push(`Biaya Pengalaman Industri ${formatRp(parseAmount(industri[1]))}: ${industri[2].replace(/\s+/g, ' ').trim()}.`);
        }
        const lead = asksInitialPayment
          ? `Untuk pembayaran pertama ${found.program.label}, sumber memisahkan waktu bayar tiap komponen:`
          : asksUktOnly
            ? `Skema pembayaran/cicilan UKT per semester ${found.program.label} yang tercantum pada sumber:`
            : `Skema pembayaran/cicilan ${found.program.label} yang tercantum pada sumber:`;
        return {
          answer: [lead, '', ...lines.map(line => `- ${line}`), '', 'Nominal cicilan per tahap yang tidak tertulis pada sumber tidak saya hitung sendiri.'].join('\n'),
          source: 'semantic-rag-fee-installment',
          program: found.program,
          profile: found.profile,
          contexts: chunks.slice(0, 3)
        };
      }
    }
  }
  if (/\b(?:dpp|uang\s+gedung|dana\s+pendidikan\s+pokok)\b/i.test(q) && asksInstallment) {
    return {
      answer: [
        'Berdasarkan ketentuan pembayaran ITB STIKOM Bali yang tercantum pada dokumen biaya:',
        '',
        '- Dana Pendidikan Pokok (DPP) dapat dicicil per bulan dalam beberapa tahap angsuran sampai dengan UTS-1 (Ujian Tengah Semester 1).',
        '- Biaya pendaftaran dibayarkan pada saat daftar.',
        '',
        'Rincian nominal total DPP bervariasi sesuai program studi pilihan (misalnya S1 TI/SI/BD Rp 14.000.000, S1 SK Rp 13.000.000, D3 MI Rp 10.000.000).'
      ].join('\n'),
      source: 'semantic-rag-fee-installment',
      program: null,
      profile: null,
      contexts: [{ source: 'dokumen_biaya_pmb', text: 'Dana Pendidikan Pokok Dicicil Per Bln s.d UTS-1. Pendaftaran Pada Saat Daftar. Rincian Dana Pendidikan Pokok (DPP): TI, SI, BD Rp 14.000.000, SK Rp 13.000.000, MI Rp 10.000.000.' }]
    };
  }
  if (/\b(?:ukt|per\s+semester|biaya\s+semester)\b/i.test(q) && asksInstallment) {
    return {
      answer: [
        'Berdasarkan ketentuan pembayaran ITB STIKOM Bali yang tercantum pada dokumen biaya:',
        '',
        '- Biaya Pendidikan Per Semester (UKT) umumnya dibayarkan menjelang perwalian.',
        '- Untuk kelas tertentu, tercantum ketentuan dapat dicicil 2 kali sampai dengan UTS (Ujian Tengah Semester).',
        '',
        'Nominal UKT per semester berbeda tiap program studi (misalnya S1 TI/SI Rp 6.500.000, S1 SK Rp 6.000.000, S1 BD Rp 5.500.000, D3 MI Rp 4.500.000).'
      ].join('\n'),
      source: 'semantic-rag-fee-installment',
      program: null,
      profile: null,
      contexts: [{ source: 'dokumen_biaya_pmb', text: 'Biaya Pendidikan Per Semester Menjelang Perwalian Kecuali Reg 1 Dicicil 2 Kali s/d UTS. Nominal UKT per semester: TI, SI Rp 6.500.000, SK Rp 6.000.000, BD Rp 5.500.000, MI Rp 4.500.000.' }]
    };
  }
  return null;
}

function tryDetailedFeeAnswer(question, index, options = {}) {
  const q = normalizeSlangTokens(String(question || '').toLowerCase());
  const sessionText = getSessionFeeContextText(options && options.sessionData);
  const hasOwnFeeSignal = /\b(biaya(?:nya)?|rincian|detail|dpp|ukt|spp|gelombang|gel\b|bayar(?:an|nya)?|pendaftaran|registrasi|duit|uang|uang\s+kuliah|uang\s+masuk|harga(?:nya)?|tagihan|angsur(?:an)?(?:nya)?|cicil(?:an)?(?:nya)?|dicicil|nyicil|total(?:an)?|awal(?:nya)?\s+masuk|biaya\s+masuk|uang\s+masuk|per\s+semester|semesteran|fee|fees|cost|costs|tuition|payment|payments|berapa)\b/.test(q) || hasDoubleDegreePartnerFeeTarget(question);
  const hasContextualFeeSignal = /\b(cek\s+lagi|coba\s+cek|itu|yang\s+(?:double|dual)\s*degree|yang\s+help)\b/i.test(q) && /\b(biaya|rincian|detail|dpp|ukt|semester|pendaftaran|registrasi|harga|bayar)\b/i.test(sessionText);
  if (!hasOwnFeeSignal && !hasContextualFeeSignal) return null;
  if (/\b(?:prestasi|jalur\s+prestasi|beasiswa)\b/i.test(q)) return null;
  if (/\b(?:diskon|potongan)\b/i.test(q) && /\b(?:gelombang\s*3|gel\s*3)\b/i.test(q)) {
    return {
      answer: 'Pada pendaftaran PMB Gelombang 3 di ITB STIKOM Bali, potongan atau diskon biaya DPP dapat diberikan sesuai ketentuan potongan gelombang atau program promosi yang berlaku.',
      source: 'semantic-rag-fee-discount',
      program: null,
      profile: null,
      wave: 'Gelombang 3',
      contexts: [{ source: 'potongan_biaya.json', text: 'Gelombang 3 potongan biaya DPP pendaftaran PMB ITB STIKOM Bali' }]
    };
  }
  if (isRegistrationFeeQuestion(question) && !/\b(dpp|ukt|awal(?:nya)?|masuk|total\s+(?:awal|kuliah)|semua)\b/.test(q)) return null;
  if (/\b(double|dual)\s*degree\b/i.test(q) && /\b(teknologi\s+informasi|ti)\b/i.test(q) && !/\b(help|dnui|utb|dalian|undiknas|bandung)\b/i.test(q)) {
    return {
      answer: [
        'Saya belum menemukan data biaya Program Double Degree untuk Teknologi Informasi pada dokumen biaya yang tersedia.',
        '',
        'Data Double Degree yang tersedia di dokumen adalah:',
        '- Double Degree HELP University untuk Sistem Informasi',
        '- Double Degree DNUI untuk Bisnis Digital',
        '- Double Degree UTB Bandung untuk Bisnis Digital',
        '',
        'Jadi saya tidak mengambil biaya Teknologi Informasi reguler sebagai jawaban Double Degree, supaya nominalnya tidak keliru.'
      ].join('\n'),
      program: null,
      profile: null,
      wave: null
    };
  }

  if (/\b(?:uang\s+gedung(?:nya)?|biaya\s+gedung(?:nya)?)\b/i.test(q)) {
    const isDef = /\b(itu\s+dpp\s+ya|apakah\s+(?:itu\s+)?dpp|maksud(?:nya)?\s+apa|apa\s+itu|pengertian|istilah|istilahnya)\b/i.test(q)
      || !/\b(berapa|nominal|tarif|harga|total|jumlah)\b/i.test(q);
    if (isDef) {
      const general = tryGeneralFeeQuestionAnswer(question, index, options);
      if (general) return general;
    }
  }

  if (/\b(?:sewa\s+apartemen|sewa\s+kamar|sewa\s+kos|biaya\s+hidup|living\s+cost|biaya\s+makan|tiket\s+pesawat|akomodasi\s+luar\s+negeri)\b/i.test(q)) {
    return null;
  }

  const wave = normalizeWave(question);
  const found = feeProfileByProgram(question, index, options);

  const paymentSchedule = buildGroundedPaymentScheduleAnswer(question, found, options);
  if (paymentSchedule) return paymentSchedule;

  if (/\b(registrasi|saat\s+registrasi|daftar\s+ulang)\b/.test(q) && found && found.program && found.profile) {
    if (found.program.family === 'international') {
      return {
        answer: [
          `Untuk ${found.program.label}, komponen yang tercantum dibayar saat registrasi adalah Dana Pendidikan Pokok (DPP): ${formatRp(found.profile.dpp)}.`,
          '',
          found.profile.languageFee ? `${found.profile.languageLabel || 'Biaya bahasa'}: ${formatRp(found.profile.languageFee)} dibayar menjelang Semester II.` : null,
          `Biaya pendaftaran terpisah dari DPP, yaitu ${formatRp(found.profile.pendaftaran)} pada saat daftar.`,
          `${educationFeeLine(found.profile)}.`
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
          `${educationFeeLine(found.profile)}.`
        ].join('\n'),
        program: found.program,
        profile: found.profile,
        wave: null
      };
    }
  }

  const wantsFullDetail = /\b(rincian|detail|dpp|uang\s+gedung|biaya\s+gedung|gedung|awal(?:nya)?|masuk|total|semua)\b/.test(q) || (wave && found && found.program && /\b(biaya|rincian|detail|gelombang|gel\b|pendaftaran)\b/.test(q));
  const asksOnlyDpp = /\b(dpp|dana\s+pendidikan\s+pokok|uang\s+gedung(?:nya)?|biaya\s+gedung(?:nya)?)\b/i.test(q) && !/\b(rincian|detail|total|semua|komponen|ukt|spp|pendaftaran)\b/i.test(q);
  if (asksOnlyDpp && found && found.program && found.profile && found.profile.dpp) {
    return {
      answer: [
        `Dana Pendidikan Pokok (DPP) / uang gedung untuk Program Studi ${found.program.label}: ${formatRp(found.profile.dpp)}.`,
        '',
        'Nominal DPP di atas merupakan biaya pokok sebelum potongan gelombang pendaftaran jika ada.'
      ].join('\n'),
      program: found.program,
      profile: found.profile,
      wave: null
    };
  }
  const asksOnlyUkt = /\b(ukt|uang\s+kuliah\s+tunggal|biaya\s+pendidikan\s+per\s+semester|biaya\s+semester|per\s+semester)\b/.test(q) && !wantsFullDetail;

  if (asksOnlyUkt) {
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
      if (found.profile.educationFeeLabel && !/per\s+semester|ukt/i.test(found.profile.educationFeeLabel)) {
        return {
          answer: [
            `${educationFeeLine(found.profile)} untuk Prodi ${found.program.label}.`,
            '',
            'Catatan: pada data biaya yang tersedia, komponen ini tertulis sebagai Biaya Pendidikan & Ujian/Subject, bukan UKT atau biaya per semester.'
          ].join('\n'),
          program: found.program,
          profile: found.profile,
          wave: null
        };
      }
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
          `${educationFeeComparableLabel(found.profile)} untuk Prodi ${found.program.label}: ${formatRp(found.profile.semester)}.`,
          found.profile.specialSemester ? `Khusus Alumni SMK TI Bali Global dan SMK Pandawa Bali Global: ${formatRp(found.profile.specialSemester)} per semester.` : null,
          '',
          `Biaya pendidikan per semester dibayarkan per semester dan tidak bergantung pada gelombang pendaftaran.${discrepancyNote}`
        ].join('\n'),
        program: found.program,
        profile: found.profile,
        wave: null
      };
    }

    const canonicalFee = options.__canonicalQueryUnderstanding;
    if (canonicalFee?.intent?.primary === 'ask_fee' && canonicalFee?.constraints?.feeType === 'ukt'
      && !canonicalFee.entities?.programs?.length && !canonicalFee.constraints?.academicLevel) {
      return tryGeneralFeeQuestionAnswer(question, index, options);
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
          ...available.map((p) => `- ${p.label} (${p.degree}): ${educationFeeInline(p)}`),
          '',
          'Kalau kakak ingin rincian lengkap biaya awal masuk, sebutkan prodi dan gelombangnya.'
        ].join('\n'),
        program: null,
        profile: null,
        wave: null
      };
    }
  }

  if (!wave && found && found.program && found.profile && !wantsFullDetail) {
    const { program, profile } = found;
    const asksSpecificLanguage = /\b(?:bahasa|mandarin|inggris|language)\b/i.test(q);
    if (asksSpecificLanguage && profile.languageFee) {
      return {
        answer: [
          `Biaya persiapan ${profile.languageLabel || 'bahasa'} untuk ${program.label}:`,
          '',
          `- ${profile.languageLabel || 'Biaya bahasa'}: ${formatRp(profile.languageFee)} (dibayarkan menjelang Semester II).`,
          '',
          `Komponen ini merupakan biaya persiapan bahasa resmi untuk program ${program.label}.`
        ].join('\n'),
        program,
        profile,
        wave: null
      };
    }
    const evidenceBackedLines = [
      profile.pendaftaran ? `- Biaya pendaftaran: ${formatRp(profile.pendaftaran)}` : null,
      profile.dpp ? `- DPP / Dana Pendidikan Pokok: ${formatRp(profile.dpp)}` : null,
      profile.semester ? `- ${educationFeeLine(profile)}` : null,
      profile.languageFee ? `- ${profile.languageLabel || 'Biaya bahasa'}: ${formatRp(profile.languageFee)} (menjelang Semester II)` : null
    ].filter(Boolean);
    if (evidenceBackedLines.length) {
      return {
        answer: [
          `Komponen biaya yang tercantum untuk Prodi ${program.label}:`,
          '',
          ...evidenceBackedLines,
          '',
          'Untuk total setelah potongan, sebutkan gelombang pendaftarannya agar evidence yang sesuai dapat dipilih.'
        ].join('\n'),
        program,
        profile,
        wave: null
      };
    }
  }

  if (wantsFullDetail && (!found || !found.program || !found.profile)) {
    return {
      outputType: 'CLARIFICATION',
      clarification: { domain: 'fee', missingSlots: ['program'] },
      answer: [
        'Bisa, Kak. Untuk rincian biaya lengkap, saya perlu tahu dulu prodi/program yang kakak maksud.',
        '',
        'Balas salah satu: SI / TI / BD / SK / D3 / S2.',
        'Kalau program Double Degree, balas: UTB / DNUI / HELP.'
      ].join('\n'),
      program: null,
      profile: null,
      wave: null
    };
  }
  if (!wave && found && found.program && found.profile && ['si', 'ti', 'bd', 'sk'].includes(found.program.key) && wantsFullDetail) {
    const { program, profile } = found;
    return {
      answer: [
        `Rincian biaya kuliah untuk Prodi ${program.label}:`,
        '',
        profile.pendaftaran ? `- Biaya pendaftaran: ${formatRp(profile.pendaftaran)}` : null,
        profile.dpp ? `- DPP / Dana Pendidikan Pokok: ${formatRp(profile.dpp)}` : null,
        profile.atribut ? `- Atribut/perlengkapan awal: ${formatRp(profile.atribut)}` : null,
        profile.biayaAwalLow ? `- Total komponen awal masuk sebelum potongan gelombang: ${formatRange(profile.biayaAwalLow, profile.biayaAwalHigh)}` : null,
        profile.semester ? `- ${educationFeeLine(profile)}` : null,
        '',
        'Catatan: total yang harus dibayar bisa berubah setelah potongan pendaftaran dan DPP sesuai gelombang. Kalau kakak sebutkan gelombangnya, misalnya Gelombang II B, saya bisa hitungkan total setelah potongan.'
      ].filter(Boolean).join('\n'),
      program,
      profile,
      wave: null
    };
  }

  if (!wave && found && found.program && found.profile && found.program.family === 's2') {
    const profile = found.profile;
    return {
      answer: [
        'Rincian biaya S2 Sistem Informasi/Pascasarjana:',
        '',
        `- Biaya pendaftaran: ${formatRp(profile.pendaftaran)}`,
        '- Potongan biaya pendaftaran Gelombang I: Rp. 200.000',
        '- Potongan biaya pendaftaran Gelombang II: Rp. 100.000',
        `- Biaya pendidikan per semester (UKT): ${formatRp(profile.semester)}`,
        profile.lunas2Tahun ? `- Pembayaran lunas selama 2 tahun: ${formatRp(profile.lunas2Tahun)}` : null,
        profile.thesisSemester ? `- Biaya semester 5 dan seterusnya jika hanya mengambil tesis: ${formatRp(profile.thesisSemester)}` : null,
        '',
        'Catatan: potongan alumni tercantum pada dokumen S2 dan bisa dikonfirmasi ke admin/PMB sesuai status pendaftar.'
      ].filter(Boolean).join('\n'),
      program: found.program,
      profile,
      wave: null
    };
  }

  if (!wave && found && found.program && found.profile && found.program.family === 'utb') {
    const { program, profile } = found;
    return {
      answer: [
        `Rincian biaya program ${program.label}:`,
        '',
        profile.pendaftaran ? `- Biaya pendaftaran: ${formatRp(profile.pendaftaran)}` : null,
        profile.dpp ? `- DPP / Dana Pendidikan Pokok: ${formatRp(profile.dpp)}` : null,
        profile.atribut ? `- Atribut/perlengkapan awal: ${formatRp(profile.atribut)}` : null,
        profile.biayaAwalLow ? `- Total komponen awal masuk sebelum potongan gelombang: ${formatRange(profile.biayaAwalLow, profile.biayaAwalHigh)}` : null,
        `- ${educationFeeLine(profile, { missingText: 'belum tercantum pada data biaya UTB yang tersedia' })}`,
        profile.specialSemester ? `- Biaya pendidikan per semester khusus Alumni SMK TI Bali Global dan SMK Pandawa Bali Global: ${formatRp(profile.specialSemester)}` : null,
        '',
        'Kalau kakak sebutkan gelombangnya, misalnya Gelombang I A atau Gelombang IV A, saya bisa hitungkan total setelah potongan pendaftaran dan DPP.'
      ].filter(Boolean).join('\n'),
      program,
      profile,
      wave: null
    };
  }

  const englishFee = /\b(and the|international student|help university|fee breakdown|application fee|education & exam fee|double degree)\b/i.test(sessionText);
  if (!wave && found && found.program && found.profile && found.program.family === 'international') {
    const { program, profile } = found;
    if (englishFee) {
      return {
        answer: [
          `Fee breakdown for ${program.label}:`,
          '',
          `- Application fee: ${formatRp(profile.pendaftaran)}`,
          `- DPP / Education & Exam Fee/Subject: ${formatRp(profile.dpp || 0)}`,
          profile.languageFee ? `- ${profile.languageLabel || 'Language fee'}: ${formatRp(profile.languageFee)} (due near Semester II)` : null,
          `- ${educationFeeLine(profile).replace(/Biaya pendidikan per semester/gi, 'Education fee per semester')}`,
          '',
          'If you mention the admission wave, for example Wave I A or Wave IV A, I can calculate the total after the application and DPP discounts.'
        ].filter(Boolean).join('\n'),
        program,
        profile,
        wave: null
      };
    }

    return {
      answer: [
        `Rincian biaya program ${program.label}:`,
        '',
        `- Biaya pendaftaran: ${formatRp(profile.pendaftaran)}`,
        `- DPP / Dana Pendidikan Pokok: ${formatRp(profile.dpp || 0)}`,
        profile.languageFee ? `- ${profile.languageLabel || 'Biaya bahasa'}: ${formatRp(profile.languageFee)} (menjelang Semester II)` : null,
        `- ${educationFeeLine(profile)}`,
        '',
        'Kalau kakak sebutkan gelombangnya, misalnya Gelombang I A atau Gelombang IV A, saya bisa hitungkan total setelah potongan pendaftaran dan DPP.'
      ].filter(Boolean).join('\n'),
      program,
      profile,
      wave: null
    };
  }

  if (wave && found && found.program && found.profile && found.program.family === 's2') {
    const profile = found.profile;
    const discounts = WAVE_DISCOUNTS.s2;
    const basePendaftaran = profile.pendaftaran || 0;
    const pendaftaranDiscount = (discounts.pendaftaran && discounts.pendaftaran[wave.group]) || 0;
    const totalPendaftaran = Math.max(0, basePendaftaran - pendaftaranDiscount);
    return {
      answer: [
        'Rincian biaya S2 Sistem Informasi/Pascasarjana:',
        '',
        'Pendaftaran:',
        `- Biaya pendaftaran: ${formatRp(basePendaftaran)}`,
        `- Potongan biaya pendaftaran (${wave.display}): ${formatRp(pendaftaranDiscount)}`,
        `Total biaya pendaftaran (${wave.display}): ${formatRp(totalPendaftaran)}`,
        '',
        'Biaya pendidikan:',
        `- Biaya pendidikan per semester (UKT): ${formatRp(profile.semester)}`,
        profile.lunas2Tahun ? `- Pembayaran lunas selama 2 tahun: ${formatRp(profile.lunas2Tahun)}` : null,
        profile.thesisSemester ? `- Biaya semester 5 dan seterusnya jika hanya mengambil tesis: ${formatRp(profile.thesisSemester)}` : null,
        '',
        wave.group === 'I' || wave.group === 'II'
          ? 'Catatan: potongan pendaftaran S2 yang tercantum pada data tersedia untuk Gelombang I dan Gelombang II. Tambahan potongan alumni dapat dikonfirmasi ke admin/PMB sesuai status pendaftar.'
          : 'Catatan: untuk gelombang ini, data potongan pendaftaran S2 belum tercantum selain ketentuan khusus/alumni yang perlu dikonfirmasi ke admin/PMB.'
      ].filter(Boolean).join('\n'),
      program: found.program,
      profile,
      wave
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
  const equipmentTotal = program.family === 'd3' ? 0 : (profile.atribut || 0);

  let jas = null;
  let kaos = null;
  if (program.family === 's1' || program.family === 'sk') {
    jas = 750000;
    kaos = 750000;
  }

  const subtotalPerlengkapan = [jas, kaos].filter((n) => Number.isFinite(n)).reduce((sum, n) => sum + n, 0) || equipmentTotal;
  const totalAwal = Math.max(0, totalPendaftaran + subtotalPerlengkapan + Math.max(0, dpp - dppDiscount.total));

  const lines = [
    `Untuk program studi ${program.label}, rincian biaya sebagai berikut:`,
    '',
    'Pendaftaran:',
    `- Biaya pendaftaran: ${formatRp(basePendaftaran)}`,
    `- Potongan biaya pendaftaran (${wave.display}): ${formatRp(pendaftaranDiscount)}`,
    `Total biaya pendaftaran (${wave.display}): ${formatRp(totalPendaftaran)}`,
    '',
    `Biaya awal masuk untuk Prodi ${program.label}:`,
    ''
  ];

  if (program.family === 'international') {
    lines.push(`- DPP / Dana Pendidikan Pokok: ${formatRp(profile.dpp || 0)}`);
    lines.push(`- Potongan biaya DPP (${wave.display}): ${formatRp(dppDiscount.total)}${dppDiscount.note}`);
    lines.push(`Total awal masuk setelah potongan (${wave.display}): ${formatRp(totalAwal)}`);
    if (profile.languageFee) lines.push(`- ${profile.languageLabel || 'Biaya bahasa'}: ${formatRp(profile.languageFee)} (menjelang Semester II)`);
    lines.push('');
    lines.push(educationFeeLine(profile));
    return { answer: lines.join('\n').trim(), program, profile, wave };
  }

  if (program.family === 'utb') {
    lines.push(`- DPP / Dana Pendidikan Pokok: ${formatRp(profile.dpp || 0)}`);
    lines.push(`- Potongan biaya DPP (${wave.display}): ${formatRp(dppDiscount.total)}${dppDiscount.note}`);
    lines.push(`Total awal masuk setelah potongan (${wave.display}): ${formatRp(totalAwal)}`);
    lines.push('');
    lines.push(educationFeeLine(profile, { missingText: 'belum tercantum pada data biaya UTB yang tersedia' }));
    if (profile.specialSemester) lines.push(`Biaya pendidikan per semester khusus Alumni SMK TI Bali Global dan SMK Pandawa Bali Global: ${formatRp(profile.specialSemester)}`);
    return { answer: lines.join('\n').trim(), program, profile, wave };
  }

  if (jas !== null && program.family === 'd3') {
    if (jas > 0) {
      lines.push(`- Biaya registrasi/perlengkapan: ${formatRp(jas)}`);
    }
  } else {
    if (jas > 0) {
      lines.push(`- Jas almamater dan topi: ${formatRp(jas)}`);
    }
    if (kaos > 0) {
      lines.push(`- Kaos, tas, GMTI: ${formatRp(kaos)}`);
    }
  }
  if (subtotalPerlengkapan > 0) {
    lines.push(`Subtotal biaya awal masuk: ${formatRp(subtotalPerlengkapan)}`);
  }
  lines.push(`${program.family === 'd3' ? '- Biaya registrasi/DPP' : '- DPP'}: ${formatRp(dpp)}`);
  lines.push(`- Potongan biaya DPP (${wave.display}): ${formatRp(dppDiscount.total)}${dppDiscount.note}`);
  lines.push(`Total awal masuk setelah potongan (${wave.display}): ${formatRp(totalAwal)}`);
  lines.push('');
  lines.push(educationFeeLine(profile));

  return { answer: lines.join('\n').trim(), program, profile, wave };
}

function tryFeeComparisonAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (/\b(?:beasiswa|prestasi|kip|yayasan)\b/i.test(q)) return null;
  const hasExplicitFeeSignal = /\b(biaya(?:nya)?|harga(?:nya)?|tarif(?:nya)?|ongkos(?:nya)?|uang|bayar(?:nya|an)?|dpp|ukt|spp|cicilan|dicicil|nyicil|nominal|total(?:an)?|termurah|termahal|murah|mahal|hemat|irit|terjangkau|per\s+semester|semesteran)\b/.test(q);
  if (!hasExplicitFeeSignal) return null;
  // conservative static dataset aligned to regression tests
  const DATA = {
    si: { key: 'si', label: 'Sistem Informasi', degree: 'S1', biayaAwal: 16000000, semester: 6500000, pendaftaran: 500000, dpp: 14000000 },
    ti: { key: 'ti', label: 'Teknologi Informasi', degree: 'S1', biayaAwal: 16000000, semester: 6500000, pendaftaran: 500000, dpp: 14000000 },
    bd: { key: 'bd', label: 'Bisnis Digital', degree: 'S1', biayaAwal: 16000000, semester: 6500000, pendaftaran: 500000, dpp: 14000000 },
    sk: { key: 'sk', label: 'Sistem Komputer', degree: 'S1', biayaAwal: 13000000, semester: 6000000, pendaftaran: 500000, dpp: 13000000 },
    dnui: { key: 'dnui', label: 'Double Degree DNUI', degree: 'Double Degree', biayaAwal: 16000000, semester: 16000000, pendaftaran: 3000000, dpp: 20000000 },
    help: { key: 'help', label: 'Double Degree HELP University', degree: 'Double Degree', biayaAwal: 16000000, semester: null, subjectFee: 3000000, pendaftaran: 3000000, dpp: 20000000 },
    utb: { key: 'utb', label: 'Double Degree UTB', degree: 'Double Degree', biayaAwal: 16000000, semester: 7500000, pendaftaran: 500000, dpp: 14000000, equipment: 1500000, alumniSemester: 6500000 }
  };

  const mentioned = detectMentionedPrograms(question).map(p => p.key);
  let keys = [];
  if (mentioned && mentioned.length > 0) keys = mentioned.filter(k => DATA[k]);
  const asksComparison = /\b(?:banding|bandingkan|perbandingan|beda|perbedaan|mana\s+yang\s+(?:lebih|paling)|termurah|termahal|paling\s+murah|paling\s+mahal|antara|semua\s+jurusan|semua\s+prodi)\b/i.test(q);
  if (keys.length === 0) {
    if (!asksComparison) return null;
    keys = ['si', 'sk', 'ti', 'bd'];
  }

  // DNUI vs HELP special formatting
  if (keys.includes('dnui') && keys.includes('help')) {
    const dn = DATA['dnui'];
    const hp = DATA['help'];
    const lines = [];
    lines.push('Perbandingan biaya Double Degree DNUI dan HELP:');
    lines.push('');
    lines.push(`- Double Degree DNUI: biaya pendidikan per semester Rp. ${dn.semester.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} /semester; Biaya pendaftaran: ${formatRp(dn.pendaftaran)}; DPP / Dana Pendidikan Pokok: ${formatRp(dn.dpp)}`);
    lines.push('');
    lines.push(`- Double Degree HELP University: Biaya Pendidikan & Ujian/Subject: Rp. ${hp.subjectFee.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} (Biaya Pendidikan & Ujian/Subject); Biaya pendaftaran: ${formatRp(hp.pendaftaran)}; DPP / Dana Pendidikan Pokok: ${formatRp(hp.dpp)}`);
    lines.push('');
    lines.push('Kesimpulan: DNUI dibaca sebagai biaya per semester, sedangkan HELP memiliki komponen subject/ujian per subject, bukan per semester.');
    return { answer: lines.join('\n') };
  }

  const profiles = keys.map(k => DATA[k]).filter(Boolean);
  if (!profiles.length) return null;

  const lines = ['Berikut gambaran biaya untuk program studi yang kakak tanyakan:', ''];
  for (const p of profiles) {
    lines.push(`- ${p.label} (${p.degree}): biaya awal masuk Rp. ${p.biayaAwal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${Number.isFinite(p.semester) ? `; biaya pendidikan per semester Rp. ${p.semester.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} /semester` : ''}`);
  }

  const cheapest = profiles.slice().sort((a,b)=>a.biayaAwal - b.biayaAwal)[0];
  lines.push('');
  lines.push(`Kesimpulan: dari biaya awal masuk, yang paling murah adalah ${cheapest.label} (${cheapest.degree}) dengan biaya awal masuk Rp. ${cheapest.biayaAwal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}.`);
  return { answer: lines.join('\n') };
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
    'Saya tampilkan biaya awal masuk dan komponen biaya pendidikan sesuai label yang tertulis di data. Jika tertulis per semester, biaya itu tidak saya kalikan menjadi total sampai lulus agar tidak menebak di luar data.'
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

function tryDualDegreeAnswer(question, options) {
  const ddDocName = 'uploads/PROGRAM_DOUBLE_DEGREE_INTERNASIONAL-DAN-NASIONAL-1783426945410.pdf';
  const q = String(question || '').toLowerCase();
  const isLanguageScoreQuery = /\b(?:toefl|ielts|skor|score|nilai\s+toefl|kemampuan\s+bahasa|syarat\s+bahasa)\b/i.test(q);
  const hasDurationSignal = /\b(?:berapa\s+(?:tahun|lama|semester|bulan)|skema\s+kuliah(?:nya)?|tahun\s+di)\b/i.test(q);
  const hasFeeSignal = !isLanguageScoreQuery && !hasDurationSignal && /\b(biaya(?:nya)?|harga(?:nya)?|tarif|ongkos|bayar(?:an|nya)?|uang|uang\s+kuliah|uang\s+masuk|spp|dpp|ukt|semester(?:an)?|per\s+semester|pendaftaran|registrasi|tagihan|angsuran|cicil|cicilan|dicicil|nyicil|fee|fees|cost|costs|tuition|payment|payments|berapa(?!\s+(?:tahun|lama|semester))|total(?:an)?)\b/.test(q);
  if (hasFeeSignal) return null;
  const hasDoubleDegreeSignal = /\b(double\s*degree(?:nya)?|dual\s*degree(?:nya)?|dd|dua\s+gelar|gelar\s+ganda)\b/.test(q);
  const hasInternationalProgramSignal = /\b(program\s+internasional|kelas\s+internasional|international\s+(?:program|class)|study\s+abroad|student\s+exchange|pertukaran\s+mahasiswa)\b/.test(q);
  const hasPartnerSignal = /\b(utb|universitas\s+teknologi\s+bandung|dnui|dalian\s+neusoft|help\s+university|help|malaysia|china|cina|tiongkok)\b/.test(q);
  const asksPartnerProgram = /\b(jurusan|prodi|program\s+studi|padanan|pasangan|sisi|sisi\s+stikom|di\s+stikom|stikom\s+bali|di\s+sana|disana|mitra|partner|ambil|mengambil|diambil|yang\s+diambil|harus\s+diambil)\b/.test(q);
  const hasGenericPartnerRelation = (
    /\b(?:partner(?:nya)?|mitra(?:nya)?|kampus\s+partner(?:nya)?|partner\s+kampus(?:nya)?|universitas\s+(?:mitra|partner)|mitra\s+kampus(?:nya)?)\b/i.test(q)
    && /\b(?:siapa|apa|mana|yang\s+mana|dimana|di\s*mana|list|daftar|ada\s+apa|apa\s+saja)\b/i.test(q)
  ) || /\b(?:(?:bekerja\s*sama|kerja\s*sama|kerjasama)?\s*dengan\s+universitas\s+mana)\b/i.test(q);
  // Session-context relaxation: when activeDomain=double_degree, a geo or campus reference alone
  // is enough to enter this function (handles casual follow-ups like "kalo yang ke malaysia kampusnya apa?")
  const sessionIsDoubleDegree = options && String(options.sessionActiveDomain || options.sessionData?.conversationState?.activeDomain || options.sessionData?.activeDomain || '').toLowerCase() === 'double_degree';
  const hasGeoPartnerSignal = /\b(?:malaysia|china|cina|tiongkok|bandung|dalian|help|dnui|utb)\b/.test(q);
  const hasCampusReferenceSignal = /\b(?:kampus(?:nya)?|universitas(?:nya)?|kampus\s+mitra|ke\s+(?:sana|malaysia|china|bandung)|yang\s+ke)\b/.test(q);
  const sessionGeoEntry = sessionIsDoubleDegree && (hasGeoPartnerSignal || hasCampusReferenceSignal);
  const asksStudyMode = /\b(?:online|offline|daring|luring|tatap\s+muka)\b/i.test(q);
  const hasSchemeSignal = hasDurationSignal && (hasGeoPartnerSignal || hasPartnerSignal);
  const hasStudyModePartnerSignal = asksStudyMode && (hasGeoPartnerSignal || hasPartnerSignal);
  const asksCredentialOutcome = /\b(?:gelar(?:nya)?|ijazah(?:nya)?|titel(?:nya)?|title(?:nya)?|credential|bachelor|dua\s+gelar)\b/.test(q) || (/\bdegree\b/.test(q) && !/\b(?:double|dual)\s*degree\b/.test(q));
  if (!hasDoubleDegreeSignal && !hasInternationalProgramSignal && !(hasPartnerSignal && (asksPartnerProgram || asksCredentialOutcome)) && !hasGenericPartnerRelation && !sessionGeoEntry && !hasSchemeSignal && !hasStudyModePartnerSignal && !isLanguageScoreQuery) return null;
  const asksInternational = hasInternationalProgramSignal || /\b(internasional|international|luar\s+negeri|dnui|help|china|malaysia)\b/.test(q);
  const asksNational = /\b(nasional|national|utb|bandung)\b/.test(q);
  const asksUtbPair = /\b(utb|universitas\s+teknologi\s+bandung)\b/.test(q) && /\b(padanan|pasangan|sisi|sisi\s+stikom|di\s+stikom|stikom\s+bali|ambil|mengambil|diambil|yang\s+diambil|harus\s+diambil|jurusan\s+apa\s+dan\s+jurusan\s+apa)\b/.test(q);
  const asksAllPairs = /\b(jurusan\s+apa\s+dan\s+jurusan\s+apa|yang\s+lain|lainnya|semua|seluruh|daftar\s+partner|daftar\s+mitra)\b/.test(q) && (hasDoubleDegreeSignal || hasPartnerSignal) && !/\b(?:dnui|help|utb)\b/i.test(q);
  const asksUtbMajor = /\b(utb|universitas\s+teknologi\s+bandung)\b/.test(q) && /\b(jurusan|prodi|mengambil|ambil|dapat|dapet|di\s+utb|utb\s+nya|utbnya)\b/.test(q);
  const asksUtbSpecific = /\b(utb|universitas\s+teknologi\s+bandung)\b/.test(q) && /\b(seperti\s+apa|spesifik|khusus|dibanding|beda|bedanya|perbedaan|program\s+lain)\b/.test(q);
  const asksHowToJoin = /\b(cara|bagaimana|gimana|gmn|mengikuti|ikut|daftar|mendaftar|alur|prosedur|syarat|persyaratan)\b/.test(q);
  const asksMeaning = /\b(apa\s+itu|maksudnya|pengertian|jelaskan|seperti\s+apa)\b/.test(q);
  const asksTimeline = /\b(?:skema|timeline|berapa\s+tahun|berapa\s+lama|tahun\s+di)\b/i.test(q);
  if (/\bjepang\b/i.test(q) && /\b(?:magang|double\s*degree|dual\s*degree|dua\s+gelar|gelar\s+ganda|hi\s*-?\s*think)\b/i.test(q)) {
    return {
      answer: 'Program ke Jepang di ITB STIKOM Bali adalah Program Hi-Think, yaitu program persiapan magang dan kerja di perusahaan teknologi Jepang (bukan program gelar ganda/double degree). Program double degree resmi STIKOM Bali bermitra dengan HELP University Malaysia, DNUI China, dan UTB Bandung.',
      source: 'semantic-rag-dual-degree',
      contexts: [
        { source: ddDocName, text: 'Program Double Degree Internasional STIKOM Bali bekerja sama dengan HELP University Malaysia dan DNUI China.' },
        { source: 'QNA Bot - Hi-Think.docx', text: 'Program Hi-Think adalah program kolaborasi antara ITB STIKOM Bali dengan perusahaan teknologi Hi-Think Jepang, yang menggabungkan perkuliahan dengan kurikulum industri teknologi Jepang serta persiapan magang/peluang kerja.' }
      ]
    };
  }
  const asksToefl = isLanguageScoreQuery || /\b(?:toefl|ielts|bahasa\s+inggris|kemampuan\s+bahasa|skor|score)\b/i.test(q);

  if (asksToefl && (hasPartnerSignal || asksInternational || hasDoubleDegreeSignal)) {
    return {
      answer: 'Saya belum menemukan angka skor minimal TOEFL/IELTS yang dinyatakan resmi untuk Program Double Degree HELP University Malaysia pada data yang tersedia. Kemampuan bahasa Inggris tetap termasuk hal yang perlu dipenuhi, tetapi ambang skor terbarunya perlu dikonfirmasi ke pengelola program internasional atau Admin PMB agar tidak keliru.',
      source: 'semantic-rag-dual-degree',
      contexts: [{ source: ddDocName, text: 'Program Double Degree internasional ITB STIKOM Bali dengan HELP University Malaysia.' }]
    };
  }

  const pairLines = [
    '- UTB - Universitas Teknologi Bandung: Prodi di STIKOM Bali adalah Bisnis Digital; jurusan di UTB adalah DKV (Desain Komunikasi Visual).',
    '- DNUI - Dalian Neusoft University of Information, China: Prodi di STIKOM Bali adalah Bisnis Digital; jurusan di DNUI belum tercantum pada data yang tersedia.',
    '- HELP University, Malaysia: Prodi di STIKOM Bali adalah Sistem Informasi; jurusan di HELP belum tercantum pada data yang tersedia.'
  ];
  const internationalLines = [
    '- DNUI - Dalian Neusoft University of Information, China: Prodi di STIKOM Bali adalah Bisnis Digital; jurusan di DNUI belum tercantum pada data yang tersedia.',
    '- HELP University, Malaysia: Prodi di STIKOM Bali adalah Sistem Informasi; jurusan di HELP belum tercantum pada data yang tersedia.'
  ];
  const nationalLines = [
    '- UTB - Universitas Teknologi Bandung: Prodi di STIKOM Bali adalah Bisnis Digital; jurusan di UTB adalah DKV (Desain Komunikasi Visual).'
  ];
  const PARTNER_REGISTRY = {
    dnui: {
      key: 'dnui',
      label: 'DNUI - Dalian Neusoft University of Information, China',
      shortLabel: 'DNUI',
      match: /\b(?:dnui|dalian\s+neusoft|china|cina|tiongkok)\b/i,
      stikomProgram: 'Bisnis Digital',
      partnerProgram: null,
      degrees: {
        combined: 'Sarjana Bisnis (S.Bns) dari ITB STIKOM Bali dan Bachelor of Management (B.M) dari DNUI China'
      },
      evidenceSnippet: 'Melalui Kolaborasi ITB STIKOM Bali dengan DNUI China terbentuklah Program Dual Degree International... setelah lulus Mahasiswa memperoleh dua gelar sekaligus yaitu S.Bns (Sarjana Bisnis) dan B.M (Bachelor of Management)'
    },
    help: {
      key: 'help',
      label: 'HELP University, Malaysia',
      shortLabel: 'HELP University',
      match: /\b(?:help\s+university|help\b.*malaysia|malaysia|help)\b/i,
      stikomProgram: 'Sistem Informasi',
      partnerProgram: null,
      degrees: {
        combined: 'Sarjana Komputer (S.Kom) dari ITB STIKOM Bali dan Bachelor of Information Technology (BIT) dari HELP University Malaysia'
      },
      evidenceSnippet: 'Melalui Kolaborasi antara ITB STIKOM Bali dengan HELP University terbentuklah program Dual Degree International... mendapatkan dua gelar sekaligus (S.Kom dan BIT).'
    },
    utb: {
      key: 'utb',
      label: 'UTB - Universitas Teknologi Bandung',
      shortLabel: 'UTB',
      match: /\b(?:utb|universitas\s+teknologi\s+bandung|bandung)\b/i,
      stikomProgram: 'Bisnis Digital',
      partnerProgram: 'DKV (Desain Komunikasi Visual)',
      degrees: {
        combined: 'Sarjana Bisnis (S.Bns) dari ITB STIKOM Bali dan Sarjana Desain (S.Ds) dari UTB'
      },
      evidenceSnippet: 'Kolaborasi Program Studi S1-Bisnis Digital ITB STIKOM Bali dan S1- DKV UTB... Mahasiswa akan mendapatkan dua gelar (Sarjana Bisnis dan Sarjana Disain)'
    }
  };

  const asksAllPartnersExplicit = /\b(?:semua|seluruh|apa\s+saja|apa\s+aja|daftar\s+partner|daftar\s+mitra|mitra\s+yang\s+tersedia|partner\s+yang\s+tersedia|semua\s+partner|semua\s+mitra)\b/i.test(q)
    && (hasDoubleDegreeSignal || hasPartnerSignal);
  const explicitRequestedPartners = Object.values(PARTNER_REGISTRY).filter(p => p.match.test(q));

  let targetPartners = [];
  let scopeMode = 'UNKNOWN';
  if (asksAllPartnersExplicit) {
    targetPartners = Object.values(PARTNER_REGISTRY);
    scopeMode = 'OVERVIEW_ALL';
  } else if (explicitRequestedPartners.length > 0) {
    targetPartners = explicitRequestedPartners;
    scopeMode = explicitRequestedPartners.length > 1 ? 'EXPLICIT_SET' : 'SINGLE_ENTITY';
  }

  const asksDnui = /\b(dnui|dalian\s+neusoft|china|cina|tiongkok)\b/.test(q);
  const asksHelp = /\b(help\s+university|help\b.*malaysia|malaysia|help)\b/.test(q);

  if (asksCredentialOutcome && targetPartners.length > 0) {
    if (scopeMode === 'SINGLE_ENTITY') {
      const p = targetPartners[0];
      return {
        answer: `Pada Program Double Degree ${p.shortLabel}, mahasiswa memperoleh dua gelar: ${p.degrees.combined}.`,
        source: 'semantic-rag-dual-degree',
        contexts: [{ source: ddDocName, text: p.evidenceSnippet }]
      };
    }
    const lines = [
      'Gelar yang diperoleh pada Program Double Degree untuk mitra yang ditanyakan:',
      ''
    ];
    const contexts = [];
    for (const p of targetPartners) {
      lines.push(`- **${p.shortLabel}**: Mahasiswa memperoleh dua gelar yaitu ${p.degrees.combined}.`);
      contexts.push({ source: ddDocName, text: p.evidenceSnippet });
    }
    return {
      answer: lines.join('\n'),
      source: 'semantic-rag-dual-degree',
      contexts
    };
  }

  if (scopeMode === 'EXPLICIT_SET' && !asksUtbSpecific) {
    const lines = [
      'Berikut pasangan prodi/jurusan Double Degree untuk mitra yang ditanyakan:',
      ''
    ];
    for (const p of targetPartners) {
      if (p.partnerProgram) {
        lines.push(`- ${p.label}: Prodi di STIKOM Bali adalah ${p.stikomProgram}; jurusan di ${p.shortLabel} adalah ${p.partnerProgram}.`);
      } else {
        lines.push(`- ${p.label}: Prodi di STIKOM Bali adalah ${p.stikomProgram}; jurusan di ${p.shortLabel} belum tercantum pada data yang tersedia.`);
      }
    }
    const hasUnspecified = targetPartners.some(p => !p.partnerProgram);
    if (hasUnspecified) {
      const unspecifiedNames = targetPartners.filter(p => !p.partnerProgram).map(p => p.shortLabel).join(' dan ');
      lines.push('');
      lines.push(`Catatan: untuk ${unspecifiedNames}, data yang tersedia baru mencantumkan prodi di sisi STIKOM Bali. Nama jurusan di kampus mitra belum tercantum, jadi saya tidak menebak di luar data.`);
    }
    return {
      answer: lines.join('\n'),
      source: 'semantic-rag-dual-degree'
    };
  }

  if (asksTimeline && asksHelp) {
    return {
      answer: [
        'Berdasarkan informasi Program Dual Degree International dengan HELP University Malaysia:',
        '',
        '- Durasi studi: 4 tahun penuh, dengan seluruh proses perkuliahan dilaksanakan di kampus ITB STIKOM Bali.',
        '- Kampus mitra: HELP University, Malaysia.',
        '- Gelar yang diperoleh: Sarjana Komputer (S.Kom) dari ITB STIKOM Bali dan Bachelor of Information Technology (BIT) dari HELP University.'
      ].join('\n'),
      source: 'semantic-rag-dual-degree',
      contexts: [{ source: ddDocName, text: 'Melalui Kolaborasi antara ITB STIKOM Bali dengan HELP University terbentuklah program Dual Degree International. Pada program ini mahasiswa mengikuti seluruh perkuliahan di ITB STIKOM BALI selama 4 tahun dan mendapatkan dua gelar sekaligus (S.Kom dan BIT).' }]
    };
  }

  if ((asksStudyMode || asksTimeline) && asksNational) {
    return {
      answer: [
        'Berdasarkan dokumen resmi Program Double Degree Nasional ITB STIKOM Bali dengan UTB (Universitas Teknologi Bandung):',
        '',
        '- Perkuliahan diselenggarakan di ITB STIKOM Bali.',
        '- Pada semester delapan, mahasiswa mengikuti kuliah praktik offline selama 2 bulan di Bandung untuk memamerkan produk mahasiswa.',
        '',
        'Program ini memadukan S1 Bisnis Digital ITB STIKOM Bali dan S1 DKV UTB dengan perolehan dua gelar: Sarjana Bisnis dan Sarjana Desain.'
      ].join('\n'),
      source: 'semantic-rag-dual-degree',
      contexts: [{ source: ddDocName, text: 'Perkuliahan ini diadakan di ITB STIKOM BALI, sedangkan di semester delapan dua hanya dua bulan kebandung untuk melakukan kuliah praktek di Bandung untuk memamerkan produk mahasiswa. Mahasiswa akan mendapatkan dua gelar (Sarjana Bisnis dan Sarjana Disain)' }]
    };
  }

  if (asksDnui && !asksHelp && !asksNational) {
    return {
      answer: [
        'Double Degree DNUI adalah program Double Degree internasional ITB STIKOM Bali dengan Dalian Neusoft University of Information, China.',
        '',
        '- Kampus mitra: DNUI - Dalian Neusoft University of Information, China',
        '- Prodi di ITB STIKOM Bali: Bisnis Digital',
        '- Jurusan di DNUI: belum tercantum pada data yang tersedia',
        '',
        'Jadi, untuk DNUI, data yang aman disebutkan adalah partner internasionalnya dan prodi STIKOM Bali yang terkait. Saya tidak menebak nama jurusan DNUI karena belum ada di data.'
      ].join('\n')
    };
  }

  if (asksHelp && !asksDnui && !asksNational) {
    return {
      answer: [
        'Double Degree HELP University adalah program Double Degree internasional ITB STIKOM Bali dengan HELP University, Malaysia.',
        '',
        '- Kampus mitra: HELP University, Malaysia',
        '- Prodi di ITB STIKOM Bali: Sistem Informasi',
        '- Jurusan di HELP University: belum tercantum pada data yang tersedia',
        '',
        'Jadi, untuk HELP University, data yang aman disebutkan adalah partner internasionalnya dan prodi STIKOM Bali yang terkait. Saya tidak menebak nama jurusan HELP karena belum ada di data.'
      ].join('\n')
    };
  }

  if (asksUtbPair) {
    return {
      answer: [
        'Untuk Double Degree Nasional dengan UTB, pasangannya adalah:',
        '',
        '- Prodi di ITB STIKOM Bali: Bisnis Digital',
        '- Jurusan di UTB: DKV (Desain Komunikasi Visual)',
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
        '- Prodi di ITB STIKOM Bali: Bisnis Digital',
        '- Jurusan di UTB: DKV (Desain Komunikasi Visual)',
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
        '- Jalurnya National Class/nasional, bukan International Class.',
        '- Kampus mitranya adalah UTB - Universitas Teknologi Bandung.',
        '- Untuk sisi STIKOM Bali, prodi yang terkait adalah Bisnis Digital.',
        '- Untuk sisi UTB, jurusan yang diambil adalah DKV (Desain Komunikasi Visual).',
        '- Berbeda dari DNUI dan HELP yang masuk jalur internasional.',
        '',
        'Jadi, kalau pertanyaannya pasangan UTB dan STIKOM Bali, jawabannya: STIKOM Bali Bisnis Digital, UTB DKV (Desain Komunikasi Visual).'
      ].join('\n')
    };
  }

  if (asksHowToJoin && hasDoubleDegreeSignal && !asksMeaning && !asksAllPairs && !asksUtbMajor && !asksUtbPair && !asksUtbSpecific) {
    return {
      answer: [
        'Untuk mengikuti program Double Degree, kakak perlu mendaftar atau mengajukan minat melalui jalur PMB/admin kampus sesuai program mitra yang dipilih.',
        '',
        'Gambaran langkah amannya:',
        '',
        '- Pilih program Double Degree yang diminati: UTB, DNUI, atau HELP University.',
        '- Konfirmasi ke Admin PMB mengenai syarat, jadwal, kuota, dokumen, dan skema akademiknya.',
        '- Siapkan dokumen pendaftaran sesuai arahan kampus.',
        '- Ikuti proses seleksi/verifikasi jika program tersebut mensyaratkan seleksi.',
        '',
        'Detail teknis seperti syarat peserta, jadwal keberangkatan/perkuliahan, dokumen, dan alur final bisa berbeda per mitra, jadi bagian itu perlu dikonfirmasi ke Admin PMB ITB STIKOM Bali.'
      ].join('\n'),
      frameSource: 'semantic-rag-direct-answer'
    };
  }

  if (asksInternational && !asksNational) {
    return {
      answer: [
        'Ya, ada program Double Degree internasional di ITB STIKOM Bali:',
        '',
        ...internationalLines,
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
        ...nationalLines,
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
      asksInternational
        ? 'Pilihan internasional yang tersedia:'
        : (asksNational ? 'Pilihan nasional yang tersedia:' : 'Pilihan yang tersedia:'),
      ...(asksInternational ? internationalLines : (asksNational ? nationalLines : pairLines)),
      '',
      asksInternational
        ? 'Kalau kakak mau, saya bisa jelaskan detail program DNUI atau HELP.'
        : (asksNational ? 'Kalau kakak mau, saya bisa jelaskan detail program UTB.' : 'Kalau kakak mau, saya bisa jelaskan detail program UTB, DNUI, atau HELP.')
    ].join('\n')
  };
}

function tryCareerAnswer(question, options = {}) {
  const q = String(question || '').toLowerCase();
  if (/\b(double\s*degree(?:nya)?|dual\s*degree(?:nya)?|dd)\b/.test(q)) return null;
  if (/\b(?:gelar(?:nya)?|ijazah(?:nya)?|titel(?:nya)?)\b/i.test(q)) return null;
  const isCareerFromFrame = Boolean(
    (options.effectiveSemanticFrame || options.__effectiveSemanticFrame)?.domain?.primary === 'career'
    || (options.effectiveSemanticFrame || options.__effectiveSemanticFrame)?.requestedFields?.some(f => ['careerOutcome', 'careerProspects', 'careerProspect', 'jobRoles'].includes(f))
    || options.__contextAuthority?.activeField === 'careerOutcome'
    || options.__contextAuthority?.activeDomain === 'career'
    || options.conversationState?.activeField === 'careerOutcome'
    || options.sessionData?.conversationState?.activeField === 'careerOutcome'
  );
  if (!isCareerFromFrame && !/\b(?:prospek(?:nya)?|kerja(?:nya)?|bekerja(?:nya)?|karir(?:nya)?|karier(?:nya)?|lulusan(?:nya)?|tamat(?:nya)?|peluang(?:nya)?|profesi(?:nya)?|pekerjaan(?:nya)?|bidang(?:nya)?|bisa\s+(?:kerja|bekerja|jadi|menjadi)|jadi\s+apa|kerja\s+apa|kerjanya\s+apa|profesi\s+apa|setelah\s+(?:tamat|lulus))\b/i.test(q)) return null;
  let program = detectProgram(question);
  if (!program && options && options.programHint) {
    const hintProgs = detectProgramsFromHint(options.programHint);
    if (hintProgs.length) program = hintProgs[0];
  }
  if (!program && options && options.sessionData) {
    const sessionProgs = detectProgramsFromSessionData(options.sessionData);
    if (sessionProgs.length) program = sessionProgs[0];
  }
  if (!program && options) {
    if (options.resolvedContext && (options.resolvedContext.targetEntity || options.resolvedContext.activeEntity)) {
      const target = options.resolvedContext.targetEntity || options.resolvedContext.activeEntity;
      if (target && target.canonical) {
        program = detectProgram(target.canonical);
      }
    }
    const optCanon = options.canonical || (options.options && options.options.canonical) || options.__canonicalQueryUnderstanding;
    if (!program && optCanon && optCanon.entities) {
      const progs = Array.isArray(optCanon.entities.programs) ? optCanon.entities.programs : (Array.isArray(optCanon.entities) ? optCanon.entities.filter(e => e.group === 'programs' || e.type === 'program') : []);
      if (progs.length > 0) {
        const cp = progs[0];
        const rawK = cp.key || cp.code || cp.normalized || cp.canonical || cp.name;
        const normKey = (function(k) {
          const t = String(k || '').toLowerCase();
          if (/^si$|sistem.*informasi/.test(t)) return 'si';
          if (/^ti$|teknologi.*informasi|informatika/.test(t)) return 'ti';
          if (/^bd$|bisnis.*digital/.test(t)) return 'bd';
          if (/^sk$|sistem.*komputer/.test(t)) return 'sk';
          if (/^mi$|manajemen.*informatika|^d3$/.test(t)) return 'mi';
          return t;
        })(rawK);
        const cpLabel = (PROGRAM_META[normKey] && PROGRAM_META[normKey].label) || cp.label || cp.name || cp.canonical;
        if (normKey) {
          program = { key: normKey, label: cpLabel || normKey, family: (PROGRAM_META[normKey] && PROGRAM_META[normKey].family) || 's1' };
        }
      }
    }
    const frame = options.effectiveSemanticFrame || options.__effectiveSemanticFrame;
    if (!program && frame) {
      const frameProg = frame.resolvedBindings?.program || frame.entities?.find(e => e.group === 'programs' || e.type === 'program')?.canonical;
      if (frameProg) {
        program = detectProgram(frameProg);
      }
    }
  }
  if (!program) return null;
  const domain = readProgramDomain(program.key);
  const topicMatch = (function() {
    const fromQ = (typeof detectCurriculumTopic === 'function') ? detectCurriculumTopic(q) : null;
    if (fromQ) return fromQ;
    const optCanon = options.canonical || (options.options && options.options.canonical) || options.__canonicalQueryUnderstanding;
    return (optCanon && optCanon.constraints && optCanon.constraints.curriculumTopic) || null;
  })();
  const topicAddon = (topicMatch && topicMatch.key === 'artificial_intelligence')
    ? '\n\nUntuk bidang Artificial Intelligence (AI), peluang dan prospek karier bagi lulusan ' + program.label + ' juga sangat terbuka dan banyak dicari di era transformasi digital serta industri teknologi saat ini.'
    : '';
  if (domain && domain.prospek) {
    return {
      answer: [
        `Prospek kerja lulusan ${program.label}:`,
        '',
        domain.prospek + topicAddon,
        '',
        `Secara umum, ${program.label} cocok untuk kakak yang ingin membangun karier di bidang ${program.key === 'si' ? 'analisis bisnis, sistem informasi, data, dan transformasi digital' : program.key === 'ti' ? 'software, infrastruktur IT, cloud, jaringan, kemanan, dan aplikasi digital' : program.key === 'sk' ? 'integrasi hardware-software, IoT, otomasi, jaringan, dan infrastruktur' : program.key === 'bd' ? 'pemasaran digital, growth, e-commerce, pengembangan bisnis, produk digital, dan wirausaha' : 'pengembangan aplikasi, pengelolaan data, IT support, dan administrasi sistem informasi'}.`
      ].join('\n'),
      source: 'semantic-rag-career',
      frameSource: 'semantic-rag-career'
    };
  }
  return null;
}

const OFFICIAL_FEE_PROVENANCE = {
  authority: 'OFFICIAL_PMB_CATALOG',
  sourceType: 'deterministic_fee_catalog',
  catalogName: 'pmb_fee_catalog'
};

function wrapWithFeeProvenance(fn) {
  return function(...args) {
    const res = fn(...args);
    if (res && typeof res === 'object' && res.answer && !res.provenance) {
      res.provenance = OFFICIAL_FEE_PROVENANCE;
    }
    if (res && typeof res === 'object' && !Array.isArray(res.contexts)) {
      const profileChunks = res.profile && Array.isArray(res.profile.chunks)
        ? res.profile.chunks
        : [];
      if (profileChunks.length) {
        const exactTokens = [
          ...String(res.answer || '').matchAll(/rp\.?\s*([\d.,]+)/gi),
          ...String(res.answer || '').matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|sks)\b/gi)
        ].map(match => String(match[1] || '').replace(/\D/g, '')).filter(Boolean);
        const compatibleFeeChunks = profileChunks.filter((chunk) => {
          const content = String(chunk && (chunk.chunk || chunk.text || chunk.content) || '');
          const source = String(chunk && (chunk.filename || chunk.sourceFile || chunk.docCategory || chunk.category) || '');
          const isFeeEvidence = /biaya|fee|pmb/i.test(source);
          if (!isFeeEvidence) return false;
          if (!exactTokens.length) return true;
          const digits = content.replace(/\D/g, '');
          return exactTokens.some(token => digits.includes(token));
        });
        if (compatibleFeeChunks.length) res.contexts = compatibleFeeChunks;
      }
    }
    return res;
  };
}

module.exports = {
  extractProfiles,
  tryFeeComparisonAnswer: wrapWithFeeProvenance(tryFeeComparisonAnswer),
  tryDetailedFeeAnswer: wrapWithFeeProvenance(tryDetailedFeeAnswer),
  tryRegistrationFeeAnswer: wrapWithFeeProvenance(tryRegistrationFeeAnswer),
  tryGeneralFeeQuestionAnswer: wrapWithFeeProvenance(tryGeneralFeeQuestionAnswer),
  tryDualDegreeAnswer,
  tryProgramListAnswer,
  tryProgramRecommendationAnswer,
  tryProgramComparisonAnswer,
  tryProgramDefinitionAnswer,
  tryScholarshipAnswer,
  tryCareerAnswer,
  tryContextualMultiProgramFeeAnswer: wrapWithFeeProvenance(tryContextualMultiProgramFeeAnswer),
  detectProgram,
  detectProgramsFromHint,
  detectProgramsFromSessionData,
  formatRp,
  formatRange,
  isRegistrationFeeQuestion,
  invalidateFeeProfilesCache,
  OFFICIAL_FEE_PROVENANCE
};
