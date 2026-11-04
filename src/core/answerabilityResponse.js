'use strict';

/**
 * Shared response policy for turns that cannot be safely answered from evidence.
 * This module intentionally contains no campus facts and no query-specific handlers.
 */

function isVerifiedAnswer(candidateAnswer, verification) {
  const hasText = typeof candidateAnswer === 'string' && candidateAnswer.trim().length > 0;
  if (!hasText || !verification || typeof verification !== 'object') return false;

  // An explicit negative pass flag always wins over a contradictory outcome label.
  if (verification.pass === false) return false;

  const outcome = verification.outcome || verification.status || null;
  if (outcome && outcome !== 'VERIFIED_FACTUAL') return false;
  return outcome === 'VERIFIED_FACTUAL' || verification.pass === true;
}

function isEnglishFrame(semanticFrame = {}) {
  return semanticFrame.language === 'en' || semanticFrame.detectedLanguage === 'en';
}

function buildSafeUnknownResponse(semanticFrame = {}, answerability = {}) {
  if (typeof answerability.guidance === 'string' && answerability.guidance.trim()) {
    return answerability.guidance.trim();
  }

  return isEnglishFrame(semanticFrame)
    ? 'I am sorry, but I cannot verify this information from the official sources currently available. Please contact the relevant campus office for confirmation.'
    : 'Mohon maaf, informasi tersebut belum dapat saya verifikasi dari sumber resmi yang tersedia. Silakan menghubungi bagian kampus terkait untuk konfirmasi.';
}

function buildClarificationResponse(semanticFrame = {}) {
  return isEnglishFrame(semanticFrame)
    ? 'Could you clarify which program or information you mean? I want to make sure I answer the right question.'
    : 'Boleh diperjelas program studi atau informasi yang dimaksud? Saya ingin memastikan jawaban yang diberikan sesuai dengan pertanyaan Kakak.';
}

module.exports = {
  isVerifiedAnswer,
  buildSafeUnknownResponse,
  buildClarificationResponse
};
