const { decomposeSemanticRequests, isComparisonQuery } = require('../src/engine/requestDecomposer');

describe('Request Decomposer Unit Tests', () => {
  describe('Original 10 Multi-Query Cases', () => {
    test('MQ01: Akreditasi Teknologi Informasi apa dan biaya kuliahnya berapa?', () => {
      const res = decomposeSemanticRequests('Akreditasi Teknologi Informasi apa dan biaya kuliahnya berapa?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toBe('Akreditasi Teknologi Informasi apa');
      expect(res.requests[0].explicitEntities.some(e => e.canonical.includes('Teknologi Informasi'))).toBe(true);
      expect(res.requests[1].text).toBe('biaya kuliahnya berapa?');
      expect(res.requests[1].inheritedLocalAnchors.some(e => e.canonical.includes('Teknologi Informasi'))).toBe(true);
    });

    test('MQ02: Akreditasi Sistem Informasi apa dan biaya kuliah Bisnis Digital berapa?', () => {
      const res = decomposeSemanticRequests('Akreditasi Sistem Informasi apa dan biaya kuliah Bisnis Digital berapa?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].explicitEntities.some(e => e.canonical.includes('Sistem Informasi'))).toBe(true);
      expect(res.requests[1].explicitEntities.some(e => e.canonical.includes('Bisnis Digital'))).toBe(true);
      // Explicit Bisnis Digital overrides and prevents inheriting SI
      expect(res.requests[1].inheritedLocalAnchors.length).toBe(0);
    });

    test('MQ03: Apakah ada lab komputer? Berapa biaya pendaftarannya?', () => {
      const res = decomposeSemanticRequests('Apakah ada lab komputer? Berapa biaya pendaftarannya?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toBe('Apakah ada lab komputer?');
      expect(res.requests[1].text).toBe('Berapa biaya pendaftarannya?');
    });

    test('MQ04: Biaya pendaftaran berapa dan pembayarannya lewat apa?', () => {
      const res = decomposeSemanticRequests('Biaya pendaftaran berapa dan pembayarannya lewat apa?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toBe('Biaya pendaftaran berapa');
      expect(res.requests[1].text).toBe('pembayaran pendaftaran lewat apa?');
    });

    test('MQ05: Akreditasi Sistem Informasi dan Bisnis Digital masing-masing apa?', () => {
      const res = decomposeSemanticRequests('Akreditasi Sistem Informasi dan Bisnis Digital masing-masing apa?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toContain('Sistem Informasi');
      expect(res.requests[1].text).toContain('Bisnis Digital');
    });

    test('MQ06: Akreditasi TI apa dan berapa kuota pasti mahasiswa baru tahun 2035?', () => {
      const res = decomposeSemanticRequests('Akreditasi TI apa dan berapa kuota pasti mahasiswa baru tahun 2035?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toBe('Akreditasi TI apa');
      expect(res.requests[1].text).toBe('berapa kuota pasti mahasiswa baru tahun 2035?');
    });

    test('MQ07: Biaya pendaftaran berapa dan apakah diskonnya 97 persen untuk pemilik kucing?', () => {
      const res = decomposeSemanticRequests('Biaya pendaftaran berapa dan apakah diskonnya 97 persen untuk pemilik kucing?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toBe('Biaya pendaftaran berapa');
      expect(res.requests[1].text).toBe('apakah diskonnya 97 persen untuk pemilik kucing?');
    });

    test('MQ08: Ada UKM paduan suara tidak dan biaya pendaftarannya berapa?', () => {
      const res = decomposeSemanticRequests('Ada UKM paduan suara tidak dan biaya pendaftarannya berapa?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
    });

    test('MQ09: RPL bisa konversi SKS berapa dan akreditasi Sistem Komputer apa?', () => {
      const res = decomposeSemanticRequests('RPL bisa konversi SKS berapa dan akreditasi Sistem Komputer apa?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
    });

    test('MQ10: Akreditasinya apa dan kalau ikut RPL maksimal SKS yang bisa dikonversi berapa?', () => {
      const res = decomposeSemanticRequests('Akreditasinya apa dan kalau ikut RPL maksimal SKS yang bisa dikonversi berapa?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
    });
  });

  describe('Negative Decomposition Controls', () => {
    test('Negative 1: fasilitas lab dan perpustakaan ada apa saja? (Noun list under single predicate)', () => {
      const res = decomposeSemanticRequests('fasilitas lab dan perpustakaan ada apa saja?');
      expect(res.isCompound).toBe(false);
      expect(res.requests.length).toBe(1);
    });

    test('Negative 2: Sistem Informasi dan Teknologi Informasi bedanya apa? (Comparison)', () => {
      const res = decomposeSemanticRequests('Sistem Informasi dan Teknologi Informasi bedanya apa?');
      expect(res.isCompound).toBe(false);
      expect(res.requests.length).toBe(1);
    });

    test('Negative 3: apa perbedaan kurikulum SI dan TI? (Comparison prefix)', () => {
      const res = decomposeSemanticRequests('apa perbedaan kurikulum SI dan TI?');
      expect(res.isCompound).toBe(false);
      expect(res.requests.length).toBe(1);
    });

    test('Negative 4: biaya DPP dan UKT berapa? (Coupled fee components)', () => {
      const res = decomposeSemanticRequests('biaya DPP dan UKT berapa?');
      expect(res.isCompound).toBe(false);
      expect(res.requests.length).toBe(1);
    });

    test('Negative 5: UKM paduan suara dan olah vokal ada tidak? (Compound noun phrase)', () => {
      const res = decomposeSemanticRequests('UKM paduan suara dan olah vokal ada tidak?');
      expect(res.isCompound).toBe(false);
      expect(res.requests.length).toBe(1);
    });

    test('Negative 6: Yayasan Widya Dharma Shanti dan sejarahnya', () => {
      const res = decomposeSemanticRequests('siapa pendiri Institut Teknologi dan Bisnis STIKOM Bali?');
      expect(res.isCompound).toBe(false);
      expect(res.requests.length).toBe(1);
    });
  });

  describe('Unseen Compound Connectors and Punctuation', () => {
    test('Connector "terus": Biaya pendaftaran berapa terus syaratnya apa saja?', () => {
      const res = decomposeSemanticRequests('Biaya pendaftaran berapa terus syaratnya apa saja?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
    });

    test('Connector "sekalian": Akreditasi TI apa sekalian biaya kuliahnya berapa ya?', () => {
      const res = decomposeSemanticRequests('Akreditasi TI apa sekalian biaya kuliahnya berapa ya?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
    });

    test('Connector "sama": Ada beasiswa apa aja sama pendaftarannya kapan ditutup?', () => {
      const res = decomposeSemanticRequests('Ada beasiswa apa aja sama pendaftarannya kapan ditutup?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
    });

    test('Newline separation', () => {
      const res = decomposeSemanticRequests('Akreditasi Bisnis Digital apa?\nBiaya pendaftarannya berapa?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
    });
  });

  describe('Generic Unsupported-Premise Unseen Cases (A-E)', () => {
    test('Case A: biaya daftar berapa dan ada potongan 83% kalau juara lomba layangan?', () => {
      const res = decomposeSemanticRequests('biaya daftar berapa dan ada potongan 83% kalau juara lomba layangan?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toContain('biaya daftar');
      expect(res.requests[1].text).toContain('potongan 83%');
    });

    test('Case B: akreditasi SI apa dan kuota mahasiswa baru tahun 2042 berapa?', () => {
      const res = decomposeSemanticRequests('akreditasi SI apa dan kuota mahasiswa baru tahun 2042 berapa?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toContain('akreditasi SI');
      expect(res.requests[1].text).toContain('kuota mahasiswa baru');
    });

    test('Case C: biaya TI berapa dan ada bebas UKT kalau punya sertifikat memasak?', () => {
      const res = decomposeSemanticRequests('biaya TI berapa dan ada bebas UKT kalau punya sertifikat memasak?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toContain('biaya TI');
      expect(res.requests[1].text).toContain('bebas UKT');
    });

    test('Case D: ada lab komputer dan jumlah pasti mahasiswa baru semester depan berapa?', () => {
      const res = decomposeSemanticRequests('ada lab komputer dan jumlah pasti mahasiswa baru semester depan berapa?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toContain('lab komputer');
      expect(res.requests[1].text).toContain('jumlah pasti mahasiswa baru');
    });

    test('Case E: akreditasi BD apa dan diskon 61 persen untuk pemegang sertifikat renang?', () => {
      const res = decomposeSemanticRequests('akreditasi BD apa dan diskon 61 persen untuk pemegang sertifikat renang?');
      expect(res.isCompound).toBe(true);
      expect(res.requests.length).toBe(2);
      expect(res.requests[0].text).toContain('akreditasi BD');
      expect(res.requests[1].text).toContain('diskon 61 persen');
    });
  });
});
