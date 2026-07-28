import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const artifact = new URL('../dist/example.mol.html', import.meta.url);
const buildScript = new URL('./build.mjs', import.meta.url);

async function digest() {
  return createHash('sha256').update(await readFile(artifact)).digest('hex');
}

const before = await digest();
await execFileAsync(process.execPath, [fileURLToPath(buildScript)], { windowsHide: true });
const after = await digest();
assert.equal(after, before, 'a second build must reproduce the committed artifact byte-for-byte');

console.log(`Reproducible build passed (${after}).`);
