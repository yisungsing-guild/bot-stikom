const fs=require('fs');
const rag=require('./src/engine/ragEngine.js');
const queries=JSON.parse(fs.readFileSync('tmp_trace_queries_results.json','utf8'));
const entry=queries.find(e=>e.query && e.query.toLowerCase().includes('ti') && e.query.toLowerCase().includes('1a')) || queries[0];
const sourceChunk = entry.feeStruct && entry.feeStruct.sourceChunk ? entry.feeStruct.sourceChunk : (entry.contexts && entry.contexts[0]);
const queryEntities = { program: 'TI', wave: '1A', waveGroup: '1' };
const result = rag.parseFeeStructure([sourceChunk], queryEntities);
fs.writeFileSync('tmp_parse_result.json', JSON.stringify({sourceChunkId: sourceChunk && sourceChunk.id, result}, null, 2), 'utf8');
console.log('WROTE tmp_parse_result.json');
