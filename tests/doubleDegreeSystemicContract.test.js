'use strict';

/**
 * tests/doubleDegreeSystemicContract.test.js
 *
 * Systemic Regression Test Suite for Double Degree Programs:
 * Covers:
 * 1. Category/Umbrella Resolution ("Apa ada program double degree?")
 * 2. National Dual Degree Specifics ("Apakah ada program double degree nasional?")
 * 3. Conversational Context & Contact Inquiry ("Apakah ada kontaknya?")
 * 4. Procedural & Admission Follow-up ("Bagaimana cara mendaftar?")
 * 5. International Leaf Specifics (HELP University Malaysia & DNUI China)
 * 6. Partner Major Clarification ("Apakah ITB STIKOM Bali punya prodi DKV?")
 * 7. Unsupported/Fabrication Resistance (Honest responses for out-of-bounds queries)
 *
 * Checks ACTUAL CONTENT: claims, degrees, partner relations, contact info, and honesty.
 */

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;
delete process.env.ALLOW_LIVE_OPENAI_TESTS;
delete process.env.MODEL_SEMANTIC_REAL_TEST;

const { processTurn } = require('../src/core/orchestrator');
const { getSession, resetSession } = require('../src/core/conversationState');
const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { evaluateContextDependency } = require('../src/core/contextResolver');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
const { detectQueryLanguage } = require('../src/utils/languageDetector');
const { sanitizeOutboundWhatsappText } = require('../src/utils/whatsappFormatter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');

