import { spawn } from 'node:child_process';
import { readdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoverageReport } from 'monocart-coverage-reports';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = resolve(root, 'coverage/playwright');
const rawDirectory = resolve(root, 'test-results/coverage-raw');
const coverageEntryPattern = /^molhtml:\/\/\/src\/(?:model|renderer|persistence|app)\.js$/;

function run(label, script, args = [], env = {}) {
  return new Promise((resolvePromise, reject) => {
    console.log(`\n> ${label}`);
    const child = spawn(process.execPath, [resolve(root, script), ...args], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, ...env }
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

await rm(reportDirectory, { recursive: true, force: true });
await rm(rawDirectory, { recursive: true, force: true });
await run('build the Playwright coverage subject', 'scripts/build.mjs');
await run('collect Playwright JavaScript coverage', 'scripts/run-playwright.mjs', ['test'], {
  MOLHTML_COVERAGE: '1'
});

let rawFiles;
try {
  rawFiles = (await readdir(rawDirectory)).filter(name => name.endsWith('.json')).sort();
} catch {
  rawFiles = [];
}
if (!rawFiles.length) {
  throw new Error('Playwright did not collect application coverage. Ensure the Chromium tests opened the built artifact.');
}

const report = new CoverageReport({
  name: 'Playwright application coverage',
  baseDir: root,
  outputDir: reportDirectory,
  entryFilter: entry => coverageEntryPattern.test(entry.url),
  sourcePath: filePath => {
    const match = filePath.replaceAll('\\', '/').match(/src\/(model|renderer|persistence|app)\.js$/);
    return match ? `src/${match[1]}.js` : filePath;
  },
  reports: [
    ['v8', { outputFile: 'index.html', metrics: ['bytes', 'functions', 'lines'] }],
    ['console-details', { metrics: ['bytes', 'functions', 'lines'] }],
    ['lcovonly', { file: 'lcov.info' }],
    ['json-summary', { file: 'coverage-summary.json' }],
    ['markdown-summary', { outputFile: 'coverage-summary.md', metrics: ['bytes', 'functions', 'lines'] }]
  ],
  clean: true,
  cleanCache: true
});

for (const name of rawFiles) {
  const entries = JSON.parse(await readFile(resolve(rawDirectory, name), 'utf8'));
  await report.add(entries);
}
const results = await report.generate();
if (!results) throw new Error('The Playwright coverage report was empty.');

const expectedSources = new Set([
  'src/model.js',
  'src/renderer.js',
  'src/persistence.js',
  'src/app.js'
]);
for (const file of results.files) expectedSources.delete(file.sourcePath.replaceAll('\\', '/'));
if (expectedSources.size) {
  throw new Error(`Playwright coverage is missing expected sources: ${[...expectedSources].join(', ')}.`);
}

const thresholds = {
  bytes: 75,
  functions: 60,
  lines: 64
};
const failures = [];
for (const [metric, minimum] of Object.entries(thresholds)) {
  const actual = Number(results.summary[metric].pct);
  if (!Number.isFinite(actual) || actual < minimum) {
    failures.push(`${metric} ${Number.isFinite(actual) ? actual : 'unknown'}% < ${minimum}%`);
  }
}
if (failures.length) throw new Error(`Playwright coverage thresholds failed: ${failures.join(', ')}.`);
