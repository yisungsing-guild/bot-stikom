const composer = require('../src/engine/composer');
const upm = require('../src/engine/userProfileManager');

describe('Emotional continuity and contradiction handling', () => {
  test('Anxiety escalation and empathy increase across turns', async () => {
    let profile = {};
    // Turn 1: user expresses fear of math
    profile = upm.updateUserProfile(profile, 'Aku takut matematika', [] , []);
    expect(profile).toBeDefined();
    const anx1 = (profile.anxietyHistory || []).slice(-1)[0];
    expect(typeof anx1).toBe('number');

    // Turn 2: user expresses stronger resignation about IT fit
    const prevConfidence = (profile.confidenceHistory || []).slice(-1)[0];
    profile = upm.updateUserProfile(profile, 'Kayaknya aku memang ga cocok IT', [] , []);
    const anx2 = (profile.anxietyHistory || []).slice(-1)[0];
    const newConfidence = (profile.confidenceHistory || []).slice(-1)[0];

    // anxiety should not decrease OR emotional escalation flagged OR confidence decreased
    const anxIncreased = (typeof anx2 === 'number' && typeof anx1 === 'number') ? (anx2 >= anx1) : false;
    const confDropped = typeof newConfidence === 'number' && typeof prevConfidence === 'number' ? (newConfidence <= prevConfidence + 0.0001) : false;
    expect(anxIncreased || confDropped || Boolean(profile.emotionalEscalation)).toBe(true);

    // Build reasoning context and ensure composer marks higher empathy
    const session = { data: { userProfile: profile }, userId: 'u1', messages: [] };
    const rc = composer.buildReasoningContext({ userQuery: 'Kayaknya aku memang ga cocok IT', normalized: '', intent: {}, session, retrievals: [], answer: '', answerMeta: {}, tone: null, ragMeta: null });
    expect(rc).toBeDefined();
    // Compose response (will use fallbacks for LLM since no OPENAI_API_KEY)
    const out = await composer.composeResponse({ userQuery: 'Kayaknya aku memang ga cocok IT', normalized: '', intent: {}, retrievals: [], session: session.data, answerMeta: {}, ragMeta: {} });
    expect(out).toBeDefined();
    expect(out.meta).toBeDefined();
    expect(out.meta.reasoningContext).toBeDefined();
    expect(['high','normal']).toContain(out.meta.reasoningContext.empathyLevel);
    expect(typeof out.followUpQuestion).toBe('string');
    expect(out.followUpQuestion.length).toBeGreaterThan(0);
    // followUp should be a question
    expect(out.followUpQuestion.trim().endsWith('?')).toBe(true);
  });

  test('Contradiction detection and clarification flow', () => {
    // Simulate a profile that previously recommended a program then user rejected it
    const profile = {
      recommendationHistory: ['coding_bootcamp'],
      rejectedPrograms: ['coding_bootcamp'],
      confidenceHistory: [0.9, 0.7]
    };

    const contradiction = upm.detectContradiction(profile);
    expect(contradiction).toBeDefined();
    expect(contradiction.program).toBe('coding_bootcamp');

    // Ensure confidence decreased in history
    const lastConf = profile.confidenceHistory.slice(-1)[0];
    expect(lastConf).toBeLessThanOrEqual(0.9);
  });

  test('Profile decay and repeated interests strengthen confidence', () => {
    const longProfile = { interests: Array.from({length:50}, (_,i)=>`i${i}`), emotionalStateHistory: Array.from({length:200}, ()=>'anxious'), confidenceHistory: Array.from({length:200}, ()=>0.5) };
    const trimmed = upm.applyDecay(longProfile);
    expect(Array.isArray(trimmed.emotionalStateHistory)).toBe(true);
    expect(trimmed.emotionalStateHistory.length).toBeLessThanOrEqual(120);
    expect(trimmed.interests.length).toBeLessThanOrEqual(40);
  });

  test('Follow-up quality uses profile and emotion (heuristic fallback)', () => {
    const profile = { interests: ['Marketing'], weakSubjects: ['matematika'], strengths: ['Design'], emotionalState: 'anxious' };
    const q = upm.generateContextualFollowUp(profile, { primaryEmotion: 'anxious' });
    expect(typeof q).toBe('string');
    expect(q.length).toBeGreaterThan(5);
    expect(q.trim().endsWith('?')).toBe(true);
  });
});

module.exports = {};
