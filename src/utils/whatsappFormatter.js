// WhatsApp conversational reply formatter
// Responsible for wrapping raw answers into the unified WA personality
// without changing deterministic numeric content when requested.

const fs = require('fs');
const path = require('path');
function traceWhatsapp(tag, data) {
  try {
    const outDir = path.join(__dirname, '..', '..', 'tmp');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const p = path.join(outDir, 'final_wa_outputs.log');
    fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), tag, data }) + '\n');
  } catch (e) {}
}

function isAmbiguousProgramList(text) {
  // Detect if text contains multiple program abbreviations/names separated by comma, /, -, or 'dan'
  // Examples: "SI, TI dan BD", "SI/TI/BD", "SI - TI - BD", "SI dan TI"
  const abbrevPattern = /\b(si|ti|bd|sk|mi)\b/gi;
  const fullNamePattern = /\b(sistem informasi|teknologi informasi|bisnis digital|sistem komputer|manajemen informatika)\b/gi;
  const separatorPattern = /\s*(?:,|\s+dan\s+|\s*\/\s*|\s*-\s*)\s*/i;
  
  // Count all program mentions (both abbrev and full name)
  const abbrevMatches = (text.match(abbrevPattern) || []).length;
  const fullNameMatches = (text.match(fullNamePattern) || []).length;
  const totalMentions = abbrevMatches + fullNameMatches;
  
  // If text contains multiple program references with separators, it's a list
  if (totalMentions > 1 && separatorPattern.test(text)) {
    return true;
  }
  
  return false;
}

function mapProgramAlias(question) {
  if (!question) return null;
  const q = String(question).toLowerCase();
  
  // Check if this looks like a list of programs (ambiguous context)
  if (isAmbiguousProgramList(q)) {
    console.log('[TRACE_MAP_PROGRAM_ALIAS]', { inputText: question, normalizedQuery: q, matchedPattern: 'AMBIGUOUS_LIST', alias: null, reason: 'multiple programs detected' });
    return null;
  }
  
  let alias = null;
  let matchedPattern = null;

  if (/\b(si|sistem informasi)\b/.test(q)) {
    alias = 'Sistem Informasi';
    matchedPattern = '\\b(si|sistem informasi)\\b';
  } else if (/\b(ti|teknologi informasi)\b/.test(q)) {
    alias = 'Teknologi Informasi';
    matchedPattern = '\\b(ti|teknologi informasi)\\b';
  } else if (/\b(bd|bisnis digital)\b/.test(q)) {
    alias = 'Bisnis Digital';
    matchedPattern = '\\b(bd|bisnis digital)\\b';
  } else if (/\b(sk|sistem komputer)\b/.test(q)) {
    alias = 'Sistem Komputer';
    matchedPattern = '\\b(sk|sistem komputer)\\b';
  } else if (/\b(mi|manajemen informatika)\b/.test(q)) {
    alias = 'Manajemen Informatika';
    matchedPattern = '\\b(mi|manajemen informatika)\\b';
  }

  console.log('[TRACE_MAP_PROGRAM_ALIAS]', { inputText: question, normalizedQuery: q, matchedPattern, alias });
  return alias;
}

function mapProviderIntentToFormatter(intent) {
  if (!intent) return null;
  const normalized = String(intent || '').trim().toUpperCase();
  const lowered = String(intent || '').trim().toLowerCase();
  if (lowered === 'rag-greeting') return 'greeting';
  if (lowered === 'rag-pmb-info') return 'pmb';
  if (lowered === 'rag-program-profile') return 'program_definition';
  if (lowered === 'rag-fee-structured') return 'biaya';
  switch (normalized) {
    case 'COST': return 'biaya';
    case 'SCHOLARSHIP': return 'beasiswa';
    case 'ACADEMIC_PROGRAM': return 'program_studi';
    case 'PROGRAM_DEFINITION': return 'program_definition';
    case 'GENERAL': return 'general';
    default: return String(intent || '').toLowerCase();
  }
}

function extractGelombang(question) {
  if (!question) return null;
  const m = String(question).match(/gelombang\s*[:\-\s]*([ivx0-9]+)/i);
  if (m && m[1]) return m[1].toUpperCase();
  const m2 = String(question).match(/\b(gel\.|gbg|gelombang)\s*([ivx0-9]+)/i);
  if (m2 && m2[2]) return m2[2].toUpperCase();
  return null;
}

function chooseGreeting(question) {
  const q = String(question).trim().toLowerCase();
  if (/^(halo|hallo|hi|hai|hey)\b/.test(q)) return 'Halo kak 👋';
  return 'Baik kak, saya bantu jelaskan.';
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isGreetingQuestion(question) {
  const q = String(question || '').trim().toLowerCase();
  if (!q) return false;
  const cleaned = q.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(halo|hallo|hi|hai|hey|assalamualaikum|salam|selamat pagi|selamat siang|selamat sore|selamat malam|met pagi|met siang|met sore|met malam)\b/i.test(cleaned)
    || /^(pagi|siang|sore|malam|mlm|malem|pgi|pg|siank)\b/i.test(cleaned);
}

function isProgramOverviewQuestion(question) {
  const q = String(question || '').trim().toLowerCase();
  if (!q) return false;
  const patterns = [
    /program studi apa saja/, /daftar program studi/, /list program studi/, /jenis program studi/, /program studi yang tersedia/, /program studi yang ada/, /program yang tersedia/, /kampus ini punya program apa saja/,
    /prodi apa saja/, /jurusan apa saja/, /apa saja prodi/, /apa saja jurusan/, /ada prodi/, /ada program studi/
  ];
  if (patterns.some((re) => re.test(q))) return true;
  return /\b(program studi|prodi|jurusan)\b/.test(q) && /\b(apa saja|daftar|list|jenis|yang tersedia|yang ada|ada)\b/.test(q);
}

function inferQuestionTopic(userQuery, mainAnswer) {
  const program = mapProgramAlias(userQuery) || extractProgramFromText(mainAnswer);
  if (program) return `Program Studi ${program}`;

  const normalizedQuery = String(userQuery || '').trim().toLowerCase();
  const normalizedAnswer = String(mainAnswer || '').trim().toLowerCase();
  const queryIntent = detectIntentFromQuery(userQuery);
  const answerIntent = detectIntentFromAnswerFromText(mainAnswer);

  if (queryIntent === 'lokasi' || answerIntent === 'lokasi' ||
      /\b(lokasi|alamat|berlokasi|kampus|denpasar|cabang|di\s+mana|dimana)\b/i.test(normalizedQuery) ||
      /\b(lokasi|alamat|berlokasi|kampus|denpasar|cabang)\b/i.test(normalizedAnswer)) {
    return 'Lokasi kampus';
  }

  if (queryIntent === 'ukm' || answerIntent === 'ukm' ||
      /\b(ukm|ormawa|organisasi mahasiswa|unit kegiatan|athena esports|esport|esports|musik|futsal|basket|teater biner|vos)\b/i.test(normalizedQuery) ||
      /\b(ukm|ormawa|organisasi mahasiswa|unit kegiatan|athena esports|esport|esports|musik|futsal|basket|teater biner|vos)\b/i.test(normalizedAnswer)) {
    return 'UKM dan Ormawa';
  }

  if (queryIntent === 'biaya' || answerIntent === 'biaya' ||
      /\b(biaya|dpp|ukt|cicilan|cicil|fee|harga|total biaya|biaya kuliah)\b/i.test(normalizedQuery) ||
      /\b(biaya|dpp|ukt|cicilan|cicil|fee|harga|total biaya|biaya kuliah)\b/i.test(normalizedAnswer)) {
    return 'Biaya kuliah';
  }

  if (/(akreditasi|ban-pt|sk akreditasi)/i.test(normalizedQuery)) return 'Akreditasi';
  if (/(kurikulum|mata kuliah|materi|dipelajari|silabus|perkuliahan)/i.test(normalizedQuery)) return 'Kurikulum dan mata kuliah';
  if (/(prospek kerja|karir|pekerjaan|job prospects|lulusan bekerja|lowongan)/i.test(normalizedQuery)) return 'Prospek kerja';
  if (/(beasiswa|scholarship|grant|bantuan pendidikan)/i.test(normalizedQuery)) return 'Beasiswa';
  if (/(jadwal|deadline|tanggal|gelombang|pendaftaran|daftar)/i.test(normalizedQuery)) return 'Pendaftaran';
  if (/(bedanya|perbedaan|versus|vs|dibandingkan)/i.test(normalizedQuery)) return 'Perbandingan program studi';

  const fallback = String(userQuery || '').split(/[?.!]/)[0].trim();
  return fallback ? fallback : 'Topik pertanyaan';
}

function removeConclusionSection(text) {
  if (!text) return '';
  const marker = /(?:\b(?:Kesimpulannya|Ringkasnya|Singkatnya|Intinya|Jadi|Summary|Simpulannya)\b[:\-]?)/i;
  const idx = text.search(marker);
  if (idx >= 0) {
    return normalizeWhitespace(text.slice(0, idx));
  }
  return normalizeWhitespace(text);
}

function formatSuggestionSection(suggestions) {
  if (!suggestions) {
    return [
      'Informasi terkait yang mungkin membantu:',
      '- simulasi cicilan',
      '- cek beasiswa',
      '- bandingkan dengan prodi lain',
      '- cek jadwal pendaftaran'
    ].join('\n');
  }

  if (Array.isArray(suggestions)) {
    return ['Rekomendasi pertanyaan berikutnya:', ...suggestions.map(item => `- ${String(item).trim()}`)].join('\n');
  }

  return String(suggestions || '').trim();
}

function removeEmoji(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\p{Extended_Pictographic}]/gu, '')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .trim();
}

