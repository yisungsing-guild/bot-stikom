'use strict';

/**
 * tests/clarificationAndReRetrievalV2.test.js
 *
 * Comprehensive Regression and Verification Suite for:
 * 1. Clear questions answered without unnecessary clarification
 * 2. Ambiguous questions yield dynamic, specific clarification
 * 3. Clarification responses bound to triggering inquiries (Retrieve Clarification)
 * 4. Re-retrieval triggered with updated semantic frame
 * 5. Initial retrieval shortfall triggers retry before concluding absence of evidence
 * 6. True absence of evidence honestly stated without fabricating facts
 * 7. Cross-domain queries isolated without entity contamination
 * 8. Regression preservation: Faculty (TI -> FIK, D3 MI -> FBV) & Tuition fees (S1 SI = 6.500.000)
 * 9. Iteration limits strictly enforced to prevent infinite clarification loops
 * 10. WhatsApp format compliance and strict factual grounding
 */

const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');
const { evaluateContextDependency } = require('../src/core/contextResolver');
const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { evaluateAnswerability, ANSWERABILITY_STATUS, detectEvidenceFacets } = require('../src/core/answerabilityGate');

describe('Chat Engine V2 — Understanding, Clarification, Retrieval, and Accuracy', () => {
  jest.setTimeout(60000);

  describe('Point 1 & 8: Clear Questions & Grounded Regression Integrity', () => {
    test('TI masuk fakultas apa: answered immediately as FIK without clarification', async () => {
      const chatId = 'test-reg-ti-' + Date.now();
      const res = await runPhase1DeterministicPipeline(chatId, 'Teknologi informasi masuk fakultas apa?', { syncOnly: true });

      expect(res.subQueryResults[0]?.status).not.toBe('needs_clarification');
      expect(res.finalAnswer).toMatch(/Fakultas Informatika dan Komputer|FIK/i);
      expect(res.finalAnswer).not.toMatch(/Maksud Kakak program sertifikasi/i);
    });

    test('D3 manajemen informatika masuk fakultas apa: answered immediately as FBV', async () => {
      const chatId = 'test-reg-d3mi-' + Date.now();
      const res = await runPhase1DeterministicPipeline(chatId, 'D3 manajemen informatika masuk fakultas apa?', { syncOnly: true });

      expect(res.subQueryResults[0]?.status).not.toBe('needs_clarification');
      expect(res.finalAnswer).toMatch(/Fakultas Bisnis dan Vokasi|FBV/i);
    });

    test('Biaya kuliah S1 Sistem Informasi per semester: answered with Rp 6.500.000', async () => {
      const chatId = 'test-reg-biaya-si-' + Date.now();
      const res = await runPhase1DeterministicPipeline(chatId, 'Berapa biaya kuliah S1 Sistem Informasi per semester?', { syncOnly: true });

      expect(res.subQueryResults[0]?.status).not.toBe('needs_clarification');
      expect(res.finalAnswer).toMatch(/6\.500\.000/);
    });
  });

  describe('Point 2: Ambiguous Questions Produce Relevant Dynamic Clarification', () => {
    test('Broad LinkedIn program inquiry asks for clarification rather than generic gap', async () => {
      const chatId = 'test-ambig-linkedin-' + Date.now();
      const res = await runPhase1DeterministicPipeline(chatId, 'Apakah ada informasi terkait program LinkedIn?', { syncOnly: true });

      expect(res.subQueryResults[0]?.status).toBe('needs_clarification');
      expect(res.finalAnswer).toMatch(/program sertifikasi|pelatihan oleh Career Center|kerja sama kampus/i);
      expect(res.finalAnswer).not.toMatch(/belum tercantum dalam panduan/i);
    });

    test('Frame resolver marks isBroadInquiry for broad program inquiry without narrow aspects', () => {
      const frame = resolveSemanticFrame('Apakah ada informasi terkait program LinkedIn?');
      expect(frame.isBroadInquiry).toBe(true);
    });

    test('Specific inquiry with narrow aspect (training) does not ask clarification', async () => {
      const chatId = 'test-specific-training-' + Date.now();
      const res = await runPhase1DeterministicPipeline(chatId, 'Apakah ada pelatihan profil LinkedIn di kampus?', { syncOnly: true });

      expect(res.subQueryResults[0]?.status).not.toBe('needs_clarification');
      expect(res.finalAnswer).toMatch(/Career Development Center|CDC|Pelatihan/i);
    });
  });

  describe('Point 3 & 4: Clarification Binding (Retrieve Clarification) & Re-Retrieval', () => {
    test('Short answer "sertifikasi" resolves to LinkedIn Learning certification program', async () => {
      const chatId = 'test-multi-clarify-cert-' + Date.now();

      // Turn 1: Clarification prompt
      const t1 = await runPhase1DeterministicPipeline(chatId, 'Apakah ada informasi terkait program LinkedIn?', { syncOnly: true });
      expect(t1.subQueryResults[0]?.status).toBe('needs_clarification');

      // Turn 2: User responds "sertifikasi"
      const t2 = await runPhase1DeterministicPipeline(chatId, 'sertifikasi', { syncOnly: true });
      expect(t2.subQueryResults[0]?.status).not.toBe('needs_clarification');
      expect(t2.verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(t2.finalAnswer).toMatch(/LinkedIn Learning|CDC|Career/i);
    });

    test('Short answer "pelatihan" resolves to Career Center training', async () => {
      const chatId = 'test-multi-clarify-training-' + Date.now();

      // Turn 1: Clarification prompt
      await runPhase1DeterministicPipeline(chatId, 'Apakah ada informasi terkait program LinkedIn?', { syncOnly: true });

      // Turn 2: User responds "pelatihan"
      const t2 = await runPhase1DeterministicPipeline(chatId, 'pelatihan', { syncOnly: true });
      expect(t2.subQueryResults[0]?.status).not.toBe('needs_clarification');
      expect(t2.finalAnswer).toMatch(/Career Development Center|Career Center|pelatihan/i);
    });
  });

  describe('Point 5 & 6: Re-Retrieval on Shortfall & Honest Handling of Absent Evidence', () => {
    test('Non-existent program "jurusan kedokteran" fails closed as unsupported without hallucinating', async () => {
      const chatId = 'test-unsupported-' + Date.now();
      const res = await runPhase1DeterministicPipeline(chatId, 'Apakah ada jurusan kedokteran di STIKOM Bali?', { syncOnly: true });

      expect(res.finalAnswer).toMatch(/tidak diselenggarakan|belum menyelenggarakan|tidak memiliki|tidak tersedia/i);
      expect(res.finalAnswer).not.toMatch(/FIK|FBV/i);
    });

    test('Truly absent campus topic "menu kantin kampus hari ini" reports information limit honestly', async () => {
      const chatId = 'test-absent-menu-' + Date.now();
      const res = await runPhase1DeterministicPipeline(chatId, 'Apa menu makanan kantin kampus hari ini?', { syncOnly: true });

      expect(res.finalAnswer).toMatch(/belum tercantum/i);
      expect(res.verification.isGrounded).toBe(false);
    });
  });

  describe('Point 7: Cross-Domain Isolation', () => {
    test('Query about UKM does not leak into subsequent academic inquiry', async () => {
      const chatId = 'test-domain-iso-' + Date.now();

      // Turn 1: UKM inquiry
      await runPhase1DeterministicPipeline(chatId, 'Apakah ada UKM Tari di ITB STIKOM Bali?', { syncOnly: true });

      // Turn 2: Academic inquiry without pronoun
      const t2 = await runPhase1DeterministicPipeline(chatId, 'Berapa biaya kuliah S1 Sistem Informasi per semester?', { syncOnly: true });
      expect(t2.finalAnswer).toMatch(/6\.500\.000/);
      expect(t2.finalAnswer).not.toMatch(/tari|pragina/i);
    });
  });

  describe('Point 9: Iteration Limit Prevents Clarification Loops', () => {
    test('Clarification is asked at most once and does not loop endlessly', async () => {
      const chatId = 'test-loop-limit-' + Date.now();

      // Turn 1: Clarification
      const t1 = await runPhase1DeterministicPipeline(chatId, 'Apakah ada informasi terkait program LinkedIn?', { syncOnly: true });
      expect(t1.subQueryResults[0]?.status).toBe('needs_clarification');

      // Turn 2: User repeats vague input
      const t2 = await runPhase1DeterministicPipeline(chatId, 'program itu apa saja?', { syncOnly: true });
      // Turn 2 must NOT ask clarification again because clarificationTurnCount is >= 1; it falls back safely to available evidence
      expect(t2.subQueryResults[0]?.status).not.toBe('needs_clarification');
    });
  });

  describe('Point 11: detectEvidenceFacets Generic Precision & Grounding', () => {
    test('Non-LinkedIn entity (Cisco) detects generic certification and training facets without Career Center bias', () => {
      const candidates = [
        { chunk: 'Program Cisco Networking Academy di ITB STIKOM Bali menyelenggarakan program sertifikasi internasional CCNA bagi mahasiswa.' },
        { chunk: 'Peserta Cisco Academy mendapatkan program pelatihan jaringan komputer dan workshop konfigurasi router.' }
      ];
      const frame = { targetEntities: ['Cisco'], rawQuery: 'Program Cisco itu ada apa saja?' };
      const facets = detectEvidenceFacets(candidates, frame);

      expect(facets.map(f => f.key)).toEqual(expect.arrayContaining(['certification', 'training']));
      const trainingFacet = facets.find(f => f.key === 'training');
      // Must NOT be hardcoded to "pelatihan oleh Career Center" when Career Center is not in evidence
      expect(trainingFacet.label).toBe('program pelatihan');
      expect(trainingFacet.option).toBe('pelatihan');
    });

    test('Incubation and internship facets are detected when grounded in official text', () => {
      const candidates = [
        { chunk: 'Unit Inbis ITB STIKOM Bali menyelenggarakan program inkubasi bisnis dan startup bagi tenant mahasiswa.' },
        { chunk: 'Kampus menyediakan program magang industri bersertifikat di berbagai mitra perusahaan teknologi.' }
      ];
      const frame = { rawQuery: 'Apa saja program pengembangan mahasiswa?' };
      const facets = detectEvidenceFacets(candidates, frame);

      expect(facets.map(f => f.key)).toEqual(expect.arrayContaining(['incubation', 'internship']));
    });

    test('Accidental words (CV, e-learning, industri) DO NOT trigger false facets', () => {
      const candidates = [
        { chunk: 'Mahasiswa wajib membawa CV dan portofolio saat registrasi ulang administrasi.' },
        { chunk: 'Lulusan dipersiapkan untuk diserap di dunia industri dan mampu bekerja sama dengan tim secara profesional.' },
        { chunk: 'Perkuliahan didukung dengan sistem e-learning dan modul daring.' }
      ];
      const frame = { rawQuery: 'Bagaimana sistem perkuliahan dan administrasi kampus?' };
      const facets = detectEvidenceFacets(candidates, frame);

      // Incidental words must not produce false certification, training, or cooperation facets
      expect(facets.length).toBe(0);
    });

    test('Multi-question FAQ chunk isolates entity and prevents unrelated Q10 from leaking into entity facets', () => {
      const candidates = [
        {
          chunk: '8. Apakah ada pelatihan LinkedIn?\nJawaban: Ya. Career Center menyelenggarakan pelatihan seperti: Optimalisasi LinkedIn.\n' +
                 '10. Apakah kampus memiliki kerja sama dengan perusahaan?\nJawaban: Ya. ITB STIKOM Bali terus mengembangkan kerja sama dan program magang dengan mitra industri.'
        },
        {
          chunk: 'Program Linkedin Learning khusus Alumni ITB STIKOM Bali untuk memperoleh sertifikasi profesional.'
        }
      ];
      const frame = { targetEntities: ['LinkedIn'], rawQuery: 'Apakah ada informasi terkait program LinkedIn?' };
      const facets = detectEvidenceFacets(candidates, frame);

      // Only certification and training are related to LinkedIn; cooperation & magang from Q10 must NOT leak
      const keys = facets.map(f => f.key);
      expect(keys).toContain('certification');
      expect(keys).toContain('training');
      expect(keys).not.toContain('cooperation');
      expect(keys).not.toContain('internship');
    });
  });

});
