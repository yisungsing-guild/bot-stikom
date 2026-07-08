const fs = require('fs');
const { query } = require('./src/engine/ragEngine');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'fatal';
process.env.RAG_DEBUG_LOGS = 'false';
process.env.RAG_DEBUG_CHUNK_SCORING = 'false';
process.env.RAG_DEBUG_INTENT_FILTERING = 'false';
process.env.RAG_AUDIT_LOGGING = 'false';
process.env.OPENAI_RAG_MODEL = 'gpt-4o-mini';

const cases = [
  { id: 'hobby-ngoding', question: 'hoby saya suka ngoding cocok jurusan apa?', expected: 'retrieval-first hobby docs', allowSources: ['gpt-4o-mini', 'rag-major-recommendation', 'rag-major-recommendation-hoby-doc', 'rag-major-recommendation-hoby-doc-lines'] },
  { id: 'hobby-memasak', question: 'anak saya suka memasak cocok jurusan apa?', expected: 'no hardcoded SK drift' },
  { id: 'dual-degree-general', question: 'apakah ada program dual degree di stikom?', expected: 'dual-degree list' },
  { id: 'double-degree-intl', question: 'apakah ada di stikom program double degree internasional?', expected: 'international only dual-degree list' },
  { id: 'double-degree-nasional', question: 'apakah ada di stikom program double degree nasional?', expected: 'national only dual-degree list' },
  { id: 'dual-degree-discount', question: 'kalau biaya untuk double degree apakah ada potongan biaya?', expected: 'DPP discount list' },
  { id: 'program-def-si', question: 'Jelaskan apa itu program studi Sistem Informasi di ITB STIKOM Bali', expected: 'program definition retrieval' },
  { id: 'program-cur-ti', question: 'Apa saja yang dipelajari di Teknologi Informasi? Jelaskan kurikulumnya.', expected: 'curriculum retrieval' },
  { id: 'program-career-bd', question: 'Prospek kerja lulusan Bisnis Digital di ITB STIKOM Bali seperti apa?', expected: 'career retrieval' },
  { id: 'program-accred-sk', question: 'Apa akreditasi program Sistem Komputer di ITB STIKOM Bali?', expected: 'accreditation retrieval' },
  { id: 'out-of-scope-hello', question: 'halo, apa kabar?', expected: 'greeting/not RAG fallback' },
  { id: 'out-of-scope-thanks', question: 'terima kasih, sampai jumpa', expected: 'farewell/not RAG fallback' },
  { id: 'requirement-query', question: 'Apa persyaratan untuk melakukan pendaftaran kuliah di STIKOM Bali?', expected: 'PMB requirements or no-answer' }
];

(async () => {
  const results = [];

  for (const item of cases) {
    const res = await query(item.question, 6, {
      answerQuestion: item.question,
      strict: false,
      includeGlobal: true,
      minScore: 0.2,
      returnDebug: true
    });

    results.push({
      id: item.id,
      question: item.question,
      expected: item.expected,
      source: res.source || null,
      confidenceTier: res.confidenceTier || null,
      answerPresent: res.answer != null,
      answer: typeof res.answer === 'string' ? res.answer.slice(0, 500) : res.answer,
      contexts: Array.isArray(res.contexts) ? res.contexts.map(c => ({ id: c.id || null, filename: c.filename || c.trainingId || null, score: c.score || null, category: c.category || null })) : [],
      debug: res.debug || null,
      success: res.success === true,
      raw: res
    });
  }

  fs.writeFileSync('audit_summary.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Audit summary written to audit_summary.json');
})();
