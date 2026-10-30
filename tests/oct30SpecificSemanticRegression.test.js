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
const { resolveSemanticFrame, resolveSemanticFrameAsync } = require('../src/core/semanticFrameResolver');
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
});
