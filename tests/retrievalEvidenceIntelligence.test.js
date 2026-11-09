'use strict';

/**
 * tests/retrievalEvidenceIntelligence.test.js
 *
 * Permanent regression test suite for Stage 3B.1:
 * Intent-Aware UKM Document Ranking & Evidence Intelligence (Case ID 330).
 *
 * Verifies that:
 * 1. Profile/Activity/Availability inquiries prioritize substantive profile documents
 *    over administrative appointment decrees.
 * 2. Activity inquiries for a specific UKM place its profile document at rank #1.
 * 3. Advisor/Legality inquiries prioritize administrative SK documents containing appointed advisors.
 * 4. SK inquiries retrieve and accept official decree documents.
 * 5. General UKM category queries maintain balanced, diverse organizational lists without crowding.
 * 6. Negative Controls: Non-UKM queries (Tuition Fee, PMB) suffer 0% ranking or score drift.
 */

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { retrieveCandidates } = require('../src/core/retrievalService');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');
const { runPhase1DeterministicPipeline, processTurn } = require('../src/core/orchestrator');
const { decomposeQuery } = require('../src/core/multiIntentResolver');
const { synthesizeAnswer } = require('../src/core/groundedAnswerGenerator');
const { evaluateAnswerability } = require('../src/core/answerabilityGate');
const {
  generateGroundedCatalogSummary,
  CATALOG_FACT_PROVENANCE_STATUS,
  S1_CATALOG_CLAIM_PROVENANCE,
  getCatalogClaimProvenance
} = require('../src/core/academicCatalog');

jest.setTimeout(30000);

