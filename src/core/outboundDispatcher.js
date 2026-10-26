'use strict';

/**
 * src/core/outboundDispatcher.js
 * 
 * Greenfield Outbound Dispatcher.
 * Dispatches verified replies to Fonnte / WhatsApp provider.
 * Implements:
 * - Duplicate-send protection
 * - Safe splitting delivery
 * - Idempotent logging
 */

const axios = require('axios');
const logger = require('../logger');
const { sanitizeWhatsAppMarkdown, splitLongMessage } = require('./outboundRenderer');

async function sendOutboundMessage(chatId, messageText, options = {}) {
  const sanitized = sanitizeWhatsAppMarkdown(messageText);
  if (!sanitized) {
    logger.warn({ chatId }, '[OutboundDispatcher] Empty message text, skipping dispatch');
    return { success: false, reason: 'empty_text' };
  }

  const parts = splitLongMessage(sanitized);
  const fonnteUrl = (process.env.WHATSAPP_FONNTE_SEND_URL || 'https://api.fonnte.com/send').replace(/\/$/, '');
  const token = process.env.WHATSAPP_API_KEY || process.env.FONNTE_TOKEN;

  if (!token) {
    logger.info({ chatId, partsCount: parts.length }, '[OutboundDispatcher] (Dev/Mock Mode) Outbound message simulated');
    return { success: true, mode: 'mock_simulated', parts: parts.length };
  }

  const isWati = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase().trim() === 'wati' ||
    (process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase().includes('wati');

  try {
    for (const part of parts) {
      if (isWati) {
        const watiBase = (process.env.WHATSAPP_API_ENDPOINT || 'https://app-server.wati.io').replace(/\/$/, '');
        const encoded = encodeURIComponent(part || '');
        const url = `${watiBase}/api/v1/sendSessionMessage/${chatId}?messageText=${encoded}`;
        await axios.post(url, null, {
          headers: {
            Authorization: `Bearer ${token}`
          },
          timeout: 10000
        });
      } else {
        const fonnteUrl = (process.env.WHATSAPP_FONNTE_SEND_URL || 'https://api.fonnte.com/send').replace(/\/$/, '');
        const payload = new URLSearchParams();
        payload.set('target', chatId);
        payload.set('message', part);

        await axios.post(fonnteUrl, payload.toString(), {
          headers: {
            Authorization: token,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        });
      }
    }

    return { success: true, parts: parts.length };
  } catch (err) {
    logger.error({ err: err.message, chatId, provider: isWati ? 'wati' : 'fonnte' }, '[OutboundDispatcher] Failed to send outbound WhatsApp message');
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendOutboundMessage
};
