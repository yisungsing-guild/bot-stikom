const { WhatsAppBusinessProvider } = require('../src/providers/whatsappBusinessProvider');

describe('Fonnte provider sendMessage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = 'fonnte';
    process.env.WHATSAPP_API_KEY = 'TOKEN_FONNTE';
    process.env.WHATSAPP_API_ENDPOINT = 'https://api.fonnte.com';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: true, id: ['FONNTE123'], requestid: 99 }),
      text: async () => ''
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('uses Fonnte token header and form-encoded payload', async () => {
    const provider = new WhatsAppBusinessProvider('TOKEN_FONNTE', 'ignored', null);

    const result = await provider.sendMessage('08123456789', 'Halo Fonnte');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      provider: 'fonnte'
    }));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toBe('https://api.fonnte.com/send');
    expect(options.headers.Authorization).toBe('TOKEN_FONNTE');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(String(options.body)).toContain('target=628123456789');
    expect(String(options.body)).toContain('message=Halo+Fonnte');
  });
});