function extractProgramOverviewItems(text) {
  if (!text) return [];
  const lines = String(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const items = [];
  for (const line of lines) {
    const cleaned = line.replace(/^[-*•◦\d\.\)\s]+/, '').trim();
    if (!cleaned) continue;
    if (/^program studi yang tersedia[:\s]*$/i.test(line)) continue;
    if (/^program studi[:\s]*$/i.test(line)) continue;
    if (/^prodi[:\s]*$/i.test(line)) continue;
    items.push(cleaned);
  }

  return items;
}

function orderProgramOverviewLines(lines) {
  const priority = {
    's2': 0,
    's1': 1,
    'd3': 2,
    'double degree': 3,
    'international class': 4
  };

  return lines.slice().sort((a, b) => {
    const keyA = Object.keys(priority).find(k => a.toLowerCase().includes(k)) || 'zzz';
    const keyB = Object.keys(priority).find(k => b.toLowerCase().includes(k)) || 'zzz';
    if (keyA !== keyB) return priority[keyA] - priority[keyB];
    return a.localeCompare(b, 'id', { sensitivity: 'base' });
  });
}

function stripProgramOverviewHeading(text) {
  if (!text) return text;
  return String(text)
    .replace(/^(?:Program Studi yang tersedia|Program Studi|Daftar program studi|Daftar prodi|Prodi|Program yang tersedia)[:\s]*\n*/i, '')
    .trim();
}

function isPureProgramOverviewResponse(text) {
  if (!text) return false;
  const normalized = normalizeWhitespace(text);
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  const contentLines = lines.filter((line) => !/^program studi(?: yang tersedia)?[:\s]*$/i.test(line)
    && !/^prodi[:\s]*$/i.test(line)
    && !/^daftar program studi[:\s]*$/i.test(line)
    && !/^jenis program studi[:\s]*$/i.test(line));
  if (contentLines.length < 2) return false;

  const hasSentenceLine = contentLines.some((line) => /[.?!]/.test(line) && line.split(/\s+/).length > 8);
  if (hasSentenceLine) return false;

  return contentLines.every((line) => /^[-*•◦\d\.\)\s]+/.test(line) || line.split(/\s+/).length <= 10);
}

function formatProgramOverviewResponse(rawText) {
  const normalized = normalizeWhatsappReply(String(rawText || ''));
  const items = extractProgramOverviewItems(normalized);
  const hasHeading = /^program studi|^prodi|^daftar program studi|^jenis program studi/i.test(normalized.trim());
  if (!items.length) {
    return normalized;
  }

  const unique = Array.from(new Set(items));
  const formattedItems = unique.map(item => item.startsWith('- ') ? item : `- ${item}`);
  if (hasHeading) {
    return normalized;
  }

  return ['Program studi yang tersedia:', '', ...formattedItems].join('\n');
}

function formatRelatedInfoSection(suggestions) {
  if (!suggestions) return '';

  let lines = [];
  if (Array.isArray(suggestions)) {
    lines = suggestions.map(item => String(item || '').trim()).filter(Boolean);
  } else {
    lines = String(suggestions)
      .split('\n')
      .map(line => String(line || '').trim())
      .filter(Boolean);
  }

  const cleaned = lines
    .map(line => line.replace(/^(Rekomendasi pertanyaan berikutnya[:\s]*|Rekomendasi pertanyaan[:\s]*|Apakah\s+Kakak\s+ingin\s+dijelaskan[^\n]*\?|Balas\s*:\s*|Silakan\s+diketikkkan|Coba\s+tanya)/i, '').trim())
    .map(line => line.replace(/^[\-*•◦\s]*/, '').trim())
    .filter(Boolean);

  if (!cleaned.length) return '';

  const top = cleaned.slice(0, 2);
  return ['Informasi Terkait:', ...top.map(line => `- ${line}`)].join('\n');
}

function isStructuredWhatsappAnswer(text) {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;
  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  const bulletLines = lines.filter(line => /^[-*•◦\d\.\)]\s+/.test(line));
  if (bulletLines.length >= Math.ceil(lines.length / 2)) return true;
  if (/\b(perbandingan\s+singkat|perbandingan\s+cepat|beasiswa\b|kip\b|1k1s\b|prestasi\b|yayasan\b|jadwal\b|gelombang\b|pendaftaran\b|daftar\b|akreditasi\b|biaya\b|dpp\b|ukt\b|cicilan\b)\b/i.test(normalized) && bulletLines.length > 0) {
    return true;
  }
  return false;
}

