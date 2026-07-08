#!/usr/bin/env node

/**
 * Debug script to test the submenu numeric selection flow locally
 * without needing WhatsApp interaction
 */

const doubleDegreeSendMessage = `Selamat datang di Program Double Degree ITB STIKOM Bali

Silakan pilih informasi yang kamu butuhkan:

1) Double Degree - HELP University, Malaysia
2) Double Degree – Dalian Neusoft University of Information, China
3) Keunggulan Program
4) Cara Daftar`;

// Simulate the key functions from provider.js
function parseNumberedOptionsFromBotMessage(message) {
  const raw = String(message || '');
  if (!raw.trim()) return {};

  const lines = raw.split(/\r?\n/);
  const options = {};
  let current = null;

  for (const lineRaw of lines) {
    const line = String(lineRaw || '')
      .replace(/([0-9])\uFE0F?\u20E3/g, '$1')
      .trim();
    if (!line) continue;

    const m = line.match(/^\s*(\d{1,2})\s*[\)\.]\s*(.+)\s*$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) {
        current = n;
        options[current] = String(m[2] || '').trim();
      }
      continue;
    }

    const m2 = line.match(/^\s*(\d{1,2})\s*[:\-]\s*(.+)\s*$/);
    if (m2) {
      const n = parseInt(m2[1], 10);
      if (Number.isFinite(n)) {
        current = n;
        options[current] = String(m2[2] || '').trim();
      }
      continue;
    }

    const m3 = line.match(/^\s*(\d{1,2})\s+(.+)\s*$/);
    if (m3) {
      const n = parseInt(m3[1], 10);
      const rest = String(m3[2] || '').trim();
      if (Number.isFinite(n) && rest) {
        current = n;
        options[current] = rest;
      }
      continue;
    }

    if (current && options[current]) {
      if (/^(atau|or)\s*$/i.test(line)) continue;
      options[current] = `${options[current]} ${line}`.trim();
    }
  }

  return options;
}

function looksLikeNumericWelcomeMenu(message) {
  const raw = String(message || '');
  if (!raw.trim()) return false;

  const m = raw
    .replace(/([0-9])\uFE0F?\u20E3/g, '$1');

  const lines = m.split(/\r?\n/);
  const optionNums = [];
  let optionLines = 0;
  for (const l of lines) {
    const s = String(l || '');
    const mm = s.match(/^\s*(\d{1,2})\s*(?:[\)\.:\-])?\s+\S+/);
    if (mm) {
      optionLines += 1;
      const n = parseInt(mm[1], 10);
      if (Number.isFinite(n)) optionNums.push(n);
    }
  }
  const maxOption = optionNums.length ? Math.max(...optionNums) : 0;

  const hasInstruction = /(pilih|silakan|sila)\s+.*(angka|nomor)|ketik\s+angka|balas\s+angka/i.test(m);

  const isRoot = (optionLines >= 5) || (optionLines >= 4 && maxOption >= 5) || (optionLines >= 3 && hasInstruction && maxOption >= 5);
  
  console.log('\n[looksLikeNumericWelcomeMenu] Analysis:');
  console.log('  optionLines:', optionLines);
  console.log('  maxOption:', maxOption);
  console.log('  hasInstruction:', hasInstruction);
  console.log('  isRoot:', isRoot);
  console.log('  Preview:', raw.slice(0, 100).replace(/\n/g, ' '));
  
  return isRoot;
}

function buildNumberedPromptContext(message) {
  const raw = String(message || '');
  if (!raw.trim()) return null;

  const options = parseNumberedOptionsFromBotMessage(raw);
  const optionCount = options && typeof options === 'object' ? Object.keys(options).length : 0;
  if (optionCount < 2) return null;

  const isRootWelcomeMenu = looksLikeNumericWelcomeMenu(raw);
  
  console.log('\n[buildNumberedPromptContext] Result:');
  console.log('  optionCount:', optionCount);
  console.log('  isRootWelcomeMenu:', isRootWelcomeMenu);
  console.log('  Parsed options:', options);

  return {
    ts: new Date().toISOString(),
    text: raw,
    optionCount,
    isRootWelcomeMenu
  };
}

console.log('='.repeat(80));
console.log('DEBUG: DOUBLE DEGREE SUBMENU FLOW');
console.log('='.repeat(80));

console.log('\n1. BOT SENDS SUBMENU MESSAGE:');
console.log(doubleDegreeSendMessage);

console.log('\n2. BUILD CONTEXT FROM MESSAGE:');
const context = buildNumberedPromptContext(doubleDegreeSendMessage);

console.log('\n3. SHOULD CONTEXT BE SAVED TO SESSION?');
if (context && !context.isRootWelcomeMenu) {
  console.log('  ✅ YES - context.isRootWelcomeMenu =', context.isRootWelcomeMenu, '(not root)');
  console.log('  Action: SAVE to session.numberedPromptContext');
} else {
  console.log('  ❌ NO - context will NOT be saved');
  console.log('  Reason: isRootWelcomeMenu =', context?.isRootWelcomeMenu);
}

console.log('\n4. USER SENDS "1":');
const userInput = '1';
const selection = parseInt(userInput, 10);
console.log('  Selection:', selection);

if (context && !context.isRootWelcomeMenu) {
  const options = parseNumberedOptionsFromBotMessage(context.text);
  const chosen = options[selection];
  console.log('  Chosen option:', chosen);
  console.log('  ✅ GENERIC SUBMENU HANDLER should convert "1" → "' + chosen + '"');
} else {
  console.log('  ❌ GENERIC SUBMENU HANDLER skipped (not applicable)');
  console.log('  Action: Falls through to NUMERIC WELCOME-MENU handler');
}

console.log('\n' + '='.repeat(80));
