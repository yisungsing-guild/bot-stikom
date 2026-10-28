'use strict';

/**
 * src/utils/languageDetector.js
 *
 * Reusable, lightweight rule-based language detector for English vs Indonesian queries.
 * Distinguishes user query language across the pipeline.
 */

function detectQueryLanguage(text) {
  if (!text || typeof text !== 'string') return 'id';

  const clean = text.toLowerCase().trim();

  // 1. Grammatical and closed-class English functional words (pure syntactic signals)
  const enFunctional = clean.match(/\b(the|is|are|was|were|am|been|being|what|how|why|which|when|where|who|whom|whose|would|could|can|do|does|did|will|shall|should|have|has|had|i|i'm|my|me|you|your|we|our|they|their|he|she|it|his|her|its|them|us|for|from|with|about|after|before|between|into|through|during|without|because|please|at|in|on|of|to|an|a|tell\s+me|give\s+me|can\s+i|how\s+to|how\s+much|what\s+is|what\s+are|is\s+there|are\s+there)\b/g) || [];

  // 2. English content/academic words that are commonly borrowed or appear as proper nouns in campus contexts
  const enContent = clean.match(/\b(degree|tuition|fee|fees|classes|courses|jobs|roles|study|available|differ|difference|between|kinds|roughly|subscription|requirements?|guidelines?|defense|thesis|project|cost|pay|annual|student|students|college|laboratories|laboratory|facility|exchange|pursue|graduating|graduate)\b/g) || [];

  // 3. Indonesian grammatical markers, interrogatives, prepositions, pronouns, particles, and -nya enclitics
  const idFunctional = clean.match(/\b(yang|di|dan|ke|dari|ini|itu|untuk|pada|dengan|adalah|yaitu|apakah|apa|ada|adakah|bagaimana|gimana|gmana|berapa|kapan|dimana|dmana|siapa|kenapa|mengapa|saya|aku|kamu|kak|kakak|min|admin|kami|kita|anda|bisa|bisakah|mau|ingin|boleh|tolong|mohon|punya|tahu|tanya|daftar|mendaftar|pendaftaran|kuliah|perkuliahan|lulus|lulusan|magang|bimbingan|sidang|beasiswa|fasilitas|kampus|gedung|ruang|jadwal|skripsi|tugas\s+akhir|informasi|info|tentang|mengenai|seperti|tanpa|antara|kalo|kalau|jika|bila|karena|sebab|agar|supaya|tidak|tak|bukan|belum|jangan|ya|nih|dong|saja|aja|sih|kah|pun|prodi|jurusan|biaya|spp|dpp|syarat|persyaratan|mitra|kerjasama|keunggulan|kurikulum|mata\s+kuliah|[a-z]{3,}nya)\b/g) || [];

  // Invariant: Institutional proper nouns and loanwords (e.g. "program", "degree", "university", "international")
  // MUST NOT override Indonesian grammatical structure.
  if (idFunctional.length > 0) {
    // If Indonesian functional words are present, query is only English if pure English syntax overwhelmingly dominates
    if (enFunctional.length >= 3 && enFunctional.length > (idFunctional.length * 2)) {
      return 'en';
    }
    return 'id';
  }

  // If no Indonesian functional markers exist, check for clear English functional structure
  if (enFunctional.length >= 1 || (enContent.length >= 2 && !/\b(?:stikom|bali|pmb)\b/i.test(clean))) {
    return 'en';
  }

  return 'id';
}

module.exports = {
  detectQueryLanguage
};
