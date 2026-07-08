const fs = require('fs');
const path = require('path');
const vm = require('vm');
const enginePath = path.join(__dirname, 'src', 'engine', 'ragEngine.js');
const rawCode = fs.readFileSync(enginePath, 'utf8');
const code = rawCode + '\nmodule.exports._parseFeeStructure = parseFeeStructure;';
const Module = require('module');
const m = new Module(enginePath, module.parent);
m.filename = enginePath;
m.paths = Module._nodeModulePaths(path.dirname(enginePath));
try {
  m._compile(code, enginePath);
} catch (err) {
  console.error('compile error', err);
  throw err;
}
const parseFeeStructure = m.exports._parseFeeStructure;
if (!parseFeeStructure) {
  throw new Error('parseFeeStructure not found in module');
}
const data = JSON.parse(fs.readFileSync('tmp_run_8_queries_out.json', 'utf8'));
const queries = {
  TI: { intent: 'COST', program: 'TI', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' },
  SI: { intent: 'COST', program: 'SI', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' },
  BD: { intent: 'COST', program: 'BD', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' },
  MI: { intent: 'COST', program: 'MI', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' },
  SK: { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' },
  UTB: { intent: 'COST', program: null, partner: 'UTB', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' },
  DNUI: { intent: 'COST', program: null, partner: 'DNUI', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' },
  HELP: { intent: 'COST', program: null, partner: 'HELP', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' }
};
for (const item of data) {
  const key = item.key;
  const q = queries[key];
  const contexts = item.res && item.res.contexts ? item.res.contexts : [];
  const fee = parseFeeStructure(contexts, q);
  console.log('===', key, '===');
  console.log('feeStruct:', JSON.stringify(fee, null, 2));
  console.log('');
}
