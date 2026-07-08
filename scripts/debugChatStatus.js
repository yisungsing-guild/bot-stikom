// Debug helper: inspect Chat + Session state for a specific chatId
// Usage: node scripts/debugChatStatus.js <chatId>

const fs = require('fs');
const path = require('path');
const args = new Set(process.argv.slice(2));
const forceProd = args.has('--prod');

const projectRoot = path.resolve(__dirname, '..');

function resolveFromProjectRoot(p) {
  const s = String(p || '').trim();
  if (!s) return s;
  return path.isAbsolute(s) ? s : path.resolve(projectRoot, s);
}

function pickEnvPath() {
  if (process.env.DOTENV_CONFIG_PATH) return resolveFromProjectRoot(process.env.DOTENV_CONFIG_PATH);
  const isProd = forceProd || (String(process.env.NODE_ENV || '').toLowerCase() === 'production');
  if (!isProd) return resolveFromProjectRoot('.env');
  if (fs.existsSync(resolveFromProjectRoot('.env.production.local'))) return resolveFromProjectRoot('.env.production.local');
  return resolveFromProjectRoot('.env.production');
}

const envPath = pickEnvPath();
require('dotenv').config({ path: envPath, quiet: true });
const prisma = require('../src/db');

async function main() {
  const positional = process.argv.slice(2).find((a) => a && !String(a).startsWith('--'));
  const chatId = positional ? String(positional).trim() : null;
  if (!chatId) {
    console.error('Usage: node scripts/debugChatStatus.js <chatId> [--prod]');
    process.exitCode = 2;
    return;
  }

  const [chat, session] = await Promise.all([
    prisma.chat.findUnique({ where: { chatId } }).catch(() => null),
    prisma.session.findUnique({ where: { chatId } }).catch(() => null)
  ]);

  const messages = session && session.data && Array.isArray(session.data.messages)
    ? session.data.messages
    : [];

  console.log(
    JSON.stringify(
      {
        envPath,
        chatId,
        chat: chat
          ? {
              status: chat.status,
              optIn: chat.optIn,
              lastSeenAt: chat.lastSeenAt
            }
          : null,
        session: session
          ? {
              state: session.state,
              updatedAt: session.updatedAt,
              messagesCount: messages.length,
              lastDirections: messages.slice(-10).map((m) => m && m.direction).filter(Boolean),
              lastMessage: messages.length ? messages[messages.length - 1] : null
            }
          : null
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error('DEBUG_CHAT_STATUS_ERROR', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  });
