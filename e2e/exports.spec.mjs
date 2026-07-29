import {
  closeContext, expect, expectHealthyRender, guardUnexpectedNetwork, observeRuntime, openArtifact, test
} from './fixtures.mjs';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ context }) => guardUnexpectedNetwork(context));

async function installExportResourceProbe(context) {
  await context.addInitScript(() => {
    const state = {
      listeners: { windowResize: 0, bodyMouseup: 0, bodyTouchend: 0 },
      observers: { resizeCreated: 0, resizeObserved: 0, resizeDisconnected: 0, intersectionCreated: 0, intersectionObserved: 0, intersectionDisconnected: 0 },
      webgl: {}
    };
    globalThis.__exportResourceProbe = state;
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) {
      if (this === globalThis && type === 'resize') state.listeners.windowResize += 1;
      if (this === document.body && type === 'mouseup') state.listeners.bodyMouseup += 1;
      if (this === document.body && type === 'touchend') state.listeners.bodyTouchend += 1;
      return originalAddEventListener.call(this, type, ...rest);
    };

    const NativeResizeObserver = globalThis.ResizeObserver;
    if (NativeResizeObserver) {
      globalThis.ResizeObserver = class extends NativeResizeObserver {
        constructor(callback) { super(callback); state.observers.resizeCreated += 1; }
        observe(...args) { state.observers.resizeObserved += 1; return super.observe(...args); }
        disconnect(...args) { state.observers.resizeDisconnected += 1; return super.disconnect(...args); }
      };
    }
    const NativeIntersectionObserver = globalThis.IntersectionObserver;
    if (NativeIntersectionObserver) {
      globalThis.IntersectionObserver = class extends NativeIntersectionObserver {
        constructor(callback, options) { super(callback, options); state.observers.intersectionCreated += 1; }
        observe(...args) { state.observers.intersectionObserved += 1; return super.observe(...args); }
        disconnect(...args) { state.observers.intersectionDisconnected += 1; return super.disconnect(...args); }
      };
    }

    const definitions = [
      ['buffers', 'createBuffer', 'deleteBuffer'],
      ['textures', 'createTexture', 'deleteTexture'],
      ['programs', 'createProgram', 'deleteProgram'],
      ['framebuffers', 'createFramebuffer', 'deleteFramebuffer'],
      ['renderbuffers', 'createRenderbuffer', 'deleteRenderbuffer'],
      ['shaders', 'createShader', 'deleteShader']
    ];
    const patchedFunctions = new WeakSet();
    for (const prototype of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype]) {
      if (!prototype) continue;
      for (const [label, createName, deleteName] of definitions) {
        const originalCreate = prototype[createName];
        const originalDelete = prototype[deleteName];
        if (typeof originalCreate !== 'function' || typeof originalDelete !== 'function' || patchedFunctions.has(originalCreate)) continue;
        patchedFunctions.add(originalCreate);
        const live = new Set();
        state.webgl[label] ||= { created: 0, deleted: 0 };
        prototype[createName] = function (...args) {
          const resource = originalCreate.apply(this, args);
          if (resource) { live.add(resource); state.webgl[label].created += 1; }
          return resource;
        };
        prototype[deleteName] = function (resource, ...args) {
          if (resource && live.delete(resource)) state.webgl[label].deleted += 1;
          return originalDelete.call(this, resource, ...args);
        };
      }
    }
  });
}

async function inspectExport(page, options) {
  return page.evaluate(async exportOptions => {
    const blob = await window.molhtml.renderPNG(exportOptions);
    const signature = [...new Uint8Array(await blob.slice(0, 8).arrayBuffer())];
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const corner = [...context.getImageData(0, 0, 1, 1).data];
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let transparentPixels = 0;
    let visiblePixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] === 0) transparentPixels += 1;
      else visiblePixels += 1;
    }
    bitmap.close();
    return {
      type: blob.type, bytes: blob.size, signature, width: canvas.width, height: canvas.height,
      corner, transparentPixels, visiblePixels
    };
  }, options);
}

async function downloadedPngDimensions(download) {
  const path = await download.path();
  const png = await readFile(path);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length };
}

