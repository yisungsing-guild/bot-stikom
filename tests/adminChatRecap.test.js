const express = require('express');
const request = require('supertest');

jest.mock('../src/db', () => ({
  session: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));

describe('Admin chat recap endpoint', () => {
  let app;
  let adminRouterFactory;
  let prisma;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    adminRouterFactory = require('../src/routes/admin');
    prisma = require('../src/db');

    app = express();
    app.use(express.json());

    // Simple auth injection
    app.use((req, _res, next) => {
      req.user = { role: 'admin' };
      next();
    });

    app.use('/admin', adminRouterFactory({}));
  });

  test('returns sorted top questions from Session.data.questionCounts', async () => {
    prisma.session.findUnique.mockResolvedValue({
      chatId: '628123',
      data: {
        questionCounts: {
          'biaya kuliah': 3,
          'jadwal kuliah': 10,
          'krs': 2,
        },
      },
    });

    const res = await request(app)
      .get('/admin/chats/628123/recap?top=2');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      chatId: '628123',
      top: [
        { question: 'jadwal kuliah', count: 10 },
        { question: 'biaya kuliah', count: 3 },
      ],
    });
  });
});
