const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

(function loadDotenv() {
  const explicit = process.env.DOTENV_CONFIG_PATH;
  if (explicit) {
    dotenv.config({ path: explicit, override: true });
    return;
  }
  const cwd = process.cwd();
  const prodLocal = path.join(cwd, '.env.production.local');
  const prod = path.join(cwd, '.env.production');
  const dev = path.join(cwd, '.env');
  if (fs.existsSync(prodLocal)) {
    dotenv.config({ path: prodLocal, override: true });
  } else if (fs.existsSync(prod)) {
    dotenv.config({ path: prod, override: true });
  } else if (fs.existsSync(dev)) {
    dotenv.config({ path: dev, override: true });
  }
})();

const { query } = require('./src/engine/ragEngine');
const { classifyIntent } = require('./src/engine/intentClassifier');

const programs = [
  { code: 'SI', label: 'Sistem Informasi' },
  { code: 'TI', label: 'Teknologi Informasi' },
  { code: 'SK', label: 'Sistem Komputer' },
  { code: 'BD', label: 'Bisnis Digital' },
  { code: 'MI', label: 'Manajemen Informatika' }
];

const queries = [
  { key: 'definition', prompt: 'Jelaskan apa itu program studi {program} di ITB STIKOM Bali', label: 'Definisi program studi' },
  { key: 'curriculum', prompt: 'Apa saja yang dipelajari di {program}? Jelaskan kurikulumnya.', label: 'Kurikulum & pembelajaran' },
  { key: 'career', prompt: 'Prospek kerja lulusan {program} di ITB STIKOM Bali seperti apa?', label: 'Prospek kerja' },
  { key: 'cost', prompt: 'Berapa biaya kuliah untuk program {program}?', label: 'Biaya pendidikan' },
  { key: 'accreditation', prompt: 'Apa akreditasi program {program} di ITB STIKOM Bali?', label: 'Akreditasi/peringkat' }
];

async function main() {
  console.log('End-to-end audit: program x query intents');
  for (const program of programs) {
    console.log(`\n=== Program: ${program.label} (${program.code}) ===`);
    for (const q of queries) {
      const question = q.prompt.replace('{program}', program.label);
      const intent = classifyIntent(question);
      try {
        const result = await query(question, parseInt(process.env.RAG_TOP_K || '6', 10), { answerQuestion: question, strict: false, includeGlobal: true, minScore: parseFloat(process.env.RAG_MIN_SCORE || '0.6') });
        console.log(`\n-- ${q.label}`);
        console.log('Question:', question);
        console.log('Detected intent:', intent);
        if (result && result.answer) {
          console.log('Answer source:', result.source || '(none)');
          console.log('Answer:');
          console.log(result.answer.trim());
        } else {
          console.log('No answer. Result:', result);
        }
        if (result && Array.isArray(result.contexts) && result.contexts.length > 0) {
          const topContexts = result.contexts.slice(0, 3).map((c, i) => {
            const chunk = c.chunk ? String(c.chunk).replace(/\n/g, ' ').slice(0, 220) : '(no chunk)';
            return `  ${i + 1}. [${c.docCategory || c.category || 'N/A'}] ${chunk}`;
          });
          console.log('Top contexts:');
          console.log(topContexts.join('\n'));
        }
      } catch (err) {
        console.log('Query failed:', err && err.message ? err.message : err);
      }
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Fatal error:', err && err.message ? err.message : err);
  process.exit(1);
});
