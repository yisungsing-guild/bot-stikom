const fs = require('fs');
const path = require('path');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');

describe('Final Bounded Remediation Regression: Q062 Dormitory Corpus Gap and Q007, Q008, Q026 Wrong-Entity Protection', () => {
  const corpusPath = path.resolve(__dirname, '../scratch/corpus_snapshot_candidate_curriculum_2025.json');
  let corpus;

  beforeAll(() => {
    corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  });

  describe('Task A: Q062 Dormitory Room Rental Corpus Gap Protection', () => {
    test('General tuition fee chunks must NOT be accepted for dormitory room rental inquiries', () => {
      const tuitionFeeChunk = corpus.find(c => c.id.startsWith('67534925'));
      expect(tuitionFeeChunk).toBeDefined();

      const plan = {
        domain: 'FACILITIES',
        intent: 'FACILITY_INQUIRY',
        requiredAspects: ['facilities', 'lab', 'campus_infrastructure', 'fee', 'sewa_gedung'],
        queryVariants: ['Berapa biaya sewa kamar asrama putri di dekat kampus Jimbaran?'],
        rawQuery: 'Berapa biaya sewa kamar asrama putri di dekat kampus Jimbaran?'
      };

      const result = arbitrateEvidence([tuitionFeeChunk], plan);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('evidence_does_not_contain_dormitory_rental_rates');
    });

    test('Positive Control: Actual dormitory or room rental rate chunk is accepted for dormitory rental inquiry', () => {
      const mockDormitoryChunk = {
        id: 'mock-dormitory-fee-chunk',
        chunk: 'Tarif sewa kamar asrama mahasiswa putri kampus Jimbaran adalah Rp 500.000 per bulan.',
        filename: 'panduan_fasilitas_asrama.pdf',
        category: 'FACILITIES',
        academicLevel: 'Umum'
      };

      const plan = {
        domain: 'FACILITIES',
        intent: 'FACILITY_INQUIRY',
        requiredAspects: ['facilities', 'lab', 'campus_infrastructure', 'fee', 'sewa_gedung'],
        queryVariants: ['Berapa biaya sewa kamar asrama putri di dekat kampus Jimbaran?'],
        rawQuery: 'Berapa biaya sewa kamar asrama putri di dekat kampus Jimbaran?'
      };

      const result = arbitrateEvidence([mockDormitoryChunk], plan);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('mock-dormitory-fee-chunk');
    });
  });

  describe('Task B: Wrong-Entity Protection (Q007, Q008, Q026)', () => {
    test('Q007 & Q008: S1 Sistem Informasi description chunk 45a2e176 must NOT be accepted for S1 Sistem Komputer inquiries', () => {
      const c45 = corpus.find(c => c.id.startsWith('45a2e176'));
      expect(c45).toBeDefined();

      const planSKAccreditation = {
        domain: 'ACCREDITATION',
        intent: 'ACCREDITATION_INQUIRY',
        targetEntities: ['S1 Sistem Komputer'],
        requiredAspects: ['accreditation'],
        queryVariants: ['Bagaimana status dan peringkat akreditasi S1 Sistem Komputer?'],
        rawQuery: 'Bagaimana status dan peringkat akreditasi S1 Sistem Komputer?'
      };

      const resultAccreditation = arbitrateEvidence([c45], planSKAccreditation);
      expect(resultAccreditation.accepted).toHaveLength(0);
      expect(resultAccreditation.rejected).toHaveLength(1);
      expect(resultAccreditation.rejected[0].reason).toContain('candidate_scoped_to_program_SI_not_SK');

      const planSKCareer = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        targetEntities: ['S1 Sistem Komputer'],
        requiredAspects: ['overview'],
        queryVariants: ['Apa peluang karier utama bagi lulusan sarjana S1 Sistem Komputer?'],
        rawQuery: 'Apa peluang karier utama bagi lulusan sarjana S1 Sistem Komputer?'
      };

      const resultCareer = arbitrateEvidence([c45], planSKCareer);
      expect(resultCareer.accepted).toHaveLength(0);
      expect(resultCareer.rejected).toHaveLength(1);
      expect(resultCareer.rejected[0].reason).toContain('candidate_scoped_to_program_SI_not_SK');
    });

    test('Positive Control: S1 Sistem Komputer accreditation chunk must be accepted for S1 Sistem Komputer inquiries', () => {
      const cSKAccred = corpus.find(c => c.id.startsWith('aafc4317'));
      expect(cSKAccred).toBeDefined();

      const planSKAccreditation = {
        domain: 'ACCREDITATION',
        intent: 'ACCREDITATION_INQUIRY',
        targetEntities: ['S1 Sistem Komputer'],
        requiredAspects: ['accreditation'],
        queryVariants: ['Bagaimana status dan peringkat akreditasi S1 Sistem Komputer?'],
        rawQuery: 'Bagaimana status dan peringkat akreditasi S1 Sistem Komputer?'
      };

      const result = arbitrateEvidence([cSKAccred], planSKAccreditation);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe(cSKAccred.id);
    });

    test('Q026: Double Degree S1 chunk ef903a22 must NOT be accepted for S2 graduate program listing', () => {
      const cef = corpus.find(c => c.id.startsWith('ef903a22'));
      expect(cef).toBeDefined();

      const planS2List = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        academicLevel: 'S2',
        targetEntities: [],
        requiredAspects: ['general'],
        queryVariants: ['Apa nama program pascasarjana yang diselenggarakan di ITB STIKOM Bali?'],
        rawQuery: 'Apa nama program pascasarjana yang diselenggarakan di ITB STIKOM Bali?'
      };

      const result = arbitrateEvidence([cef], planS2List);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('candidate_level_S1_conflicts_with_target_S2');
    });

    test('Positive Control: S2 Master of Information Systems chunk must be accepted for S2 inquiries', () => {
      const cS2 = corpus.find(c => c.id.startsWith('577873e2'));
      expect(cS2).toBeDefined();

      const planS2List = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        academicLevel: 'S2',
        targetEntities: [],
        requiredAspects: ['general'],
        queryVariants: ['Apa nama program pascasarjana yang diselenggarakan di ITB STIKOM Bali?'],
        rawQuery: 'Apa nama program pascasarjana yang diselenggarakan di ITB STIKOM Bali?'
      };

      const result = arbitrateEvidence([cS2], planS2List);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe(cS2.id);
    });
  });
});
