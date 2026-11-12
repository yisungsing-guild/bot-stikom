'use strict';

/**
 * Generic negation handling for semantic aspect selection.
 *
 * This module is a small language-policy utility, not a question/answer ruleset:
 * it maps broad requested-aspect vocabularies to exclusions expressed with common
 * Indonesian/English negation and contrast markers. The semantic parser remains the
 * primary interpreter; this utility protects deterministic fallback and downstream
 * context logic from treating explicitly rejected topics as requested topics.
 */
const NEGATABLE_ASPECT_TERMS = Object.freeze({
  curriculum: /\b(?:kurikulum|mata\s*kuliah|matkul|silabus|courses?|coursework|pembelajaran|materi\s+kuliah|sks)\b/i,
  courses: /\b(?:kurikulum|mata\s*kuliah|matkul|silabus|courses?|coursework|pembelajaran|materi\s+kuliah|sks)\b/i,
  learning: /\b(?:kurikulum|mata\s*kuliah|matkul|silabus|courses?|coursework|pembelajaran|materi\s+kuliah|sks)\b/i,
  fee: /\b(?:biaya|biayanya|bayar|pembayaran|spp|uang\s+kuliah|tarif|tuition|fees?|cost)\b/i,
  tuition: /\b(?:biaya|biayanya|bayar|pembayaran|spp|dpp|uang\s+kuliah|uang\s+gedung|tarif|cicilan|angsuran|tuition|fees?|cost)\b/i,
  dpp: /\b(?:dpp|dana\s+pendidikan\s+pokok|uang\s+gedung|uang\s+pangkal)\b/i,
  accreditation: /\b(?:akreditasi|terakreditasi|ban\s*-?\s*pt|lam\s*-?\s*infokom|accreditation)\b/i,
  akreditasi: /\b(?:akreditasi|terakreditasi|ban\s*-?\s*pt|lam\s*-?\s*infokom|accreditation)\b/i,
  scholarship: /\b(?:beasiswa|kip\s*-?\s*k(?:uliah)?|potongan\s+dpp|potongan\s+biaya|diskon\s+dpp|scholarship|financial\s+aid)\b/i,
  requirements: /\b(?:syarat|persyaratan|ketentuan|kualifikasi|requirements?|eligibility)\b/i,
  career: /\b(?:karir|karier|prospek\s+kerja|peluang\s+kerja|profesi\s+lulusan|career|job\s+prospects?)\b/i,
  career_prospects: /\b(?:karir|karier|prospek\s+kerja|peluang\s+kerja|profesi\s+lulusan|career|job\s+prospects?)\b/i,
  facilities: /\b(?:fasilitas|sarana|prasarana|laboratorium|laboratory|perpustakaan|asrama|parkir|ruang\s+kelas)\b/i,
  facility: /\b(?:fasilitas|sarana|prasarana|laboratorium|laboratory|perpustakaan|asrama|parkir|ruang\s+kelas)\b/i,
  lab: /\b(?:laboratorium|laboratory|lab\b|praktikum)\b/i,
  campus_infrastructure: /\b(?:fasilitas|sarana|prasarana|laboratorium|laboratory|perpustakaan|asrama|parkir|ruang\s+kelas)\b/i,
  location: /\b(?:lokasi|alamat|cabang|tempat|where|address|location)\b/i,
  study_location: /\b(?:lokasi|alamat|cabang|tempat|where|address|location)\b/i,
  campus_location: /\b(?:lokasi|alamat|cabang|tempat|where|address|location)\b/i,
  address: /\b(?:lokasi|alamat|cabang|tempat|where|address|location)\b/i,
  organization: /\b(?:organisasi|ormawa|ukm|unit\s+kegiatan\s+mahasiswa|himpunan|himaprodi|student\s+club)\b/i,
  student_organization: /\b(?:organisasi|ormawa|ukm|unit\s+kegiatan\s+mahasiswa|himpunan|himaprodi|student\s+club)\b/i,
  ukm: /\b(?:organisasi|ormawa|ukm|unit\s+kegiatan\s+mahasiswa|himpunan|himaprodi|student\s+club)\b/i,
  sports: /\b(?:olahraga|futsal|basket|bulutangkis|badminton|fitness|gym|sport)\b/i,
  arts_culture: /\b(?:seni|budaya|tari|musik|teater|paduan\s+suara|fotografi)\b/i,
  schedule: /\b(?:jadwal|tanggal|periode|gelombang|schedule|calendar)\b/i,
  wave_info: /\b(?:jadwal|tanggal|periode|gelombang|schedule|calendar)\b/i,
  procedure: /\b(?:prosedur|alur|tata\s+cara|langkah|proses|procedure|process)\b/i,
  contact: /\b(?:kontak|nomor|telepon|telp|whatsapp|wa\b|email|hotline|contact)\b/i,
  helpdesk: /\b(?:kontak|nomor|telepon|telp|whatsapp|wa\b|email|hotline|helpdesk)\b/i,
  internship: /\b(?:magang|internship|kerja\s+praktik|praktik\s+kerja)\b/i,
  career_services: /\b(?:pusat\s+karier|career\s+center|cdc\b|bursa\s+kerja|job\s+fair)\b/i,
  degree_award: /\b(?:gelar|ijazah|degree|diploma|sarjana|magister)\b/i
});

