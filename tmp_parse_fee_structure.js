const fs = require('fs');
const rag = require('./src/engine/ragEngine');
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
  const contexts = item.res && Array.isArray(item.res.contexts) ? item.res.contexts : [];
  const fee = rag.parseFeeStructure(contexts, q);
  console.log('===', key, '===');
  console.log('selectedContexts:', contexts.map(c => ({ id: c.id, filename: c.filename })));
  console.log('parseFeeStructure:', JSON.stringify(fee, null, 2));
  console.log('');
}