test('renders exact opaque and transparent PNGs without changing live state', async ({ context, page }) => {
  await installExportResourceProbe(context);
  const networkRequests = [];
  page.on('request', request => {
    if (/^https?:\/\//.test(request.url())) networkRequests.push(request.url());
  });
  const assertNoRuntimeErrors = observeRuntime(page);
  await openArtifact(page);
  await page.locator('[data-inspector-target="representation"]').click();
  await page.locator('#representation').selectOption('sticks');
  await expect(page.locator('#save-status')).toHaveText('Backed up in this browser');
  const before = await page.evaluate(() => ({
    document: JSON.stringify(window.molhtml.document),
    dataBlock: document.querySelector('#molhtml-doc').textContent,
    saveStatus: {
      text: document.querySelector('#save-status').textContent,
      tone: document.querySelector('#save-status').dataset.tone || ''
    },
    canvas: (() => {
      const canvas = document.querySelector('#molecule-viewer canvas');
      return { width: canvas.width, height: canvas.height, png: canvas.toDataURL('image/png') };
    })(),
    resources: JSON.parse(JSON.stringify(globalThis.__exportResourceProbe))
  }));

  const opaque = await inspectExport(page, { width: 320, height: 180 });
  expect(opaque).toMatchObject({
    type: 'image/png', signature: [137, 80, 78, 71, 13, 10, 26, 10], width: 320, height: 180
  });
  expect(opaque.bytes).toBeGreaterThan(1_000);
  expect(opaque.corner[3]).toBe(255);
  expect(opaque.visiblePixels).toBeGreaterThan(1_000);

  const transparent = await inspectExport(page, { width: 256, height: 192, transparent: true });
  expect(transparent).toMatchObject({ width: 256, height: 192 });
  expect(transparent.corner[3]).toBe(0);
  expect(transparent.transparentPixels).toBeGreaterThan(1_000);
  expect(transparent.visiblePixels).toBeGreaterThan(100);

  const during = await page.evaluate(async () => {
    const job = window.molhtml.renderPNG({ width: 160, height: 120, transparent: true });
    const canvas = document.querySelector('#molecule-viewer canvas');
    const state = { width: canvas.width, height: canvas.height, png: canvas.toDataURL('image/png') };
    await job;
    return state;
  });
  expect(during).toEqual(before.canvas);

  const boundedStart = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__exportResourceProbe)));
  await page.evaluate(async () => {
    for (let index = 0; index < 6; index += 1) {
      await window.molhtml.renderPNG({ width: 128 + index, height: 96 + index, transparent: index % 2 === 0 });
    }
  });

  const after = await page.evaluate(() => ({
    document: JSON.stringify(window.molhtml.document),
    dataBlock: document.querySelector('#molhtml-doc').textContent,
    saveStatus: {
      text: document.querySelector('#save-status').textContent,
      tone: document.querySelector('#save-status').dataset.tone || ''
    },
    canvas: (() => {
      const canvas = document.querySelector('#molecule-viewer canvas');
      return { width: canvas.width, height: canvas.height, png: canvas.toDataURL('image/png') };
    })(),
    exportViewers: document.querySelectorAll('[data-molhtml-export-viewer]').length,
    exportCanvases: document.querySelectorAll('[data-molhtml-export-viewer] canvas').length,
    exportCanvas: (() => {
      const canvas = document.querySelector('[data-molhtml-export-viewer] canvas');
      return { width: canvas.width, height: canvas.height };
    })(),
    resources: JSON.parse(JSON.stringify(globalThis.__exportResourceProbe))
  }));
  expect(after.document).toBe(before.document);
  expect(after.dataBlock).toBe(before.dataBlock);
  expect(after.saveStatus).toEqual(before.saveStatus);
  expect(after.canvas).toEqual(before.canvas);
  expect(after.exportViewers).toBe(1);
  expect(after.exportCanvases).toBe(1);
  expect(after.exportCanvas).toEqual({ width: 64, height: 64 });
  expect(after.resources.listeners).toEqual(boundedStart.listeners);
  expect(after.resources.observers).toEqual(boundedStart.observers);
  for (const [kind, counts] of Object.entries(after.resources.webgl)) {
    const bounded = boundedStart.webgl[kind];
    expect(counts.created - counts.deleted, `${kind} live WebGL resources stay bounded`)
      .toBeLessThanOrEqual(bounded.created - bounded.deleted);
  }
  await page.locator('#undo-button').click();
  await expect.poll(() => page.evaluate(() => window.molhtml.document.scene.representation)).toBe('ball-and-stick');
  await page.locator('#redo-button').click();
  await expect.poll(() => page.evaluate(() => window.molhtml.document.scene.representation)).toBe('sticks');
  await expectHealthyRender(page);
  expect(networkRequests).toEqual([]);
  assertNoRuntimeErrors();
});