function buildStructuredWhatsappReply({ body, userQuery, suggestions }) {
  const normalizedBody = normalizeWhitespace(String(body || ''));
  if (!normalizedBody) return '';

  const intent = detectIntentFromAnswer(normalizedBody, userQuery);
  const program = mapProgramAlias(userQuery) || extractProgramFromText(normalizedBody);
  const greeting = chooseGreeting(userQuery);
  const topic = inferQuestionTopic(userQuery, normalizedBody) || 'Topik pertanyaan';
  const topikLine = `Topik: ${topic}`;

  let relatedInfo = '';
  if (suggestions) {
    relatedInfo = formatRelatedInfoSection(suggestions);
  }
  if (!relatedInfo) {
    relatedInfo = formatRelatedInfoSection(suggestionsForIntent(intent, program));
  }

  let conclusion = inferConclusion(normalizedBody, userQuery).trim();
  if (!conclusion) {
    conclusion = deriveConclusionSentence(normalizedBody, program, intent);
  }
  if (!conclusion) {
    conclusion = 'Kesimpulannya, informasi penting sudah dijelaskan di atas.';
  }

  const parts = [greeting, topikLine, '', normalizedBody];
  if (relatedInfo) parts.push('', relatedInfo);
  parts.push('', `Kesimpulan: ${conclusion}`);

  return normalizeWhatsappReply(parts.join('\n'));
}

function shouldIncludeConclusion(body, conclusion) {
  if (!body || !conclusion) return false;
  const normalizedBody = String(body || '').replace(/\s+/g, ' ').trim();
  const normalizedConclusion = String(conclusion || '').replace(/\s+/g, ' ').trim();
  if (!normalizedBody || !normalizedConclusion) return false;
  const lowerBody = normalizedBody.toLowerCase();
  const lowerConclusion = normalizedConclusion.toLowerCase();
  if (lowerBody === lowerConclusion) return false;
  if (lowerBody.includes(lowerConclusion)) return false;
  const sentences = normalizedBody.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length > 1) return true;
  // Only add a conclusion automatically for reasonably long answers
  if (normalizedBody.length >= 200) return true;
  return false;
}

function inferAssumptionLine(userQuery) {
  const text = String(userQuery || '').trim();
  if (!text) return 'Saya memahami kakak sedang menanyakan sesuatu seputar STIKOM Bali.';

  // More specific acknowledgement for queries about what is learned
  const learnPattern = /\b(belajar|apa yang dipelajari|apa saja|mata kuliah)\b/i;
  const programAlias = mapProgramAlias(text);
  if (learnPattern.test(text) && programAlias === 'Teknologi Informasi') {
    return 'Saya memahami kakak ingin mengetahui materi dan mata kuliah yang dipelajari di Program Studi Teknologi Informasi.';
  }

  const normalized = text.toLowerCase();
  const program = mapProgramAlias(text);
  const gelombang = extractGelombang(text);
  const topic = (() => {
    if (/(biaya|dpp|ukt|pendaftaran|gelombang|cicil|cicilan|rincian|total)/i.test(normalized)) return 'biaya kuliah';
    if (/(akreditasi|ban-pt|sk akreditasi|status akreditasi)/i.test(normalized)) return 'akreditasi';
    if (/(kurikulum|mata kuliah|dipelajari|materi|perkuliahan|silabus|modul)/i.test(normalized)) return 'kurikulum dan mata kuliah';
    if (/(prospek kerja|karir|pekerjaan|peluang kerja)/i.test(normalized)) return 'prospek kerja';
    if (/(pendaftaran|daftar|dibuka|jadwal pendaftaran|tutup pendaftaran|gelombang)/i.test(normalized)) return 'pendaftaran';
    if (/(beasiswa|potongan|diskon|kredit sekolah)/i.test(normalized)) return 'beasiswa atau potongan biaya';
    if (/(fasilitas|lab|ruangan|perpustakaan|asrama|wifi)/i.test(normalized)) return 'fasilitas kampus';
    if (/(bedanya|perbedaan|beda antara|vs|versus)/i.test(normalized)) return 'perbandingan prodi';
    if (/(coding|pemrograman|programming|software development|developer)/i.test(normalized)) return 'kegiatan coding';
    if (/(apa itu|tentang|mengenai|sebutkan|jelaskan)/i.test(normalized)) return 'program studi';
    return '';
  })();

  const programText = program ? ` Program Studi ${program}` : '';
  const waveText = gelombang ? ` gelombang ${gelombang}` : '';
  const questionVerb = /^(apa|apa yang|mengapa|kenapa|bagaimana|jelaskan|terangkan)/i.test(normalized) ? 'menanyakan' : 'mencari informasi';

  if (topic) {
    if (topic === 'program studi' && program) {
      return `Saya memahami kakak sedang menanyakan tentang Program Studi ${program}.`;
    }
    if (program) {
      return `Saya memahami kakak sedang ${questionVerb} ${topic} untuk${programText}.${waveText}`.replace(/\s+/g, ' ').trim();
    }
    return `Saya memahami kakak sedang ${questionVerb} ${topic}.${waveText}`.trim();
  }

  if (program) {
    return `Saya memahami kakak sedang menanyakan tentang${programText}.${waveText}`.replace(/\s+/g, ' ').trim();
  }

  const fallbackTopic = (() => {
    const fallbackMatch = text.match(/apa itu\s+([^?]+)|apa yang dipelajari di\s+([^?]+)|apa bedanya\s+([^?]+)\s+(?:dengan|dan)\s+([^?]+)/i);
    if (fallbackMatch) {
      return (fallbackMatch[1] || fallbackMatch[2] || fallbackMatch[3] || fallbackMatch[4] || '').trim();
    }
    return text.split(/[?.!]/)[0].trim();
  })();

  return `Saya memahami kakak sedang menanyakan tentang ${fallbackTopic}.`;
}

function getBulletSummary(normalized) {
  const bulletLines = normalized.split('\n')
    .map(l => l.trim())
    .filter(l => /^[-*•◦]/.test(l))
    .map(l => l.replace(/^[-*•◦]\s*/, '').replace(/[.?!]+$/, ''))
    .filter(l => {
      const low = l.toLowerCase();
      // exclude obvious follow-up/recommendation bullets
      if (/^(mau\b|apakah\b|rekomendasi\b|balas\b|silakan\b|butuh\b)/i.test(low)) return false;
      if (/mau info|cek jadwal|biaya/i.test(low)) return false;
      return true;
    });

  if (!bulletLines.length) return '';
  if (bulletLines.length === 1) return bulletLines[0];
  if (bulletLines.length === 2) return `${bulletLines[0]} dan ${bulletLines[1]}`;
  return `${bulletLines.slice(0, -1).join(', ')}, dan ${bulletLines.slice(-1)}`;
}

function removeFollowupSections(text) {
  if (!text) return '';
  // cut off at common follow-up markers so they don't pollute the conclusion
  const cutRegex = /(?:Rekomendasi pertanyaan berikutnya[:\s]*|Rekomendasi pertanyaan[:\s]*|Apakah\b|Apakah Kakak ingin|Balas(?:\s+saja)?\s*:\s*|Silakan diketikkan|Butuh informasi|Catatan:|Catatan\s*[:\-]|Mau\s+tahu\b|Mau\s+info\b|Ingin\s+tahu\b|Coba\s+tanya\b)/i;
  const idx = text.search(cutRegex);
  if (idx >= 0) return text.slice(0, idx).trim();
  return text;
}

