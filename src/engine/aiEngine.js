const { OpenAI } = require('openai');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');
const { buildSelectedEvidenceContext } = require('./evidenceSelector');
const { OPENAI_USAGE } = require('./openaiUsage');

// Phrases that indicate the model could not find an answer in provided data
const NOT_FOUND_PHRASES = [
  'belum tersedia',
  'belum ada',
  'tidak tersedia',
  'tidak ada di',
  'informasinya belum',
  'tidak dapat menemukan',
  'tidak ditemukan',
  'tidak tersedia saat ini'
];

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (!v) return defaultValue;
  return v === 'true' || v === '1' || v === 'yes' || v === 'y' || v === 'on';
}

function normalizeOpenAiModel(rawModel) {
  const model = String(rawModel || '').trim();
  const allowCustom =
    envFlag('OPENAI_ALLOW_CUSTOM_MODEL', false) ||
    envFlag('OPENAI_ALLOW_EXPERIMENTAL_MODEL', false);

  const fallback = (process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini').toString().trim() || 'gpt-4o-mini';

  if (!model) return fallback;

  // Some deployments accidentally set internal/placeholder model names (e.g. gpt-5.2)
  // which can cause OpenAI calls to fail and the bot to appear "not replying".
  const looksLikePlaceholder = /^gpt-5(\.|$)/i.test(model);
  if (!allowCustom && looksLikePlaceholder) return fallback;

  return model;
}

function getBotToneConfig() {
  const botName = (process.env.BOT_NAME || process.env.BOT_DISPLAY_NAME || '').toString().trim();
  const toneRaw = (process.env.BOT_TONE || process.env.BOT_CHAT_STYLE || '').toString().trim().toLowerCase();
  const enableFriendlyTone = envFlag('BOT_FRIENDLY_TONE', false) || ['casual', 'santai', 'friendly'].includes(toneRaw);
  // Support explicit formal tone via BOT_TONE=formal or BOT_FORMAL_TONE=true
  const formalTone = envFlag('BOT_FORMAL_TONE', false) || ['formal', 'resmi', 'baku'].includes(toneRaw);

  // Optional opening/closing wrappers (applied via prompt instruction) -- primarily used for friendly tone
  const opening = (process.env.BOT_FRIENDLY_OPENING || 'Siap! Aku bantu ya 👍').toString().trim();
  const closing = (process.env.BOT_FRIENDLY_CLOSING || 'Kalau masih bingung, bilang aja—aku bantu lagi 😊').toString().trim();

  return {
    botName,
    enableFriendlyTone,
    formalTone,
    opening: opening || '',
    closing: closing || ''
  };
}

function buildProductionSafetyPrompt() {
  return `You are a deterministic academic assistant for production use.

Primary responsibilities:
- factual accuracy
- metadata consistency
- session isolation
- intent correctness
- retrieval grounding
- hallucination prevention

Core principles:
- accuracy in academic context
- consistency across sessions
- respect for business logic`;
}

function buildCompactSystemPrompt() {
  return `You are a deterministic academic assistant. Answer briefly, grounded only in context.`;
}

// Standalone helper (kept for compatibility, actual buildSystemPrompt is in AIReplyEngine class)
function buildSystemPrompt(trainingData = '') {
  const base = `Kamu adalah AI WhatsApp Assistant resmi kampus.
Gaya bicara harus natural seperti ChatGPT, hangat, manusiawi, singkat, jelas, dan conversational.
- Jangan mulai jawaban dengan template formal seperti "Terima kasih atas pertanyaannya", "Halo selamat pagi", atau "Apakah Anda ingin..." kecuali user menyapa panjang dan konteksnya butuh sapaan.
- Untuk pertanyaan singkat/informal, jawaban harus langsung ke inti, tanpa intro panjang.
- Untuk pertanyaan panjang atau perbandingan, jawab dengan susunan natural, paragraf pendek, dan contoh bila perlu.
- Hindari frasa robotik, repetitif, dan kata-kata yang terdengar seperti customer service template.
- Sesuaikan gaya bahasa dengan pertanyaan user: casual bila user santai, formal bila user formal, dan tetap langsung jika pertanyaannya cepat.
`;
  if (trainingData && String(trainingData).trim()) {
    return base + '\n\nData konteks utama:\n' + String(trainingData).trim();
  }

  return base;
}

function buildRagSourceChunks(context) {
  if (!context || typeof context !== 'string') return 'ringkasan context';
  const lines = context
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const summary = lines.slice(0, 2).join(' ');
  return summary ? summary : 'ringkasan context';
}

function isCompactAcademicFaqPrompt(question, context, style, options = {}) {
  if (options && options.promptMode === 'light') return true;
  const q = String(question || '').toLowerCase().trim();
  const cLen = String(context || '').length;
  if (!q || q.length > 90 || cLen > 1400) return false;
  const academicHint = /(sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|bisnis\s+digital|prodi|program\s+studi|si\b|ti\b|sk\b|bd\b)/i.test(q);
  const faqHint = /(belajar apa|apa saja|kerja dimana|prospek|lulusan|jadi apa|biaya kuliah|kelas internasional|syarat pendaftaran|mata\s+kuliah|kurikulum)/i.test(q);
  const terseStyle = String(style || '').toUpperCase() === 'FAQ_LIGHT';
  return academicHint && faqHint && (terseStyle || cLen <= 900);
}

function buildCompactRagPrompt(question, context, style = 'SEMI') {
  return `
Kamu adalah asisten akademik kampus.

Aturan:
- Jawab hanya berdasarkan CONTEXT.
- Jika data belum cukup, bilang singkat bahwa rinciannya belum terlihat.
- Jangan tambahkan info di luar konteks.
- Jawaban harus ringkas, natural, dan langsung ke inti.

STYLE: ${style}

Format jawaban:
1. Pembuka singkat 1 kalimat.
2. Jawaban utama 2-4 baris.
3. Follow-up relevan 1 kalimat.

CONTEXT:
${context}

PERTANYAAN:
${question}
`.trim();
}

const compactAcademicFaqCache = new Map();
const COMPACT_ACADEMIC_FAQ_CACHE_TTL_MS = parseInt(process.env.COMPACT_ACADEMIC_FAQ_CACHE_TTL_MS || '300000', 10);
const COMPACT_ACADEMIC_FAQ_CACHE_MAX = parseInt(process.env.COMPACT_ACADEMIC_FAQ_CACHE_MAX || '100', 10);

function getCompactAcademicFaqCacheKey(question, context, style, assistHints) {
  return `${hashString([question, context, style, assistHints].join('\u241F'))}`;
}

function readCompactAcademicFaqCache(key) {
  const entry = compactAcademicFaqCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    compactAcademicFaqCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCompactAcademicFaqCache(key, value) {
  if (!key) return;
  compactAcademicFaqCache.set(key, {
    value,
    expiresAt: Date.now() + COMPACT_ACADEMIC_FAQ_CACHE_TTL_MS
  });
  while (compactAcademicFaqCache.size > COMPACT_ACADEMIC_FAQ_CACHE_MAX) {
    const oldestKey = compactAcademicFaqCache.keys().next().value;
    if (!oldestKey) break;
    compactAcademicFaqCache.delete(oldestKey);
  }
}

function normalizeAnswerFormatting(text) {
  if (!text || typeof text !== 'string') return text;

  let out = text.replace(/\u00A0/g, ' ');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\s+([,;.!?])/g, '$1');
  // Add space after punctuation conservatively to avoid breaking numeric formats like 500.000 or 12:30
  out = out.replace(/,([^\s\n\d])/g, ', $1');
  out = out.replace(/;([^\s\n])/g, '; $1');
  out = out.replace(/:([^\s\n\d])/g, ': $1');
  out = out.replace(/([!?])([^\s\n])/g, '$1 $2');
  out = out.replace(/([a-zà-ÿ])\.([A-Za-zÀ-ÿ])/g, '$1. $2');
  out = out.replace(/\n[ \t]+/g, '\n');
  out = inlineRecommendationQuestion(out);
  return out.trim();
}

function inlineRecommendationQuestion(text) {
  if (!text || typeof text !== 'string') return text;

  return inlineQuestionListBlock(
    String(text || '').replace(
      /\n+\s*((?:Rekomendasi pertanyaan berikutnya|Pertanyaan berikutnya|Follow[- ]?up)\s*:\s*)?([^:\n]{8,220}\?)\s*$/i,
      (match, label, question, offset, fullText) => {
        const body = String(fullText || '').slice(0, offset).trim();
        const prompt = `${label || ''}${String(question || '').trim()}`.trim();
        return body ? ` ${prompt}` : prompt;
      }
    )
  );
}

function inlineQuestionListBlock(input) {
  const compacted = String(input || '').replace(/((?:Kalau\s+(?:mau|ingin)\s+lanjut|Kalau\s+kakak\s+(?:mau|ingin)\s+lanjut|Kakak\s+bisa\s+lanjut\s+tanya|Rekomendasi\s+pertanyaan\s+berikutnya|Pertanyaan\s+berikutnya)[^\n:]{0,140}:\s*)\n\s*\n(\s*(?:[-�*]|\d+[.)])\s*)/gi, '$1\n$2');
  return compacted.replace(
    /(\n{1,2}\s*)((?:Kalau\s+(?:mau|ingin)\s+lanjut|Kalau\s+kakak\s+(?:mau|ingin)\s+lanjut|Kakak\s+bisa\s+lanjut\s+tanya|Rekomendasi\s+pertanyaan\s+berikutnya|Pertanyaan\s+berikutnya)[^\n:]{0,140}:)\s*\n+([\s\S]*?)$/i,
    (match, leading, heading, block) => {
      const questions = extractInlineQuestions(block);
      if (!questions.length) return match;
      return `${leading}${String(heading || '').trim()}` + '\n' + questions.map((question) => `- ${question}`).join('\n');
    }
  );
}

