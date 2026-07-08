const fs = require('fs');
const files = [
  'tmp_trace_segment_0_berapa_biaya_TI_gelombang_1A.txt',
  'tmp_trace_segment_1_berapa_biaya_TI_gelombang_2C.txt',
  'tmp_trace_segment_2_berapa_biaya_SI_gelombang_2C.txt',
  'tmp_trace_segment_3_berapa_biaya_SK_gelombang_1A.txt',
  'tmp_trace_segment_4_berapa_biaya_MI.txt',
  'tmp_trace_segment_5_berapa_biaya_S2_SI.txt',
  'tmp_trace_segment_6_berapa_biaya_DNUI.txt',
  'tmp_trace_segment_7_berapa_biaya_HELP.txt',
  'tmp_trace_segment_8_berapa_biaya_UTB.txt'
];
for (const file of files) {
  const text = fs.readFileSync(file).toString('utf16le');
  const summary = {
    file,
    query: text.split('\n')[0],
    route: null,
    source: null,
    contextsCount: null,
    feeStructPresent: null,
    matchedChunksCount: null,
    prev: null,
  };
  const routeMatch = text.match(/\[TRACE_FEE_ROUTE\] \{([\s\S]*?)\}/);
  if (routeMatch) {
    summary.route = routeMatch[1].trim().split('\n').map(l => l.trim()).join(' | ').replace(/\s+/g, ' ');
  }
  const sourceMatch = text.match(/"source":\s*"([^"]+)"/);
  if (sourceMatch) summary.source = sourceMatch[1];
  const contextsMatch = text.match(/"contexts":\s*(\[.*?\])/s);
  if (contextsMatch) {
    try { summary.contextsCount = JSON.parse(contextsMatch[1]).length; } catch (e) { summary.contextsCount = 'parse error'; }
  }
  const feeMatch = text.match(/"feeStruct":\s*(null|\{.*?\})/s);
  if (feeMatch) summary.feeStructPresent = feeMatch[1].trim() !== 'null';
  const matchedChunksMatch = text.match(/"matchedChunks":\s*(\[.*?\])/s);
  if (matchedChunksMatch) {
    try { summary.matchedChunksCount = JSON.parse(matchedChunksMatch[1]).length; } catch (e) { summary.matchedChunksCount = 'parse error'; }
  }
  console.log(JSON.stringify(summary, null, 2));
}
