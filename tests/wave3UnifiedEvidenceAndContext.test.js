'use strict';

/**
 * tests/wave3UnifiedEvidenceAndContext.test.js
 *
 * Regression & Architecture Verification Suite for Gelombang 3:
 * Unified RAG Evidence & Conversation Context
 *
 * Covers all 8 mandatory scenarios + Phase 2 RAG alignment without paid OpenAI API calls:
 * 1. Double Degree UTB -> cara mendaftar (Context & Procedure RAG Arbitration)
 * 2. Pertanyaan lokasi seluruh kampus (Umbrella entity & Renon/Jimbaran/Abiansemal chunks)
 * 3. Kontak kampus setelah pembahasan prodi (Topic switch isolation)
 * 4. Jadwal PMB setelah pembahasan prodi (Topic switch isolation even with "PMB-nya")
 * 5. Biaya gelombang tertentu setelah pembahasan prodi (Preserves active academic_program)
 * 6. Rekomendasi prodi dengan bukti RAG tersedia (Grounded synthesis & verification)
 * 7. Rekomendasi prodi dengan bukti RAG kosong (Fail-closedAnswerability Gate & Verifier)
 * 8. Pertanyaan multi-entitas lintas family (Independent entity arbitration, balanced top-10, multi-entity verifier)
 */