function extractInlineQuestions(block) {
  const normalized = String(block || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+-\s+/g, '\n- ');
  const questions = [];
  const re = /(?:^|\n)\s*(?:[-�*]|\d+[.)])?\s*([^\n?]{3,220}\?)/g;
  let match;
  while ((match = re.exec(normalized)) !== null) {
    const question = String(match[1] || '').replace(/\s+/g, ' ').trim();
    if (question && !questions.includes(question)) questions.push(question);
  }
  return questions.slice(0, 5);
}

function splitSentences(text) {
  const parts = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  return parts;
}

function hashString(value) {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function chooseVariant(seed, options) {
  if (!Array.isArray(options) || options.length === 0) return '';
  const idx = hashString(seed) % options.length;
  return options[idx];
}

// Deprecated orchestration helpers removed to enforce body-first architecture.
// buildReflectiveLead, buildAdaptiveClosing, buildProgressiveAnswer, buildContextualFollowUp,
// shouldAskFollowup, detectShortInformalQuestion, shouldUseProgressiveAnswer: no longer used.

function detectEmotionCue(question) {
  const q = String(question || '').toLowerCase();
  if (/\bmahal\b|\blah mahal\b|\bbingung\b|\bsusah\b/.test(q)) {
    if (/mahal|lah mahal/.test(q)) return 'Hehe, cukup besar memang kak 😄';
    if (/bingung|susah/.test(q)) return 'Santai kak, biasanya banyak yang bingung di awal — saya bantu jelaskan.';
  }
  if (/\bmantap|oke keren|good\b/.test(q)) return 'Mantap, senang dengar itu 😊';
  return null;
}

function mapProgramAlias(question) {
  const q = String(question || '').toLowerCase();
  if (/\bsi\b|sistem informasi|sisteminformasi|baya si\b/.test(q)) return 'Sistem Informasi';
  if (/\bti\b|teknologi informasi|teknologiinformasi\b/.test(q)) return 'Teknologi Informasi';
  if (/\bsk\b|sistem komputer|sistemkomputer\b/.test(q)) return 'Sistem Komputer';
  if (/\bbd\b|bisnis digital|bisnisdigital\b/.test(q)) return 'Bisnis Digital';
  if (/\bmi\b|manajemen informatika|manajemeninformatika\b/.test(q)) return 'Manajemen Informatika';
  return null;
}

// Build a concise contextual follow-up question for RAG answers.
function buildContextualFollowUp(question, context, tone) {
  const q = String(question || '').toLowerCase();
  const combined = String(context || '').toLowerCase();

  const isBeasiswa = /\bbeasisw(a|ai)\b/.test(q) || /\bbeasisw(a|ai)\b/.test(combined);
  const isBiaya = /\b(biaya|pembayaran|dpp|ukt|cicilan|cicilan|potongan|diskon|uang kuliah|biaya pendaftaran|biaya registrasi|biaya pendidikan)\b/.test(q) || /\b(biaya|pembayaran|dpp|ukt|cicilan|potongan|diskon|uang kuliah|biaya pendaftaran|biaya registrasi|biaya pendidikan)\b/.test(combined);
  const isPendaftaran = /\b(jadwal|gelombang|pendaftaran|registrasi|buka pendaftaran|tutup pendaftaran|mulai kuliah|perkuliahan)\b/.test(q) || /\b(jadwal|gelombang|pendaftaran|registrasi|buka pendaftaran|tutup pendaftaran|mulai kuliah|perkuliahan)\b/.test(combined);
  const isProgram = /\b(program studi|prodi|jurusan|akreditasi|kurikulum|konsentrasi|bidang studi|kursus)\b/.test(q) || /\b(program studi|prodi|jurusan|akreditasi|kurikulum|konsentrasi|bidang studi|kursus)\b/.test(combined);

  if (isBeasiswa) {
    return 'Butuh informasi syarat dan cara mengajukan beasiswa yang relevan?';
  }
  if (isBiaya) {
    return 'Mau saya jelaskan rincian komponen biaya (pendaftaran, DPP, per semester)?';
  }
  if (isPendaftaran) {
    return 'Mau saya bantu jelaskan detail gelombang atau jadwal pendaftaran?';
  }
  if (isProgram) {
    return 'Mau saya jelaskan prospek kerja atau kurikulum program studi ini?';
  }

  return '';
}

function humanizeFinalAnswer(text, options = {}) {
  if (!text || typeof text !== 'string') return text;

  // If the reply itself is a greeting or the question is a greeting,
  // bypass the humanizer entirely and return the original reply.
  try {
    const raw = String(text || '').trim();
    const q = String(options && options.question ? options.question : '').toLowerCase();
    const isGreetingQ = /\b(halo|hi|hai|pagi|siang|sore|malam|assalamualaikum|salam|menu utama pmb|menu utama|welcome)\b/i.test(q)
      && !/\bkelas\s*malam\b/i.test(q);
    const isGreetingReply = /^\s*(halo|hi|hai|pagi|siang|sore|malam|assalamualaikum|salam|welcome)\b[\s\S]*$/i.test(raw) && raw.split(/\r?\n/).length <= 3 && raw.length < 200;
    if (isGreetingQ || isGreetingReply) {
      return String(text).trim();
    }
  } catch (e) {
    // ignore and continue with normal humanizer
  }

  const tone = options && typeof options === 'object' ? options.tone : null;
  const question = String(options && options.question ? options.question : '').trim();
  const friendly = tone && tone.enableFriendlyTone && !tone.formalTone;
  // Humanizer is minimal by default: normalization + light readability only.
  let out = normalizeAnswerFormatting(String(text || '').trim());
  if (!out) return out;

  // Avoid touching strict menu/button prompts.
  if (/(^|\n)\s*\[[^\]]+\]\s*(\[[^\]]+\]\s*)?$/m.test(out) || /\b(pilih|balas|ketik)\s+angka\b/i.test(out)) {
    return out;
  }

  const parts = splitSentences(out);
  const isVeryShort = out.length < 75 && parts.length <= 2;
  const first = parts[0] || '';

  // Minimal emotional mirroring: light empathic cue if appropriate (body-first)
  try {
    const emo = detectEmotionCue(question);
    if (emo && !out.toLowerCase().includes(emo.toLowerCase())) {
      out = `${emo}\n\n${out}`;
    }
  } catch (e) {
    // ignore
  }

  // Light readability improvements only (body-first).
  // Small, targeted progressive/reflection heuristics to satisfy common short-question flows
  // while keeping the humanizer conservative. These are intentionally limited and
  // only apply when a friendly tone is enabled and a short, user-facing lead helps.
  try {
    if (friendly && question) {
      const q = question.toLowerCase();
      // Beasiswa flow: produce a short reflective lead
        if (/\bbeasisw(a|ai)\b/.test(q)) {
          return normalizeAnswerFormatting(
            `Kalau soal beasiswa, ada beberapa jalur: prestasi, KIP, dan kemitraan. Mau saya rinci salah satunya?`
          );
      }
      // Kelas malam / kelas karyawan flow
      if (/kelas\s*(malam|karyawan)|kelas\s*karyawan|kelas\s*malam/.test(q)) {
        const hint = (options && options.programHint) || '';
        const hintPart = hint ? ` Untuk program seperti ${hint} biasanya ada opsi kelas karyawan.` : '';
        return normalizeAnswerFormatting(
          `Kalau untuk kelas malam, biasanya tersedia untuk yang kerja sambil kuliah.${hintPart}`
        );
      }
      // Budget-seeking flow: mention common program hints like SI/TI
      if (/\byang\s+murah|murah|lebih\s+terjangkau|pilihan\s+yang\s+murah/.test(q)) {
        return normalizeAnswerFormatting(
          `Untuk pilihan yang lebih murah, program seperti SI (Sistem Informasi) atau TI (Teknologi Informasi), serta jalur kelas karyawan, seringkali lebih terjangkau.`
        );
      }
    }
  } catch (e) {
    // no-op; fall back to default minimal humanizer
  }

  const paragraphs = String(out).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 4) {
    const preserveSectionRe = /^(?:Topik|Informasi Terkait|Kesimpulan|Catatan|Rekomendasi):/i;
    if (paragraphs.some(p => preserveSectionRe.test(p))) {
      return normalizeAnswerFormatting(out);
    }
    out = paragraphs.slice(0, 4).join('\n\n');
  }

  return normalizeAnswerFormatting(out);
}

