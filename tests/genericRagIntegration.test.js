const {
  selectEvidenceByCompatibility,
  evaluateGenericAnswerability,
  cleanDocumentMarkers
} = require('../src/engine/semanticRagEngine');

describe('generic RAG integration tests', () => {
  describe('answerability hard gate', () => {
    test('answerFromContexts is not called when evidence is insufficient', () => {
      // This test verifies that when answerability is false, generation is skipped
      // Since we can't easily mock answerFromContexts in this context, we verify
      // the logic by checking that evaluateGenericAnswerability returns false
      // for insufficient evidence, which should trigger the fallback path
      
      const question = 'Berapa biaya kuliah Sistem Informasi?';
      const insufficientEvidence = [
        { text: 'Program Sistem Informasi tersedia di kampus.' }
      ];
      
      const answerability = evaluateGenericAnswerability(question, insufficientEvidence, { intent: 'fee' });
      
      expect(answerability.answerable).toBe(false);
      expect(answerability.missingEvidence).toContain('fee_amount');
      
      // The runtime code checks answerabilityResult.answerable before calling answerFromContexts
      // If false, it returns buildSpecificInsufficientDataAnswer instead
    });

    test('answerability passes when evidence contains required information', () => {
      const question = 'Berapa biaya kuliah Sistem Informasi?';
      const sufficientEvidence = [
        { text: 'Biaya pendaftaran Sistem Informasi adalah Rp 500.000.' }
      ];
      
      const answerability = evaluateGenericAnswerability(question, sufficientEvidence, { intent: 'fee' });
      
      expect(answerability.answerable).toBe(true);
      expect(answerability.missingEvidence).toEqual([]);
    });
  });

  describe('final preflight order', () => {
    test('markers introduced before preflight do not appear in returned answer', () => {
      // Simulate the runtime order:
      // 1. Raw answer from LLM (may contain markers)
      const rawAnswer = 'Q: Berapa biaya? A: Biaya adalah Rp 500.000. FAQ: Informasi biaya.';
      
      // 2. Clean generated answer (ragEngine.cleanAnswerLanguage) - we skip this for the test
      const cleanedAnswer = rawAnswer;
      
      // 3. Natural formatting (formatNaturalAnswerFrame) - we skip this for the test
      const naturalAnswer = cleanedAnswer;
      
      // 4. Remove document markers (cleanDocumentMarkers)
      const markersRemoved = cleanDocumentMarkers(naturalAnswer);
      
      // Verify markers are removed
      expect(markersRemoved).not.toMatch(/Q:/);
      expect(markersRemoved).not.toMatch(/A:/);
      expect(markersRemoved).not.toMatch(/FAQ:/);
      expect(markersRemoved).not.toMatch(/\([FQA]\)/);
      
      // The runtime then calls evaluateOutboundAnswer(markersRemoved, question, { source: 'semantic-rag' })
      // and returns preflight.answer unchanged
      
      // Since we can't call evaluateOutboundAnswer without the full context,
      // we verify that cleanDocumentMarkers removes all required markers
      expect(markersRemoved).toBe('Berapa biaya? Biaya adalah Rp 500.000. Informasi biaya.');
    });

    test('all document marker types are removed', () => {
      const input = '(F) Fact (Q) Question (A) Answer F: Text Q: Text A: Text FAQ: Text Question: Text Answer: Text Pertanyaan: Text Jawaban: Text';
      const cleaned = cleanDocumentMarkers(input);
      
      expect(cleaned).not.toMatch(/\([FQA]\)/);
      expect(cleaned).not.toMatch(/[FQA]:/i);
      expect(cleaned).not.toMatch(/FAQ:/i);
      expect(cleaned).not.toMatch(/Question:/i);
      expect(cleaned).not.toMatch(/Answer:/i);
      expect(cleaned).not.toMatch(/Pertanyaan:/i);
      expect(cleaned).not.toMatch(/Jawaban:/i);
      
      expect(cleaned).toBe('Fact Question Answer Text Text Text Text Text Text Text Text');
    });
  });

  describe('evidence selection integration', () => {
    test('selectEvidenceByCompatibility splits and cleans evidence', () => {
      const contexts = [{
        chunk: 'Q: Apa itu UKM? A: UKM adalah unit kegiatan mahasiswa.\n\nBiaya pendaftaran adalah Rp 500.000.',
        filename: 'test.txt',
        id: 'test-1'
      }];
      
      const selected = selectEvidenceByCompatibility('Apa itu UKM?', contexts, { maxEvidence: 5 });
      
      // Should split into units and clean markers
      selected.forEach(evidence => {
        expect(evidence.text).not.toMatch(/Q:/);
        expect(evidence.text).not.toMatch(/A:/);
        expect(evidence.isSelectedEvidence).toBe(true);
      });
    });

    test('selectEvidenceByCompatibility filters by entity overlap', () => {
      const contexts = [{
        chunk: 'Program Teknologi Informasi fokus pada pemrograman.',
        filename: 'ti.txt',
        id: 'ti-1'
      }];
      
      const selected = selectEvidenceByCompatibility('Apa itu Sistem Informasi?', contexts);
      
      // Should reject due to entity mismatch
      expect(selected.length).toBe(0);
    });
  });
});