test('derives one-sided dimensions and rejects invalid or concurrent jobs', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    const visible = document.querySelector('#molecule-viewer canvas');
    const currentBlob = await window.molhtml.renderPNG();
    const currentBitmap = await createImageBitmap(currentBlob);
    const current = { width: currentBitmap.width, height: currentBitmap.height };
    currentBitmap.close();
    const expectedHeight = Math.round(256 * visible.height / visible.width);
    const blob = await window.molhtml.renderPNG({ width: 256 });
    const bitmap = await createImageBitmap(blob);
    const derived = { width: bitmap.width, height: bitmap.height, expectedHeight };
    bitmap.close();

    const first = window.molhtml.renderPNG({ width: 192, height: 128 });
    const busy = await window.molhtml.renderPNG({ width: 192, height: 128 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    await first;
    const invalid = await window.molhtml.renderPNG({ width: 63, height: 128 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    return { current, visible: { width: visible.width, height: visible.height }, derived, busy, invalid };
  });
  expect(result.current).toEqual(result.visible);
  expect(result.derived).toMatchObject({ width: 256, height: result.derived.expectedHeight });
  expect(result.busy).toEqual({ name: 'ExportBusyError', code: 'export-busy' });
  expect(result.invalid).toEqual({ name: 'ExportDimensionError', code: 'export-dimensions' });
});

test('creates safe deterministic filenames for international and hostile titles', async ({ page }) => {
  await openArtifact(page);
  const names = await page.evaluate(() => {
    const filename = window.MolhtmlExport.exportFilename;
    return {
      normal: filename('', 'DNA sample', 320, 200, false),
      explicit: filename('report.PNG', 'ignored', 320, 200, false),
      punctuation: filename('<bad>: name / * ?', 'ignored', 320, 200, false),
      unicode: filename('', 'Café 分子', 320, 200, false),
      empty: filename('', '', 320, 200, false),
      reserved: filename('CON', 'ignored', 320, 200, false),
      reservedWithSuffix: filename('lpt1.notes', 'ignored', 320, 200, false),
      bidi: filename('safe\u202Egnp', 'ignored', 320, 200, false),
      emojiBoundary: filename(`${'a'.repeat(79)}😀tail`, 'ignored', 320, 200, false),
      unpairedSurrogate: filename('bad\uD800name', 'ignored', 320, 200, false),
      transparent: filename('', 'DNA sample', 320, 200, true)
    };
  });
  expect(names.normal).toBe('DNA_sample_320x200.png');
  expect(names.explicit).toBe('report.png');
  expect(names.punctuation).not.toMatch(/[<>:"/\\|?*]/);
  expect(names.unicode).toBe('Café_分子_320x200.png');
  expect(names.empty).toBe('molecule_320x200.png');
  expect(names.reserved).toBe('_CON.png');
  expect(names.reservedWithSuffix).toBe('_lpt1.notes.png');
  expect(names.bidi).toBe('safe_gnp.png');
  expect(names.emojiBoundary).toBe(`${'a'.repeat(79)}😀.png`);
  expect([...names.emojiBoundary.replace(/\.png$/, '')]).toHaveLength(80);
  expect(names.unpairedSurrogate).toBe('bad_name.png');
  expect(names.transparent).toBe('DNA_sample_320x200_transparent.png');
});

test('keeps exact pixels and live label geometry at a fractional device-pixel ratio', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1.25 });
  await guardUnexpectedNetwork(context);
  await context.addInitScript(() => {
    const state = { contextLost: false, contextRestored: false };
    globalThis.__molhtmlRenderProbe = state;
    document.addEventListener('webglcontextlost', () => { state.contextLost = true; }, true);
    document.addEventListener('webglcontextrestored', () => { state.contextRestored = true; }, true);
  });
  const page = await context.newPage();
  try {
    await openArtifact(page);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1.25);
    await page.evaluate(() => {
      const documentCopy = structuredClone(window.molhtml.document);
      const structure = window.MolhtmlCore.parseStructure(
        documentCopy.structure.data, documentCopy.structure.format
      );
      documentCopy.scene.selection = {
        kind: 'atom',
        selector: window.MolhtmlCore.selectorForAtom(structure.atoms[0], 'atom', documentCopy.structure.id)
      };
      window.molhtml.loadDocument(documentCopy, 'fractional-dpr-label-test');
    });
    await expectHealthyRender(page);
    const png = await inspectExport(page, { width: 257, height: 193, transparent: true });
    expect(png).toMatchObject({ width: 257, height: 193 });
    expect(png.corner[3]).toBe(0);
    const labels = await page.evaluate(async () => {
      async function labelGeometry(blob) {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;
        for (let index = 0; index < pixels.length; index += 4) {
          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          if (red < 210 || red > 230 || green < 175 || green > 195 || blue < 75 || blue > 105) continue;
          const pixel = index / 4;
          const x = pixel % canvas.width;
          const y = Math.floor(pixel / canvas.width);
          count += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        bitmap.close();
        return { count, width: maxX - minX + 1, height: maxY - minY + 1 };
      }
      const visibleCanvas = document.querySelector('#molecule-viewer canvas');
      const visibleBlob = await new Promise(resolve => visibleCanvas.toBlob(resolve, 'image/png'));
      const currentBlob = await window.molhtml.renderPNG();
      return {
        backingScale: visibleCanvas.width / visibleCanvas.getBoundingClientRect().width,
        visible: await labelGeometry(visibleBlob),
        current: await labelGeometry(currentBlob)
      };
    });
    expect(labels.backingScale).toBeCloseTo(2, 1);
    expect(labels.visible.count).toBeGreaterThan(100);
    expect(labels.current.count).toBeGreaterThan(100);
    expect(Math.abs(labels.current.width - labels.visible.width)).toBeLessThanOrEqual(4);
    expect(Math.abs(labels.current.height - labels.visible.height)).toBeLessThanOrEqual(4);
    await expectHealthyRender(page);
  } finally {
    await closeContext(context);
  }
});

test('preserves rendered selection-label geometry at 4x resolution', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 600, height: 500 });
  await openArtifact(page);
  await page.evaluate(() => {
    const documentCopy = structuredClone(window.molhtml.document);
    const structure = window.MolhtmlCore.parseStructure(
      documentCopy.structure.data, documentCopy.structure.format
    );
    documentCopy.scene.selection = {
      kind: 'atom',
      selector: window.MolhtmlCore.selectorForAtom(structure.atoms[0], 'atom', documentCopy.structure.id)
    };
    window.molhtml.loadDocument(documentCopy, 'label-scale-test');
  });
  await expectHealthyRender(page);
  const visible = await page.locator('#molecule-viewer canvas').evaluate(canvas => ({
    width: canvas.width, height: canvas.height
  }));
  const result = await page.evaluate(async ({ visibleWidth, visibleHeight }) => {
    async function labelGeometry(blob) {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        if (alpha < 190 || alpha > 220 || red < 210 || red > 230
          || green < 175 || green > 195 || blue < 75 || blue > 105) continue;
        const pixel = index / 4;
        const x = pixel % canvas.width;
        const y = Math.floor(pixel / canvas.width);
        count += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      bitmap.close();
      return { count, width: maxX - minX + 1, height: maxY - minY + 1 };
    }
    const current = await window.molhtml.renderPNG({
      width: visibleWidth, height: visibleHeight, transparent: true
    });
    const high = await window.molhtml.renderPNG({
      width: visibleWidth * 4, height: visibleHeight * 4, transparent: true
    });
    return { current: await labelGeometry(current), high: await labelGeometry(high) };
  }, { visibleWidth: visible.width, visibleHeight: visible.height });
  expect(result.current.count).toBeGreaterThan(100);
  expect(result.high.count / (result.current.count * 16)).toBeGreaterThan(0.7);
  expect(result.high.count / (result.current.count * 16)).toBeLessThan(1.5);
  expect(Math.abs(result.high.width / 4 - result.current.width)).toBeLessThanOrEqual(4);
  expect(Math.abs(result.high.height / 4 - result.current.height)).toBeLessThanOrEqual(4);
});

