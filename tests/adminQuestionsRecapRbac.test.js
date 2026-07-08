const express = require('express');
const request = require('supertest');

jest.mock('../src/db', () => ({}));

jest.mock('../src/engine/analyticsEngine', () => ({
  AnalyticsEngine: {
    getGlobalQuestionRecap: jest.fn()
  }
}));

describe('Admin analytics questions-recap RBAC filtering', () => {
  let app;
  let adminRouterFactory;
  let AnalyticsEngine;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    adminRouterFactory = require('../src/routes/admin');
    ({ AnalyticsEngine } = require('../src/engine/analyticsEngine'));

    app = express();
    app.use(express.json());

    // Inject user role per-test via header for simplicity.
    app.use((req, _res, next) => {
      const role = req.header('x-test-role') || 'superadmin';
      req.user = { role };
      next();
    });

    app.use('/admin', adminRouterFactory({}));
  });

  test('non-admin division role only receives its own division', async () => {
    AnalyticsEngine.getGlobalQuestionRecap.mockResolvedValue({
      sessionsScanned: 10,
      includedUserMessages: 100,
      top: [{ question: 'GLOBAL', count: 999 }],
      byDivision: {
        keuangan: { top: [{ question: 'biaya pendaftaran', count: 3 }] },
        akademik: { top: [{ question: 'jadwal kuliah', count: 2 }] },
        lainnya: { top: [{ question: 'lokasi kampus', count: 1 }] }
      }
    });

    const res = await request(app)
      .get('/admin/analytics/questions-recap?top=5&sessions=5000')
      .set('x-test-role', 'keuangan');

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(res.body.byDivision).toBeDefined();
    expect(Object.keys(res.body.byDivision)).toEqual(['keuangan']);
    expect(res.body.top).toEqual([{ question: 'biaya pendaftaran', count: 3 }]);
  });

  test('admin receives all divisions (unfiltered)', async () => {
    const mock = {
      sessionsScanned: 10,
      includedUserMessages: 100,
      top: [{ question: 'GLOBAL', count: 999 }],
      byDivision: {
        keuangan: { top: [{ question: 'biaya pendaftaran', count: 3 }] },
        akademik: { top: [{ question: 'jadwal kuliah', count: 2 }] }
      }
    };
    AnalyticsEngine.getGlobalQuestionRecap.mockResolvedValue(mock);

    const res = await request(app)
      .get('/admin/analytics/questions-recap')
      .set('x-test-role', 'superadmin');

    expect(res.status).toBe(200);
    expect(res.body.byDivision).toEqual(mock.byDivision);
    expect(res.body.top).toEqual(mock.top);
  });

  test('unknown non-admin role receives empty recap content', async () => {
    AnalyticsEngine.getGlobalQuestionRecap.mockResolvedValue({
      sessionsScanned: 10,
      includedUserMessages: 100,
      top: [{ question: 'GLOBAL', count: 999 }],
      byDivision: {
        keuangan: { top: [{ question: 'biaya pendaftaran', count: 3 }] }
      }
    });

    const res = await request(app)
      .get('/admin/analytics/questions-recap')
      .set('x-test-role', 'staff');

    expect(res.status).toBe(200);
    expect(res.body.byDivision).toEqual({});
    expect(res.body.top).toEqual([]);
  });
});
