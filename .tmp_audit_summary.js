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
      const result = await query(question, 6, { answerQuestion: question, strict: false, includeGlobal: true, minScore: 0.2, returnDebug: true });
      const intent = classifyIntent(question);
      const error = result.error ? result.error : '-';
      const src = result.source || '-';
      const model = result.model || (result.debug && result.debug.aiModel) || '-';
      const score = result.confidenceScore !== undefined ? result.confidenceScore : '-';
      console.log(`${q.label}|${program.code}|${src}|${model}|${intent}|${score}|${error}`);
    }
  }
})();
