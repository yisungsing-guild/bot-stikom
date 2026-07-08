// Test sending a message via WhatsAppBusinessProvider (WATI mode when WHATSAPP_API_ENDPOINT contains 'wati')
// Usage: node scripts/testWatiSend.js <toChatId> [message]

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');

function resolveFromProjectRoot(p) {
  const s = String(p || '').trim();
  if (!s) return s;
  return path.isAbsolute(s) ? s : path.resolve(projectRoot, s);
}

function pickEnvPath() {
  if (process.env.DOTENV_CONFIG_PATH) return resolveFromProjectRoot(process.env.DOTENV_CONFIG_PATH);
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (!isProd) return resolveFromProjectRoot('.env');
  if (fs.existsSync(resolveFromProjectRoot('.env.production.local'))) return resolveFromProjectRoot('.env.production.local');
  return resolveFromProjectRoot('.env.production');
}

const envPath = pickEnvPath();
dotenv.config({ path: envPath, quiet: true });

const { WhatsAppBusinessProvider } = require('../src/providers/whatsappBusinessProvider');

async function main() {
  const toChatId = process.argv[2] ? String(process.argv[2]).trim() : null;
  const message = process.argv[3] ? String(process.argv.slice(3).join(' ')) : `ping ${new Date().toISOString()}`;

  if (!toChatId) {
    console.error('Usage: node scripts/testWatiSend.js <toChatId> [message]');
    process.exitCode = 2;
    return;
  }

  const apiKey = process.env.WHATSAPP_API_KEY;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const endpoint = process.env.WHATSAPP_API_ENDPOINT;
  const providerMode = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase() || '(empty)';

  const provider = new WhatsAppBusinessProvider(apiKey, phoneNumberId, businessAccountId);

  console.log('ENV', {
    DOTENV_PATH: envPath,
    WHATSAPP_PROVIDER: providerMode,
    WHATSAPP_API_ENDPOINT: endpoint || '(empty)',
    HAS_WHATSAPP_API_KEY: Boolean(String(apiKey || '').trim())
  });

  try {
    const resp = await provider.sendMessage(toChatId, message);
    console.log('SEND_OK', resp);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    console.error('SEND_ERROR', msg);
    if (/outstanding invoice|temporarily restricted|clear your dues/i.test(msg)) {
      console.error('HINT', 'Ini bukan salah token/kode: WATI membatasi akses API karena billing. Buka dashboard WATI → Billing/Invoices → lunasi invoice, lalu ulangi test ini.');
    }
  }
}

main();
