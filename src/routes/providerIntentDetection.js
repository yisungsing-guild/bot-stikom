const PROGRAM_MAP = {
  'teknologi informasi': 'Teknologi Informasi',
  'sistem informasi': 'Sistem Informasi',
  'bisnis digital': 'Bisnis Digital',
  'sistem komputer': 'Sistem Komputer',
  'manajemen informatika': 'Manajemen Informatika'
};

const { normalizeUserQuery } = require('../utils/queryNormalizer');

function normalizeText(text) {
  return normalizeUserQuery(text || '').normalizedText;
}

function isPureGreetingRestart(text) {
  const t = normalizeText(text);
  if (!t) return false;

  const allowTail = '(?:kak|kakak|admin|min|bot|cs|pak|bapak|ibu|bu|bang|bng)';
  const simpleGreeting = new RegExp(
    `^(?:halo|hallo|hai|hi|hello|assalamualaikum|salam|permisi|selamat pagi|selamat siang|selamat sore|selamat malam|met pagi|met siang|met sore|met malam)(?: ${allowTail})?$`
  , 'i');
  if (simpleGreeting.test(t)) return true;

  if (/^hal+o+(?: (?:kak|admin|min|bot|cs|pak|ibu|bu|bang))?$/.test(t)) return true;
  if (/^assalamu(?: |)alaikum(?: (?:kak|admin|min|bot|cs|pak|ibu|bu|bang))?$/.test(t)) return true;
  return false;
}

function extractProgramHint(text) {
  const raw = String(text || '');
  const t = normalizeText(raw);
  if (!t) return null;

  if (/manajemen informatika|manajemen informasi/i.test(raw)) return 'Manajemen Informatika';
  if (/teknologi informasi/i.test(raw)) return 'Teknologi Informasi';
  if (/sistem informasi/i.test(raw)) return 'Sistem Informasi';
  if (/bisnis digital/i.test(raw)) return 'Bisnis Digital';
  if (/sistem komputer/i.test(raw)) return 'Sistem Komputer';

  const explicit = /(program studi|prodi|jurusan)\s*[:\-]?\s*(ti|si|bd|sk|mi)\b/i.exec(raw);
  if (explicit && explicit[2]) {
    const code = explicit[2].toLowerCase();
    if (code === 'ti') return 'Teknologi Informasi';
    if (code === 'si') return 'Sistem Informasi';
    if (code === 'bd') return 'Bisnis Digital';
    if (code === 'sk') return 'Sistem Komputer';
    if (code === 'mi') return 'Manajemen Informatika';
  }

  const contextSignal = /\b(biaya|pendaftaran|registrasi|rincian|detail|dpp|semester|gelombang|kuliah|uang kuliah|program studi|prodi|jurusan)\b/i.test(raw);
  if (contextSignal) {
    const loose = /\b(ti|si|bd|sk|mi)\b/i.exec(raw);
    if (loose && loose[1]) {
      const code = loose[1].toLowerCase();
      if (code === 'ti') return 'Teknologi Informasi';
      if (code === 'si') return 'Sistem Informasi';
      if (code === 'bd') return 'Bisnis Digital';
      if (code === 'sk') return 'Sistem Komputer';
      if (code === 'mi') return 'Manajemen Informatika';
    }
  }

  // Fallback for direct short program code mentions without explicit context keywords.
  const directCode = /\b(si|ti|bd|sk|mi)\b/i.exec(raw);
  if (directCode && !/\b(?:siapa|sistem|literasi|musi|visi|diskusi)\b/i.test(raw)) {
    const code = directCode[1].toLowerCase();
    if (code === 'ti') return 'Teknologi Informasi';
    if (code === 'si') return 'Sistem Informasi';
    if (code === 'bd') return 'Bisnis Digital';
    if (code === 'sk') return 'Sistem Komputer';
    if (code === 'mi') return 'Manajemen Informatika';
  }

  if (looksLikeProgramSpecificQuestion(raw)) {
    const loose = /\b(ti|si|bd|sk|mi|utb|dnui|help)\b/i.exec(raw);
    if (loose && loose[1]) {
      const code = loose[1].toLowerCase();
      if (code === 'ti') return 'Teknologi Informasi';
      if (code === 'si') return 'Sistem Informasi';
      if (code === 'bd') return 'Bisnis Digital';
      if (code === 'sk') return 'Sistem Komputer';
      if (code === 'mi') return 'Manajemen Informatika';
      if (code === 'utb') return 'UTB';
      if (code === 'dnui') return 'DNUI';
      if (code === 'help') return 'HELP';
    }
  }

  return null;
}