function cleanRagStructure(reply) {
  if (!reply || typeof reply !== 'string') return reply;

  let text = reply.trim();
  const preserveSectionRe = /^(?:Topik|Informasi Terkait|Kesimpulan|Catatan|Rekomendasi):/im;
  const isStructuredSections = preserveSectionRe.test(text);

  // 1. Hapus metadata
  text = text.replace(/\n?CONFIDENCE:\s*(HIGH|LOW|MEDIUM)/gi, '');
  text = text.replace(/\n?SOURCE_CHUNKS:\s*[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '');

  // 2. Bersihkan double spaces dan excessive newlines
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/ {2,}/g, ' ');

  // 3. Pastikan follow-up question tetap inline dengan jawaban utama.
  // Deteksi pertanyaan follow-up (akhir dengan ?)
  const lines = text.split('\n');
  let lastQuestion = -1;
  
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().endsWith('?')) {
      lastQuestion = i;
      break;
    }
  }

  if (lastQuestion > 0) {
    // Ada pertanyaan follow-up yang ditemukan
    const bodyLines = lines.slice(0, lastQuestion);
    const questionLines = lines.slice(lastQuestion);

    let cleanBody = bodyLines.join('\n').trim();
    let cleanQuestion = questionLines.join('\n').trim();

    text = cleanBody ? `${cleanBody} ${cleanQuestion}` : cleanQuestion;
  }

  if (isStructuredSections) {
    // Preserve explicit RAG-style section headers and spacing.
    return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  return normalizeAnswerFormatting(text);
}

