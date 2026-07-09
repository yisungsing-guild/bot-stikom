const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { createAuthRoute } = require('../src/middleware/auth');

describe('Auth routes', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'password123'; // plain text allowed in non-production

    app = express();
    app.use(express.json());
    app.use('/auth', createAuthRoute());
  });

  test('login succeeds with correct credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeDefined();
  });

  test('login fails with wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'wrong' });

    expect(res.status).toBe(401);
  });

  test('normalizes super_admin role alias to superadmin', async () => {
    process.env.ADMIN_USERS_JSON = JSON.stringify([
      { username: 'direktur', password: 'direktur123', role: 'super_admin', displayName: 'DIR PEMASARAN DAN HUMAS' }
    ]);

    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'direktur', password: 'direktur123' });

    expect(res.status).toBe(200);
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.role).toBe('superadmin');
  });
  test('login succeeds with env multi-user (ADMIN_USERS_JSON)', async () => {
    process.env.ADMIN_USERS_JSON = JSON.stringify([
      { username: 'akademik', password: 'akademik123', role: 'akademik', displayName: 'Akademik' },
      { username: 'keuangan', password: 'keuangan123', role: 'keuangan', displayName: 'Keuangan' }
    ]);

    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'akademik', password: 'akademik123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeDefined();
  });
});
