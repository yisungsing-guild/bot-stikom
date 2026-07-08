const { sanitizeWhatsappText } = require('../src/utils/textSanitizer');

describe('sanitizeWhatsappText - meta source guardrail', () => {
  const prevStrip = process.env.WHATSAPP_STRIP_META_SOURCES;
  const prevMarkdown = process.env.WHATSAPP_STRIP_MARKDOWN;
  const prevMaxBold = process.env.WHATSAPP_MAX_BOLD_PAIRS;

  beforeAll(() => {
    process.env.WHATSAPP_STRIP_MARKDOWN = 'true';
    process.env.WHATSAPP_STRIP_META_SOURCES = 'true';
    process.env.WHATSAPP_MAX_BOLD_PAIRS = '2';
  });

  afterAll(() => {
    if (typeof prevStrip === 'undefined') delete process.env.WHATSAPP_STRIP_META_SOURCES;
    else process.env.WHATSAPP_STRIP_META_SOURCES = prevStrip;

    if (typeof prevMarkdown === 'undefined') delete process.env.WHATSAPP_STRIP_MARKDOWN;
    else process.env.WHATSAPP_STRIP_MARKDOWN = prevMarkdown;

    if (typeof prevMaxBold === 'undefined') delete process.env.WHATSAPP_MAX_BOLD_PAIRS;
    else process.env.WHATSAPP_MAX_BOLD_PAIRS = prevMaxBold;
  });

  test('strips "berdasarkan dokumen/training data" wording', () => {
    const input = 'Berdasarkan dokumen/training data yang ada, biaya pendaftaran untuk PMB adalah ...';
    const out = sanitizeWhatsappText(input);

    expect(out).not.toMatch(/training\s*data/i);
    expect(out).not.toMatch(/berdasarkan\s+dokumen/i);
    expect(out.toLowerCase()).not.toContain('data latih');
  });

  test('rewrites extraction-sounding prodi intro ("yang terbaca" / "pada konteks")', () => {
    const input = 'Berikut program studi yang terbaca tersedia di ITB STIKOM Bali pada konteks:\n- Sistem Informasi (SI)';
    const out = sanitizeWhatsappText(input);

    expect(out).not.toMatch(/yang\s+terbaca/i);
    expect(out).not.toMatch(/pada\s+konteks/i);
    expect(out).toMatch(/Berikut program studi(\s+yang)?\s+tersedia/i);
  });

  test('rewrites prodi intro "yang tercantum" into "yang tersedia di ITB STIKOM Bali"', () => {
    const input = 'Berikut program studi yang tercantum:\n- Sistem Informasi (SI)';
    const out = sanitizeWhatsappText(input);

    expect(out).toMatch(/Berikut program studi yang tersedia di ITB STIKOM Bali:/i);
    expect(out).not.toMatch(/yang\s+tercantum/i);
  });

  test('strips asterisk-wrapped section headers and adds spacing before list', () => {
    const input = [
      'Berikut program studi yang tersedia di ITB STIKOM Bali:',
      '*S1 (Sarjana):*',
      '- Sistem Informasi (SI)',
      '*D3/Diploma:*',
      '- Manajemen Informatika',
      '*Akreditasi:* akreditasi tidak tercantum.',
      'Mau saya bantu cek juga rincian biaya untuk salah satu program studi di atas?'
    ].join('\n');

    const out = sanitizeWhatsappText(input);

    expect(out).not.toMatch(/\*/);
    expect(out).toMatch(/S1 \(Sarjana\):\n\n- Sistem Informasi/i);
    expect(out).toMatch(/D3\/Diploma:\n\n- Manajemen Informatika/i);
    expect(out).toMatch(/\n\nAkreditasi: tidak tercantum\./i);
    expect(out).toMatch(/\n\nMau saya bantu cek juga rincian biaya/i);
  });

  test('does not remove legitimate "dokumen" when user asks about required documents', () => {
    const input = 'Dokumen yang dibutuhkan apa aja ya min?';
    const out = sanitizeWhatsappText(input);

    expect(out).toMatch(/Dokumen/i);
    expect(out).not.toMatch(/training\s*data/i);
  });

  test('minimizes inline asterisks: strips email emphasis and collapses **bold** to WhatsApp *bold* (limited)', () => {
    process.env.WHATSAPP_MAX_BOLD_PAIRS = '1';

    const input = 'Kontak ITB STIKOM Bali: email *Info@stikom-bali.ac.id* dan opsi **Denpasar/Jimbaran/Abiansemal**.';
    const out = sanitizeWhatsappText(input);

    expect(out).toContain('Info@stikom-bali.ac.id');
    expect(out).not.toMatch(/\*Info@stikom-bali\.ac\.id\*/);
    expect(out).not.toMatch(/\*\*/);
    // At most one bold segment should remain
    const starCount = (out.match(/\*/g) || []).length;
    expect(starCount).toBeLessThanOrEqual(2);
  });
});
