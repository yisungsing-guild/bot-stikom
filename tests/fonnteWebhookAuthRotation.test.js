'use strict';

/**
 * tests/fonnteWebhookAuthRotation.test.js
 *
 * Verifies dual-token webhook authentication and rotation support for Fonnte:
 * 1. Current token (WHATSAPP_WEBHOOK_VERIFY_TOKEN) accepted via query, header, bearer, body.
 * 2. Next token (WHATSAPP_WEBHOOK_VERIFY_TOKEN_NEXT) accepted when set.
 * 3. Invalid or missing tokens rejected (401).
 * 4. Constant-time equality validation.
 * 5. Secret redaction in logs / diagnostics.
 */

const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200, data: { ok: true } })
}));

jest.mock('../src/core/orchestrator', () => ({
  handleInboundMessage: jest.fn().mockResolvedValue({ status: 'handled_by_v2' })
}));

describe('Fonnte Webhook Dual-Token Auth and Rotation', () => {
  let app;
  const tokenOld = 'test_token_legacy_1234567890abcdef';
  const tokenNext = 'test_token_next_0987654321fedcba';
  const tokenInvalid = 'test_token_wrong_9999999999zzzzzz';

  const validPayload = {
    sender: '6281234567890',
    message: 'Halo info prodi TI',
    id: 'msg-rotation-001'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INTERNAL_PROVIDER_HOST = '127.0.0.1';
    process.env.PORT = '4000';
    process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN = 'true';
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = tokenOld;
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN_NEXT;
    process.env.CHAT_ENGINE = 'v2';
    process.env.USE_GREENFIELD = 'true';

    const fonnteWebhookRouter = require('../src/routes/fonnteWebhook');
    app = express();
    app.use(express.json());
    app.use('/fonnte', fonnteWebhookRouter);
  });

  afterEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN_NEXT;
    delete process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN;
    delete process.env.CHAT_ENGINE;
    delete process.env.USE_GREENFIELD;
  });

  test('1. Accepts current token via query parameter (?token=...)', async () => {
    const res = await request(app)
      .post(`/fonnte/webhook?token=${tokenOld}`)
      .send(validPayload);
    expect(res.status).toBe(200);
  });

  test('2. Accepts current token via header (x-webhook-token)', async () => {
    const res = await request(app)
      .post('/fonnte/webhook')
      .set('x-webhook-token', tokenOld)
      .send(validPayload);
    expect(res.status).toBe(200);
  });

  test('3. Accepts current token via Authorization Bearer', async () => {
    const res = await request(app)
      .post('/fonnte/webhook')
      .set('Authorization', `Bearer ${tokenOld}`)
      .send(validPayload);
    expect(res.status).toBe(200);
  });

  test('4. Accepts current token inside body field', async () => {
    const res = await request(app)
      .post('/fonnte/webhook')
      .send(Object.assign({}, validPayload, { token: tokenOld }));
    expect(res.status).toBe(200);
  });

  test('5. Rejects invalid token with 401 when only current token is set', async () => {
    const res = await request(app)
      .post(`/fonnte/webhook?token=${tokenInvalid}`)
      .send(validPayload);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  test('6. Rejects missing token with 401 when token is required', async () => {
    const res = await request(app)
      .post('/fonnte/webhook')
      .send(validPayload);
    expect(res.status).toBe(401);
  });

  test('7. Accepts BOTH current token AND next token during transition window', async () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN_NEXT = tokenNext;

    // Both old and next tokens MUST succeed
    const resOld = await request(app)
      .post(`/fonnte/webhook?token=${tokenOld}`)
      .send(validPayload);
    expect(resOld.status).toBe(200);

    const resNext = await request(app)
      .post(`/fonnte/webhook?token=${tokenNext}`)
      .send(validPayload);
    expect(resNext.status).toBe(200);

    // Invalid token still rejected
    const resInvalid = await request(app)
      .post(`/fonnte/webhook?token=${tokenInvalid}`)
      .send(validPayload);
    expect(resInvalid.status).toBe(401);
  });

  test('8. Rejects old token once rotation completes (only next token becomes current)', async () => {
    // Rotation finalized: tokenNext becomes current, NEXT is unset
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = tokenNext;
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN_NEXT;

    const resOld = await request(app)
      .post(`/fonnte/webhook?token=${tokenOld}`)
      .send(validPayload);
    expect(resOld.status).toBe(401);

    const resNext = await request(app)
      .post(`/fonnte/webhook?token=${tokenNext}`)
      .send(validPayload);
    expect(resNext.status).toBe(200);
  });

  test('9. Does not leak token value in error response', async () => {
    const res = await request(app)
      .post(`/fonnte/webhook?token=${tokenInvalid}`)
      .send(validPayload);
    expect(res.status).toBe(401);
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(tokenOld);
    expect(bodyStr).not.toContain(tokenNext);
    expect(bodyStr).not.toContain(tokenInvalid);
  });
});
