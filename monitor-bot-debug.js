#!/usr/bin/env node
/**
 * Monitor bot logs real-time untuk debug
 * Jalankan ini di terminal terpisah sambil test webhook
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Get log file path if using file transport
const logFile = path.join(process.cwd(), 'logs', 'bot.log');
const hasLogFile = fs.existsSync(logFile);

console.log('🔍 BOT DEBUG MONITOR');
console.log('='.repeat(60));
console.log('\nCek console output dari server:');
console.log('1. Buka terminal baru');
console.log('2. Run: npm run dev');
console.log('3. Lihat log yang muncul saat pesan masuk\n');

if (hasLogFile) {
  console.log(`📝 Log file: ${logFile}`);
  console.log('Monitoring file changes...\n');
  
  let lastSize = 0;
  const checkLog = () => {
    try {
      const stat = fs.statSync(logFile);
      if (stat.size > lastSize) {
        const tail = fs.readFileSync(logFile, 'utf8').split('\n').slice(-20).join('\n');
        console.log('📖 Last 20 lines:');
        console.log(tail);
        lastSize = stat.size;
      }
    } catch (e) {
      // ignore
    }
  };
  
  setInterval(checkLog, 1000);
} else {
  console.log('💡 Tips untuk debug:');
  console.log('1. Server logs tersimpan di console/stdout');
  console.log('2. Cari pesan dengan pattern:');
  console.log('   - "[ProviderRoute] POST /provider/webhook received"');
  console.log('   - "[WhatsAppBusiness]" atau "[Fonnte]"');
  console.log('   - "[sendBotMessage" atau "sendMessage"');
  console.log('\n3. Jalankan test webhook dengan:');
  console.log('   node test-fonnte-webhook.js\n');
}

console.log('Checklist untuk debug:');
console.log('□ Server running (npm run dev)?');
console.log('□ Webhook menerima pesan? (POST /fonnte/webhook status 200)');
console.log('□ Fonnte API bisa dihubungi? (test-fonnte-send.js sukses)');
console.log('□ Provider initialized sebagai Fonnte?');
console.log('□ Bot engine generate reply?');
console.log('□ Provider.sendMessage() call Fonnte API?');
console.log('□ Reply sampai ke Fonnte API?');
console.log('□ Fonnte teruskan ke user?\n');

console.log('Debug commands:');
console.log('node debug-fonnte.js          # Cek config');
console.log('node test-fonnte-webhook.js   # Test webhook receive');
console.log('node test-fonnte-send.js      # Test send message\n');

// Keep script running
setInterval(() => {}, 1000);
