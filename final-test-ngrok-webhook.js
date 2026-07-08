#!/usr/bin/env node
/**
 * Final test: Check ngrok URL dan guide Fonnte dashboard configuration
 */
const axios = require('axios');

async function main() {
  try {
    console.log('🔍 Checking ngrok tunnel status...\n');
    
    // Get ngrok URL from local ngrok API
    const ngrokResp = await axios.get('http://127.0.0.1:4040/api/tunnels', { timeout: 5000 });
    const tunnels = ngrokResp.data.tunnels || [];
    const httpTunnel = tunnels.find(t => t.proto === 'http');
    
    if (!httpTunnel) {
      console.error('❌ No HTTP tunnel found in ngrok');
      console.error('Make sure ngrok is running: ./ngrok-v3-stable-windows-adev/ngrok.exe http 4000');
      process.exit(1);
    }
    
    const ngrokUrl = httpTunnel.public_url;
    console.log(`✅ ngrok tunnel active: ${ngrokUrl}\n`);
    
    // Webhook URL untuk Fonnte
    const webhookUrl = `${ngrokUrl}/fonnte/webhook`;
    console.log(`📮 Fonnte webhook URL (copy this):\n${webhookUrl}\n`);
    
    // Test local webhook dengan HTTP 200
    console.log('🧪 Testing local webhook endpoint...');
    try {
      const testResp = await axios.post('http://localhost:4000/fonnte/webhook', {
        phone: '6281234567890',
        message: '[TEST] Bot test message',
        type: 'incoming_message',
        timestamp: new Date().toISOString()
      }, { timeout: 5000 });
      
      console.log(`✅ Local endpoint responding: HTTP ${testResp.status}`);
      console.log(`Response: ${JSON.stringify(testResp.data)}\n`);
    } catch (e) {
      console.error(`❌ Local endpoint error: ${e.message}\n`);
    }
    
    // Fonnte dashboard instructions
    console.log('═'.repeat(60));
    console.log('📋 FONNTE DASHBOARD CONFIGURATION STEPS:');
    console.log('═'.repeat(60));
    console.log(`
1. Open: https://dashboard.fonnte.com
2. Login dengan credentials Anda
3. Buka: Settings → Webhook / Integration / API
4. Find field: "Webhook URL" atau "Incoming Webhook URL"
5. Replace dengan URL ini:
   
   ${webhookUrl}

6. Find field: "Headers" atau "Custom Headers" (optional)
7. Jika ada, set JSON:
   {
     "x-webhook-token": "${process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'optional'}"
   }

8. Click: "Test" atau "Ping" button
9. Harus show: HTTP 200 OK
10. Click: "Save" atau "Update"

✅ Setelah saved, kirim message dari WhatsApp ke bot number.
Bot harus reply dalam beberapa detik.

📊 Monitor bot logs di Terminal 2 (npm run dev):
   - Cari log: "[Fontte Webhook] incoming"
   - Cari log: "[ProviderRoute] POST /provider/webhook received"
   - Cari log: "[sendBotMessageRaw]"
   - Cari log: "[WhatsAppBusiness]" dengan "✓ Pesan terkirim"
`);
    console.log('═'.repeat(60));
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
