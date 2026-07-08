const fs = require('fs');
const data = JSON.parse(fs.readFileSync('tmp/uat-provider-output.json','utf8'));
const q = 'Apakah ada laboratorium komputer di kampus?';
const r = data.results.find(item => item.query === q);
if (!r) {
  console.error('query not found');
  process.exit(1);
}
let inMessage = false;
for (const line of r.logs) {
  if (line.startsWith('=== FULL_FINAL_WA_MESSAGE ===')) {
    inMessage = true;
    process.stdout.write(line.slice('=== FULL_FINAL_WA_MESSAGE ==='.length) + '\n');
    continue;
  }
  if (inMessage && line.startsWith('=== ') && !line.startsWith('=== FULL_FINAL_WA_MESSAGE ===')) break;
  if (inMessage) process.stdout.write(line + '\n');
}