test('captures the live camera before debounced document camera persistence', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    const digest = async blob => {
      const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    };
    const baselineCamera = JSON.stringify(window.molhtml.document.scene.camera);
    const baseline = await digest(await window.molhtml.renderPNG({ width: 256, height: 192 }));
    const canvas = document.querySelector('#molecule-viewer canvas');
    const bounds = canvas.getBoundingClientRect();
    const wheel = new WheelEvent('wheel', {
      bubbles: true, cancelable: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2
    });
    Object.defineProperty(wheel, 'wheelDelta', { value: 180 });
    canvas.dispatchEvent(wheel);
    const persistedImmediately = JSON.stringify(window.molhtml.document.scene.camera);
    const live = await digest(await window.molhtml.renderPNG({ width: 256, height: 192 }));
    return { baseline, live, cameraStillDebounced: persistedImmediately === baselineCamera };
  });
  expect(result.cameraStillDebounced).toBe(true);
  expect(result.live).not.toBe(result.baseline);
  await expectHealthyRender(page);
});

test('waits for repeated molecular surfaces with bounded resources and a healthy visible viewer', async ({ context, page }) => {
  test.setTimeout(60_000);
  await installExportResourceProbe(context);
  const assertNoRuntimeErrors = observeRuntime(page);
  await openArtifact(page);
  await page.evaluate(() => {
    const documentCopy = structuredClone(window.molhtml.document);
    const structure = window.MolhtmlCore.parseStructure(
      documentCopy.structure.data, documentCopy.structure.format
    );
    const first = window.MolhtmlCore.selectorForAtom(structure.atoms[0], 'atom', documentCopy.structure.id);
    const second = window.MolhtmlCore.selectorForAtom(structure.atoms[2], 'atom', documentCopy.structure.id);
    documentCopy.scene.selection = { kind: 'atom', selector: first };
    documentCopy.scene.measurements = [{
      id: 'surface-resource-measurement', type: 'distance', label: 'Surface span', atoms: [first, second]
    }];
    window.molhtml.loadDocument(documentCopy, 'surface-resource-test');
  });
  await page.locator('[data-inspector-target="representation"]').click();
  await page.locator('#representation').selectOption('surface');
  const exported = await inspectExport(page, { width: 256, height: 160, transparent: true });
  expect(exported).toMatchObject({ width: 256, height: 160 });
  expect(exported.bytes).toBeGreaterThan(1_000);
  expect(exported.visiblePixels).toBeGreaterThan(100);
  expect(await page.locator('[data-molhtml-export-viewer]').count()).toBe(1);
  const boundedStart = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__exportResourceProbe)));
  for (let index = 0; index < 3; index += 1) {
    const repeated = await inspectExport(page, {
      width: 224 + index * 8, height: 144 + index * 8, transparent: index % 2 === 0
    });
    expect(repeated.bytes).toBeGreaterThan(1_000);
    expect(repeated.visiblePixels).toBeGreaterThan(100);
    await expectHealthyRender(page);
  }
  const after = await page.evaluate(() => ({
    probe: JSON.parse(JSON.stringify(globalThis.__exportResourceProbe)),
    viewers: document.querySelectorAll('[data-molhtml-export-viewer]').length,
    canvases: document.querySelectorAll('[data-molhtml-export-viewer] canvas').length
  }));
  expect(after.viewers).toBe(1);
  expect(after.canvases).toBe(1);
  expect(after.probe.listeners).toEqual(boundedStart.listeners);
  expect(after.probe.observers).toEqual(boundedStart.observers);
  for (const [kind, counts] of Object.entries(after.probe.webgl)) {
    const bounded = boundedStart.webgl[kind];
    expect(counts.created - counts.deleted, `${kind} stay bounded through repeated surface exports`)
      .toBeLessThanOrEqual(bounded.created - bounded.deleted);
  }
  assertNoRuntimeErrors();
});

test('quarantines a timed-out surface generation until its worker settles', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    const sourceDocument = window.molhtml.document;
    let finishSurface;
    let readinessCalls = 0;
    let resets = 0;
    class ControlledRenderer {
      constructor() {}
      getSizingInfo() {
        return {
          contextLost: false,
          limits: {
            maxViewportWidth: 8192, maxViewportHeight: 8192,
            maxTextureSize: 8192, maxRenderbufferSize: 8192
          }
        };
      }
      setExportOptions() {}
      setOutputSize() {}
      setDocument() { return 1; }
      whenSurfacesReady() {
        readinessCalls += 1;
        if (readinessCalls > 1) return Promise.resolve(1);
        return new Promise(resolve => { finishSurface = resolve; });
      }
      capturePNG() { return Promise.resolve(new Blob(['png'], { type: 'image/png' })); }
      resetAfterExport() { resets += 1; return true; }
      resourceCounts() { return { models: 0, shapes: 0, labels: 0, surfaces: 0 }; }
    }
    const OriginalRenderer = window.MoleculeRenderer;
    window.MoleculeRenderer = ControlledRenderer;
    const service = new window.MolhtmlExport.ExportService(() => ({
      document: sourceDocument,
      camera: { view: [0, 0, 0, 1, 0, 0, 0, 1] },
      visibleSize: { width: 640, height: 480 }
    }), { timeoutMs: 10 });
    const timeout = await service.renderPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    const during = service.debugState();
    const busy = await service.renderPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    finishSurface(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const after = service.debugState();
    const recovered = await service.renderPNG({ width: 128, height: 96 });
    window.MoleculeRenderer = OriginalRenderer;
    return {
      timeout, during, busy, after, recovered: { type: recovered.type, size: recovered.size }, resets
    };
  });
  expect(result.timeout).toEqual({ name: 'ExportTimeoutError', code: 'export-timeout' });
  expect(result.during).toMatchObject({ busy: false, quarantined: true, viewerCount: 1 });
  expect(result.busy).toEqual({ name: 'ExportBusyError', code: 'export-busy' });
  expect(result.after.quarantined).toBe(false);
  expect(result.recovered).toEqual({ type: 'image/png', size: 3 });
  expect(result.resets).toBe(2);
});

