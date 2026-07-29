describe('semantic RAG raw document leak complaint guard', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  test('does not answer unrelated topics when user quotes a raw document leak complaint', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const firstQuestion = 'Baik, kalau program inkubator bisnis yang di stikom bali itu, seperti apa ya?';
    const first = await querySemanticRag(firstQuestion);
    const follow = await querySemanticRag('Bagaimana caranya bergabung?', {
      sessionData: {
        messages: [
          { direction: 'user', message: firstQuestion },
          { direction: 'bot', message: first.answer }
        ]
      }
    });

    expect(follow.source).toBe('semantic-rag-campus-support-entity-insufficient-data');
    expect(follow.answer).toMatch(/alur\/cara mengikuti atau mendaftar Inkubator Bisnis|belum menemukan informasi yang lengkap/i);
    expect(follow.answer).not.toMatch(/PROFIL LEMBAGA|Nama Lembaga|Dasar Hukum|siap\.stikom/i);

    const leakedRaw = 'Inkubator Bisnis adalah salah satu program/fasilitas pendukung di ITB STIKOM Bali. Berdasarkan informasi yang tersedia: PROFIL LEMBAGA INKUBATOR BISNIS ITB STIKOM BALI Direktorat Kerja Sama, Layanan Industri, dan Inkubator Bisnis Institut Teknologi dan Bisnis ITB STIKOM Bali Denpasar, Bali 2026 1. Identitas Lembaga Nama Lembaga Inkubator Bisnis ITB STIKOM Bali Lembaga Induk Institut Teknologi dan Bisnis ITB STIKOM Bali Badan Penyelenggara Yayasan Widya Dharma Shanti Tahun Berdiri 2014 Dasar Hukum Surat Keputusan Pendirian Inkubator Bisnis dari Rektor Pembina / Penanggung Jawab Direktorat Kerja Sama, Layanan Industri, dan Inkubator Bisnis Fokus Inkubasi Startup tahap awal.';
    const complaint = await querySemanticRag(`${leakedRaw} Kenapa jadi begini lagi ya?`, {
      sessionData: {
        messages: [
          { direction: 'user', message: firstQuestion },
          { direction: 'bot', message: first.answer },
          { direction: 'user', message: 'Bagaimana caranya bergabung?' },
          { direction: 'bot', message: leakedRaw }
        ]
      }
    });

    expect(complaint.source).toBe('semantic-rag-raw-document-leak-feedback');
    expect(complaint.answer).toMatch(/tidak seharusnya terkirim|dokumen mentah|tidak memakai kutipan dokumen mentah/i);
    expect(complaint.answer).not.toMatch(/Double Degree|HELP University|DNUI|UTB|PROFIL LEMBAGA|Nama Lembaga/i);
  });
  test('guards raw document leak complaints across document types', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const samples = [
      'SURAT KEPUTUSAN REKTOR Nomor SK: 123/SK/2026 Menimbang bahwa perlu menetapkan pengelola program Mengingat Undang-undang Pendidikan Tinggi Memutuskan Pasal 1 Ketentuan Umum Lampiran Keputusan.',
      'FAQ Program X Q: Apa itu Program X? A: Program X adalah layanan kampus. Q: Bagaimana cara daftar? A: Daftar melalui admin. Q: Berapa biayanya? A: Biaya mengikuti ketentuan.',
      '[Sheet: Sheet1] FORM IKU Perguruan Tinggi | Program Studi | Persentase PTS | Jumlah Total | Ya / Tidak | Keterangan data internal.',
      'PROFIL ORGANISASI UNIT TEST 2026 Identitas Organisasi Nama Organisasi Unit Test Tahun Berdiri 2020 Dasar Hukum SK Rektor Struktur Organisasi Ketua Sekretaris Bendahara Susunan Pengurus.'
    ];

    for (const raw of samples) {
      const result = await querySemanticRag(`${raw} Kenapa kok jadi bocor seperti ini?`);
      expect(result.source).toBe('semantic-rag-raw-document-leak-feedback');
      expect(result.answer).toMatch(/dokumen mentah|tidak seharusnya terkirim|tidak memakai kutipan dokumen mentah/i);
      expect(result.answer).not.toMatch(/SURAT KEPUTUSAN|Pasal 1|FAQ Program X|\[Sheet:|PROFIL ORGANISASI|Double Degree/i);
    }
  });
});