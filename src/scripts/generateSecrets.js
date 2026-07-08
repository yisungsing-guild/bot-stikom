require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcrypt');

async function main() {
  try {
    const jwtBytes = parseInt(process.env.JWT_BYTES || '64', 10);
    const password = process.env.ADMIN_PASSWORD_PLAIN || 'ChangeMeNow!123';

    const jwtSecret = crypto.randomBytes(jwtBytes).toString('hex');
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    console.log('=== Generated Secrets (copy ke .env) ===');
    console.log('JWT_SECRET="' + jwtSecret + '"');
    console.log('ADMIN_PASSWORD="' + passwordHash + '"');
    console.log('ADMIN_USERNAME (gunakan yang sudah ada atau atur manual)');
    console.log('');
    console.log('Catatan:');
    console.log('- Nilai ADMIN_PASSWORD di atas adalah HASH bcrypt.');
    console.log('- Password asli yang harus kamu ingat / simpan adalah:');
    console.log('  ADMIN_PASSWORD_PLAIN="' + password + '" (JANGAN disimpan di .env production).');
    console.log('- Ubah ADMIN_PASSWORD_PLAIN di .env lokal sebelum menjalankan script ini lagi.');
  } catch (err) {
    console.error('[generateSecrets] Error:', err.message);
    process.exitCode = 1;
  }
}

main();
