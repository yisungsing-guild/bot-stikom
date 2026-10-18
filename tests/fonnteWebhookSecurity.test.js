'use strict';

/**
 * tests/fonnteWebhookSecurity.test.js
 *
 * PHASE G.4 Webhook Authentication & Security Verification Suite:
 * 1. Missing webhook token returns HTTP 401 Unauthorized
 * 2. Invalid webhook token returns HTTP 401 Unauthorized
 * 3. Valid webhook token via query param (?token=...) returns HTTP 200
 * 4. Valid webhook token via header x-fonnte-token returns HTTP 200
 * 5. Valid webhook token via header x-webhook-token returns HTTP 200
 * 6. Valid webhook token via header Authorization: Bearer <token> returns HTTP 200
 * 7. Timing attack protection: constantTimeEquals handles variable length without throwing
 * 8. Log redaction: redactWebhookUrl masks sensitive query parameters in URLs
 * 9. Admin WhatsApp endpoints mask tokens and redact URLs
 */

const express = require('express');
const request = require('supertest');
const { constantTimeEquals, redactWebhookUrl } = require('../src/routes/fonnteWebhook');

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200, data: { ok: true } })
}));

jest.mock('../src/core/orchestrator', () => ({
  handleInboundMessage: jest.fn().mockResolvedValue({ status: 'handled_by_v2' })
}));