function looksLikeFollowUpQuestion(text) {
  if (!text) return false;
  const t = String(text || '').trim();
  if (!t || !/[?]$/.test(t)) return false;
  return /^(apa|apakah|bagaimana|kenapa|mengapa|bolehkah|mau tahu|ingin tahu|coba|tolong|sebutkan|jelaskan|berapa)\b/i.test(t);
}

function extractTrailingFollowUpQuestions(text) {
  if (!text) return { body: '', suggestions: [] };
  const normalized = normalizeWhitespace(text);
  const lines = normalized.split('\n').map((line) => String(line || '').trim()).filter(Boolean);
  const suggestions = [];

  while (lines.length) {
    const lastLine = lines[lines.length - 1];
    if (looksLikeFollowUpQuestion(lastLine)) {
      suggestions.unshift(lastLine.replace(/^[-*•\s]*/, '').trim());
      lines.pop();
      continue;
    }
    break;
  }

  if (suggestions.length) {
    return { body: lines.join('\n'), suggestions };
  }

  const trailingQuestionMatch = normalized.match(/([^.?!]+[.?!])\s*(apa\b[\s\S]+\?)$/i);
  if (trailingQuestionMatch) {
    const body = normalizeWhitespace(trailingQuestionMatch[1] || '');
    const followUp = normalizeWhitespace(trailingQuestionMatch[2] || '');
    if (looksLikeFollowUpQuestion(followUp)) {
      return { body, suggestions: [followUp] };
    }
  }

  return { body: normalized, suggestions: [] };
}

function extractProgramFromText(text) {
  if (!text) return null;
  console.log('[TRACE_EXTRACT_PROGRAM_INPUT]', { inputText: text });

  const byAlias = mapProgramAlias(text);
  // Match "Program Studi <program-name>" — stop at punctuation, common conjunctions, or line break
  const regexMatch = String(text).match(/Program Studi\s+([A-Za-z\s]+?)(?:\s+(?:memiliki|menawarkan|adalah|dengan|dan|atau|,|\.|\n|$))/i);
  const regexProgram = (regexMatch && regexMatch[1]) ? String(regexMatch[1]).trim() : null;

  console.log('[TRACE_PROGRAM_ALIAS_IN_EXTRACT]', { inputText: text, byAlias, regexProgram });
  console.log('[TRACE_PROGRAM_REGEX_MATCH]', { inputText: text, regexProgram });

  // Prioritize explicit regex "Program Studi ..." over alias
  const result = regexProgram || byAlias || null;
  console.log('[TRACE_EXTRACT_PROGRAM_RESULT]', { result });
  return result;
}

function splitAnswerAndSuggestions(rawText) {
  const normalized = normalizeWhitespace(String(rawText || ''));
  if (!normalized) return { mainAnswer: '', suggestions: undefined };

  const markerRegex = /(?:^|\n)\s*(Rekomendasi pertanyaan berikutnya[:\s]*|Rekomendasi pertanyaan[:\s]*|Apakah\s+Kakak\s+ingin\s+dijelaskan[^\n]*\?|Balas(?:\s+saja)?\s*:\s*|Silakan\s+diketikkan|Butuh\s+informasi|Coba\s+tanya|Mau\b|Mau\s+info\b|Mau\s+saya\s+jelaskan\b)/i;
  const match = normalized.match(markerRegex);
  if (!match) {
    return { mainAnswer: normalized, suggestions: undefined };
  }

  const splitIndex = match.index;
  const mainAnswer = normalized.slice(0, splitIndex).trim();
  const suggestionText = normalized.slice(splitIndex).trim();
  const marker = match[1] || '';
  const cleanedSuggestion = suggestionText
    .replace(/^(Rekomendasi pertanyaan berikutnya[:\s]*|Rekomendasi pertanyaan[:\s]*|Apakah\s+Kakak\s+ingin\s+dijelaskan[^\n]*\?|Balas(?:\s+saja)?\s*:\s*|Silakan\s+diketikkan|Butuh\s+informasi|Coba\s+tanya)/i, '')
    .trim();
  let suggestions = /^Rekomendasi pertanyaan/i.test(marker)
    ? `${marker.trim()}\n${cleanedSuggestion}`.trim()
    : cleanedSuggestion || suggestionText;

  if (suggestions) {
    const trimmed = suggestions.trim();
    if (!/^Rekomendasi pertanyaan/i.test(trimmed)) {
      const lines = trimmed.split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => l.replace(/^[*\-•]+\s*/, '').trim());
      suggestions = formatSuggestionSection(lines);
    } else {
      suggestions = trimmed;
    }
  }

  return {
    mainAnswer: mainAnswer || suggestionText,
    suggestions: suggestions || undefined
  };
}

