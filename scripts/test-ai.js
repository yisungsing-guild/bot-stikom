try {
  const ai = require('../src/engine/aiEngine');
  console.log('Loaded aiEngine exports:', Object.keys(ai));
  const { MockAIReplyEngine } = ai;
  const mock = new MockAIReplyEngine();
  mock.getReply('halo').then(r => console.log('Mock reply:', r.reply));
} catch (err) {
  console.error('Error loading aiEngine:', err);
  process.exit(1);
}
