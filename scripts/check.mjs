import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const groups = {
  model: [
    'test-measurements.mjs', 'test-saved-selections.mjs', 'test-navigator.mjs',
    'test-ligand-analysis.mjs', 'test-metadata-quality.mjs', 'test-saved-views.mjs'
  ],
  artifact: [
    'verify.mjs', 'test-license-integrity.mjs', 'test-shell-conformance.mjs',
    'test-roundtrip.mjs', 'test-artifact-budget.mjs', 'test-ci-policy.mjs'
  ]
};

function run(label, script, args = []) {
  return new Promise((resolvePromise, reject) => {
    console.log(`\n> ${label}`);
    const child = spawn(process.execPath, [resolve(root, script), ...args], {
      cwd: root, stdio: 'inherit', windowsHide: true
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

async function runGroup(name) {
  for (const script of groups[name]) await run(script, `scripts/${script}`);
}

const requested = process.argv[2] || 'all';
try {
  if (requested === 'model') await runGroup('model');
  else if (requested === 'artifact') await runGroup('artifact');
  else if (requested === 'e2e') {
    try { await access(resolve(root, 'dist/example.mol.html'), constants.R_OK); }
    catch { throw new Error('The built artifact is missing. Run pnpm build before pnpm test:e2e.'); }
    await run('Playwright browser tests', 'scripts/run-playwright.mjs', ['test']);
  } else if (requested === 'all') {
    await run('deterministic build', 'scripts/build.mjs');
    await run('reproducible build', 'scripts/test-reproducible-build.mjs');
    await runGroup('model');
    await runGroup('artifact');
    await run('Playwright browser tests', 'scripts/run-playwright.mjs', ['test']);
  } else throw new Error(`Unknown check group "${requested}".`);
} catch (error) {
  console.error(`\nCheck failed: ${error.message}`);
  process.exitCode = 1;
}
