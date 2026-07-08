const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const root = process.cwd();
const providerPath = path.join(root, 'src', 'routes', 'provider.js');
const code = fs.readFileSync(providerPath, 'utf8');
const requireBase = Module.createRequire(providerPath);
const sandbox = {
  require: requireBase,
  console,
  process,
  __dirname: path.dirname(providerPath),
  __filename: providerPath,
  module: { exports: {} },
  exports: {},
  Buffer,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
vm.createContext(sandbox);
const wrapper = '(function(exports, require, module, __filename, __dirname){' + code + '\n return { buildProgramComparisonRewrite, detectIntent, ragQueryWithEval, autoToneOutboundText, sanitizeWhatsappText, cleanAnswerLanguage };})';
const fn = vm.runInContext(wrapper, sandbox);
const internal = fn(sandbox.exports, sandbox.require, sandbox.module, sandbox.__filename, sandbox.__dirname);
const qs = [
  'apa itu SI?',
  'di SI belajar apa?',
  'lulusan TI bekerja dimana?',
  'berapa uang semester SI?',
  'beasiswa KIP',
  'beasiswa 1K1S',
  'kapan gelombang berikutnya?',
  'masih buka pendaftaran?'
];
(async()=>{
  for(const q of qs){
    const rewriteObj = internal.buildProgramComparisonRewrite(q);
    const intent = internal.detectIntent(q);
    const topK = 10;
    let ragResult;
    try {
      ragResult = await internal.ragQueryWithEval('debug-chat', q, topK, { answerQuestion: q, strict: true });
    } catch(e) {
      console.error('ERROR', q, e && e.message);
      continue;
    }
    const finalText = internal.sanitizeWhatsappText(internal.autoToneOutboundText(String(ragResult.answer || '')));
    console.log('---');
    console.log('query:', q);
    console.log('rewrite:', rewriteObj && rewriteObj.question ? rewriteObj.question : q);
    console.log('intent:', intent);
    console.log('source:', ragResult.source);
    console.log('ragResult success:', ragResult.success);
    console.log('ragResult answer:\n' + String(ragResult.answer || '').replace(/\n/g,'\\n'));
    console.log('final text:' + finalText.replace(/\n/g,'\\n'));
  }
})();
