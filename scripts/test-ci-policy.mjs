import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const workflowDirectory = resolve('.github/workflows');
const workflow = await readFile(resolve(workflowDirectory, 'ci.yml'), 'utf8');
const pagesWorkflow = await readFile(resolve(workflowDirectory, 'pages.yml'), 'utf8');
const extractActionUses = (source, name = 'workflow') => {
  const actionUses = [];
  const visit = value => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uses') {
        assert.equal(typeof child, 'string', `${name}: uses values must be strings`);
        actionUses.push(child);
      }
      visit(child);
    }
  };
  visit(parse(source));
  return actionUses;
};
const assertImmutableActionUses = (source, name) => {
  const actionUses = extractActionUses(source, name).filter(action => !action.startsWith('./'));
  for (const action of actionUses) {
    assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/, `${name}: ${action} is pinned to a full commit SHA`);
  }
  return actionUses.length;
};

const fixtureSha = 'a'.repeat(40);
const trailingSpaces = ' '.repeat(3);
assert.deepEqual(
  extractActionUses(`steps:
  - uses: owner/unnamed@${fixtureSha}${trailingSpaces}
  - name: Named action
    uses: owner/named@${fixtureSha} # pinned
  - { uses: owner/flow@${fixtureSha} }
  - "uses" : owner/quoted-key@${fixtureSha}
`),
  [
    `owner/unnamed@${fixtureSha}`,
    `owner/named@${fixtureSha}`,
    `owner/flow@${fixtureSha}`,
    `owner/quoted-key@${fixtureSha}`
  ],
  'Action discovery parses block, flow, and quoted-key workflow steps'
);
assert.throws(
  () => assertImmutableActionUses(`steps:\n  - { "uses" : owner/unpinned@v4${trailingSpaces}}\n`, 'fixture.yml'),
  /fixture\.yml: owner\/unpinned@v4 is pinned to a full commit SHA/,
  'Unpinned unnamed steps with trailing spaces are rejected'
);

assert.match(workflow, /^\s*pull_request:\s*$/m, 'CI runs for pull requests');
assert.match(workflow, /^\s*branches:\s*\[main\]\s*$/m, 'CI runs for main pushes');
assert.doesNotMatch(workflow, /pull_request_target/, 'CI never executes pull_request_target code');
assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/, 'CI has read-only repository permission');
assert.match(workflow, /persist-credentials:\s*false/g, 'checkout credentials are not persisted');
assert.match(workflow, /pnpm install --frozen-lockfile/, 'CI uses the frozen lockfile');
assert.match(workflow, /git diff --exit-code -- dist\/example\.mol\.html/, 'CI rejects a stale artifact');
assert.doesNotMatch(
  workflow,
  /^\s*(?:run:.*\b(?:publish|release|deploy)\b|-\s*name:.*\b(?:publish|release|deploy)\b)/im,
  'CI contains no release or publishing step'
);

const pagesPolicy = parse(pagesWorkflow);
assert.deepEqual(
  pagesPolicy.permissions,
  { contents: 'read' },
  'Pages grants only read access at workflow scope'
);
assert.equal(
  pagesPolicy.jobs.build.permissions,
  undefined,
  'Pages build inherits only the read-only workflow permission'
);
assert.deepEqual(
  pagesPolicy.jobs.deploy.permissions,
  { pages: 'write', 'id-token': 'write' },
  'Pages deployment credentials are scoped to the deploy job'
);
assert.equal(
  pagesPolicy.concurrency['cancel-in-progress'],
  false,
  'Pages does not interrupt an in-progress production deployment'
);

const ciActionUses = extractActionUses(workflow, 'ci.yml');
assert.ok(ciActionUses.length >= 4, 'CI uses the expected setup and diagnostic actions');

const workflowNames = (await readdir(workflowDirectory))
  .filter(name => /\.ya?ml$/i.test(name))
  .sort();
let actionCount = 0;
for (const name of workflowNames) {
  const source = await readFile(resolve(workflowDirectory, name), 'utf8');
  actionCount += assertImmutableActionUses(source, name);
}

console.log(`CI policy passed for ${actionCount} immutable action references across ${workflowNames.length} workflows.`);
