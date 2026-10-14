'use strict';

/**
 * tests/fonnteWebhookRoutingPolicy.test.js
 *
 * Explicit opt-in routing policy regression tests for Fonnte Webhook:
 * Validates that Greenfield V2 is ONLY selected when CHAT_ENGINE=v2 or USE_GREENFIELD=true.
 * All other states (empty, unset, unknown, legacy, v1) MUST route to legacy forwardToProvider.
 */

const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200, data: { ok: true } })
}));

jest.mock('../src/core/orchestrator', () => ({
  handleInboundMessage: jest.fn().mockResolvedValue({ status: 'handled_by_v2' })
}));

describe('Fonnte Webhook Explicit Opt-In Routing Policy', () => {
  let axios;
  let orchestrator;
  let app;

  const samplePayload = {
    sender: '6281234567890',
    message: 'Halo admin kampus',
    id: 'test-msg-001'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INTERNAL_PROVIDER_HOST = '127.0.0.1';
    process.env.PORT = '4000';
    process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN = 'false';

    axios = require('axios');
    orchestrator = require('../src/core/orchestrator');

    // Fresh express app per test
    const fonnteWebhookRouter = require('../src/routes/fonnteWebhook');
    app = express();
    app.use(express.json());
    app.use('/fonnte', fonnteWebhookRouter);
  });

  afterEach(() => {
    delete process.env.CHAT_ENGINE;
    delete process.env.USE_GREENFIELD;
  });

  test('1. CHAT_ENGINE=v2 routes to Greenfield V2 (orchestrator called, axios not called)', async () => {
    process.env.CHAT_ENGINE = 'v2';
    delete process.env.USE_GREENFIELD;

    const res = await request(app).post('/fonnte/webhook').send(samplePayload);
    expect(res.status).toBe(200);

    expect(orchestrator.handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(orchestrator.handleInboundMessage).toHaveBeenCalledWith(samplePayload, { executeDispatch: true });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('2. USE_GREENFIELD=true routes to Greenfield V2 (orchestrator called, axios not called)', async () => {
    delete process.env.CHAT_ENGINE;
    process.env.USE_GREENFIELD = 'true';

    const res = await request(app).post('/fonnte/webhook').send(samplePayload);
    expect(res.status).toBe(200);

    expect(orchestrator.handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('3. CHAT_ENGINE=legacy routes to Legacy provider (axios called, orchestrator not called)', async () => {
    process.env.CHAT_ENGINE = 'legacy';
    delete process.env.USE_GREENFIELD;

    const res = await request(app).post('/fonnte/webhook').send(samplePayload);
    expect(res.status).toBe(200);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(orchestrator.handleInboundMessage).not.toHaveBeenCalled();
  });

  test('4. CHAT_ENGINE=v1 routes to Legacy provider (axios called, orchestrator not called)', async () => {
    process.env.CHAT_ENGINE = 'v1';
    delete process.env.USE_GREENFIELD;

    const res = await request(app).post('/fonnte/webhook').send(samplePayload);
    expect(res.status).toBe(200);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(orchestrator.handleInboundMessage).not.toHaveBeenCalled();
  });

  test('5. CHAT_ENGINE unset / undefined routes to Legacy provider (SAFE DEFAULT)', async () => {
    delete process.env.CHAT_ENGINE;
    delete process.env.USE_GREENFIELD;

    const res = await request(app).post('/fonnte/webhook').send(samplePayload);
    expect(res.status).toBe(200);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(orchestrator.handleInboundMessage).not.toHaveBeenCalled();
  });

  test('6. CHAT_ENGINE empty string routes to Legacy provider (SAFE DEFAULT)', async () => {
    process.env.CHAT_ENGINE = '';
    process.env.USE_GREENFIELD = '';

    const res = await request(app).post('/fonnte/webhook').send(samplePayload);
    expect(res.status).toBe(200);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(orchestrator.handleInboundMessage).not.toHaveBeenCalled();
  });

  test('7. CHAT_ENGINE unknown value routes to Legacy provider (SAFE DEFAULT)', async () => {
    process.env.CHAT_ENGINE = 'unknown_future_engine';
    delete process.env.USE_GREENFIELD;

    const res = await request(app).post('/fonnte/webhook').send(samplePayload);
    expect(res.status).toBe(200);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(orchestrator.handleInboundMessage).not.toHaveBeenCalled();
  });

  test('8. CHAT_ENGINE=legacy with USE_GREENFIELD=false routes to Legacy provider', async () => {
    process.env.CHAT_ENGINE = 'legacy';
    process.env.USE_GREENFIELD = 'false';

    const res = await request(app).post('/fonnte/webhook').send(samplePayload);
    expect(res.status).toBe(200);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(orchestrator.handleInboundMessage).not.toHaveBeenCalled();
  });

  test('9. Empty CHAT_ENGINE with USE_GREENFIELD=false routes to Legacy provider', async () => {
    process.env.CHAT_ENGINE = '';
    process.env.USE_GREENFIELD = 'false';

    const res = await request(app).post('/fonnte/webhook').send(samplePayload);
    expect(res.status).toBe(200);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(orchestrator.handleInboundMessage).not.toHaveBeenCalled();
  });
});