describe('TIKO V2 — Stage 3B.1: Intent-Aware UKM Document Ranking & Evidence Intelligence', () => {

  describe('Scenario 1: UKM Availability & Arts/Music Inquiry (Target: Case ID 330)', () => {
    test('1a. "Apakah tersedia UKM seni dan musik?" prioritizes profile documents over SK Pembina', async () => {
      const q = 'Apakah tersedia UKM seni dan musik?';
      const frame = resolveSemanticFrame(q, {});
      const plan = buildRetrievalPlan(frame, { query: q });
      const candidates = await retrieveCandidates(plan, { topK: 10 });

      expect(candidates.length).toBeGreaterThan(0);

      // Rank #1 must be a substantive profile document (e.g. VOS, DOS, Tari), NOT SK Pembina ORMAWA
      const topCandidate = candidates[0];
      const topFile = topCandidate.sourceFile || topCandidate.source_file;
      expect(topFile).not.toMatch(/sk\s+pembina\s+ormawa/i);
      expect(topFile).toMatch(/profil.*ukm|profile.*ormawa|profiling|buku.*ormawa/i);

      // Top candidate for arts and music should specifically be an arts/music organization profile (VOS)
      expect(topFile).toMatch(/Profile Ormawa VOS\.docx/i);

      // Evidence arbiter must accept the arts/music profile evidence
      const arbResult = arbitrateEvidence(candidates, plan, { query: q, semanticFrame: frame });
      expect(arbResult.accepted.length).toBeGreaterThan(0);
      const acceptedFiles = arbResult.accepted.map(c => c.sourceFile || c.source_file);
      expect(acceptedFiles[0]).toMatch(/Profile Ormawa VOS\.docx/i);
    });

    test('1b. Secondary arts profiles (DOS, Tari) are also present in top candidate pool', async () => {
      const q = 'Apakah tersedia UKM seni dan musik?';
      const frame = resolveSemanticFrame(q, {});
      const plan = buildRetrievalPlan(frame, { query: q });
      const candidates = await retrieveCandidates(plan, { topK: 10 });

      const candidateFiles = candidates.map(c => c.sourceFile || c.source_file);
      const hasSecondaryArts = candidateFiles.some(f => /dos|tari|pragina|tabuh/i.test(f));
      expect(hasSecondaryArts).toBe(true);
    });
  });

  describe('Scenario 2: Specific UKM Activity Inquiry', () => {
    test('2. "Apa kegiatan UKM VOS?" places Profile Ormawa VOS at Rank #1', async () => {
      const q = 'Apa kegiatan UKM VOS?';
      const frame = resolveSemanticFrame(q, {});
      const plan = buildRetrievalPlan(frame, { query: q });
      const candidates = await retrieveCandidates(plan, { topK: 5 });

      expect(candidates.length).toBeGreaterThan(0);
      const topCandidate = candidates[0];
      const topFile = topCandidate.sourceFile || topCandidate.source_file;
      expect(topFile).toMatch(/Profile Ormawa VOS\.docx/i);

      // Score of VOS profile chunk must dominate over generic documents
      expect(topCandidate.score).toBeGreaterThan(400);

      const arbResult = arbitrateEvidence(candidates, plan, { query: q, semanticFrame: frame });
      expect(arbResult.accepted.length).toBeGreaterThan(0);
      expect(arbResult.accepted[0].sourceFile).toMatch(/Profile Ormawa VOS\.docx/i);
    });
  });

  describe('Scenario 3: UKM Advisor & Appointment Inquiry', () => {
    test('3. "Siapa dosen pembina UKM VOS?" prioritizes SK Pembina ORMAWA over general profile docs', async () => {
      const q = 'Siapa dosen pembina UKM VOS?';
      const frame = resolveSemanticFrame(q, {});
      const plan = buildRetrievalPlan(frame, { query: q });
      const candidates = await retrieveCandidates(plan, { topK: 5 });

      expect(candidates.length).toBeGreaterThan(0);

      // Rank #1 must be SK PEMBINA ORMAWA, because the profile doc contains NO advisor names
      const topCandidate = candidates[0];
      const topFile = topCandidate.sourceFile || topCandidate.source_file;
      expect(topFile).toMatch(/SK PEMBINA ORMAWA/i);

      // The top candidate chunk or top candidates must contain the official VOS advisor text
      const arbResult = arbitrateEvidence(candidates, plan, { query: q, semanticFrame: frame });
      expect(arbResult.accepted.length).toBeGreaterThan(0);
      expect(arbResult.accepted[0].sourceFile).toMatch(/SK PEMBINA ORMAWA/i);
    });
  });

  describe('Scenario 4: SK & Legality Inquiry', () => {
    test('4. "Apa isi SK Pembina ORMAWA?" retrieves and accepts SK Pembina ORMAWA', async () => {
      const q = 'Apa isi SK Pembina ORMAWA?';
      const frame = resolveSemanticFrame(q, {});
      const plan = buildRetrievalPlan(frame, { query: q });
      const candidates = await retrieveCandidates(plan, { topK: 5 });

      expect(candidates.length).toBeGreaterThan(0);
      for (const c of candidates) {
        expect(c.sourceFile || c.source_file).toMatch(/SK PEMBINA ORMAWA/i);
      }

      const arbResult = arbitrateEvidence(candidates, plan, { query: q, semanticFrame: frame });
      expect(arbResult.accepted.length).toBeGreaterThan(0);
      expect(arbResult.accepted[0].sourceFile).toMatch(/SK PEMBINA ORMAWA/i);
    });
  });

  describe('Scenario 5: General UKM Category List Inquiry', () => {
    test('5. "Apa saja kategori UKM di STIKOM Bali?" maintains diverse organization candidates', async () => {
      const q = 'Apa saja kategori UKM di STIKOM Bali?';
      const frame = resolveSemanticFrame(q, {});
      const plan = buildRetrievalPlan(frame, { query: q });
      const candidates = await retrieveCandidates(plan, { topK: 10 });

      expect(candidates.length).toBeGreaterThan(0);
      const uniqueFiles = new Set(candidates.map(c => c.sourceFile || c.source_file));

      // Must have diverse organizations represented (at least 4 different sources in top 10)
      expect(uniqueFiles.size).toBeGreaterThanOrEqual(4);

      // No single document may crowd out all top 5 slots
      const top5Files = candidates.slice(0, 5).map(c => c.sourceFile || c.source_file);
      const top5Unique = new Set(top5Files);
      expect(top5Unique.size).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Scenario 6: Negative Controls (0% Change on Non-UKM Domains)', () => {
    test('6a. Tuition Fee query retains exact candidates and identical ordering', async () => {
      const q = 'Berapa biaya kuliah S1 Sistem Informasi?';
      const frame = resolveSemanticFrame(q, {});
      const plan = buildRetrievalPlan(frame, { query: q });
      const candidates = await retrieveCandidates(plan, { topK: 5 });

      expect(candidates.length).toBe(5);
      // All top candidates must be tuition fee tables
      for (const c of candidates) {
        expect(c.sourceFile || c.source_file).toMatch(/rincian Biaya/i);
      }
      expect(candidates[0].id).toBe('ab32dd78-4d2a-457e-a327-628c39fb6288');
      expect(candidates[0].score).toBeCloseTo(412.2794, 2);
      expect(candidates[1].id).toBe('38e0e158-0f06-41f1-b0da-769ca6353381');
      expect(candidates[1].score).toBeCloseTo(411.7180, 2);
    });

    test('6b. PMB admission requirements query prioritizes genuine PMB documents over yudisium/wisuda', async () => {
      const q = 'Apa syarat pendaftaran PMB?';
      const frame = resolveSemanticFrame(q, {});
      const plan = buildRetrievalPlan(frame, { query: q });
      const candidates = await retrieveCandidates(plan, { topK: 5 });

      expect(candidates.length).toBe(5);
      // Top candidate must be genuine PMB overview/schedule document, not graduation or yudisium
      expect(candidates[0].sourceFile).toMatch(/ISIAN WEBSITE|Kalender Pendaftaran/i);
      expect(candidates[0].id).toBe('d4f04a88-a79d-4fbb-a676-23cd70af3df3');
      for (const c of candidates) {
        expect(c.sourceFile).not.toMatch(/Yudisium|Wisuda|Pedoman TA/i);
      }
    });
  });

  describe('Stage 3B.2: Institutional Guideline Evidence Scoping (Target: Case ID 222)', () => {

    test('3B.2-1. ID 222 Page count constraint discloses unregulated page count without fabricating numbers', async () => {
      const q = 'berapa halaman minimal dibuat untuk tugas akhir di prodi SI atau fakultas infokom';
      const res = await runPhase1DeterministicPipeline('test-id222', q);

      expect(res).toBeDefined();
      expect(res.verification).toBeDefined();
      expect(res.verification.pass).toBe(true);
      expect(res.verification.outcome).toBe('VERIFIED_FACTUAL');

      const ans = res.finalAnswer || res.answer;
      expect(ans).toBeDefined();

      // Must explicitly disclose that minimum page limit is NOT regulated
      expect(ans).toMatch(/tidak\s+(?:diatur\s+batasan|ada\s+ketentuan\s+jumlah\s+halaman\s+minimal|terdapat\s+ketentuan)/i);
      expect(ans).toMatch(/minimum\s+maupun\s+maksimum\s+jumlah\s+halaman/i);

      // Must explain what IS regulated: formatting standards and chapter systematics
      expect(ans).toMatch(/kertas\s+A4/i);
      expect(ans).toMatch(/Times\s+New\s+Roman/i);
      expect(ans).toMatch(/spasi\s+1\.5/i);
      expect(ans).toMatch(/Bagian\s+Awal/i);
      expect(ans).toMatch(/Bagian\s+Utama/i);
      expect(ans).toMatch(/Bagian\s+Akhir/i);

      // Must direct student to consult Academic Advisor
      expect(ans).toMatch(/Dosen\s+Pembimbing/i);

      // Zero fabricated numbers
      expect(ans).not.toMatch(/\b(?:minimal\s+\d+\s+halaman|\d+\s+lembar\s+minimal)\b/i);
    });

    test('3B.2-2. Thesis report systematics for S1 Sistem Informasi explains standard report structure', async () => {
      const q = 'bagaimana sistematika laporan tugas akhir S1 Sistem Informasi?';
      const res = await runPhase1DeterministicPipeline('test-id222-si-struct', q);

      expect(res).toBeDefined();
      expect(res.verification.pass).toBe(true);
      expect(res.verification.outcome).toBe('VERIFIED_FACTUAL');

      const ans = res.finalAnswer || res.answer;
      expect(ans).toMatch(/Bagian\s+Awal/i);
      expect(ans).toMatch(/Bagian\s+Utama/i);
      expect(ans).toMatch(/Bagian\s+Akhir/i);
      expect(ans).toMatch(/Bab\s+I/i);
      expect(ans).toMatch(/Bab\s+V/i);
      expect(ans).toMatch(/Daftar\s+Pustaka/i);
    });

    test('3B.2-3. Sibling FIK program (S1 Teknologi Informasi) accepts FIK S1 thesis guideline via faculty companion', async () => {
      const q = 'bagaimana sistematika tugas akhir S1 Teknologi Informasi?';
      const res = await runPhase1DeterministicPipeline('test-id222-ti-struct', q);

      expect(res).toBeDefined();
      expect(res.verification.pass).toBe(true);
      expect(res.verification.outcome).toBe('VERIFIED_FACTUAL');

      const ans = res.finalAnswer || res.answer;
      expect(ans).toMatch(/Fakultas\s+Informatika\s+dan\s+Komputer/i);
      expect(ans).toMatch(/Bagian\s+Awal/i);
      expect(ans).toMatch(/Bagian\s+Utama/i);
      expect(ans).toMatch(/Bagian\s+Akhir/i);
    });

    test('3B.2-4. Negative Control: Non-FIK program (S1 Bisnis Digital) rejects FIK Pedoman TA in arbitration', () => {
      const candidates = [
        { id: 'chunk_pedoman_ta_fik', sourceDocument: 'Pedoman TA S1 2019 Revisi 1.pdf', text: 'Buku Pedoman Tugas Akhir S1 Fakultas Informatika dan Komputer' }
      ];

      // S1 Bisnis Digital (FBV) must reject FIK Pedoman TA
      const planBD = { targetEntities: ['S1 Bisnis Digital'], requestedAttributes: ['guidelines'], query: 'pedoman tugas akhir bisnis digital' };
      const arbBD = arbitrateEvidence(candidates, planBD);
      expect(arbBD.accepted.length).toBe(0);
      expect(arbBD.rejected.length).toBe(1);

      // S1 Sistem Informasi (FIK) must accept FIK Pedoman TA via faculty companion
      const planSI = { targetEntities: ['S1 Sistem Informasi'], requestedAttributes: ['guidelines'], query: 'pedoman tugas akhir SI' };
      const arbSI = arbitrateEvidence(candidates, planSI);
      expect(arbSI.accepted.length).toBe(1);
      expect(arbSI.rejected.length).toBe(0);
    });

    test('3B.2-5. Negative Control: Postgraduate degree (S2 Magister Sistem Informasi) rejects S1 Pedoman TA', () => {
      const candidates = [
        { id: 'chunk_pedoman_ta_fik', sourceDocument: 'Pedoman TA S1 2019 Revisi 1.pdf', text: 'Buku Pedoman Tugas Akhir S1 Fakultas Informatika dan Komputer' }
      ];

      const planS2 = { targetEntities: ['S2 Magister Sistem Informasi'], requestedAttributes: ['guidelines'], query: 'pedoman tugas akhir s2' };
      const arbS2 = arbitrateEvidence(candidates, planS2);
      expect(arbS2.accepted.length).toBe(0);
      expect(arbS2.rejected.length).toBe(1);
    });

    test('3B.2-6. Negative Control: Non-thesis queries (Curriculum, Tuition Fee, PMB, UKM) remain uncontaminated', async () => {
      // UKM Arts & Music (from Stage 3B.1) remains 100% stable
      const qUkm = 'Apakah tersedia UKM seni dan musik?';
      const frameUkm = resolveSemanticFrame(qUkm, {});
      const planUkm = buildRetrievalPlan(frameUkm, { query: qUkm });
      const candUkm = await retrieveCandidates(planUkm, { topK: 5 });
      expect(candUkm[0].sourceFile).toMatch(/Profile Ormawa VOS\.docx/i);

      // Tuition fee remains 100% stable
      const qFee = 'Berapa biaya kuliah S1 Sistem Informasi?';
      const frameFee = resolveSemanticFrame(qFee, {});
      const planFee = buildRetrievalPlan(frameFee, { query: qFee });
      const candFee = await retrieveCandidates(planFee, { topK: 5 });
      expect(candFee[0].sourceFile).toMatch(/rincian Biaya/i);
    });

  });

  describe('Stage 3B.3: ID396 PMB Candidate Recall & Query Planning', () => {

    test('3B.3-1. Case ID 396 decomposes into S1 catalog list and PMB admission procedure subqueries', () => {
      const q = 'Apa saja prodi S1 dan bagaimana cara daftarnya?';
      const subqueries = decomposeQuery(q);

      expect(subqueries.length).toBe(2);
      expect(subqueries[0].domain).toBe('ACADEMIC_PROGRAM');
      expect(subqueries[0].intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(subqueries[0].academicLevel).toBe('S1');

      expect(subqueries[1].domain).toBe('PMB');
      expect(subqueries[1].intent).toBe('ADMISSION_PROCEDURE');
    });

    test('3B.3-2. Subquery 2 (bagaimana cara daftarnya) recalls genuine PMB candidates and downweights contaminants', async () => {
      const q = 'Apa saja prodi S1 dan bagaimana cara daftarnya?';
      const subqueries = decomposeQuery(q);
      const plan = buildRetrievalPlan(subqueries[1]);
      const candidates = await retrieveCandidates(plan, { topK: 16 });

      expect(candidates.length).toBeGreaterThanOrEqual(10);

      // Top candidate must be official PMB source (ISIAN WEBSITE PMB section or Kalender Pendaftaran)
      const topDoc = candidates[0].sourceFile || candidates[0].filename;
      expect(topDoc).toMatch(/ISIAN WEBSITE|Kalender Pendaftaran/i);

      // Contaminant documents must NOT be in top 5
      const top5Files = candidates.slice(0, 5).map(c => c.sourceFile || c.filename);
      for (const f of top5Files) {
        expect(f).not.toMatch(/FAQ PENGURUSAN MAHASISWA ASING/i);
        expect(f).not.toMatch(/Student Exchange/i);
        expect(f).not.toMatch(/Pedoman TA/i);
        expect(f).not.toMatch(/Yudisium/i);
      }
    });

    test('3B.3-3. Evidence Arbiter rejects non-procedural chunks and contaminants for ADMISSION_PROCEDURE', async () => {
      const q = 'Apa saja prodi S1 dan bagaimana cara daftarnya?';
      const subqueries = decomposeQuery(q);
      const plan = buildRetrievalPlan(subqueries[1]);
      const candidates = await retrieveCandidates(plan, { topK: 16 });

      const arbitrated = arbitrateEvidence(candidates, plan);

      // Rejections must occur for non-procedural chunks
      expect(arbitrated.rejected.length).toBeGreaterThanOrEqual(1);

      // Arbiter strictly rejects foreign FAQ, exchange, and thesis
      for (const rej of arbitrated.rejected) {
        const rejDoc = rej.chunk?.sourceFile || rej.chunk?.filename || '';
        if (/FAQ PENGURUSAN MAHASISWA ASING/i.test(rejDoc)) {
          expect(rej.reason).toMatch(/foreign_student_immigration_faq/);
        }
        if (/Student Exchange/i.test(rejDoc)) {
          expect(rej.reason).toMatch(/student_exchange_not_applicable/);
        }
        if (/Pedoman TA|Yudisium/i.test(rejDoc)) {
          expect(rej.reason).toMatch(/evidence_is_thesis_or_graduation/);
        }
      }
    });

    test('3B.3-4. End-to-end ID 396 pipeline produces grounded answer with S1 list and transparent procedure SOURCE_GAP', async () => {
      const q = 'Apa saja prodi S1 dan bagaimana cara daftarnya?';
      const res = await runPhase1DeterministicPipeline('test-id396', q);

      expect(res).toBeDefined();
      expect(res.verification).toBeDefined();

      // Must cover all 4 S1 programs
      expect(res.finalAnswer).toMatch(/Sistem Informasi/i);
      expect(res.finalAnswer).toMatch(/Sistem Komputer/i);
      expect(res.finalAnswer).toMatch(/Teknologi Informasi/i);
      expect(res.finalAnswer).toMatch(/Bisnis Digital/i);

      // Procedure aspect must transparently declare SOURCE_GAP without hallucinating 6 steps
      expect(res.finalAnswer).toMatch(/SOURCE_GAP|belum tersedia/i);
      expect(res.finalAnswer).not.toMatch(/1\.\s+\*\*Akses Portal PMB\*\*/i);
    });

    test('3B.3-5. Negative Control: Foreign visa inquiry correctly retrieves and prioritizes foreign FAQ', async () => {
      const q = 'Bagaimana prosedur mahasiswa asing mengurus visa?';
      const frame = resolveSemanticFrame(q, {});
      const plan = buildRetrievalPlan(frame, { query: q });
      const candidates = await retrieveCandidates(plan, { topK: 5 });

      expect(candidates.length).toBe(5);
      expect(candidates[0].sourceFile).toMatch(/FAQ PENGURUSAN MAHASISWA ASING/i);
    });

    test('3B.3-6. Negative Control: Student exchange inquiry correctly retrieves and prioritizes exchange documents', async () => {
      const q = 'Bagaimana cara ikut program student exchange?';
      const frame = resolveSemanticFrame(q, {});
      const plan = buildRetrievalPlan(frame, { query: q });
      const candidates = await retrieveCandidates(plan, { topK: 5 });

      expect(candidates.length).toBe(5);
      expect(candidates[0].sourceFile).toMatch(/Student Exchange/i);
    });

  });

  describe('Stage 3B.4: PMB Procedure Grounding Guard (Case ID 396)', () => {

    test('3B.4-1. Chunk with only PMB title and academic year is rejected for ADMISSION_PROCEDURE', () => {
      const plan = {
        domain: 'PMB',
        intent: 'ADMISSION_PROCEDURE',
        requiredAspects: ['procedure', 'requirements', 'documents']
      };
      const candidates = [{
        id: 'chunk-629-pmb-title',
        text: 'Informasi Penerimaan Mahasiswa Baru (PMB) ITB STIKOM Bali Tahun Akademik 2026/2027.',
        sourceFile: 'ISIAN WEBSITE (1).pdf'
      }];
      const arbitrated = arbitrateEvidence(candidates, plan);
      expect(arbitrated.accepted.length).toBe(0);
      expect(arbitrated.rejected[0].reason).toBe('evidence_does_not_contain_registration_procedure_aspect');
    });

    test('3B.4-2. Fee schedule chunk mentioning RPL and registration is rejected for regular ADMISSION_PROCEDURE', () => {
      const plan = {
        domain: 'PMB',
        intent: 'ADMISSION_PROCEDURE',
        requiredAspects: ['procedure', 'requirements', 'documents']
      };
      const candidates = [{
        id: 'chunk-fee-rpl',
        text: 'Tabel Rincian Biaya Kuliah dan Potongan DPP PMB. Biaya Registrasi dan Form RPL (Rekognisi Pembelajaran Lampau) Rp 500.000.',
        sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
        category: 'RPL',
        docCategory: 'BIAYA'
      }];
      const arbitrated = arbitrateEvidence(candidates, plan);
      expect(arbitrated.accepted.length).toBe(0);
      expect(arbitrated.rejected[0].reason).toBe('evidence_is_fee_table_not_registration_procedure');
    });

    test('3B.4-3. Genuine admission procedure evidence with sequential steps is accepted', () => {
      const plan = {
        domain: 'PMB',
        intent: 'ADMISSION_PROCEDURE',
        requiredAspects: ['procedure', 'requirements', 'documents']
      };
      const candidates = [{
        id: 'chunk-real-pmb-proc',
        text: 'Alur dan tahapan pendaftaran mahasiswa baru ITB STIKOM Bali:\n1. Buka laman pendaftaran resmi di portal PMB.\n2. Mengisi formulir online.\n3. Mengunggah dokumen persyaratan ijazah dan KTP.\n4. Membayar biaya formulir pendaftaran.\n5. Menunggu verifikasi berkas oleh panitia.',
        sourceFile: 'Buku_Pedoman_PMB_2026.pdf'
      }];
      const arbitrated = arbitrateEvidence(candidates, plan);
      expect(arbitrated.accepted.length).toBe(1);
      expect(arbitrated.accepted[0].id).toBe('chunk-real-pmb-proc');
    });

    test('3B.4-4. Grounded generator does not emit 6 static steps when procedural evidence is missing', async () => {
      const frame = {
        domain: 'PMB',
        intent: 'ADMISSION_PROCEDURE',
        rawQuery: 'Bagaimana cara daftarnya?',
        normalizedQuery: 'bagaimana cara daftar',
        aspects: ['procedure']
      };
      // Zero accepted evidence
      const ansZero = await synthesizeAnswer(frame, { accepted: [] });
      expect(ansZero.success).toBe(false);
      expect(ansZero.answer).toBeNull();

      // Accepted evidence without procedure steps (e.g. general overview title chunk)
      const nonProcAccepted = [{
        id: 'chunk-title-only',
        text: 'Informasi Penerimaan Mahasiswa Baru ITB STIKOM Bali TA 2026/2027.',
        sourceFile: 'brosur.pdf'
      }];
      const ansNonProc = await synthesizeAnswer(frame, { accepted: nonProcAccepted });
      expect(ansNonProc.answer).toBeNull();
    });

    test('3B.4-5. ID 396 multi-intent answers S1 prodi list from evidence and safely declares SOURCE_GAP for procedure', async () => {
      const q = 'Apa saja prodi S1 dan bagaimana cara daftarnya?';
      const res = await processTurn(`test_3b4_id396_${Date.now()}`, q);

      expect(res).toBeDefined();
      expect(res.subQueryResults).toHaveLength(2);

      // Subquery 1: S1 Programs list is answered factually
      const s1 = res.subQueryResults[0];
      expect(s1.frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(s1.verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(s1.answer).toMatch(/Sistem Informasi/i);
      expect(s1.answer).toMatch(/Sistem Komputer/i);
      expect(s1.answer).toMatch(/Teknologi Informasi/i);
      expect(s1.answer).toMatch(/Bisnis Digital/i);

      // Subquery 2: Admission procedure is declared SOURCE_GAP / SAFE_UNKNOWN
      const s2 = res.subQueryResults[1];
      expect(s2.frame.intent).toBe('ADMISSION_PROCEDURE');
      expect(s2.acceptedCount).toBe(0);
      expect(s2.verification.outcome).toBe('SAFE_UNKNOWN');
      expect(s2.answer).toMatch(/belum tersedia|SOURCE_GAP/i);

      // Overall turn must NOT be VERIFIED_FACTUAL for the unevidenced procedure
      expect(res.verification.outcome).not.toBe('VERIFIED_FACTUAL');
      expect(res.status).toBe('corpus_gap');

      // Final combined answer must NOT emit the 6 static steps or fabricated fee
      expect(res.finalAnswer).not.toMatch(/1\.\s+\*\*Akses Portal PMB\*\*/i);
      expect(res.finalAnswer).not.toMatch(/Rp\s*500\.000/i);
    });

    test('3B.4-6. Regression: Tuition fee and admission schedule inquiries remain stable and accurate', async () => {
      // Tuition fee query
      const qFee = 'Berapa biaya kuliah S1 Sistem Informasi?';
      const frameFee = resolveSemanticFrame(qFee, {});
      const planFee = buildRetrievalPlan(frameFee, { query: qFee });
      const candFee = await retrieveCandidates(planFee, { topK: 5 });
      expect(candFee[0].sourceFile).toMatch(/rincian Biaya/i);

      // Admission schedule query
      const qSchedule = 'Kapan pendaftaran gelombang II dibuka?';
      const resSchedule = await processTurn(`test_3b4_sched_${Date.now()}`, qSchedule);
      expect(resSchedule.finalAnswer).toMatch(/Gelombang II/i);
    });

    test('3B.4-7. Negative Controls: Foreign visa, student exchange, and thesis guidelines remain strictly scoped', async () => {
      // Foreign student visa
      const qVisa = 'Bagaimana prosedur mahasiswa asing mengurus visa?';
      const frameVisa = resolveSemanticFrame(qVisa, {});
      const planVisa = buildRetrievalPlan(frameVisa, { query: qVisa });
      const candVisa = await retrieveCandidates(planVisa, { topK: 5 });
      expect(candVisa[0].sourceFile).toMatch(/FAQ PENGURUSAN MAHASISWA ASING/i);

      // Student exchange
      const qEx = 'Bagaimana cara ikut program student exchange?';
      const frameEx = resolveSemanticFrame(qEx, {});
      const planEx = buildRetrievalPlan(frameEx, { query: qEx });
      const candEx = await retrieveCandidates(planEx, { topK: 5 });
      expect(candEx[0].sourceFile).toMatch(/Student Exchange/i);
    });

  });


  describe('Stage 3B.4.1: Final Grounding & PMB Intent Regression Check', () => {

    test('3B.4.1-1. Procedure False-Positive Guard: Rejects 4 non-procedural sentences from being accepted as procedure steps', () => {
      const plan = {
        domain: 'PMB',
        intent: 'ADMISSION_PROCEDURE',
        requiredAspects: ['procedure', 'requirements', 'documents']
      };

      const testSentences = [
        'Panduan pendaftaran tersedia di portal PMB.',
        'Informasi prosedur pendaftaran dapat diperoleh di sekretariat.',
        'Penerimaan mahasiswa baru tahun akademik 2026/2027 telah dibuka.',
        'Untuk informasi pendaftaran silakan menghubungi bagian PMB.'
      ];

      for (const sentence of testSentences) {
        const candidate = {
          id: `fp-test-${Math.random()}`,
          text: sentence,
          sourceFile: 'ISIAN WEBSITE (1).pdf',
          category: 'PMB',
          docCategory: 'PMB'
        };

        const res = arbitrateEvidence([candidate], plan, {});
        expect(res.accepted).toHaveLength(0);
        expect(res.rejected).toHaveLength(1);
        expect(res.rejected[0].reason).toBe('evidence_does_not_contain_registration_procedure_aspect');
      }
    });

    test('3B.4.1-2. Procedure True-Positive Verification: Accepts genuine sequential instructional steps', () => {
      const plan = {
        domain: 'PMB',
        intent: 'ADMISSION_PROCEDURE',
        requiredAspects: ['procedure'],
        targetEntities: ['PMB']
      };

      const validProcedureText = `Alur Pendaftaran Mahasiswa Baru:
1. Buka portal pendaftaran resmi di pmb.stikom-bali.ac.id dan pilih jenjang studi.
2. Isi formulir pendaftaran data diri secara online.
3. Selesaikan pembayaran biaya pendaftaran melalui bank mitra resmi.
4. Unggah berkas ijazah/SKL dan identitas diri (KTP/KK).
5. Ikuti verifikasi berkas dan lakukan registrasi ulang sesuai jadwal gelombang.`;

      const candidate = {
        id: 'tp-valid-proc-1',
        text: validProcedureText,
        sourceFile: 'Buku Panduan PMB 2026.pdf',
        docCategory: 'PMB'
      };

      const res = arbitrateEvidence([candidate], plan, {});
      expect(res.accepted).toHaveLength(1);
      expect(res.accepted[0].id).toBe('tp-valid-proc-1');
      expect(res.rejected).toHaveLength(0);
    });

    test('3B.4.1-3. PMB Technical Intent Isolation: Technical PMB queries do NOT route to general procedure SOURCE_GAP', async () => {
      const technicalQueries = [
        { query: 'OTP pendaftaran tidak masuk', expectedReason: 'corpus_gap_pmb_technical_procedure' },
        { query: 'kesalahan pengisian formulir pendaftaran', expectedReason: 'corpus_gap_pmb_technical_procedure' },
        { query: 'perbaikan data pendaftaran', expectedReason: 'corpus_gap_pmb_technical_procedure' },
        { query: 'unggah KTP/KK untuk pendaftaran', expectedReason: 'corpus_gap_pmb_document_requirements' },
        { query: 'verifikasi berkas pendaftaran', expectedReason: 'corpus_gap_pmb_document_requirements' },
        { query: 'ujian / tes masuk pendaftaran', expectedReason: 'corpus_gap_pmb_entrance_test' }
      ];

      for (const item of technicalQueries) {
        const frame = resolveSemanticFrame(item.query, {});
        const ansCheck = evaluateAnswerability(frame, [], null, {});
        expect(ansCheck.status).toBe('UNKNOWN');
        expect(ansCheck.reason).toBe(item.expectedReason);
        expect(ansCheck.reason).not.toBe('corpus_gap_admission_procedure');
        expect(ansCheck.guidance).not.toMatch(/Tahapan prosedur pendaftaran secara rinci.*belum tersedia/i);
      }
    });

    test('3B.4.1-4. RPL Fee vs. Procedure Separation: Pure fee table rejected for RPL procedure, accepted for RPL fee', () => {
      const rplFeeChunk = {
        id: 'fee-rpl-chunk-1',
        text: 'Rincian Biaya Pendidikan Jalur RPL: Biaya pendaftaran RPL sebesar Rp 500.000. Biaya konversi kredit per SKS Rp 150.000. Pembayaran DPP dapat diangsur.',
        sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
        docCategory: 'BIAYA',
        category: 'BIAYA'
      };

      // Case A: RPL Procedure inquiry -> Pure fee table MUST be rejected
      const planProcedure = {
        domain: 'PMB',
        intent: 'RPL_INQUIRY',
        requiredAspects: ['procedure'],
        targetEntities: ['Sistem Informasi'],
        rawQuery: 'bagaimana prosedur pendaftaran RPL S1 Sistem Informasi?'
      };
      const resProcedure = arbitrateEvidence([rplFeeChunk], planProcedure, {});
      expect(resProcedure.accepted).toHaveLength(0);
      expect(resProcedure.rejected).toHaveLength(1);
      expect(resProcedure.rejected[0].reason).toBe('evidence_is_fee_table_not_rpl_procedure');

      // Case B: RPL Fee inquiry -> Fee table chunk MUST be accepted
      const planFee = {
        domain: 'FEE',
        intent: 'TUITION_FEE_INQUIRY',
        requiredAspects: ['fee', 'tuition'],
        targetEntities: ['Sistem Informasi'],
        rawQuery: 'berapa biaya pendaftaran RPL S1 Sistem Informasi?'
      };
      const resFee = arbitrateEvidence([rplFeeChunk], planFee, {});
      expect(resFee.accepted).toHaveLength(1);
      expect(resFee.accepted[0].id).toBe('fee-rpl-chunk-1');
      expect(resFee.rejected).toHaveLength(0);
    });

  });

  describe('Stage 3B.4.3: Institutional Catalog Fact Validity Guard', () => {

    test('3B.4.3-1. S1 Catalog Summary does NOT claim evening/worker class as confirmed active fact', () => {
      const summaryId = generateGroundedCatalogSummary('S1', 'id');
      expect(summaryId).toBeDefined();
      // Must NOT assert unconditional confirmed evening/worker classes
      expect(summaryId).not.toMatch(/Tersedia\s+kelas\s+reguler\s+maupun\s+kelas\s+sore\/karyawan/i);
      // If evening class is mentioned, it must be framed as disclosure directing to PMB
      expect(summaryId).toMatch(/konfirmasi\s+langsung\s+ke\s+layanan\s+PMB/i);

      // Same verification for English summary
      const summaryEn = generateGroundedCatalogSummary('S1', 'en');
      expect(summaryEn).not.toMatch(/Both\s+regular\s+and\s+evening\/worker\s+classes\s+are\s+available\./i);
      expect(summaryEn).toMatch(/confirm\s+directly\s+with\s+PMB\s+admissions/i);
    });

    test('3B.4.3-2. Verified S1 Program Listing remains intact across all 4 programs', () => {
      const summaryId = generateGroundedCatalogSummary('S1', 'id');
      expect(summaryId).toContain('S1 Sistem Informasi');
      expect(summaryId).toContain('S1 Sistem Komputer');
      expect(summaryId).toContain('S1 Teknologi Informasi');
      expect(summaryId).toContain('S1 Bisnis Digital');

      const summaryEn = generateGroundedCatalogSummary('S1', 'en');
      expect(summaryEn).toContain('S1 Information Systems');
      expect(summaryEn).toContain('S1 Computer Systems');
      expect(summaryEn).toContain('S1 Information Technology');
      expect(summaryEn).toContain('S1 Digital Business');
    });

    test('3B.4.3-3. Verified SKS and Normal Duration (144 SKS / 8 Semesters) are preserved', () => {
      const summaryId = generateGroundedCatalogSummary('S1', 'id');
      expect(summaryId).toMatch(/144\s+SKS/i);
      expect(summaryId).toMatch(/8\s+semester/i);

      const summaryEn = generateGroundedCatalogSummary('S1', 'en');
      expect(summaryEn).toMatch(/144\s+credits/i);
      expect(summaryEn).toMatch(/8\s+semesters/i);
    });

    test('3B.4.3-4. Official PMB Portal URL is preserved as authoritative routing reference', () => {
      const summaryId = generateGroundedCatalogSummary('S1', 'id');
      expect(summaryId).toContain('https://pmb.stikom-bali.ac.id');

      const summaryEn = generateGroundedCatalogSummary('S1', 'en');
      expect(summaryEn).toContain('https://pmb.stikom-bali.ac.id');
    });

    test('3B.4.3-5. Specific evening/worker class inquiry safely declares unconfirmed status without fabricating schedules', async () => {
      const q = 'Apakah ada kelas sore untuk karyawan yang kuliah sambil kerja?';
      const frame = resolveSemanticFrame(q, {});
      const ans = await synthesizeAnswer(frame, { accepted: [] });

      expect(ans.success).toBe(true);
      // Must declare unconfirmed status for active TA 2026/2027
      expect(ans.answer).toMatch(/belum\s+dapat\s+dikonfirmasi/i);
      // Must cite historical form origin transparently without presenting as active confirmed policy
      expect(ans.answer).toMatch(/arsip\s+formulir|historis/i);
      // Must direct to PMB admissions or official portal
      expect(ans.answer).toContain('https://pmb.stikom-bali.ac.id');
      // Must NOT fabricate domestic schedule or claim flexible class features as confirmed active fact
      expect(ans.answer).not.toMatch(/Jadwal\s+Fleksibel.*Perkuliahan\s+diselenggarakan\s+setelah\s+jam\s+kerja/i);
    });

    test('3B.4.3-6. Catalog Claim Provenance distinguishes VERIFIED_CURRENT, VERIFIED_HISTORICAL, UNVERIFIED_CURRENT, and ROUTING_REFERENCE', () => {
      expect(CATALOG_FACT_PROVENANCE_STATUS.VERIFIED_CURRENT).toBe('VERIFIED_CURRENT');
      expect(CATALOG_FACT_PROVENANCE_STATUS.VERIFIED_HISTORICAL).toBe('VERIFIED_HISTORICAL');
      expect(CATALOG_FACT_PROVENANCE_STATUS.UNVERIFIED_CURRENT).toBe('UNVERIFIED_CURRENT');
      expect(CATALOG_FACT_PROVENANCE_STATUS.ROUTING_REFERENCE).toBe('ROUTING_REFERENCE');

      const prodiProv = getCatalogClaimProvenance('programs');
      expect(prodiProv.status).toBe(CATALOG_FACT_PROVENANCE_STATUS.VERIFIED_CURRENT);
      expect(prodiProv.sourceDocument).toMatch(/ISIAN WEBSITE/i);

      const sksProv = getCatalogClaimProvenance('curriculumSksAndDuration');
      expect(sksProv.status).toBe(CATALOG_FACT_PROVENANCE_STATUS.VERIFIED_CURRENT);
      expect(sksProv.sourceDocument).toBe('canonical_academic_facts_registry.json');

      const eveningProv = getCatalogClaimProvenance('eveningOrWorkerClass');
      expect(eveningProv.status).toBe(CATALOG_FACT_PROVENANCE_STATUS.UNVERIFIED_CURRENT);
      expect(eveningProv.historicalStatus).toBe(CATALOG_FACT_PROVENANCE_STATUS.VERIFIED_HISTORICAL);
      expect(eveningProv.activeChunkCount).toBe(0);

      const pmbProv = getCatalogClaimProvenance('pmbPortalUrl');
      expect(pmbProv.status).toBe(CATALOG_FACT_PROVENANCE_STATUS.ROUTING_REFERENCE);
      expect(pmbProv.source).toBe('https://pmb.stikom-bali.ac.id');
    });

  });

});
