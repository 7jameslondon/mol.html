import assert from 'node:assert/strict';
import {
  ARTIFACT_PATH,
  REPORT_MARKER,
  calculateArtifactSizeDelta,
  formatArtifactSizeReport
} from './report-pr-artifact-size.mjs';

const pullRequest = {
  base: { ref: 'main', sha: '1111111111111111111111111111111111111111' },
  head: { ref: 'feature/build-size', sha: '2222222222222222222222222222222222222222' }
};

assert.deepEqual(
  calculateArtifactSizeDelta(1_000_000, 1_025_000),
  { bytes: 25_000, percent: 2.5 },
  'size changes are calculated relative to the merge branch'
);
assert.deepEqual(
  calculateArtifactSizeDelta(1_000_000, 900_000),
  { bytes: -100_000, percent: -10 },
  'size reductions remain negative'
);
assert.deepEqual(
  calculateArtifactSizeDelta(0, 1),
  { bytes: 1, percent: null },
  'a new artifact has no finite relative percentage'
);
assert.throws(
  () => calculateArtifactSizeDelta(-1, 1),
  /non-negative safe integers/,
  'invalid byte sizes are rejected'
);

const report = formatArtifactSizeReport({
  pullRequest,
  baseBytes: 1_000_000,
  headBytes: 1_025_000
});
assert.ok(report.startsWith(REPORT_MARKER), 'the report has a stable marker for comment updates');
assert.match(report, new RegExp(ARTIFACT_PATH.replace('.', '\\.')), 'the report identifies the artifact');
assert.match(report, /Merge branch `main` \(`1111111`\)/, 'the report identifies the merge branch revision');
assert.match(report, /PR head `feature\/build-size` \(`2222222`\)/, 'the report identifies the PR revision');
assert.match(report, /1\.000000 MB.*1,000,000 bytes/, 'the merge-branch size is reported in MB and bytes');
assert.match(report, /1\.025000 MB.*1,025,000 bytes/, 'the PR size is reported in MB and bytes');
assert.match(report, /\+0\.025000 MB \(\+2\.50%\)/, 'the absolute and relative increases are signed');

const reduction = formatArtifactSizeReport({
  pullRequest,
  baseBytes: 1_000_000,
  headBytes: 900_000
});
assert.match(reduction, /-0\.100000 MB \(-10\.00%\)/, 'reductions are reported with negative signs');

console.log('PR artifact-size report formatting passed.');
