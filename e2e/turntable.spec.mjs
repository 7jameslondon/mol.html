import {
  closeContext, expect, guardUnexpectedNetwork, observeRuntime, openArtifact, test
} from './fixtures.mjs';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ context }) => guardUnexpectedNetwork(context));

test('reports turntable helper and capability contracts', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(() => {
    const Export = window.MolhtmlExport;
    const landscape = Export.fitVideoDimensions(1000, 500, 1280, 720);
    const portrait = Export.fitVideoDimensions(500, 1000, 1280, 720);
    const clockwise = Export.turntableAngles(4, 'clockwise');
    const counterclockwise = Export.turntableAngles(4, 'counterclockwise');
    const defaults = Export.normalizeTurntableOptions({}, 641, 481);
    const oneSided = Export.normalizeTurntableOptions({ width: 1280 }, 1600, 900);
    const rejected = [];
    for (const options of [
      { width: 127, height: 128 },
      { width: 3842, height: 128 },
      { width: 3840, height: 2162 },
      { durationSeconds: 1 },
      { fps: 25 },
      { direction: 'left' }
    ]) {
      try { Export.normalizeTurntableOptions(options, 640, 480); }
      catch (error) { rejected.push(error.code); }
    }
    return {
      landscape, portrait, clockwise, counterclockwise, defaults, oneSided, rejected,
      bitrateLow: Export.videoBitrate(64, 64, 24),
      bitrateHigh: Export.videoBitrate(3840, 2160, 30),
      filename: Export.turntableFilename('demo.mp4.webm.MP4', 'ignored', 1280, 720, 6, 'video/webm;codecs=vp9'),
      mime: Export.normalizeMimeType(' Video/WebM ; CODECS=VP9 '),
      capabilities: window.molhtml.getTurntableCapabilities()
    };
  });

  expect(result.landscape).toEqual({ width: 1280, height: 640 });
  expect(result.portrait).toEqual({ width: 360, height: 720 });
  expect(result.clockwise).toEqual([0, -90, -180, -270]);
  expect(result.counterclockwise).toEqual([0, 90, 180, 270]);
  expect(result.defaults).toMatchObject({ width: 640, height: 480, durationSeconds: 6, fps: 30, frameCount: 180, direction: 'clockwise' });
  expect(result.oneSided).toMatchObject({ width: 1280, height: 720 });
  expect(result.rejected).toEqual(Array(6).fill('export-dimensions'));
  expect(result.bitrateLow).toBe(1_000_000);
  expect(result.bitrateHigh).toBe(20_000_000);
  expect(result.filename).toBe('demo.webm');
  expect(result.mime).toBe('video/webm;codecs=vp9');
  expect(result.capabilities.candidates.map(candidate => candidate.mimeType)).toEqual([
    'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm'
  ]);
});

test('renderer applies absolute viewer-relative frames without mutating camera state', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 96;
    document.body.appendChild(canvas);
    const calls = [];
    let contextLost = false;
    const renderer = Object.create(window.MoleculeRenderer.prototype);
    renderer.surfaceGeneration = 11;
    renderer.doc = { scene: { camera: { view: [9, 9, 9, 9, 0, 0, 0, 1] } } };
    renderer.lastReportedView = 'unchanged';
    renderer.callbacks = { onCamera() { calls.push(['camera']); } };
    renderer.viewer = {
      getCanvas: () => canvas,
      setView(view) { calls.push(['setView', view]); view[0] = 999; },
      rotate(angle, axis, duration) { calls.push(['rotate', angle, axis, duration]); }
    };
    renderer.getSizingInfo = () => ({
      width: 128, height: 96, drawingBufferWidth: 128, drawingBufferHeight: 96, contextLost
    });
    const initialView = [1, 2, 3, 4, 0, 0, 0, 1];
    const cameraBefore = JSON.stringify(renderer.doc.scene.camera);
    renderer.renderTurntableFrame(11, initialView, -45);
    const exportCanvas = renderer.getExportCanvas(11, 128, 96) === canvas;
    const failures = [];
    for (const invoke of [
      () => renderer.renderTurntableFrame(10, initialView, 0),
      () => renderer.renderTurntableFrame(11, [1, 2], 0),
      () => renderer.renderTurntableFrame(11, initialView, Number.NaN),
      () => renderer.getExportCanvas(11, 126, 96)
    ]) {
      try { invoke(); } catch (error) { failures.push(error.code || error.name); }
    }
    contextLost = true;
    try { renderer.getExportCanvas(11, 128, 96); }
    catch (error) { failures.push(error.code); }
    canvas.remove();
    return {
      calls,
      initialView,
      exportCanvas,
      cameraUnchanged: cameraBefore === JSON.stringify(renderer.doc.scene.camera),
      lastReportedView: renderer.lastReportedView,
      failures
    };
  });

  expect(result.calls).toEqual([
    ['setView', [999, 2, 3, 4, 0, 0, 0, 1]],
    ['rotate', -45, 'vy', 0]
  ]);
  expect(result.initialView).toEqual([1, 2, 3, 4, 0, 0, 0, 1]);
  expect(result.exportCanvas).toBe(true);
  expect(result.cameraUnchanged).toBe(true);
  expect(result.lastReportedView).toBe('unchanged');
  expect(result.failures).toEqual(['Error', 'TypeError', 'TypeError', 'renderer-dimension-mismatch', 'renderer-context-lost']);
});

