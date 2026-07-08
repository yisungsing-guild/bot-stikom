const hf = require('../src/engine/humanizer');
const fmt = require('../src/utils/whatsappFormatter');

const samples = [
  {
    query: 'Berapa biaya TI?',
    ragSource: 'rag-match',
    rawRag: 'Biaya untuk Program Studi Teknologi Informasi:\n- Biaya Pendaftaran: Rp 500.000\n- DPP: Rp 25.000.000\n'
  },
  {
    query: 'Berapa biaya Sistem Informasi?',
    ragSource: 'rag-match',
    rawRag: 'Biaya untuk Program Studi Sistem Informasi:\n- Biaya Pendaftaran: Rp 400.000\n- DPP: Rp 20.000.000\n'
  },
  {
    query: 'Berapa biaya Bisnis Digital?',
    ragSource: 'rag-match',
    rawRag: 'Biaya untuk Program Studi Bisnis Digital:\n- Biaya Pendaftaran: Rp 300.000\n- DPP: Rp 18.000.000\n'
  },
  {
    query: 'Apa itu Sistem Informasi?',
    ragSource: 'rag-match',
    rawRag: 'Sistem Informasi adalah program studi yang mempelajari pengelolaan informasi, pengembangan sistem informasi, dan analisis data.'
  },
  {
    query: 'Apa itu Teknologi Informasi?',
    ragSource: 'rag-match',
    rawRag: 'Teknologi Informasi adalah program studi yang mempelajari perangkat lunak, jaringan, dan infrastruktur TI.'
  },
  {
    query: 'Saya suka coding cocok jurusan apa?',
    ragSource: 'rag-match',
    rawRag: 'Untuk seseorang yang suka coding, saya rekomendasikan program studi berikut di ITB STIKOM Bali:\n\n1. Teknologi Informasi\n2. Sistem Komputer\n'
  },
  {
    query: 'Saya ingin jadi programmer cocok jurusan apa?',
    ragSource: 'rag-match',
    rawRag: 'Untuk menjadi programmer, program studi yang sering direkomendasikan:\n\n- Teknologi Informasi\n- Sistem Komputer\n'
  }
];

for (const s of samples) {
  console.log('---');
  console.log('QUERY:\n' + s.query + '\n');
  // Detect intent via formatter's detectIntentFromAnswer
  const detectedIntent = fmt.detectIntentFromAnswer(s.rawRag, s.query);
  console.log('INTENT TERDETEKSI:\n' + detectedIntent + '\n');
  console.log('RAG SOURCE:\n' + s.ragSource + '\n');
  console.log('RAW RAG ANSWER:\n' + s.rawRag + '\n');

  // Humanizer
  const humanized = hf.formatHumanizedResponse(s.rawRag, s.query, { intent: detectedIntent, program: fmt.mapProgramAlias(s.query) || fmt.extractProgramFromText(s.rawRag) });
  console.log('ANSWER SETELAH HUMANIZER:\n' + humanized + '\n');

  // Formatter
  const formatted = fmt.buildHumanizedWhatsappReply({ mainAnswer: s.rawRag, userQuery: s.query, intent: detectedIntent, context: { program: fmt.mapProgramAlias(s.query), ragSource: s.ragSource } });
  console.log('ANSWER SETELAH FORMATTER:\n' + formatted + '\n');

  // Final WhatsApp output is same as formatter output in this pipeline
  console.log('FINAL WHATSAPP OUTPUT:\n' + formatted + '\n');
}

console.log('Done');
