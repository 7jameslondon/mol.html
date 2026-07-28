import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  artifactPath, browserSaveShell, closeContext, disablePicker, documentFromHtml, expect,
  guardUnexpectedNetwork, installPickerMock, observeRuntime, openArtifact,
  savedPickerHtml, test, writeInstrumentedArtifact
} from './fixtures.mjs';

const hostileValues = {
  replacements: "$1 $& $` $'",
  markup: '</script><script>globalThis.__molhtmlAttack = true</script>',
  unicode: 'שלום 🧬 \u2028 \u2029',
  unknown: { future: true }
};

test('saves picker bytes, restores notices, and reopens hostile data', async ({ browser, context, page }, testInfo) => {
  await installPickerMock(context);
  await guardUnexpectedNetwork(context);
  const assertNoRuntimeErrors = observeRuntime(page);
  await openArtifact(page);
  const baselineShell = browserSaveShell(await page.evaluate(() => window.molhtml.serialize()));

  const expected = await page.evaluate(values => {
    const next = window.molhtml.document;
    next.documentId = `document-picker-${crypto.randomUUID()}`;
    next.title = 'Hostile browser round-trip';
    next.futureHostileValues = values;
    return window.molhtml.loadDocument(next, 'browser-test');
  }, hostileValues);
  await page.locator('#save-button').click();
  const savedHtml = await savedPickerHtml(page);
  const savedPath = testInfo.outputPath('picker-roundtrip.mol.html');
  await writeFile(savedPath, savedHtml, 'utf8');

  expect(browserSaveShell(savedHtml)).toBe(baselineShell);
  expect((savedHtml.match(/id="molhtml-license-notices"/g) || [])).toHaveLength(1);
  expect(savedHtml).not.toContain('<script>globalThis.__molhtmlAttack');
  expect(documentFromHtml(savedHtml).futureHostileValues).toEqual(hostileValues);
  expect(await page.evaluate(() => globalThis.__molhtmlAttack)).toBeUndefined();

  const reopenedContext = await browser.newContext();
  await guardUnexpectedNetwork(reopenedContext);
  const reopened = await reopenedContext.newPage();
  const assertNoReopenErrors = observeRuntime(reopened);
  const reopenedDocument = await openArtifact(reopened, { url: pathToFileURL(savedPath).href });
  expect(reopenedDocument.documentId).toBe(expected.documentId);
  expect(reopenedDocument.futureHostileValues).toEqual(hostileValues);
  expect(await reopened.evaluate(() => globalThis.__molhtmlAttack)).toBeUndefined();
  assertNoReopenErrors();
  await closeContext(reopenedContext);
  assertNoRuntimeErrors();
});

test('downloads a complete copy when the picker is unavailable', async ({ browser, context, page }, testInfo) => {
  await disablePicker(context);
  await guardUnexpectedNetwork(context);
  const assertNoRuntimeErrors = observeRuntime(page);
  await openArtifact(page);
  await page.evaluate(() => {
    const next = window.molhtml.document;
    next.documentId = `document-download-${crypto.randomUUID()}`;
    next.title = 'Download fallback';
    window.molhtml.loadDocument(next, 'browser-test');
  });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#save-button').click();
  const download = await downloadPromise;
  const downloadPath = testInfo.outputPath('download-roundtrip.mol.html');
  await download.saveAs(downloadPath);
  const html = await readFile(downloadPath, 'utf8');
  expect(download.suggestedFilename()).toBe('Download_fallback.mol.html');
  expect(documentFromHtml(html).title).toBe('Download fallback');

  const reopenedContext = await browser.newContext();
  await guardUnexpectedNetwork(reopenedContext);
  const reopened = await reopenedContext.newPage();
  await openArtifact(reopened, { url: pathToFileURL(downloadPath).href });
  await expect.poll(() => reopened.evaluate(() => window.molhtml.document.title)).toBe('Download fallback');
  await closeContext(reopenedContext);
  assertNoRuntimeErrors();
});

test('reconstructs a canonical license block from a tampered pristine DOM', async ({ context, page }, testInfo) => {
  await installPickerMock(context);
  await guardUnexpectedNetwork(context);
  const source = await readFile(artifactPath, 'utf8');
  const originalLicense = source.match(/<script type="text\/plain" id="molhtml-license-notices"[\s\S]*?<\/script>/)?.[0];
  expect(originalLicense).toBeTruthy();
  const instrumentedPath = testInfo.outputPath('tampered-pristine.mol.html');
  const url = await writeInstrumentedArtifact(instrumentedPath, `
    const notice = document.getElementById('molhtml-license-notices');
    const duplicate = notice.cloneNode(true);
    duplicate.textContent = '\\nDUPLICATE TAMPER\\n';
    notice.after(duplicate);
    notice.textContent = '\\nTAMPERED\\n';
    notice.dataset.noticeSha256 = 'tampered';
  `);
  await openArtifact(page, { url });
  await page.locator('#save-button').click();
  const savedHtml = await savedPickerHtml(page);
  expect((savedHtml.match(/id="molhtml-license-notices"/g) || [])).toHaveLength(1);
  expect(savedHtml).toContain(originalLicense);
});

test('keeps one runtime and stable shell through repeated open-edit-save-reopen cycles', async ({ browser }, testInfo) => {
  let currentUrl = pathToFileURL(artifactPath).href;
  let expectedShell = null;
  const documentId = `document-cycle-${testInfo.testId.replace(/[^a-z0-9]/gi, '-')}`;

  for (const [index, representation] of ['cartoon', 'sticks', 'lines'].entries()) {
    const cycleContext = await browser.newContext();
    await installPickerMock(cycleContext);
    await guardUnexpectedNetwork(cycleContext);
    const cyclePage = await cycleContext.newPage();
    await openArtifact(cyclePage, { url: currentUrl });
    await cyclePage.evaluate(({ id, nextRepresentation }) => {
      const next = window.molhtml.document;
      next.documentId = id;
      next.scene.representation = nextRepresentation;
      window.molhtml.loadDocument(next, 'browser-test');
    }, { id: documentId, nextRepresentation: representation });
    await cyclePage.locator('#save-button').click();
    const html = await savedPickerHtml(cyclePage);
    const shell = browserSaveShell(html);
    if (expectedShell == null) expectedShell = shell;
    else expect(shell).toBe(expectedShell);
    const counts = await cyclePage.evaluate(value => {
      const parsed = new DOMParser().parseFromString(value, 'text/html');
      return {
        runtimes: parsed.querySelectorAll('script[data-role="molhtml-app"]').length,
        documents: parsed.querySelectorAll('[id="molhtml-doc"]').length,
        notices: parsed.querySelectorAll('[id="molhtml-license-notices"]').length
      };
    }, html);
    expect(counts).toEqual({ runtimes: 1, documents: 1, notices: 1 });
    expect(documentFromHtml(html)).toMatchObject({ documentId, scene: { representation } });
    const cyclePath = testInfo.outputPath(`cycle-${index + 1}.mol.html`);
    await writeFile(cyclePath, html, 'utf8');
    currentUrl = pathToFileURL(cyclePath).href;
    await closeContext(cycleContext);
  }
});
