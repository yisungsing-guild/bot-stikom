const fs = require('fs');
const path = require('path');
const Module = require('module');
const file = path.resolve('src/routes/provider.js');
let code = fs.readFileSync(file, 'utf8');
const marker = '  return router;';
const idx = code.lastIndexOf(marker);
if (idx < 0) throw new Error('marker not found');
code = code.slice(0, idx) + "  global.__providerInternals = { getActiveProgram, ragQueryWithEval, detectProgram, extractProgramHint, extractSpecificProgramHint, extractNonS1ProgramHint };\n" + code.slice(idx);
const m = new Module(file, module.parent);
m.filename = file;
m.paths = Module._nodeModulePaths(path.dirname(file));
m._compile(code, file);
const providerFactory = m.exports;
providerFactory({});
const internals = global.__providerInternals;
const tests = [
  'Berapa biaya Sistem Informasi?',
  'Berapa biaya Teknologi Informasi?',
  'Apa itu Sistem Informasi?',
  'Apa prospek kerja Sistem Informasi?',
  'Bagaimana syarat pendaftaran Sistem Informasi?'
];
(async () => {
  for (const text of tests) {
    const programDetected = internals.detectProgram(text);
    const getActiveProgramResult = internals.getActiveProgram({ chatId: 'test-chat', userText: text, sessionData: {} });
    let ragResult = null;
    let ragError = null;
    try {
      ragResult = await internals.ragQueryWithEval('test-chat', text, 6, { answerQuestion: text, minScore: 0 });
    } catch (e) {
      ragError = e;
    }
    console.log('---');
    console.log('QUESTION:', text);
    console.log('programDetected:', programDetected);
    console.log('getActiveProgram:', getActiveProgramResult);
    console.log('ragError:', ragError ? ragError.message : null);
    if (ragResult) {
      console.log('ragResult.source:', ragResult.source);
      console.log('ragResult.success:', ragResult.success);
      if (Array.isArray(ragResult.contexts)) console.log('ragResult.contexts:', ragResult.contexts.map(c=>c.chunk?.slice(0,80))); else console.log('ragResult.contexts:', ragResult.contexts);
      console.log('ragAnswer:', String(ragResult.answer || '').slice(0,600));
    }
  }
})();
