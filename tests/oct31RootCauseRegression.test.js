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
const { arbitrateEvidence, evaluateEvidenceCompatibility, curateCandidatePassages } = require('../src/core/evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { buildGenericExtractiveFallback, extractGroundedCampusDirectory, extractGroundedScholarshipClaims } = require('../src/core/groundedAnswerGenerator');
const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');
const { generateFeeAnswer } = require('../src/core/feeCalculationEngine');
const { evaluateRecommendation } = require('../src/reasoning/recommendationEngine');
const { generateGroundedCatalogSummary } = require('../src/core/academicCatalog');

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

});
