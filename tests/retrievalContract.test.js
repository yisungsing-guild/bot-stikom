'use strict';

/**
 * tests/retrievalContract.test.js
 * 
 * Phase F Semantic Retrieval Contract & Dynamic Evidence Arbitration Test Suite.
 * Validates deterministic contract generation, scope binding, metadata states,
 * and evidence arbitration invariants.
 */

const {
  RETRIEVAL_STATE,
  EVIDENCE_METADATA_STATE,
  FIRST_FAILURE_TAXONOMY,
  normalizeAspect,
  buildRetrievalContract,
  evaluateChunkMetadata,
  arbitrateEvidenceWithContract,
  compareRetrievalShadow
} = require('../src/core/retrievalContract');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');

describe('Phase F: Semantic Retrieval Contract & Dynamic Evidence Arbitration', () => {

  describe('Section 3 & 5: Contract Construction & Aspect Normalization', () => {
    test('normalizes Indonesian and English aspect terms deterministically', () => {
      expect(normalizeAspect('biaya')).toBe('fee');
      expect(normalizeAspect('spp')).toBe('fee');
      expect(normalizeAspect('tuition')).toBe('fee');
      expect(normalizeAspect('akreditasi')).toBe('accreditation');
      expect(normalizeAspect('accreditation')).toBe('accreditation');
      expect(normalizeAspect('kurikulum')).toBe('curriculum');
      expect(normalizeAspect('matkul')).toBe('curriculum');
      expect(normalizeAspect('syarat')).toBe('requirements');
      expect(normalizeAspect('admission_requirements')).toBe('requirements');
      expect(normalizeAspect('fasilitas')).toBe('facilities');
      expect(normalizeAspect('jadwal')).toBe('schedule');
      expect(normalizeAspect('prospek')).toBe('career');
      expect(normalizeAspect('unknown_aspect')).toBe('unknown_aspect');
      expect(normalizeAspect(null)).toBeNull();
    });

    test('builds valid RetrievalContract from validated SemanticFrame', () => {
      const frame = {
        normalizedQuery: 'akreditasi bisnis digital',
        domain: 'ACADEMIC_PROGRAM',
        intent: 'ACCREDITATION_INQUIRY',
        entities: [{ canonical: 'S1 Bisnis Digital' }],
        aspects: ['accreditation'],
        academicLevel: 'S1',
        speechAct: 'INQUIRE_PROPERTY'
      };

      const contract = buildRetrievalContract(frame);
      expect(contract.entityCanonical).toBe('S1 Bisnis Digital');
      expect(contract.entityState).toBe('SUPPORTED');
      expect(contract.entityFamily).toBe('academic_program');
      expect(contract.academicLevel).toBe('S1');
      expect(contract.requestedAspects).toEqual(['accreditation']);
      expect(contract.aspectFilter).toBe('accreditation');
      expect(contract.retrievalState).toBe(RETRIEVAL_STATE.SCOPED_RETRIEVAL_ALLOWED);
      expect(contract.firstFailure).toBeNull();
      expect(contract.scopeConstraints.targetEntities).toContain('S1 Bisnis Digital');
      expect(contract.scopeConstraints.excludedEntities.length).toBeGreaterThan(0);
      expect(contract.scopeConstraints.excludedEntities).toContain('S1 Sistem Informasi');
    });

    test('handles empty / invalid frame gracefully with fail-safe contract', () => {
      const contract = buildRetrievalContract(null);
      expect(contract.retrievalState).toBe(RETRIEVAL_STATE.CLARIFICATION_REQUIRED);
      expect(contract.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.SEMANTIC_FRAME_INVALID);
    });
  });

  describe('Section 4, 13, 16, 17: Entity State Policies', () => {
    test('AMBIGUOUS entities produce CLARIFICATION_REQUIRED state without arbitrary selection', () => {
      const frame = {
        normalizedQuery: 'bagaimana akreditasinya?',
        entities: [{ canonical: 'S1 Bisnis Digital' }, { canonical: 'S1 Sistem Informasi' }],
        aspects: ['accreditation'],
        isAmbiguous: true,
        speechAct: 'INQUIRE_PROPERTY'
      };

      const contract = buildRetrievalContract(frame);
      expect(contract.entityState).toBe('AMBIGUOUS');
      expect(contract.retrievalState).toBe(RETRIEVAL_STATE.CLARIFICATION_REQUIRED);
      expect(contract.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.ENTITY_AMBIGUOUS);

      const candidates = [
        { id: 'c1', text: 'Akreditasi S1 Bisnis Digital adalah Baik Sekali' },
        { id: 'c2', text: 'Akreditasi S1 Sistem Informasi adalah Unggul' }
      ];
      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.retrievalState).toBe(RETRIEVAL_STATE.CLARIFICATION_REQUIRED);
      expect(result.clarificationRequired).toBe(true);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(2);
      expect(result.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.ENTITY_AMBIGUOUS);
    });

    test('UNKNOWN_UNVERIFIED entity produces NO_VERIFIED_ENTITY_EVIDENCE without hallucinated retrieval', () => {
      const frame = {
        normalizedQuery: 'ada teknik nuklir?',
        entities: [],
        entityResolutionStatus: 'UNRESOLVED',
        aspects: ['program_availability']
      };

      const contract = buildRetrievalContract(frame);
      expect(contract.entityState).toBe('UNKNOWN_UNVERIFIED');
      expect(contract.retrievalState).toBe(RETRIEVAL_STATE.NO_VERIFIED_ENTITY_EVIDENCE);
      expect(contract.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.ENTITY_UNKNOWN);

      const candidates = [
        { id: 'c1', text: 'Program Studi Teknik Komputer ITB STIKOM Bali' }
      ];
      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.retrievalState).toBe(RETRIEVAL_STATE.NO_VERIFIED_ENTITY_EVIDENCE);
      expect(result.hasSupportedEvidence).toBe(false);
      expect(result.accepted).toHaveLength(0);
      expect(result.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.ENTITY_UNKNOWN);
    });

    test('Controlled UNSUPPORTED entity produces NO_RETRIEVAL with zero fallback chunks', () => {
      const frame = {
        normalizedQuery: 'ada teknik geologi?',
        entities: [{ canonical: 'Teknik Geologi' }],
        unsupportedEntity: true,
        isUnsupportedEntity: true,
        unsupportedEntityName: 'Teknik Geologi',
        entityResolutionStatus: 'UNSUPPORTED'
      };

      const contract = buildRetrievalContract(frame);
      expect(contract.entityState).toBe('UNSUPPORTED');
      expect(contract.retrievalState).toBe(RETRIEVAL_STATE.NO_RETRIEVAL);
      expect(contract.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.ENTITY_UNSUPPORTED);

      const candidates = [
        { id: 'c1', text: 'Rincian biaya kuliah teknik dan sistem informasi' },
        { id: 'c2', text: 'Pendaftaran Mahasiswa Baru PMB ITB STIKOM Bali' }
      ];
      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.retrievalState).toBe(RETRIEVAL_STATE.NO_RETRIEVAL);
      expect(result.hasSupportedEvidence).toBe(false);
      expect(result.unsupportedEntity).toBe(true);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(2);
      expect(result.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.ENTITY_UNSUPPORTED);
    });
  });

  describe('Section 9: Explicit Evidence Metadata States', () => {
    const baseContract = buildRetrievalContract({
      normalizedQuery: 'akreditasi bisnis digital',
      entities: [{ canonical: 'S1 Bisnis Digital' }],
      aspects: ['accreditation']
    });

    test('METADATA_MATCH: chunk has matching structured entityIds and providedAspects', () => {
      const chunk = {
        id: 'chunk_match_1',
        text: 'Program Studi S1 Bisnis Digital terakreditasi Baik Sekali oleh LAM INFOKOM.',
        entityIds: ['S1 Bisnis Digital'],
        providedAspects: ['accreditation'],
        academicLevel: 'S1',
        provenanceDocumentId: 'doc_akreditasi_bd_2024'
      };

      const metaEval = evaluateChunkMetadata(chunk, baseContract);
      expect(metaEval.state).toBe(EVIDENCE_METADATA_STATE.METADATA_MATCH);

      const result = arbitrateEvidenceWithContract([chunk], baseContract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].metadataState).toBe(EVIDENCE_METADATA_STATE.METADATA_MATCH);
      expect(result.accepted[0].chunkId).toBe('chunk_match_1');
      expect(result.accepted[0].provenanceDocumentId).toBe('doc_akreditasi_bd_2024');
    });

    test('METADATA_PARTIAL: chunk matches entity but lacks aspect', () => {
      const chunk = {
        id: 'chunk_partial_1',
        text: 'Program Studi S1 Bisnis Digital mempelajari ekonomi digital dan startup.',
        entityIds: ['S1 Bisnis Digital'],
        providedAspects: ['curriculum'],
        academicLevel: 'S1',
        provenanceDocumentId: 'doc_profil_bd'
      };

      const metaEval = evaluateChunkMetadata(chunk, baseContract);
      expect(metaEval.state).toBe(EVIDENCE_METADATA_STATE.METADATA_PARTIAL);
    });

    test('METADATA_MISSING: legacy chunk lacking structured metadata does not receive fabricated aspects', () => {
      const chunk = {
        id: 'chunk_legacy_1',
        text: 'Program Studi S1 Bisnis Digital akreditasi resmi peringkat Baik Sekali.',
        source_file: 'informasi_kampus.pdf'
      };

      const metaEval = evaluateChunkMetadata(chunk, baseContract);
      expect(metaEval.state).toBe(EVIDENCE_METADATA_STATE.METADATA_MISSING);

      const result = arbitrateEvidenceWithContract([chunk], baseContract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].metadataState).toBe(EVIDENCE_METADATA_STATE.METADATA_MISSING);
      expect(result.accepted[0].providedAspects).toEqual(['accreditation']);
    });

    test('METADATA_CONFLICT: excluded sibling collision is quarantined/rejected', () => {
      const chunk = {
        id: 'chunk_conflict_sibling',
        text: 'Akreditasi Program Studi S1 Sistem Informasi adalah Unggul.',
        entityIds: ['S1 Sistem Informasi'],
        providedAspects: ['accreditation'],
        academicLevel: 'S1'
      };

      const metaEval = evaluateChunkMetadata(chunk, baseContract);
      expect(metaEval.state).toBe(EVIDENCE_METADATA_STATE.METADATA_CONFLICT);
      expect(metaEval.conflictType).toBe('EXCLUDED_ENTITY_COLLISION');

      const result = arbitrateEvidenceWithContract([chunk], baseContract);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].disposition).toBe('REJECT_METADATA_CONFLICT');
      expect(result.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.METADATA_CONFLICT);
    });

    test('METADATA_CONFLICT: academic level mismatch is quarantined/rejected', () => {
      const contractS2 = buildRetrievalContract({
        normalizedQuery: 'syarat s2 sistem informasi',
        entities: [{ canonical: 'S2 Sistem Informasi' }],
        aspects: ['requirements'],
        academicLevel: 'S2'
      });

      const chunkS1 = {
        id: 'chunk_conflict_level',
        text: 'Persyaratan masuk mahasiswa baru: ijazah SMA/SMK sederajat.',
        entityIds: ['S2 Sistem Informasi'],
        providedAspects: ['requirements'],
        academicLevels: ['S1'],
        academicLevel: 'S1'
      };

      const metaEval = evaluateChunkMetadata(chunkS1, contractS2);
      expect(metaEval.state).toBe(EVIDENCE_METADATA_STATE.METADATA_CONFLICT);
      expect(metaEval.conflictType).toBe('ACADEMIC_LEVEL_MISMATCH');

      const result = arbitrateEvidenceWithContract([chunkS1], contractS2);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.METADATA_CONFLICT);
    });
  });

  describe('Section 12: Hard Filters vs Soft Signals (Vector Override Invariant)', () => {
    test('vector similarity cannot override entity mismatch', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'akreditasi Sistem Informasi',
        entities: [{ canonical: 'S1 Sistem Informasi' }],
        aspects: ['accreditation']
      });

      const highSimWrongEntity = {
        id: 'chunk_vector_high',
        text: 'Akreditasi program studi S1 Bisnis Digital telah meraih peringkat Baik Sekali.',
        entityIds: ['S1 Bisnis Digital'],
        providedAspects: ['accreditation'],
        vectorSimilarity: 0.98,
        bm25Score: 45.2
      };

      const lowerSimCorrectEntity = {
        id: 'chunk_vector_mid',
        text: 'Program Studi S1 Sistem Informasi memperoleh akreditasi Unggul.',
        entityIds: ['S1 Sistem Informasi'],
        providedAspects: ['accreditation'],
        vectorSimilarity: 0.81,
        bm25Score: 32.1
      };

      const result = arbitrateEvidenceWithContract([highSimWrongEntity, lowerSimCorrectEntity], contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('chunk_vector_mid');
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].id).toBe('chunk_vector_high');
    });

    test('vector similarity cannot override aspect mismatch', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'biaya kuliah Sistem Informasi',
        entities: [{ canonical: 'S1 Sistem Informasi' }],
        aspects: ['fee']
      });

      const highSimWrongAspect = {
        id: 'chunk_wrong_aspect',
        text: 'Kurikulum Program Studi S1 Sistem Informasi berfokus pada audit sistem dan manajemen basis data.',
        entityIds: ['S1 Sistem Informasi'],
        providedAspects: ['curriculum'],
        vectorSimilarity: 0.95
      };

      const result = arbitrateEvidenceWithContract([highSimWrongAspect], contract);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.ASPECT_MISMATCH);
    });
  });

  describe('Section 21: 15 Required Golden Cases', () => {

    test('Case 1: "akreditasi Bisnis Digital" -> entity Bisnis Digital, accreditation only', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'akreditasi Bisnis Digital',
        entities: [{ canonical: 'S1 Bisnis Digital' }],
        aspects: ['accreditation']
      });

      const candidates = [
        {
          id: 'c1',
          text: 'Akreditasi Program Studi S1 Bisnis Digital adalah Baik Sekali.',
          entityIds: ['S1 Bisnis Digital'],
          providedAspects: ['accreditation']
        },
        {
          id: 'c2',
          text: 'Rincian biaya kuliah per semester untuk S1 Bisnis Digital adalah Rp 7.500.000.',
          entityIds: ['S1 Bisnis Digital'],
          providedAspects: ['fee']
        },
        {
          id: 'c3',
          text: 'Akreditasi S1 Sistem Informasi adalah Unggul.',
          entityIds: ['S1 Sistem Informasi'],
          providedAspects: ['accreditation']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c1');
      expect(result.rejected.map(r => r.id)).toEqual(expect.arrayContaining(['c2', 'c3']));
    });

    test('Case 2: "biaya Sistem Informasi" -> entity Sistem Informasi, fee only', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'biaya Sistem Informasi',
        entities: [{ canonical: 'S1 Sistem Informasi' }],
        aspects: ['fee']
      });

      const candidates = [
        {
          id: 'c1',
          text: 'Biaya kuliah S1 Sistem Informasi semester 1 adalah Rp 8.000.000 dengan DPP cicilan.',
          entityIds: ['S1 Sistem Informasi'],
          providedAspects: ['fee']
        },
        {
          id: 'c2',
          text: 'Akreditasi S1 Sistem Informasi terakreditasi Unggul.',
          entityIds: ['S1 Sistem Informasi'],
          providedAspects: ['accreditation']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c1');
      expect(result.rejected[0].id).toBe('c2');
    });

    test('Case 3: "syarat S2 Sistem Informasi" -> level S2, requirements only, no S1 SMA/SMK', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'syarat S2 Sistem Informasi',
        entities: [{ canonical: 'S2 Sistem Informasi' }],
        aspects: ['requirements'],
        academicLevel: 'S2'
      });

      const candidates = [
        {
          id: 'c1_s2_req',
          text: 'Syarat pendaftaran Magister S2 Sistem Informasi: Ijazah Sarjana S1 Komputer atau linier, IPK minimal 2.75.',
          entityIds: ['S2 Sistem Informasi'],
          providedAspects: ['requirements'],
          academicLevel: 'S2'
        },
        {
          id: 'c2_s1_req',
          text: 'Syarat pendaftaran calon mahasiswa: Foto copy ijazah SMA/SMK dilegalisir, pas foto 3x4.',
          entityIds: ['S1 Sistem Informasi'],
          providedAspects: ['requirements'],
          academicLevel: 'S1'
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c1_s2_req');
      expect(result.rejected[0].id).toBe('c2_s1_req');
    });

    test('Case 4: "fasilitas Career Center" -> campus_service, facilities only, no program lab', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'fasilitas Career Center',
        entities: [{ canonical: 'Career Center' }],
        aspects: ['facilities']
      });

      const candidates = [
        {
          id: 'c1_cc_fac',
          text: 'Fasilitas Career Center meliputi ruang konseling karir, bursa kerja khusus, dan ruang wawancara kerja.',
          entityIds: ['Career Center'],
          providedAspects: ['facilities'],
          family: 'campus_service'
        },
        {
          id: 'c2_ti_lab',
          text: 'Fasilitas laboratorium komputer S1 Teknologi Informasi dilengkapi server riset.',
          entityIds: ['S1 Teknologi Informasi'],
          providedAspects: ['facilities'],
          family: 'academic_program'
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c1_cc_fac');
      expect(result.rejected[0].id).toBe('c2_ti_lab');
    });

    test('Case 5: "kuliah sore untuk yang bekerja" -> schedule aspect, no overseas contamination', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'kuliah sore untuk yang bekerja',
        aspects: ['schedule'],
        entities: []
      });

      const candidates = [
        {
          id: 'c1_schedule',
          text: 'Jadwal kuliah sore / kelas malam diselenggarakan setiap Senin hingga Jumat mulai pukul 18.00 untuk mahasiswa pekerja.',
          providedAspects: ['schedule']
        },
        {
          id: 'c2_overseas',
          text: 'Program kuliah sambil kerja di luar negeri Taiwan dan Jepang untuk magang internasional.',
          providedAspects: ['international_internship']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c1_schedule');
      expect(result.rejected[0].id).toBe('c2_overseas');
    });

    test('Case 6: Follow-up single entity inheritance ("akreditasinya?" prior: "jelaskan Bisnis Digital")', () => {
      // Prior session had S1 Bisnis Digital resolved. SemanticFrame inherits S1 Bisnis Digital.
      const frameTurn2 = {
        normalizedQuery: 'akreditasinya?',
        entities: [{ canonical: 'S1 Bisnis Digital', provenance: 'SESSION_STATE' }],
        aspects: ['accreditation']
      };

      const contract = buildRetrievalContract(frameTurn2);
      expect(contract.entityCanonical).toBe('S1 Bisnis Digital');
      expect(contract.retrievalState).toBe(RETRIEVAL_STATE.SCOPED_RETRIEVAL_ALLOWED);
      expect(contract.aspectFilter).toBe('accreditation');

      const chunk = {
        id: 'c_bd_acc',
        text: 'Program Studi S1 Bisnis Digital terakreditasi Baik Sekali oleh LAM INFOKOM.',
        entityIds: ['S1 Bisnis Digital'],
        providedAspects: ['accreditation']
      };

      const result = arbitrateEvidenceWithContract([chunk], contract);
      expect(result.accepted).toHaveLength(1);
    });

    test('Case 7: Follow-up multi-entity ambiguity ("akreditasinya?" prior: "BD dan SI" -> clarification)', () => {
      // Prior session had two entities without single focus -> ambiguous
      const frameTurn2 = {
        normalizedQuery: 'akreditasinya?',
        entities: [{ canonical: 'S1 Bisnis Digital' }, { canonical: 'S1 Sistem Informasi' }],
        aspects: ['accreditation'],
        isAmbiguous: true
      };

      const contract = buildRetrievalContract(frameTurn2);
      expect(contract.entityState).toBe('AMBIGUOUS');
      expect(contract.retrievalState).toBe(RETRIEVAL_STATE.CLARIFICATION_REQUIRED);

      const result = arbitrateEvidenceWithContract([], contract);
      expect(result.clarificationRequired).toBe(true);
      expect(result.hasSupportedEvidence).toBe(false);
    });

    test('Case 8: Comparison ("beda Sistem Informasi dan Teknologi Informasi?" -> compare scope for both)', () => {
      const frame = {
        normalizedQuery: 'beda Sistem Informasi dan Teknologi Informasi?',
        entities: [{ canonical: 'S1 Sistem Informasi' }, { canonical: 'S1 Teknologi Informasi' }],
        speechAct: 'COMPARE',
        intent: 'PROGRAM_COMPARISON',
        aspects: ['curriculum']
      };

      const contract = buildRetrievalContract(frame);
      expect(contract.isComparative).toBe(true);
      expect(contract.subContracts).toHaveLength(2);
      expect(contract.subContracts[0].entityCanonical).toBe('S1 Sistem Informasi');
      expect(contract.subContracts[1].entityCanonical).toBe('S1 Teknologi Informasi');
      expect(contract.retrievalState).toBe(RETRIEVAL_STATE.SCOPED_RETRIEVAL_ALLOWED);

      const candidateSI = {
        id: 'c_si',
        text: 'S1 Sistem Informasi berfokus pada manajemen sistem dan proses bisnis.',
        entityIds: ['S1 Sistem Informasi'],
        providedAspects: ['curriculum']
      };
      const candidateTI = {
        id: 'c_ti',
        text: 'S1 Teknologi Informasi berfokus pada rekayasa perangkat lunak dan infrastruktur.',
        entityIds: ['S1 Teknologi Informasi'],
        providedAspects: ['curriculum']
      };

      const result = arbitrateEvidenceWithContract([candidateSI, candidateTI], contract);
      expect(result.accepted).toHaveLength(2);
    });

    test('Case 9: "Double Degree DNUI kuliahnya di mana?" -> DNUI, location aspect', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'Double Degree DNUI kuliahnya di mana?',
        entities: [{ canonical: 'Double Degree DNUI' }],
        aspects: ['location']
      });

      expect(contract.entityFamily).toBe('international_program');
      expect(contract.aspectFilter).toBe('location');

      const candidates = [
        {
          id: 'c_dnui_loc',
          text: 'Perkuliahan program Dual Degree DNUI diselenggarakan 2 tahun di ITB STIKOM Bali dan 2 tahun di Kampus Dalian Neusoft University of Information di Tiongkok.',
          entityIds: ['Double Degree DNUI'],
          providedAspects: ['location']
        },
        {
          id: 'c_help_loc',
          text: 'Perkuliahan HELP University berada di Kuala Lumpur Malaysia.',
          entityIds: ['Double Degree HELP University'],
          providedAspects: ['location']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c_dnui_loc');
      expect(result.rejected[0].id).toBe('c_help_loc');
    });

    test('Case 10: "HELP University biaya berapa?" -> HELP entity, fee aspect', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'HELP University biaya berapa?',
        entities: [{ canonical: 'Double Degree HELP University' }],
        aspects: ['fee']
      });

      const candidates = [
        {
          id: 'c_help_fee',
          text: 'Biaya kuliah Double Degree HELP University mencakup biaya perkuliahan di Malaysia dan konversi valuta asing.',
          entityIds: ['Double Degree HELP University'],
          providedAspects: ['fee']
        },
        {
          id: 'c_dnui_fee',
          text: 'Biaya program DNUI Dalian Tiongkok.',
          entityIds: ['Double Degree DNUI'],
          providedAspects: ['fee']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c_help_fee');
    });

    test('Case 11: "syarat S2?" -> level S2 lock, no S1 fallback', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'syarat S2?',
        academicLevel: 'S2',
        aspects: ['requirements'],
        entities: []
      });

      expect(contract.academicLevel).toBe('S2');

      const candidates = [
        {
          id: 'c_s2',
          text: 'Syarat Magister S2: Ijazah S1 terakreditasi, transkrip nilai, TOEFL min 450.',
          academicLevel: 'S2',
          providedAspects: ['requirements']
        },
        {
          id: 'c_s1',
          text: 'Syarat pendaftaran lulusan SMA/SMK menyerahkan ijazah dan rapor.',
          academicLevel: 'S1',
          providedAspects: ['requirements']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c_s2');
      expect(result.rejected[0].id).toBe('c_s1');
    });

    test('Case 12: "ada teknik nuklir?" -> UNKNOWN_UNVERIFIED, no random retrieval', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'ada teknik nuklir?',
        entities: [],
        entityResolutionStatus: 'UNRESOLVED'
      });

      expect(contract.retrievalState).toBe(RETRIEVAL_STATE.NO_VERIFIED_ENTITY_EVIDENCE);

      const candidates = [
        { id: 'c_random', text: 'Program Studi Teknik Komputer ITB STIKOM Bali.' }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.hasSupportedEvidence).toBe(false);
      expect(result.accepted).toHaveLength(0);
    });

    test('Case 13: Controlled UNSUPPORTED case -> NO_RETRIEVAL', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'ada teknik geologi?',
        unsupportedEntity: true,
        unsupportedEntityName: 'Teknik Geologi'
      });

      expect(contract.retrievalState).toBe(RETRIEVAL_STATE.NO_RETRIEVAL);

      const result = arbitrateEvidenceWithContract([
        { id: 'c1', text: 'Biaya kuliah teknik' }
      ], contract);

      expect(result.retrievalState).toBe(RETRIEVAL_STATE.NO_RETRIEVAL);
      expect(result.accepted).toHaveLength(0);
    });

    test('Case 14: Newly ingested fictional program -> entity + aspect retrieval without code change', () => {
      // Open-world entity ingested dynamically without hardcoded catalog
      const contract = buildRetrievalContract({
        normalizedQuery: 'akreditasi Rekayasa AI',
        entities: [{ canonical: 'S1 Rekayasa AI' }],
        aspects: ['accreditation']
      });

      const chunkFictional = {
        id: 'chunk_fictional_ai',
        text: 'Program Studi S1 Rekayasa AI telah terakreditasi Baik Sekali oleh LAM INFOKOM pada tahun 2026.',
        entityIds: ['S1 Rekayasa AI'],
        providedAspects: ['accreditation']
      };

      const result = arbitrateEvidenceWithContract([chunkFictional], contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('chunk_fictional_ai');
    });

    test('Case 15: Cross-domain protection ("fasilitas Career Center" blocks unrelated campus service labs)', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'fasilitas Career Center',
        entities: [{ canonical: 'Career Center' }],
        aspects: ['facilities']
      });

      const candidates = [
        {
          id: 'c_lppm',
          text: 'Fasilitas LPPM mencakup ruang riset dosen dan laboratorium inovasi terapan.',
          entityIds: ['LPPM'],
          providedAspects: ['facilities']
        },
        {
          id: 'c_cc',
          text: 'Fasilitas Career Center menyediakan meja konsultasi karir dan tes psikologi kerja.',
          entityIds: ['Career Center'],
          providedAspects: ['facilities']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c_cc');
      expect(result.rejected[0].id).toBe('c_lppm');
    });
  });

  describe('Section 18 & 20: Evidence Ownership, Lineage, and Shadow Telemetry', () => {
    test('Accepted chunk carries full lineage metadata', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'akreditasi bisnis digital',
        entities: [{ canonical: 'S1 Bisnis Digital' }],
        aspects: ['accreditation'],
        academicLevel: 'S1'
      });

      const candidate = {
        id: 'chunk_lineage_test',
        text: 'Akreditasi S1 Bisnis Digital adalah Baik Sekali.',
        entityIds: ['S1 Bisnis Digital'],
        providedAspects: ['accreditation'],
        academicLevel: 'S1',
        provenanceDocumentId: 'doc_lineage_001',
        source_file: 'sk_akreditasi_bd.pdf'
      };

      const result = arbitrateEvidenceWithContract([candidate], contract);
      expect(result.accepted).toHaveLength(1);
      const accepted = result.accepted[0];

      expect(accepted.chunkId).toBe('chunk_lineage_test');
      expect(accepted.sourceDocument).toBe('sk_akreditasi_bd.pdf');
      expect(accepted.provenanceDocumentId).toBe('doc_lineage_001');
      expect(accepted.entityIds).toContain('S1 Bisnis Digital');
      expect(accepted.providedAspects).toContain('accreditation');
      expect(accepted.academicLevel).toBe('S1');
      expect(accepted.acceptanceReason).toBeDefined();
    });

    test('compareRetrievalShadow records structured telemetry without altering legacy outputs', () => {
      const legacyArbitrated = {
        accepted: [{ id: 'c1', text: 'biaya bd' }],
        rejected: [],
        hasSupportedEvidence: true
      };

      const newArbitrated = {
        accepted: [{ id: 'c1', text: 'biaya bd' }],
        rejected: [],
        hasSupportedEvidence: true,
        firstFailure: FIRST_FAILURE_TAXONOMY.EVIDENCE_ACCEPTED
      };

      const contract = buildRetrievalContract({
        normalizedQuery: 'biaya bisnis digital',
        entities: [{ canonical: 'S1 Bisnis Digital' }],
        aspects: ['fee']
      });

      const shadow = compareRetrievalShadow('biaya bisnis digital', [{ id: 'c1' }], legacyArbitrated, contract, newArbitrated);
      expect(shadow.rawQuery).toBe('biaya bisnis digital');
      expect(shadow.contractState).toBe(RETRIEVAL_STATE.SCOPED_RETRIEVAL_ALLOWED);
      expect(shadow.legacyAcceptedCount).toBe(1);
      expect(shadow.newAcceptedCount).toBe(1);
      expect(shadow.firstDifference).toBeNull();
    });
  });

  describe('Integration with retrievalPlanner and evidenceArbiter', () => {
    test('buildRetrievalPlan attaches retrievalContract to plan', () => {
      const frame = {
        normalizedQuery: 'akreditasi bisnis digital',
        domain: 'ACADEMIC_PROGRAM',
        intent: 'ACCREDITATION_INQUIRY',
        entities: [{ canonical: 'S1 Bisnis Digital' }],
        aspects: ['accreditation']
      };

      const plan = buildRetrievalPlan(frame);
      expect(plan.retrievalContract).toBeDefined();
      expect(plan.retrievalContract.entityCanonical).toBe('S1 Bisnis Digital');
      expect(plan.retrievalContract.aspectFilter).toBe('accreditation');
    });

    test('arbitrateEvidence runs shadow contract arbitration non-intrusively', () => {
      const frame = {
        normalizedQuery: 'akreditasi bisnis digital',
        entities: [{ canonical: 'S1 Bisnis Digital' }],
        aspects: ['accreditation']
      };
      const plan = buildRetrievalPlan(frame);

      const candidates = [
        {
          id: 'c1',
          text: 'Program Studi S1 Bisnis Digital terakreditasi Baik Sekali oleh LAM INFOKOM.',
          entityIds: ['S1 Bisnis Digital'],
          providedAspects: ['accreditation']
        }
      ];

      const arbitrated = arbitrateEvidence(candidates, plan);
      // Legacy arbitration result intact
      expect(arbitrated.hasSupportedEvidence).toBe(true);
      expect(arbitrated.accepted).toHaveLength(1);

      // Shadow contract arbitration attached
      expect(arbitrated.shadowContractArbitration).toBeDefined();
      expect(arbitrated.shadowContractArbitration.accepted).toHaveLength(1);
      expect(arbitrated.shadowComparison).toBeDefined();
    });
  });

  describe('Phase F.2D.2.3: Generic Paraphrase, Multi-Aspect, and Negative Boundary Arbitration', () => {
    test('accepts valid evidence with phrasing variations and qualifier prefixes', () => {
      const frame = {
        normalizedQuery: 'profil unit kegiatan mahasiswa DOS',
        entities: ['unit kegiatan mahasiswa DOS'],
        aspects: ['organization', 'general'],
        domain: 'STUDENT_LIFE'
      };
      const contract = buildRetrievalContract(frame);
      expect(contract.scopeConstraints.targetEntities).toContain('UKM DOS');

      const candidate = {
        id: 'chunk_dos_1',
        text: 'Unit Kegiatan Mahasiswa Dance of STIKOM Bali (UKM DOS) bergerak di bidang modern dance.',
        sourceFile: 'Profil UKM DOS.docx'
      };

      const result = arbitrateEvidenceWithContract([candidate], contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('chunk_dos_1');
      expect(result.hasSupportedEvidence).toBe(true);
    });

    test('accepts chunks supporting any aspect in multi-aspect requests, rejects chunks supporting none', () => {
      const frame = {
        normalizedQuery: 'akreditasi dan gelar lulusan S2 Sistem Informasi',
        entities: ['S2 Sistem Informasi'],
        academicLevel: 'S2',
        aspects: ['accreditation', 'degree_award'],
        domain: 'ACADEMIC_PROGRAM'
      };
      const contract = buildRetrievalContract(frame);

      const degreeOnlyCandidate = {
        id: 'chunk_deg_only',
        text: 'Lulusan program Magister Sistem Informasi (S2) memperoleh gelar Magister Komputer (M.Kom).',
        academicLevel: 'S2'
      };

      const accredOnlyCandidate = {
        id: 'chunk_acc_only',
        text: 'Program S2 Sistem Informasi telah meraih peringkat akreditasi Baik Sekali dari LAM-INFOKOM.',
        academicLevel: 'S2'
      };

      const irrelevantAspectCandidate = {
        id: 'chunk_fac_only',
        text: 'Mahasiswa Magister Sistem Informasi (S2) dapat menikmati fasilitas perpustakaan dan ruang belajar di kampus.',
        academicLevel: 'S2'
      };

      const result = arbitrateEvidenceWithContract(
        [degreeOnlyCandidate, accredOnlyCandidate, irrelevantAspectCandidate],
        contract
      );

      const acceptedIds = result.accepted.map(a => a.id);
      expect(acceptedIds).toContain('chunk_deg_only');
      expect(acceptedIds).toContain('chunk_acc_only');
      expect(acceptedIds).not.toContain('chunk_fac_only');

      const rejectedFac = result.rejected.find(r => r.id === 'chunk_fac_only');
      expect(rejectedFac).toBeDefined();
      expect(rejectedFac.disposition).toBe('REJECT_ASPECT_MISMATCH');
    });

    test('rejects candidate with wrong entity despite high lexical overlap', () => {
      const frame = {
        normalizedQuery: 'informasi ukm dos',
        entities: ['UKM DOS'],
        aspects: ['organization'],
        domain: 'STUDENT_LIFE'
      };
      const contract = buildRetrievalContract(frame);

      const wrongEntityCandidate = {
        id: 'chunk_wrong_ent',
        text: 'Unit kegiatan mahasiswa olahraga basket kampus dan pembinaan dosen pembina UKM Basket.',
        entityIds: ['UKM Basket']
      };

      const result = arbitrateEvidenceWithContract([wrongEntityCandidate], contract);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].disposition).toBe('REJECT_ENTITY_MISMATCH');
    });

    test('rejects candidate from wrong domain/aspect without factual proof', () => {
      const frame = {
        normalizedQuery: 'biaya kuliah sistem informasi',
        entities: ['S1 Sistem Informasi'],
        academicLevel: 'S1',
        aspects: ['fee'],
        domain: 'TUITION_FEE'
      };
      const contract = buildRetrievalContract(frame);

      const wrongAspectCandidate = {
        id: 'chunk_history_only',
        text: 'Program Studi S1 Sistem Informasi didirikan dengan visi keunggulan dan laboratorium komputer lengkap.',
        academicLevel: 'S1'
      };

      const result = arbitrateEvidenceWithContract([wrongAspectCandidate], contract);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].disposition).toBe('REJECT_ASPECT_MISMATCH');
    });

    test('rejects candidate with academic level conflict when body text lacks requested level', () => {
      const frame = {
        normalizedQuery: 'biaya S2 Sistem Informasi',
        entities: ['S2 Sistem Informasi'],
        academicLevel: 'S2',
        aspects: ['fee'],
        domain: 'TUITION_FEE'
      };
      const contract = buildRetrievalContract(frame);

      const s1OnlyCandidate = {
        id: 'chunk_s1_only',
        text: 'Biaya kuliah S1 Sistem Informasi untuk lulusan SMA/SMK dengan SPP cicilan per semester.',
        academicLevel: 'S1',
        academicLevels: ['S1']
      };

      const result = arbitrateEvidenceWithContract([s1OnlyCandidate], contract);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(['REJECT_LEVEL_MISMATCH', 'REJECT_METADATA_CONFLICT']).toContain(result.rejected[0].disposition);
    });

    test('blocks evidence arbitration when contract state is CLARIFICATION_REQUIRED or NO_RETRIEVAL', () => {
      const clarifyContract = {
        retrievalState: RETRIEVAL_STATE.CLARIFICATION_REQUIRED,
        firstFailure: FIRST_FAILURE_TAXONOMY.ENTITY_AMBIGUOUS
      };
      const noRetContract = {
        retrievalState: RETRIEVAL_STATE.NO_RETRIEVAL,
        firstFailure: FIRST_FAILURE_TAXONOMY.OUT_OF_SCOPE
      };

      const mockCandidate = { id: 'c1', text: 'Some factual text.' };

      const clarifyRes = arbitrateEvidenceWithContract([mockCandidate], clarifyContract);
      expect(clarifyRes.clarificationRequired).toBe(true);
      expect(clarifyRes.accepted).toHaveLength(0);
      expect(clarifyRes.rejected).toHaveLength(1);
      expect(clarifyRes.firstFailure).toBe(FIRST_FAILURE_TAXONOMY.ENTITY_AMBIGUOUS);

      const noRetRes = arbitrateEvidenceWithContract([mockCandidate], noRetContract);
      expect(noRetRes.retrievalState).toBe(RETRIEVAL_STATE.NO_RETRIEVAL);
      expect(noRetRes.accepted).toHaveLength(0);
      expect(noRetRes.rejected).toHaveLength(1);
      expect(noRetRes.unsupportedEntity).toBe(true);
    });
  });
});
