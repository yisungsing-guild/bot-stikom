const EventEmitter = require('eventemitter3');

class WhatsAppProvider extends EventEmitter {
  constructor() {
    super();
  }

  async sendMessage(chatId, message) {
    throw new Error('sendMessage not implemented');
  }

  // Send an image message (by public URL) with optional caption.
  // Not all providers support this; they may fallback to sending the URL as text.
  async sendImage(chatId, imageUrl, caption) {
    throw new Error('sendImage not implemented');
  }

  // Simulate receiving a message (only in mock provider)
  simulateIncoming(chatId, text) {
    this.emit('message', { chatId, text, fromMock: true, ts: Date.now() });
  }
}

class MockWhatsAppProvider extends WhatsAppProvider {
  constructor() {
    super();
  }

  async sendMessage(chatId, message) {
    // In mock mode we just log and emit a sent event
    console.log(`[MockProvider] Sending to ${chatId}: ${message}`);
    this.emit('sent', { chatId, message, ts: Date.now() });
    return { success: true };
  }

  async sendImage(chatId, imageUrl, caption) {
    const safeCaption = caption ? String(caption) : '';
    console.log(`[MockProvider] Sending image to ${chatId}: ${imageUrl}${safeCaption ? ` (caption: ${safeCaption})` : ''}`);
    this.emit('sentImage', { chatId, imageUrl, caption: safeCaption, ts: Date.now() });
    return { success: true };
  }
}

module.exports = { WhatsAppProvider, MockWhatsAppProvider };
