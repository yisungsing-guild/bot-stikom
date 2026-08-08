const { evaluateGenericAnswerability, detectGenericIntent, extractQueryAnchorTerms, hasAnchorOverlap } = require('../src/engine/semanticRagEngine');
const { getEvidenceRequirements } = require('../src/utils/evidenceRequirements');

function oldEvaluateGenericAnswerability(question, selectedEvidence, options = {}) {
  const evidence = Array.isArray(selectedEvidence) ? selectedEvidence : [];
  const questionIntent = options.intent || detectGenericIntent(question);
  const questionAnchors = extractQueryAnchorTerms(question);
  if (!evidence.length) return { answerable: false, reason: 'no_selected_evidence', missingEvidence: ['selected_evidence'] };
  const combinedText = evidence.map((e) => e.text).join(' ');
  const missingEvidence = [];
  if (questionIntent === 'fee') {
    if (!/\b(?:Rp\.?|rupiah|\d[\d.,]+\s*(?:ribu|juta)|\d{5,})\b/i.test(combinedText)) missingEvidence.push('fee_amount');
  }
  if (questionIntent === 'schedule') {
    if (!/\b(\d{1,2}\s*(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/i.test(combinedText)) missingEvidence.push('date_or_period');
  }
  if (questionIntent === 'requirement') {
    if (!/\b(ijazah|ktp|kk|foto|rapor|transkrip|skck)\b/i.test(combinedText)) missingEvidence.push('concrete_requirements');
  }
  if (questionAnchors.length > 0 && !hasAnchorOverlap(question, combinedText)) missingEvidence.push('requested_anchor');
  if (/\b(apa\s+saja|daftar|list|pilihan|macam|sebutkan)\b/i.test(question)) {
    const listItems = combinedText.match(/(?:^|\n)\s*(?:[-*]|\d+\.)\s+\S/g) || [];
    const concreteItems = combinedText.match(/\b[A-Z][a-z]+\b/g) || [];
    if (listItems.length < 2 && concreteItems.length < 2) missingEvidence.push('multiple_concrete_items');
  }
  return { answerable: missingEvidence.length === 0, reason: missingEvidence.length ? 'missing_required_answer_shape' : 'selected_evidence_answerable', missingEvidence };
}

const cases = [
  ['Apa itu Sistem Informasi?', [{ text: 'Program Teknologi Informasi fokus pada pemrograman.' }], { intent: 'general' }],
  ['Berapa biaya pendaftaran SI?', [{ text: 'Biaya pendaftaran Sistem Informasi adalah Rp 500.000.' }], { intent: 'fee' }],
  ['biaya teknologi informasi gelombang 1A', [{ text: 'Biaya pendaftaran: Rp. 3.000.000 untuk gelombang 1A.' }], { intent: 'fee' }],
  ['apa syarat KIP', [{ text: 'Syarat beasiswa KIP: daftar online dan dokumen KTP.' }], { intent: 'scholarship' }],
  ['informasi double degree', [{ text: 'Informasi umum tentang Sistem Informasi.' }], { intent: 'international_program' }]
];

for (const [question, evidence, options] of cases) {
  const current = evaluateGenericAnswerability(question, evidence, options);
  const old = oldEvaluateGenericAnswerability(question, evidence, options);
  const rules = getEvidenceRequirements(options.intent || detectGenericIntent(question), question);
  console.log('---');
  console.log('question:', question);
  console.log('intent:', options.intent || detectGenericIntent(question));
  console.log('rules:', rules);
  console.log('current:', current);
  console.log('old:', old);
}
