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

const { resolveSemanticFrame, resolveSemanticFrameAsync } = require('../src/core/semanticFrameResolver');
const { evaluateContextDependency } = require('../src/core/contextResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { retrieveCandidates } = require('../src/core/retrievalService');
const { arbitrateEvidence, evaluateEvidenceCompatibility, curateCandidatePassages } = require('../src/core/evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { buildGenericExtractiveFallback, extractGroundedCampusDirectory, extractGroundedScholarshipClaims, synthesizeAnswer } = require('../src/core/groundedAnswerGenerator');
const { runPhase1DeterministicPipeline, handleInboundMessage } = require('../src/core/orchestrator');
const { generateFeeAnswer } = require('../src/core/feeCalculationEngine');
const { evaluateRecommendation } = require('../src/reasoning/recommendationEngine');
const { generateGroundedCatalogSummary } = require('../src/core/academicCatalog');
const { decomposeQuery, decomposeQueryAsync, hasMultipleIntents } = require('../src/core/multiIntentResolver');

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
      const candidates = await retrieveCandidates(plan, { topK: 25 });
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

  describe('3. Case 3: Semantic Audience & Lifecycle Gate (PMB Schedule vs Enrolled Operations)', () => {

    test('3a. Enrolled student operational calendar chunk is rejected for PMB intake schedule inquiry', () => {
      const frame = resolveSemanticFrame('Jadwal pendaftaran PMB 2026/2027');
      const plan = buildRetrievalPlan(frame);

      const enrolledCalendarCandidate = {
        sourceFile: 'Kalender Akademik Ganjil, Genap dan Antara TA 2025-2026 (1).pdf',
        filename: 'Kalender Akademik Ganjil, Genap dan Antara TA 2025-2026 (1).pdf',
        text: '04 - 05 Feb. : Pendaftaran Remedial SMT Ganjil T.A. 2025/2026\n16 - 21 Feb. : Minggu Tenang SMT Genap T.A. 2025/2026',
        chunk: '04 - 05 Feb. : Pendaftaran Remedial SMT Ganjil T.A. 2025/2026\n16 - 21 Feb. : Minggu Tenang SMT Genap T.A. 2025/2026',
        docCategory: 'AKADEMIK'
      };

      const evalResult = evaluateEvidenceCompatibility(enrolledCalendarCandidate, plan);
      expect(evalResult.accepted).toBe(false);
      expect(evalResult.disposition).toBe('REJECT_LIFECYCLE_MISMATCH');
    });

    test('3b. Prospective admission schedule presents verified 4 stages without date hallucination', async () => {
      const frame = resolveSemanticFrame('Kapan jadwal pendaftaran PMB 2026/2027?');
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { topK: 12 });
      const arbitrated = arbitrateEvidence(candidates, plan);
      const fallback = buildGenericExtractiveFallback(frame, arbitrated.accepted, arbitrated);

      expect(fallback.success).toBe(true);
      expect(fallback.answer).toContain('2026/2027');
      expect(fallback.answer).toContain('Masa Pendaftaran');
      expect(fallback.answer).toContain('Testing');
      expect(fallback.answer).toContain('Pengumuman');
      expect(fallback.answer).toContain('Masa Registrasi Ulang');
      expect(fallback.answer).toContain('https://pmb.stikom-bali.ac.id');
      // Must not fabricate arbitrary calendar dates
      expect(fallback.answer).not.toMatch(/\b\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+2026\s*s\/?d/i);
    });

  });

  describe('4. Case 4: Structural Claim Binding for Scholarships & Atomic Passage Curation', () => {

    test('4a. curateCandidatePassages purges yudisium and 2001 foundation noise while preserving active student research grant', () => {
      const plan = {
        domain: 'SCHOLARSHIP',
        intent: 'SCHOLARSHIP_INQUIRY',
        requiredAspects: ['scholarship']
      };

      const noisyCandidate = {
        sourceFile: 'ISIAN WEBSITE (1).pdf',
        text: 'Ringkasan dokumen:\nBatas akhir pendaftaran yudisium periode XXXVIII adalah 25 Juli 2026.\nITB STIKOM Bali berdiri pada tahun 2001.\nWorkshop bagi dosen, beasiswa riset untuk mahasiswa, dan kuliah tamu internasional.\nKetentuan konversi SKS alih jenjang maksimal 60 SKS.',
        chunk: 'Ringkasan dokumen:\nBatas akhir pendaftaran yudisium periode XXXVIII adalah 25 Juli 2026.\nITB STIKOM Bali berdiri pada tahun 2001.\nWorkshop bagi dosen, beasiswa riset untuk mahasiswa, dan kuliah tamu internasional.\nKetentuan konversi SKS alih jenjang maksimal 60 SKS.'
      };

      const curated = curateCandidatePassages(noisyCandidate, plan);
      expect(curated.curatedText).toBeDefined();
      expect(curated.curatedText).toContain('beasiswa riset untuk mahasiswa');
      expect(curated.curatedText).not.toContain('yudisium');
      expect(curated.curatedText).not.toContain('2001');
      expect(curated.curatedText).not.toContain('konversi SKS');
    });

    test('4b. extractGroundedScholarshipClaims binds S1 & Dual Degree UTB DPP discount Rp 3.000.000,- on Gelombang Khusus', async () => {
      const frame = resolveSemanticFrame('Beasiswa apa saja yang tersedia di kampus ITB STIKOM Bali?');
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { topK: 25 });
      const arbitrated = arbitrateEvidence(candidates, plan);

      const claims = extractGroundedScholarshipClaims(arbitrated.accepted);
      expect(claims.dppDiscounts.length).toBeGreaterThan(0);

      const s1Claim = claims.dppDiscounts.find(d => /S1 Sistem Informasi/i.test(d.programs));
      expect(s1Claim).toBeDefined();
      expect(s1Claim.nominal).toBe('Rp 3.000.000,-');
      expect(s1Claim.wave).toBe('Gelombang Khusus');
    });

    test('4c. Extractive fallback presents bound claims structured without non-scholarship operational noise', async () => {
      const frame = resolveSemanticFrame('Beasiswa apa saja yang tersedia di kampus ITB STIKOM Bali?');
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { topK: 25 });
      const arbitrated = arbitrateEvidence(candidates, plan);
      const fallback = buildGenericExtractiveFallback(frame, arbitrated.accepted, arbitrated);

      expect(fallback.success).toBe(true);
      expect(fallback.answer).toContain('Rp 3.000.000,-');
      expect(fallback.answer).toContain('Gelombang Khusus');
      expect(fallback.answer).toContain('Beasiswa Riset Mahasiswa Aktif');
      expect(fallback.answer).not.toContain('yudisium');
      expect(fallback.answer).not.toContain('berdiri pada tahun 2001');
      expect(fallback.answer).not.toContain('konversi SKS');
    });

    test('4d. Multi-program structural claim binding binds exact DPP discounts and avoids cross-program contamination', () => {
      // Load official fee evidence units across all 5 programs directly from canonical snapshot
      const fs = require('fs');
      const corpusChunks = JSON.parse(fs.readFileSync('data/runtime/index_snapshots/2026-10-26T08-00-00-000Z_reconciled-official-faculty/rag_index.json', 'utf8'));

      const skChunks = corpusChunks.filter(c => c.id === '564b4435-846b-43b4-9bd6-930b2768dfdb' || c.id === '4d0dba51-d1ee-4216-8a33-e987e61fc6f6');
      const d3Chunks = corpusChunks.filter(c => c.id === '550d76f6-7da8-42a5-9437-30e79603012e' || c.id === '40b2d661-fa6a-4cc2-b6e3-c62059f5898c' || c.id === 'eb036039-ea42-4f68-9c23-0254d92bb74d');
      const s1Chunk = corpusChunks.find(c => c.id === 'eb2e3662-bfd9-4769-93a9-cff2dcd48cde');
      const utbChunks = corpusChunks.filter(c => c.id === 'e9305567-48d9-4aa4-8d77-aa113ec5c6e5' || c.id === 'f7a4e65c-ab74-4737-aded-47494b1316ca');
      const helpChunk = corpusChunks.find(c => c.id === '5acebacd-b354-45a4-bc14-4e7425961ebb');

      const allEvidence = [...skChunks, ...d3Chunks, s1Chunk, ...utbChunks, helpChunk];
      const claims = extractGroundedScholarshipClaims(allEvidence);

      // S1 SK claims
      const skKhusus = claims.dppDiscounts.find(d => /Sistem Komputer/i.test(d.programs) && d.wave === 'Gelombang Khusus');
      const skG1 = claims.dppDiscounts.find(d => /Sistem Komputer/i.test(d.programs) && d.wave === 'Gelombang I');
      expect(skKhusus).toBeDefined();
      expect(skKhusus.nominal).toBe('Rp 2.000.000,-');
      expect(skG1).toBeDefined();
      expect(skG1.nominal).toBe('Rp 1.000.000,-');

      // D3 Manajemen Informatika claims
      const d3Khusus = claims.dppDiscounts.find(d => /D3 Manajemen Informatika/i.test(d.programs) && d.wave === 'Gelombang Khusus');
      const d3G1 = claims.dppDiscounts.find(d => /D3 Manajemen Informatika/i.test(d.programs) && d.wave === 'Gelombang I');
      expect(d3Khusus).toBeDefined();
      expect(d3Khusus.nominal).toBe('Rp 2.000.000,-');
      expect(d3G1).toBeDefined();
      expect(d3G1.nominal).toBe('Rp 1.000.000,-');

      // S1 SI, TI, BD claims
      const s1Khusus = claims.dppDiscounts.find(d => /S1 Sistem Informasi/i.test(d.programs) && d.wave === 'Gelombang Khusus');
      expect(s1Khusus).toBeDefined();
      expect(s1Khusus.nominal).toBe('Rp 3.000.000,-');

      // Dual Degree UTB claims
      const utbKhusus = claims.dppDiscounts.find(d => /Dual Degree UTB/i.test(d.programs) && d.wave === 'Gelombang Khusus');
      expect(utbKhusus).toBeDefined();
      expect(utbKhusus.nominal).toBe('Rp 3.000.000,-');

      // International Dual Degree HELP/DNUI claims
      const ddHelpKhusus = claims.dppDiscounts.find(d => /International Dual Degree/i.test(d.programs) && d.wave === 'Gelombang Khusus');
      expect(ddHelpKhusus).toBeDefined();
      expect(ddHelpKhusus.nominal).toBe('Rp 10.000.000,-');

      // Cross-program non-contamination checks
      const allSkClaims = claims.dppDiscounts.filter(d => /Sistem Komputer/i.test(d.programs));
      expect(allSkClaims.some(d => d.nominal === 'Rp 3.000.000,-')).toBe(false);
      expect(allSkClaims.some(d => d.nominal === 'Rp 10.000.000,-')).toBe(false);

      const allD3Claims = claims.dppDiscounts.filter(d => /D3 Manajemen Informatika/i.test(d.programs));
      expect(allD3Claims.some(d => d.nominal === 'Rp 3.000.000,-')).toBe(false);
      expect(allD3Claims.some(d => d.nominal === 'Rp 10.000.000,-')).toBe(false);

      const allS1Claims = claims.dppDiscounts.filter(d => /S1 Sistem Informasi/i.test(d.programs));
      expect(allS1Claims.some(d => d.nominal === 'Rp 2.000.000,-' && d.wave === 'Gelombang Khusus')).toBe(false);
      expect(allS1Claims.some(d => d.nominal === 'Rp 10.000.000,-')).toBe(false);
    });

  });

  describe('5. Case 5: Generic Layout-Driven Campus Directory & Contact Isolation', () => {

    test('5a. extractGroundedCampusDirectory accurately extracts Jimbaran address, phone (0361) 8953534, and hotline 081288778840', async () => {
      const frame = resolveSemanticFrame('Dimana lokasi kampus jimbaran dan berapa nomor kontaknya?');
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { topK: 20 });
      const arbitrated = arbitrateEvidence(candidates, plan);

      const dir = extractGroundedCampusDirectory(arbitrated.accepted);
      expect(dir.jimbaran).toBeDefined();
      expect(dir.jimbaran.address).toContain('Kampus Udayana');
      expect(dir.jimbaran.phone).toBe('(0361) 8953534');
      expect(dir.jimbaran.hotline).toBe('081288778840');
    });

    test('5b. Strict Contact Isolation: Jimbaran inquiry contains ZERO reference to Abiansemal phone or hotline', async () => {
      const frame = resolveSemanticFrame('Dimana lokasi kampus jimbaran dan berapa nomor kontaknya?');
      const plan = buildRetrievalPlan(frame);
      const candidates = await retrieveCandidates(plan, { topK: 20 });
      const arbitrated = arbitrateEvidence(candidates, plan);
      const fallback = buildGenericExtractiveFallback(frame, arbitrated.accepted, arbitrated);

      expect(fallback.success).toBe(true);
      expect(fallback.answer).toContain('Kampus Jimbaran');
      expect(fallback.answer).toContain('Jl. Raya Kampus Udayana');
      expect(fallback.answer).toContain('(0361) 8953534');
      expect(fallback.answer).toContain('081288778840');

      // STRICT ISOLATION: Must NOT leak Abiansemal contacts
      expect(fallback.answer).not.toContain('4790925');
      expect(fallback.answer).not.toContain('082145099633');
      expect(fallback.answer).not.toContain('Blahkiuh');
      expect(fallback.answer).not.toContain('Janger');
    });

  });

  describe('6. Case 6: Cross-Domain Non-Interference', () => {

    test('6a. Tuition fee calculation remains accurate for S1 Sistem Informasi', () => {
      const res = generateFeeAnswer('Berapa biaya kuliah S1 Sistem Informasi?');
      expect(res.success).toBe(true);
      expect(res.answer).toContain('Sistem Informasi');
      expect(res.answer).toMatch(/Rp\s*[\d\.]+/);
    });

    test('6b. Academic recommendation engine operates without interference', () => {
      const rec = evaluateRecommendation('Saya suka coding dan ingin jadi programmer software');
      expect(rec.scoredCandidates.length).toBeGreaterThan(0);
      expect(rec.scoredCandidates.some(c => /Teknologi Informasi|Sistem Informasi|Manajemen Informatika/.test(c.canonicalName))).toBe(true);
    });

    test('6c. Academic catalog listing operates cleanly without interference', () => {
      const catalog = generateGroundedCatalogSummary('S1', 'id');
      expect(catalog).toContain('S1 Sistem Informasi');
      expect(catalog).toContain('S1 Teknologi Informasi');
      expect(catalog).toContain('S1 Bisnis Digital');
      expect(catalog).toContain('S1 Sistem Komputer');
    });

  });

  describe('7. Case 7: November 1 Grounding & RAG Regression Validation', () => {

    test('7a. Beasiswa DPP D3: Query answers Rp 2.000.000 and never outputs Biaya Registrasi Rp 10.000.000 as scholarship', async () => {
      const query = 'Berapa beasiswa DPP D3 Manajemen Informatika pada Gelombang Khusus?';
      const frame = resolveSemanticFrame(query);
      expect(frame.domain).toBe('SCHOLARSHIP');
      expect(frame.intent).toBe('SCHOLARSHIP_INQUIRY');

      const res = await runPhase1DeterministicPipeline('test_d3_scholarship', query, {
        syncOnly: true,
        fastFallback: true,
        sessionSnapshot: { data: {} }
      });

      expect(res.intent).toBe('SCHOLARSHIP_INQUIRY');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toContain('Rp 2.000.000');
      expect(res.finalAnswer).toContain('Gelombang Khusus');
      expect(res.finalAnswer).toContain('D3 Manajemen Informatika');
      // Must NOT conflate registration fee with scholarship amount
      expect(res.finalAnswer).not.toContain('Biaya Registrasi (Jas, Topi, GMTI) Dasar: Rp 10.000.000');
      expect(res.finalAnswer).not.toContain('Total Kewajiban Biaya Registrasi Bersih: Rp 8.000.000');
    });

    test('7b. D3 Registration Fee Guard: Querying registration fee still produces Rp 10.000.000', () => {
      const res = generateFeeAnswer('Berapa biaya registrasi D3 Manajemen Informatika?');
      expect(res.success).toBe(true);
      expect(res.answer).toContain('D3 Manajemen Informatika');
      expect(res.answer).toContain('10.000.000');
    });

    test('7c. Tahapan PMB: Query classifies as PMB and returns 4 official stages from Kalender Pendaftaran', async () => {
      const query = 'Apa saja tahapan pendaftaran mahasiswa baru TA 2026/2027?';
      const frame = resolveSemanticFrame(query);
      expect(frame.domain).toBe('PMB');
      expect(frame.intent).toBe('ADMISSION_SCHEDULE');

      const res = await runPhase1DeterministicPipeline('test_pmb_stages', query, {
        syncOnly: true,
        fastFallback: true,
        sessionSnapshot: { data: {} }
      });

      expect(res.intent).toBe('ADMISSION_SCHEDULE');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toContain('Masa Pendaftaran');
      expect(res.finalAnswer).toContain('Testing');
      expect(res.finalAnswer).toContain('Pengumuman');
      expect(res.finalAnswer).toContain('Masa Registrasi Ulang');
      expect(res.finalAnswer).toContain('https://pmb.stikom-bali.ac.id');
      // Must not return thesis / proposal or ungrounded fallback
      expect(res.finalAnswer).not.toContain('skripsi');
      expect(res.finalAnswer).not.toContain('Tugas Akhir');
      expect(res.finalAnswer).not.toContain('belum dapat dipastikan secara lengkap');
    });

    test('7d. Beasiswa Lintas Prodi: Returns DPP discounts for S1 SI/TI/BD, S1 SK, and D3 MI bound to their programs', async () => {
      const query = 'Sebutkan potongan beasiswa DPP per prodi';
      const frame = resolveSemanticFrame(query);
      expect(frame.domain).toBe('SCHOLARSHIP');
      expect(frame.intent).toBe('SCHOLARSHIP_INQUIRY');

      const res = await runPhase1DeterministicPipeline('test_multi_scholarship', query, {
        syncOnly: true,
        fastFallback: true,
        sessionSnapshot: { data: {} }
      });

      expect(res.intent).toBe('SCHOLARSHIP_INQUIRY');
      expect(res.finalAnswer).toBeDefined();

      // S1 SI/TI/BD claim
      expect(res.finalAnswer).toContain('S1 Sistem Informasi, S1 Teknologi Informasi, dan S1 Bisnis Digital');
      expect(res.finalAnswer).toContain('Rp 3.000.000,-');

      // S1 SK claim
      expect(res.finalAnswer).toContain('S1 Sistem Komputer');
      expect(res.finalAnswer).toContain('Rp 2.000.000,-');

      // D3 MI claim
      expect(res.finalAnswer).toContain('D3 Manajemen Informatika');
      expect(res.finalAnswer).toContain('Rp 2.000.000,-');
    });

    test('7e. Regression Guard: Thesis proposal registration remains in ACADEMIC_CURRICULUM', () => {
      const frame = resolveSemanticFrame('Bagaimana prosedur pendaftaran proposal skripsi?');
      expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
      expect(frame.intent).toBe('THESIS_REQUIREMENTS');

      const frame2 = resolveSemanticFrame('Syarat pendaftaran tugas akhir apa saja?');
      expect(frame2.domain).toBe('ACADEMIC_CURRICULUM');
      expect(frame2.intent).toBe('THESIS_REQUIREMENTS');
    });

    test('7f. Regression Guard: S1 tuition fee and existing fee calculations remain intact', () => {
      const res = generateFeeAnswer('Berapa biaya kuliah S1 Sistem Informasi Gelombang Khusus?');
      expect(res.success).toBe(true);
      expect(res.answer).toContain('S1 Sistem Informasi');
      expect(res.answer).toContain('Gelombang Khusus');
      expect(res.answer).toContain('DPP');
    });

  });


  describe('8. Case 8: Scholarship Stacking & Combination Precedence (November 1 Hardening)', () => {

    test('8a. Stacking handler must take precedence over Fee Engine even if frame has TUITION_FEE / fee aspect', async () => {
      const stackingQuery = 'Apakah potongan gelombang bisa digabung dengan tambahan 60%?';
      const artificialFeeFrame = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        rawQuery: stackingQuery,
        entities: [],
        aspects: ['fee']
      };

      const res = await synthesizeAnswer(artificialFeeFrame, { accepted: [{ text: 'SK PMB' }] });
      expect(res.source).toBe('discount_stacking_fail_closed');
      expect(res.answer).not.toContain('Rincian biaya pendidikan di ITB STIKOM Bali T.A 2026/2027 berbeda tergantung pada program studi');
      expect(res.answer).not.toContain('S1 Sistem Informasi, Teknologi Informasi, & Bisnis Digital');
      expect(res.answer).toContain('SOURCE_GAP');
      expect(res.answer).toContain('SMK TI Bali Global');
      expect(res.answer).toContain('SMK Pandawa Bali Global');
    });

    test('8b. Model semantic parser domain must NOT override stacking inquiry to TUITION_FEE_INQUIRY', async () => {
      const stackingQuery = 'Apakah potongan gelombang bisa digabung dengan tambahan 60%?';
      const mockClient = {
        chat: {
          completions: {
            create: async () => ({
              choices: [{
                message: {
                  content: JSON.stringify({
                    speechAct: 'INQUIRE_PROPERTY',
                    primaryIntent: 'TUITION_FEE_INQUIRY',
                    userInterest: 'potongan gelombang',
                    semanticConcepts: ['FINANCIAL_COST'],
                    candidateEntities: [],
                    requestedAspects: ['fee'],
                    scopeConstraints: {
                      academicLevel: null,
                      studyMode: null,
                      locationConstraint: null,
                      locationScope: 'GENERAL'
                    },
                    contextDependency: {
                      isFollowUp: true,
                      referenceType: 'anaphoric',
                      topicContinuity: 'CONTINUATION',
                      relevantPriorContext: 'beasiswa'
                    },
                    executionRoute: 'RAG_RETRIEVAL',
                    confidence: 0.95,
                    ambiguityLevel: 'LOW'
                  })
                }
              }]
            })
          }
        }
      };

      const frame = await resolveSemanticFrameAsync(stackingQuery, {}, { client: mockClient });
      expect(frame.domain).toBe('SCHOLARSHIP');
      expect(frame.intent).toBe('SCHOLARSHIP_INQUIRY');
      expect(frame.aspects).toContain('scholarship');
    });

    test('8c. Follow-up preserves valid active program entity when supported by conversation context', async () => {
      const sessionData = {
        activeDomain: 'SCHOLARSHIP',
        activeIntent: 'SCHOLARSHIP_INQUIRY',
        activeEntity: 'S1 Sistem Komputer',
        lastQuery: 'Apakah ada beasiswa tambahan 60% untuk S1 Sistem Komputer?',
        lastAnswer: 'Tambahan beasiswa 60% untuk S1 Sistem Komputer tersedia pada Gelombang Khusus.',
        conversationHistory: [
          { role: 'user', content: 'Apakah ada beasiswa tambahan 60% untuk S1 Sistem Komputer?' },
          { role: 'assistant', content: 'Tambahan beasiswa 60% untuk S1 Sistem Komputer tersedia pada Gelombang Khusus.' }
        ]
      };

      const query = 'Apakah potongan gelombang bisa digabung dengan tambahan 60%?';
      const contextDep = evaluateContextDependency(query, sessionData);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.inheritedDomain).toBe('SCHOLARSHIP');
      expect(contextDep.inheritedEntity).toBe('S1 Sistem Komputer');

      const res = await runPhase1DeterministicPipeline('test_stacking_inherited', query, {
        syncOnly: true,
        fastFallback: true,
        sessionSnapshot: { data: sessionData }
      });

      expect(res.finalAnswer).toContain('S1 Sistem Komputer');
      expect(res.finalAnswer).toContain('SMK TI Bali Global');
      expect(res.finalAnswer).toContain('SOURCE_GAP');
    });

    test('8d. Ambiguous broad scholarship context clarifies programs without forced S1 Sistem Komputer lock', async () => {
      const sessionData = {
        activeDomain: 'SCHOLARSHIP',
        activeIntent: 'SCHOLARSHIP_INQUIRY',
        activeEntity: null,
        lastQuery: 'Beasiswa apa saja yang tersedia di ITB STIKOM Bali?',
        lastAnswer: 'Berikut informasi beasiswa: S1 SI/TI/BD, S1 Sistem Komputer, D3 Manajemen Informatika.',
        conversationHistory: [
          { role: 'user', content: 'Beasiswa apa saja yang tersedia di ITB STIKOM Bali?' },
          { role: 'assistant', content: 'Berikut informasi beasiswa: S1 SI/TI/BD, S1 Sistem Komputer, D3 Manajemen Informatika.' }
        ]
      };

      const query = 'Apakah potongan gelombang bisa digabung dengan tambahan 60%?';
      const frame = resolveSemanticFrame(query, sessionData);
      expect(frame.entities.length).toBe(0); // Not forcefully locked to S1 SK

      const res = await runPhase1DeterministicPipeline('test_stacking_ambiguous', query, {
        syncOnly: true,
        fastFallback: true,
        sessionSnapshot: { data: sessionData }
      });

      expect(res.finalAnswer).toContain('S1 Sistem Komputer');
      expect(res.finalAnswer).toContain('D3 Manajemen Informatika');
      expect(res.finalAnswer).toContain('silakan sebutkan program studi yang dimaksud');
      expect(res.finalAnswer).not.toContain('Rincian biaya pendidikan di ITB STIKOM Bali T.A 2026/2027 berbeda');
    });

    test('8e. Stacking inquiry strictly prevents default Gelombang II multi-program simulation', async () => {
      const query = 'Apakah potongan gelombang bisa digabung dengan tambahan 60%?';
      const res = await runPhase1DeterministicPipeline('test_no_wave2_simulation', query, {
        syncOnly: true,
        fastFallback: true,
        sessionSnapshot: { data: {} }
      });

      expect(res.finalAnswer).not.toContain('Gelombang II');
      expect(res.finalAnswer).not.toContain('Dana Pendidikan Pokok (DPP): Rp 12.500.000');
      expect(res.finalAnswer).not.toContain('Biaya Pendidikan Per Semester: Rp 6.500.000');
      expect(res.finalAnswer).toContain('SOURCE_GAP');
      // Direct statement that combination rules are not officially verified; zero allow/disallow conclusion
      expect(res.finalAnswer).toContain('belum terverifikasi secara resmi');
      expect(res.finalAnswer).not.toContain('bisa digabung');
      expect(res.finalAnswer).not.toContain('dapat digabung');
      expect(res.finalAnswer).not.toContain('tidak bisa digabung');
      expect(res.finalAnswer).not.toContain('tidak boleh digabung');
    });

    test('8f. Standard tuition fee inquiries remain completely functional through Fee Engine', () => {
      const res1 = generateFeeAnswer('Berapa biaya pendaftaran Gelombang II?');
      expect(res1.success).toBe(true);
      expect(res1.answer).toContain('Biaya pendaftaran');

      const res2 = generateFeeAnswer('Berapa biaya kuliah S1 Sistem Komputer?');
      expect(res2.success).toBe(true);
      expect(res2.answer).toContain('S1 Sistem Komputer');
      expect(res2.answer).toContain('DPP');
    });

  });

  describe('9. Case 9: Career Center & Job Guarantee Safety Hardening (Tahap A)', () => {

    test('9a. Job guarantee query does NOT produce affirmative "Ya" or claim guaranteed jobs; explicitly states company hiring authority from FAQ CC', async () => {
      const q = 'Apakah ITB STIKOM Bali menjamin lulusan langsung dapat kerja?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('CAREER_CENTER');
      expect(frame.intent).toBe('CAREER_CENTER_INQUIRY');
      expect(frame.aspects).toContain('job_guarantee');

      const res = await runPhase1DeterministicPipeline('career_t1', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      // Must NOT extract raw "Jawaban: Ya" from unrelated FAQs
      expect(res.finalAnswer).not.toMatch(/^Jawaban:\s*Ya/im);
      expect(res.finalAnswer).not.toContain('Jawaban:Ya');
      // Grounded in official FAQ CC: "proses penerimaan kerja tetap menjadi kewenangan perusahaan berdasarkan hasil seleksi"
      expect(res.finalAnswer).toContain('kewenangan perusahaan berdasarkan hasil seleksi');
      expect(res.finalAnswer).toContain('tidak memberikan jaminan');
      // Must communicate verified Career Center facilitation services without false promises
      expect(res.finalAnswer).toContain('Career Development Center');
      expect(res.finalAnswer).toContain('Job Fair');
      expect(res.finalAnswer).toContain('Magang Industri');
      // Verification must pass as factual / safe
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('9b. Career guidance and consultation inquiry correctly utilizes CDC services without job guarantee claims', async () => {
      const q = 'Apakah ada bimbingan karier di ITB STIKOM Bali?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('CAREER_CENTER');
      expect(frame.intent).toBe('CAREER_CENTER_INQUIRY');

      const res = await runPhase1DeterministicPipeline('career_t2', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toContain('Career Center');
      expect(res.finalAnswer).not.toContain('menjamin 100%');
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('9c. Internship program inquiry correctly returns internship information from official documents', async () => {
      const q = 'Apakah ada program magang di ITB STIKOM Bali?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('CAREER_CENTER');
      expect(frame.intent).toBe('CAREER_CENTER_INQUIRY');

      const res = await runPhase1DeterministicPipeline('career_t3', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer.toLowerCase()).toContain('magang');
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('9d. Job fair inquiry correctly returns campus job fair info without cross-contaminating unrelated FAQ answers', async () => {
      const q = 'Apakah ada job fair di kampus?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('CAREER_CENTER');
      expect(frame.intent).toBe('CAREER_CENTER_INQUIRY');

      const res = await runPhase1DeterministicPipeline('career_t4', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer.toLowerCase()).toMatch(/job\s*fair|career|rekrutmen|perusahaan/);
      expect(res.finalAnswer).not.toMatch(/^Jawaban:\s*Ya[.!?]?$/m);
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('9e. Safety Verifier Gate: Verifier strictly blocks any answer claiming unsupported affirmative job guarantee', () => {
      const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
      const frame = {
        rawQuery: 'Apakah ITB STIKOM Bali menjamin lulusan langsung dapat kerja?',
        domain: 'CAREER_CENTER',
        intent: 'CAREER_CENTER_INQUIRY',
        aspects: ['job_guarantee']
      };

      // Case 1: Bad answer claiming "Jawaban: Ya" as affirmative guarantee
      const badAnswer1 = 'Jawaban: Ya. ITB STIKOM Bali menjamin lulusan pasti langsung bekerja setelah lulus kuliah.';
      const verif1 = verifyFinalAnswer(badAnswer1, frame, []);
      expect(verif1.pass).toBe(false);
      expect(verif1.reason).toBe('unsupported_job_guarantee_affirmation');

      // Case 2: Good answer stating company selection authority and no guarantee
      const goodAnswer = 'Dokumen resmi menegaskan bahwa proses penerimaan kerja tetap menjadi kewenangan perusahaan berdasarkan hasil seleksi. Kampus tidak memberikan jaminan otomatis bekerja.';
      const verif2 = verifyFinalAnswer(goodAnswer, frame, []);
      expect(verif2.reason).not.toBe('unsupported_job_guarantee_affirmation');
    });

    test('9f. Non-Career Regression Guard: Scholarship stacking and tuition fee inquiries remain completely functional', async () => {
      // Stacking query remains fail-closed to SOURCE_GAP
      const stackQuery = 'Apakah potongan gelombang bisa digabung dengan tambahan 60%?';
      const resStack = await runPhase1DeterministicPipeline('reg_stack', stackQuery, {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(resStack.finalAnswer).toContain('SOURCE_GAP');
      expect(resStack.finalAnswer).not.toContain('Biaya Pendidikan Per Semester: Rp 6.500.000');

      // Standard fee query remains accurate
      const feeRes = generateFeeAnswer('Berapa biaya kuliah Sistem Informasi Gelombang 1?');
      expect(feeRes.success).toBe(true);
      expect(feeRes.answer).toContain('S1 Sistem Informasi');
      expect(feeRes.answer).toContain('Gelombang I');
    });

    // =========================================================================
    // 10. Case 10: Business Incubator (INBIS) & Entrepreneurship Safety Hardening (Tahap B)
    // =========================================================================

    test('10a. INBIS Overview: "Apa itu INBIS di ITB STIKOM Bali?" returns verified identity, 2014 SK, and top 4 national recognition', async () => {
      const q = 'Apa itu INBIS di ITB STIKOM Bali?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('CAMPUS_SERVICE');
      expect(frame.intent).toBe('CAMPUS_SERVICE_INQUIRY');
      expect(frame.aspects).not.toContain('facilities');

      const res = await runPhase1DeterministicPipeline('inbis_10a', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toContain('Inkubator Bisnis');
      expect(res.finalAnswer).toContain('2014');
      expect(res.finalAnswer).toMatch(/4\s+Lembaga\s+Inkubator\s+Bisnis\s+Terbaik|Kemenkop/i);
      expect(res.finalAnswer).not.toContain('domain_aspect_mismatch_facilities_answered_with_double_degree');
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('10b. INBIS Services: "Layanan apa saja yang disediakan Inkubator Bisnis?" returns mentoring, coworking space, and legality assistance', async () => {
      const q = 'Layanan apa saja yang disediakan Inkubator Bisnis?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('CAMPUS_SERVICE');
      expect(frame.intent).toBe('CAMPUS_SERVICE_INQUIRY');

      const res = await runPhase1DeterministicPipeline('inbis_10b', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/mentor|mentoring/i);
      expect(res.finalAnswer).toMatch(/coworking\s+space|ruang\s+kerja/i);
      expect(res.finalAnswer).toMatch(/legalitas|badan\s+usaha|pendanaan/i);
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('10c. Tenant Programs: "Program apa yang tersedia bagi tenant INBIS?" returns Start-Learn-Growth incubation phases', async () => {
      const q = 'Program apa yang tersedia bagi tenant INBIS?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('CAMPUS_SERVICE');
      expect(frame.intent).toBe('CAMPUS_SERVICE_INQUIRY');
      expect(frame.aspects).toContain('tenant_programs');

      const res = await runPhase1DeterministicPipeline('inbis_10c', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Pra-?Inkubasi/i);
      expect(res.finalAnswer).toMatch(/Inkubasi/i);
      expect(res.finalAnswer).toMatch(/Pasca-?Inkubasi/i);
      expect(res.finalAnswer).toMatch(/Start-?Learn-?Growth/i);
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('10d. P2MW Relation: "Apa hubungan INBIS dengan P2MW?" returns student teams GOWJUS, Sehabit, and Dikerajinin', async () => {
      const q = 'Apa hubungan INBIS dengan P2MW?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('CAMPUS_SERVICE');
      expect(frame.intent).toBe('CAMPUS_SERVICE_INQUIRY');
      expect(frame.aspects).toContain('p2mw');

      const res = await runPhase1DeterministicPipeline('inbis_10d', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/P2MW|Program\s+Pembinaan\s+Wirausaha\s+Mahasiswa/i);
      expect(res.finalAnswer).toContain('GOWJUS');
      expect(res.finalAnswer).toContain('Sehabit');
      expect(res.finalAnswer).toContain('Dikerajinin');
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('10e. Paraphrased Query without "INBIS": "program wirausaha pemula di kampus" correctly routes to INBIS profile', async () => {
      const q = 'program wirausaha pemula di kampus';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('CAMPUS_SERVICE');
      expect(frame.intent).toBe('CAMPUS_SERVICE_INQUIRY');

      const res = await runPhase1DeterministicPipeline('inbis_10e', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toContain('Inkubator Bisnis');
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('10f. Facility Isolation: Facility queries do not trigger false Double Degree verifier errors', async () => {
      const q = 'Apa saja fasilitas di kampus ITB STIKOM Bali?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('FACILITY_INQUIRY');

      const res = await runPhase1DeterministicPipeline('inbis_10f', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.verification.reason).not.toBe('domain_aspect_mismatch_facilities_answered_with_double_degree');
    });

    test('10g. Double Degree Non-Interference: National Double Degree inquiries remain strictly protected', async () => {
      const q = 'Bagaimana program National Dual Degree di ITB STIKOM Bali?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('INTERNATIONAL');

      const res = await runPhase1DeterministicPipeline('inbis_10g', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Universitas\s+Teknologi\s+Bandung|UTB/i);
      expect(res.finalAnswer).not.toContain('Universitas Teknologi Bali');
    });

    test('10h. Regression Guard: Career/CDC (Tahap A) and Scholarship Stacking remain completely functional', async () => {
      // Career job guarantee safety check
      const jobQ = 'Apakah ITB STIKOM Bali menjamin lulusan langsung dapat kerja?';
      const jobRes = await runPhase1DeterministicPipeline('inbis_10h_job', jobQ, {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(jobRes.finalAnswer).not.toMatch(/^Jawaban:\s*Ya[.!?]?$/m);
      expect(jobRes.finalAnswer).toContain('kewenangan perusahaan');

      // Scholarship stacking check
      const stackQ = 'Apakah potongan gelombang bisa digabung dengan tambahan 60%?';
      const stackRes = await runPhase1DeterministicPipeline('inbis_10h_stack', stackQ, {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(stackRes.finalAnswer).toContain('SOURCE_GAP');
      expect(stackRes.finalAnswer).not.toContain('Biaya Pendidikan Per Semester: Rp 6.500.000');
    });

    // =========================================================================
    // 11. Case 11: Academic Program Definition & Multi-Entity Comparison Integrity (Tahap C)
    // =========================================================================

    test('11a. Bisnis Digital Definition Integrity: "Apa itu program studi Bisnis Digital?" contains zero Sistem Komputer contamination', async () => {
      const q = 'Apa itu program studi Bisnis Digital?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.entities.map(e => e.canonical)).toContain('S1 Bisnis Digital');

      const res = await runPhase1DeterministicPipeline('prog_11a', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/bisnis berbasis digital|e-commerce/i);
      // Strict negative assertions against Sistem Komputer contamination
      expect(res.finalAnswer).not.toMatch(/\b(embedded system|robotika|mikrocontroller|perangkat elektronik|robot)\b/i);
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('11b. Bisnis Digital Paraphrase: "Tolong jelaskan prodi Bisnis Digital" returns clean BD competencies without cross-prodi noise', async () => {
      const q = 'Tolong jelaskan prodi Bisnis Digital';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.entities.map(e => e.canonical)).toContain('S1 Bisnis Digital');

      const res = await runPhase1DeterministicPipeline('prog_11b', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/digital marketing|e-commerce|bisnis digital/i);
      expect(res.finalAnswer).not.toMatch(/\b(robotika|embedded system)\b/i);
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('11c. Sistem Komputer Subjects: "Apa yang dipelajari mahasiswa Sistem Komputer?" retains hardware/IoT curriculum', async () => {
      const q = 'Apa yang dipelajari mahasiswa Sistem Komputer?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
      expect(frame.entities.map(e => e.canonical)).toContain('S1 Sistem Komputer');

      const res = await runPhase1DeterministicPipeline('prog_11c', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Sistem Komputer/i);
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
    });

    test('11d. Program Comparison (SI vs TI): "Apa perbedaan Sistem Informasi dan Teknologi Informasi?" covers both programs factually', async () => {
      const q = 'Apa perbedaan Sistem Informasi dan Teknologi Informasi?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('PROGRAM_COMPARISON');
      const canEnts = frame.entities.map(e => e.canonical);
      expect(canEnts).toContain('S1 Sistem Informasi');
      expect(canEnts).toContain('S1 Teknologi Informasi');

      const res = await runPhase1DeterministicPipeline('prog_11d', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      // Both entities must be present
      expect(res.finalAnswer).toMatch(/Sistem Informasi/i);
      expect(res.finalAnswer).toMatch(/Teknologi Informasi/i);
      // Highlights key grounded focus for both
      expect(res.finalAnswer).toMatch(/IT Security|Integrator Sistem|infrastruktur/i);
      expect(res.finalAnswer).toMatch(/analisis|database|bisnis/i);
      // Verifier passes without multi_entity_missing_supported_entity_in_answer
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
      expect(res.verification.reason).not.toMatch(/multi_entity_missing_supported_entity/i);
    });

    test('11e. Program Comparison (TI vs Bisnis Digital): "Apa perbedaan TI dan Bisnis Digital?" covers both programs factually', async () => {
      const q = 'Apa perbedaan TI dan Bisnis Digital?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('PROGRAM_COMPARISON');
      const canEnts = frame.entities.map(e => e.canonical);
      expect(canEnts).toContain('S1 Teknologi Informasi');
      expect(canEnts).toContain('S1 Bisnis Digital');

      const res = await runPhase1DeterministicPipeline('prog_11e', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Teknologi Informasi/i);
      expect(res.finalAnswer).toMatch(/Bisnis Digital/i);
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
      expect(res.verification.reason).not.toMatch(/multi_entity_missing_supported_entity/i);
    });

    test('11f. Multi-Program Comparison (3 prodi): "Bandingkan prodi Sistem Informasi, Teknologi Informasi, dan Sistem Komputer" covers all 3 programs', async () => {
      const q = 'Bandingkan prodi Sistem Informasi, Teknologi Informasi, dan Sistem Komputer';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('PROGRAM_COMPARISON');
      const canEnts = frame.entities.map(e => e.canonical);
      expect(canEnts).toContain('S1 Sistem Informasi');
      expect(canEnts).toContain('S1 Teknologi Informasi');
      expect(canEnts).toContain('S1 Sistem Komputer');

      const res = await runPhase1DeterministicPipeline('prog_11f', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Sistem Informasi/i);
      expect(res.finalAnswer).toMatch(/Teknologi Informasi/i);
      expect(res.finalAnswer).toMatch(/Sistem Komputer/i);
      expect(res.verification.pass || res.verification.handledSafely).toBe(true);
      expect(res.verification.reason).not.toMatch(/multi_entity_missing_supported_entity/i);
    });

    test('11g. Regression Guard: Career/CDC (Tahap A), INBIS (Tahap B), and Discount Stacking remain 100% intact', async () => {
      // Tahap A
      const jobRes = await runPhase1DeterministicPipeline('guard_11g_job', 'Apakah ITB STIKOM Bali menjamin lulusan langsung dapat kerja?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(jobRes.finalAnswer).not.toMatch(/^Jawaban:\s*Ya[.!?]?$/m);
      expect(jobRes.finalAnswer).toContain('kewenangan perusahaan');

      // Tahap B
      const inbisRes = await runPhase1DeterministicPipeline('guard_11g_inbis', 'Apa itu INBIS di ITB STIKOM Bali?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(inbisRes.finalAnswer).toContain('Inkubator Bisnis');
      expect(inbisRes.finalAnswer).toContain('2014');

      // Discount Stacking
      const stackRes = await runPhase1DeterministicPipeline('guard_11g_stack', 'Apakah potongan gelombang bisa digabung dengan tambahan 60%?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(stackRes.finalAnswer).toContain('SOURCE_GAP');
    });

  });

  describe('12. Case 12: Multi-Intent Subquery Context Isolation & Decomposition (Tahap D)', () => {

    test('12a. Zero Cross-Contamination: "Di mana lokasi kampus Renon dan ada beasiswa apa saja?"', async () => {
      const q = 'Di mana lokasi kampus Renon dan ada beasiswa apa saja?';
      expect(hasMultipleIntents(q)).toBe(true);

      const subFrames = decomposeQuery(q, {});
      expect(subFrames.length).toBe(2);

      // Subquery 1: Kampus Renon
      expect(subFrames[0].domain).toBe('FACILITIES');
      expect(subFrames[0].intent).toBe('CAMPUS_LOCATION');
      const f1Entities = subFrames[0].entities.map(e => e.canonical);
      expect(f1Entities).toContain('Kampus Denpasar (Renon)');
      expect(f1Entities).not.toContain('Kampus ITB STIKOM Bali');

      // Subquery 2: Beasiswa (Must NOT inherit Kampus Denpasar (Renon))
      expect(subFrames[1].domain).toBe('SCHOLARSHIP');
      expect(subFrames[1].intent).toBe('SCHOLARSHIP_INQUIRY');
      const f2Entities = subFrames[1].entities.map(e => e.canonical);
      expect(f2Entities).not.toContain('Kampus Denpasar (Renon)');
      expect(f2Entities).not.toContain('Kampus ITB STIKOM Bali');

      const res = await runPhase1DeterministicPipeline('multi_12a', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.subQueryResults.length).toBe(2);
      expect(res.finalAnswer).toMatch(/Puputan.*Renon/i);
      expect(res.finalAnswer).toMatch(/beasiswa|potongan/i);
      expect(res.subQueryResults[0].verification.pass || res.subQueryResults[0].verification.handledSafely).toBe(true);
      expect(res.subQueryResults[1].verification.pass || res.subQueryResults[1].verification.handledSafely).toBe(true);
      expect(res.subQueryResults[0].verification.reason).not.toMatch(/multi_entity_missing_supported_entity/i);
    });

    test('12b. Independent Academic & Admission: "Apa perbedaan Sistem Informasi dan bagaimana cara mendaftar?"', async () => {
      const q = 'Apa perbedaan Sistem Informasi dan bagaimana cara mendaftar?';
      expect(hasMultipleIntents(q)).toBe(true);

      const subFrames = decomposeQuery(q, {});
      expect(subFrames.length).toBe(2);

      expect(subFrames[0].entities.map(e => e.canonical)).toContain('S1 Sistem Informasi');
      // Subquery 2 is general procedure, should not be locked into S1 Sistem Informasi
      expect(subFrames[1].domain).toBe('PMB');
      expect(subFrames[1].intent).toBe('ADMISSION_PROCEDURE');

      const res = await runPhase1DeterministicPipeline('multi_12b', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.subQueryResults.length).toBe(2);
      expect(res.finalAnswer).toMatch(/Sistem Informasi/i);
      expect(res.finalAnswer).toMatch(/pendaftaran|PMB/i);
      expect(res.subQueryResults[0].verification.pass || res.subQueryResults[0].verification.handledSafely).toBe(true);
      expect(res.subQueryResults[1].verification.pass || res.subQueryResults[1].verification.handledSafely).toBe(true);
    });

    test('12c. Facility Safe Gap & Double Degree Independence: "Jelaskan fasilitas kampus Jimbaran dan program Double Degree"', async () => {
      const q = 'Jelaskan fasilitas kampus Jimbaran dan program Double Degree';
      expect(hasMultipleIntents(q)).toBe(true);

      const subFrames = decomposeQuery(q, {});
      expect(subFrames.length).toBe(2);

      expect(subFrames[0].entities.map(e => e.canonical)).toContain('Kampus Jimbaran');
      expect(subFrames[1].entities.map(e => e.canonical)).toContain('International Dual Degree');

      const res = await runPhase1DeterministicPipeline('multi_12c', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.subQueryResults.length).toBe(2);
      // Subquery 1 handled as safe corpus gap without crashing
      expect(res.subQueryResults[0].verification.handledSafely).toBe(true);
      // Subquery 2 verified factual
      expect(res.subQueryResults[1].verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.finalAnswer).toMatch(/Dual Degree|HELP UNIVERSITY/i);
    });

    test('12d. Service Coordination: "Apa itu INBIS dan bagaimana layanan Career Center?"', async () => {
      const q = 'Apa itu INBIS dan bagaimana layanan Career Center?';
      expect(hasMultipleIntents(q)).toBe(true);

      const subFrames = decomposeQuery(q, {});
      expect(subFrames.length).toBe(2);

      expect(subFrames[0].domain).toBe('CAMPUS_SERVICE');
      expect(subFrames[0].entities.map(e => e.canonical)).toContain('Inkubator Bisnis (INBIS)');
      expect(subFrames[1].domain).toBe('CAREER_CENTER');
      expect(subFrames[1].entities.map(e => e.canonical)).toContain('Career Development Center (CDC)');

      const res = await runPhase1DeterministicPipeline('multi_12d', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.subQueryResults.length).toBe(2);
      expect(res.finalAnswer).toMatch(/Inkubator Bisnis/i);
      expect(res.finalAnswer).toMatch(/Career Center/i);
      expect(res.subQueryResults[0].verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.subQueryResults[1].verification.outcome).toBe('VERIFIED_FACTUAL');
    });

    test('12e. Greeting Guard & 3-Way Compound with Anaphora: "Halo kak, mau tanya lokasi kampus Renon di mana ya, terus kalau mau daftar prodi TI syaratnya apa dan biayanya berapa?"', async () => {
      const q = 'Halo kak, mau tanya lokasi kampus Renon di mana ya, terus kalau mau daftar prodi TI syaratnya apa dan biayanya berapa?';
      expect(hasMultipleIntents(q)).toBe(true);

      const subFrames = decomposeQuery(q, {});
      expect(subFrames.length).toBe(3);

      // Part 1: Greeting guard allows query to route to FACILITIES
      expect(subFrames[0].domain).toBe('FACILITIES');
      expect(subFrames[0].intent).toBe('CAMPUS_LOCATION');
      expect(subFrames[0].entities.map(e => e.canonical)).toContain('Kampus Denpasar (Renon)');

      // Part 2: Admission TI
      expect(subFrames[1].domain).toBe('PMB');
      expect(subFrames[1].entities.map(e => e.canonical)).toContain('S1 Teknologi Informasi');

      // Part 3: Tuition Fee TI inherited via anaphoric 'biayanya'
      expect(subFrames[2].domain).toBe('TUITION_FEE');
      expect(subFrames[2].entities.map(e => e.canonical)).toContain('S1 Teknologi Informasi');

      const res = await runPhase1DeterministicPipeline('multi_12e', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.subQueryResults.length).toBe(3);
      expect(res.subQueryResults[0].verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.subQueryResults[1].verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.subQueryResults[2].verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.finalAnswer).toMatch(/Puputan.*Renon/i);
      expect(res.finalAnswer).toMatch(/Teknologi Informasi/i);
      expect(res.finalAnswer).toMatch(/Biaya Kuliah S1 Teknologi Informasi/i);
    });

    test('12f. Tuition Fee & Campus Location: "Berapa biaya kuliah di Sistem Informasi dan di mana lokasi kampus Jimbaran?"', async () => {
      const q = 'Berapa biaya kuliah di Sistem Informasi dan di mana lokasi kampus Jimbaran?';
      expect(hasMultipleIntents(q)).toBe(true);

      const subFrames = decomposeQuery(q, {});
      expect(subFrames.length).toBe(2);

      expect(subFrames[0].domain).toBe('TUITION_FEE');
      expect(subFrames[0].entities.map(e => e.canonical)).toContain('S1 Sistem Informasi');
      expect(subFrames[1].domain).toBe('FACILITIES');
      expect(subFrames[1].entities.map(e => e.canonical)).toContain('Kampus Jimbaran');

      const res = await runPhase1DeterministicPipeline('multi_12f', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.subQueryResults.length).toBe(2);
      expect(res.subQueryResults[0].verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.subQueryResults[1].verification.outcome).toBe('PARTIAL');
      expect(res.subQueryResults[1].verification.sourceGap).toBe(true);
      expect(res.finalAnswer).toMatch(/Biaya Kuliah S1 Sistem Informasi/i);
      expect(res.finalAnswer).toMatch(/Kampus Udayana.*Jimbaran/i);
    });

    test('12g. Program Strengths & Career Prospects Anaphora: "Apa keunggulan prodi Bisnis Digital dan apa saja prospek kerjanya?"', async () => {
      const q = 'Apa keunggulan prodi Bisnis Digital dan apa saja prospek kerjanya?';
      expect(hasMultipleIntents(q)).toBe(true);

      const subFrames = decomposeQuery(q, {});
      expect(subFrames.length).toBe(2);

      expect(subFrames[0].entities.map(e => e.canonical)).toContain('S1 Bisnis Digital');
      // Subquery 2 inherits S1 Bisnis Digital via anaphora 'prospek kerjanya'
      expect(subFrames[1].entities.map(e => e.canonical)).toContain('S1 Bisnis Digital');

      const res = await runPhase1DeterministicPipeline('multi_12g', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.subQueryResults.length).toBe(2);
      expect(res.subQueryResults[0].verification.pass || res.subQueryResults[0].verification.handledSafely).toBe(true);
      expect(res.subQueryResults[1].verification.pass || res.subQueryResults[1].verification.handledSafely).toBe(true);
      expect(res.finalAnswer).toMatch(/Bisnis Digital/i);
    });

    test('12h. Fee Inquiry & Unsupported Program Safe Refusal: "Berapa biaya pendaftaran dan apakah ada jurusan teknik nuklir?"', async () => {
      const q = 'Berapa biaya pendaftaran dan apakah ada jurusan teknik nuklir?';
      expect(hasMultipleIntents(q)).toBe(true);

      const subFrames = decomposeQuery(q, {});
      expect(subFrames.length).toBe(2);

      expect(subFrames[0].domain).toBe('TUITION_FEE');
      expect(subFrames[1].domain).toBe('UNSUPPORTED_PROGRAM');

      const res = await runPhase1DeterministicPipeline('multi_12h', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.subQueryResults.length).toBe(2);
      expect(res.subQueryResults[0].verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.subQueryResults[1].verification.outcome).toBe('SAFE_UNKNOWN');
      expect(res.subQueryResults[1].verification.reason).toBe('unsupported_program_safe_refusal');
      expect(res.finalAnswer).toMatch(/Tarif biaya pendaftaran/i);
      expect(res.finalAnswer).toMatch(/teknik nuklir.*tidak diselenggarakan/i);
    });

    test('12i. Regression Guard: Prior Tahap A, B, C and Stacking remain 100% functional', async () => {
      // Prior Tahap A
      const jobRes = await runPhase1DeterministicPipeline('guard_12i_job', 'Apakah ITB STIKOM Bali menjamin lulusan langsung dapat kerja?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(jobRes.finalAnswer).toContain('kewenangan perusahaan');

      // Prior Tahap B
      const inbisRes = await runPhase1DeterministicPipeline('guard_12i_inbis', 'Apa itu INBIS di ITB STIKOM Bali?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(inbisRes.finalAnswer).toContain('Inkubator Bisnis');

      // Prior Tahap C
      const compRes = await runPhase1DeterministicPipeline('guard_12i_comp', 'Apa perbedaan Sistem Informasi dan Teknologi Informasi?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(compRes.finalAnswer).toMatch(/Sistem Informasi/i);
      expect(compRes.finalAnswer).toMatch(/Teknologi Informasi/i);

      // Discount Stacking
      const stackRes = await runPhase1DeterministicPipeline('guard_12i_stack', 'Apakah potongan gelombang bisa digabung dengan tambahan 60%?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(stackRes.finalAnswer).toContain('SOURCE_GAP');
    });

  });


  describe('Case 13: Tahap E — Perbaikan Fasilitas Kampus dan Small Talk / Identitas Bot', () => {

    test('13a. General Campus Facilities: "Apa saja fasilitas ITB STIKOM Bali?"', async () => {
      const q = 'Apa saja fasilitas ITB STIKOM Bali?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('FACILITY_INQUIRY');

      const res = await runPhase1DeterministicPipeline('test_13a', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.finalAnswer).toMatch(/Laboratorium & Sarana Praktikum/i);
      expect(res.finalAnswer).toMatch(/Inkubator Bisnis \(INBIS\)/i);
      expect(res.finalAnswer).toMatch(/Career Development Center \(CDC\)/i);
    });

    test('13b. Renon Campus Facilities: "Apa saja fasilitas kampus Renon?"', async () => {
      const q = 'Apa saja fasilitas kampus Renon?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('FACILITY_INQUIRY');
      expect(frame.targetBranch).toBe('renon');

      const res = await runPhase1DeterministicPipeline('test_13b', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.finalAnswer).toMatch(/Fasilitas resmi penunjang perkuliahan/i);
      expect(res.finalAnswer).toMatch(/Laboratorium Hardware/i);
    });

    test('13c. Branch Isolation & Lab Gap Jimbaran: "Apakah ada laboratorium komputer di Jimbaran?"', async () => {
      const q = 'Apakah ada laboratorium komputer di Jimbaran?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('FACILITY_INQUIRY');
      expect(frame.targetBranch).toBe('jimbaran');
      expect(frame.entities.map(e => e.canonical)).toContain('Kampus Jimbaran');

      const res = await runPhase1DeterministicPipeline('test_13c', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.verification.outcome).toBe('PARTIAL');
      expect(res.verification.sourceGap).toBe(true);
      // Verifies official Jimbaran location and contact disclosure
      expect(res.finalAnswer).toMatch(/Kampus Jimbaran/i);
      expect(res.finalAnswer).toMatch(/Jl\. Raya Kampus Udayana/i);
      expect(res.finalAnswer).toMatch(/8953534|081288778840/);
      // Verifies explicit unrecorded lab gap statement without claiming it definitively doesn't exist
      expect(res.finalAnswer).toMatch(/belum tercantum dalam panduan resmi/i);
    });

    test('13d. Branch Isolation & Facility Gap Abiansemal: "Apa fasilitas kampus Abiansemal?"', async () => {
      const q = 'Apa fasilitas kampus Abiansemal?';
      const frame = resolveSemanticFrame(q, {});
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('FACILITY_INQUIRY');
      expect(frame.targetBranch).toBe('abiansemal');
      expect(frame.entities.map(e => e.canonical)).toContain('Kampus Abiansemal');

      const res = await runPhase1DeterministicPipeline('test_13d', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.verification.outcome).toBe('PARTIAL');
      expect(res.verification.sourceGap).toBe(true);
      expect(res.finalAnswer).toMatch(/Kampus Abiansemal/i);
      expect(res.finalAnswer).toMatch(/belum tercantum dalam panduan resmi/i);
    });

    test('13e. Non-Interference: INBIS & Career Center Distinct Grounding', async () => {
      // INBIS service inquiry
      const inbisRes = await runPhase1DeterministicPipeline('test_13e_inbis', 'Apa layanan INBIS?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(inbisRes.verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(inbisRes.finalAnswer).toMatch(/Inkubator Bisnis \(INBIS\)/i);
      expect(inbisRes.finalAnswer).toMatch(/Mentoring & Pendampingan Bisnis/i);

      // CDC service inquiry
      const cdcRes = await runPhase1DeterministicPipeline('test_13e_cdc', 'Apa fasilitas dan layanan Career Center?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(cdcRes.verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(cdcRes.finalAnswer).toMatch(/Career Development Center \(CDC\)/i);
      expect(cdcRes.finalAnswer).toMatch(/Bursa Kerja & Campus Hiring/i);
    });

    test('13f. Bot Identity: Tiko & Creator/Developer Inquiries', async () => {
      // Identity
      const identityFrame = resolveSemanticFrame('Kamu siapa?', {});
      expect(identityFrame.domain).toBe('CONVERSATIONAL');
      expect(identityFrame.intent).toBe('BOT_IDENTITY');

      const identityTurn = await handleInboundMessage({ from: '628100000001', body: 'Kamu siapa?' });
      expect(identityTurn.turnResult.finalAnswer).toMatch(/Tiko/i);
      expect(identityTurn.turnResult.finalAnswer).toMatch(/asisten (?:virtual|informasi) resmi ITB STIKOM Bali/i);

      // Creator
      const creatorFrame = resolveSemanticFrame('Siapa yang membuat kamu?', {});
      expect(creatorFrame.domain).toBe('CONVERSATIONAL');
      expect(creatorFrame.intent).toBe('BOT_IDENTITY');

      const creatorTurn = await handleInboundMessage({ from: '628100000002', body: 'Siapa yang membuat kamu?' });
      expect(creatorTurn.turnResult.finalAnswer).toMatch(/Tiko/i);
      expect(creatorTurn.turnResult.finalAnswer).toMatch(/ITB STIKOM Bali/i);
    });

    test('13g. Conversational Small Talk: Greeting, How Are You, Thanks, Farewell', async () => {
      // Greeting
      const gFrame = resolveSemanticFrame('Selamat pagi.', {});
      expect(gFrame.domain).toBe('CONVERSATIONAL');
      expect(gFrame.intent).toBe('CONVERSATIONAL_GREETING');

      // How are you
      const hFrame = resolveSemanticFrame('Apa kabar?', {});
      expect(hFrame.domain).toBe('CONVERSATIONAL');
      expect(hFrame.intent).toBe('CONVERSATIONAL_SMALL_TALK');

      const hTurn = await handleInboundMessage({ from: '628100000003', body: 'Apa kabar?' });
      expect(hTurn.turnResult.finalAnswer).toMatch(/Kabar baik/i);

      // Acknowledgement / Thanks
      const thxFrame = resolveSemanticFrame('Terima kasih.', {});
      expect(thxFrame.domain).toBe('CONVERSATIONAL');
      expect(thxFrame.intent).toBe('CONVERSATIONAL_ACKNOWLEDGEMENT');

      const thxTurn = await handleInboundMessage({ from: '628100000004', body: 'Terima kasih.' });
      expect(thxTurn.turnResult.finalAnswer).toMatch(/Sama-sama/i);

      // Farewell
      const byeFrame = resolveSemanticFrame('Sampai jumpa.', {});
      expect(byeFrame.domain).toBe('CONVERSATIONAL');
      expect(byeFrame.intent).toBe('CONVERSATIONAL_FAREWELL');

      const byeTurn = await handleInboundMessage({ from: '628100000005', body: 'Sampai jumpa.' });
      expect(byeTurn.turnResult.finalAnswer).toMatch(/Sampai jumpa/i);
    });

    test('13h. Greeting followed by Factual Query: Seamless RAG Passthrough', async () => {
      const q = 'Halo kak, mau tanya apa itu Sistem Informasi?';
      const frame = resolveSemanticFrame(q, {});
      // Greeting prefix does not halt RAG
      expect(frame.intent).toBe('PROGRAM_OVERVIEW');
      expect(frame.entities.map(e => e.canonical)).toContain('S1 Sistem Informasi');

      const res = await runPhase1DeterministicPipeline('test_13h', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.finalAnswer).toMatch(/Sistem Informasi/i);
    });

    test('13i. Regression Guard: Prior Tahap A, B, C, D and Stacking remain 100% functional', async () => {
      // Tahap A
      const jobRes = await runPhase1DeterministicPipeline('guard_13i_job', 'Apakah ITB STIKOM Bali menjamin lulusan langsung dapat kerja?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(jobRes.finalAnswer).toContain('kewenangan perusahaan');

      // Tahap B
      const inbisRes = await runPhase1DeterministicPipeline('guard_13i_inbis', 'Apa itu INBIS di ITB STIKOM Bali?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(inbisRes.finalAnswer).toContain('Inkubator Bisnis');

      // Tahap C
      const compRes = await runPhase1DeterministicPipeline('guard_13i_comp', 'Apa perbedaan Sistem Informasi dan Teknologi Informasi?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(compRes.finalAnswer).toMatch(/Sistem Informasi/i);
      expect(compRes.finalAnswer).toMatch(/Teknologi Informasi/i);

      // Tahap D
      const multiRes = await runPhase1DeterministicPipeline('guard_13i_multi', 'Di mana lokasi kampus Renon dan ada beasiswa apa saja?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(multiRes.subQueryResults.length).toBe(2);

      // Discount Stacking
      const stackRes = await runPhase1DeterministicPipeline('guard_13i_stack', 'Apakah potongan gelombang bisa digabung dengan tambahan 60%?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(stackRes.finalAnswer).toContain('SOURCE_GAP');
    });

    test('13j. Async & Sync Multi-Intent Parity: CDC query preserved as single query while compound queries decompose', async () => {
      const cdcQuery = 'Apa fasilitas dan layanan Career Center?';
      expect(hasMultipleIntents(cdcQuery)).toBe(false);
      const syncCDC = decomposeQuery(cdcQuery);
      const asyncCDC = await decomposeQueryAsync(cdcQuery);
      expect(syncCDC.length).toBe(1);
      expect(asyncCDC.length).toBe(1);
      expect(syncCDC[0].rawQuery || syncCDC[0].query).toBe(cdcQuery);
      expect(asyncCDC[0].rawQuery || asyncCDC[0].query).toBe(cdcQuery);

      const compoundQuery = 'Di mana lokasi kampus Renon dan ada beasiswa apa saja?';
      const syncCompound = decomposeQuery(compoundQuery);
      const asyncCompound = await decomposeQueryAsync(compoundQuery);
      expect(syncCompound.length).toBe(2);
      expect(asyncCompound.length).toBe(2);
      // Scholarship subquery must not be polluted with Kampus Renon entity
      const syncSub2 = syncCompound[1].rawQuery || syncCompound[1].query || '';
      const asyncSub2 = asyncCompound[1].rawQuery || asyncCompound[1].query || '';
      expect(syncSub2.toLowerCase()).not.toContain('renon');
      expect(asyncSub2.toLowerCase()).not.toContain('renon');
    });

    test('13k. International Double Degree Fallback: HELP and DNUI evidence isolation', () => {
      // HELP University
      const helpFallback = buildGenericExtractiveFallback(
        { rawQuery: 'Bagaimana program dual degree HELP University?' },
        [{
          text: 'Program Internasional Dual Degree bekerjasama dengan HELP University Malaysia untuk S1 Sistem Informasi. Lulusan memperoleh dua gelar yaitu S.Kom dan Bachelor of Information Technology (BIT). Perkuliahan 4 tahun diselesaikan di kampus ITB STIKOM Bali.',
          source: 'brosur_internasional_help.pdf'
        }]
      );
      expect(helpFallback.answer).toContain('HELP University');
      expect(helpFallback.answer).toContain('Malaysia');
      expect(helpFallback.answer).toContain('S1 Sistem Informasi');
      expect(helpFallback.answer).toContain('S.Kom');
      expect(helpFallback.answer).toContain('BIT');
      expect(helpFallback.answer).not.toContain('Dalian');
      expect(helpFallback.answer).not.toContain('China');
      expect(helpFallback.answer).not.toContain('DNUI');
      expect(helpFallback.answer).not.toContain('Bisnis Digital');

      // DNUI (Dalian Neusoft)
      const dnuiFallback = buildGenericExtractiveFallback(
        { rawQuery: 'Bagaimana program dual degree DNUI?' },
        [{
          text: 'Program International Dual Degree bersama Dalian Neusoft University of Information (DNUI) China pada Program Studi S1 Bisnis Digital. Gelar yang diperoleh S.Bns dan Bachelor of Management (BM). Skema perkuliahan: Tahun 1-2 di Bali, Tahun 3 online, Tahun 4 di Dalian China dengan fasilitas asrama gratis.',
          source: 'brosur_internasional_dnui.pdf'
        }]
      );
      expect(dnuiFallback.answer).toContain('Dalian Neusoft University of Information (DNUI)');
      expect(dnuiFallback.answer).toContain('China');
      expect(dnuiFallback.answer).toContain('S1 Bisnis Digital');
      expect(dnuiFallback.answer).toContain('S.Bns');
      expect(dnuiFallback.answer).toContain('Bachelor of Management');
      expect(dnuiFallback.answer).toContain('BM');
      expect(dnuiFallback.answer).toContain('asrama');
      expect(dnuiFallback.answer).toContain('gratis');
      expect(dnuiFallback.answer).not.toContain('HELP');
      expect(dnuiFallback.answer).not.toContain('Malaysia');
      expect(dnuiFallback.answer).not.toContain('Sistem Informasi');
      expect(dnuiFallback.answer).not.toContain('BIT');
    });

    test('13l. Unsupported Study Program: Safe rejection with official program listing', async () => {
      const q = 'Apakah ITB STIKOM Bali membuka jurusan kedokteran?';
      const res = await runPhase1DeterministicPipeline('test_13l_unsupported', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toMatch(/tidak di?selenggarakan/i);
      expect(res.finalAnswer).toMatch(/kedokteran/i);
      // Official programs listed accurately
      expect(res.finalAnswer).toMatch(/S1 Sistem Informasi/i);
      expect(res.finalAnswer).toMatch(/S1 Sistem Komputer/i);
      expect(res.finalAnswer).toMatch(/S1 Teknologi Informasi/i);
      expect(res.finalAnswer).toMatch(/S1 Bisnis Digital/i);
      expect(res.finalAnswer).toMatch(/D3 Manajemen Informatika/i);
    });

  });

  describe('14. Case 14: November 1 WhatsApp Production Hardening', () => {

    test('14a. BOT_IDENTITY precedence: "Halo, kamu siapa?" and "Hai siapa kamu" answer Tiko identity, plain greetings answer greeting', async () => {
      const f1 = resolveSemanticFrame('Halo, kamu siapa?');
      expect(f1.domain).toBe('CONVERSATIONAL');
      expect(f1.intent).toBe('BOT_IDENTITY');

      const f2 = resolveSemanticFrame('Halo');
      expect(f2.domain).toBe('CONVERSATIONAL');
      expect(f2.intent).toBe('CONVERSATIONAL_GREETING');

      const f3 = resolveSemanticFrame('Hai siapa kamu');
      expect(f3.domain).toBe('CONVERSATIONAL');
      expect(f3.intent).toBe('BOT_IDENTITY');

      const res1 = await runPhase1DeterministicPipeline('test_14a_identity', 'Halo, kamu siapa?', {
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(res1.finalAnswer).toMatch(/Tiko/i);
      expect(res1.finalAnswer).toMatch(/asisten virtual resmi/i);
      expect(res1.finalAnswer).toMatch(/ITB STIKOM Bali/i);
    });

    test('14b. Context Resolution: DNUI session does NOT leak to general new student admission stages', async () => {
      const dnuiSession = {
        activeEntity: 'Double Degree DNUI',
        activeDomain: 'INTERNATIONAL',
        academicYear: '2026/2027'
      };

      const qGeneral = 'Apa saja tahapan pendaftaran mahasiswa baru TA 2026/2027?';
      const frameGeneral = resolveSemanticFrame(qGeneral, dnuiSession);
      expect(frameGeneral.domain).toBe('PMB');
      expect(frameGeneral.entities.some(e => (e.canonical || '').includes('DNUI'))).toBe(false);

      const resGeneral = await runPhase1DeterministicPipeline('test_14b_pmb', qGeneral, {
        sessionSnapshot: { chatId: 'test_14b_pmb', data: dnuiSession },
        fastFallback: true,
        disableExternalLlm: true
      });
      expect(resGeneral.finalAnswer).toMatch(/penerimaan mahasiswa baru|pmb/i);
      expect(resGeneral.finalAnswer).toMatch(/masa pendaftaran/i);
      expect(resGeneral.finalAnswer).not.toMatch(/DNUI|Dalian Neusoft|China/i);

      // Program-specific anaphoric inquiry must retain DNUI context
      const qSpecific = 'Bagaimana tahapan pendaftaran program tersebut?';
      const frameSpecific = resolveSemanticFrame(qSpecific, dnuiSession);
      expect(frameSpecific.domain).toBe('INTERNATIONAL');
      expect(frameSpecific.entities.some(e => (e.canonical || '').includes('DNUI'))).toBe(true);
    });

    test('14c. Multi-Intent INBIS: "Apakah ada inkubator bisnis dan apa layanannya?" answers without contradictory refusal', async () => {
      const q = 'Apakah ada inkubator bisnis dan apa layanannya?';
      const res = await runPhase1DeterministicPipeline('test_14c_inbis', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toMatch(/Inkubator Bisnis|INBIS/i);
      expect(res.finalAnswer).toMatch(/Mentoring|Pendampingan/i);
      expect(res.finalAnswer).toMatch(/startup|ruang kerja|coworking/i);
      // Invariant: Must NOT contain contradictory out-of-domain scope refusal
      expect(res.finalAnswer).not.toMatch(/di luar cakupan layanan informasi kampus kami/i);

    });

    test('14d. Program Comparison: Sistem Informasi vs Teknologi Informasi renders balanced key differences and symmetric profiles', async () => {
      const q = 'Apa perbedaan Sistem Informasi dan Teknologi Informasi?';
      const res = await runPhase1DeterministicPipeline('test_14d_comp', q, {
        fastFallback: true,
        disableExternalLlm: true
      });

      expect(res.finalAnswer).toMatch(/S1 Teknologi Informasi/i);
      expect(res.finalAnswer).toMatch(/S1 Sistem Informasi/i);
      expect(res.finalAnswer).toMatch(/Perbedaan Utama/i);

      // S1 TI profile symmetry: core focus, competencies, labs, and graduate professions
      expect(res.finalAnswer).toMatch(/pengelolaan infrastruktur TI|software & hardware/i);
      expect(res.finalAnswer).toMatch(/IT Security|Integrator Sistem|Technopreneurship/i);
      expect(res.finalAnswer).toMatch(/Laboratorium Penunjang/i);
      expect(res.finalAnswer).toMatch(/Laboratorium Hardware.*Laboratorium Database/i);
      expect(res.finalAnswer).toMatch(/Analisis & Pengembangan ICT/i);
      expect(res.finalAnswer).toMatch(/Praktisi ICT/i);
      expect(res.finalAnswer).toMatch(/Technopreneur di bidang teknologi informasi/i);
      // Negative assertion: no ungrounded / hallucinated profession
      expect(res.finalAnswer).not.toMatch(/Cyber Security Specialist/i);

      // S1 SI profile: competencies, subjects, and careers
      expect(res.finalAnswer).toMatch(/merancang.*mengembangkan.*sistem informasi/i);
      expect(res.finalAnswer).toMatch(/Analisis sistem.*database.*business intelligence/i);
      expect(res.finalAnswer).toMatch(/Business Analyst|System Analyst/i);

      // Both programs must appear under Perbedaan Utama as concise synthesis
      const parts = res.finalAnswer.split(/Perbedaan Utama:?/i);
      expect(parts.length).toBeGreaterThan(1);
      const diffSection = parts[1];
      expect(diffSection).toMatch(/S1 Teknologi Informasi/i);
      expect(diffSection).toMatch(/S1 Sistem Informasi/i);
      expect(diffSection).toMatch(/IT Security|Integrator Sistem/i);
      expect(diffSection).toMatch(/enterprise systems|tata kelola informasi/i);
    });

    test('14e. Mixed Campus + Non-Campus Isolation: Targeted refusal footnote without contradictory campus rejection', async () => {
      const qMixed = 'Berapa biaya kuliah TI dan bagaimana resep nasi goreng?';
      const resMixed = await runPhase1DeterministicPipeline('test_14e_mixed', qMixed, {
        fastFallback: true,
        disableExternalLlm: true
      });

      // Grounded campus tuition answer is preserved completely
      expect(resMixed.finalAnswer).toMatch(/Rincian Biaya Kuliah S1 Teknologi Informasi/i);
      expect(resMixed.finalAnswer).toMatch(/Dana Pendidikan Pokok \(DPP\): Rp 14\.000\.000/i);
      expect(resMixed.finalAnswer).toMatch(/Biaya Pendidikan Per Semester: Rp 6\.500\.000/i);

      // Targeted footnote specifically cites the non-campus clause
      expect(resMixed.finalAnswer).toMatch(/Catatan: Mengenai pertanyaan di luar informasi kampus \("bagaimana resep nasi goreng"\)/i);
      expect(resMixed.finalAnswer).toMatch(/layanan ini khusus menyediakan informasi resmi seputar ITB STIKOM Bali/i);

      // Invariant: Must NOT contain blanket refusal that rejects the entire user inquiry
      expect(resMixed.finalAnswer).not.toMatch(/Pertanyaan Anda berada di luar cakupan layanan informasi kampus kami/i);
    });

    test('14f. Pure Out-Of-Domain Inquiry: Pure non-campus inquiry receives full institutional refusal disclaimer', async () => {
      const qPure = 'Bagaimana resep nasi goreng?';
      const resPure = await runPhase1DeterministicPipeline('test_14f_pure_ood', qPure, {
        fastFallback: true,
        disableExternalLlm: true
      });

      // Pure OOD inquiry retains the full institutional refusal disclaimer
      expect(resPure.finalAnswer).toMatch(/Mohon maaf, layanan ini khusus melayani informasi seputar akademik, PMB, program studi, biaya kuliah, dan fasilitas ITB STIKOM Bali/i);
      expect(resPure.finalAnswer).toMatch(/Pertanyaan Anda berada di luar cakupan layanan informasi kampus kami/i);
      // Zero campus fee or program content leaked into pure OOD
      expect(resPure.finalAnswer).not.toMatch(/Biaya Pendidikan/i);
    });

    test('14g. Evidence Arbiter Intent Isolation: PROGRAM_COMPARISON deprioritizes ORMAWA while PROGRAM_OVERVIEW and DEFINITION preserve exact legacy ranking', () => {
      const candOrmawa = {
        id: 'chunk-ormawa',
        text: 'PROFILE HIMPUNAN MAHASISWA PROGRAM STUDI TEKNOLOGI INFORMASI ITB STIKOM Bali',
        sourceFile: 'BUKU ORMAWA HIMAPRODI TI.docx',
        supportedEntities: ['S1 Teknologi Informasi'],
        docCategory: 'ormawa'
      };

      const candAuth = {
        id: 'chunk-auth',
        text: 'Deskripsi Singkat Program Studi Teknologi Informasi Fokus pada pengelolaan infrastruktur TI software & hardware',
        sourceFile: 'ISIAN WEBSITE (1).pdf',
        supportedEntities: ['S1 Teknologi Informasi'],
        docCategory: 'academic_program'
      };

      // 1. PROGRAM_COMPARISON sorts authoritative profile ahead of ORMAWA
      const planComp = {
        intent: 'PROGRAM_COMPARISON',
        domain: 'ACADEMIC_PROGRAM',
        targetEntities: ['S1 Teknologi Informasi'],
        requiredAspects: ['overview']
      };
      const arbComp = arbitrateEvidence([candOrmawa, candAuth], planComp);
      expect(arbComp.accepted.length).toBe(2);
      expect(arbComp.accepted[0].id).toBe('chunk-auth');
      expect(arbComp.accepted[1].id).toBe('chunk-ormawa');

      // 2. PROGRAM_OVERVIEW preserves legacy sorting behavior without ORMAWA deprioritization
      const candA = {
        id: 'chunk-a',
        text: 'Fokus Pendidikan Program Studi Teknologi Informasi',
        sourceFile: 'file_a.pdf',
        supportedEntities: ['S1 Teknologi Informasi']
      };
      const candB = {
        id: 'chunk-b',
        text: 'Penjelasan Prodi Teknologi Informasi dan kurikulum',
        sourceFile: 'file_b.pdf',
        supportedEntities: ['S1 Teknologi Informasi']
      };
      const planOverview = {
        intent: 'PROGRAM_OVERVIEW',
        domain: 'ACADEMIC_PROGRAM',
        targetEntities: ['S1 Teknologi Informasi'],
        requiredAspects: ['overview']
      };
      const arbOverview = arbitrateEvidence([candA, candB], planOverview);
      expect(arbOverview.accepted[0].id).toBe('chunk-a');
      expect(arbOverview.accepted[1].id).toBe('chunk-b');

      // 3. DEFINITION preserves legacy sorting behavior
      const planDef = {
        intent: 'DEFINITION',
        domain: 'ACADEMIC_PROGRAM',
        targetEntities: ['S1 Teknologi Informasi'],
        requiredAspects: ['overview']
      };
      const arbDef = arbitrateEvidence([candA, candB], planDef);
      expect(arbDef.accepted[0].id).toBe('chunk-a');
      expect(arbDef.accepted[1].id).toBe('chunk-b');
    });

  });

  describe('Case 15: Conversational Ellipsis & Academic Curriculum Context Continuity', () => {

    const bdSessionData = {
      activeDomain: 'ACADEMIC_PROGRAM',
      activeIntent: 'PROGRAM_OVERVIEW',
      activeEntity: 'S1 Bisnis Digital',
      lastQuery: 'Apa itu Bisnis Digital?',
      lastAnswer: 'Program Studi S1 Bisnis Digital ITB STIKOM Bali...',
      conversationHistory: [
        { role: 'user', content: 'Apa itu Bisnis Digital?' },
        { role: 'assistant', content: 'Program Studi S1 Bisnis Digital ITB STIKOM Bali...' }
      ]
    };

    test('15a. Positive Case 1: "Apakah harus jago coding?" inherits S1 Bisnis Digital and resolves to CURRICULUM_INQUIRY', () => {
      const dep = evaluateContextDependency('Apakah harus jago coding?', bdSessionData);
      expect(dep.shouldInherit).toBe(true);
      expect(dep.inheritedDomain).toBe('ACADEMIC_CURRICULUM');
      expect(dep.inheritedIntent).toBe('CURRICULUM_INQUIRY');
      expect(dep.inheritedEntity).toBe('S1 Bisnis Digital');

      const frame = resolveSemanticFrame('Apakah harus jago coding?', bdSessionData);
      expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
      expect(frame.intent).toBe('CURRICULUM_INQUIRY');
      expect(frame.desiredAction).toBe('PROVIDE_CURRICULUM_INFO');
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(true);
      expect(frame.intent).not.toBe('AVAILABLE_PROGRAMS_LIST');
    });

    test('15b. Positive Case 2: "Apakah belajar digital marketing?" inherits S1 Bisnis Digital and resolves to CURRICULUM_INQUIRY', () => {
      const dep = evaluateContextDependency('Apakah belajar digital marketing?', bdSessionData);
      expect(dep.shouldInherit).toBe(true);
      expect(dep.inheritedDomain).toBe('ACADEMIC_CURRICULUM');
      expect(dep.inheritedIntent).toBe('CURRICULUM_INQUIRY');

      const frame = resolveSemanticFrame('Apakah belajar digital marketing?', bdSessionData);
      expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
      expect(frame.intent).toBe('CURRICULUM_INQUIRY');
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(true);
    });

    test('15c. Positive Case 3: "Apakah belajar Artificial Intelligence?" inherits S1 Bisnis Digital and resolves to CURRICULUM_INQUIRY', () => {
      const dep = evaluateContextDependency('Apakah belajar Artificial Intelligence?', bdSessionData);
      expect(dep.shouldInherit).toBe(true);
      expect(dep.inheritedDomain).toBe('ACADEMIC_CURRICULUM');
      expect(dep.inheritedIntent).toBe('CURRICULUM_INQUIRY');

      const frame = resolveSemanticFrame('Apakah belajar Artificial Intelligence?', bdSessionData);
      expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
      expect(frame.intent).toBe('CURRICULUM_INQUIRY');
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(true);
    });

    test('15d. Positive Case 4: "Mata kuliahnya apa saja?" inherits S1 Bisnis Digital and resolves to CURRICULUM_INQUIRY', () => {
      const dep = evaluateContextDependency('Mata kuliahnya apa saja?', bdSessionData);
      expect(dep.shouldInherit).toBe(true);
      expect(dep.inheritedDomain).toBe('ACADEMIC_CURRICULUM');
      expect(dep.inheritedIntent).toBe('CURRICULUM_INQUIRY');

      const frame = resolveSemanticFrame('Mata kuliahnya apa saja?', bdSessionData);
      expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
      expect(frame.intent).toBe('CURRICULUM_INQUIRY');
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(true);
    });

    test('15e. Positive Case 5: S1 Sistem Komputer -> "Apakah harus jago coding?" inherits S1 Sistem Komputer', () => {
      const skSessionData = {
        activeDomain: 'ACADEMIC_PROGRAM',
        activeIntent: 'PROGRAM_OVERVIEW',
        activeEntity: 'S1 Sistem Komputer',
        lastQuery: 'Apa itu Sistem Komputer?'
      };

      const dep = evaluateContextDependency('Apakah harus jago coding?', skSessionData);
      expect(dep.shouldInherit).toBe(true);
      expect(dep.inheritedEntity).toBe('S1 Sistem Komputer');

      const frame = resolveSemanticFrame('Apakah harus jago coding?', skSessionData);
      expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
      expect(frame.intent).toBe('CURRICULUM_INQUIRY');
      expect(frame.entities.some(e => e.canonical === 'S1 Sistem Komputer')).toBe(true);
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(false);
    });

    test('15f. Negative Case 1: Switching to new prodi ("Kalau Sistem Informasi belajar apa?") overrides prior context', () => {
      const dep = evaluateContextDependency('Kalau Sistem Informasi belajar apa?', bdSessionData);
      expect(dep.shouldInherit).toBe(false);

      const frame = resolveSemanticFrame('Kalau Sistem Informasi belajar apa?', bdSessionData);
      expect(frame.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(false);
    });

    test('15g. Negative Case 2: PMB schedule inquiry ("Kapan pendaftaran gelombang I ditutup?") isolates PMB and does NOT leak Bisnis Digital', () => {
      const dep = evaluateContextDependency('Kapan pendaftaran gelombang I ditutup?', bdSessionData);
      expect(dep.shouldInherit).toBe(false);

      const frame = resolveSemanticFrame('Kapan pendaftaran gelombang I ditutup?', bdSessionData);
      expect(frame.domain).toBe('PMB');
      expect(frame.intent).toBe('ADMISSION_SCHEDULE');
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(false);
    });

    test('15h. Negative Case 3: Campus-wide UKM inquiry ("Ada UKM olahraga apa saja?") does NOT inherit Bisnis Digital', () => {
      const dep = evaluateContextDependency('Ada UKM olahraga apa saja?', bdSessionData);
      expect(dep.shouldInherit).toBe(false);

      const frame = resolveSemanticFrame('Ada UKM olahraga apa saja?', bdSessionData);
      expect(frame.domain).toBe('ORGANIZATION_UKM');
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(false);
    });

    test('15i. Negative Case 4: Fresh session with null activeEntity does NOT assume or guess Bisnis Digital', () => {
      const cleanSession = { activeEntity: null, activeDomain: null };
      const dep = evaluateContextDependency('Apakah mahasiswa belajar digital marketing?', cleanSession);
      expect(dep.shouldInherit).toBe(false);

      const frame = resolveSemanticFrame('Apakah mahasiswa belajar digital marketing?', cleanSession);
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(false);
    });

    test('15j. Negative Case 5: Explicit institutional catalog inquiry ("Jurusan di STIKOM ada apa saja?") resolves to AVAILABLE_PROGRAMS_LIST without entity restriction', () => {
      const dep = evaluateContextDependency('Jurusan di STIKOM ada apa saja?', bdSessionData);
      expect(dep.shouldInherit).toBe(false);

      const frame = resolveSemanticFrame('Jurusan di STIKOM ada apa saja?', bdSessionData);
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(false);
    });

    test('15k. End-to-End Deterministic Pipeline: Follow-up "Apakah harus jago coding?" answers Bisnis Digital without rendering all program catalog', async () => {
      const res = await runPhase1DeterministicPipeline('test_ellipsis_bd_coding', 'Apakah harus jago coding?', {
        fastFallback: true,
        disableExternalLlm: true,
        sessionSnapshot: { data: bdSessionData }
      });

      expect(res.semanticFrame.domain).toBe('ACADEMIC_CURRICULUM');
      expect(res.semanticFrame.intent).toBe('CURRICULUM_INQUIRY');
      expect(res.semanticFrame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(true);
      // Invariant: Must NOT return the institutional catalog of all programs
      expect(res.finalAnswer).not.toMatch(/Program Studi Sarjana \(S1\):[\s\S]*Teknologi Informasi[\s\S]*Sistem Informasi[\s\S]*Sistem Komputer/i);
    });

    describe('Case 16: Targeted Answer Quality Invariants (Curriculum, Prerequisites, & Table Formatting)', () => {
      const bdSessionData = {
        activeDomain: 'ACADEMIC_PROGRAM',
        activeIntent: 'PROGRAM_OVERVIEW',
        activeEntity: 'S1 Bisnis Digital',
        lastQuery: 'Apa itu Bisnis Digital?'
      };

      const skSessionData = {
        activeDomain: 'ACADEMIC_PROGRAM',
        activeIntent: 'PROGRAM_OVERVIEW',
        activeEntity: 'S1 Sistem Komputer',
        lastQuery: 'Apa itu Sistem Komputer?'
      };

      test('16a. Coding inquiry for S1 Bisnis Digital does NOT use career roles as entrance requirement and states no mandatory coding prerequisite', async () => {
        const res = await runPhase1DeterministicPipeline('test_q_bd_coding', 'Apakah harus jago coding?', {
          fastFallback: true,
          disableExternalLlm: true,
          sessionSnapshot: { data: bdSessionData }
        });

        expect(res.finalAnswer).toMatch(/tidak tercantum sebagai syarat wajib/i);
        expect(res.finalAnswer).toMatch(/bertahap mulai dari tingkat dasar/i);
        expect(res.finalAnswer).toMatch(/Outcome-Based Education|OBE/i);
        // Invariant: Must NOT use career prospects as proof of entrance requirement
        expect(res.finalAnswer).not.toMatch(/Lulusan program studi ini dipersiapkan untuk berkarier sebagai:\s*•\s*Digital Marketing Specialist/i);
        // Invariant: Must NOT make absolute guarantee that coding is easy or requires no effort
        expect(res.finalAnswer).not.toMatch(/pasti mudah|tidak butuh kemampuan sama sekali/i);
      });

      test('16b. Digital marketing inquiry for S1 Bisnis Digital prioritizes official courses over career prospects', async () => {
        const res = await runPhase1DeterministicPipeline('test_q_bd_dm', 'Apakah belajar digital marketing?', {
          fastFallback: true,
          disableExternalLlm: true,
          sessionSnapshot: { data: bdSessionData }
        });

        // Invariant: Paragraf pertama harus menjawab secara afirmatif
        expect(res.finalAnswer).toMatch(/^\*\*Ya\*\*, mahasiswa Program Studi \*\*S1 Bisnis Digital\*\*/i);
        // Invariant: Menyebutkan mata kuliah resmi
        expect(res.finalAnswer).toMatch(/Pemasaran Digital/i);
        expect(res.finalAnswer).toMatch(/Optimasi Mesin Pencari|SEO/i);
        expect(res.finalAnswer).toMatch(/Kampanye Pemasaran Omni/i);
        expect(res.finalAnswer).toMatch(/Pemasaran Media Sosial/i);
        // Invariant: Tidak menggantikan mata kuliah dengan peran karier saja
        expect(res.finalAnswer).not.toMatch(/^Lulusan program studi ini dipersiapkan untuk berkarier sebagai/i);
      });

      test('16c. AI inquiry for S1 Bisnis Digital cites prompt engineering course and bounds claims against algorithmic ML/DL engineering', async () => {
        const res = await runPhase1DeterministicPipeline('test_q_bd_ai', 'Apakah belajar Artificial Intelligence?', {
          fastFallback: true,
          disableExternalLlm: true,
          sessionSnapshot: { data: bdSessionData }
        });

        // Invariant: Paragraf pertama afirmatif terikat konteks Bisnis Digital
        expect(res.finalAnswer).toMatch(/^\*\*Ya\*\*, di Program Studi \*\*S1 Bisnis Digital\*\*/i);
        // Invariant: Menyebutkan mata kuliah resmi Semester III Teknik Pembuatan Prompt untuk Model AI
        expect(res.finalAnswer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
        expect(res.finalAnswer).toMatch(/Semester III/i);
        // Invariant: Menolak klaim rekayasa algoritma mendalam / Machine Learning murni
        expect(res.finalAnswer).toMatch(/Hal ini berbeda dengan Program Studi S1 Sistem Komputer/i);
        expect(res.finalAnswer).toMatch(/Machine Learning|Deep Learning/i);
      });

      test('16d. Course list inquiry for S1 Sistem Komputer renders complete 8 semesters, clean bullet points with accurate SKS, and zero duplicate overlap', async () => {
        const res = await runPhase1DeterministicPipeline('test_q_sk_courses', 'Mata kuliahnya apa saja?', {
          fastFallback: true,
          disableExternalLlm: true,
          sessionSnapshot: { data: skSessionData }
        });

        // Invariant: Seluruh 8 semester ditampilkan berurutan
        expect(res.finalAnswer).toMatch(/\*\*Semester I\*\*:/);
        expect(res.finalAnswer).toMatch(/\*\*Semester II\*\*:/);
        expect(res.finalAnswer).toMatch(/\*\*Semester III\*\*:/);
        expect(res.finalAnswer).toMatch(/\*\*Semester IV\*\*:/);
        expect(res.finalAnswer).toMatch(/\*\*Semester V\*\*:/);
        expect(res.finalAnswer).toMatch(/\*\*Semester VI\*\*:/);
        expect(res.finalAnswer).toMatch(/\*\*Semester VII\*\*:/);
        expect(res.finalAnswer).toMatch(/\*\*Semester VIII\*\*:/);

        // Invariant: Semester berurutan posisinya
        const posI = res.finalAnswer.indexOf('**Semester I**:');
        const posIV = res.finalAnswer.indexOf('**Semester IV**:');
        const posVIII = res.finalAnswer.indexOf('**Semester VIII**:');
        expect(posI).toBeLessThan(posIV);
        expect(posIV).toBeLessThan(posVIII);

        // Invariant: Format poin rapi dengan SKS persis dokumen sumber
        expect(res.finalAnswer).toMatch(/• Agama \(2 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Pancasila \(2 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Matematika Diskrit \(4 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Algoritma dan Pemrograman \(2 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Pemrograman Komputer \(4 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Rangkaian Elektronika \(4 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Sistem dan Jaringan Komputer \(4 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Mikrokontroler dan Antarmuka \(4 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Kecerdasan Artifisial \(4 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Internet of Things \(4 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Pembelajaran Mesin Sistem Tertanam \(4 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Robotika \(4 SKS\)/);
        expect(res.finalAnswer).toMatch(/• Tugas Akhir \(6 SKS\)/);

        // Invariant: Total SKS 144 sesuai dokumen
        expect(res.finalAnswer).toMatch(/144\s*SKS/i);
        expect(res.finalAnswer).toMatch(/8\s*semester/i);

        // Invariant: Zero duplication at chunk boundaries
        const sensorMatches = (res.finalAnswer.match(/Sensor dan Aktuator/g) || []).length;
        expect(sensorMatches).toBe(1);
        const rplMatches = (res.finalAnswer.match(/Rekayasa Perangkat Lunak/g) || []).length;
        expect(rplMatches).toBe(1);
        const praktikumDigMatches = (res.finalAnswer.match(/Praktikum Sistem Digital/g) || []).length;
        expect(praktikumDigMatches).toBe(1);

        // Invariant: Bersihkan nomor urut format tabel mentah dan header tabel
        expect(res.finalAnswer).not.toMatch(/No Nama Mata Kuliah SKS/i);
        expect(res.finalAnswer).not.toMatch(/\bTotal\s+19\b/i);
        expect(res.finalAnswer).not.toMatch(/\b1 Agama 2\b/);
        expect(res.finalAnswer).not.toMatch(/\b2 Pancasila 2\b/);
      });

      test('16e. Strict program isolation: S1 Sistem Komputer course list does not leak S1 Bisnis Digital courses and vice versa', async () => {
        const skRes = await runPhase1DeterministicPipeline('test_iso_sk', 'Mata kuliahnya apa saja?', {
          fastFallback: true,
          disableExternalLlm: true,
          sessionSnapshot: { data: skSessionData }
        });

        expect(skRes.finalAnswer).not.toMatch(/Model Bisnis Digital|Pemasaran Media Sosial/i);

        const bdRes = await runPhase1DeterministicPipeline('test_iso_bd', 'Mata kuliahnya apa saja?', {
          fastFallback: true,
          disableExternalLlm: true,
          sessionSnapshot: { data: bdSessionData }
        });

        expect(bdRes.finalAnswer).not.toMatch(/Rangkaian Elektronika|Sensor dan Aktuator/i);
      });

      test('16f. Targeted semester inquiry: "Mata kuliah semester 5 Sistem Komputer apa saja?" returns targeted semester without 8-semester dump', async () => {
        const semRes = await runPhase1DeterministicPipeline('test_q_sk_sem5', 'Mata kuliah semester 5 Sistem Komputer apa saja?', {
          fastFallback: true,
          disableExternalLlm: true,
          sessionSnapshot: { data: skSessionData }
        });

        expect(semRes.verification.outcome).toBe('VERIFIED_FACTUAL');
        expect(semRes.finalAnswer).toMatch(/\*\*Semester V\*\*:/);
        expect(semRes.finalAnswer).toMatch(/Kecerdasan Artifisial \(4 SKS\)/);
        expect(semRes.finalAnswer).toMatch(/Keamanan Jaringan Komputer \(4 SKS\)/);
        expect(semRes.finalAnswer).toMatch(/Pendidikan Etika dan Anti Korupsi \(2 SKS\)/);

        // Invariant: Does not dump other semesters
        expect(semRes.finalAnswer).not.toMatch(/\*\*Semester I\*\*:/);
        expect(semRes.finalAnswer).not.toMatch(/\*\*Semester VIII\*\*:/);
      });
    });

  });

});
