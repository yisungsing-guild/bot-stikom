const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200, data: { ok: true } })
}));

describe('Fonnte webhook', () => {
  let axios;
  let fonnteWebhookRouter;
  let app;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env.INTERNAL_PROVIDER_HOST = '127.0.0.1';
    process.env.PORT = '4000';
    process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN = 'false';

    axios = require('axios');
    fonnteWebhookRouter = require('../src/routes/fonnteWebhook');

    app = express();
    app.use(express.json());
    app.use('/fonnte', fonnteWebhookRouter);
  });

  test('forwards sender and message to provider webhook', async () => {
    const payload = {
      sender: '6281234567890',
      message: 'Halo bot',
      id: 'fonnte-001',
      timestamp: '1710000000'
    };

    const res = await request(app)
      .post('/fonnte/webhook')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe('http://127.0.0.1:4000/provider/webhook');
    expect(axios.post.mock.calls[0][1]).toEqual(expect.objectContaining({
      chatId: '6281234567890',
      text: 'Halo bot',
      messageId: 'fonnte-001',
      fonnteMessageId: 'fonnte-001',
      source: 'fonnte'
    }));
  });
});