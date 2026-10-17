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

  // Frequent English function and academic words
  const enMatches = clean.match(/\b(the|is|are|was|were|what|how|why|which|when|where|who|would|could|can|do|does|did|will|should|i|i'm|my|me|you|your|we|our|they|their|for|from|with|about|after|before|to|in|on|at|of|program|degree|tuition|fee|fees|classes|courses|jobs|roles|study|available|differ|difference|between|kinds|roughly|subscription|requirements?|guidelines?|defense|thesis|project|cost|pay|semester|annual|student|students|university|college|campus|laboratories|laboratory|facilities|facility|exchange|international|pursue|graduating|graduate)\b/g) || [];

  // Frequent Indonesian function and academic words
  const idMatches = clean.match(/\b(yang|di|dan|ke|dari|ini|itu|untuk|pada|dengan|adalah|apakah|apa|bagaimana|gimana|berapa|kapan|dimana|siapa|saya|aku|kamu|kak|kakak|kampus|stikom|kuliah|prodi|jurusan|biaya|spp|dpp|daftar|syarat|lulus|lulusan|magang|bimbingan|sidang|beasiswa|fasilitas|lab|laboratorium|gedung|ruang|jadwal|tugas\s+akhir|skripsi|informasi|info|tentang|mengenai|program|jalur|pendaftaran|internasional|pilihan|keunggulan|kerjasama|mitra|kurikulum|mata\s+kuliah)\b/g) || [];

  if (enMatches.length >= 2 && enMatches.length > idMatches.length) {
    return 'en';
  }

  return 'id';
}

module.exports = {
  detectQueryLanguage
};