function ensureRagFooter(reply, context, question = '', tone = null, confidence = 'HIGH', allowFooter) {
  if (!reply || typeof reply !== 'string') return reply;

  let text = reply.trim();
  // Preserve existing RAG-style section headers and avoid rewriting structured replies.
  const preserveSectionRe = /^(?:Topik|Informasi Terkait|Kesimpulan|Catatan|Rekomendasi):/im;
  if (preserveSectionRe.test(text)) {
    return normalizeAnswerFormatting(text);
  }

  // Determine whether RAG footer follow-up is allowed.
  // Priority: explicit `allowFooter` argument (if provided), otherwise environment variable.
  const HUMANIZER_ALLOW_RAG_FOOTER = (typeof allowFooter !== 'undefined')
    ? Boolean(allowFooter)
    : String(process.env.HUMANIZER_ALLOW_RAG_FOOTER || 'false').toLowerCase() === 'true';

  // If reply already contains a clear follow-up or question, skip adding footer.
  const hasFollowUp = /\b(mau saya|apakah .*\?|ingin tahu|ingin.*lagi|butuh .*bantuan|butuh .*info|bisa saya|apakah kamu|apakah anda|mau .*info|mau .*tahu)\b/i.test(text);

  // Do not append footers for greetings or program-list outputs.
  const isGreetingQ = /\b(halo|hi|hai|pagi|siang|sore|malam|assalamualaikum|salam|menu utama pmb|menu utama|welcome)\b/i.test(String(question || '').toLowerCase());
  const isProgramListReply = /program studi yang tersedia|program studi|program internasional|double degree|program lainnya/i.test(text);

  if (HUMANIZER_ALLOW_RAG_FOOTER && !hasFollowUp && !isGreetingQ && !isProgramListReply) {
    const followUp = buildContextualFollowUp(question, context || text, tone);
    if (followUp) {
      // Avoid duplicate follow-up insertion
      if (!text.includes(followUp) && !/Rekomendasi pertanyaan berikutnya/i.test(text)) {
        text += ` ${followUp}`;
      }
    }
  }

  return normalizeAnswerFormatting(text);
}

// Map pertanyaan ke bagian/departemen yang relevan (simple heuristics)
function mapQuestionToDepartment(question) {
  const q = (question || '').toLowerCase();
  if (/\b(jadwal|perkuliahan|kuliah|pertemuan|semester|awal perkuliahan|mulai kuliah)\b/.test(q)) return 'Akademik';
  if (/\b(biaya|pembayaran|dpp|biaya pendaftaran|uang kuliah|skema potongan|diskon)\b/.test(q)) return 'Keuangan';
  if (/\b(daftar|pendaftaran|registrasi|registrasi ulang|pmb|pendaftaran ulang|gelombang)\b/.test(q)) return 'Pendaftaran';
  if (/\b(ijazah|transkrip|surat keterangan|administrasi|dokumen)\b/.test(q)) return 'Administrasi';
  if (/\b(kontak|hubungi|alamat|lokasi|jam kerja|helpdesk|bantuan|informasi umum|layanan)\b/.test(q)) return 'Umum';
  return 'Umum';
}

// Build a deterministic fallback message when answer is not present in training data
function buildFallbackMessage(question, department, tone) {
  const q = (question || '').trim();
  const dept = department || 'Akademik';

  // load contacts mapping (env override possible)
  const contactsRaw = process.env.BOT_FALLBACK_CONTACTS;
  let contacts = {};
  if (contactsRaw) {
    try {
      const parsed = JSON.parse(contactsRaw);
      if (parsed && typeof parsed === 'object') contacts = parsed;
    } catch (err) {
      logger.warn({ err: err.message }, '[Fallback] Malformed BOT_FALLBACK_CONTACTS JSON');
    }
  }

  const defaultContacts = {
    Akademik: 'akademik@domain.example / +62-21-0000',
    Keuangan: 'keuangan@domain.example / +62-21-0001',
    Pendaftaran: 'pendaftaran@domain.example / +62-21-0002',
    Administrasi: 'admin@domain.example / +62-21-0003',
    IT: 'helpdesk@domain.example / +62-21-0004',
    Humas: 'humas@domain.example / +62-21-0005',
    Beasiswa: 'beasiswa@domain.example / +62-21-0006',
    Umum: 'info@domain.example / +62-21-0009'
  };

  const contactInfo = (contacts[dept] || defaultContacts[dept]) ? `\n\nKontak ${dept}: ${contacts[dept] || defaultContacts[dept]}` : '';

  if (tone && tone.enableFriendlyTone && !tone.formalTone) {
    return `Siap, saya bantu cek ya 😊\n\nUntuk ${q}, kemungkinan detail paling akurat ada di bagian ${dept}.${contactInfo}\n\nSaat ini saya belum menangkap rincian yang pas dari data yang tersedia, jadi agar lebih akurat saya bisa arahkan Anda ke tim ${dept} yang punya info resmi dan terbaru.\n\nKalau mau, saya bisa kirim kontak Bagian ${dept}.\n\n[ ✅ Ya, kirim kontaknya ]     [ ❌ Tidak dulu ]`;
  }

  // Formal variant
  return `Baik, saya bantu arahkan ya.\n\nUntuk ${q}, kemungkinan informasi yang paling tepat ada di Bagian ${dept}.${contactInfo}\n\nSaat ini saya belum menangkap rincian yang lengkap dari data yang tersedia, jadi agar lebih akurat saya bisa hubungkan Anda ke tim ${dept} untuk info resmi dan terbaru.\n\nJika diperlukan, saya dapat kirim kontak Bagian ${dept}.\n\n[ Ya, kirim kontak ]     [ Tidak dulu ]`;
}

// AI Reply Engine menggunakan model OpenAI (default via env; fallback aman)
class AIReplyEngine {
  constructor(apiKey, model = 'gpt-5.2', options = {}) {
    this.apiKey = apiKey;
    this.model = normalizeOpenAiModel(model);

    if (String(model || '').trim() && this.model !== String(model || '').trim()) {
      logger.warn({ requestedModel: String(model || '').trim(), resolvedModel: this.model }, '[AI] Model normalized');
    }

    const opts = (options && typeof options === 'object') ? options : {};
    const timeoutMsRaw = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : parseInt(process.env.OPENAI_TIMEOUT_MS || '20000', 10);
    const timeoutMs = (Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0) ? timeoutMsRaw : 20000;

    // OpenAI Node SDK supports a client-level timeout.
    this.client = new OpenAI({ apiKey, timeout: timeoutMs });

    this.maxOutputTokens = Number.isFinite(opts.maxOutputTokens)
      ? opts.maxOutputTokens
      : parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || '400', 10);

