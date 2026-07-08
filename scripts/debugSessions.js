require('dotenv').config();
const prisma = require('../src/db');
const crypto = require('crypto');

function safeDbFingerprint() {
  const raw = process.env.DATABASE_URL ? String(process.env.DATABASE_URL) : '';
  if (!raw) return { databaseUrlPresent: false, databaseUrlHash: null, database: null };

  const databaseUrlHash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
  let database = null;
  try {
    const u = new URL(raw);
    database = {
      protocol: (u.protocol || '').replace(':', ''),
      host: u.hostname || null,
      port: u.port ? Number(u.port) : null,
      database: u.pathname ? u.pathname.replace(/^\//, '') : null
    };
  } catch {
    database = null;
  }

  return { databaseUrlPresent: true, databaseUrlHash, database };
}

async function main() {
  const chatId = process.argv[2] ? String(process.argv[2]).trim() : null;

  console.log(safeDbFingerprint());

  const [sessionCount, chatCount, trainingCount] = await Promise.all([
    prisma.session.count().catch(() => null),
    prisma.chat.count().catch(() => null),
    prisma.trainingData.count().catch(() => null)
  ]);
  console.log({ sessionCount, chatCount, trainingCount });

  if (chatId) {
    const row = await prisma.session.findUnique({
      where: { chatId },
      select: { chatId: true, updatedAt: true, state: true, data: true }
    });

    if (!row) {
      console.log({ chatId, found: false });
      return;
    }

    const messages = Array.isArray(row.data && row.data.messages) ? row.data.messages : [];

    console.log({
      chatId: row.chatId,
      updatedAt: row.updatedAt,
      state: row.state,
      messagesCount: messages.length,
      lastDirections: messages.slice(-8).map((m) => m && m.direction).filter(Boolean)
    });

    return;
  }

  const rows = await prisma.session.findMany({
    take: 10,
    orderBy: { updatedAt: 'desc' },
    select: { chatId: true, updatedAt: true, state: true, data: true }
  });

  const out = rows.map((r) => {
    const messages = Array.isArray(r.data && r.data.messages) ? r.data.messages : [];
    return {
      chatId: r.chatId,
      updatedAt: r.updatedAt,
      state: r.state,
      messagesCount: messages.length,
      lastDirections: messages.slice(-5).map((m) => m && m.direction).filter(Boolean)
    };
  });

  console.table(out);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  });
