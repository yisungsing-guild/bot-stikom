'use strict';

/**
 * Phase 2 Organic WhatsApp UAT Remediation Tests
 *
 * Covers:
 * - P0-1: Graduation SKS vs Thesis-Entry SKS slot differentiation
 * - P0-2: SEO curriculum topic presence in S1 Bisnis Digital
 * - P0-3: Generic temporal authority for current operational status
 * - P1-1: DKV relationship and availability resolution vs definition
 * - P1-2: LinkedIn Learning wording robustness across paraphrases
 * - P1-3: Multi-turn fee context carry-over for elliptical queries
 * - P1-4: Safe data gap for Bisnis Digital faculty inquiry
 */

const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { buildTurnConversationState } = require('../src/engine/conversationStateEngine');

jest.setTimeout(120000);

describe('Phase 2 Organic WhatsApp UAT Remediation', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  // -------------------------------------------------------------------------
  // P0-1: Graduation SKS vs Thesis-Entry SKS
  // -------------------------------------------------------------------------
  describe('P0-1: Graduation SKS vs Thesis-Entry SKS', () => {
    test('distinguishes total graduation SKS from 110 SKS thesis-entry requirement without hardcoding 144 SKS', async () => {
      const res = await querySemanticRag('Berapa sks yang harus di tempuh untuk dapat lulus program S1?');
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-academic-credit-no-data');

      // Must NOT assert that 110 SKS is the graduation requirement
      expect(res.answer).not.toMatch(/minimal 110 SKS untuk (?:dapat )?lulus/i);
      // Must NOT hardcode 144 SKS
      expect(res.answer).not.toMatch(/total beban studi S1 adalah 144 SKS/i);

      // Must clearly differentiate slots: graduation SKS vs thesis entry (110 SKS)
      expect(res.answer).toMatch(/total SKS kelulusan/i);
      expect(res.answer).toMatch(/110 SKS/i);
      expect(res.answer).toMatch(/Tugas Akhir/i);
      expect(res.answer).toMatch(/BAAK|Bagian Akademik/i);
    });
  });

  // -------------------------------------------------------------------------
  // P0-2: SEO Curriculum Presence
  // -------------------------------------------------------------------------
  describe('P0-2: SEO Curriculum Topic Presence', () => {
    test('routes SEO inquiry to Bisnis Digital curriculum rather than falling back to Sistem Informasi', async () => {
      const res = await querySemanticRag('Apakah mahasiswa belajar SEO?');
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-program-curriculum');

      // Must reference S1 Bisnis Digital and Digital Marketing
      expect(res.answer).toMatch(/Bisnis Digital/i);
      expect(res.answer).toMatch(/SEO|Search Engine Optimization/i);
      expect(res.answer).toMatch(/Digital Marketing/i);

      // Must NOT fall back to general Sistem Informasi profile
      expect(res.answer).not.toMatch(/Sistem Informasi adalah/i);
    });
  });

  // -------------------------------------------------------------------------
  // P0-3: Generic Temporal Authority
  // -------------------------------------------------------------------------
  describe('P0-3: Generic Temporal Authority', () => {
    test('explains historical document recording vs lack of current operational status for Hi-Think', async () => {
      const res = await querySemanticRag('Saya dengar program hi-think sudah tidak dijalankan, kenapa masih bisa dijelaskan?');
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-temporal-authority');

      // Explains historical documents exist in database
      expect(res.answer).toMatch(/arsip|dokumen|catatan historis/i);
      // Explains historical documents do not prove current active operation
      expect(res.answer).toMatch(/status operasional|belum memuat pembaruan|tidak dapat dijadikan bukti bahwa program masih aktif/i);
      expect(res.answer).toMatch(/konfirmasi langsung|Career Center|pihak kampus/i);
    });

    test('handles general program operational status inquiry safely', async () => {
      const res = await querySemanticRag('Apakah program masih berjalan?');
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-temporal-authority');

      expect(res.answer).toMatch(/sebutkan nama program/i);
      expect(res.answer).toMatch(/status operasional|status keaktifan/i);
    });
  });

  // -------------------------------------------------------------------------
  // P1-1: DKV Relationship vs Definition
  // -------------------------------------------------------------------------
  describe('P1-1: DKV Relationship vs Definition', () => {
    test('resolves DKV program availability with official prodis and related visual design contexts', async () => {
      const res = await querySemanticRag('Untuk perkuliahan, program studi yang mempelajari DKV ada ya?');
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-program-availability-dkv');

      // Must state no standalone DKV prodi
      expect(res.answer).toMatch(/tidak ada program studi mandiri bernama DKV/i);
      // Must list official prodis
      expect(res.answer).toMatch(/Sistem Informasi/i);
      expect(res.answer).toMatch(/Teknologi Informasi/i);
      expect(res.answer).toMatch(/Bisnis Digital/i);
      // Must mention where visual design is studied and Dual Degree UTB
      expect(res.answer).toMatch(/Dual Degree/i);
      expect(res.answer).toMatch(/UTB/i);
    });

    test('resolves prodi related to DKV query identically', async () => {
      const res = await querySemanticRag('Program studi apa di STIKOM Bali yang terkait dengan DKV?');
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-program-availability-dkv');
      expect(res.answer).toMatch(/tidak ada program studi mandiri bernama DKV/i);
      expect(res.answer).toMatch(/Bisnis Digital/i);
    });

    test('preserves WHAT_IS_DKV definition for pure definition query', async () => {
      const res = await querySemanticRag('Apa itu DKV?');
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-program-definition');
      expect(res.answer).toMatch(/Desain Komunikasi Visual/i);
      expect(res.answer).toMatch(/seni visual|komunikasi pesan/i);
    });
  });

  // -------------------------------------------------------------------------
  // P1-2: LinkedIn Learning Wording Robustness
  // -------------------------------------------------------------------------
  describe('P1-2: LinkedIn Learning Wording Robustness', () => {
    test('handles "Kalau program LinkedIn Learning di stikom bali itu, program apa ya?" without preflight leak block', async () => {
      const res = await querySemanticRag('Kalau program LinkedIn Learning di stikom bali itu, program apa ya?');
      expect(res.success).toBe(true);
      expect(['semantic-rag-campus-facility', 'semantic-rag-contract-verifier-blocked']).toContain(res.source);
      expect(res.answer).toMatch(/LinkedIn Learning|belum menemukan data/i);
      expect(res.answer).toMatch(/Career Development Center|CDC|Career Center|belum menemukan data/i);
    });

    test('handles "Bisa jelaskan program linkedin learning di stikom bali?" without preflight leak block', async () => {
      const res = await querySemanticRag('Bisa jelaskan program linkedin learning di stikom bali?');
      expect(res.success).toBe(true);
      expect(['semantic-rag-campus-facility', 'semantic-rag-contract-verifier-blocked']).toContain(res.source);
      expect(res.answer).toMatch(/LinkedIn Learning|belum menemukan data/i);
      expect(res.answer).toMatch(/Career Development Center|CDC|Career Center|belum menemukan data/i);
    });
  });

  // -------------------------------------------------------------------------
  // P1-3: Multi-turn Fee Context Carryover
  // -------------------------------------------------------------------------
  describe('P1-3: Multi-turn Fee Context Carryover', () => {
    test('carries fee context from "Berapa biaya SI?" to "Kalau Bisnis Digital?"', async () => {
      let sessionState = null;
      const history = [];

      const step = async (q) => {
        const res = await querySemanticRag(q, {
          sessionData: { state: sessionState, messages: history }
        });
        sessionState = buildTurnConversationState(sessionState, {
          userQuery: q,
          result: res,
          source: res.source,
          debug: res.debug || {}
        });
        history.push({ direction: 'user', message: q });
        history.push({ direction: 'bot', message: res.answer });
        return res;
      };

      const r1 = await step('Berapa biaya SI?');
      expect(r1.success).toBe(true);
      expect(r1.source).toBe('semantic-rag-fee-detail');

      const r2 = await step('Kalau Bisnis Digital?');
      expect(r2.success).toBe(true);
      expect(r2.source).toBe('semantic-rag-fee-detail');
      expect(r2.answer).toMatch(/biaya/i);
      expect(r2.answer).toMatch(/Bisnis Digital/i);
    });

    test('carries fee context from "Berapa biaya Manajemen Informatika?" to elliptical "Kalau BD?"', async () => {
      let sessionState = null;
      const history = [];

      const step = async (q) => {
        const res = await querySemanticRag(q, {
          sessionData: { state: sessionState, messages: history }
        });
        sessionState = buildTurnConversationState(sessionState, {
          userQuery: q,
          result: res,
          source: res.source,
          debug: res.debug || {}
        });
        history.push({ direction: 'user', message: q });
        history.push({ direction: 'bot', message: res.answer });
        return res;
      };

      const r1 = await step('Berapa biaya Manajemen Informatika?');
      expect(r1.success).toBe(true);
      expect(r1.source).toBe('semantic-rag-fee-detail');

      const r2 = await step('Kalau BD?');
      expect(r2.success).toBe(true);
      expect(r2.source).toBe('semantic-rag-fee-detail');
      expect(r2.answer).toMatch(/biaya/i);
      expect(r2.answer).toMatch(/Bisnis Digital/i);
    });
  });

  // -------------------------------------------------------------------------
  // P1-4: Bisnis Digital Faculty Safe Data Gap
  // -------------------------------------------------------------------------
  describe('P1-4: Bisnis Digital Faculty Safe Data Gap', () => {
    test('returns grounded safe data gap when faculty information is not in official corpus', async () => {
      const res = await querySemanticRag('Program studi Bisnis Digital ada di fakultas apa?');
      expect(res.success).toBe(true);
      expect(res.source).toBe('semantic-rag-academic-no-data');
      expect(res.answer).toMatch(/belum menemukan informasi fakultas/i);
      expect(res.answer).toMatch(/bagian akademik|admin kampus/i);
    });
  });
});
