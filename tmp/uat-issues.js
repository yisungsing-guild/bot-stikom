const fs = require('fs');
const summary = JSON.parse(fs.readFileSync('tmp/uat-summary.json', 'utf8'));
const issues = [];
summary.forEach(item => {
  const lower = item.finalMessage.toLowerCase();
  let kind = 'PASS';
  if (lower.includes('maaf') || lower.includes('data tidak ditemukan') || lower.includes('gagal')) kind = 'MAJOR';
  else if (lower.includes('kalau kakak ingin tahu lebih lanjut') && !lower.includes('prospek') && !lower.includes('beasiswa')) kind = 'MINOR';
  if (kind !== 'PASS') issues.push({ query: item.query, issue: kind, finalMessage: item.finalMessage.slice(0, 200) });
});
console.log(JSON.stringify(issues, null, 2));
console.log('count issues', issues.length);
