(function () {
  'use strict';

  const Core = window.MolViewCore;
  const ThreeDmol = window.$3Dmol || window['3Dmol'];

  class MoleculeRenderer {
    constructor(container, callbacks = {}) {
      if (!ThreeDmol?.createViewer) throw new Error('The bundled 3Dmol.js renderer did not load.');
      this.container = container;
      this.callbacks = callbacks;
      this.doc = null;
      this.parsed = null;
      this.model = null;
      this.cacheKey = '';
      this.surfaceGeneration = 0;
      this.applyingDocument = false;
      this.lastReportedView = '';
      this.viewer = ThreeDmol.createViewer(container, {
        backgroundColor: '#07111f',
        antialias: true
      });
      this.viewer.setViewChangeCallback(() => this.queueViewChange());
      this.resizeObserver = new ResizeObserver(() => {
        this.viewer.resize();
        this.viewer.render();
      });
      this.resizeObserver.observe(container);
    }

    setDocument(doc, { fit = false } = {}) {
      this.doc = doc;
      const key = `${doc.structure.id}:${doc.structure.data.length}:${doc.structure.data.slice(0, 60)}`;
      const structureChanged = key !== this.cacheKey;
      this.applyingDocument = true;

      try {
        if (structureChanged) {
          this.parsed = Core.parsePDB(doc.structure.data);
          this.serialAtoms = new Map(this.parsed.atoms.map(atom => [atom.serial, atom]));
          this.cacheKey = key;
          this.surfaceGeneration += 1;
          this.viewer.removeAllSurfaces();
          this.viewer.removeAllLabels();
          this.viewer.removeAllModels();
          this.model = this.viewer.addModel(doc.structure.data, doc.structure.format);
          fit = true;
        }

        this.applyAppearance();
        const savedView = doc.scene.camera?.view;
        if (fit || !validView(savedView)) {
          this.viewer.zoomTo(this.visibleSelection());
        } else {
          this.viewer.setView(savedView);
        }
        this.viewer.render();
        doc.scene.camera = { view: this.viewer.getView() };
        this.lastReportedView = JSON.stringify(doc.scene.camera.view);
      } finally {
        requestAnimationFrame(() => { this.applyingDocument = false; });
      }
    }

    applyAppearance() {
      this.surfaceGeneration += 1;
      const generation = this.surfaceGeneration;
      const visible = this.visibleSelection();
      const colorfunc = atom => this.colorFor3DAtom(atom);

      this.viewer.setBackgroundColor(this.doc.scene.background, 1);
      this.viewer.removeAllLabels();
      this.viewer.removeAllSurfaces();
      this.viewer.setStyle({}, {});
      this.model?.setColorByFunction({}, colorfunc);

      switch (this.doc.scene.representation) {
        case 'cartoon':
          this.viewer.setStyle(visible, { cartoon: { colorfunc, thickness: .22 } });
          this.viewer.addStyle(this.andSelection(visible, { hetflag: true }), {
            stick: { radius: .18, colorfunc }, sphere: { scale: .28, colorfunc }
          });
          break;
        case 'sticks':
          this.viewer.setStyle(visible, { stick: { radius: .2, colorfunc } });
          break;
        case 'spacefill':
          this.viewer.setStyle(visible, { sphere: { scale: 1, colorfunc } });
          break;
        case 'lines':
          this.viewer.setStyle(visible, { line: { linewidth: 1.5, colorfunc } });
          break;
        case 'surface': {
          this.viewer.setStyle(visible, { cartoon: { colorfunc, opacity: .62 } });
          const surface = this.viewer.addSurface(ThreeDmol.SurfaceType.VDW, { opacity: .78 }, visible);
          Promise.resolve(surface).then(() => {
            if (generation === this.surfaceGeneration) this.viewer.render();
          }).catch(error => console.error('3Dmol surface rendering failed:', error));
          break;
        }
        case 'ball-and-stick':
        default:
          this.viewer.setStyle(visible, {
            stick: { radius: .18, colorfunc },
            sphere: { scale: .28, colorfunc }
          });
          break;
      }

      this.applySelectionHighlight();
      this.viewer.setClickable({}, false);
      this.viewer.setClickable(visible, true, atom => {
        const selected = this.serialAtoms.get(Number(atom.serial)) || this.normalizeAtom(atom);
        this.callbacks.onPick?.(selected);
      });
    }

    applySelectionHighlight() {
      const selector = this.doc.scene.selection?.selector;
      if (!selector) return;
      const atom = this.parsed.atoms.find(candidate => Core.atomMatchesSelector(candidate, selector, this.doc.structure.id));
      if (!atom) return;

      const selection = this.to3DSelection(selector);
      this.viewer.addStyle(selection, {
        stick: { radius: .28, color: '#ffe66d' },
        sphere: { scale: .5, color: '#ffe66d' }
      });
      this.viewer.addLabel(Core.atomLabel(atom), {
        position: { x: atom.x, y: atom.y, z: atom.z },
        fontColor: '#07111f',
        backgroundColor: '#ffe66d',
        backgroundOpacity: .9,
        borderColor: '#ffffff',
        borderThickness: 1,
        fontSize: 12,
        padding: 4,
        inFront: true
      });
    }

    visibleSelection() {
      const filters = [];
      if (!this.doc.scene.showHydrogens) filters.push({ not: { elem: 'H' } });
      if (!this.doc.scene.showWater) filters.push({ not: { resn: ['HOH', 'WAT', 'H2O', 'DOD'] } });
      if (!filters.length) return {};
      return filters.length === 1 ? filters[0] : { and: filters };
    }

    andSelection(left, right) {
      if (!left || !Object.keys(left).length) return right;
      return { and: [left, right] };
    }

    to3DSelection(selector) {
      const selection = {};
      if (selector.chain != null) selection.chain = selector.chain === '_' ? '' : selector.chain;
      if (selector.resi != null) selection.resi = Number(selector.resi);
      if (selector.icode != null) selection.icode = selector.icode;
      if (selector.resn != null) selection.resn = selector.resn;
      if (selector.atom != null) selection.atom = selector.atom;
      if (selector.altLoc != null) selection.altLoc = selector.altLoc;
      if (selector.serial != null) selection.serial = Number(selector.serial);
      return selection;
    }

    normalizeAtom(atom) {
      return {
        index: Number(atom.index) || 0,
        serial: Number(atom.serial) || 0,
        name: String(atom.atom || atom.name || 'X').trim(),
        altLoc: String(atom.altLoc || '').trim(),
        resn: String(atom.resn || 'UNK').trim(),
        chain: String(atom.chain || '').trim() || '_',
        resi: Number(atom.resi) || 0,
        icode: String(atom.icode || '').trim(),
        x: Number(atom.x) || 0,
        y: Number(atom.y) || 0,
        z: Number(atom.z) || 0,
        element: String(atom.elem || atom.element || 'C').trim().toUpperCase(),
        het: Boolean(atom.hetflag),
        model: Number(atom.model) + 1
      };
    }

    colorFor3DAtom(atom) {
      const normalized = this.serialAtoms.get(Number(atom.serial)) || this.normalizeAtom(atom);
      return Core.colorForAtom(normalized, this.doc, this.parsed);
    }

    fit(notify = true) {
      if (!this.doc) return;
      this.applyingDocument = true;
      this.viewer.zoomTo(this.visibleSelection());
      this.viewer.render();
      this.doc.scene.camera = { view: this.viewer.getView() };
      this.lastReportedView = JSON.stringify(this.doc.scene.camera.view);
      requestAnimationFrame(() => { this.applyingDocument = false; });
      if (notify) this.callbacks.onCamera?.(structuredClone(this.doc.scene.camera));
    }

    render() {
      if (!this.doc) return;
      this.viewer.setBackgroundColor(this.doc.scene.background, 1);
      this.viewer.render();
    }

    queueViewChange() {
      if (this.applyingDocument || !this.doc) return;
      clearTimeout(this.viewTimer);
      this.viewTimer = setTimeout(() => {
        if (this.applyingDocument || !this.doc) return;
        const view = this.viewer.getView();
        const serialized = JSON.stringify(view);
        if (serialized === this.lastReportedView) return;
        this.lastReportedView = serialized;
        this.callbacks.onCamera?.({ view });
      }, 220);
    }
  }

  function validView(view) {
    return Array.isArray(view) && view.length === 8 && view.every(Number.isFinite);
  }

  window.MoleculeRenderer = MoleculeRenderer;
})();
