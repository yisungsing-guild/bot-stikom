'use strict';

/**
 * tests/focusedAccAndAdvisingFixes.test.js
 *
 * Focused Regression Suite for:
 * 1. ACC-01_var2: Institutional Accreditation ("Kampusnya sendiri sudah terakreditasi belum dan peringkatnya apa?")
 * 2. UNSEEN_academic_advisi_5: Academic Advising Delay ("Kalau terlambat bimbingan perwalian dampaknya apa?")
 */

const { processTurn } = require('../src/core/orchestrator');
const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { buildExecutionPlan, isAmbiguousEntityInquiry } = require('../src/reasoning/phase2Planner');
const { evaluateAnswerability } = require('../src/core/answerabilityGate');
const { buildGroundedDeterministicSummary, extractAccreditationFromEvidence } = require('../src/core/groundedAnswerGenerator');
const { INSTITUTIONAL_ACCREDITATION_RECORD } = require('../src/core/academicCatalog');

describe('Focused Fixes: Institutional Accreditation and Academic Advising Delay', () => {
  jest.setTimeout(45000);

  describe('Problem 1: Institutional Accreditation (ACC-01_var2)', () => {
    test('extractAccreditationFromEvidence does not extract PERGURUAN TINGGI as accreditation rank', () => {
      const mockChunks = [
        { text: 'STATUS AKREDITASI: PERGURUAN TINGGI TERAKREDITASI BAIK SEKALI BERDASARKAN KEPUTUSAN BAN-PT' }
      ];
      const rank = extractAccreditationFromEvidence(mockChunks);
      expect(rank).toBe('Baik Sekali');
      expect(rank).not.toBe('PERGURUAN TINGGI');
    });

    test('buildGroundedDeterministicSummary generates institutional accreditation rather than program terkait', () => {
      const frame = {
        domain: 'INSTITUTIONAL',
        intent: 'INSTITUTIONAL_ACCREDITATION',
        rawQuery: 'Kampusnya sendiri sudah terakreditasi belum dan peringkatnya apa?',
        entities: [],
        aspects: ['accreditation', 'peringkat']
      };
      const acceptedEvidence = [
        { text: 'Institut Teknologi dan Bisnis (ITB) STIKOM Bali terakreditasi Baik Sekali berdasarkan BAN-PT No. 3033/SK/BAN-PT/Ak.KP/PT/XII/2025' }
      ];
      const answer = buildGroundedDeterministicSummary(frame, acceptedEvidence, { accepted: acceptedEvidence });

      expect(answer).toMatch(/baik\s+sekali/i);
      expect(answer).toMatch(/ban-?pt/i);
      expect(answer).not.toMatch(/program\s+studi\s+\*\*program\s+terkait\*\*/i);
      expect(answer).not.toMatch(/status\s+akreditasi\s+resmi\s+\*\*perguruan\s+tinggi\*\*/i);
    });

    test('INSTITUTIONAL_ACCREDITATION_RECORD has valid provenance, decree number, and validity period', () => {
      expect(INSTITUTIONAL_ACCREDITATION_RECORD).toBeDefined();
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.institutionName).toBe('Institut Teknologi dan Bisnis (ITB) STIKOM Bali');
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.accreditationRank).toBe('Baik Sekali');
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.accreditationDecree).toBe('3033/SK/BAN-PT/Ak.KP/PT/XII/2025');
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.accreditingAgency).toBe('BAN-PT');
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.startDate).toBe('10 Desember 2025');
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.endDate).toBe('14 November 2028');
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.validFrom).toBe('2025-12-10');
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.validTo).toBe('2028-11-14');
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.accreditationValidity).toBe('10 Desember 2025 sampai dengan 14 November 2028');
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.verificationStatus).toBe('VERIFIED_OFFICIAL_PORTAL');
      expect(INSTITUTIONAL_ACCREDITATION_RECORD.sourceUrl).toBe('https://stikom-bali.ac.id/akreditasi/');
    });

    test('Negative Evidence Guard: buildGroundedDeterministicSummary returns null if official institutional evidence is missing', () => {
      const frame = {
        domain: 'INSTITUTIONAL',
        intent: 'INSTITUTIONAL_ACCREDITATION',
        rawQuery: 'Kampusnya sendiri sudah terakreditasi belum dan peringkatnya apa?',
        entities: [],
        aspects: ['accreditation']
      };
      // Irrelevant evidence (e.g. food court or sports club)
      const irrelevantEvidence = [
        { text: 'Kantin ITB STIKOM Bali menyediakan berbagai pilihan makanan dan minuman sehat bagi mahasiswa.' }
      ];
      const answer = buildGroundedDeterministicSummary(frame, irrelevantEvidence, { accepted: irrelevantEvidence });
      // Must return null to avoid declaring ungrounded rank as fact
      expect(answer).toBeNull();
    });

    test('Separation: Institutional accreditation inquiry does NOT collide with program accreditation', () => {
      // 1. Program-specific accreditation inquiry
      const prodiFrame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_ACCREDITATION',
        rawQuery: 'Akreditasi program studi S1 Sistem Informasi apa?',
        entities: ['S1 Sistem Informasi'],
        aspects: ['accreditation']
      };
      const prodiEvidence = [
        { text: 'Program Studi S1 Sistem Informasi di ITB STIKOM Bali terakreditasi Unggul berdasarkan keputusan LAM-INFOKOM.' }
      ];
      const prodiAnswer = buildGroundedDeterministicSummary(prodiFrame, prodiEvidence, { accepted: prodiEvidence });
      expect(prodiAnswer).toMatch(/Program Studi \*\*S1 Sistem Informasi\*\*/i);
      expect(prodiAnswer).not.toMatch(/Akreditasi perguruan tinggi ini/i);

      // 2. Institutional accreditation inquiry
      const instFrame = {
        domain: 'INSTITUTIONAL',
        intent: 'INSTITUTIONAL_ACCREDITATION',
        rawQuery: 'Kampusnya sendiri sudah terakreditasi belum dan peringkatnya apa?',
        entities: [],
        aspects: ['accreditation']
      };
      const instEvidence = [
        { text: 'ITB STIKOM Bali terakreditasi perguruan tinggi Baik Sekali berdasarkan BAN-PT No. 3033/SK/BAN-PT/Ak.KP/PT/XII/2025.' }
      ];
      const instAnswer = buildGroundedDeterministicSummary(instFrame, instEvidence, { accepted: instEvidence });
      expect(instAnswer).toMatch(/telah terakreditasi institusi secara resmi oleh \*\*BAN-PT\*\* dengan peringkat \*\*Baik Sekali\*\*/i);
      expect(instAnswer).toMatch(new RegExp(INSTITUTIONAL_ACCREDITATION_RECORD.accreditationValidity, 'i'));
      expect(instAnswer).toMatch(/terpisah dari akreditasi masing-masing program studi/i);
      // Must NOT contain unsupported quality guarantee claims (tata kelola, tenaga pengajar, fasilitas, kurikulum)
      expect(instAnswer).not.toMatch(/jaminan\s+standar\s+mutu|tata\s+kelola|tenaga\s+pengajar|fasilitas.*kurikulum/i);
      expect(instAnswer).not.toMatch(/Program Studi \*\*program terkait\*\*/i);

      // 3. English institutional accreditation inquiry
      const instAnswerEn = buildGroundedDeterministicSummary({ ...instFrame, language: 'en' }, instEvidence, { accepted: instEvidence });
      expect(instAnswerEn).toMatch(/officially accredited by \*\*BAN-PT\*\* with an institutional accreditation rank of \*\*Baik Sekali\*\*/i);
      expect(instAnswerEn).toMatch(new RegExp(INSTITUTIONAL_ACCREDITATION_RECORD.accreditationValidityEn, 'i'));
      expect(instAnswerEn).toMatch(/separate from the accreditation rank of each individual study program/i);
      expect(instAnswerEn).not.toMatch(/guarantees\s+official\s+educational\s+quality|governance|curriculum\s+standards/i);
    });

    test('End-to-end processTurn for ACC-01_var2 returns officially supported institutional accreditation', async () => {
      const q = 'Kampusnya sendiri sudah terakreditasi belum dan peringkatnya apa?';
      const result = await processTurn('test_session_acc_01', q);

      expect(result).toBeDefined();
      expect(result.finalAnswer).toBeDefined();

      const ans = result.finalAnswer.toLowerCase();
      // Must contain official institutional status "Baik Sekali" and BAN-PT
      expect(ans).toMatch(/baik\s+sekali/i);
      expect(ans).toMatch(/ban-?pt/i);
      // Must contain official validity period from INSTITUTIONAL_ACCREDITATION_RECORD
      expect(ans).toMatch(new RegExp(INSTITUTIONAL_ACCREDITATION_RECORD.accreditationValidity, 'i'));
      // Must NOT contain unconfirmed 2030 date
      expect(ans).not.toMatch(/2030/i);
      // Must NOT state unsupported quality guarantee claims
      expect(ans).not.toMatch(/jaminan\s+standar\s+mutu|tata\s+kelola|tenaga\s+pengajar/i);
      // Must explicitly separate institutional from study program accreditation
      expect(ans).toMatch(/terpisah dari akreditasi masing-masing program studi/i);
      // Must NOT hallucinate "program terkait"
      expect(ans).not.toMatch(/program\s+studi\s+\*\*program\s+terkait\*\*/i);
      expect(ans).not.toMatch(/status\s+akreditasi\s+resmi\s+\*\*perguruan\s+tinggi\*\*/i);
    });
  });

  describe('Problem 2: Academic Advising Delay (UNSEEN_academic_advisi_5)', () => {
    test('Negative Evidence Guard: buildGroundedDeterministicSummary returns null if perwalian evidence is absent', () => {
      const frame = {
        domain: 'ACADEMIC_PROCESS',
        intent: 'ACADEMIC_ADVISING_INQUIRY',
        rawQuery: 'Kalau terlambat bimbingan perwalian dampaknya apa?',
        aspects: ['academic_advising', 'dosen_wali'],
        entities: []
      };
      // Irrelevant evidence (e.g. UKM Tari)
      const unrelatedEvidence = [
        { text: 'Unit Kegiatan Mahasiswa Tari Tradisional PRAGINA melestarikan kebudayaan seni tari Bali di lingkungan kampus.' }
      ];
      const answer = buildGroundedDeterministicSummary(frame, unrelatedEvidence, { accepted: unrelatedEvidence });
      // Must strictly refuse ungrounded generation
      expect(answer).toBeNull();
    });

    test('Negative Evidence Guard: No unproven emails or procedures emitted when evidence lacks them', () => {
      const frame = {
        domain: 'ACADEMIC_PROCESS',
        intent: 'ACADEMIC_ADVISING_INQUIRY',
        rawQuery: 'Bagaimana pelaksanaan bimbingan perwalian di STIKOM Bali?',
        aspects: ['academic_advising', 'dosen_wali'],
        entities: []
      };
      // Evidence only mentions consultation with Dosen Wali, no email and no polling requirements
      const bareEvidence = [
        { text: 'Perwalian di ITB STIKOM Bali mewajibkan mahasiswa berkonsultasi dengan Dosen Wali sebelum perkuliahan dimulai.' }
      ];
      const answer = buildGroundedDeterministicSummary(frame, bareEvidence, { accepted: bareEvidence });
      expect(answer).toBeDefined();
      // Must NOT hallucinate any email address
      expect(answer).not.toMatch(/@[a-zA-Z0-9.-]+/);
      // Must NOT mention unproven requirements
      expect(answer).not.toMatch(/polling/i);
      // Must adhere strictly to proven aspect
      expect(answer).toMatch(/Dosen Wali/i);
    });

    test('isAmbiguousEntityInquiry returns false for perwalian / academic advising queries', async () => {
      const q = 'Kalau terlambat bimbingan perwalian dampaknya apa?';
      const frame = await resolveSemanticFrame(q, { currentSession: { history: [] } });

      const isAmbiguous = isAmbiguousEntityInquiry(q, frame);
      expect(isAmbiguous).toBe(false);

      const plan = buildExecutionPlan(q, {}, { semanticFrame: frame });
      expect(plan.plan.planType).not.toBe('AMBIGUOUS_CLARIFICATION');
    });

    test('Multi-language / surface variation robustness: Resolves intent consistently without sentence-specific handlers', async () => {
      const variations = [
        'Kalau telat bimbingan akademik dosen wali gimana ya?', // Informal Indonesian
        'Apa konsekuensi jika terlambat melakukan proses perwalian online?', // Formal Indonesian
        'What is the consequence if a student is late for academic advising?' // English
      ];

      for (const query of variations) {
        const frame = await resolveSemanticFrame(query, { currentSession: { history: [] } });
        expect(frame.domain).toMatch(/ACADEMIC_PROCESS|ACADEMIC/);
        expect(frame.intent).toMatch(/ACADEMIC_ADVISING_INQUIRY|ACADEMIC_TIMELINE/);

        const isAmbiguous = isAmbiguousEntityInquiry(query, frame);
        expect(isAmbiguous).toBe(false);

        const plan = buildExecutionPlan(query, {}, { semanticFrame: frame });
        expect(plan.plan.planType).not.toBe('AMBIGUOUS_CLARIFICATION');
      }
    });

    test('evaluateAnswerability accepts perwalian/academic_advising aspects from accepted evidence', () => {
      const frame = {
        domain: 'ACADEMIC_PROCESS',
        intent: 'ACADEMIC_ADVISING_INQUIRY',
        aspects: ['academic_advising', 'dosen_wali', 'krs'],
        entities: []
      };
      const arbResult = {
        accepted: [
          { text: 'Mahasiswa yang terlambat melakukan perwalian sesuai jadwal yang ditentukan agar segera menghubungi Tim Support Perwalian untuk penanganan lebih lanjut dengan NIM dan Nama.' }
        ],
        rejected: []
      };

      const ansGate = evaluateAnswerability(frame, arbResult);
      expect(ansGate.status).toBe('ANSWERABLE');
      expect(ansGate.missingAspects).toEqual([]);
    });

    test('evaluateEvidenceCompatibility strictly rejects unverified FAQ chunks across all field variations', () => {
      const { evaluateEvidenceCompatibility } = require('../src/core/evidenceArbiter');
      const plan = {
        domain: 'ACADEMIC_PROCESS',
        intent: 'ACADEMIC_ADVISING_INQUIRY',
        requiredAspects: ['academic_advising']
      };

      // Variation A: standard governance object
      const unverifiedChunkA = {
        id: 'faq-chunk-1',
        sourceFile: 'FAQ_Sistem_Informasi_Perwalian_Online_EKRS.txt',
        filename: 'FAQ Sistem Informasi Perwalian Online (E-KRS) ITB STIKOM Bali',
        text: 'Mahasiswa yang terlambat perwalian dapat menghubungi Tim Support Perwalian supportperwalian@stikom-bali.ac.id.',
        governance: {
          verificationStatus: 'UNVERIFIED_TRANSCRIPTION_PENDING_OFFICIAL_RAW_COMPARISON',
          authenticityStatus: 'UNVERIFIED_TRANSCRIPTION_PENDING_OFFICIAL_RAW_COMPARISON'
        }
      };
      expect(evaluateEvidenceCompatibility(unverifiedChunkA, plan).disposition).toBe('REJECT_UNVERIFIED_PROVENANCE');

      // Variation B: metadata object (e.g. pgvector / db candidate)
      const unverifiedChunkB = {
        id: 'faq-chunk-2',
        source_file: 'FAQ_Sistem_Informasi_Perwalian_Online_EKRS.txt',
        text: 'Prosedur keterlambatan perwalian semester genap.',
        metadata: {
          verificationStatus: 'UNVERIFIED_PENDING_SOURCE_COMPARISON'
        }
      };
      expect(evaluateEvidenceCompatibility(unverifiedChunkB, plan).disposition).toBe('REJECT_UNVERIFIED_PROVENANCE');

      // Variation C: raw_metadata object (e.g. raw PostgreSQL row)
      const unverifiedChunkC = {
        id: 'faq-chunk-3',
        source: 'faq_perwalian_raw.txt',
        text: 'Hubungi kanal Teams untuk perwalian susulan.',
        raw_metadata: {
          authenticityStatus: 'UNVERIFIED'
        }
      };
      expect(evaluateEvidenceCompatibility(unverifiedChunkC, plan).disposition).toBe('REJECT_UNVERIFIED_PROVENANCE');
    });

    test('Unverified FAQ cannot be sole basis for official claims: Generator provides natural guidance that details are unconfirmed', () => {
      const frame = {
        domain: 'ACADEMIC_PROCESS',
        intent: 'ACADEMIC_ADVISING_INQUIRY',
        rawQuery: 'Kalau terlambat bimbingan perwalian dampaknya apa?',
        aspects: ['academic_advising', 'dosen_wali'],
        entities: []
      };
      const unverifiedEvidence = [
        {
          sourceFile: 'FAQ_Sistem_Informasi_Perwalian_Online_EKRS.txt',
          text: 'Mahasiswa yang terlambat melakukan perwalian wajib lapor ke supportperwalian@stikom-bali.ac.id.',
          governance: {
            verificationStatus: 'UNVERIFIED_TRANSCRIPTION_PENDING_OFFICIAL_RAW_COMPARISON'
          }
        }
      ];

      const answer = buildGroundedDeterministicSummary(frame, unverifiedEvidence, { accepted: unverifiedEvidence });
      expect(answer).toBeDefined();
      // Must NOT state unverified contact as official fact
      expect(answer).not.toMatch(/supportperwalian@stikom-bali\.ac\.id/i);
      expect(answer).not.toMatch(/microsoft\s+teams/i);
      // Must state that details cannot be confirmed from verified official documents
      expect(answer).toMatch(/belum dapat dipastikan dari dokumen resmi yang terverifikasi/i);
      // Must direct to legitimate institutional channels (Dosen Wali / BAAK)
      expect(answer).toMatch(/dosen\s+wali/i);
      expect(answer).toMatch(/baak/i);
    });

    test('Verified official documents are still accepted by arbiter and processed normally', () => {
      const { evaluateEvidenceCompatibility } = require('../src/core/evidenceArbiter');
      const verifiedDoc = {
        id: 'official-doc-1',
        sourceFile: 'Pedoman Skripsi 2026',
        filename: 'Pedoman Skripsi 2026',
        text: 'Pedoman Skripsi dan Tugas Akhir ITB STIKOM Bali Tahun 2026 kurikulum resmi.',
        governance: {
          verificationStatus: 'VERIFIED_OFFICIAL_RECORD',
          authenticityStatus: 'VERIFIED_INTERNAL_PORTAL'
        }
      };
      const plan = {
        domain: 'ACADEMIC_CURRICULUM',
        intent: 'CURRICULUM_INQUIRY',
        requiredAspects: ['curriculum']
      };
      const res = evaluateEvidenceCompatibility(verifiedDoc, plan);
      expect(res.accepted).toBe(true);
    });

    test('buildGroundedDeterministicSummary addresses late perwalian consequence and contact procedure from verified evidence only', () => {
      const frame = {
        domain: 'ACADEMIC_PROCESS',
        intent: 'ACADEMIC_ADVISING_INQUIRY',
        rawQuery: 'Kalau terlambat bimbingan perwalian dampaknya apa?',
        aspects: ['academic_advising', 'dosen_wali', 'krs'],
        entities: []
      };
      const verifiedEvidence = [
        {
          sourceFile: 'Edaran_Resmi_Akademik_Perwalian.pdf',
          text: 'Mahasiswa yang terlambat melakukan perwalian sesuai jadwal yang telah ditentukan agar segera menghubungi Tim Support Perwalian untuk mendapatkan arahan dan penanganan lebih lanjut dengan NIM dan Nama lengkap melalui Microsoft Teams supportperwalian@stikom-bali.ac.id.'
        }
      ];

      const answer = buildGroundedDeterministicSummary(frame, verifiedEvidence, { accepted: verifiedEvidence });
      expect(answer).toMatch(/tim\s+support\s+perwalian/i);
      expect(answer).toMatch(/nim/i);
      expect(answer).toMatch(/supportperwalian@stikom-bali\.ac\.id/i);
      expect(answer).not.toMatch(/mohon\s+jelaskan\s+program\s+studi\s+mana/i);
    });

    test('End-to-end processTurn for UNSEEN_academic_advisi_5 answers perwalian naturally when FAQ is isolated, without falling to prodi clarification', async () => {
      const q = 'Kalau terlambat bimbingan perwalian dampaknya apa?';
      const result = await processTurn('test_session_advising_isolated', q);

      expect(result).toBeDefined();
      expect(result.finalAnswer).toBeDefined();

      const ans = result.finalAnswer.toLowerCase();
      // Must NOT hijack to program clarification
      expect(ans).not.toMatch(/mohon\s+jelaskan\s+program\s+studi\s+mana/i);
      expect(ans).not.toMatch(/silakan\s+sebutkan\s+program\s+studi\s+pilihan\s+kakak/i);

      // Must address perwalian / dosen wali context
      expect(ans).toMatch(/(?:perwalian|dosen\s+wali)/i);

      // Must NOT assert unverified email as official fact
      expect(ans).not.toMatch(/supportperwalian@stikom-bali\.ac\.id/i);

      const sub = result.subQueryResults?.[0] || {};
      expect(sub.answerability?.status).not.toBe('CLARIFICATION_REQUIRED');
    });
  });
});