describe('PHASE G.4 — Webhook Security & Remediation', () => {
  const TEST_SECRET_TOKEN = 'secret-fonnte-entropy-token-9876543210';
  let app;
  let orchestrator;

  const samplePayload = {
    sender: '6281234567890',
    message: 'Halo admin kampus',
    id: 'test-msg-security-001'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN = 'true';
    process.env.FONNTE_WEBHOOK_TOKEN = TEST_SECRET_TOKEN;
    process.env.CHAT_ENGINE = 'v2';

    orchestrator = require('../src/core/orchestrator');

    const fonnteWebhookRouter = require('../src/routes/fonnteWebhook');
    app = express();
    app.use(express.json());
    app.use('/fonnte', fonnteWebhookRouter);
  });

  afterEach(() => {
    delete process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN;
    delete process.env.FONNTE_WEBHOOK_TOKEN;
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    delete process.env.WHATSAPP_WEBHOOK_URL;
    delete process.env.APP_URL;
    delete process.env.CHAT_ENGINE;
  });

  test('1. Request without token is rejected with HTTP 401', async () => {
    const res = await request(app)
      .post('/fonnte/webhook')
      .send(samplePayload);

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('Unauthorized');
    expect(orchestrator.handleInboundMessage).not.toHaveBeenCalled();
  });

  test('2. Request with invalid token is rejected with HTTP 401', async () => {
    const res = await request(app)
      .post('/fonnte/webhook?token=wrong-token-abc')
      .send(samplePayload);

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('Unauthorized');
    expect(orchestrator.handleInboundMessage).not.toHaveBeenCalled();
  });

  test('3. Request with valid token in query param is accepted with HTTP 200', async () => {
    const res = await request(app)
      .post(`/fonnte/webhook?token=${TEST_SECRET_TOKEN}`)
      .send(samplePayload);

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(orchestrator.handleInboundMessage).toHaveBeenCalledTimes(1);
  });

  test('4. Request with valid token in x-fonnte-token header is accepted with HTTP 200', async () => {
    const res = await request(app)
      .post('/fonnte/webhook')
      .set('x-fonnte-token', TEST_SECRET_TOKEN)
      .send(samplePayload);

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(orchestrator.handleInboundMessage).toHaveBeenCalledTimes(1);
  });

  test('5. Request with valid token in x-webhook-token header is accepted with HTTP 200', async () => {
    const res = await request(app)
      .post('/fonnte/webhook')
      .set('x-webhook-token', TEST_SECRET_TOKEN)
      .send(samplePayload);

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(orchestrator.handleInboundMessage).toHaveBeenCalledTimes(1);
  });

  test('6. Request with valid token in Authorization Bearer header is accepted with HTTP 200', async () => {
    const res = await request(app)
      .post('/fonnte/webhook')
      .set('Authorization', `Bearer ${TEST_SECRET_TOKEN}`)
      .send(samplePayload);

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(orchestrator.handleInboundMessage).toHaveBeenCalledTimes(1);
  });

  test('7. constantTimeEquals handles timing safely without throwing on length mismatch', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'def')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('', 'abc')).toBe(false);
    expect(constantTimeEquals(null, 'abc')).toBe(false);
    expect(constantTimeEquals(undefined, undefined)).toBe(false);
  });

  test('8. redactWebhookUrl masks query parameters with secret names', () => {
    const rawUrl = 'https://my-app.up.railway.app/fonnte/webhook?token=my-secret-token-12345&foo=bar';
    const redacted = redactWebhookUrl(rawUrl);
    expect(redacted).not.toContain('my-secret-token-12345');
    expect(redacted).toContain('token=<redacted>');
    expect(redacted).toContain('foo=bar');
  });

  test('9. Admin WhatsApp endpoints mask tokens and redact URLs', async () => {
    const adminRouterFactory = require('../src/routes/admin');
    const adminRouter = adminRouterFactory();
    const adminApp = express();
    adminApp.use((req, res, next) => {
      req.user = { role: 'superadmin' };
      next();
    });
    adminApp.use('/admin', adminRouter);

    process.env.FONNTE_WEBHOOK_TOKEN = 'secret-production-token-9999';
    process.env.APP_URL = 'https://production-bot.up.railway.app';
    process.env.WHATSAPP_WEBHOOK_URL = 'https://production-bot.up.railway.app/fonnte/webhook?token=secret-production-token-9999';
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'secret-production-token-9999';

    const resConfig = await request(adminApp).get('/admin/whatsapp/config');
    expect(resConfig.status).toBe(200);
    expect(resConfig.body.webhookUrl).not.toContain('secret-production-token-9999');
    expect(resConfig.body.webhookUrl).toContain('<redacted>');

    const resSetup = await request(adminApp).get('/admin/whatsapp/webhook-setup');
    expect(resSetup.status).toBe(200);
    expect(resSetup.body.currentConfig.suggestedWebhookUrl).not.toContain('secret-production-token-9999');
    expect(resSetup.body.currentConfig.suggestedWebhookUrl).toContain('***9999');
  }, 15000);

  test('10. Insecure placeholder tokens are rejected fail-closed in production', async () => {
    process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN = 'true';
    process.env.FONNTE_WEBHOOK_TOKEN = 'your_verify_token_here'; // default placeholder

    const res = await request(app)
      .post('/fonnte/webhook?token=your_verify_token_here')
      .send(samplePayload);

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('insecure placeholder');
    expect(orchestrator.handleInboundMessage).not.toHaveBeenCalled();
  });

  test('11. Multi-token transitional rotation allows both new and old tokens without downtime', async () => {
    const OLD_TOKEN = 'old-secret-token-rotation-11111111';
    const NEW_TOKEN = 'new-secret-token-rotation-22222222';

    // Railway config with both tokens during migration grace period
    process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN = 'true';
    process.env.FONNTE_WEBHOOK_TOKEN = `${NEW_TOKEN}, ${OLD_TOKEN}`;

    // Request with OLD_TOKEN still accepted
    const resOld = await request(app)
      .post(`/fonnte/webhook?token=${OLD_TOKEN}`)
      .send(samplePayload);
    expect(resOld.status).toBe(200);
    expect(resOld.text).toBe('ok');

    // Request with NEW_TOKEN also accepted
    const resNew = await request(app)
      .post(`/fonnte/webhook?token=${NEW_TOKEN}`)
      .send(samplePayload);
    expect(resNew.status).toBe(200);
    expect(resNew.text).toBe('ok');

    // Request with other token rejected
    const resBad = await request(app)
      .post('/fonnte/webhook?token=unrelated-token')
      .send(samplePayload);
    expect(resBad.status).toBe(401);
  });
});