function deriveConclusionSentence(mainAnswer, program, intent) {
  const normalized = normalizeWhitespace(String(mainAnswer || ''));
  if (!normalized) return 'Ringkasnya, informasinya sudah saya rangkum di atas.';

  const explicitConclusion = /\b(?:kesimpulannya|singkatnya|ringkasnya|intinya|jadi)\b/i;
  if (explicitConclusion.test(normalized)) return '';

  const body = removeFollowupSections(normalized).trim();
  const cleanedBody = body
    .replace(/Rekomendasi pertanyaan berikutnya[:\s]*[\s\S]*$/i, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => !/^(?:Mau\b|Silakan\b|Apakah\b|Balas(?:\s+saja)?\s*:\s*|Butuh informasi\b|Catatan[:\-]|Rekomendasi pertanyaan\b)/i.test(line))
    .filter(line => !/^\s*[-*•]\s*(mau\b|cek\b|bandingkan\b|simulasi\b|apa beda\b)/i.test(line))
    .join('\n')
    .trim();
  const finalBody = cleanedBody.replace(/\b(Balas(?:\s+saja)?\s*:\s*|Silakan diketikkan|Mau saya jelaskan lagi bagian lain\?|Butuh informasi)\b/gi, '').trim();
  const sentences = (finalBody.match(/[^.!?]+[.!?]+/g) || [finalBody]).map(s => s.trim()).filter(Boolean);
  const bulletSummary = getBulletSummary(finalBody);
  const prog = program || extractProgramFromText(body) || '';

  // Determine intent if not provided
  intent = intent || detectIntentFromAnswer(mainAnswer, '');

  // Helper to format item lists
  const formatItems = (text) => {
    let listText = text.replace(/\s+dan\s+/i, ', ');
    // remove leading verb phrases including common patterns
    listText = listText.replace(/^[^,\.]*?\b(?:mempelajari|meliputi|mencakup|termasuk|adalah|dapat bekerja sebagai|bisa bekerja sebagai|bekerja sebagai|lulusan[^,\.]*?dapat bekerja sebagai|fokus pada|menekankan|berfokus pada)\b\s*/i, '');
    const items = listText.split(/\s*,\s*/).map(s => s.replace(/[.?!]+$/, '').trim()).filter(Boolean);
    if (!items.length) return '';
    return items.length === 1 ? items[0] : (items.length === 2 ? `${items[0]} dan ${items[1]}` : `${items.slice(0, -1).join(', ')}, dan ${items.slice(-1)}`);
  };

  // Helper: convert bullet lines to a natural-language clause (e.g. pendaftaran)
  const bulletsToSentence = (text, subject = 'Pendaftaran') => {
    if (!text) return '';
    const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean).map(l => l.replace(/^[-*•◦]\s*/, '').trim());
    if (!lines.length) return '';
    const verbMap = [
      [/^isi\b|^mengisi\b/i, 'mengisi'],
      [/^unggah\b|^upload\b/i, 'mengunggah'],
      [/^bayar\b|^pembayaran\b|^transfer\b/i, 'melakukan pembayaran'],
      [/^ikuti\b|^mengikuti\b/i, 'mengikuti']
    ];
    const normalized = lines.map(l => {
      let s = l.replace(/[.]+$/, '').trim();
      const low = s.toLowerCase();
      for (const [re, verb] of verbMap) {
        if (re.test(low)) {
          s = s.replace(re, '').trim();
          return `${verb}${s ? ' ' + s : ''}`.trim();
        }
      }
      // fallback: return as-is
      return s;
    }).filter(Boolean);
    if (!normalized.length) return '';
    const sentenceBody = normalized.length === 1 ? normalized[0] : (normalized.length === 2 ? `${normalized[0]} dan ${normalized[1]}` : `${normalized.slice(0, -1).join(', ')}, dan ${normalized.slice(-1)}`);
    return `${subject} dilakukan dengan ${sentenceBody}.`;
  };
  // Intent-specific conclusion templates
  switch (intent) {
    case 'program_studi': {
      const itemsShort = bulletSummary || formatItems(finalBody);
      if (itemsShort) return `Kurikulum ${prog || ''} mencakup ${itemsShort}.`.replace(/\s+/g, ' ').trim();
      if (sentences[0]) return `${sentences[0].replace(/[.?!]+$/, '')}.`;
      break;
    }
    case 'prospek_kerja': {
      const itemsShort = bulletSummary || formatItems(finalBody);
      if (itemsShort) return `Lulusan dapat bekerja sebagai ${itemsShort}.`;
      if (sentences[0]) return `${sentences[0].replace(/[.?!]+$/, '')}.`;
      break;
    }
    case 'biaya': {
      let m = finalBody.match(/Rp\s*[0-9.,]+\s*(juta|ribu|rb|jt|rupiah)/i);
      if (!m) m = finalBody.match(/Rp\s*[0-9.,]+/i);
      if (m) return `Estimasi biaya adalah ${m[0].replace(/[.?!]+$/, '')}.`;
      if (sentences[0]) return `${sentences[0].replace(/[.?!]+$/, '')}.`;
      break;
    }
    case 'beasiswa': {
      return 'Tersedia beberapa jenis beasiswa dengan persyaratan berbeda.';
    }
    case 'pendaftaran': {
      const manual = bulletsToSentence(finalBody, 'Pendaftaran');
      if (manual) return `${manual}`;
      if (bulletSummary) return `Pendaftarannya: ${bulletSummary}.`;
      if (sentences[0]) return `${sentences[0].replace(/[.?!]+$/, '')}.`;
      break;
    }
    case 'jadwal_pendaftaran': {
      const gelombangMatch = finalBody.match(/pendaftaran\s+dibuka\s+setiap\s+gelombang[:\s]*([^;]+)/i) || finalBody.match(/gelombang\s*:\s*([^;.]+)/i);
      if (gelombangMatch && gelombangMatch[1]) {
        const schedule = gelombangMatch[1].trim().replace(/\s*;.*$/, '').trim();
        return `Pendaftaran dibuka setiap gelombang: ${schedule}.`;
      }
      if (sentences[0]) return `${sentences[0].replace(/[.?!]+$/, '')}.`;
      break;
    }
    case 'lokasi': {
      const m = finalBody.match(/berlokasi di\s+([^.,;\n]+)/i) || finalBody.match(/di\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
      if (m && m[1]) return `Kampus berlokasi di ${m[1].trim()}.`;
      if (sentences[0]) return `${sentences[0].replace(/[.?!]+$/, '')}.`;
      break;
    }
    case 'akreditasi': {
      const gradeMatch = finalBody.match(/terakreditasi\s*[:\-\s]*([A-C]|A\+|A|B|C)/i) || finalBody.match(/akreditasi\s*[:\-\s]*([A-C]|A\+|A|B|C)/i);
      const institutionMatch = finalBody.match(/([A-Z][A-Za-z0-9\s\.]{2,80})\s+(terakreditasi|terakreditasi oleh|terakreditasi dengan)/i) || finalBody.match(/^(STIKOM\s+[A-Za-z0-9\s]+)/i) || (prog ? [null, prog] : null);
      const inst = institutionMatch && institutionMatch[1] ? institutionMatch[1].trim() : (prog || '').trim();
      const grade = gradeMatch && gradeMatch[1] ? gradeMatch[1].toUpperCase() : null;
      if (grade && inst) return `${inst} terakreditasi ${grade}.`;
      if (grade) return `Terakreditasi ${grade}.`;
      if (sentences[0]) return `${sentences[0].replace(/[.?!]+$/, '')}.`;
      break;
    }
    case 'perbandingan_prodi': {
      if (sentences[0]) return `${sentences[0].replace(/[.?!]+$/, '')}.`;
      const itemsShort = bulletSummary || formatItems(finalBody);
      if (itemsShort) return `Perbedaan utama: ${itemsShort}.`;
      break;
    }
    case 'general': {
      if (sentences[0] && sentences[0].length < 250) return `${sentences[0].replace(/[.?!]+$/, '')}.`;
      const bulletSummary2 = getBulletSummary(finalBody);
      if (bulletSummary2) return `Informasi penting mencakup ${bulletSummary2}.`;
      const firstWords = finalBody.split(/\s+/).slice(0, 15).join(' ').replace(/[.?!]+$/, '');
      if (firstWords) return `${firstWords}.`;
      return 'Semua informasi yang diminta telah dijelaskan di atas.';
    }
    default: {
      if (sentences[0] && sentences[0].length < 250) return `${sentences[0].replace(/[.?!]+$/, '')}.`;
      if (sentences[0]) return 'Informasi penting telah disampaikan.';
      return 'Semua informasi yang diminta telah dijelaskan di atas.';
    }
  }

  return '';
}

function inferConclusion(mainAnswer, userQuery) {
  if (isStructuredWhatsappAnswer(mainAnswer)) return '';
  const text = String(mainAnswer || '');
  const totalMatch = text.match(/\btotal\s*:?\s*rp\s*([0-9.,]+)/i);
  if (!totalMatch || !totalMatch[1]) {
    const program = mapProgramAlias(userQuery) || extractProgramFromText(mainAnswer);
    const intent = detectIntentFromAnswer(mainAnswer, userQuery);
    return deriveConclusionSentence(mainAnswer, program, intent);
  }

  const rawAmount = totalMatch[1].replace(/\./g, '').replace(/,/g, '.');
  const parsed = Number(rawAmount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const program = mapProgramAlias(userQuery) || extractProgramFromText(mainAnswer);
    const intent = detectIntentFromAnswer(mainAnswer, userQuery);
    return deriveConclusionSentence(mainAnswer, program, intent);
  }

  return `Jadi estimasi awal masuknya sekitar Rp ${parsed.toLocaleString('id-ID')} ya kak.`;
}

