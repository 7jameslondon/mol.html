import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  expect, expectHealthyRender, guardUnexpectedNetwork, observeRuntime, openArtifact, test
} from './fixtures.mjs';

const mmcif = await readFile(resolve('fixtures/7ril-identity.cif'), 'utf8');
const multiModelMmcif = await readFile(resolve('fixtures/multi-model.cif'), 'utf8');

test('imports, renders, selects, colors, and serializes an identity-aware mmCIF document', async ({ context, page }) => {
  await guardUnexpectedNetwork(context);
  const assertNoRuntimeErrors = observeRuntime(page);
  await openArtifact(page);

  const imported = await page.evaluate(text => window.molhtml.importStructure('7ril-identity.cif', text), mmcif);
  expect(imported.version).toBe(2);
  expect(imported.structure.format).toBe('mmcif');
  expect(imported.structure.data).toContain('_atom_site.label_asym_id');
  await expect(page.locator('#structure-stats')).toContainText('4 instances');
  const summary = await page.evaluate(() => window.molhtml.getStructureSummary());
  expect(summary).toMatchObject({ format: 'mmcif', atomCount: 12, residueCount: 6, coordinateModels: [1] });
  expect(summary.instances.find(instance => instance.id === 'C')).toMatchObject({ entityId: '3', authorChains: ['B'], role: 'ligand' });
  expect(summary.assemblies[0]).toMatchObject({ id: '1', oligomericCount: 4, assemblyInstanceCount: 4 });
  await expectHealthyRender(page);

  const selection = await page.evaluate(() => window.molhtml.selectAtom(9));
  expect(selection.selector.sourceIdentity).toMatchObject({
    atomSiteId: '9', labelAsymId: 'C', labelEntityId: '3', authAsymId: 'B', authSeqId: '201'
  });
  expect(selection.identity).toMatchObject({ instanceId: 'C', entityId: '3', role: 'ligand' });

  const saved = await page.evaluate(() => window.molhtml.saveCurrentSelection('7RIL ligand instance', 'instance'));
  expect(saved.selector).toMatchObject({ kind: 'instance', instanceId: 'C' });
  const match = await page.evaluate(id => window.molhtml.getSavedSelectionMatch(id), saved.id);
  expect(match.valid).toBe(true);
  expect(match.atomCount).toBe(2);
  expect(match.atoms.every(atom => atom.sourceIdentity.labelAsymId === 'C')).toBe(true);

  await page.locator('[data-inspector-target="color"]').click();
  await page.locator('#color-mode').selectOption('instance');
  await expect.poll(() => page.evaluate(() => window.molhtml.document.scene.colorMode)).toBe('instance');
  await page.evaluate(() => window.molhtml.colorSelection('#ff0000', 'entity'));
  const document = await page.evaluate(() => window.molhtml.document);
  expect(document.scene.customColors.at(-1).selector).toMatchObject({ entityId: '3' });

  const serialized = await page.evaluate(() => window.molhtml.serialize());
  expect(serialized).toContain('"format": "mmcif"');
  expect(serialized).toContain('_atom_site.label_asym_id');
  expect(serialized).not.toContain('"topology"');
  expect(serialized).not.toContain('"coordinateSets"');
  await page.setContent(serialized, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.molhtml?.document));
  const reopened = await page.evaluate(id => ({
    document: window.molhtml.document,
    match: window.molhtml.getSavedSelectionMatch(id)
  }), saved.id);
  expect(reopened.document.version).toBe(2);
  expect(reopened.document.structure.format).toBe('mmcif');
  expect(reopened.match).toMatchObject({ valid: true, atomCount: 2 });
  await expectHealthyRender(page);
  assertNoRuntimeErrors();
});

test('renders and addresses multiple mmCIF coordinate models independently', async ({ context, page }) => {
  await guardUnexpectedNetwork(context);
  const assertNoRuntimeErrors = observeRuntime(page);
  await openArtifact(page);
  await page.evaluate(text => window.molhtml.importStructure('multi-model.cif', text), multiModelMmcif);

  const summary = await page.evaluate(() => window.molhtml.getStructureSummary());
  expect(summary).toMatchObject({ format: 'mmcif', atomCount: 4, coordinateModels: [1, 2] });
  const selection = await page.evaluate(() => window.molhtml.selectAtom({ model: 2, serial: 3 }));
  expect(selection.selector).toMatchObject({ model: 2, serial: 3 });
  const saved = await page.evaluate(() => window.molhtml.saveCurrentSelection('Second mmCIF model atom'));
  const match = await page.evaluate(id => window.molhtml.getSavedSelectionMatch(id), saved.id);
  expect(match).toMatchObject({ valid: true, atomCount: 1 });
  expect(match.atoms[0]).toMatchObject({ model: 2, serial: 3 });
  await expectHealthyRender(page);
  assertNoRuntimeErrors();
});
