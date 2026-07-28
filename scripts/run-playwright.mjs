import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localTemporaryRoot = resolve(root, 'node_modules/.cache');
mkdirSync(localTemporaryRoot, { recursive: true });
const localTemporaryDirectory = mkdtempSync(join(localTemporaryRoot, 'molhtml-playwright-'));
const args = process.argv.slice(2);
const scheduledIndex = args.indexOf('--scheduled');
const scheduled = scheduledIndex >= 0;
if (scheduled) args.splice(scheduledIndex, 1);
let cli;
try {
  cli = require.resolve('@playwright/test/cli');
} catch {
  console.error('Playwright is not installed. Run pnpm install --frozen-lockfile first.');
  process.exit(1);
}

const child = spawn(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    TEMP: localTemporaryDirectory,
    TMP: localTemporaryDirectory,
    TMPDIR: localTemporaryDirectory,
    ...(scheduled ? { MOLHTML_SCHEDULED: '1' } : {})
  }
});
let temporaryDirectoryRemoved = false;
function removeTemporaryDirectory() {
  if (temporaryDirectoryRemoved) return;
  temporaryDirectoryRemoved = true;
  rmSync(localTemporaryDirectory, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 5 : 0,
    retryDelay: 100
  });
}
child.on('error', error => {
  removeTemporaryDirectory();
  console.error(`Could not start Playwright: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  removeTemporaryDirectory();
  if (signal) console.error(`Playwright was terminated by ${signal}.`);
  process.exitCode = code ?? 1;
});
process.on('exit', removeTemporaryDirectory);
