const rag = require('./src/engine/ragEngine');
const chunk = `
        RINCIAN BIAYA PROGRAM TEKNOLOGI INFORMASI GELOMBANG 2C

        Pendaftaran: Rp. 500.000
        DPP (Dana Pendidikan Pokok): Rp. 5.000.000
        UKT Semester 1: Rp. 7.500.000
        Asuransi: Rp. 500.000
        Almamater: Rp. 1.500.000
        Pengalaman Industri: Rp. 2.000.000
      `;
const res = rag.parseFeeStructureFromChunk({ chunk, filename: 'test-fee.txt', id: 'test-chunk' }, { program: 'ti', wave: 'II C' });
console.log('parseFeeStructureFromChunk result:');
console.dir(res, { depth: null });
const topContext = [
  { chunk: 'Pendaftaran TI: Rp. 500.000', filename: 'fee-ti-reg.txt', trainingId: 'ti-regular' },
  { chunk: 'DPP TI Gel 2C: Rp. 5.000.000', filename: 'fee-ti-dpp.txt', trainingId: 'ti-regular' },
  { chunk: 'UKT TI: Rp. 7.500.000', filename: 'fee-ti-ukt.txt', trainingId: 'ti-regular' },
  { chunk: 'Asuransi peserta didik: Rp. 500.000', filename: 'fee-ti-insurance.txt', trainingId: 'ti-regular' }
];
const res2 = rag.tryStructuredFeeBreakdownAnswer('Berapa rincian biaya lengkap TI Gelombang 2C?', topContext);
console.log('tryStructuredFeeBreakdownAnswer result:');
console.dir(res2, { depth: null });