const NEGATION_CUE = /\b(?:bukan|tidak|tak|enggak|nggak|gak|ga|jangan|tanpa|kurang|belum|not|without)\b/ig;
const STRONG_NEGATION_SCOPE_END = /\b(?:tetapi|tapi|melainkan|namun|sebaliknya|but|however|instead)\b|[;.!?]/i;
const CORRECTIVE_CLAUSE_STARTER = /^(?:yang|saya|aku|kami|kita|tolong|mohon|berapa|apa(?:kah)?|bagaimana|gimana|kapan|dimana|di\s*mana|siapa|mana|fokus|kalau|kalo|coba|maksud(?:nya)?|untuk|soal|tentang|mengenai|terkait|mau|ingin|perlu|butuh|jelaskan|sebutkan|info(?:rmasi)?|biaya|kurikulum|syarat|prosedur|alur|jadwal|akreditasi)\b/i;
const ADDITIVE_NEGATION = /^\s*(?:hanya|saja|cuma|sekadar|sekedar|only|just|merely)\b/i;

/**
 * Finds the end index of a negated clause within the slice following a negation cue.
 * Terminates at strong contrastive/sentence boundaries, and also at commas that introduce
 * a corrective or new positive clause while preserving multi-item negated lists ("A, B, atau C").
 */
function findNegationScopeEnd(afterCue) {
  const strongBoundary = afterCue.search(STRONG_NEGATION_SCOPE_END);
  const maxEnd = strongBoundary >= 0 ? strongBoundary : afterCue.length;
  const segment = afterCue.slice(0, maxEnd);

  let searchFrom = 0;
  while (searchFrom < segment.length) {
    const commaIdx = segment.indexOf(',', searchFrom);
    if (commaIdx < 0) break;

    const afterComma = afterCue.slice(commaIdx + 1).trimStart();
    if (CORRECTIVE_CLAUSE_STARTER.test(afterComma)) {
      return commaIdx;
    }

    const isDirectListConjunction = /^(?:atau|maupun|dan|serta|or|nor|and)\b/i.test(afterComma) &&
      !/^(?:dan|and)\s+(?:yang|saya|aku|kami|kita|tolong|mohon|berapa|apa|bagaimana|gimana|kapan|dimana|di\s*mana|siapa|kalau|kalo)\b/i.test(afterComma);
    const isOngoingListEnumeration = /^[^,;.!?]{1,50},\s*(?:atau|maupun|dan|serta|or|nor|and)\b/i.test(afterComma);

    if (!isDirectListConjunction && !isOngoingListEnumeration) {
      return commaIdx;
    }
    searchFrom = commaIdx + 1;
  }

  return strongBoundary;
}

