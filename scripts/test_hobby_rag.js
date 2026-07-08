// Simple test harness to query ragEngine about random hobbies and write a JSON report
process.env.PROGRAM_MATCH_BOOST = process.env.PROGRAM_MATCH_BOOST || '0.6';
process.env.RAG_EXACT_PROGRAM_MATCH_BOOST = process.env.RAG_EXACT_PROGRAM_MATCH_BOOST || '1.0';
process.env.TRACE_RAG_DECISION = 'false';

const fs = require('fs');
const path = require('path');
const rag = require('../src/engine/ragEngine');
const reportPath = path.join(__dirname, '..', 'reports', 'hobby_random_rag_report.json');

const questions = [
  'Saya suka bermain game dan membuat konten, hobi ini cocok untuk prodi apa?',
  'Kalau hobiku adalah menggambar dan edit video, jurusan apa yang paling pas?',
  'Saya senang nonton anime, bikin konten digital, dan main game, prodi apa bagus?',
  'Hobi saya terbiasa dengan media sosial dan desain sederhana, prodi apa ya?',
  'Saya suka coding kecil-kecilan dan bikin website, hobi ini cocok di jurusan mana?',
  'Paling sering saya bikin video pendek dan main game, jurusan mana yang sesuai?',
  'Suka belajar IT lewat game dan konten digital, bisa cocok di prodi apa?',
  'Kalau saya suka fotografi dan social media, jurusan apa yang cocok dengan hobi itu?',
  'Saya hobi membuat aplikasi sederhana dan desain visual, prodi apa yang cocok?',
  'Mau tanya: hobi saya digital content creation dan game, tepatnya cocok di jurusan mana?'
];

async function runOne(question, index) {
  const result = { question, answer: null, contexts: [], error: null };
  try {
    const res = await rag.query(question, 8, { includeGlobal: true });
    result.answer = res.answer || null;
    const contexts = res.contexts || res.contextsUsed || [];
    result.contexts = contexts.slice(0, 5).map((c) => ({
      trainingId: c.trainingId || c.id || null,
      filename: c.filename || null,
      preview: (c.chunk || '').toString().slice(0, 250).replace(/\n/g, ' ')
    }));
  } catch (e) {
    result.error = e && e.stack ? e.stack : String(e);
  }
  return result;
}

async function run() {
  const report = []; 
  for (let i = 0; i < questions.length; i += 1) {
    process.stdout.write(`Running query ${i + 1}/${questions.length}... `);
    const entry = await runOne(questions[i], i);
    report.push(entry);
    process.stdout.write('done\n');
  }

  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), config: {
    PROGRAM_MATCH_BOOST: process.env.PROGRAM_MATCH_BOOST,
    RAG_EXACT_PROGRAM_MATCH_BOOST: process.env.RAG_EXACT_PROGRAM_MATCH_BOOST
  }, results: report }, null, 2), 'utf8');
  console.log(`\nReport written to ${reportPath}`);
}

run();
