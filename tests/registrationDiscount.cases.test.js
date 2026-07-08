const { parseFeeStructure } = require('../src/engine/ragEngine');

describe('registrationDiscount additional cases', () => {
  test('CASE A: explicit registration discount only', () => {
    const chunkA = {
      id: 'caseA-1',
      chunk: 'Rp 2.000.000 jika registrasi pada Gelombang I',
      filename: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      trainingId: 'training-1',
      updatedAt: new Date().toISOString(),
      embedding: Array(64).fill(0)
    };
    const feeStruct = parseFeeStructure([chunkA], { intent: 'COST', program: 'TI', wave: '1A', waveGroup: '1' });
    expect(feeStruct).toBeTruthy();
    expect(feeStruct.registrationDiscount).toBe('Rp 2.000.000');
    expect(feeStruct.fieldSources).toBeDefined();
    expect(feeStruct.fieldSources.registrationDiscount).toBeDefined();
    expect(feeStruct.fieldSources.registrationDiscount.id).toContain('caseA-1');
    expect(feeStruct.dpp).toBeNull();
  });

  test('CASE B: DPP only should not be registrationDiscount', () => {
    const chunkB = {
      id: 'caseB-1',
      chunk: 'DPP sebesar Rp 4.500.000',
      filename: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      trainingId: 'training-1',
      updatedAt: new Date().toISOString(),
      embedding: Array(64).fill(0)
    };
    const feeStruct = parseFeeStructure([chunkB], { intent: 'COST', program: 'TI' });
    expect(feeStruct).toBeTruthy();
    expect(feeStruct.dpp).toBe('Rp 4.500.000');
    expect(feeStruct.registrationDiscount).toBeNull();
    expect(feeStruct.fieldSources).toBeDefined();
    expect(feeStruct.fieldSources.dpp).toBeDefined();
    expect(feeStruct.fieldSources.dpp.id).toContain('caseB-1');
  });

  test('CASE C: both registration and DPP present', () => {
    const chunkA = {
      id: 'caseC-reg',
      chunk: 'Rp 2.000.000 jika registrasi pada Gelombang I',
      filename: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      trainingId: 'training-1',
      updatedAt: new Date().toISOString(),
      embedding: Array(64).fill(0)
    };
    const chunkB = {
      id: 'caseC-dpp',
      chunk: 'DPP sebesar Rp 4.500.000',
      filename: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      trainingId: 'training-1',
      updatedAt: new Date().toISOString(),
      embedding: Array(64).fill(0)
    };
    // mixed order
    const feeStruct = parseFeeStructure([chunkB, chunkA], { intent: 'COST', program: 'TI', wave: '1A', waveGroup: '1' });
    expect(feeStruct).toBeTruthy();
    expect(feeStruct.registrationDiscount).toBe('Rp 2.000.000');
    expect(feeStruct.dpp).toBe('Rp 4.500.000');
    expect(feeStruct.fieldSources).toBeDefined();
    expect(feeStruct.fieldSources.registrationDiscount).toBeDefined();
    expect(feeStruct.fieldSources.dpp).toBeDefined();
    expect(feeStruct.fieldSources.registrationDiscount.id).toContain('caseC-reg');
    expect(feeStruct.fieldSources.dpp.id).toContain('caseC-dpp');
  });
});
