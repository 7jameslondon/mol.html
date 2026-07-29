import { expect, guardUnexpectedNetwork, observeRuntime, openArtifact, test } from './fixtures.mjs';

test.describe('non-covalent interaction overlays', () => {
  test.beforeEach(async ({ context }) => guardUnexpectedNetwork(context));

  test('filters, persists, and restores interaction presentation state', async ({ page }) => {
    const assertNoRuntimeErrors = observeRuntime(page);
    await openArtifact(page);
    await page.evaluate(() => {
      const line = (serial, name, resn, chain, resi, x, y, element) =>
        `${'ATOM'.padEnd(6)}${String(serial).padStart(5)} ${String(name).padStart(4)} ${resn} ${chain}${String(resi).padStart(4)}    ${Number(x).toFixed(3).padStart(8)}${Number(y).toFixed(3).padStart(8)}${'0.000'.padStart(8)}${'1.00'.padStart(6)}${'10.00'.padStart(6)}${''.padStart(10)}${element.padStart(2)}  `;
      const data = [
        line(1, 'ND2', 'ASN', 'A', 1, 0, 0, 'N'),
        line(2, 'OE1', 'GLU', 'B', 2, 3, 0, 'O'),
        line(3, 'NZ', 'LYS', 'C', 3, 0, 10, 'N'),
        line(4, 'OD1', 'ASP', 'D', 4, 4, 10, 'O'),
        line(5, 'O', 'HOH', 'E', 5, 0, 3, 'O'),
        'END'
      ].join('\n');
      const next = window.molhtml.document;
      next.structure = { id: 'interaction-e2e', name: 'Interaction fixture', format: 'pdb', data };
      next.scene.selection = null;
      next.scene.measurements = [];
      next.scene.savedSelections = [];
      next.scene.savedViews = [];
      next.scene.ligandAnalysis.selectedLigand = null;
      next.scene.interactions = {
        enabled: false,
        types: { hydrogenBonds: true, saltBridges: true },
        includeWater: false
      };
      window.molhtml.loadDocument(next, 'browser-test');
    });

    const available = await page.evaluate(() => window.molhtml.getInteractions());
    expect(available.counts).toMatchObject({ total: 3, hydrogenBonds: 2, saltBridges: 1, withWater: 1, inferred: 3 });
    expect(available.interactions).toHaveLength(3);
    expect(available.interactions[0].participants[0].selector.structureId).toBe('interaction-e2e');
    expect(available.interactions[0].participants[0]).not.toHaveProperty('x');

    const interactionsButton = page.locator('#interactions-button');
    await interactionsButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#inspector')).toBeVisible();
    await expect(interactionsButton).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#interactions-enabled').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#interactions-ribbon-value')).toHaveText('2 visible');
    await expect(page.locator('#interaction-legend')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.molhtml.getInteractions().summary.rendered)).toBe(2);

    await page.locator('#interaction-include-water').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#interactions-ribbon-value')).toHaveText('3 visible');
    await expect.poll(() => page.evaluate(() => window.molhtml.getInteractions().summary.rendered)).toBe(3);

    await page.locator('label:has(#interaction-hydrogen-bonds)').click();
    await expect.poll(() => page.evaluate(() => window.molhtml.getInteractions().summary.total)).toBe(1);
    await expect(page.locator('#interaction-legend-hydrogen')).toBeHidden();
    await expect(page.locator('#interaction-legend-salt')).toBeVisible();

    await page.locator('#undo-button').click();
    await expect.poll(() => page.evaluate(() => window.molhtml.document.scene.interactions.types.hydrogenBonds)).toBe(true);
    await page.locator('#redo-button').click();
    await expect.poll(() => page.evaluate(() => window.molhtml.document.scene.interactions.types.hydrogenBonds)).toBe(false);

    await page.locator('#interaction-salt-bridges').focus();
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => window.molhtml.getInteractions().summary.total)).toBe(0);
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => window.molhtml.getInteractions().summary.total)).toBe(1);

    const restored = await page.evaluate(() => {
      window.molhtml.setInteractions({ enabled: true, types: { hydrogenBonds: true, saltBridges: false } });
      const view = window.molhtml.createSavedView({ title: 'Hydrogen bonds' });
      window.molhtml.setInteractions({ enabled: false });
      window.molhtml.applySavedView(view.id);
      return window.molhtml.document.scene.interactions;
    });
    expect(restored).toEqual({
      enabled: true,
      types: { hydrogenBonds: true, saltBridges: false },
      includeWater: true
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('#inspector')).toBeHidden();
    await expect(interactionsButton).toBeFocused();
    assertNoRuntimeErrors();
  });

  test('invalidates cached analysis on replacement and isolates coordinate models', async ({ page }) => {
    const assertNoRuntimeErrors = observeRuntime(page);
    await openArtifact(page);
    const result = await page.evaluate(() => {
      const line = (serial, name, resn, chain, resi, x, y, element) =>
        `${'ATOM'.padEnd(6)}${String(serial).padStart(5)} ${String(name).padStart(4)} ${resn} ${chain}${String(resi).padStart(4)}    ${Number(x).toFixed(3).padStart(8)}${Number(y).toFixed(3).padStart(8)}${'0.000'.padStart(8)}${'1.00'.padStart(6)}${'10.00'.padStart(6)}${''.padStart(10)}${element.padStart(2)}  `;
      const next = window.molhtml.document;
      next.structure = {
        id: 'replacement-cache-e2e', name: 'Separate models', format: 'pdb',
        data: ['MODEL        1', line(1, 'ND2', 'ASN', 'A', 1, 0, 0, 'N'), 'ENDMDL',
          'MODEL        2', line(2, 'OE1', 'GLU', 'B', 2, 3, 0, 'O'), 'ENDMDL', 'END'].join('\n')
      };
      next.scene.interactions = {
        enabled: true, types: { hydrogenBonds: true, saltBridges: true }, includeWater: true
      };
      window.molhtml.loadDocument(next, 'browser-test');
      const separateModels = window.molhtml.getInteractions();
      next.structure = {
        ...next.structure,
        name: 'Same model',
        data: [line(1, 'ND2', 'ASN', 'A', 1, 0, 0, 'N'),
          line(2, 'OE1', 'GLU', 'B', 2, 3, 0, 'O'), 'END'].join('\n')
      };
      window.molhtml.loadDocument(next, 'browser-test');
      return { separateModels, replacement: window.molhtml.getInteractions() };
    });
    expect(result.separateModels.counts.total).toBe(0);
    expect(result.replacement.counts).toMatchObject({ total: 1, hydrogenBonds: 1 });
    expect(result.replacement.summary.rendered).toBe(1);
    expect(result.replacement.interactions[0].participants[0].selector.structureId).toBe('replacement-cache-e2e');
    assertNoRuntimeErrors();
  });

  test('reports and enforces the 500-line merged display cap', async ({ page }) => {
    const assertNoRuntimeErrors = observeRuntime(page);
    await openArtifact(page);
    const summary = await page.evaluate(() => {
      const line = (serial, name, resn, chain, resi, x, y, element) =>
        `${'ATOM'.padEnd(6)}${String(serial).padStart(5)} ${String(name).padStart(4)} ${resn} ${chain}${String(resi).padStart(4)}    ${Number(x).toFixed(3).padStart(8)}${Number(y).toFixed(3).padStart(8)}${'0.000'.padStart(8)}${'1.00'.padStart(6)}${'10.00'.padStart(6)}${''.padStart(10)}${element.padStart(2)}  `;
      const rows = [];
      for (let pair = 0; pair < 600; pair += 1) {
        const distance = 2.5 + pair / 1_000;
        rows.push(line(pair * 2 + 1, 'ND2', 'ASN', 'A', pair * 2 + 1, 0, pair * 10, 'N'));
        rows.push(line(pair * 2 + 2, 'OE1', 'GLU', 'B', pair * 2 + 2, distance, pair * 10, 'O'));
      }
      rows.push('END');
      const next = window.molhtml.document;
      next.structure = { id: 'interaction-cap-e2e', name: 'Interaction cap', format: 'pdb', data: rows.join('\n') };
      next.scene.interactions = {
        enabled: true, types: { hydrogenBonds: true, saltBridges: false }, includeWater: false
      };
      window.molhtml.loadDocument(next, 'browser-test');
      return window.molhtml.getInteractions().summary;
    });
    expect(summary).toMatchObject({ total: 600, rendered: 500, omitted: 100 });
    await page.locator('#interactions-button').click();
    await expect(page.locator('#interaction-summary')).toContainText('600 qualifying interactions');
    await expect(page.locator('#interaction-summary')).toContainText('500 drawn');
    await expect(page.locator('#interaction-truncation')).toContainText('100 qualifying interactions');
    assertNoRuntimeErrors();
  });
});
