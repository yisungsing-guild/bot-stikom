// Test sending an image via WhatsAppBusinessProvider.
// Usage: node scripts/testWatiSendImage.js <toChatId> <imageUrl> [caption]

const fs = require('fs');
const dotenv = require('dotenv');

function pickEnvPath() {
  if (process.env.DOTENV_CONFIG_PATH) return process.env.DOTENV_CONFIG_PATH;
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (!isProd) return '.env';
  if (fs.existsSync('.env.production.local')) return '.env.production.local';
  return '.env.production';
}

const envPath = pickEnvPath();
dotenv.config({ path: envPath });

const { WhatsAppBusinessProvider } = require('../src/providers/whatsappBusinessProvider');

async function main() {
  const toChatId = process.argv[2] ? String(process.argv[2]).trim() : null;
  const imageUrl = process.argv[3] ? String(process.argv[3]).trim() : null;
  const caption = process.argv[4] ? String(process.argv.slice(4).join(' ')).trim() : '';

  if (!toChatId || !imageUrl) {
    console.error('Usage: node scripts/testWatiSendImage.js <toChatId> <imageUrl> [caption]');
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
    WATI_MEDIA_API_ENDPOINT: process.env.WATI_MEDIA_API_ENDPOINT || '(default:WHATSAPP_API_ENDPOINT)',
    HAS_WHATSAPP_API_KEY: Boolean(String(apiKey || '').trim()),
    WATI_ENABLE_MEDIA_SEND: String(process.env.WATI_ENABLE_MEDIA_SEND || '').toLowerCase() || '(empty)',
    WATI_DEBUG_MEDIA_SEND: String(process.env.WATI_DEBUG_MEDIA_SEND || '').toLowerCase() || '(empty)',
    WATI_MEDIA_DOWNLOAD_AND_UPLOAD: String(process.env.WATI_MEDIA_DOWNLOAD_AND_UPLOAD || '').toLowerCase() || '(default:true)',
    WATI_MEDIA_MAX_DOWNLOAD_BYTES: process.env.WATI_MEDIA_MAX_DOWNLOAD_BYTES || '(default)',
    WATI_SEND_IMAGE_PATH: process.env.WATI_SEND_IMAGE_PATH || '(default)',
    WATI_MEDIA_URL_PARAM: process.env.WATI_MEDIA_URL_PARAM || '(default)',
    WATI_MEDIA_CAPTION_PARAM: process.env.WATI_MEDIA_CAPTION_PARAM || '(default)',
    WATI_MEDIA_TO_PARAM: process.env.WATI_MEDIA_TO_PARAM || '(default)',
    WATI_MEDIA_FORM_FILE_FIELD: process.env.WATI_MEDIA_FORM_FILE_FIELD || '(default)'
  });

  try {
    const resp = await provider.sendImage(toChatId, imageUrl, caption);
    console.log('SEND_IMAGE_OK', resp);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    console.error('SEND_IMAGE_ERROR', msg);
    if (/outstanding invoice|temporarily restricted|clear your dues/i.test(msg)) {
      console.error('HINT', 'Ini bukan salah token/kode: WATI membatasi akses API karena billing. Buka dashboard WATI → Billing/Invoices → lunasi invoice, lalu ulangi test ini.');
    }
  }
}

main();
