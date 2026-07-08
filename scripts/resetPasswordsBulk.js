/*
Generate secure passwords for AdminUser accounts and update DB.
Usage:
  node scripts/resetPasswordsBulk.js --all
  node scripts/resetPasswordsBulk.js --usernames user1,user2

Outputs JSON: { ok: true, results: [ { username, password } | { username, error } ] }

WARNING: This prints plaintext passwords to stdout. Distribute securely.
*/

const dotenv = require('dotenv');
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    ((String(process.env.NODE_ENV || '').toLowerCase() === 'production') ? '.env.production' : '.env')
});

const crypto = require('crypto');
const bcrypt = require('bcrypt');
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

async function main() {
  const args = parseArgs(process.argv);
  const all = !!args.all;
  const usernamesArg = args.usernames ? String(args.usernames) : '';

  let usernames = [];
  if (all) {
    const rows = await prisma.adminUser.findMany({ select: { username: true } });
    usernames = rows.map(r => r.username);
  } else if (usernamesArg) {
    usernames = usernamesArg.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    console.log('Usage: node scripts/resetPasswordsBulk.js --all OR --usernames user1,user2');
    process.exit(1);
  }

  const results = [];

  for (const username of usernames) {
    try {
      const user = await prisma.adminUser.findUnique({ where: { username } });
      if (!user) {
        results.push({ username, error: 'not_found' });
        continue;
      }

      const password = crypto.randomBytes(12).toString('base64url');
      const passwordHash = await bcrypt.hash(password, 10);

      await prisma.adminUser.update({ where: { username }, data: { passwordHash } });

      results.push({ username, password });
    } catch (err) {
      results.push({ username, error: String(err && err.message ? err.message : err) });
    }
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main()
  .catch((e) => {
    console.error('RESET_PASSWORDS_ERROR', e && e.message ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