function deriveContextualSuggestions(userQuery, mainAnswer) {
  // DISABLED: This function was causing akademik-specific suggestions to bleed into non-akademik domains.
  // Let suggestionsForIntent handle all suggestions based on detected intent instead.
  // Original logic would always return akademik suggestions for any query with "apa saja" or "mata kuliah",
  // overriding the intent-aware suggestions from suggestionsForIntent.
  return null;
}

function detectIntentFromQuery(userQuery) {
  const q = String(userQuery || '').toLowerCase().trim();
  if (!q) return 'general';

  if (/\b(coding|programmer|programming|software engineer|software developer|data analyst|data scientist|cyber security|cybersecurity|ui\/ux|ui ux|ux designer|ai engineer|artificial intelligence|machine learning)\b/i.test(q)) {
    if (/\b(jurusan|prodi|program studi|cocok|yang tepat|apa|terbaik|lebih cocok|sesuai|pilihan|direkomendasikan|jadi)\b/.test(q)) {
      try { traceWhatsapp('detectIntentFromQuery', { query: userQuery, detected: 'program_studi' }); } catch (e) {}
      return 'program_studi';
    }
    try { traceWhatsapp('detectIntentFromQuery', { query: userQuery, detected: 'prospek_kerja' }); } catch (e) {}
    return 'prospek_kerja';
  }

  if (/\b(biaya|cicilan|dpp|ukt|fee|bayar|harga|rp|rupiah|spp)\b/.test(q) && /\b(prodi|program studi|jurusan)\b/.test(q)) {
    try { traceWhatsapp('detectIntentFromQuery', { query: userQuery, detected: 'biaya' }); } catch (e) {}
    return 'biaya';
  }

  const semanticPatterns = [
    { intent: 'international_double_degree', regex: /\b(double degree|double-degree|double gelar|dual degree|program internasional|kelas internasional|exchange semester|kuliah di luar negeri)\b/ },
    { intent: 'beasiswa', regex: /\b(beasiswa|scholarship|grant|bantuan pendidikan|kip|1k1s|prestasi|yayasan|kemitraan|kurang mampu|tidak mampu)\b/ },
    { intent: 'program_definition', regex: /\b(apa itu|apa sih|definisi|arti|penjelasan tentang|jelaskan tentang)\b/ },
    { intent: 'program_studi', regex: /\b(prodi|program studi|daftar program studi|jenis program studi|ada program studi|program studi yang ada|daftar prodi)\b/ },
    { intent: 'prospek_kerja', regex: /\b(prospek kerja|karir|pekerjaan|lulusan|job prospects|bekerja sebagai)\b/ },
    { intent: 'akreditasi', regex: /\b(akreditasi|ban-pt|sk akreditasi|terakreditasi)\b/ },
    { intent: 'lokasi', regex: /\b(lokasi|alamat|berlokasi|letak|cabang|kampus)\b/ },
    { intent: 'jadwal_pendaftaran', regex: /\b(jadwal|gelombang|deadline|tanggal|dibuka|tutup)\b/ },
    { intent: 'perbandingan_prodi', regex: /\\b(bedanya|perbedaan|versus|vs|beda antara|dibanding|dibandingkan|lebih baik|mana (?:yang )?lebih baik|lebih cocok|lebih unggul)\\b/ },
    { intent: 'ukm', regex: /\b(ukm|ormawa|organisasi mahasiswa|unit kegiatan|komunitas|athena esports|esport|esports|musik|futsal|basket|teater biner|vos)\b/ },
    { intent: 'pendaftaran', regex: /\b(pendaftaran|daftar|seleksi)\b/ },
    { intent: 'biaya', regex: /\b(biaya|cicilan|dpp|ukt|fee|bayar|harga)\b/ }
  ];

  for (const item of semanticPatterns) {
    if (item.regex.test(q)) {
      try { traceWhatsapp('detectIntentFromQuery', { query: userQuery, detected: item.intent }); } catch (e) {}
      return item.intent;
    }
  }

  try { traceWhatsapp('detectIntentFromQuery', { query: userQuery, detected: 'general' }); } catch (e) {}
  return 'general';
}

function detectIntentFromAnswer(mainAnswer, userQuery) {
  // Prefer strong signals in the answer (especially 'biaya') before trusting the query intent.
  const answerIntent = detectIntentFromAnswerFromText(mainAnswer);
  if (answerIntent === 'biaya') {
    try { traceWhatsapp('detectIntentFromAnswer', { mainAnswer, userQuery, chosen: 'biaya', reason: 'answer indicates fee' }); } catch (e) {}
    return 'biaya';
  }

  const queryIntent = detectIntentFromQuery(userQuery);
  if (queryIntent !== 'general') return queryIntent;

  return answerIntent;
}

function detectIntentFromAnswerFromText(mainAnswer) {
  const answer = String(mainAnswer || '');
  const normalized = answer.toLowerCase();
  const feeMarker = /\brp\s*[0-9.,]+(?:\s*(?:juta|ribu|rb|jt|rupiah))?\b/i;
  const feeKeywords = /\b(?:rincian biaya|biaya awal masuk|biaya masuk|dana pendidikan(?: pokok)?|total biaya|biaya pendidikan|biaya semester|biaya pendaftaran|biaya kuliah|dpp|ukt|cicilan|fee|bayar|harga)\b/i;
  if (/\b(ukm|ormawa|organisasi mahasiswa|unit kegiatan|athena esports|esport|esports|musik|futsal|basket|teater biner|vos|pengurus ukm|kemahasiswaan)\b/i.test(normalized)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'ukm' }); } catch (e) {} return 'ukm'; }

  if (feeMarker.test(answer) || feeKeywords.test(normalized)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'biaya' }); } catch (e) {} return 'biaya'; }
  if (/\b(bedanya|perbedaan|versus|vs|beda antara|dibanding|dibandingkan|lebih baik|mana (?:yang )?lebih baik|lebih cocok|lebih unggul|Perbandingan cepat|Perbandingan singkat)\b/i.test(answer)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'perbandingan_prodi' }); } catch (e) {} return 'perbandingan_prodi'; }
  if (/\b(akreditasi|ban-pt|sk akreditasi|terakreditasi)\b/.test(normalized)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'akreditasi' }); } catch (e) {} return 'akreditasi'; }
  if (/\b(jadwal|gelombang|deadline|tanggal|dibuka|tutup|januari|mei|september|februari|maret|april|juni|juli|agustus|oktober|november|desember)\b/.test(normalized)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'jadwal_pendaftaran' }); } catch (e) {} return 'jadwal_pendaftaran'; }
  if (/\b(cara daftar|langkah pendaftaran|prosedur pendaftaran|persyaratan pendaftaran|dokumen|formulir|ijazah|ktp|status pendaftaran|portal akademik)\b/.test(normalized)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'pendaftaran' }); } catch (e) {} return 'pendaftaran'; }
  if (/\b(prospek kerja|karir|pekerjaan|lowongan|bekerja sebagai|job prospects|lulusan bekerja)\b/.test(normalized)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'prospek_kerja' }); } catch (e) {} return 'prospek_kerja'; }
  if (/\b(beasiswa|scholarship|grant|bantuan pendidikan|beasiswa prestasi|beasiswa kurang mampu)\b/.test(normalized)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'beasiswa' }); } catch (e) {} return 'beasiswa'; }
  if (/\b(lokasi|alamat|denpasar|berlokasi|letak|cabang|kampus)\b/.test(normalized)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'lokasi' }); } catch (e) {} return 'lokasi'; }
  if (/\b(bedanya|perbedaan|versus|beda antara|dibanding|dibandingkan)\b/.test(normalized) || /\bvs\b(?!\s+code\b)/.test(normalized)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'perbandingan_prodi' }); } catch (e) {} return 'perbandingan_prodi'; }
  if (/\b(belajar|mata kuliah|kurikulum|dipelajari|pembelajaran akademik)\b/.test(normalized) && /\b(program|studi|kursus|ti|si|dkv|hukum|psikologi|sistem informasi|teknologi informasi)\b/.test(normalized)) { try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'program_studi' }); } catch (e) {} return 'program_studi'; }

  try { traceWhatsapp('detectIntentFromAnswerFromText', { answer: mainAnswer, detected: 'general' }); } catch (e) {}
  return 'general';
}

