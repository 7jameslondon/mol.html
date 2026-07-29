import { expect, test as base } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const artifactPath = resolve(root, 'dist/example.mol.html');
export const artifactUrl = pathToFileURL(artifactPath).href;
export const miniPeptidePath = resolve(root, 'fixtures/mini-peptide.pdb');
export const ligandPocketPath = resolve(root, 'fixtures/ligand-pocket.pdb');
const collectCoverage = process.env.MOLHTML_COVERAGE === '1';
const coverageRawDirectory = resolve(root, 'test-results/coverage-raw');
const coverageEntryPattern = /^molhtml:\/\/\/src\/(?:model|renderer|persistence|app)\.js$/;
let activeCoverageRecorder = null;

function createCoverageRecorder(testInfo) {
  const contexts = new Set();
  const pageRecords = new Map();
  const entries = [];
  const errors = [];

  async function instrumentPage(page) {
    let pending = pageRecords.get(page);
    if (pending) return pending;
    pending = startPageCoverage(page);
    pageRecords.set(page, pending);
    return pending;
  }

  async function startPageCoverage(page) {
    const session = await page.context().newCDPSession(page);
    const scriptSources = new Map();
    const sourceRequests = new Set();
    const onScriptParsed = ({ scriptId }) => {
      const request = session.send('Debugger.getScriptSource', { scriptId })
        .then(result => scriptSources.set(scriptId, result.scriptSource || ''))
        .catch(() => {})
        .finally(() => sourceRequests.delete(request));
      sourceRequests.add(request);
    };
    session.on('Debugger.scriptParsed', onScriptParsed);
    await session.send('Debugger.enable');
    await session.send('Profiler.enable');
    await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });

    let stopPromise;
    const stop = () => {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (page.isClosed()) {
          await session.detach().catch(() => {});
          return;
        }
        let response;
        try {
          response = await session.send('Profiler.takePreciseCoverage');
          await Promise.allSettled([...sourceRequests]);
          await session.send('Profiler.stopPreciseCoverage');
          await session.send('Profiler.disable');
        } finally {
          session.off('Debugger.scriptParsed', onScriptParsed);
          await session.detach().catch(() => {});
        }
        for (const entry of response.result) {
          if (!coverageEntryPattern.test(entry.url)) continue;
          entries.push({ ...entry, source: scriptSources.get(entry.scriptId) || '' });
        }
      })();
      return stopPromise;
    };

    const originalClose = page.close.bind(page);
    page.close = async (...args) => {
      await stop();
      return originalClose(...args);
    };
    return { stop };
  }

  async function stopContext(context) {
    const records = await Promise.all(
      context.pages().map(page => instrumentPage(page).catch(error => {
        errors.push(error);
        return null;
      }))
    );
    await Promise.all(records.filter(Boolean).map(record => record.stop().catch(error => errors.push(error))));
  }

  async function instrumentContext(context) {
    if (contexts.has(context)) return;
    contexts.add(context);
    const originalNewPage = context.newPage.bind(context);
    context.newPage = async (...args) => {
      const page = await originalNewPage(...args);
      await instrumentPage(page);
      return page;
    };
    const originalClose = context.close.bind(context);
    context.close = async (...args) => {
      await stopContext(context);
      return originalClose(...args);
    };
    context.on('page', page => {
      void instrumentPage(page).catch(error => errors.push(error));
    });
    await Promise.all(context.pages().map(page => instrumentPage(page)));
  }

  async function finish() {
    await Promise.all([...contexts].map(stopContext));
    if (testInfo.status !== testInfo.expectedStatus) return;
    if (errors.length) throw new AggregateError(errors, 'Playwright coverage collection failed.');
    if (!entries.length) {
      throw new Error(`No first-party Playwright coverage was collected for ${testInfo.titlePath().join(' › ')}.`);
    }
    await mkdir(coverageRawDirectory, { recursive: true });
    const coverageId = createHash('sha256')
      .update(`${testInfo.project.name}\0${testInfo.testId}`)
      .digest('hex')
      .slice(0, 20);
    await writeFile(resolve(coverageRawDirectory, `${coverageId}.json`), JSON.stringify(entries), 'utf8');
  }

  return { finish, instrumentContext };
}

