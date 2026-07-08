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
