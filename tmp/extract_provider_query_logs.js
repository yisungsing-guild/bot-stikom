const fs = require('fs');
const path = require('path');
const tracePath = path.join(__dirname, 'provider_traces.log');
const finalPath = path.join(__dirname, 'final_wa_outputs.log');
const queries = [
  { chatId: 'r1', text: 'Apa itu PMB di STIKOM Bali?' },
  { chatId: 'r2', text: 'Jurusan apa saja yang ada di STIKOM Bali?' },
  { chatId: 'r3', text: 'Berapa biaya TI gelombang 2C?' },
  { chatId: 'r4', text: 'Apa perbedaan Sistem Informasi dan Teknik Informatika?' },
  { chatId: 'r5', text: 'Lokasi kampus dimana?' }
];

function loadJsonLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); }
      catch (e) { return { raw: line }; }
    });
}

const trace = loadJsonLines(tracePath);
const finalLog = loadJsonLines(finalPath);

function findMatches(q) {
  const keyword = q.text.replace('?', '');
  const hits = trace.filter((entry) => {
    if (entry.chatId === q.chatId) return true;
    if (entry.question && entry.question.includes(q.text)) return true;
    if (entry.question && entry.question.includes(keyword)) return true;
    if (entry.effectiveQuestion && entry.effectiveQuestion.includes(q.text)) return true;
    if (entry.effectiveQuestion && entry.effectiveQuestion.includes(keyword)) return true;
    if (entry.topic && JSON.stringify(entry.data || {}).includes(q.chatId)) return true;
    if (entry.data && JSON.stringify(entry.data).includes(q.text)) return true;
    return false;
  });
  const finals = finalLog.filter((entry) => {
    if (entry.chatId === q.chatId) return true;
    if (entry.text && entry.text.includes(q.text)) return true;
    if (entry.text && entry.text.includes(keyword)) return true;
    return false;
  });
  return { hits, finals };
}

for (const q of queries) {
  const { hits, finals } = findMatches(q);
  console.log('---', q.chatId, q.text, '---');
  console.log('TRACE COUNT:', hits.length);
  hits.slice(0, 100).forEach((entry) => console.log(JSON.stringify(entry)));
  console.log('FINAL COUNT:', finals.length);
  finals.slice(0, 20).forEach((entry) => console.log(JSON.stringify(entry)));
  console.log('');
}