test('falls back before recorder start and releases every fake media resource', async ({ context, page }) => {
  await context.addInitScript(() => {
    globalThis.__turntablePermissionCalls = [];
    if (!navigator.mediaDevices) return;
    for (const name of ['getUserMedia', 'getDisplayMedia']) {
      try {
        Object.defineProperty(navigator.mediaDevices, name, {
          configurable: true,
          value() {
            globalThis.__turntablePermissionCalls.push(name);
            throw new Error(`${name} must not be called by turntable export`);
          }
        });
      } catch {}
    }
  });
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    const attempts = [];
    const tracks = [];
    const angles = [];
    const progress = [];
    const sequence = [];
    const completeStates = [];
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 96;
    document.body.appendChild(canvas);
    canvas.captureStream = () => {
      const track = {
        readyState: 'live', requests: 0, stops: 0,
        requestFrame() { this.requests += 1; sequence.push('request'); },
        stop() { this.stops += 1; this.readyState = 'ended'; }
      };
      tracks.push(track);
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    };
    class FakeRecorder extends EventTarget {
      static isTypeSupported(type) {
        return type === 'video/mp4;codecs=avc1' || type === 'video/webm;codecs=vp8';
      }
      constructor(stream, options) {
        super();
        attempts.push(options.mimeType || 'browser');
        if (options.mimeType === 'video/mp4;codecs=avc1') throw new DOMException('no encoder', 'NotSupportedError');
        this.state = 'inactive';
        this.mimeType = options.mimeType || 'video/webm';
        this.videoBitsPerSecond = options.videoBitsPerSecond;
      }
      start(timeslice) {
        this.timeslice = timeslice;
        this.state = 'recording';
        queueMicrotask(() => this.dispatchEvent(new Event('start')));
      }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => {
          const event = new Event('dataavailable');
          Object.defineProperty(event, 'data', { value: new Blob(['fake-video'], { type: this.mimeType }) });
          this.dispatchEvent(event);
          this.dispatchEvent(new Event('stop'));
        });
      }
    }
    let resets = 0;
    const renderer = {
      getSizingInfo: () => ({
        width: canvas.width, height: canvas.height,
        drawingBufferWidth: canvas.width, drawingBufferHeight: canvas.height,
        devicePixelRatio: 1, contextLost: false,
        limits: { maxViewportWidth: 4096, maxViewportHeight: 4096, maxTextureSize: 4096, maxRenderbufferSize: 4096 }
      }),
      setOutputSize(width, height) { canvas.width = width; canvas.height = height; },
      setExportOptions() {},
      setDocument() { return 1; },
      whenSurfacesReady: async () => 1,
      getExportCanvas: () => canvas,
      renderTurntableFrame(generation, view, angle, axis) {
        angles.push({ generation, view: [...view], angle, axis });
        sequence.push(`render:${angle}`);
      },
      resetAfterExport() { resets += 1; return true; },
      resourceCounts: () => ({ models: 0, shapes: 0, labels: 0, surfaces: 0 })
    };
    let clock = 0;
    const source = {
      document: {
        title: 'Fake molecule', structure: { name: 'Fake molecule' },
        scene: { camera: { view: [1, 2, 3, 4, 0, 0, 0, 1] }, measurements: [], savedSelections: [] }
      },
      camera: { view: [1, 2, 3, 4, 0, 0, 0, 1] },
      visibleSize: { width: 128, height: 96, devicePixelRatio: 1 }
    };
    const service = new window.MolhtmlExport.ExportService(() => source, {
      mediaRecorderClass: FakeRecorder,
      recorderStartTimeoutMs: 50,
      recorderStopTimeoutMs: 50,
      recorderDisposeTimeoutMs: 50,
      now: () => { clock += 1000; return clock; }
    });
    service.ensureRenderer = () => renderer;
    const nextAnimationFrame = service.nextAnimationFrame.bind(service);
    service.nextAnimationFrame = signal => {
      sequence.push('animation-frame');
      return nextAnimationFrame(signal);
    };
    const nextTask = service.nextTask.bind(service);
    service.nextTask = signal => {
      sequence.push('task');
      return nextTask(signal);
    };
    const initiatedDownloads = [];
    service.initiateDownload = (blob, filename) => {
      initiatedDownloads.push({ type: blob.type, size: blob.size, filename });
      return filename;
    };
    const sourceBefore = JSON.stringify(source);
    const blobs = [];
    let downloadResult = null;
    for (let index = 0; index < 3; index += 1) {
      const options = {
        width: 128, height: 96, durationSeconds: 2, fps: 24,
        direction: 'counterclockwise', onProgress: record => {
          progress.push(record);
          if (record.phase === 'complete') completeStates.push(service.debugState());
        }
      };
      if (index === 2) downloadResult = await service.downloadTurntable(options);
      else blobs.push(await service.renderTurntable(options));
    }
    const debug = service.debugState();
    canvas.remove();
    return {
      attempts,
      tracks: tracks.map(track => ({ requests: track.requests, stops: track.stops, readyState: track.readyState })),
      angles,
      progress,
      sequence,
      completeStates,
      resets,
      blobs: blobs.map(blob => ({ type: blob.type, size: blob.size })),
      downloadResult,
      initiatedDownloads,
      debug,
      immutable: sourceBefore === JSON.stringify(source),
      permissionCalls: globalThis.__turntablePermissionCalls
    };
  });

  expect(result.attempts).toEqual(Array(3).fill(['video/mp4;codecs=avc1', 'video/webm;codecs=vp8']).flat());
  expect(result.tracks).toEqual(Array(3).fill([
    { requests: 0, stops: 1, readyState: 'ended' },
    { requests: 48, stops: 1, readyState: 'ended' }
  ]).flat());
  expect(result.angles).toHaveLength(144);
  expect(result.angles[0]).toMatchObject({ angle: 0, axis: 'vy' });
  expect(result.angles[47].angle).toBe(352.5);
  expect(result.angles[48].angle).toBe(0);
  expect(result.angles.at(-1).angle).toBe(352.5);
  expect(result.resets).toBe(3);
  expect(result.blobs).toHaveLength(2);
  expect(result.blobs.every(blob => blob.type === 'video/webm;codecs=vp8' && blob.size > 0)).toBe(true);
  expect(result.initiatedDownloads).toEqual([{
    type: 'video/webm;codecs=vp8', size: result.initiatedDownloads[0].size,
    filename: 'Fake_molecule_turntable_128x96_2s.webm'
  }]);
  expect(result.initiatedDownloads[0].size).toBeGreaterThan(0);
  expect(result.downloadResult).toMatchObject({
    status: 'downloaded', filename: 'Fake_molecule_turntable_128x96_2s.webm',
    width: 128, height: 96, requestedDurationSeconds: 2, requestedFps: 24,
    submittedFrameCount: 48, mimeType: 'video/webm;codecs=vp8',
    requestedVideoBitsPerSecond: 1_000_000, recorderTargetVideoBitsPerSecond: 1_000_000
  });
  expect(result.downloadResult.recordingElapsedSeconds).toBeGreaterThan(0);
  expect(result.immutable).toBe(true);
  expect(result.permissionCalls).toEqual([]);
  expect(result.progress.filter(record => record.phase === 'complete')).toHaveLength(3);
  const initialFrameIndex = result.sequence.indexOf('render:0');
  expect(result.sequence.slice(initialFrameIndex, initialFrameIndex + 4)).toEqual([
    'render:0', 'request', 'animation-frame', 'task'
  ]);
  expect(result.completeStates).toHaveLength(3);
  expect(result.completeStates.every(state => (
    state.busy === true && state.jobKind === 'video' && state.jobPhase === 'finalizing'
  ))).toBe(true);
  expect(result.debug).toMatchObject({
    busy: false, jobKind: null, jobPhase: 'idle', activeSessionCount: 0, liveTrackCount: 0,
    recorderListenerCount: 0, activeTimeoutCount: 0, activeAnimationFrameCount: 0, bufferedChunkCount: 0
  });
});

