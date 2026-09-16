'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const baseline = require('../tmp/phase6b_runtime_report.json');
const prefix = process.argv[2];
if (!prefix || !/^[a-z0-9-]+$/i.test(prefix)) throw new Error('A safe trace prefix is required');
const ids = [...new Set(baseline.failures.filter(x => x.DISPOSITION !== 'HARNESS_ONLY_FAILURE').map(x => x.TURN_ID.split('-T')[0]))].sort();
const root = path.resolve(__dirname, '..');
const results = [];

async function run(id) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'phase6b_runtime_worker.js'), id], {
      cwd: root, windowsHide: true, env: { ...process.env, PHASE_RUNTIME_OUTPUT_PREFIX: prefix },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let buffer = '', completedTurns = 0, timedOut = false, tail = '';
    const arm = () => setTimeout(() => { timedOut = true; child.kill(); }, 60000);
    let watchdog = arm();
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try {
          const turn = JSON.parse(line);
          if (!Number.isInteger(turn.turn)) continue;
          completedTurns = turn.turn;
          clearTimeout(watchdog); watchdog = arm();
        } catch (_) {}
      }
    });
    child.stderr.on('data', chunk => { tail = (tail + chunk.toString()).slice(-2000); });
    child.on('error', error => { tail = error.message; });
    child.on('close', code => {
      clearTimeout(watchdog);
      resolve({ id, exitCode: code, completedTurns, timedOut, ...(code ? { stderr: tail } : {}) });
    });
  });
}

(async () => {
  for (const id of ids) {
    const result = await run(id); results.push(result);
    console.log(JSON.stringify(result));
    fs.writeFileSync(path.join(root, 'tmp', prefix + '-execution.json'), JSON.stringify({ prefix, watchdogPerTurnMs: 30000, results }, null, 2));
  }
  process.exitCode = results.some(x => x.timedOut || x.exitCode !== 0) ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
