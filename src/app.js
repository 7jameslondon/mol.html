(function () {
  'use strict';

  const Core = window.MolViewCore;
  const Persistence = window.MolViewPersistence;
  const pristine = Persistence.capturePristine();
  const embedded = document.getElementById('molview-doc')?.textContent?.trim();
  let doc;
  try {
    doc = Core.normalizeDocument(JSON.parse(embedded || '{}'));
  } catch (error) {
    document.getElementById('canvas-message').hidden = false;
    document.getElementById('canvas-message').textContent = `This molecular document could not be opened: ${error.message}`;
    return;
  }

  const elements = Object.fromEntries([
    'document-title', 'save-status', 'save-button', 'save-as-button', 'undo-button', 'redo-button',
    'structure-name', 'structure-stats', 'structure-chip', 'file-input', 'pdb-fetch-form', 'pdb-id',
    'pdb-fetch-button', 'pdb-fetch-status', 'pdb-id-mode-button', 'pdb-search-mode-button',
    'pdb-id-pane', 'pdb-search-pane', 'pdb-search-form', 'pdb-search-query', 'pdb-search-button',
    'pdb-search-status', 'pdb-search-results', 'representation', 'color-mode',
    'show-hydrogens', 'show-water', 'background-color', 'background-value', 'reset-appearance',
    'empty-selection', 'selection-details', 'clear-selection', 'selected-element', 'selected-name',
    'selected-path', 'selected-serial', 'selected-coordinates', 'selection-scope', 'selection-color',
    'apply-color', 'copy-selection', 'fit-button', 'external-banner', 'reload-button', 'toast-region',
    'molecule-viewer', 'canvas-message', 'workspace', 'inspector', 'inspector-title', 'close-inspector',
    'open-file-button', 'inspect-button', 'clear-selection-panel', 'representation-ribbon-value',
    'color-ribbon-value', 'show-ribbon-value', 'measurements-button', 'measurements-ribbon-value',
    'measurement-type', 'start-measurement', 'measurement-pick-progress', 'measurement-pick-status',
    'measurement-pick-atoms', 'cancel-measurement', 'clear-measurements', 'empty-measurements',
    'measurement-list', 'navigator-button', 'navigator-search',
    'navigator-clear-search', 'navigator-count', 'navigator-sequences', 'navigator-tree', 'navigator-status'
  ].map(id => [id, document.getElementById(id)]));

  const undoStack = [];
  const redoStack = [];
  let parsed = null;
  let persistence;
  let backgroundBeforeEdit = doc.scene.background;
  let fetchController = null;
  let searchController = null;
  let activeInspector = null;
  let measurementDraft = null;
  let activeMeasurementId = null;
  const navigatorState = {
    structureKey: '', chains: [], residueByKey: new Map(),
    expandedChains: new Set(), expandedResidues: new Set(), query: ''
  };
  const MAX_NAVIGATOR_SEARCH_ATOMS = 300;
  const inspectorButtons = [...document.querySelectorAll('[data-inspector-target]')];
  const inspectorPanels = [...document.querySelectorAll('[data-inspector-panel]')];
  const inspectorTitles = {
    fetch: 'Find structure', representation: 'Representation', color: 'Color',
    show: 'Show and hide', inspect: 'Selection inspector', measurements: 'Measurements',
    navigator: 'Structure navigator'
  };

  const renderer = new window.MoleculeRenderer(elements['molecule-viewer'], {
    onPick: atom => handleAtomPick(atom),
    onCamera: camera => {
      doc.scene.camera = camera;
      touchDocument('browser', false);
    }
  });

  persistence = new Persistence.PersistenceManager(pristine, () => doc, {
    onStatus: setStatus,
    onHandle: name => toast(`Saving in place to ${name}`, 'success'),
    onRecoveryStatus: stored => {
      if (stored && elements['save-status'].dataset.tone === 'warning') {
        elements['save-status'].textContent = 'Backed up in this browser';
      }
    },
    onExternalChange: externalDoc => {
      elements['external-banner'].hidden = false;
      setStatus(`External revision ${externalDoc.revision} detected`, 'warning');
    }
  });

  function snapshot() {
    return JSON.stringify({ title: doc.title, structure: doc.structure, scene: doc.scene });
  }

  function restoreSnapshot(json) {
    const state = JSON.parse(json);
    doc.title = state.title; doc.structure = state.structure; doc.scene = state.scene;
  }

  function commit(change, { history = true, fit = false, source = 'browser' } = {}) {
    if (history) {
      undoStack.push(snapshot());
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
    }
    change();
    touchDocument(source, true);
    refresh({ fit });
  }

  function touchDocument(source = 'browser', schedule = true) {
    doc.revision = (Number(doc.revision) || 0) + 1;
    doc.modified = new Date().toISOString();
    doc.modifiedBy = source;
    syncLiveDataBlock();
    setStatus('Unsaved changes', 'warning');
    if (schedule) persistence?.schedule();
  }

  function syncLiveDataBlock() {
    const block = document.getElementById('molview-doc');
    if (block) block.textContent = '\n' + JSON.stringify(doc, null, 2).replace(/</g, '\\u003c') + '\n';
  }

  function undo() {
    if (!undoStack.length) return;
    resetMeasurementInteraction(false);
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
    touchDocument('browser');
    refresh();
  }

  function redo() {
    if (!redoStack.length) return;
    resetMeasurementInteraction(false);
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
    touchDocument('browser');
    refresh();
  }

  function refresh({ fit = false } = {}) {
    try {
      renderer.measurementDraft = measurementDraft?.atoms ? [...measurementDraft.atoms] : [];
      renderer.activeMeasurementId = activeMeasurementId;
      renderer.setDocument(doc, { fit });
      parsed = renderer.parsed;
      syncLiveDataBlock();
      elements['canvas-message'].hidden = true;
    } catch (error) {
      elements['canvas-message'].hidden = false;
      elements['canvas-message'].textContent = `Unable to render this structure: ${error.message}`;
    }
    syncControls();
    syncSelection();
    syncMeasurements();
    syncNavigator();
  }

  function syncControls() {
    elements['document-title'].value = doc.title;
    elements['structure-name'].textContent = doc.structure.name;
    const atoms = parsed?.atoms.length || 0;
    const residues = parsed ? new Set(parsed.atoms.map(atom => `${atom.model}|${atom.chain}|${atom.resi}|${atom.icode}`)).size : 0;
    const chains = parsed?.chains.length || 0;
    elements['structure-stats'].textContent = `${atoms.toLocaleString()} atom${atoms === 1 ? '' : 's'} · ${residues.toLocaleString()} residue${residues === 1 ? '' : 's'} · ${chains} chain${chains === 1 ? '' : 's'}`;
    elements['structure-chip'].textContent = `${doc.structure.name.toUpperCase()} · ${doc.structure.format.toUpperCase()}`;
    elements['representation'].value = doc.scene.representation;
    elements['color-mode'].value = doc.scene.colorMode;
    elements['show-hydrogens'].checked = doc.scene.showHydrogens;
    elements['show-water'].checked = doc.scene.showWater;
    elements['background-color'].value = normalizeHex(doc.scene.background, '#07111f');
    elements['background-value'].textContent = doc.scene.background;
    elements['representation-ribbon-value'].textContent = ({
      cartoon: 'Cartoon', 'ball-and-stick': 'Ball & stick', sticks: 'Sticks',
      spacefill: 'Spacefill', lines: 'Lines', surface: 'Surface'
    })[doc.scene.representation] || doc.scene.representation;
    elements['color-ribbon-value'].textContent = ({
      element: 'By element', chain: 'By chain', residue: 'By residue', uniform: 'Uniform'
    })[doc.scene.colorMode] || doc.scene.colorMode;
    elements['show-ribbon-value'].textContent = doc.scene.showHydrogens && doc.scene.showWater
      ? 'H + water' : doc.scene.showHydrogens ? 'Hydrogens' : doc.scene.showWater ? 'Water' : 'Standard';
    const measurementCount = doc.scene.measurements.length;
    elements['measurements-ribbon-value'].textContent = measurementCount
      ? `${measurementCount} saved` : 'None';
    elements['undo-button'].disabled = !undoStack.length;
    elements['redo-button'].disabled = !redoStack.length;
  }

  function selectedAtom() {
    const selector = doc.scene.selection?.selector;
    return selector && parsed ? parsed.atoms.find(atom => Core.atomMatchesSelector(atom, selector, doc.structure.id)) : null;
  }

  function syncSelection() {
    const atom = selectedAtom();
    elements['empty-selection'].hidden = Boolean(atom);
    elements['selection-details'].hidden = !atom;
    elements['clear-selection'].disabled = !atom;
    elements['clear-selection-panel'].disabled = !atom;
    elements['inspect-button'].disabled = !atom;
    if (!atom) return;
    elements['selected-element'].textContent = atom.element;
    elements['selected-element'].style.background = Core.ELEMENT_COLORS[atom.element] || '#8795a7';
    elements['selected-name'].textContent = atom.name;
    elements['selected-path'].textContent = `${atom.chain === '_' ? 'No chain' : `Chain ${atom.chain}`} · ${atom.resn} ${atom.resi}${atom.icode || ''}`;
    elements['selected-serial'].textContent = atom.serial;
    elements['selected-coordinates'].textContent = `${atom.x.toFixed(2)}, ${atom.y.toFixed(2)}, ${atom.z.toFixed(2)}`;
  }

  function syncMeasurements() {
    const measurements = doc.scene.measurements || [];
    if (activeMeasurementId && !measurements.some(measurement => measurement.id === activeMeasurementId)) {
      activeMeasurementId = null;
      renderer.activeMeasurementId = null;
    }
    elements['measurement-list'].replaceChildren();
    elements['empty-measurements'].hidden = Boolean(measurements.length);
    elements['clear-measurements'].disabled = !measurements.length;
    elements['measurement-type'].disabled = Boolean(measurementDraft);
    elements['start-measurement'].disabled = Boolean(measurementDraft);
    elements['measurement-pick-progress'].hidden = !measurementDraft;
    elements['measurement-pick-atoms'].replaceChildren();

    if (measurementDraft) {
      const expected = Core.MEASUREMENT_ATOM_COUNTS[measurementDraft.type];
      const next = Math.min(expected, measurementDraft.atoms.length + 1);
      elements['measurement-pick-status'].textContent = `Pick atom ${next} of ${expected}`;
      for (let index = 0; index < measurementDraft.atoms.length; index++) {
        const row = document.createElement('div');
        row.className = 'measurement-pick-atom';
        const number = document.createElement('b');
        number.textContent = String(index + 1);
        row.append(number, document.createTextNode(Core.atomLabel(measurementDraft.atoms[index])));
        elements['measurement-pick-atoms'].appendChild(row);
      }
    }

    for (const measurement of measurements) {
      const atoms = Core.measurementAtoms(measurement, parsed?.atoms || [], doc.structure.id);
      const value = Core.formatMeasurementValue(measurement.type, Core.measurementValue(measurement.type, atoms));
      const typeName = measurementTypeName(measurement.type);
      const card = document.createElement('article');
      card.className = `measurement-card${measurement.id === activeMeasurementId ? ' active' : ''}`;
      card.dataset.measurementId = measurement.id;

      const header = document.createElement('div');
      header.className = 'measurement-card-header';
      const focus = document.createElement('button');
      focus.className = 'measurement-focus';
      focus.type = 'button';
      focus.setAttribute('aria-pressed', String(measurement.id === activeMeasurementId));
      focus.title = 'Highlight this measurement in the viewer';
      const heading = document.createElement('strong');
      heading.textContent = String(measurement.label || '').trim() || typeName;
      const reading = document.createElement('span');
      reading.textContent = value;
      focus.append(heading, reading);
      focus.addEventListener('click', () => selectMeasurement(measurement.id));
      const remove = document.createElement('button');
      remove.className = 'measurement-delete';
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Delete ${typeName.toLowerCase()}`;
      remove.setAttribute('aria-label', `Delete ${typeName.toLowerCase()}`);
      remove.addEventListener('click', () => deleteMeasurement(measurement.id));
      header.append(focus, remove);

      const atomSummary = document.createElement('p');
      atomSummary.className = 'measurement-atoms';
      atomSummary.textContent = atoms ? atoms.map(Core.atomLabel).join(' → ') : 'Atom selectors are unavailable for this structure.';

      const labelField = document.createElement('label');
      labelField.className = 'measurement-field-label';
      labelField.appendChild(document.createTextNode('Label'));
      const labelInput = document.createElement('input');
      labelInput.className = 'measurement-label-input';
      labelInput.type = 'text';
      labelInput.maxLength = 80;
      labelInput.placeholder = typeName;
      labelInput.value = measurement.label || '';
      labelInput.addEventListener('change', () => updateMeasurement(measurement.id, { label: labelInput.value }));
      labelField.appendChild(labelInput);

      const noteField = document.createElement('label');
      noteField.className = 'measurement-field-label';
      noteField.appendChild(document.createTextNode('Note'));
      const noteInput = document.createElement('textarea');
      noteInput.className = 'measurement-note-input';
      noteInput.maxLength = 500;
      noteInput.placeholder = 'Optional annotation';
      noteInput.value = measurement.note || '';
      noteInput.addEventListener('change', () => updateMeasurement(measurement.id, { note: noteInput.value }));
      noteField.appendChild(noteInput);

      card.append(header, atomSummary, labelField, noteField);
      elements['measurement-list'].appendChild(card);
    }
  }

  function measurementTypeName(type) {
    return ({ distance: 'Distance', angle: 'Angle', dihedral: 'Dihedral' })[type] || 'Unknown measurement';
  }

  function startMeasurement(type = elements['measurement-type'].value) {
    const expected = Core.MEASUREMENT_ATOM_COUNTS[type];
    if (!expected) throw new Error(`Unsupported measurement type: ${type}`);
    if (measurementDraft) cancelMeasurement(false);
    measurementDraft = { type, atoms: [] };
    elements['measurement-type'].value = type;
    activeMeasurementId = null;
    renderer.setActiveMeasurement(null);
    renderer.setMeasurementDraft([]);
    syncMeasurements();
    elements['molecule-viewer'].focus();
    return { type, requiredAtoms: expected };
  }

  function cancelMeasurement(render = true) {
    if (!measurementDraft) return false;
    measurementDraft = null;
    if (render) renderer.setMeasurementDraft([]);
    else renderer.measurementDraft = [];
    syncMeasurements();
    return true;
  }

  function resetMeasurementInteraction(render = true) {
    measurementDraft = null;
    activeMeasurementId = null;
    if (render) {
      renderer.setMeasurementDraft([]);
      renderer.setActiveMeasurement(null);
    } else {
      renderer.measurementDraft = [];
      renderer.activeMeasurementId = null;
    }
  }

  function handleAtomPick(atom) {
    if (!measurementDraft) {
      selectAtom(atom);
      return;
    }
    const duplicate = measurementDraft.atoms.some(candidate =>
      candidate.model === atom.model && candidate.serial === atom.serial
    );
    if (duplicate) {
      toast('Pick a different atom for this measurement.', 'warning');
      return;
    }
    measurementDraft.atoms.push(atom);
    const expected = Core.MEASUREMENT_ATOM_COUNTS[measurementDraft.type];
    if (measurementDraft.atoms.length < expected) {
      renderer.setMeasurementDraft(measurementDraft.atoms);
      syncMeasurements();
      return;
    }

    const type = measurementDraft.type;
    const atoms = [...measurementDraft.atoms];
    const id = Core.uid('measurement');
    measurementDraft = null;
    activeMeasurementId = id;
    commit(() => {
      doc.scene.measurements.push({
        id, type,
        atoms: atoms.map(atom => Core.selectorForAtom(atom, 'atom', doc.structure.id))
      });
    });
    toast(`${measurementTypeName(type)} added`, 'success');
  }

  function selectMeasurement(id) {
    activeMeasurementId = activeMeasurementId === id ? null : id;
    renderer.setActiveMeasurement(activeMeasurementId);
    syncMeasurements();
  }

  function updateMeasurement(id, changes, source = 'browser') {
    const allowed = {};
    if ('label' in changes) allowed.label = String(changes.label ?? '').slice(0, 80);
    if ('note' in changes) allowed.note = String(changes.note ?? '').slice(0, 500);
    const target = doc.scene.measurements.find(measurement => measurement.id === id);
    if (!target) throw new Error(`Measurement ${id} was not found.`);
    commit(() => Object.assign(target, allowed), { source });
    return structuredClone(doc.scene.measurements.find(measurement => measurement.id === id));
  }

  function deleteMeasurement(id, source = 'browser') {
    if (!doc.scene.measurements.some(measurement => measurement.id === id)) return false;
    if (activeMeasurementId === id) activeMeasurementId = null;
    commit(() => {
      doc.scene.measurements = doc.scene.measurements.filter(measurement => measurement.id !== id);
    }, { source });
    return true;
  }

  function clearMeasurements(source = 'browser') {
    if (!doc.scene.measurements.length) return false;
    activeMeasurementId = null;
    commit(() => { doc.scene.measurements = []; }, { source });
    return true;
  }

  function addMeasurement(type, serials, options = {}, source = 'agent') {
    const expected = Core.MEASUREMENT_ATOM_COUNTS[type];
    if (!expected) throw new Error(`Unsupported measurement type: ${type}`);
    if (!Array.isArray(serials) || serials.length !== expected) {
      throw new Error(`${measurementTypeName(type)} requires ${expected} atom serials.`);
    }
    const atoms = serials.map(serial => parsed?.atoms.find(atom => atom.serial === Number(serial)));
    if (!atoms.every(Boolean)) throw new Error('One or more atom serials were not found.');
    if (new Set(atoms.map(atom => `${atom.model}:${atom.serial}`)).size !== atoms.length) {
      throw new Error('Each measurement atom must be distinct.');
    }
    const record = {
      id: typeof options.id === 'string' && options.id.trim() ? options.id : Core.uid('measurement'),
      type,
      atoms: atoms.map(atom => Core.selectorForAtom(atom, 'atom', doc.structure.id))
    };
    if (options.label != null) record.label = String(options.label).slice(0, 80);
    if (options.note != null) record.note = String(options.note).slice(0, 500);
    activeMeasurementId = record.id;
    commit(() => { doc.scene.measurements.push(record); }, { source });
    return structuredClone(record);
  }

  function selectAtom(atom) {
    commit(() => {
      doc.scene.selection = atom ? {
        kind: 'atom',
        selector: Core.selectorForAtom(atom, 'atom', doc.structure.id),
        identity: Core.atomIdentity(atom, doc.structure.id)
      } : null;
    }, { history: false });
    if (atom && elements['inspector'].hidden) openInspector('inspect');
  }

  function syncNavigator() {
    if (!elements['navigator-tree'] || !parsed) return;
    const structureKey = `${doc.structure.id}:${doc.structure.data.length}:${doc.structure.data.slice(0, 60)}`;
    if (structureKey !== navigatorState.structureKey) {
      navigatorState.structureKey = structureKey;
      navigatorState.chains = Core.buildStructureHierarchy(parsed);
      navigatorState.residueByKey = new Map();
      for (const chain of navigatorState.chains) {
        for (const residue of chain.residues) navigatorState.residueByKey.set(residue.key, residue);
      }
      navigatorState.expandedChains.clear();
      navigatorState.expandedResidues.clear();
      navigatorState.query = '';
      elements['navigator-search'].value = '';
      if (navigatorState.chains[0]) navigatorState.expandedChains.add(navigatorState.chains[0].key);
      revealNavigatorSelection();
    }
    renderNavigator();
  }

  function revealNavigatorSelection() {
    const atom = selectedAtom();
    if (!atom) return;
    const chainKey = `${atom.model}|${atom.chain}`;
    const residueKey = `${chainKey}|${atom.resi}|${atom.icode}|${atom.resn}`;
    if (!navigatorState.residueByKey.has(residueKey)) return;
    navigatorState.expandedChains.add(chainKey);
    navigatorState.expandedResidues.add(residueKey);
  }

  function chainDisplayName(chain) {
    const name = chain.chain === '_' ? 'No chain' : `Chain ${chain.chain}`;
    const models = new Set(navigatorState.chains.map(candidate => candidate.model));
    return models.size > 1 ? `${name} · model ${chain.model}` : name;
  }

  function residueDisplayName(residue) {
    return `${residue.resn} ${residue.resi}${residue.icode || ''}`;
  }

  function atomBelongsToResidue(atom, residue) {
    return Boolean(atom) && atom.model === residue.model && atom.chain === residue.chain
      && atom.resi === residue.resi && atom.icode === residue.icode && atom.resn === residue.resn;
  }

  function renderNavigator() {
    if (!elements['navigator-tree']) return;
    const residueCount = navigatorState.chains.reduce((sum, chain) => sum + chain.residues.length, 0);
    elements['navigator-count'].textContent = `${navigatorState.chains.length.toLocaleString()} chain${navigatorState.chains.length === 1 ? '' : 's'} · ${residueCount.toLocaleString()} residue${residueCount === 1 ? '' : 's'}`;
    elements['navigator-clear-search'].hidden = !navigatorState.query;
    renderNavigatorSequences();
    renderNavigatorTree();
  }

  function renderNavigatorSequences() {
    const selected = selectedAtom();
    const fragment = document.createDocumentFragment();
    for (const chain of navigatorState.chains) {
      const expanded = navigatorState.expandedChains.has(chain.key);
      const section = document.createElement('section');
      section.className = 'sequence-chain';

      const toggle = document.createElement('button');
      toggle.className = 'sequence-chain-toggle';
      toggle.type = 'button';
      toggle.dataset.navigatorKind = 'chain';
      toggle.dataset.chainKey = chain.key;
      toggle.setAttribute('aria-expanded', String(expanded));
      const label = document.createElement('strong');
      label.textContent = chainDisplayName(chain);
      const count = document.createElement('span');
      count.textContent = `${chain.residues.length.toLocaleString()} residues`;
      toggle.append(label, count);
      section.appendChild(toggle);

      if (expanded) {
        const strip = document.createElement('div');
        strip.className = 'sequence-strip';
        strip.setAttribute('aria-label', `${chainDisplayName(chain)} residue sequence`);
        for (const residue of chain.residues) {
          const button = document.createElement('button');
          button.className = 'sequence-residue';
          button.type = 'button';
          button.dataset.navigatorKind = 'sequence-residue';
          button.dataset.residueKey = residue.key;
          button.dataset.kind = residue.kind;
          button.textContent = residue.symbol;
          button.title = residueDisplayName(residue);
          button.setAttribute('aria-label', `${residueDisplayName(residue)}, ${residue.atoms.length} atoms`);
          button.setAttribute('aria-current', String(atomBelongsToResidue(selected, residue)));
          strip.appendChild(button);
        }
        section.appendChild(strip);
      }
      fragment.appendChild(section);
    }
    elements['navigator-sequences'].replaceChildren(fragment);
  }

  function renderNavigatorTree() {
    const selected = selectedAtom();
    const query = navigatorState.query;
    const fragment = document.createDocumentFragment();
    const budget = { renderedResidues: 0, renderedSearchAtoms: 0, totalAtomMatches: 0, truncated: false };

    for (const chain of navigatorState.chains) {
      const chainText = `${chainDisplayName(chain)} ${chain.chain}`.toLowerCase();
      const chainMatches = Boolean(query) && chainText.includes(query);
      const expanded = navigatorState.expandedChains.has(chain.key) || Boolean(query);
      const matches = [];

      if (expanded) {
        for (const residue of chain.residues) {
          const residueText = `${residue.symbol} ${residueDisplayName(residue)} ${chainDisplayName(chain)}`.toLowerCase();
          const residueMatches = Boolean(query) && residueText.includes(query);
          const atomMatches = query
            ? residue.atoms.filter(atom => `${atom.name} ${atom.element} ${atom.serial}`.toLowerCase().includes(query))
            : [];
          budget.totalAtomMatches += atomMatches.length;
          if (!query || chainMatches || residueMatches || atomMatches.length) {
            matches.push({ residue, residueMatches, atomMatches });
          }
        }
      }
      if (query && !chainMatches && !matches.length) continue;

      const chainNode = document.createElement('section');
      chainNode.className = 'navigator-chain';
      chainNode.setAttribute('role', 'treeitem');
      chainNode.setAttribute('aria-expanded', String(expanded));
      const toggle = document.createElement('button');
      toggle.className = 'navigator-chain-toggle';
      toggle.type = 'button';
      toggle.dataset.navigatorKind = 'chain';
      toggle.dataset.chainKey = chain.key;
      toggle.setAttribute('aria-expanded', String(expanded));
      const label = document.createElement('strong');
      label.textContent = chainDisplayName(chain);
      const count = document.createElement('span');
      count.textContent = `${chain.residues.length.toLocaleString()} residues`;
      toggle.append(label, count);
      chainNode.appendChild(toggle);

      if (expanded) {
        const group = document.createElement('div');
        group.className = 'navigator-chain-body';
        group.setAttribute('role', 'group');
        for (const match of matches) {
          if (query && budget.renderedResidues >= 600) {
            budget.truncated = true;
            break;
          }
          group.appendChild(renderNavigatorResidue(match, selected, query, chainMatches, budget));
          budget.renderedResidues += 1;
        }
        chainNode.appendChild(group);
      }
      fragment.appendChild(chainNode);
    }

    if (!fragment.childNodes.length) {
      const empty = document.createElement('p');
      empty.className = 'navigator-empty';
      empty.textContent = `No chains, residues, or atoms match “${elements['navigator-search'].value.trim()}”.`;
      fragment.appendChild(empty);
    }
    elements['navigator-tree'].replaceChildren(fragment);

    if (!query) {
      elements['navigator-status'].textContent = 'Atom rows are loaded only when a residue is expanded.';
    } else if (budget.truncated || budget.totalAtomMatches > MAX_NAVIGATOR_SEARCH_ATOMS) {
      elements['navigator-status'].textContent = `Showing a bounded set of matches. Refine “${elements['navigator-search'].value.trim()}” to see more.`;
    } else {
      elements['navigator-status'].textContent = `${budget.renderedResidues.toLocaleString()} matching residue${budget.renderedResidues === 1 ? '' : 's'}${budget.totalAtomMatches ? ` · ${budget.totalAtomMatches.toLocaleString()} matching atom${budget.totalAtomMatches === 1 ? '' : 's'}` : ''}.`;
    }
  }

  function renderNavigatorResidue(match, selected, query, chainMatches, budget) {
    const { residue, residueMatches, atomMatches } = match;
    const expanded = navigatorState.expandedResidues.has(residue.key);
    const current = atomBelongsToResidue(selected, residue);
    const node = document.createElement('div');
    node.className = 'navigator-residue';
    node.setAttribute('role', 'treeitem');
    node.setAttribute('aria-expanded', String(expanded));

    const button = document.createElement('button');
    button.className = 'navigator-residue-button';
    button.type = 'button';
    button.dataset.navigatorKind = 'residue';
    button.dataset.residueKey = residue.key;
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-current', String(current));
    button.setAttribute('aria-label', `${residueDisplayName(residue)}, ${residue.atoms.length} atoms. Select, focus, and ${expanded ? 'collapse' : 'expand'}.`);
    const chevron = document.createElement('span');
    chevron.className = 'navigator-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'navigator-residue-label';
    const name = document.createElement('strong');
    name.textContent = residueDisplayName(residue);
    const symbol = document.createElement('small');
    symbol.textContent = residue.kind === 'other' ? residue.symbol : `${residue.symbol} · ${residue.kind === 'protein' ? 'protein' : 'nucleic acid'}`;
    label.append(name, symbol);
    const count = document.createElement('span');
    count.className = 'navigator-item-count';
    count.textContent = residue.atoms.length;
    button.append(chevron, label, count);
    node.appendChild(button);

    let atoms = [];
    if (expanded) {
      atoms = query && !chainMatches && !residueMatches && atomMatches.length ? atomMatches : residue.atoms;
    } else if (query && atomMatches.length) {
      const remaining = Math.max(0, MAX_NAVIGATOR_SEARCH_ATOMS - budget.renderedSearchAtoms);
      atoms = atomMatches.slice(0, remaining);
      budget.renderedSearchAtoms += atoms.length;
      if (atoms.length < atomMatches.length) budget.truncated = true;
    }
    if (atoms.length) {
      const group = document.createElement('div');
      group.className = 'navigator-atoms';
      group.setAttribute('role', 'group');
      for (const atom of atoms) {
        const atomButton = document.createElement('button');
        atomButton.className = 'navigator-atom-button';
        atomButton.type = 'button';
        atomButton.setAttribute('role', 'treeitem');
        atomButton.dataset.navigatorKind = 'atom';
        atomButton.dataset.atomIndex = atom.index;
        atomButton.setAttribute('aria-current', String(selected?.index === atom.index));
        atomButton.setAttribute('aria-label', `${atom.name}, ${atom.element}, serial ${atom.serial}, ${residueDisplayName(residue)}`);
        const element = document.createElement('span');
        element.className = 'navigator-element';
        element.textContent = atom.element;
        const name = document.createElement('span');
        name.className = 'navigator-atom-name';
        name.textContent = atom.name;
        const serial = document.createElement('span');
        serial.className = 'navigator-serial';
        serial.textContent = `#${atom.serial}`;
        atomButton.append(element, name, serial);
        group.appendChild(atomButton);
      }
      node.appendChild(group);
    }
    return node;
  }

  function toggleNavigatorChain(chainKey) {
    if (navigatorState.expandedChains.has(chainKey)) navigatorState.expandedChains.delete(chainKey);
    else navigatorState.expandedChains.add(chainKey);
    renderNavigator();
  }

  function selectNavigatorResidue(residue, toggleAtoms) {
    if (!residue) return;
    navigatorState.expandedChains.add(`${residue.model}|${residue.chain}`);
    if (toggleAtoms) {
      if (navigatorState.expandedResidues.has(residue.key)) navigatorState.expandedResidues.delete(residue.key);
      else navigatorState.expandedResidues.add(residue.key);
    }
    const atom = Core.representativeAtom(residue);
    if (!atom) return;
    selectAtom(atom);
    renderer.focusSelector(Core.selectorForAtom(atom, 'residue', doc.structure.id));
  }

  function handleNavigatorClick(event) {
    const button = event.target.closest('button[data-navigator-kind]');
    if (!button || !event.currentTarget.contains(button)) return;
    const kind = button.dataset.navigatorKind;
    if (kind === 'chain') {
      toggleNavigatorChain(button.dataset.chainKey);
    } else if (kind === 'residue' || kind === 'sequence-residue') {
      selectNavigatorResidue(navigatorState.residueByKey.get(button.dataset.residueKey), kind === 'residue');
    } else if (kind === 'atom') {
      const atom = parsed?.atoms[Number(button.dataset.atomIndex)];
      if (atom) selectAtom(atom);
    }
  }

  function openInspector(name) {
    if (!inspectorTitles[name]) return;
    if (measurementDraft && name !== 'measurements') cancelMeasurement();
    activeInspector = name;
    elements['inspector-title'].textContent = inspectorTitles[name];
    elements['inspector'].hidden = false;
    elements['workspace'].classList.add('inspector-open');
    for (const panel of inspectorPanels) panel.hidden = panel.dataset.inspectorPanel !== name;
    for (const button of inspectorButtons) button.setAttribute('aria-pressed', String(button.dataset.inspectorTarget === name));
    if (name === 'navigator') {
      revealNavigatorSelection();
      renderNavigator();
    }
  }

  function closeInspector() {
    if (measurementDraft) cancelMeasurement();
    activeInspector = null;
    elements['inspector'].hidden = true;
    elements['workspace'].classList.remove('inspector-open');
    for (const panel of inspectorPanels) panel.hidden = true;
    for (const button of inspectorButtons) button.setAttribute('aria-pressed', 'false');
  }

  function applySelectionColor(color, scope) {
    const atom = selectedAtom();
    if (!atom) throw new Error('Select an atom first.');
    const selector = Core.selectorForAtom(atom, scope, doc.structure.id);
    commit(() => {
      doc.scene.customColors.push({
        id: Core.uid('color'), scope, selector, color,
        label: scope === 'chain' ? `Chain ${atom.chain}` : scope === 'residue' ? `${atom.resn} ${atom.resi}${atom.icode || ''}` : Core.atomLabel(atom)
      });
    });
  }

  function setStatus(message, tone = '') {
    elements['save-status'].textContent = message;
    elements['save-status'].dataset.tone = tone;
  }

  function toast(message, tone = '') {
    const node = document.createElement('div');
    node.className = `toast ${tone}`;
    node.textContent = message;
    elements['toast-region'].appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }

  function normalizeHex(value, fallback) {
    if (/^#[0-9a-f]{6}$/i.test(value || '')) return value;
    return fallback;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    }
  }

  async function importPDB(name, text, options = {}) {
    const parsedCandidate = Core.parsePDB(text);
    const displayName = options.displayName || name.replace(/\.(pdb|ent|txt)$/i, '') || 'Imported molecule';
    resetMeasurementInteraction(false);
    commit(() => {
      doc.title = displayName;
      doc.structure = { id: Core.uid('structure'), name: displayName, format: 'pdb', data: text };
      if (options.source) doc.structure.source = structuredClone(options.source);
      doc.scene.selection = null;
      doc.scene.customColors = [];
      doc.scene.measurements = [];
      doc.scene.camera = { view: null };
    }, { history: false, fit: true });
    undoStack.length = 0; redoStack.length = 0;
    toast(`Loaded ${parsedCandidate.atoms.length.toLocaleString()} atoms from ${name}`, 'success');
    return structuredClone(doc);
  }

  function normalizePDBId(value) {
    const entered = String(value || '').trim().toUpperCase();
    const transitional = entered.match(/^PDB_0000([0-9][A-Z0-9]{3})$/);
    const id = transitional ? transitional[1] : entered;
    if (!/^[0-9][A-Z0-9]{3}$/.test(id)) {
      throw new Error('Enter a four-character PDB ID, such as 4HHB.');
    }
    return id;
  }

  function setFetchState(message, tone = '', busy = false) {
    elements['pdb-fetch-status'].textContent = message;
    elements['pdb-fetch-status'].dataset.tone = tone;
    elements['pdb-fetch-form'].setAttribute('aria-busy', String(busy));
    elements['pdb-id'].disabled = busy;
    elements['pdb-fetch-button'].disabled = busy;
    elements['pdb-fetch-button'].textContent = busy ? 'Fetching…' : 'Fetch';
  }

  function setPDBMode(mode, { focus = true } = {}) {
    const search = mode === 'search';
    elements['pdb-id-mode-button'].classList.toggle('active', !search);
    elements['pdb-search-mode-button'].classList.toggle('active', search);
    elements['pdb-id-mode-button'].setAttribute('aria-selected', String(!search));
    elements['pdb-search-mode-button'].setAttribute('aria-selected', String(search));
    elements['pdb-id-pane'].hidden = search;
    elements['pdb-search-pane'].hidden = !search;
    if (focus) (search ? elements['pdb-search-query'] : elements['pdb-id']).focus();
  }

  function setSearchState(message, tone = '', busy = false) {
    elements['pdb-search-status'].textContent = message;
    elements['pdb-search-status'].dataset.tone = tone;
    elements['pdb-search-form'].setAttribute('aria-busy', String(busy));
    elements['pdb-search-query'].disabled = busy;
    elements['pdb-search-button'].disabled = busy;
    elements['pdb-search-button'].textContent = busy ? 'Searching…' : 'Search';
  }

  function compactUnique(values) {
    return [...new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean))];
  }

  async function fetchEntrySummaries(ids, signal) {
    const query = `query EntrySummaries($ids: [String!]!) {
      entries(entry_ids: $ids) {
        rcsb_id
        struct { title }
        exptl { method }
        rcsb_accession_info { initial_release_date }
        rcsb_entry_info { resolution_combined }
        polymer_entities {
          rcsb_polymer_entity { pdbx_description }
          rcsb_entity_source_organism { ncbi_scientific_name }
        }
      }
    }`;
    const response = await fetch('https://data.rcsb.org/graphql', {
      method: 'POST', signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { ids } })
    });
    if (!response.ok) throw new Error(`RCSB metadata returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors[0].message || 'RCSB metadata lookup failed.');
    return payload.data?.entries || [];
  }

  function renderSearchResults(ids, summaries) {
    const byId = new Map(summaries.filter(Boolean).map(entry => [entry.rcsb_id, entry]));
    elements['pdb-search-results'].replaceChildren();
    for (const id of ids) {
      const entry = byId.get(id) || {};
      const entities = entry.polymer_entities || [];
      const descriptions = compactUnique(entities.map(entity => entity.rcsb_polymer_entity?.pdbx_description));
      const organisms = compactUnique(entities.flatMap(entity => (entity.rcsb_entity_source_organism || []).map(source => source.ncbi_scientific_name)));
      const resolution = Number(entry.rcsb_entry_info?.resolution_combined?.[0]);
      const method = entry.exptl?.[0]?.method;
      const releaseDate = entry.rcsb_accession_info?.initial_release_date?.slice(0, 10);

      const card = document.createElement('article');
      card.className = 'pdb-result-card';
      const heading = document.createElement('div');
      heading.className = 'pdb-result-heading';
      const badge = document.createElement('span');
      badge.className = 'pdb-result-id';
      badge.textContent = id;
      const title = document.createElement('h3');
      title.className = 'pdb-result-title';
      title.textContent = entry.struct?.title || `PDB entry ${id}`;
      heading.append(badge, title);
      card.appendChild(heading);

      if (descriptions.length) {
        const description = document.createElement('p');
        description.className = 'pdb-result-description';
        description.textContent = descriptions.slice(0, 2).join(' · ');
        card.appendChild(description);
      }
      const metadata = document.createElement('div');
      metadata.className = 'pdb-result-meta';
      for (const value of [method, Number.isFinite(resolution) ? `${resolution.toFixed(2)} Å` : '', releaseDate]) {
        if (!value) continue;
        const chip = document.createElement('span');
        chip.textContent = value;
        metadata.appendChild(chip);
      }
      if (metadata.childElementCount) card.appendChild(metadata);
      if (organisms.length) {
        const organism = document.createElement('p');
        organism.className = 'pdb-result-organism';
        organism.textContent = organisms.slice(0, 2).join(' · ');
        card.appendChild(organism);
      }
      const loadButton = document.createElement('button');
      loadButton.className = 'button secondary full-width pdb-result-load';
      loadButton.type = 'button';
      loadButton.dataset.pdbId = id;
      loadButton.textContent = `Load ${id}`;
      loadButton.setAttribute('aria-label', `Load PDB ${id}`);
      card.appendChild(loadButton);
      elements['pdb-search-results'].appendChild(card);
    }
    elements['pdb-search-results'].hidden = !ids.length;
  }

  async function searchPDB(queryValue) {
    const searchTerm = String(queryValue || '').trim();
    if (searchTerm.length < 2) {
      const error = new Error('Enter at least two characters to search the PDB.');
      setSearchState(error.message, 'error');
      throw error;
    }

    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    elements['pdb-search-results'].hidden = true;
    elements['pdb-search-results'].replaceChildren();
    setSearchState(`Searching RCSB for “${searchTerm}”…`, '', true);
    try {
      const request = {
        query: { type: 'terminal', service: 'full_text', parameters: { value: searchTerm } },
        return_type: 'entry',
        request_options: { paginate: { start: 0, rows: 12 } }
      };
      const response = await fetch('https://search.rcsb.org/rcsbsearch/v2/query', {
        method: 'POST', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
      if (response.status === 204) {
        setSearchState(`No PDB entries matched “${searchTerm}”.`, '');
        return [];
      }
      if (!response.ok) throw new Error(`RCSB search returned HTTP ${response.status}.`);
      const payload = await response.json();
      const ids = compactUnique((payload.result_set || []).map(result => result.identifier)).slice(0, 12);
      if (!ids.length) {
        setSearchState(`No PDB entries matched “${searchTerm}”.`, '');
        return [];
      }
      let summaries = [];
      try { summaries = await fetchEntrySummaries(ids, controller.signal); }
      catch (error) {
        if (error.name === 'AbortError') throw error;
      }
      renderSearchResults(ids, summaries);
      const total = Number(payload.total_count) || ids.length;
      setSearchState(`Showing ${ids.length} of ${total.toLocaleString()} matches. Choose a structure to load.`, 'success');
      return ids.map(id => bySummaryId(id, summaries));
    } catch (error) {
      const message = error.name === 'AbortError'
        ? 'The RCSB search timed out. Check your connection and try again.'
        : error instanceof TypeError
          ? 'Could not reach RCSB. Check your connection and try again.'
          : error.message;
      setSearchState(message, 'error');
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
      if (searchController === controller) {
        searchController = null;
        elements['pdb-search-form'].setAttribute('aria-busy', 'false');
        elements['pdb-search-query'].disabled = false;
        elements['pdb-search-button'].disabled = false;
        elements['pdb-search-button'].textContent = 'Search';
      }
    }
  }

  function bySummaryId(id, summaries) {
    return structuredClone(summaries.find(entry => entry?.rcsb_id === id) || { rcsb_id: id });
  }

  async function fetchPDB(idValue) {
    let id;
    try { id = normalizePDBId(idValue); }
    catch (error) { setFetchState(error.message, 'error'); throw error; }

    const url = `https://files.rcsb.org/download/${encodeURIComponent(id)}.pdb`;
    fetchController?.abort();
    const controller = new AbortController();
    fetchController = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setFetchState(`Fetching ${id} from RCSB…`, '', true);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/plain' } });
      if (!response.ok) {
        if (response.status === 404) throw new Error(`${id} has no legacy PDB file. Check the ID; some entries are available only as mmCIF.`);
        throw new Error(`RCSB returned HTTP ${response.status}.`);
      }
      const text = await response.text();
      const result = await importPDB(`${id}.pdb`, text, {
        displayName: `PDB ${id}`,
        source: { kind: 'rcsb-pdb', pdbId: id, url, fetchedAt: new Date().toISOString() }
      });
      elements['pdb-id'].value = id;
      setFetchState(`Loaded ${id}. It will be embedded when you save.`, 'success');
      return result;
    } catch (error) {
      const message = error.name === 'AbortError'
        ? 'The RCSB request timed out. Check your connection and try again.'
        : error instanceof TypeError
          ? 'Could not reach RCSB. Check your connection and try again.'
          : error.message;
      setFetchState(message, 'error');
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
      if (fetchController === controller) {
        fetchController = null;
        elements['pdb-fetch-form'].setAttribute('aria-busy', 'false');
        elements['pdb-id'].disabled = false;
        elements['pdb-fetch-button'].disabled = false;
        elements['pdb-fetch-button'].textContent = 'Fetch';
      }
    }
  }

  elements['document-title'].addEventListener('change', event => {
    const value = event.target.value.trim();
    if (value && value !== doc.title) commit(() => { doc.title = value; });
    else event.target.value = doc.title;
  });
  elements['representation'].addEventListener('change', event => commit(() => { doc.scene.representation = event.target.value; }));
  elements['color-mode'].addEventListener('change', event => commit(() => { doc.scene.colorMode = event.target.value; }));
  elements['show-hydrogens'].addEventListener('change', event => commit(() => { doc.scene.showHydrogens = event.target.checked; }));
  elements['show-water'].addEventListener('change', event => commit(() => { doc.scene.showWater = event.target.checked; }));
  elements['background-color'].addEventListener('input', event => {
    doc.scene.background = event.target.value;
    elements['background-value'].textContent = event.target.value;
    renderer.render();
  });
  elements['background-color'].addEventListener('focus', () => { backgroundBeforeEdit = doc.scene.background; });
  elements['background-color'].addEventListener('change', event => {
    const next = event.target.value;
    doc.scene.background = backgroundBeforeEdit;
    commit(() => { doc.scene.background = next; });
    backgroundBeforeEdit = next;
  });
  elements['reset-appearance'].addEventListener('click', () => commit(() => {
    Object.assign(doc.scene, { representation: 'ball-and-stick', colorMode: 'element', background: '#07111f', showHydrogens: false, showWater: false, customColors: [] });
  }));
  elements['clear-selection'].addEventListener('click', () => selectAtom(null));
  elements['clear-selection-panel'].addEventListener('click', () => selectAtom(null));
  elements['start-measurement'].addEventListener('click', () => {
    try { startMeasurement(); }
    catch (error) { toast(error.message, 'error'); }
  });
  elements['cancel-measurement'].addEventListener('click', () => cancelMeasurement());
  elements['clear-measurements'].addEventListener('click', () => {
    if (doc.scene.measurements.length && confirm('Delete all saved measurements?')) clearMeasurements();
  });
  elements['navigator-search'].addEventListener('input', event => {
    navigatorState.query = event.target.value.trim().toLowerCase();
    renderNavigator();
  });
  elements['navigator-clear-search'].addEventListener('click', () => {
    navigatorState.query = '';
    elements['navigator-search'].value = '';
    renderNavigator();
    elements['navigator-search'].focus();
  });
  elements['navigator-sequences'].addEventListener('click', handleNavigatorClick);
  elements['navigator-tree'].addEventListener('click', handleNavigatorClick);
  elements['open-file-button'].addEventListener('click', () => elements['file-input'].click());
  elements['close-inspector'].addEventListener('click', closeInspector);
  for (const button of inspectorButtons) {
    button.addEventListener('click', () => {
      const target = button.dataset.inspectorTarget;
      if (!elements['inspector'].hidden && activeInspector === target) closeInspector();
      else openInspector(target);
    });
  }
  elements['apply-color'].addEventListener('click', () => {
    try {
      applySelectionColor(elements['selection-color'].value, elements['selection-scope'].value);
      toast(`Applied ${elements['selection-color'].value} to ${elements['selection-scope'].value}`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  elements['copy-selection'].addEventListener('click', async () => {
    await copyText(JSON.stringify(doc.scene.selection, null, 2));
    toast('Selection JSON copied', 'success');
  });
  elements['file-input'].addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await importPDB(file.name, await file.text()); }
    catch (error) { toast(`Could not load ${file.name}: ${error.message}`, 'error'); }
    event.target.value = '';
  });
  elements['pdb-fetch-form'].addEventListener('submit', async event => {
    event.preventDefault();
    try { await fetchPDB(elements['pdb-id'].value); }
    catch (error) { toast(error.message, 'error'); }
  });
  elements['pdb-id-mode-button'].addEventListener('click', () => setPDBMode('id'));
  elements['pdb-search-mode-button'].addEventListener('click', () => setPDBMode('search'));
  elements['pdb-search-form'].addEventListener('submit', async event => {
    event.preventDefault();
    try { await searchPDB(elements['pdb-search-query'].value); }
    catch (error) { toast(error.message, 'error'); }
  });
  elements['pdb-search-results'].addEventListener('click', async event => {
    const button = event.target.closest('.pdb-result-load');
    if (!button) return;
    const id = button.dataset.pdbId;
    const buttons = [...elements['pdb-search-results'].querySelectorAll('.pdb-result-load')];
    for (const candidate of buttons) candidate.disabled = true;
    button.textContent = 'Loading…';
    setSearchState(`Fetching ${id} coordinates…`, '', false);
    try {
      await fetchPDB(id);
      button.textContent = 'Loaded';
      setSearchState(`Loaded ${id}. It will be embedded when you save.`, 'success');
    } catch (error) {
      button.textContent = `Load ${id}`;
      setSearchState(error.message, 'error');
      toast(error.message, 'error');
    } finally {
      for (const candidate of buttons) candidate.disabled = false;
    }
  });
  elements['save-button'].addEventListener('click', async () => {
    const result = await persistence.save(false);
    if (result === 'cancelled') setStatus('Save cancelled', 'warning');
  });
  elements['save-as-button'].addEventListener('click', () => persistence.save(true));
  elements['undo-button'].addEventListener('click', undo);
  elements['redo-button'].addEventListener('click', redo);
  elements['fit-button'].addEventListener('click', () => {
    renderer.fit(false);
    touchDocument('browser');
    refresh();
  });
  elements['reload-button'].addEventListener('click', () => location.reload());

  window.addEventListener('keydown', event => {
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 's') { event.preventDefault(); persistence.save(event.shiftKey); }
    else if (command && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
    else if ((command && event.key.toLowerCase() === 'y') || (command && event.shiftKey && event.key.toLowerCase() === 'z')) { event.preventDefault(); redo(); }
    else if (event.key === 'Escape' && measurementDraft) cancelMeasurement();
    else if (event.key === 'Escape' && !elements['inspector'].hidden) closeInspector();
    else if (event.key === 'Escape') selectAtom(null);
    else if (event.key.toLowerCase() === 'r' && (document.activeElement === elements['molecule-viewer'] || elements['molecule-viewer'].contains(document.activeElement))) elements['fit-button'].click();
  });

  window.molview = Object.freeze({
    version: '0.6.0',
    get document() { return structuredClone(doc); },
    getSelection() { return structuredClone(doc.scene.selection); },
    getMeasurements() { return structuredClone(doc.scene.measurements); },
    serialize() { return persistence.serialize(); },
    async save() { return persistence.save(false); },
    async importPDB(name, text) { return importPDB(name, text); },
    async fetchPDB(id) { return fetchPDB(id); },
    async searchPDB(query) { return searchPDB(query); },
    selectAtom(serial) {
      const atom = parsed?.atoms.find(candidate => candidate.serial === Number(serial));
      if (!atom) throw new Error(`Atom serial ${serial} was not found.`);
      selectAtom(atom);
      return structuredClone(doc.scene.selection);
    },
    colorSelection(color, scope = 'atom') { applySelectionColor(color, scope); },
    beginMeasurement(type) {
      openInspector('measurements');
      return startMeasurement(type);
    },
    cancelMeasurement() { return cancelMeasurement(); },
    addMeasurement(type, serials, options) { return addMeasurement(type, serials, options, 'agent'); },
    updateMeasurement(id, changes) { return updateMeasurement(id, changes || {}, 'agent'); },
    removeMeasurement(id) { return deleteMeasurement(id, 'agent'); },
    clearMeasurements() { return clearMeasurements('agent'); },
    loadDocument(value, modifiedBy = 'agent') {
      const next = Core.normalizeDocument(typeof value === 'string' ? JSON.parse(value) : value);
      resetMeasurementInteraction(false);
      undoStack.push(snapshot()); redoStack.length = 0;
      doc = next;
      touchDocument(modifiedBy);
      refresh({ fit: false });
      return structuredClone(doc);
    }
  });

  refresh();
  persistence.recoveryFor(doc).then(recovered => {
    if (!recovered) return;
    if (confirm(`A newer browser recovery exists for “${doc.title}” (revision ${recovered.revision}). Restore it?`)) {
      doc = Core.normalizeDocument(recovered);
      syncLiveDataBlock();
      refresh();
      toast('Recovered newer browser autosave', 'success');
    }
  });
})();
