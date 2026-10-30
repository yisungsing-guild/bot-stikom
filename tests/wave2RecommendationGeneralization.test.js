'use strict';

/**
 * tests/wave2RecommendationGeneralization.test.js
 *
 * Wave 2 Final Architecture Validation Suite:
 * AI-Led Semantic Understanding & Grounded Curriculum Synthesis
 * (Zero Lexical Phrase Matching or Heuristic Score Crowning).
 *
 * Verifies:
 * 1. Phrasing variations with identical meaning resolved via semantic parser + AI synthesis.
 * 2. Semantic relationships sharing ZERO identical phrases with the curriculum text.
 * 3. Multiple relevant study programs compared fairly based on official curriculum profiles.
 * 4. Conflicting user preferences/constraints handled with curriculum trade-offs and clarification.
 * 5. Clarification requested when semantic interpretation is ambiguous (ambiguityLevel: 'HIGH').
 * 6. Recommendation reasons strictly anchored to official curriculum evidence.
 * 7. Neutral fallback without heuristic scores or static winners when AI is disabled or fails,
 *    plus SAFE_UNKNOWN when evidence is insufficient.
 */

const { processTurn } = require('../src/core/orchestrator');
const {
  computeCandidateScores,
  classifyPresentationType,
  evaluateRecommendation
} = require('../src/reasoning/recommendationEngine');
const {
  PROGRAMS,
  detectProgramFitSignals,
  getProgramFitCandidates
} = require('../src/engine/programFitReasoning');
const { verifyFinalAnswer, VERIFICATION_OUTCOME } = require('../src/core/finalAnswerVerifier');
const { sanitizeWhatsAppMarkdown } = require('../src/core/outboundRenderer');
const {
  buildSynthesisPrompt,
  renderRecommendationAnswer,
  synthesizeAnswer
} = require('../src/core/groundedAnswerGenerator');
const {
  parseSemanticInterpretation,
  validateInterpretationSchema,
  buildSafeUnknownInterpretation
} = require('../src/core/modelSemanticParser');
const { resolveSemanticFrameAsync } = require('../src/core/semanticFrameResolver');

/**
 * Helper to create a mocked two-stage AI pipeline:
 * - Call 1: Semantic Parser (`parseSemanticInterpretation` via `options.client`)
 * - Call 2: Grounded Synthesis (`synthesizeAnswer` via `options.aiEngine`)
 */
function createMockAiPipeline(parserPayload, synthesisReplyText) {
  const capturedPrompts = [];
  const mockParserClient = {
    chat: {
      completions: {
        create: async () => ({
          model: 'gpt-4o-mini',
          choices: [{ message: { content: JSON.stringify(parserPayload) } }]
        })
      }
    }
  };

  const mockAiEngine = {
    apiKey: 'test-local-mock-key',
    model: 'gpt-4o-mini',
    client: {
      chat: {
        completions: {
          create: async (payload) => {
            capturedPrompts.push(payload);
            return {
              model: 'gpt-4o-mini',
              usage: { prompt_tokens: 300, completion_tokens: 120 },
              choices: [{ message: { content: synthesisReplyText } }]
            };
          }
        }
      }
    }
  };

  return { mockParserClient, mockAiEngine, capturedPrompts };
}

