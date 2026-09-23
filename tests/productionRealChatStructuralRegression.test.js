/**
 * tests/productionRealChatStructuralRegression.test.js
 *
 * Targeted regression suite verifying production real-chat structural remediation:
 * 1. TI career follow-up inherits careerOutcome
 * 2. Explicit "biaya TI" overrides career inheritance
 * 3. Competitor comparison after Double Degree does not route to Double Degree
 * 4. TA after JCOS/yudisium does not contain/use JCOS
 * 5. Raw query remains unchanged
 * 6. General UKM enumeration is not truncated to one top chunk
 * 7. Filtered UKM enumeration never dumps unrelated full list
 * 8. Klungkung query does not fabricate a best campus
 * 9. GMTI receives retrieval opportunity before bounded no-data
 * 10. Same-chat processing preserves inbound order
 * 11. Different chats remain concurrent
 * 12. Same-chat queue survives a failed preceding request
 */

const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { resolveEffectiveSemanticFrame } = require('../src/engine/semanticFrameResolver');
const { resolveContextAuthority } = require('../src/engine/contextAuthority');
const { enqueueChat, getActiveQueueCount } = require('../src/engine/chatQueue');

describe('Production Real-Chat Structural Regression', () => {
  jest.setTimeout(30000);

  test('1. TI career follow-up inherits careerOutcome', async () => {
    const turn1Query = 'Kalau jurusan sistem informasi, nanti tamatnya bisa bekerja menjadi apa ya?';
    const turn1Res = await querySemanticRag(turn1Query, { testMode: true });
    expect(turn1Res).toBeDefined();
    expect(turn1Res.answer).toBeDefined();

    const turn1State = turn1Res.conversationState || {
      activeDomain: 'career',
      activeEntity: 'S1 Sistem Informasi',
      activeField: 'careerOutcome',
      lastUserIntent: 'ask_career_prospects'
    };

    const turn2Query = 'Kalau jurusan Teknologi Informasi?';
    const frame = resolveEffectiveSemanticFrame(turn2Query, { sessionState: turn1State });
    expect(frame).toBeDefined();
    expect(frame.entities[0]?.canonical).toMatch(/teknologi informasi/i);
    expect(frame.requestedFields).toContain('careerOutcome');

    const turn2Res = await querySemanticRag(turn2Query, {
      testMode: true,
      conversationState: turn1State,
      sessionData: { conversationState: turn1State }
    });

    expect(turn2Res).toBeDefined();
    expect(turn2Res.answer).toBeDefined();
    expect(turn2Res.source).not.toBe('semantic-rag-insufficient-data');
    expect(turn2Res.answer).toMatch(/(?:karier|prospek|pekerjaan|software|pengembang|bidang|lulusan)/i);
  });

  test('2. Explicit "biaya TI" overrides career inheritance', async () => {
    const priorCareerState = {
      activeDomain: 'career',
      activeEntity: 'S1 Sistem Informasi',
      activeField: 'careerOutcome',
      lastUserIntent: 'ask_career_prospects'
    };

    const query = 'Berapa biaya kuliah jurusan Teknologi Informasi?';
    const frame = resolveEffectiveSemanticFrame(query, { sessionState: priorCareerState });
    expect(frame).toBeDefined();
    expect(frame.domain.primary).toMatch(/^(?:fee|financial)$/);
    expect(frame.requestedFields).toContain('fee');
    expect(frame.requestedFields).not.toContain('careerOutcome');

    const res = await querySemanticRag(query, {
      testMode: true,
      conversationState: priorCareerState,
      sessionData: { conversationState: priorCareerState }
    });
    expect(res).toBeDefined();
    expect(res.answer).toMatch(/(?:biaya|spp|ukt|dpp|rupiah|rp)/i);
  });

  test('3. Competitor comparison after Double Degree does not route to Double Degree', async () => {
    const priorDdState = {
      activeDomain: 'academic_cooperation',
      activeEntity: 'Double Degree',
      activeField: 'requirements',
      lastUserIntent: 'ask_international_program'
    };

    const compQuery = 'Kalau kampus lain seperti INSTIKI atau Primakara bagaimana?';
    const ca = resolveContextAuthority(compQuery, priorDdState);
    expect(ca.effectiveQuery).toBe(compQuery);
    expect(ca.resolvedDomain).not.toBe('academic_cooperation');

    const res = await querySemanticRag(compQuery, {
      testMode: true,
      conversationState: priorDdState,
      sessionData: { conversationState: priorDdState }
    });
    expect(res).toBeDefined();
    expect(res.answer).not.toMatch(/double\s+degree/i);
  });

  test('4. TA after JCOS/yudisium does not contain/use JCOS', async () => {
    const priorUkmState = {
      activeDomain: 'student_organization',
      activeEntity: 'UKM JCOS',
      activeField: 'activity',
      lastUserIntent: 'ask_organization_detail'
    };

    const taQuery = 'Syarat pengajuan TA apa saja?';
    const ca = resolveContextAuthority(taQuery, priorUkmState);
    expect(ca.effectiveQuery).toBe(taQuery);
    expect(ca.effectiveQuery).not.toContain('JCOS');

    const res = await querySemanticRag(taQuery, {
      testMode: true,
      conversationState: priorUkmState,
      sessionData: { conversationState: priorUkmState }
    });
    expect(res).toBeDefined();
    expect(res.answer).not.toMatch(/jcos/i);
    expect(res.answer).toMatch(/(?:tugas akhir|skripsi|sks|ipk|akademik|syarat)/i);
  });

  test('5. Raw query remains unchanged', () => {
    const rawUtterance = 'Kalau jurusan Teknologi Informasi?';
    const priorState = {
      activeDomain: 'career',
      activeEntity: 'S1 Sistem Informasi',
      activeField: 'careerOutcome'
    };

    const ca = resolveContextAuthority(rawUtterance, priorState);
    expect(ca.effectiveQuery).toBe(rawUtterance);
    expect(ca.effectiveQuery).not.toContain('untuk');

    const frame = resolveEffectiveSemanticFrame(rawUtterance, { sessionState: priorState });
    expect(frame.rawQuery).toBe(rawUtterance);
  });

  test('6. General UKM enumeration is not truncated to one top chunk', async () => {
    const listQuery = 'Untuk unit kegiatan mahasiswa, ada apa saja?';
    const res = await querySemanticRag(listQuery, { testMode: true });
    expect(res).toBeDefined();
    expect(res.answer).toBeDefined();
    expect(res.answer).not.toContain('PROFILE ATHENA ESPORT');
    expect(res.answer).toMatch(/(?:UKM|Ormawa|organisasi|tercatat|daftar)/i);
    expect(res.source).toMatch(/semantic-rag-ukm-list/i);
  });

  test('7. Filtered UKM enumeration never dumps unrelated full list', async () => {
    const seniQuery = 'UKM yang menangani seni ada apa saja?';
    const seniRes = await querySemanticRag(seniQuery, { testMode: true });
    expect(seniRes).toBeDefined();
    expect(seniRes.answer).toBeDefined();
    expect(seniRes.answer).not.toMatch(/Ada 32 UKM\/Ormawa yang tercatat/i);
    expect(seniRes.answer).toMatch(/(?:seni|teater|tari|tabuh|musik|vokal|dance)/i);

    const unsupportedQuery = 'UKM yang menangani polo berkuda ada apa saja?';
    const unsuppRes = await querySemanticRag(unsupportedQuery, { testMode: true });
    expect(unsuppRes).toBeDefined();
    expect(unsuppRes.answer).toBeDefined();
    expect(unsuppRes.answer).not.toMatch(/Ada 32 UKM\/Ormawa yang tercatat/i);
    expect(unsuppRes.source).toMatch(/semantic-rag-.*insufficient-data|semantic-rag-ukm-interest-no-data/i);
  });

  test('8. Klungkung query does not fabricate a best campus', async () => {
    const locQuery = 'Kalau rumah saya di Klungkung, kampus mana yang paling bagus saya pilih?';
    const res = await querySemanticRag(locQuery, { testMode: true });
    expect(res).toBeDefined();
    expect(res.answer).toBeDefined();
    expect(res.answer).toMatch(/(?:Denpasar|Renon)/i);
    expect(res.answer).toMatch(/Jimbaran/i);
    expect(res.answer).toMatch(/Abiansemal/i);
    expect(res.answer).not.toMatch(/paling bagus.*(?:hanya|adalah)\s+kampus\s+abiansemal/i);
    expect(res.answer).toMatch(/(?:tidak menetapkan|paling sesuai|pertimbangan|rute|kebutuhan)/i);
  });

  test('9. GMTI receives retrieval opportunity before bounded no-data', async () => {
    const gmtiQuery = 'GMTI itu apa ya?';
    const res = await querySemanticRag(gmtiQuery, { testMode: true });
    expect(res).toBeDefined();
    expect(res.answer).toBeDefined();
    expect(res.source).toBe('semantic-rag-bounded-evidence-eval');
    expect(res.answer).toMatch(/perlengkapan/i);
    expect(res.answer).not.toMatch(/singkatan "GMTI" yang dimaksud itu apa ya/i);
  });

  test('10. Same-chat processing preserves inbound order', async () => {
    const orderResults = [];
    const chatId = 'test-inbound-order-1';

    const p1 = enqueueChat(chatId, async () => {
      await new Promise(r => setTimeout(r, 60));
      orderResults.push('first');
      return 'first';
    });

    const p2 = enqueueChat(chatId, async () => {
      await new Promise(r => setTimeout(r, 20));
      orderResults.push('second');
      return 'second';
    });

    const p3 = enqueueChat(chatId, async () => {
      await new Promise(r => setTimeout(r, 10));
      orderResults.push('third');
      return 'third';
    });

    await Promise.all([p1, p2, p3]);
    expect(orderResults).toEqual(['first', 'second', 'third']);
  });

  test('11. Different chats remain concurrent', async () => {
    const executionOrder = [];

    const slowChat = enqueueChat('slow-chat-a', async () => {
      await new Promise(r => setTimeout(r, 70));
      executionOrder.push('slow-chat-done');
    });

    const fastChat = enqueueChat('fast-chat-b', async () => {
      await new Promise(r => setTimeout(r, 15));
      executionOrder.push('fast-chat-done');
    });

    await Promise.all([slowChat, fastChat]);
    expect(executionOrder).toEqual(['fast-chat-done', 'slow-chat-done']);
  });

  test('12. Same-chat queue survives a failed preceding request (Amendment 5)', async () => {
    const chatId = 'test-failure-recovery-1';
    let failedCaught = false;

    const failingTask = enqueueChat(chatId, async () => {
      await new Promise(r => setTimeout(r, 20));
      throw new Error('Deliberate task failure for testing queue survival');
    }).catch(err => {
      failedCaught = true;
      expect(err.message).toContain('Deliberate task failure');
    });

    const subsequentTask = enqueueChat(chatId, async () => {
      await new Promise(r => setTimeout(r, 20));
      return 'survived_cleanly';
    });

    await failingTask;
    const subResult = await subsequentTask;

    expect(failedCaught).toBe(true);
    expect(subResult).toBe('survived_cleanly');
    expect(getActiveQueueCount()).toBe(0);
  });

});
