const { querySemanticRag } = require('../src/engine/semanticRagEngine');

async function testQuestion(question) {
  console.log('\n========================================');
  console.log('TESTING QUESTION:', question);
  console.log('========================================\n');
  
  const result = await querySemanticRag(question, { topK: 5 });
  
  console.log('\nRESULT:');
  console.log('- Source:', result.source);
  console.log('- Answer:', result.answer ? result.answer.substring(0, 200) + '...' : '[NO ANSWER]');
  console.log('- Success:', result.success);
  console.log('\n');
}

async function main() {
  process.env.DEBUG_SEMANTIC_HANDLER_TRACE = '1';
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
  process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-22';
  process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK = 'false';
  
  await testQuestion('nilai ku salah harus lapor siapa?');
  await testQuestion('ada sertifikasi buat mahasiswa?');
  await testQuestion('pendaftaran wisuda gimana?');
}

main().catch(console.error);
