import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  expect, miniPeptidePath, observeRuntime, openArtifact, test
} from './fixtures.mjs';

const coordinateText = await readFile(miniPeptidePath, 'utf8');
const entryPayload = JSON.parse(await readFile(resolve('e2e/fixtures/rcsb-entry-1abc.json'), 'utf8'));
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'accept, content-type',
  'content-type': 'application/json'
};

async function installRcsbRoutes(context, mode = 'normal') {
  const requests = [];
  let heldSearch = null;
  await context.route(/^https?:\/\//, async route => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    requests.push({ url, method, headers: request.headers(), body: request.postData() });

    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    if (/^https:\/\/files\.rcsb\.org\/download\/[A-Z0-9]+\.pdb$/.test(url) && method === 'GET') {
      const id = url.match(/\/([A-Z0-9]+)\.pdb$/)[1];
      if (id === '9ZZZ') await route.fulfill({ status: 404, headers: { ...corsHeaders, 'content-type': 'text/plain' }, body: 'Not found' });
      else await route.fulfill({ status: 200, headers: { ...corsHeaders, 'content-type': 'text/plain' }, body: coordinateText });
      return;
    }

    if (url === 'https://data.rcsb.org/graphql' && method === 'POST') {
      const body = request.postDataJSON();
      expect(body.query).toContain('query EntrySummaries');
      expect(Array.isArray(body.variables.ids)).toBe(true);
      if (mode === 'metadata-failure') {
        await route.fulfill({ status: 503, headers: corsHeaders, body: JSON.stringify({ error: 'unavailable' }) });
      } else {
        const entries = body.variables.ids.map(id => ({
          ...entryPayload.data.entries[0],
          rcsb_id: id
        }));
        await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({ data: { entries } }) });
      }
      return;
    }

    if (url === 'https://search.rcsb.org/rcsbsearch/v2/query' && method === 'POST') {
      const body = request.postDataJSON();
      expect(body.return_type).toBe('entry');
      expect(body.request_options.paginate).toEqual({ start: 0, rows: 12 });
      const term = body.query.parameters.value;
      if (term === 'none') {
        await route.fulfill({ status: 204, headers: corsHeaders });
      } else if (term === 'malformed') {
        await route.fulfill({ status: 200, headers: corsHeaders, body: '{not-json' });
      } else if (term === 'first held search') {
        await new Promise(resolvePromise => { heldSearch = { route, resolvePromise }; });
      } else {
        if (heldSearch) {
          await heldSearch.route.abort('aborted');
          heldSearch.resolvePromise();
          heldSearch = null;
        }
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          body: JSON.stringify({ total_count: 1, result_set: [{ identifier: '1ABC', score: 1 }] })
        });
      }
      return;
    }

    await route.abort('blockedbyclient');
  });
  return requests;
}

test('fetches exact RCSB coordinates and metadata, then preserves state on 404', async ({ context, page }) => {
  const requests = await installRcsbRoutes(context);
  const assertNoRuntimeErrors = observeRuntime(page, {
    allowConsole: [/Failed to load resource: the server responded with a status of 404/]
  });
  await openArtifact(page);

  const fetched = await page.evaluate(() => window.molhtml.fetchPDB('1abc'));
  expect(fetched.structure.source).toMatchObject({ kind: 'rcsb-pdb', pdbId: '1ABC' });
  expect(fetched.structure.metadata).toMatchObject({
    pdbId: '1ABC',
    title: 'Deterministic RCSB test structure',
    resolutionAngstroms: [1.8],
    provenance: { kind: 'rcsb-data-api', url: 'https://data.rcsb.org/graphql' }
  });
  const preservedId = fetched.structure.id;
  const failure = await page.evaluate(() => window.molhtml.fetchPDB('9ZZZ').then(() => '', error => error.message));
  expect(failure).toContain('no legacy PDB file');
  expect(await page.evaluate(() => window.molhtml.document.structure.id)).toBe(preservedId);
  await expect(page.locator('#pdb-fetch-form')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#pdb-fetch-status')).toContainText('no legacy PDB file');

  const coordinateRequests = requests.filter(request => request.url.includes('files.rcsb.org'));
  expect(coordinateRequests.filter(request => request.method === 'GET')).toHaveLength(2);
  expect(requests.some(request => request.url === 'https://data.rcsb.org/graphql' && request.method === 'POST')).toBe(true);
  assertNoRuntimeErrors();
});

test('falls back to embedded header metadata when the Data API is unavailable', async ({ context, page }) => {
  await installRcsbRoutes(context, 'metadata-failure');
  await openArtifact(page);
  const fetched = await page.evaluate(() => window.molhtml.fetchPDB('2DEF'));
  expect(fetched.structure.metadata.provenance.kind).toBe('embedded-pdb-header');
  expect(fetched.structure.metadata.metadataWarnings[0]).toContain('RCSB Data API metadata was unavailable');
});

test('covers search results, no-results, malformed data, and aborting an older search', async ({ context, page }) => {
  const requests = await installRcsbRoutes(context);
  await openArtifact(page);

  const results = await page.evaluate(() => window.molhtml.searchPDB('test peptide'));
  expect(results).toHaveLength(1);
  expect(results[0].rcsb_id).toBe('1ABC');
  await expect(page.locator('.pdb-result-load')).toHaveText('Load 1ABC');

  expect(await page.evaluate(() => window.molhtml.searchPDB('none'))).toEqual([]);
  await expect(page.locator('#pdb-search-status')).toContainText('No PDB entries matched');

  const malformed = await page.evaluate(() => window.molhtml.searchPDB('malformed').then(() => '', error => error.message));
  expect(malformed).toMatch(/JSON|Unexpected|position|malformed/i);
  await expect(page.locator('#pdb-search-form')).toHaveAttribute('aria-busy', 'false');

  await page.evaluate(() => {
    globalThis.__firstSearch = window.molhtml.searchPDB('first held search').then(
      () => 'resolved', error => error.message
    );
  });
  await expect.poll(() => requests.filter(request => request.url.includes('/query')).length).toBeGreaterThanOrEqual(4);
  const second = await page.evaluate(() => window.molhtml.searchPDB('second search'));
  expect(second[0].rcsb_id).toBe('1ABC');
  expect(await page.evaluate(() => globalThis.__firstSearch)).not.toBe('resolved');
  await expect(page.locator('#pdb-search-form')).toHaveAttribute('aria-busy', 'false');

  const posts = requests.filter(request => request.method === 'POST');
  expect(posts.every(request => request.headers.accept === 'application/json')).toBe(true);
});
