const fs = require('fs');

const p = 'src/routes/provider.js';
const s = fs.readFileSync(p, 'utf8');

const old =
  "  function parseFeeDetailChoice(rawText) {\r\n" +
  "    const t = String(rawText || '').trim().toLowerCase();\r\n" +
  "    if (!t) return null;";

const neu =
  "  function parseFeeDetailChoice(rawText) {\r\n" +
  "    const tRaw = String(rawText || '').trim().toLowerCase();\r\n" +
  "    if (!tRaw) return null;\r\n\r\n" +
  "    // Normalize tiny common variants so fee intent can be detected reliably.\r\n" +
  "    // Examples:\r\n" +
  "    // - \"biaya mendaftar\" -> treat as \"biaya daftar/pendaftaran\"\r\n" +
  "    const t = tRaw.replace(/\\bmendaftar\\b/g, 'daftar');";

if (!s.includes(old)) {
  console.error('[patch-provider-feeChoice] Pattern not found; aborting');
  process.exit(1);
}

const out = s.replace(old, neu);
fs.writeFileSync(p, out, 'utf8');
console.log('[patch-provider-feeChoice] patched');
