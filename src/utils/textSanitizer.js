function normalizeMojibakePunctuationForWhatsapp(input) {
  let text = String(input || '');
  if (!text) return text;

  // Common mojibake sequences we’ve observed in outbound WhatsApp messages.
  // These typically come from double-encoding (UTF-8 bytes interpreted as Latin-1/CP1252 and re-saved).
  // Keep replacements conservative and readability-focused.
  const replacements = [
    // Frequently observed in this repo (these are the literal mojibake strings)
    [/ΓÇö/g, '-'], // em dash artifact
    [/ΓÇô/g, '-'], // en dash artifact
    [/ΓÇª/g, '...'], // ellipsis artifact
    [/ΓÇ£/g, '"'],
    [/ΓÇ¥/g, '"'],
    [/ΓÇÿ/g, "'"],
    [/ΓÇÖ/g, "'"],
    [/ΓÇó/g, '-'], // bullet artifact

    // Common CP1252-style mojibake (UTF-8 bytes mis-decoded as CP1252)
    [/â€”|â€“/g, '-'],
    [/â€¦/g, '...'],
    [/â€œ|â€/g, '"'],
    [/â€˜|â€™/g, "'"],

    // Observed in WhatsApp output screenshot (dash/bullet artifact)
    [/Ĉº/g, '-']
  ];

  for (const [re, replacement] of replacements) {
    text = text.replace(re, replacement);
  }

  // Cleanup: collapse some common spacing artifacts (keep conservative).
  // Use [ \t] instead of \s to avoid matching newlines; preserve intentional blank lines.
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/[ \t]{2,}/g, ' ');

  return text;
}

