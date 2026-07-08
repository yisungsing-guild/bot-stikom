#!/usr/bin/env node
/**
 * Test script: Cek apakah provider Fonnte bisa mengirim message ke API
 */

require('dotenv').config();
const axios = require('axios');

async function testFonnteDirectSend() {
  console.log('🧪 Test Direct Fonnte Send\n');

  const apiKey = process.env.WHATSAPP_API_KEY;
  const fonnteUrl = process.env.WHATSAPP_FONNTE_SEND_URL || 'https://api.fonnte.com/send';
  
  console.log(`API Key: ${apiKey ? `✓ ${apiKey.slice(0, 10)}...${apiKey.slice(-5)}` : '❌ TIDAK SET'}`);
  console.log(`Fonnte URL: ${fonnteUrl}`);

  if (!apiKey) {
    console.log('\n❌ WHATSAPP_API_KEY tidak dikonfigurasi!');
    console.log('Set di .env: WHATSAPP_API_KEY=<token_dari_fonnte>');
    return;
  }

  try {
    const testPhone = '6281234567890';
    const testMessage = 'Test reply dari bot - ' + new Date().toLocaleTimeString();

    console.log(`\n📤 Mencoba mengirim ke Fonnte API...`);
    console.log(`   Target: ${testPhone}`);
    console.log(`   Pesan: "${testMessage}"`);

    const payload = new URLSearchParams();
    payload.set('target', testPhone);
    payload.set('message', testMessage);

    const response = await axios.post(fonnteUrl, payload, {
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });

    console.log('\n✅ Fonnte API BERHASIL menerima request!');
    console.log(`Status: ${response.status}`);
    console.log(`Response:`, JSON.stringify(response.data, null, 2));

    if (response.data?.status === false || response.data?.success === false) {
      console.log('\n⚠️  API menolak pengiriman:');
      console.log(`Reason: ${response.data.reason || response.data.detail || 'Unknown'}`);
    } else {
      console.log('\n✓ Pesan berhasil dikirim!');
    }

  } catch (error) {
    console.error('\n❌ Error saat menghubungi Fonnte API:');
    if (error.response) {
      console.error(`HTTP ${error.response.status}:`, error.response.data);
    } else if (error.code === 'ENOTFOUND') {
      console.error(`DNS error - tidak bisa resolve ${fonnteUrl}`);
      console.error('Cek: konfigurasi WHATSAPP_FONNTE_SEND_URL atau koneksi internet');
    } else if (error.code === 'ECONNREFUSED') {
      console.error(`Connection refused ke ${fonnteUrl}`);
    } else {
      console.error(error.message);
    }
    return false;
  }
}

testFonnteDirectSend();
