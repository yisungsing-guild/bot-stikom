const { evaluateEvidenceAnswerability } = require('../src/engine/evidenceSelector');
const { evaluateGenericAnswerability } = require('../src/engine/semanticRagEngine');
const { selectEvidenceFromContexts, buildSelectedEvidenceContext } = require('../src/engine/evidenceSelector');

const samples = [
  { q: 'biaya teknologi informasi gelombang 1A', intent: 'fee' },
  { q: 'biaya sistem informasi gelombang 2', intent: 'fee' },
  { q: 'apa syarat KIP', intent: 'scholarship' },
  { q: 'informasi double degree', intent: 'international_program' },
  { q: 'apa itu sistem informasi', intent: 'general' }
];

describe('Answerability evaluator comparison', () => {
  samples.forEach((s) => {
    test(`compare evaluators for: ${s.q}`, () => {
      // For this test we simulate minimal selectedEvidence items with text stubs.
      const stubEvidence = [
        { text: 'Informasi umum tentang Sistem Informasi.', isSelectedEvidence: true },
        { text: 'Biaya pendaftaran: Rp. 3.000.000 untuk gelombang 1A.', isSelectedEvidence: true },
        { text: 'Syarat beasiswa KIP: daftar online dan dokumen KTP.', isSelectedEvidence: true }
      ];

      const legacy = evaluateEvidenceAnswerability({ question: s.q, selectedEvidence: stubEvidence, intent: s.intent });
      const generic = evaluateGenericAnswerability(s.q, stubEvidence, { intent: s.intent });

      expect(legacy).toHaveProperty('answerable');
      expect(generic).toHaveProperty('answerable');

      // Both should return missingEvidence array when not answerable
      expect(Array.isArray(legacy.missingEvidence)).toBe(true);
      expect(Array.isArray(generic.missingEvidence)).toBe(true);

      // Ensure shape preserved
      expect(legacy).toHaveProperty('reason');
      expect(generic).toHaveProperty('reason');
    });
  });
});
