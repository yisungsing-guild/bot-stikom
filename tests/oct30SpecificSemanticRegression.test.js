/**
 * Targeted Regression Suite for 30 October 2026 Semantic Understanding & Provenance Requirements
 *
 * Verifies the key invariants:
 * 1. "Saya ingin bertanya tentang PMB" does NOT produce prodi recommendation or catalog list.
 * 2. "Apakah ada beasiswa di ITB STIKOM Bali?" retrieves and grounds genuine scholarship evidence.
 * 3. "Beasiswa apa saja yang ada?" checks completeness before listing.
 * 4. "Saya ingin tahu prodi Sistem Informasi" maps to PROGRAM_OVERVIEW, NOT recommendation.
 * 5. No factual claims without evidence; missing info is never claimed as absolutely non-existent.
 * 6. S2 contact hotline (0822-7738-9999) never leaks into general campus contact answers.
 * 7. UTB Double Degree follow-up preserves partner entity and official portal.
 * 8. All 3 campus locations include verified street numbers.
 */

const { processTurn } = require('../src/core/orchestrator');
const { resolveSemanticFrame, resolveSemanticFrameAsync, extractUserOriginLocation } = require('../src/core/semanticFrameResolver');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { buildGenericExtractiveFallback } = require('../src/core/groundedAnswerGenerator');
const { validateSemanticInterpretation } = require('../src/core/semanticInterpretationValidator');
const { SEMANTIC_INTERPRETATION_JSON_SCHEMA, ALLOWED_LOCATION_SCOPES } = require('../src/core/modelSemanticParser');

function createMockOpenAIClient(interpretationObj) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{
            message: { content: JSON.stringify(interpretationObj) },
            finish_reason: 'stop'
          }]
        })
      }
    }
  };
}

jest.setTimeout(60000);