test('cancels unresolved surfaces through quarantine and resets after settlement', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    const probe = {
      documentAdds: 0, documentRemoves: 0, windowAdds: 0, windowRemoves: 0,
      signalAdds: 0, signalRemoves: 0, abortSignalAdds: 0, abortSignalRemoves: 0,
      timeoutCreates: 0, timeoutClears: 0
    };
    const instrumentTarget = (target, type, addKey, removeKey) => {
      const add = target.addEventListener;
      const remove = target.removeEventListener;
      target.addEventListener = function (eventType, ...args) {
        if (eventType === type) probe[addKey] += 1;
        return add.call(this, eventType, ...args);
      };
      target.removeEventListener = function (eventType, ...args) {
        if (eventType === type) probe[removeKey] += 1;
        return remove.call(this, eventType, ...args);
      };
      return () => { target.addEventListener = add; target.removeEventListener = remove; };
    };
    const restores = [
      instrumentTarget(document, 'visibilitychange', 'documentAdds', 'documentRemoves'),
      instrumentTarget(window, 'pagehide', 'windowAdds', 'windowRemoves')
    ];
    const nativeSetTimeout = globalThis.setTimeout;
    const nativeClearTimeout = globalThis.clearTimeout;
    const activeTimeouts = new Set();
    globalThis.setTimeout = (callback, milliseconds, ...args) => {
      let handle;
      handle = nativeSetTimeout((...callbackArgs) => {
        activeTimeouts.delete(handle);
        callback(...callbackArgs);
      }, milliseconds, ...args);
      activeTimeouts.add(handle);
      probe.timeoutCreates += 1;
      return handle;
    };
    globalThis.clearTimeout = handle => {
      if (activeTimeouts.delete(handle)) probe.timeoutClears += 1;
      return nativeClearTimeout(handle);
    };
    let settle;
    const settlement = new Promise(resolve => { settle = resolve; });
    let resets = 0;
    const renderer = {
      getSizingInfo: () => ({
        width: 128, height: 96, drawingBufferWidth: 128, drawingBufferHeight: 96,
        devicePixelRatio: 1, contextLost: false,
        limits: { maxViewportWidth: 4096, maxViewportHeight: 4096, maxTextureSize: 4096, maxRenderbufferSize: 4096 }
      }),
      setOutputSize() {}, setExportOptions() {}, setDocument() { return 7; },
      whenSurfacesReady: () => settlement,
      resetAfterExport(generation) { if (generation === 7) resets += 1; return generation === 7; },
      resourceCounts: () => ({ models: 0, shapes: 0, labels: 0, surfaces: 0 })
    };
    const source = {
      document: {
        title: 'Surface', structure: { name: 'Surface' },
        scene: { camera: { view: [0, 0, 0, 10, 0, 0, 0, 1] }, measurements: [], savedSelections: [] }
      },
      camera: { view: [0, 0, 0, 10, 0, 0, 0, 1] },
      visibleSize: { width: 128, height: 96, devicePixelRatio: 1 }
    };
    const service = new window.MolhtmlExport.ExportService(() => source, { timeoutMs: 500 });
    service.ensureRenderer = () => renderer;
    const controller = new AbortController();
    restores.push(instrumentTarget(controller.signal, 'abort', 'signalAdds', 'signalRemoves'));
    const eventTargetAdd = EventTarget.prototype.addEventListener;
    const eventTargetRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, ...args) {
      if (this instanceof AbortSignal && type === 'abort') probe.abortSignalAdds += 1;
      return eventTargetAdd.call(this, type, ...args);
    };
    EventTarget.prototype.removeEventListener = function (type, ...args) {
      if (this instanceof AbortSignal && type === 'abort') probe.abortSignalRemoves += 1;
      return eventTargetRemove.call(this, type, ...args);
    };
    restores.push(() => {
      EventTarget.prototype.addEventListener = eventTargetAdd;
      EventTarget.prototype.removeEventListener = eventTargetRemove;
    });
    const job = service.renderTurntable({ width: 128, height: 96, durationSeconds: 2, fps: 24, signal: controller.signal });
    controller.abort();
    const failure = await job.then(() => null, error => ({ name: error.name, code: error.code }));
    const during = service.debugState();
    const overlap = await service.renderPNG({ width: 128, height: 96 })
      .then(() => null, error => ({ name: error.name, code: error.code }));
    settle(7);
    await new Promise(resolve => setTimeout(resolve, 0));
    const after = service.debugState();
    probe.activeTimeouts = activeTimeouts.size;
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
    for (const restore of restores.reverse()) restore();
    return { failure, during, overlap, after, resets, probe };
  });

  expect(result.failure).toEqual({ name: 'ExportCancelledError', code: 'export-cancelled' });
  expect(result.during).toMatchObject({ busy: false, quarantined: true, jobKind: null, activeTimeoutCount: 0 });
  expect(result.overlap).toEqual({ name: 'ExportBusyError', code: 'export-busy' });
  expect(result.after).toMatchObject({ busy: false, quarantined: false, fatal: false });
  expect(result.resets).toBe(1);
  expect(result.probe).toMatchObject({
    documentAdds: 1, documentRemoves: 1, windowAdds: 1, windowRemoves: 1,
    signalAdds: 1, signalRemoves: 1, activeTimeouts: 0
  });
  expect(result.probe.abortSignalAdds).toBeGreaterThan(0);
  expect(result.probe.abortSignalRemoves).toBe(result.probe.abortSignalAdds);
});

