const { deriveConclusionSentence, detectIntentFromAnswer } = require('../src/utils/whatsappFormatter');

describe('deriveConclusionSentence - special cases', () => {
  test('akreditasi: extracts institution and grade', () => {
    const ans = 'STIKOM Bali terakreditasi B untuk institusi dan beberapa program studi memiliki akreditasi B atau A sesuai SK terbaru.';
    const c = deriveConclusionSentence(ans, null, 'akreditasi');
    expect(c).toMatch(/terakreditasi\s+B|terakreditasi B/i);
    expect(c).not.toMatch(/berlokasi di memiliki akreditasi/i);
  });

  test('cara daftar: normalizes bullets into sentence', () => {
    const ans = '* Isi formulir online\n* Unggah dokumen (ijazah, KTP)\n* Bayar biaya pendaftaran\n* Ikuti seleksi dan pengumuman';
    const c = deriveConclusionSentence(ans, null, 'pendaftaran');
    expect(c).toMatch(/Pendaftaran dilakukan dengan/i);
    expect(c).not.toMatch(/\*/);
  });

  test('jadwal pendaftaran: summarizes schedule not steps', () => {
    const ans = 'Pendaftaran dibuka setiap gelombang: Gelombang 1 (Januari), Gelombang 2 (Mei), Gelombang 3 (September); deadline dan persyaratan tiap gelombang tercantum di situs.';
    const intent = detectIntentFromAnswer(ans, '');
    expect(intent).toBe('jadwal_pendaftaran');
    const c = deriveConclusionSentence(ans, null, intent);
    expect(c).toMatch(/dibuka setiap gelombang|Gelombang 1|Gelombang 2/i);
    expect(c).not.toMatch(/langkah pendaftarannya/i);
  });

  test('beasiswa: summarize as general insight', () => {
    const ans = 'Beasiswa prestasi, beasiswa kurang mampu, dan beasiswa mitra industri tersedia dengan persyaratan berbeda.';
    const c = deriveConclusionSentence(ans, null, 'beasiswa');
    expect(c).toMatch(/beasiswa/i);
    expect(c).not.toMatch(/prestasi|kurang mampu|mitra industri/i); // should not verbatim list
  });
});