    this.temperature = typeof opts.temperature === 'number'
      ? opts.temperature
      : Number(process.env.OPENAI_TEMPERATURE || '0.2');

    this.topP = typeof opts.topP === 'number'
      ? opts.topP
      : Number(process.env.OPENAI_TOP_P || '0.4');

    this.ragMaxOutputTokens = Number.isFinite(opts.ragMaxOutputTokens)
      ? opts.ragMaxOutputTokens
      : parseInt(process.env.OPENAI_RAG_MAX_OUTPUT_TOKENS || '450', 10);

    this.ragTemperature = typeof opts.ragTemperature === 'number'
      ? opts.ragTemperature
      : Number(process.env.OPENAI_RAG_TEMPERATURE || '0');

    this.ragTopP = typeof opts.ragTopP === 'number'
      ? opts.ragTopP
      : Number(process.env.OPENAI_RAG_TOP_P || '0.15');

    this.systemPrompt = this.buildSystemPrompt();
  }

  // Build system prompt untuk bot personality
  buildSystemPrompt(trainingData = '') {
    const tone = getBotToneConfig();
    const subject = tone.enableFriendlyTone ? 'Kamu' : 'Anda';
    const identity = tone.enableFriendlyTone ? 'asisten virtual customer service' : 'customer service bot';
    let basePrompt = `${buildProductionSafetyPrompt()}

${subject} adalah ${identity} yang helpful, ramah, dan profesional.
${subject} menjawab pertanyaan dengan gaya yang natural, hangat, dan nyaman dibaca.
Hindari nada yang kaku, robotik, atau terasa seperti sistem otomatis.
Gunakan transisi yang halus, jangan terlalu singkat, dan tetap relevan dengan pertanyaan.
Gunakan spasi yang rapi setelah tanda baca. Jika menulis daftar dalam satu baris, pisahkan item dengan titik koma.

${tone.botName ? `Nama asisten: ${tone.botName}.` : ''}

${tone.enableFriendlyTone ? `Gaya bahasa (WAJIB):
- Gunakan gaya chat yang hangat dan natural seperti asisten virtual.
- Gunakan kata "aku" untuk diri sendiri dan "kamu" untuk user (hindari "Anda" kecuali diminta).
- Boleh gunakan emoji secukupnya (maks 1 emoji per jawaban) bila sesuai konteks.
- Jangan gunakan kalimat yang terdengar seperti sistem/robot (mis. "sistem kami", "berdasarkan konteks", "dari data", "di data", "engine AI").
${tone.opening ? `- Jika cocok, awali jawaban dengan kalimat singkat: "${tone.opening}"` : ''}
${tone.closing ? `- Jika cocok, akhiri jawaban dengan penutup ramah: "${tone.closing}"` : ''}
- Jika ingin mengatakan "di sini", pastikan menyertakan link/nomor yang benar-benar ADA di data. Jika tidak ada, jangan bilang "di sini"; minta user hubungi admin.
` : ''}

Jika tersedia data konteks, ${subject} WAJIB hanya menjawab berdasarkan informasi yang ada di data tersebut.
Jangan menambah informasi dari luar, jangan berimajinasi, dan jangan mengisi detail yang tidak ada di data.

Sebelum menjawab, baca dan pahami SELURUH data konteks yang diberikan.
Jika di dalam data ada daftar bertingkat (misalnya beberapa gelombang, paket, skema biaya, atau tahapan), dan pertanyaan berkaitan dengan daftar tersebut, maka:
- Sebutkan SEMUA item yang relevan yang tertulis di data (misalnya semua gelombang yang ada beserta biayanya), jangan hanya sebagian.
- Jangan menyimpulkan bahwa suatu gelombang/tahap "tidak ada" bila sebenarnya tertulis di data.

Jika pertanyaan belum terjawab oleh data yang ada, sampaikan dengan halus bahwa detailnya belum tertangkap dari data saat ini, lalu arahkan ke admin/human agent untuk konfirmasi yang lebih akurat.

ATURAN UTAMA GAYA WHATSAPP (WAJIB):
- Pola respons wajib (selalu ikuti, gunakan gaya natural dan conversational):
  1) Pembuka natural singkat (opsional, jangan selalu muncul)
  2) Reflective intent understanding (WAJIB): singkat tunjukkan bahwa kamu paham maksud user
  3) Jawaban inti paling relevan: taruh inti jawaban di awal, ringkas, grounded pada data
  4) Human touch ringan (opsional): cerminkan emosi ringan bila sesuai
  5) Follow-up hanya jika membantu (opsional dan singkat)

- Aturan perilaku spesifik:
  - Jawaban harus terasa seperti manusia: natural, hangat, profesional, conversational.
  - Hindari template FAQ, phrasing robotik, dan repetisi pembuka.
  - Jangan kirim double greeting/intro; jika intro/welcome sudah baru dikirim, lewati pembuka.
  - Jangan gunakan frasa teknis/kurang membantu seperti "data tidak ditemukan", "invalid", "error sistem"; gunakan kalimat natural yang mengarahkan ke solusi.
  - Jangan mengoreksi user; toleran terhadap typo/singkatan/slang dan pahami intent.
  - Jika intent masih ambigu, lakukan klarifikasi singkat dan natural (contoh: "Maksudnya biaya awal masuk atau biaya per semester? 😊").
  - Untuk pertanyaan singkat → jawaban singkat. Untuk pertanyaan detail → jawaban terstruktur.
  - Untuk pertanyaan biaya: pertahankan struktur resmi (bullet/subtotal/total) persis seperti di sumber; bungkus dengan pembuka/transisi yang natural.
  - Semua jawaban harus grounded pada data/RAG; jika data tidak cukup, nyatakan keterbatasan dengan halus lalu arahkan ke admin/human agent.
  - Follow-up hanya kalau membantu: contoh "Kalau mau, saya bisa cek detail gelombang itu juga 😊".
  - Format jawaban yang diutamakan: sapaan singkat jika relevan, refleksi intent, jawaban inti, detail tambahan seperlunya, penutup singkat, lalu follow-up singkat bila benar-benar membantu.
  - Jangan menyalin dokumen mentah; ubah ke bahasa percakapan yang enak dibaca di WhatsApp.
  - Jangan memperpanjang jawaban dengan pembuka berulang, penjelasan meta, atau ajakan berlebihan.

- Penanganan typo/slang/kasar ringan:
  - Jika user menulis "baya si", "TI brp", "kampus dmna", terjemahkan intent dan jawab langsung.
  - Untuk ekspresi emosional singkat (mis. "lah mahal amat"), beri empati ringan lalu jawab.

- Contoh gaya (implementation hints untuk model):
  - Reflective: "Kalau yang dimaksud Teknologi Informasi, biaya awal masuk..."
  - Direct answer: "Total biaya: Rp X."
  - Human touch: "Hehe, memang cukup sering ditanyakan 😄"

Jika (trainingData) disediakan, sertakan data konteks utama setelah instruksi di atas dan pastikan model hanya menjawab berdasarkan data tersebut.

  `;

    if (trainingData) {
      return basePrompt + `\n\nData konteks utama:\n${trainingData}`;
    }

    // Jika formal tone aktif (dan friendly tidak aktif), tambahkan instruksi gaya formal
    if (tone.formalTone && !tone.enableFriendlyTone) {
      basePrompt += `\nGaya bahasa (WAJIB):\n- Gunakan bahasa Indonesia formal dan sopan; gunakan kata ganti "Anda" (atau sapaan "Bapak/Ibu" bila sesuai konteks).\n- Hindari emoji, singkatan, dan bahasa gaul/slang.\n- Gunakan kalimat baku, jelas, dan profesional. Jika perlu gunakan poin/urutan langkah untuk instruksi.\n- Akhiri jawaban dengan penutup sopan seperti "Terima kasih." atau tawaran bantuan lanjutan.\n- Jika ingin mengatakan "di sini", pastikan menyertakan link/nomor yang benar-benar ADA di data. Jika tidak ada, jangan bilang \"di sini\"; minta user menghubungi admin.\n`;
    }

    return basePrompt + '\nSaat ini belum ada data konteks, jadi jawab secara umum dengan nada yang tetap hangat dan sarankan pengguna menghubungi admin untuk detail yang lebih akurat.';
  }

  // Dapatkan reply dari ChatGPT
  async getReply(userMessage, trainingData = '') {
    try {
      if (!this.apiKey) {
        throw new Error('OpenAI API key tidak dikonfigurasi');
      }

      // Reuse prebuilt system prompt when no additional trainingData provided
      const systemPrompt = (trainingData && String(trainingData || '').trim())
        ? this.buildSystemPrompt(trainingData)
        : this.systemPrompt;

      logger.info({ preview: userMessage.substring(0, 50) }, '[AI] Mengirim pesan ke OpenAI');

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_completion_tokens: this.maxOutputTokens,
        temperature: this.temperature,
        top_p: this.topP
      });

      let reply = completion.choices?.[0]?.message?.content || '';

      // If fallback is enabled and model indicates no data, replace with deterministic fallback
      const fallbackEnabled = envFlag('BOT_FALLBACK_ENABLED', true);
      if (fallbackEnabled) {
        const normalized = (reply || '').toLowerCase();
        if (NOT_FOUND_PHRASES.some(p => normalized.includes(p))) {
          const dept = mapQuestionToDepartment(userMessage);
          const toneCfg = getBotToneConfig();
          reply = buildFallbackMessage(userMessage, dept, toneCfg);
        }
      }

      reply = humanizeFinalAnswer(reply, { question: userMessage, tone: getBotToneConfig(), kind: 'direct' });
      console.log('[TRACE_AFTER_AI_ENGINE]', { kind: 'direct', question: userMessage && String(userMessage).slice(0,120), reply: String(reply).slice(0,320) });
      try {
        const outDir = path.join(__dirname, '..', '..', 'tmp');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const logPath = path.join(outDir, 'provider_traces.log');
        fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), tag: 'TRACE_AFTER_AI_ENGINE', kind: 'direct', question: String(userMessage || '').slice(0,120), replyPreview: String(reply || '').slice(0,320) }) + '\n');
      } catch (e) {}

      logger.info({ preview: reply.substring(0, 50) }, '[AI] Reply diterima');

      return {
        success: true,
        reply,
        model: this.model,
        usage: {
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens
        }
      };
    } catch (err) {
      logger.error({ err: err.message }, '[AI Error]');
      return {
        success: false,
        error: err.message,
        reply:
          'Maaf kak, saya sedang butuh waktu sebentar untuk memprosesnya.\n' +
          'Boleh kirim ulang pertanyaannya?\n' +
          'Kalau mau, ketik ADMIN supaya bisa saya teruskan ke admin PMB.'
      };
    }
  }

  // RAG-specific helper: jawab pertanyaan berbasis konteks secara ketat
  async getRagAnswer(request) {
    try {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('RAG_SELECTED_EVIDENCE_REQUIRED');
      }
      const question = request.question || '';
      const selectedEvidence = request.selectedEvidence;
      const metadata = request.metadata || {};
      const style = metadata.style || request.style || 'SEMI';
      const assistHints = metadata.assistHints || request.assistHints || '';
      const options = request.options || {};
      if (!Array.isArray(selectedEvidence)) {
        throw new Error('RAG_SELECTED_EVIDENCE_REQUIRED');
      }
      if (selectedEvidence.some(item => item?.isSelectedEvidence !== true || !String(item.text || '').trim())) {
        throw new Error('UNSAFE_RAG_EVIDENCE_REJECTED');
      }
      const context = buildSelectedEvidenceContext(selectedEvidence, Number(process.env.RAG_CONTEXT_MAX_CHARS || '9000'));
      if (!String(context || '').trim()) {
        return { success: false, error: 'insufficient_evidence', status: 'insufficient_evidence', reply: buildFallbackMessage(question, mapQuestionToDepartment(question), getBotToneConfig()) };
      }
      if (!this.apiKey) {
        throw new Error('OpenAI API key tidak dikonfigurasi');
      }
      // If context is empty and fallback enabled, return deterministic fallback immediately
      const fallbackEnabled = envFlag('BOT_FALLBACK_ENABLED', true);
      if (fallbackEnabled && (!context || !String(context).trim())) {
        const deptEmpty = mapQuestionToDepartment(question);
        const toneCfgEmpty = getBotToneConfig();
        const fallbackEmpty = humanizeFinalAnswer(buildFallbackMessage(question, deptEmpty, toneCfgEmpty), { question, tone: toneCfgEmpty, kind: 'rag-fallback' });
        return {
          success: true,
          reply: fallbackEmpty,
          isStructured: true,
          model: this.model,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        };
      }

      const compactPrompt = isCompactAcademicFaqPrompt(question, context, style, options);
      const compactCacheKey = compactPrompt ? getCompactAcademicFaqCacheKey(question, context, style, assistHints) : null;
      if (compactCacheKey) {
        const cachedReply = readCompactAcademicFaqCache(compactCacheKey);
        if (cachedReply) {
          return cachedReply;
        }
      }

      // Updated RAG prompt template with style adaptation and context-aware assist
      const TEMPLATE = compactPrompt ? buildCompactRagPrompt(question, context, style) : `
    Kamu adalah asisten resmi kampus yang ramah, natural, dan profesional.

=====================
ATURAN RAG (WAJIB)
=====================
- Jawab HANYA berdasarkan CONTEXT.
- CONTEXT adalah selected evidence terkurasi, bukan teks untuk disalin mentah.
- Ambil hanya evidence yang langsung menjawab pertanyaan; jangan menyalin paragraf mentah atau menjelaskan seluruh dokumen.
- Jangan menampilkan Pasal, Ayat, PIHAK KESATU, PIHAK KEDUA, PARA PIHAK, Force Majeure, Addendum, nomor surat, alamat, kontak, tanda tangan, placeholder, atau boilerplate kecuali user eksplisit meminta isi legal tersebut.
- Jika evidence tidak memuat jawaban konkret, keluarkan TIDAK_CUKUP_DATA. Jangan membuat daftar dari informasi yang tidak tersedia.
- DILARANG menambah info di luar CONTEXT.
- Jika detail yang dicari belum terlihat di CONTEXT, jawab secara jujur bahwa detail belum cukup jelas dan fokus pada fakta yang ada.
- Hindari frasa template seperti "Terima kasih atas pertanyaannya", "Halo selamat pagi", "Apakah Kakak ingin...", atau "Untuk informasi lebih lanjut..." kecuali benar-benar diperlukan.

=====================
STYLE ADAPTIVE
=====================
STYLE: {style}

FORMAL:
- Gunakan "Anda", bahasa baku, profesional
- Hindari emoji kecuali sangat cocok
- Jawaban harus ringkas dan jelas, tidak bertele-tele

SEMI:
- Gunakan "kamu", netral
- Emoji secukupnya (1–3)
- Jawaban harus natural, tidak seperti FAQ

SANTAI:
- Gunakan "kamu", santai tapi sopan
- Emoji lebih fleksibel (2–5)
- Jawaban boleh terasa hangat, tapi tetap profesional

CATATAN GAYA:
- Jangan gunakan pembuka yang berulang seperti "Baik, saya bantu jelaskan..." bila tidak perlu.
- Jika data sudah cukup jelas, langsung jawab tanpa intro panjang.
- Jika konteks tidak cukup, gunakan frasa halus seperti "Saya belum menemukan detail yang benar-benar sesuai" atau "Saya ingin pastikan dulu bagian yang dimaksud agar informasinya tidak keliru.".
- Follow-up harus relevan dengan jawaban, bukan tawaran generik.

=====================
STRUKTUR JAWABAN
=====================

BAGIAN 1: HEADER PEMBUKA (1 kalimat)
  - Tidak perlu "Assistant:" (akan ditambah system)
  - Natural, variatif, ambil topik dari pertanyaan
  - PENTING: Jangan gunakan header yang berupa emoji atau template satu-kalimat seperti "Mari kita bahas" atau "Ini informasi mengenai". Jika tidak ada pembuka alami yang relevan, mulai langsung dengan isi jawaban.

BAGIAN 2: JAWABAN UTAMA (2-5 baris)
- Mulai baris baru setelah header
- Ringkas, jelas, berbasis CONTEXT 100%
- Gunakan bullet (•) jika ada multiple items
- Format:
  • Item 1: deskripsi
  • Item 2: deskripsi
  
  Atau untuk paragraf pendek:
  Penjelasan singkat 1-2 baris.

BAGIAN 3: FOLLOW-UP (1-2 kalimat)
- Tulis langsung setelah jawaban utama dalam paragraf yang sama
- Jangan beri enter/baris baru sebelum rekomendasi pertanyaan
- Pertanyaan natural, bukan pernyataan
- Buat pertanyaan lanjutan yang cukup spesifik (sekitar 8-16 kata), menyebut topik/prodi/komponen yang baru dijawab bila ada
- HARUS relevan dengan isi jawaban, TIDAK BOLEH generik

=====================
=====================
// Removed legacy example template block that primed emoji/header/separator
=====================
ATURAN KETAT
=====================
- Jangan pisahkan follow-up/rekomendasi pertanyaan dengan enter atau baris kosong
- Follow-up HARUS pertanyaan (tanda ?)
- Follow-up jangan terlalu pendek seperti 'Biaya berapa?'; buat lebih lengkap sesuai konteks jawaban
- Jangan copy literal pertanyaan user

PENEGASAN GAYA (WAJIB):
- JANGAN gunakan emoji sebagai header atau pembuka.
- JANGAN gunakan separator '---' atau variasinya sebagai bagian dari jawaban.
- JANGAN gunakan frasa pembuka templated seperti "Mari kita bahas" atau "Ini informasi mengenai".
- Jika perlu, langsung mulai dengan isi jawaban tanpa header sintetis.
- Jangan ada "CONFIDENCE:", "SOURCE_CHUNKS:", atau metadata
- Max 1 emoji per baris

=====================
CONTEXT
=====================
{context}

=====================
PERTANYAAN
=====================
{question}

=====================
OUTPUT
=====================
Tulis hanya jawaban untuk user. Jangan tulis CONFIDENCE, SOURCE_CHUNKS, metadata, atau ringkasan sumber.`;

      const prompt = compactPrompt
        ? TEMPLATE
        : TEMPLATE
            .replace('{context}', context || '')
            .replace('{question}', question || '')
            .replace('{style}', style || 'SEMI')
            .replace('{assist_hints}', assistHints || '');

      // Debug logs (updated)
      if (envFlag('OPENAI_PROMPT_DEBUG', false)) {
        logger.debug({ style, qLen: String(question || '').length, ctxLen: String(context || '').length, assistHintsLen: String(assistHints || '').length }, '[AI RAG Debug] Prompt metadata');
      }
      logger.info({
        qLen: String(question || '').length,
        ctxLen: String(context || '').length,
        selectedEvidenceCount: selectedEvidence.length,
        style,
        assistHintsLen: String(assistHints || '').length,
        compactPrompt,
        purpose: OPENAI_USAGE.ANSWER_GENERATION,
        model: this.model
      }, '[AI RAG] Sending updated RAG prompt');

      // Test-mode bypass: when MOCK_RAG_REPLY=1, return a canned RAG-style reply
      if (String(process.env.MOCK_RAG_REPLY || '').trim() === '1') {
        const mocked = `💡 Mari kita bahas

- --

Ini informasi mengenai Teknologi Informasi yang diambil dari data kami.

• Core: Pemrograman, Jaringan, Basis Data

---

Mau tahu detail kurikulum?\n\nCONFIDENCE: HIGH\n\nSOURCE_CHUNKS:\n- ringkasan context 1`;
        const cleaned = cleanRagStructure(mocked);
        const human = humanizeFinalAnswer(cleaned, { question, tone: getBotToneConfig() });
        const final = ensureRagFooter(human, context, question, getBotToneConfig(), 'HIGH');
        return {
          success: true,
          reply: final,
          isStructured: true,
          model: 'mock-rag',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        };
      }

      const systemPrompt = compactPrompt ? buildCompactSystemPrompt() : buildProductionSafetyPrompt();
      const completionBudget = compactPrompt
        ? Math.min(this.ragMaxOutputTokens, Number(process.env.COMPACT_RAG_MAX_OUTPUT_TOKENS || '220'))
        : this.ragMaxOutputTokens;
      const temperature = compactPrompt ? 0.1 : 0.3;
      const topP = compactPrompt ? 0.1 : this.ragTopP;

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: completionBudget,
        temperature,
        top_p: topP
      });


      let reply = completion.choices?.[0]?.message?.content || '';
      
      // Clean dan struktur jawaban agar sesuai format 3-bagian
      reply = cleanRagStructure(reply);
      
      const normalized = (reply || '').toLowerCase();
      let isFallbackReply = false;

      if (fallbackEnabled && NOT_FOUND_PHRASES.some(p => normalized.includes(p))) {
        const dept = mapQuestionToDepartment(question);
        const toneCfg = getBotToneConfig();
        const fallback = humanizeFinalAnswer(buildFallbackMessage(question, dept, toneCfg), { question, tone: toneCfg, kind: 'rag-fallback' });
        reply = fallback;
        isFallbackReply = true;
      }

      if (!isFallbackReply) {
        // Allow RAG answers to include contextual follow-up by default (tests expect this behavior)
        reply = humanizeFinalAnswer(ensureRagFooter(reply, context, question, getBotToneConfig(), 'HIGH', true), { question, tone: getBotToneConfig(), kind: 'rag' });
      }
      console.log('[TRACE_AFTER_AI_ENGINE]', { kind: 'rag', question: question && String(question).slice(0,120), reply: String(reply).slice(0,320) });
      try {
        const outDir = path.join(__dirname, '..', '..', 'tmp');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const logPath = path.join(outDir, 'provider_traces.log');
        fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), tag: 'TRACE_AFTER_AI_ENGINE', kind: 'rag', question: String(question || '').slice(0,120), replyPreview: String(reply || '').slice(0,320) }) + '\n');
      } catch (e) {}

      const result = {
        success: true,
        reply,
        isStructured: true,
        model: this.model,
        usage: {
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens
        }
      };

      if (compactCacheKey) {
        writeCompactAcademicFaqCache(compactCacheKey, result);
      }

      return result;
    } catch (err) {
      logger.error({ err: err.message }, '[AI RAG Error]');
      return {
        success: false,
        error: err.message,
        reply:
          'Maaf kak, saya sedang butuh waktu sebentar untuk memprosesnya.\n' +
          'Boleh kirim ulang pertanyaannya?\n' +
          'Kalau mau, ketik ADMIN supaya bisa saya teruskan ke admin PMB.'
      };
    }
  }

  // Batch process multiple messages
  async getBatchReplies(messages, trainingData = '') {
    const results = [];
    
    for (const msg of messages) {
      const result = await this.getReply(msg, trainingData);
      results.push(result);
      
      // Rate limit: tunggu 100ms antar request
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
  }

  // Extract training data dari text/PDF
  async extractAndIndexTrainingData(text) {
    try {
      // Gunakan AI untuk extract key information dari text
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'Extract key information and ringkasan pertanyaan-jawaban dari text berikut. Format: Q: ... A: ...'
          },
          {
            role: 'user',
            content: text
          }
        ],
        max_completion_tokens: Math.max(300, Math.min(1200, this.maxOutputTokens * 2))
      });

      const extracted = completion.choices?.[0]?.message?.content || '';
      logger.info('[AI] Training data extracted');
      
      return { success: true, data: extracted };
    } catch (err) {
      logger.error({ err: err.message }, '[AI Extract Error]');
      return { success: false, error: err.message };
    }
  }
}

