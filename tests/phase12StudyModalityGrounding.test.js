const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
const { querySemanticRag, isChunkValidModalityEvidence } = require('../src/engine/semanticRagEngine');

describe('Phase 1.2 & 1.2.1 Remediation: Grounding & Study Modality Invariant Suite', () => {
  jest.setTimeout(45000);

  describe('Section B: Modality Evidence Contract & False Positive Prevention', () => {
    test('Q1 Regression: Rejects thesis guidelines / citation chunks with "sumber online / website" as modality evidence', () => {
      const citationChunk = {
        title: 'Buku Pedoman Tugas Akhir.pdf',
        text: 'Daftar Pustaka: untuk sumber online atau website, cantumkan URL dan tanggal akses.'
      };
      const isValid = isChunkValidModalityEvidence(citationChunk, ['deliveryMode']);
      expect(isValid).toBe(false);
    });

    test('Rejects internal IT quick-links portal as deliveryMode evidence', () => {
      const portalChunk = {
        title: 'Website Portal Info',
        text: 'Akses cepat mahasiswa: SION, E-Learning STIKOM Bali, dan Perpustakaan Online.'
      };
      const isValid = isChunkValidModalityEvidence(portalChunk, ['deliveryMode']);
      expect(isValid).toBe(false);
    });

    test('Accepts legitimate academic delivery mode text', () => {
      const legitimateChunk = {
        title: 'Brosur Perkuliahan.pdf',
        text: 'Sistem perkuliahan dilaksanakan secara tatap muka (luring) di kampus dan tersedia kelas daring via LMS.'
      };
      const isValid = isChunkValidModalityEvidence(legitimateChunk, ['deliveryMode']);
      expect(isValid).toBe(true);
    });
  });

  describe('Section K: Mandatory 8-Query Test Matrix', () => {
    test('Query 1: "kuliahnya online/offline?" -> safe data-gap, no false citation grounding, no hardcode', async () => {
      const q = 'kuliahnya online/offline?';
      const canonical = buildCanonicalQueryUnderstanding(q);

      expect(canonical.domain.primary).toBe('academic');
      expect(canonical.intent.primary).toBe('ask_delivery_mode');
      expect(canonical.constraints.requestedField).toBe('deliveryMode');

      const res = await querySemanticRag(q);
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-modality-no-data');
      expect(res.grounded).toBe(false);
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('study-modality-data-gap');
      expect(res.answer).toMatch(/belum tercantum/i);
      expect(res.answer).not.toMatch(/Pedoman\s+Tugas\s+Akhir/i);
      expect(res.answer).not.toMatch(/Daftar\s+Pustaka/i);
      expect(res.answer).not.toMatch(/Renon|Jimbaran|Abiansemal/i);
    });

    test('Query 2: "online/daring menggunakan aplikasi apa?" -> honest learning platform data-gap', async () => {
      const q = 'online/daring menggunakan aplikasi apa?';
      const canonical = buildCanonicalQueryUnderstanding(q);

      expect(canonical.domain.primary).toBe('academic');
      expect(canonical.intent.primary).toBe('ask_learning_platform');

      const res = await querySemanticRag(q);
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-learning-platform-no-data');
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.answer).toMatch(/E-Learning STIKOM Bali/i);
      expect(res.answer).toMatch(/aplikasi.*spesifik.*belum tercantum/i);
    });

    test('Query 3: "kuliahnya online/offline di Bandung?" -> ambiguity clarification, no hardcoded campus denial', async () => {
      const q = 'kuliahnya online/offline di Bandung?';
      const canonical = buildCanonicalQueryUnderstanding(q);

      expect(canonical.domain.primary).toBe('academic');
      expect(canonical.intent.primary).toBe('ask_delivery_mode');
      expect(canonical.ambiguity?.isAmbiguous).toBe(true);

      const res = await querySemanticRag(q);
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-modality-clarification');
      expect(res.grounded).toBe(false);
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('study-modality-ambiguity-clarification');
      expect(res.answer).toMatch(/program studi atau jenjang.*yang Anda maksud/i);
      expect(res.answer).not.toMatch(/tidak memiliki kampus cabang di Bandung/i);
      expect(res.answer).not.toMatch(/Renon|Jimbaran|Abiansemal/i);
    });

    test('Query 4: "perkuliahan S2 SI online/offline?" -> structured data-gap, no executive class hardcode', async () => {
      const q = 'perkuliahan S2 SI online/offline?';
      const canonical = buildCanonicalQueryUnderstanding(q);

      expect(canonical.domain.primary).toBe('academic');
      expect(canonical.intent.primary).toBe('ask_delivery_mode');
      expect(canonical.entities?.programs?.some(p => /S2 Sistem Informasi/i.test(p.canonical))).toBe(true);

      const res = await querySemanticRag(q);
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-modality-no-data');
      expect(res.grounded).toBe(false);
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('study-modality-data-gap');
      expect(res.answer).toMatch(/S2 Sistem Informasi/i);
      expect(res.answer).toMatch(/belum tercantum/i);
      expect(res.answer).not.toMatch(/kelas eksekutif/i);
      expect(res.answer).not.toMatch(/dilaksanakan di kampus Bali/i);
    });

    test('Query 5: "kuliahnya online atau offline di Bandung untuk S2 SI?" -> structured data-gap for S2 SI', async () => {
      const q = 'kuliahnya online atau offline di Bandung untuk S2 SI?';
      const canonical = buildCanonicalQueryUnderstanding(q);

      expect(canonical.domain.primary).toBe('academic');
      expect(canonical.intent.primary).toBe('ask_delivery_mode');
      expect(canonical.entities?.programs?.some(p => /S2 Sistem Informasi/i.test(p.canonical))).toBe(true);

      const res = await querySemanticRag(q);
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-modality-no-data');
      expect(res.grounded).toBe(false);
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('study-modality-data-gap');
      expect(res.answer).toMatch(/S2 Sistem Informasi/i);
      expect(res.answer).toMatch(/belum tercantum/i);
      expect(res.answer).not.toMatch(/tidak memiliki kampus cabang di Bandung/i);
    });

    test('Query 6: "kalau kuliah online bagaimana?" -> generic modality data-gap without campus locations', async () => {
      const q = 'kalau kuliah online bagaimana?';
      const canonical = buildCanonicalQueryUnderstanding(q);

      expect(canonical.domain.primary).toBe('academic');
      expect(canonical.intent.primary).toBe('ask_delivery_mode');

      const res = await querySemanticRag(q);
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-modality-no-data');
      expect(res.grounded).toBe(false);
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('study-modality-data-gap');
      expect(res.answer).toMatch(/belum tercantum/i);
      expect(res.answer).not.toMatch(/Renon|Jimbaran|Abiansemal/i);
    });

    test('Query 7: "Double Degree UTB di Bandung bagaimana?" -> evidence-grounded on UTB dual degree document', async () => {
      const q = 'Double Degree UTB di Bandung bagaimana?';
      const canonical = buildCanonicalQueryUnderstanding(q);

      expect(canonical.domain.primary).toBe('double_degree');
      expect(canonical.entities?.primary?.canonical).toBe('Dual Degree UTB');

      const res = await querySemanticRag(q);
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-dual-degree');
      expect(res.grounded).toBe(true);
      expect(res.evidenceFound).toBe(true);
      expect(res.contexts?.length).toBeGreaterThan(0);
      expect(res.contexts[0].source).toMatch(/PROGRAM_DOUBLE_DEGREE/i);
      expect(res.debug?.routeStage).toBe('pre-guard-structured-extractive-source');
      expect(res.answer).toMatch(/UTB|Universitas Teknologi Bandung|Dual Degree/i);
    });

    test('Query 8: "semester 8 kuliah di Bandung?" -> clarifies ambiguous program scope without leaking fees or UTB', async () => {
      const q = 'semester 8 kuliah di Bandung?';
      const canonical = buildCanonicalQueryUnderstanding(q);

      expect(canonical.ambiguity?.isAmbiguous).toBe(true);
      expect(canonical.constraints?.studyLocation).toBe('Bandung');

      const res = await querySemanticRag(q);
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-modality-clarification');
      expect(res.grounded).toBe(false);
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('study-modality-ambiguity-clarification');
      expect(res.answer).toMatch(/program studi atau jenjang.*yang Anda maksud/i);
      // Ensures no leakage of HELP/DNUI fees or premature UTB claim
      expect(res.answer).not.toMatch(/Biaya Pendidikan Per Semester/i);
      expect(res.answer).not.toMatch(/HELP/i);
    });
  });

  describe('Phase 1.2.1: Semantic Scope vs Answer Authority & Contrastive Pairs', () => {
    test('1. "semester 8 kuliah di Bandung?" -> ambiguous program scope, prompts clarification', async () => {
      const res = await querySemanticRag('semester 8 kuliah di Bandung?');
      expect(res.source).toBe('semantic-rag-modality-clarification');
      expect(res.grounded).toBe(false);
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('study-modality-ambiguity-clarification');
    });

    test('2. "semester 8 Double Degree kuliah di Bandung?" -> explicit Double Degree + Bandung authorizes UTB evidence', async () => {
      const res = await querySemanticRag('semester 8 Double Degree kuliah di Bandung?');
      expect(res.source).toBe('semantic-rag-dual-degree');
      expect(res.answer).toMatch(/UTB|Universitas Teknologi Bandung|Double Degree/i);
    });

    test('3. "semester 8 UTB di Bandung?" -> explicit UTB authorizes UTB evidence', async () => {
      const res = await querySemanticRag('semester 8 UTB di Bandung?');
      expect(res.source).toBe('semantic-rag-dual-degree');
      expect(res.answer).toMatch(/UTB|Universitas Teknologi Bandung/i);
    });

    test('4. "Double Degree UTB semester 8 di Bandung bagaimana?" -> explicit UTB authorizes UTB evidence', async () => {
      const res = await querySemanticRag('Double Degree UTB semester 8 di Bandung bagaimana?');
      expect(res.source).toBe('semantic-rag-dual-degree');
      expect(res.answer).toMatch(/UTB|Universitas Teknologi Bandung/i);
    });

    test('5. S2 SI + semester 8 + Bandung -> "apakah semester 8 kuliah di Bandung untuk S2 SI?" -> scoped to S2 SI, no UTB leakage', async () => {
      const res = await querySemanticRag('apakah semester 8 kuliah di Bandung untuk S2 SI?');
      expect(res.answer).toMatch(/S2.*Sistem Informasi|Magister/i);
      expect(res.answer).not.toMatch(/UTB|Universitas Teknologi Bandung|Dual Degree|HELP/i);
    });

    test('6. standalone Bandung modality query -> "kuliahnya online/offline di Bandung?" -> clarification', async () => {
      const res = await querySemanticRag('kuliahnya online/offline di Bandung?');
      expect(res.source).toBe('semantic-rag-modality-clarification');
      expect(res.grounded).toBe(false);
    });

    test('7. Double Degree context + Bandung follow-up -> UTB context inherits and authorizes UTB evidence', async () => {
      const t1 = await querySemanticRag('Saya tertarik Double Degree UTB');
      const t2 = await querySemanticRag('semester 8 kuliah di Bandung?', {
        conversationState: t1.conversationState
      });
      expect(t2.source).toBe('semantic-rag-dual-degree');
      expect(t2.answer).toMatch(/UTB|Universitas Teknologi Bandung/i);
    });

    test('8. S2 SI context + Bandung follow-up -> S2 SI context does NOT inherit UTB, returns data-gap', async () => {
      const t1 = await querySemanticRag('Saya tertarik S2 SI');
      const t2 = await querySemanticRag('semester 8 kuliah di Bandung?', {
        conversationState: t1.conversationState
      });
      expect(t2.source).toBe('semantic-rag-modality-no-data');
      expect(t2.grounded).toBe(false);
      expect(t2.contexts?.length || 0).toBe(0);
      expect(t2.answer).toMatch(/S2 Sistem Informasi/i);
      expect(t2.answer).toMatch(/belum tercantum/i);
      expect(t2.answer).not.toMatch(/UTB|Universitas Teknologi Bandung/i);
    });

    test('9. no-context query + Bandung -> "semester 8 kuliah di Bandung?" -> clarification without leakage', async () => {
      const res = await querySemanticRag('semester 8 kuliah di Bandung?');
      expect(res.source).toBe('semantic-rag-modality-clarification');
      expect(res.grounded).toBe(false);
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.answer).toMatch(/program studi atau jenjang.*yang Anda maksud/i);
    });
  });

  describe('Section H: Multi-Turn Grounding Invariants', () => {
    test('Case A: Turn 1 (S2 SI) -> Turn 2 (Modality in Bandung) -> S2 SI context preserved, data-gap returned', async () => {
      const t1 = await querySemanticRag('Saya tertarik S2 SI');
      expect(t1.success).toBe(true);

      const t2 = await querySemanticRag('kuliahnya online/offline di Bandung?', {
        conversationState: t1.conversationState
      });
      expect(t2.success).toBe(true);
      expect(t2.source).toBe('semantic-rag-modality-no-data');
      expect(t2.grounded).toBe(false);
      expect(t2.contexts?.length || 0).toBe(0);
      expect(t2.answer).toMatch(/S2 Sistem Informasi/i);
      expect(t2.answer).toMatch(/belum tercantum/i);
      expect(t2.answer).not.toMatch(/kelas eksekutif/i);
    });

    test('Case B: Turn 1 (Double Degree UTB) -> Turn 2 (Modality in Bandung) -> UTB context preserved, evidence-grounded', async () => {
      const t1 = await querySemanticRag('Saya tertarik Double Degree UTB');
      expect(t1.success).toBe(true);

      const t2 = await querySemanticRag('kuliahnya online/offline di Bandung?', {
        conversationState: t1.conversationState
      });
      expect(t2.success).toBe(true);
      expect(t2.source).toBe('semantic-rag-dual-degree');
      expect(t2.answer).toMatch(/UTB|Dual Degree/i);
    });
  });

  describe('Section I: Yudisium Negative Control (Must remain 100% evidence-first)', () => {
    const yudisiumQueries = [
      'Kapan yudisium?',
      'Kapan batas pendaftaran yudisium?',
      'Jadwal yudisium'
    ];

    for (const q of yudisiumQueries) {
      test(`Yudisium query "${q}" remains evidence-first without hardcode regression`, async () => {
        const res = await querySemanticRag(q);
        expect(res.success).toBe(true);
        expect(res.source).toBe('semantic-rag-academic-schedule');
        expect(res.contexts?.length).toBeGreaterThan(0);
        expect(res.grounded !== false).toBe(true);
        expect(res.answer).toMatch(/yudisium/i);
      });
    }
  });

  describe('Section J: Phase 1.2.2 Clarification Authority Hardening Invariants', () => {
    test('1. "semester 8 kuliah di Bandung?" -> ambiguity / unresolved program scope, no unsupported business facts injected', async () => {
      const q = 'semester 8 kuliah di Bandung?';
      const canonical = buildCanonicalQueryUnderstanding(q);

      expect(canonical.ambiguity?.isAmbiguous).toBe(true);
      expect(canonical.constraints?.studyLocation).toBe('Bandung');

      const res = await querySemanticRag(q);
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-modality-clarification');
      expect(res.grounded).toBe(false);
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('study-modality-ambiguity-clarification');

      // Generic clarification assertions
      expect(res.answer).toMatch(/belum memuat program studi atau jenjang yang spesifik/i);
      expect(res.answer).toMatch(/Bandung/i);

      // Strict negative assertions against injecting unsupported business facts
      expect(res.answer).not.toMatch(/UTB|Universitas Teknologi Bandung/i);
      expect(res.answer).not.toMatch(/Double\s*Degree|Dual\s*Degree/i);
      expect(res.answer).not.toMatch(/mitra\s*kampus/i);
      expect(res.answer).not.toMatch(/kampus\s*cabang/i);
      expect(res.answer).not.toMatch(/2\s*bulan|dua\s*bulan/i);
      expect(res.answer).not.toMatch(/Renon|Jimbaran|Abiansemal/i);
      expect(res.answer).not.toMatch(/kelas\s*eksekutif/i);
      expect(res.answer).not.toMatch(/Biaya\s*Pendidikan/i);
    });

    test('2. Standalone "kuliahnya online/offline di Bandung?" -> generic clarification without specific program facts', async () => {
      const q = 'kuliahnya online/offline di Bandung?';
      const res = await querySemanticRag(q);

      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-modality-clarification');
      expect(res.grounded).toBe(false);
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('study-modality-ambiguity-clarification');

      // Generic clarification assertions
      expect(res.answer).toMatch(/belum memuat program studi atau jenjang yang spesifik/i);

      // Strict negative assertions
      expect(res.answer).not.toMatch(/UTB|Universitas Teknologi Bandung/i);
      expect(res.answer).not.toMatch(/Double\s*Degree|Dual\s*Degree/i);
      expect(res.answer).not.toMatch(/mitra\s*kampus/i);
      expect(res.answer).not.toMatch(/kampus\s*cabang/i);
      expect(res.answer).not.toMatch(/tidak\s*memiliki\s*kampus\s*di\s*Bandung/i);
    });

    test('3. UTB context: Turn 1 "Saya tertarik Double Degree UTB" -> Turn 2 "semester 8 kuliah di Bandung?" inherits UTB and is evidence-grounded', async () => {
      const t1 = await querySemanticRag('Saya tertarik Double Degree UTB');
      expect(t1.success).toBe(true);

      const t2 = await querySemanticRag('semester 8 kuliah di Bandung?', {
        conversationState: t1.conversationState
      });

      expect(t2.success).toBe(true);
      expect(t2.source).toBe('semantic-rag-dual-degree');
      expect(t2.grounded).toBe(true);
      expect(t2.evidenceFound).toBe(true);
      expect(t2.contexts?.length).toBeGreaterThan(0);
      expect(t2.contexts[0].source).toMatch(/PROGRAM_DOUBLE_DEGREE/i);
      expect(t2.answer).toMatch(/UTB|Universitas Teknologi Bandung/i);
      expect(t2.answer).toMatch(/semester delapan|2 bulan|Bandung/i);
    });

    test('4. S2 context: Turn 1 "Saya tertarik S2 SI" -> Turn 2 "semester 8 kuliah di Bandung?" preserves S2 scope, no UTB leakage, data-gap', async () => {
      const t1 = await querySemanticRag('Saya tertarik S2 SI');
      expect(t1.success).toBe(true);

      const t2 = await querySemanticRag('semester 8 kuliah di Bandung?', {
        conversationState: t1.conversationState
      });

      expect(t2.success).toBe(true);
      expect(t2.source).toBe('semantic-rag-modality-no-data');
      expect(t2.grounded).toBe(false);
      expect(t2.contexts?.length || 0).toBe(0);
      expect(t2.debug?.routeStage).toBe('study-modality-data-gap');

      // Scope preserved
      expect(t2.answer).toMatch(/S2 Sistem Informasi/i);
      expect(t2.answer).toMatch(/belum tercantum/i);

      // Strict negative assertions against UTB / Double Degree leakage
      expect(t2.answer).not.toMatch(/UTB|Universitas Teknologi Bandung/i);
      expect(t2.answer).not.toMatch(/Double\s*Degree|Dual\s*Degree/i);
      expect(t2.answer).not.toMatch(/2\s*bulan/i);
    });
  });

  describe('Phase 1.2.4: Double Degree Evidence-First Precedence & Procedural Disambiguation', () => {
    test('Query A: "Double Degree UTB di Bandung bagaimana?" -> evidence-first route, grounded true', async () => {
      const res = await querySemanticRag('Double Degree UTB di Bandung bagaimana?');
      expect(res.source).toBe('semantic-rag-dual-degree');
      expect(res.grounded).toBe(true);
      expect(res.evidenceFound).toBe(true);
      expect(res.contexts?.length).toBeGreaterThan(0);
      expect(res.contexts[0].source).toMatch(/PROGRAM_DOUBLE_DEGREE/i);
      expect(res.debug?.routeStage).toBe('pre-guard-structured-extractive-source');
      expect(res.answer).toMatch(/Universitas Teknologi Bandung|UTB/i);
    });

    test('Query B: "Double Degree UTB semester 8 di Bandung bagaimana?" -> evidence-first route, grounded true', async () => {
      const res = await querySemanticRag('Double Degree UTB semester 8 di Bandung bagaimana?');
      expect(res.source).toBe('semantic-rag-dual-degree');
      expect(res.grounded).toBe(true);
      expect(res.evidenceFound).toBe(true);
      expect(res.contexts?.length).toBeGreaterThan(0);
      expect(res.contexts[0].source).toMatch(/PROGRAM_DOUBLE_DEGREE/i);
      expect(res.debug?.routeStage).toBe('pre-guard-structured-extractive-source');
    });

    test('Query C: "kuliah di Bandung untuk Double Degree bagaimana?" -> evidence-first route, grounded true', async () => {
      const res = await querySemanticRag('kuliah di Bandung untuk Double Degree bagaimana?');
      expect(res.source).toBe('semantic-rag-dual-degree');
      expect(res.grounded).toBe(true);
      expect(res.evidenceFound).toBe(true);
      expect(res.contexts?.length).toBeGreaterThan(0);
      expect(res.contexts[0].source).toMatch(/PROGRAM_DOUBLE_DEGREE/i);
      expect(res.debug?.routeStage).toBe('pre-guard-structured-extractive-source');
    });

    test('Query D: "semester 8 Double Degree kuliah di Bandung?" -> evidence-first route, grounded true', async () => {
      const res = await querySemanticRag('semester 8 Double Degree kuliah di Bandung?');
      expect(res.source).toBe('semantic-rag-dual-degree');
      expect(res.grounded).toBe(true);
      expect(res.evidenceFound).toBe(true);
      expect(res.contexts?.length).toBeGreaterThan(0);
      expect(res.contexts[0].source).toMatch(/PROGRAM_DOUBLE_DEGREE/i);
      expect(res.debug?.routeStage).toBe('pre-guard-structured-extractive-source');
    });

    test('Query E: "bagaimana cara daftar Double Degree UTB?" -> procedural route, contextsCount 0', async () => {
      const res = await querySemanticRag('bagaimana cara daftar Double Degree UTB?');
      expect(res.source).toBe('semantic-rag-dual-degree');
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('pre-guard-canonical-double-degree-procedure-before-unsupported-partner');
      expect(res.answer).toMatch(/PMB|mendaftar|pendaftaran/i);
    });

    test('Query F: "Double Degree UTB bagaimana cara pendaftarannya?" -> procedural route, contextsCount 0', async () => {
      const res = await querySemanticRag('Double Degree UTB bagaimana cara pendaftarannya?');
      expect(res.source).toBe('semantic-rag-dual-degree');
      expect(res.contexts?.length || 0).toBe(0);
      expect(res.debug?.routeStage).toBe('pre-guard-canonical-double-degree-procedure-before-unsupported-partner');
      expect(res.answer).toMatch(/PMB|mendaftar|pendaftaran/i);
    });

    test('Multi-Turn Case 1: T1 "Saya tertarik Double Degree UTB" -> T2 "semester 8 kuliah di Bandung?" -> grounded true', async () => {
      const t1 = await querySemanticRag('Saya tertarik Double Degree UTB');
      const session = {
        messages: [
          { direction: 'incoming', message: 'Saya tertarik Double Degree UTB' },
          { direction: 'outgoing', message: t1.answer }
        ],
        state: t1.conversationState || { activeDomain: 'double_degree', activeEntity: { canonical: 'Dual Degree UTB', type: 'international_program' } },
        conversationState: t1.conversationState || { activeDomain: 'double_degree', activeEntity: { canonical: 'Dual Degree UTB', type: 'international_program' } }
      };
      const t2 = await querySemanticRag('semester 8 kuliah di Bandung?', { sessionData: session });
      expect(t2.source).toBe('semantic-rag-dual-degree');
      expect(t2.grounded).toBe(true);
      expect(t2.evidenceFound).toBe(true);
      expect(t2.contexts?.length).toBeGreaterThan(0);
      expect(t2.contexts[0].source).toMatch(/PROGRAM_DOUBLE_DEGREE/i);
      expect(t2.debug?.routeStage).toBe('pre-guard-structured-extractive-source');
    });

    test('Multi-Turn Case 2: T1 "Saya tertarik Double Degree UTB" -> T2 "bagaimana cara daftarnya?" -> procedural route', async () => {
      const t1 = await querySemanticRag('Saya tertarik Double Degree UTB');
      const session = {
        messages: [
          { direction: 'incoming', message: 'Saya tertarik Double Degree UTB' },
          { direction: 'outgoing', message: t1.answer }
        ],
        state: t1.conversationState || { activeDomain: 'double_degree', activeEntity: { canonical: 'Dual Degree UTB', type: 'international_program' } },
        conversationState: t1.conversationState || { activeDomain: 'double_degree', activeEntity: { canonical: 'Dual Degree UTB', type: 'international_program' } }
      };
      const t2 = await querySemanticRag('bagaimana cara daftarnya?', { sessionData: session });
      expect(t2.source).toBe('semantic-rag-dual-degree');
      expect(t2.contexts?.length || 0).toBe(0);
      expect(t2.debug?.routeStage).toBe('pre-guard-canonical-double-degree-procedure-before-unsupported-partner');
      expect(t2.answer).toMatch(/PMB|mendaftar|pendaftaran/i);
    });

    test('Multi-Turn Case 3: T1 "Saya tertarik S2 SI" -> T2 "semester 8 kuliah di Bandung?" -> scope preserved, no UTB', async () => {
      const t1 = await querySemanticRag('Saya tertarik S2 SI');
      const session = {
        messages: [
          { direction: 'incoming', message: 'Saya tertarik S2 SI' },
          { direction: 'outgoing', message: t1.answer }
        ],
        state: t1.conversationState || { activeDomain: 'academic_program', activeEntity: { canonical: 'S2 Sistem Informasi', type: 'program' } },
        conversationState: t1.conversationState || { activeDomain: 'academic_program', activeEntity: { canonical: 'S2 Sistem Informasi', type: 'program' } }
      };
      const t2 = await querySemanticRag('semester 8 kuliah di Bandung?', { sessionData: session });
      expect(t2.answer).not.toMatch(/UTB|Universitas Teknologi Bandung/i);
      expect(t2.answer).not.toMatch(/Double\s*Degree|Dual\s*Degree/i);
    });
  });
});