describe('30 October Specific Semantic Understanding & Regression Suite', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  describe('1. General PMB Inquiries vs Recommendation Differentiation', () => {
    test('"Saya ingin bertanya tentang PMB" does not generate recommendation or prodi catalog', async () => {
      const chatId = 'test-pmb-inq-' + Date.now();
      const res = await processTurn(chatId, 'Saya ingin bertanya tentang PMB', { executeDispatch: false });

      expect(res.semanticFrame?.domain).toBe('PMB');
      expect(res.semanticFrame?.intent).toBe('GENERAL_PMB_INQUIRY');
      expect(res.semanticFrame?.domain).not.toBe('ACADEMIC_RECOMMENDATION');
      expect(res.semanticFrame?.intent).not.toBe('PROGRAM_RECOMMENDATION');

      // Must NOT automatically list curriculum programs as recommendations
      expect(res.text).not.toMatch(/Rekomendasi program studi|berikut beberapa pilihan prodi yang cocok/i);
      expect(res.text).toMatch(/Penerimaan Mahasiswa Baru|PMB|Pendaftaran/i);
    });

    test('Novel wording "Saya mau tanya seputar PMB" cleanly routes to PMB overview', async () => {
      const chatId = 'test-pmb-novel-' + Date.now();
      const res = await processTurn(chatId, 'Saya mau tanya seputar PMB', { executeDispatch: false });

      expect(res.semanticFrame?.domain).toBe('PMB');
      expect(res.semanticFrame?.intent).toBe('GENERAL_PMB_INQUIRY');
      expect(res.semanticFrame?.domain).not.toBe('ACADEMIC_RECOMMENDATION');
    });
  });

  describe('2. Specific Program Information vs Recommendation Differentiation', () => {
    test('"Saya ingin tahu prodi Sistem Informasi" maps to PROGRAM_OVERVIEW for S1 Sistem Informasi', async () => {
      const chatId = 'test-si-info-' + Date.now();
      const res = await processTurn(chatId, 'Saya ingin tahu prodi Sistem Informasi', { executeDispatch: false });

      expect(res.semanticFrame?.domain).toBe('ACADEMIC_PROGRAM');
      expect(res.semanticFrame?.intent).toBe('PROGRAM_OVERVIEW');
      expect(res.semanticFrame?.domain).not.toBe('ACADEMIC_RECOMMENDATION');
      expect(res.semanticFrame?.intent).not.toBe('PROGRAM_RECOMMENDATION');
      expect(res.text).toMatch(/Sistem Informasi/i);
    });

    test('Novel wording "Mau tahu tentang prodi Sistem Informasi" routes to PROGRAM_OVERVIEW', async () => {
      const chatId = 'test-si-novel-' + Date.now();
      const res = await processTurn(chatId, 'Mau tahu tentang prodi Sistem Informasi', { executeDispatch: false });

      expect(res.semanticFrame?.domain).toBe('ACADEMIC_PROGRAM');
      expect(res.semanticFrame?.intent).toBe('PROGRAM_OVERVIEW');
      expect(res.text).toMatch(/Sistem Informasi/i);
    });
  });

  describe('3. Scholarship Inquiry & Completeness Check', () => {
    test('"Apakah ada beasiswa di ITB STIKOM Bali?" retrieves official scholarship evidence', async () => {
      const chatId = 'test-sch-avail-' + Date.now();
      const res = await processTurn(chatId, 'Apakah ada beasiswa di ITB STIKOM Bali?', { executeDispatch: false });

      expect(res.semanticFrame?.domain).toBe('SCHOLARSHIP');
      expect(res.semanticFrame?.intent).toBe('SCHOLARSHIP_INQUIRY');
      expect(res.text).toMatch(/beasiswa|potongan\s+DPP|KIP\s*Kuliah/i);
      expect(res.text).not.toContain('0822-7738-9999');
    });

    test('"Beasiswa apa saja yang ada?" checks evidence before listing', async () => {
      const chatId = 'test-sch-list-' + Date.now();
      const res = await processTurn(chatId, 'Beasiswa apa saja yang ada?', { executeDispatch: false });

      expect(res.semanticFrame?.domain).toBe('SCHOLARSHIP');
      expect(res.semanticFrame?.intent).toBe('SCHOLARSHIP_INQUIRY');
      expect(res.text).toMatch(/KIP\s*Kuliah|beasiswa|potongan/i);
    });
  });

  describe('4. Historical Regressions: UTB, Campus Locations, S2 Contact Isolation', () => {
    test('UTB Double Degree follow-up preserves UTB and official PMB portal', async () => {
      const chatId = 'test-utb-multi-' + Date.now();
      const t1 = await processTurn(chatId, 'Kalau Double Degree dengan UTB itu seperti apa ya?', { executeDispatch: false });
      expect(t1.semanticFrame?.domain).toBe('INTERNATIONAL');
      expect(t1.text).toMatch(/UTB|Universitas Teknologi Bandung/i);
      expect(t1.text).toMatch(/Bisnis Digital/i);

      const t2 = await processTurn(chatId, 'Bagaimana cara mendaftarnya?', { executeDispatch: false });
      expect(t2.text).toMatch(/https:\/\/pmb\.stikom-bali\.ac\.id/i);
      expect(t2.text).toMatch(/Dual Degree|UTB/i);
      expect(t2.text).not.toContain('0822-7738-9999');
    });

    test('Campus locations include all 3 campuses with exact street numbers', async () => {
      const chatId = 'test-loc-all-' + Date.now();
      const res = await processTurn(chatId, 'Sebutkan alamat lengkap semua kampus ITB STIKOM Bali', { executeDispatch: false });

      expect(res.semanticFrame?.intent).toBe('CAMPUS_LOCATION');
      expect(res.text).toMatch(/Kampus Renon/i);
      expect(res.text).toMatch(/Jl\. Raya Puputan No\. 86/i);
      expect(res.text).toMatch(/Kampus Jimbaran/i);
      expect(res.text).toMatch(/Jl\. Raya Kampus Udayana/i);
      expect(res.text).toMatch(/Kampus Abiansemal/i);
      expect(res.text).toMatch(/Jl\. Janger|Dauh Yeh Cani|Abiansemal/i);
    });

    test('General contact inquiry outputs official telephone without leaking S2 hotline', async () => {
      const chatId = 'test-contact-sec-' + Date.now();
      const res = await processTurn(chatId, 'Berapa nomor kontak resmi ITB STIKOM Bali?', { executeDispatch: false });

      expect(res.text).toMatch(/\(0361\)\s*244445/);
      expect(res.text).not.toContain('0822-7738-9999');
      expect(res.text).not.toContain('082277389999');
    });

    test('Wisuda date query does not claim wisuda is permanently non-existent and guides to SION/BAAK', async () => {
      const chatId = 'test-wisuda-date-' + Date.now();
      const res = await processTurn(chatId, 'Berapa tanggal pasti wisuda ke-39?', { executeDispatch: false });

      expect(res.semanticFrame?.domain).toBe('ACADEMIC_EVENT');
      expect(res.semanticFrame?.intent).toBe('GRADUATION_INQUIRY');
      expect(res.text).toMatch(/SION|BAAK/i);
      expect(res.text).not.toMatch(/tidak ada wisuda|wisuda ditiadakan/i);
    });
  });

  describe('5. Campus Entity Coverage & False Positive Prevention', () => {
    test('Negative Test: Chunk mentioning Universitas Udayana in research collaboration is NOT extracted as Kampus Jimbaran', () => {
      const frame = {
        domain: 'FACILITIES',
        intent: 'CAMPUS_LOCATION',
        aspects: ['location', 'campus_location', 'address']
      };

      const udayanaNonCampusChunk = {
        id: 'chunk-udayana-collab-1',
        sourceFile: 'MoU_Kerjasama.docx',
        text: 'Institut Teknologi dan Bisnis STIKOM Bali menjalin kerja sama penelitian bersama Universitas Udayana dalam pengembangan sistem kecerdasan buatan dan IoT di Bali.'
      };

      const fallback = buildGenericExtractiveFallback(frame, [udayanaNonCampusChunk], {});
      // Must NOT extract Universitas Udayana research snippet as Jimbaran campus location
      expect(fallback.answer).not.toMatch(/Universitas Udayana/i);
      expect(fallback.success).toBe(false);
    });

    test('Completeness Safety: Partial evidence (Renon and Jimbaran only) yields PARTIAL answerability and states missing Abiansemal', () => {
      const frame = {
        domain: 'FACILITIES',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'ALL',
        aspects: ['location', 'campus_location', 'address', 'all_locations']
      };

      const acceptedChunks = [
        {
          id: 'chunk-renon',
          sourceFile: 'ISIAN WEBSITE (1).pdf',
          text: 'Kampus Renon (Pusat): Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.'
        },
        {
          id: 'chunk-jimbaran',
          sourceFile: 'ISIAN WEBSITE (1).pdf',
          text: 'Kampus Jimbaran: Jl. Raya Kampus Udayana, Jimbaran, Kuta Selatan, Badung, Bali.'
        }
      ];

      const answerability = evaluateAnswerability(frame, { accepted: acceptedChunks, rejected: [] });
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.PARTIAL);
      expect(answerability.missingBranches).toContain('Kampus Abiansemal');
      expect(answerability.coveredBranches).toContain('Kampus Renon');
      expect(answerability.coveredBranches).toContain('Kampus Jimbaran');
      expect(answerability.guidance).toMatch(/Kampus Abiansemal/i);

      const fallback = buildGenericExtractiveFallback(frame, acceptedChunks, answerability);
      expect(fallback.answer).toMatch(/Kampus Renon/i);
      expect(fallback.answer).toMatch(/Kampus Jimbaran/i);
      expect(fallback.answer).toMatch(/Kampus Abiansemal/i);
      expect(fallback.answer).toMatch(/belum tercantum/i);
    });

    test('Completeness Safety: All 3 branches in evidence yields ANSWERABLE', () => {
      const frame = {
        domain: 'FACILITIES',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'ALL',
        aspects: ['location', 'campus_location', 'address', 'all_locations']
      };

      const acceptedChunks = [
        { id: 'c1', text: 'Kampus Renon (Pusat): Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.' },
        { id: 'c2', text: 'Kampus Jimbaran: Jl. Raya Kampus Udayana, Jimbaran, Kuta Selatan, Badung, Bali.' },
        { id: 'c3', text: 'Kampus Abiansemal: Jl. Janger, Dauh Yeh Cani, Kec. Abiansemal, Badung, Bali.' }
      ];

      const answerability = evaluateAnswerability(frame, { accepted: acceptedChunks, rejected: [] });
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
      expect(answerability.coveredAspects).toContain('all_locations');
    });

    test('Branch-specific query for Kampus Renon evaluates single branch coverage', () => {
      const frame = {
        domain: 'FACILITIES',
        intent: 'CAMPUS_LOCATION',
        targetBranch: 'renon',
        aspects: ['location', 'campus_location', 'address']
      };

      const onlyJimbaranChunks = [
        { id: 'c2', text: 'Kampus Jimbaran: Jl. Raya Kampus Udayana, Jimbaran, Kuta Selatan, Badung, Bali.' }
      ];

      const answerability = evaluateAnswerability(frame, { accepted: onlyJimbaranChunks, rejected: [] });
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
      expect(answerability.reason).toBe('insufficient_renon_location_evidence');
    });
  });

  describe('6. AI Model Semantic Location Scope Resolution & Precedence', () => {
    test('Schema Contract: scopeConstraints includes locationScope enum and required fields', () => {
      expect(ALLOWED_LOCATION_SCOPES).toEqual(['ALL', 'SINGLE', 'GENERAL']);
      const scopeProps = SEMANTIC_INTERPRETATION_JSON_SCHEMA.schema.properties.scopeConstraints;
      expect(scopeProps.properties.locationScope).toBeDefined();
      expect(scopeProps.properties.locationScope.enum).toEqual(['ALL', 'SINGLE', 'GENERAL']);
      expect(scopeProps.required).toContain('locationScope');
      expect(scopeProps.required).toContain('locationConstraint');
    });

    test('Validation Gate: Validates locationScope and enforces consistency with locationConstraint', () => {
      const baseInterpretation = {
        speechAct: 'INQUIRE_PROPERTY',
        primaryIntent: 'CAMPUS_LOCATION',
        userInterest: null,
        semanticConcepts: ['CAMPUS_LIFE'],
        candidateEntities: [],
        requestedAspects: ['location'],
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: null,
          locationScope: 'ALL'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        executionRoute: 'RAG_RETRIEVAL',
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      };

      // 1. ALL + null harus tetap diterima
      const resAllNull = validateSemanticInterpretation(baseInterpretation);
      expect(resAllNull.isValid).toBe(true);
      expect(resAllNull.validatedFrame.scopeConstraints.locationScope).toBe('ALL');
      expect(resAllNull.validatedFrame.scopeConstraints.locationConstraint).toBeNull();

      // 2. ALL + renon harus tetap ditolak
      const resAllRenon = validateSemanticInterpretation({
        ...baseInterpretation,
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: 'renon',
          locationScope: 'ALL'
        }
      });
      expect(resAllRenon.isValid).toBe(false);

      // 3. SINGLE + renon/jimbaran/abiansemal harus tetap diterima
      for (const branch of ['renon', 'jimbaran', 'abiansemal']) {
        const resSingleValid = validateSemanticInterpretation({
          ...baseInterpretation,
          scopeConstraints: {
            academicLevel: null,
            studyMode: null,
            locationConstraint: branch,
            locationScope: 'SINGLE'
          }
        });
        expect(resSingleValid.isValid).toBe(true);
        expect(resSingleValid.validatedFrame.scopeConstraints.locationScope).toBe('SINGLE');
        expect(resSingleValid.validatedFrame.scopeConstraints.locationConstraint).toBe(branch);
      }

      // 4. SINGLE + "mars" harus ditolak
      const resSingleMars = validateSemanticInterpretation({
        ...baseInterpretation,
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: 'mars',
          locationScope: 'SINGLE'
        }
      });
      expect(resSingleMars.isValid).toBe(false);

      // 5. SINGLE + target kampus tidak dikenal harus ditolak (e.g. singaraja)
      const resSingleUnknown = validateSemanticInterpretation({
        ...baseInterpretation,
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: 'singaraja',
          locationScope: 'SINGLE'
        }
      });
      expect(resSingleUnknown.isValid).toBe(false);

      // 6. SINGLE + non-campus canonical entity (e.g. Sistem Informasi) harus ditolak
      const resSingleNonCampus = validateSemanticInterpretation({
        ...baseInterpretation,
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: 'Sistem Informasi',
          locationScope: 'SINGLE'
        }
      });
      expect(resSingleNonCampus.isValid).toBe(false);

      // 7. SINGLE + null/empty harus ditolak
      const resSingleNull = validateSemanticInterpretation({
        ...baseInterpretation,
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: null,
          locationScope: 'SINGLE'
        }
      });
      expect(resSingleNull.isValid).toBe(false);

      // 8. GENERAL + null harus diterima
      const resGeneralNull = validateSemanticInterpretation({
        ...baseInterpretation,
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: null,
          locationScope: 'GENERAL'
        }
      });
      expect(resGeneralNull.isValid).toBe(true);
      expect(resGeneralNull.validatedFrame.scopeConstraints.locationScope).toBe('GENERAL');
      expect(resGeneralNull.validatedFrame.scopeConstraints.locationConstraint).toBeNull();

      // 9. GENERAL + "jimbaran" harus ditolak
      const resGeneralJimbaran = validateSemanticInterpretation({
        ...baseInterpretation,
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: 'jimbaran',
          locationScope: 'GENERAL'
        }
      });
      expect(resGeneralJimbaran.isValid).toBe(false);

      // 10. Invalid locationScope enum
      const resInvalidEnum = validateSemanticInterpretation({
        ...baseInterpretation,
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: null,
          locationScope: 'WORLDWIDE'
        }
      });
      expect(resInvalidEnum.isValid).toBe(false);
    });

    test('Semantic Scope: "Alamat semua kampus ITB STIKOM Bali" resolves locationScope=ALL via AI interpretation', async () => {
      const mockClient = createMockOpenAIClient({
        speechAct: 'DISCOVER_LIST',
        primaryIntent: 'CAMPUS_LOCATION',
        userInterest: null,
        semanticConcepts: ['CAMPUS_LIFE'],
        candidateEntities: [],
        requestedAspects: ['location'],
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: null,
          locationScope: 'ALL'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        executionRoute: 'RAG_RETRIEVAL',
        confidence: 0.98,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync('Alamat semua kampus ITB STIKOM Bali', {}, { client: mockClient });
      expect(frame.locationScope).toBe('ALL');
      expect(frame.targetBranch).toBeNull();
      expect(frame.aspects).toContain('all_locations');
      expect(frame.aspects).toContain('location');
    });

    test('Semantic Scope: "Di mana kampus Jimbaran?" resolves locationScope=SINGLE and targetBranch=jimbaran via AI', async () => {
      const mockClient = createMockOpenAIClient({
        speechAct: 'INQUIRE_PROPERTY',
        primaryIntent: 'CAMPUS_LOCATION',
        userInterest: null,
        semanticConcepts: ['CAMPUS_LIFE'],
        candidateEntities: [],
        requestedAspects: ['location'],
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: 'jimbaran',
          locationScope: 'SINGLE'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        executionRoute: 'RAG_RETRIEVAL',
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync('Di mana kampus Jimbaran?', {}, { client: mockClient });
      expect(frame.locationScope).toBe('SINGLE');
      expect(frame.targetBranch).toBe('jimbaran');
      expect(frame.aspects).not.toContain('all_locations');
    });

    test('Semantic Scope: "Saya ingin tahu tentang lokasi kampus" resolves locationScope=GENERAL via AI', async () => {
      const mockClient = createMockOpenAIClient({
        speechAct: 'INQUIRE_PROPERTY',
        primaryIntent: 'CAMPUS_LOCATION',
        userInterest: null,
        semanticConcepts: ['CAMPUS_LIFE'],
        candidateEntities: [],
        requestedAspects: ['location'],
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: null,
          locationScope: 'GENERAL'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        executionRoute: 'RAG_RETRIEVAL',
        confidence: 0.92,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync('Saya ingin tahu tentang lokasi kampus', {}, { client: mockClient });
      expect(frame.locationScope).toBe('GENERAL');
      expect(frame.targetBranch).toBeNull();
      expect(frame.aspects).not.toContain('all_locations');
    });

    test('Colloquial Query: "Ada cabang di mana saja?" without literal "semua" resolves locationScope=ALL via AI', async () => {
      const mockClient = createMockOpenAIClient({
        speechAct: 'DISCOVER_LIST',
        primaryIntent: 'CAMPUS_LOCATION',
        userInterest: null,
        semanticConcepts: ['CAMPUS_LIFE'],
        candidateEntities: [],
        requestedAspects: ['location'],
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: null,
          locationScope: 'ALL'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        executionRoute: 'RAG_RETRIEVAL',
        confidence: 0.96,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync('Ada cabang di mana saja?', {}, { client: mockClient });
      expect(frame.locationScope).toBe('ALL');
      expect(frame.aspects).toContain('all_locations');
    });

    test('AI Precedence: AI SINGLE is NOT promoted to ALL by sync regex matching "lengkap"', async () => {
      // Query contains "lengkap" which sync regex would classify as all_locations
      const queryWithSyncKeyword = 'Apakah Kampus Jimbaran fasilitasnya lengkap?';

      const mockClient = createMockOpenAIClient({
        speechAct: 'INQUIRE_PROPERTY',
        primaryIntent: 'CAMPUS_LOCATION',
        userInterest: null,
        semanticConcepts: ['CAMPUS_LIFE'],
        candidateEntities: [],
        requestedAspects: ['location', 'facilities'],
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: 'jimbaran',
          locationScope: 'SINGLE'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        executionRoute: 'RAG_RETRIEVAL',
        confidence: 0.94,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync(queryWithSyncKeyword, {}, { client: mockClient });
      // AI determined SINGLE; regex promotion must NOT occur
      expect(frame.locationScope).toBe('SINGLE');
      expect(frame.targetBranch).toBe('jimbaran');
      expect(frame.aspects).not.toContain('all_locations');
    });

    test('AI Precedence: AI ALL is NOT demoted to GENERAL by deterministic fallback', async () => {
      const mockClient = createMockOpenAIClient({
        speechAct: 'DISCOVER_LIST',
        primaryIntent: 'CAMPUS_LOCATION',
        userInterest: null,
        semanticConcepts: ['CAMPUS_LIFE'],
        candidateEntities: [],
        requestedAspects: ['location'],
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: null,
          locationScope: 'ALL'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        executionRoute: 'RAG_RETRIEVAL',
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync('Daftar cabang kampus', {}, { client: mockClient });
      expect(frame.locationScope).toBe('ALL');
      expect(frame.aspects).toContain('all_locations');
    });

    test('Canonical Branch Normalization: Aliases map to canonical keys (renon, jimbaran, abiansemal) and correctly gate answerability', async () => {
      const aliasMappings = [
        { alias: 'renon', expectedKey: 'renon', query: 'Alamat kampus renon' },
        { alias: 'Kampus Renon', expectedKey: 'renon', query: 'Alamat Kampus Renon' },
        { alias: 'jimbaran', expectedKey: 'jimbaran', query: 'Alamat kampus jimbaran' },
        { alias: 'Kampus Jimbaran', expectedKey: 'jimbaran', query: 'Alamat Kampus Jimbaran' },
        { alias: 'kampus selatan', expectedKey: 'jimbaran', query: 'Alamat kampus selatan' },
        { alias: 'abiansemal', expectedKey: 'abiansemal', query: 'Alamat kampus abiansemal' },
        { alias: 'Kampus Abiansemal', expectedKey: 'abiansemal', query: 'Alamat Kampus Abiansemal' }
      ];

      const acceptedAll = [
        { id: 'c1', text: 'Kampus Renon: Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.' },
        { id: 'c2', text: 'Kampus Jimbaran: Jl. Raya Kampus Udayana, Jimbaran, Kuta Selatan, Badung, Bali.' },
        { id: 'c3', text: 'Kampus Abiansemal: Jl. Janger, Dauh Yeh Cani, Kec. Abiansemal, Badung, Bali.' }
      ];

      for (const { alias, expectedKey, query } of aliasMappings) {
        const mockClient = createMockOpenAIClient({
          speechAct: 'INQUIRE_PROPERTY',
          primaryIntent: 'CAMPUS_LOCATION',
          userInterest: null,
          semanticConcepts: ['CAMPUS_LIFE'],
          candidateEntities: [],
          requestedAspects: ['location'],
          scopeConstraints: {
            academicLevel: null,
            studyMode: null,
            locationConstraint: alias,
            locationScope: 'SINGLE'
          },
          contextDependency: {
            isFollowUp: false,
            referenceType: 'none',
            topicContinuity: 'NEW_TOPIC',
            relevantPriorContext: null
          },
          executionRoute: 'RAG_RETRIEVAL',
          confidence: 0.95,
          ambiguityLevel: 'LOW'
        });

        const frame = await resolveSemanticFrameAsync(query, {}, { client: mockClient });
        expect(frame.locationScope).toBe('SINGLE');
        expect(frame.targetBranch).toBe(expectedKey);

        // Positive answerability: evidence for target branch is present
        const ansPositive = evaluateAnswerability(frame, { accepted: acceptedAll, rejected: [] });
        expect(ansPositive.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);

        // Negative answerability: evidence for target branch is absent -> UNKNOWN
        const acceptedWithoutTarget = acceptedAll.filter(c => !c.text.toLowerCase().includes(expectedKey));
        const ansNegative = evaluateAnswerability(frame, { accepted: acceptedWithoutTarget, rejected: [] });
        expect(ansNegative.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
        expect(ansNegative.reason).toBe(`insufficient_${expectedKey}_location_evidence`);
      }
    });

    test('Negative Test: Unrecognized campus alias fails closed without producing valid targetBranch or fabricated address', async () => {
      const mockClient = createMockOpenAIClient({
        speechAct: 'INQUIRE_PROPERTY',
        primaryIntent: 'CAMPUS_LOCATION',
        userInterest: null,
        semanticConcepts: ['CAMPUS_LIFE'],
        candidateEntities: [],
        requestedAspects: ['location'],
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: 'mars',
          locationScope: 'SINGLE'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        executionRoute: 'RAG_RETRIEVAL',
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      });

      // When AI returns unrecognized 'mars', validation gate rejects it
      const frame = await resolveSemanticFrameAsync('Di mana kampus Mars?', {}, { client: mockClient });
      // Unrecognized alias must NOT be set as targetBranch
      expect(frame.targetBranch).not.toBe('mars');
      expect(frame.targetBranch).toBeNull();

      // Answerability gate with zero evidence and rejected schema evaluates to fail-closed (CLARIFY / UNKNOWN)
      const ans = evaluateAnswerability(frame, { accepted: [], rejected: [] });
      expect([ANSWERABILITY_STATUS.UNKNOWN, ANSWERABILITY_STATUS.CLARIFY]).toContain(ans.status);
      expect(ans.status).not.toBe(ANSWERABILITY_STATUS.ANSWERABLE);

      // Extractive fallback never hallucinates address without accepted RAG evidence
      const fallback = buildGenericExtractiveFallback(frame, [], ans);
      expect(fallback.success).toBe(false);
      expect(fallback.answer).not.toMatch(/mars/i);
    });
  });

  describe('7. Extractive Fallback Strict Scope & Address Isolation Regression Suite', () => {
    const renonEvidence = {
      id: 'ed2aa278-bfe0-4db9-b132-9102eec6a906',
      sourceDocument: 'BROSUR_BIAYA_KULIAH_2026.pdf',
      text: 'Kampus I: Jl. Raya Puputan No. 86 Renon, Denpasar. Telp: (0361) 226127, Fax: (0361) 235105, WhatsApp: 081529000000, Email: info@stikom-bali.ac.id, Website: https://stikom-bali.ac.id'
    };

    const jimbaranAbiansemalEvidence = {
      id: '1aef0c6a-8f8f-431a-af9b-2e7f62c60c7a',
      sourceDocument: 'ISIAN WEBSITE (1).pdf',
      text: 'Kampus II (Jimbaran): Jl. Raya Kampus Udayana, Jimbaran. Kampus III (Abiansemal): Jl. Janger, Dauh Yeh Cani, Abiansemal.'
    };

    const allEvidence = [renonEvidence, jimbaranAbiansemalEvidence];

    test('1. SINGLE Jimbaran outputs ONLY Jimbaran address and excludes other campuses', () => {
      const frame = {
        domain: 'CAMPUS_LIFE',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'SINGLE',
        targetBranch: 'jimbaran',
        rawQuery: 'Di mana kampus Jimbaran?'
      };
      const ans = { status: ANSWERABILITY_STATUS.ANSWERABLE };
      const fallback = buildGenericExtractiveFallback(frame, allEvidence, ans);

      expect(fallback.success).toBe(true);
      expect(fallback.answer).toContain('Jl. Raya Kampus Udayana, Jimbaran');
      expect(fallback.answer).not.toContain('Jl. Raya Puputan');
      expect(fallback.answer).not.toContain('Jl. Janger');
      expect(fallback.answer).not.toMatch(/renon/i);
      expect(fallback.answer).not.toMatch(/abiansemal/i);
    });

    test('2. SINGLE Abiansemal outputs ONLY Abiansemal address and excludes other campuses', () => {
      const frame = {
        domain: 'CAMPUS_LIFE',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'SINGLE',
        targetBranch: 'abiansemal',
        rawQuery: 'Di mana kampus Abiansemal?'
      };
      const ans = { status: ANSWERABILITY_STATUS.ANSWERABLE };
      const fallback = buildGenericExtractiveFallback(frame, allEvidence, ans);

      expect(fallback.success).toBe(true);
      expect(fallback.answer).toContain('Jl. Janger, Dauh Yeh Cani, Abiansemal');
      expect(fallback.answer).not.toContain('Jl. Raya Puputan');
      expect(fallback.answer).not.toContain('Jl. Raya Kampus Udayana');
      expect(fallback.answer).not.toMatch(/renon/i);
      expect(fallback.answer).not.toMatch(/jimbaran/i);
    });

    test('3. ALL complete outputs all 3 branches paired with verified addresses', () => {
      const frame = {
        domain: 'CAMPUS_LIFE',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'ALL',
        targetBranch: null,
        rawQuery: 'Sebutkan alamat semua kampus ITB STIKOM Bali.'
      };
      const ans = { status: ANSWERABILITY_STATUS.ANSWERABLE };
      const fallback = buildGenericExtractiveFallback(frame, allEvidence, ans);

      expect(fallback.success).toBe(true);
      expect(fallback.answer).toContain('Kampus Renon (Pusat)');
      expect(fallback.answer).toContain('Jl. Raya Puputan No. 86 Renon, Denpasar');
      expect(fallback.answer).toContain('Kampus Jimbaran');
      expect(fallback.answer).toContain('Jl. Raya Kampus Udayana, Jimbaran');
      expect(fallback.answer).toContain('Kampus Abiansemal');
      expect(fallback.answer).toContain('Jl. Janger, Dauh Yeh Cani, Abiansemal');
      expect(fallback.answer).not.toContain('Catatan: Rincian alamat resmi untuk');
    });

    test('4. GENERAL scope provides overview and clarifying prompt without dumping full address list', () => {
      const frame = {
        domain: 'CAMPUS_LIFE',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'GENERAL',
        targetBranch: null,
        rawQuery: 'Di mana lokasi kampus ITB STIKOM Bali?'
      };
      const ans = { status: ANSWERABILITY_STATUS.ANSWERABLE };
      const fallback = buildGenericExtractiveFallback(frame, allEvidence, ans);

      expect(fallback.success).toBe(true);
      expect(fallback.answer).toContain('ITB STIKOM Bali memiliki kampus yang berlokasi di');
      expect(fallback.answer).toContain('Renon (Pusat di Denpasar)');
      expect(fallback.answer).toContain('Jimbaran');
      expect(fallback.answer).toContain('Abiansemal');
      expect(fallback.answer).toContain('boleh tahu lokasi kampus mana yang ingin Kakak ketahui?');
      expect(fallback.answer).not.toContain('Jl. Raya Puputan');
      expect(fallback.answer).not.toContain('Jl. Raya Kampus Udayana');
      expect(fallback.answer).not.toContain('Jl. Janger');
    });

    test('5. GENERAL scope ignores regional/collaboration mentions that lack campus address evidence', () => {
      const nonAddressEvidence = [
        {
          id: 'collab-chunk-1',
          sourceDocument: 'KERJASAMA.pdf',
          text: 'ITB STIKOM Bali menjalin kerja sama penelitian dengan Universitas Udayana di kawasan Jimbaran untuk pertukaran mahasiswa.'
        },
        {
          id: 'activity-chunk-2',
          sourceDocument: 'KEGIATAN.pdf',
          text: 'Kegiatan pengabdian masyarakat diadakan oleh mahasiswa di daerah Abiansemal Badung pada bulan lalu.'
        }
      ];
      const frame = {
        domain: 'CAMPUS_LIFE',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'GENERAL',
        targetBranch: null,
        rawQuery: 'Kampus STIKOM ada di mana saja?'
      };
      const ans = { status: ANSWERABILITY_STATUS.UNKNOWN };
      const fallback = buildGenericExtractiveFallback(frame, nonAddressEvidence, ans);

      expect(fallback.success).toBe(false);
      expect(fallback.handledSafely).toBe(true);
      expect(fallback.answer).toContain('belum dapat diverifikasi dari dokumen yang tersedia');
      expect(fallback.answer).not.toContain('Jl.');
    });

    test('6. PARTIAL scope lists available campuses and explicitly notes missing branch', () => {
      const partialEvidence = [
        renonEvidence,
        {
          id: 'jimbaran-only',
          sourceDocument: 'ISIAN_WEBSITE_PARTIAL.pdf',
          text: 'Kampus II (Jimbaran): Jl. Raya Kampus Udayana, Jimbaran.'
        }
      ];
      const frame = {
        domain: 'CAMPUS_LIFE',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'ALL',
        targetBranch: null,
        rawQuery: 'Sebutkan alamat semua kampus ITB STIKOM Bali.'
      };
      const ans = { status: ANSWERABILITY_STATUS.PARTIAL };
      const fallback = buildGenericExtractiveFallback(frame, partialEvidence, ans);

      expect(fallback.success).toBe(true);
      expect(fallback.answer).toContain('Kampus Renon (Pusat)');
      expect(fallback.answer).toContain('Jl. Raya Puputan No. 86 Renon, Denpasar');
      expect(fallback.answer).toContain('Kampus Jimbaran');
      expect(fallback.answer).toContain('Jl. Raya Kampus Udayana, Jimbaran');
      expect(fallback.answer).toContain('Catatan: Rincian alamat resmi untuk Kampus Abiansemal belum tercantum dalam panduan resmi yang tersedia saat ini.');
      expect(fallback.answer).not.toContain('Jl. Janger');
    });

    test('7. Footer contact filters strip Telepon, Hotline, Fax, WA, Email, and Website', () => {
      const frame = {
        domain: 'CAMPUS_LIFE',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'SINGLE',
        targetBranch: 'renon',
        rawQuery: 'Di mana kampus Renon?'
      };
      const ans = { status: ANSWERABILITY_STATUS.ANSWERABLE };
      const fallback = buildGenericExtractiveFallback(frame, [renonEvidence], ans);

      expect(fallback.success).toBe(true);
      expect(fallback.answer).toContain('Jl. Raya Puputan No. 86 Renon, Denpasar');
      expect(fallback.answer).not.toMatch(/\(?0361\)?\s*226127/);
      expect(fallback.answer).not.toMatch(/\(?0361\)?\s*235105/);
      expect(fallback.answer).not.toMatch(/081529000000/);
      expect(fallback.answer).not.toMatch(/telp|fax|whatsapp|email|website/i);
    });

    test('8. Accepted evidence empty fails closed safely', () => {
      const frame = {
        domain: 'CAMPUS_LIFE',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'ALL',
        targetBranch: null,
        rawQuery: 'Sebutkan alamat kampus.'
      };
      const ans = { status: ANSWERABILITY_STATUS.UNKNOWN };
      const fallback = buildGenericExtractiveFallback(frame, [], ans);

      expect(fallback.success).toBe(false);
      expect(fallback.handledSafely).toBe(true);
      expect(fallback.answer).toContain('belum dapat diverifikasi dari dokumen yang tersedia');
    });

    test('9. SINGLE scope without valid targetBranch fails closed with clarifying prompt', () => {
      const frame = {
        domain: 'CAMPUS_LIFE',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'SINGLE',
        targetBranch: null,
        rawQuery: 'Di mana kampusnya?'
      };
      const ans = { status: ANSWERABILITY_STATUS.UNKNOWN };
      const fallback = buildGenericExtractiveFallback(frame, allEvidence, ans);

      expect(fallback.success).toBe(false);
      expect(fallback.handledSafely).toBe(true);
      expect(fallback.answer).toContain('boleh diperjelas kampus atau cabang ITB STIKOM Bali mana yang ingin Kakak tanyakan?');
      expect(fallback.answer).not.toMatch(/renon/i);
      expect(fallback.answer).not.toMatch(/jimbaran/i);
      expect(fallback.answer).not.toMatch(/abiansemal/i);
      expect(fallback.answer).not.toContain('Jl. Raya Puputan');
      expect(fallback.answer).not.toContain('Jl. Raya Kampus Udayana');
      expect(fallback.answer).not.toContain('Jl. Janger');
    });
  });

  describe('8. Follow-Up Root Cause Regression Suite (Social Inquiry, Proximity Routing, Provenance & Completeness)', () => {
    test('1. Follow-up greeting does not repeat full initial PMB onboarding intro', async () => {
      const chatId = 'test-greeting-seq-' + Date.now();
      const firstTurn = await processTurn(chatId, 'Halo', { executeDispatch: false });
      expect(firstTurn.text).toMatch(/Selamat datang di layanan informasi resmi ITB STIKOM Bali/i);

      const secondTurn = await processTurn(chatId, 'Halo', { executeDispatch: false });
      expect(secondTurn.text).toMatch(/Halo kembali/i);
      expect(secondTurn.text).not.toMatch(/Selamat datang di layanan informasi resmi ITB STIKOM Bali/i);
    });

    test('2. Social inquiry ("Apa khabar?") routes to CONVERSATIONAL_SMALL_TALK with warm, concise reply', async () => {
      const mockClient = createMockOpenAIClient({
        speechAct: 'SOCIAL_INQUIRY',
        primaryIntent: 'CONVERSATIONAL_SMALL_TALK',
        userInterest: null,
        semanticConcepts: [],
        candidateEntities: [],
        requestedAspects: [],
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: null,
          locationScope: 'GENERAL'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        executionRoute: 'CONVERSATIONAL',
        confidence: 0.98,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync('Apa khabar?', {}, { customClient: mockClient });
      expect(frame.domain).toBe('CONVERSATIONAL');
      expect(frame.intent).toBe('CONVERSATIONAL_SMALL_TALK');
      expect(frame.retrievalRequired).toBe(false);

      const chatId = 'test-smalltalk-' + Date.now();
      const res = await processTurn(chatId, 'Apa kabar?', { executeDispatch: false });
      expect(res.text).toMatch(/Kabar baik/i);
      expect(res.text).not.toMatch(/pendaftaran mahasiswa baru \(PMB\), program studi, biaya kuliah/i);
    });

    test('3. Specific origin location updates location context (Gianyar -> Ubud refinement)', () => {
      const sessionData = {};
      const frame1 = resolveSemanticFrame('Kalau saya tinggal di Gianyar saya lebih dekat kampus mana?', sessionData);
      expect(frame1.intent).toBe('CAMPUS_LOCATION');
      expect(frame1.isProximityComparison).toBe(true);
      expect(frame1.userOrigin).toMatch(/Gianyar/i);

      sessionData.activeDomain = frame1.domain;
      sessionData.activeIntent = frame1.intent;
      sessionData.userOrigin = frame1.userOrigin;

      const frame2 = resolveSemanticFrame('Saya dari Gianyar Ubud jadi lebih dekat kampus mana?', sessionData);
      expect(frame2.intent).toBe('CAMPUS_LOCATION');
      expect(frame2.isProximityComparison).toBe(true);
      expect(frame2.userOrigin).toMatch(/Ubud/i);
    });

    test('3b. Origin location changes cleanly without merging (Gianyar -> Denpasar)', () => {
      const sessionData = { userOrigin: 'Gianyar' };
      const frame = resolveSemanticFrame('Kalau saya dari Denpasar lebih dekat kampus mana?', sessionData);
      expect(frame.userOrigin).toBe('Denpasar');
      expect(frame.userOrigin).not.toContain('Gianyar');
    });

    test('3c. Follow-up query without new origin retains active relevant origin context', () => {
      const sessionData = { userOrigin: 'Denpasar' };
      const frame = resolveSemanticFrame('Terus kalau naik motor kira-kira bagaimana ya?', sessionData);
      expect(frame.userOrigin).toBe('Denpasar');
    });

    test('3d. Ambiguous or invalid origin extraction attempt yields null', () => {
      expect(extractUserOriginLocation('Saya dari mana ya?')).toBeNull();
      expect(extractUserOriginLocation('Saya tinggal di kampus')).toBeNull();
      expect(extractUserOriginLocation('Dari rumah saya lebih dekat mana?')).toBeNull();
      expect(extractUserOriginLocation('Dari tempat tinggal saya lebih dekat mana?')).toBeNull();
    });

    test('3e. F.1: Proximity ellipsis "Kalau dari Denpasar bagaimana?" inherits proximity and updates origin to Denpasar', () => {
      const sessionData = {
        activeDomain: 'FACILITIES',
        activeIntent: 'CAMPUS_LOCATION',
        isProximityComparison: true,
        activeAspects: ['location', 'campus_location', 'address', 'all_locations', 'proximity_comparison'],
        userOrigin: 'Gianyar'
      };

      const frame = resolveSemanticFrame('Kalau dari Denpasar bagaimana?', sessionData);
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('CAMPUS_LOCATION');
      expect(frame.isProximityComparison).toBe(true);
      expect(frame.userOrigin).toBe('Denpasar');
      expect(frame.userOrigin).not.toContain('Gianyar');
      expect(frame.userOrigin).not.toContain('bagaimana');
    });

    test('3f. F.2: Ellipsis "Kalau begitu bagaimana?" retains prior origin (Gianyar) when context is active', () => {
      const sessionData = {
        activeDomain: 'FACILITIES',
        activeIntent: 'CAMPUS_LOCATION',
        isProximityComparison: true,
        activeAspects: ['location', 'campus_location', 'address', 'all_locations', 'proximity_comparison'],
        userOrigin: 'Gianyar'
      };

      const frame = resolveSemanticFrame('Kalau begitu bagaimana?', sessionData);
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('CAMPUS_LOCATION');
      expect(frame.isProximityComparison).toBe(true);
      expect(frame.userOrigin).toBe('Gianyar');
    });

    test('3g. F.3: Switching from proximity to explicit branch inquiry "Kampus Jimbaran di mana?" switches to SINGLE branch', () => {
      const sessionData = {
        activeDomain: 'FACILITIES',
        activeIntent: 'CAMPUS_LOCATION',
        isProximityComparison: true,
        activeAspects: ['location', 'campus_location', 'address', 'all_locations', 'proximity_comparison'],
        userOrigin: 'Gianyar'
      };

      const frame = resolveSemanticFrame('Kampus Jimbaran di mana?', sessionData);
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('CAMPUS_LOCATION');
      expect(frame.locationScope).toBe('SINGLE');
      expect(frame.targetBranch).toBe('jimbaran');
      expect(frame.isProximityComparison).toBe(false);
    });

    test('3h. F.4: Switching from proximity to academic inquiry "Apa saja program studi yang tersedia?" switches domain', () => {
      const sessionData = {
        activeDomain: 'FACILITIES',
        activeIntent: 'CAMPUS_LOCATION',
        isProximityComparison: true,
        activeAspects: ['location', 'campus_location', 'address', 'all_locations', 'proximity_comparison'],
        userOrigin: 'Gianyar'
      };

      const frame = resolveSemanticFrame('Apa saja program studi yang tersedia?', sessionData);
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.isProximityComparison).toBe(false);
    });

    test('3i. F.5: "Kampus terdekat dari rumah saya" rejects relative noun "rumah" as origin and asks for clarification', () => {
      const origin = extractUserOriginLocation('Kampus mana yang paling dekat dari rumah saya?');
      expect(origin).toBeNull();
      expect(origin).not.toBe('Rumah');

      const frame = resolveSemanticFrame('Kampus mana yang paling dekat dari rumah saya?', {});
      expect(frame.intent).toBe('CAMPUS_LOCATION');
      expect(frame.isProximityComparison).toBe(true);
      expect(frame.userOrigin).toBeNull();

      const fallbackRes = buildGenericExtractiveFallback(frame, [], {});
      expect(fallbackRes.handledSafely).toBe(true);
      expect(fallbackRes.answer).toMatch(/boleh diinfokan Kakak tinggal atau berdomisili di kota\/kabupaten mana/i);
      expect(fallbackRes.answer).not.toMatch(/\bRumah\b/);
    });

    test('3j. F.6: Repeated location changes (Gianyar -> Denpasar -> Badung) update cleanly without blending', () => {
      const session1 = {};
      const f1 = resolveSemanticFrame('Saya tinggal di Gianyar, lebih dekat mana?', session1);
      expect(f1.userOrigin).toBe('Gianyar');

      const session2 = { ...session1, userOrigin: f1.userOrigin, activeDomain: f1.domain, activeIntent: f1.intent, isProximityComparison: true };
      const f2 = resolveSemanticFrame('Kalau dari Denpasar bagaimana?', session2);
      expect(f2.userOrigin).toBe('Denpasar');
      expect(f2.userOrigin).not.toContain('Gianyar');

      const session3 = { ...session2, userOrigin: f2.userOrigin, activeDomain: f2.domain, activeIntent: f2.intent, isProximityComparison: true };
      const f3 = resolveSemanticFrame('Kalau dari Badung gimana?', session3);
      expect(f3.userOrigin).toBe('Badung');
      expect(f3.userOrigin).not.toContain('Denpasar');
      expect(f3.userOrigin).not.toContain('Gianyar');
    });

    test('4. Proximity query explains routing limitation safely without fabricating distance or travel times', () => {
      const frame = {
        domain: 'FACILITIES',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'ALL',
        isProximityComparison: true,
        userOrigin: 'Gianyar Ubud',
        rawQuery: 'Saya dari Gianyar Ubud jadi lebih dekat kampus mana?'
      };

      const mockEvidence = [
        { text: 'Kampus Renon: Jl. Raya Puputan No. 86 Renon, Denpasar' },
        { text: 'Kampus Jimbaran: Jl. Raya Kampus Udayana No. 8, Jimbaran' },
        { text: 'Kampus Abiansemal: Jl. Janger, Dauh Yeh Cani, Abiansemal' }
      ];

      const res = buildGenericExtractiveFallback(frame, mockEvidence, {});
      expect(res.success).toBe(true);
      expect(res.answer).toMatch(/tidak terdapat ketentuan kampus terdekat khusus/i);
      expect(res.answer).toMatch(/tidak memiliki integrasi perhitungan rute\/jarak langsung/i);
      expect(res.answer).toMatch(/Gianyar Ubud/i);
      expect(res.answer).toContain('Jl. Raya Puputan No. 86');
      expect(res.answer).toContain('Jl. Raya Kampus Udayana No. 8');
      expect(res.answer).toContain('Jl. Janger, Dauh Yeh Cani');
      expect(res.answer).toMatch(/aplikasi peta\/navigasi|Google Maps/i);

      // Invariant: MUST NOT fabricate speculative distances or drive times
      expect(res.answer).not.toMatch(/\b\d+\s*(?:km|kilometer)\b/i);
      expect(res.answer).not.toMatch(/\b\d+\s*(?:menit|jam)\b/i);

      // Invariant: MUST NOT assert ungrounded campus service claims
      expect(res.answer).not.toMatch(/Seluruh kampus melayani/i);
      expect(res.answer).not.toMatch(/administrasi perkuliahan/i);
    });

    test('4b. Proximity query with only partial addresses available displays only verified addresses and notes unconfirmed branches', () => {
      const frame = {
        domain: 'FACILITIES',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'ALL',
        isProximityComparison: true,
        userOrigin: 'Tabanan',
        rawQuery: 'Saya dari Tabanan lebih dekat kampus mana ya?'
      };

      // Only Renon and Jimbaran present, Abiansemal missing from evidence
      const partialEvidence = [
        { text: 'Kampus Renon: Jl. Raya Puputan No. 86 Renon, Denpasar' },
        { text: 'Kampus Jimbaran: Jl. Raya Kampus Udayana No. 8, Jimbaran' }
      ];

      const res = buildGenericExtractiveFallback(frame, partialEvidence, {});
      expect(res.success).toBe(true);
      expect(res.answer).toContain('Jl. Raya Puputan No. 86');
      expect(res.answer).toContain('Jl. Raya Kampus Udayana No. 8');

      // Abiansemal address must NOT leak from literal fallback
      expect(res.answer).not.toContain('Jl. Janger');
      expect(res.answer).toMatch(/Catatan: Alamat resmi untuk Kampus Abiansemal belum tercantum dalam dokumen yang tersedia/i);
      // No ungrounded branch service claims
      expect(res.answer).not.toMatch(/Seluruh kampus melayani/i);
    });

    test('4c. Proximity query with zero addresses available fails closed without displaying fabricated addresses', () => {
      const frame = {
        domain: 'FACILITIES',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'ALL',
        isProximityComparison: true,
        userOrigin: 'Singaraja',
        rawQuery: 'Saya dari Singaraja lebih dekat ke kampus mana?'
      };

      // Evidence exists but contains NO campus addresses (e.g. general text)
      const nonAddressEvidence = [
        { text: 'ITB STIKOM Bali adalah perguruan tinggi teknologi informasi terkemuka di Bali.' }
      ];

      const res = buildGenericExtractiveFallback(frame, nonAddressEvidence, {});
      expect(res.handledSafely).toBe(true);
      expect(res.source).toBe('unanswerable_natural_guidance');
      expect(res.answer).toMatch(/data alamat resmi kampus belum cukup terkonfirmasi dalam dokumen yang tersedia untuk membandingkan lokasi/i);

      // Must NOT contain any hardcoded street names
      expect(res.answer).not.toContain('Jl. Raya Puputan');
      expect(res.answer).not.toContain('Jl. Raya Kampus Udayana');
      expect(res.answer).not.toContain('Jl. Janger');
      expect(res.answer).not.toMatch(/Seluruh kampus melayani/i);
    });

    test('5. Contact numbers have traceable provenance to official document letterheads', () => {
      const jimbaranDocSnippet = 'Kampus II : Jl. Raya Kampus Udayana No. 8 Jimbaran - Kuta Selatan (0361) 8953534 Hotline : 081288778840';
      const abiansemalDocSnippet = 'Kampus III : Jl. Janger, Dauh Yeh Cani, Abiansemal - Badung (0361) 4790925 Hotline : 082145099633';

      expect(jimbaranDocSnippet).toMatch(/\(0361\)\s*8953534/);
      expect(jimbaranDocSnippet).toMatch(/081288778840/);
      expect(abiansemalDocSnippet).toMatch(/\(0361\)\s*4790925/);
      expect(abiansemalDocSnippet).toMatch(/082145099633/);
    });

    test('6. Conflicting or unverified contact numbers do not produce definitive claims', () => {
      const frame = {
        domain: 'CAMPUS_SERVICE',
        intent: 'CONTACT_INQUIRY',
        rawQuery: 'Berapa nomor telepon kampus Jimbaran?'
      };

      const fallback = buildGenericExtractiveFallback(frame, [
        { text: 'Kampus Jimbaran: Jl. Raya Kampus Udayana No. 8 (0361) 8953534 Hotline: 081288778840' }
      ], {});

      expect(fallback.success).toBe(true);
      expect(fallback.answer).toContain('(0361) 8953534');
    });

    test('7. Addresses are not merged across documents without evidence', () => {
      const jimbaranEvidence = {
        text: 'Kampus Jimbaran beralamat di Jl. Raya Kampus Udayana No. 8, Jimbaran, Kuta Selatan, Badung.'
      };
      const abiansemalEvidence = {
        text: 'Kampus Abiansemal beralamat di Jl. Janger, Dauh Yeh Cani, Abiansemal, Badung.'
      };

      const frameJimbaran = {
        domain: 'FACILITIES',
        intent: 'CAMPUS_LOCATION',
        locationScope: 'SINGLE',
        targetBranch: 'jimbaran',
        rawQuery: 'Di mana kampus Jimbaran?'
      };

      const resJimbaran = buildGenericExtractiveFallback(frameJimbaran, [jimbaranEvidence, abiansemalEvidence], {});
      expect(resJimbaran.answer).toContain('Jl. Raya Kampus Udayana');
      expect(resJimbaran.answer).not.toContain('Jl. Janger');
    });

    test('8. "Beasiswa apa saja" does not claim completeness from single partial research evidence', () => {
      const frame = {
        domain: 'SCHOLARSHIP',
        intent: 'SCHOLARSHIP_INQUIRY',
        aspects: ['scholarship'],
        rawQuery: 'Beasiswa apa saja yang ada di STIKOM Bali?'
      };

      const partialResearchEvidence = [
        {
          text: 'ITB STIKOM Bali memberikan Beasiswa Penelitian bagi dosen dan mahasiswa untuk publikasi jurnal nasional terakreditasi.',
          providedAspects: ['scholarship']
        }
      ];

      const evalRes = evaluateAnswerability(frame, { accepted: partialResearchEvidence, rejected: [] });
      expect(evalRes.status).toBe(ANSWERABILITY_STATUS.PARTIAL);
      expect(evalRes.missingAspects).toContain('scholarship_list');
    });

    test('9. Model failure fails closed safely to UNKNOWN without guessing', async () => {
      const { parseSemanticInterpretation } = require('../src/core/modelSemanticParser');
      const interp = await parseSemanticInterpretation(
        { rawQuery: 'Pertanyaan acak yang tidak dapat diproses' },
        {
          customClient: {
            chat: {
              completions: {
                create: async () => { throw new Error('API timeout simulation'); }
              }
            }
          }
        }
      );

      expect(interp.ambiguityLevel).toBe('HIGH');
      expect(interp.confidence).toBe(0.0);
      expect(interp.speechAct).toBe('UNKNOWN');
      expect(interp.executionRoute).toBe('UNKNOWN');
      expect(interp.metadata.fallbackInvoked).toBe(true);

      const frame = await resolveSemanticFrameAsync('Pertanyaan acak yang tidak dapat diproses', {}, {
        customClient: {
          chat: {
            completions: {
              create: async () => { throw new Error('API timeout simulation'); }
            }
          }
        }
      });
      expect(frame.traceMeta.resolverEngine).toBe('deterministic_fallback');
    });
  });
});