function extractNonS1ProgramHint(text) {
  const t = normalizeText(text);
  if (!t) return null;

  if (/(?:\bd3\b|diploma)/i.test(t) && /manajemen informatika/i.test(t)) return 'D3 Manajemen Informatika';
  if (/\b(s2|pascasarjana|pasca sarjana|magister|master)\b/i.test(t)) return 'S2 Sistem Informasi (SI)';
  if (/\butb\b/i.test(t)) return 'UTB';
  if (/\bdnui\b/i.test(t)) return 'DNUI';
  if (/\bhelp\b/i.test(t) && /\b(program|dual degree|degree)\b/i.test(t)) return 'HELP';

  return null;
}

function extractSpecificProgramHint(text) {
  return extractNonS1ProgramHint(text) || extractProgramHint(text) || null;
}

function looksLikeProgramSpecificQuestion(text) {
  const t = normalizeText(text);
  if (!t) return false;
  if (/\bapa\s+itu\b/i.test(text) && /\b(si|ti|bd|sk|mi|utb|dnui|help)\b/i.test(text)) return true;
  if (t.includes('?')) return true;
  return /\b(berapa|kapan|dimana|di mana|gimana|bagaimana|rincian|detail|lengkap|biaya|bayar|dibayar|pembayaran|potongan|diskon|gelombang|jadwal|syarat|kontak|alamat|email|website|wa|whatsapp|telepon|telp)\b/i.test(text);
}

