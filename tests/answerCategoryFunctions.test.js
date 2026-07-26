const {
  detectAnswerCategory,
  formatAnswerByCategory,
  buildSpecificInsufficientDataAnswer
} = require('../src/engine/semanticRagEngine');

describe('answer category functions', () => {
  describe('detectAnswerCategory', () => {
    test('detects insufficient_data answers', () => {
      expect(detectAnswerCategory('tidak cukup data untuk menjawab', 'test')).toBe('insufficient_data');
      expect(detectAnswerCategory('maaf, saya belum memiliki informasi', 'test')).toBe('insufficient_data');
    });

    test('detects fee_related answers', () => {
      expect(detectAnswerCategory('Biaya kuliah adalah Rp 500.000', 'test')).toBe('fee_related');
      expect(detectAnswerCategory('Harga UKT per semester', 'test')).toBe('fee_related');
      expect(detectAnswerCategory('Tarif DPP untuk prodi tersebut', 'test')).toBe('fee_related');
    });

    test('detects program_related answers', () => {
      expect(detectAnswerCategory('Program Studi Sistem Informasi', 'test')).toBe('program_related');
      expect(detectAnswerCategory('Prodi Teknologi Informasi', 'test')).toBe('program_related');
      expect(detectAnswerCategory('Jurusan yang tersedia', 'test')).toBe('program_related');
    });

    test('detects schedule_related answers', () => {
      expect(detectAnswerCategory('Jadwal pendaftaran gelombang 1', 'test')).toBe('schedule_related');
      expect(detectAnswerCategory('Tanggal deadline pendaftaran', 'test')).toBe('schedule_related');
    });

    test('detects requirement_related answers', () => {
      expect(detectAnswerCategory('Syarat pendaftaran meliputi', 'test')).toBe('requirement_related');
      expect(detectAnswerCategory('Dokumen yang diperlukan', 'test')).toBe('requirement_related');
    });

    test('defaults to general for uncategorized answers', () => {
      expect(detectAnswerCategory('Halo, apa kabar?', 'test')).toBe('general');
      expect(detectAnswerCategory('Terima kasih atas informasinya', 'test')).toBe('general');
    });
  });

  describe('formatAnswerByCategory', () => {
    test('preserves insufficient_data answers that already have polite prefix', () => {
      const answer = 'Mohon maaf, saya belum memiliki data tersebut';
      expect(formatAnswerByCategory(answer, 'insufficient_data')).toBe(answer);
      
      const answer2 = 'Maaf, informasi tidak tersedia';
      expect(formatAnswerByCategory(answer2, 'insufficient_data')).toBe(answer2);
    });

    test('adds polite prefix to insufficient_data answers without it', () => {
      const answer = 'saya belum memiliki data tersebut';
      const formatted = formatAnswerByCategory(answer, 'insufficient_data');
      expect(formatted).toBe('Mohon maaf, saya belum memiliki data tersebut');
    });

    test('returns fee_related answers unchanged', () => {
      const answer = 'Biaya pendaftaran adalah Rp 500.000';
      expect(formatAnswerByCategory(answer, 'fee_related')).toBe(answer);
    });

    test('returns program_related answers unchanged', () => {
      const answer = 'Program Studi Sistem Informasi tersedia';
      expect(formatAnswerByCategory(answer, 'program_related')).toBe(answer);
    });

    test('returns schedule_related answers unchanged', () => {
      const answer = 'Jadwal pendaftaran dimulai tanggal 1 Juli';
      expect(formatAnswerByCategory(answer, 'schedule_related')).toBe(answer);
    });

    test('returns requirement_related answers unchanged', () => {
      const answer = 'Syarat pendaftaran meliputi ijazah dan KTP';
      expect(formatAnswerByCategory(answer, 'requirement_related')).toBe(answer);
    });

    test('returns general answers unchanged', () => {
      const answer = 'Halo, apa yang bisa saya bantu?';
      expect(formatAnswerByCategory(answer, 'general')).toBe(answer);
    });

    test('handles unknown categories by returning answer unchanged', () => {
      const answer = 'Some answer';
      expect(formatAnswerByCategory(answer, 'unknown_category')).toBe(answer);
    });
  });

  describe('buildSpecificInsufficientDataAnswer', () => {
    test('returns specific message for fee_amount missing evidence', () => {
      const answer = buildSpecificInsufficientDataAnswer('test', ['fee_amount']);
      expect(answer).toContain('biaya');
      expect(answer).toContain('admin PMB');
    });

    test('returns specific message for date_or_period missing evidence', () => {
      const answer = buildSpecificInsufficientDataAnswer('test', ['date_or_period']);
      expect(answer).toContain('jadwal');
      expect(answer).toContain('tanggal');
    });

    test('returns specific message for concrete_requirements missing evidence', () => {
      const answer = buildSpecificInsufficientDataAnswer('test', ['concrete_requirements']);
      expect(answer).toContain('syarat');
      expect(answer).toContain('dokumen');
      expect(answer).toContain('https://siap.stikom-bali.ac.id');
    });

    test('returns specific message for multiple_concrete_items missing evidence', () => {
      const answer = buildSpecificInsufficientDataAnswer('test', ['multiple_concrete_items']);
      expect(answer).toContain('daftar lengkap');
    });

    test('returns generic message for unknown missing evidence', () => {
      const answer = buildSpecificInsufficientDataAnswer('test', ['unknown_type']);
      expect(answer).toContain('tidak mempunyai jawaban yang mencukupi');
    });

    test('returns generic message for empty missing evidence array', () => {
      const answer = buildSpecificInsufficientDataAnswer('test', []);
      expect(answer).toContain('tidak mempunyai jawaban yang mencukupi');
    });

    test('handles multiple missing evidence types (uses first match)', () => {
      const answer = buildSpecificInsufficientDataAnswer('test', ['fee_amount', 'date_or_period']);
      expect(answer).toContain('biaya');
    });
  });
});
