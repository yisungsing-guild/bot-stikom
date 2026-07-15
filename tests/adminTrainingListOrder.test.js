const express = require('express');
const request = require('supertest');

jest.mock('../src/db', () => ({
  trainingData: {
    findMany: jest.fn(),
  },
  adminUser: {
    findFirst: jest.fn(),
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

  test('restricts admin role to their own uploaded training rows', async () => {
    prisma.adminUser.findFirst.mockResolvedValue({ id: 'admin-1' });
    prisma.trainingData.findMany.mockResolvedValue([
      {
        id: 't2',
        filename: 'b.txt',
        divisionKey: null,
        active: true,
        createdAt: new Date().toISOString(),
        source: 'upload',
        uploadedById: 'admin-1',
        uploadedBy: null,
      },
    ]);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { role: 'admin', adminId: 'admin-1' };
      next();
    });
    app.use('/admin', createAdminRoute({}));

    const res = await request(app).get('/admin/training');

    expect(res.status).toBe(200);
    expect(prisma.trainingData.findMany).toHaveBeenCalledTimes(1);
    const call = prisma.trainingData.findMany.mock.calls[0][0];
    expect(call).toEqual(expect.objectContaining({
      select: expect.any(Object),
      where: { uploadedById: 'admin-1' },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    }));
  });
  test('shows unowned training rows for env/legacy admin users without AdminUser mapping', async () => {
    prisma.adminUser.findFirst.mockResolvedValue(null);
    prisma.trainingData.findMany.mockResolvedValue([
      {
        id: 't3',
        filename: 'legacy-env-upload.txt',
        divisionKey: null,
        active: true,
        createdAt: new Date().toISOString(),
        source: 'upload',
        uploadedById: null,
        uploadedBy: null,
      },
    ]);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { role: 'admin', adminId: null, username: 'env-admin' };
      next();
    });
    app.use('/admin', createAdminRoute({}));

    const res = await request(app).get('/admin/training');

    expect(res.status).toBe(200);
    expect(prisma.trainingData.findMany).toHaveBeenCalledTimes(1);
    const call = prisma.trainingData.findMany.mock.calls[0][0];
    expect(call).toEqual(expect.objectContaining({
      select: expect.any(Object),
      where: { uploadedById: null },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    }));
  });
});
