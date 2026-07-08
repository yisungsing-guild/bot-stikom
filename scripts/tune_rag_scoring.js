const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const results = [];

const programMatchBoostValues = [0.3, 0.6, 1.0];
const ragExactBoostValues = [0.5, 1.0, 2.0];

const reportsDir = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

let runIndex = 0;
for (const pmBoost of programMatchBoostValues) {
  for (const ragBoost of ragExactBoostValues) {
    runIndex += 1;
    console.log(`\n=== Run ${runIndex}: PROGRAM_MATCH_BOOST=${pmBoost}, RAG_EXACT_PROGRAM_MATCH_BOOST=${ragBoost} ===`);

    const env = Object.assign({}, process.env, {
      PROGRAM_MATCH_BOOST: String(pmBoost),
      RAG_PROGRAM_MATCH_BOOST: String(pmBoost),
      RAG_EXACT_PROGRAM_MATCH_BOOST: String(ragBoost),
      TRACE_RAG_DECISION: 'false'
    });

    const spawnRes = spawnSync('node', ['tests/run_prodi_aspects.js'], { env, cwd: process.cwd(), stdio: 'inherit', encoding: 'utf8' });

    if (spawnRes.error) {
      console.error('Child process error', spawnRes.error);
    }

    const reportPath = path.join(reportsDir, 'prodi_aspect_report.json');
    const outCopy = path.join(reportsDir, `prodi_aspect_report_run_${runIndex}.json`);
    if (fs.existsSync(reportPath)) {
      fs.copyFileSync(reportPath, outCopy);
      try {
        const data = JSON.parse(fs.readFileSync(outCopy, 'utf8'));
        let totalAspects = 0;
        let passed = 0;
        data.forEach(alias => {
          alias.aspects.forEach(a => {
            totalAspects += 1;
            if (a.pass) passed += 1;
          });
        });
        const passRate = totalAspects === 0 ? 0 : passed / totalAspects;
        results.push({ runIndex, pmBoost, ragBoost, totalAspects, passed, passRate, reportFile: `reports/prodi_aspect_report_run_${runIndex}.json` });
      } catch (err) {
        console.error('Failed to parse report JSON', err);
        results.push({ runIndex, pmBoost, ragBoost, error: 'parse_failed' });
      }
    } else {
      console.error('Report not found after run');
      results.push({ runIndex, pmBoost, ragBoost, error: 'no_report' });
    }
  }
}

const outPath = path.join(reportsDir, 'tuning_results.json');
fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
console.log('\nTuning finished. Results saved to', outPath);

// print best result
const successful = results.filter(r => r.passRate !== undefined).sort((a,b) => b.passRate - a.passRate);
if (successful.length) {
  const best = successful[0];
  console.log('\nBest config: ', best);
} else {
  console.log('\nNo successful runs to report.');
}

process.exit(0);
