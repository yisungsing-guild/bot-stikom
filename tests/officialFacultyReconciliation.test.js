'use strict';

/**
 * tests/officialFacultyReconciliation.test.js
 *
 * REGRESSION SUITE: Official Institutional Source & Corpus Reconciliation
 * Grounded in: https://pasca.stikom-bali.ac.id/tentang
 * Section: "Sejarah Kami / Penguatan Akademik dan Transformasi Institusi"
 *
 * Ground Truth:
 * - FIK (Fakultas Informatika dan Komputer / INFOKOM):
 *   S1 Sistem Informasi, S1 Sistem Komputer, S1 Teknologi Informasi, S2 Magister Sistem Informasi
 * - FBV (Fakultas Bisnis dan Vokasi / BISVO):
 *   S1 Bisnis Digital, D3 Manajemen Informatika
 *
 * Invariants Verified:
 * 1. "Teknologi Informasi masuk fakultas apa?" -> FIK (INFOKOM)
 * 2. "Teknologi masuk fakultas apa?" -> Clarification requested (ambiguous query without "Informasi")
 * 3. "D3 Manajemen Informatika masuk fakultas apa?" -> FBV (BISVO), no safe-unknown fallback
 * 4. "Bisnis Digital masuk fakultas apa?" -> FBV (BISVO)
 * 5. "Apa saja program studi di FIK dan FBV?" -> Grounded listing of both faculties with exact prodi mapping
 * 6. Official source chunk is retrievable via runtime RAG corpus index
 */

const {
  INSTITUTIONAL_FACULTIES,
  resolveFaculty,
  getFacultyForProgram,
  getProgramsForFaculty,
  generateGroundedFacultySummary
} = require('../src/core/academicCatalog');

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { retrieveCandidates } = require('../src/core/retrievalService');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { synthesizeAnswer } = require('../src/core/groundedAnswerGenerator');
const { verifyFinalAnswer, VERIFICATION_OUTCOME } = require('../src/core/finalAnswerVerifier');
const { getCorpusIndex } = require('../src/engine/pgvectorShadowProvider');
const { processTurn } = require('../src/core/orchestrator');

