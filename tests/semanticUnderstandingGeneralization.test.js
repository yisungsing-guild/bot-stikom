const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { normalizeUserQuery } = require('../src/utils/queryNormalizer');

describe('Stage 2A: Semantic Understanding Generalization Suite', () => {

  describe('1. Ambiguous Query Clarification (Non-OOD Gating)', () => {
    test('ID 417 "Yang mana lebih bagus?" resolves to AMBIGUOUS_CLARIFICATION with ASK_CLARIFICATION', () => {
      const frame = resolveSemanticFrame('Yang mana lebih bagus?');
      expect(frame.domain).toBe('GENERAL');
      expect(frame.intent).toBe('AMBIGUOUS_CLARIFICATION');
      expect(frame.desiredAction).toBe('ASK_CLARIFICATION');
      expect(frame.aspects).toContain('ambiguous_clarification');
    });

    test('"Kalau program satunya?" resolves to AMBIGUOUS_CLARIFICATION', () => {
      const frame = resolveSemanticFrame('Kalau program satunya?');
      expect(frame.domain).toBe('GENERAL');
      expect(frame.intent).toBe('AMBIGUOUS_CLARIFICATION');
      expect(frame.desiredAction).toBe('ASK_CLARIFICATION');
    });

    test('"Kalau program satunya?" with prior comparison session context resolves to alternative entity without clarifying', () => {
      const session = {
        activeEntities: ['S1 Bisnis Digital', 'S1 Sistem Informasi'],
        candidateEntities: ['S1 Bisnis Digital', 'S1 Sistem Informasi'],
        activeEntity: 'S1 Bisnis Digital',
        activeDomain: 'ACADEMIC_PROGRAM',
        activeIntent: 'PROGRAM_OVERVIEW',
        lastQuery: 'Apa bedanya Bisnis Digital dengan Sistem Informasi?'
      };
      const frame = resolveSemanticFrame('Kalau program satunya?', session);
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('PROGRAM_OVERVIEW');
      expect(frame.desiredAction).toBe('PROVIDE_PROGRAM_OVERVIEW');
      expect(frame.entities.map(e => e.canonical)).toContain('S1 Sistem Informasi');
    });

    test('"Bagaimana caranya?" resolves to AMBIGUOUS_CLARIFICATION', () => {
      const frame = resolveSemanticFrame('Bagaimana caranya?');
      expect(frame.domain).toBe('GENERAL');
      expect(frame.intent).toBe('AMBIGUOUS_CLARIFICATION');
      expect(frame.desiredAction).toBe('ASK_CLARIFICATION');
    });

    test('"Mana yang lebih unggul?" resolves to AMBIGUOUS_CLARIFICATION', () => {
      const frame = resolveSemanticFrame('Mana yang lebih unggul?');
      expect(frame.domain).toBe('GENERAL');
      expect(frame.intent).toBe('AMBIGUOUS_CLARIFICATION');
      expect(frame.desiredAction).toBe('ASK_CLARIFICATION');
    });
  });

  describe('2. Negative Controls: Strict Out-Of-Domain Rejection', () => {
    test('Gambling query "Prediksi togel hari ini" is refused as OUT_OF_DOMAIN_GAMBLING', () => {
      const frame = resolveSemanticFrame('Prediksi togel hari ini');
      expect(frame.domain).toBe('OUT_OF_DOMAIN');
      expect(frame.intent).toBe('OUT_OF_DOMAIN_GAMBLING');
      expect(frame.desiredAction).toBe('REFUSE_OUT_OF_DOMAIN');
    });

    test('Automotive query "Ganti oli motor di mana" is refused as OUT_OF_DOMAIN', () => {
      const frame = resolveSemanticFrame('Ganti oli motor di mana');
      expect(frame.domain).toBe('OUT_OF_DOMAIN');
      expect(frame.intent).toBe('OUT_OF_DOMAIN_INQUIRY');
      expect(frame.desiredAction).toBe('REFUSE_OUT_OF_DOMAIN');
    });

    test('Culinary query "Resep babi guling" is refused as OUT_OF_DOMAIN', () => {
      const frame = resolveSemanticFrame('Resep babi guling');
      expect(frame.domain).toBe('OUT_OF_DOMAIN');
      expect(frame.intent).toBe('OUT_OF_DOMAIN_INQUIRY');
      expect(frame.desiredAction).toBe('REFUSE_OUT_OF_DOMAIN');
    });

    test('Agriculture query "Beli bibit lele" is refused as OUT_OF_DOMAIN', () => {
      const frame = resolveSemanticFrame('Beli bibit lele');
      expect(frame.domain).toBe('OUT_OF_DOMAIN');
      expect(frame.intent).toBe('OUT_OF_DOMAIN_INQUIRY');
      expect(frame.desiredAction).toBe('REFUSE_OUT_OF_DOMAIN');
    });
  });

  describe('3. Contextual Location Attributes (Di Mana Disambiguation)', () => {
    test('"Lulusannya nanti kerja di mana?" binds to career_prospects and strictly NOT campus_location', () => {
      const frame = resolveSemanticFrame('Lulusannya nanti kerja di mana?');
      expect(frame.aspects).toContain('career_prospects');
      expect(frame.aspects).not.toContain('campus_location');
      expect(frame.requestedAttributes).toContain('career_prospects');
      expect(frame.requestedAttributes).not.toContain('campus_location');
      expect(frame.intent).toBe('CAREER_PROSPECTS_INQUIRY');
    });

    test('"Magangnya di mana?" binds to internship and strictly NOT campus_location', () => {
      const frame = resolveSemanticFrame('Magangnya di mana?');
      expect(frame.aspects).toContain('internship');
      expect(frame.aspects).not.toContain('campus_location');
      expect(frame.requestedAttributes).toContain('internship');
      expect(frame.requestedAttributes).not.toContain('campus_location');
    });

    test('"Tes PMB di mana?" binds to admission_test_location / procedure and NOT campus_location', () => {
      const frame = resolveSemanticFrame('Tes PMB di mana?');
      expect(frame.aspects).not.toContain('campus_location');
      expect(frame.requestedAttributes).not.toContain('campus_location');
      const hasTestOrProc = frame.aspects.includes('admission_test_location') ||
        frame.aspects.includes('procedure') ||
        frame.aspects.includes('admission_procedure');
      expect(hasTestOrProc).toBe(true);
    });

    test('"Kampus Renon di mana?" correctly preserves campus_location attribute and FACILITIES domain', () => {
      const frame = resolveSemanticFrame('Kampus Renon di mana?');
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('CAMPUS_LOCATION');
      expect(frame.aspects).toContain('campus_location');
      expect(frame.aspects).toContain('location');
    });
  });

  describe('4. Generalized Typo Understanding in Query Normalizer', () => {
    test('"syarat msuk" normalizes to "syarat masuk" while keeping rawText intact', () => {
      const res = normalizeUserQuery('syarat msuk');
      expect(res.rawText).toBe('syarat msuk');
      expect(res.normalizedText).toBe('syarat masuk');
    });

    test('"pendaftaran dbuka" normalizes to "pendaftaran dibuka"', () => {
      const res = normalizeUserQuery('pendaftaran dbuka');
      expect(res.rawText).toBe('pendaftaran dbuka');
      expect(res.normalizedText).toBe('pendaftaran dibuka');
    });

    test('"lulusan pket c bsa dftr" normalizes to "lulusan paket c bisa daftar"', () => {
      const res = normalizeUserQuery('lulusan pket c bsa dftr');
      expect(res.rawText).toBe('lulusan pket c bsa dftr');
      expect(res.normalizedText).toBe('lulusan paket c bisa daftar');
    });

    test('"biyaya kuliah" normalizes to "biaya kuliah"', () => {
      const res = normalizeUserQuery('biyaya kuliah');
      expect(res.rawText).toBe('biyaya kuliah');
      expect(res.normalizedText).toBe('biaya kuliah');
    });

    test('Official program entity acronyms (TI, SI, BD, SK, MI) are never mutated', () => {
      const res1 = normalizeUserQuery('biaya kuliah prodi ti dan bd');
      expect(res1.normalizedText).toBe('biaya kuliah prodi ti dan bd');

      const res2 = normalizeUserQuery('syarat masuk s1 sistem informasi sk mi');
      expect(res2.normalizedText).toBe('syarat masuk s1 sistem informasi sk mi');
    });
  });

  describe('5. Established Behavioral Preservation', () => {
    test('ID 13 & 17: Greeting "Halo" and "Selamat pagi" remain CONVERSATIONAL', () => {
      const halo = resolveSemanticFrame('Halo');
      expect(halo.domain).toBe('CONVERSATIONAL');
      expect(halo.intent).toBe('CONVERSATIONAL_GREETING');

      const pagi = resolveSemanticFrame('Selamat pagi');
      expect(pagi.domain).toBe('CONVERSATIONAL');
      expect(pagi.intent).toBe('CONVERSATIONAL_GREETING');
    });

    test('ID 421: "Biaya?" remains TUITION_FEE_INQUIRY', () => {
      const biaya = resolveSemanticFrame('Biaya?');
      expect(biaya.domain).toBe('TUITION_FEE');
      expect(biaya.intent).toBe('TUITION_FEE_INQUIRY');
    });

    test('ID 422: "Gelombang?" remains ADMISSION_SCHEDULE', () => {
      const gel = resolveSemanticFrame('Gelombang?');
      expect(gel.domain).toBe('PMB');
      expect(gel.intent).toBe('ADMISSION_SCHEDULE');
    });

    test('ID 425: "Kampus?" remains general campus directory inquiry', () => {
      const kampus = resolveSemanticFrame('Kampus?');
      expect(kampus.domain).toBe('GENERAL');
      expect(kampus.intent).toBe('GENERAL_INQUIRY');
    });
  });
});
