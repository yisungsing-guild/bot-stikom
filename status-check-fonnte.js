#!/usr/bin/env node
/**
 * Status check lengkap + show exact Fonnte config needed
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

async function checkStatus() {
  console.log('\n' + '╔' + '═'.repeat(70) + '╗');
  console.log('║' + ' '.repeat(70) + '║');
  console.log('║  ' + 'BOT STATUS CHECK - FONNTE WEBHOOK SETUP'.padEnd(68) + '║');
  console.log('║' + ' '.repeat(70) + '║');
  console.log('╚' + '═'.repeat(70) + '╝\n');

  const checks = {
    '✓': [],
    '⚠️': [],
    '❌': []
  };

  // Check 1: Bot Server
  try {
    await axios.get('http://localhost:4000/admin/docs', { timeout: 2000 });
    checks['✓'].push('Bot server running (port 4000)');
  } catch (e) {
    checks['❌'].push('Bot server NOT running. Run: npm run dev');
  }

  // Check 2: ngrok
  try {
    const ngrokStatus = await axios.get('http://localhost:4040/api/tunnels', { timeout: 2000 });
    const httpTunnel = ngrokStatus.data?.tunnels?.find(t => t.proto === 'http');
    if (httpTunnel) {
      checks['✓'].push(`ngrok running (${httpTunnel.public_url})`);
      globalThis.ngrokUrl = httpTunnel.public_url;
    } else {
      checks['❌'].push('ngrok no http tunnel. Run: ngrok http 4000');
    }
  } catch (e) {
    checks['❌'].push('ngrok NOT running. Run: ngrok http 4000');
  }

  // Check 3: Configuration
  const whatsappProvider = process.env.WHATSAPP_PROVIDER?.toLowerCase();
  const hasApiKey = Boolean(process.env.WHATSAPP_API_KEY);

  if (whatsappProvider === 'fonnte' && hasApiKey) {
    checks['✓'].push('Fonnte configured (WHATSAPP_PROVIDER=fonnte, API_KEY set)');
  } else {
    checks['❌'].push(`Fonnte NOT configured (Provider: ${whatsappProvider || 'not set'}, API_KEY: ${hasApiKey ? 'set' : 'NOT set'})`);
  }

  // Check 4: Token requirement
  const tokenRequired = String(process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN || '').toLowerCase().trim();
  const hasToken = Boolean(String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim());
  const shouldRequire = tokenRequired === 'true' ? true : (tokenRequired === 'false' ? false : hasToken);

  if (shouldRequire && hasToken) {
    checks['✓'].push('Webhook token configured');
  } else if (!shouldRequire) {
    checks['⚠️'].push('Webhook token NOT required (OK but less secure)');
  }

  // Print checks
  Object.entries(checks).forEach(([icon, items]) => {
    if (items.length > 0) {
      items.forEach(item => {
        console.log(`${icon} ${item}`);
      });
    }
  });

  console.log('\n' + '═'.repeat(70) + '\n');

  // If all OK, show Fonnte config
  if (checks['❌'].length === 0 && globalThis.ngrokUrl) {
    console.log('📋 FONNTE DASHBOARD CONFIGURATION:\n');
    console.log('Go to: https://dashboard.fonnte.com\n');
    console.log('1. Find: Webhook / Integration Settings');
    console.log('2. Set Webhook URL:\n');
    console.log(`   ${globalThis.ngrokUrl}/fonnte/webhook\n`);

    if (shouldRequire && hasToken) {
      console.log('3. Add Header:\n');
      console.log(`   Name: x-webhook-token`);
      console.log(`   Value: ${process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.slice(0, 20)}...\n`);
      console.log('4. Save → Test in dashboard\n');
    } else {
      console.log('3. Save → Test in dashboard\n');
    }

    console.log('═'.repeat(70));
    console.log('\n5. Send WhatsApp message to bot number');
    console.log('6. Check Terminal 2 (npm run dev) for logs');
    console.log('7. Should see reply in WhatsApp! ✓\n');

    console.log('🧪 Test logs to watch for:\n');
    console.log('   [Fontte Webhook] incoming');
    console.log('   [ProviderRoute] POST /provider/webhook received');
    console.log('   [WhatsAppBusiness] ✓ Pesan terkirim via Fonnte\n');

  } else {
    console.log('❌ FIX ISSUES FIRST:\n');
    checks['❌'].forEach(issue => {
      console.log(`   • ${issue}`);
    });
    console.log();
  }
}

checkStatus().catch(console.error);