test('contains recorder timeouts, MIME conflicts, cancellation, and context loss', async ({ page }) => {
  await openArtifact(page);
  const scenarios = await page.evaluate(async () => {
    async function run(mode) {
      const probe = {
        documentAdds: 0, documentRemoves: 0, windowAdds: 0, windowRemoves: 0,
        signalAdds: 0, signalRemoves: 0, canvasAdds: 0, canvasRemoves: 0,
        abortSignalAdds: 0, abortSignalRemoves: 0,
        recorderAdds: 0, recorderRemoves: 0, recorderConstructions: 0, recorderStops: 0,
        timeoutCreates: 0, timeoutClears: 0, animationFrameCreates: 0, animationFrameCancels: 0
      };
      const instrumentTarget = (target, type, addKey, removeKey) => {
        const add = target.addEventListener;
        const remove = target.removeEventListener;
        target.addEventListener = function (eventType, ...args) {
          if (eventType === type) probe[addKey] += 1;
          return add.call(this, eventType, ...args);
        };
        target.removeEventListener = function (eventType, ...args) {
          if (eventType === type) probe[removeKey] += 1;
          return remove.call(this, eventType, ...args);
        };
        return () => {
          target.addEventListener = add;
          target.removeEventListener = remove;
        };
      };
      const restores = [
        instrumentTarget(document, 'visibilitychange', 'documentAdds', 'documentRemoves'),
        instrumentTarget(window, 'pagehide', 'windowAdds', 'windowRemoves')
      ];
      const nativeSetTimeout = globalThis.setTimeout;
      const nativeClearTimeout = globalThis.clearTimeout;
      const nativeRequestAnimationFrame = globalThis.requestAnimationFrame;
      const nativeCancelAnimationFrame = globalThis.cancelAnimationFrame;
      const activeTimeouts = new Set();
      const activeAnimationFrames = new Set();
      globalThis.setTimeout = (callback, milliseconds, ...args) => {
        let handle;
        handle = nativeSetTimeout((...callbackArgs) => {
          activeTimeouts.delete(handle);
          callback(...callbackArgs);
        }, milliseconds, ...args);
        activeTimeouts.add(handle);
        probe.timeoutCreates += 1;
        return handle;
      };
      globalThis.clearTimeout = handle => {
        if (activeTimeouts.delete(handle)) probe.timeoutClears += 1;
        return nativeClearTimeout(handle);
      };
      globalThis.requestAnimationFrame = callback => {
        let handle;
        handle = nativeRequestAnimationFrame(timestamp => {
          activeAnimationFrames.delete(handle);
          callback(timestamp);
        });
        activeAnimationFrames.add(handle);
        probe.animationFrameCreates += 1;
        return handle;
      };
      globalThis.cancelAnimationFrame = handle => {
        if (activeAnimationFrames.delete(handle)) probe.animationFrameCancels += 1;
        return nativeCancelAnimationFrame(handle);
      };
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 96;
      document.body.appendChild(canvas);
      restores.push(instrumentTarget(canvas, 'webglcontextlost', 'canvasAdds', 'canvasRemoves'));
      let activeRecorder = null;
      let contextLost = false;
      let frameRenders = 0;
      const track = {
        readyState: 'live', requests: 0, stops: 0,
        requestFrame() {
          this.requests += 1;
          if ((mode === 'runtime-error' || mode === 'runtime-error-reset-failure') && this.requests === 3) {
            queueMicrotask(() => {
              const event = new Event('error');
              Object.defineProperty(event, 'error', { value: new Error('encoder exploded') });
              activeRecorder.dispatchEvent(event);
            });
          }
          if (mode === 'spontaneous-stop' && this.requests === 3) {
            queueMicrotask(() => {
              activeRecorder.state = 'inactive';
              activeRecorder.dispatchEvent(new Event('stop'));
            });
          }
        },
        stop() {
          this.stops += 1;
          this.readyState = 'ended';
          if (mode === 'abort-on-track-stop') controller.abort();
        }
      };
      canvas.captureStream = () => ({ getTracks: () => [track], getVideoTracks: () => [track] });
      class FakeRecorder extends EventTarget {
        static isTypeSupported(type) {
          if (mode === 'browser-selected') return false;
          return type === 'video/webm;codecs=vp8';
        }
        constructor(stream, options) {
          super();
          probe.recorderConstructions += 1;
          activeRecorder = this;
          this.state = 'inactive';
          this.mimeType = options.mimeType || 'video/webm;codecs=vp9';
          this.videoBitsPerSecond = options.videoBitsPerSecond;
        }
        addEventListener(...args) { probe.recorderAdds += 1; return super.addEventListener(...args); }
        removeEventListener(...args) { probe.recorderRemoves += 1; return super.removeEventListener(...args); }
        start() {
          this.state = 'recording';
          if (mode !== 'start-timeout') queueMicrotask(() => this.dispatchEvent(new Event('start')));
        }
        stop() {
          probe.recorderStops += 1;
          if (mode === 'stop-timeout') return;
          this.state = 'inactive';
          queueMicrotask(() => {
            const chunkTypes = mode === 'mime-conflict'
              ? ['video/webm;codecs=vp8', 'video/mp4']
              : mode === 'empty-chunks'
                ? []
                : [mode === 'browser-selected' ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8'];
            if (mode === 'mime-reset-at-stop') this.mimeType = '';
            for (const type of chunkTypes) {
              const event = new Event('dataavailable');
              Object.defineProperty(event, 'data', { value: new Blob(['chunk'], { type }) });
              this.dispatchEvent(event);
            }
            this.dispatchEvent(new Event('stop'));
            if (mode === 'late-events') {
              setTimeout(() => {
                const lateData = new Event('dataavailable');
                Object.defineProperty(lateData, 'data', { value: new Blob(['late'], { type: 'video/mp4' }) });
                this.dispatchEvent(lateData);
                this.dispatchEvent(new Event('error'));
                this.dispatchEvent(new Event('stop'));
              }, 0);
            }
          });
        }
      }
      let resets = 0;
      const renderer = {
        getSizingInfo: () => ({
          width: 128, height: 96, drawingBufferWidth: 128, drawingBufferHeight: 96,
          devicePixelRatio: 1, contextLost,
          limits: { maxViewportWidth: 4096, maxViewportHeight: 4096, maxTextureSize: 4096, maxRenderbufferSize: 4096 }
        }),
        setOutputSize() {}, setExportOptions() {}, setDocument() { return 4; },
        whenSurfacesReady: async () => 4,
        getExportCanvas() {
          if (contextLost) {
            const error = new Error('lost');
            error.code = 'renderer-context-lost';
            throw error;
          }
          return canvas;
        },
        renderTurntableFrame() {
          frameRenders += 1;
          if (mode === 'context-loss' && frameRenders === 3) {
            contextLost = true;
            canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
          }
        },
        resetAfterExport() {
          resets += 1;
          if (mode === 'reset-failure' || mode === 'runtime-error-reset-failure') throw new Error('reset exploded');
          return true;
        },
        resourceCounts: () => ({ models: 0, shapes: 0, labels: 0, surfaces: 0 })
      };
      let clock = 0;
      const source = {
        document: {
          title: 'Failures', structure: { name: 'Failures' },
          scene: { camera: { view: [0, 0, 0, 10, 0, 0, 0, 1] }, measurements: [], savedSelections: [] }
        },
        camera: { view: [0, 0, 0, 10, 0, 0, 0, 1] },
        visibleSize: { width: 128, height: 96, devicePixelRatio: 1 }
      };
      const service = new window.MolhtmlExport.ExportService(() => source, {
        mediaRecorderClass: FakeRecorder,
        recorderStartTimeoutMs: 30,
        recorderStopTimeoutMs: 30,
        recorderDisposeTimeoutMs: 30,
        now: () => { clock += 1000; return clock; }
      });
      service.ensureRenderer = () => renderer;
      const controller = new AbortController();
      restores.push(instrumentTarget(controller.signal, 'abort', 'signalAdds', 'signalRemoves'));
      const eventTargetAdd = EventTarget.prototype.addEventListener;
      const eventTargetRemove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function (type, ...args) {
        if (this instanceof AbortSignal && type === 'abort') probe.abortSignalAdds += 1;
        return eventTargetAdd.call(this, type, ...args);
      };
      EventTarget.prototype.removeEventListener = function (type, ...args) {
        if (this instanceof AbortSignal && type === 'abort') probe.abortSignalRemoves += 1;
        return eventTargetRemove.call(this, type, ...args);
      };
      restores.push(() => {
        EventTarget.prototype.addEventListener = eventTargetAdd;
        EventTarget.prototype.removeEventListener = eventTargetRemove;
      });
      const options = {
        width: 128, height: 96, durationSeconds: 2, fps: 24,
        signal: controller.signal,
        onProgress(record) {
          if (mode === 'cancel' && record.phase === 'recording' && record.completedFrames >= 3) controller.abort();
          if (mode === 'cancel-first-frame' && record.phase === 'recording' && record.completedFrames === 1) controller.abort();
          if (mode === 'cancel-final-hold' && record.phase === 'recording' && record.completedFrames === record.totalFrames) controller.abort();
          if (mode === 'cancel-finalizing' && record.phase === 'finalizing') controller.abort();
        }
      };
      const outcome = await service.renderTurntable(options)
        .then(blob => ({ type: blob.type, size: blob.size }), error => ({ name: error.name, code: error.code }));
      if (mode === 'late-events') await new Promise(resolve => setTimeout(resolve, 10));
      const succeeded = Boolean(outcome.type);
      const failure = succeeded ? null : outcome;
      const subsequent = mode === 'context-loss' || mode === 'reset-failure' || mode === 'runtime-error-reset-failure'
        ? await service.renderPNG({ width: 128, height: 96 }).then(() => null, error => ({ code: error.code }))
        : null;
      const debug = service.debugState();
      probe.activeTimeouts = activeTimeouts.size;
      probe.activeAnimationFrames = activeAnimationFrames.size;
      globalThis.setTimeout = nativeSetTimeout;
      globalThis.clearTimeout = nativeClearTimeout;
      globalThis.requestAnimationFrame = nativeRequestAnimationFrame;
      globalThis.cancelAnimationFrame = nativeCancelAnimationFrame;
      for (const restore of restores.reverse()) restore();
      canvas.remove();
      return { mode, outcome, failure, subsequent, resets, track: { requests: track.requests, stops: track.stops }, debug, probe };
    }
    const results = [];
    for (const mode of [
      'start-timeout', 'stop-timeout', 'mime-conflict', 'empty-chunks', 'runtime-error',
      'cancel', 'cancel-first-frame', 'cancel-final-hold', 'cancel-finalizing', 'abort-on-track-stop',
      'spontaneous-stop', 'context-loss', 'browser-selected', 'mime-reset-at-stop', 'late-events',
      'reset-failure', 'runtime-error-reset-failure'
    ]) {
      results.push(await run(mode));
    }
    return results;
  });

  const byMode = Object.fromEntries(scenarios.map(scenario => [scenario.mode, scenario]));
  for (const mode of ['start-timeout', 'stop-timeout', 'mime-conflict', 'empty-chunks', 'runtime-error', 'spontaneous-stop']) {
    expect(byMode[mode].failure).toMatchObject({ code: 'export-video-encode' });
  }
  for (const mode of ['cancel', 'cancel-first-frame', 'cancel-final-hold', 'cancel-finalizing', 'abort-on-track-stop']) {
    expect(byMode[mode].failure).toMatchObject({ code: 'export-cancelled' });
  }
  expect(byMode['context-loss'].failure).toMatchObject({ code: 'export-render' });
  expect(byMode['context-loss'].subsequent).toEqual({ code: 'export-render' });
  expect(byMode['browser-selected'].outcome).toMatchObject({ type: 'video/webm;codecs=vp9' });
  expect(byMode['mime-reset-at-stop'].outcome).toMatchObject({ type: 'video/webm;codecs=vp8' });
  expect(byMode['late-events'].outcome).toMatchObject({ type: 'video/webm;codecs=vp8' });
  expect(byMode['reset-failure'].failure).toMatchObject({ code: 'export-render' });
  expect(byMode['reset-failure'].subsequent).toEqual({ code: 'export-render' });
  expect(byMode['runtime-error-reset-failure'].failure).toMatchObject({ code: 'export-video-encode' });
  expect(byMode['runtime-error-reset-failure'].subsequent).toEqual({ code: 'export-render' });
  for (const scenario of scenarios) {
    expect(scenario.resets).toBe(1);
    expect(scenario.track.stops).toBe(1);
    expect(scenario.debug).toMatchObject({
      busy: false, jobKind: null, jobPhase: 'idle', activeSessionCount: 0, liveTrackCount: 0,
      recorderListenerCount: 0, activeTimeoutCount: 0, activeAnimationFrameCount: 0, bufferedChunkCount: 0
    });
    expect(scenario.probe).toMatchObject({
      documentAdds: 1, documentRemoves: 1, windowAdds: 1, windowRemoves: 1,
      signalAdds: 1, signalRemoves: 1, canvasAdds: 1, canvasRemoves: 1,
      recorderAdds: 4, recorderRemoves: 4, recorderConstructions: 1,
      activeTimeouts: 0, activeAnimationFrames: 0
    });
    expect(scenario.probe.abortSignalAdds).toBeGreaterThan(0);
    expect(scenario.probe.abortSignalRemoves).toBe(scenario.probe.abortSignalAdds);
  }
  for (const scenario of scenarios.filter(scenario => scenario.mode !== 'spontaneous-stop')) {
    expect(scenario.probe.recorderStops).toBe(1);
  }
  expect(byMode['spontaneous-stop'].probe.recorderStops).toBe(0);
  expect(byMode['context-loss'].debug.fatal).toBe(true);
  expect(byMode['reset-failure'].debug.fatal).toBe(true);
  expect(byMode['runtime-error-reset-failure'].debug.fatal).toBe(true);
});

test('rejects malformed canvas track topologies and stops every acquired track', async ({ page }) => {
  await openArtifact(page);
  const results = await page.evaluate(async () => {
    async function run(mode) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 96;
      document.body.appendChild(canvas);
      const makeTrack = readyState => ({
        readyState, stops: 0, requestFrame() {},
        stop() { this.stops += 1; this.readyState = 'ended'; }
      });
      const tracks = mode === 'missing' ? []
        : mode === 'extra' ? [makeTrack('live'), makeTrack('live')]
          : [makeTrack('ended')];
      canvas.captureStream = () => ({ getTracks: () => tracks, getVideoTracks: () => tracks });
      class FakeRecorder {
        static isTypeSupported(type) { return type === 'video/webm;codecs=vp8'; }
        constructor() { throw new Error('Recorder must not be constructed for malformed tracks.'); }
      }
      let resets = 0;
      const renderer = {
        getSizingInfo: () => ({
          width: 128, height: 96, drawingBufferWidth: 128, drawingBufferHeight: 96,
          devicePixelRatio: 1, contextLost: false,
          limits: { maxViewportWidth: 4096, maxViewportHeight: 4096, maxTextureSize: 4096, maxRenderbufferSize: 4096 }
        }),
        setOutputSize() {}, setExportOptions() {}, setDocument: () => 9,
        whenSurfacesReady: async () => 9, getExportCanvas: () => canvas,
        resetAfterExport() { resets += 1; return true; },
        resourceCounts: () => ({ models: 0, shapes: 0, labels: 0, surfaces: 0 })
      };
      const source = {
        document: {
          title: 'Track topology', structure: { name: 'Track topology' },
          scene: { camera: { view: [0, 0, 0, 10, 0, 0, 0, 1] }, measurements: [], savedSelections: [] }
        },
        camera: { view: [0, 0, 0, 10, 0, 0, 0, 1] },
        visibleSize: { width: 128, height: 96, devicePixelRatio: 1 }
      };
      const service = new window.MolhtmlExport.ExportService(() => source, { mediaRecorderClass: FakeRecorder });
      service.ensureRenderer = () => renderer;
      const failure = await service.renderTurntable({ width: 128, height: 96, durationSeconds: 2, fps: 24 })
        .then(() => null, error => ({ code: error.code }));
      const debug = service.debugState();
      canvas.remove();
      return { mode, failure, stops: tracks.map(track => track.stops), resets, debug };
    }
    return Promise.all(['missing', 'extra', 'dead'].map(run));
  });

  expect(results.map(result => result.failure)).toEqual(Array(3).fill({ code: 'export-video-unsupported' }));
  expect(results.find(result => result.mode === 'missing').stops).toEqual([]);
  expect(results.find(result => result.mode === 'extra').stops).toEqual([1, 1]);
  expect(results.find(result => result.mode === 'dead').stops).toEqual([1]);
  for (const result of results) {
    expect(result.resets).toBe(1);
    expect(result.debug).toMatchObject({
      busy: false, jobKind: null, jobPhase: 'idle', activeSessionCount: 0, liveTrackCount: 0,
      recorderListenerCount: 0, activeTimeoutCount: 0, activeAnimationFrameCount: 0, bufferedChunkCount: 0
    });
  }
});