function detectIntentDetails(question) {
  const raw = String(question || '');
  const q = normalizeText(raw);

  const programCodeRe = /\b(si|ti|sk|bd|mi|dkv|trpl|tk|mm|an|dg|rpl)\b/i;
  const waveCodeRe = /\b(1[a-c]|2[a-c]|3[a-c]?|4[a-c]?|khusus|i{1,4}|iv)\b/i;
  const programNameRe = /\b(sistem informasi|teknologi informasi|bisnis digital|sistem komputer|manajemen informatika|desain komunikasi visual|rekayasa perangkat lunak|teknologi komputer|multimedia|animasi|desain grafis)\b/i;
  const programMention = programCodeRe.test(q) || programNameRe.test(q) || /\b(program studi|prodi|jurusan|program)\b/i.test(q);

  const feeSignal = /\b(?:biaya|harga|mahal|murah|dpp|ukt|spp|potongan|diskon|bayar|cicil|angsuran|uang\s*kuliah|tarif|tagihan|nominal|fee)\b/i.test(q);
  const scholarshipSignal = /\b(?:beasiswa|scholarship|kip|1k1s|skss|potongan|diskon|bantuan\s+pendidikan)\b/i.test(q);
  const scheduleSignal = /\b(?:jadwal|gelombang|tanggal|deadline|kapan|waktu|periode|registrasi|pendaftaran|daftar\s+ulang|tutup|mulai|penutupan)\b/i.test(q);
  const accreditationSignal = /\b(?:akreditasi|akrediasi|peringkat|rank|ban\s*-?pt|sk\s+akreditasi|terakreditasi)\b/i.test(q);
  const locationSignal = /\b(?:lokasi|alamat|kampus|denpasar|china|bali|malaysia|cabang)\b/i.test(q);
  const ukmSignal = /\b(?:ukm|ormawa|organisasi mahasiswa|unit kegiatan mahasiswa|esport|esports|musik|futsal|teater|teater biner|vos)\b/i.test(q);
  const academicSignal = /\b(?:apa\s+itu|apa\s+yang\s+dipelajari|belajar\s+apa|mata\s+kuliah|kurikulum|fokus|prospek\s+kerja|karir|skill|keahlian|bidang\s+keahlian|peluang|profesi|lulusan|mempelajari|dipelajari)\b/i.test(q);
  const careerSignal = /\b(?:coding|ngoding|programmer|software\s+engineer|software\s+developer|data\s+analyst|ai\s+engineer|cyber\s+security|cybersecurity|data scientist)\b/i.test(q);
  const comparisonSignal = /\b(?:perbedaan|beda|bandingkan|versus|vs|lebih\s+baik|mana)\b/i.test(q);
  const registrationSignal = /\b(?:pmb|penerimaan\s+mahasiswa\s+baru|pendaftaran|registrasi)\b/i.test(q);
  const explicitQuestion = /\b(?:apa|apakah|bagaimana|gimana|berapa|kapan|dimana|di\s+mana|kenapa|mengapa|boleh|bisa|ada)\b/i.test(q);
  const greetingRestart = isPureGreetingRestart(raw);
  const smallTalkSignal = /\b(?:halo|hallo|hai|hi|selamat\s+pagi|selamat\s+siang|selamat\s+sore|selamat\s+malam|apa\s+kabar|kabar\s+apa|gimana\s+kabar|kabar\s+kamu|kamu\s+siapa|siapa\s+kamu|nama\s+kamu|ceritakan\s+dirimu|ceritakan\s+tentang\s+dirimu|cerita|ngobrol|obrol|film|lagu|musik|hobi|olahraga|cuaca|berita|mau\s+ngobrol|mau\s+chat|mau\s+bercerita|makasih|terima\s+kasih|sama\s*-?sama)\b/i.test(q);

  const candidates = {
    COST: 0,
    ACADEMIC_PROGRAM: 0,
    PROGRAM: 0,
    SCHOLARSHIP: 0,
    SCHEDULE: 0,
    ACCREDITATION: 0,
    UKM: 0,
    SMALL_TALK: 0,
    GENERAL: 0
  };

  if (feeSignal) {
    candidates.COST += 3;
    if (programMention) candidates.COST += 1;
    if (waveCodeRe.test(q)) candidates.COST += 1;
  }
  if (scholarshipSignal) {
    candidates.SCHOLARSHIP += 3;
    if (programMention) candidates.SCHOLARSHIP += 0.5;
  }
  if (scheduleSignal) {
    candidates.SCHEDULE += 3;
    if (programMention) candidates.SCHEDULE += 0.5;
  }
  if (accreditationSignal) {
    candidates.ACCREDITATION += 3;
  }
  if (ukmSignal) {
    candidates.UKM += 3;
  }
  if (locationSignal && programMention) {
    candidates.PROGRAM += 1.5;
  }
  if (academicSignal && programMention) {
    candidates.ACADEMIC_PROGRAM += 3;
  }
  if (careerSignal && programMention) {
    candidates.ACADEMIC_PROGRAM += 2.5;
  }
  if (comparisonSignal && programMention) {
    candidates.PROGRAM += 1.5;
  }
  if (programMention) {
    candidates.PROGRAM += 1;
  }
  if (registrationSignal && !feeSignal && !scheduleSignal) {
    candidates.GENERAL += 1.5;
  }
  if (smallTalkSignal && !programMention && !feeSignal && !scholarshipSignal && !scheduleSignal && !accreditationSignal && !ukmSignal && !locationSignal) {
    candidates.SMALL_TALK += 2.5;
  }
  if (explicitQuestion && !programMention && !feeSignal && !scholarshipSignal && !scheduleSignal && !accreditationSignal && !ukmSignal && !locationSignal) {
    candidates.GENERAL += 0.75;
  }
  if (greetingRestart) {
    candidates.SMALL_TALK += 1;
  }

  const sorted = Object.entries(candidates).sort((a, b) => b[1] - a[1]);
  let label = sorted[0][0];
  const topScore = sorted[0][1];
  const secondScore = sorted[1] ? sorted[1][1] : 0;

  if (topScore <= 0) {
    label = 'GENERAL';
  }

  if (label === 'PROGRAM' && academicSignal) {
    label = 'ACADEMIC_PROGRAM';
  }

  const confidence = Math.min(0.99, Math.max(0.2, topScore / 5 + 0.15) * (secondScore >= topScore * 0.8 ? 0.7 : 1));
  const isAmbiguous = topScore > 0 && secondScore >= topScore * 0.75;
  const isUnderSpecified = topScore <= 0 && !programMention && !feeSignal && !scholarshipSignal && !scheduleSignal && !accreditationSignal && !ukmSignal;

  return {
    label,
    confidence,
    isAmbiguous,
    isUnderSpecified,
    scores: candidates,
    entities: {
      program: extractSpecificProgramHint(raw),
      wave: waveCodeRe.test(q) ? q.match(waveCodeRe)[0] : null,
      academicIntent: null
    }
  };
}

function detectIntent(question) {
  return detectIntentDetails(question).label;
}

module.exports = {
  detectIntent,
  detectIntentDetails
};
