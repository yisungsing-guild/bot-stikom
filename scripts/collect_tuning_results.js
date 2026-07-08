const fs = require('fs');
const path = require('path');

const reportsDir = path.join(__dirname, '..', 'reports');
const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('prodi_aspect_report_run_') && f.endsWith('.json'));
const results = [];
for (const file of files) {
  const full = path.join(reportsDir, file);
  try {
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    let total = 0, passed = 0;
    data.forEach(a => a.aspects.forEach(as => { total += 1; if (as.pass) passed += 1; }));
    results.push({ file, totalAspects: total, passed, passRate: total === 0 ? 0 : passed / total });
  } catch (err) {
    results.push({ file, error: err.message });
  }
}

const out = path.join(reportsDir, 'tuning_results.json');
fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8');
console.log('Wrote', out);