describe('Wave 2 Final: AI-Led Semantic Understanding & Grounded Curriculum Synthesis Suite', () => {

  describe('1. Zero Lexical Phrase Matching & Zero Heuristic Score Crowning Invariants', () => {
    test('PROGRAMS contains official curriculum metadata without manual keyword-matching arrays or workStyleBaseScore', () => {
      for (const prog of Object.values(PROGRAMS)) {
        expect(prog.curriculumProfile).toBeDefined();
        expect(typeof prog.curriculumProfile.studyFocus).toBe('string');
        expect(typeof prog.curriculumProfile.suitableFor).toBe('string');
        expect(typeof prog.curriculumProfile.careerProspects).toBe('string');

        // Ensure lexical keyword lists and heuristic base scores are completely removed
        expect(prog.curriculumProfile.coreTopics).toBeUndefined();
        expect(prog.curriculumProfile.interdisciplinaryTopics).toBeUndefined();
        expect(prog.curriculumProfile.workStyleFit).toBeUndefined();
        expect(prog.curriculumProfile.workStyleBaseScore).toBeUndefined();
        expect(prog.curriculumProfile.intensiveRequirements).toBeUndefined();
      }
    });

    test('evaluateRecommendation gathers curriculum profiles neutrally without crowning DOMINANT_SINGLE or heuristic rawScore', () => {
      const frame = {
        domain: 'ACADEMIC_RECOMMENDATION',
        intent: 'PROGRAM_RECOMMENDATION',
        userInterest: 'pengembangan ekosistem komersial daring',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        ambiguityLevel: 'LOW'
      };
      const result = evaluateRecommendation('Saya ingin kuliah di STIKOM Bali', {}, frame);

      expect(result.presentationType).toBe('NEUTRAL_CURRICULUM_OVERVIEW');
      expect(result.scoredCandidates.length).toBeGreaterThan(1);
      for (const cand of result.scoredCandidates) {
        expect(cand.rawScore).toBeNull();
        expect(cand.confidence).toBe('NEUTRAL');
        expect(cand.level).toBe('candidate');
      }
    });

    test('computeCandidateScores does not assign static fallback scores when signal.weights is absent', () => {
      const unweighedSignals = [
        {
          key: 'legacy_unweighed_signal',
          label: 'Unweighed Signal',
          candidates: [
            ['ti', 'primary', 'Legacy primary without curriculum weight'],
            ['si', 'alternative', 'Legacy alternative without curriculum weight']
          ]
        }
      ];
      const scored = computeCandidateScores(unweighedSignals);
      expect(scored).toEqual([]);
    });
  });

  describe('2. Scenario 1: Phrasing Variations with Identical Semantic Meaning', () => {
    const phrasingVariants = [
      'Hobi saya memandu sesi belanja interaktif lewat siaran langsung agar penonton tertarik checkout barang, cocok masuk prodi apa?',
      'Saya senang membangun audiens di platform video pendek untuk mempromosikan katalog dagangan toko daring, jurusan apa yang pas?',
      'Passion saya merancang kampanye promosi komersial di jejaring sosial dan meningkatkan konversi pembeli online, prodi apa yang relevan?'
    ];

    for (const query of phrasingVariants) {
      test(`Phrasing variation resolved via semantic parser + grounded AI synthesis: "${query}"`, async () => {
        const parserOutput = {
          speechAct: 'SEEK_ADVICE',
          primaryIntent: 'PROGRAM_RECOMMENDATION',
          userInterest: 'pemasaran interaktif kanal digital dan konversi perdagangan daring',
          semanticConcepts: ['ACADEMIC_OFFERING', 'CAREER_EMPLOYMENT'],
          candidateEntities: [],
          requestedAspects: ['curriculum', 'career'],
          scopeConstraints: { academicLevel: 'S1', studyMode: null, locationConstraint: null },
          contextDependency: { isFollowUp: false, referenceType: 'none', topicContinuity: 'NEW_TOPIC', relevantPriorContext: null },
          executionRoute: 'ACADEMIC_RECOMMENDATION',
          confidence: 0.94,
          ambiguityLevel: 'LOW'
        };

        const groundedSynthesisReply = [
          'Berdasarkan minat Kakak pada pemasaran interaktif dan konversi perdagangan daring, program studi yang selaras untuk dipertimbangkan adalah *S1 Bisnis Digital*.',
          '*Alasan Keselarasan Kurikulum:*',
          '- Fokus kajian kurikulum *S1 Bisnis Digital* mencakup digital marketing, e-commerce, strategi branding produk digital, social media marketing, live commerce, serta analisis pasar dan perilaku konsumen digital.',
          '- Prospek karier lulusannya meliputi Digital Marketing Specialist, E-Commerce Specialist, dan Brand Strategist.',
          'Apakah Kakak lebih tertarik mendalami strategi pemasaran & branding produk digital, atau pengelolaan rintisan bisnis (startup) e-commerce?',
          'Catatan: Rekomendasi ini merupakan panduan awal berbasis kurikulum resmi ITB STIKOM Bali. Silakan berkonsultasi lebih lanjut dengan bagian admisi PMB ITB STIKOM Bali.'
        ].join('\n');

        const { mockParserClient, mockAiEngine, capturedPrompts } = createMockAiPipeline(parserOutput, groundedSynthesisReply);

        const turn = await processTurn('test_var_' + Date.now(), query, {
          executeDispatch: false,
          client: mockParserClient,
          aiEngine: mockAiEngine
        });

        const sub = turn.subQueryResults[0];
        expect(sub.frame.domain).toBe('ACADEMIC_RECOMMENDATION');
        expect(sub.frame.intent).toBe('PROGRAM_RECOMMENDATION');
        expect(sub.frame.userInterest).toBe('pemasaran interaktif kanal digital dan konversi perdagangan daring');
        expect(sub.verification.pass).toBe(true);

        // Verify the AI synthesis prompt received both the parsed semantic interpretation and official curriculum profiles
        expect(capturedPrompts.length).toBe(1);
        const userPromptSent = capturedPrompts[0].messages.find(m => m.role === 'user').content;
        expect(userPromptSent).toContain('pemasaran interaktif kanal digital dan konversi perdagangan daring');
        expect(userPromptSent).toContain('[Profil Kurikulum Resmi');
        expect(userPromptSent).toContain('S1 Bisnis Digital');

        expect(turn.finalAnswer).toMatch(/S1 Bisnis Digital/i);
        expect(turn.finalAnswer).toMatch(/admisi PMB/i);
        expect(turn.finalAnswer).not.toMatch(/\bpasti\s+cocok\b/i);
      });
    }
  });

  describe('3. Scenario 2: Semantic Relationships Without Identical Phrases in Curriculum Text', () => {
    test('User query and userInterest share ZERO domain words with PROGRAMS.bd, yet AI synthesis connects meaning to S1 Bisnis Digital curriculum', async () => {
      // Notice: Neither rawQuery nor userInterest contains "bisnis", "digital", "marketing", "e-commerce", "branding", "pasar", "konsumen", "startup", "live", "sosmed"
      const rawQuery = 'Saya gemar mengamati psikologi belanja masyarakat saat memilih barang di etalase virtual dan merancang taktik persuasi agar omzet pelapak melejit';
      const parserOutput = {
        speechAct: 'SEEK_ADVICE',
        primaryIntent: 'PROGRAM_RECOMMENDATION',
        userInterest: 'psikologi keputusan pembeli di etalase virtual dan taktik persuasi pertumbuhan omzet pelapak',
        semanticConcepts: ['ACADEMIC_OFFERING', 'CAREER_EMPLOYMENT'],
        candidateEntities: [],
        requestedAspects: ['curriculum', 'career'],
        scopeConstraints: { academicLevel: 'S1', studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none', topicContinuity: 'NEW_TOPIC', relevantPriorContext: null },
        executionRoute: 'ACADEMIC_RECOMMENDATION',
        confidence: 0.91,
        ambiguityLevel: 'LOW'
      };

      expect(validateInterpretationSchema(parserOutput).valid).toBe(true);

      const groundedSynthesisReply = [
        'Ketertarikan Kakak dalam mempelajari psikologi keputusan pembeli di etalase virtual dan strategi peningkatan omzet sangat berkaitan erat dengan kurikulum *S1 Bisnis Digital* di ITB STIKOM Bali.',
        '*Keterkaitan dengan Bukti Kurikulum Resmi:*',
        '- Kurikulum *S1 Bisnis Digital* secara khusus mempelajari analisis pasar dan perilaku konsumen digital, e-commerce, digital marketing, serta strategi branding produk digital.',
        '- Selain itu, *S1 Sistem Informasi* juga dapat dipertimbangkan apabila Kakak tertarik mengolah data transaksi pelanggan melalui business intelligence & analytics.',
        'Untuk membantu mempertajam pilihan, apakah Kakak lebih ingin fokus pada strategi komersial & pemasaran konsumen (S1 Bisnis Digital) atau pengolahan data analitik perusahaan (S1 Sistem Informasi)?',
        'Catatan: Informasi ini disusun berdasarkan kurikulum resmi ITB STIKOM Bali. Untuk konsultasi kurikulum dan pendaftaran resmi, silakan menghubungi admisi PMB ITB STIKOM Bali.'
      ].join('\n');

      const { mockParserClient, mockAiEngine, capturedPrompts } = createMockAiPipeline(parserOutput, groundedSynthesisReply);

      const turn = await processTurn('test_zero_lex_' + Date.now(), rawQuery, {
        executeDispatch: false,
        client: mockParserClient,
        aiEngine: mockAiEngine
      });

      // Verify parser -> validator -> resolver preserved the exact semantic interpretation
      expect(turn.semanticFrame.userInterest).toBe(parserOutput.userInterest);
      expect(turn.subQueryResults[0].verification.pass).toBe(true);

      // Verify synthesis prompt contains the semantic interpretation and all S1 curriculum profiles for comparison
      const promptContent = capturedPrompts[0].messages.find(m => m.role === 'user').content;
      expect(promptContent).toContain('psikologi keputusan pembeli di etalase virtual');
      expect(promptContent).toContain('perilaku konsumen digital');
      expect(turn.finalAnswer).toMatch(/S1 Bisnis Digital/i);
      expect(turn.finalAnswer).toMatch(/perilaku konsumen digital/i);
    });

    test('Zero-overlap hardware/automation phrasing connects semantically to S1 Sistem Komputer curriculum', async () => {
      const rawQuery = 'Saya tertarik merancang alat penyiram tanaman otomatis yang bisa membaca kelembaban tanah di kebun rumah';
      const parserOutput = {
        speechAct: 'SEEK_ADVICE',
        primaryIntent: 'PROGRAM_RECOMMENDATION',
        userInterest: 'otomasi alat penyiram tanaman berbasis pembacaan kondisi lingkungan fisik',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        candidateEntities: [],
        requestedAspects: ['curriculum'],
        scopeConstraints: { academicLevel: 'S1', studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none', topicContinuity: 'NEW_TOPIC', relevantPriorContext: null },
        executionRoute: 'ACADEMIC_RECOMMENDATION',
        confidence: 0.93,
        ambiguityLevel: 'LOW'
      };

      const groundedSynthesisReply = [
        'Minat Kakak dalam merancang alat otomatis yang membaca kondisi lingkungan fisik selaras dengan fokus kurikulum *S1 Sistem Komputer* di ITB STIKOM Bali.',
        '*Keterkaitan Kurikulum Resmi:*',
        '- Kurikulum *S1 Sistem Komputer* berfokus pada perangkat keras (hardware), mikroelektronika, mikrokontroler, embedded system, Internet of Things (IoT), dan robotika.',
        '- Jika Kakak juga ingin membuat aplikasi mobile untuk memantau alat tersebut dari jarak jauh, *S1 Teknologi Informasi* mempelajari pemrograman web dan mobile serta cloud computing.',
        'Apakah Kakak lebih tertarik mendalami perakitan sistem tertanam & mikrokontroler pada alatnya, atau pembuatan aplikasi pemantaunya?',
        'Catatan: Panduan ini mengacu pada kurikulum resmi ITB STIKOM Bali. Silakan menghubungi bagian admisi PMB ITB STIKOM Bali untuk konsultasi lebih lanjut.'
      ].join('\n');

      const { mockParserClient, mockAiEngine } = createMockAiPipeline(parserOutput, groundedSynthesisReply);

      const turn = await processTurn('test_zero_sk_' + Date.now(), rawQuery, {
        executeDispatch: false,
        client: mockParserClient,
        aiEngine: mockAiEngine
      });

      expect(turn.semanticFrame.userInterest).toBe(parserOutput.userInterest);
      expect(turn.finalAnswer).toMatch(/S1 Sistem Komputer/i);
      expect(turn.finalAnswer).toMatch(/mikrokontroler|embedded system|Internet of Things/i);
      expect(turn.subQueryResults[0].verification.pass).toBe(true);
    });
  });

  describe('4. Scenario 3: Multiple Relevant Study Programs Compared Fairly', () => {
    test('Interdisciplinary interest in enterprise software and business data compares S1 Sistem Informasi and S1 Teknologi Informasi objectively', async () => {
      const rawQuery = 'Saya tertarik merancang aplikasi untuk kebutuhan operasional kantor sekaligus mengolah laporan datanya';
      const parserOutput = {
        speechAct: 'SEEK_ADVICE',
        primaryIntent: 'PROGRAM_RECOMMENDATION',
        userInterest: 'perancangan sistem operasional organisasi dan pengembangan perangkat lunak aplikasi',
        semanticConcepts: ['ACADEMIC_OFFERING', 'CAREER_EMPLOYMENT'],
        candidateEntities: [],
        requestedAspects: ['curriculum', 'career'],
        scopeConstraints: { academicLevel: 'S1', studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none', topicContinuity: 'NEW_TOPIC', relevantPriorContext: null },
        executionRoute: 'ACADEMIC_RECOMMENDATION',
        confidence: 0.90,
        ambiguityLevel: 'MEDIUM'
      };

      const groundedSynthesisReply = [
        'Minat Kakak mencakup dua ranah yang saling berkaitan dan relevan dengan dua program studi S1 reguler di ITB STIKOM Bali:',
        '1. *S1 Sistem Informasi*',
        '- Fokus kurikulum: Analisis sistem informasi, manajemen basis data (database), business intelligence & analytics, tata kelola IT, sistem enterprise, dan penyelarasan proses bisnis.',
        '- Prospek karier: System Analyst, Business Analyst, Database Administrator.',
        '2. *S1 Teknologi Informasi*',
        '- Fokus kurikulum: Rekayasa perangkat lunak (software engineering), pemrograman web dan mobile (fullstack), cloud computing, dan keamanan siber.',
        '- Prospek karier: Software Engineer, Fullstack Developer, Cloud Engineer.',
        'Untuk membantu mengerucutkan pilihan, apakah Kakak lebih ingin fokus pada analisis proses bisnis & manajemen basis data korporat (*S1 Sistem Informasi*), atau fokus teknis pada coding & arsitektur perangkat lunak (*S1 Teknologi Informasi*)?',
        'Catatan: Rekomendasi ini disusun berdasarkan kurikulum resmi ITB STIKOM Bali. Silakan berkonsultasi dengan admisi PMB ITB STIKOM Bali untuk informasi lebih lanjut.'
      ].join('\n');

      const { mockParserClient, mockAiEngine } = createMockAiPipeline(parserOutput, groundedSynthesisReply);

      const turn = await processTurn('test_multi_fair_' + Date.now(), rawQuery, {
        executeDispatch: false,
        client: mockParserClient,
        aiEngine: mockAiEngine
      });

      expect(turn.finalAnswer).toMatch(/S1 Sistem Informasi/i);
      expect(turn.finalAnswer).toMatch(/S1 Teknologi Informasi/i);
      expect(turn.finalAnswer).toMatch(/business intelligence|basis data/i);
      expect(turn.finalAnswer).toMatch(/software engineering|fullstack/i);
      expect(turn.subQueryResults[0].verification.pass).toBe(true);
    });
  });

  describe('5. Scenario 4: Conflicting User Preferences / Constraints', () => {
    test('User wants to work in technology/software industry but dislikes heavy coding and wants quick 3-year practical readiness', async () => {
      const rawQuery = 'Saya ingin berkarier di bidang IT dan produk teknologi tapi kurang suka coding rumit dan ingin cepat kerja';
      const parserOutput = {
        speechAct: 'SEEK_ADVICE',
        primaryIntent: 'PROGRAM_RECOMMENDATION',
        userInterest: 'karier di industri teknologi informasi dengan preferensi minim pemrograman rumit dan orientasi praktis siap kerja',
        semanticConcepts: ['ACADEMIC_OFFERING', 'CAREER_EMPLOYMENT'],
        candidateEntities: [],
        requestedAspects: ['curriculum', 'career', 'study_duration'],
        scopeConstraints: { academicLevel: null, studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none', topicContinuity: 'NEW_TOPIC', relevantPriorContext: null },
        executionRoute: 'ACADEMIC_RECOMMENDATION',
        confidence: 0.88,
        ambiguityLevel: 'MEDIUM'
      };

      const groundedSynthesisReply = [
        'Mengingat Kakak ingin berkarier di bidang teknologi namun kurang menyukai pemrograman teknis yang rumit serta mempertimbangkan kesiapan kerja, terdapat beberapa opsi kurikulum di ITB STIKOM Bali dengan karakteristik berbeda:',
        '1. *S1 Bisnis Digital*: Berfokus pada sisi komersial produk teknologi, seperti digital marketing, e-commerce, strategi branding produk digital, dan analisis pasar tanpa menitikberatkan rekayasa perangkat lunak mendalam.',
        '2. *S1 Sistem Informasi*: Memadukan teknologi informasi dengan manajemen proses bisnis, analisis kebutuhan sistem, dan tata kelola IT (cocok untuk peran System/Business Analyst).',
        '3. *D3 Manajemen Informatika*: Jika prioritas utama Kakak adalah jalur vokasi 3 tahun siap kerja, program ini berfokus pada komputasi terapan, administrasi basis data operasional, dan IT support praktis.',
        'Dari ketiga arah tersebut, apakah Kakak lebih memprioritaskan masa studi vokasi 3 tahun (*D3 Manajemen Informatika*), analisis proses bisnis (*S1 Sistem Informasi*), atau pemasaran produk digital (*S1 Bisnis Digital*)?',
        'Catatan: Informasi ini merupakan panduan objektif berdasarkan kurikulum resmi. Silakan menghubungi admisi PMB ITB STIKOM Bali untuk konsultasi lebih detail.'
      ].join('\n');

      const { mockParserClient, mockAiEngine, capturedPrompts } = createMockAiPipeline(parserOutput, groundedSynthesisReply);

      const turn = await processTurn('test_conflict_' + Date.now(), rawQuery, {
        executeDispatch: false,
        client: mockParserClient,
        aiEngine: mockAiEngine
      });

      const promptSent = capturedPrompts[0].messages.find(m => m.role === 'user').content;
      expect(promptSent).toContain('D3 Manajemen Informatika');
      expect(promptSent).toContain('S1 Bisnis Digital');
      expect(promptSent).toContain('S1 Sistem Informasi');

      expect(turn.finalAnswer).toMatch(/S1 Bisnis Digital/i);
      expect(turn.finalAnswer).toMatch(/S1 Sistem Informasi/i);
      expect(turn.finalAnswer).toMatch(/D3 Manajemen Informatika/i);
      expect(turn.subQueryResults[0].verification.pass).toBe(true);
    });
  });

  describe('6. Scenario 5: Clarification When Interpretation is Ambiguous (ambiguityLevel: HIGH)', () => {
    test('High ambiguity interpretation triggers neutral multi-program curriculum overview and clarifying question without locking a winner', async () => {
      const rawQuery = 'Saya baru lulus sekolah dan ingin kuliah yang prospeknya bagus di masa depan, sebaiknya ambil apa?';
      const parserOutput = {
        speechAct: 'SEEK_ADVICE',
        primaryIntent: 'PROGRAM_RECOMMENDATION',
        userInterest: null,
        semanticConcepts: ['ACADEMIC_OFFERING', 'CAREER_EMPLOYMENT'],
        candidateEntities: [],
        requestedAspects: ['curriculum', 'career'],
        scopeConstraints: { academicLevel: null, studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none', topicContinuity: 'NEW_TOPIC', relevantPriorContext: null },
        executionRoute: 'ACADEMIC_RECOMMENDATION',
        confidence: 0.55,
        ambiguityLevel: 'HIGH'
      };

      const resolvedFrame = await resolveSemanticFrameAsync(rawQuery, {}, {
        client: {
          chat: {
            completions: {
              create: async () => ({
                model: 'gpt-4o-mini',
                choices: [{ message: { content: JSON.stringify(parserOutput) } }]
              })
            }
          }
        }
      });

      expect(resolvedFrame.ambiguityLevel).toBe('HIGH');

      const recResult = evaluateRecommendation(rawQuery, {}, resolvedFrame);
      expect(recResult.isBroadGuidance).toBe(true);
      expect(recResult.isAmbiguous).toBe(true);
      expect(recResult.presentationType).toBe('BROAD_GUIDANCE');
      expect(recResult.scoredCandidates).toEqual([]);

      // Also verify full turn in fallback mode renders neutral overview + clarifying question
      const turn = await processTurn('test_ambig_high_' + Date.now(), rawQuery, {
        executeDispatch: false,
        semanticFrame: resolvedFrame
      });

      expect(turn.finalAnswer).toMatch(/Teknologi Informasi.*Sistem Informasi.*Sistem Komputer.*Bisnis Digital.*Manajemen Informatika/s);
      expect(turn.finalAnswer).toMatch(/Supaya rekomendasi lebih spesifik, bidang apa yang paling Kakak minati/i);
      expect(turn.finalAnswer).toMatch(/admisi PMB/i);
    });
  });

  describe('7. Scenario 6: Recommendation Reasons Strictly Anchored to Official Curriculum Evidence', () => {
    test('buildSynthesisPrompt injects official studyFocus, suitableFor, careerProspects, and grounding for every candidate program', () => {
      const frame = {
        rawQuery: 'Saya tertarik merancang ilustrasi visual sekaligus belajar strategi merek bisnis',
        domain: 'ACADEMIC_RECOMMENDATION',
        intent: 'PROGRAM_RECOMMENDATION',
        userInterest: 'ilustrasi visual dan strategi merek bisnis',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        ambiguityLevel: 'LOW'
      };
      const recResult = evaluateRecommendation(frame.rawQuery, {}, frame);
      const { systemPrompt, userPrompt } = buildSynthesisPrompt(frame, [], recResult);

      expect(systemPrompt).toContain('terikat pada bukti kurikulum resmi');
      expect(userPrompt).toContain('Double Degree UTB');
      expect(userPrompt).toContain('Desain Komunikasi Visual (DKV)');
      expect(userPrompt).toContain('S1 Bisnis Digital');
      expect(userPrompt).toContain('Double Degree DNUI');
      expect(userPrompt).toContain('jurusan partner DNUI belum tercantum pada data tersedia');
    });

    test('Universal verifier blocks absolute claims ("pasti cocok") and enforces PMB consultation advisory', () => {
      const badAbsolute = 'Berdasarkan minat Kakak, prodi ini pasti cocok untuk masa depan Kakak. Silakan hubungi admisi PMB.';
      const v1 = verifyFinalAnswer(badAbsolute, { domain: 'ACADEMIC_RECOMMENDATION', intent: 'PROGRAM_RECOMMENDATION' });
      expect(v1.pass).toBe(false);
      expect(v1.reason).toBe('recommendation_absolute_claim_forbidden');

      const missingAdvisory = 'Berdasarkan minat Kakak, program studi yang selaras adalah S1 Teknologi Informasi.';
      const v2 = verifyFinalAnswer(missingAdvisory, { domain: 'ACADEMIC_RECOMMENDATION', intent: 'PROGRAM_RECOMMENDATION' });
      expect(v2.pass).toBe(false);
      expect(v2.reason).toBe('recommendation_lacks_pmb_advisory');
    });
  });

  describe('8. Scenario 7: Neutral Fallback When AI is Disabled or Fails (No Heuristic Winner, SAFE_UNKNOWN on Insufficient Evidence)', () => {
    test('When AI synthesis is disabled/unavailable, fallback presents multiple programs neutrally without crowning scoredCandidates[0] as a single winner', async () => {
      const q = 'Saya tertarik mendalami ekosistem teknologi dan bisnis masa kini';
      const frame = {
        rawQuery: q,
        domain: 'ACADEMIC_RECOMMENDATION',
        intent: 'PROGRAM_RECOMMENDATION',
        userInterest: 'ekosistem teknologi dan bisnis',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        ambiguityLevel: 'LOW'
      };

      const turn = await processTurn('test_neutral_fb_' + Date.now(), q, {
        executeDispatch: false,
        semanticFrame: frame
      });

      expect(turn.finalAnswer).toContain('berikut gambaran fokus kajian beberapa program studi yang dapat Kakak pertimbangkan secara objektif');
      expect(turn.finalAnswer).not.toMatch(/program studi yang relevan adalah \*/i);
      expect(turn.finalAnswer).not.toMatch(/\bpasti\s+cocok\b/i);
      expect(turn.finalAnswer).toMatch(/S1 Bisnis Digital/i);
      expect(turn.finalAnswer).toMatch(/S1 Sistem Informasi/i);
      expect(turn.finalAnswer).toMatch(/S1 Teknologi Informasi/i);
      expect(turn.finalAnswer).toMatch(/S1 Sistem Komputer/i);
      expect(turn.finalAnswer).toMatch(/admisi PMB/i);
      expect(sanitizeWhatsAppMarkdown(turn.finalAnswer)).toBe(turn.finalAnswer);
    });

    test('When AI synthesis throws an API/timeout error, it falls back cleanly to neutral multi-program curriculum overview', async () => {
      const q = 'Saya ingin kuliah S1 di STIKOM Bali yang berkaitan dengan dunia digital';
      const frame = {
        rawQuery: q,
        domain: 'ACADEMIC_RECOMMENDATION',
        intent: 'PROGRAM_RECOMMENDATION',
        userInterest: 'dunia digital',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        scopeConstraints: { academicLevel: 'S1' },
        ambiguityLevel: 'LOW'
      };

      const failingAiEngine = {
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        client: {
          chat: {
            completions: {
              create: async () => {
                throw new Error('Simulated OpenAI synthesis timeout');
              }
            }
          }
        }
      };

      const synthRes = await synthesizeAnswer(
        frame,
        { aiEngine: failingAiEngine },
        null,
        evaluateRecommendation(q, {}, frame)
      );

      expect(synthRes.success).toBe(true);
      expect(synthRes.source).toBe('generic_extractive_recommendation');
      expect(synthRes.answer).toContain('berikut gambaran fokus kajian beberapa program studi yang dapat Kakak pertimbangkan secara objektif');
      expect(synthRes.answer).not.toMatch(/program studi yang relevan adalah \*/i);
    });

    test('When interpretation fails (speechAct: UNKNOWN) and evidence is insufficient, fallback returns SAFE_UNKNOWN without guessing a major', async () => {
      const q = 'Kalimat sama sekali tidak terdukung bukti kurikulum';
      const failedInterpretation = buildSafeUnknownInterpretation(q, 'timeout');
      const frame = {
        ...failedInterpretation,
        rawQuery: q,
        domain: 'ACADEMIC_RECOMMENDATION',
        intent: 'PROGRAM_RECOMMENDATION',
        ambiguityLevel: 'LOW' // Force non-broad path to test insufficient evidence handling
      };

      const recResult = evaluateRecommendation(q, {}, frame);
      expect(recResult.scoredCandidates).toEqual([]);

      const synthRes = await synthesizeAnswer(frame, { accepted: [] }, null, {
        ...recResult,
        isBroadGuidance: false,
        scoredCandidates: []
      });

      expect(synthRes.success).toBe(false);
      expect(synthRes.source).toBe('unanswerable_natural_guidance');

      const verif = verifyFinalAnswer(synthRes.answer, frame, { accepted: [] }, null, recResult);
      expect(verif.outcome).toBe(VERIFICATION_OUTCOME.SAFE_UNKNOWN);
    });

    test('Unsupported career field (e.g. dokter spesialis bedah syaraf) fails closed without hallucinating medical faculties', async () => {
      const q = 'Saya ingin jadi dokter spesialis bedah syaraf, jurusan apa yang tersedia?';
      const turn = await processTurn('test_med_' + Date.now(), q, { executeDispatch: false, skipModelParser: true });

      expect(turn.finalAnswer).not.toMatch(/Fakultas Kedokteran/i);
      expect(turn.finalAnswer).not.toMatch(/S1 Pendidikan Dokter/i);
    });
  });

  describe('9. Multi-Turn Topic Switching & Context Isolation', () => {
    test('Turn 1 Recommendation -> Turn 2 Tuition Fee -> Turn 3 Campus Location maintains context purity', async () => {
      const chatId = 'test_ctx_isolation_' + Date.now();

      // Turn 1: Academic Recommendation
      const t1 = await processTurn(chatId, 'Saya suka coding software, cocok masuk prodi apa ya?', { executeDispatch: false, skipModelParser: true });
      expect(t1.subQueryResults[0].frame.domain).toBe('ACADEMIC_RECOMMENDATION');
      expect(t1.finalAnswer).toMatch(/Teknologi Informasi/i);

      // Turn 2: Switch to Tuition Fee
      const t2 = await processTurn(chatId, 'Berapa biaya kuliah per semester untuk S1 Sistem Informasi?', { executeDispatch: false, skipModelParser: true });
      expect(t2.subQueryResults[0].frame.domain).toBe('TUITION_FEE');
      expect(t2.finalAnswer).toMatch(/(?:biaya|semester|dpp|rp)/i);
      expect(t2.finalAnswer).not.toMatch(/Rekomendasi ini disusun secara objektif/i);

      // Turn 3: Switch to Campus Location
      const t3 = await processTurn(chatId, 'Di mana saja lokasi kampus ITB STIKOM Bali?', { executeDispatch: false, skipModelParser: true });
      expect(t3.subQueryResults[0].frame.domain).toBe('FACILITIES');
      expect(t3.subQueryResults[0].frame.intent).toBe('CAMPUS_LOCATION');
      expect(t3.finalAnswer).toMatch(/Renon|Jimbaran|Abiansemal/i);
      expect(t3.finalAnswer).not.toMatch(/Rekomendasi ini disusun secara objektif/i);
    });
  });
});
