import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workflow = await readFile(resolve('.github/workflows/ci.yml'), 'utf8');

assert.match(workflow, /^\s*pull_request:\s*$/m, 'CI runs for pull requests');
assert.match(workflow, /^\s*branches:\s*\[master\]\s*$/m, 'CI runs for master pushes');
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

const actionUses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map(match => match[1]);
assert.ok(actionUses.length >= 4, 'CI uses the expected setup and diagnostic actions');
for (const action of actionUses) {
  assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/, `${action} is pinned to a full commit SHA`);
}

console.log(`CI policy passed for ${actionUses.length} immutable action references.`);