test('contains renderer initialization and cleanup failures without unsafe reuse', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    const sourceDocument = window.molhtml.document;
    const source = () => ({
      document: sourceDocument,
      camera: { view: [0, 0, 0, 1, 0, 0, 0, 1] },
      visibleSize: { width: 640, height: 480 }
    });
    const sizing = {
      contextLost: false,
      limits: {
        maxViewportWidth: 8192, maxViewportHeight: 8192,
        maxTextureSize: 8192, maxRenderbufferSize: 8192
      }
    };
    class BaseRenderer {
      getSizingInfo() { return sizing; }
      setExportOptions() {}
      setOutputSize() {}
      setDocument() { this.documentCalls = (this.documentCalls || 0) + 1; return 1; }
      whenSurfacesReady() { return Promise.resolve(1); }
      capturePNG() { return Promise.resolve(new Blob(['png'], { type: 'image/png' })); }
      resetAfterExport() { return true; }
      resourceCounts() { return { models: 0, shapes: 0, labels: 0, surfaces: 0 }; }
    }
    const rejection = promise => promise.then(() => null, error => ({
      name: error.name, code: error.code, message: error.message
    }));
    const OriginalRenderer = window.MoleculeRenderer;
    const unhandled = [];
    const onUnhandled = event => { unhandled.push(event.reason?.message || String(event.reason)); event.preventDefault(); };
    window.addEventListener('unhandledrejection', onUnhandled);
    const containerBaseline = document.querySelectorAll('[data-molhtml-export-viewer]').length;

    let initializationAttempts = 0;
    class InitializationFailure {
      constructor() { initializationAttempts += 1; throw new Error('WebGL initialization failed for test'); }
    }
    window.MoleculeRenderer = InitializationFailure;
    const initializationService = new window.MolhtmlExport.ExportService(source);
    const initializationFirst = await rejection(initializationService.renderPNG({ width: 128, height: 96 }));
    const initializationSecond = await rejection(initializationService.renderPNG({ width: 128, height: 96 }));
    const initializationState = initializationService.debugState();
    const containersAfterInitialization = document.querySelectorAll('[data-molhtml-export-viewer]').length;

    class ImmediateResetFailure extends BaseRenderer {
      resetAfterExport() { throw new Error('Immediate reset failed for test'); }
    }
    window.MoleculeRenderer = ImmediateResetFailure;
    const immediateService = new window.MolhtmlExport.ExportService(source);
    const immediateFirst = await rejection(immediateService.renderPNG({ width: 128, height: 96 }));
    const immediateSecond = await rejection(immediateService.renderPNG({ width: 128, height: 96 }));
    const immediateState = immediateService.debugState();
    const immediateDocumentCalls = immediateService.renderer.documentCalls;

    class PrimaryAndResetFailure extends BaseRenderer {
      whenSurfacesReady() { return Promise.reject(new Error('Primary surface failure for test')); }
      resetAfterExport() { throw new Error('Secondary reset failure for test'); }
    }
    window.MoleculeRenderer = PrimaryAndResetFailure;
    const primaryService = new window.MolhtmlExport.ExportService(source);
    const primaryFailure = await rejection(primaryService.renderPNG({ width: 128, height: 96 }));
    const primaryState = primaryService.debugState();

    let finishDeferred;
    class DeferredResetFailure extends BaseRenderer {
      whenSurfacesReady() { return new Promise(resolve => { finishDeferred = resolve; }); }
      resetAfterExport() { return false; }
    }
    window.MoleculeRenderer = DeferredResetFailure;
    const deferredService = new window.MolhtmlExport.ExportService(source, { timeoutMs: 10 });
    const deferredFirst = await rejection(deferredService.renderPNG({ width: 128, height: 96 }));
    const deferredDuring = deferredService.debugState();
    finishDeferred(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    const deferredAfter = deferredService.debugState();
    const deferredSecond = await rejection(deferredService.renderPNG({ width: 128, height: 96 }));

    window.removeEventListener('unhandledrejection', onUnhandled);
    window.MoleculeRenderer = OriginalRenderer;
    immediateService.container?.remove();
    primaryService.container?.remove();
    deferredService.container?.remove();
    return {
      initializationAttempts, initializationFirst, initializationSecond, initializationState,
      containerBaseline, containersAfterInitialization,
      immediateFirst, immediateSecond, immediateState, immediateDocumentCalls,
      primaryFailure, primaryState,
      deferredFirst, deferredDuring, deferredAfter, deferredSecond, unhandled
    };
  });

  expect(result.initializationAttempts).toBe(1);
  expect(result.initializationFirst).toMatchObject({ name: 'ExportRenderError', code: 'export-render' });
  expect(result.initializationSecond).toEqual(result.initializationFirst);
  expect(result.initializationState).toMatchObject({ fatal: true, viewerCount: 0 });
  expect(result.containersAfterInitialization).toBe(result.containerBaseline);
  expect(result.immediateFirst).toMatchObject({ name: 'ExportRenderError', code: 'export-render' });
  expect(result.immediateSecond).toEqual(result.immediateFirst);
  expect(result.immediateState.fatal).toBe(true);
  expect(result.immediateDocumentCalls).toBe(1);
  expect(result.primaryFailure).toMatchObject({ name: 'ExportRenderError', code: 'export-render' });
  expect(result.primaryFailure.message).toContain('Primary surface failure for test');
  expect(result.primaryState.fatal).toBe(true);
  expect(result.deferredFirst).toMatchObject({ name: 'ExportTimeoutError', code: 'export-timeout' });
  expect(result.deferredDuring).toMatchObject({ quarantined: true, fatal: false });
  expect(result.deferredAfter).toMatchObject({ quarantined: false, fatal: true });
  expect(result.deferredSecond).toMatchObject({ name: 'ExportRenderError', code: 'export-render' });
  expect(result.unhandled).toEqual([]);
});

