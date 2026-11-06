'use strict';

/**
 * tests/stage3SemanticAndContextGeneralization.test.js
 *
 * Stage 3 Generalization & Context Continuity Verification Suite (Deterministic, Zero Paid API Calls).
 * Validates compositional semantic frame representation, unseen paraphrase understanding,
 * multi-turn context continuity (pronouns, ellipsis, attribute switches, entity switches,
 * ordinal references, partial entity disambiguation), and multi-intent decomposition.
 */

const {
  resolveSemanticFrame,
  resolveSemanticFrameAsync,
  composeSemanticElements,
  hasGenuineProgramFitSignal
} = require('../src/core/semanticFrameResolver');
const {
  evaluateContextDependency,
  extractOrderedSessionEntities,
  resolveOrdinalReference,
  resolvePartialEntityInContext,
  isGenuineEllipsis
} = require('../src/core/contextResolver');
const {
  decomposeQuery,
  decomposeQueryAsync,
  hasMultipleIntents
} = require('../src/core/multiIntentResolver');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');

describe('STAGE 3 — Compositional Semantic Frame & Generalized Context Engine', () => {

  describe('1. Compositional Semantic Frame Structure', () => {
    test('1a: Every resolved frame exposes compositional semantic fields (speechAct, targetEntities, requestedAttributes, entityRelationships, constraints, informationNeeds, excludedEntities, ambiguity)', () => {
      const frame = resolveSemanticFrame('Berapa rincian biaya kuliah S1 Sistem Informasi jalur reguler?', {});

      expect(frame.speechAct).toBe('QUESTION_WH');
      expect(Array.isArray(frame.targetEntities)).toBe(true);
      expect(frame.targetEntities.map(e => e.canonical)).toContain('S1 Sistem Informasi');
      expect(frame.requestedAttributes).toEqual(expect.arrayContaining(['fee']));
      expect(frame.entityRelationships).toEqual(expect.objectContaining({
        relationType: expect.any(String),
        isMultiTarget: false,
        isComparison: false
      }));
      expect(frame.constraints).toEqual(expect.objectContaining({
        academicLevel: 'S1',
        admissionTrack: 'Jalur Reguler'
      }));
      expect(frame.informationNeeds.some(need => need.includes('TUITION_FEE:fee'))).toBe(true);
      expect(Array.isArray(frame.excludedEntities)).toBe(true);
      expect(frame.ambiguity).toEqual(expect.objectContaining({
        isAmbiguous: false,
        level: 'LOW'
      }));
    });

    test('1b: Negated entities are separated into excludedEntities without polluting targetEntities', () => {
      const frame = resolveSemanticFrame('Berapa biaya kuliah S1 Sistem Komputer, bukan S1 Bisnis Digital?', {});

      const targetNames = frame.targetEntities.map(e => e.canonical);
      expect(targetNames).toContain('S1 Sistem Komputer');
      expect(targetNames).not.toContain('S1 Bisnis Digital');
      expect(frame.excludedEntities).toContain('S1 Bisnis Digital');
    });

    test('1c: Compositional speechAct distinguishes WH-questions, Yes/No questions, procedures, comparisons, and recommendations', () => {
      const ynFrame = resolveSemanticFrame('Apakah di STIKOM Bali tersedia kelas sore untuk karyawan?', {});
      expect(ynFrame.speechAct).toBe('QUESTION_YES_NO');
      expect(ynFrame.constraints.studyMode).toBe('KELAS_KARYAWAN_SORE');

      const procFrame = resolveSemanticFrame('Bagaimana langkah pendaftaran mahasiswa baru?', {});
      expect(procFrame.speechAct).toBe('REQUEST_PROCEDURE');

      const compFrame = resolveSemanticFrame('Apa bedanya S1 Sistem Informasi dan S1 Teknologi Informasi?', {});
      expect(compFrame.speechAct).toBe('REQUEST_COMPARISON');
      expect(compFrame.entityRelationships.isComparison).toBe(true);

      const recFrame = resolveSemanticFrame('Saya suka ngoding aplikasi dan tertarik software engineering, cocok masuk jurusan apa?', {});
      expect(recFrame.speechAct).toBe('REQUEST_RECOMMENDATION');
      expect(recFrame.intent).toBe('PROGRAM_RECOMMENDATION');
    });
  });

  describe('2. Prevention of Recommendation Hijacking on Catalog & Factual Queries', () => {
    test('2a: Generic catalog and faculty queries are NOT hijacked into PROGRAM_RECOMMENDATION', () => {
      const catalogQueries = [
        'Apa saja program studi yang tersedia di ITB STIKOM Bali?',
        'Pilihan program sarjana S1 apa saja yang dibuka?',
        'Ada jurusan diploma D3 apa di kampus ini?',
        'Program pascasarjana S2 yang tersedia apa saja?',
        'What study programs are available at ITB STIKOM Bali?'
      ];

      for (const q of catalogQueries) {
        const frame = resolveSemanticFrame(q, {});
        expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
        expect(frame.intent).not.toBe('PROGRAM_RECOMMENDATION');
        expect(hasGenuineProgramFitSignal(q)).toBe(false);
      }

      const facultyQueries = [
        'Ada fakultas apa saja di ITB STIKOM Bali?',
        'Struktur fakultas dan program studi di STIKOM Bali bagaimana?',
        'S1 Sistem Komputer berada di bawah fakultas apa?'
      ];

      for (const q of facultyQueries) {
        const frame = resolveSemanticFrame(q, {});
        expect(frame.intent).toBe('FACULTY_INQUIRY');
        expect(frame.intent).not.toBe('PROGRAM_RECOMMENDATION');
      }
    });

    test('2b: Genuine interest/aptitude/confusion queries still route to PROGRAM_RECOMMENDATION', () => {
      const recQueries = [
        'Saya suka desain grafis dan multimedia, sebaiknya ambil prodi apa?',
        'Aku bingung pilih jurusan, minatku di jaringan komputer dan iot',
        'Rekomendasi prodi untuk yang ingin berkarir jadi data analyst dong'
      ];

      for (const q of recQueries) {
        const frame = resolveSemanticFrame(q, {});
        expect(frame.intent).toBe('PROGRAM_RECOMMENDATION');
        expect(hasGenuineProgramFitSignal(q)).toBe(true);
      }
    });
  });

  describe('3. Unseen Paraphrases, Typos, and Informal Indonesian', () => {
    test('3a: Informal and typo-laden queries resolve to canonical entities and attributes', () => {
      const f1 = resolveSemanticFrame('klo prodi sk masuk fakultas ap y?', {});
      expect(f1.intent).toBe('FACULTY_INQUIRY');
      expect(f1.targetEntities.map(e => e.canonical)).toContain('S1 Sistem Komputer');
      expect(f1.requestedAttributes).toContain('faculty');

      const f2 = resolveSemanticFrame('biaya kuliah s1 bsnis dgtal brp ya kak?', {});
      expect(f2.domain).toBe('TUITION_FEE');
      expect(f2.targetEntities.map(e => e.canonical)).toContain('S1 Bisnis Digital');
      expect(f2.requestedAttributes).toContain('fee');

      const f3 = resolveSemanticFrame('akredtasi d3 manajemen infrmatika apa?', {});
      expect(f3.intent).toBe('PROGRAM_ACCREDITATION');
      expect(f3.targetEntities.map(e => e.canonical)).toContain('D3 Manajemen Informatika');
      expect(f3.requestedAttributes).toContain('accreditation');
    });
  });

  describe('4. Multi-Turn Context Continuity: Attribute Switch & Entity Switch', () => {
    test('4a: Attribute Switch on Same Entity (Curr -> Fee -> Accreditation -> Faculty -> SKS)', () => {
      const activeSession = {
        activeDomain: 'ACADEMIC_CURRICULUM',
        activeIntent: 'CURRICULUM_INQUIRY',
        activeEntity: 'S1 Sistem Informasi',
        activeEntities: ['S1 Sistem Informasi'],
        lastQuery: 'S1 Sistem Informasi belajar apa saja?'
      };

      const feeTurn = resolveSemanticFrame('Kalau biayanya berapa?', activeSession);
      expect(feeTurn.domain).toBe('TUITION_FEE');
      expect(feeTurn.targetEntities.map(e => e.canonical)).toContain('S1 Sistem Informasi');

      const accredTurn = resolveSemanticFrame('Akreditasinya apa?', activeSession);
      expect(accredTurn.intent).toBe('PROGRAM_ACCREDITATION');
      expect(accredTurn.targetEntities.map(e => e.canonical)).toContain('S1 Sistem Informasi');

      const facTurn = resolveSemanticFrame('Masuk fakultas apa?', activeSession);
      expect(facTurn.intent).toBe('FACULTY_INQUIRY');
      expect(facTurn.targetEntities.map(e => e.canonical)).toContain('S1 Sistem Informasi');

      const sksTurn = resolveSemanticFrame('Berapa total SKS-nya?', activeSession);
      expect(sksTurn.targetEntities.map(e => e.canonical)).toContain('S1 Sistem Informasi');
      expect(sksTurn.requestedAttributes).toContain('sks');
    });

    test('4b: Entity Switch on Same Attribute via Ellipsis ("Kalau yang S1 Bisnis Digital?", "Bagaimana dengan D3 MI?")', () => {
      const feeSession = {
        activeDomain: 'TUITION_FEE',
        activeIntent: 'TUITION_FEE_INQUIRY',
        activeAspects: ['fee', 'tuition', 'dpp'],
        activeEntity: 'S1 Sistem Informasi',
        lastQuery: 'Berapa biaya kuliah S1 Sistem Informasi?'
      };

      const switch1 = resolveSemanticFrame('Kalau yang S1 Bisnis Digital?', feeSession);
      expect(switch1.domain).toBe('TUITION_FEE');
      expect(switch1.intent).toBe('TUITION_FEE_INQUIRY');
      expect(switch1.targetEntities.map(e => e.canonical)).toEqual(['S1 Bisnis Digital']);
      expect(switch1.requestedAttributes).toContain('fee');

      const switch2 = resolveSemanticFrame('Bagaimana dengan D3 Manajemen Informatika?', feeSession);
      expect(switch2.domain).toBe('TUITION_FEE');
      expect(switch2.intent).toBe('TUITION_FEE_INQUIRY');
      expect(switch2.targetEntities.map(e => e.canonical)).toEqual(['D3 Manajemen Informatika']);

      const facultySession = {
        activeDomain: 'ACADEMIC_PROGRAM',
        activeIntent: 'FACULTY_INQUIRY',
        activeAspects: ['faculty', 'academic_structure'],
        activeEntity: 'S1 Sistem Informasi',
        lastQuery: 'S1 Sistem Informasi masuk fakultas apa?'
      };

      const switchFac = resolveSemanticFrame('Kalau D3 MI?', facultySession);
      expect(switchFac.intent).toBe('FACULTY_INQUIRY');
      expect(switchFac.targetEntities.map(e => e.canonical)).toEqual(['D3 Manajemen Informatika']);
      expect(switchFac.requestedAttributes).toContain('faculty');
    });
  });

  describe('5. Ordinal Reference Resolution ("yang pertama", "yang kedua", "keduanya")', () => {
    const multiEntitySession = {
      activeDomain: 'ACADEMIC_PROGRAM',
      activeIntent: 'PROGRAM_COMPARISON',
      activeEntity: 'S1 Sistem Informasi',
      activeEntities: ['S1 Sistem Informasi', 'S1 Bisnis Digital', 'D3 Manajemen Informatika'],
      lastQuery: 'Jelaskan perbedaan S1 Sistem Informasi, S1 Bisnis Digital, dan D3 Manajemen Informatika'
    };

    test('5a: "Kalau yang pertama biayanya berapa?" resolves to first entity (S1 Sistem Informasi)', () => {
      const ord1 = resolveOrdinalReference('Kalau yang pertama biayanya berapa?', multiEntitySession);
      expect(ord1).toBeTruthy();
      expect(ord1.ordinalType).toBe('FIRST');
      expect(ord1.resolvedEntities).toEqual(['S1 Sistem Informasi']);

      const frame1 = resolveSemanticFrame('Kalau yang pertama biayanya berapa?', multiEntitySession);
      expect(frame1.domain).toBe('TUITION_FEE');
      expect(frame1.targetEntities.map(e => e.canonical)).toEqual(['S1 Sistem Informasi']);
    });

    test('5b: "Yang kedua masuk fakultas apa?" resolves to second entity (S1 Bisnis Digital)', () => {
      const frame2 = resolveSemanticFrame('Yang kedua masuk fakultas apa?', multiEntitySession);
      expect(frame2.intent).toBe('FACULTY_INQUIRY');
      expect(frame2.targetEntities.map(e => e.canonical)).toEqual(['S1 Bisnis Digital']);
    });

    test('5c: "Kalau yang terakhir akreditasinya apa?" resolves to last entity (D3 Manajemen Informatika)', () => {
      const frameLast = resolveSemanticFrame('Kalau yang terakhir akreditasinya apa?', multiEntitySession);
      expect(frameLast.intent).toBe('PROGRAM_ACCREDITATION');
      expect(frameLast.targetEntities.map(e => e.canonical)).toEqual(['D3 Manajemen Informatika']);
    });

    test('5d: "Berapa biaya keduanya?" resolves to both entities when 2 entities are active', () => {
      const pairSession = {
        activeDomain: 'ACADEMIC_PROGRAM',
        activeEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        activeEntity: 'S1 Sistem Informasi',
        lastQuery: 'Apa bedanya S1 Sistem Informasi dan S1 Sistem Komputer?'
      };

      const frameBoth = resolveSemanticFrame('Berapa biaya keduanya?', pairSession);
      expect(frameBoth.domain).toBe('TUITION_FEE');
      expect(frameBoth.targetEntities.map(e => e.canonical)).toEqual([
        'S1 Sistem Informasi',
        'S1 Sistem Komputer'
      ]);
      expect(frameBoth.isMultiTarget).toBe(true);
    });
  });

  describe('6. Partial Entity Disambiguation & Ambiguity Detection in Context', () => {
    test('6a: Ambiguous partial mention ("Teknologi masuk fakultas apa?") in isolated session marks frame as HIGH ambiguity and triggers CLARIFY gate', () => {
      const isolatedFrame = resolveSemanticFrame('Teknologi masuk fakultas apa?', {});
      expect(isolatedFrame.intent).toBe('FACULTY_INQUIRY');
      expect(isolatedFrame.isAmbiguous).toBe(true);
      expect(isolatedFrame.ambiguityLevel).toBe('HIGH');
      expect(isolatedFrame.ambiguity.isAmbiguous).toBe(true);
      expect(isolatedFrame.ambiguity.candidateEntities).toContain('S1 Teknologi Informasi');

      const gate = evaluateAnswerability(isolatedFrame, { accepted: [] });
      expect(gate.status).toBe(ANSWERABILITY_STATUS.CLARIFY);
    });

    test('6b: Partial mention ("Teknologi masuk fakultas apa?") with single compatible active entity in session resolves cleanly to S1 Teknologi Informasi', () => {
      const tiSession = {
        activeDomain: 'ACADEMIC_PROGRAM',
        activeEntity: 'S1 Teknologi Informasi',
        activeEntities: ['S1 Teknologi Informasi'],
        lastQuery: 'Apa itu S1 Teknologi Informasi?'
      };

      const resolvedFrame = resolveSemanticFrame('Teknologi masuk fakultas apa?', tiSession);
      expect(resolvedFrame.intent).toBe('FACULTY_INQUIRY');
      expect(resolvedFrame.isAmbiguous).toBe(false);
      expect(resolvedFrame.targetEntities.map(e => e.canonical)).toEqual(['S1 Teknologi Informasi']);
    });

    test('6c: Partial mention ("Sistem itu biayanya berapa?") when BOTH S1 Sistem Informasi and S1 Sistem Komputer are active in session marks HIGH ambiguity', () => {
      const conflictingSession = {
        activeDomain: 'ACADEMIC_PROGRAM',
        activeEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        activeEntity: 'S1 Sistem Informasi',
        lastQuery: 'Perbedaan S1 Sistem Informasi dan S1 Sistem Komputer'
      };

      const ambigFrame = resolveSemanticFrame('Prodi Sistem masuk fakultas apa?', conflictingSession);
      expect(ambigFrame.isAmbiguous).toBe(true);
      expect(ambigFrame.ambiguityLevel).toBe('HIGH');
      expect(ambigFrame.ambiguity.candidateEntities).toEqual(
        expect.arrayContaining(['S1 Sistem Informasi', 'S1 Sistem Komputer'])
      );
    });
  });

  describe('7. Multi-Intent Decomposition & Inter-Clause Context Carryover', () => {
    test('7a: Compound query carries entity from Clause 1 to Clause 2 in both sync and async modes', async () => {
      const q = 'Jelaskan prodi S1 Sistem Komputer dan berapa rincian biayanya?';
      expect(hasMultipleIntents(q)).toBe(true);

      const syncFrames = decomposeQuery(q, {});
      const asyncFrames = await decomposeQueryAsync(q, {});

      expect(syncFrames.length).toBe(2);
      expect(asyncFrames.length).toBe(2);

      expect(syncFrames[0].targetEntities.map(e => e.canonical)).toContain('S1 Sistem Komputer');
      expect(syncFrames[1].domain).toBe('TUITION_FEE');
      expect(syncFrames[1].targetEntities.map(e => e.canonical)).toContain('S1 Sistem Komputer');

      expect(asyncFrames[1].domain).toBe('TUITION_FEE');
      expect(asyncFrames[1].targetEntities.map(e => e.canonical)).toContain('S1 Sistem Komputer');
    });

    test('7b: Compound query with entity-switch ellipsis carries attribute/intent from Clause 1 to Clause 2', () => {
      const q = 'Berapa biaya kuliah S1 Sistem Informasi? Kalau S1 Bisnis Digital?';
      expect(hasMultipleIntents(q)).toBe(true);

      const frames = decomposeQuery(q, {});
      expect(frames.length).toBe(2);

      expect(frames[0].domain).toBe('TUITION_FEE');
      expect(frames[0].targetEntities.map(e => e.canonical)).toEqual(['S1 Sistem Informasi']);

      expect(frames[1].domain).toBe('TUITION_FEE');
      expect(frames[1].intent).toBe('TUITION_FEE_INQUIRY');
      expect(frames[1].targetEntities.map(e => e.canonical)).toEqual(['S1 Bisnis Digital']);
    });
  });
});
