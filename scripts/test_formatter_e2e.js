const { buildWhatsappConversationalReply } = require('../src/utils/whatsappFormatter');

// Simulasi output RAG untuk query "TI belajar apa saja"
const ragOutput = `Teknologi Informasi mempelajari pemrograman, basis data, jaringan, keamanan siber, dan analisis data.`;

const userQuery = 'TI belajar apa saja';

const fullFormatted = buildWhatsappConversationalReply({ rawMainAnswer: ragOutput, userQuery, includeMeta: true });
const mainOnly = buildWhatsappConversationalReply({ rawMainAnswer: ragOutput, userQuery, includeMeta: false });

// Heuristik parsing output menjadi bagian-bagian: Greeting, Assumption, MainAnswer, Conclusion, Suggestions
function parseFormatted(text) {
  const parts = text.split(/\n\n/).map(p => p.trim()).filter(Boolean);
  const out = { greeting: null, assumption: null, mainAnswer: null, conclusion: null, suggestions: null, raw: text };
  if (parts.length >= 1) out.greeting = parts[0];
  if (parts.length >= 2) out.assumption = parts[1];
  if (parts.length >= 3) out.mainAnswer = parts[2];
  // conclusion usually starts with 'Kesimpulannya' or 'Ringkasnya'
  for (let i = 3; i < parts.length; i++) {
    const p = parts[i];
    if (/^Kesimpulannya\b|^Ringkasnya\b|^Intinya\b/i.test(p)) {
      out.conclusion = p;
    } else if (/^Rekomendasi pertanyaan/i.test(p) || p.startsWith('*') || p.startsWith('-') || /Mau|Apakah/i.test(p)) {
      out.suggestions = p;
    } else if (!out.suggestions && /\*/.test(p)) {
      out.suggestions = p;
    }
  }
  return out;
}

const parsed = parseFormatted(fullFormatted);

console.log('--- E2E Formatter Test (query: "TI belajar apa saja") ---');
console.log('RAG raw output:');
console.log(ragOutput);
console.log('\nMain-only output (includeMeta=false):');
console.log(mainOnly);
console.log('\nParsed formatted output (includeMeta=true):');
console.log(JSON.stringify(parsed, null, 2));
console.log('\nFinal message that will be sent to WhatsApp:');
console.log(fullFormatted);
