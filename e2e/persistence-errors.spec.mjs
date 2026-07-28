import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  artifactPath, documentFromHtml, expect, guardUnexpectedNetwork,
  installPickerMock, observeRuntime, openArtifact, savedPickerHtml, test
} from './fixtures.mjs';

for (const [failure, expected] of [
  ['picker-cancel', 'Save cancelled'],
  ['picker', 'Test picker failure'],
  ['createWritable', 'Save failed: Test createWritable failure'],
  ['write', 'Save failed: Test write failure'],
  ['close', 'Save failed: Test close failure']
]) {
  test(`reports ${failure} without claiming a successful save`, async ({ context, page }) => {
    await installPickerMock(context, failure);
    await guardUnexpectedNetwork(context);
    await openArtifact(page);
    await page.locator('#save-button').click();
    await expect(page.locator('#save-status')).toContainText(expected);
    expect(await page.evaluate(() => globalThis.__molhtmlPicker.closes)).toBe(0);
  });
}

test('a later write failure does not corrupt the previous saved bytes', async ({ context, page }) => {
  await installPickerMock(context);
  await guardUnexpectedNetwork(context);
  await openArtifact(page);
  await page.locator('#save-button').click();
  const first = await savedPickerHtml(page);
  await page.evaluate(() => {
    const next = window.molhtml.document;
    next.title = 'Unsaved after failure';
    window.molhtml.loadDocument(next, 'browser-test');
    globalThis.__molhtmlPicker.failure = 'write';
  });
  await page.locator('#save-button').click();
  await expect(page.locator('#save-status')).toContainText('Save failed: Test write failure');
  expect(await page.evaluate(() => globalThis.__molhtmlPicker.savedHtml)).toBe(first);
  expect(documentFromHtml(first).title).not.toBe('Unsaved after failure');
});

test('detects an external revision and blocks overwrite until reload', async ({ context, page }) => {
  test.slow();
  await installPickerMock(context);
  await guardUnexpectedNetwork(context);
  await openArtifact(page);
  await page.locator('#save-button').click();
  const saved = await savedPickerHtml(page);
  const diskDocument = documentFromHtml(saved);
  diskDocument.revision += 100;
  diskDocument.title = 'Externally edited';
  const external = saved.replace(
    /(<script type="application\/molhtml\+json" id="molhtml-doc">\s*)[\s\S]*?(\s*<\/script>)/i,
    (_whole, opening, closing) => `${opening}${JSON.stringify(diskDocument, null, 2)}${closing}`
  );
  await page.evaluate(html => globalThis.__molhtmlSetExternalFile(html), external);
  await expect(page.locator('#external-banner')).toBeVisible({ timeout: 8_000 });
  await page.locator('#save-button').click();
  await expect(page.locator('#save-status')).toContainText('changed outside the viewer');
  expect(await page.evaluate(() => globalThis.__molhtmlPicker.savedHtml)).toBe(saved);
});

test('offers only a newer IndexedDB recovery for the same document', async ({ context }, testInfo) => {
  await guardUnexpectedNetwork(context);
  const source = await readFile(artifactPath, 'utf8');
  const sourceDocument = documentFromHtml(source);
  sourceDocument.documentId = `document-recovery-${testInfo.testId.replace(/[^a-z0-9]/gi, '-')}`;
  sourceDocument.revision = 1;
  const recoverySource = source.replace(
    /(<script type="application\/molhtml\+json" id="molhtml-doc">\s*)[\s\S]*?(\s*<\/script>)/i,
    (_whole, opening, closing) => `${opening}${JSON.stringify(sourceDocument, null, 2)}${closing}`
  );
  const recoveryPath = testInfo.outputPath('recovery-source.mol.html');
  await writeFile(recoveryPath, recoverySource, 'utf8');
  const url = pathToFileURL(recoveryPath).href;

  const first = await context.newPage();
  await openArtifact(first, { url });
  const changed = await first.evaluate(() => {
    const next = window.molhtml.document;
    next.title = 'Recovered browser state';
    return window.molhtml.loadDocument(next, 'browser-test');
  });
  await expect.poll(() => first.evaluate(async id => {
    return new Promise(resolvePromise => {
      const request = indexedDB.open('molhtml-autosave', 1);
      request.onsuccess = () => {
        const read = request.result.transaction('recovery', 'readonly').objectStore('recovery').get(id);
        read.onsuccess = () => resolvePromise(read.result?.revision || 0);
        read.onerror = () => resolvePromise(0);
      };
      request.onerror = () => resolvePromise(0);
    });
  }, changed.documentId)).toBe(changed.revision);
  await first.close();

  const reopened = await context.newPage();
  let recoveryPrompt = '';
  reopened.on('dialog', async dialog => {
    recoveryPrompt = dialog.message();
    await dialog.accept();
  });
  await openArtifact(reopened, { url });
  await expect.poll(() => recoveryPrompt).toContain('newer browser recovery');
  await expect.poll(() => reopened.evaluate(() => window.molhtml.document.title)).toBe('Recovered browser state');
  await expect(reopened.locator('#toast-region')).toContainText('Recovered newer browser autosave');
});

test('rejects malformed embedded JSON safely', async ({ context, page }, testInfo) => {
  await guardUnexpectedNetwork(context);
  const source = await readFile(artifactPath, 'utf8');
  const malformed = source.replace(
    /(<script type="application\/molhtml\+json" id="molhtml-doc">\s*)[\s\S]*?(\s*<\/script>)/i,
    (_whole, opening, closing) => `${opening}{invalid-json${closing}`
  );
  const malformedPath = testInfo.outputPath('malformed-document.mol.html');
  await writeFile(malformedPath, malformed, 'utf8');
  await page.goto(pathToFileURL(malformedPath).href);
  await expect(page.locator('#canvas-message')).toBeVisible();
  await expect(page.locator('#canvas-message')).toContainText('could not be opened');
  expect(await page.evaluate(() => window.molhtml)).toBeUndefined();
});

test('rejects a malformed local PDB without destroying the previous document', async ({ context, page }) => {
  await guardUnexpectedNetwork(context);
  const assertNoRuntimeErrors = observeRuntime(page);
  const original = await openArtifact(page);
  const error = await page.evaluate(() => window.molhtml.importPDB('broken.pdb', 'NOT A PDB').then(
    () => '', caught => caught.message
  ));
  expect(error).toContain('No ATOM or HETATM coordinates');
  expect(await page.evaluate(() => window.molhtml.document.structure.id)).toBe(original.structure.id);
  await expect(page.locator('#canvas-message')).toBeHidden();
  assertNoRuntimeErrors();
});
