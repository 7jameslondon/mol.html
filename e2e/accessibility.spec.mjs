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

  for (const target of ['representation', 'navigator', 'measurements', 'saved-selections', 'ligands', 'metadata', 'saved-views']) {
    await page.locator(`[data-inspector-target="${target}"]`).click();
    await expect(page.locator('#inspector')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  }

  await page.evaluate(() => {
    const first = window.molhtml.createSavedView({ title: 'Accessible story one', narrative: 'First scene' });
    window.molhtml.createSavedView({ title: 'Accessible story two', narrative: 'Second scene' });
    window.molhtml.startStory(first.id);
  });
  await expect(page.locator('#story-overlay')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
