/*
Usage examples:
  node scripts/createAdminUser.js --username akademik --password "StrongPass!" --role akademik --displayName "Tim Akademik"
  node scripts/createAdminUser.js --username admin --password "NewPass!" --role admin --update

Notes:
- Password is bcrypt-hashed before storing.
- By default, script fails if user already exists unless --update is provided.
*/

// Load env vars (DATABASE_URL, etc.) the same way as the server.
const dotenv = require('dotenv');
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    ((String(process.env.NODE_ENV || '').toLowerCase() === 'production') ? '.env.production' : '.env')
});

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
  console.log('Required: --username, --password');
  console.log('Optional: --role, --displayName, --update');
  console.log('Example: node scripts/createAdminUser.js --username akademik --password "StrongPass!" --role akademik --displayName "Tim Akademik"');
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv);

  const username = args.username ? String(args.username).trim() : '';
  const password = args.password ? String(args.password) : '';
  const role = args.role ? String(args.role).trim() : 'admin';
  const displayName = args.displayName ? String(args.displayName).trim() : null;
  const update = !!args.update;

  if (!username || !password) usageAndExit(1);
  if (password.length < 8) {
    console.error('Password too short (min 8 characters).');
    process.exit(1);
  }

  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  const existing = await prisma.adminUser.findUnique({ where: { username } });

  if (existing && !update) {
    console.error('User already exists. Re-run with --update to update password/role/displayName.');
    process.exit(1);
  }

  if (existing && update) {
    const updated = await prisma.adminUser.update({
      where: { username },
      data: {
        passwordHash,
        role,
        displayName,
      },
      select: { id: true, username: true, role: true, displayName: true, createdAt: true, updatedAt: true },
    });
    console.log(JSON.stringify({ ok: true, action: 'updated', user: updated }, null, 2));
    return;
  }

  const created = await prisma.adminUser.create({
    data: {
      username,
      passwordHash,
      role,
      displayName,
    },
    select: { id: true, username: true, role: true, displayName: true, createdAt: true, updatedAt: true },
  });

  console.log(JSON.stringify({ ok: true, action: 'created', user: created }, null, 2));
}

main()
  .catch((e) => {
    console.error('CREATE_ADMIN_USER_ERROR', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