export const test = base.extend({
  browser: [async ({ playwright, browserName, headless, channel, launchOptions }, use) => {
    const browser = await playwright[browserName].launch({
      ...launchOptions,
      headless,
      ...(channel ? { channel } : {})
    });
    if (collectCoverage) {
      const originalNewContext = browser.newContext.bind(browser);
      browser.newContext = async (...args) => {
        const context = await originalNewContext(...args);
        if (activeCoverageRecorder) await activeCoverageRecorder.instrumentContext(context);
        return context;
      };
    }
    await use(browser);
    const closing = browser.close();
    if (process.platform === 'win32' && !process.env.CI) {
      await Promise.race([closing, new Promise(resolvePromise => setTimeout(resolvePromise, 2_000))]);
    } else await closing;
  }, { scope: 'worker' }],
  coverageRecorder: [async ({ browser, browserName }, use, testInfo) => {
    if (!collectCoverage) {
      await use(null);
      return;
    }
    if (browserName !== 'chromium') {
      throw new Error('Playwright JavaScript coverage is supported only by the Chromium project.');
    }
    const recorder = createCoverageRecorder(testInfo);
    activeCoverageRecorder = recorder;
    try {
      await Promise.all(browser.contexts().map(context => recorder.instrumentContext(context)));
      await use(recorder);
      await recorder.finish();
    } finally {
      activeCoverageRecorder = null;
    }
  }, { auto: true }],
  renderProbe: [async ({ context, coverageRecorder }, use) => {
    void coverageRecorder;
    await context.addInitScript(() => {
      const state = { contextLost: false, contextRestored: false };
      globalThis.__molhtmlRenderProbe = state;
      document.addEventListener('webglcontextlost', () => { state.contextLost = true; }, true);
      document.addEventListener('webglcontextrestored', () => { state.contextRestored = true; }, true);
    });
    await use();
  }, { auto: true }],
  rendererCleanup: [async ({ page }, use) => {
    await use();
    if (!collectCoverage && !page.isClosed()) {
      await page.goto('about:blank', { waitUntil: 'commit', timeout: 5_000 }).catch(() => {});
    }
  }, { auto: true }]
});
export { expect };

export async function guardUnexpectedNetwork(context) {
  await context.route(/^https?:\/\//, route => route.abort('blockedbyclient'));
}

export function observeRuntime(page, { allowConsole = [] } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!allowConsole.some(pattern => pattern.test(text))) errors.push(`console.error: ${text}`);
  });
  page.on('dialog', async dialog => {
    errors.push(`unexpected ${dialog.type()} dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });
  return () => expect(errors, 'the application emitted no unexpected runtime errors').toEqual([]);
}

export async function openArtifact(page, { url = artifactUrl } = {}) {
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.molhtml?.document));
  await expect(page.locator('#canvas-message')).toBeHidden();
  return page.evaluate(() => window.molhtml.document);
}

export async function renderHealth(page) {
  const canvas = page.locator('#molecule-viewer canvas').first();
  const dimensions = await canvas.evaluate(element => ({ width: element.width, height: element.height }));
  const screenshot = await canvas.screenshot({ animations: 'disabled' });
  const pixels = pngPixelVariance(screenshot);
  const probe = await page.evaluate(() => globalThis.__molhtmlRenderProbe);
  return {
    healthy: dimensions.width > 0 && dimensions.height > 0 && pixels.variance > 12 && !probe.contextLost,
    ...dimensions,
    ...pixels,
    contextLost: probe.contextLost,
    contextRestored: probe.contextRestored
  };
}

function pngPixelVariance(png) {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Renderer screenshot is not a PNG image.');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`Unsupported renderer PNG format (${width}x${height}, depth ${bitDepth}, color type ${colorType}).`);
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idat));
  let cursor = 0;
  let previous = Buffer.alloc(stride);
  let minimum = 765;
  let maximum = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor++];
    const current = Buffer.allocUnsafe(stride);
    for (let x = 0; x < stride; x += 1) {
      const encoded = inflated[cursor++];
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
      const up = previous[x] || 0;
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}.`);
      current[x] = (encoded + predictor) & 255;
    }
    for (let x = 0; x < stride; x += bytesPerPixel) {
      const value = current[x] + current[x + 1] + current[x + 2];
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    previous = current;
  }
  return { minimum, maximum, variance: maximum - minimum, screenshotBytes: png.length };
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

export async function expectHealthyRender(page) {
  expect(await renderHealth(page)).toMatchObject({
    healthy: true,
    contextLost: false
  });
}

export async function installClipboardMock(context) {
  await context.addInitScript(() => {
    const state = { text: '' };
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { async writeText(value) { state.text = String(value); } }
    });
    globalThis.__molhtmlClipboard = state;
  });
}