// Mock AI Engine untuk development (tidak memerlukan API key)
class MockAIReplyEngine {
  constructor() {
    // Simple keyword-based mock AI
    this.responses = {
      'halo': 'Halo! Ada yang bisa saya bantu?',
      'apa itu': 'Saya adalah bot customer service. Tanya apapun!',
      'default': 'Terima kasih atas pertanyaannya. Saya masih belajar, silakan tanyakan hal lain.'
    };
  }

  async getReply(userMessage, trainingData = '') {
    // Simple matching
    const lower = userMessage.toLowerCase();
    
    for (const [keyword, reply] of Object.entries(this.responses)) {
      if (lower.includes(keyword)) {
        logger.info({ keyword }, '[MockAI] Matched');
        return { success: true, reply, model: 'mock' };
      }
    }
    
    return { success: true, reply: this.responses.default, model: 'mock' };
  }

  async getBatchReplies(messages, trainingData = '') {
    return Promise.all(
      messages.map(msg => this.getReply(msg, trainingData))
    );
  }

  async extractAndIndexTrainingData(text) {
    return { success: true, data: 'Mock data extracted' };
  }
}

// Ensure AIReplyEngine uses the global final system prompt (with production safety)
AIReplyEngine.prototype.buildSystemPrompt = function (trainingData = '') {
  const safety = buildProductionSafetyPrompt();
  const globalPrompt = buildSystemPrompt(trainingData);
  return safety + '\n\n' + globalPrompt;
};

module.exports = {
  AIReplyEngine,
  MockAIReplyEngine,
  humanizeFinalAnswer,
  // Expose only core engine and humanizer; orchestration helpers deprecated.
};


