/*
Create/update dummy RBAC users so you can test division roles in the Admin UI.

Usage examples:
  node scripts/createDummyRbacUsers.js --password "StrongPass!" --update
  node scripts/createDummyRbacUsers.js --akademikPass "StrongPass!" --keuanganPass "StrongPass!" --update
  node scripts/createDummyRbacUsers.js --generate --update

Notes:
- Reads DATABASE_URL from .env/.env.production (same as server).
- By default, fails if user already exists unless --update is provided.
- Do NOT commit real passwords.
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

function usageAndExit(code = 1) {
  console.log('Missing required args. Provide either:');
  console.log('  --password "..."  (same password for both)');
  console.log('or');
  console.log('  --akademikPass "..." --keuanganPass "..."');
  console.log('or');
  console.log('  --generate  (prints generated passwords)');
  console.log('Optional: --update');
  process.exit(code);
}

function genPassword() {
  // 18 chars base64url-ish (no padding)
  return crypto.randomBytes(14).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 18) + '!';
}

async function upsertAdminUser({ username, password, role, displayName, update }) {
  if (!username || !password) throw new Error('username and password required');
  if (password.length < 8) throw new Error(`Password too short for username=${username} (min 8)`);

  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.adminUser.findUnique({ where: { username } });
  if (existing && !update) {
    throw new Error(`User already exists: ${username} (re-run with --update)`);
  }

  if (existing && update) {
    const updated = await prisma.adminUser.update({
      where: { username },
      data: { passwordHash, role, displayName },
      select: { id: true, username: true, role: true, displayName: true, createdAt: true, updatedAt: true },
    });
    return { action: 'updated', user: updated };
  }

  const created = await prisma.adminUser.create({
    data: { username, passwordHash, role, displayName },
    select: { id: true, username: true, role: true, displayName: true, createdAt: true, updatedAt: true },
  });

  return { action: 'created', user: created };
}

async function main() {
  const args = parseArgs(process.argv);
  const update = !!args.update;

  const akademikUser = args.akademikUser ? String(args.akademikUser).trim() : 'akademik';
  const keuanganUser = args.keuanganUser ? String(args.keuanganUser).trim() : 'keuangan';

  const sharedPass = args.password ? String(args.password) : '';
  const akademikPassArg = args.akademikPass ? String(args.akademikPass) : '';
  const keuanganPassArg = args.keuanganPass ? String(args.keuanganPass) : '';
  const generate = !!args.generate;

  const akademikPass = generate
    ? genPassword()
    : (akademikPassArg || sharedPass);

  const keuanganPass = generate
    ? genPassword()
    : (keuanganPassArg || sharedPass);

  if (!akademikPass || !keuanganPass) usageAndExit(1);

  const results = [];
  results.push(await upsertAdminUser({
    username: akademikUser,
    password: akademikPass,
    role: 'akademik',
    displayName: 'Tim Akademik (Dummy)',
    update,
  }));

  results.push(await upsertAdminUser({
    username: keuanganUser,
    password: keuanganPass,
    role: 'keuangan',
    displayName: 'Tim Keuangan (Dummy)',
    update,
  }));

  const output = {
    ok: true,
    update,
    users: {
      akademik: { username: akademikUser, role: 'akademik', password: akademikPass },
      keuangan: { username: keuanganUser, role: 'keuangan', password: keuanganPass },
    },
    results,
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((e) => {
    console.error('CREATE_DUMMY_RBAC_USERS_ERROR', e && e.message ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
