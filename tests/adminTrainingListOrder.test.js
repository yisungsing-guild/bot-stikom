const express = require('express');
const request = require('supertest');

jest.mock('../src/db', () => ({
  trainingData: {
    findMany: jest.fn(),
  },
}));

describe('Admin training list ordering', () => {
  let app;
  let createAdminRoute;
  let prisma;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    createAdminRoute = require('../src/routes/admin');
    prisma = require('../src/db');

    app = express();
    app.use(express.json());

    app.use((req, _res, next) => {
      req.user = { role: 'superadmin' };
      next();
    });

    app.use('/admin', createAdminRoute({}));
  });

  test('orders by active desc, then createdAt desc', async () => {
    prisma.trainingData.findMany.mockResolvedValue([
      {
        id: 't1',
        filename: 'a.txt',
        divisionKey: null,
        active: true,
        createdAt: new Date().toISOString(),
        source: 'manual',
        uploadedById: null,
        uploadedBy: null,
      },
    ]);

    const res = await request(app).get('/admin/training');

    expect(res.status).toBe(200);
    expect(prisma.trainingData.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.trainingData.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      })
    );
  });
});
