'use strict';

/**
 * src/core/outboundRenderer.js
 * 
 * Greenfield Outbound WhatsApp Message Renderer.
 * Responsibilities:
 * - Sanitizes Markdown (converts unsupported styles for WA)
 * - Safe splitting of messages exceeding WhatsApp length limit (~3500 chars)
 * - Preserves monetary tokens and formatted numbers (e.g. Rp 5.000.000)
 * - Zero raw chunk leakage
 */

const MAX_WA_MESSAGE_LENGTH = 3500;

function sanitizeWhatsAppMarkdown(text) {
  if (!text || typeof text !== 'string') return '';

  let out = text.replace(/\u00A0/g, ' '); // Clean non-breaking spaces
  
  // Convert standard markdown headers (# Header) to WhatsApp bold (*Header*)
  out = out.replace(/^#{1,6}\s*(.+)$/gm, '*$1*');

  // Convert markdown bold (**text**) to WhatsApp bold (*text*)
  out = out.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  // Strip internal raw database artifacts and markers
  out = out.replace(/GǪ[\s\S]*?GǪ/g, '');
  out = out.replace(/\[chunk_\d+\]/gi, '');
  out = out.replace(/governanceMetadata:\s*\{[^}]*\}/gi, '');
  out = out.replace(/\s{2,}/g, ' ');

  return out.trim();
}

function splitLongMessage(text, maxLength = MAX_WA_MESSAGE_LENGTH) {
  if (!text || text.length <= maxLength) {
    return [text];
  }

  const parts = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Attempt to split at paragraph or newline boundary
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf('. ', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = maxLength;
    }

    parts.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}

module.exports = {
  sanitizeWhatsAppMarkdown,
  splitLongMessage
};