function collectNegatedAspectScopes(rawQuery) {
  const text = String(rawQuery || '').toLowerCase();
  const scopes = [];
  if (!text) return scopes;

  NEGATION_CUE.lastIndex = 0;
  let cue;
  while ((cue = NEGATION_CUE.exec(text)) !== null) {
    const afterCue = text.slice(cue.index + cue[0].length);
    // "bukan hanya X, tetapi juga Y" / "not only X but Y" is additive.
    if (ADDITIVE_NEGATION.test(afterCue)) continue;

    const boundary = findNegationScopeEnd(afterCue);
    const scope = boundary >= 0 ? afterCue.slice(0, boundary) : afterCue;
    let lastTermEnd = -1;
    const aspects = new Set();

    for (const [aspect, terms] of Object.entries(NEGATABLE_ASPECT_TERMS)) {
      terms.lastIndex = 0;
      const match = terms.exec(scope);
      if (match) {
        aspects.add(aspect);
        lastTermEnd = Math.max(lastTermEnd, match.index + match[0].length);
      }
    }

    if (lastTermEnd >= 0) {
      scopes.push({
        start: cue.index,
        end: cue.index + cue[0].length + lastTermEnd,
        aspects
      });
    }
  }
  return scopes;
}

function collectNegatedClauseScopes(rawQuery) {
  const text = String(rawQuery || '').toLowerCase();
  const scopes = [];
  if (!text) return scopes;

  NEGATION_CUE.lastIndex = 0;
  let cue;
  while ((cue = NEGATION_CUE.exec(text)) !== null) {
    const contentStart = cue.index + cue[0].length;
    const afterCue = text.slice(contentStart);
    if (ADDITIVE_NEGATION.test(afterCue)) continue;
    const boundary = findNegationScopeEnd(afterCue);
    const contentEnd = boundary >= 0 ? contentStart + boundary : text.length;
    const content = text.slice(contentStart, contentEnd).trim();
    if (content) scopes.push({ start: cue.index, end: contentEnd, content });
  }
  return scopes;
}

function normalizeEntityPhrase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function filterNegatedCanonicalEntities(rawQuery, entities = []) {
  if (!Array.isArray(entities) || entities.length === 0) return [];
  const scopes = collectNegatedClauseScopes(rawQuery);
  if (scopes.length === 0) return entities;

  return entities.filter(entity => {
    const aliases = [entity?.matchedAlias, entity?.canonical, entity?.name]
      .map(normalizeEntityPhrase)
      .filter(Boolean);
    if (aliases.length === 0) return true;
    return !scopes.some(scope => {
      const content = ` ${normalizeEntityPhrase(scope.content)} `;
      return aliases.some(alias => content.includes(` ${alias} `));
    });
  });
}

function getNegatedAspectSet(rawQuery) {
  const negated = new Set();
  for (const scope of collectNegatedAspectScopes(rawQuery)) {
    for (const aspect of scope.aspects) negated.add(aspect);
  }
  return negated;
}

function filterNegatedSemanticAspects(rawQuery, aspects = []) {
  if (!Array.isArray(aspects) || aspects.length === 0) return [];
  const negated = getNegatedAspectSet(rawQuery);
  if (negated.size === 0) return [...new Set(aspects)];
  return [...new Set(aspects)].filter(aspect => !negated.has(String(aspect).toLowerCase()));
}

function stripNegatedAspectPhrases(rawQuery) {
  const text = String(rawQuery || '');
  const scopes = collectNegatedAspectScopes(text);
  if (scopes.length === 0) return text;

  const chars = text.split('');
  for (const { start, end } of scopes) {
    for (let i = start; i < Math.min(end, chars.length); i++) chars[i] = ' ';
  }
  return chars.join('').replace(/\s{2,}/g, ' ').trim();
}

module.exports = {
  NEGATABLE_ASPECT_TERMS,
  getNegatedAspectSet,
  collectNegatedClauseScopes,
  filterNegatedCanonicalEntities,
  filterNegatedSemanticAspects,
  stripNegatedAspectPhrases
};
