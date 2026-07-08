#!/usr/bin/env node
/**
 * Debug script untuk cek konfigurasi Fonnte bot
 */

require('dotenv').config();

console.log('='.repeat(60));
console.log('🔍 FONNTE BOT DEBUG CHECK');
console.log('='.repeat(60));

const checks = {
  'WHATSAPP_PROVIDER': process.env.WHATSAPP_PROVIDER || '(tidak set)',
  'WHATSAPP_API_KEY': process.env.WHATSAPP_API_KEY 
    ? `✓ ${process.env.WHATSAPP_API_KEY.slice(0, 10)}...` 
    : '❌ TIDAK SET',
  'WHATSAPP_FONNTE_SEND_URL': process.env.WHATSAPP_FONNTE_SEND_URL || 'https://api.fonnte.com/send (default)',
  'PORT': process.env.PORT || '4000 (default)',
};

console.log('\n📋 Konfigurasi Environment:');
Object.entries(checks).forEach(([key, value]) => {
  console.log(`  ${key}: ${value}`);
});

// Cek apakah konfigurasi lengkap
const whatsappProvider = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase();
const apiKey = (process.env.WHATSAPP_API_KEY || '').trim();

console.log('\n🔎 Status:');

if (!whatsappProvider) {
  console.log('  ❌ WHATSAPP_PROVIDER tidak di-set');
  console.log('     ➜ Set ke "fonnte" di .env atau docker-compose');
}

if (whatsappProvider && whatsappProvider !== 'fonnte') {
  console.log(`  ⚠️  WHATSAPP_PROVIDER set ke "${whatsappProvider}" (bukan "fonnte")`);
}

if (!apiKey) {
  console.log('  ❌ WHATSAPP_API_KEY tidak di-set');
  console.log('     ➜ Dapatkan token dari https://dashboard.fonnte.com');
}

if (whatsappProvider === 'fonnte' && apiKey) {
  console.log('  ✅ Konfigurasi Fonnte LENGKAP!');
  console.log(`     Provider: fonnte`);
  console.log(`     API Key: ${apiKey.slice(0, 10)}...${apiKey.slice(-5)}`);
} else {
  console.log('  ❌ Konfigurasi Fonnte BELUM LENGKAP');
  console.log('\n📝 Setup Fonnte:');
  console.log('  1. Buka https://dashboard.fonnte.com');
  console.log('  2. Login dengan akun Anda');
  console.log('  3. Copy API Token dari dashboard');
  console.log('  4. Set di .env atau environment:');
  console.log('     WHATSAPP_PROVIDER=fonnte');
  console.log('     WHATSAPP_API_KEY=<paste_token_here>');
  console.log('  5. Restart server: npm run dev');
}

console.log('\n' + '='.repeat(60));

// Export untuk test
module.exports = { checks, whatsappProvider, apiKey };
