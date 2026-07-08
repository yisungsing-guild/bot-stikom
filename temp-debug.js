const fs = require("fs");
const text = fs.readFileSync('src/routes/provider.js', 'utf8');
const extract = (name) => {
  const re = new RegExp('function '+name+'\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)^\\}','m');
  const m = re.exec(text);
  if (!m) { console.error('not found', name); process.exit(1); }
  return 'function '+name+'('+m[1]+'){'+m[2]+'}';
};
const names = ['extractSpecificProgramHint','extractProgramHint','parseS1ProgramChoice','inferContextualFollowup','getSessionProgramHint','isProgramHintFresh','resolveProgramFromSession','shouldReuseConversationContext'];
const src = names.map(n => extract(n)).join('\n') + '\nmodule.exports={' + names.join(',') + '};';
const vm = require('vm');
const context = vm.createContext({ console, Date, RegExp });
const mod = vm.runInContext(src, context);
const sessionData = { currentProgramHint: 'Teknologi Informasi', lastProgramHint: 'Teknologi Informasi', updatedAt: new Date().toISOString(), lastProgramHintAt: new Date().toISOString() };
console.log('inferContextualFollowup', mod.inferContextualFollowup('beasiswa ada?', sessionData));
console.log('getSessionProgramHint', mod.getSessionProgramHint(sessionData));
console.log('isProgramHintFresh', mod.isProgramHintFresh(sessionData));
console.log('shouldReuseConversationContext', mod.shouldReuseConversationContext('beasiswa ada?', sessionData));
console.log('resolveProgramFromSession', mod.resolveProgramFromSession('beasiswa ada?', sessionData));
