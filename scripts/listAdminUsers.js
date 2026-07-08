// Load env vars (DATABASE_URL, etc.) the same way as the server.
const dotenv = require('dotenv');
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    ((String(process.env.NODE_ENV || '').toLowerCase() === 'production') ? '.env.production' : '.env')
});

const prisma = require('../src/db');

async function main() {
  const users = await prisma.adminUser.findMany({
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.table(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName || '',
      role: u.role,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }))
  );
}

main()
  .catch((e) => {
    console.error('LIST_ADMIN_USERS_ERROR', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
