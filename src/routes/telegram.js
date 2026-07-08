const express = require('express');
const prisma = require('../db');
const logger = require('../logger');
const { getTelegramConfig, isAllowedTelegramChatId, sendTelegramMessage } = require('../utils/telegram');
const { dispatchIncidentToGitHub, getGitHubIncidentConfig } = require('../utils/githubIncidentDispatch');
const {
  getLatestPendingIncident,
  getPendingIncidentByCode,
  consumeIncidentByCode,
} = require('../utils/incidentManager');

let warnedMissingWebhookSecret = false;

function isRepairEnabled() {
  const raw = String(process.env.ENABLE_TELEGRAM_REPAIR || '').trim().toLowerCase();
  if (!raw) return false;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y' || raw === 'on';
}

function normalizeText(s) {
  return String(s || '').trim();
}

function parseYesMessage(text) {
  const t = normalizeText(text);
  if (!t) return { yes: false, code: null };

  // Accept: "YA" or "YA ABC123" or "/repair ABC123"
  const mRepair = t.match(/^\/(repair|perbaiki)\s+([A-Za-z0-9]{4,16})$/i);
  if (mRepair) return { yes: true, code: String(mRepair[2] || '').toUpperCase() };

  const m = t.match(/^(ya|y|yes)\b(?:\s+([A-Za-z0-9]{4,16}))?$/i);
  if (!m) return { yes: false, code: null };

  const code = m[2] ? String(m[2]).toUpperCase() : null;
  return { yes: true, code };
}