test('enforces cross-format single-flight and recovers after cancellation', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 96;
    document.body.appendChild(canvas);
    let track;
    canvas.captureStream = () => {
      track = {
        readyState: 'live', requests: 0, stops: 0,
        requestFrame() { this.requests += 1; },
        stop() { this.stops += 1; this.readyState = 'ended'; }
      };
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    };
    class FakeRecorder extends EventTarget {
      static isTypeSupported(type) { return type === 'video/webm;codecs=vp8'; }
      constructor(stream, options) {
        super(); this.state = 'inactive'; this.mimeType = options.mimeType;
        this.videoBitsPerSecond = options.videoBitsPerSecond;
      }
      start() { this.state = 'recording'; queueMicrotask(() => this.dispatchEvent(new Event('start'))); }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => {
          const event = new Event('dataavailable');
          Object.defineProperty(event, 'data', { value: new Blob(['video'], { type: this.mimeType }) });
          this.dispatchEvent(event);
          this.dispatchEvent(new Event('stop'));
        });
      }
    }
    let resets = 0;
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], { type: 'image/png' });
    const renderer = {
      getSizingInfo: () => ({
        width: 128, height: 96, drawingBufferWidth: 128, drawingBufferHeight: 96,
        devicePixelRatio: 1, contextLost: false,
        limits: { maxViewportWidth: 4096, maxViewportHeight: 4096, maxTextureSize: 4096, maxRenderbufferSize: 4096 }
      }),
      setOutputSize() {}, setExportOptions() {}, setDocument: () => 3,
      whenSurfacesReady: async () => 3, getExportCanvas: () => canvas,
      renderTurntableFrame() {}, capturePNG: async () => png,
      resetAfterExport() { resets += 1; return true; },
      resourceCounts: () => ({ models: 0, shapes: 0, labels: 0, surfaces: 0 })
    };
    const source = {
      document: {
        title: 'Concurrency', structure: { name: 'Concurrency' },
        scene: { camera: { view: [0, 0, 0, 10, 0, 0, 0, 1] }, measurements: [], savedSelections: [] }
      },
      camera: { view: [0, 0, 0, 10, 0, 0, 0, 1] },
      visibleSize: { width: 128, height: 96, devicePixelRatio: 1 }
    };
    let clock = 0;
    const service = new window.MolhtmlExport.ExportService(() => source, {
      mediaRecorderClass: FakeRecorder,
      now: () => { clock += 1000; return clock; }
    });
    service.ensureRenderer = () => renderer;
    const controller = new AbortController();
    let imageOverlap;
    let videoOverlap;
    let checkedOverlap = false;
    const active = service.renderTurntable({
      width: 128, height: 96, durationSeconds: 2, fps: 24, signal: controller.signal,
      onProgress(record) {
        if (checkedOverlap || record.phase !== 'recording') return;
        checkedOverlap = true;
        imageOverlap = service.renderPNG({ width: 128, height: 96 }).then(() => null, error => error.code);
        videoOverlap = service.renderTurntable({ width: 128, height: 96, durationSeconds: 2, fps: 24 })
          .then(() => null, error => error.code);
        controller.abort();
      }
    }).then(() => null, error => error.code);
    const cancelled = await active;
    const overlaps = await Promise.all([imageOverlap, videoOverlap]);
    const recoveredImage = await service.renderPNG({ width: 128, height: 96 });
    const recoveredVideo = await service.renderTurntable({ width: 128, height: 96, durationSeconds: 2, fps: 24 });
    const debug = service.debugState();
    canvas.remove();
    return {
      cancelled, overlaps, recoveredImage: [recoveredImage.type, recoveredImage.size],
      recoveredVideo: [recoveredVideo.type, recoveredVideo.size], resets, trackStops: track.stops, debug
    };
  });

  expect(result.cancelled).toBe('export-cancelled');
  expect(result.overlaps).toEqual(['export-busy', 'export-busy']);
  expect(result.recoveredImage).toEqual(['image/png', 9]);
  expect(result.recoveredVideo[0]).toBe('video/webm;codecs=vp8');
  expect(result.recoveredVideo[1]).toBeGreaterThan(0);
  expect(result.resets).toBe(3);
  expect(result.trackStops).toBe(1);
  expect(result.debug).toMatchObject({
    busy: false, jobKind: null, jobPhase: 'idle', activeSessionCount: 0, liveTrackCount: 0,
    recorderListenerCount: 0, activeTimeoutCount: 0, activeAnimationFrameCount: 0, bufferedChunkCount: 0
  });
});

