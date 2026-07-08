#!/usr/bin/env node
/**
 * Run bot server dengan debug logging maksimal
 * Akan menampilkan detail penuh dari setiap tahap processing
 */

require('dotenv').config();

// Enable debug mode
process.env.DEBUG = 'bot:*,provider:*,webhook:*';
process.env.LOG_PII = 'true'; // Log nomor dan pesan untuk debug

console.log('🚀 Memulai server dengan FULL DEBUG LOGGING');
console.log('='.repeat(60));
console.log('\nMonitor output ini saat user mengirim pesan WhatsApp\n');

// Import dan jalankan main server
require('./src/index.js');
