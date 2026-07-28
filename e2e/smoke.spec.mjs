import {
  expect, expectHealthyRender, guardUnexpectedNetwork, miniPeptidePath,
  observeRuntime, openArtifact, test
} from './fixtures.mjs';

test.describe('minimum browser release gate', () => {
  test.beforeEach(async ({ context }) => guardUnexpectedNetwork(context));

  test('opens the shipped file directly with a healthy molecular render', async ({ page }) => {
    const assertNoRuntimeErrors = observeRuntime(page);
    const document = await openArtifact(page);

    expect(page.url()).toMatch(/^file:/);
    expect(document.format).toBe('molhtml/document');
    expect(document.version).toBe(1);
    expect(document.structure.metadata.flags.syntheticDemo).toBe(true);
    await expect(page.locator('#structure-stats')).toContainText('atoms');
    await expectHealthyRender(page);
    assertNoRuntimeErrors();
  });

  test('imports a local PDB and resets structure-bound state', async ({ page }) => {
    const assertNoRuntimeErrors = observeRuntime(page);
    await openArtifact(page);
    await page.evaluate(() => {
      window.molhtml.selectAtom(2);
      window.molhtml.addMeasurement('distance', [1, 2], { label: 'Transient' });
      window.molhtml.saveCurrentSelection('Transient selection', 'atom');
      window.molhtml.createSavedView({ title: 'Transient view' });
    });

    await page.locator('#file-input').setInputFiles(miniPeptidePath);
    await expect.poll(() => page.evaluate(() => window.molhtml.document.title)).toBe('mini-peptide');
    const imported = await page.evaluate(() => window.molhtml.document);

    expect(imported.structure.data).toContain('ATOM');
    expect(imported.structure.metadata.provenance.kind).toBe('embedded-pdb-header');
    expect(imported.scene.selection).toBeNull();
    expect(imported.scene.measurements).toEqual([]);
    expect(imported.scene.savedSelections).toEqual([]);
    expect(imported.scene.savedViews).toEqual([]);
    await expect(page.locator('#structure-stats')).toContainText('atoms');
    await expectHealthyRender(page);
    assertNoRuntimeErrors();
  });

  test('keeps UI, document state, undo, and redo in agreement', async ({ page }) => {
    const assertNoRuntimeErrors = observeRuntime(page);
    await openArtifact(page);
    const representationButton = page.locator('[data-inspector-target="representation"]');
    await representationButton.click();
    await page.locator('#representation').selectOption('sticks');

    await expect.poll(() => page.evaluate(() => window.molhtml.document.scene.representation)).toBe('sticks');
    await expect(page.locator('#representation-ribbon-value')).toHaveText('Sticks');
    await expect(page.locator('#undo-button')).toBeEnabled();

    await page.locator('#undo-button').click();
    await expect.poll(() => page.evaluate(() => window.molhtml.document.scene.representation)).toBe('ball-and-stick');
    await expect(page.locator('#representation')).toHaveValue('ball-and-stick');

    await page.locator('#redo-button').click();
    await expect.poll(() => page.evaluate(() => window.molhtml.document.scene.representation)).toBe('sticks');
    await expect(page.locator('#representation')).toHaveValue('sticks');
    await expectHealthyRender(page);
    assertNoRuntimeErrors();
  });
});
