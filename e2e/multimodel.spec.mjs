import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  expect, expectHealthyRender, guardUnexpectedNetwork, observeRuntime, openArtifact, test
} from './fixtures.mjs';

const pdb = await readFile(resolve('fixtures/multi-model.pdb'), 'utf8');

test('maps duplicate atom serials across multiple PDB coordinate models', async ({ context, page }) => {
  await guardUnexpectedNetwork(context);
  const assertNoRuntimeErrors = observeRuntime(page);
  await openArtifact(page);
  await page.evaluate(text => window.molhtml.importPDB('multi-model.pdb', text), pdb);

  await expect(page.locator('#structure-stats')).toContainText('4 atoms');
  const saved = await page.evaluate(() => window.molhtml.addSavedSelection('Second model nitrogen', {
    kind: 'atom',
    structureId: window.molhtml.document.structure.id,
    model: 2,
    chain: 'A',
    resi: 1,
    icode: '',
    resn: 'GLY',
    atom: 'N',
    altLoc: '',
    serial: 1
  }));
  const match = await page.evaluate(id => window.molhtml.getSavedSelectionMatch(id), saved.id);
  expect(match).toMatchObject({ valid: true, atomCount: 1 });
  expect(match.atoms[0].model).toBe(2);
  expect(match.atoms[0].serial).toBe(1);
  expect(await page.evaluate(id => window.molhtml.highlightSavedSelection(id, true), saved.id))
    .toMatchObject({ valid: true, atomCount: 1 });
  await expectHealthyRender(page);
  assertNoRuntimeErrors();
});