module.exports = function createTelegramRouter(provider) {
  const router = express.Router();

  router.post('/webhook', async (req, res) => {
    // Always ACK Telegram fast.
    res.status(200).send({ ok: true });

    try {
      const cfg = getTelegramConfig();
      const expectedSecret = cfg.webhookSecret;

      const ghCfg = getGitHubIncidentConfig();
      const needsVerifiedWebhook = isRepairEnabled() || (ghCfg && ghCfg.enabled === true);

      // Security: when actions are enabled (PR dispatch / runtime repair), require Telegram's secret token header.
      if (needsVerifiedWebhook && !expectedSecret) {
        if (!warnedMissingWebhookSecret) {
          warnedMissingWebhookSecret = true;
          void sendTelegramMessage(
            'Konfigurasi tidak aman: TELEGRAM_WEBHOOK_SECRET wajib diisi untuk menerima perintah YA/repair.\n' +
              'Set webhook Telegram dengan parameter: secret_token=<nilai ini>.',
          );
        }
        logger.warn('[TelegramWebhook] Rejected: missing TELEGRAM_WEBHOOK_SECRET (required for PR/repair)');
        return;
      }

      if (expectedSecret) {
        const got = String(req.header('x-telegram-bot-api-secret-token') || '').trim();
        if (!got || got !== expectedSecret) {
          logger.warn('[TelegramWebhook] Rejected: bad secret token');
          return;
        }
      }

      const update = req.body || {};
      const msg = update.message || update.edited_message || null;
      if (!msg) return;

      const fromChatId = msg && msg.chat && (msg.chat.id !== undefined && msg.chat.id !== null)
        ? String(msg.chat.id)
        : '';

      if (!fromChatId || !isAllowedTelegramChatId(fromChatId)) {
        logger.warn({ fromChatId }, '[TelegramWebhook] Ignored message from non-allowed chat');
        return;
      }

      const text = normalizeText(msg.text || '');
      if (!text) return;

      const { yes, code } = parseYesMessage(text);
      if (!yes) return;

      const pending = code ? getPendingIncidentByCode(code) : getLatestPendingIncident();
      if (!pending) {
        await sendTelegramMessage('Tidak ada incident pending yang bisa diproses (mungkin sudah expired).', { chatId: fromChatId });
        return;
      }

      // OPTION A: dispatch to GitHub only after confirmation.
      // If dispatch fails, keep the incident pending so user can retry.
      let gh = null;
      try {
        gh = await dispatchIncidentToGitHub(pending);
      } catch (e) {
        gh = { ok: false, error: e && e.message ? e.message : String(e) };
      }

      const runtimeRepairEnabled = isRepairEnabled();
      const actionType = pending.action && pending.action.type ? String(pending.action.type) : 'none';

      // Consume incident if GitHub dispatch succeeded (avoid duplicate PRs)
      // or if GitHub dispatch is disabled but runtime repair will run.
      let incident = null;
      if (gh && gh.ok === true) {
        incident = consumeIncidentByCode(pending.code) || pending;
      } else if ((gh && gh.disabled === true) && runtimeRepairEnabled) {
        incident = consumeIncidentByCode(pending.code) || pending;
      } else {
        incident = pending;
      }

      const prLine = (gh && gh.ok === true)
        ? `PR: OK (incident ${pending.code} dikirim ke GitHub, workflow akan buat PR + npm test).`
        : (gh && gh.disabled === true)
          ? 'PR: OFF (ENABLE_GITHUB_INCIDENT_PR=false).'
          : (gh && gh.ok === false)
            ? `PR: GAGAL (cek ENABLE_GITHUB_INCIDENT_PR / token / repo; coba lagi: YA ${pending.code})`
            : null;

      if (!runtimeRepairEnabled) {
        const lines = [
          prLine,
          `Runtime repair: OFF (ENABLE_TELEGRAM_REPAIR=false).`,
        ].filter(Boolean);

        await sendTelegramMessage(lines.join('\n'), { chatId: fromChatId });
        return;
      }

      if (actionType === 'restart') {
        const lines = [
          prLine,
          `OK. Menjalankan runtime repair: restart proses. (incident ${incident.code})`,
        ].filter(Boolean);
        await sendTelegramMessage(lines.join('\n'), { chatId: fromChatId });

        // Give webhook & outbound message a moment before exiting.
        setTimeout(() => {
          // Exit non-zero so PM2/Docker restarts.
          process.exit(1);
        }, 1500);

        return;
      }

      if (actionType === 'handover') {
        const chatId = incident.action && incident.action.chatId ? String(incident.action.chatId) : '';
        if (!chatId) {
          await sendTelegramMessage(`Incident ${incident.code} tidak punya chatId untuk handover.`, { chatId: fromChatId });
          return;
        }

        try {
          await prisma.chat.upsert({
            where: { chatId },
            create: { chatId, status: 'HUMAN', lastSeenAt: new Date() },
            update: { status: 'HUMAN' }
          });
        } catch (e) {
          await sendTelegramMessage(
            `Gagal set chat ${chatId} ke HUMAN: ${e && e.message ? e.message : String(e)}`,
            { chatId: fromChatId }
          );
          return;
        }

        // Notify user in WhatsApp (best-effort)
        try {
          if (provider && typeof provider.sendMessage === 'function') {
            await provider.sendMessage(
              chatId,
              'Terima kasih. Chat ini akan dibantu admin/human agent (bot tidak membalas otomatis).\n' +
              'Jika ingin kembali ke bot kapan saja, balas: BOT.'
            );
          }
        } catch (e) {
          // ignore
        }

        const lines = [
          prLine,
          `OK. Runtime repair: chat ${chatId} dipindah ke HUMAN. (incident ${incident.code})`,
        ].filter(Boolean);
        await sendTelegramMessage(lines.join('\n'), { chatId: fromChatId });
        return;
      }

      const lines = [
        prLine,
        `Incident ${incident.code} tidak memiliki aksi runtime repair yang dikenal: ${actionType}`,
      ].filter(Boolean);
      await sendTelegramMessage(lines.join('\n'), { chatId: fromChatId });
    } catch (err) {
      logger.error({ err: err && err.message ? err.message : String(err) }, '[TelegramWebhook] handler error');
      try {
        const update = req.body || {};
        const msg = update.message || update.edited_message || null;
        const fromChatId = msg && msg.chat && (msg.chat.id !== undefined && msg.chat.id !== null)
          ? String(msg.chat.id)
          : null;
        if (fromChatId && isAllowedTelegramChatId(fromChatId)) {
          await sendTelegramMessage('Webhook error internal saat memproses perintah repair.', { chatId: fromChatId });
        }
      } catch {
        // ignore
      }
    }
  });

  return router;
};
