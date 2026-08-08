const { evaluateGenericAnswerability, detectGenericIntent } = require('../src/engine/semanticRagEngine');
const { getEvidenceRequirements } = require('../src/utils/evidenceRequirements');

function normalizeForLexicalMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUERY_ANCHOR_STOPWORDS = new Set([
  'apa', 'apakah', 'bagaimana', 'gimana', 'berapa', 'kapan', 'dimana', 'mana',
  'yang', 'dan', 'atau', 'untuk', 'dengan', 'pada', 'dari', 'ke', 'di', 'itu',
  'ini', 'ada', 'bisa', 'boleh', 'mau', 'ingin', 'saya', 'aku', 'kamu', 'kak',
  'kakak', 'min', 'admin', 'tolong', 'mohon', 'dong', 'ya', 'nih', 'nya',
  'jelaskan', 'sebutkan', 'info', 'informasi', 'tentang', 'terkait', 'kalau',
  'jika', 'jadi', 'adalah', 'untuknya', 'tersebut', 'kampus', 'kuliah',
  'pendaftaran', 'daftar', 'biaya', 'harga', 'jadwal', 'syarat', 'dokumen',
  'program', 'studi', 'prodi', 'jurusan', 'tahun', 'ajaran', 'itb', 'stikom',
  'bali', 'institut'
]);

function extractQueryAnchorTerms(text) {
  const normalized = normalizeForLexicalMatch(text);
  if (!normalized) return [];
  const anchors = [];
  const add = (value) => {
    const v = normalizeForLexicalMatch(value);
    if (v && !anchors.includes(v)) anchors.push(v);
  };
  const strongPatterns = [
    /\b(sistem\s+informasi|teknologi\s+informasi|teknik\s+informatika|sistem\s+komputer|bisnis\s+digital|manajemen\s+informatika)\b/gi,
    /\b(double\s+degree|dual\s+degree|student\s+exchange|international\s+program|program\s+internasional)\b/gi,
    /\b(linkedin|career\s+center|career\s+development\s+center|cdc|pusat\s+karier|pusat\s+karir|sion|portal\s+akademik|wisuda|yudisium|skripsi|akreditasi|ban\s*-?\s*pt|rpl|rekognisi\s+pembelajaran\s+lampau|beasiswa|kip|1k1s|skss|dpp|ukt|visa\s+study|visa\s+studi|visa\s+pelajar|izin\s+belajar|study\s+permit|itas|kitas|sktt|inbis|inkubator\s+bisnis|faq|qna|visi|misi|visi\s+misi|website|isian\s+website)\b/gi,
    /\b(gelombang\s+(?:khusus|[0-9]+|[ivx]+)\s*[a-c]?)\b/gi,
    /\b(si|ti|sk|bd|mi|d3|s1|s2|dnui|help|utb)\b/gi
  ];
  for (const pattern of strongPatterns) {
    for (const match of String(text || '').matchAll(pattern)) add(match[1] || match[0]);
  }
  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (token.length < 3) continue;
    if (QUERY_ANCHOR_STOPWORDS.has(token)) continue;
    if (/^\d+$/.test(token) && (token.length < 4 || /^20\d{2}$/.test(token))) continue;
    add(token);
  }
  return anchors.slice(0, 10);
}

function hasAnchorOverlap(question, content) {
  const anchors = extractQueryAnchorTerms(question);
  if (!anchors.length) return true;
  const cNorm = normalizeForLexicalMatch(content);
  return anchors.some((anchor) => {
    const a = normalizeForLexicalMatch(anchor);
    if (!a) return false;
    if (a.length <= 4 || !a.includes(' ')) {
      const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|\\s)' + escaped + '(\\s|$)', 'i').test(cNorm);
    }
    return cNorm.includes(a);
  });
}

const cases = [
  ['Apa itu Sistem Informasi?', [{ text: 'Program Teknologi Informasi fokus pada pemrograman.' }], { intent: 'general' }],
  ['Berapa biaya pendaftaran SI?', [{ text: 'Biaya pendaftaran Sistem Informasi adalah Rp 500.000.' }], { intent: 'fee' }],
  ['biaya teknologi informasi gelombang 1A', [{ text: 'Biaya pendaftaran: Rp. 3.000.000 untuk gelombang 1A.' }], { intent: 'fee' }],
  ['apa syarat KIP', [{ text: 'Syarat beasiswa KIP: daftar online dan dokumen KTP.' }], { intent: 'scholarship' }],
  ['informasi double degree', [{ text: 'Informasi umum tentang Sistem Informasi.' }], { intent: 'international_program' }]
];

for (const [question, evidence, options] of cases) {
  const intent = options.intent || detectGenericIntent(question);
  const combinedText = evidence.map((e) => e.text).join(' ');
  const rules = getEvidenceRequirements(intent, question);
  const questionAnchors = extractQueryAnchorTerms(question);
  const hasCurrency = /\b(Rp\.?|rupiah|\d[\d.,]+\s*(?:juta|ribu|rb|jt|k)?)\b/i.test(combinedText);
  const anchorOverlap = hasAnchorOverlap(question, combinedText);
  const missingEvidence = [];
  if (rules.requireCurrency && !hasCurrency) missingEvidence.push('fee_amount');
  if (questionAnchors.length > 0 && !anchorOverlap) missingEvidence.push('requested_anchor');
  const result = evaluateGenericAnswerability(question, evidence, options);
  console.log(JSON.stringify({
    question,
    intent,
    rules,
    questionAnchors,
    hasCurrency,
    anchorOverlap,
    missingEvidence,
    result
  }, null, 2));
}
