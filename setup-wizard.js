#!/usr/bin/env node
/**
 * INTERACTIVE SETUP WIZARD
 * Guides user through exact steps
 */

const readline = require('readline');
const { execSync } = require('child_process');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => {
    rl.question(question, resolve);
  });
}

async function wizard() {
  console.log('\n' + '╔' + '═'.repeat(70) + '╗');
  console.log('║' + ' '.repeat(70) + '║');
  console.log('║  ' + 'FONNTE BOT - INTERACTIVE SETUP WIZARD'.padEnd(68) + '║');
  console.log('║' + ' '.repeat(70) + '║');
  console.log('╚' + '═'.repeat(70) + '╝\n');

  console.log('📝 Current Status:\n');
  console.log('  Bot Server: ❌ NOT running');
  console.log('  ngrok Tunnel: ❌ NOT running');
  console.log('  Fonnte Config: ✓ Ready\n');

  console.log('🎯 Next Steps:\n');
  console.log('I akan guide kamu untuk setup lengkap.\n');

  // Step 1
  console.log('═'.repeat(70));
  console.log('STEP 1: Start ngrok tunnel');
  console.log('─'.repeat(70));
  console.log('\n1. Buka Terminal/PowerShell BARU');
  console.log('2. Jalankan command:\n');
  console.log('   ngrok http 4000\n');
  console.log('3. Tunggu sampai muncul:\n');
  console.log('   "Forwarding: https://xxxxx-xx.ngrok.io -> http://localhost:4000"\n');
  console.log('4. COPY URL ini (akan dipakai nanti)\n');

  await ask('Press ENTER setelah ngrok running... ');

  // Step 2
  console.log('\n' + '═'.repeat(70));
  console.log('STEP 2: Start bot server');
  console.log('─'.repeat(70));
  console.log('\n1. Buka Terminal/PowerShell LAIN (yang 2nd)');
  console.log('2. Jalankan command:\n');
  console.log('   npm run dev\n');
  console.log('3. Tunggu sampai muncul:\n');
  console.log('   "[Server] Listening { port: 4000 }"\n');
  console.log('4. JANGAN CLOSE terminal ini!\n');

  await ask('Press ENTER setelah bot server running... ');

  // Step 3
  console.log('\n' + '═'.repeat(70));
  console.log('STEP 3: Get webhook URL');
  console.log('─'.repeat(70));
  console.log('\n1. Buka Terminal/PowerShell LAIN (yang 3rd)');
  console.log('2. Jalankan command:\n');
  console.log('   node check-webhook-url.js\n');
  console.log('3. Lihat output, cari:\n');
  console.log('   "Public URL: https://xxxxx-xx.ngrok.io"\n');
  console.log('4. COPY full webhook URL dari output\n');

  const webhookUrl = await ask('Paste webhook URL di sini (dari step 3): ');

  if (!webhookUrl.includes('https://')) {
    console.log('❌ Invalid URL. Coba lagi.');
    rl.close();
    return;
  }

  // Step 4
  console.log('\n' + '═'.repeat(70));
  console.log('STEP 4: Configure Fonnte Dashboard');
  console.log('─'.repeat(70));
  console.log('\n1. Go to: https://dashboard.fonnte.com');
  console.log('2. Login dengan akun Fonnte');
  console.log('3. Cari menu: Webhook / Integration / Settings');
  console.log('4. Paste webhook URL:\n');
  console.log(`   ${webhookUrl}\n`);

  const hasToken = Boolean(String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim());
  if (hasToken) {
    const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    console.log('5. Add Header (if has field):\n');
    console.log('   Header Name: x-webhook-token');
    console.log(`   Header Value: ${token}\n`);
  }

  console.log('6. Klik "Test" atau "Save"');
  console.log('7. Harapkan response: HTTP 200 atau 201\n');

  await ask('Press ENTER setelah konfigurasi Fonnte selesai... ');

  // Step 5
  console.log('\n' + '═'.repeat(70));
  console.log('STEP 5: Test dengan real WhatsApp');
  console.log('─'.repeat(70));
  console.log('\n1. Buka WhatsApp di phone');
  console.log('2. Send message ke bot number');
  console.log('3. Lihat Terminal 2 (npm run dev)');
  console.log('4. Cari logs:\n');
  console.log('   [Fontte Webhook] incoming');
  console.log('   [ProviderRoute] POST /provider/webhook received');
  console.log('   [WhatsAppBusiness] ✓ Pesan terkirim via Fonnte\n');
  console.log('5. Harapkan REPLY di WhatsApp\n');

  await ask('Press ENTER setelah test... ');

  // Done
  console.log('\n' + '═'.repeat(70));
  console.log('✨ DONE!');
  console.log('═'.repeat(70));
  console.log('\n✓ Bot harus sekarang bisa reply real WhatsApp messages!\n');
  console.log('Jika masih tidak berfungsi, jalankan:\n');
  console.log('  node diagnose-bot-reply.js\n');
  console.log('Untuk debugging lebih lanjut.\n');

  rl.close();
}

wizard().catch(console.error);
