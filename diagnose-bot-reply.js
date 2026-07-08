#!/usr/bin/env node
/**
 * Comprehensive diagnostic untuk debug bot reply issue
 */

require('dotenv').config();

console.log('╔' + '═'.repeat(58) + '╗');
console.log('║  BOT REPLY ISSUE - COMPREHENSIVE DIAGNOSTIC           ║');
console.log('╚' + '═'.repeat(58) + '╝\n');

// Check all config
const checks = {
  'Webhook Tokens': {
    'FONNTE_WEBHOOK_REQUIRE_TOKEN': process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN || '(not set)',
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN': process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN 
      ? `✓ ${process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN.slice(0,15)}...` 
      : '❌ NOT SET',
    'PROVIDER_WEBHOOK_TOKEN': process.env.PROVIDER_WEBHOOK_TOKEN 
      ? `✓ ${process.env.PROVIDER_WEBHOOK_TOKEN.slice(0,15)}...` 
      : '⚠️ NOT SET (optional)'
  },
  'Provider Config': {
    'WHATSAPP_PROVIDER': process.env.WHATSAPP_PROVIDER || '(not set)',
    'WHATSAPP_API_KEY': process.env.WHATSAPP_API_KEY 
      ? `✓ ${process.env.WHATSAPP_API_KEY.slice(0,10)}...` 
      : '❌ NOT SET',
    'WHATSAPP_FONNTE_SEND_URL': process.env.WHATSAPP_FONNTE_SEND_URL || '(default)',
  },
  'Server Config': {
    'PORT': process.env.PORT || '4000 (default)',
    'NODE_ENV': process.env.NODE_ENV || '(not set)',
    'INTERNAL_PROVIDER_HOST': process.env.INTERNAL_PROVIDER_HOST || '127.0.0.1 (default)',
  }
};

Object.entries(checks).forEach(([section, items]) => {
  console.log(`\n📋 ${section}:`);
  Object.entries(items).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
});

// Analysis
console.log('\n\n🔍 ANALYSIS:\n');

const requireTokenRaw = String(process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN || '').toLowerCase().trim();
const hasVerifyToken = Boolean(String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim());
const shouldRequireToken = requireTokenRaw === 'true' ? true : (requireTokenRaw === 'false' ? false : hasVerifyToken);

const issues = [];

// Issue 1: Provider webhook token
if (!process.env.PROVIDER_WEBHOOK_TOKEN) {
  issues.push({
    level: '⚠️',
    issue: 'PROVIDER_WEBHOOK_TOKEN not set',
    description: 'Fonnte webhook will forward without token. Provider webhook may accept or reject this.',
    fix: 'Set PROVIDER_WEBHOOK_TOKEN if you enabled it',
    severity: 'medium'
  });
}

// Issue 2: Fonnte webhook token requirement
if (shouldRequireToken && !hasVerifyToken) {
  issues.push({
    level: '❌',
    issue: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN missing but required',
    description: 'Fonnte webhook will reject all requests with 401 Unauthorized',
    fix: 'Set WHATSAPP_WEBHOOK_VERIFY_TOKEN or set FONNTE_WEBHOOK_REQUIRE_TOKEN=false',
    severity: 'critical'
  });
}

// Issue 3: Provider config
if (process.env.WHATSAPP_PROVIDER !== 'fonnte') {
  issues.push({
    level: '❌',
    issue: 'WHATSAPP_PROVIDER not set to "fonnte"',
    description: `Currently: "${process.env.WHATSAPP_PROVIDER}". Bot using wrong provider.`,
    fix: 'Set WHATSAPP_PROVIDER=fonnte',
    severity: 'critical'
  });
}

if (!process.env.WHATSAPP_API_KEY) {
  issues.push({
    level: '❌',
    issue: 'WHATSAPP_API_KEY not set',
    description: 'Provider cannot send messages without API key',
    fix: 'Set WHATSAPP_API_KEY from Fonnte dashboard',
    severity: 'critical'
  });
}

if (issues.length === 0) {
  console.log('✅ All critical checks passed!\n');
  console.log('Flow should be:');
  console.log('1. Fonnte sends webhook to your server');
  if (shouldRequireToken) {
    console.log(`2. Webhook checked for token: ${process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.slice(0, 15)}...`);
  } else {
    console.log('2. Webhook received without token requirement');
  }
  if (process.env.PROVIDER_WEBHOOK_TOKEN) {
    console.log(`3. Forward to /provider/webhook with token: ${process.env.PROVIDER_WEBHOOK_TOKEN?.slice(0, 15)}...`);
  } else {
    console.log('3. Forward to /provider/webhook without token (optional)');
  }
  console.log('4. Bot engine processes and generates reply');
  console.log('5. Reply sent back to Fonnte API');
  console.log('\nIf bot still not replying, check:');
  console.log('- Server console logs during message receive');
  console.log('- Bot engine / FSM logic');
  console.log('- RAG/reply generation');
} else {
  console.log('❌ Issues found:\n');
  issues.forEach((issue, idx) => {
    console.log(`${idx + 1}. ${issue.level} ${issue.issue}`);
    console.log(`   ${issue.description}`);
    console.log(`   Fix: ${issue.fix}`);
    console.log(`   Severity: ${issue.severity}\n`);
  });
}

console.log('\n' + '═'.repeat(60));
console.log('NEXT STEP: Run server and check console logs');
console.log('───────────────────────────────────────────────────────');
console.log('npm run dev');
console.log('(then send message from WhatsApp)\n');
