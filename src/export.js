(function () {
  'use strict';

  const MIN_SIDE = 64;
  const MAX_SIDE = 8192;
  const MAX_PIXELS = 32_000_000;
  const DEFAULT_TIMEOUT_MS = 30_000;

  class MolhtmlExportError extends Error {
    constructor(message, code = 'export-failed', options) {
      super(message, options);
      this.name = new.target.name;
      this.code = code;
    }
  }

  class ExportBusyError extends MolhtmlExportError {
    constructor(message = 'Another image export is already in progress.') {
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

  class ExportService {
    constructor(getSource, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
      if (typeof getSource !== 'function') throw new TypeError('ExportService requires a source snapshot function.');
      this.getSource = getSource;
      this.timeoutMs = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
      this.busy = false;
      this.quarantine = null;
      this.fatalError = null;
      this.renderer = null;
      this.container = null;
      this.objectUrls = new Set();
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

    downloadBlob(blob, metadata, requestedFilename) {
      validatePNGBlob(blob);
      const filename = exportFilename(requestedFilename, metadata.title, metadata.width, metadata.height, metadata.transparent);
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
        throw new ExportDownloadError(`The PNG was rendered, but the download could not start${detail}`, { cause: error });
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
      this.busy = true;
      return this.runJob(accepted).finally(() => { this.busy = false; });
    }

    availabilityError() {
      if (this.fatalError) return this.fatalError;
      if (this.busy) return new ExportBusyError();
      if (this.quarantine) {
        return new ExportBusyError(
          'The previous timed-out surface is still finishing. Exporting will resume when it settles or after reload.'
        );
      }
      return null;
    }

    async runJob(job) {
      let renderer = null;
      let generation = null;
      let settlement = null;
      let deferredReset = false;
      let result = null;
      let failure = null;
      try {
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
        settlement = renderer.whenSurfacesReady(generation);
        await withTimeout(settlement, this.timeoutMs);
        await nextAnimationFrame();
        const blob = await renderer.capturePNG(generation, {
          width: job.options.width,
          height: job.options.height,
          backgroundAlpha: job.options.transparent ? 0 : 1
        });
        validatePNGBlob(blob);
        result = {
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
      } catch (error) {
        const interruptedGeneration = renderer && generation == null && Number.isInteger(error?.molhtmlRenderGeneration);
        if (interruptedGeneration) {
          generation = error.molhtmlRenderGeneration;
          settlement = renderer.whenSurfacesReady(generation);
        }
        if ((error instanceof ExportTimeoutError || interruptedGeneration) && settlement && generation != null) {
          deferredReset = true;
          this.beginDeferredReset(renderer, generation, settlement);
        }
        failure = stableExportError(error);
        if (renderer && generation == null && !interruptedGeneration
          && !(failure instanceof ExportDimensionError)) {
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
          `Image export is unavailable because ${context}. Reload this file before trying again.`,
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
        resources: this.renderer?.resourceCounts() || { models: 0, shapes: 0, labels: 0, surfaces: 0 }
      };
    }
  }

  function captureAcceptedJob(source, options) {
    if (!source?.document || !source?.camera) throw new ExportRenderError('The live molecular scene is unavailable.');
    const visibleWidth = positiveInteger(source.visibleSize?.width, 0);
    const visibleHeight = positiveInteger(source.visibleSize?.height, 0);
    if (!visibleWidth || !visibleHeight) throw new ExportDimensionError('The visible viewer has no exportable pixel dimensions.');
    const normalized = normalizeOptions(options, visibleWidth, visibleHeight);
    const documentCopy = structuredClone(source.document);
    documentCopy.scene.camera = structuredClone(source.camera);
    const measurementIds = new Set((documentCopy.scene.measurements || []).map(record => record.id));
    const savedSelectionIds = new Set((documentCopy.scene.savedSelections || []).map(record => record.id));
    return {
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
    if (width * height > MAX_PIXELS) {
      throw new ExportDimensionError('Export dimensions cannot exceed 32 megapixels.');
    }
  }

  function validateHardwareLimits(job, sizing) {
    if (sizing.contextLost) throw new ExportRenderError('The export WebGL context is unavailable.');
    const { width, height } = job.options;
    const limits = sizing.limits || {};
    const maxWidth = minimumPositive(MAX_SIDE, limits.maxViewportWidth, limits.maxTextureSize, limits.maxRenderbufferSize);
    const maxHeight = minimumPositive(MAX_SIDE, limits.maxViewportHeight, limits.maxTextureSize, limits.maxRenderbufferSize);
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
    const message = error instanceof Error && error.message
      ? `The molecular image could not be rendered: ${error.message}`
      : 'The molecular image could not be rendered.';
    return new ExportRenderError(message, { cause: error });
  }

  function withTimeout(promise, timeoutMs) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new ExportTimeoutError()), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function nextAnimationFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
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

  window.MolhtmlExport = Object.freeze({
    ExportService,
    MolhtmlExportError,
    ExportBusyError,
    ExportDimensionError,
    ExportRenderError,
    ExportTimeoutError,
    ExportClipboardError,
    ExportDownloadError,
    normalizeOptions,
    exportFilename
  });
})();
