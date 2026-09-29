'use strict';

const express = require('express');
const request = require('supertest');

// Mock db
const mockTrainingDataCreate = jest.fn();
const mockAdminUserFindFirst = jest.fn().mockResolvedValue({ id: 'admin-123' });

jest.mock('../src/db', () => ({
  trainingData: {
    create: (...args) => mockTrainingDataCreate(...args),
  },
  adminUser: {
    findFirst: (...args) => mockAdminUserFindFirst(...args),
  },
}));

// Mock adminAudit
jest.mock('../src/middleware/adminAudit', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

// Mock fileParser
const mockParseAndStoreFile = jest.fn();
jest.mock('../src/engine/fileParser', () => ({
  FileParser: {
    parseAndStoreFile: (...args) => mockParseAndStoreFile(...args),
  },
}));

// Mock uploadSecurity cleanupUploadedFile
const mockCleanupUploadedFile = jest.fn();
jest.mock('../src/middleware/uploadSecurity', () => {
  const actual = jest.requireActual('../src/middleware/uploadSecurity');
  return {
    ...actual,
    cleanupUploadedFile: (...args) => mockCleanupUploadedFile(...args),
  };
});

const createAdminRoute = require('../src/routes/admin');

describe('Admin Training Upload Orphan Cleanup', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCleanupUploadedFile.mockResolvedValue(undefined);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { adminId: 'admin-123', username: 'admin', role: 'admin' };
      next();
    });
    app.use('/admin', createAdminRoute({}));
  });

  const dummyPdfBuffer = Buffer.from('%PDF-1.4 test dummy document content');

  // CASE A: Parse fails + fallback DB create succeeds -> file NOT deleted
  test('CASE A: parse fails + fallback DB create succeeds -> file is PRESERVED (cleanup NOT called)', async () => {
    mockParseAndStoreFile.mockResolvedValue({
      success: false,
      error: 'OCR_PARSE_FAILED',
      errorCode: 'PARSE_ERROR',
    });
    mockTrainingDataCreate.mockResolvedValue({
      id: 'fallback-training-id-001',
      filename: 'SK_Akademik_2026.pdf',
    });

    const res = await request(app)
      .post('/admin/training/upload')
      .field('documentTitle', 'SK_Akademik_2026.pdf')
      .field('validFrom', '2026-01-01')
      .field('noExpiry', 'true')
      .attach('file', dummyPdfBuffer, {
        filename: 'SK_Akademik_2026.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(422);
    expect(res.body.trainingDataId).toBe('fallback-training-id-001');
    expect(mockCleanupUploadedFile).not.toHaveBeenCalled();
  });

  // CASE B: Parse fails + fallback DB create fails -> cleanupUploadedFile() CALLED
  test('CASE B: parse fails + fallback DB create fails -> cleanupUploadedFile() is CALLED to prevent orphan file', async () => {
    mockParseAndStoreFile.mockResolvedValue({
      success: false,
      error: 'Column missing in DB: P2022',
      errorCode: 'DB_WRITE_FAILED',
    });
    mockTrainingDataCreate.mockRejectedValue(new Error('P2022: Column does not exist'));

    const res = await request(app)
      .post('/admin/training/upload')
      .field('documentTitle', 'SK_Akademik_2026.pdf')
      .field('validFrom', '2026-01-01')
      .field('noExpiry', 'true')
      .attach('file', dummyPdfBuffer, {
        filename: 'SK_Akademik_2026.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(422);
    expect(res.body.trainingDataId).toBeNull();
    expect(mockCleanupUploadedFile).toHaveBeenCalledTimes(1);
    expect(mockCleanupUploadedFile).toHaveBeenCalledWith(expect.stringMatching(/SK_Akademik_2026.*\.pdf/));
  });

  // CASE C: Intake validation fails before processing -> existing cleanup runs
  test('CASE C: intake validation fails before processing -> cleanupUploadedFile() is CALLED', async () => {
    // Missing documentTitle
    const res = await request(app)
      .post('/admin/training/upload')
      // documentTitle is empty
      .field('documentTitle', '')
      .attach('file', dummyPdfBuffer, {
        filename: 'SK_Akademik_2026.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/Nama \/ Judul Dokumen wajib diisi/i);
    expect(mockParseAndStoreFile).not.toHaveBeenCalled();
    expect(mockCleanupUploadedFile).toHaveBeenCalledTimes(1);
  });

  // CASE D: Cleanup itself fails -> request returns proper error, failure handled gracefully without crashing
  test('CASE D: cleanup itself fails -> returns error response without crashing or uncaught exception', async () => {
    mockParseAndStoreFile.mockResolvedValue({
      success: false,
      error: 'DB_WRITE_FAILED',
      errorCode: 'DB_WRITE_FAILED',
    });
    mockTrainingDataCreate.mockRejectedValue(new Error('DB failure'));
    mockCleanupUploadedFile.mockRejectedValue(new Error('EACCES: permission denied, unlink'));

    const res = await request(app)
      .post('/admin/training/upload')
      .field('documentTitle', 'SK_Akademik_2026.pdf')
      .field('validFrom', '2026-01-01')
      .field('noExpiry', 'true')
      .attach('file', dummyPdfBuffer, {
        filename: 'SK_Akademik_2026.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(422);
    expect(res.body.trainingDataId).toBeNull();
    expect(mockCleanupUploadedFile).toHaveBeenCalledTimes(1);
  });
});
