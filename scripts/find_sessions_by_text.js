/*
Usage:
  node scripts/find_sessions_by_text.js --text "some snippet" [--limit N]

Find recent sessions whose chat log contains a message matching the provided
text (case-insensitive substring). Prints matching chatIds and a message
snippet for inspection. This is a dry-run tool and does not modify DB.
*/

const dotenv = require('dotenv');
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    ((String(process.env.NODE_ENV || '').toLowerCase() === 'production') ? '.env.production' : '.env')
});

const prisma = require('../src/db');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

function usageAndExit() {
  console.log('Usage: node scripts/find_sessions_by_text.js --text "some snippet" [--limit N]');
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv);
  const text = args.text;
  const limit = Number(args.limit || 200);
  if (!text) usageAndExit();

  console.log('Searching sessions for text:', text);

  const rows = await prisma.session.findMany({ orderBy: { updatedAt: 'desc' }, take: limit });
  const matches = [];
  const needle = String(text || '').toLowerCase();
  for (const r of rows) {
    const data = r && r.data ? r.data : {};
    const messages = Array.isArray(data.messages) ? data.messages : [];
    for (const m of messages) {
      const msg = String(m && m.message ? m.message : '').toLowerCase();
      if (!msg) continue;
      if (msg.includes(needle)) {
        matches.push({ chatId: r.chatId, updatedAt: r.updatedAt, matchMsg: m.message, direction: m.direction });
        break;
      }
    }
  }

  if (matches.length === 0) {
    console.log('No matching sessions found in last', limit, 'sessions.');
    process.exit(0);
  }

  console.log(`Found ${matches.length} matching session(s):`);
  for (const m of matches) {
    console.log('---');
    console.log('chatId:', m.chatId);
    console.log('updatedAt:', m.updatedAt);
    console.log('direction:', m.direction);
    console.log('message snippet:', String(m.matchMsg).slice(0, 400));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR', e && e.message ? e.message : String(e));
  process.exitCode = 1;
}).finally(async () => {
  try { await prisma.$disconnect(); } catch (e) { /* ignore */ }
});
