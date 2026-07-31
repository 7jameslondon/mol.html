import {
  documentFromHtml, expect, guardUnexpectedNetwork, installPickerMock,
  openArtifact, savedPickerHtml, test
} from './fixtures.mjs';

test.beforeEach(async ({ context }) => guardUnexpectedNetwork(context));

async function createStory(page, titles = ['Opening', 'Middle', 'Final']) {
  return page.evaluate(storyTitles => {
    const cameras = [
      [0, 0, 0, 45, 0, 0, 0, 1],
      [2, -1, 0, 34, 0, 0, 0, 1],
      [-2, 1, 0, 26, 0, 0, 0, 1]
    ];
    const representations = ['cartoon', 'sticks', 'ball-and-stick'];
    const backgrounds = ['#07111f', '#102030', '#201028'];
    const views = storyTitles.map((title, index) => window.molhtml.createSavedView({
      title,
      narrative: index === 1 ? '' : `${title} narrative`
    }));
    for (const [index, view] of views.entries()) {
      window.molhtml.updateSavedView(view.id, {
        snapshot: {
          ...view.snapshot,
          camera: { view: cameras[index % cameras.length] },
          representation: representations[index % representations.length],
          background: backgrounds[index % backgrounds.length]
        }
      });
    }
    globalThis.__storyRenders = [];
    const prototype = window.MoleculeRenderer.prototype;
    if (!prototype.__storyOriginalSetDocument) prototype.__storyOriginalSetDocument = prototype.setDocument;
    prototype.setDocument = function (nextDocument, options) {
      if (options?.writeCamera === false && nextDocument !== window.molhtml.document) {
        globalThis.__storyRenders.push({
          camera: structuredClone(nextDocument.scene.camera),
          representation: nextDocument.scene.representation,
          background: nextDocument.scene.background
        });
      }
      return prototype.__storyOriginalSetDocument.call(this, nextDocument, options);
    };
    return views;
  }, titles);
}

async function settleAndPauseClock(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(pageNow + 1_000));
}

async function dispatchWheel(page, wheelDelta = 180) {
  await page.evaluate(delta => {
    const canvas = document.querySelector('#molecule-viewer canvas');
    const bounds = canvas.getBoundingClientRect();
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2
    });
    Object.defineProperty(event, 'wheelDelta', { value: delta });
    canvas.dispatchEvent(event);
  }, wheelDelta);
}

