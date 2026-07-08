// Ensure keyword matching is robust to punctuation and common typos.

jest.mock('../src/db', () => ({
  keywordReply: {
    findMany: jest.fn().mockResolvedValue([])
  },
  setting: {
    findUnique: jest.fn().mockResolvedValue(null)
  }
}));

describe('replyEngine keyword normalization', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('contains match tolerates punctuation + "brapakah" typo + "mendaftar/pendaftaran" variants', async () => {
    const prisma = require('../src/db');
    prisma.keywordReply.findMany.mockResolvedValueOnce([
      {
        keyword: 'berapakah biaya pendaftaran',
        response: 'OK_PENDAFTARAN',
        priority: 10,
        active: true,
        matchType: 'contains'
      }
    ]);

    const { findReplyByRules } = require('../src/engine/replyEngine');

    const q1 = 'brapakah biaya mendaftar di kampus ITB STIKOM Bali?';
    const q2 = 'berapakah biaya mendaftar di kampus ITB STIKOM Bali?';

    await expect(findReplyByRules(q1)).resolves.toBe('OK_PENDAFTARAN');
    await expect(findReplyByRules(q2)).resolves.toBe('OK_PENDAFTARAN');
  });

  test('regex match is also tested against normalized text (so typos can still match)', async () => {
    const prisma = require('../src/db');
    prisma.keywordReply.findMany.mockResolvedValueOnce([
      {
        keyword: String.raw`\bberapakah\b\s+biaya\s+pendaftaran`,
        response: 'OK_REGEX',
        priority: 10,
        active: true,
        matchType: 'regex'
      }
    ]);

    const { findReplyByRules } = require('../src/engine/replyEngine');

    const q = 'brapakah biaya pendaftaran di kampus?';
    await expect(findReplyByRules(q)).resolves.toBe('OK_REGEX');
  });
});
