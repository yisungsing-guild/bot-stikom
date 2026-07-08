/*
Create/update default STIKOM directorate users in AdminUser table.

Users requested:
- Direktur Pemasaran & Humas (superadmin)
- Dir Kemahasiswaan
- Dir Akademik
- Dir Kerjasama, Layanan Industri & Inkubator Bisnis
- Dir Urusan International
- Keuangan

Usage examples:
  node scripts/createStikomRbacUsers.js --generate --update
  node scripts/createStikomRbacUsers.js --password "StrongPass!" --update
  node scripts/createStikomRbacUsers.js --direkturPass "StrongPass!" --keuanganPass "StrongPass!" --update

Notes:
- Reads DATABASE_URL from .env/.env.production (same as server).
- By default, fails if a user exists unless --update is provided.
- Do NOT commit real passwords.
*/

const dotenv = require('dotenv');
const forceProd = process.argv.slice(2).includes('--prod');
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    (forceProd ? '.env.production' : ((String(process.env.NODE_ENV || '').toLowerCase() === 'production') ? '.env.production' : '.env')),
  quiet: true
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

function genPassword() {
  // 18-ish chars, plus '!'
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

function pickPass({ generate, sharedPass, perUserPass }) {
  if (generate) return genPassword();
  return perUserPass || sharedPass || '';
}

async function main() {
  const args = parseArgs(process.argv);
  const update = !!args.update;
  const generate = !!args.generate;
  const sharedPass = args.password ? String(args.password) : '';

  const users = [
    {
      key: 'direktur',
      username: args.direkturUser ? String(args.direkturUser).trim() : 'direktur',
      role: 'superadmin',
      displayName: 'Direktur Pemasaran & Humas',
      passArg: args.direkturPass ? String(args.direkturPass) : '',
    },
    {
      key: 'kemahasiswaan',
      username: args.kemahasiswaanUser ? String(args.kemahasiswaanUser).trim() : 'kemahasiswaan',
      role: 'kemahasiswaan',
      displayName: 'Dir Kemahasiswaan',
      passArg: args.kemahasiswaanPass ? String(args.kemahasiswaanPass) : '',
    },
    {
      key: 'akademik',
      username: args.akademikUser ? String(args.akademikUser).trim() : 'akademik',
      role: 'akademik',
      displayName: 'Dir Akademik',
      passArg: args.akademikPass ? String(args.akademikPass) : '',
    },
    {
      key: 'kerjasama',
      username: args.kerjasamaUser ? String(args.kerjasamaUser).trim() : 'kerjasama',
      role: 'kerjasama',
      displayName: 'Dir Kerjasama, Layanan Industri & Inkubator Bisnis',
      passArg: args.kerjasamaPass ? String(args.kerjasamaPass) : '',
    },
    {
      key: 'international',
      username: args.internationalUser ? String(args.internationalUser).trim() : 'international',
      role: 'international',
      displayName: 'Dir Urusan International',
      passArg: args.internationalPass ? String(args.internationalPass) : '',
    },
    {
      key: 'keuangan',
      username: args.keuanganUser ? String(args.keuanganUser).trim() : 'keuangan',
      role: 'keuangan',
      displayName: 'Keuangan',
      passArg: args.keuanganPass ? String(args.keuanganPass) : '',
    },
  ];

  // Ensure we have passwords
  const passwords = {};
  for (const u of users) {
    passwords[u.key] = pickPass({ generate, sharedPass, perUserPass: u.passArg });
  }

  const missing = Object.entries(passwords).filter(([, p]) => !p);
  if (missing.length) {
    console.log('Missing required args. Provide either:');
    console.log('  --password "..."  (same password for all)');
    console.log('or');
    console.log('  --generate  (prints generated passwords)');
    console.log('or');
    console.log('  per-user: --direkturPass/--kemahasiswaanPass/--akademikPass/--kerjasamaPass/--internationalPass/--keuanganPass');
    console.log('Optional: --update');
    process.exitCode = 2;
    return;
  }

  const results = [];
  for (const u of users) {
    results.push(await upsertAdminUser({
      username: u.username,
      password: passwords[u.key],
      role: u.role,
      displayName: u.displayName,
      update,
    }));
  }

  const output = {
    ok: true,
    update,
    generated: generate,
    users: users.reduce((acc, u) => {
      acc[u.key] = {
        username: u.username,
        role: u.role,
        displayName: u.displayName,
        password: passwords[u.key],
      };
      return acc;
    }, {}),
    results,
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((e) => {
    console.error('CREATE_STIKOM_RBAC_USERS_ERROR', e && e.message ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
