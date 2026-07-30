(function () {
  'use strict';

  const MIN_SIDE = 64;
  const MAX_SIDE = 8192;
  const MAX_PIXELS = 32_000_000;
  const VIDEO_MAX_SIDE = 3840;
  const VIDEO_MAX_PIXELS = 8_294_400;
  const DEFAULT_TIMEOUT_MS = 30_000;
  const DEFAULT_RECORDER_START_TIMEOUT_MS = 5_000;
  const DEFAULT_RECORDER_STOP_TIMEOUT_MS = 5_000;
  const DEFAULT_RECORDER_DISPOSE_TIMEOUT_MS = 2_000;
  const VIDEO_MIME_CANDIDATES = Object.freeze([
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/mp4',
    'video/webm'
  ]);
  const VIDEO_EXTENSIONS = Object.freeze({ 'video/mp4': 'mp4', 'video/webm': 'webm' });

  class MolhtmlExportError extends Error {
    constructor(message, code = 'export-failed', options) {
      super(message, options);
      this.name = new.target.name;
      this.code = code;
    }
  }

  class ExportBusyError extends MolhtmlExportError {
    constructor(message = 'Another export is already in progress.') {
      super(message, 'export-busy');
    }
  }

  class ExportDimensionError extends MolhtmlExportError {
    constructor(message) { super(message, 'export-dimensions'); }
  }

  class ExportRenderError extends MolhtmlExportError {
    constructor(message, options) { super(message, 'export-render', options); }
  }

  class ExportTimeoutError extends MolhtmlExportError {
    constructor(message = 'The molecular surface did not finish before the export timeout.') {
      super(message, 'export-timeout');
    }
  }

  class ExportClipboardError extends MolhtmlExportError {
    constructor(message, options) { super(message, 'export-clipboard', options); }
  }

  class ExportDownloadError extends MolhtmlExportError {
    constructor(message, options) { super(message, 'export-download', options); }
  }

  class ExportVideoUnsupportedError extends MolhtmlExportError {
    constructor(message, options) { super(message, 'export-video-unsupported', options); }
  }

  class ExportVideoEncodeError extends MolhtmlExportError {
    constructor(message, options) { super(message, 'export-video-encode', options); }
  }

  class ExportCancelledError extends MolhtmlExportError {
    constructor(message = 'The export was cancelled.', options) { super(message, 'export-cancelled', options); }
  }

  class ExportService {
    constructor(getSource, {
      timeoutMs = DEFAULT_TIMEOUT_MS,
      recorderStartTimeoutMs = DEFAULT_RECORDER_START_TIMEOUT_MS,
      recorderStopTimeoutMs = DEFAULT_RECORDER_STOP_TIMEOUT_MS,
      recorderDisposeTimeoutMs = DEFAULT_RECORDER_DISPOSE_TIMEOUT_MS,
      mediaRecorderClass = null,
      now = null
    } = {}) {
      if (typeof getSource !== 'function') throw new TypeError('ExportService requires a source snapshot function.');
      this.getSource = getSource;
      this.timeoutMs = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
      this.recorderStartTimeoutMs = positiveInteger(recorderStartTimeoutMs, DEFAULT_RECORDER_START_TIMEOUT_MS);
      this.recorderStopTimeoutMs = positiveInteger(recorderStopTimeoutMs, DEFAULT_RECORDER_STOP_TIMEOUT_MS);
      this.recorderDisposeTimeoutMs = positiveInteger(recorderDisposeTimeoutMs, DEFAULT_RECORDER_DISPOSE_TIMEOUT_MS);
      this.mediaRecorderClass = mediaRecorderClass;
      this.now = typeof now === 'function' ? now : () => performance.now();
      this.busy = false;
      this.jobKind = null;
      this.jobPhase = 'idle';
      this.quarantine = null;
      this.fatalError = null;
      this.renderer = null;
      this.container = null;
      this.activeRecorderSession = null;
      this.objectUrls = new Set();
      this.activeTimeoutCancels = new Set();
      this.activeAnimationFrameCancels = new Set();
      this.mediaDebug = {
        activeSessionCount: 0,
        liveTrackCount: 0,
        recorderListenerCount: 0,
        activeTimeoutCount: 0,
        activeAnimationFrameCount: 0,
        bufferedChunkCount: 0
      };
    }

    renderPNG(options = {}) {
      return this.startJob(options).then(result => result.blob);
    }

    async downloadPNG(options = {}) {
      const result = await this.startJob(options);
      const filename = this.downloadBlob(result.blob, result.metadata, result.options.filename);
      return { status: 'downloaded', filename, ...result.metadata };
    }

    copyImage(options = {}) {
      const unavailable = this.availabilityError();
      if (unavailable) return Promise.reject(unavailable);
      const unsupported = clipboardUnsupportedReason();
      if (unsupported) return Promise.resolve({ status: 'unsupported', reason: unsupported });

      let job;
      let write;
      try {
        job = this.startJob(options);
        const pngPromise = job.then(result => result.blob);
        const item = new window.ClipboardItem({ 'image/png': pngPromise });
        write = Promise.resolve(navigator.clipboard.write([item]));
      } catch (error) {
        if (!job) return Promise.reject(error);
        write = Promise.reject(error);
      }
      return settleClipboard(job, write);
    }

    renderTurntable(options = {}) {
      return this.startTurntableJob(options, false).then(result => result.blob);
    }

    async downloadTurntable(options = {}) {
      const result = await this.startTurntableJob(options, true);
      return { status: 'downloaded', filename: result.filename, ...result.metadata };
    }

    getTurntableCapabilities() {
      return turntableCapabilities(this.mediaRecorderClass || window.MediaRecorder);
    }

    downloadBlob(blob, metadata, requestedFilename) {
      validatePNGBlob(blob);
      const filename = exportFilename(requestedFilename, metadata.title, metadata.width, metadata.height, metadata.transparent);
      return this.initiateDownload(blob, filename, 'The PNG was rendered, but the download could not start');
    }

    initiateDownload(blob, filename, failureMessage) {
      let url = null;
      let link = null;
      try {
        url = URL.createObjectURL(blob);
        this.objectUrls.add(url);
        link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
      } catch (error) {
        const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
        throw new ExportDownloadError(`${failureMessage}${detail}`, { cause: error });
      } finally {
        try { link?.remove(); } catch {}
        if (url) {
          const release = () => {
            try { URL.revokeObjectURL(url); } catch {}
            this.objectUrls.delete(url);
          };
          try { setTimeout(release, 0); } catch { release(); }
        }
      }
      return filename;
    }

    startJob(options) {
      const unavailable = this.availabilityError();
      if (unavailable) return Promise.reject(unavailable);

      let accepted;
      try {
        accepted = captureAcceptedJob(this.getSource(), options);
      } catch (error) {
        return Promise.reject(stableExportError(error));
      }
      this.beginActivity('image', 'preparing');
      return this.runJob(accepted).finally(() => this.endActivity());
    }

    async startTurntableJob(options, download) {
      const unavailable = this.availabilityError();
      if (unavailable) throw unavailable;
      const capabilities = this.getTurntableCapabilities();
      if (!capabilities.supported) throw new ExportVideoUnsupportedError(capabilities.reason);

      let job;
      let cancellation;
      try {
        job = captureAcceptedTurntableJob(this.getSource(), options);
        cancellation = createJobCancellationScope(job.signal, error => {
          this.activeRecorderSession?.interrupt(error);
        });
      } catch (error) {
        throw stableExportError(error);
      }

      this.beginActivity('video', 'preparing');
      emitProgress(job.onProgress, {
        phase: 'preparing', completedFrames: 0, totalFrames: job.options.frameCount,
        percent: 0, mimeType: capabilities.preferredMimeType || ''
      });
      try {
        const result = await this.runRendererJob(
          { ...job, signal: cancellation.signal },
          context => this.produceTurntable(context)
        );
        let filename = null;
        if (download) {
          filename = turntableFilename(
            result.options.filename, result.metadata.title, result.metadata.width,
            result.metadata.height, result.metadata.requestedDurationSeconds, result.metadata.mimeType
          );
          this.initiateDownload(
            result.blob, filename,
            'The turntable video was recorded, but the download could not start'
          );
        }
        emitProgress(job.onProgress, {
          phase: 'complete', completedFrames: result.metadata.submittedFrameCount,
          totalFrames: result.options.frameCount, percent: 100, mimeType: result.metadata.mimeType
        });
        return { ...result, filename };
      } finally {
        cancellation.dispose();
        this.endActivity();
      }
    }

    beginActivity(kind, phase) {
      this.busy = true;
      this.jobKind = kind;
      this.jobPhase = phase;
    }

    endActivity() {
      this.busy = false;
      this.jobKind = null;
      this.jobPhase = 'idle';
    }

    availabilityError() {
      if (this.fatalError) return this.fatalError;
      if (this.busy) return new ExportBusyError();
      if (this.quarantine) {
        return new ExportBusyError(
          'The previous interrupted surface is still finishing. Exporting will resume when it settles or after reload.'
        );
      }
      return null;
    }

    runJob(job) {
      return this.runRendererJob(job, async ({ renderer, generation }) => {
        const blob = await renderer.capturePNG(generation, {
          width: job.options.width,
          height: job.options.height,
          backgroundAlpha: job.options.transparent ? 0 : 1
        });
        validatePNGBlob(blob);
        return {
          blob,
          options: job.options,
          metadata: {
            width: job.options.width,
            height: job.options.height,
            bytes: blob.size,
            transparent: job.options.transparent,
            title: job.title
          }
        };
      });
    }

    async runRendererJob(job, produce) {
      let renderer = null;
      let generation = null;
      let settlement = null;
      let surfacesSettled = false;
      let deferredReset = false;
      let result = null;
      let failure = null;
      try {
        throwIfAborted(job.signal);
        renderer = this.ensureRenderer();
        validateHardwareLimits(job, renderer.getSizingInfo());
        renderer.setOutputSize(job.options.width, job.options.height);
        const outputSizing = renderer.getSizingInfo();
        const outputPixelRatio = positiveNumber(outputSizing.devicePixelRatio, 1);
        renderer.setExportOptions({
          backgroundAlpha: job.options.transparent ? 0 : 1,
          screenScale: job.screenScale,
          labelScale: job.screenScale * job.visiblePixelRatio / outputPixelRatio
        });
        generation = renderer.setDocument(job.document, {
          cameraMode: 'snapshot',
          writeCamera: false,
          presentationState: job.presentationState
        });
        settlement = Promise.resolve(renderer.whenSurfacesReady(generation)).then(
          value => { surfacesSettled = true; return value; },
          error => { surfacesSettled = true; throw error; }
        );
        await this.waitForSurfaceSettlement(settlement, job.signal);
        await this.nextAnimationFrame(job.signal);
        throwIfAborted(job.signal);
        result = await produce({ renderer, generation, job });
        throwIfAborted(job.signal);
        if (renderer.getSizingInfo().contextLost) throw rendererContextLostError();
      } catch (error) {
        const interruptedGeneration = renderer && generation == null && Number.isInteger(error?.molhtmlRenderGeneration);
        if (interruptedGeneration) {
          generation = error.molhtmlRenderGeneration;
          settlement = Promise.resolve(renderer.whenSurfacesReady(generation)).then(
            value => { surfacesSettled = true; return value; },
            settlementError => { surfacesSettled = true; throw settlementError; }
          );
        }
        const interruptedSurface = generation != null && settlement && !surfacesSettled
          && (error instanceof ExportTimeoutError || error instanceof ExportCancelledError || interruptedGeneration);
        if (interruptedSurface || interruptedGeneration) {
          deferredReset = true;
          this.beginDeferredReset(renderer, generation, settlement);
        }
        if (error?.code === 'renderer-context-lost') {
          failure = this.latchFatalRenderer(error, 'the export WebGL context was lost');
        } else {
          failure = stableExportError(error);
        }
        if (renderer && generation == null && !interruptedGeneration
          && !(failure instanceof ExportDimensionError)
          && !(failure instanceof ExportCancelledError)) {
          this.latchFatalRenderer(error, 'rendering failed before a safe generation could be established');
        }
      }
      if (renderer && generation != null && !deferredReset) {
        const cleanupFailure = this.resetRenderer(renderer, generation);
        if (!failure && cleanupFailure) failure = cleanupFailure;
      }
      if (failure) throw failure;
      return result;
    }

    async produceTurntable({ renderer, generation, job }) {
      const canvas = renderer.getExportCanvas(generation, job.options.width, job.options.height);
      const contextLoss = deferred();
      let contextLost = false;
      const onContextLost = event => {
        event?.preventDefault?.();
        if (contextLost) return;
        contextLost = true;
        contextLoss.resolve(rendererContextLostError());
      };
      canvas.addEventListener('webglcontextlost', onContextLost);
      try {
        const candidates = recorderCandidates(this.mediaRecorderClass || window.MediaRecorder);
        let lastUnsupported = null;
        for (const candidate of [...candidates, { mimeType: '', reportedSupported: null }]) {
          if (candidate.reportedSupported === false) continue;
          let session = null;
          try {
            session = createRecorderSession(this, canvas, job.options, candidate.mimeType);
            this.activeRecorderSession = session;
            const initialView = structuredClone(job.document.scene.camera.view);
            let firstFrameSubmittedAt = this.now();
            await session.start(job.signal, contextLoss.promise, () => {
              session.requestFrame();
              renderer.renderTurntableFrame(
                generation, initialView, turntableAngle(0, job.options.frameCount, job.options.direction), 'vy'
              );
              firstFrameSubmittedAt = this.now();
            });
            await session.raceTerminal(this.nextAnimationFrame(job.signal), job.signal, contextLoss.promise);
            await session.raceTerminal(this.nextTask(job.signal), job.signal, contextLoss.promise);
            this.jobPhase = 'recording';
            emitProgress(job.onProgress, {
              phase: 'recording', completedFrames: 1, totalFrames: job.options.frameCount,
              percent: Math.round(100 / job.options.frameCount), mimeType: session.currentMimeType()
            });
            const recording = await this.runTurntableFrames(
              session, renderer, generation, job, contextLoss.promise, initialView, firstFrameSubmittedAt
            );
            renderer.getExportCanvas(generation, job.options.width, job.options.height);
            return {
              blob: recording.blob,
              options: job.options,
              metadata: {
                width: job.options.width,
                height: job.options.height,
                requestedDurationSeconds: job.options.durationSeconds,
                requestedFps: job.options.fps,
                submittedFrameCount: recording.submittedFrameCount,
                recordingElapsedSeconds: recording.recordingElapsedSeconds,
                bytes: recording.blob.size,
                mimeType: recording.mimeType,
                recorderTargetVideoBitsPerSecond: recording.recorderTargetVideoBitsPerSecond,
                requestedVideoBitsPerSecond: job.options.videoBitsPerSecond,
                title: job.title
              }
            };
          } catch (error) {
            const mapped = mapVideoError(error, job.signal);
            const canRetry = candidate.mimeType && !session?.hasStarted
              && (error?.name === 'NotSupportedError' || error?.molhtmlExplicitMimeRejected === true);
            if (canRetry) {
              lastUnsupported = mapped;
              continue;
            }
            throw mapped;
          } finally {
            if (session) {
              await session.dispose();
              if (this.activeRecorderSession === session) this.activeRecorderSession = null;
            }
          }
        }
        throw lastUnsupported || new ExportVideoUnsupportedError(
          'This browser could not start a supported MP4 or WebM recorder.'
        );
      } finally {
        canvas.removeEventListener('webglcontextlost', onContextLost);
      }
    }

    async runTurntableFrames(
      session, renderer, generation, job, contextLossPromise, initialView, firstFrameSubmittedAt
    ) {
      const { fps, durationSeconds, frameCount, direction } = job.options;
      const frameInterval = 1000 / fps;
      const startedAt = session.startedAt || firstFrameSubmittedAt;
      let lastFrameSubmittedAt = firstFrameSubmittedAt;
      let submittedFrameCount = 1;
      for (let index = 1; index < frameCount; index += 1) {
        await session.raceTerminal(
          this.waitUntil(startedAt + index * frameInterval, job.signal), job.signal, contextLossPromise
        );
        session.requestFrame();
        renderer.renderTurntableFrame(
          generation, initialView, turntableAngle(index, frameCount, direction), 'vy'
        );
        submittedFrameCount += 1;
        lastFrameSubmittedAt = this.now();
        await session.raceTerminal(this.nextAnimationFrame(job.signal), job.signal, contextLossPromise);
        await session.raceTerminal(this.nextTask(job.signal), job.signal, contextLossPromise);
        emitProgress(job.onProgress, {
          phase: 'recording', completedFrames: submittedFrameCount, totalFrames: frameCount,
          percent: Math.round(submittedFrameCount * 100 / frameCount), mimeType: session.currentMimeType()
        });
      }
      const requestedEnd = startedAt + durationSeconds * 1000;
      const finalFrameEnd = lastFrameSubmittedAt + frameInterval;
      await session.raceTerminal(
        this.waitUntil(Math.max(requestedEnd, finalFrameEnd), job.signal), job.signal, contextLossPromise
      );
      throwIfAborted(job.signal);
      this.jobPhase = 'finalizing';
      emitProgress(job.onProgress, {
        phase: 'finalizing', completedFrames: submittedFrameCount, totalFrames: frameCount,
        percent: 100, mimeType: session.currentMimeType()
      });
      const recording = await session.stop(job.signal, contextLossPromise);
      return { ...recording, submittedFrameCount };
    }

    ensureRenderer() {
      if (this.renderer) return this.renderer;
      if (this.fatalError) throw this.fatalError;
      const container = document.createElement('div');
      container.dataset.molhtmlExportViewer = '';
      container.setAttribute('aria-hidden', 'true');
      container.inert = true;
      Object.assign(container.style, {
        position: 'fixed', left: '-100000px', top: '0', width: '64px', height: '64px',
        overflow: 'hidden', pointerEvents: 'none', contain: 'strict'
      });
      document.body.appendChild(container);
      let renderer;
      try {
        renderer = new window.MoleculeRenderer(container, {}, {
          backgroundAlpha: 1, interactive: false, screenScale: 1, upscale: false
        });
      } catch (error) {
        try { container.remove(); } catch {}
        throw this.latchFatalRenderer(error, 'the hidden renderer could not be initialized');
      }
      this.container = container;
      this.renderer = renderer;
      return renderer;
    }

    waitForSurfaceSettlement(settlement, signal) {
      return this.withTrackedTimeout(
        raceAbort(settlement, signal), this.timeoutMs, () => new ExportTimeoutError()
      );
    }

    waitUntil(deadline, signal) {
      return this.trackedDelay(Math.max(0, deadline - this.now()), signal);
    }

    nextTask(signal) {
      return this.trackedDelay(0, signal);
    }

    trackedDelay(milliseconds, signal) {
      let timer = null;
      let active = true;
      let settle = () => {};
      this.mediaDebug.activeTimeoutCount += 1;
      const cancel = () => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        this.mediaDebug.activeTimeoutCount -= 1;
        this.activeTimeoutCancels.delete(cancel);
        settle();
      };
      this.activeTimeoutCancels.add(cancel);
      const promise = new Promise(resolve => {
        settle = resolve;
        timer = setTimeout(() => {
          if (!active) return;
          active = false;
          this.mediaDebug.activeTimeoutCount -= 1;
          this.activeTimeoutCancels.delete(cancel);
          resolve();
        }, Math.max(0, milliseconds));
      });
      return raceAbort(promise, signal).finally(cancel);
    }

    nextAnimationFrame(signal) {
      let handle = null;
      let active = true;
      let settle = () => {};
      this.mediaDebug.activeAnimationFrameCount += 1;
      const cancel = () => {
        if (!active) return;
        active = false;
        cancelAnimationFrame(handle);
        this.mediaDebug.activeAnimationFrameCount -= 1;
        this.activeAnimationFrameCancels.delete(cancel);
        settle();
      };
      this.activeAnimationFrameCancels.add(cancel);
      const promise = new Promise(resolve => {
        settle = resolve;
        handle = requestAnimationFrame(() => {
          if (!active) return;
          active = false;
          this.mediaDebug.activeAnimationFrameCount -= 1;
          this.activeAnimationFrameCancels.delete(cancel);
          resolve();
        });
      });
      return raceAbort(promise, signal).finally(cancel);
    }

    withTrackedTimeout(promise, milliseconds, errorFactory) {
      let timer = null;
      let active = true;
      let settleTimeout = () => {};
      this.mediaDebug.activeTimeoutCount += 1;
      const cancel = () => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        this.mediaDebug.activeTimeoutCount -= 1;
        this.activeTimeoutCancels.delete(cancel);
        settleTimeout();
      };
      this.activeTimeoutCancels.add(cancel);
      const timeout = new Promise((resolve, reject) => {
        settleTimeout = resolve;
        timer = setTimeout(() => {
          if (!active) return;
          active = false;
          this.mediaDebug.activeTimeoutCount -= 1;
          this.activeTimeoutCancels.delete(cancel);
          reject(errorFactory());
        }, milliseconds);
      });
      return Promise.race([promise, timeout]).finally(cancel);
    }

    cancelScheduledWork() {
      for (const cancel of [...this.activeAnimationFrameCancels]) cancel();
      for (const cancel of [...this.activeTimeoutCancels]) cancel();
    }

    beginDeferredReset(renderer, generation, settlement) {
      const cleanup = Promise.resolve(settlement).catch(() => {}).then(() => {
        const failure = this.resetRenderer(renderer, generation);
        if (failure) throw failure;
      });
      let tracked;
      tracked = cleanup.finally(() => {
        if (this.quarantine === tracked) this.quarantine = null;
      });
      this.quarantine = tracked;
      tracked.catch(() => {});
    }

    resetRenderer(renderer, generation) {
      try {
        if (renderer.resetAfterExport(generation) !== true) {
          throw new Error('The hidden renderer rejected its export reset.');
        }
        return null;
      } catch (error) {
        return this.latchFatalRenderer(error, 'the hidden renderer could not be reset safely');
      }
    }

    latchFatalRenderer(error, context) {
      if (!this.fatalError) {
        this.fatalError = new ExportRenderError(
          `Molecular export is unavailable because ${context}. Reload this file before trying again.`,
          { cause: error }
        );
      }
      return this.fatalError;
    }

    canCopyImage() {
      return clipboardUnsupportedReason() === '';
    }

    debugState() {
      return {
        busy: this.busy,
        quarantined: Boolean(this.quarantine),
        fatal: Boolean(this.fatalError),
        viewerCount: this.container?.isConnected ? 1 : 0,
        objectUrlCount: this.objectUrls.size,
        jobKind: this.jobKind,
        jobPhase: this.jobPhase,
        ...this.mediaDebug,
        resources: this.renderer?.resourceCounts() || { models: 0, shapes: 0, labels: 0, surfaces: 0 }
      };
    }
  }

  class RecorderSession {
    constructor(service, stream, tracks, track, recorder, requestedMimeType, requestedBitrate) {
      this.service = service;
      this.stream = stream;
      this.tracks = tracks;
      this.track = track;
      this.recorder = recorder;
      this.requestedMimeType = normalizeMimeType(requestedMimeType);
      this.requestedBitrate = requestedBitrate;
      this.state = 'constructed';
      this.hasStarted = false;
      this.hasSubmittedFrame = false;
      this.stopRequested = false;
      this.recorderStopCalled = false;
      this.disposed = false;
      this.disposePromise = null;
      this.tracksStopped = false;
      this.chunks = [];
      this.startMimeType = '';
      this.startedAt = 0;
      this.stopRequestedAt = 0;
      this.terminalCause = null;
      this.startEvent = deferred();
      this.stopEvent = deferred();
      this.terminalEvent = deferred();
      this.listeners = [];
      service.mediaDebug.activeSessionCount += 1;
      try {
        this.attach('start', () => {
          if (this.disposed || this.hasStarted) return;
          this.hasStarted = true;
          this.state = 'recording';
          this.startMimeType = normalizeMimeType(this.recorder.mimeType);
          this.startedAt = this.service.now();
          this.startEvent.resolve();
        });
        this.attach('dataavailable', event => {
          if (this.disposed || !(event.data instanceof Blob) || event.data.size <= 0) return;
          this.chunks.push(event.data);
          this.service.mediaDebug.bufferedChunkCount += 1;
        });
        this.attach('error', event => {
          const detail = event?.error?.message || event?.message || 'The video recorder reported an error.';
          const cause = event?.error;
          this.latchTerminal(!this.hasStarted && cause?.name === 'NotSupportedError'
            ? cause
            : new ExportVideoEncodeError(detail, { cause }));
        });
        this.attach('stop', () => {
          if (this.disposed) return;
          this.state = 'stopped';
          this.stopEvent.resolve();
          if (!this.stopRequested) {
            this.latchTerminal(new ExportVideoEncodeError('The video recorder stopped before recording completed.'));
          }
        });
      } catch (error) {
        for (const [type, listener] of this.listeners) {
          try { this.recorder.removeEventListener(type, listener); } catch {}
          this.service.mediaDebug.recorderListenerCount -= 1;
        }
        this.listeners.length = 0;
        service.mediaDebug.activeSessionCount -= 1;
        throw error;
      }
    }

    attach(type, listener) {
      this.recorder.addEventListener(type, listener);
      this.listeners.push([type, listener]);
      this.service.mediaDebug.recorderListenerCount += 1;
    }

    latchTerminal(error) {
      if (this.terminalCause) return this.terminalCause;
      this.terminalCause = error;
      this.state = 'failed';
      this.terminalEvent.resolve(error);
      return error;
    }

    interrupt(error) {
      if (this.disposed) return;
      this.latchTerminal(error instanceof MolhtmlExportError ? error : cancellationError(error));
      this.stopRequested = true;
      if (this.recorder.state !== 'inactive') this.requestRecorderStop();
    }

    currentMimeType() {
      return this.startMimeType || normalizeMimeType(this.recorder.mimeType) || '';
    }

    async start(signal, contextLossPromise, submitInitialFrame) {
      throwIfAborted(signal);
      this.state = 'starting';
      try {
        this.recorder.start(1000);
      } catch (error) {
        this.state = 'failed';
        throw error;
      }
      // Chromium does not emit `start` for a manual canvas stream until its first
      // requested paint. A pre-start NotSupportedError is still safe to retry.
      if (typeof submitInitialFrame === 'function') submitInitialFrame();
      await this.waitForEvent(
        this.startEvent.promise, this.service.recorderStartTimeoutMs,
        () => new ExportVideoEncodeError('The video recorder did not start in time.'),
        signal, contextLossPromise
      );
      if (!this.hasStarted) throw new ExportVideoEncodeError('The video recorder did not enter the recording state.');
    }

    requestFrame() {
      if (!['starting', 'recording'].includes(this.state) || this.disposed || this.recorder.state !== 'recording') {
        throw new ExportVideoEncodeError('The video recorder is not accepting frames.');
      }
      if (this.track.readyState !== 'live') {
        throw new ExportVideoEncodeError('The canvas capture track ended during recording.');
      }
      try {
        this.track.requestFrame();
        this.hasSubmittedFrame = true;
      } catch (error) {
        throw new ExportVideoEncodeError('The browser could not submit a turntable frame.', { cause: error });
      }
    }

    async stop(signal, contextLossPromise) {
      throwIfAborted(signal);
      this.stopRequested = true;
      this.stopRequestedAt = this.service.now();
      this.state = 'stopping';
      this.requestRecorderStop();
      await this.waitForEvent(
        this.stopEvent.promise, this.service.recorderStopTimeoutMs,
        () => new ExportVideoEncodeError('The video recorder did not finish in time.'),
        signal, contextLossPromise
      );
      throwIfAborted(signal);
      if (this.terminalCause) throw this.terminalCause;
      const resolved = resolveRecording(this.chunks, this.startMimeType, this.requestedMimeType);
      const target = positiveInteger(this.recorder.videoBitsPerSecond, this.requestedBitrate);
      return {
        ...resolved,
        recordingElapsedSeconds: Math.max(0, this.stopRequestedAt - this.startedAt) / 1000,
        recorderTargetVideoBitsPerSecond: target
      };
    }

    requestRecorderStop() {
      if (this.recorderStopCalled) return;
      this.recorderStopCalled = true;
      if (this.recorder.state === 'inactive') {
        this.stopEvent.resolve();
        return;
      }
      try {
        this.recorder.stop();
      } catch (error) {
        this.latchTerminal(new ExportVideoEncodeError('The video recorder could not be stopped.', { cause: error }));
        this.stopEvent.resolve();
      }
    }

    async waitForEvent(promise, milliseconds, errorFactory, signal, contextLossPromise) {
      return this.raceTerminal(
        this.service.withTrackedTimeout(promise, milliseconds, errorFactory),
        signal, contextLossPromise
      );
    }

    async raceTerminal(work, signal, contextLossPromise) {
      const terminal = this.terminalEvent.promise.then(error => ({ type: 'error', error }));
      const context = contextLossPromise
        ? contextLossPromise.then(error => ({ type: 'error', error }))
        : new Promise(() => {});
      const operation = Promise.resolve(work).then(value => ({ type: 'value', value }));
      const result = await raceAbort(Promise.race([operation, terminal, context]), signal);
      if (result.type === 'error') throw result.error;
      return result.value;
    }

    dispose(primaryCause = null) {
      if (primaryCause && !this.disposed) this.latchTerminal(primaryCause);
      if (!this.disposePromise) this.disposePromise = this.performDispose();
      return this.disposePromise;
    }

    async performDispose() {
      if (this.disposed) return;
      if (this.recorder.state !== 'inactive' && !this.recorderStopCalled) {
        this.stopRequested = true;
        this.requestRecorderStop();
      }
      if (this.recorderStopCalled && this.recorder.state !== 'inactive') {
        try {
          await this.service.withTrackedTimeout(
            this.stopEvent.promise, this.service.recorderDisposeTimeoutMs,
            () => new ExportVideoEncodeError('Recorder cleanup timed out.')
          );
        } catch {}
      }
      this.disposed = true;
      this.state = 'disposed';
      for (const [type, listener] of this.listeners) {
        try { this.recorder.removeEventListener(type, listener); } catch {}
        this.service.mediaDebug.recorderListenerCount -= 1;
      }
      this.listeners.length = 0;
      stopTrackedTracks(this.service, this.tracks, this);
      this.service.cancelScheduledWork();
      this.service.mediaDebug.bufferedChunkCount -= this.chunks.length;
      this.chunks.length = 0;
      this.service.mediaDebug.activeSessionCount -= 1;
      this.stream = null;
      this.track = null;
      this.recorder = null;
    }
  }

  function createRecorderSession(service, canvas, options, requestedMimeType) {
    if (typeof canvas.captureStream !== 'function') {
      throw new ExportVideoUnsupportedError('This browser cannot capture video from the export canvas.');
    }
    let stream;
    try {
      stream = canvas.captureStream(0);
    } catch (error) {
      if (error?.name === 'SecurityError') {
        throw new ExportVideoUnsupportedError('Browser security policy blocked canvas video capture.', { cause: error });
      }
      throw new ExportVideoUnsupportedError('This browser could not create a canvas video stream.', { cause: error });
    }
    const tracks = Array.from(stream?.getTracks?.() || []);
    const videoTracks = Array.from(stream?.getVideoTracks?.() || []);
    service.mediaDebug.liveTrackCount += tracks.length;
    const probe = { tracksStopped: false };
    if (videoTracks.length !== 1 || tracks.length !== 1 || videoTracks[0].readyState !== 'live'
      || typeof videoTracks[0].requestFrame !== 'function') {
      stopTrackedTracks(service, tracks, probe);
      throw new ExportVideoUnsupportedError(
        'This browser does not support manual turntable frame capture from a canvas.'
      );
    }
    const Recorder = service.mediaRecorderClass || window.MediaRecorder;
    const recorderOptions = { videoBitsPerSecond: options.videoBitsPerSecond };
    if (requestedMimeType) recorderOptions.mimeType = requestedMimeType;
    let recorder;
    try {
      recorder = new Recorder(stream, recorderOptions);
    } catch (error) {
      stopTrackedTracks(service, tracks, probe);
      if (requestedMimeType && error?.name === 'NotSupportedError') {
        error.molhtmlExplicitMimeRejected = true;
      }
      throw error;
    }
    try {
      return new RecorderSession(
        service, stream, tracks, videoTracks[0], recorder,
        requestedMimeType, options.videoBitsPerSecond
      );
    } catch (error) {
      stopTrackedTracks(service, tracks, probe);
      throw error;
    }
  }

  function stopTrackedTracks(service, tracks, owner) {
    if (owner.tracksStopped) return;
    owner.tracksStopped = true;
    for (const track of tracks) {
      try { track.stop(); } catch {}
      service.mediaDebug.liveTrackCount -= 1;
    }
  }

  function captureAcceptedJob(source, options) {
    return captureAcceptedSource(source, normalizeOptions, options, 'image');
  }

  function captureAcceptedTurntableJob(source, options) {
    const candidate = options && typeof options === 'object' ? options : {};
    const job = captureAcceptedSource(source, normalizeTurntableOptions, candidate, 'video');
    job.signal = candidate.signal == null ? null : validateAbortSignal(candidate.signal);
    job.onProgress = typeof candidate.onProgress === 'function' ? candidate.onProgress : null;
    return job;
  }

  function captureAcceptedSource(source, normalizer, options, kind) {
    if (!source?.document || !source?.camera) throw new ExportRenderError('The live molecular scene is unavailable.');
    const visibleWidth = positiveInteger(source.visibleSize?.width, 0);
    const visibleHeight = positiveInteger(source.visibleSize?.height, 0);
    if (!visibleWidth || !visibleHeight) throw new ExportDimensionError('The visible viewer has no exportable pixel dimensions.');
    const normalized = normalizer(options, visibleWidth, visibleHeight);
    const documentCopy = structuredClone(source.document);
    documentCopy.scene.camera = structuredClone(source.camera);
    const measurementIds = new Set((documentCopy.scene.measurements || []).map(record => record.id));
    const savedSelectionIds = new Set((documentCopy.scene.savedSelections || []).map(record => record.id));
    return {
      kind,
      document: documentCopy,
      options: normalized,
      title: String(source.document.title || source.document.structure?.name || 'molecule'),
      screenScale: Math.min(normalized.width / visibleWidth, normalized.height / visibleHeight),
      visiblePixelRatio: positiveNumber(source.visibleSize?.devicePixelRatio, 1),
      presentationState: {
        activeMeasurementId: measurementIds.has(source.activeMeasurementId) ? source.activeMeasurementId : null,
        activeSavedSelectionId: savedSelectionIds.has(source.activeSavedSelectionId) ? source.activeSavedSelectionId : null
      }
    };
  }

  function normalizeOptions(options, visibleWidth, visibleHeight) {
    const candidate = options && typeof options === 'object' ? options : {};
    let width = optionalDimension(candidate.width, 'width');
    let height = optionalDimension(candidate.height, 'height');
    const aspect = visibleWidth / visibleHeight;
    if (width == null && height == null) {
      width = visibleWidth;
      height = visibleHeight;
    } else if (width == null) width = Math.round(height * aspect);
    else if (height == null) height = Math.round(width / aspect);
    validateProjectDimensions(width, height);
    return {
      width,
      height,
      transparent: candidate.transparent === true,
      filename: candidate.filename == null ? '' : String(candidate.filename)
    };
  }

  function normalizeTurntableOptions(options, visibleWidth, visibleHeight) {
    const candidate = options && typeof options === 'object' ? options : {};
    const explicitWidth = optionalDimension(candidate.width, 'width');
    const explicitHeight = optionalDimension(candidate.height, 'height');
    if (explicitWidth != null && explicitWidth % 2) {
      throw new ExportDimensionError('Turntable video width must be an even whole number of pixels.');
    }
    if (explicitHeight != null && explicitHeight % 2) {
      throw new ExportDimensionError('Turntable video height must be an even whole number of pixels.');
    }
    let width = explicitWidth;
    let height = explicitHeight;
    const aspect = visibleWidth / visibleHeight;
    if (width == null && height == null) {
      width = evenFloor(visibleWidth);
      height = evenFloor(visibleHeight);
    } else if (width == null) {
      width = nearestEven(height * aspect);
    } else if (height == null) {
      height = nearestEven(width / aspect);
    }
    validateVideoDimensions(width, height);
    const durationSeconds = candidate.durationSeconds == null ? 6 : Number(candidate.durationSeconds);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 2 || durationSeconds > 20) {
      throw new ExportDimensionError('Turntable duration must be a whole number from 2 through 20 seconds.');
    }
    const fps = candidate.fps == null ? 30 : Number(candidate.fps);
    if (![24, 30].includes(fps)) throw new ExportDimensionError('Turntable frame rate must be 24 or 30 fps.');
    const direction = candidate.direction == null ? 'clockwise' : String(candidate.direction);
    if (!['clockwise', 'counterclockwise'].includes(direction)) {
      throw new ExportDimensionError('Turntable direction must be clockwise or counterclockwise.');
    }
    return Object.freeze({
      width,
      height,
      transparent: false,
      durationSeconds,
      fps,
      frameCount: durationSeconds * fps,
      direction,
      filename: candidate.filename == null ? '' : String(candidate.filename),
      videoBitsPerSecond: videoBitrate(width, height, fps)
    });
  }

  function fitVideoDimensions(visibleWidth, visibleHeight, maxWidth, maxHeight) {
    if (visibleWidth && typeof visibleWidth === 'object') {
      const visible = visibleWidth;
      const box = visibleHeight || {};
      return fitVideoDimensions(visible.width, visible.height, box.width, box.height);
    }
    const sourceWidth = positiveNumber(visibleWidth, 0);
    const sourceHeight = positiveNumber(visibleHeight, 0);
    const boxWidth = positiveInteger(maxWidth, 0);
    const boxHeight = positiveInteger(maxHeight, 0);
    if (!sourceWidth || !sourceHeight || !boxWidth || !boxHeight) {
      throw new ExportDimensionError('Turntable video sizing requires positive visible and preset dimensions.');
    }
    const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
    const width = evenFloor(sourceWidth * scale);
    const height = evenFloor(sourceHeight * scale);
    validateVideoDimensions(width, height);
    return { width, height };
  }

  function turntableAngles(frameCountOrOptions, direction = 'clockwise') {
    const frameCount = typeof frameCountOrOptions === 'object'
      ? Number(frameCountOrOptions.durationSeconds) * Number(frameCountOrOptions.fps)
      : Number(frameCountOrOptions);
    const selectedDirection = typeof frameCountOrOptions === 'object'
      ? frameCountOrOptions.direction || direction
      : direction;
    if (!Number.isInteger(frameCount) || frameCount <= 0) throw new TypeError('Frame count must be a positive whole number.');
    if (!['clockwise', 'counterclockwise'].includes(selectedDirection)) throw new TypeError('Unknown turntable direction.');
    return Array.from({ length: frameCount }, (_, index) => turntableAngle(index, frameCount, selectedDirection));
  }

  function turntableAngle(index, frameCount, direction) {
    if (index === 0) return 0;
    const multiplier = direction === 'counterclockwise' ? 1 : -1;
    return multiplier * index * 360 / frameCount;
  }

  function videoBitrate(width, height, fps) {
    const requested = Math.round(Number(width) * Number(height) * Number(fps) * 0.12);
    return Math.min(20_000_000, Math.max(1_000_000, requested));
  }

  function recorderCandidates(Recorder = window.MediaRecorder) {
    return VIDEO_MIME_CANDIDATES.map(mimeType => {
      let reportedSupported = null;
      if (typeof Recorder?.isTypeSupported === 'function') {
        try { reportedSupported = Boolean(Recorder.isTypeSupported(mimeType)); }
        catch { reportedSupported = null; }
      }
      return Object.freeze({ mimeType, reportedSupported });
    });
  }

  function turntableCapabilities(Recorder = window.MediaRecorder) {
    const captureStream = typeof HTMLCanvasElement !== 'undefined'
      && typeof HTMLCanvasElement.prototype.captureStream === 'function';
    const mediaRecorder = typeof Recorder === 'function';
    const manualFrameRequest = typeof window.CanvasCaptureMediaStreamTrack === 'function'
      && typeof window.CanvasCaptureMediaStreamTrack.prototype.requestFrame === 'function';
    const candidates = recorderCandidates(Recorder);
    const preferred = candidates.find(candidate => candidate.reportedSupported === true) || null;
    let reason = '';
    if (!captureStream) reason = 'This browser cannot capture video from a canvas.';
    else if (!mediaRecorder) reason = 'This browser does not provide MediaRecorder video encoding.';
    else if (!manualFrameRequest) reason = 'This browser cannot request deterministic canvas video frames.';
    return Object.freeze({
      supported: !reason,
      reason,
      captureStream,
      mediaRecorder,
      manualFrameRequest,
      preferredMimeType: preferred?.mimeType || null,
      preferredExtension: preferred ? mimeExtension(preferred.mimeType) : null,
      candidates: Object.freeze(candidates)
    });
  }

  function normalizeMimeType(value) {
    const parts = String(value || '').trim().toLowerCase().split(';').map(part => part.trim()).filter(Boolean);
    if (!parts.length) return '';
    return [parts[0], ...parts.slice(1).sort()].join(';');
  }

  function mimeBase(value) {
    return normalizeMimeType(value).split(';')[0] || '';
  }

  function mimeExtension(value) {
    return VIDEO_EXTENSIONS[mimeBase(value)] || null;
  }

  function resolveRecording(chunks, recorderMimeType, requestedMimeType) {
    const nonEmpty = chunks.filter(chunk => chunk instanceof Blob && chunk.size > 0);
    if (!nonEmpty.length) throw new ExportVideoEncodeError('The video recorder produced no media data.');
    const chunkMimes = nonEmpty.map(chunk => normalizeMimeType(chunk.type)).filter(Boolean);
    const chunkBases = new Set(chunkMimes.map(mimeBase));
    if (chunkBases.size > 1) throw new ExportVideoEncodeError('The video recorder produced conflicting media containers.');
    const recorderMime = normalizeMimeType(recorderMimeType);
    const requestedMime = normalizeMimeType(requestedMimeType);
    const chunkMime = chunkMimes[0] || '';
    if (recorderMime && chunkMime && mimeBase(recorderMime) !== mimeBase(chunkMime)) {
      throw new ExportVideoEncodeError('The recorder and recorded chunks disagree about the video container.');
    }
    const finalMimeType = recorderMime || chunkMime || requestedMime;
    if (!mimeExtension(finalMimeType)) {
      throw new ExportVideoEncodeError('The video recorder returned an unrecognized media container.');
    }
    const blob = new Blob(nonEmpty, { type: finalMimeType });
    if (!blob.size || mimeBase(blob.type) !== mimeBase(finalMimeType)) {
      throw new ExportVideoEncodeError('The browser did not produce a valid video file.');
    }
    return { blob, mimeType: finalMimeType };
  }

  function turntableFilename(requested, title, width, height, durationSeconds, mimeType) {
    const extension = mimeExtension(mimeType);
    if (!extension) throw new ExportVideoEncodeError('The video container does not have a safe filename extension.');
    const requestedText = String(requested || '').trim().replace(/(?:\.(?:mp4|webm))+$/i, '');
    const base = safeFilenameStem(requestedText || title);
    const suffix = requestedText ? '' : `_turntable_${width}x${height}_${durationSeconds}s`;
    return `${base}${suffix}.${extension}`;
  }

  function optionalDimension(value, label) {
    if (value == null || value === '') return null;
    const number = Number(value);
    if (!Number.isInteger(number)) throw new ExportDimensionError(`Export ${label} must be a whole number of pixels.`);
    return number;
  }

  function validateProjectDimensions(width, height) {
    if (width < MIN_SIDE || height < MIN_SIDE) {
      throw new ExportDimensionError(`Export dimensions must be at least ${MIN_SIDE} pixels on each side.`);
    }
    if (width > MAX_SIDE || height > MAX_SIDE) {
      throw new ExportDimensionError(`Export dimensions cannot exceed ${MAX_SIDE.toLocaleString()} pixels on either side.`);
    }
    if (width * height > MAX_PIXELS) throw new ExportDimensionError('Export dimensions cannot exceed 32 megapixels.');
  }

  function validateVideoDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width % 2 || height % 2) {
      throw new ExportDimensionError('Turntable video dimensions must be even whole numbers of pixels.');
    }
    if (width < MIN_SIDE || height < MIN_SIDE) {
      throw new ExportDimensionError(`Turntable video dimensions must be at least ${MIN_SIDE} pixels on each side.`);
    }
    if (width > VIDEO_MAX_SIDE || height > VIDEO_MAX_SIDE) {
      throw new ExportDimensionError(`Turntable video dimensions cannot exceed ${VIDEO_MAX_SIDE.toLocaleString()} pixels on either side.`);
    }
    if (width * height > VIDEO_MAX_PIXELS) {
      throw new ExportDimensionError('Turntable video dimensions cannot exceed 8,294,400 pixels.');
    }
  }

  function validateHardwareLimits(job, sizing) {
    if (sizing.contextLost) throw rendererContextLostError();
    const { width, height } = job.options;
    const projectMaximum = job.kind === 'video' ? VIDEO_MAX_SIDE : MAX_SIDE;
    const limits = sizing.limits || {};
    const maxWidth = minimumPositive(projectMaximum, limits.maxViewportWidth, limits.maxTextureSize, limits.maxRenderbufferSize);
    const maxHeight = minimumPositive(projectMaximum, limits.maxViewportHeight, limits.maxTextureSize, limits.maxRenderbufferSize);
    if (width > maxWidth || height > maxHeight) {
      throw new ExportDimensionError(
        `This browser and GPU support at most ${maxWidth.toLocaleString()} x ${maxHeight.toLocaleString()} export pixels.`
      );
    }
  }

  function validatePNGBlob(blob) {
    if (!(blob instanceof Blob) || blob.type !== 'image/png' || blob.size <= 0) {
      throw new ExportRenderError('The browser did not produce a valid PNG image.');
    }
  }

  function stableExportError(error) {
    if (error instanceof MolhtmlExportError) return error;
    if (error?.code === 'renderer-dimension-mismatch') return new ExportDimensionError(error.message);
    if (error?.code === 'renderer-context-lost') {
      return new ExportRenderError('The export WebGL context was lost.', { cause: error });
    }
    const message = error instanceof Error && error.message
      ? `The molecular export could not be rendered: ${error.message}`
      : 'The molecular export could not be rendered.';
    return new ExportRenderError(message, { cause: error });
  }

  function mapVideoError(error, signal) {
    if (signal?.aborted) return cancellationError(signal.reason);
    if (error instanceof MolhtmlExportError) return error;
    if (error?.name === 'AbortError') return new ExportCancelledError('The export was cancelled.', { cause: error });
    if (error?.name === 'SecurityError') {
      return new ExportVideoUnsupportedError('Browser security policy blocked video recording.', { cause: error });
    }
    if (error?.name === 'NotSupportedError' || error?.molhtmlExplicitMimeRejected) {
      return new ExportVideoUnsupportedError('The browser rejected the requested video format.', { cause: error });
    }
    if (error?.code === 'renderer-context-lost' || error?.code === 'renderer-dimension-mismatch') {
      return error;
    }
    const detail = error?.message ? `: ${error.message}` : '';
    return new ExportVideoEncodeError(`The turntable video could not be encoded${detail}`, { cause: error });
  }

  function rendererContextLostError() {
    const error = new Error('The export WebGL context was lost.');
    error.code = 'renderer-context-lost';
    return error;
  }

  function createJobCancellationScope(externalSignal, onCancel) {
    const controller = new AbortController();
    const listeners = [];
    const cancel = message => {
      if (controller.signal.aborted) return;
      const error = new ExportCancelledError(message);
      controller.abort(error);
      try { onCancel?.(error); } catch {}
    };
    const listen = (target, type, listener) => {
      target.addEventListener(type, listener);
      listeners.push([target, type, listener]);
    };
    if (document.hidden) throw new ExportCancelledError('Video export cannot start while this tab is hidden.');
    if (externalSignal) {
      if (externalSignal.aborted) throw cancellationError(externalSignal.reason);
      listen(externalSignal, 'abort', () => cancel('The export was cancelled.'));
    }
    listen(document, 'visibilitychange', () => {
      if (document.hidden) cancel('Video export was cancelled because this tab became hidden.');
    });
    listen(window, 'pagehide', () => cancel('Video export was cancelled because the page is closing.'));
    return {
      signal: controller.signal,
      dispose() {
        for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
        listeners.length = 0;
      }
    };
  }

  function validateAbortSignal(signal) {
    if (!signal || typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function') {
      throw new TypeError('Turntable signal must be an AbortSignal.');
    }
    return signal;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw cancellationError(signal.reason);
  }

  function cancellationError(reason) {
    if (reason instanceof ExportCancelledError) return reason;
    return new ExportCancelledError('The export was cancelled.', { cause: reason });
  }

  function raceAbort(promise, signal) {
    if (!signal) return Promise.resolve(promise);
    if (signal.aborted) return Promise.reject(cancellationError(signal.reason));
    let listener;
    const aborted = new Promise((resolve, reject) => {
      listener = () => reject(cancellationError(signal.reason));
      signal.addEventListener('abort', listener, { once: true });
    });
    return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', listener));
  }

  function emitProgress(callback, record) {
    if (typeof callback !== 'function') return;
    const frozen = Object.freeze({ ...record });
    try {
      Promise.resolve(callback(frozen)).catch(() => {});
    } catch {}
  }

  async function settleClipboard(job, write) {
    const [rendered, written] = await Promise.allSettled([job, write]);
    if (rendered.status === 'rejected') throw rendered.reason;
    const { blob, metadata } = rendered.value;
    if (written.status === 'fulfilled') return { status: 'copied', metadata };
    const reason = clipboardErrorReason(written.reason);
    if (isClipboardDenied(written.reason)) return { status: 'denied', reason, blob, metadata };
    if (isClipboardUnsupported(written.reason)) return { status: 'unsupported', reason, blob, metadata };
    throw new ExportClipboardError(reason, { cause: written.reason });
  }

  function clipboardUnsupportedReason() {
    if (typeof window.ClipboardItem !== 'function') return 'This browser does not support copying PNG images.';
    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function') {
      return 'Image clipboard access is unavailable in this context.';
    }
    if (typeof window.ClipboardItem.supports === 'function' && !window.ClipboardItem.supports('image/png')) {
      return 'This browser clipboard does not accept PNG images.';
    }
    return '';
  }

  function clipboardErrorReason(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return 'The browser denied image clipboard access. You can download the rendered PNG instead.';
    }
    if (error?.name === 'NotSupportedError') return 'This browser does not support copying PNG images.';
    return error?.message || 'The image could not be copied to the clipboard.';
  }

  function isClipboardDenied(error) {
    return error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
  }

  function isClipboardUnsupported(error) {
    return error?.name === 'NotSupportedError';
  }

  function exportFilename(requested, title, width, height, transparent) {
    const requestedText = String(requested || '').trim().replace(/\.png$/i, '');
    const base = safeFilenameStem(requestedText || title);
    const suffix = requestedText ? '' : `_${width}x${height}${transparent ? '_transparent' : ''}`;
    return `${base}${suffix}.png`;
  }

  function safeFilenameStem(value) {
    const scalarText = Array.from(String(value || ''), character => {
      const code = character.charCodeAt(0);
      return character.length === 1 && code >= 0xd800 && code <= 0xdfff ? ' ' : character;
    }).join('');
    let safe = scalarText
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/g, '_')
      .replace(/[. ]+$/g, '')
      .replace(/^\.+/g, '');
    safe = Array.from(safe).slice(0, 80).join('');
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`;
    return safe || 'molecule';
  }

  function evenFloor(value) {
    return Math.floor(Number(value) / 2) * 2;
  }

  function nearestEven(value) {
    return Math.round(Number(value) / 2) * 2;
  }

  function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function minimumPositive(fallback, ...values) {
    const positive = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
    return positive.length ? Math.min(fallback, ...positive) : fallback;
  }

  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  window.MolhtmlExport = Object.freeze({
    ExportService,
    MolhtmlExportError,
    ExportBusyError,
    ExportDimensionError,
    ExportRenderError,
    ExportTimeoutError,
    ExportClipboardError,
    ExportDownloadError,
    ExportVideoUnsupportedError,
    ExportVideoEncodeError,
    ExportCancelledError,
    RecorderSession,
    normalizeOptions,
    normalizeTurntableOptions,
    fitVideoDimensions,
    turntableAngles,
    turntableFilename,
    turntableCapabilities,
    normalizeMimeType,
    mimeExtension,
    videoBitrate,
    exportFilename
  });
})();
