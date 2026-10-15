'use strict';

/**
 * tests/evidenceArbiter.semanticScope.test.js
 *
 * Focused Evidence Arbiter Semantic Scope & Arbitration Tests for Phase F.
 * Verifies that dynamic evidence arbitration enforces semantic frame invariants
 * and prevents scope leakage, sibling collision, cross-family contamination,
 * and level mismatch.
 */

const {
  RETRIEVAL_STATE,
  EVIDENCE_METADATA_STATE,
  FIRST_FAILURE_TAXONOMY,
  buildRetrievalContract,
  arbitrateEvidenceWithContract
} = require('../src/core/retrievalContract');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');

describe('EvidenceArbiter: Semantic Scope & Dynamic Arbitration', () => {

  describe('Near-Sibling Scope Protection', () => {
    test('strictly rejects Sistem Informasi chunk when target is Bisnis Digital even with high similarity', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'kurikulum bisnis digital',
        entities: [{ canonical: 'S1 Bisnis Digital' }],
        aspects: ['curriculum']
      });

      const candidates = [
        {
          id: 'chunk_si_curriculum',
          text: 'Mata kuliah Program Studi S1 Sistem Informasi meliputi Basis Data, Rekayasa Perangkat Lunak, dan Manajemen SI.',
          entityIds: ['S1 Sistem Informasi'],
          providedAspects: ['curriculum'],
          vectorSimilarity: 0.99
        },
        {
          id: 'chunk_bd_curriculum',
          text: 'Mata kuliah S1 Bisnis Digital mempelajari Startup, E-Commerce, Pemasaran Digital, dan FinTech.',
          entityIds: ['S1 Bisnis Digital'],
          providedAspects: ['curriculum'],
          vectorSimilarity: 0.85
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('chunk_bd_curriculum');
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].id).toBe('chunk_si_curriculum');
      expect(result.rejected[0].disposition).toMatch(/REJECT_(?:SCOPE_COLLISION|ENTITY_MISMATCH|METADATA_CONFLICT)/);
    });

    test('strictly rejects Teknologi Informasi chunk when target is Sistem Komputer', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'akreditasi Sistem Komputer',
        entities: [{ canonical: 'S1 Sistem Komputer' }],
        aspects: ['accreditation']
      });

      const candidates = [
        {
          id: 'chunk_ti',
          text: 'Akreditasi Program Studi S1 Teknologi Informasi adalah Baik Sekali.',
          entityIds: ['S1 Teknologi Informasi'],
          providedAspects: ['accreditation']
        },
        {
          id: 'chunk_sk',
          text: 'Akreditasi Program Studi S1 Sistem Komputer telah terakreditasi Baik Sekali oleh LAM INFOKOM.',
          entityIds: ['S1 Sistem Komputer'],
          providedAspects: ['accreditation']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('chunk_sk');
      expect(result.rejected[0].id).toBe('chunk_ti');
    });
  });

  describe('Cross-Family Contamination Prevention', () => {
    test('strictly rejects student organization chunks when target is academic program', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'kegiatan program studi Sistem Informasi',
        entities: [{ canonical: 'S1 Sistem Informasi' }],
        aspects: ['curriculum']
      });

      const candidates = [
        {
          id: 'chunk_hima',
          text: 'HIMAPRODI Sistem Informasi mengadakan kegiatan malam keakraban mahasiswa baru.',
          entityIds: ['HIMAPRODI Sistem Informasi'],
          family: 'student_organization',
          providedAspects: ['organization']
        },
        {
          id: 'chunk_prodi',
          text: 'Kurikulum dan kegiatan akademik program studi S1 Sistem Informasi berbasis proyek industri.',
          entityIds: ['S1 Sistem Informasi'],
          family: 'academic_program',
          providedAspects: ['curriculum']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('chunk_prodi');
      expect(result.rejected[0].id).toBe('chunk_hima');
    });

    test('strictly rejects academic program facility chunks when target is campus facility', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'fasilitas perpustakaan kampus',
        entities: [{ canonical: 'Perpustakaan Kampus' }],
        aspects: ['facilities']
      });

      const candidates = [
        {
          id: 'chunk_perpus',
          text: 'Fasilitas Perpustakaan Kampus menyediakan ruang baca ber-AC, ribuan e-book, dan akses jurnal IEEE.',
          entityIds: ['Perpustakaan Kampus'],
          providedAspects: ['facilities'],
          family: 'campus_facility'
        },
        {
          id: 'chunk_lab_ti',
          text: 'Fasilitas Lab Komputer S1 TI memiliki 40 unit PC spesifikasi tinggi.',
          entityIds: ['S1 Teknologi Informasi'],
          providedAspects: ['facilities'],
          family: 'academic_program'
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('chunk_perpus');
      expect(result.rejected[0].id).toBe('chunk_lab_ti');
    });
  });

  describe('Academic Level Enforcement', () => {
    test('rejects S1 evidence when S2 is explicitly requested', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'persyaratan masuk S2 Sistem Informasi',
        entities: [{ canonical: 'S2 Sistem Informasi' }],
        academicLevel: 'S2',
        aspects: ['requirements']
      });

      const candidates = [
        {
          id: 'c_s1',
          text: 'Syarat penerimaan mahasiswa baru S1: ijazah SMA/SMK atau sederajat.',
          entityIds: ['S1 Sistem Informasi'],
          academicLevel: 'S1',
          providedAspects: ['requirements']
        },
        {
          id: 'c_s2',
          text: 'Syarat penerimaan Program Magister S2 Sistem Informasi: Ijazah Sarjana (S1), IPK min 2.75, tes TPA dan wawancara.',
          entityIds: ['S2 Sistem Informasi'],
          academicLevel: 'S2',
          providedAspects: ['requirements']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c_s2');
      expect(result.rejected[0].id).toBe('c_s1');
      expect(result.rejected[0].dispositionReason).toMatch(/level|mismatch|sibling|excluded/i);
    });

    test('rejects S2 evidence when S1 is explicitly requested', () => {
      const contract = buildRetrievalContract({
        normalizedQuery: 'biaya kuliah S1 Bisnis Digital',
        entities: [{ canonical: 'S1 Bisnis Digital' }],
        academicLevel: 'S1',
        aspects: ['fee']
      });

      const candidates = [
        {
          id: 'c_s2_fee',
          text: 'Biaya kuliah Program Magister S2 per semester adalah Rp 9.000.000.',
          academicLevel: 'S2',
          providedAspects: ['fee']
        },
        {
          id: 'c_s1_fee',
          text: 'Biaya kuliah S1 Bisnis Digital semester 1 adalah Rp 7.500.000.',
          entityIds: ['S1 Bisnis Digital'],
          academicLevel: 'S1',
          providedAspects: ['fee']
        }
      ];

      const result = arbitrateEvidenceWithContract(candidates, contract);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('c_s1_fee');
      expect(result.rejected[0].id).toBe('c_s2_fee');
    });
  });

  describe('Shadow Telemetry & Non-Interference', () => {
    test('legacy arbitrateEvidence returns identical legacy structure with shadow field attached', () => {
      const plan = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        targetEntities: ['S1 Bisnis Digital'],
        requiredAspects: ['curriculum'],
        excludedConflictingEntities: ['S1 Sistem Informasi']
      };

      const candidates = [
        {
          id: 'cand_1',
          text: 'Program Studi S1 Bisnis Digital struktur kurikulum dan mata kuliah bisnis modern.',
          entityIds: ['S1 Bisnis Digital'],
          providedAspects: ['curriculum']
        }
      ];

      const legacyRes = arbitrateEvidence(candidates, plan);
      expect(legacyRes.accepted).toBeDefined();
      expect(legacyRes.rejected).toBeDefined();
      expect(legacyRes.hasSupportedEvidence).toBe(true);
      expect(legacyRes.shadowContractArbitration).toBeDefined();
      expect(legacyRes.shadowComparison).toBeDefined();
      expect(legacyRes.shadowComparison.rawQuery).toBeDefined();
    });
  });

  describe('Multi-Program Context & Conflict Isolation', () => {
    test('legitimate multi-program fee evidence supporting S1 Bisnis Digital is accepted', () => {
      const plan = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        targetEntities: ['S1 Bisnis Digital'],
        requiredAspects: ['fee', 'tuition', 'dpp'],
        excludedConflictingEntities: ['S1 Sistem Informasi', 'S1 Teknologi Informasi', 'S2 Sistem Informasi']
      };

      const candidates = [
        {
          id: 'chunk_shared_fee_bd',
          text: '[Program: S1 Sistem Informasi, S1 Teknologi Informasi, S1 Bisnis Digital] No. Jenis Biaya Rp Waktu Pembayaran 2. Dana Pendidikan Pokok 14.000.000 5. Biaya Pendidikan Per Semester 6.500.000 Menjelang Perwalian',
          sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
          contextEntities: ['S1 Sistem Informasi', 'S1 Teknologi Informasi', 'S1 Bisnis Digital'],
          scope: 'PROGRAM_MULTI',
          academicLevel: 'S1',
          docCategory: 'BIAYA'
        }
      ];

      const res = arbitrateEvidence(candidates, plan);
      expect(res.accepted).toHaveLength(1);
      expect(res.accepted[0].id).toBe('chunk_shared_fee_bd');
    });

    test('candidate explicitly conflicting in degree level or single program is NOT accepted merely because contextEntities has target', () => {
      const plan = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        targetEntities: ['S1 Bisnis Digital'],
        academicLevel: 'S1',
        requiredAspects: ['fee'],
        excludedConflictingEntities: ['S1 Sistem Informasi', 'S2 Sistem Informasi']
      };

      const conflictingCandidates = [
        // Level conflict: explicitly S2 graduate fee
        {
          id: 'cand_s2_conflict',
          text: 'Biaya pendidikan Program Pascasarjana Magister S2 Sistem Informasi Rp 9.500.000 per semester.',
          sourceFile: 'biaya_s2.pdf',
          academicLevel: 'S2',
          level: 'S2',
          contextEntities: ['S1 Bisnis Digital', 'S2 Sistem Informasi'],
          docCategory: 'BIAYA'
        },
        // Single program conflict: explicitly scoped to TI single program
        {
          id: 'cand_ti_single_conflict',
          text: '[Program: S1 Teknologi Informasi] Biaya Praktikum Khusus Laboratorium Jaringan S1 TI.',
          sourceFile: 'biaya_ti_khusus.pdf',
          program: 'TI',
          scope: 'PROGRAM_SINGLE',
          contextEntities: ['S1 Bisnis Digital', 'S1 Teknologi Informasi'],
          docCategory: 'BIAYA'
        }
      ];

      const res = arbitrateEvidence(conflictingCandidates, plan);
      expect(res.accepted).toHaveLength(0);
      expect(res.rejected).toHaveLength(2);
      expect(res.rejected[0].id).toBe('cand_s2_conflict');
      expect(res.rejected[1].id).toBe('cand_ti_single_conflict');
    });

    test('positive control: candidate with valid S2 academicLevel metadata matches S2 target even without S2/magister in text', () => {
      const plan = {
        domain: 'ACADEMIC_CURRICULUM',
        intent: 'CURRICULUM_INQUIRY',
        targetEntities: ['S2 Sistem Informasi'],
        academicLevel: 'S2',
        requiredAspects: ['curriculum']
      };

      const candidates = [
        {
          id: 'chunk_s2_no_marker_in_text',
          text: 'Kurikulum dan mata kuliah Sistem Informasi mencakup Business Analytics, IT Governance, dan Enterprise Architecture.',
          sourceFile: 'kurikulum_pasca.pdf',
          academicLevel: 'S2',
          level: 'S2',
          program: 'S2',
          providedAspects: ['curriculum']
        }
      ];

      const res = arbitrateEvidence(candidates, plan);
      expect(res.accepted).toHaveLength(1);
      expect(res.accepted[0].id).toBe('chunk_s2_no_marker_in_text');
    });

    test('positive control: candidate with valid D3 academicLevel metadata matches D3 target even without D3/diploma in text', () => {
      const plan = {
        domain: 'ACADEMIC_CURRICULUM',
        intent: 'CURRICULUM_INQUIRY',
        targetEntities: ['D3 Manajemen Informatika'],
        academicLevel: 'D3',
        requiredAspects: ['curriculum']
      };

      const candidates = [
        {
          id: 'chunk_d3_no_marker_in_text',
          text: 'Kurikulum dan mata kuliah Manajemen Informatika difokuskan pada pengelolaan sistem basis data perkantoran dan administrasi IT.',
          sourceFile: 'kompetensi_lulusan.pdf',
          academicLevel: 'D3',
          level: 'D3',
          program: 'MI',
          providedAspects: ['curriculum']
        }
      ];

      const res = arbitrateEvidence(candidates, plan);
      expect(res.accepted).toHaveLength(1);
      expect(res.accepted[0].id).toBe('chunk_d3_no_marker_in_text');
    });
  });
});
