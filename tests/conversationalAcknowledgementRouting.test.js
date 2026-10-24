'use strict';

const { processTurn } = require('../src/core/orchestrator');

describe('Conversational Acknowledgement & Greeting Separation', () => {
  jest.setTimeout(25000);

  test('recognizes "makasih" as CONVERSATIONAL_ACKNOWLEDGEMENT and responds naturally without retrieval', async () => {
    const res = await processTurn('test_ack_1_' + Date.now(), 'Makasih banyak infonya ya min, sangat membantu!');
    expect(res.finalAnswer).toBeDefined();
    expect(res.semanticFrame?.intent).toBe('CONVERSATIONAL_ACKNOWLEDGEMENT');
    expect(res.semanticFrame?.retrievalRequired).toBe(false);
    expect(res.subQueryResults?.[0]?.candidatesCount).toBe(0);
    expect(res.finalAnswer).toMatch(/(?:Sama-sama|Senang bisa membantu|You're very welcome)/i);
    expect(res.finalAnswer).not.toMatch(/Selamat datang di layanan informasi resmi/i);
  });

  test('recognizes single-word "makasih" without triggering retrieval', async () => {
    const res = await processTurn('test_ack_2_' + Date.now(), 'makasih');
    expect(res.finalAnswer).toBeDefined();
    expect(res.semanticFrame?.intent).toBe('CONVERSATIONAL_ACKNOWLEDGEMENT');
    expect(res.semanticFrame?.retrievalRequired).toBe(false);
    expect(res.subQueryResults?.[0]?.candidatesCount).toBe(0);
    expect(res.finalAnswer).toMatch(/(?:Sama-sama|Senang bisa membantu)/i);
  });

  test('recognizes pure greeting "Halo min, selamat pagi!" as CONVERSATIONAL_GREETING', async () => {
    const res = await processTurn('test_greet_1_' + Date.now(), 'Halo min, selamat pagi!');
    expect(res.finalAnswer).toBeDefined();
    expect(res.semanticFrame?.intent).toBe('CONVERSATIONAL_GREETING');
    expect(res.semanticFrame?.retrievalRequired).toBe(false);
    expect(res.finalAnswer).toMatch(/Selamat datang di layanan informasi resmi/i);
  });

  test('preserves factual retrieval when greeting accompanies a factual query', async () => {
    const res = await processTurn('test_compound_1_' + Date.now(), 'Halo min, mau tanya biaya pendaftaran PMB berapa ya?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.semanticFrame?.intent).not.toBe('CONVERSATIONAL_GREETING');
    expect(res.semanticFrame?.intent).not.toBe('CONVERSATIONAL_ACKNOWLEDGEMENT');
    expect(res.finalAnswer).toMatch(/500\.000|300\.000/);
  });
});
