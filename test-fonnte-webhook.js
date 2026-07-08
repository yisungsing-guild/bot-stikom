#!/usr/bin/env node
/**
 * Test script: Simulasi pesan masuk dari Fonnte webhook
 * Untuk test apakah bot bisa menerima dan membalas
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

const testPhoneNumber = '6281234567890'; // Nomor WhatsApp untuk test
const testMessage = 'Halo bot, apakah kamu bisa membalas?';

async function testInboundMessage() {
  try {
    console.log('🧪 Test Webhook Fonnte\n');
    console.log(`Server: http://${SERVER_HOST}:${SERVER_PORT}`);
    console.log(`Webhook endpoint: /fonnte/webhook`);
    console.log(`Token required: ${shouldRequireToken}`);
    if (WEBHOOK_TOKEN) console.log(`Token: ${WEBHOOK_TOKEN.slice(0, 10)}...`);
    console.log(`Test message dari: ${testPhoneNumber}`);
    console.log(`Pesan: "${testMessage}"\n`);

    // Format yang dikirim Fonnte
    const payload = {
      sender: testPhoneNumber,
      message: testMessage,
      timestamp: Date.now(),
      messageId: `test-msg-${Date.now()}`,
      waId: testPhoneNumber
    };

    console.log('📤 Mengirim ke webhook...');
    const headers = {};
    if (WEBHOOK_TOKEN) {
      headers['x-webhook-token'] = WEBHOOK_TOKEN;
    }
    
    const response = await axios.post(
      `http://${SERVER_HOST}:${SERVER_PORT}/fonnte/webhook`,
      payload,
      {
        headers,
        timeout: 10000
      }
    );

    console.log('✅ Webhook menerima pesan!');
    console.log(`Response status: ${response.status}`);
    console.log(`Response data:`, response.data);

    console.log('\n⏳ Tunggu 3 detik untuk bot memproses...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('✓ Test selesai!');
    console.log('\nCek console server untuk log lebih detail');

  } catch (error) {
    console.error('❌ Error:');
    if (error.response) {
      console.error(`HTTP ${error.response.status}:`, error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
      console.error(`❌ Tidak bisa terhubung ke server (${SERVER_HOST}:${SERVER_PORT})`);
      console.error('   Pastikan server sudah running: npm run dev');
    } else {
      console.error(error.message);
    }
  }
}

testInboundMessage();