const { evaluateContextDependency } = require('../src/core/contextResolver');
const {
  resolveSemanticFrame,
  resolveSemanticFrameAsync,
  buildConciseConversationHistory
} = require('../src/core/semanticFrameResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { synthesizeAnswer, buildGenericExtractiveFallback } = require('../src/core/groundedAnswerGenerator');
const { verifyFinalAnswer, VERIFICATION_OUTCOME } = require('../src/core/finalAnswerVerifier');
const { selectBalancedEvidenceByEntity, processTurn } = require('../src/core/orchestrator');
const { executePhase2Bridge } = require('../src/reasoning/phase2Bridge');
const { PLAN_TYPE } = require('../src/reasoning/contracts');

describe('Gelombang 3 — Unified RAG Evidence & Conversation Context', () => {
  describe('Scenario 1: Double Degree UTB -> Cara Mendaftar (Context & Procedure Arbitration)', () => {
    test('Preserves INTERNATIONAL / PROGRAM_PROCEDURE context and passes concise conversationHistory to modelSemanticParser', async () => {
      const sessionData = {
        activeDomain: 'INTERNATIONAL',
        activeIntent: 'INTERNATIONAL_PROGRAM_INFO',
        activeEntity: 'Dual Degree UTB',
        lastQuery: 'Apa itu program Double Degree UTB?',
        lastResponseSummary: 'Program Double Degree UTB bekerja sama dengan Universitas Teknologi Bandung (S.Kom + S.Ds).',
        conversationHistory: [
          {
            user: 'Apa itu program Double Degree UTB?',
            bot: 'Program Double Degree UTB adalah kolaborasi ITB STIKOM Bali dengan Universitas Teknologi Bandung untuk meraih gelar S.Kom dan S.Ds.'
          }
        ]
      };

      const conciseHistory = buildConciseConversationHistory(sessionData);
      expect(conciseHistory.length).toBe(2);
      expect(conciseHistory[0].content.length).toBeLessThanOrEqual(150);
      expect(conciseHistory[1].content.length).toBeLessThanOrEqual(150);

      let capturedParserContext = null;
      const mockClient = {
        chat: {
          completions: {
            create: async (payload) => {
              const userMsg = payload.messages.find(m => m.role === 'user')?.content || '';
              capturedParserContext = userMsg;
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        speechAct: 'ASK_PROCEDURE',
                        primaryIntent: 'PROGRAM_PROCEDURE',
                        userInterest: null,
                        semanticConcepts: ['ADMISSION_REGISTRATION'],
                        candidateEntities: [
                          { rawMention: 'nya', canonicalHint: 'Dual Degree UTB', entityRole: 'inferred_from_context' }
                        ],
                        requestedAspects: ['procedure', 'requirements'],
                        scopeConstraints: { academicLevel: 'S1', studyMode: null, locationConstraint: null },
                        contextDependency: {
                          isFollowUp: true,
                          referenceType: 'pronoun_reference',
                          topicContinuity: 'CONTINUE_SAME_ENTITY',
                          relevantPriorContext: 'Dual Degree UTB'
                        },
                        executionRoute: 'FACTUAL_RAG',
                        confidence: 0.94,
                        ambiguityLevel: 'LOW'
                      })
                    }
                  }
                ]
              };
            }
          }
        }
      };

      const frame = await resolveSemanticFrameAsync('Bagaimana cara mendaftarnya?', sessionData, {
        client: mockClient
      });

      expect(capturedParserContext).toContain('Apa itu program Double Degree UTB?');
      expect(frame.domain).toBe('INTERNATIONAL');
      expect(frame.intent).toBe('PROGRAM_PROCEDURE');
      expect(frame.entities.some(e => e.canonical === 'Dual Degree UTB')).toBe(true);

      const plan = buildRetrievalPlan(frame);
      expect(plan.queryVariants.some(q => /pendaftaran|cara daftar|alur pendaftaran/i.test(q))).toBe(true);

      const candidates = [
        {
          id: 'utb-overview-proc',
          text: 'Pendaftaran Program Double Degree S1 Sistem Informasi / Teknologi Informasi + S1 DKV Universitas Teknologi Bandung (UTB) dilakukan melalui alur pendaftaran mahasiswa baru di pmb.stikom-bali.ac.id dengan memilih program Dual Degree UTB.',
          source: 'panduan_dual_degree_utb.pdf'
        },
        {
          id: 'general-pmb-proc',
          text: 'Alur pendaftaran mahasiswa baru ITB STIKOM Bali: 1. Registrasi online melalui pmb.stikom-bali.ac.id, 2. Melengkapi berkas persyaratan pendaftaran, 3. Mengikuti seleksi masuk.',
          source: 'panduan_pmb_stikom.pdf'
        },
        {
          id: 'pure-fee-chunk',
          text: 'Rincian Biaya Pendidikan Per Semester dan Potongan DPP Gelombang I sebesar 50% untuk program Dual Degree UTB Rp 9.500.000.',
          source: 'rincian_biaya_kuliah.pdf',
          docCategory: 'BIAYA'
        }
      ];

      const arbitrated = arbitrateEvidence(candidates, plan);
      const acceptedIds = arbitrated.accepted.map(c => c.id);
      expect(acceptedIds).toContain('utb-overview-proc');
      expect(acceptedIds).toContain('general-pmb-proc');
      expect(acceptedIds).not.toContain('pure-fee-chunk');
    });
  });

  describe('Scenario 2: Pertanyaan Lokasi Seluruh Kampus (Umbrella Campus Entity Arbitration)', () => {
    test('Accepts Renon, Jimbaran, and Abiansemal location chunks without requiring all 4 institution tokens in every chunk', () => {
      const frame = resolveSemanticFrame('Di mana saja lokasi kampus ITB STIKOM Bali?');
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('CAMPUS_LOCATION');
      expect(frame.entities.some(e => e.canonical === 'Kampus ITB STIKOM Bali')).toBe(true);

      const plan = buildRetrievalPlan(frame);
      const candidates = [
        {
          id: 'loc-renon',
          text: 'Kampus Renon berlokasi di Jl. Raya Puputan No. 86 Renon, Denpasar Timur, Bali.',
          source: 'profil_lokasi_kampus.pdf',
          docCategory: 'LOKASI'
        },
        {
          id: 'loc-jimbaran',
          text: 'Kampus Jimbaran beralamat di Jl. Raya Kampus Udayana Jimbaran, Kuta Selatan, Badung.',
          source: 'profil_lokasi_kampus.pdf',
          docCategory: 'LOKASI'
        },
        {
          id: 'loc-abiansemal',
          text: 'Kampus Abiansemal terletak di Jl. Dauh Yeh Cani, Abiansemal, Kabupaten Badung, Bali.',
          source: 'profil_lokasi_kampus.pdf',
          docCategory: 'LOKASI'
        },
        {
          id: 'unrelated-curriculum',
          text: 'Mata kuliah semester 1 di Kampus Renon meliputi Algoritma dan Pemrograman 3 SKS.',
          source: 'kurikulum_ti.pdf'
        }
      ];

      const arbitrated = arbitrateEvidence(candidates, plan);
      const acceptedIds = arbitrated.accepted.map(c => c.id);
      expect(acceptedIds).toEqual(['loc-renon', 'loc-jimbaran', 'loc-abiansemal']);
    });
  });

  describe('Scenario 3: Kontak Kampus Setelah Pembahasan Prodi (Topic Switch Isolation)', () => {
    test('Does NOT inherit S1 Sistem Informasi when user switches to asking campus contact', () => {
      const sessionData = {
        activeDomain: 'ACADEMIC_PROGRAM',
        activeIntent: 'PROGRAM_OVERVIEW',
        activeEntity: 'S1 Sistem Informasi',
        lastQuery: 'Apa saja yang dipelajari di S1 Sistem Informasi?'
      };

      const dep = evaluateContextDependency('Nomor WhatsApp atau kontak kampus yang bisa dihubungi berapa?', sessionData);
      expect(dep.shouldInherit).toBe(false);
      expect(dep.reason).toBe('campus_wide_domain_isolation');

      const frame = resolveSemanticFrame('Nomor WhatsApp atau kontak kampus yang bisa dihubungi berapa?', sessionData);
      expect(frame.domain).toBe('CAMPUS_SERVICE');
      expect(frame.intent).toBe('CONTACT_INQUIRY');
      expect(frame.entities.some(e => e.family === 'academic_program')).toBe(false);
    });
  });

  describe('Scenario 4: Jadwal PMB Setelah Pembahasan Prodi (Institutional Schedule Isolation)', () => {
    test('Does NOT inherit S1 Teknologi Informasi when user asks about PMB schedule even with "PMB-nya"', () => {
      const sessionData = {
        activeDomain: 'TUITION_FEE',
        activeIntent: 'TUITION_FEE_INQUIRY',
        activeEntity: 'S1 Teknologi Informasi',
        lastQuery: 'Berapa biaya kuliah S1 Teknologi Informasi?'
      };

      const dep = evaluateContextDependency('Kalau jadwal gelombang pendaftaran PMB-nya kapan dibuka?', sessionData);
      expect(dep.shouldInherit).toBe(false);
      expect(dep.reason).toBe('admission_schedule_isolation');

      const frame = resolveSemanticFrame('Kalau jadwal gelombang pendaftaran PMB-nya kapan dibuka?', sessionData);
      expect(frame.domain).toBe('PMB');
      expect(frame.intent).toBe('ADMISSION_SCHEDULE');
      expect(frame.entities.some(e => e.family === 'academic_program')).toBe(false);
    });
  });

  describe('Scenario 5: Biaya Gelombang Tertentu Setelah Pembahasan Prodi (Fee Follow-Up Continuity)', () => {
    test('Preserves active academic_program entity on wave-specific tuition fee follow-up', () => {
      const sessionData = {
        activeDomain: 'TUITION_FEE',
        activeIntent: 'TUITION_FEE_INQUIRY',
        activeEntity: 'S1 Bisnis Digital',
        lastQuery: 'Berapa biaya kuliah S1 Bisnis Digital?'
      };

      const dep = evaluateContextDependency('Kalau gelombang 2 berapa biayanya?', sessionData);
      expect(dep.shouldInherit).toBe(true);
      expect(dep.inheritedDomain).toBe('TUITION_FEE');
      expect(dep.inheritedEntity).toBe('S1 Bisnis Digital');

      const frame = resolveSemanticFrame('Kalau gelombang 2 berapa biayanya?', sessionData);
      expect(frame.domain).toBe('TUITION_FEE');
      expect(frame.intent).toBe('TUITION_FEE_INQUIRY');
      expect(frame.entities.some(e => e.canonical === 'S1 Bisnis Digital')).toBe(true);
      expect(frame.aspects).toContain('wave_discount');
    });
  });

  describe('Scenario 6: Rekomendasi Prodi Dengan Bukti RAG Tersedia', () => {
    test('Evaluates as ANSWERABLE and synthesizes grounded recommendation verified against RAG evidence', async () => {
      const frame = {
        rawQuery: 'Saya tertarik mengembangkan aplikasi mobile dan sistem cloud, jurusan apa yang cocok?',
        domain: 'ACADEMIC_RECOMMENDATION',
        intent: 'PROGRAM_RECOMMENDATION',
        userInterest: 'pengembangan aplikasi mobile dan komputasi awan (cloud)',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        entities: [],
        aspects: ['recommendation', 'program_fit'],
        ambiguityLevel: 'LOW'
      };

      const acceptedChunks = [
        {
          id: 'rag-ti-1',
          text: 'Program Studi S1 Teknologi Informasi mempelajari rekayasa perangkat lunak (software engineering), pemrograman web dan mobile, cloud computing, serta keamanan siber.',
          source: 'profil_prodi_itb_stikom_bali.pdf',
          supportedEntities: ['S1 Teknologi Informasi'],
          providedAspects: ['curriculum', 'recommendation', 'program_fit']
        }
      ];

      const answerability = evaluateAnswerability(frame, { accepted: acceptedChunks });
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);

      const fallbackRes = buildGenericExtractiveFallback(frame, acceptedChunks, { accepted: acceptedChunks });
      expect(fallbackRes.success).toBe(true);
      expect(fallbackRes.answer).toMatch(/S1 Teknologi Informasi/i);

      const verif = verifyFinalAnswer(fallbackRes.answer, frame, { accepted: acceptedChunks });
      expect(verif.pass).toBe(true);
      expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    });
  });

  describe('Scenario 7: Rekomendasi Prodi Dengan Bukti RAG Kosong (Strict Answerability Gate)', () => {
    test('Fails closed (UNKNOWN) and refuses to recommend from static PROGRAMS when RAG evidence is empty', async () => {
      const frame = {
        rawQuery: 'Saya suka merancang arsitektur jaringan komputer dan keamanan siber, jurusan apa yang cocok?',
        domain: 'ACADEMIC_RECOMMENDATION',
        intent: 'PROGRAM_RECOMMENDATION',
        userInterest: 'arsitektur jaringan komputer dan keamanan siber',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        entities: [],
        aspects: ['recommendation', 'program_fit'],
        ambiguityLevel: 'LOW'
      };

      // 1. Answerability gate must return UNKNOWN when accepted RAG evidence is empty
      const answerability = evaluateAnswerability(frame, { accepted: [] });
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
      expect(answerability.reason).toBe('insufficient_recommendation_evidence');

      // 2. synthesizeAnswer must NOT generate a recommendation from static PROGRAMS when accepted is []
      const synthRes = await synthesizeAnswer(frame, { accepted: [] }, null, {
        isBroadGuidance: false,
        scoredCandidates: [{ code: 'TI', name: 'S1 Teknologi Informasi' }]
      });
      expect(synthRes.success).toBe(false);
      expect(synthRes.reason).toBe('insufficient_recommendation_evidence');
      expect(synthRes.source).toBe('unanswerable_natural_guidance');

      // 3. Extractive fallback must also fail closed when accepted is []
      const extRes = buildGenericExtractiveFallback(frame, [], {
        accepted: [],
        recommendationResult: {
          isBroadGuidance: false,
          scoredCandidates: [{ code: 'TI', name: 'S1 Teknologi Informasi' }]
        }
      });
      expect(extRes.success).toBe(false);
      expect(extRes.reason).toBe('insufficient_recommendation_evidence');

      // 4. Final Answer Verifier must block any ungrounded recommendation answer if accepted is []
      const ungroundedRecAnswer = 'Berdasarkan minat Kakak, program studi yang selaras adalah *S1 Teknologi Informasi* karena mempelajari keamanan siber. Silakan hubungi admisi PMB ITB STIKOM Bali.';
      const verif = verifyFinalAnswer(ungroundedRecAnswer, frame, { accepted: [] });
      expect(verif.pass).toBe(false);
      expect(verif.reason).toBe('recommendation_lacks_accepted_evidence');
    });

    test('Broad/ambiguous clarification (ambiguityLevel: HIGH) remains allowed to ask clarifying questions without RAG evidence', () => {
      const ambiguousFrame = {
        rawQuery: 'Saya baru lulus SMA dan masih bingung mau kuliah jurusan apa',
        domain: 'ACADEMIC_RECOMMENDATION',
        intent: 'PROGRAM_RECOMMENDATION',
        entities: [],
        aspects: ['recommendation', 'program_fit'],
        ambiguityLevel: 'HIGH',
        isAmbiguous: true
      };

      const answerability = evaluateAnswerability(ambiguousFrame, { accepted: [] });
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.CLARIFY);
    });
  });

  describe('Scenario 8: Pertanyaan Multi-Entitas Lintas Family & Verifier Claim Alignment', () => {
    test('Preserves evidence across different entity families independently, balances top-10 slicing, and verifies multi-entity coverage & phone numbers', () => {
      const plan = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        targetEntities: ['S1 Sistem Informasi', 'Dual Degree UTB'],
        excludedConflictingEntities: [],
        requiredAspects: ['overview'],
        temporalConstraint: 'GENERAL'
      };

      // Generate 11 chunks for S1 Sistem Informasi and 1 chunk for Dual Degree UTB
      const candidates = [];
      for (let i = 1; i <= 11; i++) {
        candidates.push({
          id: `si-chunk-${i}`,
          text: `Profil singkat Program Studi S1 Sistem Informasi bagian ${i}: fokus pada analisis sistem enterprise dan manajemen basis data.`,
          source: 'profil_si.pdf'
        });
      }
      candidates.push({
        id: 'utb-chunk-1',
        text: 'Profil singkat Program Dual Degree UTB: kerja sama S1 Sistem Informasi / Teknologi Informasi dengan S1 DKV Universitas Teknologi Bandung.',
        source: 'profil_utb.pdf'
      });

      const arbitrated = arbitrateEvidence(candidates, plan);
      expect(arbitrated.accepted.length).toBe(12);
      expect(arbitrated.accepted.some(c => c.id === 'utb-chunk-1' && c.supportedEntities.includes('Dual Degree UTB'))).toBe(true);

      // Balanced top-10 selection must preserve 'utb-chunk-1' even though it was index 11!
      const balancedTop10 = selectBalancedEvidenceByEntity(arbitrated.accepted, plan.targetEntities, 10);
      expect(balancedTop10.length).toBe(10);
      expect(balancedTop10.some(c => c.id === 'utb-chunk-1')).toBe(true);
      expect(balancedTop10.some(c => c.supportedEntities.includes('S1 Sistem Informasi'))).toBe(true);

      // Verifier must reject an answer that completely omits one of the supported entities
      const frame = {
        rawQuery: 'Jelaskan tentang S1 Sistem Informasi dan Dual Degree UTB',
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        entities: [
          { canonical: 'S1 Sistem Informasi', family: 'academic_program' },
          { canonical: 'Dual Degree UTB', family: 'international_program' }
        ],
        aspects: ['overview']
      };

      const incompleteAnswer = 'Program Studi S1 Sistem Informasi berfokus pada analisis sistem enterprise dan manajemen basis data.';
      const vIncomplete = verifyFinalAnswer(incompleteAnswer, frame, { accepted: balancedTop10, retrievalPlan: plan });
      expect(vIncomplete.pass).toBe(false);
      expect(vIncomplete.reason).toMatch(/multi_entity_missing_supported_entity_in_answer/i);

      const completeAnswer = 'Program Studi S1 Sistem Informasi berfokus pada analisis sistem enterprise dan manajemen basis data. Sedangkan Program Dual Degree UTB merupakan kerja sama dengan S1 DKV Universitas Teknologi Bandung.';
      const vComplete = verifyFinalAnswer(completeAnswer, frame, { accepted: balancedTop10, retrievalPlan: plan });
      expect(vComplete.pass).toBe(true);

      // Verifier must also reject hallucinated phone numbers not present in accepted evidence
      const contactFrame = {
        rawQuery: 'Berapa nomor WhatsApp kampus?',
        domain: 'CAMPUS_SERVICE',
        intent: 'CONTACT_INQUIRY',
        entities: [],
        aspects: ['contact']
      };
      const contactEvidence = [
        {
          id: 'contact-1',
          text: 'Layanan informasi PMB ITB STIKOM Bali dapat dihubungi melalui WhatsApp 082247302220 atau telepon (0361) 244445.',
          source: 'kontak_pmb.pdf'
        }
      ];
      const badPhoneAnswer = 'Silakan hubungi WhatsApp resmi kami di nomor 081999888777.';
      const vBadPhone = verifyFinalAnswer(badPhoneAnswer, contactFrame, { accepted: contactEvidence });
      expect(vBadPhone.pass).toBe(false);
      expect(vBadPhone.reason).toMatch(/unsupported_contact_number_claim|unverified_phone_number_in_answer/i);
    });
  });

  describe('Phase 2 Alignment (RAG Gate & Default Disabled Invariant)', () => {
    test('Phase 2 is disabled by default in environment configuration', () => {
      expect(process.env.ENABLE_PHASE2_REASONING).not.toBe('true');
    });

    test('Phase 2 PLAN_TYPE.RECOMMENDATION executes RAG retrieval & enforces answerability gate when evidence is empty', async () => {
      const mockPlanner = {
        buildExecutionPlan: async () => ({
          success: true,
          plan: {
            planType: PLAN_TYPE.RECOMMENDATION,
            domain: 'ACADEMIC_RECOMMENDATION',
            intent: 'PROGRAM_RECOMMENDATION',
            targetEntities: ['S1 Astronomi Ruang Angkasa'],
            requiredAspects: ['recommendation', 'program_fit'],
            ambiguityLevel: 'LOW'
          }
        })
      };

      const res = await executePhase2Bridge(
        'test_p2_rec',
        'Saya ingin belajar astronomi ruang angkasa, prodi apa yang cocok?',
        {
          plannerModule: mockPlanner,
          retrieveCandidatesFn: async () => [],
          syncOnly: true,
          semanticFrame: {
            rawQuery: 'Saya ingin belajar astronomi ruang angkasa, prodi apa yang cocok?',
            domain: 'ACADEMIC_RECOMMENDATION',
            intent: 'PROGRAM_RECOMMENDATION',
            userInterest: 'astronomi ruang angkasa',
            entities: [],
            aspects: ['recommendation', 'program_fit'],
            ambiguityLevel: 'LOW'
          }
        },
        async () => ({
          chatId: 'test_p2_rec',
          finalAnswer: 'Mohon maaf Kak, informasi kurikulum resmi untuk minat tersebut belum dapat dipastikan dari dokumen yang tersedia saat ini.',
          subQueryResults: []
        })
      );

      expect(res.subQueryResults[0].answerability).toBe(ANSWERABILITY_STATUS.UNKNOWN);
      expect(res.arbitratedEvidence.accepted).toEqual([]);
    });
  });
});
