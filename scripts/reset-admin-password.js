#!/usr/bin/env node
// Reset admin password script
// Usage (POSIX): ADMIN_USERNAME=superadmin NEW_PASSWORD='YourNewPass123!' node scripts/reset-admin-password.js
// Usage (PowerShell): $env:ADMIN_USERNAME='superadmin'; $env:NEW_PASSWORD='YourNewPass123!'; node scripts/reset-admin-password.js

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = new PrismaClient();

function generatePassword(len = 14) {
  // generate a URL-safe base64 then replace non-alphanum to ensure compatibility
  const raw = crypto.randomBytes(Math.ceil(len * 3 / 4)).toString('base64');
  return raw.replace(/[^A-Za-z0-9]/g, 'A').slice(0, len);
}

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const NEW_PASSWORD = process.env.NEW_PASSWORD || generatePassword(14);
const ADMIN_ROLE = process.env.ADMIN_ROLE || 'superadmin';
const DISPLAY_NAME = process.env.DISPLAY_NAME || null;

if (!ADMIN_USERNAME) {
  console.error('Error: ADMIN_USERNAME environment variable is required.');
  console.error('Example (PowerShell):');
  console.error("$env:ADMIN_USERNAME='superadmin'; $env:NEW_PASSWORD='Pass123!'; node scripts/reset-admin-password.js");
  process.exit(1);
}

(async () => {
  try {
    const hash = bcrypt.hashSync(NEW_PASSWORD, 10);

    const createData = {
      username: ADMIN_USERNAME,
      passwordHash: hash,
      role: ADMIN_ROLE
    };
    if (DISPLAY_NAME) createData.displayName = DISPLAY_NAME;

    const updated = await prisma.adminUser.upsert({
      where: { username: ADMIN_USERNAME },
      update: { passwordHash: hash, role: ADMIN_ROLE, displayName: DISPLAY_NAME },
      create: createData
    });

    console.log('Success: account created/updated for', updated.username);
    console.log('role:', updated.role);
    if (updated.displayName) console.log('displayName:', updated.displayName);
    console.log('NEW_PASSWORD:', NEW_PASSWORD);
    console.log('Important: do NOT commit this password. Change after first login.');
  } catch (e) {
    console.error('Failed to update admin password:', e.message || e);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
})();