test('autoplay advances transactionally with predictable timing and never mutates the document', async ({ context, page }) => {
  await installPickerMock(context);
  await page.clock.install();
  await openArtifact(page);
  const views = await createStory(page);
  await page.evaluate(() => {
    const representation = document.querySelector('#representation');
    representation.value = 'surface';
    representation.dispatchEvent(new Event('change', { bubbles: true }));
    representation.value = 'lines';
    representation.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.keyboard.press('Control+z');
  await expect(page.locator('#representation')).toHaveValue('surface');
  const baseline = await page.evaluate(() => ({
    document: JSON.stringify(window.molhtml.document),
    revision: window.molhtml.document.revision,
    savedViews: JSON.stringify(window.molhtml.getSavedViews()),
    serialization: window.molhtml.serialize()
  }));

  const started = await page.evaluate(id => window.molhtml.startStory(id), views[0].id);
  expect(started.id).toBe(views[0].id);
  await expect(page.locator('#story-title')).toHaveText('Opening');
  await expect(page.locator('#story-next')).toBeFocused();
  await expect(page.locator('#story-autoplay')).toHaveText('Play');
  await expect(page.locator('#story-autoplay')).toHaveAttribute('aria-label', 'Play autoplay');
  await expect(page.locator('#story-autoplay')).toHaveAttribute('aria-describedby', 'story-timing');
  await expect(page.locator('#story-autoplay')).not.toHaveAttribute('aria-pressed', /.*/);
  await expect(page.locator('#story-status')).toContainText(/1 of 3.*Opening.*paused/i);
  await settleAndPauseClock(page);

  await page.locator('#story-autoplay').click();
  await expect(page.locator('#story-autoplay')).toBeFocused();
  await expect(page.locator('#story-autoplay')).toHaveText('Pause');
  await expect(page.locator('#story-status')).toContainText(/playing/i);
  await page.clock.runFor(4_999);
  await expect(page.locator('#story-title')).toHaveText('Opening');
  await page.clock.runFor(1);
  await expect(page.locator('#story-title')).toHaveText('Middle');
  await expect(page.locator('#story-narrative')).toBeHidden();

  expect(await page.evaluate(() => JSON.stringify(window.molhtml.document))).toBe(baseline.document);
  expect(await page.evaluate(() => window.molhtml.serialize())).toBe(baseline.serialization);
  await page.locator('#save-button').click();
  expect(documentFromHtml(await savedPickerHtml(page))).toEqual(JSON.parse(baseline.document));
  await expect(page.locator('#story-overlay')).toBeVisible();

  await page.clock.runFor(5_000);
  await expect(page.locator('#story-title')).toHaveText('Final');
  await expect(page.locator('#story-autoplay')).toHaveText('Replay');
  await expect(page.locator('#story-autoplay')).toHaveAttribute('aria-label', 'Replay story from beginning');
  await expect(page.locator('#story-status')).toContainText(/complete/i);
  await page.clock.runFor(10_000);
  await expect(page.locator('#story-title')).toHaveText('Final');

  await page.locator('#story-autoplay').click();
  await expect(page.locator('#story-title')).toHaveText('Opening');
  await expect(page.locator('#story-autoplay')).toHaveText('Pause');
  await page.clock.runFor(3_000);
  expect(await page.evaluate(() => window.molhtml.previousStoryView())).toBe(false);
  await page.clock.runFor(1_999);
  await expect(page.locator('#story-title')).toHaveText('Opening');
  await page.clock.runFor(1);
  await expect(page.locator('#story-title')).toHaveText('Middle');

  await page.locator('#story-autoplay').click();
  await expect(page.locator('#story-autoplay')).toHaveText('Play');
  await page.clock.runFor(6_000);
  await expect(page.locator('#story-title')).toHaveText('Middle');
  await page.locator('#story-autoplay').click();
  await page.clock.runFor(3_000);
  await page.locator('#story-previous').click();
  await expect(page.locator('#story-title')).toHaveText('Opening');
  await page.clock.runFor(4_999);
  await expect(page.locator('#story-title')).toHaveText('Opening');
  await page.clock.runFor(1);
  await expect(page.locator('#story-title')).toHaveText('Middle');
  await page.locator('#story-next').click();
  await expect(page.locator('#story-title')).toHaveText('Final');
  await expect(page.locator('#story-autoplay')).toHaveText('Replay');
  await page.locator('#story-previous').click();
  await expect(page.locator('#story-title')).toHaveText('Middle');
  await expect(page.locator('#story-autoplay')).toHaveText('Play');
  await page.clock.runFor(6_000);
  await expect(page.locator('#story-title')).toHaveText('Middle');

  expect(await page.evaluate(() => globalThis.__storyRenders.slice(0, 3))).toEqual([
    { camera: { view: [0, 0, 0, 45, 0, 0, 0, 1] }, representation: 'cartoon', background: '#07111f' },
    { camera: { view: [2, -1, 0, 34, 0, 0, 0, 1] }, representation: 'sticks', background: '#102030' },
    { camera: { view: [-2, 1, 0, 26, 0, 0, 0, 1] }, representation: 'ball-and-stick', background: '#201028' }
  ]);
  expect(await page.evaluate(() => window.molhtml.exitStory())).toBe(true);
  expect(await page.evaluate(() => window.molhtml.exitStory())).toBe(false);
  await expect(page.locator('#molecule-viewer')).toBeFocused();
  expect(await page.evaluate(() => ({
    document: JSON.stringify(window.molhtml.document),
    revision: window.molhtml.document.revision,
    savedViews: JSON.stringify(window.molhtml.getSavedViews()),
    serialization: window.molhtml.serialize()
  }))).toEqual(baseline);
  await page.keyboard.press('Control+y');
  await expect(page.locator('#representation')).toHaveValue('lines');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#representation')).toHaveValue('surface');
});

test('one-view, visibility, replacement, focus, and reflow lifecycle states are coherent', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 320, height: 640 });
  await openArtifact(page);
  const emptyError = await page.evaluate(() => {
    try { window.molhtml.startStory(); } catch (error) { return error.message; }
    return '';
  });
  expect(emptyError).toContain('Capture a saved view');
  const [only] = await createStory(page, ['Only view']);
  await page.evaluate(id => window.molhtml.startStory(id), only.id);
  await expect(page.locator('#story-autoplay')).toBeDisabled();
  await expect(page.locator('#story-autoplay')).toHaveText('Replay');
  await expect(page.locator('#story-status')).toContainText(/complete/i);
  await expect(page.locator('#story-exit')).toBeFocused();
  const reflow = await page.locator('#story-overlay').evaluate(element => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(reflow.left).toBeGreaterThanOrEqual(0);
  expect(reflow.right).toBeLessThanOrEqual(320);
  expect(reflow.scrollWidth).toBeLessThanOrEqual(reflow.clientWidth);
  await page.locator('#story-exit').click();
  await page.evaluate(id => window.molhtml.removeSavedView(id), only.id);

  const views = await createStory(page, ['First replacement', 'Second replacement']);
  const fallback = await page.evaluate(() => window.molhtml.startStory('unknown-view-id'));
  expect(fallback.id).toBe(views[0].id);
  await settleAndPauseClock(page);
  await page.locator('#story-autoplay').click();
  await page.clock.runFor(2_000);
  await page.evaluate(id => window.molhtml.startStory(id), views[1].id);
  await expect(page.locator('#story-title')).toHaveText('Second replacement');
  await expect(page.locator('#story-autoplay')).toHaveText('Replay');
  await page.clock.runFor(8_000);
  await expect(page.locator('#story-title')).toHaveText('Second replacement');

  await page.evaluate(id => window.molhtml.startStory(id), views[0].id);
  await page.locator('#story-autoplay').click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#story-autoplay')).toHaveText('Play');
  await expect(page.locator('#story-status')).toContainText(/paused/i);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  await page.clock.runFor(8_000);
  await expect(page.locator('#story-title')).toHaveText('First replacement');

  await page.locator('#story-narrative').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#story-narrative')).toBeHidden();
  await expect(page.locator('#story-autoplay')).toBeFocused();
  await page.locator('[data-inspector-target="saved-views"]').click();
  await expect(page.locator('#story-overlay')).toBeHidden();
  await expect(page.locator('#inspector')).toBeVisible();
  await expect(page.locator('[data-inspector-target="saved-views"]')).toBeFocused();

  await page.evaluate(id => window.molhtml.startStory(id), views[0].id);
  await page.evaluate(() => window.molhtml.setInteractions({ enabled: true }));
  await expect(page.locator('#story-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.molhtml.document.scene.interactions.enabled)).toBe(true);
  await page.evaluate(id => window.molhtml.startStory(id), views[0].id);
  await page.locator('#fit-button').click();
  await expect(page.locator('#story-overlay')).toBeHidden();

  await page.evaluate(id => window.molhtml.startStory(id), views[0].id);
  const captured = await page.evaluate(() => window.molhtml.createSavedView({ title: 'Canonical capture' }));
  await expect(page.locator('#story-overlay')).toBeHidden();
  expect(captured.snapshot.camera).toEqual(await page.evaluate(() => window.molhtml.document.scene.camera));
});

test('camera debounce is flushed before presentation and suppressed during and after it', async ({ page }) => {
  await openArtifact(page);
  const views = await createStory(page, ['Camera one', 'Camera two']);
  const before = await page.evaluate(() => window.molhtml.document);
  await dispatchWheel(page, 240);
  await page.evaluate(id => window.molhtml.startStory(id), views[0].id);
  const afterFlush = await page.evaluate(() => window.molhtml.document);
  expect(afterFlush.revision).toBe(before.revision + 1);
  expect(afterFlush.scene.camera).not.toEqual(before.scene.camera);

  await dispatchWheel(page, 300);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.molhtml.document)).toEqual(afterFlush);
  await dispatchWheel(page, -300);
  await page.evaluate(() => window.molhtml.exitStory());
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.molhtml.document)).toEqual(afterFlush);

  await dispatchWheel(page, 180);
  await expect.poll(() => page.evaluate(() => window.molhtml.document.revision)).toBe(afterFlush.revision + 1);
  const afterExpiredDebounce = await page.evaluate(() => window.molhtml.document);
  await page.evaluate(id => window.molhtml.startStory(id), views[0].id);
  expect(await page.evaluate(() => window.molhtml.document.revision)).toBe(afterExpiredDebounce.revision);
  await page.keyboard.press('Escape');
});