describe('Systemic Double Degree Architecture & Conversational Integrity', () => {
  jest.setTimeout(30000);

  describe('1. Category / Umbrella Resolution: Generic Double Degree Inquiry', () => {
    test('1a: "Apa ada program double degree?" resolves to International Dual Degree without excluding its members', () => {
      const frame = resolveSemanticFrame('Apa ada program double degree?');
      expect(frame.entities).toBeDefined();
      expect(frame.entities.length).toBeGreaterThan(0);
      expect(frame.entities[0].canonical).toBe('International Dual Degree');

      const plan = buildRetrievalPlan(frame);
      // Umbrella entity MUST NOT exclude its member programs
      expect(plan.excludedConflictingEntities).not.toContain('Double Degree DNUI');
      expect(plan.excludedConflictingEntities).not.toContain('dnui');
      expect(plan.excludedConflictingEntities).not.toContain('Double Degree HELP University');
      expect(plan.excludedConflictingEntities).not.toContain('help university');
      expect(plan.excludedConflictingEntities).not.toContain('Dual Degree UTB');
      expect(plan.excludedConflictingEntities).not.toContain('utb');

      // Query variants must include double degree document keywords, not just student exchange
      const queryStr = plan.queryVariants.join(' ');
      expect(queryStr).toMatch(/double\s+degree|gelar\s+ganda/i);
      expect(queryStr).toMatch(/UTB|HELP|DNUI/i);
    });

    test('1b: Full orchestration of "Apa ada program double degree?" returns verified overview citing UTB, HELP, and DNUI', async () => {
      const chatId = `sys_dd_1b_${Date.now()}`;
      const result = await processTurn(chatId, 'Apa ada program double degree?', { executeDispatch: false });
      const sub = result.subQueryResults?.[0] || {};
      const answer = sub.answer || '';

      // Must NOT be blocked by verifier into SAFE_UNKNOWN
      const verif = sub.verification || result.verification || {};
      expect(verif.outcome).toBe('VERIFIED_FACTUAL');
      expect(answer).not.toMatch(/belum dapat dipastikan secara lengkap saat ini/i);

      // Must explicitly mention both National and International options
      expect(answer).toMatch(/Dual Degree Nasional/i);
      expect(answer).toMatch(/Universitas Teknologi Bandung|UTB/i);
      expect(answer).toMatch(/Bisnis Digital/i);
      expect(answer).toMatch(/Desain Komunikasi Visual|DKV/i);
      expect(answer).toMatch(/S\.Bns/i);
      expect(answer).toMatch(/S\.Ds/i);

      // Must explicitly mention HELP University (Malaysia) and DNUI (China)
      expect(answer).toMatch(/HELP University/i);
      expect(answer).toMatch(/Malaysia/i);
      expect(answer).toMatch(/Sistem Informasi/i);
      expect(answer).toMatch(/Dalian Neusoft University of Information|DNUI/i);
      expect(answer).toMatch(/China/i);

      // Session state must track International Dual Degree as activeEntity
      const session = await getSession(chatId);
      expect(session?.data?.activeEntity).toBe('International Dual Degree');
    });
  });

  describe('2. National Dual Degree Specifics: UTB Bandung', () => {
    test('2a: "Apakah ada program double degree nasional?" routes to Dual Degree UTB and gives grounded details', async () => {
      const chatId = `sys_dd_2a_${Date.now()}`;
      const result = await processTurn(chatId, 'Apakah ada program double degree nasional?', { executeDispatch: false });
      const sub = result.subQueryResults?.[0] || {};
      const answer = sub.answer || '';

      expect(answer).toMatch(/Universitas Teknologi Bandung|UTB/i);
      expect(answer).toMatch(/Bisnis Digital/i);
      expect(answer).toMatch(/Desain Komunikasi Visual|DKV/i);
      expect(answer).toMatch(/S\.Bns/i);
      expect(answer).toMatch(/S\.Ds/i);
      expect(answer).toMatch(/bukan program studi mandiri di ITB STIKOM Bali/i);

      const session = await getSession(chatId);
      expect(session?.data?.activeEntity).toBe('Dual Degree UTB');
    });
  });

  describe('3. Multi-turn Conversational Context: Contact Follow-up', () => {
    test('3a: "Apakah ada kontaknya?" inherits Dual Degree UTB context and directs to central admissions honestly', async () => {
      const chatId = `sys_dd_3a_${Date.now()}`;
      // Turn 1: Discuss UTB
      await processTurn(chatId, 'Apakah ada program double degree nasional?', { executeDispatch: false });

      // Turn 2: Follow-up asking for contact
      const result = await processTurn(chatId, 'Apakah ada kontaknya?', { executeDispatch: false });
      const sub = result.subQueryResults?.[0] || {};
      const answer = sub.answer || '';

      // Context must be retained in answer text
      expect(answer).toMatch(/Dual Degree UTB/i);
      // Must be honest that no separate direct contact is published, routing to official PMB channels
      expect(answer).toMatch(/belum tercantum nomor kontak khusus atau narahubung tersendiri/i);
      expect(answer).toMatch(/pmb\.stikom-bali\.ac\.id/i);
      expect(answer).toMatch(/\(0361\)\s*244445/i);
      expect(answer).toMatch(/info@stikom-bali\.ac\.id/i);

      // Session activeEntity MUST NOT be wiped to null
      const session = await getSession(chatId);
      expect(session?.data?.activeEntity).toBe('Dual Degree UTB');
    });
  });

  describe('4. Multi-turn Procedural Follow-up: Admission Procedure', () => {
    test('4a: "Bagaimana cara mendaftar?" after program inquiry inherits activeEntity and details registration steps', async () => {
      const chatId = `sys_dd_4a_${Date.now()}`;
      // Turn 1: Discuss UTB
      await processTurn(chatId, 'Apakah ada program double degree nasional?', { executeDispatch: false });

      // Turn 2: Ask registration procedure
      const result = await processTurn(chatId, 'Bagaimana cara mendaftar?', { executeDispatch: false });
      const sub = result.subQueryResults?.[0] || {};
      const answer = sub.answer || '';

      // Context must be preserved in procedure answer
      expect(answer).toMatch(/Dual Degree Nasional|UTB/i);
      expect(answer).toMatch(/pmb\.stikom-bali\.ac\.id/i);
      expect(answer).toMatch(/Bisnis Digital/i);
      expect(answer).toMatch(/Desain Komunikasi Visual/i);
      expect(answer).toMatch(/pendaftaran/i);

      const session = await getSession(chatId);
      expect(session?.data?.activeEntity).toBe('Dual Degree UTB');
    });

    test('4b: "Apa saja persyaratannya?" after program inquiry explains admission requirements without generic wipe', async () => {
      const chatId = `sys_dd_4b_${Date.now()}`;
      await processTurn(chatId, 'Apakah ada program double degree nasional?', { executeDispatch: false });

      const result = await processTurn(chatId, 'Apa saja persyaratannya?', { executeDispatch: false });
      const sub = result.subQueryResults?.[0] || {};
      const answer = sub.answer || '';

      expect(answer).toMatch(/Dual Degree Nasional|UTB/i);
      expect(answer).toMatch(/SMA\/SMK\/MA|sederajat/i);
      expect(answer).toMatch(/Ijazah|Surat Keterangan Lulus/i);
      expect(answer).toMatch(/pmb\.stikom-bali\.ac\.id/i);

      const session = await getSession(chatId);
      expect(session?.data?.activeEntity).toBe('Dual Degree UTB');
    });
  });

  describe('5. International Leaf Programs: HELP Malaysia and DNUI China Isolation', () => {
    test('5a: "Double degree HELP Malaysia seperti apa?" isolates to HELP without mixing DNUI or UTB details', async () => {
      const chatId = `sys_dd_5a_${Date.now()}`;
      const result = await processTurn(chatId, 'Double degree HELP Malaysia seperti apa?', { executeDispatch: false });
      const sub = result.subQueryResults?.[0] || {};
      const answer = sub.answer || '';

      expect(answer).toMatch(/HELP University/i);
      expect(answer).toMatch(/Sistem Informasi/i);
      expect(answer).toMatch(/S\.Kom/i);
      expect(answer).toMatch(/BIT|Bachelor of Information Technology/i);
      // Must NOT contain China or UTB specifics
      expect(answer).not.toMatch(/DNUI/i);
      expect(answer).not.toMatch(/Dalian/i);
      expect(answer).not.toMatch(/UTB/i);

      const session = await getSession(chatId);
      expect(session?.data?.activeEntity).toBe('Double Degree HELP University');
    });

    test('5b: "Kalau yang ke China itu program apa?" isolates to DNUI China with 2+2 schema', async () => {
      const chatId = `sys_dd_5b_${Date.now()}`;
      const result = await processTurn(chatId, 'Kalau yang ke China itu program apa?', { executeDispatch: false });
      const sub = result.subQueryResults?.[0] || {};
      const answer = sub.answer || '';

      expect(answer).toMatch(/Dalian Neusoft University of Information|DNUI/i);
      expect(answer).toMatch(/Bisnis Digital/i);
      expect(answer).toMatch(/2\+2|Dalian,\s*China/i);
      expect(answer).toMatch(/S\.Bns/i);
      expect(answer).toMatch(/Bachelor of Management|B\.M/i);
      // Must NOT contain Malaysia/HELP specifics
      expect(answer).not.toMatch(/HELP University/i);

      const session = await getSession(chatId);
      expect(session?.data?.activeEntity).toBe('Double Degree DNUI');
    });
  });

  describe('6. Partner Major Status: DKV Clarification', () => {
    test('6a: "Apakah STIKOM punya prodi DKV?" clarifies DKV is a partnership program with UTB, not a standalone major', async () => {
      const chatId = `sys_dd_6a_${Date.now()}`;
      const result = await processTurn(chatId, 'Apakah STIKOM punya prodi DKV?', { executeDispatch: false });
      const sub = result.subQueryResults?.[0] || {};
      const answer = sub.answer || '';

      expect(answer).toMatch(/bukan merupakan program studi mandiri di ITB STIKOM Bali/i);
      expect(answer).toMatch(/Universitas Teknologi Bandung|UTB/i);
      expect(answer).toMatch(/Dual Degree|Gelar Ganda/i);
      expect(answer).toMatch(/S\.Ds/i);
      expect(answer).toMatch(/S\.Bns/i);
    });
  });

  describe('7. Unsupported Inquiry & Fabrication Resistance', () => {
    test('7a: Queries for non-existent double degree majors are not guessed or fabricated', async () => {
      const frame = resolveSemanticFrame('Apakah ada double degree kedokteran?');
      // Should either be OUT_OF_DOMAIN or have no canonical matching entity
      expect(frame.entities.some(e => e.canonical === 'Kedokteran')).toBe(false);
    });

    test('7b: Leaf entity verifier strictly blocks conflicting sibling claims in answers', () => {
      // If target is Dual Degree UTB, claiming DNUI or China degree MUST be rejected by the verifier
      const mockFrame = {
        domain: 'INTERNATIONAL',
        intent: 'INTERNATIONAL_PROGRAM_INFO',
        rawQuery: 'Ceritakan dual degree UTB',
        entities: [{ canonical: 'Dual Degree UTB' }],
        aspects: ['overview']
      };

      const mockEvidence = {
        retrievalPlan: {
          excludedConflictingEntities: ['Double Degree DNUI', 'dnui', 'dalian neusoft']
        }
      };

      const conflictingAnswer = 'Program Dual Degree UTB ini merupakan program di dnui China dengan gelar B.M.';
      const verifResult = verifyFinalAnswer(conflictingAnswer, mockFrame, mockEvidence);
      expect(['ESCALATION_GUIDANCE', 'SAFE_UNKNOWN', 'VERIFICATION_FAILED']).toContain(verifResult.outcome);
      expect(verifResult.reason).toMatch(/entity_contradiction_conflicting_sibling_in_answer: dnui/);
    });

    test('7c: Campus contact channels do NOT satisfy specific partner admission requirements without evidence', () => {
      const frame = {
        domain: 'PMB',
        intent: 'ADMISSION_REQUIREMENTS',
        rawQuery: 'Apa saja syarat masuk program UTB Bandung?',
        entities: [{ canonical: 'Dual Degree UTB' }],
        aspects: ['requirements']
      };

      // Evidence only contains central campus contact numbers, no requirement keywords
      const evidenceList = [
        { text: 'Informasi PMB ITB STIKOM Bali hubungi (0361) 244445 atau kunjungi pmb.stikom-bali.ac.id' }
      ];

      const res = evaluateAnswerability(frame, { accepted: evidenceList });
      expect(res.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
      expect(res.reason).toBe('insufficient_aspect_evidence');
      expect(res.missingAspects).toContain('requirements');
    });

    test('7d: Campus contact channels do NOT satisfy tuition fee inquiries without fee evidence', () => {
      const frame = {
        domain: 'TUITION_FEE',
        intent: 'FEE_INQUIRY',
        rawQuery: 'Berapa biaya kuliah Dual Degree UTB?',
        entities: [{ canonical: 'Dual Degree UTB' }],
        aspects: ['fee', 'tuition']
      };

      const evidenceList = [
        { text: 'Informasi pendaftaran hubungi saluran telepon kampus (0361) 244445' }
      ];

      const res = evaluateAnswerability(frame, { accepted: evidenceList });
      expect(res.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
      expect(res.reason).toBe('insufficient_fee_aspect_coverage');
      expect(res.missingAspects).toContain('fee');
    });

    test('7e: Private or personal contact requests are strictly gated as unrecorded', () => {
      const frame = {
        domain: 'CAMPUS_SERVICE',
        intent: 'CONTACT_INQUIRY',
        rawQuery: 'Boleh minta nomor WA pribadi kepala program UTB?',
        entities: [{ canonical: 'Dual Degree UTB' }],
        aspects: ['contact']
      };

      const evidenceList = [
        { text: 'Program Dual Degree UTB bekerja sama dengan Universitas Teknologi Bandung.' }
      ];

      const res = evaluateAnswerability(frame, { accepted: evidenceList });
      expect(res.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
      expect(res.reason).toBe('corpus_gap_private_contact_not_published');
    });
  });

  describe('8. Language Detection: Robustness against Academic & Institutional Loanwords', () => {
    test('8a: Indonesian inquiries mentioning HELP, University, and Double Degree remain classified as "id"', () => {
      expect(detectQueryLanguage('Bagaimana program double degree dengan HELP University?')).toBe('id');
      expect(detectQueryLanguage('Double degree HELP Malaysia seperti apa?')).toBe('id');
      expect(detectQueryLanguage('Program dual degree nasional ada jurusan apa saja?')).toBe('id');
      expect(detectQueryLanguage('Apakah ada exchange program ke luar negeri?')).toBe('id');
      expect(detectQueryLanguage('Berapa biaya kuliah untuk program international?')).toBe('id');
    });

    test('8b: Queries with English functional structure are properly classified as "en"', () => {
      expect(detectQueryLanguage('What is the tuition fee for the international double degree program?')).toBe('en');
      expect(detectQueryLanguage('How to register for HELP University dual degree?')).toBe('en');
      expect(detectQueryLanguage('Could you explain the admission requirements for international students?')).toBe('en');
    });
  });

  describe('9. Multi-turn Contact Phrasing Variations', () => {
    test('9a: Varied follow-up contact inquiries inherit active entity and provide grounded admissions contact', async () => {
      const contactVariations = [
        'Boleh minta nomor kontaknya?',
        'Kontak yang bisa dihubungi kemana ya?',
        'Ada nomor WhatsApp atau telepon resminya?'
      ];

      for (const query of contactVariations) {
        const chatId = `sys_dd_contact_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        // Turn 1: Establish UTB
        await processTurn(chatId, 'Apakah ada program double degree nasional?', { executeDispatch: false });
        // Turn 2: Follow-up with variation
        const result = await processTurn(chatId, query, { executeDispatch: false });
        const sub = result.subQueryResults?.[0] || {};
        const answer = sub.answer || '';

        expect(answer).toMatch(/Dual Degree UTB/i);
        expect(answer).toMatch(/pmb\.stikom-bali\.ac\.id/i);
        expect(answer).toMatch(/\(0361\)\s*244445/i);

        const session = await getSession(chatId);
        expect(session?.data?.activeEntity).toBe('Dual Degree UTB');
      }
    });
  });

  describe('10. Document & Announcement Sanitization', () => {
    test('10a: Outbound sanitization cleanly strips raw sheet tags, OCR markers, and column dumps', () => {
      const dirtyOutput = '[Sheet: Sheet1] Penjelasan Prodi\n[Sheet: Data PMB]\n| col2 : Gelar Ganda UTB | col3 : S.Bns\nInformasi mengenai wisuda.';
      const clean = sanitizeOutboundWhatsappText(dirtyOutput);
      expect(clean).not.toMatch(/\[Sheet:/i);
      expect(clean).not.toMatch(/\|\s*col\d+/i);
      expect(clean).toContain('Gelar Ganda UTB');
      expect(clean).toContain('Informasi mengenai wisuda.');
    });
  });
});
