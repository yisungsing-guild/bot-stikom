// Shared canonical evidence requirements per intent
// Minimal, read-only helper used by evaluators to keep checks aligned

function _containsScholarshipToken(text) {
  return /\b(kip|beasiswa|bantuan\s+biaya|potongan\s+biaya|potongan)\b/i.test(String(text || ''));
}

function _containsCurrencyToken(text) {
  return /\b(Rp\.?|rupiah|\d[\d.,]+\s*(?:juta|ribu|rb|jt|k)?)\b/i.test(String(text || ''));
}

function getEvidenceRequirements(intent, question) {
  const i = String(intent || '').trim().toLowerCase();
  const q = String(question || '');
  const req = {
    requireNumeric: false,
    requireCurrency: false,
    requireDateOrPeriod: false,
    requireConcreteList: false,
    requireProgramAlignment: false,
    requireScholarshipAlignment: false,
    requireAnchorOverlap: false
  };

  if (i === 'fee' || i === 'tuition_fee') {
    req.requireCurrency = true;
    req.requireNumeric = true;
  }
  if (i === 'schedule') {
    req.requireDateOrPeriod = true;
    req.requireAnchorOverlap = true;
  }
  if (i === 'requirement' || i === 'registration') {
    req.requireConcreteList = true;
    req.requireAnchorOverlap = true;
  }
  if (i === 'program' || i === 'program_studi') {
    req.requireProgramAlignment = true;
    req.requireAnchorOverlap = true;
  }
  if (i === 'international_program' || i === 'double_degree') {
    req.requireProgramAlignment = true;
  }
  if (i === 'scholarship' || i === 'kip' || i === 'beasiswa') {
    req.requireScholarshipAlignment = true;
    // keep anchor overlap as desirable but allow later per-special-case logic
    req.requireAnchorOverlap = true;
  }

  return req;
}

function isScholarshipAligned(combinedText, question) {
  // Decide whether scholarship evidence aligns to requested scholarship question
  // If question explicitly mentions KIP, require 'kip' token in text.
  const q = String(question || '').toLowerCase();
  const text = String(combinedText || '');
  const asksKip = /\bkip\b/i.test(q);
  if (asksKip) return /\bkip\b/i.test(text);
  // For generic scholarship questions, accept if scholarship tokens present
  return _containsScholarshipToken(text);
}

function containsCurrency(combinedText) {
  return _containsCurrencyToken(combinedText);
}

module.exports = {
  getEvidenceRequirements,
  isScholarshipAligned,
  containsCurrency
};
