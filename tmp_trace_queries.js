const fs = require('fs');
const engine = require('./src/engine/ragEngine');
const { decorateBotAnswerText } = require('./src/engine/conversationalStyle');

const queries = [
  'berapa biaya TI gelombang 1A',
  'berapa biaya TI gelombang 2C',
  'berapa biaya SI gelombang 2C',
  'berapa biaya SK gelombang 1A',
  'berapa biaya MI',
  'berapa biaya S2 SI',
  'berapa biaya DNUI',
  'berapa biaya HELP',
  'berapa biaya UTB'
];

function summarizeChunks(chunks) {
  if (!Array.isArray(chunks)) return [];
  return chunks.map((chunk, idx) => ({
    idx,
    id: chunk && chunk.id ? chunk.id : null,
    filename: chunk && chunk.filename ? chunk.filename : null,
    trainingId: chunk && chunk.trainingId ? chunk.trainingId : null,
    sourceFile: chunk && chunk.sourceFile ? chunk.sourceFile : null,
    chunkType: chunk && chunk.chunkType ? chunk.chunkType : null,
    chunkPreview: String(chunk && chunk.chunk ? chunk.chunk : '').substring(0, 240)
  }));
}

function sanitizeField(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string') return value;
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return String(value); }
}

(async () => {
  const results = [];
  for (const query of queries) {
    console.log('--- QUERY START ---');
    console.log(query);
    try {
      const res = await engine.query(query);
      const decorated = decorateBotAnswerText(res && res.answer ? res.answer : '', query);
      const debug = res && res.debug ? res.debug : null;
      const contexts = res && Array.isArray(res.contexts) ? res.contexts : (debug && Array.isArray(debug.topChunks) ? debug.topChunks : []);
      const feeStruct = debug && debug.feeStruct ? debug.feeStruct : null;
      const matchedChunks = debug && debug.matchedChunks ? debug.matchedChunks : null;
      const queryEntities = debug && debug.entity ? debug.entity : null;

      const summary = {
        query,
        answer: res && res.answer ? res.answer : null,
        source: res && res.source ? res.source : null,
        contexts: summarizeChunks(contexts),
        matchedChunks: summarizeChunks(matchedChunks),
        feeStruct: sanitizeField(feeStruct),
        queryEntities: sanitizeField(queryEntities),
        formatterInput: {
          feeStruct: sanitizeField(feeStruct),
          queryEntities: sanitizeField(queryEntities)
        },
        formatterOutput: res && res.answer ? res.answer : null,
        decoratedOutput: decorated,
        finalWhatsApp: decorated
      };
      results.push(summary);
      console.log(JSON.stringify(summary, null, 2));
    } catch (e) {
      console.error('ERROR for query', query, e && e.stack ? e.stack : e && e.message ? e.message : e);
    }
    console.log('--- QUERY END ---\n');
  }
  fs.writeFileSync('./tmp_trace_queries_results.json', JSON.stringify(results, null, 2));
})();
