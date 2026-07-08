#!/usr/bin/env node
/**
 * Check ngrok URL dan webhook configuration
 */

require('dotenv').config();
const axios = require('axios');

async function checkNgrokAndWebhook() {
  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║  WEBHOOK URL CONFIGURATION CHECK                      ║');
  console.log('╚' + '═'.repeat(58) + '╝\n');

  // 1. Check ngrok
  console.log('📍 Step 1: Checking ngrok tunnel...\n');

  try {
    const ngrokStatus = await axios.get('http://localhost:4040/api/tunnels', {
      timeout: 3000
    });

    const tunnels = ngrokStatus.data?.tunnels || [];
    const httpTunnel = tunnels.find(t => t.proto === 'http');

    if (httpTunnel) {
      const url = httpTunnel.public_url;
      console.log(`✓ ngrok tunnel ACTIVE`);
      console.log(`  Public URL: ${url}`);
      console.log(`  (This is what Fonnte should send to)\n`);

      // 2. Suggest webhook URLs
      console.log('📝 Step 2: Fonnte webhook URLs to configure\n');
      console.log(`   Option A (preferred):`);
      console.log(`   ${url}/fonnte/webhook\n`);
      
      console.log(`   Option B (backup):`);
      console.log(`   ${url}/webhook\n`);

      // 3. Check current token requirement
      console.log('🔐 Step 3: Token requirement\n');
      const requireToken = String(process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN || '').toLowerCase().trim();
      const hasToken = Boolean(String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim());
      const shouldRequireToken = requireToken === 'true' ? true : (requireToken === 'false' ? false : hasToken);

      if (shouldRequireToken) {
        console.log(`   ✓ Token required: YES`);
        console.log(`   Header name: x-webhook-token`);
        console.log(`   Token value: ${process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.slice(0, 15)}...`);
        console.log(`\n   In Fonnte dashboard, set:`);
        console.log(`   Headers: {"x-webhook-token": "${process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN}"}\n`);
      } else {
        console.log(`   ✓ Token required: NO`);
        console.log(`   (No custom header needed)\n`);
      }

      // 4. Test webhook is reachable
      console.log('🧪 Step 4: Testing webhook accessibility\n');
      
      try {
        const headers = {};
        if (shouldRequireToken) {
          headers['x-webhook-token'] = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
        }

        const testResponse = await axios.post(
          `${url}/fonnte/webhook`,
          {
            sender: '6281234567890',
            message: 'test',
            timestamp: Date.now()
          },
          { headers, timeout: 5000 }
        );

        console.log(`   ✓ Webhook is REACHABLE from internet`);
        console.log(`   Response: HTTP ${testResponse.status}\n`);
      } catch (e) {
        console.log(`   ❌ Webhook NOT reachable from internet`);
        console.log(`   Error: ${e.message}\n`);
      }

      // 5. Summary
      console.log('═'.repeat(60));
      console.log('📋 CONFIGURATION STEPS:\n');
      console.log('1. Go to https://dashboard.fonnte.com');
      console.log('2. Find "Webhook" or "Integration" settings');
      console.log('3. Set webhook URL to:');
      console.log(`   ${url}/fonnte/webhook`);
      if (shouldRequireToken) {
        console.log('4. In Headers, add:');
        console.log(`   {"x-webhook-token": "${process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN}"}`);
      }
      console.log('5. Save and test in Fonnte dashboard');
      console.log('6. Send message from WhatsApp to bot');
      console.log('\n✓ If still no reply, run:');
      console.log('   npm run dev');
      console.log('   (and watch console for [ProviderRoute] logs)\n');

    } else {
      console.log('❌ ngrok tunnel NOT FOUND');
      console.log('\nStart ngrok with:');
      console.log('  ngrok http 4000\n');
      console.log('Then run this script again.\n');
    }
  } catch (e) {
    if (e.code === 'ECONNREFUSED') {
      console.log('❌ ngrok is NOT RUNNING\n');
      console.log('Start ngrok with:');
      console.log('  ngrok http 4000\n');
      console.log('In a new terminal, then run:');
      console.log('  npm run dev\n');
      console.log('Then run this script again.\n');
    } else {
      console.log('❌ Error checking ngrok:', e.message);
    }
  }
}

checkNgrokAndWebhook();