test('coalesces concurrent and repeated recorder disposal', async ({ page }) => {
  await openArtifact(page);
  const result = await page.evaluate(async () => {
    class FakeRecorder extends EventTarget {
      constructor() {
        super(); this.state = 'recording'; this.mimeType = 'video/webm;codecs=vp8';
        this.videoBitsPerSecond = 1_000_000; this.stopCalls = 0;
      }
      stop() {
        this.stopCalls += 1;
        queueMicrotask(() => {
          this.state = 'inactive';
          this.dispatchEvent(new Event('stop'));
        });
      }
    }
    const service = new window.MolhtmlExport.ExportService(() => ({}), { recorderDisposeTimeoutMs: 50 });
    const recorder = new FakeRecorder();
    const track = {
      readyState: 'live', stops: 0,
      requestFrame() {},
      stop() { this.stops += 1; this.readyState = 'ended'; }
    };
    service.mediaDebug.liveTrackCount = 1;
    const session = new window.MolhtmlExport.RecorderSession(
      service,
      { getTracks: () => [track], getVideoTracks: () => [track] },
      [track], track, recorder, 'video/webm;codecs=vp8', 1_000_000
    );
    const first = session.dispose();
    const second = session.dispose();
    const samePromise = first === second;
    await Promise.all([first, second]);
    const third = session.dispose();
    const repeatedPromise = third === first;
    await third;
    recorder.dispatchEvent(new Event('stop'));
    recorder.dispatchEvent(new Event('error'));
    return {
      samePromise, repeatedPromise, stopCalls: recorder.stopCalls, trackStops: track.stops,
      disposed: session.disposed, debug: service.debugState()
    };
  });

  expect(result).toMatchObject({
    samePromise: true, repeatedPromise: true, stopCalls: 1, trackStops: 1, disposed: true
  });
  expect(result.debug).toMatchObject({
    activeSessionCount: 0, liveTrackCount: 0, recorderListenerCount: 0,
    activeTimeoutCount: 0, activeAnimationFrameCount: 0, bufferedChunkCount: 0
  });
});

