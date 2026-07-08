const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'uat-provider-output.json'), 'utf8'));
const majorQueries = new Set([
  'Kapan pendaftaran beasiswa KIP dibuka?',
  'Apa saja persyaratan beasiswa 1K1S?',
  'Apakah beasiswa 1K1S tersedia untuk TI?',
  'Apa syarat beasiswa prestasi?',
  'Bagaimana mengajukan beasiswa prestasi?',
  'Berapa besar potongan beasiswa prestasi?',
  'Berapa biaya masuk TI?',
  'Berapa biaya kuliah Sistem Informasi per semester?',
  'Biaya Bisnis Digital berapa?',
  'Berapa biaya Sistem Komputer di ITB STIKOM Bali?',
  'Berapa DPP untuk TI?',
  'Berapa biaya pendaftaran untuk SI?',
  'Bagaimana cara daftar PMB?',
  'Apa fasilitas kampus yang tersedia?',
  'Apakah ada laboratorium komputer di kampus?',
  'Bagaimana akses kantin dan fasilitas olahraga?',
  'Bagaimana cara menuju kampus dengan transportasi umum?'
]);

function extractJson(log) {
  const idx = log.indexOf('{');
  if (idx === -1) return null;
  const jsonPart = log.slice(idx);
  try { return JSON.parse(jsonPart); } catch (e) { return null; }
}

function extractMultiJson(log) {
  const matches = [...log.matchAll(/\{([\s\S]*)\}/g)];
  if (!matches.length) return null;
  try { return JSON.parse(matches[matches.length-1][0]); } catch (e) { return null; }
}

for (const item of data.results) {
  if (!majorQueries.has(item.query)) continue;
  console.log('=== QUERY ===', item.query);
  const ragDebug = item.logs.filter(l => l.includes('Provider] RAG selection debug'));
  const afterRag = item.logs.filter(l => l.startsWith('[TRACE_AFTER_RAG]'));
  const rawRag = item.logs.filter(l => l.startsWith('[TRACE_RAW_RAG_ANSWER]'));
  const final = item.logs.filter(l => l.startsWith('=== FULL_FINAL_WA_MESSAGE ==='));
  const ragOther = item.logs.filter(l => l.includes('[TRACE_RAG_SCHOLARSHIP]') || l.includes('[TRACE_RAG_') || l.includes('[TRACE_RAW_RAG_ANSWER]'));
  ragDebug.forEach(line => {
    const json = extractJson(line);
    console.log('RAG_DEBUG', JSON.stringify(json, null, 2));
  });
  afterRag.forEach(line=>console.log('AFTER_RAG', line));
  rawRag.forEach(line=>console.log('RAW_RAG', line));
  ragOther.forEach(line=>console.log('RAG_OTHER', line));
  if (final.length) console.log('FINAL_START', final[0]);
  console.log();
}
