const { tryDetailedFeeAnswer } = require('../src/engine/feeComparisonEngine');

describe('payment timing evidence', () => {
  const index = [{ filename: 'Biaya Bisnis Digital.pdf', chunk: [
    'Bisnis Digital',
    '1. Pendaftaran 500.000 Pada Saat Daftar',
    '2. Dana Pendidikan Pokok 14.000.000 Dicicil Per Bln s.d UTS-1',
    '5. Biaya Pendidikan Per Semester 6.500.000 Menjelang Perwalian Kecuali',
    'Reg 1 Dicicil 2 Kali s/d UTS'
  ].join('\n') }];
  const options = { __canonicalQueryUnderstanding: { constraints: { feeType: 'installment' } } };

  test('uses source timing and preserves the registration exception', () => {
    const result = tryDetailedFeeAnswer('cicilan Bisnis Digital bagaimana?', index, options);
    expect(result.source).toBe('semantic-rag-fee-installment');
    expect(result.answer).toMatch(/DPP Rp\. 14\.000\.000: Dicicil per bulan/);
    expect(result.answer).toMatch(/Menjelang Perwalian Kecuali Reg 1 Dicicil 2 Kali/);
    expect(result.answer).not.toMatch(/7\.000\.000|3\.250\.000/);
    expect(result.contexts[0].text).toBe(index[0].chunk);
  });

  test('does not treat payment timing as application requirements', () => {
    const result = tryDetailedFeeAnswer('syarat pengajuan cicilan Bisnis Digital?', index, options);
    expect(result?.source).not.toBe('semantic-rag-fee-installment');
  });

  test('does not invent installment evidence from fallback fee amounts', () => {
    const result = tryDetailedFeeAnswer('cicilan Bisnis Digital bagaimana?', [], options);
    expect(result?.source).not.toBe('semantic-rag-fee-installment');
  });
});
