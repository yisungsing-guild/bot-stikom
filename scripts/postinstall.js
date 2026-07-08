const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function binPath(name) {
  const isWin = process.platform === 'win32';
  const file = isWin ? `${name}.cmd` : name;
  return path.join(__dirname, '..', 'node_modules', '.bin', file);
}

function run(bin, args, label) {
  const exists = fs.existsSync(bin);
  if (!exists) {
    // Keep postinstall resilient in production installs with --omit=dev.
    console.log(`[postinstall] Skip ${label}: binary not found (${bin})`);
    return { ok: false, skipped: true };
  }

  const r = spawnSync(bin, args, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    // On Windows, .cmd shims require a shell to execute reliably.
    shell: process.platform === 'win32'
  });

  if (r.error) {
    throw r.error;
  }

  if (r.status !== 0) {
    const sig = r.signal ? `, signal=${r.signal}` : '';
    throw new Error(`[postinstall] ${label} failed with exit code ${r.status}${sig}`);
  }

  return { ok: true };
}

try {
  // Keep existing behavior: Prisma client generation after install.
  run(binPath('prisma'), ['generate'], 'prisma generate');

  // Dev-only: apply patch-package if installed.
  // In production (npm ci --omit=dev), patch-package is not present and will be skipped.
  run(binPath('patch-package'), [], 'patch-package');
} catch (e) {
  console.error(String(e && e.message ? e.message : e));
  process.exitCode = 1;
}