function suggestionsForIntent(intent, program) {
  switch (intent) {
    case 'program_studi':
      return [
        program ? `Mau tahu mata kuliah inti di ${program}?` : 'Mau tahu mata kuliah inti?',
        'Cek contoh kurikulum per semester',
        'Prospek kerja untuk lulusan terkait',
        'Perbandingan dengan prodi lain'
      ];
    case 'prospek_kerja':
      return [
        'Mau contoh posisi pekerjaan dan gaji rata-rata?',
        'Informasi magang dan kerja sama industri',
        'Sertifikasi yang meningkatkan peluang kerja'
      ];
    case 'ukm':
      return [
        'UKM apa saja yang tersedia?',
        'Bagaimana cara ikut UKM?',
        'Ada UKM olahraga atau seni apa saja?'
      ];
    case 'biaya':
      return [
        'Mau simulasi cicilan/biaya per semester?',
        'Informasi beasiswa atau bantuan biaya',
        'Rincian biaya pendaftaran dan administrasi'
      ];
    case 'beasiswa':
      return [
        'Ingin tahu syarat beasiswa prestasi?',
        'Cara mengajukan beasiswa kurang mampu',
        'Daftar mitra perusahaan yang memberikan beasiswa'
      ];
    case 'pendaftaran':
      return [
        'Mau tahu jadwal dan deadline pendaftaran?',
        'Langkah-langkah pendaftaran mahasiswa baru',
        'Dokumen yang perlu disiapkan untuk daftar'
      ];
    case 'lokasi':
      return [
        'Mau petunjuk arah ke kampus atau peta?',
        'Info fasilitas terdekat dan akomodasi',
        'Jam operasional layanan akademik di kampus'
      ];
    case 'akreditasi':
      return [
        'Mau lihat SK akreditasi terbaru?',
        'Daftar program studi dan status akreditasinya',
        'Penjelasan arti akreditasi untuk lulusan'
      ];
    case 'perbandingan_prodi':
      return [
        'Mau perbandingan kurikulum dan mata kuliah?',
        'Prospek kerja per program studi',
        'Rekomendasi prodi berdasar minat dan karir'
      ];
    case 'general':
      // Generic, domain-agnostic suggestions for unknown topics
      return [
        'Apakah ada detail tambahan yang perlu dijelaskan?',
        'Butuh informasi lebih lanjut tentang topik ini?',
        'Ada pertanyaan lain yang bisa saya bantu?'
      ];
    default:
      // Ultimate fallback (same as general)
      return [
        'Apakah ada detail tambahan yang perlu dijelaskan?',
        'Butuh informasi lebih lanjut tentang topik ini?',
        'Ada pertanyaan lain yang bisa saya bantu?'
      ];
  }
}

function normalizeWhatsappReply(text) {
  if (!text) return '';
  let out = normalizeWhitespace(String(text));
  out = out.replace(/[ΓÇó•·◦⁃‣]/g, '-');

  const normalizedLines = [];
  let lastWasEmpty = false;
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (normalizedLines.length && !lastWasEmpty) {
        normalizedLines.push('');
        lastWasEmpty = true;
      }
      continue;
    }

    lastWasEmpty = false;
    if (/^[-*•◦\d\.\)]\s+/.test(trimmed)) {
      normalizedLines.push('- ' + trimmed.replace(/^[\-*•◦\d\.\)]\s*/, '').trim());
      continue;
    }
    if (/^[-—–]{2,}$/.test(trimmed)) {
      continue;
    }
    normalizedLines.push(trimmed);
  }

  out = normalizedLines.join('\n').trim();
  return out;
}

function buildWhatsappConversationalReply({
  rawMainAnswer,
  userQuery,
  responseMode = 'conversational',
  preserveExactAnswer = false,
  includeMeta = false
} = {}) {
  const answerWithoutEmoji = removeEmoji(String(rawMainAnswer || ''));
  const normalizedAnswer = normalizeWhatsappReply(answerWithoutEmoji);
  const mode = String(responseMode || 'conversational').toLowerCase();
  if (mode === 'deterministic' || preserveExactAnswer) {
    return normalizedAnswer;
  }

  // empty answer -> return empty
  if (!normalizedAnswer) return '';

  // greetings and program-overview keep raw behavior
  if (isGreetingQuestion(userQuery)) return normalizedAnswer;
  if (isProgramOverviewQuestion(userQuery)) return formatProgramOverviewResponse(normalizedAnswer);

  // when caller did not request meta, return body-only
  if (!includeMeta) return normalizedAnswer;

  // includeMeta: derive conclusion and force full WA structure
  try {
    const { mainAnswer, suggestions } = splitAnswerAndSuggestions(normalizedAnswer);
    const body = String(mainAnswer || '').trim();
    if (!body) return '';

    // If the answer is already natural and does not contain old-system labels,
    // preserve it as-is instead of forcing a structured template.
    if (!/\b(Topik:|Informasi Terkait:|Kesimpulan:)/i.test(normalizedAnswer)) {
      return normalizedAnswer;
    }

    return buildStructuredWhatsappReply({
      body,
      userQuery,
      suggestions
    });
  } catch (e) {
    return normalizedAnswer;
  }
}

/**
 * HUMANIZED RESPONSE BUILDER (NEW)
 * Menggunakan layer humanization baru tanpa mengubah RAG engine
 */
const { 
  buildHumanizedIntentConfirmation, 
  generateFollowUpQuestions,
  formatHumanizedResponse,
  applyVirtualAssistantPersona
} = require('../engine/humanizer');

/**
 * Build humanized WhatsApp response dengan:
 * 1. Natural intent confirmation
 * 2. Main answer (dari RAG, unchanged)
 * 3. 3 follow-up questions yang relevan (bukan labels seperti "Kesimpulan:")
 * 4. Virtual assistant persona yang sopan & natural
 */
