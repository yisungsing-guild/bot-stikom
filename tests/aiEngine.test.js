jest.mock('openai', () => {
  const createMock = jest.fn().mockResolvedValue({
    choices: [
      {
        message: { content: 'Jawaban generatif yang bagus.' }
      }
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2
    }
  });

  return {
    OpenAI: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: createMock
        }
      }
    })),
    __createMock: createMock
  };
});

describe('AIReplyEngine', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('getRagAnswer rejects raw context string before OpenAI', async () => {
    const { AIReplyEngine } = require('../src/engine/aiEngine');
    const { __createMock } = require('openai');
    const ai = new AIReplyEngine('fake-key', 'gpt-5.2', { timeoutMs: 1000 });

    const result = await ai.getRagAnswer('Berapa biaya pendaftaran?', 'Sumber: daftar biaya 2026', 'SEMI', '');
    expect(result.success).toBe(false);
    expect(result.error).toBe('RAG_SELECTED_EVIDENCE_REQUIRED');
    expect(__createMock).not.toHaveBeenCalled();
  });

  test('getRagAnswer accepts selected evidence and hides model metadata', async () => {
    const { AIReplyEngine } = require('../src/engine/aiEngine');
    const ai = new AIReplyEngine('fake-key', 'gpt-5.2', { timeoutMs: 1000 });
    const result = await ai.getRagAnswer({
      question: 'Berapa biaya pendaftaran?',
      selectedEvidence: [{ text: 'Biaya pendaftaran adalah Rp 500.000.', source: 'fee.pdf', sourceId: 'fee-1', isSelectedEvidence: true }],
      intent: 'COST',
      metadata: { style: 'SEMI', assistHints: '' }
    });

    expect(result.success).toBe(true);
    expect(result.reply).not.toMatch(/CONFIDENCE:\s*HIGH|SOURCE_CHUNKS:/i);
  });

  test('humanizer uses reflective phrasing and avoids generic CTA for scholarship query', () => {
    const { humanizeFinalAnswer } = require('../src/engine/aiEngine');
    const tone = { enableFriendlyTone: true, formalTone: false };
    const result = humanizeFinalAnswer('Ada beasiswa untuk TI.', { question: 'beasiswa ada?', tone });

    expect(result).toMatch(/Kalau (soal|untuk beasiswa|bicara beasiswa)/i);
    expect(result).not.toMatch(/Silakan tanya lagi|Ada yang ingin ditanyakan lagi|Kalau mau saya bantu/i);
  });

  test('humanizer reflects working-student context without robot opening', () => {
    const { humanizeFinalAnswer } = require('../src/engine/aiEngine');
    const tone = { enableFriendlyTone: true, formalTone: false };
    const result = humanizeFinalAnswer('Kelas karyawan biasanya tersedia untuk yang kerja sambil kuliah.', { question: 'kelas malam ada?', tone });

    expect(result).toMatch(/Kalau sambil kerja|Untuk yang bekerja sambil kuliah|Kalau untuk kelas malam|Kalau kamu kerja juga/i);
    expect(result).not.toMatch(/Berikut|Baik kak|Silakan tanya lagi|Ada yang ingin ditanyakan lagi/i);
  });

  test('humanizer favors concise natural phrasing on budget-seeking query', () => {
    const { humanizeFinalAnswer } = require('../src/engine/aiEngine');
    const tone = { enableFriendlyTone: true, formalTone: false };
    const result = humanizeFinalAnswer('Kalau cari yang murah, biasanya kelas karyawan lebih ringan biaya awalnya.', { question: 'yang murah apa', tone });

    expect(result).toMatch(/Kalau cari yang murah|Untuk pilihan yang lebih murah|Kalau fokus ke harga lebih ringan/i);
    expect(result).not.toMatch(/Silakan tanya lagi|Ada yang ingin ditanyakan lagi|Kalau mau saya bantu/i);
  });

  test('progressive answering: beasiswa short informal question returns concise lead', () => {
    const { humanizeFinalAnswer } = require('../src/engine/aiEngine');
    const tone = { enableFriendlyTone: true, formalTone: false };
    const longDump = 'Beasiswa tersedia pada beberapa jalur; detailnya terdiri dari beasiswa prestasi, beasiswa KIP, dan beasiswa kemitraan. Untuk masing-masing jalur ada syarat khusus, dokumen yang perlu disiapkan, serta kuota tertentu tergantung tiap gelombang. Proses seleksi berbeda-beda dan biasanya melibatkan verifikasi berkas dan wawancara. Jika ingin saya rincikan per-jalur, saya bisa sebutkan satu per satu.';
    const result = humanizeFinalAnswer(longDump, { question: 'beasiswa ada?', tone });

    expect(result).toMatch(/Ada kok|beasiswa|jalur beasiswa|Beberapa jalur/i);
    expect(result.length).toBeLessThan(180);
  });

  test('progressive answering: kelas malam short informal question returns concise lead', () => {
    const { humanizeFinalAnswer } = require('../src/engine/aiEngine');
    const tone = { enableFriendlyTone: true, formalTone: false };
    const longDump = 'Kelas malam biasanya tersedia untuk program kelas karyawan dengan pertemuan di akhir pekan atau sore hari. Ada perbedaan kurikulum minor terhadap reguler, dan sistem pembayaran kadang berbeda. Pendaftarannya mengikuti gelombang reguler atau jalur khusus.';
    const result = humanizeFinalAnswer(longDump, { question: 'kelas malam ada?', tone });

    expect(result).toMatch(/kelas karyawan|kelas malam|Ada, biasanya/i);
    expect(result.length).toBeLessThan(160);
  });

  test('concise answer includes semantic topic when programHint is provided', () => {
    const { humanizeFinalAnswer } = require('../src/engine/aiEngine');
    const tone = { enableFriendlyTone: true, formalTone: false };
    const result = humanizeFinalAnswer('Ada, biasanya masuk kelas karyawan/kelas malam di Teknologi Informasi.', {
      question: 'kelas malam ada?',
      tone,
      programHint: 'Teknologi Informasi'
    });

    expect(result).toMatch(/Teknologi Informasi/);
    expect(result).not.toMatch(/Silakan tanya lagi|Ada yang ingin ditanyakan lagi/i);
  });

  test('progressive answering: yang murah apa returns concise comparative lead', () => {
    const { humanizeFinalAnswer } = require('../src/engine/aiEngine');
    const tone = { enableFriendlyTone: true, formalTone: false };
    const longDump = 'Beberapa program memiliki struktur biaya yang berbeda-beda; faktor yang mempengaruhi adalah skema pembiayaan, jalur pendaftaran, dan kebijakan potongan. Untuk perbandingan, program dengan jalur kelas karyawan dan paket pembiayaan seringkali lebih ringan beban awalnya.';
    const result = humanizeFinalAnswer(longDump, { question: 'yang murah apa', tone });

    expect(result).toMatch(/SI|TI|Sistem Informasi|Teknologi Informasi|lebih terjangkau|yang lebih terjangkau/i);
    expect(result.length).toBeLessThan(220);
  });
  test('humanizer keeps recommendation question list as compact bullets', () => {
    const { humanizeFinalAnswer } = require('../src/engine/aiEngine');
    const input = 'Jadi, PMB adalah pintu awal untuk calon mahasiswa baru.\n\nKalau mau lanjut, kakak bisa tanya:\n\n- Gelombang pendaftaran sekarang apa?\n- Rincian biaya SI gelombang 2B? - Syarat pendaftaran apa saja?';
    const result = humanizeFinalAnswer(input, { question: 'saya ingin tau tentang pmb', tone: {} });

    expect(result).toContain('Kalau mau lanjut, kakak bisa tanya:\n- Gelombang pendaftaran sekarang apa?\n- Rincian biaya SI gelombang 2B?\n- Syarat pendaftaran apa saja?');
    expect(result).not.toMatch(/Kalau mau lanjut[^\n]*:\s*\n\s*\n/i);
    expect(result).not.toMatch(/\?[ \t]+-\s/);
  });
});



