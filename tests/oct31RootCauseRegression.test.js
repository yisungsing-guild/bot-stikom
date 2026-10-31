'use strict';

/**
 * tests/oct31RootCauseRegression.test.js
 *
 * Regression suite for 31 October 2026 Root Cause Fixes:
 * 1. PMB context continuity & academic year persistence without activeEntity.
 * 2. Proper isolation: PMB context does not leak to unrelated domains.
 * 3. Scholarship retrieval: Gate 0.2 checks direct user intent, not internal query expansion.
 * 4. Institutional parent entity ("ITB STIKOM Bali") does not act as campus_location filter for non-facility queries.
 * 5. Grounded scholarship & fee answer invariants: no fabricated external scholarships, fail-closed when evidence is missing.
 */

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { evaluateContextDependency } = require('../src/core/contextResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { retrieveCandidates } = require('../src/core/retrievalService');
const { arbitrateEvidence, evaluateEvidenceCompatibility } = require('../src/core/evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { buildGenericExtractiveFallback } = require('../src/core/groundedAnswerGenerator');
const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');

describe('31 October Root Cause Regression Suite', () => {

  describe('1. Case 1: PMB Context Continuity & Academic Year Inheritance', () => {

    test('1a. PMB inquiry establishes academicYear 2026/2027 in semantic frame', () => {
      const frame = resolveSemanticFrame('Saya ingin bertanya tentang pmb');
      expect(frame.domain).toBe('PMB');
      expect(frame.intent).toBe('GENERAL_PMB_INQUIRY');
      expect(frame.temporal?.academicYear).toBe('2026/2027');
      expect(frame.academicYear).toBe('2026/2027');
    });

    test('1b. PMB -> "Jadwal pendaftaran" inherits PMB domain and academicYear even when activeEntity is null', () => {
      const sessionData = {
        activeDomain: 'PMB',
        activeIntent: 'GENERAL_PMB_INQUIRY',
        activeAspects: ['admission_overview', 'procedure', 'admission_pathways'],
        activeEntity: null,
        academicYear: '2026/2027',
        lastQuery: 'Saya ingin bertanya tentang pmb',
        lastAnswer: 'Informasi Penerimaan Mahasiswa Baru (PMB). • Tahun Akademik: 2026/2027.',
        conversationHistory: [
          { role: 'user', content: 'Saya ingin bertanya tentang pmb' },
          { role: 'assistant', content: 'Informasi Penerimaan Mahasiswa Baru (PMB). • Tahun Akademik: 2026/2027.' }
        ]
      };

      const contextDep = evaluateContextDependency('Jadwal pendaftaran', sessionData);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.inheritedDomain).toBe('PMB');
      expect(contextDep.inheritedIntent).toBe('ADMISSION_SCHEDULE');
      expect(contextDep.inheritedAcademicYear).toBe('2026/2027');

      const frame = resolveSemanticFrame('Jadwal pendaftaran', sessionData);
      expect(frame.domain).toBe('PMB');
      expect(frame.intent).toBe('ADMISSION_SCHEDULE');
      expect(frame.academicYear).toBe('2026/2027');
      expect(frame.temporal?.academicYear).toBe('2026/2027');
    });

    test('1c. PMB -> Related procedural inquiry ("Alur pendaftaran bagaimana?") inherits PMB context without activeEntity', () => {
      const sessionData = {
        activeDomain: 'PMB',
        activeIntent: 'GENERAL_PMB_INQUIRY',
        activeEntity: null,
        academicYear: '2026/2027',
        lastQuery: 'Saya ingin bertanya tentang pmb'
      };

      const contextDep = evaluateContextDependency('Alur pendaftaran bagaimana?', sessionData);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.inheritedDomain).toBe('PMB');

      const frame = resolveSemanticFrame('Alur pendaftaran bagaimana?', sessionData);
      expect(frame.domain).toBe('PMB');
      expect(frame.intent).toBe('ADMISSION_PROCEDURE');
      expect(frame.academicYear).toBe('2026/2027');
    });

    test('1d. Negative Case: PMB -> Unrelated inquiry ("Di mana kampus Jimbaran?") does NOT leak PMB context', () => {
      const sessionData = {
        activeDomain: 'PMB',
        activeIntent: 'GENERAL_PMB_INQUIRY',
        activeEntity: null,
        academicYear: '2026/2027',
        lastQuery: 'Saya ingin bertanya tentang pmb'
      };

      const contextDep = evaluateContextDependency('Di mana kampus Jimbaran?', sessionData);
      expect(contextDep.inheritedDomain).not.toBe('PMB');

      const frame = resolveSemanticFrame('Di mana kampus Jimbaran?', sessionData);
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('CAMPUS_LOCATION');
      expect(frame.locationScope).toBe('SINGLE');
      expect(frame.targetBranch).toBe('jimbaran');
      expect(frame.academicYear).toBeNull();
      expect(frame.temporal?.academicYear).toBeNull();
    });

    test('1e. Negative Case: PMB -> Academic event inquiry ("Kapan wisuda?") does NOT inherit PMB context', () => {
      const sessionData = {
        activeDomain: 'PMB',
        activeIntent: 'GENERAL_PMB_INQUIRY',
        activeEntity: null,
        academicYear: '2026/2027',
        lastQuery: 'Saya ingin bertanya tentang pmb'
      };

      const contextDep = evaluateContextDependency('Kapan wisuda?', sessionData);
      expect(contextDep.inheritedDomain).not.toBe('PMB');

      const frame = resolveSemanticFrame('Kapan wisuda?', sessionData);
      expect(frame.domain).toBe('ACADEMIC_EVENT');
      expect(frame.intent).toBe('GRADUATION_INQUIRY');
      expect(frame.academicYear).toBeNull();
      expect(frame.temporal?.academicYear).toBeNull();
    });

    test('1f. Fail-Closed Calendar Date: "Jadwal pendaftaran" does not invent specific calendar dates', async () => {
      const sessionData = {
        activeDomain: 'PMB',
        activeIntent: 'GENERAL_PMB_INQUIRY',
        activeEntity: null,
        academicYear: '2026/2027',
        lastQuery: 'Saya ingin bertanya tentang pmb',
        conversationHistory: [
          { role: 'user', content: 'Saya ingin bertanya tentang pmb' },
          { role: 'assistant', content: 'Informasi Penerimaan Mahasiswa Baru (PMB). • Tahun Akademik: 2026/2027.' }
        ]
      };

      const res = await runPhase1DeterministicPipeline('sim_sched_test', 'Jadwal pendaftaran', {
        syncOnly: true,
        fastFallback: true,
        sessionSnapshot: { data: sessionData }
      });

      expect(res.intent).toBe('ADMISSION_SCHEDULE');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toContain('2026/2027');
      expect(res.finalAnswer).toContain('https://pmb.stikom-bali.ac.id');
      // Must not fabricate arbitrary calendar dates (e.g. "12 Oktober 2026 s/d 25 November 2026")
      expect(res.finalAnswer).not.toMatch(/\b\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+2026\s*s\/?d/i);
    });

    test('1g. Academic year isolation: Switching to new topic clears active academicYear, while PMB continuation inherits it', () => {
      const pmbSession = {
        activeDomain: 'PMB',
        activeIntent: 'GENERAL_PMB_INQUIRY',
        academicYear: '2026/2027',
        lastQuery: 'Saya ingin bertanya tentang pmb'
      };

      // Condition 1: Switching to unrelated topic does NOT inherit PMB academicYear
      const locDep = evaluateContextDependency('Di mana kampus Jimbaran?', pmbSession);
      expect(locDep.shouldInherit).toBe(false);
      const locFrame = resolveSemanticFrame('Di mana kampus Jimbaran?', pmbSession);
      expect(locFrame.academicYear).toBeNull();
      expect(locFrame.temporal?.academicYear).toBeNull();

      // Condition 2: Subsequent PMB follow-up inquiry properly inherits academicYear
      const pmbFollowupDep = evaluateContextDependency('Jadwal pendaftaran', pmbSession);
      expect(pmbFollowupDep.shouldInherit).toBe(true);
      expect(pmbFollowupDep.inheritedAcademicYear).toBe('2026/2027');
      const pmbFollowupFrame = resolveSemanticFrame('Jadwal pendaftaran', pmbSession);
      expect(pmbFollowupFrame.academicYear).toBe('2026/2027');
      expect(pmbFollowupFrame.temporal?.academicYear).toBe('2026/2027');
    });

  });

  describe('2. Case 2: Scholarship Retrieval & Gate 0.2 Safety', () => {

    test('2a. Institutional mention "di kampus ITB STIKOM Bali" does not force campus_location allowedFamilies', () => {
      const frame = resolveSemanticFrame('Beasiswa apa saja yang tersedia di kampus ITB STIKOM Bali?');
      expect(frame.domain).toBe('SCHOLARSHIP');
      expect(frame.intent).toBe('SCHOLARSHIP_INQUIRY');

      const plan = buildRetrievalPlan(frame);
      expect(plan.retrievalContract.scopeConstraints.allowedFamilies).not.toContain('campus_location');
      expect(plan.targetEntities).not.toContain('Kampus ITB STIKOM Bali');
    });

    test('2b. Gate 0.2 isAskingFormFee does NOT false-trigger on scholarship query expansion variants', () => {
      const frame = resolveSemanticFrame('Beasiswa apa saja yang tersedia di kampus ITB STIKOM Bali?');
      const plan = buildRetrievalPlan(frame);

      // Candidate with DPP scholarship discount from official fee PDF
      const dppScholarshipCandidate = {
        sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
        docCategory: 'BIAYA',
        chunk: '3. a. Beasiswa untuk Dana Pendidikan Pokok (DPP) :\nRp. 3.000.000,- Jika Registrasi pada Gelombang Khusus',
        aspect: 'potongan_dpp'
      };

      const evalResult = evaluateEvidenceCompatibility(dppScholarshipCandidate, plan);
      // Must NOT be rejected by Gate 0.2 (REJECT_ASPECT_MISMATCH)
      expect(evalResult.accepted).toBe(true);
      expect(evalResult.disposition).toBe('SUPPORTS');
    });

    test('2c. Gate 0.2 STILL correctly rejects DPP discount chunks when user directly asks about registration form fee', () => {
      const frame = resolveSemanticFrame('Berapa biaya formulir pendaftaran?');
      const plan = buildRetrievalPlan(frame);

      const dppScholarshipCandidate = {
        sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
        docCategory: 'BIAYA',
        chunk: '3. a. Beasiswa untuk Dana Pendidikan Pokok (DPP) :\nRp. 3.000.000,- Jika Registrasi pada Gelombang Khusus',
        aspect: 'potongan_dpp'
      };

      const evalResult = evaluateEvidenceCompatibility(dppScholarshipCandidate, plan);
      // Gate 0.2 MUST reject DPP discount chunks when asking for form fee
      expect(evalResult.accepted).toBe(false);
      expect(evalResult.disposition).toBe('REJECT_ASPECT_MISMATCH');
    });

    test('2d. Scholarship candidate arbitration accepts genuine official DPP & alumni fee chunks', async () => {
      const frame = resolveSemanticFrame('Beasiswa apa saja yang tersedia di kampus ITB STIKOM Bali?');
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { topK: 12 });

      expect(candidates.length).toBeGreaterThan(0);
      const arbitrated = arbitrateEvidence(candidates, plan);
      expect(arbitrated.accepted.length).toBeGreaterThan(0);

      const acceptedSources = arbitrated.accepted.map(c => c.sourceFile || c.source_file || c.source || c.metadata?.sourceFile || '').join(' ');
      expect(acceptedSources).toMatch(/rincian Biaya/i);
    });

    test('2e. Extractive fallback for general scholarship strictly presents verified discounts from accepted evidence without hallucinating KIP/Prestasi', async () => {
      const frame = resolveSemanticFrame('Beasiswa apa saja yang tersedia di kampus ITB STIKOM Bali?');
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { topK: 12 });
      const arbitrated = arbitrateEvidence(candidates, plan);
      const fallback = buildGenericExtractiveFallback(frame, arbitrated.accepted, arbitrated);

      expect(fallback.success).toBe(true);
      expect(fallback.isExtractive).toBe(true);
      expect(fallback.answer).toMatch(/Dana Pendidikan Pokok|DPP/i);
      // Must NOT claim that KIP Kuliah or Beasiswa Prestasi is definitively available with fabricated criteria
      expect(fallback.answer).not.toMatch(/Beasiswa KIP Kuliah di ITB STIKOM Bali memberikan/i);
    });

    test('2f. Fail-closed on unrecorded external scholarship query without official proof', async () => {
      const frame = resolveSemanticFrame('Bagaimana cara mendaftar beasiswa KIP Kuliah?');
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { topK: 12 });
      const arbitrated = arbitrateEvidence(candidates, plan);
      const fallback = buildGenericExtractiveFallback(frame, arbitrated.accepted, arbitrated);

      // When no official evidence exists, fallback fails closed to natural unanswerable guidance
      expect(fallback.success).toBe(false);
      expect(fallback.source).toBe('unanswerable_natural_guidance');
      expect(fallback.answer).toMatch(/belum dapat (?:diverifikasi|dipastikan)/i);
      // Must not invent DTKS or criteria
      expect(fallback.answer).not.toContain('Data Terpadu Kesejahteraan Sosial');
    });

  });

});