describe('Official Institutional Source & Corpus Reconciliation', () => {
  jest.setTimeout(45000);

  // =========================================================================
  // Section 1: Canonical Catalog & Institutional Invariants
  // =========================================================================
  describe('1. Institutional Faculty Catalog Invariants', () => {
    test('1a. INSTITUTIONAL_FACULTIES defines exactly FIK and FBV with zero conflicting overlap', () => {
      expect(INSTITUTIONAL_FACULTIES.length).toBe(2);
      const fik = INSTITUTIONAL_FACULTIES.find(f => f.id === 'fik');
      const fbv = INSTITUTIONAL_FACULTIES.find(f => f.id === 'fbv');

      expect(fik).toBeDefined();
      expect(fbv).toBeDefined();

      // FIK programs
      expect(fik.programs).toContain('S1 Sistem Informasi');
      expect(fik.programs).toContain('S1 Sistem Komputer');
      expect(fik.programs).toContain('S1 Teknologi Informasi');
      expect(fik.programs).toContain('S2 Magister Sistem Informasi (M.Kom)');
      expect(fik.programs.length).toBe(4);

      // FBV programs
      expect(fbv.programs).toContain('S1 Bisnis Digital');
      expect(fbv.programs).toContain('D3 Manajemen Informatika');
      expect(fbv.programs.length).toBe(2);

      // Zero intersection
      const fikSet = new Set(fik.programs);
      for (const prog of fbv.programs) {
        expect(fikSet.has(prog)).toBe(false);
      }
    });

    test('1b. resolveFaculty recognizes canonical names, short names, and official aliases', () => {
      expect(resolveFaculty('FIK').id).toBe('fik');
      expect(resolveFaculty('INFOKOM').id).toBe('fik');
      expect(resolveFaculty('Fakultas Informatika dan Komputer').id).toBe('fik');

      expect(resolveFaculty('FBV').id).toBe('fbv');
      expect(resolveFaculty('BISVO').id).toBe('fbv');
      expect(resolveFaculty('Fakultas Bisnis dan Vokasi').id).toBe('fbv');
    });

    test('1c. getFacultyForProgram correctly isolates specific programs and rejects ambiguous queries', () => {
      expect(getFacultyForProgram('Teknologi Informasi').id).toBe('fik');
      expect(getFacultyForProgram('S1 Teknologi Informasi').id).toBe('fik');
      expect(getFacultyForProgram('D3 Manajemen Informatika').id).toBe('fbv');
      expect(getFacultyForProgram('Manajemen Informatika').id).toBe('fbv');
      expect(getFacultyForProgram('Bisnis Digital').id).toBe('fbv');
      expect(getFacultyForProgram('S1 Bisnis Digital').id).toBe('fbv');
      expect(getFacultyForProgram('S1 Sistem Informasi').id).toBe('fik');
      expect(getFacultyForProgram('S1 Sistem Komputer').id).toBe('fik');

      // Ambiguous solitary 'Teknologi' must return null
      expect(getFacultyForProgram('Teknologi')).toBeNull();
      expect(getFacultyForProgram('teknologi masuk fakultas apa')).toBeNull();
    });
  });

  // =========================================================================
  // Section 2: Grounded Summary Generation for the 5 Target Queries
  // =========================================================================
  describe('2. Grounded Generation for 5 Specified Queries', () => {
    test('2a. "Teknologi Informasi masuk fakultas apa?" -> FIK (INFOKOM)', () => {
      const summary = generateGroundedFacultySummary('Teknologi Informasi masuk fakultas apa?');
      expect(summary).toBeTruthy();
      expect(summary).toMatch(/Fakultas Informatika dan Komputer/i);
      expect(summary).toMatch(/FIK/i);
      expect(summary).toMatch(/S1 Teknologi Informasi/i);
      expect(summary).not.toMatch(/Fakultas Bisnis dan Vokasi/i);
    });

    test('2b. "Teknologi masuk fakultas apa?" -> Requests clarification without false equivalence', () => {
      const summary = generateGroundedFacultySummary('Teknologi masuk fakultas apa?');
      expect(summary).toBeTruthy();
      // Must ask for clarification
      expect(summary).toMatch(/Mohon klarifikasi program studi yang Kakak maksud/i);
      expect(summary).toMatch(/S1 Teknologi Informasi/i);
      expect(summary).toMatch(/sebutkan nama program studi secara spesifik/i);
      // Must NOT assert that "Teknologi" definitively belongs to any faculty
      expect(summary).not.toMatch(/^Di ITB STIKOM Bali, program studi \*\*Teknologi\*\* bernaung di bawah/i);
    });

    test('2c. "D3 Manajemen Informatika masuk fakultas apa?" -> FBV without safe-unknown fallback', () => {
      const summary = generateGroundedFacultySummary('D3 Manajemen Informatika masuk fakultas apa?');
      expect(summary).toBeTruthy();
      expect(summary).toMatch(/Fakultas Bisnis dan Vokasi/i);
      expect(summary).toMatch(/FBV/i);
      expect(summary).toMatch(/D3 Manajemen Informatika/i);
      // Must NOT contain safe-unknown / data-gap disclaimer
      expect(summary).not.toMatch(/belum memuat surat keputusan penempatan/i);
      expect(summary).not.toMatch(/belum dapat dipastikan/i);
      expect(summary).not.toMatch(/Fakultas Informatika dan Komputer/i);
    });

    test('2d. "Bisnis Digital masuk fakultas apa?" -> FBV (BISVO)', () => {
      const summary = generateGroundedFacultySummary('Bisnis Digital masuk fakultas apa?');
      expect(summary).toBeTruthy();
      expect(summary).toMatch(/Fakultas Bisnis dan Vokasi/i);
      expect(summary).toMatch(/FBV/i);
      expect(summary).toMatch(/S1 Bisnis Digital/i);
      expect(summary).not.toMatch(/belum menemukan informasi fakultas/i);
      expect(summary).not.toMatch(/Fakultas Informatika dan Komputer/i);
    });

    test('2e. "Apa saja program studi di FIK dan FBV?" -> Accurate listing of both faculties', () => {
      const summary = generateGroundedFacultySummary('Apa saja program studi di FIK dan FBV?');
      expect(summary).toBeTruthy();

      // FIK section
      expect(summary).toMatch(/Fakultas Informatika dan Komputer \(FIK/i);
      expect(summary).toMatch(/S1 Sistem Informasi/i);
      expect(summary).toMatch(/S1 Sistem Komputer/i);
      expect(summary).toMatch(/S1 Teknologi Informasi/i);
      expect(summary).toMatch(/S2 Magister Sistem Informasi/i);

      // FBV section
      expect(summary).toMatch(/Fakultas Bisnis dan Vokasi \(FBV/i);
      expect(summary).toMatch(/S1 Bisnis Digital/i);
      expect(summary).toMatch(/D3 Manajemen Informatika/i);
    });
  });

  // =========================================================================
  // Section 3: Runtime Index & Retrieval Verification
  // =========================================================================
  describe('3. Runtime Corpus Index & Retrieval Grounding', () => {
    test('3a. Official source chunk from pasca.stikom-bali.ac.id/tentang is present in runtime corpus index', () => {
      const corpus = getCorpusIndex({}, { requireCanonical: true });
      expect(corpus.length).toBeGreaterThanOrEqual(829);

      const officialChunk = corpus.find(c => c.id === 'official-web-pasca-tentang-sejarah-fakultas');
      expect(officialChunk).toBeDefined();
      const fileRef = officialChunk.source_file || officialChunk.filename || '';
      expect(fileRef).toContain('pasca.stikom-bali.ac.id');
      const textContent = officialChunk.chunk || officialChunk.text || '';
      expect(textContent).toContain('Fakultas Informatika dan Komputer');
      expect(textContent).toContain('Fakultas Bisnis dan Vokasi');
      expect(textContent).toContain('S1 Bisnis Digital');
      expect(textContent).toContain('D3 Manajemen Informatika');
    });

    test('3b. Retrieval service retrieves official faculty chunk for faculty inquiries', async () => {
      const frame = resolveSemanticFrame('Apa saja program studi di FIK dan FBV?');
      expect(frame.intent).toBe('FACULTY_INQUIRY');

      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { queryText: 'Apa saja program studi di FIK dan FBV?' });

      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBeGreaterThan(0);

      const hasOfficialChunk = candidates.some(c =>
        c.id === 'official-web-pasca-tentang-sejarah-fakultas' ||
        ((c.chunk || c.text || '').includes('Fakultas Bisnis dan Vokasi (BISVO)'))
      );
      expect(hasOfficialChunk).toBe(true);
    });
  });

  // =========================================================================
  // Section 4: End-to-End Answerability, Synthesis, and Verification Pipeline
  // =========================================================================
  describe('4. End-to-End Pipeline (Answerability, Generator, Verifier)', () => {
    test('4a. E2E pipeline answers "Teknologi Informasi masuk fakultas apa?" with VERIFIED_FACTUAL', async () => {
      const rawQuery = 'Teknologi Informasi masuk fakultas apa?';
      const frame = resolveSemanticFrame(rawQuery);
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { queryText: rawQuery });
      const arbitrated = arbitrateEvidence(candidates, plan, frame);
      const answerability = evaluateAnswerability(frame, arbitrated);

      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);

      const synth = await synthesizeAnswer(frame, arbitrated);
      expect(synth.success).toBe(true);
      expect(synth.answer).toMatch(/Fakultas Informatika dan Komputer/i);
      expect(synth.answer).toMatch(/S1 Teknologi Informasi/i);

      const verif = verifyFinalAnswer(synth.answer, frame, arbitrated);
      expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
      expect(verif.pass).toBe(true);
    });

    test('4b. E2E pipeline handles ambiguous "Teknologi masuk fakultas apa?" safely with clarification', async () => {
      const rawQuery = 'Teknologi masuk fakultas apa?';
      const frame = resolveSemanticFrame(rawQuery);
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { queryText: rawQuery });
      const arbitrated = arbitrateEvidence(candidates, plan, frame);
      const answerability = evaluateAnswerability(frame, arbitrated);

      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);

      const synth = await synthesizeAnswer(frame, arbitrated);
      expect(synth.success).toBe(true);
      expect(synth.answer).toMatch(/Mohon klarifikasi/i);
      expect(synth.answer).toMatch(/S1 Teknologi Informasi/i);

      const verif = verifyFinalAnswer(synth.answer, frame, arbitrated);
      expect(verif.handledSafely).toBe(true);
      expect(verif.outcome).toBe(VERIFICATION_OUTCOME.ESCALATION_GUIDANCE);
      expect(verif.reason).toBe('clarification_prompt');
    });

    test('4c. E2E pipeline answers "D3 Manajemen Informatika masuk fakultas apa?" with VERIFIED_FACTUAL under FBV', async () => {
      const rawQuery = 'D3 Manajemen Informatika masuk fakultas apa?';
      const frame = resolveSemanticFrame(rawQuery);
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { queryText: rawQuery });
      const arbitrated = arbitrateEvidence(candidates, plan, frame);
      const answerability = evaluateAnswerability(frame, arbitrated);

      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);

      const synth = await synthesizeAnswer(frame, arbitrated);
      expect(synth.success).toBe(true);
      expect(synth.answer).toMatch(/Fakultas Bisnis dan Vokasi/i);
      expect(synth.answer).toMatch(/D3 Manajemen Informatika/i);

      const verif = verifyFinalAnswer(synth.answer, frame, arbitrated);
      expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
      expect(verif.pass).toBe(true);
    });

    test('4d. E2E pipeline answers "Bisnis Digital masuk fakultas apa?" with VERIFIED_FACTUAL under FBV', async () => {
      const rawQuery = 'Bisnis Digital masuk fakultas apa?';
      const frame = resolveSemanticFrame(rawQuery);
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { queryText: rawQuery });
      const arbitrated = arbitrateEvidence(candidates, plan, frame);
      const answerability = evaluateAnswerability(frame, arbitrated);

      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);

      const synth = await synthesizeAnswer(frame, arbitrated);
      expect(synth.success).toBe(true);
      expect(synth.answer).toMatch(/Fakultas Bisnis dan Vokasi/i);
      expect(synth.answer).toMatch(/S1 Bisnis Digital/i);

      const verif = verifyFinalAnswer(synth.answer, frame, arbitrated);
      expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
      expect(verif.pass).toBe(true);
    });

    test('4e. E2E pipeline answers "Apa saja program studi di FIK dan FBV?" with complete grounded mapping', async () => {
      const rawQuery = 'Apa saja program studi di FIK dan FBV?';
      const frame = resolveSemanticFrame(rawQuery);
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { queryText: rawQuery });
      const arbitrated = arbitrateEvidence(candidates, plan, frame);
      const answerability = evaluateAnswerability(frame, arbitrated);

      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);

      const synth = await synthesizeAnswer(frame, arbitrated);
      expect(synth.success).toBe(true);
      expect(synth.answer).toMatch(/Fakultas Informatika dan Komputer/i);
      expect(synth.answer).toMatch(/S1 Sistem Informasi/i);
      expect(synth.answer).toMatch(/S1 Sistem Komputer/i);
      expect(synth.answer).toMatch(/S1 Teknologi Informasi/i);
      expect(synth.answer).toMatch(/S2 Magister Sistem Informasi/i);
      expect(synth.answer).toMatch(/Fakultas Bisnis dan Vokasi/i);
      expect(synth.answer).toMatch(/S1 Bisnis Digital/i);
      expect(synth.answer).toMatch(/D3 Manajemen Informatika/i);

      const verif = verifyFinalAnswer(synth.answer, frame, arbitrated);
      expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
      expect(verif.pass).toBe(true);
    });
  });

  // =========================================================================
  // Section 5: Conversational Context Regression via Full Runtime (processTurn)
  // =========================================================================
  describe('5. Conversational Context Regression via Runtime processTurn', () => {
    test('5a. Multi-turn in same session: Turn 1 sets S1 TI, Turn 2 retains context for "Teknologi masuk fakultas apa?"', async () => {
      const sessionId = 'test_multi_turn_fac_' + Date.now();

      // Turn 1
      const turn1 = await processTurn(sessionId, 'Teknologi Informasi masuk fakultas apa?', { executeDispatch: false });
      expect(turn1).toBeDefined();
      expect(turn1.finalAnswer).toMatch(/Fakultas Informatika dan Komputer/i);
      expect(turn1.finalAnswer).toMatch(/S1 Teknologi Informasi/i);

      // Turn 2 in SAME session inherits S1 TI context
      const turn2 = await processTurn(sessionId, 'Teknologi masuk fakultas apa?', { executeDispatch: false });
      expect(turn2).toBeDefined();
      expect(turn2.finalAnswer).toMatch(/Fakultas Informatika dan Komputer/i);
      expect(turn2.finalAnswer).toMatch(/S1 Teknologi Informasi/i);
    });

    test('5b. Isolated new session: "Teknologi masuk fakultas apa?" requests clarification without prior entity', async () => {
      const freshSessionId = 'test_fresh_turn_fac_' + Date.now();

      // In fresh session with no prior entity, ambiguous "Teknologi" must prompt for clarification
      const res = await processTurn(freshSessionId, 'Teknologi masuk fakultas apa?', { executeDispatch: false });
      expect(res).toBeDefined();
      expect(res.finalAnswer).toMatch(/mohon (?:jelaskan|klarifikasi)/i);
      expect(res.finalAnswer).toMatch(/S1 Teknologi Informasi/i);
    });
  });
});
