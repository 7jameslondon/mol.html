import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ARTIFACT_PATH,
  REPORT_MARKER,
  calculateArtifactSizeDelta,
  formatArtifactSizeReport,
  main
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

const adversarialRefReport = formatArtifactSizeReport({
  pullRequest: {
    ...pullRequest,
    head: { ...pullRequest.head, ref: 'feature|misleading-cell' }
  },
  baseBytes: 1_000_000,
  headBytes: 1_025_000
});
assert.match(
  adversarialRefReport,
  /PR head `feature\\\|misleading-cell`/,
  'pipe characters in refs cannot add cells to the Markdown table'
);

const temporaryRoot = resolve('test-results');
await mkdir(temporaryRoot, { recursive: true });
const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'molhtml-size-report-'));
const eventPath = join(temporaryDirectory, 'event.json');
const fallbackEventPath = join(temporaryDirectory, 'fallback-event.json');
const fallbackSha = '3333333333333333333333333333333333333333';
const apiPullRequest = {
  number: 22,
  base: {
    ref: 'main',
    sha: pullRequest.base.sha,
    repo: { full_name: 'owner/repository' }
  },
  head: {
    ref: 'feature/missing-artifact',
    sha: pullRequest.head.sha,
    repo: { full_name: 'contributor/repository' }
  }
};
await writeFile(eventPath, JSON.stringify({
  workflow_run: {
    event: 'pull_request',
    pull_requests: [{ number: 22 }]
  }
}), 'utf8');
await writeFile(fallbackEventPath, JSON.stringify({
  workflow_run: {
    event: 'pull_request',
    head_sha: fallbackSha,
    pull_requests: []
  }
}), 'utf8');
const originalFetch = globalThis.fetch;
let updatedComment = null;
let createdFallbackComment = null;
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = new URL(url);
  const method = options.method || 'GET';
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

  if (requestUrl.pathname === '/repos/owner/repository/pulls/22') return json(apiPullRequest);
  if (requestUrl.pathname === `/repos/owner/repository/commits/${fallbackSha}/pulls`) {
    return json([{
      number: 1,
      state: 'open',
      head: { sha: fallbackSha }
    }, {
      number: 2,
      state: 'closed',
      head: { sha: fallbackSha }
    }, {
      number: 3,
      state: 'open',
      head: { sha: '4444444444444444444444444444444444444444' }
    }]);
  }
  if (requestUrl.pathname === '/repos/owner/repository/pulls/1') {
    return json({
      number: 1,
      base: {
        ref: 'main',
        sha: pullRequest.base.sha,
        repo: { full_name: 'owner/repository' }
      },
      head: {
        ref: 'dependabot/npm_and_yarn/example-1.2.3',
        sha: fallbackSha,
        repo: { full_name: 'owner/repository' }
      }
    });
  }
  if (requestUrl.pathname.endsWith(`/${ARTIFACT_PATH}`)) {
    if (requestUrl.searchParams.get('ref') === pullRequest.base.sha) {
      return json({ type: 'file', size: 1_000_000 });
    }
    if (requestUrl.searchParams.get('ref') === fallbackSha) {
      return json({ type: 'file', size: 1_100_000 });
    }
    return json({ message: 'Not Found' }, 404);
  }
  if (requestUrl.pathname === '/repos/owner/repository/issues/22/comments' && method === 'GET') {
    return json([{
      id: 7,
      user: { login: 'github-actions[bot]' },
      body: `${REPORT_MARKER}\nPrevious successful size report`
    }]);
  }
  if (requestUrl.pathname === '/repos/owner/repository/issues/comments/7' && method === 'PATCH') {
    updatedComment = JSON.parse(options.body).body;
    return json({ id: 7, body: updatedComment });
  }
  if (requestUrl.pathname === '/repos/owner/repository/issues/1/comments' && method === 'GET') {
    return json([]);
  }
  if (requestUrl.pathname === '/repos/owner/repository/issues/1/comments' && method === 'POST') {
    createdFallbackComment = JSON.parse(options.body).body;
    return json({ id: 8, body: createdFallbackComment });
  }
  throw new Error(`Unexpected test request: ${method} ${requestUrl}`);
};

try {
  await assert.rejects(
    main({
      GITHUB_REPOSITORY: 'owner/repository',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_TOKEN: 'test-token',
      GITHUB_API_URL: 'https://api.example.test'
    }),
    /Could not update every build-size report.*Not Found/s,
    'the workflow still fails when the current head artifact is missing'
  );
  assert.ok(updatedComment?.startsWith(REPORT_MARKER), 'the missing artifact replaces the existing sticky report');
  assert.doesNotMatch(updatedComment, /Previous successful size report/, 'the old successful report is removed');
  assert.match(updatedComment, /PR head `feature\/missing-artifact` \(`2222222`\)/, 'the warning identifies the current head');
  assert.match(updatedComment, /Merge branch.*1\.000000 MB.*1,000,000 bytes/, 'the readable base size remains visible');
  assert.match(updatedComment, /PR head.*\*\*Unavailable\*\*/, 'the missing head artifact is explicit');
  assert.match(updatedComment, /Change vs merge branch.*\*\*Unavailable\*\*/, 'no stale relative change is displayed');

  await main({
    GITHUB_REPOSITORY: 'owner/repository',
    GITHUB_EVENT_PATH: fallbackEventPath,
    GITHUB_TOKEN: 'test-token',
    GITHUB_API_URL: 'https://api.example.test'
  });
  assert.ok(
    createdFallbackComment?.startsWith(REPORT_MARKER),
    'an empty workflow-run association falls back to the triggering commit'
  );
  assert.match(
    createdFallbackComment,
    /PR head `dependabot\/npm_and_yarn\/example-1\.2\.3` \(`3333333`\)/,
    'the recovered open PR receives a report for the triggering head'
  );
  assert.match(
    createdFallbackComment,
    /\+0\.100000 MB \(\+10\.00%\)/,
    'the recovered PR report compares the current head with its merge branch'
  );
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporaryDirectory, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 5 : 0,
    retryDelay: 100
  });
}

console.log('PR artifact-size report tests passed.');
