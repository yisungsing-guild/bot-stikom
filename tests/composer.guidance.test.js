const composer = require('../src/engine/composer');

describe('Composer guidance and strategy', () => {
  test('detectKnowledgeTopics finds multiple topics', () => {
    const text = 'Saya tidak kuat matematika tapi tertarik marketing, sering merasa takut dan cemas.';
    const topics = composer.detectKnowledgeTopics(text, []);
    expect(Array.isArray(topics)).toBe(true);
    expect(topics).toEqual(expect.arrayContaining(['matematika', 'marketing', 'student anxiety']));
  });

  test('getGuidanceText returns text', () => {
    const g = composer.getGuidanceText(['student anxiety']);
    expect(typeof g).toBe('string');
    expect(g.length).toBeGreaterThan(20);
  });

  test('generateStrategy fallback heuristic works', async () => {
    const res = await composer.generateStrategy({
      emotionalDirection: 'concerned',
      uncertainty: 0.8,
      userQuery: 'Saya takut matematika tapi suka marketing',
      sessionSignals: {},
      conversationSignals: { needsReassurance: true, needsClarification: false, needsRecommend: true },
      recentMessages: [],
      knowledgeTopics: ['matematika', 'marketing', 'student anxiety']
    });
    expect(res).toBeDefined();
    expect(Array.isArray(res.strategy)).toBe(true);
    expect(res.strategy.length).toBeGreaterThan(0);
  });
});
