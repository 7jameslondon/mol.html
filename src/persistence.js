(function () {
  'use strict';

  const DATA_BLOCK_ID = 'molhtml-doc';
  const LICENSE_BLOCK_ID = 'molhtml-license-notices';
  const CANONICAL_LICENSE_NOTICES = __CANONICAL_LICENSE_NOTICES_JSON__;
  const CANONICAL_LICENSE_NOTICES_SHA256 = '__CANONICAL_LICENSE_NOTICES_SHA256__';
  const CANONICAL_LICENSE_BLOCK_TEXT = `\n${CANONICAL_LICENSE_NOTICES}\n`;
  const DB_NAME = 'molhtml-autosave';
  const STORE_NAME = 'recovery';

  function capturePristine() {
    return document.cloneNode(true);
  }

  function rebuildLicenseBlock(clone) {
    const existing = [...clone.querySelectorAll(`[id="${LICENSE_BLOCK_ID}"]`)];
    const first = existing.shift();
    const block = clone.createElement('script');
    block.type = 'text/plain';
    block.id = LICENSE_BLOCK_ID;
    block.dataset.noticeSha256 = CANONICAL_LICENSE_NOTICES_SHA256;
    block.textContent = CANONICAL_LICENSE_BLOCK_TEXT;

    if (first?.parentNode) first.parentNode.replaceChild(block, first);
    else {
      const anchor = clone.querySelector('script[data-role="molhtml-app"]');
      if (!anchor?.parentNode) throw new Error('The application shell has no safe location for its license notices.');
      anchor.parentNode.insertBefore(block, anchor);
    }
    for (const duplicate of existing) duplicate.remove();
  }

  function validateSerializedLicenseNotices(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const blocks = [...parsed.querySelectorAll(`[id="${LICENSE_BLOCK_ID}"]`)];
    if (blocks.length !== 1) throw new Error(`Expected exactly one canonical license block, found ${blocks.length}.`);
    const block = blocks[0];
    if (block.tagName !== 'SCRIPT' || block.type !== 'text/plain') throw new Error('The canonical license block has an invalid element type.');
    if (block.dataset.noticeSha256 !== CANONICAL_LICENSE_NOTICES_SHA256) throw new Error('The canonical license identifier was altered.');
    if (block.textContent !== CANONICAL_LICENSE_BLOCK_TEXT) throw new Error('The canonical license notices were altered.');
    return true;
  }

  function serializeDocument(pristine, doc) {
    const clone = pristine.cloneNode(true);
    rebuildLicenseBlock(clone);
    const block = clone.getElementById(DATA_BLOCK_ID);
    if (!block) throw new Error('The application shell is missing its molhtml document block.');
    block.textContent = '\n' + JSON.stringify(doc, null, 2).replace(/</g, '\\u003c') + '\n';
    const title = clone.querySelector('title');
    if (title) title.textContent = `${doc.title} — mol.html`;
    const html = '<!DOCTYPE html>\n' + clone.documentElement.outerHTML;
    validateSerializedLicenseNotices(html);
    return html;
  }

  function extractDocument(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const text = parsed.getElementById(DATA_BLOCK_ID)?.textContent?.trim();
    return text ? JSON.parse(text) : null;
  }

  function suggestedName(doc) {
    const base = doc.title.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'Molecule';
    return `${base}.mol.html`;
  }

  function download(html, name) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function openDatabase() {
    return new Promise(resolve => {
      if (!globalThis.indexedDB) { resolve(null); return; }
      let request;
      try { request = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'documentId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  async function putRecovery(doc) {
    const db = await openDatabase();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ documentId: doc.documentId, revision: doc.revision, savedAt: Date.now(), json: JSON.stringify(doc) });
        tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false);
      } catch { resolve(false); }
    });
  }

  async function getRecovery(documentId) {
    const db = await openDatabase();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(documentId);
        request.onsuccess = () => resolve(request.result || null); request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  class PersistenceManager {
    constructor(pristine, getDocument, callbacks = {}) {
      this.pristine = pristine;
      this.getDocument = getDocument;
      this.callbacks = callbacks;
      this.fileHandle = null;
      this.snapshotTimer = null;
      this.diskTimer = null;
      this.lastDiskModified = 0;
      this.lastDiskRevision = null;
      this.externalChange = false;
    }

    serialize() { return serializeDocument(this.pristine, this.getDocument()); }

    schedule() {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = setTimeout(async () => {
        const stored = await putRecovery(this.getDocument());
        this.callbacks.onRecoveryStatus?.(stored);
      }, 450);
      if (this.fileHandle && !this.externalChange) {
        clearTimeout(this.diskTimer);
        this.diskTimer = setTimeout(() => this.writeCurrent(false), 950);
      }
    }

    async recoveryFor(doc) {
      const snapshot = await getRecovery(doc.documentId);
      if (!snapshot || snapshot.revision <= doc.revision) return null;
      try { return JSON.parse(snapshot.json); } catch { return null; }
    }

    async save(forcePicker = false) {
      const doc = this.getDocument();
      let html;
      try {
        html = this.serialize();
      } catch (error) {
        this.callbacks.onStatus?.(`Save refused: ${error.message}`, 'error');
        return 'failed';
      }
      if (typeof globalThis.showSaveFilePicker !== 'function') {
        download(html, suggestedName(doc));
        this.callbacks.onStatus?.('Downloaded a new self-contained copy', 'success');
        return 'downloaded';
      }
      if (forcePicker || !this.fileHandle) {
        try {
          this.fileHandle = await globalThis.showSaveFilePicker({
            id: 'molhtml-document', suggestedName: suggestedName(doc),
            types: [{ description: 'mol.html document', accept: { 'text/html': ['.html'] } }]
          });
        } catch (error) {
          if (error?.name === 'AbortError') return 'cancelled';
          this.callbacks.onStatus?.(`Save failed: ${error.message}`, 'error');
          return 'failed';
        }
        this.externalChange = false;
        this.callbacks.onHandle?.(this.fileHandle.name);
      }
      return this.writeCurrent(true, html);
    }

    async writeCurrent(userInitiated, serializedHtml = null) {
      if (!this.fileHandle) return 'no-handle';
      if (this.externalChange && !userInitiated) return 'external-change';
      if (this.externalChange && userInitiated) {
        this.callbacks.onStatus?.('The file changed outside the viewer. Reload it before saving.', 'warning');
        return 'external-change';
      }
      try {
        const html = serializedHtml ?? this.serialize();
        const writable = await this.fileHandle.createWritable();
        await writable.write(new Blob([html], { type: 'text/html' }));
        await writable.close();
        const file = await this.fileHandle.getFile();
        this.lastDiskModified = file.lastModified;
        this.lastDiskRevision = this.getDocument().revision;
        this.callbacks.onStatus?.(userInitiated ? 'Saved into this HTML file' : 'Autosaved into this HTML file', 'success');
        this.startWatching();
        return 'saved';
      } catch (error) {
        this.callbacks.onStatus?.(`Save failed: ${error.message}`, 'error');
        return 'failed';
      }
    }

    startWatching() {
      if (this.watchTimer) return;
      this.watchTimer = setInterval(() => this.checkExternal(), 1800);
    }

    async checkExternal() {
      if (!this.fileHandle || this.externalChange) return;
      try {
        const file = await this.fileHandle.getFile();
        if (!this.lastDiskModified) { this.lastDiskModified = file.lastModified; return; }
        if (file.lastModified === this.lastDiskModified) return;
        const diskDoc = extractDocument(await file.text());
        if (diskDoc && diskDoc.revision !== this.lastDiskRevision) {
          this.externalChange = true;
          this.callbacks.onExternalChange?.(diskDoc);
        } else {
          this.lastDiskModified = file.lastModified;
        }
      } catch { /* File watching is best effort. */ }
    }
  }

  window.MolhtmlPersistence = {
    capturePristine, serializeDocument, extractDocument, validateSerializedLicenseNotices, PersistenceManager
  };
})();
