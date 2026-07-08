jest.mock('axios', () => ({
  get: jest.fn()
}));

jest.mock('../src/engine/webIngest', () => {
  const { URL } = require('url');
  return {
    normalizeUrl: jest.fn((u) => new URL(String(u))),
    htmlToText: jest.fn(() => {
      // Simulate nav/menu text that often contains faculty list items.
      return [
        'Akademik',
        'Program Pascasarjana Magister Komputer (S2)',
        'Fakultas Informatika dan Komputer',
        'Fakultas Bisnis dan Vokasi',
        'Penelitian dan Pengabdian Masyarakat',
        'Info Akademik'
      ].join('\n');
    }),
    parseContentSignal: jest.fn((robots) => ({ raw: robots, map: { search: 'yes' } })),
    extractTitle: jest.fn(() => 'Seed')
  };
});

const { webSearchFallbackAnswer } = require('../src/engine/webSearchFallback');
const axios = require('axios');
const webIngest = require('../src/engine/webIngest');

describe('webSearchFallbackAnswer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENABLE_WEB_SEARCH_FALLBACK = 'true';
    process.env.WEB_SEARCH_SEED_URL = 'https://www.stikom-bali.ac.id/id/';
    process.env.WEB_SEARCH_ALLOWLIST = 'www.stikom-bali.ac.id';
    delete process.env.WEB_SEARCH_ALLOW_IF_MISSING_SIGNAL;

    axios.get.mockImplementation(async (url) => {
      const u = String(url || '');
      if (/\/robots\.txt$/i.test(u)) {
        return { status: 200, data: 'User-agent: *\nContent-Signal: search=yes\nAllow: /\n', headers: {} };
      }
      return { status: 200, data: '<html>dummy</html>', headers: {} };
    });
  });

  test('academics: fallback returns the standard unavailable message instead of quoted web snippets', async () => {
    const r = await webSearchFallbackAnswer('fakultas apa saja yang ada di stikom?');

    expect(r.ok).toBe(true);
    expect(r.intent).toBe('academics');
    expect(r.answer).toContain('Maaf, data yang Anda minta tidak tersedia pada sumber yang kami miliki.');
    expect(r.answer).toContain('[ Hubungi Admin ]');
    expect(r.answer).toContain('Agar saya bisa membantu lebih baik, coba tuliskan pertanyaan dengan lebih spesifik.');
    expect(r.answer).not.toMatch(/Saya menemukan info berikut|Saya menemukan kutipan berikut|Fakultas Informatika dan Komputer/);

    // Academic intents now return the standard unavailable message directly.
    expect(axios.get).toHaveBeenCalledTimes(0);
  });

  test('location: unanswered queries now return the standard unavailable message', async () => {
    webIngest.htmlToText.mockImplementationOnce(() => {
      return [
        'Kampus Denpasar',
        'Jl. Raya Puputan No. 86 Renon, Denpasar, Bali',
        'Hotline: 08227738999'
      ].join('\n');
    });

    const r = await webSearchFallbackAnswer('kampus stikom bali ada dimana saja ya?');

    expect(r.ok).toBe(true);
    expect(r.intent).toBe('location');
    expect(r.answer).toContain('Maaf, data yang Anda minta tidak tersedia pada sumber yang kami miliki.');
    expect(r.answer).toContain('[ Hubungi Admin ]');
    expect(r.answer).toContain('Agar saya bisa membantu lebih baik, coba tuliskan pertanyaan dengan lebih spesifik.');
    expect(r.answer).not.toMatch(/Jl\.\?\s+Raya\s+Puputan/i);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
