const rag = require('../src/engine/ragEngine');

test('parses numbered registration line and ignores list number', () => {
  const chunk = {
    id: 't1',
    filename: 'test.pdf',
    chunk: '1. Pendaftaran 500.000',
    trainingId: 'train-1',
    sourceFile: 'test.pdf',
    updatedAt: new Date().toISOString()
  };
  const res = rag.parseFeeStructure([chunk], {});
  expect(res).not.toBeNull();
  const reg = res.registrationFee || res.registrationFee === 0 ? String(res.registrationFee) : null;
  expect(reg).not.toBeNull();
  const digits = parseInt(reg.replace(/\D/g, ''), 10);
  expect(digits).toBe(500000);
});

test('parseFeeStructure small chunk stays below regression budget', () => {
  const chunk = {
    id: 'perf-1',
    filename: 'perf.pdf',
    chunk: 'Biaya pendaftaran Rp 16.000.000. Potongan biaya pendaftaran Rp 2.000.000 jika registrasi pada Gelombang I.',
    trainingId: 'train-perf',
    sourceFile: 'perf.pdf',
    updatedAt: new Date().toISOString()
  };
  const started = Date.now();
  const res = rag.parseFeeStructure([chunk], { intent: 'COST', program: 'TI', wave: '1A', waveGroup: '1' });
  const elapsed = Date.now() - started;
  expect(res).not.toBeNull();
  expect(elapsed).toBeLessThan(1000);
});