test('downloads and decodes a real turntable through the export inspector', async ({ context, page }) => {
  test.setTimeout(60_000);
  await context.addInitScript(() => {
    globalThis.__realTurntablePermissionCalls = [];
    if (!navigator.mediaDevices) return;
    for (const name of ['getUserMedia', 'getDisplayMedia']) {
      try {
        Object.defineProperty(navigator.mediaDevices, name, {
          configurable: true,
          value() {
            globalThis.__realTurntablePermissionCalls.push(name);
            throw new Error(`${name} must not be called by turntable export`);
          }
        });
      } catch {}
    }
  });
  const assertNoRuntimeErrors = observeRuntime(page);
  await page.setViewportSize({ width: 720, height: 640 });
  await openArtifact(page);
  await page.locator('#molecule-viewer').evaluate(element => {
    Object.assign(element.style, {
      width: '64px', height: '48px', minWidth: '64px', minHeight: '48px',
      justifySelf: 'start', alignSelf: 'start'
    });
  });
  await expect.poll(() => page.locator('#molecule-viewer canvas').evaluate(canvas => canvas.width)).toBeLessThanOrEqual(128);
  const emphasis = await page.evaluate(() => {
    const selection = window.molhtml.selectAtom(2);
    const measurement = window.molhtml.addMeasurement('distance', [1, 2], { label: 'Export invariant' });
    const saved = window.molhtml.saveCurrentSelection('Export invariant selection', 'residue');
    window.molhtml.highlightSavedSelection(saved.id);
    return { selection, measurementId: measurement.id, savedSelectionId: saved.id };
  });
  await page.waitForTimeout(750);
  await page.locator('[data-inspector-target="export"]').click();
  await page.locator('#turntable-size').selectOption('current');
  await page.locator('#turntable-duration').selectOption('4');
  const summary = await page.locator('#turntable-summary').textContent();
  const dimensions = summary.match(/([\d,]+) x ([\d,]+) px/);
  expect(dimensions).not.toBeNull();
  const expectedWidth = Number(dimensions[1].replaceAll(',', ''));
  const expectedHeight = Number(dimensions[2].replaceAll(',', ''));
  const downloadPromise = page.waitForEvent('download');
  const acceptance = await page.evaluate(async () => {
    const canvas = document.querySelector('#molecule-viewer canvas');
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 64;
    sampleCanvas.height = 48;
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    const sample = () => {
      context.clearRect(0, 0, 64, 48);
      context.drawImage(canvas, 0, 0, 64, 48);
      return [...context.getImageData(0, 0, 64, 48).data];
    };
    const persistedBefore = JSON.stringify(window.molhtml.document.scene.camera);
    const pixelsBefore = sample();
    const bounds = canvas.getBoundingClientRect();
    const wheel = new WheelEvent('wheel', {
      bubbles: true, cancelable: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2
    });
    Object.defineProperty(wheel, 'wheelDelta', { value: 600 });
    canvas.dispatchEvent(wheel);
    const startX = bounds.left + bounds.width / 2;
    const startY = bounds.top + bounds.height / 2;
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: startX, clientY: startY
    }));
    canvas.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: bounds.right - 2, clientY: bounds.top + bounds.height * 0.7
    }));
    document.body.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, cancelable: true, button: 0, clientX: bounds.right - 2, clientY: bounds.top + bounds.height * 0.7
    }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    const acceptedPixels = sample();
    const persistedImmediately = JSON.stringify(window.molhtml.document.scene.camera);
    document.querySelector('#turntable-download').click();
    return { persistedBefore, persistedImmediately, pixelsBefore, acceptedPixels };
  });
  expect(acceptance.persistedImmediately).toBe(acceptance.persistedBefore);
  expect(acceptance.acceptedPixels.reduce(
    (total, value, index) => total + Math.abs(value - acceptance.pixelsBefore[index]), 0
  )).toBeGreaterThan(500);
  await expect(page.locator('#turntable-cancel')).toBeFocused();
  await expect(page.locator('#export-options')).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.molhtml.document.scene.camera)))
    .not.toBe(acceptance.persistedBefore);
  await page.waitForTimeout(750);
  const before = await page.evaluate(() => ({
    document: JSON.stringify(window.molhtml.document),
    camera: JSON.stringify(window.molhtml.document.scene.camera),
    selection: JSON.stringify(window.molhtml.getSelection()),
    measurements: JSON.stringify(window.molhtml.getMeasurements()),
    savedSelections: JSON.stringify(window.molhtml.getSavedSelections()),
    dataBlock: document.querySelector('#molhtml-doc').textContent,
    saveStatus: [document.querySelector('#save-status').textContent, document.querySelector('#save-status').dataset.tone],
    activeMeasurement: document.querySelector('.measurement-card.active')?.dataset.measurementId || null,
    activeSavedSelection: document.querySelector('.saved-selection-card.active')?.dataset.savedSelectionId || null,
    permissionCalls: [...globalThis.__realTurntablePermissionCalls],
    canvas: (() => {
      const canvas = document.querySelector('#molecule-viewer canvas');
      return { dimensions: [canvas.width, canvas.height], pixels: canvas.toDataURL('image/png') };
    })()
  }));
  const references = await page.evaluate(async ({ width, height, measurementId, savedSelectionId }) => {
    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed', left: '-100000px', top: '0', width: '64px', height: '64px',
      overflow: 'hidden', pointerEvents: 'none'
    });
    document.body.appendChild(container);
    const referenceRenderer = new window.MoleculeRenderer(container, {}, {
      backgroundAlpha: 1, interactive: false, screenScale: 1, upscale: false
    });
    const snapshot = window.molhtml.document;
    referenceRenderer.setOutputSize(width, height);
    referenceRenderer.setExportOptions({ backgroundAlpha: 1, screenScale: 1, labelScale: 1 });
    const generation = referenceRenderer.setDocument(snapshot, {
      cameraMode: 'snapshot', writeCamera: false,
      presentationState: { activeMeasurementId: measurementId, activeSavedSelectionId: savedSelectionId }
    });
    await referenceRenderer.whenSurfacesReady(generation);
    await new Promise(resolve => requestAnimationFrame(resolve));
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 64;
    sampleCanvas.height = 48;
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    const sampleAt = async angle => {
      referenceRenderer.renderTurntableFrame(generation, snapshot.scene.camera.view, angle, 'vy');
      await new Promise(resolve => requestAnimationFrame(resolve));
      await new Promise(resolve => setTimeout(resolve, 0));
      context.clearRect(0, 0, 64, 48);
      context.drawImage(referenceRenderer.getExportCanvas(generation, width, height), 0, 0, 64, 48);
      return [...context.getImageData(0, 0, 64, 48).data];
    };
    try {
      const samples = {};
      for (const angle of [0, -87, -90, -93, -348, -351, -354, -357, -330, -180, 90]) {
        samples[String(angle)] = await sampleAt(angle);
      }
      return samples;
    } finally {
      referenceRenderer.resetAfterExport(generation);
      container.remove();
    }
  }, {
    width: expectedWidth,
    height: expectedHeight,
    measurementId: emphasis.measurementId,
    savedSelectionId: emphasis.savedSelectionId
  });
  const download = await downloadPromise;
  const path = await download.path();
  const bytes = await readFile(path);
  const suggested = download.suggestedFilename();
  const extension = suggested.toLowerCase().endsWith('.mp4') ? 'mp4' : 'webm';
  expect(suggested).toMatch(/_turntable_\d+x\d+_4s\.(?:mp4|webm)$/i);
  if (extension === 'mp4') expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
  else expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

  const decoded = await page.evaluate(async ({ base64, extension, references, acceptedStart, preMoveStart }) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: extension === 'mp4' ? 'video/mp4' : 'video/webm' });
    const url = URL.createObjectURL(blob);
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.src = url;
      await new Promise((resolve, reject) => {
        video.addEventListener('loadeddata', resolve, { once: true });
        video.addEventListener('error', () => reject(video.error || new Error('decode failed')), { once: true });
      });
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 64;
      sampleCanvas.height = 48;
      const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
      const sample = () => {
        sampleContext.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);
        return [...sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data];
      };
      const startPixels = sample();
      let midpointPixels = startPixels;
      let quarterPixels = startPixels;
      let nearFinalPixels = startPixels;
      const seekAndSample = async time => {
        let decodedFrame = null;
        if (typeof video.requestVideoFrameCallback === 'function') {
          decodedFrame = new Promise(resolve => video.requestVideoFrameCallback(resolve));
        }
        video.currentTime = time;
        await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));
        if (decodedFrame) {
          await Promise.race([decodedFrame, new Promise(resolve => setTimeout(resolve, 500))]);
        } else await new Promise(resolve => requestAnimationFrame(resolve));
        return sample();
      };
      if (Number.isFinite(video.duration) && video.duration > 0.5) {
        quarterPixels = await seekAndSample(video.duration / 4);
        midpointPixels = await seekAndSample(video.duration / 2);
        nearFinalPixels = await seekAndSample(Math.max(0, video.duration - (3 / 30)));
      }
      const pixelDifference = startPixels.reduce(
        (total, value, index) => total + Math.abs(value - midpointPixels[index]), 0
      );
      const meanRgbDifference = (left, right) => left.reduce(
        (total, value, index) => total + (index % 4 === 3 ? 0 : Math.abs(value - right[index])), 0
      ) / (left.length * 0.75);
      const contentRgbDifference = (left, right) => {
        const leftBackground = left.slice(0, 3);
        const rightBackground = right.slice(0, 3);
        let total = 0;
        let channels = 0;
        for (let index = 0; index < left.length; index += 4) {
          const leftContrast = Math.abs(left[index] - leftBackground[0])
            + Math.abs(left[index + 1] - leftBackground[1])
            + Math.abs(left[index + 2] - leftBackground[2]);
          const rightContrast = Math.abs(right[index] - rightBackground[0])
            + Math.abs(right[index + 1] - rightBackground[1])
            + Math.abs(right[index + 2] - rightBackground[2]);
          if (leftContrast <= 24 && rightContrast <= 24) continue;
          total += Math.abs(left[index] - right[index])
            + Math.abs(left[index + 1] - right[index + 1])
            + Math.abs(left[index + 2] - right[index + 2]);
          channels += 3;
        }
        return channels ? total / channels : meanRgbDifference(left, right);
      };
      const referenceDifferences = {
        liveStart: contentRgbDifference(startPixels, acceptedStart),
        preMoveStart: contentRgbDifference(startPixels, preMoveStart),
        liveStartRaw: meanRgbDifference(startPixels, acceptedStart),
        preMoveStartRaw: meanRgbDifference(startPixels, preMoveStart),
        hiddenStart: contentRgbDifference(startPixels, references['0']),
        quarterExpected: Math.min(...[-87, -90, -93].map(angle => contentRgbDifference(quarterPixels, references[String(angle)]))),
        quarterOpposite: contentRgbDifference(quarterPixels, references['90']),
        quarterHalfTurn: contentRgbDifference(quarterPixels, references['-180']),
        nearFinalExpected: Math.min(...[-348, -351, -354].map(angle => contentRgbDifference(nearFinalPixels, references[String(angle)]))),
        nearFinalWrong: Math.min(...[0, -330, -180, 90].map(angle => contentRgbDifference(nearFinalPixels, references[String(angle)])))
      };
      if (video.currentTime !== 0) {
        video.currentTime = 0;
        await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));
      }
      await video.play();
      const playedToEnd = await Promise.race([
        new Promise(resolve => video.addEventListener('ended', () => resolve(true), { once: true })),
        new Promise(resolve => setTimeout(() => resolve(false), 10_000))
      ]);
      return {
        width: video.videoWidth, height: video.videoHeight, duration: video.duration,
        pixelDifference, referenceDifferences, playedToEnd
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, {
    base64: bytes.toString('base64'), extension, references,
    acceptedStart: acceptance.acceptedPixels, preMoveStart: acceptance.pixelsBefore
  });

  expect([decoded.width, decoded.height]).toEqual([expectedWidth, expectedHeight]);
  if (Number.isFinite(decoded.duration)) expect(decoded.duration).toBeGreaterThan(3);
  expect(decoded.pixelDifference).toBeGreaterThan(1_000);
  expect(decoded.referenceDifferences.liveStart, JSON.stringify(decoded.referenceDifferences)).toBeLessThan(180);
  expect(
    decoded.referenceDifferences.liveStartRaw + 1,
    JSON.stringify(decoded.referenceDifferences)
  ).toBeLessThan(decoded.referenceDifferences.preMoveStartRaw);
  expect(decoded.referenceDifferences.hiddenStart).toBeLessThan(180);
  expect(decoded.referenceDifferences.quarterExpected + 2).toBeLessThan(decoded.referenceDifferences.quarterOpposite);
  expect(decoded.referenceDifferences.quarterExpected + 2).toBeLessThan(decoded.referenceDifferences.quarterHalfTurn);
  expect(decoded.referenceDifferences.nearFinalExpected).toBeLessThan(120);
  expect(decoded.referenceDifferences.nearFinalExpected + 2).toBeLessThan(decoded.referenceDifferences.nearFinalWrong);
  expect(decoded.playedToEnd).toBe(true);
  await expect(page.locator('#export-status')).toContainText(`Downloaded ${suggested}`);
  const recordedMimeType = await page.locator('#turntable-summary').getAttribute('data-mime-type');
  expect(recordedMimeType).toMatch(extension === 'mp4' ? /^video\/mp4/ : /^video\/webm/);
  await expect(page.locator('#turntable-summary')).toContainText(extension === 'mp4' ? 'MP4' : 'WebM');
  await expect(page.locator('#turntable-download')).toBeFocused();
  await expect(page.locator('#turntable-cancel')).toBeHidden();
  await expect(page.locator('#export-options')).toHaveAttribute('aria-busy', 'false');
  const after = await page.evaluate(() => ({
    document: JSON.stringify(window.molhtml.document),
    camera: JSON.stringify(window.molhtml.document.scene.camera),
    selection: JSON.stringify(window.molhtml.getSelection()),
    measurements: JSON.stringify(window.molhtml.getMeasurements()),
    savedSelections: JSON.stringify(window.molhtml.getSavedSelections()),
    dataBlock: document.querySelector('#molhtml-doc').textContent,
    saveStatus: [document.querySelector('#save-status').textContent, document.querySelector('#save-status').dataset.tone],
    activeMeasurement: document.querySelector('.measurement-card.active')?.dataset.measurementId || null,
    activeSavedSelection: document.querySelector('.saved-selection-card.active')?.dataset.savedSelectionId || null,
    permissionCalls: [...globalThis.__realTurntablePermissionCalls],
    canvas: (() => {
      const canvas = document.querySelector('#molecule-viewer canvas');
      return { dimensions: [canvas.width, canvas.height], pixels: canvas.toDataURL('image/png') };
    })()
  }));
  expect(after).toEqual(before);
  expect(before.activeMeasurement).toBe(emphasis.measurementId);
  expect(before.activeSavedSelection).toBe(emphasis.savedSelectionId);
  expect(before.permissionCalls).toEqual([]);
  await assertNoRuntimeErrors();
  await closeContext(context);
});

