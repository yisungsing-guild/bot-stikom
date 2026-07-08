/* eslint-disable no-console */

const axios = require('axios');
const args = process.argv.slice(2);

const forceProd = args.includes('--prod') || args.includes('--production');
const envPath =
  process.env.DOTENV_CONFIG_PATH ||
  (forceProd
    ? '.env.production'
    : ((String(process.env.NODE_ENV || '').toLowerCase() === 'production') ? '.env.production' : '.env'));

require('dotenv').config({ path: envPath, quiet: true });

function getArgValue(name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || String(v).startsWith('-')) return null;
  return String(v);
}

function usage() {
  const bin = 'node scripts/telegramWebhook.js';
  console.log('Telegram Webhook helper');
  console.log('');
  console.log('Usage:');
  console.log(`  ${bin} [--prod] getMe`);
  console.log(`  ${bin} [--prod] info`);
  console.log(`  ${bin} [--prod] set --url https://YOUR_DOMAIN/telegram/webhook`);
  console.log('');
  console.log('Env required (loaded from DOTENV_CONFIG_PATH or envPath):');
  console.log('  TELEGRAM_BOT_TOKEN');
  console.log('  TELEGRAM_WEBHOOK_SECRET (recommended; required if PR/repair enabled in app)');
  console.log('');
  console.log('Notes:');
  console.log('- Token/secret are never printed by this script.');
  console.log('- For safety, prefer setting secrets in .env.production on the server.');
}

function safeLen(v) {
  const s = String(v || '');
  return s.trim().length;
}

function requireToken() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) throw new Error(`TELEGRAM_BOT_TOKEN is missing in ${envPath}`);
  return token;
}

function getSecret() {
  return String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
}

function isTruthy(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'y' || v === 'on';
}

async function telegramCall(method, apiMethod, payload) {
  const token = requireToken();
  const url = `https://api.telegram.org/bot${token}/${apiMethod}`;
  const resp = await axios({
    method,
    url,
    data: payload,
    timeout: 6000,
    validateStatus: () => true,
  });

  const ok = Boolean(resp && resp.data && resp.data.ok);
  if (!ok) {
    const desc = resp && resp.data && resp.data.description ? String(resp.data.description) : null;
    const code = resp && resp.data && resp.data.error_code ? String(resp.data.error_code) : null;
    const status = resp && resp.status ? String(resp.status) : null;
    throw new Error(`Telegram API failed: status=${status || '?'} error_code=${code || '?'} desc=${desc || '?'}`);
  }

  return resp.data;
}

async function cmdGetMe() {
  const data = await telegramCall('get', 'getMe');
  const u = data && data.result ? data.result : null;
  console.log('OK getMe', {
    envPath,
    bot: u
      ? {
          id: u.id,
          username: u.username,
          can_join_groups: u.can_join_groups,
          can_read_all_group_messages: u.can_read_all_group_messages,
          supports_inline_queries: u.supports_inline_queries,
        }
      : null,
  });
}

async function cmdInfo() {
  const data = await telegramCall('get', 'getWebhookInfo');
  const w = data && data.result ? data.result : null;
  console.log('OK getWebhookInfo', {
    envPath,
    webhook: w
      ? {
          url: w.url,
          pending_update_count: w.pending_update_count,
          last_error_date: w.last_error_date,
          last_error_message: w.last_error_message,
          max_connections: w.max_connections,
          ip_address: w.ip_address,
        }
      : null,
  });
}

async function cmdSet() {
  const url = getArgValue('--url') || getArgValue('-u');
  if (!url) throw new Error('Missing --url (example: --url https://YOUR_DOMAIN/telegram/webhook)');

  const secret = getSecret();
  const needsVerifiedWebhook = isTruthy('ENABLE_TELEGRAM_REPAIR') || isTruthy('ENABLE_GITHUB_INCIDENT_PR');

  if (needsVerifiedWebhook && !secret) {
    throw new Error(
      'TELEGRAM_WEBHOOK_SECRET is missing, but ENABLE_TELEGRAM_REPAIR or ENABLE_GITHUB_INCIDENT_PR is enabled. ' +
      'Set TELEGRAM_WEBHOOK_SECRET first, then run set again.'
    );
  }

  const payload = {
    url: String(url).trim(),
  };
  if (secret) payload.secret_token = secret;

  const data = await telegramCall('post', 'setWebhook', payload);
  console.log('OK setWebhook', {
    envPath,
    url: payload.url,
    secret_token_len: secret ? safeLen(secret) : 0,
    result: data && data.result !== undefined ? data.result : null,
    description: data && data.description ? data.description : null,
  });
}

async function main() {
  const cmd = args.find((a) => !String(a).startsWith('-'));
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    return;
  }

  if (cmd === 'getMe') return cmdGetMe();
  if (cmd === 'info') return cmdInfo();
  if (cmd === 'set') return cmdSet();

  throw new Error(`Unknown command: ${cmd}`);
}

main()
  .catch((err) => {
    console.error('ERR', err && err.message ? err.message : err);
    usage();
    process.exitCode = 1;
  });
