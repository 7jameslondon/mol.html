import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARTIFACT_PATH = 'dist/example.mol.html';
export const REPORT_MARKER = '<!-- molhtml-build-size-report -->';

const API_VERSION = '2022-11-28';
const MEGABYTE = 1_000_000;

const inlineCode = value => `\`${String(value).replaceAll('`', '\u02cb')}\``;
const shortSha = sha => String(sha).slice(0, 7);
const bytesLabel = bytes => `${bytes.toLocaleString('en-US')} bytes`;
const megabytesLabel = bytes => `${(bytes / MEGABYTE).toFixed(6)} MB`;

export function calculateArtifactSizeDelta(baseBytes, headBytes) {
  if (!Number.isSafeInteger(baseBytes) || baseBytes < 0 || !Number.isSafeInteger(headBytes) || headBytes < 0) {
    throw new TypeError('Artifact sizes must be non-negative safe integers.');
  }

  const bytes = headBytes - baseBytes;
  const percent = baseBytes === 0
    ? (headBytes === 0 ? 0 : null)
    : (bytes / baseBytes) * 100;
  return { bytes, percent };
}

const signed = (value, digits, suffix) => {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}${suffix}`;
};

export function formatArtifactSizeReport({ pullRequest, baseBytes, headBytes }) {
  const delta = calculateArtifactSizeDelta(baseBytes, headBytes);
  const deltaMegabytes = signed(delta.bytes / MEGABYTE, 6, ' MB');
  const deltaPercent = delta.percent === null ? 'new artifact' : signed(delta.percent, 2, '%');
  const baseDescription = `Merge branch ${inlineCode(pullRequest.base.ref)} (${inlineCode(shortSha(pullRequest.base.sha))})`;
  const headDescription = `PR head ${inlineCode(pullRequest.head.ref)} (${inlineCode(shortSha(pullRequest.head.sha))})`;

  return `${REPORT_MARKER}
## Build size

| Revision | ${inlineCode(ARTIFACT_PATH)} |
| --- | ---: |
| ${baseDescription} | **${megabytesLabel(baseBytes)}** (${bytesLabel(baseBytes)}) |
| ${headDescription} | **${megabytesLabel(headBytes)}** (${bytesLabel(headBytes)}) |
| Change vs merge branch | **${deltaMegabytes} (${deltaPercent})** |

<sub>MB uses 1,000,000 bytes. This comment updates automatically when the PR head or its merge branch changes.</sub>`;
}

function createGitHubClient(token, apiUrl = 'https://api.github.com') {
  if (!token) throw new Error('GITHUB_TOKEN is required.');

  return async function request(path, {
    method = 'GET', body, accept = 'application/vnd.github+json'
  } = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        accept,
        authorization: `Bearer ${token}`,
        'x-github-api-version': API_VERSION,
        'user-agent': 'molhtml-build-size-reporter'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const responseText = await response.text();
    const responseBody = responseText ? JSON.parse(responseText) : null;
    if (!response.ok) {
      const message = responseBody?.message || response.statusText;
      throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${message}`);
    }
    return responseBody;
  };
}

const encodeRepository = repository => repository.split('/').map(encodeURIComponent).join('/');
const encodeFilePath = path => path.split('/').map(encodeURIComponent).join('/');

async function getPullRequest(request, repository, pullNumber) {
  return request(`/repos/${encodeRepository(repository)}/pulls/${pullNumber}`);
}

async function listOpenPullRequests(request, repository, baseBranch) {
  const pullRequests = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(
      `/repos/${encodeRepository(repository)}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&per_page=100&page=${page}`
    );
    pullRequests.push(...batch);
    if (batch.length < 100) return pullRequests;
  }
}

async function getArtifactSize(request, repository, sha) {
  const file = await request(
    `/repos/${encodeRepository(repository)}/contents/${encodeFilePath(ARTIFACT_PATH)}?ref=${encodeURIComponent(sha)}`,
    { accept: 'application/vnd.github.object+json' }
  );
  if (Array.isArray(file) || file.type !== 'file' || !Number.isSafeInteger(file.size)) {
    throw new Error(`${ARTIFACT_PATH} at ${repository}@${sha} is not a file with a reported byte size.`);
  }
  return file.size;
}

async function listIssueComments(request, repository, pullNumber) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(
      `/repos/${encodeRepository(repository)}/issues/${pullNumber}/comments?per_page=100&page=${page}`
    );
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
}

async function upsertReportComment(request, repository, pullNumber, body) {
  const comments = await listIssueComments(request, repository, pullNumber);
  const existing = comments.find(comment =>
    comment.user?.login === 'github-actions[bot]' && comment.body?.includes(REPORT_MARKER)
  );
  if (existing) {
    await request(`/repos/${encodeRepository(repository)}/issues/comments/${existing.id}`, {
      method: 'PATCH', body: { body }
    });
    return 'updated';
  }

  await request(`/repos/${encodeRepository(repository)}/issues/${pullNumber}/comments`, {
    method: 'POST', body: { body }
  });
  return 'created';
}

function branchFromRef(ref) {
  const prefix = 'refs/heads/';
  if (!ref?.startsWith(prefix)) throw new Error(`Expected a branch ref, received ${JSON.stringify(ref)}.`);
  return ref.slice(prefix.length);
}

async function reportPullRequest(request, repository, pullRequest) {
  if (!pullRequest.base?.repo?.full_name || !pullRequest.head?.repo?.full_name) {
    throw new Error(`PR #${pullRequest.number} does not have readable base and head repositories.`);
  }

  const [baseBytes, headBytes] = await Promise.all([
    getArtifactSize(request, pullRequest.base.repo.full_name, pullRequest.base.sha),
    getArtifactSize(request, pullRequest.head.repo.full_name, pullRequest.head.sha)
  ]);
  const body = formatArtifactSizeReport({ pullRequest, baseBytes, headBytes });
  const result = await upsertReportComment(request, repository, pullRequest.number, body);
  const delta = calculateArtifactSizeDelta(baseBytes, headBytes);
  const relativeChange = delta.percent === null ? 'new artifact' : signed(delta.percent, 2, '%');
  console.log(`${result} build-size report for PR #${pullRequest.number}: ${megabytesLabel(headBytes)}, ${relativeChange}`);
}

export async function main(environment = process.env) {
  const repository = environment.GITHUB_REPOSITORY;
  if (!repository) throw new Error('GITHUB_REPOSITORY is required.');
  const event = JSON.parse(await readFile(environment.GITHUB_EVENT_PATH, 'utf8'));
  const request = createGitHubClient(environment.GITHUB_TOKEN, environment.GITHUB_API_URL);

  let pullRequests;
  if (event.pull_request?.number) {
    pullRequests = [await getPullRequest(request, repository, event.pull_request.number)];
  } else {
    const baseBranch = branchFromRef(event.ref || environment.GITHUB_REF);
    pullRequests = await listOpenPullRequests(request, repository, baseBranch);
  }

  if (pullRequests.length === 0) {
    console.log('No open pull requests need a build-size report.');
    return;
  }

  const failures = [];
  for (const pullRequest of pullRequests) {
    try {
      await reportPullRequest(request, repository, pullRequest);
    } catch (error) {
      failures.push(`PR #${pullRequest.number}: ${error.message}`);
    }
  }
  if (failures.length) throw new Error(`Could not update every build-size report:\n${failures.join('\n')}`);
}

const isDirectInvocation = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectInvocation) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
