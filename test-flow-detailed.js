#!/usr/bin/env node
/**
 * Enhanced test dengan detailed log capture
 * Mengirim pesan ke webhook dan menunggu response
 */

const axios = require('axios');
require('dotenv').config();

const SERVER_HOST = process.env.INTERNAL_PROVIDER_HOST || '127.0.0.1';
const SERVER_PORT = process.env.PORT || 4000;

// Check webhook token requirement
const requireTokenRaw = String(process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN || '').toLowerCase().trim();
const hasVerifyToken = Boolean(String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim());
const shouldRequireToken = requireTokenRaw === 'true' ? true : (requireTokenRaw === 'false' ? false : hasVerifyToken);
const WEBHOOK_TOKEN = shouldRequireToken ? process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN : null;

async function testWithDetailedFlow() {
  const testPhone = '6281234567890';
  const testMessage = `Test: ${Date.now()}`;

  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║  WEBHOOK TEST WITH DETAILED FLOW TRACING              ║');
  console.log('╚' + '═'.repeat(58) + '╝\n');

  console.log('📋 Configuration:');
  console.log(`  Server: http://${SERVER_HOST}:${SERVER_PORT}`);
  console.log(`  Token required: ${shouldRequireToken}`);
  console.log(`  Endpoint: /fonnte/webhook\n`);

  try {
    // Step 1: Send to webhook
    console.log('Step 1️⃣  Sending inbound message to /fonnte/webhook');
    const payload = {
      sender: testPhone,
      message: testMessage,
      timestamp: Date.now(),
      messageId: `test-${Date.now()}`
    };

    console.log(`  → Phone: ${testPhone}`);
    console.log(`  → Message: "${testMessage}"`);
    console.log(`  → Sending...`);

    const headers = {};
    if (WEBHOOK_TOKEN) headers['x-webhook-token'] = WEBHOOK_TOKEN;

    const response = await axios.post(
      `http://${SERVER_HOST}:${SERVER_PORT}/fonnte/webhook`,
      payload,
      { headers, timeout: 10000 }
    );

    console.log(`  ✓ Webhook received: HTTP ${response.status}\n`);

    // Step 2: Wait for processing
    console.log('Step 2️⃣  Waiting for bot processing...');
    console.log(`  → Checking server logs in console`);
    console.log(`  → Bot should process and send reply\n`);

    // Step 3: Show what should happen
    console.log('Step 3️⃣  Expected flow in server logs:');
    console.log(`  1. [Fonnte Webhook] POST /fonnte/webhook received`);
    console.log(`  2. [Fontte Webhook] forwarding to /provider/webhook`);
    console.log(`  3. [ProviderRoute] POST /provider/webhook received`);
    console.log(`  4. [ProviderRoute] Processing message...`);
    console.log(`  5. [sendBotMessageRaw] Preparing reply`);
    console.log(`  6. [WhatsAppBusiness] ✓ Pesan terkirim via Fonnte\n`);

    // Step 4: Check provider webhook
    console.log('Step 4️⃣  Checking if provider webhook is reachable...');
    try {
      const checkResponse = await axios.get(
        `http://${SERVER_HOST}:${SERVER_PORT}/provider/webhook`,
        { timeout: 5000 }
      );
      console.log(`  ✓ Provider endpoint exists\n`);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        console.log(`  ❌ Cannot reach provider endpoint!\n`);
      }
    }

    // Step 5: Instructions
    console.log('📝 Next steps:');
    console.log('1. WATCH the server console for the logs above');
    console.log('2. Look for error messages');
    console.log('3. If stuck at step 3 or 4:');
    console.log('   - forwardToProvider() might be failing');
    console.log('   - Check PROVIDER_WEBHOOK_TOKEN');
    console.log('4. If stuck after step 5:');
    console.log('   - Bot engine not generating reply');
    console.log('   - Check FSM/RAG engine\n');

    console.log('ℹ️  Server console should show detailed logs now.');
    console.log('Screenshot and share the logs!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response?.status === 401) {
      console.log('\nHint: Token mismatch. Check:');
      console.log(`  FONNTE_WEBHOOK_REQUIRE_TOKEN=${process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN}`);
      console.log(`  WHATSAPP_WEBHOOK_VERIFY_TOKEN=${process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ? '(set)' : '(not set)'}`);
    }
  }
}

testWithDetailedFlow();
