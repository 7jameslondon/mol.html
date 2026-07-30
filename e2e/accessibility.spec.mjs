import AxeBuilder from '@axe-core/playwright';
import {
  expect, guardUnexpectedNetwork, openArtifact, test
} from './fixtures.mjs';

test.beforeEach(async ({ context }) => guardUnexpectedNetwork(context));

async function seriousViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact));
}

test('has no serious or critical accessibility violations in primary UI states', async ({ page }) => {
  await openArtifact(page);
  expect(await seriousViolations(page)).toEqual([]);

  for (const target of ['representation', 'navigator', 'measurements', 'saved-selections', 'ligands', 'interactions', 'metadata', 'saved-views', 'export']) {
    await page.locator(`[data-inspector-target="${target}"]`).click();
    await expect(page.locator('#inspector')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  }

  await page.evaluate(() => window.molhtml.setInteractions({ enabled: true }));
  await expect(page.locator('#interaction-legend')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.evaluate(() => {
    const first = window.molhtml.createSavedView({ title: 'Accessible story one', narrative: 'First scene' });
    window.molhtml.createSavedView({ title: 'Accessible story two', narrative: 'Second scene' });
    window.molhtml.startStory(first.id);
  });
  await expect(page.locator('#story-overlay')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('keeps the export workflow accessible by keyboard at the narrow breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 640 });
  await openArtifact(page);
  const exportButton = page.locator('[data-inspector-target="export"]');
  await exportButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#panel-export')).toBeVisible();
  const inspectorBox = await page.locator('#inspector').boundingBox();
  expect(inspectorBox.x).toBeGreaterThanOrEqual(0);
  expect(inspectorBox.x + inspectorBox.width).toBeLessThanOrEqual(560);

  await page.locator('#export-size').selectOption('custom');
  await page.getByText('Lock aspect ratio', { exact: true }).click();
  await page.locator('#export-width').fill('63');
  await expect(page.locator('#export-width')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#export-height')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#export-width')).toHaveAttribute('aria-errormessage', 'export-status');
  await expect(page.locator('#export-status')).toContainText('at least 64 pixels');
  expect(await seriousViolations(page)).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toBeHidden();
  await expect(exportButton).toBeFocused();
});

test('keeps video progress, status, and cancellation accessible while busy', async ({ page }) => {
  await openArtifact(page);
  await page.locator('[data-inspector-target="export"]').click();
  await page.evaluate(() => {
    globalThis.__turntableStatusMutations = 0;
    new MutationObserver(() => { globalThis.__turntableStatusMutations += 1; })
      .observe(document.querySelector('#export-status'), { childList: true, characterData: true, subtree: true });
  });
  await page.locator('#turntable-download').click();
  await expect(page.locator('#turntable-cancel')).toBeVisible();
  await expect(page.locator('#turntable-cancel')).toBeFocused();
  await expect(page.locator('#export-options')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#turntable-progress')).toHaveAttribute('aria-label', 'Turntable video recording progress');
  await expect(page.locator('#turntable-progress')).toHaveAttribute('aria-describedby', 'turntable-progress-text export-status');
  expect(await page.evaluate(() => document.querySelector('#export-options').contains(document.querySelector('#export-status')))).toBe(false);
  expect(await seriousViolations(page)).toEqual([]);
  await expect.poll(() => page.locator('#turntable-progress').evaluate(element => element.value)).toBeGreaterThan(1);
  expect(await page.evaluate(() => globalThis.__turntableStatusMutations)).toBeLessThanOrEqual(4);

  await page.keyboard.press('Enter');
  await expect(page.locator('#export-status')).toContainText(/cancel/i);
  await expect(page.locator('#turntable-download')).toBeFocused();
  await expect(page.locator('#export-options')).toHaveAttribute('aria-busy', 'false');
  expect(await seriousViolations(page)).toEqual([]);
});
