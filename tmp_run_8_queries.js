const fs = require('fs');
const path = require('path');
const rag = require('./src/engine/ragEngine');

const INDEX_PATH = path.join(__dirname, 'data', 'rag_index.json');
const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));

const programs = [
  { key: 'TI', question: 'berapa biaya prodi ti gelombang 1A?', queryEntities: { intent: 'COST', program: 'TI', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' } },
  { key: 'SI', question: 'berapa biaya prodi si gelombang 1A?', queryEntities: { intent: 'COST', program: 'SI', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' } },
  { key: 'BD', question: 'berapa biaya prodi bd gelombang 1A?', queryEntities: { intent: 'COST', program: 'BD', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' } },
  { key: 'MI', question: 'berapa biaya prodi mi gelombang 1A?', queryEntities: { intent: 'COST', program: 'MI', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' } },
  { key: 'SK', question: 'berapa biaya prodi sk gelombang 1A?', queryEntities: { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' } },
  { key: 'UTB', question: 'berapa biaya prodi dengan partner utb gelombang 1A?', queryEntities: { intent: 'COST', program: null, partner: 'UTB', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' } },
  { key: 'DNUI', question: 'berapa biaya prodi dengan partner dnui gelombang 1A?', queryEntities: { intent: 'COST', program: null, partner: 'DNUI', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' } },
  { key: 'HELP', question: 'berapa biaya prodi dengan partner help gelombang 1A?', queryEntities: { intent: 'COST', program: null, partner: 'HELP', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' } }
];

const results = [];
for (const p of programs) {
  try {
    const res = rag.tryStructuredExactCostAnswer(p.question, p.queryEntities, index, 5, Array(64).fill(0));
    results.push({ key: p.key, question: p.question, res });
  } catch (e) {
    results.push({ key: p.key, question: p.question, error: String(e && e.message) });
  }
}

console.log(JSON.stringify(results, null, 2));
