'use strict';

/**
 * Tracked Regression Tests: Continuous Session, Context Authority, and Multi-Entity Scoping
 *
 * Covers requirements A through K:
 *   A. Long continuous single-session topic switching
 *   B. Current-explicit career overrides stale fee
 *   C. Current-explicit career overrides stale double_degree
 *   D. Compatible career intent inheritance (SI career -> "kalau TI?")
 *   E. Requested entity set scoping (explicit E1+E2 must not emit sibling E3)
 *   F. Overview queries ("semua partner") emit all supported entities
 *   G. Generic "program" does not imply program studi (type-neutral boundary)
 *   H. Multi-entity same-field: all supported
 *   I. Multi-entity same-field: mixed supported and unsupported
 *   J. Outbound formatter preserves every requested entity binding
 *   K. TI career outcome retrieves official job roles without verifier rejection
 */

const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { buildTurnConversationState } = require('../src/engine/conversationStateEngine');
const { resolveContextAuthority } = require('../src/engine/contextAuthority');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
const { buildWhatsappConversationalReply } = require('../src/utils/whatsappFormatter');

describe('Continuous Session, Context Authority & Multi-Entity Scoping', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  // -------------------------------------------------------------------------
  // A. Long continuous single-session topic switching
  // -------------------------------------------------------------------------
  describe('A. Long continuous single-session topic switching', () => {
    test('CSR-A01: sequences through PMB -> generic external -> double degree -> fee -> career BD -> career SI -> entity switch TI in one session', async () => {
      let sessionState = null;
      const history = [];

      const step = async (query) => {
        const res = await querySemanticRag(query, {
          sessionData: {
            state: sessionState,
            messages: history
          }
        });
        expect(res.success).toBe(true);

        sessionState = buildTurnConversationState(sessionState, {
          userQuery: query,
          result: res,
          source: res.source,
          debug: res.debug || {}
        });

        history.push({ direction: 'user', message: query });
        history.push({ direction: 'bot', message: res.answer });
        return res;
      };

      // 1. PMB / Schedule
      const r1 = await step('Penerimaan Mahasiswa Baru sekarang sudah masuk gelombang ke berapa?');
      expect(r1.answer).toMatch(/gelombang|PMB|pendaftaran/i);

      // 2. Generic external program (must NOT be treated as prodi)
      const r2 = await step('Iya boleh saya dapat info tentang program LinkedIn Learning Stikom Bali ya?');
      expect(r2.answer).not.toMatch(/tidak memiliki program studi linkedin/i);
      expect(r2.answer).toMatch(/LinkedIn Learning/i);

      // 3. Double Degree unsupported partner
      const r3 = await step('Kalau program kerja double degree dengan Essex University UK apakah ada informasi ya?');
      expect(r3.answer).toMatch(/Essex University/i);
      expect(r3.answer).toMatch(/belum menemukan data/i);

      // 4. Double Degree partner inquiry
      const r4 = await step('Kalau Double Degree dengan UTB itu seperti apa ya?');
      expect(r4.answer).toMatch(/UTB/i);

      // 5. Fee inquiry (establishes fee domain)
      const r5 = await step('Kalau untuk biaya, double degree itu biayanya berapa ya?');
      expect(r5.answer).toMatch(/biaya/i);
      expect(sessionState.activeDomain).toBe('fee');

      // 6. Explicit career outcome for Bisnis Digital (MUST override stale fee domain)
      const r6 = await step('Kalau saya mengambil jurusan Bisnis Digital, itu nanti perkiraannya saya bisa bekerja menjadi apa?');
      expect(r6.answer).toMatch(/Bisnis Digital/i);
      expect(r6.answer).toMatch(/digital marketing|e-commerce|bisnis/i);
      expect(sessionState.activeDomain).toBe('career');

      // 7. Explicit career outcome for Sistem Informasi
      const r7 = await step('Kalau jurusan sistem informasi, nanti tamatnya bisa bekerja menjadi apa ya?');
      expect(r7.answer).toMatch(/Sistem Informasi/i);
      expect(r7.answer).toMatch(/analyst|sistem|data|prospek/i);
      expect(sessionState.activeDomain).toBe('career');

      // 8. Compatible follow-up entity switch to TI (MUST keep career intent)
      const r8 = await step('Kalau jurusan Teknologi Informasi?');
      expect(r8.answer).toMatch(/Teknologi Informasi/i);
      expect(r8.answer).toMatch(/software|developer|cloud|jaringan|cyber/i);
      expect(sessionState.activeDomain).toBe('career');
    }, 45000);
  });

  // -------------------------------------------------------------------------
  // B. Current-explicit career overrides stale fee
  // -------------------------------------------------------------------------
  describe('B. Current-explicit career overrides stale fee', () => {
    test('CSR-B01: explicit career query completely overrides active fee domain', () => {
      const priorState = {
        updatedAt: new Date().toISOString(),
        isVerified: true,
        promotable: true,
        activeDomain: 'fee',
        activeIntent: 'ask_fee_detail',
        activeEntity: { canonical: 'Bisnis Digital', type: 'program' }
      };

      const query = 'Kalau saya mengambil jurusan Bisnis Digital, nanti setelah lulus bekerja sebagai apa?';
      const understanding = buildCanonicalQueryUnderstanding(query);

      expect(understanding.domain.primary).toBe('career');
      expect(understanding.intent.primary).toBe('ask_career_prospect');

      const authority = resolveContextAuthority({ rawQuery: query, understanding }, priorState);

      expect(authority.resolvedDomain).toBe('career');
      expect(authority.resolvedIntent).toBe('ask_career_prospect');
      expect(authority.transition).not.toBe('INHERIT');
    });
  });

  // -------------------------------------------------------------------------
  // C. Current-explicit career overrides stale double_degree
  // -------------------------------------------------------------------------
  describe('C. Current-explicit career overrides stale double_degree', () => {
    test('CSR-C01: explicit career query completely overrides active double_degree domain', () => {
      const priorState = {
        updatedAt: new Date().toISOString(),
        isVerified: true,
        promotable: true,
        activeDomain: 'double_degree',
        activeIntent: 'ask_double_degree_info',
        activeEntity: { canonical: 'Dual Degree UTB', type: 'international_program' }
      };

      const query = 'Prospek kerja untuk lulusan Sistem Informasi apa saja?';
      const understanding = buildCanonicalQueryUnderstanding(query);

      expect(understanding.domain.primary).toBe('career');

      const authority = resolveContextAuthority({ rawQuery: query, understanding }, priorState);

      expect(authority.resolvedDomain).toBe('career');
      expect(authority.resolvedIntent).toBe('ask_career_prospect');
      expect(authority.transition).not.toBe('INHERIT');
    });
  });

  // -------------------------------------------------------------------------
  // D. Compatible career intent inheritance: SI career -> "kalau TI?"
  // -------------------------------------------------------------------------
  describe('D. Compatible career intent inheritance', () => {
    test('CSR-D01: short entity switch inherits active career intent from previous turn', () => {
      const priorState = {
        updatedAt: new Date().toISOString(),
        isVerified: true,
        promotable: true,
        activeDomain: 'career',
        activeIntent: 'ask_career_prospect',
        activeEntity: { canonical: 'S1 Sistem Informasi', type: 'program' },
        requestedFields: ['careerOutcome', 'jobRole']
      };

      const query = 'Kalau jurusan Teknologi Informasi?';
      const understanding = buildCanonicalQueryUnderstanding(query);

      const authority = resolveContextAuthority({ rawQuery: query, understanding }, priorState);

      // Intent should inherit compatible career intent
      expect(authority.resolvedDomain).toBe('career');
      expect(authority.resolvedIntent).toBe('ask_career_prospect');
      expect(authority.transition).toBe('ENTITY_REPLACEMENT');
      // Entity must switch to TI
      expect(authority.resolvedEntity.canonical).toMatch(/Teknologi Informasi/i);
    });
  });

  // -------------------------------------------------------------------------
  // E. Requested entity set: explicit E1+E2 must not emit sibling E3
  // -------------------------------------------------------------------------
  describe('E. Requested entity set scoping', () => {
    test('CSR-E01: query naming DNUI and HELP returns only DNUI and HELP, no UTB leak', async () => {
      const result = await querySemanticRag('Memang kalau Double Degree DNUI dan HELP seperti apa ya?');
      expect(result.success).toBe(true);

      // Must cover DNUI and HELP
      expect(result.answer).toMatch(/DNUI/i);
      expect(result.answer).toMatch(/HELP/i);

      // Must NOT leak UTB
      expect(result.answer).not.toMatch(/\bUTB\b/);
      expect(result.answer).not.toMatch(/Universiti Teknikal Malaysia Melaka/i);
    }, 15000);
  });

  // -------------------------------------------------------------------------
  // F. Overview: "semua partner" should still emit all supported entities
  // -------------------------------------------------------------------------
  describe('F. Overview all supported entities', () => {
    test('CSR-F01: generic overview signal returns all supported partners', async () => {
      const result = await querySemanticRag('Program double degree dengan semua partner apa saja ya?');
      expect(result.success).toBe(true);

      // All supported partners should be represented
      expect(result.answer).toMatch(/UTB/i);
      expect(result.answer).toMatch(/DNUI/i);
      expect(result.answer).toMatch(/HELP/i);
    }, 15000);
  });

  // -------------------------------------------------------------------------
  // G. Generic program does not imply program studi
  // -------------------------------------------------------------------------
  describe('G. Generic program does not imply program studi', () => {
    test('CSR-G01: generic program query outputs official evidence or type-neutral boundary, never "tidak memiliki program studi"', async () => {
      const result = await querySemanticRag('Iya boleh saya dapat info tentang program LinkedIn Learning Stikom Bali ya?');
      expect(result.success).toBe(true);

      expect(result.answer).not.toMatch(/tidak memiliki program studi/i);
      expect(result.answer).toMatch(/LinkedIn Learning/i);
      expect(result.answer).toMatch(/Alumni|200\.000|Career|CDC/i);
    }, 15000);
  });

  // -------------------------------------------------------------------------
  // H. Multi-entity same-field all supported
  // -------------------------------------------------------------------------
  describe('H. Multi-entity same-field all supported', () => {
    test('CSR-H01: query asking degree for both programs or partners answers both', async () => {
      const result = await querySemanticRag('Gelar yang didapatkan dari double degree UTB dan HELP apa saja?');
      expect(result.success).toBe(true);

      // Both UTB and HELP have official degree evidence
      expect(result.answer).toMatch(/UTB/i);
      expect(result.answer).toMatch(/HELP/i);
      expect(result.answer).toMatch(/S\.Kom|Bachelor/i);
    }, 15000);
  });

  // -------------------------------------------------------------------------
  // I. Multi-entity same-field: DNUI and HELP degree both supported
  // -------------------------------------------------------------------------
  describe('I. Multi-entity same-field both supported', () => {
    test('CSR-I01: HELP degree and DNUI degree both answered with official evidence', async () => {
      const result = await querySemanticRag('Gelar yang didapatkan dari DNUI dan HELP itu Sarjana apa?');
      expect(result.success).toBe(true);

      // Supported HELP degree must be present
      expect(result.answer).toMatch(/HELP University/i);
      expect(result.answer).toMatch(/Sarjana Komputer|S\.Kom/i);
      expect(result.answer).toMatch(/Bachelor of Information Technology|BIT/i);

      // Supported DNUI degree must be present
      expect(result.answer).toMatch(/DNUI|Dalian/i);
      expect(result.answer).toMatch(/Sarjana Bisnis|S\.Bns/i);
      expect(result.answer).toMatch(/Bachelor of Management|B\.M/i);
    }, 15000);
  });

  // -------------------------------------------------------------------------
  // J. Outbound formatter preserves every requested entity binding
  // -------------------------------------------------------------------------
  describe('J. Outbound formatter preserves every requested entity binding', () => {
    test('CSR-J01: formatter preserves both supported and bounded entities', () => {
      const rawText = [
        'Pada Program Double Degree dengan HELP University Malaysia, lulusan memperoleh dua gelar:',
        '- Sarjana Komputer (S.Kom) dari ITB STIKOM Bali',
        '- Bachelor of Information Technology (BIT) dari HELP University Malaysia.',
        '',
        'Untuk Double Degree DNUI: informasi gelar belum tersedia dalam basis data resmi. Kakak bisa konfirmasi ke admin PMB.'
      ].join('\n');

      const formatted = buildWhatsappConversationalReply({
        rawMainAnswer: rawText,
        userQuery: 'Gelar yang didapatkan dari DNUI dan HELP itu Sarjana apa?'
      });

      expect(formatted).toMatch(/HELP University/i);
      expect(formatted).toMatch(/S\.Kom|Bachelor/i);
      expect(formatted).toMatch(/DNUI/i);
      expect(formatted).toMatch(/belum tersedia|konfirmasi/i);
    });
  });

  // -------------------------------------------------------------------------
  // K. TI career outcome: official job-role evidence emitted
  // -------------------------------------------------------------------------
  describe('K. TI career outcome official evidence', () => {
    test('CSR-K01: explicit TI career outcome query retrieves official TI job-role evidence', async () => {
      const result = await querySemanticRag('Kalau jurusan Teknologi Informasi, nanti setelah tamat bisa bekerja sebagai apa?');
      expect(result.success).toBe(true);

      expect(result.answer).toMatch(/Teknologi Informasi/i);
      expect(result.answer).toMatch(/software engineer|web developer|mobile developer|devops|cloud|network|cybersecurity|QA/i);
      expect(result.source).toMatch(/semantic-rag-career/i);
    }, 15000);
  });
});
