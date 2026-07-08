const rag = require('../src/engine/ragEngine');

function parseCompactRupiahNumber(raw, opts = null) {
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/\s+[0-9]{1,2}\s*[\.)][\s\S]*$/g, '');
  const m = /([0-9][0-9.,\s]{0,40})/.exec(s);
  const token = m && m[1] ? String(m[1]) : '';
  const digits = token.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return null;
  const o = (opts && typeof opts === 'object') ? opts : {};
  const min = Number.isFinite(o.min) ? o.min : 50000;
  const max = Number.isFinite(o.max) ? o.max : 50000000;
  if (n < min || n > max) return null;
  return n;
}

function run() {
  const inputs = ['Rp 1.500.000','Rp1.500.000','1.500.000','l.500.000','I.500.000'];
  console.log('parseCompactRupiahNumber results:');
  for (const s of inputs) {
    console.log(s, '->', parseCompactRupiahNumber(s));
  }

  // Test validateNumericGrounding with the chunk from failing test
  try {
    const validation = rag.validateNumericGrounding('Rp 1.500.000', [{chunk: 'Biaya pendaftaran: Rp 1.500.000', filename: 'RINCIAN_BIAYA.pdf', ocrQualityScore: 0.95}]);
    console.log('\nvalidateNumericGrounding on good chunk ->', validation);
  } catch (e) {
    console.error('ERR validate call', e.message);
  }

  // Reproduce tryStructuredExactCostAnswer cases (#5, #7, #8)
  try {
    console.log('\nCase #5: merge global wave 1 discounts into SK 1A');
    const queryEntities5 = { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' };
    const chunks5 = [
      {
        chunk: 'PROGRAM STUDI SISTEM KOMPUTER TA 2025/2026 Gelombang 1A\nPendaftaran 500.000\nDana Pendidikan Pokok (DPP) 11.000.000',
        filename: 'PMB_2025_SK.pdf', updatedAt: new Date().toISOString(), source: 'upload', embedding: Array(64).fill(0)
      },
      {
        chunk: 'Potongan Biaya Pendaftaran: Rp 200.000, Jika Mendaftar pada Gelombang 1\nPotongan DPP: Rp 1.000.000, Gelombang 1',
        filename: 'PMB_2025_GLOBAL_DISCOUNT.pdf', updatedAt: new Date().toISOString(), source: 'upload', embedding: Array(64).fill(0)
      }
    ];
    const res5 = rag.tryStructuredExactCostAnswer('berapa biaya prodi sk gelombang 1A?', queryEntities5, chunks5, 3, Array(64).fill(0));
    console.log('->', res5 && res5.answer ? 'HAS_ANSWER' : 'NO_ANSWER', res5 && res5.answer ? res5.answer.slice(0,200) : res5);
  } catch (e) { console.error('ERR #5', e.message); }

  try {
    console.log('\nCase #7: OCR noise repair');
    const queryEntities7 = { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' };
    const chunks7 = [{ chunk: 'PROGRAM STUDI SISTEM KOMPUTER TA 2025/2026 Gelombang 1A\nPendaftaran Rp. l.OOO.OOO Pada Saat Daftar', filename: 'PMB_2025_SK.pdf', updatedAt: new Date().toISOString(), source: 'upload', embedding: Array(64).fill(0) }];
    const res7 = rag.tryStructuredExactCostAnswer('berapa biaya pendaftaran prodi sk gelombang 1A?', queryEntities7, chunks7, 3, Array(64).fill(0));
    console.log('->', res7 && res7.answer ? 'HAS_ANSWER' : 'NO_ANSWER', res7 && res7.answer ? res7.answer.slice(0,200) : res7);
  } catch (e) { console.error('ERR #7', e.message); }

  try {
    console.log('\nCase #8: latest academic year prioritization');
    const queryEntities8 = { intent: 'COST', program: 'TI', wave: '2C', waveGroup: '2' };
    const chunks8 = [
      { chunk: 'PROGRAM STUDI TEKNOLOGI INFORMASI TA 2024/2025 Gelombang 2C\nPendaftaran 600.000\nDana Pendidikan Pokok (DPP) 10.500.000', filename: 'PMB_2024_TI.pdf', updatedAt: '2024-10-01T00:00:00.000Z', source: 'upload', embedding: Array(64).fill(0) },
      { chunk: 'PROGRAM STUDI TEKNOLOGI INFORMASI TA 2025/2026 Gelombang 2C\nPendaftaran 650.000\nDana Pendidikan Pokok (DPP) 11.000.000', filename: 'PMB_2025_TI.pdf', updatedAt: '2025-10-01T00:00:00.000Z', source: 'upload', embedding: Array(64).fill(0) }
    ];
    const res8 = rag.tryStructuredExactCostAnswer('berapa biaya prodi ti gelombang 2C?', queryEntities8, chunks8, 3, Array(64).fill(0));
    console.log('->', res8 && res8.answer ? 'HAS_ANSWER' : 'NO_ANSWER', res8 && res8.answer ? res8.answer.slice(0,200) : res8);
  } catch (e) { console.error('ERR #8', e.message); }

}

run();
