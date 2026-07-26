const { querySemanticRag } = require('../src/engine/semanticRagEngine');

async function traceQuestion(question) {
  console.log('\n=== TRACE FOR QUESTION ===');
  console.log('Question:', question);
  
  const result = await querySemanticRag(question);
  
  console.log('\n=== RESULT ===');
  console.log('Success:', result.success);
  console.log('Source:', result.source);
  console.log('Answer:', result.answer);
  console.log('Contexts count:', result.contexts ? result.contexts.length : 0);
  
  if (result.contexts && result.contexts.length > 0) {
    console.log('\n=== CONTEXTS ===');
    result.contexts.forEach((ctx, i) => {
      console.log(`Context ${i}:`, ctx.source || ctx.filename, ctx.text ? ctx.text.substring(0, 100) : 'N/A');
    });
  }
  
  return result;
}

async function main() {
  process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-22';
  process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
  process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK = 'false';
  process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  
  // Test 1: "nilai ku salah harus lapor siapa?"
  await traceQuestion('nilai ku salah harus lapor siapa?');
  
  // Test 2: "ada sertifikasi buat mahasiswa?" (likely the failing one)
  await traceQuestion('ada sertifikasi buat mahasiswa?');
  
  // Test 3: "pendaftaran wisuda gimana?"
  await traceQuestion('pendaftaran wisuda gimana?');
  
  // Test all student affairs questions to find which one returns [NO ANSWER]
  console.log('\n\n=== TESTING ALL STUDENT AFFAIRS QUESTIONS ===');
  const studentAffairsQuestions = [
    'gabung bem gimana?',
    'ada sertifikasi buat mahasiswa?',
    'negara partner double degree mana aja?',
    'kelas internasional ada ga?',
    'hubungi dosen lewat mana?',
    'minta transkrip nilai gimana?',
    'ada loker ga dari kampus?',
    'nomor admin kampus berapa?'
  ];
  
  for (const q of studentAffairsQuestions) {
    await traceQuestion(q);
  }
}

main().catch(console.error);
