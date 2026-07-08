const path = require('path');
const fs = require('fs');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');

let qrcodeTerminal = null;
try {
  qrcodeTerminal = require('qrcode-terminal');
} catch (err) {
  console.warn('[Baileys] qrcode-terminal package not installed. QR will not render in terminal automatically.');
  console.warn('[Baileys] Install it with: npm install qrcode-terminal --no-save');
}

const authDir = path.join(__dirname, 'sandbox-baileys-auth');

async function main() {
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    logger: pino({ level: 'info' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.baileys('Chrome'),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr, phoneConnected } = update;

    if (connection) {
      console.log('[Baileys] connection:', connection);
    }

    if (qr) {
      console.log('\n[Baileys] QR code is available. Scan it with WhatsApp.');
      if (qrcodeTerminal) {
        qrcodeTerminal.generate(qr, { small: true });
      } else {
        console.log('[Baileys] qrcode-terminal is not installed. Install with: npm install qrcode-terminal --no-save');
        console.log('[Baileys] Raw QR string:');
        console.log(qr);
      }
    }

    if (connection === 'connecting') {
      console.log('[Baileys] status: connecting');
    }

    if (connection === 'open') {
      console.log('[Baileys] status: open');
      const loggedInUser = sock.user || state?.creds?.me;
      if (loggedInUser) {
        console.log('[Baileys] logged in as:', loggedInUser.id || loggedInUser.name || loggedInUser?.jid || loggedInUser?.user || '<unknown>');
      }
      if (phoneConnected) {
        console.log('[Baileys] phoneConnected:', phoneConnected);
      }
    }

    if (connection === 'close') {
      console.log('[Baileys] status: close');
      if (lastDisconnect) {
        const errorString = lastDisconnect.error ? lastDisconnect.error.toString() : JSON.stringify(lastDisconnect);
        console.log('[Baileys] lastDisconnect:', errorString);
      }
    }
  });

  sock.ev.on('messages.upsert', async (messageUpdate) => {
    if (!messageUpdate.messages || messageUpdate.type !== 'notify') return;

    for (const msg of messageUpdate.messages) {
      if (!msg.key || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      const messageText = getMessageText(msg.message);
      console.log('[Baileys] incoming message:', {
        from: remoteJid,
        message: messageText,
        messageId: msg.key.id,
      });

      try {
        await sock.sendMessage(remoteJid, {
          text: 'Baileys test berhasil',
        }, {
          quoted: msg,
        });
        console.log('[Baileys] replied to', remoteJid);
      } catch (err) {
        console.error('[Baileys] failed to send reply:', err.message || err);
      }
    }
  });

  process.on('SIGINT', async () => {
    console.log('\n[Baileys] SIGINT received, closing connection...');
    try {
      await sock.logout();
    } catch (_) {
      // ignore logout errors
    }
    sock.ev.removeAllListeners();
    if (sock.ws && typeof sock.ws.close === 'function') {
      sock.ws.close();
    } else if (typeof sock.end === 'function') {
      sock.end();
    }
    process.exit(0);
  });
}

function getMessageText(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage && message.extendedTextMessage.text) return message.extendedTextMessage.text;
  if (message.imageMessage && message.imageMessage.caption) return message.imageMessage.caption;
  if (message.videoMessage && message.videoMessage.caption) return message.videoMessage.caption;
  if (message.stickerMessage) return '<sticker>';
  if (message.contactMessage) return `<contact: ${message.contactMessage.displayName || message.contactMessage.vcard || 'unknown'}>`;
  if (message.documentMessage) return `<document: ${message.documentMessage.title || message.documentMessage.filename || 'unknown'}>`;
  return JSON.stringify(message);
}

main().catch((err) => {
  console.error('[Baileys] fatal error:', err);
  process.exit(1);
});