export async function installPickerMock(context, failure = '') {
  await context.addInitScript(mode => {
    const state = {
      failure: mode,
      name: 'browser-test.mol.html',
      savedHtml: '',
      externalHtml: '',
      modified: 1_000,
      writes: 0,
      closes: 0,
      pickerCalls: 0
    };
    globalThis.__molhtmlPicker = state;
    globalThis.__molhtmlSetExternalFile = html => {
      state.externalHtml = String(html);
      state.modified += 1_000;
    };
    globalThis.showSaveFilePicker = async options => {
      state.pickerCalls += 1;
      state.options = options;
      if (state.failure === 'picker-cancel') throw new DOMException('Test cancellation', 'AbortError');
      if (state.failure === 'picker') throw new Error('Test picker failure');
      return {
        name: state.name,
        async createWritable() {
          if (state.failure === 'createWritable') throw new Error('Test createWritable failure');
          return {
            async write(value) {
              if (state.failure === 'write') throw new Error('Test write failure');
              const blob = value instanceof Blob ? value : new Blob([value]);
              state.savedHtml = await blob.text();
              state.externalHtml = '';
              state.modified += 1_000;
              state.writes += 1;
            },
            async close() {
              if (state.failure === 'close') throw new Error('Test close failure');
              state.closes += 1;
            }
          };
        },
        async getFile() {
          const html = state.externalHtml || state.savedHtml;
          return new File([html], state.name, { type: 'text/html', lastModified: state.modified });
        }
      };
    };
  }, failure);
}

export async function disablePicker(context) {
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
}

export function documentFromHtml(html) {
  const match = html.match(/<script type="application\/molhtml\+json" id="molhtml-doc">\s*([\s\S]*?)\s*<\/script>/i);
  if (!match) throw new Error('Saved HTML has no document block.');
  return JSON.parse(match[1]);
}

export function browserSaveShell(html) {
  return html
    .replace(/(<script type="application\/molhtml\+json" id="molhtml-doc">\s*)[\s\S]*?(\s*<\/script>)/i,
      (_whole, opening, closing) => `${opening}__MOLHTML_EDITABLE_DOCUMENT__${closing}`)
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>__MOLHTML_TITLE__</title>');
}

export async function writeInstrumentedArtifact(outputPath, script) {
  const source = await readFile(artifactPath, 'utf8');
  const marker = '<script data-role="molhtml-app">';
  if (!source.includes(marker)) throw new Error('Could not find the application-script marker.');
  const instrumented = source.replace(marker, () => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>\n${marker}`);
  await writeFile(outputPath, instrumented, 'utf8');
  return pathToFileURL(outputPath).href;
}

export async function savedPickerHtml(page) {
  await expect.poll(() => page.evaluate(() => globalThis.__molhtmlPicker?.savedHtml?.length || 0)).toBeGreaterThan(1_000);
  return page.evaluate(() => globalThis.__molhtmlPicker.savedHtml);
}

export async function closeContext(context) {
  if (!collectCoverage) {
    for (const page of context.pages()) {
      if (!page.isClosed()) await page.goto('about:blank', { waitUntil: 'commit', timeout: 5_000 }).catch(() => {});
    }
  }
  await context.close();
}