function buildHumanizedWhatsappReply({
  mainAnswer = '',
  userQuery = '',
  intent = null,
  context = {}
} = {}) {
  console.log('[RAW_RAG_ANSWER]', { rawAnswer: String(mainAnswer || '') });
  const normalizedAnswer = normalizeWhatsappReply(String(mainAnswer || ''));
  const rawIntent = intent ? String(intent || '').trim().toLowerCase() : '';
  const rawRagSource = context && (context.ragSource || context.source)
    ? String(context.ragSource || context.source || '').trim().toLowerCase()
    : '';
  const deterministicSource = rawRagSource || rawIntent;
  const isDeterministicGreeting = deterministicSource === 'rag-greeting' || isGreetingQuestion(userQuery);
  const isDeterministicPmbInfo = deterministicSource === 'rag-pmb-info';
  const isDeterministicProgramProfile = deterministicSource === 'rag-program-profile';
  const isDeterministicFee = deterministicSource === 'rag-fee-structured' || /^\s*Program Studi\s*:/i.test(normalizedAnswer);

  if (isDeterministicGreeting || isDeterministicPmbInfo || isDeterministicProgramProfile || isDeterministicFee) {
    console.log('[TRACE_HUMANIZER_PRESERVE_DETERMINISTIC]', {
      rawIntent,
      rawRagSource,
      isDeterministicGreeting,
      isDeterministicPmbInfo,
      isDeterministicProgramProfile,
      isDeterministicFee
    });
    return normalizedAnswer;
  }
  
  // Detect or map intent
  let detectedIntent = null;
  if (intent) {
    detectedIntent = mapProviderIntentToFormatter(intent);
    console.log('[TRACE_INTENT_PROVIDER]', { providerIntent: intent });
    console.log('[TRACE_INTENT_MAPPED]', { mappedIntent: detectedIntent });
  } else {
    detectedIntent = detectIntentFromAnswer(normalizedAnswer, userQuery) || 'general';
  }

  console.log('[TRACE_INTENT_HUMANIZER]', { detectedIntentBeforeCostOverride: detectedIntent });

  const queryIntent = detectIntentFromQuery(userQuery);
  const explicitLocationQuery = queryIntent === 'lokasi' || /\b(lokasi|alamat|berlokasi|kampus|denpasar|cabang|di\s+mana|dimana)\b/i.test(String(userQuery || ''));
  const answerLocationIntent = detectIntentFromAnswerFromText(normalizedAnswer) === 'lokasi';

  // Strong rule: treat explicit fee/biaya queries as COST/`biaya` intent and preserve it.
  // Avoid overriding location intent when the answer or query clearly points to campus location.
  const costQueryPattern = /\b(biaya|dpp|ukt|pendaftaran|biaya\s+masuk|biaya\s+kuliah|cicilan|total\s+biaya|harga)\b/i;
  const explicitCostQuery = costQueryPattern.test(String(userQuery || ''));
  const answerCostIntent = detectIntentFromAnswerFromText(normalizedAnswer) === 'biaya';
  const nonCostQueryIntents = ['lokasi', 'jadwal_pendaftaran', 'akreditasi', 'perbandingan_prodi', 'beasiswa', 'prospek_kerja'];
  const isCostQuery = (
    explicitCostQuery &&
    !explicitLocationQuery &&
    !answerLocationIntent &&
    !nonCostQueryIntents.includes(queryIntent)
  ) || (
    !explicitCostQuery &&
    answerCostIntent &&
    !explicitLocationQuery &&
    !answerLocationIntent &&
    queryIntent === 'general'
  );

  if (isCostQuery) {
    console.log('[TRACE_COST_INTENT]', { detectedIntentBefore: detectedIntent, userQuery, queryIntent, answerCostIntent, explicitCostQuery, explicitLocationQuery, answerLocationIntent });
    detectedIntent = 'biaya';
  }
  console.log('[TRACE_TEMPLATE_SELECTION]', {
    function: 'buildHumanizedWhatsappReply',
    detectedIntent,
    selectedTemplate: detectedIntent,
    reason: isCostQuery ? 'cost override' : (intent ? 'provider intent provided' : 'detected from answer/query'),
    queryIntent,
    answerCostIntent,
    explicitCostQuery,
    explicitLocationQuery,
    answerLocationIntent
  });
  console.log('[TRACE_INTENT_FINAL]', { finalIntent: detectedIntent });
  
  // Prepare context untuk humanizer
  const queryProgram = mapProgramAlias(userQuery);
  const answerProgram = extractProgramFromText(normalizedAnswer);
  const sessionProgram = context.program || null;
  console.log('[TRACE_PROGRAM_QUERY]', { queryProgram });
  console.log('[TRACE_PROGRAM_RAG]', { answerProgram });
  console.log('[TRACE_PROGRAM_SESSION]', { sessionProgram });
  console.log('[TRACE_PROGRAM_FINAL_VARS]', { queryProgram, answerProgram, sessionProgram });
  // Prefer the program mentioned in the RAG answer when available, otherwise
  // fall back to the user query alias, then session hint. This ensures headers
  // reflect the actual RAG-provided program when it differs from the query.
  const programFinal = answerProgram || queryProgram || sessionProgram;
  console.log('[TRACE_PROGRAM_FINAL]', { programFinal });

  if (isCostQuery) {
    console.log('[TRACE_COST_PROGRAM]', { queryProgram, answerProgram, programFinal });
    console.log('[TRACE_COST_SOURCE]', { ragSource: context.ragSource || context.source || null });
  }

  const contextWithIntent = {
    ...context,
    intent: detectedIntent,
    program: programFinal
  };
  
  // Format response dengan humanization layer
  let humanized = formatHumanizedResponse(normalizedAnswer, userQuery, contextWithIntent);
  
  // Apply virtual assistant persona rules
  humanized = applyVirtualAssistantPersona(humanized);

  console.log('[TRACE_HUMANIZER_FINAL_OUTPUT]', {
    detectedIntent,
    programFinal,
    preview: String(humanized || '').slice(0, 240)
  });

  if (isCostQuery) {
    console.log('[TRACE_COST_FINAL_ANSWER]', { final: String(humanized || '').slice(0, 800) });
  }
  console.log('[TRACE_INTENT_FORMATTER]', { detectedIntent, program: programFinal });
  try { traceWhatsapp('buildHumanizedWhatsappReply.final', { userQuery, detectedIntent, programFinal, snippet: String(humanized||'').slice(0,800) }); } catch (e) {}
  return normalizeWhatsappReply(humanized);
}

module.exports = {
  buildWhatsappConversationalReply,
  buildHumanizedWhatsappReply,
  isProgramOverviewQuestion,
  formatProgramOverviewResponse,
  mapProgramAlias,
  mapProviderIntentToFormatter,
  extractProgramFromText
};

// Expose helpers for unit testing
module.exports.deriveConclusionSentence = deriveConclusionSentence;
module.exports.detectIntentFromAnswer = detectIntentFromAnswer;
module.exports.detectIntentFromQuery = detectIntentFromQuery;
module.exports.detectIntentFromAnswerFromText = detectIntentFromAnswerFromText;
module.exports.buildHumanizedIntentConfirmation = buildHumanizedIntentConfirmation;
module.exports.generateFollowUpQuestions = generateFollowUpQuestions;

