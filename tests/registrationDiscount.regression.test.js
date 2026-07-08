const { parseFeeStructure } = require('../src/engine/ragEngine');

describe('registrationDiscount regression test', () => {
  test('prefers explicit discount line over larger generic registration amount for wave 1A', () => {
    const genericChunk = {
      id: 'generic-reg-1',
      chunk: 'Rp. 2.000.000,- Jika Registrasi pada Gelombang I',
      filename: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      trainingId: 'training-1',
      updatedAt: new Date().toISOString(),
      embedding: Array(64).fill(0)
    };

    const discountChunk = {
      id: 'discount-reg-1',
      chunk: 'Potongan Biaya Pendaftaran:\nRp. 250.000,- Jika Mendaftar pada Gelombang I',
      filename: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      trainingId: 'training-1',
      updatedAt: new Date().toISOString(),
      embedding: Array(64).fill(0)
    };

    const feeStruct = parseFeeStructure([genericChunk, discountChunk], { intent: 'COST', program: 'SI', wave: '1A', waveGroup: '1' });
    expect(feeStruct).toBeTruthy();
    expect(feeStruct.registrationDiscount).toBe('Rp 250.000');
    expect(feeStruct.fieldSources.registrationDiscount.id).toContain('discount-reg-1');
  });

  test('explicit schedule chunk wins over DPP chunk for registrationDiscount', () => {
    const chunkA = {
      id: '9fb44de0-a82a-44ba-bd55-086c72243698',
      chunk: 'Rp. 2.000.000,- Jika Registrasi pada Gelombang I',
      filename: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      trainingId: 'training-1',
      updatedAt: new Date().toISOString(),
      embedding: Array(64).fill(0)
    };

    const chunkB = {
      id: '0e2f1b54-9317-49c3-a4b8-9adc9e3f596e',
      chunk: 'a. Dana Pendidikan Pokok (DPP)\n- Jumlah pengakuan SKS antara 85 s/d 100 SKS dikenakan biaya DPP\nsebesar Rp. 4.500.000\n- Jumlah pengakuan SKS antara 44 s/d 84 SKS dikenakan biaya DPP\nsebesar Rp. 5.000.000\n- Jumlah pengakuan SKS antara 20 s/d 43 SKS dikenakan biaya DPP\nsebesar Rp. 7.000.000',
      filename: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      trainingId: 'training-1',
      updatedAt: new Date().toISOString(),
      embedding: Array(64).fill(0)
    };

    const queryEntities = { intent: 'COST', program: 'TI', wave: '1A', waveGroup: '1' };

    // note: order intentionally mixed to ensure parser finds explicit schedule
    const feeStruct = parseFeeStructure([chunkB, chunkA], queryEntities);
    expect(feeStruct).toBeTruthy();
    // registrationDiscount must be from chunkA (explicit schedule)
    expect(feeStruct.registrationDiscount).toBe('Rp 2.000.000');
    expect(feeStruct.fieldSources).toBeDefined();
    expect(feeStruct.fieldSources.registrationDiscount).toBeDefined();
    expect(feeStruct.fieldSources.registrationDiscount.id || feeStruct.fieldSources.registrationDiscount).toEqual(expect.stringContaining('9fb44de0-a82a-44ba-bd55-086c72243698'));
    // dpp should be taken from chunkB (largest DPP value present)
    expect(feeStruct.dpp).toBe('Rp 7.000.000');

    // Ensure registrationDiscount was not taken from DPP-like context
    const disallowedCtx = /\b(dpp|dana\s+pendidikan|pengakuan\s+sks|jumlah\s+sks|ukt|biaya\s+kuliah)\b/i;
    // check source chunk text does not contain disallowed context
    const regSrc = feeStruct.fieldSources.registrationDiscount;
    let regSrcChunkText = null;
    if (regSrc && regSrc.id) {
      // try to find the matching chunk object in the input
      const src = [chunkA, chunkB].find(c => c.id === regSrc.id);
      regSrcChunkText = src ? src.chunk : null;
    } else if (typeof regSrc === 'string') {
      // sometimes fieldSources.registrationDiscount may be the id string
      const src = [chunkA, chunkB].find(c => c.id === regSrc);
      regSrcChunkText = src ? src.chunk : null;
    }
    expect(regSrcChunkText).toBeTruthy();
    expect(disallowedCtx.test(regSrcChunkText)).toBe(false);
  });
});
