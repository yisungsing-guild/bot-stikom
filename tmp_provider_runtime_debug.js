const fs = require('fs');
const path = require('path');
const Module = require('module');

const providerPath = path.join(__dirname, 'src', 'routes', 'provider.js');
const providerSrc = fs.readFileSync(providerPath, 'utf8');
const injectionPoint = providerSrc.lastIndexOf('return router;');
if (injectionPoint < 0) {
  throw new Error('Could not find return router; in provider.js');
}

const instrumentation = `
  if (provider && typeof provider === 'object') {
    provider.__internals = provider.__internals || {};
    provider.__internals.answerTotalCostForS1Program = answerTotalCostForS1Program;
    provider.__internals.ragQueryWithEval = ragQueryWithEval;
    provider.__internals.detectProgram = detectProgram;
    provider.__internals.extractProgramHint = extractProgramHint;
    provider.__internals.extractSpecificProgramHint = extractSpecificProgramHint;
    provider.__internals.extractStructuredEntities = extractStructuredEntities;
  }
`;

const instrumentedSrc = providerSrc.slice(0, injectionPoint) + instrumentation + providerSrc.slice(injectionPoint);

const providerModule = new Module(providerPath, module.parent);
providerModule.filename = providerPath;
providerModule.paths = Module._nodeModulePaths(path.dirname(providerPath));
providerModule._compile(instrumentedSrc, providerPath);

const mockProvider = { name: 'DEBUG_PROVIDER' };
const router = providerModule.exports(mockProvider);
const internal = mockProvider.__internals;
if (!internal) {
  throw new Error('Provider internals not available');
}

process.env.ENABLE_RAG = 'true';
process.env.ENABLE_AI = 'true';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.RAG_AUDIT_LOGGING = 'true';
process.env.RAG_DEBUG_CHUNK_SCORING = 'true';
process.env.RAG_TOP_K = '6';
process.env.RAG_MIN_SCORE = '0.0';

const traceHeader = () => console.log('\n=== DEBUG TRACE ===');

const queries = [
  { label: 'TI cost', program: 'Teknologi Informasi', text: 'Berapa biaya TI?' },
  { label: 'SI cost', program: 'Sistem Informasi', text: 'Berapa biaya Sistem Informasi?' },
  { label: 'BD cost', program: 'Bisnis Digital', text: 'Berapa biaya Bisnis Digital?' },
  { label: 'SK def', text: 'Apa itu SK?' },
  { label: 'SK Definition', text: 'Apa itu Sistem Komputer?' }
];

const printEntities = (q) => {
  const entities = internal.extractStructuredEntities(q);
  console.log('[ENTITY CHECK]', q);
  console.log('  program:', entities.program);
  console.log('  programLabel:', entities.programLabel);
  console.log('  intent:', entities.intent);
  console.log('  academicIntent:', entities.academicIntent);
  return entities;
};

const pretty = (obj) => JSON.stringify(obj, null, 2);

(async () => {
  console.log('Provider runtime debug script');
  console.log('Using provider internals attached to mock provider');
  console.log('Environment: ENABLE_RAG=' + process.env.ENABLE_RAG + ', FORCE_BUNDLED_INDEX=' + process.env.FORCE_BUNDLED_INDEX);

  for (const q of queries) {
    console.log('\n' + '#'.repeat(120));
    console.log(`QUERY: ${q.label}`);
    console.log(`TEXT: ${q.text}`);
    traceHeader();

    if (q.program) {
      console.log('[CALL CHAIN] detectProgram() -> answerTotalCostForS1Program() -> ragQueryWithEval() -> extractStructuredEntities() -> final answer');
      console.log('[STEP] detectProgram on user text:');
      const detected = internal.detectProgram(q.text);
      console.log('  detectProgram:', detected);
      console.log('[STEP] exact program hint passed into answerTotalCostForS1Program:');
      console.log('  programHint:', q.program);
      console.log('[TRACE] starting answerTotalCostForS1Program');
      try {
        const answer = await internal.answerTotalCostForS1Program('debug-chat', q.program, q.text);
        console.log('[FINAL ANSWER]');
        console.log(answer);
      } catch (err) {
        console.error('[ERROR answerTotalCostForS1Program]', err && err.stack ? err.stack : err);
      }
    } else {
      console.log('[CALL CHAIN] ragQueryWithEval() -> extractStructuredEntities() -> final answer');
      console.log('[TRACE] starting ragQueryWithEval for definition query');
      try {
        const result = await internal.ragQueryWithEval('debug-chat', q.text, 6, { answerQuestion: q.text, strict: true, minScore: 0.0, returnDebug: true });
        console.log('[FINAL ANSWER]');
        console.log(result.answer);
        console.log('[RAG RESULT META]');
        console.log(pretty({ source: result.source, success: result.success, score: result.score, confidenceTier: result.confidenceTier, contexts: (result.contexts || []).slice(0, 5).map(c => ({ id: c.id, filename: c.filename, category: c.category, score: c.score })) }));
      } catch (err) {
        console.error('[ERROR ragQueryWithEval]', err && err.stack ? err.stack : err);
      }
    }

    console.log('[ENTITY SNAPSHOT]');
    printEntities(q.text);
  }

  console.log('\n' + '='.repeat(120));
  console.log('Additional SKS-specific verification');
  const sksEntities = internal.extractStructuredEntities('pengakuan SKS');
  console.log('extractStructuredEntities("pengakuan SKS") =', pretty(sksEntities));
  const sksNorm = internal.normalizeProgramLabel('SKS');
  console.log('normalizeProgramLabel("SKS") =', sksNorm);

  console.log('Direct canonical mapping checks:');
  for (const v of ['TI', 'SI', 'BD', 'SK']) {
    const norm = internal.normalizeProgramLabel(v);
    console.log(`  normalizeProgramLabel('${v}') =`, norm, '-> programLabel =', internal.extractStructuredEntities(v).programLabel);
  }
})();
