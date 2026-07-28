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
      this.models = [];
      this.cacheKey = '';
      this.surfaceGeneration = 0;
      this.applyingDocument = false;
      this.lastReportedView = '';
      this.measurementDraft = [];
      this.activeMeasurementId = null;
      this.activeSavedSelectionId = null;
      this.domainByRendererKey = new Map();
      this.rendererLocationByDomainIndex = new Map();
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
          this.parsed = Core.parseStructure(doc.structure.data, doc.structure.format);
          this.cacheKey = key;
          this.surfaceGeneration += 1;
          this.viewer.removeAllSurfaces();
          this.viewer.removeAllLabels();
          this.viewer.removeAllShapes();
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
          if (multipleMmcifModels) this.applyNormalizedBonds();
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
        const selected = this.domainAtomForRenderer(atom) || this.normalizeAtom(atom);
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
      for (const [leftIndex, rightIndex] of this.parsed?.bonds || []) {
        const leftLocation = this.rendererLocationByDomainIndex.get(leftIndex);
        const rightLocation = this.rendererLocationByDomainIndex.get(rightIndex);
        if (!leftLocation || !rightLocation || leftLocation.model !== rightLocation.model) continue;
        const left = renderedByKey.get(`${leftLocation.model}|${leftLocation.index}`);
        const right = renderedByKey.get(`${rightLocation.model}|${rightLocation.index}`);
        if (!left || !right) continue;
        left.bonds.push(right.index);
        left.bondOrder.push(1);
        right.bonds.push(left.index);
        right.bondOrder.push(1);
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
      'auth_atom_id', 'pdbx_PDB_ins_code', 'pdbx_PDB_model_num'
    ];
    const lines = [`data_molhtml_model_${modelNumber}`, 'loop_', ...columns.map(name => `_atom_site.${name}`)];
    for (const atom of atoms) {
      lines.push([
        atom.het ? 'HETATM' : 'ATOM', atom.atomSiteId ?? atom.serial, atom.element,
        atom.labelAtomId || atom.name, atom.labelAltId || '.', atom.labelCompId || atom.resn,
        atom.labelAsymId || atom.chain, atom.labelEntityId || '.', atom.labelSeqId ?? '.',
        atom.x, atom.y, atom.z, atom.occupancy, atom.bfactor, atom.authSeqId ?? atom.resi,
        atom.authCompId || atom.resn, atom.authAsymId || atom.chain, atom.authAtomId || atom.name,
        atom.icode || '?', modelNumber
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
