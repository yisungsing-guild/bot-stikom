'use strict';

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');

describe('QA-404 Curriculum Semester Ellipsis Regression', () => {
  const now = Date.now();

  test('A. POSITIVE — QA-404: activeDomain=ACADEMIC_PROGRAM + activeEntity=S1 Sistem Informasi inherits program for "Kalau semester 5 bagaimana?"', async () => {
    const sess = {
      activeEntity: 'S1 Sistem Informasi',
      activeDomain: 'ACADEMIC_PROGRAM',
      activeIntent: 'PROGRAM_INFO',
      lastAcademicProgramEntity: 'S1 Sistem Informasi',
      lastTurnTs: now
    };

    const frame = resolveSemanticFrame('Kalau semester 5 bagaimana?', sess);
    expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
    expect(frame.intent).toBe('CURRICULUM_INQUIRY');
    expect(frame.retrievalRequired).toBe(true);
    expect(frame.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);

    const res = await runPhase1DeterministicPipeline('qa404_pos_a', 'Kalau semester 5 bagaimana?', {
      sessionSnapshot: { data: sess }
    });
    const finalVerif = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    expect(res.semanticFrame?.domain).toBe('ACADEMIC_CURRICULUM');
    expect(res.semanticFrame?.intent).toBe('CURRICULUM_INQUIRY');
    expect(res.semanticFrame?.entities?.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);
    expect(finalVerif).not.toBe('NEEDS_CLARIFICATION');
    expect(res.answer || res.text || '').not.toMatch(/memerlukan konteks lebih lanjut/i);
  });

  test('B. POSITIVE — Existing ACADEMIC_CURRICULUM context continues to inherit S1 Sistem Informasi for semester 5', () => {
    const sess = {
      activeEntity: 'S1 Sistem Informasi',
      activeDomain: 'ACADEMIC_CURRICULUM',
      activeIntent: 'CURRICULUM_INQUIRY',
      lastTurnTs: now
    };
    const frame = resolveSemanticFrame('Kalau semester 5 bagaimana?', sess);
    expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
    expect(frame.intent).toBe('CURRICULUM_INQUIRY');
    expect(frame.retrievalRequired).toBe(true);
    expect(frame.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);
  });

  test('C. NEGATIVE — PMB context must NOT inherit old program entity on semester ellipsis', () => {
    const sess = {
      activeEntity: 'S1 Sistem Informasi',
      activeDomain: 'PMB',
      activeIntent: 'ADMISSION_PROCEDURE',
      lastTurnTs: now
    };
    const frame = resolveSemanticFrame('Kalau semester 5 bagaimana?', sess);
    expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
    expect(frame.intent).toBe('AMBIGUOUS_CLARIFICATION');
    expect(frame.retrievalRequired).toBe(false);
    expect(frame.entities).toHaveLength(0);
  });

  test('D. NEGATIVE — CAMPUS_SERVICE context must NOT experience cross-domain inheritance', () => {
    const sess = {
      activeEntity: 'S1 Sistem Informasi',
      activeDomain: 'CAMPUS_SERVICE',
      activeIntent: 'CAMPUS_SERVICE_INQUIRY',
      lastTurnTs: now
    };
    const frame = resolveSemanticFrame('Kalau semester 5 bagaimana?', sess);
    expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
    expect(frame.intent).toBe('AMBIGUOUS_CLARIFICATION');
    expect(frame.retrievalRequired).toBe(false);
    expect(frame.entities).toHaveLength(0);
  });

  test('E. NEGATIVE — Background-only entity (without activeEntity) must NOT be inherited', () => {
    const sess = {
      activeDomain: 'ACADEMIC_PROGRAM',
      preservedBackgroundEntity: 'S1 Sistem Informasi',
      lastAcademicProgramEntity: 'S1 Sistem Informasi',
      lastTurnTs: now
    };
    const frame = resolveSemanticFrame('Kalau semester 5 bagaimana?', sess);
    expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
    expect(frame.intent).toBe('AMBIGUOUS_CLARIFICATION');
    expect(frame.retrievalRequired).toBe(false);
    expect(frame.entities).toHaveLength(0);
  });

  test('E2. NEGATIVE — Invalid/unknown activeEntity in ACADEMIC_PROGRAM must NOT be inherited', () => {
    const sess = {
      activeEntity: 'Program Tidak Dikenal XYZ',
      activeDomain: 'ACADEMIC_PROGRAM',
      lastTurnTs: now
    };
    const frame = resolveSemanticFrame('Kalau semester 5 bagaimana?', sess);
    expect(frame.domain).toBe('ACADEMIC_CURRICULUM');
    expect(frame.intent).toBe('AMBIGUOUS_CLARIFICATION');
    expect(frame.retrievalRequired).toBe(false);
    expect(frame.entities).toHaveLength(0);
  });

  test('F. DOMAIN GUARD — Non-curriculum semester queries must NOT become curriculum clarification', () => {
    const sess = {
      activeEntity: 'S1 Sistem Informasi',
      activeDomain: 'ACADEMIC_PROGRAM',
      lastTurnTs: now
    };

    const fUts = resolveSemanticFrame('Kapan jadwal UTS semester 1?', sess);
    expect(fUts.domain).toBe('ACADEMIC_SCHEDULE');
    expect(fUts.intent).toBe('ACADEMIC_EVENT_SCHEDULE');
    expect(fUts.retrievalRequired).toBe(true);

    const fKrs = resolveSemanticFrame('Kapan jadwal pengisian KRS semester akhir?', sess);
    expect(fKrs.domain).toBe('ACADEMIC_SCHEDULE');
    expect(fKrs.intent).toBe('ACADEMIC_EVENT_SCHEDULE');
    expect(fKrs.retrievalRequired).toBe(true);

    const fCuti = resolveSemanticFrame('Bagaimana pengajuan cuti kuliah semester awal?', sess);
    expect(fCuti.domain).toBe('CAMPUS_SERVICE');
    expect(fCuti.intent).toBe('CAMPUS_SERVICE_INQUIRY');
    expect(fCuti.retrievalRequired).toBe(true);
  });

  test('SENTINEL — QA-372 remains untouched relative to dc005e8', async () => {
    const res = await runPhase1DeterministicPipeline('qa372_sentinel', 'Bagaimana prosedur cuti kuliah?', {
      sessionSnapshot: { data: {} }
    });
    const sub = res.subQueryResults?.[0] || {};
    expect(res.semanticFrame?.domain).toBe('CAMPUS_SERVICE');
    expect(res.semanticFrame?.intent).toBe('CAMPUS_SERVICE_INQUIRY');
    expect((sub.arbitrated?.accepted || []).length).toBe(0);
    expect(res.verification?.outcome || sub.verification?.outcome).toBe('SAFE_UNKNOWN');
  });
});

