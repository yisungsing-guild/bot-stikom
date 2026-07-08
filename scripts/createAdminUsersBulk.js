/*
Bulk create/update AdminUser accounts.

Usage:
  node scripts/createAdminUsersBulk.js --file scripts/adminUsers.json
  node scripts/createAdminUsersBulk.js --file scripts/adminUsers.json --update

JSON format (array of users):
[
  {
    "username": "keuangan",
    "password": "<strong password>",
    "role": "keuangan",
    "displayName": "Tim Keuangan"
  }
]

Notes:
- Passwords are bcrypt-hashed before storing.
- By default, the script fails if any user already exists unless --update is provided.
- Do NOT commit files containing real passwords.
*/

// Load env vars (DATABASE_URL, etc.) the same way as the server.
const dotenv = require('dotenv');
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    ((String(process.env.NODE_ENV || '').toLowerCase() === 'production') ? '.env.production' : '.env')
});

const fs = require('fs');
const path = require('path');
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
  console.log('Missing required args.');
  console.log('Required: --file');
  console.log('Optional: --update, --skip-existing');
  console.log('Example: node scripts/createAdminUsersBulk.js --file scripts/adminUsers.json --skip-existing');
  process.exit(code);
}

function normalizeUser(input) {
  const username = input && input.username ? String(input.username).trim() : '';
  const password = input && typeof input.password !== 'undefined' ? String(input.password) : '';
  const role = input && input.role ? String(input.role).trim() : 'admin';
  const displayName = input && input.displayName ? String(input.displayName).trim() : null;

  return { username, password, role, displayName };
}

async function upsertUser(user, update, skipExisting) {
  const { username, password, role, displayName } = user;

  if (!username || !password) {
    throw new Error('Each user must have username and password');
  }
  if (password.length < 8) {
    throw new Error(`Password too short for username=${username} (min 8 characters)`);
  }

  const existing = await prisma.adminUser.findUnique({ where: { username } });
  if (existing && skipExisting && !update) {
    return { action: 'skipped', username };
  }
  if (existing && !update && !skipExisting) {
    throw new Error(`User already exists: ${username} (re-run with --update or --skip-existing)`);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  if (existing && update) {
    const updated = await prisma.adminUser.update({
      where: { username },
      data: { passwordHash, role, displayName },
      select: { id: true, username: true, role: true, displayName: true, createdAt: true, updatedAt: true },
    });
    return { action: 'updated', user: updated };
  }

  if (existing && skipExisting) {
    return { action: 'skipped', username };
  }

  const created = await prisma.adminUser.create({
    data: { username, passwordHash, role, displayName },
    select: { id: true, username: true, role: true, displayName: true, createdAt: true, updatedAt: true },
  });

  return { action: 'created', user: created };
}

async function main() {
  const args = parseArgs(process.argv);
  const fileArg = args.file ? String(args.file) : '';
  const update = !!args.update;

  if (!fileArg) usageAndExit(1);

  const filePath = path.isAbsolute(fileArg)
    ? fileArg
    : path.join(process.cwd(), fileArg);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON:', e.message);
    process.exit(1);
  }

  if (!Array.isArray(items)) {
    console.error('JSON must be an array of users.');
    process.exit(1);
  }

  const skipExisting = !!args['skip-existing'];
  const results = [];
  for (const input of items) {
    const user = normalizeUser(input);
    const r = await upsertUser(user, update, skipExisting);
    results.push(r);
  }

  console.log(JSON.stringify({ ok: true, update, results }, null, 2));
}

main()
  .catch((e) => {
    console.error('CREATE_ADMIN_USERS_BULK_ERROR', e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