test('story render failures clean up once while public APIs rethrow without UI reporting', async ({ page }) => {
  await openArtifact(page);
  const views = await createStory(page, ['Failure one', 'Failure two']);
  const baseline = await page.evaluate(() => JSON.stringify(window.molhtml.document));
  await page.evaluate(id => window.molhtml.startStory(id), views[0].id);

  await page.evaluate(() => {
    const prototype = window.MoleculeRenderer.prototype;
    const original = prototype.setDocument;
    prototype.setDocument = function (nextDocument, options) {
      prototype.setDocument = original;
      if (options?.writeCamera === false) throw new Error('planned story transition failure');
      return original.call(this, nextDocument, options);
    };
  });
  await page.locator('#story-next').click();
  await expect(page.locator('#story-overlay')).toBeHidden();
  await expect(page.locator('#molecule-viewer')).toBeFocused();
  await expect(page.locator('#toast-region .toast')).toHaveCount(1);
  await expect(page.locator('#toast-region .toast')).toContainText('planned story transition failure');
  expect(await page.evaluate(() => JSON.stringify(window.molhtml.document))).toBe(baseline);

  await page.evaluate(id => window.molhtml.startStory(id), views[0].id);
  const toastCount = await page.locator('#toast-region .toast').count();
  const thrown = await page.evaluate(() => {
    const prototype = window.MoleculeRenderer.prototype;
    const original = prototype.setDocument;
    prototype.setDocument = function (nextDocument, options) {
      prototype.setDocument = original;
      if (options?.writeCamera === false) throw new Error('public transition failure');
      return original.call(this, nextDocument, options);
    };
    try { window.molhtml.nextStoryView(); } catch (error) { return error.message; }
    return '';
  });
  expect(thrown).toBe('public transition failure');
  expect(await page.locator('#toast-region .toast').count()).toBe(toastCount);
  expect(await page.evaluate(() => JSON.stringify(window.molhtml.document))).toBe(baseline);

  await dispatchWheel(page, 200);
  await expect.poll(() => page.evaluate(() => window.molhtml.document.revision)).toBe(JSON.parse(baseline).revision + 1);
});