test('keeps Cancel reachable and restores focus after inspector cancellation', async ({ context, page }) => {
  await openArtifact(page);
  await page.locator('[data-inspector-target="export"]').click();
  await page.locator('#turntable-download').click();
  await expect(page.locator('#turntable-cancel')).toBeVisible();
  await expect(page.locator('#turntable-cancel')).toBeFocused();
  await expect(page.locator('#turntable-progress')).toHaveAttribute('aria-label', 'Turntable video recording progress');
  await page.locator('#turntable-cancel').click();
  await expect(page.locator('#export-status')).toContainText(/cancel/i);
  await expect(page.locator('#turntable-download')).toBeEnabled();
  await expect(page.locator('#turntable-download')).toBeFocused();
  await expect(page.locator('#turntable-cancel')).toBeHidden();
  await expect(page.locator('#export-options')).toHaveAttribute('aria-busy', 'false');
  await closeContext(context);
});

test('does not hang or report a runtime failure when navigating during recording', async ({ context, page }) => {
  const assertNoRuntimeErrors = observeRuntime(page);
  await openArtifact(page);
  await page.locator('[data-inspector-target="export"]').click();
  await page.locator('#turntable-download').click();
  await expect(page.locator('#turntable-cancel')).toBeVisible();
  await page.goto('about:blank', { waitUntil: 'load', timeout: 10_000 });
  expect(page.url()).toBe('about:blank');
  await assertNoRuntimeErrors();
  await closeContext(context);
});

test('pins accepted progress across inspector changes and cancels on pagehide or visibility loss', async ({ context, page }) => {
  await openArtifact(page);
  const exportButton = page.locator('[data-inspector-target="export"]');
  await exportButton.click();
  const acceptedSummary = await page.locator('#turntable-summary').textContent();
  const acceptedDimensions = acceptedSummary.match(/^[\d,]+ x [\d,]+ px/)?.[0];
  expect(acceptedDimensions).toBeTruthy();
  await page.locator('#turntable-download').click();
  await expect(page.locator('#turntable-cancel')).toBeVisible();
  await page.locator('#close-inspector').click();
  await expect(page.locator('#inspector')).toBeHidden();
  await page.locator('#molecule-viewer').evaluate(element => {
    element.style.width = '300px';
    element.style.height = '200px';
  });
  await page.waitForTimeout(250);
  await exportButton.click();
  await expect(page.locator('#turntable-cancel')).toBeVisible();
  await expect(page.locator('#export-options')).toHaveAttribute('aria-busy', 'true');
  const retainedValue = await page.locator('#turntable-progress').getAttribute('value');
  expect(Number(retainedValue)).toBeGreaterThanOrEqual(0);
  await expect(page.locator('#turntable-summary')).toContainText(acceptedDimensions);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.locator('#export-status')).toContainText(/page is closing|cancel/i);
  await expect(page.locator('#turntable-cancel')).toBeHidden();
  await expect(page.locator('#turntable-download')).toBeFocused();

  await page.locator('#turntable-download').click();
  await expect(page.locator('#turntable-cancel')).toBeVisible();
  const visibilityOverrideInstalled = await page.evaluate(() => {
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      return true;
    } catch {
      return false;
    }
  });
  expect(visibilityOverrideInstalled).toBe(true);
  await expect(page.locator('#export-status')).toContainText(/tab became hidden|cancel/i);
  await expect(page.locator('#turntable-cancel')).toBeHidden();
  await expect(page.locator('#turntable-download')).toBeFocused();
  await closeContext(context);
});
