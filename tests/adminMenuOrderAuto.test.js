const express = require('express');
const request = require('supertest');

jest.mock('../src/db', () => {
  return {
    menuItem: {
      aggregate: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock('../src/middleware/adminAudit', () => {
  return {
    logAdminAction: jest.fn().mockResolvedValue(undefined),
  };
});

const prisma = require('../src/db');
const createAdminRoute = require('../src/routes/admin');

describe('Admin menu auto-order', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    // Minimal req.user to satisfy downstream audit helpers (even though mocked).
    app.use((req, _res, next) => {
      req.user = { username: 'test', role: 'superadmin' };
      next();
    });

    app.use('/admin', createAdminRoute({}));
  });

  test('auto-assigns order for top-level when missing/0', async () => {
    prisma.menuItem.aggregate.mockResolvedValue({ _max: { order: 5 } });
    prisma.menuItem.create.mockImplementation(async ({ data }) => ({ id: 'm1', ...data }));

    const res = await request(app)
      .post('/admin/menu')
      .send({ key: 'root.1', text: 'Akademik', parentId: null, order: 0 });

    expect(res.status).toBe(201);
    expect(prisma.menuItem.aggregate).toHaveBeenCalledWith({
      where: { parentId: null },
      _max: { order: true },
    });
    expect(prisma.menuItem.create).toHaveBeenCalledWith({
      data: {
        key: 'root.1',
        text: 'Akademik',
        parentId: null,
        order: 6,
      },
    });
  });

  test('auto-assigns order for submenu scoped by parentId', async () => {
    prisma.menuItem.aggregate.mockResolvedValue({ _max: { order: 2 } });
    prisma.menuItem.create.mockImplementation(async ({ data }) => ({ id: 'm2', ...data }));

    const res = await request(app)
      .post('/admin/menu')
      .send({ key: 'root.1.2', text: 'KRS', parentId: 'p-root-1', order: '' });

    expect(res.status).toBe(201);
    expect(prisma.menuItem.aggregate).toHaveBeenCalledWith({
      where: { parentId: 'p-root-1' },
      _max: { order: true },
    });
    expect(prisma.menuItem.create).toHaveBeenCalledWith({
      data: {
        key: 'root.1.2',
        text: 'KRS',
        parentId: 'p-root-1',
        order: 3,
      },
    });
  });

  test('respects explicit positive order (no auto)', async () => {
    prisma.menuItem.create.mockImplementation(async ({ data }) => ({ id: 'm3', ...data }));

    const res = await request(app)
      .post('/admin/menu')
      .send({ key: 'root.9', text: 'X', parentId: null, order: 99 });

    expect(res.status).toBe(201);
    expect(prisma.menuItem.aggregate).not.toHaveBeenCalled();
    expect(prisma.menuItem.create).toHaveBeenCalledWith({
      data: {
        key: 'root.9',
        text: 'X',
        parentId: null,
        order: 99,
      },
    });
  });

  test('normalizes empty-string parentId to null', async () => {
    prisma.menuItem.aggregate.mockResolvedValue({ _max: { order: 0 } });
    prisma.menuItem.create.mockImplementation(async ({ data }) => ({ id: 'm4', ...data }));

    const res = await request(app)
      .post('/admin/menu')
      .send({ key: 'root.10', text: 'Y', parentId: '', order: 0 });

    expect(res.status).toBe(201);
    expect(prisma.menuItem.aggregate).toHaveBeenCalledWith({
      where: { parentId: null },
      _max: { order: true },
    });
    expect(prisma.menuItem.create).toHaveBeenCalledWith({
      data: {
        key: 'root.10',
        text: 'Y',
        parentId: null,
        order: 1,
      },
    });
  });
});