test('normalizes surface, partial-setup, context-loss, clamp, and snapshot failures', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    const sourceDocument = window.molhtml.document;
    const source = () => ({
      document: sourceDocument,
      camera: { view: [0, 0, 0, 1, 0, 0, 0, 1] },
      visibleSize: { width: 640, height: 480 }
    });
    const sizing = {
      contextLost: false,
      limits: {
        maxViewportWidth: 8192, maxViewportHeight: 8192,
        maxTextureSize: 8192, maxRenderbufferSize: 8192
      }
    };
    class BaseRenderer {
      getSizingInfo() { return sizing; }
      setExportOptions() {}
      setOutputSize() {}
      setDocument() { return 1; }
      whenSurfacesReady() { return Promise.resolve(1); }
      capturePNG() { return Promise.resolve(new Blob(['png'], { type: 'image/png' })); }
      resetAfterExport() { this.resets = (this.resets || 0) + 1; return true; }
      resourceCounts() { return { models: 0, shapes: 0, labels: 0, surfaces: 0 }; }
    }
    const OriginalRenderer = window.MoleculeRenderer;
    const run = async (Renderer, sourceProvider = source) => {
      window.MoleculeRenderer = Renderer;
      const service = new window.MolhtmlExport.ExportService(sourceProvider, { timeoutMs: 20 });
      const failure = await service.renderPNG({ width: 128, height: 96 })
        .then(() => null, error => ({ name: error.name, code: error.code }));
      const resets = service.renderer?.resets || 0;
      service.container?.remove();
      return { failure, resets };
    };

    class SurfaceRejectRenderer extends BaseRenderer {
      whenSurfacesReady() { return Promise.reject(new Error('Surface failed for test')); }
    }
    const surface = await run(SurfaceRejectRenderer);

    let finishPartialSurface;
    class PartialRenderer extends BaseRenderer {
      setDocument() {
        const error = new Error('Setup failed after surface start');
        error.molhtmlRenderGeneration = 1;
        throw error;
      }
      whenSurfacesReady() { return new Promise(resolve => { finishPartialSurface = resolve; }); }
    }
    window.MoleculeRenderer = PartialRenderer;
    const partialService = new window.MolhtmlExport.ExportService(source, { timeoutMs: 20 });
    const partialFailure = await partialService.renderPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    const partialDuring = partialService.debugState();
    const partialBusy = await partialService.renderPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    finishPartialSurface(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const partialAfter = partialService.debugState();
    const partialResets = partialService.renderer.resets || 0;
    partialService.container?.remove();

    class ContextLostRenderer extends BaseRenderer {
      getSizingInfo() {
        this.sizingCalls = (this.sizingCalls || 0) + 1;
        return { ...sizing, contextLost: true };
      }
    }
    window.MoleculeRenderer = ContextLostRenderer;
    const contextLostService = new window.MolhtmlExport.ExportService(source);
    const contextLostFirst = await contextLostService.renderPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    const contextLostState = contextLostService.debugState();
    const contextLostSecond = await contextLostService.renderPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    const contextLostSizingCalls = contextLostService.renderer.sizingCalls;
    contextLostService.container?.remove();

    class LimitedRenderer extends BaseRenderer {
      getSizingInfo() {
        return {
          ...sizing,
          limits: {
            maxViewportWidth: 100, maxViewportHeight: 100,
            maxTextureSize: 100, maxRenderbufferSize: 100
          }
        };
      }
    }
    window.MoleculeRenderer = LimitedRenderer;
    const limitedService = new window.MolhtmlExport.ExportService(source);
    const limitedFailure = await limitedService.renderPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    const limitedState = limitedService.debugState();
    const limitedRecovery = await limitedService.renderPNG({ width: 96, height: 96 });
    limitedService.container?.remove();

    class ClampRenderer extends BaseRenderer {
      capturePNG() {
        const error = new Error('Browser clamped the drawing buffer.');
        error.code = 'renderer-dimension-mismatch';
        return Promise.reject(error);
      }
    }
    const clamp = await run(ClampRenderer);

    const snapshotService = new window.MolhtmlExport.ExportService(() => {
      throw new DOMException('Snapshot failed for test', 'DataCloneError');
    });
    const snapshot = await snapshotService.renderPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    window.MoleculeRenderer = OriginalRenderer;
    return {
      surface, partialFailure, partialDuring, partialBusy, partialAfter, partialResets,
      contextLostFirst, contextLostState, contextLostSecond, contextLostSizingCalls,
      limitedFailure, limitedState, limitedRecovery: { type: limitedRecovery.type, size: limitedRecovery.size },
      clamp, snapshot
    };
  });

  expect(result.surface).toEqual({
    failure: { name: 'ExportRenderError', code: 'export-render' }, resets: 1
  });
  expect(result.partialFailure).toEqual({ name: 'ExportRenderError', code: 'export-render' });
  expect(result.partialDuring.quarantined).toBe(true);
  expect(result.partialBusy).toEqual({ name: 'ExportBusyError', code: 'export-busy' });
  expect(result.partialAfter.quarantined).toBe(false);
  expect(result.partialResets).toBe(1);
  expect(result.contextLostFirst).toEqual({ name: 'ExportRenderError', code: 'export-render' });
  expect(result.contextLostState).toMatchObject({ fatal: true, quarantined: false });
  expect(result.contextLostSecond).toEqual({ name: 'ExportRenderError', code: 'export-render' });
  expect(result.contextLostSizingCalls).toBe(1);
  expect(result.limitedFailure).toEqual({ name: 'ExportDimensionError', code: 'export-dimensions' });
  expect(result.limitedState.fatal).toBe(false);
  expect(result.limitedRecovery).toEqual({ type: 'image/png', size: 3 });
  expect(result.clamp).toEqual({
    failure: { name: 'ExportDimensionError', code: 'export-dimensions' }, resets: 1
  });
  expect(result.snapshot).toEqual({ name: 'ExportRenderError', code: 'export-render' });
});

