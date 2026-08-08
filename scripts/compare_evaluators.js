const { evaluateEvidenceAnswerability } = require('../src/engine/evidenceSelector');
const { evaluateGenericAnswerability } = require('../src/engine/semanticRagEngine');

const samples = [
  { q: 'biaya teknologi informasi gelombang 1A', intent: 'fee' },
  { q: 'biaya sistem informasi gelombang 2', intent: 'fee' },
  { q: 'apa syarat KIP', intent: 'scholarship' },
  { q: 'informasi double degree', intent: 'international_program' },
  { q: 'apa itu sistem informasi', intent: 'general' }
];

const stubEvidence = [
  { text: 'Informasi umum tentang Sistem Informasi.', isSelectedEvidence: true },
  { text: 'Biaya pendaftaran: Rp. 3.000.000 untuk gelombang 1A.', isSelectedEvidence: true },
  { text: 'Syarat beasiswa KIP: daftar online dan dokumen KTP.', isSelectedEvidence: true }
];

for (const s of samples) {
  const legacy = evaluateEvidenceAnswerability({ question: s.q, selectedEvidence: stubEvidence, intent: s.intent });
  const generic = evaluateGenericAnswerability(s.q, stubEvidence, { intent: s.intent });
  console.log('---');
  console.log('query:', s.q);
  console.log('detected_intent_legacy:', s.intent);
  // For generic detected intent we can call detectGenericIntent via semanticRagEngine if exported, but we didn't export it; rely on passed intent
  console.log('detected_intent_generic:', s.intent);
  console.log('legacy_answerable:', legacy.answerable, 'legacy_missing:', legacy.missingEvidence);
  console.log('generic_answerable:', generic.answerable, 'generic_missing:', generic.missingEvidence);
}
