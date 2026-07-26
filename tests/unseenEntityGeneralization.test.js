/**
 * Unseen Entity Generalization Test
 * 
 * Tests that the system can handle completely invented entities that do not exist
 * anywhere in runtime source code. This verifies that the system is truly generic
 * and does not rely on hardcoded institution-specific entity lists.
 * 
 * Invented entities used in tests:
 * - Layanan Arunika (fictional service)
 * - Portal Nawasena (fictional portal)
 * - Pusat Karier Cakrawala (fictional career center)
 * 
 * These entities MUST NOT appear in any runtime source code outside of this test file.
 */

const { 
  extractGenericEntities,
  computeEntityOverlap,
  computeGenericScore,
  selectEvidenceByCompatibility,
  splitIntoEvidenceUnits,
  cleanDocumentMarkers,
  evaluateGenericAnswerability
} = require('../src/engine/semanticRagEngine');

describe('Unseen Entity Generalization', () => {
  
  // Synthetic TrainingData with invented entities
  const syntheticTrainingData = [
    {
      id: 'arunika-service',
      category: 'layanan',
      title: 'Layanan Arunika',
      question: 'Apa itu Layanan Arunika?',
      answer: 'Layanan Arunika adalah layanan konsultasi akademik yang tersedia untuk mahasiswa. Layanan ini membantu mahasiswa dalam perencanaan studi, pemilihan mata kuliah, dan bimbingan karir.',
      metadata: {
        domain: 'layanan',
        information_type: 'definisi',
        target_audience: 'mahasiswa'
      }
    },
    {
      id: 'nawasena-portal',
      category: 'portal',
      title: 'Portal Nawasena',
      question: 'Bagaimana cara mengakses Portal Nawasena?',
      answer: 'Portal Nawasena dapat diakses melalui https://nawasena.kampus.ac.id menggunakan NIM dan password yang sama dengan email kampus. Portal ini menyediakan akses ke jadwal kuliah, nilai, dan keuangan.',
      metadata: {
        domain: 'portal',
        information_type: 'akses',
        target_audience: 'mahasiswa'
      }
    },
    {
      id: 'cakrawala-career',
      category: 'karier',
      title: 'Pusat Karier Cakrawala',
      question: 'Apa saja layanan di Pusat Karier Cakrawala?',
      answer: 'Pusat Karier Cakrawala menyediakan berbagai layanan termasuk konsultasi CV, simulasi interview, job fair, dan koneksi dengan mitra industri. Mahasiswa dapat mendaftar melalui portal karier kampus.',
      metadata: {
        domain: 'karier',
        information_type: 'daftar',
        target_audience: 'mahasiswa'
      }
    },
    // Unrelated PMB content (should be rejected)
    {
      id: 'pmb-biaya',
      category: 'pmb',
      title: 'Biaya Pendaftaran PMB',
      question: 'Berapa biaya pendaftaran PMB?',
      answer: 'Biaya pendaftaran PMB adalah Rp 350.000. Pembayaran dapat dilakukan melalui transfer bank atau gerai minimarket.',
      metadata: {
        domain: 'pmb',
        information_type: 'biaya',
        target_audience: 'calon_mahasiswa'
      }
    }
  ];

  describe('extractGenericEntities with unseen entities', () => {
    
    test('should extract invented entity "Layanan Arunika" via proper noun extraction', () => {
      const text = 'Apa itu Layanan Arunika?';
      const entities = extractGenericEntities(text);
      
      // Should capture via proper noun extraction (capitalized words)
      expect(entities.some(e => e.toLowerCase().includes('layanan'))).toBe(true);
      expect(entities.some(e => e.toLowerCase().includes('arunika'))).toBe(true);
    });

    test('should extract invented entity "Portal Nawasena" via proper noun extraction', () => {
      const text = 'Bagaimana cara mengakses Portal Nawasena?';
      const entities = extractGenericEntities(text);
      
      // Should capture via proper noun extraction
      expect(entities.some(e => e.toLowerCase().includes('portal'))).toBe(true);
      expect(entities.some(e => e.toLowerCase().includes('nawasena'))).toBe(true);
    });

    test('should extract invented entity "Pusat Karier Cakrawala" via proper noun extraction', () => {
      const text = 'Layanan apa saja di Pusat Karier Cakrawala?';
      const entities = extractGenericEntities(text);
      
      // Should capture via proper noun extraction
      expect(entities.some(e => e.toLowerCase().includes('pusat'))).toBe(true);
      expect(entities.some(e => e.toLowerCase().includes('karier'))).toBe(true);
      expect(entities.some(e => e.toLowerCase().includes('cakrawala'))).toBe(true);
    });

    test('should compute entity overlap between question and content with unseen entities', () => {
      const question = 'Apa itu Layanan Arunika?';
      const content = 'Layanan Arunika adalah layanan konsultasi akademik.';
      
      const overlap = computeEntityOverlap(question, content);
      
      // Should have significant overlap due to shared entities
      expect(overlap).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('Generic scoring with unseen entities', () => {
    
    test('should score Layanan Arunika content higher than unrelated content', () => {
      const question = 'Apa itu Layanan Arunika?';
      
      const arunikaContent = {
        chunk: cleanDocumentMarkers(syntheticTrainingData[0].answer),
        source: syntheticTrainingData[0].id
      };
      
      const pmbContent = {
        chunk: cleanDocumentMarkers(syntheticTrainingData[3].answer),
        source: syntheticTrainingData[3].id
      };
      
      const arunikaScore = computeGenericScore(question, arunikaContent.chunk);
      const pmbScore = computeGenericScore(question, pmbContent.chunk);
      
      // Arunika content should score higher for Arunika question
      expect(arunikaScore).toBeGreaterThan(pmbScore);
    });

    test('should score Portal Nawasena content higher than unrelated content', () => {
      const question = 'Bagaimana cara mengakses Portal Nawasena?';
      
      const nawasenaContent = {
        chunk: cleanDocumentMarkers(syntheticTrainingData[1].answer),
        source: syntheticTrainingData[1].id
      };
      
      const pmbContent = {
        chunk: cleanDocumentMarkers(syntheticTrainingData[3].answer),
        source: syntheticTrainingData[3].id
      };
      
      const nawasenaScore = computeGenericScore(question, nawasenaContent.chunk);
      const pmbScore = computeGenericScore(question, pmbContent.chunk);
      
      // Nawasena content should score higher for Nawasena question
      expect(nawasenaScore).toBeGreaterThan(pmbScore);
    });

    test('should score Pusat Karier Cakrawala content higher than unrelated content', () => {
      const question = 'Apa saja layanan di Pusat Karier Cakrawala?';
      
      const cakrawalaContent = {
        chunk: cleanDocumentMarkers(syntheticTrainingData[2].answer),
        source: syntheticTrainingData[2].id
      };
      
      const pmbContent = {
        chunk: cleanDocumentMarkers(syntheticTrainingData[3].answer),
        source: syntheticTrainingData[3].id
      };
      
      const cakrawalaScore = computeGenericScore(question, cakrawalaContent.chunk);
      const pmbScore = computeGenericScore(question, pmbContent.chunk);
      
      // Cakrawala content should score higher for Cakrawala question
      expect(cakrawalaScore).toBeGreaterThan(pmbScore);
    });
  });

  describe('Evidence selection with unseen entities', () => {
    
    test('should select relevant evidence for Layanan Arunika question', () => {
      const question = 'Apa itu Layanan Arunika?';
      
      // Convert training data to evidence units
      const contexts = syntheticTrainingData.map(item => ({
        chunk: cleanDocumentMarkers(item.answer),
        source: item.id,
        metadata: item.metadata
      }));
      
      const selectedEvidence = selectEvidenceByCompatibility(question, contexts);
      
      // Should select evidence containing the invented entity
      expect(selectedEvidence.length).toBeGreaterThan(0);
      
      const arunikaEvidence = selectedEvidence.find(e => 
        e.text && e.text.toLowerCase().includes('arunika') || 
        e.text && e.text.toLowerCase().includes('layanan')
      );
      expect(arunikaEvidence).toBeDefined();
    });

    test('should select relevant evidence for Portal Nawasena question', () => {
      const question = 'Bagaimana cara mengakses Portal Nawasena?';
      
      // Convert training data to evidence units
      const contexts = syntheticTrainingData.map(item => ({
        chunk: cleanDocumentMarkers(item.answer),
        source: item.id,
        metadata: item.metadata
      }));
      
      const selectedEvidence = selectEvidenceByCompatibility(question, contexts);
      
      // Should select evidence containing the invented entity
      expect(selectedEvidence.length).toBeGreaterThan(0);
      
      const nawasenaEvidence = selectedEvidence.find(e => 
        e.text && e.text.toLowerCase().includes('nawasena') || 
        e.text && e.text.toLowerCase().includes('portal')
      );
      expect(nawasenaEvidence).toBeDefined();
    });

    test('should select relevant evidence for Pusat Karier Cakrawala question', () => {
      const question = 'Apa saja layanan di Pusat Karier Cakrawala?';
      
      // Convert training data to evidence units
      const contexts = syntheticTrainingData.map(item => ({
        chunk: cleanDocumentMarkers(item.answer),
        source: item.id,
        metadata: item.metadata
      }));
      
      const selectedEvidence = selectEvidenceByCompatibility(question, contexts);
      
      // Should select evidence containing the invented entity
      expect(selectedEvidence.length).toBeGreaterThan(0);
      
      const cakrawalaEvidence = selectedEvidence.find(e => 
        e.text && e.text.toLowerCase().includes('cakrawala') || 
        e.text && e.text.toLowerCase().includes('karier')
      );
      expect(cakrawalaEvidence).toBeDefined();
    });
  });

  describe('Answerability evaluation with unseen entities', () => {
    
    test('should evaluate Layanan Arunika content as answerable', () => {
      const question = 'Apa itu Layanan Arunika?';
      
      const contexts = syntheticTrainingData.map(item => ({
        chunk: cleanDocumentMarkers(item.answer),
        source: item.id,
        metadata: item.metadata
      }));
      
      const selectedEvidence = selectEvidenceByCompatibility(question, contexts);
      const evaluation = evaluateGenericAnswerability(question, selectedEvidence);
      
      // Should be answerable with relevant evidence
      expect(evaluation.answerable).toBe(true);
    });

    test('should evaluate Portal Nawasena content as answerable', () => {
      const question = 'Bagaimana cara mengakses Portal Nawasena?';
      
      const contexts = syntheticTrainingData.map(item => ({
        chunk: cleanDocumentMarkers(item.answer),
        source: item.id,
        metadata: item.metadata
      }));
      
      const selectedEvidence = selectEvidenceByCompatibility(question, contexts);
      const evaluation = evaluateGenericAnswerability(question, selectedEvidence);
      
      // Should be answerable with relevant evidence
      expect(evaluation.answerable).toBe(true);
    });

    test('should evaluate Pusat Karier Cakrawala content as answerable', () => {
      const question = 'Apa saja layanan di Pusat Karier Cakrawala?';
      
      const contexts = syntheticTrainingData.map(item => ({
        chunk: cleanDocumentMarkers(item.answer),
        source: item.id,
        metadata: item.metadata
      }));
      
      const selectedEvidence = selectEvidenceByCompatibility(question, contexts);
      const evaluation = evaluateGenericAnswerability(question, selectedEvidence);
      
      // Should be answerable with relevant evidence
      expect(evaluation.answerable).toBe(true);
    });
  });
});