test('reports null and throwing canvas captures without starting a download', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    await window.molhtml.renderPNG({ width: 128, height: 96 });
    const canvas = document.querySelector('[data-molhtml-export-viewer] canvas');
    const originalToBlob = canvas.toBlob.bind(canvas);
    let downloadClicks = 0;
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { downloadClicks += 1; };
    canvas.toBlob = callback => callback(null);
    const nullBlob = await window.molhtml.downloadPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    canvas.toBlob = () => { throw new DOMException('Blocked for test', 'SecurityError'); };
    const throwing = await window.molhtml.downloadPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    canvas.toBlob = originalToBlob;
    const anchorCountBefore = document.querySelectorAll('a').length;
    HTMLAnchorElement.prototype.click = function () { throw new Error('Download click failed for test'); };
    const clickFailure = await window.molhtml.downloadPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code, message: error.message }));
    const anchorCountAfter = document.querySelectorAll('a').length;
    HTMLAnchorElement.prototype.click = originalClick;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => { throw new DOMException('Object URL failed for test', 'InvalidStateError'); };
    const urlFailure = await window.molhtml.downloadPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code, message: error.message }));
    URL.createObjectURL = originalCreateObjectURL;
    return {
      nullBlob, throwing, downloadClicks, clickFailure, urlFailure, anchorCountBefore, anchorCountAfter
    };
  });
  expect(result.nullBlob).toEqual({ name: 'ExportRenderError', code: 'export-render' });
  expect(result.throwing).toEqual({ name: 'ExportRenderError', code: 'export-render' });
  expect(result.downloadClicks).toBe(0);
  expect(result.clickFailure).toMatchObject({ name: 'ExportDownloadError', code: 'export-download' });
  expect(result.clickFailure?.message).toContain('Download click failed');
  expect(result.urlFailure).toMatchObject({ name: 'ExportDownloadError', code: 'export-download' });
  expect(result.urlFailure?.message).toContain('Object URL failed');
  expect(result.anchorCountAfter).toBe(result.anchorCountBefore);
  await expectHealthyRender(page);
});

test('returns unsupported clipboard status before rendering or downloading', async ({ context, page }) => {
  await context.addInitScript(() => {
    const state = { writes: 0, objectUrls: 0, downloadClicks: 0 };
    globalThis.__unsupportedClipboard = state;
    class UnsupportedClipboardItem {
      static supports() { return false; }
    }
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: UnsupportedClipboardItem });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write() { state.writes += 1; return Promise.resolve(); } }
    });
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { state.objectUrls += 1; return originalCreateObjectURL(blob); };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (...args) {
      state.downloadClicks += 1;
      return originalClick.apply(this, args);
    };
  });
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    const before = { ...globalThis.__unsupportedClipboard };
    const viewersBefore = document.querySelectorAll('[data-molhtml-export-viewer]').length;
    const outcome = await window.molhtml.copyImage({ width: 128, height: 96 });
    return {
      outcome, before, after: { ...globalThis.__unsupportedClipboard }, viewersBefore,
      viewersAfter: document.querySelectorAll('[data-molhtml-export-viewer]').length
    };
  });
  expect(result.outcome.status).toBe('unsupported');
  expect(result.outcome.reason).toContain('does not accept PNG');
  expect(result.after).toEqual(result.before);
  expect(result.after.writes).toBe(0);
  expect(result.after.downloadClicks).toBe(0);
  expect(result.viewersAfter).toBe(result.viewersBefore);
  expect(result.viewersAfter).toBe(0);
});

