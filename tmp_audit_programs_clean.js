const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

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
  { key: 'definition', prompt: 'Jelaskan apa itu program studi {program} di ITB STIKOM Bali', label: 'Definisi' },
  { key: 'curriculum', prompt: 'Apa saja yang dipelajari di {program}? Jelaskan kurikulumnya.', label: 'Kurikulum' },
  { key: 'career', prompt: 'Prospek kerja lulusan {program} di ITB STIKOM Bali seperti apa?', label: 'Prospek kerja' },
  { key: 'cost', prompt: 'Berapa biaya kuliah untuk program {program}?', label: 'Biaya', intent: 'BIAYA_PENDIDIKAN' },
  { key: 'accreditation', prompt: 'Apa akreditasi program {program} di ITB STIKOM Bali?', label: 'Akreditasi' }
];

(async () => {
  for (const program of programs) {
    console.log(`=== Program: ${program.label} (${program.code}) ===`);
    for (const q of queries) {
      const question = q.prompt.replace('{program}', program.label);
      const intent = classifyIntent(question);
      const result = await query(question, 6, { answerQuestion: question, strict: false, includeGlobal: true, minScore: 0.2 });
      console.log(`\n- ${q.label}`);
      console.log(`Question: ${question}`);
      console.log(`Detected intent: ${intent}`);
      console.log(`Answer source: ${result && result.source ? result.source : 'NO_RESULT'}`);
      if (result && result.answer) {
        console.log('Answer:');
        console.log(result.answer.trim().replace(/\n{2,}/g, '\n'));
      } else {
        console.log('Answer: MISSING');
      }
      if (result && Array.isArray(result.contexts) && result.contexts.length) {
        console.log('Top contexts:');
        result.contexts.slice(0, 3).forEach((c, i) => {
          const chunk = c && c.chunk ? String(c.chunk).replace(/\s+/g, ' ').trim().slice(0, 200) : '(no chunk)';
          console.log(`  ${i + 1}. [${c.docCategory || c.category || 'N/A'}] ${chunk}`);
        });
      }
      console.log('');
    }
  }
})();