function sanitizeWhatsappText(input) {
  const enabled = String(process.env.WHATSAPP_STRIP_MARKDOWN || 'true').toLowerCase() === 'true';
  if (!enabled) return normalizeMojibakePunctuationForWhatsapp(String(input || ''));

  let text = String(input || '');
  if (!text.trim()) return text;

  // Normalize non-breaking spaces
  text = text.replace(/\u00A0/g, ' ');

  // Preserve WhatsApp-style list bullets that start with "* ".
  // Other markdown emphasis is still cleaned below.
  text = text.replace(/^\s*\*\s+/gm, '* ');
  text = text.replace(/^\s*[-•]\s*\*\s+/gm, '* ');

  // Strip Markdown headings at start-of-line (e.g., "## Title" -> "Title").
  // Keep conservative: only remove leading # when it is a heading marker.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/^\s{0,3}#{1,6}(?=\d|\()/gm, '');

  // Strip Markdown blockquotes at start-of-line.
  text = text.replace(/^\s*>\s?/gm, '');

  // Convert Markdown links: [text](url) -> text: url
  // Keep URLs visible/clickable for WhatsApp.
  // Also handle Markdown images: ![alt](url) -> alt: url
  text = text.replace(/!\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2');
  text = text.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2');

  // Remove fenced code blocks while keeping the content.
  // ```lang\ncontent\n``` -> content
  text = text.replace(/```[\w-]*\n([\s\S]*?)```/g, (_, inner) => String(inner || '').trim());

  // Remove inline code markers.
  text = text.replace(/`([^`\n]+)`/g, '$1');

  // Remove strikethrough markers (rarely useful in WA bot replies).
  for (let i = 0; i < 2; i++) {
    text = text.replace(/~~([^~\n]+)~~/g, '$1');
  }

  // Smart handling for asterisks:
  // - Always remove *...* inside list lines to avoid noisy bullets.
  // - If *...* appears too many times overall, strip it everywhere.
  const maxEmphasisPairs = parseInt(process.env.WHATSAPP_MAX_ASTERISK_EMPHASIS || '6', 10);
  const emphasisMatches = text.match(/\*[^*\n]{1,80}\*/g) || [];
  const asteriskCount = (text.match(/\*/g) || []).length;
  const excessive = emphasisMatches.length > maxEmphasisPairs || asteriskCount > 24;

  const stripAsterisksInLine = (line) => {
    let out = String(line || '');
    for (let i = 0; i < 3; i++) {
      out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1');
      out = out.replace(/\*\*([^*\n]+)\*\*/g, '$1');
      out = out.replace(/\*([^*\n]+)\*/g, '$1');
    }
    // Remove any leftover literal '*' in that line
    out = out.replace(/\*/g, '');
    return out;
  };

  const lines = text.replace(/\r\n/g, '\n').split('\n');

  // Trim per-line whitespace early for cleaner formatting.
  for (let i = 0; i < lines.length; i++) {
    let line = String(lines[i] || '').replace(/[\t ]+$/g, '').trimStart();

    // If a whole line is wrapped in markdown asterisks (common for section headers in WA),
    // strip them to avoid a "document-like" look.
    // Example: "*S1 (Sarjana):*" -> "S1 (Sarjana):"
    // Keep conservative: only when the entire non-empty line is wrapped.
    const wrapped = line.match(/^\*{1,3}([^*\n]{1,160})\*{1,3}\s*$/);
    if (wrapped) {
      line = String(wrapped[1] || '').trim();
    }

    // Also strip leading asterisk-wrapped labels, e.g. "*Akreditasi:* akreditasi ..."
    // This is very common in WA formatting.
    line = line.replace(/^\*{1,3}([^*\n]{1,80})\*{1,3}(\s+|$)/, (_, inner, tail) => {
      const label = String(inner || '').trim();
      const rest = String(tail || '');
      return `${label}${rest}`;
    });

    lines[i] = line;
  }

  // Normalize bullet symbols (•, ·, etc.) into '-' for WA.
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i]
      .replace(/^\s*[•·▪▫◦‣⁃]\s+/g, '- ')
      .replace(/^\s*–\s+/g, '- ')
      .replace(/^\s*-{2,}\s+/g, '- ');
    // Ensure a space after '-' bullets.
    lines[i] = lines[i].replace(/^\s*-([^\s])/g, '- $1');
    // Ensure no leading spaces before '-' bullets.
    lines[i] = lines[i].replace(/^\s+-\s+/g, '- ');
    // Normalize ordered list: "1)" or "1." should have a space after marker.
    lines[i] = lines[i].replace(/^\s*(\d+)[.)]\s*/g, '$1) ');
  }

  // Special-case formatting: schedule blocks often come as a flat bullet list like:
  // "- III A" then "- Masa pendaftaran: ..." etc.
  // Convert the short label bullet into a header to improve readability:
  // "III A:" followed by bullets.
  const isRomanWaveLabelBullet = (line) => {
    const m = String(line || '').match(/^\s*-\s*(?:Gelombang\s+)?([IVX]{1,5})\s*([A-Z])\s*$/i);
    if (!m) return null;
    const roman = String(m[1] || '').toUpperCase();
    const letter = String(m[2] || '').toUpperCase();
    // Keep conservative: only common letters.
    if (!/^[A-D]$/.test(letter)) return null;
    return { roman, letter };
  };

  const looksLikeDetailBullet = (line) => /^\s*-\s+.{1,120}:\s*\S+/.test(String(line || ''));

  for (let i = 0; i < lines.length; i++) {
    const label = isRomanWaveLabelBullet(lines[i]);
    if (!label) continue;

    // Look ahead: if the next few non-empty lines are detail bullets with ":",
    // treat this as a section header.
    let detailHits = 0;
    let scanned = 0;
    for (let j = i + 1; j < lines.length && scanned < 8; j++) {
      const candidate = String(lines[j] || '').trim();
      if (!candidate) continue;
      scanned++;
      if (looksLikeDetailBullet(candidate)) detailHits++;
      // Stop early if we hit another label bullet.
      if (isRomanWaveLabelBullet(candidate)) break;
    }

    if (detailHits >= 2) {
      lines[i] = `${label.roman} ${label.letter}:`;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isListLine = /^\s*(?:[-•]|\d+[.)])\s+/.test(line);
    if (isListLine) {
      lines[i] = stripAsterisksInLine(line);
    } else if (excessive) {
      lines[i] = stripAsterisksInLine(line);
    }
  }

  // Inline emphasis cleanup (WhatsApp-friendly, minimal):
  // - Strip emphasis around emails/URLs (looks noisy and breaks readability)
  // - Collapse **bold** or ***bold*** into *bold* (WhatsApp uses single asterisks)
  // - Limit the number of remaining *bold* segments in a message
  const maxBoldPairs = parseInt(process.env.WHATSAPP_MAX_BOLD_PAIRS || '2', 10);
  let keptBoldPairs = 0;

  const looksLikeEmailOrUrl = (s) => {
    const v = String(s || '').trim();
    if (!v) return false;
    if (/https?:\/\//i.test(v)) return true;
    if (/\bwww\./i.test(v)) return true;
    // Basic email-ish detection
    if (/\S+@\S+\.[A-Za-z]{2,}/.test(v)) return true;
    return false;
  };

  const normalizeInlineAsteriskEmphasis = (line) => {
    let out = String(line || '');

    // Replace strong markers first (*** / **)
    out = out.replace(/\*\*\*([^*\n]{1,160})\*\*\*/g, (_, inner) => {
      const content = String(inner || '').trim();
      if (!content) return '';
      if (looksLikeEmailOrUrl(content)) return content;
      if (keptBoldPairs >= maxBoldPairs) return content;
      keptBoldPairs++;
      return `*${content}*`;
    });

    out = out.replace(/\*\*([^*\n]{1,160})\*\*/g, (_, inner) => {
      const content = String(inner || '').trim();
      if (!content) return '';
      if (looksLikeEmailOrUrl(content)) return content;
      if (keptBoldPairs >= maxBoldPairs) return content;
      keptBoldPairs++;
      return `*${content}*`;
    });

    // Then handle single-pair emphasis
    out = out.replace(/\*([^*\n]{1,160})\*/g, (_, inner) => {
      const content = String(inner || '').trim();
      if (!content) return '';
      if (looksLikeEmailOrUrl(content)) return content;
      if (keptBoldPairs >= maxBoldPairs) return content;
      keptBoldPairs++;
      return `*${content}*`;
    });

    // Remove any leftover stray asterisks (unpaired) to avoid visual noise.
    out = out.replace(/\*/g, '');
    return out;
  };

  for (let i = 0; i < lines.length; i++) {
    // Keep list lines already cleaned above.
    const isListLine = /^\s*(?:\*|-|•|\d+[.)])\s+/.test(lines[i]);
    if (isListLine) continue;
    if (excessive) continue;
    lines[i] = normalizeInlineAsteriskEmphasis(lines[i]);
  }

  // Add a blank line before section-like headers and before list blocks for readability.
  // Heuristic only; keep conservative.
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = out.length > 0 ? out[out.length - 1] : '';
    const isHeader = /^\s*(?:\d+\)\s+)?[A-Za-zÀ-ÿ0-9].{0,80}:\s*$/.test(line) || /^\s*\d+\)\s+/.test(line);
    const isList = /^\s*(?:\*|-|\d+\))\s+/.test(line);

    // Look-ahead: if a header is followed by a list, add a blank line AFTER header.
    // This makes WA messages easier to scan.
    let nextNonEmpty = '';
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = String(lines[j] || '').trim();
      if (candidate) {
        nextNonEmpty = candidate;
        break;
      }
    }
    const nextIsList = /^\s*(?:\*|-|\d+\))\s+/.test(nextNonEmpty);
    const nextIsParagraph = nextNonEmpty && !nextIsList;

    if (line && ((isHeader && prev) || (isList && prev && !/^\s*$/.test(prev) && !/^\s*(?:\*|-|\d+\))\s+/.test(prev)))) {
      out.push('');
    }

    out.push(line);

    if (line && isHeader && nextIsList) {
      const justPushed = out.length > 0 ? out[out.length - 1] : '';
      const alreadyBlankAfter = (out.length >= 2 && /^\s*$/.test(out[out.length - 1]) && justPushed === '');
      if (!alreadyBlankAfter) out.push('');
    }

    // Add a blank line AFTER a list block if the next non-empty line is a paragraph/header.
    // This separates lists from lines like "Akreditasi: ..." and follow-up questions.
    if (line && isList && nextIsParagraph) {
      const last = out.length > 0 ? out[out.length - 1] : '';
      if (last && !/^\s*$/.test(last)) out.push('');
    }
  }

  text = out.join('\n');

  // Underscore markdown can collide with identifiers; only strip paired _word_ patterns.
  for (let i = 0; i < 2; i++) {
    text = text.replace(/___([^_\n]+)___/g, '$1');
    text = text.replace(/__([^_\n]+)__/g, '$1');
    text = text.replace(/_([^_\n]+)_/g, '$1');
  }

  // Remove any leftover markdown-only markers (keep '_' intact).
  text = text.replace(/[~`]/g, '');

  // Normalize spacing a bit
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  // Guardrail: strip meta phrases about sources (prevents user-facing mentions like
  // "berdasarkan dokumen" / "training data").
  const stripMetaSourcesEnabled = String(process.env.WHATSAPP_STRIP_META_SOURCES || 'true').toLowerCase() === 'true';
  if (stripMetaSourcesEnabled) {
    const before = text;
    const patterns = [
      // Most common leaked phrases (Indonesian)
      /\bberdasarkan\s+dokumen\s*[\/|]\s*training\s*data\s+yang\s+ada\b/gi,
      /\bberdasarkan\s+(?:dokumen|data\s*latih|training\s*data)(?:\s+yang\s+ada)?\b/gi,
      /\b(?:mengacu|merujuk)\s+(?:pada\s+)?(?:dokumen|data\s*latih|training\s*data)(?:\s+yang\s+ada)?\b/gi,
      // Always strip these exact meta terms (they should never reach end-users)
      /\btraining\s*data\b/gi,
      /\bdata\s*latih\b/gi
    ];

    for (const re of patterns) {
      text = text.replace(re, '');
    }

    // If we removed phrases, clean up punctuation/spacing artifacts.
    if (text !== before) {
      text = text
        .replace(/\(\s*\)/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/([,.;:!?])\s*(\n)/g, '$1$2')
        .replace(/^\s*[,.;:!?]+\s*/gm, '')
        .replace(/\n{3,}/g, '\n\n');
    }
  }

  // Guardrail: strip/rewrite extraction-sounding phrases
  // (contoh: "yang terbaca", "pada konteks") supaya jawaban tidak terlihat seperti RAG.
  const stripExtractionToneEnabled = String(process.env.WHATSAPP_STRIP_EXTRACTION_TONE || 'true').toLowerCase() === 'true';
  if (stripExtractionToneEnabled) {
    text = text
      .replace(/\bberikut\s+program\s*studi\s+yang\s+tercantum\b\s*:?/gi, 'Berikut program studi yang tersedia di ITB STIKOM Bali:')
      .replace(/\bprogram\s*studi\s+yang\s+terbaca\s+tersedia\b/gi, 'program studi yang tersedia')
      .replace(/\bberikut\s+program\s*studi\s+yang\s+terbaca\s+tersedia\b/gi, 'Berikut program studi yang tersedia')
      .replace(/\bberikut\s+program\s*studi\s+yang\s+terbaca\b/gi, 'Berikut program studi')
      .replace(/\byang\s+terbaca\b/gi, '')
      .replace(/\b(pada|dalam)\s+konteks\b\s*:?/gi, '')
        .replace(/\bAkreditasi:\s*akreditasi\s+tidak\s+tercantum\.?/gi, 'Akreditasi: tidak tercantum.')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/^\s*[,.;:!?]+\s*/gm, '');
  }

  // Ensure follow-up prompts start on a new paragraph for readability.
  // Common example: "Mau saya bantu cek juga ...".
  text = text.replace(/\n(?!\n)(Mau\s+saya\s+bantu\b)/gi, '\n\n$1');

  // Ensure there is a blank line AFTER a section header when it's immediately followed by a list.
  // Example: "S1 (Sarjana):\n- Sistem Informasi" -> "S1 (Sarjana):\n\n- Sistem Informasi"
  text = text.replace(/(^|\n)([A-Za-zÀ-ÿ0-9][^\n]{0,80}:)\n(?=\s*-\s)/g, '$1$2\n\n');

  // Final safeguard: if a header line (ending with ':') is immediately followed by a list
  // without an empty line, insert one. This is conservative and idempotent.
  text = text.replace(/(^|\n)([^\n]+:\n)(?!\n)(\s*-\s)/g, '$1$2\n$3');

  // Collapse excessive blank lines (3 or more) into exactly two for readability.
  text = text.replace(/\n{3,}/g, '\n\n');

  // DEBUG: inspect intermediate text state (remove after triage)
  // (debug log removed)

  // Remove trailing spaces again and collapse multiple blank lines at edges.
  text = text
    .split('\n')
    .map(l => String(l || '').replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');

  // Final pass: normalize encoding artifacts that can show up as weird symbols in WhatsApp.
  text = normalizeMojibakePunctuationForWhatsapp(text);

  return text.trim();
}

module.exports = {
  sanitizeWhatsappText,
  normalizeMojibakePunctuationForWhatsapp
};