test('writes a promised PNG to the clipboard before rendering settles and preserves denied output', async ({ context, page }) => {
  await context.addInitScript(() => {
    const state = {
      mode: 'copy', writeCalls: 0, writeBeforeBlob: false, blobType: '', blobBytes: 0,
      objectUrlCalls: 0, downloadClicks: 0
    };
    globalThis.__imageClipboard = state;
    class ClipboardItemMock {
      static supports(type) { return type === 'image/png'; }
      constructor(items) { this.items = items; }
    }
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: ClipboardItemMock });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write(items) {
          state.writeCalls += 1;
          const blobPromise = items[0].items['image/png'];
          state.writeBeforeBlob = state.blobBytes === 0;
          if (state.mode === 'deny') throw new DOMException('Denied for test', 'NotAllowedError');
          return Promise.resolve(blobPromise).then(blob => {
            state.blobType = blob.type;
            state.blobBytes = blob.size;
          });
        }
      }
    });
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      state.objectUrlCalls += 1;
      return originalCreateObjectURL(blob);
    };
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (...args) {
      state.downloadClicks += 1;
      return originalAnchorClick.apply(this, args);
    };
  });
  await openArtifact(page);

  const arbitration = await page.evaluate(async () => {
    const first = window.molhtml.renderPNG({ width: 192, height: 128 });
    const busyCopy = await window.molhtml.copyImage({ width: 192, height: 128 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    const writeCallsBeforeSettlement = globalThis.__imageClipboard.writeCalls;
    await first;
    return { busyCopy, writeCallsBeforeSettlement };
  });
  expect(arbitration.busyCopy).toEqual({ name: 'ExportBusyError', code: 'export-busy' });
  expect(arbitration.writeCallsBeforeSettlement).toBe(0);

  const copied = await page.evaluate(async () => {
    const outcome = await window.molhtml.copyImage({ width: 192, height: 128, transparent: true });
    return { outcome, state: globalThis.__imageClipboard };
  });
  expect(copied.outcome).toMatchObject({ status: 'copied', metadata: { width: 192, height: 128, transparent: true } });
  expect(copied.state).toMatchObject({
    writeCalls: 1, writeBeforeBlob: true, blobType: 'image/png'
  });
  expect(copied.state.blobBytes).toBeGreaterThan(1_000);

  const denied = await page.evaluate(async () => {
    globalThis.__imageClipboard.mode = 'deny';
    const outcome = await window.molhtml.copyImage({ width: 160, height: 100 });
    return { status: outcome.status, reason: outcome.reason, bytes: outcome.blob?.size || 0 };
  });
  expect(denied.status).toBe('denied');
  expect(denied.reason).toContain('denied');
  expect(denied.bytes).toBeGreaterThan(1_000);

  await page.locator('[data-inspector-target="export"]').click();
  await page.locator('#export-size').selectOption('custom');
  await page.getByText('Lock aspect ratio', { exact: true }).click();
  await page.locator('#export-width').fill('160');
  await page.locator('#export-height').fill('100');
  const deniedBaseline = await page.evaluate(() => ({
    objectUrlCalls: globalThis.__imageClipboard.objectUrlCalls,
    downloadClicks: globalThis.__imageClipboard.downloadClicks
  }));
  await page.locator('#export-copy').click();
  await expect(page.locator('#export-status')).toContainText('denied');
  const afterDenied = await page.evaluate(() => ({
    objectUrlCalls: globalThis.__imageClipboard.objectUrlCalls,
    downloadClicks: globalThis.__imageClipboard.downloadClicks
  }));
  expect(afterDenied).toEqual(deniedBaseline);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-download').click()
  ]);
  expect(await downloadedPngDimensions(download)).toMatchObject({ width: 160, height: 100 });
  const afterExplicitDownload = await page.evaluate(() => ({
    objectUrlCalls: globalThis.__imageClipboard.objectUrlCalls,
    downloadClicks: globalThis.__imageClipboard.downloadClicks
  }));
  expect(afterExplicitDownload.objectUrlCalls).toBe(deniedBaseline.objectUrlCalls + 1);
  expect(afterExplicitDownload.downloadClicks).toBe(deniedBaseline.downloadClicks + 1);
});

test('downloads from the inspector with a safe deterministic filename', async ({ context, page }) => {
  await context.addInitScript(() => {
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    const state = { created: [], revoked: [] };
    globalThis.__exportObjectUrls = state;
    URL.createObjectURL = blob => {
      const url = originalCreate(blob);
      state.created.push(url);
      return url;
    };
    URL.revokeObjectURL = url => {
      state.revoked.push(url);
      return originalRevoke(url);
    };
  });
  await openArtifact(page);
  await page.locator('[data-inspector-target="export"]').click();
  await expect(page.locator('#panel-export')).toBeVisible();
  await page.locator('#export-size').selectOption('custom');
  await page.getByText('Lock aspect ratio', { exact: true }).click();
  await page.locator('#export-width').fill('240');
  await page.locator('#export-height').fill('160');
  await page.locator('#export-background').selectOption('transparent');
  await expect(page.locator('#export-summary')).toContainText('240 x 160 px - transparent');
  const objectUrlBaseline = await page.evaluate(() => ({
    created: globalThis.__exportObjectUrls.created.length,
    revoked: globalThis.__exportObjectUrls.revoked.length
  }));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-download').click()
  ]);
  expect(download.suggestedFilename()).toMatch(/_240x160_transparent\.png$/);
  await expect(page.locator('#export-status')).toContainText('Downloaded');
  await expect(page.locator('#export-download')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => globalThis.__exportObjectUrls.revoked.length))
    .toBe(objectUrlBaseline.revoked + 1);
  const objectUrls = await page.evaluate(() => globalThis.__exportObjectUrls);
  expect(objectUrls.created).toHaveLength(objectUrlBaseline.created + 1);
  expect(objectUrls.revoked.at(-1)).toBe(objectUrls.created.at(-1));
});

test('keeps current export dimensions in sync after the desktop inspector resizes the viewer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArtifact(page);
  const canvas = page.locator('#molecule-viewer canvas');
  const before = await canvas.evaluate(element => ({ width: element.width, height: element.height }));

  await page.locator('[data-inspector-target="export"]').click();
  await expect.poll(() => canvas.evaluate(element => element.width)).toBeLessThan(before.width);
  const resized = await canvas.evaluate(element => ({ width: element.width, height: element.height }));
  await expect(page.locator('#export-summary')).toContainText(
    `${resized.width.toLocaleString()} x ${resized.height.toLocaleString()} px`
  );

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-download').click()
  ]);
  expect(await downloadedPngDimensions(download)).toMatchObject(resized);
});

test('renders the 2x and 4x inspector presets at their promised pixels', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 600, height: 500 });
  await openArtifact(page);
  const visible = await page.locator('#molecule-viewer canvas').evaluate(canvas => ({
    width: canvas.width, height: canvas.height
  }));
  await page.locator('[data-inspector-target="export"]').click();

  for (const scale of [2, 4]) {
    await page.locator('#export-size').selectOption(String(scale));
    await expect(page.locator('#export-summary')).toContainText(
      `${(visible.width * scale).toLocaleString()} x ${(visible.height * scale).toLocaleString()} px`
    );
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#export-download').click()
    ]);
    const png = await downloadedPngDimensions(download);
    expect(png).toMatchObject({ width: visible.width * scale, height: visible.height * scale });
    expect(png.bytes).toBeGreaterThan(1_000);
    await expect(page.locator('#export-download')).toBeEnabled();
  }
  await expectHealthyRender(page);
});
