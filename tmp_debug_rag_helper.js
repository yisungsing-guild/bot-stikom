const fs = require('fs');
const vm = require('vm');
const path = require('path');
const code = fs.readFileSync(path.join('src','engine','ragEngine.js'),'utf8');
const sandbox = {
  require,
  console,
  process,
  __dirname: path.join(process.cwd(),'src','engine'),
  __filename: path.join(process.cwd(),'src','engine','ragEngine.js'),
  module: { exports: {} },
  exports: {},
  global: {}
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const fn = sandbox.tryStructuredProgramRegistrationFeeAnswer;
const fee = fn('berapa biaya pendaftaran prodi si', {});
console.log('fee', fee);
const fee2 = sandbox.tryStructuredFeeBreakdownAnswer('biaya lengkap prodi si ada apa saja?', null, {});
console.log('fee2', fee2);
const idx = sandbox.loadIndex();
console.log('idx length', idx.length);
