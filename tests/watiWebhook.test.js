const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200, data: { ok: true } })
}));

jest.mock('../src/db', () => ({
  setting: {
    upsert: jest.fn().mockResolvedValue({})
  }
}));

describe('WATI webhook', () => {
  let axios;
  let watiWebhookRouter;
  let app;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env.WATI_WEBHOOK_MODE = 'forward';
    process.env.INTERNAL_PROVIDER_HOST = '127.0.0.1';
    process.env.PORT = '4000';

    axios = require('axios');
    watiWebhookRouter = require('../src/routes/watiWebhook');

    app = express();
    app.use(express.json());
    app.use('/wati', watiWebhookRouter);
  });

  test('extracts nested WATI payload fields and forwards them to provider webhook', async () => {
    const payload = {
      key: { remoteJid: '6281234567890@s.whatsapp.net', id: 'wamid.TEST123' },
      messageTimestamp: '1710000000',
      pushName: 'Test User',
      message: {
        conversation: 'Halo bot'
      },
      whatsapp_number: '',
      event: 'message'
    };

    const res = await request(app)
      .post('/wati/webhook')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe('http://127.0.0.1:4000/provider/webhook');
    expect(axios.post.mock.calls[0][1]).toEqual(expect.objectContaining({
      chatId: '6281234567890',
      text: 'Halo bot',
      messageId: 'wamid.TEST123',
      watiEventId: 'wamid.TEST123'
    }));
  });
});