(function () {
  'use strict';

  const Core = window.MolhtmlCore;
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
      this.measurementDraft = [];
      this.activeMeasurementId = null;
      this.activeSavedSelectionId = null;
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
          this.viewer.removeAllShapes();
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
      this.viewer.removeAllShapes();
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

      this.applySavedSelectionHighlight();
      this.applyLigandAnalysis();
      this.applySelectionHighlight();
      this.applyMeasurements();
      this.applyMeasurementDraft();
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

    applySavedSelectionHighlight() {
      if (!this.activeSavedSelectionId) return;
      const saved = (this.doc.scene.savedSelections || []).find(record => record.id === this.activeSavedSelectionId);
      if (!saved) return;
      const match = Core.matchSavedSelection(saved, this.parsed.atoms, this.doc.structure.id);
      if (!match.valid) return;
      const atoms = match.atoms.filter(atom =>
        (this.doc.scene.showHydrogens || atom.element !== 'H')
        && (this.doc.scene.showWater || !Core.isWater(atom))
      );
      if (!atoms.length) return;
      this.viewer.addStyle({ serial: atoms.map(atom => atom.serial) }, {
        stick: { radius: .25, color: '#30e3d2' },
        sphere: { scale: .38, color: '#30e3d2', opacity: .72 }
      });
    }

    applyLigandAnalysis() {
      const state = this.doc.scene.ligandAnalysis;
      if (!state?.selectedLigand) return;
      const result = Core.analyzeLigandPocket(
        this.parsed, state.selectedLigand, state.cutoff, this.doc.structure.id
      );
      if (!result.ligand) return;

      if (state.showLigand) {
        const ligandSelection = this.andSelection(this.to3DSelection(result.ligand.selector), { hetflag: true });
        this.viewer.addStyle(ligandSelection, {
          stick: { radius: .3, color: '#ff5e83' }, sphere: { scale: .45, color: '#ff5e83' }
        });
      }
      if (state.showPocket) {
        for (const residue of result.residues) {
          this.viewer.addStyle(this.to3DSelection(residue), {
            stick: { radius: .22, color: residue.hasPolar ? '#71ddf8' : '#7ee2a8' },
            sphere: { scale: .25, color: residue.hasPolar ? '#71ddf8' : '#7ee2a8' }
          });
        }
      }
      if (state.showContacts) {
        const contacts = state.polarOnly ? result.contacts.filter(contact => contact.polar) : result.contacts;
        for (const contact of contacts.slice(0, 500)) {
          const color = contact.polar ? '#ffcf5a' : contact.close ? '#71ddf8' : '#7c91a7';
          this.viewer.addLine({
            start: point(contact.ligandAtom), end: point(contact.targetAtom),
            color, dashed: true, linewidth: contact.polar ? 2.5 : 1.5, opacity: .82
          });
        }
      }
    }

    applyMeasurements() {
      for (const measurement of this.doc.scene.measurements || []) {
        const atoms = Core.measurementAtoms(measurement, this.parsed.atoms, this.doc.structure.id);
        if (!atoms) continue;
        const active = measurement.id === this.activeMeasurementId;
        const color = active ? '#ffcf5a' : '#49d7ff';
        for (let index = 1; index < atoms.length; index++) {
          this.viewer.addLine({
            start: point(atoms[index - 1]), end: point(atoms[index]),
            color, dashed: true, linewidth: active ? 3 : 2
          });
        }
        for (const atom of atoms) {
          this.viewer.addSphere({ center: point(atom), radius: active ? .18 : .13, color, opacity: .94 });
        }
        const value = Core.formatMeasurementValue(measurement.type, Core.measurementValue(measurement.type, atoms));
        const label = String(measurement.label || '').trim();
        this.viewer.addLabel(label ? `${label}: ${value}` : value, {
          position: measurementLabelPosition(measurement.type, atoms),
          fontColor: '#07111f', backgroundColor: color, backgroundOpacity: .92,
          borderColor: '#ffffff', borderThickness: active ? 2 : 1,
          fontSize: active ? 13 : 11, padding: 4, inFront: true
        });
      }
    }

    applyMeasurementDraft() {
      if (!this.measurementDraft.length) return;
      for (let index = 0; index < this.measurementDraft.length; index++) {
        const atom = this.measurementDraft[index];
        this.viewer.addStyle(this.to3DSelection(Core.selectorForAtom(atom, 'atom', this.doc.structure.id)), {
          stick: { radius: .3, color: '#ff5e83' }, sphere: { scale: .54, color: '#ff5e83' }
        });
        this.viewer.addLabel(String(index + 1), {
          position: point(atom), fontColor: '#ffffff', backgroundColor: '#d92d57',
          backgroundOpacity: .96, borderColor: '#ffffff', borderThickness: 1,
          fontSize: 12, padding: 4, inFront: true
        });
        if (index > 0) {
          this.viewer.addLine({
            start: point(this.measurementDraft[index - 1]), end: point(atom),
            color: '#ff5e83', dashed: true, linewidth: 3
          });
        }
      }
    }

    setMeasurementDraft(atoms) {
      this.measurementDraft = Array.isArray(atoms) ? [...atoms] : [];
      if (!this.doc) return;
      this.applyAppearance();
      this.viewer.render();
    }

    setActiveMeasurement(id) {
      this.activeMeasurementId = id || null;
      if (!this.doc) return;
      this.applyAppearance();
      this.viewer.render();
    }

    setActiveSavedSelection(id) {
      this.activeSavedSelectionId = id || null;
      if (!this.doc) return;
      this.applyAppearance();
      this.viewer.render();
    }

    focusSavedSelection(id, notify = true) {
      if (!this.doc) return false;
      const saved = (this.doc.scene.savedSelections || []).find(record => record.id === id);
      if (!saved) return false;
      const match = Core.matchSavedSelection(saved, this.parsed.atoms, this.doc.structure.id);
      if (!match.valid || !match.atoms.length) return false;
      this.applyingDocument = true;
      this.viewer.zoomTo({ serial: match.atoms.map(atom => atom.serial) });
      this.viewer.render();
      this.doc.scene.camera = { view: this.viewer.getView() };
      this.lastReportedView = JSON.stringify(this.doc.scene.camera.view);
      requestAnimationFrame(() => { this.applyingDocument = false; });
      if (notify) this.callbacks.onCamera?.(structuredClone(this.doc.scene.camera));
      return true;
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

    focusSelector(selector, notify = true) {
      if (!this.doc || !selector) return;
      const selection = this.to3DSelection(selector);
      this.applyingDocument = true;
      this.viewer.zoomTo(selection);
      this.viewer.render();
      this.doc.scene.camera = { view: this.viewer.getView() };
      this.lastReportedView = JSON.stringify(this.doc.scene.camera.view);
      requestAnimationFrame(() => { this.applyingDocument = false; });
      if (notify) this.callbacks.onCamera?.(structuredClone(this.doc.scene.camera));
    }

    focusSelectors(selectors, notify = true) {
      if (!this.doc || !Array.isArray(selectors) || !selectors.length) return;
      const selections = selectors.map(selector => this.to3DSelection(selector));
      this.applyingDocument = true;
      this.viewer.zoomTo(selections.length === 1 ? selections[0] : { or: selections });
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

  function point(atom) {
    return { x: Number(atom.x), y: Number(atom.y), z: Number(atom.z) };
  }

  function measurementLabelPosition(type, atoms) {
    if (type === 'angle') return point(atoms[1]);
    if (type === 'dihedral') return {
      x: (atoms[1].x + atoms[2].x) / 2,
      y: (atoms[1].y + atoms[2].y) / 2,
      z: (atoms[1].z + atoms[2].z) / 2
    };
    return {
      x: (atoms[0].x + atoms[1].x) / 2,
      y: (atoms[0].y + atoms[1].y) / 2,
      z: (atoms[0].z + atoms[1].z) / 2
    };
  }

  window.MoleculeRenderer = MoleculeRenderer;
})();
