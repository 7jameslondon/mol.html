import { expect, guardUnexpectedNetwork, openArtifact, test } from './fixtures.mjs';

test('keeps primary application chrome stable', async ({ browserName, context, page }) => {
  test.skip(browserName !== 'chromium', 'Chrome snapshots are maintained only for the required browser.');
  await guardUnexpectedNetwork(context);
  await openArtifact(page);
  await expect(page).toHaveScreenshot('application-chrome.png', {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('#molecule-viewer')],
    maxDiffPixelRatio: 0.01
  });
});