test('measurement drafts and recursive saved-view selectors fail safely', async ({ page }) => {
  await openArtifact(page);
  const views = await createStory(page, ['Validation one', 'Validation two']);
  await page.locator('[data-inspector-target="measurements"]').click();
  await page.locator('#start-measurement').click();
  await page.locator('#cancel-measurement').focus();
  const failure = await page.evaluate(id => {
    const prototype = window.MoleculeRenderer.prototype;
    const original = prototype.setDocument;
    prototype.setDocument = function (nextDocument, options) {
      prototype.setDocument = original;
      if (options?.writeCamera === false) throw new Error('initial story failure');
      return original.call(this, nextDocument, options);
    };
    try { window.molhtml.startStory(id); } catch (error) { return error.message; }
    return '';
  }, views[0].id);
  expect(failure).toBe('initial story failure');
  await expect(page.locator('#inspector')).toBeVisible();
  await expect(page.locator('#cancel-measurement')).toBeEnabled();
  await expect(page.locator('#cancel-measurement')).toBeFocused();

  await page.evaluate(id => {
    const prototype = window.MoleculeRenderer.prototype;
    const original = prototype.setMeasurementDraft;
    prototype.setMeasurementDraft = function () { throw new Error('post-trial draft clear'); };
    try { window.molhtml.startStory(id); } finally { prototype.setMeasurementDraft = original; }
  }, views[0].id);
  await expect(page.locator('#story-overlay')).toBeVisible();
  await expect(page.locator('#inspector')).toBeHidden();
  await page.evaluate(() => window.molhtml.exitStory());

  const recapture = await page.evaluate(id => {
    const view = window.molhtml.getSavedViews().find(candidate => candidate.id === id);
    window.molhtml.updateSavedView(id, { snapshot: { ...view.snapshot, futureSnapshotField: { kept: true } } });
    const refreshed = window.molhtml.recaptureSavedView(id);
    window.molhtml.updateSavedView(id, { snapshot: { camera: refreshed.snapshot.camera } });
    const replaced = window.molhtml.getSavedViews().find(candidate => candidate.id === id);
    return { refreshed, replaced };
  }, views[1].id);
  expect(recapture.refreshed.snapshot.futureSnapshotField).toEqual({ kept: true });
  expect(recapture.replaced.snapshot.futureSnapshotField).toBeUndefined();

  await page.evaluate(id => {
    const documentValue = window.molhtml.document;
    const view = window.molhtml.getSavedViews().find(candidate => candidate.id === id);
    window.molhtml.updateSavedView(id, {
      snapshot: {
        ...view.snapshot,
        selection: {
          kind: 'atom',
          selector: {
            kind: 'within', structureId: documentValue.structure.id, cutoff: 4,
            target: { kind: 'atom', model: 1, chain: 'A', resi: 1, atom: 'P' }
          }
        }
      }
    });
  }, views[0].id);
  const baseline = await page.evaluate(() => JSON.stringify(window.molhtml.document));
  const errors = await page.evaluate(id => {
    const result = [];
    for (const action of [
      () => window.molhtml.applySavedView(id),
      () => window.molhtml.startStory(id)
    ]) {
      try { action(); } catch (error) { result.push(error.message); }
    }
    return result;
  }, views[0].id);
  expect(errors).toHaveLength(2);
  expect(errors.every(message => /missing structureId/i.test(message))).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(window.molhtml.document))).toBe(baseline);
  await expect(page.locator('#story-overlay')).toBeHidden();
});
