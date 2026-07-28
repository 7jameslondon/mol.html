import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  closeContext, expect, expectHealthyRender, guardUnexpectedNetwork, installClipboardMock,
  installPickerMock, ligandPocketPath, miniPeptidePath, observeRuntime,
  openArtifact, savedPickerHtml, test
} from './fixtures.mjs';

const miniPeptide = await readFile(miniPeptidePath, 'utf8');
const ligandPocket = await readFile(ligandPocketPath, 'utf8');

test.beforeEach(async ({ context }) => {
  await guardUnexpectedNetwork(context);
});

test('persists selection, measurement, named selection, and saved-view stories', async ({ browser, context, page }, testInfo) => {
  await installClipboardMock(context);
  await installPickerMock(context);
  const assertNoRuntimeErrors = observeRuntime(page);
  await openArtifact(page);
  const state = await page.evaluate(pdb => {
    return window.molhtml.importPDB('workflow.pdb', pdb).then(() => {
      const selection = window.molhtml.selectAtom(2);
      const measurement = window.molhtml.addMeasurement('distance', [1, 2], {
        label: 'Backbone distance', note: 'Browser workflow'
      });
      const named = window.molhtml.saveCurrentSelection('Chosen residue', 'residue');
      const nearby = window.molhtml.addSavedSelection('Nearby atoms', {
        kind: 'within', structureId: window.molhtml.document.structure.id, cutoff: 4,
        target: { ...selection.selector, kind: 'atom' }
      });
      const first = window.molhtml.createSavedView({ title: 'Overview', narrative: 'Opening view' });
      window.molhtml.colorSelection('#ff0000', 'atom');
      const second = window.molhtml.createSavedView({ title: 'Selected atom', narrative: 'Highlighted atom' });
      const duplicate = window.molhtml.duplicateSavedView(second.id);
      window.molhtml.moveSavedView(duplicate.id, -1);
      return { selection, measurement, named, nearby, first, second };
    });
  }, miniPeptide);

  await expect(page.locator('#inspector')).toBeVisible();
  await expect(page.locator('#panel-inspect')).toBeVisible();
  await page.locator('#copy-selection').click();
  const clipboard = await page.evaluate(() => globalThis.__molhtmlClipboard.text);
  expect(JSON.parse(clipboard).identity.serial).toBe(2);
  expect(await page.evaluate(() => window.molhtml.getMeasurements()[0].note)).toBe('Browser workflow');
  expect(await page.evaluate(id => window.molhtml.getSavedSelectionMatch(id).valid, state.nearby.id)).toBe(true);

  await page.evaluate(id => window.molhtml.startStory(id), state.first.id);
  await expect(page.locator('#story-overlay')).toBeVisible();
  await expect(page.locator('#story-title')).toHaveText('Overview');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#story-title')).not.toHaveText('Overview');
  await page.keyboard.press('Escape');
  await expect(page.locator('#story-overlay')).toBeHidden();

  await page.locator('#save-button').click();
  const savedHtml = await savedPickerHtml(page);
  const savedPath = testInfo.outputPath('molecular-workflow.mol.html');
  await writeFile(savedPath, savedHtml, 'utf8');
  const savedDocument = await page.evaluate(() => window.molhtml.document);

  const reopenedContext = await browser.newContext();
  await guardUnexpectedNetwork(reopenedContext);
  const reopened = await reopenedContext.newPage();
  await openArtifact(reopened, { url: pathToFileURL(savedPath).href });
  const persisted = await reopened.evaluate(() => ({
    selection: window.molhtml.getSelection(),
    measurements: window.molhtml.getMeasurements(),
    savedSelections: window.molhtml.getSavedSelections(),
    savedViews: window.molhtml.getSavedViews()
  }));
  expect(persisted.selection.identity.serial).toBe(2);
  expect(persisted.measurements).toHaveLength(1);
  expect(persisted.savedSelections).toHaveLength(2);
  expect(persisted.savedViews).toHaveLength(3);
  expect(await reopened.evaluate(() => window.molhtml.document.documentId)).toBe(savedDocument.documentId);
  await closeContext(reopenedContext);
  assertNoRuntimeErrors();
});

test('covers ligand-pocket state and all representation modes including surface', async ({ page }) => {
  const assertNoRuntimeErrors = observeRuntime(page);
  await openArtifact(page);
  await page.evaluate(pdb => window.molhtml.importPDB('ligand-pocket.pdb', pdb), ligandPocket);
  const ligands = await page.evaluate(() => window.molhtml.listLigands());
  expect(ligands.length).toBeGreaterThan(0);
  const analysis = await page.evaluate(key => {
    window.molhtml.selectLigand(key);
    window.molhtml.setLigandAnalysis({ cutoff: 5, showContacts: false, polarOnly: true });
    return window.molhtml.getLigandAnalysis();
  }, ligands[0].key);
  expect(analysis.state).toMatchObject({ cutoff: 5, showContacts: false, polarOnly: true });
  expect(analysis.residues.length).toBeGreaterThan(0);
  await page.locator('[data-inspector-target="ligands"]').click();
  await expect(page.locator('#ligand-analysis-summary')).not.toBeEmpty();

  await page.locator('[data-inspector-target="representation"]').click();
  for (const representation of ['cartoon', 'ball-and-stick', 'sticks', 'spacefill', 'lines', 'surface']) {
    await page.locator('#representation').selectOption(representation);
    await expect.poll(() => page.evaluate(() => window.molhtml.document.scene.representation)).toBe(representation);
    await expect(page.locator('#canvas-message')).toBeHidden();
    await expectHealthyRender(page);
  }
  assertNoRuntimeErrors();
});

test('supports keyboard inspector dismissal, focus restoration, history, save, and stories', async ({ context, page }) => {
  await installPickerMock(context);
  await openArtifact(page);
  const representationButton = page.locator('[data-inspector-target="representation"]');
  await representationButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#inspector')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toBeHidden();
  await expect(representationButton).toBeFocused();

  await representationButton.press('Enter');
  await page.locator('#representation').selectOption('lines');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#representation')).toHaveValue('ball-and-stick');
  await page.keyboard.press('Control+y');
  await expect(page.locator('#representation')).toHaveValue('lines');
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => globalThis.__molhtmlPicker.writes)).toBe(1);

  await page.evaluate(() => {
    const first = window.molhtml.createSavedView({ title: 'Keyboard one' });
    window.molhtml.createSavedView({ title: 'Keyboard two' });
    window.molhtml.startStory(first.id);
  });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#story-title')).toHaveText('Keyboard two');
  await page.keyboard.press('Escape');
  await expect(page.locator('#molecule-viewer')).toBeFocused();
});
