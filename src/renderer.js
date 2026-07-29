(function () {
  'use strict';

  const Core = window.MolhtmlCore;
  const ThreeDmol = window.$3Dmol || window['3Dmol'];

  class MoleculeRenderer {
    constructor(container, callbacks = {}, options = {}) {
      if (!ThreeDmol?.createViewer) throw new Error('The bundled 3Dmol.js renderer did not load.');
      this.container = container;
      this.callbacks = callbacks;
      this.options = {
        backgroundAlpha: options.backgroundAlpha === 0 ? 0 : 1,
        interactive: options.interactive !== false,
        screenScale: positiveNumber(options.screenScale, 1),
        upscale: options.upscale !== false
      };
      this.doc = null;
      this.parsed = null;
      this.model = null;
      this.models = [];
      this.cacheKey = '';
      this.surfaceGeneration = 0;
      this.surfaceTasks = new Map();
      this.applyingDocument = false;
      this.lastReportedView = '';
      this.measurementDraft = [];
      this.activeMeasurementId = null;
      this.activeSavedSelectionId = null;
      this.domainByRendererKey = new Map();
      this.rendererLocationByDomainIndex = new Map();
      this.viewer = ThreeDmol.createViewer(container, {
        backgroundColor: '#07111f',
        backgroundAlpha: this.options.backgroundAlpha,
        antialias: true,
        upscale: this.options.upscale,
        nomouse: !this.options.interactive
      });
      if (!this.options.interactive) this.stabilizeFramebufferResources();
      if (this.options.interactive) {
        this.viewer.setViewChangeCallback(() => this.queueViewChange());
        this.resizeObserver = new ResizeObserver(() => {
          this.viewer.resize();
          this.viewer.render();
        });
        this.resizeObserver.observe(container);
      } else {
        this.viewer.divwatcher?.disconnect?.();
        this.viewer.intwatcher?.disconnect?.();
      }
    }

    setDocument(doc, {
      fit = false, cameraMode = 'document', writeCamera = true, presentationState = null
    } = {}) {
      this.doc = doc;
      this.writeCamera = writeCamera !== false;
      if (presentationState) {
        this.activeMeasurementId = presentationState.activeMeasurementId || null;
        this.activeSavedSelectionId = presentationState.activeSavedSelectionId || null;
      }
      const key = `${doc.structure.id}:${doc.structure.data.length}:${doc.structure.data.slice(0, 60)}`;
      const structureChanged = key !== this.cacheKey;
      this.applyingDocument = true;

      try {
        if (structureChanged) {
          this.parsed = Core.parseStructure(doc.structure.data, doc.structure.format);
          this.cacheKey = key;
          this.surfaceGeneration += 1;
          this.disposeSurfaceRenderResources();
          this.viewer.removeAllSurfaces();
          this.viewer.removeAllLabels();
          this.disposeShapeRenderResources();
          this.viewer.removeAllShapes();
          this.disposeModelRenderResources();
          this.viewer.removeAllModels();
          const rendererFormat = doc.structure.format === 'mmcif' ? 'cif' : doc.structure.format;
          const multiplePdbModels = doc.structure.format === 'pdb' && this.parsed.coordinateSets.length > 1;
          const multipleMmcifModels = doc.structure.format === 'mmcif' && this.parsed.coordinateSets.length > 1;
          if (multipleMmcifModels) {
            this.models = this.parsed.coordinateSets.map(coordinateSet => {
              const atoms = coordinateSet.atomIndices.map(index => this.parsed.atoms[index]);
              return this.viewer.addModel(rendererCifForAtoms(atoms, coordinateSet.modelNumber), 'cif', { keepH: true });
            });
          } else {
            this.models = multiplePdbModels
              ? this.viewer.addModels(doc.structure.data, rendererFormat, { keepH: true })
              : [this.viewer.addModel(doc.structure.data, rendererFormat, { keepH: true })];
          }
          this.model = this.models[0] || null;
          if (multipleMmcifModels) this.buildCoordinateSetAtomMapping();
          else this.buildAtomMapping();
          this.applyNormalizedBonds();
          if (cameraMode !== 'snapshot') fit = true;
        }

        const generation = this.applyAppearance();
        const savedView = doc.scene.camera?.view;
        if (fit || !validView(savedView)) {
          this.viewer.zoomTo(this.visibleSelection());
        } else {
          this.viewer.setView(savedView);
        }
        this.viewer.render();
        const appliedView = this.viewer.getView();
        if (this.writeCamera) doc.scene.camera = { view: appliedView };
        this.lastReportedView = JSON.stringify(appliedView);
        return generation;
      } catch (error) {
        if (error && (typeof error === 'object' || typeof error === 'function') && Object.isExtensible(error)) {
          Object.defineProperty(error, 'molhtmlRenderGeneration', {
            configurable: true, value: this.surfaceGeneration
          });
        }
        throw error;
      } finally {
        requestAnimationFrame(() => { this.applyingDocument = false; });
      }
    }

    applyAppearance() {
      this.surfaceGeneration += 1;
      const generation = this.surfaceGeneration;
      const surfaceTasks = [];
      this.surfaceTasks.clear();
      this.surfaceTasks.set(generation, surfaceTasks);
      const visible = this.visibleSelection();
      const colorfunc = atom => this.colorFor3DAtom(atom);

      this.applyBackground();
      this.removeLabels();
      this.disposeShapeRenderResources();
      this.viewer.removeAllShapes();
      this.disposeSurfaceRenderResources();
      this.viewer.removeAllSurfaces();
      this.disposeModelRenderResources();
      this.viewer.setStyle({}, {});
      for (const model of this.models) model?.setColorByFunction({}, colorfunc);

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
          this.viewer.setStyle(visible, { line: { linewidth: this.scaledLineWidth(1.5), colorfunc } });
          break;
        case 'surface': {
          this.viewer.setStyle(visible, { cartoon: { colorfunc, opacity: .62 } });
          const surface = this.viewer.addSurface(ThreeDmol.SurfaceType.VDW, { opacity: .78 }, visible);
          const task = Promise.resolve(surface).then(() => {
            if (generation === this.surfaceGeneration) this.viewer.render();
            return { ok: true };
          }, error => {
            if (this.options.interactive) console.error('3Dmol surface rendering failed:', error);
            return { ok: false, error };
          });
          surfaceTasks.push(task);
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
      if (this.options.interactive) {
        this.viewer.setClickable({}, false);
        this.viewer.setClickable(visible, true, atom => {
          const selected = this.domainAtomForRenderer(atom) || this.normalizeAtom(atom);
          this.callbacks.onPick?.(selected);
        });
      }
      return generation;
    }

    applySelectionHighlight() {
      const selector = this.doc.scene.selection?.selector;
      if (!selector) return;
      const resolution = Core.resolveUniqueAtomSelector(selector, this.parsed.atoms, this.doc.structure.id);
      if (!resolution.valid) return;
      const atom = resolution.atom;

      const selection = this.selectionForAtoms([atom]);
      this.viewer.addStyle(selection, {
        stick: { radius: .28, color: '#ffe66d' },
        sphere: { scale: .5, color: '#ffe66d' }
      });
      this.viewer.addLabel(Core.atomLabel(atom), this.labelOptions({
        position: { x: atom.x, y: atom.y, z: atom.z },
        fontColor: '#07111f',
        backgroundColor: '#f4c95d',
        backgroundOpacity: .9,
        borderColor: '#ffffff',
        borderThickness: 1,
        fontSize: 12,
        padding: 4,
        inFront: true
      }));
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
      this.viewer.addStyle(this.selectionForAtoms(atoms), {
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
          this.viewer.addStyle(this.andSelection(this.to3DSelection(residue.selector), this.visibleSelection()), {
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
            color, dashed: true, linewidth: this.scaledLineWidth(contact.polar ? 2.5 : 1.5), opacity: .82
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
            color, dashed: true, linewidth: this.scaledLineWidth(active ? 3 : 2)
          });
        }
        for (const atom of atoms) {
          this.viewer.addSphere({ center: point(atom), radius: active ? .18 : .13, color, opacity: .94 });
        }
        const value = Core.formatMeasurementValue(measurement.type, Core.measurementValue(measurement.type, atoms));
        const label = String(measurement.label || '').trim();
        this.viewer.addLabel(label ? `${label}: ${value}` : value, this.labelOptions({
          position: measurementLabelPosition(measurement.type, atoms),
          fontColor: '#07111f', backgroundColor: color, backgroundOpacity: .92,
          borderColor: '#ffffff', borderThickness: active ? 2 : 1,
          fontSize: active ? 13 : 11, padding: 4, inFront: true
        }));
      }
    }

    applyMeasurementDraft() {
      if (!this.measurementDraft.length) return;
      for (let index = 0; index < this.measurementDraft.length; index++) {
        const atom = this.measurementDraft[index];
        this.viewer.addStyle(this.to3DSelection(Core.selectorForAtom(atom, 'atom', this.doc.structure.id)), {
          stick: { radius: .3, color: '#ff5e83' }, sphere: { scale: .54, color: '#ff5e83' }
        });
        this.viewer.addLabel(String(index + 1), this.labelOptions({
          position: point(atom), fontColor: '#ffffff', backgroundColor: '#d92d57',
          backgroundOpacity: .96, borderColor: '#ffffff', borderThickness: 1,
          fontSize: 12, padding: 4, inFront: true
        }));
        if (index > 0) {
          this.viewer.addLine({
            start: point(this.measurementDraft[index - 1]), end: point(atom),
            color: '#ff5e83', dashed: true, linewidth: this.scaledLineWidth(3)
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
      this.viewer.zoomTo(this.selectionForAtoms(match.atoms));
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
      const kind = selector?.kind || this.inferSelectorKind(selector);
      if (kind && this.parsed) {
        const match = Core.matchSavedSelection({ ...selector, kind }, this.parsed.atoms, this.doc.structure.id);
        if (match.valid) return this.selectionForAtoms(match.atoms);
      }
      const selection = {};
      if (selector.model != null) {
        const atom = this.parsed?.atoms.find(candidate => candidate.model == selector.model);
        if (atom) selection.model = this.rendererLocationByDomainIndex.get(atom.index).model;
      }
      if (selector.chain != null) selection.chain = selector.chain === '_' ? '' : selector.chain;
      if (selector.resi != null) selection.resi = Number(selector.resi);
      if (selector.icode != null) selection.icode = selector.icode;
      if (selector.resn != null) selection.resn = selector.resn;
      if (selector.atom != null) selection.atom = selector.atom;
      if (selector.altLoc != null) selection.altLoc = selector.altLoc;
      if (selector.serial != null) selection.serial = Number(selector.serial);
      return selection;
    }

    inferSelectorKind(selector) {
      if (!selector) return '';
      if (selector.instanceId != null) return 'instance';
      if (selector.entityId != null) return 'entity';
      if (selector.role != null) return 'role';
      if (selector.connectedComponentId != null) return 'connected-component';
      if (selector.atom != null || selector.sourceIdentity?.atomSiteId != null || selector.sourceIdentity?.labelAtomId != null) return 'atom';
      if (selector.resi != null || selector.sourceIdentity?.labelSeqId != null || selector.sourceIdentity?.authSeqId != null) return 'residue';
      if (selector.chain != null) return 'chain';
      return '';
    }

    selectionForAtoms(atoms) {
      const indexesByModel = new Map();
      for (const atom of atoms || []) {
        const location = this.rendererLocationByDomainIndex.get(atom.index);
        if (!location) continue;
        if (!indexesByModel.has(location.model)) indexesByModel.set(location.model, []);
        indexesByModel.get(location.model).push(location.index);
      }
      const selections = [...indexesByModel].map(([model, index]) => ({ model, index }));
      if (!selections.length) return { index: [] };
      return selections.length === 1 ? selections[0] : { or: selections };
    }

    buildAtomMapping() {
      const rendered = this.models.flatMap(model => model?.selectedAtoms?.({}) || []);
      const domain = this.parsed?.atoms || [];
      if (rendered.length !== domain.length) {
        throw new Error(`Renderer parsed ${rendered.length} atoms but the molecular model parsed ${domain.length}.`);
      }
      this.domainByRendererKey = new Map();
      this.rendererLocationByDomainIndex = new Map();
      const available = new Set(rendered.map((_, index) => index));
      const buckets = new Map();
      for (let index = 0; index < rendered.length; index += 1) {
        const key = rendererAtomKey(rendered[index]);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(index);
      }
      for (let domainIndex = 0; domainIndex < domain.length; domainIndex += 1) {
        const atom = domain[domainIndex];
        let renderedPosition = domainIndex;
        if (!available.has(renderedPosition) || !coordinatesAgree(atom, rendered[renderedPosition])) {
          const candidates = buckets.get(domainAtomKey(atom)) || [];
          renderedPosition = candidates.find(index => available.has(index));
        }
        if (renderedPosition == null || !available.has(renderedPosition)) {
          throw new Error(`Could not map molecular atom ${domainIndex + 1} into the renderer.`);
        }
        available.delete(renderedPosition);
        const rendererAtom = rendered[renderedPosition];
        const rendererIndex = Number(rendererAtom.index);
        if (!Number.isInteger(rendererIndex)) throw new Error('Renderer atom mapping is missing a numeric atom index.');
        const rendererModel = Number(rendererAtom.model);
        if (!Number.isInteger(rendererModel)) throw new Error('Renderer atom mapping is missing a numeric model index.');
        this.domainByRendererKey.set(`${rendererModel}|${rendererIndex}`, atom);
        this.rendererLocationByDomainIndex.set(atom.index, { model: rendererModel, index: rendererIndex });
      }
    }

    buildCoordinateSetAtomMapping() {
      this.domainByRendererKey = new Map();
      this.rendererLocationByDomainIndex = new Map();
      for (let modelIndex = 0; modelIndex < this.models.length; modelIndex += 1) {
        const rendered = this.models[modelIndex]?.selectedAtoms?.({}) || [];
        const atomIndices = this.parsed.coordinateSets[modelIndex]?.atomIndices || [];
        if (rendered.length !== atomIndices.length) {
          throw new Error(`Renderer parsed ${rendered.length} atoms for coordinate model ${modelIndex + 1}, but the molecular model parsed ${atomIndices.length}.`);
        }
        for (let atomIndex = 0; atomIndex < atomIndices.length; atomIndex += 1) {
          const atom = this.parsed.atoms[atomIndices[atomIndex]];
          const rendererAtom = rendered[atomIndex];
          if (!coordinatesAgree(atom, rendererAtom)) {
            throw new Error(`Could not map molecular atom ${atom.index + 1} into coordinate model ${modelIndex + 1}.`);
          }
          const rendererIndex = Number(rendererAtom.index);
          const rendererModel = Number(rendererAtom.model);
          if (!Number.isInteger(rendererIndex) || !Number.isInteger(rendererModel)) {
            throw new Error('Renderer atom mapping is missing a numeric model or atom index.');
          }
          this.domainByRendererKey.set(`${rendererModel}|${rendererIndex}`, atom);
          this.rendererLocationByDomainIndex.set(atom.index, { model: rendererModel, index: rendererIndex });
        }
      }
    }

    applyNormalizedBonds() {
      const renderedByKey = new Map();
      for (const model of this.models) for (const atom of model?.selectedAtoms?.({}) || []) {
        atom.bonds = [];
        atom.bondOrder = [];
        renderedByKey.set(`${Number(atom.model)}|${Number(atom.index)}`, atom);
      }
      for (const bond of this.parsed?.bonds || []) {
        const [leftIndex, rightIndex] = bond.atomIndices;
        const leftLocation = this.rendererLocationByDomainIndex.get(leftIndex);
        const rightLocation = this.rendererLocationByDomainIndex.get(rightIndex);
        if (!leftLocation || !rightLocation || leftLocation.model !== rightLocation.model) continue;
        const left = renderedByKey.get(`${leftLocation.model}|${leftLocation.index}`);
        const right = renderedByKey.get(`${rightLocation.model}|${rightLocation.index}`);
        if (!left || !right) continue;
        left.bonds.push(right.index);
        left.bondOrder.push(Number(bond.order) || 1);
        right.bonds.push(left.index);
        right.bondOrder.push(Number(bond.order) || 1);
      }
    }

    domainAtomForRenderer(atom) {
      return this.domainByRendererKey.get(`${Number(atom?.model)}|${Number(atom?.index)}`) || null;
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
      const normalized = this.domainAtomForRenderer(atom) || this.normalizeAtom(atom);
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
      this.applyBackground();
      this.viewer.render();
    }

    setExportOptions({ backgroundAlpha, screenScale } = {}) {
      if (backgroundAlpha === 0 || backgroundAlpha === 1) this.options.backgroundAlpha = backgroundAlpha;
      if (screenScale != null) this.options.screenScale = positiveNumber(screenScale, 1);
      if (this.doc) this.applyBackground();
    }

    applyBackground() {
      if (!this.doc) return;
      if (this.viewer.config) this.viewer.config.backgroundAlpha = this.options.backgroundAlpha;
      this.viewer.setBackgroundColor(this.doc.scene.background, this.options.backgroundAlpha);
    }

    labelOptions(style) {
      const scale = this.options.screenScale;
      const scaled = { ...style };
      for (const key of ['fontSize', 'padding', 'borderThickness']) {
        if (Number.isFinite(style[key])) scaled[key] = Math.max(1, Math.round(style[key] * scale));
      }
      return scaled;
    }

    scaledLineWidth(width) {
      const [minimum, maximum] = this.getLineWidthRange();
      return Math.min(maximum, Math.max(minimum, Number(width) * this.options.screenScale));
    }

    getLineWidthRange() {
      const gl = this.viewer.getRenderer?.().getContext?.();
      if (!gl || gl.isContextLost?.()) return [1, 1];
      const range = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
      return range && range.length === 2 ? [Number(range[0]), Number(range[1])] : [1, 1];
    }

    getCameraSnapshot() {
      return { view: structuredClone(this.viewer.getView()) };
    }

    getSizingInfo() {
      const canvas = this.viewer.getCanvas?.();
      const renderer = this.viewer.getRenderer?.();
      const gl = renderer?.getContext?.();
      const lost = !gl || Boolean(gl.isContextLost?.());
      const parameter = key => lost ? 0 : gl.getParameter(key);
      const viewport = parameter(gl?.MAX_VIEWPORT_DIMS);
      return {
        width: Number(canvas?.width) || 0,
        height: Number(canvas?.height) || 0,
        drawingBufferWidth: Number(gl?.drawingBufferWidth) || 0,
        drawingBufferHeight: Number(gl?.drawingBufferHeight) || 0,
        devicePixelRatio: positiveNumber(renderer?.devicePixelRatio, positiveNumber(window.devicePixelRatio, 1)),
        contextLost: lost,
        limits: {
          maxViewportWidth: Number(viewport?.[0]) || 0,
          maxViewportHeight: Number(viewport?.[1]) || 0,
          maxTextureSize: Number(parameter(gl?.MAX_TEXTURE_SIZE)) || 0,
          maxRenderbufferSize: Number(parameter(gl?.MAX_RENDERBUFFER_SIZE)) || 0
        }
      };
    }

    setOutputSize(width, height) {
      this.stabilizeFramebufferResources();
      const configuredRatio = positiveNumber(window.devicePixelRatio, 1);
      const ratio = this.options.upscale && configuredRatio < 2 ? 2 : configuredRatio;
      const logicalWidth = (Number(width) + .01) / ratio;
      const logicalHeight = (Number(height) + .01) / ratio;
      this.viewer.setWidth(logicalWidth);
      this.viewer.setHeight(logicalHeight);
      return this.getSizingInfo();
    }

    async whenSurfacesReady(generation) {
      const tasks = this.surfaceTasks.get(generation);
      if (!tasks) throw new Error('The requested render generation is no longer available.');
      const results = await Promise.all(tasks);
      const failure = results.find(result => !result.ok);
      if (failure) throw failure.error instanceof Error ? failure.error : new Error('3Dmol surface rendering failed.');
      return generation;
    }

    capturePNG(generation, { width, height, backgroundAlpha = this.options.backgroundAlpha } = {}) {
      if (generation !== this.surfaceGeneration) {
        return Promise.reject(new Error('The requested render generation was superseded.'));
      }
      this.setExportOptions({ backgroundAlpha });
      const requestedWidth = Number(width);
      const requestedHeight = Number(height);
      this.setOutputSize(requestedWidth, requestedHeight);
      this.applyBackground();
      this.viewer.render();
      const exact = this.getSizingInfo();
      if (exact.contextLost) return Promise.reject(new Error('The export WebGL context was lost.'));
      if (exact.width !== requestedWidth || exact.height !== requestedHeight
        || exact.drawingBufferWidth !== requestedWidth || exact.drawingBufferHeight !== requestedHeight) {
        const error = new Error(
          `The browser created ${exact.width} x ${exact.height} canvas pixels and `
          + `${exact.drawingBufferWidth} x ${exact.drawingBufferHeight} WebGL pixels instead of `
          + `${requestedWidth} x ${requestedHeight}.`
        );
        error.code = 'renderer-dimension-mismatch';
        return Promise.reject(error);
      }
      const canvas = this.viewer.getCanvas?.();
      return new Promise((resolve, reject) => {
        try {
          canvas.toBlob(blob => resolve(blob), 'image/png');
        } catch (error) {
          reject(error);
        }
      });
    }

    resetAfterExport(generation) {
      if (generation !== this.surfaceGeneration) return false;
      this.surfaceGeneration += 1;
      clearTimeout(this.viewTimer);
      this.removeLabels();
      this.disposeShapeRenderResources();
      this.viewer.removeAllShapes();
      this.disposeSurfaceRenderResources();
      this.viewer.removeAllSurfaces();
      this.disposeModelRenderResources();
      this.viewer.removeAllModels();
      this.viewer.setClickable?.({}, false);
      this.doc = null;
      this.parsed = null;
      this.model = null;
      this.models = [];
      this.cacheKey = '';
      this.measurementDraft = [];
      this.activeMeasurementId = null;
      this.activeSavedSelectionId = null;
      this.domainByRendererKey.clear();
      this.rendererLocationByDomainIndex.clear();
      this.surfaceTasks.clear();
      this.options.backgroundAlpha = 1;
      this.options.screenScale = 1;
      if (this.viewer.config) this.viewer.config.backgroundAlpha = 1;
      this.viewer.setBackgroundColor('#07111f', 1);
      this.setOutputSize(64, 64);
      this.viewer.render();
      return true;
    }

    removeLabels() {
      for (const label of this.viewer.labels || []) label?.dispose?.();
      this.viewer.removeAllLabels();
    }

    disposeModelRenderResources() {
      if (this.options.interactive) return;
      // GLModel.removegl() in pinned 3Dmol 2.5.5 does not recurse through the
      // cloned scene graph or release instancing buffers, so do both before a
      // hidden export generation is replaced.
      const geometries = new Set();
      const materials = new Set();
      const visit = object => {
        if (!object) return;
        if (object.geometry) geometries.add(object.geometry);
        const entries = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of entries) if (material) materials.add(material);
        for (const child of object.children || []) visit(child);
      };
      for (const model of this.models) visit(model?.renderedMolObj);
      const gl = this.viewer.getRenderer?.()?.getContext?.();
      for (const geometry of geometries) {
        this.disposeGeometryBuffers(geometry, gl);
        geometry.dispose?.();
      }
      for (const material of materials) {
        const shaders = material?.program && gl?.getAttachedShaders?.(material.program);
        material.dispose?.();
        for (const shader of shaders || []) gl.deleteShader?.(shader);
      }
      for (const model of this.models) {
        const rendered = model?.renderedMolObj;
        if (rendered) this.viewer.modelGroup?.remove?.(rendered);
        if (model) {
          model.renderedMolObj = null;
          model.molObj = null;
        }
      }
    }

    disposeSurfaceRenderResources() {
      if (this.options.interactive) return;
      const gl = this.viewer.getRenderer?.()?.getContext?.();
      const geometries = new Set();
      const materials = new Set();
      for (const surface of Object.values(this.viewer.surfaces || {})) {
        for (const entry of surface || []) {
          if (entry?.geo) geometries.add(entry.geo);
          if (entry?.mat) materials.add(entry.mat);
        }
      }
      for (const geometry of geometries) this.disposeGeometryBuffers(geometry, gl);
      for (const material of materials) {
        const shaders = material?.program && gl?.getAttachedShaders?.(material.program);
        material.dispose?.();
        for (const shader of shaders || []) gl.deleteShader?.(shader);
      }
    }

    disposeShapeRenderResources() {
      if (this.options.interactive) return;
      const gl = this.viewer.getRenderer?.()?.getContext?.();
      const geometries = new Set();
      const materials = new Set();
      const visit = object => {
        if (!object) return;
        if (object.geometry) geometries.add(object.geometry);
        const entries = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of entries) if (material) materials.add(material);
        for (const child of object.children || []) visit(child);
      };
      for (const shape of this.viewer.shapes || []) visit(shape?.renderedShapeObj);
      for (const geometry of geometries) {
        this.disposeGeometryBuffers(geometry, gl);
        geometry.dispose?.();
      }
      for (const material of materials) {
        const shaders = material?.program && gl?.getAttachedShaders?.(material.program);
        material.dispose?.();
        for (const shader of shaders || []) gl.deleteShader?.(shader);
      }
      for (const shape of this.viewer.shapes || []) {
        const rendered = shape?.renderedShapeObj;
        if (rendered) this.viewer.modelGroup?.remove?.(rendered);
        if (shape) {
          shape.renderedShapeObj = null;
          shape.shapeObj = null;
        }
      }
    }

    disposeGeometryBuffers(geometry, gl) {
      for (const holder of [geometry, ...(geometry?.geometryGroups || [])]) {
        for (const key of Object.keys(holder || {})) {
          if (!/^__webgl.*Buffer$/.test(key) || holder[key] === undefined) continue;
          gl?.deleteBuffer?.(holder[key]);
          holder[key] = undefined;
        }
      }
    }

    stabilizeFramebufferResources() {
      if (this.options.interactive) return;
      const renderer = this.viewer?.getRenderer?.();
      if (!renderer || renderer.__molhtmlStableFramebuffer) return;
      // 3Dmol 2.5.5 recreates framebuffer objects on every resize. The export
      // viewer reuses its initialized objects because setFrameBuffer resizes
      // their storage; the visible interactive renderer retains native setup.
      if (typeof renderer.initFrameBuffer === 'function') renderer.initFrameBuffer = () => {};
      Object.defineProperty(renderer, '__molhtmlStableFramebuffer', { value: true });
    }

    resourceCounts() {
      return {
        models: this.viewer.models?.filter(Boolean).length || 0,
        shapes: this.viewer.shapes?.filter(Boolean).length || 0,
        labels: this.viewer.labels?.filter(Boolean).length || 0,
        surfaces: this.viewer.surfaces ? Object.keys(this.viewer.surfaces).length : 0
      };
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

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function point(atom) {
    return { x: Number(atom.x), y: Number(atom.y), z: Number(atom.z) };
  }

  function coordinatesAgree(left, right) {
    return Math.abs(Number(left?.x) - Number(right?.x)) < .01
      && Math.abs(Number(left?.y) - Number(right?.y)) < .01
      && Math.abs(Number(left?.z) - Number(right?.z)) < .01;
  }

  function coordinateKey(atom) {
    return [Number(atom?.x).toFixed(3), Number(atom?.y).toFixed(3), Number(atom?.z).toFixed(3)].join('|');
  }

  function rendererAtomKey(atom) {
    return `${coordinateKey(atom)}|${String(atom?.atom || atom?.name || '').trim()}|${String(atom?.resn || '').trim()}`;
  }

  function domainAtomKey(atom) {
    return `${coordinateKey(atom)}|${String(atom?.name || '').trim()}|${String(atom?.resn || '').trim()}`;
  }

  function rendererCifForAtoms(atoms, modelNumber) {
    const columns = [
      'group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id',
      'label_asym_id', 'label_entity_id', 'label_seq_id', 'Cartn_x', 'Cartn_y', 'Cartn_z',
      'occupancy', 'B_iso_or_equiv', 'auth_seq_id', 'auth_comp_id', 'auth_asym_id',
      'auth_atom_id', 'pdbx_auth_alt_id', 'pdbx_PDB_ins_code', 'pdbx_PDB_model_num'
    ];
    const lines = [`data_molhtml_model_${modelNumber}`, 'loop_', ...columns.map(name => `_atom_site.${name}`)];
    for (const atom of atoms) {
      lines.push([
        atom.het ? 'HETATM' : 'ATOM', atom.atomSiteId ?? atom.serial, atom.element,
        atom.labelAtomId || atom.name, atom.labelAltId || atom.authAltId || '.', atom.labelCompId || atom.resn,
        atom.labelAsymId || atom.chain, atom.labelEntityId || '.', atom.labelSeqId ?? '.',
        atom.x, atom.y, atom.z, atom.occupancy, atom.bfactor, atom.authSeqId ?? atom.resi,
        atom.authCompId || atom.resn, atom.authAsymId || atom.chain, atom.authAtomId || atom.name,
        atom.authAltId || '.', atom.icode || '?', modelNumber
      ].map(cifToken).join(' '));
    }
    lines.push('#');
    return lines.join('\n');
  }

  function cifToken(value) {
    if (value == null || value === '') return '.';
    const token = String(value);
    if (/^[^\s'"#;]+$/.test(token)) return token;
    if (!token.includes("'")) return `'${token}'`;
    if (!token.includes('"')) return `"${token}"`;
    throw new Error('An atom identifier contains unsupported mmCIF quote characters.');
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
