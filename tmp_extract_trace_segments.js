const fs = require('fs');
const raw = fs.readFileSync('./tmp_trace_queries_stdout.txt');
const text = raw.toString('utf16le');
const lines = text.split(/\r?\n/);
const queries = ['berapa biaya TI gelombang 1A','berapa biaya TI gelombang 2C','berapa biaya SI gelombang 2C','berapa biaya SK gelombang 1A','berapa biaya MI','berapa biaya S2 SI','berapa biaya DNUI','berapa biaya HELP','berapa biaya UTB'];
const segments = [];
let current = null;
for (const line of lines) {
  if (line.startsWith('--- QUERY START ---')) {
    current = {header: [], body: []};
    continue;
  }
  if (line.startsWith('--- QUERY END ---')) {
    if (current) segments.push(current);
    current = null;
    continue;
  }
  if (current) {
    current.body.push(line);
  }
}
fs.writeFileSync('./tmp_trace_segments.json', JSON.stringify(segments, null, 2));
console.log('segments', segments.length);
