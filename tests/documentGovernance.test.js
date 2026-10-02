'use strict';

/**
 * documentGovernance.test.js
 *
 * Verifies Document Validity & Lifecycle Governance implementation:
 * - Status normalization and lifecycle states (active, superseded, expired, draft, archived)
 * - Authority hierarchy and tier comparisons (Tier 1 > Tier 2 > Tier 3 > Tier 4)
 * - Document validity windows (validFrom, validUntil)
 * - Superseded relations (supersedes, supersededBy)
 * - Chunk-level governance filtering and enrichment
 * - Integration with semantic RAG query execution
 */

const {
  AUTHORITY_TIERS,
  normalizeAuthority,
  getAuthorityTier,
  compareAuthority,
  normalizeStatus,
  buildDocumentGovernanceMetadata,
  getTrainingGovernance,
  isTrainingGovernanceAllowed,
  filterGovernedTrainingRows,
  isChunkGovernanceAllowed,
  filterGovernedChunks,
  enrichChunkWithGovernance
} = require('../src/engine/runtimeGovernance');

const { querySemanticRag } = require('../src/engine/semanticRagEngine');

describe('Document Validity & Lifecycle Governance', () => {
  beforeEach(() => {
    jest.setTimeout(120000);
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  // -------------------------------------------------------------------------
  // 1. Status Normalization & Lifecycle States
  // -------------------------------------------------------------------------
  describe('Status Normalization', () => {
    test('normalizes active synonyms to active', () => {
      expect(normalizeStatus('active')).toBe('active');
      expect(normalizeStatus('approved')).toBe('active');
      expect(normalizeStatus('published')).toBe('active');
      expect(normalizeStatus('valid')).toBe('active');
    });

    test('normalizes superseded synonyms to superseded', () => {
      expect(normalizeStatus('superseded')).toBe('superseded');
      expect(normalizeStatus('replaced')).toBe('superseded');
    });

    test('normalizes expired synonyms to expired', () => {
      expect(normalizeStatus('expired')).toBe('expired');
      expect(normalizeStatus('inactive')).toBe('expired');
      expect(normalizeStatus('obsolete')).toBe('expired');
    });

    test('normalizes draft synonyms to draft', () => {
      expect(normalizeStatus('draft')).toBe('draft');
      expect(normalizeStatus('pending')).toBe('draft');
      expect(normalizeStatus('template')).toBe('draft');
    });

    test('normalizes archived synonyms to archived', () => {
      expect(normalizeStatus('archived')).toBe('archived');
      expect(normalizeStatus('historical')).toBe('archived');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Authority Tiers & Hierarchy
  // -------------------------------------------------------------------------
  describe('Authority Hierarchy', () => {
    test('defines 4 standard authority tiers with descending weights', () => {
      expect(AUTHORITY_TIERS.tier_1_official_decree.tier).toBe(1);
      expect(AUTHORITY_TIERS.tier_1_official_decree.weight).toBe(100);

      expect(AUTHORITY_TIERS.tier_2_official_announcement.tier).toBe(2);
      expect(AUTHORITY_TIERS.tier_2_official_announcement.weight).toBe(80);

      expect(AUTHORITY_TIERS.tier_3_curriculum_guideline.tier).toBe(3);
      expect(AUTHORITY_TIERS.tier_3_curriculum_guideline.weight).toBe(60);

      expect(AUTHORITY_TIERS.tier_4_supporting_doc.tier).toBe(4);
      expect(AUTHORITY_TIERS.tier_4_supporting_doc.weight).toBe(40);
    });

    test('normalizes authority aliases accurately', () => {
      expect(normalizeAuthority('sk_rektor')).toBe('tier_1_official_decree');
      expect(normalizeAuthority('decree')).toBe('tier_1_official_decree');
      expect(normalizeAuthority('pengumuman_baak')).toBe('tier_2_official_announcement');
      expect(normalizeAuthority('calendar')).toBe('tier_2_official_announcement');
      expect(normalizeAuthority('pedoman_ta')).toBe('tier_3_curriculum_guideline');
      expect(normalizeAuthority('kurikulum')).toBe('tier_3_curriculum_guideline');
      expect(normalizeAuthority('profil_ukm')).toBe('tier_4_supporting_doc');
      expect(normalizeAuthority('template')).toBe('tier_4_supporting_doc');
    });

    test('compares authority levels correctly: Tier 1 > Tier 2 > Tier 3 > Tier 4', () => {
      expect(compareAuthority('tier_1_official_decree', 'tier_2_official_announcement')).toBeGreaterThan(0);
      expect(compareAuthority('tier_2_official_announcement', 'tier_3_curriculum_guideline')).toBeGreaterThan(0);
      expect(compareAuthority('tier_3_curriculum_guideline', 'tier_4_supporting_doc')).toBeGreaterThan(0);
      expect(compareAuthority('tier_4_supporting_doc', 'tier_1_official_decree')).toBeLessThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Document Governance & Row Filtering
  // -------------------------------------------------------------------------
  describe('Document Governance Row Filtering', () => {
    test('allows active documents within valid time window', () => {
      const row = {
        governanceStatus: 'active',
        authorityTier: 1,
        validFrom: new Date('2025-01-01'),
        validTo: new Date('2030-01-01')
      };
      expect(isTrainingGovernanceAllowed(row)).toBe(true);
    });

    test('blocks superseded documents', () => {
      const row = {
        governanceStatus: 'superseded',
        authorityTier: 1,
        validFrom: new Date('2025-01-01')
      };
      expect(isTrainingGovernanceAllowed(row)).toBe(false);
    });

    test('blocks documents with supersededBy relation', () => {
      const row = {
        governanceStatus: 'active',
        authorityTier: 1,
        validFrom: new Date('2025-01-01'),
        governanceMetadata: { supersededBy: 'Kalender-2026/2027.pdf' }
      };
      expect(isTrainingGovernanceAllowed(row)).toBe(false);
    });

    test('blocks expired documents based on validTo in past', () => {
      const row = {
        governanceStatus: 'active',
        authorityTier: 1,
        validFrom: new Date('2020-01-01'),
        validTo: new Date('2021-01-01')
      };
      expect(isTrainingGovernanceAllowed(row)).toBe(false);
    });

    test('blocks draft documents by default', () => {
      const row = {
        governanceStatus: 'draft',
        authorityTier: 1,
        validFrom: new Date('2026-01-01')
      };
      expect(isTrainingGovernanceAllowed(row)).toBe(false);
    });

    test('blocks archived documents by default', () => {
      const row = {
        governanceStatus: 'archived',
        authorityTier: 1,
        validFrom: new Date('2024-01-01')
      };
      expect(isTrainingGovernanceAllowed(row)).toBe(false);
    });

    test('filterGovernedTrainingRows filters array accurately', () => {
      const rows = [
        { id: '1', governanceStatus: 'active', authorityTier: 1 },
        { id: '2', governanceStatus: 'superseded', authorityTier: 1 },
        { id: '3', governanceStatus: 'draft', authorityTier: 1 },
        { id: '4', governanceStatus: 'active', authorityTier: 1, validTo: new Date('2020-01-01') },
        { id: '5', governanceStatus: 'active', authorityTier: 1, validTo: new Date('2030-01-01') }
      ];
      const filtered = filterGovernedTrainingRows(rows);
      expect(filtered.map(r => r.id)).toEqual(['1', '5']);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Chunk Governance & Fail-Closed Policy (10 Mandatory Requirements)
  // -------------------------------------------------------------------------
  describe('Chunk-Level Governance & Fail-Closed Enforcement', () => {
    test('enriches chunk with full governance metadata', () => {
      const rawChunk = {
        id: 'chunk-1',
        chunk: 'Deskripsi program',
        filename: 'rincian Biaya UTB Tahun Ajaran 2026-2027.pdf'
      };
      const enriched = enrichChunkWithGovernance(rawChunk, {
        authority: 'tier_1_official_decree',
        status: 'active',
        version: 'SK-629-2025'
      });

      expect(enriched.governanceStatus).toBe('active');
      expect(enriched.authority).toBe('tier_1_official_decree');
      expect(enriched.authorityTier).toBe(1);
      expect(enriched.version).toBe('SK-629-2025');
      expect(enriched.governanceMetadata.authorityWeight).toBe(100);
    });

    test('1. missing governance metadata -> BLOCK current retrieval', () => {
      expect(isChunkGovernanceAllowed({})).toBe(false);
      expect(isChunkGovernanceAllowed(null)).toBe(false);
      expect(isChunkGovernanceAllowed({ id: 'c1', chunk: 'Informasi kampus tanpa metadata' })).toBe(false);
    });

    test('2. partial governance metadata -> BLOCK current retrieval', () => {
      // Missing authority
      expect(isChunkGovernanceAllowed({ status: 'active' })).toBe(false);
      // Missing status
      expect(isChunkGovernanceAllowed({ authorityTier: 2 })).toBe(false);
      // Unrecognized authority
      expect(isChunkGovernanceAllowed({ status: 'active', authority: 'tier_unknown' })).toBe(false);
      // Validity unknown status
      expect(isChunkGovernanceAllowed({ status: 'validity_unknown', authorityTier: 1 })).toBe(false);
    });

    test('3. active + valid window -> ALLOW', () => {
      const validChunk = {
        status: 'active',
        authorityTier: 2,
        validFrom: '2025-01-01T00:00:00.000Z',
        validUntil: '2030-01-01T00:00:00.000Z'
      };
      expect(isChunkGovernanceAllowed(validChunk)).toBe(true);
    });

    test('4. active + expired date -> BLOCK', () => {
      const expiredChunk = {
        status: 'active',
        authorityTier: 2,
        validFrom: '2020-01-01T00:00:00.000Z',
        validUntil: '2021-01-01T00:00:00.000Z'
      };
      expect(isChunkGovernanceAllowed(expiredChunk)).toBe(false);
    });

    test('5. active + future validFrom -> BLOCK', () => {
      const futureChunk = {
        status: 'active',
        authorityTier: 2,
        validFrom: '2035-01-01T00:00:00.000Z',
        validUntil: '2036-01-01T00:00:00.000Z'
      };
      expect(isChunkGovernanceAllowed(futureChunk)).toBe(false);
    });

    test('6. superseded -> BLOCK', () => {
      expect(isChunkGovernanceAllowed({ status: 'superseded', authorityTier: 2 })).toBe(false);
      expect(isChunkGovernanceAllowed({ status: 'active', authorityTier: 2, supersededBy: 'Kalender-2026/2027.pdf' })).toBe(false);
    });

    test('7. draft -> BLOCK', () => {
      expect(isChunkGovernanceAllowed({ status: 'draft', authorityTier: 2 })).toBe(false);
    });

    test('8. archived -> BLOCK', () => {
      expect(isChunkGovernanceAllowed({ status: 'archived', authorityTier: 2 })).toBe(false);
    });

    test('9. explicit historical query + expired historical document -> ALLOW when relevant', () => {
      const historicalDoc = {
        status: 'expired',
        authorityTier: 2,
        chunk: 'Sejarah pendirian ITB STIKOM Bali bermula pada 10 Agustus 2002 oleh para tokoh pendiri.',
        filename: 'Sejarah_Kampus.pdf'
      };
      const allowed = isChunkGovernanceAllowed(historicalDoc, {
        allowHistorical: true,
        query: 'Kapan sejarah kampus didirikan dan siapa tokoh pendiri STIKOM Bali?'
      });
      expect(allowed).toBe(true);
    });

    test('10. historical query + unrelated expired document -> BLOCK', () => {
      const unrelatedExpiredDoc = {
        status: 'expired',
        authorityTier: 2,
        chunk: 'Batas pendaftaran loket PMB gelombang 1 dibuka sampai biaya registrasi lunas.',
        filename: 'Jadwal_PMB_2021.pdf'
      };
      const allowed = isChunkGovernanceAllowed(unrelatedExpiredDoc, {
        allowHistorical: true,
        query: 'Kapan sejarah kampus didirikan dan siapa tokoh pendiri STIKOM Bali?'
      });
      expect(allowed).toBe(false);
    });

    test('filterGovernedChunks removes unallowed and unknown chunks', () => {
      const chunks = [
        { id: 'c1', status: 'active', authorityTier: 2 },
        { id: 'c2', status: 'superseded', authorityTier: 2 },
        { id: 'c3', status: 'archived', authorityTier: 2 },
        { id: 'c4', status: 'active', authorityTier: 1 },
        { id: 'c5', status: 'validity_unknown' },
        { id: 'c6' } // missing metadata
      ];
      const result = filterGovernedChunks(chunks);
      expect(result.map(c => c.id)).toEqual(['c1', 'c4']);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Correctness & Semantic RAG Grounding Verification
  // -------------------------------------------------------------------------
  describe('Semantic RAG Grounding with Governance Active', () => {
    test('Kapan yudisium? outputs authoritative execution date', async () => {
      const res = await querySemanticRag('Kapan yudisium?');
      expect(res.success).toBe(true);
      expect(res.answer).toMatch(/14 Oktober 2026/i);
      expect(res.answer).toMatch(/Aula STIKOMBALI/i);
      // Must NOT confuse with registration deadline
      expect(res.answer).not.toMatch(/batas pendaftaran/i);
    });

    test('Kapan batas pendaftaran yudisium? outputs registration deadline', async () => {
      const res = await querySemanticRag('Kapan batas pendaftaran yudisium?');
      expect(res.success).toBe(true);
      expect(res.answer).toMatch(/2 Oktober 2026/i);
      expect(res.answer).toMatch(/Loket Akademik/i);
      // Must NOT confuse with execution date
      expect(res.answer).not.toMatch(/Pelaksanaan Yudisium/i);
    });

    test('Jadwal yudisium outputs both execution and registration dates', async () => {
      const res = await querySemanticRag('Jadwal yudisium');
      expect(res.success).toBe(true);
      expect(res.answer).toMatch(/14 Oktober 2026/i);
      expect(res.answer).toMatch(/2 Oktober 2026/i);
    });

    test('SEO inquiry routes cleanly to Bisnis Digital curriculum', async () => {
      const res = await querySemanticRag('Apakah mahasiswa belajar SEO?');
      expect(res.success).toBe(true);
      expect(res.answer).toMatch(/Bisnis Digital/i);
      expect(res.answer).toMatch(/SEO|Search Engine Optimization/i);
    });

    test('DKV inquiry resolves prodi availability and UTB Dual Degree', async () => {
      const res = await querySemanticRag('Untuk perkuliahan, program studi yang mempelajari DKV ada ya?');
      expect(res.success).toBe(true);
      expect(res.answer).toMatch(/tidak ada program studi mandiri bernama DKV/i);
      expect(res.answer).toMatch(/Dual Degree/i);
      expect(res.answer).toMatch(/UTB/i);
    });
  });
});
