const express = require('express');
const request = require('supertest');
const path = require('path');
const fs = require('fs/promises');

jest.mock('../src/db', () => ({}));

jest.mock('../src/middleware/adminAudit', () => {
  return {
    logAdminAction: jest.fn().mockResolvedValue(undefined),
  };
});

const createAdminRoute = require('../src/routes/admin');

function onePixelPngBuffer() {
  // 1x1 PNG
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6qYp0AAAAASUVORK5CYII=';
  return Buffer.from(b64, 'base64');
}

describe('Admin media upload', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    // Minimal auth identity to pass RBAC middleware.
    app.use((req, _res, next) => {
      req.user = { username: 'test', role: 'marketing' };
      next();
    });

    app.use('/admin', createAdminRoute({}));
  });

  test('uploads an image and returns url + marker', async () => {
    const res = await request(app)
      .post('/admin/media/upload')
      .field('caption', 'Test image')
      .attach('file', onePixelPngBuffer(), {
        filename: 'test.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(String(res.body.url || '')).toMatch(/\/media\//);
    expect(String(res.body.marker || '')).toMatch(/\[\[\s*image\s*:/i);
    expect(String(res.body.marker || '')).toContain(String(res.body.url || ''));

    // Cleanup the stored file.
    const storedAs = String(res.body.storedAs || '');
    expect(storedAs).toBeTruthy();

    const projectRoot = path.join(__dirname, '..');
    const mediaPath = path.join(projectRoot, 'uploads', 'public-media', storedAs);

    try {
      await fs.unlink(mediaPath);
    } catch {
      // ignore
    }
  });

  test('rejects non-image files', async () => {
    const res = await request(app)
      .post('/admin/media/upload')
      .attach('file', Buffer.from('hello'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error || '')).toMatch(/gambar/i);
  });
});
