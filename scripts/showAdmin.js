#!/usr/bin/env node
// Usage: node scripts/showAdmin.js [username]
const username = process.argv[2] || 'akademik';
const db = require('../src/db');

(async () => {
  try {
    const u = await db.adminUser.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        passwordHash: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    console.log(JSON.stringify(u, null, 2));
  } catch (e) {
    console.error('ERROR', e);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
})();
